#!/usr/bin/env node
// scripts/seed-coach-content.mjs — the Coach demo's CMS export into the content engine.
//
// public/data/coach-content.json is the demo's content catalog: every hero and story the
// storefront can show, as content pieces tagged on the Coach registry's dimensions, with the
// generated scenes as art. This writes it to a scope as a versioned catalog revision and writes
// the slot document the storefront's home page reads, so the hero and the story the demo paints
// are the engine's decisions (and never page code pretending to be the engine).
//
//   node scripts/seed-coach-content.mjs [--base http://localhost:9100] [--scope coach] [--token <jwt>]
//
// Use --token or OPERATOR_TOKEN. Local minting requires explicit JWT_SECRET,
// JWT_ISSUER and JWT_AUDIENCE; remote targets require an existing operator token.
import { readFileSync } from 'node:fs';
import { isLoopbackTarget, resolveToolToken, tokenFromArgs } from './lib/tool-token.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const base = (arg('--base', 'http://localhost:9100')).replace(/\/+$/, '');
const scope = arg('--scope', 'coach');
const token = await resolveToolToken({ token: tokenFromArgs(process.argv), payload: { sub: 'seed-coach-content', roles: ['operator'] },
  expiresIn: '10m', allowMint: isLoopbackTarget(base) });
const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Tenant': scope };
const catalog = JSON.parse(readFileSync(new URL('../public/data/coach-content.json', import.meta.url), 'utf8'));

const put = async (kind, document, note) => (await fetch(`${base}/content/${kind}?scope=${encodeURIComponent(scope)}`, { method: 'PUT', headers: auth, body: JSON.stringify({ document, note }) })).json();

const cat = await put('catalog', catalog, `Coach content catalog: ${catalog.pieces.length} pieces from public/data/coach-content.json`);
console.log('catalog:', JSON.stringify({ ok: cat.ok, revision: cat.revision, version: cat.version, errors: cat.errors }));
if (!cat.ok) process.exit(1);

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
const sl = await put('slots', slots, 'slots for the Coach content catalog: merch pinned to the arrivals campaign, chero and story weighted on the registry');
console.log('slots:', JSON.stringify({ ok: sl.ok, revision: sl.revision, version: sl.version, errors: sl.errors }));
if (!sl.ok) process.exit(1);

// What each slot learns against. The hero learns clicks; the stories learn purchases weighed by the
// order's value, which is what a story that featured the bag is for. Merged over the learn document in
// force, so dials an operator has set (trust, exploration, the holdout) are kept.
const current = await (await fetch(`${base}/content/learn?scope=${encodeURIComponent(scope)}`, { headers: auth })).json();
const learnDoc = current.document || {};
const learnSlots = { ...(learnDoc.slots || {}) };
for (const [slot, dials] of Object.entries({ chero: { reward: 'click', objective: 'unit' }, story: { reward: 'purchase', objective: 'revenue' }, carousel: { reward: 'click', objective: 'unit' } })) {
  learnSlots[slot] = { ...(learnSlots[slot] || {}), ...dials };
}
const ln = await put('learn', { ...learnDoc, slots: learnSlots }, 'what each slot learns against: the hero clicks, the stories purchases weighed by revenue');
console.log('learn:', JSON.stringify({ ok: ln.ok, revision: ln.revision, version: ln.version, errors: ln.errors }));
process.exit(ln.ok ? 0 : 1);
