// =====================================================================
// Notification service: one event → per-channel deliveries in an outbox.
//
//   enqueue(event)   resolves recipients' preferences, renders the Arabic/English text, writes one
//                    delivery per enabled channel with an idempotency key (event id + user + channel),
//                    so re-sending the same event never duplicates a message.
//   dispatch(now)    sends due deliveries; transient failures (network, 429, 5xx) are retried with
//                    exponential backoff up to MAX_ATTEMPTS; permanent ones (4xx) stop at once.
//   applyReceipt()   WhatsApp delivery receipts (from a signature-verified webhook) update status.
//
// Contact details are read from the user record by the server at send time and are never copied
// into the event, the delivery log shown to staff, or error messages.
// =====================================================================
import { EmailClient, EmailError } from './email.ts';
import { normalizeIraqiMobile } from './phone.ts';
import { WhatsAppClient, WhatsAppError, type DeliveryStatus } from './whatsapp.ts';

export type Channel = 'inapp' | 'email' | 'whatsapp';
export type EventType = 'design_ready' | 'review_changes' | 'design_approved' | 'quote_ready' | 'invoice_issued' | 'payment_received' | 'payment_failed' | 'print_queued' | 'print_started' | 'print_done' | 'print_failed' | 'ready_for_pickup';

export interface NotifyEvent { id: string; type: EventType; userIds: string[]; vars: Record<string, string | number>; link?: string; at: number }
export interface Recipient { id: string; locale: 'ar' | 'en'; email?: string | null; phone?: string | null; emailVerified?: boolean; phoneVerified?: boolean }
export interface Preferences { channels: Partial<Record<Channel, boolean>>; muted?: EventType[] }
export interface Delivery {
  key: string; eventId: string; userId: string; channel: Channel; type: EventType; title: string; body: string; link?: string;
  vars: Record<string, string>; // template values (project name, amount…) — never contact details
  status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed'; attempts: number; nextAttemptAt: number; providerId?: string; lastError?: string; createdAt: number; updatedAt: number;
}
export interface NotifyStore {
  recipient(userId: string): Promise<Recipient | null>;
  preferences(userId: string): Promise<Preferences | null>;
  getDelivery(key: string): Promise<Delivery | null>;
  putDelivery(d: Delivery): Promise<void>;
  due(now: number, limit: number): Promise<Delivery[]>;
  byProviderId(id: string): Promise<Delivery | null>;
  inApp(userId: string, title: string, body: string, link?: string): Promise<void>;
}

export const MAX_ATTEMPTS = 5;
export const backoffMs = (attempt: number) => Math.min(60 * 60_000, 30_000 * 2 ** (attempt - 1)); // 30 s, 1 min, 2 min, 4 min…
export const DEFAULT_PREFS: Preferences = { channels: { inapp: true, email: true, whatsapp: false } }; // WhatsApp is opt-in

