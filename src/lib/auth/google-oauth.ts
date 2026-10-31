// =====================================================================
// "Continue with Google" — OAuth 2.0 authorization code flow with PKCE and OpenID Connect ID-token verification,
// following Google's documented endpoints (no SDK):
//   authorize  https://accounts.google.com/o/oauth2/v2/auth
//   token      https://oauth2.googleapis.com/token
//   JWKS       https://www.googleapis.com/oauth2/v3/certs
//   issuer     https://accounts.google.com  (or accounts.google.com)
// The browser only ever sees the redirect; the code is exchanged server-side with the client secret, and the ID token
// is verified here (RS256 signature against Google's keys, iss, aud, exp/iat, nonce, email_verified) before any
// account is touched. State, nonce and the PKCE verifier travel in an HMAC-signed, short-lived, HttpOnly cookie.
// Configuration: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI (exactly as registered with Google).
// =====================================================================
import { createHash, createHmac, createPublicKey, createVerify, randomBytes, timingSafeEqual, webcrypto } from 'node:crypto';
type JsonWebKey = webcrypto.JsonWebKey;

export interface GoogleConfig { clientId: string; clientSecret: string; redirectUri: string; authUrl?: string; tokenUrl?: string; jwksUrl?: string }
export const GOOGLE = { authUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token', jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs', issuers: ['https://accounts.google.com', 'accounts.google.com'] };
export class OAuthError extends Error { constructor(public readonly code: string, message: string) { super(message); this.name = 'OAuthError'; } }

export function googleConfig(env: Record<string, string | undefined> = process.env): GoogleConfig | null {
  return env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: env.GOOGLE_REDIRECT_URI } : null;
}
const b64u = (b: Buffer) => b.toString('base64url');

/** Step 1: the redirect URL plus the secret parts to keep in the signed cookie. */
export function startAuth(cfg: GoogleConfig, rand: (n: number) => Buffer = randomBytes) {
  const state = b64u(rand(24)), nonce = b64u(rand(24)), verifier = b64u(rand(48));
  const challenge = b64u(createHash('sha256').update(verifier).digest());
  const q = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: cfg.redirectUri, response_type: 'code', scope: 'openid email profile', state, nonce, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account' });
  return { url: `${cfg.authUrl ?? GOOGLE.authUrl}?${q}`, state, nonce, verifier };
}

// ---- the signed flow cookie {state, nonce, verifier, exp}
export function sealFlow(v: { state: string; nonce: string; verifier: string; next?: string }, secret: string, now = Date.now(), ttlMs = 10 * 60_000): string {
  const body = b64u(Buffer.from(JSON.stringify({ ...v, exp: now + ttlMs })));
  return body + '.' + b64u(createHmac('sha256', secret).update(body).digest());
}
export function openFlow(cookie: string | undefined, secret: string, now = Date.now()): { state: string; nonce: string; verifier: string; next?: string } {
  const [body, sig] = String(cookie || '').split('.');
  if (!body || !sig) throw new OAuthError('FLOW_MISSING', 'sign-in session missing or expired; start again');
  const want = createHmac('sha256', secret).update(body).digest(), got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw new OAuthError('FLOW_FORGED', 'sign-in session cookie is not ours');
  const v = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (!(v.exp > now)) throw new OAuthError('FLOW_EXPIRED', 'sign-in took too long; start again');
  return v;
}

/** Step 2: exchange the code (server-side, with the secret and the PKCE verifier). */
export async function exchangeCode(cfg: GoogleConfig, code: string, verifier: string, f: typeof fetch = fetch): Promise<{ id_token: string }> {
  const res = await f(cfg.tokenUrl ?? GOOGLE.tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, grant_type: 'authorization_code', code_verifier: verifier }), signal: AbortSignal.timeout(15_000) });
  const j = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
  if (!res.ok || !j.id_token) throw new OAuthError('TOKEN_EXCHANGE', `Google refused the code: ${j.error || res.status}${j.error_description ? ' — ' + j.error_description : ''}`);
  return { id_token: j.id_token };
}

