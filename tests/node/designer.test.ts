// FormaCAD language + AI designer loop. The language model is scripted here
// (its replies are fixed JSON), so these tests check OUR side: the CAD language,
// the build/validate step, automatic repair, inspection and the prompts we send.

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { describe, test } from 'node:test';

const ROOT = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const CAD = require(join(ROOT, 'services/ai_3d_engine/browser/cad.js'));
const Agents = require(join(ROOT, 'services/ai_3d_engine/browser/agents.js'));
const DESIGNS = require('./fixtures/designs.json');

describe('FormaCAD expressions', () => {
  test('arithmetic, functions in degrees, parameters, precedence', () => {
    const v = { w: 90, t: 5 };
    assert.equal(CAD.evalExpr('w/2 - t', v, 'x'), 40);
    assert.equal(CAD.evalExpr('2+3*4^2', v, 'x'), 50);
    assert.ok(Math.abs(CAD.evalExpr('sin(30)*2', v, 'x') - 1) < 1e-12);
    assert.equal(CAD.evalExpr('max(2, t*1.5)', v, 'x'), 7.5);
    assert.equal(CAD.evalExpr('-(w)', v, 'x'), -90);
  });
  test('rejects code, unknown names and broken syntax instead of evaluating them', () => {
    for (const bad of ['alert(1)', 'w;t', 'constructor', 'w*', '(w', '1/0', 'this.x']) {
      assert.throws(() => CAD.evalExpr(bad, { w: 1, t: 1 }, 'p'), CAD.CadError, bad);
    }
  });
});

describe('FormaCAD geometry', () => {
  for (const [name, design] of Object.entries(DESIGNS)) {
    test(`designs outside any template build and validate: ${name}`, async () => {
      const r = await CAD.generateDesign(design);
      assert.equal(r.status, 'VALIDATED', JSON.stringify(r.post_export_validation.issues));
      assert.equal(r.post_export_validation.stats.bodies, 1);
    });
  }

  test('parameters resize the part without the language model', async () => {
    const d = DESIGNS.hex_wrench_m8;
    const a = await CAD.generateDesign(d);
    const b = await CAD.generateDesign(d, { handle_l: 150 });
    assert.equal(+(b.size_mm.x - a.size_mm.x).toFixed(3), 40);
  });

  test('exact primitive dimensions and volumes', async () => {
    const cube = await CAD.generateDesign({ model: { box: { size: [20, 30, 40] } } });
    assert.deepEqual(cube.size_mm, { x: 20, y: 30, z: 40 });
    const lshape = await CAD.generateDesign({ model: { extrude: { points: [[0, 0], [40, 0], [40, 10], [10, 10], [10, 30], [0, 30]], h: 8 } } });
    assert.ok(Math.abs(lshape.mesh.signedVolume() - (40 * 10 + 10 * 20) * 8) < 1e-3);
  });

  test('errors name the exact place in the model', async () => {
    await assert.rejects(CAD.generateDesign({ model: { union: [{ box: { size: [1, 2] } }] } }), /model\.union\[0\]\.box\.size/);
    await assert.rejects(CAD.generateDesign({ model: { sphere: {} } }), /needs "r" or "d"/);
    await assert.rejects(CAD.generateDesign({ model: { blob: {} } }), /unknown shape/);
  });

  test('limits stop runaway models', async () => {
    await assert.rejects(CAD.generateDesign({ model: { linear_array: { count: 5000, step: [1, 0, 0], child: { box: { size: [1, 1, 1] } } } } }), /count/);
  });
});

