import type { Command } from 'commander';
import { confirm } from '@inquirer/prompts';
import { formatUnits, maxUint256, type Address } from 'viem';
import { describeSupportedSchemes, resolveNetwork } from 'radius-sdk';
import {
  createRadiusFetch,
  getPaymentReceipt,
  RadiusPaymentError,
  type ApprovalRequest,
  type PaymentOffer,
  type PaymentReceipt,
} from 'radius-sdk/client';
import { resolveConfig } from '../lib/config.js';
import { requireAccount } from '../lib/account.js';
import { jsonStringify } from '../lib/format.js';
import {
  decodeBodyAsUtf8,
  isSupportedVerb,
  looksLikeJson,
  parseHeaderArgs,
  readBodyArg,
  readCappedBody,
  runRequest,
  SUPPORTED_VERBS,
  type HttpResponse,
  type HttpVerb,
} from '../lib/http.js';
import { decidePayment, type PayDecision } from '../lib/x402Policy.js';
import type { GlobalOptions } from '../types.js';

interface SubOptions {
  header?: string[];
  data?: string;
  x402Threshold?: string;
  yes?: boolean;
  include?: boolean;
  x402ApprovePermit2?: boolean;
}

interface PaymentSummary {
  paid: boolean;
  scheme: string;
  asset: Address;
  assetSymbol: string | null;
  amount: string;
  amountWei: string;
  payTo: Address;
  txHash?: string;
  payer?: string;
}

export function registerWalletX402(wallet: Command): void {
  wallet
    .command('x402')
    .description(
      [
        'Make an HTTP request and pay an x402 challenge if the server responds with 402.',
        `Supports ${describeSupportedSchemes()}.`,
        'Permit2 approvals are gas-sponsored when the server offers eip2612GasSponsoring.',
        '',
        '  radius-cli wallet x402 get https://example.com/resource',
        '  radius-cli wallet x402 post https://api.example.com/x -d \'{"a":1}\'',
        '  radius-cli wallet x402 get https://example.com/r --x402-threshold 0.05',
      ].join('\n'),
    )
    .argument('<verb>', `HTTP verb (${SUPPORTED_VERBS.join(', ')})`)
    .argument('<url>', 'request URL')
    .option('-H, --header <h...>', "request header, repeatable: 'Key: Value'")
    .option('-d, --data <body>', "request body (literal, '@path' for file, '-' for stdin)")
    .option(
      '--x402-threshold <decimal>',
      "auto-pay if the offered fee ≤ this amount in the asset's display units",
    )
    .option('-y, --yes', 'auto-confirm payment regardless of amount')
    .option(
      '--x402-approve-permit2',
      'grant Permit2 an unlimited token approval if one is missing and the server does not sponsor it',
    )
    .option('--include', 'write response status and headers to stderr')
    .action(async (verbArg: string, url: string, subOpts: SubOptions, cmd) => {
      const opts = cmd.optsWithGlobals() as GlobalOptions;
      await runX402(verbArg, url, subOpts, opts);
    });
}

/** Why a payment did not go ahead; decides the exit code and message. */
type Refusal =
  | { kind: 'insufficient-balance' }
  | { kind: 'no-tty' }
  | { kind: 'declined' }
  | { kind: 'approval-no-tty' }
  | { kind: 'approval-declined' };

