// proxyTo behind Hono on @hono/node-server, which replaces the global `Response` (own file for that reason).
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { proxyTo, radiusPayments } from '../src/hono/index.js';
import { getPaymentReceipt } from '../src/receipt.js';
import { mockFacilitator, paymentFor, startEchoOrigin, type Echo } from './fixtures/echoOrigin.js';

const PAY_TO = '0x1eF420190c299D4d133fE9227F780D7d5cE91BeE';
const realFetch = globalThis.fetch;
let origin: Awaited<ReturnType<typeof startEchoOrigin>>;
let seller: { url: string; close: () => Promise<void> };

beforeAll(async () => {
  origin = await startEchoOrigin();
  const app = new Hono();
  const toOrigin = proxyTo(origin.url);
  app.use(radiusPayments({ network: 'testnet', payTo: PAY_TO, facilitator: { live: false }, routes: { 'POST /v1/score': '$0.01', 'GET /v1/reports/*': '$0.001' } }));
  app.all('/*', (c) => toOrigin(c.req.raw));
  const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
  await new Promise<void>((done) => server.once('listening', () => done()));
  seller = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise<void>((done) => server.close(() => done())) };
});
afterAll(async () => { await seller.close(); await origin.close(); });
afterEach(() => vi.restoreAllMocks());

describe('proxyTo on @hono/node-server', () => {
  it('forwards a paid POST with its body and query, without the payment header, and returns the receipt', async () => {
    const settles = mockFacilitator(realFetch);
    const post = (headers: Record<string, string> = {}) =>
      realFetch(`${seller.url}/v1/score?v=2`, { method: 'POST', body: '{"x":1}', headers: { 'content-type': 'application/json', ...headers } });
    const challenge = await post();
    expect(challenge.status).toBe(402);
    const res = await post({ 'payment-signature': paymentFor(challenge) });
    expect(res.status).toBe(200);
    const echo = (await res.json()) as Echo;
    expect(echo).toMatchObject({ method: 'POST', url: '/v1/score?v=2', body: '{"x":1}' });
    expect(echo.headers).not.toHaveProperty('payment-signature');
    expect(res.headers.get('cache-control')).toContain('private');
    expect(getPaymentReceipt(res)).toMatchObject({ success: true, transaction: '0xdeadbeef' });
    expect(settles).toHaveLength(1);
  });

  it('passes free routes through with their Authorization, and survives a large POST (Expect: 100-continue)', async () => {
    const token = (await (await realFetch(`${seller.url}/token`, { method: 'POST', body: 'grant_type=x', headers: { authorization: 'Bearer t' } })).json()) as Echo;
    expect(token).toMatchObject({ method: 'POST', body: 'grant_type=x', headers: { authorization: 'Bearer t' } });
    const discovery = await realFetch(`${seller.url}/.well-known/x402`);
    expect(discovery.status).toBe(200);
    // Clients and proxies may send `Expect: 100-continue` on uploads; Node's fetch throws if it is forwarded.
    const body = 'x'.repeat(2048);
    const large = await new Promise<{ status?: number; echo: Echo }>((done, fail) => {
      const req = httpRequest(`${seller.url}/upload`, { method: 'POST', headers: { expect: '100-continue', 'content-length': body.length } }, (res) => {
        let text = '';
        res.on('data', (c) => { text += c; }).on('end', () => done({ status: res.statusCode, echo: JSON.parse(text) as Echo }));
      });
      req.on('error', fail).on('continue', () => req.end(body));
    });
    expect(large.status).toBe(200);
    expect(large.echo.body).toHaveLength(2048);
    expect(large.echo.headers).not.toHaveProperty('expect');
  });

  it('serves a gzipping origin with a body that matches its headers', async () => {
    const res = await realFetch(`${seller.url}/gz`);           // undici asks for gzip by default
    expect(res.status).toBe(200);
    expect(((await res.json()) as Echo).url).toBe('/gz');
  });
});
