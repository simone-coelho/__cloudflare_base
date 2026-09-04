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
    report: null, reportError: '',
    errors: [], flash: '', checking: false,
    sort: { col: 'lift', dir: -1 }, filter: '', level: '0',
    diffs: {},
  };
  const api = (path) => `/content${path}${path.includes('?') ? '&' : '?'}scope=${encodeURIComponent(S.scope)}`;
  const v1 = (path) => `/v1/${encodeURIComponent(S.scope)}${path}`;
  const auth = () => (S.token ? { authorization: `Bearer ${S.token}` } : {});
  const canEdit = () => Boolean(S.token);
  const copy = (v) => JSON.parse(JSON.stringify(v));
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const pct = (x) => `${Math.round(x * 100)}%`;
  const when = (ms) => (ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;
  const DEFAULT_WINDOWS = { click: 30 * MIN, dwell: 30 * MIN, video_complete: 30 * MIN, wishlist: 6 * HOUR, add_to_bag: 6 * HOUR, purchase: 7 * DAY, custom: 30 * MIN };
  const REWARDS = ['click', 'dwell', 'video_complete', 'wishlist', 'add_to_bag', 'purchase', 'custom'];
  const LEVEL_WORDS = ['everyone', 'channel', 'channel and visit', 'channel, visit and region', 'channel, visit, region and affinity'];
  const levelOf = (key) => (key === '*' ? 0 : key.split('|').length);

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
      const res = await fetch(api('/learn/validate'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ document: S.draft }) });
      const data = await res.json();
      S.errors = data.valid ? [] : data.errors || ['The document did not validate.'];
    } catch { S.errors = ['Could not reach the validator.']; }
    S.checking = false; render();
  }
  async function save() {
    const note = $('note').value.trim();
    const res = await fetch(api('/learn'), { method: 'PUT', headers: { 'content-type': 'application/json', ...auth() }, body: JSON.stringify({ document: S.draft, note }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      S.errors = res.status === 401 || res.status === 403 ? ['That token was not accepted. Changes need an operator token.'] : data.errors || ['The save was refused.'];
      render(); return;
    }
    S.learn = data.document; S.draft = copy(S.learn); S.learnRevision = data.revision; S.learnSource = 'stored';
    $('note').value = ''; S.errors = []; flash(`Saved as revision ${data.revision}.`);
    await Promise.all([loadLearnHistory(), loadLift()]); render();
  }
  function flash(text) { S.flash = text; render(); setTimeout(() => { if (S.flash === text) { S.flash = ''; render(); } }, 4000); }

  // ---------- loading ----------
  // Every /v1 read carries the operator token when there is one: under enforced access a verified token passes the SDK gate.
  const json = async (url, init) => { const r = await fetch(url, { ...(init || {}), headers: { ...auth(), ...((init && init.headers) || {}) } }); const d = await r.json().catch(() => ({})); return { ok: r.ok, status: r.status, data: d }; };
  async function loadLearn() {
    const { data } = await json(api('/learn'));
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
    const { ok, status, data } = await json(v1('/learn/proposals'), { headers: auth() });
    if (ok) { S.proposals = data.proposals || []; S.proposalsError = ''; }
    else { S.proposals = null; S.proposalsError = status === 401 || status === 403 ? 'Proposals need an operator token to read.' : 'Could not read the proposals.'; }
  }
  async function loadReport(date) {
    const { ok, data } = await json(v1(`/learn/report?date=${date}&brand=${encodeURIComponent(S.brand)}`));
    S.report = ok ? data.report : null;
  }
  async function load() {
    await loadSlots();
    await Promise.all([loadLearn(), loadLearnHistory(), loadPriorHistory(), loadLift(), loadProposals(), loadReport($('report-date').value)]);
    render();
  }

  // ---------- actions ----------
  async function rollback(n) {
    const res = await fetch(api(`/learn/rollback/${n}`), { method: 'POST', headers: { 'content-type': 'application/json', ...auth() }, body: '{}' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) { S.errors = data.errors || ['The rollback was refused.']; render(); return; }
    flash(`Rolled revision ${n} forward as revision ${data.revision}.`);
    await loadLearn(); await loadLearnHistory(); render();
  }
  async function resetItem(item) {
    if (!confirm(`Discard the evidence for ${nameOf(item)} in ${S.slot} and start again from the prior?`)) return;
    const res = await fetch(v1('/learn/items/reset'), { method: 'POST', headers: { 'content-type': 'application/json', ...auth() }, body: JSON.stringify({ slot: S.slot, item, brand: S.brand }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) { S.errors = [data.error || 'The reset was refused.']; render(); return; }
    flash(data.had ? `Evidence for ${nameOf(item)} discarded; the snapshot republished, recorded as revision ${data.revision}.` : `${nameOf(item)} had no evidence in this slot; recorded as revision ${data.revision}.`);
    await Promise.all([loadLift(), loadLearnHistory()]); render();
  }
  async function decideProposal(id, decision) {
    const res = await fetch(v1(`/learn/proposals/${encodeURIComponent(id)}/${decision}`), { method: 'POST', headers: auth() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) { S.errors = [data.error || `The proposal could not be ${decision === 'apply' ? 'applied' : 'rejected'}.`]; render(); return; }
    flash(decision === 'apply' ? `Proposal applied as slots revision ${data.revision}.` : 'Proposal rejected.');
    await loadProposals(); render();
  }
  function presets() {
    const base = { scope: 'session', match: 'direct', credit: 'last', ...(S.learn.policy || {}) };
    base.windowsMs = { ...DEFAULT_WINDOWS, ...(base.windowsMs || {}) };
    return [
      { name: 'first-touch', ...base, credit: 'first' },
      { name: 'any-item', ...base, match: 'any' },
      { name: 'visitor-scope', ...base, scope: 'visitor' },
      { name: 'purchase-1d', ...base, windowsMs: { ...base.windowsMs, purchase: DAY } },
    ];
  }
  async function runReport() {
    const date = $('report-date').value;
    const chosen = presets().filter((p) => { const box = document.querySelector(`#report-presets input[data-name="${p.name}"]`); return !box || box.checked; });
    const customName = $('custom-name').value.trim();
    if (customName) chosen.push({ name: customName, scope: $('custom-scope').value, match: $('custom-match').value, credit: $('custom-credit').value, windowsMs: presets()[0].windowsMs });
    $('report-run').disabled = true; $('report-run').textContent = 'Building…';
    const res = await fetch(v1('/learn/report'), { method: 'POST', headers: { 'content-type': 'application/json', ...auth() }, body: JSON.stringify({ date, brand: S.brand, policies: chosen }) });
    const data = await res.json().catch(() => ({}));
    $('report-run').disabled = false; $('report-run').textContent = 'Build the report';
    if (!res.ok || !data.ok) { S.reportError = res.status === 401 || res.status === 403 ? 'Building a report needs an operator token.' : data.error || 'The report could not be built.'; S.report = null; render(); return; }
    S.reportError = ''; S.report = data.report; render();
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
    if (S.archived) banner.append(h('div', { class: 'banner' }, `Viewing the archived snapshot published ${when(S.archived)}, not the one in force.`, h('button', { class: 'small', onclick: async () => { S.archived = null; await loadLift(); render(); } }, 'Back to the current snapshot')));
    const rows = gridRows();
    const snap = S.snapshot;
    $('grid-count').textContent = snap ? `${rows.length} row${rows.length === 1 ? '' : 's'} · reward ${snap.reward} · n₀ ${snap.n0}, n_min ${snap.nMin} · published ${when(snap.publishedAt)}${snap.priorVersion ? ` · prior revision ${snap.priorVersion}` : ''}` : '';
    if (!snap) { host.append(h('div', { class: 'empty' }, 'Nothing published for this slot yet. The first snapshot publishes thirty seconds after the first decision it serves.')); return; }
    if (!rows.length) { host.append(h('div', { class: 'empty' }, 'No rows match.')); return; }
    const cols = [['name', 'Item'], ['key', 'Cell'], ['n', 'n'], ['s', 's'], ['p_hat', 'p̂'], ['p0', 'p₀'], ['lift', 'lift'], ['evidence', 'evidence']];
    const thead = h('tr', {}, ...cols.map(([col, label]) => h('th', { class: `sortable${['n', 's', 'p_hat', 'p0', 'lift', 'evidence'].includes(col) ? ' num' : ''}${S.sort.col === col ? ` on${S.sort.dir > 0 ? ' asc' : ''}` : ''}`, onclick: () => { S.sort = { col, dir: S.sort.col === col ? -S.sort.dir : (col === 'name' || col === 'key' ? 1 : -1) }; render(); } }, label)), h('th', {}, 'Controls'));
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
  function gridCsv() {
    const rows = [['item', 'customer_id', 'cell', 'level', 'n', 's', 'p_hat', 'p0', 'lift', 'n0', 'evidence', 'prior_p', 'prior_n']];
    for (const r of gridRows()) rows.push([r.item, r.name, r.key, LEVEL_WORDS[r.level], r.n, r.s, r.p_hat, r.p0, r.lift, r.n0, r.evidence, r.prior ? r.prior.p : '', r.prior ? r.prior.n : '']);
    download(`lift-${S.scope}-${S.slot}-${S.snapshot ? S.snapshot.version : 'none'}.csv`, csv(rows));
  }
  function renderExploring() {
    const host = clear($('exploring'));
    const ex = (dials().exploration) || null;
    const floor = ex ? ex.floor : 50;
    const rows = S.snapshot ? Object.entries(S.snapshot.items || {}).map(([item, byKey]) => ({ item, n: (byKey['*'] || { n: 0 }).n })).filter((r) => r.n < floor).sort((a, b) => a.n - b.n) : [];
    const rep = S.report && S.report.exploration ? S.report.exploration.find((e) => e.slot === S.slot) : null;
    host.append(h('div', { class: 'kv' },
      h('span', { class: 'k' }, 'Mode'), h('span', { class: 'v' }, ex && ex.mode !== 'off' ? `${ex.mode}, share ${pct(ex.share)}, floor ${ex.floor} observations` : 'off'),
      h('span', { class: 'k' }, 'Realized share'), h('span', { class: 'v' }, rep ? `${pct(rep.realized)} of ${rep.decisions} first-position decisions on ${S.report.date}${rep.configured !== null ? ` (configured ${pct(rep.configured)})` : ''}` : 'build the day report below to measure it'),
      h('span', { class: 'k' }, 'Under the floor'), h('span', { class: 'v' }, rows.length ? `${rows.length} item${rows.length === 1 ? '' : 's'}` : 'none: every served item has reached the floor'),
    ));
    if (rows.length) host.append(h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Item'), h('th', { class: 'num' }, 'n'), h('th', { class: 'num' }, 'to the floor'))), h('tbody', {}, ...rows.map((r) => h('tr', {}, h('td', {}, h('div', { class: 'itemname' }, nameOf(r.item)), h('div', { class: 'itemid' }, r.item)), h('td', { class: 'num' }, r.n), h('td', { class: 'num' }, r3(floor - r.n)))))));
  }
  function renderReport() {
    const host = clear($('report'));
    const pre = clear($('report-presets'));
    pre.append(h('span', { style: 'color:var(--ink-soft)' }, 'Overlays:'), ...presets().map((p) => h('label', {}, h('input', { type: 'checkbox', 'data-name': p.name, checked: true }), p.name)));
    $('report-csv').disabled = !S.report;
    if (S.reportError) host.append(h('div', { class: 'msg err' }, S.reportError));
    if (!S.report) { host.append(h('div', { class: 'empty' }, 'No report for this day yet.')); return; }
    const R = S.report;
    host.append(h('div', { class: 'kv' },
      h('span', { class: 'k' }, 'Day'), h('span', { class: 'v' }, `${R.date}, built ${when(R.builtAt)}`),
      h('span', { class: 'k' }, 'Read'), h('span', { class: 'v' }, `${R.counts.decisions} decisions, ${R.counts.outcomes} outcomes, ${R.counts.visitors} visitors${R.counts.truncated ? ' (capped: the day was larger than one pass reads)' : ''}`),
      h('span', { class: 'k' }, 'Credits'), h('span', { class: 'v' }, R.policies.map((p) => `${p.name} ${p.credits}`).join(' · ')),
    ));
    const grid = R.grids[S.slot];
    if (!grid) { host.append(h('div', { class: 'empty' }, `No decisions for ${S.slot} on that day.`)); return; }
    const names = R.policies.map((p) => p.name);
    const items = [...new Set(names.flatMap((n) => Object.keys((grid[n] || {}).items || {})))].sort();
    const cell = (n, item, f) => { const st = (((grid[n] || {}).items || {})[item] || {})['*']; return st ? st[f] : ''; };
    host.append(h('div', { class: 'subhead' }, 'Items under each policy, the pooled row'));
    host.append(h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Item'), ...names.flatMap((n) => [h('th', { class: 'num' }, `${n} n`), h('th', { class: 'num' }, 's'), h('th', { class: 'num' }, 'p̂'), h('th', { class: 'num' }, 'lift')]))),
      h('tbody', {}, ...items.map((item) => h('tr', {}, h('td', {}, h('div', { class: 'itemname' }, nameOf(item)), h('div', { class: 'itemid' }, item)), ...names.flatMap((n) => [h('td', { class: 'num' }, cell(n, item, 'n')), h('td', { class: 'num' }, cell(n, item, 's')), h('td', { class: 'num' }, cell(n, item, 'p_hat')), h('td', { class: 'num' }, h('strong', {}, cell(n, item, 'lift')))])))),
    )));
    const arms = R.holdout[S.slot] || [];
    if (arms.length) {
      host.append(h('div', { class: 'subhead' }, 'The holdout arms, under the learning policy'));
      host.append(h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Arm'), h('th', { class: 'num' }, 'decisions'), h('th', { class: 'num' }, 'credited'), h('th', { class: 'num' }, 'rate'))), h('tbody', {}, ...arms.map((a) => h('tr', {}, h('td', {}, a.arm), h('td', { class: 'num' }, a.decisions), h('td', { class: 'num' }, a.credited), h('td', { class: 'num' }, a.rate))))));
    }
  }
  function reportCsv() {
    const R = S.report; if (!R) return;
    const grid = R.grids[S.slot] || {};
    const names = R.policies.map((p) => p.name);
    const rows = [['item', 'customer_id', 'policy', 'cell', 'n', 's', 'p_hat', 'p0', 'lift']];
    for (const n of names) for (const [item, byKey] of Object.entries((grid[n] || {}).items || {})) for (const [key, st] of Object.entries(byKey)) rows.push([item, nameOf(item), n, key, st.n, st.s, st.p_hat, st.p0, st.lift]);
    download(`report-${S.scope}-${S.slot}-${R.date}.csv`, csv(rows));
  }
  function renderHistory() {
    const ph = clear($('proposals'));
    if (S.proposalsError) ph.append(h('div', { class: 'empty' }, S.proposalsError));
    else if (!S.proposals || !S.proposals.length) ph.append(h('div', { class: 'empty' }, 'No proposals yet. A slot in assisted mode gets one from the daily cycle once it has seen enough exposures.'));
    else for (const p of [...S.proposals].reverse().slice(0, 12)) {
      const ev = (p.evidence || [])[0];
      ph.append(h('div', { class: 'prop' },
        h('div', { class: 'top' }, h('span', { class: 'n' }, p.slot), h('span', { class: 'st', style: `color:${p.status === 'applied' ? 'var(--ok)' : p.status === 'rejected' ? 'var(--warn)' : 'var(--ai)'}` }, p.status), h('span', { class: 'meta' }, when(p.at))),
        h('div', {}, `${p.dimension}: ${p.from} → ${p.to}`, ev ? ` · ${ev.dimension} separates outcomes by ${ev.spread}` : '', ` · ${Math.round(p.exposures)} exposures · ${p.mode}`),
        p.note ? h('div', { class: 'ev' }, p.note) : null,
        p.status === 'proposed' ? h('div', { style: 'margin-top:5px' }, h('button', { class: 'small', disabled: !canEdit(), onclick: () => decideProposal(p.id, 'apply') }, 'Apply'), ' ', h('button', { class: 'small warn', disabled: !canEdit(), onclick: () => decideProposal(p.id, 'reject') }, 'Reject')) : null,
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
        h('div', {}, !isCurrent ? h('button', { class: 'link', onclick: () => showDiff(r.revision) }, d ? 'Hide the diff' : 'Diff against the document in force') : null, ' ', !isCurrent ? h('button', { class: 'link', disabled: !canEdit(), title: canEdit() ? '' : 'Needs an operator token', onclick: () => rollback(r.revision) }, 'Roll back to this') : null),
        d ? h('div', { class: 'diff' }, ...(d.length ? d.map((x) => h('div', {}, h('span', { class: 'del' }, `${x.path}: ${JSON.stringify(x.to)}`), ' → ', h('span', { class: 'add' }, JSON.stringify(x.from)))) : [h('div', {}, 'Identical content: this revision and the one in force say the same thing.')])) : null,
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
    const el = h('select', { class: changedClass(path), disabled: !canEdit() }, ...options.map(([v, label]) => h('option', { value: v, selected: String(v) === String(value) }, label)));
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
    host.append(
      dial('γ, the trust dial', 'How much the learned lift moves the score: score_final = score_base × lift^γ. At 0 the lift is computed and shown on every receipt and changes nothing; at 1 it applies in full.', num(d.gamma, (v) => { if (v === undefined) delete d.gamma; else d.gamma = v; scheduleCheck(); }, `${base}.gamma`, { min: 0, max: 1, step: 0.05 }), gamma === 0 ? 'Shadow: learning is visible and inert.' : `A lift of 1.4 becomes ×${r3(Math.pow(1.4, gamma))} on the score.`),
      dial('Reward', 'The outcome this slot learns against. One reward per slot; the others still land in the ledger.', sel(d.reward || 'click', REWARDS.map((r) => [r, r.replace('_', ' ')]), (v) => { d.reward = v; scheduleCheck(); }, `${base}.reward`)),
      h('div', { class: 'subhead' }, 'Exploration'),
      dial('Mode', 'Rotation serves the least-observed item on a hashed share of decisions; Thompson samples each item’s rate and ranks by the sample; epsilon is uniform. Every pick is flagged on the receipt.', sel((d.exploration || {}).mode || 'off', [['off', 'off'], ['rotation', 'rotation'], ['thompson', 'thompson'], ['epsilon', 'epsilon']], (v) => { if (v === 'off') delete d.exploration; else d.exploration = { mode: v, share: (d.exploration || {}).share ?? 0.1, floor: (d.exploration || {}).floor ?? 50 }; scheduleCheck(); }, `${base}.exploration.mode`)),
      d.exploration ? dial('Share', 'The fraction of this slot’s decisions reserved for exploration.', num(d.exploration.share, (v) => { d.exploration.share = v ?? 0; scheduleCheck(); }, `${base}.exploration.share`, { min: 0, max: 1, step: 0.01 }), `${pct(d.exploration.share)} of decisions`) : null,
      d.exploration ? dial('Floor', 'Observations below which an item counts as under-observed and is worth exploring.', num(d.exploration.floor, (v) => { d.exploration.floor = v ?? 0; scheduleCheck(); }, `${base}.exploration.floor`, { min: 0, step: 1 })) : null,
      h('div', { class: 'subhead' }, 'Autonomy'),
      dial('Mode', 'Configured: the weights are what a person set. Assisted: the daily cycle proposes one bounded move with its evidence and a person applies or rejects it. Autonomous: the same move is applied, within the bounds, as a new revision.', sel((d.autonomy || {}).mode || 'configured', [['configured', 'configured'], ['assisted', 'assisted'], ['autonomous', 'autonomous']], (v) => { if (v === 'configured') delete d.autonomy; else d.autonomy = { mode: v, step: (d.autonomy || {}).step ?? 0.05, min: (d.autonomy || {}).min ?? 0, max: (d.autonomy || {}).max ?? 1, pinned: (d.autonomy || {}).pinned ?? [], minN: (d.autonomy || {}).minN ?? 500 }; scheduleCheck(); }, `${base}.autonomy.mode`)),
      d.autonomy ? dial('Step', 'The most any weight may move per cycle.', num(d.autonomy.step, (v) => { d.autonomy.step = v ?? 0.05; scheduleCheck(); }, `${base}.autonomy.step`, { min: 0.01, max: 1, step: 0.01 })) : null,
      d.autonomy ? dial('Bounds', 'The hard range for any weight, min and max.', h('div', {}, num(d.autonomy.min, (v) => { d.autonomy.min = v ?? 0; scheduleCheck(); }, `${base}.autonomy.min`, { min: 0, max: 1, step: 0.05 }), num(d.autonomy.max, (v) => { d.autonomy.max = v ?? 1; scheduleCheck(); }, `${base}.autonomy.max`, { min: 0, max: 1, step: 0.05 }))) : null,
      d.autonomy ? dial('Minimum exposures', 'The slot must have seen this many exposures before a cycle may act.', num(d.autonomy.minN, (v) => { d.autonomy.minN = v ?? 500; scheduleCheck(); }, `${base}.autonomy.minN`, { min: 1, step: 1 })) : null,
      d.autonomy ? dial('Pinned dimensions', 'Weights the cycle may never touch, comma separated.', txt((d.autonomy.pinned || []).join(', '), (v) => { d.autonomy.pinned = v.split(',').map((x) => x.trim()).filter(Boolean); scheduleCheck(); }, `${base}.autonomy.pinned`, 'occasion, line')) : null,
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
    host.append(
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
    if (S.errors.length) host.append(h('div', { class: 'msg err' }, 'The document as drafted was refused:', h('ul', {}, ...S.errors.map((e) => h('li', {}, e)))));
    if (!canEdit()) host.append(h('div', { class: 'msg', style: 'background:var(--tan-wash);border:1px solid var(--line-strong)' }, 'Read-only. Paste an operator token in the top bar to change dials, controls, proposals or to build a report.'));
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
  function render() { renderBar(); renderMessages(); renderGrid(); renderExploring(); renderReport(); renderHistory(); renderSlotDials(); renderGlobalDials(); }

  // ---------- wiring ----------
  $('report-date').value = new Date().toISOString().slice(0, 10);
  $('token').value = S.token;
  $('token').addEventListener('input', (e) => { S.token = e.target.value.trim(); sessionStorage.setItem('tuning-token', S.token); loadProposals().then(render); render(); });
  $('slot').addEventListener('change', async (e) => { S.slot = e.target.value; S.archived = null; S.diffs = {}; await loadLift(); render(); });
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
