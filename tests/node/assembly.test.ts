// Phase 8.4 — multi-concept distinctness and assemblies (constraints, interference, clearance, BOM, exports).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { describe, test } from 'node:test';

const ROOT = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const B = join(ROOT, 'services/ai_3d_engine/browser/');
const CAD = require(B + 'cad.js');
const ASM = require(B + 'assembly.js');
const CON = require(B + 'concepts.js');
const A = require(B + 'agents.js');
const EX = require(B + 'exporters.js');
const build = (d: any, v: any) => CAD.generateDesign(d, v);
const ngon = (r: number, n: number) => (n / 2) * r * r * Math.sin((2 * Math.PI) / n);

const base = { name_ar: 'قاعدة', model: { union: [{ box: { size: [40, 40, 10] } }, { cylinder: { d: 6, h: 8.5, segments: 60 }, translate: [20, 20, 9.5] }] }, print: { material: 'PLA' } };
const lid = (hole: number) => ({ name_ar: 'غطاء', model: { difference: [{ box: { size: [40, 40, 5] } }, { cylinder: { d: hole, h: 7, segments: 60 }, translate: [20, 20, -1] }] }, print: { material: 'PETG' } });
const spec = (hole: number, gap = 0.5) => ({
  name_ar: 'قاعدة وغطاء',
  parts: [{ id: 'base', design: base, datums: { top: { axis: 'z', at: 10, dir: 1 } } }, { id: 'lid', design: lid(hole), translate: [100, 70, 0] }],
  constraints: [{ type: 'mate', a: 'base', a_face: 'top', b: 'lid', b_face: '-z', offset: gap }, { type: 'align', a: 'base', b: 'lid', axis: 'x' }, { type: 'align', a: 'base', b: 'lid', axis: 'y' }, { type: 'clearance', a: 'base', b: 'lid', min: 0.15 }],
});

