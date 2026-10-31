// Phase 8.5 — payments. ZainCash v2 and FIB web payments are exercised against LOCAL SIMULATORS
// that follow their published contracts (docs.zaincash.iq, fib.iq/developers/web-payment).
// No merchant account exists yet, so no real money moves; what is proven is the verification logic.
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';

import { FibClient } from '../../src/lib/payments/fib.ts';
import { signHS256, verifyHS256 } from '../../src/lib/payments/jwt.ts';
import { MemoryPaymentStore, PaymentService } from '../../src/lib/payments/service.ts';
import { canMove, invoiceTotal } from '../../src/lib/payments/types.ts';
import { mapZainStatus, ZainCashClient } from '../../src/lib/payments/zaincash.ts';

const API_KEY = 'zc-merchant-secret';
const Z = { tx: new Map<string, { status: string; amount: number }>(), tokens: 0, n: 0, reversed: [] as any[], reverseImmediate: true };
const F = { pay: new Map<string, { status: string; amount: number }>(), n: 0 };
let server: Server, base = '';
before(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c)).on('end', () => {
      const raw = Buffer.concat(chunks).toString();
      const send = (code: number, o?: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(o === undefined ? '' : JSON.stringify(o)); };
      const u = req.url || '';
      // ---- ZainCash
      if (u === '/zc/oauth2/token') { const p = new URLSearchParams(raw); Z.tokens++; return p.get('client_secret') === 'cs' && p.get('grant_type') === 'client_credentials' ? send(200, { access_token: 'zc-at', expires_in: 3600, token_type: 'Bearer' }) : send(401, { error: 'invalid_client' }); }
      if (u.startsWith('/zc/') && req.headers.authorization !== 'Bearer zc-at') return send(401, { message: 'unauthorized' });
      if (u === '/zc/api/v2/payment-gateway/transaction/init') {
        const b = JSON.parse(raw); if (b.amount.currency !== 'IQD') return send(400, { message: 'currency' });
        const id = 'ZTX' + ++Z.n; Z.tx.set(id, { status: 'PENDING', amount: b.amount.value });
        return send(200, { transactionId: id, redirectUrl: 'https://pg.example/pay/' + id });
      }
      if (u === '/zc/api/v2/payment-gateway/transaction/reverse') {
        const b = JSON.parse(raw), t = Z.tx.get(b.transactionId);
        if (!t || t.status !== 'SUCCESS') return send(400, { message: 'transaction is not reversible' });
        Z.reversed.push(b); if (Z.reverseImmediate) t.status = 'REFUNDED';
        return send(200, { transactionId: b.transactionId, status: Z.reverseImmediate ? 'REFUNDED' : 'PENDING' });
      }
      const inq = /^\/zc\/api\/v2\/payment-gateway\/transaction\/inquiry\/(.+)$/.exec(u);
      if (inq) { const t = Z.tx.get(inq[1]); return t ? send(200, { transactionId: inq[1], status: t.status, amount: { value: t.amount, currency: 'IQD' } }) : send(404, { code: 'PAYMENT_GATEWAY_TRANSACTION_NOT_FOUND' }); }
      // ---- FIB
      if (u === '/fib/auth/realms/fib-online-shop/protocol/openid-connect/token') return send(200, { access_token: 'fib-at', expires_in: 60, token_type: 'bearer' });
      if (u.startsWith('/fib/') && req.headers.authorization !== 'Bearer fib-at') return send(401, {});
      if (u === '/fib/protected/v1/payments') { const b = JSON.parse(raw); const id = 'FIB' + ++F.n; F.pay.set(id, { status: 'UNPAID', amount: Number(b.monetaryValue.amount) }); return send(202, { paymentId: id, readableCode: 'ABCD-1234', qrCode: 'data:', personalAppLink: 'https://fib.example/p/' + id, validUntil: '2026-12-01T00:00:00Z' }); }
      const st = /^\/fib\/protected\/v1\/payments\/(.+)\/status$/.exec(u);
      if (st) { const p = F.pay.get(st[1]); return p ? send(200, { paymentId: st[1], status: p.status, amount: { amount: p.amount, currency: 'IQD' } }) : send(404, {}); }
      send(404, {});
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
});
after(() => server.close());

const setup = () => {
  const store = new MemoryPaymentStore(), paid: string[] = [], failed: string[] = [];
  const zc = new ZainCashClient({ baseUrl: base + '/zc', clientId: 'ci', clientSecret: 'cs', apiKey: API_KEY, serviceType: 'JAWS' });
  const fib = new FibClient({ baseUrl: base + '/fib', clientId: 'fi', clientSecret: 'fs' });
  const svc = new PaymentService(store, { zaincash: zc, fib }, { onPaid: async (i) => { paid.push(i.number); }, onFailed: async (i) => { failed.push(i.number); } }, () => Date.UTC(2026, 9, 30));
  return { store, svc, paid, failed };
};
const lines = [{ description: 'طباعة حامل سماعة PLA', qty: 2, unitIqd: 7500 }, { description: 'توصيل', qty: 1, unitIqd: 5000 }];

