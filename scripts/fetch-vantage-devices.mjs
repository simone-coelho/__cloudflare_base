#!/usr/bin/env node
// scripts/fetch-vantage-devices.mjs — the Vantage phone images, fetched once from the makers' own sites.
//
// The carrier demo shows real phones by their real names (docs/verizon/Vantage-Demo-Design.md §1, §7).
// Every image here is the maker's own product render, taken at DESIGN TIME from the maker's own site
// (Apple's store, Samsung's US store, the Google Store, Motorola's press box), normalised to one
// apparent size on a transparent ground, and committed. Nothing is fetched on the serving path.
//
//   node scripts/fetch-vantage-devices.mjs                 fetch what is missing, normalise, write the manifest
//   node scripts/fetch-vantage-devices.mjs --force         re-normalise everything (--refetch also re-downloads)
//   node scripts/fetch-vantage-devices.mjs --only iphone-18-pro,pixel-11
//   node scripts/fetch-vantage-devices.mjs --sheet <png>   also write a contact sheet for the defect check
//   node scripts/fetch-vantage-devices.mjs --cache <dir>   where raw downloads are kept (default: OS temp dir)
//
// On a Windows checkout whose node_modules carries the Linux sharp binary, run it under WSL:
//   wsl -e bash -lc 'cd /mnt/c/.../__cloudflare_base && node scripts/fetch-vantage-devices.mjs'
//
// Output, per device: public/vantage/img/devices/<id>.webp (transparent, 800x800) and <id>.jpg (white).
// Provenance for each file (source page, source URL, retrieval date, sha256, licence note, the human
// defect-check verdict) goes to public/vantage/img/MANIFEST.json under "devices". Raw downloads are
// never committed. A phone without a file renders the palette placeholder (img/placeholder-device.svg),
// never a broken tag.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const sharp = createRequire(import.meta.url)('sharp');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
// argv is already sliced, so a flag at index 0 is real: `i >= 0`, not `i > 0`.
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const IMG = join(ROOT, 'public', 'vantage', 'img');
const OUT = join(IMG, 'devices');
const MANIFEST = join(IMG, 'MANIFEST.json');
const CACHE = arg('--cache', process.env.VANTAGE_DEVICE_CACHE || join(tmpdir(), 'vantage-device-cache'));
const RETRIEVED = arg('--date', new Date().toISOString().slice(0, 10));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

const SIZE = 800;   // output square, the size Meridian's normaliser uses
const FILL = 0.86;  // fraction of the frame the product's longer side occupies

/**
 * What each maker's source says, recorded as found. None of these pages grants a general licence;
 * the images are the makers' own product renders, used unmodified apart from crop, scale and ground,
 * to identify each phone in an internal demonstration. Any public or recorded use needs Legal first.
 */
const LICENCE = {
  apple: 'Official product render published by Apple on apple.com (Apple Store buy page). © Apple Inc.; iPhone and Apple are Apple trademarks. No licence is granted by the page; used only to identify the product in an internal demo. Crop, scale and ground only.',
  samsung: 'Official product render published by Samsung on samsung.com/us (unlocked SKU, so no carrier variant). © Samsung Electronics; Galaxy is a Samsung trademark. No licence is granted by the page; used only to identify the product in an internal demo. Crop, scale and ground only.',
  google: 'Official product renders published by Google on the Google Store (store.google.com, unlocked SKU). © Google LLC; Pixel is a Google trademark. No licence is granted by the page; used only to identify the product in an internal demo. The back and front renders are placed as a pair by this script; each render is unmodified apart from scale and ground.',
  motorola: 'Official press-box image from Motorola News (motorolanews.com/pressbox, Motorola\'s own newsroom, "All rights reserved"). © Motorola Mobility LLC; razr and moto are Motorola trademarks. Press-box images are published for media use; used only to identify the product in an internal demo. Crop, scale and ground only.',
};

