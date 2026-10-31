// =====================================================================
// First Iraqi Bank — Web Payments (https://fib.iq/developers/web-payment)
//   POST {base}/auth/realms/fib-online-shop/protocol/openid-connect/token   client_credentials
//   POST {base}/protected/v1/payments  {monetaryValue:{amount,currency:"IQD"}, statusCallbackUrl, description≤50}
//        → 202 {paymentId, qrCode, readableCode, businessAppLink, corporateAppLink, personalAppLink, validUntil}
//   GET  {base}/protected/v1/payments/{id}/status → {status: PAID|UNPAID|DECLINED, amount, paidAt, decliningReason…}
//   POST {base}/protected/v1/payments/{id}/cancel → 204
//   The status callback POSTs {id, status} and is NOT signed, so its body is never trusted:
//   it only triggers a server-side status query to FIB.
// Staging base: https://fib.stage.fib.iq — production base issued after FIB's integration form (FIB_BASE_URL).
// =====================================================================
import type { PaymentStatus } from './types.ts';

export interface FibConfig { baseUrl: string; clientId: string; clientSecret: string; fetch?: typeof fetch }
export class FibError extends Error { constructor(public readonly code: string, message: string, public readonly status?: number) { super(message); this.name = 'FibError'; } }

export function mapFibStatus(s: string): PaymentStatus {
  if (s === 'PAID') return 'PAID';
  if (s === 'UNPAID') return 'PENDING';
  if (s === 'DECLINED') return 'FAILED';
  throw new FibError('UNKNOWN_STATUS', 'unknown FIB status ' + s);
}

export class FibClient {
  private token: { value: string; until: number } | null = null;
  constructor(private readonly cfg: FibConfig) { if (!cfg.baseUrl || !cfg.clientId || !cfg.clientSecret) throw new FibError('NOT_CONFIGURED', 'FIB credentials missing'); }
  static fromEnv(env: Record<string, string | undefined> = process.env, f?: typeof fetch): FibClient | null {
    return env.FIB_BASE_URL && env.FIB_CLIENT_ID && env.FIB_CLIENT_SECRET ? new FibClient({ baseUrl: env.FIB_BASE_URL, clientId: env.FIB_CLIENT_ID, clientSecret: env.FIB_CLIENT_SECRET, fetch: f }) : null;
  }
  private get f() { return this.cfg.fetch || fetch; }
  private url(p: string) { return this.cfg.baseUrl.replace(/\/+$/, '') + p; }
  private async bearer(now = Date.now()) {
    if (this.token && this.token.until > now + 5_000) return this.token.value;
    const res = await this.f(this.url('/auth/realms/fib-online-shop/protocol/openid-connect/token'), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret }).toString(), signal: AbortSignal.timeout(15000) });
    const j = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
    if (!res.ok || !j || !j.access_token) throw new FibError('AUTH', 'FIB token request failed', res.status);
    this.token = { value: j.access_token, until: now + (j.expires_in || 60) * 1000 };
    return this.token.value;
  }
  async create(amountIqd: number, description: string, statusCallbackUrl?: string) {
    if (!Number.isInteger(amountIqd) || amountIqd <= 0) throw new FibError('BAD_AMOUNT', 'amount must be a positive whole number of IQD');
    const res = await this.f(this.url('/protected/v1/payments'), { method: 'POST', headers: { Authorization: `Bearer ${await this.bearer()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ monetaryValue: { amount: String(amountIqd), currency: 'IQD' }, description: description.slice(0, 50), ...(statusCallbackUrl ? { statusCallbackUrl } : {}) }), signal: AbortSignal.timeout(20000) });
    const j = (await res.json().catch(() => null)) as { paymentId?: string; readableCode?: string; qrCode?: string; personalAppLink?: string; businessAppLink?: string; validUntil?: string } | null;
    if (res.status !== 202 && res.status !== 200 && res.status !== 201) throw new FibError('REJECTED', 'FIB create payment HTTP ' + res.status, res.status);
    if (!j || !j.paymentId) throw new FibError('BAD_RESPONSE', 'no paymentId');
    return j as Required<Pick<typeof j, 'paymentId'>> & typeof j;
  }
  async status(paymentId: string): Promise<{ status: PaymentStatus; raw: string; amountIqd?: number; decliningReason?: string }> {
    const res = await this.f(this.url(`/protected/v1/payments/${encodeURIComponent(paymentId)}/status`), { headers: { Authorization: `Bearer ${await this.bearer()}` }, signal: AbortSignal.timeout(15000) });
    const j = (await res.json().catch(() => null)) as { status?: string; amount?: { amount?: number | string }; decliningReason?: string } | null;
    if (!res.ok || !j || !j.status) throw new FibError('BAD_RESPONSE', 'FIB status HTTP ' + res.status, res.status);
    const a = j.amount && j.amount.amount != null ? Number(j.amount.amount) : undefined;
    return { status: mapFibStatus(j.status), raw: j.status, amountIqd: a, decliningReason: j.decliningReason };
  }
  async cancel(paymentId: string) {
    const res = await this.f(this.url(`/protected/v1/payments/${encodeURIComponent(paymentId)}/cancel`), { method: 'POST', headers: { Authorization: `Bearer ${await this.bearer()}` }, signal: AbortSignal.timeout(15000) });
    if (res.status !== 204 && !res.ok) throw new FibError('REJECTED', 'FIB cancel HTTP ' + res.status, res.status);
  }
}
