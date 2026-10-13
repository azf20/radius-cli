import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { generatePrivateKey } from 'viem/accounts';
import { resolveNetwork } from 'radius-sdk';
import { radiusPayments, type RadiusPaymentsOptions } from 'radius-sdk/server';
import { checkSeller, type SellCheckReport } from '../src/lib/sellCheck.js';

// A real radius-sdk seller over loopback HTTP, a mock facilitator and a mock JSON-RPC node. Nothing
// leaves the machine; "settlement" is the mock facilitator saying so.

const TESTNET = resolveNetwork('testnet');
const BASE_SEPOLIA = resolveNetwork('base-sepolia');
const PAY_TO = '0x1eF420190c299D4d133fE9227F780D7d5cE91BeE';
const MPP_SECRET = 'sell-check-test-secret-0123456789abcdef';

interface Listening { url: string; close: () => Promise<void> }

function listen(server: Server): Promise<Listening> {
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      done({ url: `http://127.0.0.1:${port}`, close: () => new Promise((closed) => { server.closeAllConnections(); server.close(() => closed()); }) });
    });
  });
}

const open: Listening[] = [];
afterEach(async () => {
  for (const s of open.splice(0)) await s.close();
});

/** `/supported` lists `kinds` ([network, transfer method]); `/settle` always succeeds; counts settles. */
async function facilitator(kinds: [string, string][], extensions = ['eip2612GasSponsoring']) {
  const state = { settles: 0, url: '' };
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const send = (body: unknown) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.url === '/supported') {
      send({ kinds: kinds.map(([network, assetTransferMethod]) => ({ x402Version: 2, scheme: 'exact', network, extra: { assetTransferMethod } })), extensions, signers: {} });
      return;
    }
    const { paymentRequirements } = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    if (req.url === '/verify') { send({ isValid: true, payer: PAY_TO }); return; }
    state.settles++;
    send({ success: true, transaction: `0x${String(state.settles).padStart(64, '0')}`, network: paymentRequirements?.network, payer: '0x00000000000000000000000000000000000a11ce' });
  });
  const l = await listen(server);
  open.push(l);
  state.url = l.url;
  return state;
}

/** Serve a radius-sdk seller: `GET /api/report` paid, `GET /health` free. */
async function seller(options: Partial<RadiusPaymentsOptions>, transform?: (res: Response) => Response | Promise<Response>) {
  const pay = radiusPayments({ network: 'testnet', payTo: PAY_TO, routes: { 'GET /api/report': { price: '$0.001', description: 'Report' } }, ...options } as RadiusPaymentsOptions);
  const app = pay.wrap((request) => (new URL(request.url).pathname === '/health' || new URL(request.url).pathname === '/api/report'
    ? Response.json({ report: 'quarterly-sales' })
    : new Response('not found', { status: 404 })));
  const server = createServer(async (req, res) => {
    let response = await app(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers as Record<string, string> }));
    if (transform) response = await transform(response);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  const l = await listen(server);
  open.push(l);
  return l.url;
}

let rpc: Listening;
beforeAll(async () => {
  // eth_chainId and a large balanceOf, enough for the --pay balance check.
  rpc = await listen(createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = JSON.parse(Buffer.concat(chunks).toString());
    const answer = (call: { id: number; method: string }) => ({
      jsonrpc: '2.0', id: call.id,
      result: call.method === 'eth_chainId' ? `0x${TESTNET.chainId.toString(16)}` : `0x${(10n ** 12n).toString(16).padStart(64, '0')}`,
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(Array.isArray(raw) ? raw.map(answer) : answer(raw)));
  }));
});
afterAll(() => rpc.close());

const statusOf = (report: SellCheckReport, id: string) => report.checks.find((c) => c.id === id)?.status;
const failed = (report: SellCheckReport) => report.checks.filter((c) => c.status === 'fail').map((c) => c.id);
const radiusKinds: [string, string][] = [[TESTNET.network, 'eip3009'], [TESTNET.network, 'permit2']];

