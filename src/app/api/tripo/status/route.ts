// =====================================================================
// GET /api/tripo/status — Tripo integration status & balance
// ADMIN only: account balance is business information and each call hits the paid API
// =====================================================================

import { requireAuth } from '@/lib/session';
import { ok, apiErrors } from '@/lib/api';
import { isTripoConfigured, getBalance, TripoError } from '@/lib/tripo';

export async function GET() {
  const auth = await requireAuth(['ADMIN']);
  if (auth.error) {
    return auth.error.status === 401 ? apiErrors.unauthorized() : apiErrors.forbidden();
  }

  if (!isTripoConfigured()) {
    return ok({
      configured: false,
      message: 'TRIPO_API_KEY not set in environment. Set it in .env.local to enable real AI generation.',
      balance: null,
    });
  }

  try {
    const balance = await getBalance();
    return ok({
      configured: true,
      message: balance.balance === 0
        ? 'API key is valid but account has 0 credits. Recharge at https://platform.tripo3d.ai'
        : `API key valid. ${balance.balance} credits available.`,
      balance,
    });
  } catch (e) {
    const msg = e instanceof TripoError
      ? `${e.code}: ${e.message}`
      : `Connection failed: ${e instanceof Error ? e.message : 'unknown'}`;
    return ok({
      configured: true,
      message: msg,
      balance: null,
      error: true,
    });
  }
}
