// POST {provider: "zaincash"|"fib"} — the invoice owner starts a payment; the response carries where to pay.
import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/session';
import { apiErrors, ok } from '@/lib/api';
import { db } from '@/lib/db';
import { payments, publicBase } from '@/lib/server/commerce';
import { rateLimited } from '@/lib/security/rate-limit';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth.error) return apiErrors.unauthorized();
  const limited = rateLimited(auth.user.id, 'payment');
  if (limited) return limited;
  const { id } = await params;
  const inv = await db.invoice.findUnique({ where: { id } });
  if (!inv || (inv.customerId !== auth.user.id && auth.user.role !== 'ADMIN')) return apiErrors.notFound('Invoice');
  const b = (await req.json().catch(() => null)) as { provider?: string } | null;
  if (!b || (b.provider !== 'zaincash' && b.provider !== 'fib')) return apiErrors.badRequest('provider must be zaincash or fib');
  const base = publicBase();
  if (!base) return apiErrors.internal('PUBLIC_BASE_URL is not configured');
  try {
    const p = await payments.startPayment(id, b.provider, { successUrl: `${base}/api/payments/zaincash/return`, failureUrl: `${base}/api/payments/zaincash/return`, callbackUrl: `${base}/api/webhooks/fib` });
    return ok({ paymentId: p.id, provider: p.provider, redirectUrl: p.redirectUrl, status: p.status });
  } catch (e) { return apiErrors.unprocessable((e as Error).message); }
}
