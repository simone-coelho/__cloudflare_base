// node --test scripts/demo-kit/lib/host.test.mjs
// The hosting command (scripts/demo-kit/host.mjs, lane H2): the derivations, the redaction, the dry run, the refusals and
// the step order. Every git, npm, npx, node, ln and unlink call goes to a recording fake runner and .dev.vars is a
// fixture, so nothing here touches the network, the cloud, the checkout or the machine's own secrets.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { jwtVerify } from 'jose';
import { parse as parseToml } from 'smol-toml';
import { loadConfig, REPO_ROOT } from './config.mjs';
import { RETENTION_CATEGORIES, devVars, rigVars } from '../rig.mjs';
import { parseIdentitySecrets, safeIdentitySecret } from '../../../src/identity/material.mjs';
import { readSigningConfig } from '../../../src/auth/signingConfig.mjs';
import {
  HOSTED_SECRETS, STEPS, createRedactor, generateSecret, heldSecretName, hostedSettings, migrationRecipe, missingQueues,
  pendingMigrations, porcelain, refusals, runHost, secretValues, shaPrefix, stepsToRun, versionOf, worktreeDir,
} from './host.mjs';

// ── Fixtures ────────────────────────────────────────────────────────────────

const policy = (c) => ({ id: `${c}-30d`, revision: 1, durationMs: 2_592_000_000, basis: 'occurred', renewal: 'new-record-only' });
const COMPLETE = Object.fromEntries(RETENTION_CATEGORIES.map((c) => [c, policy(c)]));
const DEV_VARS = [
  `TENANTS='${JSON.stringify({ provisioned: ['vantage'], hosts: {}, operatorGrants: { 'vantage-demo': ['vantage'] } })}'`,
  'SDK_KEYS=vantage:demo-site',
  `RETENTION=${JSON.stringify({ version: 1, tenants: { partial: { ledger: policy('ledger') }, vantage: COMPLETE } })}`,
  'JWT_SECRET=local-rig-signing-material-never-hosted-0123456789',
].join('\n');
const HELD = 'owner-kept-hosted-signing-material-abcdefghijklmnop-0123456789';
const SHA = '0123456789abcdef0123456789abcdef01234567';
const VERSION = 'aaaabbbb-cccc-4ddd-8eee-ffff00001111';
const NOW = Date.parse('2026-10-02T16:00:00Z');
const SCRATCH_DIR = '/scratch/host-oh-q1w2e3';
const SCRATCH = `${SCRATCH_DIR}/wrangler.oh.toml`;
const TOML_OH = readFileSync(join(REPO_ROOT, 'wrangler.oh.toml'));
const MIGRATIONS = ['0001_d1_init.sql', '0011_operator_audit_tenant.sql', '0012_operator_authority.sql', '0013_operator_oidc.sql'];

/** A deterministic `random`, recording every buffer it hands out so a test can look for the secrets made from them. */
function deterministic() {
  const made = [];
  let i = 0;
  const random = (n) => { const b = createHash('sha256').update(`host-test-${i += 1}`).digest().subarray(0, n); made.push(Buffer.from(b).toString('hex')); return b; };
  return { random, made };
}

/** A recording runner answering like a healthy remote; `over` maps a substring of the command line to an answer. */
function fakeRunner(over = {}) {
  const calls = [], linked = new Set(), seeded = new Set();
  const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
  const runner = async (c) => {
    calls.push(c);
    const line = [c.cmd, ...c.args].join(' ');
    for (const [needle, answer] of Object.entries(over)) {
      if (!line.includes(needle)) continue;
      const r = typeof answer === 'function' ? answer(c, calls) : answer;
      if (r) return { code: 0, stdout: '', stderr: '', ...r };
    }
    if (c.cmd === 'ln') linked.add(c.args[2].replace(/\/node_modules$/, ''));
    if (c.cmd === 'unlink') linked.delete(c.args[0].replace(/\/node_modules$/, ''));
    if (c.args[0] === 'scripts/demo-kit/seed.mjs') seeded.add(c.cwd);
    if (line.includes('rev-parse HEAD')) return ok(`${SHA}\n`);
    if (line.includes('show HEAD:src/index.ts')) return ok("app.route('/vantage/api', x);\napp.route('/oh/api', ohRoutes(x));\n");
    if (line.includes('ls-tree')) return ok([...MIGRATIONS.map((f) => `migrations/${f}`), 'migrations/product', 'migrations/seed'].join('\n'));
    if (line.includes('migrations list')) return ok('✅ No migrations to apply!\n');
    if (line.includes('queues list')) return ok('┌───┬──────────────┐\n│ id │ events-oh │\n│ id │ events-oh-dlq │\n│ id │ events-vantage │\n');
    if (line.includes('status --porcelain')) return ok(`${linked.has(c.cwd) ? '?? node_modules\n' : ''}${seeded.has(c.cwd) ? ' M public/oh/beats/anchor.json\n M public/oh/beats/open-catalog.json\n' : ''}`);
    if (/wrangler deploy/.test(line)) return ok(`Uploaded edge-platform-oh\nCurrent Version ID: ${VERSION}\n`);
    return ok('');
  };
  return { runner, calls };
}