// Template names must match templates approved in Meta Business Manager (body variables in this order).
export const TEMPLATES: Record<EventType, { wa: string; vars: string[]; ar: [string, string]; en: [string, string] }> = {
  design_ready: { wa: 'forma_design_ready', vars: ['project'], ar: ['تصميمك جاهز', 'تصميم «{project}» جاهز للمراجعة.'], en: ['Your design is ready', 'Design "{project}" is ready for review.'] },
  review_changes: { wa: 'forma_review_changes', vars: ['project', 'note'], ar: ['مطلوب تعديل', 'طلب المراجع تعديل «{project}»: {note}'], en: ['Changes requested', 'The reviewer asked for changes to "{project}": {note}'] },
  design_approved: { wa: 'forma_design_approved', vars: ['project'], ar: ['اعتُمد التصميم', 'اعتُمد تصميم «{project}». يمكنك طلب الطباعة.'], en: ['Design approved', '"{project}" was approved. You can order the print.'] },
  quote_ready: { wa: 'forma_quote_ready', vars: ['project', 'amount'], ar: ['عرض السعر جاهز', 'عرض سعر «{project}»: {amount} د.ع.'], en: ['Quote ready', 'Quote for "{project}": IQD {amount}.'] },
  invoice_issued: { wa: 'forma_invoice_issued', vars: ['invoice', 'amount'], ar: ['فاتورة جديدة', 'الفاتورة {invoice} بمبلغ {amount} د.ع.'], en: ['New invoice', 'Invoice {invoice}: IQD {amount}.'] },
  payment_received: { wa: 'forma_payment_received', vars: ['invoice', 'amount'], ar: ['استلمنا الدفع', 'استلمنا {amount} د.ع للفاتورة {invoice}. شكرًا لك.'], en: ['Payment received', 'We received IQD {amount} for invoice {invoice}.'] },
  payment_failed: { wa: 'forma_payment_failed', vars: ['invoice'], ar: ['لم يكتمل الدفع', 'لم يكتمل دفع الفاتورة {invoice}. يمكنك المحاولة مرة أخرى.'], en: ['Payment not completed', 'Payment for invoice {invoice} did not complete.'] },
  print_queued: { wa: 'forma_print_queued', vars: ['project'], ar: ['في طابور الطباعة', '«{project}» في طابور الطباعة.'], en: ['Queued for printing', '"{project}" is in the print queue.'] },
  print_started: { wa: 'forma_print_started', vars: ['project'], ar: ['بدأت الطباعة', 'بدأت طباعة «{project}».'], en: ['Printing started', 'Printing of "{project}" has started.'] },
  print_done: { wa: 'forma_print_done', vars: ['project'], ar: ['اكتملت الطباعة', 'اكتملت طباعة «{project}».'], en: ['Print finished', '"{project}" has finished printing.'] },
  print_failed: { wa: 'forma_print_failed', vars: ['project'], ar: ['تعذّرت الطباعة', 'تعذّرت طباعة «{project}» وسنعيدها. سنبلغك بالجديد.'], en: ['Print failed', 'Printing "{project}" failed; we will retry and keep you posted.'] },
  ready_for_pickup: { wa: 'forma_ready_for_pickup', vars: ['project'], ar: ['جاهز للاستلام', '«{project}» جاهز للاستلام.'], en: ['Ready for pickup', '"{project}" is ready for pickup.'] },
};

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));

export class NotificationService {
  constructor(private readonly store: NotifyStore, private readonly channels: { email?: EmailClient | null; whatsapp?: WhatsAppClient | null } = {}, private readonly clock: () => number = Date.now) {}

  async enqueue(ev: NotifyEvent): Promise<Delivery[]> {
    const tpl = TEMPLATES[ev.type];
    if (!tpl) throw new Error('unknown event type ' + ev.type);
    const out: Delivery[] = [];
    for (const userId of new Set(ev.userIds)) {
      const r = await this.store.recipient(userId);
      if (!r) continue;
      const prefs = (await this.store.preferences(userId)) || DEFAULT_PREFS;
      if (prefs.muted && prefs.muted.includes(ev.type)) continue;
      const [title, body] = (r.locale === 'en' ? tpl.en : tpl.ar).map((s) => fill(s, ev.vars));
      for (const channel of ['inapp', 'email', 'whatsapp'] as Channel[]) {
        const on = prefs.channels[channel] ?? DEFAULT_PREFS.channels[channel];
        if (!on) continue;
        if (channel === 'email' && !(r.email && r.emailVerified)) continue;
        if (channel === 'whatsapp' && !(r.phone && r.phoneVerified && normalizeIraqiMobile(r.phone))) continue;
        const key = `${ev.id}:${userId}:${channel}`;
        const existing = await this.store.getDelivery(key);
        if (existing) { out.push(existing); continue; } // idempotent: the same event never sends twice
        const now = this.clock();
        const vars = Object.fromEntries(Object.entries(ev.vars).map(([k, v]) => [k, String(v)]));
        const d: Delivery = { key, eventId: ev.id, userId, channel, type: ev.type, title, body, link: ev.link, vars, status: 'queued', attempts: 0, nextAttemptAt: now, createdAt: now, updatedAt: now };
        await this.store.putDelivery(d);
        out.push(d);
      }
    }
    return out;
  }

