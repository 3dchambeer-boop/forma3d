// Phase 8.1a — kernel operations (fillet, chamfer, filleted/chamfered box, loft, sweep, mirror copy,
// tessellation quality) and mesh exporters (OBJ, GLB, 3MF). Every check compares a measured
// quantity with an analytic value.

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { describe, test } from 'node:test';

const ROOT = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const CAD = require(join(ROOT, 'services/ai_3d_engine/browser/cad.js'));
const X = require(join(ROOT, 'services/ai_3d_engine/browser/exporters.js'));
const FINE = { linear_mm: 0.002, angular_deg: 2 };
const vol = async (model: unknown, tessellation?: unknown) => {
  const r = await CAD.generateDesign({ model, tessellation });
  assert.equal(r.post_export_validation.stats.bodies, 1);
  assert.ok(['VALIDATED', 'VALID_WITH_WARNINGS'].includes(r.status), r.status);
  return { v: r.mesh.signedVolume(), r };
};
const near = (a: number, b: number, rel: number, msg = '') => assert.ok(Math.abs(a - b) <= Math.abs(b) * rel, `${msg} ${a} vs ${b}`);
const SQ = [[0, 0], [40, 0], [40, 40], [0, 40]];

describe('Fillets and chamfers on profiles', () => {
  test('fillet r5 on a 40 mm square converges to the exact area (1600 - (4 - pi) r^2) x h', async () => {
    const { v } = await vol({ extrude: { points: SQ, h: 10, fillet: 5 } }, FINE);
    near(v, (1600 - (4 - Math.PI) * 25) * 10, 2e-5);
  });
  test('chamfer d5 removes exactly four right triangles', async () => {
    const { v } = await vol({ extrude: { points: SQ, h: 10, chamfer: 5 } });
    near(v, (1600 - 4 * 12.5) * 10, 1e-9);
  });
  test('per-corner radii: convex corners remove r^2(1 - pi/4), a reflex corner adds it', async () => {
    const L = [[0, 0], [40, 0], [40, 10], [10, 10], [10, 30], [0, 30]];
    const radii = [0, 3, 3, 6, 2, 2];
    const k = 1 - Math.PI / 4, area = 600 - k * (9 + 9 + 4 + 4) + k * 36;
    const { v } = await vol({ extrude: { points: L, h: 5, fillet: radii } }, FINE);
    near(v, area * 5, 2e-5);
  });
  test('a radius that does not fit fails with the edge it needs', async () => {
    await assert.rejects(CAD.generateDesign({ model: { extrude: { points: [[0, 0], [10, 0], [10, 10], [0, 10]], h: 5, fillet: 6 } } }), /fillet radius too large between points 0 and 1: needs 12\.000 mm of a 10\.000 mm edge/);
    await assert.rejects(CAD.generateDesign({ model: { extrude: { points: SQ, h: 5, fillet: 2, chamfer: 1 } } }), /either "fillet" or "chamfer"/);
  });
  test('revolve with a filleted profile = a cylinder with rounded top edge (Pappus)', async () => {
    // rectangle r in [0,10], z in [0,20], fillet r=2 at the outer top corner only
    const { v } = await vol({ revolve: { profile: [[0, 0], [10, 0], [10, 20], [0, 20]], fillet: [0, 0, 2, 0] } }, FINE);
    const k = 1 - Math.PI / 4, A = 4 * k, rc = 10 - 2 * (10 - 3 * Math.PI) / (12 - 3 * Math.PI); // removed corner area and its centroid radius
    const n = 128, poly = (n * Math.sin((2 * Math.PI) / n)) / (2 * Math.PI); // the segment cap: an n-gon of revolution
    near(v, (Math.PI * 100 * 20 - 2 * Math.PI * rc * A) * poly, 5e-5);
  });
});

describe('Filleted and chamfered boxes', () => {
  test('fillet_box volume = Steiner formula V0 + A0 r + pi L0 r^2 + 4/3 pi r^3', async () => {
    const [a, b, c, r] = [40, 30, 20, 5], [x, y, z] = [a - 2 * r, b - 2 * r, c - 2 * r];
    const exact = x * y * z + 2 * (x * y + y * z + x * z) * r + Math.PI * (x + y + z) * r * r + (4 / 3) * Math.PI * r ** 3;
    const { v, r: res } = await vol({ fillet_box: { size: [a, b, c], r } }, { linear_mm: 0.01, angular_deg: 3 });
    near(v, exact, 1e-3);
    assert.deepEqual(res.size_mm, { x: 40, y: 30, z: 20 });
  });
  test('chamfer_box volume matches a direct numerical integration of its definition', async () => {
    const [a, b, c, d] = [40, 30, 20, 3];
    const { v } = await vol({ chamfer_box: { size: [a, b, c], d } });
    const oct = (u: number, w: number, U: number, W: number) => u + w >= d && U - u + w >= d && u + W - w >= d && U - u + W - w >= d;
    let n = 0, inside = 0; const N = 80;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) {
      const px = ((i + 0.5) * a) / N, py = ((j + 0.5) * b) / N, pz = ((k + 0.5) * c) / N; n++;
      if (oct(px, py, a, b) && oct(py, pz, b, c) && oct(px, pz, a, c)) inside++;
    }
    near(v, (inside / n) * a * b * c, 5e-3);
  });
  test('radius >= half the smallest side is refused', async () => {
    await assert.rejects(CAD.generateDesign({ model: { fillet_box: { size: [40, 30, 10], r: 5 } } }), /does not fit/);
  });
});

