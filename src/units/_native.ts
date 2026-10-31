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
// It also carries the two runtimes of legs that must observe the deployed
// asset service rather than an in-process host (W40):
//   - `customerAssetRuntime`: the setup `src/index.api-boundary.test.ts` uses
//     for its customer asset routing case (W01.08, :2527-2549): the real Worker
//     default export bundled from `src/index.ts` with the same esbuild options,
//     run in Miniflare with the customer environment's `[assets]` block read
//     from `wrangler.toml`, and every outbound request refused;
//   - `uploadedVersionRuntime`: a Worker version served exactly as a Cloudflare
//     version upload delivered it (modules, bindings, uploaded asset files and
//     `assets.config`, nothing read from `public/`).
// Nothing here stubs an application route.
//
// The checkout root is derived from this module's own URL, never from the
// process's working directory, so a leg always measures the tree it lives in.

import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
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
  /** Queue producer binding → queue name, and each consumed queue's settings, as wrangler.toml declares them (R-P615). */
  queueProducers?: Record<string, string>;
  queueConsumers?: Record<string, { maxBatchSize?: number; maxBatchTimeout?: number; maxRetries?: number; deadLetterQueue?: string }>;
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
    ...(options.queueProducers ? { queueProducers: options.queueProducers } : {}),
    ...(options.queueConsumers ? { queueConsumers: options.queueConsumers } : {}),
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

// --- The deployed asset service (W40) ---------------------------------------

let workerBundle: Promise<string> | undefined;

/**
 * The real Worker's default export alone, bundled once per process through
 * `bundleNativeWorker` above (the boundary test's options: browser platform,
 * workerd conditions, node/cloudflare externals and Wrangler's `unenv`
 * fallback for `os`; banner `createRequire('/units-native-worker.mjs')`).
 */
export function nativeWorkerBundle(): Promise<string> {
  workerBundle ??= bundleNativeWorker("export { default } from './src/index.ts';", 'units-native-worker');
  return workerBundle;
}

export type CustomerEnvironment = 'staging' | 'production';

export interface CustomerAssetRuntime {
  runtime: Miniflare;
  /** Outbound requests the Worker attempted; the harness refuses every one. */
  outbound: () => number;
  dispose: () => Promise<void>;
}

/**
 * A customer-profile Worker serving `public/` exactly as the named environment's
 * `[env.<name>.assets]` block in `wrangler.toml` configures it (directory,
 * binding, run_worker_first, html_handling, not_found_handling). Miniflare reads
 * the directory's own `_headers` and `_redirects` files the way a Wrangler
 * deployment of that directory does.
 */
export async function customerAssetRuntime(environment: CustomerEnvironment,
  bindings: Record<string, string> = {}): Promise<CustomerAssetRuntime> {
  const { experimental_readRawConfig } = await import('wrangler');
  const config = experimental_readRawConfig({ config: resolve(CHECKOUT_ROOT, 'wrangler.toml') }).rawConfig;
  const assets = config.env?.[environment]?.assets;
  if (!assets?.directory || !assets.binding) throw new Error(`wrangler.toml declares no assets for env.${environment}`);
  let outbound = 0;
  const runtime = new Miniflare({
    modules: [{ type: 'ESModule', path: 'units-native-worker.mjs', contents: await nativeWorkerBundle() }],
    compatibilityDate: '2025-06-01', compatibilityFlags: ['nodejs_compat'],
    bindings: { DEPLOYMENT_PROFILE: 'customer', AUTH_MODE: 'enforced', ENVIRONMENT: `units-native-${environment}`,
      TENANTS: JSON.stringify({ provisioned: ['acme'], hosts: { 'acme.example': 'acme' } }), ...bindings },
    assets: {
      directory: resolve(CHECKOUT_ROOT, assets.directory), binding: assets.binding,
      routerConfig: { has_user_worker: true, invoke_user_worker_ahead_of_assets: assets.run_worker_first === true },
      assetConfig: { html_handling: assets.html_handling ?? 'auto-trailing-slash', not_found_handling: assets.not_found_handling ?? 'none' },
    },
    outboundService: () => { outbound++; throw new Error('units native harness forbids outbound network'); },
  });
  await runtime.ready;
  return { runtime, outbound: () => outbound, dispose: () => runtime.dispose() };
}

/** One Worker version as a Cloudflare version upload delivered it. */
export interface UploadedVersion {
  /** The ES modules the version upload sent, its main module first. */
  modules: Array<{ path: string; contents: string }>;
  compatibilityDate: string;
  compatibilityFlags: string[];
  /** The version's plain-text and secret-text bindings. */
  bindings: Record<string, string>;
  /** The name of the version's `assets` binding. */
  assetsBinding: string;
  /** Every file the asset upload sent, by the path it is served at. */
  files: Map<string, Uint8Array>;
  /** The version upload's `assets.config`, as Cloudflare receives it. */
  assetConfig: Record<string, unknown>;
}

/** The asset directory's rule files; an upload's rules arrive only in `assets.config`. */
const RULE_FILES = ['_headers', '_redirects'] as const;

/**
 * A Worker version served the way the asset service serves an upload: its
 * modules, its bindings, the uploaded asset files and nothing else, under its
 * `assets.config`. Header and redirect rules reach the asset service only as
 * `assets.config._headers` / `._redirects` — the fields Wrangler fills from an
 * assets directory's `_headers` and `_redirects` files and sends with the
 * version (node_modules/wrangler/wrangler-dist/cli.js :145936-145950,
 * :147125-147131, :147745-147749) — so they are written as those files for
 * Miniflare's parser of the same rules (node_modules/miniflare/dist/src/index.js
 * :81901-81937). An uploaded asset that happens to be named like a rule file is
 * a plain file to the asset service, never a rule, so it is not written.
 */
export async function uploadedVersionRuntime(version: UploadedVersion): Promise<CustomerAssetRuntime> {
  const directory = mkdtempSync(join(tmpdir(), 'units-native-upload-'));
  for (const [path, bytes] of version.files) {
    const target = resolve(directory, '.' + path);
    if (!target.startsWith(directory + sep)) throw new Error(`uploaded asset path leaves the upload: ${path}`);
    if ((RULE_FILES as readonly string[]).includes(target.slice(directory.length + 1))) continue;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
  for (const file of RULE_FILES) {
    const rules = version.assetConfig[file];
    if (typeof rules === 'string') writeFileSync(join(directory, file), rules);
  }
  const config = version.assetConfig as { run_worker_first?: unknown; html_handling?: 'auto-trailing-slash' | 'force-trailing-slash' | 'drop-trailing-slash' | 'none'; not_found_handling?: 'single-page-application' | '404-page' | 'none' };
  let outbound = 0;
  const runtime = new Miniflare({
    cf: false,
    modules: version.modules.map(module => ({ type: 'ESModule' as const, path: module.path, contents: module.contents })),
    compatibilityDate: version.compatibilityDate, compatibilityFlags: version.compatibilityFlags,
    bindings: version.bindings,
    assets: {
      directory, binding: version.assetsBinding,
      routerConfig: { has_user_worker: true, invoke_user_worker_ahead_of_assets: config.run_worker_first === true },
      assetConfig: { html_handling: config.html_handling ?? 'auto-trailing-slash', not_found_handling: config.not_found_handling ?? 'none' },
    },
    outboundService: () => { outbound++; throw new Error('units native harness forbids outbound network'); },
  });
  try { await runtime.ready; } catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
  return { runtime, outbound: () => outbound, dispose: async () => { await runtime.dispose(); rmSync(directory, { recursive: true, force: true }); } };
}
