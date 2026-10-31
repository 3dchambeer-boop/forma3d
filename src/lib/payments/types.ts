// Payment state machine. Only verified provider events (or an audited manual record by an admin)
// move a payment; nothing the browser says can mark an order paid.
export type PaymentStatus = 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED' | 'REFUNDED' | 'CANCELED';
export type Provider = 'zaincash' | 'fib' | 'manual';

const NEXT: Record<PaymentStatus, PaymentStatus[]> = {
  PENDING: ['PROCESSING', 'PAID', 'FAILED', 'CANCELED'],
  PROCESSING: ['PAID', 'FAILED', 'CANCELED'],
  PAID: ['REFUNDED'],
  FAILED: [], REFUNDED: [], CANCELED: [],
};
export const canMove = (from: PaymentStatus, to: PaymentStatus) => from === to || NEXT[from].includes(to);

export interface Payment {
  id: string; invoiceId: string; provider: Provider; amountIqd: number; status: PaymentStatus;
  providerRef?: string; // provider transaction / payment id
  redirectUrl?: string; createdAt: number; updatedAt: number;
  refundRequestedAt?: number; refundReason?: string; // a provider refund in progress (ZainCash reverse)
  events: { at: number; from: PaymentStatus; to: PaymentStatus; source: string; ref?: string }[];
}
export interface InvoiceLine { description: string; qty: number; unitIqd: number }
export interface Invoice { id: string; number: string; orderId: string; customerId: string; lines: InvoiceLine[]; totalIqd: number; status: 'ISSUED' | 'PAID' | 'REFUNDED' | 'VOID'; issuedAt: number; paidAt?: number; refundedAt?: number }

/** IQD has no minor unit in practice: amounts are whole dinars. */
export function invoiceTotal(lines: InvoiceLine[]): number {
  let t = 0;
  for (const l of lines) {
    if (!Number.isInteger(l.qty) || l.qty <= 0) throw new Error('quantity must be a positive whole number');
    if (!Number.isInteger(l.unitIqd) || l.unitIqd < 0) throw new Error('prices are whole dinars');
    t += l.qty * l.unitIqd;
  }
  if (!Number.isSafeInteger(t)) throw new Error('total out of range');
  return t;
}
export const invoiceNumber = (seq: number, year: number) => `INV-${year}-${String(seq).padStart(5, '0')}`;
