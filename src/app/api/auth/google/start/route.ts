// GET /api/auth/google/start — redirect to Google with state, nonce and PKCE (kept in a signed, HttpOnly cookie).
import { NextRequest, NextResponse } from 'next/server';
import { googleConfig, sealFlow, startAuth } from '@/lib/auth/google-oauth';
import { clientIp, rateLimited } from '@/lib/security/rate-limit';
import { errorResponse } from '@/lib/api';

export async function GET(req: NextRequest) {
  const limited = rateLimited(clientIp(req.headers), 'oauth'); if (limited) return limited;
  const cfg = googleConfig(), secret = process.env.SESSION_SECRET;
  if (!cfg || !secret) return errorResponse(503, 'GOOGLE_NOT_CONFIGURED', 'Google sign-in is not configured on this server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI).');
  const a = startAuth(cfg);
  const res = NextResponse.redirect(a.url, 302);
  res.cookies.set('g_flow', sealFlow({ state: a.state, nonce: a.nonce, verifier: a.verifier }, secret), { httpOnly: true, secure: true, sameSite: 'lax', path: '/api/auth/google', maxAge: 600 });
  return res;
}
