// Upload validation by content. Image fixtures were produced by a real encoder (sharp/libvips): 37 x 23 pixels.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { describe, test } from 'node:test';

import { sniff, validateImageDataUrl, validateUpload } from '../../src/lib/security/file-validation.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const IMG = (f: string) => readFileSync(join(import.meta.dirname, 'fixtures/images', f));
const CAD = require(join(ROOT, 'services/ai_3d_engine/browser/cad.js'));
const EX = require(join(ROOT, 'services/ai_3d_engine/browser/exporters.js'));
const IMAGES = { allow: ['png', 'jpeg', 'webp', 'gif'] as any, maxBytes: 1e6 };

// a PNG header claiming 50000 x 50000 pixels (a decompression bomb) with a tiny body
function bombPng() {
  const crc = (b: Buffer) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t: string, d: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(50000, 0); ihdr.writeUInt32BE(50000, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc(1000))), chunk('IEND', Buffer.alloc(0))]);
}

describe('Upload validation by content', () => {
  test('every encoder output is recognised and its dimensions read from the header', () => {
    for (const [f, kind] of [['a.png', 'png'], ['a.jpg', 'jpeg'], ['a-progressive.jpg', 'jpeg'], ['a-lossy.webp', 'webp'], ['a-lossless.webp', 'webp'], ['a-alpha.webp', 'webp'], ['a.gif', 'gif']]) {
      const r = validateUpload(IMG(f), IMAGES);
      assert.ok(r.ok, f + ' ' + JSON.stringify(r));
      assert.deepEqual([r.kind, r.info.width, r.info.height], [kind, 37, 23], f);
    }
  });

  test('a file is judged by its bytes: a renamed or mislabelled file is refused', () => {
    assert.equal(sniff(Buffer.from('<?php system($_GET[1]); ?>')), null);
    assert.equal(validateUpload(Buffer.from('MZ\x90\x00 not an image'), IMAGES).ok, false);
    const png = IMG('a.png').toString('base64');
    assert.equal(validateImageDataUrl(`data:image/png;base64,${png}`, { maxBytes: 1e6 }).ok, true);
    const lie = validateImageDataUrl(`data:image/jpeg;base64,${png}`, { maxBytes: 1e6 });
    assert.ok(!lie.ok && lie.code === 'TYPE_MISMATCH', JSON.stringify(lie));
    const gif = validateImageDataUrl(`data:image/gif;base64,${IMG('a.gif').toString('base64')}`, { maxBytes: 1e6 });
    assert.ok(!gif.ok && gif.code === 'NOT_ALLOWED', 'GIF is not accepted for image-to-3D');
  });

  test('size and pixel limits stop oversized files and decompression bombs before decoding', () => {
    const bomb = validateUpload(bombPng(), IMAGES);
    assert.ok(!bomb.ok && bomb.code === 'TOO_MANY_PIXELS', JSON.stringify(bomb));
    const big = validateUpload(IMG('a.jpg'), { ...IMAGES, maxBytes: 100 });
    assert.ok(!big.ok && big.code === 'TOO_LARGE');
    assert.equal((validateUpload(Buffer.alloc(0), IMAGES) as any).code, 'EMPTY');
    assert.equal((validateImageDataUrl('data:image/png;base64,' + 'A'.repeat(4000), { maxBytes: 1000 }) as any).code, 'TOO_LARGE');
  });

  test('3D files: binary and ASCII STL, 3MF, STEP, GLB, OBJ; damaged STL refused', async () => {
    const r = await CAD.generateDesign({ model: { box: { size: [10, 10, 10] } } });
    const stl = Buffer.from(r.stl);
    const v = validateUpload(stl, { allow: ['stl'], maxBytes: 1e7 });
    assert.ok(v.ok && v.info.triangles === r.triangles);
    // a binary STL whose 80-byte header starts with "solid" is still binary
    const tricky = Buffer.from(stl); tricky.write('solid but binary', 0, 'latin1');
    assert.equal(sniff(tricky), 'stl');
    assert.equal(sniff(Buffer.from('solid t\n facet normal 0 0 1\n  outer loop\n')), 'stl');
    const truncated = stl.subarray(0, stl.length - 7);
    assert.equal(sniff(truncated), null, 'a truncated binary STL is not taken for anything');
    const nan = Buffer.from(stl); nan.writeFloatLE(NaN, 84 + 12);
    assert.equal((validateUpload(nan, { allow: ['stl'], maxBytes: 1e7 }) as any).code, 'MALFORMED');
    assert.equal((validateUpload(stl, { allow: ['stl'], maxBytes: 1e7, maxTriangles: 5 }) as any).code, 'TOO_MANY_TRIANGLES');
    const threeMf = Buffer.from(EX.to3MF([{ name: 'p', mesh: r.mesh }], { title: 't' }));
    assert.equal(sniff(threeMf), '3mf');
    assert.equal(sniff(Buffer.from('ISO-10303-21;\nHEADER;')), 'step');
    assert.equal(sniff(Buffer.from('# made by hand\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n')), 'obj');
    const glb = Buffer.alloc(20); glb.write('glTF', 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(20, 8);
    assert.ok(validateUpload(glb, { allow: ['glb'], maxBytes: 100 }).ok);
    glb.writeUInt32LE(999, 8);
    assert.equal((validateUpload(glb, { allow: ['glb'], maxBytes: 100 }) as any).code, 'MALFORMED');
  });
});
