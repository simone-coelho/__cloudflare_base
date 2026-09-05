// public/console/views-measure.js
// ---------------------------------------------------------------------------
// The last two screens the learning page held, migrated (doc 28 §3.1).
//
//   Measurement  did it work. The holdout arms over a window, with the interval
//                and the pre-set targets; then one day in detail: what the day
//                read, what each attribution policy would have credited, and
//                what was explored. Tapestry's own measurement chapter asks for
//                exactly this: incrementality, not attribution, aggregated over
//                a window rather than a point in time, at 90% or better.
//   History      who changed what, on all five documents, with a rollback.
//                Rolling back writes the old content forward as a NEW revision,
//                so the record shows the rollback rather than hiding what it
//                undid.
// ---------------------------------------------------------------------------
(() => {
  const C = window.Console;
  const { h, fmt, dec, pct, when, plural } = C;
  const S = C.state;
  const card = (title, why, ...body) => h('section', { class: 'card' },
    h('header', {}, h('h3', {}, title), why ? h('div', { class: 'why' }, why) : null), ...body);
  const body = (...x) => h('div', { class: 'body' }, ...x);
  const iso = (d) => new Date(d).toISOString().slice(0, 10);
  const daysAgo = (n) => iso(Date.now() - n * 86400000);

  // ═════════════════════════════════════════════════════ Measurement ═════════
  const ms = {
    day: iso(Date.now()), from: daysAgo(27), to: iso(Date.now()), confidence: '0.95',
    report: null, reportError: '', building: false,
    window: null, windowError: '', loading: false,
  };

  async function loadWindow() {
    ms.loading = true; C.render();
    const res = await C.v1('/learn/report/window', { from: ms.from, to: ms.to, confidence: ms.confidence });
    ms.loading = false;
    ms.window = res.ok && res.data.ok !== false ? res.data.report : null;
    ms.windowError = res.ok ? '' : (res.status === 401 || res.status === 403 ? 'Sign in to read the measurement.' : res.data.error || 'Could not read the window.');
    C.render();
  }
  async function loadDay() {
    const res = await C.v1('/learn/report', { date: ms.day });
    ms.report = res.ok && res.data.ok !== false ? res.data.report : null;
    ms.reportError = res.ok ? '' : (res.status === 404 ? '' : res.data.error || '');
    C.render();
  }
  async function buildDay() {
    ms.building = true; C.render();
    const res = await C.write(`/v1/${encodeURIComponent(S.scope)}/learn/report${C.query({ brand: S.brand === S.scope ? undefined : S.brand })}`, 'POST', { date: ms.day, brand: S.brand });
    ms.building = false;
    if (!res.ok || res.data.ok === false) { ms.report = null; ms.reportError = 'The report could not be built.'; C.render(); return; }
    ms.report = res.data.report; ms.reportError = '';
    C.flash(`Built the report for ${ms.day}: ${plural(ms.report.counts.decisions, 'decision')} and ${plural(ms.report.counts.outcomes, 'outcome')}.`);
    await loadWindow();
  }

  /** One arm against personalized: the sentence first, then the numbers behind it. */
  function comparison(cmp) {
    const t = cmp.treatment, c = cmp.control;
    const verdict = cmp.verdict === 'treatment_better' ? 'ok' : cmp.verdict === 'control_better' ? 'err' : 'note';
    const stand = cmp.targets && cmp.targets.standing;
    return h('div', { style: 'margin-bottom:14px' },
      h('div', { class: `msg ${verdict}` }, cmp.words),
      h('div', { class: 'kv' },
        h('span', { class: 'k' }, `${t.arm}`), h('span', { class: 'v' }, `${pct(t.rate.p)} of ${plural(t.n, 'decision')} paid off · the interval runs ${pct(t.rate.lo)} to ${pct(t.rate.hi)}`),
        h('span', { class: 'k' }, `${c.arm}`), h('span', { class: 'v' }, `${pct(c.rate.p)} of ${plural(c.n, 'decision')} paid off · the interval runs ${pct(c.rate.lo)} to ${pct(c.rate.hi)}`),
        h('span', { class: 'k' }, 'The difference'), h('span', { class: 'v' }, `${dec(cmp.difference.p * 100, 1)} points, and the ${Math.round(cmp.confidence * 100)}% interval runs ${dec(cmp.difference.lo * 100, 1)} to ${dec(cmp.difference.hi * 100, 1)} points`),
        ...(cmp.alsoAt ? [h('span', { class: 'k' }, `At ${Math.round(cmp.alsoAt.confidence * 100)}%`), h('span', { class: 'v' }, cmp.alsoAt.verdict === 'undecided' ? 'still not distinguishable from zero' : 'it would be called')] : []),
        ...(cmp.neededPerArm ? [h('span', { class: 'k' }, 'To call it'), h('span', { class: 'v' }, `about ${plural(cmp.neededPerArm, 'decision')} on each arm; the smaller arm has ${fmt(Math.min(t.n, c.n))}`)] : []),
        ...(stand ? [h('span', { class: 'k' }, 'Against the targets'), h('span', { class: 'v' }, `${stand.replace(/_/g, ' ')} · minimum ${pct(cmp.targets.targets.minimum)}, target ${pct(cmp.targets.targets.target)}, stretch ${pct(cmp.targets.targets.stretch)} relative`)] : []),
      ));
  }

  C.view({
    id: 'measure', group: 'This brand', title: 'Measurement', heading: 'Did it work',
    hint: 'The holdout is the only thing here that answers that question. Attribution says who touched what; the holdout says what would have happened without any of it.',
    async enter() { await Promise.all([loadWindow(), loadDay()]); },
    render(host) {
      const dateBox = (id, value, onChange) => {
        const el = h('input', { class: 'small', 'data-focus-key': id, type: 'date' });
        el.value = value;
        el.addEventListener('change', () => onChange(el.value));
        return el;
      };
      host.append(h('div', { class: 'toolbar', style: 'background:var(--panel);border:1px solid var(--line);margin-bottom:16px' },
        h('label', {}, 'From'), dateBox('from', ms.from, (v) => { ms.from = v; loadWindow(); }),
        h('label', {}, 'to'), dateBox('to', ms.to, (v) => { ms.to = v; loadWindow(); }),
        h('label', {}, 'Confidence'),
        (() => {
          const el = h('select', { class: 'small', 'data-focus-key': 'conf' },
            h('option', { value: '0.9', selected: ms.confidence === '0.9' || null }, '90%'),
            h('option', { value: '0.95', selected: ms.confidence === '0.95' || null }, '95%'),
            h('option', { value: '0.99', selected: ms.confidence === '0.99' || null }, '99%'));
          el.addEventListener('change', () => { ms.confidence = el.value; loadWindow(); });
          return el;
        })(),
        h('span', { class: 'spacer' }),
        h('span', { class: 'sub' }, ms.loading ? 'reading…' : ms.window ? `${plural(ms.window.days.length, 'day')} read${ms.window.missing.length ? `, ${plural(ms.window.missing.length, 'day')} with no report` : ''}` : '')));

      if (ms.windowError) host.append(h('div', { class: 'msg note' }, ms.windowError));

      // 1. The window. This is the number, and the only one that answers "did it work".
      const slots = ms.window ? Object.keys(ms.window.slots) : [];
      if (ms.window && !slots.length) {
        host.append(card('Over the window', 'Nothing to compare yet.', body(h('div', { class: 'empty' },
          ms.window.days.length
            ? 'The days in this window have reports, but none of them served a slot with a holdout arm.'
            : 'No day in this window has a report yet. Build one below, or let the nightly job build them.'))));
      }
      for (const slot of slots) {
        const sl = ms.window.slots[slot];
        host.append(card(`Over the window · ${slot}`,
          `Every day from ${ms.window.from} to ${ms.window.to} that has a report, added together. A snapshot of one day understates a system that is still learning and overstates one that has learned; the window is what a finance team will accept.`,
          body(
            ...(sl.comparisons.length ? sl.comparisons.map(comparison) : [h('div', { class: 'empty' }, 'Only one arm served this slot in the window, so there is nothing to compare it against.')]),
            C.table([
              { key: 'arm', label: 'Arm' },
              { key: 'n', label: 'Decisions', num: true },
              { key: 's', label: 'Paid off', num: true },
              { key: 'rate', label: 'Rate', num: true },
              { key: 'iv', label: 'The interval', num: true },
            ], sl.arms.map((a) => h('tr', {},
              h('td', {}, a.arm),
              h('td', { class: 'num' }, fmt(a.n)),
              h('td', { class: 'num' }, fmt(a.s)),
              h('td', { class: 'num' }, pct(a.rate.p)),
              h('td', { class: 'num' }, `${pct(a.rate.lo)} to ${pct(a.rate.hi)}`)))))));
      }

      // 2. One day, in detail.
      const R = ms.report;
      host.append(card('One day, in detail',
        'What the ledger held for a day, what each attribution policy would have credited from it, and what the engine explored. Building a day reads its decision and outcome partitions and re-attributes every outcome; it changes nothing that is served.',
        h('div', { class: 'toolbar' },
          h('label', {}, 'Day'), dateBox('day', ms.day, (v) => { ms.day = v; loadDay(); }),
          h('button', { class: 'small', disabled: !C.canEdit() || ms.building, onclick: buildDay }, ms.building ? 'Building…' : 'Build this day'),
          h('span', { class: 'spacer' }),
          R ? h('span', { class: 'sub' }, `built ${when(R.builtAt)}`) : null),
        body(
          ms.reportError ? h('div', { class: 'msg err' }, ms.reportError) : null,
          !R ? h('div', { class: 'empty' }, 'No report for this day yet. Build it above; the nightly job builds yesterday.') : null,
          R ? h('div', { class: 'kv' },
            h('span', { class: 'k' }, 'The day held'), h('span', { class: 'v' }, `${plural(R.counts.decisions, 'decision')}, ${plural(R.counts.outcomes, 'outcome')}, ${plural(R.counts.visitors, 'visitor')}${R.counts.truncated ? ' — capped: the day was larger than one pass reads' : ''}`),
            h('span', { class: 'k' }, 'Credited'), h('span', { class: 'v' }, R.policies.map((p) => `${p.name} ${fmt(p.credits)}`).join(' · ')),
          ) : null,
          R && R.holdout && R.holdout[S.slot] ? h('div', { class: 'subhead' }, `The arms on ${S.slot}, under the learning policy`) : null,
          R && R.holdout && R.holdout[S.slot] ? C.table([
            { key: 'arm', label: 'Arm' }, { key: 'd', label: 'Decisions', num: true },
            { key: 'c', label: 'Credited', num: true }, { key: 'r', label: 'Rate', num: true },
          ], R.holdout[S.slot].map((a) => h('tr', {}, h('td', {}, a.arm), h('td', { class: 'num' }, fmt(a.decisions)), h('td', { class: 'num' }, fmt(a.credited)), h('td', { class: 'num' }, pct(a.rate))))) : null,
          R && R.exploration ? (() => {
            const e = R.exploration.find((x) => x.slot === S.slot);
            return e ? h('div', { class: 'kv' },
              h('span', { class: 'k' }, 'Explored'), h('span', { class: 'v' }, `${pct(e.realized)} of ${plural(e.decisions, 'decision')} in the first position${e.configured === null || e.configured === undefined ? ', with exploration off' : `, against ${pct(e.configured)} configured`}`)) : null;
          })() : null,
        )));

      // 3. What each policy would have credited, for the slot in the rail.
      if (R && R.grids && R.grids[S.slot]) {
        const grid = R.grids[S.slot];
        const names = R.policies.map((p) => p.name);
        const items = [...new Set(names.flatMap((n) => Object.keys((grid[n] || {}).items || {})))].sort();
        const cell = (n, item, f) => { const st = (((grid[n] || {}).items || {})[item] || {})['*']; return st && Number.isFinite(st[f]) ? dec(st[f]) : '—'; };
        host.append(card(`What each policy would have credited · ${S.slot}`,
          'The same day read under other attribution rules, side by side. The engine learns under the first one; the others are there to show what the choice is worth, and nothing served changes.',
          C.table([{ key: 'item', label: 'Piece' }, ...names.flatMap((n) => [
            { key: `${n}-n`, label: `${n}: shown`, sym: 'n', num: true },
            { key: `${n}-s`, label: 'paid off', sym: 's', num: true },
            { key: `${n}-l`, label: 'lift', num: true },
          ])], items.map((item) => h('tr', {},
            h('td', {}, h('div', { class: 'itemid' }, item)),
            ...names.flatMap((n) => [
              h('td', { class: 'num' }, cell(n, item, 'n')),
              h('td', { class: 'num' }, cell(n, item, 's')),
              h('td', { class: 'num' }, h('strong', {}, cell(n, item, 'lift'))),
            ]))))));
      }
    },
  });

  // ═════════════════════════════════════════════════════════ History ═════════
  const KINDS = [
    { id: 'reflex', title: 'What the engine notices', why: 'The interests, their weights and the pace. Every revision here changed how a shopper is scored.', path: '/config/reflex/history', rollback: (n) => `/config/reflex/rollback/${n}`, view: 'interests' },
    { id: 'learn', title: 'What the engine may do', why: 'Trust, exploration, autonomy, the holdout and the attribution policy.', path: '/content/learn/history', rollback: (n) => `/content/learn/rollback/${n}`, view: 'dials' },
    { id: 'slots', title: 'The slots and their rules', why: 'What each slot shows, what it weights, and the four rules on it.', path: '/content/slots/history', rollback: (n) => `/content/slots/rollback/${n}`, view: 'rules' },
    { id: 'catalog', title: 'The content catalog', why: 'The pieces themselves, their tags and their lifecycle.', path: '/content/catalog/history', rollback: (n) => `/content/catalog/rollback/${n}` },
    { id: 'priors', title: 'Imported priors', why: 'Rates a team estimated elsewhere, used until live evidence outweighs them.', path: '/content/priors/history', rollback: (n) => `/content/priors/rollback/${n}` },
  ];
  const hist = { rows: {}, lift: [], loading: false };

  async function loadHistory() {
    hist.loading = true; C.render();
    const got = await Promise.all(KINDS.map((k) => C.call(`${k.path}${C.query({ scope: S.scope })}`)));
    KINDS.forEach((k, i) => { hist.rows[k.id] = got[i].ok ? got[i].data.revisions || [] : null; });
    const lift = S.slot ? await C.v1('/lift/history', { slot: S.slot }) : { ok: false, data: {} };
    hist.lift = lift.ok ? lift.data.versions || [] : [];
    hist.loading = false;
    C.render();
  }
  async function rollback(kind, n) {
    if (!window.confirm(`Roll ${kind.title.toLowerCase()} back to revision ${n}? It is written forward as a new revision; nothing is erased.`)) return;
    const res = await C.write(`${kind.rollback(n)}${C.query({ scope: S.scope })}`, 'POST', {});
    if (!res.ok || res.data.ok === false) { C.render(); return; }
    C.flash(`Rolled revision ${fmt(n)} forward as revision ${fmt(res.data.revision)}.`);
    await loadHistory();
  }

  C.view({
    id: 'history', group: 'This brand', title: 'History', heading: 'Who changed what',
    hint: 'Every document the engine reads is versioned, attributed and reversible. Rolling back writes the old content forward as a new revision, so the record shows the rollback rather than hiding what it undid.',
    async enter() { await loadHistory(); },
    render(host) {
      if (hist.loading) { host.append(h('div', { class: 'empty' }, 'Reading the history…')); return; }
      for (const k of KINDS) {
        const rows = hist.rows[k.id];
        const current = rows && rows.length ? Math.max(...rows.map((r) => r.revision)) : 0;
        host.append(card(k.title, k.why, rows === undefined
          ? h('div', { class: 'empty' }, 'Reading…')
          : rows === null
          ? h('div', { class: 'empty' }, 'Could not read this history.')
          : !rows.length
            ? h('div', { class: 'empty' }, 'Nothing stored for this brand: it runs on the settings the engine shipped with.')
            : C.table([
                { key: 'r', label: 'Revision', num: true }, { key: 'v', label: 'Stamp' },
                { key: 'who', label: 'Changed by' }, { key: 'when', label: 'When' },
                { key: 'note', label: 'Why' }, { key: 'act', label: '' },
              ], [...rows].sort((a, b) => b.revision - a.revision).slice(0, 20).map((r) => h('tr', {},
                h('td', { class: 'num' }, fmt(r.revision)),
                h('td', {}, r.version ? h('span', { class: 'itemid' }, r.version) : '—'),
                h('td', {}, r.actor || 'unknown'),
                h('td', {}, when(r.at)),
                h('td', {}, r.note || '—'),
                h('td', {},
                  r.revision === current ? h('span', { class: 'chip pending' }, 'in force') : null,
                  r.revision === current ? null : h('button', { class: 'link', disabled: !C.canEdit(), title: C.canEdit() ? '' : 'Sign in to roll back', onclick: () => rollback(k, r.revision) }, 'Roll back to this')),
              )))));
      }
      host.append(card(`Published snapshots · ${S.slot || 'no slot chosen'}`,
        'What the engine learned, as it was published. These are not edited by anyone: each is what the evidence said at that moment, kept so a decision made then can be replayed exactly.',
        !S.slot ? h('div', { class: 'empty' }, 'Choose a slot in the rail.')
          : !hist.lift.length ? h('div', { class: 'empty' }, 'No archived snapshots for this slot yet; every publish from now on is archived by version.')
          : C.table([{ key: 'v', label: 'Published' }, { key: 'ver', label: 'Version' }, { key: 'size', label: 'Size', num: true }],
              hist.lift.slice(0, 20).map((v) => h('tr', {},
                h('td', {}, when(v.version)),
                h('td', {}, h('span', { class: 'itemid' }, String(v.version))),
                h('td', { class: 'num' }, `${dec((v.size || 0) / 1024, 1)} KB`))))));
    },
  });
})();