export interface GoogleClaims { sub: string; email: string; email_verified: boolean; name?: string; picture?: string; hd?: string }
let jwksCache: { at: number; keys: JsonWebKey[] } | null = null;
export const resetJwksCache = () => { jwksCache = null; };
async function keys(url: string, f: typeof fetch, now: number): Promise<JsonWebKey[]> {
  if (jwksCache && now - jwksCache.at < 3600_000) return jwksCache.keys;
  const res = await f(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new OAuthError('JWKS', `could not fetch Google's signing keys (HTTP ${res.status})`);
  jwksCache = { at: now, keys: ((await res.json()) as { keys: JsonWebKey[] }).keys };
  return jwksCache.keys;
}

/** Step 3: verify the ID token completely before trusting any claim in it. */
export async function verifyIdToken(idToken: string, o: { clientId: string; nonce: string; jwksUrl?: string; fetch?: typeof fetch; now?: number }): Promise<GoogleClaims> {
  const now = o.now ?? Date.now(), parts = String(idToken).split('.');
  if (parts.length !== 3) throw new OAuthError('ID_TOKEN', 'malformed ID token');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString()), p = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  if (header.alg !== 'RS256') throw new OAuthError('ID_TOKEN', `unexpected signing algorithm ${header.alg}`);
  let ks = await keys(o.jwksUrl ?? GOOGLE.jwksUrl, o.fetch ?? fetch, now);
  let jwk = ks.find((k) => (k as { kid?: string }).kid === header.kid);
  if (!jwk) { resetJwksCache(); ks = await keys(o.jwksUrl ?? GOOGLE.jwksUrl, o.fetch ?? fetch, now); jwk = ks.find((k) => (k as { kid?: string }).kid === header.kid); } // key rotation
  if (!jwk) throw new OAuthError('ID_TOKEN', 'signed with an unknown key');
  const ok = createVerify('RSA-SHA256').update(parts[0] + '.' + parts[1]).verify(createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new OAuthError('ID_TOKEN', 'bad signature');
  if (!GOOGLE.issuers.includes(p.iss)) throw new OAuthError('ID_TOKEN', 'wrong issuer');
  if (p.aud !== o.clientId) throw new OAuthError('ID_TOKEN', 'issued for another application');
  if (!(p.exp * 1000 > now - 60_000)) throw new OAuthError('ID_TOKEN', 'expired');
  if (p.iat * 1000 > now + 5 * 60_000) throw new OAuthError('ID_TOKEN', 'issued in the future');
  if (!p.nonce || p.nonce !== o.nonce) throw new OAuthError('ID_TOKEN', 'nonce mismatch (possible replay)');
  if (!p.sub || !p.email) throw new OAuthError('ID_TOKEN', 'no subject or e-mail');
  if (p.email_verified !== true) throw new OAuthError('EMAIL_UNVERIFIED', 'Google has not verified this e-mail address');
  return { sub: String(p.sub), email: String(p.email).toLowerCase(), email_verified: true, name: p.name, picture: p.picture, hd: p.hd };
}

/**
 * What to do with verified Google claims.
 *  - an account already linked to this Google subject: sign in
 *  - no account with this e-mail: create a CUSTOMER account (never any other role)
 *  - an account with this e-mail whose address we have verified: link Google to it and sign in
 *  - an account with this e-mail that is unverified, suspended, or an administrator: refuse; linking would let whoever
 *    controls the Google account take over an account they never proved they own (administrators link only after
 *    signing in with their password and MFA)
 */
export type LinkDecision = { action: 'login'; userId: string } | { action: 'link'; userId: string } | { action: 'create' } | { action: 'refuse'; reason: string };
export function decideLink(c: GoogleClaims, bySub: { id: string; status: string } | null, byEmail: { id: string; status: string; role: string; emailVerified: boolean; googleSub?: string | null } | null): LinkDecision {
  if (bySub) return bySub.status === 'ACTIVE' ? { action: 'login', userId: bySub.id } : { action: 'refuse', reason: 'this account is not active' };
  if (!byEmail) return { action: 'create' };
  if (byEmail.googleSub && byEmail.googleSub !== c.sub) return { action: 'refuse', reason: 'this e-mail is linked to a different Google account' };
  if (byEmail.status !== 'ACTIVE') return { action: 'refuse', reason: 'this account is not active' };
  if (byEmail.role === 'ADMIN') return { action: 'refuse', reason: 'administrator accounts link Google only from their security settings, after password and MFA sign-in' };
  if (!byEmail.emailVerified) return { action: 'refuse', reason: 'sign in with your password once and verify your e-mail, then link Google from your settings' };
  return { action: 'link', userId: byEmail.id };
}
