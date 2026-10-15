// Paid responses whose headers are immutable (a `fetch()` response) under @hono/node-server, which
// replaces the global `Response` with one that keeps the Headers object it is given. Own file:
// `serve` swaps the global for every test that runs after it.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve, type ServerType } from '@hono/node-server';
import { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import { radiusPayments } from '../src/hono/index.js';
import { getPaymentReceipt } from '../src/receipt.js';

const PAY_TO = '0x1eF420190c299D4d133fE9227F780D7d5cE91BeE';
const realFetch = globalThis.fetch;
const listening = <T extends Server | ServerType>(server: T) =>
  new Promise<string>((done) => server.once('listening', () => done(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));

let origin: Server;
let originUrl: string;
beforeAll(async () => {
  origin = createServer((req, res) => {
    res.writeHead(req.url === '/missing' ? 404 : 200, { 'content-type': 'application/json', 'x-origin': '1' });
    res.end(JSON.stringify({ data: 'secret', path: req.url }));
  }).listen(0, '127.0.0.1');
  originUrl = await listening(origin);
});
afterAll(() => new Promise<void>((done) => origin.close(() => done())));
afterEach(() => vi.restoreAllMocks());

async function seller(settle: 'before' | 'after') {
  const app = new Hono();
  app.use(radiusPayments({ network: 'testnet', payTo: PAY_TO, facilitator: { live: false }, settle, routes: { 'GET /*': '$0.001' } }));
  app.get('/*', (c) => fetch(originUrl + c.req.path));          // a proxy: the origin's response, headers immutable
  const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
  const url = await listening(server);
  return { url, close: () => new Promise<void>((done) => server.close(() => done())) };
}

function mockFacilitator() {
  const settles: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith('/verify')) return Response.json({ isValid: true, payer: '0xabc' });
    if (url.endsWith('/settle')) {
      settles.push(url);
      return Response.json({ success: true, transaction: '0xdeadbeef', network: 'eip155:72344', payer: '0xabc' });
    }
    return realFetch(input, init);
  });
  return settles;
}

async function pay(url: string) {
  const challenge = await realFetch(url);
  expect(challenge.status).toBe(402);
  const pr = decodePaymentRequiredHeader(challenge.headers.get('payment-required')!);
  const sig = encodePaymentSignatureHeader({
    x402Version: 2,
    resource: pr.resource,
    accepted: pr.accepts[0],
    payload: { signature: '0xsig', permit2Authorization: {} },
  });
  return realFetch(url, { headers: { 'PAYMENT-SIGNATURE': sig } });
}

describe('paid fetch() responses under @hono/node-server', () => {
  for (const settle of ['before', 'after'] as const) {
    it(`serves the origin's response with the receipt (settle: '${settle}')`, async () => {
      const settles = mockFacilitator();
      const s = await seller(settle);
      try {
        const res = await pay(`${s.url}/report`);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ data: 'secret', path: '/report' });
        expect(res.headers.get('x-origin')).toBe('1');
        expect(res.headers.get('cache-control')).toContain('private');
        expect(getPaymentReceipt(res)).toMatchObject({ success: true, transaction: '0xdeadbeef' });
        expect(settles).toHaveLength(1);
      } finally {
        await s.close();
      }
    });
  }

  it("passes an origin 404 through after settling (settle: 'before')", async () => {
    mockFacilitator();
    const s = await seller('before');
    try {
      const res = await pay(`${s.url}/missing`);
      expect(res.status).toBe(404);
      expect(res.headers.get('x-origin')).toBe('1');
      expect(getPaymentReceipt(res)).toMatchObject({ success: true, transaction: '0xdeadbeef' });
    } finally {
      await s.close();
    }
  });
});
