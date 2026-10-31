// POST {method, reference, amountIqd} — ADMIN records cash / transfer; audited.
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/session';
import { apiErrors, ok } from '@/lib/api';
import { payments } from '@/lib/server/commerce';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(['ADMIN']);
  if (auth.error) return auth.error.status === 401 ? apiErrors.unauthorized() : apiErrors.forbidden();
  const { id } = await params;
  const b = (await req.json().catch(() => null)) as { method?: 'cash' | 'transfer' | 'other'; reference?: string; amountIqd?: number } | null;
  if (!b || !b.method || !b.reference || typeof b.amountIqd !== 'number') return apiErrors.badRequest('method, reference and amountIqd are required');
  try { const p = await payments.recordManual(id, { id: auth.user.id, role: 'admin' }, { method: b.method, reference: b.reference, amountIqd: b.amountIqd }); return ok({ payment: p }); }
  catch (e) { return apiErrors.unprocessable((e as Error).message); }
}
