/*
 * FormaArchive — Customer Intelligence & Project Archive, as pure functions over the platform's real records
 * (projects with their event logs and invoices, print jobs with their events, printers, people, roles, customer
 * records). Nothing here invents a figure: every number is counted or summed from stored records, every timeline
 * entry points at the record it came from.
 *
 *   bucketOf(project)                           -> one of BUCKETS (where the project stands for the business)
 *   customerDirectory(data)                     -> one row per customer with counts, spending and last activity
 *   customerProfile(data, customerId)           -> overview + projects grouped by bucket
 *   timeline(project, jobs)                     -> chronological events with {source:{kind,id}} references
 *   controlCenter(data, now)                    -> overview statistics (null where nothing is recorded)
 *   search(query, data, viewer)                 -> permission-filtered results across the platform
 *   toCSV(rows, columns)                        -> RFC 4180 CSV, safe against spreadsheet formula injection
 *   filterDirectory(rows, {q, status, sort})    -> searched / filtered / sorted directory rows
 */
(function (root) {
  'use strict';

  const BUCKETS = ['in_progress', 'pending_review', 'awaiting_customer', 'awaiting_payment', 'manufacturing', 'ready_delivery', 'completed', 'rejected', 'archived'];
  const BUCKET_AR = {
    completed: 'مكتملة ومسلَّمة', in_progress: 'قيد العمل', pending_review: 'بانتظار المراجعة', awaiting_customer: 'بانتظار موافقة الزبون',
    awaiting_payment: 'بانتظار الدفع', manufacturing: 'في التصنيع', ready_delivery: 'جاهزة للتسليم', rejected: 'مرفوضة', archived: 'مؤرشفة',
  };

  const unpaid = (p) => !!(p.invoice && p.invoice.status === 'ISSUED');
  /** Where a project stands, from its stored status, invoice, delivery and archive flags (in that priority). */
  function bucketOf(p) {
    if (p.archived) return 'archived';
    if (p.rejected) return 'rejected';
    switch (p.status) {
      case 'DRAFT': return 'in_progress';
      case 'IN_REVIEW': return 'pending_review';
      case 'CHANGES_REQUESTED': return 'awaiting_customer';
      case 'APPROVED': return unpaid(p) ? 'awaiting_payment' : 'awaiting_customer'; // approved: the customer decides on printing
      case 'PRINT_REQUESTED': return unpaid(p) ? 'awaiting_payment' : 'in_progress';
      case 'QUEUED': case 'PRINTING': case 'FAILED': return 'manufacturing';
      case 'DONE': return p.delivered ? 'completed' : 'ready_delivery';
      default: return 'in_progress';
    }
  }

  const lastEventAt = (p) => Math.max(p.updatedAt || 0, p.createdAt || 0, ...((p.events || []).map((e) => e.at || 0)));
  // spending counts paid invoices only; a refunded invoice counts as nothing spent
  const paidTotal = (p) => (p.invoice && p.invoice.status === 'PAID' ? Number(p.invoice.totalIqd) || 0 : 0);

  /** data = {projects, jobs, people, roles, customers, names} */
  function customerDirectory(data) {
    const roles = data.roles || {}, customers = data.customers || {}, names = data.names || {};
    const ids = new Set([...(data.people || []).map((x) => x.id), ...(data.projects || []).map((p) => p.ownerId)].filter(Boolean));
    const rows = [];
    for (const id of ids) {
      const role = roles[id] || 'customer';
      if (role !== 'customer' && !(data.projects || []).some((p) => p.ownerId === id)) continue; // staff without projects
      const ps = (data.projects || []).filter((p) => p.ownerId === id);
      const person = (data.people || []).find((x) => x.id === id) || {};
      const c = customers[id] || {};
      const by = {}; for (const b of BUCKETS) by[b] = 0;
      for (const p of ps) by[bucketOf(p)]++;
      const jobs = (data.jobs || []).filter((j) => ps.some((p) => p.id === j.projectId));
      rows.push({
        id, name: c.name || names[id] || '', email: c.email || null, phone: c.phone || null,
        registeredAt: person.firstSeen || c.createdAt || Math.min(...ps.map((p) => p.createdAt || Infinity)) || null,
        lastActivity: Math.max(person.lastSeen || 0, ...ps.map(lastEventAt)) || null,
        projects: ps.length, completed: by.completed, active: by.in_progress + by.manufacturing + by.awaiting_payment + by.awaiting_customer + by.ready_delivery,
        pending: by.pending_review, orders: jobs.length,
        spentIqd: ps.reduce((s, p) => s + paidTotal(p), 0),
        status: c.status || 'ACTIVE', role, buckets: by,
      });
    }
    return rows;
  }

  function filterDirectory(rows, o = {}) {
    const q = String(o.q || '').trim().toLowerCase();
    let out = rows.filter((r) => (!o.status || r.status === o.status) && (!q || [r.name, r.email, r.phone, r.id].some((x) => x && String(x).toLowerCase().includes(q))));
    const key = o.sort || 'lastActivity', dir = o.dir === 'asc' ? 1 : -1;
    out = out.slice().sort((a, b) => {
      const x = a[key] ?? (typeof b[key] === 'string' ? '' : -Infinity), y = b[key] ?? (typeof a[key] === 'string' ? '' : -Infinity);
      return (typeof x === 'string' ? x.localeCompare(y, 'ar') : x - y) * dir || a.id.localeCompare(b.id);
    });
    return out;
  }

  function customerProfile(data, id) {
    const row = customerDirectory(data).find((r) => r.id === id);
    if (!row) return null;
    const groups = {}; for (const b of BUCKETS) groups[b] = [];
    for (const p of (data.projects || []).filter((x) => x.ownerId === id).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))) groups[bucketOf(p)].push(p);
    const notes = ((data.customers || {})[id] || {}).notes || [];
    return { ...row, groups, notes };
  }

  /** Every event of a project, its print jobs and its invoice, oldest first, each pointing at its record. */
  function timeline(p, jobs) {
    const out = [];
    for (const [i, e] of (p.events || []).entries()) out.push({ at: e.at, type: e.type, by: e.by || null, note: e.note || '', source: { kind: 'project', id: p.id, index: i } });
    for (const j of (jobs || []).filter((x) => x.projectId === p.id)) {
      for (const [i, e] of (j.events || []).entries()) {
        // the project log mirrors some job transitions; keep the job's own entry only when the project has none at that time
        if ((p.events || []).some((pe) => pe.type === e.type && Math.abs((pe.at || 0) - (e.at || 0)) < 2000)) continue;
        out.push({ at: e.at, type: 'job_' + e.type, by: e.by || null, note: e.note || '', source: { kind: 'job', id: j.id, index: i } });
      }
    }
    const inv = p.invoice;
    if (inv) {
      if (inv.issuedAt && !(p.events || []).some((e) => e.type === 'invoiced')) out.push({ at: inv.issuedAt, type: 'invoiced', by: inv.issuedBy || null, note: inv.number || '', source: { kind: 'invoice', id: inv.number } });
      for (const [i, pay] of (inv.payments || []).entries()) if (!(p.events || []).some((e) => e.type === 'paid' && Math.abs(e.at - pay.at) < 2000)) out.push({ at: pay.at, type: 'paid', by: pay.by || null, note: `${pay.amountIqd} IQD · ${pay.method} · ${pay.reference}`, source: { kind: 'payment', id: inv.number, index: i } });
    }
    if (p.delivered && !(p.events || []).some((e) => e.type === 'delivered')) out.push({ at: p.delivered.at, type: 'delivered', by: p.delivered.by || null, note: p.delivered.note || '', source: { kind: 'project', id: p.id } });
    return out.filter((e) => Number.isFinite(e.at)).sort((a, b) => a.at - b.at);
  }

  function controlCenter(data, now = Date.now()) {
    const P = data.projects || [], J = data.jobs || [], dir = customerDirectory(data);
    const week = now - 7 * 864e5;
    const done = J.filter((j) => j.status === 'DONE').length, failed = J.filter((j) => j.status === 'FAILED').length;
    const buckets = {}; for (const b of BUCKETS) buckets[b] = 0;
    for (const p of P) buckets[bucketOf(p)]++;
    return {
      customers: dir.length,
      newCustomers7d: dir.filter((r) => r.registeredAt && r.registeredAt >= week).length,
      projects: P.length,
      activeProjects: P.length - buckets.completed - buckets.archived - buckets.rejected,
      completedProjects: buckets.completed,
      pendingReviews: buckets.pending_review,
      orders: J.length,
      revenueIqd: P.reduce((s, p) => s + paidTotal(p), 0),
      unpaidIqd: P.reduce((s, p) => s + (unpaid(p) ? Number(p.invoice.totalIqd) || 0 : 0), 0),
      printSuccess: done + failed ? done / (done + failed) : null, // null = no finished print recorded yet
      printsDone: done, printsFailed: failed,
      printersActive: (data.printers || []).filter((x) => x.status === 'PRINTING').length,
      printers: (data.printers || []).length,
      buckets,
    };
  }

  /** viewer = {id, role}. Customers see only their own projects/invoices; staff see what their role works on. */
  function search(query, data, viewer) {
    const q = String(query || '').trim().toLowerCase();
    if (q.length < 2) return [];
    const has = (...xs) => xs.some((x) => x != null && String(x).toLowerCase().includes(q));
    const staff = ['designer', 'operator', 'admin'].includes(viewer.role), admin = viewer.role === 'admin';
    const out = [];
    const myProjects = (data.projects || []).filter((p) => staff || p.ownerId === viewer.id);
    for (const p of myProjects) if (has(p.title, p.id, p.idea)) out.push({ kind: 'project', id: p.id, label: p.title || p.id, sub: p.status, href: '#project-' + p.id });
    for (const p of myProjects) if (p.invoice && has(p.invoice.number) && (admin || viewer.role === 'operator' || p.ownerId === viewer.id)) out.push({ kind: 'invoice', id: p.invoice.number, label: p.invoice.number, sub: p.title, href: '#project-' + p.id });
    if (admin) for (const r of customerDirectory(data)) if (has(r.name, r.email, r.phone, r.id)) out.push({ kind: 'customer', id: r.id, label: r.name || r.id, sub: `${r.projects} مشروع`, href: '#customer-' + r.id });
    if (admin || viewer.role === 'operator') {
      for (const j of data.jobs || []) if (has(j.id, j.title)) out.push({ kind: 'job', id: j.id, label: j.title || j.id, sub: j.status, href: '#print' });
      for (const x of data.printers || []) if (has(x.name, x.id)) out.push({ kind: 'printer', id: x.id, label: x.name, sub: x.status, href: '#print' });
    }
    if (admin) for (const [id, r] of Object.entries(data.roles || {})) if (r === 'designer' && has((data.names || {})[id], id)) out.push({ kind: 'designer', id, label: (data.names || {})[id] || id, sub: 'مصمّم', href: '#admin' });
    return out.slice(0, 40);
  }

  /** CSV that a spreadsheet will not execute: cells starting with = + - @ tab or CR are prefixed with ' */
  function toCSV(rows, columns) {
    const cell = (v) => {
      let s = v == null ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return [columns.map((c) => cell(c.label)).join(','), ...rows.map((r) => columns.map((c) => cell(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(','))].join('\r\n') + '\r\n';
  }

  const api = { BUCKETS, BUCKET_AR, bucketOf, customerDirectory, filterDirectory, customerProfile, timeline, controlCenter, search, toCSV };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FormaArchive = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