const APPLE = (name) => `https://store.storeimages.cdn-apple.com/1/as-images.apple.com/is/${name}?wid=1880&hei=2224&fmt=png-alpha`;
const SAMSUNG = (path) => `https://images.samsung.com/is/image/samsung/p6pim/us/${path}?fmt=png-alpha&scl=1`;
const GSTORE = (key) => `https://lh3.googleusercontent.com/${key}=s0`;

/**
 * The lineup: what a US carrier sells on 2026-09-30 (verizon.com's public grid and phone pages, the
 * makers' own buy pages). `pair` is the maker's own back-and-front render; `compose` places the
 * maker's separate back and front renders side by side, the way the maker's own press image does.
 * `key` removes an opaque studio ground by flood-filling from the border only, so nothing inside the
 * phone's outline can ever be cut.
 */
export const DEVICES = [
  { id: 'iphone-18-pro-max', name: 'Apple iPhone 18 Pro Max', maker: 'apple', colour: 'Glacier',
    page: 'https://www.apple.com/shop/buy-iphone/iphone-18-pro', kind: 'pair',
    src: [{ role: 'pair', url: APPLE('iphone-18-pro-max-finish-select-glacier-202609') }] },
  { id: 'iphone-18-pro', name: 'Apple iPhone 18 Pro', maker: 'apple', colour: 'Burgundy',
    page: 'https://www.apple.com/shop/buy-iphone/iphone-18-pro', kind: 'pair',
    src: [{ role: 'pair', url: APPLE('iphone-18-pro-finish-select-burgundy-202609') }] },
  { id: 'iphone-duo', name: 'Apple iPhone Duo', maker: 'apple', colour: 'Night Sky',
    page: 'https://www.apple.com/shop/buy-iphone/iphone-duo', kind: 'pair',
    src: [{ role: 'pair', url: APPLE('iphone-duo-finish-select-night-sky-202609') }] },
  { id: 'iphone-air', name: 'Apple iPhone Air', maker: 'apple', colour: 'Sky Blue',
    page: 'https://www.apple.com/shop/buy-iphone/iphone-air', kind: 'pair',
    src: [{ role: 'pair', url: APPLE('iphone-air-finish-select-skyblue-202509') }] },
  { id: 'iphone-17', name: 'Apple iPhone 17', maker: 'apple', colour: 'Sage',
    page: 'https://www.apple.com/shop/buy-iphone/iphone-17', kind: 'pair',
    src: [{ role: 'pair', url: APPLE('iphone-17-finish-select-sage-202509_GEO_US') }] },
  { id: 'galaxy-s26-ultra', name: 'Samsung Galaxy S26 Ultra', maker: 'samsung', colour: 'Black',
    page: 'https://www.samsung.com/us/smartphones/galaxy-s26-ultra/buy/', kind: 'pair',
    src: [{ role: 'pair', url: SAMSUNG('s2602/gallery/us-galaxy-s26-ultra-s948-sm-s948uzkaxaa-550993359') }] },
  { id: 'galaxy-s26-plus', name: 'Samsung Galaxy S26+', maker: 'samsung', colour: 'Cobalt Violet',
    page: 'https://www.samsung.com/us/smartphones/galaxy-s26-plus/buy/', kind: 'pair',
    src: [{ role: 'pair', url: SAMSUNG('s2602/gallery/us-galaxy-s26-s947-sm-s947uzvaxaa-550994937') }] },
  { id: 'galaxy-s26', name: 'Samsung Galaxy S26', maker: 'samsung', colour: 'White',
    page: 'https://www.samsung.com/us/smartphones/galaxy-s26/buy/', kind: 'pair',
    src: [{ role: 'pair', url: SAMSUNG('s2602/gallery/us-galaxy-s26-s942-sm-s942uzwexaa-550995764') }] },
  { id: 'galaxy-z-fold8', name: 'Samsung Galaxy Z Fold8', maker: 'samsung', colour: 'Graphite',
    page: 'https://www.samsung.com/us/smartphones/galaxy-z-fold8/buy/', kind: 'pair',
    src: [{ role: 'pair', url: SAMSUNG('f2607/gallery/us-galaxy-z-fold8-f971-600257-sm-f971uzkaxaa-553841319') }] },
  { id: 'galaxy-z-flip8', name: 'Samsung Galaxy Z Flip8', maker: 'samsung', colour: 'Pink',
    page: 'https://www.samsung.com/us/smartphones/galaxy-z-flip8/buy/', kind: 'pair',
    src: [{ role: 'pair', url: SAMSUNG('f2607/gallery/us-galaxy-zflip8-f776-sm-f776uliaxaa-553843032') }] },
  { id: 'pixel-11-pro-xl', name: 'Google Pixel 11 Pro XL', maker: 'google', colour: 'Canyon', spare: 'not in phones.json on 2026-09-30; ready if it is added',
    page: 'https://store.google.com/us/config/pixel_11_pro?hl=en-US', kind: 'compose',
    src: [{ role: 'back', url: GSTORE('jEVeFlAk_7Dy27zIImbR5s0tX--gd9pjhrItGqBriNCF7NDrGzfiqf48V_LbB2srWU29xkuoZzbJgsBtBWPydKgoLjq5tBbO5_o') },
      { role: 'front', url: GSTORE('8zef4fGTcFZobQv7kgKa0mlPWF3hUON4dzIhPTZ4cdd2teR6L9LSA6B-luoqFbfPmszWODZ_XRZXdXbuAPoJflt4pWBwWNd_Xg') }] },
  { id: 'pixel-11-pro', name: 'Google Pixel 11 Pro', maker: 'google', colour: 'Fog',
    page: 'https://store.google.com/us/config/pixel_11_pro?hl=en-US', kind: 'compose',
    src: [{ role: 'back', url: GSTORE('z9YDvMS3im_9IxTkZrqOpFKbnsR7NwOJ6anTSxUJmuj7MxNPD6D0lZIAXnqGk33QNnI2sEpe1w3kNosJHy8yuZgA85M1BFJXvxA') },
      { role: 'front', url: GSTORE('NjsIE4dhO3c3zSHglEJDjKWZlaXS92TnjoUCXyKumttGOzBGauXJSVQtO2xschcmeTz1Y9iniYcG_M3AALDmO1QbD1fL23NSUuY') }] },
  { id: 'pixel-11', name: 'Google Pixel 11', maker: 'google', colour: 'Frost',
    page: 'https://store.google.com/us/config/pixel_11?hl=en-US', kind: 'compose',
    src: [{ role: 'back', url: GSTORE('kyHms-QRU2yPH7fecJnDdhXdRXWYQOismjTeOPYkQAZyzuS2VM6XjcmLnK_DxKw395F45EvItfctXpBadIOZhrN6lpqhB55pCw') },
      { role: 'front', url: GSTORE('8mhmE9H4q6GY7rEkTJaRgXfBoqWQ1basSU39-M7nEqhdexfsOP7XQMgLTJQidiuQuFFtJgW1bSEwk5sMncrR8CtvAFOqJBfxE5ie') }] },
  { id: 'pixel-10a', name: 'Google Pixel 10a', maker: 'google', colour: 'Lavender',
    page: 'https://store.google.com/us/config/pixel_10a?hl=en-US', kind: 'compose',
    src: [{ role: 'back', url: GSTORE('IdB9Le3UUPMZBqGC5TduhBB8n12Dv8xKFJpmOnyWzLf0IHN_4qoXupO-3mTGstYuI-NETHcrhG2LdU85dXCH59OJ8HVf_-WftV8') },
      // the store shoots the 10a front on black JPEG; its block noise needs a wider key than a clean ground
      { role: 'front', url: GSTORE('9EjM7hLTMa6gUVkxl44VV_qHqJUBpnt9SLQpbwq9_DErsjofjDkB7phtHMwxm5G-yH0Kh7Sx6L4LauKI8v1WtBskRl5K9DRYPyc'), key: 'black', keyTol: 72 }] },
  { id: 'razr-2026', name: 'Motorola razr (2026)', maker: 'motorola', colour: 'PANTONE Sporting Green',
    page: 'https://motorolanews.com/pressbox/motorola-razr/motorola-razr-70-motorola-razr/', kind: 'pair',
    // the press hero floats the two phones over a floor shadow that runs off the frame: dropped
    src: [{ role: 'pair', url: 'https://motorolanews.com/download/905/motorola-razr-70-razr/194871/razr-70-sporting-green-hero.png', shadow: 'remove' }] },
  { id: 'edge-2026', name: 'Motorola edge (2026)', maker: 'motorola', colour: 'PANTONE Martini Olive',
    page: 'https://motorolanews.com/pressbox/motorola-edge-family/motorola-edge-2026/', kind: 'pair',
    src: [{ role: 'pair', url: 'https://motorolanews.com/download/933/motorola-edge-2026/228545/motorola-edge-2026_pdp-hero.png' }] },
  { id: 'moto-g-2026', name: 'Motorola moto g (2026)', maker: 'motorola', colour: 'PANTONE Slipstream',
    page: 'https://motorolanews.com/pressbox/moto-g-family/moto-g-2026/', kind: 'pair',
    src: [{ role: 'pair', url: 'https://motorolanews.com/download/759/pantone-slipstream/171017/2026_moto-g-hero_slipstream.png' }] },
];

