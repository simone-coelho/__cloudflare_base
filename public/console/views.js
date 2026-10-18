/* eslint-env browser */
// public/console/views.js
// ---------------------------------------------------------------------------
// The views. Each one registers itself with the shell, owns its own data, and
// asks the SERVER for a page whenever the list can grow with the catalog.
//
//   Work       what needs a person, as counts with links (doc 28 §3.5)
//   Lift       the grid: one pooled row per item, paged; an item opens its cells
//   Slots      every slot on every page, what is set on it and what it has learned
//   Dials      the learn document for this slot, and for the brand
//   Proposals  historical records, read-only and unverified
//   Erasures   the tombstones the ledger honours, and the rewrite
//   Vocabulary P38: the attribute vocabulary, its approval and what it refused
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
  // W28.R5: a retained exploration setting the engine does not run, named in the
  // words the Dials editor below already uses for it, so every surface says the same.
  const storedModeWords = (mode) => `Stored ${String(mode).charAt(0).toUpperCase()}${String(mode).slice(1)} — inactive`;
  /** The retained mode a slots row names (`configuredMode` with `unsupported`; `configuredExploration` from an older server), or null. */
  const retainedModeOf = (s) => (s.unsupported && s.configuredMode) || s.configuredExploration || null;
  // P09 (decision D1; freeze items 23 and 39): the performance percentage P, from 0
  // to 100, is the tuning screen's form of a dial the learn document already
  // stores, never a second stored value. On a slot whose learn dials opt into the
  // layout blend (P28's `blend`) it is the blend weight p × 100; on every other
  // slot, content slots and layout slots that do not opt in alike, it is γ × 100.
  // A dial the document does not name reads 0, as the decision reads it.
  /** The slot's blend opt-in as the decision reads one: an object whose `p` is absent or a number from 0 to 1; otherwise none. */
  function blendOptIn(d) {
    const b = d ? d.blend : undefined;
    if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
    return b.p === undefined || (typeof b.p === 'number' && Number.isFinite(b.p) && b.p >= 0 && b.p <= 1) ? b : null;
  }
  /** The stored dial, 0 to 1, the slot's percentage is the form of: `blend.p` on a slot in the blend, `gamma` on every other. */
  function percentDial(d) {
    const v = blendOptIn(d) ? blendOptIn(d).p : d ? d.gamma : undefined;
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  }
  /** A dial from 0 to 1 as its percentage, read as decimals: γ 0.35 shows as 35 and 0.333 as 33.3, never 33.300000000000004. */
  const asPercent = (v) => String(Number((v * 100).toPrecision(15)));
  /** A percentage from 0 to 100 as the dial it stands for, P / 100 read as decimals: 33.3 saves 0.333, never 0.33299999999999996. */
  const fromPercent = (P) => Number((P / 100).toPrecision(15));
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
  const noEvidence = () => C.slotList().filter((s) => !s.evidence || !s.evidence.items).length;
  const held = () => C.slotList().reduce((n, s) => n + (s.controls || 0), 0);

  C.view({
    id: 'work', group: 'Attention', title: 'Work', heading: 'What needs a person',
    hint: 'Counts, and where to go. The engine runs without any of this; these are the decisions it will not take on its own.',
    badge: () => S.refusals.length || null,
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
        q(work.proposals ? work.proposals.length : null, 'Historical proposals listed', 'Read-only, unverified records. Autonomy is unavailable; this bounded listing is not a complete audit trail.', C.href('proposals')),
        q(S.refusals.length, 'Saves refused, in this browser', 'A change this browser tried that the platform would not take. They are not stored; they are gone when you close the tab.', S.refusals.length ? C.href('work') : null, true),
        q(noEvidence(), 'Slots with nothing learned yet', 'Configured, but no snapshot has been published for them. A slot publishes about thirty seconds after the first decision it serves.', C.href('slots')),
        q(held(), 'Items a person is holding', 'Frozen at a lift, or rejected so the learned lift is ignored. Each one is a merchandiser overruling the evidence, on purpose.', C.href('slots')),
        q(work.erasures ? work.erasures.length : null, 'Erasures pending a rewrite', 'A shopper asked to be forgotten. Every reader honours the tombstone at once; the rows leave the ledger on the nightly rewrite.', C.href('erasures')),
      ));
      if (work.denied) host.append(h('div', { class: 'msg note' }, 'Two of these counts read authenticated routes: sign in to fill the proposals and the erasures.'));
      host.append(card('What this page cannot count yet',
        'Doc 28 asks for one route that answers the whole queue. Until it exists this page counts what the listings it can already read will tell it, and says so rather than guessing.',
        h('div', { class: 'body' }, h('div', { class: 'kv' },
          h('span', { class: 'k' }, 'Counted here'), h('span', { class: 'v' }, 'historical proposals listed, erasures pending, slots with nothing learned, items held by a person'),
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
    const scope = S.scope;
    const authority = await C.content('/learn');
    if (scope !== S.scope) return;
    lift.authored = authority.ok ? C.authored(authority.data) : null;
    lift.document = authority.ok ? authority.data.document : null;
    if (!S.slot) { st.data = null; return; }
    st.loading = true; C.render();
    const item = S.params.item || '';
    const res = await C.v1('/lift/rows', {
      slot: S.slot,
      // W26 R2: the placement's page, where the catalogue carries this slot name on more than one page.
      page: S.params.page || undefined,
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
      // W26 R2 (review D4): a slot name on more than one page is one placement
      // per page; the route names the pages, and the operator picks one.
      st.pages = res.status === 400 && Array.isArray(res.data.pages) ? res.data.pages : null;
      st.data = null; C.render(); return;
    }
    st.error = '';
    st.data = res.data;
    lift.meta = res.data;
    C.render();
  }

  /** Freeze, reject or clear, on one item or on a selection: read, patch, write, in one revision. */
  async function setControls(items, control) {
    if (!lift.document || !lift.authored) { S.errors = ['Learning authority unavailable; controls are not writable.']; C.render(); return; }
    const doc = copy(lift.document);
    doc.slots = doc.slots || {};
    const d = (doc.slots[S.slot] = doc.slots[S.slot] || {});
    d.items = d.items || {};
    for (const item of items) { if (control) d.items[item] = control; else delete d.items[item]; }
    if (!Object.keys(d.items).length) delete d.items;
    const what = control ? (control.mode === 'freeze' ? `froze ${plural(items.length, 'item')} at their current lift` : `rejected the learned lift on ${plural(items.length, 'item')}`) : `cleared the control on ${plural(items.length, 'item')}`;
    const res = await C.write(`/content/learn${C.query({ scope: S.scope })}`, 'PUT', { document: doc, note: `${what} in ${S.slot}` }, lift.authored);
    if (!res.ok || res.data.ok === false) { C.render(); return; }
    lift.chosen.clear();
    C.flash(`${what[0].toUpperCase()}${what.slice(1)} in ${S.slot}, as learn revision ${fmt(res.data.revision)}.`);
    await Promise.all([loadLift(lift.st.cursors[lift.st.at]), C.loadSlots()]);
  }

  async function resetItem(item, name) {
    if (!window.confirm(`Discard the evidence for ${name} in ${S.slot} and start again from the prior?`)) return;
    const res = await C.write(`/v1/${encodeURIComponent(S.scope)}/learn/items/reset`, 'POST', { slot: S.slot, item, brand: S.brand, ...(S.params.page ? { page: S.params.page } : {}) }, lift.authored);
    if (!res.ok || res.data.ok === false) { C.render(); return; }
    C.flash(res.data.had
      ? `Evidence for ${name} discarded; snapshot publication status is reported separately, recorded as revision ${fmt(res.data.revision)}.`
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
    hint: 'One row per piece: its admitted exposure basis, weighted credits, and the ranking multiplier. The server cuts the page; opening a piece shows the contexts it was shown in.',
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
          ? h('button', { class: 'small', onclick: () => C.go('lift', { item: '', page: S.params.page }) }, '← Every piece')
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

      if (st.error) {
        host.append(toolbar, h('div', { class: 'msg err' }, st.error,
          st.pages ? h('div', { style: 'margin-top:6px' }, ...st.pages.map((page) => h('button', { class: 'small', onclick: () => C.go('lift', { page, item: '' }) }, `The ${page} page's ${S.slot}`))) : null));
        return;
      }
      // P45 (R-P78): the stale marker of the answer this screen holds, or null (nothing drawn).
      const stale = staleMark(meta);
      if (!meta || meta.published === false) {
        // P51 (R-P78): P49's republish cause, right after P45's mark, beside the message as P45's mark is.
        const republished = republishedMark(meta, false);
        host.append(toolbar, ...(stale ? [stale] : []), ...(republished ? [republished] : []), h('div', { class: 'empty' }, 'Nothing published for this slot yet. The first snapshot publishes about thirty seconds after the first decision it serves.'));
        return;
      }

      const line = [
        `reward ${words(meta.reward)}`,
        `basis ${meta.measurementBasis || 'served-v1'} (rendered means client-reported, not visibility proof)`,
        meta.objective && meta.objective !== 'unit' ? `weighed by ${meta.objective}` : '',
        `prior strength ${fmt(meta.n0)}`,
        `evidence threshold ${fmt(meta.nMin)}`,
        meta.publishedAt ? `published ${when(meta.publishedAt)}` : '',
      ].filter(Boolean).join(' · ');

      const cols = [
        ...(item ? [] : [{ key: 'pick', label: '' }]),
        { key: 'name', label: 'Piece', sortable: true },
        ...(item ? [{ key: 'key', label: 'Context', sortable: true }] : []),
        { key: 'n', label: 'Exposures', sym: 'n', num: true, sortable: true, title: 'Decayed admitted exposures on this snapshot’s served or rendered basis' },
        { key: 's', label: 'Weighted credit', sym: 's', num: true, sortable: true, title: 'How many of those led to the outcome this slot learns against, weighed by its objective' },
        { key: 'p_hat', label: 'Credit / exposure', sym: 'p̂', num: true, sortable: true, title: 'Smoothed weighted credit per exposure, toward the selected compatible prior target; not always a probability' },
        { key: 'p0', label: 'Slot credit / exposure', sym: 'p₀', num: true, sortable: true, title: 'What this slot achieves in the same context, whatever it shows' },
        { key: 'lift', label: 'Lift', sym: 'p̂ / p₀', num: true, sortable: true, title: 'The rate over the slot’s rate, clamped. Above 1 is better than the slot’s average' },
        { key: 'evidence', label: 'Evidence', sym: 'n / (n + n₀)', num: true, sortable: true, title: 'How much of the rate is live observation rather than the prior' },
        // W26 R5 (F21 §8 "report the lift table as a diagnostic that is not corrected for position or placement"):
        // what each row's lift corrects for, from the row's own `correction`. Nothing, today.
        { key: 'correction', label: 'Correction', title: 'What this lift is corrected for. uncorrected-v1: neither the position a piece was shown at nor the placement it was shown in, so it is a diagnostic, not incremental lift' },
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
                 : h('button', { class: 'link', title: 'Show the contexts this piece was shown in', onclick: () => C.go('lift', { item: r.item, page: S.params.page }) }, name),
            h('div', { class: 'itemid' }, r.item)),
          ...(item ? [h('td', {}, h('div', {}, r.level_words || 'everyone'), r.key === '*' ? null : h('div', { class: 'cellkey' }, r.key))] : []),
          h('td', { class: 'num' }, dec(r.n)),
          h('td', { class: 'num' }, dec(r.s)),
          h('td', { class: 'num' }, dec(r.p_hat)),
          h('td', { class: 'num' }, dec(r.p0)),
          h('td', { class: 'num' }, h('strong', {}, dec(r.lift))),
          h('td', { class: 'num' }, pct(r.evidence)),
          h('td', { title: 'not corrected for position or placement' }, correctionOf(r)),
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
        stale,
        republishedMark(meta, true),
        rows.length ? C.table(cols, body, { sort: lift.sort, onSort: sortBy }) : empty,
        C.pager(st, item ? 'context' : 'piece', loadLift),
      ));
    },
  });

  /**
   * P45 (R-P78; P42's marker): when the lift/rows answer the screen holds carries `stale`, ONE element
   * beside the numbers it qualifies, worded from the marker's members alone: the faulty placement's
   * page and slot, the pooled modules this slot reads from it (as P42's refusal names them), and the
   * last successful publication, its version and time, or that the slot has none yet. It is drawn
   * from the answer `loadLift` already keeps, so it asks for nothing, and every later read replaces
   * that answer: once a publication succeeds the next read carries no marker and nothing is drawn,
   * which leaves the screen exactly as it was before P45.
   */
  function staleMark(meta) {
    const s = meta && meta.stale;
    // An answer for another slot (the screen redraws while the next slot's read is in flight) marks nothing here.
    if (!s || typeof s !== 'object' || (typeof meta.slot === 'string' && meta.slot !== S.slot)) return null;
    const p = s.placement || {};
    const modules = Array.isArray(s.modules) ? s.modules.filter((m) => typeof m === 'string' && m) : [];
    const last = s.lastPublished && Number.isFinite(s.lastPublished.version) ? s.lastPublished : null;
    const at = last ? when(last.publishedAt) : '';
    const cause = `a publication of this slot was refused because the statistics of page ${p.page || 'unnamed'}, slot ${p.slot || 'unnamed'} could not be read`
      + (modules.length ? ` for the pooled module${modules.length > 1 ? 's' : ''} ${modules.join(', ')}` : '');
    const held = last
      ? `these numbers stay those of version ${last.version}${at ? `, published ${at}` : ''}, the slot's last successful publication, until a publication succeeds`
      : 'the slot has no successful publication yet and stays unpublished until a publication succeeds';
    return h('div', { class: 'msg note', 'data-lift-stale': true, style: 'margin:8px 14px' }, `${last ? 'Stale' : 'Unpublished'}: ${cause}; ${held}.`);
  }

  /**
   * P51 (R-P78; P49's member): when the lift/rows answer the screen holds carries `republished`, ONE element
   * right after P45's mark (in its place when only this one applies), worded from the member's members alone:
   * the slot, with its page on a page-scoped placement; each entry of `changed`, in the order served, with its
   * old and new values; and what ends it under P50's rule (R-P84): a new generation adopts a changed reward or
   * objective only when its body names the new value and takes a changed `stats.*` value from the document,
   * no generation moves a changed measurementBasis, which only a learn republish with the old basis restores,
   * and a republish with every old value ends it outright. `published` says which screen holds it: the grid
   * (the numbers stay those of the last successful publication) or the "Nothing published" message (the slot
   * stays unpublished). Like P45's mark it is drawn from the answer `loadLift` already keeps, so it asks for
   * nothing, and an answer without the member draws nothing, which leaves the screen exactly as before P51.
   */
  function republishedMark(meta, published) {
    const r = meta && meta.republished;
    // An answer for another slot (the screen redraws while the next slot's read is in flight) marks nothing here.
    if (!r || typeof r !== 'object' || (typeof meta.slot === 'string' && meta.slot !== S.slot)) return null;
    const changed = Array.isArray(r.changed) ? r.changed.filter((c) => c && typeof c.member === 'string' && c.member) : [];
    const said = (v) => (v === null || v === undefined || v === '' ? 'none' : String(v));
    const and = (parts) => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] || '');
    const slot = typeof r.slot === 'string' && r.slot ? r.slot : 'unnamed';
    const page = typeof r.page === 'string' && r.page ? r.page : '';
    const basis = changed.filter((c) => c.member === 'measurementBasis');
    const others = changed.filter((c) => c.member !== 'measurementBasis');
    const restored = (list) => and(list.map((c) => `${c.member} ${said(c.old)}`)) || 'the old values';
    const adopted = others.filter((c) => c.member === 'reward' || c.member === 'objective').map((c) => `${c.member} ${said(c.new)}`);
    // The route takes a transition whose body names a reward, an objective or a rebuild day; a `stats.*` change
    // alone is taken from the document by one that names the slot's own reward.
    const own = published && typeof meta.reward === 'string' && meta.reward ? `reward ${meta.reward}` : 'the slot\'s own reward';
    const body = and([`slot ${slot}`, ...(page ? [`page ${page}`] : []), ...(adopted.length ? adopted : [own])]);
    const generation = `an operator starts the new generation with POST /v1/${S.scope}/learn/generation, its body naming ${body}`;
    const cause = `publications of ${page ? `page ${page}, slot ${slot}` : `slot ${slot}`} are refused because the learn document was republished with `
      + (changed.length ? and(changed.map((c) => `${c.member} changed from ${said(c.old)} to ${said(c.new)}`)) : 'a change to what the slot\'s statistics accumulate under');
    const held = published
      ? 'these numbers stay those of the slot\'s last successful publication until a publication succeeds'
      : 'the slot has no successful publication yet and stays unpublished until a publication succeeds';
    const ends = basis.length
      ? `; no generation transition moves the measurement basis, so a publication succeeds only once the learn document is republished with ${restored(changed)}`
        + (others.length ? `, or with ${restored(basis)} and then ${generation}` : '')
      : `, which happens once ${generation}, or once the learn document is republished with ${restored(changed)}`;
    return h('div', { class: 'msg note', 'data-lift-republished': true, style: 'margin:8px 14px' }, `Republished: ${cause}; ${held}${ends}.`);
  }

  /** W26 R5: the row's own correction; a row from a server that sends none is the uncorrected diagnostic it always was. */
  function correctionOf(r) {
    return typeof r.correction === 'string' && r.correction ? r.correction : 'uncorrected-v1';
  }

  function downloadPage(rows, item) {
    // W26 X1.01: `correction` is the LAST column, after every existing one, so a
    // reader who parses this file by position keeps reading it. It says what the
    // lift corrects for: nothing, today — neither the position a piece was shown
    // at nor the placement it was shown in.
    const head = ['item', 'your_id', 'title', 'context', 'measurement_basis', 'objective', 'exposures_n', 'weighted_credit_s', 'credit_per_exposure_p_hat', 'slot_credit_per_exposure_p0', 'lift', 'prior_strength_n0', 'evidence', 'held', 'correction'];
    const out = [head, ...rows.map((r) => [r.item, r.customer_item_id || '', r.title || '', r.key, r.measurementBasis || 'served-v1', r.objective || 'unit', r.n, r.s, r.p_hat, r.p0, r.lift, r.n0, r.evidence, r.control || '', r.correction || 'uncorrected-v1'])];
    download(`lift-${S.scope}-${S.slot}${item ? `-${item}` : ''}.csv`, csv(out));
  }

  // ══════════════════════════════════════════════════════════ Slots ══════════
  /** The day a horizon starts: the counts run over days, so the time of day adds nothing. */
  const day = (ms) => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '');
  /**
   * W20 R2: the slot's `governance` block from the operator slots page — what the
   * decision path refused for it since the horizon the block states. The pins
   * refused, how often and why (the runtime reason word), and, for a pinned slot,
   * the times it fell short of its take with the positions left empty. A block
   * whose counter store could not be read says so and shows no count; a slot
   * that refused nothing says that, rather than an empty cell.
   */
  function governanceCell(g) {
    if (g === undefined || g === null) return 'not asked';
    if (g.status === 'unavailable') return h('span', { class: 'sub' }, 'counts unavailable: the counter store could not be read');
    const refused = Number.isFinite(g.refusedPinCount) ? g.refusedPinCount : 0;
    const short = Number.isFinite(g.shortTakeCount) ? g.shortTakeCount : 0;
    const pins = Array.isArray(g.refusedPins) ? g.refusedPins : [];
    const named = pins.reduce((n, p) => n + (Number.isFinite(p.count) ? p.count : 0), 0);
    return h('div', {},
      h('div', {}, refused ? `${plural(refused, 'pin refusal')}` : 'no pin refused'),
      ...pins.map((p) => h('div', { class: 'itemid' }, `${p.pinnedPieceId}: ${plural(p.count, 'time')}, ${words(p.reason)}`)),
      refused > named ? h('div', { class: 'itemid' }, `${plural(refused - named, 'more refusal')} not named`) : null,
      ...unreturnedLines(g),
      h('div', {}, short ? `${plural(short, 'short take')}, ${plural(g.shortTakePositions, 'position')} left empty` : 'no short take'),
      day(g.since) ? h('div', { class: 'itemid' }, `since ${day(g.since)}`) : null);
  }

  /**
   * P47 (R-P78): the pins of this slot left reserved and unserved because the
   * layout did not return their module (the block's `unreturnedPinCount` and
   * `unreturnedPins`) refuse nothing, so they are never called refusals: one
   * line in their own words, then one per named pin with how often, the module
   * and the layout slot. A block without any draws nothing more, exactly as before.
   */
  function unreturnedLines(g) {
    const n = Number.isFinite(g.unreturnedPinCount) ? g.unreturnedPinCount : 0;
    if (n <= 0) return [];
    const pins = Array.isArray(g.unreturnedPins) ? g.unreturnedPins : [];
    // P53 (R-P78): past the names the block carries (bounded as refusedPins is), one line says how many
    // more it does not name, computed as the refusals' line is; a block whose names cover the count draws none.
    const named = pins.reduce((k, p) => k + (Number.isFinite(p.count) ? p.count : 0), 0);
    return [
      h('div', {}, `${plural(n, 'pin')} reserved, unserved: the module was not returned`),
      ...pins.map((p) => h('div', { class: 'itemid' }, `${p.pinnedPieceId}: ${plural(p.count, 'time')}, reserved, unserved: `
        + (p.within && p.within.module ? `${p.within.module} was not returned${p.within.slot ? ` by ${p.within.slot}` : ''}` : 'the module was not returned'))),
      ...(n > named ? [h('div', { class: 'itemid' }, `${plural(n - named, 'more pin')} reserved, unserved, not named`)] : []),
    ];
  }

  /**
   * P09: the learn document the Slots screen reads each slot's performance
   * percentage from. The slots index answers γ but not the blend, so the screen
   * reads the document in force itself; until it has, or where it cannot, the
   * column says so with a dash rather than a percentage that might be the wrong dial's.
   */
  const slotsLearn = { scope: '', document: null };
  function percentCell(slot) {
    const doc = slotsLearn.scope === S.scope ? slotsLearn.document : null;
    if (!doc) return h('td', { class: 'num', title: 'The learn document has not been read, so no percentage is shown.' }, '—');
    const all = doc.slots && typeof doc.slots === 'object' ? doc.slots : {};
    const d = Object.prototype.hasOwnProperty.call(all, slot) ? all[slot] : {};
    // The leading space separates this cell's text from the trust cell's in the row's text; it is not drawn.
    return h('td', { class: 'num' }, ' ', `${asPercent(percentDial(d))}%`, h('div', { class: 'itemid' }, blendOptIn(d) ? 'from the blend p' : 'from γ'));
  }

  C.view({
    id: 'slots', group: 'This brand', title: 'Slots', heading: 'Every slot, and what is set on it',
    hint: 'A slot is one place on one page. This is what each is configured to do and what it has learned so far. The box in the rail narrows this list on the server.',
    badge: () => C.slotList().length || null,
    async enter() {
      const scope = S.scope;
      const res = await C.content('/learn');
      if (scope !== S.scope) return;
      slotsLearn.scope = scope;
      slotsLearn.document = res.ok && res.data && res.data.document && typeof res.data.document === 'object' ? res.data.document : null;
    },
    render(host) {
      if (S.slots.error) { host.append(h('div', { class: 'msg err' }, S.slots.error)); return; }
      if (!S.slots.pages.length) { host.append(h('div', { class: 'empty' }, 'No slots configured for this brand. A slot document names the places on each page the engine decides for.')); return; }
      for (const page of S.slots.pages) {
        const body = page.slots.map((s) => h('tr', {},
          h('td', {},
            // W26 R2: a slot name the catalogue carries on more than one page is one placement per page.
            h('button', { class: 'link', onclick: () => C.go('lift', { slot: s.slot, page: s.pageScoped ? s.page : undefined }) }, s.slot),
            s.pinnedPieceIds?.length ? h('div', { class: 'itemid' }, `Pinned first: ${JSON.stringify(s.pinnedPieceIds)}; ${s.rankedCapacity} ranked positions`) : s.pinned ? h('div', { class: 'itemid' }, `pinned to ${s.pinned}`) : null),
          h('td', { class: 'num' }, fmt(s.take)),
          h('td', { class: 'num' }, fmt(s.pieces)),
          h('td', {}, s.dimensions && s.dimensions.length ? s.dimensions.join(', ') : 'none weighted'),
          h('td', {}, s.rules && s.rules.length ? s.rules.join(', ') : 'none'),
          h('td', {}, words(s.reward), s.objective && s.objective !== 'unit' ? h('div', { class: 'itemid' }, `weighed by ${s.objective}`) : null),
          h('td', { class: 'num' }, dec(s.gamma)),
          percentCell(s.slot),
          h('td', {}, words(s.exploration),
            retainedModeOf(s) ? h('div', { class: 'itemid' }, `${storedModeWords(retainedModeOf(s))}; explores nothing`) : null),
          h('td', {}, `unavailable · stored ${words(s.autonomy) || 'configured'} (dormant)`),
          h('td', { class: 'num' }, s.controls ? fmt(s.controls) : '—'),
          h('td', {}, s.evidence === undefined ? 'not asked' : s.evidence === null ? 'nothing yet'
            : `${plural(s.evidence.items, 'piece')}, ${plural(Math.round(s.evidence.events), 'event')}`),
          h('td', {}, governanceCell(s.governance)),
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
            { key: 'performance', label: 'Performance', sym: '%', num: true, title: 'The performance percentage the Dials screen edits, 0 to 100: γ × 100 on a slot outside the layout blend, the blend weight p × 100 on a layout slot that opts into it. Nothing else is stored' },
            { key: 'exploration', label: 'Exploring' },
            { key: 'autonomy', label: 'Autonomy (unavailable)' },
            { key: 'controls', label: 'Held', num: true },
            { key: 'evidence', label: 'Learned so far' },
            { key: 'governance', label: 'Refused or short', title: 'Pins the decision path refused for this slot, and the times a pinned slot served fewer pieces than it shows, since the date given. Counted once for the whole tenant, across every brand of it; a floor, never an overcount' },
          ], body)));
      }
    },
  });

  // ══════════════════════════════════════════════════════════ Dials ══════════
  const dl = { doc: null, draft: null, revision: 0, source: 'loading', errors: [], checking: false, timer: null, vocabularyText: null, vocabularyError: '', percent: null, advisory: null };
  /** P09: a percentage the screen refused, held as typed for the slot it was typed on, or null. */
  const heldPercent = () => (dl.percent && dl.percent.slot === S.slot ? dl.percent : null);
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
    // P46: an advisory stands only while the draft it advised is the draft on screen.
    if (dl.advisory && dl.advisory.draft !== JSON.stringify(dl.draft)) dl.advisory = null;
    dl.timer = setTimeout(async () => {
      if (!changes().length) { dl.errors = []; dl.checking = false; C.render(); return; }
      const checked = JSON.stringify(dl.draft);
      const r = await C.call(`/content/learn/validate${C.query({ scope: S.scope })}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ document: dl.draft }) });
      dl.errors = r.data.valid ? [] : r.data.errors || ['The dials as drafted were refused.'];
      // P46: the check's advisory, from this answer alone, unless the draft changed while it was asked.
      if (JSON.stringify(dl.draft) === checked) dl.advisory = learnAdvisoryOf(r, 'check', checked);
      dl.checking = false;
      C.render();
    }, 350);
    C.render();
  }
  async function loadDials() {
    // A screen must never sit on the word "Loading". If the read fails, say so
    // and paint the settings the engine ships with, so the dials are still legible.
    const res = await C.content('/learn');
    const data = res.data || {};
    dl.failed = res.ok ? '' : (res.status === 401 || res.status === 403
      ? 'Sign in at the top right to read this brand\u2019s settings. These are the defaults.'
      : `Could not read the learn document (${res.status || 'no answer'}). These are the defaults.`);
    dl.authored = res.ok ? C.authored(data) : null;
    dl.doc = data.document || { holdout: { share: 0.05, salt: '', arms: ['default'] } };
    dl.draft = copy(dl.doc);
    dl.revision = data.revision || 0;
    dl.source = data.source || 'compiled-default';
    dl.errors = [];
    dl.vocabularyText = null; dl.vocabularyError = '';
    dl.percent = null;
    // P52 (R-P78): the read's own advisory, when the learn document in force carries one, kept for the
    // draft read on entering; P46's rules then drop or replace it as they do the check's and the save's.
    dl.advisory = data.document ? learnAdvisoryOf(res, 'read', JSON.stringify(dl.draft)) : null;
  }
  async function saveDials(note) {
    const res = await C.write(`/content/learn${C.query({ scope: S.scope })}`, 'PUT', { document: dl.draft, note }, dl.authored);
    if (!res.ok || res.data.ok === false) { C.render(); return; }
    dl.authored = C.authored(res.data);
    dl.doc = res.data.document; dl.draft = copy(dl.doc); dl.revision = res.data.revision; dl.source = 'stored';
    dl.vocabularyText = null; dl.vocabularyError = '';
    dl.percent = null;
    dl.advisory = learnAdvisoryOf(res, 'save', JSON.stringify(dl.draft));
    document.getElementById('note').value = '';
    C.flash(`Saved as learn revision ${fmt(res.data.revision)}. Published; serving refreshes within the documented 30-second read bound.`);
    await C.loadSlots();
  }

  /**
   * P46 (R-P78; P41's advisory): the learn publication's `diagnostics`, kept from the answer of the
   * screen's check (`check`, the validate door) or of its save (`save`, the PUT), and (P52) of the read
   * the screen makes on entering (`read`, `GET /content/learn`), when, and only when, that answer
   * carries the member, with the draft it advised. Nothing here asks the platform for anything, and an
   * answer without the member keeps nothing, so the screen is drawn as before.
   */
  function learnAdvisoryOf(res, label, draft) {
    const d = res && res.ok && res.data ? res.data.diagnostics : undefined;
    return d && typeof d === 'object' && !Array.isArray(d) ? { label, diagnostics: d, draft } : null;
  }
  const LEARN_CONSEQUENCES = { undeclared_pieces_earn_nothing: 'undeclared pieces on this slot earn nothing' };
  /**
   * The kept advisory as ONE note (`data-learn-advisory` = read | check | save), drawn where the screen lists a
   * refused draft's errors: one line per warning the answer lists, naming the slot, the slot's reward
   * its conversion table omits and the consequence. It is kept only while the draft it advised is on
   * screen: every edit runs `scheduleCheck`, which drops it, and entering the screen or discarding the
   * draft clears it (entering then draws the read's anew when the read carries one).
   */
  function learnAdvisory() {
    const a = dl.advisory;
    if (!a) return null;
    const d = a.diagnostics;
    const listed = (Array.isArray(d.warnings) ? d.warnings : []).filter((w) => w && typeof w === 'object');
    const omitted = Number.isSafeInteger(d.omittedWarningCount) && d.omittedWarningCount > 0 ? d.omittedWarningCount : 0;
    const line = (w) => {
      const slot = typeof w.slot === 'string' && w.slot ? w.slot : 'unnamed';
      const reward = typeof w.reward === 'string' && w.reward ? words(w.reward) : 'not named';
      const what = w.code === 'conversions_omit_slot_reward' || w.code === undefined
        ? `its conversion table does not name the slot's reward, ${reward}` : `${words(w.code)} (the slot's reward, ${reward})`;
      const consequence = LEARN_CONSEQUENCES[w.consequence] || (typeof w.consequence === 'string' ? words(w.consequence) : '');
      return h('li', {}, `Slot ${slot}: ${what}${consequence ? `; ${consequence}` : ''}.`);
    };
    return h('div', { class: 'msg note', 'data-learn-advisory': a.label },
      h('strong', {}, a.label === 'save' ? 'Saved with a conversion warning: '
        : a.label === 'read' ? 'The stored learn document has a conversion warning: ' : 'This draft has a conversion warning: '),
      a.label === 'save' ? 'the document was published as written, and on the slots below a piece that declares no success event of its own is credited nothing.'
        : a.label === 'read' ? 'it is in force as written, and on the slots below a piece that declares no success event of its own is credited nothing.'
          : 'it is valid and would publish as written, and on the slots below a piece that declares no success event of its own would be credited nothing.',
      listed.length ? h('ul', {}, ...listed.map(line)) : null,
      omitted ? h('div', { class: 'help' }, `${plural(omitted, 'more warning')} not shown.`) : null,
      h('div', { class: 'help' }, 'Advice only: nothing was refused. This screen does not edit conversion tables; to credit those pieces, name the slot\u2019s reward in its conversions table and publish the learn document.'));
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
      ...options.map(([v, label, disabled]) => h('option', { value: v, disabled: disabled || null, selected: String(v) === String(value) || null }, label)));
    el.addEventListener('change', () => onChange(el.value));
    return el;
  }
  function txt(value, onChange, path, placeholder) {
    const el = h('input', { class: `txt${changed(path)}`, 'data-focus-key': path, placeholder, disabled: !C.canEdit() || null });
    el.value = value === undefined || value === null ? '' : String(value);
    el.addEventListener('input', () => onChange(el.value));
    return el;
  }

  /**
   * P09 (decision D1; freeze items 23 and 39): the slot's performance percentage,
   * 0 to 100, beside γ. It is read from the stored dial on every paint, so on a
   * slot outside the blend it and the γ control show each other's change at once.
   * A percentage typed here writes the one dial it stands for and nothing else: γ,
   * or on a slot in the layout blend `blend.p`, the blend's other members kept. A
   * percentage outside 0 to 100, or text that is not a number, writes nothing: it
   * stays on screen as typed and holds the save until it is corrected.
   */
  function percentControl(d, base) {
    const held = heldPercent();
    const el = h('input', { class: `num${changed(`${base}.${blendOptIn(d) ? 'blend.p' : 'gamma'}`)}`, 'data-focus-key': `${base}.performancePercent`,
      type: 'number', step: 'any', min: 0, max: 100, disabled: !C.canEdit() || null });
    el.value = held ? held.text : asPercent(percentDial(d));
    el.addEventListener('input', () => {
      const text = el.value.trim(), P = text === '' ? NaN : Number(text);
      if (!Number.isFinite(P) || P < 0 || P > 100) { dl.percent = { slot: S.slot, text: el.value }; C.render(); return; }
      dl.percent = null;
      const blend = blendOptIn(d);
      if (blend) d.blend = { ...blend, p: fromPercent(P) }; else d.gamma = fromPercent(P);
      scheduleCheck();
    });
    return el;
  }

  function slotDials(host) {
    const d = dialsFor();
    const base = `slots.${S.slot}`;
    const gamma = Number.isFinite(d.gamma) ? d.gamma : 0;
    const inBlend = Boolean(blendOptIn(d));
    put(host,
      dial('Trust in what was learned', 'How much the learned lift moves a piece’s score: the final score is the base score times the lift raised to this. At 0 the lift is computed and shown on every receipt and changes nothing that is served; at 1 it applies in full.',
        num(d.gamma, (v) => { if (v === undefined) delete d.gamma; else d.gamma = v; scheduleCheck(); }, `${base}.gamma`, { min: 0, max: 1, step: 0.05 }),
        gamma === 0 ? 'Shadow: learning is visible and inert.' : `A lift of 1.4 becomes ×${dec(Math.pow(1.4, gamma))} on the score.`),
      dial('Performance percentage', inBlend
        ? 'This layout slot opts into the layout blend, so its percentage is the blend weight p: the percentage divided by 100 is p, the weight of learned performance against the behaviour score in R + (1 − p) × B + p × Q. Trust above is a separate dial and stays as it is. At 0 the slot decides as it does with p at 0.'
        : 'The trust dial above as a percentage from 0 to 100: the percentage divided by 100 is γ, so 35 saves γ 0.35. At 0 the slot decides exactly as it does with γ at 0, as every slot does by default.',
        percentControl(d, base),
        heldPercent()
          ? h('span', { class: 'err' }, 'The percentage must be a number from 0 to 100; nothing is saved until it is.')
          : inBlend ? `That is the blend weight p ${String(percentDial(d))}.` : `That is γ ${String(percentDial(d))}.`),
      dial('What counts as paying off', 'The outcome this slot learns against. One per slot; the others still land in the ledger and can be reported on.',
        sel(d.reward || 'click', REWARDS.map((r) => [r, words(r)]), (v) => { d.reward = v; scheduleCheck(); }, `${base}.reward`)),
      dial('What a success is worth', 'Unit counts each one the same. Revenue weighs it by the order value, margin by the feed margin, falling back to value when absent. Revenue and margin need a reward that carries a value: a purchase, or an add to bag.',
        sel(d.objective || 'unit', [['unit', 'unit'], ['revenue', 'revenue'], ['margin', 'margin']], (v) => { if (v === 'unit') delete d.objective; else d.objective = v; scheduleCheck(); }, `${base}.objective`)),
      dial('Measurement basis', 'Absent means legacy served-v1. Rendered-v1 counts authenticated client render acknowledgments, not polls or proof of human visibility. Changing a populated basis requires the existing reviewed reset/publication flow; counters and priors never merge.',
        sel(d.measurementBasis || 'served-v1', [['served-v1', 'legacy served'], ['rendered-v1', 'client-reported rendered']], (v) => { d.measurementBasis = v; scheduleCheck(); }, `${base}.measurementBasis`)),
      h('div', { class: 'subhead' }, 'Trying things it has not tried'),
      dial('How it explores', 'Exploration is off by default. Rotation shows the least-observed piece on a hashed share; epsilon picks uniformly. Adjacent swap, on the page\u2019s declared layout slot only, swaps two neighbouring modules on that share \u2014 never a pinned or off-limits one \u2014 so the engine can estimate what each position is worth. Thompson is unsupported and stored settings are dormant.',
        sel(d.exploration?.mode === 'thompson' ? '' : d.exploration?.mode || 'off', [...(d.exploration?.mode === 'thompson' ? [['', 'Stored Thompson — inactive; choose a replacement', true]] : []), ['off', 'off'], ['rotation', 'rotation'], ['epsilon', 'epsilon'], ['adjacent-swap', 'adjacent swap (layout slot)']], (v) => {
          if (v === 'off') delete d.exploration;
          else d.exploration = { mode: v, share: (d.exploration || {}).share ?? 0.1, floor: (d.exploration || {}).floor ?? 50 };
          scheduleCheck();
        }, `${base}.exploration.mode`)),
      d.exploration?.mode === 'thompson' ? h('pre', { class: 'dormant-exploration' }, JSON.stringify(d.exploration, null, 2)) : null,
      d.exploration && d.exploration.mode !== 'thompson' ? dial('How often', 'The configured share used by the existing rule; not a measured exposure guarantee.',
        num(d.exploration.share, (v) => { d.exploration.share = v ?? 0; scheduleCheck(); }, `${base}.exploration.share`, { min: 0, max: 1, step: 0.01 }),
        `${pct(d.exploration.share)} configured share`) : null,
      d.exploration && d.exploration.mode !== 'thompson' && d.exploration.mode !== 'adjacent-swap' ? dial('Until it has seen', 'Observations below which a piece counts as under-observed and is worth showing again.',
        num(d.exploration.floor, (v) => { d.exploration.floor = v ?? 0; scheduleCheck(); }, `${base}.exploration.floor`, { min: 0, step: 1 })) : null,
      // P05 (decision D2): the position-normalisation switch, beside the swaps it reads; written only when an operator sets it.
      d.exploration?.mode === 'adjacent-swap' || d.positionNormalization !== undefined ? dial('Credit by position', 'Off by default. On, a click at a position is credited divided by that position\u2019s effect as the swaps estimate it (a click ratio, read as positionEffects on the slot\u2019s learning read), live and in the hourly recomputation alike. Turn it on only once the data science has confirmed the estimate.',
        sel(d.positionNormalization === true ? 'true' : 'false', [['false', 'off: credit as counted'], ['true', 'on: divided by the position\u2019s effect']], (v) => {
          if (v === 'true') d.positionNormalization = true; else delete d.positionNormalization;
          scheduleCheck();
        }, `${base}.positionNormalization`)) : null,
      h('div', { class: 'subhead' }, 'Autonomy unavailable'),
      h('div', { class: 'msg note' }, 'Stored settings are dormant. Cycles and proposal changes are disabled.'),
      h('pre', { class: 'dormant-autonomy' }, JSON.stringify(d.autonomy || { mode: 'configured' }, null, 2)),
      h('div', { class: 'subhead' }, 'Their own model, on this slot'),
      dial('How much this slot trusts it', 'Their model’s score joins the base score as a driver named external, at this weight. 0 switches the term off for this slot. The model itself is configured for the whole brand, below.',
        num((d.external || {}).weight, (v) => { if (v === undefined || v === 0) delete d.external; else d.external = { weight: v }; scheduleCheck(); }, `${base}.external.weight`, { min: 0, max: 1, step: 0.05 }),
        dl.draft.external ? `${dl.draft.external.kind} · ${dl.draft.external.ref}` : 'No model configured for this brand.'),
    );
  }

  // P36: the brand's context vocabulary — its channel values with the rules that
  // classify an arrival into them, its source platforms, its landing-page types,
  // and optionally its visit-bucket cut and ladder depth — edited as the JSON it
  // is published as, inside the learn document. Malformed text cannot be saved;
  // the platform validates the draft as it does every other dial.
  function vocabularyEditor(D) {
    const path = 'contextVocabulary';
    const el = h('textarea', { class: `txt${changed(path)}`, rows: 14, spellcheck: 'false', 'data-focus-key': path, disabled: !C.canEdit() || null });
    el.value = dl.vocabularyText !== null ? dl.vocabularyText : (D.contextVocabulary ? JSON.stringify(D.contextVocabulary, null, 2) : '');
    el.addEventListener('input', () => {
      dl.vocabularyText = el.value;
      const text = el.value.trim();
      if (!text) { delete D.contextVocabulary; dl.vocabularyError = ''; scheduleCheck(); return; }
      try {
        const value = JSON.parse(text);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
        D.contextVocabulary = value; dl.vocabularyError = '';
        scheduleCheck();
      } catch {
        dl.vocabularyError = 'contextVocabulary: the vocabulary must be a valid JSON object of channels, rules, sourcePlatforms and landingPageTypes (visitBuckets and ladder optional). Empty removes it; malformed text cannot be saved.';
        C.render();
      }
    });
    return el;
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
      h('div', { class: 'subhead' }, 'How arrivals are read: the context vocabulary'),
      dial('Channels, sources and landing pages', 'The brand\u2019s own channel values and the published rules that classify an arrival into them, read in order, the first that holds deciding; an arrival no rule names records as unknown, never a guess. Source platforms name the networks they own; landing-page types are the page types the page reports. Optionally the visit-bucket cut (whole numbers ascending from 1) and the ladder depth (1 to 5, order c, v, s, r, a). A change to the channel values, the cut or the depth changes the cell grammar: a priors file exported before it is refused and must be re-exported. Empty means the six built-in channel words.',
        vocabularyEditor(D), dl.vocabularyError ? h('span', { class: 'err' }, dl.vocabularyError) : (D.contextVocabulary ? `${(D.contextVocabulary.channels || []).length} channel values, ${(D.contextVocabulary.rules || []).length} rules` : 'Not published: the six built-in channel words.')),
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
      if (!dl.draft) { host.append(h('div', { class: 'msg err' }, 'The dials could not be read, so there is nothing to show. Reload the page; if it happens again the platform is not answering.')); return; }
      if (dl.failed) host.append(h('div', { class: 'msg note' }, dl.failed));
      const n = changes().length;
      C.dirty({
        count: n,
        checking: dl.checking,
        blocked: dl.errors.length > 0 || dl.vocabularyError !== '' || heldPercent() !== null,
        save: saveDials,
        discard: () => { dl.draft = copy(dl.doc); dl.errors = []; dl.vocabularyText = null; dl.vocabularyError = ''; dl.percent = null; dl.advisory = null; C.render(); },
      });
      if (dl.errors.length) host.append(h('div', { class: 'msg err' }, 'The dials as drafted were refused:', h('ul', {}, ...dl.errors.map((e) => h('li', {}, String(e))))));
      const advisory = learnAdvisory();
      if (advisory) host.append(advisory);
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
    id: 'proposals', group: 'Attention', title: 'Proposals', heading: 'Historical proposals',
    hint: 'Autonomy is unavailable. These records are read-only and unverified; this bounded listing is not a complete audit trail.',
    async enter() {
      const res = await C.v1('/learn/proposals');
      props.list = res.ok ? res.data.proposals || [] : null;
      props.error = res.ok ? '' : (res.status === 401 || res.status === 403 ? 'Sign in to read the proposals.' : res.data.error || 'Could not read the proposals.');
    },
    render(host) {
      if (props.error) { host.append(h('div', { class: 'msg note' }, props.error)); return; }
      const list = (props.list || []).slice().reverse();
      if (!list.length) { host.append(h('div', { class: 'empty' }, 'No historical proposals returned. Autonomy is unavailable.')); return; }
      for (const p of list.slice(0, 40)) {
        const ev = (p.evidence || [])[0];
        host.append(card(`${p.slot} · ${p.dimension}`, null, h('div', { class: 'body' },
          h('div', { class: 'kv' },
            h('span', { class: 'k' }, 'Proposed'), h('span', { class: 'v' }, `${p.dimension} from ${dec(p.from)} to ${dec(p.to)}`),
            h('span', { class: 'k' }, 'Stored evidence (unverified)'), h('span', { class: 'v' }, ev ? `${ev.dimension} spread ${dec(ev.spread)}, ${plural(Math.round(p.exposures), 'exposure')} recorded` : `${plural(Math.round(p.exposures), 'exposure')}`),
            h('span', { class: 'k' }, 'Stored status (unverified)'), h('span', { class: 'v' }, `${p.status} · ${p.mode} · ${when(p.at)}`),
            ...(p.note ? [h('span', { class: 'k' }, 'Note'), h('span', { class: 'v' }, p.note)] : []),
          ),
        )));
      }
    },
  });
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

  // ═════════════════════════════════════════════════════ Vocabulary ══════════
  // P38: the brand's attribute vocabulary. A stored revision governs nothing
  // until the brand's operator approves it here; the screen always says which
  // revision is in effect, read from the platform's effectiveRevision, never
  // from the latest stored revision.
  const vc = { data: null, report: null, error: '', busy: false };
  async function loadVocabulary() {
    const [res, rejections] = await Promise.all([C.content('/vocabulary'), C.content('/vocabulary/rejections')]);
    vc.data = res.ok ? res.data : null;
    vc.report = rejections.ok ? rejections.data : null;
    vc.error = res.ok ? '' : (res.status === 401 || res.status === 403 ? 'Sign in to read the vocabulary.' : res.data.error || 'Could not read the vocabulary.');
  }
  async function approveLatest() {
    const d = vc.data, latest = d && Number.isSafeInteger(d.revision) ? d.revision : 0;
    if (!latest || vc.busy) return;
    if (!confirm(`Approve revision ${fmt(latest)} of the vocabulary? From then on the catalogue and every event are held to it: a value it does not list is refused.`)) return;
    vc.busy = true; C.render();
    const res = await C.write(`/content/vocabulary/approve/${latest}?scope=${encodeURIComponent(S.scope)}`, 'POST', {}, C.authored(d));
    vc.busy = false;
    if (!res.ok || res.data.ok === false) { C.render(); return; }
    await loadVocabulary();
    C.flash(`Approved revision ${fmt(res.data.effectiveRevision)} of the vocabulary.`);
  }
  const VALUES_SHOWN = 50;
  C.view({
    id: 'vocabulary', group: 'This brand', title: 'Vocabulary', heading: 'The values an attribute may take',
    hint: 'Each attribute lists its values: the id every store and every interest carries, the display name in your wording, the words your source systems send for it, and for a product type its category. A revision takes effect only when it is approved here.',
    async enter() { await loadVocabulary(); },
    render(host) {
      if (vc.error) { host.append(h('div', { class: 'msg note' }, vc.error)); return; }
      const d = vc.data;
      if (!d) { host.append(h('div', { class: 'empty' }, 'Reading the vocabulary.')); return; }
      const effective = Number.isSafeInteger(d.effectiveRevision) ? d.effectiveRevision : 0;
      const latest = Number.isSafeInteger(d.revision) ? d.revision : 0;
      const approval = d.approval && d.approval.revision === effective ? d.approval : null;
      host.append(h('div', { class: 'sub', style: 'margin-bottom:10px' },
        effective > 0
          ? `Revision ${fmt(effective)} in effect${approval && approval.actor ? `, approved by ${approval.actor}` : ''}${approval && when(approval.at) ? ` on ${when(approval.at)}` : ''}.`
          : 'No revision is approved yet: the vocabulary governs nothing, and every attribute value is kept as it is sent.'));
      const pending = latest > 0 && latest !== effective;
      host.append(card('Approval', 'Approving puts the latest stored revision in effect for this brand. A later revision changes nothing until it is approved in turn.',
        h('div', { class: 'body' },
          h('div', { class: 'toolbar' },
            h('span', { class: 'sub' }, latest === 0 ? 'No vocabulary is stored for this brand.'
              : pending ? `The latest stored revision, ${fmt(latest)}, is waiting for approval.` : `The latest stored revision, ${fmt(latest)}, is the approved one.`),
            h('span', { class: 'spacer' }),
            h('button', { class: 'small', 'data-focus-key': 'vocabulary.approve', disabled: !C.canEdit() || !pending || vc.busy, onclick: approveLatest },
              latest > 0 ? `Approve revision ${fmt(latest)}` : 'Approve')))));
      const stored = d.document && typeof d.document === 'object' && d.document.attributes && typeof d.document.attributes === 'object' ? d.document : null;
      if (stored) {
        for (const [key, attribute] of Object.entries(stored.attributes)) {
          const values = Array.isArray(attribute && attribute.values) ? attribute.values : [];
          const rows = values.slice(0, VALUES_SHOWN).map((v) => h('tr', {},
            h('td', {}, h('div', { class: 'itemid' }, String(v.id))),
            h('td', {}, String(v.name)),
            h('td', {}, Array.isArray(v.synonyms) ? v.synonyms.join(', ') : ''),
            h('td', {}, typeof v.parent === 'string' ? v.parent : '')));
          host.append(card(`${key}`, `${plural(values.length, 'value')} in revision ${fmt(latest)}${values.length > VALUES_SHOWN ? `, the first ${fmt(VALUES_SHOWN)} shown` : ''}.`,
            C.table([{ key: 'id', label: 'Id' }, { key: 'name', label: 'Display name' }, { key: 'synonyms', label: 'Synonyms' }, { key: 'parent', label: 'Parent' }], rows)));
        }
      }
      const refused = vc.report && vc.report.rejections && typeof vc.report.rejections === 'object' ? Object.entries(vc.report.rejections) : [];
      if (effective > 0) {
        const rows = refused.flatMap(([attribute, counts]) => Object.entries(counts || {}).map(([value, n]) => h('tr', {},
          h('td', {}, attribute), h('td', {}, h('div', { class: 'itemid' }, value)), h('td', { class: 'num' }, fmt(n)))));
        host.append(card('Refused at ingest', 'Values events carried on a governed attribute that the approved vocabulary does not list: they built no interest. Add them as synonyms, or fix the source.',
          rows.length ? C.table([{ key: 'attribute', label: 'Attribute' }, { key: 'value', label: 'Value' }, { key: 'n', label: 'Events', num: true }], rows)
            : h('div', { class: 'empty' }, 'Nothing refused since this revision was approved.')));
      }
    },
  });
})();
