// scripts/demo-kit/lib/cdp.mjs — a demo's DOM suite: the real page in headless Chrome, over the DevTools protocol.
//
// Lifted from scripts/rehearse-vantage-dom.mjs (lane K3, part c; docs/demo-kit/Demo-Kit-Design.md §2.3), so that
// a demo's DOM suite holds only its outcomes. What it gives a suite:
//
//   • Chrome or Edge, found where it is installed (or --chrome, or CHROME_PATH), launched headless with a FRESH
//     PROFILE OF ITS OWN under the OS temp directory on every run (two runs sharing one profile collided at
//     launch, R1 2026-09-30; nothing here deletes anything), at the suite's viewport, and closed through the
//     protocol at the end (launchChrome, findChrome, parseSize).
//   • What a person sees (visibility, pageReaders, inPage): an element is visible only when no ancestor is
//     display: none, visibility: hidden or collapse, or opacity 0, and it has a real layout box. Every claim a
//     suite makes is read that way, off computed style and layout, never an attribute or a hidden flag. The
//     predicate is plain JavaScript over a window, so it runs in the page and in a test on a fixture DOM.
//   • The wire audit (recordWire, auditWire, checkDemoRouteBodies, tallyWire, checkScriptErrors): every request
//     the page makes to the API, tagged with the press it belongs to; every API call must carry X-Tenant, none
//     may go to /content, /config or /ops, none may carry Authorization, a beat goes by name with no document,
//     and the page must throw no script error.
//   • --shots <dir> (screenshotter), the press-to-landing timer (pressTimer) and the capture-timing summary of
//     the kit's Compare frames (captureTimingLines).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── The browser ───────────────────────────────────────────────────────────────