describe('Payment basics', () => {
  test('invoice totals are whole dinars; numbering is sequential per year', async () => {
    assert.equal(invoiceTotal(lines), 20000);
    assert.throws(() => invoiceTotal([{ description: 'x', qty: 1, unitIqd: 10.5 }]), /whole dinars/);
    const { svc } = setup();
    const a = await svc.issueInvoice('o1', 'c1', lines, 'admin'), b = await svc.issueInvoice('o2', 'c1', lines, 'admin');
    assert.deepEqual([a.number, b.number, a.totalIqd], ['INV-2026-00001', 'INV-2026-00002', 20000]);
  });
  test('state machine: paid can only be refunded; failed and cancelled are final', () => {
    assert.ok(canMove('PENDING', 'PAID') && canMove('PROCESSING', 'PAID') && canMove('PAID', 'REFUNDED'));
    assert.ok(!canMove('PAID', 'FAILED') && !canMove('FAILED', 'PAID') && !canMove('CANCELED', 'PAID') && !canMove('REFUNDED', 'PAID'));
    assert.equal(mapZainStatus('SUCCESS'), 'PAID'); assert.equal(mapZainStatus('OTP_SENT'), 'PROCESSING'); assert.equal(mapZainStatus('EXPIRED'), 'FAILED');
    assert.throws(() => mapZainStatus('MAYBE'), /unknown/);
  });
  test('HS256 tokens: forged, "none", tampered and expired tokens are refused', () => {
    const now = Date.UTC(2026, 9, 30) / 1000;
    const good = signHS256({ data: { transactionId: 'T' }, exp: now + 600 }, API_KEY);
    assert.equal((verifyHS256(good, API_KEY, now * 1000) as any).data.transactionId, 'T');
    assert.throws(() => verifyHS256(signHS256({ a: 1 }, 'attacker'), API_KEY), /bad signature/);
    const none = Buffer.from('{"alg":"none"}').toString('base64url') + '.' + Buffer.from('{"a":1}').toString('base64url') + '.';
    assert.throws(() => verifyHS256(none, API_KEY), /unexpected algorithm/);
    const [h, , s] = good.split('.'); const tampered = h + '.' + Buffer.from(JSON.stringify({ data: { transactionId: 'OTHER' } })).toString('base64url') + '.' + s;
    assert.throws(() => verifyHS256(tampered, API_KEY), /bad signature/);
    assert.throws(() => verifyHS256(signHS256({ exp: now - 3600 }, API_KEY), API_KEY, now * 1000), /expired/);
  });
});

describe('ZainCash flow (simulated gateway)', () => {
  test('init → customer pays → signed webhook + server inquiry → PAID once; a replay changes nothing', async () => {
    const { store, svc, paid } = setup();
    const inv = await svc.issueInvoice('o1', 'c1', lines, 'admin');
    const p = await svc.startPayment(inv.id, 'zaincash', { successUrl: 'https://forma.example/pay/ok', failureUrl: 'https://forma.example/pay/fail' });
    assert.equal(p.redirectUrl, 'https://pg.example/pay/' + p.providerRef);
    // the customer comes back on the success URL before paying: the inquiry still says PENDING
    const early = await svc.zaincashToken(signHS256({ data: { transactionId: p.providerRef, status: 'SUCCESS' } }, API_KEY), 'redirect');
    assert.equal(early.status, 'PENDING', 'a "SUCCESS" claim in the token alone does not mark it paid');
    Z.tx.get(p.providerRef!)!.status = 'SUCCESS';
    const wh = signHS256({ eventId: 'evt-1', eventType: 'STATUS_CHANGED', data: { transactionId: p.providerRef, status: 'SUCCESS' } }, API_KEY);
    assert.equal((await svc.zaincashToken(wh, 'webhook')).status, 'PAID');
    assert.equal((await store.getInvoice(inv.id))!.status, 'PAID');
    await svc.zaincashToken(wh, 'webhook');
    assert.deepEqual(paid, [inv.number], 'the paid hook ran exactly once');
  });
  test('a forged webhook is refused; an amount mismatch is flagged and not paid', async () => {
    const { store, svc } = setup();
    const inv = await svc.issueInvoice('o1', 'c1', lines, 'admin');
    const p = await svc.startPayment(inv.id, 'zaincash', { successUrl: 'https://x/ok', failureUrl: 'https://x/no' });
    await assert.rejects(svc.zaincashToken(signHS256({ data: { transactionId: p.providerRef } }, 'guess'), 'webhook'), /bad signature/);
    Z.tx.set(p.providerRef!, { status: 'SUCCESS', amount: 1000 });
    await assert.rejects(svc.zaincashToken(signHS256({ eventId: 'e2', data: { transactionId: p.providerRef } }, API_KEY), 'webhook'), /does not match/);
    assert.equal((await store.getPayment(p.id))!.status, 'PENDING');
    assert.ok(store.log.some((l) => l.action === 'payment.amount_mismatch'));
  });
  test('failure moves to FAILED and fires the failure hook; it can never become PAID afterwards', async () => {
    const { svc, failed } = setup();
    const inv = await svc.issueInvoice('o1', 'c1', lines, 'admin');
    const p = await svc.startPayment(inv.id, 'zaincash', { successUrl: 'https://x/ok', failureUrl: 'https://x/no' });
    Z.tx.get(p.providerRef!)!.status = 'EXPIRED';
    assert.equal((await svc.zaincashToken(signHS256({ eventId: 'e3', data: { transactionId: p.providerRef } }, API_KEY), 'webhook')).status, 'FAILED');
    Z.tx.get(p.providerRef!)!.status = 'SUCCESS';
    assert.equal((await svc.zaincashToken(signHS256({ eventId: 'e4', data: { transactionId: p.providerRef } }, API_KEY), 'webhook')).status, 'FAILED');
    assert.deepEqual(failed, [inv.number]);
  });
});

