// Shared SDK build options. Importing this module never writes generated assets.
// One build owns everything generated from src/sdk: the two served bundles, the
// same bytes under the served path that names their version, and the package in
// packages/sdk (its bundles, its type declarations and its manifest's version).
// `--check` rebuilds all of it in memory and fails on the first difference.
import { build as esbuild } from 'esbuild';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { dirname, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const SDK_TARGETS = [
  { entry: 'src/sdk/index.ts', output: 'public/sdk/edge-personalization.esm.js', format: 'esm' },
  { entry: 'src/sdk/browser.ts', output: 'public/sdk/edge-personalization.js', format: 'iife' },
];
/** The package the SDK is distributed in: its manifest is written by hand, the rest is generated. */
export const SDK_PACKAGE = 'packages/sdk';
const SDK_TYPES = SDK_PACKAGE + '/types';
const SDK_MANIFEST = SDK_PACKAGE + '/package.json';
const VERSION_SOURCE = 'src/sdk/version.ts';
/** A version names a served directory and a package release, so it is a plain semantic version. */
export const SDK_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
function versionIn(source) {
  const version = source.match(/'([^']+)'/)?.[1];
  if (!version || !SDK_VERSION.test(version)) throw new Error('SDK version unavailable');
  return version;
}
/** The SDK version: src/sdk/version.ts is the one place it is written. */
export const sdkVersion = (root = ROOT) => versionIn(readFileSync(resolve(root, VERSION_SOURCE), 'utf8'));
/** A bundle's served path under the directory that names its version: bytes that never change once released. */
export const versionedOutput = (target, version) => target.output.replace('public/sdk/', `public/sdk/${version}/`);
/** A bundle's path in the package. */
export const packageOutput = target => target.output.replace('public/sdk/', SDK_PACKAGE + '/');
/** Every place one generated bundle is kept. */
const outputsOf = (target, version) => [target.output, versionedOutput(target, version), packageOutput(target)];

export async function sdkBuildOptions(root = ROOT) {
  return sdkOptionsForVersion(root, versionIn(await readFile(resolve(root, VERSION_SOURCE), 'utf8')));
}
export function sdkOptionsForVersion(root, version) {
  return SDK_TARGETS.map(target => ({
    absWorkingDir: root, entryPoints: [target.entry], outfile: target.output, format: target.format,
    bundle: true, platform: 'browser', target: 'es2022', minify: false, sourcemap: false,
    legalComments: 'none', logLevel: 'silent', metafile: true, write: false,
    banner: { js: `/* edge-personalization SDK v${version} — one package: core (identity, transport), emit (four capture paths), listen (decisions). */` },
  }));
}
const generated = result => result.outputFiles?.length === 1 && result.outputFiles[0].contents
  ? Buffer.from(result.outputFiles[0].contents) : undefined;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const retained = (root, path) => readFile(resolve(root, path)).catch(error => { if (error?.code === 'ENOENT') return undefined; throw error; });
async function requireExact(root, path, expected) {
  const actual = await retained(root, path);
  if (!expected || !actual?.equals(expected)) {
    throw new Error(`Generated asset mismatch: ${path}; retained=${actual ? hash(actual) : 'missing'}; generated=${expected ? hash(expected) : 'missing'}`);
  }
}
async function writeGenerated(root, path, bytes) {
  await mkdir(dirname(resolve(root, path)), { recursive: true });
  await writeFile(resolve(root, path), bytes);
}
// The bundler never writes: each bundle is built once in memory and those bytes
// are the served file, its versioned copy and the package's copy.
export async function buildSDK({ root = ROOT, write = false, build = esbuild, plugins = [] } = {}) {
  const results = [];
  for (const options of await sdkBuildOptions(root)) results.push(await build({ ...options, plugins }));
  if (write) {
    const version = sdkVersion(root);
    for (const [i, result] of results.entries()) {
      const bytes = generated(result);
      if (!bytes) throw new Error(`SDK bundle not generated: ${SDK_TARGETS[i].output}`);
      for (const path of outputsOf(SDK_TARGETS[i], version)) await writeGenerated(root, path, bytes);
    }
  }
  return results;
}
export async function verifySDK({ root = ROOT, build = esbuild, plugins = [] } = {}) {
  const results = await buildSDK({ root, build, plugins }), version = sdkVersion(root);
  for (const [i, result] of results.entries()) {
    for (const path of outputsOf(SDK_TARGETS[i], version)) await requireExact(root, path, generated(result));
  }
  return results;
}

