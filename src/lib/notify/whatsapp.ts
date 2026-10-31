// =====================================================================
// WhatsApp Business Cloud API (Meta) client + webhook verification.
//
//   POST https://graph.facebook.com/{version}/{phone-number-id}/messages
//        Authorization: Bearer {access token}
//        {"messaging_product":"whatsapp","to":"9647XXXXXXXXX","type":"template",
//         "template":{"name":..,"language":{"code":"ar"},"components":[{"type":"body","parameters":[{"type":"text","text":..}]}]}}
//        -> {"messages":[{"id":"wamid..."}]}
//   Business-initiated messages outside the 24-hour customer window must be approved templates.
//   Webhook GET  ?hub.mode=subscribe&hub.verify_token=..&hub.challenge=..  -> echo the challenge
//   Webhook POST header X-Hub-Signature-256: "sha256=" + HMAC-SHA256(app secret, raw body)
//
// Credentials come from the environment only (WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID,
// WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN, WHATSAPP_GRAPH_VERSION); never stored or logged.
// =====================================================================
import { createHmac, timingSafeEqual } from 'node:crypto';

export class WhatsAppError extends Error {
  constructor(public readonly code: 'NOT_CONFIGURED' | 'RATE_LIMITED' | 'REJECTED' | 'UNREACHABLE' | 'BAD_RESPONSE', message: string, public readonly status?: number, public readonly retryable = false) {
    super(message);
    this.name = 'WhatsAppError';
  }
}

export interface WhatsAppConfig { token: string; phoneNumberId: string; version?: string; baseUrl?: string; fetch?: typeof fetch; timeoutMs?: number }

export class WhatsAppClient {
  private readonly base: string;
  private readonly f: typeof fetch;
  constructor(private readonly cfg: WhatsAppConfig) {
    if (!cfg.token || !cfg.phoneNumberId) throw new WhatsAppError('NOT_CONFIGURED', 'WhatsApp token or phone number id missing');
    this.base = (cfg.baseUrl || 'https://graph.facebook.com').replace(/\/+$/, '') + '/' + (cfg.version || 'v21.0');
    this.f = cfg.fetch || fetch;
  }
  static fromEnv(env: Record<string, string | undefined> = process.env, f?: typeof fetch): WhatsAppClient | null {
    if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) return null;
    return new WhatsAppClient({ token: env.WHATSAPP_TOKEN, phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID, version: env.WHATSAPP_GRAPH_VERSION, baseUrl: env.WHATSAPP_BASE_URL, fetch: f });
  }

  async sendTemplate(to: string, name: string, lang: string, bodyParams: string[]): Promise<{ id: string }> {
    return this.post({ messaging_product: 'whatsapp', to, type: 'template', template: { name, language: { code: lang }, components: bodyParams.length ? [{ type: 'body', parameters: bodyParams.map((t) => ({ type: 'text', text: t })) }] : [] } });
  }
  async sendText(to: string, text: string): Promise<{ id: string }> {
    return this.post({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text, preview_url: false } });
  }

  private async post(payload: unknown): Promise<{ id: string }> {
    let res: Response;
    try {
      res = await this.f(`${this.base}/${encodeURIComponent(this.cfg.phoneNumberId)}/messages`, {
        method: 'POST', headers: { Authorization: `Bearer ${this.cfg.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 15000),
      });
    } catch (e) { throw new WhatsAppError('UNREACHABLE', 'WhatsApp API unreachable: ' + (e as Error).message, undefined, true); }
    const j = (await res.json().catch(() => null)) as { messages?: { id: string }[]; error?: { message?: string; code?: number } } | null;
    if (res.status === 429) throw new WhatsAppError('RATE_LIMITED', 'rate limited', 429, true);
    if (res.status >= 500) throw new WhatsAppError('UNREACHABLE', `WhatsApp API ${res.status}`, res.status, true);
    if (!res.ok) throw new WhatsAppError('REJECTED', (j && j.error && j.error.message) || `HTTP ${res.status}`, res.status, false);
    const id = j && j.messages && j.messages[0] && j.messages[0].id;
    if (!id) throw new WhatsAppError('BAD_RESPONSE', 'no message id in the response', res.status, false);
    return { id };
  }
}

/** Constant-time check of Meta's X-Hub-Signature-256 over the RAW request body. */
export function verifyMetaSignature(rawBody: Buffer | string, header: string | null | undefined, appSecret: string): boolean {
  if (!header || !appSecret || !header.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const got = Buffer.from(header.slice(7), 'hex');
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** GET verification handshake: returns the challenge to echo, or null (respond 403). */
export function verifyHandshake(q: URLSearchParams, verifyToken: string): string | null {
  if (!verifyToken) return null;
  return q.get('hub.mode') === 'subscribe' && q.get('hub.verify_token') === verifyToken ? q.get('hub.challenge') : null;
}

export interface DeliveryStatus { messageId: string; status: 'sent' | 'delivered' | 'read' | 'failed'; recipient: string; timestamp: number; error?: string }
/** Delivery receipts from a (signature-verified) webhook body. */
export function parseStatuses(body: unknown): DeliveryStatus[] {
  const out: DeliveryStatus[] = [];
  const entries = (body as { entry?: { changes?: { value?: { statuses?: { id: string; status: string; recipient_id: string; timestamp: string; errors?: { title?: string }[] }[] } }[] }[] })?.entry || [];
  for (const e of entries) for (const c of e.changes || []) for (const s of c.value?.statuses || []) {
    if (!['sent', 'delivered', 'read', 'failed'].includes(s.status)) continue;
    out.push({ messageId: s.id, status: s.status as DeliveryStatus['status'], recipient: s.recipient_id, timestamp: Number(s.timestamp) * 1000, error: s.errors && s.errors[0] && s.errors[0].title });
  }
  return out;
}
