/* enablement/site/see-it-work.js
   The four instruments of the page See it work, added as progressive enhancement. Without this script the page
   reads in full and shows a still picture of each move. It stores nothing, sends nothing and loads nothing. It
   writes no style attribute and builds no markup from strings: every element is made with createElement and
   filled with textContent, the buckets, bars and clock are SVG whose attributes are set directly, and motion uses
   the Web Animations API or a class the stylesheet animates.

   The arithmetic is the engine's, as the explainer facts sheet (FACTS.md, sections 1 to 3) states it:
     interest   a = R / (R + K) with K = 1.8, where R is the raw score each touch adds its action's weight to
     fading     R falls as R * exp(-elapsed / tau), with tau = 14 days, the engine's default memory
     lines      a visitor joins an interest at a >= 0.60 and is released only below 0.45; time alone can release,
                never admit
     region     lambda = kBlend / (kBlend + the sum of the visitor's own interests); each blended interest is
                (1 - lambda) * a + lambda * the region's share; kBlend = 0.5, the published value FACTS cites
     score      for each of the slot's dimensions, its weight times the sum of the blended interests of the
                piece's tags, added up
     order      gates first, then pins, then the score, with ties in the brand's own order
   The store, its products and the regional shares are invented for the page. The block between the model
   markers is self-contained, so the still pictures in the page are drawn from the same numbers. */