/** Where Chrome or Edge is installed, in the order they are tried after --chrome and CHROME_PATH. */
export const CHROME_CANDIDATES = Object.freeze([
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']);

/** The first browser that exists: the explicit ones first (--chrome, CHROME_PATH), then the candidates; null when none. */
export function findChrome(explicit = [], { exists = existsSync, candidates = CHROME_CANDIDATES } = {}) {
  return [...explicit, ...candidates].filter(Boolean).find((p) => exists(p)) || null;
}

/** "1440x900" → [1440, 900]. */
export const parseSize = (size) => String(size).split('x').map(Number);

/**
 * Chrome, headless, with a fresh profile of its own under the OS temp directory (`profilePrefix` names it), at
 * width × height. The process starts now; `port()` waits for its DevTools port, `connect(port)` opens the page
 * target, and `cdp`, `on`, `evaluate`, `waitFor` drive it. `close(port)` closes the socket and the browser.
 */
export function launchChrome({ chrome, width, height, profilePrefix = 'demo-rehearsal-chrome-', out = (line) => console.log(line) }) {
  // Each run leaves one small directory under the OS temp directory; nothing here deletes anything.
  const profile = mkdtempSync(join(tmpdir(), profilePrefix));
  const launchedAt = Date.now();
  const proc = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${width},${height}`,
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank'], { stdio: 'ignore' });
  let exited = false;
  proc.on('exit', () => { exited = true; });

  async function port() {
    const file = join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 120; i += 1) {
      try { if (statSync(file).mtimeMs >= launchedAt - 2000) { const p = Number(readFileSync(file, 'utf8').split('\n')[0]); if (p) return p; } } catch { /* not yet */ }
      if (exited) break;
      await sleep(250);
    }
    throw new Error(`${chrome} did not open a DevTools port`);
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
  async function connect(p) {
    let target = null;
    for (let i = 0; i < 40 && !target; i += 1) {
      try { target = (await (await fetch(`http://127.0.0.1:${p}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* not yet */ }
      if (!target) await sleep(250);
    }
    if (!target) throw new Error('no page target in the browser');
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('the DevTools socket did not open')); });
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && pending.has(msg.id)) {
        const q = pending.get(msg.id); pending.delete(msg.id);
        if (msg.error) q.reject(new Error(`${q.method}: ${msg.error.message}`)); else q.resolve(msg.result);
      } else if (msg.method) for (const fn of listeners.get(msg.method) || []) fn(msg.params);
    };
  }
  /** The page, its runtime and the network on; the cache off; the viewport at width × height, scale 1, not mobile. */
  async function prepare() {
    await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Network.enable');
    await cdp('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
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
  async function closeBrowser(p) {
    try {
      const version = await (await fetch(`http://127.0.0.1:${p}/json/version`)).json();
      const b = new WebSocket(version.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => { b.onopen = resolve; b.onerror = reject; });
      b.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
      for (let i = 0; i < 40 && !exited; i += 1) await sleep(250);
    } catch { /* the browser may already be gone */ }
    if (!exited) out(`   · the browser (pid ${proc.pid}) did not close on request`);
  }
  /** The page socket, then the browser through the protocol. */
  async function close(p) {
    try { if (ws) ws.close(); } catch { /* closing */ }
    await closeBrowser(p);
  }
  return { chrome, profile, pid: proc.pid, port, connect, prepare, on, cdp, evaluate, waitFor, close, get exited() { return exited; } };
}

// ── What a person sees ────────────────────────────────────────────────────────

/**
 * Whether `el` (an element, or a selector in `win.document`) is on screen as a person would see it: no ancestor
 * display: none, visibility: hidden or collapse, or opacity 0, and a layout box of at least 1 × 1. Returns
 * { ok: true, w, h, top (from the document's top), inView } or { ok: false, why }.
 *
 * Self-contained on purpose: it is sent into the page as source (inPage) and called with `window` there; a test
 * calls it with a fixture window.
 */
export function visibility(el, win) {
  const name = (n) => (n.id ? `#${n.id}` : `${n.tagName.toLowerCase()}${n.classList.length ? `.${n.classList[0]}` : ''}`);
  if (typeof el === 'string') el = win.document.querySelector(el);
  if (!el) return { ok: false, why: 'not in the page' };
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const cs = win.getComputedStyle(n);
    if (cs.display === 'none') return { ok: false, why: `display: none on ${name(n)}` };
    if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return { ok: false, why: `visibility: ${cs.visibility} on ${name(n)}` };
    if (Number(cs.opacity) === 0) return { ok: false, why: `opacity: 0 on ${name(n)}` };
  }
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return { ok: false, why: `no box (${Math.round(r.width)}×${Math.round(r.height)})` };
  return { ok: true, w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top + win.scrollY), inView: r.bottom > 0 && r.top < win.innerHeight };
}

/**
 * Runs inside the page: the readers every DOM suite builds on. `vis` is the visibility predicate on this window;
 * `txt` an element's rendered text, whitespace folded; `own` its own text nodes only; `shown` the elements a
 * selector matches that are on screen.
 */
export function pageReaders(visibilityOf) {
  const vis = (el) => visibilityOf(el, window);
  const txt = (el) => { if (typeof el === 'string') el = document.querySelector(el); return el ? el.innerText.replace(/\s+/g, ' ').trim() : ''; };
  const own = (el) => (el ? [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/\s+/g, ' ').trim() : '');
  const shown = (sel, root) => [...(root || document).querySelectorAll(sel)].filter((e) => vis(e).ok);
  return { vis, txt, own, shown };
}

/** The expression that runs a suite's own page function in the page, handed the readers: `fn({ vis, txt, own, shown })`. */
export const inPage = (fn) => `(${fn.toString()})((${pageReaders.toString()})(${visibility.toString()}))`;

// ── The wire ──────────────────────────────────────────────────────────────────

/** A request's header, by name in any case. */
export const header = (r, name) => Object.entries(r.headers).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];

/** The API paths a page's wire audit records: the engine's (/v1, /realtime, /sort), the demo's own routes, and the doors it must never use. */
export const apiPaths = (demoApi) => new RegExp(`^\\/(v1|realtime|sort|${demoApi.replace(/^\//, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\//g, '\\/')}|content|config|ops)\\b`);

