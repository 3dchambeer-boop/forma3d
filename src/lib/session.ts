// =====================================================================
// FORMA·3D Server-side Session — JWT-based, httpOnly cookies
// =====================================================================

import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { cookies } from 'next/headers';
import { db } from './db';

const SESSION_COOKIE = 'forma3d_session';
// No hard-coded fallback: anyone who knows a fallback secret can mint an ADMIN token.
// Production refuses to run without SESSION_SECRET; development gets a random
// per-process secret (sessions end when the server restarts).
// Resolved on first use (not at import) so `next build` does not need the secret.
let cachedSecret: string | null = null;
function sessionSecret(): string {
  if (cachedSecret) return cachedSecret;
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return (cachedSecret = s);
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET must be set to at least 32 random characters in production');
  }
  console.warn('[session] SESSION_SECRET missing or short; using a random development secret');
  return (cachedSecret = randomBytes(48).toString('hex'));
}
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export interface SessionPayload {
  userId: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

export async function createSession(user: { id: string; email: string; role: string }): Promise<void> {
  const token = jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    sessionSecret(),
    { expiresIn: SESSION_MAX_AGE }
  );
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSession(): Promise<SessionPayload | null> {
  try {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (!token) return null;
    const payload = jwt.verify(token, sessionSecret(), { algorithms: ['HS256'] }) as SessionPayload;
    return payload;
  } catch {
    return null;
  }
}

export async function getCurrentUser() {
  const session = await getSession();
  if (!session) return null;
  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true, email: true, name: true, role: true, locale: true, status: true,
      avatarUrl: true, lastLoginAt: true, createdAt: true,
    },
  });
  if (!user || user.status !== 'ACTIVE') return null;
  return user;
}

// Role-based authorization helper
export function requireRole(userRole: string | null | undefined, allowed: string[]): boolean {
  if (!userRole) return false;
  return allowed.includes(userRole);
}

export async function requireAuth(allowedRoles?: string[]) {
  const user = await getCurrentUser();
  if (!user) {
    return { user: null, error: { status: 401, code: 'UNAUTHORIZED', message: 'Authentication required' } } as const;
  }
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return { user: null, error: { status: 403, code: 'FORBIDDEN', message: 'Insufficient permissions' } } as const;
  }
  return { user, error: null } as const;
}

// Audit log helper (single declaration; db already imported at top)
export async function logAuditSafe(params: {
  actorId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}) {
  try {
    await db.auditEvent.create({
      data: {
        actorId: params.actorId || null,
        action: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId || null,
        metadata: params.metadata ? JSON.stringify(params.metadata) : null,
        ipAddress: params.ipAddress || null,
      },
    });
  } catch (e) {
    console.error('[audit] failed to log event:', e);
  }
}
