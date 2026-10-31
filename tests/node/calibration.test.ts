// Phase 8.3 — printer calibration: test objects, measurement entry, least squares, confidence,
// and the compensated manufacturing variant (the approved design is never modified).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { describe, test } from 'node:test';

const ROOT = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const B = join(ROOT, 'services/ai_3d_engine/browser/');
const CAD = require(B + 'cad.js');
const AN = require(B + 'analysis.js');
const C = require(B + 'calibration.js');

// a simulated printer: known scale per axis, outer bleed, hole offset (what a real printer does, in miniature)
const PR = { sx: 0.996, sy: 1.004, sz: 1.002, b: 0.15, bz: -0.08, c: -0.25 };
function printed(m: any, noise = 0) {
  const s = m.axis === 'z' ? PR.sz : m.axis === 'x' ? PR.sx : m.axis === 'y' ? PR.sy : (PR.sx + PR.sy) / 2;
  const off = m.kind === 'hole' ? PR.c : m.axis === 'z' ? PR.bz : PR.b;
  return +(s * m.nominal + off + noise).toFixed(3);
}
const session = (key: string, at: number, noise = (i: number) => 0) => {
  const t = C.testByKey(key);
  const vals = Object.fromEntries(t.measure.map((m: any, i: number) => [m.id, String(printed(m, noise(i)))]));
  const e = C.checkEntry(key, vals);
  assert.ok(e.ok, e.errors.join('; '));
  return { test: key, at, points: e.points };
};

