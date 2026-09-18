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
// Use --token or OPERATOR_TOKEN. Local minting requires explicit JWT_SECRET,
// JWT_ISSUER and JWT_AUDIENCE; remote targets require an existing operator token.
import { isLoopbackTarget, resolveToolToken, tokenFromArgs } from './lib/tool-token.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const base = (arg('--base', 'http://localhost:9100')).replace(/\/+$/, '');
const scope = arg('--scope', 'tapestry');
const vertical = arg('--vertical', 'retail');
const token = await resolveToolToken({ token: tokenFromArgs(process.argv), payload: { sub: 'import-content', roles: ['operator'] },
  expiresIn: '10m', allowMint: isLoopbackTarget(base) });
const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Tenant': scope };

// 1. The catalog, through the seam.
const pull = await (await fetch(`${base}/content/catalog/pull?scope=${encodeURIComponent(scope)}`, {
  method: 'POST', headers: auth,
  body: JSON.stringify({ url: `${base}/meridian/api/catalog?vertical=${vertical}`, path: 'content', note: `demo catalog import (${vertical})` }),
})).json();
console.log('catalog:', JSON.stringify(pull));
if (!pull.ok) process.exit(1);

// 2. Slots that match the catalog's slot names and tag vocabulary.
const cat = await (await fetch(`${base}/content/catalog?scope=${encodeURIComponent(scope)}`, { headers: auth })).json();
const merch = cat.document.pieces.find((p) => p.slotTypes.includes('merch'));
const slots = { version: `slots-${scope}`, pages: { home: [
  ...(merch ? [{ slot: 'merch', take: 1, weights: {}, pinnedPieceId: merch.id }] : []),
  { slot: 'chero', take: 1, weights: { contentType: 0.35, line: 0.25, category: 0.2, styleWorld: 0.2 } },
  { slot: 'story', take: 2, weights: { contentType: 0.3, occasion: 0.25, category: 0.25, styleWorld: 0.2 } },
  { slot: 'carousel', take: 5, weights: { line: 0.3, category: 0.25, occasion: 0.25, contentType: 0.2 } },
] } };
const put = await (await fetch(`${base}/content/slots?scope=${encodeURIComponent(scope)}`, {
  method: 'PUT', headers: auth, body: JSON.stringify({ document: slots, note: 'slots for the demo catalog' }),
})).json();
console.log('slots:', JSON.stringify({ ok: put.ok, revision: put.revision, version: put.version, errors: put.errors }));
process.exit(put.ok ? 0 : 1);
