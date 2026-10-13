// node --test scripts/demo-kit/lib/cdp.test.mjs
// Chrome over DevTools for a demo's DOM suite (lane K3, part c). The visibility predicate on a fixture DOM (every
// reason an element is not on screen, and the box of one that is), the readers as the page receives them, the wire
// audit over recorded requests, the press timer, the capture-timing summary and --shots. Where Chrome or Edge is
// installed and Node has a global WebSocket, the same predicate runs in a real headless Chrome on a fixture page
// with a fresh profile; elsewhere (WSL here) that one test is skipped and says why.
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiPaths, auditWire, captureTimingLines, checkDemoRouteBodies, checkScriptErrors, findChrome, header, inPage, launchChrome, median, pageReaders,
  parseSize, pressTimer, recordWire, screenshotter, tallyWire, visibility } from './cdp.mjs';
import { createChecks } from './rehearse.mjs';

// ── A fixture DOM: elements with computed styles and layout boxes, and a window over them ─────────────────────
function fixture() {
  const byId = new Map();
  const el = (tag, { id = '', cls = [], style = {}, box = { top: 0, left: 0, width: 100, height: 20 } } = {}, ...children) => {
    const node = { nodeType: 1, tagName: tag.toUpperCase(), id, classList: cls, parentElement: null, style: { display: 'block', visibility: 'visible', opacity: '1', ...style },
      box, children, getBoundingClientRect() { const b = this.box; return { top: b.top, left: b.left, width: b.width, height: b.height, bottom: b.top + b.height, right: b.left + b.width }; } };
    for (const c of children) c.parentElement = node;
    if (id) byId.set(id, node);
    return node;
  };
  const html = el('html', {}, el('body', {},
    el('main', { id: 'viewHome' },
      el('section', { id: 'deals', box: { top: 120, left: 0, width: 1200, height: 300 } }, el('article', { cls: ['deal', 'lead'], box: { top: 130, left: 10, width: 280, height: 260 } })),
      el('section', { id: 'gone', style: { display: 'none' } }, el('p', { id: 'insideGone' })),
      el('div', { cls: ['ghost'], style: { visibility: 'hidden' } }, el('span', { id: 'insideHidden' })),
      el('div', { id: 'faded', style: { opacity: '0' } }),
      el('div', { id: 'collapsed', style: { visibility: 'collapse' } }),
      el('div', { id: 'empty', box: { top: 50, left: 0, width: 0.4, height: 40 } }),
      el('div', { id: 'below', box: { top: 2000, left: 0, width: 300, height: 100 } }))));
  const win = {
    scrollY: 0, innerHeight: 900,
    document: { querySelector: (sel) => (sel.startsWith('#') ? byId.get(sel.slice(1)) || null : null) },
    getComputedStyle: (n) => n.style,
  };
  return { win, byId, html };
}

test('visibility on a fixture DOM: display none, visibility hidden or collapse, opacity 0 up the chain, and no box, each named', () => {
  const { win, byId, html } = fixture();
  assert.deepEqual(visibility('#deals', win), { ok: true, w: 1200, h: 300, top: 120, inView: true });
  assert.deepEqual(visibility(byId.get('deals').children[0], win), { ok: true, w: 280, h: 260, top: 130, inView: true }, 'an element, not only a selector');
  assert.deepEqual(visibility('#insideGone', win), { ok: false, why: 'display: none on #gone' }, 'an ancestor\'s display: none, named by its id');
  assert.deepEqual(visibility('#insideHidden', win), { ok: false, why: 'visibility: hidden on div.ghost' }, 'named by tag and first class when it has no id');
  assert.deepEqual(visibility('#collapsed', win), { ok: false, why: 'visibility: collapse on #collapsed' });
  assert.deepEqual(visibility('#faded', win), { ok: false, why: 'opacity: 0 on #faded' });
  assert.deepEqual(visibility('#empty', win), { ok: false, why: 'no box (0×40)' }, 'under one pixel wide is no box');
  assert.deepEqual(visibility('#nothing', win), { ok: false, why: 'not in the page' });
  assert.deepEqual(visibility(null, win), { ok: false, why: 'not in the page' });
  assert.deepEqual(visibility('#below', win), { ok: true, w: 300, h: 100, top: 2000, inView: false }, 'on screen but below the fold');
  win.scrollY = 1500;
  byId.get('below').box = { top: 500, left: 0, width: 300, height: 100 };
  assert.deepEqual(visibility('#below', win), { ok: true, w: 300, h: 100, top: 2000, inView: true }, 'top is from the document\'s top, inView from the viewport');
  html.style.opacity = '0.0';
  assert.deepEqual(visibility('#deals', win), { ok: false, why: 'opacity: 0 on html' }, 'the whole chain, to the root');
});