/**
 * Every API request the page makes, by press: `pressNow()` names the press a request belongs to when it leaves.
 * `api` selects the paths recorded (apiPaths); `keepBody` the paths whose request body is kept for checking (the
 * demo's own merchandiser routes). Script errors in the page are collected too.
 */
export function recordWire(browser, { api, keepBody = null, pressNow = () => null }) {
  const requests = new Map();
  const consoleErrors = [];
  const pathOf = (url) => { try { const p = new URL(url).pathname; return api.test(p) ? p : null; } catch { return null; } };
  browser.on('Network.requestWillBeSent', (e) => {
    const path = pathOf(e.request.url);
    if (!path) return;
    const body = keepBody && keepBody.test(path) ? (e.request.postData ?? null) : undefined;
    requests.set(e.requestId, { press: pressNow(), path, url: e.request.url, method: e.request.method, headers: e.request.headers || {}, status: null, failed: null, body, at: Date.now() });
  });
  browser.on('Network.responseReceived', (e) => { const r = requests.get(e.requestId); if (r) r.status = e.response.status; });
  browser.on('Network.loadingFailed', (e) => { const r = requests.get(e.requestId); if (r && !e.canceled) r.failed = e.errorText; });
  browser.on('Runtime.exceptionThrown', (e) => consoleErrors.push(((e.exceptionDetails.exception || {}).description || e.exceptionDetails.text || '').slice(0, 300)));
  /** The requests of one press that failed or were refused, as "METHOD path → status". */
  const refusedIn = (i) => [...requests.values()].filter((r) => r.press === i && (r.failed || (r.status !== null && r.status >= 400)))
    .map((r) => `${r.method} ${r.path} → ${r.failed || r.status}`);
  return { requests, consoleErrors, refusedIn, all: () => [...requests.values()] };
}

const OWN_DOORS = /^\/(content|config|ops)\//;
/** The page reaches the API only as the demo: X-Tenant on every call, no configuration door of its own, no Authorization. */
export function auditWire(checks, wire, { tenant }) {
  const all = wire.all();
  const api = all.filter((r) => !OWN_DOORS.test(r.path));
  const noTenant = api.filter((r) => header(r, 'X-Tenant') !== tenant);
  checks.ok(`every API call the page made carried X-Tenant: ${tenant} (${api.length} calls)`, noTenant.length === 0, noTenant.slice(0, 4).map((r) => `${r.method} ${r.path}`).join(' ~ '));
  checks.ok('the page made no /content, /config or /ops call of its own', all.every((r) => !OWN_DOORS.test(r.path)),
    all.filter((r) => OWN_DOORS.test(r.path)).map((r) => r.path).join(' ~ '));
  checks.ok('no request carried an Authorization header', all.every((r) => !header(r, 'Authorization')));
  return { all, api };
}

/**
 * What the page sends to its merchandiser routes: a beat goes by name, so its body is a kind, a name and a note,
 * and nothing else; a reset sends nothing. No document crosses from the page.
 */
export function checkDemoRouteBodies(checks, wire, { api }) {
  const all = wire.all();
  const parse = (b) => { try { return b == null ? null : JSON.parse(b); } catch { return null; } };
  const beatsSent = all.filter((r) => r.path === `${api}/beat`), resets = all.filter((r) => r.path === `${api}/reset`);
  const badBeat = beatsSent.filter((r) => { const b = parse(r.body); return !b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some((k) => !['kind', 'name', 'note'].includes(k))
    || !['catalog', 'slots'].includes(b.kind) || typeof b.name !== 'string' || !b.name || (b.note !== undefined && typeof b.note !== 'string'); });
  const badReset = resets.filter((r) => { const b = parse(r.body); return !b || typeof b !== 'object' || Object.keys(b).length > 0; });
  return checks.ok(`every beat the page applied sent only its kind, its name and a note, and every reset nothing: no document crosses from the page (${beatsSent.length} beat(s), ${resets.length} reset(s))`,
    beatsSent.length > 0 && badBeat.length === 0 && badReset.length === 0,
    [...badBeat, ...badReset].map((r) => `${r.path} ${r.body == null ? '(no body readable on the wire)' : `keys ${Object.keys(parse(r.body) || {}).join(',') || 'none'} · ${String(r.body).length} bytes`}`).join(' ~ ').slice(0, 220)
      || beatsSent.map((r) => (parse(r.body) || {}).name).join(', '));
}

