// GET — ADMIN: AI usage this month and all time (tokens as reported by the API; cost only where prices are configured).
import { requireAuth } from '@/lib/session';
import { apiErrors, ok } from '@/lib/api';
import { ledger } from '@/lib/generation/usage';

export async function GET() {
  const auth = await requireAuth(['ADMIN']);
  if (auth.error) return auth.error.status === 401 ? apiErrors.unauthorized() : apiErrors.forbidden();
  const L = ledger();
  const budget = process.env.AI_MONTHLY_BUDGET_USD ? Number(process.env.AI_MONTHLY_BUDGET_USD) : null;
  return ok({
    month: L.monthToDate(),
    all_time: L.totals(),
    budget_usd: budget,
    pricing_configured: !!process.env.AI_PRICING_JSON,
    persisted: !!process.env.AI_USAGE_LOG,
  });
}
