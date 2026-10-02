#!/usr/bin/env node
// scripts/demo-kit/check-demo.mjs — the checks a demo passes before anyone presents it or deploys it.
//
//   1. generated    npm run check:generated: the SDK and Meridian bundles match their sources (a deploy
//                   does not rebuild them; `npm run dev` does)
//   2. typecheck    the app typecheck, as the gate runs it: tsc --noEmit --incremental false --composite false
//   3. credentials  the credential grep over everything the demo's pages load (served wholesale: its
//                   public/<slug>, the kit's public/demo-kit, and every directory or file under public/ the
//                   files there name, lib/credentials.mjs servedPaths) and its config files: the
//                   repository's own token shapes (scripts/rehearse-vantage-page.mjs), the file names the
//                   suites probe for, and every secret value in the local .dev.vars (named, never printed)
//   4. suites       the demo's suites, one at a time (both publish into the one tenant), against --base, each
//                   through the kit's runner: rehearse.mjs --config <file> --suite <its kind> --base <url>
//
//   node scripts/demo-kit/check-demo.mjs --config vantage [--base http://127.0.0.1:9112]   (a slug, or the config file's path)
//        [--skip generated,typecheck,credentials,suites]
//
// The suites run only against an explicit --base: they publish beats into the tenant and end with its
// reset, so a default must never point them at somebody's worker. On a Windows checkout whose node_modules
// carries the Linux esbuild (this repository's, today), the bundle check is re-run through WSL when the
// native run fails for that reason, and the summary says so.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argOf, configArg, configFileFor, loadValidConfig, REPO_ROOT } from './lib/config.mjs';
import { scanForCredentials, secretValues, servedPaths, TOKEN_PATTERNS } from './lib/credentials.mjs';
import { suiteSummary } from './lib/rehearse.mjs';

/** The kit's suite runner (lane K3, part c): each suite runs as rehearse.mjs --config <file> --suite <kind> --base <url>. */
const REHEARSE = 'scripts/demo-kit/rehearse.mjs';

/** A Windows path as WSL mounts it (C:\x\y → /mnt/c/x/y). */
export const wslPathOf = (p) => p.replace(/^([A-Za-z]):[\\/]*/, (_, d) => `/mnt/${d.toLowerCase()}/`).split('\\').join('/');

/** The count a suite's last line states: "✓ 111 checks: …" or "✗ 3 of 111 check(s) failed: …" (the checks' vocabulary, lib/rehearse.mjs). */
export { suiteSummary };

/** True when a failure is the other platform's native binary, not a real defect. */
export const otherPlatformBinary = (text) => /installed esbuild for another platform|@esbuild\/win32|Could not load the "sharp" module/i.test(String(text));

