// src/units/W40/LEDGER.unit.test.ts
// W40 — SDK distribution package. One describe per LOCAL criterion of the frozen
// work order (docs/remediation/delivery-control/program.json, ticket W40).
//
// WITNESSES (every expected value below comes from one of these):
//   · document 35 §5 row W40 (:447): "Deliver versioned npm/package/types/exports
//     and supported build/browser consumption … Preserve reproducible JS bundles,
//     SDK size/caching/compatibility evidence and kit acceptance. ESM can be
//     consumable without npm; do not claim capability absence beyond the missing
//     artifact." N26 (:288); F29 (:215); F34 (:245).
//   · docs/architecture/35-verification-reports/sweep-customer-facing-promises.md
//     P06 (:346-380) — the promise ("One npm package (+ CDN script build) …
//     browser-first") and its remedy (a package manifest "versioned from
//     src/sdk/version.ts", "types from tsc --emitDeclarationOnly").
//   · HANDOFF-2026-09-18 §6 W40 row (:336), §7 closing paragraph (:358, "SDK
//     packaging … cannot be silently removed"), §8 D10 (:375, no registry
//     publication locally: that is LIVE2).
//   · The SDK's own name: src/sdk/README.md:1 ("edge-personalization SDK"), the
//     bundle banner and the served file names (scripts/build-sdk.mjs:10-11, :24).
//     A registry scope is the LIVE2 distribution decision, so the name is the
//     SDK's name with or without a scope.
//
// READINGS THIS FILE RULES (reported, not invented values):
//   (a) P1 "ESM and IIFE exports": Node, resolving the package BY NAME through
//       its `exports`, imports an ES module whose VERSION is src/sdk/version.ts;
//       and one declared export target, run as a classic script in a browser
//       window, defines the `EdgePersonalization` global (src/sdk/browser.ts).
//   (b) P2 "declarations generated from src/sdk": the package's declared export
//       surface is exactly src/sdk/index.ts's, every export is mutually
//       assignable with its source type and none is `any`; a strict TypeScript
//       fixture importing the package by name compiles with zero diagnostics.
//   (c) P3 "the bundles stay reproducible": `node scripts/build-sdk.mjs --check`
//       passes, and it covers every JS file the package exports — a byte changed
//       in any of them fails the check naming that file.
//       P3 "a size check fails when a bundle exceeds its budget" (decision D3, the
//       owner's approval of the step-3 amendments, 2026-09-24, row A40: "each
//       bundle's measured size at the W40 build rounded up to the next 5 KB,
//       recorded in packages/sdk/package.json"):
//         · the budget is recorded in packages/sdk/package.json as `sizeBudget`, an
//           object whose keys are the JS files the package exports (as written in
//           `exports`, resolved from packages/sdk) and whose values are whole bytes;
//         · the measured size is the bundle file's byte length — what the build
//           itself reports ("<file>: <n> bytes", scripts/build-sdk.mjs:47);
//         · 5 KB is 5 × 1024 bytes: the repository states every byte budget in
//           binary units (docs/kit/02-api-reference.md "256 KiB", "2 MiB";
//           PUBLICATION_MAX_BYTES and LEARN_LIMITS are powers of 1024);
//         · the size check is `node scripts/build-sdk.mjs --check`, the command the
//           program's integration gate already runs, so every integration enforces
//           the budget. A bundle exactly at its budget passes; one byte over fails,
//           naming the bundle.
//       The "less than 5 KB above" clause holds at the W40 build; after W40 a
//       bundle that shrinks past its slack fails it, and D3 makes the new budget
//       the owner's decision.
//   (d) P4 "a versioned path": the path the customer is told to pin — the
//       script-tag and module URLs in docs/kit/01-integration-guide.md that carry
//       the src/sdk/version.ts version. "Long-lived Cache-Control" is read as
//       `immutable` with `max-age` of at least one year (31536000 s), the value
//       this repository already uses for immutable served bytes
//       (src/routes/aiScene.ts:29, src/services/sceneGen.ts:111).
//       P4 "while the existing path keeps working": the unversioned paths still
//       serve the current bundles and are neither `immutable` nor long-lived (no
//       max-age of a year or more), so a release reaches the customers who load
//       them; a year-long immutable unversioned path would hold a superseded SDK
//       for a year (spec review 2026-09-24, defect 1).
//       P4 "served": served by what `npm run deploy` uploads. Customer deploys go
//       only through scripts/stamp-workflow.mjs (docs/deployment/01-deploy.md:7):
//       its package step (`--mode package`, profile local-v1, the command CI runs,
//       .github/workflows/ci.yml:89) builds the artifact, and its create/upload
//       step sends that artifact's asset files and a version whose `assets.config`
//       is everything the asset service is told. Header rules reach the asset
//       service only as `assets.config._headers`, the field Wrangler fills from an
//       assets directory's `_headers` file (node_modules/wrangler/wrangler-dist/
//       cli.js:145936-145950, :147125-147131). The deploy leg therefore serves the
//       version the real create step uploaded — its module, bindings, uploaded
//       files and asset configuration, nothing read from public/ — and observes
//       the same Cache-Control outcome as the native leg (spec review 2026-09-24,
//       defect 2). How the rule travels from the tree to the upload is the build's
//       choice; the asset contract name stays customer-assets-v2 and the uploaded
//       file set stays ASSETS (scripts/stamp-workflow.test.mjs:497-498, :662).
//   (e) P5 "its integration example builds against the package": every fenced
//       example in the guide that imports the package by name bundles with the
//       repository's own bundler (esbuild) resolving the package through a
//       node_modules link to packages/sdk, with no network and no install.
//
// No test here publishes, installs or touches the network (D2 / LIVE2).

