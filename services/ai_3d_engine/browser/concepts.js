/*
 * FormaConcepts — shape signatures and the distinctness check for multi-concept design.
 *
 *   signature(mesh)        bounding size + a 16x16x16 occupancy grid over the part's own bounds
 *                          (cast along Z through each column; inside = odd number of crossings)
 *   compare(a, b)          IoU of the normalised grids and the largest size ratio between axes
 *   distinctness(sigs)     pairwise matrix; a concept is "too similar" to an earlier one when its
 *                          normalised shape overlaps >= 0.8 AND every size is within 20 %
 *   table(results)         the comparison rows shown to the customer (all measured, none estimated by AI)
 */
(function (root) {
  'use strict';
  const AN = typeof module !== 'undefined' && module.exports ? require('./analysis.js') : root.FormaAnalysis;
  const N = 16;

  function signature(mesh, prepared) {
    const P = prepared || AN.prepare(mesh);
    const lo = P.lo, hi = P.hi, size = [0, 1, 2].map((a) => hi[a] - lo[a]);
    const grid = new Uint8Array(N * N * N);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const x = lo[0] + ((i + 0.5) / N) * size[0] + 1.3e-4, y = lo[1] + ((j + 0.5) / N) * size[1] + 0.7e-4;
      const ts = AN.cast(P, [x, y, lo[2] - 1], [0, 0, 1], 0, false).map(([t]) => lo[2] - 1 + t).sort((a, b) => a - b);
      for (let k = 0; k < N; k++) {
        const z = lo[2] + ((k + 0.5) / N) * size[2];
        let c = 0; for (const t of ts) if (t < z) c++;
        if (c % 2 === 1) grid[(k * N + j) * N + i] = 1;
      }
    }
    let filled = 0; for (const g of grid) filled += g;
    return { size: size.map((v) => Math.round(v * 100) / 100), fill: filled / grid.length, grid };
  }

  function compare(a, b) {
    let inter = 0, uni = 0;
    for (let i = 0; i < a.grid.length; i++) { inter += a.grid[i] & b.grid[i]; uni += a.grid[i] | b.grid[i]; }
    const iou = uni ? inter / uni : 1;
    // sizes compared axis by axis after sorting (a part rotated 90 degrees is still the same size class)
    const sa = a.size.slice().sort((x, y) => x - y), sb = b.size.slice().sort((x, y) => x - y);
    const sizeRatio = Math.max(...sa.map((v, i) => Math.max(v, sb[i]) / Math.max(1e-6, Math.min(v, sb[i]))));
    return { iou: Math.round(iou * 1000) / 1000, sizeRatio: Math.round(sizeRatio * 1000) / 1000, similar: iou >= 0.8 && sizeRatio <= 1.2 };
  }

  function distinctness(sigs) {
    const pairs = [], similarTo = sigs.map(() => null);
    for (let i = 0; i < sigs.length; i++) for (let j = 0; j < i; j++) {
      if (!sigs[i] || !sigs[j]) continue;
      const c = compare(sigs[i], sigs[j]);
      pairs.push({ a: j, b: i, ...c });
      if (c.similar && similarTo[i] == null) similarTo[i] = j;
    }
    return { pairs, similarTo, distinctCount: sigs.filter((s, i) => s && similarTo[i] == null).length };
  }

  function table(results) {
    return results.map((r) => {
      if (!r || !r.result) return null;
      const an = r.result.analysis || {}, est = an.estimate || {}, dfm = an.dfm || { issues: [] }, ch = an.checks || [];
      return {
        size_mm: r.result.size_mm, volume_cm3: est.plastic_cm3 ?? null, mass_g: est.mass_g ?? null, time_min: est.time_min ?? null,
        checks: `${ch.filter((c) => c.pass).length}/${ch.length}`, dfm_errors: dfm.issues.filter((i) => i.severity === 'error').length,
        dfm_warnings: dfm.issues.filter((i) => i.severity !== 'error').length, status: r.result.status, supports: !!(r.design.print && r.design.print.supports),
      };
    });
  }

  const api = { signature, compare, distinctness, table, N };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FormaConcepts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
