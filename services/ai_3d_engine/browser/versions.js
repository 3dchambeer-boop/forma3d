/*
 * FormaVersions — revision history, optimistic concurrency and backup merging.
 *
 *   conflict(base, fresh, intent)  optimistic check before a save: did someone else change the project since
 *                                  this screen loaded it? -> null or { code, message_ar }
 *   diff(a, b)                     what changed between two revisions: parameters, model nodes, size, mass, checks
 *   mergeBackup(local, incoming)   three-way-ish merge of an offline backup into this device's data:
 *                                  revisions are immutable (same path, different content = conflict, local kept);
 *                                  projects: the side with the higher revision wins, ties by updatedAt; when the losing
 *                                  side holds events the winner does not, both edits are kept (the loser becomes a
 *                                  "conflicting copy" project) and the conflict is reported; nothing is dropped silently.
 */
(function (root) {
  'use strict';
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function conflict(base, fresh, intent = {}) {
    if (!base) return null; // a new project
    if (!fresh) return { code: 'DELETED', message_ar: 'حُذف هذا المشروع من جهاز أو شخص آخر.' };
    if ((fresh.revision || 0) !== (base.revision || 0)) return { code: 'NEW_REVISION', message_ar: `حفظ شخص آخر النسخة ${fresh.revision} بعد أن فتحتَ النسخة ${base.revision || 0}. أعد التحميل لترى عمله، أو احفظ عملك كمشروع منفصل.` };
    if (intent.status && fresh.status !== base.status) return { code: 'STATUS_CHANGED', message_ar: `تغيّرت حالة المشروع إلى «${fresh.status}» أثناء عملك. أعد التحميل قبل المتابعة.` };
    if (fresh.approvedRevision && intent.design && fresh.approvedRevision === fresh.revision && ['APPROVED', 'PRINT_REQUESTED', 'QUEUED', 'PRINTING', 'DONE'].includes(fresh.status)) return { code: 'APPROVED_LOCKED', message_ar: 'النسخة المعتمدة لا تُعدّل. أعد فتح المشروع للتعديل لتُنشأ نسخة جديدة.' };
    return null;
  }

  function flatten(node, path = 'model', out = {}) {
    if (node && typeof node === 'object') {
      if (Array.isArray(node)) node.forEach((x, i) => flatten(x, `${path}[${i}]`, out));
      else for (const k of Object.keys(node).sort()) flatten(node[k], `${path}.${k}`, out);
    } else out[path] = node;
    return out;
  }
  function diff(a, b) {
    const pa = Object.assign({}, ...(a.design.parameters || []).map((p) => ({ [p.name]: p.value })), a.values || {});
    const pb = Object.assign({}, ...(b.design.parameters || []).map((p) => ({ [p.name]: p.value })), b.values || {});
    const params = [...new Set([...Object.keys(pa), ...Object.keys(pb)])].filter((k) => pa[k] !== pb[k]).map((k) => ({ name: k, from: pa[k] ?? null, to: pb[k] ?? null }));
    const fa = flatten(a.design.model), fb = flatten(b.design.model);
    const keys = new Set([...Object.keys(fa), ...Object.keys(fb)]);
    const model = { added: 0, removed: 0, changed: 0, examples: [] };
    for (const k of keys) {
      const kind = !(k in fa) ? 'added' : !(k in fb) ? 'removed' : fa[k] !== fb[k] ? 'changed' : null;
      if (!kind) continue;
      model[kind]++;
      if (model.examples.length < 8) model.examples.push({ path: k, kind, from: fa[k], to: fb[k] });
    }
    const sa = a.summary || {}, sb = b.summary || {};
    const num = (x) => (typeof x === 'number' ? x : null);
    const sz = (s) => s.size_mm || s.size || null;
    const size = sz(sa) && sz(sb) ? ['x', 'y', 'z'].map((k) => ({ axis: k, from: sz(sa)[k], to: sz(sb)[k] })).filter((d) => d.from !== d.to) : [];
    const mass = (s) => num(s.estimate && s.estimate.mass_g);
    return { params, model, size, mass_g: { from: mass(sa), to: mass(sb) }, checks: { from: sa.checks || null, to: sb.checks || null }, sameGeometry: !!a.sha && a.sha === b.sha };
  }

  function mergeBackup(local, incoming, { now = Date.now(), idFor = (p) => p + '_c' + now.toString(36) } = {}) {
    const apply = {}, report = [];
    const isProject = (k) => /^projects\/[^/]+$/.test(k), isRevision = (k) => /^projects\/[^/]+\/revisions\/[^/]+$/.test(k);
    for (const [k, inc] of Object.entries(incoming || {})) {
      if (!/^[A-Za-z0-9_\-.~:@+/]+$/.test(k) || !inc || typeof inc !== 'object') { report.push({ path: k, action: 'skipped', reason: 'invalid' }); continue; }
      const loc = local[k];
      if (!loc) { apply[k] = inc; report.push({ path: k, action: 'added' }); continue; }
      if (same(loc, inc)) continue;
      if (isRevision(k)) { report.push({ path: k, action: 'conflict', reason: 'revision content differs (revisions are immutable); this device keeps its version', kept: 'local' }); continue; }
      if (isProject(k)) {
        const lr = loc.revision || 0, ir = inc.revision || 0;
        const incWins = ir > lr || (ir === lr && (inc.updatedAt || 0) > (loc.updatedAt || 0));
        const [win, lose] = incWins ? [inc, loc] : [loc, inc];
        const evKey = (e) => `${e.at}|${e.by}|${e.type}`;
        const winEv = new Set((win.events || []).map(evKey));
        const lost = (lose.events || []).filter((e) => !winEv.has(evKey(e)));
        if (incWins) apply[k] = inc;
        if (lost.length) {
          const copyId = idFor(k.split('/')[1]);
          apply['projects/' + copyId] = { ...lose, id: copyId, title: (lose.title || 'مشروع') + ' (نسخة متعارضة)', status: 'DRAFT', approvedRevision: null, approvedSha: null, conflictOf: k.split('/')[1], updatedAt: now, events: [...(lose.events || []), { at: now, by: null, type: 'conflict_copy', note: 'نسخة محفوظة من دمج نسخة احتياطية' }] };
          report.push({ path: k, action: 'conflict', reason: `both sides changed; ${lost.length} event(s) only on the ${incWins ? 'device' : 'backup'} side were kept in a copy`, kept: incWins ? 'backup' : 'local', copy: 'projects/' + copyId });
        } else report.push({ path: k, action: incWins ? 'updated' : 'kept_local', reason: incWins ? `backup is newer (revision ${ir})` : 'this device is newer' });
        continue;
      }
      // other documents (printers, settings, roles, people): newer updatedAt/at wins
      const t = (d) => d.updatedAt || d.at || d.firstSeen || 0;
      if (t(inc) > t(loc)) { apply[k] = inc; report.push({ path: k, action: 'updated' }); } else report.push({ path: k, action: 'kept_local' });
    }
    return { apply, report, counts: report.reduce((c, r) => ((c[r.action] = (c[r.action] || 0) + 1), c), {}) };
  }

  const api = { conflict, diff, mergeBackup, flatten };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FormaVersions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
