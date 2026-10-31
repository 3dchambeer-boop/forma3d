// Phase 8.2 — engineering drawings: views, hidden lines, measured dimensions, holes, standards,
// sheet fit, overlaps, and the vector PDF.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { describe, test } from 'node:test';

const ROOT = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const B = join(ROOT, 'services/ai_3d_engine/browser/');
const CAD = require(B + 'cad.js');
const D = require(B + 'drawing.js');
const PDFLib = require(B + 'vendor/pdf-lib.min.js');
const { STARTERS } = require(B + 'starters.js');
const mesh = async (model: unknown) => (await CAD.generateDesign({ model })).mesh;
const PLATE = { difference: [{ box: { size: [80, 50, 12] } }, { cylinder: { d: 8.4, h: 20 }, translate: [15, 25, -1] }, { cylinder: { d: 8.4, h: 20 }, translate: [65, 25, -1] }, { box: { size: [30, 30, 6] }, translate: [25, 10, -1] }] };

describe('Engineering drawings', () => {
  test('a plain box: every edge visible, overall dimensions printed from the geometry, 1:1 on A4', async () => {
    const L = D.layout(await mesh({ box: { size: [40, 30, 20] } }), {}, { sheet: 'A4' });
    for (const v of ['front', 'top', 'right']) assert.equal(L.report.views[v].hidden, 0, v);
    assert.deepEqual(L.report.overall_mm, { x: 40, y: 30, z: 20 });
    assert.equal(L.report.scale, '1:1');
    assert.ok(L.report.ok, JSON.stringify(L.report));
    const dims = L.prims.filter((p: any) => p.role === 'dim').map((p: any) => p.s).sort();
    assert.deepEqual(dims, ['20', '30', '40']);
  });

  test('holes are found, measured through the solid and tabled; a pocket underneath is drawn hidden', async () => {
    const L = D.layout(await mesh(PLATE), {}, { sheet: 'A4' });
    assert.deepEqual(L.report.holes.map((h: any) => [h.x, h.y, h.d, h.measured]), [[15, 25, 8.4, 8.4], [65, 25, 8.4, 8.4]]);
    assert.ok(L.report.views.front.hidden > 0, 'the pocket and holes must appear as hidden lines in the front view');
    assert.ok(L.prims.some((p: any) => p.s === 'THRU'));
    assert.ok(L.report.ok, JSON.stringify(L.report.consistency));
  });

  test('a blind hole reports its depth', async () => {
    const L = D.layout(await mesh({ difference: [{ box: { size: [40, 40, 20] } }, { cylinder: { d: 10, h: 9 }, translate: [20, 20, 12] }] }), {}, {});
    const row = L.prims.filter((p: any) => p.role === 'table').map((p: any) => p.s);
    assert.ok(row.includes('8'), row.join(' '));
  });

  test('screw holes inside an enclosure are found on their standoffs; a rectangle is not mistaken for a circle', async () => {
    const st = STARTERS.find((s: any) => s.key === 'arduino_case');
    const r = await CAD.generateDesign(st.design);
    const L = D.layout(r.mesh, {}, { sheet: 'A3' });
    assert.equal(L.report.holes.length, 4, JSON.stringify(L.report.holes));
    for (const h of L.report.holes) { assert.equal(h.d, 2.8); assert.equal(h.measured, 2.8); }
    const rows = L.prims.filter((p: any) => p.role === 'table').map((p: any) => p.s);
    assert.equal(rows.filter((x: string) => x === '5').length, 4, 'blind depth = standoff height');
  });

  test('ISO places the top view below the front view; ASME (third angle) above it', async () => {
    const m = await mesh({ box: { size: [40, 30, 20] } });
    const y = (L: any, s: string) => L.prims.find((p: any) => p.role === 'label' && p.s === s).y;
    const iso = D.layout(m, {}, { standard: 'ISO' }), asme = D.layout(m, {}, { standard: 'ASME' });
    assert.ok(y(iso, 'TOP') < y(iso, 'FRONT'));
    assert.ok(y(asme, 'TOP') > y(asme, 'FRONT'));
    assert.equal(asme.report.projection, 'third-angle');
  });

  test('scale comes from the standard series; a part too large for the sheet is reported, not squeezed', async () => {
    assert.equal(D.layout(await mesh({ box: { size: [400, 120, 60] } }), {}, { sheet: 'A4' }).report.scale, '1:5');
    const big = D.layout(await mesh({ box: { size: [1990, 1990, 1990] } }), {}, { sheet: 'A4' });
    assert.equal(big.report.fits, false);
    assert.match(big.report.warnings.join(' '), /does not fit A4/);
  });

  for (const st of STARTERS.filter((s: any) => ['headphone_hook', 'arduino_case', 'hex_wrench', 'l_bracket', 'phone_case'].includes(s.key))) {
    test(`drawing of "${st.key}" fits the sheet with no overlapping text and consistent dimensions`, async () => {
      const r = await CAD.generateDesign(st.design);
      const L = D.layout(r.mesh, { title: 'TEST', checks: r.analysis.checks }, { sheet: 'A3' });
      assert.ok(L.report.fits, JSON.stringify(L.report.warnings));
      assert.deepEqual(L.report.overlaps, []);
      assert.ok(L.report.consistency.every((c: any) => c.ok), JSON.stringify(L.report.consistency));
    });
  }

  test('section A-A cuts through the hole row; its area is exact and it is hatched', async () => {
    const L = D.layout(await mesh(PLATE), {}, { sheet: 'A3' });
    // 80 x 12 plate, minus the 30 x 5 pocket (inside the part) and two 8.4 mm holes through 12 mm (vertex-aligned polygons)
    assert.deepEqual(L.report.section, { plane: 'y', at_mm: 25, area_mm2: 608.4, loops: 3 });
    assert.ok(L.prims.filter((p: any) => p.style === 'hatch').length > 10);
    assert.ok(L.prims.some((p: any) => p.s === 'SECTION A-A'));
    assert.equal(L.prims.filter((p: any) => p.role === 'label' && p.s === 'A').length, 2, 'both ends of the cutting plane are lettered');
  });

  test('holes along Y and along X are found in the front and right views, sized and located', async () => {
    const L = D.layout(await mesh({ difference: [{ box: { size: [40, 30, 20] } }, { cylinder: { d: 6, h: 40 }, rotate: [90, 0, 0], translate: [20, 35, 10] }, { cylinder: { d: 5, h: 50 }, rotate: [0, 90, 0], translate: [-5, 15, 10] }] }), {}, { sheet: 'A3' });
    const byView = Object.fromEntries(L.report.holes.map((h: any) => [h.view, h]));
    assert.deepEqual([byView.front.x, byView.front.y, byView.front.d, byView.front.depth], [20, 10, 6, 'THRU']);
    assert.deepEqual([byView.right.x, byView.right.y, byView.right.d, byView.right.depth], [15, 10, 5, 'THRU']);
    assert.ok(Math.abs(byView.front.measured - 6) < 0.05 && Math.abs(byView.right.measured - 5) < 0.05);
    assert.deepEqual(L.report.validation, []);
  });

  test('GD&T: datums only on real planar faces; hole position toleranced to A|B|C; baseline position dimensions', async () => {
    const L = D.layout(await mesh(PLATE), {}, { sheet: 'A3' });
    assert.deepEqual(L.report.gdt.datums, ['A', 'B', 'C']);
    assert.deepEqual(L.report.gdt.frames.map((f: any) => f.type), ['flatness', 'position']);
    assert.deepEqual(L.report.gdt.frames[1].refs, ['A', 'B', 'C']);
    assert.deepEqual(L.report.positionDims, { x: [15, 65], y: [25], inTableOnly: false });
    assert.ok(L.prims.some((p: any) => p.role === 'callout' && p.s === '2X Ø8.4 THRU'));
    assert.ok(L.report.ok, JSON.stringify(L.report));
    // a round disc has a flat bottom (A) but no flat back or left face: no position frame, and the report says why
    const disc = D.layout(await mesh({ difference: [{ cylinder: { d: 60, h: 8 } }, { cylinder: { d: 10, h: 10 }, translate: [0, 0, -1] }] }), {}, { sheet: 'A3' });
    assert.deepEqual(disc.report.gdt.datums, ['A']);
    assert.match(disc.report.gdt.note, /lacks a planar datum face \(B, C\)/);
  });

  test('the PDF is a real vector A3 page that pdf-lib can re-open', async () => {
    const L = D.layout(await mesh(PLATE), { title: 'MOUNT PLATE' }, { sheet: 'A3' });
    const bytes = await D.toPDF(L, PDFLib, { title: 'MOUNT PLATE' });
    const doc = await PDFLib.PDFDocument.load(bytes);
    const pg = doc.getPage(0);
    assert.equal(doc.getPageCount(), 1);
    assert.ok(Math.abs(pg.getWidth() - 420 * 72 / 25.4) < 0.5 && Math.abs(pg.getHeight() - 297 * 72 / 25.4) < 0.5);
    assert.equal(doc.getTitle(), 'MOUNT PLATE');
    const svg = D.toSVG(L);
    assert.match(svg, /^<svg/);
    assert.ok(svg.includes('>80<') && svg.includes('>50<') && svg.includes('>12<'));
  });
});
