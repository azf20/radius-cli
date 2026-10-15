// A local origin for proxy tests: echoes what it received; `/gz` gzips when asked, `/redirect` answers 302.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { vi } from 'vitest';
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from '@x402/core/http';

export interface Echo { method?: string; url?: string; headers: Record<string, string | string[] | undefined>; body: string }

export async function startEchoOrigin(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      if (req.url === '/redirect') {
        res.writeHead(302, { location: '/elsewhere' }).end();
        return;
      }
      const echo = JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() } satisfies Echo);
      const gzip = req.url?.startsWith('/gz') && /gzip/.test(String(req.headers['accept-encoding'] ?? ''));
      res.writeHead(200, { 'content-type': 'application/json', 'x-origin': '1', ...(gzip ? { 'content-encoding': 'gzip' } : {}) });
      res.end(gzip ? gzipSync(echo) : echo);
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

/** Mock the facilitator's /verify and /settle; every other fetch goes out for real. Returns the /settle calls. */
export function mockFacilitator(realFetch: typeof fetch): string[] {
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

/** A `PAYMENT-SIGNATURE` for the first offer of a 402 (the facilitator is mocked, so the signature is not checked). */
export function paymentFor(challenge: Response): string {
  const pr = decodePaymentRequiredHeader(challenge.headers.get('payment-required')!);
  return encodePaymentSignatureHeader({ x402Version: 2, resource: pr.resource, accepted: pr.accepts[0], payload: { signature: '0xsig', permit2Authorization: {} } });
}