describe('Assemblies', () => {
  test('constraints place the lid on the base datum, centred; the pin clears the hole by the designed 0.2 mm', async () => {
    const asm = await ASM.assemble(spec(6.4), build);
    assert.deepEqual(asm.parts.lid.box.lo.map((v: number) => +v.toFixed(6)), [0, 0, 10.5]);
    for (const c of asm.constraints.filter((c: any) => c.type !== 'clearance')) assert.ok(c.ok && Math.abs(c.residual_mm) < 1e-6, JSON.stringify(c));
    const cl = asm.constraints.find((c: any) => c.type === 'clearance');
    // 60-gon pin (r 3) inside a 60-gon hole (r 3.2), vertices aligned: the gap at a flat is 0.2*cos(pi/60)
    assert.ok(Math.abs(cl.measured_mm - 0.2 * Math.cos(Math.PI / 60)) < 1e-4, String(cl.measured_mm));
    assert.deepEqual(asm.interference, []);
    assert.ok(asm.ok);
    assert.deepEqual(asm.size_mm, [40, 40, 18]);
  });

  test('a hole smaller than the pin is reported as interference with the exact overlap volume', async () => {
    const asm = await ASM.assemble(spec(5.8), build);
    assert.equal(asm.ok, false);
    const expect = (ngon(3, 60) - ngon(2.9, 60)) * 5; // pin passes through the full 5 mm lid
    assert.equal(asm.interference.length, 1);
    assert.ok(Math.abs(asm.interference[0].volume_mm3 - expect) < 1e-3 * expect, `${asm.interference[0].volume_mm3} vs ${expect}`);
    assert.equal(asm.constraints.find((c: any) => c.type === 'clearance').ok, false);
  });

  test('BOM groups identical parts, uses each part material, and totals the measured estimates', async () => {
    const s: any = spec(6.4);
    s.parts.push({ id: 'lid2', design: lid(6.4), translate: [0, 0, 30] });
    const asm = await ASM.assemble(s, build);
    assert.equal(asm.bom.length, 2);
    const lids = asm.bom.find((r: any) => r.name_ar === 'غطاء');
    assert.deepEqual([lids.qty, lids.material, lids.parts], [2, 'PETG', ['lid', 'lid2']]);
    assert.equal(asm.totals.parts, 3);
    assert.ok(Math.abs(asm.totals.mass_g - asm.bom.reduce((a: number, r: any) => a + r.qty * r.mass_g_each, 0)) < 0.05);
  });

  test('a part rotated in the assembly matches the same rotation done by the CAD kernel', async () => {
    const d = { model: { box: { size: [30, 10, 4] } } };
    const asm = await ASM.assemble({ parts: [{ id: 'p', design: d, rotate: [90, 0, 30] }] }, build);
    const k = await CAD.generateDesign({ model: { box: { size: [30, 10, 4] }, rotate: [90, 0, 30] } });
    const s = asm.parts.p.box; const size = [0, 1, 2].map((a) => +(s.hi[a] - s.lo[a]).toFixed(3));
    assert.deepEqual(size, [k.size_mm.x, k.size_mm.y, k.size_mm.z]);
  });

  test('invalid constraints are refused with a clear message', async () => {
    const s: any = spec(6.4);
    s.constraints = [{ type: 'mate', a: 'lid', a_face: '+z', b: 'base', b_face: '-z' }];
    await assert.rejects(ASM.assemble(s, build), /first part "base" is fixed/);
    s.constraints = [{ type: 'mate', a: 'base', a_face: '+z', b: 'lid', b_face: '+z' }];
    await assert.rejects(ASM.assemble(s, build), /pointing at each other/);
    s.constraints = [{ type: 'mate', a: 'base', a_face: '+z', b: 'lid', b_face: '-x' }];
    await assert.rejects(ASM.assemble(s, build), /different axes/);
  });

  test('minDistance is exact for crossing edges (where vertex-to-face checks alone would miss)', () => {
    const E = require(B + 'engine.js');
    const bar = (rot: boolean, z0: number) => { const V: number[][] = []; for (const x of [-10, 10]) for (const y of [-1, 1]) for (const z of [z0, z0 + 2]) V.push(rot ? [y, x, z] : [x, y, z]); return V; };
    // two 20x2x2 bars crossed at 90 degrees, 0.7 mm apart in z; the closest features are two crossing edges
    const toMesh = (V: number[][]) => new E.Mesh(V, [[0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5], [0, 4, 5], [0, 5, 1], [2, 3, 7], [2, 7, 6], [0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3]]);
    const lower = toMesh(bar(false, 0)), upper = toMesh(bar(true, 2.7));
    const d = ASM.minDistance(lower, upper, 2);
    assert.ok(d.below && Math.abs(d.distance - 0.7) < 1e-9, String(d.distance));
    assert.equal(ASM.minDistance(lower, upper, 0.5).below, false);
  });

  test('exploded view moves parts apart along their offsets; the assembly 3MF holds every part in place', async () => {
    const asm = await ASM.assemble(spec(6.4), build);
    const off = ASM.exploded(asm, 1);
    assert.ok(off.lid[2] > 0 && off.lid[2] > off.base[2]);
    const parsed = EX.parse3MF(EX.to3MF(ASM.placedParts(asm), { title: asm.name_ar }));
    assert.equal(parsed.objects.length, 2);
    const zmax = Math.max(...parsed.objects[1].vertices.map((v: number[]) => v[2]));
    assert.ok(Math.abs(zmax - 15.5) < 1e-5);
  });
});

