// public/console/views-config.js
// ---------------------------------------------------------------------------
// The two configuration screens, migrated into the application (doc 28 §3.1).
//
//   Interests   /tuning.html's whole subject: what each shopper action counts
//               for, how long interest lasts, when a shopper joins an audience
//               and when they leave, the registry, and the safety limits. One
//               versioned document (`reflex`), saved as a patch with a note.
//   Slot rules  the four rules that sit on a slot strategy beside its weights:
//               journey stage, freshness, fatigue and diversity, plus the
//               merchandising multipliers and how many pieces the slot shows.
//
// Both keep the tuning page's rule about language: every symbol is named in
// words and every number is shown as its consequence ("interest halves about
// every 41.6 seconds"), because the person tuning this is a merchandiser.
// ---------------------------------------------------------------------------
(() => {
  const C = window.Console;
  const { h, fmt, dec, pct, when, plural } = C;
  const S = C.state;
  const copy = (v) => JSON.parse(JSON.stringify(v));
  const card = (title, why, ...body) => h('section', { class: 'card' },
    h('header', {}, h('h3', {}, title), why ? h('div', { class: 'why' }, why) : null), h('div', { class: 'body' }, ...body));

  const round = (n, d = 2) => (Number.isFinite(n) ? Number(n.toFixed(d)).toString() : '');
  function humanMs(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '';
    const s = ms / 1000;
    if (s < 90) return `${round(s, 1)} seconds`;
    const m = s / 60;
    if (m < 90) return `${round(m, 1)} minutes`;
    const hr = m / 60;
    if (hr < 48) return `${round(hr, 1)} hours`;
    return `${round(hr / 24, 1)} days`;
  }
  /** τ is a time CONSTANT, not a half-life. Half-life is τ·ln2, and that is the number a person can picture. */
  const halfLifeMs = (tauMs) => tauMs * Math.LN2;

  /** One tunable line: what it is, what it does, what the number means, and the control. */
  function trow(o) {
    const input = h('input', {
      class: `num${o.changed ? ' changed' : ''}`, 'data-focus-key': o.key, type: 'number', step: o.step || 'any',
      min: o.min, max: o.max, disabled: !C.canEdit() || null,
    });
    input.value = o.value === undefined || o.value === null || !Number.isFinite(Number(o.value)) ? '' : String(o.value);
    input.addEventListener('input', () => {
      const v = input.value === '' ? undefined : Number(input.value);
      o.onChange(input.value === '' ? undefined : (Number.isFinite(v) ? v : undefined));
    });
    return h('div', { class: 'dial' },
      h('div', {},
        h('div', { class: 'name' }, o.name),
        h('div', { class: 'help' }, o.help),
        o.derived ? h('div', { class: 'derived' }, o.derived) : null,
        o.raw ? h('div', { class: 'itemid' }, o.raw) : null),
      h('div', {}, input, o.unit ? h('div', { class: 'unit' }, o.unit) : null));
  }

  // ═══════════════════════════════════════════════════ Interests (tuning) ════
  // The engine keys actions by raw event name and several names mean the same
  // shopper behaviour. A merchandiser tunes BEHAVIOURS: one row each, with the
  // raw names underneath so the data team can still see exactly what is set.
  const GROUPS = [
    { id: 'view', label: 'Viewed a product', help: 'The shopper opened a product page. The most common signal, and the one everything else is measured against.', keys: ['product_view', 'pdp_view', 'view_product'] },
    { id: 'save', label: 'Saved or wishlisted', help: 'They kept it for later. A deliberate act, so it usually counts for more than a view.', keys: ['wishlist', 'wishlist_add', 'add_to_wishlist', 'save_for_later'] },
    { id: 'cart', label: 'Added to the bag', help: 'Intent to buy, short of buying. Raising this makes the page react faster to what is in the bag.', keys: ['add_to_cart', 'cart_add'] },
    { id: 'buy', label: 'Bought', help: 'The strongest signal there is. Raising it makes a purchase dominate the profile for longer.', keys: ['purchase', 'checkout', 'order_complete'] },
    { id: 'c_impression', label: 'Was shown a piece of content', help: 'A piece rendered in front of them. Dense and involuntary, so it ships at zero: being shown a video must not read as liking video.', keys: ['content_impression'] },
    { id: 'c_dwell', label: 'Lingered on a piece of content', help: 'They stayed on it. Sustained attention, but passive, so it counts for less than a click.', keys: ['content_dwell'] },
    { id: 'c_click', label: 'Clicked a piece of content', help: 'A deliberate act, like opening a product page.', keys: ['content_click'] },
    { id: 'c_video', label: 'Watched a video to the end', help: 'The strongest content signal there is: they stayed for all of it.', keys: ['video_complete'] },
    { id: 'tick', label: 'Time passing, with no action', help: 'A re-check with no new behaviour. Keep this at zero: time should let interest fade, never build it.', keys: ['tick'] },
  ];
  const INHERITED = 'Inherited from the shipped defaults: this document does not mention it. Save any value to make it the document’s own; 0 switches the action off.';

  const cfg = { base: null, draft: null, revision: 0, source: 'loading', inherited: [], warnings: [], errors: [], checking: false, timer: null };
  const groupValue = (doc, g) => {
    const vals = g.keys.filter((k) => k in doc.weights).map((k) => doc.weights[k]);
    if (!vals.length) return null;
    return vals.every((v) => v === vals[0]) ? vals[0] : null;
  };

  function buildPatch() {
    if (!cfg.base || !cfg.draft) return {};
    const p = {};
    for (const f of ['tauMs', 'K', 'thetaIn', 'thetaOut', 'epsilon', 'maxValuesPerDim']) if (cfg.draft[f] !== cfg.base[f]) p[f] = cfg.draft[f];
    const w = {};
    for (const k of Object.keys(cfg.draft.weights)) if (cfg.draft.weights[k] !== cfg.base.weights[k]) w[k] = cfg.draft.weights[k];
    if (Object.keys(w).length) p.weights = w;
    const dims = [];
    cfg.draft.dimensions.forEach((d, i) => {
      const b = cfg.base.dimensions[i] || {};
      const changed = {};
      for (const f of ['tauMs', 'K', 'thetaIn', 'thetaOut']) if (d[f] !== b[f]) changed[f] = d[f];
      if (Object.keys(changed).length) dims.push({ key: d.key, ...changed });
    });
    if (dims.length) p.dimensions = dims;
    return p;
  }
  const patchCount = () => {
    const p = buildPatch();
    return Object.keys(p).filter((k) => k !== 'weights' && k !== 'dimensions').length
      + Object.keys(p.weights || {}).length + (p.dimensions || []).length;
  };

  function scheduleCheck() {
    clearTimeout(cfg.timer);
    cfg.checking = true;
    cfg.timer = setTimeout(async () => {
      const patch = buildPatch();
      if (!Object.keys(patch).length) { cfg.errors = []; cfg.checking = false; C.render(); return; }
      const r = await C.call(`/config/reflex/validate${C.query({ scope: S.scope })}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patch }) });
      cfg.errors = r.data.valid ? [] : r.data.errors || ['The settings as drafted were refused.'];
      cfg.checking = false;
      C.render();
    }, 350);
    C.render();
  }
  async function loadConfig() {
    const { data } = await C.call(`/config/reflex${C.query({ scope: S.scope })}`);
    cfg.base = data.config || null;
    cfg.draft = data.config ? copy(data.config) : null;
    cfg.revision = data.revision || 0;
    cfg.source = data.source || 'compiled-default';
    cfg.inherited = data.inherited || [];
    cfg.warnings = data.warnings || [];
    cfg.errors = [];
  }
  async function saveConfig(note) {
    const patch = buildPatch();
    if (!Object.keys(patch).length) return;
    const res = await C.write(`/config/reflex${C.query({ scope: S.scope })}`, 'PATCH', { patch, note });
    if (!res.ok || res.data.ok === false) { C.render(); return; }
    document.getElementById('note').value = '';
    C.flash(`Saved as revision ${fmt(res.data.revision)}. Live now, on ${res.data.version}.`);
    await loadConfig();
  }

  C.view({
    id: 'interests', group: 'This brand', title: 'Interests', heading: 'What the engine notices, and how fast it forgets',
    hint: 'Every shopper action adds points to the interests it touches; points fade while she is away. These are those numbers. They take effect without a deployment.',
    async enter() { await loadConfig(); },
    render(host) {
      if (!cfg.draft) { host.append(h('div', { class: 'empty' }, 'Could not read the settings. The engine is still running on whatever is stored; this screen just cannot see it.')); return; }
      const D = cfg.draft, B = cfg.base;
      C.dirty({ count: patchCount(), checking: cfg.checking, blocked: cfg.errors.length > 0, save: saveConfig, discard: () => { cfg.draft = copy(cfg.base); cfg.errors = []; C.render(); } });

      if (cfg.errors.length) host.append(h('div', { class: 'msg err' }, 'This change cannot be saved:', h('ul', {}, ...cfg.errors.map((e) => h('li', {}, String(e))))));
      if (cfg.warnings.length) host.append(h('div', { class: 'msg note' }, 'What the shipped defaults have that this document does not:', h('ul', {}, ...cfg.warnings.map((w) => h('li', {}, String(w)))), 'Nothing scores on a missing interest here. Add it under the registry below if this brand should learn it.'));
      host.append(h('div', { class: 'sub', style: 'margin-bottom:10px' },
        cfg.source === 'stored' ? `Reading revision ${fmt(cfg.revision)}, stamped ${D.version}.` : `Nothing tuned for this brand yet: these are the settings the engine shipped with, stamped ${D.version}.`));

      // 1. What each action counts for.
      const rows = [];
      for (const g of GROUPS) {
        const present = g.keys.filter((k) => k in D.weights);
        if (!present.length) continue;
        const v = groupValue(D, g);
        rows.push(trow({
          name: g.label, help: g.help,
          derived: present.every((k) => cfg.inherited.includes(k)) ? INHERITED : undefined,
          raw: present.join(', '), value: v === null ? undefined : v, changed: v !== groupValue(B, g),
          unit: 'points', key: `w:${g.id}`,
          onChange: (nv) => { for (const k of g.keys) if (k in D.weights) D.weights[k] = nv; scheduleCheck(); },
        }));
      }
      const grouped = new Set(GROUPS.flatMap((g) => g.keys));
      for (const k of Object.keys(D.weights)) {
        if (grouped.has(k)) continue;
        rows.push(trow({
          name: k, help: 'An action this screen does not group. Its weight works exactly like the ones above.',
          derived: cfg.inherited.includes(k) ? INHERITED : undefined,
          value: D.weights[k], changed: D.weights[k] !== B.weights[k], unit: 'points', key: `w:${k}`,
          onChange: (nv) => { D.weights[k] = nv; scheduleCheck(); },
        }));
      }
      host.append(card('What each shopper action counts for',
        'Every action adds points to the interests it touches. These are the points. They are relative to each other, so what matters is the ratio, not the size.', ...rows));

      // 2. Pace.
      const half = humanMs(halfLifeMs(D.tauMs));
      const toHalf = D.weights.product_view > 0 ? D.K / D.weights.product_view : null;
      host.append(card('How long the engine remembers, and how much it takes to be sure',
        'These two decide the pace. Together they are the difference between a page that reacts to the last click and one that reacts to the whole visit.',
        trow({ name: 'How long interest lasts', help: 'Points fade continuously while a shopper is inactive. Shorten this and the page follows the last few minutes closely; lengthen it and the page remembers the whole visit.',
          derived: half ? `Interest halves about every ${half} of inactivity.` : 'Enter a positive number.',
          value: D.tauMs, changed: D.tauMs !== B.tauMs, unit: 'milliseconds (τ)', key: 'tauMs', onChange: (v) => { D.tauMs = v; scheduleCheck(); } }),
        trow({ name: 'How much activity counts as strong interest', help: 'The point at which the engine treats an interest as half as strong as it can get. Lower it and shoppers commit sooner on less evidence; raise it and the engine waits for more.',
          derived: toHalf ? `A shopper is halfway to full strength after about ${round(toHalf, 1)} product views.` : 'Set a product-view weight above zero to see this in shopper terms.',
          value: D.K, changed: D.K !== B.K, unit: 'points (K)', key: 'K', onChange: (v) => { D.K = v; scheduleCheck(); } })));

      // 3. The band.
      const inV = D.thetaIn, outV = D.thetaOut;
      const ok = Number.isFinite(inV) && Number.isFinite(outV) && outV < inV;
      const clamp = (x) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
      const band = h('div', { class: 'band' });
      band.innerHTML =
        `<div class="track">
           <div class="fill" style="left:${Math.min(clamp(inV), clamp(outV)) * 100}%;width:${Math.abs(clamp(inV) - clamp(outV)) * 100}%"></div>
           <div class="mark out" style="left:${clamp(outV) * 100}%"></div>
           <div class="mark" style="left:${clamp(inV) * 100}%"></div>
           <div class="lab" style="left:${clamp(outV) * 100}%">leaves ${round(outV)}</div>
           <div class="lab" style="left:${clamp(inV) * 100}%">joins ${round(inV)}</div>
         </div><div class="caption"></div>`;
      band.querySelector('.caption').textContent = ok
        ? 'The shaded gap is what stops a shopper flickering in and out of an audience on every click. Once in, they stay in until interest falls all the way back through the lower mark.'
        : 'The leave point must sit strictly below the join point. With no gap a shopper enters and exits on alternate events, which looks to everyone like the engine is broken.';
      host.append(card('When a shopper joins an audience, and when they leave',
        'Membership is not a switch at one number. There are two, and the distance between them is deliberate.',
        trow({ name: 'A shopper joins an audience at', help: 'How strong an interest has to get before the shopper qualifies.', value: inV, changed: inV !== B.thetaIn, unit: 'strength (θ in)', key: 'thetaIn', onChange: (v) => { D.thetaIn = v; scheduleCheck(); } }),
        trow({ name: 'and leaves when it falls below', help: 'How far the interest has to fade before they drop out again. Always lower than the join point.', value: outV, changed: outV !== B.thetaOut, unit: 'strength (θ out)', key: 'thetaOut', onChange: (v) => { D.thetaOut = v; scheduleCheck(); } }),
        band));

      // 4. The registry.
      const dimRows = D.dimensions.map((d, i) => {
        const b = B.dimensions[i] || {};
        const cell = (field) => {
          const has = d[field] !== undefined;
          const el = h('input', { class: `num${has !== (b[field] !== undefined) || (has && d[field] !== b[field]) ? ' changed' : ''}`, 'data-focus-key': `dim:${d.key}:${field}`, type: 'number', step: 'any', placeholder: 'inherit', disabled: !C.canEdit() || null });
          el.value = has ? String(d[field]) : '';
          el.addEventListener('input', () => {
            const v = el.value === '' ? undefined : Number(el.value);
            if (v === undefined || !Number.isFinite(v)) delete D.dimensions[i][field]; else D.dimensions[i][field] = v;
            scheduleCheck();
          });
          return h('td', { class: 'num' }, el);
        };
        return h('tr', {},
          h('td', {}, h('div', { class: 'dimname' }, d.key), h('div', { class: 'dimsrc' }, d.multi ? 'several values at once' : 'one value')),
          h('td', {}, d.source),
          cell('tauMs'),
          h('td', { class: 'num' }, h('span', { class: 'inherit' }, humanMs(halfLifeMs(d.tauMs !== undefined ? d.tauMs : D.tauMs)))),
          cell('K'), cell('thetaIn'), cell('thetaOut'));
      });
      host.append(card('The interests the engine scores on',
        'The agreed list of what the engine may notice. Each one can keep the settings above or override them; blank means it inherits. Price posture, for example, moves more slowly than product interest, so it usually gets a longer memory of its own.',
        C.table([
          { key: 'k', label: 'Interest' }, { key: 'src', label: 'Read from' },
          { key: 'tau', label: 'Lasts', sym: 'τ', num: true }, { key: 'half', label: 'Halves after', num: true },
          { key: 'K', label: 'Strong at', sym: 'K', num: true },
          { key: 'in', label: 'Joins', sym: 'θ in', num: true }, { key: 'out', label: 'Leaves', sym: 'θ out', num: true },
        ], dimRows)));

      // 5. Limits.
      host.append(card('Safety limits',
        'Guards on how much the engine holds per shopper. Change these rarely, and never to fix a relevance problem: they bound memory, they do not shape decisions.',
        trow({ name: 'Forget an interest weaker than', help: 'Interests that fade below this are dropped entirely rather than carried at almost zero.', value: D.epsilon, changed: D.epsilon !== B.epsilon, unit: 'strength (ε)', key: 'epsilon', onChange: (v) => { D.epsilon = v; scheduleCheck(); } }),
        trow({ name: 'Track at most, per interest', help: 'How many distinct values one interest may hold at once. The weakest is dropped past this.', value: D.maxValuesPerDim, changed: D.maxValuesPerDim !== B.maxValuesPerDim, unit: 'values', key: 'maxValuesPerDim', onChange: (v) => { D.maxValuesPerDim = v; scheduleCheck(); } })));
    },
  });

  // ═══════════════════════════════════════════════════════ Slot rules ════════
  const rules = { doc: null, draft: null, revision: 0, errors: [], checking: false, timer: null };
  const strategyOf = (doc) => {
    for (const [page, list] of Object.entries((doc && doc.pages) || {})) {
      const i = (list || []).findIndex((x) => x.slot === S.slot);
      if (i >= 0) return { page, i, strategy: list[i] };
    }
    return null;
  };
  function ruleCheck() {
    clearTimeout(rules.timer);
    rules.checking = true;
    rules.timer = setTimeout(async () => {
      const r = await C.call(`/content/slots/validate${C.query({ scope: S.scope })}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ document: rules.draft }) });
      rules.errors = r.data.valid ? [] : r.data.errors || ['The slot document as drafted was refused.'];
      rules.checking = false;
      C.render();
    }, 350);
    C.render();
  }
  async function loadRules() {
    // Same rule as the dials: a failed read says so and paints an empty document,
    // rather than leaving the screen on the word "Loading" for ever.
    const res = await C.content('/slots');
    const data = res.data || {};
    rules.failed = res.ok ? '' : (res.status === 401 || res.status === 403
      ? 'Sign in at the top right to read this brand\u2019s slot document.'
      : `Could not read the slot document (${res.status || 'no answer'}).`);
    rules.doc = data.document || { pages: {} };
    rules.draft = copy(rules.doc);
    rules.revision = data.revision || 0;
    rules.errors = [];
  }
  async function saveRules(note) {
    const res = await C.write(`/content/slots${C.query({ scope: S.scope })}`, 'PUT', { document: rules.draft, note });
    if (!res.ok || res.data.ok === false) { C.render(); return; }
    document.getElementById('note').value = '';
    C.flash(`Saved as slots revision ${fmt(res.data.revision)}. Live on the next decision.`);
    await Promise.all([loadRules(), C.loadSlots()]);
  }
  /** How many settings differ, so the bar says "3 changes" and not "1 change" for any edit at all. */
  function countDiff(a, b) {
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return JSON.stringify(a) === JSON.stringify(b) ? 0 : 1;
    let n = 0;
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) n += countDiff(a[k], b[k]);
    return n;
  }
  const ruleChanged = () => countDiff(rules.doc, rules.draft);

  /** A rule is off when it is absent. Switching it on writes its defaults; switching it off deletes it. */
  function toggle(name, on, defaults, target) {
    if (on) target[name] = { ...defaults, ...(target[name] || {}) }; else delete target[name];
    ruleCheck();
  }
  function ruleCard(title, why, on, onToggle, ...body) {
    const sw = h('select', { class: 'small', 'data-focus-key': `rule:${title}`, disabled: !C.canEdit() || null },
      h('option', { value: 'off', selected: on ? null : true }, 'off'),
      h('option', { value: 'on', selected: on ? true : null }, 'on'));
    sw.addEventListener('change', () => onToggle(sw.value === 'on'));
    return h('section', { class: 'card' },
      h('header', {}, h('h3', {}, title), h('div', { class: 'why' }, why)),
      h('div', { class: 'body' }, h('div', { class: 'dial' }, h('div', {}, h('div', { class: 'name' }, 'This rule is'), h('div', { class: 'help' }, on ? 'On: it is itemised on every receipt it touches.' : 'Off: it takes no part in the decision and appears on no receipt.')), sw), ...(on ? body : [])));
  }

  C.view({
    id: 'rules', group: 'This slot', title: 'Slot rules', heading: 'The rules on this slot',
    hint: 'Beside the weights, four rules shape what this slot may show: whether a piece suits where the shopper is, how fresh it is, how often she has already seen it, and how much of one thing the slot may show at once.',
    async enter() { await loadRules(); },
    render(host) {
      if (!rules.draft) { host.append(h('div', { class: 'msg err' }, 'The slot document could not be read, so there is nothing to show. Reload the page; if it happens again the platform is not answering.')); return; }
      if (rules.failed) host.append(h('div', { class: 'msg note' }, rules.failed));
      if (!S.slot) { host.append(h('div', { class: 'empty' }, 'Choose a slot in the rail.')); return; }
      const found = strategyOf(rules.draft);
      if (!found) { host.append(h('div', { class: 'empty' }, `${S.slot} is not in the slot document for this brand.`)); return; }
      const st = found.strategy;
      C.dirty({ count: ruleChanged(), checking: rules.checking, blocked: rules.errors.length > 0, save: saveRules, discard: () => { rules.draft = copy(rules.doc); rules.errors = []; C.render(); } });
      if (rules.errors.length) host.append(h('div', { class: 'msg err' }, 'This change cannot be saved:', h('ul', {}, ...rules.errors.map((e) => h('li', {}, String(e))))));
      host.append(h('div', { class: 'sub', style: 'margin-bottom:10px' }, `${S.slot} on ${found.page}, from revision ${fmt(rules.revision)} of the slot document.`));

      const n = (label, help, value, onChange, key, opts, derived) => trow({ name: label, help, value, changed: false, key, unit: (opts || {}).unit, min: (opts || {}).min, max: (opts || {}).max, step: (opts || {}).step, derived, onChange });

      host.append(card('What this slot shows',
        'How many pieces it fills, and the piece a merchandiser has pinned there, which outranks everything the engine would choose.',
        n('Pieces shown at once', 'The slot takes this many from the ranking.', st.take, (v) => { st.take = v ?? 1; ruleCheck(); }, 'take', { min: 1, step: 1, unit: 'pieces' }),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Pinned'), h('span', { class: 'v' }, st.pinnedPieceId ? `${st.pinnedPieceId}: the engine does not rank this slot at all` : 'nothing pinned; the engine ranks the slot'))));

      host.append(ruleCard('Where the shopper is in her journey',
        'Content made for exploring does not serve someone who is deciding. A piece carries the stages it is made for; this rule demotes one made for another stage and can favour one made for hers.',
        Boolean(st.stage), (on) => toggle('stage', on, { outOfStage: 0.5, inStage: 1.2 }, st),
        st.stage ? n('A piece for another stage is worth', 'A multiplier on its score. Below 1 demotes it; 0 removes it from this slot entirely.', st.stage.outOfStage, (v) => { st.stage.outOfStage = v ?? 0; ruleCheck(); }, 'stage.out', { min: 0, max: 1, step: 0.05 }, `${pct(st.stage.outOfStage)} of what it would otherwise score`) : null,
        st.stage ? n('A piece for her stage is worth', 'A multiplier on its score. Above 1 favours it.', st.stage.inStage, (v) => { st.stage.inStage = v ?? 1; ruleCheck(); }, 'stage.in', { min: 1, max: 3, step: 0.05 }) : null));

      host.append(ruleCard('How fresh the piece is',
        'New work earns a bonus that halves as it ages, from the date the piece says it became current.',
        Boolean(st.freshness), (on) => toggle('freshness', on, { weight: 0.2, halfLifeDays: 14 }, st),
        st.freshness ? n('The bonus, on the day it is published', 'Added to the score, then halved every half-life.', st.freshness.weight, (v) => { st.freshness.weight = v ?? 0; ruleCheck(); }, 'fresh.w', { min: 0, max: 1, step: 0.05 }) : null,
        st.freshness ? n('The bonus halves every', 'Days. After this long a piece keeps half its bonus, after twice as long a quarter.', st.freshness.halfLifeDays, (v) => { st.freshness.halfLifeDays = v ?? 14; ruleCheck(); }, 'fresh.h', { min: 1, step: 1, unit: 'days' }) : null));

      host.append(ruleCard('How often she has already seen it',
        'A piece she has been served repeatedly is worth less to her than one she has not. The count comes from her own ring of recent decisions.',
        Boolean(st.fatigue), (on) => toggle('fatigue', on, { weight: 0.3, windowHours: 24, cap: 3 }, st),
        st.fatigue ? n('The penalty, at the cap', 'Taken off the score when she has seen it the capped number of times.', st.fatigue.weight, (v) => { st.fatigue.weight = v ?? 0; ruleCheck(); }, 'fat.w', { min: 0, max: 1, step: 0.05 }) : null,
        st.fatigue ? n('Counting the last', 'Hours. Anything older than this does not count against the piece.', st.fatigue.windowHours, (v) => { st.fatigue.windowHours = v ?? 24; ruleCheck(); }, 'fat.win', { min: 1, step: 1, unit: 'hours' }) : null,
        st.fatigue ? n('The most times counted', 'Past this the penalty stops growing.', st.fatigue.cap, (v) => { st.fatigue.cap = v ?? 3; ruleCheck(); }, 'fat.cap', { min: 1, step: 1, unit: 'times' }) : null));

      host.append(ruleCard('How much of one thing it may show',
        'A slot that takes several pieces can fill with one category. This holds a ceiling on how many of them may share a value, and the piece over the limit yields to the next one.',
        Boolean(st.diversity), (on) => toggle('diversity', on, { dimension: 'category', max: 2 }, st),
        st.diversity ? h('div', { class: 'dial' },
          h('div', {}, h('div', { class: 'name' }, 'Counted on'), h('div', { class: 'help' }, 'Which interest the ceiling applies to: at most so many pieces sharing one of its values.')),
          (() => { const el = h('input', { class: 'txt', 'data-focus-key': 'div.dim', disabled: !C.canEdit() || null }); el.value = st.diversity.dimension || ''; el.addEventListener('input', () => { st.diversity.dimension = el.value.trim(); ruleCheck(); }); return el; })()) : null,
        st.diversity ? n('At most', 'Pieces sharing one value of that interest.', st.diversity.max, (v) => { st.diversity.max = v ?? 2; ruleCheck(); }, 'div.max', { min: 1, step: 1, unit: 'pieces' }) : null));

      host.append(ruleCard('Season, promotion and margin',
        'The merchandising multipliers. Each is the item’s own signal times the weight set here, itemised on the receipt as the score it moved. Their product is clamped, so a multiplier tilts a page and never reorders it on its own.',
        Boolean(st.merchandising), (on) => toggle('merchandising', on, { season: 0, promotion: 0, margin: 0, maxBoost: 2, minBoost: 0.5 }, st),
        ...(st.merchandising ? ['season', 'promotion', 'margin'].map((k) => n(`Weight on ${k}`, `How much the item’s own ${k} signal moves its score. 0 switches this term off; a negative weight demotes, which is an ordinary merchandising wish.`, st.merchandising[k], (v) => { st.merchandising[k] = v ?? 0; ruleCheck(); }, `merch.${k}`, { min: -1, max: 1, step: 0.05 })) : []),
        st.merchandising ? n('The most they may raise a score', 'The ceiling on all three together.', st.merchandising.maxBoost, (v) => { st.merchandising.maxBoost = v ?? 2; ruleCheck(); }, 'merch.max', { min: 1, step: 0.1, unit: '×' }) : null,
        st.merchandising ? n('The most they may lower it', 'The floor on all three together. Zeroing a piece is a block, which is a different layer on purpose.', st.merchandising.minBoost, (v) => { st.merchandising.minBoost = v ?? 0.5; ruleCheck(); }, 'merch.min', { min: 0, max: 1, step: 0.05 }) : null));
    },
  });
})();
