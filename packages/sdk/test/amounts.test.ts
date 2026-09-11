import { describe, expect, it } from 'vitest';
import { formatAmount, resolvePrice, toAtomic } from '../src/amounts.js';
import { SBC } from '../src/networks.js';

describe('toAtomic', () => {
  it('parses USD strings into 6-decimal SBC units', () => {
    expect(toAtomic('$0.01', 6)).toBe('10000');
    expect(toAtomic('0.001', 6)).toBe('1000');
    expect(toAtomic('1', 6)).toBe('1000000');
    expect(toAtomic('0.000001', 6)).toBe('1');
    expect(toAtomic('0.05 SBC', 6)).toBe('50000');
    expect(toAtomic(0.1, 6)).toBe('100000');
  });
  it('rejects too many decimals, negatives and junk', () => {
    expect(() => toAtomic('0.0000001', 6)).toThrow(/decimal places/);
    expect(() => toAtomic('-1', 6)).toThrow();
    expect(() => toAtomic('abc', 6)).toThrow();
    expect(() => toAtomic(1e-7, 6)).toThrow();
  });
});

describe('formatAmount', () => {
  it('formats atomic units', () => {
    expect(formatAmount('10000', 6)).toBe('0.01');
    expect(formatAmount(1000000n, 6, 'SBC')).toBe('1 SBC');
    expect(formatAmount('0', 6)).toBe('0');
    expect(formatAmount('1', 6)).toBe('0.000001');
  });
});

describe('resolvePrice', () => {
  it('passes atomic objects through and defaults the asset', () => {
    expect(resolvePrice({ amount: '123' }, SBC)).toEqual({ amount: '123', asset: SBC.address });
    expect(resolvePrice({ amount: 5n, asset: '0x0000000000000000000000000000000000000001' }, SBC)).toEqual({
      amount: '5',
      asset: '0x0000000000000000000000000000000000000001',
    });
    expect(() => resolvePrice({ amount: '1.5' }, SBC)).toThrow();
  });
});
