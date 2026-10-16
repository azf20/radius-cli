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
