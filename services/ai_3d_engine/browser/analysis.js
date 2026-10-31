/*
 * Forma analysis — deterministic checks on the finished mesh (no language model):
 *   dfm(mesh, opts)            manufacturability: wall thickness, overhangs, bed contact
 *   verify(mesh, checks, ...)  measures the customer's requirements on the real geometry
 *   estimate(mesh, print)      filament mass/length, print time, cost (approximate)
 * Works in the browser (window.FormaAnalysis), in a Worker and in Node (module.exports).
 */
(function (root) {
  'use strict';

  const DENSITY = { PLA: 1.24, PETG: 1.27, ABS: 1.04, ASA: 1.07, TPU: 1.21, NYLON: 1.14 }; // g/cm3
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const r2 = (x) => Math.round(x * 100) / 100;

  // ---------------------------------------------------------------- triangle soup + uniform grid for ray casting
  function prepare(mesh) {
    const n = mesh.faces.length;
    const tri = new Float64Array(n * 9), nrm = new Float64Array(n * 3), area = new Float64Array(n);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    mesh.faces.forEach((f, i) => {
      for (let k = 0; k < 3; k++) {
        const v = mesh.vertices[f[k]];
        for (let a = 0; a < 3; a++) { tri[i * 9 + k * 3 + a] = v[a]; if (v[a] < lo[a]) lo[a] = v[a]; if (v[a] > hi[a]) hi[a] = v[a]; }
      }
      const a = mesh.vertices[f[0]], b = mesh.vertices[f[1]], c = mesh.vertices[f[2]];
      const cr = cross(sub(b, a), sub(c, a)), l = Math.hypot(cr[0], cr[1], cr[2]) || 1;
      nrm.set([cr[0] / l, cr[1] / l, cr[2] / l], i * 3); area[i] = l / 2;
    });
    const size = sub(hi, lo).map((x) => Math.max(x, 1e-6));
    const cell = Math.max(Math.cbrt((size[0] * size[1] * size[2]) / Math.max(1, n)) * 1.5, Math.max(...size) / 160, 1e-3);
    const dims = size.map((s) => Math.max(1, Math.min(160, Math.ceil(s / cell))));
    const cells = new Map();
    const ci = (x, a) => Math.max(0, Math.min(dims[a] - 1, Math.floor((x - lo[a]) / cell)));
    for (let i = 0; i < n; i++) {
      const t = i * 9;
      const mn = [0, 1, 2].map((a) => ci(Math.min(tri[t + a], tri[t + 3 + a], tri[t + 6 + a]), a));
      const mx = [0, 1, 2].map((a) => ci(Math.max(tri[t + a], tri[t + 3 + a], tri[t + 6 + a]), a));
      for (let x = mn[0]; x <= mx[0]; x++) for (let y = mn[1]; y <= mx[1]; y++) for (let z = mn[2]; z <= mx[2]; z++) {
        const k = (z * dims[1] + y) * dims[0] + x; let l = cells.get(k); if (!l) cells.set(k, (l = [])); l.push(i);
      }
    }
    return { n, tri, nrm, area, lo, hi, cell, dims, cells };
  }

  // Möller–Trumbore; returns t or NaN. Edges are inclusive (hits are de-duplicated by t afterwards).
  function hit(P, i, o, d) {
    const t = i * 9, e1 = [P.tri[t + 3] - P.tri[t], P.tri[t + 4] - P.tri[t + 1], P.tri[t + 5] - P.tri[t + 2]];
    const e2 = [P.tri[t + 6] - P.tri[t], P.tri[t + 7] - P.tri[t + 1], P.tri[t + 8] - P.tri[t + 2]];
    const p = cross(d, e2), det = dot(e1, p);
    if (Math.abs(det) < 1e-12) return NaN;
    const inv = 1 / det, s = [o[0] - P.tri[t], o[1] - P.tri[t + 1], o[2] - P.tri[t + 2]];
    const u = dot(s, p) * inv; if (u < -1e-9 || u > 1 + 1e-9) return NaN;
    const q = cross(s, e1), v = dot(d, q) * inv; if (v < -1e-9 || u + v > 1 + 1e-9) return NaN;
    return dot(e2, q) * inv;
  }

  // All hits along the ray o + t d (t > tmin), walking the grid (3D DDA). first=true stops at the nearest.
  function cast(P, o, d, tmin, first) {
    const { lo, hi, cell, dims } = P;
    // clip the ray to the grid box
    let t0 = tmin, t1 = Infinity;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-15) { if (o[a] < lo[a] - 1e-9 || o[a] > hi[a] + 1e-9) return []; continue; }
      let ta = (lo[a] - 1e-6 - o[a]) / d[a], tb = (hi[a] + 1e-6 - o[a]) / d[a]; if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    }
    if (t0 > t1) return [];
    const p = [0, 1, 2].map((a) => o[a] + d[a] * t0);
    const c = [0, 1, 2].map((a) => Math.max(0, Math.min(dims[a] - 1, Math.floor((p[a] - lo[a]) / cell))));
    const step = d.map((x) => (x > 0 ? 1 : x < 0 ? -1 : 0));
    const tMax = [0, 1, 2].map((a) => (step[a] ? (lo[a] + (c[a] + (step[a] > 0 ? 1 : 0)) * cell - o[a]) / d[a] : Infinity));
    const tDelta = [0, 1, 2].map((a) => (step[a] ? cell / Math.abs(d[a]) : Infinity));
    const seen = new Set(), hits = [];
    let best = Infinity;
    for (let guard = 0; guard < 2000; guard++) {
      const l = P.cells.get((c[2] * dims[1] + c[1]) * dims[0] + c[0]);
      if (l) for (const i of l) {
        if (seen.has(i)) continue; seen.add(i);
        const t = hit(P, i, o, d);
        if (t > tmin) { hits.push([t, i]); if (t < best) best = t; }
      }
      const a = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
      if (first && best <= tMax[a]) break;
      if (tMax[a] > t1) break;
      c[a] += step[a]; if (c[a] < 0 || c[a] >= dims[a]) break;
      tMax[a] += tDelta[a];
    }
    hits.sort((x, y) => x[0] - y[0]);
    const out = [];
    for (const h of hits) if (!out.length || h[0] - out[out.length - 1][0] > 1e-6) out.push(h); // an edge hit counts once
    return out;
  }

  // ---------------------------------------------------------------- DFM
  function dfm(mesh, opts = {}) {
    const P = opts.prepared || prepare(mesh);
    const nozzle = opts.nozzle_mm ?? 0.4, warnWall = opts.min_wall_mm ?? 1.2, errWall = opts.error_wall_mm ?? 2 * nozzle;
    // overhang_deg is measured from vertical (as the calibration fins are): a face leaning beta from vertical has
    // -nz = sin(beta), so it needs support when -nz > sin(limit). (Phase 9 fix: cos(limit) was right only at 45 deg.)
    const cosLimit = Math.sin(((opts.overhang_deg ?? 45) * Math.PI) / 180);
    const zmin = P.lo[2];
    const flags = new Uint8Array(P.n); // 0 ok, 1 overhang, 2 thin (warning), 3 too thin (error)
    let overhang = 0, bed = 0, thinWarn = 0, thinErr = 0, minWall = Infinity, total = 0;
    for (let i = 0; i < P.n; i++) {
      const t = i * 9, nz = P.nrm[i * 3 + 2], A = P.area[i]; total += A;
      const zs = [P.tri[t + 2], P.tri[t + 5], P.tri[t + 8]];
      const onBed = Math.max(...zs) < zmin + 0.01;
      if (onBed && nz < -0.999) bed += A;
      else if (nz < -cosLimit && Math.min(...zs) > zmin + 0.05) { flags[i] = 1; overhang += A; }
      // local thickness: cast inward along -normal from the centroid and from points toward each corner
      const nrm = [-P.nrm[i * 3], -P.nrm[i * 3 + 1], -P.nrm[i * 3 + 2]];
      const C = [0, 1, 2].map((a) => (P.tri[t + a] + P.tri[t + 3 + a] + P.tri[t + 6 + a]) / 3);
      const samples = [C];
      if (A > 4 * warnWall * warnWall) for (let k = 0; k < 3; k++) samples.push([0, 1, 2].map((a) => C[a] * 0.4 + P.tri[t + k * 3 + a] * 0.6));
      let th = Infinity;
      for (const s of samples) {
        const h = cast(P, s, nrm, 1e-5, true);
        // only count the opposite wall when it faces back toward us (a real wall, not an edge graze)
        const real = h.find(([, j]) => j !== i && dot(nrm, [P.nrm[j * 3], P.nrm[j * 3 + 1], P.nrm[j * 3 + 2]]) > 0.2);
        if (real) th = Math.min(th, real[0]);
      }
      if (th < minWall) minWall = th;
      if (th < errWall) { flags[i] = 3; thinErr += A; } else if (th < warnWall) { if (flags[i] !== 1) flags[i] = 2; thinWarn += A; }
    }
    const issues = [];
    if (thinErr > 0.5) issues.push({ code: 'WALL_TOO_THIN', severity: 'error', area_mm2: r2(thinErr), message_ar: `أجزاء أرق من ${errWall} مم (خطّان من الفوهة) لن تُطبع بشكل سليم — مساحتها ${r2(thinErr)} مم².`, message: `${r2(thinErr)} mm2 of surface encloses walls thinner than ${errWall} mm (two nozzle widths); they will not print reliably.` });
    if (thinWarn > 0.5) issues.push({ code: 'WALL_THIN', severity: 'warning', area_mm2: r2(thinWarn), message_ar: `جدران بين ${errWall} و${warnWall} مم — تُطبع لكنها ضعيفة.`, message: `${r2(thinWarn)} mm2 of walls are between ${errWall} and ${warnWall} mm thick (weak).` });
    if (overhang > 1) issues.push({ code: 'OVERHANG', severity: 'warning', area_mm2: r2(overhang), message_ar: `سطوح متدلية أكثر من ${opts.overhang_deg ?? 45}° بمساحة ${r2(overhang)} مم² — تحتاج دعامات أو جسرًا قصيرًا.`, message: `${r2(overhang)} mm2 of downward faces overhang more than ${opts.overhang_deg ?? 45} deg (need supports or short bridges).` });
    const foot = (P.hi[0] - P.lo[0]) * (P.hi[1] - P.lo[1]);
    if (bed < Math.max(20, 0.05 * foot)) issues.push({ code: 'SMALL_BED_CONTACT', severity: 'warning', area_mm2: r2(bed), message_ar: `مساحة التلامس مع السطح ${r2(bed)} مم² فقط — خطر الانفصال أو الانقلاب؛ استخدم Brim أو غيّر الاتجاه.`, message: `only ${r2(bed)} mm2 touches the bed (adhesion/tipping risk).` });
    return { flags, issues, stats: { min_wall_mm: Number.isFinite(minWall) ? r2(minWall) : null, overhang_area_mm2: r2(overhang), bed_contact_mm2: r2(bed), thin_area_mm2: r2(thinWarn + thinErr), surface_mm2: r2(total) } };
  }

  // ---------------------------------------------------------------- requirement verification
  // checks: [{label, type:'size', axis, expect, tol}] | [{label, type:'gap'|'wall', at:[x,y,z], axis, expect, tol}] | [{label, type:'empty'|'solid', at}]
  // Coordinates are in MODEL space (as written in the FormaCAD model); `offset` maps them to the placed mesh.
  function probe(P, at, axis) {
    const d = [0, 0, 0]; d[axis] = 1;
    const L = (P.hi[axis] - P.lo[axis]) + 10;
    const results = [];
    for (const j of [[0, 0], [1.3e-3, 0.7e-3], [-0.9e-3, 1.1e-3]]) { // tiny offsets so a line never runs exactly along an edge
      const o = at.slice(); const u = (axis + 1) % 3, w = (axis + 2) % 3; o[u] += j[0]; o[w] += j[1];
      const start = o.slice(); start[axis] = P.lo[axis] - 5;
      const s0 = o[axis] - start[axis];
      const ts = cast(P, start, d, 0, false).map(([t]) => t - s0);
      const c = ts.filter((t) => t <= 0).length;
      const inside = c % 2 === 1;
      const a = c > 0 ? ts[c - 1] : -Infinity, b = c < ts.length ? ts[c] : Infinity;
      results.push({ inside, span: b - a, from: a, to: b });
      void L;
    }
    const insideVotes = results.filter((r) => r.inside).length;
    const inside = insideVotes >= 2;
    const spans = results.filter((r) => r.inside === inside).map((r) => r.span).sort((x, y) => x - y);
    return { inside, span: spans[Math.floor(spans.length / 2)] };
  }

  function verify(mesh, checks, { params = {}, offset = [0, 0, 0], evalExpr, prepared } = {}) {
    if (!Array.isArray(checks) || !checks.length) return [];
    const P = prepared || prepare(mesh);
    const ev = (x, path) => (typeof x === 'number' ? x : evalExpr ? evalExpr(String(x), params, path) : Number(x));
    const AX = { x: 0, y: 1, z: 2 };
    return checks.slice(0, 40).map((c, i) => {
      const label = c.label_ar || c.label || c.requirement || `check ${i + 1}`;
      try {
        const type = String(c.type || '').toLowerCase();
        const tol = c.tol != null ? Math.abs(ev(c.tol, `checks[${i}].tol`)) : 0.1;
        if (type === 'size') {
          const a = AX[c.axis]; if (a === undefined) throw new Error('axis must be x, y or z');
          const measured = P.hi[a] - P.lo[a], expect = ev(c.expect, `checks[${i}].expect`);
          return { label, type, expect: r2(expect), measured: r2(measured), tol, pass: Math.abs(measured - expect) <= tol + 1e-6 };
        }
        if (!Array.isArray(c.at) || c.at.length !== 3) throw new Error('"at" must be [x, y, z]');
        const at = c.at.map((v, k) => ev(v, `checks[${i}].at[${k}]`) + offset[k]);
        if (type === 'empty' || type === 'solid') {
          const { inside } = probe(P, at, 2);
          return { label, type, expect: type === 'solid' ? 'solid' : 'empty', measured: inside ? 'solid' : 'empty', pass: inside === (type === 'solid') };
        }
        if (type === 'gap' || type === 'wall') {
          const a = AX[c.axis]; if (a === undefined) throw new Error('axis must be x, y or z');
          const r = probe(P, at, a), expect = ev(c.expect, `checks[${i}].expect`);
          if (r.inside !== (type === 'wall')) return { label, type, expect: r2(expect), measured: type === 'gap' ? 'solid here' : 'empty here', tol, pass: false, note: 'probe point is not in ' + (type === 'gap' ? 'empty space' : 'material') };
          const m = r.span;
          return { label, type, expect: r2(expect), measured: Number.isFinite(m) ? r2(m) : 'open', tol, pass: Number.isFinite(m) && Math.abs(m - expect) <= tol + 1e-6 };
        }
        throw new Error(`unknown check type "${c.type}"`);
      } catch (e) { return { label, type: c.type, pass: false, error: e.message }; }
    });
  }

  // ---------------------------------------------------------------- print estimate (approximate; the slicer gives the exact figure)
  function estimate(mesh, print = {}, opts = {}) {
    const P = opts.prepared || prepare(mesh);
    const V = Math.abs(mesh.signedVolume()); let A = 0; for (let i = 0; i < P.n; i++) A += P.area[i];
    const material = String(print.material || 'PLA').toUpperCase();
    const rho = DENSITY[material] || 1.24;
    const lh = print.layer_height_mm || 0.2, infill = Math.min(100, Math.max(0, print.infill_percent ?? 20)) / 100;
    const shellT = (opts.walls ?? 3) * 0.42;
    const shell = Math.min(V, A * shellT);
    const used = shell + (V - shell) * infill;                       // mm3 of plastic (no supports)
    const mass = (used / 1000) * rho;                               // g
    const length = used / (Math.PI * 0.875 * 0.875) / 1000;         // m of 1.75 mm filament
    const layers = Math.ceil((P.hi[2] - P.lo[2]) / lh);
    const flow = opts.flow_mm3_s ?? 0.42 * lh * 45;                 // effective mm3/s for an Ender-3 class printer
    const minutes = (used / flow) * 1.25 / 60 + layers * 2 / 60;    // +25% travel/retraction, ~2 s per layer change
    const price = opts.price_per_kg;
    return { material, density_g_cm3: rho, volume_cm3: r2(V / 1000), plastic_cm3: r2(used / 1000), mass_g: r2(mass), filament_m: r2(length), layers, time_min: Math.round(minutes), cost: price ? Math.round((mass / 1000) * price) : null };
  }

  function analyse(mesh, { design = {}, params = {}, offset = [0, 0, 0], evalExpr, dfmOptions, estimateOptions } = {}) {
    const prepared = prepare(mesh);
    return {
      dfm: dfm(mesh, { ...(dfmOptions || {}), prepared }),
      checks: verify(mesh, design.checks, { params, offset, evalExpr, prepared }),
      estimate: estimate(mesh, design.print || {}, { ...(estimateOptions || {}), prepared }),
    };
  }

  const api = { prepare, cast, dfm, verify, estimate, analyse, probe, DENSITY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FormaAnalysis = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