/** The API calls by path, most first, with every snapshot counted as one path: "path ×n · …". */
export function tallyWire(api, { tenant }) {
  const byPath = {};
  const snapshot = new RegExp(`\\/v1\\/${tenant}\\/decisions\\/snapshot.*`);
  for (const r of api) { const k = r.path.replace(snapshot, `/v1/${tenant}/decisions/snapshot`); byPath[k] = (byPath[k] || 0) + 1; }
  return Object.entries(byPath).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} ×${n}`).join(' · ');
}

/** No script error in the page, for the whole run. */
export const checkScriptErrors = (checks, wire) => checks.ok('no script error in the page', wire.consoleErrors.length === 0, wire.consoleErrors.slice(0, 3).join(' ~ '));

// ── Shots, the press timer and the capture timings ────────────────────────────

/** --shots <dir>: the view on screen as a PNG, `<dir>/<prefix>-<width>-<name>.png`; nothing when no dir is given. */
export function screenshotter({ browser, dir, prefix, width, info = () => {} }) {
  return async (name) => {
    if (!dir) return null;
    mkdirSync(dir, { recursive: true });
    const r = await browser.cdp('Page.captureScreenshot', { format: 'png' });
    const file = join(dir, `${prefix}-${width}-${name}.png`);
    writeFileSync(file, Buffer.from(r.data, 'base64'));
    info(`screenshot ${file}`);
    return file;
  };
}

/**
 * From a press to its landing: started at the press, `land()` when the press has landed. `line()` is what the
 * suite prints after the settle and the waits: "<all of it> s (the press <press to landing> s)".
 */
export function pressTimer(now = Date.now) {
  const t0 = now();
  let landedAt = null;
  const seconds = (ms) => (ms / 1000).toFixed(1);
  return {
    t0,
    land() { landedAt = now(); return landedAt - t0; },
    pressMs: () => (landedAt === null ? null : landedAt - t0),
    line: () => `${seconds(now() - t0)} s (the press ${seconds((landedAt ?? now()) - t0)} s)`,
  };
}

/** The middle value (the upper one of an even count), or null for none. */
export const median = (a) => { const s = [...a].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : null; };

/**
 * The kit's Compare frames (compare.js timings(): kind, label, w, h, wait, render, encode, held), summarised per
 * group of pages: how many, their size, how long a press waits for the clone, and how long the frame then takes
 * to render and encode. `groups` is [[name, test(capture)]], in the order printed; a group with no frame is left out.
 */
export function captureTimingLines(caps, groups) {
  const lines = [];
  for (const [name, test] of groups) {
    const list = caps.filter(test);
    if (!list.length) continue;
    const work = list.map((x) => x.render + x.encode);
    lines.push(`${name}: ${list.length} Before frame(s), ${list[0].w}×${median(list.map((x) => x.h))} px · cloned a median ${median(list.map((x) => x.wait))} ms after it started (max ${Math.max(...list.map((x) => x.wait))}), all a press waits for`
      + ` · then rendered and encoded in a median ${median(work)} ms (max ${Math.max(...work)}; render ${median(list.map((x) => x.render))}, encode ${median(list.map((x) => x.encode))}),`
      + ` ${list.filter((x) => x.held > 0).length} of them after their beat landed`);
  }
  return lines;
}
