// =====================================================================
// GET /api/auth/me — current session user
// =====================================================================

import { getCurrentUser } from '@/lib/session';
import { ok, apiErrors } from '@/lib/api';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiErrors.unauthorized();
  return ok({ user });
}
