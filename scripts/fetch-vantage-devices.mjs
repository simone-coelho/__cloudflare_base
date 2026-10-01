#!/usr/bin/env node
// scripts/fetch-vantage-devices.mjs — the Vantage phone images, fetched once from the makers' own sites.
//
// The carrier demo shows real phones by their real names (docs/verizon/Vantage-Demo-Design.md §1, §7).
// Every image here is the maker's own product render, taken at DESIGN TIME from the maker's own site
// (Apple's store, Samsung's US store, the Google Store, Motorola's press box), normalised to one
// apparent size on a transparent ground, and committed. Nothing is fetched on the serving path.
//
// A THIN WRAPPER since the demo kit's part b (2026-10-01): it runs scripts/demo-kit/fetch-imagery.mjs with
// scripts/demo-kit/configs/vantage.json and passes every flag through unchanged. The lineup (each device's
// source page and URLs, what a US carrier sells on 2026-09-30), the makers' licence notes and the human
// defect-check verdicts are scripts/demo-kit/configs/vantage/imagery.json (`sources`, `licences`, `gate`);
// the pixel work is scripts/demo-kit/lib/imagery.mjs.
//
//   node scripts/fetch-vantage-devices.mjs                 fetch what is missing, normalise, write the manifest
//   node scripts/fetch-vantage-devices.mjs --force         re-normalise everything (--refetch also re-downloads)
//   node scripts/fetch-vantage-devices.mjs --only iphone-18-pro,pixel-11
//   node scripts/fetch-vantage-devices.mjs --sheet <png>   also write a contact sheet for the defect check
//   node scripts/fetch-vantage-devices.mjs --cache <dir>   where raw downloads are kept (default: OS temp dir,
//                                                          or VANTAGE_DEVICE_CACHE)
//   --date YYYY-MM-DD the retrieval date recorded (default today); --out <dir> writes the images and the
//   manifest there instead (a proof); --gate-from <manifest> reads verdicts from another manifest
//
// On a Windows checkout whose node_modules carries the Linux sharp binary, run it under WSL:
//   wsl -e bash -lc 'cd /mnt/c/.../__cloudflare_base && node scripts/fetch-vantage-devices.mjs'
//
// Output, per device: public/vantage/img/devices/<id>.webp (transparent, 800x800), <id>.png and <id>.jpg
// (white). Provenance for each file (source page, source URL, retrieval date, sha256, licence note, the
// human defect-check verdict) goes to public/vantage/img/MANIFEST.json under "devices". A verdict holds
// only for the sha256 it was given to: a re-fetch that changes one byte reads "pending" until someone looks
// at the contact sheet at 1:1 and records the new sha256 in imagery.json's `gate`. Raw downloads are never
// committed. A phone without a file renders the palette placeholder (img/placeholder-device.svg), never a
// broken tag.
import { fileURLToPath } from 'node:url';
import { isEntry, wrappedArgv } from './demo-kit/lib/cli.mjs';
import { main } from './demo-kit/fetch-imagery.mjs';

const CONFIG = fileURLToPath(new URL('./demo-kit/configs/vantage.json', import.meta.url));

if (isEntry(import.meta.url)) {
  process.exit(await main(wrappedArgv(CONFIG, process.argv.slice(2), { envFlags: { VANTAGE_DEVICE_CACHE: '--cache' } })));
}
