#!/usr/bin/env node
// scripts/rehearse-@@SLUG@@-dom.mjs: press @@NAME@@'s director buttons, for real.
//
// Scaffolded by scripts/demo-kit/new-demo.mjs with the ARRIVAL checks written. It loads the actual page
// (public/@@SLUG@@/index.html and @@SLUG@@.js, served by the worker) into headless Chrome and runs the director's
// presses through the page's own hook, window.@@DEBUG@@.go(i) under ?debug=1: the same function the director bar's
// Next button calls. Every answer is read off what a person would see (computed style up the whole ancestor chain
// and a real layout box, the kit's lib/cdp.mjs), and the wire is watched: every API call carries
// X-Tenant: @@TENANT@@, none goes to /content, /config or /ops, none carries Authorization, a beat goes by name.
// The vertical's outcomes for the other beats are the suite lane's to add, after the arrival, in the director's order.
//
//   node scripts/rehearse-@@SLUG@@-dom.mjs [--base http://localhost:@@PORT@@] [--size 1440x900] [--chrome "<path>"] [--shots <dir>]
//   node scripts/demo-kit/rehearse.mjs --config @@SLUG@@ --suite dom --base <url>      (the same, through the kit)
//
// It holds no credential and takes no token, and it ends with POST /@@SLUG@@/api/reset. Chrome runs headless with a
// fresh profile of its own under the OS temp directory on every run. Run it from Windows (Node 22 or later).
import { apiPaths, auditWire, checkScriptErrors, findChrome, inPage, launchChrome, parseSize, recordWire, screenshotter, tallyWire } from './demo-kit/lib/cdp.mjs';
import { createChecks, flagReader, sleep } from './demo-kit/lib/rehearse.mjs';

const arg = flagReader();
const base = arg('--base', 'http://localhost:@@PORT@@').replace(/\/+$/, '');
const [WIDTH, HEIGHT] = parseSize(arg('--size', '1440x900'));
const SHOTS = arg('--shots', null);
const SLUG = '@@SLUG@@', TENANT = '@@TENANT@@', API = `/${SLUG}/api`, HOOK = '@@DEBUG@@';
const SETTLE_MS = 1200;
const checks = createChecks({ infoIndent: 8, strict: process.argv.includes('--strict') });
const { ok, info } = checks;
const has = (text, needle) => String(text || '').toLowerCase().includes(String(needle).toLowerCase());

const CHROME = findChrome([arg('--chrome'), process.env.CHROME_PATH]);
if (!CHROME) { console.log('✗ no Chrome or Edge found; pass --chrome "<path>"'); process.exit(1); }
if (typeof WebSocket === 'undefined') { console.log('✗ this suite needs Node 22 or later (a global WebSocket)'); process.exit(1); }
const browser = launchChrome({ chrome: CHROME, width: WIDTH, height: HEIGHT, profilePrefix: `${SLUG}-rehearsal-chrome-` });
const { cdp, evaluate, waitFor } = browser;
const shot = screenshotter({ browser, dir: SHOTS, prefix: SLUG.toUpperCase(), width: WIDTH, info });

let press = 'boot';
const wire = recordWire(browser, { api: apiPaths(API), keepBody: new RegExp(`^${API}/(beat|reset)$`), pressNow: () => press });
const { requests, refusedIn } = wire;

