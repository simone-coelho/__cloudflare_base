#!/usr/bin/env node
// scripts/rehearse-vantage-page.mjs: walk the Vantage page's own sequence, at request level.
//
// The REQUEST-LEVEL rehearsal for the carrier demo (docs/verizon/Vantage-Demo-Design.md).
// It replays exactly what public/vantage/vantage.js sends for each of the 22
// presses (the same session, consent, events, snapshots with ctx.intent and
// ctx.region, beats by name, receipts, cold-start reads and /sort), and it
// asserts the outcomes lane L1 measured (docs/verizon/lanes/L1.md, the beat
// table), not HTTP 200 alone. Its companion, rehearse-vantage-dom.mjs, runs the
// page's own JavaScript in a real browser and presses the director's buttons.
//
// It also proves the page can get there holding nothing the browser does not:
// no token is served or committed, the page makes no /content call of its own,
// every API call it makes carries X-Tenant: vantage, and the configuration
// routes refuse an unsigned read.
//
// Scores move run to run (memory decays in real time), so the checks are on
// positions, memberships and thresholds, the claims the presenter makes.
//
//   node scripts/rehearse-vantage-page.mjs [--base http://localhost:9110] [--exit-wait 50]
//
// --exit-wait is how long after her third Samsung touch beat 5 asks again. Brand
// memory is 60 s for the room, so the claim falls under the 0.45 exit threshold
// about 41 s after that touch; 50 leaves a margin. No token argument,
// deliberately: if this needs one, the page is broken. It ends with
// POST /vantage/api/reset, so the tenant is left at its opening state.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const base = arg('--base', 'http://localhost:9110').replace(/\/+$/, '');
const EXIT_WAIT = Number(arg('--exit-wait', '50'));
const TENANT = 'vantage', SOURCE = 'vantage-demo';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const THETA_IN = 0.6, THETA_OUT = 0.45;

