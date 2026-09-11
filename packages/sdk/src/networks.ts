/**
 * Radius network presets and helpers.
 *
 * Values verified against docs.radiustech.xyz (network configuration, contract
 * addresses, x402 facilitator API) and the live facilitator `/supported`
 * responses on 2026-09-11.
 */

export type Address = `0x${string}`;
export type Caip2 = `eip155:${number}`;

export interface RadiusAsset {
  /** ERC-20 contract address. */
  address: Address;
  symbol: string;
  decimals: number;
  /** EIP-712 / EIP-2612 permit domain name. */
  name: string;
  /** EIP-712 / EIP-2612 permit domain version. */
  version: string;
}

export interface RadiusNetwork {
  /** Human label: 'mainnet', 'testnet', or whatever you call a custom instance. */
  name: string;
  chainId: number;
  /** CAIP-2 identifier used on the x402 wire, e.g. `eip155:723487`. */
  network: Caip2;
  rpcUrl: string;
  facilitatorUrl: string;
  explorerUrl?: string;
  /** Faucet API base URL (drips SBC; testnet ~0.5/request, mainnet ~0.01/day). */
  faucetUrl?: string;
  /** Default payment asset (SBC unless overridden). */
  asset: RadiusAsset;
  testnet: boolean;
}

/** SBC is deployed deterministically: same address on mainnet and testnet. */
export const SBC: RadiusAsset = {
  address: '0x33ad9e4BD16B69B5BFdED37D8B5D9fF9aba014Fb',
  symbol: 'SBC',
  decimals: 6,
  name: 'Stable Coin',
  version: '1',
};

/** Canonical Uniswap Permit2 (same address on every EVM chain). */
export const PERMIT2_ADDRESS: Address = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
/** x402ExactPermit2Proxy — the Permit2 spender payers sign for in the `exact` scheme. */
export const X402_EXACT_PERMIT2_PROXY: Address = '0x402085c248EeA27D92E8b30b2C58ed07f9E20001';

export const radiusMainnet: RadiusNetwork = {
  name: 'mainnet',
  chainId: 723487,
  network: 'eip155:723487',
  rpcUrl: 'https://rpc.radiustech.xyz',
  facilitatorUrl: 'https://facilitator.radiustech.xyz',
  explorerUrl: 'https://network.radiustech.xyz',
  faucetUrl: 'https://network.radiustech.xyz/api/v1/faucet',
  asset: SBC,
  testnet: false,
};

export const radiusTestnet: RadiusNetwork = {
  name: 'testnet',
  chainId: 72344,
  network: 'eip155:72344',
  rpcUrl: 'https://rpc.testnet.radiustech.xyz',
  facilitatorUrl: 'https://facilitator.testnet.radiustech.xyz',
  explorerUrl: 'https://testnet.radiustech.xyz',
  faucetUrl: 'https://testnet.radiustech.xyz/api/v1/faucet',
  asset: SBC,
  testnet: true,
};

export type NetworkName = 'mainnet' | 'testnet';

export interface CustomNetworkConfig {
  chainId: number;
  rpcUrl: string;
  facilitatorUrl: string;
  name?: string;
  explorerUrl?: string;
  faucetUrl?: string;
  /** Partial override; unspecified fields fall back to SBC. */
  asset?: Partial<RadiusAsset>;
  testnet?: boolean;
}

/** Anything `resolveNetwork` understands. Defaults to mainnet when omitted. */
export type NetworkInput = NetworkName | RadiusNetwork | CustomNetworkConfig;

export interface NetworkOverrides {
  rpcUrl?: string;
  facilitatorUrl?: string;
  explorerUrl?: string;
  faucetUrl?: string;
  /** Override the payment asset (e.g. a different token on a custom instance). */
  asset?: Partial<RadiusAsset>;
}

/** Build a network definition for a custom Radius instance. */
export function defineRadiusNetwork(config: CustomNetworkConfig): RadiusNetwork {
  if (!Number.isInteger(config.chainId) || config.chainId <= 0) {
    throw new Error(`defineRadiusNetwork: chainId must be a positive integer (got ${config.chainId})`);
  }
  if (!config.rpcUrl) throw new Error('defineRadiusNetwork: rpcUrl is required');
  if (!config.facilitatorUrl) throw new Error('defineRadiusNetwork: facilitatorUrl is required');
  return {
    name: config.name ?? `radius-${config.chainId}`,
    chainId: config.chainId,
    network: `eip155:${config.chainId}`,
    rpcUrl: stripTrailingSlash(config.rpcUrl),
    facilitatorUrl: stripTrailingSlash(config.facilitatorUrl),
    explorerUrl: config.explorerUrl,
    faucetUrl: config.faucetUrl,
    asset: { ...SBC, ...config.asset },
    testnet: config.testnet ?? true,
  };
}

function isRadiusNetwork(v: unknown): v is RadiusNetwork {
  return typeof v === 'object' && v !== null && 'network' in v && 'asset' in v && 'chainId' in v;
}

/**
 * Resolve a network from a name, a preset, or a custom config, applying overrides.
 * Defaults to mainnet.
 */
export function resolveNetwork(input?: NetworkInput, overrides?: NetworkOverrides): RadiusNetwork {
  let base: RadiusNetwork;
  if (input === undefined || input === 'mainnet') base = radiusMainnet;
  else if (input === 'testnet') base = radiusTestnet;
  else if (isRadiusNetwork(input)) base = input;
  else if (typeof input === 'object') base = defineRadiusNetwork(input);
  else throw new Error(`resolveNetwork: unknown network '${String(input)}' (expected 'mainnet', 'testnet', or a network object)`);

  if (!overrides) return base;
  return {
    ...base,
    rpcUrl: overrides.rpcUrl ? stripTrailingSlash(overrides.rpcUrl) : base.rpcUrl,
    facilitatorUrl: overrides.facilitatorUrl ? stripTrailingSlash(overrides.facilitatorUrl) : base.facilitatorUrl,
    explorerUrl: overrides.explorerUrl ?? base.explorerUrl,
    faucetUrl: overrides.faucetUrl ?? base.faucetUrl,
    asset: overrides.asset ? { ...base.asset, ...overrides.asset } : base.asset,
  };
}

/** Parse a CAIP-2 `eip155:<id>` string to a chain id, or undefined. */
export function chainIdFromCaip2(network: string): number | undefined {
  const m = /^eip155:(\d+)$/.exec(network);
  if (!m) return undefined;
  const id = Number(m[1]);
  return Number.isSafeInteger(id) ? id : undefined;
}

/** Explorer link for a settlement transaction, e.g. https://testnet.radiustech.xyz/tx/0x… */
export function explorerTxUrl(network: RadiusNetwork, txHash: string): string | undefined {
  return network.explorerUrl ? `${network.explorerUrl}/tx/${txHash}` : undefined;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
