import { defineChain } from 'viem';
import { describe, expect, it } from 'vitest';
import { defineRadiusNetwork, radiusMainnet, radiusMainnetChain, radiusTestnet, radiusTestnetChain, resolveNetwork, SBC } from '../src/networks.js';

describe('viem chains', () => {
  it('describe mainnet and testnet', () => {
    expect(radiusMainnetChain).toMatchObject({
      id: 723487,
      name: 'Radius Network',
      nativeCurrency: { name: 'Radius USD', symbol: 'RUSD', decimals: 18 },
      rpcUrls: { default: { http: ['https://rpc.radiustech.xyz'] } },
      blockExplorers: { default: { name: 'Radius Network Explorer', url: 'https://network.radiustech.xyz' } },
    });
    expect(radiusMainnetChain.testnet).toBeFalsy();
    expect(radiusTestnetChain).toMatchObject({
      id: 72344,
      name: 'Radius Test Network',
      nativeCurrency: { symbol: 'RUSD', decimals: 18 },
      rpcUrls: { default: { http: ['https://rpc.testnet.radiustech.xyz'] } },
      blockExplorers: { default: { url: 'https://testnet.radiustech.xyz' } },
      testnet: true,
    });
  });

  it('are the source of truth for the presets', () => {
    expect(radiusMainnet.chain).toBe(radiusMainnetChain);
    expect(radiusTestnet.chain).toBe(radiusTestnetChain);
    for (const n of [radiusMainnet, radiusTestnet]) {
      expect(n.chainId).toBe(n.chain.id);
      expect(n.network).toBe(`eip155:${n.chain.id}`);
      expect(n.rpcUrl).toBe(n.chain.rpcUrls.default.http[0]);
      expect(n.explorerUrl).toBe(n.chain.blockExplorers?.default.url);
      expect(n.testnet).toBe(n.chain.testnet ?? false);
    }
    expect(radiusMainnet).toMatchObject({ name: 'mainnet', chainId: 723487, network: 'eip155:723487', testnet: false, facilitatorUrl: 'https://facilitator.radiustech.xyz' });
    expect(radiusTestnet).toMatchObject({ name: 'testnet', chainId: 72344, network: 'eip155:72344', testnet: true, facilitatorUrl: 'https://facilitator.testnet.radiustech.xyz' });
  });
});

describe('resolveNetwork', () => {
  it('defaults to mainnet', () => {
    expect(resolveNetwork()).toBe(radiusMainnet);
    expect(resolveNetwork('mainnet').network).toBe('eip155:723487');
    expect(resolveNetwork('testnet').network).toBe('eip155:72344');
    expect(resolveNetwork(radiusTestnet)).toBe(radiusTestnet);
  });
  it('applies overrides without mutating presets', () => {
    const n = resolveNetwork('testnet', { rpcUrl: 'https://rpc.testnet.radiustech.xyz/KEY/', asset: { symbol: 'USDX' } });
    expect(n.rpcUrl).toBe('https://rpc.testnet.radiustech.xyz/KEY');
    expect(n.asset.symbol).toBe('USDX');
    expect(n.asset.address).toBe(SBC.address);
    expect(radiusTestnet.asset.symbol).toBe('SBC');
    expect(radiusTestnet.rpcUrl).toBe('https://rpc.testnet.radiustech.xyz');
    expect(radiusTestnetChain.rpcUrls.default.http[0]).toBe('https://rpc.testnet.radiustech.xyz');
  });
  it('carries an rpcUrl override into the chain viem clients are built from', () => {
    const n = resolveNetwork('testnet', { rpcUrl: 'https://rpc.testnet.radiustech.xyz/KEY', explorerUrl: 'https://explorer.example/' });
    expect(n.chain).not.toBe(radiusTestnetChain);
    expect(n.chain.id).toBe(72344);
    expect(n.chain.rpcUrls.default.http).toEqual(['https://rpc.testnet.radiustech.xyz/KEY']);
    expect(n.chain.blockExplorers?.default).toEqual({ name: 'Radius Test Network Explorer', url: 'https://explorer.example' });
    expect(n.explorerUrl).toBe('https://explorer.example');
    expect(n.chain.testnet).toBe(true);
    expect(n.chain.nativeCurrency.symbol).toBe('RUSD');
  });
  it('re-syncs the chain when a preset was spread and edited', () => {
    const n = resolveNetwork({ ...radiusTestnet, rpcUrl: 'https://rpc.testnet.radiustech.xyz/KEY' });
    expect(n.chain.rpcUrls.default.http).toEqual(['https://rpc.testnet.radiustech.xyz/KEY']);
    expect(n.rpcUrl).toBe('https://rpc.testnet.radiustech.xyz/KEY');
    expect(n.chainId).toBe(72344);
  });
});

