// =====================================================================
// GET /api/slicing-profiles
// =====================================================================

import { requireAuth } from '@/lib/session';
import { db } from '@/lib/db';
import { ok, apiErrors } from '@/lib/api';

export async function GET() {
  const auth = await requireAuth(['FARM_MANAGER', 'ADMIN']);
  if (auth.error) {
    return auth.error.status === 401 ? apiErrors.unauthorized() : apiErrors.forbidden();
  }

  const profiles = await db.slicingProfile.findMany({
    orderBy: { name: 'asc' },
  });

  return ok({ profiles });
}
