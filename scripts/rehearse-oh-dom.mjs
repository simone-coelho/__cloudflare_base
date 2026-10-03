#!/usr/bin/env node
// scripts/rehearse-oh-dom.mjs: press OH's director buttons, for real.
//
// It loads the actual page (public/oh/index.html, product.html, m.html and oh.js, served by the worker) into
// headless Chrome with a fresh profile, and runs the director's sixteen presses through the page's own hook,
// window.__oh.go(i) under ?debug=1: the same function the director bar's Next button calls. Every answer is read off
// what a person would see: computed style up the whole ancestor chain and a real layout box (the kit's lib/cdp.mjs),
// never an attribute or a hidden flag. After every press it asks: did it land, did the service answer, is it legible
// (the director's sentence, the before/now row), does the page render the engine's answer in the engine's order (the
// page never ranks), does Compare open on two frames of real pixels, and did the named thing happen.
//
// Before the walk, every shell (the homepage, the TV grid, a TV, a washer and a range page, the phone) is loaded at
// 1440 and at 1366: no horizontal overflow, no broken image, with the page scrolled through so lazy images load.
// The wire is watched for the whole run: every API call carries X-Tenant: oh, none goes to /content, /config or /ops,
// none carries Authorization, a beat goes by name with no document, and the page throws no script error.
//
// Lane S1 (docs/lg/lanes/P.md) owns this file. A beat whose run in public/oh/beats.json is still `notBuilt` is pressed
// once to prove it says so and stops (never a silent "done"), and is reported as open by lane; a built beat runs its
// outcomes below. Fresh visitor, the before/now row, the sign-in receipt line, the two outcomes and the day report are
// asserted from the press that carries them as each lane lands it.
//
//   node scripts/rehearse-oh-dom.mjs [--base http://localhost:9120] [--size 1440x900] [--chrome "<path>"] [--shots <dir>] [--strict]
//   node scripts/demo-kit/rehearse.mjs --config oh --suite dom --base <url>      (the same, through the kit)
//
// It holds no credential and takes no token, and it ends with POST /oh/api/reset. Run it from Windows (Node 22+).
import { apiPaths, auditWire, checkDemoRouteBodies, checkScriptErrors, findChrome, header, inPage, launchChrome, parseSize, pressTimer, recordWire, screenshotter,
  tallyWire } from './demo-kit/lib/cdp.mjs';
import { createChecks, flagReader, sleep } from './demo-kit/lib/rehearse.mjs';

const arg = flagReader();
const base = arg('--base', 'http://localhost:9120').replace(/\/+$/, '');
const [WIDTH, HEIGHT] = parseSize(arg('--size', '1440x900'));
const SHOTS = arg('--shots', null);
const ONLY_STORE = arg('--only', null) === 'store';   // lane S2: the boot page and the manual session alone (mutation runs)
const SLUG = 'oh', TENANT = 'oh', API = `/${SLUG}/api`, HOOK = '__oh';
const SETTLE_MS = 1500;
const SIZES = [[1440, 900], [1366, 768]];
const checks = createChecks({ infoIndent: 8, strict: process.argv.includes('--strict') });
const { ok, info } = checks;
const has = (text, needle) => String(text || '').toLowerCase().includes(String(needle).toLowerCase());
const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const CHROME = findChrome([arg('--chrome'), process.env.CHROME_PATH]);
if (!CHROME) { console.log('✗ no Chrome or Edge found; pass --chrome "<path>"'); process.exit(1); }
if (typeof WebSocket === 'undefined') { console.log('✗ this suite needs Node 22 or later (a global WebSocket)'); process.exit(1); }
const browser = launchChrome({ chrome: CHROME, width: WIDTH, height: HEIGHT, profilePrefix: `${SLUG}-rehearsal-chrome-` });
const { cdp, evaluate, waitFor } = browser;
const shot = screenshotter({ browser, dir: SHOTS, prefix: 'S1', width: WIDTH, info });

let press = 'boot';
const wire = recordWire(browser, { api: apiPaths(API), keepBody: new RegExp(`^${API}/(beat|reset)$|^/realtime/action$|^/sort$`), pressNow: () => press });
const { requests, refusedIn } = wire;
/** Each request's document load (CDP loaderId): a page's own calls, told apart from a previous page's still in flight (lane S2). */
const LOADER = new Map();
browser.on('Network.requestWillBeSent', (e) => LOADER.set(e.requestId, e.loaderId));
/** When each request's response arrived (lane S2): an action's own round trip, request to response. */
const ANSWERED = new Map();
browser.on('Network.responseReceived', (e) => ANSWERED.set(e.requestId, Date.now()));
/** A fresh visitor's tab (lane S2): Storage.clearDataForOrigin leaves the tab's own sessionStorage, where the store mirrors her
 *  kept visitor (M3), and DOMStorage.clear does not reach it either; and a clear can still be in flight when the next page
 *  writes (hosted, with a full cache). So from a document of the site's own origin that runs no page script (the served
 *  stylesheet) both stores are cleared, a probe is written, and a second later the probe must still be there and nothing
 *  else: the storage is writable, empty and settled. Retried until it holds; then the tab leaves for about:blank. */
async function forgetTab() {
  const origin = new URL(base).origin;
  await cdp('Page.navigate', { url: `${origin}/${SLUG}/oh.css` });
  await waitFor(`location.origin === ${JSON.stringify(origin)} && document.readyState === 'complete'`, 10000);
  const CLEAR = `(() => { if (location.origin !== ${JSON.stringify(origin)}) return 'not on the origin'; try { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('s2-settle', '1'); return localStorage.length === 1 && sessionStorage.length === 0; } catch (e) { return String(e); } })()`;
  let held = false, tries = 0;
  while (!held && tries < 10) {
    tries += 1;
    const w = await evaluate(CLEAR);
    if (w !== true) throw new Error(`the tab's storage is not writable: ${w}`);
    await sleep(1000);
    held = await evaluate("localStorage.getItem('s2-settle') === '1' && localStorage.length === 1 && sessionStorage.length === 0");
  }
  const left = await evaluate("(() => { localStorage.removeItem('s2-settle'); return localStorage.length + sessionStorage.length; })()");
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(200);
  return { settled: held && left === 0, tries };
}


// ── What a person sees: computed style up the chain, and a real box ──────────
function pageHelpers({ vis, txt, own, shown }) {
  const viewEl = () => [...document.querySelectorAll('#stage > .view')].find((v) => vis(v).ok) || null;
  /** The decided containers of a module, in the order they stand on the page: the outermost elements carrying a decision id. */
  const decidedIn = (m) => [...m.querySelectorAll('[data-op-decision-id]')].filter((e) => e.dataset.opDecisionId)
    .filter((e) => { const up = e.parentElement && e.parentElement.closest('[data-op-decision-id]'); return !up || up === m || !m.contains(up); })
    .map((e) => ({ cid: e.dataset.cid || '', content: e.dataset.opContent || '', decided: Boolean(e.dataset.opDecisionId), shown: vis(e).ok,
      title: txt(e.querySelector('h3, h4, .title, .ptitle, .dtitle')) || txt(e).slice(0, 80), text: txt(e).slice(0, 400) }));
  const snapshot = () => {
    const v = viewEl();
    return {
      status: (document.getElementById('status') || {}).textContent || '',
      line: txt('#engineLine'), lineOk: vis('#engineLine').ok, beatNo: txt('#beatNo'),
      wordmark: { ...vis('#wordmark'), text: txt('#wordmark'), color: getComputedStyle(document.getElementById('wordmark')).color },
      brand: getComputedStyle(document.documentElement).getPropertyValue('--brand').trim(),
      machine: vis('#machine').ok, director: vis('.director').ok,
      view: v ? v.dataset.page : null, address: location.pathname + location.search,
      slots: v ? [...v.querySelectorAll('[data-slot]')].map((m) => ({ slot: m.dataset.slot, gated: m.dataset.gated === 'true', shown: vis(m).ok, inView: vis(m).inView,
        cards: decidedIn(m).filter((c) => c.shown) })) : [],
      rails: v ? [...v.querySelectorAll('[id^="rail-"]')].map((r) => ({ rail: r.id.replace(/^rail-/, ''), shown: vis(r).ok,
        items: shown('[data-open]', r).map((c) => ({ sku: c.dataset.open, name: txt(c.querySelector('.pname, h3, .title')) || txt(c).slice(0, 60) })),
        chip: txt(document.getElementById(`chip-${r.id.replace(/^rail-/, '')}`)), lean: txt(r.closest('[data-slot], section') ? r.closest('[data-slot], section').querySelector('.lean, .rail-lean, [data-lean]') : null) })) : [],
      // The before/now strips the kit draws (deltas.js): a list of rows with a sign, or "nothing moved", and the before half.
      strips: v ? [...v.querySelectorAll('ul, ol')].filter((l) => l.querySelector(':scope > li > .sign, :scope > li.delta-none, :scope > li.delta-hinge'))
        .map((l) => ({ module: (l.closest('[data-slot]') || {}).dataset ? l.closest('[data-slot]').dataset.slot : (l.closest('section') || {}).id || '', shown: vis(l).ok,
          rows: [...l.children].filter((li) => vis(li).ok).map(txt).filter(Boolean),
          before: (() => { const box = l.parentElement; const g = box ? [...box.querySelectorAll('.ghost, .ghost-empty')].filter((x) => vis(x).ok) : []; return g.length; })() })) : [],
      down: [...document.querySelectorAll('.engine-down')].filter((n) => vis(n).ok).map(txt),
      cold: { ok: vis('#coldStart').ok, text: txt('#coldStart') },
      ctx: txt('#ctxChips'), who: txt('#whoChip'),
      compare: (() => {
        const box = (sel) => { const b = vis(sel); return b.ok ? { w: b.w, h: b.h } : null; };
        return { ok: vis('#cmp-back').ok, title: txt('#cmp-title'),
          mode: ['seam', 'split', 'details'].find((m) => { const b = document.getElementById(`cmp-mode-${m}`); return b && vis(b).ok && b.classList.contains('on') && !b.disabled; }) || null,
          msg: vis('#cmp-msg').ok ? txt('#cmp-msg') : '',
          tags: { before: vis('#cmp-tag-before').ok ? txt('#cmp-tag-before') : '', now: vis('#cmp-tag-now').ok ? txt('#cmp-tag-now') : '' },
          frames: { before: box('#cmp-before'), now: box('#cmp-after') },
          hint: vis('#cmp-hint').ok ? txt('#cmp-hint') : '', caption: vis('#cmp-caption').ok ? txt('#cmp-caption') : '',
          cols: shown('#cmpCols .cmp-col').map((c) => ({ head: txt(c.querySelector('h3')), lists: [...c.querySelectorAll('.cmp-list')].map((ol) => [...ol.querySelectorAll('li')].map((li) => txt(li.children[1]))) })) };
      })(),
      tools: [...document.querySelectorAll('#compareTools button[data-tool]')].map((b) => b.dataset.tool),
      // The product page (lane P2): the buy box, the decided modules with their rule, lists and receipt, the withdrawn cards, the fit tool.
      buyBox: (() => { const bb = document.getElementById('buyBox'); const r = bb && vis(bb).ok ? bb.getBoundingClientRect() : null;
        return { ok: Boolean(r), bottom: r ? Math.round(r.bottom + scrollY) : null, offlimits: vis('#buyBox .offlimits').ok ? txt('#buyBox .offlimits') : '', price: txt('#bbPrice'),
          fin: vis('#bbFin').ok ? txt('#bbFin') : '', decidedInside: bb ? bb.querySelectorAll('[data-op-decision-id]:not([data-op-decision-id=""])').length : 0 }; })(),
      modules: shown('#slot-pdp-modules > article.pmod').map((m) => ({ cid: m.dataset.cid, title: txt(m.querySelector('h3')), rule: txt(m.querySelector('.pmod-rule')),
        lead: [...m.querySelectorAll('.pmod-lead')].filter((x) => vis(x).ok).map(txt).join(' '), say: txt(m.querySelector('.pdp-say')), same: [...m.querySelectorAll('.pdp-same')].filter((x) => vis(x).ok).map(txt).join(' '),
        receipt: txt(m.querySelector('.receipt')), tiles: shown('[data-open]', m).map((t) => ({ sku: t.dataset.open, tag: txt(t.querySelector('.ptag')) })), top: Math.round(m.getBoundingClientRect().top + scrollY), text: txt(m).slice(0, 600) })),
      gone: shown('#pdpGone .pmod-gone').map((g) => ({ cid: g.dataset.gone, text: txt(g) })),
      fit: shown('#stage > .view:not([hidden]) [data-fit]').map(txt),
      meters: shown('#vectors .vecrow').map((row) => ({ value: own(row.querySelector('.vectop span')), label: txt(row.querySelector('.vectop em')), a: Number(txt(row.querySelector('.vectop b'))), fresh: row.classList.contains('vecrow--fresh') })),
      // The homepage (lane P1): the arrival line, each rail's chip, lean line and rank lines, the continue hero, the sheet.
      arrival: vis('#p1Arrival').ok ? txt('#p1Arrival') : '',
      railsOn: ['for-you', 'tv-grid'].map((k) => ({ rail: k, shown: vis(`#rail-${k}`).ok, chip: txt(`#chip-${k}`), lean: vis(`#lean-${k}`).ok ? txt(`#lean-${k}`) : '',
        cards: shown(`#rail-${k} [data-open]`).map((c) => ({ sku: c.dataset.open, rank: txt(c.querySelector('.p1-rank')) })) })),
      cont: { shown: vis('#mod-continue').ok, text: vis('#mod-continue').ok ? txt('#mod-continue') : '', receipt: txt('#slot-continue .receipt') },
      sheet: { shown: vis('#sheet').ok || vis('#sheetBody').ok, text: vis('#sheetBody').ok ? txt('#sheetBody') : '', items: shown('#sheetBody .p1-chg').map((x) => ({ name: txt(x.querySelector('h3')), rows: [...x.querySelectorAll('.srow')].map(txt), sku: (x.querySelector('[data-open]') || { dataset: {} }).dataset.open || null })) },
      overflow: document.documentElement.scrollWidth - innerWidth,
      broken: [...document.images].filter((i) => vis(i).ok && i.complete && i.naturalWidth === 0).map((i) => i.getAttribute('src')),
      pending: [...document.images].filter((i) => vis(i).ok && !i.complete).length,
      pendingSrc: [...document.images].filter((i) => vis(i).ok && !i.complete).map((i) => i.currentSrc || i.src),
      images: [...document.images].filter((i) => vis(i).ok).length,
    };
  };
  /** The two frames' own pixels, sampled at 1/8 scale (lane C2's measure): ink is the share not the frame's commonest colour. */
  const framePixels = async (ids = ['cmp-before', 'cmp-after']) => {
    const urlOf = (id) => { const el = document.getElementById(id); const m = el && /url\("?(.*?)"?\)$/.exec(getComputedStyle(el).backgroundImage || ''); return m ? m[1] : null; };
    const load = (u) => new Promise((r) => { if (!u) { r(null); return; } const im = new Image(); im.onload = () => r(im); im.onerror = () => r(null); im.src = u; });
    const sample = (im) => {
      const w = Math.max(1, Math.ceil(im.naturalWidth / 8)), h = Math.max(1, Math.ceil(im.naturalHeight / 8));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h).data, count = new Map();
      for (let i = 0; i < d.length; i += 4) { const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4); count.set(key, (count.get(key) || 0) + 1); }
      return { w: im.naturalWidth, h: im.naturalHeight, sw: w, sh: h, d, ink: 1 - Math.max(...count.values()) / (d.length / 4) };
    };
    const urls = ids.map(urlOf);
    const [a, b] = (await Promise.all(urls.map(load))).map((im) => (im ? sample(im) : null));
    let differ = null;
    if (a && b) {
      const w = Math.min(a.sw, b.sw), h = Math.min(a.sh, b.sh);
      let n = 0;
      for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
        const i = (y * a.sw + x) * 4, j = (y * b.sw + x) * 4;
        if (Math.abs(a.d[i] - b.d[j]) > 24 || Math.abs(a.d[i + 1] - b.d[j + 1]) > 24 || Math.abs(a.d[i + 2] - b.d[j + 2]) > 24) n += 1;
      }
      differ = w * h ? n / (w * h) : 0;
    }
    const out = (s) => (s ? { w: s.w, h: s.h, ink: Number(s.ink.toFixed(4)) } : null);
    return { before: out(a), now: out(b), differ: differ === null ? null : Number(differ.toFixed(4)) };
  };
  /** Scroll the page through, top to bottom and back, so lazy images are asked for, as a person scrolling would. */
  const scrollThrough = async () => {
    const step = Math.max(200, innerHeight - 100);
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
    window.scrollTo(0, 0);
  };
  /** An image the page shows but has not loaded yet (lazy, below its own scroller): loaded in a detached Image, the page untouched. */
  const loads = (src) => new Promise((r) => { const im = new Image(); const t = setTimeout(() => r({ src, ok: false, why: 'timed out' }), 15000);
    im.onload = () => { clearTimeout(t); r({ src, ok: im.naturalWidth > 0, why: im.naturalWidth > 0 ? '' : 'no pixels' }); }; im.onerror = () => { clearTimeout(t); r({ src, ok: false, why: 'error' }); }; im.src = src; });
  const pendingLoad = async () => Promise.all([...new Set(snapshot().pendingSrc)].map(loads));
  // ── Lane S2: the store as she sees it (oh-store.js's markup, its contract) and LG's look as computed style ──
  const storeView = () => {
    const sheetOn = vis('#sheetBack').ok && vis('#sheetBody').ok;
    const body = document.getElementById('sheetBody');
    const inSheet = (sel) => (sheetOn && body ? [...body.querySelectorAll(sel)].filter((e) => vis(e).ok) : []);
    return {
      address: location.pathname + location.search, view: (viewEl() || { dataset: {} }).dataset.page || null,
      header: (() => { const h = document.querySelector('#site .site-header'); const b = h ? vis(h) : { ok: false };
        return { ok: b.ok, h: b.h || 0, bg: h ? getComputedStyle(h).backgroundColor : '', text: b.ok ? txt(h).slice(0, 300) : '' }; })(),
      cartCount: [...document.querySelectorAll('#site .site-header [data-cart-count]')].filter((e) => vis(e).ok).map(txt),
      sheet: { open: sheetOn, title: sheetOn ? txt('#sheetTitle') : '', kicker: sheetOn ? txt(body.querySelector('.sk')) : '', text: sheetOn ? txt(body).slice(0, 900) : '' },
      cart: { lines: inSheet('.st-line').map((l) => ({ line: l.dataset.line, name: txt(l.querySelector('.st-line-name')), sku: txt(l.querySelector('.st-line-sku')),
        qty: txt(l.querySelector('[data-qty-of]')), price: own(l.querySelector('.st-line-price')), addOns: [...l.querySelectorAll('.st-line-add')].map(txt) })),
        rows: inSheet('.srow').map((r) => [txt(r.firstElementChild), txt(r.lastElementChild)]), total: inSheet('[data-cart-total]').map(txt)[0] || '',
        savings: inSheet('.st-saving').map(txt), checkout: inSheet('[data-act="store-cart-checkout"]').length },
      retailers: { heads: inSheet('.st-h').map(txt), online: inSheet('[data-act="store-referral"][data-where="online"]').map((b) => b.dataset.retailerName),
        nearby: inSheet('[data-act="store-referral"][data-where="nearby"]').map((b) => b.dataset.retailerName),
        onlineKeys: inSheet('[data-act="store-referral"][data-where="online"]').map((b) => b.dataset.retailer),
        source: (inSheet('[data-retailer-source]')[0] || { dataset: {} }).dataset.retailerSource || '',
        nearbyLines: inSheet('.srow').filter((r) => r.querySelector('[data-where="nearby"]')).map(txt),
        direct: inSheet('[data-act="store-retailer-buy"]').length, pickup: inSheet('[data-act="store-pickup"]').length, fine: inSheet('.st-fine').map(txt).join(' ') },
      toast: vis('#storeToast').ok ? txt('#storeToast') : '',
    };
  };
  /** LG's look (design §9.1), read as computed style over what a visitor sees of the site (the presenter's tools apart). */
  const lookOf = () => {
    const TOOLS = '.machine, #machine, .director, .pd-back, #cmp-back, #demo-cursor, .back-chip, .fixture-flag, #sheetBack > .sheet-x';
    const parse = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return null; const [r, g, b, a = 1] = m[1].split(',').map((x) => Number(x.trim())); return { r, g, b, a }; };
    const hsl = ({ r, g, b }) => { r /= 255; g /= 255; b /= 255; const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2; let h = 0, s = 0;
      if (max !== min) { const d = max - min; s = l > 0.5 ? d / (2 - max - min) : d / (max + min); h = (max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60; } return { h, s, l }; };
    const yellow = (c) => { const x = parse(c); if (!x || x.a < 0.3) return false; const { h, s, l } = hsl(x); return h >= 42 && h <= 72 && s >= 0.55 && l >= 0.35 && l <= 0.88; };
    const nearBlack = (c) => { const x = parse(c); return Boolean(x && x.a >= 0.9 && x.r < 48 && x.g < 48 && x.b < 48); };
    const light = (c) => { const x = parse(c); return !x || x.a < 0.15 || hsl(x).l >= 0.9; };
    const name = (n) => (n.id ? '#' + n.id : n.tagName.toLowerCase() + (typeof n.className === 'string' && n.className.trim() ? '.' + n.className.trim().split(/\s+/)[0] : ''));
    const els = [...document.querySelectorAll('#site *, #sheetBack *')].filter((e) => !e.closest(TOOLS) && vis(e).ok);
    const yellows = [], bars = [], fills = [], offs = [];
    for (const e of els) {
      const cs = getComputedStyle(e);
      for (const [k, c] of [['background', cs.backgroundColor], ['text', cs.color], ['border', cs.borderTopWidth !== '0px' ? cs.borderTopColor : '']]) if (yellow(c)) yellows.push(name(e) + ' ' + k + ' ' + c);
      const r = e.getBoundingClientRect();
      if (r.width >= innerWidth * 0.5 && r.height >= 16 && nearBlack(cs.backgroundColor) && !e.closest('#m1Pencil')) bars.push(name(e) + ' ' + Math.round(r.width) + '×' + Math.round(r.height) + ' ' + cs.backgroundColor);
      const isButton = e.matches('button, .btn, a.btn, [role="button"], input[type="submit"]') && !e.disabled && e.getAttribute('aria-disabled') !== 'true' && (txt(e).length >= 2 || (e.value || '').length >= 2);
      if (isButton && !light(cs.backgroundColor)) fills.push({ el: name(e), text: txt(e).slice(0, 40), bg: cs.backgroundColor, color: cs.color, radius: cs.borderTopLeftRadius, h: Math.round(r.height) });
      if (e instanceof HTMLElement && !e.children.length && /^\$[\d,]+(?:\.\d{2})?\s+OFF$/i.test(txt(e))) offs.push({ el: name(e), text: txt(e), color: cs.color });
    }
    const wm = document.getElementById('wordmark');
    const siteEl = document.getElementById('site') || document.body, navBtn = document.querySelector('#site .site-header .mainnav button');
    return { yellows: [...new Set(yellows)], bars, fills, offs, body: getComputedStyle(document.body).backgroundColor, font: getComputedStyle(document.body).fontFamily,
      site: getComputedStyle(siteEl).backgroundColor, siteFont: getComputedStyle(siteEl).fontFamily, navFont: navBtn ? getComputedStyle(navBtn).fontFamily : '',
      fontLoaded: Boolean(document.fonts && document.fonts.check('500 16px Figtree')),
      ink: getComputedStyle(document.querySelector('#site') || document.body).color, wordmark: wm ? { text: txt(wm), color: getComputedStyle(wm).color, shown: vis(wm).ok } : null };
  };
  window.__s1 = { vis, txt, snapshot, framePixels, scrollThrough, pendingLoad, store: storeView, look: lookOf };
  return true;
}
const rgb = (hex) => { const h = hex.replace('#', ''); const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h; return `rgb(${[0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)).join(', ')})`; };
const runBeat = (i) => evaluate(`(async () => { const run = window.${HOOK}.go(${i}); if (run === undefined) return 'busy'; await run; return document.getElementById('status').textContent; })()`);
const snap = () => evaluate('window.__s1.snapshot()');
const booted = () => waitFor("/^ready|error|missing|failed|beats\\.json/i.test((document.getElementById('status') || {}).textContent || '')", 30000);
async function load(url, { width = WIDTH, height = HEIGHT } = {}) {
  await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url });
  const up = await booted();
  await evaluate(inPage(pageHelpers));
  return up;
}
/** Every image on screen settled: scrolled through, then until none is still loading (or 10 s). */
async function imagesSettled() {
  await evaluate('window.__s1.scrollThrough()');
  await waitFor('window.__s1.snapshot().pending === 0', 10000);
}

