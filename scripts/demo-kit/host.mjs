#!/usr/bin/env node
// scripts/demo-kit/host.mjs — a demo's own worker, hosted in one command with explicit steps (lane H2).
//
//   node scripts/demo-kit/host.mjs --config <slug|file> --dry-run                      print every step, values redacted
//   node scripts/demo-kit/host.mjs --config <slug> --confirm edge-platform-<slug>      the whole sequence, on the owner's go
//        [--step <name> | --from <name>]   one step, or one and those after it
//        [--only TENANTS,SDK_KEYS,…]        the secrets step puts only these
//
// The steps, in order (scripts/demo-kit/lib/host.mjs holds them; docs/demo-kit/lanes/H2.md explains each):
//   preflight  check-demo --skip suites; the worker config byte-equal to the builder's output; the head mounts /<slug>/api
//   secrets    TENANTS, SDK_KEYS, RETENTION derived as rig.mjs derives them; JWT_SECRET, IDENTITY_SALT, IDENTITY_SECRETS
//              generated (JWT_SECRET is the owner's <SLUG>_REMOTE_JWT_SECRET when one is kept); each through stdin
//   database   the committed migrations the shared database lacks and the worker's queues, read-only; the owner's
//              commands printed for anything missing
//   deploy     a clean WSL worktree of the head under /tmp; check:generated; the builder; wrangler deploy; triggers deploy
//   seed       a fresh worktree; seed.mjs with a token minted here; the redeploy a reseed always needs; region-seed.mjs
//   verify     check-demo's suites against https://<worker>.expedge.workers.dev, and the URL
//
// Run it from WSL at the repository root (a dry run runs anywhere). It refuses the shared worker and the customer
// stamps before anything runs, stops at the first failing step and names it, and never prints, logs or writes a secret
// value or a token: only names and sha256 prefixes. Every step but preflight is a read or a change in the cloud, so a
// real run needs --confirm with the demo's worker name, and the owner's go.
import { spawn } from 'node:child_process';
import { isEntry } from './lib/cli.mjs';
import { REPO_ROOT } from './lib/config.mjs';
import { runHost } from './lib/host.mjs';

/**
 * The real runner: spawns the command with the caller's extra environment, writes `input` to its stdin and closes it
 * (a secret reaches wrangler only this way), collects stdout and stderr, and hands each complete line to `onLine`
 * when given (the caller redacts and prints it). Resolves { code, stdout, stderr }; 127 when the command did not start.
 */
export function spawnRunner({ root = REPO_ROOT } = {}) {
  return ({ cmd, args, cwd = root, env = {}, input, onLine = null }) => new Promise((done) => {
    let settled = false;
    const finish = (result) => { if (!settled) { settled = true; done(result); } };
    let child;
    try { child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (error) { finish({ code: 127, stdout: '', stderr: String(error?.message ?? error) }); return; }
    const out = { stdout: '', stderr: '' };
    const partial = { stdout: '', stderr: '' };
    const take = (stream) => (chunk) => {
      const text = String(chunk);
      out[stream] += text;
      if (!onLine) return;
      const lines = (partial[stream] + text).split(/\r?\n/);
      partial[stream] = lines.pop();
      for (const line of lines) onLine(line);
    };
    child.stdout.on('data', take('stdout'));
    child.stderr.on('data', take('stderr'));
    child.on('error', (error) => finish({ code: 127, stdout: out.stdout, stderr: `${out.stderr}${error.message}` }));
    child.on('close', (code) => {
      if (onLine) for (const s of ['stdout', 'stderr']) if (partial[s]) onLine(partial[s]);
      finish({ code: code ?? 127, ...out });
    });
    child.stdin.on('error', () => { /* a child that exits without reading its stdin */ });
    child.stdin.end(input ?? '');
  });
}

if (isEntry(import.meta.url)) process.exit(await runHost(process.argv.slice(2), { runner: spawnRunner() }));
