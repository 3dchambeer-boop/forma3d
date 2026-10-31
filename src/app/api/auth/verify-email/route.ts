// POST: send a verification link to the signed-in user's e-mail.  GET ?token=: confirm it (must be signed in as that user).
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/session';
import { apiErrors, ok, logAudit } from '@/lib/api';
import { db } from '@/lib/db';
import { EmailClient } from '@/lib/notify/email';
import { checkEmailToken, emailToken } from '@/lib/notify/verify-email';
import { signingSecret } from '@/lib/security/signed-url';
import { publicBase } from '@/lib/server/commerce';
import { rateLimited } from '@/lib/security/rate-limit';

export async function POST() {
  const auth = await requireAuth();
  if (auth.error) return apiErrors.unauthorized();
  const limited = rateLimited(auth.user.id, 'payment'); // same budget: 10 per 10 minutes
  if (limited) return limited;
  const mail = EmailClient.fromEnv();
  if (!mail) return apiErrors.internal('e-mail is not configured');
  const token = emailToken(auth.user.id, auth.user.email, signingSecret());
  await mail.send({ to: auth.user.email, subject: 'تأكيد بريدك — FORMA·3D', text: `لتأكيد بريدك افتح الرابط (صالح 48 ساعة):\n${publicBase()}/api/auth/verify-email?token=${encodeURIComponent(token)}` });
  return ok({ sent: true });
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth.error) return apiErrors.unauthorized();
  const r = checkEmailToken(new URL(req.url).searchParams.get('token') || '', { id: auth.user.id, email: auth.user.email }, signingSecret());
  if (!r.ok) return apiErrors.badRequest('verification link is ' + r.reason);
  await db.user.update({ where: { id: auth.user.id }, data: { emailVerified: true } });
  await logAudit({ actorId: auth.user.id, action: 'email_verified', resourceType: 'user', resourceId: auth.user.id });
  return NextResponse.redirect(`${publicBase()}/settings?email=verified`, 303);
}
