function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) return null;
    bytes[i] = byte;
  }
  return bytes;
}

export async function verifySignature(
  rawBody: string,
  signatureHex: string,
  timestamp: string,
  publicKeyHex: string,
): Promise<boolean> {
  const sig = hexToBytes(signatureHex);
  const pub = hexToBytes(publicKeyHex);
  if (!sig || !pub || sig.length !== 64 || pub.length !== 32) return false;

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      pub,
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    const data = new TextEncoder().encode(timestamp + rawBody);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, sig, data);
  } catch {
    return false;
  }
}
