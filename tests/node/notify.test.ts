// Phase 8.5 — notifications. WhatsApp Cloud API and the e-mail API are exercised against LOCAL
// SIMULATORS of their documented contracts (no Meta or provider account here); the service logic
// (preferences, idempotency, retries, receipts, privacy) is tested directly.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';

import { EmailClient } from '../../src/lib/notify/email.ts';
import { clickToChat, maskPhone, normalizeIraqiMobile } from '../../src/lib/notify/phone.ts';
import { MAX_ATTEMPTS, MemoryNotifyStore, NotificationService, backoffMs } from '../../src/lib/notify/service.ts';
import { parseStatuses, verifyHandshake, verifyMetaSignature, WhatsAppClient } from '../../src/lib/notify/whatsapp.ts';

const sim = { mode: 'ok' as 'ok' | '429' | '400' | '500', calls: [] as { path: string; auth?: string; body: any }[] };
let server: Server, base = '';
before(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c)).on('end', () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
      sim.calls.push({ path: req.url || '', auth: req.headers.authorization, body });
      const send = (code: number, o: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (sim.mode === '429') return send(429, { error: { message: 'Too many requests', code: 130429 } });
      if (sim.mode === '500') return send(500, { error: { message: 'internal' } });
      if (sim.mode === '400') return send(400, { error: { message: '(#132001) Template name does not exist in the translation', code: 132001 } });
      if (req.url?.endsWith('/messages')) return send(200, { messaging_product: 'whatsapp', contacts: [{ input: body.to, wa_id: body.to }], messages: [{ id: 'wamid.' + sim.calls.length }] });
      if (req.url === '/emails') return send(200, { id: 'em_' + sim.calls.length });
      send(404, {});
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
});
after(() => server.close());

describe('phone numbers and links', () => {
  test('Iraqi mobile numbers normalise to WhatsApp format; others are refused', () => {
    for (const s of ['07822678298', '0782 267 8298', '+964 782 267 8298', '009647822678298', '7822678298']) assert.equal(normalizeIraqiMobile(s), '9647822678298', s);
    for (const s of ['0612345678', '078226782', '+44 7822 678298', 'abc']) assert.equal(normalizeIraqiMobile(s), null, s);
    assert.equal(clickToChat('9647822678298', 'مرحبا'), 'https://wa.me/9647822678298?text=%D9%85%D8%B1%D8%AD%D8%A8%D8%A7');
    assert.equal(maskPhone('9647822678298'), '•••••••••8298');
  });
});

describe('WhatsApp Cloud API', () => {
  test('webhook signature: valid HMAC accepted, tampered body or wrong secret rejected', () => {
    const raw = Buffer.from('{"entry":[]}'), sig = 'sha256=' + createHmac('sha256', 'app-secret').update(raw).digest('hex');
    assert.equal(verifyMetaSignature(raw, sig, 'app-secret'), true);
    assert.equal(verifyMetaSignature(Buffer.from('{"entry":[1]}'), sig, 'app-secret'), false);
    assert.equal(verifyMetaSignature(raw, sig, 'other'), false);
    assert.equal(verifyMetaSignature(raw, undefined, 'app-secret'), false);
    assert.equal(verifyMetaSignature(raw, 'sha256=00', 'app-secret'), false);
  });
  test('verification handshake echoes the challenge only for the right token', () => {
    assert.equal(verifyHandshake(new URLSearchParams('hub.mode=subscribe&hub.verify_token=t0k&hub.challenge=123'), 't0k'), '123');
    assert.equal(verifyHandshake(new URLSearchParams('hub.mode=subscribe&hub.verify_token=bad&hub.challenge=123'), 't0k'), null);
    assert.equal(verifyHandshake(new URLSearchParams('hub.mode=subscribe&hub.verify_token=&hub.challenge=1'), ''), null);
  });
  test('template message payload follows the Cloud API contract', async () => {
    sim.mode = 'ok'; sim.calls.length = 0;
    const wa = new WhatsAppClient({ token: 'tok', phoneNumberId: '1234', baseUrl: base, version: 'v21.0' });
    const r = await wa.sendTemplate('9647822678298', 'forma_print_done', 'ar', ['حامل']);
    assert.match(r.id, /^wamid\./);
    const c = sim.calls[0];
    assert.equal(c.path, '/v21.0/1234/messages'); assert.equal(c.auth, 'Bearer tok');
    assert.deepEqual(c.body, { messaging_product: 'whatsapp', to: '9647822678298', type: 'template', template: { name: 'forma_print_done', language: { code: 'ar' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'حامل' }] }] } });
  });
  test('delivery receipts are parsed from webhook bodies', () => {
    const body = { entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.1', status: 'delivered', recipient_id: '9647822678298', timestamp: '1700000000' }, { id: 'wamid.2', status: 'failed', recipient_id: '1', timestamp: '1700000001', errors: [{ title: 'Re-engagement message' }] }] } }] }] };
    assert.deepEqual(parseStatuses(body).map((s) => [s.messageId, s.status, s.error]), [['wamid.1', 'delivered', undefined], ['wamid.2', 'failed', 'Re-engagement message']]);
  });
  test('fromEnv returns null without credentials (nothing is faked)', () => {
    assert.equal(WhatsAppClient.fromEnv({}), null);
    assert.equal(EmailClient.fromEnv({}), null);
  });
});

