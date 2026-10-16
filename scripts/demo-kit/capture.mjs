#!/usr/bin/env node
// scripts/demo-kit/capture.mjs — what a demo's worker has published, captured; and two captures compared.
//
// The instrument behind the kit's equivalence proofs (lane K3): seed with one script, capture; seed with
// another, capture; diff. A capture holds the four documents in force (the registry as authored and as
// effective, the catalog, the slots, the learn document) with their revision, actor, note and time, and,
// with --regions, every region's panel read (what a stranger from there opens with). Instants are compared
// relative to each seed's own anchor, so two seeds run minutes apart compare equal when they published the
// same story.
//
//   node scripts/demo-kit/capture.mjs --config <file> --base <url> [--token <jwt>] --out <capture.json>
//        [--anchor-file <anchor.json> | --anchor <ISO instant>] [--regions all | US-NY,US-TX]
//   node scripts/demo-kit/capture.mjs --diff <a.json> <b.json> [--max 40]
//
// Reading the documents needs an operator token, minted locally for a loopback --base exactly as the seed
// mints it (the config's seed.operator); a remote target needs --token. Panels need none. Nothing here
// writes to the worker.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argOf, loadValidConfig } from './lib/config.mjs';
import { buildRegions, panelOf } from './lib/region.mjs';
import { authHeaders, deepDiff, MEMBERS, relativeTimestamps } from './lib/seed.mjs';
import { isLoopbackTarget, resolveToolToken, tokenFromArgs } from '../lib/tool-token.mjs';

const argv = process.argv.slice(2);

/** The parts of a panel read that say what was seeded and what a stranger opens with; times and live counters left out. */
export const panelSummary = (b) => (b ? {
  region: b.region?.key ?? null, source: b.region?.source ?? null, grain: b.grain ?? null,
  census: b.census ? { grain: b.census.grain, income: b.census.medianHouseholdIncomeUsd } : null,
  lean: b.lean ? { level: b.lean.level, answered: b.lean.answered, events: b.lean.events, seededUnits: b.lean.seeded?.units ?? null,
    seededLabel: b.lean.seeded?.label ?? null, dataSource: b.lean.dataSource, label: b.lean.label, leaders: b.lean.leaders, share: b.lean.share } : null,
} : null);

async function capture() {
  const file = argOf(argv, '--config');
  const base = (argOf(argv, '--base') || '').replace(/\/+$/, '');
  const out = argOf(argv, '--out');
  if (!file || !base || !out) { console.error('usage: capture.mjs --config <file> --base <url> --out <capture.json> [--token <jwt>] [--anchor-file <file> | --anchor <iso>] [--regions all | keys]'); process.exit(2); }
  const regionsArg = argOf(argv, '--regions');
  const { config, path } = loadValidConfig(file, { sections: regionsArg ? ['seed', 'region'] : ['seed'] });
  const anchorFile = argOf(argv, '--anchor-file') ? resolve(process.cwd(), argOf(argv, '--anchor-file')) : resolve(path(config.seed.beats.dir), config.seed.beats.anchor.file);
  const anchor = argOf(argv, '--anchor') ?? JSON.parse(readFileSync(anchorFile, 'utf8'))[config.seed.beats.anchor.field];
  if (!Number.isFinite(Date.parse(anchor ?? ''))) { console.error('✗ no anchor instant: pass --anchor or --anchor-file'); process.exit(2); }

  const token = await resolveToolToken({ token: tokenFromArgs(process.argv), payload: { sub: config.seed.operator, roles: ['operator'] },
    expiresIn: '10m', allowMint: isLoopbackTarget(base) });
  const headers = authHeaders(token, config.tenant);
  const documents = {};
  for (const { member, path: route } of MEMBERS) {
    const res = await fetch(`${base}${route}?scope=${encodeURIComponent(config.tenant)}`, { headers });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) { console.error(`✗ ${route}: HTTP ${res.status}`); process.exit(1); }
    documents[member] = member === 'reflex'
      ? { revision: body.revision, source: body.source, actor: body.actor, note: body.note, at: body.at, document: body.authored, effective: body.config }
      : { revision: body.revision, source: body.source, actor: body.actor, note: body.note, at: body.at, document: body.document };
    console.log(`${member}: revision ${body.revision}, ${body.source}, by ${body.actor}, at ${body.at ? new Date(body.at).toISOString() : '—'}`);
  }
  const result = { capturedAt: new Date().toISOString(), base, tenant: config.tenant, anchor, documents };
  if (regionsArg) {
    const { all } = buildRegions(config.region, { path });
    const keys = regionsArg === 'all' ? Object.keys(all) : regionsArg.split(',').map((k) => k.trim().toUpperCase());
    result.regions = {};
    for (const key of keys) result.regions[key] = panelSummary(await panelOf({ base, panel: config.region.panel, tenant: config.tenant, region: key }));
    console.log(`regions: ${keys.length} panels read`);
  }
  writeFileSync(resolve(process.cwd(), out), `${JSON.stringify(result, null, 1)}\n`);
  console.log(`wrote ${out}`);
}

