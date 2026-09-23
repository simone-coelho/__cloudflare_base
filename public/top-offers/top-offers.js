/* public/top-offers/top-offers.js
 * Lantern & Lane — the QVC four-container module, driven by the engine.
 *
 * TWO RULES THIS FILE EXISTS TO KEEP.
 *
 * 1. THE PAGE NEVER RANKS. There is no sorting, scoring or choosing here. The
 *    page sends events and asks a question, and renders whatever comes back in
 *    the order it comes back. If the engine cannot answer, it says so on screen
 *    and shows the site's own defaults. A demo that quietly ranks in the browser
 *    is the thing we are selling against.
 *
 * 2. THE CAUSE IS VISIBLE. A director button that says "they browsed kitchen"
 *    only ASSERTS the cause; the room has to take it on trust, and at that point
 *    a screenshot would do the same job. So the shopper's beats are not
 *    descriptions — the cursor glides to a real control, ripples, and fires that
 *    control's own handler. A department page loads because a nav button was
 *    clicked. The event goes out because the page loaded. The module changes
 *    because the next snapshot answered differently. The room watches each link
 *    in that chain, and "This session" writes down every action as it lands.
 *
 * The shopper acts on the page. The MERCHANDISER acts through a marked press,
 * because that is a different person doing a different job — publishing an
 * offer, swapping a creative, turning the promotion dial.
 *
 * Routes, all driven and asserted by scripts/rehearse-top-offers-page.mjs, with
 * this whole file then executed beat by beat by rehearse-top-offers-dom.mjs:
 *
 *   POST /v1/:tenant/identity/session          mint the shopper capability
 *   POST /realtime/session/preferences         their explicit consent choice
 *   POST /realtime/action                      behaviour, and the click reward
 *   GET  /v1/:tenant/decisions/snapshot        the four, with their receipts
 *   GET/PUT /content/:kind, /config/reflex     the merchandiser's publishes
 */
