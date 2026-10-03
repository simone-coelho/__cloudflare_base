#!/usr/bin/env node
// scripts/rehearse-oh-page.mjs: OH's page, at request level.
//
// The REQUEST-LEVEL rehearsal for the LG home demo (docs/lg/OH-Demo-Design.md). It replays what public/oh/oh.js
// sends for each beat the page lanes have built (the same session, consent, events, snapshots with their asserted
// context, beats by name, receipts and cold-start reads) and asserts each beat's declared effect, measured, not
// HTTP 200 alone. Its companion, rehearse-oh-dom.mjs, runs the page's own JavaScript in a real browser.
//
// It also proves the page can get there holding nothing the browser does not: no token is served or committed
// anywhere the page loads (its shells, every module it imports, every same-origin stylesheet and script, the kit,
// the data files and the imagery index); every API call leaves through the kit's doors with X-Tenant: oh; the
// beat route is a closed list that publishes its own copy and never a document from the request; a receipt answers
// the caller's own decisions only; and THE PAGE NEVER RANKS: its own code sorts no piece and does no arithmetic on
// a score (read in the code, comments stripped, as the Vantage suite reads the transport).
//
// Lane S1 (docs/lg/lanes/P.md) owns this file. The beats are read from public/oh/beats.json: a beat whose run is
// still `notBuilt` is reported as open, by lane, never passed; a built beat runs its outcomes below, in the order
// the director runs them. Scores move run to run (memory decays in real time), so the checks are on memberships,
// positions, labels and the claims the presenter makes.
//
//   node scripts/rehearse-oh-page.mjs [--base http://localhost:9120]
//   node scripts/demo-kit/rehearse.mjs --config oh --suite page --base <url>      (the same, through the kit)
//
// It holds no credential and takes no token: if this needs one, the page is broken. It ends with
// POST /oh/api/reset, so the tenant is left at its opening state.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEXT_FILE as TEXT, tokenFindings as tokenIn, walkFiles as walk } from './demo-kit/lib/credentials.mjs';
import { codeOnly, createChecks, createClient, flagReader, ids, sleep } from './demo-kit/lib/rehearse.mjs';

const arg = flagReader();
const base = arg('--base', 'http://localhost:9120').replace(/\/+$/, '');
const SLUG = 'oh', TENANT = 'oh', SOURCE = 'oh-demo', API = `/${SLUG}/api`;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const checks = createChecks({ infoIndent: 6 });
const { ok, info } = checks;
const client = createClient({ base, tenant: TENANT, source: SOURCE, assets: `/${SLUG}/`, api: API });
const { asset, assetJson, navigate, call, demoRoute } = client;
/**
 * Every JSON answer of the engine this suite reads, swept for the regional prior (lane S2; the ruling of 730eaa3, which
 * took priceTier off OH's regional allowlist): a regional block's dimensions (POST /sort's `regional`, a receipt's
 * `explain.regional`), the cold-start lean's leaders and shares, and on POST /sort's items the regional drivers, which the
 * engine emits one per touch the region shares (src/reflex/sortCandidates.ts), so an item can carry no more of them than
 * of its own drivers on allowlisted dimensions. The sweep watches the fetches the kit's client makes; it decides nothing.
 */
const REGIONAL = { answers: 0, blocks: 0, items: 0, hits: [], allow: null };
const fetch0 = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const res = await fetch0(url, init);
  try {
    const u = new URL(String(url && url.url ? url.url : url));
    if (/^\/(v1|sort|realtime|oh\/api)\b/.test(u.pathname) && /json/.test(res.headers.get('content-type') || '')) {
      const body = await res.clone().json().catch(() => null);
      if (body) { REGIONAL.answers += 1; sweepRegional(body, u.pathname); }
    }
  } catch { /* not an engine answer */ }
  return res;
};
function sweepRegional(node, where, key = '') {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const x of node) sweepRegional(x, where, key); return; }
  if ((key === 'regional' || key === 'lean') && (Array.isArray(node.dimensions) || node.leaders || node.share)) {
    REGIONAL.blocks += 1;
    const named = [...(node.dimensions || []), ...Object.keys(node.leaders || {}), ...Object.keys(node.share || {})];
    if (named.includes('priceTier')) REGIONAL.hits.push(`${where} ${key}: ${named.filter((d) => d === 'priceTier').length ? 'priceTier' : ''}`);
  }
  if (where === '/sort' && key === 'items' && Array.isArray(node.drivers) && node.id !== undefined && node.drivers.some((d) => d && d.dim === 'regional') && REGIONAL.allow) {
    REGIONAL.items += 1;
    const regional = node.drivers.filter((d) => d.dim === 'regional').length, allowed = node.drivers.filter((d) => REGIONAL.allow.includes(d.dim)).length;
    if (regional > allowed) REGIONAL.hits.push(`${where} item ${node.id}: ${regional} regional drivers for ${allowed} allowlisted touches`);
  }
  for (const [k, v] of Object.entries(node)) if (v && typeof v === 'object') sweepRegional(v, where, k);
}
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(base).hostname);
const fmt = (list) => (list || []).map((d) => `${d.customerContentId}${d.strategy === 'tenant-pinned' ? '(pin)' : ''} ${Number(d.score || 0).toFixed(3)}`).join(' · ');
const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const inCheckout = (p) => existsSync(join(ROOT, p));
/** A raw fetch, asked once more on a network error (a keep-alive socket the dev server closed), never on a status. */
const get = async (url, init) => { try { return await fetch(url, init); } catch { await new Promise((r) => setTimeout(r, 300)); return fetch(url, init); } };

console.log(`\nOH page rehearsal against ${base}`);

// ── The page and its documents ───────────────────────────────────────────────
console.log('\n── The page loads');
const demo = await assetJson('demo.config.json');
const anchor = await assetJson('beats/anchor.json');
const beatsDoc = await assetJson('beats.json');
const productsPath = (demo.products.file || '').replace(`public/${SLUG}/`, '');
const productsDoc = await assetJson(productsPath).catch(() => null);
const productList = (productsDoc && productsDoc[demo.products.list || 'products']) || [];
const SKU = demo.products.id || 'sku';
/** The shells, by family: the product page is one template for the TV, the washer and the range (design §2). */
const firstOf = (family, prefer) => (prefer && productList.find((p) => p[SKU] === prefer)) || productList.find((p) => p.family === family) || null;
const PDP = { tv: firstOf('oled-tv'), washer: firstOf('front-load-washer', 'WM1455HWA'), range: firstOf('electric-range') };
const shells = {};
const SHELLS = [['home', ''], ...Object.entries(PDP).filter(([, p]) => p).map(([k, p]) => [`product-${k}`, `product?id=${encodeURIComponent(p[SKU])}`]), ['phone', 'm'],
  ...(inCheckout(`public/${SLUG}/search.html`) ? [['search', 'search?q=oled']] : [])];   // S2: M1's search shell, served as a browser navigates
for (const [key, path] of [...SHELLS, ['js', `${SLUG}.js`], ['css', `${SLUG}.css`]]) {
  const isPage = !['js', 'css'].includes(key);
  const res = isPage ? await navigate(path) : await asset(path);
  shells[key] = res.ok ? await res.text() : '';
  ok(`/${SLUG}/${path || '(index)'} → ${res.status}${isPage ? ', as a browser navigates' : ''}`, res.ok && shells[key].length > 0);
}
const pageShells = SHELLS.map(([k]) => k);
/** The page's own settings, as oh.js carries them (the scaffold writes them from demo.config.json as one JSON literal). */
const PAGE_SITE = (() => { const m = /\bconst SITE = (\{[\s\S]*?\n\});/.exec(shells.js); try { return m ? JSON.parse(m[1]) : {}; } catch { return {}; } })();
ok('the home shell is the OH page', /data-entry="home"/.test(shells.home) && shells.home.includes(`/${SLUG}/${SLUG}.js`));
ok(`the product shell boots into the product view, for the TV, the washer and the range (${Object.values(PDP).filter(Boolean).map((p) => p[SKU]).join(', ')})`,
  Object.keys(PDP).every((k) => PDP[k] && /data-entry="product"/.test(shells[`product-${k}`])));
