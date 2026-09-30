#!/usr/bin/env node
// scripts/seed-coach-content.mjs — the Coach demo's CMS export into the content engine.
//
// public/data/coach-content.json is the demo's content catalog: every hero and story the
// storefront can show, as content pieces tagged on the Coach registry's dimensions, with the
// generated scenes as art. This writes it to the NAMED tenant as a versioned catalog revision and
// writes the slot document the storefront's home page reads, so the hero and the story the demo
// paints are the engine's decisions (and never page code pretending to be the engine).
//
//   node scripts/seed-coach-content.mjs --scope <tenant> [--base http://localhost:9100] [--token <jwt>]
//
// --scope is required: an unscoped seed never picks a default tenant. The target defaults to the
// local worker. Use --token or OPERATOR_TOKEN; local minting requires explicit JWT_SECRET,
// JWT_ISSUER, JWT_AUDIENCE and DEPLOYMENT_PROFILE=demo, and is refused for anything but a loopback
// target. A remote target is reached only with an operator token issued for that tenant (the W03
// scoped tool token), never one minted here.
//
// Every write carries the publication headers (docs/kit/02-api-reference.md §4): If-Match "N/S/H"
// from the draft it read, and an Idempotency-Key "N:UUID" derived from that exact request. A
// document already holding the seeded content is left as it is, so a repeat run publishes nothing;
// a run a failure interrupted is recovered by running the same command again for the same tenant
// (the same request over the same draft is the same operation, which the Worker finishes).
import { readFileSync } from 'node:fs';
import { isLoopbackTarget, resolveToolToken, tokenFromArgs } from './lib/tool-token.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const base = (arg('--base', 'http://localhost:9100')).replace(/\/+$/, '');
const scope = arg('--scope');
if (typeof scope !== 'string' || !scope.trim() || scope.startsWith('--')) {
  console.error('seed-coach-content: name the tenant to seed with --scope <tenant>; an unscoped seed is refused and nothing was sent.');
  process.exit(2);
}
const token = await resolveToolToken({ token: tokenFromArgs(process.argv), payload: { sub: 'seed-coach-content', roles: ['operator'] },
  expiresIn: '10m', allowMint: isLoopbackTarget(base) });
const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Tenant': scope };
const catalog = JSON.parse(readFileSync(new URL('../public/data/coach-content.json', import.meta.url), 'utf8'));

