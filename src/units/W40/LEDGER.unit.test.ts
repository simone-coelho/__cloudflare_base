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
//       The SIZE CHECK half of P3 is NOT specified here: no witness states a
//       published size budget for either bundle (searched: docs/kit, src/sdk,
//       scripts/build-sdk.mjs, the PS guide, document 35 and its reports). The
//       budget is the owner's number; this file does not invent one.
//   (d) P4 "a versioned path": the path the customer is told to pin — the
//       script-tag and module URLs in docs/kit/01-integration-guide.md that carry
//       the src/sdk/version.ts version. "Long-lived Cache-Control" is read as
//       `immutable` with `max-age` of at least one year (31536000 s), the value
//       this repository already uses for immutable served bytes
//       (src/routes/aiScene.ts:29, src/services/sceneGen.ts:111).
//   (e) P5 "its integration example builds against the package": every fenced
//       example in the guide that imports the package by name bundles with the
//       repository's own bundler (esbuild) resolving the package through a
//       node_modules link to packages/sdk, with no network and no install.
//
// No test here publishes, installs or touches the network (D2 / LIVE2).

import { describe, it, expect } from 'vitest';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import { VERSION } from '@/sdk/version';
import { CHECKOUT_ROOT, customerAssetRuntime } from '../_native';

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

interface PackageJson { name?: unknown; version?: unknown; types?: unknown; typings?: unknown; exports?: unknown }

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

  it('native: on both customer environments the published versioned URLs serve the current bundles with a long-lived immutable Cache-Control, and the existing unversioned paths still serve them', async () => {
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
        }
        expect(host.outbound(), 'serving the SDK makes no outbound request').toBe(0);
      } finally { await host.dispose(); }
    }
  }, 180_000);

  it('deploy: the customer deploy artifact\'s asset contract (scripts/stamp-workflow.mjs ASSETS, what `npm run deploy` uploads) carries the published versioned bundles', async () => {
    const { iife, esm } = versionedPaths();
    const workflow = await import(pathToFileURL(join(ROOT, 'scripts', 'stamp-workflow.mjs')).href) as { ASSETS: string[] };
    for (const path of [...iife, ...esm]) expect(workflow.ASSETS, `the deployed asset set includes ${path}`).toContain(path.slice(1));
  }, 60_000);
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
