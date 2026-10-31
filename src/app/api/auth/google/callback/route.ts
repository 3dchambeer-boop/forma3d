// GET /api/auth/google/callback?code&state — verify state, exchange the code, verify the ID token, then sign in,
// link (only to a verified customer account) or create a customer account. Never creates staff or administrators.
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createSession, logAuditSafe } from '@/lib/session';
import { decideLink, exchangeCode, googleConfig, OAuthError, openFlow, verifyIdToken } from '@/lib/auth/google-oauth';
import { clientIp, rateLimited } from '@/lib/security/rate-limit';
import { timingSafeEqual } from 'node:crypto';

const back = (req: NextRequest, q: string) => { const r = NextResponse.redirect(new URL('/?' + q, req.url), 302); r.cookies.delete('g_flow'); return r; };

export async function GET(req: NextRequest) {
  const ip = clientIp(req.headers);
  const limited = rateLimited(ip, 'oauth'); if (limited) return limited;
  const cfg = googleConfig(), secret = process.env.SESSION_SECRET;
  if (!cfg || !secret) return back(req, 'auth_error=not_configured');
  const u = new URL(req.url), code = u.searchParams.get('code'), state = u.searchParams.get('state') || '';
  if (u.searchParams.get('error')) return back(req, 'auth_error=cancelled');
  try {
    const flow = openFlow(req.cookies.get('g_flow')?.value, secret);
    const a = Buffer.from(flow.state), b = Buffer.from(state);
    if (!code || a.length !== b.length || !timingSafeEqual(a, b)) throw new OAuthError('STATE', 'state mismatch');
    const { id_token } = await exchangeCode(cfg, code, flow.verifier);
    const c = await verifyIdToken(id_token, { clientId: cfg.clientId, nonce: flow.nonce });
    const bySub = await db.user.findUnique({ where: { googleSub: c.sub }, select: { id: true, status: true } });
    const byEmail = bySub ? null : await db.user.findUnique({ where: { email: c.email }, select: { id: true, status: true, role: true, emailVerified: true, googleSub: true } });
    const d = decideLink(c, bySub, byEmail);
    if (d.action === 'refuse') { await logAuditSafe({ action: 'AUTH_GOOGLE_REFUSED', resourceType: 'User', resourceId: c.email, ipAddress: ip, metadata: { reason: d.reason } }); return back(req, 'auth_error=' + encodeURIComponent(d.reason)); }
    let userId: string;
    if (d.action === 'create') {
      const org = process.env.SIGNUP_ORG_SLUG ? await db.organization.findUnique({ where: { slug: process.env.SIGNUP_ORG_SLUG } }) : null;
      if (!org) return back(req, 'auth_error=registration_closed');
      const nu = await db.user.create({ data: { email: c.email, name: (c.name || c.email.split('@')[0]).slice(0, 80), role: 'END_USER', googleSub: c.sub, emailVerified: true, avatarUrl: c.picture ?? null, memberships: { create: { organizationId: org.id, role: 'END_USER' } } } });
      userId = nu.id;
    } else if (d.action === 'link') {
      await db.user.update({ where: { id: d.userId }, data: { googleSub: c.sub } }); userId = d.userId;
    } else userId = d.userId;
    const user = await db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    await createSession({ id: user.id, email: user.email, role: user.role });
    await logAuditSafe({ actorId: user.id, action: 'AUTH_GOOGLE_' + d.action.toUpperCase(), resourceType: 'User', resourceId: user.id, ipAddress: ip });
    return back(req, 'signed_in=google');
  } catch (e) {
    await logAuditSafe({ action: 'AUTH_GOOGLE_FAILED', resourceType: 'User', resourceId: 'google', ipAddress: ip, metadata: { code: (e as OAuthError).code || 'ERROR', message: (e as Error).message.slice(0, 200) } });
    return back(req, 'auth_error=' + encodeURIComponent(e instanceof OAuthError ? e.code : 'failed'));
  }
}
