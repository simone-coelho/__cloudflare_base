// public/console/shell.js
// ---------------------------------------------------------------------------
// The operator application's shell (doc 28). One application, a left rail, a
// route per view, the context chosen once, and every list that grows with the
// catalog paged by the SERVER.
//
// WHY A HASH ROUTE. `not_found_handling = "single-page-application"` serves the
// ROOT index.html for any path that is not a file, so /console/lift would render
// the storefront. A hash needs no route in the worker and still gives the back
// button, a bookmark and a link in a message: #/lift?scope=coach&slot=chero.
//
// WHAT THE SHELL OWNS. The router and the URL, the context (brand and slot) and
// its pickers, the sign-in, the messages, the save bar, and two components every
// view uses: a table with sticky headings and tabular numbers, and a pager over
// a server cursor. A view owns its own data and nothing else.
//
// THE RULE THIS FILE KEEPS. Nothing reaches the page as the word "null",
// "undefined" or "NaN": h() drops those children, and every number goes through
// a formatter. src/console/console.render.test.ts fails if one gets through.
// ---------------------------------------------------------------------------
(() => {
  const $ = (id) => document.getElementById(id);

  // ---------- DOM ----------
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of children.flat(4)) {
      if (c === null || c === undefined || c === false || c === '') continue;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  const clear = (el) => { while (el && el.firstChild) el.removeChild(el.firstChild); return el; };

  // ---------- formatting: a number a person reads, never a raw one ----------
  const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : 0);
  const fmt = (x) => (Number.isFinite(x) ? Number(x).toLocaleString('en-US') : '');
  const dec = (x, places = 3) => (Number.isFinite(x) ? Number(x).toFixed(places).replace(/\.?0+$/, '') || '0' : '');
  const pct = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '');
  const when = (ms) => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : many || `${one}s`}`;

  // ---------- state ----------
  const S = {
    path: 'work',
    params: {},
    scope: 'coach',
    brand: 'coach',
    slot: '',
    slotQuery: '',
    slots: { pages: [], total: 0, loading: false, error: '' },
    token: '',
    flash: '',
    errors: [],
    /** Saves this browser refused or the platform refused, for the work queue. */
    refusals: [],
    dirty: null,
  };

  // ---------- the URL ----------
  function readHash() {
    const raw = String(location.hash || '').replace(/^#/, '') || '/work';
    const cut = raw.indexOf('?');
    const path = (cut < 0 ? raw : raw.slice(0, cut)).replace(/^\/+|\/+$/g, '') || 'work';
    const params = {};
    for (const [k, v] of new URLSearchParams(cut < 0 ? '' : raw.slice(cut + 1))) params[k] = v;
    return { path, params };
  }
  function href(path, patch) {
    const next = { scope: S.scope, brand: S.brand === S.scope ? '' : S.brand, slot: S.slot, ...(patch || {}) };
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
    const s = q.toString();
    return `#/${path}${s ? `?${s}` : ''}`;
  }
  const go = (path, patch) => { location.hash = href(path, patch); };

  // ---------- the platform ----------
  const auth = () => (S.token ? { authorization: `Bearer ${S.token}` } : {});
  async function call(url, init) {
    try {
      const r = await fetch(url, { ...(init || {}), headers: { ...auth(), ...((init && init.headers) || {}) } });
      const data = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, data: data || {} };
    } catch (e) {
      return { ok: false, status: 0, data: { error: e && e.message ? e.message : 'the platform did not answer' } };
    }
  }
  const v1 = (path, params) => call(`/v1/${encodeURIComponent(S.scope)}${path}${query({ brand: S.brand === S.scope ? undefined : S.brand, ...(params || {}) })}`);
  const content = (path, params) => call(`/content${path}${query({ scope: S.scope, ...(params || {}) })}`);
  function query(params) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
    const s = q.toString();
    return s ? `?${s}` : '';
  }
  async function write(url, method, body) {
    const res = await call(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
    if (!res.ok || res.data.ok === false) {
      const why = res.status === 401 || res.status === 403
        ? 'Your sign-in was not accepted. Sign in again to make this change.'
        : (res.data.errors && res.data.errors[0]) || res.data.error || 'The platform refused the change.';
      S.refusals.push({ at: Date.now(), what: `${method} ${url.split('?')[0]}`, why });
      S.errors = res.data.errors && res.data.errors.length ? res.data.errors : [why];
    }
    return res;
  }
  function flash(text) {
    S.flash = text; S.errors = [];
    render();
    setTimeout(() => { if (S.flash === text) { S.flash = ''; render(); } }, 4000);
  }

  // ---------- the context: brand, then slot, fed by the server ----------
  async function loadSlots() {
    S.slots.loading = true;
    const { ok, status, data } = await v1('/learn/slots', { q: S.slotQuery || undefined, evidence: '1' });
    S.slots.loading = false;
    if (!ok) {
      // On a platform with access enforced, every /v1 read wants a sign-in. Say
      // that once, in the rail, rather than the same refusal on every screen.
      const why = status === 401 || status === 403
        ? 'Sign in at the top right: this platform answers nothing until you do.'
        : data.error || 'Could not read the slots.';
      S.slots = { pages: [], total: 0, loading: false, error: why };
      return;
    }
    S.slots = { pages: data.pages || [], total: data.total || 0, loading: false, error: '' };
    const all = slotList();
    if (!all.some((s) => s.slot === S.slot)) S.slot = (all.find((s) => !s.pinned) || all[0] || { slot: '' }).slot;
  }
  const slotList = () => S.slots.pages.flatMap((p) => p.slots.map((s) => ({ ...s, page: s.page || p.page })));
  const slotEntry = (name) => slotList().find((s) => s.slot === (name || S.slot)) || null;

  function renderContext() {
    if ($('scope').value !== S.scope) $('scope').value = S.scope;
    if ($('slot-q').value !== S.slotQuery) $('slot-q').value = S.slotQuery;
    $('scope-note').textContent = S.brand === S.scope ? '' : `reading what was learned for ${S.brand}`;
    const sel = $('slot');
    const wanted = slotList().map((s) => `${s.page}/${s.slot}`).join('|');
    if (sel.dataset.shape !== wanted) {
      clear(sel);
      for (const page of S.slots.pages) {
        const group = h('optgroup', { label: page.page });
        for (const s of page.slots) group.append(h('option', { value: s.slot }, `${s.slot}${s.pinned ? ' · pinned' : ''}`));
        sel.append(group);
      }
      sel.dataset.shape = wanted;
    }
    if (S.slot) sel.value = S.slot;
    const shown = slotList().length;
    $('slot-count').textContent = S.slots.error
      ? S.slots.error
      : S.slots.loading ? 'looking…'
      : S.slots.total === 0 ? 'No slots configured for this brand yet.'
      : shown === S.slots.total ? `${plural(S.slots.total, 'slot')} on ${plural(S.slots.pages.length, 'page')}`
      : `${fmt(shown)} of ${plural(S.slots.total, 'slot')} match`;
    $('where').textContent = S.slot ? `${S.scope} · ${S.slot}` : S.scope;
  }

  // ---------- the rail ----------
  const VIEWS = [];
  const viewOf = (id) => VIEWS.find((v) => v.id === id) || null;
  function renderRail() {
    const nav = clear($('rail-views'));
    // Grouped, each heading once, in the order the groups first appear. A view
    // registered later joins its group rather than opening a second one.
    for (const group of [...new Set(VIEWS.map((v) => v.group))]) {
      nav.append(h('div', { class: 'heading' }, group));
      for (const v of VIEWS.filter((x) => x.group === group)) {
        const n = typeof v.badge === 'function' ? v.badge() : null;
        nav.append(h('a', { class: S.path === v.id ? 'on' : null, href: href(v.id) },
          v.title, n === null || n === undefined ? null : h('span', { class: 'n' }, fmt(n))));
      }
    }
    // The two older pages are still served, because ONE screen has not moved
    // into the application yet: the under-floor list, which waits on a route
    // that can page it (doc 29). They are not rail entries. A rail entry is a
    // route inside this application, and these replace the whole page with a
    // different one that has no rail and no way back, which is a trap rather
    // than a link. They live at the foot of the rail, under a heading that says
    // they leave, with the mark a link that leaves the page carries everywhere.
    nav.append(h('div', { class: 'heading' }, 'Leaves this console'));
    nav.append(h('a', {
      class: 'away',
      href: `/learning.html?scope=${encodeURIComponent(S.scope)}&slot=${encodeURIComponent(S.slot)}`,
      title: 'The page this console replaced. The only thing still on it and not here is the under-floor list.',
    }, 'Old learning page ↗'));
    nav.append(h('a', {
      class: 'away',
      href: `/tuning.html?scope=${encodeURIComponent(S.scope)}`,
      title: 'The page this console replaced. Everything on it is now under Interests.',
    }, 'Old tuning page ↗'));
  }

  // ---------- components ----------
  /**
   * A table with sticky headings, fixed row heights and right-aligned numbers.
   * `cols`: { key, label, sym, num, sortable, title }. `sort` and `onSort` make
   * the headings clickable, and the SERVER does the sorting.
   */
  function table(cols, rows, opts) {
    const o = opts || {};
    const head = h('tr', {}, ...cols.map((c) => h('th', {
      class: `${c.num ? 'num ' : ''}${c.sortable && o.onSort ? 'sortable ' : ''}${o.sort && o.sort.key === c.key ? 'on' : ''}`.trim() || null,
      title: c.title || null,
      ...(c.sortable && o.onSort ? { onclick: () => o.onSort(c.key) } : {}),
    }, o.sort && o.sort.key === c.key ? `${c.label} ${o.sort.dir === 'asc' ? '↑' : '↓'}` : c.label,
       c.sym ? h('span', { class: 'sym' }, c.sym) : null)));
    return h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, head), h('tbody', {}, ...rows)));
  }

  /** The state one server-paged list keeps: where it is, and how it got there. */
  const pageState = () => ({ cursors: [null], at: 0, data: null, loading: false, error: '', key: '' });

  /**
   * "312 items, showing 1 to 50", and the two buttons. Cursors are forward-only,
   * so going back means re-asking with the cursor that opened the page before.
   */
  function pager(st, noun, load) {
    const d = st.data || { total: 0, offset: 0, limit: 50, rows: [], cursor: null };
    const from = d.total === 0 ? 0 : d.offset + 1;
    const to = d.offset + (d.rows ? d.rows.length : 0);
    const hasPrev = st.at > 0;
    const hasNext = Boolean(d.cursor);
    return h('div', { class: 'pager' },
      st.loading ? 'Loading…' : `${plural(d.total, noun)}${d.total ? `, showing ${fmt(from)} to ${fmt(to)}` : ''}`,
      h('span', { class: 'spacer', style: 'flex:1' }),
      h('button', { class: 'small', disabled: !hasPrev || st.loading, onclick: () => { st.at -= 1; st.cursors.length = st.at + 1; load(st.cursors[st.at]); } }, 'Previous'),
      h('button', { class: 'small', disabled: !hasNext || st.loading, onclick: () => { st.at += 1; st.cursors[st.at] = d.cursor; load(d.cursor); } }, 'Next'),
    );
  }

  // ---------- the save bar ----------
  /** A view that can be saved hands the bar its count, its save and its discard. */
  function dirty(state) { S.dirty = state; renderSaveBar(); }
  function renderSaveBar() {
    const bar = $('savebar');
    const d = S.dirty;
    if (!d || !d.count) { bar.hidden = true; $('save').disabled = true; $('changecount').textContent = 'No changes'; return; }
    bar.hidden = false;
    $('changecount').textContent = `${plural(d.count, 'change')}${d.checking ? ', checking…' : ''}`;
    $('save').disabled = !d.count || !canEdit() || Boolean(d.blocked) || Boolean(d.checking);
    $('note').placeholder = d.notePlaceholder || 'What are you changing, and why? (recorded with the revision)';
  }

  // ---------- the sign-in ----------
  const canEdit = () => Boolean(S.token);
  async function freshToken() {
    S.token = window.OperatorSession && OperatorSession.signedIn() ? await OperatorSession.token() : '';
    return S.token;
  }
  function renderSession() {
    const on = Boolean(window.OperatorSession && OperatorSession.signedIn());
    const u = on ? OperatorSession.user() : null;
    $('who').textContent = u ? `Signed in as ${u.name || u.email}` : '';
    $('sign-in').hidden = on;
    $('sign-out').hidden = !on;
    $('change-password').hidden = !on;
    if (on) $('sign-in-form').hidden = true;
    // A temporary password is good for one sign-in. An operator who has just
    // been given an account is asked to choose their own before anything else,
    // and cannot dismiss the form until they have.
    const must = on && OperatorSession.mustChangePassword && OperatorSession.mustChangePassword();
    if (must) {
      $('password-form').hidden = false;
      $('pw-note').textContent = 'You signed in with a temporary password. Choose your own to carry on.';
    } else if (!on) {
      $('password-form').hidden = true;
    }
  }

  // ---------- messages ----------
  function renderMessages() {
    const host = clear($('messages'));
    if (S.flash) host.append(h('div', { class: 'msg ok' }, S.flash));
    if (S.errors.length) host.append(h('div', { class: 'msg err' }, 'The change was refused:', h('ul', {}, ...S.errors.map((e) => h('li', {}, String(e))))));
    if (!canEdit()) host.append(h('div', { class: 'msg note' }, 'Read only. Sign in at the top right to change anything; everything on this page can be read without signing in.'));
  }

  // ---------- render ----------
  let painting = false;
  function render() {
    if (painting) return;
    painting = true;
    try {
      renderSession();
      renderContext();
      renderRail();
      renderMessages();
      const view = viewOf(S.path) || viewOf('work');
      $('view-title').textContent = view ? view.heading || view.title : 'Not a view';
      $('view-hint').textContent = view ? view.hint || '' : '';
      const host = clear($('view'));
      // The bar belongs to the view being painted: a view that can be saved
      // claims it with Console.dirty(); every other view leaves it hidden.
      S.dirty = null;
      // Keep the caret where the operator left it: the host is rebuilt on every
      // repaint, and a dial is unusable if it loses focus on each keystroke.
      const active = document.activeElement;
      const focusKey = active && active.dataset ? active.dataset.focusKey : null;
      const caret = focusKey && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
      // A view is painted before its enter() has loaded anything, and again
      // after. One that throws in either pass shows its error in its own place
      // rather than blanking the application and losing the rail with it.
      try {
        if (view) view.render(host, S);
      } catch (e) {
        clear(host).append(h('div', { class: 'msg err' }, `This screen could not be drawn: ${e && e.message ? e.message : e}. The rest of the console still works.`));
      }
      if (focusKey) {
        const again = host.querySelector(`[data-focus-key="${focusKey}"]`);
        if (again) { again.focus(); if (caret) { try { again.setSelectionRange(caret[0], caret[1]); } catch (e) { /* not selectable */ } } }
      }
      renderSaveBar();
    } finally { painting = false; }
  }

  // ---------- start ----------
  async function route() {
    const { path, params } = readHash();
    const before = { scope: S.scope, brand: S.brand, slot: S.slot };
    S.path = path;
    S.params = params;
    S.scope = params.scope || S.scope;
    S.brand = params.brand || S.scope;
    if (params.slot) S.slot = params.slot;
    S.errors = [];
    if (before.scope !== S.scope || before.brand !== S.brand) await loadSlots();
    render();
    const view = viewOf(S.path);
    if (view && view.enter) await view.enter(S);
    render();
  }

  async function start() {
    // A view that is registered late would be a dead link in the rail, so views
    // register first and this runs last (the bottom of views.js).
    $('sign-in').addEventListener('click', () => { $('sign-in-form').hidden = false; $('si-error').textContent = ''; $('si-email').focus(); });
    $('si-cancel').addEventListener('click', () => { $('sign-in-form').hidden = true; });
    $('sign-in-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('si-submit').disabled = true; $('si-error').textContent = '';
      try {
        await OperatorSession.signIn($('si-email').value, $('si-password').value);
        $('si-password').value = ''; $('sign-in-form').hidden = true;
        await freshToken();
        await loadSlots();
        await route();
      } catch (err) { $('si-error').textContent = err && err.message ? err.message : 'Sign-in did not go through.'; }
      finally { $('si-submit').disabled = false; }
    });
    $('change-password').addEventListener('click', () => { $('password-form').hidden = false; $('pw-note').textContent = ''; $('pw-error').textContent = ''; $('pw-current').focus(); });
    $('pw-cancel').addEventListener('click', () => { if (!(window.OperatorSession && OperatorSession.mustChangePassword && OperatorSession.mustChangePassword())) $('password-form').hidden = true; });
    $('password-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('pw-submit').disabled = true; $('pw-error').textContent = '';
      try {
        await OperatorSession.changePassword($('pw-current').value, $('pw-new').value);
        $('pw-current').value = ''; $('pw-new').value = ''; $('password-form').hidden = true;
        await freshToken();
        flash('Your password is changed.');
      } catch (err) { $('pw-error').textContent = err && err.message ? err.message : 'The password was not changed.'; }
      finally { $('pw-submit').disabled = false; }
    });
    $('sign-out').addEventListener('click', async () => {
      await OperatorSession.signOut();
      S.token = '';
      await loadSlots();
      await route();
    });
    $('scope').addEventListener('change', (e) => { const v = e.target.value.trim(); if (v) go(S.path, { scope: v, brand: '', slot: '' }); });
    let qTimer = null;
    $('slot-q').addEventListener('input', (e) => {
      S.slotQuery = e.target.value.trim();
      clearTimeout(qTimer);
      qTimer = setTimeout(async () => { await loadSlots(); render(); }, 250);
    });
    $('slot').addEventListener('change', (e) => go(S.path, { slot: e.target.value }));
    $('save').addEventListener('click', async () => { if (S.dirty && S.dirty.save) await S.dirty.save($('note').value.trim()); });
    $('discard').addEventListener('click', () => { if (S.dirty && S.dirty.discard) { S.dirty.discard(); $('note').value = ''; } });
    window.addEventListener('hashchange', () => { route().catch(fail); });

    const first = readHash();
    S.scope = first.params.scope || 'coach';
    S.brand = first.params.brand || S.scope;
    S.slot = first.params.slot || '';
    $('scope-list').append(h('option', { value: S.scope }));
    await freshToken();
    renderSession();
    await loadSlots();
    await route();
  }
  const fail = (e) => { S.errors = [`The console could not load: ${e && e.message ? e.message : e}`]; render(); };

  window.Console = {
    h, clear, table, pager, pageState, dirty, flash, go, href, call, v1, content, write, query,
    canEdit, freshToken, render, loadSlots, slotList, slotEntry, state: S,
    fmt, dec, pct, r3, when, plural,
    view: (def) => { VIEWS.push(def); },
  };

  // Every view file registers synchronously as it loads; this runs after the
  // last of them, so no file has to be told that it is the last one.
  setTimeout(() => start().catch(fail), 0);
})();
