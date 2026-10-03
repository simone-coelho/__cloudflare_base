/* enablement/site/see-it-work.js
   The guided tour of the page See it work: one sample store, Morrow & Vale, and seven steps the reader walks with
   Back and Next. It is progressive enhancement. Without it the page reads in full as a storyboard: each step's text,
   a still frame drawn from the same arithmetic, and a caption. With it, the stills give way to one live storefront,
   a callout per step that says what to do and then what changed, the interest buckets, and a receipt panel.

   It stores nothing, sends nothing and loads nothing. It builds every element with createElement and fills it with
   textContent; it sets SVG attributes directly; the only styles it touches are CSS custom properties and the
   transforms of a glide, through the element's style object. Motion is CSS transitions and keyframes, which the
   stylesheet stills under prefers-reduced-motion.

   The arithmetic is the engine's, as the explainer facts sheet (FACTS.md, sections 1 to 3) and the engine facts
   sheet (docs/enablement/research/S2-engine-facts.md, sections 3.4, 3.6, 3.10, 3.11, 3.17) state it, at the
   engine's defaults:
     interest   a = R / (R + K), K = 1.8, where R is the raw score each touch adds its action's weight to
     fading     R falls as R * exp(-elapsed / tau); tau is the memory the brand publishes
     lines      a visitor enters at a >= 0.60 on an event and is released only below 0.45; time alone releases,
                never admits; the release time is t* = t_last + tau * ln(R (1 - 0.45) / (K * 0.45))
     region     lambda = kBlend / (kBlend + the sum of the visitor's own interests), kBlend = 1; each blended
                interest is (1 - lambda) * a + lambda * the region's share
     score      the slot's weight (1) times the sum of the blended interests of the piece's tags
     order      pins first, then the score, with ties in the brand's own order; the holdout's default arm scores
                nothing and keeps the pins
     weights    a look (a product view or a content click) adds 1; an add to the bag adds 3 (the engine's shipped
                table)
   One setting is the sample store's own: its memory is 5 minutes, so the tour can show a bucket drain while the
   reader watches. The engine's default memory is 14 days, and the page says so. The store, its products, its
   regional leans and its partner are invented for the page. The block between the model markers holds no
   reference to the page, so the still frames and the self-test are drawn from the same numbers. */
