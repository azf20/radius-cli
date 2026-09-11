import { describe, expect, it } from 'vitest';
import { defineRadiusNetwork, radiusMainnet, radiusTestnet, resolveNetwork, SBC } from '../src/networks.js';

describe('resolveNetwork', () => {
  it('defaults to mainnet', () => {
    expect(resolveNetwork()).toBe(radiusMainnet);
    expect(resolveNetwork('mainnet').network).toBe('eip155:723487');
    expect(resolveNetwork('testnet').network).toBe('eip155:72344');
  });
  it('applies overrides without mutating presets', () => {
    const n = resolveNetwork('testnet', { rpcUrl: 'https://rpc.testnet.radiustech.xyz/KEY/', asset: { symbol: 'USDX' } });
    expect(n.rpcUrl).toBe('https://rpc.testnet.radiustech.xyz/KEY');
    expect(n.asset.symbol).toBe('USDX');
    expect(n.asset.address).toBe(SBC.address);
    expect(radiusTestnet.asset.symbol).toBe('SBC');
  });
  it('builds custom instances', () => {
    const n = defineRadiusNetwork({ chainId: 4242, rpcUrl: 'http://rpc', facilitatorUrl: 'http://fac/', asset: { address: '0x1111111111111111111111111111111111111111', symbol: 'TST' } });
    expect(n.network).toBe('eip155:4242');
    expect(n.facilitatorUrl).toBe('http://fac');
    expect(n.asset).toMatchObject({ symbol: 'TST', decimals: 6, name: 'Stable Coin' });
    expect(() => defineRadiusNetwork({ chainId: 0, rpcUrl: 'x', facilitatorUrl: 'y' })).toThrow();
  });
});
