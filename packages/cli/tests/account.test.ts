import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { deferredAccount } from '../src/lib/account.js';
import { saveKeystore } from '../src/lib/keystore.js';
import type { ResolvedConfig } from '../src/types.js';

describe('deferredAccount', () => {
  const password = 'correct-horse-battery-staple';
  const privateKey = generatePrivateKey();
  const real = privateKeyToAccount(privateKey);
  let cfg: ResolvedConfig;

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'radius-cli-test-'));
    const keystorePath = join(dir, 'keystore.json');
    await saveKeystore(keystorePath, privateKey, password);
    cfg = { network: 'testnet', chain: {} as ResolvedConfig['chain'], rpcUrl: '', keystorePath, password };
  }, 20_000);

  it('knows the address without unlocking, and signs like the real account once asked', async () => {
    const wrongPassword = { ...cfg, password: 'wrong' };
    const locked = await deferredAccount(wrongPassword, undefined);
    expect(locked.address.toLowerCase()).toBe(real.address.toLowerCase());
    // Nothing was decrypted yet: the bad password only surfaces on first signature.
    await expect(locked.signMessage({ message: 'hi' })).rejects.toThrow();

    const account = await deferredAccount(cfg, undefined);
    expect(account.type).toBe('local');
    expect(typeof account.signTransaction).toBe('function');
    expect(await account.signMessage({ message: 'hi' })).toBe(await real.signMessage({ message: 'hi' }));
    const typed = {
      domain: { name: 'T', version: '1', chainId: 1 },
      types: { M: [{ name: 'v', type: 'uint256' }] },
      primaryType: 'M',
      message: { v: 1n },
    } as const;
    expect(await account.signTypedData(typed)).toBe(await real.signTypedData(typed));
  }, 40_000);

  it('uses --private-key directly', async () => {
    const account = await deferredAccount({ ...cfg, keystorePath: '/nonexistent/keystore.json' }, privateKey);
    expect(account.address).toBe(real.address);
  });
});
