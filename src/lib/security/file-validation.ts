// =====================================================================
// Upload validation by CONTENT, never by file name or declared type.
//
//   sniff(buf)                         -> the real kind of the bytes (or null)
//   validateUpload(buf, {allow, ...})  -> {ok, kind, info} | {ok:false, code, message}
//   validateImageDataUrl(url, opts)    -> the same for a data:image/...;base64 URL; the declared type must match
//
// Images: the dimensions are read from the header (PNG IHDR, JPEG SOF, WebP VP8/VP8L/VP8X, GIF) and limited before
// anything decodes them, so a small file cannot expand into a huge bitmap. STL: a binary file's length must equal
// 84 + 50 x triangle count; an ASCII file must look like facets. 3MF: a ZIP holding 3D/3dmodel.model. STEP: the
// ISO-10303-21 header. GLB: the glTF binary header with a consistent length.
// =====================================================================

export type FileKind = 'png' | 'jpeg' | 'webp' | 'gif' | 'stl' | '3mf' | 'step' | 'glb' | 'obj';
export interface UploadLimits { allow: FileKind[]; maxBytes: number; maxPixels?: number; maxTriangles?: number }
export type UploadResult =
  | { ok: true; kind: FileKind; info: Record<string, number | string> }
  | { ok: false; code: 'EMPTY' | 'TOO_LARGE' | 'UNKNOWN_TYPE' | 'NOT_ALLOWED' | 'MALFORMED' | 'TOO_MANY_PIXELS' | 'TOO_MANY_TRIANGLES' | 'TYPE_MISMATCH'; message: string };

const startsWith = (b: Uint8Array, sig: number[], at = 0) => b.length >= at + sig.length && sig.every((x, i) => b[at + i] === x);
const ascii = (b: Uint8Array, from: number, to: number) => Buffer.from(b.subarray(from, Math.min(to, b.length))).toString('latin1');
const u32le = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u16le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);

function zipHas(b: Uint8Array, name: string): boolean {
  // scan the local file headers (PK\x03\x04): file name length at +26, extra at +28, name at +30
  const want = Buffer.from(name, 'latin1');
  for (let o = 0; o + 30 < b.length && o < 64 * 1024 * 1024;) {
    if (!startsWith(b, [0x50, 0x4b, 0x03, 0x04], o)) break;
    const n = u16le(b, o + 26), x = u16le(b, o + 28), csize = u32le(b, o + 18);
    if (Buffer.from(b.subarray(o + 30, o + 30 + n)).equals(want)) return true;
    if (u16le(b, o + 6) & 0x08) break; // sizes in a trailing descriptor: fall back to the central directory scan below
    o += 30 + n + x + csize;
  }
  return Buffer.from(b).includes(want); // central directory also lists every name
}

