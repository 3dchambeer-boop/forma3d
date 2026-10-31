// =====================================================================
// TOTP (RFC 6238, HMAC-SHA1, 30 s, 6 digits) for optional MFA. Secrets are base32 (RFC 4648) as authenticator
// apps expect. verify() accepts one step of clock drift either way and compares in constant time.
// =====================================================================
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf: Uint8Array): string {
  let bits = 0, value = 0, out = '';
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, value = 0; const out: number[] = [];
  for (const c of clean) {
    const i = B32.indexOf(c); if (i < 0) throw new Error('invalid base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
export const newSecret = () => base32Encode(randomBytes(20));

export function hotp(secret: Buffer, counter: number, digits = 6, algo: 'sha1' | 'sha256' | 'sha512' = 'sha1'): string {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac(algo, secret).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 10 ** digits).padStart(digits, '0');
}
export const totp = (secretB32: string, nowMs = Date.now(), step = 30) => hotp(base32Decode(secretB32), Math.floor(nowMs / 1000 / step));

/** true when `code` matches the current, previous or next 30-second window. Returns the matched counter (replay guard). */
export function verifyTotp(secretB32: string, code: string, nowMs = Date.now(), lastUsedCounter = -1): { ok: boolean; counter?: number } {
  if (!/^\d{6}$/.test(code || '')) return { ok: false };
  const key = base32Decode(secretB32), c0 = Math.floor(nowMs / 30000);
  for (const c of [c0 - 1, c0, c0 + 1]) {
    if (c <= lastUsedCounter) continue; // a code already used cannot be used again
    if (timingSafeEqual(Buffer.from(hotp(key, c)), Buffer.from(code))) return { ok: true, counter: c };
  }
  return { ok: false };
}
export const otpauthUri = (secretB32: string, account: string, issuer = 'CMG FORMA·3D') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