ok('the phone shell boots into the homepage at phone width', /data-entry="phone"/.test(shells.phone) && /shell--phone/.test(shells.phone));
{
  // The worker's root is the demo (lane K6, src/demos/kit/root.ts; docs/demo-kit/lanes/K6.md patch 2, widened by S2 at the
  // coordinator's request): "/" answers 302 to /oh/ keeping its query string, never the repository's legacy dashboard; an
  // unknown page under /oh/ answers 302 to /oh/ too; an API path keeps its own answer, known or unknown. It holds where the
  // worker provisions oh alone, as the hosted worker and rig.mjs's rig do, and its config routes "/" to the worker first with
  // no single-page fallback (K6's patch 1 to scripts/build-demo-worker-config.mjs and wrangler.oh.toml).
  const manual = { redirect: 'manual', cache: 'no-store', headers: { Accept: 'text/html' } };
  const root = await get(`${base}/?utm_source=s2-root`, manual);
  const to = root.headers.get('location'), toU = to ? new URL(to, `${base}/`) : null;
  // A browser's navigation, as K6's rule reads one (Sec-Fetch-Mode: navigate): Node's fetch sends "cors", so this goes
  // through node:http, as the kit's navigate() does, and does not follow the redirect.
  const { request: httpRequest } = await import(new URL(base).protocol === 'https:' ? 'node:https' : 'node:http');
  const lost = await new Promise((resolve) => { const r = httpRequest(new URL(`${base}/${SLUG}/nowhere`), { method: 'GET', headers: { 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Site': 'none', Accept: 'text/html,application/xhtml+xml', 'Cache-Control': 'no-store' } }, (res) => { res.resume(); resolve({ status: res.statusCode, location: res.headers.location || null, arrayBuffer: async () => null }); });
    r.on('error', () => resolve({ status: 0, location: null, arrayBuffer: async () => null })); r.end(); });
  const lostTo = lost.location;
  const apiH = { redirect: 'manual', cache: 'no-store', headers: { 'X-Tenant': TENANT, 'X-SDK-Key': 'demo-site', Accept: 'application/json' } };
  const known = await get(`${base}${API}/coldstart`, apiH), unknownApi = await get(`${base}${API}/nowhere`, apiH);
  for (const r of [root, known, unknownApi]) await r.arrayBuffer().catch(() => null);
  const landed = await navigate('/');
  const home = landed.ok ? await landed.text() : '';
  const json = (r) => /json/.test(r.headers.get('content-type') || '');
  ok(`the worker's root "/" redirects to /${SLUG}/ keeping its query, and a browser landing there gets the OH page`,
    root.status === 302 && Boolean(toU) && toU.pathname === `/${SLUG}/` && toU.searchParams.get('utm_source') === 's2-root' && /data-entry="home"/.test(home),
    `/?utm_source=s2-root → ${root.status}${to ? ` ${to}` : ''}${root.status === 200 ? ` (the root page: this worker provisions more than ${TENANT}, or its config does not route "/" to the worker first: K6's patch 1)` : ''}`);
  ok(`an unknown page under /${SLUG}/, navigated to by a browser, redirects to /${SLUG}/ as well`, lost.status === 302 && Boolean(lostTo) && new URL(lostTo, `${base}/`).pathname === `/${SLUG}/`,
    `/${SLUG}/nowhere → ${lost.status}${lostTo ? ` ${lostTo}` : ''}`);
  ok('and an API path keeps its own answer: the cold-start read 200 JSON, an unknown API path its own refusal, never a redirect', known.status === 200 && json(known)
    && unknownApi.status >= 400 && unknownApi.status < 500 && !unknownApi.headers.get('location') && json(unknownApi), `${API}/coldstart → ${known.status} · ${API}/nowhere → ${unknownApi.status}`);
}
{
  const kit = ['/demo-kit/tokens.css', '/demo-kit/kit.css', '/demo-kit/compare.css', `/${SLUG}/${SLUG}.css`];
  const all = pageShells.every((k) => kit.every((href) => shells[k].includes(`href="${href}"`)));
  ok('every shell loads the kit\'s token sheet and chrome, then its own sheet, then Compare', all);
  ok('the page builds on the kit: it imports createDemo from /demo-kit/kit.js', /import \{[^}]*createDemo[^}]*\} from '\/demo-kit\/kit\.js'/.test(shells.js));
}
ok(`beats.json holds the director's ${demo.beats.list.length} beats as data`, Array.isArray(beatsDoc.beats) && beatsDoc.beats.length === demo.beats.list.length
  && beatsDoc.total === demo.beats.list.length, `${(beatsDoc.beats || []).length} beats, total ${beatsDoc.total}`);
{
  const VERBS = ['open', 'click', 'select', 'wait', 'custom', 'assert', 'focus', 'publish', 'ask', 'template', 'call'];
  const GRAMMAR = ['when', 'unless', 'else', 'do', 'each', 'note'];
  const bad = [];
  const steps = (list, where) => { for (const s of list || []) {
    const verbs = Object.keys(s).filter((k) => VERBS.includes(k));
    if (verbs.length > 1 || (!verbs.length && !s.do && s.each === undefined)) bad.push(`${where}: ${JSON.stringify(s).slice(0, 80)}`);
    for (const k of ['do', 'else']) if (s[k]) steps(s[k], where);
  } };
  for (const b of beatsDoc.beats || []) steps(b.run, `beat ${b.no}`);
  ok('every step of every beat names one of the kit\'s verbs (or the grammar around them)', bad.length === 0, bad.slice(0, 4).join(' ~ ') || `${VERBS.length} verbs, ${GRAMMAR.length} grammar words`);
}
const docs = ['anchor', ...(anchor.reset || []), ...(anchor.beatIndex || []).map((b) => b.name)];
let served = 0;
for (const name of docs) { const res = await asset(`beats/${name}.json`); if (res.ok) served += 1; else console.log(`   ✗ beats/${name}.json → ${res.status}`); }
ok(`the ${docs.length} beat documents are served`, served === docs.length, `${served}/${docs.length}`);
for (const path of ['catalog.json', productsPath]) {
  const res = await asset(path);
  ok(`/${SLUG}/${path} → ${res.status}`, res.ok);
}
// The data and imagery lanes' files: asserted served once they exist in the checkout (a rig lists public/ at its start).
const overlayPath = demo.products.overlay ? String(demo.products.overlay.file || demo.products.overlay).replace(`public/${SLUG}/`, '').replace(`/${SLUG}/`, '') : 'specs.json';
const LATER = [[overlayPath, 'D2: title, prices, cta, dimensions, VESA, image per sku'], ['img/MANIFEST.json', 'D2: the imagery manifest'], ['img/index.json', 'D2: the image per product']];
const laterDocs = {};
for (const [path, what] of LATER) {
  if (!inCheckout(`public/${SLUG}/${path}`)) { info(`/${SLUG}/${path}: not written yet (${what}); asserted once it is`); continue; }
  const res = await asset(path);
  const text = res.ok ? await res.text() : '';
  laterDocs[path] = text;
  ok(`/${SLUG}/${path} → ${res.status} (${what})`, res.ok && text.length > 0, res.ok ? '' : 'in the checkout but not served: restart the rig, which lists public/ at its start');
}
// The images the data files name are swept at the end (imageSweep): hundreds of requests leave stale sockets behind.
{
  // R4 F5 and F8 (S2), read in what is served: the Roadmap the page renders (SITE.roadmap in oh.js) marks nothing the walk
  // uses as designed; every legal line (SITE.brand.legal, demo.config.json, the shells' footer) names the date of the
  // prices on screen: the overlay's (specs.json) when it changes any row's price, else the feed's own.
  const road = Array.isArray(PAGE_SITE.roadmap) ? PAGE_SITE.roadmap : [];
  const USED = [['complements', /\bcomplements\b/i], ['the two named outcomes', /partner_pickup|retailer_referral/i], ['the regional prior on /sort', /regional prior on \/sort/i]];
  const wrong = road.filter(([status, name]) => /designed/i.test(status) && USED.some(([, re]) => re.test(name)));
  checks.known('the Roadmap’s source (demo.config.json, written into oh.js as SITE.roadmap) marks none of what the walk uses as designed: complements, the two named outcomes, the regional prior on /sort', road.length > 0 && wrong.length === 0,
    wrong.map(([s, n]) => `“${n}” ${s}`).join(' ~ ') || `${road.length} items`, 'the config’s owner: demo.config.json roadmap (the page’s Roadmap tab is corrected at runtime by M1; the DOM suite asserts the tab)');
  checks.known('and the source names the companions’ gate as the walk sends it (ctx.family), not “ctx.anchor until complements lands”', !road.some((x) => /ctx\.anchor until complements lands/i.test(x.join(' '))),
    (road.find((x) => /ctx\.anchor/i.test(x.join(' '))) || ['', '', 'no gate named'])[2].slice(0, 140), 'the config’s owner: demo.config.json roadmap');
  const ov = (() => { try { return JSON.parse(laterDocs[overlayPath] || 'null'); } catch { return null; } })();
  const ovRows = new Map((((ov && (ov.specs || ov.products || ov.rows)) || [])).filter((r) => r && r.sku).map((r) => [String(r.sku), r]));
  const changed = productList.filter((p) => ovRows.has(String(p[SKU])) && ['salePrice', 'listPrice'].some((k) => ovRows.get(String(p[SKU]))[k] != null && Number(ovRows.get(String(p[SKU]))[k]) !== Number(p[k])));
  const feedDate = String((productsDoc && productsDoc.asOf) || '').slice(0, 10), ovDate = String((ov && ov.asOf) || '').slice(0, 10);
  const iso = changed.length && ovDate > feedDate ? ovDate : feedDate;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const long = iso ? `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : '';
  const lines = [['oh.js SITE.brand.legal', (PAGE_SITE.brand || {}).legal], ['demo.config.json brand.legal', (demo.brand || {}).legal],
    ...pageShells.map((k) => [`the ${k} shell’s footer`, ((/<p[^>]*\bid="footLegal"[^>]*>([\s\S]*?)<\/p>/.exec(shells[k] || '') || [])[1] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || null])].filter(([, t]) => t);
  const stale = lines.filter(([, t]) => !new RegExp(`(?<!\\d)${long}`).test(t));
  checks.known(`every legal line’s source names the date of the prices on screen, ${long} (${changed.length} rows priced by specs.json of ${ovDate || '?'} over the feed of ${feedDate || '?'})`, Boolean(long) && lines.length > 0 && stale.length === 0,
    stale.map(([w, t]) => `${w}: “${(/as listed[^;.]*/.exec(t) || [t.slice(0, 80)])[0]}”`).join(' ~ ') || `${lines.length} lines`,
    'the config’s owner (demo.config.json brand.legal) and M1 (the shells’ static footer); the page dates the line from the feed at runtime and the DOM suite asserts what is on screen');
}

// ── No credential is served or committed, and the page holds none ───────────
console.log('\n── No credential is served, embedded or committed');
const pageModules = new Map([[`/${SLUG}/${SLUG}.js`, shells.js]]);
const origin = new URL(base).origin;
const linked = new Map();
{
  for (const leak of ['beats/operator.local.json', 'operator.local.json', 'beats/token.json', '.dev.vars', 'img/token.json']) {
    const res = await asset(leak);
    ok(`/${SLUG}/${leak} → ${res.status} (must not be served)`, res.status !== 200);
  }
  // Every module script the shells load, then every module those import, through the served files.
  for (const k of pageShells) {
    for (const [tag] of String(shells[k]).matchAll(/<script\b[^>]*>/gi)) {
      const src = (/\bsrc=["']([^"']+)["']/i.exec(tag) || [])[1];
      if (!src) continue;
      const u = new URL(src, `${base}/${SLUG}/`);
      if (u.origin === origin && !pageModules.has(u.pathname)) pageModules.set(u.pathname, await (await get(u, { cache: 'no-store' })).text());
    }
  }
  for (const [path, text] of pageModules) {
    for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)['"]([^'"]+\.js)['"]/g)) {
      const next = new URL(m[1], `${base}${path}`).pathname;
      if (!pageModules.has(next)) pageModules.set(next, await (await get(`${base}${next}`, { cache: 'no-store' })).text());
    }
  }
  // Every same-origin stylesheet the shells link, and the one script the kit's Compare loads by itself.
  for (const k of pageShells) {
    for (const [tag] of String(shells[k]).matchAll(/<link\b[^>]*>/gi)) {
      if (!/\brel=["']?stylesheet\b/i.test(tag)) continue;
      const href = (/\bhref=["']([^"']+)["']/i.exec(tag) || [])[1];
      const u = href ? new URL(href, `${base}/${SLUG}/`) : null;
      if (u && u.origin === origin && !linked.has(u.pathname)) linked.set(u.pathname, await (await get(u, { cache: 'no-store' })).text());
    }
  }
  for (const [, text] of [...pageModules]) {
    for (const m of text.matchAll(/['"`](\/[\w./-]+\.min\.js)['"`]/g)) {
      if (!linked.has(m[1]) && !pageModules.has(m[1])) { const res = await get(`${base}${m[1]}`, { cache: 'no-store' }); if (res.ok) linked.set(m[1], await res.text()); }
    }
  }
  const hits = [];
  const texts = [...pageShells.map((k) => [k, shells[k]]), [`${SLUG}.css`, shells.css], ...pageModules, ...linked];
  for (const name of ['demo.config.json', 'beats.json', 'catalog.json', productsPath, ...docs.map((d) => `beats/${d}.json`)]) texts.push([name, await (await asset(name)).text()]);
  for (const [path, text] of Object.entries(laterDocs)) texts.push([path, text]);
  for (const [path, text] of texts) for (const w of tokenIn(text)) hits.push(`${path}: ${w}`);
  info(`the page loads, from this origin: ${[...pageModules.keys(), ...linked.keys()].join(', ')}`);
  ok(`no served page, module, stylesheet, script or document carries a token (${texts.length} checked)`, hits.length === 0, hits.join(' ~ '));
  const committed = [
    ...walk(join(ROOT, `public/${SLUG}`)).filter((f) => TEXT.test(f)),
    ...walk(join(ROOT, 'public/demo-kit')).filter((f) => TEXT.test(f)),
    ...(inCheckout(`docs/${SLUG}`) ? walk(join(ROOT, `docs/${SLUG}`)).filter((f) => /\.md$/i.test(f)) : []),
    ...[`scripts/rehearse-${SLUG}-page.mjs`, `scripts/rehearse-${SLUG}-dom.mjs`, `scripts/demo-kit/configs/${SLUG}.json`, `wrangler.${SLUG}.toml`,
      `src/demos/${SLUG}.config.ts`, `src/routes/${SLUG}.ts`, 'public/html2canvas.min.js'].map((f) => join(ROOT, f)),
    ...(inCheckout(`scripts/demo-kit/configs/${SLUG}`) ? readdirSync(join(ROOT, `scripts/demo-kit/configs/${SLUG}`)).map((f) => join(ROOT, `scripts/demo-kit/configs/${SLUG}`, f)) : []),
  ].filter((f) => { try { return statSync(f).isFile(); } catch { return false; } });
  const leaks = [];
  for (const f of committed) for (const w of tokenIn(readFileSync(f, 'utf8'))) leaks.push(`${relative(ROOT, f)}: ${w}`);
  ok(`no file this demo ships carries a token (${committed.length} read from the checkout)`, leaks.length === 0, leaks.join(' ~ '));

  // The doors, read in the code that sends (comments stripped).
  const source = [...pageModules.values()].map((t) => codeOnly(t, 'js')).join('\n');
  ok('the page source makes no /content, /config or /ops call of its own', !/['"`]\/(?:content|config|ops)\//.test(source), 'the merchandiser half goes through /oh/api/beat');
  ok('the page source holds no Authorization header', !/Authorization/i.test(source));
  const fetches = [...source.matchAll(/\bfetch\(/g)].length;
  ok(`every fetch in the page goes through the kit's three doors, api(), demoRoute() and tryJson() (${fetches} call sites)`, fetches === 3, `${fetches} found`);
  const doors = [...pageModules].filter(([, t]) => /async function api\(/.test(t) && /async function demoRoute\(/.test(t));
  const [doorPath, doorText] = doors.length === 1 ? doors[0] : [null, ''];
  ok('api() and demoRoute() send X-Tenant on every API call', /async function api\([\s\S]{0,400}?'X-Tenant': TENANT/.test(doorText)
    && /async function demoRoute\([\s\S]{0,400}?'X-Tenant': TENANT/.test(doorText), doorPath || `${doors.length} modules define both doors`);
  {
    // The tenant those doors name, followed to its value: TENANT = cfg.tenant → createDemo({ tenant: SITE.tenant }) → SITE.tenant.
    const bound = ((/\bconst TENANT = ([^;\n]+);/.exec(doorText) || [])[1] || '').trim();
    let via = `${doorPath}: TENANT = ${bound || 'unbound'}`, tenant = null;
    const ohJs = shells.js;
    const site = (() => { const m = /\bconst SITE = (\{[\s\S]*?\n\});/.exec(ohJs); try { return m ? JSON.parse(m[1]) : null; } catch { return null; } })();
    const passed = (/\bcreateDemo\(\{[\s\S]*?\btenant:\s*([^,}\n]+)/.exec(ohJs) || [])[1];
    if (/^(?:cfg|config|k\.config)\.tenant$/.test(bound) && passed) {
      via += ` → /${SLUG}/${SLUG}.js: createDemo({ tenant: ${passed.trim()} })`;
      if (/^SITE\.tenant$/.test(passed.trim()) && site) { tenant = site.tenant; via += ' → SITE.tenant'; }
      else { const lit = /^(['"`])([^'"`$]*)\1$/.exec(passed.trim()); tenant = lit ? lit[2] : null; }
    }
    ok(`and the tenant they name is '${TENANT}', followed from the doors to the value the page configures`, tenant === TENANT, `${via} → ${JSON.stringify(tenant)}`);
  }
  const beatCalls = [...source.matchAll(/\bdemoRoute\(\s*([^,()]*\bbeat\b[^,()]*),\s*([^)]*)\)/g)].map((m) => `${m[1].trim()} ← ${m[2].trim()}`);
  ok('every call to the beat route sends { kind, name, note } and nothing else: no document crosses from the page', beatCalls.length > 0
    && beatCalls.every((c) => /← \{\s*kind,\s*name,\s*note\s*\}$/.test(c)), beatCalls.join(' ~ ') || 'no call to the beat route found');
  {
    // Static documents come from this demo's own directory: every tryJson()/firstJson() argument resolves under /oh/.
    const site = (() => { const m = /\bconst SITE = (\{[\s\S]*?\n\});/.exec(shells.js); try { return m ? JSON.parse(m[1]) : {}; } catch { return {}; } })();
    const resolveArg = (a) => {
      const t = a.trim();
      if (/^[`'"]\/(oh|demo-kit)\//.test(t) || t.startsWith('`${BASE}')) return true;
      const path = /^SITE((?:\.[\w$]+)+)$/.exec(t);
      if (path) { const v = path[1].slice(1).split('.').reduce((o, k) => (o == null ? undefined : o[k]), site); return typeof v === 'string' && v.startsWith(`/${SLUG}/`); }
      return false;
    };
    const vertical = [...pageModules].filter(([p]) => p.startsWith(`/${SLUG}/`)).map(([, t]) => codeOnly(t, 'js')).join('\n');
    const args = [...vertical.matchAll(/\b(?:tryJson|firstJson)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)].flatMap((m) => {
      const inner = m[1]; const list = /\[(.*)\]\s*$/.exec(inner); return list ? list[1].split(/,(?![^`]*`)/).map((x) => x.trim()).filter(Boolean) : [inner.split(',')[0]];
    }).filter((a) => !/^['"]\w+['"]$/.test(a));
    const bad = args.filter((a) => !resolveArg(a));
    ok(`every document the page reads itself comes from /${SLUG}/ (${args.length} reads in its own code)`, args.length > 0 && bad.length === 0, bad.join(' ~ ') || args.join(' · ').slice(0, 200));
  }
}

// ── The page never ranks ────────────────────────────────────────────────────
console.log('\n── The page never ranks: its own code orders no piece and scores none');
{
  // The vertical's code (/oh/*.js the page loads), comments stripped. A sort is allowed only on the engine's own order
  // (`a.order - b.order`), or where it orders an explanation that is not a piece and is named here with why; every other
  // sort, any arithmetic or comparison on a score, a reversal or a random draw fails, naming the file, line and function.
  // Each entry was read in the page's code by S1 and judged not to order a decided piece; a changed comparator or a new
  // sort fails again and is read again. (P2's six, 2026-10-02 12:15: the buy box's own controls, catalog facts, the size
  // calculator on her declared distance, POST /sort's own order, and a receipt's explanation.)
  const EXPLANATION_SORTS = [
    { fn: 'snapshotOfPage', comparator: '(x, y) => y.a - x.a', why: 'her strongest signals for Compare’s What changed: her vector, not a piece' },
    { fn: 'regionLean', comparator: '(a, b) => b[1] - a[1]', why: 'the lean’s leader per dimension, named in a sentence: the brand’s sales, not a piece' },
    { fn: 'variantsOf', comparator: '(a, b) => a[0] - b[0]', why: 'the buy box’s size chips, smallest first: the site’s own control, off limits, the same for everyone' },
    { fn: 'typeTarget', comparator: 'byReviews', why: 'the site’s own type switch: each type’s best seller at this tier by review count, a catalog rule, the same for everyone' },
    { fn: 'sorted', comparator: '(a, b) => (pos.has(a) ? pos.get(a) : 1e9) - (pos.has(b) ? pos.get(b) : 1e9)', why: 'a module’s products in the order POST /sort returned them: the engine’s order' },
    { fn: 'seriesBody', comparator: '(a, b) => Number(priceOf(a)) - Number(priceOf(b))', why: 'one model per series at this size, its lowest-priced variant: a catalog fact, rows in the piece’s own order' },
    { fn: 'sizeUpFor', comparator: '(a, b) => a.size - b.size', why: 'the size-up calculator: the next size up within her declared distance’s range, the piece’s own figures' },
    { fn: 'paintRail', comparator: '(a, b) => num(b.contribution) - num(a.contribution)', why: 'a product card’s strongest POST /sort driver, named on its rank line: the rail keeps /sort’s order' },
    { fn: 'snap', comparator: '(x, y) => y.a - x.a', why: 'her strongest signals for Compare’s What changed (P1’s snapshot hook): her vector, not a piece' },
    { fn: 'topOf', comparator: '(x, y) => y.a - x.a', why: 'her three strongest values across every dimension, named on the sign-in strip (P3): her vector, not a piece' },
    { fn: 'keysOf', comparator: '', why: 'a set of signals’ keys put in order to compare two sets (P3): not a piece' },
    { fn: 'receiptLine', comparator: '(a, b) => Number(b.a) * Number(b.weight) - Number(a.a) * Number(a.weight)', why: 'her two strongest drivers on a card’s receipt line: an explanation, not a piece' },
    { fn: 'chosenOrder', comparator: 'SORTS[key]', why: 'her own choice on a grid’s sort control (price low to high or high to low, rating), the control design §9.3 asks for: never the default, Best match stays POST /sort’s order and each card keeps its engine rank (M1; read by S2)' },
  ];
  const ENGINE_ORDER = /^\(\s*([\w$]+)\s*,\s*([\w$]+)\s*\)\s*=>\s*(?:Number\()?\1\.(order|position)\)?\s*-\s*(?:Number\()?\2\.\3\)?$/;
  const vertical = [...pageModules].filter(([p]) => p.startsWith(`/${SLUG}/`));
  const findings = [], sorts = [];
  const enclosing = (code, at) => {
    const before = code.slice(0, at);
    const fns = [...before.matchAll(/(?:\bfunction\s+([\w$]+)\s*\(|\b(?:const|let)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:\([^()]*\)|[\w$]+)\s*=>)/g)];
    const last = fns[fns.length - 1];
    return last ? (last[1] || last[2]) : '(top level)';
  };
  for (const [path, text] of vertical) {
    const code = codeOnly(text, 'js');
    const lineOf = (at) => code.slice(0, at).split('\n').length;
    for (const m of code.matchAll(/\.sort\(/g)) {
      // The comparator: the balanced text inside sort( … ).
      let depth = 1, i = m.index + m[0].length;
      for (; i < code.length && depth; i += 1) { if (code[i] === '(') depth += 1; else if (code[i] === ')') depth -= 1; }
      const comparator = code.slice(m.index + m[0].length, i - 1).replace(/\s+/g, ' ').trim();
      const fn = enclosing(code, m.index);
      const allowed = ENGINE_ORDER.test(comparator) ? 'the engine’s own order' : (EXPLANATION_SORTS.find((x) => x.fn === fn && x.comparator === comparator) || {}).why;
      sorts.push(`${path}:${lineOf(m.index)} ${fn}: sort(${comparator || 'no comparator'})${allowed ? ` · ${allowed}` : ''}`);
      if (!allowed) findings.push(`${path}:${lineOf(m.index)} in ${fn}: .sort(${comparator || ''})`);
    }
    for (const re of [/\.score\b\s*(?:[-+*/%]|[<>]=?|[=!]==?)(?!=)/g, /(?:[-+*/%]|[<>]=?)\s*[\w$]+(?:\.[\w$]+)*\.score\b/g, /Math\.(?:max|min)\([^)]*\bscore\b/g,
      /\.reverse\(/g, /Math\.random\(/g]) {
      for (const m of code.matchAll(re)) findings.push(`${path}:${lineOf(m.index)} in ${enclosing(code, m.index)}: ${m[0].trim()}`);
    }
  }
  for (const s of sorts) info(s);
  ok(`the page's own code (${vertical.map(([p]) => p).join(', ')}) sorts no piece and does no arithmetic on a score: it renders in the order the engine returned`,
    vertical.length > 0 && findings.length === 0, findings.slice(0, 6).join(' ~ ') || `${sorts.length} sort(s), each the engine’s order or a named explanation`);
  const transport = [...pageModules].find(([p]) => /\/demo-kit\/transport\.js$/.test(p));
  ok('and the kit hands each slot over in the engine\'s order: bySlot sorts by the decision\'s own order, nothing else',
    Boolean(transport) && /const bySlot = \(set, slot\) => \(\(set && set\.decisions\) \|\| \[\]\)\.filter\(\(d\) => d\.slot === slot\)\.sort\(\(a, b\) => a\.order - b\.order\);/.test(transport[1]),
    transport ? transport[0] : 'no transport module');
}

// ── The kit is a kit ────────────────────────────────────────────────────────
console.log('\n── The kit holds nothing of OH’s');
{
  // No OH literal in the code of public/demo-kit/*.js or its stylesheets, read from the checkout, outside tokens.css
  // (the documented default palette). A comment may name OH; code, a string, a template, a selector or a pattern may not.
  // The names are OH's own data: every product's sku and name, every catalog piece id, OH's routes, debug hook, source
  // and brand, the partners it names, and the words of its rooms that no other vertical would put in a kit.
  const kitDir = join(ROOT, 'public/demo-kit');
  const catalogPieces = (JSON.parse(readFileSync(join(ROOT, `public/${SLUG}/catalog.json`), 'utf8')).pieces || []);
  const word = (s) => new RegExp(`(?<![\\w-])${reEsc(s)}(?![\\w-])`, 'i');
  const names = [['OH’s routes', /\/oh\//], ['__oh', /__oh\b/], ['oh-demo', /\boh-demo\b/], ['Optimized Home', /optimized home/i], ['LG', /\bLG\b/],
    ['Best Buy', /best\s*buy/i], ['PriceSpider', /pricespider/i], ['Find a Retailer', /find a retailer/i],
    ...['washer', 'dryer', 'laundry', 'soundbar', 'OLED', 'QNED', 'VESA', 'pedestal', 'refrigerator', 'dishwasher', 'microwave', 'ThinQ'].map((w) => [w, new RegExp(`\\b${w}`, 'i')]),
    ...productList.flatMap((p) => [[p[SKU], word(p[SKU])], ...(/\s/.test(String(p.name || '').trim()) ? [[p.name, word(p.name)]] : [])]),
    ...catalogPieces.map((p) => [p.customerContentId, word(p.customerContentId)])];
  const files = readdirSync(kitDir).filter((n) => /\.(js|mjs|css)$/.test(n) && n !== 'tokens.css').sort();
  const kitLeaks = [];
  for (const f of files) {
    const code = codeOnly(readFileSync(join(kitDir, f), 'utf8'), /\.css$/.test(f) ? 'css' : 'js');
    code.split('\n').forEach((line, n) => { for (const [w, re] of names) if (re.test(line)) kitLeaks.push(`${f}:${n + 1} “${w}”`); });
  }
  ok(`the demo kit holds no OH literal outside tokens.css: no route, hook, brand, partner, room word, product or piece of OH’s in the code of ${files.length} kit files (${names.length} names)`,
    files.length > 0 && kitLeaks.length === 0, kitLeaks.slice(0, 8).join(' ~ '));
}

// ── The doors that stay shut ─────────────────────────────────────────────────
console.log('\n── The unsigned-read trap, and the doors that stay shut');
const kitConfig = JSON.parse(readFileSync(join(ROOT, `scripts/demo-kit/configs/${SLUG}.json`), 'utf8'));
const PUBLISHABLE = kitConfig.seed.beats.publishable || {};
{
  for (const kind of ['catalog', 'slots']) {
    const unsigned = await get(`${base}/content/${kind}?scope=${TENANT}`, { headers: { 'X-Tenant': TENANT } });
    ok(`an unsigned GET /content/${kind} is refused (${unsigned.status})`, unsigned.status === 401 || unsigned.status === 403, 'if this ever passes, the route stopped protecting configuration reads');
  }
  const unknown = await call(`${API}/beat`, { body: { name: 'not-a-beat' } });
  ok(`${API}/beat refuses a name outside its closed list (${unknown.status})`, unknown.status === 400);
  const listed = (/the publishable beats are (.*)$/.exec(String((unknown.body || {}).error || '')) || [])[1] || '';
  ok('and the closed list it names is exactly the kit config\'s publishable beats', listed.split(', ').sort().join(',') === Object.keys(PUBLISHABLE).sort().join(','),
    `${listed || 'no list'} · config ${Object.keys(PUBLISHABLE).join(', ')}`);
  const mismatch = await call(`${API}/beat`, { body: { name: 'open-slots', kind: 'catalog' } });
  ok(`and refuses a kind that is not the beat's own (${mismatch.status})`, mismatch.status === 400);
  const prior = await call(`${API}/coldstart/prior`, { body: {} });
  ok(`the regional-prior seed door refuses a caller with no operator token (${prior.status})`, prior.status === 401 || prior.status === 403);
  const anon = await call(`${API}/receipt`, { body: { decisionIds: [`${TENANT}:x:vis-nobody:home:deals:0`] } });
  ok(`a receipt without a shopper session is refused (${anon.status})`, anon.status === 401);
  {
    // The beat body: a document in the request is never published. The opening slots are asked for by name with a forged
    // document that pins a deal; the worker publishes its own copy, so the four carry no pin.
    const opening = (await assetJson('beats/open-slots.json')).publish.document;
    const forged = JSON.parse(JSON.stringify(opening));
    const deals = Object.values(forged.pages || {}).flat().find((s) => s.slot === 'deals');
    if (deals) deals.pinnedPieceIds = ['deal_big_screens'];
    const res = await call(`${API}/beat`, { body: { kind: 'slots', name: 'open-slots', note: 'page rehearsal: a forged document rides along', document: forged } });
    const v = await client.mintVisitor({}, 'beat-body probe');
    const s = await client.snapshot(v, 'home', {});
    ok(`a beat request carrying a document publishes the worker’s own copy, never the request’s (${res.status})`, res.status === 200 && res.body.ok === true
      && s.slot('deals').length > 0 && s.slot('deals').every((d) => d.strategy !== 'tenant-pinned'), `${(res.body || {}).name || ''} · deals ${fmt(s.slot('deals'))}`);
  }
}

// ── The walk ─────────────────────────────────────────────────────────────────
const home = demo.pages.find((p) => p.entry === 'home');
const homeSlots = home.slots || [];
/** The deals slot as the opening slots publish it: how many the engine's answer carries, and its diversity rule (M1e: five). */
const OPEN_DEALS = ((((await assetJson('beats/open-slots.json')).publish.document.pages || {}).home) || []).find((s) => s.slot === 'deals') || {};
const DEALS_N = Number(OPEN_DEALS.take) || 4, DEALS_MAX = Number((OPEN_DEALS.diversity || {}).max) || 2;
const openCatalog = (await assetJson('beats/open-catalog.json')).publish.document;
const opening = new Set((openCatalog.pieces || []).map((p) => p.customerContentId));
const cidOf = new Map((openCatalog.pieces || []).map((p) => [p.id, p.customerContentId]));
/** What the page's state holds as it walks: the region it asserts (null: the request's own), her visitor, what she saw. */
const page = { region: null, own: null };
const ask = (v, pageKey, extra = {}) => client.snapshot(v, pageKey, { region: page.region, ...extra });
const receiptsFor = (v, decisions, s) => client.receipts(v, decisions, s && s.asked && s.asked.region ? { region: s.asked.region } : undefined);
const regionalOf = (d) => ((d.explain && d.explain.drivers) || []).find((x) => x.dim === 'regional') || null;
const built = (b) => !JSON.stringify(b.run || []).includes('"call":"notBuilt"');
const laneOf = (b) => { const s = JSON.stringify(b.run || []); return (/"lane":"(P\d)"/.exec(s) || [])[1] || 'a page lane'; };
// ── The product pages, as oh.js builds them (lane P2) ──
/** The feed with the overlay merged over it by sku, as the page merges specs.json. */
const overlayRows = (() => { try { const d = JSON.parse(laterDocs[overlayPath] || 'null'); return (d && (d.specs || d.products || d.rows)) || []; } catch { return []; } })();
const overlayBySku = new Map(overlayRows.filter((r) => r && r.sku).map((r) => [String(r.sku), r]));
const rowsAll = productList.map((p) => (overlayBySku.has(String(p[SKU])) ? { ...p, ...overlayBySku.get(String(p[SKU])) } : p));
const rowBySku = new Map(rowsAll.map((p) => [String(p[SKU]), p]));
const row = (sku) => rowBySku.get(String(sku)) || null;
/** The walk's products, read from the page's own P2_WALK (oh.js), so the suite follows what the page presses. */
const WALK = (() => {
  const m = /\bconst P2_WALK = \{([^}]*)\}/.exec(shells.js || '');
  const out = {};
  for (const [, k, v] of String(m ? m[1] : '').matchAll(/([\w$]+):\s*('[^']*'|"[^"]*"|[\d.]+)/g)) out[k] = /^['"]/.test(v) ? v.slice(1, -1) : Number(v);
  return out;
})();
const field = (p, path) => String(path || '').split('.').reduce((v, k) => (v == null ? undefined : v[k]), p);
/** The attributes an event about a product carries, exactly as oh.js productAttrs() builds them from SITE.products.attributes. */
function productAttrs(p, extra) {
  const out = { productId: String(p[SKU]) };
  for (const [attr, path] of Object.entries((PAGE_SITE.products || {}).attributes || {})) { const v = field(p, path); if (v !== undefined && v !== null) out[attr] = v; }
  return { ...out, ...(extra || {}) };
}
/** A product page opened as the page opens it: product_view, then the snapshot with ctx.anchor and ctx.family (and the region in force). */
async function openProductAs(p, extra = {}) {
  const viewed = await client.send(her, 'product_view', productAttrs(p, { view: 'page' }));
  if (!viewed.ok) throw new Error(`product_view for ${p[SKU]} answered ${viewed.status}`);
  if (!opened.includes(String(p[SKU]))) opened.push(String(p[SKU]));
  return ask(her, 'product', { anchor: String(p[SKU]), family: p.family, ...extra });
}
const completesOf = (d) => (d ? (((d.explain && d.explain.drivers) || []).find((x) => x.dim === 'completes') || {}).value || null : null);
const companionIds = (p, key) => { const c = (p && p.companions) || {}; const x = c[key]; return Array.isArray(x) ? x.map(String) : x && typeof x === 'object' ? Object.values(x).flat().map(String) : []; };
const pieceById = (cid) => (openCatalog.pieces || []).find((x) => x.customerContentId === cid) || null;
const catalogDisplay = new Map(((await assetJson('catalog.json')).pieces || []).map((x) => [x.customerContentId, x.display || {}]));
const displayOf = (cid) => catalogDisplay.get(cid) || {};
/** POST /sort over a list, as the page sends it (her vector, the region in force): the order and the regional block. */
async function sortIds(skus) {
  const candidates = skus.filter((id) => row(id)).map((id) => { const { productId, ...a } = productAttrs(row(id)); return { id, ...a }; });
  const r = await call('/sort', { visitor: her, body: { userId: her.session.subject, sessionId: her.session.sessionId, candidates, ...(page.region ? { context: { region: page.region } } : {}) } });
  return { ids: r.ok && Array.isArray(r.body.order) ? r.body.order.map(String) : [], regional: r.body ? r.body.regional || null : null };
}
const PART_FAMILIES = new Set(['pedestal-washer', 'pedestal', 'stacking-kit', 'tv-mount', 'refrigerator']);
const sold = (p) => p && p.cta === 'cart' && p.inStock !== false;
/** The page's type switch: this type's best seller (most reviews) at this price tier, sold here; else at any tier. */
function typeTarget(p, type) {
  const byReviews = (a, b) => (Number(b.reviews) || 0) - (Number(a.reviews) || 0);
  const pool = rowsAll.filter((x) => x.attributes && x.attributes.category === p.attributes.category && x.attributes.type === type && !PART_FAMILIES.has(x.family) && sold(x));
  return pool.filter((x) => x.attributes.priceTier === p.attributes.priceTier).sort(byReviews)[0] || pool.sort(byReviews)[0] || null;
}
const vesaMounts = (p) => { const want = p && p.vesa ? String(p.vesa).toLowerCase().replace(/\s/g, '') : null; return want ? rowsAll.filter((m) => m.attributes && m.attributes.category === 'tv-mounts'
  && [...String(m.name || '').matchAll(/(\d{2,4})\s*[xX]\s*(\d{2,4})/g)].some((x) => `${x[1]}x${x[2]}` === want)) : []; };
/** One size up from her distance, by the piece's own figures (30 to 40 degrees: 0.613 to 0.833 of the distance in inches), in her TV's series and year. */
function sizeUp(p, ft) {
  const d = Number(ft) * 12, lo = d * 0.613, hi = d * 0.833, now = Number(p.sizeInches);
  const sizes = rowsAll.filter((x) => x.attributes && x.attributes.category === 'tvs' && x.attributes.series === p.attributes.series && (x.modelYear || null) === (p.modelYear || null)
    && Number(x.sizeInches) > 0 && x.salePrice != null);
  return sizes.filter((x) => Number(x.sizeInches) > now && Number(x.sizeInches) >= lo && Number(x.sizeInches) <= hi).sort((a, b) => Number(a.sizeInches) - Number(b.sizeInches))[0] || null;
}
/** A product's width under the lead's ruling: the product page's (specs.json), else the feed's fits, as the page reads it. */
const widthOf = (p) => { const s = p && Number(p.width); if (Number.isFinite(s) && s > 0) return s; const f = p && p.fits && Number(p.fits.width); return Number.isFinite(f) && f > 0 ? f : null; };
const P2STATE = {}, P3STATE = {};
// Lane P2's helpers for its checks (written by P2, integrated by S1 into the suite's order).
const ofSlot = (s) => ids(s.slot('pdp-modules'));
const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const drivers = (d) => (d && d.explain && d.explain.drivers) || [];
const companionsOf = ['mod-laundry-dryer', 'mod-laundry-pedestal', 'mod-laundry-stacking', 'mod-laundry-pair-price'];
const widthNow = (x) => { const s = Number(x && x.width); if (Number.isFinite(s) && s > 0) return s; const f = Number(x && x.fits && x.fits.width); return Number.isFinite(f) && f > 0 ? f : null; };
const transportJs = () => ([...pageModules].find(([p]) => /\/demo-kit\/transport\.js$/.test(p)) || [null, ''])[1];
/**
 * What put /sort's first ahead of its second, read off the answer's own items (lane S2, R4 F1): per dimension the
 * contribution the first holds over the second (the regional prior as one dimension, 'regional'); the dimension with
 * the largest lead, with the first's own value there. Null when the answer carries no items for them.
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
const imageIndex = (() => { try { const d = JSON.parse(laterDocs[`public/${SLUG}/img/index.json`] || laterDocs['img/index.json'] || 'null'); return (d && d.products) || null; } catch { return null; } })();

// ── The homepage and the grid, as oh.js builds them (lane P1) ──
const imgIndex = (() => { try { return (JSON.parse(laterDocs['img/index.json'] || 'null') || {}).products || {}; } catch { return {}; } })();
/** D2's accepted image by sku; else the row's own; none where the imagery gate holds none (P1's artOf). */
const artOf = (p) => { const e = imgIndex[String(p[SKU])]; if (e && e.verdict === 'accept' && e.src) return e.src; if (e && e.verdict && e.verdict !== 'accept') return null; return p.image || null; };
const priceNum = (p) => { const v = Number(p && p.salePrice); return Number.isFinite(v) && v > 0 ? v : null; };
const P1POOL = [['living-room', ['tvs', 'soundbars']], ['laundry-room', ['washers', 'dryers', 'washtowers']], ['kitchen', ['ranges', 'dishwashers', 'microwaves']]];
/** A room's products as P1's roomProducts() reads them: priced, with an image, in stock, in the products file's own order. */
const roomProducts = (room, cats) => rowsAll.filter((p) => p.attributes && p.attributes.room === room && cats.includes(p.attributes.category) && priceNum(p) !== null && artOf(p) && p.inStock !== false);
/** The TV grid's candidates: every priced TV, in the products file's own order (P1's gridPool, no fit declared). */
const gridPool = () => rowsAll.filter((p) => p.attributes && p.attributes.category === 'tvs' && priceNum(p) !== null);
/** A /sort rail's weights as demo.config.json publishes them; a dimension it does not name weighs 0. */
function railWeights(slot) {
  const w = demo.pages.flatMap((pg) => pg.sorted || []).find((r) => r.slot === slot);
  if (!w || !w.weights) return { affinity: 1 };
  const zero = Object.fromEntries(((anchor.registry || {}).dimensions || []).map((d) => [d.key, 0]));
  return { affinity: 1, dims: { ...zero, ...w.weights } };
}
/** "Recommended for you" as P1 asks it: each room's own POST /sort first, the first four of each, then one across the twelve. */
async function forYouRail(v = her) {
  const pool = [];
  for (const [room, cats] of P1POOL) { const r = await sortRail('for-you', roomProducts(room, cats), v); pool.push(...r.ids.slice(0, 4).map(row).filter(Boolean)); }
  return sortRail('for-you', pool, v);
}
async function sortRail(slot, pool, v = her) {
  const candidates = pool.map((p) => { const { productId, ...a } = productAttrs(p); return { id: productId, ...a }; });
  const r = await call('/sort', { visitor: v, body: { userId: v.session.subject, sessionId: v.session.sessionId, candidates, weights: railWeights(slot), ...(page.region ? { context: { region: page.region } } : {}) } });
  return { ids: r.ok && Array.isArray(r.body.order) ? r.body.order.map(String) : [], regional: r.body ? r.body.regional || null : null, status: r.status };
}
/** The page's own constants for a section, read from the served oh.js: `const <name> = { … }` with string and number values. */
const constOf = (name) => { const m = new RegExp(`\\bconst ${name} = \\{([^}]*)\\}`).exec(shells.js || ''); const out = {};
  for (const [, k, v] of String(m ? m[1] : '').matchAll(/([\w$]+):\s*('[^']*'|"[^"]*"|[\d.]+)/g)) out[k] = /^['"]/.test(v) ? v.slice(1, -1) : Number(v); return out; };
const P1MENU_LEAD = ((/laundry: \{[^]*?lead: \[([^\]]*)\]/.exec(shells.js || '') || [])[1] || '').match(/'[^']+'/g)?.map((x) => x.slice(1, -1)) || [];
const opened = [];   // her shortlist, as the page keeps it: the products she opened on this device, in order

// ── Lane P1's helpers for its checks (written by P1, integrated by S1 into the suite's order) ──
// What S1's outcomes above do not already hold, replayed as oh.js asks it and measured at request level: the two /sort
// rails' regional prior and its label from the first paint (the grid opening on what her state buys), beat 2's
// contrast as the page chooses it (the first configured region whose sales lean differently from hers), the deals four
// holding both rooms by the slot's own rule, the packages held out of stock never decided nor recorded as a candidate
// on a member's own page, what the engine would have led with without the pin (its receipt, then the slots without the
// pin as the control), the clock jump's one-publish window shift, and the shortlist's deltas by room. S1's own outcome
// for a beat runs first, then P1's.
const regDims = (((anchor.learn || {}).regional || {}).dimensions) || [];
const leaders = async (region) => { const c = await client.coldstart(region); return c && c.lean && c.lean.inForce ? c.lean.leaders : null; };
const sig = (l) => `${(l || {}).type || ''}|${(l || {}).sizeBand || ''}`;
const pieceRoom = (cid) => (((pieceById(cid) || {}).tags || {}).room || []);
const firstIs = (sku, l) => { const p = row(sku); return Boolean(p && l && p.attributes.type === l.type && p.attributes.sizeBand === l.sizeBand); };
/** What a region buys among the TVs the grid holds: its leading type and size band in the lean's shares, over the grid's own values. */
const gridLead = async (region) => { const c = await client.coldstart(region); const s = c && c.lean && c.lean.inForce ? c.lean.share : null; if (!s) return null;
  const pool = gridPool(); const top = (dim) => { const have = new Set(pool.map((p) => p.attributes[dim])); const best = Object.entries(s[dim] || {}).filter(([v]) => have.has(v)).sort((x, y) => y[1] - x[1])[0]; return best ? best[0] : null; };
  return { type: top('type'), sizeBand: top('sizeBand') }; };

// ── Lane P3's helpers for its checks (written by P3, integrated by S1 into the suite's order) ──
//      through it, and the two outcomes credited to the decisions that earned them. Written by lane P3
//      (docs/lg/lanes/P.md, P3); lane S1 integrates. S1's own checks for these beats run first; these run after them.
const SIGN = `${API}/sign-in`;
const account = ((PAGE_SITE.signIn || {}).accounts || [])[0] || null;
/** P3's own beat-16 products, from its section of the served oh.js (the last `const WALK = {…}`). */
const W = (() => { const all = [...String(shells.js || '').matchAll(/\bconst WALK = \{([^}]*)\}/g)]; const m = all[all.length - 1]; const out = {};
  for (const [, k, v] of String(m ? m[1] : '').matchAll(/([\w$]+):\s*('[^']*'|"[^"]*"|[\d.]+)/g)) out[k] = /^['"]/.test(v) ? v.slice(1, -1) : Number(v); return out; })();
const reg = anchor.registry || {};
const tau = (dim) => Number((((reg.dimensions || []).find((x) => x.key === dim)) || {}).tauMs) || Number(reg.tauMs) || 0;
/** Every signal a profile holds, across every dimension whatever its memory, as dim:value. */
const heldSignals = (dims) => Object.entries(dims || {})
  .flatMap(([dim, vals]) => Object.entries(vals || {}).filter(([, a]) => Number(a) > 0).map(([value]) => `${dim}:${value}`));
const json = (t) => { try { return JSON.parse(t); } catch { return null; } };
/** The route as the page's api() door calls it, with the raw answer kept: its text and its headers, read whole. */
async function p3SignIn(v, body) {
  const res = await get(`${base}${SIGN}`, { method: 'POST', headers: { 'X-SDK-Key': 'demo-site', 'Content-Type': 'application/json', 'X-Tenant': TENANT,
    ...(v ? { 'X-Shopper-Session': v.session.capability } : {}) }, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, text, body: json(text), headers: [...res.headers], cookies: typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [] };
}
const p3Date = () => new Date().toISOString().slice(0, 10);
const p3Report = async () => (await demoRoute(`${API}/report`, { date: p3Date(), slot: 'pdp-modules', build: true })).report;
const named = (rep, e) => ((((rep || {}).namedOutcomes || {}).events || {})[e]) || { outcomes: 0, credited: 0, bySlot: {} };
const creditsOn = (rep, e, item) => Number(((named(rep, e).bySlot || {})['pdp-modules'] || {})[item]) || 0;

const open = [];
let her = null, last = null, beat1 = null, rail1 = null;   // rail1: Recommended for you at beat 1, as POST /sort answered it
let closedAt11 = [];   // the closing offers the room saw on her homepage before beat 11 (the reset must bring them back)

/** The outcomes of each built beat, by its key in beats.json, in the director's order. */
const OUTCOMES = {
  async arrive(b) {
    const reset = await demoRoute(`${API}/reset`, {});
    ok(`POST ${API}/reset republishes the opening slots, then the opening catalog`, (reset.applied || []).map((x) => x.name).join(',') === 'open-slots,open-catalog',
      (reset.applied || []).map((x) => `${x.name}@${x.revision}`).join(' '));
    her = await client.mintVisitor(anchor.landing.entry, 'A');
    ok('a shopper session is minted from the landing, with her explicit consent', Boolean(her.session && her.session.capability),
      `${her.entry.utmMedium} · ${her.entry.utmSource} · term “${her.entry.utmTerm}”`);
    const cold = await client.coldstart(null);
    const r = (cold && cold.region) || {}, lean = (cold && cold.lean) || null;
    page.own = r.key || null;
    const said = r.source === 'edge' && r.key ? `from the request${LOOPBACK ? ', as the local runtime fills it (wrangler dev: request.cf is Miniflare’s stand-in, not an edge)' : ': the edge located her'}`
      : r.source === 'none' ? 'no region on this request' : `unexpected source “${r.source}”`;
    ok(`her region comes ${said}, nothing asserted`, Boolean(cold) && ((r.source === 'edge' && Boolean(r.key)) || (r.source === 'none' && cold.grain === 'national')),
      cold ? `${r.key || 'no key'} · ${cold.grain} · ${cold.census ? `${cold.census.label} $${cold.census.medianHouseholdIncomeUsd}` : 'no census'}` : 'no answer');
    ok('the panel says the sentence, verbatim', Boolean(cold) && cold.sentence === 'aggregate, never the individual; we curate, never price.', cold && cold.sentence);
    {
      // The ruling of 730eaa3 (S2): the lean is a fixed seeded lean per state, labelled synthetic, with no census term and no price tier.
      const seededLabel = String(((lean && lean.seeded) || {}).label || '');
      ok('the lean’s own label carries no census term: it is the brand’s seeded sales, not a mix tilted by income', Boolean(seededLabel) && !/census|income/i.test(seededLabel.replace(/\(no census\)/i, '')),
        seededLabel || 'no seeded label');
      const regAllow = (((anchor.learn || {}).regional || {}).dimensions) || [];
      REGIONAL.allow = regAllow;
      ok(`and no regional dimension is the price tier: the published allowlist (${regAllow.join(', ')}) and the lean’s leaders and shares`, regAllow.length > 0 && !regAllow.includes('priceTier')
        && !Object.keys((lean && lean.leaders) || {}).includes('priceTier') && !Object.keys((lean && lean.share) || {}).includes('priceTier'), lean ? `leaders ${JSON.stringify(lean.leaders)}` : 'no lean');
    }
    ok('the census is shown and never scored', Boolean(cold && cold.scored) && cold.scored.census === false && Boolean(cold.scored.sentence), cold && cold.scored && cold.scored.sentence);
    if (page.own) {
      ok(`the regional lean is in force for ${page.own}, labelled synthetic → warehouse`, Boolean(lean) && lean.inForce === true && lean.answered === page.own
        && lean.dataSource === 'synthetic' && lean.swapTo === 'warehouse' && lean.label === 'synthetic → warehouse',
        lean ? `${lean.events} synthetic sales · leaders ${JSON.stringify(lean.leaders)}` : 'no lean');
    } else info('no region on this request: the national figure is shown, and no regional lean is claimed');
    const viewed = await client.send(her, 'page_view', { page: home.page });
    ok(`her page_view is accepted (${viewed.status})`, viewed.ok);
    const s = await ask(her, home.page);
    last = s; beat1 = s;
    info(`hero ${fmt(s.slot('hero'))} | rooms ${fmt(s.slot('category-rail'))} | deals ${fmt(s.slot('deals'))} | ${s.ms} ms`);
    ok(`the homepage is decided (${s.ms} ms)`, s.all.length > 0);
    for (const slot of homeSlots) {
      const got = s.slot(slot.slot);
      if (slot.gate) ok(`${slot.slot} is gated (${Object.keys(slot.gate).join(', ')}) and fails closed for a stranger`, got.length === 0, ids(got).join(', '));
      else ok(`${slot.slot} answers within its take of ${slot.take}`, got.length > 0 && got.length <= slot.take, ids(got).join(', '));
    }
    ok('every piece decided comes from the opening catalog', s.all.every((d) => opening.has(d.customerContentId)), s.all.filter((d) => !opening.has(d.customerContentId)).map((d) => d.customerContentId).join(', '));
    const four = s.slot('deals');
    if (page.own) {
      ok(`the arrival deals (${DEALS_N}) are decided on ${page.own}’s own sales: each carries the regional driver for the request’s region, nothing asserted`,
        s.asked.region === null && four.length === DEALS_N && four.every((d) => { const g = regionalOf(d); return g && g.value === page.own; }),
        four.map((d) => { const g = regionalOf(d); return `${d.customerContentId} ${g ? `${g.value} ${Number(g.a).toFixed(2)}` : 'no regional driver'}`; }).join(' · '));
      ok(`and the room tiles lean the same way: the category rail is decided on ${page.own}’s sales`, s.slot('category-rail').every((d) => { const g = regionalOf(d); return g && g.value === page.own; }),
        s.slot('category-rail').map((d) => `${d.customerContentId} ${(regionalOf(d) || {}).value || 'none'}`).join(' · '));
    }
    rail1 = ((await forYouRail()).ids || []).slice(0, 8);
    const m = await client.meters(her);
    ok('her own meters are empty: nothing about her is known yet', Object.keys(m.dims).length === 0, Object.keys(m.dims).join(', '));
    const recs = await receiptsFor(her, [...s.slot('hero'), ...four], s);
    const rec = (d) => (d && recs.get(d.decisionId)) || null;
    const heroRec = rec(s.slot('hero')[0]);
    const term = anchor.arrival.utm_term;
    const seeded = (x) => Boolean(x && x.explain && x.explain.contextual && Number(x.explain.contextual.applied) > 0
      && (x.explain.contextual.drivers || []).some((y) => y.signal === 'campaign_term' && y.value === term && y.tag === 'tvs'));
    ok(`the search “${term}” seeds TV: the hero’s receipt itemises the campaign term as context`, seeded(heroRec),
      heroRec && heroRec.explain && heroRec.explain.contextual ? `${heroRec.customer_item_id} campaign_term → tvs +${heroRec.explain.contextual.applied}` : 'no campaign on the hero record');
    const seededDeals = four.filter((d) => seeded(rec(d)));
    ok('and on the deals: the TV deals’ receipts itemise it too', seededDeals.length > 0, seededDeals.map((d) => d.customerContentId).join(', ') || `${recs.size} receipt(s) read`);
    ok('the click from the search reads as paid search on the receipt’s cell', Boolean(heroRec && heroRec.cell && heroRec.cell.channel === 'paid_search'),
      heroRec && heroRec.cell ? `channel ${heroRec.cell.channel}` : 'no cell');
    if (page.own) {
      ok(`the receipt names the regional prior for ${page.own}, from the request, not asserted`, Boolean(heroRec && heroRec.explain && heroRec.explain.regional
        && heroRec.explain.regional.region === page.own && heroRec.explain.regional.asserted !== true), heroRec && heroRec.explain && heroRec.explain.regional
        ? `${heroRec.explain.regional.region} λ ${heroRec.explain.regional.lambda} · ${heroRec.explain.regional.events} events` : 'no regional block');
    }
    ok('and no receipt carries a visitor or session id', recs.size > 0 && [...recs.values()].every((x) => !('visitor_id' in x) && !('session_id' in x)), `${recs.size} read`);
    {
      // The receipt's own-decisions rule: another shopper may not read hers, and she may not read another's.
      const other = await client.mintVisitor({}, 'B');
      const theirs = await ask(other, home.page);
      const asOther = await call(`${API}/receipt`, { visitor: other, body: { decisionIds: [four[0].decisionId] } });
      ok(`another shopper asking for her decision is refused (${asOther.status})`, asOther.status === 400 && /own decisions/.test(String((asOther.body || {}).error)), (asOther.body || {}).error);
      const mixed = await call(`${API}/receipt`, { visitor: her, body: { decisionIds: [four[0].decisionId, theirs.all[0].decisionId] } });
      ok(`and her own session asking for one of hers and one of theirs is refused whole (${mixed.status})`, mixed.status === 400 && /own decisions/.test(String((mixed.body || {}).error)), (mixed.body || {}).error);
    }
    {
      // Lane P1's checks for this beat (P1 wrote them; S1 runs them after its own, in the beat's order).
      const lead = page.own ? await gridLead(null) : null;
      const grid = await sortRail('tv-grid', gridPool());
      const reg = grid.regional;
      ok(`the TV grid leans with ${page.own || 'the request'}’s sales from the first paint: POST /sort labels it ${page.own}, from the request, on the published allowlist (${regDims.join(', ')})`,
        Boolean(reg) && reg.region === page.own && reg.asserted !== true && JSON.stringify(reg.dimensions) === JSON.stringify(regDims),
        reg ? `${reg.region} · ${reg.level} · λ ${reg.lambda}` : `no regional label (${grid.status})`);
      if (lead) ok(`and a stranger’s grid opens on what ${page.own} buys: ${lead.type}, ${lead.sizeBand}`, firstIs(grid.ids[0], lead), `${grid.ids[0]} · ${row(grid.ids[0]) ? `${row(grid.ids[0]).attributes.type} ${row(grid.ids[0]).attributes.sizeBand}` : ''}`);
      const rail = await forYouRail();
      ok('“Recommended for you” leans with the same region, labelled from the request', Boolean(rail.regional && rail.regional.region === page.own && rail.regional.asserted !== true), JSON.stringify(rail.regional || {}).slice(0, 120));
      ok('the page says the lean in the answer’s own words: “leans with <state>’s sales”, “(asserted)” when the answer says so, labelled synthetic → warehouse',
        /leans with \$\{name\}’s sales\$\{reg\.asserted \? ' \(asserted\)' : ''\}/.test(shells.js) && /synthetic → warehouse/.test(shells.js), '/oh/oh.js leanLine');
    }
  },

  async contrast(b) {
    const list = ((anchor.regions && anchor.regions.contrast) || []).filter((k) => k !== page.own);
    const mine = ((await client.coldstart(null)) || { lean: {} }).lean.leaders || {};
    const sig = (l) => `${(l || {}).type || ''}|${(l || {}).sizeBand || ''}`;
    let contrast = null;
    for (const k of list) { const c = await client.coldstart(k); if (c && c.lean && sig(c.lean.leaders) !== sig(mine)) { contrast = k; break; } }
    contrast = contrast || list[0] || 'US-TX';
    info(`the contrast the page picks: ${contrast}, the first of ${list.join(', ')} whose sales lean another type or size band than ${page.own}’s (${sig(mine)})`);
    page.region = contrast;
    const cc = await client.coldstart(contrast);
    ok(`the panel reads ${contrast} as asserted, not observed, with its own lean labelled synthetic → warehouse`, Boolean(cc) && cc.region && cc.region.key === contrast && cc.region.source === 'asserted'
      && cc.lean && cc.lean.answered === contrast && cc.lean.label === 'synthetic → warehouse', cc ? `${(cc.region || {}).key} · ${(cc.region || {}).source} · leaders ${JSON.stringify((cc.lean || {}).leaders)}` : 'no answer');
    const t = await ask(her, home.page);
    info(`hero ${fmt(t.slot('hero'))} | rooms ${fmt(t.slot('category-rail'))} | deals ${fmt(t.slot('deals'))}`);
    ok(`the homepage is decided with ctx.region = ${contrast} asserted on the request`, t.all.length > 0 && t.asked.region === contrast);
    const four = t.slot('deals');
    ok(`the deals (${DEALS_N}) answer ${contrast}’s sales: each carries the regional driver for the asserted region`, four.length === DEALS_N && four.every((d) => { const g = regionalOf(d); return g && g.value === contrast; }),
      four.map((d) => `${d.customerContentId} ${(regionalOf(d) || {}).value || 'none'}`).join(' · '));
    const m = await client.meters(her);
    ok('her meters did not move: a region is context, never evidence', Object.keys(m.dims).length === 0, Object.keys(m.dims).join(', '));
    const recs = await receiptsFor(her, four.slice(0, 1), t);
    const rec = recs.get(four[0].decisionId);
    ok('the receipt names the region as asserted', Boolean(rec && rec.explain && rec.explain.regional && rec.explain.regional.region === contrast && rec.explain.regional.asserted === true
      && rec.asserted && rec.asserted['ctx.region'] && rec.asserted['ctx.region'].value === contrast), rec ? JSON.stringify(rec.asserted || {}) : 'no record');
    {
      // When the two states' sales lean differently (the panel's own leaders), the page leans differently: the room tiles or the four.
      const own = page.own ? await client.coldstart(page.own) : null;
      const differ = own && own.lean && cc && cc.lean && JSON.stringify(own.lean.leaders) !== JSON.stringify(cc.lean.leaders);
      if (differ && beat1) {
        const r1 = await forYouRail();
        const moved = ['category-rail', 'deals'].filter((slot) => JSON.stringify(ids(beat1.slot(slot))) !== JSON.stringify(ids(t.slot(slot))));
        if (rail1 && JSON.stringify(rail1) !== JSON.stringify(r1.ids.slice(0, rail1.length))) moved.push('the rail across rooms');
        ok(`${contrast}’s sales lean the page another way than ${page.own}’s: ${moved.join(' and ') || 'nothing'} moved`, moved.length > 0,
          `leaders ${JSON.stringify(own.lean.leaders)} → ${JSON.stringify(cc.lean.leaders)} · rooms ${ids(t.slot('category-rail')).join(', ')} · deals ${ids(four).join(', ')} · rail ${r1.ids.slice(0, 4).join(', ')}`);
        ok(`and the rail across rooms leans with ${contrast}: POST /sort answers with the asserted region on its regional block`, Boolean(r1.regional && r1.regional.region === contrast && r1.regional.asserted === true),
          JSON.stringify(r1.regional || {}).slice(0, 120));
      } else info(`the two regions’ leaders are the same (${page.own || 'none'} and ${contrast}), so no difference on the page is claimed`);
    }
    last = t;
    {
      // Lane P1's checks for this beat (P1 wrote them; S1 runs them after its own, in the beat's order).
      // The page asserts the first configured contrast region whose sales lean differently (type and size band), read off the panel.
      const own = page.own ? await leaders(null) : null;
      let pick = null, firstOther = null;
      for (const key of (anchor.regions && anchor.regions.contrast) || []) {
        if (key === page.own) continue;
        firstOther = firstOther || key;
        if (sig(await leaders(key)) !== sig(own)) { pick = key; break; }
      }
      pick = pick || firstOther;
      const lead = await gridLead(pick);
      ok(`beat 2’s region, as the page chooses it: ${pick}, the first configured contrast whose sales lean differently from ${page.own || 'hers'}`,
        Boolean(pick) && /p1Contrast/.test(JSON.stringify((beatsDoc.beats.find((x) => x.key === 'contrast') || {}).run || [])), `${sig(own)} → ${sig(lead)}`);
      page.region = pick;                                       // the walk follows the page's own assertion from here
      const t = await ask(her, home.page);
      ok(`asserted ${pick}: the deals (${DEALS_N}) carry ${pick}’s regional driver`, t.slot('deals').length === DEALS_N && t.slot('deals').every((d) => (regionalOf(d) || {}).value === pick), fmt(t.slot('deals')));
      const grid = await sortRail('tv-grid', gridPool());
      ok(`and the TV grid leans with ${pick}’s sales, labelled asserted, opening on what ${pick} buys (${lead ? `${lead.type}, ${lead.sizeBand}` : 'no lean'})`,
        Boolean(grid.regional && grid.regional.region === pick && grid.regional.asserted === true) && firstIs(grid.ids[0], lead),
        grid.regional ? `${grid.ids[0]} · ${grid.regional.region}${grid.regional.asserted ? ' (asserted)' : ''}` : `no regional label (${grid.status})`);
      last = t;
    }
  },

  // ── Act 2: two rooms, and the fresh visitor beside her (lane P1) ──
  async 'two-rooms'(b) {
    page.region = null;                                       // { assert: { region: 'own' } }: back in her own region, nothing asserted
    const before = last;
    await client.send(her, 'page_view', { page: 'tvs' });
    let grid = await sortRail('tv-grid', gridPool());
    ok(`the TV grid is sorted for her by POST /sort over ${gridPool().length} TVs`, grid.ids.length > 1, `${grid.status} · ${grid.ids.slice(0, 3).join(', ')}`);
    const tv1 = row(grid.ids.find((id) => !opened.includes(id)));
    await openProductAs(tv1);
    grid = await sortRail('tv-grid', gridPool());             // Back: the grid restored and asked again, no new view
    const tv2 = row(grid.ids.find((id) => !opened.includes(id)));
    await openProductAs(tv2);
    const washer = row(P1MENU_LEAD.find((id) => row(id)) || WALK.washer);
    await openProductAs(washer);                              // from the Laundry menu: the site's own pick, the same for everyone
    await client.send(her, 'page_view', { page: home.page });
    const s = await ask(her, home.page);
    const m = await client.meters(her);
    const a = (dim, v) => Number(((m.dims[dim] || {})[v]) || 0);
    info(`opened ${tv1.sku} (${tv1.attributes.type}), ${tv2.sku} (${tv2.attributes.type}), ${washer.sku} · rooms ${fmt(s.slot('category-rail'))} · deals ${fmt(s.slot('deals'))}`);
    ok('room rises on her own meters: the living room and the laundry room', a('room', 'living-room') > 0 && a('room', 'laundry-room') > 0,
      `living-room ${a('room', 'living-room').toFixed(3)} · laundry-room ${a('room', 'laundry-room').toFixed(3)}`);
    ok(`and type: her TVs’ ${tv1.attributes.type} and the washer’s ${washer.attributes.type}`, a('type', tv1.attributes.type) > 0 && a('type', washer.attributes.type) > 0,
      `${tv1.attributes.type} ${a('type', tv1.attributes.type).toFixed(3)} · ${washer.attributes.type} ${a('type', washer.attributes.type).toFixed(3)}`);
    const tiles = ids(s.slot('category-rail'));
    const roomOfTile = (cid) => ((pieceById(cid) || {}).tags || {}).room || [];
    ok('the room tiles reorder on her rooms: each is the living room’s or the laundry room’s, and the order moved', tiles.every((cid) => roomOfTile(cid).some((r) => ['living-room', 'laundry-room'].includes(r)))
      && Boolean(before) && JSON.stringify(tiles) !== JSON.stringify(ids(before.slot('category-rail'))), `${before ? ids(before.slot('category-rail')).join(', ') : '?'} → ${tiles.join(', ')}`);
    const rail = await forYouRail();
    const take = ((demo.pages.find((p) => p.entry === 'home') || {}).sorted || []).find((r) => r.slot === 'for-you');
    const top = rail.ids.slice(0, (take && take.take) || 8);
    const rooms = new Set(top.map((id) => (row(id) || { attributes: {} }).attributes.room));
    ok('Recommended for you keeps both rooms instead of swapping wholesale: POST /sort’s first eight hold the living room and the laundry room', rooms.has('living-room') && rooms.has('laundry-room'),
      `${[...rooms].join(', ')} · ${top.slice(0, 4).join(', ')}`);
    ok(`and it says the lean it carries: the regional block names ${page.own}, from the request`, Boolean(rail.regional && rail.regional.region === page.own && !rail.regional.asserted), JSON.stringify(rail.regional || {}).slice(0, 120));
    last = s;
    {
      // Lane P1's checks for this beat (P1 wrote them; S1 runs them after its own, in the beat's order).
      const s = last;
      const rooms = s.slot('deals').map((d) => pieceRoom(d.customerContentId)[0]);
      const per = rooms.reduce((x, r) => ({ ...x, [r]: (x[r] || 0) + 1 }), {});
      ok(`the deals hold both rooms, at most ${DEALS_MAX} each, by the slot’s own diversity rule`, rooms.includes('living-room') && rooms.includes('laundry-room') && Object.values(per).every((n) => n <= DEALS_MAX),
        Object.entries(per).map(([r, n]) => `${r} ${n}`).join(' · '));
      {
        // The control: one question over every room's products swaps wholesale to her strongest room; the rail asks per room instead.
        const all = await sortRail('for-you', P1POOL.flatMap(([room, cats]) => roomProducts(room, cats)));
        const one = all.ids.slice(0, 8).reduce((x, id) => { const r = (row(id) || { attributes: {} }).attributes.room; return { ...x, [r]: (x[r] || 0) + 1 }; }, {});
        info(`control: one POST /sort over all ${P1POOL.flatMap(([room, cats]) => roomProducts(room, cats)).length} would show ${Object.entries(one).map(([r, n]) => `${r} ${n}`).join(' · ')} in its first eight`);
      }
    }
  },
  async 'fresh-visitor'(b) {
    const mine = await ask(her, home.page);
    const fresh = await client.mintVisitor({}, 'Fresh visitor');   // direct, consent granted, nothing sent
    const theirs = await ask(fresh, home.page);
    info(`hers ${fmt(mine.slot('deals'))} | the fresh visitor’s ${fmt(theirs.slot('deals'))}`);
    ok('a fresh visitor in the same region, who sent nothing, is decided on the region’s prior alone', theirs.slot('deals').length === DEALS_N
      && theirs.slot('deals').every((d) => { const g = regionalOf(d); return g && g.value === page.own; }), ids(theirs.slot('deals')).join(', '));
    const slots = ['hero', 'category-rail', 'deals'];
    const differ = slots.filter((x) => JSON.stringify(ids(mine.slot(x))) !== JSON.stringify(ids(theirs.slot(x))));
    ok('and her page differs from the stranger’s: what her visit earned', differ.length > 0, differ.join(', ') || 'the same page');
    const mf = await client.meters(fresh);
    ok('the fresh visitor’s meters are empty: nothing was sent for them', Object.keys(mf.dims).length === 0, Object.keys(mf.dims).join(', '));
    last = mine;
  },

  // ── Act 3 and 4: the product pages (lane P2) ──
  async 'washer-page'(b) {
    const p = row(WALK.washer);
    const s = await openProductAs(p);
    const mods = s.slot('pdp-modules');
    info(`modules ${fmt(mods)} | offers ${fmt(s.slot('pdp-offers'))}`);
    ok(`the washer page is decided with ctx.anchor = ${p.sku} and ctx.family = ${p.family} asserted`, s.asked.anchor === p.sku && s.asked.family === p.family && mods.length > 0);
    // The set-price card only where the catalog in force holds it live (4e71874 publishes it as a draft: no laundry set costs less).
    const pairLive = (() => { const x = pieceById('mod-laundry-pair-price'); return Boolean(x) && (!x.lifecycle || x.lifecycle.status === 'live'); })();
    const want = ['mod-laundry-dryer', 'mod-laundry-pedestal', 'mod-laundry-stacking', ...(pairLive ? ['mod-laundry-pair-price'] : [])];
    if (!pairLive) ok('the set-price card is not decided: the catalog in force holds it as a draft, since no set costs less than its pieces', !ids(mods).includes('mod-laundry-pair-price'), ids(mods).join(', '));
    ok(`the room completes below the buy box: the dryer, the pedestal, the stacking kit${pairLive ? ' and the pair price' : ''} are decided`, want.every((id) => ids(mods).includes(id)),
      want.filter((id) => !ids(mods).includes(id)).map((id) => `${id} missing`).join(', ') || ids(mods).join(', '));
    ok(`each is preferred because it completes ${p.sku}: the completes driver on every one`, want.every((id) => completesOf(mods.find((d) => d.customerContentId === id)) === p.sku),
      want.map((id) => `${id} ${completesOf(mods.find((d) => d.customerContentId === id)) || 'none'}`).join(' · '));
    const recs = await receiptsFor(her, mods.filter((d) => want.includes(d.customerContentId)), s);
    ok('and the receipts carry it: the completes line is on the record, not only the answer', want.every((id) => { const d = mods.find((x) => x.customerContentId === id); const r = d && recs.get(d.decisionId);
      return r && ((r.explain && r.explain.drivers) || []).some((x) => x.dim === 'completes' && x.value === p.sku); }), `${recs.size} receipt(s) read`);
    {
      // The dryer in her fuel: POST /sort over the dryers of this series leans with the region in force (the brand's sales).
      const dryers = companionIds(p, 'dryers');
      const order = await sortIds(dryers);
      const region = page.region || page.own;
      const cs = region ? await client.coldstart(region === page.own && !page.region ? null : region) : null;
      const leanFuel = cs && cs.lean && cs.lean.leaders ? cs.lean.leaders.fuel : null;
      const first = order.ids[0] ? row(order.ids[0]) : null;
      info(`dryers by POST /sort: ${order.ids.map((id) => `${id} ${(row(id).attributes || {}).fuel}`).join(' · ')} · regional ${JSON.stringify(order.regional)}`);
      const regionalOnAll = order.ids.length > 0 && Boolean(order.regional && order.regional.region === region);
      ok(`the dryers are ordered by POST /sort with ${region}’s sales in force on the answer, labelled`, regionalOnAll, `regional ${JSON.stringify(order.regional || {}).slice(0, 100)}`);
      info(first ? `the first dryer is ${first.sku}, ${first.attributes.fuel}; ${region}’s sales lean ${leanFuel}` : 'no dryer order');
      // R4 F1 (S2): a fuel is hers only when her own profile carries one; what put the first dryer first is read off /sort's
      // own items, as the page asks it (the DOM suite holds the card to both).
      const herFuel = Object.entries((await client.meters(her)).dims.fuel || {}).filter(([, a]) => Number(a) > 0);
      const candidates = dryers.filter((id) => row(id)).map((id) => { const { productId, ...a } = productAttrs(row(id)); return { id, ...a }; });
      const full = await call('/sort', { visitor: her, body: { userId: her.session.subject, sessionId: her.session.sessionId, candidates, ...(page.region ? { context: { region: page.region } } : {}) } });
      const ord = full.ok && Array.isArray(full.body.order) ? full.body.order.map(String) : [];
      const sep = separating(full.body, ord[0], ord[1]);
      ok(`POST /sort says on its own items why its first dryer leads: ${sep ? `${sep.dim} ${sep.value}, +${sep.gap} over the second` : 'no driver'} (her own fuel reading: ${herFuel.length ? herFuel.map(([v, a]) => `${v} ${Number(a).toFixed(2)}`).join(', ') : 'none'})`,
        Boolean(sep), `${ord.slice(0, 2).join(' over ')} · ${(full.body.items || []).length} items`);
      if (!herFuel.length && first) info(`so no card may call the ${first.attributes.fuel} dryer “in her fuel”: her profile holds no fuel (the DOM suite reads the card against this)`);
      const sets = ((p.companions || {}).packages || []).map(row).filter((x) => x && x.salePrice != null).map((x) => { const parts = String(x.sku).split('_').map(row);
        const apart = parts.every((m) => m && m.salePrice != null) ? parts.reduce((n, m) => n + Number(m.salePrice), 0) : null; return { sku: x.sku, set: Number(x.salePrice), apart }; });
      info(`${p.sku}’s sets against their pieces (R4 F7; the page shows the set-price card only when one is lower, the DOM suite reads it): ${sets.map((x) => `$${x.set} · apart $${x.apart}${x.apart !== null && x.set < x.apart ? ' lower' : ''}`).join(' · ')}`);
    }
    {
      // Fails closed: the same page asked without the anchor and the family completes nothing.
      const bare = await ask(her, 'product', {});
      const leaked = bare.slot('pdp-modules').filter((d) => want.includes(d.customerContentId));
      ok('control: the same page asked without ctx.anchor and ctx.family returns none of them (the rule fails closed)', leaked.length === 0, ids(leaked).join(', ') || ids(bare.slot('pdp-modules')).join(', '));
    }
    P2STATE.washer = { sku: p.sku, mods: ids(mods) };
    last = s;
    {
      // Lane P2's checks for this beat (P2 wrote them; S1 runs them after its own, in the beat's order).
        const p = row(WALK.washer);
        const t = transportJs();
        ok('the kit’s transport takes context signals on the snapshot: ask(pageKey, v, { context }) and a config.context hook, region and intent kept the kit’s own',
          /async function ask\(pageKey, v = cur\(\), opts = \{\}\)/.test(t) && /function contextSignals\(pageKey, v, own\)/.test(t) && /cfg\.context \? cfg\.context\(pageKey, v\)/.test(t)
          && /name === 'region' \|\| name === 'intent'/.test(t), 'public/demo-kit/transport.js');
        ok('the product page asks through it: its own question passes ctx.anchor and ctx.family as the hook’s context',
          /LANES\.ask\[productKey\(\)\] = askProduct/.test(shells.js) && /transport\.ask\(key, v, \{ context: askContext\(p, v\) \}\)/.test(shells.js), '/oh/oh.js askProduct');
        const anchorOnly = await ask(her, 'product', { anchor: p.sku });
        ok('the anchor alone opens no companion: the family gate fails closed', companionsOf.every((id) => !ofSlot(anchorOnly).includes(id)), ofSlot(anchorOnly).join(', ') || 'nothing decided');
        const familyOnly = await ask(her, 'product', { family: p.family });
        ok('the family alone opens the gate, and completes nothing: no decision carries a completes driver without the anchor',
          familyOnly.slot('pdp-modules').length > 0 && familyOnly.all.every((d) => !drivers(d).some((x) => x.dim === 'completes')), `${ofSlot(familyOnly).join(', ')}`);
        // The buy box is the catalog's: its renderer reads the product row and never a decision.
        const m = /function renderBuyBox\(p\) \{([\s\S]*?)\r?\n  \}\r?\n/.exec(codeOnly(shells.js, 'js'));   // S2: CRLF-tolerant (oh.js is served with CRLF since M1/M2 landed)
        ok('the buy box is painted from the catalog alone: its renderer reads no decision, no set and no receipt',
          Boolean(m) && !/state\.sets|bySlot|decision|receipt|\.score\b/.test(m[1]), m ? `${m[1].split('\n').length} lines read` : 'no renderBuyBox in /oh/oh.js');
    }
  },
  async 'top-loader'(b) {
    const washer = row(WALK.washer);
    const top = typeTarget(washer, 'top-load');
    ok(`the type switch’s top-loader is the best seller at the washer’s tier: ${top ? `${top.sku} (${top.reviews} reviews)` : 'none'}`, Boolean(top));
    const s = await openProductAs(top);
    const mods = s.slot('pdp-modules');
    info(`modules ${fmt(mods)}`);
    ok(`the top-loader page asserts ctx.family = ${top.family}`, s.asked.family === top.family && s.asked.anchor === top.sku);
    const gone = ['mod-laundry-pedestal', 'mod-laundry-stacking'].filter((id) => (P2STATE.washer || { mods: [] }).mods.includes(id));
    ok('the pedestal leaves: it was on the front-loader’s page and is not decided here', gone.includes('mod-laundry-pedestal') && !ids(mods).includes('mod-laundry-pedestal'), `was ${gone.join(', ') || 'not there'} · now ${ids(mods).join(', ')}`);
    ok('and the stacking kit with it', !ids(mods).includes('mod-laundry-stacking'));
    {
      // The reason is the rule itself: each withdrawn piece's eligibleWhen serves other families only.
      const why = gone.map((id) => { const piece = (openCatalog.pieces || []).find((x) => x.customerContentId === id) || {}; const fams = ((piece.eligibleWhen || {}).context || {}).family; return [id, fams]; });
      ok(`the reason is its own rule: each serves ${why.map(([, f]) => (f || []).join(' and ')).join('; ')} only, never ${top.family}`, why.length > 0 && why.every(([, f]) => Array.isArray(f) && !f.includes(top.family)),
        why.map(([id, f]) => `${id}: ${JSON.stringify(f)}`).join(' · '));
    }
    ok(`the dryer stays, completing the new washer ${top.sku}`, completesOf(mods.find((d) => d.customerContentId === 'mod-laundry-dryer')) === top.sku);
    last = s;
    {
      // Lane P2's checks for this beat (P2 wrote them; S1 runs them after its own, in the beat's order).
        const top = typeTarget(row(WALK.washer), 'top-load');
        const note = top && top.companions ? top.companions.pedestalsNote : null;
        ok(`the withdrawal’s reason on the card is the feed’s own words for ${top ? top.sku : 'the top-loader'}: “${note || 'none'}”`, Boolean(note) && /no pedestal/i.test(note));
        ok('and the feed holds no pedestal or stacking kit for it: the relation and the rule agree', Boolean(top) && !(top.companions.pedestals || []).length && !(top.companions.stackingKits || []).length);
    }
  },
  async 'tv-page'(b) {
    const p = row(WALK.tv);
    const s = await openProductAs(p);
    const mods = s.slot('pdp-modules');
    info(`modules ${fmt(mods)} | VESA ${p.vesa || 'none'}`);
    for (const [id, what] of [['mod-tv-soundbar', 'the soundbar for its series'], ['mod-tv-mount', `the mount for its VESA pattern${p.vesa ? ` (${p.vesa})` : ''}`]]) {
      const d = mods.find((x) => x.customerContentId === id);
      ok(`${what} is decided, completing ${p.sku}`, Boolean(d) && completesOf(d) === p.sku, d ? `${id} completes ${completesOf(d) || 'nothing'}` : `${id} not decided`);
    }
    const mounts = companionIds(p, 'mounts');
    ok(`and there is a mount to show: the feed’s relation, or a mount whose own listing names ${p.vesa || 'the pattern'}`, mounts.length > 0 || vesaMounts(p).length > 0,
      `${mounts.length} by relation · ${vesaMounts(p).length} by VESA`);
    last = s;
    {
      // Lane P2's checks for this beat (P2 wrote them; S1 runs them after its own, in the beat's order).
        const p = row(WALK.tv);
        ok(`the mount relation names a mount whose own listing includes ${p.vesa}: the rule is the data’s`, (p.companions.mounts || []).some((id) => vesaMounts(p).some((m) => m.sku === id)),
          `${(p.companions.mounts || []).join(', ')} · by VESA ${vesaMounts(p).map((m) => m.sku).join(', ')}`);
    }
  },
  async 'range-page'(b) {
    const p = row(WALK.range);
    const s = await openProductAs(p);
    const mods = s.slot('pdp-modules');
    info(`modules ${fmt(mods)}`);
    for (const [id, what] of [['mod-range-microwave', 'the over-the-range microwave'], ['mod-range-dishwasher', 'the dishwasher']]) {
      const d = mods.find((x) => x.customerContentId === id);
      ok(`${what} is decided, completing ${p.sku}`, Boolean(d) && completesOf(d) === p.sku, d ? `${id} completes ${completesOf(d) || 'nothing'}` : `${id} not decided`);
    }
    const cheaper = mods.filter((d) => { const piece = pieceById(d.customerContentId); const disp = displayOf(d.customerContentId); return piece && piece.type === 'package' && Number(disp.savings) > 0 && Number(disp.price) < Number(disp.memberSum); });
    ok('and a package that costs less than its pieces apart is decided', cheaper.length > 0,
      cheaper.map((d) => { const x = displayOf(d.customerContentId); return `${d.customerContentId} ${x.price} < ${x.memberSum}`; }).join(' · ') || ids(mods.filter((d) => (pieceById(d.customerContentId) || {}).type === 'package')).join(', '));
    last = s;
    {
      // Lane P2's checks for this beat (P2 wrote them; S1 runs them after its own, in the beat's order).
        const pdp = (openCatalog.pieces || []).filter((x) => (x.slotTypes || []).some((s) => /^pdp-/.test(s)));
        const near = pdp.filter((x) => /affirm|\bapr\b|financ|\/mo\b|per month|monthly/i.test(`${x.title} ${x.subtitle}`)).map((x) => x.customerContentId);
        ok(`no product-page piece speaks of financing: nothing decided sits near the financing line (${pdp.length} pieces read)`, near.length === 0, near.join(', ') || 'none');
    }
  },
  async 'qned-oled'(b) {
    const p = row(WALK.qned);
    const s = await openProductAs(p);
    const mods = s.slot('pdp-modules');
    info(`modules ${fmt(mods)}`);
    ok('the QNED page decides the comparison with the other panel beside it', ids(mods).includes('mod-tv-qned-vs-oled'));
    ok('and the size-up tool, for her viewing distance', ids(mods).includes('mod-tv-size-up'));
    const up = sizeUp(p, WALK.distanceFt);
    ok(`from ${WALK.distanceFt} ft one size up is ${up ? `${up.sku} (${up.sizeInches}″, ${up.attributes.sizeBand}, ${up.attributes.priceTier})` : 'none'} by the piece’s own figures`, Boolean(up));
    if (up) {
      // R4 F2 (S2, replacing “her answer moves size band and price tier on her meters”): her distance goes on the next ask as
      // declared context, ctx.distance; no event is sent for a product she did not choose, so her readings hold.
      const before = await client.meters(her);
      const s9 = await ask(her, 'product', { anchor: p.sku, family: p.family, distance: String(WALK.distanceFt) });
      const after = await client.meters(her);
      const a = (m, dim, v) => Number(((m.dims[dim] || {})[v]) || 0);
      ok(`her distance goes on the next ask as declared context, ctx.distance = ${WALK.distanceFt}, and the page is decided with it`, s9.asked.distance === String(WALK.distanceFt) && s9.all.length > 0, `${s9.all.length} decided`);
      const rose = ['sizeBand', 'priceTier'].flatMap((dim) => Object.keys({ ...(after.dims[dim] || {}) }).filter((v) => a(after, dim, v) > a(before, dim, v) + Math.max(0.02, a(before, dim, v) * 0.03)).map((v) => `${dim} ${v}`));
      ok(`and a distance is not a choice: her size band and price tier hold (${up.attributes.sizeBand} ${a(before, 'sizeBand', up.attributes.sizeBand).toFixed(2)} → ${a(after, 'sizeBand', up.attributes.sizeBand).toFixed(2)})`, rose.length === 0, rose.join(', ') || 'nothing rose');
      last = s9;
    }
    {
      // Lane P2's checks for this beat (P2 wrote them; S1 runs them after its own, in the beat's order).
        const cmp = pieceById('mod-tv-qned-vs-oled');
        ok('the comparison’s own copy says the price is the same for everyone', Boolean(cmp) && /the price is the same for everyone/i.test(`${cmp.title} ${cmp.subtitle}`), cmp ? cmp.subtitle : 'absent');
        const p = row(WALK.qned);
        const other = rowsAll.filter((x) => x.attributes && x.attributes.category === 'tvs' && x.attributes.type === 'oled' && Number(x.sizeInches) === Number(p.sizeInches) && x.salePrice != null);
        ok(`there is an OLED at ${p.sizeInches}″ to stand beside it, at its catalog price: ${other.length}`, other.length > 0, other.map((x) => `${x.sku} $${x.salePrice}`).join(' · ').slice(0, 200));
    }
  },
  async 'closet-width'(b) {
    const p = row(WALK.washer);
    await openProductAs(p);
    const width = WALK.closet;
    await client.sendCustom(her, 'filter', { control: 'fit', widthInches: width, declared: true, productId: p.sku, category: p.attributes.category, type: p.attributes.type, room: p.attributes.room });
    const s = await ask(her, 'product', { anchor: p.sku, family: p.family, fit: String(width) });
    ok(`the next decision asserts her declared width on the request, ctx.fit = ${width}`, s.asked.fit === String(width) && s.all.length > 0, `${s.all.length} decided`);
    const scope = rowsAll.filter((x) => x.family === p.family);
    const wider = scope.filter((x) => { const w = widthOf(x); return w && w > width + 1e-9; });
    info(`of ${scope.length} ${p.family}s, ${wider.length} are wider than ${width} in by the product page’s width, else the feed’s fits (the DOM suite reads the page’s count against this)`);
    ok(`and the data can show the claim: some ${p.family}s are wider than ${width} in, some fit`, wider.length > 0 && wider.length < scope.length, `${wider.length} of ${scope.length} wider`);
    last = s;
    {
      // Lane P2's checks for this beat (P2 wrote them; S1 runs them after its own, in the beat's order).
        const p = row(WALK.washer), width = Number(WALK.closet);
        const scope = rowsAll.filter((x) => x.family === p.family);
        const wider = scope.filter((x) => widthNow(x) && widthNow(x) > width + 1e-9);
        const none = scope.filter((x) => !widthNow(x));
        ok(`under the current ruling (the product page’s width, else the feed’s), ${wider.length} of the ${scope.length} ${p.family}s are wider than ${width} in, and ${none.length} publish no dimensions`,
          wider.length > 0 && wider.length < scope.length, wider.map((x) => `${x.sku} ${widthNow(x)}`).join(' · '));
        ok(`the walk’s washer fits her ${width} in itself: ${widthNow(p)} in`, widthNow(p) !== null && widthNow(p) <= width);
        const same = await ask(her, 'product', { anchor: p.sku, family: p.family });
        const fit = await ask(her, 'product', { anchor: p.sku, family: p.family, fit: String(width) });
        ok('a declared ctx.fit gates nothing it is not named in: the same pieces are decided with it and without it', sameJSON([...ids(same.all)].sort(), [...ids(fit.all)].sort()),
          `${ids(fit.all).length} decided`);
        // Every product the walk's pages can show has D2's accepted image, or the page shows its name on a neutral tile.
        const walk = [WALK.washer, typeTarget(row(WALK.washer), 'top-load') && typeTarget(row(WALK.washer), 'top-load').sku, WALK.tv, WALK.range, WALK.qned].filter(Boolean).map(row).filter(Boolean);
        const shown = new Set(walk.flatMap((x) => [x.sku, ...Object.values(x.companions || {}).flatMap((v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v).flat() : []))]));
        for (const x of rowsAll) if (x.family === p.family) shown.add(x.sku);
        const list = [...shown].filter((sku) => row(sku));
        const tiles = list.filter((sku) => !(imageIndex && imageIndex[sku] && imageIndex[sku].verdict === 'accept'));
        ok(`every product the walk’s pages can show (${list.length}) has D2’s accepted image, or a named tile: ${tiles.length} on a tile`, Boolean(imageIndex) && list.length > 0,
          tiles.join(', ') || 'none on a tile');
    }
  },

  // ── Act 6: three weeks later (lane P1) ──
  async 'three-weeks'(b) {
    const name = SITE_BEAT(b, 'threeWeeks') || '13-three-weeks';
    const reg = anchor.registry || {};
    const m0 = await client.meters(her);
    await client.send(her, 'page_view', { page: home.page });
    const pub = await demoRoute(`${API}/beat`, { kind: 'catalog', name, note: 'page rehearsal: three weeks pass' });
    ok('the clock-jump catalog publishes by name: every window moves back in one publish', pub.ok === true && pub.kind === 'catalog', `revision ${pub.revision}`);
    const days = (PAGE_SITE.clockJump && PAGE_SITE.clockJump.days) || 21;
    const back = await ask(her, home.page, { visit: 'return' });
    const cont = back.slot('continue');
    ok('with the return visit asserted (ctx.visit = return), the continue hero answers her', cont.length === 1, ids(cont).join(', '));
    const bare = await ask(her, home.page);
    ok('control: without it the continue hero stays shut, so a stranger’s first paint never says “pick up where you left off”', bare.slot('continue').length === 0, ids(bare.slot('continue')).join(', '));
    {
      // Her room dials carried three weeks on by the published memory: a = R / (R + K), R decaying by e^(−t/τ) on each dimension.
      const K = Number(reg.K) || 1.8, base = Number(reg.tauMs) || 1209600000, t = days * 86400000;
      const tauOf = (dim) => Number((((reg.dimensions || []).find((x) => x.key === dim)) || {}).tauMs) || base;
      const carry = (a, dim) => { if (!(a > 0) || a >= 1) return a; const r = (a * K) / (1 - a) * Math.exp(-t / tauOf(dim)); return r / (r + K); };
      const fall = (v) => { const a = Number(((m0.dims.room || {})[v]) || 0); return a > 0 ? (a - carry(a, 'room')) / a : null; };
      const tv = fall('living-room'), laundry = fall('laundry-room');
      // What the page measures (the lead's alignment): each room's dial now and its projection three weeks on; a comparison is
      // claimed only when the two fades differ (the DOM suite reads the page's sentence against it).
      const tauLabel = (ms) => (ms < 120000 ? `${Math.round(ms / 1000)} seconds` : ms < 7200000 ? `${Math.round(ms / 60000)} minutes` : `${Math.round(ms / 86400000)} days`);
      ok(`her room dials are read, and the published memory (τ ${tauLabel(tauOf('room'))} on room, K ${K}) projects each ${days} days on`, tv !== null && laundry !== null,
        `living room −${tv !== null ? Math.round(tv * 100) : '?'}% · laundry room −${laundry !== null ? Math.round(laundry * 100) : '?'}%${tv !== null && laundry !== null && Math.round(tv * 100) === Math.round(laundry * 100) ? ': the same fade, so no room is said to fade further' : ''}`);
    }
    if ((Number((((reg.dimensions || []).find((x) => x.key === 'room')) || {}).tauMs) || Number(reg.tauMs) || 1209600000) < 3600000) {
      // On the demo's dial beat 13 says her room signals are gone (every room below θin), so the continue hero rests on her
      // shortlist and the decisions trail: projected here from her own meters at the engine, the page's arithmetic.
      const K = Number(reg.K) || 1.8, t = days * 86400000, thetaIn = Number(reg.thetaIn) || 0.6;
      const tauRoom = Number((((reg.dimensions || []).find((x) => x.key === 'room')) || {}).tauMs) || Number(reg.tauMs);
      const carry = (a) => { if (!(a > 0) || a >= 1) return a; const r = (a * K) / (1 - a) * Math.exp(-t / tauRoom); return r / (r + K); };
      const rooms = Object.entries(m0.dims.room || {}).filter(([, a]) => Number(a) > 0);
      const still = rooms.filter(([, a]) => carry(Number(a)) >= thetaIn);
      ok(`on the demo’s dial every room she holds falls below the entry threshold (θin ${thetaIn.toFixed(2)}) ${days} days on, as beat 13 now says: the continue hero rests on her shortlist and the decisions trail`,
        rooms.length > 0 && still.length === 0, rooms.map(([v, a]) => `${v} ${Number(a).toFixed(3)} → ${carry(Number(a)).toFixed(3)}`).join(' · ') || 'no room held');
    }
    last = back;
    {
      // Lane P1's checks for this beat (P1 wrote them; S1 runs them after its own, in the beat's order).
      const name = SITE_BEAT(beatsDoc.beats.find((x) => x.key === 'three-weeks') || {}, 'threeWeeks') || '13-three-weeks';
      const doc = (await assetJson(`beats/${name}.json`)).publish.document;
      const days = Number((PAGE_SITE.clockJump || {}).days) || 21;
      const from = (list, id) => { const x = (list || []).find((y) => y.id === id); return x && x.window && x.window.from ? Date.parse(x.window.from) : null; };
      const shifts = (doc.pieces || []).map((x) => { const a = from(openCatalog.pieces, x.id), b = from(doc.pieces, x.id); return a !== null && b !== null ? (a - b) / 86400000 : null; }).filter((x) => x !== null);
      ok(`the clock jump’s document moves every window back ${days} days in one publish (${shifts.length} windows)`, shifts.length > 0 && shifts.every((d) => Math.abs(d - days) < 0.01),
        [...new Set(shifts.map((d) => d.toFixed(2)))].join(', '));
    }
  },
  async 'what-changed'(b) {
    // Her shortlist's deltas, read off the documents: the offers on each product she opened, live then and not now.
    const thenDoc = openCatalog;
    const nowDoc = (await assetJson(`beats/${SITE_BEAT({ run: [{ publish: 'catalog', name: '{{beatNames.threeWeeks}}' }] }, 'threeWeeks') || '13-three-weeks'}.json`)).publish.document;
    const live = (p, at) => (!p.window || ((!p.window.from || Date.parse(p.window.from) <= at) && (!p.window.to || Date.parse(p.window.to) > at))) && !(p.lifecycle && p.lifecycle.status && p.lifecycle.status !== 'live');
    const offersFor = (p, doc, at) => (doc.pieces || []).filter((x) => x.type === 'promotion' && live(x, at)
      && ((x.featuredProductIds || []).includes(String(p[SKU])) || (((x.eligibleWhen || {}).context || {}).family || []).includes(p.family)));
    const now = Date.now();
    const rows = opened.map(row).filter(Boolean).map((p) => { const then = offersFor(p, thenDoc, now), nowO = offersFor(p, nowDoc, now); const n = new Set(nowO.map((x) => x.id));
      return { sku: p[SKU], ended: then.filter((x) => !n.has(x.id)).length, running: nowO.length }; });
    info(`her shortlist: ${rows.map((r) => `${r.sku} (${r.ended} ended, ${r.running} running)`).join(' · ')}`);
    ok('her shortlist is what she opened on this device, and the documents in force say what changed on it: offers that ended or still run', rows.length > 0 && rows.some((r) => r.ended + r.running > 0),
      `${rows.length} products · ${rows.reduce((n, r) => n + r.ended, 0)} offer(s) ended · ${rows.reduce((n, r) => n + r.running, 0)} still running`);
    {
      // Lane P1's checks for this beat (P1 wrote them; S1 runs them after its own, in the beat's order).
      // By room: the offers on her TVs ended with the clock jump; one on her washer still runs (the catalog's own windows).
      const nowDoc = (await assetJson(`beats/${SITE_BEAT(beatsDoc.beats.find((x) => x.key === 'three-weeks') || {}, 'threeWeeks') || '13-three-weeks'}.json`)).publish.document;
      const live = (x, at) => !x.window || ((!x.window.from || Date.parse(x.window.from) <= at) && (!x.window.to || Date.parse(x.window.to) > at));
      const offers = (doc, p, at) => (doc.pieces || []).filter((x) => x.type === 'promotion' && live(x, at)
        && ((x.featuredProductIds || []).includes(String(p[SKU])) || (((x.eligibleWhen || {}).context || {}).family || []).includes(p.family)));
      const at = Date.now();
      const rows = opened.map(row).filter(Boolean).map((p) => { const then = offers(openCatalog, p, at).map((x) => x.id), now = offers(nowDoc, p, at).map((x) => x.id);
        return { sku: p[SKU], cat: p.attributes.category, ended: then.filter((x) => !now.includes(x)).length, running: now.filter((x) => then.includes(x)).length }; });
      const tvRows = rows.filter((r) => r.cat === 'tvs'), washerRows = rows.filter((r) => r.cat === 'washers');
      ok('the offers on each TV she opened ended with the clock jump, by the catalog’s own windows', tvRows.length > 0 && tvRows.every((r) => r.ended > 0), tvRows.map((r) => `${r.sku} ${r.ended} ended`).join(' · '));
      ok('and an offer on a washer she opened still runs', washerRows.some((r) => r.running > 0), washerRows.map((r) => `${r.sku} ${r.running} running`).join(' · '));
    }
  },

  // ── Act 7 and 8: one person, and Best Buy counts (lane P3) ──
  async 'phone-sign-in'(b) {
    const account = ((PAGE_SITE.signIn || {}).accounts || [])[0];
    const SIGN = `${API}/sign-in`;
    {
      // The route's doors: a shopper session, its closed list of fictional names, and { account } alone.
      const anon = await call(SIGN, { body: { account } });
      ok(`${SIGN} refuses a caller with no shopper session (${anon.status})`, anon.status === 401);
      const probe = await client.mintVisitor({}, 'sign-in probe');
      const stranger = await call(SIGN, { visitor: probe, body: { account: 'Not A Demo Account' } });
      ok(`and refuses a name outside its closed list (${stranger.status}), naming the demo accounts`, stranger.status === 400 && String((stranger.body || {}).error).includes(account), (stranger.body || {}).error);
      const extra = await call(SIGN, { visitor: probe, body: { account, assertion: 'from the page' } });
      ok(`and refuses a body that carries anything but the account (${extra.status}): no assertion crosses from the page`, extra.status === 400, (extra.body || {}).error);
    }
    const laptop = her;
    // Her three strongest values across every dimension, whatever its memory (P3's topOf, the strip's “strongest at sign-in”).
    const laptopTop = async (v) => { const m = await client.meters(v);
      return Object.entries(m.dims).flatMap(([dim, vals]) => Object.entries(vals).map(([value, a]) => ({ dim, value, a: Number(a) }))).filter((x) => x.a > 0)
        .sort((x, y) => y.a - x.a).slice(0, 3).map((x) => `${x.dim}:${x.value}`); };
    const signIn = async (v) => {
      const r = await call(SIGN, { visitor: v, body: { account } });
      if (r.ok && r.body && r.body.ok === true && r.body.session) v.session = r.body.session;
      return r;
    };
    const L = await signIn(laptop);
    if (L.status === 503) {
      checks.known(`the live sign-in mints the signed link on the worker (${L.status})`, false, `${(L.body || {}).error}`,
        'the rig (this worker has no IDENTITY_SECRETS: .dev.vars carries none and scripts/demo-kit/rig.mjs passes none; the lead or the owner)');
      P3STATE.rigGap = true;
    }
    if (!P3STATE.rigGap) {
    ok(`the laptop signs in as ${account}: the worker mints the signed link and answers success, the person’s session and nothing else`, L.status === 200 && L.body.ok === true && L.body.linked === true
      && L.body.session && L.body.session.kind === 'recognized' && Object.keys(L.body).sort().join(',') === 'linked,ok,session', `${L.status} · keys ${Object.keys(L.body || {}).join(', ')}`);
    ok('consented: her consent rides the link', Boolean(L.body.session && L.body.session.consent && L.body.session.consent.personalization));
    const again = await call(SIGN, { visitor: laptop, body: { account } });
    ok(`a second sign-in from the same browser is refused (${again.status})`, again.status === 409);
    const want = await laptopTop(laptop);
    const phone = await client.mintVisitor({}, 'Her phone');
    await client.send(phone, 'page_view', { page: home.page });
    const before = await client.snapshot(phone, home.page, {});
    const beforeTop = await laptopTop(phone);
    ok('on her phone she is a stranger: none of the laptop’s taste (its three strongest values across every dimension)', want.length > 0 && !want.some((x) => beforeTop.includes(x)), `${beforeTop.join(', ') || 'no taste'} · the laptop’s ${want.join(', ')}`);
    const P = await signIn(phone);
    ok('the phone signs in as the same person', P.status === 200 && P.body.linked === true, `${P.status}`);
    const after = await client.snapshot(phone, home.page, {});
    // Read at the same moment through both sessions, as the page reads them at the link (both now name the person).
    const [afterTop, laptopNow] = await Promise.all([laptopTop(phone), laptopTop(laptop)]);
    const sameSet = (x, y) => x.length > 0 && [...x].sort().join('|') === [...y].sort().join('|');
    ok('and in one request the phone carries the laptop’s taste: her three strongest values across every dimension, read at the same moment through the phone’s and the laptop’s sessions, the same',
      afterTop.length === 3 && sameSet(afterTop, laptopNow), `${afterTop.join(', ')} · the laptop’s ${laptopNow.join(', ')}`);
    const moved = ['hero', 'category-rail', 'deals'].filter((x) => JSON.stringify(ids(before.slot(x))) !== JSON.stringify(ids(after.slot(x))));
    ok('and the phone’s homepage answers as hers', moved.length > 0, moved.join(', ') || 'nothing moved');
    P3STATE.signedIn = true;
    }
    {
      // Lane P3's checks for this beat (P3 wrote them; S1 runs them after its own, in the beat's order).
      if (!account) { ok('the page names a fictional sign-in account (oh.js SITE.signIn)', false); return; }
      const probe = await client.mintVisitor({}, 'P3 probe');
      const refused = [];
      for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', account.toLowerCase(), ` ${account}`, account.split(' ')[0], `oh-demo-${account.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`]) {
        const r = await p3SignIn(probe, { account: name });
        if (r.status !== 400) refused.push(`“${name}” → ${r.status}`);
      }
      for (const body of [{}, { account: [account] }, { name: account }, { account, visitorId: probe.session.subject }, { account, exp: 1 }]) {
        const r = await p3SignIn(probe, body);
        if (r.status !== 400) refused.push(`${JSON.stringify(body).slice(0, 50)} → ${r.status}`);
      }
      ok(`${SIGN}’s closed list refuses prototype names, near misses and the account id itself, and any body but { account } (13 asked)`, refused.length === 0, refused.join(' · '));
      if (P3STATE.rigGap) { info('P3’s checks on the signed link and the merge need the worker to mint it, which this rig cannot (no IDENTITY_SECRETS): open here'); return; }
      const r = await p3SignIn(probe, { account });
      ok('a stranger’s sign-in answers { ok, linked, session } and nothing else: no assertion, no account id, no shopper id field, no audiences',
        r.status === 200 && Boolean(r.body) && Object.keys(r.body).sort().join(',') === 'linked,ok,session' && r.body.session.kind === 'recognized'
          && !/assertion|oh-demo-|"shopperId"|"audiences"|"carry"|"assurance"/.test(r.text), `${r.status} · ${Object.keys(r.body || {}).sort().join(', ')}`);
      ok('and its headers carry no proof either: no-store, the session cookies the link sets, no assertion or account id anywhere',
        r.headers.some(([k, v]) => k === 'cache-control' && /no-store/.test(v)) && r.headers.every(([, v]) => !/assertion|oh-demo-/i.test(v)), `${r.cookies.length} Set-Cookie`);
      const retired = await call('/realtime/reflex', { visitor: probe });
      ok(`the link retired her anonymous session: its old capability reads nothing now (${retired.status})`, retired.status === 401);
      {
        // R4 ruling 3 (F6, S2): the retired anonymous capability cannot sign in again, so a leaked one is never upgraded to the person.
        const again = await p3SignIn(probe, { account });
        ok(`and a retired session cannot sign in again: its old capability is refused (${again.status})`, [401, 403, 409].includes(again.status) && !(again.body && again.body.session), `${again.status}${again.body && again.body.error ? ` · ${String(again.body.error).slice(0, 80)}` : ''}`);
      }
      // The engine's contract (src/routes/identity.test.ts, "the person is the sum"), through this route: a laptop with
      // taste and a phone with none, each signing in as the account, are one person carrying both.
      const laptop = await client.mintVisitor({}, 'P3 laptop');
      for (const sku of [W.tv, W.pickup, W.referral].filter(Boolean)) { const p = row(sku); if (p) await client.send(laptop, 'product_view', productAttrs(p, { view: 'page' })); }
      const own = heldSignals((await client.meters(laptop)).dims);
      const phone = await client.mintVisitor({}, 'P3 phone');
      await client.send(phone, 'page_view', { page: home.page });
      const before = heldSignals((await client.meters(phone)).dims);
      const L = await p3SignIn(laptop, { account }), P = await p3SignIn(phone, { account });
      if (L.body && L.body.session) laptop.session = L.body.session;
      if (P.body && P.body.session) phone.session = P.body.session;
      if (P.status === 200 && phone.session && phone.session.subject) P3STATE.person = phone.session.subject;   // S2: the walk's person, for the check after the final reset
      const after = heldSignals((await client.meters(phone)).dims);
      ok('every device that signs in as the account is one person: the probe’s, the laptop’s and the phone’s sessions name one recognised shopper',
        L.status === 200 && P.status === 200 && laptop.session.subject === phone.session.subject && ((r.body && r.body.session) || {}).subject === phone.session.subject && /^sh_/.test(phone.session.subject),
        `${L.status} · ${P.status}`);
      ok('and the phone carries what the laptop learned: every signal of the laptop’s, across every dimension, is in the phone’s profile now, none was before',
        own.length > 0 && own.every((k) => after.includes(k)) && own.every((k) => !before.includes(k)), `${own.length} signal(s) · before ${before.length} · after ${after.length}`);
    }
  },
  async 'best-buy-counts'(b) {
    // P3's own beat-16 products: the last `const WALK` in oh.js, in P3's section.
    const P3W = (() => { const all = [...String(shells.js || '').matchAll(/\bconst WALK = \{([^}]*)\}/g)]; const m = all[all.length - 1]; const out = {};
      for (const [, k, v] of String(m ? m[1] : '').matchAll(/([\w$]+):\s*('[^']*'|"[^"]*"|[\d.]+)/g)) out[k] = /^['"]/.test(v) ? v.slice(1, -1) : Number(v); return out; })();
    const date = new Date().toISOString().slice(0, 10);
    const report = async () => (await demoRoute(`${API}/report`, { date, slot: 'pdp-modules', build: true })).report;
    const count = (rep, e) => Number(((((rep || {}).namedOutcomes || {}).events || {})[e] || {}).outcomes) || 0;
    const purchases = (rep) => (((rep || {}).visitorOutcomes || {}).arms || []).reduce((n, a) => n + (Number((a.byType || {}).purchase) || 0), 0);
    const base = await report().catch((error) => { ok('the day report builds', false, error.message); return null; });
    const outcomes = [];
    for (const [event, sku, cid, extra] of [['partner_pickup', P3W.pickup, 'mod-where-to-buy-pickup', { retailer: 'best-buy-pickup' }], ['retailer_referral', P3W.referral, 'mod-where-to-buy-retailer', { retailer: 'find-a-retailer', partner: P3W.retailer }]]) {
      const p = row(sku);
      if (!p) { ok(`${event}: the product ${sku} is in the feed`, false); continue; }
      const s = await openProductAs(p);
      const d = s.slot('pdp-modules').find((x) => x.customerContentId === cid);
      ok(`${p.sku}’s page decides the ${cid === 'mod-where-to-buy-pickup' ? 'Best Buy pickup' : 'Find a Retailer'} module`, Boolean(d), ids(s.slot('pdp-modules')).join(', '));
      if (event === 'retailer_referral') await client.sendCustom(her, 'find_a_retailer', productAttrs(p, { retailer: 'find-a-retailer', control: 'where-to-buy' }));
      const r = await client.send(her, 'custom', { event, ...(d ? { decisionId: d.decisionId, contentId: d.contentId, slot: d.slot, customerContentId: d.customerContentId } : {}), productId: p.sku, ...extra });
      ok(`${event} goes on the wire as type custom with data.event, carrying the decision that earned it, and is accepted (${r.status})`, r.ok && Boolean(d), d ? d.customerContentId : 'no decision');
      outcomes.push(event);
    }
    if (base) {
      let rep = null;
      for (let i = 0; i < 6; i += 1) { await sleep(2500); rep = await report().catch(() => null); if (rep && ['partner_pickup', 'retailer_referral'].every((e) => count(rep, e) > count(base, e))) break; }
      if (rep && rep.hours && rep.hours.source === 'aggregates') {
        info(`the report sums the folded hours: an outcome appears once its hour has closed and the next five-minute fold has run, never in the same second (${(rep.hours.built || []).length} built): partner_pickup ${count(rep, 'partner_pickup')} · retailer_referral ${count(rep, 'retailer_referral')} so far`);
        ok('the day report names both outcomes in its own contract, even before this hour is folded', Boolean(rep.namedOutcomes) && rep.namedOutcomes.basis === 'learning_policy', JSON.stringify(rep.namedOutcomes || null).slice(0, 120));
      } else ok('the day report counts both as named outcomes', Boolean(rep) && ['partner_pickup', 'retailer_referral'].every((e) => count(rep, e) > count(base, e)),
        rep ? `partner_pickup ${count(base, 'partner_pickup')} → ${count(rep, 'partner_pickup')} · retailer_referral ${count(base, 'retailer_referral')} → ${count(rep, 'retailer_referral')}` : 'no report');
      ok('and never as a purchase: the day’s purchases did not move', Boolean(rep) && purchases(rep) === purchases(base), rep ? `${purchases(base)} → ${purchases(rep)}` : '');
      ok('labelled attribution, not incrementality', Boolean(rep && rep.measurement && rep.measurement.kind === 'attribution_diagnostic'), rep && rep.measurement ? rep.measurement.kind : 'no measurement block');
    }
    {
      // Lane P3's checks for this beat (P3 wrote them; S1 runs them after its own, in the beat's order).
      const v = await client.mintVisitor({}, 'P3 outcomes').catch(async (error) => {
        if (!/\(503\b/.test(error.message)) throw error;
        info(`the identity route answered 503 right after the day report built (the engine on wrangler dev); asked again after 3 s`);
        await sleep(3000);
        return client.mintVisitor({}, 'P3 outcomes');
      });
      const base0 = await p3Report().catch((error) => { ok('the day report builds', false, error.message); return null; });
      const sent = [];
      for (const [event, sku, cid, extra] of [['partner_pickup', W.pickup, 'mod-where-to-buy-pickup', { retailer: 'best-buy-pickup' }],
        ['retailer_referral', W.referral, 'mod-where-to-buy-retailer', { retailer: 'find-a-retailer', partner: W.retailer }]]) {
        const p = row(sku);
        if (!p) { ok(`${event}: ${sku} is in the feed`, false); continue; }
        await client.send(v, 'product_view', productAttrs(p, { view: 'page' }));
        const s = await client.snapshot(v, 'product', { anchor: sku, family: p.family });
        const d = s.slot('pdp-modules').find((x) => x.customerContentId === cid);
        ok(`the ${sku} page decides ${cid} for a stranger too (${s.slot('pdp-modules').length} modules)`, Boolean(d), ids(s.slot('pdp-modules')).join(', '));
        if (!d) continue;
        await client.credit(v, d);                                              // the module's own click, as creditDecided sends it
        if (event === 'retailer_referral') await client.sendCustom(v, 'find_a_retailer', productAttrs(p, { retailer: 'find-a-retailer', control: 'where-to-buy' }));
        const r = await client.send(v, 'custom', { event, decisionId: d.decisionId, contentId: d.contentId, slot: d.slot, customerContentId: d.customerContentId, productId: sku, ...extra });
        ok(`${event} is accepted on the wire as type custom with data.event (${r.status})`, r.ok && r.body && r.body.success !== false);
        sent.push({ event, item: d.contentId, cid });
      }
      if (!base0 || !sent.length) return;
      let rep = null;
      for (let i = 0; i < 6; i += 1) { await sleep(2500); rep = await p3Report().catch(() => null); if (rep && sent.every((x) => creditsOn(rep, x.event, x.item) > creditsOn(base0, x.event, x.item))) break; }
      if (rep && rep.hours && rep.hours.source === 'aggregates') info(`P3’s credit counts: the report sums the folded hours: an outcome appears once its hour has closed and the next five-minute fold has run, never in the same second`);
      else for (const x of sent) {
        ok(`${x.event} is credited to the decision that earned it: one more credit on ${x.cid}’s decision in pdp-modules, and one more credited outcome for the day`,
          Boolean(rep) && creditsOn(rep, x.event, x.item) === creditsOn(base0, x.event, x.item) + 1 && named(rep, x.event).credited === named(base0, x.event).credited + 1,
          rep ? `${x.item}: ${creditsOn(base0, x.event, x.item)} → ${creditsOn(rep, x.event, x.item)} · credited ${named(base0, x.event).credited} → ${named(rep, x.event).credited}` : 'no report');
      }
      // The page itself sends exactly this wire form (its where-to-buy code, P3's section of oh.js, comments stripped).
      const code = codeOnly(shells.js || '', 'js');
      const storeCode = codeOnly(([...pageModules].find(([p]) => /\/oh\/oh-store\.js$/.test(p)) || [null, ''])[1], 'js');
      // Since M3 landed, the outcomes are the store's: oh-store.js outcome() sends { sku, ...decisionData(at), store } through send(), which
      // posts any name off the engine's closed type list through the kit's sendCustom; P3's module delegates to it (S2, read where it now lives).
      ok('the page’s own where-to-buy code posts type custom with data.event and the decision’s ids, through the kit’s send',
        /async function outcome\(event, t\)[\s\S]{0,1600}?send\(event, \{ sku: [^\n]*\.\.\.decisionData\(at\)/.test(storeCode) && /r = await (?:t|kit)\.sendCustom\(name, data, v\)/.test(storeCode)
          && /const decisionData = \(d\) => \(d && d\.decisionId \? \{ decisionId: d\.decisionId/.test(storeCode) && /store\.retailers\.pickup\(/.test(code) && /store\.retailers\.open\(/.test(code),
        'oh-store.js outcome() · send() · decisionData; oh.js delegates to store.retailers');
      ok('and its sign-in leaves through the kit’s api door with { account } alone', /transport\.api\(SIGN_IN, \{ account: name \}, \{ visitor: v \}\)/.test(code));
    }
  },

  async 'window-closes'(b) {
    // The pieces the beat closes: open in the opening catalog, their window ended in the beat's own document.
    const name = SITE_BEAT(b, 'windowCloses') || '11-window-closes';
    const doc = (await assetJson(`beats/${name}.json`)).publish.document;
    const now = Date.now();
    const endOf = (p) => (p && p.window && p.window.to ? Date.parse(p.window.to) : Infinity);
    const before = new Map((openCatalog.pieces || []).map((p) => [p.customerContentId, p]));
    const closing = (doc.pieces || []).filter((p) => endOf(p) <= now && endOf(before.get(p.customerContentId)) > now).map((p) => p.customerContentId);
    ok(`beat 11’s document closes offers whose windows were open: ${closing.join(', ')}`, closing.length > 0 && closing.includes(anchor.ids.closesAtBeat11), `the named offer ${anchor.ids.closesAtBeat11}`);
    // Every surface, before and after: her homepage as the page asks it, the TV grid, and a product page of each room.
    const surfaces = async () => {
      const out = [['the homepage', await ask(her, home.page)], ['the TV grid', await ask(her, 'tvs')]];
      for (const [k, p] of Object.entries(PDP)) if (p) out.push([`the ${k} page`, await ask(her, 'product', { anchor: p[SKU], family: p.family })]);
      return out;
    };
    const was = await surfaces();
    const shown = (list) => list.flatMap(([where, s]) => s.all.filter((d) => closing.includes(d.customerContentId)).map((d) => `${d.customerContentId} on ${where}`));
    const seen = shown(was);
    const pub = await demoRoute(`${API}/beat`, { kind: 'catalog', name, note: 'page rehearsal: an offer’s window closes' });
    ok('the catalog beat publishes by name', pub.ok === true && pub.kind === 'catalog', `revision ${pub.revision}`);
    const now2 = await surfaces();
    const still = shown(now2);
    closedAt11 = [...new Set(was[0][1].all.filter((d) => closing.includes(d.customerContentId)).map((d) => d.customerContentId))];
    info(`on a surface she can see before the press: ${seen.join(' · ') || `none of ${closing.join(', ')}`}`);
    ok('and none of them is on any surface on the next decision: the homepage, the grid and each room’s product page', still.length === 0, still.join(' · ') || `${now2.length} surfaces asked`);
    const four = now2[0][1].slot('deals');
    ok(`the deals still answer ${DEALS_N}, the next offers taking the places`, four.length === DEALS_N, ids(four).join(', '));
    last = now2[0][1];
    {
      // Lane P1's checks for this beat (P1 wrote them; S1 runs them after its own, in the beat's order).
      {
        // Her TV page, where beat 11 starts: the opening catalog shows the closing offers there, and beat 11's document takes them off it.
        const twins = ['offer-tv-gift-card', 'offer-tv-matching-soundbar', 'offer-tv-sound-suite', 'offer-tv-free-mounting'];
        const shut = (cid) => { const x = (doc.pieces || []).find((y) => y.customerContentId === cid); return Boolean(x && x.window && x.window.to && Date.parse(x.window.to) <= Date.now()); };
        ok(`beat 11’s document closes the product-page offers with their homepage twins: ${twins.join(', ')}`, twins.every(shut), twins.filter((c) => !shut(c)).join(', ') || 'all four closed');
        const tv = row([...opened].reverse().find((id) => ((row(id) || {}).attributes || {}).category === 'tvs') || WALK.tv);
        await demoRoute(`${API}/beat`, { kind: 'catalog', name: 'open-catalog', note: 'page rehearsal: the opening catalog, for the TV page control' });
        const before = await ask(her, 'product', { anchor: tv[SKU], family: tv.family });
        await demoRoute(`${API}/beat`, { kind: 'catalog', name, note: 'page rehearsal: an offer’s window closes, on her TV page' });
        const after = await ask(her, 'product', { anchor: tv[SKU], family: tv.family });
        const on = (x) => ids(x.slot('pdp-offers')).filter((c) => twins.includes(c));
        ok(`on her TV page (${tv[SKU]}, the last TV she opened) the opening catalog answers the closing offers: ${on(before).join(', ') || 'none'}`, on(before).length > 0, ids(before.slot('pdp-offers')).join(', '));
        ok('and on the next decision after beat 11’s publish none of them is answered there: the room sees the gift card leave', on(after).length === 0 && !ids(after.all).some((c) => twins.includes(c)),
          ids(after.slot('pdp-offers')).join(', ') || 'no offer');
      }
      // The package half: a package the catalog holds out of stock is never decided as complete, on a page that would show it.
      const held = (openCatalog.pieces || []).filter((x) => x.type === 'package' && x.inStock === false);
      ok(`the catalog holds ${held.length} package(s) out of stock, each for a member the feed lists out of stock`, held.length > 0
        && held.every((x) => (x.featuredProductIds || []).some((sku) => row(sku) && row(sku).inStock === false)),
        held.map((x) => `${x.customerContentId}: ${(x.featuredProductIds || []).filter((sku) => row(sku) && row(sku).inStock === false).join(', ')}`).join(' · '));
      for (const pkg of held) {
        // A member's own product page, as the page asks it (ctx.anchor, ctx.family): the gate admits the package, the stock gate holds it back.
        const fams = ((pkg.eligibleWhen || {}).context || {}).family || [];
        const member = (pkg.featuredProductIds || []).map(row).find((p) => p && fams.includes(p.family) && !['kitchen-package', 'laundry-set'].includes(p.family));
        if (!member) { info(`${pkg.customerContentId}: no member page inside its gate to ask`); continue; }
        const s = await ask(her, 'product', { anchor: member[SKU], family: member.family });
        const recs = await receiptsFor(her, s.slot('pdp-modules'), s);
        const cands = [...recs.values()].flatMap((r) => (r.candidates || []).map((c) => cidOf.get(c.contentId) || c.contentId));
        ok(`${pkg.customerContentId} is never shown as complete: on ${member[SKU]}’s page it is neither decided nor a recorded candidate`,
          recs.size > 0 && !ids(s.all).includes(pkg.customerContentId) && !cands.includes(pkg.customerContentId), `${ids(s.slot('pdp-modules')).join(', ')} · ${cands.length} candidates read`);
      }
    }
  },

  async 'pin-launch'(b) {
    const name = SITE_BEAT(b, 'pinLaunch') || '12-pin-launch';
    const doc = (await assetJson(`beats/${name}.json`)).publish.document;
    const pinnedIds = Object.values(doc.pages || {}).flat().flatMap((s) => (s.slot === 'deals' ? s.pinnedPieceIds || [] : []));
    const pinned = pinnedIds.map((id) => cidOf.get(id) || id);
    ok(`beat 12’s slots document pins ${pinned.join(', ')} into the deals`, pinned.length > 0 && pinned.includes(anchor.ids.pinned));
    const engineFour = ids((await ask(her, home.page)).slot('deals'));
    await demoRoute(`${API}/beat`, { kind: 'slots', name, note: 'page rehearsal: the merchandiser pins a launch' });
    const s = await ask(her, home.page);
    const four = s.slot('deals');
    info(`the engine’s four before the pin: ${engineFour.join(', ')} | now ${fmt(four)}`);
    ok('the pin leads the deals, pinned: ranking skipped', four[0] && four[0].customerContentId === pinned[0] && four[0].strategy === 'tenant-pinned');
    const recs = await receiptsFor(her, four, s);
    const pinRec = four[0] ? recs.get(four[0].decisionId) : null;
    ok('its receipt says the merchandiser placed it and ranking never ran for it', Boolean(pinRec && pinRec.authority === 'pin' && /ranking never ran/.test(String((pinRec.explain || {}).note))),
      pinRec ? `authority ${pinRec.authority} · “${(pinRec.explain || {}).note}”` : 'no record');
    ok(`and the other ${DEALS_N - 1} are still the engine’s, ranked for her`, four.length === DEALS_N && four.slice(1).every((d) => d.strategy !== 'tenant-pinned' && (recs.get(d.decisionId) || {}).authority === 'engine'),
      four.slice(1).map((d) => `${d.customerContentId} ${(recs.get(d.decisionId) || {}).authority || '?'}`).join(' · '));
    last = s;
    {
      // Lane P1's checks for this beat (P1 wrote them; S1 runs them after its own, in the beat's order).
      // What the engine would have led with: a ranked deal's own receipt names it, and the slots without the pin lead with it.
      const s = await ask(her, home.page);
      const four = s.slot('deals');
      const recs = await receiptsFor(her, four.slice(1), s);
      const rec = four.slice(1).map((d) => recs.get(d.decisionId)).find((r) => r && (r.candidates || []).length);
      const would = rec ? cidOf.get(rec.candidates[0].contentId) || rec.candidates[0].contentId : null;
      ok(`a ranked deal’s receipt names the engine’s own first choice: ${would}, container 2 behind the pin`, Boolean(would) && Boolean(four[1]) && four[1].customerContentId === would, fmt(four));
      await demoRoute(`${API}/beat`, { kind: 'slots', name: 'open-slots', note: 'page rehearsal: the slots without the pin, for the control' });
      const unpinned = (await ask(her, home.page)).slot('deals');
      ok(`control: without the pin the engine leads the four with ${would}, as the receipt said`, Boolean(unpinned[0]) && unpinned[0].customerContentId === would && unpinned.every((d) => d.strategy !== 'tenant-pinned'), fmt(unpinned));
      await demoRoute(`${API}/beat`, { kind: 'slots', name: SITE_BEAT(beatsDoc.beats.find((x) => x.key === 'pin-launch') || {}, 'pinLaunch') || '12-pin-launch', note: 'page rehearsal: the pin back' });
      const back = (await ask(her, home.page)).slot('deals');
      ok('and the pin is back in force for the walk', Boolean(back[0]) && back[0].strategy === 'tenant-pinned', fmt(back));
    }
  },
};

/** A beat's publish name, as beats.json templates it ({{beatNames.x}}), resolved through the page's own SITE.beatNames. */

// ── Lane S2: the boot page and the working store, at request level (design §9.2, §9.3) ──
// The boot page is served as the published template: lg.com's anatomy in the shell, and the slots' template order from the
// opening catalog in force (the store's own rule, oh.js M1.template), each piece real copy. Then a visitor works the store
// by hand, replayed here exactly as oh-store.js and the page's sections send it (its contract): the first click mints her;
// the grid's page view; a filter (M1's filterAttrs); two TVs; a search with POST /sort over the store's matches; a washer;
// a colour (M2's select with the variant's attributes); Add to Cart, the order-start action, with the decisions on the page;
// Find a Retailer; a referral. Each event's shape is the beat verbs' (productAttrs; custom with its event named), and each
// is measured at the engine: her profile holds every lasting value it carried, the cart add moves her to the stage a cart
// add starts and the day report counts it as the add_to_bag reward, and the referral is a named outcome.
const normS = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
/** The store's search rule (oh-store.js match): every word in the product's name, SKU, type, category, subcategory, series, panel, finish, fuel or size band; priced. */
const storeMatch = (q) => { const words = normS(q).split(' ').filter(Boolean); return rowsAll.filter((p) => { const a = p.attributes || {};
  const hay = ' ' + normS([p[SKU], p.name, a.type, a.category, a.subcategory, a.series, a.panel, a.finish, a.fuel, a.sizeBand].join(' ')) + ' ';
  return words.every((w) => hay.includes(w) || (w.length > 3 && w.endsWith('s') && hay.includes(w.slice(0, -1)))); }).filter((p) => Number(p.salePrice) > 0); };
const colourSibling = (p) => p && rowsAll.find((x) => x[SKU] !== p[SKU] && x.family === p.family && x.modelFamily && x.modelFamily === p.modelFamily && x.attributes && p.attributes
  && x.attributes.finish && x.attributes.finish !== p.attributes.finish && x.cta === 'cart' && x.inStock !== false && Number(x.salePrice) > 0) || null;
/** The store's template for a slot (oh.js M1.template): the opening catalog's order, the first take in force with no eligibility rule, under the slot's diversity. */
function storeTemplate(slot, take, slotsDoc) {
  const def = Object.values((slotsDoc && slotsDoc.pages) || {}).flat().find((s) => s.slot === slot) || {};
  const div = def.diversity || null, counts = {}, out = [], now = Date.now();
  for (const p of openCatalog.pieces || []) {
    if (out.length >= take) break;
    const w = p.window || {};
    if (!(p.slotTypes || []).includes(slot) || (p.lifecycle && p.lifecycle.status && p.lifecycle.status !== 'live') || p.inStock === false || p.eligibleWhen
      || (w.to && Date.parse(w.to) <= now) || (w.from && Date.parse(w.from) > now)) continue;
    if (div && div.dimension) { const vals = ((p.tags || {})[div.dimension]) || []; if (vals.some((v) => (counts[v] || 0) >= Number(div.max))) continue; for (const v of vals) counts[v] = (counts[v] || 0) + 1; }
    out.push(p);
  }
  return out;
}
const stageOf = (m) => String((m && m.stage && (m.stage.stage || m.stage.name || m.stage.current)) || (m && typeof m.stage === 'string' ? m.stage : '') || '');
async function storeByHand() {
  console.log('\n── The boot page, as served: the published template (S2)');
  const homeShell = shells.home || '';
  const ANATOMY = [['the pencil banner', /id="m1Pencil"/], ['the header’s category nav: TVs, Laundry, Kitchen, Offers, Support', /id="mainnav"[\s\S]*?>TVs<[\s\S]*?>Laundry<[\s\S]*?>Kitchen<[\s\S]*?>Offers<[\s\S]*?>Support</],
    ['the search box', /<form[^>]*data-store-search/], ['Sign in', /id="signIn"/], ['the cart with its count', /data-act="store-cart-open"/], ['the 13-icon category nav', /id="m1Cats"/],
    ['the hero', /id="slot-hero"/], ['the service strip', /class="svc-strip/], ['the room tiles', /id="slot-category-rail"/], ['the deals four', /id="slot-deals"/],
    ['Shop with an expert', /class="m1-expert/], ['Recommended for you', /id="rail-for-you"/], ['the showcase tabs', /id="m1Showcase"/], ['the benefits', /class="m1-benefits/], ['the footer', /<footer[^>]*class="site-footer/]];
  const missing = ANATOMY.filter(([, re]) => !re.test(homeShell));
  ok(`the served homepage carries lg.com’s anatomy, every module of it (${ANATOMY.length})`, missing.length === 0, missing.map(([n]) => n).join(', ') || ANATOMY.map(([n]) => n.split(':')[0]).join(' · ').slice(0, 200));
  const strip = (/class="svc-strip[\s\S]*?<\/div>/.exec(homeShell) || [''])[0].replace(/<[^>]+>/g, ' ');
  const svcMissing = ['deliver', 'return', 'cover', 'haul', 'expert'].filter((w) => !new RegExp(w, 'i').test(strip));
  ok('its service strip is real copy, served: delivery, returns, coverage, haul-away, an expert', svcMissing.length === 0, svcMissing.join(', ') || strip.replace(/\s+/g, ' ').trim().slice(0, 140));
  const slotsDoc = (await assetJson('beats/open-slots.json')).publish.document;
  for (const s of homeSlots.filter((x) => !x.gate && !x.gated && x.slot !== 'continue')) {
    const list = storeTemplate(s.slot, s.take, slotsDoc);
    const thin = list.filter((p) => !(String(p.title || '').trim().length >= 2 && String(p.subtitle || '').length > 10));
    ok(`the template’s ${s.slot}: its take of ${s.take} from the opening catalog in force, in the catalog’s order, each piece real copy`, list.length === s.take && thin.length === 0,
      `${list.map((p) => p.customerContentId).join(', ')}${thin.length ? ` · thin: ${thin.map((p) => p.customerContentId).join(', ')}` : ''}`);
  }
  {
    const res = await get(`${base}/${SLUG}/`, { cache: 'no-store', headers: { Accept: 'text/html' } });
    const cookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
    await res.arrayBuffer().catch(() => null);
    ok('loading the boot page sets no cookie: nothing is minted by the page’s own request', res.ok && cookies.length === 0, `${res.status} · ${cookies.length} Set-Cookie`);
  }

  console.log('\n── The working store, by hand: each manual event as the store sends it, measured at the engine (S2)');
  const hand = await client.mintVisitor({}, 'by hand');      // the first click: store.visitor.ensure → the kit's mint, with her consent
  const sent = [];
  const send = async (type, data, what) => { const r = await client.send(hand, type, data); sent.push({ type, data, what, status: r.status }); return r; };
  const custom = (event, data, what) => send('custom', { event, ...data }, what);
  const read = async () => (await client.meters(hand)).dims;
  const a = (dims, dim, v) => Number(((dims[dim] || {})[v]) || 0);
  await send('page_view', { page: 'tvs' }, 'the TVs grid');
  await custom('filter', { control: 'type', page: 'tvs', category: 'tvs', type: 'oled' }, 'a filter: OLED');
  const d1 = await read();
  ok('her filter reaches the engine with what it carries: type oled rises on her own profile, before she opens anything', a(d1, 'type', 'oled') > 0, `type oled ${a(d1, 'type', 'oled').toFixed(3)}`);
  const oled = gridPool().filter((p) => p.attributes.type === 'oled');
  const g = await sortRail('tv-grid', oled, hand);
  ok(`and the filtered grid is POST /sort over the ${oled.length} OLEDs alone`, g.ids.length > 1 && g.ids.every((id) => (row(id) || { attributes: {} }).attributes.type === 'oled'), g.ids.slice(0, 3).join(', '));
  const tvs = g.ids.slice(0, 2).map(row).filter(Boolean);
  for (const p of tvs) await send('product_view', productAttrs(p, { view: 'page' }), `the TV ${p[SKU]}`);
  // As the DOM session types it (“washer” alone also matches the dishwashers, since the store's index matches inside words: M3).
  const Q = 'front load washer', matches = storeMatch(Q), cats = [...new Set(matches.map((p) => p.attributes && p.attributes.category))];
  const beforeSearch = await read();
  await custom('search', { control: 'search', query: Q, results: matches.length, ...(cats.length === 1 ? { category: cats[0] } : {}) }, `a search: “${Q}”`);
  {
    // By design (coordinator): a search whose results span several categories carries no category, and moves nothing on her profile.
    const afterSearch = await read();
    const rose = Object.entries(afterSearch).flatMap(([d, vals]) => Object.entries(vals || {}).filter(([v, x]) => Number(x) > Number(((beforeSearch[d] || {})[v]) || 0) + 0.004).map(([v]) => `${d} ${v}`));
    ok(`a search whose results span several categories (${cats.length}) carries no category and moves nothing on her profile`, cats.length > 1 && rose.length === 0, rose.join(', ') || 'nothing rose');
  }
  {
    // By design: notify_me has no published weight, so asking to be told of an out-of-stock product moves nothing.
    const out = rowsAll.find((p) => p.cta === 'cart' && p.inStock === false && p.attributes && p.attributes.category === 'washers') || rowsAll.find((p) => p.inStock === false && p.attributes);
    const w = ((anchor.registry || {}).weights || {}).notify_me;
    const n0 = await read();
    const nr = out ? await custom('notify_me', productAttrs(out, { control: 'buy-box' }), `Notify Me for ${out[SKU]}`) : null;
    const n1 = await read();
    const roseN = Object.entries(n1).flatMap(([d, vals]) => Object.entries(vals || {}).filter(([v, x]) => Number(x) > Number(((n0[d] || {})[v]) || 0) + 0.004).map(([v]) => `${d} ${v}`));
    ok(`notify_me has no published weight and moves nothing: Notify Me for ${out ? out[SKU] : 'no out-of-stock product'} is accepted and raises no dimension of hers`, Boolean(out && nr && nr.ok) && !(Number(w) > 0) && roseN.length === 0,
      `weight ${w === undefined ? 'none' : w} · rose: ${roseN.join(', ') || 'nothing'}`);
  }
  const sr = await call('/sort', { visitor: hand, body: { userId: hand.session.subject, sessionId: hand.session.sessionId, weights: { affinity: 1 },
    candidates: matches.slice(0, 500).map((p) => { const { productId, ...x } = productAttrs(p); return { id: productId, ...x }; }) } });
  const order = sr.ok && Array.isArray(sr.body.order) ? sr.body.order.map(String) : [];
  ok(`the search goes out as custom search { query, results: ${matches.length} } and its results are POST /sort’s order over every match, leaning with her region, labelled`,
    order.length === Math.min(500, matches.length) && Boolean(sr.body.regional && sr.body.regional.region === ((((await client.coldstart(null)) || {}).region) || {}).key),`${order.length} ordered · regional ${JSON.stringify(sr.body.regional || null).slice(0, 80)}`);
  const washer = order.map(row).find((p) => p && p.family === 'front-load-washer' && p.cta === 'cart' && p.inStock !== false && colourSibling(p)) || null;
  const sibling = colourSibling(washer);
  if (!washer || !sibling) { ok('the search offers a front-load washer sold here whose model comes in another colour', false, `${order.length} results`); return; }
  await send('product_view', productAttrs(washer, { view: 'page' }), `the washer ${washer[SKU]}`);
  const d2 = await read();
  const views = [...tvs, washer];
  const lastingOf = (p) => ['room', 'category', 'type'].map((dim) => [dim, p.attributes[dim]]).filter(([, v]) => typeof v === 'string');
  const lost = views.flatMap((p) => lastingOf(p).filter(([dim, v]) => !(a(d2, dim, v) > 0)).map(([dim, v]) => `${p[SKU]} ${dim} ${v}`));
  ok(`her product views reach the engine with their attributes: every room, category and type they carried is on her profile (${views.map((p) => p[SKU]).join(', ')})`, lost.length === 0,
    lost.join(', ') || `room living-room ${a(d2, 'room', 'living-room').toFixed(2)} · laundry-room ${a(d2, 'room', 'laundry-room').toFixed(2)} · front-load ${a(d2, 'type', 'front-load').toFixed(2)}`);
  const before = a(d2, 'finish', sibling.attributes.finish);
  await custom('select', productAttrs(sibling, { control: 'colour', colour: sibling.attributes.finish, from: washer[SKU] }), `a colour: ${sibling[SKU]}`);
  const d3 = await read();
  ok(`her colour reaches the engine as a select with the variant’s attributes: finish ${sibling.attributes.finish} rises (${before.toFixed(2)} → ${a(d3, 'finish', sibling.attributes.finish).toFixed(2)})`,
    a(d3, 'finish', sibling.attributes.finish) > before);
  {
    console.log('\n── Her visitor, kept in this browser: a second load reuses the stored capability (S2)');
    // Read where it is built: the boot calls store.visitor.resume() before anything mints, and resume() continues her from
    // the capability kept under the SDK's own key, confirmed by her own profile read (/realtime/reflex), never an identity call.
    const sj = [...pageModules].find(([p]) => /\/oh\/oh-store\.js$/.test(p));
    const sc = codeOnly(sj ? sj[1] : '', 'js'), pc = codeOnly(shells.js || '', 'js');
    const body = (code, head) => { const i = code.indexOf(head); if (i < 0) return ''; const end = /\r?\n\}\r?\n/g; end.lastIndex = i; const m = end.exec(code); return code.slice(i, m ? m.index : undefined); };
    const res = body(sc, 'async function resume()'), keptFn = body(sc, 'function kept()'), persistFn = body(sc, 'function persist(');
    const keys = /opt_shopper_session:/.test(sc) && /opt_shopper_visitor:/.test(sc) && /'localStorage'/.test(sc);
    const resumes = /kept\(\)/.test(res) && /'\/realtime\/reflex'/.test(res) && !/identity\/session|\.ensure\(|mintVisitor\(|\bmint\(/.test(res);
    const stores = /setItem\(capKey\(\), s\.capability\)/.test(persistFn) && /getItem\(capKey\(\)\)/.test(keptFn);
    const bootAt = pc.indexOf('store.visitor.resume()'), productAt = pc.indexOf('await openProduct(id)', bootAt);
    const why = [!keys && 'not kept under the SDK’s keys in localStorage', !resumes && 'resume() does not continue from the kept capability without an identity call',
      !stores && 'persist()/kept() do not store and read the capability', !(bootAt > 0 && productAt > bootAt) && 'the boot does not resume before the direct product load'].filter(Boolean);
    ok('a full load continues her from this browser, in the code: the boot calls store.visitor.resume() before the direct product load, and resume() reads the capability kept under the SDK’s key (localStorage) and confirms it with her own profile read, never an identity call',
      why.length === 0, why.join(' ~ ') || (sj ? sj[0] : 'oh-store.js not loaded'));
    // The second load, at the engine: a visitor rebuilt from what persist() keeps (the capability and her record), no mint.
    const k = hand.session;
    const second = { label: 'her second load', session: { capability: k.capability, tenant: TENANT, subject: k.subject, sessionId: k.sessionId, kind: k.kind, iat: k.iat, exp: k.exp }, entry: {} };
    const r0 = await client.call('/realtime/reflex', { visitor: second });
    const dims0 = (r0.body.affinity && r0.body.affinity.dims) || {};
    const same = Object.entries(d3).every(([d, vals]) => Object.entries(vals || {}).every(([v, x]) => Math.abs(Number(x) - Number(((dims0[d] || {})[v]) || 0)) <= 0.02));
    ok(`the stored capability is good for the next load: her own profile read answers ${r0.status} with the readings she left (${Object.keys(d3).length} dimensions), and it has more than a minute left`,
      r0.ok && same && Number(k.exp) * 1000 > Date.now() + 60000, `${r0.status} · ${same ? 'the same readings' : 'other readings'} · exp in ${Math.round((Number(k.exp) * 1000 - Date.now()) / 60000)} min`);
    const w0 = a(dims0, 'category', washer.attributes.category);
    const pv = await client.send(second, 'product_view', productAttrs(washer, { view: 'page' }));
    const dims1 = (await client.meters(hand)).dims;
    const w1 = a(dims1, 'category', washer.attributes.category);
    ok(`and an event on that load is hers: product_view of ${washer[SKU]} is accepted under the same visitor and her readings accumulate (category ${washer.attributes.category} ${w0.toFixed(2)} → ${w1.toFixed(2)}, read through her first load’s session)`,
      pv.ok && w1 > w0 + 0.01, `${pv.status}`);
  }
  const s = await client.snapshot(hand, 'product', { anchor: sibling[SKU], family: sibling.family });
  const onPage = [...s.slot('pdp-offers'), ...s.slot('pdp-modules')];
  const lead = onPage[0] || null;
  // The cart half runs after beat 16 (S2HAND below), so its two day-report builds stand beside beat 16's and no receipt of the
  // walk waits behind one (on wrangler dev a report build or a publish in flight can throw “Configuration publication authority
  // unavailable”: Vantage RESUME finding 3). It measures exactly what it measured before the walk.
  S2HAND.finish = async () => {
  console.log('\n── The working store, by hand: the cart, Find a Retailer and a referral, after the walk (S2)');
  const stage0 = stageOf(await client.meters(hand));
  const date = new Date().toISOString().slice(0, 10);
  const rep = async () => (await demoRoute(`${API}/report`, { date, slot: 'pdp-modules', build: true })).report;
  const bags = (r) => (((r || {}).visitorOutcomes || {}).arms || []).reduce((n, x) => n + (Number((x.byType || {}).add_to_bag) || 0), 0);
  const buys = (r) => (((r || {}).visitorOutcomes || {}).arms || []).reduce((n, x) => n + (Number((x.byType || {}).purchase) || 0), 0);
  const r0 = await rep().catch((error) => { info(`the day report did not build before the add: ${error.message}`); return null; });
  const add = await send('add_to_cart', productAttrs(sibling, { quantity: 1, lineId: 's2-hand', options: { colour: sibling.attributes.finish },
    ...(lead ? { decisionId: lead.decisionId, contentId: lead.contentId, slot: lead.slot, customerContentId: lead.customerContentId, decisionIds: onPage.map((d) => d.decisionId) } : {}) }), 'Add to Cart');
  ok(`Add to Cart goes out as the order-start action, add_to_cart with the variant’s attributes and the decisions on its page (${onPage.length}), and the engine takes it`, add.ok && Boolean(lead), lead ? `credited to ${lead.customerContentId} (${lead.slot})` : 'no decision on the page');
  const stage1 = stageOf(await client.meters(hand));
  const journey = (((anchor.registry || {}).journey || {}).stages || []).find((x) => x.anyOf && Number(x.anyOf.cart_adds) >= 1);
  ok(`and it is credited like a start: one cart add moves her to the stage a cart add starts, “${journey ? journey.stage : '?'}” (the registry’s journey)`, Boolean(journey) && stage1 === journey.stage, `${stage0 || 'none'} → ${stage1 || 'none'}`);
  let r1 = null;
  for (let i = 0; i < 6; i += 1) { await sleep(2500); r1 = await rep().catch(() => null); if (r1 && bags(r1) > bags(r0)) break; }
  if (r1 && r1.hours && r1.hours.source === 'aggregates') info(`the report sums the folded hours: her add_to_bag appears once its hour has closed (now ${bags(r1)}, before ${bags(r0)})`);
  else ok('and the day report counts it as the add_to_bag reward against her visit, never as a purchase', Boolean(r0 && r1) && bags(r1) >= bags(r0) + 1 && buys(r1) === buys(r0),
    `add_to_bag ${bags(r0)} → ${bags(r1)} · purchase ${buys(r0)} → ${buys(r1)}`);
  await custom('find_a_retailer', productAttrs(sibling, { control: 'buy-box' }), 'Find a Retailer');   // M3: the product's own retailer kept; the channel is data.event
  const wtb = s.slot('pdp-modules').find((d) => d.customerContentId === 'mod-where-to-buy-retailer') || null;
  const lists = displayOf('mod-where-to-buy-retailer').retailers || null;   // the display catalog's piece (the published one carries no display)
  const rooms = [...new Set(productList.filter((p) => (p.cta === 'cart' || p.cta === 'retailer') && p.family).map((p) => p.family))];   // the families with a product page
  const groupOf = (fam) => ((lists && lists.groups) || []).find((g) => (g.families || []).includes(fam)) || (lists && lists[fam]) || null;
  const shortRooms = rooms.filter((f) => { const g = groupOf(f); return !(g && (g.online || []).length && (g.nearby || []).length); });
  checks.known(`the Find a Retailer lists come from the catalog’s where-to-buy piece: online sellers and nearby stores for every product family the store sells (${rooms.length})`, shortRooms.length === 0,
    `mod-where-to-buy-retailer carries no list for ${shortRooms.join(', ')}; the modal falls back to the store’s own list there`, 'D1 (catalog.json: display.retailers per room, design §9.3) and M3 (oh-store.js reads it when present)');
  const storeJs = [...pageModules].find(([p]) => /\/oh\/oh-store\.js$/.test(p));
  {
    // The guard (coordinator, after the live defect): every event about a product goes out with the product's dimension
    // attributes, as product_view does. Read where it is built: the store's send() joins productAttrs in each of its three
    // branches whenever a product is named, and every call that sends an event about a product names it (sku), through the
    // store, or passes productAttrs itself when it goes straight to the kit's transport.
    const sc = codeOnly(storeJs ? storeJs[1] : '', 'js'), pc = codeOnly(shells.js || '', 'js');
    const joins = [/data = p \? h\.productAttrs\(p, \{ view: 'page', \.\.\.rest \}\) : rest/, /data = p \? h\.productAttrs\(p, rest\) : rest/, /data = p \? h\.productAttrs\(p, more\) : more/].every((re) => re.test(sc));
    const PRODUCT = ['add_to_cart', 'wishlist_add', 'purchase', 'select', 'compare', 'find_a_retailer', 'partner_pickup', 'retailer_referral', 'notify_me'];
    const sites = [];
    for (const [where, code] of [['oh-store.js', sc], ['oh.js', pc]]) {
      for (const m of code.matchAll(/((?:store\.events\.|transport\.|\bkit\.|\bt\.)?send(?:Custom)?)\(\s*(?:'([a-z_]+)'|(event))\s*,\s*([^\n]{0,140})/g)) {
        if (m[2] && !PRODUCT.includes(m[2])) continue;
        const direct = /^(transport\.|kit\.|t\.)/.test(m[1]);
        sites.push({ where, name: m[2] || 'an outcome (partner_pickup, retailer_referral)', ok: direct ? /^productAttrs\(/.test(m[4]) : /^\{\s*sku\b/.test(m[4]) });
      }
    }
    const bad = sites.filter((x) => !x.ok);
    ok(`every event about a product is built with the product's dimension attributes: the store's send() joins them in all three branches, and each of the ${sites.length} call sites names the product`,
      joins && sites.length > 0 && bad.length === 0, bad.map((x) => `${x.where} ${x.name}`).join(' ~ ') || [...new Set(sites.map((x) => x.name))].join(', '));
  }
  ok('and the store’s modal reads them from that piece when it carries them (oh-store.js retailerLists: display.retailers, per room)', Boolean(storeJs) && /customerContentId === RETAIL_CID[\s\S]{0,200}display\.retailers/.test(codeOnly(storeJs[1], 'js')), storeJs ? storeJs[0] : 'oh-store.js not loaded');
  const partner = ((groupOf(sibling.family) || {}).online || [])[0];
  // M3's shape: the product's own attributes as the feed has them (its retailer value kept), the store chosen in data.store, where online.
  const slugOf = (x) => String(x || '').toLowerCase().normalize('NFKD').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const storeKey = Array.isArray(partner) ? String(partner[0]) : partner && typeof partner === 'object' ? String(partner.key || partner.id || slugOf(partner.name || partner.label)) : partner ? slugOf(partner) : 'home-depot';
  await custom('retailer_referral', productAttrs(sibling, { store: storeKey, where: 'online',
    ...(wtb ? { decisionId: wtb.decisionId, contentId: wtb.contentId, slot: wtb.slot, customerContentId: wtb.customerContentId } : {}) }), 'a referral');
  ok(`every manual event reached the engine: ${sent.length} sent in the beat verbs’ shapes (${[...new Set(sent.map((x) => (x.type === 'custom' ? x.data.event : x.type)))].join(', ')})`, sent.every((x) => x.status === 200),
    sent.filter((x) => x.status !== 200).map((x) => `${x.what} ${x.status}`).join(' · ') || 'all accepted');
  info(wtb ? `the referral is credited to the where-to-buy decision on ${sibling[SKU]}’s page` : `no where-to-buy module is decided on ${sibling[SKU]}’s page for her, so the referral is credited to no decision (the modal says so)`);
  };
}
/** The store section's cart half, set by storeByHand and run after beat 16 (lane S2). */
const S2HAND = { finish: null };

function SITE_BEAT(b, key) {
  const step = (b.run || []).find((s) => s.publish && s.publish !== 'reset');
  const raw = step && step.name;
  if (raw && !/\{\{/.test(raw)) return raw;
  const m = raw && /^\{\{\s*beatNames\.([\w$]+)\s*\}\}$/.exec(raw);
  return ((PAGE_SITE.beatNames || {})[m ? m[1] : key]) || null;
}

try {
  await storeByHand().catch((error) => checks.fail(`the working store, by hand, threw: ${error.message}`));
  for (const b of beatsDoc.beats) {
    console.log(`\n── ${b.no} · ${b.label}`);
    if (!built(b)) { open.push(`${b.no} (${laneOf(b)})`); info(`not built yet: its presses are ${laneOf(b)}’s to write in public/${SLUG}/beats.json; nothing is claimed for it`); continue; }
    if (!OUTCOMES[b.key]) { open.push(`${b.no} (S1: built, outcomes not yet written)`); info('built, and its outcomes are not yet in this suite: S1’s to write'); continue; }
    await OUTCOMES[b.key](b);
  }
  if (S2HAND.finish) await S2HAND.finish().catch((error) => checks.fail(`the working store’s cart half threw: ${error.message}`));
} catch (error) {
  checks.fail(`the walk threw: ${error.message}`);
} finally {
  console.log('\n── The tenant is left at its opening state');
  try {
    const out = await demoRoute(`${API}/reset`, {});
    ok(`POST ${API}/reset republishes the opening slots, then the opening catalog`, (out.applied || []).map((x) => x.name).join(',') === 'open-slots,open-catalog');
    const check = await client.mintVisitor(anchor.landing.entry, 'after the reset');
    const d = await client.snapshot(check, home.page, { region: page.region });
    ok('a new arrival opens with no pin in the four', d.slot('deals').every((x) => x.strategy !== 'tenant-pinned'), fmt(d.slot('deals')));
    if (P3STATE.person && account) {
      // R4 F3 (S2): after a reset the sign-in links a FRESH identity: the same name is a new person, carrying nothing of the
      // walk's (the account the worker derives changes with the reset), so a showing never inherits a rehearsal.
      const fresh = await client.mintVisitor({}, 'after the reset: a new browser');
      const r = await p3SignIn(fresh, { account });
      const subj = r.body && r.body.session ? r.body.session.subject : null;
      if (subj) fresh.session = r.body.session;
      const tail = (x) => (x ? `…${String(x).slice(-6)}` : 'none');
      ok(`after a reset “${account}” links a fresh identity: a new person, not the walk’s (${tail(P3STATE.person)} → ${tail(subj)})`, r.status === 200 && Boolean(subj) && subj !== P3STATE.person, `${r.status}`);
      const carried = subj ? heldSignals((await client.meters(fresh)).dims) : [];
      ok('and that person carries none of the walk’s taste', Boolean(subj) && carried.length === 0, carried.join(', ') || 'nothing');
    } else if (account) info('the walk signed nobody in on this rig, so the fresh identity after a reset is not asked');
    if (closedAt11.length) {
      const back = closedAt11.filter((x) => d.all.some((y) => y.customerContentId === x));
      ok(`and the offer beat 11 closed is back on the same page: its window is the opening catalog’s again (${closedAt11.join(', ')})`, back.length > 0, back.join(', ') || 'not back');
    }
  } catch (error) { ok(`POST ${API}/reset`, false, error.message); }
}
async function imageSweep() {
  console.log('\n── Every image the data files name');
  // Every image the page can show, as the data files name it: the overlay's image per sku and the index's src, each served.
  const named = new Set();
  const parse = (t) => { try { return JSON.parse(t); } catch { return null; } };
  const ov = parse(laterDocs[overlayPath] || '');
  for (const r of (ov && (ov.specs || ov.products || ov.rows)) || []) if (r && typeof r.image === 'string' && r.image.startsWith(`/${SLUG}/`)) named.add(r.image);
  const ix = parse(laterDocs['img/index.json'] || '');
  for (const r of Object.values((ix && ix.products) || {})) if (r && typeof r.src === 'string' && r.src.startsWith(`/${SLUG}/`)) named.add(r.src);
  if (named.size) {
    const missing = [];
    const list = [...named];
    for (let i = 0; i < list.length; i += 24) {
      await Promise.all(list.slice(i, i + 24).map(async (src) => {
        const res = await get(`${base}${src}`, { method: 'GET', cache: 'no-store' }).catch(() => null);
        const type = res ? res.headers.get('content-type') || '' : '';
        if (res && res.body) await res.arrayBuffer().catch(() => null);
        if (!res || !res.ok || !/^image\//.test(type)) missing.push(`${src} → ${res ? `${res.status} ${type}` : 'no answer'}`);
      }));
    }
    ok(`every image the data files name is served as an image (${named.size} named by ${[ov ? overlayPath : null, ix ? 'img/index.json' : null].filter(Boolean).join(' and ')})`, missing.length === 0,
      `${missing.length} not: ${missing.slice(0, 4).join(' ~ ')}`);
  } else info('no local image named by the data files yet (D2): the DOM suite still checks every image the page shows');
}
await imageSweep().catch((error) => checks.fail(`the image sweep threw: ${error.message}`));
console.log('\n── The regional prior, everywhere this suite read it');
ok(`no regional driver names priceTier anywhere: ${REGIONAL.answers} engine answers read, ${REGIONAL.blocks} regional blocks and leans, ${REGIONAL.items} /sort items with regional drivers`,
  REGIONAL.answers > 0 && REGIONAL.blocks > 0 && REGIONAL.hits.length === 0, REGIONAL.hits.slice(0, 4).join(' ~ '));

if (open.length) info(`beats still open: ${open.join(' · ')}`);
if (client.transient.length) info(`refused once and asked again: ${client.transient.join(' · ')}`);
checks.summary({ failed: 'do not hand this over', passed: `OH's page holds at request level for every built beat${open.length ? ` (${open.length} beat(s) still open)` : ''}` });
process.exit(checks.exitCode());
