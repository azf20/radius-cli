import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.RADIUS_HOME = mkdtempSync(join(tmpdir(), 'radius-cli-network-'));
const { resolveConfig } = await import('../src/lib/config.js');
const { networkInfo } = await import('../src/commands/network.js');

describe('networkInfo', () => {
  it('describes testnet with the rpc override applied', () => {
    const info = networkInfo(resolveConfig({ network: 'testnet', rpcUrl: 'https://rpc.example/radius' }));
    expect(info.name).toBe('radius-testnet');
    expect(info.testnet).toBe(true);
    expect(info.rpcUrl).toBe('https://rpc.example/radius');
    expect(info.caip2).toBe(`eip155:${info.chainId}`);
    expect(info.faucetUrl).toContain('testnet.radiustech.xyz');
    expect(info.asset.symbol).toBe('SBC');
    expect(info.asset.decimals).toBe(6);
  });

  it('defaults to mainnet', () => {
    const info = networkInfo(resolveConfig({}));
    expect(info.name).toBe('radius');
    expect(info.testnet).toBe(false);
  });
});