describe('Rotational constraints (hinges and pivots)', () => {
  // a 40x40x5 plate with a Ø6 pin on z through (20,20) and a stop block that an arm swung past ~70° runs into
  const plate = { name_ar: 'قاعدة', model: { union: [{ box: { size: [40, 40, 5] } }, { cylinder: { d: 6, h: 10, segments: 60 }, translate: [20, 20, 10] }, { box: { size: [6, 6, 10] }, translate: [17, 45, 5] }] } };
  // a 50x10x4 arm with a Ø6.4 hole 5 mm from its end
  const arm = { name_ar: 'ذراع', model: { difference: [{ box: { size: [50, 10, 4] } }, { cylinder: { d: 6.4, h: 6, segments: 60 }, translate: [5, 5, -1] }] } };
  const hinge = (extra: any) => ({
    parts: [
      { id: 'base', design: plate, datums: { top: { axis: 'z', at: 5, dir: 1 } }, axes: { pin: { point: [20, 20, 0], dir: [0, 0, 1] } } },
      { id: 'arm', design: arm, translate: [120, -40, 30], axes: { hole: { point: [5, 5, 0], dir: [0, 0, 1] } } },
    ],
    constraints: [{ type: 'mate', a: 'base', a_face: 'top', b: 'arm', b_face: '-z', offset: 0.5 }, { type: 'revolute', a: 'base', a_axis: 'pin', b: 'arm', b_axis: 'hole', ...extra }],
  });
  const tipX = (deg: number) => { const t = deg * Math.PI / 180; return 20 + Math.max(...[[-5, -5], [45, -5], [45, 5], [-5, 5]].map(([x, y]) => x * Math.cos(t) - y * Math.sin(t))); };

  test('revolute: the hole lands on the pin and the arm turns to the requested angle about it', async () => {
    const asm = await ASM.assemble(hinge({ angle: 30 }), build);
    const c = asm.constraints[1];
    assert.ok(c.ok && c.residual < 1e-6, JSON.stringify(c));
    const box = asm.parts.arm.box;
    assert.ok(Math.abs(box.hi[0] - tipX(30)) < 1e-6, `${box.hi[0]} vs ${tipX(30)}`);
    assert.ok(Math.abs(box.lo[2] - 5.5) < 1e-9 && Math.abs(box.hi[2] - 9.5) < 1e-9);
    assert.deepEqual(asm.interference, [], 'the pin clears the hole by 0.2 mm');
    assert.ok(asm.ok);
  });

  test('the range of motion is swept; the stop block is hit at 75° and 90° with measured volumes, and the report says so', async () => {
    const asm = await ASM.assemble(hinge({ angle: 0, range: [0, 90], step: 15 }), build);
    const c = asm.constraints[1];
    assert.deepEqual(c.sweep.map((s: any) => s.angle), [0, 15, 30, 45, 60, 75, 90]);
    assert.deepEqual(c.sweep.filter((s: any) => s.hits.length).map((s: any) => s.angle), [75, 90]);
    // at 90° the arm (x 15..25, z 5.5..9.5) passes straight through the 6 x 6 block: 6 x 6 x 4
    assert.ok(Math.abs(c.sweep[6].hits[0].volume_mm3 - 144) < 1e-3, JSON.stringify(c.sweep[6]));
    assert.equal(c.sweep[6].hits[0].with, 'base');
    assert.equal(c.ok, false); assert.equal(asm.ok, false);
    const free = await ASM.assemble(hinge({ angle: 0, range: [0, 60], step: 15 }), build);
    assert.ok(free.ok, JSON.stringify(free.constraints[1].sweep));
  });

  test('concentric + angle gives the same pose as revolute; the spec rotation is the 0° pose', async () => {
    const s: any = hinge({ angle: 30 });
    s.constraints[1] = { type: 'concentric', a: 'base', a_axis: 'pin', b: 'arm', b_axis: 'hole' };
    s.constraints.push({ type: 'angle', a: 'base', b: 'arm', axis: 'pin', angle: 30 });
    const asm = await ASM.assemble(s, build), rev = await ASM.assemble(hinge({ angle: 30 }), build);
    assert.ok(asm.ok, JSON.stringify(asm.constraints));
    for (let a = 0; a < 3; a++) assert.ok(Math.abs(asm.parts.arm.box.lo[a] - rev.parts.arm.box.lo[a]) < 1e-9 && Math.abs(asm.parts.arm.box.hi[a] - rev.parts.arm.box.hi[a]) < 1e-9);
    // an arm already turned 30° in the spec, held at angle 0, stays at 30° in the world
    const pre: any = hinge({ angle: 0 }); pre.parts[1].rotate = [0, 0, 30];
    const p = await ASM.assemble(pre, build);
    assert.ok(Math.abs(p.parts.arm.box.hi[0] - tipX(30)) < 1e-6);
  });

  test('bad rotational constraints are refused: crossed axes, angle outside the range, a plane datum after a turn', async () => {
    const crossed: any = hinge({ angle: 0 }); crossed.parts[1].axes.hole.dir = [1, 0, 0];
    await assert.rejects(ASM.assemble(crossed, build), /not parallel/);
    await assert.rejects(ASM.assemble(hinge({ angle: 120, range: [0, 90] }), build), /outside the range/);
    const d: any = hinge({ angle: 0 });
    d.parts[1].rotate = [90, 0, 0]; d.parts[1].axes.hole.dir = [0, -1, 0]; // the hole axis is z after the spec rotation
    d.parts[1].datums = { side: { axis: 'x', at: 0, dir: -1 } };
    d.constraints.push({ type: 'flush', a: 'base', a_face: '-x', b: 'arm', b_face: 'side' });
    d.constraints[1].angle = 20;
    await assert.rejects(ASM.assemble(d, build), /no longer axis-aligned/);
  });
});

