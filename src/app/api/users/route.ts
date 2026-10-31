// =====================================================================
// GET /api/users — admin user list
// PATCH /api/users/[id]/role — change role (admin only)
// =====================================================================

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, logAuditSafe } from '@/lib/session';
import { ok, apiErrors } from '@/lib/api';

export async function GET() {
  const auth = await requireAuth(['ADMIN']);
  if (auth.error) {
    return auth.error.status === 401 ? apiErrors.unauthorized() : apiErrors.forbidden();
  }

  const users = await db.user.findMany({
    select: {
      id: true, email: true, name: true, role: true, locale: true,
      status: true, createdAt: true, lastLoginAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return ok({ users });
}
