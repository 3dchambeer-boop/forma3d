// Website content management (welcome page CMS): validation, safety, revisions and rollback.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { describe, test } from 'node:test';

const require = createRequire(import.meta.url);
const W = require(join(resolve(import.meta.dirname, '../..'), 'services/ai_3d_engine/browser/site.js'));

describe('Site content (CMS)', () => {
  test('the default content is valid and carries both headlines', () => {
    const r = W.sanitizeSite(W.DEFAULT_SITE);
    assert.equal(r.ok, true, r.errors.join('; '));
    assert.equal(r.site.headline_en, 'Your Imagination. Engineered Into Reality.');
    assert.equal(r.site.headline_ar, 'من الفكرة إلى الواقع، هندسة بلا حدود.');
  });

  test('content is plain text: markup stays inert text, control and bidi-override characters are removed, lengths bounded', () => {
    const r = W.sanitizeSite({ ...W.DEFAULT_SITE, headline_en: '<img src=x onerror=alert(1)>', sub_ar: 'عادي‮gnp.exe\u0007', headline_ar: 'x'.repeat(500) });
    assert.equal(r.site.headline_en, '<img src=x onerror=alert(1)>', 'kept as text; the page renders it with textContent');
    assert.equal(r.site.sub_ar, 'عاديgnp.exe');
    assert.equal(r.site.headline_ar.length, 120);
    assert.ok(r.errors.some((e: string) => e.includes('العنوان (AR)')));
  });

  test('links: only https and mailto, never javascript:, data: or credentials in the URL', () => {
    const r = W.sanitizeSite({ links: [{ label: 'Instagram', url: 'https://instagram.com/cmg' }, { label: 'x', url: 'javascript:alert(1)' }, { label: 'y', url: 'data:text/html,<script>' }, { label: 'z', url: 'https://user:pw@evil.example' }, { label: '', url: 'mailto:info@cmg.example' }] });
    assert.deepEqual(r.site.links.map((l: any) => l.url), ['https://instagram.com/cmg', 'mailto:info@cmg.example']);
    assert.equal(r.site.links[0].label, 'Instagram');
    assert.equal(r.errors.filter((e: string) => e.includes('https://')).length, 3);
  });

  test('brand colour must be #rrggbb with WCAG AA contrast against white; fonts from the approved list', () => {
    assert.ok(Math.abs(W.contrast('#000000', '#ffffff') - 21) < 1e-9);
    assert.ok(W.contrast('#c2410c', '#ffffff') >= 4.5, 'the default accent passes');
    let r = W.sanitizeSite({ accent: '#ffcc00' });
    assert.equal(r.ok, false); assert.match(r.errors[0], /4\.5:1/); assert.equal(r.site.accent, W.DEFAULT_SITE.accent, 'a failing colour is not applied');
    r = W.sanitizeSite({ accent: 'red; background:url(x)' }); assert.match(r.errors[0], /#RRGGBB/);
    r = W.sanitizeSite({ accent: '#1D4ED8', font: 'Cairo' }); assert.ok(r.ok); assert.deepEqual([r.site.accent, r.site.font], ['#1d4ed8', 'Cairo']);
    r = W.sanitizeSite({ font: 'Comic Sans; } body { display:none' }); assert.equal(r.site.font, W.DEFAULT_SITE.font); assert.ok(r.errors.length);
  });

  test('publishing keeps numbered revisions; rollback restores an earlier one exactly', () => {
    let h = W.publish(null, { ...W.DEFAULT_SITE, headline_en: 'v1' }, 'adm', 1);
    h = W.publish(h, { ...W.DEFAULT_SITE, headline_en: 'v2' }, 'adm', 2);
    assert.deepEqual([h.current, h.revisions.map((r: any) => r.n)], [2, [1, 2]]);
    assert.equal(W.revisionOf(h, 1).headline_en, 'v1');
    assert.equal(W.revisionOf(h, 9), null);
    for (let i = 0; i < 60; i++) h = W.publish(h, W.DEFAULT_SITE, 'adm', 10 + i);
    assert.equal(h.revisions.length, 50); assert.equal(h.current, 62); assert.equal(h.revisions[0].n, 13);
  });
});
