#!/usr/bin/env node
// scripts/demo-kit/seed.mjs — a demo's documents, re-anchored to now, written back and published.
//
// The kit's form of scripts/seed-vantage.mjs, driven by a demo config (scripts/demo-kit/configs/<slug>.json).
// It reads the demo's beat documents, slides every window by (now − the recorded anchor) so the story
// opens today exactly as it was written, runs the local checks (vocabulary, registry, regional list,
// arrival seeds, the closed beat list, beats 1..N), writes the documents back, and publishes the opening
// documents: the demo bootstrap once, then one versioned write per document.
//
//   node scripts/demo-kit/seed.mjs --config scripts/demo-kit/configs/vantage.json [--base http://localhost:9110]
//        [--token <jwt>] [--files-only] [--out <dir>]
//
// --base       the worker; default http://localhost:<worker.devPort>
// --token      an operator token with a grant on the tenant. Local minting (a loopback --base only) needs
//              DEPLOYMENT_PROFILE=demo and JWT_SECRET, JWT_ISSUER, JWT_AUDIENCE in the environment, and
//              TENANTS must grant the config's seed.operator the tenant. A remote target needs --token.
// --files-only write the re-anchored documents and stop
// --out <dir>  write the documents there instead of the demo's beats directory (a rehearsal or a proof)
//
// A RESEED OF A HOSTED WORKER MUST BE FOLLOWED BY A DEPLOY: the worker applies beats from its own ASSETS
// copy of the beats directory, which this rewrites.
import { relative, resolve } from 'node:path';
import { argOf, configArg, loadValidConfig } from './lib/config.mjs';
import { iso, prepareSeed, publishOpening, writeBeatFiles } from './lib/seed.mjs';
import { isLoopbackTarget, resolveToolToken, tokenFromArgs } from '../lib/tool-token.mjs';

const argv = process.argv.slice(2);
const file = configArg(argv, ['--config', '--base', '--token', '--out']);
if (!file) {
  console.error('usage: node scripts/demo-kit/seed.mjs --config <file> [--base <url>] [--token <jwt>] [--files-only] [--out <dir>]');
  process.exit(2);
}
const { config, path } = loadValidConfig(file, { sections: ['seed'] });
const base = argOf(argv, '--base', `http://localhost:${config.worker.devPort}`).replace(/\/+$/, '');
const scope = config.tenant;
const show = (p) => { const r = relative(process.cwd(), p); return r && !r.startsWith('..') ? r : p; };

const prepared = prepareSeed({ config, path, nowMs: Date.now() });
for (const w of prepared.warnings) console.warn(`! ${w}`);
if (prepared.errors.length) {
  console.error(`✗ ${prepared.errors.length} problem(s) in ${config.name}'s documents; nothing written, nothing sent:\n  - ${prepared.errors.join('\n  - ')}`);
  process.exit(1);
}

const counts = Object.entries(prepared.counts).map(([t, n]) => `${t} ${n}`).join(', ');
const added = Object.entries(prepared.added).map(([t, n]) => `${t} +${n}`).join(', ');
const hours = (prepared.deltaMs / 3_600_000).toFixed(2);
console.log(`anchor ${iso(prepared.toMs)} (re-anchored from ${iso(prepared.fromMs)}, ${prepared.deltaMs >= 0 ? '+' : ''}${hours} h) · ${counts}${added ? ` (${added} in the beats)` : ''}`);
console.log(`art: ${Object.entries(prepared.art).map(([t, a]) => `${a.with}/${a.of} ${t}`).join(', ')} carry an image`);

const outDir = argOf(argv, '--out') ? resolve(process.cwd(), argOf(argv, '--out')) : path(config.seed.beats.dir);
const written = writeBeatFiles(outDir, prepared);
console.log(`wrote ${written} documents to ${show(outDir)}/`);
if (argv.includes('--files-only')) process.exit(0);

let token;
try {
  token = await resolveToolToken({ token: tokenFromArgs(process.argv), payload: { sub: config.seed.operator, roles: ['operator'] },
    expiresIn: '30m', allowMint: isLoopbackTarget(base) });
} catch (error) { console.error(`✗ ${error.message}`); process.exit(1); }
const result = await publishOpening({ base, scope, token, documents: prepared.documents, notes: prepared.notes });
process.exit(result.ok ? 0 : 1);
