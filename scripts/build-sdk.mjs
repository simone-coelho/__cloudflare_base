// Bundles the customer SDK for the browser: one package, two module builds.
//
//   public/sdk/edge-personalization.esm.js   import { createClient } from '/sdk/edge-personalization.esm.js'
//   public/sdk/edge-personalization.js       <script src>, then window.EdgePersonalization.createClient(...)
//
// Unminified on purpose, like the Meridian engine bundle: an integrator will
// open it, and the integration guide quotes it. Run: npm run build:sdk
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = readFileSync(join(ROOT, 'src/sdk/version.ts'), 'utf8').match(/'([^']+)'/)[1];
const banner = `/* edge-personalization SDK v${version} — one package: core (identity, transport), emit (four capture paths), listen (decisions). */`;

const common = {
  bundle: true, platform: 'browser', target: 'es2022', minify: false, sourcemap: false,
  legalComments: 'none', logLevel: 'info', metafile: true, banner: { js: banner },
};

const esm = await esbuild.build({
  ...common,
  entryPoints: [join(ROOT, 'src/sdk/index.ts')],
  outfile: join(ROOT, 'public/sdk/edge-personalization.esm.js'),
  format: 'esm',
});
const iife = await esbuild.build({
  ...common,
  entryPoints: [join(ROOT, 'src/sdk/browser.ts')],
  outfile: join(ROOT, 'public/sdk/edge-personalization.js'),
  format: 'iife',
});
for (const r of [esm, iife]) {
  const out = Object.values(r.metafile.outputs)[0];
  console.log(`${Object.keys(r.metafile.outputs)[0]}  ${(out.bytes / 1024).toFixed(1)} KB`);
}
