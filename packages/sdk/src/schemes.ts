/** One x402 scheme/version combination the client can pay. */
export interface SupportedScheme {
  x402Version: 1 | 2;
  scheme: 'exact' | 'upto';
  /** `assetTransferMethod` values accepted for this scheme. */
  transferMethods: readonly ('permit2' | 'eip3009')[];
}

/** What `createRadiusFetch` can pay, in the order offers are preferred. */
export const SUPPORTED_SCHEMES: readonly SupportedScheme[] = [
  { x402Version: 2, scheme: 'exact', transferMethods: ['permit2', 'eip3009'] },
  { x402Version: 2, scheme: 'upto', transferMethods: ['permit2'] },
  { x402Version: 1, scheme: 'exact', transferMethods: ['eip3009'] },
];

/** Human-readable summary, e.g. "exact@v2 (permit2 or eip3009), upto@v2 (permit2), exact@v1 (eip3009)". */
export function describeSupportedSchemes(): string {
  return SUPPORTED_SCHEMES.map((s) => `${s.scheme}@v${s.x402Version} (${s.transferMethods.join(' or ')})`).join(', ');
}
