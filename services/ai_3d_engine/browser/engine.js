/*
 * ai_3d_engine — browser build.
 *
 * A line-by-line JavaScript port of services/ai_3d_engine (Python): spec parser,
 * BSP-CSG kernel, parametric templates, STL writer/reader and the
 * mesh_validation_service checks. It exists so the studio can run in a
 * browser with no server. tests/node/engine-parity.test.ts runs the same
 * prompts through both implementations and requires matching results.
 *
 * Units: millimetres. Exposes `Engine3D` (browser global) / module.exports (Node).
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------------ vectors
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => Math.hypot(a[0], a[1], a[2]);

  // ------------------------------------------------------------------ CSG (BSP)
  const EPS = 1e-5;
  const COPLANAR = 0, FRONT = 1, BACK = 2, SPANNING = 3;

  class Plane {
    constructor(normal, w) { this.normal = normal; this.w = w; }
    static fromPoints(a, b, c) {
      let n = cross(sub(b, a), sub(c, a));
      n = mul(n, 1 / norm(n));
      return new Plane(n, dot(n, a));
    }
    flipped() { return new Plane(mul(this.normal, -1), -this.w); }
    splitPolygon(poly, coplanarFront, coplanarBack, front, back) {
      const types = [];
      let polygonType = 0;
      for (const p of poly.points) {
        const d = dot(this.normal, p) - this.w;
        const t = d < -EPS ? BACK : d > EPS ? FRONT : COPLANAR;
        polygonType |= t;
        types.push(t);
      }
      if (polygonType === COPLANAR) {
        (dot(this.normal, poly.plane.normal) > 0 ? coplanarFront : coplanarBack).push(poly);
      } else if (polygonType === FRONT) front.push(poly);
      else if (polygonType === BACK) back.push(poly);
      else {
        const f = [], b = [];
        const pts = poly.points, n = pts.length;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const ti = types[i], tj = types[j], vi = pts[i], vj = pts[j];
          if (ti !== BACK) f.push(vi);
          if (ti !== FRONT) b.push(vi);
          if ((ti | tj) === SPANNING) {
            const t = (this.w - dot(this.normal, vi)) / dot(this.normal, sub(vj, vi));
            const v = add(vi, mul(sub(vj, vi), t));
            f.push(v); b.push(v);
          }
        }
        if (f.length >= 3) front.push(new Polygon(f, poly.plane));
        if (b.length >= 3) back.push(new Polygon(b, poly.plane));
      }
    }
  }

  class Polygon {
    constructor(points, plane) {
      this.points = points;
      this.plane = plane || Plane.fromPoints(points[0], points[1], points[2]);
    }
    flipped() { return new Polygon(this.points.slice().reverse(), this.plane.flipped()); }
    clone() { return new Polygon(this.points.map((p) => p.slice()), this.plane); }
  }

  class Node {
    constructor(polygons) {
      this.plane = null; this.front = null; this.back = null; this.polygons = [];
      if (polygons) this.build(polygons);
    }
    invert() {
      const stack = [this];
      while (stack.length) {
        const n = stack.pop();
        n.polygons = n.polygons.map((p) => p.flipped());
        if (n.plane) n.plane = n.plane.flipped();
        const t = n.front; n.front = n.back; n.back = t;
        if (n.front) stack.push(n.front);
        if (n.back) stack.push(n.back);
      }
    }
    clipPolygons(polygons) {
      if (!this.plane) return polygons.slice();
      let front = [], back = [];
      for (const p of polygons) this.plane.splitPolygon(p, front, back, front, back);
      if (this.front) front = this.front.clipPolygons(front);
      back = this.back ? this.back.clipPolygons(back) : [];
      return front.concat(back);
    }
    clipTo(bsp) {
      const stack = [this];
      while (stack.length) {
        const n = stack.pop();
        n.polygons = bsp.clipPolygons(n.polygons);
        if (n.front) stack.push(n.front);
        if (n.back) stack.push(n.back);
      }
    }
    allPolygons() {
      const out = [], stack = [this];
      while (stack.length) {
        const n = stack.pop();
        out.push(...n.polygons);
        if (n.front) stack.push(n.front);
        if (n.back) stack.push(n.back);
      }
      return out;
    }
    build(polygons) {
      const work = [[this, polygons]];
      while (work.length) {
        const [node, polys] = work.pop();
        if (!polys.length) continue;
        if (!node.plane) node.plane = polys[0].plane;
        const front = [], back = [];
        for (const p of polys) node.plane.splitPolygon(p, node.polygons, node.polygons, front, back);
        if (front.length) { if (!node.front) node.front = new Node(); work.push([node.front, front]); }
        if (back.length) { if (!node.back) node.back = new Node(); work.push([node.back, back]); }
      }
    }
  }

  function rotation(axis, degrees) {
    const a = (degrees * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const m = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
    if (axis === 'x') { m[1][1] = c; m[1][2] = -s; m[2][1] = s; m[2][2] = c; }
    else if (axis === 'y') { m[0][0] = c; m[0][2] = s; m[2][0] = -s; m[2][2] = c; }
    else if (axis === 'z') { m[0][0] = c; m[0][1] = -s; m[1][0] = s; m[1][1] = c; }
    else throw new Error('unknown axis ' + axis);
    return m;
  }
  const det3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const apply = (m, p) => [0, 1, 2].map((r) => m[r][0] * p[0] + m[r][1] * p[1] + m[r][2] * p[2] + m[r][3]);

  class Solid {
    constructor(polygons) { this.polygons = polygons; }
    clonePolys() { return this.polygons.map((p) => p.clone()); }
    union(other) {
      const a = new Node(this.clonePolys()), b = new Node(other.clonePolys());
      a.clipTo(b); b.clipTo(a); b.invert(); b.clipTo(a); b.invert(); a.build(b.allPolygons());
      return new Solid(a.allPolygons());
    }
    subtract(other) {
      const a = new Node(this.clonePolys()), b = new Node(other.clonePolys());
      a.invert(); a.clipTo(b); b.clipTo(a); b.invert(); b.clipTo(a); b.invert(); a.build(b.allPolygons()); a.invert();
      return new Solid(a.allPolygons());
    }
    intersect(other) {
      const a = new Node(this.clonePolys()), b = new Node(other.clonePolys());
      a.invert(); b.clipTo(a); b.invert(); a.clipTo(b); b.clipTo(a); a.build(b.allPolygons()); a.invert();
      return new Solid(a.allPolygons());
    }
    transformed(m) {
      const flip = det3(m) < 0;
      return new Solid(this.polygons.map((p) => {
        let pts = p.points.map((q) => apply(m, q));
        if (flip) pts = pts.reverse();
        return new Polygon(pts);
      }));
    }
    translated(x = 0, y = 0, z = 0) {
      return this.transformed([[1, 0, 0, x], [0, 1, 0, y], [0, 0, 1, z], [0, 0, 0, 1]]);
    }
    rotated(axis, deg) { return this.transformed(rotation(axis, deg)); }
    toMesh(weld = 1e-4) {
      const verts = [], faces = [];
      for (const p of this.polygons) {
        const base = verts.length;
        verts.push(...p.points);
        for (let k = 1; k < p.points.length - 1; k++) faces.push([base, base + k, base + k + 1]);
      }
      if (!faces.length) return new Mesh([], []);
      let mesh = new Mesh(verts, faces).merged(weld).withoutDegenerate(1e-10);
      return removeTJunctions(mesh, weld * 5);
    }
  }

  function boundaryHalfEdges(faces) {
    const count = new Map();
    const key = (a, b) => (a < b ? a + ',' + b : b + ',' + a);
    for (const f of faces) for (let k = 0; k < 3; k++) { const kk = key(f[k], f[(k + 1) % 3]); count.set(kk, (count.get(kk) || 0) + 1); }
    const out = [];
    faces.forEach((f, fi) => { for (let k = 0; k < 3; k++) { const a = f[k], b = f[(k + 1) % 3]; if (count.get(key(a, b)) === 1) out.push([fi, a, b]); } });
    return out;
  }

  function removeTJunctions(mesh, tol = 5e-4, maxPasses = 20) {
    const verts = mesh.vertices.map((v) => v.slice());
    let faces = mesh.faces.map((f) => f.slice());
    for (let pass = 0; pass < maxPasses; pass++) {
      const boundary = boundaryHalfEdges(faces);
      if (!boundary.length) break;
      const splitMap = new Map();
      for (const [fi, a, b] of boundary) {
        const pa = verts[a], d = sub(verts[b], pa), l2 = dot(d, d);
        if (l2 === 0) continue;
        const inside = [];
        for (let i = 0; i < verts.length; i++) {
          if (i === a || i === b) continue;
          const t = dot(sub(verts[i], pa), d) / l2;
          if (t <= 1e-9 || t >= 1 - 1e-9) continue;
          if (norm(sub(verts[i], add(pa, mul(d, t)))) < tol) inside.push([t, i]);
        }
        if (inside.length) {
          inside.sort((x, y) => x[0] - y[0]);
          if (!splitMap.has(fi)) splitMap.set(fi, new Map());
          splitMap.get(fi).set(a, inside.map((x) => x[1]));
        }
      }
      if (!splitMap.size) break;
      const nf = [];
      faces.forEach((f, fi) => {
        if (!splitMap.has(fi)) { nf.push(f); return; }
        const poly = [];
        for (let k = 0; k < 3; k++) { poly.push(f[k]); poly.push(...(splitMap.get(fi).get(f[k]) || [])); }
        const centre = verts.length;
        verts.push([0, 1, 2].map((ax) => (verts[f[0]][ax] + verts[f[1]][ax] + verts[f[2]][ax]) / 3));
        for (let k = 0; k < poly.length; k++) nf.push([centre, poly[k], poly[(k + 1) % poly.length]]);
      });
      faces = nf;
    }
    return new Mesh(verts, faces).withoutDegenerate(1e-12);
  }

  // ------------------------------------------------------------------ mesh
  class Mesh {
    constructor(vertices, faces) { this.vertices = vertices; this.faces = faces; }
    get isEmpty() { return this.faces.length === 0; }
    tri(f) { return [this.vertices[f[0]], this.vertices[f[1]], this.vertices[f[2]]]; }
    faceNormalRaw(f) { const [a, b, c] = this.tri(f); return cross(sub(b, a), sub(c, a)); }
    faceArea(f) { return 0.5 * norm(this.faceNormalRaw(f)); }
    bounds() {
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      const used = new Set(); for (const f of this.faces) for (const i of f) used.add(i);
      for (const i of used) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], this.vertices[i][a]); hi[a] = Math.max(hi[a], this.vertices[i][a]); }
      return used.size ? [lo, hi] : [[0, 0, 0], [0, 0, 0]];
    }
    signedVolume() {
      let v = 0;
      for (const f of this.faces) { const [a, b, c] = this.tri(f); v += dot(a, cross(b, c)); }
      return v / 6;
    }
    merged(tol) {
      const map = new Map(), verts = [], remap = new Array(this.vertices.length);
      this.vertices.forEach((v, i) => {
        const k = Math.round(v[0] / tol) + ',' + Math.round(v[1] / tol) + ',' + Math.round(v[2] / tol);
        if (!map.has(k)) { map.set(k, verts.length); verts.push(v); }
        remap[i] = map.get(k);
      });
      return new Mesh(verts, this.faces.map((f) => f.map((i) => remap[i]))).compact();
    }
    mergedExact() {
      const map = new Map(), verts = [], remap = [];
      this.vertices.forEach((v, i) => { const k = v.join(','); if (!map.has(k)) { map.set(k, verts.length); verts.push(v); } remap[i] = map.get(k); });
      return new Mesh(verts, this.faces.map((f) => f.map((i) => remap[i])));
    }
    compact() {
      const used = new Map(), verts = [];
      const faces = this.faces.map((f) => f.map((i) => { if (!used.has(i)) { used.set(i, verts.length); verts.push(this.vertices[i]); } return used.get(i); }));
      return new Mesh(verts, faces);
    }
    withoutDegenerate(eps = 1e-12) {
      return new Mesh(this.vertices, this.faces.filter((f) => f[0] !== f[1] && f[1] !== f[2] && f[0] !== f[2] && this.faceArea(f) > eps));
    }
    translated(o) { return new Mesh(this.vertices.map((v) => add(v, o)), this.faces); }
    asFloat32() { return new Mesh(this.vertices.map((v) => v.map(Math.fround)), this.faces); }
  }

  // ------------------------------------------------------------------ primitives
  function box(sx, sy, sz, origin = [0, 0, 0]) {
    if (Math.min(sx, sy, sz) <= 0) throw new Error('box dimensions must be positive');
    const [x0, y0, z0] = origin, x1 = x0 + sx, y1 = y0 + sy, z1 = z0 + sz;
    const c = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [3, 0, 4, 7]];
    return new Solid(quads.map((q) => new Polygon(q.map((i) => c[i].slice()))));
  }

  function cylinder(radius, height, center = [0, 0, 0], axis = 'z', segments = 48) {
    if (radius <= 0 || height <= 0) throw new Error('cylinder radius/height must be positive');
    const ring = [];
    for (let i = 0; i < segments; i++) { const a = (2 * Math.PI * i) / segments; ring.push([radius * Math.cos(a), radius * Math.sin(a), 0]); }
    const top = ring.map((p) => [p[0], p[1], height]);
    const polys = [new Polygon(ring.slice().reverse()), new Polygon(top.map((p) => p.slice()))];
    for (let i = 0; i < segments; i++) { const j = (i + 1) % segments; polys.push(new Polygon([ring[i], ring[j], top[j], top[i]].map((p) => p.slice()))); }
    let s = new Solid(polys);
    if (axis === 'x') s = s.rotated('y', 90);
    else if (axis === 'y') s = s.rotated('x', -90);
    return s.translated(...center);
  }

  function hole(diameter, depth, center, axis = 'z', segments = 48) {
    return cylinder(diameter / 2 / Math.cos(Math.PI / segments), depth, center, axis, segments);
  }

  /** convex (y, z) profile extruded along +x */
  function prism(profile, length, offset = 0) {
    let pts = profile.map((p) => p.slice());
    let area = 0;
    for (let i = 0; i < pts.length; i++) { const j = (i + 1) % pts.length; area += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]; }
    if (area < 0) pts.reverse();
    const a = pts.map((p) => [offset, p[0], p[1]]), b = a.map((p) => [p[0] + length, p[1], p[2]]);
    const polys = [new Polygon(a.slice().reverse().map((p) => p.slice())), new Polygon(b.map((p) => p.slice()))];
    for (let i = 0; i < a.length; i++) { const j = (i + 1) % a.length; polys.push(new Polygon([a[i], a[j], b[j], b[i]].map((p) => p.slice()))); }
    return new Solid(polys);
  }

  // ------------------------------------------------------------------ templates
  const P = (name, def, min, max, unit, ar, en, aliases = []) => ({ name, default: def, min, max, unit, label_ar: ar, label_en: en, aliases });
  const g = (v) => String(+Number(v).toFixed(6));

  function phoneStand(p) {
    const W = p.width, H = p.height, a = (p.tilt_angle * Math.PI) / 180, t = p.thickness, lip = p.lip_height, gap = p.phone_thickness;
    const y0 = t + gap;
    const length = (H - t) / Math.sin(a) + t;
    const up = [Math.cos(a), Math.sin(a)], back = [Math.sin(a), -Math.cos(a)];
    const p0 = [y0, t], p1 = [y0 + up[0] * length, t + up[1] * length];
    const p2 = [p1[0] + back[0] * t, p1[1] + back[1] * t], p3 = [p0[0] + back[0] * t, p0[1] + back[1] * t];
    let plate = prism([p0, p1, p2, p3], W);
    const topY = Math.max(p1[0], p2[0]);
    const depth = Math.max(p.base_depth, topY + 4);
    plate = plate.intersect(box(W + 2, depth + 20, H, [-1, -10, 0]));
    const base = box(W, depth, t), frontLip = box(W, t, t + lip);
    const gw = Math.min(10, W / 5);
    const underY = y0 + t / Math.sin(a), hb = 0.45 * (H - t), sink = 0.5 * t;
    const ay = underY - back[0] * sink, az = t - back[1] * sink;
    const by = underY + hb / Math.tan(a) - back[0] * sink, bz = t + hb - back[1] * sink;
    const cy = underY + hb / Math.tan(a);
    const profile = [[ay, t - 0.01], [cy, t - 0.01], [cy, bz - (cy - by) * Math.tan(a)], [by, bz], [ay, az]];
    const gussets = prism(profile, gw).union(prism(profile, gw, W - gw));
    let solid = base.union(frontLip).union(plate).union(gussets);
    if (p.charging_slot >= 0.5) {
      const s = p.slot_width;
      solid = solid.subtract(box(s, y0 + t + 2, t + lip + 2, [W / 2 - s / 2, -1, -1]));
    }
    return solid;
  }

  function openBox(p) {
    const L = p.length, W = p.width, H = p.height, t = p.wall, f = p.floor;
    let solid = box(L, W, H).subtract(box(L - 2 * t, W - 2 * t, H, [t, t, f]));
    const n = Math.round(p.dividers);
    if (n > 0) {
      const pitch = (L - 2 * t) / (n + 1);
      for (let i = 1; i <= n; i++) {
        const x = t + pitch * i - t / 2;
        solid = solid.union(box(t, W - 2 * t + 0.02, H - f > 6 ? H - f - 2 : H - f, [x, t - 0.01, f - 0.01]));
      }
    }
    return solid;
  }

  function lBracket(p) {
    const W = p.width, A = p.leg_a, B = p.leg_b, t = p.thickness, d = p.hole_diameter;
    let solid = box(W, A, t).union(box(W, t, B));
    if (p.gusset >= 0.5) {
      const gg = Math.min(A, B) * 0.6, gw = Math.min(t, W / 4);
      solid = solid.union(prism([[t - 0.01, t - 0.01], [t + gg, t - 0.01], [t - 0.01, t + gg]], gw, W / 2 - gw / 2));
    }
    const n = Math.round(p.holes_per_leg);
    if (n > 0 && d > 0) {
      for (let i = 0; i < n; i++) {
        let x = (W * (i + 1)) / (n + 1);
        if (n === 1 && p.gusset >= 0.5) x = W * 0.25;
        solid = solid.subtract(hole(d, t + 2, [x, t + (A - t) / 2, -1], 'z'));
        solid = solid.subtract(hole(d, t + 2, [x, -1, t + (B - t) / 2], 'y'));
      }
    }
    return solid;
  }

  function spacer(p) {
    const od = p.outer_diameter, id = p.inner_diameter, h = p.height;
    if (id >= od - 1) throw new Error('inner diameter must be at least 1 mm smaller than outer diameter');
    const outer = cylinder(od / 2, h, [od / 2, od / 2, 0], 'z', 96);
    return id <= 0 ? outer : outer.subtract(hole(id, h + 2, [od / 2, od / 2, -1], 'z', 96));
  }

  function wallHook(p) {
    const W = p.width, H = p.plate_height, t = p.thickness, L = p.reach, tip = p.tip_height;
    let solid = box(W, t, H).union(box(W, L + t, t)).union(box(W, t, tip + t, [0, L, 0]));
    if (p.screw_diameter > 0) for (const z of [H * 0.45, H * 0.8]) solid = solid.subtract(hole(p.screw_diameter, t + 2, [W / 2, -1, z], 'y'));
    solid = solid.rotated('x', 90);
    const b = solid.toMesh().bounds();
    return solid.translated(-b[0][0], -b[0][1], -b[0][2]);
  }

  const TEMPLATES = {
    phone_stand: {
      key: 'phone_stand', title_ar: 'حامل هاتف مكتبي', title_en: 'Desk phone stand',
      keywords: ['حامل هاتف', 'حامل جوال', 'حامل موبايل', 'حامل للهاتف', 'حامل الهاتف', 'ستاند', 'phone stand', 'phone holder', 'mobile stand', 'phone dock'],
      params: [P('width', 90, 40, 220, 'mm', 'العرض', 'Width', ['عرض', 'width', 'wide']), P('height', 110, 50, 250, 'mm', 'الارتفاع', 'Height', ['ارتفاع', 'طول', 'height', 'tall', 'high']),
        P('tilt_angle', 65, 45, 85, 'deg', 'زاوية الميل', 'Tilt angle', ['زاوية', 'ميل', 'angle', 'tilt']), P('base_depth', 80, 50, 200, 'mm', 'عمق القاعدة', 'Base depth', ['عمق', 'depth', 'deep']),
        P('thickness', 5, 2, 12, 'mm', 'السماكة', 'Wall thickness', ['سماكة', 'سمك', 'thickness', 'thick']), P('lip_height', 12, 4, 30, 'mm', 'ارتفاع الحافة', 'Lip height', ['حافة', 'lip']),
        P('phone_thickness', 12, 7, 25, 'mm', 'سماكة الهاتف', 'Phone thickness (with case)'), P('charging_slot', 0, 0, 1, 'bool', 'فتحة شحن', 'Charging cable slot'),
        P('slot_width', 14, 8, 30, 'mm', 'عرض فتحة الشحن', 'Cable slot width')],
      build: phoneStand, keyParams: ['width', 'height', 'tilt_angle'],
      requirements: (p) => {
        const r = [`The stand shall be ${g(p.width)} mm wide (X) and ${g(p.height)} mm tall (Z).`, `The phone rest shall lean back at ${g(p.tilt_angle)}° from horizontal.`,
          `The ledge shall accept a phone up to ${g(p.phone_thickness)} mm thick behind a ${g(p.lip_height)} mm lip.`, `All load-bearing walls shall be ${g(p.thickness)} mm thick.`];
        if (p.charging_slot >= 0.5) r.push(`A ${g(p.slot_width)} mm cable slot shall pass through the lip and base under the phone's port.`);
        return r;
      },
    },
    open_box: {
      key: 'open_box', title_ar: 'علبة مفتوحة / منظّم', title_en: 'Open box / organiser',
      keywords: ['علبة', 'صندوق', 'منظم', 'منظّم', 'حاوية', 'box', 'container', 'organizer', 'organiser', 'tray', 'bin'],
      params: [P('length', 100, 15, 220, 'mm', 'الطول', 'Length', ['طول', 'length', 'long']), P('width', 60, 15, 220, 'mm', 'العرض', 'Width', ['عرض', 'width', 'wide']),
        P('height', 40, 8, 200, 'mm', 'الارتفاع', 'Height', ['ارتفاع', 'عمق', 'height', 'tall', 'deep']), P('wall', 2, 1.2, 8, 'mm', 'سماكة الجدار', 'Wall thickness', ['سماكة', 'سمك', 'جدار', 'wall', 'thickness']),
        P('floor', 2, 1.2, 8, 'mm', 'سماكة القاع', 'Floor thickness', ['قاع', 'أرضية', 'floor', 'bottom']), P('dividers', 0, 0, 8, 'count', 'عدد الفواصل', 'Dividers', ['فواصل', 'أقسام', 'dividers', 'compartments'])],
      build: openBox, keyParams: ['length', 'width', 'height'],
      requirements: (p) => {
        const r = [`Outer size shall be ${g(p.length)} × ${g(p.width)} × ${g(p.height)} mm.`, `Inner cavity shall be ${g(p.length - 2 * p.wall)} × ${g(p.width - 2 * p.wall)} × ${g(p.height - p.floor)} mm (open top).`,
          `Walls shall be ${g(p.wall)} mm and the floor ${g(p.floor)} mm thick.`];
        if (Math.round(p.dividers)) r.push(`The cavity shall be split by ${Math.round(p.dividers)} evenly spaced dividers.`);
        return r;
      },
    },
    l_bracket: {
      key: 'l_bracket', title_ar: 'زاوية تثبيت L', title_en: 'L bracket',
      keywords: ['زاوية تثبيت', 'كتيفة', 'زاوية حديد', 'زاوية رف', 'حامل رف', 'bracket', 'angle bracket', 'corner brace', 'shelf bracket'],
      params: [P('width', 30, 10, 200, 'mm', 'العرض', 'Width', ['عرض', 'width', 'wide']), P('leg_a', 50, 15, 200, 'mm', 'طول الضلع الأفقي', 'Horizontal leg', ['ضلع', 'طول', 'length', 'leg']),
        P('leg_b', 50, 15, 200, 'mm', 'طول الضلع العمودي', 'Vertical leg', ['ارتفاع', 'height']), P('thickness', 5, 2, 15, 'mm', 'السماكة', 'Thickness', ['سماكة', 'سمك', 'thickness', 'thick']),
        P('hole_diameter', 4.5, 0, 12, 'mm', 'قطر الثقب', 'Hole diameter', ['قطر', 'ثقب', 'براغي', 'diameter', 'hole', 'screw']), P('holes_per_leg', 2, 0, 4, 'count', 'عدد الثقوب لكل ضلع', 'Holes per leg', ['ثقوب', 'فتحات', 'holes']),
        P('gusset', 1, 0, 1, 'bool', 'دعامة مثلثة', 'Gusset')],
      build: lBracket, keyParams: ['width', 'leg_a', 'leg_b'],
      requirements: (p) => {
        const r = [`Each leg shall be ${g(p.width)} mm wide and ${g(p.thickness)} mm thick.`, `Legs shall measure ${g(p.leg_a)} mm (horizontal) and ${g(p.leg_b)} mm (vertical) at 90°.`];
        const n = Math.round(p.holes_per_leg);
        if (n) r.push(`Each leg shall have ${n} clearance hole(s) of at least ${g(p.hole_diameter)} mm.`);
        if (p.gusset >= 0.5) r.push('A triangular gusset shall stiffen the inside corner.');
        return r;
      },
    },
    spacer: {
      key: 'spacer', title_ar: 'حلقة / فاصل / وردة', title_en: 'Spacer / washer',
      keywords: ['حلقة', 'فاصل', 'وردة', 'جلبة', 'spacer', 'washer', 'ring', 'bushing', 'standoff'],
      params: [P('outer_diameter', 20, 4, 200, 'mm', 'القطر الخارجي', 'Outer diameter', ['قطر خارجي', 'outer diameter', 'od']), P('inner_diameter', 8, 0, 190, 'mm', 'القطر الداخلي', 'Inner diameter', ['قطر داخلي', 'inner diameter', 'id', 'bore']),
        P('height', 5, 0.8, 150, 'mm', 'الارتفاع', 'Height', ['ارتفاع', 'سماكة', 'سمك', 'height', 'thickness', 'thick'])],
      build: spacer, keyParams: ['outer_diameter', 'inner_diameter', 'height'],
      requirements: (p) => [`Outer diameter shall be ${g(p.outer_diameter)} mm and height ${g(p.height)} mm.`, `The bore shall be at least ${g(p.inner_diameter)} mm (polygon circumscribed so it is never undersized).`],
    },
    wall_hook: {
      key: 'wall_hook', title_ar: 'علّاقة جدارية', title_en: 'Wall hook',
      keywords: ['علاقة', 'علّاقة', 'خطاف', 'شماعة', 'تعليق', 'hook', 'hanger', 'wall hook'],
      params: [P('width', 25, 10, 120, 'mm', 'العرض', 'Width', ['عرض', 'width', 'wide']), P('plate_height', 60, 25, 200, 'mm', 'ارتفاع اللوح', 'Plate height', ['ارتفاع', 'طول', 'height', 'tall']),
        P('thickness', 5, 3, 12, 'mm', 'السماكة', 'Thickness', ['سماكة', 'سمك', 'thickness', 'thick']), P('reach', 35, 10, 120, 'mm', 'البروز عن الجدار', 'Reach', ['بروز', 'عمق', 'reach', 'depth']),
        P('tip_height', 12, 4, 60, 'mm', 'ارتفاع الطرف', 'Tip height', ['طرف', 'tip']), P('screw_diameter', 4.5, 0, 8, 'mm', 'قطر البرغي', 'Screw hole diameter', ['قطر', 'برغي', 'براغي', 'screw', 'diameter'])],
      build: wallHook, keyParams: ['width', 'plate_height', 'reach'],
      requirements: (p) => [`The mounting plate shall be ${g(p.width)} × ${g(p.plate_height)} mm, ${g(p.thickness)} mm thick.`, `The hook shall reach ${g(p.reach)} mm from the wall with a ${g(p.tip_height)} mm retaining tip.`,
        p.screw_diameter > 0 ? `Two screw holes of at least ${g(p.screw_diameter)} mm shall be provided.` : 'No screw holes (adhesive mount).'],
    },
  };

  // ------------------------------------------------------------------ spec parser
  const AR_DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9', '٫': '.' };
  const UNIT_TO_MM = { mm: 1, 'مم': 1, 'ملم': 1, 'ملليمتر': 1, 'مليمتر': 1, 'ملي': 1, cm: 10, 'سم': 10, 'سنتيمتر': 10, 'سانتيمتر': 10, 'سنتي': 10, in: 25.4, inch: 25.4, inches: 25.4, 'انش': 25.4, 'إنش': 25.4 };
  const NUM = '(\\d+(?:\\.\\d+)?)';
  const UNIT_REQ = '(mm|cm|inch(?:es)?|in|millimet(?:er|re)s?|centimet(?:er|re)s?|مم|ملم|ملليمتر|مليمتر|ملي|سم|سنتيمتر|سانتيمتر|سنتي|انش|إنش)';
  const UNIT = UNIT_REQ + '?';
  const GAP = '[^\\d\\n,،;]{0,25}?';
  const DEG = '(?:°|درجة|درجه|deg(?:rees?)?)';
  const isArabic = (s) => /[؀-ۿ]/.test(s);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function normalize(text) {
    return text.replace(/[٠-٩۰-۹٫]/g, (c) => AR_DIGITS[c]).replace(/[ً-ْـ]/g, '')
      .replace(/[×*]/g, 'x').replace(/[أإآ]/g, 'ا');
  }
  function detectLanguage(t) { return (t.match(/[؀-ۿ]/g) || []).length >= (t.match(/[A-Za-z]/g) || []).length ? 'ar' : 'en'; }
  function toMm(v, unit) {
    if (!unit) return v;
    const u = unit.toLowerCase();
    if (u.startsWith('millimet')) return v;
    if (u.startsWith('centimet')) return v * 10;
    return v * (UNIT_TO_MM[u] ?? 1);
  }
  function aliasRe(alias) {
    const a = esc(normalize(alias).toLowerCase());
    return isArabic(alias) ? `(?:[وب]?(?:ال)?${a})` : `\\b${a}\\b`;
  }
  const round3 = (x) => Math.round(x * 1000) / 1000;

  function chooseTemplate(text) {
    const t = normalize(text).toLowerCase();
    let best = null, len = 0;
    for (const tpl of Object.values(TEMPLATES)) for (const kw of tpl.keywords) {
      const k = normalize(kw).toLowerCase();
      if (t.includes(k) && k.length > len) { best = tpl; len = k.length; }
    }
    return best;
  }

  function extractRuleBased(prompt, tpl) {
    const text = normalize(prompt).toLowerCase();
    const found = {};
    for (const p of tpl.params) {
      if (p.unit === 'bool' || p.unit === 'count' || !p.aliases.length) continue;
      for (const alias of p.aliases) {
        let suffix, prefix;
        if (p.unit === 'deg') {
          suffix = new RegExp(NUM + '\\s*' + DEG + '\\s*' + aliasRe(alias));
          prefix = new RegExp(aliasRe(alias) + GAP + NUM + '\\s*' + DEG + '?');
        } else {
          suffix = new RegExp(NUM + '\\s*' + UNIT_REQ + '\\s*(?:of\\s+)?' + aliasRe(alias));
          prefix = new RegExp(aliasRe(alias) + GAP + NUM + '\\s*' + UNIT);
        }
        const m = isArabic(alias) ? text.match(prefix) : (text.match(suffix) || text.match(prefix));
        if (m) {
          let v = parseFloat(m[1]);
          if (p.unit === 'mm') v = toMm(v, m[2]);
          if (!(p.name in found)) found[p.name] = { value: round3(v), source: 'prompt', note: `read from '${m[0].trim()}'` };
          break;
        }
      }
    }
    const tri = text.match(new RegExp(NUM + '\\s*x\\s*' + NUM + '(?:\\s*x\\s*' + NUM + ')?\\s*' + UNIT));
    if (tri) {
      const nums = [tri[1], tri[2], tri[3]].filter(Boolean);
      const keys = tpl.keyParams.filter((k) => tpl.params.find((q) => q.name === k).unit === 'mm');
      keys.forEach((k, i) => { if (i < nums.length && !(k in found)) found[k] = { value: round3(toMm(parseFloat(nums[i]), tri[4])), source: 'prompt', note: `read from '${tri[0].trim()}'` }; });
    }
    if (tpl.key === 'phone_stand' && /شحن|كيبل|كابل|سلك|charg|cable|usb/.test(text)) found.charging_slot = { value: 1, source: 'prompt', note: 'charging/cable opening requested' };
    if (tpl.key === 'l_bracket' && /بدون دعام|بلا دعام|no gusset|without gusset/.test(text)) found.gusset = { value: 0, source: 'prompt', note: 'gusset explicitly not wanted' };
    if (tpl.key === 'wall_hook' && /لاصق|بدون براغي|adhesive|no screw/.test(text)) found.screw_diameter = { value: 0, source: 'prompt', note: 'adhesive mount, no screw holes' };
    const words = { 'واحد': 1, 'اثنين': 2, 'اثنان': 2, 'ثلاث': 3, 'اربع': 4, 'خمس': 5, one: 1, two: 2, three: 3, four: 4, five: 5 };
    for (const p of tpl.params) {
      if (p.unit !== 'count' || p.name in found) continue;
      for (const alias of p.aliases) {
        const a = esc(normalize(alias).toLowerCase());
        const m = text.match(new RegExp(NUM + '\\s*' + a)) || text.match(new RegExp('([^\\s]+)\\s+' + a));
        if (m) {
          const raw = m[1];
          const v = /^\d+(?:\.\d+)?$/.test(raw) ? parseFloat(raw) : words[raw];
          if (v !== undefined) { found[p.name] = { value: v, source: 'prompt', note: `read from '${m[0].trim()}'` }; break; }
        }
      }
    }
    return found;
  }

  const USE = [['functional', /وظيف|قطعة غيار|تثبيت|حمل|يتحمل|functional|mount|load|bracket|holder/], ['artistic', /فني|زخرف|تمثال|ديكور|مجسم فني|artistic|decorative|sculpture|figurine|statue/], ['prototype', /نموذج اولي|بروتوتايب|prototype|mockup/]];

  function parse(prompt, userFields = {}, templateKey = null) {
    if (!prompt || !prompt.trim()) throw new Error('prompt is empty');
    const tpl = templateKey ? TEMPLATES[templateKey] : chooseTemplate(prompt);
    const lang = detectLanguage(prompt);
    const t = normalize(prompt).toLowerCase();
    const use = (USE.find(([, re]) => re.test(t)) || [tpl ? 'functional' : 'artistic'])[0];
    const spec = { prompt, language: lang, template: tpl ? tpl.key : null, template_title: tpl ? (lang === 'ar' ? tpl.title_ar : tpl.title_en) : null,
      intended_use: use, params: {}, requirements: [], assumptions: [], clarifications: [], errors: [], extractor: 'rules', template_schema: tpl ? schema(tpl) : null };
    if (!tpl) {
      spec.clarifications.push(lang === 'ar' ? 'لم يُطابق الوصف قالبًا هندسيًا دقيقًا؛ سيتطلب توليدًا حرًا (مزود AI خارجي) دون ضمان أبعاد دقيقة.'
        : 'No precise parametric template matches; this needs free-form AI generation without guaranteed dimensions.');
      return spec;
    }
    const fromText = extractRuleBased(prompt, tpl);
    for (const p of tpl.params) {
      if (userFields[p.name] != null && Number.isFinite(+userFields[p.name])) spec.params[p.name] = { value: +userFields[p.name], source: 'user_field', note: null };
      else if (fromText[p.name]) spec.params[p.name] = fromText[p.name];
      else {
        spec.params[p.name] = { value: p.default, source: 'default', note: null };
        if (tpl.keyParams.includes(p.name)) {
          const label = lang === 'ar' ? p.label_ar : p.label_en;
          spec.assumptions.push(lang === 'ar' ? `${label}: لم يُذكر، استُخدمت القيمة الافتراضية ${g(p.default)} ${p.unit}` : `${label}: not given, default ${g(p.default)} ${p.unit} used`);
          spec.clarifications.push(lang === 'ar' ? `ما ${label} المطلوب (${p.unit})؟` : `What ${label.toLowerCase()} do you need (${p.unit})?`);
        }
      }
    }
    for (const p of tpl.params) {
      const v = spec.params[p.name].value;
      if (v < p.min || v > p.max) spec.errors.push(`${p.name}=${g(v)}${p.unit} outside allowed range [${g(p.min)}, ${g(p.max)}]`);
    }
    if (!spec.errors.length) spec.requirements = tpl.requirements(values(spec));
    return spec;
  }
  const values = (spec) => Object.fromEntries(Object.entries(spec.params).map(([k, v]) => [k, v.value]));
  const schema = (t) => ({ key: t.key, title_ar: t.title_ar, title_en: t.title_en, key_params: t.keyParams,
    params: t.params.map((p) => ({ name: p.name, default: p.default, min: p.min, max: p.max, unit: p.unit, label_ar: p.label_ar, label_en: p.label_en })) });

  // ------------------------------------------------------------------ validation
  function edgeInfo(faces) {
    const map = new Map();
    faces.forEach((f, fi) => { for (let k = 0; k < 3; k++) { const a = f[k], b = f[(k + 1) % 3]; const key = a < b ? a + ',' + b : b + ',' + a; if (!map.has(key)) map.set(key, []); map.get(key).push([fi, a, b]); } });
    return map;
  }

  function analyse(mesh) {
    const out = { vertex_count: mesh.vertices.length, triangle_count: mesh.faces.length };
    if (!mesh.faces.length) return out;
    const edges = edgeInfo(mesh.faces);
    let boundary = 0, nonManifold = 0, inconsistent = 0;
    for (const hs of edges.values()) {
      if (hs.length === 1) boundary++;
      else if (hs.length > 2) nonManifold++;
      else if (hs[0][1] === hs[1][1]) inconsistent++;
    }
    Object.assign(out, { edge_count: edges.size, boundary_edges: boundary, non_manifold_edges: nonManifold, inconsistent_winding_edges: inconsistent });
    let degenerate = 0; const seen = new Set(); let dup = 0;
    for (const f of mesh.faces) {
      if (f[0] === f[1] || f[1] === f[2] || f[0] === f[2] || mesh.faceArea(f) <= 1e-12) degenerate++;
      const k = f.slice().sort((a, b) => a - b).join(','); if (seen.has(k)) dup++; else seen.add(k);
    }
    out.degenerate_faces = degenerate; out.duplicate_faces = dup;
    const parent = mesh.vertices.map((_, i) => i);
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    for (const f of mesh.faces) { parent[find(f[1])] = find(f[0]); parent[find(f[2])] = find(f[0]); }
    const roots = new Set(); for (const f of mesh.faces) roots.add(find(f[0]));
    out.bodies = roots.size;
    const [lo, hi] = mesh.bounds();
    out.size_mm = { x: round3(hi[0] - lo[0]), y: round3(hi[1] - lo[1]), z: round3(hi[2] - lo[2]) };
    out.surface_area_mm2 = round3(mesh.faces.reduce((s, f) => s + mesh.faceArea(f), 0));
    out.watertight = boundary === 0 && nonManifold === 0;
    const vol = mesh.signedVolume();
    out.signed_volume_mm3 = round3(vol);
    out.volume_mm3 = out.watertight ? round3(Math.abs(vol)) : null;
    return out;
  }

  function orient(mesh) {
    const faces = mesh.faces.map((f) => f.slice());
    const nb = faces.map(() => []);
    for (const hs of edgeInfo(faces).values()) if (hs.length === 2) {
      const same = hs[0][1] === hs[1][1];
      nb[hs[0][0]].push([hs[1][0], same]); nb[hs[1][0]].push([hs[0][0], same]);
    }
    const flip = new Array(faces.length).fill(false), seen = new Array(faces.length).fill(false);
    for (let s = 0; s < faces.length; s++) {
      if (seen[s]) continue; seen[s] = true; const st = [s];
      while (st.length) { const c = st.pop(); for (const [n, same] of nb[c]) if (!seen[n]) { seen[n] = true; flip[n] = flip[c] !== same; st.push(n); } }
    }
    let flipped = 0;
    faces.forEach((f, i) => { if (flip[i]) { f.reverse(); flipped++; } });
    return [new Mesh(mesh.vertices, faces), flipped];
  }

  function repair(mesh) {
    const applied = [];
    const before = mesh.vertices.length;
    let m = mesh.merged(1e-4);
    if (m.vertices.length !== before) applied.push(`welded ${before - m.vertices.length} duplicate vertices (tol 0.0001 mm)`);
    const bf = m.faces.length; m = m.withoutDegenerate();
    if (m.faces.length !== bf) applied.push(`removed ${bf - m.faces.length} degenerate faces`);
    const groups = new Map();
    m.faces.forEach((f, i) => { const k = f.slice().sort((a, b) => a - b).join(','); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); });
    const keep = new Array(m.faces.length).fill(true); let removed = 0;
    for (const idx of groups.values()) if (idx.length > 1) { idx.forEach((i, j) => { if (!(idx.length % 2 === 1 && j === 0)) { keep[i] = false; removed++; } }); }
    if (removed) { m = new Mesh(m.vertices, m.faces.filter((_, i) => keep[i])); applied.push(`removed ${removed} duplicate/cancelling faces`); }
    if (m.isEmpty) return [m, applied];
    const [o, flipped] = orient(m); m = o;
    if (flipped) applied.push(`re-oriented ${flipped} faces for consistent winding`);
    if (analyse(m).watertight && m.signedVolume() < 0) { m = new Mesh(m.vertices, m.faces.map((f) => f.slice().reverse())); applied.push('flipped all normals (mesh was inside-out)'); }
    return [m, applied];
  }

  function minWall(mesh, samples = 400) {
    if (mesh.isEmpty || mesh.faces.length > 400000) return null;
    let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const areas = mesh.faces.map((f) => mesh.faceArea(f)), total = areas.reduce((a, b) => a + b, 0);
    if (total <= 0) return null;
    const cum = []; let acc = 0; for (const a of areas) { acc += a; cum.push(acc / total); }
    const tris = mesh.faces.map((f) => mesh.tri(f));
    const normals = mesh.faces.map((f) => { const n = mesh.faceNormalRaw(f); const l = norm(n) || 1; return mul(n, 1 / l); });
    const picks = new Set(), n = Math.min(samples, mesh.faces.length);
    for (let guard = 0; picks.size < n && guard < n * 20; guard++) { const r = rnd(); let lo = 0, hi = cum.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid; } picks.add(lo); }
    const hits = [];
    for (const fi of picks) {
      const [a, b, c] = tris[fi];
      const origin = sub(mul(add(add(a, b), c), 1 / 3), mul(normals[fi], 1e-4)), d = mul(normals[fi], -1);
      let best = Infinity;
      for (let j = 0; j < tris.length; j++) {
        if (j === fi) continue;
        const [v0, v1, v2] = tris[j], e1 = sub(v1, v0), e2 = sub(v2, v0), p = cross(d, e2), det = dot(e1, p);
        if (Math.abs(det) <= 1e-12) continue;
        const inv = 1 / det, s = sub(origin, v0), u = dot(s, p) * inv;
        if (u < 0 || u > 1) continue;
        const q = cross(s, e1), v = dot(d, q) * inv;
        if (v < 0 || u + v > 1) continue;
        const t = dot(e2, q) * inv;
        if (t > 1e-6 && t < best) best = t;
      }
      if (best < Infinity) hits.push(best);
    }
    if (!hits.length) return null;
    hits.sort((x, y) => x - y);
    const pos = 0.02 * (hits.length - 1), i = Math.floor(pos), f = pos - i;
    return round3(hits[i] + (hits[Math.min(i + 1, hits.length - 1)] - hits[i]) * f);
  }

  const DEFAULT_CONSTRAINTS = { build_volume_mm: [220, 220, 250], min_wall_thickness_mm: 0.8, nozzle_diameter_mm: 0.4 };

  function validate(mesh, constraints = DEFAULT_CONSTRAINTS, attemptRepair = true) {
    const c = { ...DEFAULT_CONSTRAINTS, ...constraints };
    const t0 = Date.now();
    const report = { status: 'VALIDATION_FAILED', checks: {}, issues: [], repairs_applied: [], stats: {},
      checks_not_performed: ['self_intersections: not detected by this checker; the slicer and designer review must catch them', 'overhangs_and_supports: evaluated by the slicer, not here'] };
    const done = () => { report.duration_ms = Date.now() - t0; return [mesh, report]; };
    try {
      if (mesh.isEmpty) { report.status = 'INVALID'; report.issues.push({ code: 'EMPTY_MESH', severity: 'error', message: 'The file contains no triangles.', count: null }); return done(); }
      report.checks.before_repair = analyse(mesh);
      if (attemptRepair) [mesh, report.repairs_applied] = repair(mesh);
      const info = analyse(mesh); report.checks.final = info;
      report.stats = { triangles: info.triangle_count, vertices: info.vertex_count, size_mm: info.size_mm, volume_mm3: info.volume_mm3, surface_area_mm2: info.surface_area_mm2, bodies: info.bodies };
      let errors = 0, warnings = 0;
      const issue = (code, severity, message, count = null) => { report.issues.push({ code, severity, message, count }); severity === 'error' ? errors++ : warnings++; };
      if (info.boundary_edges) issue('OPEN_EDGES', 'error', 'Surface has holes (open edges); it does not enclose a volume.', info.boundary_edges);
      if (info.non_manifold_edges) issue('NON_MANIFOLD_EDGES', 'error', 'Edges shared by more than two faces.', info.non_manifold_edges);
      if (info.inconsistent_winding_edges) issue('INCONSISTENT_NORMALS', 'error', 'Face orientation could not be made consistent.', info.inconsistent_winding_edges);
      if (info.watertight && info.signed_volume_mm3 <= 0) { report.status = 'INVALID'; report.issues.push({ code: 'ZERO_VOLUME', severity: 'error', message: 'Closed surface encloses no positive volume.', count: null }); return done(); }
      if (info.bodies > 1) issue('MULTIPLE_BODIES', 'warning', 'Mesh has several separate bodies; confirm this is intended.', info.bodies);
      const s = info.size_mm, bv = c.build_volume_mm;
      if (s.x > bv[0] || s.y > bv[1] || s.z > bv[2]) {
        const fits = [s.x, s.y, s.z].sort((a, b) => a - b).every((d, i) => d <= bv.slice().sort((a, b) => a - b)[i]);
        issue('EXCEEDS_BUILD_VOLUME', 'warning', `Size ${s.x}×${s.y}×${s.z} mm exceeds build volume ${bv.join('×')} mm${fits ? ' in this orientation (fits if rotated).' : '.'}`);
      }
      if (Math.min(s.x, s.y, s.z) < c.nozzle_diameter_mm * 2) issue('FEATURE_TOO_THIN', 'warning', `Thinnest overall dimension ${Math.min(s.x, s.y, s.z)} mm is below two nozzle widths.`);
      if (info.watertight && !errors) {
        const w = minWall(mesh); info.estimated_min_wall_mm = w; report.stats.estimated_min_wall_mm = w;
        if (w !== null && w < c.min_wall_thickness_mm) issue('THIN_WALLS', 'warning', `Estimated thinnest wall ≈${w} mm is below the ${c.min_wall_thickness_mm} mm minimum (sampled estimate).`);
      } else report.checks_not_performed.push('wall_thickness: needs a closed surface');
      report.status = errors ? 'REPAIR_REQUIRED' : warnings ? 'VALID_WITH_WARNINGS' : 'VALIDATED';
      return done();
    } catch (e) {
      report.status = 'VALIDATION_FAILED'; report.issues.push({ code: 'CHECKER_ERROR', severity: 'error', message: String(e && e.message || e), count: null });
      return done();
    }
  }

  // ------------------------------------------------------------------ STL I/O
  function writeStl(mesh, header = 'ai_3d_engine binary STL, units=mm') {
    const n = mesh.faces.length, buf = new ArrayBuffer(84 + 50 * n), dv = new DataView(buf);
    for (let i = 0; i < 80; i++) dv.setUint8(i, i < header.length ? header.charCodeAt(i) & 0x7f : 32);
    dv.setUint32(80, n, true);
    mesh.faces.forEach((f, i) => {
      const tri = mesh.tri(f).map((v) => v.map(Math.fround));
      let nr = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0])); const l = norm(nr); nr = l > 0 ? mul(nr, 1 / l) : [0, 0, 0];
      const o = 84 + i * 50;
      for (let a = 0; a < 3; a++) dv.setFloat32(o + a * 4, nr[a], true);
      for (let v = 0; v < 3; v++) for (let a = 0; a < 3; a++) dv.setFloat32(o + 12 + v * 12 + a * 4, tri[v][a], true);
      dv.setUint16(o + 48, 0, true);
    });
    return new Uint8Array(buf);
  }

  function readStl(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const n = dv.getUint32(80, true);
    if (bytes.byteLength !== 84 + 50 * n) throw new Error('not a binary STL (size mismatch)');
    const verts = [], faces = [];
    for (let i = 0; i < n; i++) {
      const o = 84 + i * 50 + 12;
      for (let v = 0; v < 3; v++) verts.push([dv.getFloat32(o + v * 12, true), dv.getFloat32(o + v * 12 + 4, true), dv.getFloat32(o + v * 12 + 8, true)]);
      faces.push([i * 3, i * 3 + 1, i * 3 + 2]);
    }
    return new Mesh(verts, faces).mergedExact();
  }

  async function sha256Hex(bytes) {
    if (root.crypto && root.crypto.subtle) {
      const h = await root.crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    return sha256Pure(bytes); // non-secure contexts have no crypto.subtle
  }

  function sha256Pure(bytes) {
    const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const len = bytes.length, total = Math.ceil((len + 9) / 64) * 64, m = new Uint8Array(total);
    m.set(bytes); m[len] = 0x80;
    const dv = new DataView(m.buffer); dv.setUint32(total - 4, (len * 8) >>> 0); dv.setUint32(total - 8, Math.floor(len / 0x20000000));
    const w = new Uint32Array(64), r = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < total; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g2, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g2)) + K[i] + w[i]) >>> 0;
        const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g2; g2 = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g2; H[7] += h;
    }
    return Array.from(H).map((x) => x.toString(16).padStart(8, '0')).join('');
  }

  // ------------------------------------------------------------------ pipeline
  class PipelineError extends Error { constructor(code, message, details) { super(message); this.code = code; this.details = details; } }

  async function generateParametric(spec, constraints = DEFAULT_CONSTRAINTS) {
    const t0 = Date.now();
    if (!spec.template) throw new PipelineError('NO_TEMPLATE', 'No parametric template matches this description.', spec.clarifications);
    if (spec.errors.length) throw new PipelineError('INVALID_PARAMETERS', 'Some parameters are outside the allowed range.', spec.errors);
    let mesh;
    try { mesh = TEMPLATES[spec.template].build(values(spec)).toMesh(); }
    catch (e) { throw new PipelineError('INVALID_PARAMETERS', e.message); }
    const [lo] = mesh.bounds(); const transforms = [];
    if (lo.some((x) => Math.abs(x) > 1e-9)) {
      mesh = mesh.translated(lo.map((x) => -x));
      transforms.push(`translated by (${lo.map((x) => (-x).toFixed(3)).join(', ')}) mm to sit on the build plate at the origin`);
    }
    const [repaired, report] = validate(mesh.asFloat32(), constraints, true);
    if (report.status === 'INVALID' || report.status === 'VALIDATION_FAILED') throw new PipelineError('GEOMETRY_INVALID', 'The generated geometry failed validation.', report);
    const stl = writeStl(repaired);
    const reopened = readStl(stl);
    const [, post] = validate(reopened, constraints, false);
    const size = post.stats.size_mm;
    const axisOf = { phone_stand: { width: 'x', height: 'z', base_depth: 'y' }, open_box: { length: 'x', width: 'y', height: 'z' }, wall_hook: { width: 'x' }, spacer: { outer_diameter: 'x', height: 'z' } }[spec.template] || {};
    for (const [name, axis] of Object.entries(axisOf)) {
      const pv = spec.params[name];
      if (pv && size && Math.abs(size[axis] - pv.value) > 0.05) transforms.push(`${name}: requested ${g(pv.value)} mm (${pv.source}), built ${g(size[axis])} mm on ${axis.toUpperCase()} — derived from other parameters to keep the part stable/valid`);
    }
    return { status: post.status, stl, mesh: reopened, stl_sha256: await sha256Hex(stl), size_mm: size, triangles: post.stats.triangles,
      validation: report, post_export_validation: post, transforms, spec, duration_ms: Date.now() - t0 };
  }

  const fromPolygons = (polys) => new Solid(polys.map((pts) => new Polygon(pts.map((q) => q.slice()))));
  const api = { fromPolygons, rotation, parse, generateParametric, validate, analyse, writeStl, readStl, TEMPLATES, PipelineError, Mesh, Solid, box, cylinder, hole, prism, normalize, sha256Hex };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine3D = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
