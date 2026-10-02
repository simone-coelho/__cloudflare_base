#!/usr/bin/env node
// scripts/rehearse-oh-page.mjs: OH's page, at request level.
//
// Scaffolded by scripts/demo-kit/new-demo.mjs with the ARRIVAL checks written: the page and its documents are
// served, no credential is served or committed, the page reaches the API only as the demo (X-Tenant: oh, no
// Authorization, no configuration door of its own), the beat route is a closed list, and beat 1's stranger is
// decided on the opening documents with her region from the request, then beat 2's contrast asserted and
// labelled. The vertical's outcomes for the other beats are the suite lane's to add, below the arrival, in the
// order the director runs them. Its companion, rehearse-oh-dom.mjs, runs the page's own JavaScript.
//
//   node scripts/rehearse-oh-page.mjs [--base http://localhost:9120]
//   node scripts/demo-kit/rehearse.mjs --config oh --suite page --base <url>      (the same, through the kit)
//
// It holds no credential and takes no token: if this needs one, the page is broken. It ends with
// POST /oh/api/reset, so the tenant is left at its opening state. Scores move run to run, so the checks are on
// memberships, takes and labels, the claims the presenter makes.
import { readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEXT_FILE as TEXT, tokenFindings as tokenIn, walkFiles as walk } from './demo-kit/lib/credentials.mjs';
import { codeOnly, createChecks, createClient, flagReader, ids } from './demo-kit/lib/rehearse.mjs';

const arg = flagReader();
const base = arg('--base', 'http://localhost:9120').replace(/\/+$/, '');
const SLUG = 'oh', TENANT = 'oh', SOURCE = 'oh-demo', API = `/${SLUG}/api`;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const checks = createChecks({ infoIndent: 6 });
const { ok, info } = checks;
const client = createClient({ base, tenant: TENANT, source: SOURCE, assets: `/${SLUG}/`, api: API });
const { asset, assetJson, navigate, call, demoRoute } = client;

console.log(`\nOH page rehearsal against ${base}`);

// ── The page and its documents ───────────────────────────────────────────────
console.log('\n── The page loads');
const demo = await assetJson('demo.config.json');
const anchor = await assetJson('beats/anchor.json');
const products = await assetJson((demo.products.file || '').replace(`public/${SLUG}/`, '')).catch(() => null);
const productList = (products && products[demo.products.list || 'products']) || [];
const firstProduct = productList[0] ? String(productList[0][demo.products.id]) : 'none';
const shells = {};
for (const [key, path] of [['home', ''], ['product', `product?id=${encodeURIComponent(firstProduct)}`], ['phone', 'm'], ['js', `${SLUG}.js`], ['css', `${SLUG}.css`]]) {
  const isPage = !['js', 'css'].includes(key);
  const res = isPage ? await navigate(path) : await asset(path);
  shells[key] = res.ok ? await res.text() : '';
  ok(`/${SLUG}/${path || '(index)'} → ${res.status}${isPage ? ', as a browser navigates' : ''}`, res.ok && shells[key].length > 0);
}
ok('the home shell is the OH page', /data-entry="home"/.test(shells.home) && shells.home.includes(`/${SLUG}/${SLUG}.js`));
ok('the product shell boots into the product view', /data-entry="product"/.test(shells.product));
ok('the phone shell boots into the homepage at phone width', /data-entry="phone"/.test(shells.phone) && /shell--phone/.test(shells.phone));
{
  const kit = ['/demo-kit/tokens.css', '/demo-kit/kit.css', '/demo-kit/compare.css', `/${SLUG}/${SLUG}.css`];
  const all = ['home', 'product', 'phone'].every((k) => kit.every((href) => shells[k].includes(`href="${href}"`)));
  ok('every shell loads the kit\'s token sheet and chrome, then its own sheet, then Compare', all);
  ok('the page builds on the kit: it imports createDemo from /demo-kit/kit.js', /import \{[^}]*createDemo[^}]*\} from '\/demo-kit\/kit\.js'/.test(shells.js));
}
const beatsDoc = await assetJson('beats.json');
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
for (const path of ['catalog.json', (demo.products.file || '').replace(`public/${SLUG}/`, '')]) {
  const res = await asset(path);
  ok(`/${SLUG}/${path} → ${res.status}`, res.ok);
}
{
  const res = await asset((demo.imagery && demo.imagery.manifest ? demo.imagery.manifest : `public/${SLUG}/img/MANIFEST.json`).replace(`public/${SLUG}/`, ''));
  info(`/${SLUG}/img/MANIFEST.json → ${res.status}${res.ok ? '' : ' (the imagery lane writes it; reported, not asserted at arrival)'}`);
}