test('the readers the page receives: inPage hands a suite\'s function vis, txt, own and shown over the page\'s window', () => {
  const { win } = fixture();
  const span = { nodeType: 1, textContent: '  inner  ' };   // an element inside it: its text is not the card's own
  const card = { nodeType: 1, innerText: '  Galaxy S26\n  on us  ', childNodes: [{ nodeType: 3, textContent: ' Storage ' }, span, { nodeType: 3, textContent: '& memory ' }] };
  const document = { ...win.document, querySelector: (sel) => (sel === '#card' ? card : win.document.querySelector(sel)),
    querySelectorAll: () => [win.document.querySelector('#deals'), win.document.querySelector('#insideGone')] };
  const run = new Function('window', 'document', `return ${inPage((readers) => readers)};`);
  const readers = run(win, document);
  assert.deepEqual(Object.keys(readers), ['vis', 'txt', 'own', 'shown']);
  assert.deepEqual(readers.vis('#faded'), visibility('#faded', win), 'vis is the predicate on this window');
  assert.equal(readers.txt('#card'), 'Galaxy S26 on us');
  assert.equal(readers.txt('#none'), '');
  assert.equal(readers.own(card), 'Storage & memory', 'its own text nodes only, the child element\'s text left out');
  assert.deepEqual(readers.shown('.x').map((e) => e.id), ['deals'], 'only what is on screen');
  assert.equal(typeof pageReaders, 'function');
});

test('findChrome takes --chrome and CHROME_PATH first, then the installed candidates; parseSize reads WxH', () => {
  const exists = (p) => ['/opt/edge', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].includes(p);
  assert.equal(findChrome(['/opt/edge', undefined], { exists }), '/opt/edge');
  assert.equal(findChrome([undefined, undefined], { exists }), 'C:/Program Files/Google/Chrome/Application/chrome.exe');
  assert.equal(findChrome(['/nowhere'], { exists: () => false }), null);
  assert.deepEqual(parseSize('1440x900'), [1440, 900]);
  assert.deepEqual(parseSize('1366x768'), [1366, 768]);
});

// ── The wire ──────────────────────────────────────────────────────────────────
function fakeBrowser() {
  const listeners = new Map();
  return { on: (m, fn) => listeners.set(m, [...(listeners.get(m) || []), fn]), emit: (m, p) => (listeners.get(m) || []).forEach((fn) => fn(p)) };
}