(function () {
  'use strict';

  /* model:start */
  const K = 1.8;
  const ENTRY = 0.6;
  const RELEASE = 0.45;
  const KBLEND = 1;
  const MEMORY = 5;
  const W_LOOK = 1;
  const W_ADD = 3;
  const SLOT_WEIGHT = 1;
  const EPS = 1e-9;
  // Minutes into the visit: the arrival, the add to the bag, the look, the minutes that pass, the last click.
  const AT = { arrive: 0, add: 0.5, look: 1, pass: 5, story: 6.5 };

  const VALUES = [
    { id: 'rain', name: 'Rain layers', word: 'rain layers' },
    { id: 'knit', name: 'Knitwear', word: 'knitwear' },
    { id: 'linen', name: 'Linen', word: 'linen' },
    { id: 'table', name: 'Tableware', word: 'tableware' },
  ];
  const VALUE = {};
  VALUES.forEach((v) => { VALUE[v.id] = v; });

  // What visitors in each region lean toward: shares within the dimension, the leader at one. Invented. Each
  // region's plan names the cards the tour asks the reader to use: the region's second lean is added to the bag,
  // the lean the region ignores is looked at, and a story about the first interest is clicked after the pin.
  const REGIONS = {
    wa: { id: 'wa', name: 'Washington State', share: { rain: 1, knit: 0.75, table: 0.5, linen: 0 },
      plan: { first: 'knit', add: 'cardigan', second: 'linen', look: 'shirt', story: 'woolcare' } },
    fl: { id: 'fl', name: 'Florida', share: { linen: 1, rain: 0.75, table: 0.5, knit: 0 },
      plan: { first: 'rain', add: 'shell', second: 'knit', look: 'cardigan', story: 'wet' } },
  };
  const REGION_IDS = ['wa', 'fl'];

  const HEROES = [
    { id: 'h-rain', title: 'The rain edit', sub: 'Layers for wet weekends', tags: ['rain'], tone: 'rain' },
    { id: 'h-knit', title: 'Knit season', sub: 'Soft wool for cool evenings', tags: ['knit'], tone: 'knit' },
    { id: 'h-linen', title: 'Linen days', sub: 'Light layers for warm afternoons', tags: ['linen'], tone: 'linen' },
    { id: 'h-table', title: 'Hosting at home', sub: 'Plates, bowls and everything between', tags: ['table'], tone: 'table' },
  ];
  const HERO = {};
  HEROES.forEach((h) => { HERO[h.id] = h; });

  // The page's sections in the brand's own order, the order the site shows when nothing points anywhere. The
  // carousel's products come from the brand's recommendations; the section itself carries no tag.
  const SECTIONS = [
    { id: 'rain', title: 'Rain-ready layers', tone: 'rain', tags: ['rain'], cards: [
      { id: 'jacket', name: 'Waxed field jacket', icon: 'jacket', tags: ['rain', 'knit'] },
      { id: 'shell', name: 'Packable rain shell', icon: 'shell', tags: ['rain'] },
      { id: 'wet', name: 'Dressing for wet weekends', icon: 'story', tags: ['rain'], story: true },
    ] },
    { id: 'recs', title: 'Recommended picks', tone: 'recs', tags: [], recs: true, cards: [
      { id: 'throw', name: 'Wool throw', icon: 'throw', tags: [] },
      { id: 'carafe', name: 'Glass carafe', icon: 'carafe', tags: [] },
      { id: 'tote', name: 'Linen market tote', icon: 'bag', tags: [] },
    ] },
    { id: 'knit', title: 'Soft knits', tone: 'knit', tags: ['knit'], cards: [
      { id: 'cardigan', name: 'Cable-knit cardigan', icon: 'sweater', tags: ['knit'] },
      { id: 'crew', name: 'Merino crew sweater', icon: 'sweater', tags: ['knit'] },
      { id: 'woolcare', name: 'How to care for wool', icon: 'story', tags: ['knit'], story: true },
    ] },
    { id: 'linen', title: 'The linen shop', tone: 'linen', tags: ['linen'], cards: [
      { id: 'shirt', name: 'Linen camp shirt', icon: 'shirt', tags: ['linen'] },
      { id: 'trousers', name: 'Wide-leg linen trousers', icon: 'trousers', tags: ['linen'] },
      { id: 'living', name: 'Living in linen', icon: 'story', tags: ['linen'], story: true },
    ] },
    { id: 'partner', title: 'Partner spotlight: Saltmarsh Ceramics', tone: 'table', tags: ['table'], partner: true, cards: [
      { id: 'plates', name: 'Stoneware dinner plates', icon: 'plate', tags: ['table'] },
      { id: 'bowl', name: 'Speckled serving bowl', icon: 'bowl', tags: ['table'] },
      { id: 'napkins', name: 'Linen napkin set', icon: 'napkin', tags: ['table', 'linen'] },
    ] },
  ];
  const SECTION = {};
  const CARD = {};
  SECTIONS.forEach((s) => { SECTION[s.id] = s; s.cards.forEach((c) => { CARD[c.id] = Object.assign({ section: s.id }, c); }); });
  const PIN = 'partner';

  function newProfile() { return { R: {}, t: {}, member: {}, released: {} }; }
  function rawAt(p, v, now) { const R = p.R[v] || 0; return R ? R * Math.exp(-(now - p.t[v]) / MEMORY) : 0; }
  function interestOf(R) { return R / (R + K); }
  // One touch: fade what is there to now, then add the action's weight.
  function touch(p, v, w, now) { p.R[v] = rawAt(p, v, now) + w; p.t[v] = now; }
  function ownInterests(p, now) { const a = {}; VALUES.forEach((v) => { a[v.id] = interestOf(rawAt(p, v.id, now)); }); return a; }
  // After an event: a visitor enters at the entry line and is released below the release line.
  function settleOnEvent(p, now) {
    const a = ownInterests(p, now);
    const out = [];
    VALUES.forEach((v) => {
      if (!p.member[v.id] && a[v.id] >= ENTRY) { p.member[v.id] = true; out.push({ v: v.id, kind: 'entered', t: now }); }
      else if (p.member[v.id] && a[v.id] < RELEASE) { p.member[v.id] = false; p.released[v.id] = true; out.push({ v: v.id, kind: 'released', t: now }); }
    });
    return out;
  }
  // The moment a member crosses its release line with no new touch, in closed form.
  function releaseTime(p, v) { return p.t[v] + MEMORY * Math.log((p.R[v] * (1 - RELEASE)) / (K * RELEASE)); }
  // As time passes: time alone can release a visitor, never admit one. Each release carries its exact moment.
  function settleOnTime(p, now) {
    const a = ownInterests(p, now);
    const out = [];
    VALUES.forEach((v) => {
      if (p.member[v.id] && a[v.id] < RELEASE) { out.push({ v: v.id, kind: 'released', t: releaseTime(p, v.id) }); p.member[v.id] = false; p.released[v.id] = true; }
    });
    return out.sort((x, y) => x.t - y.t);
  }
  function blend(a, share) {
    let sum = 0;
    VALUES.forEach((v) => { sum += a[v.id]; });
    const lambda = KBLEND / (KBLEND + sum);
    const b = {};
    VALUES.forEach((v) => { b[v.id] = (1 - lambda) * a[v.id] + lambda * (share[v.id] || 0); });
    return { lambda, b, sum };
  }
  function scoreOf(tags, b) { let s = 0; tags.forEach((t) => { s += SLOT_WEIGHT * b[t]; }); return s; }
  function rank(items, b) {
    return items.map((it, i) => ({ it, i, s: b ? scoreOf(it.tags, b) : 0 }))
      .sort((x, y) => (y.s - x.s > EPS ? 1 : x.s - y.s > EPS ? -1 : x.i - y.i))
      .map((r) => r.it);
  }
  // One decision for the whole page: the hero slot, and the layout slot's sections. The holdout's default arm
  // sees no interest, so it serves the brand's own order with the pins kept.
  function decide(p, regionId, now, opts) {
    const o = opts || {};
    const a = ownInterests(p, now);
    const share = REGIONS[regionId].share;
    const bl = o.holdout ? { lambda: null, b: null, sum: 0 } : blend(a, share);
    const interestOrder = rank(SECTIONS, bl.b).map((s) => s.id);
    const order = o.pin ? [PIN].concat(interestOrder.filter((id) => id !== PIN)) : interestOrder.slice();
    const heroOrder = rank(HEROES, bl.b).map((h) => h.id);
    const scores = {};
    SECTIONS.forEach((s) => { scores[s.id] = bl.b ? scoreOf(s.tags, bl.b) : 0; });
    const heroScores = {};
    HEROES.forEach((h) => { heroScores[h.id] = bl.b ? scoreOf(h.tags, bl.b) : 0; });
    return { now, a, b: bl.b, lambda: bl.lambda, sum: bl.sum, share, order, interestOrder, hero: heroOrder[0], scores, heroScores, pinned: o.pin ? PIN : null, holdout: !!o.holdout };
  }

  // The tour. Each step's own actions, in order: the region (step 1), the add to the bag (2), the look (3), the
  // minutes that pass (4), the pin and the story click (5), none (6), and the holdout view (7), which changes
  // nothing the engine holds and is a way of looking only.
  const STEP_COUNT = 7;
  const ACTIONS = [0, 1, 1, 1, 1, 2, 0, 0];
  function replay(regionId, step, progress) {
    const r = REGIONS[regionId];
    const plan = r.plan;
    const p = newProfile();
    const log = [];
    const pages = [];
    let now = AT.arrive;
    let pin = false;
    const page = () => { const d = decide(p, regionId, now, { pin }); pages.push(d); return d; };
    page();
    log.push({ t: now, kind: 'region', region: regionId });
    const done = (s, k) => step > s || (step === s && progress >= k);
    if (done(2, 1)) {
      now = AT.add;
      touch(p, plan.first, W_ADD, now);
      log.push({ t: now, kind: 'add', card: plan.add, v: plan.first, w: W_ADD });
      settleOnEvent(p, now).forEach((c) => log.push(c));
      log.push({ t: now, kind: 'fading' });
      page();
    }
    if (done(3, 1)) {
      now = AT.look;
      touch(p, plan.second, W_LOOK, now);
      log.push({ t: now, kind: 'look', card: plan.look, v: plan.second, w: W_LOOK });
      settleOnEvent(p, now).forEach((c) => log.push(c));
      page();
    }
    if (done(4, 1)) {
      const from = now;
      now = from + AT.pass;
      settleOnTime(p, now).forEach((c) => log.push(c));
      log.push({ t: now, kind: 'time', from });
      page();
    }
    if (done(5, 1)) {
      pin = true;
      log.push({ t: now, kind: 'pin', section: PIN });
      page();
    }
    if (done(5, 2)) {
      now = AT.story;
      touch(p, plan.first, W_LOOK, now);
      log.push({ t: now, kind: 'look', card: plan.story, v: plan.first, w: W_LOOK });
      settleOnEvent(p, now).forEach((c) => log.push(c));
      page();
    }
    const d = pages[pages.length - 1];
    const prev = pages.length > 1 ? pages[pages.length - 2] : null;
    return { regionId, step, progress, p, now, pin, log, pages, d, prev };
  }
  // The receipt's arithmetic, rounded as it is printed, so a person can recompute every line from what is shown.
  const r3 = (x) => Math.round(x * 1000) / 1000;
  function receiptOf(state) {
    const d = state.d;
    const share = d.share;
    const lam = r3(d.lambda);
    const rest = r3(1 - d.lambda);
    const levels = {};
    VALUES.forEach((v) => { levels[v.id] = r3(d.a[v.id]); });
    const places = d.order.map((id, i) => {
      const s = SECTION[id];
      if (d.pinned === id) return { place: i + 1, id, pinned: true, interestPlace: d.interestOrder.indexOf(id) + 1 };
      if (!s.tags.length) return { place: i + 1, id, untagged: true, score: 0 };
      const t = s.tags[0];
      return { place: i + 1, id, value: t, rest, level: levels[t], lam, lean: share[t] || 0, score: r3(d.scores[id]) };
    });
    const first = REGIONS[state.regionId].plan.first;
    const R = rawAt(state.p, first, state.now);
    return { lam, rest, levels, places, hero: d.hero, heroScore: r3(d.heroScores[d.hero]), sumShown: r3(VALUES.reduce((x, v) => x + levels[v.id], 0)), worked: { v: first, R: r3(R), RK: r3(R + K), level: levels[first] } };
  }
  const MODEL = { K, ENTRY, RELEASE, KBLEND, MEMORY, W_LOOK, W_ADD, SLOT_WEIGHT, AT, VALUES, VALUE, REGIONS, REGION_IDS, HEROES, HERO, SECTIONS, SECTION, CARD, PIN, STEP_COUNT, ACTIONS,
    newProfile, rawAt, interestOf, touch, ownInterests, settleOnEvent, settleOnTime, releaseTime, blend, scoreOf, rank, decide, replay, receiptOf, r3 };
  /* model:end */

  if (typeof document === 'undefined') return;
  const doc = document;
  const tourEl = doc.getElementById('tour');
  const liveEl = doc.getElementById('tour-live');
  if (!tourEl || !liveEl) return;
  const stepEls = Array.prototype.slice.call(tourEl.querySelectorAll('section.tour-step[data-step]'));
  if (stepEls.length !== STEP_COUNT) return;
  const motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduced = () => !!(motionQuery && motionQuery.matches);
  const SVGNS = 'http://www.w3.org/2000/svg';
  const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth'];
  // A span of minutes is written as a word, so no timing figure appears beside the one performance sentence.
  const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

  // ---------- small helpers ----------
  function el(tag, cls, text) {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function svgEl(tag, attrs) {
    const e = doc.createElementNS(SVGNS, tag);
    if (attrs) Object.keys(attrs).forEach((k) => e.setAttribute(k, String(attrs[k])));
    return e;
  }
  function added(node, why) { node.setAttribute('data-added', why); return node; }
  function button(cls, text, onClick) {
    const b = el('button', cls, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }
  function clock(t) {
    const whole = Math.floor(t + 1e-9);
    const sec = Math.floor((t - whole) * 60 + 1e-6);
    return `${whole}:${String(sec).padStart(2, '0')}`;
  }
  const num = (x) => (Math.abs(x) < 5e-4 ? '0' : x.toFixed(3).replace(/0+$/, '').replace(/\.$/, ''));
  const fixed3 = (x) => x.toFixed(3);
  function listWords(words, joiner) {
    if (words.length <= 1) return words.join('');
    if (joiner === 'then') return words.join(', then ');
    return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
  }
  const sectionName = (id, start) => {
    const s = SECTION[id];
    if (s.partner) return start ? 'The partner spotlight' : 'the partner spotlight';
    if (s.recs) return start ? 'The recommendations carousel' : 'the recommendations carousel';
    return !start && /^The /.test(s.title) ? `the ${s.title.slice(4)}` : s.title;
  };
  // Bring a parent's children to the wanted list without moving a child that stays: a control keeps its focus when
  // others appear or go beside it.
  function syncChildren(parent, wanted) {
    Array.prototype.slice.call(parent.children).forEach((n) => { if (wanted.indexOf(n) < 0) parent.removeChild(n); });
    wanted.forEach((n, i) => { const at = parent.children[i]; if (at !== n) parent.insertBefore(n, at || null); });
  }
  function restartAnimation(node, cls) {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
  }

  // ---------- icons: simple line drawings, decorative ----------
  const ICONS = {
    jacket: 'M9 3.5 12 5l3-1.5 4.5 3.5-2 3.5-1.5-.8V20H8V9.7l-1.5.8-2-3.5L9 3.5Z M12 5v15 M9.5 13h1.5 M13 13h1.5',
    shell: 'M9.5 3.5h5l1.5 2.5 3.5 2.5-2 3.5-1.5-.8V20H8v-8.8l-1.5.8-2-3.5L8 6l1.5-2.5Z M12 6v14',
    sweater: 'M8.5 4 12 5.5 15.5 4l4.5 4-2 3-2-1.2V20h-8V9.8L6 11 4 8l4.5-4Z M8 17.5h8',
    shirt: 'M9 3.5 12 6l3-2.5 4.5 3-1.8 3.6-1.7-.9V20H8V9.2l-1.7.9-1.8-3.6L9 3.5Z M12 6v14',
    trousers: 'M7 3.5h10l1 17h-4l-2-10-2 10H6l1-17Z M7 6.5h10',
    story: 'M3.5 6c3-1.2 5.8-1 8.5 1 2.7-2 5.5-2.2 8.5-1v12.5c-3-1.2-5.8-1-8.5 1-2.7-2-5.5-2.2-8.5-1V6Z M12 7v12.5',
    throw: 'M4 7h16v8H4Z M4 11h16 M6 15v3 M9 15v3 M12 15v3 M15 15v3 M18 15v3',
    carafe: 'M10 3.5h4V7l3 4.5V19a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 19v-7.5L10 7V3.5Z M7.5 13h9',
    bag: 'M5 8.5h14l-1.2 12H6.2L5 8.5Z M9 8.5V7a3 3 0 0 1 6 0v1.5',
    plate: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 1 0 0-17Z M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 1 0 0-9Z',
    bowl: 'M3.5 10.5h17a8.5 7 0 0 1-17 0Z M9 20h6',
    napkin: 'M5 5h14v14H5Z M5 5l14 14 M12 5v3',
    pin: 'M9 3.5h6l-1 5 3 3H7l3-3-1-5Z M12 11.5V20.5',
    clock: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 1 0 0-17Z M12 7.5V12l3 2',
    up: 'M12 19V5 M6.5 10.5 12 5l5.5 5.5',
    down: 'M12 5v14 M6.5 13.5 12 19l5.5-5.5',
  };
  function icon(name, cls) {
    const s = svgEl('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false', class: cls || 'tour-icon' });
    s.appendChild(svgEl('path', { d: ICONS[name] }));
    return s;
  }

  // ---------- words ----------
  const regionOf = () => (state.regionId ? REGIONS[state.regionId] : null);
  function leanWords(r) {
    const leaning = VALUES.filter((v) => (r.share[v.id] || 0) > 0).sort((x, y) => r.share[y.id] - r.share[x.id]).slice(0, 2).map((v) => v.word);
    return listWords(leaning, 'then');
  }
  function cardPhrase(id, cap) {
    const c = CARD[id];
    if (c.story) return `${cap ? 'The' : 'the'} story ${c.name}`;
    return `${cap ? 'The' : 'the'} ${c.name.toLowerCase()}`;
  }
  // What moved between two pages: two neighbors that traded places, or a section that moved up past others.
  function movesOf(before, after) {
    const out = { up: [], down: [], swap: null, lines: [] };
    if (!before) return out;
    after.forEach((id, i) => {
      const j = before.indexOf(id);
      if (j > i) out.up.push(id);
      else if (j < i) out.down.push(id);
    });
    if (out.up.length === 1 && out.down.length === 1) {
      const u = out.up[0];
      const w = out.down[0];
      if (Math.abs(after.indexOf(u) - after.indexOf(w)) === 1 && Math.abs(before.indexOf(u) - before.indexOf(w)) === 1) out.swap = [u, w];
    }
    return out;
  }
  function moveSentence(m) {
    if (m.swap) return `${sectionName(m.swap[0], true)} moved up, ahead of ${sectionName(m.swap[1])}: the two traded places.`;
    if (m.up.length) return `${listWords(m.up.map((id, i) => sectionName(id, i === 0)))} moved up.`;
    return '';
  }

  // ---------- the state, and the history the tour can rebuild ----------
  const state = { regionId: null, step: 1, progress: 0, holdoutView: false, busy: 0, timers: [] };
  function current() { return state.regionId ? replay(state.regionId, state.step, state.progress) : null; }

  // ---------- components ----------
  function Stepper() {
    const root = el('div', 'tour-stepper');
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Tour steps');
    const back = button('tour-btn', 'Back', () => go(state.step - 1, false));
    const count = added(el('p', 'tour-count'), 'the step counter, drawn by the script');
    const dots = el('ol', 'tour-dots');
    dots.setAttribute('aria-hidden', 'true');
    const dotEls = [];
    for (let i = 1; i <= STEP_COUNT; i++) { const li = el('li', 'tour-dot'); dots.appendChild(li); dotEls.push(li); }
    const next = button('tour-btn tour-btn--next', 'Next', () => (state.step === STEP_COUNT ? restart() : go(state.step + 1, false)));
    root.appendChild(back);
    root.appendChild(count);
    root.appendChild(dots);
    root.appendChild(next);
    return {
      root,
      next,
      update() {
        count.textContent = `Step ${state.step} of ${STEP_COUNT}`;
        back.setAttribute('aria-disabled', state.step === 1 ? 'true' : 'false');
        const waiting = state.step === 1 && !state.regionId;
        next.setAttribute('aria-disabled', waiting ? 'true' : 'false');
        next.textContent = state.step === STEP_COUNT ? 'Start over' : 'Next';
        next.setAttribute('aria-label', state.step === STEP_COUNT ? 'Start the tour over' : 'Next step');
        back.setAttribute('aria-label', 'Previous step');
        dotEls.forEach((d, i) => { d.classList.toggle('is-done', i + 1 < state.step); d.classList.toggle('is-current', i + 1 === state.step); });
      },
    };
  }

  function Callout() {
    const root = el('div', 'tour-callout');
    const said = el('div', 'tour-callout-said');
    said.setAttribute('aria-live', 'polite');
    said.setAttribute('aria-atomic', 'true');
    const top = el('p', 'tour-callout-top');
    const pill = added(el('span', 'tour-pill'), 'the step counter, drawn by the script');
    const title = added(el('span', 'tour-callout-title'), "the step's title, repeated in the callout by the script");
    top.appendChild(pill);
    top.appendChild(title);
    const text = added(el('p', 'tour-callout-text'), 'what to do, then what changed, written by the script for the region picked');
    text.setAttribute('data-reader', 'the reader');
    const note = added(el('p', 'tour-callout-note'), "a note on the step's instrument, written by the script");
    said.appendChild(top);
    said.appendChild(text);
    said.appendChild(note);
    root.appendChild(said);
    const actions = el('div', 'tour-callout-actions');
    root.appendChild(actions);
    return {
      root,
      actions,
      set(o) {
        pill.textContent = `Step ${state.step} of ${STEP_COUNT}`;
        title.textContent = o.title;
        text.textContent = o.text;
        note.textContent = o.note || '';
        note.hidden = !o.note;
        root.classList.toggle('is-done', !!o.done);
      },
    };
  }

  function RegionPicker(onPick) {
    const wrap = el('div', 'tour-regions');
    wrap.setAttribute('role', 'group');
    const name = el('span', 'tour-regions-name', 'Pick where this visitor is');
    name.id = 'tour-regions-name';
    name.setAttribute('data-reader', 'the reader');
    added(name, 'the region control, drawn by the script');
    wrap.setAttribute('aria-labelledby', name.id);
    wrap.appendChild(name);
    const buttons = REGION_IDS.map((id, i) => {
      const b = button('tour-btn tour-btn--region', REGIONS[id].name, () => onPick(id));
      b.dataset.region = id;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('keydown', (e) => {
        let to = -1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = (i + 1) % REGION_IDS.length;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = (i + REGION_IDS.length - 1) % REGION_IDS.length;
        if (to >= 0) { e.preventDefault(); buttons[to].focus(); }
      });
      wrap.appendChild(b);
      return b;
    });
    return {
      root: wrap,
      update() { buttons.forEach((b) => b.setAttribute('aria-pressed', b.dataset.region === state.regionId ? 'true' : 'false')); },
    };
  }

  function Storefront(onCard) {
    const root = el('div', 'tour-store');
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Morrow & Vale, the sample store: its home page');
    const head = el('div', 'tour-store-head');
    head.setAttribute('aria-hidden', 'true');
    head.appendChild(el('span', 'tour-store-mark', 'Morrow & Vale'));
    const nav = el('span', 'tour-store-nav');
    ['New in', 'Clothing', 'Home', 'Journal'].forEach((t) => nav.appendChild(el('span', null, t)));
    head.appendChild(nav);
    head.appendChild(icon('bag', 'tour-icon tour-store-bag'));
    root.appendChild(head);
    const status = added(el('p', 'tour-store-status'), 'what the storefront shows, written by the script');
    root.appendChild(status);
    const hero = el('div', 'tour-hero');
    const heroTitle = el('span', 'tour-hero-title');
    const heroSub = el('span', 'tour-hero-sub');
    hero.appendChild(heroTitle);
    hero.appendChild(heroSub);
    root.appendChild(hero);
    const list = el('ol', 'tour-sections');
    list.setAttribute('aria-label', 'The sections of the page, in order');
    root.appendChild(list);
    const secEls = {};
    SECTIONS.forEach((s) => {
      const li = el('li', `tour-section tone-${s.tone}`);
      li.dataset.id = s.id;
      const sh = el('div', 'tour-section-head');
      sh.appendChild(el('span', 'tour-section-title', s.title));
      if (s.recs) sh.appendChild(el('span', 'tour-section-note', "Products from the brand's recommendations"));
      const mark = el('span', 'mark');
      mark.hidden = true;
      sh.appendChild(mark);
      li.appendChild(sh);
      const ul = el('ul', 'tour-products');
      li.appendChild(ul);
      list.appendChild(li);
      secEls[s.id] = { li, mark, ul };
    });
    let heroId = null;
    function drawCards(s, target) {
      const ul = secEls[s.id].ul;
      const items = s.cards.map((c) => {
        const item = el('li', 'tour-product-item');
        const isTarget = target && target.card === c.id;
        const node = el(isTarget ? 'button' : 'div', `tour-product${isTarget ? ' is-target' : ''}`);
        if (isTarget) {
          node.type = 'button';
          node.setAttribute('aria-label', target.aria);
          node.addEventListener('click', () => onCard(c.id));
        }
        node.appendChild(icon(c.icon));
        const txt = el('span', 'tour-product-text');
        if (c.story) txt.appendChild(el('span', 'tour-product-kind', 'Story'));
        txt.appendChild(el('span', 'tour-product-name', c.name));
        if (isTarget && target.verb) txt.appendChild(el('span', 'tour-product-do', target.verb));
        node.appendChild(txt);
        item.appendChild(node);
        return item;
      });
      ul.replaceChildren(...items);
    }
    // Move the sections to their new places and let each glide from where it was (CSS transitions do the motion).
    function glide(order) {
      const nodes = SECTIONS.map((s) => secEls[s.id].li);
      const before = new Map();
      nodes.forEach((n) => before.set(n, n.getBoundingClientRect()));
      order.forEach((id) => list.appendChild(secEls[id].li));
      if (reduced()) return;
      const moved = [];
      nodes.forEach((n) => {
        const a = before.get(n);
        const b = n.getBoundingClientRect();
        const dy = a.top - b.top;
        if (Math.abs(dy) > 0.5) { n.classList.remove('is-gliding'); n.style.transform = `translateY(${dy.toFixed(1)}px)`; moved.push(n); }
      });
      if (!moved.length) return;
      void list.offsetHeight;
      moved.forEach((n) => { n.classList.add('is-gliding'); n.style.transform = ''; });
    }
    return {
      root,
      secEls,
      update(view, animate) {
        status.textContent = view.status;
        const h = HERO[view.hero];
        if (heroId !== view.hero) {
          heroTitle.textContent = h.title;
          heroSub.textContent = h.sub;
          HEROES.forEach((x) => hero.classList.remove(`tone-${x.tone}`));
          hero.classList.add(`tone-${h.tone}`);
          if (animate && heroId !== null) restartAnimation(hero, 'is-fresh');
          heroId = view.hero;
        }
        SECTIONS.forEach((s) => drawCards(s, view.target && view.target.section === s.id ? view.target : null));
        SECTIONS.forEach((s) => {
          const m = view.marks[s.id];
          const e = secEls[s.id];
          e.mark.hidden = !m;
          e.mark.textContent = m ? m.text : '';
          e.mark.className = `mark${m ? ` mark--${m.kind}` : ''}`;
          e.li.classList.toggle('is-pinned', view.pinned === s.id);
          e.li.classList.toggle('is-changed', !!m && m.kind !== 'pin');
        });
        if (animate) glide(view.order);
        else view.order.forEach((id) => list.appendChild(secEls[id].li));
        root.classList.toggle('is-holdout', !!view.holdout);
      },
      focusTarget() { const t = root.querySelector('.tour-product.is-target'); if (t) t.focus({ preventScroll: false }); },
    };
  }

  const VESSEL = 'M5 4H59L53 96H11Z';
  const levelY = (a) => 96 - a * 92;
  function Buckets() {
    const root = el('div', 'tour-buckets');
    root.appendChild(el('p', 'tour-panel-title', 'Interest buckets'));
    const row = el('div', 'tour-bucket-row');
    root.appendChild(row);
    const cells = {};
    VALUES.forEach((v) => {
      const cell = el('div', `tour-bucket tone-${v.id}`);
      const svg = svgEl('svg', { viewBox: '0 0 64 100', class: 'tour-vessel', role: 'img' });
      const clipId = `tour-clip-${v.id}`;
      const defs = svgEl('defs');
      const clip = svgEl('clipPath', { id: clipId });
      clip.appendChild(svgEl('path', { d: VESSEL }));
      defs.appendChild(clip);
      svg.appendChild(defs);
      svg.appendChild(svgEl('path', { d: VESSEL, class: 'tour-vessel-back' }));
      const g = svgEl('g', { 'clip-path': `url(#${clipId})` });
      const liquid = svgEl('rect', { x: 0, y: 4, width: 64, height: 92, class: 'tour-liquid' });
      g.appendChild(liquid);
      svg.appendChild(g);
      svg.appendChild(svgEl('line', { x1: 1, x2: 63, y1: levelY(ENTRY), y2: levelY(ENTRY), class: 'tour-entry' }));
      svg.appendChild(svgEl('line', { x1: 1, x2: 63, y1: levelY(RELEASE), y2: levelY(RELEASE), class: 'tour-release' }));
      svg.appendChild(svgEl('path', { d: VESSEL, class: 'tour-vessel-rim' }));
      cell.appendChild(svg);
      cell.appendChild(el('p', 'tour-bucket-name', v.name));
      const level = added(el('p', 'tour-bucket-level'), "the bucket's level, computed by the script");
      cell.appendChild(level);
      const word = added(el('p', 'tour-bucket-word'), "the bucket's state, written by the script");
      cell.appendChild(word);
      row.appendChild(cell);
      cells[v.id] = { cell, svg, liquid, level, word };
    });
    const key = el('p', 'tour-key');
    key.appendChild(el('span', 'tour-key-entry', 'Entry line'));
    key.appendChild(el('span', 'tour-key-release', 'Release line'));
    root.appendChild(key);
    return {
      root,
      update(levels, p, opts) {
        const o = opts || {};
        VALUES.forEach((v) => {
          const c = cells[v.id];
          const a = levels[v.id];
          c.liquid.style.setProperty('--level', a.toFixed(4));
          c.cell.classList.toggle('is-slow', !!o.slow);
          const member = !!p.member[v.id];
          const released = !member && !!p.released[v.id];
          c.cell.classList.toggle('is-member', member);
          c.cell.classList.toggle('is-released', released);
          c.level.textContent = a < 5e-4 ? 'empty' : fixed3(a);
          c.word.textContent = member ? 'Interested' : released ? 'Released' : '';
          const where = a >= ENTRY ? 'past the entry line' : a >= RELEASE ? 'between the two lines' : a < 5e-4 ? 'empty' : 'below the release line';
          c.svg.setAttribute('aria-label', `${v.name} bucket: ${a < 5e-4 ? 'empty' : `${fixed3(a)}, ${where}`}${member ? ', interested' : released ? ', released' : ''}.`);
        });
      },
      flash(v, kind) { restartAnimation(cells[v].cell, kind === 'released' ? 'is-let-go' : 'is-filled'); },
    };
  }

  function Balance() {
    const root = el('div', 'tour-balance');
    root.appendChild(el('p', 'tour-panel-title', 'What the page leans on'));
    const bar = el('div', 'tour-balance-bar');
    bar.setAttribute('role', 'img');
    const regionPart = el('span', 'tour-balance-region');
    const ownPart = el('span', 'tour-balance-own');
    bar.appendChild(regionPart);
    bar.appendChild(ownPart);
    root.appendChild(bar);
    const words = el('div', 'tour-balance-words');
    const rw = added(el('span', 'tour-balance-key tour-balance-key--region'), "the region's share, computed by the script");
    const ow = added(el('span', 'tour-balance-key tour-balance-key--own'), "the visitor's share, computed by the script");
    words.appendChild(rw);
    words.appendChild(ow);
    root.appendChild(words);
    return {
      root,
      update(lambda, opts) {
        const l = lambda === null ? 1 : lambda;
        const pr = Math.round(l * 100);
        bar.style.setProperty('--lambda', l.toFixed(4));
        bar.classList.toggle('is-slow', !!(opts && opts.slow));
        rw.textContent = `The region ${pr}%`;
        ow.textContent = `This visitor ${100 - pr}%`;
        bar.setAttribute('aria-label', `The page leans ${pr} percent on the region and ${100 - pr} percent on this visitor's own buckets.`);
      },
    };
  }

  function Receipt() {
    const root = el('div', 'tour-receipt');
    const head = el('p', 'tour-receipt-head', 'Why this page');
    root.appendChild(head);
    const sub = added(el('p', 'tour-receipt-sub'), "the receipt's subject, written by the script");
    root.appendChild(sub);
    const list = el('ol', 'tour-receipt-lines');
    list.setAttribute('aria-label', 'Receipt lines, oldest first');
    root.appendChild(list);
    const extra = el('div', 'tour-receipt-extra');
    root.appendChild(extra);
    // What is new on the receipt, said once to a screen reader; the whole list stays readable in place.
    const fresh = added(el('p', 'visually-hidden'), 'the new receipt lines, repeated for a screen reader by the script');
    fresh.setAttribute('aria-live', 'polite');
    root.appendChild(fresh);
    function line(l) {
      const li = added(el('li', `tour-rline${l.fresh ? ' is-new' : ''}${l.kind ? ` tour-rline--${l.kind}` : ''}`), 'a receipt line, written by the script from the arithmetic');
      li.appendChild(el('span', 'tour-rtime', l.time || ''));
      const sign = el('span', `tour-rsign${l.sign === '+' ? ' is-plus' : l.sign === '−' ? ' is-minus' : ''}`);
      if (l.sign === 'pin') sign.appendChild(icon('pin', 'tour-icon tour-rpin'));
      else sign.textContent = l.sign || '';
      sign.setAttribute('aria-hidden', 'true');
      li.appendChild(sign);
      const t = el('span', 'tour-rtext', l.text);
      if (l.sign === '+' || l.sign === '−') t.prepend(el('span', 'visually-hidden', l.sign === '+' ? 'Plus: ' : 'Minus: '));
      li.appendChild(t);
      return li;
    }
    return {
      root,
      list,
      extra,
      set(title, subject, lines, mode) {
        head.textContent = title;
        sub.textContent = subject;
        list.replaceChildren(...lines.map(line));
        const news = lines.filter((l) => l.fresh).map((l) => l.text);
        fresh.textContent = news.length ? `New on the receipt: ${news.join(' ')}` : '';
        root.classList.toggle('is-whole', mode === 'whole');
        root.classList.toggle('is-learning', mode === 'learning');
      },
    };
  }

  // The learning dial, at zero, and the holdout's share (step 7).
  function Learning() {
    const root = el('div', 'tour-learning');
    const dialBox = el('div', 'tour-dial');
    const svg = svgEl('svg', { viewBox: '0 0 160 92', class: 'tour-dial-svg', role: 'img', 'aria-label': 'The learning dial, at zero: learning moves nothing.' });
    svg.appendChild(svgEl('path', { d: 'M14 84A66 66 0 0 1 146 84', class: 'tour-dial-track' }));
    for (let i = 0; i <= 10; i++) {
      const ang = Math.PI - (i / 10) * Math.PI;
      const x1 = 80 + Math.cos(ang) * 58; const y1 = 84 - Math.sin(ang) * 58;
      const x2 = 80 + Math.cos(ang) * (i % 5 === 0 ? 48 : 52); const y2 = 84 - Math.sin(ang) * (i % 5 === 0 ? 48 : 52);
      svg.appendChild(svgEl('line', { x1: x1.toFixed(1), y1: y1.toFixed(1), x2: x2.toFixed(1), y2: y2.toFixed(1), class: 'tour-dial-tick' }));
    }
    svg.appendChild(svgEl('line', { x1: 80, y1: 84, x2: 24, y2: 84, class: 'tour-dial-needle' }));
    svg.appendChild(svgEl('circle', { cx: 80, cy: 84, r: 5, class: 'tour-dial-hub' }));
    dialBox.appendChild(svg);
    const dialWords = el('div', 'tour-dial-words');
    dialWords.appendChild(el('p', 'tour-dial-value', 'Learning dial: 0'));
    dialWords.appendChild(el('p', 'tour-dial-note', 'The brand turns it, slot by slot.'));
    dialBox.appendChild(dialWords);
    root.appendChild(dialBox);
    const hold = el('div', 'tour-holdout');
    const dots = el('div', 'tour-holdout-dots');
    dots.setAttribute('role', 'img');
    dots.setAttribute('aria-label', 'Twenty visitors, one of them in the holdout.');
    for (let i = 0; i < 20; i++) dots.appendChild(el('span', `tour-holdout-dot${i === 13 ? ' is-held' : ''}`));
    hold.appendChild(dots);
    hold.appendChild(el('p', 'tour-holdout-note', 'Here one visitor in twenty keeps the site’s own page; the brand sets the share.'));
    root.appendChild(hold);
    return { root };
  }

  // ---------- the live tour ----------
  const stepper = Stepper();
  tourEl.insertBefore(stepper.root, tourEl.firstChild);
  const board = el('div', 'tour-board');
  const main = el('div', 'tour-main');
  const side = el('div', 'tour-side');
  board.appendChild(main);
  board.appendChild(side);
  const callout = Callout();
  const picker = RegionPicker(pickRegion);
  const store = Storefront(onCard);
  main.appendChild(callout.root);
  main.appendChild(store.root);
  const clockBox = el('p', 'tour-clock');
  clockBox.appendChild(icon('clock', 'tour-icon tour-clock-icon'));
  const clockText = added(el('span', 'tour-clock-text'), 'the time into the visit, kept by the script');
  clockBox.appendChild(clockText);
  const buckets = Buckets();
  const balance = Balance();
  const receipt = Receipt();
  const learning = Learning();
  side.appendChild(clockBox);
  side.appendChild(buckets.root);
  side.appendChild(balance.root);
  side.appendChild(receipt.root);
  receipt.extra.appendChild(learning.root);
  liveEl.appendChild(board);

  const passBtn = button('tour-btn tour-btn--act', 'A few minutes pass', () => act());
  const pinBtn = button('tour-btn tour-btn--act', 'Pin the partner spotlight', () => act());
  const holdBtn = button('tour-btn tour-btn--act', 'Show the holdout’s page', () => toggleHoldout());
  const nextBtn = button('tour-btn tour-btn--next tour-btn--inline', 'Next step', () => go(state.step + 1, true));
  [passBtn, pinBtn, holdBtn].forEach((b) => b.setAttribute('data-reader', 'the reader'));

  function clearTimers() { state.timers.forEach((t) => clearTimeout(t)); state.timers = []; state.busy = 0; }
  function later(fn, ms) { state.timers.push(setTimeout(fn, ms)); }

  // The words of each step, for the region picked: what to do before the action, what changed after it.
  function stepWords(s) {
    const r = regionOf();
    const title = stepEls[state.step - 1].querySelector('h2').textContent.trim();
    if (state.step === 1) {
      if (!r) return { title, text: 'Start with the visitor’s region. The engine reads it from each request; here it is picked on the page, never guessed.', note: 'Each region’s leans are invented for this sample store.' };
      const lifted = movesOf(SECTIONS.map((x) => x.id), s.d.order).up;
      return { title, text: `Visitors in ${r.name} lean toward ${leanWords(r)}, so ${sectionName(s.d.order[0])} leads, and against the brand’s own order ${listWords(lifted.map((id) => sectionName(id)))} moved up. The hero is ${HERO[s.d.hero].title}.`, note: 'Each region’s leans are invented for this sample store.', done: true };
    }
    const plan = r.plan;
    const first = VALUE[plan.first];
    const second = VALUE[plan.second];
    if (state.step === 2) {
      if (!state.progress) return { title, text: `Add ${cardPhrase(plan.add)} to the bag, and watch the two sections at the top.` };
      const m = movesOf(s.prev.order, s.d.order);
      return { title, text: `${moveSentence(m)} The add counts three times a look, so ${first.word} passed its entry line, and the hero is now ${HERO[s.d.hero].title}.`, done: true };
    }
    if (state.step === 3) {
      if (!state.progress) return { title, text: `Click ${cardPhrase(plan.look)}, a look at something different.` };
      const m = movesOf(s.prev.order, s.d.order);
      return { title, text: `${moveSentence(m)} One look fills ${second.word} partway; ${first.word} still leads, so the page leans on both.`, done: true };
    }
    if (state.step === 4) {
      if (!state.progress) return { title, text: 'Let a few minutes pass with no clicks, and watch the buckets drain.' };
      const rel = s.log.filter((x) => x.kind === 'released').pop();
      const m = movesOf(s.prev.order, s.d.order);
      const dropped = m.swap ? `${sectionName(m.swap[1], true)} dropped back behind ${sectionName(m.swap[0])}.` : '';
      return { title, text: `At ${clock(rel.t)}, ${first.word} drained below its release line, so the visitor was released from it. ${dropped} Nobody wrote a rule; time did it.`, done: true };
    }
    if (state.step === 5) {
      if (state.progress === 0) return { title, text: 'A merchandiser sold the partner spotlight the first place on the home page. Pin it there, as the merchandiser would.' };
      if (state.progress === 1) return { title, text: `The partner spotlight now holds the first place. Click ${cardPhrase(plan.story)}, and watch the sections below the pin.` };
      const m = movesOf(s.prev.order, s.d.order);
      return { title, text: `${moveSentence(m)} The pinned spotlight held the first place: ranking never ran for it.`, done: true };
    }
    if (state.step === 6) return { title, text: 'The receipt panel now shows the whole receipt for the home page shown here. Every number on it can be recomputed by hand.', done: true };
    if (!state.holdoutView) return { title, text: 'The learning dial is at zero: what this visit recorded changes nothing until the brand turns it. See the page a holdout visitor gets.', done: true };
    return { title, text: 'A holdout visitor gets the site’s own page: the brand’s own order, with the pin kept. Comparing the two groups shows the lift.', done: true };
  }

  // The receipt panel's lines, in words, from the replay's log.
  function logLines(s, freshFrom) {
    const r = REGIONS[s.regionId];
    const out = [];
    s.log.forEach((x, i) => {
      const fresh = i >= freshFrom;
      const time = clock(x.t);
      if (x.kind === 'region') out.push({ time, sign: '+', text: `Regional start: ${r.name}, picked on this page. Visitors there lean toward ${leanWords(r)}.`, fresh });
      else if (x.kind === 'add') out.push({ time, sign: '+', text: `Added to the bag: ${CARD[x.card].name}. An add counts three times a look.`, fresh });
      else if (x.kind === 'entered') out.push({ time, sign: '+', text: `${VALUE[x.v].name} passed its entry line: the visitor counts as interested.`, fresh });
      else if (x.kind === 'fading') out.push({ time, sign: '−', text: 'Regional start, stepping back as the visitor’s own buckets fill.', fresh });
      else if (x.kind === 'look') out.push({ time, sign: '+', text: `${CARD[x.card].story ? 'Clicked a story' : 'Looked at'}: ${CARD[x.card].name}.`, fresh });
      else if (x.kind === 'released') out.push({ time, sign: '−', text: `Released from ${VALUE[x.v].word}: the bucket drained below its release line.`, fresh, kind: 'release' });
      else if (x.kind === 'time') out.push({ time, sign: '', text: `${COUNT_WORDS[Math.round(x.t - x.from)] || 'Some'} minutes with no clicks; the page is decided again.`, fresh });
      else if (x.kind === 'pin') out.push({ time, sign: 'pin', text: 'Pinned by a merchandiser: the partner spotlight, first. Ranking never ran for it.', fresh, kind: 'pin' });
    });
    return out;
  }
  // The whole receipt, as a person would recompute it (step 6).
  function wholeLines(s) {
    const rc = receiptOf(s);
    const r = REGIONS[s.regionId];
    const lines = [];
    const own = VALUES.filter((v) => rc.levels[v.id] > 0).map((v) => `${v.word} ${num(rc.levels[v.id])}`);
    lines.push({ time: 'Rule', sign: '', text: 'Score = (1 − the region’s share) × the visitor’s level + the region’s share × the region’s lean.' });
    lines.push({ time: 'Buckets', sign: '', text: `Levels: ${listWords(own)}; every other bucket is empty. A level is evidence ÷ (evidence + 1.8): ${VALUE[rc.worked.v].word}, ${num(rc.worked.R)} ÷ ${num(rc.worked.RK)} = ${num(rc.worked.level)}.` });
    lines.push({ time: 'Region', sign: '', text: `${r.name}. The region’s share is 1 ÷ (1 + ${VALUES.filter((v) => rc.levels[v.id] > 0).map((v) => num(rc.levels[v.id])).join(' + ')}) = ${num(rc.lam)}.` });
    rc.places.forEach((pl) => {
      const name = SECTION[pl.id].title;
      if (pl.pinned) lines.push({ time: `Place ${pl.place}`, sign: 'pin', text: `${name}: pinned by a merchandiser, an instruction. Ranking never ran for it; interest alone would have placed it ${ORDINAL[pl.interestPlace - 1]}.`, kind: 'pin' });
      else if (pl.untagged) lines.push({ time: `Place ${pl.place}`, sign: '', text: `${name}: no tag, so 0. Its products come from the brand’s recommendations; the engine decides where it sits.` });
      else lines.push({ time: `Place ${pl.place}`, sign: '', text: `${name}: ${num(pl.rest)} × ${num(pl.level)} + ${num(pl.lam)} × ${num(pl.lean)} = ${num(pl.score)}.` });
    });
    lines.push({ time: 'Hero', sign: '', text: `${HERO[rc.hero].title}: ${num(rc.heroScore)}, the highest of the four heroes.` });
    lines.push({ time: 'Learning', sign: '', text: 'Recorded with the receipt. The learning dial is at 0, so it changed nothing.' });
    return lines;
  }
  function learningLines(s) {
    const out = [];
    s.log.forEach((x) => {
      if (x.kind === 'add') out.push({ time: clock(x.t), sign: '+', text: `An add to the bag, credited to ${SECTION[CARD[x.card].section].title}.` });
      else if (x.kind === 'look') out.push({ time: clock(x.t), sign: '+', text: `A click, credited to ${SECTION[CARD[x.card].section].title}.` });
    });
    out.push({ time: '', sign: '', text: 'Every page decided on this visit, each with its receipt.' });
    return out;
  }

  // The view of the storefront for the state: its order, hero, marks and the one card the reader may use.
  function viewOf(s, showMarks) {
    const r = REGIONS[s.regionId];
    const plan = r.plan;
    const d = state.holdoutView && state.step === 7 ? decide(s.p, s.regionId, s.now, { pin: s.pin, holdout: true }) : s.d;
    const marks = {};
    const lastPin = s.log.length && s.log[s.log.length - 1].kind === 'pin';
    const before = s.prev ? s.prev.order : state.step === 1 ? SECTIONS.map((x) => x.id) : null;
    if (showMarks && before && !d.holdout && !lastPin) {
      const m = movesOf(before, d.order);
      m.up.forEach((id) => { marks[id] = { kind: 'up', text: 'moved up' }; });
      m.down.forEach((id) => { marks[id] = { kind: 'down', text: 'moved down' }; });
    }
    if (d.pinned) marks[d.pinned] = { kind: 'pin', text: 'pinned' };
    let target = null;
    if (state.step === 2 && !state.progress) target = { card: plan.add, verb: 'Add to bag', aria: `${CARD[plan.add].name}: add to the bag` };
    if (state.step === 3 && !state.progress) target = { card: plan.look, verb: 'Look', aria: `${CARD[plan.look].name}: look at it` };
    if (state.step === 5 && state.progress === 1) target = { card: plan.story, verb: 'Read', aria: `${CARD[plan.story].name}: click the story` };
    if (target) target.section = CARD[target.card].section;
    let status;
    if (d.holdout) status = `What a holdout visitor in ${r.name} gets at ${clock(s.now)}: the site’s own page, with the pin kept.`;
    else if (s.now === 0) status = `The home page for a visitor in ${r.name}, the region picked above, before any click.`;
    else status = `The home page at ${clock(s.now)} into the visit.`;
    return { order: d.order, hero: d.hero, marks, target, pinned: d.pinned, holdout: d.holdout, status };
  }
  function blankView() {
    return { order: SECTIONS.map((x) => x.id), hero: HEROES[0].id, marks: {}, target: null, pinned: null, holdout: false, status: 'The brand’s own order. The engine has no region yet: pick one in the callout.' };
  }

  function sideFor(s) {
    if (!s) {
      const zero = {};
      VALUES.forEach((v) => { zero[v.id] = 0; });
      buckets.update(zero, newProfile());
      balance.update(1);
      clockText.textContent = 'Visit time 0:00';
      receipt.set('Why this page', 'No region picked yet.', [], 'log');
      return;
    }
    clockText.textContent = `Visit time ${clock(s.now)}`;
    buckets.update(s.d.a, s.p, {});
    balance.update(s.d.lambda === null ? 1 : s.d.lambda, {});
  }

  // Draw everything for the current state. freshFrom marks the receipt lines that are new since the last draw.
  function render(opts) {
    const o = opts || {};
    const s = current();
    stepper.update();
    stepEls.forEach((sec, i) => sec.classList.toggle('is-current', i + 1 === state.step));
    picker.update();
    const words = stepWords(s);
    callout.set(words);
    const acts = [];
    if (state.step === 1) acts.push(picker.root);
    if (state.step === 4 && !state.progress) acts.push(passBtn);
    if (state.step === 5 && state.progress === 0) acts.push(pinBtn);
    if (state.step === 7) { holdBtn.textContent = state.holdoutView ? 'Show this visitor’s page' : 'Show the holdout’s page'; holdBtn.setAttribute('aria-pressed', state.holdoutView ? 'true' : 'false'); acts.push(holdBtn); }
    if (words.done && state.step < STEP_COUNT) acts.push(nextBtn);
    syncChildren(callout.actions, acts);
    passBtn.setAttribute('aria-disabled', state.busy ? 'true' : 'false');
    if (!s) { store.update(blankView(), !!o.animate); sideFor(null); return; }
    store.update(viewOf(s, !!o.marks), !!o.animate);
    if (!o.keepSide) sideFor(s);
    if (state.step === 6) receipt.set('The receipt, whole', `The home page at ${clock(s.now)}, for a visitor in ${REGIONS[s.regionId].name}.`, wholeLines(s), 'whole');
    else if (state.step === 7) receipt.set('What learning recorded', `This visit, up to ${clock(s.now)}.`, learningLines(s), 'learning');
    else receipt.set('Why this page', `The home page at ${clock(s.now)}, for a visitor in ${REGIONS[s.regionId].name}.`, logLines(s, o.freshFrom === undefined ? s.log.length : o.freshFrom), 'log');
    liveEl.classList.toggle('is-learning', state.step === 7);
  }

  // Picking a region keeps focus on the region button just chosen, so a keyboard reader goes on from there.
  function pickRegion(id) {
    if (state.step !== 1) return;
    clearTimers();
    state.regionId = id;
    state.progress = 1;
    render({ animate: true, marks: true, freshFrom: 0 });
    const chosen = picker.root.querySelector(`[data-region="${id}"]`);
    if (chosen && doc.activeElement !== chosen && (!doc.activeElement || doc.activeElement === doc.body || picker.root.contains(doc.activeElement))) chosen.focus({ preventScroll: true });
  }

  // The step's action: the add, the look, the minutes, the pin, the story click.
  function act() {
    if (!state.regionId || state.busy) return;
    const before = current();
    const need = ACTIONS[state.step];
    if (state.progress >= need) return;
    if (state.step === 4) { passTime(before); return; }
    state.progress += 1;
    const s = current();
    render({ animate: true, marks: true, freshFrom: before.log.length });
    s.log.slice(before.log.length).forEach((x) => { if (x.kind === 'entered') buckets.flash(x.v, 'entered'); });
    if (state.progress >= need) focusNext();
    else store.focusTarget();
  }
  function onCard(cardId) {
    const r = regionOf();
    if (!r) return;
    const plan = r.plan;
    const want = state.step === 2 ? plan.add : state.step === 3 ? plan.look : state.step === 5 && state.progress === 1 ? plan.story : null;
    if (cardId !== want) return;
    act();
  }
  // Step 4: the clock runs on, the bucket drains past its release line, then the page is decided again.
  function passTime(before) {
    state.progress = 1;
    const s = current();
    const rel = s.log.filter((x) => x.kind === 'released');
    if (reduced() || !rel.length) {
      render({ animate: true, marks: true, freshFrom: before.log.length });
      rel.forEach((x) => buckets.flash(x.v, 'released'));
      focusNext();
      return;
    }
    // Hold the page as it was while the buckets drain, then let it be decided again.
    state.busy = 1;
    state.progress = 0;
    render({ keepSide: true });
    passBtn.setAttribute('aria-disabled', 'true');
    const t0 = before.now;
    const tRel = rel[0].t;
    const t1 = s.now;
    const p = before.p;
    const levelsAt = (t) => { const a = {}; VALUES.forEach((v) => { a[v.id] = interestOf(rawAt(p, v.id, t)); }); return a; };
    const lambdaAt = (t) => blend(levelsAt(t), REGIONS[state.regionId].share).lambda;
    const firstMs = 1400;
    const restMs = 900;
    buckets.update(levelsAt(tRel), p, { slow: true });
    balance.update(lambdaAt(tRel), { slow: true });
    const ticks = 14;
    for (let i = 1; i <= ticks; i++) later(() => { clockText.textContent = `Visit time ${clock(t0 + ((tRel - t0) * i) / ticks)}`; }, (firstMs * i) / ticks);
    later(() => {
      const pr = newProfile();
      Object.assign(pr.member, before.p.member, { [rel[0].v]: false });
      Object.assign(pr.released, before.p.released, { [rel[0].v]: true });
      buckets.update(levelsAt(tRel), pr, { slow: true });
      buckets.flash(rel[0].v, 'released');
      buckets.update(levelsAt(t1), pr, { slow: true });
      balance.update(lambdaAt(t1), { slow: true });
      const lines = logLines(s, before.log.length).filter((l) => l.kind === 'release');
      receipt.set('Why this page', `The home page at ${clock(t0)}, for a visitor in ${REGIONS[state.regionId].name}.`, logLines(before, before.log.length).concat(lines), 'log');
      const extraTicks = 8;
      for (let i = 1; i <= extraTicks; i++) later(() => { clockText.textContent = `Visit time ${clock(tRel + ((t1 - tRel) * i) / extraTicks)}`; }, (restMs * i) / extraTicks);
    }, firstMs);
    later(() => {
      state.busy = 0;
      state.timers = [];
      state.progress = 1;
      render({ animate: true, marks: true, freshFrom: before.log.length });
      focusNext();
    }, firstMs + restMs + 60);
  }
  function toggleHoldout() {
    state.holdoutView = !state.holdoutView;
    render({ animate: true });
  }
  function focusNext() {
    if (nextBtn.isConnected) nextBtn.focus({ preventScroll: true });
  }

  function go(step, fromCallout) {
    if (step < 1 || step > STEP_COUNT) return;
    if (step > 1 && !state.regionId) { restartAnimation(callout.root, 'is-nudged'); return; }
    clearTimers();
    state.step = step;
    state.progress = step === 1 ? (state.regionId ? 1 : 0) : 0;
    state.holdoutView = false;
    render({ animate: true });
    if (fromCallout) {
      const h = stepEls[step - 1].querySelector('h2');
      h.setAttribute('tabindex', '-1');
      h.focus({ preventScroll: true });
      stepper.root.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
    }
  }
  function restart() {
    clearTimers();
    state.regionId = null;
    state.step = 1;
    state.progress = 0;
    state.holdoutView = false;
    render({ animate: true });
    const first = picker.root.querySelector('button');
    if (first) first.focus({ preventScroll: true });
    stepper.root.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
  }

  // ---------- start ----------
  liveEl.hidden = false;
  tourEl.classList.add('is-live');
  render({});
  // For the page's own checks in a browser: the model and the state, read only.
  window.__seeItWork = Object.freeze({ model: MODEL, state: () => ({ regionId: state.regionId, step: state.step, progress: state.progress, holdoutView: state.holdoutView }), current });
})();
