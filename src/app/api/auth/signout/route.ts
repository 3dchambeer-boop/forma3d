// =====================================================================
// POST /api/auth/signout
// =====================================================================

import { NextRequest } from 'next/server';
import { destroySession, getCurrentUser, logAuditSafe } from '@/lib/session';
import { ok } from '@/lib/api';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (user) {
    await logAuditSafe({
      actorId: user.id,
      action: 'AUTH_SIGNOUT',
      resourceType: 'User',
      resourceId: user.id,
      ipAddress: req.headers.get('x-forwarded-for') || undefined,
    });
  }
  await destroySession();
  return ok({ success: true });
}
