/*
 * FormaLocal — what the page uses when it is opened as a plain file (no claude.ai runtime, no internet):
 *   db         same document/collection API the platform uses, persisted in IndexedDB on this device
 *   user       local accounts (name + optional PIN) with roles, chosen on a sign-in screen
 *   downloads  saves files through the browser's normal download
 *   sample     a local language model through Ollama (http://localhost:11434), if configured
 *   octoprint  direct REST client for OctoPrint on the local network (API key kept on this device only)
 */
(function (root) {
  'use strict';
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage blocked */ } },
  };

  // ---------------------------------------------------------------- database (IndexedDB, falls back to localStorage, then memory)
  const DBNAME = 'forma-offline', STORE = 'docs';
  const store = new Map();
  const listeners = new Set();
  let persist = null, mode = 'memory';
  function openIdb() {
    return new Promise((resolve, reject) => {
      if (!root.indexedDB) return reject(new Error('no indexedDB'));
      const req = indexedDB.open(DBNAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function load() {
    try {
      const idb = await openIdb();
      await new Promise((resolve, reject) => {
        const tx = idb.transaction(STORE, 'readonly'), os = tx.objectStore(STORE);
        const req = os.openCursor();
        req.onsuccess = () => { const c = req.result; if (c) { store.set(c.key, c.value); c.continue(); } else resolve(); };
        req.onerror = () => reject(req.error);
      });
      persist = (path, value) => new Promise((resolve, reject) => {
        const tx = idb.transaction(STORE, 'readwrite'), os = tx.objectStore(STORE);
        value === undefined ? os.delete(path) : os.put(value, path);
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('aborted'));
      });
      mode = 'indexeddb';
    } catch (e) {
      const raw = ls.get('forma_offline_db');
      if (raw !== null || (() => { try { localStorage.setItem('forma_probe', '1'); localStorage.removeItem('forma_probe'); return true; } catch (x) { return false; } })()) {
        try { for (const [k, v] of Object.entries(JSON.parse(raw || '{}'))) store.set(k, v); } catch (x) { /* corrupt: start empty */ }
        persist = async () => { ls.set('forma_offline_db', JSON.stringify(Object.fromEntries(store))); };
        mode = 'localstorage';
      } else { persist = async () => {}; mode = 'memory'; }
    }
  }
  const ready = load();
  const collOf = (p) => p.split('/').slice(0, -1).join('/');
  const err = (code, message) => ({ code, message });
  function snapDoc(path) { const d = store.get(path); return { id: path.split('/').pop(), exists: d !== undefined, data: () => (d === undefined ? undefined : clone(d)), metadata: { fromCache: false, hasPendingWrites: false } }; }
  function runQuery(q) {
    let docs = [...store.keys()].filter((k) => collOf(k) === q.path).map(snapDoc);
    for (const [f, op, v] of q.where) docs = docs.filter((d) => { const x = d.data()[f]; return op === '==' ? x === v : op === '!=' ? x !== v : op === '<' ? x < v : op === '<=' ? x <= v : op === '>' ? x > v : op === '>=' ? x >= v : op === 'in' ? v.includes(x) : op === 'array-contains' ? Array.isArray(x) && x.includes(v) : true; });
    if (q.order) { const [f, dir] = q.order; docs.sort((a, b) => { const x = a.data()[f], y = b.data()[f]; return (x === undefined) - (y === undefined) || (x < y ? -1 : x > y ? 1 : 0) * (dir === 'desc' ? -1 : 1); }); } else docs.sort((a, b) => (a.id < b.id ? -1 : 1));
    if (q.limit) docs = docs.slice(0, q.limit);
    return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
  }
  let notifyTimer = null;
  function notify() { clearTimeout(notifyTimer); notifyTimer = setTimeout(() => { for (const l of listeners) l.kind === 'doc' ? l.cb(snapDoc(l.path)) : l.cb(runQuery(l.q)); }, 0); }
  async function write(path, value) {
    await ready;
    if (value !== undefined && JSON.stringify(value).length > 262144) throw err('invalid_argument', 'document over 256 KiB');
    if (value === undefined) store.delete(path); else store.set(path, clone(value));
    notify();
    try { await persist(path, value === undefined ? undefined : clone(value)); } catch (e) { throw err('unavailable', 'could not save on this device: ' + (e && e.message)); }
  }
  function docRef(path) {
    if (path.split('/').length % 2) throw new TypeError('document path needs an even number of segments: ' + path);
    return {
      id: path.split('/').pop(), path,
      async get() { await ready; return snapDoc(path); },
      set: (d) => write(path, d),
      async update(d) { await ready; if (!store.has(path)) throw err('invalid_argument', 'document does not exist'); return write(path, { ...store.get(path), ...clone(d) }); },
      delete: () => write(path, undefined),
      onSnapshot(cb) { const l = { kind: 'doc', path, cb }; listeners.add(l); ready.then(() => cb(snapDoc(path))); return () => listeners.delete(l); },
      collection: (p) => collRef(path + '/' + p),
    };
  }
  function query(q) {
    return {
      where: (f, op, v) => query({ ...q, where: [...q.where, [f, op, v]] }),
      orderBy: (f, dir = 'asc') => query({ ...q, order: [f, dir] }),
      limit: (n) => query({ ...q, limit: n }),
      async get() { await ready; return runQuery(q); },
      onSnapshot(cb) { const l = { kind: 'q', q, cb }; listeners.add(l); ready.then(() => cb(runQuery(q))); return () => listeners.delete(l); },
    };
  }
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  function collRef(path) {
    if (path.split('/').length % 2 === 0) throw new TypeError('collection path needs an odd number of segments: ' + path);
    return { ...query({ path, where: [], order: null, limit: 0 }), path, doc: (id) => docRef(path + '/' + (id || newId())), async add(d) { const r = docRef(path + '/' + newId()); await r.set(d); return r; } };
  }
  const db = { doc: docRef, collection: collRef };

  /** Backup: every document except nothing secret (printer keys never enter the database). */
  async function exportAll() { await ready; return { format: 'forma-offline-backup', version: 1, exportedAt: Date.now(), docs: Object.fromEntries(store) }; }
  async function importAll(data, replace) {
    if (!data || data.format !== 'forma-offline-backup' || typeof data.docs !== 'object') throw new Error('هذا ليس ملف نسخة احتياطية من منصة فورما.');
    await ready;
    if (replace) for (const k of [...store.keys()]) await write(k, undefined);
    for (const [k, v] of Object.entries(data.docs)) if (/^[A-Za-z0-9_\-.~:@+/]+$/.test(k) && v && typeof v === 'object') await write(k, v);
  }

  // ---------------------------------------------------------------- local accounts
  async function sha(text) {
    const bytes = new TextEncoder().encode(text);
    if (root.Engine3D && root.Engine3D.sha256Hex) return root.Engine3D.sha256Hex(bytes);
    const h = await crypto.subtle.digest('SHA-256', bytes); return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  async function people() { await ready; return [...store.entries()].filter(([k]) => /^people\/[^/]+$/.test(k)).map(([k, v]) => ({ id: k.split('/')[1], ...v, role: (store.get('roles/' + k.split('/')[1]) || {}).role || 'customer' })); }
  async function createAccount(name, pin, roleName) {
    const id = 'u_' + newId();
    await write('people/' + id, { name: String(name).slice(0, 60), firstSeen: Date.now(), pin: pin ? await sha('forma:' + id + ':' + pin) : null });
    await write('roles/' + id, { role: roleName, by: id, at: Date.now() });
    return id;
  }
  async function checkPin(id, pin) { const p = store.get('people/' + id); if (!p) return false; if (!p.pin) return true; return p.pin === (await sha('forma:' + id + ':' + pin)); }
  // kept in memory too: when the page runs where storage is blocked (an embedded preview), the session still works
  let memUser = null;
  const currentId = () => ls.get('forma_current_user') || memUser;
  const signIn = (id) => { memUser = id; ls.set('forma_current_user', id); };
  const signOut = () => { memUser = null; ls.del('forma_current_user'); };
  function user() {
    const meOf = () => {
      const id = currentId(), p = id && store.get('people/' + id), r = (id && store.get('roles/' + id)) || {};
      if (!p) return { id: null, name: '', isOwner: false, canEdit: false, email: null, avatarUrl: '', color: '#3d7c90' };
      return { id, name: p.name || '', isOwner: r.role === 'admin', canEdit: r.role === 'admin', email: null, avatarUrl: '', color: '#3d7c90' };
    };
    return {
      async me() { await ready; return meOf(); }, async id() { await ready; return meOf().id; },
      async isOwner() { await ready; return meOf().isOwner; }, async canEdit() { await ready; return meOf().canEdit; },
      async can() { return true; },
      async profiles(ids) { await ready; const me = currentId(); return Object.fromEntries(ids.map((i) => [i, { id: i, name: (store.get('people/' + i) || {}).name || '', avatarUrl: '', color: '#3d7c90', email: null, isMe: i === me, guest: false }])); },
    };
  }

  // ---------------------------------------------------------------- downloads
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = filename; a.rel = 'noopener';
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      return { status: 'saved' };
    },
  };

  // ---------------------------------------------------------------- local language model (Ollama)
  const AI_KEY = 'forma_local_ai';
  const aiConfig = () => { try { const c = JSON.parse(ls.get(AI_KEY) || 'null'); return c && c.url && c.model ? c : null; } catch (e) { return null; } };
  const setAiConfig = (c) => (c ? ls.set(AI_KEY, JSON.stringify(c)) : ls.del(AI_KEY));
  function extractJson(text) {
    const tries = [text.trim()];
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/); if (fence) tries.push(fence[1].trim());
    const a = text.indexOf('{'), b = text.lastIndexOf('}'); if (a >= 0 && b > a) tries.push(text.slice(a, b + 1));
    for (const t of tries) { try { return JSON.parse(t); } catch (e) { /* next */ } }
    throw { code: 'invalid_json', message: 'reply held no JSON', text };
  }
  async function ollamaChat(cfg, prompt, opts = {}) {
    let res;
    try {
      res = await fetch(cfg.url.replace(/\/+$/, '') + '/api/chat', {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: opts.signal,
        body: JSON.stringify({ model: cfg.model, stream: true, format: opts.json ? 'json' : undefined, options: { temperature: 0.2, num_ctx: cfg.ctx || 16384 }, messages: [{ role: 'user', content: prompt + (opts.json ? '\n\nReply with the JSON value only.' : '') }] }),
      });
    } catch (e) {
      if (e && e.name === 'AbortError') throw { code: 'cancelled', message: 'aborted' };
      throw { code: 'upstream_error', message: 'Ollama unreachable at ' + cfg.url + ' (is it running, and does OLLAMA_ORIGINS allow this page?)' };
    }
    if (!res.ok) throw { code: 'upstream_error', message: 'Ollama HTTP ' + res.status + ': ' + (await res.text().catch(() => '')).slice(0, 200) };
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '', text = '';
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line) continue;
          const msg = JSON.parse(line);
          if (msg.error) throw { code: 'upstream_error', message: 'Ollama: ' + msg.error };
          const delta = (msg.message && msg.message.content) || '';
          if (delta) { text += delta; if (opts.onText) opts.onText({ text, delta }); }
        }
      }
    } catch (e) {
      if (e && e.name === 'AbortError') throw { code: 'cancelled', message: 'aborted', text };
      if (e && e.code) throw e;
      throw { code: 'upstream_error', message: String((e && e.message) || e), text };
    }
    if (!text.trim()) throw { code: 'empty_completion', message: 'the model returned nothing' };
    return text;
  }
  function sample() {
    const cfg = aiConfig(); if (!cfg) return null;
    const f = async (input, opts = {}) => ({ text: await ollamaChat(cfg, typeof input === 'string' ? input : input.map((t) => t.content).join('\n\n'), opts), truncated: false, modelTierApplied: 'default' });
    f.json = async (prompt, opts = {}) => extractJson(await ollamaChat(cfg, prompt, { ...opts, json: true }));
    f.limits = async () => ({ maxPromptBytes: 262144 });
    f.local = cfg;
    return f;
  }
  async function testAi(cfg) {
    const res = await fetch(cfg.url.replace(/\/+$/, '') + '/api/tags').catch(() => null);
    if (!res || !res.ok) throw new Error('لا يوجد Ollama يعمل على ' + cfg.url);
    const tags = await res.json();
    const names = (tags.models || []).map((m) => m.name);
    return { models: names, has: names.some((n) => n === cfg.model || n.split(':')[0] === cfg.model.split(':')[0]) };
  }

  // ---------------------------------------------------------------- OctoPrint (direct, local network)
  const keyOf = (printerId) => ls.get('forma_octo_key_' + printerId);
  const setKey = (printerId, key) => (key ? ls.set('forma_octo_key_' + printerId, key) : ls.del('forma_octo_key_' + printerId));
  async function octo(printer, path, { method = 'GET', json, form, timeout = 12000 } = {}) {
    const key = keyOf(printer.id);
    if (!key) throw new Error('لم يُحفظ مفتاح API لهذه الطابعة على هذا الجهاز.');
    if (!/^https?:\/\//i.test(printer.url || '')) throw new Error('عنوان OctoPrint غير صالح.');
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
    let res;
    try {
      res = await fetch(printer.url.replace(/\/+$/, '') + path, { method, signal: ctl.signal, headers: { 'X-Api-Key': key, ...(json ? { 'content-type': 'application/json' } : {}) }, body: json ? JSON.stringify(json) : form });
    } catch (e) {
      throw new Error(e && e.name === 'AbortError' ? 'انتهت مهلة الاتصال بالطابعة.' : 'تعذّر الوصول إلى OctoPrint على ' + printer.url + ' (تأكد من الشبكة ومن تفعيل CORS في إعدادات API).');
    } finally { clearTimeout(t); }
    if (res.status === 401 || res.status === 403) throw new Error('مفتاح API مرفوض.');
    if (res.status === 409) throw new Error('الطابعة ليست جاهزة (غير متصلة بـ OctoPrint أو تطبع شيئًا آخر).');
    if (!res.ok) throw new Error('OctoPrint HTTP ' + res.status + ': ' + (await res.text().catch(() => '')).slice(0, 160));
    const ct = res.headers.get('content-type') || '';
    return ct.includes('json') ? res.json() : res.text();
  }
  const octoprint = {
    keyOf, setKey,
    version: (p) => octo(p, '/api/version'),
    async status(p) {
      const [printer, job] = await Promise.all([octo(p, '/api/printer?exclude=sd,history').catch((e) => (/409/.test(e.message) || /ليست جاهزة/.test(e.message) ? { state: { text: 'غير متصلة بالطابعة', flags: {} } } : Promise.reject(e))), octo(p, '/api/job')]);
      return { printer, job };
    },
    async upload(p, name, blob) {
      const fd = new FormData(); fd.append('file', blob, name); fd.append('select', 'false'); fd.append('print', 'false');
      return octo(p, '/api/files/local', { method: 'POST', form: fd, timeout: 120000 });
    },
    start: (p, name) => octo(p, '/api/files/local/' + encodeURIComponent(name), { method: 'POST', json: { command: 'select', print: true } }),
    cancel: (p) => octo(p, '/api/job', { method: 'POST', json: { command: 'cancel' } }),
  };

  // ---------------------------------------------------------------- dispatcher
  const local = !(root.claude && root.claude.use);
  function use(name) {
    if (!local) return root.claude.use(name);
    if (name === 'db') return ready.then(() => db);
    if (name === 'user') return ready.then(() => user());
    if (name === 'downloads') return Promise.resolve(downloads);
    if (name === 'sample') return Promise.resolve(sample());
    return Promise.resolve(null);
  }
  root.FormaLocal = { local, use, ready, storageMode: () => mode, exportAll, importAll, people, createAccount, checkPin, currentId, signIn, signOut, aiConfig, setAiConfig, testAi, octoprint };
})(typeof globalThis !== 'undefined' ? globalThis : this);