test('the wire audit: requests by press, the demo route bodies kept, X-Tenant, no own doors, no Authorization, the tally', () => {
  assert.equal(String(apiPaths('/vantage/api')), String(/^\/(v1|realtime|sort|vantage\/api|content|config|ops)\b/));
  const b = fakeBrowser();
  let press = 'edge';
  const wire = recordWire(b, { api: apiPaths('/vantage/api'), keepBody: /^\/vantage\/api\/(beat|reset)$/, pressNow: () => press });
  const send = (id, url, extra = {}) => b.emit('Network.requestWillBeSent', { requestId: id, request: { url, method: 'POST', headers: { 'X-Tenant': 'vantage', ...extra.headers }, postData: extra.body } });
  send('1', 'http://h/v1/vantage/decisions/snapshot?page=home');
  send('2', 'http://h/vantage/beat.css');
  press = 3;
  send('3', 'http://h/vantage/api/beat', { body: JSON.stringify({ kind: 'catalog', name: '11-two-weeks-pass', note: 'x' }) });
  send('4', 'http://h/vantage/api/reset', { body: '{}' });
  send('5', 'http://h/v1/vantage/decisions/snapshot?page=phone');
  send('6', 'http://h/realtime/action', { headers: { 'x-tenant': 'vantage', 'X-Shopper-Session': 'cap' } });
  b.emit('Network.responseReceived', { requestId: '5', response: { status: 503 } });
  b.emit('Network.loadingFailed', { requestId: '6', errorText: 'net::ERR_FAILED', canceled: false });
  assert.deepEqual(wire.all().map((r) => [r.press, r.path]), [['edge', '/v1/vantage/decisions/snapshot'], [3, '/vantage/api/beat'], [3, '/vantage/api/reset'],
    [3, '/v1/vantage/decisions/snapshot'], [3, '/realtime/action']], 'a static file is not an API call');
  assert.equal(wire.all()[0].body, undefined, 'a body is kept only for the demo\'s own routes');
  assert.deepEqual(wire.refusedIn(3), ['POST /v1/vantage/decisions/snapshot → 503', 'POST /realtime/action → net::ERR_FAILED']);
  assert.equal(header(wire.all()[4], 'x-shopper-session'), 'cap');

  const lines = [];
  const checks = createChecks({ infoIndent: 8, out: (l) => lines.push(l) });
  const { api } = auditWire(checks, wire, { tenant: 'vantage' });
  checkDemoRouteBodies(checks, wire, { api: '/vantage/api' });
  assert.equal(tallyWire(api, { tenant: 'vantage' }), '/v1/vantage/decisions/snapshot ×2 · /vantage/api/beat ×1 · /vantage/api/reset ×1 · /realtime/action ×1');
  checkScriptErrors(checks, wire);
  assert.deepEqual(lines, [
    '   ✓ every API call the page made carried X-Tenant: vantage (5 calls)',
    '   ✓ the page made no /content, /config or /ops call of its own',
    '   ✓ no request carried an Authorization header',
    '   ✓ every beat the page applied sent only its kind, its name and a note, and every reset nothing: no document crosses from the page (1 beat(s), 1 reset(s))  (11-two-weeks-pass)',
    '   ✓ no script error in the page',
  ]);

  // Each rule fails for what it names.
  send('7', 'http://h/content/catalog?scope=vantage', { headers: { 'X-Tenant': 'vantage' } });
  send('8', 'http://h/sort', { headers: { 'X-Tenant': 'other', Authorization: 'Bearer x' } });
  send('9', 'http://h/vantage/api/beat', { body: JSON.stringify({ kind: 'catalog', name: 'n', document: {} }) });
  b.emit('Runtime.exceptionThrown', { exceptionDetails: { exception: { description: 'TypeError: x is undefined' } } });
  lines.length = 0;
  auditWire(checks, wire, { tenant: 'vantage' });
  checkDemoRouteBodies(checks, wire, { api: '/vantage/api' });
  checkScriptErrors(checks, wire);
  assert.deepEqual(lines.map((l) => l.slice(0, 5)), ['   ✗ ', '   ✗ ', '   ✗ ', '   ✗ ', '   ✗ ']);
  assert.match(lines[0], /X-Tenant: vantage \(7 calls\) — POST \/sort$/);
  assert.match(lines[1], /— \/content\/catalog$/);
  assert.match(lines[3], /\(2 beat\(s\), 1 reset\(s\)\) — \/vantage\/api\/beat keys kind,name,document · \d+ bytes$/);
  assert.match(lines[4], /— TypeError: x is undefined$/);
});

// ── The press timer, the capture timings, --shots ────────────────────────────

test('the press timer: the whole of it, and the press from go() to its landing', () => {
  let t = 1_000;
  const timer = pressTimer(() => t);
  assert.equal(timer.t0, 1_000);
  t = 1_340;
  assert.equal(timer.land(), 340);
  t = 3_180;
  assert.equal(timer.pressMs(), 340);
  assert.equal(timer.line(), '2.2 s (the press 0.3 s)');
});

test('the capture-timing summary, per group of pages, as the DOM suite prints it', () => {
  const cap = (label, h, wait, render, encode, held = 0) => ({ kind: 'baseline', label, w: 1440, h, wait, render, encode, held });
  const caps = [cap('homepage · nobody yet', 3000, 40, 300, 100), cap('homepage · Shopper A', 3200, 60, 340, 120, 1), cap('homepage · Shopper A', 3100, 50, 320, 110),
    cap('Galaxy S26 page · Shopper A', 4512, 30, 400, 150)];
  const lines = captureTimingLines(caps, [['the homepage', (x) => /^homepage · /.test(x.label)], ['a phone page', (x) => x.label.startsWith('Galaxy S26 page · ')],
    ['the phones grid and content pages', () => false]]);
  assert.deepEqual(lines, [
    'the homepage: 3 Before frame(s), 1440×3100 px · cloned a median 50 ms after it started (max 60), all a press waits for · then rendered and encoded in a median 430 ms (max 460; render 320, encode 110), 1 of them after their beat landed',
    'a phone page: 1 Before frame(s), 1440×4512 px · cloned a median 30 ms after it started (max 30), all a press waits for · then rendered and encoded in a median 550 ms (max 550; render 400, encode 150), 0 of them after their beat landed',
  ], 'a group with no frame is left out');
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 3, 'the upper middle of an even count');
  assert.equal(median([]), null);
});

