/*
 * FormaViewer — a small self-contained WebGL viewer for printable parts (no libraries, works offline).
 * Z is up, millimetres. Build plate grid + build volume, flat-shaded part, optional per-face colours,
 * orbit / pan / zoom with mouse and touch, CPU ray picking, measurement markers, and 4-view snapshots.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- 4x4 matrices (column-major, as WebGL expects)
  const M = {
    mul(a, b) { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; },
    persp(fovy, aspect, near, far) { const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far); return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]); },
    ortho(l, r, b, t, n, f) { return new Float32Array([2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]); },
    lookAt(eye, at, up) {
      const z = norm(sub(eye, at)), x = norm(cross(up, z)), y = cross(z, x);
      return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
    },
    invert(m) {
      const inv = new Float32Array(16), a = m;
      inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
      inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
      inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
      inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
      inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
      inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
      inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
      inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
      inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
      inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
      inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
      inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
      inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
      inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
      inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
      inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
      let det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12]; det = det ? 1 / det : 0;
      for (let i = 0; i < 16; i++) inv[i] *= det;
      return inv;
    },
    apply(m, v) { const w = m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15]; return [(m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12]) / w, (m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13]) / w, (m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]) / w]; },
  };
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function mulS(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function rgb(css) {
    const c = document.createElement('canvas').getContext('2d'); c.fillStyle = '#000'; c.fillStyle = css; const h = c.fillStyle;
    if (/^#[0-9a-f]{6}$/i.test(h)) return [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
    const m = h.match(/\d+(\.\d+)?/g); return m ? [m[0] / 255, m[1] / 255, m[2] / 255] : [0.25, 0.5, 0.56];
  }

  // section clipping: fragments with dot(world, clip.xyz) > clip.w are cut away; the inside of the part (back faces
  // seen through the cut) is drawn in the cut colour so the section reads as solid material
  const VS_MESH = `attribute vec3 p; attribute vec3 n; attribute vec3 c; uniform mat4 mvp; uniform vec3 off; varying vec3 vn; varying vec3 vc; varying vec3 wp;
    void main(){ vn=n; vc=c; wp=p+off; gl_Position=mvp*vec4(p+off,1.0); }`;
  const FS_MESH = `precision mediump float; varying vec3 vn; varying vec3 vc; varying vec3 wp; uniform vec3 base; uniform float useC; uniform vec3 L;
    uniform vec4 clip; uniform float useClip;
    void main(){ if(useClip>0.5 && dot(wp,clip.xyz)>clip.w) discard;
      if(!gl_FrontFacing){ gl_FragColor=vec4(0.80,0.33,0.28,1.0); return; }
      vec3 col=mix(base,vc,useC); vec3 N=normalize(vn); float d=max(dot(N,normalize(L)),0.0); float h=0.5+0.5*N.z;
      vec3 amb=mix(vec3(0.32,0.34,0.37),vec3(0.62,0.63,0.64),h); gl_FragColor=vec4(col*(amb+0.55*d),1.0); }`;
  const VS_LINE = `attribute vec3 p; uniform mat4 mvp; uniform float ps; uniform vec3 off; varying vec3 wp; void main(){ wp=p+off; gl_Position=mvp*vec4(p+off,1.0); gl_PointSize=ps; }`;
  const FS_LINE = `precision mediump float; uniform vec4 col; uniform float round; varying vec3 wp; uniform vec4 clip; uniform float useClip;
    void main(){ if(useClip>0.5 && dot(wp,clip.xyz)>clip.w) discard; if(round>0.5){ vec2 q=gl_PointCoord-0.5; if(dot(q,q)>0.25) discard; } gl_FragColor=col; }`;

  function program(gl, vs, fs) {
    const mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; };
    const pr = gl.createProgram(); gl.attachShader(pr, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    return pr;
  }

  /** Renderer bound to one canvas. */
  function makeRenderer(canvas, opts = {}) {
    const gl = canvas.getContext('webgl', { antialias: true, alpha: true, preserveDrawingBuffer: !!opts.preserve }) || canvas.getContext('experimental-webgl');
    if (!gl) throw new Error('WebGL unavailable');
    const pm = program(gl, VS_MESH, FS_MESH), pl = program(gl, VS_LINE, FS_LINE);
    const loc = (p, n) => gl.getAttribLocation(p, n), uni = (p, n) => gl.getUniformLocation(p, n);
    const buf = (data) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b; };
    const R = { gl, mesh: null, lines: [], overlay: [], wire: null, base: [0.24, 0.49, 0.56], useColors: false, clip: null };
    const setClip = (prog, on) => { gl.uniform1f(uni(prog, 'useClip'), on && R.clip ? 1 : 0); gl.uniform4fv(uni(prog, 'clip'), R.clip || [0, 0, 1, 0]); };
    R.setMesh = (positions) => {
      if (R.mesh) { gl.deleteBuffer(R.mesh.p); gl.deleteBuffer(R.mesh.n); gl.deleteBuffer(R.mesh.c); }
      if (!positions) { R.mesh = null; return; }
      const n = new Float32Array(positions.length);
      for (let i = 0; i < positions.length; i += 9) {
        const a = [positions[i], positions[i + 1], positions[i + 2]], b = [positions[i + 3], positions[i + 4], positions[i + 5]], c = [positions[i + 6], positions[i + 7], positions[i + 8]];
        const f = norm(cross(sub(b, a), sub(c, a)));
        for (let k = 0; k < 3; k++) n.set(f, i + k * 3);
      }
      R.mesh = { p: buf(positions), n: buf(n), c: buf(new Float32Array(positions.length)), count: positions.length / 3 };
    };
    R.setColors = (colors) => { if (!R.mesh) return; R.useColors = !!colors; if (colors) { gl.bindBuffer(gl.ARRAY_BUFFER, R.mesh.c); gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW); } };
    R.setLines = (segments, color, alpha) => { R.lines.forEach((l) => gl.deleteBuffer(l.b)); R.lines = segments ? [{ b: buf(new Float32Array(segments)), count: segments.length / 3, col: [...color, alpha] }] : []; };
    R.addLines = (segments, color, alpha) => { R.lines.push({ b: buf(new Float32Array(segments)), count: segments.length / 3, col: [...color, alpha] }); };
    // wireframe: every triangle edge once (shared edges deduplicated), drawn over the solid with the part's offset
    R.setWire = (positions) => {
      if (R.wire) { gl.deleteBuffer(R.wire.b); R.wire = null; }
      if (!positions) return;
      const seen = new Set(), seg = [], key = (i) => `${positions[i].toFixed(4)},${positions[i + 1].toFixed(4)},${positions[i + 2].toFixed(4)}`;
      for (let t = 0; t < positions.length; t += 9) for (let e = 0; e < 3; e++) {
        const i = t + e * 3, j = t + ((e + 1) % 3) * 3, a = key(i), b = key(j), k = a < b ? a + '|' + b : b + '|' + a;
        if (seen.has(k)) continue; seen.add(k);
        seg.push(positions[i], positions[i + 1], positions[i + 2], positions[j], positions[j + 1], positions[j + 2]);
      }
      R.wire = { b: buf(new Float32Array(seg)), count: seg.length / 3, edges: seg.length / 6 };
    };
    R.setOverlay = (points, lineColor) => { R.overlay.forEach((o) => gl.deleteBuffer(o.b)); R.overlay = points && points.length ? [{ b: buf(new Float32Array(points.flat())), count: points.length, col: lineColor }] : []; };
    R.draw = (mvp, off, clear) => {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(clear[0], clear[1], clear[2], clear[3]); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(pl);
      gl.uniformMatrix4fv(uni(pl, 'mvp'), false, mvp); gl.uniform1f(uni(pl, 'ps'), 1); gl.uniform1f(uni(pl, 'round'), 0);
      gl.uniform3fv(uni(pl, 'off'), [0, 0, 0]); setClip(pl, false);
      const lp = loc(pl, 'p');
      for (const l of R.lines) { gl.bindBuffer(gl.ARRAY_BUFFER, l.b); gl.enableVertexAttribArray(lp); gl.vertexAttribPointer(lp, 3, gl.FLOAT, false, 0, 0); gl.uniform4fv(uni(pl, 'col'), l.col); gl.drawArrays(gl.LINES, 0, l.count); }
      if (R.mesh) {
        gl.useProgram(pm);
        gl.uniformMatrix4fv(uni(pm, 'mvp'), false, mvp); gl.uniform3fv(uni(pm, 'off'), off); gl.uniform3fv(uni(pm, 'base'), R.base);
        gl.uniform1f(uni(pm, 'useC'), R.useColors ? 1 : 0); gl.uniform3fv(uni(pm, 'L'), [0.45, -0.6, 0.8]); setClip(pm, true);
        [['p', R.mesh.p], ['n', R.mesh.n], ['c', R.mesh.c]].forEach(([name, b]) => { const a = loc(pm, name); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 3, gl.FLOAT, false, 0, 0); });
        gl.drawArrays(gl.TRIANGLES, 0, R.mesh.count);
        ['c', 'n'].forEach((name) => gl.disableVertexAttribArray(loc(pm, name)));
      }
      if (R.mesh && R.wire) {
        gl.useProgram(pl); gl.uniformMatrix4fv(uni(pl, 'mvp'), false, mvp); gl.uniform3fv(uni(pl, 'off'), off); setClip(pl, true);
        gl.uniform1f(uni(pl, 'round'), 0); gl.uniform4fv(uni(pl, 'col'), [0.08, 0.1, 0.12, 0.55]);
        gl.bindBuffer(gl.ARRAY_BUFFER, R.wire.b); gl.enableVertexAttribArray(lp); gl.vertexAttribPointer(lp, 3, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.LINES, 0, R.wire.count);
      }
      if (R.overlay.length) {
        gl.disable(gl.DEPTH_TEST); gl.useProgram(pl);
        gl.uniformMatrix4fv(uni(pl, 'mvp'), false, mvp); gl.uniform3fv(uni(pl, 'off'), [0, 0, 0]); setClip(pl, false);
        for (const o of R.overlay) {
          gl.bindBuffer(gl.ARRAY_BUFFER, o.b); gl.enableVertexAttribArray(lp); gl.vertexAttribPointer(lp, 3, gl.FLOAT, false, 0, 0);
          gl.uniform4fv(uni(pl, 'col'), o.col);
          if (o.count === 2) { gl.uniform1f(uni(pl, 'round'), 0); gl.drawArrays(gl.LINES, 0, 2); }
          gl.uniform1f(uni(pl, 'ps'), 11 * (window.devicePixelRatio || 1)); gl.uniform1f(uni(pl, 'round'), 1); gl.drawArrays(gl.POINTS, 0, o.count);
        }
      }
    };
    return R;
  }

  function gridSegments(w, d, step) {
    const s = [];
    for (let x = 0; x <= w + 1e-9; x += step) s.push(x, 0, 0, x, d, 0);
    for (let y = 0; y <= d + 1e-9; y += step) s.push(0, y, 0, w, y, 0);
    return s;
  }
  function boxSegments(w, d, h) {
    const P = [[0, 0, 0], [w, 0, 0], [w, d, 0], [0, d, 0], [0, 0, h], [w, 0, h], [w, d, h], [0, d, h]], E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    return E.flatMap(([a, b]) => [...P[a], ...P[b]]);
  }

  /** Interactive viewer inside `host`. */
  function create(host, opts = {}) {
    const bed = opts.bed || [220, 220, 250];
    const canvas = document.createElement('canvas');
    canvas.style.touchAction = 'none';
    host.prepend(canvas);
    const R = makeRenderer(canvas);
    const V = { R, canvas, positions: null, off: [0, 0, 0], target: [bed[0] / 2, bed[1] / 2, 30], dist: 520, theta: -0.66, phi: 0.95, mvp: null, markers: [], dirty: true, clear: [0, 0, 0, 0] };
    const lineCol = opts.lineColor || [0.54, 0.6, 0.65];
    R.setLines(gridSegments(bed[0], bed[1], 10), lineCol, 0.35);
    R.addLines(boxSegments(bed[0], bed[1], bed[2]), lineCol, 0.25);
    function camera() {
      const eye = [V.target[0] + V.dist * Math.sin(V.phi) * Math.cos(V.theta), V.target[1] + V.dist * Math.sin(V.phi) * Math.sin(V.theta), V.target[2] + V.dist * Math.cos(V.phi)];
      const aspect = canvas.width / Math.max(1, canvas.height);
      V.eye = eye;
      // orthographic: the same framing as the 35 degree perspective at the target distance
      const hh = V.dist * Math.tan((17.5 * Math.PI) / 180);
      const proj = V.ortho ? M.ortho(-hh * aspect, hh * aspect, -hh, hh, -V.dist * 20, V.dist * 20) : M.persp((35 * Math.PI) / 180, aspect, Math.max(0.5, V.dist / 200), V.dist * 20);
      V.mvp = M.mul(proj, M.lookAt(eye, V.target, [0, 0, 1]));
      return V.mvp;
    }
    function frame() { if (V.dirty) { V.dirty = false; R.draw(camera(), V.off, V.clear); } requestAnimationFrame(frame); }
    V.redraw = () => { V.dirty = true; };
    const resize = () => { const dpr = Math.min(2, window.devicePixelRatio || 1); canvas.width = Math.max(1, Math.round(host.clientWidth * dpr)); canvas.height = Math.max(1, Math.round(host.clientHeight * dpr)); V.redraw(); };
    (typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null)?.observe(host); resize();
    requestAnimationFrame(frame);

    // ---- orbit / pan / zoom (mouse, pen, touch)
    const ptrs = new Map(); let pinch = null;
    canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button, shift: e.shiftKey }); });
    canvas.addEventListener('pointermove', (e) => {
      const p = ptrs.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) V.dist = Math.min(4000, Math.max(5, V.dist * (pinch / d))); pinch = d; V.redraw(); return;
      }
      if (p.b === 2 || p.shift || e.ctrlKey) {
        const k = V.dist / canvas.clientHeight;
        const right = [-Math.sin(V.theta), Math.cos(V.theta), 0], up = [-Math.cos(V.phi) * Math.cos(V.theta), -Math.cos(V.phi) * Math.sin(V.theta), Math.sin(V.phi)];
        V.target = add(V.target, add(mulS(right, -dx * k), mulS(up, dy * k)));
      } else { V.theta -= dx * 0.008; V.phi = Math.min(Math.PI - 0.05, Math.max(0.05, V.phi - dy * 0.008)); }
      V.redraw();
    });
    const end = (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); V.dist = Math.min(4000, Math.max(5, V.dist * Math.exp(e.deltaY * 0.0012))); V.redraw(); }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    V.setBaseColor = (css) => { R.base = rgb(css); V.redraw(); };
    V.setMesh = (positions, off) => { V.positions = positions; V.off = off || [0, 0, 0]; R.setMesh(positions); if (V.wire) R.setWire(positions); V.redraw(); };
    V.setFaceColors = (flags, palette) => {
      if (!flags || !V.positions) { R.setColors(null); V.redraw(); return; }
      const col = new Float32Array(flags.length * 9);
      for (let i = 0; i < flags.length; i++) { const c = palette[flags[i]] || palette[0]; for (let k = 0; k < 3; k++) col.set(c, i * 9 + k * 3); }
      R.setColors(col); V.redraw();
    };
    V.fit = (size) => {
      const s = Math.max(size.x, size.y, size.z, 10);
      V.target = [bed[0] / 2, bed[1] / 2, size.z / 2]; V.dist = s * 3.1; V.theta = -0.95; V.phi = 1.05; V.redraw();
    };
    /** Ray from the camera through a client pixel; returns the nearest hit on the part (world coords) and its triangle. */
    V.pick = (clientX, clientY) => {
      if (!V.positions) return null;
      const r = canvas.getBoundingClientRect();
      const x = ((clientX - r.left) / r.width) * 2 - 1, y = -((clientY - r.top) / r.height) * 2 + 1;
      const inv = M.invert(camera());
      const a = M.apply(inv, [x, y, -1]), b = M.apply(inv, [x, y, 1]);
      const o = sub(a, V.off), d = norm(sub(b, a)), P = V.positions;
      let best = Infinity, face = -1;
      for (let i = 0; i < P.length; i += 9) {
        const v0 = [P[i], P[i + 1], P[i + 2]], e1 = [P[i + 3] - v0[0], P[i + 4] - v0[1], P[i + 5] - v0[2]], e2 = [P[i + 6] - v0[0], P[i + 7] - v0[1], P[i + 8] - v0[2]];
        const p = cross(d, e2), det = dot(e1, p); if (Math.abs(det) < 1e-12) continue;
        const s = sub(o, v0), u = dot(s, p) / det; if (u < 0 || u > 1) continue;
        const q = cross(s, e1), v = dot(d, q) / det; if (v < 0 || u + v > 1) continue;
        const t = dot(e2, q) / det; if (!(t > 1e-6 && t < best)) continue;
      if (R.clip) { const w = add(add(o, mulS(d, t)), V.off); if (dot(w, R.clip) > R.clip[3]) continue; } // cut away: not pickable
      best = t; face = i / 9;
      }
      if (face < 0) return null;
      const hit = add(add(o, mulS(d, best)), V.off);
      const verts = [0, 1, 2].map((k) => add([P[face * 9 + k * 3], P[face * 9 + k * 3 + 1], P[face * 9 + k * 3 + 2]], V.off));
      return { point: hit, face, verts };
    };
    V.ortho = false;
    V.setOrtho = (on) => { V.ortho = !!on; V.redraw(); };
    V.setWireframe = (on) => { R.setWire(on ? V.positions : null); V.wire = !!on; V.redraw(); return R.wire ? R.wire.edges : 0; };
    /** World-space bounds of the part as drawn (mm). */
    V.bounds = () => {
      if (!V.positions) return null;
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], P = V.positions;
      for (let i = 0; i < P.length; i += 3) for (let a = 0; a < 3; a++) { const v = P[i + a] + V.off[a]; if (v < lo[a]) lo[a] = v; if (v > hi[a]) hi[a] = v; }
      return { lo, hi };
    };
    /** Section: keep the part where the coordinate along axis ('x'|'y'|'z') is <= at (mm, world); null removes it. */
    V.setSection = (axis, at) => {
      if (!axis) R.clip = null;
      else { const n = [0, 0, 0]; n[{ x: 0, y: 1, z: 2 }[axis]] = 1; R.clip = [...n, at]; }
      V.redraw();
    };
    V.section = () => (R.clip ? { axis: 'xyz'[R.clip.findIndex((x, i) => i < 3 && x === 1)], at: R.clip[3] } : null);
    V.reset = (size) => { V.ortho = false; V.setSection(null); if (size) V.fit(size); };
    V.setMarkers = (pts) => { R.setOverlay(pts, [0.84, 0.27, 0.27, 1]); V.redraw(); };
    V.dispose = () => { canvas.remove(); };
    return V;
  }

  /** Four orthographic views of a part on a 2x2 PNG (for the visual inspector). */
  function snapshot(positions, N = 512) {
    const c = document.createElement('canvas'); c.width = N; c.height = N;
    const R = makeRenderer(c, { preserve: true });
    R.base = [0.29, 0.54, 0.63]; R.setMesh(positions);
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], positions[i + k]); hi[k] = Math.max(hi[k], positions[i + k]); }
    const ctr = mulS(add(lo, hi), 0.5), size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 10;
    const g = Math.ceil((size * 1.6) / 10) * 10;
    R.setLines(gridSegments(g, g, 10).map((v, i) => v + [ctr[0] - g / 2, ctr[1] - g / 2, lo[2]][i % 3]), [0.62, 0.67, 0.71], 0.8);
    const out = document.createElement('canvas'); out.width = N * 2; out.height = N * 2; const ctx = out.getContext('2d');
    const views = [['ISO', [1, -1.3, 0.9]], ['FRONT', [0, -1, 0]], ['RIGHT', [1, 0, 0]], ['TOP', [0, 0, 1]]];
    views.forEach(([name, dir], i) => {
      const eye = add(ctr, mulS(norm(dir), size * 4));
      const up = name === 'TOP' ? [0, 1, 0] : [0, 0, 1];
      const h = size * 0.75;
      R.draw(M.mul(M.ortho(-h, h, -h, h, 0.1, size * 20), M.lookAt(eye, ctr, up)), [0, 0, 0], [0.95, 0.957, 0.965, 1]);
      ctx.drawImage(c, (i % 2) * N, Math.floor(i / 2) * N);
      ctx.fillStyle = '#172028'; ctx.font = 'bold 22px sans-serif'; ctx.fillText(name, (i % 2) * N + 12, Math.floor(i / 2) * N + 30);
    });
    return new Promise((res) => out.toBlob((bl) => res(bl), 'image/png'));
  }

  root.FormaViewer = { create, snapshot, M };
})(typeof globalThis !== 'undefined' ? globalThis : this);
