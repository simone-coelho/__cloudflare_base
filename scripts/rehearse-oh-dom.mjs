#!/usr/bin/env node
// scripts/rehearse-oh-dom.mjs: press OH's director buttons, for real.
//
// Scaffolded by scripts/demo-kit/new-demo.mjs with the ARRIVAL checks written. It loads the actual page
// (public/oh/index.html and oh.js, served by the worker) into headless Chrome and runs the director's
// presses through the page's own hook, window.__oh.go(i) under ?debug=1: the same function the director bar's
// Next button calls. Every answer is read off what a person would see (computed style up the whole ancestor chain
// and a real layout box, the kit's lib/cdp.mjs), and the wire is watched: every API call carries
// X-Tenant: oh, none goes to /content, /config or /ops, none carries Authorization, a beat goes by name.
// The vertical's outcomes for the other beats are the suite lane's to add, after the arrival, in the director's order.
//
//   node scripts/rehearse-oh-dom.mjs [--base http://localhost:9120] [--size 1440x900] [--chrome "<path>"] [--shots <dir>]
//   node scripts/demo-kit/rehearse.mjs --config oh --suite dom --base <url>      (the same, through the kit)
//
// It holds no credential and takes no token, and it ends with POST /oh/api/reset. Chrome runs headless with a
// fresh profile of its own under the OS temp directory on every run. Run it from Windows (Node 22 or later).
import { apiPaths, auditWire, checkScriptErrors, findChrome, inPage, launchChrome, parseSize, recordWire, screenshotter, tallyWire } from './demo-kit/lib/cdp.mjs';
import { createChecks, flagReader, sleep } from './demo-kit/lib/rehearse.mjs';

const arg = flagReader();
const base = arg('--base', 'http://localhost:9120').replace(/\/+$/, '');
const [WIDTH, HEIGHT] = parseSize(arg('--size', '1440x900'));
const SHOTS = arg('--shots', null);
const SLUG = 'oh', TENANT = 'oh', API = `/${SLUG}/api`, HOOK = '__oh';
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
}
const rgb = (hex) => { const h = hex.replace('#', ''); const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h; return `rgb(${[0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)).join(', ')})`; };
const runBeat = (i) => evaluate(`(async () => { const run = window.${HOOK}.go(${i}); if (run === undefined) return 'busy'; await run; return document.getElementById('status').textContent; })()`);

const port = await browser.port();
try {
  await browser.connect(port);
  await browser.prepare();
  const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(base).hostname);
  const booted = () => waitFor("/^ready|error|missing|failed|beats\\.json/i.test((document.getElementById('status') || {}).textContent || '')", 30000);
  console.log(`\nOH DOM rehearsal against ${base} at ${WIDTH}×${HEIGHT} in ${CHROME.split(/[\\/]/).pop()}`);

  const url = `${base}/${SLUG}/?debug=1`;
  console.log(`\n── The page loads: ${url}`);
  await cdp('Page.navigate', { url });
  const up = await booted();
  await evaluate(inPage(pageHelpers));
  const boot = await evaluate('window.__k4.snapshot()');
  ok('the page boots on the kit, and every template in beats.json resolves against the facts', up && /^ready/.test(boot.status), boot.status.slice(0, 160));
  ok(`the director hook is exposed under ?debug=1 (window.${HOOK})`, await evaluate(`typeof (window.${HOOK} || {}).go === "function"`));
  const total = await evaluate(`window.${HOOK}.beats().length`);
  ok('the director lists the 16 beats of beats.json', total === 16, `${total}`);
  ok('the palette is the token sheet\'s: --brand is #A50034', boot.brand.toUpperCase() === '#A50034'.toUpperCase(), boot.brand);
  ok('the wordmark “OH.” is on screen in the brand colour', boot.wordmark.ok && boot.wordmark.text === 'OH.' && boot.wordmark.color === rgb('#A50034'),
    `${boot.wordmark.text} · ${boot.wordmark.color}`);
  ok('the machine panel and the director bar are on screen', boot.machine && boot.director);
  ok('before anyone arrives, nothing on the page is decided', boot.slots.every((s) => s.cards.every((c) => !c.decided)), boot.slots.map((s) => `${s.slot} ${s.cards.length}`).join(' · '));
  ok('the director\'s opening sentence is on screen', boot.lineOk && boot.line.length > 10, boot.line.slice(0, 90));
  ok('no horizontal overflow', boot.overflow <= 1, `${boot.overflow}px`);
  await shot('00-boot');

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

checks.summary({ failed: 'do not hand this over', passed: `OH's arrival runs in the real page, and every effect has a visible cause` });
process.exit(checks.exitCode());