describe('Printer calibration', () => {
  test('every calibration object builds and has the dimensions it asks the operator to measure', async () => {
    for (const t of C.TESTS) {
      const r = await CAD.generateDesign(C.testDesign(t.key));
      assert.ok(['VALIDATED', 'VALID_WITH_WARNINGS'].includes(r.status), t.key + ' ' + r.status);
      assert.ok(r.size_mm.x <= 220 && r.size_mm.y <= 220 && r.size_mm.z <= 250, t.key);
    }
    const steps = await CAD.generateDesign(C.testDesign('steps'));
    assert.deepEqual(steps.size_mm, { x: 60, y: 60, z: 12 });
    const P = AN.prepare(steps.mesh);
    // the 30 mm tier measured through the solid at its own height
    const w = AN.probe(P, [30, 30, 7.5], 0);
    assert.ok(w.inside && Math.abs(w.span - 30) < 1e-6, String(w.span));
    const holes = await CAD.generateDesign(C.testDesign('holes'));
    const H = AN.prepare(holes.mesh);
    const h10 = AN.probe(H, [7 + 5 * 13 - holes.offset[0], 9 - holes.offset[1], 2], 0);
    assert.ok(!h10.inside && Math.abs(h10.span - 10 * Math.cos(Math.PI / 60)) < 0.02, String(h10.span));
  });

  test('measurement entry: comma decimals accepted, typos and blanks handled', () => {
    const ok = C.checkEntry('xyz_cube', { x: '20,08', y: '20.1', z: '' });
    assert.ok(ok.ok); assert.deepEqual(ok.points.map((p: any) => p.measured), [20.08, 20.1]);
    const bad = C.checkEntry('xyz_cube', { x: '2.01', y: '20.1' });
    assert.equal(bad.ok, false); assert.match(bad.errors[0], /بعيدة جدًا/);
    assert.equal(C.checkEntry('xyz_cube', {}).ok, false);
    assert.equal(C.checkEntry('overhang', { overhang_max_deg: 50 }).result.overhang_max_deg, 50);
    assert.equal(C.checkEntry('overhang', { overhang_max_deg: 55 }).ok, false);
  });

  test('least squares recovers an exact line, and its standard errors match the textbook formula', () => {
    const pts = [10, 20, 30, 40].map((x) => ({ id: 'p' + x, nominal: x, measured: 0.995 * x + 0.12 }));
    const f = C.linfit(pts);
    assert.ok(Math.abs(f.s - 0.995) < 1e-12 && Math.abs(f.b - 0.12) < 1e-12 && f.rms < 1e-12);
    const noisy = [[10, 10.1], [20, 20.0], [30, 30.25], [40, 40.1], [50, 50.3]].map(([x, y]) => ({ id: 'n' + x, nominal: x, measured: y }));
    const g = C.linfit(noisy);
    // closed form: s = Sxy/Sxx, sigma^2 = SSE/(n-2), se_s = sigma/sqrt(Sxx)
    const mx = 30, my = noisy.reduce((a, p) => a + p.measured, 0) / 5, Sxx = 1000;
    const Sxy = noisy.reduce((a, p) => a + (p.nominal - mx) * (p.measured - my), 0), s = Sxy / Sxx, b = my - s * mx;
    const sse = noisy.reduce((a, p) => a + (p.measured - s * p.nominal - b) ** 2, 0), sig = Math.sqrt(sse / 3);
    assert.ok(Math.abs(g.s - s) < 1e-12 && Math.abs(g.b - b) < 1e-12);
    assert.ok(Math.abs(g.se_s - sig / Math.sqrt(Sxx)) < 1e-12);
    assert.ok(Math.abs(g.se_b - sig * Math.sqrt(1 / 5 + mx * mx / Sxx)) < 1e-12);
    // a single nominal can only give an offset
    const one = C.linfit([{ id: 'a', nominal: 20, measured: 20.1 }, { id: 'b', nominal: 20, measured: 20.14 }]);
    assert.equal(one.scaleFitted, false); assert.ok(Math.abs(one.b - 0.12) < 1e-12);
  });

  test('a full calibration (cube + steps + holes) recovers the printer, with high confidence', () => {
    const fit = C.fitProfile([session('xyz_cube', 1), session('steps', 2), session('holes', 3)]);
    assert.ok(Math.abs(fit.axes.x.s - PR.sx) < 1e-3 && Math.abs(fit.axes.x.b - PR.b) < 0.01, JSON.stringify(fit.axes.x));
    assert.ok(Math.abs(fit.axes.y.s - PR.sy) < 1e-3 && Math.abs(fit.axes.y.b - PR.b) < 0.01);
    assert.ok(Math.abs(fit.axes.z.s - PR.sz) < 1e-3 && Math.abs(fit.axes.z.b - PR.bz) < 0.01);
    assert.ok(Math.abs(fit.holes.b - PR.c) < 0.01, JSON.stringify(fit.holes));
    assert.equal(fit.confidence, 'high');
    assert.deepEqual(fit.warnings, []);
  });

  test('with caliper noise (±0.02 mm, seeded) the fitted scale stays within 3 standard errors of the truth', () => {
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.04;
    const fit = C.fitProfile([session('xyz_cube', 1, rnd), session('steps', 2, rnd), session('holes', 3, rnd), session('walls', 4, rnd)]);
    for (const [a, s] of [['x', PR.sx], ['y', PR.sy], ['z', PR.sz]] as const) {
      const f = fit.axes[a];
      assert.ok(Math.abs(f.s - s) <= 3 * f.se_s, `${a}: ${f.s} vs ${s} (se ${f.se_s})`);
      assert.ok(f.rms < 0.03);
    }
    assert.notEqual(fit.confidence, 'low');
  });

  test('only the latest session of each test counts; a lone cube gives low confidence; an outlier is reported', () => {
    const old = { test: 'xyz_cube', at: 0, points: C.checkEntry('xyz_cube', { x: '21', y: '21', z: '21' }).points };
    const fit = C.fitProfile([old, session('xyz_cube', 5)]);
    assert.ok(Math.abs(fit.axes.x.b - (printed({ axis: 'x', kind: 'outer', nominal: 20 }) - 20)) < 1e-9);
    assert.equal(fit.confidence, 'low');
    const s = session('steps', 2, (i) => (i === 2 ? 0.6 : 0)); // one mis-read value
    const f2 = C.fitProfile([session('xyz_cube', 1), s]);
    assert.ok(f2.warnings.some((w: string) => /outliers/.test(w)), f2.warnings.join(' | '));
  });

  test('compensation makes a new variant whose predicted print is on size; the approved design is untouched', async () => {
    const fit = C.fitProfile([session('xyz_cube', 1), session('steps', 2), session('holes', 3)]);
    const design = C.testDesign('holes');
    const before = JSON.stringify(design);
    const v = C.compensate(design, fit);
    assert.equal(JSON.stringify(design), before, 'the original must not change');
    assert.equal(v.compensation.holes_adjusted.length, 6);
    assert.ok(Math.abs(v.compensation.hole_delta_mm - 0.25) < 0.01);
    const r = await CAD.generateDesign(v.design);
    // outer: printed = s * (variant size) + b, and the slicer contour offset removes b
    const px = fit.axes.x.s * r.size_mm.x + fit.axes.x.b + 2 * v.compensation.slicer.xy_contour_compensation_mm;
    const pz = fit.axes.z.s * r.size_mm.z;
    assert.ok(Math.abs(px - 80) < 0.01, String(px));
    assert.ok(Math.abs(pz - 9.5) < 0.005, String(pz));
    // holes: measured through the variant mesh, then pushed through the printer model
    const P = AN.prepare(r.mesh), k = v.compensation.scale;
    for (const [i, d] of [3, 4, 5, 6, 8, 10].entries()) {
      const at = [(7 + i * 13) * k[0] - r.offset[0], 9 * k[1] - r.offset[1], 2 * k[2]];
      const m = AN.probe(P, at, 0).span / Math.cos(Math.PI / 60); // vertex diameter of the 60-gon
      const print = fit.axes.x.s * m + fit.holes.b;
      assert.ok(Math.abs(print - d) < 0.02, `hole ${d}: predicted ${print}`);
    }
  });

  test('compensating a variant again is refused (no double correction), however often the job is exported', async () => {
    const fit = C.fitProfile([session('xyz_cube', 1), session('steps', 2), session('holes', 3)]);
    const approved = C.testDesign('holes');
    const v1 = C.compensate(approved, fit), v2 = C.compensate(approved, fit);
    assert.equal(JSON.stringify(v1.design), JSON.stringify(v2.design), 'repeated exports give the identical variant');
    assert.ok(C.isVariant(v1.design) && !C.isVariant(approved));
    assert.throws(() => C.compensate(v1.design, fit), (e: any) => e.code === 'ALREADY_COMPENSATED');
    const r1 = await CAD.generateDesign(v1.design), r2 = await CAD.generateDesign(v2.design);
    assert.deepEqual(r1.size_mm, r2.size_mm);
  });

  test('compensation refuses unusable calibrations', () => {
    const low = C.fitProfile([session('xyz_cube', 1)]);
    assert.throws(() => C.compensate(C.testDesign('xyz_cube'), low), /confidence is low/);
    assert.throws(() => C.compensate(C.testDesign('xyz_cube'), { axes: {} }), /no X calibration/);
    const skew = C.fitProfile([session('xyz_cube', 1), session('steps', 2)]);
    skew.axes.x.s = 1.08;
    assert.throws(() => C.compensate(C.testDesign('xyz_cube'), skew), /more than 5%/);
  });

  test('hole widening follows boolean polarity, keeps expressions, and skips holes it cannot treat exactly', () => {
    const st = { adjusted: [] as string[], skipped: [] as string[] };
    const model = { difference: [
      { box: { size: [50, 50, 10] } },
      { cylinder: { d: 'hole_d', h: 12 } },
      { cylinder: { r: 2, h: 12 }, rotate: [90, 0, 0] },
      { difference: [{ box: { size: [10, 10, 10] } }, { cylinder: { d: 4, h: 12 } }] }, // a boss left inside a cut: material
      { linear_array: { count: 3, step: [10, 0, 0], child: { cylinder: { d: 3, h: 12 } } } },
    ] };
    const out = C.adjustHoles(model, 0.3, false, st);
    assert.equal(out.difference[1].cylinder.d, '(hole_d)+0.3');
    assert.equal(out.difference[2].cylinder.r, 2);
    assert.equal(out.difference[3].difference[1].cylinder.d, 4);
    assert.equal(out.difference[4].linear_array.child.cylinder.d, 3.3);
    assert.deepEqual(st.skipped, ['model.difference[2]']);
    assert.equal(st.adjusted.length, 2);
  });
});

