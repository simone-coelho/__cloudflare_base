// src/units/W40/P6.unit.test.ts
// W40 — SDK distribution package, criterion P6 of the frozen work order
// (docs/remediation/delivery-control/program.json, ticket W40):
//   "The release lint the deploy's package step runs passes with its warning cap
//    unchanged at 582, because the lint script in package.json excludes
//    src/units/** (decision D4)."
//
// WITNESSES (every expected value below comes from one of these):
//   · Decision D4 (owner approval of amendments A43–A46 on 2026-09-25, "It is
//     approved.", row A44): "The release lint covers shipped code only:
//     src/units/** (the ledger acceptance tests) is excluded from the lint script
//     and the warning cap stays 582; a later change is an owner decision." A44:
//     "by changing the lint script in package.json … — never by raising the cap".
//   · The lint script D4 amends, package.json `scripts.lint` at the freeze
//     (4fbdddc, unchanged through e7cbb47): FREEZE_LINT below.
//   · The deploy's package step: scripts/stamp-workflow.mjs LOCAL_CHECK_COMMANDS
//     (:417, first entry 'npm run lint'; the ci-v1 profile keeps the first two,
//     :443) and executedChecks (:440-448), which runs each command as
//     `bash -c <command>` in the checkout with `CI=true` in the environment,
//     a 300 s timeout and a 32 MiB output buffer, and fails the package on a
//     non-zero exit.
//
// READINGS THIS FILE RULES:
//   (a) "the release lint the deploy's package step runs" is the package.json
//       `lint` script, which the package step runs as `npm run lint`.
//   (b) "its warning cap unchanged at 582": the script is ONE eslint run whose
//       exit is the check's exit — no shell operator, redirection, substitution
//       or expansion that could mask or replace it — and it passes
//       `--max-warnings` exactly once, with 582.
//   (c) "the lint script … excludes src/units/**": the script itself carries an
//       `--ignore-pattern` naming the whole src/units directory (src/units,
//       src/units/, src/units/** or src/units/**/*, with or without a leading
//       ./ or /), and the run lints no file under src/units/.
//   (d) The exclusion is the only change D4 makes ("covers shipped code only"
//       with the cap unchanged; any other change is an owner decision): every
//       file the freeze-time script lints outside src/units/** is still linted.
//       The freeze-time scope is computed at run time over the current tree from
//       FREEZE_LINT's targets and `--ext`, skipping .eslintrc.json's
//       `ignorePatterns` and eslint's default dotfile ignore; at e7cbb47 this
//       reading equals the file list eslint 8.57.1 reports for that script
//       (393 files both ways).
//   (e) "passes": `npm run lint`, run exactly as executedChecks runs it, exits 0.
// No warning count is asserted: the cap is the ruled value, the exit is eslint's.

import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { CHECKOUT_ROOT } from '../_native';

const ROOT = CHECKOUT_ROOT;
/** Decision D4: the warning cap stays 582. */
const CAP = '582';
/** package.json `scripts.lint` at the freeze (4fbdddc): the script decision D4 amends. */
const FREEZE_LINT = 'eslint src --ext .ts public/meridian/meridian.js public/meridian/surfaces.js public/meridian/beats.js public/meridian/compare.js public/meridian/layout.js public/meridian/moments.js public/sdk/debug.js --max-warnings 582';
/** The package step's command for the release lint (scripts/stamp-workflow.mjs:417). */
const RELEASE_LINT = 'npm run lint';

/** The release lint script as package.json declares it. */
function lintScript(): string {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts?: Record<string, unknown> };
  const script = pkg.scripts?.lint;
  expect(typeof script, 'package.json declares the release lint script (scripts.lint)').toBe('string');
  return script as string;
}

/**
 * The script as the shell reads it: its words, and every unquoted (or
 * double-quote-expanded) character that would make it more than one plain
 * command — a separator, pipe, background, redirection, substitution or expansion.
 */