/**
 * The human defect check, bound to the exact output file. A verdict applies only while the file's
 * sha256 matches the one reviewed; a re-fetch that changes a single byte puts the image back to
 * "pending" until someone looks again. Filled in after the contact sheet has been read at 1:1.
 */
const OK = (sha, note) => ({ verdict: 'accept', checked: '2026-09-30', sha, note });
export const GATE = {
  'iphone-18-pro-max': OK('866decdd9c4bc6392bca6f0f1678a0ac22e07d84abb62274e0ad68fdf266ec0a', 'Apple\'s own back-and-front pair; edges intact; only the Apple mark on the back; wallpaper on screen, no status bar, no carrier name.'),
  'iphone-18-pro': OK('4710ecc5ff8efed8760e1cf7dde7b2a8cbbfbbbd62c8417357f8f8d513e8a35e', 'Apple\x27s own back-and-front pair in the launch colour; edges intact; Apple mark only; clean at 1:1.'),
  'iphone-duo': OK('af9dff3cfeb7c1c00cb965ddf3ff703a686da3c3e7e940b8fda1a7cbd14c8007', 'Back and the open inner display. Wider than tall, so it fills by width and sits lower than the bar phones: correct, not a framing fault.'),
  'iphone-air': OK('8ce5713f3bc3bd9363e1e41503ce48542127e5aa9a20bd06044e1a610ca8d610', 'Apple\x27s own back-and-front pair in Sky Blue; edges intact; Apple mark only.'),
  'iphone-17': OK('9802af1c7a0a3c4e89d1296392e153738185938659ea8ed8ba432dc0247edd78', 'US (eSIM-only) render; clean.'),
  'galaxy-s26-ultra': OK('255347990688db7d8e7c3621422230f208ebae6218022d61f9c6d73ddd0105d0', 'Samsung\'s default pair with the S Pen, as Samsung shoots it; SAMSUNG wordmark on the back is the maker\'s own; unlocked SKU image.'),
  'galaxy-s26-plus': OK('42e4cd9aca7d9df95f562b443fa5d486db085565d3723485c688509dca10f6cf', 'Clean pair, unlocked SKU.'),
  'galaxy-s26': OK('af985f4c056275188bb71d057fdd39a3aeb140f6e870164209df1a00e54c03d4', 'White back carries its own grey outline, so it holds on a white card.'),
  'galaxy-z-fold8': OK('1d9fd43701258caf88b64dc12aabed36dcb7b174235741eeae275a64915122ac', 'Cover side and open inner screen; wide, fills by width.'),
  'galaxy-z-flip8': OK('9e6e110c966a20f2a81178114115b487c487e163a032bb3f21f473231ae339db', 'Folded cover screen and open phone; clean.'),
  'pixel-11-pro-xl': OK('b337c120020d806ac0b1c66a8b80b80d594de202496b080f27d1369a3404ef4b', 'Store back and front renders at one scale, back in front, as Google\'s own press pair is composed; G mark only.'),
  'pixel-11-pro': OK('6ee1fcf9e3450a2606f78351d7de6ddb798ec1a364f4844a4465d925050b0d21', 'Store back and front renders at one scale, back in front, as Google\x27s own press pair is composed; G mark only; clean.'),
  'pixel-11': OK('8b29bd79d29d1e4e27589821428436ef04f85ea5a63b60635f849c8ee05612fb', 'Store back and front renders at one scale, back in front, as Google\x27s own press pair is composed; G mark only; clean.'),
  'pixel-10a': OK('eb493f8a0981429bfb36eff5912d30060e39a1b6f36afb59d008164b4db49227', 'Front keyed from the store\'s black JPEG ground. A faint grey fringe of one to two pixels is visible at the front\'s corners only at 3x zoom; clean at 1:1 on white. Recorded, not hidden.'),
  'razr-2026': OK('64c27422d763eac552a633054ad4df00b082038dfe2f3b34f5107a1f50345fe8', 'Press hero, open and folded; the floor shadow ran off the source frame and showed as a grey box, so it is dropped. Lock screens show the time and date of the maker\'s render, no carrier; razr and batwing marks are the maker\'s own.'),
  'edge-2026': OK('edda551883ba62622abf8db4d0340c090c37805228b7808b54790b744353b431', 'Press pair at a dynamic angle; lock screen time and date only, no carrier.'),
  'moto-g-2026': OK('b20436309916a732b97f79d03b20ab1c7e250ee421d9d233c8afea0fad896f3d', 'Press pair at a dynamic angle; lock screen time and date only, no carrier.'),
};

