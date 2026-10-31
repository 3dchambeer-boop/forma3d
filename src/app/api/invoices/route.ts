// POST (admin): issue an invoice. GET: the caller's invoices (admins: all).
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/session';
import { apiErrors, created, ok } from '@/lib/api';
import { db } from '@/lib/db';
import { notifications, payments } from '@/lib/server/commerce';

export async function POST(req: NextRequest) {
  const auth = await requireAuth(['ADMIN', 'FARM_MANAGER']);
  if (auth.error) return auth.error.status === 401 ? apiErrors.unauthorized() : apiErrors.forbidden();
  const b = (await req.json().catch(() => null)) as { orderId?: string; customerId?: string; lines?: { description: string; qty: number; unitIqd: number }[] } | null;
  if (!b || !b.orderId || !b.customerId || !Array.isArray(b.lines)) return apiErrors.badRequest('orderId, customerId and lines are required');
  try {
    const inv = await payments.issueInvoice(b.orderId, b.customerId, b.lines, auth.user.id);
    await notifications.enqueue({ id: `${inv.id}:issued`, type: 'invoice_issued', userIds: [inv.customerId], vars: { invoice: inv.number, amount: inv.totalIqd.toLocaleString('en') }, link: `/invoices/${inv.id}`, at: Date.now() });
    return created({ invoice: inv });
  } catch (e) { return apiErrors.unprocessable((e as Error).message); }
}
export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return apiErrors.unauthorized();
  const where = auth.user.role === 'ADMIN' ? {} : { customerId: auth.user.id };
  const rows = await db.invoice.findMany({ where, orderBy: { issuedAt: 'desc' }, take: 100, include: { payments: { select: { id: true, provider: true, status: true, updatedAt: true } } } });
  return ok({ invoices: rows.map((r) => ({ ...r, lines: JSON.parse(r.lines) })) });
}