// ── What a person sees: computed style up the chain, and a real box ──────────
function pageHelpers({ vis, txt, shown }) {
  const snapshot = () => ({
    status: (document.getElementById('status') || {}).textContent || '',
    line: txt('#engineLine'), lineOk: vis('#engineLine').ok, beatNo: txt('#beatNo'),
    wordmark: { ...vis('#wordmark'), text: txt('#wordmark'), color: getComputedStyle(document.getElementById('wordmark')).color },
    brand: getComputedStyle(document.documentElement).getPropertyValue('--brand').trim(),
    machine: vis('#machine').ok, director: vis('.director').ok,
    slots: [...document.querySelectorAll('#stage > .view:not([hidden]) [data-slot]')].map((m) => ({ slot: m.dataset.slot, gated: m.dataset.gated === 'true', shown: vis(m).ok,
      cards: shown('.card', m).map((c) => ({ cid: c.dataset.cid, title: txt(c.querySelector('h3')), decided: Boolean(c.dataset.opDecisionId) })) })),
    cold: { ok: vis('#coldStart').ok, text: txt('#coldStart') },
    ctx: txt('#ctxChips'), who: txt('#whoChip'),
    overflow: document.documentElement.scrollWidth - innerWidth,
    broken: [...document.images].filter((i) => vis(i).ok && i.complete && i.naturalWidth === 0).map((i) => i.getAttribute('src')),
  });
  window.__k4 = { vis, txt, snapshot };
  // The store a visitor uses (lane K5): what each view shows, read the way a person sees it.
  const view = () => document.querySelector('#stage > .view:not([hidden])');
  const store = () => ({
    url: location.pathname + location.search, view: (view() || {}).id || null,
    header: { wordmark: vis('#wordmark').ok, nav: shown('#mainnav [data-nav]').length, search: vis('form[data-store-search] input[name="q"]').ok,
      signIn: vis('#signIn').ok && txt('#signIn').length > 0, cart: vis('[data-act="store-cart-open"]').ok, count: txt('[data-cart-count]') },
    slots: [...(view() || document).querySelectorAll('[data-slot]')].filter((m) => vis(m).ok).map((m) => ({ slot: m.dataset.slot,
      cards: shown('.card', m).map((c) => ({ cid: c.dataset.cid, title: txt(c.querySelector('h3')), img: Boolean(c.querySelector('img')), decided: Boolean(c.dataset.opDecisionId) })) })),
    grid: { cards: shown('.pgrid .pcard', view() || document).length, filters: shown('.filters .fval', view() || document).length, count: txt((view() || document).querySelector('.grid-bar .count')) },
    product: { title: txt('#bbTitle'), price: txt('#bbPrice'), add: vis('#bbAdd').ok && !document.getElementById('bbAdd').disabled, retail: vis('#bbRetail').ok },
    sheet: { open: vis('#sheetBack').ok, kind: txt('#sheetBody .sk'), lines: shown('#sheetBody .st-line').length, buyHere: vis('#sheetBody [data-act="store-retailer-buy"]').ok,
      sellers: shown('#sheetBody [data-act="store-referral"], #sheetBody [data-act="store-pickup"]').length, total: txt('#sheetBody [data-cart-total]') },
    broken: [...document.images].filter((i) => vis(i).ok && i.complete && i.naturalWidth === 0).map((i) => i.getAttribute('src')),
    overflow: document.documentElement.scrollWidth - innerWidth,
  });
  /** A press as a hand makes it: the control's own click, through the page's one dispatcher. */
  const press = (selector) => { const el = typeof selector === 'string' ? document.querySelector(selector) : selector; if (!el) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true; };
  window.__k5 = { store, press, view };
}
const rgb = (hex) => { const h = hex.replace('#', ''); const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h; return `rgb(${[0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)).join(', ')})`; };
const runBeat = (i) => evaluate(`(async () => { const run = window.${HOOK}.go(${i}); if (run === undefined) return 'busy'; await run; return document.getElementById('status').textContent; })()`);