// ---------------------------------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function download(url) {
  let lastErr = 'unknown';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt) await sleep(1500 * 2 ** attempt);
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'image/avif,image/webp,image/png,image/*;q=0.8' },
        redirect: 'follow', signal: AbortSignal.timeout(180000) });
      if (!r.ok) { lastErr = `HTTP ${r.status}`; if (r.status < 500 && r.status !== 429) break; continue; }
      const type = r.headers.get('content-type') || '';
      if (!type.startsWith('image/')) { lastErr = `not an image (${type})`; break; }
      return { ok: true, buf: Buffer.from(await r.arrayBuffer()), type, finalUrl: r.url };
    } catch (e) { lastErr = e.message; }
  }
  return { ok: false, error: lastErr };
}

async function cached(url) {
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, `${sha256(Buffer.from(url)).slice(0, 24)}.bin`);
  if (!has('--refetch') && existsSync(file)) return { ok: true, buf: readFileSync(file), cached: true };
  const res = await download(url);
  if (res.ok) writeFileSync(file, res.buf);
  return res;
}

async function rgba(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** True when the image already carries transparency at its border (a cut-out render). */
function hasAlphaGround({ data, width, height }) {
  let clear = 0, n = 0;
  const probe = (x, y) => { n += 1; if (data[(y * width + x) * 4 + 3] < 250) clear += 1; };
  for (let x = 0; x < width; x += 7) { probe(x, 0); probe(x, height - 1); }
  for (let y = 0; y < height; y += 7) { probe(0, y); probe(width - 1, y); }
  return clear / n > 0.9;
}

/**
 * Remove an opaque studio ground by flood fill from the border: only pixels connected to the edge and
 * within `tol` of the ground colour become transparent. The phone's own frame is a closed contour, so
 * a dark bezel or a black screen inside it is never touched. The kept edge is then pulled in by one
 * pixel and its alpha feathered, because the last ring against a black ground is a dark fringe that
 * reads as a grey stair-step on a white card (the defect check caught exactly that on the Pixel 10a).
 */
async function keyGround(img, tol = 36) {
  const { data, width, height } = img;
  const ring = [[], [], []];
  for (let x = 0; x < width; x += 3) for (const y of [0, height - 1]) { const i = (y * width + x) * 4; ring[0].push(data[i]); ring[1].push(data[i + 1]); ring[2].push(data[i + 2]); }
  for (let y = 0; y < height; y += 3) for (const x of [0, width - 1]) { const i = (y * width + x) * 4; ring[0].push(data[i]); ring[1].push(data[i + 1]); ring[2].push(data[i + 2]); }
  const bg = ring.map((a) => a.sort((p, q) => p - q)[Math.floor(a.length / 2)]);
  const dist = (i) => Math.max(Math.abs(data[i] - bg[0]), Math.abs(data[i + 1] - bg[1]), Math.abs(data[i + 2] - bg[2]));
  const gone = new Uint8Array(width * height);
  const stack = [];
  const push = (x, y) => { const p = y * width + x; if (!gone[p] && dist(p * 4) <= tol) { gone[p] = 1; stack.push(p); } };
  for (let x = 0; x < width; x += 1) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y += 1) { push(0, y); push(width - 1, y); }
  while (stack.length) {
    const p = stack.pop(); const x = p % width, y = (p - x) / width;
    if (x > 0) push(x - 1, y); if (x < width - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1); if (y < height - 1) push(x, y + 1);
  }
  // pull the kept edge in by one pixel
  const edge = [];
  for (let p = 0; p < width * height; p += 1) {
    if (gone[p]) continue;
    const x = p % width, y = (p - x) / width;
    if ((x > 0 && gone[p - 1]) || (x < width - 1 && gone[p + 1]) || (y > 0 && gone[p - width]) || (y < height - 1 && gone[p + width])) edge.push(p);
  }
  for (const p of edge) gone[p] = 1;
  // feather: a 3x3 box average of the keep-mask, applied to alpha
  let removed = 0;
  const soft = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    let sum = 0, n = 0;
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < width && yy < height) { sum += gone[yy * width + xx] ? 0 : 1; n += 1; }
    }
    soft[y * width + x] = sum / n;
  }
  for (let p = 0; p < width * height; p += 1) {
    if (gone[p]) removed += 1;
    data[p * 4 + 3] = Math.round(data[p * 4 + 3] * (gone[p] ? 0 : soft[p]));
  }
  return { ground: bg, removedShare: removed / (width * height) };
}

