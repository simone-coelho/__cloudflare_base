#!/usr/bin/env node
// scripts/build-demo-worker-config.mjs
// ──────────────────────────────────────────────────────────────────────────
// Writes the wrangler config for a demo's OWN worker, generated from
// wrangler.toml so it can never drift from it. This is
// scripts/build-top-offers-config.mjs generalised: the name and the queue were
// already the only two things that differed, so they became arguments.
//
//   node scripts/build-demo-worker-config.mjs \
//     --name edge-platform-vantage --queue events-vantage --dev-port 9110
//   → wrangler.vantage.toml
//
//   --name   the worker's own name and URL (<name>.expedge.workers.dev)
//   --queue  its own queue; the dead-letter queue is <queue>-dlq. A queue has
//            exactly ONE consumer and the shared worker already consumes
//            `events`, so every demo worker needs its own pair.
//   --set    KEY=VALUE, repeatable: override one [vars] entry on this worker
//            only, so it moves nobody else's demo. Vantage sets none and passes
//            only --dev-port 9110; it runs the shipped REFLEX_HOST=session (on the
//            object host the ledger consumer stalls under a burst of snapshots;
//            lanes/L1.md finding 9).
//   --dev-port  the local `wrangler dev` port written into [dev], so a bare
//            `npx wrangler dev --config <file>` cannot collide with another
//            demo's server on 9100 (Vantage: 9110)
//   --out    the file to write. Default: wrangler.<name minus "edge-platform-">.toml
//
// What is changed, and why:
//
//   name                    its own worker and URL
//   queues                  its own pair (above)
//   LEDGER_RECOVERY_CONFIG  renamed WITH the queues. The queue consumer
//                           (src/index.ts) retries every ledger message whose
//                           batch did not arrive on the configured
//                           `sourceQueue`, so a worker that consumes its own
//                           queue while this var still names `events` never
//                           writes its ledger: no decision records, no
//                           receipts, an empty day report.
//   env.*                   staging/production stamps belong to the customer
//                           workflow, never to a demo worker
//   --set vars              only what the caller names
//   assets                  run_worker_first ["/"] and not_found_handling
//                           "none" (lane K6). The worker answers its own root
//                           (src/demos/kit/root.ts: a 302 to the one demo it
//                           provisions), where the asset layer would serve
//                           public/index.html, the repository's legacy
//                           dashboard. Both settings are needed: once
//                           run_worker_first is a list, the asset layer applies
//                           not_found_handling to every request it routes
//                           itself, so "single-page-application" would answer
//                           every API GET (/vantage/api/coldstart, /v1/...) with
//                           index.html. With "none", a request no asset matches
//                           reaches the worker as it does today, and an unknown
//                           page is the worker's 404, never the dashboard.
//
// Everything else is inherited verbatim: KV, R2 and D1 are shared as Top Offers
// shares them; Durable Object classes are per worker, so this worker's visitor
// state is its own. The scheduled jobs are KEPT and are required (the day
// report is the sum of the hour aggregates the five-minute fold builds); each
// one iterates this worker's own TENANTS list, so never provision one tenant on
// two cron-running workers.
//
// scripts/build-top-offers-config.mjs now delegates to this builder with Top
// Offers' name and queue (2026-09-30), so both commands write the same
// wrangler.top-offers.toml, with the recovery queues renamed to match.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'smol-toml';

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const VAR = /^[A-Z][A-Z0-9_]{0,63}$/;

/** Parse argv into the builder's options; throws on anything it does not understand. */
export function parseArgs(argv) {
  const options = { name: '', queue: '', out: '', devPort: 0, set: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!['--name', '--queue', '--out', '--set', '--dev-port'].includes(flag)) throw new Error(`unknown argument ${flag}`);
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    i += 1;
    if (flag === '--set') {
      const at = value.indexOf('=');
      const key = at > 0 ? value.slice(0, at) : '';
      if (!VAR.test(key)) throw new Error(`--set expects KEY=VALUE with an upper-case var name, got "${value}"`);
      options.set.push([key, value.slice(at + 1)]);
    } else if (flag === '--dev-port') {
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`--dev-port expects a port number, got "${value}"`);
      options.devPort = port;
    } else options[flag.slice(2)] = value;
  }
  if (!SLUG.test(options.name)) throw new Error('--name is required: a worker name such as edge-platform-vantage');
  if (!SLUG.test(options.queue)) throw new Error('--queue is required: a queue name such as events-vantage');
  if (options.name === 'edge-platform') throw new Error('--name edge-platform is the SHARED demo worker; a demo worker needs its own name');
  if (options.queue === 'events' || options.queue === 'events-dead-letter') throw new Error('--queue must not be the shared worker\'s queue');
  return options;
}

