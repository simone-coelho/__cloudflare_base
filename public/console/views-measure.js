/* eslint-env browser */
/* global OperatorSession:readonly */
// public/console/views-measure.js
// ---------------------------------------------------------------------------
// The last two screens the learning page held, migrated (doc 28 §3.1).
//
//   Measurement  raw attribution diagnostics over a window and one day:
//                recorded arm counts, attribution policies and exploration.
//                Experimental inference is unavailable from these counts.
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
    day: iso(Date.now()), from: daysAgo(27), to: iso(Date.now()),
    report: null, reportError: '', building: false, page: null, reading: false, dayKey: '', dayGeneration: 0,
    window: null, windowError: '', loading: false,
    windowKey: '', windowGeneration: 0,
  };
  const userKey = () => { const a = window.OperatorSession, u = a && a.user(); return JSON.stringify([Boolean(a && a.signedIn()), u && u.id, u && u.roles, u && u.tenants, Boolean(a && a.mustChangePassword())]); };
  const dayKey = () => JSON.stringify([S.path, S.scope, S.brand, S.slot, ms.day, userKey()]);
  const windowKey = () => JSON.stringify([S.path, S.scope, S.brand, ms.from, ms.to, userKey()]);
  function context() {
    if (ms.dayKey !== dayKey()) { ms.dayKey = dayKey(); ms.dayGeneration++; ms.report = null; ms.page = null; ms.reportError = ''; ms.reading = false; ms.building = false; }
    if (ms.windowKey !== windowKey()) { ms.windowKey = windowKey(); ms.windowGeneration++; ms.window = null; ms.windowError = ''; ms.loading = false; }
  }
  let sessionKey = userKey();
  if (window.OperatorSession) OperatorSession.onChange(() => {
    const next = userKey(); if (next === sessionKey) return; sessionKey = next; context(); C.render();
  });
  window.addEventListener('hashchange', () => { ms.dayGeneration++; ms.windowGeneration++; ms.report = null; ms.page = null; ms.window = null; C.render(); }, true);

  async function loadWindow() {
    context(); const key = ms.windowKey, generation = ++ms.windowGeneration;
    ms.loading = true; C.render();
    const res = await C.v1('/learn/report/window', { from: ms.from, to: ms.to });
    if (S.path !== 'measure' || key !== windowKey() || generation !== ms.windowGeneration) return;
    ms.loading = false;
    ms.window = res.ok && res.data.ok !== false ? res.data.report : null;
    ms.windowError = res.ok ? '' : (res.status === 401 || res.status === 403 ? 'Sign in to read the measurement.' : res.data.error || 'Could not read the window.');
    C.render();
  }
  async function loadDay(cursor) {
    context(); const key = ms.dayKey, generation = ++ms.dayGeneration;
    ms.building = false; // This read supersedes any still-running build response, not its server effects.
    ms.report = null; ms.page = null; ms.reportError = ''; ms.reading = true; C.render();
    if (!S.slot) { ms.reading = false; C.render(); return; }
    const res = await C.v1('/learn/report', { date: ms.day, slot: S.slot, limit: 50, cursor: cursor || undefined });
    if (S.path !== 'measure' || key !== dayKey() || generation !== ms.dayGeneration) return;
    const r = res.data.report, p = res.data.page;
    const valid = res.ok && res.data.ok === true && r && r.tenant === S.scope && r.brand === S.brand && r.date === ms.day &&
      p && p.slot === S.slot && typeof p.revision === 'string' && /^[a-f0-9]{64}$/.test(p.revision) && p.limit === 50 && Number.isSafeInteger(p.offset) && p.offset >= 0 && Number.isSafeInteger(p.total) && p.total >= 0;
    ms.report = valid ? r : null; ms.page = valid ? p : null; ms.reading = false;
    ms.reportError = valid || res.status === 404 ? '' : res.status === 409 ? 'Report changed. Reload the first page.' : res.data.error || 'Could not read this report page.';
    C.render();
  }
  async function buildDay() {
    context(); const key = ms.dayKey, generation = ++ms.dayGeneration;
    ms.reading = false; // The superseded GET cannot clear this indicator after its result is withheld.
    ms.building = true; C.render();
    // Keep failure handling local: a late build must not populate the shell's new-context errors.
    const res = await C.call(`/v1/${encodeURIComponent(S.scope)}/learn/report${C.query({ brand: S.brand === S.scope ? undefined : S.brand })}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ date: ms.day, brand: S.brand }),
    });
    if (S.path !== 'measure' || key !== dayKey() || generation !== ms.dayGeneration) return;
    ms.building = false;
    if (!res.ok || res.data.ok === false) { ms.report = null; ms.reportError = 'The report could not be built.'; C.render(); return; }
    ms.report = null; ms.page = null; ms.reportError = '';
    C.flash(`Build completed for ${ms.day}. Reading the latest saved canonical report; it may differ from the build result.`);
    await Promise.all([loadDay(), loadWindow()]);
  }

  // Always derive the diagnostic from counts, including when an older server returns inferred fields.
  const intensity = (credited, decisions) => decisions > 0 ? dec(credited / decisions, 3) : '—';
  const minimumHorizon = (coverage, hours) => {
    if (!coverage || coverage.version !== 1 || coverage.source !== 'aggregates' || coverage.metadata !== 'recorded' ||
      !Array.isArray(coverage.missingHours) || coverage.missingHours.length || !Array.isArray(coverage.unknownHours) || coverage.unknownHours.length) return null;
    const rows = coverage.horizons;
    if (!Array.isArray(rows) || !rows.length || rows.length > 24 || !Array.from(rows).every(x => x && Number.isInteger(x.hour) && x.hour >= 0 && x.hour < 24 && Number.isFinite(x.horizonMs) && x.horizonMs >= 0) || new Set(rows.map(x => x.hour)).size !== rows.length) return null;
    if (hours && (!Array.isArray(hours.missing) || hours.missing.length || !Array.isArray(hours.built) || hours.built.length !== rows.length || !hours.built.every(hour => rows.some(x => x.hour === hour)))) return null;
    return Math.min(...rows.map(x => x.horizonMs));
  };
  const coverageNotes = (coverage, hours) => {
    const notes = ['Outcome maturity: unknown. Source completeness is not established.'];
    if (!coverage || coverage.version !== 1) return [...notes, 'Coverage metadata absent or invalid; minimum contributing horizon: unknown.'];
    if (coverage.metadata !== 'recorded') notes.push('Coverage metadata absent or invalid; historical last-hour horizon is not a minimum.');
    for (const [key, label] of [['missingHours', 'Missing hours'], ['truncatedHours', 'Truncated hours'], ['unadvancedHours', 'Ring progress not advanced for hours'], ['unknownHours', 'Unknown hour metadata']]) {
      if (Array.isArray(coverage[key]) && coverage[key].length) notes.push(`${label}: ${coverage[key].join(', ')}.`);
    }
    if (coverage.truncated) notes.push('Source or visitor coverage is incomplete.');
    if (coverage.visitorsIncomplete === true) notes.push('Visitor coverage is incomplete.');
    if (Array.isArray(coverage.horizons) && coverage.horizons.length) notes.push(`Reported hourly horizons: ${Array.from(coverage.horizons, x => x && Number.isInteger(x.hour) && x.hour >= 0 && x.hour < 24 ? `${x.hour}: ${Number.isFinite(x.horizonMs) && x.horizonMs >= 0 ? x.horizonMs / 3600000 + 'h' : 'unknown'}` : 'unknown').join(', ')}.`);
    const minimum = minimumHorizon(coverage, hours);
    notes.push(minimum !== null
      ? `Minimum reported contributing horizon: ${minimum / 3600000}h; not a completeness guarantee.` : 'Minimum contributing horizon: unknown.');
    if (Array.isArray(coverage.unadvancedHours) && coverage.unadvancedHours.length) notes.push('Unadvanced ring progress does not mean every reported credit is wrong.');
    return notes;
  };

  C.view({
    id: 'measure', group: 'This brand', title: 'Measurement', heading: 'Attribution diagnostics',
    hint: 'Credited outcomes per content-item decision describe attribution. Repeated outcomes can produce more than one credit per decision. Experimental inference is unavailable; these counts do not establish business lift.',
    async enter() { await Promise.all([loadWindow(), loadDay()]); },
    render(host) {
      context(); // Shell paints before enter(): never show another context's retained rows.
      const dateBox = (id, value, onChange) => {
        const el = h('input', { class: 'small', 'data-focus-key': id, type: 'date' });
        el.value = value;
        el.addEventListener('change', () => onChange(el.value));
        return el;
      };
      host.append(h('div', { class: 'toolbar', style: 'background:var(--panel);border:1px solid var(--line);margin-bottom:16px' },
        h('label', {}, 'From'), dateBox('from', ms.from, (v) => { ms.from = v; loadWindow(); }),
        h('label', {}, 'to'), dateBox('to', ms.to, (v) => { ms.to = v; loadWindow(); }),
        h('span', { class: 'spacer' }),
        h('span', { class: 'sub' }, ms.loading ? 'reading…' : ms.window ? `${plural(ms.window.days.length, 'day')} read${ms.window.missing.length ? `, ${plural(ms.window.missing.length, 'day')} with no report` : ''}` : '')));

      if (ms.windowError) host.append(h('div', { class: 'msg note' }, ms.windowError));

      host.append(h('div', { class: 'msg note' }, 'Windows allow up to 184 days inclusive; byte and row budgets can still refuse a smaller window. Source coverage, outcome maturity and policy compatibility are not established by the presence of a report.'));
      for (const day of (ms.window && ms.window.incomplete || [])) host.append(h('div', { class: 'msg note' },
        `Incomplete coverage for ${day.date}${day.truncated ? ': source coverage incomplete' : ''}${day.missingHours.length ? `; ${plural(day.missingHours.length, 'hour')} missing (${day.missingHours.join(', ')})` : ''}.`));
      if (ms.window) {
        const coverage = ms.window.coverage;
        const days = coverage && coverage.version === 1 && Array.isArray(coverage.days) ? Array.from(coverage.days) : [];
        const known = days.length > 0 && Array.isArray(ms.window.missing) && !ms.window.missing.length && Array.isArray(ms.window.days) && days.length === ms.window.days.length &&
          days.every(day => day && typeof day.date === 'string' && ms.window.days.includes(day.date) && minimumHorizon(day.coverage) !== null) && new Set(days.map(day => day.date)).size === days.length;
        host.append(h('div', { class: 'msg note' }, 'Outcome maturity: unknown. Missing reports and unknown contributors prevent a whole-window horizon guarantee.'));
        host.append(h('div', { class: 'msg note' }, known
          ? `Minimum reported window contributing horizon: ${Math.min(...days.map(day => minimumHorizon(day.coverage))) / 3600000}h; not a completeness guarantee.` : 'Minimum window contributing horizon: unknown.'));
        if (coverage && coverage.version === 1 && Array.isArray(coverage.days)) for (const day of days) {
          if (!day || typeof day.date !== 'string') { host.append(h('div', { class: 'msg note' }, 'Per-day coverage metadata absent or invalid.')); continue; }
          for (const note of coverageNotes(day.coverage)) host.append(h('div', { class: 'msg note' }, `${day.date}: ${note}`));
        } else host.append(h('div', { class: 'msg note' }, 'Per-day coverage metadata absent or invalid.'));
      }

      // 1. Raw counts pooled over the requested window.
      const slots = ms.window ? Object.keys(ms.window.slots) : [];
      if (ms.window) host.append(h('div', { class: 'msg note' }, 'Recorded computation basis only. Experimental compatibility, served control and enrollment remain unverified.'));
      if (ms.window && !slots.length) {
        host.append(card('Over the window', 'No attribution rows yet.', body(h('div', { class: 'empty' },
          ms.window.days.length
            ? 'The days in this window have reports, but contain no recorded arm counts.'
            : 'No day in this window has a report yet. Build one below, or let the nightly job build them.'))));
      }
      for (const slot of slots) {
        const sl = ms.window.slots[slot];
        const compatible = ms.window.compatibility && ms.window.compatibility.version === 1 && sl.compatibility && sl.compatibility.status === 'compatible' &&
          Array.isArray(sl.compatibility.reasons) && sl.compatibility.reasons.length === 0 && Array.isArray(sl.compatibility.days) && sl.compatibility.days.length > 0;
        if (!compatible) {
          const info = sl.compatibility;
          host.append(card(`Over the window · ${slot}`, 'Pooled attribution values withheld, not zero or missing.',
            body(h('div', { class: 'msg note' }, `Computation basis: ${info && info.status === 'mixed' ? 'mixed' : 'unknown'}. ${info && Array.isArray(info.reasons) ? info.reasons.join(', ') : 'unknown_basis'}. Contributing days: ${info && Array.isArray(info.days) ? info.days.join(', ') : ms.window.days.join(', ')}.`))));
          continue;
        }
        host.append(card(`Over the window · ${slot}`,
          `Recorded attribution counts from ${ms.window.from} to ${ms.window.to}, pooled from ${plural(ms.window.days.length, 'day')} with reports. Experimental inference is unavailable.`,
          body(
            C.table([
              { key: 'arm', label: 'Arm' },
              { key: 'n', label: 'Decisions', num: true },
              { key: 's', label: 'Credited outcomes', num: true },
              { key: 'rate', label: 'Credits per decision', num: true },
            ], sl.arms.map((a) => h('tr', {},
              h('td', {}, a.arm),
              h('td', { class: 'num' }, fmt(a.decisions ?? a.n)),
              h('td', { class: 'num' }, fmt(a.credited ?? a.s)),
              h('td', { class: 'num' }, intensity(a.credited ?? a.s, a.decisions ?? a.n))))))));
      }

      // 2. One day, in detail.
      const R = ms.report;
      host.append(card('One day, in detail',
        'What the ledger held for a day, what each attribution policy would have credited from it, and what the engine explored. Building a day reads its decision and outcome partitions and re-attributes every outcome; it changes nothing that is served.',
        h('div', { class: 'toolbar' },
          h('label', {}, 'Day'), dateBox('day', ms.day, (v) => { ms.day = v; loadDay(); }),
          h('button', { class: 'small', disabled: !C.canEdit() || ms.building, onclick: buildDay }, ms.building ? 'Building…' : 'Build this day'),
          h('button', { class: 'small', disabled: ms.reading, onclick: () => loadDay() }, 'Reload first page'),
          h('span', { class: 'spacer' }),
          R ? h('span', { class: 'sub' }, `built ${when(R.builtAt)}`) : null),
        body(
          ms.reportError ? h('div', { class: 'msg err' }, ms.reportError) : null,
          !R ? h('div', { class: 'empty' }, 'No report for this day yet. Build it above; the nightly job builds yesterday.') : null,
          R ? h('div', { class: 'kv' },
            h('span', { class: 'k' }, 'The day held'), h('span', { class: 'v' }, `${plural(R.counts.decisions, 'decision')}, ${plural(R.counts.outcomes, 'outcome')}, ${plural(R.counts.visitors, 'visitor')}${R.counts.truncated ? ' — incomplete coverage' : ''}`),
            h('span', { class: 'k' }, 'Credited'), h('span', { class: 'v' }, R.policies.map((p) => `${p.name} ${fmt(p.credits)}`).join(' · ')),
          ) : null,
          R && R.hours && R.hours.missing.length ? h('div', { class: 'msg note' }, `Incomplete coverage: ${plural(R.hours.missing.length, 'hour')} missing (${R.hours.missing.join(', ')}).`) : null,
          ...(R ? coverageNotes(R.coverage, R.hours).map(note => h('div', { class: 'msg note' }, note)) : []),
          R && R.holdout && R.holdout[S.slot] ? h('div', { class: 'subhead' }, `The arms on ${S.slot}, under the learning policy`) : null,
          R && R.holdout && R.holdout[S.slot] ? C.table([
            { key: 'arm', label: 'Arm' }, { key: 'd', label: 'Decisions', num: true },
            { key: 'c', label: 'Credited outcomes', num: true }, { key: 'r', label: 'Credits per decision', num: true },
          ], R.holdout[S.slot].map((a) => h('tr', {}, h('td', {}, a.arm), h('td', { class: 'num' }, fmt(a.decisions)), h('td', { class: 'num' }, fmt(a.credited)), h('td', { class: 'num' }, intensity(a.credited, a.decisions))))) : null,
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
        const p = ms.page;
        host.append(h('div', { class: 'pager', 'data-report-pager': true }, `${p.total} items, showing ${p.total ? p.offset + 1 : 0} to ${Math.min(p.total, p.offset + p.limit)}`,
          h('button', { disabled: !p.previous || ms.reading, onclick: () => loadDay(p.previous) }, 'Previous'),
          h('button', { disabled: !p.next || ms.reading, onclick: () => loadDay(p.next) }, 'Next')));
        host.append(card(`What each policy would have credited · ${S.slot}`,
          'The same day read under other attribution rules. The learning multiplier adjusts ranking scores; it is not measured business lift. The engine learns under the first policy.',
          C.table([{ key: 'item', label: 'Piece' }, ...names.flatMap((n) => [
            { key: `${n}-n`, label: `${n}: exposures (${grid[n]?.measurementBasis || 'served-v1'}; ${grid[n]?.objective || 'unit'})`, sym: 'n', num: true },
            { key: `${n}-s`, label: 'weighted credits', sym: 's', num: true },
            { key: `${n}-l`, label: 'learning multiplier', num: true },
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
  const hist = { rows: {}, lift: [], loading: false, scope: '', request: 0, rollbackRequest: 0, pins: null };

  async function loadHistory() {
    const scope = S.scope, slot = S.slot, request = ++hist.request;
    if (hist.scope !== scope) hist.pins = null;
    hist.scope = scope;
    hist.loading = true; C.render();
    const got = await Promise.all(KINDS.map(async k => {
      const selector = C.query({ scope: k.id === 'reflex' ? C.configScope() : S.scope });
      const [history, current] = await Promise.all([C.call(k.path + selector), C.call(k.path.replace(/\/history$/, '') + selector)]);
      return { ...history, authored: current.ok ? C.authored(current.data) : null };
    }));
    if (scope !== S.scope || slot !== S.slot || request !== hist.request || S.path !== 'history') return;
    hist.authored = Object.fromEntries(KINDS.map((k, i) => [k.id, got[i].authored]));
    KINDS.forEach((k, i) => { hist.rows[k.id] = got[i].ok ? got[i].data.revisions || [] : null; });
    const lift = slot ? await C.v1('/lift/history', { slot }) : { ok: false, data: {} };
    if (scope !== S.scope || slot !== S.slot || request !== hist.request || S.path !== 'history') return;
    hist.lift = lift.ok ? lift.data.versions || [] : [];
    hist.loading = false;
    C.render();
  }
  async function rollback(kind, n) {
    if (hist.scope !== S.scope || hist.loading || S.path !== 'history') return;
    if (!window.confirm(`Roll ${kind.title.toLowerCase()} back to revision ${n}? It is written forward as a new revision; nothing is erased.`)) return;
    const scope = S.scope, request = ++hist.rollbackRequest, load = hist.request;
    const res = await C.write(`${kind.rollback(n)}${C.query({ scope: kind.id === 'reflex' ? C.configScope() : S.scope })}`, 'POST', {}, hist.authored && hist.authored[kind.id]);
    if (scope !== S.scope || request !== hist.rollbackRequest || load !== hist.request || S.path !== 'history') return;
    if (!res.ok || res.data.ok === false) { C.render(); return; }
    if (kind.id === 'slots') hist.pins = { report: res.data.pinDiagnostics || null, revision: res.data.revision };
    C.flash(`Rolled revision ${fmt(n)} forward as revision ${fmt(res.data.revision)}.`);
    await loadHistory();
  }

  C.view({
    id: 'history', group: 'This brand', title: 'History', heading: 'Who changed what',
    hint: 'Every document the engine reads is versioned, attributed and reversible. Rolling back writes the old content forward as a new revision, so the record shows the rollback rather than hiding what it undid.',
    async enter() { await loadHistory(); },
    render(host) {
      if (hist.scope === S.scope && hist.pins) host.append(C.pinFeedback(hist.pins.report, `Rollback revision ${fmt(hist.pins.revision)} response`),
        h('a', { class: 'link', href: C.href('rules') }, 'Inspect current pin checks in Slot rules'));
      if (hist.scope !== S.scope || hist.loading) { host.append(h('div', { class: 'empty' }, 'Reading the history…')); return; }
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
