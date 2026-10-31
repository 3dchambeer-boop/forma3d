/*
 * Forma exporters — mesh file formats written without libraries (browser + Node).
 *   STL is written by engine.js. Here: OBJ (text, mm), GLB (binary glTF 2.0, metres, Y-up as the
 *   format requires) and 3MF (zip + XML, millimetres; several objects = an assembly).
 *   All take meshes ({vertices:[[x,y,z]], faces:[[a,b,c]]}) in millimetres, Z up.
 *   None of these carries CAD history: they are tessellated meshes. STEP (B-Rep) comes only from
 *   the OpenCascade service (services/cad_engine).
 */
(function (root) {
  'use strict';
  const enc = (s) => new TextEncoder().encode(s);
  const fmt = (v) => { const r = Math.round(v * 1e6) / 1e6; return Object.is(r, -0) ? '0' : String(r); };

  // ---------------------------------------------------------------- zip (store only) + crc32
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function zipStore(files) {
    const parts = [], central = []; let offset = 0;
    for (const [name, data0] of files) {
      const data = typeof data0 === 'string' ? enc(data0) : data0;
      const nm = enc(name), crc = crc32(data);
      const h = new Uint8Array(30 + nm.length), dv = new DataView(h.buffer);
      dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true); dv.setUint32(14, crc, true); dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true); dv.setUint16(26, nm.length, true); h.set(nm, 30);
      const c = new Uint8Array(46 + nm.length), dc = new DataView(c.buffer);
      dc.setUint32(0, 0x02014b50, true); dc.setUint16(4, 20, true); dc.setUint16(6, 20, true); dc.setUint16(8, 0x0800, true); dc.setUint32(16, crc, true); dc.setUint32(20, data.length, true); dc.setUint32(24, data.length, true); dc.setUint16(28, nm.length, true); dc.setUint32(42, offset, true); c.set(nm, 46);
      parts.push(h, data); central.push(c); offset += h.length + data.length;
    }
    const size = central.reduce((s, c) => s + c.length, 0), end = new Uint8Array(22), de = new DataView(end.buffer);
    de.setUint32(0, 0x06054b50, true); de.setUint16(8, files.length, true); de.setUint16(10, files.length, true); de.setUint32(12, size, true); de.setUint32(16, offset, true);
    const out = new Uint8Array(offset + size + 22); let o = 0;
    for (const p of [...parts, ...central, end]) { out.set(p, o); o += p.length; }
    return out;
  }
  /** Read a stored (uncompressed) zip back: { name: Uint8Array }. Used by tests and by 3MF import. */
  function unzipStore(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), out = {};
    let o = 0;
    while (o + 30 <= buf.length && dv.getUint32(o, true) === 0x04034b50) {
      const method = dv.getUint16(o + 8, true), size = dv.getUint32(o + 18, true), nl = dv.getUint16(o + 26, true), xl = dv.getUint16(o + 28, true);
      const name = new TextDecoder().decode(buf.subarray(o + 30, o + 30 + nl));
      if (method !== 0) throw new Error('compressed zip entries are not supported: ' + name);
      out[name] = buf.subarray(o + 30 + nl + xl, o + 30 + nl + xl + size);
      o += 30 + nl + xl + size;
    }
    return out;
  }

  // ---------------------------------------------------------------- OBJ
  function toOBJ(parts) {
    parts = Array.isArray(parts) ? parts : [{ name: 'part', mesh: parts }];
    const lines = ['# Forma OBJ export — units: millimetres, Z up', ''];
    let base = 0;
    for (const { name, mesh } of parts) {
      lines.push(`o ${String(name || 'part').replace(/\s+/g, '_')}`);
      for (const v of mesh.vertices) lines.push(`v ${fmt(v[0])} ${fmt(v[1])} ${fmt(v[2])}`);
      for (const f of mesh.faces) lines.push(`f ${f[0] + 1 + base} ${f[1] + 1 + base} ${f[2] + 1 + base}`);
      base += mesh.vertices.length;
    }
    return lines.join('\n') + '\n';
  }

  // ---------------------------------------------------------------- GLB (glTF 2.0 binary)
  function toGLB(parts) {
    parts = Array.isArray(parts) ? parts : [{ name: 'part', mesh: parts }];
    const bufs = [], accessors = [], bufferViews = [], meshes = [], nodes = [];
    let byteOffset = 0;
    const pushView = (bytes, target) => { const pad = (4 - (bytes.byteLength % 4)) % 4; bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.byteLength, target }); bufs.push(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)); if (pad) bufs.push(new Uint8Array(pad)); byteOffset += bytes.byteLength + pad; return bufferViews.length - 1; };
    parts.forEach(({ name, mesh }, pi) => {
      // Z-up mm -> Y-up metres: (x, y, z) -> (x, z, -y) * 0.001
      const pos = new Float32Array(mesh.vertices.length * 3), min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      mesh.vertices.forEach((v, i) => { const q = [v[0] * 0.001, v[2] * 0.001, -v[1] * 0.001]; pos.set(q, i * 3); for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], q[k]); max[k] = Math.max(max[k], q[k]); } });
      const idx = new Uint32Array(mesh.faces.length * 3); mesh.faces.forEach((f, i) => idx.set(f, i * 3));
      const pv = pushView(pos, 34962), iv = pushView(idx, 34963);
      accessors.push({ bufferView: pv, componentType: 5126, count: mesh.vertices.length, type: 'VEC3', min, max });
      accessors.push({ bufferView: iv, componentType: 5125, count: idx.length, type: 'SCALAR' });
      meshes.push({ name: String(name || 'part'), primitives: [{ attributes: { POSITION: accessors.length - 2 }, indices: accessors.length - 1, mode: 4 }] });
      nodes.push({ name: String(name || 'part'), mesh: pi });
    });
    const json = { asset: { version: '2.0', generator: 'Forma exporters' }, scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes, meshes, accessors, bufferViews, buffers: [{ byteLength: byteOffset }] };
    let jb = enc(JSON.stringify(json)); const jpad = (4 - (jb.length % 4)) % 4; if (jpad) { const t = new Uint8Array(jb.length + jpad); t.set(jb); t.fill(0x20, jb.length); jb = t; }
    const total = 12 + 8 + jb.length + 8 + byteOffset, out = new Uint8Array(total), dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
    dv.setUint32(12, jb.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(jb, 20);
    let o = 20 + jb.length; dv.setUint32(o, byteOffset, true); dv.setUint32(o + 4, 0x004e4942, true); o += 8;
    for (const b of bufs) { out.set(b, o); o += b.length; }
    return out;
  }
  function parseGLB(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(4, true) !== 2) throw new Error('not a glTF 2.0 binary');
    const jl = dv.getUint32(12, true);
    return JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + jl)));
  }

  // ---------------------------------------------------------------- 3MF (core spec, millimetres)
  function to3MF(parts, meta = {}) {
    parts = Array.isArray(parts) ? parts : [{ name: 'part', mesh: parts }];
    const esc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
    const objs = parts.map(({ name, mesh }, i) => {
      const v = mesh.vertices.map((p) => `<vertex x="${fmt(p[0])}" y="${fmt(p[1])}" z="${fmt(p[2])}"/>`).join('');
      const t = mesh.faces.map((f) => `<triangle v1="${f[0]}" v2="${f[1]}" v3="${f[2]}"/>`).join('');
      return `<object id="${i + 1}" type="model" name="${esc(name || 'part ' + (i + 1))}"><mesh><vertices>${v}</vertices><triangles>${t}</triangles></mesh></object>`;
    }).join('');
    const items = parts.map((_, i) => `<item objectid="${i + 1}"/>`).join('');
    const md = Object.entries(meta).map(([k, v]) => `<metadata name="${esc(k)}">${esc(v)}</metadata>`).join('');
    const model = `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">${md}<resources>${objs}</resources><build>${items}</build></model>`;
    return zipStore([
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'],
      ['3D/3dmodel.model', model],
    ]);
  }
  function parse3MF(buf) {
    const files = unzipStore(buf), xml = new TextDecoder().decode(files['3D/3dmodel.model']);
    const objects = [...xml.matchAll(/<object id="(\d+)"[^>]*?name="([^"]*)"[^>]*>([\s\S]*?)<\/object>/g)].map((m) => ({
      id: +m[1], name: m[2],
      vertices: [...m[3].matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g)].map((v) => [+v[1], +v[2], +v[3]]),
      faces: [...m[3].matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g)].map((t) => [+t[1], +t[2], +t[3]]),
    }));
    return { unit: (xml.match(/unit="(\w+)"/) || [])[1], objects, files: Object.keys(files) };
  }

  const api = { toOBJ, toGLB, parseGLB, to3MF, parse3MF, zipStore, unzipStore, crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FormaExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
