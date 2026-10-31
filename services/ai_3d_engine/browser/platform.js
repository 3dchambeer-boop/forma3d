  // ================================================================== PLATFORM
  // Shared state lives in the artifact database (db capability); identities come
  // from the user capability. The STL itself is never stored: the approved design
  // source is, and the deterministic kernel rebuilds the identical file (SHA-256
  // recorded at approval and checked again before printing).
  const ROLE_AR = { customer: 'زبون', designer: 'مصمّم مراجع', operator: 'مشغّل طباعة', admin: 'مدير' };
  const PSTATUS = {
    DRAFT: ['مسودة', 'muted'], IN_REVIEW: ['بانتظار المراجعة', 'info'], CHANGES_REQUESTED: ['مطلوب تعديل', 'warn'],
    APPROVED: ['معتمد', 'ok'], PRINT_REQUESTED: ['طلب طباعة', 'info'], QUEUED: ['في طابور الطباعة', 'info'],
    PRINTING: ['قيد الطباعة', 'hot'], DONE: ['مكتمل', 'ok'], FAILED: ['فشلت الطباعة', 'bad'],
  };
  const JSTATUS = { QUEUED: ['في الطابور', 'info'], PRINTING: ['قيد الطباعة', 'hot'], DONE: ['اكتملت', 'ok'], FAILED: ['فشلت', 'bad'], CANCELLED: ['أُلغيت', 'muted'] };
  const PRSTATUS = { IDLE: ['جاهزة', 'ok'], PRINTING: ['تطبع الآن', 'hot'], MAINTENANCE: ['صيانة', 'warn'] };
  const LIFECYCLE = [['DRAFT', 'الفكرة'], ['IN_REVIEW', 'المراجعة'], ['APPROVED', 'الاعتماد'], ['PRINT_REQUESTED', 'طلب الطباعة'], ['QUEUED', 'الطابور'], ['PRINTING', 'الطباعة'], ['DONE', 'التسليم']];
  const LC_INDEX = { DRAFT: 0, CHANGES_REQUESTED: 1, IN_REVIEW: 1, APPROVED: 2, PRINT_REQUESTED: 3, QUEUED: 4, PRINTING: 5, DONE: 6, FAILED: 5 };
  const EVENT_AR = {
    created: 'أنشأ المشروع', revision: 'حفظ نسخة', submitted: 'أرسله للمراجعة', changes: 'طلب تعديلات', approved: 'اعتمد التصميم',
    reopened: 'أعاد فتحه للتعديل', print_requested: 'طلب الطباعة', print_cancelled: 'ألغى طلب الطباعة', print_rejected: 'رفض طلب الطباعة',
    component_approved: 'اعتمد قطعة', component_unapproved: 'ألغى اعتماد قطعة', delivered: 'سجّل التسليم للزبون', archived: 'أرشف المشروع', unarchived: 'أخرج المشروع من الأرشيف',
    queued: 'أضافه لطابور الطباعة', invoiced: 'أصدر الفاتورة', paid: 'سجّل الدفع', refunded: 'سجّل استرجاع المبلغ', invoice_void: 'ألغى الفاتورة', uploaded: 'رفع G-code إلى الطابعة', started: 'بدأ الطباعة', done: 'أنهى الطباعة بنجاح', failed: 'سجّل فشل الطباعة', job_cancelled: 'ألغى مهمة الطباعة',
  };
  const MATERIALS = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU'];
  const DEFAULT_PRICES = { PLA: 25000, PETG: 28000, ABS: 30000, ASA: 35000, TPU: 40000 };

  const PL = {
    db: null, user: null, me: null, admin: false, realRole: 'customer', viewAs: null, canWrite: true, ready: false,
    projects: [], jobs: [], printers: [], roles: {}, accounts: {}, people: [], settings: {}, names: {}, writes: new Map(),
    dir: { q: '', status: '', sort: 'lastActivity', page: 0 },
    site: null, siteDraft: null, siteHistory: null,
    resultSha: null, route: 'home', openId: null, loadToken: 0, form: null, octo: {},
    cal: { printerId: null, material: 'PLA', test: null, msg: '' },
  };
  const LOCAL = FormaLocal.local, OCTO = FormaLocal.octoprint;
  const octoReady = (pr) => LOCAL && pr && !!OCTO.keyOf(pr.id) && !!safeUrl(pr.url);
  const role = () => (PL.admin && PL.viewAs) || PL.realRole;
  const isStaff = () => ['designer', 'operator', 'admin'].includes(role());
  const may = (...roles) => roles.includes(role()) || role() === 'admin';
  const uidOf = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const projectById = (id) => PL.projects.find((p) => p.id === id) || null;
  const current = () => (S.project ? projectById(S.project) : null);
  const priceOf = (m) => Number((PL.settings.prices || {})[String(m || 'PLA').toUpperCase()]) || DEFAULT_PRICES[String(m || 'PLA').toUpperCase()] || 25000;
  const fmtDate = (t) => { try { return new Date(t).toLocaleString('ar-IQ-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return new Date(t).toISOString(); } };
  function fmtAgo(t) {
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'الآن'; if (s < 3600) return `منذ ${Math.round(s / 60)} د`; if (s < 86400) return `منذ ${Math.round(s / 3600)} س`;
    return fmtDate(t);
  }
  const pill = (map, k) => el('span', { className: 'pill ' + ((map[k] || [])[1] || 'muted'), textContent: (map[k] || [k])[0] });
  const nameOf = (id) => (id && PL.names[id]) || (id && PL.me && id === PL.me.id ? 'أنت' : 'مستخدم');

  function toast(msg, bad) {
    const t = $('toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 4200);
  }
  const DBERR = { quota_exceeded: 'امتلأت قاعدة بيانات المنصة؛ احذف مشاريع قديمة.', resource_exhausted: 'طلبات كثيرة بسرعة؛ انتظر ثوانٍ وأعد المحاولة.', invalid_argument: 'لا تملك صلاحية الكتابة هنا أو البيانات غير صالحة.', revoked: 'سُحبت صلاحيتك على المنصة.', unavailable: 'الخدمة غير متاحة مؤقتًا؛ أعد المحاولة.' };
  function dbFail(e) { toast(DBERR[e && e.code] || ('تعذّر الحفظ: ' + ((e && e.message) || e)), true); throw e; }

  // one write at a time per document, in order
  function write(path, fn) {
    const prev = PL.writes.get(path) || Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    PL.writes.set(path, next);
    return next;
  }
  const sha256hex = (u8) => window.Engine3D.sha256Hex(u8); // crypto.subtle, or a pure-JS fallback
  function summaryOf(r) {
    const an = r.analysis || { checks: [], dfm: { issues: [], stats: {} }, estimate: null };
    return {
      status: r.status, size: r.size_mm, triangles: r.triangles,
      checks: { pass: an.checks.filter((c) => c.pass).length, total: an.checks.length },
      dfm: { errors: an.dfm.issues.filter((i) => i.severity === 'error').length, warnings: an.dfm.issues.filter((i) => i.severity !== 'error').length, min_wall_mm: an.dfm.stats.min_wall_mm ?? null },
      estimate: an.estimate ? { mass_g: an.estimate.mass_g, time_min: an.estimate.time_min, filament_m: an.estimate.filament_m, material: an.estimate.material } : null,
    };
  }
  // assemblies: one summary for the whole set (interference counts as a manufacturing error)
  function asmSummary(R) {
    return {
      kind: 'assembly', status: R.ok ? 'VALIDATED' : 'REPAIR_REQUIRED', size: { x: R.size_mm[0], y: R.size_mm[1], z: R.size_mm[2] }, triangles: null,
      checks: { pass: R.constraints.filter((c) => c.ok).length, total: R.constraints.length },
      dfm: { errors: R.interference.length, warnings: 0, min_wall_mm: null },
      estimate: { mass_g: R.totals.mass_g, time_min: R.totals.time_min, filament_m: null, material: [...new Set(R.bom.map((r) => r.material))].join('+') },
      parts: R.totals.parts,
    };
  }
  const asmIndexOf = (R) => ({ order: R.order, bom: R.bom.map((r) => ({ parts: r.parts, material: r.material, qty: r.qty, mass_g_each: r.mass_g_each, name_ar: r.name_ar })) });
  const isAsm = (p) => !!(p && p.kind === 'assembly');
  const hasWork = () => !!(S.result || S.asm);
  // material price for an assembly = mass-weighted price of its parts' materials
  function priceOfProject(p) {
    if (!isAsm(p) || !p.asmIndex) return priceOf(p.print && p.print.material);
    let m = 0, c = 0; for (const r of p.asmIndex.bom) { const g = r.qty * r.mass_g_each; m += g; c += g * priceOf(r.material); }
    return m ? c / m : priceOf('PLA');
  }
  const summaryOk = (s) => !!s && ['VALIDATED', 'VALID_WITH_WARNINGS'].includes(s.status) && s.checks.pass === s.checks.total && s.dfm.errors === 0;
  function event(type, note) { return { at: Date.now(), by: PL.me && PL.me.id, type, note: note || '' }; }

  // ------------------------------------------------------------------ project writes
  const baseOf = (p) => (p ? { revision: p.revision || 0, status: p.status, updatedAt: p.updatedAt, approvedRevision: p.approvedRevision || null } : null);
  /** Save the studio state into the project (new revision when the STL changed) and apply a status change. */
  async function commit({ status, type, note, extra, saveDesign = true, after, asNew = false } = {}) {
    if (!PL.db || !PL.canWrite) { toast('لا تملك صلاحية الحفظ على هذه المنصة.', true); return null; }
    let old = asNew ? null : current();
    const now = Date.now();
    // optimistic concurrency: compare with the project as it is in the database right now
    if (old) {
      const fresh = await PL.db.doc('projects/' + old.id).get().then((x) => (x.exists ? { ...x.data(), id: old.id } : null)).catch(() => old);
      const willSaveDesign = !!(saveDesign && ((S.result && S.design) || S.asm) && PL.resultSha && PL.resultSha !== (fresh && fresh.sha));
      const c = FormaVersions.conflict(S.base || baseOf(old), fresh, { status, design: willSaveDesign });
      if (c) { PL.conflict = c; renderProjectBar(); toast(c.message_ar, true); return null; }
      old = fresh;
    }
    const body = old ? structuredClone(old) : { id: uidOf('p'), ownerId: PL.me.id, createdAt: now, revision: 0, status: 'DRAFT', events: [event('created')] };
    const evs = [];
    if (saveDesign && S.asm && !S.result) {
      if (!PL.resultSha || !PL.asmShas) await afterAssembly();
      const sha = PL.resultSha, R = S.asm.out.report;
      if (sha && sha !== body.sha) {
        body.revision = (body.revision || 0) + 1;
        const exists = await PL.db.doc(`projects/${body.id}/revisions/r${body.revision}`).get().then((x) => x.exists).catch(() => false);
        if (exists) { PL.conflict = { code: 'NEW_REVISION', message_ar: `النسخة ${body.revision} موجودة مسبقًا؛ أعد التحميل.` }; renderProjectBar(); return null; }
        const rec = { kind: 'assembly', assembly: S.asm.spec, partShas: PL.asmShas, asmIndex: asmIndexOf(R), sha, summary: asmSummary(R) };
        Object.assign(body, rec, { design: null, values: null, title: S.asm.spec.name_ar || body.title || 'تجميعة', idea: S.idea || body.idea || '', understanding: S.understanding || '', qa: S.qa || [] });
        await write(`rev:${body.id}`, () => PL.db.doc(`projects/${body.id}/revisions/r${body.revision}`).set({ ...rec, by: PL.me.id, at: now, note: note || '' })).catch(dbFail);
        evs.push(event('revision', 'النسخة ' + body.revision));
      }
    }
    if (saveDesign && S.result && S.design) {
      const sha = PL.resultSha || (await sha256hex(S.result.stl));
      if (sha !== body.sha) {
        body.revision = (body.revision || 0) + 1;
        // revisions are immutable: never write over an existing one
        const exists = await PL.db.doc(`projects/${body.id}/revisions/r${body.revision}`).get().then((x) => x.exists).catch(() => false);
        if (exists) { PL.conflict = { code: 'NEW_REVISION', message_ar: `النسخة ${body.revision} موجودة مسبقًا؛ أعد التحميل.` }; renderProjectBar(); return null; }
        Object.assign(body, { kind: 'part', assembly: null, partShas: null, asmIndex: null, design: S.design, values: S.result.params, sha, summary: summaryOf(S.result), title: S.design.name_ar || body.title || 'تصميم', idea: S.idea || body.idea || '', understanding: S.understanding || '', qa: S.qa || [] });
        await write(`rev:${body.id}`, () => PL.db.doc(`projects/${body.id}/revisions/r${body.revision}`).set({ design: S.design, values: S.result.params, sha, summary: body.summary, by: PL.me.id, at: now, note: note || '' })).catch(dbFail);
        evs.push(event('revision', 'النسخة ' + body.revision));
      }
    }
    if (status) body.status = status;
    Object.assign(body, extra || {}, { updatedAt: now });
    if (after) after(body);
    if (type) evs.push(event(type, note));
    body.events = [...(body.events || []), ...evs].slice(-80);
    await write('projects/' + body.id, () => PL.db.doc('projects/' + body.id).set(body)).catch(dbFail);
    upsertLocal(PL.projects, body);
    const isNew = !old;
    S.project = body.id; PL.openId = body.id; S.base = baseOf(body); PL.conflict = null;
    if (isNew) { try { history.replaceState(null, '', '#project-' + body.id); } catch (x) { /* sandboxed preview */ } memHash = '#project-' + body.id; PL.route = 'project'; }
    renderProjectBar(); renderNav();
    return body;
  }
  async function patchProject(p, fields, type, note) {
    // the list is live, so a different updatedAt in the database means someone wrote in between
    const fresh = await PL.db.doc('projects/' + p.id).get().then((x) => (x.exists ? x.data() : null)).catch(() => p);
    if (!fresh || fresh.updatedAt !== p.updatedAt) { toast('تغيّر المشروع للتو من شخص آخر؛ راجع الحالة الجديدة ثم أعد المحاولة.', true); renderAll(); throw new Error('CONFLICT'); }
    const body = structuredClone(p);
    Object.assign(body, fields, { updatedAt: Date.now() });
    if (type) body.events = [...(body.events || []), event(type, note)].slice(-80);
    await write('projects/' + p.id, () => PL.db.doc('projects/' + p.id).set(body)).catch(dbFail);
    upsertLocal(PL.projects, body);
    return body;
  }
  async function putDoc(coll, obj) {
    await write(coll + '/' + obj.id, () => PL.db.doc(coll + '/' + obj.id).set(obj)).catch(dbFail);
    upsertLocal(coll === 'jobs' ? PL.jobs : PL.printers, obj);
    return obj;
  }
  function upsertLocal(list, obj) { const i = list.findIndex((x) => x.id === obj.id); if (i >= 0) list[i] = obj; else list.unshift(obj); }

  // ------------------------------------------------------------------ studio hooks (called from the designer code)
  function studioEditable() {
    const p = current();
    if (!PL.ready) return true; // standalone (no platform data): the studio stays fully usable
    if (!PL.canWrite) return false;
    if (!p) return true;
    const owner = p.ownerId === (PL.me && PL.me.id);
    if (['DRAFT', 'CHANGES_REQUESTED'].includes(p.status)) return owner || may('designer');
    if (p.status === 'IN_REVIEW') return may('designer');
    return false;
  }
  async function afterDesign() {
    PL.resultSha = null; PL.asmShas = null;
    if (S.result) PL.resultSha = await sha256hex(S.result.stl);
    renderProjectBar();
  }
  /** An assembly in the studio: hash every part's printable STL, then the record (spec + part hashes). */
  async function afterAssembly() {
    PL.resultSha = null; PL.asmShas = null;
    const a = S.asm; if (!a) { renderProjectBar(); return; }
    const shas = {};
    for (const part of a.out.parts) shas[part.id] = await sha256hex(part.stl);
    if (S.asm !== a) return; // replaced while hashing
    PL.asmShas = shas;
    PL.resultSha = await sha256hex(new TextEncoder().encode(FormaAssembly.canonicalRecord(a.spec, shas)));
    renderProjectBar();
  }

  function clearStudio() {
    S.project = null; PL.openId = null; PL.resultSha = null; S.base = null; S.viewRev = null;
    Object.assign(S, { idea: '', understanding: '', qa: [], round: 0, pending: null, design: null, result: null, asm: null, inspection: null, history: [] });
    PL.asmShas = null; if ($('asmBox')) $('asmBox').hidden = true;
    $('thread').textContent = ''; $('ideaBox').hidden = false; $('editForm').hidden = true; $('qform').hidden = true; $('progress').hidden = true; showError('');
    $('resultTitle').textContent = 'النتيجة'; $('status').hidden = true; $('checksChip').hidden = true; $('dims').textContent = '';
    $('summary').hidden = true; $('paramsBox').hidden = true; $('restartRow').hidden = true;
    S.photos = []; $('thumbs').textContent = ''; $('tabsBox').hidden = true; $('download').hidden = true; $('mbar').hidden = true; $('legend').hidden = true;
    clearModel();
    $('overlay').hidden = false; $('vtools').hidden = true;
    renderProjectBar();
  }

  async function openProject(id, force) {
    const p = projectById(id);
    if (!p) { $('pbar').textContent = ''; $('pbar').append(el('p', { className: 'sub', textContent: PL.ready ? 'هذا المشروع غير موجود أو لا تملك صلاحية رؤيته.' : 'جارٍ تحميل المشروع…' })); return; }
    if (S.project === id && hasWork() && !force) { renderProjectBar(); return; }
    const token = ++PL.loadToken;
    clearStudio();
    S.project = id; PL.openId = id; S.base = baseOf(p); PL.conflict = null;
    Object.assign(S, { idea: p.idea || '', understanding: p.understanding || '', qa: p.qa || [], round: 99 });
    $('ideaBox').hidden = true;
    bubble('فكرة الزبون', p.idea || p.title || '');
    if (p.understanding) bubble('المصمّم', p.understanding);
    if ((p.qa || []).length) bubble('الإجابات', '', el('ul', { className: 'list' }, ...p.qa.map((x) => el('li', { textContent: `${x.question} — ${x.answer}` }))));
    renderProjectBar();
    if (isAsm(p) && p.assembly) {
      $('overlay').hidden = false; $('overlay').textContent = 'تُعاد بناء قطع التجميعة وحل القيود…';
      try {
        const out = await evaluateAssembly(p.assembly);
        if (token !== PL.loadToken) return;
        showAssembly(structuredClone(p.assembly), out);
        await afterAssembly();
        if (PL.resultSha !== p.sha) toast('تنبيه: التجميعة المعاد بناؤها لا تطابق بصمة النسخة المحفوظة (تغيّرت نسخة محرك البناء).', true);
      } catch (e) { if (token === PL.loadToken) showError('تعذّر إعادة بناء التجميعة: ' + (e.message || e.code)); }
      return;
    }
    if (!p.design) return;
    $('overlay').hidden = false; $('overlay').textContent = 'يُعاد بناء المجسم من مصدر التصميم…';
    try {
      const r = await build(p.design, p.values || {});
      if (token !== PL.loadToken) return;
      S.design = structuredClone(p.design); S.result = r; S.inspection = null;
      renderResult(true);
      await afterDesign();
      if (PL.resultSha !== p.sha) toast('تنبيه: المجسم المعاد بناؤه لا يطابق بصمة النسخة المحفوظة (تغيّرت نسخة محرك البناء).', true);
    } catch (e) { if (token === PL.loadToken) showError('تعذّر إعادة بناء التصميم: ' + (e.message || e.code)); }
    $('editForm').hidden = !studioEditable() || !S.sample;
  }

  // ------------------------------------------------------------------ project bar (inside the studio)
  function lifecycle(status) {
    const at = LC_INDEX[status] ?? 0, failed = status === 'FAILED';
    return el('ol', { className: 'life' }, ...LIFECYCLE.map(([k, name], i) => {
      const li = el('li', { textContent: name });
      li.dataset.state = i < at ? 'done' : i === at ? (failed ? 'bad' : 'now') : 'todo';
      return li;
    }));
  }
  function actionButton(text, onclick, primary, disabled) {
    const b = el('button', { type: 'button', className: 'btn' + (primary ? ' primary' : ''), textContent: text, disabled: !!disabled });
    b.onclick = async () => { b.disabled = true; try { await onclick(); } catch (e) { /* toast already shown */ } finally { b.disabled = false; } };
    return b;
  }
  function noteForm(label, submitText, onSubmit, opts = {}) {
    const id = 'nf_' + Math.random().toString(36).slice(2, 7);
    const ta = el('textarea', { id, placeholder: opts.placeholder || '' }); ta.style.minHeight = '64px';
    const box = el('div', { className: 'subform' }, el('label', { htmlFor: id, textContent: label }), ta);
    if (opts.extra) box.append(opts.extra);
    box.append(el('div', { className: 'row' }, actionButton(submitText, async () => {
      const v = ta.value.trim();
      if (opts.required && !v) { toast('اكتب الملاحظة أولًا.', true); ta.focus(); return; }
      await onSubmit(v); PL.form = null; renderProjectBar();
    }, true), el('button', { type: 'button', className: 'btn', textContent: 'إلغاء', onclick: () => { PL.form = null; renderProjectBar(); } })));
    return box;
  }

  function renderProjectBar() {
    const bar = $('pbar'); if (!bar) return;
    bar.textContent = '';
    if (!PL.ready) { bar.hidden = true; return; }
    bar.hidden = false;
    const p = current(), me = PL.me && PL.me.id;
    $('studioIntro').hidden = !!p;
    const dirty = !!(hasWork() && PL.resultSha && (!p || PL.resultSha !== p.sha));
    const head = el('div', { className: 'titlebar' });
    head.append(el('div', { className: 'ptitle' }, el('h2', { className: 'name', textContent: p ? p.title : 'مشروع جديد' }),
      p ? pill(PSTATUS, p.status) : el('span', { className: 'pill muted', textContent: 'غير محفوظ' }),
      p ? el('span', { className: 'tag', textContent: 'النسخة ' + (p.revision || 0) + (p.approvedRevision ? ` · المعتمدة ${p.approvedRevision}` : '') }) : ''));
    if (p) head.append(el('span', { className: 'sub', textContent: 'صاحب الطلب: ' + nameOf(p.ownerId) + ' · آخر تحديث ' + fmtAgo(p.updatedAt) }));
    bar.append(head, lifecycle(p ? p.status : 'DRAFT'));

    const notes = el('div', { className: 'pnotes' });
    if (p && p.review && p.review.note && ['CHANGES_REQUESTED', 'IN_REVIEW', 'APPROVED'].includes(p.status)) notes.append(el('div', { className: 'notice', textContent: `ملاحظة المراجع (${nameOf(p.review.by)}): ${p.review.note}` }));
    if (p && p.print && p.print.rejectNote && p.status === 'APPROVED') notes.append(el('div', { className: 'notice', textContent: 'سبب رفض طلب الطباعة: ' + p.print.rejectNote }));
    if (dirty && p) notes.append(el('div', { className: 'notice warnbox', textContent: 'لديك تغييرات على التصميم غير محفوظة في المشروع.' }));
    if (p && hasWork() && PL.resultSha && p.sha && PL.resultSha !== p.sha && !studioEditable()) notes.append(el('div', { className: 'notice', textContent: 'تعرض الآن نسخة معدّلة محليًا؛ لا تملك صلاحية حفظها.' }));
    if (p && PL.conflict) notes.append(el('div', { className: 'notice warnbox' }, el('p', { textContent: PL.conflict.message_ar }), el('div', { className: 'row' },
      el('button', { type: 'button', className: 'btn', textContent: 'أعد التحميل (سيُفقد التعديل غير المحفوظ)', onclick: () => { PL.conflict = null; openProject(p.id, true); } }),
      hasWork() ? el('button', { type: 'button', className: 'btn', textContent: 'احفظ عملي كمشروع منفصل', onclick: () => { PL.conflict = null; commit({ asNew: true, type: null, note: 'نسخة من ' + p.title }); } }) : '')));
    if (p && S.viewRev) notes.append(el('div', { className: 'notice' }, `تعرض الآن النسخة ${S.viewRev} (للقراءة). `, el('button', { type: 'button', className: 'linkbtn', textContent: 'عُد إلى النسخة الحالية', onclick: () => { S.viewRev = null; openProject(p.id, true); } })));
    if (notes.childNodes.length) bar.append(notes);

    const acts = el('div', { className: 'row' });
    const owner = p && p.ownerId === me;
    const S0 = p && p.summary;
    const can = PL.canWrite;
    if (!p) {
      if (hasWork() && can) {
        acts.append(actionButton('احفظ كمسودة', () => commit({ type: null }), false));
        acts.append(actionButton('أرسل للمراجعة', () => commit({ status: 'IN_REVIEW', type: 'submitted' }), true));
      } else acts.append(el('span', { className: 'sub', textContent: S.sample ? 'صِف فكرتك في المحادثة؛ بعد اكتمال التصميم تحفظه هنا وترسله للمراجعة.' : 'المصمّم الذكي يعمل داخل Claude فقط.' }));
    } else if (can) {
      const st = p.status;
      if (['DRAFT', 'CHANGES_REQUESTED'].includes(st) && (owner || may('designer'))) {
        if (dirty) acts.append(actionButton('احفظ التعديلات', () => commit({}), false));
        acts.append(actionButton(st === 'DRAFT' ? 'أرسل للمراجعة' : 'أعد الإرسال للمراجعة', () => commit({ status: 'IN_REVIEW', type: 'submitted' }), true, !hasWork()));
      }
      if (st === 'IN_REVIEW' && may('designer')) {
        if (dirty) acts.append(actionButton('احفظ نسخة معدّلة', () => commit({ type: null, note: 'تعديل المراجع' }), false));
        const g = isAsm(p) ? asmGate(p) : null;
        acts.append(el('button', { type: 'button', className: 'btn primary', textContent: isAsm(p) ? 'اعتمد التجميعة' : 'اعتمد التصميم', disabled: !!(g && (!g.ready || dirty)), title: g && !g.ready ? 'اعتمد كل قطعة أولًا' : '', onclick: () => { PL.form = 'approve'; renderProjectBar(); } }));
        acts.append(el('button', { type: 'button', className: 'btn', textContent: 'اطلب تعديلات من الزبون', onclick: () => { PL.form = 'changes'; renderProjectBar(); } }));
      }
      if (st === 'IN_REVIEW' && owner && !may('designer')) acts.append(el('span', { className: 'sub', textContent: 'بانتظار مراجعة المصمّم. ستصلك النتيجة هنا.' }));
      if (st === 'APPROVED' && (owner || may('admin'))) {
        acts.append(el('button', { type: 'button', className: 'btn primary', textContent: 'اطلب الطباعة', onclick: () => { PL.form = 'print'; renderProjectBar(); } }));
        acts.append(actionButton('أعد فتحه للتعديل', () => commit({ status: 'DRAFT', type: 'reopened', saveDesign: false, extra: { approvedRevision: null, approvedSha: null, approvedPartShas: null } }), false));
      }
      if (st === 'PRINT_REQUESTED') {
        if (may('operator')) {
          acts.append(el('button', { type: 'button', className: 'btn primary', textContent: 'اقبل وأضف للطابور', onclick: () => { PL.form = 'queue'; renderProjectBar(); } }));
          acts.append(el('button', { type: 'button', className: 'btn', textContent: 'ارفض الطلب', onclick: () => { PL.form = 'reject'; renderProjectBar(); } }));
        }
        if (owner) acts.append(actionButton('ألغِ طلب الطباعة', () => patchProject(p, { status: 'APPROVED' }, 'print_cancelled').then(renderAll), false));
      }
      if (['QUEUED', 'PRINTING'].includes(st)) acts.append(may('operator') ? el('a', { className: 'btn', href: '#print', textContent: 'افتح لوحة الطباعة' }) : el('span', { className: 'sub', textContent: st === 'QUEUED' ? 'طلبك في طابور الطباعة.' : 'تطبع قطعتك الآن.' }));
      if (['DONE', 'FAILED'].includes(st) && (owner || may('operator'))) acts.append(el('button', { type: 'button', className: 'btn', textContent: st === 'DONE' ? 'اطلب نسخة أخرى' : 'أعد طلب الطباعة', onclick: () => { PL.form = 'print'; renderProjectBar(); } }));
    }
    if (acts.childNodes.length) bar.append(acts);
    if (p && isAsm(p)) bar.append(componentBox(p, dirty));

    // inline forms
    if (p && PL.form === 'changes') bar.append(noteForm('ما الذي يجب أن يعدّله الزبون؟', 'أرسل طلب التعديل', (v) => commit({ status: 'CHANGES_REQUESTED', type: 'changes', note: v, saveDesign: false, extra: { review: { by: me, note: v, at: Date.now() } } }), { required: true }));
    if (p && PL.form === 'approve' && isAsm(p)) {
      const g = asmGate(p), gate = el('div', { className: 'gate' });
      gate.append(el('p', { className: g.ready ? 'pass' : 'fail', textContent: g.ready ? `كل القطع (${g.parts.length}) معتمدة على ملفاتها الحالية.` : `قطع غير معتمدة: ${g.missing.join('، ')}` }));
      gate.append(el('p', { className: g.needsReason ? 'fail' : 'pass', textContent: g.needsReason ? 'تنبيه: فحص التجميعة لم ينجح — ' + (g.problems.join('؛ ') || 'راجع التقرير') + '. الاعتماد يحتاج سببًا مكتوبًا.' : 'القيود محققة، لا تداخل، ومدى الحركة سليم.' }));
      if (g.ready) bar.append(noteForm(g.needsReason ? 'سبب الاعتماد رغم التنبيهات (إلزامي)' : 'ملاحظة الاعتماد (اختياري)', 'اعتمد التجميعة', (v) => commit({ status: 'APPROVED', type: 'approved', note: v, saveDesign: false, after: (b) => { const g2 = asmGate(b); if (!g2.ready) throw new Error('component approvals changed'); b.approvedRevision = b.revision; b.approvedSha = b.sha; b.approvedPartShas = { ...b.partShas }; b.approvedBy = me; b.review = { by: me, note: v, at: Date.now(), override: g2.needsReason }; } }), { required: g.needsReason, extra: gate }));
      else bar.append(gate);
    } else if (p && PL.form === 'approve') {
      const sum = dirty ? summaryOf(S.result) : S0;
      const ok = summaryOk(sum);
      const gate = el('div', { className: 'gate' });
      gate.append(el('p', { className: ok ? 'pass' : 'fail', textContent: ok ? `الفحوص سليمة: المقاسات ${sum.checks.pass}/${sum.checks.total}، لا مشاكل تصنيع.` : `تنبيه: ${sum ? `المقاسات ${sum.checks.pass}/${sum.checks.total}، مشاكل تصنيع ${sum.dfm.errors}، حالة الشبكة ${STATUS[sum.status] || sum.status}` : 'لا يوجد تحليل'}. الاعتماد يحتاج سببًا مكتوبًا.` }));
      bar.append(noteForm(ok ? 'ملاحظة الاعتماد (اختياري)' : 'سبب الاعتماد رغم التنبيهات (إلزامي)', 'اعتمد', (v) => commit({ status: 'APPROVED', type: 'approved', note: v, after: (b) => { b.approvedRevision = b.revision; b.approvedSha = b.sha; b.approvedBy = me; b.review = { by: me, note: v, at: Date.now(), override: !ok }; } }), { required: !ok, extra: gate }));
    }
    if (p && PL.form === 'print') bar.append(printRequestForm(p));
    if (p && PL.form === 'reject') bar.append(noteForm('سبب رفض طلب الطباعة', 'ارفض', (v) => patchProject(p, { status: 'APPROVED', print: { ...(p.print || {}), rejectNote: v } }, 'print_rejected', v).then(renderAll), { required: true }));
    if (p && PL.form === 'queue') bar.append(queueForm(p));
    if (p) { const ib = invoiceBox(p); if (ib) bar.append(ib); }

    if (p && (p.revision || 0) > 0) bar.append(historyBox(p));
    if (p && (p.events || []).length) {
      const d = el('details', { className: 'timeline' }, el('summary', { textContent: `سجل المشروع (${p.events.length})` }));
      d.append(el('ol', {}, ...p.events.slice().reverse().map((e) => el('li', {}, el('b', { textContent: nameOf(e.by) + ' ' + (EVENT_AR[e.type] || e.type) }), e.note ? ' — ' : '', e.note ? el('bdi', { textContent: e.note }) : '', el('time', { textContent: fmtDate(e.at) })))));
      bar.append(d);
    }
    if (S.design) { $('params').querySelectorAll('input').forEach((i) => { i.disabled = !studioEditable(); }); $('editForm').hidden = !studioEditable() || !S.sample || !S.result; }
    refreshNames([p && p.ownerId, ...((p && p.events) || []).map((e) => e.by), p && p.review && p.review.by]);
  }

  // ------------------------------------------------------------------ assemblies: per-component approval
  function asmGate(p) {
    const names = Object.fromEntries(((p.assembly && p.assembly.parts) || []).map((x) => [x.id, x.name_ar || (x.design && x.design.name_ar) || x.id]));
    const report = p.asmIndex ? { order: p.asmIndex.order, ok: summaryOk(p.summary), constraints: [], interference: [] } : null;
    const g = FormaAssembly.approvalGate(report, p.partShas || {}, p.componentApprovals || {}, names);
    // the stored summary is all that is known without a rebuild; the live report (if this project is open) is more precise
    if (S.asm && S.project === p.id && PL.resultSha === p.sha) { const live = FormaAssembly.approvalGate(S.asm.out.report, p.partShas || {}, p.componentApprovals || {}, names); return live; }
    return g;
  }
  function componentBox(p, dirty) {
    const g = asmGate(p), me = PL.me && PL.me.id;
    const canApprove = PL.canWrite && may('designer') && p.status === 'IN_REVIEW' && !dirty;
    const tb = el('tbody');
    g.parts.forEach((x) => {
      const state = x.approved ? el('span', { className: 'pass', textContent: `معتمدة — ${nameOf(x.by)} ${fmtAgo(x.at)}` }) : x.stale ? el('span', { className: 'fail', textContent: 'تغيّرت بعد اعتمادها — تحتاج اعتمادًا جديدًا' }) : el('span', { className: 'sub', textContent: 'غير معتمدة' });
      const act = el('td');
      if (canApprove && !x.approved) act.append(actionButton('اعتمد القطعة', async () => {
        const fresh = projectById(p.id);
        const ap = FormaAssembly.approveComponent(fresh.componentApprovals, x.id, fresh.partShas[x.id], me, '', Date.now());
        await patchProject(fresh, { componentApprovals: ap }, 'component_approved', x.name_ar);
        renderProjectBar();
      }, false));
      if (canApprove && x.approved) act.append(actionButton('ألغِ اعتمادها', async () => {
        const fresh = projectById(p.id), ap = { ...(fresh.componentApprovals || {}) }; delete ap[x.id];
        await patchProject(fresh, { componentApprovals: ap }, 'component_unapproved', x.name_ar);
        renderProjectBar();
      }, false));
      tb.append(el('tr', {}, el('td', {}, el('b', { textContent: x.name_ar }), el('small', { className: 'block sub num', textContent: x.id + ' · ' + String(x.sha || '').slice(0, 10) })), el('td', {}, state), act));
    });
    const box = el('details', { className: 'timeline', open: p.status === 'IN_REVIEW' }, el('summary', { textContent: `قطع التجميعة — ${g.parts.filter((x) => x.approved).length}/${g.parts.length} معتمدة` }));
    box.append(el('div', { className: 'tblwrap' }, el('table', { className: 'tbl' }, el('thead', {}, el('tr', {}, ...['القطعة', 'الاعتماد', ''].map((h) => el('th', { textContent: h })))), tb)));
    box.append(el('p', { className: 'sub', textContent: dirty && may('designer') ? 'احفظ التعديلات أولًا: الاعتماد يكون على الملف المحفوظ.' : 'كل قطعة تُعتمد على ملفها (بصمة SHA-256). تعديل قطعة يُسقط اعتمادها هي فقط. تُعتمد التجميعة بعد اعتماد كل القطع.' }));
    return box;
  }

  // ------------------------------------------------------------------ revision history
  async function loadRev(p, n) {
    const x = await PL.db.doc(`projects/${p.id}/revisions/r${n}`).get().catch(() => null);
    if (x && x.exists) return { n, ...x.data() };
    return p.revision === n ? { n, kind: p.kind, assembly: p.assembly, partShas: p.partShas, asmIndex: p.asmIndex, design: p.design, values: p.values, sha: p.sha, summary: p.summary, at: p.updatedAt, by: p.ownerId } : null;
  }
  function historyBox(p) {
    const d = el('details', { className: 'timeline', id: 'revs' }, el('summary', { textContent: `النسخ (${p.revision})` }));
    const body = el('div', { className: 'revs' });
    d.append(body);
    d.ontoggle = async () => {
      if (!d.open || body.dataset.loaded === String(p.revision)) return;
      body.dataset.loaded = String(p.revision); body.textContent = 'جارٍ التحميل…';
      const revs = (await Promise.all(Array.from({ length: p.revision }, (_, i) => loadRev(p, i + 1)))).filter(Boolean).reverse();
      body.textContent = '';
      const cur = revs.find((r) => r.n === p.revision);
      const tb = el('tbody'), out = el('div');
      revs.forEach((r) => {
        const tags = [r.n === p.revision ? 'الحالية' : '', r.n === p.approvedRevision ? 'المعتمدة' : ''].filter(Boolean).join(' · ');
        const acts = el('td', { className: 'revacts' });
        acts.append(el('button', { type: 'button', className: 'linkbtn', textContent: 'عرض', onclick: () => viewRevision(p, r) }));
        if (cur && r.n !== p.revision) acts.append(el('button', { type: 'button', className: 'linkbtn', textContent: 'قارن بالحالية', onclick: () => { out.textContent = ''; out.append(diffView(r, cur)); } }));
        if (r.n !== p.revision && studioEditable()) acts.append(el('button', { type: 'button', className: 'linkbtn', textContent: 'استعدها كنسخة جديدة', onclick: () => restoreRevision(p, r) }));
        if (PL.canWrite) acts.append(el('button', { type: 'button', className: 'linkbtn', textContent: 'انسخ كمشروع', onclick: () => duplicateRevision(p, r) }));
        acts.append(el('button', { type: 'button', className: 'linkbtn', textContent: 'تنزيل', onclick: (e) => downloadRevision(p, r, e.target) }));
        tb.append(el('tr', {}, el('td', {}, el('b', { textContent: 'r' + r.n }), tags ? el('small', { className: 'block sub', textContent: tags }) : ''), el('td', { textContent: fmtDate(r.at) }), el('td', { textContent: nameOf(r.by) }), el('td', { className: 'num', textContent: (r.sha || '').slice(0, 10) }), acts));
      });
      body.append(el('div', { className: 'tblwrap' }, el('table', { className: 'tbl' }, el('thead', {}, el('tr', {}, ...['النسخة', 'التاريخ', 'بواسطة', 'البصمة', ''].map((h) => el('th', { textContent: h })))), tb)), out,
        el('p', { className: 'sub', textContent: 'النسخ لا تُعدَّل ولا تُحذف؛ الاستعادة تنشئ نسخة جديدة بنفس التصميم، والنسخة المعتمدة تبقى كما هي.' }));
    };
    return d;
  }
  function diffView(a, b) {
    if (a.assembly || b.assembly) {
      const box = el('div', { className: 'subform' }), li = [];
      box.append(el('b', { textContent: `الفرق بين r${a.n} والحالية r${b.n}` }));
      if (a.sha === b.sha) box.append(el('p', { className: 'pass', textContent: 'التجميعة متطابقة (نفس البصمة).' }));
      const ids = [...new Set([...Object.keys(a.partShas || {}), ...Object.keys(b.partShas || {})])];
      for (const id of ids) { const x = (a.partShas || {})[id], y = (b.partShas || {})[id]; li.push(!x ? `${id}: أُضيفت` : !y ? `${id}: حُذفت` : x === y ? `${id}: بلا تغيير` : `${id}: تغيّر ملفها`); }
      if (!a.assembly || !b.assembly) li.push('إحدى النسختين قطعة مفردة والأخرى تجميعة.');
      box.append(el('ul', { className: 'list ltr' }, ...li.map((t) => el('li', { textContent: t }))));
      return box;
    }
    const D = FormaVersions.diff(a, b), box = el('div', { className: 'subform' });
    box.append(el('b', { textContent: `الفرق بين r${a.n} والحالية r${b.n}` }));
    if (D.sameGeometry) box.append(el('p', { className: 'pass', textContent: 'الشكل الناتج متطابق (نفس البصمة).' }));
    const li = [];
    D.params.forEach((x) => li.push(`${x.name}: ${x.from ?? '—'} ← ${x.to ?? '—'}`));
    D.size.forEach((x) => li.push(`البعد ${x.axis.toUpperCase()}: ${x.from} ← ${x.to} مم`));
    if (D.mass_g.from !== D.mass_g.to) li.push(`الوزن: ${D.mass_g.from ?? '—'} ← ${D.mass_g.to ?? '—'} غ`);
    if (D.checks.from && D.checks.to) li.push(`المقاسات: ${D.checks.from.pass}/${D.checks.from.total} ← ${D.checks.to.pass}/${D.checks.to.total}`);
    li.push(`نموذج CAD: ${D.model.changed} قيمة تغيّرت، ${D.model.added} أُضيفت، ${D.model.removed} حُذفت`);
    box.append(el('ul', { className: 'list ltr' }, ...li.map((t) => el('li', { textContent: t }))));
    if (D.model.examples.length) box.append(el('details', {}, el('summary', { textContent: 'أمثلة من تغييرات النموذج' }), el('ul', { className: 'list ltr' }, ...D.model.examples.map((x) => el('li', { textContent: `${x.kind} ${x.path}: ${JSON.stringify(x.from) ?? ''} → ${JSON.stringify(x.to) ?? ''}` })))));
    return box;
  }
  async function viewRevision(p, r) {
    showError('');
    if (r.assembly) {
      try { const out = await evaluateAssembly(r.assembly); showAssembly(structuredClone(r.assembly), out); S.viewRev = r.n; await afterAssembly(); renderProjectBar(); }
      catch (e) { showError('تعذّر بناء النسخة: ' + (e.message || e.code)); }
      return;
    }
    try { const res = await build(r.design, r.values || {}); S.design = structuredClone(r.design); S.result = res; S.viewRev = r.n; renderResult(true); await afterDesign(); $('editForm').hidden = true; $('params').querySelectorAll('input').forEach((i) => (i.disabled = true)); renderProjectBar(); }
    catch (e) { showError('تعذّر بناء النسخة: ' + (e.message || e.code)); }
  }
  async function restoreRevision(p, r) {
    if (r.assembly) {
      try { const out = await evaluateAssembly(r.assembly); showAssembly(structuredClone(r.assembly), out); S.viewRev = null; await afterAssembly(); await commit({ type: 'revision', note: `استعادة النسخة ${r.n}` }); }
      catch (e) { showError('تعذّرت الاستعادة: ' + (e.message || e.code)); }
      return;
    }
    try { const res = await build(r.design, r.values || {}); S.design = structuredClone(r.design); S.result = res; S.viewRev = null; await afterDesign(); renderResult(true); await commit({ type: 'revision', note: `استعادة النسخة ${r.n}` }); }
    catch (e) { showError('تعذّرت الاستعادة: ' + (e.message || e.code)); }
  }
  async function duplicateRevision(p, r) {
    const now = Date.now(), id = uidOf('p');
    const src = r.assembly ? { kind: 'assembly', assembly: r.assembly, partShas: r.partShas, asmIndex: r.asmIndex || null, design: null, values: null } : { kind: 'part', design: r.design, values: r.values || {} };
    const body = { id, ownerId: PL.me.id, createdAt: now, updatedAt: now, revision: 1, status: 'DRAFT', title: (p.title || 'تصميم') + ` (نسخة من r${r.n})`, idea: p.idea || '', ...src, sha: r.sha, summary: r.summary, duplicatedFrom: { project: p.id, revision: r.n }, events: [event('created', `نسخة من «${p.title}» r${r.n}`)] };
    await write('rev:' + id, () => PL.db.doc(`projects/${id}/revisions/r1`).set({ ...src, sha: r.sha, summary: r.summary, by: PL.me.id, at: now, note: `من ${p.id} r${r.n}` })).catch(dbFail);
    await write('projects/' + id, () => PL.db.doc('projects/' + id).set(body)).catch(dbFail);
    upsertLocal(PL.projects, body); toast('أُنشئ مشروع جديد من النسخة.'); navigate('#project-' + id);
  }
  async function downloadRevision(p, r, btn) {
    if (!S.downloads) { toast('التنزيل غير متاح في هذا العرض.', true); return; }
    btn.disabled = true;
    try {
      const base = `forma-${p.id}-r${r.n}`;
      if (r.assembly) {
        const out = await evaluateAssembly(r.assembly), files = [], shas = {};
        for (const part of out.parts) { shas[part.id] = await sha256hex(part.stl); files.push([`${base}-${part.id}.stl`, part.stl]); }
        const sha = await sha256hex(new TextEncoder().encode(FormaAssembly.canonicalRecord(r.assembly, shas)));
        files.push([base + '-assembly.3mf', out.threemf], ['assembly.formacad.json', new TextEncoder().encode(JSON.stringify({ revision: r.n, assembly: r.assembly, part_sha256: shas, sha256: sha, recorded_sha256: r.sha }, null, 2))]);
        await S.downloads.save({ filename: base + '.zip', data: zip(files) });
        toast(sha === r.sha ? 'نُزّلت النسخة (البصمة مطابقة).' : 'نُزّلت النسخة، لكن بصمتها تختلف عن المسجّلة (تغيّر محرك البناء).', sha !== r.sha);
        return;
      }
      const res = await build(r.design, r.values || {}), sha = await sha256hex(res.stl);
      await S.downloads.save({ filename: base + '.zip', data: zip([[base + '.stl', res.stl], ['design.formacad.json', new TextEncoder().encode(JSON.stringify({ revision: r.n, design: r.design, values: r.values || {}, sha256: sha, recorded_sha256: r.sha }, null, 2))]]) });
      toast(sha === r.sha ? 'نُزّلت النسخة (البصمة مطابقة).' : 'نُزّلت النسخة، لكن بصمتها تختلف عن المسجّلة (تغيّر محرك البناء).', sha !== r.sha);
    } catch (e) { if (!(e && e.code === 'declined')) toast('تعذّر التنزيل: ' + (e.message || e.code), true); }
    finally { btn.disabled = false; }
  }

  // ------------------------------------------------------------------ quote / invoice / manual payment (no online payment here)
  const contactNumber = () => (PL.settings && PL.settings.whatsapp) || FormaCommerce.DEFAULT_CONTACT;
  const fmtIqd = (n) => Number(n).toLocaleString('en') + ' د.ع';
  function invoiceBox(p) {
    const inv = p.invoice, me = PL.me && PL.me.id, owner = p.ownerId === me;
    const relevant = inv || (p.print && ['PRINT_REQUESTED', 'QUEUED', 'PRINTING', 'DONE'].includes(p.status));
    if (!relevant || !(owner || may('operator'))) return null;
    const box = el('div', { className: 'subform invoice' });
    const wa = FormaCommerce.waLink(contactNumber(), `مشروع «${p.title}»${inv ? ' — الفاتورة ' + inv.number : ''}`);
    if (!inv) {
      box.append(el('b', { textContent: 'عرض السعر والفاتورة' }));
      if (!(may('operator') && PL.canWrite)) { box.append(el('p', { className: 'sub', textContent: 'سيصدر فريق الطباعة عرض السعر هنا بعد مراجعة الطلب.' })); if (wa) box.append(el('a', { href: wa, target: '_blank', rel: 'noopener', className: 'btn', textContent: 'تواصل معنا عبر واتساب' })); return box; }
      if (PL.form !== 'invoice') { box.append(el('div', { className: 'row' }, el('button', { type: 'button', className: 'btn', textContent: 'أصدر عرض السعر / الفاتورة', onclick: () => { PL.form = 'invoice'; renderProjectBar(); } }))); return box; }
      let lines;
      try { lines = FormaCommerce.quote(p.summary && p.summary.estimate, (p.print && p.print.qty) || 1, priceOfProject(p), { hourly: Number(PL.settings.hourly) || 1000, setup: Number(PL.settings.setup) || 2000, title: p.title, material: (p.print && p.print.material) || 'PLA' }); }
      catch (e) { lines = [{ description: 'طباعة ' + p.title, qty: (p.print && p.print.qty) || 1, unitIqd: 0 }]; }
      const rows = el('div', { className: 'invlines' });
      const addRow = (l) => {
        const d = el('input', { type: 'text', value: l.description, 'aria-label': 'الوصف' }), q = el('input', { type: 'number', min: 1, value: l.qty, 'aria-label': 'العدد' }), u = el('input', { type: 'number', min: 0, step: 250, value: l.unitIqd, 'aria-label': 'سعر الوحدة' });
        const rm = el('button', { type: 'button', className: 'linkbtn', textContent: 'حذف', onclick: () => { row.remove(); upd(); } });
        const row = el('div', { className: 'invline' }, d, q, u, rm); [d, q, u].forEach((i) => (i.oninput = upd)); rows.append(row);
      };
      const tot = el('b'), err = el('p', { className: 'fail' });
      const read = () => [...rows.children].map((r) => { const [d, q, u] = r.querySelectorAll('input'); return { description: d.value, qty: Number(q.value), unitIqd: Number(u.value) }; });
      const upd = () => { try { tot.textContent = 'المجموع: ' + fmtIqd(FormaCommerce.total(read())); err.textContent = ''; } catch (e) { tot.textContent = ''; err.textContent = e.message; } };
      lines.forEach(addRow); upd();
      box.append(el('b', { textContent: 'عرض السعر' }), el('p', { className: 'sub', textContent: 'مقترح من تقدير الوزن والزمن وسعر المادة؛ عدّل الأسعار قبل الإصدار. المبالغ بالدينار الصحيح.' }), rows,
        el('div', { className: 'row' }, el('button', { type: 'button', className: 'linkbtn', textContent: '+ سطر', onclick: () => { addRow({ description: '', qty: 1, unitIqd: 0 }); upd(); } }), tot), err,
        el('div', { className: 'row' }, actionButton('أصدر الفاتورة', async () => {
          let inv2; try { inv2 = FormaCommerce.makeInvoice(p.id, read(), Date.now(), me); } catch (e) { err.textContent = e.message; return; }
          PL.form = null; await patchProject(p, { invoice: inv2 }, 'invoiced', `${inv2.number} — ${fmtIqd(inv2.totalIqd)}`); renderAll();
        }, true), el('button', { type: 'button', className: 'btn', textContent: 'إلغاء', onclick: () => { PL.form = null; renderProjectBar(); } })));
      return box;
    }
    box.append(el('div', { className: 'ptitle' }, el('b', { textContent: 'الفاتورة ' + inv.number }), el('span', { className: 'pill ' + (inv.status === 'PAID' ? 'ok' : inv.status === 'REFUNDED' ? 'muted' : 'warn'), textContent: { PAID: 'مدفوعة', REFUNDED: 'مُسترجعة', ISSUED: 'بانتظار الدفع' }[inv.status] || inv.status }), el('span', { className: 'tag', textContent: fmtDate(inv.issuedAt) }),
      el('button', { type: 'button', className: 'linkbtn', textContent: 'تنزيل PDF', onclick: async () => {
        if (!S.downloads) { toast('التنزيل غير متاح في هذا العرض.', true); return; }
        try { const bytes = await FormaCommerce.invoicePDF(inv, { customer: nameOf(p.ownerId), project: p.title, contact: contactNumber() }, window.PDFLib, FormaDrawing, { rasterize }); await S.downloads.save({ filename: inv.number + '.pdf', data: new Blob([bytes], { type: 'application/pdf' }) }); }
        catch (e) { if (!(e && e.code === 'declined')) toast('تعذّر إنشاء PDF: ' + ((e && e.message) || e), true); }
      } })));
    const tb = el('tbody');
    inv.lines.forEach((l) => tb.append(el('tr', {}, el('td', { textContent: l.description }), el('td', { className: 'num', textContent: String(l.qty) }), el('td', { className: 'num', textContent: fmtIqd(l.unitIqd) }), el('td', { className: 'num', textContent: fmtIqd(l.qty * l.unitIqd) }))));
    tb.append(el('tr', {}, el('td', {}, el('b', { textContent: 'المجموع' })), el('td'), el('td'), el('td', { className: 'num' }, el('b', { textContent: fmtIqd(inv.totalIqd) }))));
    box.append(el('div', { className: 'tblwrap' }, el('table', { className: 'tbl' }, el('thead', {}, el('tr', {}, ...['البند', 'العدد', 'سعر الوحدة', 'المبلغ'].map((h) => el('th', { textContent: h })))), tb)));
    (inv.payments || []).forEach((x) => box.append(el('p', { className: 'sub', textContent: `دُفعت ${fmtIqd(x.amountIqd)} — ${FormaCommerce.METHODS[x.method] || x.method}، المرجع ${x.reference}، سجّلها ${nameOf(x.by)} في ${fmtDate(x.at)}` })));
    if (inv.refund) box.append(el('p', { className: 'sub', textContent: `استُرجعت ${fmtIqd(inv.refund.amountIqd)} — السبب: ${inv.refund.reason}، المرجع ${inv.refund.reference}، سجّلها ${nameOf(inv.refund.by)} في ${fmtDate(inv.refund.at)}` }));
    if (inv.status === 'PAID' && may('admin') && PL.canWrite) {
      const rs = el('input', { type: 'text', placeholder: 'سبب الاسترجاع' }), rr = el('input', { type: 'text', placeholder: 'رقم عملية الإرجاع', dir: 'ltr' }), ra = el('input', { type: 'number', value: inv.totalIqd, step: 250 });
      const rmsg = el('p', { className: 'fail' });
      box.append(el('details', { className: 'adder' }, el('summary', { textContent: 'استرجاع المبلغ' }),
        el('p', { className: 'sub', textContent: 'أعد المبلغ للزبون أولًا (نقدًا أو تحويلًا، أو من لوحة زين كاش)، ثم سجّل رقم العملية هنا. الفاتورة الأصلية تبقى في السجل.' }),
        el('div', { className: 'formgrid' }, el('label', {}, 'السبب ', rs), el('label', {}, 'المرجع ', rr), el('label', {}, 'المبلغ ', ra)), rmsg,
        el('div', { className: 'row' }, actionButton('سجّل الاسترجاع', async () => {
          let ref; try { ref = FormaCommerce.recordRefund(inv, { id: me, role: 'admin' }, { reason: rs.value, reference: rr.value, amountIqd: Number(ra.value) }, Date.now()); } catch (e) { rmsg.textContent = e.message; return; }
          await patchProject(p, { invoice: ref }, 'refunded', `${inv.number} — ${fmtIqd(ref.totalIqd)} — ${rr.value.trim()}`); renderAll();
        }, false))));
    }
    if (inv.status === 'ISSUED') {
      box.append(el('p', { className: 'sub', textContent: 'الدفع: نقدًا عند الاستلام أو بالتحويل (زين كاش / المصرف العراقي الأول) ثم أرسل رقم العملية عبر واتساب؛ يسجّله المدير هنا. الدفع الإلكتروني المباشر يعمل في نسخة الخادم بعد فتح حساب تاجر.' }));
      if (wa) box.append(el('div', { className: 'row' }, el('a', { href: wa, target: '_blank', rel: 'noopener', className: 'btn', textContent: 'أرسل إثبات الدفع عبر واتساب' })));
      if (may('admin') && PL.canWrite) {
        const m = el('select', {}, ...Object.entries(FormaCommerce.METHODS).map(([k, t]) => el('option', { value: k, textContent: t })));
        const ref = el('input', { type: 'text', placeholder: 'رقم الإيصال أو العملية', dir: 'ltr' }), amt = el('input', { type: 'number', value: inv.totalIqd, step: 250 });
        const msg = el('p', { className: 'fail' });
        box.append(el('div', { className: 'formgrid' }, el('label', {}, 'طريقة الدفع ', m), el('label', {}, 'المرجع ', ref), el('label', {}, 'المبلغ المستلم ', amt)), msg,
          el('div', { className: 'row' }, actionButton('سجّل الدفع', async () => {
            let paid; try { paid = FormaCommerce.recordPayment(inv, { id: me, role: 'admin' }, { method: m.value, reference: ref.value, amountIqd: Number(amt.value) }, Date.now()); } catch (e) { msg.textContent = e.message; return; }
            await patchProject(p, { invoice: paid }, 'paid', `${inv.number} — ${fmtIqd(paid.totalIqd)} — ${ref.value.trim()}`); renderAll();
          }, true), actionButton('ألغِ الفاتورة', async () => { await patchProject(p, { invoice: null, voidedInvoices: [...(p.voidedInvoices || []), { ...inv, status: 'VOID', voidedAt: Date.now(), voidedBy: me }] }, 'invoice_void', inv.number); renderAll(); }, false)));
      }
    }
    return box;
  }

  function printRequestForm(p) {
    if (isAsm(p)) {
      const sets = el('input', { type: 'number', id: 'prQty', min: 1, max: 50, value: 1 });
      const est = p.summary && p.summary.estimate, cost = el('p', { className: 'sub' });
      const n = () => Math.max(1, Math.min(50, parseInt(sets.value, 10) || 1));
      const upd = () => { cost.textContent = est ? `التقدير لـ ${n()} مجموعة: ${(est.mass_g * n()).toFixed(1)} غ، ≈ ${fmtTime(est.time_min * n())}، كلفة المادة ≈ ${Math.round((est.mass_g * n() / 1000) * priceOfProject(p)).toLocaleString('en')} د.ع` : ''; };
      sets.oninput = upd; upd();
      const list = el('ul', { className: 'list' }, ...(p.asmIndex ? p.asmIndex.bom : []).map((r) => el('li', { textContent: `${r.name_ar} × ${r.qty} — ${r.material}` })));
      const extra = el('div', { className: 'formgrid' }, el('label', { htmlFor: 'prQty', textContent: 'عدد المجموعات' }), sets, list, cost);
      return noteForm('ملاحظات للطباعة (اللون، موعد الاستلام…)', 'أرسل طلب الطباعة', (v) => patchProject(p, { status: 'PRINT_REQUESTED', print: { material: est ? est.material : 'PLA', qty: n(), sets: n(), note: v, requestedAt: Date.now(), requestedBy: PL.me.id } }, 'print_requested', `${n()} مجموعة`).then(renderAll), { extra });
    }
    const mat = el('select', { id: 'prMat' }); MATERIALS.forEach((m) => mat.append(el('option', { value: m, textContent: m })));
    mat.value = MATERIALS.includes(String((p.design && p.design.print && p.design.print.material) || '').toUpperCase()) ? p.design.print.material.toUpperCase() : 'PLA';
    const qty = el('input', { type: 'number', id: 'prQty', min: 1, max: 50, value: 1 });
    const est = p.summary && p.summary.estimate;
    const cost = el('p', { className: 'sub' });
    const upd = () => { const n = Math.max(1, Math.min(50, parseInt(qty.value, 10) || 1)); cost.textContent = est ? `التقدير: ${(est.mass_g * n).toFixed(1)} غ، ≈ ${fmtTime(est.time_min * n)}، كلفة المادة ≈ ${Math.round((est.mass_g * n / 1000) * priceOf(mat.value)).toLocaleString('en')} د.ع` : ''; };
    mat.onchange = upd; qty.oninput = upd; upd();
    const extra = el('div', { className: 'formgrid' }, el('label', { htmlFor: 'prMat', textContent: 'المادة' }), mat, el('label', { htmlFor: 'prQty', textContent: 'العدد' }), qty, cost);
    return noteForm('ملاحظات للطباعة (اللون، موعد الاستلام…)', 'أرسل طلب الطباعة', (v) => patchProject(p, { status: 'PRINT_REQUESTED', print: { material: mat.value, qty: Math.max(1, Math.min(50, parseInt(qty.value, 10) || 1)), note: v, requestedAt: Date.now(), requestedBy: PL.me.id } }, 'print_requested', `${mat.value} × ${qty.value}`).then(renderAll), { extra });
  }

  function queueForm(p) {
    const sel = el('select', { id: 'qPrinter' });
    const ok = PL.printers.filter((x) => x.status !== 'MAINTENANCE');
    if (!ok.length) return el('div', { className: 'notice', textContent: 'لا توجد طابعات مسجّلة جاهزة. أضف طابعة من لوحة الطباعة أولًا.' });
    ok.forEach((x) => sel.append(el('option', { value: x.id, textContent: `${x.name} — ${(PRSTATUS[x.status] || [x.status])[0]}` })));
    const extra = el('div', { className: 'formgrid' }, el('label', { htmlFor: 'qPrinter', textContent: 'الطابعة' }), sel);
    return noteForm('ملاحظة للمشغّل (اختياري)', 'أضف للطابور', async (v) => {
      const pr = p.print || {};
      const job = { id: uidOf('j'), projectId: p.id, title: p.title, ownerId: p.ownerId, printerId: sel.value, status: 'QUEUED', material: pr.material || 'PLA', qty: pr.qty || 1, note: [pr.note, v].filter(Boolean).join(' · '), estimate: p.summary && p.summary.estimate, approvedRevision: p.approvedRevision, approvedSha: p.approvedSha, createdAt: Date.now(), createdBy: PL.me.id, events: [event('queued', v)] };
      if (isAsm(p)) Object.assign(job, { kind: 'assembly', parts: FormaAssembly.printParts(p.assembly, p.asmIndex, p.approvedPartShas, pr.sets || pr.qty || 1) });
      await putDoc('jobs', job);
      await patchProject(p, { status: 'QUEUED', jobId: job.id }, 'queued', PL.printers.find((x) => x.id === sel.value)?.name);
      renderAll();
    }, { extra });
  }

  // ------------------------------------------------------------------ names
  const pendingNames = new Set();
  let nameTimer = null;
  function refreshNames(ids) {
    for (const id of ids) if (id && !(id in PL.names)) pendingNames.add(id);
    if (!pendingNames.size || !PL.user || nameTimer) return;
    nameTimer = setTimeout(async () => {
      const list = [...pendingNames]; pendingNames.clear(); nameTimer = null;
      try {
        const ps = await PL.user.profiles(list);
        for (const id of list) PL.names[id] = (ps[id] && ps[id].name) || (PL.me && id === PL.me.id ? 'أنت' : 'مستخدم');
      } catch (e) { for (const id of list) PL.names[id] = 'مستخدم'; }
      renderAll(true);
    }, 60);
  }

  // ------------------------------------------------------------------ views
  function projectTable(list, opts = {}) {
    if (!list.length) return el('p', { className: 'empty', textContent: opts.empty || 'لا شيء هنا بعد.' });
    const tb = el('tbody');
    list.forEach((p) => {
      const s = p.summary;
      const tr = el('tr', {},
        el('td', {}, el('a', { href: '#project-' + p.id, textContent: p.title || 'تصميم' }), el('small', { className: 'block sub', textContent: (p.idea || '').slice(0, 70) })),
        el('td', {}, pill(PSTATUS, p.status)),
        el('td', { className: 'num' }, s ? el('span', { className: summaryOk(s) ? 'pass' : 'fail', textContent: `${s.checks.pass}/${s.checks.total}${s.dfm.errors ? ' · DFM ' + s.dfm.errors : ''}` }) : '—'),
        el('td', { className: 'num', textContent: s && s.size ? `${Math.round(s.size.x)}×${Math.round(s.size.y)}×${Math.round(s.size.z)}` : '—' }));
      if (opts.owner) tr.append(el('td', { textContent: nameOf(p.ownerId) }));
      tr.append(el('td', { textContent: fmtAgo(p.updatedAt) }));
      tb.append(tr);
    });
    const heads = ['المشروع', 'الحالة', 'المقاسات', 'الأبعاد (مم)', ...(opts.owner ? ['صاحب الطلب'] : []), 'آخر تحديث'];
    refreshNames(list.map((p) => p.ownerId));
    return el('div', { className: 'tblwrap' }, el('table', { className: 'tbl' }, el('thead', {}, el('tr', {}, ...heads.map((h) => el('th', { textContent: h })))), tb));
  }

  function card(title, ...kids) { return el('section', { className: 'panel' }, el('h2', { textContent: title }), ...kids); }

  function viewHome() {
    const v = $('v-home'); v.textContent = '';
    const me = PL.me && PL.me.id, r = role();
    const mine = PL.projects.filter((p) => p.ownerId === me);
    const todo = [];
    if (r === 'customer' || r === 'admin') todo.push(...mine.filter((p) => ['CHANGES_REQUESTED', 'APPROVED', 'DRAFT', 'FAILED'].includes(p.status)));
    if (may('designer')) todo.push(...PL.projects.filter((p) => p.status === 'IN_REVIEW'));
    if (may('operator')) todo.push(...PL.projects.filter((p) => ['PRINT_REQUESTED', 'QUEUED', 'PRINTING'].includes(p.status)));
    const uniq = [...new Map(todo.map((p) => [p.id, p])).values()].sort((a, b) => b.updatedAt - a.updatedAt);
    v.append(el('div', { className: 'hello' }, el('h1', { textContent: 'أهلًا ' + (PL.names[me] && PL.names[me] !== 'أنت' ? PL.names[me] : '') }),
      el('p', { className: 'sub', textContent: `دورك على المنصة: ${ROLE_AR[r]}. ${r === 'customer' ? 'صِف القطعة التي تريدها، يصمّمها الذكاء الاصطناعي ويقيسها، يراجعها مصمّم، ثم نطبعها لك.' : 'هنا ما ينتظر إجراءك الآن.'}` }),
      el('div', { className: 'row' }, el('a', { className: 'btn primary', href: '#new', textContent: 'مشروع جديد' }))));
    // in-app notifications: what others did on my projects since I last looked (seen-marker kept on this device)
    const seenKey = 'forma_seen_' + me;
    let seen = 0; try { seen = Number(localStorage.getItem(seenKey)) || 0; } catch (e) { /* storage blocked */ }
    const news = mine.flatMap((p) => (p.events || []).filter((e) => e.by !== me && e.at > seen).map((e) => ({ ...e, p }))).sort((a, b) => b.at - a.at).slice(0, 12);
    if (news.length) {
      const list = el('ol', { className: 'activity' }, ...news.map((e) => el('li', {}, el('a', { href: '#project-' + e.p.id, textContent: e.p.title }), ' — ', el('b', { textContent: EVENT_AR[e.type] || e.type }), e.note ? ' · ' : '', e.note ? el('bdi', { textContent: e.note }) : '', el('time', { textContent: fmtAgo(e.at) }))));
      const done = el('button', { type: 'button', className: 'linkbtn', textContent: 'تمّت القراءة', onclick: () => { try { localStorage.setItem(seenKey, String(Date.now())); } catch (x) { /* ignore */ } viewHome(); renderNav(); } });
      v.append(card(`تنبيهات جديدة (${news.length})`, list, done));
    }
    v.append(card('يحتاج إجراءك', projectTable(uniq, { owner: isStaff(), empty: 'لا شيء ينتظرك الآن.' })));
    v.append(card(isStaff() ? 'كل المشاريع' : 'مشاريعي', projectTable((isStaff() ? PL.projects : mine).slice().sort((a, b) => b.updatedAt - a.updatedAt), { owner: isStaff(), empty: 'لا مشاريع بعد. ابدأ بـ «مشروع جديد» وصِف فكرتك.' })));
  }

  function viewReview() {
    const v = $('v-review'); v.textContent = '';
    if (!may('designer')) { v.append(el('p', { className: 'empty', textContent: 'هذه الصفحة للمصمّمين المراجعين.' })); return; }
    const by = (s) => PL.projects.filter((p) => s.includes(p.status)).sort((a, b) => b.updatedAt - a.updatedAt);
    v.append(el('h1', { textContent: 'مراجعة التصاميم' }), el('p', { className: 'sub', textContent: 'افتح التصميم، راجع جدول المقاسات وقابلية التصنيع والمجسم، عدّل إن لزم، ثم اعتمد أو اطلب تعديلًا. الاعتماد مع فحوص فاشلة يحتاج سببًا مكتوبًا ويُسجَّل.' }));
    v.append(card('بانتظار المراجعة', projectTable(by(['IN_REVIEW']), { owner: true, empty: 'لا تصاميم بانتظار المراجعة.' })));
    v.append(card('أُعيدت للزبون للتعديل', projectTable(by(['CHANGES_REQUESTED']), { owner: true, empty: 'لا شيء.' })));
    v.append(card('معتمدة مؤخرًا', projectTable(by(['APPROVED', 'PRINT_REQUESTED', 'QUEUED', 'PRINTING', 'DONE']).slice(0, 12), { owner: true, empty: 'لا شيء بعد.' })));
  }

  // ------------------------------------------------------------------ printing
  function printerOptions(sel, current) {
    PL.printers.forEach((x) => sel.append(el('option', { value: x.id, textContent: x.name, selected: x.id === current })));
  }
  const safeUrl = (u) => (/^https?:\/\/[^\s"'<>]+$/i.test(String(u || '')) ? String(u) : null);

  async function buildApproved(job) {
    const p = projectById(job.projectId);
    let src = null;
    try { const s = await PL.db.doc(`projects/${job.projectId}/revisions/r${job.approvedRevision}`).get(); if (s.exists) src = s.data(); } catch (e) { /* fall back below */ }
    if (!src && p && p.revision === job.approvedRevision) src = { design: p.design, values: p.values };
    if (!src) throw new Error('لم أجد النسخة المعتمدة من التصميم.');
    const r = await build(src.design, src.values || {});
    const sha = await sha256hex(r.stl);
    return { r, sha, design: src.design, values: src.values || {}, match: sha === job.approvedSha };
  }

  async function buildApprovedAssembly(job) {
    let src = null;
    try { const s = await PL.db.doc(`projects/${job.projectId}/revisions/r${job.approvedRevision}`).get(); if (s.exists) src = s.data(); } catch (e) { /* fall back below */ }
    const p = projectById(job.projectId);
    if (!src && p && p.revision === job.approvedRevision) src = { assembly: p.assembly };
    if (!src || !src.assembly) throw new Error('لم أجد النسخة المعتمدة من التجميعة.');
    const out = await evaluateAssembly(src.assembly);
    const files = [];
    for (const want of job.parts) {
      const part = out.parts.find((x) => x.id === want.id);
      if (!part) throw new Error(`القطعة ${want.id} غير موجودة في النسخة المعتمدة.`);
      const sha = await sha256hex(part.stl);
      files.push({ ...want, stl: part.stl, sha, match: sha === want.approvedSha, size_mm: part.size_mm, spec: src.assembly.parts.find((x) => x.id === want.id) });
    }
    return { out, spec: src.assembly, files, match: files.every((f) => f.match) };
  }
  async function downloadAssemblyJob(job, btn) {
    btn.disabled = true; btn.textContent = 'تُعاد بناء القطع المعتمدة…';
    try {
      const { out, files, match } = await buildApprovedAssembly(job);
      const prn = PL.printers.find((x) => x.id === job.printerId), base = `forma-${job.id}`, zipFiles = [], lines = [
        `مهمة الطباعة: ${job.id} (تجميعة)`, `المشروع: ${job.title}`, `النسخة المعتمدة: ${job.approvedRevision}`, `كل القطع مطابقة لملفاتها المعتمدة: ${match ? 'نعم' : 'لا — راجع قبل الطباعة'}`, ''];
      const comp = [];
      for (const f of files) {
        zipFiles.push([`${base}-${f.id}.stl`, f.stl]);
        lines.push(`${f.name_ar} (${f.id}) × ${f.qty} — ${f.material}`, `  SHA-256: ${f.sha} ${f.match ? '(مطابق)' : '(لا يطابق المعتمد!)'}`, `  الأبعاد: ${f.size_mm.x} × ${f.size_mm.y} × ${f.size_mm.z} مم`);
        const pr = (f.spec && f.spec.design && f.spec.design.print) || {};
        if (pr.orientation_ar) lines.push('  الاتجاه: ' + pr.orientation_ar);
        const sessions = calOf(prn, f.material).sessions;
        if (sessions.length && f.spec) {
          try {
            const fit = FormaCalibration.fitProfile(sessions), v = FormaCalibration.compensate(f.spec.design, fit);
            const vr = await build(v.design, f.spec.values || {}), vsha = await sha256hex(vr.stl);
            zipFiles.push([`${base}-${f.id}-compensated.stl`, vr.stl]);
            comp.push({ part: f.id, of_approved_sha256: f.sha, variant_sha256: vsha, compensation: v.compensation });
            lines.push(`  نسخة معوّضة لهذه الطابعة: تكبير ${v.compensation.scale.join(' / ')}، توسيع الثقوب ${v.compensation.hole_delta_mm} مم — SHA-256 ${vsha}`);
          } catch (e) { lines.push('  لم تُنشأ نسخة معوّضة: ' + e.message); }
        } else lines.push(`  لا معايرة لهذه الطابعة ومادة ${f.material} — يُطبع الملف المعتمد كما هو.`);
        lines.push('');
      }
      lines.push('ملف assembly.3mf للمراجعة فقط (القطع في مواضعها المجمّعة)؛ اطبع كل قطعة من ملفها.');
      zipFiles.push(['assembly.3mf', out.threemf], ['print-sheet.txt', new TextEncoder().encode(lines.join('\n'))], ['report.json', new TextEncoder().encode(JSON.stringify({ parts: files.map(({ stl, spec, ...x }) => x), compensation: comp, assembly_report: out.report }, null, 2))]);
      await S.downloads.save({ filename: base + '.zip', data: zip(zipFiles) });
      toast(match ? 'نُزّلت ملفات القطع المعتمدة (البصمات مطابقة).' : 'نُزّلت الملفات، لكن بصمة قطعة لا تطابق المعتمدة — راجعها قبل الطباعة.', !match);
    } catch (e) { toast(e && e.code === 'declined' ? 'أُلغي التنزيل.' : 'تعذّر تجهيز الملفات: ' + ((e && e.message) || e), true); }
    finally { btn.disabled = false; btn.textContent = 'تنزيل ملفات الطباعة'; }
  }
  async function downloadJob(job, btn) {
    if (!S.downloads) { toast('التنزيل غير متاح في هذا العرض.', true); return; }
    if (job.parts) return downloadAssemblyJob(job, btn);
    btn.disabled = true; btn.textContent = 'يُعاد بناء الملف المعتمد…';
    try {
      const { r, sha, design, values, match } = await buildApproved(job);
      // manufacturing variant for this printer + material (the approved file above stays as it is)
      let variant = null;
      const prn = PL.printers.find((x) => x.id === job.printerId), calSessions = calOf(prn, job.material).sessions;
      if (calSessions.length) {
        const fit = FormaCalibration.fitProfile(calSessions);
        try {
          const v = FormaCalibration.compensate(design, fit);
          const vr = await build(v.design, values); // the approved parameter values, compensated geometry
          variant = { r: vr, sha: await sha256hex(vr.stl), comp: v.compensation, fit };
          // the printer's own overhang limit (from its calibration) instead of the generic 45 degrees
          if (fit.qualitative.overhang_max_deg) {
            const d = await runJob({ job: 'dfm', design, overrides: values, opts: { overhang_deg: fit.qualitative.overhang_max_deg } }).catch(() => null);
            if (d) variant.dfm = { overhang_deg: fit.qualitative.overhang_max_deg, overhang_area_mm2: d.stats.overhang_area_mm2, bridge_max_mm: fit.qualitative.bridge_max_mm || null };
          }
        } catch (e) { variant = { error: e.message }; }
      }
      const pr = design.print || {}, est = r.analysis && r.analysis.estimate;
      const base = `forma-${job.id}-${(job.title || 'part').replace(/[^\w؀-ۿ-]+/g, '_').slice(0, 30)}`;
      const sheet = [
        `مهمة الطباعة: ${job.id}`, `المشروع: ${job.title}`, `النسخة المعتمدة: ${job.approvedRevision}`,
        `SHA-256 للملف: ${sha}`, `مطابق للنسخة المعتمدة: ${match ? 'نعم' : 'لا — راجع قبل الطباعة'}`, '',
        `المادة: ${job.material}   العدد: ${job.qty}`, `ارتفاع الطبقة: ${pr.layer_height_mm || 0.2} مم   الملء: ${pr.infill_percent ?? 20}%   دعامات: ${pr.supports ? 'نعم' : 'لا'}`,
        `الاتجاه: ${pr.orientation_ar || 'كما في الملف (Z للأعلى)'}`, ...(pr.notes_ar || []).map((n) => '- ' + n), '',
        est ? `تقدير لكل قطعة: ${est.mass_g} غ، ${est.filament_m} م خيط، ≈ ${fmtTime(est.time_min)}` : '',
        `أبعاد القطعة: ${r.size_mm.x} × ${r.size_mm.y} × ${r.size_mm.z} مم`, job.note ? `ملاحظات: ${job.note}` : '',
        '', variant && !variant.error ? [
          `نسخة تصنيع معوّضة لهذه الطابعة (${job.material}) — ملف منفصل؛ الملف المعتمد لم يتغيّر:`,
          `  تكبير/تصغير المحاور X/Y/Z: ${variant.comp.scale.join(' / ')}   توسيع الثقوب: ${variant.comp.hole_delta_mm} مم (${variant.comp.holes_adjusted.length} ثقب)`,
          `  إعداد المقطّع: X-Y contour compensation = ${variant.comp.slicer.xy_contour_compensation_mm} مم، X-Y hole compensation = 0${variant.comp.slicer.flow_ratio ? `، Flow ratio = ${variant.comp.slicer.flow_ratio}` : ''}`,
          `  ثقة المعايرة: ${variant.comp.confidence}   SHA-256: ${variant.sha}`,
          ...(variant.dfm ? [`  حسب قياسات هذه الطابعة (تدلٍّ سليم حتى ${variant.dfm.overhang_deg}°${variant.dfm.bridge_max_mm ? `، جسور حتى ${variant.dfm.bridge_max_mm} مم` : ''}): ${variant.dfm.overhang_area_mm2 > 1 ? `${variant.dfm.overhang_area_mm2} مم² تحتاج دعامات` : 'لا سطوح تحتاج دعامات'}`] : []),
          ...(variant.comp.holes_skipped.length ? [`  ثقوب لم تُعوَّض (مائلة أو تحت تحجيم): ${variant.comp.holes_skipped.length}`] : []),
        ].join('\n') : variant ? `لم تُنشأ نسخة معوّضة: ${variant.error}` : 'لا معايرة لهذه الطابعة والمادة — يُطبع الملف المعتمد كما هو.',
        '', 'الخطوات: قطّع الملف في OrcaSlicer ببروفايل الطابعة والمادة ← ارفع G-code إلى OctoPrint ← تأكد من السطح والخيط ← أكّد البدء في المنصة.',
      ].join('\n');
      const extra = variant && !variant.error ? [[base + '-compensated.stl', variant.r.stl], ['compensation.json', new TextEncoder().encode(JSON.stringify({ of_approved_sha256: sha, variant_sha256: variant.sha, printer: prn && prn.name, material: job.material, compensation: variant.comp, calibration: variant.fit }, null, 2))]] : [];
      if (variant && !variant.error && PL.canWrite && job.variantSha !== variant.sha) await putDoc('jobs', { ...structuredClone(job), variantSha: variant.sha, variant: { scale: variant.comp.scale, hole_delta_mm: variant.comp.hole_delta_mm, confidence: variant.comp.confidence, at: Date.now() }, updatedAt: Date.now() }).catch(() => {});
      await S.downloads.save({ filename: base + '.zip', data: zip([[base + '.stl', r.stl], ...extra, ['print-sheet.txt', new TextEncoder().encode(sheet)], ['report.json', new TextEncoder().encode(JSON.stringify({ sha256: sha, approved_sha256: job.approvedSha, size_mm: r.size_mm, checks: r.analysis && r.analysis.checks, manufacturability: r.analysis && { issues: r.analysis.dfm.issues, stats: r.analysis.dfm.stats }, estimate: est, validation: r.post_export_validation }, null, 2))]]) });
      toast(match ? 'نُزّل الملف المعتمد (البصمة مطابقة).' : 'نُزّل الملف، لكن بصمته لا تطابق النسخة المعتمدة — راجعه قبل الطباعة.', !match);
    } catch (e) { toast(e && e.code === 'declined' ? 'أُلغي التنزيل.' : 'تعذّر تجهيز الملف: ' + ((e && e.message) || e), true); }
    finally { btn.disabled = false; btn.textContent = 'تنزيل ملفات الطباعة'; }
  }

  async function jobTransition(job, status, fields, type, note) {
    const now = Date.now();
    const j = { ...structuredClone(job), ...fields, status, updatedAt: now, events: [...(job.events || []), event(type, note)].slice(-40) };
    await putDoc('jobs', j);
    const pr = PL.printers.find((x) => x.id === j.printerId);
    if (pr) {
      if (status === 'PRINTING') await putDoc('printers', { ...structuredClone(pr), status: 'PRINTING', currentJob: j.id, updatedAt: now });
      else if (pr.currentJob === j.id) await putDoc('printers', { ...structuredClone(pr), status: 'IDLE', currentJob: null, updatedAt: now });
    }
    const p = projectById(j.projectId);
    if (p) await patchProject(p, { status: status === 'CANCELLED' ? 'APPROVED' : status, jobId: status === 'CANCELLED' ? null : j.id }, type, note);
    renderAll();
  }

  function jobCard(j) {
    const pr = PL.printers.find((x) => x.id === j.printerId);
    const c = el('article', { className: 'job' });
    c.append(el('div', { className: 'titlebar' }, el('a', { href: '#project-' + j.projectId, className: 'jtitle', textContent: j.title }), pill(JSTATUS, j.status)));
    const est = j.estimate;
    c.append(factRow([['الطابعة', pr ? pr.name : '—'], ['المادة × العدد', `${j.material} × ${j.qty}`], ['التقدير', est ? `${(est.mass_g * j.qty).toFixed(0)} غ · ${fmtTime(est.time_min * j.qty)}` : '—'], ['النسخة', j.approvedRevision || '—']]));
    if (j.parts) c.append(el('ul', { className: 'list' }, ...j.parts.map((x) => el('li', { textContent: `${x.name_ar} × ${x.qty} — ${x.material}` }))));
    if (j.note) c.append(el('p', { className: 'sub', textContent: j.note }));
    if (j.status === 'PRINTING' && j.startedAt && est) c.append(el('p', { className: 'sub', textContent: `بدأت ${fmtDate(j.startedAt)} · الانتهاء المتوقع ≈ ${fmtDate(j.startedAt + est.time_min * j.qty * 60000)}` }));
    if (j.failReason) c.append(el('p', { className: 'fail', textContent: 'السبب: ' + j.failReason }));
    if (!PL.canWrite || !may('operator')) return c;
    const row = el('div', { className: 'row' });
    if (['QUEUED', 'PRINTING'].includes(j.status)) {
      const dl = el('button', { type: 'button', className: 'btn', textContent: 'تنزيل ملفات الطباعة' }); dl.onclick = () => downloadJob(j, dl); row.append(dl);
      const url = pr && safeUrl(pr.url);
      if (url) row.append(el('a', { className: 'btn', href: url, target: '_blank', rel: 'noopener', textContent: 'افتح OctoPrint ↗' }));
    }
    const live = octoReady(pr);
    if (live && ['QUEUED', 'PRINTING'].includes(j.status)) c.append(el('p', { className: 'sub octo', id: 'jprog_' + j.id, textContent: jobLiveText(j, pr) }));
    if (j.gcode) c.append(el('p', { className: 'sub', textContent: `على الطابعة: ${j.gcode.name} (${(j.gcode.size / 1048576).toFixed(1)} MB)` }));
    if (j.status === 'QUEUED' && live) {
      const fi = el('input', { type: 'file', id: 'gc_' + j.id, accept: '.gcode,.gco,.g,.bgcode' }); fi.hidden = true;
      fi.onchange = async () => {
        const f = fi.files[0]; fi.value = ''; if (!f) return;
        toast('يُرفع ' + f.name + ' إلى ' + pr.name + '…');
        try {
          const res = await OCTO.upload(pr, f.name, f);
          const name = (res && res.files && res.files.local && res.files.local.name) || f.name;
          await putDoc('jobs', { ...structuredClone(j), gcode: { name, size: f.size, at: Date.now(), by: PL.me.id }, updatedAt: Date.now(), events: [...(j.events || []), event('uploaded', name)].slice(-40) });
          toast('رُفع الملف إلى الطابعة. لم تبدأ الطباعة بعد.'); viewPrint();
        } catch (e) { toast(e.message, true); }
      };
      row.append(el('label', { className: 'btn', htmlFor: fi.id, textContent: j.gcode ? 'استبدل ملف G-code' : 'ارفع G-code للطابعة' }), fi);
    }
    if (j.status === 'QUEUED') {
      row.append(el('button', { type: 'button', className: 'btn primary', textContent: 'ابدأ الطباعة…', onclick: () => { PL.form = 'start:' + j.id; viewPrint(); } }));
      row.append(actionButton('ألغِ المهمة', () => jobTransition(j, 'CANCELLED', {}, 'job_cancelled'), false));
    }
    if (j.status === 'PRINTING') {
      if (live) row.append(el('button', { type: 'button', className: 'btn', textContent: 'أوقف الطباعة…', onclick: () => { PL.form = 'cancel:' + j.id; viewPrint(); } }));
      row.append(el('button', { type: 'button', className: 'btn primary', textContent: 'اكتملت بنجاح', onclick: () => { PL.form = 'done:' + j.id; viewPrint(); } }));
      row.append(el('button', { type: 'button', className: 'btn', textContent: 'فشلت', onclick: () => { PL.form = 'fail:' + j.id; viewPrint(); } }));
    }
    c.append(row);
    if (PL.form === 'start:' + j.id) {
      const busy = pr && pr.status !== 'IDLE' && pr.currentJob !== j.id;
      const items = [`قطّعتُ الملف المعتمد ببروفايل ${pr ? pr.name : 'الطابعة'} ومادة ${j.material}`, ...(live ? [] : [`رفعتُ G-code إلى OctoPrint على ${pr ? pr.name : 'الطابعة'}`]), 'سطح الطباعة نظيف ومُسوّى ولا يوجد عليه شيء', `الخيط المحمّل ${j.material} ويكفي (≈ ${est ? (est.mass_g * j.qty).toFixed(0) : '?'} غ)`, 'سأراقب الطبقة الأولى'];
      const boxes = items.map((t, i) => { const id = `ck_${j.id}_${i}`; return el('label', { className: 'check', htmlFor: id }, el('input', { type: 'checkbox', id }), t); });
      const go = actionButton('أؤكد بدء الطباعة الآن', async () => {
        if (busy) { toast('الطابعة مشغولة أو في صيانة.', true); return; }
        if (!boxes.every((b) => b.querySelector('input').checked)) { toast('أكمل قائمة التحقق قبل البدء.', true); return; }
        if (live) {
          if (!j.gcode) { toast('ارفع ملف G-code إلى الطابعة أولًا.', true); return; }
          try { await OCTO.start(pr, j.gcode.name); } catch (e) { toast('لم تبدأ الطباعة: ' + e.message, true); return; }
        }
        PL.form = null; await jobTransition(j, 'PRINTING', { startedAt: Date.now(), startedBy: PL.me.id, startedVia: live ? 'octoprint' : 'manual' }, 'started', (pr && pr.name) + (live ? ' · عبر OctoPrint' : ''));
      }, true);
      c.append(el('div', { className: 'subform' }, el('p', { className: 'label', textContent: live ? `قائمة التحقق قبل البدء — عند التأكيد يُرسل أمر البدء إلى ${pr.name} لملف ${j.gcode ? j.gcode.name : '(لم يُرفع ملف بعد)'}.` : 'قائمة التحقق قبل البدء — ابدأ الطباعة من OctoPrint بعد إكمالها، ثم أكّد هنا.' }), ...boxes, busy ? el('p', { className: 'fail', textContent: 'هذه الطابعة مشغولة الآن.' }) : '', el('div', { className: 'row' }, go, el('button', { type: 'button', className: 'btn', textContent: 'إلغاء', onclick: () => { PL.form = null; viewPrint(); } }))));
    }
    if (PL.form === 'done:' + j.id) {
      const g = el('input', { type: 'number', id: 'actual_' + j.id, min: 0, step: 0.1, placeholder: est ? String((est.mass_g * j.qty).toFixed(1)) : '' });
      c.append(el('div', { className: 'subform' }, el('label', { htmlFor: g.id, textContent: 'الوزن الفعلي بالغرام (من OrcaSlicer أو الميزان، اختياري)' }), g,
        el('div', { className: 'row' }, actionButton('سجّل الاكتمال', async () => { PL.form = null; const a = parseFloat(g.value); await jobTransition(j, 'DONE', { finishedAt: Date.now(), actual_g: Number.isFinite(a) ? a : null }, 'done', Number.isFinite(a) ? a + ' غ' : ''); }, true), el('button', { type: 'button', className: 'btn', textContent: 'إلغاء', onclick: () => { PL.form = null; viewPrint(); } }))));
    }
    if (PL.form === 'cancel:' + j.id) {
      const t = el('textarea', { id: 'cr_' + j.id, placeholder: 'مثال: الطبقة الأولى لم تلتصق' });
      c.append(el('div', { className: 'subform' }, el('label', { htmlFor: t.id, textContent: `سيُرسل أمر إيقاف إلى ${pr ? pr.name : 'الطابعة'} وتُسجَّل المهمة فاشلة. السبب (إلزامي):` }), t,
        el('div', { className: 'row' }, actionButton('أوقف الطباعة الآن', async () => {
          const v = t.value.trim(); if (!v) { toast('اكتب سبب الإيقاف.', true); return; }
          try { await OCTO.cancel(pr); } catch (e) { toast('لم يُرسل الإيقاف: ' + e.message, true); return; }
          PL.form = null; await jobTransition(j, 'FAILED', { finishedAt: Date.now(), failReason: 'أُوقفت من المنصة: ' + v }, 'failed', v);
        }, true), el('button', { type: 'button', className: 'btn', textContent: 'تراجع', onclick: () => { PL.form = null; viewPrint(); } }))));
    }
    if (PL.form === 'fail:' + j.id) {
      const t = el('textarea', { id: 'fr_' + j.id, placeholder: 'مثال: انفصلت الطبقة الأولى عن السطح عند 3 مم' });
      c.append(el('div', { className: 'subform' }, el('label', { htmlFor: t.id, textContent: 'سبب الفشل (إلزامي)' }), t,
        el('div', { className: 'row' }, actionButton('سجّل الفشل', async () => { const v = t.value.trim(); if (!v) { toast('اكتب سبب الفشل.', true); return; } PL.form = null; await jobTransition(j, 'FAILED', { finishedAt: Date.now(), failReason: v }, 'failed', v); }, true), el('button', { type: 'button', className: 'btn', textContent: 'إلغاء', onclick: () => { PL.form = null; viewPrint(); } }))));
    }
    return c;
  }

  function printerPanel() {
    const box = card('الطابعات');
    box.append(el('p', { className: 'sub', textContent: LOCAL
      ? 'هذه النسخة تعمل من ملف على جهازك، فتستطيع الاتصال المباشر بـ OctoPrint داخل شبكتك: احفظ مفتاح API لكل طابعة (يبقى على هذا الجهاز فقط ولا يدخل النسخة الاحتياطية). فعّل CORS في OctoPrint: الإعدادات ← API ← Allow Cross Origin Resource Sharing.'
      : 'هذه الصفحة لا تستطيع الاتصال المباشر بطابعتك: المتصفح يمنع صفحة على الإنترنت من الوصول إلى عنوان داخل شبكتك. ارفع G-code من OctoPrint وأكّد الخطوات هنا، أو استخدم نسخة الملف المحلي التي تتصل بالطابعة مباشرة.' }));
    if (!PL.printers.length) box.append(el('p', { className: 'empty', textContent: 'لا طابعات مسجّلة بعد. أضف طابعتك ليظهر اسمها في الطابور.' }));
    else {
      const tb = el('tbody');
      PL.printers.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach((x) => {
        const url = safeUrl(x.url);
        const j = x.currentJob && PL.jobs.find((y) => y.id === x.currentJob);
        const conn = el('td');
        if (url) conn.append(el('a', { href: url, target: '_blank', rel: 'noopener', textContent: 'OctoPrint ↗' }));
        if (LOCAL) {
          conn.append(el('span', { className: 'block sub octo', id: 'octo_' + x.id, textContent: octoReady(x) ? octoText(x.id) : 'غير متصلة من هذا الجهاز' }));
          if (PL.canWrite && may('operator') && url) conn.append(el('button', { type: 'button', className: 'linkbtn', textContent: OCTO.keyOf(x.id) ? 'إعداد الاتصال' : 'اتصل بالطابعة', onclick: () => { PL.form = 'octo:' + x.id; viewPrint(); } }));
        }
        const tr = el('tr', {}, el('td', {}, el('b', { textContent: x.name }), el('small', { className: 'block sub', textContent: x.model || '' })), el('td', {}, pill(PRSTATUS, x.status)), el('td', { textContent: j ? j.title : '—' }), conn.childNodes.length ? conn : el('td', { textContent: '—' }));
        if (PL.canWrite && may('operator')) {
          const td = el('td');
          if (x.status !== 'PRINTING') td.append(actionButton(x.status === 'MAINTENANCE' ? 'أعدها للخدمة' : 'صيانة', () => putDoc('printers', { ...structuredClone(x), status: x.status === 'MAINTENANCE' ? 'IDLE' : 'MAINTENANCE', updatedAt: Date.now() }).then(renderAll)));
          tr.append(td);
        }
        tb.append(tr);
      });
      box.append(el('div', { className: 'tblwrap' }, el('table', { className: 'tbl' }, el('thead', {}, el('tr', {}, ...['الطابعة', 'الحالة', 'المهمة الحالية', 'الاتصال', ...(PL.canWrite && may('operator') ? [''] : [])].map((h) => el('th', { textContent: h })))), tb)));
      const fp = PL.form && PL.form.startsWith('octo:') && PL.printers.find((x) => 'octo:' + x.id === PL.form);
      if (fp) box.append(octoKeyForm(fp));
    }
    if (PL.canWrite && may('operator')) {
      const f = el('form', { className: 'formgrid addprinter' });
      const n = el('input', { type: 'text', id: 'npName', placeholder: 'Ender-3 V2 — الطاولة 1', required: true });
      const m = el('input', { type: 'text', id: 'npModel', placeholder: 'Creality Ender-3 · فوهة 0.4' });
      const u = el('input', { type: 'text', id: 'npUrl', placeholder: 'http://192.168.1.50' }); u.dir = 'ltr';
      f.append(el('label', { htmlFor: 'npName', textContent: 'اسم الطابعة' }), n, el('label', { htmlFor: 'npModel', textContent: 'الطراز' }), m, el('label', { htmlFor: 'npUrl', textContent: 'عنوان OctoPrint (للفتح فقط؛ لا تكتب مفتاح API هنا)' }), u, el('div', { className: 'row' }, el('button', { type: 'submit', className: 'btn primary', textContent: 'أضف الطابعة' })));
      f.onsubmit = async (e) => {
        e.preventDefault();
        if (!n.value.trim()) return;
        if (u.value.trim() && !safeUrl(u.value.trim())) { toast('العنوان يجب أن يبدأ بـ http:// أو https://', true); return; }
        await putDoc('printers', { id: uidOf('pr'), name: n.value.trim(), model: m.value.trim(), url: u.value.trim(), status: 'IDLE', currentJob: null, buildVolume: [220, 220, 250], createdAt: Date.now(), createdBy: PL.me.id }).then(() => { n.value = m.value = u.value = ''; renderAll(); toast('أُضيفت الطابعة.'); }).catch(() => {});
      };
      box.append(el('details', { className: 'adder' }, el('summary', { textContent: 'إضافة طابعة' }), f));
    }
    return box;
  }

  const fmtTemp = (t) => (t && t.actual != null ? `${Math.round(t.actual)}/${Math.round(t.target || 0)}°` : '—');
  function octoText(id) {
    const o = PL.octo[id];
    if (!o) return 'جارٍ الاتصال…';
    if (o.error) return 'خطأ: ' + o.error;
    const pr = o.printer || {}, tp = pr.temperature || {};
    return `${(pr.state && pr.state.text) || '—'} · فوهة ${fmtTemp(tp.tool0)} · سرير ${fmtTemp(tp.bed)} · ${fmtAgo(o.at)}`;
  }
  function jobLiveText(j, pr) {
    const o = PL.octo[pr.id];
    if (!o || o.error) return 'حالة الطابعة: ' + octoText(pr.id);
    const jb = o.job || {}, file = jb.job && jb.job.file && jb.job.file.name, prog = jb.progress || {};
    const mine = j.gcode && file === j.gcode.name;
    if (j.status === 'PRINTING' && mine) {
      const done = prog.completion != null && prog.completion >= 99.9 && !/print|pause/i.test(jb.state || '');
      return done ? 'الطابعة أنهت الملف — افحص القطعة ثم سجّل الاكتمال.' : `التقدم ${prog.completion != null ? prog.completion.toFixed(1) : '?'}% · متبقٍ ≈ ${prog.printTimeLeft != null ? fmtTime(Math.round(prog.printTimeLeft / 60)) : '?'} · ${jb.state || ''}`;
    }
    return `الطابعة: ${jb.state || '—'}${file ? ' · الملف المحدد: ' + file : ''}`;
  }
  async function pollOcto() {
    if (!LOCAL || PL.route !== 'print' || document.hidden) return;
    await Promise.all(PL.printers.filter(octoReady).map(async (pr) => {
      try { const st = await OCTO.status(pr); PL.octo[pr.id] = { ...st, at: Date.now() }; }
      catch (e) { PL.octo[pr.id] = { error: e.message, at: Date.now() }; }
    }));
    PL.printers.forEach((pr) => { const n = $('octo_' + pr.id); if (n) n.textContent = octoReady(pr) ? octoText(pr.id) : 'غير متصلة من هذا الجهاز'; });
    PL.jobs.forEach((j) => { const n = $('jprog_' + j.id), pr = PL.printers.find((x) => x.id === j.printerId); if (n && pr) n.textContent = jobLiveText(j, pr); });
  }
  if (LOCAL) setInterval(pollOcto, 5000);
  function octoKeyForm(pr) {
    const k = el('input', { type: 'password', id: 'octoKey', autocomplete: 'off', placeholder: 'من OctoPrint: الإعدادات ← Application Keys أو API' }); k.dir = 'ltr';
    const msg = el('p', { className: 'sub' });
    return el('div', { className: 'subform' }, el('label', { htmlFor: 'octoKey', textContent: `مفتاح API لـ ${pr.name} (${pr.url}) — يُحفظ على هذا الجهاز فقط` }), k, msg,
      el('div', { className: 'row' },
        actionButton('احفظ واختبر الاتصال', async () => {
          if (k.value.trim()) OCTO.setKey(pr.id, k.value.trim());
          if (!OCTO.keyOf(pr.id)) { msg.textContent = 'أدخل المفتاح.'; return; }
          msg.textContent = 'يتصل…';
          try { const v = await OCTO.version(pr); msg.textContent = `متصل: OctoPrint ${v.server || ''} (API ${v.api || ''}).`; msg.className = 'pass'; toast('اتصلت المنصة بـ ' + pr.name); pollOcto(); }
          catch (e) { msg.textContent = e.message; msg.className = 'fail'; }
        }, true),
        el('button', { type: 'button', className: 'btn', textContent: 'احذف المفتاح من هذا الجهاز', onclick: () => { OCTO.setKey(pr.id, null); delete PL.octo[pr.id]; PL.form = null; viewPrint(); } }),
        el('button', { type: 'button', className: 'btn', textContent: 'إغلاق', onclick: () => { PL.form = null; viewPrint(); } })));
  }

  // ------------------------------------------------------------------ calibration (per printer + material, stored on the printer)
  const CONF_AR = { high: ['ثقة عالية', 'ok'], medium: ['ثقة متوسطة', 'info'], low: ['ثقة منخفضة', 'warn'], none: ['لا بيانات', 'muted'] };
  function calOf(pr, material) { return (pr && pr.calibration && pr.calibration[String(material || 'PLA').toUpperCase()]) || { sessions: [] }; }
  async function saveSession(pr, material, sess) {
    const m = String(material).toUpperCase(), body = structuredClone(pr);
    body.calibration = body.calibration || {};
    const cur = body.calibration[m] || { sessions: [] };
    body.calibration[m] = { sessions: [...cur.sessions, sess].slice(-40), updatedAt: Date.now() };
    body.updatedAt = Date.now();
    await putDoc('printers', body);
  }
  async function downloadTest(key, btn) {
    if (!S.downloads) { toast('التنزيل غير متاح في هذا العرض.', true); return; }
    btn.disabled = true;
    try { const r = await build(FormaCalibration.testDesign(key), {}); await S.downloads.save({ filename: `forma-calibration-${key}.stl`, data: new Blob([r.stl]) }); }
    catch (e) { if (!(e && e.code === 'declined')) toast('تعذّر تجهيز الملف: ' + ((e && e.message) || e), true); }
    finally { btn.disabled = false; }
  }
  function measureForm(pr, t) {
    const f = el('form', { className: 'subform' });
    f.append(el('b', { textContent: t.name_ar }), el('p', { className: 'sub', textContent: t.how_ar }));
    const inputs = {};
    if (t.result) {
      if (t.result.per) t.result.per.forEach((name, i) => { const s = el('select', {}, ...t.result.options.map((o) => el('option', { value: o, textContent: { ok: 'سليم', high: 'مرتفع', low: 'منخفض' }[o] }))); inputs['per' + i] = s; f.append(el('label', { className: 'price' }, name + ' ', s)); });
      else { const s = el('select', {}, ...t.result.options.map((o) => el('option', { value: o, textContent: String(o) }))); inputs.v = s; f.append(el('label', { className: 'price' }, t.result.label_ar + ' ', s)); }
    } else {
      const g = el('div', { className: 'calgrid' });
      t.measure.forEach((m) => { const i = el('input', { type: 'text', inputMode: 'decimal', placeholder: String(m.nominal), dir: 'ltr' }); inputs[m.id] = i; g.append(el('label', {}, el('span', { textContent: `${m.label_ar} (اسمي ${m.nominal})` }), i)); });
      f.append(g, el('p', { className: 'sub', textContent: 'اترك الخانة فارغة إن لم تقسها. القيم بالملليمتر من القدمة (الفاصلة أو النقطة).' }));
    }
    const msg = el('p', { className: 'fail' });
    f.append(msg, el('div', { className: 'row' }, el('button', { type: 'submit', className: 'btn primary', textContent: 'احفظ القياسات' }), el('button', { type: 'button', className: 'btn', textContent: 'إلغاء', onclick: () => { PL.cal.test = null; viewPrint(); } })));
    f.onsubmit = async (e) => {
      e.preventDefault();
      const vals = {};
      if (t.result) vals[t.result.id] = t.result.per ? t.result.per.map((_, i) => inputs['per' + i].value) : inputs.v.value;
      else for (const [k, i] of Object.entries(inputs)) vals[k] = i.value.trim();
      const chk = FormaCalibration.checkEntry(t.key, vals);
      if (!chk.ok) { msg.textContent = chk.errors.join(' — '); return; }
      await saveSession(pr, PL.cal.material, { test: t.key, at: Date.now(), by: PL.me.id, points: chk.points, result: chk.result || null }).then(() => { PL.cal.test = null; toast('حُفظت القياسات وأُعيد حساب المعايرة.'); viewPrint(); }).catch(() => {});
    };
    return f;
  }
  function calibrationPanel() {
    const box = card('معايرة الطابعات');
    box.append(el('p', { className: 'sub', textContent: 'اطبع قطع المعايرة بمادة الطباعة الفعلية، قِسها بالقدمة، وأدخل القياسات. تُحسب لكل طابعة ومادة معادلة لكل محور (المقاس المطبوع = معامل × المقاس الاسمي + إزاحة) بالمربعات الصغرى مع درجة الثقة. عند تنزيل ملفات مهمة على هذه الطابعة تُضاف نسخة تصنيع معوّضة منفصلة؛ الملف المعتمد لا يتغيّر أبدًا.' }));
    if (!PL.printers.length) { box.append(el('p', { className: 'empty', textContent: 'أضف طابعة أولًا.' })); return box; }
    if (!PL.printers.some((x) => x.id === PL.cal.printerId)) PL.cal.printerId = PL.printers[0].id;
    const pr = PL.printers.find((x) => x.id === PL.cal.printerId);
    const ps = el('select', { id: 'calPrinter' }); printerOptions(ps, PL.cal.printerId); ps.onchange = () => { PL.cal.printerId = ps.value; PL.cal.test = null; viewPrint(); };
    const ms = el('select', { id: 'calMaterial' }, ...MATERIALS.map((m) => el('option', { value: m, textContent: m, selected: m === PL.cal.material }))); ms.onchange = () => { PL.cal.material = ms.value; PL.cal.test = null; viewPrint(); };
    box.append(el('div', { className: 'row' }, el('label', { className: 'price' }, 'الطابعة ', ps), el('label', { className: 'price' }, 'المادة ', ms)));
    const cal = calOf(pr, PL.cal.material), fit = FormaCalibration.fitProfile(cal.sessions);
    // ---- current fit
    if (!cal.sessions.length) box.append(el('p', { className: 'empty', textContent: `لا قياسات لـ ${pr.name} بمادة ${PL.cal.material} بعد. ابدأ بمكعب XYZ ودرجات الأبعاد.` }));
    else {
      box.append(el('div', { className: 'ptitle' }, el('b', { textContent: 'المعايرة الحالية' }), pill(CONF_AR, fit.confidence), el('span', { className: 'tag', textContent: `${cal.sessions.length} جلسة قياس · آخرها ${fmtDate(cal.sessions[cal.sessions.length - 1].at)}` })));
      const tb = el('tbody');
      for (const a of ['x', 'y', 'z']) {
        const f = fit.axes[a];
        tb.append(el('tr', {}, el('td', { textContent: a.toUpperCase() }), ...(f ? [f.scaleFitted ? f.s.toFixed(4) : '— (يحتاج مقاسين مختلفين)', (f.b >= 0 ? '+' : '') + f.b.toFixed(3), f.n, f.rms.toFixed(3), f.se_s != null ? (f.se_s < 0.0001 ? '< 0.0001' : '±' + f.se_s.toFixed(4)) : '—'].map((x) => el('td', { className: 'num', textContent: String(x) })) : [el('td', { textContent: 'لا قياسات' })]), el('td', {}, f ? pill(CONF_AR, f.confidence) : '')));
      }
      if (fit.holes) tb.append(el('tr', {}, el('td', { textContent: 'الثقوب' }), el('td', { className: 'num', textContent: fit.holes.scaleFrom === 'x' ? 'من X' : fit.holes.s.toFixed(4) }), el('td', { className: 'num', textContent: (fit.holes.b >= 0 ? '+' : '') + fit.holes.b.toFixed(3) }), el('td', { className: 'num', textContent: fit.holes.n }), el('td', { className: 'num', textContent: fit.holes.rms.toFixed(3) }), el('td', { textContent: '—' }), el('td', {}, pill(CONF_AR, fit.holes.confidence))));
      box.append(el('div', { className: 'tblwrap' }, el('table', { className: 'tbl' }, el('thead', {}, el('tr', {}, ...['المحور', 'المعامل s', 'الإزاحة b (مم)', 'النقاط', 'RMS (مم)', 'الخطأ المعياري لـ s', 'الثقة'].map((h) => el('th', { textContent: h })))), tb)));
      const q = fit.qualitative, notes = [];
      if (fit.flow) notes.push(`نسبة التدفّق المقترحة: ${fit.flow.multiplier} (جدار ${fit.flow.nominal} مم قيس ${fit.flow.measured})`);
      if (q.overhang_max_deg) notes.push(`أكبر تدلٍّ سليم: ${q.overhang_max_deg}° — ما زاد عنه يحتاج دعامات على هذه الطابعة`);
      if (q.bridge_max_mm) notes.push(`أطول جسر سليم: ${q.bridge_max_mm} مم`);
      if (q.first_layer) { const bad = q.first_layer.map((v, i) => (v === 'ok' ? null : `${FormaCalibration.testByKey('first_layer').result.per[i]}: ${v === 'high' ? 'مرتفع' : 'منخفض'}`)).filter(Boolean); notes.push(bad.length ? 'الطبقة الأولى تحتاج تسوية: ' + bad.join('، ') : 'الطبقة الأولى سليمة في كل المواضع'); }
      if (notes.length) box.append(el('ul', { className: 'list' }, ...notes.map((n) => el('li', { textContent: n }))));
      if (fit.warnings.length) box.append(el('ul', { className: 'list ltr' }, ...fit.warnings.map((w) => el('li', { className: 'warnc', textContent: w }))));
      let usable = '';
      try { FormaCalibration.compensate({ model: { box: { size: [1, 1, 1] } } }, fit); usable = 'صالحة للتعويض: ستُضاف نسخة معوّضة لملفات المهام على هذه الطابعة.'; } catch (e) { usable = 'غير صالحة للتعويض بعد: ' + e.message; }
      box.append(el('p', { className: 'sub', textContent: usable }));
    }
    // ---- test objects
    const list = el('div', { className: 'caltests' });
    FormaCalibration.TESTS.forEach((t) => {
      const done = cal.sessions.filter((x) => x.test === t.key).length;
      const row = el('div', { className: 'caltest' }, el('div', {}, el('b', { textContent: t.name_ar }), el('small', { className: 'block sub', textContent: done ? `قيس ${done} مرة` : 'لم يُقس' })));
      const b1 = el('button', { type: 'button', className: 'btn', textContent: 'تنزيل STL' }); b1.onclick = () => downloadTest(t.key, b1);
      row.append(el('div', { className: 'row' }, b1, PL.canWrite && may('operator') ? actionButton('أدخل القياسات', () => { PL.cal.test = t.key; viewPrint(); }) : ''));
      list.append(row);
      if (PL.cal.test === t.key) list.append(measureForm(pr, t));
    });
    box.append(list);
    return box;
  }

  function viewPrint() {
    const v = $('v-print'); v.textContent = '';
    if (!may('operator')) { v.append(el('p', { className: 'empty', textContent: 'هذه الصفحة لمشغّلي الطباعة.' })); return; }
    v.append(el('h1', { textContent: 'لوحة الطباعة' }), el('p', { className: 'sub', textContent: 'تُطبع فقط التصاميم المعتمدة. الملف يُعاد بناؤه من النسخة المعتمدة ويُقارن ببصمتها قبل التنزيل، والبدء يحتاج قائمة تحقق وتأكيدًا صريحًا.' }));
    const req = PL.projects.filter((p) => p.status === 'PRINT_REQUESTED').sort((a, b) => a.updatedAt - b.updatedAt);
    v.append(card('طلبات طباعة جديدة', projectTable(req, { owner: true, empty: 'لا طلبات جديدة. افتح الطلب لقبوله واختيار الطابعة.' })));
    const cols = [['QUEUED', 'في الطابور'], ['PRINTING', 'قيد الطباعة'], ['FINISHED', 'منتهية مؤخرًا']];
    const board = el('div', { className: 'board' });
    cols.forEach(([k, name]) => {
      const list = PL.jobs.filter((j) => (k === 'FINISHED' ? ['DONE', 'FAILED', 'CANCELLED'].includes(j.status) : j.status === k)).sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt)).slice(0, k === 'FINISHED' ? 8 : 50);
      board.append(el('section', { className: 'col' }, el('h2', { textContent: `${name} (${list.length})` }), ...(list.length ? list.map(jobCard) : [el('p', { className: 'empty', textContent: 'فارغ' })])));
    });
    v.append(board, printerPanel(), calibrationPanel());
  }

  // ------------------------------------------------------------------ admin
  function stat(label, value, note) { return el('div', { className: 'stat' }, el('span', { textContent: label }), el('b', { textContent: value }), note ? el('small', { textContent: note }) : ''); }
  function viewAdmin() {
    const v = $('v-admin'); v.textContent = '';
    if (role() !== 'admin') { v.append(el('p', { className: 'empty', textContent: 'هذه الصفحة للمدير.' })); return; }
    v.append(el('h1', { textContent: 'الإدارة' }));
    const P = PL.projects, J = PL.jobs;
    const withChecks = P.filter((p) => p.summary && p.summary.checks.total);
    const okChecks = withChecks.filter((p) => p.summary.checks.pass === p.summary.checks.total).length;
    const done = J.filter((j) => j.status === 'DONE'), failed = J.filter((j) => j.status === 'FAILED');
    const grams = done.reduce((s, j) => s + (j.actual_g ?? (j.estimate ? j.estimate.mass_g * j.qty : 0)), 0);
    v.append(el('div', { className: 'stats' },
      stat('المشاريع', String(P.length), `${P.filter((p) => p.status === 'IN_REVIEW').length} بانتظار المراجعة`),
      stat('مطابقة المقاسات', withChecks.length ? Math.round((100 * okChecks) / withChecks.length) + '%' : '—', `${okChecks} من ${withChecks.length} مشروعًا كل فحوصها ناجحة`),
      stat('مهام الطباعة', String(J.length), `${J.filter((j) => j.status === 'PRINTING').length} تطبع الآن`),
      stat('نجاح الطباعة', done.length + failed.length ? Math.round((100 * done.length) / (done.length + failed.length)) + '%' : '—', `${done.length} ناجحة · ${failed.length} فاشلة`),
      stat('مادة مستهلكة', grams ? grams.toFixed(0) + ' غ' : '—', 'الوزن الفعلي إن سُجّل، وإلا التقدير')));

    // people and roles
    const ids = [...new Set([...PL.people.map((x) => x.id), ...Object.keys(PL.roles), ...P.map((p) => p.ownerId)].filter(Boolean))];
    refreshNames(ids);
    const tb = el('tbody');
    ids.forEach((id) => {
      const sel = el('select', { id: 'role_' + id, disabled: !PL.canWrite || (PL.me && id === PL.me.id && PL.me.isOwner) });
      ['customer', 'designer', 'operator', 'admin'].forEach((r) => sel.append(el('option', { value: r, textContent: ROLE_AR[r] })));
      sel.value = PL.me && id === PL.me.id && PL.admin ? 'admin' : PL.roles[id] || 'customer';
      sel.onchange = async () => {
        await saveAccount(id, { role: sel.value }, 'role_changed', ROLE_AR[sel.value]).then(() => toast('تغيّر الدور.')).catch(dbFail);
      };
      const person = PL.people.find((x) => x.id === id);
      tb.append(el('tr', {}, el('td', { textContent: nameOf(id) }), el('td', {}, sel), el('td', { textContent: String(P.filter((p) => p.ownerId === id).length) }), el('td', { textContent: person ? fmtAgo(person.firstSeen) : '—' })));
    });
    v.append(card('الأشخاص والأدوار', el('p', { className: 'sub', textContent: 'يظهر هنا كل من فتح المنصة. شارك المنصة معهم من زر المشاركة بصلاحية «مساهم» حتى يستطيعوا الحفظ، ثم اختر دور كل شخص.' }),
      el('div', { className: 'tblwrap' }, el('table', { className: 'tbl' }, el('thead', {}, el('tr', {}, ...['الشخص', 'الدور', 'مشاريعه', 'أول دخول'].map((h) => el('th', { textContent: h })))), tb))));

    // prices
    const pf = el('form', { className: 'prices' });
    MATERIALS.forEach((m) => pf.append(el('label', { className: 'price', htmlFor: 'price_' + m }, m, el('input', { type: 'number', id: 'price_' + m, min: 0, step: 500, value: priceOf(m) }))));
    pf.append(el('button', { type: 'submit', className: 'btn', textContent: 'احفظ الأسعار', disabled: !PL.canWrite }));
    pf.onsubmit = async (e) => {
      e.preventDefault();
      const prices = {}; MATERIALS.forEach((m) => { const x = parseFloat($('price_' + m).value); if (x >= 0) prices[m] = x; });
      await write('settings/main', () => PL.db.doc('settings/main').set({ ...(PL.settings || {}), prices, updatedAt: Date.now(), by: PL.me.id })).then(() => toast('حُفظت الأسعار.')).catch(dbFail);
    };
    v.append(card('أسعار المواد (دينار للكيلو)', pf));
    const cf = el('form', { className: 'formgrid' });
    const wn = el('input', { type: 'tel', id: 'setWa', value: contactNumber(), dir: 'ltr' }), hr = el('input', { type: 'number', id: 'setHourly', min: 0, step: 250, value: Number(PL.settings.hourly) || 1000 }), su = el('input', { type: 'number', id: 'setSetup', min: 0, step: 250, value: Number(PL.settings.setup) || 2000 });
    cf.append(el('label', { htmlFor: 'setWa', textContent: 'رقم واتساب المنصة (يظهر للزبائن كرابط محادثة)' }), wn, el('label', { htmlFor: 'setHourly', textContent: 'أجرة ساعة الطابعة (د.ع)' }), hr, el('label', { htmlFor: 'setSetup', textContent: 'أجرة تجهيز الطلب (د.ع)' }), su, el('div', { className: 'row' }, el('button', { type: 'submit', className: 'btn', textContent: 'احفظ', disabled: !PL.canWrite })));
    cf.onsubmit = async (e) => {
      e.preventDefault();
      const n = FormaCommerce.normalizeMobile(wn.value);
      if (!n) { toast('رقم الموبايل غير صالح (مثال: 07822678298)', true); return; }
      await write('settings/main', () => PL.db.doc('settings/main').set({ ...(PL.settings || {}), whatsapp: n, hourly: Math.max(0, parseInt(hr.value, 10) || 0), setup: Math.max(0, parseInt(su.value, 10) || 0), updatedAt: Date.now(), by: PL.me.id })).then(() => toast('حُفظت الإعدادات.')).catch(dbFail);
    };
    v.append(card('التواصل والتسعير', cf));

    // activity
    const evs = [];
    P.forEach((p) => (p.events || []).forEach((e) => evs.push({ ...e, title: p.title, pid: p.id })));
    evs.sort((a, b) => b.at - a.at);
    refreshNames(evs.slice(0, 30).map((e) => e.by));
    v.append(card('آخر النشاطات', evs.length ? el('ol', { className: 'activity' }, ...evs.slice(0, 30).map((e) => el('li', {}, el('b', { textContent: nameOf(e.by) }), ' ' + (EVENT_AR[e.type] || e.type) + ' — ', el('a', { href: '#project-' + e.pid, textContent: e.title || 'مشروع' }), e.note ? ' · ' : '', e.note ? el('bdi', { textContent: e.note }) : '', el('time', { textContent: fmtAgo(e.at) })))) : el('p', { className: 'empty', textContent: 'لا نشاط بعد.' })));
    v.append(siteEditor());
    if (LOCAL) v.append(localAdminCard());
    v.append(el('p', { className: 'sub', textContent: LOCAL ? 'ملاحظة أمان: هذه النسخة تعمل على جهاز واحد. الحسابات ورموز PIN تمنع الخلط بين المستخدمين على الجهاز، لكنها ليست حماية قوية: من يملك الجهاز يملك البيانات. احفظ نسخة احتياطية بانتظام.' : 'ملاحظة أمان: في هذه النسخة على الإنترنت تُطبّق الأدوار في واجهة المنصة، والأدوار والأسعار لا يغيّرها إلا مالك المنصة ومحرّروها. كل من يملك صلاحية المساهمة يستطيع قراءة المشاريع. نسخة السيرفر الكاملة (Next.js) تفرض الصلاحيات على الخادم لكل طلب.' }));
  }

  // ================================================================== CMG × FORMA·3D — WELCOME, BRAND, WEBSITE CONTENT
  // The welcome page is built from the administrator's published content (FormaSite: plain text only, https links,
  // validated colours and fonts). The CMG mark below is a typographic placeholder, not the official logo.
  const siteNow = (preview) => FormaSite.sanitizeSite((preview && PL.siteDraft && PL.siteDraft.site) || (PL.site && PL.site.site) || FormaSite.DEFAULT_SITE).site;
  const welcomeLang = (site) => { try { return localStorage.getItem('cmg_lang') || site.default_language; } catch (e) { return site.default_language; } };
  function applyBrand() {
    const site = siteNow(false);
    document.documentElement.style.setProperty('--brand', site.accent);
    document.documentElement.style.setProperty('--brand-font', `"${site.font}", var(--sans, system-ui)`);
  }
  const SVGNS = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs, ...kids) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v); kids.forEach((k) => e.append(k)); return e; };
  /** CMG typographic mark (placeholder until the official logo file is supplied). */
  function cmgMark(size = 34) {
    const t = svg('text', { x: '50', y: '29', 'text-anchor': 'middle', 'font-size': '26', 'font-weight': '700', 'letter-spacing': '6', fill: 'currentColor', 'font-family': 'var(--display, system-ui)' }); t.textContent = 'CMG';
    return svg('svg', { viewBox: '0 0 100 40', width: String(size * 2.5), height: String(size), role: 'img', 'aria-label': 'CMG', class: 'cmgmark' },
      svg('path', { d: 'M4 36 H96', stroke: 'var(--brand, #c2410c)', 'stroke-width': '1.5' }), svg('path', { d: 'M4 33 V39 M96 33 V39 M50 35 V37', stroke: 'currentColor', 'stroke-width': '1', opacity: '.55' }), t);
  }
  let spin = null;
  function stopWelcomeSpin() { if (spin) { cancelAnimationFrame(spin.raf); spin.viewer && spin.viewer.dispose(); spin = null; } }
  const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };

  function renderWelcome(o = {}) {
    stopWelcomeSpin();
    showView('welcome');
    const v = $('v-welcome'); v.textContent = '';
    const site = siteNow(o.preview), lang = welcomeLang(site), ar = lang === 'ar', T = (k) => site[k + (ar ? '_ar' : '_en')];
    v.setAttribute('lang', lang); v.setAttribute('dir', ar ? 'rtl' : 'ltr');
    document.title = site.seo_title;
    let md = document.querySelector('meta[name="description"]'); if (!md) { md = el('meta', { name: 'description' }); document.head.append(md); } md.setAttribute('content', site.seo_description);
    const enter = () => { if (o.entry === 'login') { try { history.replaceState(null, '', '#login'); } catch (e) { /* sandboxed */ } renderLogin(); } else navigate(PL.ready ? '#new' : '#home'); };
    const toggle = el('button', { type: 'button', className: 'wl-lang', textContent: ar ? 'English' : 'العربية', 'aria-label': ar ? 'Switch to English' : 'التبديل إلى العربية', onclick: () => { try { localStorage.setItem('cmg_lang', ar ? 'en' : 'ar'); } catch (e) { /* ignore */ } renderWelcome(o); } });
    if (o.preview) v.append(el('div', { className: 'wl-preview', role: 'status' }, 'معاينة المسودة — لم تُنشر بعد. ', el('a', { href: '#admin', textContent: 'عُد إلى المحرر' })));
    if (T('announcement')) v.append(el('div', { className: 'wl-announce', role: 'note', textContent: T('announcement') }));
    const head = el('header', { className: 'wl-top' }, el('a', { className: 'wl-brand', href: '#welcome', 'aria-label': 'CMG FORMA·3D' }, cmgMark(26), el('span', { className: 'wl-word', textContent: 'FORMA·3D' })),
      el('nav', { className: 'wl-actions', 'aria-label': ar ? 'الدخول' : 'Account' }, toggle, el('button', { type: 'button', className: 'btn wl-ghost', textContent: ar ? (PL.ready ? 'لوحتي' : 'دخول') : (PL.ready ? 'My workspace' : 'Sign in'), onclick: () => (PL.ready ? navigate('#home') : enter()) })));
    // hero: headline + the part built live in this browser by the FormaCAD kernel
    const stage = el('div', { className: 'wl-stage', role: 'img', 'aria-label': ar ? 'نموذج ثلاثي الأبعاد يُبنى الآن في المتصفح' : 'A 3D model built live in your browser' });
    const caption = el('p', { className: 'wl-caption', textContent: ar ? 'يُبنى النموذج الآن في متصفحك…' : 'Building the model in your browser…' });
    const hero = el('section', { className: 'wl-hero' },
      el('div', { className: 'wl-copy' }, el('p', { className: 'wl-kicker', textContent: ar ? 'CMG · تصميم ذكي · هندسة دقيقة · تصنيع حقيقي' : 'CMG · Intelligent design · Precision engineering · Real manufacturing' }),
        el('h1', { textContent: T('headline') }), el('p', { className: 'wl-sub', textContent: T('sub') }),
        el('div', { className: 'row' }, el('button', { type: 'button', className: 'btn primary wl-cta', textContent: T('cta'), onclick: enter }),
          el('a', { className: 'btn wl-ghost', href: '#wl-how', textContent: ar ? 'كيف تعمل' : 'How it works', onclick: (e) => { e.preventDefault(); $('wl-how').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth' }); } }))),
      el('figure', { className: 'wl-figure' }, stage, caption));
    const steps = ar ? [['01', 'الفكرة', 'تصف ما تحتاجه بكلماتك أو بصورة.'], ['02', 'التصميم الذكي', 'نموذج بارامتري يُبنى ويُقاس آليًا.'], ['03', 'المراجعة الهندسية', 'مصمّم يعتمد الملف وبصمته.'], ['04', 'التصنيع', 'يُطبع الملف المعتمد نفسه ويُسلَّم.']]
      : [['01', 'Idea', 'Describe what you need, in words or with a picture.'], ['02', 'AI design', 'A parametric model is built and measured automatically.'], ['03', 'Engineering review', 'A designer approves the file and its fingerprint.'], ['04', 'Manufacturing', 'The approved file itself is printed and delivered.']];
    const how = el('section', { className: 'wl-how', id: 'wl-how', 'aria-label': ar ? 'كيف تعمل' : 'How it works' }, el('ol', { className: 'wl-steps' }, ...steps.map(([n, t, d]) => el('li', {}, el('span', { className: 'wl-n', textContent: n }), el('b', { textContent: t }), el('p', { textContent: d })))));
    const pillars = el('section', { className: 'wl-pillars' }, ...site.pillars.map((p) => el('article', {}, el('h2', { textContent: p[ar ? 'title_ar' : 'title_en'] }), el('p', { textContent: p[ar ? 'text_ar' : 'text_en'] }))));
    const faq = site.faq.length ? el('section', { className: 'wl-faq' }, el('h2', { textContent: ar ? 'أسئلة شائعة' : 'Questions' }), ...site.faq.map((f) => el('details', {}, el('summary', { textContent: f[ar ? 'q_ar' : 'q_en'] || f.q_ar }), el('p', { textContent: f[ar ? 'a_ar' : 'a_en'] || f.a_ar })))) : '';
    const wa = PL.settings && PL.settings.whatsapp;
    const foot = el('footer', { className: 'wl-foot' }, el('div', { className: 'wl-brand' }, cmgMark(18), el('span', { className: 'wl-word', textContent: 'FORMA·3D' })),
      el('div', { className: 'row' }, ...[site.contact_email ? el('a', { href: 'mailto:' + site.contact_email, textContent: site.contact_email, dir: 'ltr' }) : '', wa ? el('a', { href: 'https://wa.me/' + wa, textContent: 'WhatsApp', rel: 'noopener', target: '_blank' }) : '',
        ...site.links.map((l) => el('a', { href: l.url, textContent: l.label, rel: 'noopener noreferrer', target: '_blank' }))].filter(Boolean)),
      el('small', { textContent: `© ${new Date().getFullYear()} CMG · FORMA·3D` }));
    v.append(el('div', { className: 'wl' }, head, hero, how, pillars, faq, foot));
    // the live model: a ready-made design rebuilt by the kernel (nothing pre-rendered), slowly turning unless reduced motion
    const st = (FormaStarters.STARTERS || []).find((x) => x.key === 'vase') || FormaStarters.STARTERS[0];
    spin = { raf: 0, viewer: null };
    const mine = spin;
    build(st.design, {}).then((r) => {
      if (spin !== mine || !stage.isConnected) return;
      let V; try { V = FormaViewer.create(stage, { bed: [160, 160, 160], lineColor: [0.55, 0.62, 0.7] }); } catch (e) { caption.textContent = ar ? 'العرض ثلاثي الأبعاد غير متاح في هذا المتصفح.' : '3D view is not available in this browser.'; return; }
      mine.viewer = V; V.setBaseColor(getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() || '#c2410c');
      const P = r.positions; let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
      for (let i = 0; i < P.length; i += 3) { lo[0] = Math.min(lo[0], P[i]); hi[0] = Math.max(hi[0], P[i]); lo[1] = Math.min(lo[1], P[i + 1]); hi[1] = Math.max(hi[1], P[i + 1]); }
      V.setMesh(P, [80 - (lo[0] + hi[0]) / 2, 80 - (lo[1] + hi[1]) / 2, 0]); V.fit(r.size_mm);
      caption.textContent = ar ? `«${st.design.name_ar}» — بُني الآن في متصفحك بنواة FormaCAD: ${r.size_mm.x}×${r.size_mm.y}×${r.size_mm.z} مم، ${r.triangles.toLocaleString('en')} مثلث.` : `"${st.design.name_ar}" — built now in your browser by the FormaCAD kernel: ${r.size_mm.x}×${r.size_mm.y}×${r.size_mm.z} mm, ${r.triangles.toLocaleString('en')} triangles.`;
      if (reducedMotion()) return;
      const turn = () => { if (spin !== mine) return; if (!document.hidden) { V.theta += 0.0035; V.redraw(); } mine.raf = requestAnimationFrame(turn); };
      mine.raf = requestAnimationFrame(turn);
    }).catch(() => { caption.textContent = ar ? 'تعذّر بناء النموذج.' : 'The model could not be built.'; });
  }

  // maintenance: everyone but the administrator sees the published message (UI-level, see docs/CMG_PLATFORM.md)
  const maintenanceBlocks = () => { const m = siteNow(false).maintenance; return !!(m && m.on) && role() !== 'admin' && !PL.admin; };
  function renderMaintenance() {
    showView('welcome'); const v = $('v-welcome'); v.textContent = '';
    const site = siteNow(false), ar = welcomeLang(site) === 'ar';
    // on a shared offline device someone else (e.g. the administrator) must still be able to sign in
    const out = LOCAL ? el('button', { type: 'button', className: 'btn wl-ghost', textContent: ar ? 'تبديل المستخدم' : 'Switch user', onclick: () => { FormaLocal.signOut(); location.reload(); } }) : '';
    v.append(el('div', { className: 'wl wl-maint' }, el('div', { className: 'wl-brand' }, cmgMark(30), el('span', { className: 'wl-word', textContent: 'FORMA·3D' })), el('h1', { textContent: ar ? site.maintenance.message_ar : site.maintenance.message_en }), out));
  }

  // ------------------------------------------------------------------ CMS editor (administrator)
  function siteEditor() {
    const box = card('محتوى الموقع والهوية');
    const base = FormaSite.sanitizeSite((PL.siteDraft && PL.siteDraft.site) || (PL.site && PL.site.site) || FormaSite.DEFAULT_SITE).site;
    const f = el('form', { className: 'cms' });
    const fld = (key, label, o = {}) => {
      const id = 'cms_' + key.replace(/\W/g, '_');
      const input = o.area ? el('textarea', { id, dir: o.dir || 'auto' }) : el('input', { type: o.type || 'text', id, dir: o.dir || 'auto' });
      input.value = o.value != null ? o.value : base[key] ?? '';
      input.dataset.key = key; f.append(el('label', { htmlFor: id, textContent: label }), input); return input;
    };
    f.append(el('h3', { textContent: 'الصفحة الترحيبية' }));
    fld('headline_ar', 'العنوان (عربي)'); fld('headline_en', 'العنوان (English)', { dir: 'ltr' });
    fld('sub_ar', 'الوصف (عربي)', { area: true }); fld('sub_en', 'الوصف (English)', { area: true, dir: 'ltr' });
    fld('cta_ar', 'زر البدء (عربي)'); fld('cta_en', 'زر البدء (English)', { dir: 'ltr' });
    fld('announcement_ar', 'إعلان أعلى الصفحة (عربي، اختياري)'); fld('announcement_en', 'Announcement (English, optional)', { dir: 'ltr' });
    f.append(el('h3', { textContent: 'الركائز الثلاث' }));
    const pillarInputs = base.pillars.map((p, k) => ['title_ar', 'text_ar', 'title_en', 'text_en'].map((x) => fld(`p${k}_${x}`, `${k + 1} · ${x.startsWith('title') ? 'العنوان' : 'النص'} (${x.endsWith('ar') ? 'عربي' : 'English'})`, { value: p[x], area: x.startsWith('text'), dir: x.endsWith('en') ? 'ltr' : 'auto' })));
    f.append(el('h3', { textContent: 'الأسئلة الشائعة (سطر لكل سؤال: السؤال | الجواب)' }));
    const faq = fld('faq_ar', 'عربي', { area: true, value: base.faq.map((x) => `${x.q_ar} | ${x.a_ar}`).join('\n') });
    const faqEn = fld('faq_en', 'English (same order)', { area: true, dir: 'ltr', value: base.faq.map((x) => `${x.q_en} | ${x.a_en}`).join('\n') });
    f.append(el('h3', { textContent: 'التواصل وSEO' }));
    fld('contact_email', 'بريد التواصل', { type: 'email', dir: 'ltr' });
    const links = fld('links', 'روابط (سطر لكل رابط: الاسم | https://…)', { area: true, dir: 'ltr', value: base.links.map((l) => `${l.label} | ${l.url}`).join('\n') });
    fld('seo_title', 'عنوان الصفحة (SEO)'); fld('seo_description', 'وصف الصفحة (SEO)', { area: true });
    f.append(el('h3', { textContent: 'الهوية' }));
    const lang = el('select', { id: 'cms_lang' }); [['ar', 'العربية'], ['en', 'English']].forEach(([k, t]) => lang.append(el('option', { value: k, textContent: t }))); lang.value = base.default_language;
    const accent = el('input', { type: 'color', id: 'cms_accent', value: base.accent });
    const font = el('select', { id: 'cms_font' }); FormaSite.FONTS.forEach((x) => font.append(el('option', { value: x, textContent: x }))); font.value = base.font;
    const maint = el('input', { type: 'checkbox', id: 'cms_maint', checked: base.maintenance.on });
    f.append(el('label', { htmlFor: 'cms_lang', textContent: 'لغة الصفحة الافتراضية' }), lang, el('label', { htmlFor: 'cms_accent', textContent: 'اللون المميّز (يجب أن يحقق تباين 4.5:1 مع الأبيض)' }), accent,
      el('label', { htmlFor: 'cms_font', textContent: 'الخط (من القائمة المعتمدة)' }), font, el('label', { className: 'chk-row', htmlFor: 'cms_maint' }, maint, ' وضع الصيانة (يرى الزبائن رسالة الصيانة فقط)'));
    fld('maint_ar', 'رسالة الصيانة (عربي)', { value: base.maintenance.message_ar }); fld('maint_en', 'Maintenance message (English)', { value: base.maintenance.message_en, dir: 'ltr' });
    const errs = el('ul', { className: 'list fail', 'aria-live': 'polite' });
    const collect = () => {
      const val = (k) => (f.querySelector(`[data-key="${k}"]`) || {}).value || '';
      const lines = (t) => t.split('\n').map((x) => x.trim()).filter(Boolean).map((x) => x.split('|').map((y) => y.trim()));
      const fa = lines(val('faq_ar')), fe = lines(val('faq_en'));
      return {
        headline_ar: val('headline_ar'), headline_en: val('headline_en'), sub_ar: val('sub_ar'), sub_en: val('sub_en'), cta_ar: val('cta_ar'), cta_en: val('cta_en'),
        announcement_ar: val('announcement_ar'), announcement_en: val('announcement_en'),
        pillars: pillarInputs.map((g) => ({ title_ar: g[0].value, text_ar: g[1].value, title_en: g[2].value, text_en: g[3].value })),
        faq: fa.map(([q, a], k) => ({ q_ar: q || '', a_ar: a || '', q_en: (fe[k] || [])[0] || '', a_en: (fe[k] || [])[1] || '' })),
        contact_email: val('contact_email'), links: lines(val('links')).map(([label, url]) => ({ label, url: url || label })),
        seo_title: val('seo_title'), seo_description: val('seo_description'), default_language: lang.value, accent: accent.value, font: font.value,
        maintenance: { on: maint.checked, message_ar: val('maint_ar'), message_en: val('maint_en') },
      };
    };
    const check = () => { const r = FormaSite.sanitizeSite(collect()); errs.textContent = ''; r.errors.forEach((x) => errs.append(el('li', { textContent: x }))); return r; };
    const saveDraft = async () => { const r = check(); if (!r.ok) { toast('صحّح الحقول المعلَّمة أولًا.', true); return null; } await write('settings/site_draft', () => PL.db.doc('settings/site_draft').set({ site: r.site, at: Date.now(), by: PL.me.id })).catch(dbFail); PL.siteDraft = { site: r.site }; return r; };
    const row = el('div', { className: 'row' },
      actionButton('احفظ المسودة', async () => { if (await saveDraft()) toast('حُفظت المسودة.'); }),
      actionButton('معاينة', async () => { if (await saveDraft()) navigate('#welcome-preview'); }),
      actionButton('انشر', async () => {
        const r = await saveDraft(); if (!r) return;
        const hist = FormaSite.publish(PL.siteHistory, r.site, PL.me.id, Date.now());
        await write('settings/site_history', () => PL.db.doc('settings/site_history').set(hist)).catch(dbFail);
        await write('settings/site', () => PL.db.doc('settings/site').set({ site: r.site, revision: hist.current, at: Date.now(), by: PL.me.id })).catch(dbFail);
        PL.siteHistory = hist; PL.site = { site: r.site, revision: hist.current }; applyBrand();
        toast(`نُشرت النسخة ${hist.current}.`); viewAdmin(); renderNav();
      }, true));
    f.onsubmit = (e) => e.preventDefault();
    box.append(el('p', { className: 'sub', textContent: 'نص فقط: لا يُقبل HTML ولا سكربت، والروابط https فقط. المسودة لا يراها أحد حتى تُنشر. علامة CMG المعروضة نصية مؤقتة إلى أن يُرفع ملف الشعار الرسمي.' }), f, errs, row);
    const revs = ((PL.siteHistory && PL.siteHistory.revisions) || []).slice().reverse();
    if (revs.length) {
      refreshNames(revs.map((r) => r.by));
      box.append(el('details', { className: 'timeline' }, el('summary', { textContent: `النسخ المنشورة (${revs.length}) — الحالية ${PL.site && PL.site.revision}` }),
        el('ol', {}, ...revs.map((r) => el('li', {}, el('b', { textContent: `النسخة ${r.n}` }), ` — ${nameOf(r.by)} — ${fmtDate(r.at)} `, r.n === (PL.site && PL.site.revision) ? el('span', { className: 'pill ok', textContent: 'منشورة' }) :
          el('button', { type: 'button', className: 'linkbtn', textContent: 'استعدها كمسودة', onclick: async () => { const site = FormaSite.revisionOf(PL.siteHistory, r.n); await write('settings/site_draft', () => PL.db.doc('settings/site_draft').set({ site, at: Date.now(), by: PL.me.id, from: r.n })).catch(dbFail); PL.siteDraft = { site }; toast(`النسخة ${r.n} في المسودة؛ راجعها ثم انشر.`); viewAdmin(); } }))))));
    }
    return box;
  }

  // ================================================================== CUSTOMER INTELLIGENCE & PROJECT ARCHIVE
  // Everything below reads the stored records (projects + their logs, jobs, invoices, printers, people, accounts)
  // through FormaArchive; no figure is invented. Account fields that only the administrator may change (status,
  // contact details, notes) live in the admin-only roles/<id> record, never in the person's own record.
  const archiveData = () => ({ projects: PL.projects, jobs: PL.jobs, printers: PL.printers, people: PL.people, roles: PL.roles, names: PL.names, customers: PL.accounts });
  const ACCOUNT_AR = { ACTIVE: ['نشط', 'ok'], SUSPENDED: ['موقوف', 'bad'], ARCHIVED: ['مؤرشف', 'muted'] };
  const BUCKET_TONE = { completed: 'ok', in_progress: 'info', pending_review: 'info', awaiting_customer: 'warn', awaiting_payment: 'warn', manufacturing: 'hot', ready_delivery: 'ok', rejected: 'bad', archived: 'muted' };
  const fmtIqdShort = (n) => Number(n || 0).toLocaleString('en') + ' د.ع';
  /** Merge a change into the admin-only account record and keep an audit trail on it (latest 100 entries). */
  async function saveAccount(id, patch, action, note) {
    const cur = { ...(PL.accounts[id] || {}) }; delete cur.id;
    const body = { ...cur, ...patch, audit: [...(cur.audit || []), { at: Date.now(), by: PL.me.id, action, note: note || '' }].slice(-100) };
    await write('roles/' + id, () => PL.db.doc('roles/' + id).set(body));
    PL.accounts[id] = { ...body, id };
    return body;
  }
  function downloadText(name, text, type) {
    if (!S.downloads) { toast('التنزيل غير متاح في هذا العرض.', true); return Promise.resolve(); }
    return S.downloads.save({ filename: name, data: new TextEncoder().encode('﻿' + text), type }).then(() => toast('حُفظ ' + name)).catch((e) => { if (!(e && e.code === 'declined')) toast('تعذّر التنزيل.', true); });
  }
  const pageHead = (title, sub, ...actions) => el('div', { className: 'pagehead' }, el('div', {}, el('h1', { textContent: title }), sub ? el('p', { className: 'sub', textContent: sub }) : ''), actions.length ? el('div', { className: 'row' }, ...actions) : '');

  // ------------------------------------------------------------------ CMG Executive Control Center
  function viewControl() {
    const v = $('v-control'); v.textContent = '';
    if (role() !== 'admin') { v.append(el('p', { className: 'empty', textContent: 'هذه الصفحة للمدير.' })); return; }
    const d = archiveData(), c = FormaArchive.controlCenter(d);
    v.append(pageHead('مركز التحكم التنفيذي', 'كل رقم هنا محسوب من سجلات المنصة نفسها لحظة فتح الصفحة؛ ما لم يُسجَّل بعد يظهر «—».'));
    const pct = (x) => (x == null ? '—' : Math.round(x * 100) + '%');
    v.append(el('div', { className: 'stats' },
      stat('الزبائن', String(c.customers), `${c.newCustomers7d} جديد خلال 7 أيام`),
      stat('المشاريع', String(c.projects), `${c.activeProjects} نشطة · ${c.completedProjects} مكتملة`),
      stat('بانتظار المراجعة', String(c.pendingReviews), 'تصاميم تنتظر المصمّم'),
      stat('الإيراد المحصَّل', fmtIqdShort(c.revenueIqd), `غير مدفوع: ${fmtIqdShort(c.unpaidIqd)}`),
      stat('طلبات الطباعة', String(c.orders), `${c.printsDone} ناجحة · ${c.printsFailed} فاشلة`),
      stat('نجاح الطباعة', pct(c.printSuccess), 'من المهام المنتهية'),
      stat('الطابعات', `${c.printersActive} / ${c.printers}`, 'تطبع الآن / المسجّلة')));
    // pipeline: where every project stands
    const max = Math.max(1, ...Object.values(c.buckets));
    const pipe = el('ol', { className: 'bpipe', 'aria-label': 'توزيع المشاريع حسب المرحلة' });
    FormaArchive.BUCKETS.forEach((b) => pipe.append(el('li', {}, el('span', { className: 'pl-name', textContent: FormaArchive.BUCKET_AR[b] }),
      el('span', { className: 'pl-bar' }, el('i', { className: 'tone-' + BUCKET_TONE[b], style: `inline-size:${(100 * c.buckets[b]) / max}%` })), el('b', { className: 'num', textContent: String(c.buckets[b]) }))));
    v.append(card('مسار المشاريع', pipe));
    // activity center
    const evs = [];
    d.projects.forEach((p) => (p.events || []).forEach((e) => evs.push({ ...e, title: p.title, pid: p.id, owner: p.ownerId })));
    evs.sort((a, b) => b.at - a.at);
    const kinds = { all: 'كل الأحداث', created: 'مشروع جديد', approved: 'اعتماد', paid: 'دفع', started: 'بدء طباعة', failed: 'فشل طباعة', done: 'اكتمال' };
    const fsel = el('select', { 'aria-label': 'نوع الحدث' }); Object.entries(kinds).forEach(([k, t]) => fsel.append(el('option', { value: k, textContent: t })));
    const list = el('ol', { className: 'activity' });
    const fill = () => {
      list.textContent = '';
      const rows = evs.filter((e) => fsel.value === 'all' || e.type === fsel.value).slice(0, 40);
      refreshNames(rows.map((e) => e.by));
      if (!rows.length) list.append(el('li', { className: 'sub', textContent: 'لا أحداث من هذا النوع بعد.' }));
      rows.forEach((e) => list.append(el('li', {}, el('b', { textContent: nameOf(e.by) }), ' ' + (EVENT_AR[e.type] || e.type) + ' — ', el('a', { href: '#archive-' + e.pid, textContent: e.title || e.pid }), e.note ? ' · ' : '', e.note ? el('bdi', { textContent: e.note }) : '', el('time', { textContent: fmtAgo(e.at) }))));
    };
    fsel.onchange = fill; fill();
    v.append(card('مركز النشاط', el('div', { className: 'row' }, fsel), list));
    // reports (CSV)
    const stamp = new Date().toISOString().slice(0, 10);
    const dir = FormaArchive.customerDirectory(d);
    const reports = el('div', { className: 'row' },
      el('button', { type: 'button', className: 'btn', textContent: 'نشاط الزبائن (CSV)', onclick: () => downloadText(`cmg-customers-${stamp}.csv`, FormaArchive.toCSV(dir, [{ key: 'id', label: 'customer_id' }, { label: 'name', get: (r) => nameOf(r.id) }, { key: 'email', label: 'email' }, { key: 'status', label: 'status' }, { label: 'registered', get: (r) => r.registeredAt && new Date(r.registeredAt).toISOString() }, { label: 'last_activity', get: (r) => r.lastActivity && new Date(r.lastActivity).toISOString() }, { key: 'projects', label: 'projects' }, { key: 'completed', label: 'completed' }, { key: 'active', label: 'active' }, { key: 'pending', label: 'pending_review' }, { key: 'orders', label: 'orders' }, { key: 'spentIqd', label: 'spent_iqd' }]), 'text/csv') }),
      el('button', { type: 'button', className: 'btn', textContent: 'المشاريع (CSV)', onclick: () => downloadText(`cmg-projects-${stamp}.csv`, FormaArchive.toCSV(d.projects, [{ key: 'id', label: 'project_id' }, { key: 'title', label: 'title' }, { key: 'ownerId', label: 'customer_id' }, { key: 'status', label: 'status' }, { label: 'bucket', get: (p) => FormaArchive.bucketOf(p) }, { label: 'kind', get: (p) => p.kind || 'part' }, { key: 'revision', label: 'revision' }, { key: 'approvedRevision', label: 'approved_revision' }, { label: 'created', get: (p) => p.createdAt && new Date(p.createdAt).toISOString() }, { label: 'updated', get: (p) => p.updatedAt && new Date(p.updatedAt).toISOString() }]), 'text/csv') }),
      el('button', { type: 'button', className: 'btn', textContent: 'الإيرادات والفواتير (CSV)', onclick: () => downloadText(`cmg-revenue-${stamp}.csv`, FormaArchive.toCSV(d.projects.filter((p) => p.invoice), [{ label: 'invoice', get: (p) => p.invoice.number }, { key: 'id', label: 'project_id' }, { key: 'ownerId', label: 'customer_id' }, { label: 'status', get: (p) => p.invoice.status }, { label: 'total_iqd', get: (p) => p.invoice.totalIqd }, { label: 'issued', get: (p) => p.invoice.issuedAt && new Date(p.invoice.issuedAt).toISOString() }, { label: 'paid', get: (p) => p.invoice.paidAt && new Date(p.invoice.paidAt).toISOString() }, { label: 'payments', get: (p) => (p.invoice.payments || []).map((x) => `${x.method}:${x.reference}:${x.amountIqd}`).join(' | ') }]), 'text/csv') }),
      el('button', { type: 'button', className: 'btn', textContent: 'التصنيع (CSV)', onclick: () => downloadText(`cmg-manufacturing-${stamp}.csv`, FormaArchive.toCSV(d.jobs, [{ key: 'id', label: 'job_id' }, { key: 'projectId', label: 'project_id' }, { key: 'status', label: 'status' }, { label: 'printer', get: (j) => (PL.printers.find((x) => x.id === j.printerId) || {}).name }, { key: 'material', label: 'material' }, { key: 'qty', label: 'qty' }, { label: 'estimate_g', get: (j) => j.estimate && j.estimate.mass_g }, { key: 'actual_g', label: 'actual_g' }, { key: 'approvedSha', label: 'approved_sha256' }, { label: 'created', get: (j) => j.createdAt && new Date(j.createdAt).toISOString() }]), 'text/csv') }));
    v.append(card('التقارير', el('p', { className: 'sub', textContent: 'ملفات CSV تُفتح في Excel؛ الخلايا التي تبدأ بـ = أو + أو - أو @ تُحفظ كنص (حماية من تنفيذ الصيغ).' }), reports));
  }

  // ------------------------------------------------------------------ customer directory
  function viewCustomers() {
    if (PL.route === 'customer') return viewCustomer(PL.customerId);
    if (PL.route === 'archive') return viewArchive(PL.archiveId);
    const v = $('v-customers'); v.textContent = '';
    if (role() !== 'admin') { v.append(el('p', { className: 'empty', textContent: 'هذه الصفحة للمدير.' })); return; }
    const all = FormaArchive.customerDirectory(archiveData());
    refreshNames(all.map((r) => r.id));
    all.forEach((r) => { if (!r.name) r.name = PL.names[r.id] || ''; });
    v.append(pageHead('ذكاء الزبائن وأرشيف المشاريع', `${all.length} زبونًا. كل ملف يجمع مشاريع الزبون وسجلّها الكامل من قاعدة البيانات.`));
    const F = PL.dir;
    const q = el('input', { type: 'search', id: 'dirQ', placeholder: 'ابحث بالاسم أو البريد أو الهاتف أو المعرّف', value: F.q, 'aria-label': 'بحث في الزبائن' });
    const st = el('select', { id: 'dirStatus', 'aria-label': 'حالة الحساب' }); [['', 'كل الحالات'], ...Object.entries(ACCOUNT_AR).map(([k, x]) => [k, x[0]])].forEach(([k, t]) => st.append(el('option', { value: k, textContent: t }))); st.value = F.status;
    const so = el('select', { id: 'dirSort', 'aria-label': 'الترتيب' }); [['lastActivity', 'آخر نشاط'], ['registeredAt', 'تاريخ التسجيل'], ['projects', 'عدد المشاريع'], ['spentIqd', 'الإنفاق'], ['name', 'الاسم']].forEach(([k, t]) => so.append(el('option', { value: k, textContent: 'ترتيب: ' + t }))); so.value = F.sort;
    const list = el('div', { className: 'custgrid', role: 'list' }), pager = el('div', { className: 'row pager' });
    const PER = 12;
    const draw = () => {
      const rows = FormaArchive.filterDirectory(all, { q: F.q, status: F.status, sort: F.sort, dir: F.sort === 'name' ? 'asc' : 'desc' });
      const pages = Math.max(1, Math.ceil(rows.length / PER)); F.page = Math.min(F.page, pages - 1);
      list.textContent = ''; pager.textContent = '';
      if (!rows.length) list.append(el('p', { className: 'empty', textContent: all.length ? 'لا زبون يطابق البحث.' : 'لا زبائن بعد. يظهر هنا كل من ينشئ مشروعًا على المنصة.' }));
      rows.slice(F.page * PER, F.page * PER + PER).forEach((r) => {
        const a = el('a', { className: 'custcard', href: '#customer-' + r.id, role: 'listitem' },
          el('div', { className: 'cc-head' }, el('span', { className: 'avatar', 'aria-hidden': 'true', textContent: (nameOf(r.id) || '؟').trim().slice(0, 1) }),
            el('div', {}, el('b', { textContent: nameOf(r.id) }), el('small', { className: 'block sub num', textContent: r.id })), pill(ACCOUNT_AR, r.status)),
          el('dl', { className: 'cc-stats' }, ...[['المشاريع', r.projects], ['مكتملة', r.completed], ['نشطة', r.active], ['للمراجعة', r.pending], ['الطلبات', r.orders], ['الإنفاق', fmtIqdShort(r.spentIqd)]].flatMap(([k, x]) => [el('dt', { textContent: k }), el('dd', { className: 'num', textContent: String(x) })])),
          el('small', { className: 'sub', textContent: `سجّل ${r.registeredAt ? fmtDate(r.registeredAt) : '—'} · آخر نشاط ${r.lastActivity ? fmtAgo(r.lastActivity) : '—'}` }));
        list.append(a);
      });
      if (pages > 1) {
        pager.append(el('button', { type: 'button', className: 'btn small', textContent: 'السابق', disabled: F.page === 0, onclick: () => { F.page--; draw(); } }),
          el('span', { className: 'sub', textContent: `صفحة ${F.page + 1} من ${pages}` }),
          el('button', { type: 'button', className: 'btn small', textContent: 'التالي', disabled: F.page >= pages - 1, onclick: () => { F.page++; draw(); } }));
      }
    };
    q.oninput = () => { F.q = q.value; F.page = 0; draw(); };
    st.onchange = () => { F.status = st.value; F.page = 0; draw(); };
    so.onchange = () => { F.sort = so.value; draw(); };
    const exp = el('button', { type: 'button', className: 'btn', textContent: 'تصدير القائمة (CSV)', onclick: () => downloadText(`cmg-customers-${new Date().toISOString().slice(0, 10)}.csv`, FormaArchive.toCSV(FormaArchive.filterDirectory(all, F), [{ key: 'id', label: 'customer_id' }, { label: 'name', get: (r) => nameOf(r.id) }, { key: 'email', label: 'email' }, { key: 'phone', label: 'phone' }, { key: 'status', label: 'status' }, { key: 'projects', label: 'projects' }, { key: 'completed', label: 'completed' }, { key: 'orders', label: 'orders' }, { key: 'spentIqd', label: 'spent_iqd' }]), 'text/csv') });
    v.append(el('div', { className: 'filters' }, q, st, so, exp), list, pager);
    draw();
  }

  // ------------------------------------------------------------------ one customer
  function viewCustomer(id) {
    const v = $('v-customers'); v.textContent = '';
    if (role() !== 'admin') { v.append(el('p', { className: 'empty', textContent: 'هذه الصفحة للمدير.' })); return; }
    const pr = FormaArchive.customerProfile(archiveData(), id);
    if (!pr) { v.append(el('p', { className: 'empty' }, 'لا يوجد زبون بهذا المعرّف. ', el('a', { href: '#customers', textContent: 'عُد إلى الأرشيف' }))); return; }
    const acc = PL.accounts[id] || {};
    refreshNames([id, ...pr.notes.map((n) => n.by), ...(acc.audit || []).map((a) => a.by)]);
    v.append(el('nav', { className: 'crumbs', 'aria-label': 'المسار' }, el('a', { href: '#customers', textContent: 'أرشيف الزبائن' }), ' / ', el('span', { textContent: nameOf(id) })));
    const head = el('section', { className: 'panel custhead' },
      el('span', { className: 'avatar big', 'aria-hidden': 'true', textContent: (nameOf(id) || '؟').trim().slice(0, 1) }),
      el('div', {}, el('h1', { textContent: nameOf(id) }), el('p', { className: 'sub num', textContent: `معرّف الزبون: ${id}` }),
        el('p', { className: 'sub' }, pill(ACCOUNT_AR, pr.status), ` · سجّل ${pr.registeredAt ? fmtDate(pr.registeredAt) : '—'} · آخر نشاط ${pr.lastActivity ? fmtAgo(pr.lastActivity) : '—'}`),
        el('p', { className: 'sub', dir: 'auto', textContent: [pr.email, pr.phone].filter(Boolean).join(' · ') || 'لا بيانات تواصل مسجّلة لدى الإدارة' })));
    v.append(head, el('div', { className: 'stats' }, stat('المشاريع', String(pr.projects), `${pr.completed} مكتملة`), stat('نشطة', String(pr.active), `${pr.pending} للمراجعة`), stat('طلبات الطباعة', String(pr.orders), ''), stat('الإنفاق المدفوع', fmtIqdShort(pr.spentIqd), 'فواتير مدفوعة فقط')));
    // project archive by bucket
    const arch = el('section', { className: 'panel' }, el('h2', { textContent: 'أرشيف المشاريع' }));
    let any = false;
    FormaArchive.BUCKETS.forEach((b) => {
      const ps = pr.groups[b]; if (!ps.length) return; any = true;
      const grid = el('div', { className: 'projgrid' });
      ps.forEach((p) => grid.append(projectCard(p)));
      arch.append(el('h3', {}, el('span', { className: 'pill ' + BUCKET_TONE[b], textContent: FormaArchive.BUCKET_AR[b] }), ' ', el('span', { className: 'sub', textContent: String(ps.length) })), grid);
    });
    if (!any) arch.append(el('p', { className: 'empty', textContent: 'لا مشاريع لهذا الزبون بعد.' }));
    v.append(arch);
    // account actions (admin only, audited)
    const acts = el('section', { className: 'panel' }, el('h2', { textContent: 'إدارة الحساب' }));
    const nm = el('input', { type: 'text', id: 'accName', value: acc.name || '', placeholder: nameOf(id) }), em = el('input', { type: 'email', id: 'accEmail', dir: 'ltr', value: acc.email || '' }), ph = el('input', { type: 'tel', id: 'accPhone', dir: 'ltr', value: acc.phone || '' });
    const info = el('form', { className: 'formgrid' }, el('label', { htmlFor: 'accName', textContent: 'الاسم في سجلات الإدارة' }), nm, el('label', { htmlFor: 'accEmail', textContent: 'البريد' }), em, el('label', { htmlFor: 'accPhone', textContent: 'الهاتف' }), ph,
      el('button', { type: 'submit', className: 'btn', textContent: 'احفظ البيانات', disabled: !PL.canWrite }));
    info.onsubmit = async (e) => {
      e.preventDefault();
      if (em.value && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(em.value.trim())) { toast('البريد غير صالح.', true); return; }
      const phone = ph.value.trim() ? FormaCommerce.normalizeMobile(ph.value) : '';
      if (ph.value.trim() && !phone) { toast('رقم الهاتف غير صالح (مثال: 07822678298).', true); return; }
      await saveAccount(id, { name: nm.value.trim().slice(0, 80), email: em.value.trim().slice(0, 120), phone }, 'contact_updated').then(() => { toast('حُفظت البيانات.'); viewCustomer(id); }).catch(dbFail);
    };
    const reason = el('input', { type: 'text', id: 'accReason', placeholder: 'السبب (يُسجَّل)' });
    const statusRow = el('div', { className: 'row' }, reason);
    const setStatus = (to, label) => actionButton(label, async () => {
      if (!reason.value.trim()) { toast('اكتب السبب أولًا.', true); reason.focus(); return; }
      await saveAccount(id, { status: to }, 'status_' + to.toLowerCase(), reason.value.trim()).catch(dbFail); toast('تغيّرت حالة الحساب.'); viewCustomer(id);
    }, to === 'SUSPENDED');
    if (pr.status !== 'SUSPENDED') statusRow.append(setStatus('SUSPENDED', 'أوقف الحساب'));
    if (pr.status !== 'ACTIVE') statusRow.append(setStatus('ACTIVE', 'أعد تفعيل الحساب'));
    if (pr.status !== 'ARCHIVED') statusRow.append(setStatus('ARCHIVED', 'أرشف الحساب'));
    const note = el('textarea', { id: 'accNote', placeholder: 'ملاحظة إدارية (لا يراها الزبون)' }); note.style.minHeight = '60px';
    const noteBtn = actionButton('أضف الملاحظة', async () => {
      const t = note.value.trim(); if (!t) return;
      await saveAccount(id, { notes: [...(acc.notes || []), { at: Date.now(), by: PL.me.id, text: t.slice(0, 2000) }] }, 'note_added').catch(dbFail); viewCustomer(id);
    });
    const exp = el('button', { type: 'button', className: 'btn', textContent: 'تصدير سجل الزبون (JSON)', onclick: () => {
      const ps = PL.projects.filter((p) => p.ownerId === id);
      const rec = { exported_at: new Date().toISOString(), exported_by: PL.me.id, customer: { id, name: nameOf(id), ...pr, groups: undefined }, account: acc,
        projects: ps.map((p) => ({ id: p.id, title: p.title, status: p.status, bucket: FormaArchive.bucketOf(p), idea: p.idea, revision: p.revision, approvedRevision: p.approvedRevision, approvedSha: p.approvedSha, invoice: p.invoice || null, timeline: FormaArchive.timeline(p, PL.jobs) })),
        jobs: PL.jobs.filter((j) => ps.some((p) => p.id === j.projectId)) };
      downloadText(`cmg-customer-${id}.json`, JSON.stringify(rec, null, 2), 'application/json');
    } });
    acts.append(info, el('h3', { textContent: 'حالة الحساب' }), el('p', { className: 'sub', textContent: 'الإيقاف والأرشفة لا يحذفان أي مشروع أو سجل مالي؛ كل تغيير يُسجَّل مع السبب.' }), statusRow,
      el('h3', { textContent: 'ملاحظات الإدارة' }),
      pr.notes.length ? el('ol', { className: 'activity' }, ...pr.notes.slice().reverse().map((n) => el('li', {}, el('b', { textContent: nameOf(n.by) }), ' — ', el('bdi', { textContent: n.text }), el('time', { textContent: fmtDate(n.at) })))) : el('p', { className: 'sub', textContent: 'لا ملاحظات بعد.' }),
      note, el('div', { className: 'row' }, noteBtn, exp));
    if ((acc.audit || []).length) acts.append(el('details', { className: 'timeline' }, el('summary', { textContent: `سجل تغييرات الحساب (${acc.audit.length})` }),
      el('ol', {}, ...acc.audit.slice().reverse().map((a) => el('li', {}, el('b', { textContent: nameOf(a.by) + ' ' + (ACCOUNT_ACTION_AR[a.action] || a.action) }), a.note ? ' — ' : '', a.note ? el('bdi', { textContent: a.note }) : '', el('time', { textContent: fmtDate(a.at) }))))));
    v.append(acts);
  }
  const ACCOUNT_ACTION_AR = { role_changed: 'غيّر الدور إلى', contact_updated: 'حدّث بيانات التواصل', status_suspended: 'أوقف الحساب', status_active: 'أعاد تفعيل الحساب', status_archived: 'أرشف الحساب', note_added: 'أضاف ملاحظة' };

  function projectCard(p) {
    const job = PL.jobs.find((j) => j.id === p.jobId) || PL.jobs.find((j) => j.projectId === p.id);
    const s = p.summary, b = FormaArchive.bucketOf(p);
    refreshNames([p.review && p.review.by]);
    return el('a', { className: 'projcard', href: '#archive-' + p.id },
      el('div', { className: 'pc-thumb', 'aria-hidden': 'true' }, el('span', { textContent: p.kind === 'assembly' ? '⧉' : '◳' }), s && s.size ? el('small', { className: 'num', textContent: `${Math.round(s.size.x)}×${Math.round(s.size.y)}×${Math.round(s.size.z)}` }) : ''),
      el('div', { className: 'pc-body' }, el('b', { textContent: p.title || 'مشروع' }), el('small', { className: 'block sub num', textContent: p.id }),
        el('div', { className: 'row' }, pill(PSTATUS, p.status), el('span', { className: 'pill ' + BUCKET_TONE[b], textContent: FormaArchive.BUCKET_AR[b] })),
        el('small', { className: 'block sub', textContent: [`أُنشئ ${p.createdAt ? fmtDate(p.createdAt) : '—'}`, `آخر تعديل ${fmtAgo(p.updatedAt)}`, p.kind === 'assembly' ? 'تجميعة' : 'قطعة', p.design || p.assembly ? 'المصمّم الذكي / FormaCAD' : '', p.review && p.review.by ? 'المراجع: ' + nameOf(p.review.by) : '', job ? 'التصنيع: ' + (JSTATUS[job.status] || [job.status])[0] : '', p.delivered ? 'سُلّم ' + fmtDate(p.delivered.at) : ''].filter(Boolean).join(' · ') })));
  }

  // ------------------------------------------------------------------ one archived project
  function viewArchive(pid) {
    const v = $('v-customers'); v.textContent = '';
    const p = projectById(pid);
    if (role() !== 'admin' && !(p && (p.ownerId === PL.me.id || isStaff()))) { v.append(el('p', { className: 'empty', textContent: 'لا تملك صلاحية رؤية هذا المشروع.' })); return; }
    if (!p) { v.append(el('p', { className: 'empty', textContent: 'المشروع غير موجود.' })); return; }
    const tl = FormaArchive.timeline(p, PL.jobs), jobs = PL.jobs.filter((j) => j.projectId === p.id);
    refreshNames([p.ownerId, ...tl.map((e) => e.by)]);
    v.append(el('nav', { className: 'crumbs', 'aria-label': 'المسار' }, el('a', { href: '#customers', textContent: 'أرشيف الزبائن' }), ' / ', el('a', { href: '#customer-' + p.ownerId, textContent: nameOf(p.ownerId) }), ' / ', el('span', { textContent: p.title })));
    v.append(pageHead(p.title || 'مشروع', `المشروع ${p.id} · ${p.kind === 'assembly' ? 'تجميعة' : 'قطعة'} · النسخة ${p.revision || 0}${p.approvedRevision ? ' · المعتمدة ' + p.approvedRevision : ''}`,
      el('a', { className: 'btn primary', href: '#project-' + p.id, textContent: 'افتح في الاستوديو (معاينة ثلاثية الأبعاد)' })));
    const facts = [['الحالة', (PSTATUS[p.status] || [p.status])[0]], ['المرحلة', FormaArchive.BUCKET_AR[FormaArchive.bucketOf(p)]], ['الزبون', nameOf(p.ownerId)], ['أُنشئ', p.createdAt ? fmtDate(p.createdAt) : '—'], ['آخر تعديل', fmtDate(p.updatedAt)], ['بصمة الملف المعتمد', p.approvedSha ? p.approvedSha.slice(0, 16) + '…' : '—']];
    v.append(card('ملخص', factRow(facts)));
    const brief = el('div', {});
    brief.append(el('p', { className: 'label', textContent: 'وصف الزبون الأصلي' }), el('p', { dir: 'auto', textContent: p.idea || '—' }));
    if (p.understanding) brief.append(el('p', { className: 'label', textContent: 'فهم المصمّم الذكي' }), el('p', { dir: 'auto', textContent: p.understanding }));
    if ((p.qa || []).length) brief.append(el('p', { className: 'label', textContent: 'أسئلة وأجوبة التوضيح' }), el('ul', { className: 'list' }, ...p.qa.map((x) => el('li', { dir: 'auto', textContent: `${x.question} — ${x.answer}` }))));
    if (p.review && p.review.note) brief.append(el('p', { className: 'label', textContent: 'ملاحظة المراجع' }), el('p', { dir: 'auto', textContent: p.review.note }));
    v.append(card('الطلب والتصميم', brief));
    // timeline
    const ol = el('ol', { className: 'ptimeline' });
    tl.forEach((e) => ol.append(el('li', {}, el('time', { textContent: fmtDate(e.at) }), el('b', { textContent: (EVENT_AR[e.type] || EVENT_AR[e.type.replace(/^job_/, '')] || e.type) }), ' — ', el('span', { textContent: nameOf(e.by) }),
      e.note ? el('bdi', { className: 'block sub', textContent: e.note }) : '', el('small', { className: 'block sub num', textContent: `المصدر: ${e.source.kind} ${e.source.id}${e.source.index != null ? ' #' + e.source.index : ''}` }))));
    v.append(card(`السجل الزمني (${tl.length})`, tl.length ? ol : el('p', { className: 'empty', textContent: 'لا أحداث.' })));
    // money
    if (p.invoice) {
      const inv = p.invoice;
      v.append(card('الفاتورة والمدفوعات', factRow([['الفاتورة', inv.number], ['الحالة', inv.status], ['المجموع', fmtIqdShort(inv.totalIqd)], ['صدرت', inv.issuedAt ? fmtDate(inv.issuedAt) : '—']]),
        (inv.payments || []).length ? el('ul', { className: 'list' }, ...inv.payments.map((x) => el('li', { textContent: `${fmtIqdShort(x.amountIqd)} — ${x.method} — مرجع ${x.reference} — ${fmtDate(x.at)}` }))) : el('p', { className: 'sub', textContent: 'لا دفعات مسجّلة.' }),
        inv.refund ? el('p', { className: 'sub', textContent: `استُرجع ${fmtIqdShort(inv.refund.amountIqd)} — ${inv.refund.reason} — ${fmtDate(inv.refund.at)}` }) : ''));
    }
    // manufacturing
    if (jobs.length) {
      const tb = el('tbody');
      jobs.forEach((j) => tb.append(el('tr', {}, el('td', { className: 'num', textContent: j.id }), el('td', { textContent: (JSTATUS[j.status] || [j.status])[0] }), el('td', { textContent: (PL.printers.find((x) => x.id === j.printerId) || {}).name || '—' }),
        el('td', { textContent: `${j.material} × ${j.qty}` }), el('td', { className: 'num', textContent: (j.approvedSha || '').slice(0, 10) }), el('td', { textContent: j.gcode ? j.gcode.name : '—' }))));
      v.append(card('التصنيع', el('div', { className: 'tblwrap' }, el('table', { className: 'tbl' }, el('thead', {}, el('tr', {}, ...['المهمة', 'الحالة', 'الطابعة', 'المادة', 'بصمة الملف', 'G-code'].map((h) => el('th', { textContent: h })))), tb))));
    }
    if (p.delivered) v.append(card('التسليم', factRow([['سُلّم', fmtDate(p.delivered.at)], ['بواسطة', nameOf(p.delivered.by)], ['ملاحظة', p.delivered.note || '—']])));
    // admin actions: never delete, only flag (and log)
    if (role() === 'admin' && PL.canWrite) {
      const row = el('div', { className: 'row' });
      if (p.status === 'DONE' && !p.delivered) row.append(actionButton('سجّل التسليم للزبون', () => patchProject(p, { delivered: { at: Date.now(), by: PL.me.id, note: '' } }, 'delivered').then(() => viewArchive(pid)), true));
      if (!p.archived) row.append(actionButton('أرشف المشروع', () => patchProject(p, { archived: { at: Date.now(), by: PL.me.id } }, 'archived').then(() => viewArchive(pid))));
      else row.append(actionButton('أخرجه من الأرشيف', () => patchProject(p, { archived: null }, 'unarchived').then(() => viewArchive(pid))));
      v.append(card('إجراءات', el('p', { className: 'sub', textContent: 'لا يُحذف أي مشروع أو سجل مالي؛ الأرشفة علامة تُسجَّل في السجل الزمني ويمكن التراجع عنها.' }), row));
    }
  }

  // ------------------------------------------------------------------ global search (Ctrl/Cmd + K)
  const KIND_AR = { project: 'مشروع', invoice: 'فاتورة', customer: 'زبون', job: 'مهمة طباعة', printer: 'طابعة', designer: 'مصمّم' };
  function openPalette() {
    if (!PL.ready || $('palette')) return;
    const back = el('div', { className: 'palette-back', id: 'palette' });
    const box = el('div', { className: 'palette', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'بحث شامل' });
    const inp = el('input', { type: 'search', id: 'paletteQ', placeholder: 'ابحث عن زبون، مشروع، فاتورة، مهمة، طابعة…', autocomplete: 'off', 'aria-controls': 'paletteList' });
    const ul = el('ul', { id: 'paletteList', role: 'listbox' });
    let items = [], sel = 0;
    const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); if (opener && opener.focus) opener.focus(); };
    const go = (it) => { close(); navigate(it.href); };
    const draw = () => {
      items = FormaArchive.search(inp.value, archiveData(), { id: PL.me.id, role: role() }); sel = Math.min(sel, Math.max(0, items.length - 1));
      ul.textContent = '';
      if (inp.value.trim().length >= 2 && !items.length) ul.append(el('li', { className: 'sub', textContent: 'لا نتائج ضمن ما يسمح به دورك.' }));
      items.forEach((it, i) => { const li = el('li', { role: 'option', id: 'pi' + i, 'aria-selected': String(i === sel) }, el('span', { className: 'pill muted', textContent: KIND_AR[it.kind] }), el('b', { dir: 'auto', textContent: it.label }), el('small', { className: 'sub', dir: 'auto', textContent: it.sub || '' })); li.onclick = () => go(it); ul.append(li); });
      inp.setAttribute('aria-activedescendant', items.length ? 'pi' + sel : '');
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
      else if (e.key === 'Enter' && items[sel]) { e.preventDefault(); go(items[sel]); }
      else if (e.key === 'Tab') { e.preventDefault(); inp.focus(); } // focus stays in the dialog
    };
    const opener = document.activeElement;
    inp.oninput = () => { sel = 0; draw(); };
    back.onclick = (e) => { if (e.target === back) close(); };
    box.append(inp, ul, el('p', { className: 'sub', textContent: '↑↓ للتنقل · Enter للفتح · Esc للإغلاق. النتائج مقيّدة بصلاحيات دورك.' }));
    back.append(box); document.body.append(back);
    document.addEventListener('keydown', onKey, true);
    inp.focus();
  }
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openPalette(); } });

  // ------------------------------------------------------------------ this device (offline file)
  const STORAGE_AR = { indexeddb: 'قاعدة بيانات المتصفح (IndexedDB) على هذا الجهاز', localstorage: 'التخزين المحلي للمتصفح على هذا الجهاز', memory: 'الذاكرة فقط — ستضيع البيانات عند إغلاق الصفحة!' };
  function localAdminCard() {
    const box = card('هذا الجهاز');
    box.append(el('p', { className: FormaLocal.storageMode() === 'memory' ? 'fail' : 'sub', textContent: 'البيانات محفوظة في: ' + STORAGE_AR[FormaLocal.storageMode()] + '. لا تُرسل لأي مكان.' }));
    // backup
    const imp = el('input', { type: 'file', id: 'restoreFile', accept: '.json,application/json' }); imp.hidden = true;
    imp.onchange = async () => {
      const f = imp.files[0]; imp.value = ''; if (!f) return;
      let data;
      try { data = JSON.parse(await f.text()); if (!data || data.format !== 'forma-offline-backup' || typeof data.docs !== 'object') throw new Error('هذا ليس ملف نسخة احتياطية من منصة فورما.'); }
      catch (e) { toast(e.message || 'ملف غير صالح', true); return; }
      const mine = (await FormaLocal.exportAll()).docs;
      const m = FormaVersions.mergeBackup(mine, data.docs);
      const AR = { added: 'أُضيف', updated: 'حُدّث من النسخة الاحتياطية', kept_local: 'بقيت نسخة هذا الجهاز (أحدث)', conflict: 'تعارض', skipped: 'تُجوهل (غير صالح)' };
      const rep = el('div', { className: 'subform', id: 'mergeReport' });
      rep.append(el('b', { textContent: 'معاينة الدمج — لم يتغيّر شيء بعد' }), el('p', { className: 'sub', textContent: Object.entries(m.counts).map(([k, v]) => `${AR[k] || k}: ${v}`).join(' · ') || 'لا فرق بين النسختين.' }));
      const conf = m.report.filter((r) => r.action === 'conflict');
      if (conf.length) rep.append(el('ul', { className: 'list ltr' }, ...conf.map((r) => el('li', { className: 'warnc', textContent: `${r.path}: ${r.reason}${r.copy ? ' → ' + r.copy : ''}` }))));
      rep.append(el('div', { className: 'row' }, actionButton(`ادمج (${Object.keys(m.apply).length} مستند)`, async () => {
        await FormaLocal.importAll({ format: 'forma-offline-backup', docs: m.apply }, false);
        toast('دُمجت النسخة الاحتياطية.' + (conf.length ? ` ${conf.length} تعارض حُفظ كنسخ منفصلة.` : '')); setTimeout(() => location.reload(), 900);
      }, true, !Object.keys(m.apply).length), el('button', { type: 'button', className: 'btn', textContent: 'إلغاء', onclick: () => rep.remove() })));
      imp.closest('section').append(rep);
    };
    box.append(el('div', { className: 'row' },
      actionButton('تنزيل نسخة احتياطية', async () => { const data = await FormaLocal.exportAll(); await S.downloads.save({ filename: `forma-backup-${new Date().toISOString().slice(0, 10)}.json`, data: new Blob([JSON.stringify(data)], { type: 'application/json' }) }); toast('نُزّلت النسخة الاحتياطية (بدون مفاتيح الطابعات).'); }, false),
      el('label', { className: 'btn', htmlFor: 'restoreFile', textContent: 'استعادة من نسخة احتياطية' }), imp));
    // accounts
    const n = el('input', { type: 'text', id: 'naName', placeholder: 'اسم الشخص' }), r = el('select', { id: 'naRole' }), pin = el('input', { type: 'password', id: 'naPin', placeholder: 'PIN اختياري', inputMode: 'numeric', autocomplete: 'off' });
    ['customer', 'designer', 'operator', 'admin'].forEach((x) => r.append(el('option', { value: x, textContent: ROLE_AR[x] })));
    const f = el('form', { className: 'formgrid' }, el('label', { htmlFor: 'naName', textContent: 'إضافة حساب على هذا الجهاز' }), n, r, pin, el('div', { className: 'row' }, el('button', { type: 'submit', className: 'btn', textContent: 'أضف الحساب' })));
    f.onsubmit = async (e) => { e.preventDefault(); if (!n.value.trim()) return; await FormaLocal.createAccount(n.value.trim(), pin.value.trim(), r.value); n.value = pin.value = ''; toast('أُضيف الحساب.'); };
    box.append(f);
    // local AI
    const cfg = FormaLocal.aiConfig() || { url: 'http://localhost:11434', model: 'qwen2.5-coder:14b' };
    const u = el('input', { type: 'text', id: 'aiUrl', value: cfg.url }), m = el('input', { type: 'text', id: 'aiModel', value: cfg.model }); u.dir = m.dir = 'ltr';
    const msg = el('p', { className: 'sub', textContent: FormaLocal.aiConfig() ? `مفعّل: ${cfg.model}` : 'غير مفعّل. بدون إنترنت يحتاج المصمّم الذكي برنامج Ollama على هذا الجهاز أو على الشبكة، مع نموذج يكتب JSON جيدًا (مثل qwen2.5-coder:14b). شغّله مع OLLAMA_ORIGINS=* حتى يقبل الطلبات من هذا الملف.' });
    box.append(el('div', { className: 'formgrid' }, el('label', { htmlFor: 'aiUrl', textContent: 'المصمّم الذكي المحلي (Ollama) — العنوان' }), u, el('label', { htmlFor: 'aiModel', textContent: 'اسم النموذج' }), m, msg,
      el('div', { className: 'row' },
        actionButton('احفظ واختبر', async () => {
          const c = { url: u.value.trim(), model: m.value.trim() };
          msg.textContent = 'يتصل…';
          try { const t = await FormaLocal.testAi(c); if (!t.has) { msg.textContent = `Ollama يعمل لكن النموذج غير موجود. المتاح: ${t.models.join('، ') || 'لا شيء'} — نفّذ: ollama pull ${c.model}`; msg.className = 'fail'; return; } FormaLocal.setAiConfig(c); msg.textContent = 'متصل. يُعاد تحميل الصفحة لتفعيل المصمّم…'; msg.className = 'pass'; setTimeout(() => location.reload(), 900); }
          catch (e) { msg.textContent = e.message; msg.className = 'fail'; }
        }, true),
        el('button', { type: 'button', className: 'btn', textContent: 'عطّل', onclick: () => { FormaLocal.setAiConfig(null); location.reload(); } }))));
    return box;
  }

  // enter without reloading: a reload loses everything where the browser blocks storage (embedded previews)
  function enterAs(id) {
    FormaLocal.signIn(id);
    $('v-login').textContent = '';
    initPlatform().catch((x) => toast('تعذّر فتح المنصة: ' + ((x && x.message) || x), true));
  }
  function storageWarning() {
    if (!LOCAL || FormaLocal.storageMode() !== 'memory' || $('memWarn')) return;
    const w = el('div', { className: 'notice warnbox', id: 'memWarn', textContent: 'هذا العرض يمنع الحفظ (معاينة داخل تطبيق). ما تعمله الآن سيضيع عند الإغلاق — نزّل الملف وافتحه مباشرة في Chrome أو Edge ليُحفظ عملك على الجهاز.' });
    document.body.prepend(w);
  }
  async function renderLogin() {
    storageWarning();
    showView('login'); $('nav').hidden = true;
    const v = $('v-login'); v.textContent = '';
    const ppl = (await FormaLocal.people()).sort((a, b) => a.name.localeCompare(b.name));
    v.append(el('div', { className: 'loginbrand' }, el('a', { href: '#welcome', className: 'brand', onclick: (e) => { e.preventDefault(); renderWelcome({ entry: 'login' }); } }, el('b', { className: 'cmgtxt', textContent: 'CMG' }), el('b', { textContent: 'FORMA·3D' }), el('small', { textContent: '← الصفحة الترحيبية' }))));
    v.append(el('h1', { textContent: ppl.length ? 'من يستخدم المنصة الآن؟' : 'إعداد المنصة على هذا الجهاز' }),
      el('p', { className: 'sub', textContent: 'هذه نسخة كاملة تعمل من ملف واحد بدون إنترنت. المشاريع والحسابات تُحفظ في متصفح هذا الجهاز.' }));
    const pinBox = el('div', { className: 'formgrid' }); pinBox.hidden = true;
    if (ppl.length) {
      const list = el('div', { className: 'accounts' });
      ppl.forEach((p) => list.append(el('button', { type: 'button', className: 'account', onclick: async () => {
        if (!p.pin) { enterAs(p.id); return; }
        pinBox.hidden = false; pinBox.textContent = '';
        const i = el('input', { type: 'password', id: 'loginPin', inputMode: 'numeric', autocomplete: 'off' });
        const go = async () => { if (await FormaLocal.checkPin(p.id, i.value)) enterAs(p.id); else toast('رمز PIN غير صحيح.', true); };
        i.onkeydown = (e) => { if (e.key === 'Enter') go(); };
        pinBox.append(el('label', { htmlFor: 'loginPin', textContent: 'رمز PIN لـ ' + p.name }), i, el('div', { className: 'row' }, el('button', { type: 'button', className: 'btn primary', textContent: 'دخول', onclick: go })));
        i.focus();
      } }, el('b', { textContent: p.name || 'بدون اسم' }), el('span', { className: 'sub', textContent: ROLE_AR[p.role] || p.role }))));
      v.append(card('الحسابات', list, pinBox));
    }
    const n = el('input', { type: 'text', id: 'newName', placeholder: 'الاسم', required: true }), pin = el('input', { type: 'password', id: 'newPin', placeholder: 'PIN اختياري (4 أرقام أو أكثر)', inputMode: 'numeric', autocomplete: 'off' });
    const f = el('form', { className: 'formgrid' }, el('label', { htmlFor: 'newName', textContent: ppl.length ? 'زبون جديد؟ أنشئ حسابك' : 'اسم مدير المنصة (أول حساب يكون المدير)' }), n, pin, el('div', { className: 'row' }, el('button', { type: 'submit', className: 'btn primary', textContent: ppl.length ? 'أنشئ الحساب وادخل' : 'ابدأ' })));
    f.onsubmit = async (e) => {
      e.preventDefault();
      if (!n.value.trim()) { toast('اكتب الاسم أولًا.', true); n.focus(); return; }
      if (pin.value && pin.value.trim().length < 4) { toast('رمز PIN يجب أن يكون 4 أرقام على الأقل.', true); return; }
      try { enterAs(await FormaLocal.createAccount(n.value.trim(), pin.value.trim(), ppl.length ? 'customer' : 'admin')); }
      catch (x) { toast('تعذّر إنشاء الحساب: ' + ((x && x.message) || x), true); }
    };
    v.append(card(ppl.length ? 'حساب جديد' : 'أول مرة', f));
  }

  // ------------------------------------------------------------------ shell
  function renderNav() {
    const nav = $('nav'); nav.textContent = '';
    if (!PL.ready) { nav.hidden = true; return; }
    nav.hidden = false;
    const items = [['home', 'الرئيسية', true], ['new', 'مشروع جديد', true], ['review', 'المراجعة', may('designer')], ['print', 'الطباعة', may('operator')], ['control', 'مركز التحكم', role() === 'admin'], ['customers', 'أرشيف الزبائن', role() === 'admin'], ['admin', 'الإعدادات', role() === 'admin']];
    const counts = { review: PL.projects.filter((p) => p.status === 'IN_REVIEW').length, print: PL.projects.filter((p) => p.status === 'PRINT_REQUESTED').length + PL.jobs.filter((j) => j.status === 'QUEUED').length };
    items.filter((x) => x[2]).forEach(([k, name]) => {
      const a = el('a', { href: '#' + k, textContent: name });
      if (counts[k]) a.append(el('span', { className: 'count', textContent: String(counts[k]) }));
      if (PL.route === k || (k === 'customers' && ['customer', 'archive'].includes(PL.route))) a.setAttribute('aria-current', 'page');
      nav.append(a);
    });
    const who = $('who'); who.textContent = '';
    who.append(el('button', { type: 'button', className: 'btn small searchbtn', title: 'بحث شامل (Ctrl+K)', 'aria-keyshortcuts': 'Control+K', textContent: 'بحث ⌘K', onclick: openPalette }));
    who.append(el('span', { className: 'rolechip', textContent: ROLE_AR[role()] }));
    if (PL.admin) {
      const sel = el('select', { id: 'viewAs', title: 'اعرض المنصة كما يراها دور آخر' });
      sel.append(el('option', { value: '', textContent: 'اعرض كـ: مدير' }));
      ['customer', 'designer', 'operator'].forEach((r) => sel.append(el('option', { value: r, textContent: 'اعرض كـ: ' + ROLE_AR[r] })));
      sel.value = PL.viewAs || '';
      sel.onchange = () => { PL.viewAs = sel.value || null; try { localStorage.setItem('forma_view_as', sel.value); } catch (e) { /* ignore */ } renderAll(); route(); };
      who.append(sel);
    }
    if (siteNow(false).maintenance.on && role() === 'admin') who.append(el('span', { className: 'pill warn', textContent: 'وضع الصيانة مفعّل' }));
    if (PL.suspended) who.append(el('span', { className: 'pill bad', textContent: 'الحساب موقوف' }));
    else if (!PL.canWrite) who.append(el('span', { className: 'pill warn', textContent: 'عرض فقط' }));
    if (LOCAL) who.append(el('span', { className: 'sub', textContent: PL.names[PL.me.id] || '' }), el('button', { type: 'button', className: 'btn small', textContent: 'تبديل المستخدم', onclick: () => { FormaLocal.signOut(); location.reload(); } }));
  }

  function showView(name) {
    ['home', 'studio', 'review', 'print', 'admin', 'login', 'control', 'customers', 'welcome'].forEach((v) => { $('v-' + v).hidden = v !== name; });
    document.body.classList.toggle('on-welcome', name === 'welcome');
    if (name !== 'welcome') stopWelcomeSpin();
  }
  function renderAll(soft) {
    renderNav();
    if (PL.route === 'home') viewHome();
    else if (PL.route === 'review') viewReview();
    else if (PL.route === 'print' && !(soft && PL.form)) viewPrint();
    else if (PL.route === 'admin' && !soft) viewAdmin();
    else if (PL.route === 'control') viewControl();
    else if (PL.route === 'customers') viewCustomers();
    else if (PL.route === 'customer' && !(soft && PL.form)) viewCustomer(PL.customerId);
    else if (PL.route === 'archive' && !(soft && PL.form)) viewArchive(PL.archiveId);
    else if (PL.route === 'project' || PL.route === 'new') renderProjectBar();
  }
  // Hash routing. In a sandboxed preview (no same-origin) the browser refuses even #fragment navigation,
  // so links and code go through navigate(), which falls back to an in-memory route.
  let memHash = '';
  const curHash = () => location.hash || memHash || '';
  function navigate(h) {
    h = h.startsWith('#') ? h : '#' + h;
    memHash = h;
    try { if (location.hash !== h) { location.hash = h; } } catch (x) { /* blocked */ }
    setTimeout(() => { if (location.hash !== h) route(); }, 0); // no hashchange came: route ourselves
  }
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey) return;
    e.preventDefault(); navigate(a.getAttribute('href'));
  });
  function route() {
    const h = curHash().replace(/^#/, '');
    PL.form = null;
    if (!PL.ready) { showView('studio'); return; }
    if (h === 'welcome' || h === 'welcome-preview') { PL.route = 'welcome'; renderWelcome({ preview: h === 'welcome-preview' }); renderNav(); window.scrollTo(0, 0); return; }
    if (maintenanceBlocks()) { PL.route = 'maintenance'; renderMaintenance(); return; }
    if (h.startsWith('project-')) { PL.route = 'project'; showView('studio'); openProject(h.slice(8)); }
    else if (h === 'new') { PL.route = 'new'; showView('studio'); if (S.project) clearStudio(); else renderProjectBar(); if (!S.result) setTimeout(() => $('idea').focus(), 50); }
    else if (['review', 'print', 'admin', 'control', 'customers'].includes(h)) { PL.route = h; showView(h); }
    else if (h.startsWith('customer-')) { PL.route = 'customer'; PL.customerId = h.slice(9); showView('customers'); }
    else if (h.startsWith('archive-')) { PL.route = 'archive'; PL.archiveId = h.slice(8); showView('customers'); }
    else {
      // a first visit on this device starts at the welcome page
      if (!h) { let seen = true; try { seen = !!localStorage.getItem('cmg_seen'); if (!seen) localStorage.setItem('cmg_seen', '1'); } catch (e) { /* storage blocked */ } if (!seen) { navigate('#welcome'); return; } }
      PL.route = 'home'; showView('home');
    }
    renderAll();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', () => { memHash = location.hash; route(); });
  $('restart').onclick = () => { $('restartRow').hidden = true; if (PL.ready) { if (curHash() === '#new') { clearStudio(); } else navigate('#new'); } else { $('editForm').hidden = true; $('ideaBox').hidden = false; $('thread').textContent = ''; showError(''); } };

  function sub(q, onData) {
    return q.onSnapshot((snap) => { onData(snap.docs.map((d) => ({ ...d.data(), id: d.id }))); }, (e) => toast(DBERR[e && e.code] || 'انقطع تحديث البيانات؛ أعد تحميل الصفحة.', true));
  }

  async function initPlatform() {
    if (LOCAL) {
      await FormaLocal.ready;
      storageWarning();
      const id = FormaLocal.currentId(), ppl = await FormaLocal.people();
      if (!id || !ppl.some((p) => p.id === id)) {
        try { const d0 = await use('db'); const s0 = await d0.doc('settings/site').get(); PL.site = s0.exists ? s0.data() : null; } catch (e) { /* defaults */ }
        applyBrand();
        if (curHash() === '#login') renderLogin(); else renderWelcome({ entry: 'login' });
        return;
      }
    }
    const [db, user] = await Promise.all([use('db'), use('user')]);
    if (!db || !user) { $('standalone').hidden = false; showView('studio'); renderProjectBar(); return; }
    PL.db = db; PL.user = user;
    PL.me = await user.me();
    if (!PL.me.id) { $('standalone').hidden = false; $('standalone').textContent = 'سجّل الدخول إلى Claude لتحفظ مشاريعك على المنصة. المصمّم يعمل بدون حفظ.'; showView('studio'); return; }
    PL.admin = !!(PL.me.isOwner || PL.me.canEdit);
    PL.realRole = PL.admin ? 'admin' : 'customer';
    try { const v = localStorage.getItem('forma_view_as'); if (PL.admin && ROLE_AR[v]) PL.viewAs = v; } catch (e) { /* ignore */ }
    const cw = await user.can('data.write').catch(() => null);
    PL.canWriteCap = cw !== false; PL.canWrite = PL.canWriteCap;
    PL.ready = true;
    PL.names[PL.me.id] = PL.me.name || 'أنت';
    sub(db.collection('roles'), (rows) => { PL.roles = Object.fromEntries(rows.filter((r) => r.role).map((r) => [r.id, r.role])); PL.accounts = Object.fromEntries(rows.map((r) => [r.id, r]));
      // a suspended or archived customer keeps read access to their own records but cannot change anything (UI-level;
      // the hosted database's own rules are unchanged — see docs/CMG_PLATFORM.md)
      PL.suspended = !PL.admin && ['SUSPENDED', 'ARCHIVED'].includes((PL.accounts[PL.me.id] || {}).status);
      PL.canWrite = PL.canWriteCap !== false && !PL.suspended; if (!PL.admin) PL.realRole = ROLE_AR[PL.roles[PL.me.id]] ? PL.roles[PL.me.id] : 'customer'; renderAll(true); });
    sub(db.collection('projects').orderBy('updatedAt', 'desc').limit(500), (rows) => {
      PL.projects = rows;
      const p = current();
      if (p && S.result && PL.resultSha && p.sha && p.sha !== PL.resultSha && !studioEditable() && PL.route === 'project') openProject(p.id, true);
      else renderAll(true);
    });
    sub(db.collection('jobs').orderBy('createdAt', 'desc').limit(300), (rows) => { PL.jobs = rows; renderAll(true); });
    sub(db.collection('printers'), (rows) => { PL.printers = rows; renderAll(true); });
    sub(db.collection('people'), (rows) => { PL.people = rows; if (PL.route === 'admin') viewAdmin(); });
    db.doc('settings/main').onSnapshot((s) => { PL.settings = (s.exists && s.data()) || {}; renderAll(true); }, () => {});
    db.doc('settings/site').onSnapshot((s) => { PL.site = s.exists ? s.data() : null; applyBrand(); if (PL.route === 'welcome') renderWelcome(); }, () => {});
    if (PL.admin) {
      db.doc('settings/site_draft').onSnapshot((s) => { PL.siteDraft = s.exists ? s.data() : null; }, () => {});
      db.doc('settings/site_history').onSnapshot((s) => { PL.siteHistory = s.exists ? s.data() : null; }, () => {});
    }
    if (PL.canWrite) db.doc('people/' + PL.me.id).get().then((s) => { if (!s.exists) return db.doc('people/' + PL.me.id).set({ firstSeen: Date.now() }); }).catch(() => {});
    route();
  }
