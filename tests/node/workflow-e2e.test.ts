// Phase 9 — the whole customer → print workflow in 19 steps, through the application's own code.
//
// Each step is labelled:
//   REAL       our code and the real component (CAD kernel, drawing, OpenCascade, OrcaSlicer, payments state machine…)
//   SIMULATED  an external service that is not reachable from the test machine is replaced by a local test double that
//              speaks its documented API: the Claude Messages API, the ZainCash gateway, the WhatsApp Cloud API, OctoPrint.
//   NOT RUN    the real component is not installed here (never replaced by a fake): reported, and the step is skipped.
// OpenCascade runs when services/cad_engine/native/build/forma_occ (or FORMA_OCC_BIN) exists with its libraries on
// LD_LIBRARY_PATH; OrcaSlicer runs when ORCASLICER_BIN / ORCASLICER_PROFILE_DIR are set.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { CadClient } from '../../src/lib/cad/cad-client.ts';
import { askJson } from '../../src/lib/generation/anthropic.ts';
import { ledger, resetLedger, UsageLedger } from '../../src/lib/generation/usage.ts';
import { canReviewDesign, canRecordPayment, canSeeContact, canIssueInvoice } from '../../src/lib/access-rules.ts';
import { MemoryNotifyStore, NotificationService } from '../../src/lib/notify/service.ts';
import { checkEmailToken, emailToken } from '../../src/lib/notify/verify-email.ts';
import { WhatsAppClient } from '../../src/lib/notify/whatsapp.ts';
import { signHS256 } from '../../src/lib/payments/jwt.ts';
import { MemoryPaymentStore, PaymentService } from '../../src/lib/payments/service.ts';
import { ZainCashClient } from '../../src/lib/payments/zaincash.ts';
import { runOrcaSlicer } from '../../src/lib/orcaslicer.ts';
import { checkGcode, OctoPrintClient } from '../../src/lib/printing/octoprint.ts';
import { signDownload, verifyDownload } from '../../src/lib/security/signed-url.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const B = join(ROOT, 'services/ai_3d_engine/browser/');
const CAD = require(B + 'cad.js'), A = require(B + 'agents.js'), CON = require(B + 'concepts.js'), D = require(B + 'drawing.js');
const C = require(B + 'calibration.js'), V = require(B + 'versions.js'), COM = require(B + 'commerce.js'), PDFLib = require(B + 'vendor/pdf-lib.min.js');
const sha = (u: Uint8Array) => createHash('sha256').update(u).digest('hex');
const OCC_BIN = process.env.FORMA_OCC_BIN || join(ROOT, 'services/cad_engine/native/build/forma_occ');
const OCC = existsSync(OCC_BIN);
const ORCA = !!(process.env.ORCASLICER_BIN && process.env.ORCASLICER_PROFILE_DIR);
const work = mkdtempSync(join(tmpdir(), 'forma-wf-'));

// ---------------------------------------------------------------- the three concepts the simulated Claude answers with
const DESIGNS: Record<string, any> = {
  'مشبك على حافة الرف': { name_ar: 'مشبك رف', summary_ar: 'مشبك يركب على حافة الرف.', requirements: [], parameters: [], checks: [], print: { material: 'PLA' },
    model: { difference: [{ box: { size: [30, 40, 30] } }, { box: { size: [32, 26, 20] }, translate: [-1, 7, -1] }] } },
  'لوح لاصق': { name_ar: 'لوح لاصق', summary_ar: 'لوح يلصق على الحائط.', requirements: [], parameters: [], checks: [], print: { material: 'PLA' },
    model: { box: { size: [80, 30, 4] } } },
  'خطاف بمسمار': { name_ar: 'خطاف بمسمار', summary_ar: 'خطاف يثبت بمسمار واحد.', requirements: ['The hook width is set by w.'], checks: [],
    parameters: [{ name: 'w', label_ar: 'العرض', value: 20, unit: 'mm', min: 10, max: 40 }],
    print: { material: 'PLA', layer_height_mm: 0.2, infill_percent: 20, supports: false },
    model: { difference: [
      { union: [{ box: { size: ['w', 8, 60] } }, { box: { size: ['w', 30, 8] } }, { box: { size: ['w', 8, 20] }, translate: [0, 22, 0] }] },
      { cylinder: { d: 4.5, h: 20, segments: 48 }, rotate: [90, 0, 0], translate: ['w/2', 12, 45] }] } },
};
const CONCEPTS = Object.keys(DESIGNS).map((t, i) => ({ key: 'c' + i, title_ar: t, approach_ar: t }));