/** A floor shadow cut off by the source frame reads as a grey box; drop everything faint. */
function dropFaint({ data }, below = 110) {
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0 && data[i] < below) { data[i] = 0; n += 1; }
  return n;
}

/** Bounding box of everything that is not transparent, and whether it touches the source frame. */
function alphaBox({ data, width, height }, min = 12) {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (data[(y * width + x) * 4 + 3] >= min) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (maxX < 0) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1,
    touchesEdge: minX === 0 || minY === 0 || maxX === width - 1 || maxY === height - 1 };
}

async function cutout(buf, { key, keyTol = 36, shadow } = {}) {
  const img = await rgba(buf);
  let keyed = null;
  if (key || !hasAlphaGround(img)) keyed = await keyGround(img, keyTol);
  const shadowPixels = shadow === 'remove' ? dropFaint(img) : 0;
  const box = alphaBox(img);
  if (!box) throw new Error('no content found');
  const png = await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } }).extract(box).png().toBuffer();
  return { png, box, source: { width: img.width, height: img.height }, keyed, shadowPixels };
}

/** Back on the left and in front, the front render behind it to the right, as the maker's own pair is shot. */
async function composePair(back, front) {
  const H = 1600;
  const b = await sharp(back.png).resize({ height: H }).png().toBuffer();
  const f = await sharp(front.png).resize({ height: H }).png().toBuffer();
  const bw = (await sharp(b).metadata()).width, fw = (await sharp(f).metadata()).width;
  const offset = Math.round(bw * 0.86);
  const W = Math.max(bw, offset + fw);
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: f, left: offset, top: 0 }, { input: b, left: 0, top: 0 }]).png().toBuffer();
}

