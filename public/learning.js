/* eslint-env browser */
/* global OperatorSession:readonly */
// public/learning.js
// The learning console (CW22, doc 22 §12.2). A client of the routes the engine
// already exposes and never a second path into KV: the learn document through
// /content/learn (validated by the same validator the write path runs), the
// lift grid through /v1/:tenant/lift, the day report, the archive, the
// proposals. Same token, same tokens of design, as the tuning surface.
(() => {
  const $ = (id) => document.getElementById(id);
  const qs = new URLSearchParams(location.search);
  const S = {
    scope: qs.get('scope') || 'coach',
    brand: qs.get('brand') || qs.get('scope') || 'coach',
    slot: qs.get('slot') || '',
    token: sessionStorage.getItem('tuning-token') || '',
    learn: null, draft: null, learnRevision: 0, learnSource: 'loading', learnHistory: [],
    slots: [], pieces: new Map(),
    snapshot: null, archived: null, liftHistory: [], priorHistory: [], proposals: null, proposalsError: '',
    report: null, reportError: '', reportPage: null, reportLoading: false, reportKey: '', reportGeneration: 0, customReport: null, customKey: '',
    errors: [], flash: '', checking: false,
    sort: { col: 'lift', dir: -1 }, filter: '', level: '0',
    diffs: {},
  };
  if (window.OperatorSession) OperatorSession.setTenantProvider(() => S.scope);
  const api = (path) => `/content${path}${path.includes('?') ? '&' : '?'}scope=${encodeURIComponent(S.scope)}`;
  const v1 = (path) => `/v1/${encodeURIComponent(S.scope)}${path}`;
  const pendingPublications = new Map(JSON.parse(sessionStorage.getItem('learning-pending-v1') || '[]'));
  const persistPending = () => {
    const raw = JSON.stringify([...pendingPublications]);
    if (pendingPublications.size > 16 || new TextEncoder().encode(raw).length > 2 * 1024 * 1024) throw new Error('Pending configuration capacity exceeded; resolve the original intent.');
    sessionStorage.setItem('learning-pending-v1', raw);
  };
  const removePending = key => {
    const previous = pendingPublications.get(key); pendingPublications.delete(key);
    try { persistPending(); } catch (error) { if (previous) pendingPublications.set(key, previous); throw error; }
  };
  function authored(data) {
    return data && Number.isSafeInteger(data.revision) && data.revision > 0 && data.publication
      && Number.isSafeInteger(data.publication.revision) && /^[0-9a-f]{64}$/.test(data.publication.digest)
      ? { scope: S.scope, revision: data.revision, publication: { ...data.publication } } : null;
  }
  const localRefusal = (status, error) => ({ ok: false, status, json: async () => ({ ok: false, error }) });
  async function publicationStatus(key, recover) {
    const p = pendingPublications.get(key); if (!p || p.scope !== S.scope) return;
    const result = await request(api('/catalog/publication' + (recover ? '/recover' : '') + '?kind=learn'), {
      method: recover ? 'POST' : 'GET', headers: p.headers, ...(recover ? { body: '{}' } : {}),
    });
    const data = await result.json();
    if (!recover && result.status === 409 && data.code === 'publication_conflict') { p.conflicted = true; persistPending(); }
    S.errors = [result.ok ? 'Original publication ' + (data.state || 'committed') + '. Retry the exact original intent to finish any reset continuation; reload before a new edit.' : data.error || 'Original publication status unavailable.'];
    render();
  }
  async function request(url, init) {
    const tenant = S.scope;
    if (new URL(url, location.href).origin !== location.origin) throw new Error('Operator requests must stay on this origin.');
    const headers = new Headers(init && init.headers);
    if (headers.has('X-Tenant') && headers.get('X-Tenant') !== tenant) throw new Error('Conflicting operator tenant.');
    headers.set('X-Tenant', tenant);
    const token = window.OperatorSession ? await OperatorSession.token() : S.token;
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const protectedWrite = init && (init.method === 'PUT' && new URL(url, location.href).pathname === '/content/learn'
      || init.method === 'POST' && (/\/content\/learn\/rollback\//.test(url) || url.includes('/learn/items/reset')));
    let key, pending;
    if (protectedWrite) {
      key = tenant + '|' + url; pending = pendingPublications.get(key);
      if (pending && (pending.body !== init.body || pending.method !== init.method)) return localRefusal(409, 'Resolve the retained original publication before changing its draft.');
      if (!pending) {
        const base = S.authority;
        if (!base || base.scope !== tenant || pendingPublications.size >= 16) return localRefusal(428, 'Authoritative loaded document required; no fresh base is inferred.');
        headers.set('If-Match', '"' + base.revision + '/' + base.publication.revision + '/' + base.publication.digest + '"');
        headers.set('Idempotency-Key', base.revision + ':' + crypto.randomUUID());
        pending = { url, scope: tenant, method: init.method, body: init.body,
          headers: { 'If-Match': headers.get('If-Match'), 'Idempotency-Key': headers.get('Idempotency-Key'), 'content-type': 'application/json' } };
        pendingPublications.set(key, pending);
        try { persistPending(); } catch { pendingPublications.delete(key); return localRefusal(503, 'Could not retain the original publication intent; no write sent.'); }
      } else for (const [name, value] of Object.entries(pending.headers)) headers.set(name, value);
    }
    try {
      const response = await fetch(url, { ...(init || {}), headers: Object.fromEntries(headers) });
      if (response.ok && key) {
        const receipt = await response.clone().json().catch(() => null);
        if (receipt && receipt.ok === true && url.includes('/items/reset') && receipt.publicationOutcome !== 'acknowledged') {
          return { ok: false, status: 503, json: async () => ({ ...receipt, ok: false,
            error: 'Reset completed; snapshot publication acknowledgement is unknown. Retry the exact retained original operation, not another reset.' }) };
        }
        if (receipt && receipt.ok === true) removePending(key);
      }
      return response;
    } catch (error) {
      if (!protectedWrite) throw error;
      return localRefusal(503, 'Publication acknowledgement unknown; exact original intent retained.');
    }
  }
  const canEdit = () => Boolean(S.token);
  const copy = (v) => JSON.parse(JSON.stringify(v));
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const pct = (x) => `${Math.round(x * 100)}%`;
  const when = (ms) => (ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;
  const DEFAULT_WINDOWS = { click: 30 * MIN, dwell: 30 * MIN, video_complete: 30 * MIN, wishlist: 6 * HOUR, add_to_bag: 6 * HOUR, purchase: 7 * DAY, custom: 30 * MIN };
  const REWARDS = ['click', 'dwell', 'video_complete', 'wishlist', 'add_to_bag', 'purchase', 'custom'];
  const LEVEL_WORDS = ['everyone', 'channel', 'channel and visit', 'channel, visit and stage', 'channel, visit, stage and region', 'channel, visit, stage, region and affinity'];
  const levelOf = (key) => (key === '*' ? 0 : key.split('|').length);
  // Doc 22 §7: the exploration modes the engine runs. A retained document may still
  // name a withdrawn one; it is reported as the dormant setting it is, never as live.
  const SUPPORTED_EXPLORATION = ['off', 'rotation', 'epsilon'];
  const storedModeWords = (mode) => `Stored ${String(mode).charAt(0).toUpperCase()}${String(mode).slice(1)} — inactive`;

  // ---------- tiny DOM helpers ----------
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  }
  const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  function humanMs(ms) {
    if (!ms) return '';
    if (ms % DAY === 0) return `${ms / DAY} day${ms / DAY === 1 ? '' : 's'}`;
    if (ms % HOUR === 0) return `${ms / HOUR} hour${ms / HOUR === 1 ? '' : 's'}`;
    return `${Math.round(ms / MIN)} min`;
  }
  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const csvCell = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n');

  // ---------- draft plumbing ----------
  function dials() { S.draft.slots = S.draft.slots || {}; return (S.draft.slots[S.slot] = S.draft.slots[S.slot] || {}); }
  function diffPaths(a, b, path = '') {
    const out = [];
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
      if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path: path || '(root)', from: a, to: b });
      return out;
    }
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out.push(...diffPaths(a[k], b[k], path ? `${path}.${k}` : k));
    return out;
  }
  const changes = () => (S.learn && S.draft ? diffPaths(S.learn, S.draft) : []);
  let checkTimer = null;
  function scheduleCheck() { clearTimeout(checkTimer); checkTimer = setTimeout(check, 350); render(); }
  async function check() {
    if (!changes().length) { S.errors = []; render(); return; }
    S.checking = true;
    try {
      const res = await request(api('/learn/validate'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ document: S.draft }) });
      const data = await res.json();
      S.errors = data.valid ? [] : data.errors || ['The document did not validate.'];
    } catch { S.errors = ['Could not reach the validator.']; }
    S.checking = false; render();
  }
  async function save() {
    const note = $('note').value.trim();
    const res = await request(api('/learn'), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ document: S.draft, note }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      S.errors = res.status === 401 || res.status === 403 ? ['Your sign-in was not accepted. Sign in again to change the dials.'] : data.errors || ['The save was refused.'];
      render(); return;
    }
    S.authority = authored(data);
    S.learn = data.document; S.draft = copy(S.learn); S.learnRevision = data.revision; S.learnSource = 'stored';
    $('note').value = ''; S.errors = []; flash(`Saved as revision ${data.revision}.`);
    await Promise.all([loadLearnHistory(), loadLift()]); render();
  }
  function flash(text) { S.flash = text; render(); setTimeout(() => { if (S.flash === text) { S.flash = ''; render(); } }, 4000); }

  // ---------- loading ----------
  // Every /v1 read carries the operator token when there is one: under enforced access a verified token passes the SDK gate.
  const json = async (url, init) => { const r = await request(url, init); const d = await r.json().catch(() => ({})); return { ok: r.ok, status: r.status, data: d }; };
  async function loadLearn() {
    const { data, ok } = await json(api('/learn'));
    S.authority = ok ? authored(data) : null;
    S.learn = data.document || { holdout: { share: 0.05, salt: '', arms: ['default'] } };
    S.draft = copy(S.learn); S.learnRevision = data.revision || 0; S.learnSource = data.source || 'compiled-default';
  }
  async function loadLearnHistory() { const { data } = await json(api('/learn/history')); S.learnHistory = data.revisions || []; }
  async function loadPriorHistory() { const { data } = await json(api('/priors/history')); S.priorHistory = data.revisions || []; }
  async function loadSlots() {
    const [{ data: slots }, { data: cat }] = await Promise.all([json(api('/slots')), json(api('/catalog'))]);
    const pages = (slots.document && slots.document.pages) || {};
    S.slots = [];
    for (const [page, list] of Object.entries(pages)) for (const s of list) S.slots.push({ page, slot: s.slot, weights: s.weights || {}, pinned: Boolean(s.pinnedPieceId) });
    if (!S.slot || !S.slots.some((s) => s.slot === S.slot)) S.slot = (S.slots.find((s) => !s.pinned) || S.slots[0] || { slot: '' }).slot;
    S.pieces = new Map(((cat.document && cat.document.pieces) || []).map((p) => [p.id, p]));
  }
  async function loadLift() {
    if (!S.slot) { S.snapshot = null; S.liftHistory = []; return; }
    const q = `?slot=${encodeURIComponent(S.slot)}&brand=${encodeURIComponent(S.brand)}`;
    const [{ data: cur }, { data: hist }] = await Promise.all([json(v1(`/lift${q}${S.archived ? `&version=${S.archived}` : ''}`)), json(v1(`/lift/history${q}`))]);
    S.snapshot = cur.snapshot || null; S.liftHistory = hist.versions || [];
  }
  async function loadProposals() {
    const { ok, status, data } = await json(v1('/learn/proposals'));
    if (ok) { S.proposals = data.proposals || []; S.proposalsError = ''; }
    else { S.proposals = null; S.proposalsError = status === 401 || status === 403 ? 'Sign in to read the proposals.' : 'Could not read the proposals.'; }
  }
  const reportUser = () => { const a = window.OperatorSession, u = a && a.user(); return JSON.stringify([Boolean(a && a.signedIn()), u && u.id, u && u.roles, u && u.tenants, Boolean(a && a.mustChangePassword())]); };
  const customKey = () => JSON.stringify([S.scope, S.brand, $('report-date').value, reportUser()]);
  const reportKey = () => JSON.stringify([customKey(), S.slot]);
  function reportContext() {
    if (S.customKey !== customKey()) { S.customKey = customKey(); S.customReport = null; }
    if (S.reportKey !== reportKey()) { S.reportKey = reportKey(); S.reportGeneration++; S.report = null; S.reportPage = null; S.reportError = ''; S.reportLoading = false; $('report-run').disabled = false; $('report-run').textContent = 'Build the report'; }
  }
  const reportOwner = (r) => r && r.tenant === S.scope && r.brand === S.brand && r.date === $('report-date').value;
  function customPage(offset = 0) {
    const r = S.customReport, grid = r.grids[S.slot], names = r.policies.map(p => p.name);
    const items = [...new Set(names.flatMap(n => Object.keys(grid && grid[n] && grid[n].items || {})))].sort(), chosen = items.slice(offset, offset + 50), projected = {};
    if (grid) for (const n of names) if (grid[n]) {
      const snap = grid[n], entries = {};
      for (const item of chosen) if (snap.items[item]) entries[item] = snap.items[item]['*'] ? { '*': snap.items[item]['*'] } : {};
      projected[n] = { ...snap, items: entries, slotRates: snap.slotRates && snap.slotRates['*'] ? { '*': snap.slotRates['*'] } : {} };
    }
    S.report = { ...r, grids: grid ? { [S.slot]: projected } : {} };
    S.reportPage = { slot: S.slot, total: items.length, offset, limit: 50, next: offset + 50 < items.length ? offset + 50 : null, previous: offset > 0 ? Math.max(0, offset - 50) : null };
  }
  async function loadReport(date, cursor) {
    reportContext(); const key = S.reportKey, generation = ++S.reportGeneration;
    $('report-run').disabled = false; $('report-run').textContent = 'Build the report';
    S.report = null; S.reportPage = null; S.reportError = ''; S.reportLoading = true; renderReport();
    if (S.customReport) { customPage(typeof cursor === 'number' ? cursor : 0); S.reportLoading = false; renderReport(); return; }
    if (!S.slot) { S.reportLoading = false; return; }
    const { ok, status, data } = await json(v1(`/learn/report?date=${encodeURIComponent(date)}&brand=${encodeURIComponent(S.brand)}&slot=${encodeURIComponent(S.slot)}&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)).catch(() => ({ ok: false, status: 0, data: {} }));
    if (key !== reportKey() || generation !== S.reportGeneration) return;
    const p = data.page;
    const valid = ok && data.ok === true && reportOwner(data.report) && p && p.slot === S.slot && typeof p.revision === 'string' && /^[a-f0-9]{64}$/.test(p.revision) && p.limit === 50 && Number.isSafeInteger(p.offset) && p.offset >= 0 && Number.isSafeInteger(p.total) && p.total >= 0;
    S.report = valid ? data.report : null; S.reportPage = valid ? p : null; S.reportLoading = false;
    S.reportError = valid || status === 404 ? '' : status === 409 ? 'Report changed. Reload the first page.' : data.error || 'Could not read this report page.';
    renderReport();
  }
  async function load() {
    // The session hands over the current token, renewed first when it is about to run out.
    if (window.OperatorSession && OperatorSession.signedIn()) S.token = await OperatorSession.token();
    await loadSlots();
    await Promise.all([loadLearn(), loadLearnHistory(), loadPriorHistory(), loadLift(), loadProposals(), loadReport($('report-date').value), loadAccounts()]);
    render();
  }

  // ---------- actions ----------
  async function rollback(n) {
    const res = await request(api(`/learn/rollback/${n}`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) { S.errors = data.errors || ['The rollback was refused.']; render(); return; }
    flash(`Rolled revision ${n} forward as revision ${data.revision}.`);
    await loadLearn(); await loadLearnHistory(); render();
  }
  async function resetItem(item) {
    if (!confirm(`Discard the evidence for ${nameOf(item)} in ${S.slot} and start again from the prior?`)) return;
    const res = await request(v1('/learn/items/reset'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slot: S.slot, item, brand: S.brand }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) { S.errors = [data.error || 'The reset was refused.']; render(); return; }
    flash(data.had ? `Evidence for ${nameOf(item)} discarded; snapshot publication status is separate, recorded as revision ${data.revision}.` : `${nameOf(item)} had no evidence in this slot; recorded as revision ${data.revision}.`);
    await Promise.all([loadLift(), loadLearnHistory()]); render();
  }
  function presets() {
    const base = { scope: 'session', match: 'direct', credit: 'last', ...((S.learn || {}).policy || {}) };
    base.windowsMs = { ...DEFAULT_WINDOWS, ...(base.windowsMs || {}) };
    return [
      { name: 'first-touch', ...base, credit: 'first' },
      { name: 'any-item', ...base, match: 'any' },
      { name: 'visitor-scope', ...base, scope: 'visitor' },
      { name: 'purchase-1d', ...base, windowsMs: { ...base.windowsMs, purchase: DAY } },
    ];
  }
  async function runReport() {
    reportContext(); const key = S.reportKey, generation = ++S.reportGeneration;
    S.reportLoading = false;
    const date = $('report-date').value;
    const chosen = presets().filter((p) => { const box = document.querySelector(`#report-presets input[data-name="${p.name}"]`); return !box || box.checked; });
    const customName = $('custom-name').value.trim();
    if (customName) chosen.push({ name: customName, scope: $('custom-scope').value, match: $('custom-match').value, credit: $('custom-credit').value, windowsMs: presets()[0].windowsMs });
    $('report-run').disabled = true; $('report-run').textContent = 'Building…';
    const res = await json(v1('/learn/report'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ date, brand: S.brand, policies: chosen }) }).catch(() => ({ ok: false, status: 0, data: {} }));
    const data = res.data;
    if (key !== reportKey() || generation !== S.reportGeneration) return;
    $('report-run').disabled = false; $('report-run').textContent = 'Build the report';
    if (!res.ok || !data.ok) { S.reportError = res.status === 401 || res.status === 403 ? 'Sign in to build a report.' : data.error || 'The report could not be built.'; S.report = null; render(); return; }
    if (!reportOwner(data.report)) { S.report = null; S.reportError = 'The report context did not match.'; render(); return; }
    S.reportError = ''; S.customReport = data.report; customPage(); render();
  }

  // ---------- rendering ----------
  const nameOf = (id) => { const p = S.pieces.get(id); return p ? (p.customerContentId || p.title || id) : id; };
  function gridRows() {
    const snap = S.snapshot; if (!snap) return [];
    const rows = [];
    for (const [item, byKey] of Object.entries(snap.items || {})) {
      for (const [key, st] of Object.entries(byKey)) {
        if (S.level === '0' && key !== '*') continue;
        const n0 = st.n0 ?? snap.n0;
        const row = { item, name: nameOf(item), key, level: levelOf(key), n: st.n, s: st.s, p_hat: st.p_hat, p0: st.p0, lift: st.lift, n0, evidence: r3(st.n / (st.n + n0)), prior: st.prior || null };
        const f = S.filter.toLowerCase();
        if (f && !`${row.name} ${item} ${key} ${LEVEL_WORDS[row.level]}`.toLowerCase().includes(f)) continue;
        rows.push(row);
      }
    }
    const { col, dir } = S.sort;
    rows.sort((a, b) => { const x = a[col], y = b[col]; return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir || a.item.localeCompare(b.item) || a.level - b.level; });
    return rows;
  }
  function controlOf(item) {
    const cur = (((S.learn.slots || {})[S.slot] || {}).items || {})[item] || null;
    const next = (((S.draft.slots || {})[S.slot] || {}).items || {})[item] || null;
    return { cur, next, pending: JSON.stringify(cur) !== JSON.stringify(next) };
  }
  function setControl(item, ctl) {
    const d = dials(); d.items = d.items || {};
    if (ctl) d.items[item] = ctl; else delete d.items[item];
    if (!Object.keys(d.items).length) delete d.items;
    scheduleCheck();
  }
  function renderGrid() {
    const host = clear($('grid'));
    const banner = clear($('grid-banner'));
    banner.append(h('div', { class: 'msg' }, 'The learning multiplier adjusts ranking scores; it is not measured business lift.'));
    if (S.archived) banner.append(h('div', { class: 'banner' }, `Viewing the archived snapshot published ${when(S.archived)}, not the one in force.`, h('button', { class: 'small', onclick: async () => { S.archived = null; await loadLift(); render(); } }, 'Back to the current snapshot')));
    const rows = gridRows();
    const snap = S.snapshot;
    $('grid-count').textContent = snap ? `${rows.length} row${rows.length === 1 ? '' : 's'} · basis ${snap.measurementBasis || 'served-v1'} (rendered is client-reported) · reward ${snap.reward}${snap.objective && snap.objective !== 'unit' ? ` weighed by ${snap.objective}` : ''} · n₀ ${snap.n0}, n_min ${snap.nMin} · published ${when(snap.publishedAt)}${snap.priorVersion ? ` · prior revision ${snap.priorVersion}` : ''}` : '';
    if (!snap) { host.append(h('div', { class: 'empty' }, 'Nothing published for this slot yet. The first snapshot publishes thirty seconds after the first decision it serves.')); return; }
    if (!rows.length) { host.append(h('div', { class: 'empty' }, 'No rows match.')); return; }
    // Headings are words a merchandiser reads; the design's symbol sits under each for whoever reads doc 22.
    const cols = [['name', 'Item', ''], ['key', 'Cell', ''], ['n', 'Exposures', 'n'], ['s', 'Weighted credit', 's'], ['p_hat', 'Credit / exposure', 'p̂'], ['p0', 'Baseline', 'p₀'], ['lift', 'Lift', 'p̂ / p₀'], ['evidence', 'Evidence', 'n / (n + n₀)']];
    const thead = h('tr', {}, ...cols.map(([col, label, sym]) => h('th', { class: `sortable${['n', 's', 'p_hat', 'p0', 'lift', 'evidence'].includes(col) ? ' num' : ''}${S.sort.col === col ? ` on${S.sort.dir > 0 ? ' asc' : ''}` : ''}`, title: { n: 'Decayed admitted exposures on the snapshot measurement basis; not visibility proof', s: 'How many times showing it paid off on the reward this slot learns against, weighed by the objective', p_hat: 'Weighted credit per exposure, smoothed toward the compatible prior target; not always a probability', p0: 'The slot\'s own rate in this cell', lift: 'The rate over the baseline, clamped', evidence: 'How much of the rate is live observation rather than the prior' }[col] || '', onclick: () => { S.sort = { col, dir: S.sort.col === col ? -S.sort.dir : (col === 'name' || col === 'key' ? 1 : -1) }; render(); } }, label, sym ? h('span', { class: 'sym' }, sym) : null)), h('th', {}, 'Controls'));
    const body = rows.map((r) => {
      const { cur, next, pending } = controlOf(r.item);
      const chips = [];
      if (next) chips.push(h('span', { class: `chip ${next.mode}` }, next.mode === 'freeze' ? `frozen at ${next.lift}` : 'rejected'));
      if (pending) chips.push(h('span', { class: 'chip pending' }, cur ? 'changing' : 'to save'));
      if (r.prior) chips.push(h('span', { class: 'chip prior', title: `imported prior: rate ${r.prior.p}, strength ${r.prior.n}` }, `prior ${r.prior.p} × ${r.prior.n}`));
      return h('tr', {},
        h('td', {}, h('div', { class: 'itemname' }, r.name), h('div', { class: 'itemid' }, r.item)),
        h('td', {}, h('div', {}, LEVEL_WORDS[r.level]), h('div', { class: 'cellkey' }, r.key)),
        h('td', { class: 'num' }, r.n), h('td', { class: 'num' }, r.s), h('td', { class: 'num' }, r.p_hat), h('td', { class: 'num' }, r.p0),
        h('td', { class: 'num' }, h('strong', {}, r.lift)), h('td', { class: 'num' }, pct(r.evidence)),
        h('td', { class: 'controls' }, ...chips, r.key === '*' ? h('div', { style: 'margin-top:4px' },
          h('button', { class: 'small', disabled: !canEdit() || (next && next.mode === 'freeze'), title: 'Hold this item’s lift at its current value', onclick: () => setControl(r.item, { mode: 'freeze', lift: r.lift }) }, 'Freeze'),
          h('button', { class: 'small', disabled: !canEdit() || (next && next.mode === 'reject'), title: 'Ignore this item’s learned lift; rank it on base score only', onclick: () => setControl(r.item, { mode: 'reject' }) }, 'Reject'),
          h('button', { class: 'small', disabled: !canEdit() || !next, title: 'Remove the control', onclick: () => setControl(r.item, null) }, 'Clear'),
          h('button', { class: 'small warn', disabled: !canEdit() || Boolean(S.archived), title: 'Discard this item’s evidence and start again from the prior', onclick: () => resetItem(r.item) }, 'Reset'),
        ) : null),
      );
    });
    host.append(h('table', {}, h('thead', {}, thead), h('tbody', {}, ...body)));
  }
  function levelWords(level) { return LEVEL_WORDS[level]; }
  function gridCsv() {
    // W25 V1.01: the download carries the prior document revision its numbers
    // were built with, so an export can be reconciled against the document that
    // was imported. Last, so every column a reader already parses keeps its place.
    const rows = [['item', 'customer_id', 'cell', 'level', 'measurement_basis', 'objective', 'n', 's', 'p_hat', 'p0', 'lift', 'n0', 'evidence', 'prior_p', 'prior_n', 'prior_version']];
    for (const r of gridRows()) rows.push([r.item, r.name, r.key, levelWords(r.level), S.snapshot.measurementBasis || 'served-v1', S.snapshot.objective || 'unit', r.n, r.s, r.p_hat, r.p0, r.lift, r.n0, r.evidence, r.prior ? r.prior.p : '', r.prior ? r.prior.n : '', S.snapshot.priorVersion || 0]);
    download(`lift-${S.scope}-${S.slot}-${S.snapshot ? S.snapshot.version : 'none'}.csv`, csv(rows));
  }
  function renderExploring() {
    const host = clear($('exploring'));
    const ex = (dials().exploration) || null;
    const floor = ex ? ex.floor : 50;
    const rows = S.snapshot ? Object.entries(S.snapshot.items || {}).map(([item, byKey]) => ({ item, n: (byKey['*'] || { n: 0 }).n })).filter((r) => r.n < floor).sort((a, b) => a.n - b.n) : [];
    const rep = S.report && S.report.exploration ? S.report.exploration.find((e) => e.slot === S.slot) : null;
    // W28.W1.01: this panel states the mode the ENGINE RAN. A retained setting the
    // engine will not run (Thompson is withdrawn — doc 22 §7) is named as the
    // dormant setting it is, in the same words the editor below uses, and is never
    // presented as the live mode with a share and a floor it is not spending.
    const retained = ex && SUPPORTED_EXPLORATION.indexOf(ex.mode) < 0 ? ex : null;
    const live = retained ? null : ex;
    host.append(h('div', { class: 'kv' },
      h('span', { class: 'k' }, 'Mode'), h('span', { class: 'v' }, live && live.mode !== 'off' ? `${live.mode}, share ${pct(live.share)}, floor ${live.floor} observations`
        : retained ? 'off (the retained setting is dormant)' : 'off'),
      retained ? [h('span', { class: 'k' }, 'Retained setting'),
        h('span', { class: 'v' }, `${storedModeWords(retained.mode)}; this slot explored nothing. Choose a supported mode in the dials below to replace it.`)] : null,
      h('span', { class: 'k' }, 'Realized share'), h('span', { class: 'v' }, rep ? `${pct(rep.realized)} of ${rep.decisions} first-position decisions on ${S.report.date}${rep.configured !== null ? ` (configured ${pct(rep.configured)})` : ''}` : 'build the day report below to measure it'),
      h('span', { class: 'k' }, 'Under the floor'), h('span', { class: 'v' }, rows.length ? `${rows.length} item${rows.length === 1 ? '' : 's'}` : 'none: every served item has reached the floor'),
    ));
    if (rows.length) host.append(h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Item'), h('th', { class: 'num' }, `${S.snapshot.measurementBasis || 'served-v1'} exposures`, h('span', { class: 'sym' }, 'n')), h('th', { class: 'num' }, 'To the floor'))), h('tbody', {}, ...rows.map((r) => h('tr', {}, h('td', {}, h('div', { class: 'itemname' }, nameOf(r.item)), h('div', { class: 'itemid' }, r.item)), h('td', { class: 'num' }, r.n), h('td', { class: 'num' }, r3(floor - r.n)))))));
  }
  function renderReport() {
    reportContext();
    if (S.draft) renderExploring();
    const host = clear($('report'));
    const pre = clear($('report-presets'));
    pre.append(h('span', { style: 'color:var(--ink-soft)' }, 'Overlays:'), ...presets().map((p) => h('label', {}, h('input', { type: 'checkbox', 'data-name': p.name, checked: true }), p.name)));
    $('report-csv').disabled = !S.report;
    host.append(h('div', { class: 'msg' }, 'Attribution diagnostics: credited outcomes per content-item decision. Repeated outcomes can produce more than one credit per decision. Experimental inference is unavailable; these counts do not establish business lift. Source coverage, outcome maturity and policy compatibility are not established by a report.'));
    if (S.reportError) host.append(h('div', { class: 'msg err' }, S.reportError));
    host.append(h('button', { disabled: S.reportLoading, onclick: () => loadReport($('report-date').value) }, 'Reload first page'));
    if (!S.report) { host.append(h('div', { class: 'empty' }, 'No report for this day yet.')); return; }
    const R = S.report;
    host.append(h('div', { class: 'kv' },
      h('span', { class: 'k' }, 'Day'), h('span', { class: 'v' }, `${R.date}, built ${when(R.builtAt)}`),
      h('span', { class: 'k' }, 'Read'), h('span', { class: 'v' }, `${R.counts.decisions} decisions, ${R.counts.outcomes} outcomes, ${R.counts.visitors} visitors${R.counts.truncated ? ' (incomplete coverage)' : ''}`),
      h('span', { class: 'k' }, 'Credits'), h('span', { class: 'v' }, R.policies.map((p) => `${p.name} ${p.credits}`).join(' · ')),
    ));
    if (R.hours && R.hours.missing.length) host.append(h('div', { class: 'msg' }, `Incomplete coverage: ${R.hours.missing.length} missing hours (${R.hours.missing.join(', ')}).`));
    const coverage = R.coverage && R.coverage.version === 1 ? R.coverage : null;
    host.append(h('div', { class: 'msg' }, 'Outcome maturity: unknown. Source completeness is not established.'));
    if (!coverage || coverage.metadata !== 'recorded') host.append(h('div', { class: 'msg' }, 'Coverage metadata absent or invalid; historical last-hour horizon is not a minimum.'));
    if (coverage) {
      for (const [key, label] of [['missingHours', 'Missing hours'], ['truncatedHours', 'Truncated hours'], ['unadvancedHours', 'Ring progress not advanced for hours'], ['unknownHours', 'Unknown hour metadata']]) {
        if (Array.isArray(coverage[key]) && coverage[key].length) host.append(h('div', { class: 'msg' }, `${label}: ${coverage[key].join(', ')}.`));
      }
      if (coverage.truncated) host.append(h('div', { class: 'msg' }, 'Source or visitor coverage is incomplete.'));
      if (coverage.visitorsIncomplete === true) host.append(h('div', { class: 'msg' }, 'Visitor coverage is incomplete.'));
      if (Array.isArray(coverage.horizons) && coverage.horizons.length) host.append(h('div', { class: 'msg' }, `Reported hourly horizons: ${Array.from(coverage.horizons, x => x && Number.isInteger(x.hour) && x.hour >= 0 && x.hour < 24 ? `${x.hour}: ${Number.isFinite(x.horizonMs) && x.horizonMs >= 0 ? x.horizonMs / 3600000 + 'h' : 'unknown'}` : 'unknown').join(', ')}.`));
    }
    const horizons = coverage && coverage.horizons;
    const known = coverage && coverage.source === 'aggregates' && coverage.metadata === 'recorded' &&
      Array.isArray(coverage.missingHours) && !coverage.missingHours.length && Array.isArray(coverage.unknownHours) && !coverage.unknownHours.length &&
      Array.isArray(horizons) && horizons.length > 0 && horizons.length <= 24 && Array.from(horizons).every(x => x && Number.isInteger(x.hour) && x.hour >= 0 && x.hour < 24 && Number.isFinite(x.horizonMs) && x.horizonMs >= 0) && new Set(horizons.map(x => x.hour)).size === horizons.length &&
      (!R.hours || (Array.isArray(R.hours.missing) && !R.hours.missing.length && Array.isArray(R.hours.built) && R.hours.built.length === horizons.length && R.hours.built.every(hour => horizons.some(x => x.hour === hour))));
    host.append(h('div', { class: 'msg' }, known
      ? `Minimum reported contributing horizon: ${Math.min(...horizons.map(x => x.horizonMs)) / 3600000}h; not a completeness guarantee.` : 'Minimum contributing horizon: unknown.'));
    if (coverage && Array.isArray(coverage.unadvancedHours) && coverage.unadvancedHours.length) host.append(h('div', { class: 'msg' }, 'Unadvanced ring progress does not mean every reported credit is wrong.'));
    const grid = R.grids[S.slot];
    if (!grid) { host.append(h('div', { class: 'empty' }, `No decisions for ${S.slot} on that day.`)); return; }
    const names = R.policies.map((p) => p.name);
    const items = [...new Set(names.flatMap((n) => Object.keys((grid[n] || {}).items || {})))].sort();
    const cell = (n, item, f) => { const st = (((grid[n] || {}).items || {})[item] || {})['*']; return st ? st[f] : ''; };
    const page = S.reportPage;
    host.append(h('div', { class: 'pager', 'data-report-pager': true }, `${page.total} items, showing ${page.total ? page.offset + 1 : 0} to ${Math.min(page.total, page.offset + page.limit)}${S.customReport ? ' · response-only custom report' : ' · saved canonical report'}`,
      h('button', { disabled: page.previous === null || S.reportLoading, onclick: () => loadReport($('report-date').value, page.previous) }, 'Previous'),
      h('button', { disabled: page.next === null || S.reportLoading, onclick: () => loadReport($('report-date').value, page.next) }, 'Next')));
    host.append(h('div', { class: 'subhead' }, 'Items under each policy, the pooled row'));
    host.append(h('div', { class: 'msg' }, 'The learning multiplier adjusts ranking scores; it is not measured business lift.'));
    host.append(h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Item'), ...names.flatMap((n) => [h('th', { class: 'num' }, `${n}: ${(grid[n] || {}).measurementBasis || 'served-v1'} exposures`, h('span', { class: 'sym' }, 'n')), h('th', { class: 'num' }, `Weighted credits (${(grid[n] || {}).objective || 'unit'})`, h('span', { class: 'sym' }, 's')), h('th', { class: 'num' }, `Per exposure (${(grid[n] || {}).objective || 'unit'})`, h('span', { class: 'sym' }, 'p̂')), h('th', { class: 'num' }, 'Learning multiplier')]))),
      h('tbody', {}, ...items.map((item) => h('tr', {}, h('td', {}, h('div', { class: 'itemname' }, nameOf(item)), h('div', { class: 'itemid' }, item)), ...names.flatMap((n) => [h('td', { class: 'num' }, cell(n, item, 'n')), h('td', { class: 'num' }, cell(n, item, 's')), h('td', { class: 'num' }, cell(n, item, 'p_hat')), h('td', { class: 'num' }, h('strong', {}, cell(n, item, 'lift')))])))),
    )));
    const arms = R.holdout[S.slot] || [];
    if (arms.length) {
      host.append(h('div', { class: 'subhead' }, 'Recorded arms, under the learning policy'));
      // Recompute from raw counts even when an older server sends rates or comparisons.
      host.append(h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Arm'), h('th', { class: 'num' }, 'Decisions'), h('th', { class: 'num' }, 'Credited outcomes'), h('th', { class: 'num' }, 'Credits per decision'))), h('tbody', {}, ...arms.map((a) => h('tr', {}, h('td', {}, a.arm), h('td', { class: 'num' }, a.decisions), h('td', { class: 'num' }, a.credited), h('td', { class: 'num' }, a.decisions > 0 ? r3(a.credited / a.decisions) : '—'))))));
    }
  }
  async function reportCsv() {
    reportContext(); if (!S.report) return;
    const key = S.reportKey, generation = S.reportGeneration, slot = S.slot;
    let R = S.customReport;
    if (!R) {
      const { ok, status, data } = await json(v1(`/learn/report?date=${encodeURIComponent($('report-date').value)}&brand=${encodeURIComponent(S.brand)}&revision=${encodeURIComponent(S.reportPage.revision)}`)).catch(() => ({ ok: false, status: 0, data: {} }));
      if (key !== reportKey() || generation !== S.reportGeneration) return;
      if (!ok || data.ok !== true || !reportOwner(data.report)) {
        S.reportError = status === 409 ? 'Report changed. Reload the first page before exporting.' : 'Could not export the full report.';
        if (status === 409) { S.report = null; S.reportPage = null; } renderReport(); return;
      }
      R = data.report;
    }
    const grid = R.grids[S.slot] || {};
    const names = R.policies.map((p) => p.name);
    const rows = [['item', 'customer_id', 'policy', 'cell', 'measurement_basis', 'objective', 'n', 's', 'p_hat', 'p0', 'lift']];
    for (const n of names) for (const [item, byKey] of Object.entries((grid[n] || {}).items || {})) for (const [key, st] of Object.entries(byKey)) rows.push([item, nameOf(item), n, key, grid[n].measurementBasis || 'served-v1', grid[n].objective || 'unit', st.n, st.s, st.p_hat, st.p0, st.lift]);
    if (key === reportKey() && generation === S.reportGeneration) download(`report-${S.scope}-${slot}-${R.date}.csv`, csv(rows));
  }
  function renderHistory() {
    const ph = clear($('proposals'));
    ph.append(h('div', { class: 'msg' }, 'Autonomy is unavailable. Historical proposals are read-only and unverified; this bounded listing is not a complete audit trail.'));
    if (S.proposalsError) ph.append(h('div', { class: 'empty' }, S.proposalsError));
    else if (!S.proposals || !S.proposals.length) ph.append(h('div', { class: 'empty' }, 'No historical proposals returned.'));
    else for (const p of [...S.proposals].reverse().slice(0, 12)) {
      const ev = (p.evidence || [])[0];
      ph.append(h('div', { class: 'prop' },
        h('div', { class: 'top' }, h('span', { class: 'n' }, p.slot), h('span', { class: 'st' }, `stored status (unverified): ${p.status}`), h('span', { class: 'meta' }, when(p.at))),
        h('div', {}, `${p.dimension}: ${p.from} → ${p.to}`, ev ? ` · stored ${ev.dimension} spread ${ev.spread}` : '', ` · ${Math.round(p.exposures)} exposures recorded · ${p.mode}`),
        p.note ? h('div', { class: 'ev' }, p.note) : null,
      ));
    }
    const lh = clear($('learn-history'));
    if (!S.learnHistory.length) lh.append(h('div', { class: 'empty' }, 'Nothing stored yet: this scope runs on the compiled defaults.'));
    for (const r of [...S.learnHistory].sort((a, b) => b.revision - a.revision).slice(0, 12)) {
      const isCurrent = r.revision === S.learnRevision;
      const d = S.diffs[r.revision];
      lh.append(h('div', { class: 'rev' },
        h('div', { class: 'top' }, h('span', { class: 'n' }, `r${r.revision}`), r.version ? h('span', { class: 'v' }, r.version) : null, isCurrent ? h('span', { class: 'chip pending' }, 'in force') : null),
        h('div', { class: 'meta' }, `${r.actor || 'unknown'} · ${when(r.at)}`),
        r.note ? h('div', { class: 'note' }, r.note) : null,
        h('div', {}, !isCurrent ? h('button', { class: 'link', onclick: () => showDiff(r.revision) }, d ? 'Hide the diff' : 'Diff against the document in force') : null, ' ', !isCurrent ? h('button', { class: 'link', disabled: !canEdit(), title: canEdit() ? '' : 'Sign in to roll back', onclick: () => rollback(r.revision) }, 'Roll back to this') : null),
        d ? h('div', { class: 'diff' },
          h('div', { style: 'color:var(--ink-soft);margin-bottom:4px' }, `Compared with r${S.learnRevision}, the revision in force. Nothing changes until you roll back.`),
          ...(d.length ? d.map((x) => h('div', {}, h('span', {}, `${x.path}: `), h('span', { class: 'del' }, `in force ${JSON.stringify(x.to)}`), ' · ', h('span', { class: 'add' }, `r${r.revision} ${JSON.stringify(x.from)}`))) : [h('div', {}, 'Identical content: this revision and the one in force say the same thing.')])) : null,
      ));
    }
    const vh = clear($('lift-history'));
    if (!S.liftHistory.length) vh.append(h('div', { class: 'empty' }, 'No archived snapshots for this slot yet; every publish from now on is archived by version.'));
    for (const v of S.liftHistory.slice(0, 12)) vh.append(h('div', { class: 'rev' }, h('div', { class: 'top' }, h('span', { class: 'n' }, when(v.version)), h('span', { class: 'v' }, `v${v.version}`), S.archived === v.version ? h('span', { class: 'chip pending' }, 'viewing') : null), h('div', { class: 'meta' }, `${(v.size / 1024).toFixed(1)} KB`), h('button', { class: 'link', onclick: async () => { S.archived = v.version; await loadLift(); render(); } }, 'View this snapshot in the grid')));
    const prh = clear($('prior-history'));
    if (!S.priorHistory.length) prh.append(h('div', { class: 'empty' }, 'No priors imported for this scope. PUT /content/priors takes JSON rows or the CSV a warehouse exports.'));
    for (const r of [...S.priorHistory].sort((a, b) => b.revision - a.revision).slice(0, 8)) prh.append(h('div', { class: 'rev' }, h('div', { class: 'top' }, h('span', { class: 'n' }, `r${r.revision}`), r.version ? h('span', { class: 'v' }, r.version) : null), h('div', { class: 'meta' }, `${r.actor || 'unknown'} · ${when(r.at)}`), r.note ? h('div', { class: 'note' }, r.note) : null));
  }
  async function showDiff(n) {
    if (S.diffs[n]) { delete S.diffs[n]; render(); return; }
    const { data } = await json(api(`/learn/revisions/${n}`));
    const doc = data.value || data.document || null;
    S.diffs[n] = doc ? diffPaths(S.learn, doc).map((x) => ({ path: x.path, from: x.to, to: x.from })) : [];
    render();
  }

  // ---------- dials ----------
  /** Append only what is there: a conditional row that is null must not become the word "null" on the page. */
  function put(host, ...items) { host.append(...items.flat().filter((x) => x !== null && x !== undefined && x !== false)); }
  function dial(name, help, control, derived) {
    return h('div', { class: 'dial' }, h('div', {}, h('div', { class: 'name' }, name), h('div', { class: 'help' }, help), derived ? h('div', { class: 'derived' }, derived) : null), control);
  }
  function changedClass(path) { return changes().some((c) => c.path === path || c.path.startsWith(`${path}.`)) ? ' changed' : ''; }
  function num(value, onChange, path, opts = {}) {
    const el = h('input', { class: `num${changedClass(path)}`, type: 'number', step: opts.step || 'any', min: opts.min, max: opts.max, value: value === undefined || value === null ? '' : value, disabled: !canEdit() });
    el.addEventListener('input', () => { const v = el.value === '' ? undefined : Number(el.value); onChange(Number.isFinite(v) ? v : undefined); });
    return el;
  }
  function sel(value, options, onChange, path) {
    const el = h('select', { class: changedClass(path), disabled: !canEdit() }, ...options.map(([v, label, disabled]) => h('option', { value: v, disabled: !!disabled, selected: String(v) === String(value) }, label)));
    el.addEventListener('change', () => onChange(el.value));
    return el;
  }
  function txt(value, onChange, path, placeholder) {
    const el = h('input', { class: `txt${changedClass(path)}`, value: value || '', placeholder, disabled: !canEdit() });
    el.addEventListener('input', () => onChange(el.value));
    return el;
  }
  function renderSlotDials() {
    const host = clear($('dials-slot'));
    if (!S.slot) { host.append(h('div', { class: 'empty' }, 'No slots configured for this scope.')); return; }
    const d = dials(); const base = `slots.${S.slot}`;
    const gamma = d.gamma ?? 0;
    put(host,
      dial('γ, the trust dial', 'How much the learned lift moves the score: score_final = score_base × lift^γ. At 0 the lift is computed and shown on every receipt and changes nothing; at 1 it applies in full.', num(d.gamma, (v) => { if (v === undefined) delete d.gamma; else d.gamma = v; scheduleCheck(); }, `${base}.gamma`, { min: 0, max: 1, step: 0.05 }), gamma === 0 ? 'Shadow: learning is visible and inert.' : `A lift of 1.4 becomes ×${r3(Math.pow(1.4, gamma))} on the score.`),
      dial('Reward', 'The outcome this slot learns against. One reward per slot; the others still land in the ledger.', sel(d.reward || 'click', REWARDS.map((r) => [r, r.replace('_', ' ')]), (v) => { d.reward = v; scheduleCheck(); }, `${base}.reward`)),
      dial('Objective', 'What a success is worth. Unit counts it; revenue weighs it by the order value; margin by the margin the feed gives, or the value when it gives none. Revenue and margin need a reward that carries a value: purchase or add to bag.', sel(d.objective || 'unit', [['unit', 'unit'], ['revenue', 'revenue'], ['margin', 'margin']], (v) => { if (v === 'unit') delete d.objective; else d.objective = v; scheduleCheck(); }, `${base}.objective`)),
      dial('Measurement basis', 'Legacy served-v1 and client-reported rendered-v1 are separate counters and prior bases. A populated change requires the reviewed reset/publication flow; render ACK is not visibility proof.', sel(d.measurementBasis || 'served-v1', [['served-v1', 'legacy served'], ['rendered-v1', 'client-reported rendered']], (v) => { d.measurementBasis = v; scheduleCheck(); }, `${base}.measurementBasis`)),
      h('div', { class: 'subhead' }, 'Exploration'),
      dial('Mode', 'Exploration is off by default. Rotation serves the least-observed item on a hashed share; epsilon is uniform. Thompson is unsupported and stored settings are dormant.', sel(d.exploration?.mode === 'thompson' ? '' : d.exploration?.mode || 'off', [...(d.exploration?.mode === 'thompson' ? [['', 'Stored Thompson — inactive; choose a replacement', true]] : []), ['off', 'off'], ['rotation', 'rotation'], ['epsilon', 'epsilon']], (v) => { if (v === 'off') delete d.exploration; else d.exploration = { mode: v, share: (d.exploration || {}).share ?? 0.1, floor: (d.exploration || {}).floor ?? 50 }; scheduleCheck(); }, `${base}.exploration.mode`)),
      d.exploration?.mode === 'thompson' ? h('pre', { class: 'dormant-exploration' }, JSON.stringify(d.exploration, null, 2)) : null,
      d.exploration && d.exploration.mode !== 'thompson' ? dial('Share', 'The configured share used by the existing exploration rule; not a measured exposure guarantee.', num(d.exploration.share, (v) => { d.exploration.share = v ?? 0; scheduleCheck(); }, `${base}.exploration.share`, { min: 0, max: 1, step: 0.01 }), `${pct(d.exploration.share)} configured share`) : null,
      d.exploration && d.exploration.mode !== 'thompson' ? dial('Floor', 'Observations below which an item counts as under-observed and is worth exploring.', num(d.exploration.floor, (v) => { d.exploration.floor = v ?? 0; scheduleCheck(); }, `${base}.exploration.floor`, { min: 0, step: 1 })) : null,
      h('div', { class: 'subhead' }, 'Autonomy unavailable'),
      h('div', { class: 'msg' }, 'Stored settings are dormant. Cycles and proposal changes are disabled.'),
      h('pre', { class: 'dormant-autonomy' }, JSON.stringify(d.autonomy || { mode: 'configured' }, null, 2)),
      h('div', { class: 'subhead' }, 'Their model'),
      dial('Weight, w_ext', 'How much this slot trusts their model: w_ext × score joins the base score as a driver named external. 0 means the term is off for this slot. The model itself is configured below, for every slot.', num((d.external || {}).weight, (v) => { if (v === undefined || v === 0) delete d.external; else d.external = { weight: v }; scheduleCheck(); }, `${base}.external.weight`, { min: 0, max: 1, step: 0.05 }), S.draft.external ? `${S.draft.external.kind} · ${S.draft.external.ref}` : 'No model configured for this scope.'),
    );
  }
  function renderGlobalDials() {
    const host = clear($('dials-global'));
    const D = S.draft;
    D.holdout = D.holdout || { share: 0.05, salt: '', arms: ['default'] };
    const pol = D.policy || null;
    const st = D.stats || null;
    const reg = D.regional || null;
    const ext = D.external || null;
    put(host,
      h('div', { class: 'subhead' }, 'Holdout'),
      dial('Share', 'The fraction of visitors held out of learning, assigned by a stable hash. The default arm sees the site’s own defaults; a no_learning arm sees personalization without lift.', num(D.holdout.share, (v) => { D.holdout.share = v ?? 0; scheduleCheck(); }, 'holdout.share', { min: 0, max: 1, step: 0.01 }), `${pct(D.holdout.share)} of visitors`),
      dial('Arms', 'Which comparison arms exist beside the personalized one.', sel(D.holdout.arms.includes('no_learning') ? 'both' : 'default', [['default', 'default only'], ['both', 'default and no_learning']], (v) => { D.holdout.arms = v === 'both' ? ['default', 'no_learning'] : ['default']; scheduleCheck(); }, 'holdout.arms')),
      h('div', { class: 'subhead' }, 'Attribution policy the engine learns with'),
      dial('Scope', 'Session: an outcome may credit decisions in the same session only. Visitor: any of the visitor’s recent decisions.', sel(pol ? pol.scope : 'session', [['session', 'session'], ['visitor', 'visitor']], (v) => { D.policy = { ...(pol || { match: 'direct', credit: 'last', windowsMs: {} }), scope: v }; scheduleCheck(); }, 'policy.scope')),
      dial('Match', 'Direct: the outcome must name the item that was served. Any: any decision in scope and window is eligible.', sel(pol ? pol.match : 'direct', [['direct', 'direct'], ['any', 'any']], (v) => { D.policy = { ...(pol || { scope: 'session', credit: 'last', windowsMs: {} }), match: v }; scheduleCheck(); }, 'policy.match')),
      dial('Credit', 'Which eligible decision is paid: the last before the outcome, or the first.', sel(pol ? pol.credit : 'last', [['last', 'last touch'], ['first', 'first touch']], (v) => { D.policy = { ...(pol || { scope: 'session', match: 'direct', windowsMs: {} }), credit: v }; scheduleCheck(); }, 'policy.credit')),
      ...REWARDS.map((r) => dial(`Window, ${r.replace('_', ' ')}`, 'How long after a decision this outcome may still credit it, in minutes.', num(Math.round((((pol || {}).windowsMs || {})[r] ?? DEFAULT_WINDOWS[r]) / MIN), (v) => { D.policy = pol || { scope: 'session', match: 'direct', credit: 'last', windowsMs: {} }; D.policy.windowsMs = D.policy.windowsMs || {}; if (v === undefined) delete D.policy.windowsMs[r]; else D.policy.windowsMs[r] = v * MIN; scheduleCheck(); }, `policy.windowsMs.${r}`, { min: 1, step: 1 }), humanMs(((pol || {}).windowsMs || {})[r] ?? DEFAULT_WINDOWS[r]))),
      h('div', { class: 'subhead' }, 'The estimator'),
      dial('n₀, prior strength', 'How many observations the slot’s own rate is worth when an item’s estimate is shrunk toward it. An imported prior brings its own strength.', num(st ? st.n0 : 30, (v) => { D.stats = { ...(st || { tauLearnMs: 21 * DAY, liftMin: 0.5, liftMax: 2, nMin: 30 }), n0: v ?? 30 }; scheduleCheck(); }, 'stats.n0', { min: 1, step: 1 })),
      dial('τ, the learning horizon', 'Days over which evidence decays by e: what happened this long ago counts about a third.', num(st ? r3(st.tauLearnMs / DAY) : 21, (v) => { D.stats = { ...(st || { n0: 30, liftMin: 0.5, liftMax: 2, nMin: 30 }), tauLearnMs: (v ?? 21) * DAY }; scheduleCheck(); }, 'stats.tauLearnMs', { min: 1, step: 1 })),
      dial('Lift clamp', 'The least and the most a learned lift may be, min and max. A clamp of 0.5 and 2 lets learning halve or double a score, never more.', h('div', {}, num(st ? st.liftMin : 0.5, (v) => { D.stats = { ...(st || { n0: 30, tauLearnMs: 21 * DAY, liftMax: 2, nMin: 30 }), liftMin: v ?? 0.5 }; scheduleCheck(); }, 'stats.liftMin', { min: 0.01, max: 1, step: 0.05 }), num(st ? st.liftMax : 2, (v) => { D.stats = { ...(st || { n0: 30, tauLearnMs: 21 * DAY, liftMin: 0.5, nMin: 30 }), liftMax: v ?? 2 }; scheduleCheck(); }, 'stats.liftMax', { min: 1, step: 0.1 }))),
      dial('n_min, the evidence threshold', 'Exposures a cell must have before its own estimate answers; below it the next coarser cell answers, up to everyone. An imported prior counts its strength toward it.', num(st ? st.nMin : 30, (v) => { D.stats = { ...(st || { n0: 30, tauLearnMs: 21 * DAY, liftMin: 0.5, liftMax: 2 }), nMin: v ?? 30 }; scheduleCheck(); }, 'stats.nMin', { min: 1, step: 1 })),
      h('div', { class: 'subhead' }, 'The regional prior'),
      dial('Blend', 'Whether what is trending among shoppers in the visitor’s region is blended into the base score as a prior, itemized on the receipt.', sel(reg && reg.enabled ? 'on' : 'off', [['on', 'on'], ['off', 'off']], (v) => { D.regional = { ...(reg || { kBlend: 1, minEvents: 30 }), enabled: v === 'on' }; scheduleCheck(); }, 'regional.enabled')),
      reg && reg.enabled ? dial('K, the blend constant', 'λ = K / (K + the visitor’s own interest). A brand-new visitor is decided on the region alone; K sets how much of her own signal it takes to outweigh it.', num(reg.kBlend, (v) => { D.regional = { ...reg, kBlend: v ?? 1 }; scheduleCheck(); }, 'regional.kBlend', { min: 0.01, max: 100, step: 0.1 })) : null,
      reg && reg.enabled ? dial('Minimum events', 'Events a region needs before its trend is used; below it the country answers, then everyone.', num(reg.minEvents, (v) => { D.regional = { ...reg, minEvents: v ?? 30 }; scheduleCheck(); }, 'regional.minEvents', { min: 1, step: 1 })) : null,
      h('div', { class: 'subhead' }, 'Their model, for every slot'),
      dial('Kind', 'Service: a Worker they own behind a service binding, or an https URL. Table: a scoring table they publish to KV. Workers AI: a hosted model that answers in the contract’s JSON.', sel(ext ? ext.kind : 'none', [['none', 'none'], ['service', 'service'], ['table', 'table'], ['workers_ai', 'workers_ai']], (v) => { if (v === 'none') delete D.external; else D.external = { kind: v, ref: (ext || {}).ref || '', timeoutMs: (ext || {}).timeoutMs || 20, fallback: 'omit' }; scheduleCheck(); }, 'external.kind')),
      ext ? dial('Ref', 'The binding name, the KV table key, the model id, or the URL.', txt(ext.ref, (v) => { D.external = { ...ext, ref: v }; scheduleCheck(); }, 'external.ref', 'MODEL, or https://…')) : null,
      ext ? dial('Budget', 'Milliseconds the call may take, in parallel with the engine’s own reads. Past it the term is omitted and the receipt says so.', num(ext.timeoutMs, (v) => { D.external = { ...ext, timeoutMs: v ?? 20 }; scheduleCheck(); }, 'external.timeoutMs', { min: 1, max: 5000, step: 1 })) : null,
    );
  }
  function renderMessages() {
    const host = clear($('messages'));
    if (S.flash) host.append(h('div', { class: 'msg ok' }, S.flash));
    for (const [key, p] of pendingPublications) if (p.scope === S.scope) host.append(h('div', { class: 'msg err' },
      'Original intent retained: ' + p.headers['Idempotency-Key'] + '. ',
      h('button', { onclick: () => publicationStatus(key, false) }, 'Check status'), ' ',
      h('button', { onclick: () => publicationStatus(key, true) }, 'Recover original'), ' ',
      h('button', { onclick: async () => { const r = await request(p.url, { method: p.method, headers: p.headers, body: p.body });
        S.errors = [r.ok ? 'Original operation acknowledged; reload before a new edit.' : 'Original acknowledgement remains unresolved.']; render(); } }, 'Retry exact original'),
      p.conflicted ? h('button', { onclick: () => {
        if (confirm('Discard this definitively conflicted local draft? Reload the authoritative document before authoring a replacement.')) {
          try { removePending(key); S.errors = ['Conflicted draft discarded. Reload before authoring a replacement.']; } catch { S.errors = ['Local completion unavailable; original draft retained.']; }
          render();
        }
      } }, 'Discard conflicted draft') : null));
    if (S.errors.length) host.append(h('div', { class: 'msg err' }, 'The document as drafted was refused:', h('ul', {}, ...S.errors.map((e) => h('li', {}, e)))));
    if (!canEdit()) host.append(h('div', { class: 'msg', style: 'background:var(--tan-wash);border:1px solid var(--line-strong)' }, 'Read-only. Sign in at the top right to change the dials and item controls, or to build a report.'));
  }
  function renderBar() {
    const sl = $('slot');
    if (sl.options.length !== S.slots.length) { clear(sl); for (const s of S.slots) sl.append(h('option', { value: s.slot }, `${s.slot}${s.pinned ? ' (pinned)' : ''} · ${s.page}`)); }
    sl.value = S.slot;
    $('brand').value = S.brand;
    $('source').textContent = S.learnSource === 'stored' ? `learn r${S.learnRevision}` : 'compiled default';
    $('source').className = `badge ${S.learnSource === 'stored' ? 'stored' : 'compiled'}`;
    $('stamp').textContent = S.snapshot ? `snapshot ${when(S.snapshot.publishedAt)}` : 'no snapshot';
    const n = changes().length;
    $('changecount').textContent = n ? `${n} change${n === 1 ? '' : 's'}${S.checking ? ', checking…' : ''}` : 'No changes';
    $('save').disabled = !n || !canEdit() || S.errors.length > 0 || S.checking;
  }
  function render() { reportContext(); renderBar(); renderMessages(); renderGrid(); renderReport(); renderHistory(); renderSlotDials(); renderGlobalDials(); renderSession(); renderAccounts(); renderAudit(); }

  // ---------- wiring ----------
  $('report-date').value = new Date().toISOString().slice(0, 10);
  // The sign-in. A person signs in once; the session renews itself; signing out ends it. What the page may
  // read changes with it (the grid, the archive, the proposals, the report all need it under enforced
  // access), so everything loads again after either.
  function renderSession() {
    const on = Boolean(window.OperatorSession && OperatorSession.signedIn());
    const u = on ? OperatorSession.user() : null;
    $('who').textContent = u ? `Signed in as ${u.name || u.email}` : '';
    $('sign-in').hidden = on; $('sign-out').hidden = !on; $('change-password').hidden = !on;
    if (on) $('sign-in-form').hidden = true;
    // A temporary password is for one sign-in: the person chooses their own before anything else.
    const must = on && OperatorSession.mustChangePassword();
    if (must) { $('password-form').hidden = false; $('pw-note').textContent = 'You signed in with a temporary password. Choose your own to continue.'; }
    else if (!on) { $('password-form').hidden = true; }
    const admin = on && OperatorSession.isAdmin();
    $('accounts-section').hidden = !admin;
    if (!admin) { S.accounts = null; }
  }
  $('change-password').addEventListener('click', () => { $('password-form').hidden = false; $('pw-note').textContent = ''; $('pw-error').textContent = ''; $('pw-current').focus(); });
  $('pw-cancel').addEventListener('click', () => { if (!(window.OperatorSession && OperatorSession.mustChangePassword())) $('password-form').hidden = true; });
  $('password-form').addEventListener('submit', async (e) => {
    e.preventDefault(); $('pw-submit').disabled = true; $('pw-error').textContent = '';
    try {
      await OperatorSession.changePassword($('pw-current').value, $('pw-new').value);
      $('pw-current').value = ''; $('pw-new').value = ''; $('password-form').hidden = true;
      flash('Your password is changed.'); renderSession();
    } catch (err) { $('pw-error').textContent = err && err.message ? err.message : 'The password was not changed.'; }
    finally { $('pw-submit').disabled = false; }
  });

  // ---------- accounts, an admin's ----------
  S.accounts = null; S.audit = null;
  async function loadAccounts() {
    if (!(window.OperatorSession && OperatorSession.isAdmin())) { S.accounts = null; S.audit = null; return; }
    const [users, audit] = await Promise.all([json('/auth/users'), json('/auth/audit?limit=30')]);
    S.accounts = users.ok ? users.data.users || [] : null;
    S.audit = audit.ok ? audit.data.entries || [] : null;
  }
  const ACTION_WORDS = { sign_in: 'signed in', sign_in_failed: 'failed to sign in', sign_in_locked: 'was locked out for ten minutes', sign_out: 'signed out', password_changed: 'changed the password of', account_created: 'created the account', account_reset: 'reset the password of', account_disabled: 'disabled', account_enabled: 'enabled', account_changed: 'changed', account_removed: 'removed', account_migrated: 'moved to the accounts database' };
  function renderAudit() {
    const host = clear($('account-audit'));
    if (!(window.OperatorSession && OperatorSession.isAdmin())) return;
    if (!S.audit) { host.append(h('div', { class: 'empty' }, 'Could not read the activity.')); return; }
    if (!S.audit.length) { host.append(h('div', { class: 'empty' }, 'Nothing yet.')); return; }
    host.append(h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Who'), h('th', {}, 'Did what'), h('th', {}, 'Account'))), h('tbody', {}, ...S.audit.map((e) => h('tr', {},
      h('td', {}, when(e.at)),
      h('td', {}, e.actorEmail || (e.action.startsWith('sign_in') ? e.targetEmail || '' : 'the platform')),
      h('td', {}, ACTION_WORDS[e.action] || e.action),
      h('td', {}, e.action === 'sign_in' || e.action === 'sign_out' ? '' : (e.targetEmail || '')),
    )))));
  }
  function notice(html) { const host = clear($('account-notice')); if (html) host.append(h('div', { class: 'msg ok', html })); }
  const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  function renderAccounts() {
    const host = clear($('accounts'));
    if (!(window.OperatorSession && OperatorSession.isAdmin())) return;
    if (!S.accounts) { host.append(h('div', { class: 'empty' }, 'Could not read the accounts.')); return; }
    const me = OperatorSession.user() || {};
    const rows = S.accounts.map((a) => {
      const state = a.disabled ? 'disabled' : a.mustChangePassword ? 'temporary password, not yet changed' : 'active';
      const act = async (label, run) => { try { await run(); await loadAccounts(); renderAccounts(); renderAudit(); } catch (err) { notice(`<strong>${esc(label)} did not go through.</strong> ${esc(err && err.message ? err.message : '')}`); } };
      const call = async (method, path, body) => { const r = await json(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); if (!r.ok) throw new Error(r.data.error || `${method} ${path} answered ${r.status}`); return r.data; };
      const self = a.id === me.id;
      return h('tr', {},
        h('td', {}, h('div', { class: 'itemname' }, a.email), h('div', { class: 'itemid' }, a.name)),
        h('td', {}, (a.roles || []).join(', ')),
        h('td', {}, state),
        h('td', {}, a.lastSignInAt ? when(a.lastSignInAt) : 'never'),
        h('td', {},
          h('button', { class: 'small', title: 'A new temporary password, shown once; ends their sessions', onclick: () => act('Reset', async () => { const d = await call('POST', `/auth/users/${encodeURIComponent(a.id)}/reset`); notice(`<strong>Temporary password for ${esc(a.email)}:</strong> <code>${esc(d.temporaryPassword)}</code>. Give it to them in person; it is shown once. They choose their own at their next sign-in.`); }) }, 'Reset password'), ' ',
          self ? null : h('button', { class: 'small', onclick: () => act(a.disabled ? 'Enable' : 'Disable', async () => { await call('PATCH', `/auth/users/${encodeURIComponent(a.id)}`, { disabled: !a.disabled }); notice(''); }) }, a.disabled ? 'Enable' : 'Disable'), ' ',
          self ? null : h('button', { class: 'small warn', onclick: () => { if (confirm(`Remove the account ${a.email}? This cannot be undone.`)) act('Remove', async () => { await call('DELETE', `/auth/users/${encodeURIComponent(a.id)}`); notice(''); }); } }, 'Remove'),
        ),
      );
    });
    host.append(h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Account'), h('th', {}, 'Role'), h('th', {}, 'State'), h('th', {}, 'Last sign-in'), h('th', {}, 'Actions'))), h('tbody', {}, ...rows)));
  }
  $('account-form').addEventListener('submit', async (e) => {
    e.preventDefault(); $('acct-submit').disabled = true; $('acct-error').textContent = '';
    try {
      const r = await json('/auth/users', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: $('acct-email').value.trim(), name: $('acct-name').value.trim(), roles: [$('acct-role').value] }) });
      if (!r.ok) throw new Error(r.data.error || 'The account was not created.');
      notice(`<strong>Account created for ${esc(r.data.user.email)}.</strong> Temporary password: <code>${esc(r.data.temporaryPassword)}</code>. Give it to them in person; it is shown once. They choose their own at their first sign-in.`);
      $('acct-email').value = ''; $('acct-name').value = '';
      await loadAccounts(); renderAccounts(); renderAudit();
    } catch (err) { $('acct-error').textContent = err && err.message ? err.message : 'The account was not created.'; }
    finally { $('acct-submit').disabled = false; }
  });
  $('sign-in').addEventListener('click', () => { $('sign-in-form').hidden = false; $('si-error').textContent = ''; $('si-email').focus(); });
  $('si-cancel').addEventListener('click', () => { $('sign-in-form').hidden = true; });
  $('sign-in-form').addEventListener('submit', async (e) => {
    e.preventDefault(); $('si-submit').disabled = true; $('si-error').textContent = '';
    try {
      await OperatorSession.signIn($('si-email').value, $('si-password').value);
      $('si-password').value = ''; $('sign-in-form').hidden = true;
      S.token = await OperatorSession.token(); renderSession();
      await load();
    } catch (err) { $('si-error').textContent = err && err.message ? err.message : 'Sign-in did not go through.'; }
    finally { $('si-submit').disabled = false; }
  });
  $('sign-out').addEventListener('click', async () => { await OperatorSession.signOut(); S.token = ''; renderSession(); await load().catch(() => render()); });
  let reportSession = reportUser();
  if (window.OperatorSession) OperatorSession.onChange(() => { S.token = sessionStorage.getItem('tuning-token') || ''; renderSession(); const next = reportUser(); if (next !== reportSession) { reportSession = next; reportContext(); renderReport(); } });
  renderSession();
  $('slot').addEventListener('change', async (e) => { S.slot = e.target.value; S.archived = null; S.diffs = {}; await Promise.all([loadLift(), loadReport($('report-date').value)]); render(); });
  $('brand').addEventListener('change', async (e) => { S.brand = e.target.value.trim() || S.scope; S.archived = null; await Promise.all([loadLift(), loadReport($('report-date').value)]); render(); });
  $('grid-filter').addEventListener('input', (e) => { S.filter = e.target.value; renderGrid(); });
  $('grid-level').addEventListener('change', (e) => { S.level = e.target.value; renderGrid(); });
  $('grid-csv').addEventListener('click', gridCsv);
  $('report-run').addEventListener('click', runReport);
  $('report-csv').addEventListener('click', reportCsv);
  $('report-date').addEventListener('change', async (e) => { await loadReport(e.target.value); render(); });
  $('save').addEventListener('click', save);
  $('reset').addEventListener('click', () => { S.draft = copy(S.learn); S.errors = []; $('note').value = ''; render(); });
  $('to-tuning').href = `/tuning.html?scope=${encodeURIComponent(S.scope)}`;
  load().catch((e) => { S.errors = [`Could not load the console: ${e && e.message ? e.message : e}`]; render(); });
})();