import { describe, it, expect } from 'vitest';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import { VERSION } from '@/sdk/version';
import { CHECKOUT_ROOT, customerAssetRuntime, uploadedVersionRuntime, type UploadedVersion } from '../_native';

const ROOT = CHECKOUT_ROOT;
const PKG_DIR = join(ROOT, 'packages', 'sdk');
const PKG_JSON = join(PKG_DIR, 'package.json');
const GUIDE = join(ROOT, 'docs', 'kit', '01-integration-guide.md');
const SERVED_IIFE = join(ROOT, 'public', 'sdk', 'edge-personalization.js');
const SERVED_ESM = join(ROOT, 'public', 'sdk', 'edge-personalization.esm.js');
const SRC_INDEX = join(ROOT, 'src', 'sdk', 'index');
/** The SDK's name (src/sdk/README.md:1), optionally under the registry scope LIVE2 decides. */
const SDK_NAME = /^(@[a-z0-9][a-z0-9._~-]*\/)?edge-personalization$/;
/** One year: the repository's own immutable-asset lifetime (src/routes/aiScene.ts:29). */
const LONG_LIVED_SECONDS = 31_536_000;

interface PackageJson { name?: unknown; version?: unknown; types?: unknown; typings?: unknown; exports?: unknown; sizeBudget?: unknown }
/** Decision D3's step: 5 KB, in the repository's binary byte units. */
const FIVE_KB = 5 * 1024;

function readPackage(): PackageJson & { name: string } {
  expect(existsSync(PKG_JSON), 'packages/sdk/package.json — the SDK package manifest — does not exist').toBe(true);
  const pkg = JSON.parse(readFileSync(PKG_JSON, 'utf8')) as PackageJson;
  expect(typeof pkg.name, 'the package manifest names the package').toBe('string');
  return pkg as PackageJson & { name: string };
}

/** Every file target the `exports` field declares, through subpaths, conditions and fallbacks. */
function exportTargets(exports: unknown): string[] {
  if (typeof exports === 'string') return [exports];
  if (Array.isArray(exports)) return exports.flatMap(exportTargets);
  if (exports && typeof exports === 'object') return Object.values(exports).flatMap(exportTargets);
  return [];
}

/** The declaration entry for ".": the `types` condition of the root export, else the top-level field. */
function declaredTypes(pkg: PackageJson): string | undefined {
  const root = typeof pkg.exports === 'object' && pkg.exports !== null && !Array.isArray(pkg.exports)
    ? (pkg.exports as Record<string, unknown>)['.'] : undefined;
  const conditional = root && typeof root === 'object' && !Array.isArray(root) ? (root as Record<string, unknown>).types : undefined;
  const value = conditional ?? pkg.types ?? pkg.typings;
  return typeof value === 'string' ? value : undefined;
}

/** A throwaway consumer project whose node_modules links the package by its declared name. */
function consumer(name: string) {
  const dir = mkdtempSync(join(tmpdir(), 'w40-consumer-'));
  const link = join(dir, 'node_modules', ...name.split('/'));
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(PKG_DIR, link, 'dir');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'w40-consumer', private: true, type: 'module' }));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const sha256 = (bytes: Uint8Array | ArrayBuffer) => createHash('sha256').update(Buffer.from(bytes as ArrayBuffer)).digest('hex');

