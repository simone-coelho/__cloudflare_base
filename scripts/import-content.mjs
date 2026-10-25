#!/usr/bin/env node
/* eslint-env node */
// scripts/import-content.mjs — the manual import adapter: a customer file, or the demo catalog.
//
// P90 (E15): with --file, loads a customer's export (JSON or CSV) into the NAMED tenant through
// POST /content/catalog/import, naming its mode (merge by default, or replace) and carrying the two
// publication headers; --dry-run checks it under the import's own rules and writes nothing:
//
//   node scripts/import-content.mjs --scope <tenant> --file <path> [--format json|csv] [--mode merge|replace] [--dry-run]
//        [--base http://localhost:9100] [--token <jwt>]
//
// It prints the answer (revision, changed, removed, skipped, dryRun, the diagnostics) and exits 0 when the import
// answered 200, 1 when the Worker refused it (its errors printed), and 2 when it refused locally before sending
// anything (no token for a target that is not a loopback address, an unreadable file, an unknown format or mode, and
// --mode full, which expires stored pieces and runs only through the API with its guard).
//
// Without --file, pulls the Meridian content catalog through the worker's own CMS/DAM seam into the NAMED
// tenant, and writes a slot document whose slot names and weights match what that catalog was
// built for, so GET /v1/:scope/decisions/snapshot returns real decisions from real, committed content.
//
//   node scripts/import-content.mjs --scope <tenant> [--base http://localhost:9100] [--vertical retail] [--token <jwt>]
//
// A DEMO step, not part of the product seed order: the catalogue it pulls is the Meridian demo API,
// which a worker running with AUTH_MODE = "enforced" (the tracked default) answers 404 by design. On
// a local worker it needs AUTH_MODE=open in .dev.vars; otherwise it refuses and writes nothing.
//
// --scope is required: an unscoped import never picks a default tenant. The target defaults to the
// local worker. Use --token or OPERATOR_TOKEN; local minting requires explicit JWT_SECRET,
// JWT_ISSUER, JWT_AUDIENCE and DEPLOYMENT_PROFILE=demo, and is refused for anything but a loopback
// target. A remote target is reached only with an operator token issued for that tenant (the W03
// scoped tool token), never one minted here.
//
// Every write carries the publication headers (docs/kit/02-api-reference.md §4): If-Match "N/S/H"
// from the draft it read, and an Idempotency-Key "N:UUID" derived from that exact request. The
// pull always publishes the catalog it fetched (a repeat run publishes the same content again); a
// slot document already holding the imported content is left as it is. A run a failure interrupted
// is recovered by running the same command again for the same tenant.
import { isLoopbackTarget, resolveToolToken, tokenFromArgs } from './lib/tool-token.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const base = (arg('--base', 'http://localhost:9100')).replace(/\/+$/, '');
const scope = arg('--scope');
if (typeof scope !== 'string' || !scope.trim() || scope.startsWith('--')) {
  console.error('import-content: name the tenant to import into with --scope <tenant>; an unscoped import is refused and nothing was sent.');
  process.exit(2);
}
const vertical = arg('--vertical', 'retail');
/** P90: a refusal before any request: one line naming it, exit 2, no stack trace. */
const refuse = (message) => { console.error(`import-content: ${message}`); process.exit(2); };
// P90: the customer file, read and checked before any request.
const file = arg('--file');
let upload = null;
if (file !== undefined) {
  if (typeof file !== 'string' || !file || file.startsWith('--')) refuse('--file names the export to load; nothing was sent.');
  const extension = /\.(json|csv)$/i.exec(file)?.[1]?.toLowerCase();
  const format = String(arg('--format', extension ?? '')).toLowerCase();
  if (format !== 'json' && format !== 'csv') refuse(`the format must be json or csv (--format, or a .json or .csv file), not "${format}"; nothing was sent.`);
  const mode = arg('--mode', 'merge');
  if (mode === 'full') refuse('--mode full expires every stored piece the file leaves out, so this script does not run it: use POST /content/catalog/import?mode=full with its guard expire=<n> (the number of pieces it expires); nothing was sent.');
  if (mode !== 'merge' && mode !== 'replace') refuse(`--mode must be merge or replace, not "${mode}"; nothing was sent.`);
  const { readFile } = await import('node:fs/promises');
  let text;
  try { text = await readFile(file, 'utf8'); } catch (error) { refuse(`cannot read ${file} (${error.code ?? error.message}); nothing was sent.`); }
  upload = { format, mode, text, dryRun: process.argv.includes('--dry-run') };
}
let token;
try {
  token = await resolveToolToken({ token: tokenFromArgs(process.argv), payload: { sub: 'import-content', roles: ['operator'] },
    expiresIn: '10m', allowMint: isLoopbackTarget(base) });
} catch (error) {
  refuse(`${error.message} A target that is not a loopback address needs an issued operator token (--token or OPERATOR_TOKEN); nothing was sent.`);
}
const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Tenant': scope };