async function place(png) {
  const target = Math.round(SIZE * FILL);
  const product = await sharp(png).resize(target, target, { fit: 'inside' }).png().toBuffer();
  const pm = await sharp(product).metadata();
  const canvas = sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: product, left: Math.round((SIZE - pm.width) / 2), top: Math.round((SIZE - pm.height) / 2) }]);
  const transparent = await canvas.png().toBuffer();
  const webp = await sharp(transparent).webp({ quality: 88, alphaQuality: 100, effort: 6 }).toBuffer();
  // The PNG is the path phones.json names today; palette-quantised with dither it is a third of full colour and
  // indistinguishable at 1:1 (checked on the Pixel 11 Pro XL back gradient). WebP is the lighter one to switch to.
  const pngOut = await sharp(transparent).png({ palette: true, quality: 100, colours: 256, dither: 1, compressionLevel: 9, effort: 10 }).toBuffer();
  const jpg = await sharp(transparent).flatten({ background: '#ffffff' }).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
  return { webp, png: pngOut, jpg, fill: Math.max(pm.width, pm.height) / SIZE, product: { width: pm.width, height: pm.height } };
}

function readManifest() {
  try { return JSON.parse(readFileSync(MANIFEST, 'utf8')); } catch { return {}; }
}

function walk(dir) {
  const out = [];
  for (const name of existsSync(dir) ? readdirSync(dir) : []) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}

