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
  window.__s1 = { vis, txt, snapshot, framePixels, scrollThrough, pendingLoad };
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
const herCap = () => evaluate(`(() => { const s = window.${HOOK}.state; const v = s && s.who ? s.visitors[s.who] : null; return v && v.session ? v.session.capability : null; })()`);
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
    const want = engine.map((d) => d.customerContentId);
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
  checks.known(`Fresh visitor on ${where} opens on two frames of real pixels, her page and a fresh visitor’s in the same region`, C.mode === 'seam' && /^Her page · /i.test(C.tags.before)
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
const completes = (m, sku) => Boolean(m && m.decided && m.receipt.includes(`Completes what she committed to: ${sku}`));
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
/** Her lasting signals (a day of memory or more), strongest first: what the page calls her taste. */
const lasting = (dims, n = 3) => Object.entries(dims || {}).filter(([dim]) => tau(dim) >= 86400000)
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

  // ── Every shell at 1440 and 1366: no horizontal overflow, no broken image ──
  console.log('\n── Every shell, at 1440 and 1366');
  const SHELLS = [['the homepage', `${base}/${SLUG}/?debug=1`], ['the TV grid', `${base}/${SLUG}/?view=tvs&debug=1`],
    ...Object.entries(PDP).filter(([, p]) => p).map(([k, p]) => [`the ${k} page (${p.sku})`, `${base}/${SLUG}/product?id=${encodeURIComponent(p.sku)}&debug=1`]),
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

  // ── The walk ───────────────────────────────────────────────────────────────
  const url = `${base}/${SLUG}/?debug=1`;
  console.log(`\n── The page loads: ${url}`);
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
      const fromRequest = has(S.cold.text, 'from the request') && (LOOPBACK ? has(S.cold.text, 'local runtime') : has(S.cold.text, 'the edge located her'));
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
      ok('Compare → Fresh visitor opens on two frames of real pixels, tagged “Her page” and “A fresh visitor, same region”', C.ok && C.mode === 'seam' && /^Her page · /i.test(C.tags.before)
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
      const want = ['mod-laundry-dryer', 'mod-laundry-pedestal', 'mod-laundry-stacking', 'mod-laundry-pair-price'];
      const cards = want.map((id) => S.modules.find((m) => m.cid === id));
      ok('below it the room completes, on screen: the dryer, the pedestal, the stacking kit and the pair price', cards.every(Boolean), S.modules.map((m) => m.cid).join(', '));
      ok(`each card’s receipt line reads “Completes what she committed to: ${p.sku}”`, cards.every((m) => m && has(m.receipt, `Completes what she committed to: ${p.sku}`)),
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
        const want = ['mod-laundry-dryer', 'mod-laundry-pedestal', 'mod-laundry-stacking', 'mod-laundry-pair-price'];
        ok(`the dryer, the pedestal, the stacking kit and the pair price are on screen, each decided, each receipt reading “Completes what she committed to: ${p.sku}”`,
          want.every((cid) => completes(mod(R, cid), p.sku)), want.map((cid) => `${cid} ${mod(R, cid) ? (completes(mod(R, cid), p.sku) ? 'completes' : 'no completes line') : 'absent'}`).join(' · '));
        ok('each states its rule as our merchandiser’s, on the card', want.every((cid) => mod(R, cid) && /our merchandiser/i.test(mod(R, cid).rule)), want.filter((cid) => !(mod(R, cid) && /our merchandiser/i.test(mod(R, cid).rule))).join(', ') || 'all four');
        const dryer = mod(R, 'mod-laundry-dryer');
        const sort = await p2InSortOrder('the dryer in her fuel', dryer, i);
        if (sort && dryer && dryer.tiles.length) {
          // Her fuel is the engine's reading: the fuel of what POST /sort put first. The region's lean is said beside it, and
          // where her own browsing outweighs it (the sort's own drivers: sold here, the set she is in), the card says so.
          const first = D.row(dryer.tiles[0]), fuel = first && first.attributes.fuel;
          ok(`the lead line names the fuel POST /sort put first: “In her fuel: ${fuel} leads”`, Boolean(fuel) && has(dryer.text, `In her fuel: ${fuel} leads`), `${first ? first.sku : 'none'} · ${dryer.text.slice(0, 160)}`);
          if (sort.regional) {
            const cs = await (await fetch(`${base}${API}/coldstart${sort.regional.asserted ? `?region=${sort.regional.region}` : ''}`, { headers: { 'X-Tenant': TENANT, 'X-SDK-Key': 'demo-site' } })).json().catch(() => null);
            const lean = cs && cs.lean && cs.lean.leaders ? cs.lean.leaders.fuel : null;
            ok(`and whose sales the order leans with, labelled synthetic → warehouse${lean && lean !== fuel ? `, saying ${sort.regional.region}’s sales lean ${lean} and her own browsing outweighs them here` : ''}`,
              /leans with .*synthetic → warehouse/.test(dryer.text) && (!lean || lean === fuel || (has(dryer.text, `sales lean ${lean}`) && has(dryer.text, 'her own browsing outweighs'))), `lean ${lean} · first ${fuel}`);
          }
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
      ok(`the dryer stays, completing the new washer ${top ? top.sku : ''}`, Boolean(dryer && top) && has(dryer.receipt, `Completes what she committed to: ${top.sku}`), dryer ? dryer.receipt.slice(0, 100) : 'no dryer card');
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
        ok(`${what} is on screen, its receipt reading “Completes what she committed to: ${p.sku}”`, Boolean(m) && has(m.receipt, `Completes what she committed to: ${p.sku}`), m ? m.receipt.slice(0, 100) : `${id} not on screen`);
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
        ok(`${what} is on screen, completing ${p.sku}`, Boolean(m) && has(m.receipt, `Completes what she committed to: ${p.sku}`), m ? m.receipt.slice(0, 100) : `${id} not on screen`);
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
        const band = want && want.attributes.sizeBand;
        ok(`and it moved her own meters: the sentence says what moved, and her profile holds ${band}`, Boolean(want) && /her own meters moved/.test(R.line) && R.line.includes(`size band ${band}`)
          && Number(((R.vector.sizeBand || {})[band]) || 0) > 0, `${R.line.slice(-140)} · sizeBand ${band} ${Number(((R.vector.sizeBand || {})[band]) || 0).toFixed(2)}`);
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
        const carry = (a) => { if (!(a > 0) || a >= 1) return a; const r = (a * K) / (1 - a) * Math.exp(-t / tauRoom); return r / (r + K); };
        // The page shows two decimals of an unrounded dial: the projection must hold somewhere in the interval the displayed
        // reading allows (b ± 0.005; the projection rises with b), within the display's own rounding of the result.
        const fits = (x) => Boolean(x) && carry(x.b - 0.005) - 0.0051 <= x.a && x.a <= carry(x.b + 0.005) + 0.0051
          && [x.b - 0.005, x.b, x.b + 0.005].some((b) => Math.abs(Math.round(((b - carry(b)) / b) * 100) - x.fall) <= 1);
        ok(`each fade is the published memory’s projection over ${days} days (τ ${Math.round(tauRoom / 86400000)} days on room, K ${K})`, fits(tv) && fits(laundry),
          tv && laundry ? `living room ${tv.b} → projected ${carry(tv.b).toFixed(3)} · laundry room ${laundry.b} → projected ${carry(laundry.b).toFixed(3)}` : 'no dials read');
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
        if (strangerReads.length && personReads.length) {
          const before = lasting(((json(await bodyOf(strangerReads[strangerReads.length - 1][0])) || {}).affinity || {}).dims);
          const after = lasting(((json(await bodyOf(personReads[personReads.length - 1][0])) || {}).affinity || {}).dims);
          ok('her phone’s own meters: a stranger’s, none of the laptop’s lasting taste; then, signed in, the laptop’s three strongest lasting signals',
            after.length === 3 && !after.some((k) => before.includes(k)), `${before.join(', ') || 'none'} → ${after.join(', ')}`);
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

  console.log('\n── The wire, for the whole walk');
  const { api } = auditWire(checks, wire, { tenant: TENANT });
  checkDemoRouteBodies(checks, wire, { api: API });
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

if (openBeats.length) info(`still open: ${[...new Set(openBeats)].join(' · ')}`);
checks.summary({ failed: 'do not hand this over', passed: `OH's page runs every built beat in the real page, and every effect has a visible cause${openBeats.length ? ' (open items listed above)' : ''}` });
process.exit(checks.exitCode());