describe('Loft, sweep, mirror copy', () => {
  test('loft between equal squares (4 and 8 points) is a prism', async () => {
    const S8 = [[0, 0], [20, 0], [40, 0], [40, 20], [40, 40], [20, 40], [0, 40], [0, 20]];
    const { v } = await vol({ loft: { sections: [{ points: SQ, z: 0 }, { points: S8, z: 25 }] } });
    near(v, 1600 * 25, 1e-9);
  });
  test('loft square to smaller square = frustum of a pyramid', async () => {
    const small = [[10, 10], [30, 10], [30, 30], [10, 30]];
    const { v } = await vol({ loft: { sections: [{ points: SQ, z: 0 }, { points: small, z: 30 }] } });
    near(v, (30 / 3) * (1600 + 400 + Math.sqrt(1600 * 400)), 1e-9);
  });
  test('sweep along a straight line equals the extrusion; along an L it obeys Pappus with mitred joints', async () => {
    const P = [[-3, -3], [3, -3], [3, 3], [-3, 3]];
    near((await vol({ sweep: { profile: P, path: [[0, 0, 0], [0, 0, 30]] } })).v, 36 * 30, 1e-9);
    near((await vol({ sweep: { profile: P, path: [[0, 0, 3], [50, 0, 3], [50, 40, 3]] } })).v, 36 * 90, 1e-9);
    await assert.rejects(CAD.generateDesign({ model: { sweep: { profile: P, path: [[0, 0, 3], [4, 0, 3], [4, 40, 3]] } } }), /too short for the profile to turn/);
  });
  test('mirror_copy doubles the volume and is symmetric about the axis', async () => {
    const { v, r } = await vol({ mirror_copy: { axis: 'x', child: { box: { size: [10, 5, 5] } } } });
    near(v, 500, 1e-9);
    assert.equal(r.size_mm.x, 20);
  });
});

describe('Tessellation quality', () => {
  test('chord deviation stays within linear_mm; designs without a quality keep their old segment counts', () => {
    for (const [r, lin] of [[10, 0.01], [50, 0.05], [3, 0.002]]) {
      const n = CAD.segmentsFor(r, { linear_mm: lin }, 64);
      assert.ok(r * (1 - Math.cos(Math.PI / n)) <= lin + 1e-12, `r=${r} n=${n}`);
    }
    assert.equal(CAD.segmentsFor(10, null, 64), 64);
  });
});

describe('Exporters', () => {
  const meshOf = async (model: unknown) => (await CAD.generateDesign({ model })).mesh;
  test('OBJ: one vertex line per vertex, one face line per triangle, 1-based indices', async () => {
    const m = await meshOf({ box: { size: [10, 20, 30] } });
    const obj = X.toOBJ([{ name: 'box', mesh: m }]);
    assert.equal(obj.split('\n').filter((l: string) => l.startsWith('v ')).length, m.vertices.length);
    const faces = obj.split('\n').filter((l: string) => l.startsWith('f '));
    assert.equal(faces.length, m.faces.length);
    assert.ok(faces.every((l: string) => l.split(' ').slice(1).every((i) => +i >= 1 && +i <= m.vertices.length)));
  });
  test('GLB: valid glTF 2.0 header, Y-up metres, accessor bounds = the part size', async () => {
    const m = await meshOf({ box: { size: [10, 20, 30] } });
    const glb = X.toGLB(m);
    const dv = new DataView(glb.buffer);
    assert.equal(dv.getUint32(8, true), glb.length);
    const j = X.parseGLB(glb);
    const pos = j.accessors[0];
    assert.equal(pos.count, m.vertices.length);
    assert.deepEqual(pos.max.map((v: number) => +(v - 0).toFixed(6)), [0.01, 0.03, 0]);
    assert.deepEqual(pos.min.map((v: number) => +(v - 0).toFixed(6)), [0, 0, -0.02]);
    assert.equal(j.accessors[1].count, m.faces.length * 3);
  });
  test('3MF: millimetre package that round-trips every vertex and triangle; several parts = several objects', async () => {
    const a = await meshOf({ box: { size: [10, 10, 10] } }), b = await meshOf({ cylinder: { d: 8, h: 12 } });
    const pkg = X.to3MF([{ name: 'base', mesh: a }, { name: 'pin', mesh: b }], { Title: 'test' });
    const back = X.parse3MF(pkg);
    assert.equal(back.unit, 'millimeter');
    assert.deepEqual(back.files.sort(), ['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels']);
    assert.equal(back.objects.length, 2);
    assert.equal(back.objects[1].faces.length, b.faces.length);
    back.objects[0].vertices.forEach((v: number[], i: number) => v.forEach((x, k) => assert.ok(Math.abs(x - a.vertices[i][k]) < 1e-6)));
    const files = X.unzipStore(pkg);
    assert.ok(files['3D/3dmodel.model'].length > 100);
  });
});
