// src/demos/meridian/normalise-images.mjs
//
// Normalises apparent product size across the catalogue.
//
// Generation frames each product to its own taste: the loafer filled its square,
// the turtleneck sat small in the middle of its own. A merchandising row reads as
// one shelf only when apparent product size is consistent, so every packshot is
// cropped to its own content and re-placed at the same scale on white — which is
// what a commercial packshot pipeline does after the shoot.
//
//   node src/demos/meridian/normalise-images.mjs

import sharp from 'sharp';
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'public/meridian/img';
const SIZE = 800;          // output square
const FILL = 0.80;         // fraction of the frame the product occupies
const WHITE_AT = 244;      // anything lighter than this is ground, not product

/** Bounding box of everything that is not studio white. */
async function contentBox(file) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels;
      // Mean of RGB — a soft contact shadow is content too, and cropping it off
      // would make products look like they float.
      if ((data[i] + data[i + 1] + data[i + 2]) / 3 < WHITE_AT) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.jpg')).sort();
const before = [];
const after = [];

for (const f of files) {
  const path = join(DIR, f);
  const box = await contentBox(path);
  if (!box) { console.log(`  skip  ${f}  (no content found)`); continue; }

  const meta = await sharp(path).metadata();
  before.push(Math.max(box.width, box.height) / Math.max(meta.width, meta.height));

  const target = Math.round(SIZE * FILL);
  const product = await sharp(path)
    .extract(box)
    .resize(target, target, { fit: 'inside' })
    .toBuffer();
  const pm = await sharp(product).metadata();

  const out = await sharp({
    create: { width: SIZE, height: SIZE, channels: 3, background: '#ffffff' },
  })
    .composite([{
      input: product,
      left: Math.round((SIZE - pm.width) / 2),
      top: Math.round((SIZE - pm.height) / 2),
    }])
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();

  writeFileSync(path, out);
  after.push(Math.max(pm.width, pm.height) / SIZE);
}

const spread = (a) => `${(Math.min(...a) * 100).toFixed(0)}%–${(Math.max(...a) * 100).toFixed(0)}%`;
console.log(`normalised ${after.length} images`);
console.log(`  apparent size before: ${spread(before)}`);
console.log(`  apparent size after:  ${spread(after)}`);