describe('defineRadiusNetwork', () => {
  it('builds custom instances from chainId + rpcUrl', () => {
    const n = defineRadiusNetwork({ chainId: 4242, rpcUrl: 'http://rpc/', facilitatorUrl: 'http://fac/', explorerUrl: 'http://explorer', asset: { address: '0x1111111111111111111111111111111111111111', symbol: 'TST' } });
    expect(n.network).toBe('eip155:4242');
    expect(n.chainId).toBe(4242);
    expect(n.name).toBe('radius-4242');
    expect(n.facilitatorUrl).toBe('http://fac');
    expect(n.rpcUrl).toBe('http://rpc');
    expect(n.explorerUrl).toBe('http://explorer');
    expect(n.testnet).toBe(true);
    expect(n.asset).toMatchObject({ symbol: 'TST', decimals: 6, name: 'Stable Coin' });
    expect(n.chain).toMatchObject({ id: 4242, name: 'radius-4242', testnet: true, rpcUrls: { default: { http: ['http://rpc'] } }, nativeCurrency: { symbol: 'RUSD' } });
    expect(n.chain.blockExplorers?.default.url).toBe('http://explorer');
    expect(() => defineRadiusNetwork({ chainId: 0, rpcUrl: 'x', facilitatorUrl: 'y' })).toThrow();
    expect(() => defineRadiusNetwork({ chainId: 1, rpcUrl: '', facilitatorUrl: 'y' })).toThrow(/rpcUrl/);
    expect(() => defineRadiusNetwork({ chainId: 1, rpcUrl: 'x', facilitatorUrl: '' })).toThrow(/facilitatorUrl/);
  });
  it('builds custom instances from a viem chain', () => {
    const chain = defineChain({
      id: 5151,
      name: 'Radius Dev',
      nativeCurrency: { name: 'Radius USD', symbol: 'RUSD', decimals: 18 },
      rpcUrls: { default: { http: ['http://dev-rpc'] } },
      blockExplorers: { default: { name: 'Dev Explorer', url: 'http://dev-explorer' } },
      testnet: true,
    });
    const n = defineRadiusNetwork({ chain, facilitatorUrl: 'http://fac' });
    expect(n.chain).toBe(chain);
    expect(n).toMatchObject({ name: 'Radius Dev', chainId: 5151, network: 'eip155:5151', rpcUrl: 'http://dev-rpc', explorerUrl: 'http://dev-explorer', testnet: true, asset: SBC });
    const overridden = defineRadiusNetwork({ chain, name: 'dev', rpcUrl: 'http://other-rpc/', facilitatorUrl: 'http://fac' });
    expect(overridden.name).toBe('dev');
    expect(overridden.rpcUrl).toBe('http://other-rpc');
    expect(overridden.chain.rpcUrls.default.http).toEqual(['http://other-rpc']);
    expect(overridden.chain.blockExplorers?.default.name).toBe('Dev Explorer');
    expect(chain.rpcUrls.default.http).toEqual(['http://dev-rpc']);
    expect(resolveNetwork({ chain: radiusMainnetChain, facilitatorUrl: 'http://fac' }).network).toBe('eip155:723487');
  });
});