/**
 * The server stamps every stored document's version with its own revision ("name+r3"; src/content/kinds.ts
 * and src/reflex/configStore.ts, "so two revisions never share a label"). Two seeds that land at different
 * revisions therefore differ in that label and in nothing they sent; the stamp is removed only when it is
 * exactly this capture's own revision, and the diff says which stamps it removed.
 */
export const unstamped = (doc, revision) => {
  const stamp = `+r${revision}`;
  return doc && typeof doc.version === 'string' && doc.version.endsWith(stamp) ? { ...doc, version: doc.version.slice(0, -stamp.length) } : doc;
};

function diff() {
  const at = argv.indexOf('--diff');
  const [fa, fb] = [argv[at + 1], argv[at + 2]];
  const max = Number(argOf(argv, '--max', '40'));
  const a = JSON.parse(readFileSync(fa, 'utf8')), b = JSON.parse(readFileSync(fb, 'utf8'));
  const aa = Date.parse(a.anchor), ba = Date.parse(b.anchor);
  let differences = 0;
  console.log(`A ${fa}: anchor ${a.anchor}, captured ${a.capturedAt}\nB ${fb}: anchor ${b.anchor}, captured ${b.capturedAt}`);
  for (const { member } of MEMBERS) {
    const da = a.documents[member], db = b.documents[member];
    const doc = deepDiff(relativeTimestamps(unstamped(da.document, da.revision), aa), relativeTimestamps(unstamped(db.document, db.revision), ba));
    const eff = member === 'reflex' ? deepDiff(unstamped(da.effective, da.revision), unstamped(db.effective, db.revision)) : [];
    const note = relativeTimestamps(da.note, aa) === relativeTimestamps(db.note, ba);
    const instants = JSON.stringify(da.document).match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z/g)?.length ?? 0;
    const stamps = da.document?.version !== db.document?.version ? `; version stamps ${JSON.stringify(da.document?.version)} · ${JSON.stringify(db.document?.version)} (the server's revision label, compared without it)` : '';
    differences += doc.length + eff.length + (note ? 0 : 1);
    console.log(`${member.padEnd(7)} A rev ${da.revision} · B rev ${db.revision}; document ${doc.length ? `${doc.length} difference(s)` : 'equal'}`
      + `${instants ? ` (${instants} instants, each relative to its anchor)` : ''}${member === 'reflex' ? `; effective ${eff.length ? `${eff.length} difference(s)` : 'equal'}` : ''}; note ${note ? 'equal' : 'differs'}${stamps}`);
    for (const d of [...doc, ...eff].slice(0, max)) console.log(`    ${d.path}: A ${JSON.stringify(d.a)} · B ${JSON.stringify(d.b)}`);
    if (!note) console.log(`    note: A ${JSON.stringify(da.note)} · B ${JSON.stringify(db.note)}`);
  }
  if (a.regions || b.regions) {
    const keys = [...new Set([...Object.keys(a.regions ?? {}), ...Object.keys(b.regions ?? {})])];
    const wrong = [];
    for (const k of keys) {
      const d = deepDiff(a.regions?.[k] ?? null, b.regions?.[k] ?? null);
      if (d.length) { wrong.push(k); differences += d.length; for (const x of d.slice(0, 6)) console.log(`    ${k} ${x.path}: A ${JSON.stringify(x.a)} · B ${JSON.stringify(x.b)}`); }
    }
    const units = keys.reduce((n, k) => n + (a.regions?.[k]?.lean?.seededUnits ?? 0), 0);
    console.log(`regions ${keys.length}: ${wrong.length ? `${wrong.length} differ (${wrong.join(', ')})` : 'every panel equal'}: seeded units, events, level, label, leaders and share per dimension per value (${units} seeded units in A)`);
  }
  console.log(differences ? `✗ ${differences} difference(s)` : '✓ equal, apart from each seed\'s own anchor');
  process.exit(differences ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (argv.includes('--diff')) diff(); else await capture();
}
