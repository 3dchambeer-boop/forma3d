// Signed, expiring download links for private files (models, G-code, invoices).
// Use: a print farm machine or the slicer worker fetches a file without a browser session.
//   token = base64url(JSON {k: kind, f: key, s: subject, e: expiry ms}) + "." + base64url(HMAC-SHA256(secret, that))
// The token is bound to one kind + one file key + one subject (who it was issued for) and expires; the
// secret comes from DOWNLOAD_SIGNING_SECRET (at least 32 characters). Verification is constant-time.
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface DownloadClaim { kind: string; key: string; sub: string; exp: number }
export type VerifyResult = { ok: true; claim: DownloadClaim } | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'wrong_file' };

const MAX_TTL_MS = 24 * 3600_000;

export function signingSecret(env: Record<string, string | undefined> = process.env): string {
  const s = env.DOWNLOAD_SIGNING_SECRET || '';
  if (s.length < 32) throw new Error('DOWNLOAD_SIGNING_SECRET must be set to at least 32 characters');
  return s;
}

const mac = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest('base64url');

export function signDownload(c: { kind: string; key: string; sub: string; ttlMs: number }, secret: string, now = Date.now()): string {
  if (!(c.ttlMs > 0) || c.ttlMs > MAX_TTL_MS) throw new Error('ttl must be between 0 and 24 h');
  const body = Buffer.from(JSON.stringify({ k: c.kind, f: c.key, s: c.sub, e: now + c.ttlMs })).toString('base64url');
  return `${body}.${mac(secret, body)}`;
}

export function verifyDownload(token: string | null | undefined, expect: { kind: string; key: string }, secret: string, now = Date.now()): VerifyResult {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' };
  const want = Buffer.from(mac(secret, parts[0])), got = Buffer.from(parts[1]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, reason: 'bad_signature' };
  let p: { k?: string; f?: string; s?: string; e?: number };
  try { p = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { return { ok: false, reason: 'malformed' }; }
  if (typeof p.e !== 'number' || p.e < now) return { ok: false, reason: 'expired' };
  if (p.k !== expect.kind || p.f !== expect.key) return { ok: false, reason: 'wrong_file' };
  return { ok: true, claim: { kind: p.k, key: p.f, sub: String(p.s || ''), exp: p.e } };
}