/** Every `/sdk/…edge-personalization[.esm].js` path the guide publishes, host placeholder removed. */
function publishedSdkPaths(markdown: string): string[] {
  return [...new Set([...markdown.matchAll(/\/sdk\/[^\s"'`)<>]*edge-personalization(?:\.esm)?\.js/g)].map(m => m[0]))];
}

/** The fenced code blocks of a markdown document. */
function codeBlocks(markdown: string): Array<{ lang: string; code: string }> {
  return [...markdown.matchAll(/```([A-Za-z0-9]*)\n([\s\S]*?)```/g)].map(m => ({ lang: m[1]!.toLowerCase(), code: m[2]! }));
}

const importsPackage = (code: string, name: string) =>
  new RegExp(`from\\s*['"]${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}['"]`).test(code);

function cacheDirectives(header: string | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (header ?? '').split(',')) {
    const [key, value] = part.trim().split('=');
    if (key) out.set(key.toLowerCase(), (value ?? '').replace(/"/g, ''));
  }
  return out;
}

/** The criterion's two Cache-Control properties: `immutable`, and a max-age of at least a year. */
function cachePolicy(header: string | null): { immutable: boolean; longLived: boolean } {
  const directives = cacheDirectives(header);
  return { immutable: directives.has('immutable'), longLived: Number(directives.get('max-age') ?? 0) >= LONG_LIVED_SECONDS };
}

// --- The customer deploy (P4 deploy leg) -----------------------------------

/** scripts/stamp-workflow.mjs, the only path `npm run deploy` takes (docs/deployment/01-deploy.md:7). */
interface StampWorkflow { ASSETS: string[]; canonical(value: unknown): string; sha256(value: string | Uint8Array): string }
const stampWorkflow = () => import(pathToFileURL(join(ROOT, 'scripts', 'stamp-workflow.mjs')).href) as Promise<StampWorkflow>;

/**
 * The deploy's package step as CI and an operator run it (.github/workflows/ci.yml:89,
 * docs/deployment/01-deploy.md:12): the real CLI, `--mode package`, the private input
 * `{"profile":"local-v1"}`, the artifact written to an owner-only directory. The CLI
 * itself reports only "unavailable"; the executed checks it prints name the cause.
 */
function packageStep(directory: string): { artifact: string; status: unknown; failure: string } {
  const input = join(directory, 'package-input.json'), artifact = join(directory, 'artifact.json');
  writeFileSync(input, JSON.stringify({ profile: 'local-v1' }), { mode: 0o600 });
  const run = spawnSync(process.execPath, [join(ROOT, 'scripts', 'stamp-workflow.mjs'), '--mode', 'package', '--input', input, '--output', artifact],
    { cwd: ROOT, encoding: 'utf8', timeout: 540_000, maxBuffer: 512 * 1024 * 1024 });
  const answer = /^\{.*"status".*\}$/m.exec(run.stdout ?? '')?.[0];
  const status = answer ? (JSON.parse(answer) as { status?: unknown }).status : undefined;
  if (run.status === 0 && existsSync(artifact)) return { artifact, status, failure: `exit 0: ${answer}` };
  const checks = [...(run.stdout ?? '').matchAll(/^Executed artifact check (.*)$/gm)].map(line =>
    JSON.parse(line[1]!) as { command: string; exitCode: number | null; stdout: { base64: string }; stderr: { base64: string } });
  const failed = checks.find(check => check.exitCode !== 0);
  const said = failed && [failed.stdout, failed.stderr].map(part => Buffer.from(part.base64, 'base64').toString('utf8')).join('\n')
    .split('\n').map(line => line.trim()).filter(Boolean).slice(-2).join(' | ');
  return { artifact, status, failure: `exit ${run.status}${failed ? `; its check \`${failed.command}\` exited ${failed.exitCode}: ${said}`
    : `${checks.length} checks passed, then: ${(run.stderr ?? '').trim()}`}` };
}

const ACCOUNT = 'a'.repeat(32), ZONE = 'b'.repeat(32), OPERATION = '11111111-1111-4111-8111-111111111111';
const OWNER = 'ops-22222222-2222-4222-8222-222222222222', MATERIAL = '9qL8wEfR73mCu5xY02hJ6zN4bAvT1sKd';
const DATABASE = '33333333-3333-4333-8333-333333333333';

/** A synthetic customer stamp to create: the desired state of scripts/stamp-workflow.test.mjs:22-37. */
function stampDesired(workflow: StampWorkflow) {
  const script = 'acme-staging', hash = (value: unknown) => workflow.sha256(workflow.canonical(value));
  const policy = { id: 'approved-fixture', revision: 1, durationMs: 123456, basis: 'admitted', renewal: 'new-record-only' };
  const policies: { version: number; tenants: Record<string, Record<string, unknown>> } =
    { version: 1, tenants: { 'brand-a': Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly'].map(k => [k, { ...policy }])) } };
  const desired = { version: 1, customer: 'acme', account: ACCOUNT, environment: 'staging', script, ownership: 'a'.repeat(64),
    resources: { cache: { name: script + '-cache', id: '1'.repeat(32) }, sessions: { name: script + '-sessions', id: '2'.repeat(32) },
      database: { name: script + '-database', id: DATABASE }, storage: { name: script + '-storage', id: script + '-storage' },
      queue: { name: script + '-queue', id: '4'.repeat(32) }, deadLetter: { name: script + '-deadletter', id: '5'.repeat(32) }, analytics: 'acme_staging_ops_v1' },
    tenants: { provisioned: ['brand-a'], hosts: { 'a.example.test': 'brand-a' } }, origins: ['https://a.example.test'], owners: [OWNER],
    vars: { JWT_ISSUER: script, JWT_AUDIENCE: 'customer-api', REFLEX_HOST: 'session' } as Record<string, string>,
    secrets: { JWT_SECRET: MATERIAL, SDK_KEYS: 'brand-a:' + MATERIAL, IDENTITY_SALT: MATERIAL, IDENTITY_SECRETS: 'brand-a:' + MATERIAL,
      ALERT_WEBHOOK_URL: 'https://alerts.example.test/private-fixture' },
    routes: [{ zone: ZONE, pattern: 'a.example.test/*' }] };
  const telemetry = { environment: desired.environment, schema: 'ops-v1',
    analytics: { binding: 'ANALYTICS', dataset: desired.resources.analytics, accessPolicy: 'approved-analytics' },
    monitor: { binding: 'CACHE', namespace: 'monitor', accessPolicy: 'approved-monitor' },
    alert: { binding: 'ALERT_WEBHOOK_URL', destination: 'approved-alert', urlSha256: workflow.sha256(desired.secrets.ALERT_WEBHOOK_URL), accessPolicy: 'approved-alert' } };
  for (const kind of ['analytics', 'monitor', 'alert'] as const) {
    policies.tenants['brand-a']![`telemetry.${kind}.${hash({ tenant: 'brand-a', environment: desired.environment, schema: 'ops-v1', ...telemetry[kind] })}`] = { ...policy };
  }
  desired.vars.RETENTION = JSON.stringify(policies);
  desired.vars.TENANT_CONNECTORS = JSON.stringify({ version: 1, tenants: { 'brand-a': { telemetry } } });
  return desired;
}

interface CloudflareRecord {
  calls: string[];
  manifests: Array<Record<string, { hash: string }>>;
  uploads: Record<string, string>;
  versions: Array<{ id: string; modules: Record<string, string>; metadata: {
    main_module: string; compatibility_date: string; compatibility_flags: string[];
    bindings: Array<{ type: string; name: string; text?: string }>; assets?: { config?: Record<string, unknown> } } }>;
}

/**
 * The deploy's create step exactly as `npm run deploy` runs it — scripts/deploy.sh
 * staging, `--mode create --execute`, the artifact the package step wrote, the token on
 * stdin, a protected operation state directory — with its Node process preloaded with
 * src/units/_cloudflare.mjs, a recording Cloudflare account behind the CLI's own REST
 * serializer. The account already holds the stamp's KV namespaces, D1 database and
 * queues, as `create` accepts; the bucket is created. (A stamp whose dead-letter queue
 * does not exist yet cannot be created through the CLI at this revision: its receipt
 * key `resource-deadLetter` fails the protected store's key pattern,
 * scripts/stamp-workflow.mjs:358, :750.) Returns the CLI's answer and every request.
 */
function createStep(workflow: StampWorkflow, directory: string, artifact: string): { exit: number | null; said: string; record?: CloudflareRecord } {
  const input = join(directory, 'create-input.json'), state = join(directory, 'state'), recorded = join(directory, 'cloudflare-record.json');
  mkdirSync(state, { mode: 0o700 });
  const desired = stampDesired(workflow);
  writeFileSync(input, JSON.stringify({ desired,
    bootstrap: { owner: { id: OWNER, email: 'owner@example.test', name: 'Initial Owner' }, password: 'Different-Temporary9' },
    authorization: { operation: OPERATION, mode: 'create', account: ACCOUNT, script: desired.script, evidence: 'b'.repeat(64), expiresAt: Date.now() + 3_600_000 } }), { mode: 0o600 });
  const preload = `--import=${pathToFileURL(join(ROOT, 'src', 'units', '_cloudflare.mjs')).href}`;
  const run = spawnSync('bash', [join(ROOT, 'scripts', 'deploy.sh'), 'staging', '--mode', 'create', '--input', input, '--state', state,
    '--operation', OPERATION, '--artifact', artifact, '--execute'], { cwd: ROOT, encoding: 'utf8', timeout: 300_000, maxBuffer: 64 * 1024 * 1024,
    input: JSON.stringify({ apiToken: 'z'.repeat(32) }),
    env: { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, preload].filter(Boolean).join(' '),
      UNITS_CLOUDFLARE: JSON.stringify({ account: ACCOUNT, zones: { [ZONE]: 'example.test' }, record: recorded, existing: {
        [`/storage/kv/namespaces/${desired.resources.cache.id}`]: { id: desired.resources.cache.id, title: desired.resources.cache.name },
        [`/storage/kv/namespaces/${desired.resources.sessions.id}`]: { id: desired.resources.sessions.id, title: desired.resources.sessions.name },
        [`/d1/database/${DATABASE}`]: { uuid: DATABASE, name: desired.resources.database.name },
        ...Object.fromEntries((['queue', 'deadLetter'] as const).map(kind => [`/queues/${desired.resources[kind].id}`, { queue_id: desired.resources[kind].id,
          queue_name: desired.resources[kind].name, settings: { delivery_paused: false, message_retention_period: 86400 }, consumers: [] }])),
      } }) } });
  const record = existsSync(recorded) ? JSON.parse(readFileSync(recorded, 'utf8')) as CloudflareRecord : undefined;
  return { exit: run.status, said: `${(run.stdout ?? '').trim()} ${(run.stderr ?? '').trim()}`.trim(), record };
}

/** The version the create step uploaded, as the asset service and the Worker runtime receive it. */
function uploadedVersion(record: CloudflareRecord): UploadedVersion {
  const version = record.versions.at(-1)!, metadata = version.metadata;
  const manifest = Object.assign({}, ...record.manifests) as Record<string, { hash: string }>;
  const main = metadata.main_module, names = [main, ...Object.keys(version.modules).filter(name => name !== main)];
  return {
    modules: names.map(name => ({ path: name, contents: version.modules[name] ?? '' })),
    compatibilityDate: metadata.compatibility_date, compatibilityFlags: metadata.compatibility_flags,
    bindings: Object.fromEntries(metadata.bindings.filter(b => b.type === 'plain_text' || b.type === 'secret_text').map(b => [b.name, b.text ?? ''])),
    assetsBinding: metadata.bindings.find(b => b.type === 'assets')?.name ?? '',
    files: new Map(Object.entries(manifest).map(([name, entry]) => [name, Buffer.from(record.uploads[entry.hash] ?? '', 'base64')])),
    assetConfig: metadata.assets?.config ?? {},
  };
}

// ---------------------------------------------------------------------------

describe('unit:W40.P1', () => {
  it('logic: packages/sdk/package.json declares the SDK name, the src/sdk/version.ts version, an ES module export Node imports by name, an IIFE export that defines the browser global, and types', () => {
    const pkg = readPackage();
    expect(pkg.name, 'the package carries the SDK name').toMatch(SDK_NAME);
    expect(pkg.version, 'the package version is the SDK version in src/sdk/version.ts').toBe(VERSION);

    const types = declaredTypes(pkg);
    expect(types, 'the package declares its type declarations').toMatch(/\.d\.[cm]?ts$/);
    expect(existsSync(resolve(PKG_DIR, types!)), `the declared types file ${types} exists in the package`).toBe(true);

    // ESM: Node resolves the package BY NAME through its exports map.
    const project = consumer(pkg.name);
    try {
      writeFileSync(join(project.dir, 'consume.mjs'), [
        `const resolved = import.meta.resolve(${JSON.stringify(pkg.name)});`,
        `const m = await import(${JSON.stringify(pkg.name)});`,
        'process.stdout.write(JSON.stringify({ resolved, version: m.VERSION, createClient: typeof m.createClient }));',
      ].join('\n'));
      const run = spawnSync(process.execPath, ['consume.mjs'], { cwd: project.dir, encoding: 'utf8' });
      expect(run.status, `Node imports the package by name: ${run.stderr}`).toBe(0);
      const loaded = JSON.parse(run.stdout) as { resolved: string; version: unknown; createClient: unknown };
      expect({ version: loaded.version, createClient: loaded.createClient }, 'the ES module export is the SDK at its version')
        .toEqual({ version: VERSION, createClient: 'function' });
      const esm = readFileSync(new URL(loaded.resolved), 'utf8');
      expect(esm, 'the root export Node loads is an ES module').toMatch(/^export\s|^\s*export\s*\{/m);
    } finally { project.cleanup(); }

    // IIFE: a declared export target that, run as a classic script, defines the global.
    const scripts = [...new Set(exportTargets(pkg.exports).filter(target => /\.[cm]?js$/.test(target)))];
    const globals = scripts.map(target => {
      const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { runScripts: 'outside-only', url: 'https://shop.example/' });
      const window = dom.window as unknown as { eval(code: string): unknown; EdgePersonalization?: { VERSION?: unknown; createClient?: unknown } };
      let error: string | undefined;
      try { window.eval(readFileSync(resolve(PKG_DIR, target), 'utf8')); } catch (e) { error = (e as Error).name; }
      return { target, error, version: window.EdgePersonalization?.VERSION, createClient: typeof window.EdgePersonalization?.createClient };
    });
    expect(globals.filter(g => g.createClient === 'function' && g.version === VERSION).length,
      `one declared export is the IIFE build defining window.EdgePersonalization at ${VERSION}: ${JSON.stringify(globals)}`).toBeGreaterThan(0);
  });
});

describe('unit:W40.P2', () => {
  it('logic: the package declarations carry exactly src/sdk/index.ts\'s export surface with mutually assignable, non-any types, and a strict TypeScript fixture compiles against the package by name', () => {
    const pkg = readPackage();
    const project = consumer(pkg.name);
    try {
      const fixture = join(project.dir, 'consumer.ts');
      writeFileSync(fixture, [
        `import { createClient, VERSION, type Client, type ClientConfig, type ContentDecision } from ${JSON.stringify(pkg.name)};`,
        `import * as pkg from ${JSON.stringify(pkg.name)};`,
        `import * as src from ${JSON.stringify(SRC_INDEX)};`,
        "const config: ClientConfig = { tenant: 'coach', brand: 'coach', sdkKey: 'site-key', source: 'coach-web' };",
        'const client: Client = createClient(config);',
        'const version: string = VERSION;',
        "const unsubscribe: () => void = client.listen.subscribe('hero', (decisions: ContentDecision[]) => {",
        '  const first: ContentDecision | undefined = decisions[0];',
        '  const cms: string | undefined = first?.customerContentId;',
        '  void cms;',
        '});',
        '// @ts-expect-error a tenant is required by the declared ClientConfig',
        'createClient({});',
        '// @ts-expect-error the declared VERSION is a string',
        'const notANumber: number = VERSION;',
        'export { client, version, unsubscribe, notANumber, pkg, src };',
      ].join('\n'));
      const program = ts.createProgram({ rootNames: [fixture], options: {
        strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
        types: [], skipLibCheck: false, esModuleInterop: true, forceConsistentCasingInFileNames: true, moduleDetection: ts.ModuleDetectionKind.Force,
      } });
      const diagnostics = ts.getPreEmitDiagnostics(program).map(d =>
        `${d.file ? relative(ROOT, d.file.fileName) : ''}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
      expect(diagnostics, 'a strict consumer compiles against the package declarations').toEqual([]);

      const checker = program.getTypeChecker();
      const source = program.getSourceFile(fixture)!;
      const moduleSymbol = (specifier: string) => {
        const declaration = source.statements.find((s): s is ts.ImportDeclaration => ts.isImportDeclaration(s)
          && ts.isStringLiteral(s.moduleSpecifier) && s.moduleSpecifier.text === specifier)!;
        return checker.getSymbolAtLocation(declaration.moduleSpecifier)!;
      };
      const unalias = (symbol: ts.Symbol) => symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      const packageExports = checker.getExportsOfModule(moduleSymbol(pkg.name));
      const sourceExports = checker.getExportsOfModule(moduleSymbol(SRC_INDEX));
      expect(packageExports.map(s => s.name).sort(), 'the package declares exactly the export surface of src/sdk/index.ts')
        .toEqual(sourceExports.map(s => s.name).sort());

      const mismatched: string[] = [];
      for (const exported of sourceExports) {
        const declared = packageExports.find(s => s.name === exported.name);
        if (!declared) continue;
        const a = unalias(exported), b = unalias(declared);
        let sourceType: ts.Type | undefined, packageType: ts.Type | undefined;
        if (a.flags & ts.SymbolFlags.Value) { sourceType = checker.getTypeOfSymbol(a); packageType = checker.getTypeOfSymbol(b); }
        else if (a.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias)) {
          const generic = a.declarations?.some(d => (ts.isInterfaceDeclaration(d) || ts.isTypeAliasDeclaration(d)) && !!d.typeParameters?.length);
          if (generic) continue;
          sourceType = checker.getDeclaredTypeOfSymbol(a); packageType = checker.getDeclaredTypeOfSymbol(b);
        }
        if (!sourceType || !packageType) continue;
        if (packageType.flags & ts.TypeFlags.Any) mismatched.push(`${exported.name}: declared as any`);
        else if (!checker.isTypeAssignableTo(packageType, sourceType) || !checker.isTypeAssignableTo(sourceType, packageType)) {
          mismatched.push(`${exported.name}: ${checker.typeToString(packageType)} ≠ ${checker.typeToString(sourceType)}`);
        }
      }
      expect(mismatched, 'every declared export is the type src/sdk generates for it').toEqual([]);
    } finally { project.cleanup(); }
  }, 120_000);
});

describe('unit:W40.P3', () => {
  it('logic: node scripts/build-sdk.mjs --check passes on the checkout and fails, naming the file, when any JS file the package exports no longer matches its source', () => {
    const check = (root: string) => spawnSync(process.execPath, [join(root, 'scripts', 'build-sdk.mjs'), '--check'], { cwd: root, encoding: 'utf8' });
    const here = check(ROOT);
    expect(here.status, `the checkout's generated SDK bundles are reproducible: ${here.stderr}`).toBe(0);

    const pkg = readPackage();
    const exported = [...new Set(exportTargets(pkg.exports).filter(target => /\.[cm]?js$/.test(target))
      .map(target => relative(ROOT, resolve(PKG_DIR, target)).split(sep).join('/')))];
    expect(exported.length, 'the package exports its ESM and IIFE bundles').toBeGreaterThanOrEqual(2);

    // A faithful copy of what the build reads and writes, with the installed
    // toolchain linked, so the real CLI checks the copy instead of the checkout.
    const copy = mkdtempSync(join(tmpdir(), 'w40-build-'));
    try {
      cpSync(join(ROOT, 'src'), join(copy, 'src'), { recursive: true });
      mkdirSync(join(copy, 'scripts'));
      copyFileSync(join(ROOT, 'scripts', 'build-sdk.mjs'), join(copy, 'scripts', 'build-sdk.mjs'));
      copyFileSync(join(ROOT, 'package.json'), join(copy, 'package.json'));
      cpSync(join(ROOT, 'public', 'sdk'), join(copy, 'public', 'sdk'), { recursive: true });
      cpSync(PKG_DIR, join(copy, 'packages', 'sdk'), { recursive: true, filter: from => !from.split(sep).includes('node_modules') });
      symlinkSync(join(ROOT, 'node_modules'), join(copy, 'node_modules'), 'dir');
      const control = check(copy);
      expect(control.status, `the untouched copy passes the same check: ${control.stderr}`).toBe(0);
      for (const file of exported) {
        const target = join(copy, file), original = readFileSync(target);
        writeFileSync(target, Buffer.concat([original, Buffer.from('\n/* one changed byte */\n')]));
        const tampered = check(copy);
        writeFileSync(target, original);
        expect(`${tampered.status}: ${tampered.stderr}${tampered.stdout}`, `a changed ${file} fails the reproducibility check by name`)
          .toMatch(new RegExp(`^[1-9]\\d*: [\\s\\S]*${file.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`));
      }
    } finally { rmSync(copy, { recursive: true, force: true }); }
  }, 180_000);

  it('logic: packages/sdk/package.json records each exported bundle\'s size budget — its measured size rounded up to the next 5 KB (decision D3) — and node scripts/build-sdk.mjs --check fails, naming the bundle, when a bundle exceeds its budget', () => {
    const pkg = readPackage();
    const exported = [...new Set(exportTargets(pkg.exports).filter(target => /\.[cm]?js$/.test(target)).map(target => resolve(PKG_DIR, target)))];
    expect(exported.length, 'the package exports its ESM and IIFE bundles').toBeGreaterThanOrEqual(2);
    const recorded = pkg.sizeBudget;
    expect(recorded !== null && typeof recorded === 'object' && !Array.isArray(recorded),
      `W40.P3 — packages/sdk/package.json records the bundles' size budgets (sizeBudget, decision D3): ${JSON.stringify(recorded)}`).toBe(true);
    const budgets = new Map(Object.entries(recorded as Record<string, unknown>).map(([file, bytes]) => [resolve(PKG_DIR, file), bytes]));
    const measured = exported.map(file => ({ file: relative(ROOT, file).split(sep).join('/'), size: statSync(file).size, budget: budgets.get(file) }));
    expect(measured.map(({ file, size, budget }) => ({ file, wholeBytes: Number.isSafeInteger(budget), atLeastItsSize: (budget as number) >= size,
      aMultipleOf5KB: (budget as number) % FIVE_KB === 0, lessThan5KBAbove: (budget as number) - size < FIVE_KB })),
      `W40.P3 — each exported bundle's budget is its measured size rounded up to the next 5 KB (${FIVE_KB} bytes): ${JSON.stringify(measured)}`)
      .toEqual(measured.map(({ file }) => ({ file, wholeBytes: true, atLeastItsSize: true, aMultipleOf5KB: true, lessThan5KBAbove: true })));

    // The size check itself, on a faithful copy whose recorded budgets are moved
    // around the unchanged, reproducible bundles.
    const check = (root: string) => spawnSync(process.execPath, [join(root, 'scripts', 'build-sdk.mjs'), '--check'], { cwd: root, encoding: 'utf8' });
    const copy = mkdtempSync(join(tmpdir(), 'w40-size-'));
    try {
      cpSync(join(ROOT, 'src'), join(copy, 'src'), { recursive: true });
      mkdirSync(join(copy, 'scripts'));
      copyFileSync(join(ROOT, 'scripts', 'build-sdk.mjs'), join(copy, 'scripts', 'build-sdk.mjs'));
      copyFileSync(join(ROOT, 'package.json'), join(copy, 'package.json'));
      cpSync(join(ROOT, 'public', 'sdk'), join(copy, 'public', 'sdk'), { recursive: true });
      cpSync(PKG_DIR, join(copy, 'packages', 'sdk'), { recursive: true, filter: from => !from.split(sep).includes('node_modules') });
      symlinkSync(join(ROOT, 'node_modules'), join(copy, 'node_modules'), 'dir');
      const manifest = join(copy, 'packages', 'sdk', 'package.json'), original = readFileSync(manifest, 'utf8');
      const withBudget = (file: string, bytes: number) => {
        const edited = JSON.parse(original) as { sizeBudget: Record<string, number> };
        for (const key of Object.keys(edited.sizeBudget)) if (resolve(PKG_DIR, key) === resolve(ROOT, file)) edited.sizeBudget[key] = bytes;
        writeFileSync(manifest, JSON.stringify(edited, null, 2));
      };
      const control = check(copy);
      expect(control.status, `the untouched copy passes the check: ${control.stderr}`).toBe(0);
      for (const { file, size } of measured) {
        withBudget(file, size);
        const atBudget = check(copy);
        withBudget(file, size - 1);
        const over = check(copy);
        writeFileSync(manifest, original);
        expect(atBudget.status, `W40.P3 — ${file} exactly at its budget (${size} bytes) passes the size check: ${atBudget.stderr}`).toBe(0);
        expect(`${over.status}: ${over.stderr}${over.stdout}`, `W40.P3 — ${file} one byte over its budget (${size - 1}) fails node scripts/build-sdk.mjs --check, naming the bundle`)
          .toMatch(new RegExp(`^[1-9]\\d*: [\\s\\S]*${file.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`));
      }
    } finally { rmSync(copy, { recursive: true, force: true }); }
  }, 180_000);
});

describe('unit:W40.P4', () => {
  const versionedPaths = () => {
    const published = publishedSdkPaths(readFileSync(GUIDE, 'utf8')).filter(path => path.includes(VERSION));
    const iife = published.filter(path => path.endsWith('/edge-personalization.js'));
    const esm = published.filter(path => path.endsWith('/edge-personalization.esm.js'));
    expect(iife.length, `docs/kit/01-integration-guide.md publishes a versioned (${VERSION}) script-tag URL`).toBeGreaterThan(0);
    expect(esm.length, `docs/kit/01-integration-guide.md publishes a versioned (${VERSION}) module URL`).toBeGreaterThan(0);
    return { iife, esm };
  };

  it('native: on both customer environments the published versioned URLs serve the current bundles with a long-lived immutable Cache-Control, and the existing unversioned paths still serve them, neither immutable nor long-lived', async () => {
    const { iife, esm } = versionedPaths();
    for (const environment of ['staging', 'production'] as const) {
      const host = await customerAssetRuntime(environment);
      try {
        for (const [paths, served] of [[iife, SERVED_IIFE], [esm, SERVED_ESM]] as const) {
          for (const path of paths) {
            const response = await host.runtime.dispatchFetch('https://acme.example' + path);
            expect(response.status, `${environment} ${path}`).toBe(200);
            expect(sha256(await response.arrayBuffer()), `${environment} ${path} serves the current ${VERSION} bundle`).toBe(sha256(readFileSync(served)));
            const directives = cacheDirectives(response.headers.get('cache-control'));
            expect(directives.has('immutable'), `${environment} ${path} Cache-Control is immutable: ${response.headers.get('cache-control')}`).toBe(true);
            expect(Number(directives.get('max-age')), `${environment} ${path} Cache-Control max-age is long-lived`).toBeGreaterThanOrEqual(LONG_LIVED_SECONDS);
          }
        }
        for (const [path, served] of [['/sdk/edge-personalization.js', SERVED_IIFE], ['/sdk/edge-personalization.esm.js', SERVED_ESM]] as const) {
          const response = await host.runtime.dispatchFetch('https://acme.example' + path);
          expect(response.status, `${environment} ${path} keeps working`).toBe(200);
          expect(sha256(await response.arrayBuffer()), `${environment} ${path} still serves the current bundle`).toBe(sha256(readFileSync(served)));
          const cacheControl = response.headers.get('cache-control');
          expect(cachePolicy(cacheControl), `W40.P4 — ${environment} ${path}, the existing unversioned path, is neither immutable nor long-lived, so a release reaches the customers who load it (Cache-Control: ${cacheControl})`)
            .toEqual({ immutable: false, longLived: false });
        }
        expect(host.outbound(), 'serving the SDK makes no outbound request').toBe(0);
      } finally { await host.dispose(); }
    }
  }, 180_000);

  it('deploy: the version `npm run deploy` uploads — the artifact its package step builds (stamp-workflow --mode package), sent by its create step (scripts/deploy.sh staging --mode create) to a recording Cloudflare account — serves the published versioned URLs with the current bundles and a long-lived immutable Cache-Control, and the existing unversioned paths with the current bundles, neither immutable nor long-lived', async () => {
    const { iife, esm } = versionedPaths();
    const workflow = await stampWorkflow();
    for (const path of [...iife, ...esm]) expect(workflow.ASSETS, `the deployed asset set includes ${path}`).toContain(path.slice(1));

    const directory = mkdtempSync(join(tmpdir(), 'w40-deploy-'));
    try {
      const packaged = packageStep(directory);
      expect(packaged.status, `W40.P4 — the deploy's package step (node scripts/stamp-workflow.mjs --mode package, profile local-v1) builds the artifact the customer deploy uploads: ${packaged.failure}`).toBe('packaged');
      const created = createStep(workflow, directory, packaged.artifact);
      expect({ exit: created.exit, said: created.said, versions: created.record?.versions.length },
        `the deploy's create step (scripts/deploy.sh staging --mode create) uploads one version: ${created.record?.calls.slice(-3).join(', ')}`)
        .toEqual({ exit: 0, said: expect.stringContaining('"status":"uploaded-not-promoted"'), versions: 1 });
      const upload = uploadedVersion(created.record!);
      const sent = `the version upload's assets.config: ${JSON.stringify(upload.assetConfig)}`;
      const host = await uploadedVersionRuntime(upload);
      try {
        const expected = [
          ...[...iife.map(path => [path, SERVED_IIFE] as const), ...esm.map(path => [path, SERVED_ESM] as const)]
            .map(([path, served]) => ({ path, status: 200, bytes: sha256(readFileSync(served)), immutable: true, longLived: true })),
          ...([['/sdk/edge-personalization.js', SERVED_IIFE], ['/sdk/edge-personalization.esm.js', SERVED_ESM]] as const)
            .map(([path, served]) => ({ path, status: 200, bytes: sha256(readFileSync(served)), immutable: false, longLived: false })),
        ];
        const observed: Array<Record<string, unknown>> = [], headers: string[] = [];
        for (const { path } of expected) {
          const response = await host.runtime.dispatchFetch('https://a.example.test' + path);
          const cacheControl = response.headers.get('cache-control');
          headers.push(`${path}: ${cacheControl}`);
          observed.push({ path, status: response.status, bytes: sha256(await response.arrayBuffer()), ...cachePolicy(cacheControl) });
        }
        expect(observed, `W40.P4 — the deployed version serves the versioned URLs long-lived and immutable and the unversioned paths neither (${headers.join('; ')}; ${sent})`)
          .toEqual(expected);
        expect(host.outbound(), 'serving the deployed SDK makes no outbound request').toBe(0);
      } finally { await host.dispose(); }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 600_000);
});

describe('unit:W40.P5', () => {
  it('build: docs/kit/01-integration-guide.md documents script-tag and package consumption, and every package example in it bundles against packages/sdk', async () => {
    const guide = readFileSync(GUIDE, 'utf8');
    expect(guide, 'the guide documents script-tag consumption').toMatch(/<script\s+src="[^"]*\/sdk\/[^"]*edge-personalization\.js"/);
    const pkg = readPackage();
    const examples = codeBlocks(guide).filter(block => ['js', 'javascript', 'ts', 'typescript', 'mjs', 'jsx', 'tsx'].includes(block.lang)
      && importsPackage(block.code, pkg.name));
    expect(examples.length, `the guide documents package consumption: an example importing ${pkg.name}`).toBeGreaterThan(0);
    expect(examples.some(block => /\bcreateClient\s*\(/.test(block.code)), 'the package example creates a client').toBe(true);

    const project = consumer(pkg.name);
    try {
      const packageRoot = realpathSync(PKG_DIR) + sep;
      for (const [index, example] of examples.entries()) {
        const file = join(project.dir, `example-${index}.${example.lang.startsWith('t') ? 'ts' : 'js'}`);
        writeFileSync(file, example.code);
        let result: Awaited<ReturnType<typeof build>> | undefined, errors: string[] = [];
        try {
          result = await build({ absWorkingDir: project.dir, entryPoints: [file], bundle: true, write: false, metafile: true,
            format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent' });
        } catch (e) { errors = ((e as { errors?: Array<{ text: string }> }).errors ?? [{ text: String(e) }]).map(x => x.text); }
        expect(errors, `guide example ${index} builds against the package`).toEqual([]);
        const inputs = Object.keys(result!.metafile!.inputs).map(input => resolve(project.dir, input));
        expect(inputs.some(input => input.startsWith(packageRoot)), `guide example ${index} resolved the SDK from packages/sdk`).toBe(true);
      }
    } finally { project.cleanup(); }
  }, 120_000);
});
