/*
 * FormaCAD — the CAD language the AI designer writes.
 *
 * A model is a JSON tree (OpenSCAD-like, but data, never executable code):
 *
 *   node := primitive | boolean | pattern, plus optional transforms on any node:
 *           "translate": [x,y,z], "rotate": [rx,ry,rz] (degrees, X then Y then Z),
 *           "mirror": "x"|"y"|"z", "scale": s | [sx,sy,sz]
 *
 *   primitives (millimetres, Z up)
 *     {"box":        {"size":[x,y,z], "center": false}}
 *     {"rounded_box":{"size":[x,y,z], "r": corner_radius, "center": false}}   vertical edges rounded
 *     {"cylinder":   {"d"|"r": .., "h": .., "d2"|"r2": top (cone), "center": false, "segments": 48}}
 *     {"sphere":     {"d"|"r": .., "segments": 32}}
 *     {"extrude":    {"points": [[x,y],...], "h": .., "holes": [[[x,y],...],...]}}  any simple polygon (concave ok)
 *     {"revolve":    {"profile": [[r,z],...], "segments": 64}}                  closed profile in the r>=0 half-plane
 *     {"torus":      {"R": major, "r": minor, "segments": 48}}
 *     {"fillet_box": {"size":[x,y,z], "r": radius}}  every edge rounded     {"chamfer_box": {"size":[x,y,z], "d": distance}}
 *     {"loft":       {"sections": [{"points": [[x,y],...], "z": 0}, {"points": [...], "z": 40}]}}   ruled loft between sections
 *     {"sweep":      {"profile": [[x,y],...], "path": [[x,y,z],...]}}  profile swept along a polyline (mitred joints)
 *   profile corners: "fillet": r | [r per point]  or  "chamfer": d | [d per point]  on extrude, revolve, loft sections, sweep
 *   {"mirror_copy": {"axis": "x"|"y"|"z", "child": node}}   child plus its mirror image
 *   design.tessellation = {"linear_mm": 0.05, "angular_deg": 10}  chord tolerance for curves without explicit segments
 *   booleans
 *     {"union": [node, ...]}  {"difference": [base, cut, ...]}  {"intersection": [node, ...]}
 *   patterns
 *     {"linear_array": {"count": n, "step": [dx,dy,dz], "child": node}}
 *     {"polar_array":  {"count": n, "angle": 360, "child": node}}               around Z through the origin
 *
 * Every number may instead be an expression string over the design's
 * parameters ("width/2 - wall", "sin(30)*len", "max(2, wall*1.5)").
 * Expressions are parsed by a small arithmetic grammar; nothing is eval'd.
 */
