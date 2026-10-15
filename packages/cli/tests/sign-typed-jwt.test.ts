import { describe, it, expect } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { recoverAddress, sha256, verifyTypedData } from 'viem';
import { signJwt } from '../src/lib/jwt.js';
import { parseTypedData } from '../src/lib/typedData.js';

const typed = JSON.stringify({
  domain: { name: 'Radius', version: '1', chainId: 723487 },
  types: { Mail: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }] },
  primaryType: 'Mail',
  message: { to: '0x000000000000000000000000000000000000dEaD', amount: '1000000' },
});

describe('parseTypedData', () => {
  it('produces a signature that verifies against the signer', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const data = parseTypedData(typed);
    const signature = await account.signTypedData(data);
    expect(await verifyTypedData({ ...data, address: account.address, signature })).toBe(true);
  });

  it('rejects bad JSON and missing fields', () => {
    expect(() => parseTypedData('nope')).toThrow(/valid JSON/);
    expect(() => parseTypedData('{"types":{},"message":{}}')).toThrow(/primaryType/);
  });
});

describe('signJwt', () => {
  const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString());

  it('builds an ES256K JWT whose signature recovers to the account', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const token = await signJwt(account, { claims: { aud: 'svc', exp: 1 }, expiresIn: 600, now: 1_700_000_000 });
    const [h, p, s] = token.split('.');
    expect(decode(h)).toEqual({ alg: 'ES256K', typ: 'JWT' });
    expect(decode(p)).toEqual({ iss: account.address, aud: 'svc', iat: 1_700_000_000, exp: 1_700_000_600 });
    const rs = Buffer.from(s, 'base64url');
    expect(rs.length).toBe(64);
    const hash = sha256(Buffer.from(`${h}.${p}`));
    const recovered = await Promise.all([27, 28].map((v) => recoverAddress({ hash, signature: `0x${rs.toString('hex')}${v.toString(16)}` })));
    expect(recovered).toContain(account.address);
  });

  it('rejects a non-positive lifetime', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    await expect(signJwt(account, { expiresIn: 0 })).rejects.toThrow(/expires-in/);
  });
});
