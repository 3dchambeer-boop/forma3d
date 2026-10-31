// Phase 9 — security: signed downloads, rate limiting, authorization rules (explicit unauthorized cases),
// e-mail verification tokens.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import * as R from '../../src/lib/access-rules.ts';
import { checkEmailToken, emailToken } from '../../src/lib/notify/verify-email.ts';
import { RateLimiter, rateLimited } from '../../src/lib/security/rate-limit.ts';
import { signDownload, signingSecret, verifyDownload } from '../../src/lib/security/signed-url.ts';

const SECRET = 'x'.repeat(40);
const T0 = Date.UTC(2026, 9, 30);

describe('Signed download links', () => {
  test('valid until expiry, bound to one file and kind, tamper-proof', () => {
    const t = signDownload({ kind: 'models', key: 'abc.stl', sub: 'u1', ttlMs: 60_000 }, SECRET, T0);
    assert.deepEqual(verifyDownload(t, { kind: 'models', key: 'abc.stl' }, SECRET, T0 + 59_000), { ok: true, claim: { kind: 'models', key: 'abc.stl', sub: 'u1', exp: T0 + 60_000 } });
    assert.equal((verifyDownload(t, { kind: 'models', key: 'abc.stl' }, SECRET, T0 + 61_000) as any).reason, 'expired');
    assert.equal((verifyDownload(t, { kind: 'models', key: 'other.stl' }, SECRET, T0) as any).reason, 'wrong_file');
    assert.equal((verifyDownload(t, { kind: 'gcode', key: 'abc.stl' }, SECRET, T0) as any).reason, 'wrong_file');
    assert.equal((verifyDownload(t, { kind: 'models', key: 'abc.stl' }, 'y'.repeat(40), T0) as any).reason, 'bad_signature');
    const [body, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ k: 'models', f: 'abc.stl', s: 'u1', e: T0 + 10 * 86400_000 })).toString('base64url') + '.' + sig;
    assert.equal((verifyDownload(forged, { kind: 'models', key: 'abc.stl' }, SECRET, T0) as any).reason, 'bad_signature');
    assert.equal((verifyDownload(body, { kind: 'models', key: 'abc.stl' }, SECRET, T0) as any).reason, 'malformed');
    assert.throws(() => signDownload({ kind: 'models', key: 'a', sub: 'u', ttlMs: 2 * 86400_000 }, SECRET), /24 h/);
    assert.throws(() => signingSecret({ DOWNLOAD_SIGNING_SECRET: 'short' }), /32 characters/);
  });
});

describe('Rate limiting', () => {
  test('a key gets max requests per window, then 429 with Retry-After; other keys are independent', () => {
    let now = T0;
    const l = new RateLimiter(1000, () => now);
    for (let i = 0; i < 3; i++) assert.equal(l.check('k', { max: 3, windowMs: 10_000 }).allowed, true);
    const d = l.check('k', { max: 3, windowMs: 10_000 });
    assert.deepEqual([d.allowed, d.retryAfterMs], [false, 10_000]);
    assert.equal(l.check('other', { max: 3, windowMs: 10_000 }).allowed, true);
    now += 10_001;
    assert.equal(l.check('k', { max: 3, windowMs: 10_000 }).allowed, true);
  });
  test('memory stays bounded (oldest keys evicted) and the 429 response is well-formed', async () => {
    const l = new RateLimiter(100, () => T0);
    for (let i = 0; i < 1000; i++) l.check('ip' + i, { max: 1, windowMs: 1000 });
    assert.ok((l as any).hits.size <= 100);
    const lim = new RateLimiter(10, () => T0);
    for (let i = 0; i < 120; i++) assert.equal(rateLimited('1.2.3.4', 'webhook', lim), null);
    const res = rateLimited('1.2.3.4', 'webhook', lim)!;
    assert.equal(res.status, 429); assert.equal(res.headers.get('Retry-After'), '60');
    assert.equal((await res.json()).error.code, 'TOO_MANY_REQUESTS');
  });
});

describe('Authorization rules (explicit unauthorized cases)', () => {
  const owner = { id: 'u1', role: 'END_USER' }, other = { id: 'u2', role: 'END_USER' }, designer = { id: 'd', role: 'DESIGNER' }, farm = { id: 'f', role: 'FARM_MANAGER' }, admin = { id: 'a', role: 'ADMIN' };
  test('projects and reviews', () => {
    assert.equal(R.canViewProject(other, { ownerId: 'u1' }), false, 'another customer cannot see my project');
    assert.equal(R.canViewProject(farm, { ownerId: 'u1' }), false, 'the farm sees jobs, not design projects');
    assert.ok(R.canViewProject(owner, { ownerId: 'u1' }) && R.canViewProject(designer, { ownerId: 'u1' }) && R.canViewProject(admin, { ownerId: 'u1' }));
    assert.equal(R.canEditProject(designer, { ownerId: 'u1' }), false);
    assert.equal(R.canEditProject(other, { ownerId: 'u1' }), false);
    assert.equal(R.canReviewDesign(owner), false);
    assert.equal(R.canReviewDesign(farm), false);
  });
  test('files: models need ownership/approval, G-code only for the farm', () => {
    assert.equal(R.canReadModel(other, { ownerId: 'u1', status: 'APPROVED' }), false);
    assert.equal(R.canReadModel(farm, { ownerId: 'u1', status: 'PENDING_REVIEW' }), false, 'unapproved designs never reach the farm');
    assert.equal(R.canReadModel(farm, { ownerId: 'u1', status: 'APPROVED' }), true);
    assert.equal(R.canReadModel(owner, null), false, 'unknown file');
    assert.equal(R.canReadGcode(owner, true), false);
    assert.equal(R.canReadGcode(designer, true), false);
    assert.equal(R.canReadGcode(farm, false), false);
    assert.equal(R.canReadGcode(farm, true), true);
  });
  test('money and contact details', () => {
    assert.equal(R.canRecordPayment(farm), false); assert.equal(R.canRecordPayment(owner), false); assert.ok(R.canRecordPayment(admin));
    assert.equal(R.canIssueInvoice(owner), false); assert.equal(R.canIssueInvoice(designer), false);
    assert.equal(R.canSeeInvoice(other, { customerId: 'u1' }), false);
    assert.equal(R.canSeeContact(farm, { id: 'u1' }), false, 'operators never see customer phone/e-mail');
    assert.equal(R.canSeeContact(designer, { id: 'u1' }), false);
    assert.equal(R.canOperatePrinter(designer), false); assert.equal(R.canOperatePrinter(owner), false);
  });
});

describe('E-mail verification', () => {
  test('the link verifies only that user and that address, before expiry', () => {
    const t = emailToken('u1', 'Ameer@Example.com ', SECRET, T0);
    assert.deepEqual(checkEmailToken(t, { id: 'u1', email: 'ameer@example.com' }, SECRET, T0 + 1000), { ok: true });
    assert.equal(checkEmailToken(t, { id: 'u2', email: 'ameer@example.com' }, SECRET, T0).reason, 'other_user');
    assert.equal(checkEmailToken(t, { id: 'u1', email: 'new@example.com' }, SECRET, T0).reason, 'address_changed');
    assert.equal(checkEmailToken(t, { id: 'u1', email: 'ameer@example.com' }, SECRET, T0 + 49 * 3600_000).reason, 'expired');
    assert.equal(checkEmailToken(t.slice(0, -2) + 'xx', { id: 'u1', email: 'ameer@example.com' }, SECRET, T0).reason, 'bad_signature');
  });
});