async function runX402(
  verbArg: string,
  url: string,
  subOpts: SubOptions,
  opts: GlobalOptions,
): Promise<void> {
  const verb = verbArg.toLowerCase();
  if (!isSupportedVerb(verb)) {
    process.stderr.write(`x402: unsupported verb '${verbArg}' (use one of ${SUPPORTED_VERBS.join(', ')})\n`);
    process.exit(2);
  }
  const method = verb.toUpperCase();

  const reqHeaders = parseHeaderArgs(subOpts.header);
  const body = readBodyArg(subOpts.data);
  if (body && !reqHeaders.has('content-type') && looksLikeJson(body)) {
    reqHeaders.set('content-type', 'application/json');
  }

  // First request without a wallet: no keystore prompt unless the server actually wants payment.
  const initial = await runRequest(verb as HttpVerb, url, { headers: reqHeaders, body });
  if (initial.status !== 402) {
    emit(initial, null, !!opts.json, !!subOpts.include);
    process.exit(initial.status >= 400 ? 1 : 0);
  }

  const cfg = resolveConfig(opts);
  const account = await requireAccount(cfg, opts.privateKey);
  const network = resolveNetwork(cfg.network, {
    rpcUrl: cfg.rpcUrl,
    asset: cfg.sbcAddress ? { address: cfg.sbcAddress } : undefined,
  });
  const { decimals, symbol } = network.asset;

  // Hand the 402 we already have to the SDK instead of asking the server twice.
  let replayed = false;
  const replayFirst: typeof fetch = async (input, init) => {
    if (!replayed) {
      replayed = true;
      return new Response(initial.body as BodyInit, { status: initial.status, headers: initial.headers });
    }
    return fetch(input, init);
  };

  let offer: PaymentOffer | undefined;
  let refusal: Refusal | undefined;

  const payFetch = createRadiusFetch({
    network,
    signer: account,
    // The policy (threshold / prompt / refuse) lives in onPaymentRequired; no SDK-side cap.
    maxPerRequest: { amount: maxUint256.toString() },
    fetch: replayFirst,
    onPaymentRequired: async (o) => {
      offer = o;
      const isUpto = o.requirements.scheme === 'upto';
      const amount = BigInt(o.amount);
      const amountStr = formatUnits(amount, decimals);
      const balance = await payFetch.balance();
      if (balance.atomic < amount) {
        refusal = { kind: 'insufficient-balance' };
        process.stderr.write(
          `x402: insufficient balance. Need ${isUpto ? 'up to ' : ''}${amountStr} ${symbol}, ` +
            `have ${balance.formatted}.\n`,
        );
        return false;
      }
      const decision: PayDecision = decidePayment(subOpts, amount, decimals, !!process.stdin.isTTY);
      if (decision === 'refuse-no-tty') {
        refusal = { kind: 'no-tty' };
        writeChallengeSummary(o, amountStr, symbol, balance.formatted, isUpto);
        return false;
      }
      if (decision === 'prompt') {
        const verbText = isUpto ? `Authorize up to ${amountStr}` : `Pay ${amountStr}`;
        const proceed = await confirm({
          message: `${verbText} ${symbol} to ${o.payTo}? (balance: ${balance.formatted})`,
          default: false,
        });
        if (!proceed) {
          refusal = { kind: 'declined' };
          process.stderr.write('x402: payment declined.\n');
          return false;
        }
      }
      return true;
    },
    onApprovalRequired: async (req: ApprovalRequest) => {
      if (subOpts.yes || subOpts.x402ApprovePermit2) return true;
      const need = formatUnits(BigInt(req.offer.amount), decimals);
      const have = formatUnits(req.currentAllowance, decimals);
      if (!process.stdin.isTTY) {
        refusal = { kind: 'approval-no-tty' };
        process.stderr.write(
          `x402: this payment requires a Permit2 approval for ${symbol} (have ${have}, need ${need}) ` +
            'and the server does not sponsor it. Re-run with --x402-approve-permit2 (or -y) to grant ' +
            'a one-time unlimited approval.\n',
        );
        return false;
      }
      const proceed = await confirm({
        message:
          `Grant Permit2 (${req.spender}) an unlimited ${symbol} approval? ` +
          `One-time setup; this payment needs ${need} ${symbol}, and every payment still ` +
          'requires its own signed authorization.',
        default: false,
      });
      if (!proceed) {
        refusal = { kind: 'approval-declined' };
        process.stderr.write('x402: Permit2 approval declined.\n');
      }
      return proceed;
    },
  });

  let res: Response;
  try {
    const hasBody = body !== undefined && method !== 'GET' && method !== 'HEAD';
    res = await payFetch(url, {
      method,
      headers: reqHeaders,
      body: hasBody ? (body as BodyInit) : undefined,
    });
  } catch (e) {
    if (!(e instanceof RadiusPaymentError)) throw e;
    process.exit(reportPaymentError(e, refusal, offer, network.network, !!opts.json, symbol, decimals));
  }

  const paid: HttpResponse = {
    status: res.status,
    headers: res.headers,
    body: await readCappedBody(res),
    contentType: res.headers.get('content-type'),
  };

  if (paid.status === 412) {
    process.stderr.write(
      'x402: facilitator rejected the payment — Permit2 allowance required (412). ' +
        'Re-run with --x402-approve-permit2 to grant it.\n',
    );
    process.stderr.write(safeBodyPreview(paid.body));
    process.exit(1);
  }

  if (!offer) {
    // The SDK only retries after onPaymentRequired approved an offer.
    process.stderr.write('x402: internal error: response returned without an approved offer.\n');
    process.exit(1);
  }

  const receipt = getPaymentReceipt(res, network);
  const summary = summarize(offer, receipt, paid.status, account.address, symbol, decimals);

  if (paid.status >= 200 && paid.status < 300 && !summary.paid) {
    process.stderr.write(
      'x402: HTTP request succeeded, but payment settlement was not confirmed by a successful payment response.\n',
    );
  }

  emit(paid, summary, !!opts.json, !!subOpts.include);
  process.exit(paid.status >= 400 ? 1 : 0);
}

