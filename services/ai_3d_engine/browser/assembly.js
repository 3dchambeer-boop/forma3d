/*
 * FormaAssembly — multi-part assemblies on top of the FormaCAD kernel.
 *
 * spec = {
 *   name_ar, parts: [{ id, name_ar, design, values?, qty?, material?, rotate?: [rx,ry,rz], translate?: [x,y,z],
 *                      datums?: { name: { axis: 'x'|'y'|'z', at: mm (part frame), dir: 1|-1 } } }],
 *   constraints: [
 *     { type: 'mate',  a, a_face, b, b_face, offset? }   faces point at each other; b moves so they touch (or sit offset apart)
 *     { type: 'flush', a, a_face, b, b_face, offset? }   faces point the same way and lie in one plane
 *     { type: 'align', a, b, axis }                      bounding-box centres coincide on an axis
 *     { type: 'clearance', a, b, min, ignore_contact? }  checked, not solved: the smallest gap between the two parts
 *                                                        (ignore_contact skips faces resting in a mate plane between them)
 *     { type: 'concentric', a, a_axis, b, b_axis }       b slides (no rotation) until its axis lies on a's axis
 *     { type: 'angle', a, b, axis, angle, pivot? }       b turns about a's axis `axis` (an axis datum of a) until it has
 *                                                        turned `angle` degrees relative to a, measured from the pose
 *                                                        written in the spec (rotate/translate = 0 degrees)
 *     { type: 'revolute', a, a_axis, b, b_axis, angle?, range?: [lo, hi], step?: 15 }
 *                                                        a hinge or pivot: concentric + angle, and the whole range of
 *                                                        motion is swept and checked for interference with every other
 *                                                        part at every step (both ends included)
 *     { type: 'slider', a, a_axis, b, b_axis, offset?, range?: [lo, hi], step? }
 *                                                        prismatic joint: b's axis on a's axis, b keeps its spec rotation,
 *                                                        b's axis point sits `offset` mm along a's axis from a's axis point;
 *                                                        the travel range is swept for interference like a hinge
 *     { type: 'cylindrical', a, a_axis, b, b_axis, angle?, offset? }
 *                                                        concentric; turning and sliding are free unless angle / offset set
 *     { type: 'planar', a, a_face, b, b_face, offset? }  the faces stay in contact (solved like mate); position and turn
 *                                                        within the plane are left to other constraints
 *     { type: 'fixed', a, b }                            b keeps the pose the spec gives it relative to a, and moves with a
 *   ] }
 * A face is '+x'|'-x'|'+y'|'-y'|'+z'|'-z' (that side of the part's bounding box) or the name of a plane datum.
 * Axis datums: part.axes = { name: { point: [x,y,z], dir: [dx,dy,dz] } } in the part's own model frame (before its
 * rotate/translate); they follow the part through every move and turn.
 * The first part is fixed (ground). Constraints move part b in the order given: mate/flush/align/concentric by
 * translation, angle/revolute by rotation about a's axis line. Every constraint is re-checked afterwards (a later
 * constraint that undoes an earlier one is reported, not hidden). A plane datum is axis-aligned; once its part has
 * been turned about an axis that is not the datum's own normal, using it is an error rather than a silent mistake.
 *
 *   assemble(spec, build)  -> { parts, constraints (with residuals), interference, clearance, bom, ok }
 *   exploded(asm, factor)  -> per-part offsets for an exploded view
 *   minDistance(A, B, R)   exact distance between two triangle meshes when it is below R (else >= R)
 */