export function totals() {
  const files = walk(IMG).filter((p) => !p.endsWith('MANIFEST.json'));
  const bytes = files.reduce((n, p) => n + statSync(p).size, 0);
  return { files: files.length, bytes, megabytes: Math.round((bytes / 1048576) * 100) / 100, budgetMegabytes: 25 };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const only = (arg('--only', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const manifest = readManifest();
  const previous = new Map((manifest.devices || []).map((d) => [d.id, d]));
  const rows = [];
  let made = 0, kept = 0, failed = 0;
  console.log(`devices: ${DEVICES.length} in the lineup, cache ${CACHE}`);
  for (const d of DEVICES) {
    const webpPath = join(OUT, `${d.id}.webp`), jpgPath = join(OUT, `${d.id}.jpg`), pngPath = join(OUT, `${d.id}.png`);
    const inScope = !only.length || only.includes(d.id);
    const upToDate = !has('--force') && existsSync(webpPath) && existsSync(jpgPath) && existsSync(pngPath) && previous.has(d.id);
    if (!inScope || upToDate) { if (previous.has(d.id)) { rows.push(previous.get(d.id)); kept += 1; } continue; }
    process.stdout.write(`  ${d.id} … `);
    try {
      const parts = [];
      for (const s of d.src) {
        const res = await cached(s.url);
        if (!res.ok) throw new Error(`${s.role}: ${res.error}`);
        const cut = await cutout(res.buf, s);
        parts.push({ ...s, buf: res.buf, cut });
      }
      const png = d.kind === 'compose'
        ? await composePair(parts.find((p) => p.role === 'back').cut, parts.find((p) => p.role === 'front').cut)
        : parts[0].cut.png;
      const out = await place(png);
      writeFileSync(webpPath, out.webp);
      writeFileSync(jpgPath, out.jpg);
      writeFileSync(pngPath, out.png);
      const sha = sha256(out.webp);
      rows.push({
        id: d.id, name: d.name, maker: d.maker, colour: d.colour,
        files: { png: `devices/${d.id}.png`, webp: `devices/${d.id}.webp`, white: `devices/${d.id}.jpg` },
        ...(d.spare ? { spare: d.spare } : {}),
        size: { width: SIZE, height: SIZE, productFill: Math.round(out.fill * 100) / 100 },
        bytes: { png: out.png.length, webp: out.webp.length, jpg: out.jpg.length }, sha256: sha,
        generated: false, view: d.kind === 'compose' ? 'back and front renders, placed as a pair' : 'maker\'s own back-and-front render',
        sources: parts.map((p) => ({ role: p.role, url: p.url, page: d.page, retrieved: RETRIEVED, sha256: sha256(p.buf), bytes: p.buf.length,
          pixels: `${p.cut.source.width}x${p.cut.source.height}`, touchesEdge: p.cut.box.touchesEdge,
          ground: p.cut.keyed ? `opaque ${p.cut.keyed.ground.join(',')} keyed from the border` : 'transparent',
          ...(p.cut.shadowPixels ? { shadow: 'faint floor shadow removed (it ran off the source frame)' } : {}) })),
        licence: LICENCE[d.maker],
      });
      made += 1;
      console.log(`${Math.round(out.webp.length / 1024)}KB webp, ${Math.round(out.jpg.length / 1024)}KB jpg, fill ${Math.round(out.fill * 100)}%`);
    } catch (e) {
      failed += 1;
      console.log(`failed (${e.message}); the page shows the placeholder`);
      rows.push({ id: d.id, name: d.name, maker: d.maker, files: null, placeholder: 'placeholder-device.svg', generated: false,
        gate: { verdict: 'missing', note: e.message } });
    }
  }
  // The verdict is re-read on every run, for kept rows too, and holds only for the file it was given to.
  for (const r of rows) {
    if (!r.files) continue;
    const review = GATE[r.id];
    r.gate = review && review.sha === r.sha256 ? { verdict: review.verdict, checked: review.checked, note: review.note }
      : { verdict: 'pending', note: 'not yet checked by eye at 1:1 for this exact file' };
  }
  manifest.about = 'Provenance and the human defect-check verdict for every image under public/vantage/img/. Devices are written by scripts/fetch-vantage-devices.mjs; promos, heroes, plans, modules and placeholders by scripts/generate-vantage-art.mjs. A verdict holds only for the sha256 it was given to; a changed file reads pending. No image carries a carrier mark; the makers\x27 own marks on their devices are part of the product.';
  manifest.devices = rows;
  manifest.placeholders = { ...(manifest.placeholders || {}), device: 'placeholder-device.svg' };
  manifest.totals = totals();
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`devices: ${made} written, ${kept} kept, ${failed} failed; image payload ${manifest.totals.megabytes} MB of 25`);

  const sheet = arg('--sheet', '');
  if (sheet) {
    const cell = 360, cols = 4, list = rows.filter((r) => r.files);
    const tiles = [];
    for (let i = 0; i < list.length; i += 1) {
      const img = await sharp(join(IMG, list[i].files.webp)).flatten({ background: '#f2f2f2' }).resize(cell, cell).png().toBuffer();
      tiles.push({ input: img, left: (i % cols) * cell, top: Math.floor(i / cols) * cell });
    }
    await sharp({ create: { width: cols * cell, height: Math.ceil(list.length / cols) * cell, channels: 3, background: '#f2f2f2' } })
      .composite(tiles).png().toFile(sheet);
    console.log(`sheet: ${relative(process.cwd(), sheet)}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
