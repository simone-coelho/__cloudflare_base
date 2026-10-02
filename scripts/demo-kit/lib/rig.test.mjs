// node --test scripts/demo-kit/lib/rig.test.mjs
// The local rig (scripts/demo-kit/rig.mjs, lane K4): a demo's tenant provisioned for one wrangler dev process without
// writing .dev.vars, its values never printed; the routes mounted on a copy of src/index.ts until the lead applies
// the printed lines; the command line it runs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './config.mjs';
import { mountLines } from './scaffold.mjs';
import { devVars, main, rigCommand, rigEntry, rigVars } from '../rig.mjs';

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
