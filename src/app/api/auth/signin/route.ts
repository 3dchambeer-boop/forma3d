// =====================================================================
// POST /api/auth/signin — credentials-based sign in
// =====================================================================

import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { createSession, logAuditSafe } from '@/lib/session';
import { ok, apiErrors } from '@/lib/api';
import { z } from 'zod';

const BodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return apiErrors.badRequest('Invalid JSON body');
  }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return apiErrors.badRequest('Invalid email or password', parsed.error.issues);
  }

  const email = parsed.data.email.toLowerCase().trim();
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined;

  // brute-force brake: failed attempts per e-mail (any IP) and per IP in the last 15 minutes
  const since = new Date(Date.now() - 15 * 60_000);
  const [byEmail, byIp] = await Promise.all([
    db.auditEvent.count({ where: { action: 'AUTH_SIGNIN_FAILED', resourceId: email, createdAt: { gte: since } } }),
    ip ? db.auditEvent.count({ where: { action: 'AUTH_SIGNIN_FAILED', ipAddress: ip, createdAt: { gte: since } } }) : Promise.resolve(0),
  ]);
  if (byEmail >= 10 || byIp >= 30) return apiErrors.tooMany('Too many failed sign-in attempts; try again later');
  const fail = async () => {
    await logAuditSafe({ action: 'AUTH_SIGNIN_FAILED', resourceType: 'User', resourceId: email, ipAddress: ip });
    return apiErrors.unauthorized();
  };

  const user = await db.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash) {
    await bcrypt.compare(parsed.data.password, '$2a$12$C6UzMDM.H6dfI/f/IKcEeO5JqBeUzEXrnSxWgrS4pQh6lI7O0/3dW'); // equalise timing
    return fail();
  }
  if (user.status !== 'ACTIVE') {
    return apiErrors.forbidden('Account suspended or pending');
  }

  const passwordOk = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!passwordOk) return fail();
  // administrators use their own entry (/api/auth/admin/signin: stricter rate limit, MFA, full audit)
  if (user.role === 'ADMIN') {
    await logAuditSafe({ actorId: user.id, action: 'AUTH_ADMIN_VIA_CUSTOMER_LOGIN_REFUSED', resourceType: 'User', resourceId: user.id, ipAddress: req.headers.get('x-forwarded-for') || undefined });
    return apiErrors.forbidden('Administrators sign in through the administrator entry');
  }

  await db.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  await createSession({
    id: user.id,
    email: user.email,
    role: user.role,
  });

  await logAuditSafe({
    actorId: user.id,
    action: 'AUTH_SIGNIN',
    resourceType: 'User',
    resourceId: user.id,
    ipAddress: req.headers.get('x-forwarded-for') || undefined,
  });

  return ok({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      locale: user.locale,
    },
  });
}
