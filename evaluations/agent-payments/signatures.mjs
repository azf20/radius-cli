/**
 * Independent check of a signed x402 `exact`/`upto` payment: the authorization pays the offer's
 * recipient and amount, and its EIP-712 signature recovers to the payer. Shared by the offline
 * buyer fixture (run.mjs) and the mock facilitators of the seller suite (sell.mjs).
 */
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERMIT2_ADDRESS, X402_EXACT_PERMIT2_PROXY } from '../../packages/sdk/dist/index.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { recoverTypedDataAddress } = createRequire(join(ROOT, 'packages/sdk/package.json'))('viem');
export const UPTO_PERMIT2_PROXY = '0x4020A4f3b7b90ccA423B9fabCc0CE57C6C240002';
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

/**
 * Check `payload` (the x402 `payload` object: `{ signature, authorization }` or
 * `{ signature, permit2Authorization }`) against `requirements` (a v2 or v1 offer) on `chainId`.
 * Returns the payer and the replay key the chain would consume, or throws when the authorization
 * does not pay this offer. `valid` is false when the signature does not recover to the payer.
 */
export async function verifySignedPayment({ requirements, payload, chainId }) {
  const amount = requirements.amount ?? requirements.maxAmountRequired;
  const auth = payload.authorization;
  if (auth) {
    if (!same(auth.to, requirements.payTo) || auth.value !== amount) throw new Error('authorization does not pay this offer');
    const recovered = await recoverTypedDataAddress({
      domain: { name: requirements.extra.name, version: requirements.extra.version, chainId, verifyingContract: requirements.asset },
      types: { TransferWithAuthorization: [
        { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
      ] },
      primaryType: 'TransferWithAuthorization',
      message: { from: auth.from, to: auth.to, value: BigInt(auth.value), validAfter: BigInt(auth.validAfter), validBefore: BigInt(auth.validBefore), nonce: auth.nonce },
      signature: payload.signature,
    });
    return { valid: same(recovered, auth.from), payer: auth.from, method: 'eip3009',
      replayKey: `${chainId}:${requirements.asset.toLowerCase()}:${auth.from.toLowerCase()}:${auth.nonce.toLowerCase()}`,
      validAfter: BigInt(auth.validAfter), validBefore: BigInt(auth.validBefore) };
  }
  const a = payload.permit2Authorization;
  const upto = requirements.scheme === 'upto';
  if (!a || !same(a.permitted.token, requirements.asset) || a.permitted.amount !== amount || !same(a.witness.to, requirements.payTo) ||
    !same(a.spender, upto ? UPTO_PERMIT2_PROXY : X402_EXACT_PERMIT2_PROXY) ||
    (upto && !same(a.witness.facilitator, requirements.extra.facilitatorAddress))) throw new Error('permit does not pay this offer');
  const witness = upto ? [
    { name: 'to', type: 'address' }, { name: 'facilitator', type: 'address' }, { name: 'validAfter', type: 'uint256' },
  ] : [{ name: 'to', type: 'address' }, { name: 'validAfter', type: 'uint256' }];
  const recovered = await recoverTypedDataAddress({
    domain: { name: 'Permit2', chainId, verifyingContract: PERMIT2_ADDRESS },
    types: { PermitWitnessTransferFrom: [
      { name: 'permitted', type: 'TokenPermissions' }, { name: 'spender', type: 'address' },
      { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }, { name: 'witness', type: 'Witness' },
    ], TokenPermissions: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }], Witness: witness },
    primaryType: 'PermitWitnessTransferFrom',
    message: { permitted: { token: a.permitted.token, amount: BigInt(a.permitted.amount) },
      spender: a.spender, nonce: BigInt(a.nonce), deadline: BigInt(a.deadline),
      witness: { to: a.witness.to, ...(upto ? { facilitator: a.witness.facilitator } : {}), validAfter: BigInt(a.witness.validAfter) } },
    signature: payload.signature,
  });
  return { valid: same(recovered, a.from), payer: a.from, method: 'permit2',
    replayKey: `${chainId}:permit2:${a.from.toLowerCase()}:${a.nonce}`,
    validAfter: BigInt(a.witness.validAfter), validBefore: BigInt(a.deadline) };
}