describe('Slider, fixed, cylindrical and planar joints', () => {
  // a 100 x 20 x 5 plate with an end stop at x 80..86; a rail axis along X on the plate top, through y = 10
  const rail = { name_ar: 'سكة', model: { union: [{ box: { size: [100, 20, 5] } }, { box: { size: [6, 10, 10] }, translate: [80, 5, 5] }] } };
  const carriage = { name_ar: 'عربة', model: { box: { size: [10, 10, 8] } } };
  const tag = { name_ar: 'لوحة', model: { box: { size: [10, 10, 2] } } };
  const spec = (slider: any, extra: any[] = []) => ({
    parts: [
      { id: 'rail', design: rail, axes: { x: { point: [0, 10, 5], dir: [1, 0, 0] } } },
      { id: 'car', design: carriage, translate: [200, 0, 50], axes: { bore: { point: [5, 5, 0], dir: [1, 0, 0] } } },
      { id: 'tag', design: tag, translate: [200, 0, 58] },
    ],
    constraints: [{ type: 'slider', a: 'rail', a_axis: 'x', b: 'car', b_axis: 'bore', ...slider }, ...extra],
  });
  const lo = (asm: any, id: string) => asm.parts[id].box.lo.map((v: number) => +v.toFixed(6));

  test('slider: the carriage sits on the rail axis at the requested offset; the travel is swept and the end stop found', async () => {
    const asm = await ASM.assemble(spec({ offset: 20, range: [0, 80], step: 10 }), build);
    assert.deepEqual(lo(asm, 'car'), [15, 5, 5]);
    const c = asm.constraints[0];
    assert.deepEqual(c.sweep.map((s: any) => s.offset), [0, 10, 20, 30, 40, 50, 60, 70, 80]);
    assert.deepEqual(c.sweep.filter((s: any) => s.hits.length).map((s: any) => s.offset), [80]);
    assert.ok(Math.abs(c.sweep[8].hits[0].volume_mm3 - 5 * 10 * 8) < 1e-3, JSON.stringify(c.sweep[8]));
    assert.equal(c.ok, false);
    assert.ok((await ASM.assemble(spec({ offset: 20, range: [0, 70], step: 10 }), build)).ok);
    await assert.rejects(ASM.assemble(spec({ offset: 90, range: [0, 80] }), build), /outside the travel/);
  });

  test('fixed: a part keeps its spec pose relative to the part it is fixed to and moves with it', async () => {
    const asm = await ASM.assemble(spec({ offset: 20 }, [{ type: 'fixed', a: 'car', b: 'tag' }]), build);
    assert.deepEqual(lo(asm, 'tag'), [15, 5, 13], 'the tag stays on top of the carriage');
    assert.ok(asm.constraints[1].ok && asm.constraints[1].residual < 1e-6);
  });

  test('cylindrical: concentric with optional offset; planar: faces in contact, same-direction faces refused', async () => {
    const s: any = spec({});
    s.constraints = [{ type: 'cylindrical', a: 'rail', a_axis: 'x', b: 'car', b_axis: 'bore', offset: 40 }];
    const asm = await ASM.assemble(s, build);
    assert.deepEqual(lo(asm, 'car'), [35, 5, 5]); assert.ok(asm.constraints[0].ok);
    const free: any = spec({}); free.constraints = [{ type: 'cylindrical', a: 'rail', a_axis: 'x', b: 'car', b_axis: 'bore' }];
    assert.equal(lo(await ASM.assemble(free, build), 'car')[0], 200, 'without an offset the slide stays where the spec put it');
    const pl: any = spec({});
    pl.constraints = [{ type: 'planar', a: 'rail', a_face: '-z', b: 'tag', b_face: '+z' }];
    assert.equal((await ASM.assemble(pl, build)).parts.tag.box.hi[2], 0);
    pl.constraints = [{ type: 'planar', a: 'rail', a_face: '-z', b: 'tag', b_face: '-z' }];
    await assert.rejects(ASM.assemble(pl, build), /planar joint needs faces pointing at each other/);
  });
});

