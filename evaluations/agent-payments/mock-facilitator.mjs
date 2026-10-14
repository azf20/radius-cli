/**
 * Local stand-in for an x402 facilitator (`/supported`, `/verify`, `/settle`) for the seller suite.
 * It checks what a real facilitator checks before moving funds (the payment matches the
 * requirements, the authorization is in its validity window, its EIP-712 signature recovers to the
 * payer) and keeps a ledger of consumed authorization nonces, so a second settlement of the same
 * authorization fails the way `transferWithAuthorization` / Permit2 would revert on chain.
 * Nothing touches a network: `settled` entries are simulated.
 */
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { verifySignedPayment } from './signatures.mjs';

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

/**
 * One facilitator. `networks` lists what `/supported` advertises: `{ network, chainId, methods,
 * extra? }`, where `methods` is the assetTransferMethod order (the seller offers the first).
 * `mode` is mutable per case: `verify` / `settle` are 'ok' | 'reject' | 'hang', and `settle` may
 * also be 'drop-after-submit' (the nonce is consumed, then the connection is cut, as when a
 * facilitator dies after broadcasting).
 */
export function createMockFacilitator({ name, networks, extensions = [] }) {
  const ledger = new Map();
  const state = {
    name, url: undefined, mode: { verify: 'ok', settle: 'ok' },
    calls: { supported: 0, verify: 0, settle: 0 },
    /** Successful settlements (simulated), in order. */
    settled: [],
    /** Every /verify and /settle answer, for the report. */
    log: [],
  };

  /** Check a payment as a facilitator would; returns `{ ok, reason, payer, check }`. */
  const evaluate = async (paymentPayload, requirements) => {
    const target = networks.find((n) => n.network === requirements?.network);
    if (!target) return { ok: false, reason: 'unsupported_network' };
    const accepted = paymentPayload?.accepted ?? {};
    for (const field of ['scheme', 'network', 'asset', 'payTo', 'amount']) {
      if (!same(accepted[field], requirements[field])) return { ok: false, reason: `accepted_${field}_mismatch` };
    }
    let check;
    try {
      check = await verifySignedPayment({ requirements, payload: paymentPayload.payload ?? {}, chainId: target.chainId });
    } catch (error) {
      return { ok: false, reason: 'invalid_authorization', message: error.message };
    }
    if (!check.valid) return { ok: false, reason: 'invalid_signature', payer: check.payer };
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (check.validAfter > now || check.validBefore <= now) return { ok: false, reason: 'authorization_expired', payer: check.payer };
    if (ledger.has(check.replayKey)) return { ok: false, reason: 'nonce_already_used', payer: check.payer };
    return { ok: true, payer: check.payer, check };
  };

  const settle = async (paymentPayload, requirements) => {
    let result = await evaluate(paymentPayload, requirements);
    // Re-check and consume the nonce in one synchronous step, as the chain would: a concurrent duplicate fails.
    if (result.ok && ledger.has(result.check.replayKey)) result = { ok: false, reason: 'nonce_already_used', payer: result.payer };
    if (!result.ok) return { result, response: { success: false, errorReason: result.reason, transaction: '', network: requirements?.network, payer: result.payer } };
    const transaction = `0x${createHash('sha256').update(`${state.name}:${result.check.replayKey}`).digest('hex')}`;
    ledger.set(result.check.replayKey, transaction);
    const entry = { network: requirements.network, payTo: requirements.payTo, amount: requirements.amount, payer: result.payer,
      method: result.check.method, transaction, simulatedSettlement: true };
    state.settled.push(entry);
    return { result, response: { success: true, transaction, network: requirements.network, payer: result.payer } };
  };

  const supported = () => ({
    kinds: networks.flatMap((n) => n.methods.map((assetTransferMethod) => ({
      x402Version: 2, scheme: 'exact', network: n.network, extra: { assetTransferMethod, ...n.extra },
    }))),
    extensions,
    signers: {},
  });

  /** The same checks as an in-process `FacilitatorClient` (for a custom-client case). */
  state.client = {
    getSupported: async () => { state.calls.supported++; return supported(); },
    verify: async (payload, requirements) => {
      state.calls.verify++;
      const r = await evaluate(payload, requirements);
      return { isValid: r.ok, invalidReason: r.ok ? undefined : r.reason, payer: r.payer };
    },
    settle: async (payload, requirements) => { state.calls.settle++; return (await settle(payload, requirements)).response; },
  };

  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    const path = new URL(req.url, 'http://facilitator').pathname;
    if (req.method === 'GET' && path === '/supported') { state.calls.supported++; send(200, supported()); return; }
    if (req.method !== 'POST' || (path !== '/verify' && path !== '/settle')) { send(404, { error: 'not found' }); return; }
    const op = path.slice(1);
    state.calls[op]++;
    const mode = state.mode[op];
    if (mode === 'hang') return; // never answers; the seller's timeout decides
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { send(400, { error: 'invalid json' }); return; }
    const { paymentPayload, paymentRequirements } = body;
    if (op === 'verify') {
      const r = mode === 'reject' ? { ok: false, reason: 'insufficient_funds' } : await evaluate(paymentPayload, paymentRequirements);
      state.log.push({ op, ok: r.ok, reason: r.reason });
      send(200, { isValid: r.ok, invalidReason: r.ok ? undefined : r.reason, payer: r.payer });
      return;
    }
    if (mode === 'reject') {
      state.log.push({ op, ok: false, reason: 'insufficient_funds' });
      send(200, { success: false, errorReason: 'insufficient_funds', transaction: '', network: paymentRequirements?.network });
      return;
    }
    const { result, response } = await settle(paymentPayload, paymentRequirements);
    state.log.push({ op, ok: result.ok, reason: result.reason });
    if (mode === 'drop-after-submit' && result.ok) { req.socket.destroy(); return; }
    send(200, response);
  });

  state.start = () => new Promise((done) => server.listen(0, '127.0.0.1', () => {
    state.url = `http://127.0.0.1:${server.address().port}`;
    done(state);
  }));
  state.close = () => new Promise((done) => { server.closeAllConnections?.(); server.close(done); });
  /** Clear counters and mode between cases; the nonce ledger persists, as a chain would. */
  state.reset = (mode = {}) => {
    state.mode = { verify: 'ok', settle: 'ok', ...mode };
    state.calls = { supported: 0, verify: 0, settle: 0 };
    state.settled = [];
    state.log = [];
  };
  return state;
}
