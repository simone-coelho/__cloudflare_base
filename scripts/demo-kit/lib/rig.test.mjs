// node --test scripts/demo-kit/lib/rig.test.mjs
// The local rig (scripts/demo-kit/rig.mjs, lane K4): a demo's tenant provisioned for one wrangler dev process without
// writing .dev.vars, its values never printed; the routes mounted on a copy of src/index.ts until the lead applies
// the printed lines; the command line it runs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO_ROOT } from './config.mjs';
import { mountLines } from './scaffold.mjs';
import { RETENTION_CATEGORIES, devVars, identitySecretsFor, main, rigCommand, rigEntry, rigVars } from '../rig.mjs';
import { main as scaffold } from '../new-demo.mjs';
import { safeIdentitySecret, validateIdentityMaterial } from '../../../src/identity/material.mjs';

const policies = { ledger: { id: 'ledger-90d', revision: 1, durationMs: 1, basis: 'occurred', renewal: 'new-record-only' } };
const vantageOnly = devVars([
  `TENANTS='${JSON.stringify({ provisioned: ['vantage'], operatorGrants: { 'vantage-demo': ['vantage'] } })}'`,
  'SDK_KEYS=vantage:demo-site',
  `RETENTION=${JSON.stringify({ version: 1, tenants: { vantage: policies } })}`,
  'JWT_SECRET=not-read-by-the-rig',
].join('\n'));

test('.dev.vars is read by name, quotes removed', () => {
  assert.equal(vantageOnly.SDK_KEYS, 'vantage:demo-site');
  assert.equal(JSON.parse(vantageOnly.TENANTS).provisioned[0], 'vantage');
});

test('a tenant .dev.vars does not provision gets TENANTS, SDK_KEYS and RETENTION for one process; one it does needs nothing', () => {
  const r = rigVars(vantageOnly, { tenant: 'oh', slug: 'oh' });
  assert.equal(r.provisioned, false);
  assert.deepEqual(JSON.parse(r.vars.TENANTS), { provisioned: ['oh'], operatorGrants: { 'oh-demo': ['oh'], 'seed-oh': ['oh'], 'seed-oh-region': ['oh'] } });
  assert.equal(r.vars.SDK_KEYS, 'oh:demo-site');
  assert.deepEqual(JSON.parse(r.vars.RETENTION), { version: 1, tenants: { oh: policies } });
  assert.equal(r.copiedFrom, 'vantage');
  const partial = devVars(`RETENTION=${JSON.stringify({ version: 1, tenants: { coach: policies, vantage: Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly', 'recovery', 'quarantine'].map((c) => [c, policies.ledger])) } })}`);
  assert.equal(rigVars(partial, { tenant: 'oh', slug: 'oh' }).copiedFrom, 'vantage', 'the first tenant whose policies cover every retained category');
  assert.ok(!Object.values(r.vars).some((v) => v.includes('not-read-by-the-rig')), 'no secret reaches a --var');
  const full = { TENANTS: JSON.stringify({ provisioned: ['oh'], operatorGrants: { 'oh-demo': ['oh'], 'seed-oh': ['oh'], 'seed-oh-region': ['oh'] } }), SDK_KEYS: 'oh:demo-site', RETENTION: JSON.stringify({ version: 1, tenants: { oh: policies } }) };
  assert.deepEqual(rigVars(full, { tenant: 'oh', slug: 'oh' }), { provisioned: true });
  assert.match(rigVars({ ...full, TENANTS: JSON.stringify({ provisioned: ['oh'], operatorGrants: {} }) }, { tenant: 'oh', slug: 'oh' }).why.join(), /TENANTS grants oh-demo no oh/);
});

test('the command line carries the values, and what is printed elides every one', () => {
  const r = rigVars(vantageOnly, { tenant: 'oh', slug: 'oh' });
  const c = rigCommand({ entry: '.wrangler/rig-oh/index.ts', config: 'wrangler.oh.toml', port: 9120, inspector: 9270, state: '.wrangler/state-oh', vars: r.vars });
  assert.ok(c.args.includes(`TENANTS:${r.vars.TENANTS}`));
  assert.equal(c.shown, 'wrangler dev .wrangler/rig-oh/index.ts --config wrangler.oh.toml --port 9120 --inspector-port 9270 --persist-to .wrangler/state-oh --var TENANTS:… --var SDK_KEYS:… --var RETENTION:…');
});