export function sniff(b: Uint8Array): FileKind | null {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'webp';
  if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') return 'gif';
  if (ascii(b, 0, 4) === 'glTF') return 'glb';
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04])) return zipHas(b, '3D/3dmodel.model') ? '3mf' : null;
  const head = ascii(b, 0, 512).replace(/^﻿/, '').trimStart();
  if (head.startsWith('ISO-10303-21')) return 'step';
  // binary STL first: an 80-byte header may itself start with "solid"
  if (b.length >= 84 && 84 + 50 * u32le(b, 80) === b.length) return 'stl';
  if (/^solid\b/i.test(head) && /facet\s+normal/i.test(ascii(b, 0, 4096))) return 'stl';
  if (/^(#[^\n]*\n|\s)*(v|vn|vt|o|g|mtllib|f)\s/m.test(head) && /^v\s+-?[\d.]/m.test(ascii(b, 0, 65536))) return 'obj';
  return null;
}

function imageSize(kind: FileKind, b: Uint8Array): { w: number; h: number } | null {
  if (kind === 'png') return b.length >= 24 && ascii(b, 12, 16) === 'IHDR' ? { w: u32be(b, 16), h: u32be(b, 20) } : null;
  if (kind === 'gif') return b.length >= 10 ? { w: u16le(b, 6), h: u16le(b, 8) } : null;
  if (kind === 'webp') {
    const fmt = ascii(b, 12, 16);
    if (fmt === 'VP8 ' && b.length >= 30) return { w: u16le(b, 26) & 0x3fff, h: u16le(b, 28) & 0x3fff };
    if (fmt === 'VP8L' && b.length >= 25) { const v = u32le(b, 21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
    if (fmt === 'VP8X' && b.length >= 30) return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    return null;
  }
  if (kind === 'jpeg') {
    for (let o = 2; o + 9 < b.length;) {
      if (b[o] !== 0xff) return null;
      const m = b[o + 1];
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { o += 2; continue; }
      const len = u16be(b, o + 2);
      if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: u16be(b, o + 5), w: u16be(b, o + 7) };
      if (len < 2) return null;
      o += 2 + len;
    }
  }
  return null;
}

export function validateUpload(b: Uint8Array, lim: UploadLimits): UploadResult {
  if (!b || b.length === 0) return { ok: false, code: 'EMPTY', message: 'the file is empty' };
  if (b.length > lim.maxBytes) return { ok: false, code: 'TOO_LARGE', message: `the file is ${b.length} bytes; the limit is ${lim.maxBytes}` };
  const kind = sniff(b);
  if (!kind) return { ok: false, code: 'UNKNOWN_TYPE', message: 'the content is not a recognised image or 3D file' };
  if (!lim.allow.includes(kind)) return { ok: false, code: 'NOT_ALLOWED', message: `${kind} files are not accepted here (allowed: ${lim.allow.join(', ')})` };
  const info: Record<string, number | string> = { bytes: b.length };
  if (kind === 'png' || kind === 'jpeg' || kind === 'webp' || kind === 'gif') {
    const s = imageSize(kind, b);
    if (!s || s.w < 1 || s.h < 1) return { ok: false, code: 'MALFORMED', message: `the ${kind} header is damaged` };
    if (s.w * s.h > (lim.maxPixels ?? 40e6)) return { ok: false, code: 'TOO_MANY_PIXELS', message: `${s.w} x ${s.h} pixels exceeds the limit of ${lim.maxPixels ?? 40e6}` };
    Object.assign(info, { width: s.w, height: s.h });
  }
  if (kind === 'stl' && b.length >= 84 && 84 + 50 * u32le(b, 80) === b.length) {
    const n = u32le(b, 80);
    if (n === 0) return { ok: false, code: 'MALFORMED', message: 'the STL has no triangles' };
    if (n > (lim.maxTriangles ?? 5e6)) return { ok: false, code: 'TOO_MANY_TRIANGLES', message: `${n} triangles exceeds the limit of ${lim.maxTriangles ?? 5e6}` };
    for (let i = 0; i < Math.min(n, 2000); i++) for (let k = 0; k < 12; k++) {
      const v = Buffer.from(b.buffer, b.byteOffset + 84 + i * 50 + k * 4, 4).readFloatLE(0);
      if (!Number.isFinite(v)) return { ok: false, code: 'MALFORMED', message: `triangle ${i} has a non-finite coordinate` };
    }
    Object.assign(info, { triangles: n, encoding: 'binary' });
  } else if (kind === 'stl') info.encoding = 'ascii';
  if (kind === 'glb') {
    if (b.length < 20 || u32le(b, 4) !== 2 || u32le(b, 8) !== b.length) return { ok: false, code: 'MALFORMED', message: 'the GLB header length does not match the file' };
  }
  return { ok: true, kind, info };
}

const DECLARED: Record<string, FileKind> = { png: 'png', jpeg: 'jpeg', jpg: 'jpeg', webp: 'webp', gif: 'gif' };
/** A data:image/<type>;base64 URL: decoded, sniffed, and the declared type must be what the bytes really are. */
export function validateImageDataUrl(url: string, lim: Omit<UploadLimits, 'allow'> & { allow?: FileKind[] }): UploadResult & { bytes?: Buffer } {
  const m = /^data:image\/([a-z]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(url || '');
  if (!m) return { ok: false, code: 'MALFORMED', message: 'expected a data:image/...;base64 URL' };
  if (m[2].length * 0.75 > lim.maxBytes + 3) return { ok: false, code: 'TOO_LARGE', message: `the image is larger than ${lim.maxBytes} bytes` };
  const buf = Buffer.from(m[2], 'base64');
  const r = validateUpload(buf, { allow: lim.allow ?? ['png', 'jpeg', 'webp'], maxBytes: lim.maxBytes, maxPixels: lim.maxPixels });
  if (!r.ok) return r;
  if (DECLARED[m[1]] !== r.kind) return { ok: false, code: 'TYPE_MISMATCH', message: `declared image/${m[1]} but the content is ${r.kind}` };
  return { ...r, bytes: buf };
}
