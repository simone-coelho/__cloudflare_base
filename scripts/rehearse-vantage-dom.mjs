#!/usr/bin/env node
// scripts/rehearse-vantage-dom.mjs: press the director's buttons, for real.
//
// This loads the ACTUAL Vantage page (public/vantage/index.html and vantage.js,
// served by the worker) into headless Chrome and runs the 22 director presses
// through the page's own hook, window.__vantage.go(i) under ?debug=1: the same
// function the director bar's Next button calls. It is the browser twin of the
// Top Offers DOM suite (rehearse-top-offers-dom.mjs) and asks the same three
// questions after every press: did the service answer, is the press legible
// (the before/now row filled, the director's sentence on screen), and did the
// named thing happen (docs/verizon/lanes/L2.md, the walkthrough).
//
// Every answer is read off what a person would see: the computed style up the
// whole ancestor chain and a real layout box, never an attribute or a hidden
// flag. That is why this suite needs a real browser where the Top Offers one
// runs a stub DOM: these claims are visual (a module renders first, a meter
// crosses its tick, the buy box says off limits on screen), and a stub cannot
// compute style or layout. It also watches the wire: every API call the page
// makes must carry X-Tenant: vantage, none may go to /content, and none may
// carry an Authorization header.
//
//   node scripts/rehearse-vantage-dom.mjs [--base http://localhost:9110] [--wait 45]
//        [--size 1440x900] [--chrome "<path to Chrome or Edge>"] [--strict] [--shots <dir>]
//
// Compare (lane C1, the demo kit's widget, public/demo-kit/compare.js). The suite
// presses Compare with no earlier frame (the message, not nothing), and during the
// first paint of a direct phone-page load; checks that a Before exists after that
// paint and at the start of every performed beat; opens Compare on the homepage
// with no Capture pressed (two frames of real pixels, the Before / Now tags), drags
// the seam with the mouse and nudges it with the keys, switches to Side by side
// and What changed; runs Fresh visitor on the homepage and checks her page, her
// visitor and her address after it closes; runs Fresh visitor and Streaming
// shopper on the phone page as before, now with their frames; and presses Capture.
// It prints how long each Before took to capture. --shots <dir> saves the Seam,
// Side by side, What changed and Fresh visitor (homepage) views there as PNGs.
//
// A defect in another lane's file that this suite cannot repair is printed with
// "!" on every run and named on the last line (docs/verizon/lanes/L5.md has the
// fix); --strict makes it a failure.
//
// The region (lane F2). The page's arrival asserts no region: the edge locates the
// request, which differs from machine to machine. So the walk loads the page with
// the ?region=US-NY REHEARSAL OVERRIDE (asserted on every snapshot and labelled,
// where lane L1 measured the beats), after one beat 1 without it, which checks the
// panel says the region comes from the request (locally, as wrangler dev's runtime
// fills request.cf; or "no region on this request") and that no snapshot asserted one.
//
// --wait shortens beat 5's on-screen minute (the page's ?wait=N, rehearsal only).
// Brand memory is 60 s for the room, so the re-ask must land about 41 s or more
// after her third Samsung touch; 45 leaves a margin over beat 4's few seconds.
// It holds no credential and takes no token, and it ends with
// POST /vantage/api/reset so the tenant is left at its opening state. Chrome is
// launched headless with a fresh profile of its own under the OS temp directory
// (never shared with another run) and closed through the DevTools protocol at the
// end. Run it from Windows on this machine (Node 22 or later, Chrome or Edge).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('--base', 'http://localhost:9110').replace(/\/+$/, '');
const WAIT = Number(arg('--wait', '45'));
const [WIDTH, HEIGHT] = arg('--size', '1440x900').split('x').map(Number);
const SHOTS = arg('--shots', null);
const SETTLE_MS = 1500;               // the longest entrance animation is 1.2 s; the meters' fill eases over 0.4 s
const THETA_IN = 0.6, THETA_OUT = 0.45;

let failures = 0, passes = 0;
const defects = [];
const ok = (label, condition, detail = '') => {
  if (condition) { passes += 1; console.log(`   ✓ ${label}${detail ? `  (${detail})` : ''}`); }
  else { failures += 1; console.log(`   ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
  return Boolean(condition);
};
/**
 * A defect in another lane's file, recorded in docs/verizon/lanes/L5.md with its
 * fix, that this suite cannot repair. It prints on every run and is named on the
 * last line; it turns into an ordinary pass the day the fix lands. --strict fails on it.
 */
const STRICT = process.argv.includes('--strict');
const known = (label, condition, detail, owner) => {
  if (condition) return ok(label, true, detail);
  if (STRICT) return ok(label, false, detail);
  defects.push(`${label} (${owner})`);
  console.log(`   ! ${label} — ${detail}\n     known page defect, recorded for ${owner} in docs/verizon/lanes/L5.md`);
  return false;
};
const info = (line) => console.log(`        ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const has = (text, needle) => String(text || '').toLowerCase().includes(String(needle).toLowerCase());

// ── The browser ───────────────────────────────────────────────────────────────
const CHROMES = [arg('--chrome'), process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
const CHROME = CHROMES.find((p) => existsSync(p));
if (!CHROME) { console.log('✗ no Chrome or Edge found; pass --chrome "<path>"'); process.exit(1); }
if (typeof WebSocket === 'undefined') { console.log('✗ this suite needs Node 22 or later (a global WebSocket)'); process.exit(1); }

// A browser profile of its own for every run: two runs sharing one profile collide at launch (R1, 2026-09-30).
// Each run leaves one small directory under the OS temp directory; nothing here deletes anything.
const profile = mkdtempSync(join(tmpdir(), 'vantage-rehearsal-chrome-'));
const launchedAt = Date.now();
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${WIDTH},${HEIGHT}`,
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank'], { stdio: 'ignore' });
let chromeExited = false;
chrome.on('exit', () => { chromeExited = true; });

async function devtoolsPort() {
  const file = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 120; i += 1) {
    try { if (statSync(file).mtimeMs >= launchedAt - 2000) { const port = Number(readFileSync(file, 'utf8').split('\n')[0]); if (port) return port; } } catch { /* not yet */ }
    if (chromeExited) break;
    await sleep(250);
  }
  throw new Error(`${CHROME} did not open a DevTools port`);
}

let ws = null, nextId = 0;
const pending = new Map();
const listeners = new Map();
const on = (method, fn) => listeners.set(method, [...(listeners.get(method) || []), fn]);
function cdp(method, params = {}) {
  const id = ++nextId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject, method }));
}
async function connect(port) {
  let target = null;
  for (let i = 0; i < 40 && !target; i += 1) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* not yet */ }
    if (!target) await sleep(250);
  }
  if (!target) throw new Error('no page target in the browser');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('the DevTools socket did not open')); });
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`)); else p.resolve(msg.result);
    } else if (msg.method) for (const fn of listeners.get(msg.method) || []) fn(msg.params);
  };
}
async function evaluate(expression) {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`in the page: ${(r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text}`.slice(0, 400));
  return r.result.value;
}
async function waitFor(expression, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await evaluate(expression)) return true; await sleep(250); }
  return false;
}
async function closeBrowser(port) {
  try {
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const b = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { b.onopen = resolve; b.onerror = reject; });
    b.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    for (let i = 0; i < 40 && !chromeExited; i += 1) await sleep(250);
  } catch { /* the browser may already be gone */ }
  if (!chromeExited) console.log(`   · the browser (pid ${chrome.pid}) did not close on request`);
}

// ── The wire: every request the page makes, by press ─────────────────────────
const requests = new Map();
const consoleErrors = [];
let press = -1;
const API = (url) => { try { const p = new URL(url).pathname; return /^\/(v1|realtime|sort|vantage\/api|content|config|ops)\b/.test(p) ? p : null; } catch { return null; } };
on('Network.requestWillBeSent', (e) => {
  const path = API(e.request.url);
  if (!path) return;
  requests.set(e.requestId, { press, path, url: e.request.url, method: e.request.method, headers: e.request.headers || {}, status: null, failed: null });
});
on('Network.responseReceived', (e) => { const r = requests.get(e.requestId); if (r) r.status = e.response.status; });
on('Network.loadingFailed', (e) => { const r = requests.get(e.requestId); if (r && !e.canceled) r.failed = e.errorText; });
on('Runtime.exceptionThrown', (e) => consoleErrors.push(((e.exceptionDetails.exception || {}).description || e.exceptionDetails.text || '').slice(0, 300)));
const header = (r, name) => Object.entries(r.headers).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
const refusedIn = (i) => [...requests.values()].filter((r) => r.press === i && (r.failed || (r.status !== null && r.status >= 400)))
  .map((r) => `${r.method} ${r.path} → ${r.failed || r.status}`);