test('the rig runs src/index.ts with the scaffold\'s printed mount lines applied until the lead applies them', () => {
  const index = readFileSync(join(REPO_ROOT, 'src', 'index.ts'), 'utf8');
  const demo = { slug: 'oh', name: 'OH' };
  const m = mountLines(demo);
  const e = rigEntry(index, demo);
  if (e.mounted) { assert.ok(index.includes(m.mounts[0]), 'already mounted: the lead has applied the lines'); return; }
  assert.ok(e.src.includes(`${"import { vantageColdStartRoutes } from '@/routes/vantageColdStart';"}\n${m.import}`));
  assert.ok(e.src.includes(`app.route('/vantage/api/coldstart', vantageColdStartRoutes);\n${m.mounts.join('\n')}`));
  assert.equal(e.src.split('\n').length, index.split('\n').length + 4, 'the header, the import and the two mounts, nothing else');
  assert.deepEqual(rigEntry(`${index}\n${m.mounts[0]}`, demo), { mounted: true });
  assert.throws(() => rigEntry('const app = 1;', demo), /is not there exactly once/);
});

test('the command line refuses a state directory that is not a rig\'s own, and from Windows it refuses to start', async () => {
  const out = [];
  assert.equal(await main(['--config', 'oh', '--port', '9120', '--state', '.wrangler/state'], { log: (l) => out.push(l), err: (l) => out.push(l) }), 2);
  assert.match(out.join('\n'), /a state directory of your own/);
  if (process.platform === 'win32') {
    const o2 = [];
    assert.equal(await main(['--config', 'oh', '--port', '9120', '--state', '.wrangler/state-x'], { log: (l) => o2.push(l), err: (l) => o2.push(l) }), 2);
    assert.match(o2.join('\n'), /run the rig from WSL/);
  }
  if (!existsSync(join(REPO_ROOT, '.dev.vars'))) return;   // the dry run reads the checkout's own .dev.vars (by name, never printing a value)
  const o3 = [];
  assert.equal(await main(['--config', 'oh', '--port', '9120', '--state', '.wrangler/state-x', '--dry-run'], { log: (l) => o3.push(l), err: (l) => o3.push(l) }), 0);
  assert.match(o3.join('\n'), /npx wrangler dev .*--port 9120 .*--persist-to \.wrangler\/state-x/);
  assert.doesNotMatch(o3.join('\n'), /provisioned":\[/, 'no value printed');
});

// ── The sign-in: IDENTITY_SECRETS for one launch (P3's beat 15 answers 503 on a rig without it) ─────────────────

/** A small demo, with or without a fictional sign-in account, scaffolded into a scratch root by new-demo itself. */
async function scratchDemo({ accounts }) {
  const root = mkdtempSync(join(tmpdir(), 'demo-kit-rig-'));
  mkdirSync(join(root, 'public', 'demo-kit'), { recursive: true });
  cpSync(join(REPO_ROOT, 'public', 'demo-kit', 'tokens.css'), join(root, 'public', 'demo-kit', 'tokens.css'));
  mkdirSync(join(root, 'src'), { recursive: true });
  cpSync(join(REPO_ROOT, 'src', 'index.ts'), join(root, 'src', 'index.ts'));
  mkdirSync(join(root, 'public', 'kx'), { recursive: true });
  const demo = {
    name: 'KX', slug: 'kx', tenant: 'kx', worker: { name: 'edge-platform-kx', queue: 'events-kx', devPort: 9199 },
    brand: { wordmark: 'KX', title: 'KX | a test demo' }, palette: { brand: '#123456', ink: '#111111', paper: '#FFFFFF' },
    dimensions: [{ key: 'category', values: ['a', 'b'] }], regional: { dimensions: ['category'] },
    pages: [{ key: 'home', page: 'home', entry: 'home', url: '/kx/', shell: 'index.html', slots: [{ slot: 'hero', take: 1, weights: { category: 1 } }] }],
    arrival: { utm_term: 'kx' },
    beats: { file: 'public/kx/beats.json', acts: { 1: 'Arrive' }, list: [{ key: 'arrive', no: '1', act: 1, who: 'shopper', kind: 'context', label: 'Arrive', press: 'lands', declare: ['d'], will: ['w'], line: 'l' }] },
    products: { file: 'public/kx/products.json', id: 'id', attributes: { category: 'category' } },
    region: { dimensions: ['category'], vocabulary: { category: ['a', 'b'] } },
    asserted: { intents: ['buy'] }, reportSlots: ['hero'],
    copy: { coldStartSentence: 'aggregate, never the individual.', scoredSentence: 'No census term enters any score.' },
    docs: { dir: 'docs/kx' },
    ...(accounts ? { flags: { signIn: { live: true, accounts: accounts.map((name) => ({ name })) } } } : {}),
  };
  const file = join(root, 'public', 'kx', 'demo.config.json');
  writeFileSync(file, JSON.stringify(demo));
  const code = await scaffold(['--config', file], { root, runBuilder: false, log: () => {}, err: () => {} });
  assert.equal(code, 0, 'the scratch demo scaffolds');
  writeFileSync(join(root, 'wrangler.kx.toml'), 'name = "edge-platform-kx"\n');   // the rig checks the worker config exists
  return root;
}
/** A .dev.vars that provisions another tenant only, with a salt that meets the enforced rule. */
const SAFE_SALT = 'salt-for-the-rig-test-0123456789-abcdefghijklmnop';
const otherTenantOnly = () => [
  `TENANTS=${JSON.stringify({ provisioned: ['vantage'], operatorGrants: { 'vantage-demo': ['vantage'] } })}`,
  'SDK_KEYS=vantage:demo-site',
  `RETENTION=${JSON.stringify({ version: 1, tenants: { vantage: Object.fromEntries(RETENTION_CATEGORIES.map((c) => [c, policies.ledger])) } })}`,
  `IDENTITY_SALT=${SAFE_SALT}`,
].join('\n');
/** Runs the rig's main with an injected runner, as Linux; returns the commands it ran and every line it printed. */
async function rigRun(root, devVarsText) {
  const ran = [], lines = [];
  const code = await main(['--config', 'kx', '--port', '9199', '--state', '.wrangler/state-kx'], {
    root, platform: 'linux', devVarsText, log: (l) => lines.push(l), err: (l) => lines.push(l),
    runner: async (c) => { ran.push(c); return 0; },
  });
  return { code, ran, lines };
}
const varOf = (args, name) => { const i = args.findIndex((a, j) => args[j - 1] === '--var' && a.startsWith(`${name}:`)); return i < 0 ? null : args[i].slice(name.length + 1); };

test('a demo that names sign-in accounts gets IDENTITY_SECRETS <tenant>:<secret>, new each launch and held to the enforced rule; one without gets none; no line carries it', async () => {
  const withAccounts = await scratchDemo({ accounts: ['Test Shopper'] });
  const a = await rigRun(withAccounts, otherTenantOnly());
  const b = await rigRun(withAccounts, otherTenantOnly());
  assert.equal(a.code, 0, a.lines.join('\n'));
  assert.equal(a.ran.length, 1, 'one command: wrangler dev');
  const value = varOf(a.ran[0].args, 'IDENTITY_SECRETS'), again = varOf(b.ran[0].args, 'IDENTITY_SECRETS');
  assert.match(value, /^kx:[0-9a-f]{64}$/, 'the shape the identity code reads: tenant:secret');
  const secret = value.slice(3);
  assert.equal(safeIdentitySecret(secret), true);
  // What secretsFor does under AUTH_MODE=enforced: validateIdentityMaterial over the provisioned tenants, here kx alone.
  const tenants = JSON.parse(varOf(a.ran[0].args, 'TENANTS')).provisioned;
  assert.deepEqual(tenants, ['kx']);
  assert.deepEqual(validateIdentityMaterial({ IDENTITY_SECRETS: value, IDENTITY_SALT: SAFE_SALT, AUTH_MODE: 'enforced', DEPLOYMENT_PROFILE: 'demo' }, tenants).get('kx'), [secret]);
  assert.notEqual(again, value, 'generated per launch');
  for (const run of [a, b]) {
    const printed = run.lines.join('\n');
    assert.ok(!printed.includes(secret) && !printed.includes(again.slice(3)), 'no log line carries the value');
    assert.match(printed, /--var IDENTITY_SECRETS:…/);
    assert.match(printed, /IDENTITY_SECRETS generated for this launch as kx:<secret>, for the sign-in of 1 demo account/);
  }
  assert.ok(!readdirSync(withAccounts, { recursive: true }).some((f) => /\.(json|ts|toml|mjs|md|html|js|css)$/.test(f) && readFileSync(join(withAccounts, f), 'utf8').includes(secret)), 'never written');

  const without = await scratchDemo({ accounts: null });
  const c = await rigRun(without, otherTenantOnly());
  assert.equal(c.code, 0, c.lines.join('\n'));
  assert.equal(varOf(c.ran[0].args, 'IDENTITY_SECRETS'), null, 'no sign-in, no identity secret');
  assert.ok(varOf(c.ran[0].args, 'TENANTS'), 'the tenant is still provisioned');
  assert.doesNotMatch(c.lines.join('\n'), /IDENTITY_SECRETS/);
});

test('when .dev.vars provisions the tenant: secrets that pass the enforced check for every tenant mean no override; secrets that fail it make the rig provision the tenant alone', () => {
  const good = (s) => `${s}-0123456789abcdefghijklmnopqrstuvwxyz`;
  const provisioning = (identity) => ({
    TENANTS: JSON.stringify({ provisioned: ['kx', 'vantage'], operatorGrants: { 'kx-demo': ['kx'], 'seed-kx': ['kx'], 'seed-kx-region': ['kx'] } }),
    SDK_KEYS: 'kx:demo-site,vantage:demo-site',
    RETENTION: JSON.stringify({ version: 1, tenants: { kx: policies, vantage: policies } }),
    IDENTITY_SALT: SAFE_SALT, ...(identity ? { IDENTITY_SECRETS: identity } : {}),
  });
  assert.deepEqual(rigVars(provisioning(`kx:${good('k')},vantage:${good('v')}`), { tenant: 'kx', slug: 'kx', signIn: true }), { provisioned: true, identitySalt: true });
  for (const identity of [null, 'kx:too-short', `kx:${good('k')}`]) {   // absent; unsafe; safe but missing the other tenant
    const r = rigVars(provisioning(identity), { tenant: 'kx', slug: 'kx', signIn: true });
    assert.equal(r.provisioned, false, String(identity));
    assert.match(r.why.join(), /IDENTITY_SECRETS gives kx no secret the enforced identity check accepts/);
    assert.deepEqual(JSON.parse(r.vars.TENANTS).provisioned, ['kx'], 'the tenant alone, so its one secret passes');
    assert.match(r.vars.IDENTITY_SECRETS, /^kx:[0-9a-f]{64}$/);
  }
  assert.equal(rigVars(provisioning(null), { tenant: 'kx', slug: 'kx' }).provisioned, true, 'a demo without sign-in needs no identity secret');
  assert.equal(rigVars({ ...provisioning(null), IDENTITY_SALT: 'short' }, { tenant: 'kx', slug: 'kx', signIn: true }).identitySalt, false);
  assert.throws(() => identitySecretsFor('kx', () => Buffer.alloc(32)), /could not generate an identity secret the worker accepts under AUTH_MODE=enforced/, 'the rule is kept: a degenerate secret is never used');
});

test('a salt that fails the enforced rule is named (never shown): the route would answer 503 until it is fixed', async () => {
  const root = await scratchDemo({ accounts: ['Test Shopper'] });
  const r = await rigRun(root, otherTenantOnly().replace(`IDENTITY_SALT=${SAFE_SALT}`, 'IDENTITY_SALT=weak'));
  assert.equal(r.code, 0);
  assert.match(r.lines.join('\n'), /! \.dev\.vars' IDENTITY_SALT does not meet the identity code's rule under AUTH_MODE=enforced .*answers 503/);
  assert.doesNotMatch(r.lines.join('\n'), /weak/);
});
