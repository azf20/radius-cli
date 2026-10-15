import { Command } from 'commander';
import { radiusNetwork, resolveConfig } from '../lib/config.js';
import { jsonStringify } from '../lib/format.js';
import type { GlobalOptions, ResolvedConfig } from '../types.js';

/** The resolved Radius network config (flags, env and config file applied). Works offline. */
export function networkInfo(cfg: ResolvedConfig) {
  const n = radiusNetwork(cfg);
  return {
    name: n.name,
    chainId: n.chainId,
    caip2: n.network,
    testnet: n.testnet,
    rpcUrl: n.rpcUrl,
    explorerUrl: n.explorerUrl,
    faucetUrl: n.faucetUrl,
    facilitatorUrl: n.facilitatorUrl,
    nativeCurrency: n.chain.nativeCurrency,
    asset: { symbol: n.asset.symbol, address: n.asset.address, decimals: n.asset.decimals },
  };
}

export function registerNetwork(program: Command): void {
  program
    .command('network')
    .description('Print the resolved network config (chain id, RPC, explorer, faucet, facilitator, SBC)')
    .action((_opts, cmd) => {
      const opts = cmd.optsWithGlobals() as GlobalOptions;
      const info = networkInfo(resolveConfig(opts));
      if (opts.json) {
        console.log(jsonStringify(info));
        return;
      }
      console.log(`Network:     ${info.name} (chain ${info.chainId}, ${info.caip2})`);
      console.log(`RPC:         ${info.rpcUrl}`);
      if (info.explorerUrl) console.log(`Explorer:    ${info.explorerUrl}`);
      if (info.faucetUrl) console.log(`Faucet:      ${info.faucetUrl}`);
      if (info.facilitatorUrl) console.log(`Facilitator: ${info.facilitatorUrl}`);
      console.log(`Native:      ${info.nativeCurrency.symbol} (${info.nativeCurrency.decimals} decimals)`);
      console.log(`${info.asset.symbol}:         ${info.asset.address} (${info.asset.decimals} decimals)`);
    });
}
