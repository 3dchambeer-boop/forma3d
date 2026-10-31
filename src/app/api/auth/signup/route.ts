// =====================================================================
// POST /api/auth/signup — self-registration as END_USER.
// The role is never read from the request. Registration is closed unless
// SIGNUP_ORG_SLUG names the organization new users join.
// =====================================================================

import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '@/lib/db';
import { logAuditSafe } from '@/lib/session';
import { ok, apiErrors, errorResponse } from '@/lib/api';
import { passwordProblems } from '@/lib/auth/password-policy';
import { normalizeIraqiMobile } from '@/lib/notify/phone';

const Body = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().email().max(200),
  password: z.string().min(10).max(200),
  confirmPassword: z.string().optional(),
  phone: z.string().trim().max(30).optional(),
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
  language: z.enum(['ar', 'en']).default('ar'),
  acceptTerms: z.literal(true, { message: 'You must accept the terms of service and the privacy policy' }),
});

export async function POST(req: NextRequest) {
  const slug = process.env.SIGNUP_ORG_SLUG;
  if (!slug) return errorResponse(403, 'REGISTRATION_CLOSED', 'Self-registration is disabled; ask an administrator for an account.');
  const org = await db.organization.findUnique({ where: { slug } });
  if (!org) return errorResponse(503, 'REGISTRATION_MISCONFIGURED', 'Registration organization not found.');

  let json: unknown;
  try { json = await req.json(); } catch { return apiErrors.badRequest('Invalid JSON'); }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return apiErrors.badRequest('Invalid sign-up data', parsed.error.issues);
  const email = parsed.data.email.toLowerCase().trim();
  if (parsed.data.confirmPassword !== undefined && parsed.data.confirmPassword !== parsed.data.password) return apiErrors.badRequest('The passwords do not match');
  const weak = passwordProblems(parsed.data.password, { email });
  if (weak.length) return apiErrors.badRequest(`Password needs: ${weak.join('; ')}`);
  const phone = parsed.data.phone ? normalizeIraqiMobile(parsed.data.phone) : null;
  if (parsed.data.phone && !phone) return apiErrors.badRequest('Phone number is not a valid mobile number');

  // basic abuse brake: registrations per IP in the last hour (audit log is the shared store)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined;
  if (ip) {
    const recent = await db.auditEvent.count({ where: { action: 'AUTH_SIGNUP', ipAddress: ip, createdAt: { gte: new Date(Date.now() - 3600_000) } } });
    if (recent >= 5) return apiErrors.tooMany('Too many registrations from this address');
  }

  if (await db.user.findUnique({ where: { email } })) {
    return apiErrors.conflict('An account with this e-mail already exists');
  }
  const user = await db.user.create({
    data: {
      email,
      name: parsed.data.name,
      passwordHash: await bcrypt.hash(parsed.data.password, 12),
      role: 'END_USER', // never from the request: nobody can register as staff or administrator
      phone, country: parsed.data.country ?? null, locale: parsed.data.language === 'en' ? 'EN' : 'AR', termsAcceptedAt: new Date(),
      memberships: { create: { organizationId: org.id, role: 'END_USER' } },
    },
    select: { id: true, email: true, name: true, role: true },
  });
  await logAuditSafe({ actorId: user.id, action: 'AUTH_SIGNUP', resourceType: 'User', resourceId: user.id, ipAddress: ip });
  return ok({ user }, 201);
}
