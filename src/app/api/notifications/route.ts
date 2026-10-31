// =====================================================================
// GET /api/notifications — list notifications for current user
// =====================================================================

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/session';
import { ok, apiErrors } from '@/lib/api';

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return apiErrors.unauthorized();

  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get('unread') === 'true';

  const notifications = await db.notification.findMany({
    where: {
      userId: auth.user.id,
      ...(unreadOnly ? { read: false } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return ok({ notifications });
}