async function host(argv, { runner = null, env = { WSL_DISTRO_NAME: 'Ubuntu' }, platform = 'linux', devVarsText = DEV_VARS, readBytes, random = deterministic().random } = {}) {
  const out = [], errs = [], removed = [];
  const io = {
    tmpdir: () => '/scratch', mkdtemp: (prefix) => { assert.equal(prefix, 'host-oh-'); return SCRATCH_DIR; },
    unlink: (p) => removed.push(p), rmdir: (p) => removed.push(p), devVars: () => devVarsText,
    readBytes: readBytes ?? ((p) => (p === SCRATCH ? TOML_OH : readFileSync(p))),
  };
  const code = await runHost(argv, { runner, env, platform, io, now: () => NOW, random, log: (l) => out.push(l), err: (l) => errs.push(l) });
  return { code, out: out.join('\n'), err: errs.join('\n'), all: [...out, ...errs].join('\n'), removed };
}
const neverRun = async (c) => { throw new Error(`the runner was called: ${c.cmd} ${c.args.join(' ')}`); };
/** Each call, named the way the step order is written. */
function kind(c) {
  const line = [c.cmd, ...c.args].join(' ');
  if (line.includes('check-demo.mjs') && line.includes('--skip suites')) return 'check-demo (no suites)';
  if (line.includes('check-demo.mjs')) return `check-demo suites (${c.cmd})`;
  if (line.includes('build-demo-worker-config.mjs')) return line.includes('--out') ? 'builder --out scratch' : 'builder';
  if (line.includes('secret put')) return `secret put ${c.args[3]}`;
  if (line.includes('worktree add')) return `worktree add ${c.args.at(-2).includes('-seed-') ? 'seed' : 'deploy'}`;
  if (line.includes('worktree remove')) return `worktree remove${line.includes('--force') ? ' --force' : ''}`;
  // R-P82 (P48.BP3): the hosted seed's one-time path, a runner call whose line names POST /ops/demo-bootstrap/complete, right after the seed.
  for (const [needle, name] of [['ops/demo-bootstrap/complete', 'bootstrap complete'], ['rev-parse', 'rev-parse'], ['show HEAD:src/index.ts', 'show index'], ['ls-tree', 'ls-tree'], ['migrations list', 'migrations list'],
    ['queues list', 'queues list'], ['status --porcelain', 'status'], ['check:generated', 'check:generated'], ['triggers deploy', 'triggers deploy'],
    ['wrangler deploy', 'deploy'], ['region-seed.mjs', 'region-seed'], ['seed.mjs', 'seed']]) if (line.includes(needle)) return name;
  return c.cmd;
}
const ohConfig = () => loadConfig(join(REPO_ROOT, 'scripts', 'demo-kit', 'configs', 'oh.json')).config;
const ohToml = () => parseToml(TOML_OH.toString('utf8'));
const sharedToml = () => parseToml(readFileSync(join(REPO_ROOT, 'wrangler.toml'), 'utf8'));

// ── The derivations ─────────────────────────────────────────────────────────

test('TENANTS, SDK_KEYS and RETENTION are derived as rig.mjs derives them; the tenant\'s own complete policies first; an incomplete set is refused', () => {
  const vars = devVars(DEV_VARS);
  const h = hostedSettings(vars, { tenant: 'oh', slug: 'oh' });
  const rig = rigVars(vars, { tenant: 'oh', slug: 'oh' });
  assert.equal(rig.provisioned, false);
  assert.equal(h.TENANTS, rig.vars.TENANTS, 'the same TENANTS the rig passes as --var');
  assert.equal(h.SDK_KEYS, rig.vars.SDK_KEYS);
  assert.equal(h.RETENTION, rig.vars.RETENTION);
  assert.deepEqual(JSON.parse(h.TENANTS), { provisioned: ['oh'], operatorGrants: { 'oh-demo': ['oh'], 'seed-oh': ['oh'], 'seed-oh-region': ['oh'] } });
  assert.equal(h.SDK_KEYS, 'oh:demo-site');
  assert.deepEqual(JSON.parse(h.RETENTION), { version: 1, tenants: { oh: COMPLETE } });
  assert.equal(h.retentionFrom, 'vantage', 'the first tenant whose policies cover all seven categories, skipping the partial one');
  const own = { ...COMPLETE, ledger: { ...COMPLETE.ledger, id: 'ledger-own' } };
  const withOwn = devVars(`RETENTION=${JSON.stringify({ version: 1, tenants: { vantage: COMPLETE, oh: own } })}`);
  assert.equal(hostedSettings(withOwn, { tenant: 'oh', slug: 'oh' }).retentionFrom, 'oh');
  assert.deepEqual(JSON.parse(hostedSettings(withOwn, { tenant: 'oh', slug: 'oh' }).RETENTION).tenants.oh.ledger.id, 'ledger-own');
  assert.throws(() => hostedSettings(devVars(`RETENTION=${JSON.stringify({ version: 1, tenants: { partial: { ledger: policy('ledger') } } })}`), { tenant: 'oh', slug: 'oh' }), /all seven retained categories/);
  assert.throws(() => hostedSettings({}, { tenant: 'oh', slug: 'oh' }), /RETENTION/);
});

