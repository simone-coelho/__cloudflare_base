// The demo engine uses the same authored TypeScript as the Worker. Import-safe;
// --check compares exact bytes without replacing a caller's dirty bundle.
import { build as esbuild } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const MERIDIAN_OUTPUT = 'public/meridian/engine.bundle.js';
export function meridianBuildOptions(root = ROOT) {
  return { absWorkingDir: root, entryPoints: ['src/demos/meridian/client-engine.ts'], outfile: MERIDIAN_OUTPUT,
    bundle: true, format: 'esm', target: 'es2022', platform: 'browser', minify: false,
    sourcemap: false, legalComments: 'none', alias: { '@': resolve(root, 'src') },
    logLevel: 'silent', metafile: true, write: false };
}
export async function buildMeridian({ root = ROOT, write = false, build = esbuild, plugins = [] } = {}) {
  return build({ ...meridianBuildOptions(root), write, plugins });
}
export async function verifyMeridian({ root = ROOT, build = esbuild, plugins = [] } = {}) {
  const result = await buildMeridian({ root, build, plugins }), actual = await readFile(resolve(root, MERIDIAN_OUTPUT));
  const expected = result.outputFiles?.[0]?.contents;
  if (result.outputFiles?.length !== 1 || !expected || !actual.equals(Buffer.from(expected))) {
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    throw new Error(`Generated asset mismatch: ${MERIDIAN_OUTPUT}; retained=${hash(actual)}; generated=${expected ? hash(expected) : 'missing'}`);
  }
  return result;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || args[0] !== '--check')) throw new Error('Use build-meridian.mjs [--check]');
  const result = args.length ? await verifyMeridian() : await buildMeridian({ write: true });
  console.log(`${MERIDIAN_OUTPUT}: ${args.length ? 'exact nonwriting match; ' : ''}${Object.values(result.metafile.outputs)[0].bytes} bytes`);
}
