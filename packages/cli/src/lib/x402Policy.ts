import { parseUnits } from 'viem';

export interface PayPolicyFlags {
  yes?: boolean;
  x402Threshold?: string;
}

export type PayDecision = 'auto-pay' | 'prompt' | 'refuse-no-tty';

/**
 * Decide how to treat an x402 offer: pay silently, ask, or refuse because there is
 * nobody to ask. `amount` is the atomic amount (the authorized maximum for `upto`).
 */
export function decidePayment(
  flags: PayPolicyFlags,
  amount: bigint,
  decimals: number,
  isTTY: boolean,
): PayDecision {
  if (flags.yes) return 'auto-pay';
  if (flags.x402Threshold !== undefined) {
    let limit: bigint;
    try {
      limit = parseUnits(flags.x402Threshold, decimals);
    } catch {
      throw new Error(`--x402-threshold must be a decimal number, got: ${flags.x402Threshold}`);
    }
    if (limit >= amount) return 'auto-pay';
  }
  return isTTY ? 'prompt' : 'refuse-no-tty';
}
