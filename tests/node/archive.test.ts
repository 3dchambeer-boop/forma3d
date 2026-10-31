// Customer Intelligence & Project Archive: every figure is counted from the stored records given here.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { describe, test } from 'node:test';

const require = createRequire(import.meta.url);
const A = require(join(resolve(import.meta.dirname, '../..'), 'services/ai_3d_engine/browser/archive.js'));
const DAY = 864e5, T0 = Date.UTC(2026, 9, 1);
const ev = (type: string, at: number, by = 'u1', note = '') => ({ type, at, by, note });

const data = () => ({
  people: [{ id: 'u1', firstSeen: T0 }, { id: 'u2', firstSeen: T0 + 20 * DAY }, { id: 'd1', firstSeen: T0 }, { id: 'adm', firstSeen: T0 }],
  roles: { d1: 'designer', adm: 'admin' } as Record<string, string>,
  names: { u1: 'حسين علي', u2: 'Sara Ahmed', d1: 'مصمّم', adm: 'المدير' } as Record<string, string>,
  customers: { u2: { status: 'SUSPENDED', email: 'sara@example.com', notes: [{ at: T0, by: 'adm', text: 'طلب فاتورة باسم الشركة' }] } } as Record<string, any>,
  printers: [{ id: 'pr1', name: 'Ender-3 A', status: 'PRINTING' }, { id: 'pr2', name: 'Ender-3 B', status: 'IDLE' }],
  projects: [
    { id: 'p1', ownerId: 'u1', title: 'خطاف سماعة', status: 'DONE', createdAt: T0, updatedAt: T0 + 5 * DAY, delivered: { at: T0 + 6 * DAY, by: 'adm' },
      invoice: { number: 'INV-2026-00001', status: 'PAID', totalIqd: 12000, issuedAt: T0 + 2 * DAY, issuedBy: 'adm', payments: [{ method: 'cash', reference: 'C-1', amountIqd: 12000, by: 'adm', at: T0 + 3 * DAY }] },
      events: [ev('created', T0), ev('submitted', T0 + DAY), ev('approved', T0 + DAY + 3600e3, 'd1'), ev('invoiced', T0 + 2 * DAY, 'adm'), ev('queued', T0 + 3 * DAY + 1000, 'adm'), ev('done', T0 + 5 * DAY, 'adm')] },
    { id: 'p2', ownerId: 'u1', title: 'علبة أردوينو', status: 'IN_REVIEW', createdAt: T0 + 7 * DAY, updatedAt: T0 + 8 * DAY, events: [ev('created', T0 + 7 * DAY), ev('submitted', T0 + 8 * DAY)] },
    { id: 'p3', ownerId: 'u1', title: 'حامل هاتف', status: 'PRINT_REQUESTED', createdAt: T0 + 9 * DAY, updatedAt: T0 + 10 * DAY,
      invoice: { number: 'INV-2026-00002', status: 'ISSUED', totalIqd: 9000, issuedAt: T0 + 10 * DAY, payments: [] }, events: [ev('created', T0 + 9 * DAY)] },
    { id: 'p4', ownerId: 'u2', title: '=HYPERLINK("http://x")', status: 'QUEUED', createdAt: T0 + 21 * DAY, updatedAt: T0 + 22 * DAY, events: [ev('created', T0 + 21 * DAY, 'u2')] },
    { id: 'p5', ownerId: 'u2', title: 'قديم', status: 'DONE', archived: { at: T0 + 25 * DAY, by: 'adm' }, createdAt: T0 + 2 * DAY, updatedAt: T0 + 25 * DAY, events: [] },
  ],
  jobs: [
    { id: 'j1', projectId: 'p1', title: 'خطاف سماعة', status: 'DONE', events: [ev('queued', T0 + 3 * DAY + 1500, 'adm'), ev('started', T0 + 4 * DAY, 'adm'), ev('done', T0 + 5 * DAY + 500, 'adm')] },
    { id: 'j2', projectId: 'p4', title: '=HYPERLINK("http://x")', status: 'FAILED', events: [] },
  ],
});

