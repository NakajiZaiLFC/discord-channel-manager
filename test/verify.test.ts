import { describe, it, expect } from 'vitest';
import { verifySignature } from '../src/verify.js';

async function toHex(buf: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function setup() {
  const kp = await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair;
  const pubRaw = await crypto.subtle.exportKey('raw', kp.publicKey);
  const publicKeyHex = await toHex(pubRaw);
  return { kp, publicKeyHex };
}

async function sign(kp: CryptoKeyPair, body: string, timestamp: string): Promise<string> {
  const data = new TextEncoder().encode(timestamp + body);
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, data);
  return toHex(sig);
}

describe('verifySignature', () => {
  it('returns true for a valid signature', async () => {
    const { kp, publicKeyHex } = await setup();
    const body = '{"type":1}';
    const timestamp = '1700000000';
    const signature = await sign(kp, body, timestamp);

    const ok = await verifySignature(body, signature, timestamp, publicKeyHex);
    expect(ok).toBe(true);
  });

  it('returns false for an invalid signature', async () => {
    const { publicKeyHex } = await setup();
    const body = '{"type":1}';
    const timestamp = '1700000000';
    const badSig = 'deadbeef'.repeat(16); // 128 hex chars = 64 bytes

    const ok = await verifySignature(body, badSig, timestamp, publicKeyHex);
    expect(ok).toBe(false);
  });

  it('returns false for a tampered body', async () => {
    const { kp, publicKeyHex } = await setup();
    const timestamp = '1700000000';
    const signature = await sign(kp, '{"type":1}', timestamp);

    const ok = await verifySignature('{"type":2}', signature, timestamp, publicKeyHex);
    expect(ok).toBe(false);
  });

  it('returns false for malformed hex', async () => {
    const { publicKeyHex } = await setup();
    const ok = await verifySignature('x', 'zz', '1700000000', publicKeyHex);
    expect(ok).toBe(false);
  });
});