test('--shots writes <dir>/<prefix>-<width>-<name>.png and says so; without a directory it does nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'demo-kit-shots-'));
  const said = [];
  const browser = { cdp: async (method) => { assert.equal(method, 'Page.captureScreenshot'); return { data: Buffer.from('png bytes').toString('base64') }; } };
  const shoot = screenshotter({ browser, dir: join(dir, 'out'), prefix: 'C1', width: 1440, info: (l) => said.push(l) });
  const file = await shoot('01-seam');
  assert.equal(file, join(dir, 'out', 'C1-1440-01-seam.png'));
  assert.equal(readFileSync(file, 'utf8'), 'png bytes');
  assert.deepEqual(said, [`screenshot ${file}`]);
  assert.equal(await screenshotter({ browser: null, dir: null, prefix: 'C1', width: 1440 })('x'), null);
});

// ── In a real browser, where there is one ────────────────────────────────────
const CHROME = findChrome([process.env.CHROME_PATH]);
const why = !CHROME ? 'no Chrome or Edge on this machine (the DOM suite runs from Windows)' : typeof WebSocket === 'undefined' ? 'Node has no global WebSocket (Node 22 or later)' : false;

test('in headless Chrome with a fresh profile: the same predicate on a fixture page, at the viewport asked for', { skip: why, timeout: 60_000 }, async () => {
  const browser = launchChrome({ chrome: CHROME, width: 800, height: 600, profilePrefix: 'demo-kit-cdp-test-', out: () => {} });
  assert.ok(existsSync(browser.profile), 'a profile of its own, under the OS temp directory');
  assert.ok(browser.profile.startsWith(join(tmpdir(), 'demo-kit-cdp-test-')));
  const port = await browser.port();
  try {
    await browser.connect(port);
    await browser.prepare();
    const page = `<!doctype html><style>body{margin:0}.box{height:40px}#gone{display:none}#ghost{visibility:hidden}#faded{opacity:0}#thin{width:0}#below{margin-top:2000px}</style>
      <div id="shown" class="box">shown</div><div id="gone"><p id="inGone" class="box">x</p></div><div id="ghost"><span id="inGhost" class="box" style="display:block">x</span></div>
      <div id="faded" class="box">x</div><div id="thin" class="box"></div><div id="below" class="box">below</div>`;
    await browser.cdp('Page.navigate', { url: `data:text/html,${encodeURIComponent(page)}` });
    assert.ok(await browser.waitFor("document.readyState === 'complete' && Boolean(document.getElementById('below'))", 10_000));
    const seen = await browser.evaluate(`(${inPage(({ vis, txt }) => ({
      shown: vis('#shown'), inGone: vis('#inGone'), inGhost: vis('#inGhost'), faded: vis('#faded'), thin: vis('#thin'), below: vis('#below'), nothing: vis('#nothing'),
      text: txt('#shown'), width: globalThis.innerWidth }))})`);
    assert.deepEqual(seen.shown, { ok: true, w: 800, h: 40, top: 0, inView: true });
    assert.deepEqual(seen.inGone, { ok: false, why: 'display: none on #gone' });
    assert.deepEqual(seen.inGhost, { ok: false, why: 'visibility: hidden on #inGhost' }, 'visibility is inherited: the span itself computes hidden');
    assert.deepEqual(seen.faded, { ok: false, why: 'opacity: 0 on #faded' });
    assert.deepEqual(seen.thin, { ok: false, why: 'no box (0×40)' });
    assert.equal(seen.below.ok, true);
    assert.equal(seen.below.inView, false);
    assert.deepEqual(seen.nothing, { ok: false, why: 'not in the page' });
    assert.equal(seen.text, 'shown');
    assert.equal(seen.width, 800, 'the viewport the suite asked for');
  } finally {
    await browser.close(port);
  }
  assert.equal(browser.exited, true, 'closed through the protocol');
  // The profile directory stays, as the suites' do: nothing here deletes anything.
});
