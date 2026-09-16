import type { Address } from './networks.js';

/**
 * A price. Strings and numbers are USD (SBC is USD-pegged): "$0.01", "0.01",
 * "0.01 SBC", 0.01. An object is an atomic amount in the asset's base units,
 * optionally naming a different ERC-20 asset.
 */
export type Price = string | number | { amount: string | bigint; asset?: string };

/** Convert a display-unit price to an atomic integer string. No floating point math. */
export function toAtomic(price: string | number, decimals: number): string {
  let s: string;
  if (typeof price === 'number') {
    if (!Number.isFinite(price) || price < 0) throw new Error(`toAtomic: invalid price ${price}`);
    s = price.toString();
    if (/e/i.test(s)) throw new Error(`toAtomic: price ${price} is not representable as a plain decimal; pass a string`);
  } else {
    s = price.trim();
    // Accept "$0.01", "0.01 SBC", "0.01 USD", "USD 0.01"
    s = s.replace(/^\$/, '').replace(/^(usd|sbc)\s+/i, '').replace(/\s+(usd|sbc)$/i, '').replace(/^\$/, '');
  }
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`toAtomic: cannot parse price '${String(price)}'`);
  const [whole, frac = ''] = s.split('.');
  if (frac.length > decimals) {
    throw new Error(`toAtomic: price '${String(price)}' has more than ${decimals} decimal places`);
  }
  const atomic = BigInt(whole + frac.padEnd(decimals, '0'));
  return atomic.toString();
}

/** Format an atomic amount as a decimal string, e.g. 10000 → "0.01". */
export function formatAmount(atomic: string | bigint, decimals: number, symbol?: string): string {
  const v = BigInt(atomic);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const s = abs.toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, '');
  const out = `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
  return symbol ? `${out} ${symbol}` : out;
}

/** Resolve a Price to { amount, asset } atomic form. */
export function resolvePrice(price: Price, asset: { address: Address; decimals: number }): { amount: string; asset: Address } {
  if (typeof price === 'object' && price !== null) {
    const amount = typeof price.amount === 'bigint' ? price.amount.toString() : price.amount;
    if (!/^\d+$/.test(amount)) throw new Error(`resolvePrice: atomic amount must be an integer string (got '${amount}')`);
    return { amount, asset: (price.asset as Address | undefined) ?? asset.address };
  }
  return { amount: toAtomic(price, asset.decimals), asset: asset.address };
}