/**
 * The package's type declarations, emitted from src/sdk by the installed
 * compiler under src/sdk/tsconfig.json: repository path → text. Only what the
 * entry points' declarations reach is kept. Relative specifiers gain `.js`, so
 * both bundler and Node resolution find the neighbouring declaration. The
 * package declares no dependency, so a declaration that reaches outside src/sdk
 * or names another package stops the build instead of shipping unresolved.
 */
export async function sdkDeclarations(root = ROOT) {
  const ts = (await import('typescript')).default;
  const config = resolve(root, 'src/sdk/tsconfig.json'), read = ts.readConfigFile(config, ts.sys.readFile);
  const parsed = read.error ? undefined : ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(config));
  const said = diagnostics => diagnostics.map(d => `${d.file ? relative(root, d.file.fileName) + ': ' : ''}${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`).join('\n');
  if (!parsed || parsed.errors.length) throw new Error('SDK declarations unavailable: ' + said(parsed ? parsed.errors : [read.error]));
  const source = resolve(root, 'src');
  const program = ts.createProgram({ rootNames: SDK_TARGETS.map(target => resolve(root, target.entry)),
    options: { ...parsed.options, noEmit: false, declaration: true, emitDeclarationOnly: true, declarationMap: false,
      incremental: false, composite: false, rootDir: source, outDir: source, newLine: ts.NewLineKind.LineFeed } });
  const emitted = new Map();
  const result = program.emit(undefined, (name, text) => emitted.set(relative(root, name).split(sep).join('/'), text), undefined, true);
  const problems = [...program.getOptionsDiagnostics(), ...result.diagnostics];
  if (result.emitSkipped || problems.length) throw new Error('SDK declarations unavailable: ' + said(problems));
  const declarations = new Map(), pending = SDK_TARGETS.map(target => target.entry.replace(/\.ts$/, '.d.ts'));
  while (pending.length) {
    const path = pending.pop();
    if (declarations.has(path)) continue;
    let text = emitted.get(path);
    if (text === undefined || !path.startsWith('src/sdk/')) throw new Error(`SDK declarations reach outside src/sdk: ${path}`);
    const references = ts.preProcessFile(text, true, true);
    if (references.referencedFiles.length || references.typeReferenceDirectives.length) throw new Error(`SDK declarations name another package: ${path}`);
    for (const reference of [...references.importedFiles].sort((a, b) => b.pos - a.pos)) {
      // `pos` is the specifier's opening quote; the name follows it verbatim.
      const end = reference.pos + 1 + reference.fileName.length;
      if (!/^\.\.?\//.test(reference.fileName) || text.slice(reference.pos + 1, end) !== reference.fileName) {
        throw new Error(`SDK declarations name another package: ${reference.fileName} in ${path}`);
      }
      text = text.slice(0, end) + '.js' + text.slice(end);
      pending.push(posix.join(posix.dirname(path), reference.fileName + '.d.ts'));
    }
    declarations.set(path, text);
  }
  return new Map([...declarations].sort(([a], [b]) => a < b ? -1 : 1).map(([path, text]) => [path.replace('src/sdk/', SDK_TYPES + '/'), text]));
}
async function retainedDeclarations(root) {
  const entries = await readdir(resolve(root, SDK_TYPES), { recursive: true, withFileTypes: true })
    .catch(error => { if (error?.code === 'ENOENT') return []; throw error; });
  return entries.filter(entry => entry.isFile())
    .map(entry => relative(root, resolve(entry.parentPath, entry.name)).split(sep).join('/')).sort();
}

/** Every file target a package `exports` field declares, through subpaths and conditions. */
const exportTargets = value => typeof value === 'string' ? [value]
  : value !== null && typeof value === 'object' ? Object.values(value).flatMap(exportTargets) : [];
const inPackage = target => posix.join(SDK_PACKAGE, target);
/**
 * The package manifest against this build: it carries the SDK version, every
 * script it exports is one of the generated bundles, every declaration it
 * exports is generated, and it records a size budget for each exported bundle
 * (decision D3). Returns each exported bundle's size beside its budget. The
 * budget is the owner's number: nothing here writes it.
 */