describe('radius-cli sell check', () => {
  it('passes a correct radius-sdk seller and reads its MPP challenge', async () => {
    const fac = await facilitator(radiusKinds);
    const url = `${await seller({ facilitator: { url: fac.url }, mpp: { secretKey: MPP_SECRET } })}/api/report`;
    const report = await checkSeller({ url, price: '$0.001', facilitators: [fac.url] });
    expect(failed(report)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.offers).toMatchObject([{ scheme: 'exact', network: TESTNET.network, amount: '1000', amountFormatted: '0.001 SBC', transferMethod: 'eip3009' }]);
    for (const id of ['status', 'cache', 'x402', 'resource', 'offer[0].asset', 'offer[0].domain', 'offer[0].amount', 'offer[0].payTo', 'offer[0].maxTimeoutSeconds', 'offer[0].facilitator', 'mpp', 'mpp[0].challenge', 'mpp[0].mirror', 'buyer.x402', 'buyer.mpp']) {
      expect(statusOf(report, id), id).toBe('pass');
    }
    expect(report.facilitators[fac.url]?.ok).toBe(true);
    expect(fac.settles).toBe(0);
  });

  it('reports a seller without MPP as information, not a failure', async () => {
    const fac = await facilitator(radiusKinds);
    const report = await checkSeller({ url: `${await seller({ facilitator: { url: fac.url } })}/api/report`, facilitators: [fac.url] });
    expect(report.ok).toBe(true);
    expect(statusOf(report, 'mpp')).toBe('info');
    expect(report.mpp).toEqual([]);
    expect(statusOf(report, 'buyer.mpp')).toBeUndefined();
  });

  it('fails an amount priced with the wrong decimals, and names them', async () => {
    const fac = await facilitator(radiusKinds);
    const url = `${await seller({ facilitator: { url: fac.url }, asset: { decimals: 18 }, mpp: { secretKey: MPP_SECRET } })}/api/report`;
    const report = await checkSeller({ url, price: '$0.001', facilitators: [fac.url] });
    expect(report.ok).toBe(false);
    const amount = report.checks.find((c) => c.id === 'offer[0].amount')!;
    expect(amount.status).toBe('fail');
    expect(amount.message).toMatch(/1000000000000000.*18 decimals.*SBC has 6/);
    expect(report.checks.find((c) => c.id === 'mpp[0].challenge')?.message).toMatch(/decimals 18, but SBC has 6/);
    // A --price finer than the asset's decimals is a failed check, not a crash.
    const fine = await checkSeller({ url, price: '$0.0000001', facilitators: [fac.url] });
    expect(fine.checks.find((c) => c.id === 'offer[0].amount')?.message).toMatch(/cannot be priced in SBC/);
    // Without --price, the absurd per-request amount is still flagged.
    const loose = await checkSeller({ url, facilitators: [fac.url] });
    expect(statusOf(loose, 'offer[0].amount')).toBe('warn');
  });

  it('fails an offer in another asset than the network’s', async () => {
    const fac = await facilitator(radiusKinds);
    const url = `${await seller({ facilitator: { url: fac.url }, asset: { address: '0x000000000000000000000000000000000000dEaD' } })}/api/report`;
    const report = await checkSeller({ url, facilitators: [fac.url] });
    expect(report.ok).toBe(false);
    expect(statusOf(report, 'offer[0].asset')).toBe('fail');
    expect(report.checks.find((c) => c.id === 'buyer.x402')?.message).toMatch(/asset_mismatch/);
  });

  it('fails when the facilitator does not support the offered network or transfer method', async () => {
    const sellerFac = await facilitator(radiusKinds);
    const url = `${await seller({ facilitator: { url: sellerFac.url } })}/api/report`;
    const otherNetwork = await facilitator([[BASE_SEPOLIA.network, 'eip3009']]);
    const report = await checkSeller({ url, facilitators: [otherNetwork.url] });
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.id === 'offer[0].facilitator')?.message).toMatch(/does not support eip155:72344 at all/);
    const permit2Only = await facilitator([[TESTNET.network, 'permit2']]);
    const methodReport = await checkSeller({ url, facilitators: [permit2Only.url] });
    expect(methodReport.checks.find((c) => c.id === 'offer[0].facilitator')?.message).toMatch(/does not support exact\/eip3009/);
    const unreachable = await checkSeller({ url, facilitators: ['http://127.0.0.1:9'], timeoutMs: 2000 });
    expect(statusOf(unreachable, 'offer[0].facilitator')).toBe('fail');
  });

  it('fails when the route answers without a 402', async () => {
    const fac = await facilitator(radiusKinds);
    const report = await checkSeller({ url: `${await seller({ facilitator: { url: fac.url } })}/health`, facilitators: [fac.url] });
    expect(report.ok).toBe(false);
    expect(report.status).toBe(200);
    expect(report.checks).toEqual([expect.objectContaining({ id: 'status', status: 'fail', message: expect.stringMatching(/served without payment/) })]);
  });

  it('fails a challenge bound to another resource or paying a zero address', async () => {
    const fac = await facilitator(radiusKinds);
    const url = `${await seller({ facilitator: { url: fac.url } }, (res) => {
      if (res.status !== 402) return res;
      const challenge = JSON.parse(Buffer.from(res.headers.get('payment-required')!, 'base64').toString());
      challenge.resource.url = 'http://127.0.0.1/somewhere-else';
      challenge.accepts[0].payTo = '0x0000000000000000000000000000000000000000';
      const headers = new Headers(res.headers);
      headers.set('payment-required', Buffer.from(JSON.stringify(challenge)).toString('base64'));
      return new Response(null, { status: 402, headers });
    })}/api/report`;
    const report = await checkSeller({ url, facilitators: [fac.url] });
    expect(failed(report)).toEqual(expect.arrayContaining(['resource', 'offer[0].payTo']));
  });

  it('warns when an unpaid HEAD is served', async () => {
    const fac = await facilitator(radiusKinds);
    const report = await checkSeller({ url: `${await seller({ facilitator: { url: fac.url } })}/api/report`, facilitators: [fac.url], probeHead: true });
    expect(statusOf(report, 'head')).toBe('warn');
    expect(report.ok).toBe(true);
  });

  it('--pay makes one payment within the threshold and checks the receipt', async () => {
    const fac = await facilitator(radiusKinds);
    const url = `${await seller({ facilitator: { url: fac.url } })}/api/report`;
    const networks = [resolveNetwork('testnet', { rpcUrl: rpc.url })];
    const report = await checkSeller({ url, facilitators: [fac.url], pay: { networks, signer: generatePrivateKey(), threshold: '0.01' } });
    expect(failed(report)).toEqual([]);
    expect(statusOf(report, 'pay')).toBe('pass');
    expect(statusOf(report, 'pay.receipt')).toBe('pass');
    expect(report.payment).toMatchObject({ paid: true, status: 200, protocol: 'x402', network: TESTNET.network });
    expect(fac.settles).toBe(1);

    const over = await checkSeller({ url, facilitators: [fac.url], pay: { networks, signer: generatePrivateKey(), threshold: '0.0001' } });
    expect(over.ok).toBe(false);
    expect(over.checks.find((c) => c.id === 'pay')?.message).toMatch(/exceeds --threshold 0.0001/);
    expect(fac.settles).toBe(1);
  });
});