describe('FIB flow (simulated bank)', () => {
  test('the unsigned callback is not believed: only FIB status PAID marks the payment paid', async () => {
    const { svc, paid } = setup();
    const inv = await svc.issueInvoice('o1', 'c1', lines, 'admin');
    const p = await svc.startPayment(inv.id, 'fib', { successUrl: '', failureUrl: '', callbackUrl: 'https://forma.example/api/webhooks/fib' });
    assert.match(p.redirectUrl!, /fib\.example/);
    assert.equal((await svc.fibCallback({ id: p.providerRef, status: 'PAID' })).status, 'PENDING', 'a forged "PAID" callback is ignored');
    F.pay.get(p.providerRef!)!.status = 'PAID';
    assert.equal((await svc.fibCallback({ id: p.providerRef })).status, 'PAID');
    assert.deepEqual(paid, [inv.number]);
    await assert.rejects(svc.fibCallback({}), /without payment id/);
  });
});

describe('Reconciliation', () => {
  test('a payment whose webhook never arrived is settled by asking the provider; young payments are left alone', async () => {
    const store = new MemoryPaymentStore(); let now = Date.UTC(2026, 9, 30);
    const zc = new ZainCashClient({ baseUrl: base + '/zc', clientId: 'ci', clientSecret: 'cs', apiKey: API_KEY, serviceType: 'JAWS' });
    const svc = new PaymentService(store, { zaincash: zc, fib: new FibClient({ baseUrl: base + '/fib', clientId: 'fi', clientSecret: 'fs' }) }, {}, () => now);
    const inv = await svc.issueInvoice('o', 'c', lines, 'a'), inv2 = await svc.issueInvoice('o2', 'c', lines, 'a');
    const p = await svc.startPayment(inv.id, 'zaincash', { successUrl: 'https://x/ok', failureUrl: 'https://x/no' });
    const f = await svc.startPayment(inv2.id, 'fib', { successUrl: '', failureUrl: '' });
    Z.tx.get(p.providerRef!)!.status = 'SUCCESS'; F.pay.get(f.providerRef!)!.status = 'DECLINED';
    assert.deepEqual(await svc.reconcile(), { checked: 0, changed: 0, errors: 0 }, 'too young');
    now += 5 * 60_000;
    assert.deepEqual(await svc.reconcile(), { checked: 2, changed: 2, errors: 0 });
    assert.equal((await store.getPayment(p.id))!.status, 'PAID');
    assert.equal((await store.getPayment(f.id))!.status, 'FAILED');
  });
});

