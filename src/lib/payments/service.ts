// =====================================================================
// Payment service: invoices → payment attempts → verified provider events → state changes.
//
// Rules enforced here (not in the browser):
//   * a payment becomes PAID only from (a) a ZainCash token whose HS256 signature verifies AND a server-side
//     inquiry that returns SUCCESS for the same amount, (b) a FIB status query returning PAID for the same
//     amount (the FIB callback body itself is unsigned and ignored), or (c) a manual record by an admin with a
//     reference, kept in the audit trail;
//   * every provider event is processed once (idempotency by event id);
//   * an amount that differs from the invoice never marks anything paid — it is flagged for review;
//   * states only move along the allowed transitions (types.ts).
// =====================================================================
import { randomUUID } from 'node:crypto';
import { FibClient } from './fib.ts';
import { canMove, invoiceNumber, invoiceTotal, type Invoice, type InvoiceLine, type Payment, type PaymentStatus, type Provider } from './types.ts';
import { ZainCashClient } from './zaincash.ts';

export interface PaymentStore {
  nextInvoiceSeq(year: number): Promise<number>;
  putInvoice(i: Invoice): Promise<void>; getInvoice(id: string): Promise<Invoice | null>;
  putPayment(p: Payment): Promise<void>; getPayment(id: string): Promise<Payment | null>; byProviderRef(provider: Provider, ref: string): Promise<Payment | null>;
  openPayments(olderThan: number, limit: number): Promise<Payment[]>; // PENDING / PROCESSING (or PAID with a refund in progress), created before `olderThan`
  seenEvent(key: string): Promise<boolean>; markEvent(key: string): Promise<void>;
  audit(entry: { at: number; actorId: string | null; action: string; paymentId?: string; invoiceId?: string; detail: string }): Promise<void>;
}
export interface PaymentHooks { onPaid?(inv: Invoice, p: Payment): Promise<void>; onFailed?(inv: Invoice, p: Payment): Promise<void> }
export class PaymentError extends Error { constructor(public readonly code: string, message: string) { super(message); this.name = 'PaymentError'; } }

export class PaymentService {
  constructor(private readonly store: PaymentStore, private readonly providers: { zaincash?: ZainCashClient | null; fib?: FibClient | null }, private readonly hooks: PaymentHooks = {}, private readonly clock: () => number = Date.now) {}

  async issueInvoice(orderId: string, customerId: string, lines: InvoiceLine[], actorId: string): Promise<Invoice> {
    const total = invoiceTotal(lines);
    if (total <= 0) throw new PaymentError('EMPTY_INVOICE', 'the invoice total must be above zero');
    const now = this.clock(), year = new Date(now).getUTCFullYear();
    const inv: Invoice = { id: randomUUID(), number: invoiceNumber(await this.store.nextInvoiceSeq(year), year), orderId, customerId, lines, totalIqd: total, status: 'ISSUED', issuedAt: now };
    await this.store.putInvoice(inv);
    await this.store.audit({ at: now, actorId, action: 'invoice.issued', invoiceId: inv.id, detail: `${inv.number} ${total} IQD` });
    return inv;
  }

  async startPayment(invoiceId: string, provider: 'zaincash' | 'fib', urls: { successUrl: string; failureUrl: string; callbackUrl?: string }) {
    const inv = await this.store.getInvoice(invoiceId);
    if (!inv) throw new PaymentError('NOT_FOUND', 'invoice not found');
    if (inv.status !== 'ISSUED') throw new PaymentError('NOT_PAYABLE', 'invoice is ' + inv.status);
    const now = this.clock(), id = randomUUID();
    const p: Payment = { id, invoiceId, provider, amountIqd: inv.totalIqd, status: 'PENDING', createdAt: now, updatedAt: now, events: [] };
    if (provider === 'zaincash') {
      if (!this.providers.zaincash) throw new PaymentError('NOT_CONFIGURED', 'ZainCash is not configured');
      const r = await this.providers.zaincash.init({ externalReferenceId: id, orderId: inv.number, amountIqd: inv.totalIqd, successUrl: urls.successUrl, failureUrl: urls.failureUrl });
      Object.assign(p, { providerRef: r.transactionId, redirectUrl: r.redirectUrl });
    } else {
      if (!this.providers.fib) throw new PaymentError('NOT_CONFIGURED', 'FIB is not configured');
      const r = await this.providers.fib.create(inv.totalIqd, inv.number, urls.callbackUrl);
      Object.assign(p, { providerRef: r.paymentId, redirectUrl: r.personalAppLink || r.businessAppLink });
    }
    await this.store.putPayment(p);
    await this.store.audit({ at: now, actorId: inv.customerId, action: 'payment.started', paymentId: id, invoiceId, detail: provider });
    return p;
  }

