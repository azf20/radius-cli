import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { expect, it, vi } from 'vitest';
import { runRequest } from '../src/lib/http.js';

it('reports the URL that answered 402 after fetch followed a redirect, for the paid retry to target', async () => {
  const server = createServer((req, res) => void (req.url === '/r' ? res.writeHead(302, { location: '/final' }) : res.writeHead(402)).end());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const res = await runRequest('get', `${base}/r`, { headers: new Headers() });
    expect([res.status, res.redirected, res.url]).toEqual([402, true, `${base}/final`]);
    const direct = await runRequest('get', `${base}/final`, { headers: new Headers() });
    expect(direct.redirected).toBe(false);
  } finally {
    server.close();
  }
});

it('wallet pay refuses to pay a redirected POST, before anything is signed', async () => {
  process.env.RADIUS_HOME = mkdtempSync(join(tmpdir(), 'radius-cli-pay-redirects-'));
  const { registerWalletPay } = await import('../src/commands/walletPay.js');
  const shop = createServer((req, res) => void res.writeHead(402).end());
  const short = createServer((req, res) => void res.writeHead(307, { location: `http://127.0.0.1:${(shop.address() as AddressInfo).port}/final` }).end());
  for (const s of [shop, short]) await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
  const program = new Command().option('--private-key <hex>');
  registerWalletPay(program.command('wallet'));
  let stderr = '';
  const write = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => { stderr += String(chunk); return true; });
  const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit ${code}`); }) as never);
  try {
    const url = `http://127.0.0.1:${(short.address() as AddressInfo).port}/r`;
    await expect(program.parseAsync(['node', 'radius-cli', 'wallet', 'pay', 'post', url, '-d', '{}', '--private-key', `0x${'11'.repeat(32)}`])).rejects.toThrow('exit 1');
    expect(stderr).toMatch(/pay: Not paying: POST .* was redirected to .*\/final.*only GET and HEAD are paid/);
  } finally {
    write.mockRestore();
    exit.mockRestore();
    shop.close();
    short.close();
  }
});
