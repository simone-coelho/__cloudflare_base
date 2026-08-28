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
import { readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'public/meridian/img';
const SIZE = 800;          // output square
const FILL = 0.80;         // fraction of the frame the product occupies
const WHITE_AT = 244;      // anything lighter than this is ground, not product

/**
 * White-point the studio ground BEFORE anything else. The prompt demands
 * #FFFFFF and the model routinely delivers ~#F0F0F0; left alone, that ground
 * survives the content crop and ships as a visible grey TILE on the pure-white
 * card. The fix is the one a commercial retouch pipeline uses: read the ground
 * off the border ring (per channel), scale it to true white, clamp. The product
 * brightens by the same few percent — which is exactly what re-shooting on a
 * properly lit white ground would have done.
 */
function whitepoint(data, info) {
  const { width, height, channels } = info;
  const ring = [[], [], []];
  const take = (x, y) => {
    const i = (y * width + x) * channels;
    ring[0].push(data[i]); ring[1].push(data[i + 1]); ring[2].push(data[i + 2]);
  };
  for (let x = 0; x < width; x += 4) { take(x, 0); take(x, 1); take(x, height - 2); take(x, height - 1); }
  for (let y = 0; y < height; y += 4) { take(0, y); take(1, y); take(width - 2, y); take(width - 1, y); }
  const median = (a) => a.sort((p, q) => p - q)[Math.floor(a.length / 2)];
  const ground = ring.map(median);
  if (Math.min(...ground) >= 252) return false;          // already white — leave the pixels alone
  // Cap the lift: a ground under ~#D0 is not a white studio, it is a bad frame
  // that should be regenerated rather than silently rescued.
  const scale = ground.map((g) => Math.min(255 / Math.max(g, 208), 1.25));
  for (let i = 0; i < data.length; i += channels) {
    for (let c = 0; c < 3; c += 1) data[i + c] = Math.min(255, Math.round(data[i + c] * scale[c]));
  }
  return true;
}

/** Bounding box of everything that is not studio white. */
function contentBoxOf(data, info) {
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

// build-images.mjs writes PNG (what the model returns); the committed, served
// catalogue is JPG. Both are accepted here, and a PNG leaves as a JPG — the
// normalise pass IS the png→jpg step, so there is no separate conversion tool.
const files = readdirSync(DIR).filter((f) => f.endsWith('.jpg') || f.endsWith('.png')).sort();
const before = [];
const after = [];

for (const f of files) {
  const path = join(DIR, f);
  const outPath = join(DIR, f.replace(/\.(jpg|png)$/, '.jpg'));
  const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true });
  const lifted = whitepoint(data, info);
  const box = contentBoxOf(data, info);
  if (!box) { console.log(`  skip  ${f}  (no content found)`); continue; }
  if (lifted) console.log(`  white-pointed  ${f}  (ground was grey)`);

  before.push(Math.max(box.width, box.height) / Math.max(info.width, info.height));

  const target = Math.round(SIZE * FILL);
  const product = await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
    .extract(box)
    .resize(target, target, { fit: 'inside' })
    .png()
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

  writeFileSync(outPath, out);
  if (path !== outPath) unlinkSync(path);
  after.push(Math.max(pm.width, pm.height) / SIZE);
}

const spread = (a) => `${(Math.min(...a) * 100).toFixed(0)}%–${(Math.max(...a) * 100).toFixed(0)}%`;
console.log(`normalised ${after.length} images`);
console.log(`  apparent size before: ${spread(before)}`);
console.log(`  apparent size after:  ${spread(after)}`);
