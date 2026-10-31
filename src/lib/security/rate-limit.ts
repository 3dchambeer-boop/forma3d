// Sliding-window rate limiter (per process). Keys are e.g. "ip:1.2.3.4:webhook" or "user:<id>:export".
// For several app instances put the same limits in the reverse proxy (Caddy rate_limit) or swap the store
// for a shared one; the interface stays the same. Memory is bounded: the oldest keys are evicted.
export interface Limit { max: number; windowMs: number }
export interface Decision { allowed: boolean; remaining: number; retryAfterMs: number }

export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private readonly maxKeys = 50_000, private readonly clock: () => number = Date.now) {}

  check(key: string, limit: Limit): Decision {
    const now = this.clock(), from = now - limit.windowMs;
    const list = (this.hits.get(key) || []).filter((t) => t > from);
    if (list.length >= limit.max) {
      this.hits.set(key, list);
      return { allowed: false, remaining: 0, retryAfterMs: Math.max(1, list[0] + limit.windowMs - now) };
    }
    list.push(now);
    this.hits.delete(key); // re-insert: Map order = least recently used first
    this.hits.set(key, list);
    if (this.hits.size > this.maxKeys) this.hits.delete(this.hits.keys().next().value as string);
    return { allowed: true, remaining: limit.max - list.length, retryAfterMs: 0 };
  }
}

export const LIMITS: Record<string, Limit> = {
  webhook: { max: 120, windowMs: 60_000 },       // provider callbacks per source IP
  generation: { max: 10, windowMs: 60 * 60_000 }, // paid AI generations per user per hour
  export: { max: 30, windowMs: 60_000 },          // CAD exports per user per minute
  payment: { max: 10, windowMs: 10 * 60_000 },    // payment starts per user
  download: { max: 120, windowMs: 60_000 },       // signed-link downloads per IP
  adminLogin: { max: 5, windowMs: 15 * 60_000 },  // administrator sign-in attempts per IP and per e-mail
  oauth: { max: 20, windowMs: 10 * 60_000 },      // Google sign-in starts/callbacks per IP
};

export const limiter = new RateLimiter();

/** Client IP as the reverse proxy reports it (Caddy sets X-Forwarded-For); falls back to "unknown". */
export function clientIp(headers: { get(name: string): string | null }): string {
  return (headers.get('x-forwarded-for') || '').split(',')[0].trim() || headers.get('x-real-ip') || 'unknown';
}

/** null when allowed, else a 429 Response with Retry-After. */
export function rateLimited(key: string, name: keyof typeof LIMITS, l: RateLimiter = limiter): Response | null {
  const d = l.check(`${name}:${key}`, LIMITS[name]);
  if (d.allowed) return null;
  return new Response(JSON.stringify({ error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests; try again later' } }), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(Math.ceil(d.retryAfterMs / 1000)) } });
}
