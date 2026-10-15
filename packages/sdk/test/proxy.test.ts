import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { proxyTo, radiusPayments } from '../src/server/index.js';
import { getPaymentReceipt } from '../src/receipt.js';
import { mockFacilitator, paymentFor, startEchoOrigin, type Echo } from './fixtures/echoOrigin.js';

const PAY_TO = '0x1eF420190c299D4d133fE9227F780D7d5cE91BeE';
const realFetch = globalThis.fetch;
let origin: Awaited<ReturnType<typeof startEchoOrigin>>;
beforeAll(async () => { origin = await startEchoOrigin(); });
afterAll(() => origin.close());
afterEach(() => vi.restoreAllMocks());

describe('proxyTo', () => {
  it('keeps method, path and query, and appends the path to the origin path', async () => {
    const echo = (await (await proxyTo(origin.url)(new Request('http://seller.test/a/b?x=1&y=2'))).json()) as Echo;
    expect(echo).toMatchObject({ method: 'GET', url: '/a/b?x=1&y=2' });
    const prefixed = (await (await proxyTo(`${origin.url}/base/`)(new Request('http://seller.test/a?q'))).json()) as Echo;
    expect(prefixed.url).toBe('/base/a?q');
  });

  it('never leaves the origin for a path that looks like another host', async () => {
    const echo = (await (await proxyTo(origin.url)(new Request('http://seller.test//evil.test/x'))).json()) as Echo;
    expect(echo.url).toBe('//evil.test/x');
    expect(echo.headers.host).toBe(new URL(origin.url).host);
  });

  it('buffers the body and drops host, hop-by-hop headers and payment credentials, but not other Authorization', async () => {
    const forward = proxyTo(origin.url);
    const sent = new Request('http://seller.test/v1/score', {
      method: 'POST',
      body: '{"x":1}',
      headers: { 'content-type': 'application/json', 'payment-signature': 'sig', 'x-payment': 'v1', authorization: 'Payment abc', 'keep-alive': 'timeout=5', expect: '100-continue', connection: 'x-drop', 'x-drop': '1', 'x-keep': '1' },
    });
    const echo = (await (await forward(sent)).json()) as Echo;
    expect(echo).toMatchObject({ method: 'POST', body: '{"x":1}' });
    expect(echo.headers).toMatchObject({ 'content-type': 'application/json', 'x-keep': '1', 'accept-encoding': 'identity' });
    for (const name of ['payment-signature', 'x-payment', 'authorization', 'keep-alive', 'expect', 'x-drop']) expect(echo.headers).not.toHaveProperty(name);
    expect(echo.headers.host).toBe(new URL(origin.url).host);

    const bearer = (await (await forward(new Request('http://seller.test/token', { method: 'POST', body: 'a=1', headers: { authorization: 'Bearer t' } }))).json()) as Echo;
    expect(bearer).toMatchObject({ body: 'a=1', headers: { authorization: 'Bearer t' } });
  });

  it('asks a compressing origin for an identity body, so Content-Encoding matches the body', async () => {
    const res = await proxyTo(origin.url)(new Request('http://seller.test/gz', { headers: { 'accept-encoding': 'gzip' } }));
    expect(res.headers.get('content-encoding')).toBeNull();
    expect(((await res.json()) as Echo).url).toBe('/gz');
  });

  it('returns redirects instead of following them, with mutable headers', async () => {
    const res = await proxyTo(origin.url)(new Request('http://seller.test/redirect'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/elsewhere');
    expect(() => res.headers.set('x-added', '1')).not.toThrow();
  });

  it('serves as the paid handler of radiusPayments: the origin gets the body, not the payment', async () => {
    const settles = mockFacilitator(realFetch);
    const pay = radiusPayments({ network: 'testnet', payTo: PAY_TO, facilitator: { live: false }, routes: { 'POST /v1/score': '$0.01' } });
    const forward = proxyTo(origin.url);
    const post = (headers: Record<string, string> = {}) => new Request('http://seller.test/v1/score?v=2', { method: 'POST', body: '{"x":1}', headers });
    const challenge = await pay(post(), forward);
    expect(challenge.status).toBe(402);
    const res = await pay(post({ 'payment-signature': paymentFor(challenge) }), forward);
    expect(res.status).toBe(200);
    const echo = (await res.json()) as Echo;
    expect(echo).toMatchObject({ method: 'POST', url: '/v1/score?v=2', body: '{"x":1}' });
    expect(echo.headers).not.toHaveProperty('payment-signature');
    expect(res.headers.get('x-origin')).toBe('1');
    expect(getPaymentReceipt(res)).toMatchObject({ success: true, transaction: '0xdeadbeef' });
    expect(settles).toHaveLength(1);
  });
});
