/*
 * FormaDrawing — engineering drawings generated from the actual mesh (browser + Node).
 *
 *   layout(mesh, meta, opts) -> { sheet, prims, report }
 *     views     front / top / right (+ isometric) by ISO first-angle or ASME third-angle projection
 *     edges     creases (dihedral > 25 deg) and per-view silhouettes; each edge split where its
 *               visibility changes (ray cast toward the viewer): visible = thick, hidden = dashed
 *     dims      overall X/Y/Z measured from the mesh; holes found as circles (closed edge loops fitted
 *               with least squares) and cross-checked by measuring the opening through the solid
 *     sheet     A4..A1 landscape, ISO 5457 frame, ISO 7200-style title block, revision table,
 *               hole table, measured-check table; standard scale chosen to fit
 *     report    fit, overlaps, missing dimensions, drawing-vs-geometry consistency
 *   toSVG(layout)                     preview (same primitives)
 *   toPDF(layout, PDFLib, {rasterize}) vector PDF via pdf-lib; non-Latin text is placed as an image
 *                                     from `rasterize(text, sizeMm)` (a canvas in the browser)
 * Nothing here is invented by a language model: every number printed is read from the geometry.
 */
(function (root) {
  'use strict';
  const AN = typeof module !== 'undefined' && module.exports ? require('./analysis.js') : root.FormaAnalysis;

  const SHEETS = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594] };
  const SCALES = [[10, 1], [5, 1], [2, 1], [1, 1], [1, 2], [1, 5], [1, 10], [1, 20], [1, 50]];
  const LW = { border: 0.7, visible: 0.5, hidden: 0.25, center: 0.18, dim: 0.18, thin: 0.25 };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const isLatin = (s) => /^[\x20-\x7E°±Øø·×]*$/.test(String(s));
  const fmt = (v, p) => (Math.round(v * 10 ** p) / 10 ** p).toFixed(p).replace(/\.?0+$/, '') || '0';

  // ---------------------------------------------------------------- views
  function viewBasis(d, upHint) {
    const right = norm(cross(d, upHint)), up = cross(right, d);
    return { d, right, up };
  }
  const VIEWS = {
    front: viewBasis([0, 1, 0], [0, 0, 1]),
    top: viewBasis([0, 0, -1], [0, 1, 0]),
    right: viewBasis([-1, 0, 0], [0, 0, 1]),
    iso: viewBasis(norm([-1, 1, -1]), [0, 0, 1]),
  };

  // ---------------------------------------------------------------- edges
  function edgeGraph(mesh) {
    const fn = mesh.faces.map((f) => { const [a, b, c] = f.map((i) => mesh.vertices[i]); return norm(cross(sub(b, a), sub(c, a))); });
    const map = new Map();
    mesh.faces.forEach((f, fi) => { for (let k = 0; k < 3; k++) { const a = f[k], b = f[(k + 1) % 3], key = a < b ? a + '|' + b : b + '|' + a; let e = map.get(key); if (!e) map.set(key, (e = { a: Math.min(a, b), b: Math.max(a, b), f: [] })); e.f.push(fi); } });
    const edges = [];
    for (const e of map.values()) {
      const crease = e.f.length !== 2 || dot(fn[e.f[0]], fn[e.f[1]]) < Math.cos((25 * Math.PI) / 180);
      edges.push({ a: e.a, b: e.b, f: e.f, crease });
    }
    return { edges, fn };
  }

  function projectView(mesh, graph, P, view, size) {
    const { d, right, up } = VIEWS[view], V = mesh.vertices;
    const to2 = (p) => [dot(p, right), dot(p, up)];
    const toViewer = [-d[0], -d[1], -d[2]];
    const visible = [], hidden = [], creaseVisible = [];
    const step = size / 60;
    for (const e of graph.edges) {
      let use = e.crease;
      const s1 = e.f.length === 2 ? dot(graph.fn[e.f[0]], d) : 0, s2 = e.f.length === 2 ? dot(graph.fn[e.f[1]], d) : 0;
      // outline: the surface turns from facing the viewer to facing away, or meets a face seen edge-on
      const silhouette = !use && e.f.length === 2 && (s1 * s2 < 0 || (Math.abs(s1) < 1e-6) !== (Math.abs(s2) < 1e-6));
      if (!use && !silhouette) continue;
      const A = V[e.a], B = V[e.b], L = Math.hypot(...sub(B, A));
      if (L < 1e-9) continue;
      // an edge seen exactly end-on projects to a point: skip
      const a2 = to2(A), b2 = to2(B);
      if (Math.hypot(a2[0] - b2[0], a2[1] - b2[1]) < 1e-6) continue;
      const n = Math.max(1, Math.min(12, Math.ceil(L / step)));
      let start = 0, prev = null;
      const vis = [];
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n, p = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
        const hits = AN.cast(P, [p[0] + toViewer[0] * 1e-3, p[1] + toViewer[1] * 1e-3, p[2] + toViewer[2] * 1e-3], toViewer, 2e-3, true);
        vis.push(hits.length === 0);
      }
      for (let k = 0; k <= n; k++) {
        if (k === n || (k > 0 && vis[k] !== vis[k - 1])) {
          const t0 = start / n, t1 = k / n, v = vis[start];
          const p0 = to2([A[0] + (B[0] - A[0]) * t0, A[1] + (B[1] - A[1]) * t0, A[2] + (B[2] - A[2]) * t0]);
          const p1 = to2([A[0] + (B[0] - A[0]) * t1, A[1] + (B[1] - A[1]) * t1, A[2] + (B[2] - A[2]) * t1]);
          (v ? visible : hidden).push([p0, p1]);
          start = k;
        }
      }
      if (e.crease && vis.every(Boolean)) creaseVisible.push([a2, b2]);
      void prev;
    }
    // drop hidden pieces that lie under a visible line (the same edge seen from the front)
    const key = (p) => Math.round(p[0] * 100) + ',' + Math.round(p[1] * 100);
    const visSet = new Set(visible.flatMap(([p, q]) => [key(p) + ';' + key(q), key(q) + ';' + key(p)]));
    const onVisible = (seg) => visSet.has(key(seg[0]) + ';' + key(seg[1]));
    const hid = hidden.filter((s) => !onVisible(s) && !visible.some((v) => collinearCover(v, s)));
    // bounds of the projection (all vertices)
    let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
    for (const v of V) { const q = to2(v); lo = [Math.min(lo[0], q[0]), Math.min(lo[1], q[1])]; hi = [Math.max(hi[0], q[0]), Math.max(hi[1], q[1])]; }
    return { view, visible, hidden: hid, creaseVisible, lo, hi };
  }
  function collinearCover(v, s) {
    // is segment s within 0.01 mm of visible segment v along its whole length?
    const d = (p, a, b) => { const ab = [b[0] - a[0], b[1] - a[1]], l2 = ab[0] ** 2 + ab[1] ** 2 || 1, t = ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2; if (t < -1e-6 || t > 1 + 1e-6) return Infinity; return Math.hypot(a[0] + ab[0] * t - p[0], a[1] + ab[1] * t - p[1]); };
    return d(s[0], v[0], v[1]) < 0.01 && d(s[1], v[0], v[1]) < 0.01;
  }

  // ---------------------------------------------------------------- holes: closed loops fitted with circles
  function circles(view, P, meshBounds) {
    // edges seen end-on (the vertical facet edges of a coarse hole) project to points; they are not part of the rim
    const segs = view.creaseVisible.filter(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-6), key = (p) => Math.round(p[0] * 1000) + ',' + Math.round(p[1] * 1000);
    const adj = new Map(), pt = new Map();
    segs.forEach(([a, b], i) => { for (const p of [a, b]) { const k = key(p); pt.set(k, p); if (!adj.has(k)) adj.set(k, []); adj.get(k).push(i); } });
    const seen = new Set(), out = [];
    segs.forEach((_, i0) => {
      if (seen.has(i0)) return;
      const comp = [], stack = [i0]; seen.add(i0);
      while (stack.length) { const i = stack.pop(); comp.push(i); for (const p of segs[i]) for (const j of adj.get(key(p))) if (!seen.has(j)) { seen.add(j); stack.push(j); } }
      if (comp.length < 8) return;
      const verts = [...new Set(comp.flatMap((i) => segs[i].map(key)))];
      // the near and far rims of a through hole project onto the same circle (often with different vertex splits
      // from the booleans), so the component need not be one simple loop: the fit and the full-turn coverage decide
      const pts = verts.map((k) => pt.get(k));
      // Kasa least-squares circle fit
      let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0; const n = pts.length;
      for (const [x, y] of pts) { const z = x * x + y * y; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z; }
      const M = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], R = [sxz, syz, sz];
      const det3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
      const D = det3(M); if (Math.abs(D) < 1e-12) return;
      const col = (k) => M.map((row, i) => row.map((v, j) => (j === k ? R[i] : v)));
      const A = det3(col(0)) / D, B = det3(col(1)) / D, C = det3(col(2)) / D;
      const cx = A / 2, cy = B / 2, r = Math.sqrt(C + cx * cx + cy * cy);
      const resid = Math.max(...pts.map(([x, y]) => Math.abs(Math.hypot(x - cx, y - cy) - r)));
      if (!(r > 0.3) || resid > Math.max(0.02 * r, 0.05)) return;
      // the points must go all the way round: a rectangle's four corners also sit on one circle
      const ang = pts.map(([x, y]) => Math.atan2(y - cy, x - cx)).sort((a, b) => a - b);
      let maxGap = ang[0] + 2 * Math.PI - ang[ang.length - 1];
      for (let i = 1; i < ang.length; i++) maxGap = Math.max(maxGap, ang[i] - ang[i - 1]);
      if (maxGap > Math.PI / 4 + 1e-6) return;
      // the loop's vertices are polygon corners on the circle; the flat-to-flat opening is r*cos(pi/n)
      out.push({ cx, cy, r, n: pts.length, resid });
    });
    // concentric duplicates (top and bottom rim of a through hole) collapse to one
    const uniq = [];
    for (const c of out) if (!uniq.some((u) => Math.hypot(u.cx - c.cx, u.cy - c.cy) < 0.01 && Math.abs(u.r - c.r) < 0.01)) uniq.push(c);
    void P; void meshBounds;
    return uniq.sort((a, b) => a.cx - b.cx || a.cy - b.cy);
  }

  // ---------------------------------------------------------------- holes along any axis
  // view -> the axis the holes run along, how view (u, v) + depth w map to 3D, and the in-plane axis to measure across
  const HOLE_AXES = {
    top: { ax: 2, uAxis: 0, to3: (u, v, w) => [u, v, w], near: 'TOP', far: 'BOTTOM' },
    front: { ax: 1, uAxis: 0, to3: (u, v, w) => [u, w, v], near: 'FRONT', far: 'BACK' },
    right: { ax: 0, uAxis: 1, to3: (u, v, w) => [w, u, v], near: 'RIGHT', far: 'LEFT' },
  };
  // A fitted circle is a hole only if it opens into the part from one side along the view axis (a boss or a rim is not).
  function classifyHole(P, h, view, prec) {
    const { ax, uAxis, to3, near, far } = HOLE_AXES[view];
    const nearIsHi = view !== 'front'; // the viewer of the front view stands at y = min
    const hit = (u, v, fromHi) => {
      const w0 = fromHi ? P.hi[ax] + 1 : P.lo[ax] - 1, d = [0, 0, 0]; d[ax] = fromHi ? -1 : 1;
      const hs = AN.cast(P, to3(u + 1.3e-3, v + 0.7e-3, w0), d, 0, true);
      return hs.length ? w0 + (fromHi ? -1 : 1) * hs[0][0] : null;
    };
    const out = h.r + Math.max(0.3, 0.1 * h.r);
    let open = null;
    for (const fromHi of [nearIsHi, !nearIsHi]) {
      const wc = hit(h.cx, h.cy, fromHi), rims = [[out, 0], [-out, 0], [0, out], [0, -out]].map(([du, dv]) => hit(h.cx + du, h.cy + dv, fromHi)).filter((z) => z != null);
      if (!rims.length) continue;
      const rim = fromHi ? Math.max(...rims) : Math.min(...rims);
      if (wc == null || (fromHi ? wc < rim - 0.01 : wc > rim + 0.01)) { open = { fromHi, rim, bottom: wc }; break; }
    }
    if (!open) return null;
    const depth = open.bottom == null ? null : Math.abs(open.rim - open.bottom);
    const side = open.fromHi === nearIsHi ? near : far;
    const zm = open.rim + (open.fromHi ? -1 : 1) * Math.min(0.5, depth == null ? 0.5 : depth / 2);
    const m = AN.probe(P, to3(h.cx, h.cy, zm), uAxis);
    return { ...h, view, d: 2 * h.r, depth: depth == null ? 'THRU' : fmt(depth, prec) + (view === 'top' && side === 'BOTTOM' ? ' (BOTTOM)' : view !== 'top' ? ' (' + side + ')' : ''), depthMm: depth, opensFrom: side, measured: !m.inside && Number.isFinite(m.span) ? m.span : null };
  }

  // ---------------------------------------------------------------- section through the solid
  // Plane perpendicular to `axis` at `at`; result in the 2D frame of the view that looks along that axis.
  function sectionOf(mesh, axis, at, to2) {
    const V = mesh.vertices, N = [0, 0, 0]; N[axis] = 1;
    const segs = [];
    for (const f of mesh.faces) {
      const p = f.map((i) => V[i]), d = p.map((q) => q[axis] - at);
      const pts = [];
      for (let k = 0; k < 3; k++) {
        const a = p[k], b = p[(k + 1) % 3], da = d[k], db = d[(k + 1) % 3];
        if ((da < 0 && db >= 0) || (da >= 0 && db < 0)) { const t = da / (da - db); pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); }
      }
      if (pts.length !== 2) continue;
      // orient the segment by (face normal x plane normal) so all loops share one orientation (outer vs holes)
      const n = cross(sub(p[1], p[0]), sub(p[2], p[0])), t = cross(n, N);
      const q0 = pts[0], q1 = pts[1];
      segs.push(dot(sub(q1, q0), t) >= 0 ? [to2(q0), to2(q1)] : [to2(q1), to2(q0)]);
    }
    // chain into closed loops
    const key = (q) => Math.round(q[0] * 1e4) + ',' + Math.round(q[1] * 1e4);
    const from = new Map();
    segs.forEach((sg, i) => { const k = key(sg[0]); if (!from.has(k)) from.set(k, []); from.get(k).push(i); });
    const used = new Set(), loops = [];
    for (let i = 0; i < segs.length; i++) {
      if (used.has(i)) continue;
      const loop = [segs[i][0]]; let cur = i;
      for (let guard = 0; guard < segs.length + 2; guard++) {
        used.add(cur); loop.push(segs[cur][1]);
        const nxt = (from.get(key(segs[cur][1])) || []).find((j) => !used.has(j));
        if (nxt === undefined) break;
        cur = nxt;
      }
      if (loop.length > 3 && key(loop[0]) === key(loop[loop.length - 1])) loops.push(loop.slice(0, -1));
    }
    const area2 = (L) => { let a = 0; for (let k = 0; k < L.length; k++) { const p = L[k], q = L[(k + 1) % L.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
    const net = Math.abs(loops.reduce((a, L) => a + area2(L), 0));
    return { loops, area: net, segments: segs.length };
  }
  // 45-degree hatch lines inside the loops (even-odd), spacing in sheet mm already applied by the caller
  function hatch(loops, spacing) {
    const c = Math.SQRT1_2, rot = ([x, y]) => [c * x + c * y, -c * x + c * y], back = ([u, v]) => [c * u - c * v, c * u + c * v];
    const R = loops.map((L) => L.map(rot));
    let lo = Infinity, hi = -Infinity;
    for (const L of R) for (const p of L) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }
    const out = [];
    for (let v = Math.ceil(lo / spacing) * spacing + spacing / 2; v < hi; v += spacing) {
      const xs = [];
      for (const L of R) for (let k = 0; k < L.length; k++) {
        const p = L[k], q = L[(k + 1) % L.length];
        if ((p[1] <= v && q[1] > v) || (q[1] <= v && p[1] > v)) xs.push(p[0] + ((v - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) if (xs[k + 1] - xs[k] > 1e-6) out.push([back([xs[k], v]), back([xs[k + 1], v])]);
    }
    return out;
  }
  // planar datum faces: area of mesh faces lying in the extreme plane of an axis with an outward normal
  function datumFace(mesh, axis, sign, P) {
    const at = sign < 0 ? P.lo[axis] : P.hi[axis];
    let area = 0;
    for (const f of mesh.faces) {
      const p = f.map((i) => mesh.vertices[i]);
      if (!p.every((q) => Math.abs(q[axis] - at) < 1e-6)) continue;
      const n = cross(sub(p[1], p[0]), sub(p[2], p[0])), l = Math.hypot(...n);
      if (l > 0 && n[axis] * sign / l > 0.999) area += l / 2;
    }
    return area;
  }

  // ---------------------------------------------------------------- layout on the sheet
  function layout(mesh, meta = {}, opts = {}) {
    const sheetName = opts.sheet && SHEETS[opts.sheet] ? opts.sheet : 'A4';
    const [SW, SH] = SHEETS[sheetName];
    const standard = opts.standard === 'ASME' ? 'ASME' : 'ISO';
    const firstAngle = opts.projection ? opts.projection === 'first' : standard === 'ISO';
    const prec = opts.precision ?? 2;
    const tolText = opts.tolerance || (standard === 'ISO' ? 'ISO 2768-m' : 'UNLESS NOTED: X.X ±0.1  X.XX ±0.05');
    const P = AN.prepare(mesh);
    const size = Math.max(P.hi[0] - P.lo[0], P.hi[1] - P.lo[1], P.hi[2] - P.lo[2]);
    const graph = edgeGraph(mesh);
    const views = { front: projectView(mesh, graph, P, 'front', size), top: projectView(mesh, graph, P, 'top', size), right: projectView(mesh, graph, P, 'right', size), iso: projectView(mesh, graph, P, 'iso', size) };
    const dimsMm = { x: P.hi[0] - P.lo[0], y: P.hi[1] - P.lo[1], z: P.hi[2] - P.lo[2] };

    // frame and reserved areas
    const frame = { x0: 20, y0: 10, x1: SW - 10, y1: SH - 10 };
    const tb = { w: 180, h: 46 };
    // holes along Z (seen in the top view), then along Y (front view) and along X (right view)
    const holeList = [...circles(views.top, P).map((h) => classifyHole(P, h, 'top', prec)), ...circles(views.front, P).map((h) => classifyHole(P, h, 'front', prec)), ...circles(views.right, P).map((h) => classifyHole(P, h, 'right', prec))]
      .filter(Boolean).map((c, i) => ({ ...c, id: 'H' + (i + 1) }));
    const topHoles = holeList.filter((h) => h.view === 'top');
    // section A-A: plane perpendicular to Y through the first row of top holes (else the middle), seen like the front view
    const wantSection = opts.section !== false && (opts.section === true || holeList.length > 0 || views.front.hidden.length > 0);
    const secAt = topHoles.length ? topHoles[0].cy + 1e-4 : (P.lo[1] + P.hi[1]) / 2 + 1e-4;
    const section = wantSection ? sectionOf(mesh, 1, secAt, (q) => [q[0], q[2]]) : null;
    const hasSection = !!(section && section.loops.length);
    // datums where the geometry offers a real planar face: A bottom, B back (y min), C left (x min)
    const datum = {
      A: datumFace(mesh, 2, -1, P) >= 0.3 * (P.hi[0] - P.lo[0]) * (P.hi[1] - P.lo[1]),
      B: datumFace(mesh, 1, -1, P) >= 0.2 * (P.hi[0] - P.lo[0]) * (P.hi[2] - P.lo[2]),
      C: datumFace(mesh, 0, -1, P) >= 0.2 * (P.hi[1] - P.lo[1]) * (P.hi[2] - P.lo[2]),
    };
    const gdtOn = opts.gdt !== false;
    const checks = (meta.checks || []).slice(0, 12);
    const sideW = holeList.length || checks.length ? 78 : 0;
    const area = { x0: frame.x0 + 12, y0: frame.y0 + tb.h + 14, x1: frame.x1 - 12 - sideW, y1: frame.y1 - 12 };
    const gap = 26;
    const W = (v) => views[v].hi[0] - views[v].lo[0], H = (v) => views[v].hi[1] - views[v].lo[1];
    const secW = () => (hasSection ? W('front') : 0);
    const needW = (s) => s * (W('front') + W('right') + secW()) + gap * (hasSection ? 2 : 1) + 32, needH = (s) => s * (H('front') + H('top')) + gap + 32 + (gdtOn ? 8 : 0); // 16 mm each side for the dimension lines
    let scale = null;
    for (const [a, b] of SCALES) { const s = a / b; if (needW(s) <= area.x1 - area.x0 && needH(s) <= area.y1 - area.y0) { scale = [a, b]; break; } }
    const report = { sheet: sheetName, standard, projection: firstAngle ? 'first-angle' : 'third-angle', fits: !!scale, overlaps: [], missing: [], consistency: [], warnings: [] };
    if (!scale) { report.warnings.push(`the part (${fmt(dimsMm.x, 1)} x ${fmt(dimsMm.y, 1)} x ${fmt(dimsMm.z, 1)} mm) does not fit ${sheetName} at any standard scale; choose a larger sheet`); scale = SCALES[SCALES.length - 1]; }
    const s = scale[0] / scale[1], scaleText = `${scale[0]}:${scale[1]}`;

    // grid placement (sheet mm, y up)
    const colFrontW = s * W('front'), colSideW = s * W('right'), rowFrontH = s * H('front'), rowTopH = s * H('top');
    const colSecW = hasSection ? s * secW() + gap : 0;
    const totalW = colFrontW + colSideW + gap + colSecW, totalH = rowFrontH + rowTopH + gap;
    const ox = area.x0 + (area.x1 - area.x0 - totalW) / 2, oy = area.y0 + (area.y1 - area.y0 - totalH) / 2;
    const place = {};
    if (firstAngle) {
      place.right = [ox, oy + rowTopH + gap]; place.front = [ox + colSideW + gap, oy + rowTopH + gap]; place.top = [ox + colSideW + gap, oy];
      if (hasSection) place.section = [place.front[0] + colFrontW + gap, place.front[1]];
    } else {
      place.front = [ox, oy]; place.right = [ox + colFrontW + gap, oy]; place.top = [ox, oy + rowFrontH + gap];
      if (hasSection) place.section = [place.right[0] + colSideW + gap, oy];
    }
    const prims = [];
    const line = (a, b, w, style) => prims.push({ t: 'line', a, b, w, style });
    const text = (x, y, str, size, anchor = 'start', extra = {}) => prims.push({ t: 'text', x, y, s: String(str), size, anchor, ...extra });
    const tx = (v, p) => [place[v][0] + (p[0] - views[v].lo[0]) * s, place[v][1] + (p[1] - views[v].lo[1]) * s];
    // label placement that avoids every text already on the sheet (first free candidate wins)
    // texts, plus GD&T boxes and datum triangles (labels must not sit on them either)
    const placed = () => [...prims.filter((p) => p.t === 'text').map(textBox),
      ...prims.filter((p) => p.t === 'poly').map((p) => ({ x0: Math.min(...p.pts.map((q) => q[0])), x1: Math.max(...p.pts.map((q) => q[0])), y0: Math.min(...p.pts.map((q) => q[1])), y1: Math.max(...p.pts.map((q) => q[1])) })),
      ...prims.filter((p) => p.t === 'line' && p.style === 'gdt').map((p) => ({ x0: Math.min(p.a[0], p.b[0]) - 0.3, x1: Math.max(p.a[0], p.b[0]) + 0.3, y0: Math.min(p.a[1], p.b[1]) - 0.3, y1: Math.max(p.a[1], p.b[1]) + 0.3 }))];
    const placeText = (cands, str, size, extra) => {
      const taken = placed();
      for (const [x, y, anchor] of cands) { const b = textBox({ x, y, s: str, size, anchor }); if (!taken.some((t) => overlap(t, b))) { text(x, y, str, size, anchor, extra); return [x, y]; } }
      const [x, y, anchor] = cands[0]; text(x, y, str, size, anchor, extra); return [x, y];
    };

    const viewLabels = [];
    for (const v of ['front', 'top', 'right']) {
      for (const [a, b] of views[v].hidden) line(tx(v, a), tx(v, b), LW.hidden, 'hidden');
      for (const [a, b] of views[v].visible) line(tx(v, a), tx(v, b), LW.visible, 'visible');
      viewLabels.push(v);
    }
    // isometric in the free grid cell, scaled to fit it
    const cell = firstAngle ? { x0: ox, y0: oy, x1: ox + colSideW, y1: oy + rowTopH } : { x0: ox + colFrontW + gap, y0: oy + rowFrontH + gap, x1: ox + colFrontW + gap + colSideW, y1: oy + totalH };
    const isoW = W('iso'), isoH = H('iso');
    const isoS = Math.min(s, Math.max(cell.x1 - cell.x0, 30) / isoW, Math.max(cell.y1 - cell.y0, 30) / isoH);
    if (isoS > 0) {
      const ix = cell.x0 + (cell.x1 - cell.x0 - isoW * isoS) / 2, iy = cell.y0 + (cell.y1 - cell.y0 - isoH * isoS) / 2;
      for (const [a, b] of views.iso.visible) line([ix + (a[0] - views.iso.lo[0]) * isoS, iy + (a[1] - views.iso.lo[1]) * isoS], [ix + (b[0] - views.iso.lo[0]) * isoS, iy + (b[1] - views.iso.lo[1]) * isoS], LW.hidden, 'visible');
      text(ix, iy - 4.5, Math.abs(isoS - s) < 1e-9 ? 'ISOMETRIC' : 'ISOMETRIC (NOT TO SCALE)', 2.5, 'start', { role: 'label' });
    }

    // ---- dimensions (values read from the mesh bounds)
    const dimH = (v, value, side) => { // horizontal dimension of view v's full width
      const [x0, y0] = place[v], w = s * W(v), h = s * H(v);
      const y = side === 'below' ? y0 - 10 : y0 + h + 10;
      line([x0, side === 'below' ? y0 - 2 : y0 + h + 2], [x0, side === 'below' ? y - 2 : y + 2], LW.dim, 'dim');
      line([x0 + w, side === 'below' ? y0 - 2 : y0 + h + 2], [x0 + w, side === 'below' ? y - 2 : y + 2], LW.dim, 'dim');
      prims.push({ t: 'dimline', a: [x0, y], b: [x0 + w, y], w: LW.dim });
      text(x0 + w / 2, y + 1.2, fmt(value, prec), 3.5, 'middle', { role: 'dim', value });
    };
    const dimV = (v, value, side) => {
      const [x0, y0] = place[v], w = s * W(v), h = s * H(v);
      const x = side === 'left' ? x0 - 10 : x0 + w + 10;
      line([side === 'left' ? x0 - 2 : x0 + w + 2, y0], [side === 'left' ? x - 2 : x + 2, y0], LW.dim, 'dim');
      line([side === 'left' ? x0 - 2 : x0 + w + 2, y0 + h], [side === 'left' ? x - 2 : x + 2, y0 + h], LW.dim, 'dim');
      prims.push({ t: 'dimline', a: [x, y0], b: [x, y0 + h], w: LW.dim });
      text(x - 1.2, y0 + h / 2, fmt(value, prec), 3.5, 'middle', { role: 'dim', value, rotate: 90 });
    };
    dimH('front', dimsMm.x, firstAngle ? 'above' : 'below');
    dimV('front', dimsMm.z, firstAngle ? 'right' : 'left');
    dimV('top', dimsMm.y, firstAngle ? 'right' : 'left');

    // ---- GD&T where the geometry supports it: datums on real planar faces, flatness of A, position of the top holes to A|B|C
    report.gdt = { datums: [], frames: [], note: 'tolerance values are defaults (opts.gdt); the designer confirms them' };
    const gdtTol = Object.assign({ flatness: 0.1, position: 0.2 }, typeof opts.gdt === 'object' ? opts.gdt : {});
    const datumSymbol = (x, y, letter, dir) => { // filled triangle on the face, leader, boxed letter
      const t = [[x - 1.5, y], [x + 1.5, y], [x, y + 2 * dir]];
      prims.push({ t: 'poly', pts: t, fill: true, w: LW.thin });
      const by = y + 2 * dir + (dir > 0 ? 2 : -7);
      line([x, y + 2 * dir], [x, by + (dir > 0 ? 0 : 5)], LW.thin, 'dim');
      rectP(x - 2.5, by, x + 2.5, by + 5);
      text(x, by + 1.3, letter, 3, 'middle', { role: 'datum' });
    };
    const rectP = (x0, y0, x1, y1) => { line([x0, y0], [x1, y0], LW.thin, 'gdt'); line([x1, y0], [x1, y1], LW.thin, 'gdt'); line([x1, y1], [x0, y1], LW.thin, 'gdt'); line([x0, y1], [x0, y0], LW.thin, 'gdt'); };
    const fcf = (x, y, kind, cells) => { // feature control frame: symbol cell + text cells, 5 mm high
      let cx = x;
      rectP(cx, y, cx + 6, y + 5);
      if (kind === 'position') { prims.push({ t: 'circle', c: [cx + 3, y + 2.5], r: 1.3, w: LW.thin }); line([cx + 0.8, y + 2.5], [cx + 5.2, y + 2.5], LW.thin, 'frame'); line([cx + 3, y + 0.3], [cx + 3, y + 4.7], LW.thin, 'frame'); }
      else { line([cx + 1.8, y + 1.3], [cx + 5, y + 1.3], LW.thin, 'frame'); line([cx + 5, y + 1.3], [cx + 4.2, y + 3.7], LW.thin, 'frame'); line([cx + 4.2, y + 3.7], [cx + 1, y + 3.7], LW.thin, 'frame'); line([cx + 1, y + 3.7], [cx + 1.8, y + 1.3], LW.thin, 'frame'); }
      cx += 6;
      for (const c of cells) { const w = Math.max(6, c.length * 1.9 + 2); rectP(cx, y, cx + w, y + 5); text(cx + w / 2, y + 1.4, c, 2.8, 'middle', { role: 'gdt' }); cx += w; }
      return cx;
    };
    if (gdtOn) {
      const [fx0, fy0] = place.front, fw = s * W('front'), [tx0, ty0] = place.top, th = s * H('top');
      if (datum.A) { datumSymbol(fx0 + fw * 0.25, fy0, 'A', -1); report.gdt.datums.push('A'); fcf(fx0 + fw * 0.25 + 5, fy0 - 7.5, 'flatness', [fmt(gdtTol.flatness, 3)]); report.gdt.frames.push({ type: 'flatness', tol: gdtTol.flatness, feature: 'A' }); }
      if (datum.B) { datumSymbol(tx0 + s * W('top') * 0.75, ty0, 'B', -1); report.gdt.datums.push('B'); }
      if (datum.C) { line([tx0, ty0 + th * 0.3], [tx0 - 3, ty0 + th * 0.3], LW.thin, 'dim'); prims.push({ t: 'poly', pts: [[tx0, ty0 + th * 0.3 - 1.5], [tx0, ty0 + th * 0.3 + 1.5], [tx0 - 2, ty0 + th * 0.3]], fill: true, w: LW.thin }); rectP(tx0 - 8, ty0 + th * 0.3 - 2.5, tx0 - 3, ty0 + th * 0.3 + 2.5); text(tx0 - 5.5, ty0 + th * 0.3 - 1.2, 'C', 3, 'middle', { role: 'datum' }); report.gdt.datums.push('C'); }
    }

    // ---- section A-A (cut face hatched) and its cutting plane in the top view
    const cutLetters = [];
    let cutY = 0;
    if (hasSection) {
      const [sx0, sy0] = place.section, lo = views.front.lo;
      const T2 = (q) => [sx0 + (q[0] - lo[0]) * s, sy0 + (q[1] - lo[1]) * s];
      for (const L of section.loops) for (let k = 0; k < L.length; k++) line(T2(L[k]), T2(L[(k + 1) % L.length]), LW.visible, 'visible');
      for (const [a2, b2] of hatch(section.loops.map((L) => L.map(T2)), 2)) line(a2, b2, LW.thin * 0.7, 'hatch');
      text(sx0, sy0 - 4.5, 'SECTION A-A', 2.5, 'start', { role: 'label' });
      const yTop = tx('top', [0, secAt])[1];
      cutY = yTop;
      const xa = place.top[0] - 5, xb = place.top[0] + s * W('top') + 5;
      line([xa, yTop], [xb, yTop], LW.center, 'center');
      for (const xe of [xa, xb]) { line([xe, yTop], [xe, yTop + 4], LW.visible, 'visible'); prims.push({ t: 'dimline', a: [xe, yTop + 4.2], b: [xe, yTop + 0.6], w: LW.dim, single: true }); cutLetters.push(xe); }
      report.section = { plane: 'y', at_mm: +fmt(secAt - P.lo[1], prec), area_mm2: +fmt(section.area, prec), loops: section.loops.length };
      for (const xe of cutLetters) placeText([[xe, cutY + 5.2, 'middle'], [xe, cutY - 4.5, 'middle'], [xe + (xe < place.top[0] ? -2 : 2), cutY + 1, xe < place.top[0] ? 'end' : 'start'], [xe, cutY - 9, 'middle']], 'A', 3, { role: 'label' });
    }

    // ---- holes: centre marks in their view, ID labels placed clear of other text, one diameter callout per size
    const groups = new Map();
    for (const h of holeList) {
      const [cx, cy] = tx(h.view, [h.cx, h.cy]), r = h.r * s, e = r * 0.75 + 1;
      line([cx - r - 2, cy], [cx + r + 2, cy], LW.center, 'center');
      line([cx, cy - r - 2], [cx, cy + r + 2], LW.center, 'center');
      placeText([[cx + e, cy + e, 'start'], [cx - e, cy + e, 'end'], [cx + e, cy - e - 2.5, 'start'], [cx - e, cy - e - 2.5, 'end']], h.id, 2.5, { role: 'hole-id' });
      const g = `${h.view}|${fmt(h.d, prec)}|${h.depth}`;
      h.group = g;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(h);
      report.consistency.push({ item: `${h.id} diameter`, drawing: +fmt(h.d, prec), geometry: h.measured == null ? null : +fmt(h.measured, prec), ok: h.measured != null && Math.abs(h.measured - h.d) <= Math.max(0.05, h.d * (1 - Math.cos(Math.PI / h.n)) + 0.01) });
    }
    for (const [gkey, list] of groups) {
      const h = list[0], [cx, cy] = tx(h.view, [h.cx, h.cy]), r = h.r * s;
      const label = `${list.length > 1 ? list.length + 'X ' : ''}Ø${fmt(h.d, prec)} ${h.depth.startsWith('THRU') ? h.depth : '↧' + h.depth}`.replace('↧', 'DEPTH ');
      const ang = Math.PI / 4, ex = cx + r * Math.cos(ang), ey = cy + r * Math.sin(ang);
      const [lx, ly] = placeText([[ex + 6, ey + 6, 'start'], [ex + 6, ey - 9, 'start'], [cx - r - 8, ey + 6, 'end'], [cx - r - 8, cy - r - 9, 'end']], label, 2.5, { role: 'callout', value: h.d, group: gkey });
      line([ex, ey], [lx + (lx < ex ? 1 : -1), ly + 1], LW.dim, 'dim');
    }

    // ---- baseline dimensions of the top-view hole positions from datums C (left) and B (back) when they stay readable
    const ux = [...new Set(topHoles.map((h) => fmt(h.cx - views.top.lo[0], prec)))].map(Number).sort((a, b) => a - b);
    const uy = [...new Set(topHoles.map((h) => fmt(h.cy - views.top.lo[1], prec)))].map(Number).sort((a, b) => a - b);
    report.positionDims = { x: [], y: [], inTableOnly: false };
    if (topHoles.length && ux.length <= 3 && uy.length <= 3) {
      const [x0, y0] = place.top, h0 = s * H('top'), w0 = s * W('top'), below = firstAngle;
      ux.forEach((v, k) => {
        const y = below ? y0 - 8 - k * 6 : y0 + h0 + 8 + k * 6, xe = x0 + v * s;
        line([x0, below ? y0 - 2 : y0 + h0 + 2], [x0, below ? y - 2 : y + 2], LW.dim, 'dim');
        line([xe, below ? y0 - 2 : y0 + h0 + 2], [xe, below ? y - 2 : y + 2], LW.dim, 'dim');
        prims.push({ t: 'dimline', a: [x0, y], b: [xe, y], w: LW.dim });
        text(x0 + (xe - x0) / 2, y + 1.2, fmt(v, prec), 3, 'middle', { role: 'posdim', value: v });
        report.positionDims.x.push(v);
      });
      uy.forEach((v, k) => {
        const x = firstAngle ? x0 - 8 - k * 6 : x0 + w0 + 8 + k * 6, ye = y0 + v * s;
        line([firstAngle ? x0 - 2 : x0 + w0 + 2, y0], [firstAngle ? x - 2 : x + 2, y0], LW.dim, 'dim');
        line([firstAngle ? x0 - 2 : x0 + w0 + 2, ye], [firstAngle ? x - 2 : x + 2, ye], LW.dim, 'dim');
        prims.push({ t: 'dimline', a: [x, y0], b: [x, ye], w: LW.dim });
        text(x - 1.2, y0 + (ye - y0) / 2, fmt(v, prec), 3, 'middle', { role: 'posdim', value: v, rotate: 90 });
        report.positionDims.y.push(v);
      });
    } else if (topHoles.length) report.positionDims.inTableOnly = true;

    if (gdtOn) {
      const refs = ['A', 'B', 'C'].filter((k) => datum[k]);
      if (topHoles.length && refs.length === 3) {
        const cl = prims.filter((p) => p.role === 'callout').find((p) => topHoles.some((h) => p.group === h.group));
        if (cl) {
          const cells = ['Ø' + fmt(gdtTol.position, 3) + ' M', 'A', 'B', 'C'], fw = 6 + cells.reduce((a, c) => a + Math.max(6, c.length * 1.9 + 2), 0);
          const box = (x, y) => ({ x0: x, x1: x + fw, y0: y, y1: y + 5 });
          const lineBoxes = prims.filter((p) => p.t === 'line' && p.style !== 'hatch').map((p) => ({ x0: Math.min(p.a[0], p.b[0]), x1: Math.max(p.a[0], p.b[0]), y0: Math.min(p.a[1], p.b[1]), y1: Math.max(p.a[1], p.b[1]) }));
          const x0 = cl.anchor === 'end' ? cl.x - fw : cl.x;
          const cands = [[x0, cl.y - 6.5], [x0, cl.y + 3.5], [x0, cl.y - 13], [x0, cl.y + 10], [x0 - fw / 2, cl.y - 6.5]];
          const free = cands.find(([x, y]) => { const b = box(x, y); return !placed().some((t) => overlap(t, b)) && !lineBoxes.some((l) => overlap(l, b)); }) || cands[0];
          fcf(free[0], free[1], 'position', cells);
          report.gdt.frames.push({ type: 'position', tol: gdtTol.position, refs, features: topHoles.map((h) => h.id) });
        }
      } else if (topHoles.length) report.gdt.note += '; hole position not toleranced: the part lacks a planar datum face (' + ['A', 'B', 'C'].filter((k) => !datum[k]).join(', ') + ')';
    }

    // ---- position dimensions must match the hole centres they locate
    for (const v of report.positionDims.x) report.consistency.push({ item: `hole X ${v}`, drawing: v, geometry: v, ok: topHoles.some((h) => Math.abs(h.cx - views.top.lo[0] - v) < 10 ** -prec) });
    for (const v of report.positionDims.y) report.consistency.push({ item: `hole Y ${v}`, drawing: v, geometry: v, ok: topHoles.some((h) => Math.abs(h.cy - views.top.lo[1] - v) < 10 ** -prec) });
    // ---- consistency of the printed overall dimensions with the geometry
    for (const [ax, label] of [['x', 'overall X'], ['y', 'overall Y'], ['z', 'overall Z']]) {
      const printed = prims.find((p) => p.role === 'dim' && Math.abs(p.value - dimsMm[ax]) < 1e-9);
      report.consistency.push({ item: label, drawing: printed ? +fmt(printed.value, prec) : null, geometry: +fmt(dimsMm[ax], prec), ok: !!printed });
      if (!printed) report.missing.push(label);
    }

    // view names and the section letters go last, each in the first spot that is free of other text
    for (const v of viewLabels) {
      const [x0, y0] = place[v], w = s * W(v), h = s * H(v), lbl = { front: 'FRONT', top: 'TOP', right: 'RIGHT' }[v];
      placeText([[x0, y0 - 4.5, 'start'], [x0 + w, y0 - 4.5, 'end'], [x0, y0 + h + 2, 'start'], [x0 + w, y0 + h + 2, 'end'], [x0, y0 - 28, 'start']], lbl, 2.5, { role: 'label' });
    }

    // ---- frame, projection symbol, title block, tables
    const rect = (x0, y0, x1, y1, w) => { line([x0, y0], [x1, y0], w, 'frame'); line([x1, y0], [x1, y1], w, 'frame'); line([x1, y1], [x0, y1], w, 'frame'); line([x0, y1], [x0, y0], w, 'frame'); };
    rect(frame.x0, frame.y0, frame.x1, frame.y1, LW.border);
    const T = { x0: frame.x1 - tb.w, y0: frame.y0, x1: frame.x1, y1: frame.y0 + tb.h };
    rect(T.x0, T.y0, T.x1, T.y1, LW.border);
    const rows = [T.y0 + 9, T.y0 + 18, T.y0 + 27, T.y0 + 36];
    rows.forEach((y) => line([T.x0, y], [T.x1, y], LW.thin, 'frame'));
    const cols = [T.x0 + 60, T.x0 + 105, T.x0 + 140];
    cols.forEach((x) => line([x, T.y0], [x, T.y0 + 36], LW.thin, 'frame'));
    // cell = the band whose TOP line is `ry` (9 mm high): small label at the top, value below it
    // values longer than their cell are condensed to the cell width (maxW) when drawn, never spilled into the next cell
    const cellText = (cx, ry, labelTxt, value, size = 3) => { const nx = [...cols, T.x1].find((c) => c > cx + 1); text(cx + 1.5, ry - 2.6, labelTxt, 1.8, 'start', { role: 'tb-label' }); text(cx + 1.5, ry - 8 + 1.6, value, size, 'start', { role: 'tb-value', maxW: nx - cx - 3 }); };
    const date = meta.date || new Date().toISOString().slice(0, 10);
    cellText(T.x0, rows[0], 'DRAWN BY', meta.designer || '-');
    cellText(cols[0], rows[0], 'DATE', date);
    cellText(cols[1], rows[0], 'SCALE', scaleText);
    cellText(cols[2], rows[0], 'SHEET', '1 / 1');
    cellText(T.x0, rows[1], 'MATERIAL', meta.material || '-');
    cellText(cols[0], rows[1], 'UNITS', 'mm');
    cellText(cols[1], rows[1], 'SIZE', sheetName);
    cellText(cols[2], rows[1], 'REV', String(meta.revision ?? 1));
    cellText(T.x0, rows[2], 'GENERAL TOLERANCES', tolText, 2.4);
    cellText(cols[0], rows[2], 'APPROVED', meta.approvedBy || '-');
    cellText(cols[1], rows[2], 'DRAWING No.', meta.drawingNo || 'FD-' + (meta.projectId || 'DRAFT').slice(-8).toUpperCase(), 2.6);
    cellText(T.x0, rows[3], 'PROJECT', meta.project || '-');
    cellText(cols[1], rows[3], 'PROJECTION', firstAngle ? 'FIRST ANGLE (ISO E)' : 'THIRD ANGLE (ASME)', 2.2);
    text(T.x0 + 2, rows[3] + 3, meta.title || 'PART', 5, 'start', { role: 'title', maxW: tb.w - 32 });
    text(T.x1 - 2, rows[3] + 3.4, 'FORMA·3D', 4, 'end', { role: 'brand' });
    // projection symbol (truncated cone) in its own cell: two views, order set by the projection method
    const sx = cols[2] + 9, sy = rows[3] - 4.5;
    // ISO 128 / ASME Y14.3: the cone's large end faces right in both; first angle = cone left of the circles,
    // third angle = circles left of the cone (narrow end pointing at them)
    const cone = (x) => { line([x, sy - 1.5], [x + 5, sy - 2.5], LW.thin, 'frame'); line([x + 5, sy - 2.5], [x + 5, sy + 2.5], LW.thin, 'frame'); line([x + 5, sy + 2.5], [x, sy + 1.5], LW.thin, 'frame'); line([x, sy + 1.5], [x, sy - 1.5], LW.thin, 'frame'); };
    const circ = (x) => prims.push({ t: 'circle', c: [x, sy], r: 2.5, w: LW.thin }, { t: 'circle', c: [x, sy], r: 1.5, w: LW.thin });
    if (firstAngle) { cone(sx); circ(sx + 10.5); } else { circ(sx + 2.5); cone(sx + 8); }

    // revision table above the title block
    const revs = (meta.revisions || []).slice(-4);
    let ry = T.y1;
    if (revs.length) {
      const rx0 = T.x0, rx1 = T.x1;
      rect(rx0, ry, rx1, ry + 6 + revs.length * 5, LW.thin);
      const rc = [rx0 + 1.5, rx0 + 12, rx0 + 36];
      ['REV', 'DATE', 'DESCRIPTION'].forEach((h, k) => text(rc[k], ry + 2 + revs.length * 5, h, 2.2, 'start', { role: 'table-head' }));
      revs.slice().reverse().forEach((r, i) => { text(rc[0], ry + 2 + i * 5, String(r.rev), 2.2, 'start', { role: 'table' }); text(rc[1], ry + 2 + i * 5, String(r.date), 2.2, 'start', { role: 'table' }); text(rc[2], ry + 2 + i * 5, String(r.note || '').slice(0, 70), 2.2, 'start', { role: 'table' }); });
      ry += 6 + revs.length * 5;
    }
    // side tables: holes, then measured checks
    let tyTop = frame.y1 - 12;
    const tx0 = frame.x1 - 10 - sideW + 4, tx1 = frame.x1 - 4;
    if (holeList.length) {
      text(tx0, tyTop, 'HOLE TABLE (FROM LOWER LEFT OF EACH VIEW)', 2.2, 'start', { role: 'table-head' });
      const hc = [tx0, tx0 + 7, tx0 + 19, tx0 + 31, tx0 + 43, tx0 + 56];
      ['ID', 'VIEW', 'H', 'V', 'DIA', 'DEPTH'].forEach((h, k) => text(hc[k], tyTop - 5, h, 2.2, 'start', { role: 'table-head' }));
      holeList.forEach((h, i) => { const y = tyTop - 10 - i * 4.5; [h.id, h.view.toUpperCase(), fmt(h.cx - views[h.view].lo[0], prec), fmt(h.cy - views[h.view].lo[1], prec), 'Ø' + fmt(h.d, prec), h.depth.replace(/ \((FRONT|BACK|RIGHT|LEFT|BOTTOM)\)/, (m, w) => ' ' + w[0])].forEach((v, k) => text(hc[k], y, v, 2.2, 'start', { role: 'table', maxW: k === 5 ? frame.x1 - 4 - hc[5] : undefined })); });
      tyTop -= 16 + holeList.length * 4.5;
    }
    if (checks.length) {
      text(tx0, tyTop, 'MEASURED ON THE EXPORTED MESH', 2.2, 'start', { role: 'table-head' });
      checks.forEach((c, i) => {
        const y = tyTop - 6 - i * 4.5;
        text(tx0, y, `${i + 1}.`, 2.2, 'start', { role: 'table' });
        text(tx0 + 5, y, c.label, 2.2, 'start', { role: 'table' });
        const val = typeof c.measured === 'number' ? fmt(c.measured, prec) : String(c.measured ?? '-');
        text(tx1 - 12, y, val, 2.2, 'end', { role: 'table' });
        text(tx1, y, c.pass ? 'OK' : 'NOT OK', 2.2, 'end', { role: 'table' });
      });
    }
    void ry;

    // ---- validation: everything inside the frame, no overlapping text
    const boxes = prims.filter((p) => p.t === 'text').map((p) => textBox(p));
    for (const p of prims) {
      const pts = p.t === 'text' ? [[textBox(p).x0, textBox(p).y0], [textBox(p).x1, textBox(p).y1]] : p.t === 'circle' ? [[p.c[0] - p.r, p.c[1] - p.r], [p.c[0] + p.r, p.c[1] + p.r]] : p.t === 'poly' ? p.pts : [p.a, p.b];
      if (pts.some(([x, y]) => x < frame.x0 - 0.01 || x > frame.x1 + 0.01 || y < frame.y0 - 0.01 || y > frame.y1 + 0.01)) { report.fits = false; report.warnings.push('a drawing element lies outside the frame'); break; }
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (overlap(boxes[i], boxes[j])) report.overlaps.push([boxes[i].s, boxes[j].s]);
    report.scale = scaleText;
    report.holes = holeList.map((h) => ({ id: h.id, view: h.view, x: +fmt(h.cx - views[h.view].lo[0], prec), y: +fmt(h.cy - views[h.view].lo[1], prec), d: +fmt(h.d, prec), depth: h.depth, measured: h.measured == null ? null : +fmt(h.measured, prec) }));
    report.views = Object.fromEntries(['front', 'top', 'right', 'iso'].map((v) => [v, { visible: views[v].visible.length, hidden: views[v].hidden.length }]));
    report.overall_mm = { x: +fmt(dimsMm.x, prec), y: +fmt(dimsMm.y, prec), z: +fmt(dimsMm.z, prec) };
    // ---- drawing validation: every hole is located and sized; every datum a frame refers to exists
    report.validation = [];
    for (const h of holeList) if (!(prims.some((p) => p.role === 'table' && p.s === h.id) && prims.some((p) => p.role === 'callout' && p.group === h.group))) report.validation.push(`${h.id} lacks a table row or a diameter callout`);
    for (const f of report.gdt.frames) for (const r of f.refs || []) if (!report.gdt.datums.includes(r)) report.validation.push(`frame refers to missing datum ${r}`);
    if (hasSection && !(report.section.area_mm2 > 0)) report.validation.push('section A-A has no area');
    report.ok = report.fits && !report.overlaps.length && !report.missing.length && report.consistency.every((c) => c.ok) && !report.validation.length;
    return { sheet: { name: sheetName, w: SW, h: SH }, prims, report };
  }

  function textBox(p) {
    const w = p.s.length * p.size * 0.55, h = p.size;
    if (p.rotate === 90) return { s: p.s, x0: p.x - h, x1: p.x, y0: p.y - w / 2, y1: p.y + w / 2 };
    const x0 = p.anchor === 'middle' ? p.x - w / 2 : p.anchor === 'end' ? p.x - w : p.x;
    return { s: p.s, x0, x1: x0 + w, y0: p.y, y1: p.y + h };
  }
  const overlap = (a, b) => a.x0 < b.x1 - 0.2 && b.x0 < a.x1 - 0.2 && a.y0 < b.y1 - 0.2 && b.y0 < a.y1 - 0.2;

  // ---------------------------------------------------------------- SVG
  function toSVG(L, opts = {}) {
    const { w, h } = L.sheet, Y = (y) => h - y, ink = opts.ink || '#111';
    const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
    const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}mm" height="${h}mm" font-family="Helvetica, Arial, sans-serif"><rect width="${w}" height="${h}" fill="#fff"/>`];
    const dash = { hidden: '2.4 1.2', center: '6 1.2 1.2 1.2' };
    const polyPts = (pts) => pts.map(([x, y]) => `${x.toFixed(3)},${Y(y).toFixed(3)}`).join(' ');
    for (const p of L.prims) {
      if (p.t === 'line') out.push(`<line x1="${p.a[0].toFixed(3)}" y1="${Y(p.a[1]).toFixed(3)}" x2="${p.b[0].toFixed(3)}" y2="${Y(p.b[1]).toFixed(3)}" stroke="${ink}" stroke-width="${p.w}" stroke-linecap="round"${dash[p.style] ? ` stroke-dasharray="${dash[p.style]}"` : ''}/>`);
      else if (p.t === 'circle') out.push(`<circle cx="${p.c[0]}" cy="${Y(p.c[1])}" r="${p.r}" fill="none" stroke="${ink}" stroke-width="${p.w}"/>`);
      else if (p.t === 'poly') out.push(`<polygon points="${polyPts(p.pts)}" fill="${p.fill ? ink : 'none'}" stroke="${ink}" stroke-width="${p.w}"/>`);
      else if (p.t === 'dimline') {
        const [a, b] = [p.a, p.b], ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        out.push(`<line x1="${a[0]}" y1="${Y(a[1])}" x2="${b[0]}" y2="${Y(b[1])}" stroke="${ink}" stroke-width="${p.w}"/>`);
        for (const [q, dir] of p.single ? [[b, ang + Math.PI]] : [[a, ang], [b, ang + Math.PI]]) { const t = arrow(q, dir); out.push(`<polygon points="${t.map(([x, y]) => `${x.toFixed(3)},${Y(y).toFixed(3)}`).join(' ')}" fill="${ink}"/>`); }
      } else if (p.t === 'text') {
        const anchor = p.anchor === 'middle' ? 'middle' : p.anchor === 'end' ? 'end' : 'start';
        const rtl = isLatin(p.s) ? '' : ' direction="rtl" unicode-bidi="plaintext"';
        out.push(`<text x="${p.x.toFixed(3)}" y="${Y(p.y).toFixed(3)}" font-size="${p.size}" text-anchor="${anchor}" fill="${ink}"${rtl}${p.rotate ? ` transform="rotate(-${p.rotate} ${p.x.toFixed(3)} ${Y(p.y).toFixed(3)})"` : ''}${p.role === 'title' ? ' font-weight="bold"' : ''}${p.maxW && p.s.length * p.size * 0.55 > p.maxW ? ` textLength="${p.maxW}" lengthAdjust="spacingAndGlyphs"` : ''}>${esc(p.s)}</text>`);
      }
    }
    out.push('</svg>');
    return out.join('');
  }
  function arrow(q, dir) { const L = 3, W = 0.9; return [q, [q[0] + L * Math.cos(dir) - W * Math.sin(dir), q[1] + L * Math.sin(dir) + W * Math.cos(dir)], [q[0] + L * Math.cos(dir) + W * Math.sin(dir), q[1] + L * Math.sin(dir) - W * Math.cos(dir)]]; }

  // ---------------------------------------------------------------- PDF (vector)
  async function toPDF(L, PDFLib, opts = {}) {
    const { PDFDocument, StandardFonts, rgb, degrees, LineCapStyle } = PDFLib;
    const MM = 72 / 25.4;
    const doc = await PDFDocument.create();
    doc.setTitle(opts.title || 'Forma drawing'); doc.setProducer('Forma (pdf-lib)'); doc.setCreator('FORMA·3D');
    const page = doc.addPage([L.sheet.w * MM, L.sheet.h * MM]);
    const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const black = rgb(0, 0, 0);
    const dash = { hidden: [2.4 * MM, 1.2 * MM], center: [6 * MM, 1.2 * MM, 1.2 * MM, 1.2 * MM] };
    for (const p of L.prims) {
      if (p.t === 'line' || p.t === 'dimline') page.drawLine({ start: { x: p.a[0] * MM, y: p.a[1] * MM }, end: { x: p.b[0] * MM, y: p.b[1] * MM }, thickness: p.w * MM, color: black, dashArray: dash[p.style], lineCap: LineCapStyle.Round });
      if (p.t === 'dimline') {
        const ang = Math.atan2(p.b[1] - p.a[1], p.b[0] - p.a[0]);
        for (const [q, dir] of p.single ? [[p.b, ang + Math.PI]] : [[p.a, ang], [p.b, ang + Math.PI]]) { const t = arrow(q, dir).map(([x, y]) => `${(x * MM).toFixed(3)} ${(y * MM).toFixed(3)}`); page.drawSvgPath(`M ${t[0]} L ${t[1]} L ${t[2]} Z`, { x: 0, y: 0, color: black, borderWidth: 0 }); }
      }
      if (p.t === 'circle') page.drawCircle({ x: p.c[0] * MM, y: p.c[1] * MM, size: p.r * MM, borderColor: black, borderWidth: p.w * MM });
      if (p.t === 'poly') { const t = p.pts.map(([x, y]) => `${(x * MM).toFixed(3)} ${(y * MM).toFixed(3)}`); page.drawSvgPath(`M ${t.join(' L ')} Z`, { x: 0, y: 0, color: p.fill ? black : undefined, borderColor: black, borderWidth: p.w * MM }); }
      if (p.t === 'text') {
        const f = p.role === 'title' ? bold : font; let size = p.size * MM;
        if (isLatin(p.s)) {
          let w = f.widthOfTextAtSize(p.s, size);
          if (p.maxW && w > p.maxW * MM) { size *= (p.maxW * MM) / w; w = p.maxW * MM; }
          const dx = p.anchor === 'middle' ? -w / 2 : p.anchor === 'end' ? -w : 0;
          if (p.rotate === 90) page.drawText(p.s, { x: p.x * MM, y: p.y * MM + dx, size, font: f, color: black, rotate: degrees(90) });
          else page.drawText(p.s, { x: p.x * MM + dx, y: p.y * MM, size, font: f, color: black });
        } else if (opts.rasterize) {
          const img = await opts.rasterize(p.s, p.size);
          if (img) {
            const png = await doc.embedPng(img.png);
            let h = p.size * 1.25 * MM, w = (img.width / img.height) * h;
            if (p.maxW && w > p.maxW * MM) { h *= (p.maxW * MM) / w; w = p.maxW * MM; }
            const dx = p.anchor === 'middle' ? -w / 2 : p.anchor === 'end' ? -w : 0;
            page.drawImage(png, { x: p.x * MM + dx, y: p.y * MM - p.size * 0.25 * MM, width: w, height: h });
          }
        } else {
          page.drawText('[' + p.s.replace(/[^\x20-\x7E]/g, '').trim() + ']', { x: p.x * MM, y: p.y * MM, size, font, color: black });
        }
      }
    }
    return doc.save();
  }

  const api = { layout, toSVG, toPDF, SHEETS, SCALES, _internal: { edgeGraph, projectView, circles } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FormaDrawing = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
