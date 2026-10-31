// E-mail address verification: a signed, expiring token bound to the user AND the address, so changing the
// address invalidates old links. E-mail notifications only go to verified addresses (NotificationService).
import { createHmac, timingSafeEqual } from 'node:crypto';

const mac = (secret: string, data: string) => createHmac('sha256', secret).update('verify-email:' + data).digest('base64url');

export function emailToken(userId: string, email: string, secret: string, now = Date.now(), ttlMs = 48 * 3600_000): string {
  if (secret.length < 32) throw new Error('signing secret too short');
  const body = Buffer.from(JSON.stringify({ u: userId, m: email.trim().toLowerCase(), e: now + ttlMs })).toString('base64url');
  return body + '.' + mac(secret, body);
}

export function checkEmailToken(token: string, current: { id: string; email: string }, secret: string, now = Date.now()): { ok: boolean; reason?: string } {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return { ok: false, reason: 'malformed' };
  const a = Buffer.from(mac(secret, body)), b = Buffer.from(sig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };
  let p: { u?: string; m?: string; e?: number };
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return { ok: false, reason: 'malformed' }; }
  if (!p.e || p.e < now) return { ok: false, reason: 'expired' };
  if (p.u !== current.id) return { ok: false, reason: 'other_user' };
  if (p.m !== current.email.trim().toLowerCase()) return { ok: false, reason: 'address_changed' };
  return { ok: true };
}
