// =====================================================================
// GET /api/reviews — pending reviews for designers/admins
// =====================================================================

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/session';
import { ok, apiErrors } from '@/lib/api';

export async function GET(req: NextRequest) {
  const auth = await requireAuth(['DESIGNER', 'ADMIN']);
  if (auth.error) {
    return auth.error.status === 401 ? apiErrors.unauthorized() : apiErrors.forbidden();
  }

  const url = new URL(req.url);
  const status = url.searchParams.get('status') || 'REVIEW_REQUIRED';

  const revisions = await db.designRevision.findMany({
    where: status === 'all' ? {} : { status: status as 'REVIEW_REQUIRED' | 'CHANGES_REQUESTED' },
    include: {
      project: {
        include: {
          owner: { select: { id: true, name: true, email: true } },
        },
      },
      reviews: { include: { reviewer: { select: { id: true, name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return ok({ revisions });
}
