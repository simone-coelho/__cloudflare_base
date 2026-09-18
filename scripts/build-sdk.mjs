// Shared SDK build options. Importing this module never writes generated assets.
import { build as esbuild } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const SDK_TARGETS = [
  { entry: 'src/sdk/index.ts', output: 'public/sdk/edge-personalization.esm.js', format: 'esm' },
  { entry: 'src/sdk/browser.ts', output: 'public/sdk/edge-personalization.js', format: 'iife' },
];
export async function sdkBuildOptions(root = ROOT) {
  const source = await readFile(resolve(root, 'src/sdk/version.ts'), 'utf8');
  const version = source.match(/'([^']+)'/)?.[1];
  if (!version) throw new Error('SDK version unavailable');
  return sdkOptionsForVersion(root, version);
}
export function sdkOptionsForVersion(root, version) {
  return SDK_TARGETS.map(target => ({
    absWorkingDir: root, entryPoints: [target.entry], outfile: target.output, format: target.format,
    bundle: true, platform: 'browser', target: 'es2022', minify: false, sourcemap: false,
    legalComments: 'none', logLevel: 'silent', metafile: true, write: false,
    banner: { js: `/* edge-personalization SDK v${version} — one package: core (identity, transport), emit (four capture paths), listen (decisions). */` },
  }));
}
export async function buildSDK({ root = ROOT, write = false, build = esbuild, plugins = [] } = {}) {
  const results = [];
  for (const options of await sdkBuildOptions(root)) results.push(await build({ ...options, write, plugins }));
  return results;
}
export async function verifySDK({ root = ROOT, build = esbuild, plugins = [] } = {}) {
  const results = await buildSDK({ root, build, plugins });
  for (const [i, result] of results.entries()) {
    const path = SDK_TARGETS[i].output, actual = await readFile(resolve(root, path));
    const expected = result.outputFiles?.[0]?.contents;
    if (result.outputFiles?.length !== 1 || !expected || !actual.equals(Buffer.from(expected))) {
      const hash = bytes => createHash('sha256').update(bytes).digest('hex');
      throw new Error(`Generated asset mismatch: ${path}; retained=${hash(actual)}; generated=${expected ? hash(expected) : 'missing'}`);
    }
  }
  return results;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || args[0] !== '--check')) throw new Error('Use build-sdk.mjs [--check]');
  const results = args.length ? await verifySDK() : await buildSDK({ write: true });
  for (const [i, result] of results.entries()) console.log(`${SDK_TARGETS[i].output}: ${args.length ? 'exact nonwriting match; ' : ''}${Object.values(result.metafile.outputs)[0].bytes} bytes`);
}