function shellWords(script: string): { words: string[]; operators: string[] } {
  const words: string[] = [], operators: string[] = [];
  let word = '', started = false;
  for (let i = 0; i < script.length; i++) {
    const c = script[i]!;
    if (c === "'") {
      const end = script.indexOf("'", i + 1);
      word += script.slice(i + 1, end < 0 ? script.length : end); started = true; i = end < 0 ? script.length : end;
    } else if (c === '"') {
      const end = script.indexOf('"', i + 1), inner = script.slice(i + 1, end < 0 ? script.length : end);
      operators.push(...[...inner.matchAll(/[`$]/g)].map(m => m[0]));
      word += inner; started = true; i = end < 0 ? script.length : end;
    } else if (/\s/.test(c)) {
      if (started) words.push(word);
      word = ''; started = false;
    } else if (/[;&|<>`$(){}]/.test(c)) {
      operators.push(c);
    } else if (c === '\\') {
      word += script[i + 1] ?? ''; started = true; i++;
    } else { word += c; started = true; }
  }
  if (started) words.push(word);
  return { words, operators };
}

/** Every value an option takes in `words`, as `--name value` or `--name=value`. */
function optionValues(words: string[], name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (words[i] === name) values.push(words[i + 1] ?? '');
    else if (words[i]!.startsWith(name + '=')) values.push(words[i]!.slice(name.length + 1));
  }
  return values;
}

/** An ignore pattern that names the whole src/units directory. */
const namesSrcUnits = (pattern: string) =>
  pattern.replace(/^\.?\//, '').replace(/\/\*\*\/\*$|\/\*\*$|\/$/, '') === 'src/units';

const underSrcUnits = (file: string) => file.startsWith('src/units/');

/** The files the freeze-time script lints in the current tree (reading (d)). */
function freezeScope(): string[] {
  const words = FREEZE_LINT.split(/\s+/).slice(1), extensions: string[] = [], targets: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (words[i] === '--ext') extensions.push(...words[++i]!.split(','));
    else if (words[i]!.startsWith('--')) i++;
    else targets.push(words[i]!);
  }
  const ignored = new Set((JSON.parse(readFileSync(join(ROOT, '.eslintrc.json'), 'utf8')) as { ignorePatterns?: string[] }).ignorePatterns ?? []);
  const walk = (directory: string): string[] => readdirSync(join(ROOT, directory), { withFileTypes: true }).flatMap(entry =>
    entry.name.startsWith('.') || ignored.has(entry.name) ? []
      : entry.isDirectory() ? walk(`${directory}/${entry.name}`)
        : extensions.some(extension => entry.name.endsWith(extension)) ? [`${directory}/${entry.name}`] : []);
  return targets.flatMap(target => statSync(join(ROOT, target)).isDirectory() ? walk(target) : [target]);
}

/** A command run exactly as scripts/stamp-workflow.mjs executedChecks runs a package check (:446-448). */
function packageCheck(command: string) {
  const run = spawnSync('bash', ['-c', command], { cwd: ROOT, encoding: 'utf8', timeout: 300_000, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, CI: 'true' } });
  const said = `${run.stdout ?? ''}\n${run.stderr ?? ''}`.split('\n').map(line => line.trim()).filter(Boolean).slice(-2).join(' | ');
  return { status: run.status, signal: run.signal, said };
}

describe('unit:W40.P6', () => {
  it('logic: the release lint script the deploy\'s package step runs (npm run lint) is one eslint run that keeps --max-warnings 582 and excludes src/units/** (decision D4)', async () => {
    const { LOCAL_CHECK_COMMANDS } = await import(pathToFileURL(join(ROOT, 'scripts', 'stamp-workflow.mjs')).href) as { LOCAL_CHECK_COMMANDS: string[] };
    expect(LOCAL_CHECK_COMMANDS, 'the deploy\'s package step runs the release lint script').toContain(RELEASE_LINT);

    const script = lintScript();
    const { words, operators } = shellWords(script);
    expect({
      program: words[0],
      shellOperators: operators,
      maxWarnings: optionValues(words, '--max-warnings'),
      excludesSrcUnits: optionValues(words, '--ignore-pattern').some(namesSrcUnits),
    }, `W40.P6 — the release lint script (package.json scripts.lint: ${script}) is one eslint run whose only cap is ${CAP} and which excludes src/units/** (decision D4)`)
      .toEqual({ program: 'eslint', shellOperators: [], maxWarnings: [CAP], excludesSrcUnits: true });
  });

  it('lint: the release lint, run as the package step runs it, passes with its cap, and lints everything its freeze-time scope covered except src/units/**', () => {
    lintScript();
    const run = packageCheck(RELEASE_LINT);
    expect({ status: run.status, signal: run.signal },
      `W40.P6 — the release lint (${RELEASE_LINT}, run as scripts/stamp-workflow.mjs executedChecks runs it) passes with its warning cap: ${run.said}`)
      .toEqual({ status: 0, signal: null });

    // The same script, its report written as JSON so the linted files can be read.
    const directory = mkdtempSync(join(tmpdir(), 'w40-lint-'));
    try {
      const report = join(directory, 'lint.json');
      const scoped = packageCheck(`npm run --silent lint -- --format json --output-file '${report}'`);
      expect(existsSync(report), `the release lint reports the files it linted (exit ${scoped.status}: ${scoped.said})`).toBe(true);
      const linted = new Set((JSON.parse(readFileSync(report, 'utf8')) as Array<{ filePath: string }>)
        .map(result => relative(ROOT, result.filePath).split(sep).join('/')));
      const freeze = freezeScope();
      expect(freeze, 'the freeze-time scope reading finds the Worker entry').toContain('src/index.ts');
      const lintedUnits = [...linted].filter(underSrcUnits), notLinted = freeze.filter(file => !underSrcUnits(file) && !linted.has(file));
      expect({ srcUnitsFilesLinted: lintedUnits.slice(0, 5), freezeScopeFilesNotLinted: notLinted.slice(0, 5) },
        `W40.P6 — the release lint excludes src/units/** (${lintedUnits.length} of its files linted) and nothing else its freeze-time scope covered (${notLinted.length} of ${freeze.length} not linted)`)
        .toEqual({ srcUnitsFilesLinted: [], freezeScopeFilesNotLinted: [] });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 600_000);
});
