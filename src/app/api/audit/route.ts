// =====================================================================
// GET /api/audit — audit log (admin only)
// =====================================================================

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/session';
import { ok, apiErrors } from '@/lib/api';

export async function GET(req: NextRequest) {
  const auth = await requireAuth(['ADMIN']);
  if (auth.error) {
    return auth.error.status === 401 ? apiErrors.unauthorized() : apiErrors.forbidden();
  }

  const url = new URL(req.url);
  const action = url.searchParams.get('action');
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '50'));

  const events = await db.auditEvent.findMany({
    where: action ? { action } : {},
    include: {
      actor: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return ok({ events });
}