function summarize(
  offer: PaymentOffer,
  receipt: PaymentReceipt | undefined,
  status: number,
  fallbackPayer: Address,
  symbol: string,
  decimals: number,
): PaymentSummary {
  // For upto the facilitator reports what it actually charged (validated by the SDK); exact charges the offer.
  const settled = BigInt(receipt?.amount ?? offer.amount);
  return {
    paid: status >= 200 && status < 300 && receipt?.success === true,
    scheme: offer.requirements.scheme,
    asset: offer.asset,
    assetSymbol: symbol,
    amount: formatUnits(settled, decimals),
    amountWei: settled.toString(),
    payTo: offer.payTo,
    txHash: receipt?.transaction || undefined,
    payer: receipt?.payer ?? fallbackPayer,
  };
}

/** Print a payment failure the way the CLI always has, and return the exit code. */
function reportPaymentError(
  e: RadiusPaymentError,
  refusal: Refusal | undefined,
  offer: PaymentOffer | undefined,
  network: string,
  json: boolean,
  symbol: string,
  decimals: number,
): number {
  const err = process.stderr;
  switch (e.code) {
    case 'invalid_challenge':
      err.write(`x402: server returned 402 but the body is not a valid challenge: ${e.message}\n`);
      return 2;
    case 'network_mismatch':
    case 'asset_mismatch':
    case 'unsupported_transfer_method':
    case 'no_compatible_offer':
      err.write(
        `x402: no compatible payment option for network=${network} / ${symbol}. ` +
          `Supported: ${describeSupportedSchemes()}. ${e.message}\n`,
      );
      return 1;
    case 'declined':
      // The hooks already explained themselves on stderr.
      return refusal?.kind === 'no-tty' ? 2 : 1;
    case 'payment_rejected': {
      err.write('x402: server still returned 402 after payment.\n');
      const detail = e.details as { error?: string } | undefined;
      if (detail?.error) err.write(`reason: ${detail.error}\n`);
      if (json && offer) {
        console.log(
          jsonStringify({
            status: 402,
            headers: {},
            body: '',
            bodyEncoding: 'utf8',
            payment: summarize(offer, undefined, 402, offer.requirements.payTo as Address, symbol, decimals),
          }),
        );
      }
      return 1;
    }
    case 'redirect_refused':
      err.write('x402: server redirected the paid request cross-origin; refusing to replay the payment header.\n');
      return 1;
    default:
      err.write(`x402: ${e.message}\n`);
      return 1;
  }
}

function writeChallengeSummary(
  offer: PaymentOffer,
  amount: string,
  symbol: string,
  balanceStr: string,
  isUpto: boolean,
): void {
  const lead = isUpto
    ? `payment required (authorize up to ${amount} ${symbol}, charged on use, to ${offer.payTo}).`
    : `payment required (${amount} ${symbol} to ${offer.payTo}).`;
  process.stderr.write(
    [
      `x402: ${lead}`,
      `      balance: ${balanceStr}`,
      `      pass --x402-threshold ${amount} (or higher) to auto-pay, or --yes to confirm.`,
      '',
    ].join('\n'),
  );
}

function emit(res: HttpResponse, payment: PaymentSummary | null, json: boolean, include: boolean): void {
  if (json) {
    console.log(jsonStringify(envelope(res, payment)));
    return;
  }
  if (include) {
    process.stderr.write(`HTTP ${res.status}\n`);
    res.headers.forEach((v, k) => { process.stderr.write(`${k}: ${v}\n`); });
    process.stderr.write('\n');
  }
  if (payment?.paid) {
    const tag = payment.assetSymbol ?? payment.asset;
    const tx = payment.txHash ? ` (tx ${payment.txHash})` : '';
    process.stderr.write(`x402: paid ${payment.amount} ${tag}${tx}\n`);
  }
  process.stdout.write(res.body);
}

function envelope(res: HttpResponse, payment: PaymentSummary | null): Record<string, unknown> {
  const decoded = decodeBodyAsUtf8(res.body);
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  return {
    status: res.status,
    headers,
    body: decoded ?? Buffer.from(res.body).toString('base64'),
    bodyEncoding: decoded === null ? 'base64' : 'utf8',
    payment,
  };
}

function safeBodyPreview(body: Uint8Array): string {
  const s = decodeBodyAsUtf8(body) ?? '';
  const trimmed = s.length > 1024 ? s.slice(0, 1024) + '\n…(truncated)' : s;
  return trimmed.endsWith('\n') ? trimmed : trimmed + '\n';
}