// ── The configuration publication protocol (kit 02 §4) ──────────────────────────────────────────
const fail = (message) => { console.error(`seed-coach-content: ${message}`); process.exit(1); };
const call = async (method, path, body, headers = {}) => {
  const response = await fetch(`${base}${path}?scope=${encodeURIComponent(scope)}`, { method, headers: { ...auth, ...headers }, ...(body === undefined ? {} : { body }) });
  let answer = null;
  try { answer = await response.json(); } catch { answer = null; }
  return { status: response.status, body: answer && typeof answer === 'object' ? answer : {} };
};
/** The draft a write goes over: the document in force, its revision N and the set S/H it was read from. */
const draft = async (kind) => {
  const { status, body } = await call('GET', `/content/${kind}`);
  const set = body.publication;
  if (status >= 400 || !Number.isSafeInteger(body.revision) || body.revision < 1 || !set || !Number.isSafeInteger(set.revision) || set.revision < 1
    || typeof set.digest !== 'string' || !/^[0-9a-f]{64}$/.test(set.digest)) {
    fail(`${kind}: the Worker answered no initialized publication for "${scope}" (HTTP ${status}${body.code ? ` ${body.code}` : ''}); nothing was written. A fresh local worker is initialized first with: node scripts/init-local.mjs --scope ${scope}`);
  }
  return { document: body.document, revision: body.revision, ifMatch: `"${body.revision}/${set.revision}/${set.digest}"` };
};
const utf8 = (text) => {
  const bytes = [];
  for (const character of text) {
    const c = character.codePointAt(0);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return new Uint8Array(bytes);
};
/** Idempotency-Key "N:UUID": the UUID (version 8) is the SHA-256 of the exact request — tenant, route, draft and body. */
const operationKey = async (revision, parts) => {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(parts.join('\n'))));
  hash[6] = (hash[6] & 0x0f) | 0x80; hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = Array.from(hash.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${revision}:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  : JSON.stringify(value);
/** The same document, the revision stamp the platform writes into its version label (`+rN`) aside. */
const unstamped = (document) => document && typeof document === 'object' && typeof document.version === 'string'
  ? { ...document, version: document.version.replace(/\+r\d+$/, '') } : document;
const write = async (method, path, current, body) => {
  const headers = { 'If-Match': current.ifMatch, 'Idempotency-Key': await operationKey(current.revision, [scope, method, path, current.ifMatch, body]) };
  const result = await call(method, path, body, headers);
  if (result.body.ok !== true && result.status === 409) {
    fail(`${path}: another publication for "${scope}" holds the set or the draft moved (409 ${result.body.code ?? ''}); nothing new was written. Inspect GET /content/catalog/publication and finish a pending one with POST /content/catalog/publication/recover (docs/kit/02-api-reference.md §4) before seeding again.`);
  }
  return result.body;
};
/** Publish one document over its draft, unless the draft already holds exactly that content. */
const publish = async (kind, current, document, note) => {
  const checked = await call('POST', `/content/${kind}/validate`, JSON.stringify({ document }));
  if (checked.body.valid !== true) fail(`${kind}: the Worker refused the document: ${JSON.stringify(checked.body.errors ?? checked.body.error ?? checked.status)}`);
  if (canonical(unstamped(checked.body.document)) === canonical(unstamped(current.document))) {
    console.log(`${kind}:`, JSON.stringify({ ok: true, unchanged: true, revision: current.revision }));
    return;
  }
  const result = await write('PUT', `/content/${kind}`, current, JSON.stringify({ document, note }));
  console.log(`${kind}:`, JSON.stringify({ ok: result.ok, revision: result.revision, version: result.version, errors: result.errors ?? result.error }));
  if (result.ok !== true) process.exit(1);
};

await publish('catalog', await draft('catalog'), catalog, `Coach content catalog: ${catalog.pieces.length} pieces from public/data/coach-content.json`);

// The merch slot pins its own campaign, so the season lead is free to be the hero's cold default.
const merch = catalog.pieces.find((p) => p.slotTypes.includes('merch') && p.customerContentId === 'CCH-026');
const slots = { version: `slots-${scope}`, pages: { home: [
  ...(merch ? [{ slot: 'merch', take: 1, weights: {}, pinnedPieceId: merch.id }] : []),
  // The registry's dimensions, weighted for a hero: the line she circles first, then the occasion,
  // then the price band she shops in, the kind of content she engages with, and the category.
  { slot: 'chero', take: 1, weights: { line: 0.35, occasion: 0.25, priceBand: 0.15, contentType: 0.15, category: 0.1 } },
  { slot: 'story', take: 2, weights: { occasion: 0.3, category: 0.25, contentType: 0.25, priceBand: 0.2 } },
  { slot: 'carousel', take: 5, weights: { line: 0.3, occasion: 0.3, category: 0.2, contentType: 0.2 } },
] } };
await publish('slots', await draft('slots'), slots, 'slots for the Coach content catalog: merch pinned to the arrivals campaign, chero and story weighted on the registry');

// What each slot learns against. The hero learns clicks; the stories learn purchases weighed by the
// order's value, which is what a story that featured the bag is for. Merged over the learn document in
// force, so dials an operator has set (trust, exploration, the holdout) are kept.
const learn = await draft('learn');
const learnDoc = learn.document || {};
const learnSlots = { ...(learnDoc.slots || {}) };
for (const [slot, dials] of Object.entries({ chero: { reward: 'click', objective: 'unit' }, story: { reward: 'purchase', objective: 'revenue' }, carousel: { reward: 'click', objective: 'unit' } })) {
  learnSlots[slot] = { ...(learnSlots[slot] || {}), ...dials };
}
await publish('learn', learn, { ...learnDoc, slots: learnSlots }, 'what each slot learns against: the hero clicks, the stories purchases weighed by revenue');
process.exit(0);