(function (root) {
  'use strict';
  const E = typeof module !== 'undefined' && module.exports ? require('./engine.js') : root.Engine3D;
  const AN = typeof module !== 'undefined' && module.exports ? require('./analysis.js') : root.FormaAnalysis;
  const { box, cylinder } = E;

  class CadError extends Error { constructor(path, msg) { super(`${path}: ${msg}`); this.path = path; } }

  // ------------------------------------------------------------------ expressions
  const FUNCS = {
    sin: (d) => Math.sin((d * Math.PI) / 180), cos: (d) => Math.cos((d * Math.PI) / 180), tan: (d) => Math.tan((d * Math.PI) / 180),
    asin: (x) => (Math.asin(x) * 180) / Math.PI, acos: (x) => (Math.acos(x) * 180) / Math.PI, atan: (x) => (Math.atan(x) * 180) / Math.PI,
    atan2: (y, x) => (Math.atan2(y, x) * 180) / Math.PI, sqrt: Math.sqrt, abs: Math.abs, min: Math.min, max: Math.max,
    floor: Math.floor, ceil: Math.ceil, round: Math.round, pow: Math.pow,
  };
  const CONSTS = { pi: Math.PI, PI: Math.PI };

  function evalExpr(src, vars, path) {
    if (typeof src === 'number') { if (!Number.isFinite(src)) throw new CadError(path, 'number is not finite'); return src; }
    if (typeof src !== 'string') throw new CadError(path, `expected a number or expression, got ${JSON.stringify(src)}`);
    const toks = src.match(/\d+(?:\.\d+)?(?:e[+-]?\d+)?|[A-Za-z_][A-Za-z0-9_]*|[-+*/^(),%]|\S/g) || [];
    let i = 0;
    const peek = () => toks[i], next = () => toks[i++];
    const expect = (t) => { if (next() !== t) throw new CadError(path, `expected "${t}" in "${src}"`); };
    function primary() {
      const t = next();
      if (t === undefined) throw new CadError(path, `unexpected end of "${src}"`);
      if (/^\d/.test(t)) return parseFloat(t);
      if (t === '(') { const v = sum(); expect(')'); return v; }
      if (t === '-') return -factor();
      if (t === '+') return factor();
      if (/^[A-Za-z_]/.test(t)) {
        if (peek() === '(') {
          next();
          const f = FUNCS[t];
          if (!f) throw new CadError(path, `unknown function ${t}() in "${src}"`);
          const args = [];
          if (peek() !== ')') { args.push(sum()); while (peek() === ',') { next(); args.push(sum()); } }
          expect(')');
          return f(...args);
        }
        if (t in vars) return vars[t];
        if (t in CONSTS) return CONSTS[t];
        throw new CadError(path, `unknown parameter "${t}" in "${src}"`);
      }
      throw new CadError(path, `unexpected "${t}" in "${src}"`);
    }
    function factor() { let v = primary(); while (peek() === '^') { next(); v = Math.pow(v, primary()); } return v; }
    function term() { let v = factor(); while (peek() === '*' || peek() === '/' || peek() === '%') { const o = next(), r = factor(); v = o === '*' ? v * r : o === '/' ? v / r : v % r; } return v; }
    function sum() { let v = term(); while (peek() === '+' || peek() === '-') { const o = next(), r = term(); v = o === '+' ? v + r : v - r; } return v; }
    const v = sum();
    if (i !== toks.length) throw new CadError(path, `unexpected "${toks[i]}" in "${src}"`);
    if (!Number.isFinite(v)) throw new CadError(path, `"${src}" evaluates to ${v}`);
    return v;
  }

  // ------------------------------------------------------------------ geometry helpers
  function signedArea2(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const j = (i + 1) % pts.length; a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]; } return a / 2; }

  /** Ear-clipping triangulation of a simple CCW polygon; returns index triples. */
  function triangulate(pts) {
    const n = pts.length, idx = [...Array(n).keys()], tris = [];
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const inside = (p, a, b, c) => cross(a, b, p) >= -1e-12 && cross(b, c, p) >= -1e-12 && cross(c, a, p) >= -1e-12;
    let guard = 0;
    while (idx.length > 3 && guard++ < n * n) {
      let clipped = false;
      for (let k = 0; k < idx.length; k++) {
        const ia = idx[(k + idx.length - 1) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length];
        const a = pts[ia], b = pts[ib], c = pts[ic];
        if (cross(a, b, c) <= 1e-12) continue; // reflex or collinear
        let ok = true;
        for (const j of idx) { if (j === ia || j === ib || j === ic) continue; if (inside(pts[j], a, b, c)) { ok = false; break; } }
        if (!ok) continue;
        tris.push([ia, ib, ic]); idx.splice(k, 1); clipped = true; break;
      }
      if (!clipped) throw new Error('polygon is self-intersecting or degenerate');
    }
    if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
    return tris;
  }

  const crossO = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  function isConvex(pts, idx) {
    for (let k = 0; k < idx.length; k++) {
      if (crossO(pts[idx[k]], pts[idx[(k + 1) % idx.length]], pts[idx[(k + 2) % idx.length]]) < -1e-12) return false;
    }
    return true;
  }

  /**
   * Split a CCW polygon into convex pieces (whole polygon if already convex; otherwise
   * ear-clip, then Hertel–Mehlhorn merging of triangles across shared diagonals).
   * Few large pieces keep BSP booleans clean; thin fan triangles cause T-junctions.
   */
  function convexPieces(pts) {
    const all = pts.map((_, i) => i);
    if (isConvex(pts, all)) return [all];
    let polys = triangulate(pts).map((t) => t.slice());
    let merged = true;
    while (merged) {
      merged = false;
      outer: for (let i = 0; i < polys.length; i++) for (let j = i + 1; j < polys.length; j++) {
        const A = polys[i], B = polys[j];
        for (let a = 0; a < A.length; a++) {
          const u = A[a], v = A[(a + 1) % A.length];
          const b = B.findIndex((x, k) => x === v && B[(k + 1) % B.length] === u);
          if (b < 0) continue;
          // splice B into A across the shared edge u→v
          const rest = []; for (let k = 2; k < B.length; k++) rest.push(B[(b + k) % B.length]);
          const C = A.slice(0, a + 1).concat(rest, A.slice(a + 1));
          if (isConvex(pts, C)) { polys[i] = C; polys.splice(j, 1); merged = true; break outer; }
        }
      }
    }
    return polys;
  }

  function cleanPolygon(pts) {
    const out = [];
    for (const p of pts) { const q = out[out.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-9) out.push(p); }
    if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-9) out.pop();
    return out;
  }

  /** Extrude any simple polygon along +Z from 0 to h. Caps are triangulated, walls are planar quads. */
  function extrude(points, h) {
    let pts = cleanPolygon(points);
    if (pts.length < 3) throw new Error('polygon needs at least 3 distinct points');
    if (Math.abs(signedArea2(pts)) < 1e-9) throw new Error('polygon has zero area');
    if (signedArea2(pts) < 0) pts = pts.slice().reverse();
    const pieces = convexPieces(pts);
    const polys = [];
    const bottom = (i) => [pts[i][0], pts[i][1], 0], top = (i) => [pts[i][0], pts[i][1], h];
    for (const piece of pieces) { polys.push(piece.slice().reverse().map(bottom)); polys.push(piece.map(top)); }
    for (let i = 0; i < pts.length; i++) { const j = (i + 1) % pts.length; polys.push([bottom(i), bottom(j), top(j), top(i)]); }
    return E.fromPolygons(polys);
  }

  /** Revolve a closed (r, z) profile around Z. Points with r = 0 lie on the axis. */
  function revolve(profile, segments) {
    let pr = cleanPolygon(profile.map(([r, z]) => [Math.max(0, r), z]));
    if (pr.length < 3) throw new Error('profile needs at least 3 points');
    if (Math.abs(signedArea2(pr)) < 1e-9) throw new Error('profile has zero area');
    if (signedArea2(pr) < 0) pr = pr.slice().reverse(); // CCW in (r,z) ⇒ outward normals after revolve
    const ang = (k) => (2 * Math.PI * k) / segments;
    const at = (p, k) => [p[0] * Math.cos(ang(k)), p[0] * Math.sin(ang(k)), p[1]];
    const polys = [];
    for (let i = 0; i < pr.length; i++) {
      const a = pr[i], b = pr[(i + 1) % pr.length];
      if (a[0] === 0 && b[0] === 0) continue; // edge on the axis contributes no surface
      for (let k = 0; k < segments; k++) {
        const q = [at(a, k), at(b, k), at(b, k + 1), at(a, k + 1)];
        // collapse the duplicated axis point into a triangle
        const poly = a[0] === 0 ? [q[0], q[1], q[2]] : b[0] === 0 ? [q[0], q[1], q[3]] : q;
        polys.push(poly.reverse());
      }
    }
    let s = E.fromPolygons(polys);
    if (s.toMesh().signedVolume() < 0) s = E.fromPolygons(polys.map((p) => p.slice().reverse()));
    return s;
  }

  function sphere(r, segments) {
    const rings = Math.max(4, Math.round(segments / 2)), prof = [[0, -r]];
    for (let i = 1; i < rings; i++) { const t = -Math.PI / 2 + (Math.PI * i) / rings; prof.push([r * Math.cos(t), r * Math.sin(t)]); }
    prof.push([0, r]);
    return revolve(prof, segments);
  }

  function frustum(r1, r2, h, segments) {
    if (r2 <= 0) return revolve([[0, 0], [r1, 0], [0, h]], segments);
    return revolve([[0, 0], [r1, 0], [r2, h], [0, h]], segments);
  }

  function roundedRect(x, y, r, seg = 8) {
    r = Math.min(r, x / 2 - 1e-6, y / 2 - 1e-6);
    if (r <= 0) return [[0, 0], [x, 0], [x, y], [0, y]];
    const pts = [], corners = [[x - r, r, -90], [x - r, y - r, 0], [r, y - r, 90], [r, r, 180]];
    for (const [cx, cy, start] of corners) for (let k = 0; k <= seg; k++) { const a = ((start + (90 * k) / seg) * Math.PI) / 180; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return pts;
  }

  // ------------------------------------------------------------------ fillets, chamfers, lofts, sweeps (exact geometry, then tessellated)
  /**
   * Round (or chamfer) the corners of a simple polygon. `r` is one radius for every corner or a list per
   * vertex (0 = keep sharp). Each arc is tangent to both edges, so the result is the true fillet of the
   * profile; the arc is then tessellated with `arcSeg(radius, angle)` segments. Throws when a radius does
   * not fit (the tangent points of neighbouring corners would cross).
   */
  function roundCorners(pts, r, mode, arcSeg, path) {
    pts = cleanPolygon(pts);
    if (signedArea2(pts) < 0) pts = pts.slice().reverse();
    const n = pts.length, rs = Array.isArray(r) ? r : pts.map(() => r);
    if (rs.length !== n) throw new CadError(path, `needs ${n} radii (one per point), got ${rs.length}`);
    const info = pts.map((p, i) => {
      const a = pts[(i + n - 1) % n], b = pts[(i + 1) % n], rad = rs[i] || 0;
      const u = [a[0] - p[0], a[1] - p[1]], v = [b[0] - p[0], b[1] - p[1]];
      const lu = Math.hypot(u[0], u[1]), lv = Math.hypot(v[0], v[1]);
      const cosT = Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (lu * lv))), theta = Math.acos(cosT); // interior angle between edges
      if (rad <= 0 || theta > Math.PI - 1e-6) return { p, t: 0 };
      const t = mode === 'chamfer' ? rad : rad / Math.tan(theta / 2); // distance from the corner to each tangent point
      return { p, t, u: [u[0] / lu, u[1] / lu], v: [v[0] / lv, v[1] / lv], rad, theta, lu, lv, convex: crossO(a, p, b) > 0 };
    });
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, edge = Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]);
      if (info[i].t + info[j].t > edge + 1e-9) {
        const which = mode === 'chamfer' ? 'chamfer distance' : 'fillet radius';
        throw new CadError(path, `${which} too large between points ${i} and ${j}: needs ${(info[i].t + info[j].t).toFixed(3)} mm of a ${edge.toFixed(3)} mm edge`);
      }
    }
    const out = [];
    for (const c of info) {
      if (!c.t) { out.push(c.p); continue; }
      const A = [c.p[0] + c.u[0] * c.t, c.p[1] + c.u[1] * c.t], B = [c.p[0] + c.v[0] * c.t, c.p[1] + c.v[1] * c.t];
      if (mode === 'chamfer') { out.push(A, B); continue; }
      // centre lies on the bisector at distance rad / sin(theta/2)
      const bis = [c.u[0] + c.v[0], c.u[1] + c.v[1]], bl = Math.hypot(bis[0], bis[1]);
      const d = c.rad / Math.sin(c.theta / 2), C = [c.p[0] + (bis[0] / bl) * d, c.p[1] + (bis[1] / bl) * d];
      const a0 = Math.atan2(A[1] - C[1], A[0] - C[0]); let a1 = Math.atan2(B[1] - C[1], B[0] - C[0]);
      const sweep = Math.PI - c.theta, dir = c.convex ? 1 : -1; // CCW around convex corners, CW around reflex ones
      a1 = a0 + dir * sweep;
      const k = Math.max(1, arcSeg(c.rad, sweep));
      for (let s2 = 0; s2 <= k; s2++) { const ang = a0 + ((a1 - a0) * s2) / k; out.push([C[0] + c.rad * Math.cos(ang), C[1] + c.rad * Math.sin(ang)]); }
    }
    return cleanPolygon(out);
  }

  /** Box with every edge rounded by r (true constant-radius edges, spherical corners). */
  function filletBox(sx, sy, sz, r, k) {
    const hx = sx / 2 - r, hy = sy / 2 - r, hz = sz / 2 - r;
    const cols = [], rows = [];
    for (let q = 0; q < 4; q++) for (let t = 0; t <= k; t++) cols.push({ th: (q * Math.PI) / 2 + (t * Math.PI) / 2 / k, sx: q === 0 || q === 3 ? 1 : -1, sy: q < 2 ? 1 : -1 });
    for (let h = 0; h <= k; h++) rows.push({ ph: -Math.PI / 2 + (h * Math.PI) / 2 / k, sz: -1 });
    for (let h = 0; h <= k; h++) rows.push({ ph: (h * Math.PI) / 2 / k, sz: 1 });
    const P = rows.map((rw) => cols.map((cl) => [cl.sx * hx + r * Math.cos(rw.ph) * Math.cos(cl.th), cl.sy * hy + r * Math.cos(rw.ph) * Math.sin(cl.th), rw.sz * hz + r * Math.sin(rw.ph)].map((v, i) => v + [sx, sy, sz][i] / 2)));
    const same = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 1e-9;
    const polys = [];
    const add = (poly) => { const q = []; for (const v of poly) if (!q.length || !same(q[q.length - 1], v)) q.push(v); if (q.length > 2 && same(q[0], q[q.length - 1])) q.pop(); if (q.length >= 3) polys.push(q); };
    for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < cols.length; j++) {
      const jn = (j + 1) % cols.length;
      const a = P[i][j], b = P[i][jn], c = P[i + 1][jn], d = P[i + 1][j];
      const flatRow = rows[i].ph === rows[i + 1].ph, flatCol = Math.abs(((cols[j].th - cols[jn].th) % (2 * Math.PI))) < 1e-12 || Math.abs(Math.abs(cols[j].th - cols[jn].th) - 2 * Math.PI) < 1e-12;
      if (flatRow || flatCol) add([a, b, c, d]); else { add([a, b, c]); add([a, c, d]); }
    }
    const capPts = (row) => { const q = []; for (const v of P[row]) if (!q.some((w) => same(w, v))) q.push(v); return q; };
    add(capPts(rows.length - 1)); add(capPts(0).reverse());
    let s = E.fromPolygons(polys);
    if (s.toMesh().signedVolume() < 0) s = E.fromPolygons(polys.map((p) => p.slice().reverse()));
    return s;
  }

  /** Box with every edge chamfered by d: the intersection of three chamfered-rectangle prisms. */
  function chamferBox(sx, sy, sz, d) {
    const oct = (w, h) => [[d, 0], [w - d, 0], [w, d], [w, h - d], [w - d, h], [d, h], [0, h - d], [0, d]];
    const pz = extrude(oct(sx, sy), sz);
    const px = extrude(oct(sy, sz), sx).transformed([[0, 0, 1, 0], [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 1]]); // (u,v,w) -> (w,u,v)
    const py = extrude(oct(sx, sz), sy).transformed([[1, 0, 0, 0], [0, 0, 1, 0], [0, 1, 0, 0], [0, 0, 0, 1]]); // (u,v,w) -> (u,w,v)
    return pz.intersect(px).intersect(py);
  }

  /** Resample a closed polygon to n points spaced evenly along its perimeter (keeps the first point). */
  function resample(pts, n) {
    const L = [0]; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; L.push(L[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    const total = L[pts.length], out = [];
    for (let k = 0; k < n; k++) {
      const s = (total * k) / n; let i = 0; while (L[i + 1] < s) i++;
      const a = pts[i], b = pts[(i + 1) % pts.length], f = (s - L[i]) / (L[i + 1] - L[i] || 1);
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    }
    return out;
  }

  /** Ruled loft through planar sections stacked along Z: sections = [{points, z}], ascending z. */
  function loft(sections) {
    const n = Math.max(...sections.map((s) => s.points.length));
    const secs = sections.map((s) => { let p = cleanPolygon(s.points); if (signedArea2(p) < 0) p = p.slice().reverse(); return { z: s.z, p: p.length === n ? p : resample(p, n) }; });
    for (let i = 1; i < secs.length; i++) if (!(secs[i].z > secs[i - 1].z)) throw new Error('section heights must increase');
    // align each section's start with the previous one (least twist)
    for (let i = 1; i < secs.length; i++) {
      let best = 0, bd = Infinity;
      for (let o = 0; o < n; o++) { let d = 0; for (let k = 0; k < n; k++) { const a = secs[i - 1].p[k], b = secs[i].p[(k + o) % n]; d += Math.hypot(a[0] - b[0], a[1] - b[1]); } if (d < bd) { bd = d; best = o; } }
      secs[i].p = secs[i].p.slice(best).concat(secs[i].p.slice(0, best));
    }
    const polys = [], v = (s, k) => [secs[s].p[k][0], secs[s].p[k][1], secs[s].z];
    for (const piece of convexPieces(secs[0].p)) polys.push(piece.slice().reverse().map((k) => v(0, k)));
    const last = secs.length - 1;
    for (const piece of convexPieces(secs[last].p)) polys.push(piece.map((k) => v(last, k)));
    for (let s = 0; s < last; s++) for (let k = 0; k < n; k++) { const k2 = (k + 1) % n; polys.push([v(s, k), v(s, k2), v(s + 1, k2)]); polys.push([v(s, k), v(s + 1, k2), v(s + 1, k)]); }
    let solid = E.fromPolygons(polys);
    if (solid.toMesh().signedVolume() < 0) solid = E.fromPolygons(polys.map((p) => p.slice().reverse()));
    return solid;
  }

  /** Sweep a 2D profile along a 3D polyline with mitred joints and rotation-minimising frames. */
  function sweep(profile, path) {
    let prof = cleanPolygon(profile); if (signedArea2(prof) < 0) prof = prof.slice().reverse();
    const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
    const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const nrm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); if (l < 1e-12) throw new Error('path has a zero-length segment'); return mul3(a, 1 / l); };
    const dirs = []; for (let i = 0; i < path.length - 1; i++) dirs.push(nrm(sub3(path[i + 1], path[i])));
    // mitred joints: the inner side of a bend pulls back by (profile radius x tan(turn/2)); it must fit in both segments
    const pr = Math.max(...prof.map(([x, y]) => Math.hypot(x, y)));
    const pull = [0];
    for (let i = 1; i < dirs.length; i++) {
      const c = Math.max(-1, Math.min(1, dot3(dirs[i - 1], dirs[i])));
      if (c < -0.34) throw new Error(`path turns more than 110° at point ${i}; split it into two sweeps`);
      pull.push(pr * Math.tan(Math.acos(c) / 2));
    }
    pull.push(0);
    for (let i = 0; i < dirs.length; i++) {
      const len = Math.hypot(...sub3(path[i + 1], path[i]));
      if (pull[i] + pull[i + 1] >= len) throw new Error(`path segment ${i} (${len.toFixed(2)} mm) is too short for the profile to turn without folding into itself (needs > ${(pull[i] + pull[i + 1]).toFixed(2)} mm)`);
    }
    // initial frame
    let nAx = Math.abs(dirs[0][2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let u = nrm(cross3(nAx, dirs[0])), w = cross3(dirs[0], u);
    const rotate = (v, a, b) => { const ax = cross3(a, b), s = Math.hypot(ax[0], ax[1], ax[2]), c = dot3(a, b); if (s < 1e-12) return v; const k = mul3(ax, 1 / s); return add3(add3(mul3(v, c), mul3(cross3(k, v), s)), mul3(k, dot3(k, v) * (1 - c))); };
    const sections = [];
    for (let i = 0; i < path.length; i++) {
      const dIn = dirs[Math.max(0, i - 1)], dOut = dirs[Math.min(dirs.length - 1, i)];
      const m = nrm(add3(dIn, dOut));
      const sec = prof.map(([x, y]) => { const q = add3(mul3(u, x), mul3(w, y)); const t = dot3(q, m) / dot3(dIn, m); return add3(path[i], sub3(q, mul3(dIn, t))); });
      sections.push(sec);
      if (i < dirs.length && i > 0) { u = rotate(u, dIn, dOut); w = rotate(w, dIn, dOut); }
      if (i === 0 && dirs.length > 1) { /* frame stays with the first segment */ }
    }
    const polys = [], n = prof.length, last = sections.length - 1;
    for (const piece of convexPieces(prof)) { polys.push(piece.slice().reverse().map((k) => sections[0][k])); polys.push(piece.map((k) => sections[last][k])); }
    for (let s = 0; s < last; s++) for (let k = 0; k < n; k++) { const k2 = (k + 1) % n; polys.push([sections[s][k], sections[s][k2], sections[s + 1][k2], sections[s + 1][k]]); }
    let solid = E.fromPolygons(polys);
    if (solid.toMesh().signedVolume() < 0) solid = E.fromPolygons(polys.map((p) => p.slice().reverse()));
    return solid;
  }

  // ------------------------------------------------------------------ interpreter
  const LIMITS = { nodes: 600, arrayCount: 200, segmentsMin: 3, segmentsMax: 128, booleans: 400, size: 2000 };

  function matrixOf(node, ev, path) {
    let m = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
    const mulM = (a, b) => a.map((row, i) => b[0].map((_, j) => row.reduce((s, _, k) => s + a[i][k] * b[k][j], 0)));
    if (node.scale !== undefined) {
      const s = Array.isArray(node.scale) ? node.scale.map((v, i) => ev(v, `${path}.scale[${i}]`)) : [0, 1, 2].map(() => ev(node.scale, `${path}.scale`));
      if (s.some((v) => v === 0)) throw new CadError(`${path}.scale`, 'scale cannot be zero');
      m = mulM([[s[0], 0, 0, 0], [0, s[1], 0, 0], [0, 0, s[2], 0], [0, 0, 0, 1]], m);
    }
    if (node.mirror !== undefined) {
      const ax = { x: 0, y: 1, z: 2 }[node.mirror];
      if (ax === undefined) throw new CadError(`${path}.mirror`, 'must be "x", "y" or "z"');
      const d = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]; d[ax][ax] = -1; m = mulM(d, m);
    }
    if (node.rotate !== undefined) {
      const r = vec3(node.rotate, ev, `${path}.rotate`);
      ['x', 'y', 'z'].forEach((ax, i) => { if (r[i]) m = mulM(E.rotation(ax, r[i]), m); });
    }
    if (node.translate !== undefined) {
      const t = vec3(node.translate, ev, `${path}.translate`);
      m = mulM([[1, 0, 0, t[0]], [0, 1, 0, t[1]], [0, 0, 1, t[2]], [0, 0, 0, 1]], m);
    }
    return m;
  }

  function vec3(v, ev, path) {
    if (!Array.isArray(v) || v.length !== 3) throw new CadError(path, 'expected [x, y, z]');
    return v.map((x, i) => ev(x, `${path}[${i}]`));
  }

  /**
   * Segments for a curve of radius r: explicit `segments` wins; otherwise, with a tessellation quality
   * {linear_mm, angular_deg}, the smallest count whose chord deviation (sagitta) <= linear_mm and whose
   * step angle <= angular_deg; otherwise the historical default (so existing designs export unchanged).
   */
  function segmentsFor(r, quality, def, arc = 2 * Math.PI) {
    if (!quality) return def;
    let n = 3;
    if (quality.angular_deg > 0) n = Math.max(n, Math.ceil((arc * 180) / Math.PI / quality.angular_deg));
    if (quality.linear_mm > 0 && r > quality.linear_mm) n = Math.max(n, Math.ceil(arc / (2 * Math.acos(1 - quality.linear_mm / r))));
    return Math.max(1, Math.min(Math.ceil(LIMITS.segmentsMax * (arc / (2 * Math.PI))), n));
  }

  function build(model, params = {}, quality = null) {
    const vars = {};
    for (const [k, v] of Object.entries(params)) { if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new CadError('parameters', `bad name "${k}"`); vars[k] = typeof v === 'number' ? v : evalExpr(v, vars, `parameters.${k}`); }
    const counters = { nodes: 0, booleans: 0 };
    const ev = (x, path) => evalExpr(x, vars, path);
    const pos = (x, path) => { const v = ev(x, path); if (v <= 0) throw new CadError(path, `must be > 0 (got ${+v.toFixed(4)})`); if (v > LIMITS.size) throw new CadError(path, `${v} mm is larger than ${LIMITS.size} mm`); return v; };
    const segs = (x, path, def, r) => Math.max(LIMITS.segmentsMin, Math.min(LIMITS.segmentsMax, Math.round(x === undefined ? (r !== undefined ? segmentsFor(r, quality, def) : def) : ev(x, path))));
    const arcSeg = (r, ang) => (quality ? Math.max(1, segmentsFor(r, quality, 1, ang)) : Math.max(1, Math.ceil((ang / (Math.PI / 2)) * 8)));
    const corners = (pts, o, p) => {
      if (o.fillet !== undefined && o.chamfer !== undefined) throw new CadError(p, 'use either "fillet" or "chamfer" on one profile');
      if (o.fillet !== undefined) return roundCorners(pts, Array.isArray(o.fillet) ? o.fillet.map((v, i) => ev(v, `${p}.fillet[${i}]`)) : ev(o.fillet, `${p}.fillet`), 'fillet', arcSeg, `${p}.fillet`);
      if (o.chamfer !== undefined) return roundCorners(pts, Array.isArray(o.chamfer) ? o.chamfer.map((v, i) => ev(v, `${p}.chamfer[${i}]`)) : ev(o.chamfer, `${p}.chamfer`), 'chamfer', arcSeg, `${p}.chamfer`);
      return pts;
    };
    const radius = (o, path, rk = 'r', dk = 'd') => (o[rk] !== undefined ? pos(o[rk], `${path}.${rk}`) : o[dk] !== undefined ? pos(o[dk], `${path}.${dk}`) / 2 : (() => { throw new CadError(path, `needs "${rk}" or "${dk}"`); })());

    function node(n, path) {
      if (!n || typeof n !== 'object' || Array.isArray(n)) throw new CadError(path, 'expected a node object');
      if (++counters.nodes > LIMITS.nodes) throw new CadError(path, `model has more than ${LIMITS.nodes} nodes`);
      const kinds = Object.keys(n).filter((k) => !['translate', 'rotate', 'mirror', 'scale', 'name', 'comment'].includes(k));
      if (kinds.length !== 1) throw new CadError(path, `expected exactly one shape/operation key, got [${kinds.join(', ')}]`);
      const kind = kinds[0], o = n[kind], p = `${path}.${kind}`;
      let s;
      try {
        s = shape(kind, o, p);
      } catch (e) {
        if (e instanceof CadError) throw e;
        throw new CadError(p, e.message);
      }
      const m = matrixOf(n, ev, path);
      return m.every((row, i) => row.every((v, j) => v === (i === j ? 1 : 0))) ? s : s.transformed(m);
    }

    function children(arr, p, min) {
      if (!Array.isArray(arr) || arr.length < min) throw new CadError(p, `expected a list of at least ${min} nodes`);
      return arr.map((c, i) => node(c, `${p}[${i}]`));
    }
    function bump(p, k) { counters.booleans += k; if (counters.booleans > LIMITS.booleans) throw new CadError(p, `more than ${LIMITS.booleans} boolean operations`); }

    function shape(kind, o, p) {
      switch (kind) {
        case 'box': {
          const s = vec3(o.size, ev, `${p}.size`).map((v, i) => { if (v <= 0) throw new CadError(`${p}.size[${i}]`, 'must be > 0'); return v; });
          return box(s[0], s[1], s[2], o.center ? s.map((v) => -v / 2) : [0, 0, 0]);
        }
        case 'rounded_box': {
          const s = vec3(o.size, ev, `${p}.size`);
          const r = o.r === undefined ? 0 : ev(o.r, `${p}.r`);
          let solid = extrude(roundedRect(s[0], s[1], r), s[2]);
          return o.center ? solid.translated(-s[0] / 2, -s[1] / 2, -s[2] / 2) : solid;
        }
        case 'cylinder': {
          const r1 = radius(o, p), h = pos(o.h, `${p}.h`);
          const r2 = o.r2 !== undefined ? ev(o.r2, `${p}.r2`) : o.d2 !== undefined ? ev(o.d2, `${p}.d2`) / 2 : r1;
          if (r2 < 0) throw new CadError(`${p}.r2`, 'must be >= 0');
          const sg = segs(o.segments, `${p}.segments`, 64, Math.max(r1, r2));
          const solid = r2 === r1 ? cylinder(r1, h, [0, 0, 0], 'z', sg) : frustum(r1, r2, h, sg);
          return o.center ? solid.translated(0, 0, -h / 2) : solid;
        }
        case 'sphere': { const r = radius(o, p); return sphere(r, segs(o.segments, `${p}.segments`, 40, r)); }
        case 'torus': {
          const R = pos(o.R, `${p}.R`), r = pos(o.r, `${p}.r`);
          if (r >= R) throw new CadError(p, 'minor radius r must be smaller than R');
          const sg = segs(o.segments, `${p}.segments`, 48, R + r), prof = [];
          for (let k = 0; k < Math.max(12, sg / 2); k++) { const a = (2 * Math.PI * k) / Math.max(12, sg / 2); prof.push([R + r * Math.cos(a), r * Math.sin(a)]); }
          return revolve(prof, sg);
        }
        case 'extrude': {
          const pts = corners(pointsOf(o.points, `${p}.points`), o, p);
          let solid = extrude(pts, pos(o.h, `${p}.h`));
          if (o.holes) {
            if (!Array.isArray(o.holes)) throw new CadError(`${p}.holes`, 'expected a list of polygons');
            o.holes.forEach((hp, i) => { bump(p, 1); solid = solid.subtract(extrude(pointsOf(hp, `${p}.holes[${i}]`), ev(o.h, `${p}.h`) + 2).translated(0, 0, -1)); });
          }
          return solid;
        }
        case 'revolve': {
          const prof = corners(pointsOf(o.profile, `${p}.profile`), o, p);
          return revolve(prof, segs(o.segments, `${p}.segments`, 64, Math.max(...prof.map((q) => q[0]))));
        }
        case 'fillet_box': case 'chamfer_box': {
          const sz = vec3(o.size, ev, `${p}.size`).map((v, i) => { if (v <= 0) throw new CadError(`${p}.size[${i}]`, 'must be > 0'); return v; });
          const key = kind === 'fillet_box' ? 'r' : 'd', v = ev(o[key], `${p}.${key}`);
          const lim = Math.min(...sz) / 2;
          if (!(v > 0)) throw new CadError(`${p}.${key}`, 'must be > 0');
          if (v >= lim - 1e-9) throw new CadError(`${p}.${key}`, `${v} mm does not fit: must be smaller than half the smallest side (${lim} mm)`);
          const solid = kind === 'fillet_box' ? filletBox(sz[0], sz[1], sz[2], v, Math.max(2, Math.ceil(arcSeg(v, Math.PI / 2)))) : chamferBox(sz[0], sz[1], sz[2], v);
          return o.center ? solid.translated(-sz[0] / 2, -sz[1] / 2, -sz[2] / 2) : solid;
        }
        case 'loft': {
          if (!Array.isArray(o.sections) || o.sections.length < 2) throw new CadError(`${p}.sections`, 'needs at least 2 sections [{points, z}]');
          return loft(o.sections.map((sec, i) => ({ points: corners(pointsOf(sec.points, `${p}.sections[${i}].points`), sec, `${p}.sections[${i}]`), z: ev(sec.z, `${p}.sections[${i}].z`) })));
        }
        case 'sweep': {
          if (!Array.isArray(o.path) || o.path.length < 2) throw new CadError(`${p}.path`, 'needs at least 2 [x, y, z] points');
          if (o.path.length > 500) throw new CadError(`${p}.path`, 'too many points');
          return sweep(corners(pointsOf(o.profile, `${p}.profile`), o, p), o.path.map((q, i) => vec3(q, ev, `${p}.path[${i}]`)));
        }
        case 'mirror_copy': {
          const ax = { x: 0, y: 1, z: 2 }[o.axis];
          if (ax === undefined) throw new CadError(`${p}.axis`, 'must be "x", "y" or "z"');
          const base = node(o.child, `${p}.child`); bump(p, 1);
          const m = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]; m[ax][ax] = -1;
          return base.union(base.transformed(m));
        }
        case 'union': { const c = children(o, p, 1); bump(p, c.length - 1); return c.reduce((a, b) => a.union(b)); }
        case 'difference': { const c = children(o, p, 1); bump(p, c.length - 1); return c.slice(1).reduce((a, b) => a.subtract(b), c[0]); }
        case 'intersection': { const c = children(o, p, 2); bump(p, c.length - 1); return c.reduce((a, b) => a.intersect(b)); }
        case 'linear_array': {
          const count = Math.round(ev(o.count, `${p}.count`)); const step = vec3(o.step, ev, `${p}.step`);
          if (count < 1 || count > LIMITS.arrayCount) throw new CadError(`${p}.count`, `must be 1..${LIMITS.arrayCount}`);
          const base = node(o.child, `${p}.child`); bump(p, count - 1);
          let s = base; for (let k = 1; k < count; k++) s = s.union(base.translated(step[0] * k, step[1] * k, step[2] * k));
          return s;
        }
        case 'polar_array': {
          const count = Math.round(ev(o.count, `${p}.count`)); const angle = o.angle === undefined ? 360 : ev(o.angle, `${p}.angle`);
          if (count < 1 || count > LIMITS.arrayCount) throw new CadError(`${p}.count`, `must be 1..${LIMITS.arrayCount}`);
          const base = node(o.child, `${p}.child`); bump(p, count - 1);
          const stepA = Math.abs(angle - 360) < 1e-9 ? 360 / count : count > 1 ? angle / (count - 1) : 0;
          let s = base; for (let k = 1; k < count; k++) s = s.union(base.rotated('z', stepA * k));
          return s;
        }
        default: throw new CadError(p, `unknown shape or operation "${kind}"`);
      }
    }

    function pointsOf(arr, p) {
      if (!Array.isArray(arr) || arr.length < 3) throw new CadError(p, 'expected at least 3 [x, y] points');
      if (arr.length > 2000) throw new CadError(p, 'too many points');
      return arr.map((pt, i) => { if (!Array.isArray(pt) || pt.length !== 2) throw new CadError(`${p}[${i}]`, 'expected [x, y]'); return [ev(pt[0], `${p}[${i}][0]`), ev(pt[1], `${p}[${i}][1]`)]; });
    }

    const solid = node(model, 'model');
    return { solid, stats: { nodes: counters.nodes, booleans: counters.booleans } };
  }

  /** Build a design ({parameters:[{name,value}], model}) into a validated, exported result. */
  async function generateDesign(design, overrides = {}, constraints) {
    const t0 = Date.now();
    if (!design || typeof design !== 'object' || !design.model) throw new E.PipelineError('BAD_DESIGN', 'design has no model');
    const params = {};
    for (const p of design.parameters || []) params[p.name] = overrides[p.name] !== undefined ? Number(overrides[p.name]) : p.value;
    let solid, stats;
    const quality = design.tessellation && typeof design.tessellation === 'object'
      ? { linear_mm: Number(design.tessellation.linear_mm) || 0, angular_deg: Number(design.tessellation.angular_deg) || 0 } : null;
    try { ({ solid, stats } = build(design.model, params, quality)); }
    catch (e) { throw new E.PipelineError('CAD_ERROR', e.message, e.path); }
    let mesh = solid.toMesh();
    if (mesh.isEmpty) throw new E.PipelineError('EMPTY_GEOMETRY', 'the model produced no solid (check difference/intersection order)');
    const [lo] = mesh.bounds();
    const transforms = [];
    if (lo.some((x) => Math.abs(x) > 1e-9)) { mesh = mesh.translated(lo.map((x) => -x)); transforms.push(`placed on the build plate (shifted ${lo.map((x) => (-x).toFixed(2)).join(', ')} mm)`); }
    const [repaired, report] = E.validate(mesh.asFloat32(), constraints, true);
    if (report.status === 'INVALID' || report.status === 'VALIDATION_FAILED') throw new E.PipelineError('GEOMETRY_INVALID', 'geometry failed validation', report);
    const stl = E.writeStl(repaired);
    const reopened = E.readStl(stl);
    const [, post] = E.validate(reopened, constraints, false);
    const offset = lo.map((x) => -x);
    // manufacturability, measured requirements and print estimate on the exact exported geometry
    const analysis = AN ? AN.analyse(reopened, { design, params, offset, evalExpr }) : null;
    return { status: post.status, stl, mesh: reopened, size_mm: post.stats.size_mm, triangles: post.stats.triangles,
      validation: report, post_export_validation: post, transforms, params, offset, analysis, cad_stats: stats, duration_ms: Date.now() - t0 };
  }

  const api = { evalExpr, build, generateDesign, CadError, triangulate, roundCorners, segmentsFor, LIMITS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FormaCAD = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