  private async move(p: Payment, to: PaymentStatus, source: string, ref?: string, amountSeen?: number): Promise<Payment> {
    const inv = await this.store.getInvoice(p.invoiceId);
    if (!inv) throw new PaymentError('NOT_FOUND', 'invoice not found');
    if (to === 'PAID' && amountSeen !== undefined && amountSeen !== p.amountIqd) {
      await this.store.audit({ at: this.clock(), actorId: null, action: 'payment.amount_mismatch', paymentId: p.id, invoiceId: inv.id, detail: `provider ${amountSeen} vs invoice ${p.amountIqd}` });
      throw new PaymentError('AMOUNT_MISMATCH', 'the provider amount does not match the invoice; flagged for review');
    }
    if (p.status === to) return p;
    if (!canMove(p.status, to)) {
      await this.store.audit({ at: this.clock(), actorId: null, action: 'payment.transition_refused', paymentId: p.id, detail: `${p.status} -> ${to} (${source})` });
      return p;
    }
    const now = this.clock();
    p.events.push({ at: now, from: p.status, to, source, ref });
    p.status = to; p.updatedAt = now;
    await this.store.putPayment(p);
    if (to === 'PAID') { inv.status = 'PAID'; inv.paidAt = now; await this.store.putInvoice(inv); }
    if (to === 'REFUNDED') { inv.status = 'REFUNDED'; inv.refundedAt = now; await this.store.putInvoice(inv); }
    await this.store.audit({ at: now, actorId: null, action: 'payment.' + to.toLowerCase(), paymentId: p.id, invoiceId: inv.id, detail: source });
    if (to === 'PAID' && this.hooks.onPaid) await this.hooks.onPaid(inv, p);
    if (to === 'FAILED' && this.hooks.onFailed) await this.hooks.onFailed(inv, p);
    return p;
  }

  /** ZainCash: redirect `token` or webhook `webhook_token`. Signature first, then the server-side inquiry decides. */
  async zaincashToken(token: string, kind: 'redirect' | 'webhook'): Promise<Payment> {
    const z = this.providers.zaincash;
    if (!z) throw new PaymentError('NOT_CONFIGURED', 'ZainCash is not configured');
    let claims: Record<string, unknown>;
    try { claims = z.verifyToken(token, this.clock()); } catch (e) { throw new PaymentError('BAD_SIGNATURE', (e as Error).message); }
    const data = (claims.data as Record<string, unknown>) || claims;
    const tx = String(data.transactionId || data.id || ''), eventId = String(data.eventId || claims.eventId || claims.jti || '');
    if (!tx) throw new PaymentError('BAD_PAYLOAD', 'token carries no transaction id');
    const key = `zaincash:${kind}:${eventId || tx + ':' + String(data.status || '')}`;
    const p = await this.store.byProviderRef('zaincash', tx);
    if (!p) throw new PaymentError('NOT_FOUND', 'unknown transaction');
    if (await this.store.seenEvent(key)) return p; // duplicate delivery
    const q = await z.inquiry(tx);
    const out = await this.move(p, q.status, `zaincash ${kind} + inquiry ${q.raw}`, tx, q.amountIqd);
    await this.store.markEvent(key);
    return out;
  }

  /** FIB callback: the body is unsigned, so only the payment id is used and FIB is asked for the real status. */
  async fibCallback(body: unknown): Promise<Payment> {
    const f = this.providers.fib;
    if (!f) throw new PaymentError('NOT_CONFIGURED', 'FIB is not configured');
    const id = String((body as { id?: string })?.id || '');
    if (!id) throw new PaymentError('BAD_PAYLOAD', 'callback without payment id');
    const p = await this.store.byProviderRef('fib', id);
    if (!p) throw new PaymentError('NOT_FOUND', 'unknown payment');
    const s = await f.status(id);
    return this.move(p, s.status, `fib status ${s.raw}${s.decliningReason ? ' ' + s.decliningReason : ''}`, id, s.amountIqd);
  }

  /** Reconciliation for missed webhooks (ZainCash test environment has none; callbacks can be lost): ask the provider. */
  async reconcile(minAgeMs = 2 * 60_000, limit = 50): Promise<{ checked: number; changed: number; errors: number }> {
    const out = { checked: 0, changed: 0, errors: 0 };
    for (const p of await this.store.openPayments(this.clock() - minAgeMs, limit)) {
      if (!p.providerRef || p.provider === 'manual') continue;
      if (p.status === 'PAID' && !(p.refundRequestedAt && p.provider === 'zaincash')) continue;
      out.checked++;
      try {
        const q = p.provider === 'zaincash' ? await this.providers.zaincash!.inquiry(p.providerRef) : await this.providers.fib!.status(p.providerRef);
        const before = p.status, after = await this.move(p, q.status, `${p.provider} reconcile ${q.raw}`, p.providerRef, q.amountIqd);
        if (after.status !== before) out.changed++;
      } catch { out.errors++; }
    }
    return out;
  }