describe('Printer overhang limit in the manufacturability check', () => {
  // regression (Phase 9): the limit is measured from vertical, like the calibration fins; it used cos(limit), which
  // agreed only at the 45 deg default and made a printer calibrated to 60 deg stricter instead of more lenient
  const fin = (b: number) => ({ union: [{ box: { size: [40, 14, 2] } }, { extrude: { points: [[0, 0], [2, 0], [2 + 12 * Math.tan((b * Math.PI) / 180), 12.5], [0, 12.5]], h: 3 }, rotate: [90, 0, 0], translate: [4, 8.5, 1.5] }] });
  test('a face leaning 60 deg from vertical needs support on a 45 or 55 deg printer, not on a 65 deg printer', async () => {
    const r = await CAD.generateDesign({ model: fin(60) });
    const area = (d: number) => AN.dfm(r.mesh, { overhang_deg: d }).stats.overhang_area_mm2;
    for (const d of [45, 55]) assert.ok(Math.abs(area(d) - 36 / Math.cos(Math.PI / 3)) / 72 < 0.05, `${d}: ${area(d)}`);
    assert.equal(area(65), 0);
    const r40 = await CAD.generateDesign({ model: fin(40) });
    assert.ok(AN.dfm(r40.mesh, { overhang_deg: 35 }).stats.overhang_area_mm2 > 40);
    assert.equal(AN.dfm(r40.mesh, { overhang_deg: 45 }).stats.overhang_area_mm2, 0);
  });
});
