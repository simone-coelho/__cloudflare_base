/* enablement/site/see-it-work.js
   The guided tour of the page See it work, as one player (LANE-BRIEF-V3 §8.2): one sample store, Morrow & Vale, and
   seven steps. The player is one frame: a bar that stays at the top of the window (Back, "Step n of 7", the dots
   and the step's controls), one explanation line with the step's fixed sentence, the store on the left, and on the
   right the interest buckets, what the page leans on and the receipt. Show me performs the step's action, and so
   does clicking what the store highlights; Next is never disabled, and pressed first it performs the action, holds
   so the result is seen, then goes on. It is progressive enhancement: without it the page reads as a seven-frame
   storyboard, each frame a still drawn from the same arithmetic.

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

  // The tour. Each step's own action: the region (step 1), the add to the bag (2), the look (3), the minutes that
  // pass (4) and the story click (5); steps 6 and 7 have none. A merchandiser's pin is in force from step 5 on: it
  // is the brand's setting, there when the step opens, and the story click then reorders the sections below it.
  const STEP_COUNT = 7;
  const ACTIONS = [0, 1, 1, 1, 1, 1, 0, 0];
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
    if (done(5, 0)) {
      pin = true;
      log.push({ t: now, kind: 'pin', section: PIN });
      page();
    }
    if (done(5, 1)) {
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
  const playerEl = doc.getElementById('tour-player');
  const liveEl = doc.getElementById('tour-live');
  const boardEl = doc.getElementById('tour');
  const introEl = doc.querySelector('.tour-intro');
  if (!playerEl || !liveEl || !boardEl) return;
  const stepEls = Array.prototype.slice.call(boardEl.querySelectorAll('section.tour-step[data-step]'));
  if (stepEls.length !== STEP_COUNT) return;
  const motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduced = () => !!(motionQuery && motionQuery.matches);
  const SVGNS = 'http://www.w3.org/2000/svg';
  const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth'];
  // A span of minutes is written as a word, so no timing figure appears beside the one performance sentence.
  const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
  // How the callouts name the things to click.
  const SHORT = { cardigan: 'cardigan', shell: 'rain shell', shirt: 'linen shirt', woolcare: 'wool-care story', wet: 'wet-weekends story' };
  const HOLD_MS = 1200;
  const GLIDE_MS = 700;

  // The step's words, from the storyboard on the page: its title, its explanation line and its fixed sentence.
  const STEP_TEXT = stepEls.map((sec) => {
    const t = (sel) => { const n = sec.querySelector(sel); return n ? n.textContent.replace(/\s+/g, ' ').trim() : ''; };
    return { title: t('h2'), explain: t('.tour-explain'), explainNode: sec.querySelector('.tour-explain'), fixed: t('.tour-fixed') };
  });

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
  // Play a class's animation from its start, then take the class off once the animation is over or cut short, so a
  // panel hidden and shown again later (the buckets after step 6, or after Start again) does not play it a second time.
  function restartAnimation(node, cls) {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
    const playing = () => (node.getAnimations ? node.getAnimations({ subtree: true }).some((a) => a.animationName && a.playState !== 'finished') : false);
    const over = () => {
      if (playing()) return;
      node.removeEventListener('animationend', over);
      node.removeEventListener('animationcancel', over);
      node.classList.remove(cls);
    };
    node.addEventListener('animationend', over);
    node.addEventListener('animationcancel', over);
    if (!playing()) over();
  }
  // Where an element sits in the document, by layout and not by any glide in progress.
  function docTop(node) { let y = 0; for (let n = node; n; n = n.offsetParent) y += n.offsetTop; return y; }

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
  };
  function icon(name, cls) {
    const s = svgEl('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false', class: cls || 'tour-icon' });
    s.appendChild(svgEl('path', { d: ICONS[name] }));
    return s;
  }

  // ---------- words ----------
  function leanWords(r) {
    const leaning = VALUES.filter((v) => (r.share[v.id] || 0) > 0).sort((x, y) => r.share[y.id] - r.share[x.id]).slice(0, 2).map((v) => v.word);
    return listWords(leaning, 'then');
  }
  // What moved between two pages: two neighbors that traded places, or sections that moved up past others.
  function movesOf(before, after) {
    const out = { up: [], down: [], swap: null };
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
    if (m.swap) return `${sectionName(m.swap[0], true)} moved up, ahead of ${sectionName(m.swap[1])}.`;
    if (m.up.length) return `${listWords(m.up.map((id, i) => sectionName(id, i === 0)))} moved up.`;
    return '';
  }

  // ---------- the state ----------
  const state = { regionId: null, step: 1, progress: 0, busy: false, holding: false, timers: [], doneUpTo: 0 };
  const current = () => (state.regionId ? replay(state.regionId, state.step, state.progress) : null);
  const stepDone = () => (state.step === 1 ? !!state.regionId : state.progress >= ACTIONS[state.step]);
  function clearTimers() { state.timers.forEach((t) => clearTimeout(t)); state.timers = []; state.busy = false; state.holding = false; }
  function later(fn, ms) { state.timers.push(setTimeout(fn, ms)); }

  // ---------- the player's parts ----------
  const frame = el('div', 'tour-frame');
  // The bar, which stays at the top of the window while the frame is on screen.
  const bar = el('div', 'tour-bar');
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'The tour’s controls');
  const backBtn = button('tour-btn tour-btn--back', 'Back', () => onBack());
  backBtn.setAttribute('aria-label', 'Back one step');
  const barTitle = el('p', 'tour-bar-title');
  const barCount = added(el('span', 'tour-bar-count'), 'the step counter, drawn by the script');
  const barName = added(el('span', 'tour-bar-name'), "the step's title, repeated in the bar by the script");
  barTitle.appendChild(barCount);
  barTitle.appendChild(barName);
  const dots = el('ol', 'tour-dots');
  dots.setAttribute('aria-hidden', 'true');
  const dotEls = [];
  for (let i = 1; i <= STEP_COUNT; i++) { const li = el('li', 'tour-dot'); dots.appendChild(li); dotEls.push(li); }
  const controls = el('div', 'tour-bar-controls');
  const pickName = added(el('span', 'tour-pick-name', 'Pick where this visitor is:'), 'the region control, drawn by the script');
  pickName.id = 'tour-pick-name';
  pickName.setAttribute('data-reader', 'the reader');
  // The two region buttons are a group named by the words before it; the words stay outside the group, so on a phone
  // they take their own line and Next can sit beside the buttons.
  const regionGroup = el('div', 'tour-regions');
  regionGroup.setAttribute('role', 'group');
  regionGroup.setAttribute('aria-labelledby', pickName.id);
  const regionBtns = REGION_IDS.map((id, i) => {
    const b = button('tour-btn tour-btn--region', REGIONS[id].name, () => pickRegion(id));
    b.dataset.region = id;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('keydown', (e) => {
      let to = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = (i + 1) % REGION_IDS.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = (i + REGION_IDS.length - 1) % REGION_IDS.length;
      if (to >= 0) { e.preventDefault(); regionBtns[to].focus(); }
    });
    regionGroup.appendChild(b);
    return b;
  });
  const showBtn = button('tour-btn tour-btn--act', 'Show me', () => onShow());
  showBtn.setAttribute('data-reader', 'the reader');
  const nextBtn = button('tour-btn tour-btn--next', 'Next', () => onNext());
  nextBtn.setAttribute('aria-label', 'Next step');
  const againBtn = button('tour-btn tour-btn--next', 'Start again', () => restart());
  bar.appendChild(backBtn);
  bar.appendChild(barTitle);
  bar.appendChild(dots);
  bar.appendChild(controls);
  frame.appendChild(bar);
  // What a screen reader hears: the step's title on a new step, the result after an action.
  const status = added(el('p', 'visually-hidden'), 'what the tour announces, written by the script');
  status.setAttribute('aria-live', 'polite');
  frame.appendChild(status);
  // The explanation line and the step's fixed sentence, copied from the storyboard below.
  const explain = el('div', 'tour-explain-box');
  const explainLine = added(el('p', 'tour-explain-line'), "the step's explanation, copied from its text by the script");
  const explainFixed = added(el('p', 'tour-explain-fixed'), "the step's fixed sentence, copied from its text by the script");
  explain.appendChild(explainLine);
  explain.appendChild(explainFixed);
  frame.appendChild(explain);
  const board = el('div', 'tour-board');
  frame.appendChild(board);

  function announce(text) {
    status.textContent = '';
    later(() => { status.textContent = text; }, 60);
  }

  // ---------- the store ----------
  function Storefront() {
    const root = el('div', 'tour-store');
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Morrow & Vale, a sample store: its home page');
    const head = el('div', 'tour-store-head');
    const mark = el('p', 'tour-store-mark');
    mark.appendChild(el('span', 'tour-store-name', 'Morrow & Vale'));
    mark.appendChild(el('span', 'tour-store-sample', ' · a sample store'));
    head.appendChild(mark);
    const timeSlot = el('div', 'tour-time-slot');
    head.appendChild(timeSlot);
    root.appendChild(head);
    const note = added(el('p', 'tour-store-note'), 'what the store shows before a region is picked, written by the script');
    root.appendChild(note);
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
      sh.appendChild(el('span', 'tour-section-title', s.partner ? 'Partner spotlight' : s.title));
      if (s.partner) sh.appendChild(el('span', 'tour-section-note', 'Saltmarsh Ceramics'));
      if (s.recs) sh.appendChild(el('span', 'tour-section-note', 'By the brand’s recommendations'));
      li.appendChild(sh);
      const markEl = el('span', 'mark');
      markEl.hidden = true;
      li.appendChild(markEl);
      const ul = el('ul', 'tour-products');
      li.appendChild(ul);
      list.appendChild(li);
      secEls[s.id] = { li, mark: markEl, ul };
    });
    const timeBtn = button('tour-time-target', 'Let five minutes pass', () => onShow());
    timeBtn.appendChild(icon('clock', 'tour-icon tour-time-icon'));
    let heroId = null;
    function callout(text, where) {
      const c = added(el('p', `tour-callout ${where}`), 'the call to act, written by the script for the region picked');
      c.setAttribute('data-reader', 'the reader');
      c.textContent = text;
      return c;
    }
    function drawCards(s, target, row) {
      const items = s.cards.map((c, k) => {
        const item = el('li', 'tour-product-item');
        const isTarget = !!target && target.card === c.id;
        const node = el(isTarget ? 'button' : 'div', `tour-product${isTarget ? ' is-target' : ''}`);
        if (isTarget) {
          node.type = 'button';
          node.setAttribute('aria-label', target.aria);
          node.addEventListener('click', () => onShow());
        }
        node.appendChild(icon(c.icon));
        node.appendChild(el('span', 'tour-product-name', c.name));
        item.appendChild(node);
        if (isTarget) {
          item.classList.add('has-callout');
          item.appendChild(callout(target.callout, `${row >= 3 ? 'is-above' : 'is-below'} ${k === 0 ? 'is-left' : k === 2 ? 'is-right' : 'is-mid'}`));
        }
        return item;
      });
      secEls[s.id].ul.replaceChildren(...items);
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
        note.textContent = view.note || '';
        note.hidden = !view.note;
        const h = HERO[view.hero];
        if (heroId !== view.hero) {
          heroTitle.textContent = h.title;
          heroSub.textContent = h.sub;
          HEROES.forEach((x) => hero.classList.remove(`tone-${x.tone}`));
          hero.classList.add(`tone-${h.tone}`);
          if (animate && heroId !== null) restartAnimation(hero, 'is-fresh');
          heroId = view.hero;
        }
        const cardTarget = view.target && view.target.card ? view.target : null;
        SECTIONS.forEach((s) => drawCards(s, cardTarget && cardTarget.section === s.id ? cardTarget : null, view.order.indexOf(s.id)));
        const timeTarget = view.target && view.target.time ? view.target : null;
        if (timeTarget) {
          timeBtn.setAttribute('aria-label', 'Let five minutes pass with no clicks');
          syncChildren(timeSlot, [timeBtn, callout(timeTarget.callout, 'is-below is-right')]);
          timeBtn.classList.remove('is-target');
          void timeBtn.offsetWidth;
          timeBtn.classList.add('is-target');
        } else timeSlot.replaceChildren();
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
      },
      targetNode() { return root.querySelector('.tour-product.is-target') || (timeBtn.isConnected ? timeBtn : null); },
    };
  }

  // ---------- the buckets, what the page leans on, the receipt, learning ----------
  const VESSEL = 'M5 4H59L53 96H11Z';
  const levelY = (a) => 96 - a * 92;
  function Buckets() {
    const root = el('div', 'tour-buckets');
    const title = el('p', 'tour-panel-title');
    const titleTime = added(el('span', 'tour-panel-time'), 'the time into the visit, kept by the script');
    title.appendChild(el('span', null, 'Interest buckets'));
    title.appendChild(titleTime);
    root.appendChild(title);
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
      const words = el('div', 'tour-bucket-words');
      words.appendChild(el('p', 'tour-bucket-name', v.name));
      const level = added(el('p', 'tour-bucket-level'), "the bucket's level, computed by the script");
      words.appendChild(level);
      const word = added(el('p', 'tour-bucket-word'), "the bucket's state, written by the script");
      words.appendChild(word);
      cell.appendChild(words);
      row.appendChild(cell);
      cells[v.id] = { cell, svg, liquid, level, word };
    });
    const key = el('p', 'tour-key');
    key.appendChild(el('span', 'tour-key-entry', 'Entry line'));
    key.appendChild(el('span', 'tour-key-release', 'Release line'));
    root.appendChild(key);
    return {
      root,
      setTime(t) { titleTime.textContent = ` · visit time ${clock(t)}`; },
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
          const where = a >= ENTRY ? 'past the entry line' : a >= RELEASE ? 'between the two lines' : 'below the release line';
          c.svg.setAttribute('aria-label', `${v.name} bucket: ${a < 5e-4 ? 'empty' : `${fixed3(a)}, ${where}`}${member ? ', interested' : released ? ', released' : ''}.`);
        });
      },
      flash(v, kind) { restartAnimation(cells[v].cell, kind === 'released' ? 'is-let-go' : 'is-filled'); },
      cell(v) { return cells[v].cell; },
    };
  }

  function Balance() {
    const root = el('div', 'tour-balance');
    root.appendChild(el('p', 'tour-panel-title', 'What the page leans on'));
    const barEl = el('div', 'tour-balance-bar');
    barEl.setAttribute('role', 'img');
    barEl.appendChild(el('span', 'tour-balance-region'));
    barEl.appendChild(el('span', 'tour-balance-own'));
    root.appendChild(barEl);
    const words = el('div', 'tour-balance-words');
    const rw = added(el('span', 'tour-balance-key tour-balance-key--region'), "the region's share, computed by the script");
    const ow = added(el('span', 'tour-balance-key tour-balance-key--own'), "the visitor's share, computed by the script");
    words.appendChild(rw);
    words.appendChild(ow);
    root.appendChild(words);
    return {
      root,
      update(lambda, regionName, opts) {
        const l = lambda === null ? 1 : lambda;
        const pr = Math.round(l * 100);
        barEl.style.setProperty('--lambda', l.toFixed(4));
        barEl.classList.toggle('is-slow', !!(opts && opts.slow));
        barEl.classList.toggle('is-waiting', !regionName);
        rw.textContent = regionName ? `${regionName} ${pr}%` : 'No region picked yet';
        ow.textContent = regionName ? `This visitor ${100 - pr}%` : '';
        barEl.setAttribute('aria-label', regionName ? `The page leans ${pr} percent on ${regionName} and ${100 - pr} percent on this visitor's own buckets.` : 'No region picked yet.');
      },
    };
  }

  // The lines of one event (an action and what it caused) stay in their order; the events go newest first.
  function newestEventFirst(lines) {
    const groups = [];
    lines.forEach((l) => { if (l.start || !groups.length) groups.push([l]); else groups[groups.length - 1].push(l); });
    return groups.reverse().reduce((out, g) => out.concat(g), []);
  }
  function Receipt() {
    const root = el('div', 'tour-receipt');
    const head = el('p', 'tour-receipt-head', 'Why this page');
    root.appendChild(head);
    const sub = added(el('p', 'tour-receipt-sub'), "the receipt's subject, written by the script");
    root.appendChild(sub);
    const list = el('ol', 'tour-receipt-lines');
    root.appendChild(list);
    const extra = el('div', 'tour-receipt-extra');
    root.appendChild(extra);
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
      set(title, subject, lines, mode, newestFirst) {
        head.textContent = title;
        sub.textContent = subject;
        list.setAttribute('aria-label', newestFirst ? 'Receipt lines, newest first' : 'Receipt lines, in order');
        list.replaceChildren(...(newestFirst ? newestEventFirst(lines) : lines).map(line));
        list.scrollTop = 0;
        root.classList.toggle('is-whole', mode === 'whole');
        root.classList.toggle('is-learning', mode === 'learning');
      },
      newest() { return list.firstElementChild; },
    };
  }

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
    const holdDots = el('div', 'tour-holdout-dots');
    holdDots.setAttribute('role', 'img');
    holdDots.setAttribute('aria-label', 'Twenty visitors, one of them in the holdout.');
    for (let i = 0; i < 20; i++) holdDots.appendChild(el('span', `tour-holdout-dot${i === 13 ? ' is-held' : ''}`));
    hold.appendChild(holdDots);
    hold.appendChild(el('p', 'tour-holdout-note', 'Here one visitor in twenty keeps the site’s own page, a share the brand sets:'));
    const holdList = el('ol', 'tour-holdout-page');
    holdList.setAttribute('aria-label', 'The holdout’s page, in order');
    hold.appendChild(holdList);
    root.appendChild(hold);
    return {
      root,
      update(order) {
        holdList.replaceChildren(...order.map((id) => {
          const s = SECTION[id];
          const li = added(el('li', `tour-holdout-row tone-${s.tone}`, s.partner ? 'Partner spotlight, pinned' : s.title), "a section of the holdout's page, drawn by the script");
          return li;
        }));
      },
    };
  }

  const store = Storefront();
  const side = el('div', 'tour-side');
  const buckets = Buckets();
  const balance = Balance();
  const receipt = Receipt();
  const learning = Learning();
  side.appendChild(buckets.root);
  side.appendChild(balance.root);
  side.appendChild(receipt.root);
  receipt.extra.appendChild(learning.root);
  board.appendChild(store.root);
  board.appendChild(side);
  liveEl.appendChild(frame);

  // ---------- the words of a step ----------
  function targetOf(s) {
    if (!s || stepDone() || state.busy) return null;
    const r = REGIONS[s.regionId];
    const plan = r.plan;
    const first = VALUE[plan.first];
    if (state.step === 2) return { card: plan.add, section: CARD[plan.add].section, aria: `${CARD[plan.add].name}: add to the bag`, callout: `Add the ${SHORT[plan.add]} to the bag, or press Show me. Watch the top two sections.` };
    if (state.step === 3) return { card: plan.look, section: CARD[plan.look].section, aria: `${CARD[plan.look].name}: look at it`, callout: `Look at the ${SHORT[plan.look]}, or press Show me. Watch the last two sections.` };
    if (state.step === 4) return { time: true, callout: `Let five minutes pass, or press Show me. Watch the ${first.word} bucket drain.` };
    if (state.step === 5) return { card: plan.story, section: CARD[plan.story].section, aria: `${CARD[plan.story].name}: click the story`, callout: `Click the ${SHORT[plan.story]}, or press Show me. Watch the sections below the pin.` };
    return null;
  }
  // The result of a step's action, in words, for a screen reader.
  function resultWords(s) {
    const r = REGIONS[s.regionId];
    const plan = r.plan;
    const first = VALUE[plan.first];
    const second = VALUE[plan.second];
    const m = movesOf(s.prev ? s.prev.order : null, s.d.order);
    if (state.step === 1) {
      const lifted = movesOf(SECTIONS.map((x) => x.id), s.d.order).up;
      return `Visitors in ${r.name} lean toward ${leanWords(r)}, so ${sectionName(s.d.order[0])} leads, and against the brand’s own order ${listWords(lifted.map((id) => sectionName(id)))} moved up. The hero is ${HERO[s.d.hero].title}.`;
    }
    if (state.step === 2) return `${moveSentence(m)} ${first.name} passed its entry line, and the hero is now ${HERO[s.d.hero].title}.`;
    if (state.step === 3) return `${moveSentence(m)} ${second.name} fills partway; ${first.word} still leads.`;
    if (state.step === 4) {
      const rel = s.log.filter((x) => x.kind === 'released').pop();
      return `At ${clock(rel.t)}, ${first.word} drained below its release line, so the visitor was released from it. ${m.swap ? `${sectionName(m.swap[1], true)} dropped back behind ${sectionName(m.swap[0])}.` : ''}`;
    }
    if (state.step === 5) return `${moveSentence(m)} The pinned spotlight held the first place: ranking never ran for it.`;
    return '';
  }

  // The receipt's lines, in words, from the replay's log.
  function logLines(s, freshFrom) {
    const r = REGIONS[s.regionId];
    const out = [];
    s.log.forEach((x, i) => {
      const fresh = i >= freshFrom;
      const time = clock(x.t);
      const prev = i ? s.log[i - 1].kind : null;
      const begins = ['region', 'add', 'look', 'pin'].indexOf(x.kind) >= 0 || ((x.kind === 'released' || x.kind === 'time') && prev !== 'released');
      const before = out.length;
      if (x.kind === 'region') out.push({ time, sign: '+', text: `Regional start: ${r.name}, picked on this page. Visitors there lean toward ${leanWords(r)}.`, fresh });
      else if (x.kind === 'add') out.push({ time, sign: '+', text: `Added to the bag: ${CARD[x.card].name}. An add counts three times a look.`, fresh });
      else if (x.kind === 'entered') out.push({ time, sign: '+', text: `${VALUE[x.v].name} passed its entry line: the visitor counts as interested.`, fresh });
      else if (x.kind === 'fading') out.push({ time, sign: '−', text: 'Regional start, stepping back as the visitor’s own buckets fill.', fresh });
      else if (x.kind === 'look') out.push({ time, sign: '+', text: `${CARD[x.card].story ? 'Clicked a story' : 'Looked at'}: ${CARD[x.card].name}.`, fresh });
      else if (x.kind === 'released') out.push({ time, sign: '−', text: `Released from ${VALUE[x.v].word}: the bucket drained below its release line.`, fresh, kind: 'release' });
      else if (x.kind === 'time') out.push({ time, sign: '', text: `${COUNT_WORDS[Math.round(x.t - x.from)] || 'Some'} minutes with no clicks; the page is decided again.`, fresh });
      else if (x.kind === 'pin') out.push({ time, sign: 'pin', text: 'Pinned by a merchandiser: the partner spotlight, first. Ranking never ran for it.', fresh, kind: 'pin' });
      if (out.length > before) out[out.length - 1].start = begins;
    });
    return out;
  }
  // The whole receipt, as a person would recompute it (step 6).
  function wholeLines(s) {
    const rc = receiptOf(s);
    const r = REGIONS[s.regionId];
    const lines = [];
    const own = VALUES.filter((v) => rc.levels[v.id] > 0).map((v) => `${v.word} ${num(rc.levels[v.id])}`);
    lines.push({ time: 'Rule', sign: '', text: 'Score = (1 − the region’s share) × the visitor’s level + the region’s share × its lean.' });
    const ownWords = listWords(own);
    lines.push({ time: 'Buckets', sign: '', text: `${ownWords.charAt(0).toUpperCase()}${ownWords.slice(1)}, the rest empty. Level = evidence ÷ (evidence + 1.8): ${num(rc.worked.R)} ÷ ${num(rc.worked.RK)} = ${num(rc.worked.level)}.` });
    lines.push({ time: 'Region', sign: '', text: `${r.name}’s share = 1 ÷ (1 + ${VALUES.filter((v) => rc.levels[v.id] > 0).map((v) => num(rc.levels[v.id])).join(' + ')}) = ${num(rc.lam)}.` });
    rc.places.forEach((pl) => {
      const name = SECTION[pl.id].title;
      if (pl.pinned) lines.push({ time: `Place ${pl.place}`, sign: 'pin', text: `${SECTION[pl.id].partner ? 'Partner spotlight' : name}: pinned. Ranking never ran for it; interest alone would rank it ${ORDINAL[pl.interestPlace - 1]}.`, kind: 'pin' });
      else if (pl.untagged) lines.push({ time: `Place ${pl.place}`, sign: '', text: `${name}: no tag, so 0; the brand’s recommendations fill it.` });
      else lines.push({ time: `Place ${pl.place}`, sign: '', text: `${name}: ${num(pl.rest)} × ${num(pl.level)} + ${num(pl.lam)} × ${num(pl.lean)} = ${num(pl.score)}.` });
    });
    lines.push({ time: 'Hero', sign: '', text: `${HERO[rc.hero].title}: ${num(rc.heroScore)}, the highest hero.` });
    lines.push({ time: 'Learning', sign: '', text: 'Recorded; the learning dial is at 0, so it changed nothing.' });
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

  // The store's view for a state: its order, hero, marks, and the one thing the reader may use.
  function viewOf(s, showMarks) {
    const marks = {};
    if (!s) return { order: SECTIONS.map((x) => x.id), hero: HEROES[0].id, marks, target: null, pinned: null, note: 'The brand’s own order, until a region is picked in the bar.' };
    const d = s.d;
    const lastPin = s.log.length && s.log[s.log.length - 1].kind === 'pin';
    const before = s.prev ? s.prev.order : state.step === 1 ? SECTIONS.map((x) => x.id) : null;
    if (showMarks && before && !lastPin) {
      const m = movesOf(before, d.order);
      m.up.forEach((id) => { marks[id] = { kind: 'up', text: 'moved up' }; });
      m.down.forEach((id) => { marks[id] = { kind: 'down', text: 'moved down' }; });
    }
    if (d.pinned) marks[d.pinned] = { kind: 'pin', text: 'pinned' };
    return { order: d.order, hero: d.hero, marks, target: targetOf(s), pinned: d.pinned, note: '' };
  }

  // ---------- drawing ----------
  function drawBar() {
    backBtn.hidden = state.step === 1;
    barCount.textContent = `Step ${state.step} of ${STEP_COUNT}`;
    barName.textContent = ` · ${STEP_TEXT[state.step - 1].title}`;
    dotEls.forEach((d, i) => { d.classList.toggle('is-done', i + 1 < state.step); d.classList.toggle('is-current', i + 1 === state.step); });
    regionBtns.forEach((b) => b.setAttribute('aria-pressed', b.dataset.region === state.regionId ? 'true' : 'false'));
    const want = [];
    if (state.step === 1) { want.push(pickName, regionGroup); if (state.regionId) want.push(nextBtn); }
    else if (state.step <= 5) { if (!stepDone() && !state.busy) want.push(showBtn); want.push(nextBtn); }
    else if (state.step === 6) want.push(nextBtn);
    else want.push(againBtn);
    syncChildren(controls, want);
    const t = STEP_TEXT[state.step - 1];
    explainLine.replaceChildren(...Array.prototype.slice.call(t.explainNode.cloneNode(true).childNodes));
    explainFixed.textContent = t.fixed;
    explainFixed.hidden = !t.fixed;
  }
  function drawSide(s, freshFrom) {
    const wide = state.step >= 6;
    side.classList.toggle('is-wide', wide);
    if (!s) {
      const zero = {};
      VALUES.forEach((v) => { zero[v.id] = 0; });
      buckets.update(zero, newProfile());
      buckets.setTime(0);
      balance.update(1, null);
      receipt.set('Why this page', 'No region picked yet.', [], 'log', true);
      liveEl.classList.remove('is-learning');
      return;
    }
    buckets.setTime(s.now);
    buckets.update(s.d.a, s.p, {});
    balance.update(s.d.lambda === null ? 1 : s.d.lambda, REGIONS[s.regionId].name, {});
    if (state.step === 6) receipt.set('The receipt, whole', `The home page at ${clock(s.now)}, for a visitor in ${REGIONS[s.regionId].name}.`, wholeLines(s), 'whole', false);
    else if (state.step === 7) receipt.set('What learning recorded', `This visit, up to ${clock(s.now)}.`, learningLines(s), 'learning', false);
    else receipt.set('Why this page', `The home page at ${clock(s.now)}, newest line first.`, logLines(s, freshFrom === undefined ? s.log.length : freshFrom), 'log', true);
    liveEl.classList.toggle('is-learning', state.step === 7);
    if (state.step === 7) learning.update(decide(s.p, s.regionId, s.now, { pin: s.pin, holdout: true }).order);
  }
  function render(opts) {
    const o = opts || {};
    const s = current();
    drawBar();
    store.update(viewOf(s, !!o.marks), !!o.animate);
    drawSide(s, o.freshFrom);
  }

  // ---------- where the window goes ----------
  const narrow = () => liveEl.clientWidth < 760;
  // Any control brings the frame's top to the window's top.
  function frameToTop() {
    const top = Math.max(0, docTop(liveEl));
    if (Math.abs(window.scrollY - top) < 2) return;
    window.scrollTo({ top, behavior: reduced() ? 'auto' : 'smooth' });
  }
  // On a phone, after an action, the changed section comes into view under the bar, with the buckets and the newest
  // receipt line below it. When everything still fits, the view starts higher: at the store's top, or else at a pinned
  // section above the change, so the reader also sees the pin hold its place.
  function revealChange(s) {
    if (!narrow()) { frameToTop(); return; }
    const barH = bar.getBoundingClientRect().height;
    const m = movesOf(s.prev ? s.prev.order : null, s.d.order);
    const ids = m.up.concat(m.down);
    const rows = ids.length ? ids.map((id) => store.secEls[id].li) : [store.root];
    const firstTop = Math.min.apply(null, rows.map(docTop));
    const newest = receipt.newest();
    const bottom = newest ? docTop(newest) + newest.offsetHeight : docTop(receipt.root) + 80;
    const tops = [docTop(store.root) - barH - 6];
    const pinTop = s.d.pinned ? docTop(store.secEls[s.d.pinned].li) : Infinity;
    if (pinTop < firstTop) tops.push(pinTop - barH - 14);
    const fits = tops.filter((t) => bottom - t <= window.innerHeight - 8);
    const top = fits.length ? fits[0] : firstTop - barH - 8;
    window.scrollTo({ top: Math.max(0, top), behavior: reduced() ? 'auto' : 'smooth' });
  }
  function primary() {
    if (state.step === 1) return state.regionId ? nextBtn : regionBtns[0];
    if (state.step <= 5) return stepDone() ? nextBtn : showBtn;
    if (state.step === 6) return nextBtn;
    return againBtn;
  }

  // ---------- the controls ----------
  function pickRegion(id) {
    if (state.step !== 1) return;
    clearTimers();
    state.regionId = id;
    state.progress = 1;
    state.doneUpTo = 1;
    render({ animate: true, marks: true, freshFrom: 0 });
    frameToTop();
    const chosen = regionBtns[REGION_IDS.indexOf(id)];
    if (doc.activeElement !== chosen) chosen.focus({ preventScroll: true });
    announce(resultWords(current()));
  }
  // The step's action, in front of the reader. then: what follows once the result has been seen (Next's hold).
  function act(then) {
    if (state.busy || stepDone() || !state.regionId) return;
    const before = current();
    if (state.step === 4) { passTime(before, then); return; }
    state.progress = ACTIONS[state.step];
    state.doneUpTo = Math.max(state.doneUpTo, state.step);
    const s = current();
    render({ animate: true, marks: true, freshFrom: before.log.length });
    s.log.slice(before.log.length).forEach((x) => { if (x.kind === 'entered') buckets.flash(x.v, 'entered'); });
    revealChange(s);
    announce(`${resultWords(s)} New on the receipt: ${logLines(s, before.log.length).filter((l) => l.fresh).map((l) => l.text).join(' ')}`);
    afterAction(then, GLIDE_MS);
  }
  function afterAction(then, ms) {
    if (then) {
      state.holding = true;
      later(() => { state.holding = false; then(); }, reduced() ? 0 : ms + HOLD_MS);
    } else nextBtn.focus({ preventScroll: true });
  }
  // Step 4: the clock runs on, the bucket drains past its release line, then the page is decided again.
  function passTime(before, then) {
    state.progress = 1;
    const s = current();
    const rel = s.log.filter((x) => x.kind === 'released');
    state.doneUpTo = Math.max(state.doneUpTo, 4);
    const finish = () => {
      state.busy = false;
      state.progress = 1;
      render({ animate: true, marks: true, freshFrom: before.log.length });
      revealChange(s);
      announce(`${resultWords(s)} New on the receipt: ${logLines(s, before.log.length).filter((l) => l.fresh).map((l) => l.text).join(' ')}`);
    };
    if (reduced() || !rel.length) {
      finish();
      rel.forEach((x) => buckets.flash(x.v, 'released'));
      afterAction(then, GLIDE_MS);
      return;
    }
    // Hold the page as it was while the buckets drain, then let it be decided again.
    state.busy = true;
    state.progress = 0;
    render({});
    state.progress = 1;
    frameToTop();
    if (!then) nextBtn.focus({ preventScroll: true });
    const t0 = before.now;
    const tRel = rel[0].t;
    const t1 = s.now;
    const p = before.p;
    const levelsAt = (t) => { const a = {}; VALUES.forEach((v) => { a[v.id] = interestOf(rawAt(p, v.id, t)); }); return a; };
    const lambdaAt = (t) => blend(levelsAt(t), REGIONS[state.regionId].share).lambda;
    const firstMs = 1300;
    const restMs = 800;
    const name = REGIONS[state.regionId].name;
    buckets.update(levelsAt(tRel), p, { slow: true });
    balance.update(lambdaAt(tRel), name, { slow: true });
    const ticks = 12;
    for (let i = 1; i <= ticks; i++) later(() => { buckets.setTime(t0 + ((tRel - t0) * i) / ticks); }, (firstMs * i) / ticks);
    later(() => {
      const pr = newProfile();
      Object.assign(pr.member, before.p.member, { [rel[0].v]: false });
      Object.assign(pr.released, before.p.released, { [rel[0].v]: true });
      buckets.update(levelsAt(tRel), pr, { slow: true });
      buckets.flash(rel[0].v, 'released');
      buckets.update(levelsAt(t1), pr, { slow: true });
      balance.update(lambdaAt(t1), name, { slow: true });
      const release = logLines(s, before.log.length).filter((l) => l.kind === 'release');
      receipt.set('Why this page', `The home page at ${clock(t0)}, newest line first.`, logLines(before, before.log.length).concat(release), 'log', true);
      for (let i = 1; i <= 6; i++) later(() => { buckets.setTime(tRel + ((t1 - tRel) * i) / 6); }, (restMs * i) / 6);
    }, firstMs);
    later(() => { finish(); afterAction(then, GLIDE_MS); }, firstMs + restMs + 40);
  }
  function onShow() { act(null); }
  function onNext() {
    if (state.step === 1 && !state.regionId) return;
    if (state.holding || state.busy) { clearTimers(); state.progress = Math.max(state.progress, ACTIONS[state.step]); go(state.step + 1, false); return; }
    if (!stepDone()) { act(() => go(state.step + 1, false)); return; }
    go(state.step + 1, false);
  }
  function onBack() { if (state.step > 1) go(state.step - 1, true); }
  // A step change. Going back restores the step as the reader left it, its action done.
  function go(step, back) {
    if (step < 1 || step > STEP_COUNT) return;
    clearTimers();
    state.step = step;
    // A step the reader has already done opens as it was left; a new one opens before its action.
    state.progress = back || step <= state.doneUpTo ? ACTIONS[step] : 0;
    if (step === 1) state.progress = state.regionId ? 1 : 0;
    if (step > 1 && ACTIONS[step] === 0) state.doneUpTo = Math.max(state.doneUpTo, step);
    render({ animate: true });
    frameToTop();
    primary().focus({ preventScroll: true });
    announce(`Step ${step} of ${STEP_COUNT}: ${STEP_TEXT[step - 1].title}.`);
  }
  function restart() {
    clearTimers();
    state.regionId = null;
    state.step = 1;
    state.progress = 0;
    state.doneUpTo = 0;
    render({ animate: true });
    frameToTop();
    regionBtns[0].focus({ preventScroll: true });
    announce(`Step 1 of ${STEP_COUNT}: ${STEP_TEXT[0].title}. Pick where this visitor is.`);
  }

  // ---------- start ----------
  if (introEl) introEl.hidden = false;
  liveEl.hidden = false;
  playerEl.classList.add('is-live');
  render({});
  // For the page's own checks in a browser: the model and the state, read only.
  window.__seeItWork = Object.freeze({ model: MODEL, state: () => ({ regionId: state.regionId, step: state.step, progress: state.progress, busy: state.busy, holding: state.holding }), current });
})();