// ── The data the suite reads to know what each beat claims ───────────────────
const getJson = async (path) => (await fetch(`${base}/${SLUG}/${path}`, { cache: 'no-store' })).json();
const demoConfig = await getJson('demo.config.json');
const beatsDoc = await getJson('beats.json');
const anchor = await getJson('beats/anchor.json');
const catalog = await getJson('catalog.json');
const productsDoc = await getJson('products.json');
const openCatalog = (await getJson('beats/open-catalog.json')).publish.document;
const TITLE = Object.fromEntries((catalog.pieces || []).map((p) => [p.customerContentId, p.title]));
const CID = new Map((openCatalog.pieces || []).map((p) => [p.id, p.customerContentId]));
const products = productsDoc.products || [];
const firstOf = (family, prefer) => (prefer && products.find((p) => p.sku === prefer)) || products.find((p) => p.family === family) || null;
const PDP = { tv: firstOf('oled-tv'), washer: firstOf('front-load-washer', 'WM1455HWA'), range: firstOf('electric-range') };
// The product pages' data, as the page merges it (lane P2): the feed with specs.json over it by sku; the walk's products
// read from the page's own P2_WALK, so the suite follows what the page presses.
const specsDoc = await getJson('specs.json').catch(() => null);
const overlay = new Map(((specsDoc && (specsDoc.specs || specsDoc.products || specsDoc.rows)) || []).filter((r) => r && r.sku).map((r) => [String(r.sku), r]));
const rowsAll = products.map((p) => (overlay.has(String(p.sku)) ? { ...p, ...overlay.get(String(p.sku)) } : p));
const row = (sku) => rowsAll.find((p) => String(p.sku) === String(sku)) || null;
const ohJs = await (await fetch(`${base}/${SLUG}/${SLUG}.js`, { cache: 'no-store' })).text();
const WALK = (() => { const m = /\bconst P2_WALK = \{([^}]*)\}/.exec(ohJs); const out = {};
  for (const [, k, v] of String(m ? m[1] : '').matchAll(/([\w$]+):\s*('[^']*'|"[^"]*"|[\d.]+)/g)) out[k] = /^['"]/.test(v) ? v.slice(1, -1) : Number(v); return out; })();
const widthOf = (p) => { const s = p && Number(p.width); if (Number.isFinite(s) && s > 0) return s; const f = p && p.fits && Number(p.fits.width); return Number.isFinite(f) && f > 0 ? f : null; };   // the lead's ruling: the product page's width, else the feed's
const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fuelWords = (f) => String(f || '').replace(/-/g, ' ');
/** The image failures the page saw (recorded before its own handler swaps a failed image for a name tile), read and cleared. */
const IMG_ERRORS = "window.__s1imgErrors = []; document.addEventListener('error', (e) => { const t = e.target; if (t && t.tagName === 'IMG') window.__s1imgErrors.push(t.currentSrc || t.src || t.getAttribute('src')); }, true);";
const imgErrors = () => evaluate('(() => { const x = (window.__s1imgErrors || []).slice(); window.__s1imgErrors = []; return x; })()');
const built = (b) => !JSON.stringify(b.run || []).includes('"call":"notBuilt"');
const laneOf = (b) => (/"lane":"(P\d)"/.exec(JSON.stringify(b.run || [])) || [])[1] || 'a page lane';
const coldstart = async (region) => (await fetch(`${base}${API}/coldstart${region ? `?region=${region}` : ''}`, { headers: { 'X-Tenant': TENANT, 'X-SDK-Key': 'demo-site' } })).json().catch(() => null);

/** The engine's answer behind the page on screen: the latest snapshot of this press for the view's page, read off the wire. */
/** Her capability as the page holds it under ?debug (compared with the wire's X-Shopper-Session, never printed). */
const herCap = () => evaluate(`(() => { const s = window.${HOOK} && window.${HOOK}.state; const v = s && s.who ? s.visitors[s.who] : null; return v && v.session ? v.session.capability : null; })()`);
async function engineAnswer(pressKey, pageKey) {
  const cap = await herCap();
  const list = [...requests.entries()].filter(([, r]) => r.press === pressKey && /\/decisions\/snapshot/.test(r.path) && r.status === 200
    && new URL(r.url).searchParams.get('page') === pageKey && (!cap || header(r, 'X-Shopper-Session') === cap));
  // A press that asked nothing new for this page (a sheet, a tool) shows the last answer the page holds for her there.
  const earlier = list.length ? [] : [...requests.entries()].filter(([, r]) => typeof r.press === 'number' && r.press <= pressKey && /\/decisions\/snapshot/.test(r.path) && r.status === 200
    && new URL(r.url).searchParams.get('page') === pageKey && (!cap || header(r, 'X-Shopper-Session') === cap));
  for (const [id] of [...list, ...earlier].reverse()) {
    try { const b = await cdp('Network.getResponseBody', { requestId: id }); const body = JSON.parse(b.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : b.body); if (Array.isArray(body.decisions)) return body; } catch { /* evicted */ }
  }
  return null;
}
/** The page never ranks, on screen: each decided slot shows the engine's decisions for it in the engine's own order. */
async function inEngineOrder(label, S, pressKey) {
  const decided = S.slots.filter((s) => s.shown && s.cards.length);
  if (!decided.length) return info(`${label}: no decided slot on screen to read the order of`);
  const answer = await engineAnswer(pressKey, S.view === 'tvs' ? 'tvs' : S.view);
  if (!answer) return ok(`${label}: the page renders the engine's answer in the engine's order`, false, `no snapshot for the ${S.view} page read off this press's wire`);
  const wrong = [];
  for (const s of decided) {
    const engine = answer.decisions.filter((d) => d.slot === s.slot).sort((a, b) => a.order - b.order);
    const shown = s.cards.map((c) => c.cid || CID.get(c.content) || c.content);
    const onPage = new URLSearchParams(String(S.address).split('?')[1] || '').get('id');
    const noLowerSet = s.slot === 'pdp-modules' && onPage && !setsOf(row(onPage)).some((x) => x.lower);   // R4 F7 (S2): the set-price card's own condition
    const want = engine.map((d) => d.customerContentId).filter((cid) => !(noLowerSet && cid === 'mod-laundry-pair-price'));
    if (!sameJSON(shown, want)) wrong.push(`${s.slot}: on screen ${shown.join(', ')} · the engine ${want.join(', ')}`);
  }
  return ok(`${label}: the page renders the engine's answer in the engine's order, every decided slot on screen`, wrong.length === 0,
    wrong.join(' ~ ').slice(0, 300) || decided.map((s) => `${s.slot} ${s.cards.length}`).join(' · '));
}

/** The product page on screen is the one the beat opened, its buy box off limits. */
function productOnScreen(S, p) {
  ok(`the ${p.name} page is on screen (${p.sku}), its buy box off limits`, S.view === 'product' && new URLSearchParams(String(S.address).split('?')[1] || '').get('id') === p.sku
    && has(S.buyBox.offlimits, 'Off limits'), `${S.address} · ${S.buyBox.offlimits.slice(0, 80)}`);
}
/** The products she opened on this device, as the page sent them: her own product_view events, read off the wire. */
async function openedByHer() {
  const cap = await herCap();
  return new Set([...requests.values()].filter((r) => r.path === '/realtime/action' && header(r, 'X-Shopper-Session') === cap).map((r) => {
    try { const b = JSON.parse(r.body); return b.type === 'product_view' && b.data ? String(b.data.productId) : null; } catch { return null; } }).filter(Boolean));
}
/** Each /sort rail on screen is in the order POST /sort answered for her: the latest answer whose candidates hold the rail's cards. */
async function railsInSortOrder(S, pressKey) {
  const cap = await herCap();
  const wrong = [], read = [];
  for (const r of S.railsOn.filter((x) => x.shown && x.cards.length > 1)) {
    const skus = r.cards.map((c) => String(c.sku));
    // The rail's own question: its published weights on the body (each rail has its own), and candidates that hold its cards.
    const want = (demoConfig.pages.flatMap((pg) => pg.sorted || []).find((x) => x.slot === r.rail) || {}).weights || null;
    const sorts = [...requests.entries()].filter(([, q]) => q.path === '/sort' && q.status === 200 && typeof q.press === 'number' && q.press <= pressKey && header(q, 'X-Shopper-Session') === cap
      && (() => { try { const body = JSON.parse(q.body); const ids = new Set(body.candidates.map((c) => String(c.id)));
        const dims = (body.weights && body.weights.dims) || {}; const same = !want || Object.entries(want).every(([k, w]) => Number(dims[k]) === Number(w));
        return same && skus.every((x) => ids.has(x)); } catch { return false; } })());
    let order = null;
    for (const [id] of sorts.reverse()) { try { const b = await cdp('Network.getResponseBody', { requestId: id }); const body = JSON.parse(b.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : b.body); if (Array.isArray(body.order)) { order = body.order.map(String); break; } } catch { /* evicted */ } }
    if (!order) { wrong.push(`${r.rail}: no /sort answer for her holding these cards`); continue; }
    read.push(r.rail);
    if (!sameJSON(skus, order.slice(0, skus.length))) wrong.push(`${r.rail}: on screen ${skus.slice(0, 4).join(', ')} · /sort ${order.slice(0, 4).join(', ')}`);
  }
  if (!read.length && !wrong.length) return info('no /sort rail with two or more cards on screen to read');
  return ok(`each /sort rail on screen is in the order POST /sort answered for her (${read.join(', ') || 'none read'})`, wrong.length === 0, wrong.join(' ~ ').slice(0, 260));
}
/** Fresh visitor where she is: two frames of real pixels, her page and a stranger's, or the reason it cannot. */
async function freshHere(where) {
  const tools = (await snap()).tools;
  if (!tools.includes('fresh')) { checks.known(`Fresh visitor on ${where}`, false, `the compare tools are ${tools.join(', ')}`, 'P1 (the Fresh visitor tool)'); return; }
  const was = press;
  press = `fresh ${where}`;
  await evaluate(`document.querySelector('#compareTools button[data-tool="fresh"]').click()`);
  await waitFor(`${framesUp} || /^No /.test(window.__s1.snapshot().compare.msg)`, 30000);
  await sleep(500);
  const C = (await snap()).compare;
  const px = await evaluate('window.__s1.framePixels()');
  checks.known(`Fresh visitor on ${where} opens on two frames of real pixels, the shopper’s page and a fresh visitor’s in the same region`, C.mode === 'seam' && /^(Her|The shopper’s) page · /i.test(C.tags.before)
    && /^A fresh visitor, same region · /i.test(C.tags.now) && inked(px), `${C.msg || `${C.tags.before} | ${C.tags.now}`} · ${fmtPx(px)}`,
    'P1 and P2 (oh.js freshVisitor answers only on the homepage and the TV grid; a product page needs its own)');
  await closeOpen();
  press = was;
}
/** The products inside each module that says it lists them in POST /sort's order are in that order, read off this press's wire. */
async function inSortOrder(label, S, pressKey) {
  const claimed = S.modules.filter((m) => has(m.same, 'POST /sort’s order') && m.tiles.length > 1);
  if (!claimed.length) return info(`${label}: no module with two or more products in POST /sort’s order to read`);
  const sorts = [...requests.entries()].filter(([, r]) => r.press === pressKey && r.path === '/sort' && r.status === 200);
  let order = null;
  for (const [id] of sorts.reverse()) { try { const b = await cdp('Network.getResponseBody', { requestId: id }); const body = JSON.parse(b.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : b.body); if (Array.isArray(body.order)) { order = body.order.map(String); break; } } catch { /* evicted */ } }
  if (!order) return ok(`${label} follow POST /sort’s order, as each module says`, false, 'no /sort answer read off this press’s wire');
  // A module's tiles other than the product on screen (a comparison shows it beside its counterpart), as /sort answered them.
  const here = new URLSearchParams(String(S.address).split('?')[1] || '').get('id');
  const sortedOf = (m) => m.tiles.map((t) => String(t.sku)).filter((x) => x !== here && order.includes(x));
  const wrong = claimed.filter((m) => sortedOf(m).length > 1).filter((m) => { const skus = sortedOf(m); return JSON.stringify(skus) !== JSON.stringify(order.filter((x) => skus.includes(x))); });
  ok(`${label} follow POST /sort’s order, as each module says (${claimed.length} module(s))`, wrong.length === 0,
    wrong.map((m) => `${m.cid}: ${m.tiles.map((t) => t.sku).join(', ')} · /sort ${order.filter((x) => m.tiles.some((t) => String(t.sku) === x)).join(', ')}`).join(' ~ ').slice(0, 260)
      || claimed.map((m) => m.cid).join(', '));
}

// ── Lane P2's readers for its checks on the product pages (written by P2, integrated by S1 into the suite's order) ──
// Each reads the product page as a person sees it (computed visibility through window.__s1) and measures the beat's
// declared effect against the data files and the engine's own answers on this press's wire: the buy box off limits
// and never decided, every companion module decided with E1's completes line for the product on screen, the
// products inside a module in POST /sort's own order, the pedestal withdrawn by its own rule with the feed's reason
// on its card, the package cheaper than its pieces by the catalog's own figures, the honest sentence and the same
// price for everyone beside the OLED, her declared distance moving her own meters, and her declared width hiding
// exactly the models the data says are wider.
const P2D = { ready: null };
/** The page's own walk (oh.js P2_WALK), the feed with specs.json merged over it by sku, and the catalog's display figures. */
const data = () => P2D.ready || (P2D.ready = (async () => {
  const js = await (await fetch(`${base}/${SLUG}/${SLUG}.js`, { cache: 'no-store' })).text();
  const m = /\bconst P2_WALK = \{([^}]*)\}/.exec(js);
  const walk = {};
  for (const [, k, v] of String(m ? m[1] : '').matchAll(/([\w$]+):\s*('[^']*'|"[^"]*"|[\d.]+)/g)) walk[k] = /^['"]/.test(v) ? v.slice(1, -1) : Number(v);
  const specs = await getJson('specs.json').catch(() => ({}));
  const over = new Map(((specs && (specs.specs || specs.products || specs.rows)) || []).filter((r) => r && r.sku).map((r) => [String(r.sku), r]));
  const rows = (productsDoc.products || []).map((p) => (over.has(String(p.sku)) ? { ...p, ...over.get(String(p.sku)) } : p));
  const bySku = new Map(rows.map((p) => [String(p.sku), p]));
  const display = new Map((catalog.pieces || []).map((x) => [x.customerContentId, x.display || {}]));
  return { walk, rows, row: (sku) => bySku.get(String(sku)) || null, display };
})());
const P2READ = `(() => {
  const { vis, txt } = window.__s1;
  const box = document.getElementById('buyBox'), fin = document.getElementById('bbFin');
  const fit = [...document.querySelectorAll('[data-fit]')].find((f) => vis(f).ok) || null;
  const v = [...document.querySelectorAll('#stage > .view')].find((x) => vis(x).ok);
  return { view: v ? v.dataset.page : null, id: new URLSearchParams(location.search).get('id'), line: txt('#engineLine'),
    buy: { shown: vis(box).ok, text: txt(box), nper: [...box.querySelectorAll('.nper, .offlimits')].some((n) => vis(n).ok), decidedInside: box.querySelectorAll('[data-op-decision-id]').length,
      cta: txt('#bbAdd'), fin: fin ? { shown: vis(fin).ok, text: txt(fin), inBox: box.contains(fin) } : null },
    mods: [...document.querySelectorAll('#slot-pdp-modules > .pmod')].filter((m) => vis(m).ok).map((m) => ({ cid: m.dataset.cid, decided: Boolean(m.dataset.opDecisionId),
      receipt: txt(m.querySelector('.receipt')), rule: txt(m.querySelector('.pmod-rule')), text: txt(m),
      tiles: [...m.querySelectorAll('.ptile')].filter((t) => vis(t).ok).map((t) => t.dataset.open), pressed: [...m.querySelectorAll('[aria-pressed="true"]')].map((b) => b.dataset.ctl) })),
    gone: [...document.querySelectorAll('#pdpGone .pmod-gone')].filter((g) => vis(g).ok).map((g) => ({ cid: g.dataset.gone, decided: Boolean(g.closest('[data-op-decision-id]')), text: txt(g) })),
    fit: fit ? { where: fit.dataset.fit, text: txt(fit), tiles: [...fit.querySelectorAll('.ptile')].map((t) => t.dataset.open), pressed: [...fit.querySelectorAll('[aria-pressed="true"]')].map((b) => b.dataset.ctl) } : null,
    strip: [...document.querySelectorAll('#deltas-pdp-modules > li')].filter((li) => vis(li).ok).map(txt),
    vector: (window.${HOOK} && window.${HOOK}.state && window.${HOOK}.state.lastVector) || {} };
})()`;
const read = () => evaluate(P2READ);
/** The last answer to a call of this press, read off the wire (the page's own request, never asked again here). */
async function answerOf(pressKey, test, fits = () => true) {
  const list = [...requests.entries()].filter(([, r]) => r.press === pressKey && r.status === 200 && test(r));
  for (const [id] of list.reverse()) {
    try { const b = await cdp('Network.getResponseBody', { requestId: id }); const body = JSON.parse(b.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : b.body); if (fits(body)) return body; } catch { /* evicted */ }
  }
  return null;
}
const snapshotsOf = (pressKey) => [...requests.values()].filter((r) => r.press === pressKey && /\/decisions\/snapshot/.test(r.path)).map((r) => new URL(r.url).searchParams);
const mod = (R, cid) => R.mods.find((x) => x.cid === cid) || null;
/** A receipt line that says the piece completes the named product: “Completes what she committed to: <sku>”, or lane C3’s
 *  gender-neutral “Completes what was committed to: <sku>”; any other wording fails. */
const completesIn = (text, sku) => has(text, `Completes what she committed to: ${sku}`) || has(text, `Completes what was committed to: ${sku}`);
const completes = (m, sku) => Boolean(m && m.decided && completesIn(m.receipt, sku));
/** The products in a module, as the page shows them, against POST /sort's own order for this press: the page reorders nothing. */
async function p2InSortOrder(label, m, i) {
  const sort = m && m.tiles.length ? await answerOf(i, (r) => r.path === '/sort', (b) => Array.isArray(b.order) && m.tiles.every((id) => b.order.map(String).includes(id))) : null;
  if (!m || !m.tiles.length) return ok(`${label}: the module lists its products`, false, m ? 'no product on the card' : 'not on the page');
  const order = sort && Array.isArray(sort.order) ? sort.order.map(String).filter((id) => m.tiles.includes(id)) : null;
  ok(`${label}: its products are in POST /sort’s own order, as the engine answered this press`, Boolean(order) && sameJSON(order, m.tiles),
    `${m.tiles.join(', ')}${order && !sameJSON(order, m.tiles) ? ` · /sort ${order.join(', ')}` : ''}`);
  return sort;
}
function buyBoxOffLimits(R, p) {
  ok('the buy box is on screen, off limits and marked so: never decided, never personalised', R.buy.shown && /off limits/i.test(R.buy.text) && /never personalised/i.test(R.buy.text) && R.buy.nper,
    R.buy.text.slice(0, 120));
  ok('and nothing decided sits inside it: no decision is rendered in the buy box', R.buy.decidedInside === 0, `${R.buy.decidedInside} decided container(s)`);
  const want = p.cta === 'cart' ? (p.inStock === false ? 'Notify Me' : 'Add to Cart') : 'Find a Retailer';
  ok(`its button is the feed’s: ${want}`, R.buy.cta === want, R.buy.cta);
  if (R.buy.fin) ok('the financing line is in the buy box, as the site shows it, marked not personalised', R.buy.fin.shown && R.buy.fin.inBox && /affirm/i.test(R.buy.fin.text) && /not personalised/i.test(R.buy.fin.text), R.buy.fin.text);
}

// ── Lane P3's helpers for its checks (written by P3, integrated by S1 into the suite's order) ──
//      (docs/lg/lanes/P.md, P3); lane S1 integrates. Every check reads what a person sees (computed visibility, the
//      text on screen) or what crossed the wire in this press (the bodies read back from the browser), never a flag.
const SIGN = `${API}/sign-in`;
const RECEIPT = 'linked at sign-in · consented · no device matching';
const SITE3 = (() => { const m = /\bconst SITE = (\{[\s\S]*?\n\});/.exec(ohJs); try { return m ? JSON.parse(m[1]) : {}; } catch { return {}; } })();
const account = ((SITE3.signIn || {}).accounts || [])[0] || null;
/** P3's own beat-16 products, from its section of the served oh.js (the last `const WALK = {…}`). */
const W = (() => { const all = [...ohJs.matchAll(/\bconst WALK = \{([^}]*)\}/g)]; const m = all[all.length - 1]; const out = {};
  for (const [, k, v] of String(m ? m[1] : '').matchAll(/([\w$]+):\s*('[^']*'|"[^"]*"|[\d.]+)/g)) out[k] = /^['"]/.test(v) ? v.slice(1, -1) : Number(v); return out; })();
const reg = anchor.registry || {};
const tau = (dim) => Number((((reg.dimensions || []).find((x) => x.key === dim)) || {}).tauMs) || Number(reg.tauMs) || 0;
/** Her strongest values across every dimension, whatever its memory, strongest first: what the sign-in strip names (P3's topOf). */
const strongest = (dims, n = 3) => Object.entries(dims || {})
  .flatMap(([dim, vals]) => Object.entries(vals || {}).map(([value, a]) => ({ key: `${dim}:${value}`, a: Number(a) }))).filter((x) => x.a > 0)
  .sort((x, y) => y.a - x.a).slice(0, n).map((x) => x.key);
const bodyOf = async (id) => { try { const b = await cdp('Network.getResponseBody', { requestId: id }); return b.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : b.body; } catch { return null; } };
const postOf = async (id) => { try { return (await cdp('Network.getRequestPostData', { requestId: id })).postData; } catch { return null; } };
const json = (t) => { try { return JSON.parse(t); } catch { return null; } };
const inPress = (i, test) => [...requests.entries()].filter(([, r]) => r.press === i && test(r)).sort((a, b) => a[1].at - b[1].at);
const p3Date = () => new Date().toISOString().slice(0, 10);
const p3Report = async (build) => {
  const r = await fetch(`${base}${API}/report`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Tenant': TENANT },
    body: JSON.stringify({ date: p3Date(), slot: 'pdp-modules', ...(build ? { build: true } : {}) }) });
  const out = await r.json().catch(() => ({}));
  return out.ok ? out.report : null;
};
const counted = (rep, e) => Number(((((rep || {}).namedOutcomes || {}).events || {})[e] || {}).outcomes) || 0;
const P3D = { base: null };
const p3View = (sel) => evaluate(`window.__s1.txt(${JSON.stringify(sel)})`);

// ── Lane P1's helpers for its checks (written by P1, integrated by S1 into the suite's order) ──
// What S1's outcomes above do not already read on screen: the arrival line (her real place, the brand's sales there,
// the census never scored), the rails' lean labels in the answer's own words ("(asserted)" when beat 2 asserts), the
// two rooms on the deals four, the TV grid's lean and her declared fit hiding exactly what the data says is wider,
// the engine's own line on the deals strip for the windows, the held-back packages and the pin with what the engine
// would have led with, and the clock jump's labels. S1's own outcome for a beat runs first, then P1's.
const P1R = `(() => { const s = window.__s1; const strip = document.getElementById('p1Deltas-deals');
  const pinned = document.querySelector('#slot-deals .p1-deal--pinned .receipt');
  return { arrival: s.vis('#p1Arrival').ok ? s.txt('#p1Arrival') : '', lean: { forYou: s.vis('#lean-for-you').ok ? s.txt('#lean-for-you') : '', grid: s.vis('#lean-tv-grid').ok ? s.txt('#lean-tv-grid') : '' },
    engine: strip ? [...strip.querySelectorAll('li.delta-engine')].filter((x) => s.vis(x).ok).map((x) => s.txt(x)).join(' ') : '',
    pinReceipt: pinned && s.vis(pinned).ok ? s.txt(pinned) : '', fitNote: s.vis('#p1FitNote').ok ? s.txt('#p1FitNote') : '',
    grid: [...document.querySelectorAll('#rail-tv-grid [data-open]')].filter((x) => s.vis(x).ok).map((x) => x.dataset.open),
    cont: s.vis('#slot-continue .p1-continue').ok ? s.txt('#slot-continue .p1-continue') : '' }; })()`;
const p1Read = () => evaluate(P1R);
const pieceRoom = (cid) => ((((openCatalog.pieces || []).find((p) => p.customerContentId === cid) || {}).tags || {}).room || [])[0] || null;
const p1Width = (p) => { const s = Number(p && p.width); if (Number.isFinite(s) && s > 0) return s; const f = Number(p && p.fits && p.fits.width); return Number.isFinite(f) && f > 0 ? f : null; };

// ── Lane S2: a visitor's hand (design §9.3, §9.4) ────────────────────────────
// The manual session presses only what a visitor sees. An element is found on screen (computed visibility up the
// chain and a real box), scrolled into view as a person scrolls, and must be the topmost thing under the point
// pressed (nothing covers it); it then gets a real mouse press and release through the DevTools input domain, never
// element.click(). Typing goes in as text input and an Enter key. Back is the browser's own history entry. Every claim
// is read off the screen and off the wire, as the walk's are.
const AIM = (sel, text, nth) => `(async () => {
  const { vis, txt } = window.__s1;
  const want = ${JSON.stringify(text ? String(text).toLowerCase() : null)};
  const all = [...document.querySelectorAll(${JSON.stringify(sel)})].filter((e) => vis(e).ok && (!want || ((txt(e) || '') + ' ' + (e.getAttribute('aria-label') || '')).toLowerCase().includes(want)));
  const el = all[${Number(nth) || 0}] || null;
  if (!el) return { ok: false, why: 'nothing on screen matches ' + ${JSON.stringify(sel)} + (want ? ' with “' + want + '”' : '') };
  el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const r = el.getBoundingClientRect();
  const x = Math.round(r.left + Math.min(r.width / 2, 24)), y = Math.round(r.top + r.height / 2);
  const hit = document.elementFromPoint(x, y);
  const covered = !(hit && (hit === el || el.contains(hit)));
  const nm = (n) => (n ? (n.id ? '#' + n.id : n.tagName.toLowerCase() + (typeof n.className === 'string' && n.className.trim() ? '.' + n.className.trim().split(/\\s+/)[0] : '')) : 'nothing');
  return { ok: !covered, x, y, label: (txt(el) || el.getAttribute('aria-label') || el.value || el.tagName).slice(0, 80), why: covered ? 'covered by ' + nm(hit) : '' };
})()`;
/** The API requests still in flight (a receipt poll, an ask); settled is a quiet wire for a moment, then the helpers are checked. */
async function settled(quietMs = 800, maxMs = 25000) {
  const end = Date.now() + maxMs;
  let calm = Date.now();
  while (Date.now() < end) {
    const busy = [...requests.values()].some((r) => r.status === null && !r.failed && Date.now() - r.at < 20000);
    if (busy) calm = Date.now(); else if (Date.now() - calm >= quietMs) break;
    await sleep(120);
  }
  // A same-document route keeps window.__s1; a full navigation (a link the store did not route) needs it again, and says so.
  if (!(await evaluate('typeof window.__s1 === "object"').catch(() => false))) { S2.reloads.push(await evaluate('location.pathname + location.search').catch(() => '?')); await booted(); await evaluate(inPage(pageHelpers)); }
}
/** One press of a visitor's hand on what she sees: { ok, label } or { ok: false, why }. */
async function hand(sel, { text, nth, settle = true } = {}) {
  const a = await evaluate(AIM(sel, text, nth));
  if (!a.ok) return a;
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x, y: a.y });
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: a.x, y: a.y, button: 'left', buttons: 0, clickCount: 1 });
  if (settle) await settled();
  return a;
}
/** Typing into a field she can see: pressed first, then the text as input, then Enter. */
async function typeIn(sel, text, { settle = true } = {}) {
  const a = await hand(sel, { settle: false });
  if (!a.ok) return a;
  await evaluate(`(() => { const e = document.activeElement; if (e && 'value' in e) e.select && e.select(); })()`);
  await cdp('Input.insertText', { text });
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  if (settle) await settled();
  return a;
}
/** The browser's own Back: the previous entry of its history, as the toolbar button goes there. */
async function browserBack() {
  const h = await cdp('Page.getNavigationHistory');
  const prev = h.entries[h.currentIndex - 1];
  if (!prev) return { ok: false, why: 'no earlier entry in the history' };
  await cdp('Page.navigateToHistoryEntry', { entryId: prev.id });
  await sleep(300);
  await settled();
  return { ok: true, url: prev.url };
}
const S2 = { reloads: [] };

/** The registry's dimensions (beats/anchor.json registry), and the events that are about a product (the coordinator's list). */
const DIMS = (((anchor.registry || {}).dimensions) || []).map((d) => d.key);
const PRODUCT_EVENTS = new Set(['add_to_cart', 'wishlist_add', 'purchase', 'select', 'compare', 'find_a_retailer', 'partner_pickup', 'retailer_referral', 'notify_me']);
const eventName = (e) => (e.type === 'custom' ? e.data.event : e.type);
/** The dimension values an event carries, as [dim, value] pairs (an array value, each of its members). */
const carriedDims = (data) => DIMS.flatMap((d) => (Array.isArray(data[d]) ? data[d].map((v) => [d, String(v)]) : typeof data[d] === 'string' ? [[d, data[d]]] : []));
/** Her reading now, from the engine itself (GET /realtime/reflex with the capability on her events), by dim and value. */
async function engineReading(cap) {
  if (!cap) return null;
  const r = await fetch(`${base}/realtime/reflex`, { headers: { 'X-Tenant': TENANT, 'X-SDK-Key': 'demo-site', 'X-Shopper-Session': cap }, cache: 'no-store' }).catch(() => null);
  const j = r ? await r.json().catch(() => null) : null;
  return (j && j.affinity && j.affinity.dims) || null;
}
/** The panel's rows as rendered (the director is collapsed for a visitor: its rows are read as drawn) and the page's own vector. */
const PANEL_READ = `(() => { const { txt } = window.__s1;
  const own = (el) => (el ? [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/\\s+/g, ' ').trim() : '');
  const rows = [...document.querySelectorAll('#vectors .vecrow')].map((r) => ({ value: own(r.querySelector('.vectop span')), label: txt(r.querySelector('.vectop em')), a: Number(txt(r.querySelector('.vectop b'))) }));
  const s = window.__oh && window.__oh.state;
  return { rows, vector: (s && s.lastVector) || null };
})()`;
const dimLabel = (d) => (((PAGE_SITE.dimLabels) || {})[d]) || d;   // read at run time (PAGE_SITE is defined below)
/**
 * The panel follows a manual event by itself: from the moment the event's request answered, within two seconds and with no
 * press or navigation, the page's vector equals the engine's reading for every dimension the event carried, and each of
 * those the panel shows reads the engine's value (two decimals). Returns what it saw.
 */
async function panelFollows(label, presses, test) {
  let evt = null;
  for (let i = 0; i < 60 && !evt; i += 1) { evt = eventsIn(presses).filter(test).pop() || null; if (!evt) await sleep(100); }   // the page sends it just after the release
  const hit = evt ? [...requests.entries()].filter(([, r]) => presses.includes(r.press) && r.path === '/realtime/action').find(([, r]) => { try { const b = JSON.parse(r.body); return eventName({ type: b.type, data: b.data || {} }) === eventName(evt); } catch { return false; } }) : null;
  const req = hit ? hit[1] : null;
  const roundTrip = () => (hit && ANSWERED.has(hit[0]) ? `${ANSWERED.get(hit[0]) - hit[1].at} ms` : 'not answered');
  if (!evt) return ok(`${label}: the panel follows it by itself within two seconds`, false, 'no such event on the wire');
  const dims = carriedDims(evt.data);
  if (!dims.length) { info(`${label}: the event carries no dimension, so nothing on the panel is asked to move`); return null; }
  for (let i = 0; i < 40 && req && req.status === null; i += 1) await sleep(50);
  const t0 = Date.now();
  const engine = await engineReading(evt.cap);
  const close = (x, y, tol) => Math.abs(Number(x || 0) - Number(y || 0)) <= tol;
  let P = null, pass = false, shown = [];
  do {
    P = await evaluate(PANEL_READ);
    shown = dims.map(([d, v]) => ({ d, v, e: engine && engine[d] ? Number(engine[d][v] || 0) : 0, vec: P.vector && P.vector[d] ? Number(P.vector[d][v] || 0) : null,
      row: P.rows.find((r) => r.value === v && (r.label.startsWith(dimLabel(d)) || r.label.startsWith(d))) || null }));
    pass = Boolean(engine) && shown.every((x) => x.vec !== null && close(x.vec, x.e, 0.02)) && shown.some((x) => x.row) && shown.every((x) => !x.row || close(x.row.a, x.e, 0.011));
    if (pass) break;
    await sleep(200);
  } while (Date.now() - t0 < 2000);
  ok(`${label}: within two seconds, with no press or navigation, the panel and the page’s vector read what the engine now holds for what it carried`, pass,
    shown.slice(0, 4).map((x) => `${x.d} ${x.v}: engine ${x.e.toFixed(2)} · vector ${x.vec === null ? 'none' : x.vec.toFixed(2)} · panel ${x.row ? x.row.a.toFixed(2) : 'not shown'}`).join(' | ') + ` · ${Date.now() - t0} ms after the answer · the action’s own round trip ${roundTrip()} (its request to its response)`);
  return shown;
}


// ── Lane S2: R4's rulings, measured against her profile and the engine, never the page's sentence ──
/** Her own reading of a dimension, from her profile as the page holds it (the meters' read): { value: a } with a > 0. */
const herDim = (vec, dim) => Object.fromEntries(Object.entries((vec || {})[dim] || {}).filter(([, a]) => Number(a) > 0));
const leading = (vals) => (Object.entries(vals || {}).sort((x, y) => Number(y[1]) - Number(x[1]))[0] || [null])[0];
/**
 * What put /sort's first ahead of its second, read off the answer's own items: per dimension the contribution the first
 * holds over the second (the regional prior as one dimension, 'regional'); the dimension with the largest lead, with the
 * first's own value there. Null when the answer carries no items for them.
 */
function separating(answer, first, second) {
  const items = (answer && answer.items) || [];
  const of = (id) => items.find((x) => String(x.id) === String(id)) || null;
  const a = of(first), b = of(second);
  if (!a || !b) return null;
  const byDim = (x) => { const m = new Map(), top = new Map();
    for (const d of x.drivers || []) { const k = d.dim; m.set(k, (m.get(k) || 0) + Number(d.contribution || 0)); if (!top.has(k) || Number(d.contribution) > top.get(k).c) top.set(k, { c: Number(d.contribution), v: d.value }); }
    return { m, top }; };
  const A = byDim(a), B = byDim(b);
  let best = null;
  for (const [dim, v] of A.m) { const gap = v - (B.m.get(dim) || 0); if (!best || gap > best.gap) best = { dim, value: A.top.get(dim).v, gap: Number(gap.toFixed(3)) }; }
  return best && best.gap > 0 ? best : null;
}
/** How a card says a driver in words (the coordinator's list: sold here, pickup, completes her set), by dimension and value. */
function driverWords(sep) {
  if (!sep) return null;
  if (sep.dim === 'retailer') return sep.value === 'best-buy-pickup' ? /pick ?up/i : sep.value === 'lg-com' ? /sold here|from oh\.|buy (it )?(directly|here)/i : new RegExp(String(sep.value).replace(/-/g, '[ -]'), 'i');
  if (sep.dim === 'package') return /\bset\b|package/i;
  if (sep.dim === 'regional') return /leans with/i;
  return new RegExp(`\\b(${String(sep.value).replace(/-/g, '[ -]')}|${sep.dim})\\b`, 'i');
}
/** A washer's laundry sets with the set's price against the sum of its pieces' (the feed's own figures, as the page shows them). */
const setsOf = (p) => ((p && p.companions && p.companions.packages) || []).map((sku) => row(sku)).filter((x) => x && x.salePrice != null).map((x) => {
  const members = ((x.companions && x.companions.members) || String(x.sku).split('_')).map(row);
  const apart = members.every((m) => m && m.salePrice != null) ? members.reduce((n, m) => n + Number(m.salePrice), 0) : null;
  return { sku: x.sku, set: Number(x.salePrice), apart, lower: apart !== null && Number(x.salePrice) < apart - 0.005 };
});
/** The date of the prices the page shows: the overlay's (specs.json) when it changes any row's price, else the feed's own. */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = (iso) => (iso ? `${Number(String(iso).slice(8, 10))} ${MONTHS[Number(String(iso).slice(5, 7)) - 1]} ${String(iso).slice(0, 4)}` : null);
const priceDate = () => {
  const changed = products.filter((p) => overlay.has(String(p.sku)) && ['salePrice', 'listPrice'].some((k) => overlay.get(String(p.sku))[k] != null && Number(overlay.get(String(p.sku))[k]) !== Number(p[k])));
  const feed = String(productsDoc.asOf || '').slice(0, 10), over = String((specsDoc && specsDoc.asOf) || '').slice(0, 10);
  return { iso: changed.length && over > feed ? over : feed, changed: changed.length, feed, over };
};
const namesDate = (line, iso) => Boolean(iso) && new RegExp(`(?<!\\d)${longDate(iso)}`).test(String(line || ''));
const storeNow = () => evaluate('window.__s1.store()');
const lookNow = () => evaluate('window.__s1.look()');
const path = (u) => { try { const x = new URL(u, base); x.searchParams.delete('debug'); x.searchParams.delete('present'); return x.pathname + (x.searchParams.toString() ? `?${x.searchParams}` : ''); } catch { return String(u); } };
/** The bodies of her events in a span of presses, off the wire: [{ type, data, cap }] in the order they left. */
const eventsIn = (presses) => [...requests.values()].filter((r) => presses.includes(r.press) && r.path === '/realtime/action').map((r) => {
  try { const b = JSON.parse(r.body); return { type: b.type, data: b.data || {}, cap: header(r, 'X-Shopper-Session'), status: r.status, source: b.source }; } catch { return null; } }).filter(Boolean);
/** What productAttrs builds for a product (oh.js, from SITE.products.attributes): the beat verbs' attributes for it. */
const PAGE_SITE = (() => { const m = /\bconst SITE = (\{[\s\S]*?\n\});/.exec(ohJs); try { return m ? JSON.parse(m[1]) : {}; } catch { return {}; } })();
const attrsOf = (p) => { const map = ((PAGE_SITE.products || {}).attributes) || {}; const out = { productId: String(p.sku) };
  for (const [k, pathTo] of Object.entries(map)) { const v = String(pathTo).split('.').reduce((o, x) => (o == null ? undefined : o[x]), p); if (v !== undefined && v !== null) out[k] = v; } return out; };
/** Whether an event's data carries the beat verbs' attributes for the product: every one productAttrs builds, equal. */
const carries = (data, p, over = {}) => { const want = { ...attrsOf(p), ...over }; const miss = Object.entries(want).filter(([k, v]) => JSON.stringify(data[k]) !== JSON.stringify(v)).map(([k]) => k); return { ok: miss.length === 0, miss }; };


// ── Lane S2: the boot page and the manual session (design §9.1–§9.4) ─────────
// Before anyone exists /oh/ is the published template: real content in every module of lg.com's anatomy, in LG's look,
// and nothing on the wire that mints a visitor until the first click. Then a visitor works the site by hand, pressing
// only what she sees: the TVs grid from the nav, a filter, two TVs, a search from the header, a washer, a colour, Add to
// Cart, the dryer the washer's own decided module offers, the cart, Find a Retailer, Back twice, home. Each step is read
// off the screen and off the wire: the address and the view, the events in the beat verbs' shapes, the cart's lines and
// total, the modal's lists against the catalog, and at the end the homepage moved for her, with receipts naming her clicks.
const BOOT_MODULES = [
  ['the pencil banner', '#m1Pencil'], ['the header', '#site .site-header'], ['the category nav', '#m1Cats'], ['the hero', '#slot-hero'],
  ['the service strip', '#view-home .svc-strip'], ['the room tiles', '#slot-category-rail'], ['the deals four', '#slot-deals'], ['Shop with an expert', '#view-home .m1-expert'],
  ['Recommended for you', '#rail-for-you'], ['the showcase', '#m1Showcase'], ['the benefits', '#view-home .m1-benefits-wrap'], ['the footer', '#site footer.site-footer'],
];
const BOOT_READ = `(() => {
  const { vis, txt } = window.__s1;
  const imgs = (root) => [...root.querySelectorAll('img')].filter((i) => vis(i).ok).map((i) => ({ src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0 }));
  const outer = (root, sel) => [...root.querySelectorAll(sel)].filter((e) => vis(e).ok).filter((e) => { const up = e.parentElement && e.parentElement.closest(sel); return !up || !root.contains(up); });
  const mod = (sel) => {
    const el = document.querySelector(sel);
    const b = el ? vis(el) : { ok: false, why: 'not in the page' };
    if (!b.ok) return { ok: false, why: b.why, text: '', imgs: [], cards: [], products: [], items: 0 };
    return { ok: true, h: b.h, bg: getComputedStyle(el).backgroundColor, text: txt(el).slice(0, 900), imgs: imgs(el),
      cards: outer(el, '[data-cid]').map((c) => ({ cid: c.dataset.cid, decided: Boolean(c.dataset.opDecisionId), title: txt(c.querySelector('h1, h2, h3, h4, .title, .ptitle, .dtitle')) || '', text: txt(c).slice(0, 240) })),
      products: outer(el, '[data-open]').map((c) => ({ sku: c.dataset.open, text: txt(c).slice(0, 240), img: imgs(c) })),
      items: [...el.querySelectorAll('a, button, [role="tab"]')].filter((x) => vis(x).ok && (txt(x).length > 1 || x.getAttribute('aria-label'))).length };
  };
  return Object.fromEntries(${JSON.stringify(BOOT_MODULES)}.map(([n, s]) => [n, mod(s)]));
})()`;
/** Each module's claim of real content, as lg.com's anatomy carries it (design §9.2). */
const titled = (m, n) => m.cards.length === n && m.cards.every((c) => c.title.trim().length >= 2 && c.text.length > c.title.length + 10);
const BOOT_CLAIMS = {
  'the pencil banner': (m) => m.text.length >= 20,
  'the header': (m) => ['OH.', 'TVs', 'Laundry', 'Kitchen', 'Offers', 'Support', 'Sign in'].every((w) => has(m.text, w)),
  'the category nav': (m) => m.items >= 13,
  'the hero': (m) => m.cards.length >= 1 && m.cards[0].title.trim().length >= 2 && m.cards[0].text.length > m.cards[0].title.length + 10,
  'the service strip': (m) => ['deliver', 'return', 'cover', 'haul', 'expert'].every((w) => has(m.text, w)),
  'the room tiles': (m) => titled(m, 3),
  'the deals four': (m) => titled(m, 4),
  'Shop with an expert': (m) => has(m.text, 'expert') && m.text.length > 60,
  'Recommended for you': (m) => m.products.length >= 4 && m.products.every((x) => /\$\d/.test(x.text) && x.img.some((i) => i.ok)),
  'the showcase': (m) => has(m.text, 'appliances') && has(m.text, 'entertainment') && m.products.length + m.cards.length >= 1,
  'the benefits': (m) => m.items >= 3,
  'the footer': (m) => m.text.length > 200 && has(m.text, 'fictional'),
};
const SITE_TOOLS = (sel) => evaluate(`(() => ({ collapsed: document.body.classList.contains('kit-dock--collapsed'), rail: window.__s1.vis('#dockRail').ok, machine: window.__s1.vis('#machine').ok,
  site: Math.round((document.getElementById('site') || document.body).getBoundingClientRect().width), vw: innerWidth }))()`);
/** The opening catalog's pieces by content id, with whether each is in force for a slot now (live, in window, in stock, no context gate). */
const OPEN_PIECES = new Map((openCatalog.pieces || []).map((p) => [p.customerContentId, p]));
const inForceFor = (cid, slot) => { const p = OPEN_PIECES.get(cid); if (!p) return false; const w = p.window || {}, now = Date.now();
  return (p.slotTypes || []).includes(slot) && (!p.lifecycle || p.lifecycle.status === 'live') && p.inStock !== false && (!w.to || Date.parse(w.to) > now) && (!w.from || Date.parse(w.from) <= now)
    && !(p.eligibleWhen && p.eligibleWhen.context && Object.keys(p.eligibleWhen.context).length); };
/**
 * The published template of a slot, as the store builds it before anyone arrives (oh.js M1.template): the opening catalog's
 * pieces in its own order, the first `take` that are live, inside their window, in stock and carry no eligibility rule, under
 * the slot's own diversity rule from the opening slots. The boot page must show exactly these, in this order.
 */
const OPEN_SLOTS = (await getJson('beats/open-slots.json').catch(() => ({ publish: { document: { pages: {} } } }))).publish.document;
function templateOf(slot, take) {
  const def = Object.values(OPEN_SLOTS.pages || {}).flat().find((s) => s.slot === slot) || {};
  const div = def.diversity || null, counts = {}, out = [], now = Date.now();
  for (const p of openCatalog.pieces || []) {
    if (out.length >= take) break;
    const w = p.window || {};
    if (!(p.slotTypes || []).includes(slot) || (p.lifecycle && p.lifecycle.status && p.lifecycle.status !== 'live') || p.inStock === false || p.eligibleWhen
      || (w.to && Date.parse(w.to) <= now) || (w.from && Date.parse(w.from) > now)) continue;
    if (div && div.dimension) { const vals = ((p.tags || {})[div.dimension]) || []; if (vals.some((v) => (counts[v] || 0) >= Number(div.max))) continue; for (const v of vals) counts[v] = (counts[v] || 0) + 1; }
    out.push(p.customerContentId);
  }
  return out;
}
/** Each page of the session at 1440 and at 1366: no horizontal overflow, no broken image (scrolled through, lazy ones loaded apart). */
async function pageAtBoth(label) {
  const out = [];
  for (const [w, h] of SIZES) {
    await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await sleep(400);
    await imagesSettled();
    const S = await snap();
    const late = [...(await evaluate('window.__s1.pendingLoad()')).filter((x) => !x.ok).map((x) => `${x.src} (${x.why})`), ...(await imgErrors()).map((x) => `${x} (failed)`)];
    out.push({ w, overflow: S.overflow, broken: [...S.broken, ...late], images: S.images });
  }
  await cdp('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  await sleep(250);
  return ok(`${label}: no horizontal overflow and no broken image, at 1440 and at 1366`, out.every((x) => x.overflow <= 1 && x.broken.length === 0),
    out.map((x) => `${x.w}: overflow ${x.overflow}px · ${x.images} image(s)${x.broken.length ? ` · broken ${x.broken.slice(0, 2).join(', ')}` : ''}`).join(' | '));
}
/** LG's look on the page now (design §9.1), as computed style: the checks every page of the session repeats. */
async function lgLook(label, { full = false } = {}) {
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });   // the hand moves off: no hover state is read as a button's colour
  await sleep(200);
  const L = await lookNow();
  // R5's ruling (1281db3): lg.com's action red, #EA1917, as a 32 px pill 42–44 px tall on every button; #A50034 is the wordmark's alone.
  const ACTION = rgb('#EA1917');
  const action = L.fills.filter((f) => f.bg === ACTION), other = L.fills.filter((f) => f.bg !== ACTION);
  const unlike = (f) => f.color !== 'rgb(255, 255, 255)' || f.radius !== '32px' || f.h < 42 || f.h > 44;
  ok(`${label}: no yellow anywhere and no black bar (the charcoal top bar is lg.com’s, R5’s ruling)`, L.yellows.length === 0 && L.bars.length === 0, [...L.yellows.slice(0, 3), ...L.bars.slice(0, 3)].join(' ~ ') || 'none');
  ok(`${label}: every filled button is lg.com’s action red #EA1917, white text, a 32 px pill 42 to 44 px tall`, other.length === 0 && action.every((f) => !unlike(f)) && (!full || action.length > 0),
    other.length ? other.slice(0, 3).map((f) => `${f.el} “${f.text}” ${f.bg}`).join(' ~ ') : `${action.length} action button(s)${action.filter(unlike).slice(0, 3).map((f) => ` · ${f.el} “${f.text}” ${f.color} r${f.radius} h${f.h}`).join('')}`);
  ok(`${label}: every “$X OFF” is in the action red #EA1917`, L.offs.every((o) => o.color === ACTION),
    `${L.offs.length} on screen${L.offs.filter((o) => o.color !== ACTION).slice(0, 3).map((o) => ` · ${o.el} “${o.text}” ${o.color}`).join('')}`);
  if (full) {
    // Design §10 (M1b): lg.com's warm page, #F0ECE4, under the whole site; a geometric sans close to LG's (Figtree), loaded, first
    // in the site's and the nav's computed family, never Inter; the wordmark in the brand colour.
    const first = (f) => String(f || '').split(',')[0].trim().replace(/^["']|["']$/g, '');
    ok(`${label}: lg.com’s warm page #F0ECE4 under the site, set in Figtree (a geometric sans close to LG’s, loaded), the wordmark “OH.” in the brand colour #A50034`,
      L.body === rgb('#F0ECE4') && L.site === rgb('#F0ECE4') && first(L.siteFont) === 'Figtree' && first(L.navFont || L.siteFont) === 'Figtree' && L.fontLoaded
        && Boolean(L.wordmark && L.wordmark.shown && L.wordmark.text === 'OH.' && L.wordmark.color === rgb('#A50034')),
      `body ${L.body} · site ${L.site} · ${first(L.siteFont)}${L.fontLoaded ? ' (loaded)' : ' (not loaded)'} · nav ${first(L.navFont)} · ${L.wordmark ? `${L.wordmark.text} ${L.wordmark.color}` : 'no wordmark'}`);
  }
  return L;
}
/** The decided answer for a page on a span of presses, off the wire (her own capability when known): the latest one. */
async function answerIn(presses, pageKey, cap) {
  const list = [...requests.entries()].filter(([, r]) => presses.includes(r.press) && /\/decisions\/snapshot/.test(r.path) && r.status === 200 && new URL(r.url).searchParams.get('page') === pageKey
    && (!cap || header(r, 'X-Shopper-Session') === cap));
  for (const [id, r] of list.reverse()) { try { const b = await cdp('Network.getResponseBody', { requestId: id }); const body = JSON.parse(b.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : b.body); if (Array.isArray(body.decisions)) return { body, url: new URL(r.url), at: r.at }; } catch { /* evicted */ } }
  return null;
}
/** The latest /sort answer in a span of presses whose candidates hold every id given, off the wire. */
async function sortIn(presses, idsShown, cap) {
  const list = [...requests.entries()].filter(([, r]) => presses.includes(r.press) && r.path === '/sort' && r.status === 200 && (!cap || header(r, 'X-Shopper-Session') === cap)
    && (() => { try { const c = new Set(JSON.parse(r.body).candidates.map((x) => String(x.id))); return idsShown.every((x) => c.has(String(x))); } catch { return false; } })());
  for (const [id, r] of list.reverse()) { try { const b = await cdp('Network.getResponseBody', { requestId: id }); const body = JSON.parse(b.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : b.body); if (Array.isArray(body.order)) return { body, sent: JSON.parse(r.body) }; } catch { /* evicted */ } }
  return null;
}
/** The store's search rule (oh-store.js match): every word in the product's name, SKU, type, category, subcategory, series, panel, finish, fuel or size band; priced. */
const normS = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const storeMatch = (q) => { const words = normS(q).split(' ').filter(Boolean); return rowsAll.filter((p) => { const a = p.attributes || {};
  const hay = ` ${normS([p.sku, p.name, a.type, a.category, a.subcategory, a.series, a.panel, a.finish, a.fuel, a.sizeBand].join(' '))} `;
  return words.every((w) => hay.includes(w) || (w.length > 3 && w.endsWith('s') && hay.includes(w.slice(0, -1)))); }).filter((p) => Number(p.salePrice) > 0); };
/** A washer sold here whose same model comes in another finish, sold here too: the colour she can change to. */
const colourSibling = (p) => p && rowsAll.find((x) => x.sku !== p.sku && x.family === p.family && x.modelFamily && x.modelFamily === p.modelFamily && x.attributes && p.attributes
  && x.attributes.finish && x.attributes.finish !== p.attributes.finish && x.cta === 'cart' && x.inStock !== false && Number(x.salePrice) > 0) || null;
const dollars = (s) => { const m = /\$([\d,]+(?:\.\d{2})?)/.exec(String(s || '')); return m ? Number(m[1].replace(/,/g, '')) : null; };
const words = (s) => String(s || '').replace(/-/g, ' ');

/** The manual session: from the boot page on screen, by a visitor's hand only (design §9.4). */
async function manualSession() {
  console.log('\n── By hand: a visitor works the store, clicking only what she sees (S2)');
  const HANDS = [];
  const route = [];                                   // the address after each step that navigates, in order
  const at = async () => { const s = await storeNow(); return { path: path(s.address), view: s.view }; };
  const step = async (name, fn) => { press = `hand ${HANDS.length + 1} · ${name}`; HANDS.push(press); console.log(`   ─ ${name}`);
    try { return await fn(); } catch (error) { checks.fail(`by hand, ${name}: the step threw: ${error.message}`); return null; } };
  const pressed = (a, what) => ok(`${what}: pressed on screen${a && a.label ? ` (“${a.label.slice(0, 40)}”)` : ''}`, Boolean(a && a.ok), a ? a.why || '' : 'nothing to press');
  const her = () => { const e = eventsIn(HANDS); return e.length ? e[e.length - 1].cap : null; };
  const evts = (key) => eventsIn([key]);
  const tvGrid = '#view-tvs #rail-tv-grid [data-open]';
  const gridSkus = () => evaluate(`[...document.querySelectorAll(${JSON.stringify(tvGrid)})].filter((e) => window.__s1.vis(e).ok).map((e) => e.dataset.open)`);
  const S2S = { opened: [] };

  // 1. The TVs grid, from the header's category nav: the first click mints her.
  await step('the TVs grid from the nav', async () => {
    const a = await hand('#site .site-header #mainnav [data-nav="tvs"]');
    pressed(a, 'TVs in the header’s nav');
    const k = press, w = await at(), calls = [...requests.values()].filter((r) => r.press === k);
    route.push(w.path);
    ok('the TVs grid is on screen at /oh/?view=tvs', w.view === 'tvs' && w.path === '/oh/?view=tvs', `${w.view} · ${w.path}`);
    const sessions = calls.filter((r) => /\/identity\/session$/.test(r.path)), consent = calls.filter((r) => /\/session\/preferences$/.test(r.path));
    const firstEvent = calls.find((r) => r.path === '/realtime/action');
    ok('the first click mints her: one session and her consent on the wire, before her first event', sessions.length === 1 && consent.length === 1 && (!firstEvent || sessions[0].at <= firstEvent.at),
      `${sessions.length} session · ${consent.length} consent`);
    const pv = evts(k).filter((e) => e.type === 'page_view');
    ok('and the grid sends her page view: page_view { page: tvs }', pv.some((e) => e.data.page === 'tvs'), pv.map((e) => JSON.stringify(e.data)).join(' · ') || 'none');
    const shown = await gridSkus();
    const sorted = await sortIn([k], shown.slice(0, 8));
    ok(`the grid shows ${shown.length} TVs in POST /sort’s own order`, shown.length >= 8 && Boolean(sorted) && sameJSON(shown, sorted.body.order.map(String).filter((x) => shown.includes(x))), sorted ? sorted.body.order.slice(0, 4).join(', ') : 'no /sort answer for the grid on the wire');
    S2S.gridBefore = shown;
    await pageAtBoth('the TVs grid');
    await lgLook('the TVs grid');
  });

  // 2. A filter: OLED, from the grid's own filters.
  await step('a filter: OLED', async () => {
    const before = await gridSkus();
    const countOf = async () => { const m = /(\d[\d,]*)\s+results?/i.exec(await evaluate("window.__s1.txt('#m1Bar-tvs')")); return m ? Number(m[1].replace(/,/g, '')) : null; };
    const n0 = await countOf();
    const a = await hand('#view-tvs #m1Filters-tvs label, #view-tvs #m1Filters-tvs button, #view-tvs #m1Filters-tvs [role="checkbox"]', { text: 'OLED' });
    pressed(a, 'OLED in the grid’s filters');
    const k = press, shown = await gridSkus();
    const off = shown.filter((sku) => { const p = row(sku); return !p || !/oled/.test(String(p.attributes && p.attributes.type)); });
    const all = rowsAll.filter((p) => p.attributes && p.attributes.category === 'tvs' && /oled/.test(String(p.attributes.type)) && Number(p.salePrice) > 0);
    const n1 = await countOf();
    ok(`the filter filters: the grid counts the feed’s ${all.length} priced OLEDs (${n0} → ${n1}), and every TV on screen is an OLED`, shown.length > 0 && off.length === 0 && n1 === all.length && n0 !== null && n0 > n1,
      off.slice(0, 4).join(', ') || `${shown.length} on screen: ${shown.slice(0, 3).join(', ')}`);
    const count = await evaluate("window.__s1.txt('#m1Bar-tvs')");
    info(`the toolbar says “${count.slice(0, 80)}” · the feed holds ${all.length} priced OLEDs`);
    const f = evts(k).filter((e) => e.type === 'custom' && e.data.event === 'filter');
    ok('the filter goes on the wire as the beat verbs send one: custom { event: filter, … } naming type oled', f.some((e) => /oled/.test(JSON.stringify(e.data))), f.map((e) => JSON.stringify(e.data).slice(0, 120)).join(' · ') || 'no filter event');
    const re = await sortIn([k], shown.slice(0, 4));
    ok('and the filtered grid is POST /sort’s order over the filtered TVs alone', Boolean(re) && re.sent.candidates.every((c) => /oled/.test(String(c.type))) && sameJSON(shown, re.body.order.map(String).filter((x) => shown.includes(x))),
      re ? `${re.sent.candidates.length} candidates` : 'no /sort after the filter');
  });

  // 3. Two TVs: the first from the grid, the browser's Back, the next.
  for (const n of [1, 2]) {
    await step(`TV ${n} from the grid`, async () => {
      const shown = await gridSkus();
      const sku = shown.find((x) => !S2S.opened.includes(x));
      const a = sku ? await hand(`${tvGrid}[data-open="${sku}"]`) : null;
      pressed(a, `a TV card (${sku || 'none'})`);
      const k = press, w = await at();
      route.push(w.path);
      ok(`its product page is on screen: /oh/product?id=${sku}`, w.view === 'product' && w.path === `/oh/product?id=${encodeURIComponent(sku)}` && has(await evaluate("window.__s1.txt('#buyBox')"), sku), `${w.view} · ${w.path}`);
      const pv = evts(k).filter((e) => e.type === 'product_view' && String(e.data.productId) === sku);
      const c = pv.length ? carries(pv[0].data, row(sku)) : { ok: false, miss: ['no product_view'] };
      ok(`its product_view carries the beat verbs’ attributes for ${sku} (productAttrs, view: page)`, pv.length === 1 && c.ok && pv[0].data.view === 'page', c.miss.join(', ') || `${Object.keys(pv[0].data).length} fields`);
      S2S.opened.push(sku);
      if (n === 1) {
        await pageAtBoth(`the TV page (${sku})`);
        await lgLook('the TV page');
        const b = await browserBack();
        const back = await at();
        route.push(back.path);
        ok('the browser’s Back returns to the filtered grid', b.ok && back.view === 'tvs' && back.path.startsWith('/oh/?view=tvs'), `${back.view} · ${back.path}`);
      }
    });
  }

  // 4. A search from the header: "washer".
  const Q = 'front load washer';
  await step(`a search from the header: “${Q}”`, async () => {
    const before = await engineReading(eventsIn(HANDS).map((e) => e.cap).filter(Boolean).pop());
    const a = await typeIn('#site .site-header form[data-store-search] input[name="q"]', Q, { settle: false });
    pressed(a, 'the header’s search box');
    {
      // By design a search whose results span several categories carries no category, so nothing in her profile rises on it.
      let s = null;
      for (let i = 0; i < 60 && !s; i += 1) { s = eventsIn([press]).find((e) => eventName(e) === 'search') || null; if (!s) await sleep(100); }
      await sleep(400);
      const after = await engineReading(s && s.cap);
      const cats = [...new Set(storeMatch(Q).map((p) => p.attributes && p.attributes.category))];
      const rose = Object.entries(after || {}).flatMap(([d, vals]) => Object.entries(vals || {}).filter(([v, x]) => Number(x) > Number(((before || {})[d] || {})[v] || 0) + 0.004).map(([v]) => `${d} ${v}`));
      ok(`a search whose results span several categories (${cats.length}) carries no category and moves nothing in her profile`, Boolean(s) && cats.length > 1 && carriedDims(s.data).length === 0 && Boolean(after) && rose.length === 0,
        s ? `${carriedDims(s.data).map(([d, v]) => `${d} ${v}`).join(', ') || 'no dimension carried'} · rose: ${rose.join(', ') || 'nothing'}` : 'no search event');
    }
    await settled();
    const k = press, w = await at();
    route.push(w.path);
    const shown = await evaluate("[...document.querySelectorAll('#view-search #rail-search-grid [data-open], #sheetBody .st-result[data-open]')].filter((e) => window.__s1.vis(e).ok).map((e) => e.dataset.open)");
    const match = storeMatch(Q).map((p) => p.sku);
    ok(`the results are on screen at the store’s search address, /oh/?q=${Q}, every one a match for “${Q}” in the feed`, /^\/oh\/\?/.test(w.path) && w.view === 'search' && new URLSearchParams(w.path.split('?')[1] || '').get('q') === Q && shown.length > 0 && shown.every((x) => match.includes(x)), `${w.path} · ${shown.length} shown of ${match.length} matches`);
    const s = evts(k).filter((e) => e.type === 'custom' && e.data.event === 'search');
    ok(`the search goes on the wire as the beat verbs send one: custom { event: search, control: search, query: “${Q}”, results: ${match.length} }`, s.length === 1 && s[0].data.query === Q && s[0].data.control === 'search' && Number(s[0].data.results) === match.length,
      s.map((e) => JSON.stringify(e.data).slice(0, 140)).join(' · ') || 'no search event');
    const re = await sortIn([k], shown.slice(0, 6));
    ok('the results are POST /sort’s own order over every match, with the regional label on screen', Boolean(re) && re.sent.candidates.length === Math.min(500, match.length) && sameJSON(shown, re.body.order.map(String).filter((x) => shown.includes(x)))
      && /leans with .*synthetic → warehouse/.test(await evaluate("window.__s1.txt('#view-search') + ' ' + window.__s1.txt('#sheetBody')")), re ? `${re.sent.candidates.length} candidates · regional ${JSON.stringify(re.body.regional || null).slice(0, 60)}` : 'no /sort for the search');
    S2S.results = shown;
    await pageAtBoth('the search results');
  });

  // 5. A washer from the results, one whose model comes in another colour.
  let washer = null, sibling = null;
  await step('a washer from the results', async () => {
    washer = (S2S.results || []).map(row).find((p) => p && p.family === 'front-load-washer' && p.cta === 'cart' && p.inStock !== false && colourSibling(p)) || null;
    sibling = colourSibling(washer);
    const a = washer ? await hand(`#view-search #rail-search-grid [data-open="${washer.sku}"], #sheetBody .st-result[data-open="${washer.sku}"]`) : null;
    pressed(a, `the washer ${washer ? washer.sku : '(none in the results with a colour)'}`);
    const k = press, w = await at();
    route.push(w.path);
    ok(`its product page is on screen: /oh/product?id=${washer && washer.sku}`, Boolean(washer) && w.view === 'product' && w.path === `/oh/product?id=${washer && washer.sku}`, `${w.view} · ${w.path}`);
    const pv = evts(k).filter((e) => e.type === 'product_view' && washer && String(e.data.productId) === washer.sku);
    ok('its product_view carries the beat verbs’ attributes', pv.length === 1 && carries(pv[0].data, washer).ok && pv[0].data.view === 'page', pv.length ? carries(pv[0].data, washer).miss.join(', ') : 'no product_view');
    await pageAtBoth(`the washer page (${washer && washer.sku})`);
    await lgLook('the washer page');
  });

  // 6. A colour: the same model in its other finish, from the buy box's own selector.
  await step('a colour from the buy box', async () => {
    const a = sibling ? await hand(`#view-product [data-act="pdp-variant"][data-sku="${sibling.sku}"], #view-product #bbOpts [data-open="${sibling.sku}"]`, { settle: false }) : null;
    await panelFollows('after her colour (select)', [press], (e) => eventName(e) === 'select');
    await settled();
    pressed(a, `the colour “${sibling ? words(sibling.attributes.finish) : '?'}”`);
    const k = press, w = await at(), box = await evaluate("window.__s1.txt('#buyBox')");
    route.push(w.path);
    ok(`the buy box shows ${sibling && sibling.sku} at its own price, ${sibling ? money(sibling.salePrice) : '?'}`, Boolean(sibling) && has(box, sibling.sku) && has(box, money(sibling.salePrice)), `${w.path} · ${box.slice(0, 120)}`);
    const e = evts(k).filter((x) => sibling && String(x.data.productId) === sibling.sku && (x.type === 'product_view' || (x.type === 'custom' && x.data.event === 'select')));
    ok(`the change goes on the wire in the beat verbs’ shape, carrying ${sibling && sibling.sku}’s attributes (a select, or the variant’s product_view)`, e.length > 0 && e.every((x) => carries(x.data, sibling).ok),
      e.map((x) => `${x.type}${x.data.event ? `:${x.data.event}` : ''}`).join(', ') || 'nothing sent');
  });

  // 7. Add to Cart, from the buy box: the order-start action.
  const cartCount = async () => { const c = (await storeNow()).cartCount; return c.length ? Number(c[0]) : null; };
  await step('Add to Cart', async () => {
    const n0 = await cartCount();
    const a = await hand('#buyBox button, #buyBox [data-act]', { text: 'Add to Cart', settle: false });
    pressed(a, 'Add to Cart in the buy box');
    await panelFollows('after her add to cart', [press], (e) => e.type === 'add_to_cart');
    await settled();
    const k = press, n1 = await cartCount();
    ok('the cart counts it in the header: one more', n0 !== null && n1 === n0 + 1, `${n0} → ${n1}`);
    const add = evts(k).filter((e) => e.type === 'add_to_cart');
    const c = add.length ? carries(add[0].data, sibling) : { ok: false, miss: ['no add_to_cart'] };
    ok(`add_to_cart, the order-start action, carries the colour she chose: ${sibling && sibling.sku}, with its attributes and quantity 1`, add.length === 1 && c.ok && Number(add[0].data.quantity) === 1, add.length ? `productId ${add[0].data.productId}${c.miss.length ? ` · differs: ${c.miss.join(', ')}` : ''}` : 'none');
    S2S.add1 = add[0] || null;
    {
      // The decisions it carries are the ones on this page (M2: the decided presses that led here, then the page's offers and modules).
      const ans = await answerIn(HANDS, 'product', her());
      const onPage = ans && ans.url.searchParams.get('ctx.anchor') === (sibling && sibling.sku) ? ans.body.decisions.map((d) => d.decisionId) : [];
      const sent = add[0] ? [add[0].data.decisionId, ...(add[0].data.decisionIds || [])].filter(Boolean) : [];
      ok('with the decision ids of what led her here: each one a decision on this page’s answer, the first credited', sent.length > 0 && sent.every((x) => onPage.includes(x)),
        `${sent.length} sent · ${onPage.length} on the page’s answer`);
    }
    const D0 = await storeNow();
    ok('and the cart drawer opens on her line', D0.sheet.open && D0.cart.lines.some((l) => has(l.sku, sibling && sibling.sku)), D0.sheet.title || 'no drawer');
    if (D0.sheet.open) pressed(await hand('#sheetBody [data-act="store-cart-close"]', { text: 'Continue shopping' }), 'Continue shopping');
    info(add[0] ? `its decisions: ${add[0].data.decisionId ? `decisionId …${String(add[0].data.decisionId).slice(-12)} (${add[0].data.customerContentId || ''})` : 'none: no decided press led to this washer (she came from search)'}` : '');
  });

  // 8. The dryer that goes with it, from the washer page's own decided module, then Add to Cart: credited to that module.
  let dryer = null;
  await step('the dryer the decided module offers, then Add to Cart', async () => {
    const ans = await answerIn(HANDS, 'product', her());
    const mod = ans && ans.body.decisions.find((d) => d.slot === 'pdp-modules' && d.customerContentId === 'mod-laundry-dryer' && ans.url.searchParams.get('ctx.anchor') === (sibling && sibling.sku));
    const tile = await evaluate(`(() => { const m = document.querySelector('#slot-pdp-modules [data-cid="mod-laundry-dryer"]'); const t = m ? [...m.querySelectorAll('[data-open]')].find((x) => window.__s1.vis(x).ok) : null; return t ? t.dataset.open : null; })()`);
    dryer = row(tile);
    const a = tile ? await hand(`#slot-pdp-modules [data-cid="mod-laundry-dryer"] [data-open="${tile}"]`) : null;
    pressed(a, `the dryer ${tile || '(none)'} in the decided “goes with it” module`);
    const k1 = press, w = await at();
    route.push(w.path);
    ok(`the dryer’s page is on screen: /oh/product?id=${tile}`, Boolean(tile) && w.view === 'product' && w.path === `/oh/product?id=${tile}`, w.path);
    const clicks = evts(k1).filter((e) => e.type === 'content_click' && mod && e.data.decisionId === mod.decisionId);
    ok('the press credits the module: a content_click with the decision on screen', Boolean(mod) && clicks.length >= 1, mod ? `${clicks.length} content_click(s) for …${mod.decisionId.slice(-12)}` : 'the washer page’s answer on the wire decided no dryer module');
    const n0 = await cartCount();
    press = `hand ${HANDS.length + 1} · Add to Cart (the dryer)`; HANDS.push(press);
    const b = await hand('#buyBox button, #buyBox [data-act]', { text: 'Add to Cart' });
    pressed(b, 'Add to Cart on the dryer’s page');
    const k2 = press, n1 = await cartCount();
    ok('the cart counts it: one more', n0 !== null && n1 === n0 + 1, `${n0} → ${n1}`);
    const add = evts(k2).filter((e) => e.type === 'add_to_cart');
    ok(`add_to_cart carries the dryer’s attributes and the decision that led here: the module’s decisionId, contentId, slot and content id`, add.length === 1 && Boolean(dryer) && carries(add[0].data, dryer).ok && Boolean(mod)
      && add[0].data.decisionId === mod.decisionId && add[0].data.contentId === mod.contentId && add[0].data.slot === 'pdp-modules' && add[0].data.customerContentId === 'mod-laundry-dryer' && (add[0].data.decisionIds || []).includes(mod.decisionId),
      add.length ? `decisionId ${add[0].data.decisionId ? `…${String(add[0].data.decisionId).slice(-12)}` : 'none'} · ${add[0].data.customerContentId || ''} · ${(add[0].data.decisionIds || []).length} on the trail` : 'none');
    S2S.add2 = add[0] || null; S2S.dryerDecision = mod || null;
    if ((await storeNow()).sheet.open) pressed(await hand('#sheetBody [data-act="store-cart-close"]', { text: 'Continue shopping' }), 'Continue shopping');
    await pageAtBoth(`the dryer page (${tile})`);
  });

  // 9. The cart: the lines, the pair saving the catalog prices, the total.
  await step('the cart', async () => {
    const a = await hand('#site .site-header [data-act="store-cart-open"]');
    pressed(a, 'the cart in the header');
    const C = (await storeNow()).cart;
    const want = [sibling, dryer].filter(Boolean);
    const lines = C.lines.map((l) => ({ sku: (/^([A-Z0-9_-]+)/.exec(l.sku) || [])[1], qty: Number(l.qty), price: dollars(l.price), name: l.name }));
    ok(`the drawer lists her two lines, by name and SKU, one each, at the catalog’s prices: ${want.map((p) => `${p.sku} ${money(p.salePrice)}`).join(' and ')}`,
      lines.length === want.length && want.every((p) => lines.some((l) => l.sku === p.sku && l.qty === 1 && l.price === Number(p.salePrice))), lines.map((l) => `${l.sku} ×${l.qty} ${l.price}`).join(' · ') || 'no line');
    const sub = want.reduce((n, p) => n + Number(p.salePrice), 0);
    const pair = (catalog.pieces || []).find((x) => x.display && x.display.badge === 'bundle' && (x.featuredProductIds || []).includes(sibling && sibling.sku) && ((x.tags || {}).category || []).includes('dryers')
      && (!x.window || !x.window.to || Date.parse(x.window.to) > Date.now()));
    const pairs = Boolean(pair && sibling && dryer && Object.values((sibling.companions || {}).dryers || {}).flat().includes(dryer.sku));
    const saving = pairs ? dollars(`${(pair.display.grammar || {}).value || ''} ${pair.title}`) : 0;
    ok(pairs ? `and the pair saving the catalog prices for a washer with its own dryer: ${money(saving)} (${pair.customerContentId})` : 'and no saving, since these lines complete no set the catalog prices lower',
      pairs ? C.savings.some((s) => has(s, money(saving))) : C.savings.length === 0, C.savings.join(' · ').slice(0, 140) || 'no saving row');
    ok(`the total is the lines less the saving: ${money(sub - saving)}`, dollars(C.total) === Number((sub - saving).toFixed(2)), `total on screen ${C.total || 'none'} · subtotal ${money(sub)}`);
    await pageAtBoth('the cart drawer');
    await lgLook('the cart drawer');
    await shot('S2-09-cart');
    const z = await hand('#sheetBody [data-act="store-cart-close"]', { text: 'Continue shopping' });
    pressed(z, 'Continue shopping');
  });

  // 10. Find a Retailer, on the dryer's page: Buy directly first, then the online sellers and the nearby stores.
  await step('Find a Retailer', async () => {
    const a = await hand('#view-product [data-act="store-retailers"], #view-product [data-act="find-retailer"], #view-product button, #view-product a', { text: 'Find a Retailer' });
    pressed(a, 'Find a Retailer');
    const k = press, R = (await storeNow()).retailers, p = dryer;
    const piece = (catalog.pieces || []).find((x) => x.customerContentId === 'mod-where-to-buy-retailer');
    const own = piece && piece.display && piece.display.retailers;
    const lists = own && p ? ((own.groups || []).find((g) => (g.families || []).includes(p.family)) || own[(p.attributes || {}).room] || own[(p.attributes || {}).category] || null) : null;
    const names = (l) => (l || []).map((x) => (Array.isArray(x) ? x[1] : x && (x.name || x.label)) || String(x));
    ok('the modal opens on “Buy directly” first, then the online sellers, then the nearby stores', R.heads.length >= 3 && /buy directly/i.test(R.heads[0]) && R.heads.some((h) => /online/i.test(h)) && R.heads.some((h) => /nearby/i.test(h))
      && R.heads.findIndex((h) => /online/i.test(h)) < R.heads.findIndex((h) => /nearby/i.test(h)), R.heads.join(' › '));
    ok('it lists the online sellers and the nearby stores, named, the nearby ones in her region from the request', R.online.length > 0 && R.nearby.length > 0 && R.nearbyLines.every((l) => /from the request/i.test(l)),
      `online ${R.online.join(', ')} · nearby ${R.nearby.join(', ')}`);
    if (lists) ok(`and the lists are the catalog’s where-to-buy piece’s, for ${lists.label || words((p.attributes || {}).room)}, and the modal says so`, R.source === 'catalog' && sameJSON(R.online, names(lists.online)) && sameJSON(R.nearby, names(lists.nearby)),
      `catalog online ${names(lists.online).join(', ')} · nearby ${names(lists.nearby).join(', ')}`);
    else checks.known('and the lists are the catalog’s where-to-buy piece’s', false, `mod-where-to-buy-retailer carries no display.retailers; the modal says its list is “${(/\(([^)]*)\)/.exec(R.fine) || [, 'unnamed'])[1]}”`,
      'D1 (catalog.json: the where-to-buy piece’s lists per room, design §9.3) and M3 (oh-store.js falls back to its own list)');
    ok('and says a referral is not a sale', /a referral is not a sale/i.test(R.fine), R.fine.slice(0, 120));
    const f = evts(k).filter((e) => e.type === 'custom' && e.data.event === 'find_a_retailer');
    ok('Find a Retailer goes on the wire as the store sends it: custom { event: find_a_retailer, control } with the product’s own attributes, none overwritten', f.length === 1 && carries(f[0].data, p).ok && ['buy-box', 'where-to-buy'].includes(f[0].data.control),
      f.map((e) => JSON.stringify(e.data).slice(0, 120)).join(' · ') || 'none');
    await pageAtBoth('the Find a Retailer modal');
    await shot('S2-10-retailers');
    // The custom outcome, pressed: the first online seller.
    press = `hand ${HANDS.length + 1} · a seller`; HANDS.push(press);
    const seller = R.online[0];
    const b = seller ? await hand('#sheetBody [data-act="store-referral"][data-where="online"]', { nth: 0 }) : null;
    pressed(b, `“Shop at ${seller || '?'}”`);
    const ref = evts(press).filter((e) => e.type === 'custom' && e.data.event === 'retailer_referral');
    const wtb = (await answerIn(HANDS, 'product', her()));
    const dec = wtb && wtb.url.searchParams.get('ctx.anchor') === (p && p.sku) ? wtb.body.decisions.find((d) => d.customerContentId === 'mod-where-to-buy-retailer') : null;
    ok(`the referral goes on the wire as the outcome: custom { event: retailer_referral } with the product’s own attributes (its retailer value kept), the store chosen in data.store (${R.onlineKeys[0] || '?'}), where online${dec ? ', credited to the where-to-buy decision on this page' : ', credited to no decision (none decided on this page)'}`,
      ref.length === 1 && carries(ref[0].data, p).ok && ref[0].data.store === R.onlineKeys[0] && ref[0].data.where === 'online' && (dec ? ref[0].data.decisionId === dec.decisionId : !ref[0].data.decisionId), ref.length ? `partner ${ref[0].data.partner} · decision ${ref[0].data.decisionId ? `…${String(ref[0].data.decisionId).slice(-12)}` : 'none'}` : 'none');
  });

  // 11. Back twice, with the browser's own Back.
  let pos = route.length - 1;
  for (const n of [1, 2]) {
    await step(`the browser’s Back (${n} of 2)`, async () => {
      const was = await at();
      const b = await browserBack();
      const now = await at();
      const want = route[pos - 1];
      ok(`Back goes where she was before: ${want || '?'}`, b.ok && Boolean(want) && now.path === want && (now.view === 'product' ? has(await evaluate("window.__s1.txt('#buyBox')"), new URLSearchParams(now.path.split('?')[1] || '').get('id')) : true),
        `${was.path} → ${now.path} (${now.view})`);
      pos -= 1;
    });
  }

  // 12. Home, by the wordmark: the homepage moved for her, with receipts naming her own clicks.
  await step('home, by the wordmark', async () => {
    const a = await hand('#site .site-header a.wordmark, #site .site-header [data-ctl="home"]');
    pressed(a, 'the wordmark');
    const k = press, w = await at();
    ok('the homepage is on screen at /oh/', w.view === 'home' && w.path === '/oh/', `${w.view} · ${w.path}`);
    await sleep(SETTLE_MS);
    await settled();
    const S = await snap();
    const lastEvent = [...requests.values()].filter((r) => HANDS.includes(r.press) && r.path === '/realtime/action').reduce((m, r) => Math.max(m, r.at), 0);
    const ans = await answerIn([k], 'home', her());
    ok('the homepage re-asks after her session: a snapshot for home after her last event, with her own session', Boolean(ans) && ans.at >= lastEvent, ans ? 'asked' : 'no snapshot for home on this press');
    await inEngineOrder('her homepage', S, k);
    const now = { tiles: (S.slots.find((s) => s.slot === 'category-rail') || { cards: [] }).cards.map((c) => c.cid), deals: (S.slots.find((s) => s.slot === 'deals') || { cards: [] }).cards.map((c) => c.cid),
      rail: ((S.railsOn || []).find((r) => r.rail === 'for-you') || { cards: [] }).cards.map((c) => String(c.sku)) };
    const boot = S2.boot || { tiles: [], deals: [], rail: [] };
    ok('the room tiles’ order moved for her from the template', now.tiles.length > 0 && !sameJSON(now.tiles, boot.tiles), `${boot.tiles.join(', ')} → ${now.tiles.join(', ')}`);
    ok('the deals four moved for her', now.deals.length === 4 && !sameJSON(now.deals, boot.deals), `${boot.deals.join(', ')} → ${now.deals.join(', ')}`);
    ok('Recommended for you moved for her', now.rail.length >= 4 && !sameJSON(now.rail, boot.rail.slice(0, now.rail.length)), `${boot.rail.slice(0, 4).join(', ')} → ${now.rail.slice(0, 4).join(', ')}`);
    // Receipts naming her own clicks: a card's receipt on screen names a value her own events carried, and the engine's
    // decision for that card holds it among its drivers.
    const carried = new Set(eventsIn(HANDS).flatMap((e) => ['room', 'type', 'category', 'finish', 'series', 'fuel', 'sizeBand'].map((d) => e.data[d]).filter((v) => typeof v === 'string')));
    const decided = ans ? ans.body.decisions : [];
    const cards = await evaluate(`[...document.querySelectorAll('#view-home [data-op-decision-id]')].filter((e) => e.dataset.opDecisionId && window.__s1.vis(e).ok).map((e) => ({ id: e.dataset.opDecisionId, cid: e.dataset.cid, receipt: window.__s1.txt(e.querySelector('.receipt')) }))`);
    const naming = cards.map((c) => { const d = decided.find((x) => x.decisionId === c.id); const own = ((d && d.explain && d.explain.drivers) || []).filter((x) => x.dim !== 'regional' && carried.has(String(x.value)));
      return { cid: c.cid, named: own.filter((x) => has(c.receipt, x.value) || has(c.receipt, words(x.value))).map((x) => `${x.dim} ${x.value}`) }; }).filter((c) => c.named.length);
    ok('with receipts naming her own clicks: decided cards whose receipt names a value her own events carried, a driver of the engine’s decision', naming.length > 0,
      naming.slice(0, 4).map((c) => `${c.cid}: ${c.named.join(', ')}`).join(' · ') || `${cards.length} decided cards, her values ${[...carried].slice(0, 6).join(', ')}`);
    await pageAtBoth('her homepage');
    await lgLook('her homepage');
    await shot('S2-12-home-moved');
  });

  // 13. A room tile on her homepage: the one the engine put first goes to its room's grid, and the press credits the tile.
  await step('the first room tile on her homepage', async () => {
    const tile = await evaluate("(() => { const t = [...document.querySelectorAll('#slot-category-rail [data-op-decision-id]')].find((e) => e.dataset.opDecisionId && window.__s1.vis(e).ok); return t ? { cid: t.dataset.cid, id: t.dataset.opDecisionId } : null; })()");
    const piece = tile ? OPEN_PIECES.get(tile.cid) : null;
    const cats = piece ? (((piece.display || {}).categories || []).length ? piece.display.categories : ((piece.tags || {}).category || [])) : [];
    const room = piece ? (((piece.tags || {}).room || [])[0] || null) : null;
    const want = room === 'laundry-room' ? '/oh/?view=laundry' : room === 'kitchen' ? '/oh/?view=kitchen' : cats.includes('tvs') ? '/oh/?view=tvs' : '/oh/search?q=';
    const a = tile ? await hand(`#slot-category-rail [data-cid="${tile.cid}"] .p1-tile-hit, #slot-category-rail [data-cid="${tile.cid}"] button`) : null;
    pressed(a, `the room tile ${tile ? tile.cid : '(none decided)'}`);
    const k = press, w = await at();
    const shown = await evaluate("[...document.querySelectorAll('#stage > .view:not([hidden]) .rail [data-open]')].filter((e) => window.__s1.vis(e).ok).length");
    ok(`the tile goes to its room’s grid (${want.replace('/oh/', '')}), with products on screen`, Boolean(tile) && w.path.startsWith(want) && w.view !== 'home' && shown > 0, `${w.path} · ${w.view} · ${shown} products`);
    const credit = evts(k).filter((e) => e.type === 'content_click' && tile && e.data.decisionId === tile.id);
    ok('and the press credits the tile: a content_click with the decision on screen', credit.length === 1, `${credit.length} content_click(s)`);
    await pageAtBoth(`the room grid from the tile (${w.path})`);
  });

  // The session as a whole: one visitor, and every event in the beat verbs' shapes.
  {
    const all = eventsIn(HANDS);
    {
      // The guard (coordinator): every manual event about a product carries the dimension attributes product_view carries for
      // that product: its product_view's body on the wire, else what productAttrs builds from the feed (product_view's builder).
      const views = new Map(all.filter((e) => e.type === 'product_view' && e.data.productId).map((e) => [String(e.data.productId), e.data]));
      const about = all.filter((e) => PRODUCT_EVENTS.has(eventName(e)));
      const short = about.flatMap((e) => { const sku = e.data.productId ? String(e.data.productId) : null;
        if (!sku) return [`${eventName(e)}: no product`];
        const want = views.get(sku) || (row(sku) ? attrsOf(row(sku)) : {});
        const miss = DIMS.filter((d) => d in want && JSON.stringify(e.data[d]) !== JSON.stringify(want[d]));
        return miss.length ? [`${eventName(e)} ${sku}: ${miss.join(', ')}`] : []; });
      ok(`every manual event about a product carries the dimension attributes its product_view carries (${about.length}: ${[...new Set(about.map(eventName))].join(', ')})`, about.length > 0 && short.length === 0, short.slice(0, 4).join(' ~ ') || 'all equal');
    }
    const caps = [...new Set(all.map((e) => e.cap))];
    const mints = [...requests.values()].filter((r) => HANDS.includes(r.press) && /\/identity\/session$/.test(r.path));
    ok(`one visitor for the whole session: one mint, every one of her ${all.length} events on one session, every one accepted`, mints.length === 1 && caps.length === 1 && all.every((e) => e.status === 200),
      `${mints.length} mint(s) · ${caps.length} session(s) · refused ${all.filter((e) => e.status !== 200).map((e) => `${e.type} ${e.status}`).join(', ') || 'none'}`);
    const SHAPES = new Set(['page_view', 'product_view', 'add_to_cart', 'content_click', 'custom']);
    const odd = all.filter((e) => !SHAPES.has(e.type) || (e.type === 'custom' && !e.data.event));
    ok('every manual action used the beat verbs’ types: page_view, product_view, add_to_cart, content_click, or custom with its event named', odd.length === 0, odd.map((e) => e.type).join(', ') || [...new Set(all.map((e) => (e.type === 'custom' ? `custom:${e.data.event}` : e.type)))].join(', '));
    if (S2.reloads.length) info(`a full page load happened ${S2.reloads.length} time(s) in the session: ${S2.reloads.join(', ')}`);
    S2.hands = HANDS;
  }
  {
    // A direct load of a search address (M3's contract): /oh/?q=<text> in a fresh page renders the results with nobody
    // minted, its only call the cold-start lookup; the first click (a result) mints her and opens that product.
    console.log('   ─ a search address loaded directly');
    await cdp('Page.navigate', { url: 'about:blank' });
    await sleep(400);
    await settled(500, 10000);
    press = 'search-direct'; HANDS.push(press);
    await cdp('Network.clearBrowserCookies');
    await cdp('Storage.clearDataForOrigin', { origin: new URL(base).origin, storageTypes: 'all' });
    await forgetTab();
    const Q2 = 'front load washer';
    const nav = await cdp('Page.navigate', { url: `${base}/${SLUG}/?q=${encodeURIComponent(Q2)}` });
    await booted();
    await evaluate(inPage(pageHelpers));
    await sleep(1500);
    const w = await at();
    const shown = await evaluate("[...document.querySelectorAll('#view-search #rail-search-grid [data-open]')].filter((e) => window.__s1.vis(e).ok).map((e) => e.dataset.open)");
    const match = storeMatch(Q2).map((p) => p.sku);
    ok(`a direct load of /oh/?q=${Q2} renders its results, every one a match in the feed`, w.view === 'search' && shown.length > 0 && shown.every((x) => match.includes(x)), `${w.path} · ${w.view} · ${shown.length} shown of ${match.length}`);
    const calls = [...requests.entries()].filter(([id]) => LOADER.get(id) === nav.loaderId).map(([, r]) => r);
    ok('with nobody minted: its only call on load is the cold-start lookup', calls.every((r) => r.path === `${API}/coldstart`), calls.map((r) => `${r.method} ${r.path}`).join(' ~ ') || 'none');
    press = 'search-direct · first click'; HANDS.push(press);
    const a = shown[0] ? await hand(`#view-search #rail-search-grid [data-open="${shown[0]}"]`) : null;
    pressed(a, `the first result (${shown[0] || 'none'})`);
    const minted = [...requests.values()].filter((r) => r.press === press && /\/identity\/session$/.test(r.path));
    const w2 = await at();
    ok('and the first click mints her and opens that product', minted.length === 1 && w2.view === 'product' && w2.path === `/oh/product?id=${shown[0]}`, `${minted.length} mint · ${w2.path}`);
    await pageAtBoth('the search page, loaded directly');
  }
}


// ── Lane S2: at phone width, 390 (R5's ruling, 1281db3) ─────────────────────
// A stranger's /oh/ at 390×844: the presenter's tools are put away entirely (the collapsed director's pill too) unless the
// address says ?present=1; the deals and Recommended for you each show one item at a time, with a pager she can press.
const PAGER = '[class*="pager"], [class*="dots"], [class*="pagination"], [class*="m1-car-dot"], [aria-label*="slide" i], [aria-label*="page" i]';
const CAROUSELS = [['the deals', '#mod-deals', '#slot-deals .p1-deal'], ['Recommended for you', '#mod-for-you', '#rail-for-you [data-open]']];
const CAROUSEL_READ = (root, items) => `(() => { const { vis, txt } = window.__s1;
  const R = document.querySelector(${JSON.stringify(root)}); if (!R) return null;
  const outer = (sel) => [...R.querySelectorAll(sel)].filter((e) => { const up = e.parentElement && e.parentElement.closest(sel); return !up || !R.contains(up); });
  const all = outer(${JSON.stringify(items)}).filter((e) => vis(e).ok);
  const full = (e) => { const r = e.getBoundingClientRect(); const seen = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)); return r.width > 0 && seen >= r.width * 0.8; };
  const pagers = [...R.querySelectorAll(${JSON.stringify(PAGER)})].filter((e) => vis(e).ok && !e.closest('.m1-deal-tabs'));
  const pager = pagers[0] || null;
  return { items: all.length, onScreen: all.filter(full).map((e) => e.dataset.cid || e.dataset.open || txt(e).slice(0, 30)),
    pager: pager ? { cls: (typeof pager.className === 'string' ? pager.className : '').trim().split(' ')[0] || pager.tagName.toLowerCase(), text: txt(pager).slice(0, 40),
      controls: [...pager.querySelectorAll('button, a, [role="tab"]')].filter((b) => vis(b).ok).length || (pager.matches('button, a') ? 1 : 0) } : null };
})()`;
async function phoneWidth() {
  console.log('\n── At phone width, 390: the director put away, the deals and the rail one at a time (R5’s ruling)');
  const toPhone = async (url) => {
    await cdp('Page.navigate', { url: 'about:blank' });
    await sleep(300);
    await settled(500, 8000);
    await cdp('Network.clearBrowserCookies');
    await cdp('Storage.clearDataForOrigin', { origin: new URL(base).origin, storageTypes: 'all' });
    await forgetTab();
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await cdp('Page.navigate', { url });
    const up = await booted();
    await evaluate(inPage(pageHelpers));
    await sleep(1200);
    await imagesSettled();
    return up;
  };
  const tools = () => evaluate("(() => { const v = window.__s1.vis; const pill = ['#dockRail', '.dock-rail', '#dockOpen', '#dockNext'].some((s) => v(s).ok); return { pill, machine: v('#machine').ok, director: v('.director').ok, overflow: document.documentElement.scrollWidth - innerWidth }; })()");
  press = 'phone-390';
  const up = await toPhone(`${base}/${SLUG}/`);
  const T = await tools();
  ok('at 390 a stranger’s /oh/ shows the store alone: the collapsed director’s pill, the machine panel and the director bar are not on screen', up && !T.pill && !T.machine && !T.director,
    `pill ${T.pill} · machine ${T.machine} · director ${T.director}`);
  ok('and the page does not scroll sideways at 390: the carousels scroll inside themselves', T.overflow <= 1, `overflow ${T.overflow}px`);
  for (const [name, root, items] of CAROUSELS) {
    const C = await evaluate(CAROUSEL_READ(root, items));
    ok(`${name} at 390 is a one-at-a-time carousel with a pager: one item on screen of ${C ? C.items : '?'}, a pager beside it`,
      Boolean(C && C.items >= 2 && C.onScreen.length === 1 && C.pager && (C.pager.controls >= 1 || /\d+\s*\/\s*\d+/.test(C.pager.text))),
      C ? `on screen ${C.onScreen.join(', ') || 'none'} · pager ${C.pager ? `${C.pager.cls} (${C.pager.controls} control(s)${C.pager.text ? `, “${C.pager.text}”` : ''})` : 'none'}` : 'not on the page');
    if (C && C.pager && C.pager.controls >= 1 && C.onScreen.length === 1) {
      // The pager works by hand: its next control (an arrow named next, else its second control) brings another item on screen.
      const sel = `${root} ${PAGER.split(', ').map((s) => `${s} button, ${s} [role="tab"]`).join(', ')}`;
      const named = await hand(sel, { text: 'next', settle: false });
      const a = named && named.ok ? named : await hand(sel, { nth: 1, settle: false });
      await sleep(900);
      const C2 = await evaluate(CAROUSEL_READ(root, items));
      ok(`and its pager works by hand: pressing it brings another item on screen, still one at a time`, Boolean(a && a.ok && C2 && C2.onScreen.length === 1 && C2.onScreen[0] !== C.onScreen[0]),
        `${a && a.ok ? `pressed “${a.label}”` : (a && a.why) || 'nothing pressed'} · ${C.onScreen[0]} → ${C2 ? C2.onScreen.join(', ') || 'none' : '?'}`);
    }
  }
  await shot('S2-390-home');
  press = 'phone-390-present';
  await toPhone(`${base}/${SLUG}/?present=1`);
  const P = await tools();
  ok('and with ?present=1 the presenter’s tools are on screen at 390', P.pill || P.machine || P.director, `pill ${P.pill} · machine ${P.machine} · director ${P.director}`);
  await cdp('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
}


/** The panel by dimension (M3: config.signals.byDimension): each row's dimension, leading value and reading, and its second. */
const DIM_ROWS = `(() => { const { txt } = window.__s1;
  const own = (el) => (el ? [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/\\s+/g, ' ').trim() : '');
  const rows = [...document.querySelectorAll('#vectors .vecrow[data-dim]')].map((r) => { const v2 = r.querySelector('.vec2'); const m = v2 ? /^(.*)\\s([\\d.]+)$/.exec(txt(v2)) : null;
    return { dim: r.dataset.dim, value: own(r.querySelector('.vectop span')), a: Number(txt(r.querySelector('.vectop b'))), second: m ? { value: m[1], a: Number(m[2]) } : null }; });
  const jn = document.getElementById('justNow');
  const items = jn ? [...jn.querySelectorAll('li')].map((li) => ({ value: txt(li.querySelector('b')), text: txt(li) })) : [];
  return { rows, just: { head: jn ? txt(jn.querySelector('.jn-k')) : '', items }, vector: (window.__oh && window.__oh.state && window.__oh.state.lastVector) || null };
})()`;
async function signalsWalk() {
  console.log('\n── Her signals, by hand: one click registers at once; three washers after two TVs lead the panel; home leads with laundry');
  const HANDS2 = [];
  const step = (name) => { press = `signals · ${name}`; HANDS2.push(press); };
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(300);
  await settled(500, 8000);
  await cdp('Network.clearBrowserCookies');
  await cdp('Storage.clearDataForOrigin', { origin: new URL(base).origin, storageTypes: 'all' });
  await forgetTab();
  await cdp('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: `${base}/${SLUG}/?debug=1&present=0` });
  await booted();
  await evaluate(inPage(pageHelpers));
  await sleep(1200);
  const reg = anchor.registry || {}, K = Number(reg.K) || 1.8, wpv = Number((reg.weights || {}).product_view) || 1, oneTouch = wpv / (wpv + K);
  const cap = () => { const e = eventsIn(HANDS2); return e.length ? e[e.length - 1].cap : null; };
  const pv = async (sku) => { for (let i = 0; i < 60; i += 1) { const e = eventsIn([press]).find((x) => x.type === 'product_view' && String(x.data.productId) === sku); if (e) { for (let j = 0; j < 40; j += 1) { const r = [...requests.values()].filter((q) => q.press === press && q.path === '/realtime/action').pop(); if (!r || r.status !== null) break; await sleep(50); } return e; } await sleep(100); } return null; };
  const at = async () => path((await storeNow()).address);
  // Two TVs from the grid, the browser's Back between them.
  step('TVs'); await hand('#site .site-header #mainnav [data-nav="tvs"]');
  const tvs = (await evaluate("[...document.querySelectorAll('#view-tvs #rail-tv-grid [data-open]')].filter((e) => window.__s1.vis(e).ok).map((e) => e.dataset.open)")).slice(0, 2);
  for (const [i, sku] of tvs.entries()) {
    step(`TV ${i + 1}`);
    await hand(`#view-tvs #rail-tv-grid [data-open="${sku}"]`, { settle: false });
    const e = await pv(sku);
    if (i === 0) {
      // One click registers at once: within two seconds of the view's answer, with no press, the room it carried reads on the
      // panel and in the page's vector what the engine holds, which is the registry's one-touch reading, w / (w + K).
      const room = e && e.data.room, t0 = Date.now(), engine = await engineReading(e && e.cap);
      const want = engine && engine.room ? Number(engine.room[room] || 0) : 0;
      let D = null, hit = false;
      do { D = await evaluate(DIM_ROWS); const r = D.rows.find((x) => x.dim === 'room'); hit = Boolean(r && r.value === room && Math.abs(r.a - want) <= 0.011 && D.vector && D.vector.room && Math.abs(Number(D.vector.room[room] || 0) - want) <= 0.02); if (hit) break; await sleep(200); } while (Date.now() - t0 < 2000);
      const r = D.rows.find((x) => x.dim === 'room');
      ok(`one click registers at once: the first view’s room (${room}) reads on the panel within two seconds what the engine holds, the one-touch reading ${oneTouch.toFixed(2)}`,
        hit && Math.abs(want - oneTouch) <= 0.02, `engine ${want.toFixed(2)} · panel ${r ? `${r.value} ${r.a.toFixed(2)}` : 'no room row'} · ${Date.now() - t0} ms`);
    }
    await settled();
    await browserBack();
  }
  // The Laundry menu's own "Washers", then three washers from that grid, Back between them.
  step('the Laundry menu');
  await hand('#site .site-header #mainnav [data-menu="laundry"]');
  await hand('#menu-laundry [data-ctl^="menu-head-washers"]');
  const grid = (await evaluate("[...document.querySelectorAll('#stage > .view:not([hidden]) .rail [data-open]')].filter((e) => window.__s1.vis(e).ok).map((e) => e.dataset.open)"))
    .filter((sku) => { const p = row(sku); return p && p.attributes && p.attributes.category === 'washers'; }).slice(0, 3);
  ok(`the Laundry menu’s Washers opens a grid of washers to open (${grid.length})`, grid.length === 3, `${await at()} · ${grid.join(', ')}`);
  for (const [i, sku] of grid.entries()) {
    step(`washer ${i + 1}`);
    await hand(`#stage > .view:not([hidden]) .rail [data-open="${sku}"]`, { settle: false });
    const e = await pv(sku);
    if (i === 0) {
      // The "just now" strip names what the view moved, within two seconds: washers · category, with the engine's score.
      const t0 = Date.now(), engine = await engineReading(e && e.cap);
      const want = engine && engine.category ? Number(engine.category.washers || 0) : 0;
      let D = null, item = null;
      const scoreOk = (x) => { const m = /\bcategory\b\D*?(\d+\.\d+)/i.exec(x.text); return Boolean(m) && Math.abs(Number(m[1]) - want) <= 0.011; };
      do { D = await evaluate(DIM_ROWS); item = D.just.items.find((x) => x.value === 'washers' && /\bcategory\b/i.test(x.text)); if (item && scoreOk(item)) break; await sleep(200); } while (Date.now() - t0 < 2000);
      const cat = D.rows.find((x) => x.dim === 'category') || null;
      ok('and after that one washer the category row shows tvs leading, washers second', Boolean(cat && cat.value === 'tvs' && cat.second && cat.second.value === 'washers'),
        cat ? `category: ${cat.value} ${cat.a.toFixed(2)}${cat.second ? ` · ${cat.second.value} ${cat.second.a.toFixed(2)}` : ''}` : 'no category row');
      ok(`after a washer view following the TVs, the “just now” strip names washers · category with its score, ${want.toFixed(2)}, within two seconds`,
        Boolean(item) && scoreOk(item), `“${D.just.head}” ${D.just.items.slice(0, 3).map((x) => x.text).join(' | ').slice(0, 160)} · ${Date.now() - t0} ms`);
    }
    await settled();
    await browserBack();
  }
  {
    // Three washers after two TVs (about twenty seconds, the memory sixty): the panel's category row leads with washers over
    // tvs and its room row with laundry-room over living-room, as the engine holds them.
    const engine = await engineReading(cap());
    const D = await evaluate(DIM_ROWS);
    const rowOf = (dim) => D.rows.find((x) => x.dim === dim) || null;
    const leads = (dim, top, under) => { const r = rowOf(dim); return Boolean(r && r.value === top && (!r.second || r.second.value === under || Number(r.second.a) <= r.a)) && engine && engine[dim] && Number(engine[dim][top] || 0) > Number(engine[dim][under] || 0); };
    const show = (dim) => { const r = rowOf(dim); return r ? `${dim}: ${r.value} ${r.a.toFixed(2)}${r.second ? ` over ${r.second.value} ${r.second.a.toFixed(2)}` : ''}` : `${dim}: no row`; };
    ok('three washers after two TVs: the panel’s category row reads washers above tvs, and the engine holds the same', leads('category', 'washers', 'tvs'), show('category'));
    ok('and its room row reads laundry-room above living-room', leads('room', 'laundry-room', 'living-room'), show('room'));
  }
  // Home, by the wordmark: the engine's next homepage answer leads with laundry (the hero's or the four's first piece).
  step('home');
  await hand('#site .site-header a.wordmark, #site .site-header [data-ctl="home"]');
  await sleep(SETTLE_MS);
  const ans = await answerIn([press], 'home', cap());
  const first = (slot) => (ans ? ans.body.decisions.filter((d) => d.slot === slot).sort((a, b) => a.order - b.order)[0] : null);
  const roomOfCid = (cid) => (((OPEN_PIECES.get(cid) || {}).tags || {}).room || []);
  const lead = ['hero', 'deals'].map((slot) => [slot, first(slot)]).filter(([, d]) => d);
  ok('and the next homepage answer leads with laundry: its hero or its first deal is the laundry room’s, read off the engine’s answer', lead.some(([, d]) => roomOfCid(d.customerContentId).includes('laundry-room')),
    lead.map(([slot, d]) => `${slot} ${d.customerContentId} (${roomOfCid(d.customerContentId).join(', ') || 'no room'})`).join(' · ') || 'no answer for home');
}


// ── Lane S2: one visitor across full page loads ──────────────────────────────
/** The userId each of her events carried in a press (the action's body), in order. */
const userIdsIn = (key) => [...requests.values()].filter((r) => r.press === key && r.path === '/realtime/action').map((r) => { try { return JSON.parse(r.body).userId || null; } catch { return null; } }).filter(Boolean);
const mintsIn = (key) => [...requests.values()].filter((r) => r.press === key && /\/identity\/session$/.test(r.path)).length;
const cookieOf = async (name) => { const host = new URL(base).hostname; const c = await cdp('Network.getAllCookies'); return ((c.cookies || []).find((x) => x.name === name && x.domain.replace(/^./, '') === host) || {}).value || null; };
const sameCookie = (a, b) => (a ? b === a : !b);
/** A second tab in the same browser profile, on its own DevTools connection, with its API requests recorded. */
async function openTab(url) {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('the new tab’s DevTools socket did not open')); });
  let id = 0; const pending = new Map(); const seen = [];
  ws.onmessage = (m) => { const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result || {}); pending.delete(msg.id); return; }
    if (msg.method === 'Network.requestWillBeSent') { let p = ''; try { p = new URL(msg.params.request.url).pathname; } catch { /* not a URL */ }
      if (p === '/realtime/action' || /\/identity\/session$/.test(p)) seen.push({ path: p, body: msg.params.request.postData || null }); } };
  const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Network.enable'); await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url });
  return { seen, send, close: async () => { try { ws.close(); } catch { /* closing */ } await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`).catch(() => null); } };
}
async function persistenceWalk() {
  console.log('\n── One visitor across full page loads: a reload, a direct product address, a new tab');
  const washers = rowsAll.filter((p) => p.family === 'front-load-washer' && p.cta === 'cart' && p.inStock !== false && Number(p.salePrice) > 0).slice(0, 3);
  const [A, B, C] = washers;
  const K = Number((anchor.registry || {}).K) || 1.8;
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(300);
  await settled(500, 8000);
  await cdp('Network.clearBrowserCookies');
  // No Storage.clearDataForOrigin here (coordinator, hosted): a clear of every store, the image cache included, can still be in
  // flight when load 1 writes her record. The cookies are cleared above; forgetTab clears and settles both web stores itself.
  const fresh = await forgetTab();
  ok('before load 1 the tab’s storage is writable, empty and settled: a probe written after the clear is still there a second later, and nothing else', fresh.settled, `${fresh.tries} attempt(s)`);
  await cdp('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  const addr = (p) => `${base}/${SLUG}/product?id=${encodeURIComponent(p.sku)}&debug=1&present=0`;
  /** One full load (a navigation or a reload): booted, its product_view answered, then her washers reading on the panel and at the engine. */
  const loadOnce = async (key, how) => {
    press = key;
    if (how === 'reload') await cdp('Page.reload', { ignoreCache: true }); else await cdp('Page.navigate', { url: how });
    await booted();
    const readyAt = Date.now(), decided = await waitFor("/decided live|error|failed/i.test((document.getElementById('status') || {}).textContent || '')", 30000);
    const keptAtReady = await evaluate("Object.keys(localStorage).some((k) => k.startsWith('opt_shopper_session:'))");
    await evaluate(inPage(pageHelpers));
    let evt = null;
    for (let i = 0; i < 100 && !evt; i += 1) { evt = eventsIn([key]).find((e) => e.type === 'product_view') || null; if (!evt) await sleep(100); }
    for (let i = 0; i < 60; i += 1) { const r = [...requests.values()].filter((q) => q.press === key && q.path === '/realtime/action').pop(); if (!r || r.status !== null) break; await sleep(50); }
    const engine = await engineReading(evt && evt.cap);
    const want = engine && engine.category ? Number(engine.category.washers || 0) : 0;
    const t0 = Date.now(); let D = null, panel = null;
    do { D = await evaluate(DIM_ROWS); const r = D.rows.find((x) => x.dim === 'category'); panel = r && r.value === 'washers' ? r.a : null; if (panel !== null && Math.abs(panel - want) <= 0.011) break; await sleep(200); } while (Date.now() - t0 < 2000);
    const mine = [...requests.entries()].filter(([, r]) => r.press === key).sort((x, y) => x[1].at - y[1].at);
    const mintAt = mine.filter(([, r]) => /\/identity\/session$/.test(r.path)).map(([id]) => ANSWERED.get(id) || null).find(Boolean) || null;
    const firstAction = mine.find(([, r]) => r.path === '/realtime/action');
    const probe = mine.find(([, r]) => r.path === '/realtime/reflex' && (!firstAction || r.at <= firstAction[1].at)) || null;
    return { ids: userIdsIn(key), mints: mintsIn(key), cookie: await cookieOf('opt_user_id'), engine: want, panel, cap: evt ? evt.cap : null, mintAt, decided, keptAtReady, readyMs: Date.now() - readyAt,
      probe: probe ? { status: probe[1].status, cap: header(probe[1], 'X-Shopper-Session') || null, at: probe[1].at } : null };
  };
  const one = await loadOnce('persist · a direct product address', addr(A));
  const two = await loadOnce('persist · a full reload', 'reload');
  const three = await loadOnce('persist · another product address', addr(B));
  const probeSays = (x) => (x.probe
    ? `resume probe GET /realtime/reflex → ${x.probe.status === null ? 'no answer' : x.probe.status}, ${x.probe.cap && x.probe.cap === one.cap ? 'with load 1’s capability' : x.probe.cap ? 'with another capability' : 'with no capability'}${one.mintAt ? `, ${x.probe.at - one.mintAt} ms after load 1’s mint answered` : ''}${x.probe.status === 401 || x.probe.status === 403 ? ': the engine refused a kept session' : ''}`
    : 'no resume probe on the wire: nothing kept was found in storage at this load');
  info(`the page’s resume, read off the wire: the reload, ${probeSays(two)} · the direct load, ${probeSays(three)} · at each load’s own ready (“decided live”) her record was ${[one, two, three].map((x) => (x.decided ? (x.keptAtReady ? 'kept' : 'not yet kept') : 'never ready')).join(', ')}`);
  const same = (x) => x.ids.length > 0 && one.ids.length > 0 && x.ids.every((u) => u === one.ids[0]);
  ok('a full reload continues the same visitor: the same userId on her events, the same opt_user_id cookie, and no new identity call', same(two) && sameCookie(one.cookie, two.cookie) && two.mints === 0,
    `userId ${same(two) ? 'the same' : 'changed'} · cookie ${one.cookie ? (two.cookie === one.cookie ? 'the same' : 'changed') : 'none set by the engine on this route'} · ${two.mints} new identity call(s) · ${probeSays(two)}`);
  ok('and a direct load of another product address continues her too', same(three) && sameCookie(one.cookie, three.cookie) && three.mints === 0,
    `userId ${same(three) ? 'the same' : 'changed'} · cookie ${one.cookie ? (three.cookie === one.cookie ? 'the same' : 'changed') : 'none set by the engine on this route'} · ${three.mints} new identity call(s) · ${probeSays(three)}`);
  const touch = (n) => n / (n + K);
  const steps = [one, two, three];
  ok(`her readings accumulate across those loads, on the panel as the engine holds them: washers · category ${steps.map((x) => (x.panel === null ? '—' : x.panel.toFixed(2))).join(' → ')} (one, two and three touches: ${[1, 2, 3].map((n) => touch(n).toFixed(2)).join(', ')})`,
    one.mints === 1 && steps.every((x, i) => x.panel !== null && Math.abs(x.panel - x.engine) <= 0.011 && Math.abs(x.engine - touch(i + 1)) <= 0.06) && one.engine < two.engine && two.engine < three.engine,
    (one.mints === 1 ? '' : `the first load was not a fresh visitor (${one.mints} identity calls) · `) + steps.map((x, i) => `${i + 1}: engine ${x.engine.toFixed(2)} panel ${x.panel === null ? 'none' : x.panel.toFixed(2)}`).join(' · '));
  // A new tab in the same profile: its first event about C carries her userId, with no new identity call.
  const tab = await openTab(addr(C));
  let firstAction = null;
  for (let i = 0; i < 150 && !firstAction; i += 1) { firstAction = tab.seen.find((x) => x.path === '/realtime/action' && x.body) || null; if (!firstAction) await sleep(100); }
  const tabUser = firstAction ? (() => { try { return JSON.parse(firstAction.body).userId || null; } catch { return null; } })() : null;
  const tabMints = tab.seen.filter((x) => /\/identity\/session$/.test(x.path)).length;
  await tab.close();
  ok('and a new tab in the same profile continues her: its first event carries her userId, with no new identity call', Boolean(tabUser) && tabUser === one.ids[0] && tabMints === 0,
    `${tabUser ? (tabUser === one.ids[0] ? 'the same userId' : 'another userId') : 'no event seen'} · ${tabMints} identity call(s) in the new tab`);
}

// ── Compare (the kit's widget): real pixels on every press ───────────────────
const INK_MIN = 0.05, DIFFER_MIN = 0.01;
const pct = (x) => (x == null ? '?' : `${Math.round(x * 1000) / 10}%`);
const fmtBox = (b) => (b ? `${b.w}×${b.h}` : 'none');
const fmtPx = (px) => (px ? `pixels ${fmtBox(px.before)} · ${fmtBox(px.now)}, ink ${pct(px.before && px.before.ink)} · ${pct(px.now && px.now.ink)}, differ ${pct(px.differ)}` : 'no frames');
const inked = (px, minDiffer = 0) => Boolean(px && px.before && px.now && px.before.ink >= INK_MIN && px.now.ink >= INK_MIN && (!minDiffer || (px.differ !== null && px.differ >= minDiffer)));
const framesUp = "window.__s1.vis('#cmp-canvas').ok";
async function closeOpen() {
  const was = await evaluate("window.__s1.vis('#cmp-back').ok");
  await evaluate("document.getElementById('cmp-close').click()");
  await sleep(300);
  return was && !(await evaluate("window.__s1.vis('#cmp-back').ok"));
}
/** Compare, pressed as the presenter presses it: two frames of real pixels; where the decided state behind them differs, the pixels differ too. */
async function compareOnPress(label) {
  await evaluate("window.scrollTo(0, 0); document.getElementById('compareBtn').click()");
  const up = await waitFor(framesUp, 25000);
  await sleep(400);
  const C = (await snap()).compare;
  const px = await evaluate('window.__s1.framePixels()');
  // Whether the decided state behind the two frames changed, as Compare itself sets it out: its What changed columns, on screen.
  await evaluate("(() => { const b = document.getElementById('cmp-mode-details'); if (b && !b.disabled) b.click(); })()");
  await sleep(300);
  const cols = (await snap()).compare.cols;
  const samePage = Boolean(C.tags.before && C.tags.now) && C.tags.before.split(' · ')[2] === C.tags.now.split(' · ')[2];
  const changed = cols.length === 2 && samePage && !sameJSON(cols[0].lists, cols[1].lists);
  ok(`${label}: Compare opens on two frames of real pixels, tagged Before and Now${changed ? '; What changed shows the decisions moved, and the frames differ' : ''}`,
    up && C.ok && C.mode === 'seam' && inked(px, changed ? DIFFER_MIN : 0) && /^Before · /i.test(C.tags.before) && /^Now · /i.test(C.tags.now),
    `${C.tags.before || C.msg || 'no overlay'} | ${C.tags.now} · ${fmtPx(px)}${cols.length === 2 ? ` · What changed: ${changed ? 'moved' : samePage ? 'the same decisions' : 'two pages'}` : ''}`);
  ok(`${label}: and Compare closes`, await closeOpen());
  return { C, px, cols };
}

const port = await browser.port();
const snaps = {};
const openBeats = [];
let closingAt11 = [];
try {
  await browser.connect(port);
  await browser.prepare();
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: IMG_ERRORS });
  const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(base).hostname);
  console.log(`\nOH DOM rehearsal against ${base} at ${WIDTH}×${HEIGHT} in ${CHROME.split(/[\\/]/).pop()}`);

  shellsBlock: { if (ONLY_STORE) break shellsBlock;
  // ── Every shell at 1440 and 1366: no horizontal overflow, no broken image ──
  console.log('\n── Every shell, at 1440 and 1366');
  const SHELLS = [['the homepage', `${base}/${SLUG}/?debug=1`], ['the TV grid', `${base}/${SLUG}/?view=tvs&debug=1`],
    ...Object.entries(PDP).filter(([, p]) => p).map(([k, p]) => [`the ${k} page (${p.sku})`, `${base}/${SLUG}/product?id=${encodeURIComponent(p.sku)}&debug=1`]),
    ['the laundry grid', `${base}/${SLUG}/?view=laundry&debug=1`], ['the kitchen grid', `${base}/${SLUG}/?view=kitchen&debug=1`], ['the offers grid', `${base}/${SLUG}/?view=offers&debug=1`],
    ['the search page', `${base}/${SLUG}/?q=oled&debug=1`],   // S2: the store's own pages (M1)
    ['the phone', `${base}/${SLUG}/m?debug=1`]];
  for (const [w, h] of SIZES) {
    for (const [name, url] of SHELLS) {
      press = `shell ${w}`;
      const up = await load(url, { width: w, height: h });
      if (/product\?/.test(url)) await waitFor("/decided live|error|failed/i.test(document.getElementById('status').textContent)", 20000);
      await sleep(600);
      await imagesSettled();
      const S = await snap();
      const late = await evaluate('window.__s1.pendingLoad()');
      const lateBroken = [...late.filter((x) => !x.ok).map((x) => `${x.src} (${x.why})`), ...(await imgErrors()).map((x) => `${x} (failed; the page swapped in its name tile)`)];
      ok(`${name} at ${w}: boots, no horizontal overflow, no broken image`, up && /^ready/.test(S.status) && S.overflow <= 1 && S.broken.length === 0 && lateBroken.length === 0,
        `${S.status.slice(0, 60)} · overflow ${S.overflow}px · ${S.images} image(s) on screen${S.broken.length ? ` · broken ${S.broken.slice(0, 3).join(', ')}` : ''}${S.pending ? ` · ${S.pending} lazy below their scroller, each loaded apart: ${lateBroken.length ? `broken ${lateBroken.slice(0, 3).join(', ')}` : 'all load'}` : ''}`);
      if (w === WIDTH && /product\?/.test(url) && name.startsWith('the washer')) await shot('00-washer-page');
    }
  }
  }


  // ── Lane S2: the boot page, before anyone exists (design §9.1, §9.2) ───────
  console.log('\n── The boot page, before anyone exists: the published template, in LG’s look (S2)');
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(400);
  await settled(500, 10000);                       // anything the previous page had in flight has landed
  press = 'boot-store';
  await cdp('Network.clearBrowserCookies');
  await cdp('Storage.clearDataForOrigin', { origin: new URL(base).origin, storageTypes: 'all' });
  await forgetTab();
  await cdp('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  const bootNav = await cdp('Page.navigate', { url: `${base}/${SLUG}/` });
  const upBoot = await booted();
  await evaluate(inPage(pageHelpers));
  await sleep(2500);
  await imagesSettled();
  const BOOT = await evaluate(BOOT_READ);
  ok('the stranger’s /oh/ boots as a store', upBoot && /^ready/.test((await snap()).status), (await snap()).status.slice(0, 120));
  for (const [name] of BOOT_MODULES) {
    const m = BOOT[name];
    ok(`${name}: on screen with real content`, m.ok && BOOT_CLAIMS[name](m), m.ok ? `${m.cards.length ? `${m.cards.length} card(s): ${m.cards.map((c) => c.title || c.cid).join(' | ').slice(0, 140)}` : m.products.length ? `${m.products.length} product(s): ${m.products.slice(0, 3).map((x) => x.text.slice(0, 40)).join(' | ')}` : m.text.slice(0, 140)}` : m.why);
  }
  {
    const slots = [['hero', 'the hero'], ['category-rail', 'the room tiles'], ['deals', 'the deals four']];
    const bad = slots.flatMap(([slot, name]) => BOOT[name].cards.filter((c) => c.decided || !inForceFor(c.cid, slot)).map((c) => `${slot}: ${c.cid}${c.decided ? ' (decided)' : ' (not an opening piece in force for the slot)'}`));
    ok('the decided slots show the published template: the opening catalog’s pieces in force for each slot, none of them decided', slots.every(([, n]) => BOOT[n].cards.length > 0) && bad.length === 0,
      bad.join(' ~ ') || slots.map(([s, n]) => `${s} ${BOOT[n].cards.map((c) => c.cid).join(', ')}`).join(' · ').slice(0, 260));
    const TAKE = Object.fromEntries((((demoConfig.pages || []).find((p) => p.entry === 'home') || {}).slots || []).map((s) => [s.slot, s.take]));
    const order = slots.map(([slot, name]) => { const want = templateOf(slot, TAKE[slot] || 1), got = BOOT[name].cards.map((c) => c.cid).slice(0, want.length); return { slot, want, got, same: sameJSON(want, got) }; });
    ok('in the template’s own order: the catalog’s order, the first of each slot’s take in force, under the slot’s diversity rule', order.every((x) => x.same && x.want.length > 0),
      order.map((x) => `${x.slot} ${x.same ? x.got.join(', ') : `on screen ${x.got.join(', ')} · the template ${x.want.join(', ')}`}`).join(' · ').slice(0, 300));
    S2.boot = { tiles: BOOT['the room tiles'].cards.map((c) => c.cid), deals: BOOT['the deals four'].cards.map((c) => c.cid), rail: BOOT['Recommended for you'].products.map((x) => x.sku), hero: BOOT['the hero'].cards.map((c) => c.cid) };
  }
  await lgLook('the boot page', { full: true });
  {
    // Design §10: the hero slide on screen (the one under the viewport's centre) carries A1's art from /oh/img/art/, loaded,
    // and lg.com's headline panel: a white panel with a curved edge (the slide's ::before, as computed) and dark type on it,
    // the headline on the panel's side of the slide.
    const H = await evaluate(`(() => { const { vis, txt } = window.__s1;
      const slides = [...document.querySelectorAll('#slot-hero .p1-hero')].filter((e) => vis(e).ok);
      const slide = slides.find((e) => { const r = e.getBoundingClientRect(); return r.left <= innerWidth / 2 && r.right >= innerWidth / 2; }) || slides[0];
      if (!slide) return null;
      const r = slide.getBoundingClientRect();
      const img = [...slide.querySelectorAll('.m1-scene--art img')].find((i) => vis(i).ok) || null;
      const ir = img ? img.getBoundingClientRect() : null;
      const pb = getComputedStyle(slide, '::before');
      const h = slide.querySelector('h3'); const hr = h ? h.getBoundingClientRect() : null;
      const lum = (c) => { const m = /rgba?\\(([^)]+)\\)/.exec(c || ''); if (!m) return 1; const [R, G, B] = m[1].split(',').map(Number); return (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255; };
      return { cid: (slide.closest('[data-cid]') || slide).dataset.cid || '', src: img ? new URL(img.currentSrc || img.src, location.href).pathname : '', loaded: Boolean(img && img.complete && img.naturalWidth > 0),
        covers: Boolean(ir && ir.width >= r.width * 0.9 && ir.height >= r.height * 0.9),
        panel: { on: pb.content !== 'none' && pb.content !== 'normal', white: /rgb\\(255, 255, 255\\)/.test(\`\${pb.backgroundImage} \${pb.backgroundColor}\`), radius: pb.borderTopRightRadius },
        head: h ? { text: txt(h), shown: vis(h).ok, color: getComputedStyle(h).color, dark: lum(getComputedStyle(h).color) < 0.25, left: Boolean(hr && hr.left >= r.left - 1 && hr.right <= r.left + r.width * 0.55) } : null };
    })()`);
    ok('the hero slide carries A1’s art from /oh/img/art/, loaded and filling the slide', Boolean(H && H.src.startsWith('/oh/img/art/') && H.loaded && H.covers), H ? `${H.cid} · ${H.src || 'no art image'}${H.loaded ? '' : ' (not loaded)'}` : 'no hero slide on screen');
    ok('and lg.com’s headline panel: a white panel with a curved edge, the headline dark on it, on the panel’s side', Boolean(H && H.panel.on && H.panel.white && H.panel.radius && H.panel.radius !== '0px' && H.head && H.head.shown && H.head.dark && H.head.left),
      H ? `panel ${H.panel.on ? 'on' : 'none'}, ${H.panel.white ? 'white' : 'not white'}, radius ${H.panel.radius} · “${H.head ? H.head.text.slice(0, 50) : ''}” ${H.head ? H.head.color : ''}` : 'no hero slide');
    // Design §10: "Discover OH. deals" is a bento of picture tiles with headlines over them: every tile an art image from
    // /oh/img/art/ covering the tile, loaded, its headline drawn inside the tile, the tiles of more than one size.
    const D = await evaluate(`(() => { const { vis, txt } = window.__s1;
      return [...document.querySelectorAll('#slot-deals .p1-deal')].filter((d) => vis(d).ok).map((d) => {
        const tile = d.querySelector('.p1-deal-tile'); const tr = tile ? tile.getBoundingClientRect() : null;
        const img = tile ? [...tile.querySelectorAll('.m1-scene--art img')].find((i) => vis(i).ok) || null : null; const ir = img ? img.getBoundingClientRect() : null;
        const h = tile ? tile.querySelector('h3') : null; const hr = h && vis(h).ok ? h.getBoundingClientRect() : null;
        return { cid: d.dataset.cid || '', w: tr ? Math.round(tr.width) : 0, h: tr ? Math.round(tr.height) : 0, src: img ? new URL(img.currentSrc || img.src, location.href).pathname : '',
          loaded: Boolean(img && img.complete && img.naturalWidth > 0), covers: Boolean(ir && tr && ir.width >= tr.width * 0.95 && ir.height >= tr.height * 0.95),
          head: h ? txt(h) : '', over: Boolean(hr && tr && hr.left >= tr.left - 1 && hr.right <= tr.right + 1 && hr.top >= tr.top - 1 && hr.bottom <= tr.bottom + 1) };
      });
    })()`);
    const bad = D.filter((t) => !(t.src.startsWith('/oh/img/art/') && t.loaded && t.covers && t.head && t.over));
    const sizes = new Set(D.map((t) => `${Math.round(t.w / 20)}x${Math.round(t.h / 20)}`));
    ok(`the deals bento’s ${D.length} tiles are pictures with headlines over them: A1’s art filling each tile, its headline drawn inside it, the tiles of more than one size`, D.length === 4 && bad.length === 0 && sizes.size > 1,
      bad.map((t) => `${t.cid}: ${t.src || 'no art image'}${t.loaded ? '' : ' unloaded'}${t.covers ? '' : ' not filling'}${t.over ? '' : ' headline outside'}`).join(' ~ ') || D.map((t) => `${t.cid} ${t.w}×${t.h}`).join(' · '));
  }
  {
    const H = (await storeNow()).header;
    ok('the header on the page colour, #F0ECE4, with the category nav, the search box, Sign in and the cart with its count', H.ok && H.bg === rgb('#F0ECE4') && (await storeNow()).cartCount.length > 0
      && await evaluate("Boolean(document.querySelector('#site .site-header form[data-store-search] input[name=\"q\"]')) && window.__s1.vis('#site .site-header [data-act=\"store-cart-open\"]').ok"), `${H.bg} · ${H.h}px · cart ${(await storeNow()).cartCount.join(',') || 'no count'}`);
    ok('the service strip sits on lg.com’s service band, #E6E1D8', BOOT['the service strip'].bg === rgb('#E6E1D8'), BOOT['the service strip'].bg || 'not on screen');
    const D = await SITE_TOOLS();
    ok('the director is a presenter’s tool: on a stranger’s load it is collapsed to its slim rail, the machine panel put away', D.collapsed && D.rail && !D.machine, `collapsed ${D.collapsed} · rail ${D.rail} · machine ${D.machine} · the site ${D.site} of ${D.vw}px`);
  }
  {
    const calls = [...requests.entries()].filter(([id]) => LOADER.get(id) === bootNav.loaderId).map(([, r]) => r);   // this page's own load (M3: a previous page's call in flight is not a mint)
    ok(`the only API call the boot page makes on load is the cold-start region lookup (${calls.length})`, calls.every((r) => r.path === `${API}/coldstart`),
      calls.map((r) => `${r.method} ${r.path}`).join(' ~ ') || 'none');
    const minted = calls.filter((r) => /\/identity\/|\/session\/preferences$/.test(r.path) || ['/realtime/action', '/sort'].includes(r.path) || /\/decisions\/snapshot/.test(r.path));
    ok('no visitor is minted on load: before the first click the wire holds no session, no consent, no event, no decision and no /sort', minted.length === 0,
      minted.map((r) => `${r.method} ${r.path}`).join(' ~ ') || `${calls.length} API call(s) on load: ${[...new Set(calls.map((r) => r.path))].join(', ') || 'none'}`);
  }
  await pageAtBoth('the boot page');
  await shot('S2-00-boot-store');
  // The manual session: the same boot page, reloaded with the debug hook (window.__oh) and the director kept collapsed (?present=0).
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(300);
  await settled(500, 8000);
  await cdp('Storage.clearDataForOrigin', { origin: new URL(base).origin, storageTypes: 'all' });
  await forgetTab();
  await cdp('Page.navigate', { url: `${base}/${SLUG}/?debug=1&present=0` });
  await booted();
  await evaluate(inPage(pageHelpers));
  await sleep(1500);
  await imagesSettled();
  await manualSession();
  await persistenceWalk().catch((error) => checks.fail(`one visitor across full page loads: the walk threw: ${error.message}`));
  await signalsWalk().catch((error) => checks.fail(`her signals, by hand: the walk threw: ${error.message}`));
  await phoneWidth().catch((error) => checks.fail(`at phone width, the checks threw: ${error.message}`));

  walkBlock: { if (ONLY_STORE) { info('--only store: the walk is not run'); break walkBlock; }
  // ── The walk ───────────────────────────────────────────────────────────────
  const url = `${base}/${SLUG}/?debug=1`;
  console.log(`\n── The page loads: ${url}`);
  // The walk starts from a cleared profile: the store part's visitor is kept in this browser (M3) and would be resumed.
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(300);
  await settled(500, 8000);
  await cdp('Network.clearBrowserCookies');
  await cdp('Storage.clearDataForOrigin', { origin: new URL(base).origin, storageTypes: 'all' });
  await forgetTab();
  await cdp('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  press = 'boot';
  const up = await load(url);
  const boot = await snap();
  ok('the page boots on the kit, and every template in beats.json resolves against the facts', up && /^ready/.test(boot.status), boot.status.slice(0, 160));
  ok(`the director hook is exposed under ?debug=1 (window.${HOOK})`, await evaluate(`typeof (window.${HOOK} || {}).go === "function"`));
  const total = await evaluate(`window.${HOOK}.beats().length`);
  ok('the director lists the 16 beats of beats.json', total === 16 && total === beatsDoc.beats.length, `${total}`);
  ok('the palette is the token sheet\'s: --brand is #A50034', boot.brand.toUpperCase() === '#A50034', boot.brand);
  ok('the wordmark “OH.” is on screen in the brand colour', boot.wordmark.ok && boot.wordmark.text === 'OH.' && boot.wordmark.color === rgb('#A50034'), `${boot.wordmark.text} · ${boot.wordmark.color}`);
  ok('the machine panel and the director bar are on screen', boot.machine && boot.director);
  ok('before anyone arrives, nothing on the page is decided', boot.slots.every((s) => s.cards.every((c) => !c.decided)), boot.slots.map((s) => `${s.slot} ${s.cards.length}`).join(' · '));
  ok('the director\'s opening sentence is on screen', boot.lineOk && boot.line.length > 10, boot.line.slice(0, 90));
  {
    // R4 F5 and F8 (S2): what the page says about itself is true. The Roadmap tab marks nothing the walk uses as designed,
    // and the legal line names the date of the prices on screen (the overlay's when it changes any price, else the feed's).
    const R = await evaluate(`(() => ({ road: [...document.querySelectorAll('#roadmap li')].map((li) => ({ status: ((li.querySelector('.dialflag') || {}).textContent || '').trim(), name: ((li.querySelector('b') || {}).textContent || '').trim(), text: li.textContent.replace(/\\s+/g, ' ') })),
      legal: [...document.querySelectorAll('#footLegal, .foot-legal')].filter((x) => window.__s1.vis(x).ok).map((x) => window.__s1.txt(x)).join(' ') }))()`);
    const USED = [['complements', /\bcomplements\b/i], ['the two named outcomes', /partner_pickup|retailer_referral/i], ['the regional prior on /sort', /regional prior on \/sort/i]];
    const wrong = R.road.filter((x) => /designed/i.test(x.status) && USED.some(([, re]) => re.test(x.name)));
    ok('the Roadmap tab marks none of what the walk uses as designed: complements, the two named outcomes, the regional prior on /sort', R.road.length > 0 && wrong.length === 0,
      wrong.map((x) => `“${x.name}” ${x.status}`).join(' ~ ') || `${R.road.length} items · ${USED.map(([n, re]) => `${n}: ${(R.road.find((x) => re.test(x.name)) || { status: 'not listed' }).status}`).join(' · ')}`);
    ok('and it names the companions’ gate as the walk sends it (ctx.family), not “ctx.anchor until complements lands”', !R.road.some((x) => /ctx\.anchor until complements lands/i.test(x.text)),
      (R.road.find((x) => /ctx\.anchor/i.test(x.text)) || { text: 'no gate named' }).text.slice(0, 160));
    const pd = priceDate();
    await waitFor(`/(?<!\\d)${longDate(pd.iso)}/.test([...document.querySelectorAll('#footLegal')].map((x) => x.textContent).join(' '))`, 8000);
    R.legal = await evaluate("[...document.querySelectorAll('#footLegal, .foot-legal')].filter((x) => window.__s1.vis(x).ok).map((x) => window.__s1.txt(x)).join(' ')");
    ok(`the legal line names the date of the prices on screen: ${longDate(pd.iso)}`, namesDate(R.legal, pd.iso),
      `${pd.changed} rows priced by specs.json (${pd.over}) over the feed (${pd.feed}) · “${(/as listed[^;.]*/.exec(R.legal) || [R.legal.slice(0, 90)])[0]}”`);
  }
  {
    // Compare before any frame exists: the message, never nothing (the kit's rule), and the message closes.
    await evaluate("document.getElementById('compareBtn').click()");
    await waitFor("window.__s1.vis('#cmp-back').ok", 10000);
    const M0 = (await snap()).compare;
    ok('Compare before any frame exists opens on the message, not nothing', M0.ok && /^No earlier frame yet/.test(M0.msg) && !M0.frames.before && !M0.frames.now, M0.msg);
    ok('and that message closes', M0.ok && await closeOpen());
  }
  await shot('00-boot');

  const OUTCOMES = {
    arrive: async (S, i) => {
      for (const s of S.slots) {
        if (s.gated) ok(`${s.slot} is gated and stays off the page for a stranger`, !s.shown, s.shown ? `${s.cards.length} card(s) shown` : 'not shown');
        else ok(`${s.slot} shows what the engine decided, on screen`, s.shown && s.cards.length > 0 && s.cards.every((c) => c.decided), s.cards.map((c) => c.title).join(' | ').slice(0, 200));
      }
      const deals = S.slots.find((s) => s.slot === 'deals');
      ok('the arrival four are on screen', Boolean(deals) && deals.cards.length === 4, deals ? deals.cards.map((c) => c.cid).join(', ') : 'no deals');
      const own = await evaluate(`(() => { const s = window.${HOOK}.state; return s && s.own ? { key: s.own.key || null, label: s.own.label || null } : null; })()`);
      // The kit's panel copy (public/demo-kit/panels.js) is going gender neutral (lane C3): “the edge located her” or “… the visitor”.
      const fromRequest = has(S.cold.text, 'from the request') && (LOOPBACK ? has(S.cold.text, 'local runtime') : (has(S.cold.text, 'the edge located her') || has(S.cold.text, 'the edge located the visitor')));
      const none = has(S.cold.text, 'no region on this request');
      ok(`the Arrival panel says the region comes from the request${LOOPBACK ? ' (locally: as the runtime fills request.cf, not an edge)' : ''}, or that there is none`,
        S.cold.ok && (fromRequest || none) && !has(S.cold.text, 'asserted, not observed'), S.cold.text.slice(0, 200));
      if (own && own.key) {
        const cs = await coldstart(null);
        ok(`and it names the request’s own region, ${own.label || own.key}, as the engine reads it`, Boolean(cs && cs.region && cs.region.key === own.key) && has(S.cold.text, own.label || own.key),
          `${own.key} · the engine ${cs && cs.region ? cs.region.key : 'none'}`);
        ok('the regional lean is labelled on screen: synthetic → warehouse', has(S.cold.text, 'synthetic → warehouse'), S.cold.text.slice(0, 160));
      }
      ok('the Arrival panel shows the census as shown, never scored', has(S.cold.text, 'never scored'));
      {
        // The ruling of 730eaa3 (S2): the lean is the brand's fixed seeded sales, labelled synthetic: no census term shaped it.
        const cs = await coldstart(null);
        const label = String((((cs || {}).lean || {}).seeded || {}).label || '');
        ok('and its lean carries no census term: the brand’s seeded sales, not a mix tilted by census income', !/tilted by census|census income|mix tilted/i.test(S.cold.text)
          && Boolean(label) && !/census|income/i.test(label.replace(/\(no census\)/i, '')), label || S.cold.text.slice(0, 120));
        ok('and none of the lean the panel shows is a price tier', Boolean(cs && cs.lean) && !Object.keys(cs.lean.leaders || {}).includes('priceTier') && !Object.keys(cs.lean.share || {}).includes('priceTier'),
          cs && cs.lean ? `leaders ${JSON.stringify(cs.lean.leaders)}` : 'no lean');
      }
      const asked = [...requests.values()].filter((r) => r.press === i && /\/decisions\/snapshot/.test(r.path));
      ok('no snapshot of beat 1 asserted a region', asked.length > 0 && asked.every((r) => !/[?&]ctx\.region=/.test(r.url)), `${asked.length} snapshot(s)`);
      {
        // Lane P1's checks for this beat (P1 wrote them; S1 runs them after its own, in the beat's order).
        const R = await p1Read();
        const cs = await coldstart(null);
        const name = cs && cs.census ? cs.census.label : null, l = cs && cs.lean && cs.lean.inForce ? cs.lean.leaders : null;
        ok(`the arrival line names her real place, from the request: ${name || 'none'}`, Boolean(name) && has(R.arrival, `${name}, from the request`) && !has(R.arrival, 'asserted'), R.arrival.slice(0, 160));
        if (l) ok(`and the brand’s sales there, on the panel’s own leaders (${l.type}, ${l.sizeBand}), with the census shown, not scored, labelled synthetic → warehouse`,
          has(R.arrival, 'your sales here lean') && has(R.arrival, l.sizeBand.split('-')[0]) && has(R.arrival, 'census shown, not scored') && has(R.arrival, 'synthetic → warehouse'), R.arrival.slice(0, 200));
        ok(`Recommended for you says the lean in the answer’s own words: “leans with ${name}’s sales · synthetic → warehouse”`, Boolean(name) && R.lean.forYou === `leans with ${name}’s sales · synthetic → warehouse`, R.lean.forYou || 'no lean line');
      }
    },
    contrast: async (S, i) => {
      ok('the region is asserted on the request and labelled so, in the context chips and on the Arrival panel', has(S.ctx, 'asserted') && has(S.cold.text, 'asserted'),
        `${S.ctx} · ${S.cold.text.slice(0, 120)}`);
      const asked = [...requests.values()].filter((r) => r.press === i && /\/decisions\/snapshot/.test(r.path));
      const region = asked.length ? new URL(asked[asked.length - 1].url).searchParams.get('ctx.region') : null;
      ok('the homepage was asked again with the asserted region', asked.length > 0 && asked.every((r) => /[?&]ctx\.region=US-[A-Z]{2}/.test(r.url)), `${asked.length} snapshot(s) · ${region}`);
      ok('every decided slot still shows what the engine decided', S.slots.filter((s) => !s.gated).every((s) => s.shown && s.cards.length > 0));
      const ownKey = await evaluate(`(() => { const s = window.${HOOK}.state; return s && s.own ? s.own.key : null; })()`);
      const [a, b] = await Promise.all([coldstart(null), coldstart(region)]);
      if (a && b && a.lean && b.lean && JSON.stringify(a.lean.leaders) !== JSON.stringify(b.lean.leaders) && snaps[0]) {
        const moved = ['category-rail', 'deals'].filter((slot) => {
          const was = (snaps[0].slots.find((s) => s.slot === slot) || { cards: [] }).cards.map((c) => c.cid);
          const now = (S.slots.find((s) => s.slot === slot) || { cards: [] }).cards.map((c) => c.cid);
          return !sameJSON(was, now);
        });
        for (const rail of ['for-you']) {
          const was = ((snaps[0].railsOn || []).find((x) => x.rail === rail) || { cards: [] }).cards.map((c) => c.sku);
          const now = (S.railsOn.find((x) => x.rail === rail) || { cards: [] }).cards.map((c) => c.sku);
          if (was.length && now.length && !sameJSON(was, now)) moved.push(`the ${rail} rail`);
        }
        ok(`${region}’s sales lean the page another way than ${ownKey}’s, on screen: the room tiles, the four or the rail across rooms`, moved.length > 0, moved.join(' and ') || 'nothing moved');
        const rail = S.railsOn.find((x) => x.rail === 'for-you');
        ok(`and the rail says so, labelled: “leans with ${(b.census || {}).label || region}’s sales (asserted) · synthetic → warehouse”`, Boolean(rail) && rail.lean === `leans with ${(b.census || {}).label || region}’s sales (asserted) · synthetic → warehouse`, rail ? rail.lean || 'no lean line' : 'no rail');
      } else info(`the two regions’ leaders are the same (${ownKey} and ${region}): no difference on screen is claimed`);
      {
        // Lane P1's checks for this beat (P1 wrote them; S1 runs them after its own, in the beat's order).
        const R = await p1Read();
        const asked = [...requests.values()].filter((r) => r.press === i && /\/decisions\/snapshot/.test(r.path));
        const region = asked.length ? new URL(asked[asked.length - 1].url).searchParams.get('ctx.region') : null;
        const cs = region ? await coldstart(region) : null;
        const name = cs && cs.census ? cs.census.label : region;
        ok(`the arrival line says ${name} is asserted, not observed`, has(R.arrival, `${name}, asserted, not observed`), R.arrival.slice(0, 160));
        ok(`and the rail’s label says it too: “leans with ${name}’s sales (asserted) · synthetic → warehouse”`, R.lean.forYou === `leans with ${name}’s sales (asserted) · synthetic → warehouse`, R.lean.forYou || 'no lean line');
      }
    },
    // ── Act 2: two rooms, and the fresh visitor beside her (lane P1) ──
    'two-rooms': async (S, i) => {
      const asked = [...requests.values()].filter((r) => r.press === i && /\/decisions\/snapshot/.test(r.path));
      ok('back in her own region: no snapshot of this press asserted one, and the chips say so', asked.length > 0 && asked.every((r) => !/[?&]ctx\.region=/.test(r.url))
        && !/region US-[A-Z]{2} · asserted/i.test(S.ctx), `${asked.length} snapshot(s) · ${S.ctx.slice(0, 80)}`);
      ok('the homepage is on screen', S.view === 'home', S.view);
      const vec = await evaluate(`(window.${HOOK}.state && window.${HOOK}.state.lastVector) || {}`);
      const dimA = (dim, v) => Number(((vec[dim] || {})[v]) || 0);
      ok('room and type rise on her own meters: the living room, the laundry room and a front-load, in her profile as the meters read it', dimA('room', 'living-room') > 0 && dimA('room', 'laundry-room') > 0 && dimA('type', 'front-load') > 0,
        `living-room ${dimA('room', 'living-room').toFixed(2)} · laundry-room ${dimA('room', 'laundry-room').toFixed(2)} · front-load ${dimA('type', 'front-load').toFixed(2)} · on the panel: ${S.meters.map((m) => m.value).join(', ')}`);
      const tiles = (S.slots.find((s) => s.slot === 'category-rail') || { cards: [] }).cards.map((c) => c.cid);
      const roomOfTile = (cid) => (((openCatalog.pieces || []).find((p) => p.customerContentId === cid) || {}).tags || {}).room || [];
      const before = (snaps[i - 1] && (snaps[i - 1].slots.find((s) => s.slot === 'category-rail') || { cards: [] }).cards.map((c) => c.cid)) || [];
      ok('the room tiles reorder on her rooms: every tile on screen is the living room’s or the laundry room’s, and they moved', tiles.length > 0
        && tiles.every((cid) => roomOfTile(cid).some((r) => ['living-room', 'laundry-room'].includes(r))) && !sameJSON(tiles, before), `${before.join(', ')} → ${tiles.join(', ')}`);
      const forYou = S.railsOn.find((r) => r.rail === 'for-you');
      const rooms = new Set((forYou ? forYou.cards : []).map((c) => (row(c.sku) || { attributes: {} }).attributes.room));
      ok('Recommended for you keeps both rooms instead of swapping wholesale', Boolean(forYou && forYou.shown) && rooms.has('living-room') && rooms.has('laundry-room'), [...rooms].join(', '));
      ok('each of its cards says what placed it: its rank and the site’s position, by POST /sort', Boolean(forYou) && forYou.cards.length > 0 && forYou.cards.every((c) => /rank \d+ · (?:site|its room’s pick) \d+/.test(c.rank)) && has(forYou.chip, 'POST /sort'),
        forYou ? `${forYou.chip.slice(0, 60)} · ${forYou.cards.slice(0, 2).map((c) => c.rank).join(' | ').slice(0, 120)}` : '');
      const cs = await coldstart(null);
      const name = cs && cs.census ? cs.census.label : null;
      ok(`and it says the lean it carries, labelled: “leans with ${name}’s sales · synthetic → warehouse”`, Boolean(forYou && name) && forYou.lean === `leans with ${name}’s sales · synthetic → warehouse`, forYou ? forYou.lean || 'no lean line' : '');
      await railsInSortOrder(S, i);
      {
        // Lane P1's checks for this beat (P1 wrote them; S1 runs them after its own, in the beat's order).
        const deals = (S.slots.find((s) => s.slot === 'deals') || { cards: [] }).cards.map((c) => c.cid);
        const rooms = deals.map(pieceRoom);
        ok('the deals four hold both rooms on screen, at most two each (the slot’s own rule)', rooms.includes('living-room') && rooms.includes('laundry-room')
          && ['living-room', 'laundry-room', 'kitchen'].every((r) => rooms.filter((x) => x === r).length <= 2), deals.join(', '));
      }
    },
    'fresh-visitor': async (S, i) => {
      const C = S.compare;
      const px = await evaluate('window.__s1.framePixels()');
      ok('Compare → Fresh visitor opens on two frames of real pixels, tagged “The shopper’s page” (or “Her page”) and “A fresh visitor, same region”', C.ok && C.mode === 'seam' && /^(Her|The shopper’s) page · /i.test(C.tags.before)
        && /^A fresh visitor, same region · /i.test(C.tags.now) && inked(px), `${C.tags.before || C.msg} | ${C.tags.now} · ${fmtPx(px)}`);
      await evaluate("(() => { const b = document.getElementById('cmp-mode-details'); if (b && !b.disabled) b.click(); })()");
      await sleep(300);
      const cols = (await snap()).compare.cols;
      ok('What changed sets the two answers side by side, and hers differs from the stranger’s: what her visit earned', cols.length === 2 && !sameJSON(cols[0].lists, cols[1].lists),
        cols.map((c) => `${c.head}: ${(c.lists[2] || c.lists[0] || []).slice(0, 4).join(' | ')}`).join(' ~ ').slice(0, 260));
      const cap = await herCap();
      const others = [...requests.values()].filter((r) => r.press === i && r.path === '/realtime/action' && header(r, 'X-Shopper-Session') !== cap);
      ok('the fresh visitor sent nothing: no event under any capability but hers on this press', others.length === 0, `${others.length} event(s)`);
      ok('the Compare panel closes', await closeOpen());
      await sleep(400);
      const after = await snap();
      const was = snaps[i - 1];
      const mine = (x) => ({ view: x.view, slots: x.slots.map((s) => [s.slot, s.cards.map((c) => c.cid)]), rails: x.railsOn.map((r) => [r.rail, r.cards.map((c) => c.sku)]), address: x.address });
      const moved = Object.keys(mine(after)).filter((k) => !sameJSON(mine(after)[k], mine(was)[k]));
      ok('after it closes her homepage is hers: the hero, the tiles, the four, the rails and the address', moved.length === 0, moved.map((k) => `${k} changed`).join(', ') || after.address);
      ok('and the page’s current visitor is still her', (await herCap()) === cap && Boolean(cap));
      snaps[i] = after;
      {
        // Lane P1's checks for this beat (P1 wrote them; S1 runs them after its own, in the beat's order).
        // The TV grid, as she would open it from the header: its lean label, then her declared space hiding what the data says is wider.
        await evaluate(`window.${HOOK}.performClick('#mainnav [data-ctl="nav-tvs"]')`);
        await waitFor("window.__s1.vis('#rail-tv-grid .pcard').ok", 15000);
        await sleep(600);
        const cs = await coldstart(null);
        const name = cs && cs.census ? cs.census.label : null;
        let R = await p1Read();
        ok(`the TV grid says the lean it carries: “leans with ${name}’s sales · synthetic → warehouse”, and shows 24 TVs`, R.lean.grid === `leans with ${name}’s sales · synthetic → warehouse` && R.grid.length === 24,
          `${R.lean.grid || 'no lean line'} · ${R.grid.length} on screen`);
        const width = 58;
        const tvs = rowsAll.filter((p) => p.attributes && p.attributes.category === 'tvs' && Number(p.salePrice) > 0);
        const wider = tvs.filter((p) => p1Width(p) !== null && p1Width(p) > width).length;
        const unknown = tvs.filter((p) => p1Width(p) === null).length;
        await evaluate(`window.${HOOK}.performClick('#p1Fit [data-ctl="fit-${width}"]')`);
        await sleep(1500);
        R = await p1Read();
        ok(`her declared space (${width} in) hides exactly the TVs the data says are wider: “Hidden: ${wider} wider than your space”, ${unknown} unmeasured kept, labelled declared`,
          has(R.fitNote, `Hidden: ${wider} wider than your space`) && has(R.fitNote, 'declared by you, never inferred') && (unknown === 0 || has(R.fitNote, `${unknown} without a listed width are kept`)), R.fitNote.slice(0, 200));
        ok('and no TV on screen is wider than her space', R.grid.every((sku) => { const w = p1Width(row(sku)); return w === null || w <= width; }), R.grid.filter((sku) => p1Width(row(sku)) > width).join(', ') || `${R.grid.length} on screen`);
        await evaluate(`window.${HOOK}.performClick('#p1Fit [data-ctl="fit-clear"]')`);
        await sleep(800);
        await evaluate(`window.${HOOK}.performClick('.mast a[data-ctl="home"]')`);
        await waitFor("window.__s1.snapshot().view === 'home'", 15000);
        await sleep(800);
      }
    },

    // ── The product pages (lane P2) ──
    'washer-page': async (S, i) => {
      const p = row(WALK.washer);
      productOnScreen(S, p);
      // R4 F7 (S2): the set-price card belongs on the page only when one of her washer's sets costs less than its pieces.
      const sets = setsOf(p), lower = sets.some((x) => x.lower);
      const want = ['mod-laundry-dryer', 'mod-laundry-pedestal', 'mod-laundry-stacking', ...(lower ? ['mod-laundry-pair-price'] : [])];
      const cards = want.map((id) => S.modules.find((m) => m.cid === id));
      ok(`below it the room completes, on screen: the dryer, the pedestal, the stacking kit${lower ? ' and the set price' : ''}`, cards.every(Boolean), S.modules.map((m) => m.cid).join(', '));
      ok(lower ? `the set-price card shows, since a set of ${p.sku}’s costs less than its pieces` : `the set-price card is absent: none of ${p.sku}’s sets costs less than its pieces (${sets.length} sets, the feed’s own figures)`,
        lower ? S.modules.some((m) => m.cid === 'mod-laundry-pair-price') : !S.modules.some((m) => m.cid === 'mod-laundry-pair-price'),
        sets.map((x) => `${x.sku.split('_').slice(1, 2).join('')} set $${x.set} · apart $${x.apart}`).join(' · ').slice(0, 220));
      ok(`each card’s receipt line reads “Completes what was committed to: ${p.sku}”`, cards.every((m) => m && completesIn(m.receipt, p.sku)),
        cards.map((m) => (m ? `${m.cid}: ${m.receipt.slice(0, 90)}` : 'missing')).join(' ~ ').slice(0, 300));
      ok('and states its rule as the merchandiser’s: “Our merchandiser’s rule”', cards.every((m) => m && has(m.rule, 'Our merchandiser’s rule')), cards.map((m) => (m ? m.rule.slice(0, 60) : 'missing')).join(' ~ '));
      const region = await evaluate(`(() => { const s = window.${HOOK}.state; return (s.ctx && s.ctx.region) || (s.own && s.own.key) || null; })()`);
      const asserted = await evaluate(`Boolean((window.${HOOK}.state.ctx || {}).region)`);
      const cs = await coldstart(asserted ? region : null);
      const fuel = cs && cs.lean && cs.lean.leaders ? cs.lean.leaders.fuel : null;
      const dryer = cards[0];
      // The dryer's fuel line is P2's fair check below: the lead names what POST /sort put first, and the region's lean beside it.
      const name = (cs && cs.census && cs.census.label) || region;
      ok(`the lists say their order and its lean, labelled: “in POST /sort’s order · leans with ${name}’s sales${asserted ? ' (asserted)' : ''} · synthetic → warehouse”`,
        Boolean(dryer) && has(dryer.same, `in POST /sort’s order · leans with ${name}’s sales${asserted ? ' (asserted)' : ''} · synthetic → warehouse`), dryer ? dryer.same.slice(0, 140) : 'no dryer card');
      await inSortOrder(`the products in each module`, S, i);
      {
        // Lane P2's checks for this beat (P2 wrote them; S1 runs them after its own, in the beat's order).
        const D = await data(), p = D.row(D.walk.washer), R = await read();
        ok(`the washer page is on screen: ${p.sku}`, R.view === 'product' && R.id === p.sku, `${R.view} ${R.id}`);
        buyBoxOffLimits(R, p);
        const asked = snapshotsOf(i).filter((q) => q.get('page') === 'product');
        ok(`it was decided with ctx.anchor = ${p.sku} and ctx.family = ${p.family}, through the kit’s context hook`, asked.length > 0 && asked.every((q) => q.get('ctx.anchor') === p.sku && q.get('ctx.family') === p.family),
          asked.map((q) => `anchor ${q.get('ctx.anchor')} family ${q.get('ctx.family')}`).join(' · '));
        const want = ['mod-laundry-dryer', 'mod-laundry-pedestal', 'mod-laundry-stacking', ...(setsOf(p).some((x) => x.lower) ? ['mod-laundry-pair-price'] : [])];   // R4 F7 (S2)
        ok(`the dryer, the pedestal, the stacking kit${want.length === 4 ? ' and the set price' : ''} are on screen, each decided, each receipt reading “Completes what was committed to: ${p.sku}”`,
          want.every((cid) => completes(mod(R, cid), p.sku)), want.map((cid) => `${cid} ${mod(R, cid) ? (completes(mod(R, cid), p.sku) ? 'completes' : 'no completes line') : 'absent'}`).join(' · '));
        ok('each states its rule as our merchandiser’s, on the card', want.every((cid) => mod(R, cid) && /our merchandiser/i.test(mod(R, cid).rule)), want.filter((cid) => !(mod(R, cid) && /our merchandiser/i.test(mod(R, cid).rule))).join(', ') || 'all four');
        const dryer = mod(R, 'mod-laundry-dryer');
        const sort = await p2InSortOrder('the dryer in her fuel', dryer, i);
        if (sort && dryer && dryer.tiles.length) {
          // Her fuel is the engine's reading: the fuel of what POST /sort put first. The region's lean is said beside it, and
          // where her own browsing outweighs it (the sort's own drivers: sold here, the set she is in), the card says so.
          // R4 F1 (S2, replacing “the lead line names the fuel POST /sort put first”): a fuel is hers only when HER PROFILE
          // carries one. The card's claim is measured against her own reading and against what put the first dryer first on
          // this press's /sort answer (its items' drivers), never against the card's own sentence.
          const first = D.row(dryer.tiles[0]), fuel = first && first.attributes.fuel;
          const shown = S.modules.find((m) => m.cid === 'mod-laundry-dryer') || { title: '', lead: '' };
          const hers = herDim(R.vector, 'fuel'), mine = leading(hers);
          const said = /\bin (her|your) fuel\b/i.test(`${shown.title} ${shown.lead} ${dryer.text}`);
          const named = (/\bin (?:her|your) fuel:?\s*(gas|electric|dual[- ]fuel|induction)/i.exec(`${shown.lead} ${dryer.text}`) || [])[1] || null;
          ok(`the dryer card claims a fuel of hers only when her profile carries one (her fuel: ${mine || 'none'})`, !said || (Boolean(mine) && (!named || named.toLowerCase().replace(' ', '-') === mine)),
            `${said ? `the card says “in her/your fuel”${named ? `: ${named}` : ''}` : 'no fuel claimed'} · her profile fuel ${JSON.stringify(hers)} · ${shown.title.slice(0, 60)}`);
          const sep = separating(sort, dryer.tiles[0], dryer.tiles[1]);
          const words = driverWords(sep);
          if (!mine) ok(`with no fuel of hers, the card names POST /sort’s reason its first dryer leads: ${sep ? `${sep.dim} ${sep.value} (+${sep.gap} over the second)` : 'no driver read'}`,
            Boolean(sep && words) && words.test(`${shown.lead} ${dryer.text}`), `${first ? `${first.sku} (${fuel})` : 'none'} · “${shown.lead.slice(0, 140)}”`);
          else info(`her profile carries a fuel (${mine}); the first dryer leads on ${sep ? `${sep.dim} ${sep.value}` : 'no driver read'}`);
          if (sort.regional) ok('and the order’s lean is labelled: “leans with … · synthetic → warehouse”', /leans with .*synthetic → warehouse/.test(dryer.text), dryer.text.slice(0, 160));
        }
      }
    },
    'top-loader': async (S, i) => {
      const top = row(S.address && new URLSearchParams(S.address.split('?')[1] || '').get('id'));
      ok('the top-loader’s page is on screen, opened from the page’s own type switch', S.view === 'product' && Boolean(top) && top.family === 'top-load-washer', `${S.address} · ${top ? top.family : 'unknown sku'}`);
      ok('the pedestal and the stacking kit are no longer among the decided modules', !S.modules.some((m) => ['mod-laundry-pedestal', 'mod-laundry-stacking'].includes(m.cid)), S.modules.map((m) => m.cid).join(', '));
      const ped = S.gone.find((g) => g.cid === 'mod-laundry-pedestal');
      ok('the pedestal’s card says why, on screen: withdrawn by its own rule, which serves front-load pairs, as this page asserts ctx.family = top-load-washer',
        Boolean(ped) && has(ped.text, 'Withdrawn by its own rule') && has(ped.text, 'ctx.family = top-load-washer') && has(ped.text, 'not decided'), ped ? ped.text.slice(0, 200) : `withdrawn cards: ${S.gone.map((g) => g.cid).join(', ') || 'none'}`);
      const dryer = S.modules.find((m) => m.cid === 'mod-laundry-dryer');
      ok(`the dryer stays, completing the new washer ${top ? top.sku : ''}`, Boolean(dryer && top) && completesIn(dryer.receipt, top.sku), dryer ? dryer.receipt.slice(0, 100) : 'no dryer card');
      const strip = S.strips.find((x) => x.module === 'pdp-modules' || /pdp-modules/.test(x.module));
      ok('and the before/now strip names what left and why', Boolean(strip) && strip.rows.some((r) => has(r, 'pedestal') && has(r, 'withdrawn')), strip ? strip.rows.slice(0, 3).join(' · ').slice(0, 200) : 'no strip');
      {
        // Lane P2's checks for this beat (P2 wrote them; S1 runs them after its own, in the beat's order).
        const D = await data(), R = await read(), p = D.row(R.id), washer = D.row(D.walk.washer);
        ok(`the type switch opened a top-loader at the washer’s tier: ${R.id}`, Boolean(p) && p.family === 'top-load-washer' && p.attributes.priceTier === washer.attributes.priceTier, p ? `${p.sku} ${p.attributes.priceTier}` : R.id);
        const ped = R.gone.find((g) => g.cid === 'mod-laundry-pedestal');
        const note = String(((p && p.companions) || {}).pedestalsNote || '');
        ok('the pedestal is withdrawn on screen, and its card says why in the feed’s own words, with the rule that withdrew it', Boolean(ped) && !ped.decided
          && (!note || has(ped.text, note)) && has(ped.text, `ctx.family = ${p.family}`), ped ? ped.text.slice(0, 200) : `withdrawn: ${R.gone.map((g) => g.cid).join(', ') || 'none'}`);
        ok('and it is not decided here: no pedestal card from the engine', !mod(R, 'mod-laundry-pedestal'), R.mods.map((m) => m.cid).join(', '));
        ok('the before/now strip names the pedestal’s withdrawal by its own rule', R.strip.some((r) => /raise it on a pedestal/i.test(r) && /withdrawn by its own rule/i.test(r)), R.strip.slice(0, 3).join(' ~ ').slice(0, 200));
        ok(`the dryer stays, completing ${p.sku}`, completes(mod(R, 'mod-laundry-dryer'), p.sku));
      }
    },
    'tv-page': async (S, i) => {
      const p = row(WALK.tv);
      productOnScreen(S, p);
      for (const [id, what] of [['mod-tv-soundbar', 'the soundbar for its series'], ['mod-tv-mount', 'the mount for its VESA pattern']]) {
        const m = S.modules.find((x) => x.cid === id);
        ok(`${what} is on screen, its receipt reading “Completes what was committed to: ${p.sku}”`, Boolean(m) && completesIn(m.receipt, p.sku), m ? m.receipt.slice(0, 100) : `${id} not on screen`);
      }
      const mount = S.modules.find((x) => x.cid === 'mod-tv-mount');
      const vesa = p.vesa ? String(p.vesa).replace('x', ' x ') : null;
      ok(`the mount card names the TV’s VESA pattern${vesa ? `, ${vesa} mm` : ''}, and shows a mount`, Boolean(mount && vesa) && has(mount.rule, `${vesa} mm`) && mount.tiles.length > 0, mount ? `${mount.rule.slice(0, 120)} · ${mount.tiles.length} mount(s)` : 'no mount card');
      await inSortOrder('the products in each module', S, i);
      {
        // Lane P2's checks for this beat (P2 wrote them; S1 runs them after its own, in the beat's order).
        const D = await data(), p = D.row(D.walk.tv), R = await read();
        ok(`the TV page is on screen: ${p.sku}`, R.view === 'product' && R.id === p.sku);
        buyBoxOffLimits(R, p);
        ok(`the soundbar for its series and the mount for its VESA pattern are decided, each completing ${p.sku}`, completes(mod(R, 'mod-tv-soundbar'), p.sku) && completes(mod(R, 'mod-tv-mount'), p.sku),
          ['mod-tv-soundbar', 'mod-tv-mount'].map((cid) => `${cid} ${mod(R, cid) ? mod(R, cid).receipt.slice(0, 80) : 'absent'}`).join(' · '));
        const mount = mod(R, 'mod-tv-mount'), rel = ((p.companions || {}).mounts || []).map(String);
        ok(`the mount card shows the mount for ${String(p.vesa || '').replace('x', ' x ')} and names the pattern in its rule`, Boolean(mount) && rel.every((id) => mount.tiles.includes(id)) && has(mount.rule, String(p.vesa || '').replace('x', ' x ')),
          mount ? `${mount.tiles.join(', ')} · ${mount.rule}` : 'absent');
        await p2InSortOrder('the soundbars', mod(R, 'mod-tv-soundbar'), i);
      }
    },
    'range-page': async (S, i) => {
      const p = row(WALK.range);
      productOnScreen(S, p);
      for (const [id, what] of [['mod-range-microwave', 'the over-the-range microwave'], ['mod-range-dishwasher', 'the dishwasher']]) {
        const m = S.modules.find((x) => x.cid === id);
        ok(`${what} is on screen, completing ${p.sku}`, Boolean(m) && completesIn(m.receipt, p.sku), m ? m.receipt.slice(0, 100) : `${id} not on screen`);
      }
      const pkg = S.modules.find((m) => /^Together \$[\d,.]+ · apart \$[\d,.]+ · \$[\d,.]+ less as a package/.test(m.lead));
      const disp = pkg ? (catalog.pieces.find((x) => x.customerContentId === pkg.cid) || {}).display || {} : {};
      ok('a package shows its price beside its pieces apart, and the saving, at the catalog’s own figures', Boolean(pkg) && has(pkg.lead, `Together ${money(disp.price)}`) && has(pkg.lead, `apart ${money(disp.memberSum)}`)
        && has(pkg.lead, `${money(disp.savings)} less`), pkg ? `${pkg.cid}: ${pkg.lead.slice(0, 100)}` : S.modules.map((m) => m.cid).join(', '));
      await inSortOrder('the products in each module', S, i);
      {
        // Lane P2's checks for this beat (P2 wrote them; S1 runs them after its own, in the beat's order).
        const D = await data(), p = D.row(D.walk.range), R = await read();
        ok(`the range page is on screen: ${p.sku}`, R.view === 'product' && R.id === p.sku);
        buyBoxOffLimits(R, p);
        ok(`the over-the-range microwave and the dishwasher are decided, each completing ${p.sku}`, completes(mod(R, 'mod-range-microwave'), p.sku) && completes(mod(R, 'mod-range-dishwasher'), p.sku));
        const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const pkgs = R.mods.filter((m) => { const x = D.display.get(m.cid) || {}; return Number(x.savings) > 0 && Number(x.price) < Number(x.memberSum); });
        const said = pkgs.filter((m) => { const x = D.display.get(m.cid); return m.text.includes(`Together ${money(x.price)}`) && m.text.includes(`apart ${money(x.memberSum)}`) && m.text.includes(`${money(x.savings)} less`); });
        ok('a package that costs less than its pieces is on screen, its price beside its pieces’ sum by the catalog’s own figures', said.length > 0,
          pkgs.map((m) => { const x = D.display.get(m.cid); return `${m.cid} ${x.price} < ${x.memberSum}`; }).join(' · ') || `no cheaper package among ${R.mods.map((m) => m.cid).join(', ')}`);
        await p2InSortOrder('the microwaves', mod(R, 'mod-range-microwave'), i);
      }
    },
    'qned-oled': async (S, i) => {
      const p = row(WALK.qned);
      productOnScreen(S, p);
      const cmp = S.modules.find((m) => m.cid === 'mod-tv-qned-vs-oled');
      ok('the comparison says the honest sentence, verbatim: “For a bright room the QNED is the right choice; for a dark room this OLED is.”',
        Boolean(cmp) && cmp.say === 'For a bright room the QNED is the right choice; for a dark room this OLED is.', cmp ? cmp.say : 'no comparison card');
      ok('with an OLED of the same size beside it, and “The price is the same for everyone”', Boolean(cmp) && cmp.tiles.length >= 2 && cmp.tiles.some((t) => (row(t.sku) || { attributes: {} }).attributes.type === 'oled')
        && has(cmp.same, 'The price is the same for everyone'), cmp ? `${cmp.tiles.map((t) => t.sku).join(' | ')} · ${cmp.same.slice(0, 80)}` : '');
      const size = S.modules.find((m) => m.cid === 'mod-tv-size-up');
      const up = size && size.tiles[0] ? row(size.tiles[0].sku) : null;
      ok(`from ${WALK.distanceFt} ft, declared, the size-up card names one size up: “one size up is the ${up ? up.name : '?'}”`, Boolean(size && up) && has(size.lead, `From ${WALK.distanceFt} ft`)
        && has(size.lead, 'one size up is the') && Number(up.sizeInches) > Number(p.sizeInches), size ? size.lead.slice(0, 160) : 'no size-up card');
      ok('and the card says the distance is declared, by her', Boolean(size) && has(size.text, 'declared'), size ? size.text.slice(0, 160) : 'no size-up card');   // R4 F2 (S2)
      // Her dials moved by her answer are P2's check below, read from her profile (lastVector), not the panel's top eight.
      ok('the buy box says off limits; the price is the catalog’s, the same for everyone', has(S.buyBox.offlimits, 'Off limits') && has(S.buyBox.price, money(p.salePrice)), `${S.buyBox.price.slice(0, 60)} · catalog ${money(p.salePrice)}`);
      const first = S.modules.length ? Math.min(...S.modules.map((m) => m.top)) : null;
      ok('nothing decided sits near the financing line: none inside the buy box, and the first decided module starts below it', S.buyBox.decidedInside === 0 && first !== null && first > S.buyBox.bottom,
        `${S.buyBox.fin ? `financing “${S.buyBox.fin.slice(0, 70)}”` : 'no financing line on this page'} · decided inside ${S.buyBox.decidedInside} · buy box ends ${S.buyBox.bottom}px, first module ${first}px`);
      {
        // Lane P2's checks for this beat (P2 wrote them; S1 runs them after its own, in the beat's order).
        const D = await data(), p = D.row(D.walk.qned), R = await read();
        ok(`the QNED page is on screen: ${p.sku}`, R.view === 'product' && R.id === p.sku);
        buyBoxOffLimits(R, p);
        const cmp = mod(R, 'mod-tv-qned-vs-oled');
        ok('the comparison is decided, with the honest sentence and the same price for everyone',
          Boolean(cmp && cmp.decided) && cmp.text.includes('For a bright room the QNED is the right choice; for a dark room this OLED is.') && /the price is the same for everyone/i.test(cmp.text), cmp ? cmp.text.slice(0, 160) : 'absent');
        const other = cmp && cmp.tiles.map((id) => D.row(id)).find((x) => x && x.sku !== p.sku);
        ok('the OLED beside it is the same size, at its catalog price', Boolean(other) && other.attributes.type === 'oled' && Number(other.sizeInches) === Number(p.sizeInches),
          other ? `${other.sku} ${other.sizeInches}″` : 'no OLED tile');
        const up = mod(R, 'mod-tv-size-up');
        const series = D.rows.filter((x) => x.attributes && x.attributes.series === p.attributes.series && (x.modelYear || null) === (p.modelYear || null) && x.salePrice != null);
        const d = Number(D.walk.distanceFt) * 12;
        const want = series.filter((x) => Number(x.sizeInches) > Number(p.sizeInches) && Number(x.sizeInches) >= d * 0.613 && Number(x.sizeInches) <= d * 0.833).sort((a, b) => Number(a.sizeInches) - Number(b.sizeInches))[0];
        ok(`her distance, ${D.walk.distanceFt} ft, is pressed in the size-up tool, and one size up is ${want ? want.sku : 'none'} by the piece’s own figures`,
          Boolean(up && want) && up.pressed.includes(`size-up-${D.walk.distanceFt}`) && up.tiles.includes(want.sku), up ? `${up.pressed.join(', ')} · ${up.tiles.join(', ')}` : 'absent');
        // R4 F2 (S2, replacing “and it moved her own meters”): her distance is declared context, never a select for a product
        // she did not choose. Read off this press's wire: the distance press, the next ask, and her readings before and after.
        const dist = String(D.walk.distanceFt);
        const reqs = [...requests.entries()].filter(([, r]) => r.press === i);
        const body = (r) => { try { return JSON.parse(r.body); } catch { return null; } };
        const asks = reqs.filter(([, r]) => /\/decisions\/snapshot/.test(r.path)).map(([, r]) => r);
        const withDist = asks.find((r) => new URL(r.url).searchParams.get('ctx.distance') === dist) || null;
        const evts = reqs.filter(([, r]) => r.path === '/realtime/action').map(([, r]) => ({ r, b: body(r) })).filter((x) => x.b);
        const distEvt = evts.find((x) => x.b.data && (x.b.data.control === 'viewing-distance' || x.b.data.distanceFt !== undefined));
        const pressAt = Math.min(withDist ? withDist.at : Infinity, distEvt ? distEvt.r.at : Infinity);
        const choice = want ? evts.find((x) => x.r.at > pressAt && x.b.data && String(x.b.data.productId) === want.sku && (x.b.type === 'product_view' || x.b.data.control !== 'viewing-distance')) : null;
        const selects = evts.filter((x) => x.r.at >= pressAt && (!choice || x.r.at < choice.r.at) && x.b.type === 'custom' && x.b.data && x.b.data.event === 'select' && x.b.data.productId);
        ok(`pressing the viewing distance (${dist} ft) sends no select for any product`, pressAt < Infinity && selects.length === 0,
          pressAt === Infinity ? 'no distance press read on this press’s wire' : selects.map((x) => `select ${x.b.data.productId} (${x.b.data.sizeBand || ''} ${x.b.data.priceTier || ''})`).join(' · ') || 'none');
        ok(`and the next ask carries it as declared context: ctx.distance = ${dist}`, Boolean(withDist), withDist ? new URL(withDist.url).search.slice(0, 160) : `${asks.length} ask(s), none with ctx.distance`);
        const reflexAt = async (pred) => { for (const [id, r] of [...reqs].reverse()) { if (r.path !== '/realtime/reflex' || r.status !== 200 || !pred(r)) continue;
          try { const b = await cdp('Network.getResponseBody', { requestId: id }); const j = JSON.parse(b.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : b.body); return (j.affinity && j.affinity.dims) || {}; } catch { /* evicted */ } } return null; };
        const before = pressAt < Infinity ? await reflexAt((r) => r.at < pressAt) : null;
        const capNow = await herCap();
        const nowRead = capNow ? await (await fetch(`${base}/realtime/reflex`, { headers: { 'X-Tenant': TENANT, 'X-SDK-Key': 'demo-site', 'X-Shopper-Session': capNow } })).json().catch(() => null) : null;
        const after = nowRead && nowRead.affinity ? nowRead.affinity.dims || {} : null;
        const held = (dim) => { const keys = new Set([...Object.keys((before || {})[dim] || {}), ...Object.keys((after || {})[dim] || {})]);
          return [...keys].every((k) => { const x = Number(((before || {})[dim] || {})[k] || 0), y = Number(((after || {})[dim] || {})[k] || 0); return y <= x + Math.max(0.02, x * 0.03); }); };
        const fmtDim = (m, dim) => Object.entries((m || {})[dim] || {}).map(([k, a]) => `${k} ${Number(a).toFixed(2)}`).join(', ') || 'none';
        if (!choice) ok('her size band and price tier readings do not move on a distance: nothing rose until she chooses a size herself', Boolean(before && after) && held('sizeBand') && held('priceTier'),
          before && after ? `size band ${fmtDim(before, 'sizeBand')} → ${fmtDim(after, 'sizeBand')} · price tier ${fmtDim(before, 'priceTier')} → ${fmtDim(after, 'priceTier')}` : 'no reading before the press, or none now');
        else ok(`she chose the suggested ${want.sku} herself, and only then does her size band move: ${want.attributes.sizeBand}`, Boolean(after) && Number(((after.sizeBand || {})[want.attributes.sizeBand]) || 0) > Number((((before || {}).sizeBand || {})[want.attributes.sizeBand]) || 0),
          `size band ${fmtDim(before, 'sizeBand')} → ${fmtDim(after, 'sizeBand')}`);
        const near = R.mods.filter((m) => /affirm|\bapr\b|financ|\/mo\b|per month/i.test(m.text)).map((m) => m.cid);
        ok('nothing decided sits near the financing line: no decided module speaks of financing, and the buy box holds no decision', near.length === 0 && R.buy.decidedInside === 0, near.join(', ') || 'none');
      }
    },
    'closet-width': async (S, i) => {
      const p = row(WALK.washer);
      productOnScreen(S, p);
      const scope = rowsAll.filter((x) => x.family === p.family);
      const wider = scope.filter((x) => { const w = widthOf(x); return w && w > WALK.closet + 1e-9; }).length;
      const fits = scope.length - wider;
      const tool = S.fit.find((t) => has(t, 'hidden:')) || '';
      ok(`the fit tool counts it on screen: “${fits} of ${scope.length} front-load washers fit ${WALK.closet} in · hidden: ${wider} wider than your space”`,
        has(tool, `${fits} of ${scope.length} front-load washers`) && has(tool, `fit ${WALK.closet} in`) && has(tool, `hidden: ${wider} wider than your space`), tool.slice(0, 200) || 'no fit tool on screen');
      ok('and labels her measurement declared, never inferred', has(tool, 'declared, never inferred'));
      const asked = [...requests.values()].filter((r) => r.press === i && /\/decisions\/snapshot/.test(r.path));
      ok(`the next decision asserted it: ctx.fit = ${WALK.closet} on the request`, asked.some((r) => new URL(r.url).searchParams.get('ctx.fit') === String(WALK.closet)), `${asked.length} snapshot(s)`);
      {
        // Lane P2's checks for this beat (P2 wrote them; S1 runs them after its own, in the beat's order).
        const D = await data(), p = D.row(D.walk.washer), R = await read(), width = Number(D.walk.closet);
        ok(`the washer page is on screen again: ${p.sku}`, R.view === 'product' && R.id === p.sku);
        // The count the data supports: the family's widths, the product page's (specs.json) else the feed's fits.
        const widthOf = (x) => { const s = Number(x && x.width); if (Number.isFinite(s) && s > 0) return s; const f = Number(x && x.fits && x.fits.width); return Number.isFinite(f) && f > 0 ? f : null; };
        const scope = D.rows.filter((x) => x.family === p.family);
        const wider = scope.filter((x) => widthOf(x) && widthOf(x) > width + 1e-9).map((x) => x.sku);
        const none = scope.filter((x) => !widthOf(x)).length;
        ok(`her declared width is pressed: ${width} in`, Boolean(R.fit) && R.fit.pressed.includes(`fit-${width}`), R.fit ? R.fit.pressed.join(', ') : 'no fit tool on screen');
        ok(`the page says “hidden: ${wider.length} wider than your space”, the count the data holds for the ${scope.length} ${p.family}s`, Boolean(R.fit) && R.fit.text.includes(`hidden: ${wider.length} wider than your space`)
          && R.fit.text.includes(`${scope.length - wider.length} of ${scope.length}`), R.fit ? R.fit.text.slice(0, 200) : 'no fit tool');
        ok('it names the models that dropped out, and shows none of them', Boolean(R.fit) && wider.every((sku) => R.fit.text.includes(sku) && !R.fit.tiles.includes(sku)), wider.join(', '));
        if (none) ok(`and says so for the ${none} with no dimensions published, rather than hide them`, Boolean(R.fit) && R.fit.text.includes(`${none} with no dimensions published`));
        const asked = snapshotsOf(i).filter((q) => q.get('page') === 'product');
        ok(`the next decision asserted her declared width, ctx.fit = ${width}, beside the anchor and the family`, asked.some((q) => q.get('ctx.fit') === String(width) && q.get('ctx.anchor') === p.sku && q.get('ctx.family') === p.family),
          asked.map((q) => `fit ${q.get('ctx.fit') || '—'}`).join(' · '));
      }
    },
    // ── Act 6: three weeks later (lane P1) ──
    'three-weeks': async (S, i) => {
      const days = beatsDoc.beats.length && /(\d+) days/.exec(JSON.stringify(beatsDoc.beats.find((x) => x.key === 'three-weeks').run)) ? Number(/(\d+) days/.exec(JSON.stringify(beatsDoc.beats.find((x) => x.key === 'three-weeks').run))[1]) : 21;
      const cont = S.slots.find((s) => s.slot === 'continue');
      ok('the continue hero answers her return, on screen', S.view === 'home' && S.cont.shown && Boolean(cont && cont.cards.length === 1), cont ? cont.cards.map((c) => c.cid).join(', ') : 'no continue slot');
      ok('its receipt says the return is asserted for the clock jump, labelled', has(S.cont.receipt, 'ctx.visit = return, asserted for the clock jump (labelled)'), S.cont.receipt.slice(0, 120));
      const asked = [...requests.values()].filter((r) => r.press === i && /\/decisions\/snapshot/.test(r.path) && new URL(r.url).searchParams.get('page') === 'home');
      ok('and the homepage was asked with it: ctx.visit = return on the request', asked.some((r) => new URL(r.url).searchParams.get('ctx.visit') === 'return'), `${asked.length} homepage snapshot(s)`);
      ok(`the clock jump is labelled on screen: “${days} days later · a labelled clock jump”`, has(S.cont.text, `${days} days later · a labelled clock jump`), S.cont.text.slice(0, 120));
      const dial = (room) => { const m = new RegExp(`${room} ([\\d.]+) → ([\\d.]+) \\(−(\\d+)%\\)`).exec(S.cont.text); return m ? { b: Number(m[1]), a: Number(m[2]), fall: Number(m[3]) } : null; };
      const tv = dial('living room'), laundry = dial('laundry room');
      ok('her room dials, before and after, are on screen: the living room and the laundry room, each lower three weeks on', Boolean(tv && laundry) && tv.a < tv.b && laundry.a < laundry.b,
        tv && laundry ? `living room ${tv.b} → ${tv.a} (−${tv.fall}%) · laundry room ${laundry.b} → ${laundry.a} (−${laundry.fall}%)` : 'no dials read');
      {
        // The fade is the published memory's own projection: a = R / (R + K), R = aK / (1 − a), decaying by e^(−t/τ) on the dimension.
        const reg = anchor.registry || {}, K = Number(reg.K) || 1.8, t = days * 86400000;
        const tauRoom = Number((((reg.dimensions || []).find((x) => x.key === 'room')) || {}).tauMs) || Number(reg.tauMs) || 1209600000;
        const tauLabel = (ms) => (ms < 120000 ? `${Math.round(ms / 1000)} seconds` : ms < 7200000 ? `${Math.round(ms / 60000)} minutes` : `${Math.round(ms / 86400000)} days`);
        const carry = (a) => { if (!(a > 0) || a >= 1) return a; const r = (a * K) / (1 - a) * Math.exp(-t / tauRoom); return r / (r + K); };
        // The page shows two decimals of an unrounded dial: the projection must hold somewhere in the interval the displayed
        // reading allows (b ± 0.005; the projection rises with b), within the display's own rounding of the result.
        const fits = (x) => Boolean(x) && carry(x.b - 0.005) - 0.0051 <= x.a && x.a <= carry(x.b + 0.005) + 0.0051
          && [x.b - 0.005, x.b, x.b + 0.005].some((b) => Math.abs(Math.round(((b - carry(b)) / b) * 100) - x.fall) <= 1);
        ok(`each fade is the published memory’s projection over ${days} days (τ ${tauLabel(tauRoom)} on room, K ${K})`, fits(tv) && fits(laundry),
          tv && laundry ? `living room ${tv.b} → projected ${carry(tv.b).toFixed(3)} · laundry room ${laundry.b} → projected ${carry(laundry.b).toFixed(3)}` : 'no dials read');
        if (tauRoom < 3600000) {
          // Beat 13 on the demo's dial (D1: τ 60 s on the page-driving dimensions; M1's wording): it says the dial is compressed,
          // with the registry's own τ and K, and that her room signals are gone; and they are: every room below θin.
          const thetaIn = Number(reg.thetaIn) || 0.6;
          // Lane C3's wording “the shopper’s room signals”, or the earlier “her room signals”; nothing else.
          const dial = `On the demo’s dial (τ ${tauLabel(tauRoom)} on room, K ${K}; production’s dial runs days)`;
          const says = `${dial} the shopper’s room signals are gone within minutes`, saidBefore = `${dial} her room signals are gone within minutes`;
          ok(`on the demo’s compressed dial beat 13 says so: “${says}”`, has(S.cont.text, says) || has(S.cont.text, saidBefore), S.cont.text.slice(0, 200));
          const below = [tv, laundry].every((x) => x && x.a < thetaIn);
          ok(`and it is true: every room is below the entry threshold (θin ${thetaIn.toFixed(2)}) ${days} days on, and the beat says the continue hero rests on her shortlist and the decisions trail`,
            below && has(S.cont.text, `every room below the entry threshold (θin ${thetaIn.toFixed(2)})`) && (has(S.cont.text, 'rests on the shopper’s shortlist and the decisions trail, not on their room dials') || has(S.cont.text, 'rests on her shortlist and the decisions trail, not on her room dials')),
            `living room ${tv ? tv.a : '?'} · laundry room ${laundry ? laundry.a : '?'} · θin ${thetaIn}`);
        }
        // The comparative claim appears only when the readings differ.
        const differ = Boolean(tv && laundry) && tv.fall !== laundry.fall;
        const said = `${S.cont.text} ${S.line}`;
        const claims = /faded faster than|faded furthest/i.test(said);
        ok(differ ? 'the readings differ, and the sentence names the room that faded further' : 'the readings are the same, and no sentence claims one room faded further',
          differ ? claims && (laundry.fall > tv.fall ? /laundry[^.]*faded (faster|furthest)/i.test(said) : /living room[^.]*faded (faster|furthest)/i.test(said)) : !claims,
          `living room −${tv ? tv.fall : '?'}% · laundry room −${laundry ? laundry.fall : '?'}% · ${claims ? `says “${(said.match(/[^.]*faded (?:faster than|furthest)[^.]*/i) || [''])[0].trim().slice(0, 90)}”` : 'no comparative claim'}`);
      }
      const opened = await openedByHer();
      const shortlist = await evaluate("[...document.querySelectorAll('#slot-continue .p1-short')].filter((x) => window.__s1.vis(x).ok).map((x) => x.dataset.open)");
      ok('the hero’s shortlist is what she opened on this device, nothing inferred', shortlist.length > 0 && shortlist.every((sku) => opened.has(String(sku))), `${shortlist.join(', ')} · she opened ${opened.size}`);
      {
        // Lane P1's checks for this beat (P1 wrote them; S1 runs them after its own, in the beat's order).
        const R = await p1Read();
        ok('the clock jump says on screen that the engine’s own clock is real: the meters show her dials as it holds them', has(R.cont, 'the engine decides on its own clock, which is real'), R.cont.slice(0, 120));
        const lead = (await p1Read()).engine;
        ok('and the deals strip carries the same labelled line', has(lead, 'a labelled clock jump'), lead.slice(0, 120));
      }
    },
    'what-changed': async (S, i) => {
      ok('“What changed while you were away” opens on screen', S.sheet.shown && has(S.sheet.text, 'What changed while you were away'), S.sheet.text.slice(0, 80));
      const opened = await openedByHer();
      const items = S.sheet.items;
      ok('her shortlist in it is what she opened on this device, nothing inferred', items.length > 0 && items.every((x) => x.sku && opened.has(String(x.sku))), items.map((x) => x.sku).join(', '));
      const priceRow = (x) => (x.rows.find((r) => /^Price/.test(r)) || '');
      ok('each price is the catalog’s: held at the catalog’s own figure', items.every((x) => { const p = row(x.sku); return p && has(priceRow(x), `${money(p.salePrice)}, held`); }),
        items.map((x) => `${x.sku}: ${priceRow(x).replace(/^Price\s*/, '')}`).join(' · ').slice(0, 220));
      const ended = items.reduce((n, x) => n + x.rows.filter((r) => /^Ended/.test(r)).length, 0), running = items.reduce((n, x) => n + x.rows.filter((r) => /^Still running/.test(r)).length, 0);
      ok('and the offers on it that ended or still run are read off the documents in force', ended + running > 0, `${ended} ended · ${running} still running`);
      await evaluate("(() => { const b = document.getElementById('sheetClose'); if (b) b.click(); })()");
      await sleep(300);
    },

    'window-closes': async (S, i) => {
      // What is measured (the lead's alignment): the closed pieces are absent from the next decision on the page shown,
      // on screen and in the engine's own answer for that page off this press's wire.
      const was = snaps[i - 1];
      const prior = (was ? was.slots.flatMap((s) => s.cards.map((c) => c.cid)) : []);
      info(`closing at this publish: ${closingAt11.join(', ')} · on screen before the press: ${closingAt11.filter((c) => prior.includes(c)).join(', ') || 'none of them'}`);
      const still = closingAt11.filter((c) => S.slots.some((s) => s.cards.some((x) => x.cid === c)));
      const answer = await engineAnswer(i, S.view === 'tvs' ? 'tvs' : S.view);
      const inAnswer = answer ? closingAt11.filter((c) => answer.decisions.some((d) => d.customerContentId === c)) : null;
      ok(`the closed pieces are absent from the next decision on the page shown (the ${S.view} page): on screen and in the engine’s answer`, still.length === 0 && Array.isArray(inAnswer) && inAnswer.length === 0,
        [...still, ...(inAnswer || ['no answer read off the wire'])].join(', ') || S.slots.map((s) => `${s.slot}: ${s.cards.map((c) => c.cid).join(', ')}`).join(' · ').slice(0, 220));
      {
        // Lane P1's checks for this beat (P1 wrote them; S1 runs them after its own, in the beat's order).
        // Beat 11 starts on her TV page: the page's own answers on this press's wire, before the publish and after it.
        const twins = ['offer-tv-gift-card', 'offer-tv-matching-soundbar', 'offer-tv-sound-suite', 'offer-tv-free-mounting'];
        const bodyOf = async (id) => { try { const x = await cdp('Network.getResponseBody', { requestId: id }); return JSON.parse(x.base64Encoded ? Buffer.from(x.body, 'base64').toString('utf8') : x.body); } catch { return null; } };
        const asked = [...requests.entries()].filter(([, r]) => r.press === i && /\/decisions\/snapshot/.test(r.path) && r.status === 200 && new URL(r.url).searchParams.get('page') === 'product');
        const answers = [];
        for (const [id] of asked) { const body = await bodyOf(id); if (body && Array.isArray(body.decisions)) answers.push(body.decisions.filter((d) => d.slot === 'pdp-offers').map((d) => d.customerContentId)); }
        const first = answers[0] || [], lastA = answers[answers.length - 1] || [];
        ok(`beat 11 opens her TV page, and its offers answer a closing one before the publish: ${first.filter((x) => twins.includes(x)).join(', ') || 'none'}`, answers.length >= 2 && first.some((x) => twins.includes(x)),
          `${answers.length} product answer(s) on this press · ${first.join(', ')}`);
        ok('and the page’s next answer after it carries none of them: the room sees the gift card leave', answers.length >= 2 && !lastA.some((x) => twins.includes(x)), lastA.join(', ') || 'no offer');
        ok('then the homepage is on screen for the package half', S.view === 'home', S.view);
        const R = await p1Read();
        ok('the deals strip names what left her TV page, and carries the engine’s own line for the windows', has(R.engine, ' page: ') && has(R.engine, 'left its offers on the next decision') && has(R.engine, 'Window closed:'), R.engine.slice(0, 240));
        const held = (openCatalog.pieces || []).filter((x) => x.type === 'package' && x.inStock === false).map((x) => String(x.title || '').replace(/\.\s*$/, ''));
        ok(`and the packages held out of stock, never shown as complete: ${held.length}, each by name`, has(R.engine, 'Never shown as complete') && held.every((t) => has(R.engine, t)), R.engine.slice(0, 260));
      }
    },
    'pin-launch': async (S) => {
      const deals = S.slots.find((s) => s.slot === 'deals');
      const pinned = anchor.ids.pinned;
      const shownDeals = Boolean(deals && deals.shown && deals.cards.length);
      checks.known('beat 12 shows the page it asked again: the deals are on screen', shownDeals, `on screen: the ${S.view} page`,
        'P1 (beat 12 in public/oh/beats.json asks the homepage while she is on a product page)');
      if (shownDeals) ok(`the pinned launch leads the deals on screen: “${TITLE[pinned] || pinned}”`, deals.cards[0].cid === pinned, deals.cards.map((c) => c.cid).join(', '));
    },
    'phone-sign-in': async (S, i) => {
      {
        // Lane P3's checks for this beat (P3 wrote them; S1 runs them after its own, in the beat's order).
        const P = await evaluate(`(() => { const s = window.${HOOK}.state, A = s.visitors.A, B = s.visitors.B, strip = document.getElementById('p3Signed');
          return { framed: document.body.classList.contains('shell--phone'), address: location.pathname, who: s.who,
            strip: strip && window.__s1.vis(strip).ok ? window.__s1.txt(strip) : '', chip: window.__s1.txt('#whoChip'),
            one: Boolean(A && B && A.session.subject === B.session.subject), person: Boolean(B && /^sh_/.test(B.session.subject)),
            kinds: [A && A.session.kind, B && B.session.kind] }; })()`);
        ok('the phone is on screen: the homepage’s slots in the phone frame, at /oh/m', P.framed && P.address === `/${SLUG}/m` && S.view === 'home' && P.who === 'B', `${P.address} · ${S.view} · visitor ${P.who}`);
        ok(`the receipt under the header names ${account} and reads “${RECEIPT}”, on screen`, has(P.strip, RECEIPT) && has(P.strip, account), P.strip.slice(0, 160));
        ok('the who chip says she is signed in, not anonymous', has(P.chip, `signed in as ${account}`) && !has(P.chip, 'anonymous'), P.chip);
        ok('the laptop and the phone are one person: both sessions name the same recognised shopper', P.one && P.person && P.kinds.every((k) => k === 'recognized'), P.kinds.join(' · '));
        // The two sign-ins of this press, as they crossed the wire: her session, { account } alone, success, the flag, her session.
        const signs = inPress(i, (r) => r.path === SIGN);
        const posts = await Promise.all(signs.map(([id]) => postOf(id)));
        const answers = await Promise.all(signs.map(([id]) => bodyOf(id)));
        ok(`two sign-ins went to ${SIGN}, the laptop’s then the phone’s, each with its own session and X-Tenant, and no Authorization`,
          signs.length === 2 && signs.every(([, r]) => r.status === 200 && header(r, 'X-Tenant') === TENANT && Boolean(header(r, 'X-Shopper-Session')) && !header(r, 'Authorization'))
          && header(signs[0][1], 'X-Shopper-Session') !== header(signs[1][1], 'X-Shopper-Session'), signs.map(([, r]) => r.status).join(' · ') || 'none');
        ok('each carried { account } and nothing else: no assertion, no account id, no visitor crossed from the page',
          posts.length === 2 && posts.every((t) => { const j = json(t); return j && Object.keys(j).join(',') === 'account' && j.account === account; }), posts.map((t) => String(t).slice(0, 60)).join(' · '));
        ok('each answered success, the linked flag and the session she carries from now on, and nothing of the proof',
          answers.length === 2 && answers.every((t) => { const j = json(t); return j && Object.keys(j).sort().join(',') === 'linked,ok,session' && j.ok === true && j.linked === true
            && j.session && j.session.kind === 'recognized' && !/assertion|oh-demo-/i.test(t); }), answers.map((t) => Object.keys(json(t) || {}).sort().join(',')).join(' · '));
        // One request later: the phone's homepage as a stranger, then as the person, read off the engine's own answers.
        const capB = await evaluate(`window.${HOOK}.state.visitors.B.session.capability`);
        const capA = await evaluate(`window.${HOOK}.state.visitors.A.session.capability`);
        const phoneAt = signs.length ? signs[signs.length - 1][1].at : Infinity;
        const homes = inPress(i, (r) => /\/decisions\/snapshot/.test(r.path) && r.status === 200 && new URL(r.url).searchParams.get('page') === 'home');
        const stranger = homes.filter(([, r]) => r.at < phoneAt && ![capA, capB].includes(header(r, 'X-Shopper-Session'))).pop();
        const person = homes.filter(([, r]) => r.at > phoneAt && header(r, 'X-Shopper-Session') === capB);
        ok('the phone asked its homepage as a stranger, then once more right after its sign-in, as the person', Boolean(stranger) && person.length >= 1, `${stranger ? 1 : 0} · ${person.length}`);
        if (stranger && person.length) {
          const [a, b] = [json(await bodyOf(stranger[0])), json(await bodyOf(person[0][0]))];
          const of = (body, slot) => ((body && body.decisions) || []).filter((d) => d.slot === slot).sort((x, y) => x.order - y.order).map((d) => d.customerContentId).join('|');
          const moved = ['hero', 'category-rail', 'deals'].filter((slot) => of(a, slot) !== of(b, slot));
          ok('and the same page answered differently once she was the person: the laptop’s taste moved its decided slots', moved.length > 0, moved.join(', ') || 'nothing moved');
        }
        const meters = inPress(i, (r) => r.path === '/realtime/reflex' && r.status === 200);
        const strangerCap = stranger ? header(stranger[1], 'X-Shopper-Session') : null;
        const strangerReads = meters.filter(([, r]) => r.at < phoneAt && header(r, 'X-Shopper-Session') === strangerCap);
        const personReads = meters.filter(([, r]) => r.at > phoneAt && header(r, 'X-Shopper-Session') === capB);
        const laptopReads = meters.filter(([, r]) => r.at > phoneAt && header(r, 'X-Shopper-Session') === capA);
        if (strangerReads.length && personReads.length) {
          // At the moment of the link the page reads both sessions at once (P3): the phone's first read as the person and the
          // laptop's beside it. Her three strongest values across every dimension, whatever their memory, must be the same.
          const dimsOf = async (id) => ((json(await bodyOf(id)) || {}).affinity || {}).dims;
          const before = strongest(await dimsOf(strangerReads[strangerReads.length - 1][0]));
          const after = strongest(await dimsOf(personReads[0][0]));
          const beside = laptopReads.length ? strongest(await dimsOf(laptopReads[0][0])) : [];
          const sameSet = (x, y) => x.length > 0 && [...x].sort().join('|') === [...y].sort().join('|');
          ok('her phone’s own meters: a stranger’s, none of the laptop’s taste; then, at the link, the three strongest values across every dimension, read at the same moment through the phone’s and the laptop’s sessions, the same',
            after.length === 3 && sameSet(after, beside) && !after.some((k) => before.includes(k)),
            `stranger ${before.join(', ') || 'none'} → phone ${after.join(', ') || 'none'} · laptop ${beside.join(', ') || (laptopReads.length ? 'none' : 'not read at the link')}`);
          const shortTau = after.some((k) => tau(k.split(':')[0]) < 86400000);
          ok(`and the strip labels them “strongest at sign-in”${shortTau ? ', with “memory compressed for the room; production runs days” (a named dimension’s τ is under a day)' : ''}`,
            has(P.strip, 'strongest at sign-in') && (!shortTau || has(P.strip, 'memory compressed for the room; production runs days')), P.strip.slice(0, 220));
          ok('and the director’s sentence says what the meters say', has(S.line, 'the laptop’s three strongest signals lead here too'), S.line.slice(0, 160));
        } else ok('her phone’s meters were read before and after its sign-in', false, `${strangerReads.length} · ${personReads.length}`);
        P3D.base = await p3Report(true);
        info(`the day before beat 16: partner_pickup ${counted(P3D.base, 'partner_pickup')} · retailer_referral ${counted(P3D.base, 'retailer_referral')}`);
      }
    },
    'best-buy-counts': async (S, i) => {
      {
        // Lane P3's checks for this beat (P3 wrote them; S1 runs them after its own, in the beat's order).
        // The two outcomes, as they crossed the wire, each with the decision on the page that earned it.
        const acts = inPress(i, (r) => r.path === '/realtime/action' && r.body).map(([, r]) => json(r.body)).filter(Boolean);
        const pages = inPress(i, (r) => /\/decisions\/snapshot/.test(r.path) && r.status === 200 && new URL(r.url).searchParams.get('page') === 'product');
        for (const [event, sku, cid] of [['partner_pickup', W.pickup, 'mod-where-to-buy-pickup'], ['retailer_referral', W.referral, 'mod-where-to-buy-retailer']]) {
          const sent = acts.filter((b) => b.type === 'custom' && b.data && b.data.event === event);
          const asked = pages.filter(([, r]) => new URL(r.url).searchParams.get('ctx.anchor') === sku).reverse();
          let decided = null;
          for (const [id] of asked) { const body = json(await bodyOf(id)); const d = body && (body.decisions || []).find((x) => x.customerContentId === cid); if (d) { decided = d; break; } }
          ok(`${event}: one press on the ${sku} page went on the wire as type custom with data.event, carrying the decision on screen that earned it`,
            sent.length === 1 && Boolean(decided) && sent[0].data.decisionId === decided.decisionId && sent[0].data.contentId === decided.contentId
              && sent[0].data.slot === 'pdp-modules' && sent[0].data.customerContentId === cid && sent[0].data.productId === sku,
            sent.length ? `${sent[0].data.customerContentId} · ${decided ? (sent[0].data.decisionId === decided.decisionId ? 'the decision on screen' : 'another decision') : `no ${cid} decided on ${sku}`}` : 'not sent');
        }
        const R = await evaluate(`(() => { const box = document.getElementById('p3Outcomes');
          const wtb = document.querySelector('#stage > .view:not([hidden]) [data-module="mod-where-to-buy-retailer"] [data-p3-outcome="retailer_referral"]');
          const rows = box ? [...box.querySelectorAll('.rep-row:not(.rep-head)')].map((r) => [...r.children].map((c) => window.__s1.txt(c))) : [];
          return { panel: window.__s1.vis('#panel-report').ok, box: box && window.__s1.vis(box).ok ? window.__s1.txt(box) : '', rows,
            confirm: wtb && window.__s1.vis(wtb).ok ? window.__s1.txt(wtb) : '', kit: window.__s1.txt('#reportBody') }; })()`);
        const module = await p3View('#stage > .view:not([hidden]) [data-module="mod-where-to-buy-retailer"]');
        ok('the mount page says the referral went out with the decision that earned it, and that a referral is not a sale', has(R.confirm, 'retailer_referral') && has(R.confirm, W.retailer)
          && has(module, 'A referral is not a sale'), R.confirm.slice(0, 160));
        ok('the day report is on screen (Learned), its slots by name', R.panel && has(R.kit, 'Goes with it · product pages'), R.kit.slice(0, 120));
        const rep = await p3Report(false);
        const pick = R.rows.find((r) => has(r[0], 'partner_pickup')), refer = R.rows.find((r) => has(r[0], 'retailer_referral'));
        if (rep && rep.hours && rep.hours.source === 'aggregates') {
          info(`the report sums the folded hours: an outcome appears once its hour has closed and the next five-minute fold has run, never in the same second: on screen ${pick ? pick.slice(1).join('/') : '—'} · ${refer ? refer.slice(1).join('/') : '—'}`);
          ok('beside it, the outcomes as the engine’s own report counts them, and this visit’s one each', Boolean(pick && refer && rep) && Number(pick[1]) === counted(rep, 'partner_pickup')
            && Number(refer[1]) === counted(rep, 'retailer_referral') && pick[3] === '1' && refer[3] === '1', `on screen ${pick ? pick.slice(1).join('/') : '—'} · ${refer ? refer.slice(1).join('/') : '—'}`);
        } else ok('beside it, the outcomes the engine’s own report counts: one more Best Buy pickup and one more retailer referral than before the beat, this visit’s one each',
          Boolean(pick && refer && rep) && Number(pick[1]) === counted(rep, 'partner_pickup') && Number(refer[1]) === counted(rep, 'retailer_referral')
            && counted(rep, 'partner_pickup') >= counted(P3D.base, 'partner_pickup') + 1 && counted(rep, 'retailer_referral') >= counted(P3D.base, 'retailer_referral') + 1
            && pick[3] === '1' && refer[3] === '1',
          `on screen ${pick ? pick.slice(1).join('/') : '—'} · ${refer ? refer.slice(1).join('/') : '—'} · the engine ${counted(P3D.base, 'partner_pickup')} → ${counted(rep, 'partner_pickup')}, ${counted(P3D.base, 'retailer_referral')} → ${counted(rep, 'retailer_referral')}`);
        ok('with the orders and the attach beside them, labelled attribution, and “not yet significant”', has(R.box, 'Orders shipped') && has(R.box, 'Attach') && has(R.box, 'Not yet significant')
          && has(R.box, 'A referral is not a sale') && has(R.kit, 'Attribution, not incrementality'), R.box.slice(0, 160));
      }
    },
    'pin-launch': async (S, i) => {
      {
        // Lane P1's checks for this beat (P1 wrote them; S1 runs them after its own, in the beat's order).
        const R = await p1Read();
        ok('the pinned card’s receipt says the merchandiser placed it for everyone and ranking was skipped', has(R.pinReceipt, 'pinned by our merchandiser') && has(R.pinReceipt, 'for everyone') && has(R.pinReceipt, 'ranking skipped'), R.pinReceipt.slice(0, 160));
        ok('and names what the engine would have led with, now container 2', has(R.pinReceipt, 'without the pin the engine would have led with') && has(R.pinReceipt, 'container 2 now'), R.pinReceipt.slice(0, 220));
        ok('the strip says the merchandiser outranks the engine, visibly', has(R.engine, 'The merchandiser outranks the engine, visibly'), R.engine.slice(0, 160));
      }
    },
  };




  const beats = beatsDoc.beats;
  for (let i = 0; i < beats.length; i += 1) {
    const b = beats[i];
    press = i;
    console.log(`\n── ${b.no} · ${b.label}${built(b) ? '' : ' (not built yet)'}`);
    const timer = pressTimer(), { t0 } = timer;
    const landed = await runBeat(i);
    timer.land();
    if (!built(b)) {
      // The honest stop: a beat whose presses are not written says so, by lane, and never says done.
      ok(`↳ ${b.no}: not built yet, and the page says so, naming ${laneOf(b)}: never a silent done`, landed !== 'done' && /not built yet/.test(landed) && landed.includes(laneOf(b)), String(landed).slice(0, 140));
      openBeats.push(`${b.no} (${laneOf(b)})`);
      snaps[i] = await snap();
      continue;
    }
    if (b.key === 'window-closes') {
      // The pieces the beat closes, from its own document against the opening catalog, before it is pressed.
      const doc = (await getJson('beats/11-window-closes.json')).publish.document;
      const now = Date.now();
      const endOf = (p) => (p && p.window && p.window.to ? Date.parse(p.window.to) : Infinity);
      const opening = new Map((openCatalog.pieces || []).map((p) => [p.customerContentId, p]));
      closingAt11 = (doc.pieces || []).filter((p) => endOf(p) <= now && endOf(opening.get(p.customerContentId)) > now).map((p) => p.customerContentId);
    }
    await sleep(SETTLE_MS);
    let S = await snap();
    snaps[i] = S;
    info(`${timer.line()} · ${S.view} · ${S.slots.filter((s) => s.cards.length).map((s) => `${s.slot}: ${s.cards.map((c) => c.cid).join(', ')}`).join(' · ').slice(0, 260)}`);
    if (/identity verification is not configured on this worker/.test(String(landed))) {
      checks.known(`↳ ${b.no}: the live sign-in mints the signed link on the worker`, false, String(landed).slice(0, 140),
        'the rig (this worker has no IDENTITY_SECRETS: .dev.vars carries none and scripts/demo-kit/rig.mjs passes none; the lead or the owner)');
      openBeats.push(`${b.no} (the rig: no IDENTITY_SECRETS)`);
      snaps[i] = S;
      continue;
    }
    ok(`↳ ${b.no}: the press landed`, landed === 'done', String(landed).slice(0, 140));
    await waitFor(`window.${HOOK}.compare().then((k) => { const x = k.baselineInfo(); return Boolean(x && x.at >= ${t0 - 500}); })`, 8000);
    const bf = await evaluate(`window.${HOOK}.compare().then((k) => { const x = k.baselineInfo(); return x && { at: x.at, where: (x.meta || {}).where || '', who: (x.meta || {}).who || '', main: document.getElementById('compareBtn').title }; })`);
    ok(`↳ ${b.no}: a Before was taken as the press landed, and Compare’s title names it`, Boolean(bf && bf.at >= t0 - 500 && bf.at <= t0 + 5000 && bf.where && bf.main.startsWith(`Before: ${bf.where} at `)),
      bf ? `cloned ${bf.at - t0} ms after the press · “${bf.main}”` : 'no Before');
    const refused = refusedIn(i);
    // A day-report build on wrangler dev throws “Configuration publication authority unavailable” and the requests in flight
    // answer 503 (Vantage RESUME finding 3): receipts refused in a press that built the report are that finding, named, not the page’s.
    const builtReport = [...requests.values()].some((r) => r.press === i && [`${API}/report`, `${API}/beat`, `${API}/reset`].includes(r.path));   // a build or a publish in flight
    const engine503 = builtReport ? refused.filter((x) => x === `POST ${API}/receipt → 503`) : [];
    const otherRefused = refused.filter((x) => !engine503.includes(x));
    ok(`↳ ${b.no}: the decision service answered`, S.down.length === 0 && otherRefused.length === 0, [...S.down, ...otherRefused].join(' ~ ').slice(0, 220));
    if (engine503.length) checks.known(`↳ ${b.no}: every receipt read answered while a report built or a beat published`, false, `${engine503.length} × ${engine503[0]}`,
      'the engine on wrangler dev (a report build or a publish in flight throws “Configuration publication authority unavailable”; Vantage RESUME finding 3)');
    ok(`↳ ${b.no}: the director’s sentence is on screen, with its beat number`, S.lineOk && S.line.length > 20 && has(S.beatNo, `Beat ${b.no} / ${beatsDoc.total}`), `${S.beatNo} · ${S.line.slice(0, 90)}`);
    {
      // Legible: the before/now row on the surface the press is about (the page lanes draw it through the kit's deltas).
      const strips = S.strips.filter((x) => x.shown && x.rows.length);
      if (S.strips.length || strips.length) ok(`↳ ${b.no} is legible: the before/now row is filled`, strips.length > 0 && strips.every((x) => x.rows.every((r) => r.length > 0)),
        strips.map((x) => `${x.module}: ${x.rows.slice(0, 2).join(' · ')}`).join(' ~ ').slice(0, 200));
      else { info(`↳ ${b.no}: no before/now row on the page yet (the page lane’s rows); legibility is open`); if (!openBeats.includes(`before/now rows (${laneOf(b)})`)) openBeats.push(`before/now rows`); }
    }
    await inEngineOrder(`↳ ${b.no}`, S, i);
    {
      const late = [...(await evaluate('window.__s1.pendingLoad()')).filter((x) => !x.ok).map((x) => `${x.src} (${x.why})`), ...(await imgErrors()).map((x) => `${x} (failed; the page swapped in its name tile)`)];
      ok(`↳ ${b.no}: no horizontal overflow, no broken image`, S.overflow <= 1 && S.broken.length === 0 && late.length === 0, `${S.overflow}px${S.broken.length || late.length ? ` · broken ${[...S.broken, ...late].slice(0, 3).join(', ')}` : ''}`);
    }
    if (OUTCOMES[b.key]) await OUTCOMES[b.key](S, i);
    else { info(`built, and its outcomes are not yet in this suite: S1’s to write`); openBeats.push(`${b.no} (S1)`); }
    await compareOnPress(`↳ ${b.no}`);
    await shot(`${String(b.no).padStart(2, '0')}-${b.key}`);
    if (b.key === 'closet-width') await freshHere('a product page');      // Fresh visitor on the homepage is beat 4's own press
    S = await snap();
    snaps[i] = { ...snaps[i], after: S };
  }
  }

  console.log('\n── The wire, for the whole walk');
  const { api } = auditWire(checks, wire, { tenant: TENANT });
  if (!ONLY_STORE) checkDemoRouteBodies(checks, wire, { api: API });
  info(tallyWire(api, { tenant: TENANT }));
  checkScriptErrors(checks, wire);
  {
    // The ruling of 730eaa3 (S2): no regional block the page received names priceTier: every POST /sort answer on the wire.
    const sorts = [...requests.entries()].filter(([, r]) => r.path === '/sort' && r.status === 200).slice(-120);
    let read = 0; const hits = [];
    for (const [id] of sorts) {
      try { const b = await cdp('Network.getResponseBody', { requestId: id }); const body = JSON.parse(b.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : b.body); read += 1;
        if (body.regional && (body.regional.dimensions || []).includes('priceTier')) hits.push(`/sort ${id}: regional.dimensions ${body.regional.dimensions.join(',')}`); } catch { /* evicted */ }
    }
    if (read === 0 && ONLY_STORE) info('no regional block read: the store part navigates away from its pages, so their /sort bodies are gone (the full run reads them)');
    else ok(`no regional block the page received names priceTier: ${read} POST /sort answers read off the wire`, read > 0 && hits.length === 0, hits.slice(0, 3).join(' ~ '));
  }
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

if (openBeats.length) info(`still open: ${[...new Set(openBeats)].join(' · ')}`);
checks.summary({ failed: 'do not hand this over', passed: `OH's page runs every built beat in the real page, and every effect has a visible cause${openBeats.length ? ' (open items listed above)' : ''}` });
process.exit(checks.exitCode());