describe('Measured verification, manufacturability and print estimate', () => {
  const AN = require(join(ROOT, 'services/ai_3d_engine/browser/analysis.js'));
  const plate = {
    parameters: [{ name: 'hole_d', value: 8.4 }],
    print: { material: 'PETG', infill_percent: 20, layer_height_mm: 0.2 },
    model: { difference: [{ union: [{ box: { size: [40, 30, 6] } }, { box: { size: [0.6, 30, 10] }, translate: [5, 0, 5.5] }] },
      { cylinder: { d: 'hole_d', h: 8, segments: 64 }, translate: [20, 15, -1] }] },
    checks: [
      { label: 'hole', type: 'gap', at: [20, 15, 3], axis: 'x', expect: 'hole_d', tol: 0.1 },
      { label: 'plate', type: 'wall', at: [10, 10, 3], axis: 'z', expect: 6 },
      { label: 'length', type: 'size', axis: 'x', expect: 40 },
      { label: 'through', type: 'empty', at: [20, 15, 3] },
      { label: 'wrong', type: 'gap', at: [20, 15, 3], axis: 'y', expect: 10 },
    ],
  };

  test('requirements are measured on the exported STL, following parameter changes', async () => {
    const r = await CAD.generateDesign(plate);
    const c = Object.fromEntries(r.analysis.checks.map((x: { label: string }) => [x.label, x]));
    assert.equal(c.hole.measured, 8.4); assert.ok(c.hole.pass);
    assert.equal(c.plate.measured, 6); assert.ok(c.plate.pass);
    assert.ok(c.length.pass && c.through.pass);
    assert.equal(c.wrong.pass, false); assert.equal(c.wrong.measured, 8.4);
    const r2 = await CAD.generateDesign(plate, { hole_d: 10 });
    assert.equal(r2.analysis.checks[0].measured, 10); assert.ok(r2.analysis.checks[0].pass);
  });

  test('a 0.6 mm fin is reported as too thin; a solid block is not', async () => {
    const r = await CAD.generateDesign(plate);
    assert.equal(r.analysis.dfm.stats.min_wall_mm, 0.6);
    assert.ok(r.analysis.dfm.issues.some((i: { code: string }) => i.code === 'WALL_TOO_THIN'));
    const block = await CAD.generateDesign({ model: { box: { size: [20, 20, 10] } } });
    assert.deepEqual(block.analysis.dfm.issues, []);
    assert.equal(block.analysis.dfm.stats.min_wall_mm, 10);
  });

  test('overhangs are found away from the bed; the estimate scales with volume and material', async () => {
    const t = await CAD.generateDesign({ model: { union: [{ box: { size: [10, 10, 20] } }, { box: { size: [30, 10, 4] }, translate: [0, 0, 16] }] } });
    assert.ok(Math.abs(t.analysis.dfm.stats.overhang_area_mm2 - 200) < 1, String(t.analysis.dfm.stats.overhang_area_mm2));
    const e1 = AN.estimate(t.mesh, { material: 'PLA', infill_percent: 100 });
    assert.ok(Math.abs(e1.mass_g - (Math.abs(t.mesh.signedVolume()) / 1000) * 1.24) < 0.01);
    const e2 = AN.estimate(t.mesh, { material: 'PLA', infill_percent: 0 });
    assert.ok(e2.mass_g < e1.mass_g && e2.time_min <= e1.time_min);
  });
});

describe('Offline starter designs', () => {
  const { STARTERS } = require(join(ROOT, 'services/ai_3d_engine/browser/starters.js'));
  for (const st of STARTERS) {
    test(`starter "${st.key}" builds, validates and passes every measured check`, async () => {
      const r = await CAD.generateDesign(st.design);
      assert.equal(r.status, 'VALIDATED');
      assert.ok(r.analysis.checks.length >= 2);
      for (const c of r.analysis.checks) assert.ok(c.pass, `${c.label}: expected ${c.expect}, measured ${c.measured}`);
      assert.deepEqual(r.analysis.dfm.issues.filter((i: { severity: string }) => i.severity === 'error'), []);
    });
  }
  test('a 6-segment cylinder is an exact hexagon (13.2 mm across flats for M8)', async () => {
    const r = await CAD.generateDesign(STARTERS.find((s: { key: string }) => s.key === 'hex_wrench').design);
    assert.equal(r.analysis.checks[0].measured, 13.2);
  });
});

