import { describe, expect, it } from 'vitest';
import { radiusEnv } from '../src/env.js';

describe('radiusEnv', () => {
  it('defaults to mainnet and maps CLI-compatible variables', () => {
    expect(radiusEnv({})).toEqual({ network: 'mainnet' });
    const cfg = radiusEnv({
      RADIUS_NETWORK: 'testnet',
      RADIUS_RPC_URL: 'https://rpc.testnet.radiustech.xyz/KEY',
      RADIUS_FACILITATOR_URL: 'https://fac.example',
      RADIUS_FACILITATOR_API_KEY: 'k',
      RADIUS_SBC_ADDRESS: '0x33ad9e4BD16B69B5BFdED37D8B5D9fF9aba014Fb',
      RADIUS_PAY_TO: '0x1eF420190c299D4d133fE9227F780D7d5cE91BeE',
      RADIUS_PRIVATE_KEY: '0x' + '11'.repeat(32),
      RADIUS_MAX_PER_REQUEST: '$0.05',
    });
    expect(cfg).toEqual({
      network: 'testnet',
      rpcUrl: 'https://rpc.testnet.radiustech.xyz/KEY',
      facilitatorUrl: 'https://fac.example',
      facilitator: { apiKey: 'k' },
      asset: { address: '0x33ad9e4BD16B69B5BFdED37D8B5D9fF9aba014Fb' },
      payTo: '0x1eF420190c299D4d133fE9227F780D7d5cE91BeE',
      signer: '0x' + '11'.repeat(32),
      maxPerRequest: '$0.05',
    });
  });
  it('rejects bad values loudly', () => {
    expect(() => radiusEnv({ RADIUS_NETWORK: 'devnet' })).toThrow(/RADIUS_NETWORK/);
    expect(() => radiusEnv({ RADIUS_PAY_TO: 'nope' })).toThrow(/RADIUS_PAY_TO/);
    expect(() => radiusEnv({ RADIUS_PRIVATE_KEY: '0x12' })).toThrow(/RADIUS_PRIVATE_KEY/);
  });
});
