#!/usr/bin/env node
// scripts/demo-kit/fetch-imagery.mjs — a demo's product images, fetched once by URL list and recorded.
//
// Driven by the config's imagery section: for every source, download (cached outside the checkout), cut
// out, normalise to one apparent size on a transparent ground, encode WebP, PNG and a JPEG on white, and
// record provenance and the defect-check verdict per file in the manifest. A verdict (the section's `gate`,
// or the previous manifest row's) holds only for the sha256 it was given to. A demo's own fetch script is a
// thin wrapper over this one (Vantage: scripts/fetch-vantage-devices.mjs).
//
//   node scripts/demo-kit/fetch-imagery.mjs --config scripts/demo-kit/configs/vantage.json
//        [--only id,id] [--force] [--refetch] [--out <dir>] [--cache <dir>] [--date YYYY-MM-DD]
//        [--gate-from <manifest>] [--sheet <png>]
//
// --out        write the images and the manifest under <dir> instead of the demo's image directory
// --cache      where raw downloads are kept (default: <OS temp>/<imagery.cacheName>, as the Vantage script's)
// --force      re-normalise what is already on disk (--refetch also re-downloads)
// --gate-from  read verdicts from another manifest (read-only), still bound to each file's sha256
// --sheet      also write a contact sheet for the defect check
//
// On a Windows checkout whose node_modules carries the Linux sharp binary, run it under WSL:
//   wsl -e bash -lc 'cd /mnt/c/.../__cloudflare_base && node scripts/demo-kit/fetch-imagery.mjs --config …'
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { isEntry } from './lib/cli.mjs';
import { argOf, configArg, loadValidConfig } from './lib/config.mjs';
import { contactSheet, fetchImagery, loadSharp } from './lib/imagery.mjs';

export const USAGE = 'usage: node scripts/demo-kit/fetch-imagery.mjs --config <file> [--only id,id] [--force] [--refetch] [--out <dir>] [--cache <dir>] [--date YYYY-MM-DD] [--gate-from <manifest>] [--sheet <png>]';

/** The imagery fetch, from a command line. Returns the exit code: 0 every image made or kept, 1 one failed, 2 a usage or config error. */
export async function main(argv = process.argv.slice(2)) {
  const file = configArg(argv, ['--config', '--only', '--out', '--cache', '--date', '--gate-from', '--sheet']);
  if (!file) { console.error(USAGE); return 2; }
  const { config, path } = loadValidConfig(file, { sections: ['imagery'] });
  const imagery = config.imagery;
  const only = (argOf(argv, '--only', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = only.filter((id) => !imagery.sources.some((s) => s.id === id));
  if (unknown.length) { console.error(`✗ --only names ${unknown.join(', ')}, not in imagery.sources`); return 2; }
  try { loadSharp(); } catch (error) { console.error(`✗ ${error.message}`); return 2; }

  const out = argOf(argv, '--out');
  const outDir = out ? resolve(process.cwd(), out) : path(imagery.dir);
  const manifestPath = out ? join(outDir, basename(imagery.manifest)) : path(imagery.manifest);
  const cacheDir = argOf(argv, '--cache') ? resolve(process.cwd(), argOf(argv, '--cache')) : (process.env.DEMO_KIT_IMAGERY_CACHE || join(tmpdir(), imagery.cacheName));
  const retrieved = argOf(argv, '--date', new Date().toISOString().slice(0, 10));
  const gateFrom = argOf(argv, '--gate-from') ? resolve(process.cwd(), argOf(argv, '--gate-from')) : null;

  const result = await fetchImagery({ imagery, outDir, manifestPath, cacheDir, only, force: argv.includes('--force'), refetch: argv.includes('--refetch'), retrieved, gateFrom });
  const sheet = argOf(argv, '--sheet');
  if (sheet) console.log(`sheet: ${await contactSheet({ rows: result.rows, imgDir: outDir, file: resolve(process.cwd(), sheet) })} images → ${sheet}`);
  return result.failed ? 1 : 0;
}

if (isEntry(import.meta.url)) process.exit(await main());
