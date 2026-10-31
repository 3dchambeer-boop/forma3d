// =====================================================================
// POST /api/notifications/[id]/read — mark as read
// =====================================================================

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/session';
import { ok, apiErrors } from '@/lib/api';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth.error) return apiErrors.unauthorized();
  const { id } = await params;

  const notif = await db.notification.findUnique({ where: { id } });
  if (!notif) return apiErrors.notFound('Notification');
  if (notif.userId !== auth.user.id && auth.user.role !== 'ADMIN') {
    return apiErrors.forbidden();
  }

  await db.notification.update({
    where: { id },
    data: { read: true },
  });

  return ok({ success: true });
}
