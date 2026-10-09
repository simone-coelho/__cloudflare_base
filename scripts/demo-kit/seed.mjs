#!/usr/bin/env node
// scripts/demo-kit/seed.mjs — a demo's documents, re-anchored to now, written back and published.
//
// Driven by a demo config (scripts/demo-kit/configs/<slug>.json). The demo's beat documents are the edited
// data (docs/demo-kit/Demo-Kit-Design.md, decisions log, K3 part b): this reads them, slides every window by
// (now − the recorded anchor) so the story opens today exactly as it was written, runs the local checks
// (vocabulary, registry, regional list, arrival seeds, the closed beat list, beats 1..N, the anchor file's
// copies of what is published, the art each piece names), writes the documents back, and publishes the
// opening documents: the demo bootstrap once, then one versioned write per document. A demo's own seed
// script is a thin wrapper over this one (Vantage: scripts/seed-vantage.mjs).
//
//   node scripts/demo-kit/seed.mjs --config scripts/demo-kit/configs/vantage.json [--base http://localhost:9110]
//        [--token <jwt>] [--files-only] [--out <dir>]
//
// --base       the worker; default http://localhost:<worker.devPort>
// --token      an operator token with a grant on the tenant (or OPERATOR_TOKEN). Local minting (a loopback
//              --base only) needs DEPLOYMENT_PROFILE=demo and JWT_SECRET, JWT_ISSUER, JWT_AUDIENCE in the
//              environment, and TENANTS must grant the config's seed.operator the tenant. A remote target
//              needs --token.
// --files-only write the re-anchored documents and stop
// --out <dir>  write the documents there instead of the demo's beats directory (a rehearsal or a proof)
//
// A RESEED OF A HOSTED WORKER MUST BE FOLLOWED BY A DEPLOY: the worker applies beats from its own ASSETS
// copy of the beats directory, which this rewrites.
import { relative, resolve } from 'node:path';
import { isEntry } from './lib/cli.mjs';
import { argOf, configArg, configFileFor, loadValidConfig } from './lib/config.mjs';
import { iso, prepareSeed, publishOpening, writeBeatFiles } from './lib/seed.mjs';
import { isLoopbackTarget, resolveToolToken, tokenFromArgs } from '../lib/tool-token.mjs';

export const USAGE = 'usage: node scripts/demo-kit/seed.mjs --config <file> [--base <url>] [--token <jwt>] [--files-only] [--out <dir>]';

/** The seed, from a command line. Returns the exit code: 0 published (or written, with --files-only), 1 a problem, 2 a usage or config error. */
export async function main(argv = process.argv.slice(2)) {
  const file = configArg(argv, ['--config', '--base', '--token', '--out']);
  if (!file) { console.error(USAGE); return 2; }
  // A demo's slug names scripts/demo-kit/configs/<slug>.json, as check-demo.mjs and rehearse.mjs read it (lane K4).
  const { config, path } = loadValidConfig(configFileFor(file) ?? file, { sections: ['seed'] });
  const base = argOf(argv, '--base', `http://localhost:${config.worker.devPort}`).replace(/\/+$/, '');
  const scope = config.tenant;
  const show = (p) => { const r = relative(process.cwd(), p); return r && !r.startsWith('..') ? r : p; };

  const prepared = prepareSeed({ config, path, nowMs: Date.now() });
  for (const w of prepared.warnings) console.warn(`! ${w}`);
  if (prepared.errors.length) {
    console.error(`✗ ${prepared.errors.length} problem(s) in ${config.name}'s documents; nothing written, nothing sent:\n  - ${prepared.errors.join('\n  - ')}`);
    return 1;
  }

  const counts = Object.entries(prepared.counts).map(([t, n]) => `${t} ${n}`).join(', ');
  const added = Object.entries(prepared.added).map(([t, n]) => `${t} +${n}`).join(', ');
  const hours = (prepared.deltaMs / 3_600_000).toFixed(2);
  console.log(`anchor ${iso(prepared.toMs)} (re-anchored from ${iso(prepared.fromMs)}, ${prepared.deltaMs >= 0 ? '+' : ''}${hours} h) · ${counts}${added ? ` (${added} in the beats)` : ''}`);
  console.log(`art: ${Object.entries(prepared.art).map(([t, a]) => `${a.with}/${a.of} ${t}`).join(', ')} carry an image`);

  const outDir = argOf(argv, '--out') ? resolve(process.cwd(), argOf(argv, '--out')) : path(config.seed.beats.dir);
  const written = writeBeatFiles(outDir, prepared);
  console.log(`wrote ${written} documents to ${show(outDir)}/`);
  if (argv.includes('--files-only')) return 0;

  let token;
  try {
    token = await resolveToolToken({ token: tokenFromArgs(argv), payload: { sub: config.seed.operator, roles: ['operator'] },
      expiresIn: '30m', allowMint: isLoopbackTarget(base) });
  } catch (error) { console.error(`✗ ${error.message}`); return 1; }
  const result = await publishOpening({ base, scope, token, documents: prepared.documents, notes: prepared.notes });
  return result.ok ? 0 : 1;
}

if (isEntry(import.meta.url)) process.exit(await main());