// ---------------------------------------------------------------- one local server for all simulated services
const sim = { claude: [] as string[], zain: new Map<string, { status: string; amount: number }>(), wa: [] as any[], octo: { files: new Map<string, Buffer>(), started: 0, selected: '' } };
const ZC_KEY = 'zc-merchant-secret', OCTO_KEY = 'octo-key';
let server: Server, base = '';
const body = async (req: IncomingMessage) => { const c: Buffer[] = []; for await (const x of req) c.push(x as Buffer); return Buffer.concat(c); };
before(async () => {
  server = createServer(async (req, res) => {
    const raw = await body(req), u = req.url || '';
    const send = (code: number, o?: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(o === undefined ? '' : JSON.stringify(o)); };
    if (u === '/v1/messages') { // Claude Messages API
      const prompt: string = JSON.parse(raw.toString()).messages[0].content;
      sim.claude.push(prompt);
      const reply = (v: unknown) => send(200, { content: [{ type: 'text', text: JSON.stringify(v) }], stop_reason: 'end_turn', usage: { input_tokens: Math.ceil(prompt.length / 4), output_tokens: 400 } });
      if (prompt.includes('ask the minimum precise questions')) return reply({ understanding_ar: 'خطاف يعلّق على الرف أو الحائط لحمل سماعة رأس.', object_type: 'headphone hook', ready: false, questions: [{ id: 'q1', question_ar: 'كم عرض السماعة؟', why_ar: 'يحدد عرض الخطاف', kind: 'number', unit: 'mm', suggested: '20' }], assumptions_ar: [] });
      if (prompt.includes('genuinely different design concepts')) return reply({ concepts: CONCEPTS });
      const m = /DESIGN CONCEPT TO BUILD: "([^"]+)"/.exec(prompt);
      if (m && DESIGNS[m[1]]) return reply(DESIGNS[m[1]]);
      return send(400, { type: 'error', error: { type: 'invalid_request_error', message: 'unexpected prompt in the simulator' } });
    }
    if (u === '/zc/oauth2/token') return send(200, { access_token: 'zc-at', expires_in: 3600, token_type: 'Bearer' });
    if (u === '/zc/api/v2/payment-gateway/transaction/init') { const b = JSON.parse(raw.toString()); const id = 'ZTX' + (sim.zain.size + 1); sim.zain.set(id, { status: 'PENDING', amount: b.amount.value }); return send(200, { transactionId: id, redirectUrl: 'https://pg.example/pay/' + id }); }
    const inq = /^\/zc\/api\/v2\/payment-gateway\/transaction\/inquiry\/(.+)$/.exec(u);
    if (inq) { const t = sim.zain.get(inq[1])!; return send(200, { transactionId: inq[1], status: t.status, amount: { value: t.amount, currency: 'IQD' } }); }
    if (/^\/v\d+\.\d+\/\d+\/messages$/.test(u)) { const b = JSON.parse(raw.toString()); sim.wa.push(b); return send(200, { messaging_product: 'whatsapp', contacts: [{ input: b.to, wa_id: b.to }], messages: [{ id: 'wamid.' + sim.wa.length }] }); }
    if (u.startsWith('/octo/')) {
      if (req.headers['x-api-key'] !== OCTO_KEY) return send(403, { error: 'Forbidden' });
      const p = u.slice(5);
      if (p === '/api/version') return send(200, { api: '0.1', server: '1.10.0' });
      if (p === '/api/printer') return send(200, { state: { text: 'Operational', flags: { operational: true, printing: sim.octo.started > 0, paused: false, ready: sim.octo.started === 0, error: false, closedOrError: false } }, temperature: { tool0: { actual: 24, target: 0 }, bed: { actual: 23, target: 0 } } });
      if (p === '/api/files/local' && req.method === 'POST') {
        const form = await new Request('http://x/', { method: 'POST', headers: { 'content-type': req.headers['content-type']! }, body: new Uint8Array(raw) }).formData();
        const f = form.get('file') as File; sim.octo.files.set(f.name, Buffer.from(await f.arrayBuffer()));
        return send(201, { done: true, files: { local: { name: f.name, path: f.name, origin: 'local' } } });
      }
      const fm = /^\/api\/files\/local\/(.+)$/.exec(p);
      if (fm) { const n = decodeURIComponent(fm[1]); if (req.method === 'GET') return send(200, { name: n, path: n, size: sim.octo.files.get(n)!.length }); sim.octo.selected = n; return send(204); }
      if (p === '/api/job' && req.method === 'POST') { const c = JSON.parse(raw.toString()); if (c.command === 'start' && sim.octo.selected) { sim.octo.started++; return send(204); } return send(409); }
    }
    send(404, {});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  Object.assign(process.env, { ANTHROPIC_API_URL: base + '/v1/messages', ANTHROPIC_API_KEY: 'sk-test-simulated', AI_DESIGNER_MODEL_DEFAULT: 'sim-model' });
  resetLedger(new UsageLedger());
});
let cad: ChildProcess | null = null;
after(() => { server.close(); if (cad) cad.kill(); for (const k of ['ANTHROPIC_API_URL', 'ANTHROPIC_API_KEY', 'AI_DESIGNER_MODEL_DEFAULT']) delete process.env[k]; });

