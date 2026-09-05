// public/console/views.js
// ---------------------------------------------------------------------------
// The views. Each one registers itself with the shell, owns its own data, and
// asks the SERVER for a page whenever the list can grow with the catalog.
//
//   Work       what needs a person, as counts with links (doc 28 §3.5)
//   Lift       the grid: one pooled row per item, paged; an item opens its cells
//   Slots      every slot on every page, what is set on it and what it has learned
//   Dials      the learn document for this slot, and for the brand
//   Proposals  what the daily cycle proposes, to apply or reject
//   Erasures   the tombstones the ledger honours, and the rewrite
//
// The two rules that shape every table here: cells are a DRILL-DOWN and never
// rows (doc 28 §3.4), and nothing renders as "null", "undefined" or "NaN".
// ---------------------------------------------------------------------------
(() => {
  const C = window.Console;
  const { h, clear, fmt, dec, pct, when, plural } = C;
  const S = C.state;

  const MIN = 60000, HOUR = 3600000, DAY = 86400000;
  const REWARDS = ['click', 'dwell', 'video_complete', 'wishlist', 'add_to_bag', 'purchase', 'custom'];
  const DEFAULT_WINDOWS = { click: 30 * MIN, dwell: 30 * MIN, video_complete: 30 * MIN, wishlist: 6 * HOUR, add_to_bag: 6 * HOUR, purchase: 7 * DAY, custom: 30 * MIN };
  const copy = (v) => JSON.parse(JSON.stringify(v));
  const words = (s) => String(s || '').replace(/_/g, ' ');
  function humanMs(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '';
    if (ms % DAY === 0) return plural(ms / DAY, 'day');
    if (ms % HOUR === 0) return plural(ms / HOUR, 'hour');
    return `${fmt(Math.round(ms / MIN))} min`;
  }
  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const csvCell = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n');
  const card = (title, why, ...body) => h('section', { class: 'card' },
    title ? h('header', {}, h('h3', {}, title), why ? h('div', { class: 'why' }, why) : null) : null, ...body);
  const needSlot = () => h('div', { class: 'empty' }, 'Choose a slot in the rail. A slot is a place on a page the engine decides for; everything on this screen is about one of them.');

  // ═══════════════════════════════════════════════════════════ Work ══════════
  const work = { proposals: null, erasures: null, loaded: false, denied: false };
  const awaiting = () => (work.proposals ? work.proposals.filter((p) => p.status === 'proposed').length : null);
  const noEvidence = () => C.slotList().filter((s) => !s.evidence || !s.evidence.items).length;
  const held = () => C.slotList().reduce((n, s) => n + (s.controls || 0), 0);

  C.view({
    id: 'work', group: 'Attention', title: 'Work', heading: 'What needs a person',
    hint: 'Counts, and where to go. The engine runs without any of this; these are the decisions it will not take on its own.',
    badge: () => {
      const a = awaiting();
      return (a || 0) + S.refusals.length || null;
    },
    async enter() {
      work.loaded = false;
      const [props, eras] = await Promise.all([C.v1('/learn/proposals'), C.v1('/ledger/erasures')]);
      work.denied = props.status === 401 || props.status === 403;
      work.proposals = props.ok ? props.data.proposals || [] : null;
      work.erasures = eras.ok ? eras.data.pending || [] : null;
      work.loaded = true;
    },
    render(host) {
      const q = (n, what, why, to, act) => h('div', { class: `qcard${act && n ? ' act' : ''}` },
        h('div', { class: 'n' }, n === null ? '—' : fmt(n)),
        h('div', { class: 'what' }, what),
        h('div', { class: 'why' }, why),
        to ? h('div', { class: 'go' }, h('a', { href: to }, 'Open')) : null);
      host.append(h('div', { class: 'queue' },
        q(awaiting(), 'Proposals awaiting a decision', 'The daily cycle proposed a weight change with its evidence. Nothing moves until a person applies it.', C.href('proposals'), true),
        q(S.refusals.length, 'Saves refused, in this browser', 'A change this browser tried that the platform would not take. They are not stored; they are gone when you close the tab.', S.refusals.length ? C.href('work') : null, true),
        q(noEvidence(), 'Slots with nothing learned yet', 'Configured, but no snapshot has been published for them. A slot publishes about thirty seconds after the first decision it serves.', C.href('slots')),
        q(held(), 'Items a person is holding', 'Frozen at a lift, or rejected so the learned lift is ignored. Each one is a merchandiser overruling the evidence, on purpose.', C.href('slots')),
        q(work.erasures ? work.erasures.length : null, 'Erasures pending a rewrite', 'A shopper asked to be forgotten. Every reader honours the tombstone at once; the rows leave the ledger on the nightly rewrite.', C.href('erasures')),
      ));
      if (work.denied) host.append(h('div', { class: 'msg note' }, 'Two of these counts read authenticated routes: sign in to fill the proposals and the erasures.'));
      host.append(card('What this page cannot count yet',
        'Doc 28 asks for one route that answers the whole queue. Until it exists this page counts what the listings it can already read will tell it, and says so rather than guessing.',
        h('div', { class: 'body' }, h('div', { class: 'kv' },
          h('span', { class: 'k' }, 'Counted here'), h('span', { class: 'v' }, 'proposals awaiting a decision, erasures pending, slots with nothing learned, items held by a person'),
          h('span', { class: 'k' }, 'Waiting on the platform'), h('span', { class: 'v' }, 'saves refused across every operator rather than this browser, and slots whose evidence has gone stale'),
        ))));
      if (S.refusals.length) {
        host.append(card('Refused in this browser', 'What the platform would not take, most recent first.',
          h('div', { class: 'body' }, ...S.refusals.slice(-8).reverse().map((r) => h('div', { class: 'kv' },
            h('span', { class: 'k' }, when(r.at)), h('span', { class: 'v' }, `${r.what} — ${r.why}`))))));
      }
    },
  });

  // ═══════════════════════════════════════════════════════════ Lift ══════════
  const NUMERIC = new Set(['n', 's', 'p_hat', 'p0', 'lift', 'evidence']);
  const lift = { st: C.pageState(), sort: { key: 'lift', dir: 'desc' }, q: '', chosen: new Set(), meta: null };

  async function loadLift(cursor) {
    const st = lift.st;
    if (!S.slot) { st.data = null; return; }
    st.loading = true; C.render();
    const item = S.params.item || '';
    const res = await C.v1('/lift/rows', {
      slot: S.slot,
      level: item ? 'cells' : 'pooled',
      item: item || undefined,
      q: lift.q || undefined,
      sort: lift.sort.key,
      dir: lift.sort.dir,
      limit: 50,
      cursor: cursor || undefined,
    });
    st.loading = false;
    if (res.status === 409) {
      // The snapshot republished under the listing: start again rather than
      // show a page cut from one snapshot beside a page cut from another.
      st.cursors = [null]; st.at = 0;
      return loadLift(null);
    }
    if (!res.ok || res.data.ok === false) {
      st.error = res.status === 401 || res.status === 403
        ? 'Sign in at the top right to read what this slot has learned.'
        : res.status === 404
          ? 'This platform does not have the paged grid route yet (GET /v1/{brand}/lift/rows). Nothing is broken; the screen has nothing to page.'
          : res.data.error || 'Could not read the grid.';
      st.data = null; C.render(); return;
    }
    st.error = '';
    st.data = res.data;
    lift.meta = res.data;
    C.render();
  }

  /** Freeze, reject or clear, on one item or on a selection: read, patch, write, in one revision. */
  async function setControls(items, control) {
    const cur = await C.content('/learn');
    const doc = copy(cur.data.document || {});
    doc.slots = doc.slots || {};
    const d = (doc.slots[S.slot] = doc.slots[S.slot] || {});
    d.items = d.items || {};
    for (const item of items) { if (control) d.items[item] = control; else delete d.items[item]; }
    if (!Object.keys(d.items).length) delete d.items;
    const what = control ? (control.mode === 'freeze' ? `froze ${plural(items.length, 'item')} at their current lift` : `rejected the learned lift on ${plural(items.length, 'item')}`) : `cleared the control on ${plural(items.length, 'item')}`;
    const res = await C.write(`/content/learn${C.query({ scope: S.scope })}`, 'PUT', { document: doc, note: `${what} in ${S.slot}` });
    if (!res.ok || res.data.ok === false) { C.render(); return; }
    lift.chosen.clear();
    C.flash(`${what[0].toUpperCase()}${what.slice(1)} in ${S.slot}, as learn revision ${fmt(res.data.revision)}.`);
    await Promise.all([loadLift(lift.st.cursors[lift.st.at]), C.loadSlots()]);
  }

  async function resetItem(item, name) {
    if (!window.confirm(`Discard the evidence for ${name} in ${S.slot} and start again from the prior?`)) return;
    const res = await C.write(`/v1/${encodeURIComponent(S.scope)}/learn/items/reset`, 'POST', { slot: S.slot, item, brand: S.brand });
    if (!res.ok || res.data.ok === false) { C.render(); return; }
    C.flash(res.data.had
      ? `Evidence for ${name} discarded and the snapshot republished, recorded as revision ${fmt(res.data.revision)}.`
      : `${name} had no evidence in this slot; recorded as revision ${fmt(res.data.revision)}.`);
    await loadLift(lift.st.cursors[lift.st.at]);
  }

  function sortBy(key) {
    lift.sort = lift.sort.key === key
      ? { key, dir: lift.sort.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: NUMERIC.has(key) ? 'desc' : 'asc' };
    lift.st.cursors = [null]; lift.st.at = 0;
    loadLift(null);
  }

  C.view({
    id: 'lift', group: 'This slot', title: 'What it has learned', heading: 'What this slot has learned',
    hint: 'One row per piece: how often it was shown, how often that paid off, and the lift that follows. The server cuts the page; opening a piece shows the contexts it was shown in.',
    async enter() {
      lift.st.cursors = [null]; lift.st.at = 0; lift.chosen.clear();
      await loadLift(null);
    },
    render(host) {
      if (!S.slot) { host.append(needSlot()); return; }
      const st = lift.st;
      const item = S.params.item || '';
      const d = st.data;
      const rows = (d && d.rows) || [];
      const meta = lift.meta;

      const toolbar = h('div', { class: 'toolbar' },
        item
          ? h('button', { class: 'small', onclick: () => C.go('lift', { item: '' }) }, '← Every piece')
          : h('input', {
              class: 'small', id: 'lift-q', 'data-focus-key': 'lift-q', placeholder: 'Find a piece by id, your id or title',
              value: lift.q, style: 'width:280px',
              oninput: (e) => {
                lift.q = e.target.value.trim();
                clearTimeout(lift.timer);
                lift.timer = setTimeout(() => { lift.st.cursors = [null]; lift.st.at = 0; loadLift(null); }, 300);
              },
            }),
        h('span', { class: 'spacer' }),
        lift.chosen.size ? h('span', { class: 'sub' }, `${plural(lift.chosen.size, 'piece')} chosen`) : null,
        lift.chosen.size ? h('button', { class: 'small', disabled: !C.canEdit(), onclick: () => setControls([...lift.chosen], { mode: 'freeze', lift: 1 }) }, 'Freeze them') : null,
        lift.chosen.size ? h('button', { class: 'small', disabled: !C.canEdit(), onclick: () => setControls([...lift.chosen], { mode: 'reject' }) }, 'Reject them') : null,
        lift.chosen.size ? h('button', { class: 'small', disabled: !C.canEdit(), onclick: () => setControls([...lift.chosen], null) }, 'Clear them') : null,
        h('button', { class: 'small', disabled: !rows.length, onclick: () => downloadPage(rows, item) }, 'Download this page'),
      );

      if (st.error) { host.append(toolbar, h('div', { class: 'msg err' }, st.error)); return; }
      if (!meta || meta.published === false) {
        host.append(toolbar, h('div', { class: 'empty' }, 'Nothing published for this slot yet. The first snapshot publishes about thirty seconds after the first decision it serves.'));
        return;
      }

      const line = [
        `reward ${words(meta.reward)}`,
        meta.objective && meta.objective !== 'unit' ? `weighed by ${meta.objective}` : '',
        `prior strength ${fmt(meta.n0)}`,
        `evidence threshold ${fmt(meta.nMin)}`,
        meta.publishedAt ? `published ${when(meta.publishedAt)}` : '',
      ].filter(Boolean).join(' · ');

      const cols = [
        ...(item ? [] : [{ key: 'pick', label: '' }]),
        { key: 'name', label: 'Piece', sortable: true },
        ...(item ? [{ key: 'key', label: 'Context', sortable: true }] : []),
        { key: 'n', label: 'Shown', sym: 'n', num: true, sortable: true, title: 'How many times this piece was shown, decayed so that older evidence counts less' },
        { key: 's', label: 'Paid off', sym: 's', num: true, sortable: true, title: 'How many of those led to the outcome this slot learns against, weighed by its objective' },
        { key: 'p_hat', label: 'Rate', sym: 'p̂', num: true, sortable: true, title: 'Paid off over shown, pulled toward the slot’s own rate while the evidence is thin' },
        { key: 'p0', label: 'The slot’s rate', sym: 'p₀', num: true, sortable: true, title: 'What this slot achieves in the same context, whatever it shows' },
        { key: 'lift', label: 'Lift', sym: 'p̂ / p₀', num: true, sortable: true, title: 'The rate over the slot’s rate, clamped. Above 1 is better than the slot’s average' },
        { key: 'evidence', label: 'Evidence', sym: 'n / (n + n₀)', num: true, sortable: true, title: 'How much of the rate is live observation rather than the prior' },
        { key: 'act', label: 'Held by a person' },
      ];

      const body = rows.map((r) => {
        const name = r.customer_item_id || r.title || r.item;
        return h('tr', {},
          ...(item ? [] : [h('td', {}, h('input', {
            type: 'checkbox', 'aria-label': `Choose ${name}`, checked: lift.chosen.has(r.item) || null,
            onchange: (e) => { if (e.target.checked) lift.chosen.add(r.item); else lift.chosen.delete(r.item); C.render(); },
          }))]),
          h('td', {},
            item ? h('div', { class: 'itemname' }, name)
                 : h('button', { class: 'link', title: 'Show the contexts this piece was shown in', onclick: () => C.go('lift', { item: r.item }) }, name),
            h('div', { class: 'itemid' }, r.item)),
          ...(item ? [h('td', {}, h('div', {}, r.level_words || 'everyone'), r.key === '*' ? null : h('div', { class: 'cellkey' }, r.key))] : []),
          h('td', { class: 'num' }, dec(r.n)),
          h('td', { class: 'num' }, dec(r.s)),
          h('td', { class: 'num' }, dec(r.p_hat)),
          h('td', { class: 'num' }, dec(r.p0)),
          h('td', { class: 'num' }, h('strong', {}, dec(r.lift))),
          h('td', { class: 'num' }, pct(r.evidence)),
          h('td', {},
            r.control ? h('span', { class: `chip ${r.control}` }, r.control === 'freeze' ? 'frozen' : 'rejected') : null,
            r.prior ? h('span', { class: 'chip prior', title: `an imported prior: rate ${dec(r.prior.p)} worth ${fmt(r.prior.n)} observations` }, 'prior') : null,
            r.key !== '*' ? null : h('div', { style: 'margin-top:4px' },
              h('button', { class: 'small', disabled: !C.canEdit() || r.control === 'freeze', title: 'Hold this piece’s lift where it is', onclick: () => setControls([r.item], { mode: 'freeze', lift: r.lift }) }, 'Freeze'),
              h('button', { class: 'small', disabled: !C.canEdit() || r.control === 'reject', title: 'Ignore what was learned for this piece; rank it on its base score', onclick: () => setControls([r.item], { mode: 'reject' }) }, 'Reject'),
              h('button', { class: 'small', disabled: !C.canEdit() || !r.control, title: 'Let the learned lift apply again', onclick: () => setControls([r.item], null) }, 'Clear'),
              h('button', { class: 'small warn', disabled: !C.canEdit(), title: 'Discard this piece’s evidence and start again from the prior', onclick: () => resetItem(r.item, name) }, 'Start again'),
            )),
        );
      });

      const empty = h('div', { class: 'empty' }, lift.q ? 'Nothing matches that.' : 'No rows.');
      host.append(card(null, null,
        toolbar,
        h('div', { class: 'body', style: 'padding-top:8px;padding-bottom:0' }, h('div', { class: 'sub' },
          item ? `Every context ${item} was shown in. A context is who the shopper was and where they came from; the coarser ones answer until the finer ones have enough evidence.` : line)),
        rows.length ? C.table(cols, body, { sort: lift.sort, onSort: sortBy }) : empty,
        C.pager(st, item ? 'context' : 'piece', loadLift),
      ));
    },
  });

  function downloadPage(rows, item) {
    const head = ['item', 'your_id', 'title', 'context', 'shown_n', 'paid_off_s', 'rate_p_hat', 'slot_rate_p0', 'lift', 'prior_strength_n0', 'evidence', 'held'];
    const out = [head, ...rows.map((r) => [r.item, r.customer_item_id || '', r.title || '', r.key, r.n, r.s, r.p_hat, r.p0, r.lift, r.n0, r.evidence, r.control || ''])];
    download(`lift-${S.scope}-${S.slot}${item ? `-${item}` : ''}.csv`, csv(out));
  }

  // ══════════════════════════════════════════════════════════ Slots ══════════
  C.view({
    id: 'slots', group: 'This brand', title: 'Slots', heading: 'Every slot, and what is set on it',
    hint: 'A slot is one place on one page. This is what each is configured to do and what it has learned so far. The box in the rail narrows this list on the server.',
    badge: () => C.slotList().length || null,
    render(host) {
      if (S.slots.error) { host.append(h('div', { class: 'msg err' }, S.slots.error)); return; }
      if (!S.slots.pages.length) { host.append(h('div', { class: 'empty' }, 'No slots configured for this brand. A slot document names the places on each page the engine decides for.')); return; }
      for (const page of S.slots.pages) {
        const body = page.slots.map((s) => h('tr', {},
          h('td', {},
            h('button', { class: 'link', onclick: () => C.go('lift', { slot: s.slot }) }, s.slot),
            s.pinned ? h('div', { class: 'itemid' }, `pinned to ${s.pinned}`) : null),
          h('td', { class: 'num' }, fmt(s.take)),
          h('td', { class: 'num' }, fmt(s.pieces)),
          h('td', {}, s.dimensions && s.dimensions.length ? s.dimensions.join(', ') : 'none weighted'),
          h('td', {}, s.rules && s.rules.length ? s.rules.join(', ') : 'none'),
          h('td', {}, words(s.reward), s.objective && s.objective !== 'unit' ? h('div', { class: 'itemid' }, `weighed by ${s.objective}`) : null),
          h('td', { class: 'num' }, dec(s.gamma)),
          h('td', {}, words(s.exploration)),
          h('td', {}, words(s.autonomy)),
          h('td', { class: 'num' }, s.controls ? fmt(s.controls) : '—'),
          h('td', {}, s.evidence === undefined ? 'not asked' : s.evidence === null ? 'nothing yet'
            : `${plural(s.evidence.items, 'piece')}, ${plural(Math.round(s.evidence.events), 'event')}`),
        ));
        host.append(card(`${page.page} · ${plural(page.slots.length, 'slot')}`, null,
          C.table([
            { key: 'slot', label: 'Slot' },
            { key: 'take', label: 'Shows', num: true, title: 'How many pieces this slot shows at once' },
            { key: 'pieces', label: 'Eligible', num: true, title: 'Pieces in the catalog that may fill this slot right now' },
            { key: 'dimensions', label: 'Weighted on' },
            { key: 'rules', label: 'Rules' },
            { key: 'reward', label: 'Learns against' },
            { key: 'gamma', label: 'Trust', sym: 'γ', num: true, title: 'How much of the learned lift is applied: 0 shows it and changes nothing' },
            { key: 'exploration', label: 'Exploring' },
            { key: 'autonomy', label: 'Autonomy' },
            { key: 'controls', label: 'Held', num: true },
            { key: 'evidence', label: 'Learned so far' },
          ], body)));
      }
    },
  });

  // ══════════════════════════════════════════════════════════ Dials ══════════
  const dl = { doc: null, draft: null, revision: 0, source: 'loading', errors: [], checking: false, timer: null };
  const dialsFor = () => { dl.draft.slots = dl.draft.slots || {}; return (dl.draft.slots[S.slot] = dl.draft.slots[S.slot] || {}); };
  function diffPaths(a, b, path = '') {
    const out = [];
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
      if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path: path || '(root)', from: a, to: b });
      return out;
    }
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out.push(...diffPaths(a[k], b[k], path ? `${path}.${k}` : k));
    return out;
  }
  const changes = () => (dl.doc && dl.draft ? diffPaths(dl.doc, dl.draft) : []);
  function scheduleCheck() {
    clearTimeout(dl.timer);
    dl.checking = true;
    dl.timer = setTimeout(async () => {
      if (!changes().length) { dl.errors = []; dl.checking = false; C.render(); return; }
      const r = await C.call(`/content/learn/validate${C.query({ scope: S.scope })}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ document: dl.draft }) });
      dl.errors = r.data.valid ? [] : r.data.errors || ['The dials as drafted were refused.'];
      dl.checking = false;
      C.render();
    }, 350);
    C.render();
  }
  async function loadDials() {
    const { data } = await C.content('/learn');
    dl.doc = data.document || { holdout: { share: 0.05, salt: '', arms: ['default'] } };
    dl.draft = copy(dl.doc);
    dl.revision = data.revision || 0;
    dl.source = data.source || 'compiled-default';
    dl.errors = [];
  }
  async function saveDials(note) {
    const res = await C.write(`/content/learn${C.query({ scope: S.scope })}`, 'PUT', { document: dl.draft, note });
    if (!res.ok || res.data.ok === false) { C.render(); return; }
    dl.doc = res.data.document; dl.draft = copy(dl.doc); dl.revision = res.data.revision; dl.source = 'stored';
    document.getElementById('note').value = '';
    C.flash(`Saved as learn revision ${fmt(res.data.revision)}. Live now, with no deployment.`);
    await C.loadSlots();
  }

  const put = (host, ...items) => host.append(...items.flat().filter((x) => x !== null && x !== undefined && x !== false));
  const dial = (name, help, control, derived) => h('div', { class: 'dial' },
    h('div', {}, h('div', { class: 'name' }, name), h('div', { class: 'help' }, help), derived ? h('div', { class: 'derived' }, derived) : null), control);
  const changed = (path) => (changes().some((c) => c.path === path || c.path.startsWith(`${path}.`)) ? ' changed' : '');
  function num(value, onChange, path, opts) {
    const o = opts || {};
    const el = h('input', { class: `num${changed(path)}`, 'data-focus-key': path, type: 'number', step: o.step || 'any', min: o.min, max: o.max, disabled: !C.canEdit() || null });
    el.value = value === undefined || value === null || !Number.isFinite(Number(value)) ? '' : String(value);
    el.addEventListener('input', () => { const v = el.value === '' ? undefined : Number(el.value); onChange(Number.isFinite(v) ? v : undefined); });
    return el;
  }
  function sel(value, options, onChange, path) {
    const el = h('select', { class: changed(path).trim() || null, 'data-focus-key': path, disabled: !C.canEdit() || null },
      ...options.map(([v, label]) => h('option', { value: v, selected: String(v) === String(value) || null }, label)));
    el.addEventListener('change', () => onChange(el.value));
    return el;
  }
  function txt(value, onChange, path, placeholder) {
    const el = h('input', { class: `txt${changed(path)}`, 'data-focus-key': path, placeholder, disabled: !C.canEdit() || null });
    el.value = value === undefined || value === null ? '' : String(value);
    el.addEventListener('input', () => onChange(el.value));
    return el;
  }

  function slotDials(host) {
    const d = dialsFor();
    const base = `slots.${S.slot}`;
    const gamma = Number.isFinite(d.gamma) ? d.gamma : 0;
    put(host,
      dial('Trust in what was learned', 'How much the learned lift moves a piece’s score: the final score is the base score times the lift raised to this. At 0 the lift is computed and shown on every receipt and changes nothing that is served; at 1 it applies in full.',
        num(d.gamma, (v) => { if (v === undefined) delete d.gamma; else d.gamma = v; scheduleCheck(); }, `${base}.gamma`, { min: 0, max: 1, step: 0.05 }),
        gamma === 0 ? 'Shadow: learning is visible and inert.' : `A lift of 1.4 becomes ×${dec(Math.pow(1.4, gamma))} on the score.`),
      dial('What counts as paying off', 'The outcome this slot learns against. One per slot; the others still land in the ledger and can be reported on.',
        sel(d.reward || 'click', REWARDS.map((r) => [r, words(r)]), (v) => { d.reward = v; scheduleCheck(); }, `${base}.reward`)),
      dial('What a success is worth', 'Unit counts each one the same. Revenue weighs it by the order value, margin by the margin the feed gives. Revenue and margin need a reward that carries a value: a purchase, or an add to bag.',
        sel(d.objective || 'unit', [['unit', 'unit'], ['revenue', 'revenue'], ['margin', 'margin']], (v) => { if (v === 'unit') delete d.objective; else d.objective = v; scheduleCheck(); }, `${base}.objective`)),
      h('div', { class: 'subhead' }, 'Trying things it has not tried'),
      dial('How it explores', 'Rotation shows the least-observed piece on a share of decisions. Thompson samples each piece’s rate and ranks on the sample. Epsilon picks uniformly. Every exploring decision is flagged on its receipt.',
        sel((d.exploration || {}).mode || 'off', [['off', 'off'], ['rotation', 'rotation'], ['thompson', 'thompson'], ['epsilon', 'epsilon']], (v) => {
          if (v === 'off') delete d.exploration;
          else d.exploration = { mode: v, share: (d.exploration || {}).share ?? 0.1, floor: (d.exploration || {}).floor ?? 50 };
          scheduleCheck();
        }, `${base}.exploration.mode`)),
      d.exploration ? dial('How often', 'The share of this slot’s decisions kept for exploring.',
        num(d.exploration.share, (v) => { d.exploration.share = v ?? 0; scheduleCheck(); }, `${base}.exploration.share`, { min: 0, max: 1, step: 0.01 }),
        `${pct(d.exploration.share)} of decisions`) : null,
      d.exploration ? dial('Until it has seen', 'Observations below which a piece counts as under-observed and is worth showing again.',
        num(d.exploration.floor, (v) => { d.exploration.floor = v ?? 0; scheduleCheck(); }, `${base}.exploration.floor`, { min: 0, step: 1 })) : null,
      h('div', { class: 'subhead' }, 'How much it may change on its own'),
      dial('Autonomy', 'Configured: the weights are what a person set. Assisted: the daily cycle proposes one bounded move with its evidence and a person applies or rejects it. Autonomous: the same move is applied within the bounds, as a new revision with the evidence in its note.',
        sel((d.autonomy || {}).mode || 'configured', [['configured', 'configured'], ['assisted', 'assisted'], ['autonomous', 'autonomous']], (v) => {
          if (v === 'configured') delete d.autonomy;
          else d.autonomy = { mode: v, step: (d.autonomy || {}).step ?? 0.05, min: (d.autonomy || {}).min ?? 0, max: (d.autonomy || {}).max ?? 1, pinned: (d.autonomy || {}).pinned ?? [], minN: (d.autonomy || {}).minN ?? 500 };
          scheduleCheck();
        }, `${base}.autonomy.mode`)),
      d.autonomy ? dial('The most one weight may move', 'Per cycle. Small steps and a daily cadence are what make it reversible.',
        num(d.autonomy.step, (v) => { d.autonomy.step = v ?? 0.05; scheduleCheck(); }, `${base}.autonomy.step`, { min: 0.01, max: 1, step: 0.01 })) : null,
      d.autonomy ? dial('The range it may not leave', 'The hard floor and ceiling for any weight.',
        h('div', {}, num(d.autonomy.min, (v) => { d.autonomy.min = v ?? 0; scheduleCheck(); }, `${base}.autonomy.min`, { min: 0, max: 1, step: 0.05 }),
                     num(d.autonomy.max, (v) => { d.autonomy.max = v ?? 1; scheduleCheck(); }, `${base}.autonomy.max`, { min: 0, max: 1, step: 0.05 }))) : null,
      d.autonomy ? dial('Before it may act at all', 'Exposures this slot must have seen before a cycle may move anything.',
        num(d.autonomy.minN, (v) => { d.autonomy.minN = v ?? 500; scheduleCheck(); }, `${base}.autonomy.minN`, { min: 1, step: 1 })) : null,
      d.autonomy ? dial('Weights it may never touch', 'Comma separated. A dimension a merchandiser has committed to stays where they put it.',
        txt((d.autonomy.pinned || []).join(', '), (v) => { d.autonomy.pinned = v.split(',').map((x) => x.trim()).filter(Boolean); scheduleCheck(); }, `${base}.autonomy.pinned`, 'occasion, line')) : null,
      h('div', { class: 'subhead' }, 'Their own model, on this slot'),
      dial('How much this slot trusts it', 'Their model’s score joins the base score as a driver named external, at this weight. 0 switches the term off for this slot. The model itself is configured for the whole brand, below.',
        num((d.external || {}).weight, (v) => { if (v === undefined || v === 0) delete d.external; else d.external = { weight: v }; scheduleCheck(); }, `${base}.external.weight`, { min: 0, max: 1, step: 0.05 }),
        dl.draft.external ? `${dl.draft.external.kind} · ${dl.draft.external.ref}` : 'No model configured for this brand.'),
    );
  }

  function brandDials(host) {
    const D = dl.draft;
    D.holdout = D.holdout || { share: 0.05, salt: '', arms: ['default'] };
    const pol = D.policy || null, st = D.stats || null, reg = D.regional || null, ext = D.external || null;
    put(host,
      h('div', { class: 'subhead' }, 'The holdout: how we know any of this works'),
      dial('Held out of personalization', 'The share of visitors kept out, chosen by a stable hash so a visitor stays where she was put. The default arm sees the site’s own defaults; a no-learning arm sees personalization without the learned lift.',
        num(D.holdout.share, (v) => { D.holdout.share = v ?? 0; scheduleCheck(); }, 'holdout.share', { min: 0, max: 1, step: 0.01 }), `${pct(D.holdout.share)} of visitors`),
      dial('Which arms exist', 'Two arms answer different questions: the default arm measures personalization against nothing, the no-learning arm measures what learning adds on top of it.',
        sel(D.holdout.arms.includes('no_learning') ? 'both' : 'default', [['default', 'default only'], ['both', 'default and no learning']], (v) => { D.holdout.arms = v === 'both' ? ['default', 'no_learning'] : ['default']; scheduleCheck(); }, 'holdout.arms')),
      h('div', { class: 'subhead' }, 'Which decision an outcome pays'),
      dial('How far back it may look', 'Session: an outcome may only credit decisions in the same session. Visitor: any of that visitor’s recent decisions.',
        sel(pol ? pol.scope : 'session', [['session', 'the same session'], ['visitor', 'any recent session']], (v) => { D.policy = { ...(pol || { match: 'direct', credit: 'last', windowsMs: {} }), scope: v }; scheduleCheck(); }, 'policy.scope')),
      dial('What must match', 'Direct: the outcome must name the piece that was served. Any: any decision in scope and in the window is eligible.',
        sel(pol ? pol.match : 'direct', [['direct', 'the same piece'], ['any', 'any piece']], (v) => { D.policy = { ...(pol || { scope: 'session', credit: 'last', windowsMs: {} }), match: v }; scheduleCheck(); }, 'policy.match')),
      dial('Which one is paid', 'The last decision before the outcome, or the first.',
        sel(pol ? pol.credit : 'last', [['last', 'the last before it'], ['first', 'the first']], (v) => { D.policy = { ...(pol || { scope: 'session', match: 'direct', windowsMs: {} }), credit: v }; scheduleCheck(); }, 'policy.credit')),
      ...REWARDS.map((r) => dial(`How long a ${words(r)} may credit`, 'Minutes after a decision that this outcome may still be paid to it.',
        num(Math.round((((pol || {}).windowsMs || {})[r] ?? DEFAULT_WINDOWS[r]) / MIN), (v) => {
          D.policy = pol || { scope: 'session', match: 'direct', credit: 'last', windowsMs: {} };
          D.policy.windowsMs = D.policy.windowsMs || {};
          if (v === undefined) delete D.policy.windowsMs[r]; else D.policy.windowsMs[r] = v * MIN;
          scheduleCheck();
        }, `policy.windowsMs.${r}`, { min: 1, step: 1 }),
        humanMs(((pol || {}).windowsMs || {})[r] ?? DEFAULT_WINDOWS[r]))),
      h('div', { class: 'subhead' }, 'How careful the arithmetic is'),
      dial('How much the slot’s own rate is worth', 'A piece with little evidence is judged mostly on what the slot achieves anyway. This is how many observations that assumption is worth. An imported prior brings its own.',
        num(st ? st.n0 : 30, (v) => { D.stats = { ...(st || { tauLearnMs: 21 * DAY, liftMin: 0.5, liftMax: 2, nMin: 30 }), n0: v ?? 30 }; scheduleCheck(); }, 'stats.n0', { min: 1, step: 1 })),
      dial('How long evidence lasts', 'Days over which what was learned decays: what happened this long ago counts about a third as much.',
        num(st ? C.r3(st.tauLearnMs / DAY) : 21, (v) => { D.stats = { ...(st || { n0: 30, liftMin: 0.5, liftMax: 2, nMin: 30 }), tauLearnMs: (v ?? 21) * DAY }; scheduleCheck(); }, 'stats.tauLearnMs', { min: 1, step: 1 })),
      dial('The most learning may move a score', 'The least and the most a learned lift may be. Half and double lets learning matter without letting it take over.',
        h('div', {}, num(st ? st.liftMin : 0.5, (v) => { D.stats = { ...(st || { n0: 30, tauLearnMs: 21 * DAY, liftMax: 2, nMin: 30 }), liftMin: v ?? 0.5 }; scheduleCheck(); }, 'stats.liftMin', { min: 0.01, max: 1, step: 0.05 }),
                     num(st ? st.liftMax : 2, (v) => { D.stats = { ...(st || { n0: 30, tauLearnMs: 21 * DAY, liftMin: 0.5, nMin: 30 }), liftMax: v ?? 2 }; scheduleCheck(); }, 'stats.liftMax', { min: 1, step: 0.1 }))),
      dial('Before a context answers for itself', 'Exposures a context must have before its own rate is used; below it the next coarser context answers, up to everyone.',
        num(st ? st.nMin : 30, (v) => { D.stats = { ...(st || { n0: 30, tauLearnMs: 21 * DAY, liftMin: 0.5, liftMax: 2 }), nMin: v ?? 30 }; scheduleCheck(); }, 'stats.nMin', { min: 1, step: 1 })),
      h('div', { class: 'subhead' }, 'What the region is doing'),
      dial('Blend the region in', 'Whether what is trending among shoppers in the visitor’s region is blended into the base score, itemised on every receipt.',
        sel(reg && reg.enabled ? 'on' : 'off', [['on', 'on'], ['off', 'off']], (v) => { D.regional = { ...(reg || { kBlend: 1, minEvents: 30 }), enabled: v === 'on' }; scheduleCheck(); }, 'regional.enabled')),
      reg && reg.enabled ? dial('How much of her own signal outweighs it', 'A brand-new visitor is decided on the region alone; this sets how much of her own behaviour it takes to outweigh that.',
        num(reg.kBlend, (v) => { D.regional = { ...reg, kBlend: v ?? 1 }; scheduleCheck(); }, 'regional.kBlend', { min: 0.01, max: 100, step: 0.1 })) : null,
      reg && reg.enabled ? dial('Before a region counts', 'Events a region needs before its trend is used; below it the country answers, then everyone.',
        num(reg.minEvents, (v) => { D.regional = { ...reg, minEvents: v ?? 30 }; scheduleCheck(); }, 'regional.minEvents', { min: 1, step: 1 })) : null,
      h('div', { class: 'subhead' }, 'Their own model, for every slot'),
      dial('Where it lives', 'Service: a worker they own behind a binding, or an https address. Table: a scoring table they publish. Workers AI: a hosted model that answers in the agreed shape.',
        sel(ext ? ext.kind : 'none', [['none', 'none'], ['service', 'service'], ['table', 'table'], ['workers_ai', 'workers AI']], (v) => {
          if (v === 'none') delete D.external;
          else D.external = { kind: v, ref: (ext || {}).ref || '', timeoutMs: (ext || {}).timeoutMs || 20, fallback: 'omit' };
          scheduleCheck();
        }, 'external.kind')),
      ext ? dial('Which one', 'The binding name, the table key, the model id, or the address.',
        txt(ext.ref, (v) => { D.external = { ...ext, ref: v }; scheduleCheck(); }, 'external.ref', 'MODEL, or https://…')) : null,
      ext ? dial('How long it may take', 'Milliseconds, spent in parallel with the engine’s own reads. Past it the term is left out and the receipt says why.',
        num(ext.timeoutMs, (v) => { D.external = { ...ext, timeoutMs: v ?? 20 }; scheduleCheck(); }, 'external.timeoutMs', { min: 1, max: 5000, step: 1 })) : null,
    );
  }

  C.view({
    id: 'dials', group: 'This slot', title: 'Dials', heading: 'What the engine may do',
    hint: 'Everything here takes effect without a deployment, as a new revision with your note on it. Nothing is applied until you save.',
    async enter() { await loadDials(); },
    render(host) {
      if (!dl.draft) { host.append(h('div', { class: 'empty' }, 'Loading the dials…')); return; }
      const n = changes().length;
      C.dirty({
        count: n,
        checking: dl.checking,
        blocked: dl.errors.length > 0,
        save: saveDials,
        discard: () => { dl.draft = copy(dl.doc); dl.errors = []; C.render(); },
      });
      if (dl.errors.length) host.append(h('div', { class: 'msg err' }, 'The dials as drafted were refused:', h('ul', {}, ...dl.errors.map((e) => h('li', {}, String(e))))));
      host.append(h('div', { class: 'sub', style: 'margin-bottom:10px' },
        dl.source === 'stored' ? `Reading revision ${fmt(dl.revision)} of the learn document.` : 'Nothing stored for this brand yet: these are the settings the engine shipped with.'));
      const slotCard = card(S.slot ? `This slot: ${S.slot}` : 'This slot', 'What the engine may do in this one place.', h('div', { class: 'body' }));
      if (S.slot) slotDials(slotCard.querySelector('.body')); else slotCard.querySelector('.body').append(needSlot());
      host.append(slotCard);
      const brandCard = card('Every slot on this brand', 'Measurement, attribution and the arithmetic. These apply everywhere.', h('div', { class: 'body' }));
      brandDials(brandCard.querySelector('.body'));
      host.append(brandCard);
    },
  });

  // ══════════════════════════════════════════════════════ Proposals ══════════
  const props = { list: null, error: '' };
  C.view({
    id: 'proposals', group: 'Attention', title: 'Proposals', heading: 'What the cycle proposes',
    hint: 'A slot in assisted mode gets one bounded move a day, with the evidence behind it. Nothing moves until a person applies it.',
    async enter() {
      const res = await C.v1('/learn/proposals');
      props.list = res.ok ? res.data.proposals || [] : null;
      props.error = res.ok ? '' : (res.status === 401 || res.status === 403 ? 'Sign in to read the proposals.' : res.data.error || 'Could not read the proposals.');
    },
    render(host) {
      if (props.error) { host.append(h('div', { class: 'msg note' }, props.error)); return; }
      const list = (props.list || []).slice().reverse();
      if (!list.length) { host.append(h('div', { class: 'empty' }, 'No proposals. A slot in assisted mode gets one from the daily cycle once it has seen enough exposures.')); return; }
      for (const p of list.slice(0, 40)) {
        const ev = (p.evidence || [])[0];
        host.append(card(`${p.slot} · ${p.dimension}`, null, h('div', { class: 'body' },
          h('div', { class: 'kv' },
            h('span', { class: 'k' }, 'Proposed'), h('span', { class: 'v' }, `${p.dimension} from ${dec(p.from)} to ${dec(p.to)}`),
            h('span', { class: 'k' }, 'Because'), h('span', { class: 'v' }, ev ? `${ev.dimension} separates outcomes by ${dec(ev.spread)}, over ${plural(Math.round(p.exposures), 'exposure')}` : `${plural(Math.round(p.exposures), 'exposure')}`),
            h('span', { class: 'k' }, 'Status'), h('span', { class: 'v' }, `${p.status} · ${p.mode} · ${when(p.at)}`),
            ...(p.note ? [h('span', { class: 'k' }, 'Note'), h('span', { class: 'v' }, p.note)] : []),
          ),
          p.status !== 'proposed' ? null : h('div', { style: 'margin-top:8px' },
            h('button', { class: 'small', disabled: !C.canEdit(), onclick: () => decide(p.id, 'apply') }, 'Apply it'), ' ',
            h('button', { class: 'small warn', disabled: !C.canEdit(), onclick: () => decide(p.id, 'reject') }, 'Reject it')),
        )));
      }
    },
  });
  async function decide(id, decision) {
    const res = await C.write(`/v1/${encodeURIComponent(S.scope)}/learn/proposals/${encodeURIComponent(id)}/${decision}`, 'POST', {});
    if (!res.ok || res.data.ok === false) { C.render(); return; }
    C.flash(decision === 'apply' ? `Applied, as slots revision ${fmt(res.data.revision)}.` : 'Rejected. The weights did not move.');
    const again = await C.v1('/learn/proposals');
    props.list = again.ok ? again.data.proposals || [] : props.list;
    C.render();
  }

  // ═══════════════════════════════════════════════════════ Erasures ══════════
  const er = { pending: null, retentionDays: 0, error: '' };
  C.view({
    id: 'erasures', group: 'Attention', title: 'Erasures', heading: 'Shoppers who asked to be forgotten',
    hint: 'Every reader honours a tombstone the moment it is written, so nothing this names is served, reported or learned from. The rows leave the ledger on the nightly rewrite.',
    async enter() {
      const res = await C.v1('/ledger/erasures');
      er.pending = res.ok ? res.data.pending || [] : null;
      er.retentionDays = res.ok ? res.data.retentionDays || 0 : 0;
      er.error = res.ok ? '' : (res.status === 401 || res.status === 403 ? 'Sign in to read the erasures.' : res.data.error || 'Could not read the erasures.');
    },
    render(host) {
      if (er.error) { host.append(h('div', { class: 'msg note' }, er.error)); return; }
      const rows = (er.pending || []).map((t) => h('tr', {},
        h('td', {}, h('div', { class: 'itemid' }, t.visitor_id)),
        h('td', {}, when(t.erased_at)),
        h('td', {}, t.actor || 'unknown'),
        h('td', { class: 'num' }, fmt(t.rows_removed || 0)),
        h('td', { class: 'num' }, fmt(t.objects_rewritten || 0)),
      ));
      host.append(card(null, null,
        h('div', { class: 'toolbar' },
          h('span', { class: 'sub' }, `Ledger rows are kept ${plural(er.retentionDays, 'day')}; a tombstone older than that is retired once its rows have gone.`),
          h('span', { class: 'spacer' }),
          h('button', { class: 'small', disabled: !C.canEdit(), title: 'Run now what the nightly job runs', onclick: rewrite }, 'Run the rewrite now')),
        rows.length ? C.table([
          { key: 'visitor', label: 'Shopper' },
          { key: 'at', label: 'Asked' },
          { key: 'actor', label: 'Recorded by' },
          { key: 'rows', label: 'Rows removed', num: true },
          { key: 'objects', label: 'Batches rewritten', num: true },
        ], rows) : h('div', { class: 'empty' }, 'Nothing pending. Every erasure asked for has been carried through the ledger.')));
    },
  });
  async function rewrite() {
    const res = await C.write(`/v1/${encodeURIComponent(S.scope)}/ledger/erasures/rewrite`, 'POST', {});
    if (!res.ok || res.data.ok === false) { C.render(); return; }
    C.flash(`Rewrote ${plural(res.data.objectsRewritten || 0, 'batch', 'batches')} and removed ${plural(res.data.rowsRemoved || 0, 'row')}.`);
    const again = await C.v1('/ledger/erasures');
    er.pending = again.ok ? again.data.pending || [] : er.pending;
    C.render();
  }

  C.start();
})();
