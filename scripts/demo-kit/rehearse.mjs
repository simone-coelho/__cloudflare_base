#!/usr/bin/env node
// scripts/demo-kit/rehearse.mjs — run one of a demo's suites, chosen through its config.
//
//   node scripts/demo-kit/rehearse.mjs --config <demo> --suite page|dom --base <url> [the suite's own flags]
//
// <demo> is a config file (scripts/demo-kit/configs/vantage.json) or a demo's slug (vantage), which names
// scripts/demo-kit/configs/<slug>.json. The config's check.suites lists the demo's suites, each with its kind:
// `page`, the request-level suite (lib/rehearse.mjs), and `dom`, the real page in headless Chrome
// (lib/cdp.mjs). The suite runs as `node <script> --base <url> <its config args> <the flags given here>`, its
// output passes through unchanged, and its exit code is this command's: 0 when every check passed (a "!" line
// alone is 0), 1 when any failed, 2 when the command line or the config is wrong.
//
// --base is required: a suite publishes beats into the demo's tenant and ends with its reset, so it never runs
// against a default. Run a demo's suites one at a time; check-demo.mjs runs them all through this command.
// Every other flag goes to the suite as it was written, in order (Vantage's DOM suite: --wait, --size,
// --chrome, --strict, --shots).
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { isEntry } from './lib/cli.mjs';
import { configFileFor, loadValidConfig, REPO_ROOT, SUITE_KINDS } from './lib/config.mjs';

export { configFileFor };

const OWN_FLAGS = ['--config', '--suite', '--base'];
const USAGE = 'usage: node scripts/demo-kit/rehearse.mjs --config <demo|file> --suite page|dom --base <url> [the suite\'s own flags]';

/**
 * This command's own flags and everything else, in order: `--config`, `--suite` and `--base` with their values
 * are taken out; every other argument is the suite's. A flag given twice, or given with no value, is an error.
 */
export function splitArgs(argv) {
  const own = {}, rest = [], errors = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!OWN_FLAGS.includes(a)) { rest.push(a); continue; }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) { errors.push(`${a} needs a value`); continue; }
    if (Object.hasOwn(own, a.slice(2))) errors.push(`${a} is given twice`);
    own[a.slice(2)] = value;
    i += 1;
  }
  return { own, rest, errors };
}

/** The demo's suite of one kind, from its config's check.suites; throws naming what the config has. */
export function selectSuite(config, kind) {
  if (!SUITE_KINDS.includes(kind)) throw new Error(`--suite must be ${SUITE_KINDS.join(' or ')}, not "${kind}"`);
  const suites = Array.isArray(config?.check?.suites) ? config.check.suites : [];
  const found = suites.filter((s) => s && s.kind === kind);
  if (found.length !== 1) {
    const has = suites.map((s) => `${s?.kind ?? '(no kind)'}: ${s?.name ?? '?'}`).join(', ') || 'none';
    throw new Error(`${config?.slug ?? 'the config'} has ${found.length ? `${found.length} suites` : 'no suite'} of kind "${kind}" (check.suites: ${has})`);
  }
  return found[0];
}

/** The suite's command line: node, its script, --base, the config's own args, then the caller's flags. */
export function suiteCommand(suite, { base, rest = [], path = (rel) => resolve(REPO_ROOT, rel), node = process.execPath }) {
  return [node, path(suite.script), '--base', base, ...(suite.args ?? []), ...rest];
}

/** Runs the command line; resolves with the exit code. `run` is a test's seam. */
export async function main(argv, { run = runInherit, log = console.error } = {}) {
  const { own, rest, errors } = splitArgs(argv);
  if (!own.config || !own.suite || !own.base) errors.push(`${['config', 'suite', 'base'].filter((k) => !own[k]).map((k) => `--${k}`).join(', ')} required`);
  if (errors.length) { log(`✗ ${errors.join('; ')}\n${USAGE}`); return 2; }
  const file = configFileFor(own.config);
  if (!file) { log(`✗ --config ${own.config}: no such config file, and no scripts/demo-kit/configs/${own.config}.json\n${USAGE}`); return 2; }
  let exitCode = null;
  const loaded = loadValidConfig(file, { sections: ['check'], exit: (code) => { exitCode = code; }, log });
  if (exitCode !== null) return exitCode;
  let suite;
  try { suite = selectSuite(loaded.config, own.suite); } catch (error) { log(`✗ ${error.message}`); return 2; }
  const base = own.base.replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+/.test(base)) { log(`✗ --base ${own.base}: an http or https URL`); return 2; }
  return run(suiteCommand(suite, { base, rest, path: loaded.path }));
}

function runInherit([command, ...args]) {
  return new Promise((done) => {
    const child = spawn(command, args, { cwd: REPO_ROOT, stdio: 'inherit', env: process.env });
    child.on('error', (error) => { console.error(`✗ ${error.message}`); done(1); });
    child.on('close', (code, signal) => done(code ?? (signal ? 1 : 0)));
  });
}

if (isEntry(import.meta.url)) process.exit(await main(process.argv.slice(2)));