(() => {
  'use strict';

  const TENANT = 'shn';
  const SLOT = 'top-offers';
  const PAGE = 'home';
  const SOURCE = 'lantern-top-offers';

  const $ = (id) => document.getElementById(id);
  const el = {
    four: $('four'), pool: $('pool'), poolCount: $('poolCount'), vectors: $('vectors'),
    drivers: $('drivers'), whyHead: $('whyHead'), journey: $('journey'),
    beatNo: $('beatNo'), engineLine: $('engineLine'), presses: $('presses'), status: $('status'),
    engineDown: $('engineDown'), textSize: $('textSize'), tokenBtn: $('tokenBtn'),
    cursor: $('demo-cursor'), mastnav: $('mastnav'), ghosts: $('ghosts'), deltas: $('deltas'), weather: $('weather'),
    beforeRow: $('beforeRow'), beforeFour: $('beforeFour'), nowLabel: $('nowLabel'),
    directorHandle: $('directorHandle'), nextBeat: $('nextBeat'), nextLabel: $('nextLabel'),
    pdBack: $('pdBack'), pdMode: $('pdMode'), pdDone: $('pdDone'), pdAct: $('pdAct'), pdArith: $('pdArith'),
    pdWill: $('pdWill'), pdWhyWrap: $('pdWhyWrap'), pdWhy: $('pdWhy'), pdMapNow: $('pdMapNow'),
    pdMapAfter: $('pdMapAfter'), pdGo: $('pdGo'), pdPill: $('pdPill'), pdNote: $('pdNote'),
    pdWhyHead: $('pdWhyHead'), explainBtn: $('explainBtn'), pdNow: $('pdNow'),
    reportBody: $('reportBody'), buildReport: $('buildReport'), banner: $('banner'),
    topOffersModule: $('topOffersModule'), moduleWhere: $('moduleWhere'),
    viewHome: $('viewHome'), viewCategory: $('viewCategory'), viewProduct: $('viewProduct'),
    catTitle: $('catTitle'), catSub: $('catSub'), catGrid: $('catGrid'), catCrumbs: $('catCrumbs'),
    pdpCrumbs: $('pdpCrumbs'), pdpImage: $('pdpImage'), pdpBrand: $('pdpBrand'), pdpTitle: $('pdpTitle'),
    pdpItem: $('pdpItem'), pdpPrice: $('pdpPrice'), pdpPays: $('pdpPays'), pdpBullets: $('pdpBullets'),
    pdpAdd: $('pdpAdd'),
  };

  const state = { shopper: null, catalog: null, shop: null, anchor: null, order: [], busy: false,
    beat: null, lastDecisions: null, modulePos: 2, take: 4, journey: [], previous: null, current: null, pages: 0, weather: null, region: 'US-WA', showBefore: false };

  const say = (t, tone) => { el.status.textContent = t; el.status.dataset.tone = tone || ''; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = (n) => (n == null ? '' : `$${Number(n).toFixed(2)}`);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const sdkKey = (document.querySelector('meta[name="edge-sdk-key"]') || {}).content || 'demo-site';

  // ── Transport ─────────────────────────────────────────────────────────────
  async function api(path, payload, extra) {
    const headers = { 'X-SDK-Key': sdkKey, 'Content-Type': 'application/json', 'X-Tenant': TENANT, ...(extra || {}) };
    if (state.shopper) headers['X-Shopper-Session'] = state.shopper.capability;
    const res = await fetch(path, { method: payload === undefined ? 'GET' : 'POST', headers,
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
    return { status: res.status, ok: res.ok, body: await res.json().catch(() => ({})) };
  }

  let merchandiser = '';
  const storedToken = () => { try { return (sessionStorage.getItem('tuning-token') || '').trim(); } catch { return ''; } };

  /**
   * The operator headers, attached HERE rather than left to edge-auth.js, which
   * deliberately never signs a GET (public/edge-auth.js:52). A publish has to
   * READ the current revision and publication digest before it can write against
   * them, and that read is an operator read like any other.
   */
  const operatorHeaders = (extra) => ({ 'X-Tenant': TENANT,
    ...(merchandiser ? { Authorization: `Bearer ${merchandiser}` } : {}), ...(extra || {}) });

  async function adoptLocalToken() {
    if (!merchandiser) merchandiser = storedToken();
    if (!merchandiser) {
      try {
        const res = await fetch('beats/operator.local.json', { cache: 'no-store' });
        if (res.ok) {
          const body = await res.json();
          if (body && typeof body.token === 'string' && body.token.trim()) {
            merchandiser = body.token.trim();
            try { sessionStorage.setItem('tuning-token', merchandiser); } catch { /* private window */ }
          }
        }
      } catch { /* no local token; the sign-in button is the other way in */ }
    }
    if (!merchandiser) return 'none';
    const probe = await fetch(`/content/catalog?scope=${TENANT}`, { headers: operatorHeaders() });
    return probe.ok ? 'ok' : `refused (${probe.status})`;
  }

  const fetchJson = (name) => fetch(name, { cache: 'no-store' }).then((r) => {
    if (!r.ok) throw new Error(`${name} is missing — run scripts/seed-shn.mjs`);
    return r.json();
  });
  const fetchDoc = (name) => fetchJson(`beats/${name}.json`);

  async function publish(kind, document_, note_) {
    const path = kind === 'reflex' ? '/config/reflex' : `/content/${kind}`;
    const url = `${path}?scope=${TENANT}`;
    const read = await fetch(url, { headers: operatorHeaders() });
    if (read.status === 401 || read.status === 403) {
      throw new Error('the merchandiser is not signed in — run scripts/seed-shn.mjs, or use Merchandiser sign-in');
    }
    const base = await read.json().catch(() => null);
    if (!read.ok || !base || base.ok === false) throw new Error((base && base.error) || `could not read the current ${kind}`);
    if (!base.publication) throw new Error(`the ${kind} document has no publication base`);
    const res = await fetch(url, { method: 'PUT',
      headers: operatorHeaders({ 'content-type': 'application/json',
        'If-Match': `"${base.revision}/${base.publication.revision}/${base.publication.digest}"`,
        'Idempotency-Key': `${base.revision}:${crypto.randomUUID()}` }),
      body: JSON.stringify(kind === 'reflex' ? { config: document_, note: note_ } : { document: document_, note: note_ }) });
    if (res.status === 401 || res.status === 403) {
      throw new Error('the merchandiser is not signed in — run scripts/seed-shn.mjs, or use Merchandiser sign-in');
    }
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || body.ok !== true) throw new Error((body && body.error) || `publishing the ${kind} failed`);
    return body.revision;
  }

  // ── This session, written down as it happens ───────────────────────────────
  function note(verb, what, detail) {
    state.journey.push({ verb, what, detail });
    renderJourney();
  }
  function renderJourney() {
    if (!state.journey.length) {
      el.journey.innerHTML = '<li class="journey-empty">Nobody has arrived yet.</li>';
      return;
    }
    el.journey.innerHTML = state.journey.map((j, i) => {
      const cls = j.verb === 'opened' ? ' verb--opened'
        : (j.verb === 'published' || j.verb === 'tuned') ? ' verb--merch' : '';
      const fresh = i === state.journey.length - 1 ? ' class="fresh"' : '';
      return `<li${fresh}><span class="verb${cls}">${esc(j.verb)}</span>
        <span class="what">${esc(j.what)}${j.detail ? `<em>${esc(j.detail)}</em>` : ''}</span></li>`;
    }).join('');
  }

  /**
   * A brand-new visitor and their explicit consent choice. The engine refuses to
   * personalize — and refuses to retain a single behavioural event — until an
   * owner-issued consent record exists. Not a detail to hide: it is the answer
   * to the first question their privacy team will ask.
   */
  async function newVisitor() {
    state.shopper = null;
    state.journey = [];
    state.previous = null;
    state.current = null;
    state.pages = 0;
    state.weather = null;
    lastVector = {};
    renderJourney();
    const { body } = await api(`/v1/${TENANT}/identity/session`, {});
    if (!body || !body.session) throw new Error('the engine did not mint a shopper session');
    state.shopper = body.session;
    const s = state.shopper;
    const { body: pref } = await api('/realtime/session/preferences', {
      userId: s.subject, trackingConsent: true, personalizationEnabled: true,
      choice: { id: crypto.randomUUID().replace(/-/g, ''), expectedRevision: null, grantId: s.grantId, iat: s.iat, exp: s.exp },
    });
    if (!pref || !pref.consent || !pref.consent.personalization) throw new Error('the visitor did not grant consent');
    note('arrived', 'A new visitor', 'anonymous · consent granted');
    return s;
  }

  // ── The events. Sent BECAUSE a real control was clicked. ──────────────────
  const sendView = (type, data) => api('/realtime/action', {
    userId: state.shopper.subject, sessionId: state.shopper.sessionId, source: SOURCE, type, data,
  });

  // ── Views ─────────────────────────────────────────────────────────────────
  function show(view) {
    el.viewHome.hidden = view !== 'home';
    el.viewCategory.hidden = view !== 'category';
    el.viewProduct.hidden = view !== 'product';
  }

  const productsIn = (category) => (state.shop ? state.shop.products.filter((p) => p.category === category) : []);
  const productById = (id) => (state.shop ? state.shop.products.find((p) => p.id === id) : null);

  function renderNav() {
    if (!state.shop) return;
    el.mastnav.innerHTML = state.shop.categories
      .map((c) => `<button type="button" data-category="${esc(c)}">${esc(c)}</button>`).join('');
  }

  const starRow = (p) => (p.rating
    ? `<span class="stars" aria-label="${p.rating} of 5">${'★'.repeat(Math.round(p.rating))}${'☆'.repeat(5 - Math.round(p.rating))}<small>${p.reviews}</small></span>`
    : '');

  /**
   * The Contextual Banner — Garrett's second use case, in their words: "a single
   * container which generally only has a single piece of content… only displays
   * on specific page types such as category and search pages… it should NOT
   * display to NEW customers."
   *
   * That last clause is the inverse of the Top Offers gate, and it is the more
   * interesting half: Top Offers falls back to defined content for a stranger,
   * the banner shows NOTHING at all. Both are the same rule read in opposite
   * directions, and the page says which one is running.
   */
  async function renderBanner(page) {
    if (!el.banner) return;
    const limit = state.anchor ? state.anchor.personalizeAfterPages : 5;
    if (state.pages < limit) {
      el.banner.hidden = false;
      el.banner.innerHTML = `<div class="banner-held" style="grid-column:1/-1">
        <b>The Contextual Banner is holding back.</b> Garrett&rsquo;s rule: it does not show to a new customer at all.
        This visitor has seen <b>${state.pages}</b> page${state.pages === 1 ? '' : 's'} of the
        <b>${limit}</b> the rule requires, so the container stays empty rather than falling back to defaults \u2014
        the opposite of what Top Offers does for a stranger.</div>`;
      return;
    }
    const q = new URLSearchParams({ page });
    if (state.region) q.set('ctx.region', state.region);
    if (state.weather) q.set('ctx.weather', state.weather);
    const { ok: fine, body } = await api(`/v1/${TENANT}/decisions/snapshot?${q}`);
    const d = (fine && body && Array.isArray(body.decisions)) ? body.decisions[0] : null;
    if (!d) { el.banner.hidden = true; el.banner.innerHTML = ''; return; }
    const piece = pieceOf(d.customerContentId);
    const tags = (piece && piece.tags && piece.tags.offerType) || [];
    const label = tags[tags.length - 1] || '';
    el.banner.hidden = false;
    el.banner.innerHTML = `
      <div class="frame">
        ${piece && piece.renderUrl ? `<img src="${esc(piece.renderUrl)}" alt="" loading="lazy">` : ''}
        <span class="badge ${badgeClass(label)}">${esc(label)}</span>
      </div>
      <div class="bbody">
        <p class="btitle">${esc(piece ? piece.title : d.customerContentId)}</p>
        <p class="bblurb">${esc((piece && piece.subtitle) || '')}</p>
        <button class="cta" type="button" data-content="${esc(d.contentId)}">Shop Now</button>
        <p class="receipt">one container &middot; slot <b>${esc(d.slot)}</b> &middot; score ${Number(d.score).toFixed(3)}</p>
      </div>`;
  }

  /** A department page. Landing on it IS the page view — that is the whole point. */
  async function openCategory(category) {
    const items = productsIn(category);
    el.catTitle.textContent = category;
    el.catSub.textContent = `${items.length} items · ${[...new Set(items.map((p) => p.subcategory))].length} departments`;
    el.catCrumbs.innerHTML = '<a data-nav="home">Home</a><span>›</span><span>' + esc(category) + '</span>';
    el.catGrid.innerHTML = items.map((p) => `<button class="tile" type="button" data-product="${esc(p.id)}">
      <span class="shot"><img src="${esc(p.image)}" alt="" loading="lazy"></span>
      <span class="tbody">
        <span class="tbrand">${esc(p.brand)}</span>
        <span class="tname">${esc(p.name)}</span>
        <span class="price"><span class="now">${money(p.price)}</span><span class="was">was ${money(p.was)}</span></span>
        ${starRow(p)}
      </span></button>`).join('');
    Array.from(el.mastnav.children).forEach((b) => b.setAttribute('aria-current', String(b.dataset.category === category)));
    show('category');
    const first = items[0];
    await sendView('page_view', { category, ...(first ? { subcategory: first.subcategory } : {}) });
    state.pages += 1;
    note('viewed', category, `department page \u00b7 lifetime page ${state.pages}`);
    await renderVectors();   // the signal is visible the moment it is sent
    await renderBanner('category');
    renderPending(`On ${category}`);
  }

  /** A product page. Opening it IS the product view. */
  async function openProduct(id) {
    const p = productById(id);
    if (!p) return;
    el.pdpCrumbs.innerHTML = '<a data-nav="home">Home</a><span>›</span><a data-category="'
      + esc(p.category) + '">' + esc(p.category) + '</a><span>›</span><span>' + esc(p.subcategory) + '</span>';
    el.pdpImage.src = p.image;
    el.pdpBrand.textContent = p.brand;
    el.pdpTitle.textContent = p.name;
    el.pdpItem.textContent = `Item # ${p.id}`;
    el.pdpPrice.innerHTML = `<span class="now">${money(p.price)}</span><span class="was">was ${money(p.was)}</span>`;
    el.pdpPays.textContent = p.pays || '';
    el.pdpBullets.innerHTML = (p.bullets || []).map((b) => `<li>${esc(b)}</li>`).join('');
    el.pdpAdd.dataset.product = p.id;
    show('product');
    await sendView('product_view', { productId: p.id, category: p.category, subcategory: p.subcategory,
      brand: p.brand, price_usd: p.price });
    state.pages += 1;
    note('opened', p.name, `${p.brand} \u00b7 ${p.subcategory} \u00b7 lifetime page ${state.pages}`);
    await renderVectors();
    renderPending(`Reading ${p.name}`);
  }

  /** Home. Asking for the module is the only thing that changes it. */
  async function openHome(quiet, counts) {
    show('home');
    Array.from(el.mastnav.children).forEach((b) => b.setAttribute('aria-current', 'false'));
    // Jamie's rule counts pages on the website, and the homepage is a page.
    if (counts !== false) state.pages += 1;
    if (!quiet) note('returned', 'Homepage', `the module is asked again \u00b7 lifetime page ${state.pages}`);
    await refresh();
  }

  // ── The module ────────────────────────────────────────────────────────────
  /**
   * Jamie: "We would use static, defined content until the customer interacts
   * with ideally 5+ pages on the website (in their lifetime), to then trigger
   * personalized content."
   *
   * The engine has no `personalizeAfter` dial yet, so THE PAGE enforces their rule
   * and says so on screen. It is the honest arrangement: their defined defaults
   * are served, unchanged, until the count clears — and the moment it does, the
   * page stops substituting and shows exactly what the engine returned.
   */
  const gateHeld = () => state.pages < (state.anchor ? state.anchor.personalizeAfterPages : 5);

  function defaultFour() {
    const ids = (state.anchor && state.anchor.defaults) || [];
    return ids.map((id, i) => ({ customerContentId: id, contentId: id.toLowerCase().replace(/-/g, '_'),
      order: i, score: 0, strategy: 'default', explain: { drivers: [] } }));
  }

  async function refresh() {
    const q = new URLSearchParams({ page: PAGE });
    if (state.region) q.set('ctx.region', state.region);
    if (state.weather) q.set('ctx.weather', state.weather);
    const { ok, body } = await api(`/v1/${TENANT}/decisions/snapshot?${q}`);
    if (!ok || !body || !Array.isArray(body.decisions)) {
      engineDown((body && body.error) || 'the decision service did not answer');
      return;
    }
    engineUp();
    state.lastDecisions = gateHeld() ? defaultFour() : body.decisions;
    render(state.lastDecisions, gateHeld());
  }

  function engineDown(message) {
    el.engineDown.hidden = false;
    el.engineDown.textContent = `The module is showing the site's own defaults: ${message}. `
      + 'Nothing on this page ranks offers in the browser, so there is nothing to show instead.';
    el.four.setAttribute('aria-busy', 'false');
  }
  const engineUp = () => { el.engineDown.hidden = true; };

  const pieceOf = (id) => ((state.catalog && state.catalog.pieces) || [])
    .find((p) => p.customerContentId === id || p.id === id) || null;
  const badgeClass = (label) => (/lantern pick/i.test(label) ? 'badge--daily'
    : /clearance|just reduced/i.test(label) ? 'badge--sale' : '');

  /**
   * What this press did to the module, as a diff the room can read. Entered,
   * left (and whether its window closed or it was simply outranked), moved up,
   * moved down, or the same piece wearing new creative. When nothing moved, it
   * says nothing moved and why — a module that silently stays put is
   * indistinguishable from a broken one.
   */
  function diff(before, after) {
    if (!before) return [{ sign: '·', cls: 'in', what: 'The opening four', why: 'the first view of the module' }];
    const out = [];
    const beforeIds = before.map((b) => b.id);
    const afterIds = after.map((a) => a.id);
    const pieces = (state.catalog && state.catalog.pieces) || [];
    const now = Date.now();
    const byId = new Map(pieces.map((p) => [p.customerContentId, p]));
    // Why a piece left matters more than that it left. Three different reasons,
    // and calling a rule failure "outranked" would be a lie the room could not
    // catch: its window closed, its rule stopped holding, or it simply lost.
    const wentWhy = (id) => {
      const piece = byId.get(id);
      if (!piece) return 'left the pool entirely';
      if (Date.parse(piece.window.to) <= now) return 'its window closed';
      if (piece.eligibleWhen) return 'its rule no longer holds';
      return 'outranked';
    };
    before.forEach((b, i) => {
      if (afterIds.includes(b.id)) return;
      out.push({ sign: '−', cls: 'out', what: b.title, why: `left container ${i + 1} · ${wentWhy(b.id)}` });
    });
    after.forEach((a, i) => {
      const was = beforeIds.indexOf(a.id);
      if (was === -1) { out.push({ sign: '+', cls: 'in', what: a.title, why: `entered at container ${i + 1}` }); return; }
      if (before[was].title !== a.title || before[was].art !== a.art) {
        out.push({ sign: '⟳', cls: 'swap', what: a.title, why: 'same content id, new creative — its learning is untouched' });
      }
      if (was > i) out.push({ sign: '↑', cls: 'up', what: a.title, why: `container ${was + 1} → ${i + 1}` });
      else if (was < i) out.push({ sign: '↓', cls: 'down', what: a.title, why: `container ${was + 1} → ${i + 1}` });
    });
    return out;
  }

  /**
   * The previous four, at the SAME size as the current four and directly above
   * them. Thumbnails in a side strip are not a comparison; two rows of the same
   * card are. Kept behind a press so the module is not permanently doubled.
   */
  function renderBeforeRow() {
    if (!el.beforeRow) return;
    const before = state.previous;
    const on = state.showBefore && before && before.length;
    el.beforeRow.hidden = !on;
    el.nowLabel.hidden = !on;
    if (!on) { el.beforeFour.innerHTML = ''; return; }
    el.beforeFour.innerHTML = before.map((b) => {
      const piece = pieceOf(b.id);
      const tags = (piece && piece.tags && piece.tags.offerType) || [];
      const label = tags[tags.length - 1] || '';
      return `<article class="promo">
        <div class="frame">
          ${b.art ? `<img src="${esc(b.art)}" alt="" loading="lazy">` : ''}
          <span class="badge ${badgeClass(label)}">${esc(label)}</span>
        </div>
        <div class="pbody"><h3 class="ptitle">${esc(b.title)}</h3></div></article>`;
    }).join('');
  }

  function renderChanges(before, after) {
    el.ghosts.innerHTML = before && before.length
      ? before.map((b, i) => `<span class="ghost">${b.art ? `<img src="${esc(b.art)}" alt="">` : ''}<span class="ghost-n">${i + 1}</span></span>`).join('')
        + `<span class="ghost-hint">${state.showBefore ? 'Hide the before row' : 'Show it full size, above'}</span>`
      : '<span class="ghost-empty">The visitor had not seen the module yet.</span>';
    // The gate is the state of the module, whether or not anything moved, so it
    // is reported before the diff. Otherwise the opening screen shows "the
    // opening four" and never says WHY those four and not a decision.
    if (gateHeld()) {
      const limit = state.anchor ? state.anchor.personalizeAfterPages : 5;
      const need = Math.max(0, limit - state.pages);
      el.deltas.innerHTML = `<li class="delta-none">The module is holding <b>QVC&rsquo;s four defined promotions</b> \u2014 `
        + `static content, served to everyone. ${state.pages === 0
          ? `Nothing has been personalised because nobody has browsed yet.`
          : `The visitor has seen <b>${state.pages}</b> page${state.pages === 1 ? '' : 's'}.`} `
        + `Personalisation is released at <b>${limit}</b>, so ${need} to go.</li>`;
      return;
    }
    const rows = diff(before, after);
    if (!rows.length) {
      const top = topSignal();
      el.deltas.innerHTML = `<li class="delta-none">Nothing moved in the module.${top
        ? ` The strongest signal is <b>${esc(top.value)}</b> at <b>${top.a.toFixed(2)}</b>, ${top.a >= 0.6
          ? 'past the 0.60 entry threshold — the offers the visitor has earned are already being served.'
          : 'still under the 0.60 entry threshold.'}`
        : ' The visitor has sent no signal yet.'}</li>`;
      return;
    }
    el.deltas.innerHTML = rows.map((r) => `<li><span class="sign sign--${r.cls}">${r.sign}</span>
      <span><b>${esc(r.what)}</b> <em>${r.why}</em></span></li>`).join('');
  }

  function render(decisions, held) {
    const previousOrder = state.order;
    const after = decisions.map((d) => {
      const p = pieceOf(d.customerContentId);
      return { id: d.customerContentId, title: p ? p.title : d.customerContentId, art: p ? p.renderUrl : '' };
    });
    // What was on screen until this press becomes the "before"; what came back
    // becomes the "now". Assigned here, once, so every reader downstream —
    // the diff, the ghost strip and the full-size before row — agrees.
    state.previous = state.current;
    state.current = after;

    const moves = {};
    if (state.previous) {
      const beforeIds = state.previous.map((b) => b.id);
      after.forEach((a, i) => {
        const was = beforeIds.indexOf(a.id);
        if (was === -1) moves[a.id] = { cls: 'in', text: 'new' };
        else if (state.previous[was].title !== a.title || state.previous[was].art !== a.art) moves[a.id] = { cls: 'swap', text: 'new creative' };
        else if (was > i) moves[a.id] = { cls: 'up', text: `\u2191${was - i}` };
        else if (was < i) moves[a.id] = { cls: 'down', text: `\u2193${i - was}` };
      });
    }
    renderChanges(state.previous, after);
    renderBeforeRow();
    el.four.setAttribute('aria-busy', 'false');
    // Their card: an editorial frame with the badge ON it, a promotion title,
    // one Shop Now. No price, no strikethrough, no rating, no Add to Cart.
    el.four.innerHTML = decisions.map((d, i) => {
      const p = pieceOf(d.customerContentId);
      const tags = (p && p.tags && p.tags.offerType) || [];
      const label = tags[tags.length - 1] || '';
      const entered = previousOrder[i] !== d.customerContentId;
      const mv = moves[d.customerContentId];
      const pinned = d.strategy === 'tenant-pinned';
      return `<article class="promo${entered ? ' promo--entered' : ''}">
        ${mv ? `<span class="delta-chip delta-chip--${mv.cls}">${esc(mv.text)}</span>` : ''}
        <div class="frame">
          ${p && p.renderUrl ? `<img src="${esc(p.renderUrl)}" alt="" loading="lazy">`
            : '<span class="missing">creative not generated</span>'}
          <span class="badge ${badgeClass(label)}">${esc(label)}</span>
        </div>
        <div class="pbody">
          <h3 class="ptitle">${esc(p ? p.title : d.customerContentId)}</h3>
          <p class="pblurb">${esc((p && p.subtitle) || '')}</p>
          <button class="cta" type="button" data-content="${esc(d.contentId)}" data-decision="${esc(d.decisionId || '')}">Shop Now</button>
          <p class="receipt">${held ? `QVC-defined default ${i + 1} of 4`
            : pinned ? 'pinned \u00b7 ranking skipped'
            : `rank ${i + 1} \u00b7 score ${Number(d.score).toFixed(3)}`}</p>
        </div></article>`;
    }).join('');
    state.order = decisions.map((d) => d.customerContentId);
    renderDrivers(decisions);
    renderPool();
    void renderVectors();
  }

  /**
   * The meters, read from THE VISITOR'S PROFILE rather than from the cards on screen.
   *
   * They used to be derived from the served decisions' drivers, which meant a
   * dimension only appeared once an offer carrying it happened to be served —
   * so their cook affinity was invisible for the first three beats, and the room
   * watched their browse with nothing moving. The signal must be visible the
   * moment it is sent, whether or not it has changed the module yet. That gap
   * is the most important thing the demo has to teach.
   */
  let lastVector = {};
  async function renderVectors() {
    if (!state.shopper) return;
    const { body } = await api('/realtime/reflex');
    const dims = (body && body.affinity && body.affinity.dims) || {};
    lastVector = dims;
    const rows = [];
    for (const [dim, values] of Object.entries(dims)) {
      for (const [value, a] of Object.entries(values)) rows.push({ dim, value, a: Number(a) || 0 });
    }
    rows.sort((x, y) => y.a - x.a);
    el.vectors.innerHTML = rows.length ? rows.slice(0, 7).map((r) => `<div class="vecrow">
      <div class="vectop"><span>${esc(r.value)} <em style="color:var(--muted);font-style:normal">${esc(r.dim)}</em></span><b>${r.a.toFixed(2)}</b></div>
      <div class="track"><span class="fill${r.a >= 0.6 ? ' fill--over' : ''}" style="width:${Math.min(100, r.a * 100)}%"></span>
        <span class="thresh"></span></div></div>`).join('')
      : '<p class="thin-note">No dimension has evidence yet.</p>';
  }

  /**
   * While the visitor is off the homepage the module has not been ASKED again, so the
   * strip must say that rather than keep the previous press's message on screen.
   * Signal accumulating, module not yet re-asked: that distinction is the whole
   * mechanism, and leaving a stale line there is what makes a beat look dead.
   */
  function renderPending(action) {
    const top = topSignal();
    el.deltas.innerHTML = `<li class="delta-none">${esc(action)} — the homepage module has not been asked again yet.${
      top ? ` The strongest signal is now <b>${esc(top.value)}</b> at <b>${top.a.toFixed(2)}</b>, ${
        top.a >= 0.6 ? 'past the 0.60 entry threshold.' : 'still under the 0.60 entry threshold.'}` : ''}</li>`;
  }

  /** Their single strongest signal, for the "nothing moved, and here is why" line. */
  function topSignal() {
    let best = null;
    for (const values of Object.values(lastVector)) {
      for (const [value, a] of Object.entries(values)) {
        if (!best || Number(a) > best.a) best = { value, a: Number(a) };
      }
    }
    return best;
  }

  function renderDrivers(decisions) {
    el.drivers.innerHTML = decisions.map((d, i) => {
      const p = pieceOf(d.customerContentId);
      const drivers = (d.explain && d.explain.drivers) || [];
      const lines = drivers.map((x) => `${esc(x.dim)} ${esc(x.value)} <b>${(Number(x.a) * Number(x.weight)).toFixed(3)}</b>`);
      if (d.explain && d.explain.note) lines.push(esc(d.explain.note));
      if (d.explain && d.explain.diversity && d.explain.diversity.sentence) lines.push(esc(d.explain.diversity.sentence));
      if (!lines.length) lines.push('no dimension has evidence &middot; ranked on freshness, the same for every visitor');
      return `<div class="drv"><div class="drvtop"><span class="pos">${i + 1}</span>
        <span class="drvname">${esc(p ? p.title : d.customerContentId)}</span></div>
        <div class="drvline">${lines.join('<br>')}</div></div>`;
    }).join('');
  }

  function renderPool() {
    const pieces = (state.catalog && state.catalog.pieces) || [];
    const now = Date.now();
    const served = new Set(state.order);
    el.poolCount.textContent = pieces.filter((p) => Date.parse(p.window.to) > now).length;
    el.pool.innerHTML = pieces.map((p) => {
      const open = Date.parse(p.window.from), close = Date.parse(p.window.to);
      const tags = (p.tags && p.tags.offerType) || [];
      const label = tags[tags.length - 1] || '';
      // Which container it is in, said as a number on the card, in a colour
      // that means chosen. A dark outline reads as focus, not as selection.
      const at = state.order.indexOf(p.customerContentId);
      let cls = 'pchip', state_ = 'live', slot = '';
      if (close <= now) { cls += ' pchip--expired'; state_ = 'expired'; }
      else if (p.eligibleWhen) {
        // A gated piece has been in the published pool the whole time and
        // nobody has seen it. Saying so is the beat.
        cls += ' pchip--gated';
        state_ = at > -1 ? 'rule met' : 'held by a rule';
        slot = at > -1 ? `<span class="slotno slotno--gated">position ${at + 1}</span>` : '';
      } else if (at > -1) { cls += ' pchip--served'; state_ = 'in the four'; }
      else if (now - open < 10 * 60 * 1000) { cls += ' pchip--new'; state_ = 'new today'; }
      if (at > -1 && !slot) slot = `<span class="slotno">position ${at + 1}</span>`;
      if (tags.some((t) => /lantern pick/i.test(t))) state_ = at > -1 ? `the pick \u00b7 position ${at + 1}` : 'the pick';
      if (/^final hours/i.test(p.title)) state_ = at > -1 ? `final hours \u00b7 position ${at + 1}` : 'final hours';
      return `<div class="${cls}">
        <div class="frame">
          ${p.renderUrl ? `<img src="${esc(p.renderUrl)}" alt="" loading="lazy">` : ''}
          <span class="badge ${badgeClass(label)}">${esc(label)}</span>
          ${slot}
        </div>
        <div class="cbody"><div class="cn">${esc(p.title)}</div><div class="state">${esc(state_)}</div></div>
      </div>`;
    }).join('');
  }

  /**
   * What the module has learned today, read from the ledger — not from anything
   * this page is holding. Jamie's metric is clicks into the module, so that is
   * what the report counts: exposures and credited clicks per promotion, and the
   * rate between them.
   *
   * The two lines under it are not editorial. `attributionContract` and
   * `measurement.kind` are fields the engine writes into its own report, and it
   * labels its output `attribution_diagnostic` with `inference: unavailable`.
   * We say "attribution, not incrementality" because the engine says it first.
   */
  async function loadReport(build) {
    const date = new Date().toISOString().slice(0, 10);
    el.reportBody.innerHTML = '<p class="thin-note">Reading the ledger&hellip;</p>';
    try {
      if (build) {
        const made = await fetch(`/v1/${TENANT}/learn/report`, { method: 'POST',
          headers: operatorHeaders({ 'content-type': 'application/json' }), body: JSON.stringify({ date }) });
        if (!made.ok) throw new Error(`the report could not be built (${made.status})`);
      }
      const res = await fetch(`/v1/${TENANT}/learn/report?date=${date}&slot=${SLOT}`, { headers: operatorHeaders() });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || !body.report) throw new Error((body && body.error) || `no report for ${date}`);
      renderReport(body.report);
    } catch (error) {
      el.reportBody.innerHTML = `<p class="thin-note">${esc(String(error.message || error))}</p>`;
    }
  }

  function renderReport(rep) {
    const grid = (rep.grids && rep.grids[SLOT] && rep.grids[SLOT].learning) || null;
    const items = (grid && grid.items) || {};
    const rows = Object.entries(items).map(([id, cells]) => {
      const c = cells['*'] || Object.values(cells)[0] || {};
      const piece = ((state.catalog && state.catalog.pieces) || []).find((x) => x.id === id);
      return { title: piece ? piece.title : id, n: Number(c.n) || 0, s: Number(c.s) || 0,
        rate: typeof c.p_hat === 'number' ? c.p_hat : null };
    }).sort((a, b) => b.n - a.n);

    const counts = rep.counts || {};
    const contract = rep.attributionContract || {};
    const h = contract.history || {};
    const win = (contract.appliedWindowsMs || contract.windowsMs || {}).click;

    el.reportBody.innerHTML = `
      <p class="rep-k">Clicks into the module &middot; ${esc(rep.date || '')}</p>
      <div class="rep-row rep-head"><span>Promotion</span><span class="n">shown</span><span class="s">clicks</span><span class="r">rate</span></div>
      ${rows.length ? rows.map((r) => `<div class="rep-row">
        <span class="nm" title="${esc(r.title)}">${esc(r.title)}</span>
        <span class="n">${r.n.toFixed(0)}</span>
        <span class="s">${r.s.toFixed(0)}</span>
        <span class="r">${r.rate === null ? '&mdash;' : `${(r.rate * 100).toFixed(1)}%`}</span></div>`).join('')
        : '<p class="thin-note">No promotion has enough recorded activity yet. Click a few cards and rebuild.</p>'}
      <p class="rep-k">The whole day</p>
      <div class="rep-contract">
        decisions <b>${counts.decisions ?? 0}</b> &middot; outcomes <b>${counts.outcomes ?? 0}</b> &middot; visitors <b>${counts.visitors ?? 0}</b><br>
        reward <b>${esc((grid && grid.reward) || 'click')}</b> &middot; objective <b>${esc((grid && grid.objective) || 'unit')}</b>
        &middot; basis <b>${esc((grid && grid.measurementBasis) || 'served-v1')}</b><br>
        credit <b>${esc(h.credit || 'last')}</b> touch &middot; match <b>${esc(h.match || 'direct')}</b>
        &middot; scope <b>${esc(h.scope || 'session')}</b>${win ? ` &middot; window <b>${Math.round(win / 60000)} min</b>` : ''}
      </div>
      <div class="rep-flag"><b>Attribution, not incrementality.</b> The engine labels this report
        <code class="inl">${esc((rep.measurement && rep.measurement.kind) || 'attribution_diagnostic')}</code> and its own
        inference field reads <code class="inl">${esc((rep.measurement && rep.measurement.inference) || 'unavailable')}</code>.
        These are credited clicks per promotion, not a lift measurement. A control design is a conversation for
        your analytics team, and the rows above are what we hand you to run it on.</div>`;
  }

  /**
   * Garrett: "our pages are a mix of static and personalised content, and the
   * order of those modules can change daily… does this create any challenges?"
   *
   * No, and this is why: a slot is addressed by NAME. `top-offers` is
   * `top-offers` whether it renders first or fifth, its learning is keyed on
   * that name, and the page order is a property of their template, not of our
   * decision. Moving it is a CSS order change here because that is all it is on
   * their side too — a different position in their own layout.
   */
  function placeModule(position) {
    state.modulePos = position;
    if (!el.topOffersModule) return;
    el.topOffersModule.style.order = String(position);
    el.moduleWhere.innerHTML = `Module <b>${position}</b> of 5 on today&rsquo;s page &middot; slot <b>top-offers</b>`;
    el.topOffersModule.classList.remove('module--moved');
    void el.topOffersModule.offsetWidth;
    el.topOffersModule.classList.add('module--moved');
  }

  const useCatalog = async (name) => { state.catalog = await fetchDoc(name); renderPool(); };

  // ── The director's hand ───────────────────────────────────────────────────
  // It glides to a real control, ripples, and runs THAT control's own handler.
  // Never a shortcut into the code behind it: if the control is broken on stage,
  // the beat is broken too, which is the only honest arrangement.
  async function performClick(selector) {
    const target = document.querySelector(selector);
    if (!target) throw new Error(`nothing on the page matches ${selector}`);
    try { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* optional */ }
    await sleep(300);
    const r = target.getBoundingClientRect();
    el.cursor.classList.add('show');
    el.cursor.style.left = `${r.left + r.width / 2}px`;
    el.cursor.style.top = `${r.top + Math.min(r.height / 2, 38)}px`;
    await sleep(680);
    el.cursor.classList.remove('click'); void el.cursor.offsetWidth; el.cursor.classList.add('click');
    target.classList.remove('clicked'); void target.offsetWidth; target.classList.add('clicked');
    await sleep(280);
    await activate(target);
    await sleep(360);
    target.classList.remove('clicked');
  }

  /** Run what the DOM would have run for this control, and await it. */
  async function activate(target) {
    if (target.classList && target.classList.contains('cta') && target.dataset.content) return clickOffer(target);
    if (target.dataset.category) return openCategory(target.dataset.category);
    if (target.dataset.product) return openProduct(target.dataset.product);
    if (target.dataset.nav === 'home') return openHome();
    if (target === el.pdpAdd) return addToCart(target.dataset.product);
    return target.click();
  }

  async function addToCart(id) {
    const p = productById(id);
    if (!p || !state.shopper) return;
    await sendView('add_to_cart', { productId: p.id, category: p.category, subcategory: p.subcategory,
      brand: p.brand, price_usd: p.price });
    note('added', p.name, 'to cart · the heaviest signal the visitor can send');
  }

  // ── The beats ─────────────────────────────────────────────────────────────
  // `shopper` beats are performed on the page through the cursor.
  // `merch` beats are the merchandiser publishing, and are marked as such.
  const BEATS = [
    { who: 'shopper', label: 'A visitor arrives',
      declare: ["<b>Arrives</b> on the homepage for the first time, with no history of any kind"],
      acts: [],
      will: ["The four containers hold <b>QVC&rsquo;s defined promotions</b> &mdash; the same four every visitor sees", "Nothing is ranked, so no container can move", "Each receipt reads <b>QVC-defined default</b> rather than a score"],
      line: 'A brand-new visitor. Jamie&rsquo;s rule is in force: <b>QVC&rsquo;s four defined defaults</b>, held until the visitor '
        + 'has seen five pages in their lifetime. Every receipt says so. Nothing is being personalised yet, on purpose.',
      async run() {
        await useCatalog('catalog-1');
        await newVisitor();
        await publish('slots', await fetchDoc('slots-1'), 'the opening slots');
        await publish('catalog', state.catalog, 'the opening pool: twelve promotions, two per department');
        await openHome(true);   // their first page on the website
      } },

    { who: 'shopper', label: 'They browse the kitchen shop',
      declare: ["<b>Opens</b> the Kitchen &amp; Table department page"],
      acts: [{"type": "page_view", "attrs": {"category": "Kitchen & Table", "subcategory": "Cookware & Dutch Ovens"}}],
      will: ["<b>The four containers do not move.</b> The module is not asked again while they are on a department page", "One meter rises &mdash; Kitchen &amp; Table &mdash; and the page count goes up by one", "The defaults still hold: this is page two of the five their rule requires"],
      line: 'The cursor clicks <b>Kitchen &amp; Table</b> in their own nav and the department page loads. That page load '
        + '<b>is</b> the event. Watch the meter move while the module deliberately does not.',
      async run() { await performClick('#mastnav button[data-category="Kitchen & Table"]'); } },

    { who: 'shopper', label: 'They open a Dutch oven',
      declare: ["<b>Opens</b> a product: Copperline 9-Qt Enamel Dutch Oven"],
      acts: [{"type": "product_view", "attrs": {"category": "Kitchen & Table", "subcategory": "Cookware & Dutch Ovens", "brand": "Copperline", "priceBand": "core"}}],
      will: ["<b>The four containers still do not move</b>, for the same reason", "Four meters rise at once from one product view: department, subcategory, brand and price band", "Page three of five"],
      line: 'A product view — the strongest signal in retail, carrying category, subcategory, brand and price band at '
        + 'once. Still two pages short of their rule, so the defaults hold.',
      async run() { await performClick('#catGrid button[data-product="B412907"]'); } },

    { who: 'shopper', label: 'They look at home and beauty',
      declare: ["<b>Opens</b> For the Home", "<b>Opens</b> Beauty &amp; Wellness", "<b>Returns</b> to the homepage"],
      acts: [{"type": "page_view", "attrs": {"category": "For the Home", "subcategory": "Decor & Accents"}}, {"type": "page_view", "attrs": {"category": "Beauty & Wellness", "subcategory": "Skincare"}}],
      will: ["Page five. <b>The defaults are released and the module is ranked for the first time.</b>", "The cook promotions take the leading containers; the defaults that no longer earn a place drop out", "No more than two containers can hold one department, so the four span at least two"],
      line: 'Two more departments. The homepage, the two departments, the product and this one make <b>five pages</b> — '
        + 'their rule is satisfied, the defaults are released, and the module answers for the first time with what it '
        + 'actually decided.',
      async run() {
        await performClick('#mastnav button[data-category="For the Home"]');
        await sleep(380);
        await performClick('#mastnav button[data-category="Beauty & Wellness"]');
        await sleep(380);
        await performClick('#catCrumbs a[data-nav="home"]');
      } },

    { who: 'shopper', label: 'They open a second kitchen item',
      declare: ["<b>Opens</b> Kitchen &amp; Table again", "<b>Opens</b> a 7-Qt Digital Air Fryer", "<b>Returns</b> to the homepage"],
      acts: [{"type": "page_view", "attrs": {"category": "Kitchen & Table", "subcategory": "Cookware & Dutch Ovens"}}, {"type": "product_view", "attrs": {"category": "Kitchen & Table", "subcategory": "Countertop Cooking", "brand": "Fresco Nine", "priceBand": "elevated"}}],
      will: ["Kitchen &amp; Table clears <b>0.60</b>, so cook now outranks everything else", "The two cook promotions hold the first containers; the rest reorder beneath them"],
      line: 'Their fourth cook touch. <b>a = 4 / (4 + 1.8) = 0.69</b>, past the 0.60 entry threshold — check the meter '
        + 'against the arithmetic. Cook leads, and the department cap holds it to two containers.',
      async run() {
        await performClick('#mastnav button[data-category="Kitchen & Table"]');
        await sleep(360);
        await performClick('#catGrid button[data-product="B412915"]');
        await sleep(360);
        await performClick('#pdpCrumbs a[data-nav="home"]');
      } },

    { who: 'merch', label: 'Merchandiser: two hours pass',
      declare: ["<b>The CMS clock</b> moves two hours forward"],
      acts: [],
      will: ["A promotion whose window has closed <b>leaves its container</b> and stops being a candidate at all", "Everything below it <b>moves up one</b>, and the next-best promotion enters the last container", "Nothing was switched off and no test ended — the clock simply passed its end time"],
      line: 'A promotion&rsquo;s window closed. It leaves the candidate set on the very next decision and the next-ranked '
        + 'promotion takes the container. <b>No test ended. No winner was declared. Nobody configured anything.</b>',
      async run() {
        await useCatalog('catalog-clock');
        await publish('catalog', state.catalog, 'the clock passes a window');
        note('published', 'The CMS clock moved on', 'one promotion is now outside its window');
        await openHome(true, false);
      } },

    { who: 'merch', label: 'Merchandiser: a new promotion',
      declare: ["<b>Publishes</b> a new promotion, live from this minute"],
      acts: [],
      will: ["A promotion <b>nobody has ever clicked</b> appears in the module", "It is placed on its tags alone &mdash; department, brand, badge &mdash; because that is all there is to go on", "Whatever is currently in the last container is pushed out to make room"],
      line: 'Live for two minutes. <b>Nobody has clicked it, so there is no performance history to rank it on</b> \u2014 '
        + 'it is placed on its tags alone, and it still reaches the module on the first decision it is eligible for. '
        + 'Their sentence, exactly: '
        + '&ldquo;a new offer always follows one that leaves&rdquo;.',
      async run() {
        await useCatalog('catalog-arrival');
        await publish('catalog', state.catalog, 'a new promotion follows the one that left');
        note('published', 'A new promotion went live', 'never clicked \u00b7 placed on its tags alone');
        await openHome(true, false);
      } },

    { who: 'merch', label: 'Merchandiser: Final Hours creative',
      declare: ["<b>Swaps the creative</b> behind an existing content id"],
      acts: [],
      will: ["One card changes its <b>picture and its title</b>", "<b>It does not move.</b> Same container, same score, same accumulated clicks", "Because the content id never changed, nothing it has learned is lost"],
      line: 'New creative behind the <b>same content id</b>. The image and the title change; the score, the position '
        + 'and everything it has learned do not. A new id would restart learning at the worst possible moment.',
      async run() {
        await useCatalog('catalog-final');
        await publish('catalog', state.catalog, 'the closing creative, same id');
        note('published', 'Final Hours creative', 'same content id, so the learning survives');
        await openHome(true, false);
      } },

    { who: 'merch', label: 'Merchandiser: the Lantern Pick',
      declare: ["<b>Sets</b> the slot&rsquo;s promotion weight to 0.25"],
      acts: [],
      will: ["The day&rsquo;s pick <b>moves up one container</b>", "It does <b>not</b> take the first container &mdash; the visitor&rsquo;s own affinity still outranks it", "Whatever it passes moves down one"],
      line: 'The promotion weight goes to <b>0.25</b>. The day&rsquo;s pick rises from third to second on the strength of '
        + 'the beauty department they visited — the term is a multiplier, so it cannot manufacture interest that is not '
        + 'there. Their own cook affinity still leads. Turn the number higher and it would lead; that is the '
        + 'merchandiser&rsquo;s call, and the next beat is what to do when they want it first regardless.',
      async run() {
        await useCatalog('catalog-showcase');
        await publish('slots', await fetchDoc('slots-promo'), 'the merchandiser reinforces the day\u2019s pick');
        await publish('catalog', state.catalog, 'the pick carries its promotion signal');
        note('tuned', 'Promotion weight \u2192 0.25', 'third \u2192 second \u00b7 their own affinity still leads');
        await openHome(true, false);
      } },

    { who: 'merch', label: 'Merchandiser: pin it instead',
      declare: ["<b>Pins</b> the day&rsquo;s pick to container one"],
      acts: [],
      will: ["The day&rsquo;s pick <b>takes container one outright</b>, for every visitor", "Everything else shifts down one container", "Its receipt reads <b>ranking skipped</b>, so the override is visible as an override"],
      line: 'When they want it first for <b>everyone</b>, that is a pin, not a heavier weight. It takes container one '
        + 'and the receipt says ranking was skipped. The override is visible <b>as</b> an override.',
      async run() {
        await publish('slots', await fetchDoc('slots-pin'), 'the day\u2019s pick pinned to container one');
        note('tuned', 'The pick is pinned', 'container one for everyone \u00b7 ranking skipped');
        await openHome(true, false);
      } },

    { who: 'merch', label: 'It starts snowing in Washington',
      declare: ["<b>Asserts</b> region = US-WA and weather = snow on the request"],
      acts: [],
      will: ["A promotion that has been in the pool since the first press <b>appears for the first time</b>", "It enters a container on its own merits and pushes one promotion out", "Nothing about the visitor changed. Only the asserted condition did"],
      line: 'Garrett&rsquo;s rule. The winter promotion has been in the published pool <b>since beat one</b> and nobody has '
        + 'seen it — its rule needs the Pacific Northwest <i>and</i> snow, and a condition the request does not carry '
        + 'fails closed. Assert both and it becomes eligible; it then has to earn its place by ranking like anything else.',
      async run() {
        state.region = 'US-WA';
        state.weather = 'snow';
        renderWeather();
        note("tuned", "weather = snow, region = US-WA", "asserted on the request \u00b7 eligibility only, never a boost");
        await openHome(true, false);
      } },

    { who: 'merch', label: 'The same shopper in Florida',
      declare: ["<b>Asserts</b> region = US-FL &mdash; nothing about the visitor changes"],
      acts: [],
      will: ["The winter promotion <b>disappears from the module</b>", "It is still published and still inside its window &mdash; it is simply no longer allowed to be shown", "Everything below it moves up one container"],
      line: 'Nothing about the visitor changed. Only the asserted region did, and the winter promotion is gone — it is still '
        + 'published, still inside its window, and still not eligible. That is a rule on the piece, not a preference.',
      async run() {
        state.region = 'US-FL';
        renderWeather();
        note('tuned', 'region = US-FL', 'still snowing, still published, no longer eligible');
        await openHome(true, false);
      } },

    { who: 'merch', label: 'Tomorrow the page order changes',
      declare: ["<b>Publishes</b> tomorrow&rsquo;s homepage: the module moves from position 2 to position 1"],
      acts: [],
      will: ["The module renders <b>first</b> instead of second",
        "<b>The same four promotions, in the same order, with the same scores.</b> The decision does not know or care where it sits",
        "Its learning is keyed on the slot <b>name</b>, so nothing is reset by moving it"],
      line: 'Garrett asked whether their page order changing daily is a problem for us. Watch: the module moves to '
        + 'the top of the page and <b>the four do not change at all</b>. A slot is addressed by name, not position \u2014 '
        + '<code class="inl">top-offers</code> is <code class="inl">top-offers</code> wherever their template puts it, '
        + 'and its evidence follows the name.',
      async run() {
        placeModule(1);
        note('published', 'Tomorrow\u2019s page order', 'the module moved to position 1');
        await openHome(true, false);
      } },

    { who: 'merch', label: 'And it wants two pieces, not four',
      declare: ["<b>Publishes</b> the slot with <code class=\"inl\">take: 2</code>"],
      acts: [],
      will: ["The module renders <b>two</b> containers instead of four",
        "They are the <b>top two</b> of the same ranking &mdash; nothing is re-decided",
        "Same slot name, so every exposure and click it has already earned still counts"],
      line: 'Garrett&rsquo;s other question: what if the layout wants two pieces tomorrow and four the day after? That is '
        + '<b>one field</b> on a published document, with full history and rollback. The module takes the top two of '
        + 'the same ranking, and keeps everything it has learned.',
      async run() {
        const doc = await fetchDoc('slots-take2');
        await publish('slots', doc, 'tomorrow the layout wants two pieces');
        note('published', 'take: 4 \u2192 2', 'one field \u00b7 same slot, same learning');
        await openHome(true, false);
      } },

    { who: 'shopper', label: 'Clicks into the module',
      declare: ["<b>Clicks</b> two of the four containers, as a shopper would"],
      acts: [],
      will: ["Each click is credited to the promotion in that container",
        "Nothing about the module changes &mdash; a click is a <b>reward</b>, not a signal to re-rank",
        "The day report gains two credited outcomes"],
      line: 'Two clicks into the module. This is the metric Jamie named \u2014 <b>offer clicks and module '
        + 'engagement</b> \u2014 and each one is credited to the promotion in that container. Open '
        + '<b>What it learned</b> on the right and build the report.',
      async run() {
        const buttons = Array.from(el.four.querySelectorAll ? el.four.querySelectorAll('.cta') : []);
        for (const btn of buttons.slice(0, 2)) {
          await performClick(`.four .promo:nth-child(${buttons.indexOf(btn) + 1}) .cta`);
          await sleep(250);
        }
        await loadReport(true);
        note('clicked', 'Two containers', 'credited to the promotions that held them');
      } },
  ];

  /** The condition switch, so the room can see what is being asserted. */
  function renderWeather() {
    if (!el.weather) return;
    el.weather.innerHTML = '<span class="wlabel">asserted</span>'
      + ['US-WA', 'US-OR', 'US-FL'].map((r) =>
        `<button type="button" data-region="${r}" aria-pressed="${state.region === r}">${r}</button>`).join('')
      + ['snow', 'clear'].map((w) =>
        `<button type="button" data-weather="${w}" aria-pressed="${(state.weather || 'clear') === w}">${w}</button>`).join('');
  }

  /** Which beat comes next, and what it is called. */
  function renderNext() {
    if (!el.nextBeat) return;
    const next = state.beat === null ? 0 : state.beat + 1;
    if (next >= BEATS.length) {
      el.nextBeat.disabled = true;
      el.nextLabel.textContent = 'the walkthrough is complete';
      return;
    }
    el.nextBeat.disabled = false;
    el.nextLabel.textContent = `${next + 1} \u00b7 ${BEATS[next].label}`;
  }

  /** The bar narrates; it does not sit open over the thing it is narrating. */
  function closeDirector() {
    const bar = el.directorHandle && el.directorHandle.closest('.director');
    if (!bar) return;
    bar.classList.remove('director--open');
    el.directorHandle.setAttribute('aria-expanded', 'false');
    el.directorHandle.textContent = 'All beats';
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PREDICT, THEN PROVE
  //
  // The arithmetic is not a model output, it is published: affinity is
  // a = R / (R + K) with K = 1.8, and each admitted touch adds its action weight
  // to R. So the score a touch WILL produce can be stated before the touch
  // happens, and checked by hand. That is the whole point — the room does not
  // have to believe the engine, it has to check one division.
  //
  // What the band never does is fake the decision. It declares the arithmetic
  // and the expected consequence; the engine then decides for real, and the
  // second half of the band shows what it actually did, from the receipts.
  // ══════════════════════════════════════════════════════════════════════════
  const K_CONST = 1.8;
  const THETA_IN = 0.6;
  /** The engine's own action weights, from the published registry. */
  const ACTION_WEIGHT = { page_view: 1, product_view: 1, content_click: 1, add_to_cart: 3 };

  const affinityOf = (dim, value) => {
    const d = lastVector[dim];
    return d && typeof d[value] === 'number' ? d[value] : 0;
  };
  /** Invert a = R/(R+K) to recover the accumulated R the meter implies. */
  const rOf = (a) => (a >= 1 ? Infinity : (a * K_CONST) / (1 - a));
  const aOf = (r) => r / (r + K_CONST);

  /**
   * What a declared set of touches will do to the meters. Each entry is one
   * dimension value the acts touch, with the score before, the score after, and
   * the threshold it is measured against.
   */
  function predictArithmetic(acts) {
    const added = new Map();
    acts.forEach((act) => {
      const w = ACTION_WEIGHT[act.type] ?? 1;
      Object.entries(act.attrs || {}).forEach(([dim, value]) => {
        if (typeof value !== 'string') return;
        const key = `${dim}\u0000${value}`;
        added.set(key, (added.get(key) || 0) + w);
      });
    });
    return [...added.entries()].map(([key, delta]) => {
      const [dim, value] = key.split('\u0000');
      const before = affinityOf(dim, value);
      const after = aOf(rOf(before) + delta);
      return { dim, value, before, after, theta: THETA_IN, crosses: before < THETA_IN && after >= THETA_IN };
    }).sort((a, b) => b.after - a.after);
  }

  const slotColour = (i) => ['#1B4F9C', '#B4402B', '#0E8F4F', '#8A5B08'][i % 4];
  const mapHtml = (rows) => (rows && rows.length
    ? rows.map((r, i) => `<div class="pd-slot" style="background:${slotColour(i)}" title="${esc(r)}">${i + 1} &middot; ${esc(r)}</div>`).join('')
    : '<p class="pd-empty" style="font-size:12.5px">nothing yet</p>');

  let pdProof = null;

  /**
   * Which promotion a beat acts on, so the prediction can NAME it and say where
   * it sits right now. "Whatever is fourth gets pushed out" is a description of
   * a mechanism; "Bedding & Bath Event is in container 4 today and this press
   * takes its place" is a claim the room can check a second later.
   */
  function targetOf(beat) {
    const a = state.anchor || {};
    const byLabel = {
      'Merchandiser: two hours pass': a.expiringId,
      'Merchandiser: a new promotion': a.arrivalId,
      'Merchandiser: Final Hours creative': a.swapId,
      'Merchandiser: the Lantern Pick': a.showcaseId,
      'Merchandiser: pin it instead': a.showcaseId,
      'It starts snowing in Washington': a.winterId,
      'The same shopper in Florida': a.winterId,
    };
    const id = byLabel[beat.label];
    if (!id) return null;
    const piece = pieceOf(id);
    const at = (state.current || []).findIndex((c) => c.id === id);
    return { id, title: piece ? piece.title : id, at };
  }

  /** Where the named promotion stands right now, in the module, before the press. */
  function standingLine(beat) {
    const t = targetOf(beat);
    if (!t) return null;
    if (t.at > -1) return `<b>${esc(t.title)}</b> holds container <b>${t.at + 1}</b> right now.`;
    return `<b>${esc(t.title)}</b> is in the pool but not in the four right now.`;
  }

  /** The prediction half: what the next press will do, stated before it runs. */
  function renderPredict(beat) {
    if (!beat) {
      el.pdMode.textContent = 'the walkthrough is complete';
      el.pdAct.innerHTML = '<li class="pd-empty">No press remains.</li>';
      el.pdArith.innerHTML = '<p class="pd-empty" style="font-size:12.5px">Nothing left to predict.</p>';
      el.pdWill.innerHTML = '<li class="pd-empty">&mdash;</li>';
      renderDone();
      return;
    }
    const acts = beat.acts || [];
    el.pdMode.textContent = acts.length
      ? `before the next ${acts.length === 1 ? 'act' : `${acts.length} acts`}`
      : 'before the next press';
    renderDone();
    el.pdAct.innerHTML = (beat.declare || [beat.label]).map((line) => `<li>${line}</li>`).join('');
    const rows = predictArithmetic(acts);
    el.pdArith.innerHTML = rows.length ? rows.map((r) => `<div class="pd-row${r.crosses ? ' crosses' : ''}">
      <span class="dim">${esc(r.dim)} &middot; ${esc(r.value)}</span>
      <span class="from">${r.before.toFixed(3)} &rarr;</span>
      <span class="to">${r.after.toFixed(3)}</span>
      <span class="th">&theta;<sub>in</sub> ${r.theta.toFixed(2)}</span></div>`).join('')
      : '<p class="pd-empty" style="font-size:12.5px">This press is the merchandiser acting, not the visitor \u2014 no meter moves.</p>';
    const standing = standingLine(beat);
    el.pdWill.innerHTML = (standing ? `<li>${standing}</li>` : '')
      + ((beat.will || []).map((w) => `<li>${w}</li>`).join('')
      || '<li class="pd-empty">Stated in the narration.</li>');
    // The four as they stand, so the prediction is read against them rather
    // than in the abstract.
    el.pdNow.innerHTML = (state.current && state.current.length)
      ? mapHtml(state.current.map((c) => c.title))
      : '<p class="pd-empty" style="font-size:12px">The module has not been asked yet.</p>';
  }

  function renderDone() {
    el.pdDone.innerHTML = state.journey.length
      ? state.journey.map((j) => `<li><b>${esc(j.verb)}</b> ${esc(j.what)}${
          j.detail ? `<div class="pd-tags">${esc(j.detail)}</div>` : ''}</li>`).join('')
      : '<li class="pd-empty">Nothing yet \u2014 the visitor has not arrived.</li>';
  }

  /** The proof half: what the engine actually did, read off the receipts. */
  function captureProof(decisions, beforeRows, index) {
    const authority = (d) => (d.strategy === 'tenant-pinned' ? { cls: 'pinned', text: 'tenant config \u00b7 pinned' }
      : d.strategy === 'default' ? { cls: 'default', text: 'QVC default set' }
      : (pieceOf(d.customerContentId) || {}).eligibleWhen ? { cls: 'rule', text: 'eligibility rule' }
      : { cls: 'engine', text: 'engine' });

    const beforeIds = (beforeRows || []).map((b) => b.id);
    const rows = decisions.map((d, i) => {
      const piece = pieceOf(d.customerContentId);
      const drivers = (d.explain && d.explain.drivers) || [];
      const why = drivers.length
        ? drivers.map((x) => `${esc(x.dim)}&middot;${esc(x.value)} ${Number(x.a).toFixed(3)} \u00d7 ${x.weight}`).join('<br>')
          + `<br>score ${Number(d.score).toFixed(3)}`
        : d.strategy === 'tenant-pinned' ? 'ranking never ran for it'
        : 'no dimension has evidence \u00b7 ranked on freshness';
      const was = beforeIds.indexOf(d.customerContentId);
      const against = was === -1 ? 'entered the module this press'
        : was === i ? 'held its container'
        : was > i ? `moved up from container ${was + 1}`
        : `pushed down from container ${was + 1}`;
      const a = authority(d);
      return `<tr>
        <td class="what">${esc(piece ? piece.title : d.customerContentId)} &rarr; container ${i + 1}</td>
        <td class="num">${why}</td>
        <td class="against">${esc(against)}</td>
        <td><span class="pd-auth pd-auth--${a.cls}">${esc(a.text)}</span></td></tr>`;
    }).join('');

    pdProof = {
      label: BEATS[index] ? BEATS[index].label : '',
      why: rows,
      now: mapHtml((beforeRows || []).map((b) => b.title)),
      after: mapHtml(decisions.map((d) => {
        const piece = pieceOf(d.customerContentId);
        return piece ? piece.title : d.customerContentId;
      })),
    };
  }

  /**
   * Open the explanation, in whichever tense is wanted. The top half predicts
   * the next press; the bottom half proves the last one. Both are present
   * whenever both exist, so the same control answers "what is about to happen"
   * and "why did that happen" without the presenter choosing a mode first.
   */
  function openExplain() {
    const next = state.beat === null ? 0 : state.beat + 1;
    renderPredict(BEATS[next]);
    if (pdProof) {
      el.pdWhy.innerHTML = pdProof.why;
      el.pdMapNow.innerHTML = pdProof.now;
      el.pdMapAfter.innerHTML = pdProof.after;
      el.pdWhyHead.textContent = `Why \u2014 every decision the last press made (${pdProof.label})`;
      el.pdWhyWrap.hidden = false;
    } else {
      el.pdWhyWrap.hidden = true;
    }
    el.pdNote.textContent = 'Above: computed from the visitor\u2019s real profile on the engine\u2019s own published '
      + 'constants \u2014 a = R / (R + K), K = 1.8, checkable by hand. Below: what the engine actually did last press, '
      + 'read off its receipts. Nothing runs from this panel.';
    el.pdBack.hidden = false;
  }

  /**
   * A press runs. It does not stop to declare anything.
   *
   * The declaration used to gate every beat, which put a modal between the
   * presenter and the thing they were presenting. It belongs in the presenter's
   * hand instead: openExplain() can be reached at any moment — before a press to
   * say what is about to happen, or after one to say what just did — and the
   * walkthrough runs at the pace of the conversation, not the fixture.
   */
  function go(i) {
    if (state.busy) return undefined;
    if (!el.pdBack.hidden) el.pdBack.hidden = true;   // an open explanation never blocks a press
    closeDirector();
    return runBeat(i);
  }

  async function runBeat(i) {
    if (state.busy) return;
    state.busy = true;
    const beforeRows = state.current;
    Array.from(el.presses.children).forEach((b, j) => b.setAttribute('aria-pressed', j === i ? 'true' : 'false'));
    el.beatNo.textContent = `Beat ${i + 1} / ${BEATS.length}`;
    el.engineLine.innerHTML = BEATS[i].line;
    say('working…');
    try {
      const credential = await adoptLocalToken();
      if (credential !== 'ok') throw new Error(credential === 'none'
        ? 'no merchandiser token — run scripts/seed-shn.mjs, or use Merchandiser sign-in'
        : `the merchandiser token was ${credential} — re-run scripts/seed-shn.mjs`);
      if (!state.shopper) await newVisitor();   // any beat may be pressed first
      await BEATS[i].run();
      say('done', 'good');
    } catch (error) {
      const m = String((error && error.message) || error);
      say(m, 'bad'); engineDown(m);
    } finally {
      el.cursor.classList.remove('show');
      state.busy = false;
      state.beat = i;
      renderNext();
      // Capture what the engine just did, silently, so the explanation is ready
      // the moment it is asked for.
      if (state.lastDecisions) captureProof(state.lastDecisions, beforeRows, i);
    }
  }

  el.presses.innerHTML = BEATS.map((b, i) =>
    `<button class="press${b.who === 'merch' ? ' press--merch' : ''}" type="button" aria-pressed="false" data-i="${i}">`
    + `<span class="n">${i + 1}</span>${esc(b.label)}</button>`).join('');
  el.presses.addEventListener('click', (e) => {
    const btn = e.target.closest('.press');
    if (btn) void go(Number(btn.dataset.i));
  });

  // The page's own controls. The cursor runs these; so does a human hand, which
  // is what lets anyone in the room drive it instead of watching the script.
  document.addEventListener('click', (e) => {
    if (e.target.closest('.press') || e.target.closest('.cta')) return;
    const nav = e.target.closest('[data-category],[data-nav],[data-product]');
    if (!nav) return;
    e.preventDefault();
    if (state.busy) return;                   // the page is frozen inside a beat
    if (nav.dataset.product) void openProduct(nav.dataset.product);
    else if (nav.dataset.category) void openCategory(nav.dataset.category);
    else if (nav.dataset.nav === 'home') void openHome();
  });

  el.pdpAdd.addEventListener('click', () => { if (!state.busy) void addToCart(el.pdpAdd.dataset.product); });

  // Press the ghost strip to lay the previous four, full size, above the current
  // four. "This is what the visitor saw; this is what the visitor sees" is one glance, not a
  // squint at thumbnails.
  if (el.ghosts) el.ghosts.addEventListener('click', () => {
    state.showBefore = !state.showBefore;
    renderBeforeRow();
    // Only the strip's own hint changes; the diff above it is untouched.
    const hint = el.ghosts.querySelector('.ghost-hint');
    if (hint) hint.textContent = state.showBefore ? 'Hide the before row' : 'Show it full size, above';
  });

  /**
   * The bar narrates by default and shows its controls on demand. It was tall
   * enough to cover the pool it was talking about, which is the one thing a
   * director bar must never do. Hover or focus opens it; the handle pins it open
   * for touch and for a presenter who does not want it moving under the cursor.
   */
  if (el.directorHandle) el.directorHandle.addEventListener('click', () => {
    const bar = el.directorHandle.closest('.director');
    const open = bar.classList.toggle('director--open');
    el.directorHandle.setAttribute('aria-expanded', String(open));
    el.directorHandle.textContent = open ? 'Hide beats' : 'All beats';
  });

  const closeExplain = () => { el.pdBack.hidden = true; };
  if (el.pdGo) el.pdGo.addEventListener('click', closeExplain);
  if (el.pdBack) el.pdBack.addEventListener('click', (e) => { if (e.target === el.pdBack) closeExplain(); });
  if (el.pdPill) el.pdPill.addEventListener('click', openExplain);
  if (el.explainBtn) el.explainBtn.addEventListener('click', openExplain);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.pdBack.hidden) closeExplain();
    // One key, either tense, from anywhere on the page.
    else if ((e.key === 'e' || e.key === 'E') && el.pdBack.hidden && !state.busy) openExplain();
  });

  if (el.buildReport) el.buildReport.addEventListener('click', () => { void loadReport(true); });

  if (el.nextBeat) el.nextBeat.addEventListener('click', () => {
    if (state.busy || el.nextBeat.disabled) return;
    void go(state.beat === null ? 0 : state.beat + 1);
  });

  /** The right column is four panels in one component, so the page never scrolls for depth. */
  (() => {
    const tabs = Array.from(document.querySelectorAll('.whytabs button'));
    if (!tabs.length) return;
    const select = (id) => tabs.forEach((t) => {
      const on = t.id === id;
      t.setAttribute('aria-selected', String(on));
      const panel = document.getElementById(t.getAttribute('aria-controls'));
      if (panel) panel.hidden = !on;
    });
    tabs.forEach((t) => t.addEventListener('click', () => select(t.id)));
  })();

  if (el.weather) el.weather.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || state.busy) return;
    if (btn.dataset.region) state.region = btn.dataset.region;
    if (btn.dataset.weather) state.weather = btn.dataset.weather === 'snow' ? 'snow' : null;
    renderWeather();
    void refresh();
  });

  /**
   * A click on a container is the reward this slot is judged on. It is credited
   * to the promotion that held the container, which is why the report can say
   * clicks-per-promotion rather than clicks-per-module.
   */
  async function clickOffer(btn) {
    if (!btn || !state.shopper) return;
    const r = await api('/realtime/action', { userId: state.shopper.subject, sessionId: state.shopper.sessionId,
      source: SOURCE, type: 'content_click', data: { contentId: btn.dataset.content, slot: SLOT,
        ...(btn.dataset.decision ? { decisionId: btn.dataset.decision } : {}) } });
    say(r.status === 200 ? `click credited to ${btn.dataset.content}` : `click refused: ${r.status}`,
      r.status === 200 ? 'good' : 'bad');
  }

  el.four.addEventListener('click', (e) => {
    const btn = e.target.closest('.cta');
    if (!btn) return;
    void clickOffer(btn).then(() => note('clicked', 'A promotion in the module',
      'the reward this module is judged on'));
  });

  // Their own text-size adjuster: 12→24 in 2px steps, persisted, announced. QVC
  // ships one; a demo for a stated 50+ audience that does not is telling on itself.
  (() => {
    let size = 16;
    try { size = Number(localStorage.getItem('lnl-text-size')) || 16; } catch { size = 16; }
    const apply = () => {
      document.body.style.fontSize = `${size}px`;
      el.textSize.textContent = `Text size ${size}px`;
      try { localStorage.setItem('lnl-text-size', String(size)); } catch { /* private window */ }
    };
    el.textSize.addEventListener('click', () => { size = size >= 24 ? 12 : size + 2; apply(); });
    apply();
  })();

  el.tokenBtn.addEventListener('click', () => {
    const next = window.prompt('Merchandiser operator token (node scripts/dev-token.mjs)', storedToken());
    if (next === null) return;
    merchandiser = next.trim();
    try { sessionStorage.setItem('tuning-token', merchandiser); } catch { /* private window */ }
    void adoptLocalToken().then((c) => say(c === 'ok' ? 'signed in' : `the token was ${c}`, c === 'ok' ? 'good' : 'bad'));
  });

  (async () => {
    try {
      state.shop = await fetchJson('products.json');
      state.anchor = await fetchDoc('anchor');
      renderNav();
      renderWeather();
      renderNext();
      await useCatalog('catalog-1');
      // QVC's defined defaults are STATIC CONTENT, not a decision: they are what
      // everyone sees until the page rule releases them. So they belong on
      // screen the moment the page loads, before any session exists. Waiting for
      // a visitor left the module sitting on its own placeholder, which reads as
      // broken and hides the very thing the first beat is about.
      //
      // AFTER the catalog, not before: the titles and the creative come from it,
      // and a default set rendered without it shows bare ids.
      render(defaultFour(), true);
      const credential = await adoptLocalToken();
      if (credential === 'ok') say(`shop loaded · ${state.shop.products.length} products · merchandiser signed in — press 1`, 'good');
      else if (credential === 'none') say('shop loaded, but there is no merchandiser token — run scripts/seed-shn.mjs', 'bad');
      else say(`shop loaded, but the merchandiser token was ${credential} — re-run scripts/seed-shn.mjs`, 'bad');
    } catch (error) { say(error.message, 'bad'); engineDown(error.message); }
  })();
})();