describe('Customer archive', () => {
  test('projects are filed into business buckets from their stored status, invoice, delivery and archive flags', () => {
    const d = data();
    assert.deepEqual(d.projects.map((p) => A.bucketOf(p)), ['completed', 'pending_review', 'awaiting_payment', 'manufacturing', 'archived']);
    assert.equal(A.bucketOf({ status: 'DONE' }), 'ready_delivery');
    assert.equal(A.bucketOf({ status: 'CHANGES_REQUESTED' }), 'awaiting_customer');
    assert.equal(A.bucketOf({ status: 'IN_REVIEW', rejected: { at: 1 } }), 'rejected');
  });

  test('the directory counts each customer from the records; staff without projects are not customers', () => {
    const rows = A.customerDirectory(data());
    assert.deepEqual(rows.map((r: any) => r.id).sort(), ['u1', 'u2']);
    const u1 = rows.find((r: any) => r.id === 'u1');
    assert.deepEqual([u1.projects, u1.completed, u1.pending, u1.active, u1.orders, u1.spentIqd, u1.status], [3, 1, 1, 1, 1, 12000, 'ACTIVE'], 'only the PAID invoice counts as spent');
    assert.equal(u1.lastActivity, T0 + 10 * DAY);
    const u2 = rows.find((r: any) => r.id === 'u2');
    assert.deepEqual([u2.status, u2.email, u2.spentIqd], ['SUSPENDED', 'sara@example.com', 0]);
    assert.deepEqual(A.filterDirectory(rows, { q: 'sara' }).map((r: any) => r.id), ['u2']);
    assert.deepEqual(A.filterDirectory(rows, { status: 'SUSPENDED' }).map((r: any) => r.id), ['u2']);
    assert.deepEqual(A.filterDirectory(rows, { sort: 'spentIqd' }).map((r: any) => r.id), ['u1', 'u2']);
    assert.deepEqual(A.filterDirectory(rows, { sort: 'projects', dir: 'asc' }).map((r: any) => r.id), ['u2', 'u1']);
  });

  test('a timeline merges project, job, invoice and payment records in order, without duplicating mirrored events', () => {
    const d = data();
    const t = A.timeline(d.projects[0], d.jobs);
    assert.deepEqual(t.map((e: any) => e.type), ['created', 'submitted', 'approved', 'invoiced', 'paid', 'queued', 'job_started', 'done', 'delivered']);
    assert.deepEqual(t.find((e: any) => e.type === 'paid').source, { kind: 'payment', id: 'INV-2026-00001', index: 0 });
    assert.deepEqual(t.find((e: any) => e.type === 'job_started').source, { kind: 'job', id: 'j1', index: 1 });
    assert.ok(t.every((e: any, i: number) => i === 0 || e.at >= t[i - 1].at));
  });

  test('profile groups the customer projects by bucket and carries admin notes', () => {
    const pr = A.customerProfile(data(), 'u1');
    assert.deepEqual(Object.fromEntries(Object.entries(pr.groups).filter(([, v]: any) => v.length).map(([k, v]: any) => [k, v.map((p: any) => p.id)])), { pending_review: ['p2'], awaiting_payment: ['p3'], completed: ['p1'] });
    assert.equal(A.customerProfile(data(), 'u2').notes.length, 1);
    assert.equal(A.customerProfile(data(), 'nobody'), null);
  });

  test('control center statistics are counted from records; nothing recorded gives null, not an invented number', () => {
    const c = A.controlCenter(data(), T0 + 25 * DAY);
    assert.deepEqual([c.customers, c.newCustomers7d, c.projects, c.completedProjects, c.pendingReviews, c.revenueIqd, c.unpaidIqd, c.printSuccess, c.printersActive, c.orders],
      [2, 1, 5, 1, 1, 12000, 9000, 0.5, 1, 2]);
    assert.equal(c.activeProjects, 3);
    assert.equal(A.controlCenter({ projects: [], jobs: [], printers: [] }).printSuccess, null);
  });

  test('global search respects permissions: a customer finds only their own records', () => {
    const d = data();
    const kinds = (r: any[]) => r.map((x) => `${x.kind}:${x.id}`).sort();
    assert.deepEqual(kinds(A.search('INV-2026', d, { id: 'u2', role: 'customer' })), [], 'not another customer\'s invoice');
    assert.deepEqual(kinds(A.search('INV-2026', d, { id: 'u1', role: 'customer' })), ['invoice:INV-2026-00001', 'invoice:INV-2026-00002']);
    assert.deepEqual(kinds(A.search('sara', d, { id: 'd1', role: 'designer' })), [], 'customer records are for the administrator');
    assert.deepEqual(kinds(A.search('sara', d, { id: 'adm', role: 'admin' })), ['customer:u2']);
    assert.deepEqual(kinds(A.search('ender', d, { id: 'u1', role: 'customer' })), []);
    assert.deepEqual(kinds(A.search('ender', d, { id: 'op', role: 'operator' })), ['printer:pr1', 'printer:pr2']);
    assert.deepEqual(A.search('a', d, { id: 'adm', role: 'admin' }), [], 'one letter is not a query');
  });

  test('CSV export quotes properly and neutralises spreadsheet formulas', () => {
    const csv = A.toCSV(data().projects, [{ key: 'id', label: 'ID' }, { key: 'title', label: 'Title' }, { label: 'Owner', get: (p: any) => p.ownerId }]);
    const lines = csv.trim().split('\r\n');
    assert.equal(lines[0], 'ID,Title,Owner');
    assert.equal(lines[4], `p4,"'=HYPERLINK(""http://x"")",u2`);
    assert.equal(A.toCSV([{ a: '-1+1' }, { a: '@SUM(A1)' }, { a: 'line\nbreak' }], [{ key: 'a', label: 'a' }]), "a\r\n'-1+1\r\n'@SUM(A1)\r\n\"line\nbreak\"\r\n");
  });
});