const steps: { n: number; step: string; mode: string; evidence: string }[] = [];
const done = (n: number, step: string, mode: 'REAL' | 'SIMULATED' | 'REAL + SIMULATED' | 'NOT RUN', evidence: string) => steps.push({ n, step, mode, evidence });

describe('Customer-to-print workflow (19 steps)', () => {
  // state carried from step to step
  const S: any = { customer: { id: 'u-cust', role: 'END_USER', email: 'c@example.com' }, designer: { id: 'u-des', role: 'DESIGNER' }, operator: { id: 'u-op', role: 'FARM_MANAGER' }, admin: { id: 'u-adm', role: 'ADMIN' } };
  const SECRET = 'x'.repeat(40);

  test('1. sign-up: the customer verifies the e-mail address with a signed, address-bound token', () => {
    const tok = emailToken(S.customer.id, S.customer.email, SECRET);
    assert.equal(checkEmailToken(tok, { id: S.customer.id, email: S.customer.email }, SECRET).ok, true);
    assert.equal(checkEmailToken(tok, { id: S.customer.id, email: 'other@example.com' }, SECRET).ok, false);
    done(1, 'Sign-up + e-mail verification', 'REAL', 'token accepted for the address it was issued for, refused for another');
  });

  test('2. the idea in Arabic: Claude asks the questions that change the geometry', async () => {
    const r: any = await askJson(A.clarifyPrompt('أريد خطافًا أعلّق عليه سماعة الرأس تحت الرف', [], 0, 3), { label: 'clarify' });
    assert.equal(r.ready, false); assert.equal(r.questions[0].id, 'q1');
    S.brief = A.briefOf('أريد خطافًا أعلّق عليه سماعة الرأس تحت الرف', r.understanding_ar, [{ question: r.questions[0].question_ar, answer: '20' }]);
    assert.match(S.brief, /20/);
    done(2, 'Idea (Arabic) → clarifying questions', 'SIMULATED', 'Claude API test double; our prompt, client, JSON extraction and usage ledger are real');
  });

  test('3. an English request goes through the same path', async () => {
    const r: any = await askJson(A.clarifyPrompt('I need a hook to hang headphones under a shelf', [], 0, 3), { label: 'clarify' });
    assert.ok(sim.claude.at(-1)!.includes('I need a hook to hang headphones'));
    assert.ok(r.questions.length >= 1);
    done(3, 'Idea (English) → same pipeline', 'SIMULATED', 'English text reaches the prompt unchanged; reply parsed');
  });

  test('4. three concepts: designed, built by the real kernel, and checked to be genuinely different', async () => {
    const out = await A.conceptsLoop({ ask: (p: string, o: any) => askJson(p, o), build: async (d: any) => { const r = await CAD.generateDesign(d); return { ...r, signature: CON.signature(r.mesh) }; }, onStep: () => {}, distinctness: CON.distinctness }, S.brief);
    assert.equal(out.concepts.length, 3);
    assert.ok(out.concepts.every((c: any) => c.result && ['VALIDATED', 'VALID_WITH_WARNINGS'].includes(c.result.status)), JSON.stringify(out.concepts.map((c: any) => c.error && c.error.message)));
    assert.equal(out.distinctness.distinctCount, 3);
    S.concept = out.concepts.find((c: any) => c.concept.title_ar === 'خطاف بمسمار');
    done(4, '3 concepts → built + distinctness', 'REAL + SIMULATED', `replies simulated; 3 meshes built and validated; distinct=${out.distinctness.distinctCount}`);
  });

  test('5. AI usage is metered from the API usage fields', () => {
    const t = ledger().totals();
    assert.ok(t.requests >= 5 && t.output_tokens === t.requests * 400);
    done(5, 'AI usage / cost ledger', 'REAL', `${t.requests} calls, ${t.input_tokens} in / ${t.output_tokens} out tokens (cost needs AI_PRICING_JSON)`);
  });

  test('6. the customer picks a concept and changes a parameter: the kernel rebuilds it, no AI call', async () => {
    const calls = sim.claude.length;
    S.design = S.concept.design;
    S.result = await CAD.generateDesign(S.design, { w: 30 });
    assert.equal(S.result.size_mm.x, 30);
    assert.equal(sim.claude.length, calls);
    done(6, 'Pick concept + parametric edit', 'REAL', `w 20→30 mm: part is ${S.result.size_mm.x}×${S.result.size_mm.y}×${S.result.size_mm.z} mm`);
  });

  test('7. validation: watertight mesh, no manufacturing errors; the STL hash identifies this exact file', () => {
    const r = S.result;
    assert.ok(['VALIDATED', 'VALID_WITH_WARNINGS'].includes(r.status));
    assert.equal(r.analysis.dfm.issues.filter((i: any) => i.severity === 'error').length, 0);
    S.sha = sha(r.stl);
    done(7, 'Mesh validation + DFM + SHA-256', 'REAL', `status ${r.status}, sha ${S.sha.slice(0, 12)}`);
  });

  test('8. saving a revision is refused when someone else saved first (If-Match semantics)', () => {
    const base = { revision: 1, status: 'DRAFT', updatedAt: 100, approvedRevision: null };
    assert.equal(V.conflict(base, { ...base, updatedAt: 150 }, { design: true }), null);
    assert.equal(V.conflict(base, { ...base, revision: 2 }, { design: true }).code, 'NEW_REVISION');
    done(8, 'Save revision with conflict check', 'REAL', 'stale base revision → NEW_REVISION conflict');
  });

  test('9. submitted for review: only designers and admins may review; contact details stay private', () => {
    assert.equal(canReviewDesign(S.customer), false); assert.equal(canReviewDesign(S.designer), true);
    assert.equal(canSeeContact(S.operator, { id: S.customer.id }), false); assert.equal(canSeeContact(S.customer, { id: S.customer.id }), true);
    done(9, 'Submit for review + access rules', 'REAL', 'customer cannot approve; operator cannot read customer contact');
  });

  test('10. engineering drawing: section, GD&T, hole callouts, vector PDF', async () => {
    const L = D.layout(S.result.mesh, { title: 'HOOK', checks: S.result.analysis.checks }, { sheet: 'A3' });
    assert.ok(L.report.ok, JSON.stringify(L.report.validation));
    assert.ok(L.report.holes.length >= 1, 'the screw hole is found');
    const pdf = await D.toPDF(L, PDFLib, { title: 'HOOK' });
    assert.equal((await PDFLib.PDFDocument.load(pdf)).getPageCount(), 1);
    done(10, 'Drawing (section, GD&T, holes, PDF)', 'REAL', `${L.report.holes.length} hole(s) [${L.report.holes.map((h: any) => h.view + ' Ø' + h.d).join(', ')}], section ${L.report.section ? 'yes' : 'no'}, datums ${L.report.gdt.datums.join('')}, PDF ${pdf.length} B`);
  });

  test('11. the designer approves: the approval is bound to the exact STL hash', async () => {
    S.approved = { revision: 1, sha: S.sha, by: S.designer.id };
    const again = await CAD.generateDesign(S.design, { w: 30 });
    assert.equal(sha(again.stl), S.approved.sha, 'rebuilding the approved source reproduces the approved file');
    done(11, 'Approval bound to SHA-256', 'REAL', 'deterministic rebuild reproduces the approved hash');
  });

  test('12. STEP from OpenCascade through the CAD service (exact B-Rep, re-read check)', { skip: !OCC && 'forma_occ not built' }, async () => {
    const port = 18900 + Math.floor(Math.random() * 90);
    cad = spawn('python3', ['-m', 'cad_engine', 'serve-stdlib', '--port', String(port)], { cwd: join(ROOT, 'services/cad_engine'), env: { ...process.env, CAD_SERVICE_TOKEN: 'wf-token', FORMA_OCC_BIN: OCC_BIN }, stdio: 'ignore' });
    const client = new CadClient(`http://127.0.0.1:${port}`, 'wf-token');
    for (let i = 0; i < 50; i++) { try { await client.health(); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
    const h = await client.health();
    const out = await client.build(S.design, { w: 30 }, ['step']);
    const st = out.exports.step!;
    assert.ok(st.bytes.subarray(0, 13).toString() === 'ISO-10303-21;' && st.check.ok, JSON.stringify(st.check));
    const vol = (out.report as any).volume_mm3;
    // the B-Rep volume and the mesh volume agree (the mesh has a 48-gon hole, the B-Rep a true circle)
    assert.ok(Math.abs(vol - S.result.mesh.signedVolume()) / vol < 2e-3, `${vol} vs ${S.result.mesh.signedVolume()}`);
    // and back in: the exported STEP imports to the same exact solid, with a printable STL
    const back = await client.importStep(st.bytes, ['stl']);
    assert.ok(Math.abs((back.report as any).volume_mm3 - vol) / vol < 1e-9 && (back.report as any).faces === (st.check as any).faces[0]);
    assert.ok(back.exports.stl!.bytes.length > 84);
    await assert.rejects(client.importStep(Buffer.from('solid x\nendsolid x\n')), /not a STEP file/);
    done(12, 'STEP export + import (OpenCascade)', 'REAL', `${h.kernel}; ${(st.check as any).faces[0]} faces; re-read ok; re-imported to the same volume ${vol.toFixed(1)} mm³`);
  });

  test('13. downloads use signed, expiring links bound to one file and one user', () => {
    const t = signDownload({ kind: 'model', key: S.sha + '.stl', sub: S.customer.id, ttlMs: 60_000 }, SECRET, 1000);
    assert.equal(verifyDownload(t, { kind: 'model', key: S.sha + '.stl' }, SECRET, 2000).ok, true);
    const other = verifyDownload(t, { kind: 'model', key: 'other.stl' }, SECRET, 2000), late = verifyDownload(t, { kind: 'model', key: S.sha + '.stl' }, SECRET, 70_000);
    assert.deepEqual([other.ok, !other.ok && other.reason, late.ok, !late.ok && late.reason], [false, 'wrong_file', false, 'expired']);
    done(13, 'Signed download link', 'REAL', 'valid → ok; other file → wrong_file; after expiry → expired');
  });

  test('14. print request → quote → invoice (operator issues, customer cannot)', async () => {
    assert.equal(canIssueInvoice(S.customer), false); assert.equal(canIssueInvoice(S.operator), true);
    const lines = COM.quote(S.result.analysis.estimate, 2, 25000, { hourly: 1000, setup: 2000, title: 'خطاف', material: 'PLA' });
    S.pay = new MemoryPaymentStore(); S.paidHooks = 0;
    S.payments = new PaymentService(S.pay, { zaincash: new ZainCashClient({ baseUrl: base + '/zc', clientId: 'ci', clientSecret: 'cs', apiKey: ZC_KEY, serviceType: 'JAWS' }) }, { onPaid: async () => { S.paidHooks++; } }, () => Date.UTC(2026, 9, 30));
    S.invoice = await S.payments.issueInvoice('order-1', S.customer.id, lines, S.operator.id);
    assert.ok(S.invoice.totalIqd > 0 && Number.isInteger(S.invoice.totalIqd));
    done(14, 'Quote + invoice', 'REAL', `${S.invoice.number}: ${S.invoice.totalIqd.toLocaleString('en')} IQD (${lines.length} lines)`);
  });

  test('15. ZainCash payment: PAID only after the server asks the gateway; a replayed callback changes nothing', async () => {
    const p = await S.payments.startPayment(S.invoice.id, 'zaincash', { successUrl: 'https://forma.example/ok', failureUrl: 'https://forma.example/no' });
    const claim = signHS256({ eventId: 'e1', data: { transactionId: p.providerRef, status: 'SUCCESS' } }, ZC_KEY);
    assert.equal((await S.payments.zaincashToken(claim, 'webhook')).status, 'PENDING', 'a SUCCESS claim alone is not enough');
    sim.zain.get(p.providerRef)!.status = 'SUCCESS'; // the customer pays on the gateway
    const claim2 = signHS256({ eventId: 'e2', data: { transactionId: p.providerRef, status: 'SUCCESS' } }, ZC_KEY);
    assert.equal((await S.payments.zaincashToken(claim2, 'webhook')).status, 'PAID');
    await S.payments.zaincashToken(claim2, 'webhook');
    assert.equal(S.paidHooks, 1); assert.equal((await S.pay.getInvoice(S.invoice.id)).status, 'PAID');
    assert.equal(canRecordPayment(S.customer), false);
    done(15, 'ZainCash payment + idempotent callback', 'SIMULATED', 'gateway double; our signature check, inquiry, state machine and idempotency are real');
  });

  test('16. manufacturing variant for the printer: compensated once, never twice; the approved file is untouched', async () => {
    const PR = { sx: 0.996, sy: 1.004, sz: 1.002, b: 0.15, bz: -0.08, c: -0.25 };
    const printed = (m: any) => { const s = m.axis === 'z' ? PR.sz : m.axis === 'x' ? PR.sx : m.axis === 'y' ? PR.sy : (PR.sx + PR.sy) / 2; return +(s * m.nominal + (m.kind === 'hole' ? PR.c : m.axis === 'z' ? PR.bz : PR.b)).toFixed(3); };
    const session = (key: string, at: number) => { const t = C.testByKey(key); const e = C.checkEntry(key, Object.fromEntries(t.measure.map((m: any) => [m.id, String(printed(m))]))); return { test: key, at, points: e.points }; };
    const fit = C.fitProfile([session('xyz_cube', 1), session('steps', 2), session('holes', 3)]);
    const v = C.compensate(S.design, fit);
    S.variant = await CAD.generateDesign(v.design, { w: 30 });
    assert.notEqual(sha(S.variant.stl), S.sha);
    assert.equal(sha((await CAD.generateDesign(S.design, { w: 30 })).stl), S.sha, 'approved file unchanged');
    assert.throws(() => C.compensate(v.design, fit), /ALREADY_COMPENSATED|already/i);
    done(16, 'Calibration-compensated variant', 'REAL', `scale ${v.compensation.scale.join('/')}, holes +${v.compensation.hole_delta_mm} mm; second compensation refused`);
  });

  test('17. slicing the variant with OrcaSlicer', { skip: !ORCA && 'ORCASLICER_BIN not set' }, async () => {
    const p = join(work, 'variant.stl'); writeFileSync(p, Buffer.from(S.variant.stl));
    const r = await runOrcaSlicer({ modelPath: p, profileConfigJson: JSON.stringify({ machine: 'machine.json', process: 'process.json', filament: 'filament-creality-generic-pla.json' }) });
    assert.deepEqual(checkGcode(r.gcode), []);
    S.gcode = r.gcode;
    done(17, 'Slicing (OrcaSlicer CLI)', 'REAL', `${r.layerCount} layers, ${Math.round((r.printTimeSec || 0) / 60)} min, ${Math.round(r.filamentLengthMm || 0)} mm filament`);
  });

  test('18. G-code to OctoPrint, verified on the printer, started only by an explicit command', async () => {
    const g = S.gcode ?? Buffer.from(';FLAVOR:Marlin\nG28\nG1 Z0.2 F3000\nM104 S0\n');
    const o = new OctoPrintClient(base + '/octo', OCTO_KEY);
    const up = await o.upload(g, 'forma-job1.gcode');
    assert.equal(sim.octo.started, 0, 'uploading never starts a print');
    await o.select(up.path); await o.start();
    assert.equal(sim.octo.started, 1);
    assert.equal(sim.octo.files.get('forma-job1.gcode')!.length, g.length);
    done(18, 'Upload to OctoPrint + start', 'SIMULATED', `OctoPrint double; ${S.gcode ? 'real sliced' : 'placeholder'} G-code (${g.length} B) uploaded, size verified, started by command`);
  });

  test('19. print finished: WhatsApp template sent, delivery receipt recorded', async () => {
    const store = new MemoryNotifyStore();
    store.users.set(S.customer.id, { id: S.customer.id, locale: 'ar', email: S.customer.email, emailVerified: true, phone: '07822678298', phoneVerified: true });
    store.prefs.set(S.customer.id, { channels: { inapp: true, email: false, whatsapp: true } });
    const svc = new NotificationService(store, { whatsapp: new WhatsAppClient({ token: 'wa-tok', phoneNumberId: '1234', baseUrl: base, version: 'v21.0' }) });
    await svc.enqueue({ id: 'job1:print_done', type: 'print_done', userIds: [S.customer.id], vars: { project: 'خطاف' }, at: Date.now() });
    assert.deepEqual(await svc.dispatch(), { sent: 2, retried: 0, failed: 0 });
    const wa = [...store.deliveries.values()].find((d) => d.channel === 'whatsapp')!;
    assert.equal(sim.wa.at(-1).template.name, 'forma_print_done');
    assert.equal(await svc.applyReceipt({ messageId: wa.providerId!, status: 'delivered', recipient: '9647822678298', timestamp: 1 }), true);
    done(19, 'Notification (in-app + WhatsApp) + receipt', 'SIMULATED', 'Cloud API double; template, retry policy and receipt handling are real');
  });

  test('summary', () => {
    for (const [n, name, reason] of [[12, 'STEP export + import (OpenCascade)', 'forma_occ not built here'], [17, 'Slicing (OrcaSlicer CLI)', 'ORCASLICER_BIN not set']] as const)
      if (!steps.some((s) => s.n === n)) done(n, name, 'NOT RUN', reason);
    steps.sort((a, b) => a.n - b.n);
    console.log('\nWORKFLOW ' + JSON.stringify(steps));
    for (const s of steps) console.log(`${String(s.n).padStart(2)}  ${s.mode.padEnd(17)} ${s.step} — ${s.evidence}`);
    assert.equal(steps.length, 19);
  });
});
