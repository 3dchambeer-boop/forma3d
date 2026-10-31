// POST /api/auth/mfa/setup — start TOTP enrolment for the signed-in user: returns the secret and otpauth URI once.
// MFA becomes active only after /api/auth/mfa/enable verifies a code from the app.
import { requireAuth, logAuditSafe } from '@/lib/session';
import { apiErrors, ok } from '@/lib/api';
import { db } from '@/lib/db';
import { newSecret, otpauthUri } from '@/lib/auth/totp';

export async function POST() {
  const auth = await requireAuth(); if (auth.error) return apiErrors.unauthorized();
  const secret = newSecret();
  await db.user.update({ where: { id: auth.user.id }, data: { mfaPending: secret } });
  await logAuditSafe({ actorId: auth.user.id, action: 'AUTH_MFA_SETUP_STARTED', resourceType: 'User', resourceId: auth.user.id });
  return ok({ secret, otpauth: otpauthUri(secret, auth.user.email) });
}