test('the six secrets, in order: three derived, three generated with crypto (or the owner\'s kept JWT secret), each one the worker accepts', () => {
  const { random } = deterministic();
  const v = secretValues({ devVarsText: DEV_VARS, env: {}, tenant: 'oh', slug: 'oh', random });
  assert.deepEqual(v.map((s) => s.name), [...HOSTED_SECRETS]);
  assert.deepEqual(HOSTED_SECRETS, ['TENANTS', 'SDK_KEYS', 'RETENTION', 'JWT_SECRET', 'IDENTITY_SALT', 'IDENTITY_SECRETS']);
  const by = Object.fromEntries(v.map((s) => [s.name, s]));
  assert.equal(by.JWT_SECRET.held, false);
  assert.ok(readSigningConfig({ JWT_SECRET: by.JWT_SECRET.value, JWT_ISSUER: 'edge-platform', JWT_AUDIENCE: 'edge-platform-api' }), 'signing material the worker accepts');
  assert.ok(safeIdentitySecret(by.IDENTITY_SALT.value), 'an identity salt the worker accepts under AUTH_MODE enforced');
  const table = parseIdentitySecrets(by.IDENTITY_SECRETS.value, true);
  assert.deepEqual([...table.keys()], ['oh'], 'IDENTITY_SECRETS is oh:<secret>, safe');
  assert.equal(new Set([by.JWT_SECRET.value, by.IDENTITY_SALT.value, table.get('oh')[0]]).size, 3, 'three different secrets');
  assert.notEqual(by.JWT_SECRET.value, devVars(DEV_VARS).JWT_SECRET, 'never the local rig\'s signing material');
  assert.ok(v.every((s) => !s.source.includes(s.value)), 'a source sentence never carries its value');
  // The owner's kept secret: the environment first, then .dev.vars.
  assert.equal(heldSecretName('oh'), 'OH_REMOTE_JWT_SECRET');
  assert.equal(heldSecretName('top-offers'), 'TOP_OFFERS_REMOTE_JWT_SECRET');
  const fromEnv = secretValues({ devVarsText: `${DEV_VARS}\nOH_REMOTE_JWT_SECRET=${HELD}x`, env: { OH_REMOTE_JWT_SECRET: HELD }, tenant: 'oh', slug: 'oh', random });
  assert.equal(fromEnv[3].value, HELD);
  assert.equal(fromEnv[3].held, true);
  assert.match(fromEnv[3].source, /OH_REMOTE_JWT_SECRET, from the environment/);
  const fromFile = secretValues({ devVarsText: `${DEV_VARS}\nOH_REMOTE_JWT_SECRET='${HELD}'`, env: {}, tenant: 'oh', slug: 'oh', random });
  assert.equal(fromFile[3].value, HELD);
  assert.match(fromFile[3].source, /from \.dev\.vars/);
  assert.throws(() => secretValues({ devVarsText: DEV_VARS, env: { OH_REMOTE_JWT_SECRET: 'too-short' }, tenant: 'oh', slug: 'oh', random }), /not signing material/);
  assert.equal(generateSecret(random).length, 64);
});

test('redaction: every held value, raw or JSON-escaped, is replaced by its label in any line', () => {
  const r = createRedactor();
  const tenants = JSON.stringify({ provisioned: ['oh'] });
  r.hold('TENANTS', tenants);
  r.hold('JWT_SECRET', HELD);
  r.hold('short', 'abc');
  assert.equal(r.text(`a ${HELD} b`), 'a ‹JWT_SECRET› b');
  assert.equal(r.text(`raw ${tenants} escaped ${JSON.stringify(tenants)}`), 'raw ‹TENANTS› escaped "‹TENANTS›"');
  assert.equal(r.text('abc stays'), 'abc stays', 'a value too short to be a secret is not held');
  assert.equal(shaPrefix(HELD), createHash('sha256').update(HELD).digest('hex').slice(0, 8));
});

test('the readers: pending migrations, missing queues, the version id, porcelain, the scratch-copy recipe, the worktree name', () => {
  assert.deepEqual(pendingMigrations('✅ No migrations to apply!', MIGRATIONS), []);
  assert.deepEqual(pendingMigrations('Migrations to be applied:\n│ 0013_operator_oidc.sql │\n│ 0012_operator_authority.sql │\n│ 0099_uncommitted.sql │', MIGRATIONS), ['0012_operator_authority.sql', '0013_operator_oidc.sql'], 'committed ones only, in file order');
  assert.equal(pendingMigrations('something else entirely', MIGRATIONS), null, 'an output it cannot read stops the step');
  assert.deepEqual(missingQueues('│ events-oh-dlq │', ['events-oh', 'events-oh-dlq']), ['events-oh'], 'events-oh-dlq is not events-oh');
  assert.deepEqual(missingQueues('│ events-oh │\n│ events-oh-dlq │', ['events-oh', 'events-oh-dlq']), []);
  assert.equal(versionOf(`Deployed\nCurrent Version ID: ${VERSION}\n`), VERSION);
  assert.equal(versionOf('nothing'), null);
  assert.deepEqual(porcelain(' M public/oh/beats/anchor.json\n?? node_modules\nR  a -> b\n'), [{ code: ' M', path: 'public/oh/beats/anchor.json' }, { code: '??', path: 'node_modules' }, { code: 'R ', path: 'b' }]);
  assert.deepEqual(migrationRecipe({ database: 'coach-demo-db', file: '0012_operator_authority.sql', workerConfig: 'wrangler.oh.toml' }), [
    'git show HEAD:migrations/0012_operator_authority.sql > /tmp/remote-0012_operator_authority.sql',
    `printf '\\nINSERT INTO "d1_migrations" (name) VALUES (%s);\\n' "'0012_operator_authority.sql'" >> /tmp/remote-0012_operator_authority.sql`,
    'npx wrangler d1 execute coach-demo-db --remote --file /tmp/remote-0012_operator_authority.sql --config wrangler.oh.toml',
  ]);
  assert.equal(worktreeDir('oh', 'seed', NOW), '/tmp/edge-host-oh-seed-20261002T160000Z');
});

