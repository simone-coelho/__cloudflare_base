// src/units/_native.ts
// The ONE shared native (workerd) harness for unit legs that must observe the
// deployed runtime rather than an in-process host. It is the setup
// `src/index.api-boundary.test.ts` uses for its customer asset routing case
// (W01.08, :2527-2549): the real Worker default export bundled from
// `src/index.ts` with the same esbuild options, run in Miniflare with the
// customer environment's `[assets]` block read from `wrangler.toml`, and every
// outbound request refused. Nothing here stubs an application route.
//
// Paths are derived from this file's own location, never from `process.cwd()`,
// so a unit measures the tree it lives in whatever directory it is run from.

import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

/** The checkout this file belongs to. */
export const CHECKOUT_ROOT = fileURLToPath(new URL('../../', import.meta.url));

let workerBundle: Promise<string> | undefined;

/**
 * The real Worker, bundled once per process with the options the boundary test
 * uses: browser platform, workerd conditions, node/cloudflare externals and
 * Wrangler's `unenv` fallback for `os`.
 */
export function nativeWorkerBundle(): Promise<string> {
  workerBundle ??= build({
    absWorkingDir: CHECKOUT_ROOT,
    stdin: { contents: "export { default } from './src/index.ts';", resolveDir: CHECKOUT_ROOT, sourcefile: 'units-native-worker.ts', loader: 'ts' },
    bundle: true, write: false, metafile: false, format: 'esm', platform: 'browser', target: 'es2022',
    conditions: ['workerd', 'worker', 'browser'], external: ['cloudflare:*', 'node:*'],
    alias: { path: 'node:path', 'node:os': 'unenv/node/os' },
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire('/units-native-worker.mjs');" },
    logLevel: 'silent',
  }).then(result => result.outputFiles[0]!.text);
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