// ── What a person sees: computed style up the chain, and a real box ──────────
// Runs inside the page. Locators use the DOM hooks lane L2 documented; every
// assertion is on rendered text, computed visibility or layout.
function pageHelpers() {
  const name = (n) => (n.id ? `#${n.id}` : `${n.tagName.toLowerCase()}${n.classList.length ? `.${n.classList[0]}` : ''}`);
  const vis = (el) => {
    if (typeof el === 'string') el = document.querySelector(el);
    if (!el) return { ok: false, why: 'not in the page' };
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none') return { ok: false, why: `display: none on ${name(n)}` };
      if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return { ok: false, why: `visibility: ${cs.visibility} on ${name(n)}` };
      if (Number(cs.opacity) === 0) return { ok: false, why: `opacity: 0 on ${name(n)}` };
    }
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return { ok: false, why: `no box (${Math.round(r.width)}×${Math.round(r.height)})` };
    return { ok: true, w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top + scrollY), inView: r.bottom > 0 && r.top < innerHeight };
  };
  const txt = (el) => { if (typeof el === 'string') el = document.querySelector(el); return el ? el.innerText.replace(/\s+/g, ' ').trim() : ''; };
  const own = (el) => (el ? [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/\s+/g, ' ').trim() : '');
  const shown = (sel, root) => [...(root || document).querySelectorAll(sel)].filter((e) => vis(e).ok);
  const view = () => ['viewHome', 'viewPhones', 'viewPhone', 'viewPage'].find((id) => vis(`#${id}`).ok) || null;
  const meters = () => shown('#vectors .vecrow').map((row) => {
    const track = row.querySelector('.track'), fill = row.querySelector('.fill'), tick = row.querySelector('.thresh');
    const tr = track ? track.getBoundingClientRect() : { width: 0, left: 0 };
    return { value: own(row.querySelector('.vectop span')), label: txt(row.querySelector('.vectop em')), a: Number(txt(row.querySelector('.vectop b'))),
      fill: tr.width && fill ? fill.getBoundingClientRect().width / tr.width : 0, tick: tr.width && tick ? (tick.getBoundingClientRect().left - tr.left) / tr.width : null };
  });
  const snapshot = () => ({
    status: document.getElementById('status').textContent,
    view: view(),
    director: { line: txt('#engineLine'), lineOk: vis('#engineLine').ok, beatNo: txt('#beatNo') },
    down: { deals: vis('#dealsDown').ok, modules: vis('#modulesDown').ok, text: `${txt('#dealsDown')} ${txt('#modulesDown')}`.trim() },
    hero: { ok: vis('#hero').ok, title: txt('#hero .hero-h'), label: txt('#hero .hero-label'), rows: shown('#hero .hc-row').map(txt), receipt: txt('#hero .hero-receipt') },
    deals: shown('#deals .deal').map((c) => ({ title: txt(c.querySelector('.dtitle')), receipt: txt(c.querySelector('.receipt')),
      pin: vis(c.querySelector('.rc-pin')).ok ? txt(c.querySelector('.rc-pin')) : '', terms: vis(c.querySelector('details.terms summary')).ok, covered: txt(c.querySelector('.covered-chip')) })),
    dealsChanges: { ok: vis('#dealsChanges').ok, ghosts: shown('#dealsGhosts .ghost').length, before: txt('#dealsGhosts'), deltas: shown('#dealsDeltas li').map(txt) },
    rail: { ok: vis('#railModule').ok, chip: txt('#railChip'), deltasOk: vis('#railDeltas').ok, deltas: shown('#railDeltas li').map(txt), cards: shown('#rail .pcard').map((c) => txt(c.querySelector('.pname'))) },
    modules: shown('#modules > .pmod').map((m) => ({ title: own(m.querySelector('.pmod-head h2')), receipt: txt(m.querySelector('.rchip')),
      cite: vis(m.querySelector('.cite')).ok ? txt(m.querySelector('.cite')) : '', covered: txt(m.querySelector('.covered-chip')) })),
    pdpChanges: { ok: vis('#pdpChanges').ok, before: shown('#pdpBefore li').map(txt), deltas: shown('#pdpDeltas li').map(txt) },
    plans: shown('#modules .plan').map((p) => ({ name: txt(p.querySelector('h3')), fam: txt(p.querySelector('.plan-fam')), hh: txt(p.querySelector('.plan-hh')) })),
    offlimits: { ...vis('#buyBox .offlimits'), text: txt('#buyBox .offlimits') },
    maths: { ok: vis('#bbMaths').ok, text: txt('#bbMaths') },
    meters: meters(),
    vectorsText: txt('#vectors'),
    cold: { ok: vis('#coldStart').ok, text: txt('#coldStart') },
    ctx: txt('#ctxChips'),
    report: { ok: vis('#reportBody').ok, text: txt('#reportBody'), rows: shown('#reportBody .rep-row:not(.rep-head)').length, blocks: (() => {
      // One block per slot: its label, the rows shown under it, and any refusal printed in its place.
      const out = []; let block = null;
      for (const node of document.querySelectorAll('#reportBody > *')) {
        if (node.matches('.rep-k')) { block = { label: txt(node), rows: 0, empty: '' }; out.push(block); }
        else if (block && node.matches('.rep-row:not(.rep-head)') && vis(node).ok) block.rows += 1;
        else if (block && node.matches('.m-empty')) block.empty = txt(node);
      }
      return out;
    })() },
    // The demo kit's overlay (public/demo-kit/compare.js), as it is on screen: which view is live, the
    // message or the two frames and their tags, the panes of Side by side, the columns of What changed.
    compare: (() => {
      const box = (sel) => { const v = vis(sel); return v.ok ? { w: v.w, h: v.h } : null; };
      const stage = document.getElementById('cmp-stage');
      return { ok: vis('#cmp-back').ok, title: txt('#cmp-title'),
        mode: ['seam', 'split', 'details'].find((m) => { const b = document.getElementById(`cmp-mode-${m}`); return b && vis(b).ok && b.classList.contains('on') && !b.disabled; }) || null,
        msg: vis('#cmp-msg').ok ? txt('#cmp-msg') : '',
        tags: { before: vis('#cmp-tag-before').ok ? txt('#cmp-tag-before') : '', now: vis('#cmp-tag-now').ok ? txt('#cmp-tag-now') : '' },
        frames: { before: box('#cmp-before'), now: box('#cmp-after') },
        seam: stage ? getComputedStyle(stage).getPropertyValue('--cmp-seam').trim() : '',
        panes: shown('#cmp-split .cmp-pane').map((p) => ({ ...box(p), tag: txt(p.querySelector('.cmp-pane-tag')) })),
        hint: vis('#cmp-hint').ok ? txt('#cmp-hint') : '', caption: vis('#cmp-caption').ok ? txt('#cmp-caption') : '',
        cols: shown('#cmpCols .cmp-col').map((c) => ({ kicker: txt(c.querySelector('.ck')), head: txt(c.querySelector('h3')),
          sections: shown('.cmp-sec', c).map(txt), lists: [...c.querySelectorAll('.cmp-list')].map((ol) => [...ol.querySelectorAll('li')].map((li) => txt(li.children[1]))) })) };
    })(),
    focus: { hero: vis('#heroModule'), deals: vis('#dealsModule'), rail: vis('#railModule'), modules: vis('#modulesModule'), buybox: vis('#buyBox'), page: vis('#viewPage'), phones: vis('#viewPhones') },
    overflow: document.documentElement.scrollWidth - innerWidth,
    broken: [...document.images].filter((i) => vis(i).ok && i.complete && i.naturalWidth === 0).map((i) => i.getAttribute('src')),
  });
  /** Her page as it stands: what Fresh visitor and Streaming shopper must hand back unchanged. */
  const mine = () => ({
    view: view(), hero: txt('#hero .hero-h') || txt('#hero .hero-label'),
    order: ['heroModule', 'dealsModule', 'railModule'].map((id) => ({ id, v: vis(`#${id}`) })).filter((x) => x.v.ok).sort((a, b) => a.v.top - b.v.top).map((x) => x.id),
    deals: shown('#deals .deal').map((c) => txt(c.querySelector('.dtitle'))), dealsRow: shown('#dealsDeltas li').map(txt),
    rail: shown('#rail .pcard').map((c) => txt(c.querySelector('.pname'))),
    modules: shown('#modules > .pmod').map((m) => own(m.querySelector('.pmod-head h2'))), plans: shown('#modules .plan').map((p) => txt(p.querySelector('h3'))),
    pdpRow: [...shown('#pdpBefore li').map(txt), '|', ...shown('#pdpDeltas li').map(txt)],
    who: txt('#whoChip'), url: location.pathname + location.search,
  });
  /** The two frames' own pixels: each frame's image, loaded, at its natural size. */
  const framePixels = async () => {
    const urlOf = (id) => { const m = /url\("?(.*?)"?\)$/.exec(getComputedStyle(document.getElementById(id)).backgroundImage || ''); return m ? m[1] : null; };
    const size = (u) => new Promise((r) => { if (!u) { r(null); return; } const im = new Image(); im.onload = () => r({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => r(null); im.src = u; });
    return { before: await size(urlOf('cmp-before')), now: await size(urlOf('cmp-after')) };
  };
  window.__l5 = { vis, txt, snapshot, mine, framePixels };
  return true;
}

// ── The walk ──────────────────────────────────────────────────────────────────
const catalog = await (await fetch(`${base}/vantage/catalog.json`)).json();
const TITLE = Object.fromEntries(catalog.pieces.map((p) => [p.customerContentId, p.title]));
const anchor = await (await fetch(`${base}/vantage/beats/anchor.json`)).json();
const IDS = anchor.ids || {};
const titles = (S) => S.deals.map((d) => d.title);
const moduleTitles = (S) => S.modules.map((m) => m.title);
const meter = (S, value, labelPrefix) => S.meters.find((m) => m.value === value && m.label.toLowerCase().startsWith(labelPrefix)) || null;

/** The director's sentence for each press: a phrase from the page's own line, so a stale line is caught. */
const LINE = ['first paint answers', 'only the region changes', 'browses samsung', 'the hinge', 'watch her leave', 'off limits', 'compares the camera',
  'hotspot & travel', 'kids’ watch', 'family hero', 'bring her own phone', 'switch hero', 'upgrading', 'upgrade offer leads', 'two weeks pass',
  'black friday', 'pinned to container one', '5g home', 'montana', 'priced configuration', 'position one', 'two clicks'];
const NO = ['1', '2', '3', '4', '5', '6', '7', '8', '9a', '9b', '10a', '10b', '10c', '10d', '11', '12', '13', '14a', '14b', '15a', '15b', '15c'];

const snaps = [];
/** The named outcomes, press by press: lane L2's walkthrough, held to what is robust across runs. */
const OUTCOMES = {
  0: (S) => {
    ok('four containers on screen', S.deals.length === 4, titles(S).join(' | '));
    ok('the four answer the ad: the iPhone 18 Pro launch offer first', S.deals[0] && S.deals[0].title === TITLE[IDS.launch], S.deals[0] && S.deals[0].receipt);
    ok('the iPhone Duo pre-order second, on the New York lean', S.deals[1] && S.deals[1].title === TITLE[IDS.duo]);
    ok('the hero answers the ad: the launch hero, its receipt naming the campaign', S.hero.ok && S.hero.title === TITLE['hero-launch'] && has(S.hero.receipt, 'campaign +'),
      `${S.hero.title} · ${S.hero.receipt}`);
    ok('the arrival panel names New York, the grain, the census and the lean', S.cold.ok && ['New York', 'state', 'ACS 2024 1-year', '$85,820', 'synthetic → warehouse'].every((t) => has(S.cold.text, t)),
      S.cold.text.slice(0, 160));
    ok('and says the sentence: aggregate, never the individual; we curate, never price', has(S.cold.text, 'Aggregate, never the individual; we curate, never price.'));
    ok('an asserted region is labelled "region asserted, not observed", never "geo real"', has(S.cold.text, 'region asserted, not observed') && !has(S.cold.text, 'geo real'));
    ok('and the panel names it the rehearsal override, never the default', has(S.cold.text, 'rehearsal override') && has(S.ctx, 'rehearsal override'), S.ctx);
    ok('her own meters are empty: nothing about her is known yet', S.meters.length === 0 && has(S.vectorsText, 'No evidence of her own yet'));
  },
  1: (S) => {
    const was = snaps[0];
    ok('the same four, in a different order: only the region changed', JSON.stringify([...titles(S)].sort()) === JSON.stringify([...titles(was)].sort())
      && JSON.stringify(titles(S)) !== JSON.stringify(titles(was)), titles(S).join(' | '));
    ok('the Galaxy S26 offer second on the Texas lean', S.deals[1] && S.deals[1].title === TITLE['promo-galaxy-s26-new-line']);
    ok('the arrival panel names Texas and its census figure', S.cold.ok && has(S.cold.text, 'Texas') && has(S.cold.text, '$79,721'), S.cold.text.slice(0, 120));
    ok('the region is labelled as asserted', has(S.ctx, 'US-TX') && has(S.ctx, 'asserted'), S.ctx);
  },
  2: (S) => {
    ok('she is on the phones grid', S.view === 'viewPhones');
    const m = meter(S, 'samsung', 'brand');
    ok(`brand samsung past the ${THETA_IN} entry threshold on her meter`, m && m.a >= THETA_IN, m ? m.a.toFixed(2) : 'no samsung meter');
    ok('and its bar visibly crosses the threshold tick', m && m.tick !== null && m.fill >= m.tick, m ? `fill ${(m.fill * 100).toFixed(0)}% · tick ${(m.tick * 100).toFixed(0)}%` : '');
  },
  3: (S) => {
    ok('the Galaxy S26 offer leads the four', S.deals[0] && S.deals[0].title === TITLE['promo-galaxy-s26-new-line'], titles(S).join(' | '));
    ok('the lifted launch offer falls to fourth', S.deals[3] && S.deals[3].title === TITLE[IDS.launch]);
    ok('the receipt reads: campaign context superseded by observed behaviour', S.dealsChanges.deltas.some((d) => has(d, 'campaign context superseded by observed behaviour')),
      (S.dealsChanges.deltas.find((d) => has(d, 'superseded')) || '').slice(0, 170));
    ok('and the director says so', has(S.director.line, 'campaign context superseded by observed behaviour'));
    const m = meter(S, 'samsung', 'brand');
    ok(`brand samsung still above the ${THETA_OUT} exit threshold`, m && m.a >= THETA_OUT, m ? m.a.toFixed(2) : 'no meter');
  },
  4: (S) => {
    const m = meter(S, 'samsung', 'brand'), android = meter(S, 'android', 'ecosystem');
    ok(`the Samsung claim withdraws: brand samsung under ${THETA_OUT} on her meter`, m && m.a < THETA_OUT, m ? m.a.toFixed(2) : 'no meter');
    ok(`the Android lean holds, past ${THETA_IN}`, android && android.a >= THETA_IN, android ? android.a.toFixed(2) : 'no meter');
    const engine = S.dealsChanges.deltas.find((d) => has(d, 'the engine, on its own')) || '';
    ok('the strip names both: the claim withdrawn, the lean that holds', has(engine, 'claim withdrawn') && has(engine, 'holds'), engine.slice(0, 200));
    ok('the Galaxy S26 offer still leads', S.deals[0] && S.deals[0].title === TITLE['promo-galaxy-s26-new-line'], titles(S).join(' | '));
    info(S.rail.deltasOk ? `the rail re-sorted on the same answer: ${S.rail.deltas.slice(0, 4).join(' · ')}` : 'the rail held its order');
  },
  5: (S) => {
    ok('the phone page opens', S.view === 'viewPhone');
    ok('the buy box says off limits, on screen', S.offlimits.ok && has(S.offlimits.text, 'Off limits'), S.offlimits.text);
    ok('six modules below it', S.modules.length === 6, moduleTitles(S).join(' | '));
    ok('storage & memory and protection lead, on the band her browsing earned', [...moduleTitles(S).slice(0, 2)].sort().join('|') === ['Protect your phone', 'Storage & memory'].join('|'));
    const trade = S.modules.find((m) => m.title === TITLE['trade-in']);
    const lead = snaps[4] && snaps[4].deals[0] ? snaps[4].deals[0].title : '';
    ok('one decision on every surface: the trade-in module cites the offer the homepage led with', trade && has(trade.cite, 'The offer her homepage led with') && has(trade.cite, lead),
      trade ? trade.cite.slice(0, 140) : 'no trade-in module in the six');
  },
  6: (S) => {
    ok('storage & memory rises to first', moduleTitles(S)[0] === TITLE['storage-memory'], moduleTitles(S).join(' | '));
    ok('protection second, on the premium band', moduleTitles(S)[1] === TITLE.protection);
    ok('the storage maths, on screen: 512 GB at +$5.56/mo', S.maths.ok && has(S.maths.text, '+$5.56/mo'), S.maths.text.slice(0, 120));
  },
  7: (S) => {
    ok('pair with a plan rises to second', moduleTitles(S)[1] === TITLE['plan-pairing'], moduleTitles(S).join(' | '));
    ok('Unlimited More leads the plans', S.plans[0] && S.plans[0].name === 'Unlimited More', S.plans.map((p) => p.name).join(' | '));
  },
  8: (S) => {
    ok('watch, tablet and more lines rises to first', moduleTitles(S)[0] === TITLE['connected-devices'], moduleTitles(S).join(' | '));
    ok('the family starter, Unlimited Go, leads the plans', S.plans[0] && S.plans[0].name === 'Unlimited Go', S.plans.map((p) => p.name).join(' | '));
    ok('a household total appears: $112.00/mo for four lines', S.plans[0] && has(S.plans[0].hh, '$112.00/mo'), S.plans[0] && S.plans[0].hh);
  },
  9: (S) => {
    ok('the family hero leads the homepage', S.hero.title === TITLE['hero-family'], S.hero.title);
    ok('the four-line offer enters the four', titles(S).includes(TITLE[IDS.family]), titles(S).join(' | '));
  },
  10: (S) => {
    ok('back on the phone page', S.view === 'viewPhone');
    ok('Simple leads pair with a plan for the switcher', S.plans[0] && S.plans[0].name === 'Simple', S.plans.map((p) => p.name).join(' | '));
    ok('her answer is labelled as asserted', has(S.ctx, 'intent byod') && has(S.ctx, 'asserted'), S.ctx);
  },
  11: (S) => {
    ok('the switch hero leads', S.hero.title === TITLE['hero-switch'], S.hero.title);
    ok('bring your phone is in the four', titles(S).includes(TITLE[IDS.byod]), titles(S).join(' | '));
    ok('the watch-and-tablet line leads the four, on her added line and four lines', S.deals[0] && S.deals[0].title === TITLE['promo-watch-tablet-line']);
    ok('the iPhone Duo pre-order is not offered to someone bringing her own phone', !titles(S).includes(TITLE[IDS.duo]));
  },
  12: (S) => {
    ok('her answer flips to upgrade, labelled as asserted', has(S.ctx, 'intent upgrade') && has(S.ctx, 'asserted'), S.ctx);
    ok('Unlimited More leads for the trade-in shopper', S.plans[0] && S.plans[0].name === 'Unlimited More', S.plans.map((p) => p.name).join(' | '));
    // Protection is watched, not claimed (the lead's ruling after R1): whether it passes Pair with a plan depends on timing.
    const score = (snap) => { const m = snap && snap.modules.find((x) => x.title === TITLE.protection); const s = m && /score ([\d.]+)/.exec(m.receipt); return s ? Number(s[1]) : null; };
    info(`protection, watched: score ${score(snaps[10])} → ${score(S)}, position ${moduleTitles(snaps[10] || S).indexOf(TITLE.protection) + 1} → ${moduleTitles(S).indexOf(TITLE.protection) + 1}`
      + ` (Pair with a plan at ${moduleTitles(S).indexOf(TITLE['plan-pairing']) + 1})`);
  },
  13: (S) => {
    ok('the Galaxy S26 Ultra upgrade offer leads', S.deals[0] && S.deals[0].title === TITLE[IDS.upgradeAndroid], titles(S).join(' | '));
    ok('with its terms on screen: what it requires, what ends the credit', S.deals[0] && S.deals[0].terms);
    ok('and the director names the offer that leads', S.deals[0] && has(S.director.line, S.deals[0].title), S.director.line.slice(0, 160));
  },
  14: (S) => {
    ok('the Pixel 11 launch offer leaves: its window closed', !titles(S).includes(TITLE[IDS.closesAtBeat11]));
    ok('its successor takes container one', S.deals[0] && S.deals[0].title === TITLE[IDS.successorAtBeat11], titles(S).join(' | '));
    ok('her answer is back to a new line, labelled', has(S.ctx, 'intent new') && has(S.ctx, 'asserted'), S.ctx);
  },
  15: (S) => {
    ok('Black Friday takes container one on its metadata', S.deals[0] && S.deals[0].title === TITLE[IDS.blackFriday], titles(S).join(' | '));
  },
  16: (S) => {
    ok('the iPhone Duo pre-order is pinned in container one', S.deals[0] && S.deals[0].title === TITLE[IDS.duo] && has(S.deals[0].pin, 'ranking skipped'), S.deals[0] && S.deals[0].pin);
    ok('the other three still ranked for her, Black Friday second', S.deals[1] && S.deals[1].title === TITLE[IDS.blackFriday] && S.deals.slice(1).every((d) => !d.pin));
  },
  17: (S) => {
    ok('on the phone page in New York', S.view === 'viewPhone' && has(S.ctx, 'US-NY'));
    const at = moduleTitles(S).indexOf(TITLE['home-bundle']);
    ok('add home internet is eligible and rises to the top two on her address check', at > -1 && at < 2, `at ${at + 1}`);
    const bundle = S.modules.find((m) => m.title === TITLE['home-bundle']);
    ok('with the chip: the region is served, no address used', bundle && has(bundle.covered, 'is served') && has(bundle.covered, 'no address used'), bundle && bundle.covered);
  },
  18: (S) => {
    ok('asserted in Montana', has(S.ctx, 'US-MT'), S.ctx);
    ok('add home internet leaves the six', !moduleTitles(S).includes(TITLE['home-bundle']), moduleTitles(S).join(' | '));
  },
  19: (S) => {
    ok('the continue hero: her selections, nothing inferred', has(S.hero.label, 'your selections, nothing inferred'), S.hero.label);
    ok('her priced configuration: Galaxy S26, 512 GB, four lines on Unlimited More, $198.55 a month',
      S.hero.rows.some((r) => has(r, 'Galaxy S26 · 512 GB')) && S.hero.rows.some((r) => has(r, '4 lines · Unlimited More')) && S.hero.rows.some((r) => has(r, '$198.55')),
      S.hero.rows.join(' / ').slice(0, 200));
  },
  20: (S) => {
    ok('the deals module renders first: its box sits above the hero', S.focus.deals.ok && S.focus.hero.ok && S.focus.deals.top < S.focus.hero.top,
      `deals top ${S.focus.deals.top} · hero top ${S.focus.hero.top}`);
    ok('and the four did not change: same four, same order', JSON.stringify(titles(S)) === JSON.stringify(titles(snaps[19])), titles(S).join(' | '));
  },
  21: (S) => {
    const block = (prefix) => S.report.blocks.find((b) => b.label.toLowerCase().startsWith(prefix)) || { rows: 0, empty: 'no such block' };
    const deals = block('attribution per promotion'), modules = block('module engagement');
    const why = (b) => (/\(413\)|\b413\b|too large|budget/i.test(b.empty)
      ? `refused (“${b.empty.slice(0, 120)}”): with no hour folded the day is read raw, past REPORT_LIMITS.rawBytes; fold with the cron (RESUME-vantage.md)` : b.empty);
    const windowLine = (S.report.text.match(/Window\s*the UTC day[^·]*·[^·]*/) || [''])[0];
    ok('the report states its own window: the UTC day and what it was read from', has(S.report.text, 'Window') && has(S.report.text, 'the UTC day'), windowLine.slice(0, 160));
    ok('the report is on screen: attribution per promotion, with rows', S.report.ok && deals.rows > 0, deals.rows ? `${deals.rows} rows` : why(deals));
    ok('and per module: module engagement on the phone page', modules.rows > 0, modules.rows ? `${modules.rows} rows` : why(modules));
    ok('labelled attribution, not incrementality', has(S.report.text, 'Attribution, not incrementality.') && has(S.report.text, 'attribution_diagnostic'));
  },
};

/** Legible: the press either shows its before and now on the surface it is about, or (on the phones grid) moves a meter. */
function legible(i, S) {
  if (S.view === 'viewHome') {
    return ok(`↳ ${NO[i]} is legible: the before/now row is filled`, S.dealsChanges.ok && S.dealsChanges.deltas.length > 0 && S.dealsChanges.deltas.every((d) => d.length > 0)
      && (S.dealsChanges.ghosts > 0 || has(S.dealsChanges.before, 'had not seen the module')),
      S.dealsChanges.deltas.slice(0, 2).join(' · ').slice(0, 170));
  }
  if (S.view === 'viewPhone') {
    return ok(`↳ ${NO[i]} is legible: the before/now row is filled`, S.pdpChanges.ok && S.pdpChanges.deltas.length > 0 && S.pdpChanges.before.length > 0,
      S.pdpChanges.deltas.slice(0, 2).join(' · ').slice(0, 170));
  }
  // The phones grid has no module of its own: what moved is her meters.
  return ok(`↳ ${NO[i]} is legible: off the homepage, her meters moved`, S.meters.length > 0, S.meters.slice(0, 3).map((m) => `${m.value} ${m.a.toFixed(2)}`).join(' · '));
}

// ── Compare: the demo kit's overlay (lane C1) ─────────────────────────────────
const NO_FRAME = 'No earlier frame yet: the first page is still being captured. Act, then Compare.';
const fmtBox = (b) => (b ? `${b.w}×${b.h}` : 'none');
const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const framesUp = "window.__l5.vis('#cmp-canvas').ok";
const toolDone = `${framesUp} && /done/.test(document.getElementById('status').textContent)`;
/** Installed before a direct phone-page load: Compare is pressed the instant the page says ready, while its
    first decided paint is still in flight (the status flips to ready just before the page asks the engine). */
const FIRST_PAINT_PRESS = `(() => {
  const arm = () => {
    const s = document.getElementById('status');
    if (!s) return false;
    const obs = new MutationObserver(() => {
      if (!/^ready/.test(s.textContent) || window.__c1press) return;
      obs.disconnect();
      window.__c1press = { at: Date.now(), decided: document.querySelectorAll('#modules > .pmod[data-op-decision-id]:not([data-op-decision-id=""])').length };
      document.getElementById('compareBtn').click();
    });
    obs.observe(s, { childList: true, characterData: true, subtree: true });
    return true;
  };
  if (!arm()) document.addEventListener('DOMContentLoaded', arm, { once: true });
})();`;
/** --shots <dir>: the view on screen, as a PNG. */
async function shoot(name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const r = await cdp('Page.captureScreenshot', { format: 'png' });
  const file = join(SHOTS, `C1-${WIDTH}-${name}.png`);
  writeFileSync(file, Buffer.from(r.data, 'base64'));
  info(`screenshot ${file}`);
}
async function closeCompare() {
  await evaluate("document.getElementById('cmp-close').click()");
  await sleep(300);
  return !(await evaluate("window.__l5.vis('#cmp-back').ok"));
}
/** The Before the kit holds now: when it was cloned, and its label. */
const kitBefore = () => evaluate("window.__vantage.compare().then((k) => k.baselineInfo() && { at: k.baselineInfo().at, label: k.baselineInfo().label })");
const firstPaintCaptures = [];
const phonesDoc = await (await fetch(`${base}/vantage/phones.json`)).json();
const phoneName = (id) => ((phonesDoc.phones || []).find((p) => p.id === id) || {}).name || id;

const port = await devtoolsPort();
try {
  await connect(port);
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
  await cdp('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(base).hostname);
  const OVERRIDE = (anchor.regions && anchor.regions.first) || 'US-NY';
  const booted = () => waitFor("/^ready|error|missing|failed/i.test((document.getElementById('status') || {}).textContent || '')", 30000);
  console.log(`\nVantage DOM rehearsal against ${base} at ${WIDTH}×${HEIGHT} in ${CHROME.split(/[\\/]/).pop()}`);

  {
    // Beat 1 as the page runs by default, with no ?region=: the region must come from the request.
    const plain = `${base}/vantage/?debug=1`;
    console.log(`\n── 1 without the override: ${plain}`);
    press = 'edge';
    await cdp('Page.navigate', { url: plain });
    const up = await booted();
    await evaluate(`(${pageHelpers.toString()})()`);
    const landed = up ? await evaluate("(async () => { const run = window.__vantage.go(0); if (run === undefined) return 'busy'; await run; return document.getElementById('status').textContent; })()") : 'the page did not boot';
    await sleep(SETTLE_MS);
    const S = await evaluate('window.__l5.snapshot()');
    const asked = [...requests.values()].filter((r) => r.press === 'edge' && /\/decisions\/snapshot/.test(r.path));
    const panelReads = [...requests.values()].filter((r) => r.press === 'edge' && /\/vantage\/api\/coldstart/.test(r.path));
    ok('beat 1 lands without the override', landed === 'done', landed);
    const fromRequest = has(S.cold.text, 'from the request') && (LOOPBACK ? has(S.cold.text, 'local runtime') : has(S.cold.text, 'the edge located her') && has(S.cold.text, 'geo real'));
    const none = has(S.cold.text, 'no region on this request') && has(S.cold.text, 'national');
    ok(`the panel says the region comes from the request${LOOPBACK ? ' (locally: as the runtime fills request.cf, not an edge)' : ''}, or that there is none`,
      S.cold.ok && (fromRequest || none) && !has(S.cold.text, 'asserted, not observed') && !has(S.cold.text, 'rehearsal override'), S.cold.text.slice(0, 220));
    ok('no snapshot and no panel read asserted a region', asked.length > 0 && panelReads.length > 0
      && asked.every((r) => !/[?&]ctx\.region=/.test(r.url)) && panelReads.every((r) => !/[?&]region=/.test(r.url)), `${asked.length} snapshot(s), ${panelReads.length} panel read(s)`);
    info(`hero “${S.hero.title}” · deals ${titles(S).join(' | ')} · ${S.ctx}`);
  }

  {
    // Compare during the first paint (lane C1). A direct load of the phone page is a real arrival on it: the
    // page decides it live for a direct visitor. Compare is pressed the instant the page says ready, while
    // that first decided paint is still in flight, so there is no earlier frame yet.
    const focus = anchor.focusPhone || 'galaxy-s26';
    const direct = `${base}/vantage/phone?id=${encodeURIComponent(focus)}&debug=1&region=${OVERRIDE}`;
    console.log(`\n── Compare during the first paint: ${direct}`);
    press = 'first-paint';
    const { identifier } = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: FIRST_PAINT_PRESS });
    await cdp('Page.navigate', { url: direct });
    await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    await booted();
    await evaluate(`(${pageHelpers.toString()})()`);
    const up = await waitFor("window.__l5.vis('#cmp-back').ok", 15000);
    const F = await evaluate('({ pressed: window.__c1press || null, compare: window.__l5.snapshot().compare })');
    ok('Compare pressed during the first paint opens the overlay on the message, not nothing', up && F.pressed && F.pressed.decided === 0 && F.compare.msg === NO_FRAME,
      `${F.compare.msg || 'no overlay'}${F.pressed ? ` · ${F.pressed.decided} decided module(s) on the page at the press` : ''}`);
    ok('and nothing else: no frame, no tag, no view to switch to', F.compare.ok && !F.compare.frames.before && !F.compare.frames.now && !F.compare.tags.before && !F.compare.tags.now && F.compare.mode === null);
    ok('the message closes', await closeCompare());
    const before = await waitFor("window.__vantage.compare().then((k) => k.hasBaseline())", 20000);
    const T = await evaluate("window.__vantage.compare().then((k) => ({ title: document.getElementById('compareBtn').title, caps: k.timings().filter((x) => x.kind === 'baseline') }))");
    ok('once the phone page’s first decided paint settles, a Before exists, and Compare’s title names it', before
      && new RegExp(`^Before: ${phoneName(focus)} page at \\d\\d:\\d\\d, Shopper A$`).test(T.title), T.title);
    firstPaintCaptures.push(...T.caps);
    if (T.caps[0]) info(`that Before: ${T.caps[0].w}×${T.caps[0].h}, cloned ${T.caps[0].wait} ms after it started, the frame ready in ${T.caps[0].total} ms`);
  }

  const url = `${base}/vantage/?debug=1&wait=${WAIT}&region=${OVERRIDE}`;
  console.log(`\n── The walk, with the rehearsal override: ${url}`);
  press = -1;
  await cdp('Page.navigate', { url });

  console.log('\n── The page loads, and asks for no credential');
  const ready = await booted();
  await evaluate(`(${pageHelpers.toString()})()`);
  const boot = await evaluate('window.__l5.snapshot()');
  ok('the page loaded its content and the engine documents', ready && /^ready/.test(boot.status), boot.status.slice(0, 160));
  ok('the director hook is exposed under ?debug=1', await evaluate('typeof (window.__vantage || {}).go === "function"'));
  const beats = await evaluate('window.__vantage.beats().map((b) => b.no)');
  ok(`the director lists the 22 presses of the fifteen beats (${beats.length})`, JSON.stringify(beats) === JSON.stringify(NO), beats.join(' '));
  ok('before anyone arrives, the site’s own four are on screen, labelled', boot.deals.length === 4 && boot.deals.every((d) => has(d.receipt, 'the site’s own default')),
    boot.deals.map((d) => d.title).join(' | '));
  ok('the director’s opening sentence is on screen', boot.director.lineOk && boot.director.line.length > 20, boot.director.line.slice(0, 90));
  ok('no horizontal overflow', boot.overflow <= 1, `${boot.overflow}px`);
  ok('the page can scroll clear of the director bar', await evaluate(`(() => { const d = document.querySelector('.director'); return d && parseFloat(getComputedStyle(document.body).paddingBottom) >= d.getBoundingClientRect().height - 1; })()`));
  // Compare (lane C1): always enabled, its title naming the Before it would show; with none yet, it says so.
  const compareTitles = () => evaluate(`(() => { const t = document.querySelector('#compareTools button[data-tool="compare"]'), m = document.getElementById('compareBtn');
    return { main: m.title, tool: t ? t.title : '', disabled: m.disabled || !t || t.disabled }; })()`);
  const T0 = await compareTitles();
  ok('every Compare button is enabled, its title saying there is no Before yet', !T0.disabled && T0.main === 'Before: none yet. Act, then Compare.' && T0.tool === T0.main, T0.main);
  await evaluate("document.getElementById('compareBtn').click()");
  await waitFor("window.__l5.vis('#cmp-back').ok", 10000);
  const M0 = (await evaluate('window.__l5.snapshot()')).compare;
  ok('Compare before any frame exists opens the overlay on the message, not nothing', M0.ok && M0.msg === NO_FRAME && !M0.frames.before && !M0.frames.now, M0.msg);
  ok('and that message closes', await closeCompare());

  for (let i = 0; i < NO.length; i += 1) {
    press = i;
    console.log(`\n── ${NO[i]} · ${await evaluate(`(() => { const b = window.__vantage.beats()[${i}]; return typeof b.label === 'function' ? b.label() : b.label; })()`)}`);
    const t0 = Date.now();
    const landed = await evaluate(`(async () => { const run = window.__vantage.go(${i}); if (run === undefined) return 'busy'; await run; return document.getElementById('status').textContent; })()`);
    const beatMs = Date.now() - t0;   // the press itself, from go() to its landing (the line's first figure adds the settle and the waits)
    await sleep(SETTLE_MS);
    let S = await evaluate('window.__l5.snapshot()');
    if (i === 0) {
      // The hero's campaign line is drawn from its receipt, which the ledger writes a few seconds after the answer.
      await waitFor("/campaign \\+/.test(window.__l5.snapshot().hero.receipt)", 25000);
      S = await evaluate('window.__l5.snapshot()');
    }
    if (i === 3) {
      // The hinge is said only once the receipts say it. The strip can draw it at once from beat 2's launch
      // receipt; the director's sentence waits for this press's own receipts, which the ledger writes a few
      // seconds after the answer (the page asks every 2 s, ten times). Wait for both.
      await waitFor("(() => { const s = window.__l5.snapshot(); return s.dealsChanges.deltas.some((d) => /campaign context superseded/i.test(d))"
        + " && /campaign context superseded/i.test(s.director.line); })()", 30000);
      S = await evaluate('window.__l5.snapshot()');
    }
    snaps[i] = S;
    info(`${((Date.now() - t0) / 1000).toFixed(1)} s (the press ${(beatMs / 1000).toFixed(1)} s) · ${S.view} · ${S.view === 'viewPhone' ? `modules ${moduleTitles(S).join(' | ')} · plans ${S.plans.map((p) => p.name).join(' | ')}`
      : S.view === 'viewHome' ? `hero “${S.hero.title || S.hero.label}” · deals ${titles(S).join(' | ')}` : `meters ${S.meters.slice(0, 4).map((m) => `${m.value} ${m.a.toFixed(2)}`).join(' · ')}`}`);
    ok(`↳ ${NO[i]}: the press landed`, landed === 'done', landed);
    // Every performed beat starts with a Before (lane C1), cloned as the press lands, before the beat acts;
    // it renders once the beat has landed.
    await waitFor(`window.__vantage.compare().then((k) => { const b = k.baselineInfo(); return Boolean(b && b.at >= ${t0 - 500}); })`, 8000);
    const bf = await kitBefore();
    ok(`↳ ${NO[i]}: a Before was taken as the press landed`, bf && bf.at >= t0 - 500 && bf.at <= t0 + 5000, bf ? `${bf.label} · cloned ${bf.at - t0} ms after the press` : 'no Before');
    const refused = refusedIn(i);
    ok(`↳ ${NO[i]}: the decision service answered`, !S.down.deals && !S.down.modules && refused.length === 0,
      [S.down.text, ...refused].filter(Boolean).join(' ~ ').slice(0, 220));
    ok(`↳ ${NO[i]}: the director’s sentence is on screen`, S.director.lineOk && has(S.director.line, LINE[i]) && has(S.director.beatNo, `Beat ${NO[i]} / 15`),
      `${S.director.beatNo} · ${S.director.line.slice(0, 90)}`);
    legible(i, S);
    ok(`↳ ${NO[i]}: the surface it is about is on screen`, S.view === 'viewHome' ? (S.focus.deals.inView || S.focus.hero.inView || S.focus.rail.inView)
      : S.view === 'viewPhone' ? (S.focus.modules.inView || S.focus.buybox.inView) : true);
    ok(`↳ ${NO[i]}: no horizontal overflow, no broken image`, S.overflow <= 1 && S.broken.length === 0, `${S.overflow}px · ${S.broken.join(', ')}`);
    OUTCOMES[i](S);

    if (i === 0) {
      // Compare with no Capture pressed (lane C1): the Before is the frame taken as beat 1 landed, the page before she arrived.
      console.log('   · Compare, with no Capture pressed');
      const T = await compareTitles();
      ok('every Compare button is enabled, and its title names the Before', !T.disabled && /^Before: homepage at \d\d:\d\d, nobody yet$/.test(T.main) && T.tool === T.main, T.main);
      const addr = await evaluate('location.pathname + location.search');
      await evaluate("window.scrollTo(0, 0); document.getElementById('compareBtn').click()");
      const up = await waitFor(framesUp, 20000);
      await sleep(400);
      let C = (await evaluate('window.__l5.snapshot()')).compare;
      const px = await evaluate('window.__l5.framePixels()');
      ok('Compare on the homepage opens the overlay on the Seam', up && C.ok && C.mode === 'seam', C.title);
      ok('with two frames of non-zero size, each a whole page of real pixels', C.frames.before && C.frames.now && C.frames.before.w > 0 && C.frames.before.h > 0 && C.frames.now.w > 0 && C.frames.now.h > 0
        && px.before && px.now && px.before.w > 0 && px.before.h > 0 && px.now.w > 0 && px.now.h > 0,
        `on screen ${fmtBox(C.frames.before)} · ${fmtBox(C.frames.now)}; pixels ${fmtBox(px.before)} · ${fmtBox(px.now)}`);
      ok('tagged Before and Now, each with its time, where and who', /^Before · \d\d:\d\d · homepage · nobody yet$/i.test(C.tags.before) && /^Now · \d\d:\d\d · homepage · Shopper A$/i.test(C.tags.now),
        `${C.tags.before} | ${C.tags.now}`);
      ok('the footer sentence stays: same page, same catalog, same buy box, same public prices', has(C.caption, 'Same page, same catalog, same buy box and the same public prices'), C.caption.slice(0, 90));
      await shoot('01-seam');
      // The seam, dragged with a real mouse through the DevTools protocol, then nudged with the arrow key.
      const r = await evaluate("(() => { const b = document.getElementById('cmp-stage').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()");
      const y = Math.round(r.y + Math.min(r.h / 2, 300)), x = (f) => Math.round(r.x + r.w * f);
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x(0.5), y });
      await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: x(0.5), y, button: 'left', buttons: 1, clickCount: 1 });
      for (const f of [0.44, 0.37, 0.3, 0.25]) await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x(f), y, button: 'left', buttons: 1 });
      await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x(0.25), y, button: 'left', buttons: 0, clickCount: 1 });
      const seamDragged = (await evaluate('window.__l5.snapshot()')).compare.seam;
      await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
      await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
      const seamNudged = (await evaluate('window.__l5.snapshot()')).compare.seam;
      ok('dragging the seam moves it: the seam variable follows the pointer', parseFloat(C.seam) === 50 && Math.abs(parseFloat(seamDragged) - 25) < 1.5, `${C.seam} → ${seamDragged}`);
      ok('and the arrow keys nudge it', Math.abs(parseFloat(seamNudged) - parseFloat(seamDragged) - 2) < 0.01, `${seamDragged} → ${seamNudged}`);
      await evaluate("document.getElementById('cmp-mode-split').click()");
      await sleep(400);
      C = (await evaluate('window.__l5.snapshot()')).compare;
      ok('Side by side shows two panes, each a whole page, and no seam', C.mode === 'split' && C.panes.length === 2 && C.panes.every((p) => p.w > 100 && p.h > 100) && !C.frames.before && !C.frames.now,
        C.panes.map((p) => `${fmtBox(p)} ${p.tag}`).join(' | '));
      await shoot('02-side-by-side');
      await evaluate("document.getElementById('cmp-mode-details').click()");
      await sleep(400);
      C = (await evaluate('window.__l5.snapshot()')).compare;
      const [l, rt] = C.cols;
      ok('What changed shows two columns: the decided state behind the Before and the Now', C.mode === 'details' && C.cols.length === 2 && has(l.kicker, 'Before') && has(rt.kicker, 'Now')
        && has(l.head, 'nobody yet') && has(rt.head, 'Shopper A'), C.cols.map((c) => c.head).join(' | '));
      ok('the site’s own four on the left, her opening four on the right, as the page shows them', l && rt && (l.lists[1] || []).length === 4 && (l.lists[1] || []).every((t) => has(t, '(the site’s own)'))
        && sameJSON(rt.lists[1], titles(S)), `${(l.lists[1] || []).join(' | ').slice(0, 120)} → ${(rt.lists[1] || []).join(' | ')}`);
      await shoot('03-what-changed');
      ok('Compare closes, and the address bar is unchanged', await closeCompare() && (await evaluate('location.pathname + location.search')) === addr);

      // Fresh visitor on the homepage (lane C1): her page is the Before; a stranger's decided set, same region,
      // no event, is the Now; then her page and address come back from state.
      console.log('   · Fresh visitor, on the homepage');
      const her0 = await evaluate('window.__l5.mine()');
      press = 'fresh-home';
      await evaluate(`document.querySelector('#compareTools button[data-tool="fresh"]').click()`);
      const fresh = await waitFor(toolDone, 30000);
      await sleep(400);
      C = (await evaluate('window.__l5.snapshot()')).compare;
      const fpx = await evaluate('window.__l5.framePixels()');
      ok('Fresh visitor on the homepage opens the overlay on two frames of non-zero size', fresh && C.ok && C.mode === 'seam' && C.frames.before && C.frames.now
        && fpx.before && fpx.now && fpx.before.w > 0 && fpx.before.h > 0 && fpx.now.w > 0 && fpx.now.h > 0, `${C.title} · pixels ${fmtBox(fpx.before)} · ${fmtBox(fpx.now)}`);
      ok('tagged “Her page” and “A fresh visitor, same region”', /^Her page · \d\d:\d\d · homepage · Shopper A$/i.test(C.tags.before)
        && /^A fresh visitor, same region · \d\d:\d\d · homepage · Fresh visitor$/i.test(C.tags.now), `${C.tags.before} | ${C.tags.now}`);
      await shoot('04-fresh-visitor-home');
      await evaluate("document.getElementById('cmp-mode-details').click()");
      await sleep(300);
      C = (await evaluate('window.__l5.snapshot()')).compare;
      ok('What changed shows her four beside the fresh visitor’s, in two columns', C.cols.length === 2 && has(C.cols[0].head, 'Shopper A · homepage') && has(C.cols[1].head, 'Fresh visitor · homepage')
        && C.cols.every((c) => (c.lists[1] || []).length === 4), C.cols.map((c) => `${c.head}: ${(c.lists[1] || []).join(' | ')}`).join(' ~ ').slice(0, 260));
      const sent = [...requests.values()].filter((q) => q.press === 'fresh-home');
      ok('the fresh visitor sent no event: no call to /realtime/action, one snapshot for her page', sent.every((q) => !/^\/realtime\/action/.test(q.path))
        && sent.filter((q) => /\/decisions\/snapshot/.test(q.path)).length === 1, sent.map((q) => `${q.method} ${q.path}`).join(' · '));
      ok('the Compare panel closes', await closeCompare());
      await sleep(300);
      const her1 = await evaluate('window.__l5.mine()');
      const moved = ['view', 'hero', 'order', 'deals', 'rail', 'dealsRow'].filter((k) => !sameJSON(her0[k], her1[k]));
      ok('after it closes her homepage is hers: the hero, the module order, the four in order, the rail, the before/now row', moved.length === 0,
        moved.length ? moved.map((k) => `${k}: ${JSON.stringify(her0[k]).slice(0, 80)} → ${JSON.stringify(her1[k]).slice(0, 80)}`).join(' ~ ') : `${her1.order.join(' > ')} · ${her1.deals.join(' | ')}`);
      ok('her visitor is unchanged', her1.who === her0.who && has(her1.who, 'Shopper A'), her1.who);
      ok('and the address bar is unchanged', her1.url === her0.url, her1.url);
      press = i;
    }

    if (i === 5 || i === 7) {
      // The Compare tool, where the script uses it: a fresh visitor beside her at beat 6, the streaming shopper at beat 8.
      // Each opens on its two frames (lane C1); the decided-state columns are its What changed view.
      const tool = i === 5 ? 'fresh' : 'streaming';
      const her0 = await evaluate('window.__l5.mine()');
      await evaluate(`document.querySelector('#compareTools button[data-tool="${tool}"]').click()`);
      const up = await waitFor(toolDone, 40000);
      await sleep(400);
      const P = (await evaluate('window.__l5.snapshot()')).compare;
      const ppx = await evaluate('window.__l5.framePixels()');
      const nowTag = tool === 'fresh' ? 'A fresh visitor, same region · \\d\\d:\\d\\d · .+ page · Fresh visitor' : 'The streaming shopper · \\d\\d:\\d\\d · .+ page · Shopper B';
      ok(`Compare → ${tool === 'fresh' ? 'Fresh visitor' : 'Streaming shopper'} on the phone page opens on two frames of non-zero size, tagged`, up && P.mode === 'seam' && ppx.before && ppx.now
        && ppx.before.h > 0 && ppx.now.h > 0 && /^Her page · \d\d:\d\d · .+ page · Shopper A$/i.test(P.tags.before) && new RegExp(`^${nowTag}$`, 'i').test(P.tags.now), `${P.tags.before} | ${P.tags.now}`);
      await evaluate("document.getElementById('cmp-mode-details').click()");
      await sleep(300);
      const C = await evaluate('window.__l5.snapshot()');
      const [left, right] = C.compare.cols;
      if (tool === 'fresh') {
        ok('Compare → Fresh visitor: two columns, side by side', C.compare.ok && C.compare.cols.length === 2, C.compare.title);
        ok('the fresh visitor opens on the region’s premium lean, not the template', right && [...(right.lists[0] || []).slice(0, 2)].sort().join('|') === ['Protect your phone', 'Storage & memory'].join('|'),
          right ? (right.lists[0] || []).join(' | ') : '');
      } else {
        ok('Compare → Streaming shopper: two columns, side by side', C.compare.ok && C.compare.cols.length === 2, C.compare.title);
        ok('Unlimited More leads for her; Unlimited Max for the streaming shopper', left && right && (left.lists[1] || [])[0] === 'Unlimited More' && (right.lists[1] || [])[0] === 'Unlimited Max',
          `${left ? (left.lists[1] || [])[0] : '?'} · ${right ? (right.lists[1] || [])[0] : '?'}`);
      }
      ok('the Compare panel closes', await closeCompare());
      await sleep(300);
      const her1 = await evaluate('window.__l5.mine()');
      const moved = ['view', 'modules', 'plans', 'pdpRow', 'who', 'url'].filter((k) => !sameJSON(her0[k], her1[k]));
      ok('after it closes her phone page is hers: the modules, the plans, the before/now row, her visitor and the address bar', moved.length === 0,
        moved.length ? moved.map((k) => `${k}: ${JSON.stringify(her0[k]).slice(0, 80)} → ${JSON.stringify(her1[k]).slice(0, 80)}`).join(' ~ ') : her1.url);
      const address = await evaluate("location.pathname + (new URLSearchParams(location.search).get('id') ? `?id=${new URLSearchParams(location.search).get('id')}` : '')");
      info(`the address bar after Compare: ${address}${tool === 'streaming' && !/galaxy-s26$/.test(address) ? ' (the second shopper’s page, not hers)' : ''}`);
    }
    if (i === 7) {
      // Capture (lane C1): the press itself starts the frame (the kit's armed press), and it replaces the Before.
      const b0 = await kitBefore();
      const tPress = Date.now();
      await evaluate(`document.querySelector('#compareTools button[data-tool="capture"]').click()`);
      const busy = await evaluate("document.getElementById('captureBtn').classList.contains('cmp-busy')");
      await waitFor("!document.getElementById('captureBtn').classList.contains('cmp-busy')", 15000);
      await sleep(300);
      const b1 = await kitBefore();
      const noteText = await evaluate("window.__l5.txt('#captureNote')");
      const T = await compareTitles();
      ok('Capture: the press itself is the capture, and it replaces the Before', busy && b0 && b1 && b1.at > b0.at && b1.at >= tPress - 100, b1 ? `${b1.label} · cloned ${b1.at - tPress} ms after the press` : 'no Before');
      ok('Capture’s note says what it captured, and Compare’s title names the new Before', /^Captured Shopper A on the .+ page at /.test(noteText)
        && /^Before: .+ page at \d\d:\d\d, Shopper A$/.test(T.main) && T.tool === T.main, `${noteText.slice(0, 70)} · ${T.main}`);
    }
    if (i === 8 && snaps[7]) {
      // After the streaming shopper, her own before row must still be hers, not the second shopper's.
      const hers = snaps[7].modules.map((m) => m.title);
      known('↳ 9a’s before row is her own beat-8 page, not the streaming shopper’s', JSON.stringify(S.pdpChanges.before) === JSON.stringify(hers),
        `before ${S.pdpChanges.before.join(' | ')} · hers ${hers.join(' | ')}`, 'lane L2 (vantage.js streamingShopper)');
    }
  }

  console.log(`\n── The Before captures (lane C1), measured at ${WIDTH}×${HEIGHT}`);
  {
    // From the press to the clone is what a beat waits for; from the press to the frame is when Compare can show it.
    const caps = [...firstPaintCaptures, ...(await evaluate('window.__vantage.compare().then((k) => k.timings())'))].filter((x) => x.kind === 'baseline');
    const median = (a) => { const s = [...a].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : null; };
    const phones = (phonesDoc.phones || []).map((p) => `${p.name} page · `);
    const onHome = (x) => /^homepage · /.test(x.label), onPhone = (x) => phones.some((p) => x.label.startsWith(p));
    const groups = [['the homepage', onHome], ['a phone page', onPhone], ['the phones grid and content pages', (x) => !onHome(x) && !onPhone(x)]];
    for (const [name, test] of groups) {
      const list = caps.filter(test);
      if (!list.length) continue;
      const work = list.map((x) => x.render + x.encode);
      info(`${name}: ${list.length} Before frame(s), ${list[0].w}×${median(list.map((x) => x.h))} px · cloned a median ${median(list.map((x) => x.wait))} ms after it started (max ${Math.max(...list.map((x) => x.wait))}), all a press waits for`
        + ` · then rendered and encoded in a median ${median(work)} ms (max ${Math.max(...work)}; render ${median(list.map((x) => x.render))}, encode ${median(list.map((x) => x.encode))}),`
        + ` ${list.filter((x) => x.held > 0).length} of them after their beat landed`);
    }
  }

  console.log('\n── The wire, for the whole walk');
  const all = [...requests.values()];
  const api = all.filter((r) => !/^\/(content|config|ops)\//.test(r.path));
  const noTenant = api.filter((r) => header(r, 'X-Tenant') !== 'vantage');
  ok(`every API call the page made carried X-Tenant: vantage (${api.length} calls)`, noTenant.length === 0, noTenant.slice(0, 4).map((r) => `${r.method} ${r.path}`).join(' ~ '));
  ok('the page made no /content, /config or /ops call of its own', all.every((r) => !/^\/(content|config|ops)\//.test(r.path)),
    all.filter((r) => /^\/(content|config|ops)\//.test(r.path)).map((r) => r.path).join(' ~ '));
  ok('no request carried an Authorization header', all.every((r) => !header(r, 'Authorization')));
  const byPath = {};
  for (const r of api) { const k = r.path.replace(/\/v1\/vantage\/decisions\/snapshot.*/, '/v1/vantage/decisions/snapshot'); byPath[k] = (byPath[k] || 0) + 1; }
  info(Object.entries(byPath).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} ×${n}`).join(' · '));
  ok('no script error in the page', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' ~ '));
} catch (error) {
  failures += 1;
  console.log(`   ✗ the walk threw at press ${press + 1}: ${error.message}`);
} finally {
  console.log('\n── The tenant is left at its opening state');
  try {
    const res = await fetch(`${base}/vantage/api/reset`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Tenant': 'vantage' }, body: '{}' });
    const out = await res.json().catch(() => ({}));
    ok('POST /vantage/api/reset republishes the opening slots, then the opening catalog', out.ok === true && (out.applied || []).map((x) => x.name).join(',') === 'open-slots,open-catalog');
  } catch (error) { ok('POST /vantage/api/reset', false, error.message); }
  try { ws && ws.close(); } catch { /* closing */ }
  await closeBrowser(port);
}

const tail = defects.length ? ` · ${defects.length} known page defect${defects.length === 1 ? '' : 's'} printed above (${defects.map((d) => d.replace(/^↳ /, '')).join('; ')})` : '';
console.log(`\n${failures ? `✗ ${failures} of ${failures + passes} check(s) failed: do not hand this over${tail}` : `✓ ${passes} checks: the real page runs every press, and every effect has a visible cause${tail}`}`);
process.exit(failures ? 1 : 0);