// ── The configuration publication protocol (kit 02 §4) ──────────────────────────────────────────
const fail = (message) => { console.error(`import-content: ${message}`); process.exit(1); };
const call = async (method, path, body, headers = {}, query = {}) => {
  const params = new URLSearchParams({ scope, ...query });
  const response = await fetch(`${base}${path}?${params.toString()}`, { method, headers: { ...auth, ...headers }, ...(body === undefined ? {} : { body }) });
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
    fail(`${path}: another publication for "${scope}" holds the set or the draft moved (409 ${result.body.code ?? ''}); nothing new was written. Inspect GET /content/catalog/publication and finish a pending one with POST /content/catalog/publication/recover (docs/kit/02-api-reference.md §4) before importing again.`);
  }
  return result.body;
};

// P90 (E15): the customer file, over the catalog draft, its mode named and its two publication headers carried.
if (upload) {
  const current = await draft('catalog');
  const query = { format: upload.format, mode: upload.mode, ...(upload.dryRun ? { dryRun: '1' } : {}) };
  const path = '/content/catalog/import';
  const headers = { 'Content-Type': upload.format === 'csv' ? 'text/csv' : 'application/json', 'If-Match': current.ifMatch,
    'Idempotency-Key': await operationKey(current.revision, [scope, 'POST', `${path}?${new URLSearchParams(query).toString()}`, current.ifMatch, upload.text]) };
  const { status, body } = await call('POST', path, upload.text, headers, query);
  const errors = body.errors ?? (body.error ? [body.error] : undefined);
  console.log('import:', JSON.stringify({ status, ok: body.ok === true, revision: body.revision, changed: body.changed, removed: body.removed,
    ...(body.skipped !== undefined ? { skipped: body.skipped, reason: body.reason } : {}), ...(body.dryRun !== undefined ? { dryRun: body.dryRun } : {}),
    ...(body.diagnostics !== undefined ? { diagnostics: body.diagnostics } : {}), ...(errors ? { errors } : {}) }));
  process.exit(status === 200 && body.ok === true ? 0 : 1);
}

// 1. The catalog, through the seam, over the catalog draft.
const pull = await write('POST', '/content/catalog/pull', await draft('catalog'),
  JSON.stringify({ url: `${base}/meridian/api/catalog?vertical=${vertical}`, path: 'content', mode: 'replace', note: `demo catalog import (${vertical})` }));
// The Worker fetches the source before it publishes anything (src/routes/content.ts, /catalog/pull),
// so a source that answers 404 leaves every document as it was. On this importer's own source that
// 404 means the Worker does not serve the demo APIs: it enforces authentication.
if (pull.ok !== true && (pull.errors ?? []).some((error) => /source responded 404\b/.test(String(error)))) {
  fail(`refused, nothing was written: ${base}/meridian/api/catalog answered 404, because the Worker runs with AUTH_MODE = "enforced", under which the demo APIs answer 404 by design. import-content is a DEMO step and not part of the product seed order. On a local worker it needs AUTH_MODE=open in .dev.vars (the tracked wrangler.toml keeps AUTH_MODE = "enforced"; restart npm run dev after adding it); a deployed worker that enforces authentication never serves this import. See docs/10-d1-schema.md.`);
}
console.log('catalog:', JSON.stringify({ ok: pull.ok, revision: pull.revision, version: pull.version, pieces: pull.pieces, changed: pull.changed, removed: pull.removed, errors: pull.errors ?? pull.error }));
if (pull.ok !== true) process.exit(1);

// 2. Slots that match the catalog's slot names and tag vocabulary.
const cat = (await call('GET', '/content/catalog')).body;
const merch = (cat.document?.pieces ?? []).find((p) => p.slotTypes.includes('merch'));
const slots = { version: `slots-${scope}`, pages: { home: [
  ...(merch ? [{ slot: 'merch', take: 1, weights: {}, pinnedPieceId: merch.id }] : []),
  { slot: 'chero', take: 1, weights: { contentType: 0.35, line: 0.25, category: 0.2, styleWorld: 0.2 } },
  { slot: 'story', take: 2, weights: { contentType: 0.3, occasion: 0.25, category: 0.25, styleWorld: 0.2 } },
  { slot: 'carousel', take: 5, weights: { line: 0.3, category: 0.25, occasion: 0.25, contentType: 0.2 } },
] } };
const current = await draft('slots');
const checked = await call('POST', '/content/slots/validate', JSON.stringify({ document: slots }));
if (checked.body.valid !== true) fail(`slots: the Worker refused the document: ${JSON.stringify(checked.body.errors ?? checked.body.error ?? checked.status)}`);
if (canonical(unstamped(checked.body.document)) === canonical(unstamped(current.document))) {
  console.log('slots:', JSON.stringify({ ok: true, unchanged: true, revision: current.revision }));
  process.exit(0);
}
const put = await write('PUT', '/content/slots', current, JSON.stringify({ document: slots, note: 'slots for the demo catalog' }));
console.log('slots:', JSON.stringify({ ok: put.ok, revision: put.revision, version: put.version, errors: put.errors ?? put.error }));
process.exit(put.ok === true ? 0 : 1);
