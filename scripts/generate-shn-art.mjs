#!/usr/bin/env node
// scripts/generate-shn-art.mjs — the promotional creative, generated once.
//
// Garrett's FPO shows editorial promotion cards, not packshots: a styled scene,
// a title, a badge, one Shop Now. So each promotion needs its own creative, and
// it is generated at DESIGN TIME and committed — never on the serving path.
// Same posture as the Bright Hour packshots (scripts/generate-bh-images.mjs) and
// the Meridian scenes.
//
//   node scripts/generate-shn-art.mjs            generate anything missing
//   node scripts/generate-shn-art.mjs --force    regenerate everything
//   node scripts/generate-shn-art.mjs --only SHN-KIT-01,SHN-HOM-01
//   node scripts/generate-shn-art.mjs --final    also render the Final Hours variant
//
// Output: public/top-offers/art/<id>.jpg at 3:2, which is the FPO's card shape.
// A promotion whose art is missing renders a deliberate placeholder on the page —
// a clean placeholder beats a bad image, and beats a broken one on stage.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { ALL } from './lib/shn-promotions.mjs';

const sharp = createRequire(import.meta.url)('sharp');

const MODEL = process.env.SHN_MODEL || 'gemini-3.1-flash-image';
const GLAPI = 'https://generativelanguage.googleapis.com/v1beta';
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
// argv is already sliced, so a flag at index 0 is real: `i >= 0`, not `i > 0`.
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };

const outDir = new URL('../public/top-offers/art/', import.meta.url);
mkdirSync(outDir, { recursive: true });

function apiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  const raw = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8');
  const m = /^GEMINI_API_KEY=(.*)$/m.exec(raw);
  if (!m) throw new Error('GEMINI_API_KEY is not set and is not in .dev.vars');
  return m[1].trim().replace(/^['"]|['"]$/g, '');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The house style, applied to every prompt so twenty cards read as one module
 * rather than twenty stock photos. It mirrors the FPO: bright, airy, warm
 * neutral, editorial retail — and it forbids text, because the badge and the
 * title are rendered by the page and must stay changeable (a Final Hours swap
 * changes the title; baked-in text would make that a lie).
 */
const STYLE = 'Bright airy editorial retail promotion photograph, soft natural daylight, '
  + 'warm neutral palette, generous negative space, shallow depth of field, premium catalogue quality. '
  + 'ABSOLUTELY NO text, NO lettering, NO words, NO numbers, NO watermarks, NO logos, NO brand marks, NO people, NO hands.';

async function generateOne(key, prompt) {
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: `${prompt}. ${STYLE}` }] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '3:2', imageSize: '2K' } },
  });
  let lastErr = 'unknown';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt) await sleep(1500 * 2 ** attempt + Math.random() * 800);
    let r;
    try {
      r = await fetch(`${GLAPI}/models/${MODEL}:generateContent?key=${key}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
        signal: AbortSignal.timeout(120000),
      });
    } catch (e) { lastErr = `fetch ${e.message}`; continue; }
    if (!r.ok) {
      lastErr = `HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`;
      if (r.status < 500 && r.status !== 429) break;
      continue;
    }
    const j = await r.json();
    const part = (j?.candidates?.[0]?.content?.parts || [])
      .map((x) => x.inlineData || x.inline_data).find((x) => x?.data);
    if (!part?.data) { lastErr = `no image (finish=${j?.candidates?.[0]?.finishReason})`; continue; }
    return { ok: true, buf: Buffer.from(part.data, 'base64') };
  }
  return { ok: false, error: lastErr };
}

const only = (arg('--only', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const jobs = [];
for (const p of ALL) {
  if (only.length && !only.includes(p.id)) continue;
  jobs.push({ id: p.id, prompt: p.art });
}
// The Final Hours creative: the SAME promotion, a different frame behind the
// same content id. That is the whole point of beat 8 — the id and its learning
// survive the swap — so the two images must be visibly different.
for (const id of ['SHN-KIT-01', 'SHN-KIT-02']) {
  const fh = ALL.find((p) => p.id === id);
  if (!fh || (only.length && !only.includes(id))) continue;
  jobs.push({ id: `${id}-final`,
    prompt: `${fh.art}, shot closer and warmer with deeper evening shadow and a single pool of lamp light, urgent end-of-sale mood` });
}

const key = apiKey();
const force = has('--force');
let made = 0, skipped = 0, failed = 0;

console.log(`art: ${jobs.length} frame(s), model=${MODEL}`);
for (const job of jobs) {
  const file = new URL(`${job.id}.jpg`, outDir);
  if (!force && existsSync(file)) { skipped += 1; continue; }
  process.stdout.write(`  ${job.id} … `);
  const res = await generateOne(key, job.prompt);
  if (!res.ok) { failed += 1; console.log(`failed (${res.error})`); continue; }
  // 2K frames are three megabytes each; twenty of them is sixty megabytes down
  // a conference wifi. The card is rendered at about 320px wide, so 1200x800 at
  // quality 82 is generous and lands each frame around 150KB.
  const out = await sharp(res.buf).resize(1200, 800, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 82, progressive: true, mozjpeg: true }).toBuffer();
  writeFileSync(file, out);
  made += 1;
  console.log(`${Math.round(out.length / 1024)}KB`);
}

console.log(`art: ${made} generated, ${skipped} already present, ${failed} failed`);
if (failed) console.log('     a promotion without art renders the page’s own placeholder, never a broken image');
process.exit(0);