test('the steps: all six in order, one with --step, one and those after it with --from', () => {
  assert.deepEqual(STEPS, ['preflight', 'secrets', 'database', 'deploy', 'seed', 'verify']);
  assert.deepEqual(stepsToRun(), STEPS);
  assert.deepEqual(stepsToRun({ step: 'seed' }), ['seed']);
  assert.deepEqual(stepsToRun({ from: 'database' }), ['database', 'deploy', 'seed', 'verify']);
  assert.throws(() => stepsToRun({ step: 'seed', from: 'deploy' }), /give one/);
  assert.throws(() => stepsToRun({ step: 'publish' }), /no step "publish"/);
});

// ── The refusals ────────────────────────────────────────────────────────────

test('the refusals: never the shared worker nor a customer stamp, never wrangler.toml, only the demo\'s own worker, profile and queues', () => {
  const config = ohConfig(), toml = ohToml(), shared = sharedToml();
  const r = (c, t, wc = 'wrangler.oh.toml') => refusals({ config: c, workerConfig: wc, toml: t, sharedToml: shared }).join('\n');
  assert.deepEqual(refusals({ config, workerConfig: 'wrangler.oh.toml', toml, sharedToml: shared }), [], 'OH as it stands is hostable');
  const withWorker = (name) => ({ ...config, worker: { ...config.worker, name } });
  assert.match(r(withWorker('edge-platform'), { ...toml, name: 'edge-platform' }), /edge-platform is the SHARED demo worker/);
  assert.match(r(withWorker('edge-platform-staging'), toml), /edge-platform-staging is the customer staging stamp/);
  assert.match(r(withWorker('edge-platform-production'), toml), /edge-platform-production is the customer production stamp/);
  assert.match(refusals({ config, workerConfig: 'wrangler.oh.toml', toml: { ...toml, name: 'acme-stamp' }, sharedToml: { name: 'edge-platform', env: { acme: { name: 'acme-stamp' } } } }).join('\n'), /acme-stamp is the customer acme stamp of wrangler\.toml/, 'a stamp is read from wrangler.toml\'s own environments');
  assert.match(r(withWorker('edge-platform-vantage'), toml), /is not edge-platform-oh/);
  assert.match(r(config, toml, 'wrangler.toml'), /wrangler\.toml, the shared worker's/);
  assert.match(r(config, toml, 'wrangler.other.toml'), /not wrangler\.oh\.toml/);
  assert.match(r(config, { ...toml, name: 'edge-platform-vantage' }), /names the worker edge-platform-vantage, not edge-platform-oh/);
  assert.match(r(config, { ...toml, env: { staging: {} } }), /\[env\.\*\] sections \(staging\)/);
  assert.match(r(config, { ...toml, vars: { ...toml.vars, DEPLOYMENT_PROFILE: 'customer' } }), /DEPLOYMENT_PROFILE "customer", not "demo"/);
  assert.match(r(config, { ...toml, queues: { ...toml.queues, producers: [{ queue: 'events', binding: 'EVENT_QUEUE' }] } }), /names the queue events, not one of this demo's own/);
  assert.match(r({ ...config, seed: { ...config.seed, operator: 'seed-vantage' } }, toml), /seed\.operator "seed-vantage" is not one of the operators/);
  assert.match(r(config, null), /does not exist or does not parse/);
});

test('a run is refused before anything runs: no --confirm, the wrong worker, from Windows, an unknown or doubled step, an --only outside the secrets', async () => {
  const cases = [
    [['--config', 'oh'], /--confirm edge-platform-oh is required/],
    [['--config', 'oh', '--confirm', 'edge-platform-vantage'], /--confirm edge-platform-oh is required/],
    [['--config', 'oh', '--step', 'deploy'], /--confirm edge-platform-oh is required/],
    [['--config', 'oh', '--step', 'seed', '--from', 'deploy', '--confirm', 'edge-platform-oh'], /give one/],
    [['--config', 'oh', '--step', 'launch', '--confirm', 'edge-platform-oh'], /no step "launch"/],
    [['--config', 'oh', '--only', 'AWS_KEY', '--confirm', 'edge-platform-oh'], /--only AWS_KEY: the secrets are/],
    [['--config', 'oh', '--step', 'deploy', '--only', 'TENANTS', '--confirm', 'edge-platform-oh'], /must include the secrets step/],
    [['--config', 'no-such-demo', '--dry-run'], /no such file/],
  ];
  for (const [argv, why] of cases) {
    const r = await host(argv, { runner: neverRun });
    assert.equal(r.code, 2, argv.join(' '));
    assert.match(r.all, why, argv.join(' '));
  }
  const win = await host(['--config', 'oh', '--confirm', 'edge-platform-oh'], { runner: neverRun, platform: 'win32' });
  assert.equal(win.code, 2);
  assert.match(win.all, /run it from WSL/);
  const pre = fakeRunner();
  assert.equal((await host(['--config', 'oh', '--step', 'preflight'], { runner: pre.runner })).code, 0, 'preflight alone reads and changes nothing in the cloud, so it needs no --confirm');
  assert.ok(pre.calls.every((c) => !['npx'].includes(c.cmd)), 'and calls no wrangler');
});

// ── The dry run ─────────────────────────────────────────────────────────────

test('a dry run prints every step in order with its commands, runs nothing, and prints no value', async () => {
  const det = deterministic();
  const r = await host(['--config', 'oh', '--dry-run'], { runner: neverRun, random: det.random, platform: 'win32', env: {} });
  assert.equal(r.code, 0, r.all);
  const headers = [...r.out.matchAll(/━━ (\d)\/6 (\w+):/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(headers, ['1 preflight', '2 secrets', '3 database', '4 deploy', '5 seed', '6 verify']);
  for (const line of [
    'DRY RUN: nothing is run, nothing is sent, every value redacted',
    '$ node scripts/demo-kit/check-demo.mjs --config oh --skip suites',
    '$ node scripts/build-demo-worker-config.mjs --name edge-platform-oh --queue events-oh --dev-port 9120 --out /scratch/host-oh-XXXXXX/wrangler.oh.toml',
    '$ git -c core.autocrlf=input show HEAD:src/index.ts',
    ...HOSTED_SECRETS.map((n) => `$ npx wrangler secret put ${n} --config wrangler.oh.toml  < stdin: ${n} (sha256 `),
    '$ npx wrangler d1 migrations list coach-demo-db --remote --config wrangler.oh.toml',
    'npx wrangler d1 execute coach-demo-db --remote --file /tmp/remote-<file>.sql --config wrangler.oh.toml',
    '$ npx wrangler queues list',
    '$ git -c core.autocrlf=input worktree add --detach /tmp/edge-host-oh-deploy-20261002T160000Z HEAD',
    '/node_modules /tmp/edge-host-oh-deploy-20261002T160000Z/node_modules',
    '$ (in /tmp/edge-host-oh-deploy-20261002T160000Z) npm run check:generated',
    '$ (in /tmp/edge-host-oh-deploy-20261002T160000Z) npx wrangler deploy --config wrangler.oh.toml',
    '$ (in /tmp/edge-host-oh-deploy-20261002T160000Z) npx wrangler triggers deploy --config wrangler.oh.toml',
    '$ unlink /tmp/edge-host-oh-deploy-20261002T160000Z/node_modules',
    '$ git -c core.autocrlf=input worktree remove /tmp/edge-host-oh-deploy-20261002T160000Z',
    'OPERATOR_TOKEN=‹a 30-minute operator token for seed-oh› node scripts/demo-kit/seed.mjs --config oh --base https://edge-platform-oh.expedge.workers.dev',
    'A reseed is always followed by a deploy.',
    'OPERATOR_TOKEN=‹a 30-minute operator token for seed-oh-region› node scripts/demo-kit/region-seed.mjs --config oh --base https://edge-platform-oh.expedge.workers.dev',
    '$ git -c core.autocrlf=input worktree remove --force /tmp/edge-host-oh-seed-20261002T160000Z',
    '$ node.exe scripts/demo-kit/check-demo.mjs --config oh --base https://edge-platform-oh.expedge.workers.dev --skip generated,typecheck,credentials',
    'https://edge-platform-oh.expedge.workers.dev/oh/',
  ]) assert.ok(r.out.includes(line), `the dry run prints: ${line}`);
  // In the seed step: the seed, then the redeploy, then the region seed.
  const seedPart = r.out.slice(r.out.indexOf('━━ 5/6'), r.out.indexOf('━━ 6/6'));
  const at = (s) => seedPart.indexOf(s);
  assert.ok(at('demo-kit/seed.mjs') < at('A reseed is always followed') && at('A reseed is always followed') < at('npx wrangler deploy') && at('npx wrangler deploy') < at('region-seed.mjs'));
  // No value: not the derived ones, not the generated ones, not the local rig's.
  const derived = hostedSettings(devVars(DEV_VARS), { tenant: 'oh', slug: 'oh' });
  for (const v of [derived.TENANTS, derived.SDK_KEYS, derived.RETENTION, ...det.made, devVars(DEV_VARS).JWT_SECRET]) assert.ok(!r.all.includes(v), 'no value in a dry run\'s output');
  assert.equal(det.made.length, 3, 'JWT_SECRET, IDENTITY_SALT and IDENTITY_SECRETS generated');
  for (const hex of det.made) assert.ok(r.out.includes(`sha256 ${shaPrefix(hex)}`) || r.out.includes(`sha256 ${shaPrefix(`oh:${hex}`)}`), 'each shown by its sha256 prefix only');
  assert.match(r.out, /JWT_SECRET was generated by this run and is held only in its memory/);
});

test('a dry run of Vantage shows the owner\'s kept JWT secret by name and prefix, never by value', async () => {
  const r = await host(['--config', 'vantage', '--dry-run'], { runner: neverRun, env: { VANTAGE_REMOTE_JWT_SECRET: HELD } });
  assert.equal(r.code, 0, r.all);
  assert.match(r.out, new RegExp(`JWT_SECRET +sha256 ${shaPrefix(HELD)}… +the owner's VANTAGE_REMOTE_JWT_SECRET, from the environment`));
  assert.ok(!r.all.includes(HELD));
  assert.doesNotMatch(r.out, /held only in its memory/);
  assert.match(r.out, /secret put TENANTS --config wrangler\.vantage\.toml/);
  assert.match(r.out, /https:\/\/edge-platform-vantage\.expedge\.workers\.dev\/vantage\//);
  assert.match(r.out, /seed-vantage-region› node scripts\/demo-kit\/region-seed\.mjs --config vantage/);
});

// ── A full run, on the fake runner ──────────────────────────────────────────

test('a full run takes the steps in order; every secret goes through stdin only, none reaches an argument or a printed line; the tokens are minted from the secret it put', async () => {
  const fake = fakeRunner();
  const r = await host(['--config', 'oh', '--confirm', 'edge-platform-oh'], { runner: fake.runner });
  assert.equal(r.code, 0, r.all);
  assert.deepEqual(fake.calls.map(kind), [
    'check-demo (no suites)', 'builder --out scratch', 'rev-parse', 'show index',
    ...HOSTED_SECRETS.map((n) => `secret put ${n}`),
    'ls-tree', 'migrations list', 'queues list',
    'worktree add deploy', 'ln', 'check:generated', 'builder', 'status', 'deploy', 'triggers deploy', 'unlink', 'status', 'worktree remove',
    'worktree add seed', 'ln', 'check:generated', 'builder', 'status', 'seed', 'bootstrap complete', 'deploy', 'region-seed', 'unlink', 'status', 'worktree remove --force',
    'check-demo suites (node.exe)',
  ]);
  const puts = fake.calls.filter((c) => c.args.includes('secret'));
  const values = puts.map((c) => c.input);
  assert.equal(values.length, 6);
  assert.ok(values.every((v) => typeof v === 'string' && v.length >= 12), 'each secret arrives as stdin');
  for (const c of fake.calls) for (const v of values) assert.ok(!c.args.some((a) => a.includes(v)), `no secret in the arguments of ${c.cmd} ${c.args.join(' ')}`);
  for (const c of fake.calls) for (const v of values) assert.ok(!Object.values(c.env ?? {}).some((e) => e.includes(v)), 'no secret in a child\'s environment');
  for (const v of values) assert.ok(!r.all.includes(v), 'no secret in any printed line');
  assert.ok(fake.calls.filter((c) => c.input !== undefined).every((c) => c.args.includes('secret')), 'stdin carries nothing but the secrets');
  // The worktrees: made by WSL git with LF endings, node_modules linked, every deploy and seed run inside one.
  const adds = fake.calls.filter((c) => kind(c).startsWith('worktree add'));
  for (const a of adds) assert.deepEqual(a.args.slice(0, 5), ['-c', 'core.autocrlf=input', 'worktree', 'add', '--detach']);
  assert.ok(adds.every((a) => a.args.at(-1) === SHA), 'both worktrees are of the same head, read once');
  const [deployWt, seedWt] = adds.map((a) => a.args.at(-2));
  assert.ok(deployWt.startsWith('/tmp/edge-host-oh-deploy-') && seedWt.startsWith('/tmp/edge-host-oh-seed-'));
  for (const c of fake.calls.filter((x) => ['deploy', 'triggers deploy', 'check:generated', 'builder'].includes(kind(x)))) assert.ok([deployWt, seedWt].includes(c.cwd), `${kind(c)} runs in a worktree`);
  for (const c of fake.calls.filter((x) => ['seed', 'region-seed'].includes(kind(x)))) assert.equal(c.cwd, seedWt);
  const lns = fake.calls.filter((c) => c.cmd === 'ln');
  assert.ok(lns.every((c) => c.args[0] === '-s' && c.args[1].endsWith('/node_modules') && [deployWt, seedWt].includes(c.args[2].replace(/\/node_modules$/, ''))));
  assert.deepEqual(fake.calls.filter((c) => c.cmd === 'unlink').map((c) => c.args), [[`${deployWt}/node_modules`], [`${seedWt}/node_modules`]], 'the links themselves, before each removal');
  // The tokens: minted here from the JWT_SECRET this run put, for the config's two operators, passed in the environment.
  const jwt = puts.find((c) => c.args[3] === 'JWT_SECRET').input;
  const toml = ohToml();
  for (const [k, sub] of [['seed', 'seed-oh'], ['region-seed', 'seed-oh-region']]) {
    const c = fake.calls.find((x) => kind(x) === k);
    const token = c.env.OPERATOR_TOKEN;
    assert.ok(!c.args.includes('--token') && !c.args.includes(token), 'the token is never an argument');
    assert.deepEqual(c.args.slice(1), ['--config', 'oh', '--base', 'https://edge-platform-oh.expedge.workers.dev']);
    const { payload } = await jwtVerify(token, new TextEncoder().encode(jwt), { issuer: toml.vars.JWT_ISSUER, audience: toml.vars.JWT_AUDIENCE });
    assert.equal(payload.sub, sub);
    assert.deepEqual(payload.roles, ['operator']);
    assert.ok(payload.exp - payload.iat <= 1800, 'thirty minutes at most');
    assert.ok(!r.all.includes(token), 'no token in any printed line');
  }
  const builderOut = fake.calls.find((c) => kind(c) === 'builder --out scratch').args;
  assert.equal(builderOut.at(-1), SCRATCH, 'the comparison copy keeps the real file name, because the builder\'s header names the file it writes');
  assert.deepEqual(r.removed, [SCRATCH, SCRATCH_DIR], 'and it is removed with its scratch directory');
  assert.match(r.out, new RegExp(`version ${VERSION}, from ${SHA}`));
  assert.match(r.out, /✓ preflight, secrets, database, deploy, seed, verify passed/);
  assert.match(r.out, /https:\/\/edge-platform-oh\.expedge\.workers\.dev\/oh\//);
  assert.ok(fake.calls.every((c) => !/d1 execute|queues create|migrations apply/.test(c.args.join(' '))), 'never applies a migration nor creates a queue');
});

test('it stops at the first failing step and names it: a migration the remote lacks prints the owner\'s recipe and deploys nothing', async () => {
  const fake = fakeRunner({ 'migrations list': { stdout: 'Migrations to be applied:\n│ 0012_operator_authority.sql │\n│ 0013_operator_oidc.sql │\n' } });
  const r = await host(['--config', 'oh', '--confirm', 'edge-platform-oh'], { runner: fake.runner });
  assert.equal(r.code, 1);
  assert.match(r.err, /✗ stopped at step 3\/6, database:/);
  assert.match(r.out, /git show HEAD:migrations\/0012_operator_authority\.sql > \/tmp\/remote-0012_operator_authority\.sql/);
  assert.ok(r.out.indexOf('remote-0012_') < r.out.indexOf('remote-0013_'), 'in order');
  assert.match(r.out, /npx wrangler d1 execute coach-demo-db --remote --file \/tmp\/remote-0013_operator_oidc\.sql --config wrangler\.oh\.toml/);
  assert.equal(kind(fake.calls.at(-1)), 'queues list', 'nothing after the database step');
  assert.ok(!fake.calls.some((c) => /d1 execute/.test(c.args.join(' '))), 'the recipe is printed, never run');

  const q = fakeRunner({ 'queues list': { stdout: '│ events-oh │\n' } });
  const rq = await host(['--config', 'oh', '--from', 'database', '--confirm', 'edge-platform-oh'], { runner: q.runner, env: { WSL_DISTRO_NAME: 'Ubuntu', OH_REMOTE_JWT_SECRET: HELD } });
  assert.equal(rq.code, 1);
  assert.match(rq.out, /npx wrangler queues create events-oh-dlq/);
  assert.doesNotMatch(rq.out, /queues create events-oh\n/);
});

test('a failure inside a worktree still unlinks node_modules and removes the worktree, and goes no further', async () => {
  const fake = fakeRunner({ 'wrangler deploy': (c) => (c.cwd.includes('-deploy-') ? { code: 1, stderr: 'Queue events-oh does not exist' } : null) });
  const r = await host(['--config', 'oh', '--from', 'deploy', '--confirm', 'edge-platform-oh'], { runner: fake.runner, env: { WSL_DISTRO_NAME: 'Ubuntu', OH_REMOTE_JWT_SECRET: HELD } });
  assert.equal(r.code, 1);
  assert.match(r.err, /✗ stopped at step 4\/6, deploy: wrangler deploy failed/);
  assert.deepEqual(fake.calls.map(kind).slice(-4), ['deploy', 'unlink', 'status', 'worktree remove']);
  assert.ok(!fake.calls.some((c) => ['seed', 'region-seed', 'triggers deploy'].includes(kind(c))));
});

test('preflight stops on a worker config the builder would not write, and on a head that does not mount the demo\'s routes', async () => {
  const stale = fakeRunner();
  const r1 = await host(['--config', 'oh', '--confirm', 'edge-platform-oh'], { runner: stale.runner, readBytes: (p) => (p === SCRATCH ? Buffer.from('# another file\n') : readFileSync(p)) });
  assert.equal(r1.code, 1);
  assert.match(r1.err, /stopped at step 1\/6, preflight: wrangler\.oh\.toml is not byte-equal to the builder's output/);
  assert.ok(!stale.calls.some((c) => c.args.includes('secret')), 'no secret put after a failed preflight');
  const unmounted = fakeRunner({ 'show HEAD:src/index.ts': { stdout: "app.route('/vantage/api', x);\n" } });
  const r2 = await host(['--config', 'oh', '--confirm', 'edge-platform-oh'], { runner: unmounted.runner });
  assert.equal(r2.code, 1);
  assert.match(r2.err, new RegExp(`the branch head ${SHA} does not mount /oh/api`));
  const failing = fakeRunner({ 'check-demo.mjs': { code: 1 } });
  assert.match((await host(['--config', 'oh', '--confirm', 'edge-platform-oh'], { runner: failing.runner })).err, /stopped at step 1\/6, preflight: check-demo --skip suites failed/);
});

test('each step runs alone: the seed needs the JWT secret of the same run or the owner\'s kept one; --only puts just the secrets named', async () => {
  const none = fakeRunner();
  const r1 = await host(['--config', 'oh', '--step', 'seed', '--confirm', 'edge-platform-oh'], { runner: none.runner });
  assert.equal(r1.code, 1);
  assert.match(r1.err, /stopped at step 5\/6, seed: no JWT secret for edge-platform-oh in this process/);
  assert.equal(none.calls.length, 0, 'it stops before making a worktree');

  const kept = fakeRunner();
  const r2 = await host(['--config', 'oh', '--step', 'seed', '--confirm', 'edge-platform-oh'], { runner: kept.runner, devVarsText: `${DEV_VARS}\nOH_REMOTE_JWT_SECRET=${HELD}` });
  assert.equal(r2.code, 0, r2.all);
  assert.deepEqual(kept.calls.map(kind), ['rev-parse', 'worktree add seed', 'ln', 'check:generated', 'builder', 'status', 'seed', 'bootstrap complete', 'deploy', 'region-seed', 'unlink', 'status', 'worktree remove --force']);
  const token = kept.calls.find((c) => kind(c) === 'seed').env.OPERATOR_TOKEN;
  assert.equal((await jwtVerify(token, new TextEncoder().encode(HELD), { issuer: 'edge-platform', audience: 'edge-platform-api' })).payload.sub, 'seed-oh');
  assert.ok(!r2.all.includes(HELD) && !r2.all.includes(token));

  const one = fakeRunner();
  const r3 = await host(['--config', 'oh', '--step', 'secrets', '--only', 'IDENTITY_SECRETS', '--confirm', 'edge-platform-oh'], { runner: one.runner });
  assert.equal(r3.code, 0, r3.all);
  assert.deepEqual(one.calls.map(kind), ['secret put IDENTITY_SECRETS']);

  const verify = fakeRunner();
  assert.equal((await host(['--config', 'oh', '--step', 'verify', '--confirm', 'edge-platform-oh'], { runner: verify.runner, env: {} })).code, 0);
  assert.deepEqual(verify.calls.map(kind), ['check-demo suites (node)'], 'outside WSL the suites run on this node');
  const noExe = fakeRunner({ 'check-demo.mjs': { code: 127 } });
  assert.match((await host(['--config', 'oh', '--step', 'verify', '--confirm', 'edge-platform-oh'], { runner: noExe.runner })).err, /node\.exe did not start from WSL; run it from Windows: node scripts\/demo-kit\/check-demo\.mjs --config oh/);
});

test('the seed\'s worktree is left, not forced, when it holds a change no step made', async () => {
  const fake = fakeRunner({ 'status --porcelain': (c, calls) => (calls.some((x) => kind(x) === 'region-seed') ? { stdout: ' M public/oh/beats/anchor.json\n M src/index.ts\n' } : null) });
  const r = await host(['--config', 'oh', '--step', 'seed', '--confirm', 'edge-platform-oh'], { runner: fake.runner, env: { WSL_DISTRO_NAME: 'Ubuntu', OH_REMOTE_JWT_SECRET: HELD } });
  assert.equal(r.code, 0, 'the seed itself passed');
  assert.match(r.out, /holds changes no step made \(M src\/index\.ts\): left for you to inspect/);
  assert.ok(!fake.calls.some((c) => kind(c).startsWith('worktree remove')));
});

test('a child that echoes what it was given is redacted: a failing secret put\'s output, a seed\'s streamed lines', async () => {
  const fake = fakeRunner({
    'secret put IDENTITY_SALT': (c) => ({ code: 1, stderr: `✘ could not store ${c.input} for edge-platform-oh` }),
  });
  const r = await host(['--config', 'oh', '--step', 'secrets', '--confirm', 'edge-platform-oh'], { runner: fake.runner });
  assert.equal(r.code, 1);
  const salt = fake.calls.find((c) => c.args[3] === 'IDENTITY_SALT').input;
  assert.match(r.out, /could not store ‹IDENTITY_SALT› for edge-platform-oh/, 'the child\'s output is shown, its secret replaced');
  assert.ok(!r.all.includes(salt));
  assert.match(r.err, /stopped at step 2\/6, secrets: wrangler secret put IDENTITY_SALT failed/);

  const echo = fakeRunner({ 'seed.mjs': (c) => { c.onLine?.(`using ${c.env.OPERATOR_TOKEN} against ${HELD}`); return null; } });
  const r2 = await host(['--config', 'oh', '--step', 'seed', '--confirm', 'edge-platform-oh'], { runner: echo.runner, env: { WSL_DISTRO_NAME: 'Ubuntu', OH_REMOTE_JWT_SECRET: HELD } });
  assert.equal(r2.code, 0, r2.all);
  const token = echo.calls.find((c) => kind(c) === 'seed').env.OPERATOR_TOKEN;
  assert.match(r2.out, /using ‹operator token for seed-oh› against ‹JWT_SECRET›/);
  assert.ok(!r2.all.includes(token) && !r2.all.includes(HELD));
});
