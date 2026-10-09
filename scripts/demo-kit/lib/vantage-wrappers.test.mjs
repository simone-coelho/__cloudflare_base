// node --test scripts/demo-kit/lib/vantage-wrappers.test.mjs
// Vantage's own scripts are thin wrappers over the kit's command lines since part b, and the commands
// docs/verizon/RESUME-vantage.md and docs/demos/BOOTSTRAP.md write keep working. Each wrapper runs here as
// a process, from the repository root, on its offline paths: no worker, no network, no operator credential
// in reach, and nothing written under public/ (the seed writes into a temporary --out).
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO_ROOT } from './config.mjs';
import { relativeTimestamps } from './seed.mjs';

const SCRUBBED = ['OPERATOR_TOKEN', 'JWT_SECRET', 'JWT_ISSUER', 'JWT_AUDIENCE', 'DEPLOYMENT_PROFILE', 'VANTAGE_DEVICE_CACHE', 'DEMO_KIT_IMAGERY_CACHE'];
function run(script, args) {
  const env = { ...process.env };
  for (const k of SCRUBBED) delete env[k];
  const r = spawnSync(process.execPath, [join(REPO_ROOT, script), ...args], { cwd: REPO_ROOT, env, encoding: 'utf8', timeout: 60_000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const beatsDir = join(REPO_ROOT, 'public', 'vantage', 'beats');
const beatHashes = () => Object.fromEntries(readdirSync(beatsDir).sort().map((f) => [f, createHash('sha256').update(readFileSync(join(beatsDir, f))).digest('hex')]));

test('seed-vantage.mjs --files-only --out: the 18 documents, re-anchored to the moment of the run, and nothing written under public/', () => {
  const before = beatHashes();
  const out = mkdtempSync(join(tmpdir(), 'vantage-seed-'));
  const committed = JSON.parse(readFileSync(join(beatsDir, 'anchor.json'), 'utf8')).anchor;
  const t0 = Date.now();
  const r = run('scripts/seed-vantage.mjs', ['--files-only', '--out', out]);
  const t1 = Date.now();
  assert.equal(r.code, 0, r.err);
  assert.ok(r.out.startsWith('anchor ') && r.out.includes(`(re-anchored from ${committed}, `), r.out);
  assert.match(r.out, /wrote 18 documents to /);
  const written = readdirSync(out).sort();
  assert.deepEqual(written, readdirSync(beatsDir).filter((f) => f.endsWith('.json')).sort(), 'the beats directory\'s 18 files, and no catalog.json');
  const anchor = Date.parse(JSON.parse(readFileSync(join(out, 'anchor.json'), 'utf8')).anchor);
  assert.ok(anchor >= t0 && anchor <= t1, 'the new anchor is the moment of the run');
  for (const f of written) {
    const was = relativeTimestamps(JSON.parse(readFileSync(join(beatsDir, f), 'utf8')), Date.parse(committed));
    const now = relativeTimestamps(JSON.parse(readFileSync(join(out, f), 'utf8')), anchor);
    assert.deepEqual(now, was, `${f}: the edited document, every instant moved with its anchor`);
  }
  assert.deepEqual(beatHashes(), before, 'public/vantage/beats is untouched');
});

test('seed-vantage.mjs mints nothing it may not: a remote --base needs --token, a loopback one the signing environment', () => {
  const out = mkdtempSync(join(tmpdir(), 'vantage-seed-'));
  const remote = run('scripts/seed-vantage.mjs', ['--base', 'https://vantage.invalid', '--out', out]);
  assert.equal(remote.code, 1);
  assert.match(remote.err, /Operator credentials unavailable/);
  const local = run('scripts/seed-vantage.mjs', ['--base', 'http://127.0.0.1:9', '--out', out]);
  assert.equal(local.code, 1);
  assert.match(local.err, /Operator credentials unavailable/);
  assert.equal(readdirSync(out).length, 18, 'the documents were written first, to --out, as the seed has always written them before publishing');
});

test('seed-vantage-region.mjs --dry-run [--rows] and --regions: the model and every region\'s shares, sending nothing', () => {
  const all = run('scripts/seed-vantage-region.mjs', ['--dry-run', '--rows']);
  assert.equal(all.code, 0, all.err);
  const lines = all.out.trimEnd().split('\n');
  assert.equal(lines.length, 104, 'the model, a blank line, then every region and its rows');
  assert.equal(lines[0], 'The model: x = clamp((income − $81,604) / $25,000, −1, 1); t = 0.5 + 0.3·x; phones = TX·(1 − t) + NY·t, 400; '
    + 'home internet 58 in the listed states (22). Income: the geo_census region rows (Census ACS 2024, 1-year), from migrations/seed/seed_011_geo.sql.');
  assert.equal(lines.filter((l) => /^US-[A-Z]{2} /.test(l)).length, 51, 'the 50 states and DC');
  assert.equal(lines.filter((l) => l.startsWith('       [')).length, 51, '--rows prints each region\'s rows');
  const two = run('scripts/seed-vantage-region.mjs', ['--regions', 'us-nc,US-TX', '--dry-run']);
  assert.equal(two.code, 0, two.err);
  assert.deepEqual(two.out.trimEnd().split('\n').slice(2), [
    'US-NC  North Carolina          $73,958  x -0.306 t 0.408  400 phones 58 home  android 1 ios 0.878 · apple 1 samsung 0.733 google 0.23 motorola 0.176 · premium 1 core 0.883 entry 0.245 · phones 1 home-internet 0.145',
    'US-TX  Texas                   $79,721  rehearsed, as L4 wrote  400 phones 90 home  android 1 ios 0.6 · samsung 1 apple 0.938 google 0.281 motorola 0.281 · core 1 premium 0.744 entry 0.308 · phones 1 home-internet 0.225',
  ], 'a modelled state and a rehearsed one, as the model in the script\'s header gives them');
  const unknown = run('scripts/seed-vantage-region.mjs', ['--regions', 'US-XX', '--dry-run']);
  assert.equal(unknown.code, 2);
  assert.match(unknown.err, /unknown region US-XX/);
});

test('fetch-vantage-devices.mjs takes its lineup from the config: an unknown --only is refused before anything loads or downloads', () => {
  const r = run('scripts/fetch-vantage-devices.mjs', ['--only', 'no-such-phone']);
  assert.equal(r.code, 2);
  assert.match(r.err, /--only names no-such-phone, not in imagery\.sources/);
});
