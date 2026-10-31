// Minimal HS256 JWT verification (ZainCash signs redirect and webhook tokens with the merchant secret).
import { createHmac, timingSafeEqual } from 'node:crypto';

const b64u = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
export class JwtError extends Error { constructor(msg: string) { super(msg); this.name = 'JwtError'; } }

export function verifyHS256(token: string, secret: string, now: number = Date.now()): Record<string, unknown> {
  if (!secret) throw new JwtError('no secret configured');
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new JwtError('malformed token');
  let header: { alg?: string };
  try { header = JSON.parse(b64u(parts[0]).toString('utf8')); } catch { throw new JwtError('malformed header'); }
  if (header.alg !== 'HS256') throw new JwtError('unexpected algorithm ' + header.alg); // never accept "none" or RS/HS confusion
  const sig = b64u(parts[2]), exp = createHmac('sha256', secret).update(parts[0] + '.' + parts[1]).digest();
  if (sig.length !== exp.length || !timingSafeEqual(sig, exp)) throw new JwtError('bad signature');
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(b64u(parts[1]).toString('utf8')); } catch { throw new JwtError('malformed payload'); }
  if (typeof payload.exp === 'number' && payload.exp * 1000 < now - 60_000) throw new JwtError('token expired');
  return payload;
}

export function signHS256(payload: Record<string, unknown>, secret: string): string { // used by tests/simulators only
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = enc({ alg: 'HS256', typ: 'JWT' }), p = enc(payload);
  return `${h}.${p}.${createHmac('sha256', secret).update(h + '.' + p).digest('base64url')}`;
}