// ── No credential is served or committed, and the page holds none ───────────
console.log('\n── No credential is served, embedded or committed');
const pageModules = new Map([[`/${SLUG}/${SLUG}.js`, shells.js]]);
{
  for (const leak of ['beats/operator.local.json', 'operator.local.json', 'beats/token.json']) {
    const res = await asset(leak);
    ok(`/${SLUG}/${leak} → ${res.status} (must not be served)`, res.status !== 200);
  }
  for (const [path, text] of pageModules) {
    for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)['"]([^'"]+\.js)['"]/g)) {
      const next = new URL(m[1], `${base}${path}`).pathname;
      if (!pageModules.has(next)) pageModules.set(next, await (await fetch(`${base}${next}`, { cache: 'no-store' })).text());
    }
  }
  const hits = [];
  const texts = [['home', shells.home], ['product', shells.product], ['phone', shells.phone], [`${SLUG}.css`, shells.css], ...pageModules];
  for (const name of ['demo.config.json', 'beats.json', 'catalog.json', ...docs.map((d) => `beats/${d}.json`)]) texts.push([name, await (await asset(name)).text()]);
  for (const [path, text] of texts) for (const w of tokenIn(text)) hits.push(`${path}: ${w}`);
  ok(`no served page or document carries a token (${texts.length} checked)`, hits.length === 0, hits.join(' ~ '));
  const committed = [
    ...walk(join(ROOT, `public/${SLUG}`)).filter((f) => TEXT.test(f)),
    ...walk(join(ROOT, 'public/demo-kit')).filter((f) => TEXT.test(f)),
    ...[`scripts/rehearse-${SLUG}-page.mjs`, `scripts/rehearse-${SLUG}-dom.mjs`, `scripts/demo-kit/configs/${SLUG}.json`, `wrangler.${SLUG}.toml`,
      `src/demos/${SLUG}.config.ts`, `src/routes/${SLUG}.ts`].map((f) => join(ROOT, f)),
  ].filter((f) => { try { return statSync(f).isFile(); } catch { return false; } });
  const leaks = [];
  for (const f of committed) for (const w of tokenIn(readFileSync(f, 'utf8'))) leaks.push(`${relative(ROOT, f)}: ${w}`);
  ok(`no file this demo ships carries a token (${committed.length} read from the checkout)`, leaks.length === 0, leaks.join(' ~ '));
  const source = [...pageModules.values()].map((t) => codeOnly(t, 'js')).join('\n');
  info(`the page's source: ${[...pageModules.keys()].join(', ')}`);
  ok('the page source makes no /content, /config or /ops call of its own', !/['"`]\/(?:content|config|ops)\//.test(source));
  ok('the page source holds no Authorization header', !/Authorization/i.test(source));
  const fetches = [...source.matchAll(/\bfetch\(/g)].length;
  ok(`every fetch in the page goes through the kit's three doors, api(), demoRoute() and tryJson() (${fetches} call sites)`, fetches === 3, `${fetches} found`);
  const transport = [...pageModules].find(([, t]) => /async function api\(/.test(t) && /async function demoRoute\(/.test(t));
  ok('api() and demoRoute() send X-Tenant on every API call', Boolean(transport) && /async function api\([\s\S]{0,400}?'X-Tenant': TENANT/.test(transport[1])
    && /async function demoRoute\([\s\S]{0,400}?'X-Tenant': TENANT/.test(transport[1]), transport ? transport[0] : 'no module defines both doors');
  ok(`and the tenant the page configures is '${TENANT}'`, new RegExp(`"tenant":\\s*"${TENANT}"`).test(shells.js) && /createDemo\(\{\s*\n?\s*tenant: SITE\.tenant/.test(shells.js));
}

// ── The doors that stay shut ─────────────────────────────────────────────────
console.log('\n── The unsigned-read trap, and the doors that stay shut');
{
  for (const kind of ['catalog', 'slots']) {
    const unsigned = await fetch(`${base}/content/${kind}?scope=${TENANT}`, { headers: { 'X-Tenant': TENANT } });
    ok(`an unsigned GET /content/${kind} is refused (${unsigned.status})`, unsigned.status === 401 || unsigned.status === 403);
  }
  const unknown = await call(`${API}/beat`, { body: { name: 'not-a-beat' } });
  ok(`${API}/beat refuses a name outside its closed list (${unknown.status})`, unknown.status === 400);
  const mismatch = await call(`${API}/beat`, { body: { name: 'open-slots', kind: 'catalog' } });
  ok(`and refuses a kind that is not the beat's own (${mismatch.status})`, mismatch.status === 400);
  const prior = await call(`${API}/coldstart/prior`, { body: {} });
  ok(`the regional-prior seed door refuses a caller with no operator token (${prior.status})`, prior.status === 401 || prior.status === 403);
}

// ── Act 1: the arrival ───────────────────────────────────────────────────────
const home = demo.pages.find((p) => p.entry === 'home');
const homeSlots = home.slots || [];
const opening = new Set(((await assetJson('beats/open-catalog.json')).publish.document.pieces || []).map((p) => p.customerContentId));
let her = null;
try {
  console.log('\n── 1 · A stranger lands from the landing, her region from the request');
  const reset = await demoRoute(`${API}/reset`, {});
  ok(`POST ${API}/reset republishes the opening slots, then the opening catalog`, (reset.applied || []).map((x) => x.name).join(',') === 'open-slots,open-catalog');
  her = await client.mintVisitor(anchor.landing.entry, 'A');
  ok('a shopper session is minted, with her explicit consent', Boolean(her.session && her.session.capability));
  const viewed = await client.send(her, 'page_view', { page: home.page });
  ok(`her page_view is accepted (${viewed.status})`, viewed.ok);
  const s = await client.snapshot(her, home.page, {});
  ok(`the homepage is decided (${s.ms} ms)`, s.all.length > 0);
  for (const slot of homeSlots) {
    const got = s.slot(slot.slot);
    if (slot.gate) ok(`${slot.slot} is gated (${Object.keys(slot.gate).join(', ')}) and fails closed for a stranger`, got.length === 0, ids(got).join(', '));
    else ok(`${slot.slot} answers within its take of ${slot.take}`, got.length > 0 && got.length <= slot.take, ids(got).join(', '));
  }
  ok('every piece decided comes from the opening catalog', s.all.every((d) => opening.has(d.customerContentId)), s.all.filter((d) => !opening.has(d.customerContentId)).map((d) => d.customerContentId).join(', '));
  const cold = await client.coldstart(null);
  ok('the cold-start panel answers for the request\'s own region, nothing asserted', Boolean(cold) && cold.ok !== false && (!cold.region || cold.region.source !== 'asserted'),
    cold ? `${(cold.region || {}).key || 'no region'} · ${(cold.region || {}).source || 'none'}` : 'no answer');
  ok('and it says the sentence, verbatim', Boolean(cold) && cold.sentence === 'aggregate, never the individual; we curate, never price.', cold && cold.sentence);
  ok('and it says the census is never scored', Boolean(cold && cold.scored && cold.scored.sentence), cold && cold.scored && cold.scored.sentence);
  const seeded = (demo.seeds || []).filter((r) => r.signal === 'campaign_term' && r.value === anchor.arrival.utm_term);
  if (seeded.length) {
    const firstSlot = seeded[0].slots[0];
    const recs = await client.receipts(her, s.slot(firstSlot));
    const fired = [...recs.values()].some((r) => ((r.explain && r.explain.contextual && r.explain.contextual.drivers) || []).some((x) => x.signal === 'campaign_term'));
    ok(`the landing's term “${anchor.arrival.utm_term}” fires its seed on ${firstSlot}, recorded on the receipt as context`, fired, `${recs.size} receipt(s) read`);
  }

  console.log('\n── 2 · The same stranger, another region (asserted, labelled)');
  const contrast = (anchor.regions && anchor.regions.contrast || []).find((k) => k !== (cold && cold.region && cold.region.key)) || 'US-TX';
  const t = await client.snapshot(her, home.page, { region: contrast });
  ok(`the homepage is decided with ctx.region = ${contrast} asserted on the request`, t.all.length > 0 && t.asked.region === contrast);
  const cc = await client.coldstart(contrast);
  ok(`the panel reads ${contrast} as asserted, not observed`, Boolean(cc) && cc.region && cc.region.key === contrast && cc.region.source === 'asserted',
    cc ? `${(cc.region || {}).key} · ${(cc.region || {}).source}` : 'no answer');
} catch (error) {
  checks.fail(`the walk threw: ${error.message}`);
} finally {
  console.log('\n── The tenant is left at its opening state');
  try {
    const out = await demoRoute(`${API}/reset`, {});
    ok(`POST ${API}/reset republishes the opening slots, then the opening catalog`, (out.applied || []).map((x) => x.name).join(',') === 'open-slots,open-catalog');
  } catch (error) { ok(`POST ${API}/reset`, false, error.message); }
}
if (client.transient.length) info(`refused once and asked again: ${client.transient.join(' · ')}`);
checks.summary({ failed: 'do not hand this over', passed: `OH's arrival holds at request level` });
process.exit(checks.exitCode());