describe('Assembly approval workflow (per component)', () => {
  const report = { order: ['case', 'lid'], ok: true, constraints: [{ type: 'mate', a: 'case', b: 'lid', ok: true }], interference: [], bom: [{ parts: ['case'], material: 'PLA' }, { parts: ['lid'], material: 'PETG' }] };
  const shas = { case: 'aa', lid: 'bb' };

  test('the assembly is ready only when every component is approved for its current file', () => {
    let ap = {};
    assert.deepEqual(ASM.approvalGate(report, shas, ap).missing, ['case', 'lid']);
    ap = ASM.approveComponent(ap, 'case', 'aa', 'u1', 'ok', 1);
    const g = ASM.approvalGate(report, shas, ap);
    assert.equal(g.ready, false); assert.deepEqual(g.missing, ['lid']);
    ap = ASM.approveComponent(ap, 'lid', 'bb', 'u1', '', 2);
    assert.equal(ASM.approvalGate(report, shas, ap).ready, true);
    assert.equal(ASM.approvalGate(report, shas, ap).needsReason, false);
    // the lid is changed: only the lid's approval goes stale
    const g2 = ASM.approvalGate(report, { case: 'aa', lid: 'cc' }, ap);
    assert.deepEqual([g2.ready, g2.missing, g2.parts[0].approved, g2.parts[1].stale], [false, ['lid'], true, true]);
    assert.throws(() => ASM.approveComponent(ap, 'lid', '', 'u1'), /SHA-256/);
  });

  test('a failed assembly check (collision in the range of motion) needs a written reason and lists the problem', () => {
    const bad = { ...report, ok: false, constraints: [{ type: 'revolute', a: 'case', b: 'lid', ok: false, sweep: [{ angle: 0, hits: [] }, { angle: 90, hits: [{ with: 'case', volume_mm3: 144 }] }] }] };
    const g = ASM.approvalGate(bad, shas, { case: { sha: 'aa' }, lid: { sha: 'bb' } });
    assert.equal(g.ready, true); assert.equal(g.needsReason, true);
    assert.deepEqual(g.problems, ['revolute case-lid: collides at 90°']);
  });

  test('the record hash is independent of key order; print parts carry their own material, quantity and approved hash', () => {
    assert.equal(ASM.canonicalRecord({ b: 1, a: [{ y: 2, x: 1 }] }, { lid: 'bb', case: 'aa' }), ASM.canonicalRecord({ a: [{ x: 1, y: 2 }], b: 1 }, { case: 'aa', lid: 'bb' }));
    const spec = { parts: [{ id: 'case', name_ar: 'العلبة' }, { id: 'lid', name_ar: 'الغطاء', qty: 2 }] };
    assert.deepEqual(ASM.printParts(spec, report, shas, 3), [
      { id: 'case', name_ar: 'العلبة', qty: 3, material: 'PLA', approvedSha: 'aa' },
      { id: 'lid', name_ar: 'الغطاء', qty: 6, material: 'PETG', approvedSha: 'bb' },
    ]);
    assert.throws(() => ASM.printParts(spec, report, { case: 'aa' }, 1), /no approved file/);
  });
});

