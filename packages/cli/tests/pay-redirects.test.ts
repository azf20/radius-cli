import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runRequest } from '../src/lib/http.js';

// A real server: `/a` -> `/b` -> `/pay` (402), and `/post` -> 307 -> `/echo`.
let server: Server;
let base: string;
beforeAll(async () => {
  server = createServer((req, res) => {
    const hops: Record<string, [number, string]> = { '/a': [302, '/b'], '/b': [302, '/pay'], '/post': [307, '/pay'] };
    const hop = hops[req.url ?? ''];
    if (hop) return void res.writeHead(hop[0], { location: hop[1] }).end();
    res.writeHead(402).end(req.method);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => server.close());

const run = (path: string, maxRedirects: number, verb: 'get' | 'post' = 'get') =>
  runRequest(verb, base + path, { headers: new Headers(), body: verb === 'post' ? new TextEncoder().encode('{}') : undefined, maxRedirects });

describe('runRequest redirects', () => {
  it('returns the 402 at the final URL together with the request that drew it', async () => {
    const res = await run('/a', 2);
    expect([res.status, res.request.url]).toEqual([402, `${base}/pay`]);
  });

  it('fails past the limit and says so', async () => {
    await expect(run('/a', 1)).rejects.toThrow(/Too many redirects.*limit of 1/);
  });

  it('follows nothing with 0 and hands the redirect back', async () => {
    expect((await run('/a', 0)).status).toBe(302);
  });

  it('keeps the method and body on 307', async () => {
    const res = await run('/post', 1, 'post');
    expect([res.request.method, new TextDecoder().decode(res.body), await res.request.text()]).toEqual(['POST', 'POST', '{}']);
  });
});
