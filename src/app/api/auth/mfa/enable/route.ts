// POST /api/auth/mfa/enable {code} — confirm the pending TOTP secret with a code from the app; then MFA is required.
import { NextRequest } from 'next/server';
import { requireAuth, logAuditSafe } from '@/lib/session';
import { apiErrors, ok } from '@/lib/api';
import { db } from '@/lib/db';
import { verifyTotp } from '@/lib/auth/totp';

export async function POST(req: NextRequest) {
  const auth = await requireAuth(); if (auth.error) return apiErrors.unauthorized();
  const b = (await req.json().catch(() => null)) as { code?: string } | null;
  const u = await db.user.findUnique({ where: { id: auth.user.id }, select: { mfaPending: true } });
  if (!u?.mfaPending) return apiErrors.badRequest('Start MFA setup first');
  const v = verifyTotp(u.mfaPending, String(b?.code || ''));
  if (!v.ok) return apiErrors.badRequest('The code does not match; check the time on your phone and try again');
  await db.user.update({ where: { id: auth.user.id }, data: { mfaSecret: u.mfaPending, mfaPending: null, mfaLastCounter: v.counter } });
  await logAuditSafe({ actorId: auth.user.id, action: 'AUTH_MFA_ENABLED', resourceType: 'User', resourceId: auth.user.id });
  return ok({ mfaEnabled: true });
}
