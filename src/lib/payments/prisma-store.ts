// Prisma adapter for PaymentStore. STATUS: IMPLEMENTED_BUT_UNVERIFIED (needs `prisma generate` + a database).
import { db } from '@/lib/db';
import type { PaymentStore } from './service';
import type { Invoice, Payment, Provider } from './types';

const toInv = (r: any): Invoice => ({ id: r.id, number: r.number, orderId: r.orderId, customerId: r.customerId, lines: JSON.parse(r.lines), totalIqd: r.totalIqd, status: r.status, issuedAt: +r.issuedAt, paidAt: r.paidAt ? +r.paidAt : undefined, refundedAt: r.refundedAt ? +r.refundedAt : undefined });
const toPay = (r: any): Payment => ({ id: r.id, invoiceId: r.invoiceId, provider: r.provider, amountIqd: r.amountIqd, status: r.status, providerRef: r.providerRef || undefined, redirectUrl: r.redirectUrl || undefined, refundRequestedAt: r.refundRequestedAt ? +r.refundRequestedAt : undefined, refundReason: r.refundReason || undefined, createdAt: +r.createdAt, updatedAt: +r.updatedAt, events: JSON.parse(r.events) });

export const prismaPaymentStore: PaymentStore = {
  async nextInvoiceSeq(year) {
    const r = await db.invoiceCounter.upsert({ where: { year }, create: { year, seq: 1 }, update: { seq: { increment: 1 } } });
    return r.seq;
  },
  async putInvoice(i) {
    const data = { number: i.number, orderId: i.orderId, customerId: i.customerId, lines: JSON.stringify(i.lines), totalIqd: i.totalIqd, status: i.status, issuedAt: new Date(i.issuedAt), paidAt: i.paidAt ? new Date(i.paidAt) : null, refundedAt: i.refundedAt ? new Date(i.refundedAt) : null };
    await db.invoice.upsert({ where: { id: i.id }, create: { id: i.id, ...data }, update: data });
  },
  async getInvoice(id) { const r = await db.invoice.findUnique({ where: { id } }); return r ? toInv(r) : null; },
  async putPayment(p) {
    const data = { invoiceId: p.invoiceId, provider: p.provider, amountIqd: p.amountIqd, status: p.status, providerRef: p.providerRef || null, redirectUrl: p.redirectUrl || null, refundRequestedAt: p.refundRequestedAt ? new Date(p.refundRequestedAt) : null, refundReason: p.refundReason || null, events: JSON.stringify(p.events), createdAt: new Date(p.createdAt), updatedAt: new Date(p.updatedAt) };
    await db.payment.upsert({ where: { id: p.id }, create: { id: p.id, ...data }, update: data });
  },
  async getPayment(id) { const r = await db.payment.findUnique({ where: { id } }); return r ? toPay(r) : null; },
  async byProviderRef(provider: Provider, ref: string) { const r = await db.payment.findFirst({ where: { provider, providerRef: ref } }); return r ? toPay(r) : null; },
  async openPayments(olderThan, limit) { return (await db.payment.findMany({ where: { createdAt: { lte: new Date(olderThan) }, OR: [{ status: { in: ['PENDING', 'PROCESSING'] } }, { status: 'PAID', refundRequestedAt: { not: null } }] }, take: limit })).map(toPay); },
  async seenEvent(key) { return !!(await db.processedPaymentEvent.findUnique({ where: { key } })); },
  async markEvent(key) { await db.processedPaymentEvent.upsert({ where: { key }, create: { key }, update: {} }); },
  async audit(e) {
    await db.auditEvent.create({ data: { actorId: e.actorId, action: e.action, resourceType: e.paymentId ? 'payment' : 'invoice', resourceId: e.paymentId || e.invoiceId || null, metadata: JSON.stringify({ detail: e.detail, invoiceId: e.invoiceId }) } }).catch(() => {});
  },
};
