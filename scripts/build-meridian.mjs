// Bundles the Meridian engine modules for the browser.
//
// The composer ships to the client so a slot repaints the instant a frame lands,
// with no network round trip. Bundling the SAME TypeScript the worker imports —
// rather than maintaining a JS twin — is what keeps the explain record the room
// reads identical to the arithmetic that actually chose the item.
//
//   node scripts/build-meridian.mjs
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const result = await esbuild.build({
  entryPoints: [join(ROOT, 'src/demos/meridian/client-engine.ts')],
  outfile: join(ROOT, 'public/meridian/engine.bundle.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  minify: false,          // readable on purpose: an engineer in the room may open it
  sourcemap: false,
  legalComments: 'none',
  alias: { '@': join(ROOT, 'src') },
  logLevel: 'info',
  metafile: true,
});

const out = Object.values(result.metafile.outputs)[0];
console.log(`engine.bundle.js  ${(out.bytes / 1024).toFixed(1)} KB`);
