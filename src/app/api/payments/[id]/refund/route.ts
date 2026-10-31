// POST {reason, reference?} — ADMIN refunds a PAID payment (ZainCash: reverse API; FIB/manual: returned by transfer).
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/session';
import { apiErrors, ok } from '@/lib/api';
import { payments } from '@/lib/server/commerce';
import { PaymentError } from '@/lib/payments/service';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(['ADMIN']);
  if (auth.error) return auth.error.status === 401 ? apiErrors.unauthorized() : apiErrors.forbidden();
  const { id } = await params;
  const b = (await req.json().catch(() => null)) as { reason?: string; reference?: string } | null;
  if (!b || !b.reason) return apiErrors.badRequest('reason is required');
  try { return ok({ payment: await payments.refund(id, { id: auth.user.id, role: 'admin' }, { reason: b.reason, reference: b.reference }) }); }
  catch (e) { return e instanceof PaymentError && e.code === 'NOT_FOUND' ? apiErrors.notFound('Payment') : apiErrors.unprocessable((e as Error).message); }
}
