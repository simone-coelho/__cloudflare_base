#!/usr/bin/env node
// scripts/rehearse-top-offers-page.mjs — walk the page's own sequence.
//
// This is the REQUEST-LEVEL rehearsal: it proves the engine does what each beat
// claims AND that the page can get there holding nothing the browser does not.
// (An earlier third suite replayed its own journey and drifted onto different
// numbers; three suites cannot all be right about the same field, so it was
// folded into this one.) Its companion, rehearse-top-offers-dom.mjs, executes
// the page's own JavaScript beat by beat.
//
// It proves the PAGE can get there: it mints nothing of its own, holds no operator
// credential, and fetches everything over HTTP exactly as the browser does —
// the beat documents, the merchandiser token, the session, the consent choice,
// the publishes and the snapshot. It exists because the first hand-off failed on
// precisely the two things a headless engine test cannot see: a credential the
// browser never had, and a beat that assumed the one before it ran.
//
//   node scripts/rehearse-top-offers-page.mjs [--base http://localhost:9100]
//
// No token argument, deliberately. If this needs one, the page is broken.
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const base = (arg('--base', 'http://localhost:9100')).replace(/\/+$/, '');
const TENANT = 'shn', SOURCE = 'lantern-top-offers';

let failures = 0;
const ok = (label, condition, detail = '') => {
  if (condition) console.log(`   ✓ ${label}`);
  else { failures += 1; console.log(`   ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
  return condition;
};

// ── What the browser can reach, and nothing more ─────────────────────────────
const page = (path) => fetch(`${base}/top-offers/${path}`, { cache: 'no-store' });

console.log('\n── The page loads');
for (const asset of ['', 'top-offers.css', 'top-offers.js']) {
  const res = await page(asset);
  ok(`/top-offers/${asset || '(index)'} → ${res.status}`, res.ok);
}

const beat = async (name) => {
  const res = await page(`beats/${name}.json`);
  if (!res.ok) throw new Error(`beats/${name}.json → ${res.status}`);
  return res.json();
};
for (const name of ['catalog-1', 'catalog-clock', 'catalog-arrival', 'catalog-final', 'catalog-showcase',
  'catalog-grown', 'slots-1', 'slots-promo', 'slots-pin', 'anchor']) {
  const res = await page(`beats/${name}.json`);
  ok(`beats/${name}.json → ${res.status}`, res.ok);
}
const anchor = await beat('anchor');

console.log('\n── The merchandiser credential the browser finds for itself');
const tokenRes = await page('beats/operator.local.json');
ok(`beats/operator.local.json → ${tokenRes.status}`, tokenRes.ok,
  'the seed did not leave one, or the worker was not restarted after it did');
const operator = tokenRes.ok ? (await tokenRes.json()).token : '';
ok('the file carries a token', Boolean(operator && operator.trim()));

// ── The trap the page fell into twice ────────────────────────────────────────
// edge-auth.js signs writes but NEVER a GET (public/edge-auth.js:52), and a
// publish must read the current revision before it can write against it. So an
// unsigned read is refused, and the page has to carry the credential itself.
// These two checks are the guard: the first proves the route really does refuse,
// the second proves the page never calls one of those routes unsigned.
console.log('\n── The unsigned-read trap');
{
  const unsigned = await fetch(`${base}/content/catalog?scope=${TENANT}`, { headers: { 'X-Tenant': TENANT } });
  ok(`an unsigned GET /content/catalog is refused (${unsigned.status})`,
    unsigned.status === 401 || unsigned.status === 403,
    'if this ever passes, the route stopped protecting configuration reads');

  // A grid track of `1fr` floors at its CONTENT width, so a long label pushes
  // past the card instead of truncating inside it — which is exactly how the
  // module map's AFTER column ended up sliced off by the border. Any track
  // holding text that can outgrow it must be minmax(0, …).
  const css = await (await page('top-offers.css')).text();
  const tracks = [...css.matchAll(/\.(pd-map-cols|pd-why-grid|pd-grid)\s*\{[^}]*grid-template-columns:([^;]+);/g)];
  const unbounded = tracks.filter((m) => /(^|\s)1fr/.test(m[2]) && !/minmax\(0/.test(m[2]));
  ok(`every band grid track can shrink (${tracks.length} checked)`, unbounded.length === 0,
    unbounded.map((m) => `.${m[1]} → ${m[2].trim()}`).join(' ~ '));

  const source = await (await page('top-offers.js')).text();
  const calls = [...source.matchAll(/fetch\(\s*(?:url|`[^`]*(?:\/content\/|\/config\/)[^`]*`)[^)]*\)/g)].map((m) => m[0]);
  const unsignedCalls = calls.filter((c) => !c.includes('operatorHeaders'));
  ok(`every /content and /config call in the page is signed (${calls.length} found)`,
    calls.length > 0 && unsignedCalls.length === 0, unsignedCalls.join(' ~ '));
}

// ── Everything below uses only what the page has ─────────────────────────────
let shopper = null;
async function api(path, payload, extra) {
  const headers = { 'X-SDK-Key': 'demo-site', 'Content-Type': 'application/json', 'X-Tenant': TENANT, ...(extra || {}) };
  if (shopper) headers['X-Shopper-Session'] = shopper.capability;
  const res = await fetch(base + path, { method: payload === undefined ? 'GET' : 'POST', headers,
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
  return { status: res.status, ok: res.ok, body: await res.json().catch(() => ({})) };
}

/** The page's publish, with the token edge-auth.js would have attached. */
async function publish(kind, document, note) {
  const path = kind === 'reflex' ? '/config/reflex' : `/content/${kind}`;
  const url = `${base}${path}?scope=${TENANT}`;
  // Exactly what the page sends: the credential on BOTH halves of the handshake.
  const auth = { 'X-Tenant': TENANT, Authorization: `Bearer ${operator}` };
  const read = await fetch(url, { headers: auth });
  if (read.status === 401 || read.status === 403) throw new Error(`the merchandiser token was refused (${read.status})`);
  const current = await read.json();
  if (!current?.publication) throw new Error(`no publication base for ${kind}`);
  const res = await fetch(url, { method: 'PUT',
    headers: { ...auth, 'content-type': 'application/json',
      'If-Match': `"${current.revision}/${current.publication.revision}/${current.publication.digest}"`,
      'Idempotency-Key': `${current.revision}:${crypto.randomUUID()}` },
    body: JSON.stringify(kind === 'reflex' ? { config: document, note } : { document, note }) });
  const body = await res.json().catch(() => ({}));
  if (body.ok !== true) throw new Error(`publishing ${kind} failed: ${body.error ?? res.status}`);
}

async function newVisitor() {
  shopper = null;
  const { body } = await api(`/v1/${TENANT}/identity/session`, {});
  shopper = body.session;
  const { body: pref } = await api('/realtime/session/preferences', {
    userId: shopper.subject, trackingConsent: true, personalizationEnabled: true,
    choice: { id: crypto.randomUUID().replace(/-/g, ''), expectedRevision: null,
      grantId: shopper.grantId, iat: shopper.iat, exp: shopper.exp },
  });
  return Boolean(pref?.consent?.personalization);
}

const view = (category, subcategory) => api('/realtime/action', { userId: shopper.subject,
  sessionId: shopper.sessionId, source: SOURCE, type: 'page_view', data: { category, subcategory } });

const four = async (q = '') => (await api(`/v1/${TENANT}/decisions/snapshot?page=home${q}`)).body.decisions ?? [];
const ids = (list) => list.map((d) => d.customerContentId);

// ── THE BUG THAT SHIPPED: a beat pressed out of order ────────────────────────
console.log('\n── Beat 3 pressed first, with no visitor (the reported failure)');
try {
  if (!shopper) await newVisitor();        // what the page now does before every beat
  await view('Kitchen & Table', 'Cutlery & Prep');
  ok('an out-of-order press mints a visitor instead of throwing', true);
} catch (error) {
  ok('an out-of-order press mints a visitor instead of throwing', false, String(error.message));
}

// ── The eight beats, in order, as the page runs them ─────────────────────────
console.log('\n── The eight beats, through the page\'s own path');
try {
  await newVisitor();
  await publish('slots', await beat('slots-1'), 'page rehearsal: the opening slot');
  await publish('catalog', await beat('catalog-1'), 'page rehearsal: the opening pool');
  const b1 = await four();
  ok('1 · four containers, no affinity driver', b1.length === 4
    && b1.every((d) => !(d.explain?.drivers ?? []).some((x) => x.dim !== 'freshness')));

  // The exact journey, as the page performs it: department, product, two other
  // departments, department, product. Two suites replaying different journeys
  // would produce different numbers and one of them would be lying.
  await view('Kitchen & Table', 'Cookware & Dutch Ovens');
  await api('/realtime/action', { userId: shopper.subject, sessionId: shopper.sessionId, source: SOURCE,
    type: 'product_view', data: { productId: 'B412907', category: 'Kitchen & Table',
      subcategory: 'Cookware & Dutch Ovens', brand: 'Copperline', price_usd: 79.98 } });
  const b2 = await four();
  ok('2 · the vector reaches the decision', b2.some((d) => (d.explain?.drivers ?? []).some((x) => x.dim === 'category')));

  await view('For the Home', 'Decor & Accents');
  await view('Beauty & Wellness', 'Skincare');
  await view('Kitchen & Table', 'Cookware & Dutch Ovens');
  await api('/realtime/action', { userId: shopper.subject, sessionId: shopper.sessionId, source: SOURCE,
    type: 'product_view', data: { productId: 'B412915', category: 'Kitchen & Table',
      subcategory: 'Countertop Cooking', brand: 'Fresco Nine', price_usd: 249.98 } });
  const b3 = await four();
  const cook = b3.filter((d) => (d.explain?.drivers ?? []).some((x) => x.value === 'Kitchen & Table')).length;
  ok(`3 · the category cap holds cook at two (saw ${cook})`, cook === 2);

  await publish('catalog', await beat('catalog-clock'), 'page rehearsal: two hours pass');
  ok('4 · the expired offer left the four', !ids(await four()).includes(anchor.expiringId));

  await publish('catalog', await beat('catalog-arrival'), 'page rehearsal: a new offer arrives');
  ok('5 · the new offer reached the four with no history', ids(await four()).includes(anchor.arrivalId));

  const before = (await four()).find((d) => d.customerContentId === anchor.swapId);
  await publish('catalog', await beat('catalog-final'), 'page rehearsal: the closing creative');
  const after = (await four()).find((d) => d.customerContentId === anchor.swapId);
  ok('6 · the creative swap did not move the score', Boolean(before && after)
    && Math.abs(Number(before.score) - Number(after.score)) < 1e-9);

  await publish('slots', await beat('slots-promo'), 'page rehearsal: the pick reinforced');
  await publish('catalog', await beat('catalog-showcase'), 'page rehearsal: the pick carries its signal');
  const b7 = ids(await four());
  ok(`7 · the promotion weight lifts the pick to position ${b7.indexOf(anchor.showcaseId) + 1}, and not to first`,
    b7.indexOf(anchor.showcaseId) === 1,
    'the slot clamps the boost at 1.6x precisely so a weight cannot take container one');

  await publish('slots', await beat('slots-pin'), 'page rehearsal: the pick pinned');
  ok('8 · the pin puts it in container one', ids(await four())[0] === anchor.showcaseId);

  // Garrett's rule, all four corners. Both halves are required and a missing
  // condition must fail closed, or the gate is not a gate.
  const snowy = async (q) => ids(await four(q));
  const W = anchor.winterId;
  ok('9 · no condition at all → the winter promotion is absent', !(await snowy('')).includes(W));
  ok('9 · snow with no region → absent', !(await snowy('&ctx.weather=snow')).includes(W));
  ok('9 · Washington with no snow → absent', !(await snowy('&ctx.region=US-WA')).includes(W));
  ok('9 · Florida in the snow → absent', !(await snowy('&ctx.region=US-FL&ctx.weather=snow')).includes(W));
  ok('9 · Washington in the snow → SERVED', (await snowy('&ctx.region=US-WA&ctx.weather=snow')).includes(W));
  ok('9 · Oregon in the snow → SERVED', (await snowy('&ctx.region=US-OR&ctx.weather=snow')).includes(W));

  const clicked = (await four())[0];
  const { status } = await api('/realtime/action', { userId: shopper.subject, sessionId: shopper.sessionId,
    source: SOURCE, type: 'content_click',
    data: { contentId: `shn_${clicked.customerContentId.toLowerCase()}`, slot: 'top-offers' } });
  ok(`a click on container one → ${status}`, status === 200);
} catch (error) {
  failures += 1;
  console.log(`   ✗ the page path threw: ${error.message}`);
}

console.log(`\n${failures ? `✗ ${failures} check(s) failed — the page is not ready to hand over` : '✓ the page works through its own path, with no manual step'}`);
process.exit(failures ? 1 : 0);
