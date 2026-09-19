/* eslint-env browser */
// public/console/views-config.js
// ---------------------------------------------------------------------------
// The two configuration screens, migrated into the application (doc 28 §3.1).
//
//   Interests   /tuning.html's whole subject: what each shopper action counts
//               for, how long interest lasts, when a shopper joins an audience
//               and when they leave, the registry, and the safety limits. One
//               versioned document (`reflex`), saved as a patch with a note.
//   Slot rules  dimension weights and the rules on a slot strategy:
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
      const r = await C.call(`/config/reflex/validate${C.query({ scope: C.configScope() })}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patch }) });
      cfg.errors = r.data.valid ? [] : r.data.errors || ['The settings as drafted were refused.'];
      cfg.checking = false;
      C.render();
    }, 350);
    C.render();
  }
  async function loadConfig() {
    const { data } = await C.call(`/config/reflex${C.query({ scope: C.configScope() })}`);
    cfg.authored = C.authored(data);
    cfg.base = data.authored || null;
    cfg.draft = data.authored ? copy(data.authored) : null;
    cfg.revision = data.revision || 0;
    cfg.source = data.source || 'compiled-default';
    cfg.inherited = data.inherited || [];
    cfg.warnings = data.warnings || [];
    cfg.errors = [];
  }
  async function saveConfig(note) {
    const patch = buildPatch();
    if (!Object.keys(patch).length) return;
    const res = await C.write(`/config/reflex${C.query({ scope: C.configScope() })}`, 'PATCH', { patch, note }, cfg.authored);
    if (!res.ok || res.data.ok === false) { C.render(); return; }
    document.getElementById('note').value = '';
    C.flash(`Saved as revision ${fmt(res.data.revision)}. Published as ${res.data.version}; serving refreshes within 30 seconds.`);
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
  // Shared by Rules and the existing History rollback response, using text only.
  C.pinFeedback = (report, label) => {
    const valid = report && report.schema === 'slot-pin-diagnostics/v1' && report.advisory === true;
    const count = value => Number.isSafeInteger(value) && value >= 0;
    const reasons = { missing_piece: 'Pinned piece is missing from this catalog.', slot_type: 'Pinned piece does not allow this slot type.', currently_ineligible: 'Pinned piece is currently outside lifecycle, publish-window or stock eligibility.', off_limits: 'Pin is dormant: this slot is off-limits and receives no engine decision.', excluded: 'Pinned piece is explicitly excluded from this slot and cannot be served.', type_not_allowed: 'Pinned piece has a rendering type not allowed in this slot.', excluded_tag: 'Pinned piece matches an exact excluded tag in this slot.' };
    let detail = 'Pin check unavailable. No catalog-reference assurance is available; saving remains subject to normal slot validation.';
    const warnings = [];
    if (valid && report.status === 'not_required') detail = 'No pins in this document; catalog not read. This is not a checked-catalog result.';
    if (valid && report.status === 'available' && report.catalog && report.catalog.source === 'stored' && count(report.catalog.revision) && report.catalog.revision > 0
      && (report.slotsRevision === null || (count(report.slotsRevision) && report.slotsRevision > 0))
      && count(report.warningCount) && count(report.omittedWarningCount) && Array.isArray(report.warnings) && report.warnings.length <= 50
      && report.warningCount === report.warnings.length + report.omittedWarningCount
      && report.warnings.every(w => w && count(w.pageIndex) && count(w.slotIndex) && (w.pinIndex === undefined || count(w.pinIndex) && w.pinIndex < 50) && Object.hasOwn(reasons, w.reason))
      && typeof report.checkedAt === 'string' && report.checkedAt.length <= 64 && Number.isFinite(Date.parse(report.checkedAt))) {
      detail = `${report.slotsRevision === null ? 'Draft' : `Slot revision ${fmt(report.slotsRevision)}`}; catalog revision ${fmt(report.catalog.revision)}, checked ${report.checkedAt.slice(0, 64)}. ${fmt(report.warningCount)} pin warnings; ${fmt(report.omittedWarningCount)} not shown.`;
      for (const warning of report.warnings.slice(0, 50)) if (Number.isSafeInteger(warning.pageIndex) && Number.isSafeInteger(warning.slotIndex) && Object.hasOwn(reasons, warning.reason)) {
        warnings.push(h('li', {}, `Page ${warning.pageIndex + 1}, slot ${warning.slotIndex + 1}${warning.pinIndex !== undefined ? `, pinned position ${warning.pinIndex + 1}` : ''}: ${reasons[warning.reason]}`));
      }
    }
    return h('div', { class: 'msg note', 'data-pin-feedback': label }, h('strong', {}, `${label}: `), detail,
      warnings.length ? h('ul', {}, ...warnings) : null,
      h('div', { class: 'help' }, 'Advisory only, not atomic activation or guaranteed delivery. Scheduled pins remain authorable; runtime rechecks eligibility and never fills a refused pin arbitrarily.'));
  };
  const rules = { doc: null, draft: null, revision: 0, errors: [], checking: false, timer: null,
    scope: '', load: 0, validation: 0, dimensions: [], registryError: '', pins: null, activation: null, exclusionEditors: new Map(), labels: new Map() };
  const editorErrors = () => [...rules.exclusionEditors.values()].flatMap(fields => [...fields.values()].map(editor => editor.error)).filter(Boolean);

  // ── A refusal in the words of the screen that was refused ──────────────────
  // The validator answers in the language of the payload schema: the document
  // path it refused and the rule it broke ("pages.home[0].stage.inStage:
  // outOfStage | inStage, number 0..1"). That is not the language of the person
  // editing this screen. `rules.labels` is filled by the render itself, one
  // entry per control it draws, keyed by the path the validator would name for
  // that control, so a refusal is worded with the very label printed above the
  // field it is about and the two can never drift apart. It is one mapping for
  // every control, with no case for any particular rule. A path this render did
  // not draw keeps the platform's own sentence: an error is reworded or shown
  // verbatim, never hidden, and the save stays blocked either way.
  const pathValue = (root, path) => {
    let node = root;
    for (const step of String(path).split('.')) {
      const name = step.replace(/\[\d+\]/g, ''), indices = step.match(/\[\d+\]/g) || [];
      if (name) {
        if (node === null || typeof node !== 'object' || !Object.hasOwn(node, name)) return undefined;
        node = node[name];
      }
      for (const index of indices) {
        const i = Number(index.slice(1, -1));
        if (!Array.isArray(node) || i >= node.length) return undefined;
        node = node[i];
      }
    }
    return node;
  };
  /**
   * The refused value, exactly as it stands in the draft: a number as typed, a
   * string quoted so that spaces are visible, and a block of settings as its own
   * labelled lines. Anything the screen cannot name part by part is left out
   * rather than printed as raw JSON; the field itself is on the screen above.
   */
  function valueWords(value, path) {
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'boolean') return String(value);
    if (value === null || typeof value !== 'object') return '';
    const parts = [];
    for (const [key, child] of Object.entries(value)) {
      const label = rules.labels.get(`${path}.${key}`), words = valueWords(child, `${path}.${key}`);
      if (!label || !words) return '';
      parts.push(`${label} ${words}`);
    }
    return parts.join('; ');
  }
  function refusalLine(error) {
    const text = String(error), cut = text.indexOf(': '), path = cut > 0 ? text.slice(0, cut) : '';
    const label = path ? rules.labels.get(path) : undefined;
    if (!label) return h('li', {}, text);
    const detail = text.slice(cut + 2), value = pathValue(rules.draft, path), shown = valueWords(value, path);
    const several = shown !== '' && value !== null && typeof value === 'object';
    return h('li', {},
      several ? `${label}: this cannot be saved as it stands (${detail}). It reads: ${shown}.`
        : shown ? `${label}: ${shown} is not a value this setting takes (${detail}).`
          : `${label}: this cannot be saved as it stands (${detail}).`,
      h('div', { class: 'itemid' }, text));
  }
  const strategyOf = (doc) => {
    for (const [page, list] of Object.entries((doc && doc.pages) || {})) {
      const i = (list || []).findIndex((x) => x.slot === S.slot);
      if (i >= 0) return { page, i, strategy: list[i] };
    }
    return null;
  };
  function ruleCheck() {
    if (!rules.draft || rules.scope !== S.scope) return;
    clearTimeout(rules.timer);
    rules.checking = true; rules.pins = null; rules.activation = null;
    const scope = rules.scope, request = rules.load, generation = ++rules.validation, draft = rules.draft;
    if (editorErrors().length) { rules.errors = editorErrors(); rules.checking = false; C.render(); return; }
    rules.timer = setTimeout(async () => {
      if (scope !== S.scope || request !== rules.load || generation !== rules.validation) return;
      const r = await C.call(`/content/slots/validate${C.query({ scope })}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ document: draft }) });
      if (scope !== S.scope || request !== rules.load || generation !== rules.validation) return;
      rules.errors = r.data.valid ? [] : r.data.errors || ['The slot document as drafted was refused.'];
      rules.pins = r.data.valid ? r.data.pinDiagnostics || null : null;
      rules.checking = false;
      C.render();
    }, 350);
    C.render();
  }
  async function loadRules(activation = null) {
    // Same rule as the dials: a failed read says so and paints an empty document,
    // rather than leaving the screen on the word "Loading" for ever.
    const request = ++rules.load, scope = S.scope;
    clearTimeout(rules.timer);
    ++rules.validation; rules.pins = null; rules.activation = activation;
    rules.exclusionEditors.clear();
    rules.scope = scope; rules.doc = null; rules.draft = null; rules.dimensions = []; rules.checking = false;
    C.render();
    const [res, registry] = await Promise.all([
      C.content('/slots'), C.call(`/config/reflex${C.query({ scope: C.configScope() })}`),
    ]);
    if (request !== rules.load || scope !== S.scope) return;
    const dimensions = registry.data && registry.data.config && registry.data.config.dimensions;
    const validRegistry = registry.ok && Array.isArray(dimensions)
      && dimensions.every(d => d && typeof d.key === 'string' && d.key.length > 0);
    rules.dimensions = validRegistry ? [...new Set(dimensions.map(d => d.key))] : [];
    rules.registryError = rules.dimensions.length ? '' : 'Dimension editor unavailable: this brand’s dimension registry could not be read or has no dimensions. Stored weights are preserved; no replacement registry is assumed.';
    const data = res.data || {};
    rules.failed = res.ok ? '' : (res.status === 401 || res.status === 403
      ? 'Sign in at the top right to read this brand\u2019s slot document.'
      : `Could not read the slot document (${res.status || 'no answer'}).`);
    rules.authored = res.ok ? C.authored(data) : null;
    rules.doc = data.document || { pages: {} };
    rules.draft = copy(rules.doc);
    rules.revision = data.revision || 0;
    rules.pins = res.ok ? data.pinDiagnostics || null : null;
    rules.errors = [];
    C.render();
  }
  /**
   * What the platform's own answer says about publication, in the operator's
   * words. A saved revision is not yet a serving one: the answer names the
   * published version and the publication identity the serving side will read,
   * and this says both, exactly as the Interests save does above. When the
   * answer carries no confirmed publication — no publication identity of the
   * shape `C.authored` admits, or no version label — it says that instead of
   * claiming a publication that was never acknowledged.
   */
  const publicationWords = (data) => {
    const version = data && typeof data.version === 'string' ? data.version.trim() : '';
    return version && C.authored(data)
      ? `Published as ${version}; serving refreshes within 30 seconds.`
      : 'Publication unconfirmed: the answer named no published version for this revision, so serving may still read the previous one. Check the publication status before authoring another change.';
  };
  async function saveRules(note) {
    if (!rules.draft || rules.scope !== S.scope || rules.checking || rules.errors.length || editorErrors().length) return;
    const scope = rules.scope, request = rules.load, generation = rules.validation;
    const res = await C.write(`/content/slots${C.query({ scope: S.scope })}`, 'PUT', { document: rules.draft, note }, rules.authored);
    if (scope !== S.scope || request !== rules.load || generation !== rules.validation) return;
    if (!res.ok || res.data.ok === false) { C.render(); return; }
    document.getElementById('note').value = '';
    C.flash(`Saved as slots revision ${fmt(res.data.revision)}. ${publicationWords(res.data)} Pin feedback is advisory; delivery is checked at runtime.`);
    await Promise.all([loadRules({ report: res.data.pinDiagnostics || null, revision: res.data.revision }), C.loadSlots()]);
  }
  /** How many settings differ, so the bar says "3 changes" and not "1 change" for any edit at all. */
  function countDiff(a, b) {
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return JSON.stringify(a) === JSON.stringify(b) ? 0 : 1;
    let n = 0;
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) n += countDiff(a[k], b[k]);
    return n;
  }
  const ruleChanged = () => countDiff(rules.doc, rules.draft) + editorErrors().length;

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
    hint: 'Dimension weights set how interests count in this slot. Journey stage, freshness, fatigue, diversity and merchandising can then shape its ranking.',
    async enter() { await loadRules(); },
    render(host) {
      if (rules.scope === S.scope) {
        if (rules.activation) host.append(C.pinFeedback(rules.activation.report, `Saved revision ${fmt(rules.activation.revision)} response`));
        host.append(rules.checking ? h('div', { class: 'msg note' }, 'Pin check pending for this draft; previous feedback cleared.')
          : C.pinFeedback(rules.pins, ruleChanged() ? 'Draft pin check' : 'Current pin check'));
      }
      if (!rules.draft || rules.scope !== S.scope) { host.append(h('div', { class: 'msg err' }, 'The slot document could not be read, so there is nothing to show. Reload the page; if it happens again the platform is not answering.')); return; }
      if (rules.failed) host.append(h('div', { class: 'msg note' }, rules.failed));
      if (!S.slot) { host.append(h('div', { class: 'empty' }, 'Choose a slot in the rail.')); return; }
      const found = strategyOf(rules.draft);
      if (!found) { host.append(h('div', { class: 'empty' }, `${S.slot} is not in the slot document for this brand.`)); return; }
      const st = found.strategy;
      C.dirty({ count: ruleChanged(), checking: rules.checking, blocked: rules.errors.length > 0, save: saveRules, discard: () => { rules.draft = copy(rules.doc); rules.errors = []; rules.exclusionEditors.clear(); ruleCheck(); } });
      // The path the validator names for this slot, and the words this screen
      // shows for it. Every control below registers itself here as it is drawn.
      const at = `pages.${found.page}[${found.i}]`, slotWords = `${S.slot} on ${found.page}`;
      rules.labels = new Map([[at, slotWords], [`pages.${found.page}.${S.slot}`, slotWords]]);
      const named = (fields, label) => {
        for (const field of Array.isArray(fields) ? fields : [fields]) if (field) rules.labels.set(`${at}.${field}`, label);
        return label;
      };
      // Filled once every control has named itself, so the refusal can speak of
      // them; it is appended here so that it stays above the settings it names.
      const refused = rules.errors.length ? h('div', { class: 'msg err' }, 'This change cannot be saved:') : null;
      if (refused) host.append(refused);
      host.append(h('div', { class: 'sub', style: 'margin-bottom:10px' }, `${slotWords}, from revision ${fmt(rules.revision)} of the slot document.`,
        ' ', h('a', { class: 'link', href: C.href('history') }, 'History and rollback')));

      // `path` is the control's own place in the slot document — the name the
      // validator will use if it refuses it — so each control is registered by
      // the same call that draws it and its label is written once.
      const n = (label, help, value, onChange, key, opts, derived) => trow({ name: named((opts || {}).path, label), help, value, changed: false, key, unit: (opts || {}).unit, min: (opts || {}).min, max: (opts || {}).max, step: (opts || {}).step, derived, onChange });

      host.append(card('What this slot shows',
        st.offLimits ? 'Off-limits: no piece is selected; pin and ranking settings are dormant.' : 'Pins occupy the first positions in exact order. If any required prefix pin fails, the whole slot is refused: no shifted positions or arbitrary replacement.',
        n('Pieces shown at once', 'Total capacity, including pinned first positions and the ranked remainder.', st.take, (v) => { st.take = v ?? 1; ruleCheck(); }, 'take', { min: 1, step: 1, unit: 'pieces', path: 'take' }),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, 'Pinned'), h('span', { class: 'v' }, st.offLimits ? `${JSON.stringify(st.pinnedPieceIds ?? st.pinnedPieceId ?? [])}; dormant while off-limits` : st.pinnedPieceIds ? `${JSON.stringify(st.pinnedPieceIds)} first; ${Math.max(0, st.take - st.pinnedPieceIds.length)} ranked positions` : st.pinnedPieceId ? `${st.pinnedPieceId}: the engine does not rank this slot at all` : 'nothing pinned; the engine ranks the slot'))));

      const scope = rules.scope, draft = rules.draft;
      const currentEditor = () => scope === S.scope && draft === rules.draft && S.slot === st.slot && strategyOf(draft)?.strategy === st;
      const off = h('select', { class: 'small', 'data-focus-key': 'governance.off', disabled: !C.canEdit() || null },
        h('option', { value: 'false', selected: st.offLimits ? null : true }, 'Engine may select'),
        h('option', { value: 'true', selected: st.offLimits ? true : null }, 'Off-limits'));
      off.addEventListener('change', () => { if (!currentEditor()) return; st.offLimits = off.value === 'true'; ruleCheck(); });
      const jsonEditor = (field, focus, neutral, syntax, nullDeletes = false) => {
        const input = h('textarea', { class: 'txt', rows: 3, 'data-focus-key': focus, disabled: !C.canEdit() || null });
        input.value = rules.exclusionEditors.get(st)?.get(field)?.text ?? JSON.stringify((field === 'pinnedPieceId' ? st.pinnedPieceIds ?? st[field] : st[field]) ?? neutral);
        input.addEventListener('input', () => {
          if (!currentEditor()) return;
          const editor = { text: input.value, error: '' };
          try {
            const value = JSON.parse(input.value);
            if (field === 'pinnedPieceId') {
              delete st.pinnedPieceId; delete st.pinnedPieceIds;
              if (Array.isArray(value)) st.pinnedPieceIds = value;
              else if (value !== null) st.pinnedPieceId = value;
            } else if (nullDeletes && value === null) delete st[field]; else st[field] = value;
          } catch { editor.error = syntax; }
          let fields = rules.exclusionEditors.get(st);
          if (!fields) { fields = new Map(); rules.exclusionEditors.set(st, fields); }
          fields.set(field, editor);
          ruleCheck();
        });
        return input;
      };
      const excluded = jsonEditor('excludedPieceIds', 'governance.excluded', [], 'Excluded piece IDs must be a valid JSON array. Use [] to clear; malformed text cannot be saved.');
      const tagEditor = jsonEditor('excludedTags', 'governance.tags', [], 'Excluded tags must be a valid JSON array of dimension/value pairs. Use [] to clear.');
      const typeEditor = jsonEditor('allowedTypes', 'governance.types', null, 'Allowed rendering types must be a valid JSON array or null to remove the limit.', true);
      const pinEditor = jsonEditor('pinnedPieceId', 'governance.pin', null, 'Pins must be a valid JSON string, ordered array or null to clear.', true);
      host.append(card('Hard slot controls',
        'These gates apply on every arm before pins, scoring and diversity. No decision leaves the site’s existing default in place; no fallback asset is selected.',
        h('div', { class: 'dial' }, h('div', {}, h('div', { class: 'name' }, named('offLimits', 'Off-limits')), h('div', { class: 'help' }, 'No engine candidates, decisions or records. Pin and ranking settings remain stored but dormant.')), off),
        st.offLimits ? h('div', { class: 'msg note' }, 'Off-limits: the pin and all ranking settings below are dormant. Re-enabling must pass current pin validation.') : null,
        h('div', { class: 'name' }, named(['pinnedPieceId', 'pinnedPieceIds'], 'Pinned internal piece IDs (JSON string, array or null)')), pinEditor,
        h('div', { class: 'help' }, 'Exact IDs, including spaces and escapes. A string keeps the single-pin take-1 contract; an ordered array pins the first positions, up to 50 distinct nonempty IDs and no more than total take. [] or null clears. This editor never changes take automatically. One invalid required prefix pin refuses the whole slot; tag/type conflicts are catalog warnings and runtime refusals, not replacements.'),
        h('div', { class: 'name' }, named('excludedPieceIds', 'Excluded internal piece IDs (JSON array)')), excluded,
        h('div', { class: 'help' }, 'Exact internal catalog IDs, not customer IDs or tags. No trimming or case conversion. Up to 1000 distinct IDs of 1–1024 UTF-16 units; [] clears. An active pin cannot name an excluded ID.'),
        h('div', { class: 'name' }, named('excludedTags', 'Excluded tags (JSON pair array)')), tagEditor,
        h('div', { class: 'help' }, 'Any exact {"dimension":"…","value":"…"} match excludes a piece. Up to 1000 distinct pairs; both strings 1–1024 UTF-16 units. [] clears. No vocabulary, trimming or case conversion. Explicit own tags match literally; only absent contentType uses the safe rendering-type fallback on every arm.'),
        h('div', { class: 'name' }, named('allowedTypes', 'Allowed rendering types (JSON array or null)')), typeEditor,
        h('div', { class: 'help' }, 'Matches piece.type exactly, not tags.contentType. Use 1–1000 distinct strings of 1–1024 UTF-16 units; [] is invalid, null removes the limit. Saved controls apply when the serving worker reads that revision; caches may still hold an earlier revision.')));

      const unregistered = Object.keys(st.weights).filter(key => !rules.dimensions.includes(key));
      host.append(card('How much each interest counts in this slot',
        'Each matching interest strength is multiplied by its dimension weight, then added to the score. Weights are independent, not percentages that must add to 100. Zero switches that contribution off; it does not exclude a piece.',
        st.pinnedPieceId || st.pinnedPieceIds?.length ? h('div', { class: 'msg note' }, 'These weights apply only to the ranked remainder, never to pinned positions. Fully pinned or off-limits slots keep them dormant.') : null,
        rules.registryError ? h('div', { class: 'msg note' }, rules.registryError) : null,
        ...rules.dimensions.map((key, index) => n(`Weight on ${key}`, '0 is off; 1 counts the full interest strength. Clearing the field sets 0.',
          st.weights[key] ?? 0, value => { st.weights[key] = value ?? 0; ruleCheck(); }, `weight:${index}`, { min: 0, max: 1, step: 0.05, path: `weights.${key}` })),
        unregistered.length ? h('div', { class: 'msg note' },
          'Stored weights outside the loaded registry are read-only here. They are preserved, not activated or removed by this editor; only matching dimensions in decision inputs can contribute.',
          ...unregistered.map(key => h('div', { class: 'kv' }, h('span', { class: 'k' }, named(`weights.${key}`, key)), h('span', { class: 'v' }, dec(st.weights[key]))))) : null));

      host.append(ruleCard(named('stage', 'Where the shopper is in her journey'),
        'A piece carries the stages it is made for. This rule can demote a different-stage match or add a bonus for the shopper’s stage; it does not change eligibility.',
        Boolean(st.stage), (on) => toggle('stage', on, { outOfStage: 0.5, inStage: 0.2 }, st),
        st.stage ? n('A piece for another stage is worth', 'Multiplies its score before later terms such as freshness. 1 is neutral; 0 zeros this part of the score, not eligibility. Clearing sets 1.', st.stage.outOfStage ?? 1, (v) => { st.stage.outOfStage = v ?? 1; ruleCheck(); }, 'stage.out', { min: 0, max: 1, step: 0.05, path: 'stage.outOfStage' }, `${pct(st.stage.outOfStage ?? 1)} of what it would otherwise score`) : null,
        st.stage ? n('A piece for her stage gets a bonus of', 'Added to its score, not multiplied. 0 is off; 1 adds a whole point and can outweigh other signals. Clearing sets 0.', st.stage.inStage ?? 0, (v) => { st.stage.inStage = v ?? 0; ruleCheck(); }, 'stage.in', { min: 0, max: 1, step: 0.05, path: 'stage.inStage' }, `+${dec(st.stage.inStage ?? 0)} added to its score`) : null));

      host.append(ruleCard(named('freshness', 'How fresh the piece is'),
        'New work earns a bonus that halves as it ages, from the date the piece says it became current.',
        Boolean(st.freshness), (on) => toggle('freshness', on, { weight: 0.2, halfLifeDays: 14 }, st),
        st.freshness ? n('The bonus, on the day it is published', 'Added to the score, then halved every half-life.', st.freshness.weight, (v) => { st.freshness.weight = v ?? 0; ruleCheck(); }, 'fresh.w', { min: 0, max: 1, step: 0.05, path: 'freshness.weight' }) : null,
        st.freshness ? n('The bonus halves every', 'Days. After this long a piece keeps half its bonus, after twice as long a quarter.', st.freshness.halfLifeDays, (v) => { st.freshness.halfLifeDays = v ?? 14; ruleCheck(); }, 'fresh.h', { min: 1, step: 1, unit: 'days', path: 'freshness.halfLifeDays' }) : null));

      host.append(ruleCard(named('fatigue', 'How often she has already seen it'),
        'A piece she has been served repeatedly is worth less to her than one she has not. The count comes from her own ring of recent decisions.',
        Boolean(st.fatigue), (on) => toggle('fatigue', on, { weight: 0.3, windowHours: 24, cap: 3 }, st),
        st.fatigue ? n('The penalty, at the cap', 'Taken off the score when she has seen it the capped number of times.', st.fatigue.weight, (v) => { st.fatigue.weight = v ?? 0; ruleCheck(); }, 'fat.w', { min: 0, max: 1, step: 0.05, path: 'fatigue.weight' }) : null,
        st.fatigue ? n('Counting the last', 'Hours. Anything older than this does not count against the piece.', st.fatigue.windowHours, (v) => { st.fatigue.windowHours = v ?? 24; ruleCheck(); }, 'fat.win', { min: 1, step: 1, unit: 'hours', path: 'fatigue.windowHours' }) : null,
        st.fatigue ? n('The most times counted', 'Past this the penalty stops growing.', st.fatigue.cap, (v) => { st.fatigue.cap = v ?? 3; ruleCheck(); }, 'fat.cap', { min: 1, step: 1, unit: 'times', path: 'fatigue.cap' }) : null));

      host.append(ruleCard(named('diversity', 'How much of one thing it may show'),
        'A slot that takes several pieces can fill with one category. This holds a ceiling on how many of them may share a value, and the piece over the limit yields to the next one.',
        Boolean(st.diversity), (on) => toggle('diversity', on, { dimension: 'category', max: 2 }, st),
        st.diversity ? h('div', { class: 'dial' },
          h('div', {}, h('div', { class: 'name' }, named('diversity.dimension', 'Counted on')), h('div', { class: 'help' }, 'Which interest the ceiling applies to: at most so many pieces sharing one of its values.')),
          (() => { const el = h('input', { class: 'txt', 'data-focus-key': 'div.dim', disabled: !C.canEdit() || null }); el.value = st.diversity.dimension || ''; el.addEventListener('input', () => { st.diversity.dimension = el.value.trim(); ruleCheck(); }); return el; })()) : null,
        st.diversity ? n('At most', 'Pieces sharing one value of that interest.', st.diversity.max, (v) => { st.diversity.max = v ?? 2; ruleCheck(); }, 'div.max', { min: 1, step: 1, unit: 'pieces', path: 'diversity.max' }) : null));

      host.append(ruleCard(named('merchandising', 'Season, promotion and margin'),
        'The merchandising multipliers. Each is the item’s own signal times the weight set here, itemised on the receipt as the score it moved. Their product is clamped, so a multiplier tilts a page and never reorders it on its own.',
        Boolean(st.merchandising), (on) => toggle('merchandising', on, { season: 0, promotion: 0, margin: 0, maxBoost: 2, minBoost: 0.5 }, st),
        ...(st.merchandising ? ['season', 'promotion', 'margin'].map((k) => n(`Weight on ${k}`, `How much the item’s own ${k} signal moves its score. 0 switches this term off; a negative weight demotes, which is an ordinary merchandising wish.`, st.merchandising[k], (v) => { st.merchandising[k] = v ?? 0; ruleCheck(); }, `merch.${k}`, { min: -1, max: 1, step: 0.05, path: `merchandising.${k}` })) : []),
        st.merchandising ? n('The most they may raise a score', 'The ceiling on all three together.', st.merchandising.maxBoost, (v) => { st.merchandising.maxBoost = v ?? 2; ruleCheck(); }, 'merch.max', { min: 1, step: 0.1, unit: '×', path: 'merchandising.maxBoost' }) : null,
        st.merchandising ? n('The most they may lower it', 'The floor on all three together. Zeroing a piece is a block, which is a different layer on purpose.', st.merchandising.minBoost, (v) => { st.merchandising.minBoost = v ?? 0.5; ruleCheck(); }, 'merch.min', { min: 0, max: 1, step: 0.05, path: 'merchandising.minBoost' }) : null));

      // Every control on this screen has now named itself, so the refusal above
      // can be written in their words.
      if (refused) refused.append(h('ul', {}, ...rules.errors.map((e) => refusalLine(e))));
    },
  });
})();
