#!/usr/bin/env node
// scripts/build-top-offers-config.mjs
// ──────────────────────────────────────────────────────────────────────────
// Writes wrangler.top-offers.toml: the config for the Top Offers demo's OWN
// worker, edge-platform-top-offers.expedge.workers.dev.
//
// Why it has its own worker. The shared demo worker (edge-platform) runs the
// older demos — Coach, Bright Hour, Meridian — on the code they were built and
// rehearsed on. Top Offers needs today's engine, and today's engine cannot run
// those older pages: it requires a shopper session on every shopper call, which
// the Coach storefront and Bright Hour never create. One worker cannot run both
// generations, so each gets the code it works on and nobody's demo changes.
//
// Generated rather than hand-copied so it can never drift from wrangler.toml.
// Only three things differ, and each has a reason:
//
//   name      its own worker and URL
//   queues    its own pair; a queue can have exactly ONE consumer, and the
//             shared worker already consumes `events`
//   env.*     staging/production stamps belong to the customer workflow
//
// The scheduled jobs are KEPT, and they are required: the day report is "the
// sum of its hour aggregates" (src/routes/decisions.ts, doc 31 §3), and those
// aggregates are built by the five-minute fold. Without them beat 15's report
// is permanently empty. Every job iterates this worker's OWN TENANTS list, so
// here they touch `shn` and nothing else. Never run them on two workers that
// both provision the same tenant: both would fold the same hours.
//
// Everything else — KV, R2, D1, Durable Object classes, assets, vars — is
// inherited verbatim. Durable Objects are per-worker, so this worker's visitor
// state is its own; the shn publication set lives in the shared R2 and is found
// as-is.
//
// It now delegates. This script runs scripts/build-demo-worker-config.mjs
// --name edge-platform-top-offers --queue events-top-offers and does nothing
// else, so the documented command and the generalised builder write the same
// bytes. That builder also renames the ledger-recovery queues WITH the queues,
// a fourth difference the list above does not name: LEDGER_RECOVERY_CONFIG
// names events-top-offers and events-top-offers-dlq. While it still named the
// shared worker's `events`, the queue consumer (src/index.ts) retried every
// ledger message that arrived on this worker's own queue, so no decision was
// written and the day report stayed empty.
//
//   node scripts/build-top-offers-config.mjs
//   npx wrangler deploy --config wrangler.top-offers.toml
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Fixed arguments and no shell. The generalised builder validates them and
// writes wrangler.top-offers.toml, its default output for this name.
const builder = fileURLToPath(new URL('./build-demo-worker-config.mjs', import.meta.url));
try {
  execFileSync(process.execPath, [builder, '--name', 'edge-platform-top-offers', '--queue', 'events-top-offers'], { stdio: 'inherit' });
} catch (error) {
  // The builder has already printed its own reason; a spawn that failed has not.
  if (typeof error?.status !== 'number') console.error(`build-top-offers-config: ${error?.message ?? error}`);
  process.exit(typeof error?.status === 'number' && error.status !== 0 ? error.status : 1);
}
