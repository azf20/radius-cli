/**
 * End-to-end against the real Radius testnet facilitator. The seller runs
 * in-process (Hono `app.fetch`), the buyer is `createRadiusFetch` pointed at it.
 *
 *   RADIUS_E2E=1 RADIUS_PRIVATE_KEY=0x… [RADIUS_NETWORK=mainnet] npx vitest run test/e2e
 *
 * Each successful payment moves 0.001 SBC from the key to PAY_TO (defaults to the payer itself).
 */
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { radiusPayments, type RadiusPaymentVariables } from '../../src/hono/index.js';
import { createRadiusFetch, RadiusPaymentError } from '../../src/client/index.js';
import { getPaymentReceipt } from '../../src/receipt.js';
import { resolveNetwork } from '../../src/networks.js';

const NET = (process.env.RADIUS_NETWORK ?? 'testnet') as 'mainnet' | 'testnet';
const OTHER = NET === 'testnet' ? 'mainnet' : 'testnet';
const network = resolveNetwork(NET);
const KEY = process.env.RADIUS_PRIVATE_KEY as `0x${string}` | undefined;
const run = process.env.RADIUS_E2E && KEY ? describe : describe.skip;

run(`${NET} e2e`, () => {
  const payer = privateKeyToAccount(KEY!);
  const PAY_TO = (process.env.PAY_TO as `0x${string}`) ?? payer.address;
  const settled: unknown[] = [];
  const app = new Hono<{ Variables: RadiusPaymentVariables }>();
  app.use(
    radiusPayments({
      network: NET,
      payTo: PAY_TO,
      routes: { 'GET /api/lookup': '$0.001', 'GET /api/pricey': '$5' },
      onSettled: (r) => { settled.push(r); },
    }),
  );
  app.get('/api/lookup', (c) => c.json({ ok: true, payer: c.get('radiusPayment')?.payer }));
  app.get('/api/pricey', (c) => c.json({ ok: true }));
  const serverFetch: typeof fetch = (input, init) => app.fetch(new Request(input, init));

  const buyer = createRadiusFetch({ network: NET, signer: KEY!, maxPerRequest: '$0.01', fetch: serverFetch });

  beforeAll(async () => {
    const { atomic } = await buyer.balance();
    expect(atomic, `payer needs at least 0.002 SBC on ${NET}`).toBeGreaterThanOrEqual(2000n);
  });

  it('pays a lookup with real settlement and exposes the receipt on both sides', async () => {
    const res = await buyer('http://seller.test/api/lookup');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, payer: payer.address });
    const receipt = getPaymentReceipt(res, buyer.network)!;
    expect(receipt.success).toBe(true);
    expect(receipt.transaction).toMatch(/^0x[0-9a-f]{64}$/);
    expect(receipt.network).toBe(network.network);
    expect(settled).toHaveLength(1);
  }, 60_000);

  it('refuses an offer above maxPerRequest before signing anything', async () => {
    await expect(buyer('http://seller.test/api/pricey')).rejects.toMatchObject({ code: 'price_above_limit' });
    expect(settled).toHaveLength(1);
  });

  it(`refuses a ${NET} offer when configured for ${OTHER}`, async () => {
    const mainnetBuyer = createRadiusFetch({ network: OTHER, signer: KEY!, maxPerRequest: '$0.01', fetch: serverFetch });
    await expect(mainnetBuyer('http://seller.test/api/lookup')).rejects.toMatchObject({ code: 'network_mismatch' });
  });

  it('lets onPaymentRequired decline', async () => {
    const cautious = createRadiusFetch({ network: NET, signer: KEY!, maxPerRequest: '$0.01', fetch: serverFetch, onPaymentRequired: () => false });
    await expect(cautious('http://seller.test/api/lookup')).rejects.toBeInstanceOf(RadiusPaymentError);
  });

  it('withholds the resource for a forged signature', async () => {
    const forged = createRadiusFetch({ network: NET, signer: '0x0000000000000000000000000000000000000000000000000000000000000001', maxPerRequest: '$0.01', fetch: serverFetch });
    await expect(forged('http://seller.test/api/lookup')).rejects.toMatchObject({ code: 'payment_rejected' });
  }, 60_000);
});
