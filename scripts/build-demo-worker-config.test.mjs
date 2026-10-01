// node --test scripts/build-demo-worker-config.test.mjs
// The generalised demo-worker config builder: it must reproduce the Top Offers
// worker's config (its own name and queues), rename the ledger-recovery queues
// WITH the queues, override only the vars it is told to, and refuse to build
// anything that would collide with the shared worker.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parse } from 'smol-toml';
import { buildConfig, defaultOut, parseArgs } from './build-demo-worker-config.mjs';

const root = new URL('../', import.meta.url);
const base = parse(readFileSync(new URL('wrangler.toml', root), 'utf8'));
// The Vantage config exactly as generated: no --set, so the shipped session host.
const { cfg } = buildConfig(base, parseArgs(['--name', 'edge-platform-vantage', '--queue', 'events-vantage', '--dev-port', '9110']));

test('its own name and queue pair, and no customer stamps', () => {
  assert.equal(cfg.name, 'edge-platform-vantage');
  assert.equal(cfg.env, undefined);
  assert.deepEqual(cfg.queues.producers.map((p) => p.queue), ['events-vantage']);
  assert.deepEqual(cfg.queues.consumers.map((c) => c.queue), ['events-vantage', 'events-vantage-dlq']);
  assert.equal(cfg.queues.consumers[0].dead_letter_queue, 'events-vantage-dlq');
  assert.equal(defaultOut('edge-platform-vantage'), 'wrangler.vantage.toml');
  assert.equal(defaultOut('edge-platform-top-offers'), 'wrangler.top-offers.toml');
});

test('the ledger-recovery queues move with the queues, or the consumer never writes the ledger', () => {
  const recovery = JSON.parse(cfg.vars.LEDGER_RECOVERY_CONFIG);
  assert.equal(recovery.sourceQueue, 'events-vantage');
  assert.equal(recovery.deadLetterQueue, 'events-vantage-dlq');
  assert.equal(recovery.version, 1);
});

test('the Vantage config inherits every var verbatim, on the shipped session host', () => {
  assert.equal(cfg.vars.REFLEX_HOST, 'session');
  for (const [key, value] of Object.entries(base.vars)) {
    if (key === 'LEDGER_RECOVERY_CONFIG') continue;
    assert.equal(cfg.vars[key], value, key);
  }
  for (const key of ['kv_namespaces', 'r2_buckets', 'd1_databases', 'durable_objects', 'migrations', 'assets', 'triggers']) {
    assert.deepEqual(cfg[key], base[key], key);
  }
  assert.equal(cfg.dev.port, 9110);
});

test('--set overrides only the var it names, and never the source config', () => {
  const set = buildConfig(base, parseArgs(['--name', 'edge-platform-vantage', '--queue', 'events-vantage', '--set', 'REFLEX_HOST=do'])).cfg;
  assert.equal(set.vars.REFLEX_HOST, 'do');
  assert.equal(base.vars.REFLEX_HOST, 'session', 'the source config is not mutated');
  for (const [key, value] of Object.entries(base.vars)) {
    if (key === 'REFLEX_HOST' || key === 'LEDGER_RECOVERY_CONFIG') continue;
    assert.equal(set.vars[key], value, key);
  }
});

test('the Top Offers build is the committed Top Offers config, plus the ledger-recovery rename', () => {
  const topOffers = buildConfig(base, parseArgs(['--name', 'edge-platform-top-offers', '--queue', 'events-top-offers'])).cfg;
  const committed = parse(readFileSync(new URL('wrangler.top-offers.toml', root), 'utf8'));
  const { LEDGER_RECOVERY_CONFIG: built, ...builtVars } = topOffers.vars;
  const { LEDGER_RECOVERY_CONFIG: shipped, ...shippedVars } = committed.vars;
  assert.deepEqual({ ...topOffers, vars: builtVars }, { ...committed, vars: shippedVars });
  assert.equal(JSON.parse(shipped).sourceQueue, 'events', 'the committed Top Offers config still names the shared queue');
  assert.equal(JSON.parse(built).sourceQueue, 'events-top-offers');
});

test('refuses the shared worker, the shared queue, and anything it does not understand', () => {
  assert.throws(() => parseArgs(['--name', 'edge-platform', '--queue', 'events-x']), /SHARED/);
  assert.throws(() => parseArgs(['--name', 'edge-platform-x', '--queue', 'events']), /shared/);
  assert.throws(() => parseArgs(['--name', 'edge-platform-x']), /--queue is required/);
  assert.throws(() => parseArgs(['--name', 'edge-platform-x', '--queue', 'q', '--set', 'lower=1']), /KEY=VALUE/);
  assert.throws(() => parseArgs(['--name', 'edge-platform-x', '--queue', 'q', '--dev-port', '80']), /port/);
  assert.throws(() => parseArgs(['--name', 'edge-platform-x', '--queue', 'q', '--deploy', 'yes']), /unknown argument/);
});
