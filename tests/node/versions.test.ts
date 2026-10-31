// Phase 8.6 — versions and sync: optimistic conflicts, revision diff, backup merge, server If-Match.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { checkIfMatch, etagOf } from '../../src/lib/sync/etag.ts';
const require = createRequire(import.meta.url);
const V = require(join(resolve(import.meta.dirname, '../..'), 'services/ai_3d_engine/browser/versions.js'));

const proj = (o: any = {}) => ({ id: 'p1', title: 'حامل', revision: 2, status: 'DRAFT', updatedAt: 100, events: [{ at: 1, by: 'u', type: 'created' }, { at: 50, by: 'u', type: 'revision' }], ...o });

describe('Optimistic concurrency', () => {
  test('a save is refused when someone else saved a revision or changed the status meanwhile', () => {
    assert.equal(V.conflict(proj(), proj({ updatedAt: 200 }), { design: true }), null, 'a newer timestamp alone (e.g. a comment) is not a conflict');
    assert.equal(V.conflict(proj(), proj({ revision: 3 }), { design: true }).code, 'NEW_REVISION');
    assert.equal(V.conflict(proj(), proj({ status: 'IN_REVIEW' }), { status: 'IN_REVIEW' }).code, 'STATUS_CHANGED');
    assert.equal(V.conflict(proj(), null, {}).code, 'DELETED');
    assert.equal(V.conflict(null, null, {}), null);
    assert.equal(V.conflict(proj({ status: 'APPROVED', approvedRevision: 2 }), proj({ status: 'APPROVED', approvedRevision: 2 }), { design: true }).code, 'APPROVED_LOCKED');
  });
  test('server ETag / If-Match: match passes, stale gets 409 with the current tag, missing gets 428', () => {
    const t = etagOf(new Date(1700000000000));
    assert.equal(t, 'W/"1700000000000"');
    assert.deepEqual(checkIfMatch(t, t), { ok: true });
    assert.deepEqual(checkIfMatch('"1700000000000"', t), { ok: true });
    assert.deepEqual(checkIfMatch('*', t), { ok: true });
    assert.deepEqual(checkIfMatch('W/"1600000000000"', t), { ok: false, status: 409, code: 'CONFLICT', current: t });
    assert.equal((checkIfMatch(null, t) as any).status, 428);
  });
});

describe('Revision diff', () => {
  test('parameters, model leaves, size and mass are compared; identical geometry is recognised', () => {
    const a = { sha: 'aa', design: { parameters: [{ name: 'w', value: 40 }, { name: 'h', value: 10 }], model: { box: { size: ['w', 20, 'h'] } } }, values: { w: 40 }, summary: { size: { x: 40, y: 20, z: 10 }, estimate: { mass_g: 9 }, checks: { pass: 2, total: 2 } } };
    const b = { sha: 'bb', design: { parameters: [{ name: 'w', value: 40 }, { name: 'h', value: 10 }], model: { difference: [{ box: { size: ['w', 20, 'h'] } }, { cylinder: { d: 5, h: 12 } }] } }, values: { w: 50 }, summary: { size: { x: 50, y: 20, z: 10 }, estimate: { mass_g: 10.5 }, checks: { pass: 1, total: 2 } } };
    const d = V.diff(a, b);
    assert.deepEqual(d.params, [{ name: 'w', from: 40, to: 50 }]);
    assert.deepEqual(d.size, [{ axis: 'x', from: 40, to: 50 }]);
    assert.deepEqual(d.mass_g, { from: 9, to: 10.5 });
    assert.equal(d.model.removed, 3); assert.equal(d.model.added, 5);
    assert.equal(d.sameGeometry, false);
    assert.equal(V.diff(a, { ...a }).sameGeometry, true);
  });
});

describe('Backup merge', () => {
  test('new docs are added, identical ones skipped, newer backup projects update, newer local projects stay', () => {
    const local = { 'projects/p1': proj(), 'projects/p2': proj({ id: 'p2', revision: 5 }), 'settings/main': { prices: { PLA: 1 }, updatedAt: 10 } };
    const inc = { 'projects/p1': proj(), 'projects/p2': proj({ id: 'p2', revision: 4 }), 'projects/p3': proj({ id: 'p3' }), 'settings/main': { prices: { PLA: 2 }, updatedAt: 20 } };
    const m = V.mergeBackup(local, inc, { now: 999 });
    assert.deepEqual(Object.keys(m.apply).sort(), ['projects/p3', 'settings/main']);
    assert.deepEqual(m.counts, { kept_local: 1, added: 1, updated: 1 });
  });
  test('both sides edited the same project: the winner is applied and the other edit survives as a copy', () => {
    const base = proj();
    const local = { 'projects/p1': { ...base, updatedAt: 300, events: [...base.events, { at: 300, by: 'designer', type: 'changes', note: 'local review' }] } };
    const inc = { 'projects/p1': { ...base, revision: 3, updatedAt: 250, events: [...base.events, { at: 250, by: 'u', type: 'revision' }] } };
    const m = V.mergeBackup(local, inc, { now: 999, idFor: (id: string) => id + '_copy' });
    assert.equal(m.apply['projects/p1'].revision, 3, 'the higher revision wins');
    const copy = m.apply['projects/p1_copy'];
    assert.ok(copy && copy.title.endsWith('(نسخة متعارضة)') && copy.status === 'DRAFT' && copy.conflictOf === 'p1');
    assert.ok(copy.events.some((e: any) => e.note === 'local review'));
    assert.equal(m.report.find((r: any) => r.path === 'projects/p1').action, 'conflict');
  });
  test('revisions are immutable: different content at the same path is reported, never overwritten', () => {
    const m = V.mergeBackup({ 'projects/p1/revisions/r1': { sha: 'a' } }, { 'projects/p1/revisions/r1': { sha: 'b' }, 'projects/p1/revisions/r2': { sha: 'c' }, 'bad path!': { x: 1 } });
    assert.deepEqual(Object.keys(m.apply), ['projects/p1/revisions/r2']);
    assert.deepEqual(m.report.map((r: any) => r.action).sort(), ['added', 'conflict', 'skipped']);
  });
});