describe('AI designer loop (scripted model replies)', () => {
  const brief = 'Customer idea: headphone hook for a 25 mm desk';
  const good = { name_ar: 'علاقة سماعات', requirements: ['The hook shall clamp a 25 mm desk.'], parameters: DESIGNS.headphone_desk_hook.parameters, model: DESIGNS.headphone_desk_hook.model, print: {} };
  const broken = { ...good, model: { union: [{ box: { size: ['desk_t', 'oops', 3] } }] } };

  test('a build error is sent back to the designer with the engine message, then the fixed model is used', async () => {
    const prompts: string[] = [];
    const replies = [broken, good];
    const steps: string[] = [];
    const out = await Agents.designLoop({
      ask: async (p: string) => { prompts.push(p); return structuredClone(replies.shift()); },
      build: (d: unknown) => CAD.generateDesign(d),
      render: null,
      onStep: (id: string, state: string) => steps.push(`${id}:${state}`),
    }, brief);
    assert.equal(out.result.status, 'VALIDATED');
    assert.equal(prompts.length, 2);
    assert.match(prompts[1], /unknown parameter "oops"/);
    assert.ok(steps.includes('repair:running') && steps.includes('build:done'));
  });

  test('inspection can ask for a fix; the fix is kept only if it still validates', async () => {
    const replies: unknown[] = [good, { verdict: 'revise', score: 5, findings_ar: ['الحافة قصيرة'], fix_instructions: 'make lip taller' },
      { ...good, parameters: good.parameters.map((p: { name: string; value: number }) => (p.name === 'lip_h' ? { ...p, value: 25 } : p)) }];
    const out = await Agents.designLoop({
      ask: async () => structuredClone(replies.shift()),
      build: (d: unknown) => CAD.generateDesign(d),
      render: async () => new Blob(['png']),
      onStep: () => undefined,
    }, brief);
    assert.equal(out.inspection.applied, true);
    assert.equal(out.result.params.lip_h, 25);
  });

  test('a measured requirement that fails is sent back for repair with the numbers', async () => {
    const withCheck = (expect: string) => ({ ...good, checks: [{ label: 'clamp opening', type: 'gap', at: [15, 'clamp_depth*0.3', 'wall+desk_t/2'], axis: 'z', expect, tol: 0.1 }] });
    const prompts: string[] = [];
    const replies = [withCheck('desk_t+3'), withCheck('desk_t')];
    const out = await Agents.designLoop({
      ask: async (p: string) => { prompts.push(p); return structuredClone(replies.shift()); },
      build: (d: unknown) => CAD.generateDesign(d), render: null, onStep: () => undefined,
    }, brief);
    assert.equal(prompts.length, 2);
    assert.match(prompts[1], /CHECK FAILED "clamp opening" \(gap\): expected 28, measured 25/);
    assert.equal(out.result.analysis.checks[0].pass, true);
  });

  test('gives up after the repair budget and reports the failure honestly', async () => {
    const out = await Agents.designLoop({
      ask: async () => structuredClone(broken),
      build: (d: unknown) => CAD.generateDesign(d),
      render: null,
      onStep: () => undefined,
    }, brief, { maxRepairs: 1 });
    assert.equal(out.result, null);
    assert.match(out.error.message, /oops/);
  });

  test('prompts carry the CAD language, the printer and the customer answers', () => {
    const p = Agents.designPrompt(Agents.briefOf('حامل', 'stand', [{ question: 'العرض؟', answer: '90 مم' }]));
    assert.match(p, /FormaCAD/);
    assert.match(p, /220 x 220 x 250/);
    assert.match(p, /90 مم/);
    const c = Agents.clarifyPrompt('حامل', [], 2, 2);
    assert.match(c, /last round/);
  });
});

describe('AI designer inside the server job pipeline', () => {
  test('worker stores the STL the AI designer built and sends it to review', async () => {
    const { AiDesignerProvider } = await import('../../src/lib/generation/providers/ai-designer.ts');
    const { runOnce } = await import('../../src/lib/generation/worker.ts');
    const { MemoryRepo, MemoryStorage } = await import('./helpers/memory-repo.ts');
    const good = { name_ar: 'مفتاح M8', requirements: ['13 mm AF'], parameters: DESIGNS.hex_wrench_m8.parameters, model: DESIGNS.hex_wrench_m8.model, print: {} };
    const asked: string[] = [];
    const provider = new AiDesignerProvider(async (p: string) => { asked.push(p); return structuredClone(good); });
    const repo = new MemoryRepo();
    const storage = new MemoryStorage();
    const job = repo.add({ provider: 'AI_DESIGNER', input: { prompt: 'مفتاح لصامولة M8', userFields: {}, designQa: [{ question: 'الطول؟', answer: '130 مم' }] } });
    await runOnce({ repo, providers: { AI_DESIGNER: provider }, engine: null, storage, sleep: async () => undefined }, 'w1');
    const j = repo.jobs.get(job.id)!;
    assert.equal(j.status, 'REVIEW_REQUIRED', j.errorMessage ?? '');
    assert.deepEqual(j.history, ['QUEUED', 'GENERATING', 'CONVERTING', 'VALIDATING', 'REVIEW_REQUIRED']);
    const model = repo.revisions.get(job.revisionId)!.model!;
    assert.equal(model.metadata.status, 'VALIDATED');
    assert.equal(model.stlSha256, model.metadata.stl_sha256);
    assert.match(asked[0], /130 مم/);
  });

  test('askJson talks to the Messages API format and extracts JSON from the reply', async () => {
    const { createServer } = await import('node:http');
    let seen: any = null;
    const srv = createServer(async (req, res) => {
      let body = ''; for await (const c of req) body += c;
      seen = { headers: req.headers, body: JSON.parse(body) };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ content: [{ type: 'text', text: 'Here it is:\n```json\n{"ready": true, "questions": []}\n```' }], stop_reason: 'end_turn' }));
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.ANTHROPIC_API_URL = `http://127.0.0.1:${(srv.address() as { port: number }).port}/v1/messages`;
    const { askJson } = await import('../../src/lib/generation/anthropic.ts');
    const out = await askJson('hello', { modelTier: 'complex' });
    srv.close();
    assert.deepEqual(out, { ready: true, questions: [] });
    assert.equal(seen.headers['x-api-key'], 'test-key');
    assert.equal(seen.headers['anthropic-version'], '2023-06-01');
    assert.equal(seen.body.messages[0].role, 'user');
  });
});
