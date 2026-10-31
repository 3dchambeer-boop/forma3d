// E-mail over an HTTPS provider API (no SMTP library needed). Implemented for the Resend-style
// contract: POST {base}/emails  Authorization: Bearer KEY  {"from","to":[..],"subject","html","text"}
// -> 200 {"id": ".."}. Any provider with the same shape works by changing EMAIL_API_URL.
// Keys come from the environment only (EMAIL_API_KEY, EMAIL_API_URL, EMAIL_FROM).

export class EmailError extends Error {
  constructor(public readonly code: 'NOT_CONFIGURED' | 'REJECTED' | 'UNREACHABLE' | 'RATE_LIMITED', message: string, public readonly retryable = false) { super(message); this.name = 'EmailError'; }
}
export interface EmailMessage { to: string; subject: string; text: string; html?: string }

export class EmailClient {
  constructor(private readonly cfg: { apiKey: string; from: string; url?: string; fetch?: typeof fetch }) {
    if (!cfg.apiKey || !cfg.from) throw new EmailError('NOT_CONFIGURED', 'EMAIL_API_KEY or EMAIL_FROM missing');
  }
  static fromEnv(env: Record<string, string | undefined> = process.env, f?: typeof fetch): EmailClient | null {
    return env.EMAIL_API_KEY && env.EMAIL_FROM ? new EmailClient({ apiKey: env.EMAIL_API_KEY, from: env.EMAIL_FROM, url: env.EMAIL_API_URL, fetch: f }) : null;
  }
  async send(m: EmailMessage): Promise<{ id: string }> {
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(m.to)) throw new EmailError('REJECTED', 'invalid recipient address');
    const f = this.cfg.fetch || fetch;
    let res: Response;
    try {
      res = await f((this.cfg.url || 'https://api.resend.com').replace(/\/+$/, '') + '/emails', { method: 'POST', headers: { Authorization: `Bearer ${this.cfg.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: this.cfg.from, to: [m.to], subject: m.subject, text: m.text, html: m.html || escapeHtml(m.text).replace(/\n/g, '<br>') }), signal: AbortSignal.timeout(15000) });
    } catch (e) { throw new EmailError('UNREACHABLE', (e as Error).message, true); }
    if (res.status === 429) throw new EmailError('RATE_LIMITED', 'rate limited', true);
    if (res.status >= 500) throw new EmailError('UNREACHABLE', 'HTTP ' + res.status, true);
    const j = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (!res.ok || !j || !j.id) throw new EmailError('REJECTED', (j && j.message) || 'HTTP ' + res.status);
    return { id: j.id };
  }
}
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