(function () {
  'use strict';

  /* model:start */
  const K = 1.8;
  const ENTRY = 0.6;
  const RELEASE = 0.45;
  const TAU = 14;
  const KBLEND = 0.5;
  const WEIGHT = 1;
  const SLOT_WEIGHTS = { kind: 1 };
  const EPS = 1e-9;

  const VALUES = [
    { id: 'rain', dim: 'kind', name: 'Rain layers', word: 'rain layers' },
    { id: 'knit', dim: 'kind', name: 'Knitwear', word: 'knitwear' },
    { id: 'linen', dim: 'kind', name: 'Linen', word: 'linen' },
    { id: 'table', dim: 'kind', name: 'Tableware', word: 'tableware' },
  ];
  const VALUE = {};
  VALUES.forEach((v) => { VALUE[v.id] = v; });

  // What visitors in each region lean toward: shares within the dimension, the leader at one. Invented.
  const REGIONS = {
    wa: { id: 'wa', name: 'Washington State', share: { rain: 1, knit: 0.75, table: 0.5, linen: 0 }, morning: 'knit' },
    fl: { id: 'fl', name: 'Florida', share: { linen: 1, table: 0.75, rain: 0.5, knit: 0 }, morning: 'table' },
  };

  const HEROES = [
    { id: 'h-rain', title: 'The rain edit', sub: 'Layers for wet weekends', tags: ['rain'], tone: 'rain' },
    { id: 'h-knit', title: 'Knit season', sub: 'Soft wool for cool evenings', tags: ['knit'], tone: 'knit' },
    { id: 'h-linen', title: 'Linen days', sub: 'Light layers for warm afternoons', tags: ['linen'], tone: 'linen' },
    { id: 'h-table', title: 'Hosting at home', sub: 'Plates, bowls and everything between', tags: ['table'], tone: 'table' },
  ];

  // The page's sections, in the brand's own order: the order the site shows when nothing points anywhere.
  const SECTIONS = [
    { id: 'rain', title: 'Rain-ready layers', start: 'Rain-ready layers', mid: 'Rain-ready layers', tone: 'rain', tags: ['rain'], cards: [
      { id: 'jacket', name: 'Waxed field jacket', icon: 'jacket', tags: ['rain', 'knit'], outOfStock: true },
      { id: 'shell', name: 'Packable rain shell', icon: 'shell', tags: ['rain'] },
      { id: 'wet', name: 'Dressing for wet weekends', icon: 'story', tags: ['rain'], story: true },
    ] },
    { id: 'recs', title: 'Recommended for you', start: 'The recommendations carousel', mid: 'the recommendations carousel', tone: 'recs', tags: [], recs: true, fixedOrder: true, cards: [
      { id: 'throw', name: 'Wool throw', icon: 'throw', tags: ['knit'] },
      { id: 'carafe', name: 'Glass carafe', icon: 'carafe', tags: ['table'] },
      { id: 'tote', name: 'Linen market tote', icon: 'bag', tags: ['linen'] },
    ] },
    { id: 'knit', title: 'Soft knits', start: 'Soft knits', mid: 'Soft knits', tone: 'knit', tags: ['knit'], cards: [
      { id: 'cardigan', name: 'Cable-knit cardigan', icon: 'sweater', tags: ['knit'] },
      { id: 'crew', name: 'Merino crew sweater', icon: 'sweater', tags: ['knit'] },
      { id: 'woolcare', name: 'How to care for wool', icon: 'story', tags: ['knit'], story: true },
    ] },
    { id: 'linen', title: 'The linen shop', start: 'The linen shop', mid: 'the linen shop', tone: 'linen', tags: ['linen'], cards: [
      { id: 'shirt', name: 'Linen camp shirt', icon: 'shirt', tags: ['linen'] },
      { id: 'trousers', name: 'Wide-leg linen trousers', icon: 'trousers', tags: ['linen'] },
      { id: 'living', name: 'Living in linen', icon: 'story', tags: ['linen'], story: true },
    ] },
    { id: 'partner', title: 'Partner spotlight: Saltmarsh Ceramics', start: 'The partner spotlight', mid: 'the partner spotlight', tone: 'table', tags: ['table'], partner: true, cards: [
      { id: 'plates', name: 'Stoneware dinner plates', icon: 'plate', tags: ['table'] },
      { id: 'bowl', name: 'Speckled serving bowl', icon: 'bowl', tags: ['table'] },
      { id: 'napkins', name: 'Linen napkin set', icon: 'napkin', tags: ['table', 'linen'] },
    ] },
  ];
  const SECTION = {};
  SECTIONS.forEach((s) => { SECTION[s.id] = s; });
  const HERO = {};
  HEROES.forEach((h) => { HERO[h.id] = h; });

  function newProfile() { return { R: {}, t: {}, member: {}, released: {} }; }
  function rawAt(p, v, now) { const R = p.R[v] || 0; return R ? R * Math.exp(-(now - p.t[v]) / TAU) : 0; }
  function interestOf(R) { return R / (R + K); }
  // One touch: fade what is there to now, then add the action's weight.
  function touch(p, v, w, now) { p.R[v] = rawAt(p, v, now) + w; p.t[v] = now; }
  function ownInterests(p, now) { const a = {}; VALUES.forEach((v) => { a[v.id] = interestOf(rawAt(p, v.id, now)); }); return a; }
  // After an event: a visitor joins at the entry line, and leaves below the release line.
  function settleOnEvent(p, now) {
    const a = ownInterests(p, now);
    const changes = [];
    VALUES.forEach((v) => {
      if (!p.member[v.id] && a[v.id] >= ENTRY) { p.member[v.id] = true; changes.push({ v: v.id, kind: 'entered' }); }
      else if (p.member[v.id] && a[v.id] < RELEASE) { p.member[v.id] = false; p.released[v.id] = true; changes.push({ v: v.id, kind: 'released' }); }
    });
    return changes;
  }
  // As time passes: time alone can release a visitor, never admit one.
  function settleOnTime(p, now) {
    const a = ownInterests(p, now);
    const out = [];
    VALUES.forEach((v) => { if (p.member[v.id] && a[v.id] < RELEASE) { p.member[v.id] = false; p.released[v.id] = true; out.push(v.id); } });
    return out;
  }
  function blend(a, share) {
    let sum = 0;
    VALUES.forEach((v) => { sum += a[v.id]; });
    const lambda = KBLEND / (KBLEND + sum);
    const b = {};
    VALUES.forEach((v) => { b[v.id] = (1 - lambda) * a[v.id] + lambda * (share[v.id] || 0); });
    return { lambda, b };
  }
  function scoreOf(tags, b) {
    const byDim = {};
    tags.forEach((t) => { const d = VALUE[t].dim; byDim[d] = (byDim[d] || 0) + b[t]; });
    let s = 0;
    Object.keys(byDim).forEach((d) => { s += (SLOT_WEIGHTS[d] || 0) * byDim[d]; });
    return s;
  }
  function rank(items, b) {
    return items.map((it, i) => ({ it, i, s: scoreOf(it.tags, b) }))
      .sort((x, y) => (y.s - x.s > EPS ? 1 : x.s - y.s > EPS ? -1 : x.i - y.i))
      .map((r) => r.it);
  }
  // One decision for the whole page: the hero slot, the layout slot's sections, and the pieces inside each.
  function decide(p, regionId, now, rules) {
    const r = rules || {};
    const a = ownInterests(p, now);
    const { lambda, b } = blend(a, REGIONS[regionId].share);
    const interestOrder = rank(SECTIONS, b).map((s) => s.id);
    let order = interestOrder.slice();
    if (r.pin) order = [r.pin].concat(order.filter((id) => id !== r.pin));
    const hero = rank(HEROES, b)[0].id;
    const cardsByInterest = {};
    const removed = [];
    SECTIONS.forEach((s) => {
      const all = s.fixedOrder ? s.cards.slice() : rank(s.cards, b);
      cardsByInterest[s.id] = all.map((c) => c.id);
      all.forEach((c) => { if (r.gate && c.outOfStock) removed.push(c.id); });
    });
    const scores = {};
    SECTIONS.forEach((s) => { scores[s.id] = scoreOf(s.tags, b); });
    return { a, b, lambda, order, interestOrder, hero, cardsByInterest, removed, scores, pin: r.pin || null };
  }
  const MODEL = { K, ENTRY, RELEASE, TAU, KBLEND, WEIGHT, VALUES, VALUE, REGIONS, HEROES, HERO, SECTIONS, SECTION, newProfile, touch, ownInterests, settleOnEvent, settleOnTime, decide };
  /* model:end */

  if (typeof document === 'undefined') return;
  const doc = document;
  const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const canAnimate = !reduced && typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
  const SVGNS = 'http://www.w3.org/2000/svg';
  const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth'];
  void MODEL;

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
  function button(cls, text, onClick) {
    const b = el('button', cls, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }
  let uidCounter = 0;
  const uid = (prefix) => `${prefix}-${++uidCounter}`;
  function listWords(words, joiner) {
    if (words.length <= 1) return words.join('');
    if (joiner === 'then') return words.join(', then ');
    return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
  }
  function flash(node, cls, ms) {
    node.classList.remove(cls);
    void node.getBoundingClientRect();
    node.classList.add(cls);
    setTimeout(() => node.classList.remove(cls), ms || 1400);
  }
  // A number eased toward its target over a few frames, then handed to apply.
  function tweener(apply) {
    let cur = null;
    let raf = 0;
    return function to(target, ms) {
      cancelAnimationFrame(raf);
      if (cur === null || !ms || reduced) { cur = target; apply(target); return; }
      const from = cur;
      const t0 = performance.now();
      const step = (t) => {
        const k = Math.min(1, (t - t0) / ms);
        cur = from + (target - from) * (1 - Math.pow(1 - k, 3));
        apply(cur);
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
  }
  // Move nodes to new places and let each glide from where it was. Focus survives the move.
  function flipMove(scope, nodes, mutate, animate) {
    const before = new Map();
    if (animate && canAnimate) nodes.forEach((n) => { if (!n.hidden) before.set(n, n.getBoundingClientRect()); });
    const focused = doc.activeElement;
    mutate();
    if (focused && focused !== doc.body && scope.contains(focused) && doc.activeElement !== focused) focused.focus({ preventScroll: true });
    if (!animate || !canAnimate) return;
    nodes.forEach((n) => {
      const a = before.get(n);
      if (!a || n.hidden) return;
      const b = n.getBoundingClientRect();
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        n.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], { duration: 620, easing: 'cubic-bezier(.2, .75, .25, 1)' });
      }
    });
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
  };
  function icon(name, cls) {
    const s = svgEl('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false', class: cls || 'sw-icon' });
    s.appendChild(svgEl('path', { d: ICONS[name] }));
    return s;
  }

  // ---------- words ----------
  const heroTitle = (id) => HERO[id].title;
  function describeMoves(before, after) {
    const lines = [];
    after.forEach((id, i) => {
      const j = before.indexOf(id);
      if (j <= i) return;
      const passed = before.slice(0, j).filter((x) => after.indexOf(x) > i);
      if (!passed.length) return;
      if (i === 0) lines.push(`${SECTION[id].start} moved to the top.`);
      else lines.push(`${SECTION[id].start} moved up, ahead of ${listWords(passed.map((x) => SECTION[x].mid))}.`);
    });
    return lines;
  }
  function levelWords(a, member) {
    if (a >= ENTRY) return member ? 'past the entry line, so the visitor counts as interested' : 'past the entry line';
    if (a >= RELEASE) return member ? 'between the two lines, and the visitor still counts as interested' : 'between the release line and the entry line';
    if (a >= 0.05) return 'below the release line';
    return 'nearly empty';
  }
  function leanWords(lambda) {
    if (lambda > 0.9) return 'almost all on the region';
    if (lambda > 0.6) return 'mostly on the region';
    if (lambda >= 0.4) return 'about equally on the region and the visitor';
    if (lambda >= 0.1) return "mostly on the visitor's own clicks";
    return "almost all on the visitor's own clicks";
  }
  function cardPhrase(c) { return c.story ? `the story "${c.name}"` : `the ${c.name.toLowerCase()}`; }

  // ---------- components ----------
  function Announcer() {
    const p = el('p', 'visually-hidden');
    p.setAttribute('role', 'status');
    p.setAttribute('aria-live', 'polite');
    let t = 0;
    return {
      root: p,
      say(text) { clearTimeout(t); p.textContent = ''; t = setTimeout(() => { p.textContent = text; }, 80); },
    };
  }

  function Segmented(labelText, options, selected, onChange) {
    const wrap = el('div', 'sw-seg');
    const lab = el('span', 'sw-seg-label', labelText);
    lab.id = uid('sw-seg');
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-labelledby', lab.id);
    wrap.appendChild(lab);
    let current = selected;
    const buttons = options.map((o, i) => {
      const b = button('sw-btn', o.name, () => select(o.id, true));
      b.dataset.value = o.id;
      b.addEventListener('keydown', (e) => {
        let to = -1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = (i + 1) % options.length;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = (i + options.length - 1) % options.length;
        if (to >= 0) { e.preventDefault(); buttons[to].focus(); }
      });
      wrap.appendChild(b);
      return b;
    });
    function paint() { buttons.forEach((b) => b.setAttribute('aria-pressed', b.dataset.value === current ? 'true' : 'false')); }
    function select(id, fire) {
      if (id === current) return;
      current = id;
      paint();
      if (fire) onChange(id);
    }
    paint();
    return { root: wrap, select, get value() { return current; } };
  }

  function Toggle(text, onChange) {
    const b = button('sw-btn sw-toggle', text, () => {
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      onChange(on);
    });
    b.setAttribute('aria-pressed', 'false');
    return b;
  }

  function Storefront(opts) {
    const root = el('div', 'sw-store');
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Morrow & Vale, the sample store: its home page');
    const head = el('div', 'sw-store-head');
    head.setAttribute('aria-hidden', 'true');
    head.appendChild(el('span', 'sw-store-mark', 'Morrow & Vale'));
    const nav = el('span', 'sw-store-nav');
    ['New in', 'Clothing', 'Home', 'Journal'].forEach((t) => nav.appendChild(el('span', null, t)));
    head.appendChild(nav);
    head.appendChild(icon('bag', 'sw-icon sw-store-bag'));
    root.appendChild(head);
    const status = el('p', 'sw-store-status');
    root.appendChild(status);
    const hero = el('div', 'sw-hero');
    const heroTitleEl = el('span', 'sw-hero-title');
    const heroSub = el('span', 'sw-hero-sub');
    hero.appendChild(heroTitleEl);
    hero.appendChild(heroSub);
    root.appendChild(hero);
    const list = el('ol', 'sw-sections');
    list.setAttribute('aria-label', 'The sections of the page, in order');
    root.appendChild(list);
    const secEls = {};
    const cardEls = {};
    SECTIONS.forEach((s) => {
      const li = el('li', `sw-section sw-tone-${s.tone}`);
      li.dataset.id = s.id;
      const sh = el('div', 'sw-section-head');
      sh.appendChild(el('span', 'sw-section-title', s.title));
      if (s.recs) sh.appendChild(el('span', 'sw-section-note', "Products from the brand's recommendations"));
      const badge = el('span', 'sw-badge', 'Pinned');
      badge.hidden = true;
      sh.appendChild(badge);
      li.appendChild(sh);
      const ul = el('ul', 'sw-cards');
      s.cards.forEach((c) => {
        const item = el('li', 'sw-card-item');
        item.dataset.id = c.id;
        const card = el(opts.clickable ? 'button' : 'div', 'sw-card');
        if (opts.clickable) {
          const words = c.tags.map((t) => VALUE[t].word);
          card.type = 'button';
          card.setAttribute('aria-label', `${c.name}${c.story ? ', a story' : ''}: fills the ${listWords(words)} ${words.length > 1 ? 'buckets' : 'bucket'}`);
          card.addEventListener('click', () => opts.onCard(c, card));
        }
        card.appendChild(icon(c.icon));
        const txt = el('span', 'sw-card-text');
        if (c.story) txt.appendChild(el('span', 'sw-card-kind', 'Story'));
        txt.appendChild(el('span', 'sw-card-name', c.name));
        if (opts.showTags) txt.appendChild(el('span', 'sw-card-tags', c.tags.map((t) => VALUE[t].name).join(', ')));
        if (c.outOfStock && opts.showStock) txt.appendChild(el('span', 'sw-card-oos', 'Out of stock'));
        card.appendChild(txt);
        item.appendChild(card);
        ul.appendChild(item);
        cardEls[c.id] = item;
      });
      li.appendChild(ul);
      list.appendChild(li);
      secEls[s.id] = li;
    });
    let heroId = null;
    let busy = 0;
    let leaveAnims = [];
    function setHero(id, animate) {
      if (id === heroId) return;
      const h = HERO[id];
      heroTitleEl.textContent = h.title;
      heroSub.textContent = h.sub;
      HEROES.forEach((x) => hero.classList.remove(`sw-tone-${x.tone}`));
      hero.classList.add(`sw-tone-${h.tone}`);
      if (animate && canAnimate && heroId !== null) hero.animate([{ opacity: 0.2, transform: 'scale(.985)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 480, easing: 'ease-out' });
      heroId = id;
    }
    function update(d, animate) {
      // A fade-out still waiting from an earlier update is dropped, so no card is left invisible.
      leaveAnims.forEach((an) => an.cancel());
      leaveAnims = [];
      const leaving = [];
      const arriving = [];
      SECTIONS.forEach((s) => s.cards.forEach((c) => {
        const gone = d.removed.indexOf(c.id) >= 0;
        if (gone && !cardEls[c.id].hidden) leaving.push(cardEls[c.id]);
        if (!gone && cardEls[c.id].hidden) arriving.push(cardEls[c.id]);
      }));
      const nodes = SECTIONS.map((s) => secEls[s.id]).concat(Object.keys(cardEls).map((k) => cardEls[k]));
      const run = () => {
        flipMove(root, nodes, () => {
          d.order.forEach((id) => list.appendChild(secEls[id]));
          SECTIONS.forEach((s) => {
            const ul = secEls[s.id].querySelector('.sw-cards');
            d.cardsByInterest[s.id].forEach((cid) => ul.appendChild(cardEls[cid]));
            const pinned = d.pin === s.id;
            secEls[s.id].classList.toggle('is-pinned', pinned);
            secEls[s.id].querySelector('.sw-badge').hidden = !pinned;
          });
          SECTIONS.forEach((s) => s.cards.forEach((c) => { cardEls[c.id].hidden = d.removed.indexOf(c.id) >= 0; }));
        }, animate);
        if (animate && canAnimate) arriving.forEach((n) => n.animate([{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' }));
        setHero(d.hero, animate);
      };
      const ticket = ++busy;
      if (animate && canAnimate && leaving.length) {
        leaveAnims = leaving.map((n) => n.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.85)' }], { duration: 260, easing: 'ease-in', fill: 'forwards' }));
        setTimeout(() => {
          if (ticket !== busy) return;
          run();
          leaveAnims.forEach((an) => an.cancel());
          leaveAnims = [];
        }, 270);
      } else run();
    }
    return {
      root,
      update,
      setStatus(text) { status.textContent = text; },
    };
  }

  const VESSEL = 'M6 6H58L52 96H12Z';
  const yOf = (a) => 96 - a * 90;
  function Buckets(name) {
    const root = el('div', 'sw-buckets');
    root.appendChild(el('p', 'sw-panel-title', 'Interest buckets'));
    const row = el('div', 'sw-bucket-row');
    root.appendChild(row);
    const cells = {};
    VALUES.forEach((v) => {
      const cell = el('div', `sw-bucket sw-tone-${v.id}`);
      const svg = svgEl('svg', { viewBox: '0 0 64 100', class: 'sw-bucket-svg', role: 'img' });
      const clipId = uid(`sw-clip-${name}-${v.id}`);
      const defs = svgEl('defs');
      const clip = svgEl('clipPath', { id: clipId });
      clip.appendChild(svgEl('path', { d: VESSEL }));
      defs.appendChild(clip);
      svg.appendChild(defs);
      svg.appendChild(svgEl('path', { d: VESSEL, class: 'sw-vessel' }));
      const liquid = svgEl('rect', { x: 0, y: 96, width: 64, height: 0, class: 'sw-liquid', 'clip-path': `url(#${clipId})` });
      svg.appendChild(liquid);
      svg.appendChild(svgEl('line', { x1: 3, x2: 61, y1: yOf(ENTRY), y2: yOf(ENTRY), class: 'sw-entry' }));
      svg.appendChild(svgEl('line', { x1: 3, x2: 61, y1: yOf(RELEASE), y2: yOf(RELEASE), class: 'sw-release' }));
      svg.appendChild(svgEl('path', { d: VESSEL, class: 'sw-vessel-rim' }));
      cell.appendChild(svg);
      cell.appendChild(el('p', 'sw-bucket-name', v.name));
      const state = el('p', 'sw-bucket-state', '');
      cell.appendChild(state);
      row.appendChild(cell);
      const to = tweener((a) => { const y = yOf(a); liquid.setAttribute('y', y.toFixed(2)); liquid.setAttribute('height', (96 - y).toFixed(2)); });
      cells[v.id] = { cell, svg, state, to };
    });
    const key = el('p', 'sw-bucket-legend');
    key.appendChild(el('span', 'sw-key sw-key--entry', 'Entry line'));
    key.appendChild(el('span', 'sw-key sw-key--release', 'Release line'));
    root.appendChild(key);
    return {
      root,
      update(levels, p, ms) {
        VALUES.forEach((v) => {
          const c = cells[v.id];
          const member = !!p.member[v.id];
          c.to(levels[v.id], ms);
          c.cell.classList.toggle('is-member', member);
          c.state.textContent = member ? 'Interested' : p.released[v.id] ? 'Released' : '';
          c.svg.setAttribute('aria-label', `${v.name} bucket: ${levelWords(levels[v.id], member)}${!member && p.released[v.id] ? ', and released' : ''}.`);
        });
      },
      flash(v, kind) { flash(cells[v].cell, kind === 'released' ? 'is-released-flash' : 'is-entered-flash', 1600); },
    };
  }

  function Balance() {
    const root = el('div', 'sw-balance');
    root.appendChild(el('p', 'sw-panel-title', 'What the page leans on'));
    const svg = svgEl('svg', { viewBox: '0 0 200 14', preserveAspectRatio: 'none', class: 'sw-balance-svg', role: 'img' });
    const region = svgEl('rect', { x: 0, y: 0, width: 200, height: 14, class: 'sw-bal-region' });
    const own = svgEl('rect', { x: 200, y: 0, width: 0, height: 14, class: 'sw-bal-own' });
    svg.appendChild(region);
    svg.appendChild(own);
    root.appendChild(svg);
    const labels = el('div', 'sw-balance-labels');
    labels.appendChild(el('span', 'sw-bal-key sw-bal-key--region', 'Their region'));
    labels.appendChild(el('span', 'sw-bal-key sw-bal-key--own', 'Their own clicks'));
    root.appendChild(labels);
    const to = tweener((l) => {
      const w = Math.max(0, Math.min(200, l * 200));
      region.setAttribute('width', w.toFixed(2));
      own.setAttribute('x', w.toFixed(2));
      own.setAttribute('width', (200 - w).toFixed(2));
    });
    return {
      root,
      update(lambda, ms) { to(lambda, ms); svg.setAttribute('aria-label', `The page leans ${leanWords(lambda)}.`); },
    };
  }

  function RegionLean() {
    const root = el('div', 'sw-lean');
    const title = el('p', 'sw-panel-title', '');
    root.appendChild(title);
    const list = el('div', 'sw-lean-rows');
    root.appendChild(list);
    const rows = {};
    VALUES.forEach((v) => {
      const row = el('div', `sw-lean-row sw-tone-${v.id}`);
      row.appendChild(el('span', 'sw-lean-name', v.name));
      const svg = svgEl('svg', { viewBox: '0 0 100 10', preserveAspectRatio: 'none', class: 'sw-lean-svg', 'aria-hidden': 'true' });
      svg.appendChild(svgEl('rect', { x: 0, y: 0, width: 100, height: 10, rx: 5, class: 'sw-lean-track' }));
      const fill = svgEl('rect', { x: 0, y: 0, width: 0, height: 10, rx: 5, class: 'sw-lean-fill' });
      svg.appendChild(fill);
      row.appendChild(svg);
      const words = el('span', 'sw-lean-words', '');
      row.appendChild(words);
      list.appendChild(row);
      rows[v.id] = { row, words, to: tweener((s) => fill.setAttribute('width', (s * 100).toFixed(2))) };
    });
    return {
      root,
      update(regionId, animate) {
        const share = REGIONS[regionId].share;
        title.textContent = `What visitors in ${REGIONS[regionId].name} lean toward`;
        const order = VALUES.slice().sort((x, y) => (share[y.id] || 0) - (share[x.id] || 0));
        flipMove(root, order.map((v) => rows[v.id].row), () => order.forEach((v) => list.appendChild(rows[v.id].row)), animate);
        order.forEach((v, i) => {
          const s = share[v.id] || 0;
          rows[v.id].to(s, animate ? 520 : 0);
          rows[v.id].words.textContent = s === 0 ? 'hardly at all' : '';
          rows[v.id].row.classList.toggle('is-lead', i === 0);
        });
      },
    };
  }

  function Receipt(subtitle) {
    const root = el('div', 'sw-receipt');
    const head = el('p', 'sw-receipt-head', 'Receipt');
    root.appendChild(head);
    root.appendChild(el('p', 'sw-receipt-sub', subtitle));
    const list = el('ol', 'sw-receipt-lines');
    list.setAttribute('aria-label', 'Receipt lines, newest first');
    root.appendChild(list);
    function line(l, fresh) {
      const li = el('li', fresh ? 'is-new' : '');
      li.appendChild(el('span', 'sw-r-tag', l.tag));
      li.appendChild(el('span', 'sw-r-text', l.text));
      return li;
    }
    return {
      root,
      set(lines) { list.replaceChildren(...lines.map((l) => line(l, false))); },
      add(lines) {
        // Newest event first; its first line carries the rule that separates it from the one before.
        lines.slice().reverse().forEach((l, k) => {
          const li = line(l, true);
          if (k === lines.length - 1) li.classList.add('sw-r-first');
          list.insertBefore(li, list.firstChild);
        });
        while (list.children.length > 12) list.removeChild(list.lastChild);
      },
    };
  }

  function Clock() {
    const root = el('div', 'sw-clock');
    const svg = svgEl('svg', { viewBox: '0 0 48 48', class: 'sw-clock-svg', 'aria-hidden': 'true' });
    svg.appendChild(svgEl('circle', { cx: 24, cy: 24, r: 21, class: 'sw-clock-face' }));
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      svg.appendChild(svgEl('line', { x1: (24 + Math.sin(ang) * 16).toFixed(2), y1: (24 - Math.cos(ang) * 16).toFixed(2), x2: (24 + Math.sin(ang) * 19).toFixed(2), y2: (24 - Math.cos(ang) * 19).toFixed(2), class: 'sw-clock-tick' }));
    }
    const hand = svgEl('line', { x1: 24, y1: 24, x2: 24, y2: 9, class: 'sw-clock-hand' });
    svg.appendChild(hand);
    svg.appendChild(svgEl('circle', { cx: 24, cy: 24, r: 2.4, class: 'sw-clock-pin' }));
    root.appendChild(svg);
    const text = el('div', 'sw-clock-text');
    const label = el('p', 'sw-clock-label', '');
    text.appendChild(label);
    const days = el('div', 'sw-days');
    days.setAttribute('aria-hidden', 'true');
    const dots = [];
    for (let i = 0; i < 21; i++) { const d = el('span', 'sw-day'); days.appendChild(d); dots.push(d); }
    text.appendChild(days);
    text.appendChild(el('p', 'sw-clock-note', 'The clock runs fast: each dot is a day.'));
    root.appendChild(text);
    return {
      root,
      update(now, words) {
        hand.setAttribute('transform', `rotate(${((now / 7) * 360).toFixed(1)} 24 24)`);
        label.textContent = words;
        dots.forEach((d, i) => d.classList.toggle('is-past', i < Math.floor(now)));
      },
    };
  }

  function whenWords(now) {
    if (now < 0.5) return 'This morning';
    if (now < 1.5) return 'The next day';
    if (now < 7) return 'Days on';
    if (now < 14) return 'Over a week on';
    return 'Weeks on';
  }

  // ---------- the region the visitor is in, shared by the four moves ----------
  const shared = { region: 'wa', subs: [] };
  function setRegion(id) { shared.region = id; shared.subs.forEach((f) => f(id)); }
  const regionName = () => REGIONS[shared.region].name;

  function frame(mod) {
    const inst = el('div', `sw-inst sw-inst--${mod}`);
    const controls = el('div', 'sw-controls');
    inst.appendChild(controls);
    return { inst, controls };
  }

  // ---------- first move: the first page already feels local ----------
  function sceneLocal(live) {
    const { inst, controls } = frame('local');
    const seg = Segmented('A visitor from', Object.keys(REGIONS).map((k) => ({ id: k, name: REGIONS[k].name })), shared.region, (id) => { setRegion(id); render(true); });
    controls.appendChild(seg.root);
    const store = Storefront({ clickable: false });
    const meters = el('div', 'sw-meters');
    const lean = RegionLean();
    meters.appendChild(lean.root);
    const receipt = Receipt('Why this first page');
    const say = Announcer();
    inst.appendChild(store.root);
    inst.appendChild(meters);
    inst.appendChild(receipt.root);
    inst.appendChild(say.root);
    live.appendChild(inst);
    function render(animate) {
      const r = REGIONS[shared.region];
      const d = decide(newProfile(), r.id, 0);
      store.setStatus(`The home page for a visitor from ${r.name}, before any click.`);
      store.update(d, animate);
      lean.update(r.id, animate);
      const leaning = VALUES.filter((v) => (r.share[v.id] || 0) > 0).sort((x, y) => r.share[y.id] - r.share[x.id]).map((v) => v.word);
      const scored = d.order.filter((id) => d.scores[id] > EPS);
      const rest = d.order.filter((id) => d.scores[id] <= EPS);
      const lines = [
        { tag: 'Stranger', text: "Before any click, the engine reads only the visitor's region." },
        { tag: 'Region', text: `Visitors in ${r.name} lean toward ${listWords(leaning, 'then')}.` },
        { tag: 'Sections', text: `So ${listWords(scored.map((id) => SECTION[id].mid))} come first, in that order.` },
        { tag: 'Hero', text: `The hero follows the strongest lean: ${heroTitle(d.hero)}.` },
      ];
      if (rest.length) lines.push({ tag: 'Default', text: `Sections nothing points to keep the brand's own order: ${listWords(rest.map((id) => SECTION[id].mid), 'then')}.` });
      receipt.set(lines);
      if (animate) say.say(`The first page for a visitor from ${r.name}: ${d.order.map((id) => SECTION[id].title).join(', ')}. The hero is ${heroTitle(d.hero)}.`);
    }
    render(false);
  }

  // ---------- second move: the first click changes the page ----------
  function sceneClick(live) {
    const { inst, controls } = frame('click');
    const who = el('p', 'sw-who', '');
    controls.appendChild(who);
    const meters = el('div', 'sw-meters sw-meters--sticky');
    const buckets = Buckets('click');
    const balance = Balance();
    meters.appendChild(buckets.root);
    meters.appendChild(balance.root);
    const receipt = Receipt('What each click changed');
    const say = Announcer();
    let p;
    let now;
    let last;
    let timer = 0;
    let first;
    let seen;
    const store = Storefront({ clickable: true, showTags: true, onCard });
    const actions = el('div', 'sw-actions');
    actions.appendChild(button('sw-btn', 'Start over', () => reset(true)));
    controls.appendChild(actions);
    // The buckets and the store share a stage, so on a narrow screen the buckets stay in view only beside the store.
    const stage = el('div', 'sw-stage');
    stage.appendChild(meters);
    stage.appendChild(store.root);
    inst.appendChild(stage);
    inst.appendChild(receipt.root);
    inst.appendChild(say.root);
    live.appendChild(inst);
    function reset(animate) {
      clearTimeout(timer);
      p = newProfile();
      now = 0;
      first = true;
      seen = {};
      last = decide(p, shared.region, now);
      who.textContent = `A visitor from ${regionName()}`;
      store.setStatus('The home page, as the visitor first sees it.');
      store.update(last, animate);
      buckets.update(last.a, p, animate ? 400 : 0);
      balance.update(last.lambda, animate ? 400 : 0);
      receipt.set([{ tag: 'Start', text: 'No clicks so far, so the page follows the regional lean.' }]);
      if (animate) say.say('Started over: the first page, before any click.');
    }
    function onCard(card, node) {
      now += 2 / (24 * 60);
      const before = last;
      card.tags.forEach((t) => touch(p, t, WEIGHT, now));
      const changes = settleOnEvent(p, now);
      const d = decide(p, shared.region, now);
      last = d;
      flash(node, 'is-pulsed', 700);
      buckets.update(d.a, p, 650);
      changes.forEach((c) => buckets.flash(c.v, c.kind));
      balance.update(d.lambda, 650);
      store.setStatus(`The visitor ${card.story ? 'reads' : 'looks at'} ${cardPhrase(card)}, then comes back to the home page.`);
      clearTimeout(timer);
      timer = setTimeout(() => store.update(d, true), reduced ? 0 : 480);
      const words = card.tags.map((t) => VALUE[t].word);
      const lines = [{ tag: 'Click', text: `${card.name}: the ${listWords(words)} ${words.length > 1 ? 'buckets fill' : 'bucket fills'}.` }];
      changes.forEach((c) => lines.push(c.kind === 'entered'
        ? { tag: 'Entered', text: `${VALUE[c.v].name} passed its entry line, so the visitor now counts as interested.` }
        : { tag: 'Released', text: `${VALUE[c.v].name} fell below its release line, so the interest is let go.` }));
      card.tags.forEach((t) => {
        seen[t] = (seen[t] || 0) + 1;
        if (seen[t] === 2) lines.push({ tag: 'Cap', text: `Each extra ${VALUE[t].word} click adds a little less, so the bucket never overflows.` });
      });
      const moves = describeMoves(before.order, d.order);
      if (moves.length) moves.forEach((m) => lines.push({ tag: 'Next page', text: m }));
      else if (SECTION[d.order[0]].tags.some((t) => card.tags.indexOf(t) >= 0)) lines.push({ tag: 'Next page', text: `${SECTION[d.order[0]].start} already leads, and the click made its lead stronger.` });
      else lines.push({ tag: 'Next page', text: 'No section moved this time; the buckets are filling toward the next change.' });
      if (d.hero !== before.hero) lines.push({ tag: 'Hero', text: `The hero changes to ${heroTitle(d.hero)}, which matches the strongest interest.` });
      if (first) lines.push({ tag: 'Region', text: "The regional lean steps back as the visitor's own buckets fill." });
      first = false;
      receipt.add(lines);
      say.say(lines.map((l) => l.text).join(' '));
    }
    shared.subs.push(() => reset(false));
    reset(false);
  }

  // ---------- third move: relevance expires on its own ----------
  function sceneFade(live) {
    const DAYS_PER_SECOND = 1.6;
    const { inst, controls } = frame('fade');
    const who = el('p', 'sw-who', '');
    controls.appendChild(who);
    const go = button('sw-btn sw-btn--go', 'Start the clock', () => (running ? stop() : start()));
    go.setAttribute('aria-pressed', 'false');
    const stepBtn = button('sw-btn', 'Step forward', () => { stop(); advance(2, true); });
    const actions = el('div', 'sw-actions');
    actions.appendChild(go);
    actions.appendChild(stepBtn);
    actions.appendChild(button('sw-btn', 'Start over', () => reset(true)));
    controls.appendChild(actions);
    const meters = el('div', 'sw-meters sw-meters--sticky');
    const clock = Clock();
    const buckets = Buckets('fade');
    const balance = Balance();
    meters.appendChild(clock.root);
    meters.appendChild(buckets.root);
    meters.appendChild(balance.root);
    const store = Storefront({ clickable: false });
    const receipt = Receipt('What time changed');
    const say = Announcer();
    const stage = el('div', 'sw-stage');
    stage.appendChild(meters);
    stage.appendChild(store.root);
    inst.appendChild(stage);
    inst.appendChild(receipt.root);
    inst.appendChild(say.root);
    live.appendChild(inst);
    let p;
    let now;
    let running = false;
    let raf = 0;
    let lastT = 0;
    let lastOrder;
    let lastHero;
    let settled;
    let stranger;
    let v;
    function reset(animate) {
      stop();
      const r = REGIONS[shared.region];
      v = r.morning;
      p = newProfile();
      [-0.1, -0.05, 0].forEach((t) => { touch(p, v, WEIGHT, t); settleOnEvent(p, t); });
      now = 0;
      settled = false;
      stranger = decide(newProfile(), r.id, 0);
      const d = decide(p, r.id, now);
      lastOrder = d.order.slice();
      lastHero = d.hero;
      who.textContent = `A visitor from ${r.name}, who spent the morning on ${VALUE[v].word}`;
      store.setStatus('The home page the visitor would see at this moment.');
      store.update(d, animate);
      buckets.update(d.a, p, animate ? 400 : 0);
      balance.update(d.lambda, animate ? 400 : 0);
      clock.update(now, whenWords(now));
      go.disabled = false;
      stepBtn.disabled = false;
      receipt.set([{ tag: 'This morning', text: `The visitor looked at ${VALUE[v].word} a few times, and its bucket passed the entry line: interested in ${VALUE[v].word}.` }]);
      if (animate) say.say('Started over: this morning, the visitor is interested in ' + VALUE[v].word + '.');
    }
    function advance(dt, animate) {
      if (settled) return;
      now += dt;
      const r = REGIONS[shared.region];
      const out = settleOnTime(p, now);
      const d = decide(p, r.id, now);
      buckets.update(d.a, p, 0);
      balance.update(d.lambda, 0);
      const when = whenWords(now);
      clock.update(now, when);
      const lines = [];
      out.forEach((x) => {
        buckets.flash(x, 'released');
        lines.push({ tag: when, text: `Released from ${VALUE[x].word}: the bucket drained below its release line. Nobody wrote a rule; time did it.` });
      });
      if (d.order.join() !== lastOrder.join() || d.hero !== lastHero) {
        describeMoves(lastOrder, d.order).forEach((m) => lines.push({ tag: when, text: m }));
        if (d.hero !== lastHero) lines.push({ tag: when, text: d.hero === stranger.hero ? `The hero is ${heroTitle(d.hero)} again, the region's favorite.` : `The hero changes to ${heroTitle(d.hero)}.` });
        store.update(d, animate);
        lastOrder = d.order.slice();
        lastHero = d.hero;
      }
      const released = VALUES.every((x) => !p.member[x.id]);
      if (released && d.order.join() === stranger.order.join() && d.hero === stranger.hero) {
        settled = true;
        stop();
        go.disabled = true;
        stepBtn.disabled = true;
        lines.push({ tag: 'Settled', text: `The page matches a stranger's first page in ${r.name} again, and nobody wrote an expiration rule.` });
      }
      if (lines.length) {
        receipt.add(lines);
        say.say(lines.map((l) => l.text).join(' '));
      }
    }
    function tick(t) {
      if (!running) return;
      const dt = Math.min(0.1, Math.max(0, (t - lastT) / 1000));
      lastT = t;
      advance(dt * DAYS_PER_SECOND, true);
      if (running) raf = requestAnimationFrame(tick);
    }
    function start() {
      if (settled) return;
      running = true;
      go.textContent = 'Pause the clock';
      go.setAttribute('aria-pressed', 'true');
      lastT = performance.now();
      raf = requestAnimationFrame(tick);
    }
    function stop() {
      running = false;
      cancelAnimationFrame(raf);
      go.textContent = 'Start the clock';
      go.setAttribute('aria-pressed', 'false');
    }
    shared.subs.push(() => reset(false));
    reset(false);
  }

  // ---------- fourth move: the merchandiser keeps the wheel ----------
  function sceneWheel(live) {
    const { inst, controls } = frame('wheel');
    const who = el('p', 'sw-who', '');
    controls.appendChild(who);
    let into = 'rain';
    let pin = false;
    let gate = false;
    const seg = Segmented('The visitor is into', ['rain', 'knit', 'linen'].map((k) => ({ id: k, name: VALUE[k].name })), into, (id) => { into = id; render(true, 'into'); });
    controls.appendChild(seg.root);
    const rules = el('div', 'sw-rules');
    rules.appendChild(Toggle('Pin the partner spotlight first', (on) => { pin = on; render(true, 'pin'); }));
    rules.appendChild(Toggle('Gate: hide anything out of stock', (on) => { gate = on; render(true, 'gate'); }));
    controls.appendChild(rules);
    const store = Storefront({ clickable: false, showStock: true });
    const receipt = Receipt('Rules first, then interest');
    const compare = el('div', 'sw-compare');
    const shows = el('div', 'sw-compare-col');
    shows.appendChild(el('p', 'sw-compare-head', 'The page shows'));
    const showsList = el('ol', 'sw-compare-list');
    shows.appendChild(showsList);
    const alone = el('div', 'sw-compare-col');
    alone.appendChild(el('p', 'sw-compare-head', 'Interest alone would rank'));
    const aloneList = el('ol', 'sw-compare-list');
    alone.appendChild(aloneList);
    compare.appendChild(shows);
    compare.appendChild(alone);
    receipt.root.appendChild(compare);
    const say = Announcer();
    inst.appendChild(store.root);
    inst.appendChild(receipt.root);
    inst.appendChild(say.root);
    live.appendChild(inst);
    function fill(listEl, order, pinned) {
      listEl.replaceChildren(...order.map((id) => {
        const li = el('li', SECTION[id].partner ? 'is-partner' : '', SECTION[id].title);
        if (pinned === id) li.appendChild(el('span', 'sw-compare-pin', 'pinned'));
        return li;
      }));
    }
    function render(animate, what) {
      const r = REGIONS[shared.region];
      const p = newProfile();
      [-0.1, -0.05, 0].forEach((t) => { touch(p, into, WEIGHT, t); settleOnEvent(p, t); });
      const d = decide(p, r.id, 0, { pin: pin ? 'partner' : null, gate });
      who.textContent = `A visitor from ${r.name}, into ${VALUE[into].word}`;
      store.setStatus(pin || gate ? "The home page, with the brand's rules applied first." : 'The home page, ranked by interest alone.');
      store.update(d, animate);
      const jacketAt = d.cardsByInterest.rain.indexOf('jacket');
      const partnerAt = d.interestOrder.indexOf('partner');
      const lines = [];
      lines.push(gate
        ? { tag: 'Gate', text: `The waxed field jacket is out of stock, so it never appears. Interest alone would have shown it ${ORDINAL[jacketAt]} in Rain-ready layers.` }
        : { tag: 'Gate', text: 'No gate is set, so the out-of-stock jacket still shows.' });
      lines.push(pin
        ? { tag: 'Pin', text: `The partner spotlight holds the first section. Ranking was skipped for it: an instruction, not a decision. Interest alone would have placed it ${ORDINAL[partnerAt]}${partnerAt === 0 ? ' too' : ''}.` }
        : { tag: 'Pin', text: `No pin is set, so the partner spotlight sits where interest puts it: ${ORDINAL[partnerAt]}.` });
      lines.push({ tag: 'Ranking', text: pin ? "Every other section follows the visitor's interest, around the pin." : "Every section follows the visitor's interest." });
      receipt.set(lines);
      receipt.root.appendChild(compare);
      fill(showsList, d.order, d.pin);
      fill(aloneList, d.interestOrder, null);
      if (animate) {
        const lead = what === 'pin' ? lines[1].text : what === 'gate' ? lines[0].text : `The visitor is into ${VALUE[into].word}. The page shows ${d.order.map((id) => SECTION[id].title).join(', ')}.`;
        say.say(lead);
      }
    }
    shared.subs.push(() => render(false));
    render(false);
  }

  // ---------- start ----------
  const SCENES = { local: sceneLocal, click: sceneClick, fade: sceneFade, wheel: sceneWheel };
  Array.prototype.forEach.call(doc.querySelectorAll('figure.sw-figure[data-scene]'), (fig) => {
    const build = SCENES[fig.getAttribute('data-scene')];
    const live = fig.querySelector('.sw-live');
    const still = fig.querySelector('.sw-static');
    if (!build || !live) return;
    build(live);
    live.hidden = false;
    if (still) still.hidden = true;
    const howto = fig.parentNode.querySelector('.sw-howto');
    if (howto) howto.hidden = false;
  });
  doc.documentElement.classList.add('sw-ready');
})();