async function manifestReport(root, manifest, declarations) {
  const version = sdkVersion(root), bundles = SDK_TARGETS.map(packageOutput);
  if (manifest.version !== version) throw new Error(`${SDK_MANIFEST}: version ${JSON.stringify(manifest.version)} is not the SDK version ${version} (${VERSION_SOURCE})`);
  const targets = [...new Set(exportTargets(manifest.exports))];
  const scripts = targets.filter(target => /\.[cm]?js$/.test(target)).map(inPackage);
  for (const file of scripts) if (!bundles.includes(file)) throw new Error(`${SDK_MANIFEST}: exports ${file}, which this build does not generate`);
  for (const file of bundles) if (!scripts.includes(file)) throw new Error(`${SDK_MANIFEST}: does not export the generated bundle ${file}`);
  for (const file of targets.filter(target => /\.d\.[cm]?ts$/.test(target)).map(inPackage)) {
    if (!declarations.has(file)) throw new Error(`${SDK_MANIFEST}: exports ${file}, which this build does not generate`);
  }
  const recorded = manifest.sizeBudget !== null && typeof manifest.sizeBudget === 'object' && !Array.isArray(manifest.sizeBudget)
    ? new Map(Object.entries(manifest.sizeBudget).map(([target, bytes]) => [inPackage(target), bytes])) : new Map();
  const report = [];
  for (const file of scripts) {
    const budget = recorded.get(file), bytes = (await retained(root, file))?.length;
    if (!Number.isSafeInteger(budget) || budget < 0) throw new Error(`${SDK_MANIFEST}: sizeBudget records no whole number of bytes for ${file}`);
    if (bytes === undefined) throw new Error(`Generated asset mismatch: ${file}; retained=missing`);
    report.push({ file, bytes, budget });
  }
  return report;
}
const overBudget = ({ file, bytes, budget }) => `SDK size budget exceeded: ${file} is ${bytes} bytes, ${bytes - budget} over its budget of ${budget} (${SDK_MANIFEST} sizeBudget)`;
const readManifest = async root => JSON.parse(await readFile(resolve(root, SDK_MANIFEST), 'utf8'));

/** The package is exactly what this build generates, and no exported bundle is over its recorded budget. */
export async function verifyPackage({ root = ROOT } = {}) {
  const declarations = await sdkDeclarations(root);
  for (const [path, text] of declarations) await requireExact(root, path, Buffer.from(text));
  for (const path of await retainedDeclarations(root)) {
    if (!declarations.has(path)) throw new Error(`Generated asset mismatch: ${path}; retained=${hash(await readFile(resolve(root, path)))}; generated=missing`);
  }
  const report = await manifestReport(root, await readManifest(root), declarations);
  for (const row of report) if (row.bytes > row.budget) throw new Error(overBudget(row));
  return { declarations: declarations.size, report };
}
/** Write the package's generated files and carry the SDK version into its manifest; an exceeded budget is reported, never rewritten. */
export async function writePackage({ root = ROOT } = {}) {
  const declarations = await sdkDeclarations(root);
  for (const [path, text] of declarations) await writeGenerated(root, path, Buffer.from(text));
  for (const path of await retainedDeclarations(root)) if (!declarations.has(path)) await unlink(resolve(root, path));
  const manifest = await readManifest(root), version = sdkVersion(root);
  if (manifest.version !== version) {
    manifest.version = version;
    await writeFile(resolve(root, SDK_MANIFEST), JSON.stringify(manifest, null, 2) + '\n');
  }
  return { declarations: declarations.size, report: await manifestReport(root, manifest, declarations) };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || args[0] !== '--check')) throw new Error('Use build-sdk.mjs [--check]');
  const check = args.length === 1, exact = check ? 'exact nonwriting match; ' : '', { log, error } = console;
  const results = check ? await verifySDK() : await buildSDK({ write: true });
  for (const [i, result] of results.entries()) log(`${SDK_TARGETS[i].output}: ${exact}${Object.values(result.metafile.outputs)[0].bytes} bytes`);
  const { declarations, report } = check ? await verifyPackage() : await writePackage();
  log(`public/sdk/${sdkVersion()}: ${exact}the same ${results.length} bundles under the version's path`);
  log(`${SDK_TYPES}: ${exact}${declarations} declaration files`);
  for (const row of report) {
    log(`${row.file}: ${exact}${row.bytes} bytes of a ${row.budget}-byte budget`);
    if (row.bytes > row.budget) error(overBudget(row));
  }
}
