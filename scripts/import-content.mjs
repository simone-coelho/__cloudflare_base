#!/usr/bin/env node
// scripts/import-content.mjs — the manual import adapter for the demo catalog.
//
// Pulls the Meridian content catalog through the worker's own CMS/DAM seam into
// a scope, and writes a slot document whose slot names and weights match what
// that catalog was built for, so GET /v1/:scope/decisions/snapshot returns real
// decisions from real, committed content.
//
//   node scripts/import-content.mjs --base http://localhost:9100 --scope tapestry [--token <jwt>]
//
// Without --token, against a localhost base, a token is minted from the dev
// JWT settings in wrangler.toml. Against anything else, pass a token from
// POST /auth/login.
import { readFileSync } from 'node:fs';
import * as jose from 'jose';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const base = (arg('--base', 'http://localhost:9100')).replace(/\/+$/, '');
const scope = arg('--scope', 'tapestry');
const vertical = arg('--vertical', 'retail');
let token = arg('--token', '');

if (!token) {
  if (!/localhost|127\.0\.0\.1/.test(base)) { console.error('pass --token <jwt> for a non-local base'); process.exit(1); }
  const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  const v = (k) => (toml.match(new RegExp(`^${k} = "([^"]+)"`, 'm')) || [])[1];
  token = await new jose.SignJWT({ sub: 'import-content', roles: ['operator'] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer(v('JWT_ISSUER')).setAudience(v('JWT_AUDIENCE')).setExpirationTime('10m')
    .sign(new TextEncoder().encode(v('JWT_SECRET')));
}
const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

// 1. The catalog, through the seam.
const pull = await (await fetch(`${base}/content/catalog/pull?scope=${scope}`, {
  method: 'POST', headers: auth,
  body: JSON.stringify({ url: `${base}/meridian/api/catalog?vertical=${vertical}`, path: 'content', note: `demo catalog import (${vertical})` }),
})).json();
console.log('catalog:', JSON.stringify(pull));
if (!pull.ok) process.exit(1);

// 2. Slots that match the catalog's slot names and tag vocabulary.
const cat = await (await fetch(`${base}/content/catalog?scope=${scope}`)).json();
const merch = cat.document.pieces.find((p) => p.slotTypes.includes('merch'));
const slots = { version: `slots-${scope}`, pages: { home: [
  ...(merch ? [{ slot: 'merch', take: 1, weights: {}, pinnedPieceId: merch.id }] : []),
  { slot: 'chero', take: 1, weights: { contentType: 0.35, line: 0.25, category: 0.2, styleWorld: 0.2 } },
  { slot: 'story', take: 2, weights: { contentType: 0.3, occasion: 0.25, category: 0.25, styleWorld: 0.2 } },
  { slot: 'carousel', take: 5, weights: { line: 0.3, category: 0.25, occasion: 0.25, contentType: 0.2 } },
] } };
const put = await (await fetch(`${base}/content/slots?scope=${scope}`, {
  method: 'PUT', headers: auth, body: JSON.stringify({ document: slots, note: 'slots for the demo catalog' }),
})).json();
console.log('slots:', JSON.stringify({ ok: put.ok, revision: put.revision, version: put.version, errors: put.errors }));
process.exit(put.ok ? 0 : 1);