describe('Notification service', () => {
  const setup = () => {
    const store = new MemoryNotifyStore(); let now = 1_000_000;
    store.users.set('u1', { id: 'u1', locale: 'ar', email: 'a@example.com', emailVerified: true, phone: '07822678298', phoneVerified: true });
    store.users.set('u2', { id: 'u2', locale: 'en', email: 'b@example.com', emailVerified: false, phone: '0782', phoneVerified: true });
    store.prefs.set('u1', { channels: { inapp: true, email: true, whatsapp: true } });
    const svc = new NotificationService(store, { email: new EmailClient({ apiKey: 'k', from: 'Forma <n@forma.example>', url: base }), whatsapp: new WhatsAppClient({ token: 'tok', phoneNumberId: '1234', baseUrl: base }) }, () => now);
    return { store, svc, tick: (ms: number) => (now += ms) };
  };
  const ev = { id: 'job7:print_done', type: 'print_done' as const, userIds: ['u1', 'u2'], vars: { project: 'حامل سماعة' }, link: '/p/7', at: 0 };

  test('channels follow preferences and verified contacts; WhatsApp is opt-in; the event is idempotent', async () => {
    const { store, svc } = setup();
    const d1 = await svc.enqueue(ev);
    assert.deepEqual(d1.map((d) => `${d.userId}:${d.channel}`).sort(), ['u1:email', 'u1:inapp', 'u1:whatsapp', 'u2:inapp']);
    assert.equal(d1.find((d) => d.userId === 'u2')!.title, 'Print finished');
    assert.equal(d1.find((d) => d.userId === 'u1')!.body, 'اكتملت طباعة «حامل سماعة».');
    await svc.enqueue(ev);
    assert.equal(store.deliveries.size, 4, 're-sending the same event creates nothing new');
    // privacy: no contact detail is stored on deliveries
    assert.ok(![...store.deliveries.values()].some((d) => JSON.stringify(d).includes('7822678298') || JSON.stringify(d).includes('@example.com')));
  });

  test('dispatch sends, a 429 is retried with backoff, a 4xx stops at once, receipts update the status', async () => {
    const { store, svc, tick } = setup();
    await svc.enqueue(ev);
    sim.mode = 'ok'; sim.calls.length = 0;
    assert.deepEqual(await svc.dispatch(), { sent: 4, retried: 0, failed: 0 });
    assert.equal(store.inbox.length, 2);
    const wa = [...store.deliveries.values()].find((d) => d.channel === 'whatsapp')!;
    assert.ok(sim.calls.some((c) => c.body && c.body.template && c.body.to === '9647822678298' && c.body.template.components[0].parameters[0].text === 'حامل سماعة'));
    assert.equal(await svc.applyReceipt({ messageId: wa.providerId!, status: 'read', recipient: 'x', timestamp: 0 }), true);
    assert.equal(store.deliveries.get(wa.key)!.status, 'read');
    await svc.applyReceipt({ messageId: wa.providerId!, status: 'delivered', recipient: 'x', timestamp: 0 }); // late receipt never goes backwards
    assert.equal(store.deliveries.get(wa.key)!.status, 'read');

    await svc.enqueue({ ...ev, id: 'job8:print_done', userIds: ['u1'] });
    sim.mode = '429';
    const r1 = await svc.dispatch();
    assert.equal(r1.retried, 2); // email + whatsapp; in-app always succeeds
    const k = 'job8:print_done:u1:whatsapp';
    assert.equal(store.deliveries.get(k)!.nextAttemptAt - 1_000_000, backoffMs(1));
    assert.deepEqual(await svc.dispatch(), { sent: 0, retried: 0, failed: 0 }, 'not due yet');
    for (let i = 2; i <= MAX_ATTEMPTS; i++) { tick(backoffMs(i - 1)); await svc.dispatch(); }
    assert.equal(store.deliveries.get(k)!.status, 'failed');
    assert.equal(store.deliveries.get(k)!.attempts, MAX_ATTEMPTS);

    await svc.enqueue({ ...ev, id: 'job9:print_done', userIds: ['u1'] });
    sim.mode = '400';
    const r2 = await svc.dispatch();
    assert.equal(r2.failed, 2);
    assert.match(store.deliveries.get('job9:print_done:u1:whatsapp')!.lastError!, /Template name does not exist/);
    sim.mode = 'ok';
  });

  test('a muted event type produces nothing; unconfigured channels fail permanently, not silently', async () => {
    const { store, svc } = setup();
    store.prefs.set('u1', { channels: { inapp: true, email: true, whatsapp: true }, muted: ['print_done'] });
    assert.equal((await svc.enqueue({ ...ev, userIds: ['u1'] })).length, 0);
    const bare = new NotificationService(store, {}, () => 5);
    store.prefs.set('u1', { channels: { inapp: false, email: true } });
    await bare.enqueue({ ...ev, id: 'x', userIds: ['u1'] });
    assert.deepEqual(await bare.dispatch(), { sent: 0, retried: 0, failed: 1 });
    assert.match(store.deliveries.get('x:u1:email')!.lastError!, /not configured/);
  });
});
