// Authentication building blocks. TOTP against the RFC 6238 test vectors; Google sign-in with real RS256 keys and
// signatures, Google's endpoints SIMULATED by an injected fetch (no client ID exists here); admin bootstrap policy.
import assert from 'node:assert/strict';
import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, test } from 'node:test';

import { bootstrapAdmin, type AdminRepo } from '../../src/lib/auth/admin-bootstrap.ts';
import { decideLink, exchangeCode, openFlow, resetJwksCache, sealFlow, startAuth, verifyIdToken } from '../../src/lib/auth/google-oauth.ts';
import { passwordProblems } from '../../src/lib/auth/password-policy.ts';
import { base32Decode, base32Encode, hotp, newSecret, otpauthUri, totp, verifyTotp } from '../../src/lib/auth/totp.ts';

describe('TOTP (RFC 6238)', () => {
  test('matches the RFC 6238 Appendix B SHA-1 test vectors', () => {
    const key = Buffer.from('12345678901234567890');
    for (const [t, want] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']] as const)
      assert.equal(hotp(key, Math.floor(t / 30), 8), want, String(t));
    assert.equal(base32Encode(Buffer.from('12345678901234567890')), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    assert.deepEqual(base32Decode('GEZD GNBV-GY3TQOJQ GEZDGNBVGY3TQOJQ'), Buffer.from('12345678901234567890'));
  });
  test('verification allows one step of drift, refuses a replayed code and malformed input', () => {
    const s = newSecret(), t = 1_800_000_000_000;
    assert.equal(base32Decode(s).length, 20);
    const now = verifyTotp(s, totp(s, t), t);
    assert.ok(now.ok);
    assert.ok(verifyTotp(s, totp(s, t - 30_000), t).ok, 'previous window');
    assert.equal(verifyTotp(s, totp(s, t - 90_000), t).ok, false, 'too old');
    assert.equal(verifyTotp(s, totp(s, t), t, now.counter).ok, false, 'the same code twice');
    assert.equal(verifyTotp(s, '12345', t).ok, false); assert.equal(verifyTotp(s, 'abcdef', t).ok, false);
    assert.match(otpauthUri(s, 'admin@cmg.example'), /^otpauth:\/\/totp\/CMG%20FORMA%C2%B73D:admin%40cmg\.example\?secret=[A-Z2-7]+&issuer=/);
  });
});

describe('Password policy', () => {
  test('administrators need long, mixed passwords not built from the e-mail or a common word', () => {
    assert.deepEqual(passwordProblems('Tr4ck-Spindle-Quarry', { admin: true, email: 'ops@cmg.example' }), []);
    assert.ok(passwordProblems('short1A!', { admin: true }).some((p) => p.includes('14')));
    assert.ok(passwordProblems('alllowercaseletters', { admin: true }).some((p) => p.includes('three of')));
    assert.ok(passwordProblems('Password!2026xx', { admin: true }).some((p) => p.includes('common')));
    assert.ok(passwordProblems('Hussein-Admin-2026!', { admin: true, email: 'hussein@cmg.example' }).some((p) => p.includes('e-mail')));
    assert.deepEqual(passwordProblems('a long customer pass', {}), []);
  });
});

// ---- a simulated Google: our own RSA key published as a JWKS, a token endpoint, and signed ID tokens
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const CID = 'client-123.apps.googleusercontent.com', NOW = Date.UTC(2026, 9, 30, 12);
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function idToken(claims: Record<string, unknown>, o: { kid?: string; key?: typeof privateKey; alg?: string } = {}) {
  const h = b64({ alg: o.alg ?? 'RS256', kid: o.kid ?? 'k1', typ: 'JWT' }), p = b64({ iss: 'https://accounts.google.com', aud: CID, sub: '1093', email: 'Sara@Example.com', email_verified: true, iat: NOW / 1000 - 10, exp: NOW / 1000 + 3500, nonce: 'n-1', name: 'Sara', ...claims });
  return `${h}.${p}.${createSign('RSA-SHA256').update(h + '.' + p).sign(o.key ?? privateKey).toString('base64url')}`;
}
let jwksCalls = 0, published: object[] = [jwk];
const fakeFetch: typeof fetch = async (url: any, init?: any) => {
  if (String(url).endsWith('/certs')) { jwksCalls++; return new Response(JSON.stringify({ keys: published }), { status: 200 }); }
  if (String(url).endsWith('/token')) {
    const f = new URLSearchParams(String(init.body));
    if (f.get('code') !== 'good-code' || f.get('client_secret') !== 'shh' || f.get('code_verifier') !== 'ver' || f.get('grant_type') !== 'authorization_code') return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Bad Request' }), { status: 400 });
    return new Response(JSON.stringify({ id_token: idToken({}), access_token: 'x', token_type: 'Bearer' }), { status: 200 });
  }
  return new Response('{}', { status: 404 });
};
const cfg = { clientId: CID, clientSecret: 'shh', redirectUri: 'https://forma.example/api/auth/google/callback', tokenUrl: 'https://sim/token', jwksUrl: 'https://sim/certs' };
const verify = (t: string, nonce = 'n-1') => verifyIdToken(t, { clientId: CID, nonce, jwksUrl: 'https://sim/certs', fetch: fakeFetch, now: NOW });

describe('Continue with Google (simulated Google endpoints, real signatures)', () => {
  beforeEach(() => { resetJwksCache(); jwksCalls = 0; published = [jwk]; });

  test('the start URL carries state, nonce and an S256 PKCE challenge of the secret verifier', () => {
    const a = startAuth(cfg);
    const u = new URL(a.url);
    assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.deepEqual([u.searchParams.get('client_id'), u.searchParams.get('response_type'), u.searchParams.get('scope'), u.searchParams.get('code_challenge_method')], [CID, 'code', 'openid email profile', 'S256']);
    assert.equal(u.searchParams.get('code_challenge'), createHash('sha256').update(a.verifier).digest('base64url'));
    assert.ok(!a.url.includes(a.verifier) && !a.url.includes('shh'), 'neither the verifier nor the secret leaves the server');
  });

  test('the flow cookie is signed and short-lived', () => {
    const c = sealFlow({ state: 's', nonce: 'n', verifier: 'v' }, 'k'.repeat(32), NOW);
    assert.equal(openFlow(c, 'k'.repeat(32), NOW + 60_000).state, 's');
    assert.throws(() => openFlow(c, 'x'.repeat(32), NOW), /not ours/);
    assert.throws(() => openFlow(c.replace(/^./, (x) => (x === 'e' ? 'f' : 'e')), 'k'.repeat(32), NOW), /not ours/);
    assert.throws(() => openFlow(c, 'k'.repeat(32), NOW + 11 * 60_000), /too long/);
    assert.throws(() => openFlow(undefined, 'k'.repeat(32), NOW), /missing/);
  });

  test('the code is exchanged server-side and the ID token fully verified', async () => {
    const t = await exchangeCode(cfg, 'good-code', 'ver', fakeFetch);
    const c = await verify(t.id_token);
    assert.deepEqual([c.sub, c.email, c.email_verified, c.name], ['1093', 'sara@example.com', true, 'Sara']);
    await assert.rejects(exchangeCode(cfg, 'stolen', 'ver', fakeFetch), /invalid_grant/);
  });

  test('forged or misused tokens are refused', async () => {
    await assert.rejects(verify(idToken({ aud: 'someone-else' })), /another application/);
    await assert.rejects(verify(idToken({ iss: 'https://evil.example' })), /wrong issuer/);
    await assert.rejects(verify(idToken({ exp: NOW / 1000 - 3600 })), /expired/);
    await assert.rejects(verify(idToken({}), 'other-nonce'), /nonce/);
    await assert.rejects(verify(idToken({ email_verified: false })), /not verified/);
    await assert.rejects(verify(idToken({}, { key: other.privateKey })), /bad signature/);
    const t = idToken({}), [h, , s] = t.split('.');
    await assert.rejects(verify(`${h}.${b64({ iss: 'https://accounts.google.com', aud: CID, sub: 'admin', email: 'a@b.c', email_verified: true, exp: NOW / 1000 + 99, iat: NOW / 1000, nonce: 'n-1' })}.${s}`), /bad signature/);
    await assert.rejects(verify(`${b64({ alg: 'none', kid: 'k1' })}.${t.split('.')[1]}.`), /algorithm/);
    await assert.rejects(verify(idToken({}, { alg: 'HS256' })), /algorithm/);
  });

  test('a rotated signing key is fetched again; an unknown key is refused', async () => {
    await verify(idToken({}));
    const rotated = generateKeyPairSync('rsa', { modulusLength: 2048 });
    published = [jwk, { ...rotated.publicKey.export({ format: 'jwk' }), kid: 'k2', alg: 'RS256' }];
    assert.equal((await verify(idToken({}, { kid: 'k2', key: rotated.privateKey }))).sub, '1093');
    assert.equal(jwksCalls, 2);
    await assert.rejects(verify(idToken({}, { kid: 'k9' })), /unknown key/);
  });

  test('account linking never lets a Google account take over an account it has not proven', () => {
    const c = { sub: '1093', email: 'sara@example.com', email_verified: true };
    assert.deepEqual(decideLink(c, { id: 'u1', status: 'ACTIVE' }, null), { action: 'login', userId: 'u1' });
    assert.deepEqual(decideLink(c, null, null), { action: 'create' });
    assert.deepEqual(decideLink(c, null, { id: 'u2', status: 'ACTIVE', role: 'END_USER', emailVerified: true }), { action: 'link', userId: 'u2' });
    assert.equal(decideLink(c, null, { id: 'u2', status: 'ACTIVE', role: 'END_USER', emailVerified: false }).action, 'refuse');
    assert.equal(decideLink(c, null, { id: 'u3', status: 'ACTIVE', role: 'ADMIN', emailVerified: true }).action, 'refuse');
    assert.equal(decideLink(c, null, { id: 'u4', status: 'SUSPENDED', role: 'END_USER', emailVerified: true }).action, 'refuse');
    assert.equal(decideLink(c, null, { id: 'u5', status: 'ACTIVE', role: 'END_USER', emailVerified: true, googleSub: '999' }).action, 'refuse');
    assert.equal(decideLink(c, { id: 'u6', status: 'SUSPENDED' }, null).action, 'refuse');
  });
});

describe('Administrator bootstrap', () => {
  const repo = () => {
    const users = new Map<string, { id: string; email: string; role: string; passwordHash: string }>(), log: string[] = [];
    const r: AdminRepo & { users: typeof users; log: string[] } = {
      users, log,
      async countAdmins() { return [...users.values()].filter((u) => u.role === 'ADMIN').length; },
      async findByEmail(e) { return [...users.values()].find((u) => u.email === e) ?? null; },
      async createAdmin(u) { const id = 'u' + (users.size + 1); users.set(id, { id, email: u.email, role: 'ADMIN', passwordHash: u.passwordHash }); return { id }; },
      async promoteAndSetPassword(id, h) { Object.assign(users.get(id)!, { role: 'ADMIN', passwordHash: h }); },
      async setPassword(id, h) { users.get(id)!.passwordHash = h; },
      async audit(a) { log.push(a); },
    };
    return r;
  };
  const hash = async (pw: string) => 'h:' + createHash('sha256').update(pw).digest('hex'); // stands in for bcrypt here
  const env = { ADMIN_EMAIL: 'Ops@CMG.example', ADMIN_PASSWORD: 'Tr4ck-Spindle-Quarry' };

  test('creates the first administrator from the environment; stores only a hash; refuses a second one', async () => {
    const r = repo();
    assert.deepEqual(await bootstrapAdmin(env, r, hash), { action: 'created', userId: 'u1' });
    const u = r.users.get('u1')!;
    assert.deepEqual([u.email, u.role], ['ops@cmg.example', 'ADMIN']);
    assert.ok(u.passwordHash.startsWith('h:') && !u.passwordHash.includes('Spindle'));
    await assert.rejects(bootstrapAdmin({ ...env, ADMIN_EMAIL: 'other@cmg.example' }, r, hash), /already exists/);
    assert.deepEqual(r.log, ['ADMIN_BOOTSTRAP_CREATE']);
  });

  test('weak passwords and bad e-mails are refused; --reset-password works only for that administrator', async () => {
    const r = repo();
    await assert.rejects(bootstrapAdmin({ ...env, ADMIN_PASSWORD: 'admin123' }, r, hash), /ADMIN_PASSWORD needs/);
    await assert.rejects(bootstrapAdmin({ ...env, ADMIN_EMAIL: 'not-an-email' }, r, hash), /e-mail/);
    await bootstrapAdmin(env, r, hash);
    const before = r.users.get('u1')!.passwordHash;
    assert.equal((await bootstrapAdmin({ ...env, ADMIN_PASSWORD: 'N3w-Lathe-Gantry-Bolt' }, r, hash, { resetPassword: true })).action, 'reset');
    assert.notEqual(r.users.get('u1')!.passwordHash, before);
    await assert.rejects(bootstrapAdmin({ ...env, ADMIN_EMAIL: 'nobody@cmg.example' }, r, hash, { resetPassword: true }), /no administrator/);
  });
});
