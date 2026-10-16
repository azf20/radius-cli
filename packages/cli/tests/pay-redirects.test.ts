import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, it } from 'vitest';
import { runRequest } from '../src/lib/http.js';

it('reports the URL that answered 402 after fetch followed a redirect, for the paid retry to target', async () => {
  const server = createServer((req, res) => void (req.url === '/r' ? res.writeHead(302, { location: '/final' }) : res.writeHead(402)).end());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const res = await runRequest('get', `${base}/r`, { headers: new Headers() });
    expect([res.status, res.url]).toEqual([402, `${base}/final`]);
  } finally {
    server.close();
  }
});

it('keeps the verb and body through a 307, for the paid retry to replay', async () => {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c)).on('end', () => {
      seen.push(`${req.method} ${req.url} ${body}`);
      (req.url === '/r' ? res.writeHead(307, { location: '/final' }) : res.writeHead(402)).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const res = await runRequest('post', `${base}/r`, { headers: new Headers(), body: new TextEncoder().encode('{"a":1}') });
    expect([res.status, res.url]).toEqual([402, `${base}/final`]);
    expect(seen).toEqual(['POST /r {"a":1}', 'POST /final {"a":1}']);
  } finally {
    server.close();
  }
});