/** The default output file: wrangler.<name without the edge-platform- prefix>.toml */
export function defaultOut(name) {
  return `wrangler.${name.replace(/^edge-platform-/, '')}.toml`;
}

/**
 * The generated config, as an object. Pure: `base` is the parsed wrangler.toml,
 * and nothing in it is mutated.
 */
export function buildConfig(base, { name, queue, set = [], devPort = 0 }) {
  const cfg = structuredClone(base);
  const dlq = `${queue}-dlq`;
  cfg.name = name;
  delete cfg.env;

  const rename = (q) => (q === 'events' ? queue : q === 'events-dead-letter' ? dlq : q);
  for (const p of cfg.queues?.producers ?? []) p.queue = rename(p.queue);
  for (const c of cfg.queues?.consumers ?? []) {
    c.queue = rename(c.queue);
    if (c.dead_letter_queue) c.dead_letter_queue = rename(c.dead_letter_queue);
  }

  cfg.vars = { ...(cfg.vars ?? {}) };
  if (typeof cfg.vars.LEDGER_RECOVERY_CONFIG === 'string') {
    const recovery = JSON.parse(cfg.vars.LEDGER_RECOVERY_CONFIG);
    if (recovery && typeof recovery === 'object') {
      if (typeof recovery.sourceQueue === 'string') recovery.sourceQueue = rename(recovery.sourceQueue);
      if (typeof recovery.deadLetterQueue === 'string') recovery.deadLetterQueue = rename(recovery.deadLetterQueue);
      cfg.vars.LEDGER_RECOVERY_CONFIG = JSON.stringify(recovery);
    }
  }
  for (const [key, value] of set) cfg.vars[key] = value;
  if (devPort) cfg.dev = { ...(cfg.dev ?? {}), port: devPort };
  cfg.assets = { ...(cfg.assets ?? {}), run_worker_first: ['/'], not_found_handling: 'none' };
  return { cfg, dlq };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = fileURLToPath(new URL('..', import.meta.url));
  const out = resolve(root, options.out || defaultOut(options.name));
  if (/[\\/]wrangler\.toml$/.test(out)) throw new Error('refusing to overwrite wrangler.toml');
  const base = parse(readFileSync(resolve(root, 'wrangler.toml'), 'utf8'));
  const { cfg, dlq } = buildConfig(base, options);
  const file = out.split(/[\\/]/).pop();
  const argv = ['--name', options.name, '--queue', options.queue, ...options.set.flatMap(([k, v]) => ['--set', `${k}=${v}`]),
    ...(options.devPort ? ['--dev-port', String(options.devPort)] : [])].join(' ');
  const header = `# GENERATED by scripts/build-demo-worker-config.mjs from wrangler.toml. Do not edit.
# Regenerate: node scripts/build-demo-worker-config.mjs ${argv}
# This demo's own worker: ${options.name}.expedge.workers.dev
# Deploy (owner's go only): npx wrangler deploy --config ${file}
`;
  writeFileSync(out, `${header}\n${stringify(cfg)}\n`);
  const overrides = (options.set.length ? `, vars ${options.set.map(([k, v]) => `${k}=${v}`).join(' ')}` : '')
    + (options.devPort ? `, dev port ${options.devPort}` : '');
  console.log(`wrote ${file}: name ${options.name}, queues ${options.queue} / ${dlq} (ledger recovery renamed with them)${overrides}, scheduled jobs kept, no env stamps`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`build-demo-worker-config: ${error.message}`); process.exit(1); }
}