describe('Refunds', () => {
  const paidZain = async () => {
    const env = setup();
    const inv = await env.svc.issueInvoice('o1', 'c1', lines, 'admin');
    const p = await env.svc.startPayment(inv.id, 'zaincash', { successUrl: 'https://x/ok', failureUrl: 'https://x/no' });
    Z.tx.get(p.providerRef!)!.status = 'SUCCESS';
    await env.svc.zaincashToken(signHS256({ eventId: 'pay-' + p.id, data: { transactionId: p.providerRef } }, API_KEY), 'webhook');
    return { ...env, inv, p };
  };
  test('ZainCash: reverse API, then REFUNDED only when the provider says so; invoice follows', async () => {
    Z.reverseImmediate = true;
    const { svc, store, inv, p } = await paidZain();
    await assert.rejects(svc.refund(p.id, { id: 'op', role: 'operator' }, { reason: 'customer cancelled' }), /only an admin/);
    await assert.rejects(svc.refund(p.id, { id: 'a', role: 'admin' }, { reason: '' }), /reason is required/);
    const r = await svc.refund(p.id, { id: 'a', role: 'admin' }, { reason: 'customer cancelled' });
    assert.equal(r.status, 'REFUNDED');
    assert.equal((await store.getInvoice(inv.id))!.status, 'REFUNDED');
    assert.equal(Z.reversed.at(-1).transactionId, p.providerRef);
    assert.ok(store.log.some((l) => l.action === 'payment.refund_requested' && l.actorId === 'a'));
  });
  test('ZainCash: an accepted reverse that completes later is settled by reconciliation; no second reverse', async () => {
    Z.reverseImmediate = false;
    const { svc, store, p } = await paidZain();
    const r = await svc.refund(p.id, { id: 'a', role: 'admin' }, { reason: 'wrong colour' });
    assert.equal(r.status, 'PAID'); assert.ok(r.refundRequestedAt);
    await assert.rejects(svc.refund(p.id, { id: 'a', role: 'admin' }, { reason: 'again please' }), /already requested/);
    Z.tx.get(p.providerRef!)!.status = 'REFUNDED';
    // reconciliation runs on payments older than 2 minutes; the clock in setup() is fixed, so ask directly with age 0
    const out = await svc.reconcile(0);
    assert.equal(out.changed, 1);
    assert.equal((await store.getPayment(p.id))!.status, 'REFUNDED');
    Z.reverseImmediate = true;
  });
  test('FIB has no refund API: the admin returns the money by transfer and records its reference', async () => {
    const { svc } = setup();
    const inv = await svc.issueInvoice('o1', 'c1', lines, 'admin');
    const p = await svc.startPayment(inv.id, 'fib', { successUrl: '', failureUrl: '' });
    F.pay.get(p.providerRef!)!.status = 'PAID';
    await svc.fibCallback({ id: p.providerRef });
    await assert.rejects(svc.refund(p.id, { id: 'a', role: 'admin' }, { reason: 'defect' }), /FIB has no refund API/);
    const r = await svc.refund(p.id, { id: 'a', role: 'admin' }, { reason: 'defect', reference: 'FIB-OUT-7731' });
    assert.equal(r.status, 'REFUNDED');
    assert.equal(r.events.at(-1)!.ref, 'FIB-OUT-7731');
    await assert.rejects(svc.refund(p.id, { id: 'a', role: 'admin' }, { reason: 'twice', reference: 'x-123' }), /only a PAID payment/);
  });
});

describe('Manual payments', () => {
  test('only an admin, with a reference and the right amount, can record a manual payment; it is audited', async () => {
    const { store, svc } = setup();
    const inv = await svc.issueInvoice('o1', 'c1', lines, 'admin');
    await assert.rejects(svc.recordManual(inv.id, { id: 'op', role: 'operator' }, { method: 'cash', reference: 'R-1', amountIqd: 20000 }), /only an admin/);
    await assert.rejects(svc.recordManual(inv.id, { id: 'a', role: 'admin' }, { method: 'cash', reference: '', amountIqd: 20000 }), /reference is required/);
    await assert.rejects(svc.recordManual(inv.id, { id: 'a', role: 'admin' }, { method: 'cash', reference: 'R-1', amountIqd: 15000 }), /does not match/);
    const ok = await svc.recordManual(inv.id, { id: 'a', role: 'admin' }, { method: 'transfer', reference: 'FIB-TRX-889', amountIqd: 20000 });
    assert.equal(ok.status, 'PAID');
    assert.ok(store.log.some((l) => l.action === 'payment.manual_recorded' && l.actorId === 'a' && /FIB-TRX-889/.test(l.detail)));
    await assert.rejects(svc.recordManual(inv.id, { id: 'a', role: 'admin' }, { method: 'cash', reference: 'again', amountIqd: 20000 }), /invoice is PAID/);
  });
  test('without credentials nothing pretends to work', async () => {
    assert.equal(ZainCashClient.fromEnv({}), null); assert.equal(FibClient.fromEnv({}), null);
    const store = new MemoryPaymentStore(), svc = new PaymentService(store, {});
    const inv = await svc.issueInvoice('o', 'c', lines, 'a');
    await assert.rejects(svc.startPayment(inv.id, 'zaincash', { successUrl: '', failureUrl: '' }), /not configured/);
  });
});