describe('Multi-concept design', () => {
  test('signatures: the same part is similar, a different structure is distinct, a scaled copy is distinct by size', async () => {
    const sig = async (m: any) => CON.signature((await CAD.generateDesign({ model: m })).mesh);
    const box = await sig({ box: { size: [60, 40, 20] } });
    const box2 = await sig({ box: { size: [60, 40, 20] }, translate: [5, 5, 0] });
    const tray = await sig({ difference: [{ box: { size: [60, 40, 20] } }, { box: { size: [56, 36, 20] }, translate: [2, 2, 2] }] });
    const big = await sig({ box: { size: [90, 60, 30] } });
    assert.equal(CON.compare(box, box2).iou, 1);
    assert.equal(CON.compare(box, box2).similar, true);
    assert.equal(CON.compare(box, tray).similar, false);
    assert.equal(CON.compare(box, big).similar, false);
    const dist = CON.distinctness([box, tray, box2]);
    assert.deepEqual(dist.similarTo, [null, null, 0]);
    assert.equal(dist.distinctCount, 2);
  });

  test('the concepts loop asks for concepts, builds one design per concept, and flags a duplicate', async () => {
    const designs: any = {
      'Clamp': { name_ar: 'مشبك', model: { difference: [{ box: { size: [30, 40, 30] } }, { box: { size: [32, 26, 20] }, translate: [-1, 7, -1] }] }, parameters: [], requirements: [], checks: [], print: {} },
      'Plate': { name_ar: 'لوح', model: { box: { size: [80, 30, 4] } }, parameters: [], requirements: [], checks: [], print: {} },
      'Clamp2': { name_ar: 'مشبك 2', model: { difference: [{ box: { size: [30, 40, 30] } }, { box: { size: [32, 26, 20] }, translate: [-1, 7, -1] }] }, parameters: [], requirements: [], checks: [], print: {} },
    };
    const calls: string[] = [];
    const ask = async (prompt: string, o: any) => {
      calls.push(o.label);
      if (o.label === 'concepts') return { concepts: [{ key: 'a', title_ar: 'Clamp', approach_ar: 'clamp' }, { key: 'b', title_ar: 'Plate', approach_ar: 'plate' }, { key: 'c', title_ar: 'Clamp2', approach_ar: 'clamp again' }] };
      const m = /DESIGN CONCEPT TO BUILD: "([^"]+)"/.exec(prompt);
      return designs[m![1]];
    };
    const steps: string[] = [];
    const out = await A.conceptsLoop({ ask, build: async (d: any) => { const r = await CAD.generateDesign(d); return { ...r, signature: CON.signature(r.mesh) }; }, onStep: (id: string) => steps.push(id), distinctness: CON.distinctness }, 'a holder');
    assert.deepEqual(calls, ['concepts', 'design', 'design', 'design']);
    assert.equal(out.concepts.length, 3);
    assert.ok(out.concepts.every((c: any) => c.result));
    assert.deepEqual(out.distinctness.similarTo, [null, null, 0]);
    const rows = CON.table(out.concepts);
    assert.deepEqual(rows[1].size_mm, { x: 80, y: 30, z: 4 });
    assert.ok(rows[0].mass_g > 0 && rows[0].time_min > 0);
  });

  test('malformed concept replies are rejected', () => {
    assert.throws(() => A.checkConcepts({}), /no concepts/);
    assert.equal(A.checkConcepts({ concepts: [{}, {}, {}, {}] }).length, 3);
  });
});

describe('Ready-made assembly', () => {
  test('Arduino case + lid: lid seated on the rim, 0.3 mm around the lip, no interference', async () => {
    const { ASSEMBLIES } = require(B + 'starters.js');
    const asm = await ASM.assemble(ASSEMBLIES[0], build);
    assert.ok(asm.ok, JSON.stringify({ c: asm.constraints, i: asm.interference }));
    const cl = asm.constraints.find((c: any) => c.type === 'clearance');
    assert.ok(Math.abs(cl.measured_mm - 0.3) < 0.01, String(cl.measured_mm));
    assert.deepEqual(asm.size_mm, [75.4, 60.2, 26]);
    // without ignore_contact the resting faces count as touching
    const s = JSON.parse(JSON.stringify(ASSEMBLIES[0])); s.constraints[3].ignore_contact = false;
    const asm2 = await ASM.assemble(s, build);
    assert.equal(asm2.constraints[3].measured_mm, 0);
  });
});

describe('AI assembly loop (mocked model replies, real kernel)', () => {
  test('an interfering first answer is sent back with the measured overlap, and the fixed answer passes', async () => {
    const mk = (hole: number) => ({ name_ar: 'قاعدة وغطاء', parts: spec(hole).parts, constraints: spec(hole).constraints });
    const prompts: string[] = [];
    const replies = [mk(5.8), mk(6.4)];
    const ask = async (p: string, o: any) => { prompts.push(o.label + ':' + (/overlap by ([\d.]+) mm3/.exec(p)?.[1] || '')); return JSON.parse(JSON.stringify(replies.shift())); };
    const out = await A.assemblyLoop({ ask, assemble: (s: any) => ASM.assemble(s, build), onStep: () => {} }, 'base with a lid');
    assert.equal(prompts[0], 'design:');
    assert.match(prompts[1], /^repair:\d/);
    assert.ok(out.assembly.ok);
    assert.equal(out.spec.parts.length, 2);
  });
});
