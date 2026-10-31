// The browser build (services/ai_3d_engine/browser/engine.js) must give the same
// spec, geometry size, volume and validation status as the Python engine.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const ROOT = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const Engine = require(join(ROOT, 'services/ai_3d_engine/browser/engine.js'));

const PROMPTS = [
  'صمّم حامل هاتف مكتبي قابلًا للطباعة ثلاثية الأبعاد، بعرض 90 مم، وارتفاع 110 مم، وقاعدة مستقرة، وفتحة لشحن الهاتف، وزاوية ميل 65 درجة.',
  'Design a phone stand 8 cm wide, 12cm tall, tilt angle 70 degrees with a cable hole',
  'phone stand tilt angle 45 degrees base depth 60 mm',
  'علبة منظم 120x80x40 مم بسماكة جدار 2.5 مم و 3 فواصل',
  'box 60x40x30 mm',
  'shelf bracket width 40mm, thickness 6 mm, 2 holes, hole diameter 5 mm',
  'زاوية تثبيت رف بدون دعامة وثقب واحد',
  'وردة فاصل قطر خارجي ٢٢ ملم وقطر داخلي ٨ ملم وارتفاع ١٠ ملم',
  'علاقة جدارية لاصقة بعرض 3 سم',
  'wall hook 25 mm wide',
  'phone stand 500 mm wide',
  'تمثال فني لحصان عربي',
];

test('JS engine matches the Python engine on every reference prompt', async () => {
  const ref = JSON.parse(execFileSync('python3', [join(import.meta.dirname, 'helpers/py_reference.py')], {
    input: JSON.stringify(PROMPTS), env: { ...process.env, PYTHONPATH: join(ROOT, 'services/ai_3d_engine') }, maxBuffer: 64 * 1024 * 1024,
  }).toString());
  for (let i = 0; i < PROMPTS.length; i++) {
    const py = ref[i];
    const spec = Engine.parse(PROMPTS[i]);
    const label = PROMPTS[i].slice(0, 40);
    assert.equal(spec.template, py.template, label);
    for (const [k, [v, src]] of Object.entries(py.params as Record<string, [number, string]>)) {
      assert.equal(spec.params[k].value, v, `${label}: ${k}`);
      assert.equal(spec.params[k].source, src, `${label}: ${k} source`);
    }
    // same violations (number formatting differs: Python prints 500.0, JS 500)
    assert.deepEqual(spec.errors.map((e: string) => e.split('=')[0]), py.errors.map((e: string) => e.split('=')[0]), label);
    if (py.error) {
      await assert.rejects(Engine.generateParametric(spec), (e: { code: string }) => e.code === py.error, label);
      continue;
    }
    const r = await Engine.generateParametric(spec);
    assert.equal(r.status, py.status, label);
    assert.deepEqual(r.size_mm, py.size, label);
    assert.ok(Math.abs(r.mesh.signedVolume() - py.volume) < 1e-3 * Math.max(1, Math.abs(py.volume)), `${label}: volume ${r.mesh.signedVolume()} vs ${py.volume}`);
    assert.deepEqual(r.spec.requirements, py.requirements, label);
    // triangle counts can differ by T-junction split order; watertightness is what matters
    assert.equal(r.post_export_validation.checks.final.watertight, true, label);
  }
});
