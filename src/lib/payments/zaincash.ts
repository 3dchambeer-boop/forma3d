// =====================================================================
// ZainCash Payment Gateway v2 (https://docs.zaincash.iq/)
//   POST {base}/oauth2/token                                  client_credentials → access_token
//   POST {base}/api/v2/payment-gateway/transaction/init       → { transactionId, redirectUrl }
//   GET  {base}/api/v2/payment-gateway/transaction/inquiry/{transactionId}
//   POST {base}/api/v2/payment-gateway/transaction/reverse    { transactionId, reason }
//   Redirect back: successUrl|failureUrl ?token=<JWT HS256>; webhook POST { webhook_token: <JWT> }
//   Statuses: PENDING, OTP_SENT, CUSTOMER_AUTHENTICATION_REQUIRED, SUCCESS, FAILED, EXPIRED, REFUNDED
// Test base: https://pg-api-uat.zaincash.iq — production base is issued at onboarding (ZAINCASH_BASE_URL).
// Credentials only from the environment. STATUS: tested against a local simulator of this contract.
// =====================================================================
import { verifyHS256 } from './jwt.ts';
import type { PaymentStatus } from './types.ts';

export interface ZainCashConfig { baseUrl: string; clientId: string; clientSecret: string; apiKey: string; serviceType: string; fetch?: typeof fetch }
export class ZainCashError extends Error { constructor(public readonly code: string, message: string, public readonly status?: number) { super(message); this.name = 'ZainCashError'; } }

export function mapZainStatus(s: string): PaymentStatus {
  switch (s) {
    case 'SUCCESS': return 'PAID';
    case 'FAILED': case 'EXPIRED': return 'FAILED';
    case 'REFUNDED': return 'REFUNDED';
    case 'PENDING': return 'PENDING';
    case 'OTP_SENT': case 'CUSTOMER_AUTHENTICATION_REQUIRED': return 'PROCESSING';
    default: throw new ZainCashError('UNKNOWN_STATUS', 'unknown ZainCash status ' + s);
  }
}

export class ZainCashClient {
  private token: { value: string; until: number } | null = null;
  constructor(private readonly cfg: ZainCashConfig) {
    for (const k of ['baseUrl', 'clientId', 'clientSecret', 'apiKey', 'serviceType'] as const) if (!cfg[k]) throw new ZainCashError('NOT_CONFIGURED', 'ZainCash ' + k + ' missing');
  }
  static fromEnv(env: Record<string, string | undefined> = process.env, f?: typeof fetch): ZainCashClient | null {
    const c = { baseUrl: env.ZAINCASH_BASE_URL || '', clientId: env.ZAINCASH_CLIENT_ID || '', clientSecret: env.ZAINCASH_CLIENT_SECRET || '', apiKey: env.ZAINCASH_API_KEY || '', serviceType: env.ZAINCASH_SERVICE_TYPE || '', fetch: f };
    return c.baseUrl && c.clientId && c.clientSecret && c.apiKey && c.serviceType ? new ZainCashClient(c) : null;
  }
  private get f() { return this.cfg.fetch || fetch; }
  private url(p: string) { return this.cfg.baseUrl.replace(/\/+$/, '') + p; }

  private async bearer(now = Date.now()): Promise<string> {
    if (this.token && this.token.until > now + 10_000) return this.token.value;
    const res = await this.f(this.url('/oauth2/token'), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret, scope: 'payment:read payment:write reverse:write' }).toString(), signal: AbortSignal.timeout(15000) });
    const j = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
    if (!res.ok || !j || !j.access_token) throw new ZainCashError('AUTH', 'ZainCash token request failed', res.status);
    this.token = { value: j.access_token, until: now + (j.expires_in || 300) * 1000 };
    return this.token.value;
  }
  private async call(method: string, p: string, body?: unknown) {
    const res = await this.f(this.url(p), { method, headers: { Authorization: `Bearer ${await this.bearer()}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
    const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) throw new ZainCashError(String((j && (j.code || j.error)) || 'HTTP_' + res.status), String((j && j.message) || 'ZainCash HTTP ' + res.status), res.status);
    return j || {};
  }

  async init(o: { externalReferenceId: string; orderId: string; amountIqd: number; successUrl: string; failureUrl: string; language?: 'Ar' | 'En' | 'Ku'; customerPhone?: string }) {
    if (!Number.isInteger(o.amountIqd) || o.amountIqd <= 0) throw new ZainCashError('BAD_AMOUNT', 'amount must be a positive whole number of IQD');
    const j = await this.call('POST', '/api/v2/payment-gateway/transaction/init', { language: o.language || 'Ar', externalReferenceId: o.externalReferenceId, orderId: o.orderId, serviceType: this.cfg.serviceType, amount: { value: o.amountIqd, currency: 'IQD' }, ...(o.customerPhone ? { customer: { phone: o.customerPhone } } : {}), redirectUrls: { successUrl: o.successUrl, failureUrl: o.failureUrl } });
    const tx = (j.transactionId || (j.data as Record<string, unknown> | undefined)?.transactionId) as string | undefined, red = (j.redirectUrl || (j.data as Record<string, unknown> | undefined)?.redirectUrl) as string | undefined;
    if (!tx || !red) throw new ZainCashError('BAD_RESPONSE', 'init response lacks transactionId/redirectUrl');
    return { transactionId: tx, redirectUrl: red };
  }
  async inquiry(transactionId: string): Promise<{ status: PaymentStatus; raw: string; amountIqd?: number }> {
    const j = await this.call('GET', '/api/v2/payment-gateway/transaction/inquiry/' + encodeURIComponent(transactionId));
    const d = (j.data as Record<string, unknown>) || j, st = String(d.status || '');
    const amt = (d.amount as { value?: number } | undefined)?.value;
    return { status: mapZainStatus(st), raw: st, amountIqd: typeof amt === 'number' ? amt : undefined };
  }
  async reverse(transactionId: string, reason: string) { return this.call('POST', '/api/v2/payment-gateway/transaction/reverse', { transactionId, reason }); }

  /** Verifies a redirect `token` or a webhook `webhook_token` (HS256 with the merchant API key). */
  verifyToken(token: string, now?: number) { return verifyHS256(token, this.cfg.apiKey, now); }
}
