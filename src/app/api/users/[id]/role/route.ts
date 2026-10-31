// =====================================================================
// PATCH /api/users/[id]/role — change user role (admin only)
// =====================================================================

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, logAuditSafe } from '@/lib/session';
import { ok, apiErrors } from '@/lib/api';
import { z } from 'zod';

const BodySchema = z.object({
  role: z.enum(['END_USER', 'DESIGNER', 'FARM_MANAGER', 'ADMIN']),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(['ADMIN']);
  if (auth.error) {
    return auth.error.status === 401 ? apiErrors.unauthorized() : apiErrors.forbidden();
  }
  const actor = auth.user;
  const { id } = await params;

  let json: unknown;
  try { json = await req.json(); } catch { return apiErrors.badRequest('Invalid JSON'); }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) return apiErrors.badRequest('Invalid role', parsed.error.issues);

  const target = await db.user.findUnique({ where: { id } });
  if (!target) return apiErrors.notFound('User');

  // Prevent self-demotion (admin cannot remove their own admin rights)
  if (target.id === actor.id && parsed.data.role !== 'ADMIN') {
    return apiErrors.forbidden('Cannot demote yourself');
  }

  const previousRole = target.role;
  const updated = await db.user.update({
    where: { id },
    data: { role: parsed.data.role },
    select: { id: true, name: true, email: true, role: true, status: true },
  });

  await logAuditSafe({
    actorId: actor.id,
    action: 'ROLE_CHANGE',
    resourceType: 'User',
    resourceId: id,
    metadata: { from: previousRole, to: parsed.data.role },
    ipAddress: req.headers.get('x-forwarded-for') || undefined,
  });

  return ok({ user: updated });
}