const port = await browser.port();
try {
  await browser.connect(port);
  await browser.prepare();
  const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(base).hostname);
  const booted = () => waitFor("/^ready|error|missing|failed|beats\\.json/i.test((document.getElementById('status') || {}).textContent || '')", 30000);
  console.log(`\n@@NAME@@ DOM rehearsal against ${base} at ${WIDTH}×${HEIGHT} in ${CHROME.split(/[\\/]/).pop()}`);

  const url = `${base}/${SLUG}/?debug=1`;
  console.log(`\n── The page loads: ${url}`);
  await cdp('Page.navigate', { url });
  const up = await booted();
  await evaluate(inPage(pageHelpers));
  const boot = await evaluate('window.__k4.snapshot()');
  ok('the page boots on the kit, and every template in beats.json resolves against the facts', up && /^ready/.test(boot.status), boot.status.slice(0, 160));
  ok(`the director hook is exposed under ?debug=1 (window.${HOOK})`, await evaluate(`typeof (window.${HOOK} || {}).go === "function"`));
  const total = await evaluate(`window.${HOOK}.beats().length`);
  ok('the director lists the @@TOTAL@@ beats of beats.json', total === @@TOTAL@@, `${total}`);
  ok('the palette is the token sheet\'s: --brand is @@BRAND@@', boot.brand.toUpperCase() === '@@BRAND@@'.toUpperCase(), boot.brand);
  ok('the wordmark “@@WORDMARK@@” is on screen in the brand colour', boot.wordmark.ok && boot.wordmark.text === '@@WORDMARK@@' && boot.wordmark.color === rgb('@@BRAND@@'),
    `${boot.wordmark.text} · ${boot.wordmark.color}`);
  ok('the machine panel and the director bar are on screen', boot.machine && boot.director);
  ok('before anyone arrives, nothing on the page is decided', boot.slots.every((s) => s.cards.every((c) => !c.decided)), boot.slots.map((s) => `${s.slot} ${s.cards.length}`).join(' · '));
  ok('the director\'s opening sentence is on screen', boot.lineOk && boot.line.length > 10, boot.line.slice(0, 90));
  ok('no horizontal overflow', boot.overflow <= 1, `${boot.overflow}px`);
  await shot('00-boot');

  // ── The store by hand, before any beat (lane K5): a stranger's own clicks, the same handlers the director runs ──
  console.log('\n── The store by hand: no beat pressed');
  const settle = async (cond, ms = 15000) => { await waitFor(cond, ms).catch(() => false); await sleep(SETTLE_MS); return evaluate('window.__k5.store()'); };
  const pressAt = (sel) => evaluate(`window.__k5.press(${JSON.stringify(sel)})`);
  const MINT = /\/identity\/session$|\/realtime\/session\/preferences$|\/realtime\/action$|\/decisions\/snapshot$|^\/sort$/;
  const onLoad = [...requests.values()].filter((r) => r.press === 'boot');
  ok('the boot page minted no visitor: no session, no consent, no event and no decision was asked on load', onLoad.every((r) => !MINT.test(r.path)),
    onLoad.map((r) => r.path).join(', ') || 'no API call');
  const B = await evaluate('window.__k5.store()');
  ok('the header is a store\'s: the wordmark, the nav, a search box, Sign in and the cart', B.header.wordmark && B.header.nav > 0 && B.header.search && B.header.signIn && B.header.cart,
    `nav ${B.header.nav}`);
  const open = B.slots.filter((s) => s.cards.length);
  ok('the boot page renders the published template: every slot on screen holds real content (a title, an image where the piece has one), none of it decided',
    open.length > 0 && open.every((s) => s.cards.every((c) => c.title && !c.decided)) && open.some((s) => s.cards.some((c) => c.img)),
    open.map((s) => `${s.slot}: ${s.cards.map((c) => c.cid).join(', ')}`).join(' · '));
  ok('no image on the boot page is broken', B.broken.length === 0, B.broken.join(', '));
  press = 'hand';
  const tile = await evaluate(`(() => { const t = document.querySelector('#catTiles .tile, #view-home .card[data-go-nav], #mainnav [data-nav]:not([data-nav="home"])'); return t ? (t.dataset.nav || t.dataset.goNav) : null; })()`);
  await pressAt(`#catTiles .tile[data-nav="${tile}"], #view-home .card[data-go-nav="${tile}"], #mainnav [data-nav="${tile}"]`);
  const G = await settle(`(() => { const v = document.querySelector('#stage > .view:not([hidden])'); return v && v.querySelector('.pgrid .pcard'); })()`);
  ok(`a tile opens its grid (${tile}): the address bar says ?view=${tile}, and the grid lists the room's products`, G.url.includes(`view=${encodeURIComponent(tile)}`) && G.grid.cards > 0, `${G.url} · ${G.grid.cards} cards · ${G.grid.count}`);
  const minted = [...requests.values()].filter((r) => r.press === 'hand');
  const order = minted.map((r) => r.path);
  ok('the first click minted the visitor (her session, then her consent), then sent the page view', order.some((p) => /\/identity\/session$/.test(p)) && order.some((p) => /preferences$/.test(p))
    && order.findIndex((p) => /\/identity\/session$/.test(p)) < order.findIndex((p) => /\/realtime\/action$/.test(p)), order.join(' → ').slice(0, 240));
  const actions = () => [...requests.values()].filter((r) => /\/realtime\/action$/.test(r.path)).length;
  if (G.grid.filters > 0) {
    const sent = actions();
    await pressAt('#stage > .view:not([hidden]) .filters .fval');
    const F = await settle(`document.querySelector('#stage > .view:not([hidden]) .filters .fval[aria-pressed="true"]')`);
    ok('a filter derived from the attribute map narrows the grid and sends its event', F.grid.cards > 0 && F.grid.cards <= G.grid.cards && actions() > sent, `${G.grid.cards} → ${F.grid.cards} · ${F.grid.count}`);
  } else info('this grid has no attribute with two values, so no filter shows');
  await pressAt('#stage > .view:not([hidden]) .pgrid .pcard');
  const PD = await settle(`(() => { const t = document.getElementById('bbTitle'); return t && t.offsetParent && t.textContent.length > 0 && t.textContent !== 'Product'; })()`);
  ok('a product card opens the product page: its title, its price, Add to cart and where to buy, every one on screen', PD.product.title && /\$/.test(PD.product.price) && PD.product.add && PD.product.retail,
    `${PD.product.title} · ${PD.product.price}`);
  const pdpDecided = PD.slots.filter((s) => s.cards.length);
  if (pdpDecided.length) ok('the product page\'s modules are decided for her, in the engine\'s order', pdpDecided.every((s) => s.cards.every((c) => c.decided)), pdpDecided.map((s) => `${s.slot}: ${s.cards.map((c) => c.cid).join(', ')}`).join(' · '));
  const sentAdd = actions();
  await pressAt('#bbAdd');
  const C = await settle(`(document.querySelector('[data-cart-count]') || {}).textContent === '1'`);
  ok('Add to cart sends the order-start event and the header\'s cart counts it', C.header.count === '1' && actions() > sentAdd, `count ${C.header.count}`);
  await pressAt('[data-act="store-cart-open"]');
  const CS = await settle(`document.querySelector('#sheetBody .st-line')`);
  ok('the cart opens with its line and a total', CS.sheet.open && CS.sheet.lines === 1 && /\$/.test(CS.sheet.total), `${CS.sheet.lines} line · ${CS.sheet.total}`);
  await shot('03-cart');
  await pressAt('#sheetBody [data-act="store-cart-close"]');
  await pressAt('#bbRetail');
  const R = await settle(`document.querySelector('#sheetBody [data-act="store-retailer-buy"], #sheetBody [data-act="store-referral"]')`);
  ok('where to buy opens: buying here first, then the sellers, each button a named outcome', R.sheet.open && R.sheet.buyHere && R.sheet.sellers > 0, `${R.sheet.sellers} seller button(s)`);
  await shot('04-where-to-buy');
  await pressAt('#sheetClose');
  await evaluate('history.back()');
  const BK = await settle(`(() => { const v = document.querySelector('#stage > .view:not([hidden])'); return v && v.querySelector('.pgrid .pcard'); })()`);
  ok('the browser\'s Back returns to the grid', BK.url.includes(`view=${encodeURIComponent(tile)}`) && BK.grid.cards > 0, BK.url);
  await pressAt('#site .wordmark');
  const H = await settle(`(() => { const v = document.querySelector('#stage > .view:not([hidden])'); return v && v.dataset.page === 'home' && v.querySelector('[data-slot] .card[data-op-decision-id]'); })()`);
  const decided = H.slots.filter((s) => s.cards.length);
  ok('the homepage she returns to is decided for her: her own clicks were the evidence', decided.length > 0 && decided.every((s) => s.cards.every((c) => c.decided)),
    decided.map((s) => `${s.slot}: ${s.cards.map((c) => c.cid).join(', ')}`).join(' · '));
  const word = await evaluate(`((document.querySelector('.pgrid .pcard .pname, .rail .pcard .pname') || {}).textContent || '').trim().split(/\\s+/).filter((w) => w.length > 3)[0] || ''`);
  if (word) {
    await evaluate(`(() => { const f = document.querySelector('form[data-store-search]'); f.elements.q.value = ${JSON.stringify(word)}; f.requestSubmit(); })()`);
    const S = await settle(`(() => { const v = document.querySelector('#stage > .view:not([hidden])'); return v && v.dataset.page === 'search' && v.querySelector('.pgrid .pcard'); })()`);
    ok(`the search box finds “${word}” in the feed, in the engine's order`, S.view === 'view-search' && S.grid.cards > 0 && S.url.includes('q='), `${S.grid.cards} · ${S.grid.count}`);
  }
  const refusedHand = refusedIn('hand');
  ok('every call the hand made was answered', refusedHand.length === 0, refusedHand.join(' ~ '));
  const H2 = await evaluate('window.__k5.store()');
  ok('no image broken and no horizontal overflow on the last page', H2.broken.length === 0 && H2.overflow <= 1, `${H2.broken.length} broken · ${H2.overflow}px`);
  // The walk starts from a fresh page, as a presenter's would.
  await cdp('Page.navigate', { url });
  await booted();
  await evaluate(inPage(pageHelpers));

  // ── Act 1, beat 1: the stranger, her region from the request ─────────────
  press = 0;
  console.log(`\n── 1 · ${await evaluate(`window.${HOOK}.beats()[0].label()`)}`);
  const landed1 = await runBeat(0);
  await sleep(SETTLE_MS);
  const S1 = await evaluate('window.__k4.snapshot()');
  ok('beat 1 lands', landed1 === 'done', landed1);
  for (const s of S1.slots) {
    if (s.gated) ok(`${s.slot} is gated and stays off the page for a stranger`, !s.shown, s.shown ? `${s.cards.length} card(s) shown` : 'not shown');
    else ok(`${s.slot} shows what the engine decided, on screen`, s.shown && s.cards.length > 0 && s.cards.every((c) => c.decided), s.cards.map((c) => c.title).join(' | '));
  }
  const fromRequest = has(S1.cold.text, 'from the request') && (LOOPBACK ? has(S1.cold.text, 'local runtime') : has(S1.cold.text, 'the edge located her'));
  const none = has(S1.cold.text, 'no region on this request');
  ok(`the Arrival panel says the region comes from the request${LOOPBACK ? ' (locally: as the runtime fills request.cf, not an edge)' : ''}, or that there is none`,
    S1.cold.ok && (fromRequest || none) && !has(S1.cold.text, 'asserted, not observed'), S1.cold.text.slice(0, 200));
  ok('the Arrival panel shows the census as shown, never scored', has(S1.cold.text, 'never scored'));
  const asked1 = [...requests.values()].filter((r) => r.press === 0 && /\/decisions\/snapshot/.test(r.path));
  ok('no snapshot of beat 1 asserted a region', asked1.length > 0 && asked1.every((r) => !/[?&]ctx\.region=/.test(r.url)), `${asked1.length} snapshot(s)`);
  ok('the director\'s sentence for beat 1 is on screen', S1.lineOk && S1.line.length > 20, S1.line.slice(0, 100));
  ok('no image on the page is broken', S1.broken.length === 0, S1.broken.join(', '));
  const refused1 = refusedIn(0);
  ok('every call beat 1 made was answered', refused1.length === 0, refused1.join(' ~ '));
  info(`${S1.slots.map((s) => `${s.slot}: ${s.cards.map((c) => c.title).join(' | ') || '—'}`).join(' · ')} · ${S1.ctx}`);
  await shot('01-arrival');

  // ── Act 1, beat 2: the contrast, asserted and labelled ───────────────────
  press = 1;
  console.log(`\n── 2 · ${await evaluate(`window.${HOOK}.beats()[1].label()`)}`);
  const landed2 = await runBeat(1);
  await sleep(SETTLE_MS);
  const S2 = await evaluate('window.__k4.snapshot()');
  ok('beat 2 lands', landed2 === 'done', landed2);
  ok('the region is asserted on the request and labelled so, in the context chips and on the Arrival panel', has(S2.ctx, 'asserted') && has(S2.cold.text, 'asserted'),
    `${S2.ctx} · ${S2.cold.text.slice(0, 120)}`);
  const asked2 = [...requests.values()].filter((r) => r.press === 1 && /\/decisions\/snapshot/.test(r.path));
  ok('the homepage was asked again with the asserted region', asked2.length > 0 && asked2.every((r) => /[?&]ctx\.region=US-[A-Z]{2}/.test(r.url)), `${asked2.length} snapshot(s)`);
  ok('every decided slot still shows what the engine decided', S2.slots.filter((s) => !s.gated).every((s) => s.shown && s.cards.length > 0));
  await shot('02-contrast');

  console.log('\n── The wire, for the arrival');
  const { api } = auditWire(checks, wire, { tenant: TENANT });
  info(tallyWire(api, { tenant: TENANT }));
  checkScriptErrors(checks, wire);
} catch (error) {
  checks.fail(`the walk threw at press ${press}: ${error.message}`);
} finally {
  console.log('\n── The tenant is left at its opening state');
  try {
    const res = await fetch(`${base}${API}/reset`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Tenant': TENANT }, body: '{}' });
    const out = await res.json().catch(() => ({}));
    ok(`POST ${API}/reset republishes the opening slots, then the opening catalog`, out.ok === true && (out.applied || []).map((x) => x.name).join(',') === 'open-slots,open-catalog');
  } catch (error) { ok(`POST ${API}/reset`, false, error.message); }
  await browser.close(port);
}

checks.summary({ failed: 'do not hand this over', passed: `@@NAME@@'s arrival runs in the real page, and every effect has a visible cause` });
process.exit(checks.exitCode());