let failures = 0, passes = 0;
const ok = (label, condition, detail = '') => {
  if (condition) { passes += 1; console.log(`   ✓ ${label}${detail ? `  (${detail})` : ''}`); }
  else { failures += 1; console.log(`   ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
  return Boolean(condition);
};
const info = (line) => console.log(`      ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (id) => String(id || '').replace(/^promo-|^plan-|^hero-/, '');
const fmt = (list) => (list || []).map((d) => `${short(d.customerContentId)}${d.strategy === 'tenant-pinned' ? '(pin)' : ''} ${Number(d.score || 0).toFixed(3)}`).join(' · ');
const ids = (list) => (list || []).map((d) => d.customerContentId);

// ── What the browser can reach ────────────────────────────────────────────────
const asset = (path) => fetch(`${base}/vantage/${path}`, { cache: 'no-store' });
/**
 * A page as a browser navigates to it: the assets layer answers a navigation differently from a plain
 * fetch. Node's fetch drops Sec-Fetch-* (forbidden request headers), so this goes through node:http.
 */
function navigate(path, hops = 0) {
  const url = new URL(path.startsWith('/') ? `${base}${path}` : `${base}/vantage/${path}`);
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(url, { method: 'GET', headers: { 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Site': 'none', Accept: 'text/html,application/xhtml+xml', 'Cache-Control': 'no-store' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 3) {
          resolve(navigate(new URL(res.headers.location, url).pathname + new URL(res.headers.location, url).search, hops + 1));
          return;
        }
        resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, text: async () => body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}
const assetJson = async (path) => {
  const res = await asset(path);
  if (!res.ok) throw new Error(`/vantage/${path} answered ${res.status}`);
  return res.json();
};

console.log(`\nVantage page rehearsal against ${base}`);

console.log('\n── The page loads');
const shells = {};
for (const path of ['', 'phone?id=galaxy-s26', 'phone/galaxy-s26', 'vantage.js', 'vantage.css']) {
  const isPage = path === '' || path.startsWith('phone');
  const res = isPage ? await navigate(path) : await asset(path);
  const text = res.ok ? await res.text() : '';
  shells[path] = text;
  if (path === 'phone/galaxy-s26') {
    // The path form (L1.md §3): a plain fetch gets phone.html, but a browser navigation gets the assets
    // layer's root fallback, so the page links with ?id=. Reported, not asserted.
    const served = res.ok && /data-entry="phone"/.test(text);
    console.log(`   · /vantage/phone/galaxy-s26, as a browser navigates → ${res.status}, ${served ? 'the phone shell' : 'not the phone page (the root fallback); links use /vantage/phone?id= (L1.md §3, R1 N7)'}`);
    continue;
  }
  ok(`/vantage/${path || '(index)'} → ${res.status}${isPage ? ', as a browser navigates' : ''}`, res.ok && text.length > 0);
}
ok('the home shell is the Vantage page', /<title>Vantage/.test(shells['']) && /data-entry="home"/.test(shells['']));
ok('the phone shell boots into the phone view', /data-entry="phone"/.test(shells['phone?id=galaxy-s26']));

const BEAT_FILES = ['anchor', 'open-catalog', 'open-slots', '01-arrival', '02-another-region', '03-browse-galaxy-pixel',
  '04-the-hinge', '05-stop-touching', '06-open-the-galaxy', '07-compare-storage', '08-hotspot-perk', '09-four-lines',
  '10-intent-toggle', '11-two-weeks-pass', '12-black-friday', '13-pin-duo-preorder', '14-5g-home', '15-continue-and-report'];
let beatsServed = 0;
for (const name of BEAT_FILES) { const res = await asset(`beats/${name}.json`); if (res.ok) beatsServed += 1; else console.log(`   ✗ beats/${name}.json → ${res.status}`); }
ok(`the ${BEAT_FILES.length} beat documents are served`, beatsServed === BEAT_FILES.length, `${beatsServed}/${BEAT_FILES.length}`);
for (const path of ['phones.json', 'plans.json', 'catalog.json', 'seeds.json', 'img/MANIFEST.json']) {
  const res = await asset(path);
  ok(`/vantage/${path} → ${res.status}`, res.ok);
}

const anchor = await assetJson('beats/anchor.json');
const phonesDoc = await assetJson('phones.json');
const phone = (id) => phonesDoc.phones.find((p) => p.id === id);
const eco = (p) => p.ecosystem || p.os || '';
const optionsOf = (p) => (Array.isArray(p.storageOptions) && p.storageOptions.length ? p.storageOptions : [{ storage: p.storage, price_usd: p.price_usd }]);
/** The attributes a phone event carries, exactly as vantage.js builds them (phoneAttrs). */
const phoneAttrs = (p, extra) => ({ productId: p.id, category: 'phones', brand: p.brand, os: eco(p), ecosystem: eco(p), price_usd: Number(p.price_usd), ...(extra || {}) });
const IDS = anchor.ids || {};
const FOCUS = anchor.focusPhone || 'galaxy-s26';
const HINGE = anchor.hingePhone || 'pixel-11';
const TOUCHES = anchor.browseTouches || [{ id: FOCUS, view: 'card' }, { id: FOCUS, view: 'page' }, { id: 'galaxy-s26-ultra', view: 'card' }];
const R = anchor.regions || {};
const NY = R.first || 'US-NY', TX = R.second || 'US-TX', COVERED = R.covered || NY, UNCOVERED = R.uncovered || 'US-MT';
const KIDS_WATCH = { page: 'kids-watch', category: 'watches-tablets', intent: 'add-line', lines: 'family' };
const LANDING = new URLSearchParams(anchor.landing ? anchor.landing.url.split('?')[1] : 'utm_source=tiktok&utm_medium=paid-social&utm_term=iphone-18-pro');
const AD_ENTRY = { utmSource: LANDING.get('utm_source'), utmMedium: LANDING.get('utm_medium'), utmTerm: LANDING.get('utm_term') };

// ── No credential is served or committed, and the page holds none ─────────────
console.log('\n── No credential is served, embedded or committed');
const TOKENISH = [
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}/, 'a JWT'],
  [/Bearer\s+(?!\$\{)[A-Za-z0-9._~+/=-]{24,}/, 'a bearer token literal'],
  [/ss1\.[A-Za-z0-9._-]{30,}/, 'a shopper capability literal'],
];
const tokenIn = (text) => TOKENISH.filter(([re]) => re.test(text)).map(([, what]) => what);
{
  // Not served is what matters, not which refusal: a hosted worker answers 403 for an absent asset where the dev server answers 404.
  for (const leak of ['beats/operator.local.json', 'operator.local.json', 'beats/token.json']) {
    const res = await asset(leak);
    ok(`/vantage/${leak} → ${res.status} (must not be served)`, res.status !== 200);
  }
  const served = ['', 'phone?id=galaxy-s26', 'vantage.js', 'vantage.css', 'phones.json', 'plans.json', 'catalog.json', 'seeds.json',
    'img/MANIFEST.json', ...BEAT_FILES.map((b) => `beats/${b}.json`)];
  const hits = [];
  for (const path of served) { const text = await (await asset(path)).text(); for (const w of tokenIn(text)) hits.push(`${path}: ${w}`); }
  ok(`no served page or document carries a token (${served.length} checked)`, hits.length === 0, hits.join(' ~ '));

  // The committed side: every file this demo ships, read from the checkout.
  const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const TEXT = /\.(html|js|mjs|ts|css|json|svg|md|toml|txt)$/i;
  const committed = [
    ...walk(join(ROOT, 'public/vantage')).filter((f) => TEXT.test(f)),
    ...['scripts/seed-vantage.mjs', 'scripts/seed-vantage-region.mjs', 'scripts/build-demo-worker-config.mjs', 'scripts/rehearse-vantage-page.mjs',
      'scripts/rehearse-vantage-dom.mjs', 'wrangler.vantage.toml', 'src/routes/vantage.ts', 'src/routes/vantageColdStart.ts'].map((f) => join(ROOT, f)),
    ...walk(join(ROOT, 'docs/verizon')).filter((f) => /\.md$/i.test(f)),
  ].filter((f) => { try { return statSync(f).isFile(); } catch { return false; } });
  const leaks = [];
  for (const f of committed) for (const w of tokenIn(readFileSync(f, 'utf8'))) leaks.push(`${relative(ROOT, f)}: ${w}`);
  ok(`no file this demo ships carries a token (${committed.length} read from the checkout)`, leaks.length === 0, leaks.join(' ~ '));

  const source = shells['vantage.js'];
  ok('the page source makes no /content, /config or /ops call of its own',
    !/['"`]\/(?:content|config|ops)\//.test(source), 'the merchandiser half must go through /vantage/api/beat');
  ok('the page applies beats by name', /\/vantage\/api\/beat/.test(source) && /\/vantage\/api\/reset/.test(source));
  ok('the page source holds no Authorization header', !/Authorization/i.test(source));
  // Every request leaves through one of three doors: api() and demoRoute() for the API, tryJson() for static documents.
  const fetches = [...source.matchAll(/\bfetch\(/g)].length;
  ok(`every fetch in the page goes through api(), demoRoute() or tryJson() (${fetches} call sites)`, fetches === 3, `${fetches} found`);
  const apiDoor = /async function api\([\s\S]{0,400}?'X-Tenant': TENANT/.test(source);
  const routeDoor = /async function demoRoute\([\s\S]{0,400}?'X-Tenant': TENANT/.test(source);
  ok('api() and demoRoute() send X-Tenant on every API call', apiDoor && routeDoor);
  ok("and the tenant they name is 'vantage'", /const TENANT = 'vantage'/.test(source));
  const statics = [...source.matchAll(/tryJson\(([^)]*)\)/g)].map((m) => m[1].trim()).filter((a) => a !== 'url');
  ok('tryJson() only ever reads /vantage/ documents', statics.every((a) => /^[`'"]\/vantage\//.test(a)), statics.filter((a) => !/^[`'"]\/vantage\//.test(a)).join(' ~ '));
}

// ── Everything below uses only what the page has ──────────────────────────────
const H = { 'X-SDK-Key': 'demo-site', 'Content-Type': 'application/json', 'X-Tenant': TENANT };
async function call(path, { method, body, visitor, headers } = {}) {
  const h = { ...H, ...(headers || {}) };
  if (visitor) h['X-Shopper-Session'] = visitor.session.capability;
  for (const [k, v] of Object.entries(h)) if (v === null) delete h[k];
  const t0 = Date.now();
  try {
    const res = await fetch(base + path, { method: method || (body === undefined ? 'GET' : 'POST'), headers: h,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, ok: res.ok, ms: Date.now() - t0, body: await res.json().catch(() => ({})) };
  } catch (error) {
    return { status: 0, ok: false, ms: Date.now() - t0, body: { error: String(error.message || error) } };
  }
}
/** The demo route, by name: the page's own merchandiser door. No document crosses from here. */
async function demoRoute(path, body) {
  const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Tenant': TENANT }, body: JSON.stringify(body || {}) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.ok !== true) throw new Error(`${path} ${JSON.stringify(body)} → ${res.status} ${out.error || ''}`);
  return out;
}

console.log('\n── The unsigned-read trap, and the doors that stay shut');
{
  for (const kind of ['catalog', 'slots']) {
    const unsigned = await fetch(`${base}/content/${kind}?scope=${TENANT}`, { headers: { 'X-Tenant': TENANT } });
    ok(`an unsigned GET /content/${kind} is refused (${unsigned.status})`, unsigned.status === 401 || unsigned.status === 403,
      'if this ever passes, the route stopped protecting configuration reads');
  }
  const unknown = await call('/vantage/api/beat', { body: { name: 'not-a-beat' } });
  ok(`/vantage/api/beat refuses a name outside its closed list (${unknown.status})`, unknown.status === 400);
  const mismatch = await call('/vantage/api/beat', { body: { name: 'open-slots', kind: 'catalog' } });
  ok(`and refuses a kind that is not the beat's own (${mismatch.status})`, mismatch.status === 400);
  const prior = await call('/vantage/api/coldstart/prior', { body: {} });
  ok(`the regional-prior seed door refuses a caller with no operator token (${prior.status})`, prior.status === 401 || prior.status === 403);
  const anon = await call('/vantage/api/receipt', { body: { decisionIds: ['vantage:x:vis-nobody:home:deals:0'] } });
  ok(`a receipt without a shopper session is refused (${anon.status})`, anon.status === 401);
}

/** Session first, then her explicit consent, exactly as the page does (mintVisitor). */
async function mintVisitor(entry, label) {
  const minted = await call(`/v1/${TENANT}/identity/session`, { body: {} });
  if (!minted.body.session) throw new Error(`no shopper session (${minted.status} ${minted.body.error || ''})`);
  const v = { label, session: minted.body.session, entry: entry || {}, intent: 'new', lines: 1, plan: null, config: null };
  const s = v.session;
  const pref = await call('/realtime/session/preferences', { visitor: v, body: { userId: s.subject, trackingConsent: true, personalizationEnabled: true,
    choice: { id: crypto.randomUUID().replace(/-/g, ''), expectedRevision: null, grantId: s.grantId, iat: s.iat, exp: s.exp } } });
  if (!pref.body.consent || !pref.body.consent.personalization) throw new Error('the visitor did not grant consent');
  return v;
}
const page = { region: null };                // the page's asserted region (state.ctx.region)
const transient = [];
/**
 * One event, as send() posts it. The page does not retry; this does, once, so a
 * transient engine refusal cannot impersonate a ranking fault downstream. Every
 * refusal is listed at the end by name, never absorbed silently.
 */
async function send(v, type, data) {
  const body = { userId: v.session.subject, sessionId: v.session.sessionId, source: SOURCE, type, data,
    ...(v.entry && Object.keys(v.entry).length ? { entry: v.entry } : {}) };
  let r = await call('/realtime/action', { visitor: v, body });
  if (!r.ok) {
    const why = r.body && r.body.error ? ` (${String(r.body.error).slice(0, 80)})` : '';
    await sleep(600);
    r = await call('/realtime/action', { visitor: v, body });
    transient.push(`${type} → ${why ? `${why.trim()} ` : ''}refused once; asked again → ${r.status}`);
  }
  return r;
}
const sendCustom = (v, event, data) => send(v, 'custom', { event, ...data });
/**
 * creditDecided(): a click on any control inside a decided container (a module,
 * a plan card) is also that container's reward, one content_click per nesting
 * level, sent together before the control's own event. They move contentType on
 * her vector, so a replay without them measures a different page.
 */
const credit = (v, ...decisions) => Promise.all(decisions.filter(Boolean).map((d) =>
  send(v, 'content_click', { contentId: d.contentId, slot: d.slot, decisionId: d.decisionId, customerContentId: d.customerContentId })));
const moduleOf = (set, cid) => (set.modules || []).find((d) => d.customerContentId === cid) || null;
/** One snapshot, as ask() builds it: the landing entry on every one, ctx.region when asserted, ctx.intent always. */
async function ask(v, pageKey) {
  const q = new URLSearchParams({ page: pageKey });
  if (v.entry && Object.keys(v.entry).length) q.set('entry', JSON.stringify(v.entry));
  if (page.region) q.set('ctx.region', page.region);
  q.set('ctx.intent', v.intent || 'new');
  const r = await call(`/v1/${TENANT}/decisions/snapshot?${q}`, { visitor: v });
  if (!r.ok || !Array.isArray(r.body.decisions)) throw new Error(`the decision service answered ${r.status} ${r.body.error || ''}`);
  const by = (slot) => r.body.decisions.filter((d) => d.slot === slot).sort((a, b) => a.order - b.order);
  return { ms: r.ms, arm: r.body.arm, asked: { intent: q.get('ctx.intent'), region: q.get('ctx.region') }, all: r.body.decisions,
    hero: by('hero'), deals: by('deals'), modules: by('pdp-modules'), plans: by('plan-pairing') };
}
async function meters(v) {
  const r = await call('/realtime/reflex', { visitor: v });
  return { dims: (r.body.affinity && r.body.affinity.dims) || {}, audiences: (r.body.affinity && r.body.affinity.audiences) || [], stage: r.body.journeyStage };
}
const a = (m, dim, value) => Number(((m.dims[dim] || {})[value]) || 0);
async function sortRail(v) {
  const candidates = phonesDoc.phones.map((p) => ({ id: p.id, brand: p.brand, ecosystem: eco(p), os: eco(p), price_usd: Number(p.price_usd) }));
  const r = await call('/sort', { visitor: v, body: { userId: v.session.subject, sessionId: v.session.sessionId, candidates, weights: (phonesDoc.rail || {}).weights || { affinity: 1 } } });
  return r.ok && Array.isArray(r.body.order) ? r.body.order : null;
}
/** What refreshHome() asks: the snapshot, then the rail and the meters. */
async function refreshHome(v) { const set = await ask(v, 'home'); const rail = await sortRail(v); const m = await meters(v); return { ...set, rail, m }; }
async function refreshPhone(v) { const set = await ask(v, 'phone'); const m = await meters(v); return { ...set, m }; }
/** The full records behind decisions, as prefetchReceipts() asks: 202 while the ledger consumer writes, every 2 s, ten times. */
async function receipts(v, decisions, asked) {
  const want = [...new Set(decisions.map((d) => d.decisionId).filter(Boolean))].slice(0, 12);
  const got = new Map();
  const context = asked && asked.intent ? { intent: asked.intent, ...(asked.region ? { region: asked.region } : {}) } : undefined;
  for (let attempt = 0; attempt < 10 && got.size < want.length; attempt += 1) {
    const r = await call('/vantage/api/receipt', { visitor: v, body: { decisionIds: want.filter((id) => !got.has(id)), ...(context ? { context } : {}) } });
    for (const rec of r.body.records || []) got.set(rec.decision_id, rec);
    if (got.size >= want.length || !(r.status === 200 || r.status === 202)) break;
    await sleep(2000);
  }
  return got;
}
const recOf = (recs, d) => (d && recs.get(d.decisionId)) || null;
async function coldstart(region) {
  const r = await call(`/vantage/api/coldstart${region ? `?region=${encodeURIComponent(region)}` : ''}`);
  return r.ok ? r.body : null;
}
let A = null;                                  // shopper A, the visitor the room follows
let home = null, phoneSet = null, thirdTouchAt = 0;

try {
  const openCatalog = (await assetJson('beats/open-catalog.json')).publish.document;
  const pieceRule = (id) => (openCatalog.pieces.find((p) => p.customerContentId === id) || {}).eligibleWhen || null;
  const intentsOf = (id) => ((pieceRule(id) || {}).context || {}).intent || null;
  const newLineOnly = openCatalog.pieces.filter((p) => (p.slotTypes || []).includes('deals'))
    .filter((p) => { const i = intentsOf(p.customerContentId); return Array.isArray(i) && i.every((x) => x === 'new' || x === 'add-line'); })
    .map((p) => p.customerContentId);

  // ════════════════════════ Act 1 · The arrival ════════════════════════
  console.log('\n── 1 · A stranger lands from the paid-social ad, in New York');
  const reset = await demoRoute('/vantage/api/reset', {});
  ok('the tenant is reset to its opening state', (reset.applied || []).map((x) => x.name).join(',') === 'open-slots,open-catalog',
    (reset.applied || []).map((x) => `${x.name}@${x.revision}`).join(' '));
  A = await mintVisitor(AD_ENTRY, 'Shopper A');
  ok('a visitor is minted with consent, carrying the landing entry', Boolean(A.session.subject), `${A.entry.utmMedium} · ${A.entry.utmSource} · term ${A.entry.utmTerm}`);
  page.region = NY;
  const csNY = await coldstart(NY);
  ok('the cold-start panel answers for New York at state grain', csNY && csNY.region.key === NY && csNY.grain === 'state' && csNY.census.label === 'New York',
    csNY ? `${csNY.census.label} · ${csNY.grain} · ${csNY.census.estimate} · $${csNY.census.medianHouseholdIncomeUsd}` : 'no answer');
  ok('the census is shown and never scored', csNY && csNY.scored && csNY.scored.census === false && /^ACS 2024 1-year$/.test(csNY.census.estimate));
  ok('the regional lean is in force, labelled synthetic → warehouse', csNY && csNY.lean.inForce && csNY.lean.dataSource === 'synthetic' && csNY.lean.swapTo === 'warehouse',
    csNY ? `${csNY.lean.events} synthetic sales · leaders ${JSON.stringify(csNY.lean.leaders)}` : '');
  ok('the panel says the sentence', csNY && csNY.sentence === 'aggregate, never the individual; we curate, never price.');
  await send(A, 'page_view', { page: 'home' });
  home = await refreshHome(A);
  info(`hero ${fmt(home.hero)} | deals ${fmt(home.deals)} | ${home.ms} ms`);
  ok('the hero answers the ad: the launch hero', ids(home.hero)[0] === 'hero-launch');
  ok('the four answer the ad: the iPhone 18 Pro launch offer first', ids(home.deals)[0] === IDS.launch && home.deals.length === 4);
  ok('and the region: the iPhone Duo pre-order second on the New York lean', ids(home.deals)[1] === IDS.duo);
  ok('her own meters are empty: nothing about her is known yet', Object.keys(home.m.dims).length === 0);
  const r1 = await receipts(A, [...home.hero, ...home.deals], home.asked);
  const launchRec = recOf(r1, home.deals[0]);
  ok('the launch receipt itemises the campaign seed', launchRec && launchRec.explain.contextual && Number(launchRec.explain.contextual.applied) > 0
    && (launchRec.explain.contextual.drivers || []).some((x) => x.signal === 'campaign_term' && x.value === AD_ENTRY.utmTerm),
    launchRec ? `campaign_term “${AD_ENTRY.utmTerm}” +${launchRec.explain.contextual.applied}` : 'no record');
  ok('the receipt returns the asserted context, each with its provenance',
    launchRec && launchRec.asserted && launchRec.asserted['ctx.region'] && launchRec.asserted['ctx.region'].value === NY && launchRec.asserted['ctx.region'].from === 'record'
    && launchRec.asserted['ctx.intent'] && launchRec.asserted['ctx.intent'].value === 'new' && launchRec.asserted['ctx.intent'].from === 'request',
    launchRec ? JSON.stringify(launchRec.asserted) : 'no record');
  const heroRec = recOf(r1, home.hero[0]);
  ok('the hero answers the ad too: its receipt itemises the campaign seed', heroRec && heroRec.explain.contextual && Number(heroRec.explain.contextual.applied) > 0
    && (heroRec.explain.contextual.drivers || []).some((x) => x.signal === 'campaign_term'),
    heroRec && heroRec.explain.contextual ? `${heroRec.customer_item_id} campaign +${heroRec.explain.contextual.applied}` : 'no campaign on the hero record');
  ok('the record names the regional prior as asserted', launchRec && launchRec.explain.regional && launchRec.explain.regional.region === NY && launchRec.explain.regional.asserted === true,
    launchRec && launchRec.explain.regional ? `λ ${launchRec.explain.regional.lambda} · ${launchRec.explain.regional.events} events` : '');
  ok('and the record carries no visitor or session id', launchRec && !('visitor_id' in launchRec) && !('session_id' in launchRec));
  const beat1Four = ids(home.deals);

  console.log('\n── 2 · The same visitor, asserted in Texas');
  page.region = TX;
  const csTX = await coldstart(TX);
  ok('the cold-start panel answers for Texas', csTX && csTX.region.key === TX && csTX.census.label === 'Texas' && csTX.lean.dataSource === 'synthetic',
    csTX ? `${csTX.census.label} · ${csTX.grain} · $${csTX.census.medianHouseholdIncomeUsd} · ${csTX.lean.events} synthetic sales, leaders ${JSON.stringify(csTX.lean.leaders)}` : 'no answer');
  home = await refreshHome(A);
  info(`hero ${fmt(home.hero)} | deals ${fmt(home.deals)}`);
  ok('the same four, reordered: only the region changed', JSON.stringify([...ids(home.deals)].sort()) === JSON.stringify([...beat1Four].sort())
    && JSON.stringify(ids(home.deals)) !== JSON.stringify(beat1Four));
  ok('the Galaxy S26 offer second on the Texas lean', ids(home.deals)[1] === 'promo-galaxy-s26-new-line');
  ok('her meters did not move: a region is context, never evidence', Object.keys(home.m.dims).length === 0);
  const r2 = await receipts(A, home.deals.slice(0, 1), home.asked);
  const rec2 = recOf(r2, home.deals[0]);
  ok('the receipt names the region as asserted', rec2 && rec2.asserted && rec2.asserted['ctx.region'] && rec2.asserted['ctx.region'].value === TX,
    rec2 ? JSON.stringify(rec2.asserted['ctx.region']) : 'no record');
  {
    // The control: a visitor who did not come from the ad, in the same region, opens on Galaxy (L4's measurement).
    const direct = await mintVisitor({}, 'direct');
    await send(direct, 'page_view', { page: 'home' });
    const d = await ask(direct, 'home');
    info(`control, no ad, Texas: ${fmt(d.deals)}`);
    ok('control: without the ad, Texas opens on the Galaxy S26 offer, so the ad is what put the launch first', ids(d.deals)[0] === 'promo-galaxy-s26-new-line');
  }

  // ════════════════════════ Act 2 · The visitor earns it ════════════════════════
  console.log('\n── 3 · She browses Samsung: the S26 card, its page, the S26 Ultra card (back in New York)');
  page.region = NY;
  await coldstart(NY);
  await send(A, 'page_view', { page: 'phones' }); await meters(A);
  const touched = [];
  let onGrid = true;
  for (const t of TOUCHES) {
    const p = phone(t.id);
    if (t.view === 'page') {
      await send(A, 'product_view', phoneAttrs(p, { price_usd: Number(optionsOf(p)[0].price_usd), view: 'page' }));
      A.config = { phoneId: p.id, storage: optionsOf(p)[0].storage };
      phoneSet = await refreshPhone(A);
      onGrid = false;
    } else {
      if (!onGrid) { await send(A, 'page_view', { page: 'phones' }); await meters(A); onGrid = true; }
      await send(A, 'product_view', phoneAttrs(p, { view: 'card' }));
    }
    const m = await meters(A);
    touched.push(`${p.name} ${t.view}: samsung ${a(m, 'brand', 'samsung').toFixed(3)}`);
    if (p.brand === 'samsung') thirdTouchAt = Date.now();
  }
  touched.forEach(info);
  const m3 = await meters(A);
  ok(`brand samsung crosses the ${THETA_IN} entry threshold on the third touch (measured 0.61 to 0.62)`, a(m3, 'brand', 'samsung') >= THETA_IN, a(m3, 'brand', 'samsung').toFixed(3));
  ok('she joins the audience', m3.audiences.includes('brand_samsung_affinity'), m3.audiences.join(', '));
  ok('ecosystem android and price band accumulate with it', a(m3, 'ecosystem', 'android') > 0.5 && a(m3, 'priceBand', 'premium') > 0,
    `android ${a(m3, 'ecosystem', 'android').toFixed(3)} · premium ${a(m3, 'priceBand', 'premium').toFixed(3)} · core ${a(m3, 'priceBand', 'core').toFixed(3)}`);

  console.log('\n── 4 · The hinge: the Pixel 11 page, then home');
  {
    const p = phone(HINGE);
    // From the phones grid, the page opens the Pixel straight from its card: no extra page view.
    await send(A, 'product_view', phoneAttrs(p, { price_usd: Number(optionsOf(p)[0].price_usd), view: 'page' }));
    A.config = { phoneId: p.id, storage: optionsOf(p)[0].storage };
    phoneSet = await refreshPhone(A);
  }
  await send(A, 'page_view', { page: 'home' });
  home = await refreshHome(A);
  info(`hero ${fmt(home.hero)} | deals ${fmt(home.deals)} | samsung ${a(home.m, 'brand', 'samsung').toFixed(3)} android ${a(home.m, 'ecosystem', 'android').toFixed(3)}`);
  ok('the Galaxy S26 offer leads the four', ids(home.deals)[0] === 'promo-galaxy-s26-new-line');
  ok('the lifted launch offer falls to fourth', ids(home.deals)[3] === IDS.launch, `at ${ids(home.deals).indexOf(IDS.launch) + 1}`);
  ok('Android offers now hold the containers above it', home.deals.slice(0, 3).every((d) => (d.explain.drivers || []).some((x) => x.dim === 'ecosystem' && x.value === 'android')));
  ok(`brand samsung is still a member, above the ${THETA_OUT} exit threshold`, a(home.m, 'brand', 'samsung') >= THETA_OUT && home.m.audiences.includes('brand_samsung_affinity'),
    a(home.m, 'brand', 'samsung').toFixed(3));
  const r4 = await receipts(A, home.deals, home.asked);
  const seeded = home.deals.map((d) => recOf(r4, d)).find((rec) => rec && rec.explain.contextual && Number(rec.explain.contextual.applied) > 0);
  ok('campaign context superseded by observed behaviour: the seed is still applied, and outscored',
    seeded && seeded.customer_item_id === IDS.launch && ids(home.deals).indexOf(IDS.launch) > 0,
    seeded ? `${seeded.customer_item_id} carries campaign +${seeded.explain.contextual.applied}, now at ${ids(home.deals).indexOf(IDS.launch) + 1}` : 'no seeded record');
  const fourAtHinge = ids(home.deals);

  console.log(`\n── 5 · She stops touching it: the page asks again ${EXIT_WAIT} s after her last Samsung touch`);
  {
    const before = await meters(A);
    info(`before the minute: samsung ${a(before, 'brand', 'samsung').toFixed(3)} · android ${a(before, 'ecosystem', 'android').toFixed(3)}`);
    const wait = thirdTouchAt + EXIT_WAIT * 1000 - Date.now();
    if (wait > 0) await sleep(wait);
    home = await refreshHome(A);
    const after = home.m;
    info(`re-asked ${((Date.now() - thirdTouchAt) / 1000).toFixed(0)} s after the touch: samsung ${a(after, 'brand', 'samsung').toFixed(3)} · android ${a(after, 'ecosystem', 'android').toFixed(3)} | deals ${fmt(home.deals)}`);
    ok(`the Samsung claim withdraws: brand samsung under the ${THETA_OUT} exit threshold on her meter (measured 0.35)`, a(after, 'brand', 'samsung') < THETA_OUT,
      a(after, 'brand', 'samsung').toFixed(3));
    // The session host decays at read but re-evaluates audience flags only at her next event (the object host's alarm does it on time).
    info(`audience flag at the re-ask: ${after.audiences.includes('brand_samsung_affinity') ? 'brand_samsung_affinity still listed until her next event (session host; recorded in L5.md)' : 'brand_samsung_affinity withdrawn'}`);
    ok(`the Android lean holds (measured 0.69)`, a(after, 'ecosystem', 'android') >= THETA_IN, a(after, 'ecosystem', 'android').toFixed(3));
    const samsungDrivers = home.deals.map((d) => (d.explain.drivers || []).find((x) => x.dim === 'brand' && x.value === 'samsung')).filter(Boolean);
    ok('the Galaxy receipts lose their Samsung driver under the exit threshold', samsungDrivers.length > 0 && samsungDrivers.every((x) => Number(x.a) < THETA_OUT),
      samsungDrivers.map((x) => Number(x.a).toFixed(3)).join(', '));
    ok('the Galaxy S26 offer still leads on her Android lean', ids(home.deals)[0] === 'promo-galaxy-s26-new-line');
    const held = JSON.stringify(ids(home.deals)) === JSON.stringify(fourAtHinge);
    info(held ? 'the four kept their order (as L1 measured): ranking is continuous and Android still carries them'
      : 'the four reordered below the lead (L2 measured this too); never promise either on stage');
  }

  // ════════════════════════ Act 3 · The phone page follows intent ════════════════════════
  console.log('\n── 6 · She opens the Galaxy S26');
  {
    const p = phone(FOCUS);
    // openPhoneVia(): from the homepage, the rail's card when the rail holds it; otherwise Phones, then its card.
    const onRail = (home.rail || []).slice(0, (phonesDoc.rail || {}).take || 6).includes(FOCUS);
    if (!onRail) await send(A, 'page_view', { page: 'phones' });
    info(onRail ? 'opened from the "Phones for you" rail' : 'opened from the phones grid (not on the rail)');
    await send(A, 'product_view', phoneAttrs(p, { price_usd: Number(optionsOf(p)[0].price_usd), view: 'page' }));
    A.config = { phoneId: p.id, storage: optionsOf(p)[0].storage };
    phoneSet = await refreshPhone(A);
  }
  info(`modules ${fmt(phoneSet.modules)} | plans ${fmt(phoneSet.plans)}`);
  ok('six modules below the buy box', phoneSet.modules.length === 6);
  const top2 = ids(phoneSet.modules).slice(0, 2).sort().join(',');
  ok('storage & memory and protection lead, on the premium band she earned (measured 0.085)', top2 === 'protection,storage-memory'
    && phoneSet.modules.slice(0, 2).every((d) => Number(d.score) > 0 && (d.explain.drivers || []).some((x) => x.dim === 'priceBand' && x.value === 'premium')));
  ok('pair with a plan opens on its default order', ids(phoneSet.plans).join(',') === 'plan-simple,plan-go,plan-more');
  {
    // The Compare tool's frame: a fresh visitor in the same region, who has sent nothing.
    const fresh = await mintVisitor({}, 'Fresh visitor');
    const f = await ask(fresh, 'phone');
    info(`control, a fresh New York visitor: ${fmt(f.modules)}`);
    ok('control: a fresh visitor opens on the region’s premium lean, not the template (measured 0.2)',
      ids(f.modules).slice(0, 2).sort().join(',') === 'protection,storage-memory' && ids(f.modules).join(',') !== (anchor.templates.modules || []).slice(0, 6).join(','));
  }

  console.log('\n── 7 · She steps to 512 GB, compares storage, then the camera');
  {
    const p = phone(FOCUS);
    const step = optionsOf(p)[1];
    await sendCustom(A, 'select', { control: 'storage', productId: p.id, storage: step.storage, price_usd: Number(step.price_usd) }); await meters(A);
    A.config.storage = step.storage;
    await credit(A, moduleOf(phoneSet, 'storage-memory'));               // "Compare storage and camera" sits inside the module
    await sendCustom(A, 'compare', { spec: 'storage', productId: p.id, storage: step.storage, price_usd: Number(step.price_usd), contentType: 'compare' }); await meters(A);
    await sendCustom(A, 'compare', { spec: 'camera', productId: p.id, brand: p.brand, os: eco(p), ecosystem: eco(p), price_usd: Number(step.price_usd), contentType: 'compare' }); await meters(A);
    phoneSet = await refreshPhone(A);
    info(`modules ${fmt(phoneSet.modules)} | premium ${a(phoneSet.m, 'priceBand', 'premium').toFixed(3)} compare ${a(phoneSet.m, 'contentType', 'compare').toFixed(3)}`);
    ok('storage & memory rises to first (measured 0.286)', ids(phoneSet.modules)[0] === 'storage-memory');
    ok('protection follows the premium band, second (measured 0.163)', ids(phoneSet.modules)[1] === 'protection');
    ok(`the 512 GB step is +$${Number(step.deltaMonthly).toFixed(2)}/mo, the catalog's own delta`, Math.abs(Number(step.deltaMonthly) - 5.56) < 0.005, `${step.label || step.storage} ${step.price_usd}`);
  }

  console.log('\n── 8 · She opens the hotspot & travel starter on Unlimited More');
  {
    const before = ids(phoneSet.modules).indexOf('plan-pairing');
    // The starter sits on the Unlimited More card, inside Pair with a plan: both are credited.
    const moreCard = (phoneSet.plans || []).find((d) => d.customerContentId === 'plan-more');
    ok('the Unlimited More card is on her phone page to press', Boolean(moreCard && moduleOf(phoneSet, 'plan-pairing')), ids(phoneSet.plans).join(', '));
    await credit(A, moreCard, moduleOf(phoneSet, 'plan-pairing'));
    await send(A, 'page_view', { page: 'perk', category: 'plans', perk: 'hotspot-travel' }); await meters(A);
    phoneSet = await refreshPhone(A);
    info(`modules ${fmt(phoneSet.modules)} | plans ${fmt(phoneSet.plans)}`);
    ok(`pair with a plan rises, ${before + 1} → ${ids(phoneSet.modules).indexOf('plan-pairing') + 1} (measured fifth to second)`, ids(phoneSet.modules).indexOf('plan-pairing') === 1);
    ok('Unlimited More leads the plans (measured 0.114)', ids(phoneSet.plans)[0] === 'plan-more');
    // The Compare tool's second shopper, as the page runs it: a direct visitor on the Pro Max who opens the streaming starter.
    const shopperB = await mintVisitor({}, 'Shopper B');
    const ss = anchor.streamingShopper || { phone: 'iphone-18-pro-max', perk: 'streaming' };
    const pb = phone(ss.phone);
    await send(shopperB, 'product_view', phoneAttrs(pb, { price_usd: Number(optionsOf(pb)[0].price_usd), view: 'page' }));
    const b0 = await ask(shopperB, 'phone');
    // The page presses the streaming starter on the Max card if Max is offered, else the first card with a streaming perk.
    const maxCard = b0.plans.find((d) => d.customerContentId === 'plan-max') || b0.plans.find((d) => d.customerContentId !== 'plan-simple');
    await credit(shopperB, maxCard, moduleOf(b0, 'plan-pairing'));
    await send(shopperB, 'page_view', { page: 'perk', category: 'plans', perk: ss.perk || 'streaming' });
    const b = await ask(shopperB, 'phone');
    info(`the streaming shopper: plans ${fmt(b.plans)}`);
    ok('the streaming shopper beside her: Unlimited Max leads (measured 0.101)', ids(b.plans)[0] === 'plan-max');
  }

  console.log('\n── 9a · Four lines, then the kids’ watch, then back');
  {
    A.lines = 4;
    await credit(A, moduleOf(phoneSet, 'plan-pairing'));                 // the line selector sits inside Pair with a plan
    await sendCustom(A, 'select', { control: 'lines', lines: 'family', count: 4 }); await meters(A);
    if (moduleOf(phoneSet, 'connected-devices')) {
      await credit(A, moduleOf(phoneSet, 'connected-devices'));          // the kids' watch link sits inside the connected-devices module
      await send(A, 'page_view', KIDS_WATCH);
    } else { await send(A, 'page_view', { page: 'add-a-line', intent: 'add-line' }); await send(A, 'page_view', KIDS_WATCH); }
    await meters(A);
    phoneSet = await refreshPhone(A);                // Back to the phone page: asked again, no new view
    info(`modules ${fmt(phoneSet.modules)} | plans ${fmt(phoneSet.plans)}`);
    ok('watch, tablet and more lines rises to first (measured 0.29)', ids(phoneSet.modules)[0] === 'connected-devices');
    ok('the family starter, Unlimited Go, leads the plans (measured 0.145)', ids(phoneSet.plans)[0] === 'plan-go');
    ok('lines family moved on her own behaviour', a(phoneSet.m, 'lines', 'family') > 0.5, a(phoneSet.m, 'lines', 'family').toFixed(3));
  }
  console.log('\n── 9b · Home: the family hero, and the four-line offer');
  await send(A, 'page_view', { page: 'home' });
  home = await refreshHome(A);
  info(`hero ${fmt(home.hero)} | deals ${fmt(home.deals)}`);
  ok('the family hero leads the page', ids(home.hero)[0] === IDS.familyHero);
  ok('the four-line offer enters the four (measured first, level with the watch line)', ids(home.deals).includes(IDS.family), `at ${ids(home.deals).indexOf(IDS.family) + 1}`);

  console.log('\n── 10a · She will bring her own phone');
  phoneSet = await refreshPhone(A);                  // the browser's Back: the phone page restored, asked again
  A.intent = 'byod';
  await sendCustom(A, 'select', { control: 'intent', intent: 'byod' });
  phoneSet = await refreshPhone(A);
  info(`plans ${fmt(phoneSet.plans)} | intent ${JSON.stringify(phoneSet.m.dims.intent || {})}`);
  ok('Simple leads pair with a plan for the switcher (measured 0.245)', ids(phoneSet.plans)[0] === 'plan-simple');
  ok('her answer is also behaviour: intent byod moved', a(phoneSet.m, 'intent', 'byod') > 0.4, a(phoneSet.m, 'intent', 'byod').toFixed(3));
  console.log('\n── 10b · Home: the switcher’s homepage');
  await send(A, 'page_view', { page: 'home' });
  home = await refreshHome(A);
  info(`hero ${fmt(home.hero)} | deals ${fmt(home.deals)}`);
  ok('the switch hero leads (measured 0.245)', ids(home.hero)[0] === IDS.switchHero);
  ok('bring your phone is in the four on her declared answer (measured second, 0.522)', ids(home.deals).includes(IDS.byod), `at ${ids(home.deals).indexOf(IDS.byod) + 1}`);
  ok('the watch-and-tablet line leads, on her added line and four lines (measured 0.592)', ids(home.deals)[0] === 'promo-watch-tablet-line');
  ok('the iPhone Duo pre-order fails closed: it is for device purchases', !ids(home.deals).includes(IDS.duo));
  ok('every offer that needs a new line fails closed', ids(home.deals).every((id) => !newLineOnly.includes(id)), ids(home.deals).filter((id) => newLineOnly.includes(id)).join(', '));
  const r10 = await receipts(A, home.deals.slice(0, 1), home.asked);
  const rec10 = recOf(r10, home.deals[0]);
  ok('the receipt names her answer as asserted, from the request', rec10 && rec10.asserted && rec10.asserted['ctx.intent'] && rec10.asserted['ctx.intent'].value === 'byod'
    && rec10.asserted['ctx.intent'].from === 'request', rec10 ? JSON.stringify(rec10.asserted) : 'no record');

  console.log('\n── 10c · Then she is upgrading');
  phoneSet = await refreshPhone(A);                  // Back again
  const protectionBefore = moduleOf(phoneSet, 'protection');
  A.intent = 'upgrade';
  await sendCustom(A, 'select', { control: 'intent', intent: 'upgrade' });
  phoneSet = await refreshPhone(A);
  info(`modules ${fmt(phoneSet.modules)} | plans ${fmt(phoneSet.plans)}`);
  ok('Unlimited More leads for the trade-in shopper (measured 0.356)', ids(phoneSet.plans)[0] === 'plan-more');
  {
    // Protection is watched, not claimed (the lead's ruling after R1): L1 measured it above Pair with a plan on a
    // replay without the page's content clicks; on the page's own path whether it passes depends on timing.
    const now = moduleOf(phoneSet, 'protection');
    info(`protection, watched: ${protectionBefore ? Number(protectionBefore.score).toFixed(3) : '?'} → ${now ? Number(now.score).toFixed(3) : '?'}, `
      + `at ${ids(phoneSet.modules).indexOf('protection') + 1} with Pair with a plan at ${ids(phoneSet.modules).indexOf('plan-pairing') + 1}`);
  }
  A.plan = String(ids(phoneSet.plans)[0]).replace(/^plan-/, '');
  await credit(A, phoneSet.plans[0], moduleOf(phoneSet, 'plan-pairing')); // "Choose" sits on the leading plan card, inside the module
  await sendCustom(A, 'select', { control: 'plan', plan: A.plan }); await meters(A);
  console.log('\n── 10d · Home: the upgrade offer leads');
  await send(A, 'page_view', { page: 'home' });
  home = await refreshHome(A);
  info(`hero ${fmt(home.hero)} | deals ${fmt(home.deals)}`);
  ok('the Galaxy S26 Ultra upgrade offer leads (measured 0.844)', ids(home.deals)[0] === IDS.upgradeAndroid);
  ok('the new-line offers leave: their rule needs a new line', ids(home.deals).every((id) => !newLineOnly.includes(id)), ids(home.deals).filter((id) => newLineOnly.includes(id)).join(', '));

  // ════════════════════════ Act 4 · The merchandiser's day ════════════════════════
  console.log('\n── 11 · Two weeks pass (her answer back to a new line, labelled)');
  A.intent = 'new';
  const turns11 = (await assetJson('beats/11-two-weeks-pass.json')).turnsOn || {};
  const pub11 = await demoRoute('/vantage/api/beat', { kind: 'catalog', name: '11-two-weeks-pass', note: 'page rehearsal: two weeks pass' });
  ok('the catalog beat publishes by name', pub11.ok === true && pub11.kind === 'catalog', `revision ${pub11.revision}`);
  home = await refreshHome(A);
  info(`hero ${fmt(home.hero)} | deals ${fmt(home.deals)}`);
  ok('the Pixel 11 launch offer leaves: its window closed', !ids(home.deals).includes(turns11.leaves || IDS.closesAtBeat11));
  ok('its successor takes container one (measured 0.821)', ids(home.deals)[0] === (turns11.arrives || IDS.successorAtBeat11));
  ok('the flash offer closed with it', (turns11.alsoCloses || []).every((id) => !ids(home.deals).includes(id)));

  console.log('\n── 12 · Black Friday arrives');
  await demoRoute('/vantage/api/beat', { kind: 'catalog', name: '12-black-friday', note: 'page rehearsal: Black Friday arrives' });
  home = await refreshHome(A);
  info(`deals ${fmt(home.deals)}`);
  ok('the switcher offer, no history at all, takes container one on its metadata (measured 0.845)', ids(home.deals)[0] === IDS.blackFriday);

  console.log('\n── 13 · Pin the iPhone Duo pre-order for everyone');
  await demoRoute('/vantage/api/beat', { kind: 'slots', name: '13-pin-duo-preorder', note: 'page rehearsal: the Duo pinned' });
  home = await refreshHome(A);
  info(`deals ${fmt(home.deals)}`);
  ok('the pre-order holds container one, pinned: ranking skipped', ids(home.deals)[0] === IDS.duo && home.deals[0].strategy === 'tenant-pinned');
  ok('the other three are still ranked for her, Black Friday second', ids(home.deals)[1] === IDS.blackFriday && home.deals.slice(1).every((d) => d.strategy !== 'tenant-pinned'));

  console.log('\n── 14a · 5G Home where it is available: New York');
  page.region = COVERED;
  phoneSet = await refreshPhone(A);                  // Back to the phone page
  await send(A, 'page_view', { page: 'home-internet', category: 'home-internet', intent: 'home' }); await meters(A);
  await sendCustom(A, 'start_order', { control: 'address', category: 'home-internet', intent: 'home', contentType: 'tool' }); await meters(A);
  phoneSet = await refreshPhone(A);                  // back to the phone page
  info(`modules ${fmt(phoneSet.modules)}`);
  ok('add home internet is eligible in New York and rises to the top two on her address check (measured first, 0.349)', ids(phoneSet.modules).slice(0, 2).includes('home-bundle'),
    `at ${ids(phoneSet.modules).indexOf('home-bundle') + 1}`);
  console.log('\n── 14b · The same shopper in Montana');
  page.region = UNCOVERED;
  const csMT = await coldstart(UNCOVERED);
  info(`cold start: ${csMT ? `${csMT.region.key} · ${csMT.grain}${csMT.census && csMT.census.fellBack ? ` · ${csMT.census.fellBack}` : ''}` : 'no answer'}`);
  phoneSet = await refreshPhone(A);
  info(`modules ${fmt(phoneSet.modules)}`);
  ok('add home internet leaves the six: still published, not eligible here', !ids(phoneSet.modules).includes('home-bundle'));
  {
    // The same rule on the homepage, as a request-level pair (the page shows the pair on the phone page).
    const mt = await ask(A, 'home');
    page.region = COVERED;
    const ny = await ask(A, 'home');
    info(`homepage, Montana: ${fmt(mt.deals)} | New York: ${fmt(ny.deals)}`);
    ok('on the homepage the 5G Home offer is in the four in New York (measured second, behind the pin)', ids(ny.deals).includes(IDS.homeBundle));
    ok('and absent in Montana: the rule fails closed', !ids(mt.deals).includes(IDS.homeBundle));
  }

  // ════════════════════════ Act 5 · Order and metric ════════════════════════
  console.log('\n── 15a · She adds the phone to her cart and comes back (New York)');
  page.region = NY;
  await coldstart(NY);
  {
    const p = phone(FOCUS);
    const o = optionsOf(p).find((x) => x.storage === A.config.storage) || optionsOf(p)[0];
    await send(A, 'add_to_cart', phoneAttrs(p, { storage: o.storage, price_usd: Number(o.price_usd) })); await meters(A);
  }
  await send(A, 'page_view', { page: 'home' });
  home = await refreshHome(A);
  info(`hero ${fmt(home.hero)} | deals ${fmt(home.deals)} | stage ${home.m.stage}`);
  ok('her first cart add makes her deciding', home.m.stage === 'deciding', home.m.stage);
  ok('so the continue hero takes the hero (measured 0.5)', ids(home.hero)[0] === IDS.continueHero);
  const four15 = ids(home.deals);

  console.log('\n── 15b · Tomorrow’s template puts the deals module first');
  const t15 = await ask(A, 'home');
  ok('the same four in the same order: the slot is asked by name, wherever the template paints it', JSON.stringify(ids(t15.deals)) === JSON.stringify(four15), fmt(t15.deals));

  console.log('\n── 15c · Two clicks, and the day report');
  {
    const date = new Date().toISOString().slice(0, 10);
    /**
     * The day report as the page builds it: one whole UTC day, no slot or hour filter. Two paths
     * (src/learn/hourly.ts runDayReport): once any hour is folded (the hosted worker's five-minute cron) it
     * sums the folded hours only, so a click appears after its hour closes and the next fold runs; with no
     * hour folded (wrangler dev never runs the cron) it reads the day's raw ledger and refuses past
     * REPORT_LIMITS.rawBytes (16 MiB, src/learn/report.ts) with a 413 (lane F1 measured 16.8 MB).
     */
    const BUDGET = 'the day report is refused (413): with no hour folded the UTC day is read raw, past REPORT_LIMITS.rawBytes (16 MiB); '
      + 'fold the hours with the local cron (RESUME-vantage.md)';
    // The route answers the refusal as a 502 naming "(413)" (before lane F1) or as a 413 of its own (after).
    const report = async (slot) => demoRoute('/vantage/api/report', { date, slot, build: true }).then((x) => x.report)
      .catch((error) => { throw new Error(/\(413\)|→ 413\b/.test(error.message) ? `${BUDGET} [${error.message.replace(/^.*→ /, '').slice(0, 120)}]` : error.message); });
    const cell = (rep, cid) => {
      const items = ((((rep || {}).grids || {}).deals || {}).learning || {}).items || {};
      const key = Object.keys(items).find((k) => k === cid || k.replace(/_/g, '-') === cid || k === cid.replace(/-/g, '_'));
      const c = key ? (items[key]['*'] || Object.values(items[key])[0]) : null;
      return c ? { n: Number(c.n) || 0, s: Number(c.s) || 0 } : { n: 0, s: 0 };
    };
    // The before-read is this suite's own (the page clicks first, then builds). A build raises
    // "Configuration publication authority unavailable" in LearnStats.priorsFor, and on the local
    // dev server an event that lands in that moment is refused 503 ("worker restarted mid-request"),
    // so the clicks wait for it to pass (docs/verizon/lanes/L5.md, findings).
    const before = await report('deals').catch((error) => { ok('the day report builds', false, error.message); return null; });
    await sleep(4000);
    const clicked = t15.deals.slice(0, 2);
    const s0 = clicked.map((d) => cell(before, d.customerContentId).s);
    for (const d of clicked) {
      const r = await send(A, 'content_click', { contentId: d.contentId, slot: d.slot, decisionId: d.decisionId, customerContentId: d.customerContentId });
      ok(`a click on ${short(d.customerContentId)}${d.strategy === 'tenant-pinned' ? ' (pinned)' : ''} is accepted for the decision that held it (${r.status})`, r.status === 200);
      const piece = (await assetJson('beats/open-catalog.json')).publish.document.pieces.find((p) => p.customerContentId === d.customerContentId) || {};
      if ((piece.tags && (piece.tags.category || []).includes('home-internet')) || (piece.eligibleWhen && piece.eligibleWhen.regions)) {
        await sendCustom(A, 'start_order', { control: 'address', category: 'home-internet', intent: 'home', contentType: 'tool' });
      }
    }
    let after = null, grew = [];
    if (before) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await sleep(3000);
        after = await report('deals').catch((error) => { ok('the day report builds after the clicks', false, error.message); return null; });
        if (!after) break;
        grew = clicked.map((d, i) => cell(after, d.customerContentId).s - s0[i]);
        if (grew.every((g) => g >= 0.9) || (after.hours && after.hours.source === 'aggregates')) break;
      }
    }
    if (after && after.hours && after.hours.source === 'aggregates') {
      info(`the report sums the folded hours (${(after.hours.built || []).length} built, ${(after.hours.missing || []).length} closed and unfolded): `
        + 'a click appears once its hour has closed and the next five-minute fold has run, never in the same second');
    } else if (after) {
      info(clicked.map((d, i) => `${short(d.customerContentId)}: clicks ${s0[i].toFixed(2)} → ${(s0[i] + grew[i]).toFixed(2)}`).join(' · '));
      ok('the day report grows by the clicks, credited per promotion (read from the ledger)', grew.length === 2 && grew.every((g) => g >= 0.9), grew.map((g) => `+${g.toFixed(2)}`).join(', '));
    }
    if (after) {
      ok('and labels itself attribution, not incrementality', after.measurement && after.measurement.kind === 'attribution_diagnostic' && after.measurement.inference === 'unavailable',
        after.measurement ? `${after.measurement.kind} · inference ${after.measurement.inference}` : 'no measurement block');
    }
    const moduleRows = async (build) => {
      try {
        const rep = (await demoRoute('/vantage/api/report', { date, slot: 'pdp-modules', ...(build ? { build: true } : {}) })).report;
        return { n: Object.keys(((((rep || {}).grids || {})['pdp-modules'] || {}).learning || {}).items || {}).length };
      } catch (error) { return { n: 0, error: error.message }; }
    };
    let mods = await moduleRows(false);
    if (!mods.n) { info(`module report, as the page reads it: ${mods.error || 'no rows'}; rebuilt once`); mods = await moduleRows(true); }
    ok(`per module too: the phone page’s modules have rows (${mods.n})`, mods.n > 0, mods.error || '');
  }
} catch (error) {
  failures += 1;
  console.log(`   ✗ the page path threw: ${error.message}`);
}

console.log('\n── The tenant is left at its opening state');
try {
  const reset = await demoRoute('/vantage/api/reset', {});
  ok('POST /vantage/api/reset republishes the opening slots, then the opening catalog', (reset.applied || []).map((x) => x.name).join(',') === 'open-slots,open-catalog');
  page.region = NY;
  const check = await mintVisitor(AD_ENTRY, 'after the reset');
  const d = await ask(check, 'home');
  ok('a new arrival from the ad opens on the launch offer again: no pin, no Black Friday', ids(d.deals)[0] === IDS.launch
    && d.deals.every((x) => x.strategy !== 'tenant-pinned') && !ids(d.deals).includes(IDS.blackFriday), fmt(d.deals));
} catch (error) {
  failures += 1;
  console.log(`   ✗ the reset failed: ${error.message}`);
}
if (transient.length) console.log(`\n   · the engine refused ${transient.length} event(s) once (an engine finding, not a page fault):\n     ${transient.join('\n     ')}`);

console.log(`\n${failures ? `✗ ${failures} of ${failures + passes} check(s) failed: the page is not ready to hand over` : `✓ ${passes} checks: the page works through its own path, with no manual step`}`);
process.exit(failures ? 1 : 0);
