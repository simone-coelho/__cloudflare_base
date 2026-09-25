// src/units/_native.ts
// The ONE shared workerd (Miniflare) harness for the `native` legs of the unit
// files under src/units/**. Every native leg builds its runtime here; no unit
// file carries a copy of this setup.
//
// It reuses the harness of `src/index.api-boundary.test.ts` exactly where that
// file decides how the real Worker is run natively:
//   - the bundle: esbuild over a small WRAPPER module that imports the real
//     `./src/index.ts` (the Worker export and its Durable Object classes), with
//     the same format, platform, target, conditions, externals, aliases and the
//     `createRequire` banner (`src/index.api-boundary.test.ts:1024-1031`);
//   - the runtime: Miniflare with compatibility date `2025-06-01` and
//     `nodejs_compat`, SQLite-backed Durable Objects, KV and R2 bindings,
//     on-disk persistence so a PROCESS RESTART is a real restart over the same
//     storage (`src/index.api-boundary.test.ts:1584-1590`, W10.03), and an
//     outbound service that refuses all network egress
//     (`src/index.api-boundary.test.ts:998`).
//
// The checkout root is derived from this module's own URL, never from the
// process's working directory, so a leg always measures the tree it lives in.

import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The checkout this file lives in (src/units/_native.ts → ../..). */
export const CHECKOUT_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Bundle a wrapper module for workerd. The wrapper imports the real Worker as
 * `./src/index.ts` (resolved from the checkout root) and may add fixture-only
 * doors; it must export the Durable Object classes the runtime binds.
 */
export async function bundleNativeWorker(wrapper: string, sourcefile: string): Promise<string> {
  const bundled = await build({
    stdin: { contents: wrapper, resolveDir: CHECKOUT_ROOT, sourcefile, loader: 'ts' },
    absWorkingDir: CHECKOUT_ROOT,
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    conditions: ['workerd', 'worker', 'browser'], external: ['cloudflare:*', 'node:*'],
    // Wrangler uses the installed unenv fallback for os before 2025-09-15.
    alias: { path: 'node:path', 'node:os': 'unenv/node/os' },
    banner: { js: `import { createRequire } from 'node:module'; const require = createRequire('/${sourcefile}.mjs');` },
    logLevel: 'silent',
  });
  return bundled.outputFiles[0]!.text;
}

export interface NativeRuntimeOptions {
  /** The bundle `bundleNativeWorker` produced. */
  bundle: string;
  /** A stable runtime name, so a restart reopens the same Durable Object namespace. */
  name: string;
  /** Directory the runtime persists Durable Object, KV and R2 state under. */
  persistDir: string;
  /** Durable Object binding → exported class name (SQLite-backed). */
  durableObjects: Record<string, string>;
  kvNamespaces?: string[];
  r2Buckets?: string[];
  bindings: Record<string, string>;
}

export interface NativeRuntime {
  /** A request to the Worker's own `fetch`, exactly as workerd delivers it. */
  fetch(url: string, init?: RequestInit): Promise<Response>;
  /** Stop the process. Persisted state stays on disk for the next `open`. */
  dispose(): Promise<void>;
  /** How many times anything inside the runtime tried to reach the network. */
  outboundAttempts(): number;
}

/** Start workerd over the persisted state in `options.persistDir`. Calling it
 * again with the same options after `dispose()` is a process restart. */
export async function openNativeRuntime(options: NativeRuntimeOptions): Promise<NativeRuntime> {
  let outbound = 0;
  const mf = new Miniflare({
    name: options.name, cf: false,
    modules: [{ type: 'ESModule', path: `${options.name}-worker.mjs`, contents: options.bundle }],
    compatibilityDate: '2025-06-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: Object.fromEntries(Object.entries(options.durableObjects)
      .map(([binding, className]) => [binding, { className, useSQLite: true }])),
    durableObjectsPersist: resolve(options.persistDir, 'do'),
    kvNamespaces: options.kvNamespaces ?? [], kvPersist: resolve(options.persistDir, 'kv'),
    r2Buckets: options.r2Buckets ?? [], r2Persist: resolve(options.persistDir, 'r2'),
    bindings: options.bindings,
    outboundService: () => { outbound++; throw new Error('a unit native leg forbids outbound network'); },
  });
  await mf.ready;
  return {
    fetch: (url, init) => mf.dispatchFetch(url, init as never) as unknown as Promise<Response>,
    dispose: () => mf.dispose(),
    outboundAttempts: () => outbound,
  };
}

/** A private directory for one leg's persisted state, and its removal. */
export function nativeScratchDirectory(prefix: string): { path: string; remove(): void } {
  const path = mkdtempSync(resolve(tmpdir(), prefix));
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) };
}