  /**
   * Refund a PAID payment (admin only, full amount, reason required).
   *  - ZainCash: the reverse API is called; the payment becomes REFUNDED only when the provider's own status says
   *    REFUNDED (immediately via inquiry, or later via the REFUND_COMPLETED webhook / reconciliation).
   *  - FIB publishes no refund API: the money is returned by bank transfer and the admin records its reference.
   *  - Manual payments: the same, with the reference of the cash/transfer return.
   */
  async refund(paymentId: string, actor: { id: string; role: string }, o: { reason: string; reference?: string }): Promise<Payment> {
    if (actor.role !== 'admin') throw new PaymentError('FORBIDDEN', 'only an admin can refund');
    if (!o.reason || o.reason.trim().length < 3) throw new PaymentError('REASON_REQUIRED', 'a refund reason is required');
    const p = await this.store.getPayment(paymentId);
    if (!p) throw new PaymentError('NOT_FOUND', 'payment not found');
    if (p.status !== 'PAID') throw new PaymentError('NOT_REFUNDABLE', 'only a PAID payment can be refunded (it is ' + p.status + ')');
    const now = this.clock();
    await this.store.audit({ at: now, actorId: actor.id, action: 'payment.refund_requested', paymentId: p.id, invoiceId: p.invoiceId, detail: `${p.provider}: ${o.reason.trim()}${o.reference ? ' ref ' + o.reference : ''}` });
    if (p.provider === 'zaincash') {
      if (!this.providers.zaincash) throw new PaymentError('NOT_CONFIGURED', 'ZainCash is not configured');
      if (p.refundRequestedAt) throw new PaymentError('REFUND_IN_PROGRESS', 'a refund was already requested for this payment');
      await this.providers.zaincash.reverse(p.providerRef!, o.reason.trim());
      p.refundRequestedAt = now; p.refundReason = o.reason.trim(); p.updatedAt = now;
      await this.store.putPayment(p);
      const q = await this.providers.zaincash.inquiry(p.providerRef!);
      return q.status === 'REFUNDED' ? this.move(p, 'REFUNDED', 'zaincash reverse + inquiry REFUNDED', p.providerRef) : p;
    }
    const ref = (o.reference || '').trim();
    if (ref.length < 3) throw new PaymentError('REFERENCE_REQUIRED', `${p.provider === 'fib' ? 'FIB has no refund API: return the money by transfer and' : ''} enter the reference of the returned money`.trim());
    return this.move(p, 'REFUNDED', `${p.provider} refund returned manually by ${actor.id}`, ref);
  }

  /** Cash, bank transfer or a provider dashboard confirmation, recorded by an admin — audited, never automatic. */
  async recordManual(invoiceId: string, actor: { id: string; role: string }, o: { method: 'cash' | 'transfer' | 'other'; reference: string; amountIqd: number }): Promise<Payment> {
    if (actor.role !== 'admin') throw new PaymentError('FORBIDDEN', 'only an admin can record a manual payment');
    if (!o.reference || o.reference.trim().length < 3) throw new PaymentError('REFERENCE_REQUIRED', 'a receipt or transfer reference is required');
    const inv = await this.store.getInvoice(invoiceId);
    if (!inv) throw new PaymentError('NOT_FOUND', 'invoice not found');
    if (inv.status !== 'ISSUED') throw new PaymentError('NOT_PAYABLE', 'invoice is ' + inv.status);
    const now = this.clock();
    const p: Payment = { id: randomUUID(), invoiceId, provider: 'manual', amountIqd: inv.totalIqd, status: 'PENDING', providerRef: o.reference.trim(), createdAt: now, updatedAt: now, events: [] };
    await this.store.putPayment(p);
    await this.store.audit({ at: now, actorId: actor.id, action: 'payment.manual_recorded', paymentId: p.id, invoiceId, detail: `${o.method} ref ${o.reference.trim()} amount ${o.amountIqd}` });
    return this.move(p, 'PAID', `manual ${o.method} by ${actor.id}`, o.reference.trim(), o.amountIqd);
  }
}

export class MemoryPaymentStore implements PaymentStore {
  seq = new Map<number, number>(); invoices = new Map<string, Invoice>(); payments = new Map<string, Payment>(); events = new Set<string>(); log: { at: number; actorId: string | null; action: string; paymentId?: string; invoiceId?: string; detail: string }[] = [];
  async nextInvoiceSeq(y: number) { const n = (this.seq.get(y) || 0) + 1; this.seq.set(y, n); return n; }
  async putInvoice(i: Invoice) { this.invoices.set(i.id, structuredClone(i)); }
  async getInvoice(id: string) { const i = this.invoices.get(id); return i ? structuredClone(i) : null; }
  async putPayment(p: Payment) { this.payments.set(p.id, structuredClone(p)); }
  async getPayment(id: string) { const p = this.payments.get(id); return p ? structuredClone(p) : null; }
  async byProviderRef(pr: Provider, ref: string) { const p = [...this.payments.values()].find((x) => x.provider === pr && x.providerRef === ref); return p ? structuredClone(p) : null; }
  async openPayments(olderThan: number, limit: number) { return [...this.payments.values()].filter((p) => (p.status === 'PENDING' || p.status === 'PROCESSING' || (p.status === 'PAID' && !!p.refundRequestedAt)) && p.createdAt <= olderThan).slice(0, limit).map((p) => structuredClone(p)); }
  async seenEvent(k: string) { return this.events.has(k); }
  async markEvent(k: string) { this.events.add(k); }
  async audit(e: MemoryPaymentStore['log'][number]) { this.log.push(e); }
}