function run(command, args, { shell = false, quiet = false } = {}) {
  return new Promise((done) => {
    const t0 = Date.now();
    const child = spawn(command, args, { cwd: REPO_ROOT, shell, env: process.env });
    let text = '';
    const take = (stream, sink) => stream.on('data', (chunk) => { text += chunk; if (!quiet) sink.write(chunk); });
    take(child.stdout, process.stdout);
    take(child.stderr, process.stderr);
    child.on('error', (error) => { text += String(error.message); });
    child.on('close', (code) => done({ code: code ?? 1, text, seconds: (Date.now() - t0) / 1000 }));
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const named = configArg(argv, ['--config', '--base', '--skip']);
  if (!named) { console.error('usage: node scripts/demo-kit/check-demo.mjs --config <demo|file> [--base <url>] [--skip generated,typecheck,credentials,suites]'); process.exit(2); }
  // A demo's slug names scripts/demo-kit/configs/<slug>.json, as rehearse.mjs reads it; a path is a path.
  const file = configFileFor(named) ?? named;
  const loaded = loadValidConfig(file, { sections: ['check'] });
  const { config, path, sources } = loaded;
  const skip = new Set((argOf(argv, '--skip', '') || '').split(',').map((s) => s.trim()).filter(Boolean));
  const base = argOf(argv, '--base', '').replace(/\/+$/, '');
  const results = [];
  const step = (name, ok, detail, seconds) => { results.push({ name, ok, detail, seconds }); };
  const section = (title) => console.log(`\n━━ ${title}`);

  if (!skip.has('generated')) {
    section('npm run check:generated');
    let r = await run('npm', ['run', 'check:generated'], { shell: process.platform === 'win32' });
    let how = 'npm run check:generated';
    if (r.code !== 0 && process.platform === 'win32' && otherPlatformBinary(r.text)) {
      console.log('\n· the native run failed on another platform\'s esbuild binary; running it through WSL instead');
      const seconds = r.seconds;
      r = await run('wsl.exe', ['-e', 'bash', '-lc', `cd '${wslPathOf(REPO_ROOT)}' && npm run check:generated`]);
      r.seconds += seconds;
      how += ' (through WSL: node_modules carries the Linux esbuild)';
    }
    step('generated', r.code === 0, how, r.seconds);
  }

  if (!skip.has('typecheck')) {
    section('the app typecheck: tsc --noEmit --incremental false --composite false');
    const tsc = 'node_modules/typescript/bin/tsc';
    if (!existsSync(`${REPO_ROOT}/${tsc}`)) step('typecheck', false, `${tsc} is not installed`, 0);
    else {
      const r = await run(process.execPath, ['--max-old-space-size=4096', tsc, '--noEmit', '--incremental', 'false', '--composite', 'false']);
      const errorCount = (r.text.match(/error TS\d+/g) ?? []).length;
      step('typecheck', r.code === 0, r.code === 0 ? 'tsc --noEmit --incremental false --composite false: no error' : `${errorCount} error(s)`, r.seconds);
    }
  }

  if (!skip.has('credentials')) {
    // Everything the pages load, not only public/<slug> (R2): the kit's modules, and whatever the files name.
    const served = servedPaths({ root: REPO_ROOT, publicDir: config.publicDir });
    const servedList = served.map((s) => s.path).join(', ');
    section(`the credential grep over what the pages load (${servedList}) and the config`);
    for (const s of served) console.log(`   · ${s.path}${s.dir ? '/' : ''}${s.via ? `  (named by ${s.via})` : s.path === config.publicDir ? '  (the config\'s publicDir)' : '  (the kit)'}`);
    const t0 = Date.now();
    const devVars = `${REPO_ROOT}/.dev.vars`;
    const secrets = existsSync(devVars) ? secretValues(readFileSync(devVars, 'utf8')) : [];
    const docFiles = Object.values(config.seed?.documents ?? {}).filter((d) => d?.file).map((d) => path(d.file));
    const extraFiles = [...new Set([...Object.values(sources), ...docFiles])];
    const scan = scanForCredentials({ dirs: served.map((s) => path(s.path)), extraFiles, secrets, root: REPO_ROOT });
    for (const f of scan.findings) console.log(`   ✗ ${f.file}: ${f.what}`);
    const detail = `${scan.dirFiles} files in ${servedList} and ${scan.extraFiles} config file(s), ${scan.textFiles} read as text; `
      + `${TOKEN_PATTERNS.length} token shapes, the never-served names, ${scan.secretsSearched} .dev.vars secret value(s)${existsSync(devVars) ? '' : ' (no .dev.vars here)'}; `
      + `${scan.findings.length ? `${scan.findings.length} finding(s)` : 'no finding'}`;
    console.log(`   ${scan.findings.length ? '✗' : '✓'} ${detail}`);
    step('credentials', scan.findings.length === 0, detail, (Date.now() - t0) / 1000);
  }

  if (!skip.has('suites')) {
    if (!base) {
      console.log('\n━━ suites: not run, no --base given (they publish into the tenant and end with its reset, so they never run against a default)');
      step('suites', false, 'not run: no --base', 0);
    } else {
      const configRel = relative(REPO_ROOT, loaded.file).split('\\').join('/');
      for (const s of config.check.suites) {
        section(`${s.name}: node ${REHEARSE} --config ${configRel} --suite ${s.kind} --base ${base} (runs ${s.script}${s.args?.length ? ` ${s.args.join(' ')}` : ''})`);
        const r = await run(process.execPath, [path(REHEARSE), '--config', loaded.file, '--suite', s.kind, '--base', base]);
        const summary = suiteSummary(r.text);
        step(s.name, r.code === 0 && summary?.ok === true, summary ? `${summary.passed} of ${summary.total} checks` : `exit ${r.code}, no summary line`, r.seconds);
      }
    }
  }

  console.log(`\ncheck-demo ${config.slug}${base ? ` against ${base}` : ''} (${relative(process.cwd(), loaded.file) || loaded.file})`);
  for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name.padEnd(14)} ${r.detail}  ${r.seconds.toFixed(1)} s`);
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `✗ ${failed.length} of ${results.length} step(s) failed: ${failed.map((r) => r.name).join(', ')}` : `✓ ${results.length} of ${results.length} step(s) passed`);
  process.exit(failed.length ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
