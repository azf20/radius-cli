import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RadiusPaymentError } from 'radius-sdk/client';
import type { HttpVerb } from '../src/lib/http.js';

// config.ts reads RADIUS_HOME at import time, so point it at a scratch directory first.
const home = mkdtempSync(join(tmpdir(), 'radius-cli-pay-redirects-'));
process.env.RADIUS_HOME = home;
const { resolveMaxRedirects } = await import('../src/lib/config.js');
const { runRequest } = await import('../src/lib/http.js');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  writeFileSync(join(home, 'config.json'), '{}');
});

describe('resolveMaxRedirects', () => {
  it('follows one redirect by default', () => {
    expect(resolveMaxRedirects()).toBe(1);
  });

  it('reads RADIUS_MAX_REDIRECTS, then the config file, below the flag', () => {
    writeFileSync(join(home, 'config.json'), JSON.stringify({ maxRedirects: 3 }));
    expect(resolveMaxRedirects()).toBe(3);
    vi.stubEnv('RADIUS_MAX_REDIRECTS', '2');
    expect(resolveMaxRedirects()).toBe(2);
    expect(resolveMaxRedirects('0')).toBe(0);
  });

  it('rejects anything but a non-negative integer, naming where it came from', () => {
    expect(() => resolveMaxRedirects('-1')).toThrow(/--max-redirects must be a non-negative integer/);
    expect(() => resolveMaxRedirects('1.5')).toThrow(/--max-redirects/);
    expect(() => resolveMaxRedirects('many')).toThrow(/--max-redirects/);
    vi.stubEnv('RADIUS_MAX_REDIRECTS', 'x');
    expect(() => resolveMaxRedirects()).toThrow(/RADIUS_MAX_REDIRECTS/);
  });
});

describe('runRequest redirects', () => {
  /** Stub the global fetch: `hops` maps a URL to [status, location]; any other URL answers 402. */
  function stub(hops: Record<string, [number, string?]>) {
    const seen: Request[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      seen.push(req);
      const hop = hops[req.url];
      return hop ? new Response(null, { status: hop[0], headers: hop[1] ? { location: hop[1] } : {} }) : new Response('pay me', { status: 402 });
    });
    return seen;
  }
  const run = (url: string, maxRedirects: number, init: { verb?: HttpVerb; headers?: Headers; body?: Uint8Array } = {}) =>
    runRequest(init.verb ?? 'get', url, { headers: init.headers ?? new Headers(), body: init.body, maxRedirects });

  it('returns the 402 behind a 302 together with the request that drew it', async () => {
    const seen = stub({ 'https://a.example/r': [302, '/final'] });
    const res = await run('https://a.example/r', 1);
    expect(res.status).toBe(402);
    expect(res.request.url).toBe('https://a.example/final');
    expect(seen.map((r) => r.url)).toEqual(['https://a.example/r', 'https://a.example/final']);
  });

  it('fails past the default limit of one, and follows two when told to', async () => {
    const hops: Record<string, [number, string]> = { 'https://a.example/r': [302, '/a'], 'https://a.example/a': [302, '/final'] };
    stub(hops);
    await expect(run('https://a.example/r', 1)).rejects.toSatisfy((e: unknown) => e instanceof RadiusPaymentError && e.code === 'too_many_redirects');
    expect((await run('https://a.example/r', 2)).request.url).toBe('https://a.example/final');
  });

  it('follows nothing with 0 and hands the redirect back', async () => {
    const seen = stub({ 'https://a.example/r': [302, '/final'] });
    const res = await run('https://a.example/r', 0);
    expect(res.status).toBe(302);
    expect(seen).toHaveLength(1);
  });

  it('drops credentials on a cross-origin redirect, keeps them on the same origin', async () => {
    const headers = () => new Headers({ Authorization: 'Bearer s', Cookie: 'a=b', 'X-Api-Key': 'k' });
    const cross = stub({ 'https://a.example/r': [302, 'https://b.example/final'] });
    await run('https://a.example/r', 1, { headers: headers() });
    expect(cross[1].headers.get('authorization')).toBeNull();
    expect(cross[1].headers.get('cookie')).toBeNull();
    expect(cross[1].headers.get('x-api-key')).toBe('k');
    const same = stub({ 'https://a.example/r': [302, '/final'] });
    await run('https://a.example/r', 1, { headers: headers() });
    expect(same[1].headers.get('authorization')).toBe('Bearer s');
  });

  it('keeps method and body on 307, and turns POST into GET on 302', async () => {
    const body = new TextEncoder().encode('{"a":1}');
    const keep = stub({ 'https://a.example/r': [307, '/final'] });
    const kept = await run('https://a.example/r', 1, { verb: 'post', body });
    expect(keep[1].method).toBe('POST');
    expect(await keep[1].text()).toBe('{"a":1}');
    expect(kept.request.method).toBe('POST');
    expect(await kept.request.text()).toBe('{"a":1}');
    const drop = stub({ 'https://a.example/r': [302, '/final'] });
    const dropped = await run('https://a.example/r', 1, { verb: 'post', body });
    expect(drop[1].method).toBe('GET');
    expect(drop[1].body).toBeNull();
    expect(dropped.request.method).toBe('GET');
  });
});
