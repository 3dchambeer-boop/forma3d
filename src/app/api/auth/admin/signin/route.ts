// POST /api/auth/admin/signin {email, password, code?} — the separate administrator entry.
// Only ADMIN accounts; 5 attempts per 15 min per IP and per e-mail; TOTP required once MFA is enabled; every attempt
// (success or failure) is audited. The response never says which part was wrong.
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '@/lib/db';
import { createSession, logAuditSafe } from '@/lib/session';
import { apiErrors, ok, errorResponse } from '@/lib/api';
import { clientIp, rateLimited } from '@/lib/security/rate-limit';
import { verifyTotp } from '@/lib/auth/totp';

const Body = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200), code: z.string().regex(/^\d{6}$/).optional() });
const DUMMY = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO5JqBeUzEXrnSxWgrS4pQh6lI7O0/3dW';

export async function POST(req: NextRequest) {
  const ip = clientIp(req.headers);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiErrors.badRequest('Invalid sign-in data');
  const email = parsed.data.email.toLowerCase().trim();
  const limited = rateLimited(ip, 'adminLogin') || rateLimited('email:' + email, 'adminLogin');
  if (limited) { await logAuditSafe({ action: 'AUTH_ADMIN_RATE_LIMITED', resourceType: 'User', resourceId: email, ipAddress: ip }); return limited; }
  const fail = async (why: string) => { await logAuditSafe({ action: 'AUTH_ADMIN_SIGNIN_FAILED', resourceType: 'User', resourceId: email, ipAddress: ip, metadata: { why } }); return apiErrors.unauthorized(); };
  const user = await db.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash || user.role !== 'ADMIN') { await bcrypt.compare(parsed.data.password, DUMMY); return fail('no admin'); }
  if (!(await bcrypt.compare(parsed.data.password, user.passwordHash))) return fail('password');
  if (user.status !== 'ACTIVE') return fail('inactive');
  if (user.mfaSecret) {
    if (!parsed.data.code) return errorResponse(401, 'MFA_REQUIRED', 'Enter the 6-digit code from your authenticator app');
    const v = verifyTotp(user.mfaSecret, parsed.data.code, Date.now(), user.mfaLastCounter ?? -1);
    if (!v.ok) return fail('mfa');
    await db.user.update({ where: { id: user.id }, data: { mfaLastCounter: v.counter } });
  }
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await createSession({ id: user.id, email: user.email, role: user.role });
  await logAuditSafe({ actorId: user.id, action: 'AUTH_ADMIN_SIGNIN', resourceType: 'User', resourceId: user.id, ipAddress: ip, metadata: { mfa: !!user.mfaSecret } });
  return ok({ user: { id: user.id, email: user.email, name: user.name, role: user.role }, mfaEnabled: !!user.mfaSecret });
}
