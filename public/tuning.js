// public/tuning.js
// ─────────────────────────────────────────────────────────────────────────────
// CW9 — the tuning surface.
//
// Scope appendix §1.4 says weights, decay horizons and thresholds are versioned
// configuration "effective immediately with no deployment", and §3.2's acceptance
// definition says weights are "live-tunable by your team". The store (CW0) made
// that true for anyone who can make an authenticated HTTP call. This makes it
// true for a merchandiser.
//
// Two rules shape every control on this page:
//
//   NAME THE SYMBOL. No control shows τ, K or θ without saying, in plain words,
//   what it does to a shopper. The audience is a merchandiser or an analyst, not
//   the person who wrote the engine. An undefined symbol is not rigour, it is a
//   wall — and the whole no-black-box argument dies the moment someone cannot
//   read the box.
//
//   SHOW THE CONSEQUENCE, NOT THE NUMBER. τ = 60000 means nothing. "Interest
//   halves about every 42 seconds of inactivity" is the same fact, and it is the
//   one a person can actually decide about. Every derived line on this page is
//   computed from the live value, so it moves as you type.
//
// The page never decides whether an edit is legal. It asks the server, through
// the same validator the write path runs, so the UI cannot drift from the store.
// ─────────────────────────────────────────────────────────────────────────────

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const api = (path) => `/config${path}${path.includes('?') ? '&' : '?'}scope=${encodeURIComponent(S.scope)}`;

  const S = {
    scope: new URLSearchParams(location.search).get('scope') || 'coach',
    meta: null,   // { source, revision, actor, note, at }
    base: null,   // config as loaded
    draft: null,  // config as edited
    history: [],
    errors: [],
    token: sessionStorage.getItem('tuning-token') || '',
    checking: false,
  };

  // ── Behaviour groups ───────────────────────────────────────────────────────
  // The engine keys actions by raw event name, and several names mean the same
  // shopper behaviour. Showing thirteen rows of event names to a merchandiser is
  // the "raw event names" mistake: they tune BEHAVIOURS. One row per behaviour,
  // writing every alias underneath it, with the raw names on show so the data
  // team can still see exactly what is being set.
  const GROUPS = [
    { id: 'view', label: 'Viewed a product', help: 'The shopper opened a product page. The most common signal, and the one everything else is measured against.',
      keys: ['product_view', 'pdp_view', 'view_product'] },
    { id: 'save', label: 'Saved or wishlisted', help: 'They kept it for later. A deliberate act, so it usually counts for more than a view.',
      keys: ['wishlist', 'wishlist_add', 'add_to_wishlist', 'save_for_later'] },
    { id: 'cart', label: 'Added to the bag', help: 'Intent to buy, short of buying. Raising this makes the page react faster to what is in the bag.',
      keys: ['add_to_cart', 'cart_add'] },
    { id: 'buy', label: 'Bought', help: 'The strongest signal there is. Raising it makes a purchase dominate the profile for longer.',
      keys: ['purchase', 'checkout', 'order_complete'] },
    { id: 'tick', label: 'Time passing, with no action', help: 'A re-check with no new behaviour. Keep this at zero: time should let interest fade, never build it.',
      keys: ['tick'] },
  ];

  // ── Human numbers ──────────────────────────────────────────────────────────

  function humanMs(ms) {
    if (!isFinite(ms) || ms <= 0) return '—';
    const s = ms / 1000;
    if (s < 90) return `${round(s, 1)} seconds`;
    const m = s / 60;
    if (m < 90) return `${round(m, 1)} minutes`;
    const h = m / 60;
    if (h < 48) return `${round(h, 1)} hours`;
    return `${round(h / 24, 1)} days`;
  }
  const round = (n, d = 2) => Number(n.toFixed(d)).toString();

  /** τ is a time CONSTANT, not a half-life. Half-life is τ·ln2, and that is the
   *  number a person can picture, so it is the one shown. */
  const halfLifeMs = (tauMs) => tauMs * Math.LN2;

  /** a = R/(R+K) reaches 0.5 at R = K, so K/weight is "how many of that action
   *  gets a shopper to half strength". The concrete answer to "what is K". */
  function actionsToHalfStrength(K, weight) {
    if (!weight || weight <= 0) return null;
    return K / weight;
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  // type="text" with inputmode="decimal", not type="number". Every keystroke
  // repaints the panel so the derived lines move as you type, and that means
  // focus and caret have to be restored afterwards — which number inputs refuse
  // to expose a selection for. Half-typed values like "0." also survive here
  // instead of being coerced mid-keystroke.
  function numInput(value, onChange, opts = {}) {
    const el = document.createElement('input');
    el.className = 'num';
    el.type = 'text';
    el.inputMode = 'decimal';
    el.autocomplete = 'off';
    el.spellcheck = false;
    el.value = String(value);
    if (opts.key) el.dataset.focusKey = opts.key;
    el.disabled = !canEdit();
    el.addEventListener('input', () => {
      const text = el.value.trim();
      // An empty box on a dimension override means "inherit"; elsewhere it is
      // simply not a number yet, and the server will say so once it settles.
      const v = text === '' ? '' : Number(text);
      onChange(text === '' ? '' : (Number.isNaN(v) ? text : v));
      scheduleCheck();
      render();
    });
    return el;
  }

  function row({ name, help, derived, raw, value, onChange, unit, changed, key }) {
    const r = document.createElement('div');
    r.className = 'row';
    const left = document.createElement('div');
    left.innerHTML =
      `<div class="name"></div><div class="help"></div>` +
      (derived ? `<div class="derived"></div>` : '') +
      (raw ? `<div class="raw"></div>` : '');
    left.querySelector('.name').textContent = name;
    left.querySelector('.help').textContent = help;
    if (derived) left.querySelector('.derived').textContent = derived;
    if (raw) left.querySelector('.raw').textContent = raw;

    const right = document.createElement('div');
    const input = numInput(value, onChange, { key });
    if (changed) input.classList.add('changed');
    right.appendChild(input);
    if (unit) {
      const u = document.createElement('div');
      u.className = 'unit';
      u.textContent = unit;
      right.appendChild(u);
    }
    r.append(left, right);
    return r;
  }

  function card(title, why, bodyNodes) {
    const s = document.createElement('section');
    s.className = 'card';
    const h = document.createElement('header');
    h.innerHTML = '<h2></h2><div class="why"></div>';
    h.querySelector('h2').textContent = title;
    h.querySelector('.why').textContent = why;
    const b = document.createElement('div');
    b.className = 'body';
    bodyNodes.forEach((n) => b.appendChild(n));
    s.append(h, b);
    return s;
  }

  /** The value a behaviour group currently holds, or null if its aliases disagree. */
  function groupValue(cfg, group) {
    const vals = group.keys.filter((k) => k in cfg.weights).map((k) => cfg.weights[k]);
    if (vals.length === 0) return null;
    return vals.every((v) => v === vals[0]) ? vals[0] : null;
  }

  function setGroup(group, v) {
    for (const k of group.keys) if (k in S.draft.weights) S.draft.weights[k] = v;
  }

  function renderWeights() {
    const nodes = [];
    for (const g of GROUPS) {
      const present = g.keys.filter((k) => k in S.draft.weights);
      if (present.length === 0) continue;
      const v = groupValue(S.draft, g);
      const wasV = groupValue(S.base, g);
      nodes.push(row({
        name: g.label,
        help: g.help,
        raw: present.join(', '),
        value: v === null ? '' : v,
        changed: v !== wasV,
        unit: 'points', key: `w:${g.id}`,
        onChange: (nv) => setGroup(g, nv === '' ? NaN : nv),
      }));
    }
    // Anything the engine knows about that this page has not grouped: shown raw
    // rather than hidden, so a new action type is never silently untunable.
    const grouped = new Set(GROUPS.flatMap((g) => g.keys));
    for (const k of Object.keys(S.draft.weights)) {
      if (grouped.has(k)) continue;
      nodes.push(row({
        name: k, help: 'A custom action. Its weight works exactly like the ones above.',
        value: S.draft.weights[k], changed: S.draft.weights[k] !== S.base.weights[k],
        unit: 'points', key: `w:${k}`,
        onChange: (nv) => { S.draft.weights[k] = nv; },
      }));
    }
    return card(
      'What each shopper action counts for',
      'Every action a shopper takes adds points to the interests it touches. These are the points. ' +
      'They are relative to each other, so what matters is the ratio, not the absolute size.',
      nodes,
    );
  }

  function renderMemory() {
    const tau = S.draft.tauMs;
    const nodes = [row({
      name: 'How long interest lasts',
      help: 'Points fade continuously while a shopper is inactive. Shorten this and the page follows the ' +
            'last few minutes closely. Lengthen it and the page remembers the whole visit.',
      derived: isFinite(tau) && tau > 0
        ? `Interest halves about every ${humanMs(halfLifeMs(tau))} of inactivity.`
        : 'Enter a positive number.',
      value: tau, changed: tau !== S.base.tauMs,
      unit: 'milliseconds (τ)', key: 'tauMs',
      onChange: (v) => { S.draft.tauMs = v; },
    })];

    const K = S.draft.K;
    const viewW = S.draft.weights.product_view;
    const n = actionsToHalfStrength(K, viewW);
    nodes.push(row({
      name: 'How much activity counts as strong interest',
      help: 'The point at which the engine treats an interest as half as strong as it can get. ' +
            'Lower it and shoppers commit sooner on less evidence; raise it and the engine waits for more.',
      derived: n
        ? `A shopper is halfway to full strength after about ${round(n, 1)} product views.`
        : 'Set a product-view weight above zero to see this in shopper terms.',
      value: K, changed: K !== S.base.K,
      unit: 'points (K)', key: 'K',
      onChange: (v) => { S.draft.K = v; },
    }));

    return card(
      'How long the engine remembers, and how much it takes to be sure',
      'These two decide the pace. Together they are the difference between a page that reacts to the ' +
      'last click and one that reacts to the whole visit.',
      nodes,
    );
  }

  function renderBand() {
    const inV = S.draft.thetaIn, outV = S.draft.thetaOut;
    const nodes = [
      row({
        name: 'A shopper joins an audience at',
        help: 'How strong an interest has to get before the shopper qualifies.',
        value: inV, changed: inV !== S.base.thetaIn, unit: 'strength (θ in)', key: 'thetaIn',
        onChange: (v) => { S.draft.thetaIn = v; },
      }),
      row({
        name: 'and leaves when it falls below',
        help: 'How far the interest has to fade before they drop out again. Always lower than the join point.',
        value: outV, changed: outV !== S.base.thetaOut, unit: 'strength (θ out)', key: 'thetaOut',
        onChange: (v) => { S.draft.thetaOut = v; },
      }),
    ];

    const band = document.createElement('div');
    band.className = 'band';
    const ok = isFinite(inV) && isFinite(outV) && outV < inV;
    const lo = Math.max(0, Math.min(1, Math.min(inV, outV)));
    const hi = Math.max(0, Math.min(1, Math.max(inV, outV)));
    band.innerHTML =
      `<div class="track">
         <div class="fill" style="left:${lo * 100}%;width:${(hi - lo) * 100}%"></div>
         <div class="mark out" style="left:${Math.max(0, Math.min(1, outV)) * 100}%"></div>
         <div class="mark" style="left:${Math.max(0, Math.min(1, inV)) * 100}%"></div>
         <div class="lab" style="left:${Math.max(0, Math.min(1, outV)) * 100}%">leaves ${round(outV)}</div>
         <div class="lab" style="left:${Math.max(0, Math.min(1, inV)) * 100}%">joins ${round(inV)}</div>
       </div>
       <div class="caption"></div>`;
    band.querySelector('.caption').textContent = ok
      ? 'The shaded gap is what stops a shopper flickering in and out of an audience on every click. ' +
        'Once in, they stay in until interest falls all the way back through the lower mark.'
      : 'The leave point must sit strictly below the join point. With no gap, a shopper enters and exits ' +
        'on alternate events, which looks to everyone like the engine is broken.';
    nodes.push(band);

    return card(
      'When a shopper joins an audience, and when they leave',
      'Membership is not a switch at one number. There are two, and the distance between them is deliberate.',
      nodes,
    );
  }

  function renderDimensions() {
    const t = document.createElement('table');
    t.innerHTML =
      `<thead><tr>
         <th>Interest</th><th>Read from</th>
         <th>Lasts (τ)</th><th>Halves after</th><th>Strong at (K)</th><th>Joins (θ in)</th><th>Leaves (θ out)</th>
       </tr></thead><tbody></tbody>`;
    const tb = t.querySelector('tbody');

    S.draft.dimensions.forEach((d, i) => {
      const baseD = S.base.dimensions[i] || {};
      const tr = document.createElement('tr');

      const c0 = document.createElement('td');
      c0.innerHTML = '<div class="dimname"></div><div class="dimsrc"></div>';
      c0.querySelector('.dimname').textContent = d.key;
      c0.querySelector('.dimsrc').textContent = d.multi ? 'several values at once' : 'one value';
      const c1 = document.createElement('td');
      c1.textContent = d.source;
      tr.append(c0, c1);

      for (const field of ['tauMs', 'K', 'thetaIn', 'thetaOut']) {
        if (field === 'K') {
          const hl = document.createElement('td');
          const tau = d.tauMs !== undefined ? d.tauMs : S.draft.tauMs;
          hl.innerHTML = `<span class="inherit">${humanMs(halfLifeMs(tau))}</span>`;
          tr.appendChild(hl);
        }
        const td = document.createElement('td');
        const has = d[field] !== undefined;
        const input = numInput(has ? d[field] : '', (v) => {
          if (v === '' || (typeof v === 'number' && Number.isNaN(v))) delete S.draft.dimensions[i][field];
          else S.draft.dimensions[i][field] = v;
        }, { key: `dim:${d.key}:${field}` });
        input.placeholder = 'inherit';
        if (has !== (baseD[field] !== undefined) || (has && d[field] !== baseD[field])) input.classList.add('changed');
        td.appendChild(input);
        tr.appendChild(td);
      }
      tb.appendChild(tr);
    });

    return card(
      'The interests the engine scores on',
      'The dimension registry: the agreed list of what the engine is allowed to notice. Each one can keep ' +
      'the settings above or override them. Blank means it inherits. Price posture, for example, moves ' +
      'more slowly than product interest, so it usually gets a longer memory of its own.',
      [t],
    );
  }

  function renderLimits() {
    return card(
      'Safety limits',
      'Guards on how much the engine will hold per shopper. Change these rarely, and never to fix a ' +
      'relevance problem: they exist to bound memory, not to shape decisions.',
      [
        row({
          name: 'Forget an interest weaker than',
          help: 'Interests that fade below this are dropped entirely rather than carried at almost zero.',
          value: S.draft.epsilon, changed: S.draft.epsilon !== S.base.epsilon,
          unit: 'strength (ε)', key: 'epsilon',
          onChange: (v) => { S.draft.epsilon = v; },
        }),
        row({
          name: 'Track at most, per interest',
          help: 'How many distinct values one interest can hold at once. The weakest is evicted past this.',
          value: S.draft.maxValuesPerDim, changed: S.draft.maxValuesPerDim !== S.base.maxValuesPerDim,
          unit: 'values', key: 'maxValuesPerDim',
          onChange: (v) => { S.draft.maxValuesPerDim = v; },
        }),
      ],
    );
  }

  // ── Diff → patch ───────────────────────────────────────────────────────────

  function buildPatch() {
    if (!S.base || !S.draft) return {};
    const p = {};
    for (const f of ['tauMs', 'K', 'thetaIn', 'thetaOut', 'epsilon', 'maxValuesPerDim']) {
      if (S.draft[f] !== S.base[f]) p[f] = S.draft[f];
    }
    const w = {};
    for (const k of Object.keys(S.draft.weights)) {
      if (S.draft.weights[k] !== S.base.weights[k]) w[k] = S.draft.weights[k];
    }
    if (Object.keys(w).length) p.weights = w;

    const dims = [];
    S.draft.dimensions.forEach((d, i) => {
      const b = S.base.dimensions[i] || {};
      const changed = {};
      for (const f of ['tauMs', 'K', 'thetaIn', 'thetaOut']) {
        if (d[f] !== b[f]) changed[f] = d[f];
      }
      if (Object.keys(changed).length) dims.push({ key: d.key, ...changed });
    });
    if (dims.length) p.dimensions = dims;
    return p;
  }

  /**
   * Changes counted the way the reader made them, not the way the patch encodes
   * them. Raising "added to the bag" writes two aliases and is one change; a
   * dimension with two overridden fields is two. The patch is the wire format,
   * this is the sentence in the save bar.
   */
  function changeCount() {
    if (!S.base || !S.draft) return 0;
    let n = 0;
    for (const f of ['tauMs', 'K', 'thetaIn', 'thetaOut', 'epsilon', 'maxValuesPerDim']) {
      if (S.draft[f] !== S.base[f]) n++;
    }
    for (const g of GROUPS) {
      if (!g.keys.some((k) => k in S.draft.weights)) continue;
      if (groupValue(S.draft, g) !== groupValue(S.base, g)) n++;
    }
    const grouped = new Set(GROUPS.flatMap((g) => g.keys));
    for (const k of Object.keys(S.draft.weights)) {
      if (!grouped.has(k) && S.draft.weights[k] !== S.base.weights[k]) n++;
    }
    S.draft.dimensions.forEach((d, i) => {
      const b = S.base.dimensions[i] || {};
      for (const f of ['tauMs', 'K', 'thetaIn', 'thetaOut']) if (d[f] !== b[f]) n++;
    });
    return n;
  }

  // ── Speaking the page's own language back ──────────────────────────────────
  // The validator is shared with the write path, so its messages name fields the
  // way the config does: thetaOut, tauMs, weights.add_to_cart. That is the right
  // vocabulary for an API response and the wrong one for the person reading this
  // page. Every message is rewritten into the same words the controls use, so an
  // error points at a control the reader can actually find.

  function humanizeError(msg) {
    let out = String(msg).replace(/^config:\s*/, '');
    out = out.replace(/\bdimensions\[(\d+)\]/g, (_, i) => {
      const d = S.draft && S.draft.dimensions[Number(i)];
      return d ? `the "${d.key}" interest` : 'one of the interests';
    });
    out = out.replace(/\bweights\.([A-Za-z0-9_]+)/g, (_, k) => {
      const g = GROUPS.find((x) => x.keys.includes(k));
      return g ? `the points for "${g.label.toLowerCase()}"` : `the points for "${k}"`;
    });
    out = out
      .replace(/\bthetaOut\b/g, 'the leave point')
      .replace(/\bthetaIn\b/g, 'the join point')
      .replace(/\btauMs\b/g, 'how long interest lasts')
      .replace(/\bmaxValuesPerDim\b/g, 'the per-interest value limit')
      .replace(/\bepsilon\b/g, 'the forget-below threshold')
      .replace(/\bK\b/g, 'the strong-interest point');
    return out.charAt(0).toUpperCase() + out.slice(1);
  }

  // ── Server-side validation, debounced ──────────────────────────────────────
  // The page never decides legality on its own. It asks the same validator the
  // write path runs, so what the form says and what the store will accept cannot
  // drift apart.

  let checkTimer = null;
  function scheduleCheck() {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(check, 350);
  }

  async function check() {
    const patch = buildPatch();
    if (!Object.keys(patch).length) { S.errors = []; render(); return; }
    try {
      const res = await fetch(api('/reflex/validate'), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ patch }),
      });
      const data = await res.json();
      S.errors = data.valid ? [] : (data.errors || ['This change was refused.']);
    } catch {
      S.errors = ['Could not reach the server to check this change.'];
    }
    render();
  }

  // ── Load / save ────────────────────────────────────────────────────────────

  const canEdit = () => Boolean(S.token);

  async function load() {
    const [cfgRes, histRes] = await Promise.all([
      fetch(api('/reflex')).then((r) => r.json()),
      fetch(api('/reflex/history')).then((r) => r.json()).catch(() => ({ revisions: [] })),
    ]);
    S.meta = cfgRes;
    S.base = cfgRes.config;
    S.draft = JSON.parse(JSON.stringify(cfgRes.config));
    S.history = histRes.revisions || [];
    S.errors = [];
    render();
  }

  async function save() {
    const patch = buildPatch();
    if (!Object.keys(patch).length) return;
    const res = await fetch(api('/reflex'), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${S.token}` },
      body: JSON.stringify({ patch, note: $('note').value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      S.errors = data.errors || [res.status === 401
        ? 'That token was not accepted. Changes need an operator token.'
        : 'The change was refused.'];
      render();
      return;
    }
    $('note').value = '';
    await load();
    flash(`Saved as revision ${data.revision}. Live now, on ${data.version}.`);
  }

  async function rollback(n) {
    const res = await fetch(api(`/reflex/rollback/${n}`), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${S.token}` },
      body: JSON.stringify({}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      S.errors = data.errors || ['The rollback was refused.'];
      render();
      return;
    }
    await load();
    flash(`Rolled back to revision ${n}, recorded as revision ${data.revision}.`);
  }

  let flashText = '';
  function flash(text) {
    flashText = text;
    render();
    setTimeout(() => { flashText = ''; render(); }, 6000);
  }

  // ── Paint ──────────────────────────────────────────────────────────────────

  function renderHistory() {
    const host = $('history');
    host.textContent = '';
    if (!S.history.length) {
      const p = document.createElement('div');
      p.className = 'rev';
      p.textContent = 'Nothing has been tuned yet. The engine is running on the settings it shipped with.';
      host.appendChild(p);
      return;
    }
    S.history.forEach((h, i) => {
      const d = document.createElement('div');
      d.className = 'rev';
      d.innerHTML = `<div class="top"><span class="n"></span><span class="v"></span></div>
                     <div class="meta"></div><div class="note"></div>`;
      d.querySelector('.n').textContent = `r${h.revision}`;
      d.querySelector('.v').textContent = h.version;
      d.querySelector('.meta').textContent =
        `${h.actor || 'unknown'} · ${h.at ? new Date(h.at).toLocaleString() : ''}`;
      d.querySelector('.note').textContent = h.note || '';
      if (i > 0) {
        const b = document.createElement('button');
        b.className = 'link';
        b.textContent = `Roll back to r${h.revision}`;
        b.disabled = !canEdit();
        b.title = canEdit() ? '' : 'Needs an operator token';
        b.addEventListener('click', () => rollback(h.revision));
        d.appendChild(b);
      }
      host.appendChild(d);
    });
  }

  function renderMessages() {
    const host = $('messages');
    host.textContent = '';
    if (flashText) {
      const ok = document.createElement('div');
      ok.className = 'msg ok';
      ok.textContent = flashText;
      host.appendChild(ok);
    }
    if (S.errors.length) {
      // Deduplicate AFTER humanizing. One behaviour group writes several aliases,
      // so a single bad number in one control comes back as one error per alias.
      // The reader moved one control; they should be told one thing.
      const shown = [...new Set(S.errors.map(humanizeError))];
      const e = document.createElement('div');
      e.className = 'msg err';
      const h = document.createElement('div');
      h.textContent = shown.length === 1
        ? 'This change cannot be saved:'
        : `This change cannot be saved. ${shown.length} problems:`;
      const ul = document.createElement('ul');
      shown.forEach((msg) => {
        const li = document.createElement('li');
        li.textContent = msg;
        ul.appendChild(li);
      });
      e.append(h, ul);
      host.appendChild(e);
    }
    if (!canEdit()) {
      const r = document.createElement('div');
      r.className = 'msg';
      r.innerHTML = '<span class="readonly-note">Read only.</span> ' +
        'You can look at every setting and check a change before committing to it. ' +
        'Paste an operator token in the top bar to save.';
      host.appendChild(r);
    }
  }

  function render() {
    if (!S.draft) return;

    $('stamp').textContent = S.base.version;
    const src = $('source');
    if (S.meta.source === 'stored') {
      src.className = 'badge stored';
      src.textContent = `stored · r${S.meta.revision}`;
    } else {
      src.className = 'badge compiled';
      src.textContent = 'shipped defaults';
    }

    const panels = $('panels');
    const active = document.activeElement;
    const focusId = active && active.dataset ? active.dataset.focusKey : null;
    const caret = focusId ? { start: active.selectionStart, end: active.selectionEnd } : null;
    panels.textContent = '';
    panels.append(renderWeights(), renderMemory(), renderBand(), renderDimensions(), renderLimits());

    renderMessages();
    renderHistory();

    const n = changeCount();
    $('changecount').textContent = n === 0 ? 'No changes'
      : n === 1 ? '1 change, not saved' : `${n} changes, not saved`;
    $('save').disabled = n === 0 || S.errors.length > 0 || !canEdit();
    $('reset').disabled = n === 0;
    if (focusId) {
      const again = panels.querySelector(`[data-focus-key="${focusId}"]`);
      if (again) {
        again.focus();
        if (caret && caret.start !== null) {
          try { again.setSelectionRange(caret.start, caret.end); } catch { /* not selectable */ }
        }
      }
    }
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────

  $('token').value = S.token;
  $('token').addEventListener('input', (e) => {
    S.token = e.target.value.trim();
    sessionStorage.setItem('tuning-token', S.token);
    render();
  });
  $('save').addEventListener('click', save);
  $('reset').addEventListener('click', () => {
    S.draft = JSON.parse(JSON.stringify(S.base));
    S.errors = [];
    $('note').value = '';
    render();
  });

  load().catch(() => {
    $('messages').innerHTML =
      '<div class="msg err">Could not load the current settings. The engine is still running on ' +
      'whatever is stored; this page just cannot see it.</div>';
  });
})();
