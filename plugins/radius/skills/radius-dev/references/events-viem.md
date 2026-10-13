# Events on Radius

Radius block numbers are timestamps in milliseconds. Its RPC limits a single `eth_getLogs` range to 1,000,000 block numbers (about 16.7 minutes). Polling with viem's `watchContractEvent` can get stuck after a longer gap because its fallback queries the whole missed range at once. Use the chunked `radius-sdk/client` actions for ERC-20 `Transfer` events.

## ERC-20 transfer history and watching

Install `radius-sdk` and its `viem` peer dependency. The Radius preset chain supplies SBC as the default token. Pass `token` for a different ERC-20.

```typescript
import { createPublicClient, http } from 'viem';
import { radiusTestnet } from 'radius-sdk';
import { erc20Actions, transferKey } from 'radius-sdk/client';

const client = createPublicClient({
  chain: radiusTestnet.chain,
  transport: http(),
}).extend(erc20Actions());

const recipient = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const head = await client.getBlockNumber();
const fromBlock = head > 1_000_000n ? head - 1_000_000n : 0n;
const toBlock = head;
const history = await client.getTransfers({ to: recipient, fromBlock, toBlock });
for (const transfer of history) console.log(transfer.transactionHash, transfer.amount);

// Load these from durable storage when resuming after a restart.
const seen = new Set<string>();
let checkpoint: bigint | undefined;
const unwatch = client.watchTransfers({
  to: recipient,
  ...(checkpoint === undefined ? {} : { fromBlock: checkpoint + 1n }),
  onTransfer: async (transfer) => {
    const key = transferKey(transfer); // transactionHash:logIndex
    if (seen.has(key)) return;
    console.log('New transfer:', transfer);
    seen.add(key);
  },
  onCheckpoint: (block) => { checkpoint = block; },
  onError: (error) => console.error('Transfer watch error:', error),
});

// Call unwatch() when the process no longer needs the subscription.
```

`getTransfers` pages wide ranges into bounded `eth_getLogs` calls. `watchTransfers` delivers in block and log order and checkpoints after a fully delivered chunk. Delivery is at least once: persist the checkpoint and deduplicate transfer keys in the same durable store as the downstream effect. An in-memory `Set` in the example only demonstrates the API; it does not survive a restart. Without `fromBlock`, the watcher starts at the current head and follows new transfers only.

For a custom ERC-20, pass `token: '0x…'` to both actions or extend with `erc20Actions({ token })`. For other contract events, use viem `getLogs` with an address filter and explicit windows no wider than 1,000,000 block numbers. Persist a cursor and split gaps before polling again. Do not use block hashes or transaction indexes as unique event IDs; use transaction hash plus log index.

## Block observation

For a lightweight head signal, viem's `watchBlockNumber` is still useful:

```typescript
const stop = client.watchBlockNumber({
  onBlockNumber: (block) => console.log('Radius timestamp block:', block),
  onError: (error) => console.error(error),
});
// stop() when finished
```

A block signal is not a transfer history cursor. For reconciliation, query the relevant transaction receipt or the SDK's settlement helper rather than inferring an outcome from a changing block number.
