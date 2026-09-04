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
// Without --token, against a localhost base, a token is minted from the dev JWT settings in
// wrangler.toml. Against anything else, pass a token from POST /auth/login.
import { readFileSync } from 'node:fs';
import * as jose from 'jose';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const base = (arg('--base', 'http://localhost:9100')).replace(/\/+$/, '');
const scope = arg('--scope', 'coach');
let token = arg('--token', '');
if (!token) {
  if (!/localhost|127\.0\.0\.1/.test(base)) { console.error('pass --token <jwt> for a non-local base'); process.exit(1); }
  const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  const v = (k) => (toml.match(new RegExp(`^${k} = "([^"]+)"`, 'm')) || [])[1];
  token = await new jose.SignJWT({ sub: 'seed-coach-content', roles: ['operator'] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer(v('JWT_ISSUER')).setAudience(v('JWT_AUDIENCE')).setExpirationTime('10m')
    .sign(new TextEncoder().encode(v('JWT_SECRET')));
}
const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
const catalog = JSON.parse(readFileSync(new URL('../public/data/coach-content.json', import.meta.url), 'utf8'));

const put = async (kind, document, note) => (await fetch(`${base}/content/${kind}?scope=${scope}`, { method: 'PUT', headers: auth, body: JSON.stringify({ document, note }) })).json();

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
process.exit(sl.ok ? 0 : 1);