(function (root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const E = node ? require('./engine.js') : root.Engine3D;
  const AN = node ? require('./analysis.js') : root.FormaAnalysis;

  const AX = { x: 0, y: 1, z: 2 };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const err = (msg) => Object.assign(new Error(msg), { code: 'ASSEMBLY_ERROR' });

  function rotateXYZ(p, r) {
    let [x, y, z] = p;
    const [ax, ay, az] = (r || [0, 0, 0]).map((d) => (d * Math.PI) / 180);
    if (ax) { const c = Math.cos(ax), s = Math.sin(ax); [y, z] = [c * y - s * z, s * y + c * z]; }
    if (ay) { const c = Math.cos(ay), s = Math.sin(ay); [x, z] = [c * x + s * z, -s * x + c * z]; }
    if (az) { const c = Math.cos(az), s = Math.sin(az); [x, y] = [c * x - s * y, s * x + c * y]; }
    return [x, y, z];
  }
  const norm = (a) => { const n = Math.hypot(a[0], a[1], a[2]); return [a[0] / n, a[1] / n, a[2] / n]; };
  const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const matVec = (M, v) => [dot(M[0], v), dot(M[1], v), dot(M[2], v)];
  const matMul = (A, B) => A.map((row) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
  const I3 = () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  function rotMatXYZ(r) { // the same rotation as rotateXYZ, as a matrix
    const cols = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((e) => rotateXYZ(e, r));
    return [0, 1, 2].map((i) => [cols[0][i], cols[1][i], cols[2][i]]);
  }
  function axisAngle(d, deg) { // Rodrigues
    const [x, y, z] = norm(d), t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t), C = 1 - c;
    return [[c + x * x * C, x * y * C - z * s, x * z * C + y * s], [y * x * C + z * s, c + y * y * C, y * z * C - x * s], [z * x * C - y * s, z * y * C + x * s, c + z * z * C]];
  }
  const wrap = (deg) => { let d = ((deg + 180) % 360 + 360) % 360 - 180; if (d <= -180 + 1e-12) d += 360; return d; };
  function boundsOf(V) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const v of V) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], v[a]); hi[a] = Math.max(hi[a], v[a]); }
    return { lo, hi };
  }

  // ---------------------------------------------------------------- exact mesh distance (below a radius R)
  function ptTri(p, a, b, c) { // squared distance, Ericson "closest point on triangle"
    const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
    const d1 = dot(ab, ap), d2 = dot(ac, ap); if (d1 <= 0 && d2 <= 0) return dot(ap, ap);
    const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp); if (d3 >= 0 && d4 <= d3) return dot(bp, bp);
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3), q = sub(p, [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v]); return dot(q, q); }
    const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp); if (d6 >= 0 && d5 <= d6) return dot(cp, cp);
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6), q = sub(p, [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w]); return dot(q, q); }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)), bc = sub(c, b), q = sub(p, [b[0] + bc[0] * w, b[1] + bc[1] * w, b[2] + bc[2] * w]); return dot(q, q); }
    const n = cross(ab, ac), nn = dot(n, n); if (nn < 1e-30) return dot(ap, ap);
    const t = dot(ap, n); return (t * t) / nn;
  }
  function segSeg(p1, q1, p2, q2) { // squared distance between segments
    const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
    const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
    let s, t;
    if (a <= 1e-18 && e <= 1e-18) return dot(r, r);
    if (a <= 1e-18) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
    else {
      const c = dot(d1, r);
      if (e <= 1e-18) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else {
        const b = dot(d1, d2), den = a * e - b * b;
        s = den > 1e-18 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
        t = (b * s + f) / e;
        if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
      }
    }
    const c1 = [p1[0] + d1[0] * s, p1[1] + d1[1] * s, p1[2] + d1[2] * s], c2 = [p2[0] + d2[0] * t, p2[1] + d2[1] * t, p2[2] + d2[2] * t];
    const w = sub(c1, c2); return dot(w, w);
  }
  function minDistance(A, B, R, skip) {
    if (skip) { A = { vertices: A.vertices, faces: A.faces.filter((f) => !skip(f.map((i) => A.vertices[i]))) }; B = { vertices: B.vertices, faces: B.faces.filter((f) => !skip(f.map((i) => B.vertices[i]))) }; }
    const cell = Math.max(R, 0.25), key = (i, j, k) => i + ',' + j + ',' + k, ci = (v) => Math.floor(v / cell);
    function index(M) {
      const tris = new Map(), edges = new Map(), seen = new Set();
      M.faces.forEach((f, fi) => {
        const P = f.map((i) => M.vertices[i]), lo = [0, 1, 2].map((a) => ci(Math.min(P[0][a], P[1][a], P[2][a]))), hi = [0, 1, 2].map((a) => ci(Math.max(P[0][a], P[1][a], P[2][a])));
        for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) { const kk = key(i, j, k); if (!tris.has(kk)) tris.set(kk, []); tris.get(kk).push(fi); }
        for (let e = 0; e < 3; e++) {
          const u = f[e], v = f[(e + 1) % 3], ek = u < v ? u + '_' + v : v + '_' + u;
          if (seen.has(ek)) continue; seen.add(ek);
          const p = M.vertices[u], q = M.vertices[v], l2 = [0, 1, 2].map((a) => ci(Math.min(p[a], q[a]))), h2 = [0, 1, 2].map((a) => ci(Math.max(p[a], q[a])));
          for (let i = l2[0]; i <= h2[0]; i++) for (let j = l2[1]; j <= h2[1]; j++) for (let k = l2[2]; k <= h2[2]; k++) { const kk = key(i, j, k); if (!edges.has(kk)) edges.set(kk, []); edges.get(kk).push([p, q]); }
        }
      });
      return { tris, edges };
    }
    const IA = index(A), IB = index(B);
    let best = R * R, where = null;
    const near = (I, p, kind) => { const out = new Set(), c = [ci(p[0]), ci(p[1]), ci(p[2])]; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) for (const x of I[kind].get(key(c[0] + i, c[1] + j, c[2] + k)) || []) out.add(x); return out; };
    const used = (M) => { const u = new Set(); for (const f of M.faces) for (const i of f) u.add(i); return [...u].map((i) => M.vertices[i]); };
    const pv = (M, I, other) => { for (const p of used(M)) for (const fi of near(I, p, 'tris')) { const f = other.faces[fi], d = ptTri(p, other.vertices[f[0]], other.vertices[f[1]], other.vertices[f[2]]); if (d < best) { best = d; where = p; } } };
    pv(A, IB, B); pv(B, IA, A);
    for (const [kk, list] of IA.edges) {
      const [i, j, k] = kk.split(',').map(Number), cand = [];
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) for (const e of IB.edges.get(key(i + a, j + b, k + c)) || []) cand.push(e);
      for (const [p1, q1] of list) for (const [p2, q2] of cand) { const d = segSeg(p1, q1, p2, q2); if (d < best) { best = d; where = p1; } }
    }
    return { distance: Math.sqrt(best), below: !!where, at: where };
  }

  // ---------------------------------------------------------------- assembly
  function faceOf(part, face) {
    if (/^[+-][xyz]$/.test(face)) { const a = AX[face[1]], dir = face[0] === '+' ? 1 : -1; return { a, dir, at: dir > 0 ? part.box.hi[a] : part.box.lo[a] }; }
    const d = part.datums && part.datums[face];
    if (!d || !(d.axis in AX)) throw err(`part "${part.id}" has no face or datum "${face}"`);
    const a = AX[d.axis];
    if (part.turned.some((k) => k !== a)) throw err(`plane datum "${face}" of part "${part.id}" is no longer axis-aligned: the part was turned by a joint; use a bounding-box face or an axis datum`);
    return { a, dir: d.dir < 0 ? -1 : 1, at: Number(d.at) + part.move[a] }; // datums are axis-aligned planes in the placed frame
  }
  // an axis datum in world coordinates: x = R p + t
  function axisOf(part, name) {
    const d = part.axes && part.axes[name];
    if (!d || !Array.isArray(d.point) || !Array.isArray(d.dir)) throw err(`part "${part.id}" has no axis "${name}"`);
    return { p: add(matVec(part.R, d.point.map(Number)), part.t), d: norm(matVec(part.R, d.dir.map(Number))) };
  }
  function rotateBy(part, c, d, deg) { // turn a part about the world line through c along d
    if (Math.abs(deg) < 1e-12) return;
    const Q = axisAngle(d, deg), turn = (v) => add(matVec(Q, sub(v, c)), c);
    for (const v of part.mesh.vertices) { const w = turn(v); v[0] = w[0]; v[1] = w[1]; v[2] = w[2]; }
    part.R = matMul(Q, part.R); part.t = turn(part.t);
    part.box = boundsOf(part.mesh.vertices);
    const k = d.findIndex((x) => Math.abs(Math.abs(x) - 1) < 1e-9);
    if (!part.turned.includes(k)) part.turned.push(k); // -1 = an oblique axis: no plane datum survives
  }
  // move a part rigidly so that its pose becomes (Rt, tt): every vertex v -> G (v - t) + tt with G = Rt R^T
  function poseTo(part, Rt, tt) {
    const G = matMul(Rt, transpose(part.R));
    for (const v of part.mesh.vertices) { const w = add(matVec(G, sub(v, part.t)), tt); v[0] = w[0]; v[1] = w[1]; v[2] = w[2]; }
    const rotated = G.some((row, i) => row.some((x, j) => Math.abs(x - (i === j ? 1 : 0)) > 1e-12));
    for (let a = 0; a < 3; a++) part.move[a] += tt[a] - part.t[a];
    part.R = Rt; part.t = tt.slice(); part.box = boundsOf(part.mesh.vertices);
    if (rotated && !part.turned.includes(-1)) part.turned.push(-1);
  }
  // where a fixed joint wants b: a's displacement since the spec, applied to b's spec pose
  function fixedTarget(A, B) {
    const Q = matMul(A.R, transpose(A.R0)), shift = sub(A.t, matVec(Q, A.t0));
    return { R: matMul(Q, B.R0), t: add(matVec(Q, B.t0), shift) };
  }
  const axialOffset = (fa, fb) => dot(sub(fb.p, fa.p), fa.d);
  // the angle (degrees) that b has turned relative to a about the direction d, since the spec pose
  function relAngle(A, B, d) {
    const Q = matMul(matMul(B.R, transpose(B.R0)), transpose(matMul(A.R, transpose(A.R0))));
    let u = cross(d, [1, 0, 0]); if (Math.hypot(...u) < 0.5) u = cross(d, [0, 1, 0]); u = norm(u);
    const w = matVec(Q, u);
    return (Math.atan2(dot(cross(u, w), d), dot(u, w)) * 180) / Math.PI;
  }
  const transpose = (M) => [0, 1, 2].map((i) => [M[0][i], M[1][i], M[2][i]]);
  // distance between two axis lines and the angle between their directions
  function axisResidual(fa, fb) {
    const ang = Math.acos(Math.min(1, Math.abs(dot(fa.d, fb.d)))) * 180 / Math.PI;
    const w = sub(fb.p, fa.p), perp = sub(w, scale(fa.d, dot(w, fa.d)));
    return { offset: Math.hypot(...perp), perp, angle_deg: ang };
  }

  function moveBy(part, a, delta) {
    part.move[a] += delta; part.t[a] += delta;
    for (const v of part.mesh.vertices) v[a] += delta;
    part.box.lo[a] += delta; part.box.hi[a] += delta;
  }
  function residual(parts, c) {
    const A = parts[c.a], B = parts[c.b];
    if (c.type === 'fixed') {
      const T = fixedTarget(A, B);
      return Math.max(...T.R.flatMap((row, i) => row.map((x, j) => Math.abs(x - B.R[i][j]) * 1000)), ...[0, 1, 2].map((k) => Math.abs(T.t[k] - B.t[k])));
    }
    if (c.type === 'slider' || c.type === 'cylindrical') {
      const fa = axisOf(A, c.a_axis), r = axisResidual(fa, axisOf(B, c.b_axis));
      let res = Math.max(r.offset, r.angle_deg > 1e-7 ? r.angle_deg : 0);
      if (c.type === 'slider' || c.offset !== undefined) res = Math.max(res, Math.abs(axialOffset(fa, axisOf(B, c.b_axis)) - (Number(c.offset) || 0)));
      if (c.type === 'slider' || c.angle !== undefined) res = Math.max(res, Math.abs(wrap(relAngle(A, B, fa.d) - (Number(c.angle) || 0))));
      return res;
    }
    if (c.type === 'concentric' || c.type === 'revolute') {
      const r = axisResidual(axisOf(A, c.a_axis), axisOf(B, c.b_axis));
      if (c.type === 'concentric') return Math.max(r.offset, r.angle_deg > 1e-7 ? r.angle_deg : 0);
      const fa = axisOf(A, c.a_axis);
      return Math.max(r.offset, r.angle_deg > 1e-7 ? r.angle_deg : 0, Math.abs(wrap(relAngle(A, B, fa.d) - (Number(c.angle) || 0))));
    }
    if (c.type === 'angle') { const fa = axisOf(A, c.axis); return wrap(relAngle(A, B, fa.d) - (Number(c.angle) || 0)); }
    if (c.type === 'align') { const a = AX[c.axis]; return (B.box.lo[a] + B.box.hi[a]) / 2 - (A.box.lo[a] + A.box.hi[a]) / 2; }
    const fa = faceOf(A, c.a_face), fb = faceOf(B, c.b_face);
    return fb.at - (fa.at + fa.dir * (Number(c.offset) || 0));
  }

  function interferenceVolume(A, B) {
    if ([0, 1, 2].some((a) => A.box.hi[a] <= B.box.lo[a] + 1e-9 || B.box.hi[a] <= A.box.lo[a] + 1e-9)) return 0;
    const sa = E.fromPolygons(A.mesh.faces.map((f) => f.map((k) => A.mesh.vertices[k]))), sb = E.fromPolygons(B.mesh.faces.map((f) => f.map((k) => B.mesh.vertices[k])));
    return Math.abs(sa.intersect(sb).toMesh().signedVolume());
  }
  // a hinge's range of motion: turn a copy of b through [lo, hi] and test it against every other part
  function sweep(parts, order, c) {
    const f = axisOf(parts[c.a], c.a_axis), base = Number(c.angle) || 0, lo = +c.range[0], hi = +c.range[1];
    const step = c.type === 'slider' ? Math.max(0.5, Number(c.step) || 5) : Math.max(1, Number(c.step) || 15), angles = [];
    for (let x = lo; x < hi - 1e-9; x += step) angles.push(+x.toFixed(6));
    angles.push(hi);
    const B = parts[c.b];
    const slide = c.type === 'slider', base0 = slide ? Number(c.offset) || 0 : base;
    return angles.map((ang) => {
      const Q = slide ? I3() : axisAngle(f.d, ang - base0), shift = slide ? scale(f.d, ang - base0) : [0, 0, 0];
      const V = B.mesh.vertices.map((v) => add(add(matVec(Q, sub(v, f.p)), f.p), shift));
      const copy = { mesh: { vertices: V, faces: B.mesh.faces }, box: boundsOf(V) };
      const hits = [];
      for (const id of order) {
        if (id === c.b) continue;
        const vol = interferenceVolume(copy, parts[id]);
        if (vol > 1e-3) hits.push({ with: id, volume_mm3: +vol.toFixed(3) });
      }
      return slide ? { offset: ang, hits } : { angle: ang, hits };
    });
  }

  async function assemble(spec, build) {
    if (!spec || !Array.isArray(spec.parts) || !spec.parts.length) throw err('an assembly needs at least one part');
    const parts = {}, order = [];
    for (const p of spec.parts) {
      if (!p.id || parts[p.id]) throw err('every part needs a unique id');
      const r = await build(p.design, p.values || {});
      const off = r.offset || [0, 0, 0];
      // back to the part's own model frame, then rotate and place it
      const V = r.mesh.vertices.map((v) => { const m = rotateXYZ(sub(v, off), p.rotate); return [m[0] + ((p.translate || [])[0] || 0), m[1] + ((p.translate || [])[1] || 0), m[2] + ((p.translate || [])[2] || 0)]; });
      const mesh = new E.Mesh(V, r.mesh.faces.map((f) => f.slice()));
      const R0 = rotMatXYZ(p.rotate), t0 = [0, 1, 2].map((a) => Number((p.translate || [])[a]) || 0);
      parts[p.id] = { id: p.id, name_ar: p.name_ar || p.id, spec: p, result: r, mesh, box: boundsOf(V), move: [0, 0, 0], R: R0, R0, t: t0.slice(), t0, turned: [], datums: p.datums || null, axes: p.axes || null, qty: Math.max(1, p.qty || 1), material: String(p.material || (p.design.print && p.design.print.material) || 'PLA').toUpperCase() };
      order.push(p.id);
    }
    const ground = order[0];
    const cons = (spec.constraints || []).map((c, i) => ({ ...c, i }));
    for (const c of cons) {
      if (!parts[c.a] || !parts[c.b]) throw err(`constraint ${c.i + 1}: unknown part`);
      if (c.type === 'clearance') continue;
      if (c.b === ground) throw err(`constraint ${c.i + 1}: the first part "${ground}" is fixed; put it as "a"`);
      if (c.type === 'fixed') { const T = fixedTarget(parts[c.a], parts[c.b]); poseTo(parts[c.b], T.R, T.t); continue; }
      if (c.type === 'mate' || c.type === 'flush' || c.type === 'planar') {
        const fa = faceOf(parts[c.a], c.a_face), fb = faceOf(parts[c.b], c.b_face);
        if (fa.a !== fb.a) throw err(`constraint ${c.i + 1}: faces are on different axes`);
        if ((c.type === 'mate' || c.type === 'planar') && fa.dir === fb.dir) throw err(`constraint ${c.i + 1}: a ${c.type} joint needs faces pointing at each other`);
        if (c.type === 'flush' && fa.dir !== fb.dir) throw err(`constraint ${c.i + 1}: flush faces must point the same way`);
        moveBy(parts[c.b], fa.a, -residual(parts, c));
      } else if (c.type === 'align') {
        if (!(c.axis in AX)) throw err(`constraint ${c.i + 1}: axis must be x, y or z`);
        moveBy(parts[c.b], AX[c.axis], -residual(parts, c));
      } else if (c.type === 'concentric' || c.type === 'revolute') {
        const fa = axisOf(parts[c.a], c.a_axis), fb = axisOf(parts[c.b], c.b_axis);
        const r = axisResidual(fa, fb);
        if (r.angle_deg > 1e-6) throw err(`constraint ${c.i + 1}: the axes "${c.a_axis}" and "${c.b_axis}" are not parallel (${r.angle_deg.toFixed(3)} deg); turn part "${c.b}" in the spec first`);
        for (let a = 0; a < 3; a++) if (Math.abs(r.perp[a]) > 0) moveBy(parts[c.b], a, -r.perp[a]);
        if (c.type === 'revolute') {
          if (c.range && !(Array.isArray(c.range) && c.range.length === 2 && +c.range[0] <= +c.range[1])) throw err(`constraint ${c.i + 1}: range must be [low, high] in degrees`);
          if (c.range && ((Number(c.angle) || 0) < +c.range[0] - 1e-9 || (Number(c.angle) || 0) > +c.range[1] + 1e-9)) throw err(`constraint ${c.i + 1}: the angle ${c.angle} is outside the range ${c.range.join('..')}`);
          const f = axisOf(parts[c.a], c.a_axis);
          rotateBy(parts[c.b], f.p, f.d, -wrap(relAngle(parts[c.a], parts[c.b], f.d) - (Number(c.angle) || 0)));
        }
      } else if (c.type === 'slider' || c.type === 'cylindrical') {
        const fa = axisOf(parts[c.a], c.a_axis), r = axisResidual(fa, axisOf(parts[c.b], c.b_axis));
        if (r.angle_deg > 1e-6) throw err(`constraint ${c.i + 1}: the axes "${c.a_axis}" and "${c.b_axis}" are not parallel (${r.angle_deg.toFixed(3)} deg); turn part "${c.b}" in the spec first`);
        if (c.type === 'slider' && c.range && !(Array.isArray(c.range) && c.range.length === 2 && +c.range[0] <= +c.range[1])) throw err(`constraint ${c.i + 1}: range must be [low, high] in mm`);
        if (c.type === 'slider' && c.range && ((Number(c.offset) || 0) < +c.range[0] - 1e-9 || (Number(c.offset) || 0) > +c.range[1] + 1e-9)) throw err(`constraint ${c.i + 1}: the offset ${c.offset || 0} is outside the travel ${c.range.join('..')}`);
        for (let a = 0; a < 3; a++) if (Math.abs(r.perp[a]) > 0) moveBy(parts[c.b], a, -r.perp[a]);
        if (c.type === 'slider' || c.angle !== undefined) rotateBy(parts[c.b], fa.p, fa.d, -wrap(relAngle(parts[c.a], parts[c.b], fa.d) - (Number(c.angle) || 0)));
        if (c.type === 'slider' || c.offset !== undefined) {
          const along = (Number(c.offset) || 0) - axialOffset(fa, axisOf(parts[c.b], c.b_axis));
          for (let a = 0; a < 3; a++) if (Math.abs(fa.d[a] * along) > 0) moveBy(parts[c.b], a, fa.d[a] * along);
        }
      } else if (c.type === 'angle') {
        const f = axisOf(parts[c.a], c.axis);
        rotateBy(parts[c.b], f.p, f.d, -residual(parts, c));
      } else throw err(`constraint ${c.i + 1}: unknown type "${c.type}"`);
    }
    // verification after solving
    const checked = cons.map((c) => {
      if (c.type === 'clearance') {
        const R = Math.max(Number(c.min) || 0, 0.01) * 2 + 1;
        // ignore_contact: faces lying in the plane of a mate between the same two parts are resting contact, not clearance
        const planes = c.ignore_contact ? cons.filter((m) => m.type === 'mate' && ((m.a === c.a && m.b === c.b) || (m.a === c.b && m.b === c.a))).map((m) => { const f = faceOf(parts[m.b], m.b_face); return [f.a, f.at]; }) : [];
        const skip = planes.length ? (P) => planes.some(([a, at]) => P.every((v) => Math.abs(v[a] - at) < 1e-6)) : null;
        const d = minDistance(parts[c.a].mesh, parts[c.b].mesh, R, skip);
        return { ...c, measured_mm: d.below ? +d.distance.toFixed(4) : `>= ${R}`, ok: !d.below || d.distance >= (Number(c.min) || 0) - 1e-9 };
      }
      const r = residual(parts, c);
      if (c.type === 'angle') return { ...c, residual_deg: +r.toFixed(6), ok: Math.abs(r) < 1e-6 };
      if (c.type === 'concentric' || c.type === 'cylindrical' || c.type === 'fixed') return { ...c, residual: +r.toFixed(6), ok: Math.abs(r) < 1e-6 };
      if (c.type === 'slider') {
        const out = { ...c, residual: +r.toFixed(6), ok: Math.abs(r) < 1e-6 };
        if (c.range) { out.sweep = sweep(parts, order, c); out.ok = out.ok && out.sweep.every((s) => !s.hits.length); }
        return out;
      }
      if (c.type === 'revolute') {
        const out = { ...c, residual: +r.toFixed(6), ok: Math.abs(r) < 1e-6 };
        if (c.range) { out.sweep = sweep(parts, order, c); out.ok = out.ok && out.sweep.every((s) => !s.hits.length); }
        return out;
      }
      return { ...c, residual_mm: +r.toFixed(6), ok: Math.abs(r) < 1e-6 };
    });
    // interference: exact boolean intersection of every pair whose boxes overlap
    const interference = [];
    for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) {
      const A = parts[order[i]], B = parts[order[j]];
      const vol = interferenceVolume(A, B);
      if (vol > 1e-3) interference.push({ a: A.id, b: B.id, volume_mm3: +vol.toFixed(3) });
    }
    // bill of materials (each line is a printed part; volumes and estimates are measured on the mesh)
    const bomMap = new Map();
    for (const id of order) {
      const P = parts[id], est = AN.estimate(P.result.mesh, { ...(P.spec.design.print || {}), material: P.material });
      const k = P.spec.bom_key || (P.spec.design.name_ar || id) + '|' + JSON.stringify(P.spec.values || {}) + '|' + P.material;
      const row = bomMap.get(k) || { item: bomMap.size + 1, name_ar: P.spec.design.name_ar || P.name_ar, parts: [], qty: 0, material: P.material, mass_g_each: est.mass_g, time_min_each: est.time_min, size_mm: P.result.size_mm };
      row.parts.push(id); row.qty += P.qty; bomMap.set(k, row);
    }
    const bom = [...bomMap.values()];
    const totals = { parts: bom.reduce((s, r) => s + r.qty, 0), mass_g: +bom.reduce((s, r) => s + r.qty * r.mass_g_each, 0).toFixed(1), time_min: bom.reduce((s, r) => s + r.qty * r.time_min_each, 0) };
    const box = boundsOf(order.flatMap((id) => [parts[id].box.lo, parts[id].box.hi]));
    return {
      name_ar: spec.name_ar || 'تجميعة', order, parts, constraints: checked, interference, bom, totals,
      size_mm: [0, 1, 2].map((a) => +(box.hi[a] - box.lo[a]).toFixed(3)),
      ok: checked.every((c) => c.ok) && !interference.length,
    };
  }

  function exploded(asm, factor = 1) {
    const centre = (b) => [0, 1, 2].map((a) => (b.lo[a] + b.hi[a]) / 2);
    const all = boundsOf(asm.order.flatMap((id) => [asm.parts[id].box.lo, asm.parts[id].box.hi])), c0 = centre(all);
    const span = Math.max(...[0, 1, 2].map((a) => all.hi[a] - all.lo[a]));
    return Object.fromEntries(asm.order.map((id, i) => {
      let d = sub(centre(asm.parts[id].box), c0); const n = Math.hypot(...d);
      if (n < 1e-6) d = [0, 0, i ? 1 : 0]; else d = d.map((x) => x / n);
      return [id, d.map((x) => +(x * span * 0.35 * factor).toFixed(3))];
    }));
  }

  // parts in their assembled positions, for a multi-object 3MF of the whole assembly
  const placedParts = (asm, offsets) => asm.order.map((id) => {
    const P = asm.parts[id], o = (offsets && offsets[id]) || [0, 0, 0];
    return { name: P.name_ar, mesh: { vertices: P.mesh.vertices.map((v) => [v[0] + o[0], v[1] + o[1], v[2] + o[2]]), faces: P.mesh.faces } };
  });

  // ---------------------------------------------------------------- approval workflow (pure; the platform stores the result)
  // Each component is approved for one exact STL (its SHA-256). Changing a part makes only that part's approval stale.
  // The assembly can be approved once every component is approved for its current file; if the assembly check itself
  // failed (constraints, interference, range of motion) the approval needs a written reason.
  const stable = (v) => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v;
  /** The text whose SHA-256 identifies an assembly revision: the source spec plus every part's STL hash. */
  const canonicalRecord = (spec, partShas) => JSON.stringify(stable({ spec, parts: partShas }));
  function approvalGate(report, partShas, approvals, names) {
    const ids = (report && report.order) || Object.keys(partShas || {});
    const parts = ids.map((id) => {
      const a = (approvals || {})[id], sha = (partShas || {})[id];
      return { id, name_ar: (names && names[id]) || id, sha, approved: !!(a && sha && a.sha === sha), stale: !!(a && a.sha !== sha), by: a ? a.by : null, at: a ? a.at : null, note: a ? a.note || '' : '' };
    });
    const problems = [];
    for (const c of (report && report.constraints) || []) if (!c.ok) problems.push(c.sweep && c.sweep.some((s) => s.hits.length) ? `${c.type} ${c.a}-${c.b}: collides at ${c.sweep.filter((s) => s.hits.length).map((s) => (s.offset !== undefined ? s.offset + ' mm' : s.angle + '°')).join(', ')}` : `${c.type} ${c.a}-${c.b} not satisfied`);
    for (const i of (report && report.interference) || []) problems.push(`interference ${i.a}-${i.b}: ${i.volume_mm3} mm3`);
    const missing = parts.filter((x) => !x.approved).map((x) => x.id);
    return { parts, missing, problems, allApproved: !missing.length && parts.length > 0, reportOk: !!(report && report.ok) && !problems.length, ready: !missing.length && parts.length > 0, needsReason: !(report && report.ok) || problems.length > 0 };
  }
  function approveComponent(approvals, id, sha, by, note, at) {
    if (!id || !sha) throw err('approving a component needs its id and the SHA-256 of its STL');
    return { ...(approvals || {}), [id]: { sha, by, note: note || '', at: at || Date.now() } };
  }
  /** One print job for an approved assembly: every part with its own material, quantity and approved hash. */
  function printParts(spec, report, approvedPartShas, sets) {
    const n = Math.max(1, Math.min(50, Math.floor(Number(sets) || 1)));
    const byId = Object.fromEntries((spec.parts || []).map((p) => [p.id, p]));
    const mat = {}; for (const r of (report && report.bom) || []) for (const id of r.parts) mat[id] = r.material;
    return (report.order || []).map((id) => {
      if (!approvedPartShas || !approvedPartShas[id]) throw err(`part "${id}" has no approved file`);
      const P = byId[id] || {};
      return { id, name_ar: P.name_ar || (P.design && P.design.name_ar) || id, qty: Math.max(1, P.qty || 1) * n, material: mat[id] || 'PLA', approvedSha: approvedPartShas[id] };
    });
  }

  const api = { assemble, exploded, minDistance, placedParts, rotateXYZ, canonicalRecord, approvalGate, approveComponent, printParts };
  if (node) module.exports = api;
  else root.FormaAssembly = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