  async dispatch(limit = 50): Promise<{ sent: number; retried: number; failed: number }> {
    const now = this.clock(), stats = { sent: 0, retried: 0, failed: 0 };
    for (const d of await this.store.due(now, limit)) {
      if (d.status !== 'queued' || d.nextAttemptAt > now) continue;
      d.attempts += 1; d.updatedAt = now;
      try {
        const id = await this.sendOne(d);
        Object.assign(d, { status: 'sent', providerId: id, lastError: undefined });
        stats.sent++;
      } catch (e) {
        const retryable = (e instanceof WhatsAppError || e instanceof EmailError) ? e.retryable : false;
        d.lastError = (e as Error).message.slice(0, 200);
        if (retryable && d.attempts < MAX_ATTEMPTS) { d.nextAttemptAt = now + backoffMs(d.attempts); stats.retried++; }
        else { d.status = 'failed'; stats.failed++; }
      }
      await this.store.putDelivery(d);
    }
    return stats;
  }

  private async sendOne(d: Delivery): Promise<string | undefined> {
    if (d.channel === 'inapp') { await this.store.inApp(d.userId, d.title, d.body, d.link); return undefined; }
    const r = await this.store.recipient(d.userId); // contact details read now, never stored on the delivery
    if (!r) throw new Error('recipient no longer exists');
    if (d.channel === 'email') {
      if (!this.channels.email) throw new EmailError('NOT_CONFIGURED', 'e-mail is not configured');
      return (await this.channels.email.send({ to: r.email || '', subject: d.title, text: d.body + (d.link ? '\n\n' + d.link : '') })).id;
    }
    if (!this.channels.whatsapp) throw new WhatsAppError('NOT_CONFIGURED', 'WhatsApp is not configured');
    const to = normalizeIraqiMobile(r.phone || '');
    if (!to) throw new WhatsAppError('REJECTED', 'no valid mobile number');
    const tpl = TEMPLATES[d.type];
    return (await this.channels.whatsapp.sendTemplate(to, tpl.wa, r.locale === 'en' ? 'en' : 'ar', tpl.vars.map((k) => d.vars[k] ?? ''))).id;
  }

  async applyReceipt(s: DeliveryStatus): Promise<boolean> {
    const d = await this.store.byProviderId(s.messageId);
    if (!d) return false;
    const rank = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4 } as const;
    if (s.status === 'failed' || rank[s.status] > rank[d.status]) { d.status = s.status; d.lastError = s.error; d.updatedAt = this.clock(); await this.store.putDelivery(d); }
    return true;
  }
}

/** In-memory store (tests and the single-file offline build). */
export class MemoryNotifyStore implements NotifyStore {
  users = new Map<string, Recipient>(); prefs = new Map<string, Preferences>(); deliveries = new Map<string, Delivery>(); inbox: { userId: string; title: string; body: string; link?: string }[] = [];
  async recipient(id: string) { return this.users.get(id) || null; }
  async preferences(id: string) { return this.prefs.get(id) || null; }
  async getDelivery(k: string) { return this.deliveries.get(k) || null; }
  async putDelivery(d: Delivery) { this.deliveries.set(d.key, { ...d }); }
  async due(now: number, limit: number) { return [...this.deliveries.values()].filter((d) => d.status === 'queued' && d.nextAttemptAt <= now).slice(0, limit).map((d) => ({ ...d })); }
  async byProviderId(id: string) { const d = [...this.deliveries.values()].find((x) => x.providerId === id); return d ? { ...d } : null; }
  async inApp(userId: string, title: string, body: string, link?: string) { this.inbox.push({ userId, title, body, link }); }
}
