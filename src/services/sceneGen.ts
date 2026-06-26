/**
 * sceneGen — shared styled-scene generation (used by the /ai/scene route AND the queue consumer).
 *
 * A novel query's scene is generated from the REAL product shot via gemini-3.1-flash-image and
 * cached in R2. The route ENQUEUES this work (returns instantly, never blocks the request); the
 * queue consumer runs generateSceneToR2 in the background. Either way the bytes land in R2 under a
 * stable key, so the GET endpoint serves it and every later ask is instant. Idempotent: a cache
 * hit short-circuits, so duplicate jobs are safe.
 */
import type { Env } from '@/types/env';
import { getCatalog } from '@/services/CatalogIntent';

const GLAPI = 'https://generativelanguage.googleapis.com/v1beta';
// Host is ignored by the ASSETS binding (it matches on path) — a constant base works in the
// queue consumer where there is no incoming Request.
const ASSET_BASE = 'https://assets.local';

const FIDELITY =
  'CRITICAL: Reproduce the EXACT bag shown in the reference image — identical shape, proportions, ' +
  'hardware, logo, stitching, color and leather texture. Do NOT redesign, recolor, or restyle the bag. ' +
  'It must read as the same product, and stay the clear hero of the frame. No people, no faces, no text, ' +
  'no watermarks, no extra logos.';

const searchHeroPrompt = (name: string, ctx: string) =>
  `Wide cinematic editorial campaign banner. Place the provided Coach ${name} ${ctx}. ` +
  `Premium fashion-magazine lighting, shallow depth of field, tasteful real-world props, refined on-brand palette, ` +
  `generous negative space on the left for a headline, photorealistic. ${FIDELITY}`;

const conciergeLookPrompt = (name: string, ctx: string) =>
  `Editorial luxury lifestyle photograph, portrait orientation. Style the provided Coach ${name} as the centerpiece of ${ctx}. ` +
  `Natural premium lighting, curated complementary props, aspirational but believable, photorealistic. ${FIDELITY}`;

export const slug = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
export const r2KeyFor = (productId: string, sceneId: string) => `scene/live/${slug(productId)}__${slug(sceneId)}.jpg`;
export const sceneUrl = (productId: string, sceneId: string) => `/ai/scene/${encodeURIComponent(productId)}/${encodeURIComponent(sceneId)}`;

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Read the real on-white product shot via the ASSETS binding (no incoming Request needed).
 *  Guards on content-type (not_found_handling=SPA returns index.html for misses). */
async function loadReference(env: Env, productId: string): Promise<{ data: string; mime: string } | null> {
  if (!env.ASSETS) return null;
  for (const ext of ['jpg', 'png', 'jpeg', 'webp']) {
    try {
      const r = await env.ASSETS.fetch(new Request(`${ASSET_BASE}/images/${productId}.${ext}`));
      if (!r.ok) continue;
      if (!(r.headers.get('content-type') || '').startsWith('image/')) continue;
      const buf = new Uint8Array(await r.arrayBuffer());
      if (!buf.length) continue;
      let bin = '';
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      return { data: btoa(bin), mime: ext === 'jpg' ? 'image/jpeg' : `image/${ext}` };
    } catch { /* try next ext */ }
  }
  return null;
}

export interface SceneJob {
  kind?: 'scene';
  productId: string;
  sceneId: string;
  type: 'search' | 'concierge';
  sceneContext: string;
  aspect?: string;
}

export interface SceneResult { ok: boolean; url?: string; cached?: boolean; error?: string; tookMs?: number; }

/** Generate (if not already cached) the scene and store it in R2. Never throws — returns {ok:false}. */
export async function generateSceneToR2(env: Env, job: SceneJob): Promise<SceneResult> {
  const t0 = Date.now();
  try {
    const productId = String(job.productId || '').trim();
    const sceneId = slug(String(job.sceneId || job.type || 'scene'));
    const type = job.type === 'concierge' ? 'concierge' : 'search';
    const sceneContext = String(job.sceneContext || '').trim().slice(0, 240);
    const aspect = typeof job.aspect === 'string' ? job.aspect : type === 'concierge' ? '4:5' : '16:9';
    if (!productId || !sceneContext) return { ok: false, error: 'productId and sceneContext required' };

    const key = r2KeyFor(productId, sceneId);
    const head = await env.STORAGE.head(key).catch(() => null);
    if (head) return { ok: true, url: sceneUrl(productId, sceneId), cached: true, tookMs: Date.now() - t0 };

    if (!env.GEMINI_API_KEY) return { ok: false, error: 'image model not configured' };
    const product = getCatalog().find((p) => p.id === productId);
    if (!product) return { ok: false, error: 'unknown product' };
    const ref = await loadReference(env, productId);
    if (!ref) return { ok: false, error: 'no reference image' };

    const prompt = type === 'concierge' ? conciergeLookPrompt(product.name, sceneContext) : searchHeroPrompt(product.name, sceneContext);
    const model = env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';
    const r = await fetch(`${GLAPI}/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: ref.mime, data: ref.data } }] }],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } },
      }),
    });
    if (!r.ok) { console.error('sceneGen HTTP', r.status, (await r.text().catch(() => '')).slice(0, 160)); return { ok: false, error: `image model ${r.status}` }; }
    const j: any = await r.json();
    const part = (j?.candidates?.[0]?.content?.parts || []).map((x: any) => x.inlineData || x.inline_data).find((x: any) => x?.data);
    if (!part?.data) return { ok: false, error: `no image (finish=${j?.candidates?.[0]?.finishReason})` };

    await env.STORAGE.put(key, b64ToBytes(part.data), {
      httpMetadata: { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' },
      customMetadata: { productId, sceneId, type, model },
    });
    return { ok: true, url: sceneUrl(productId, sceneId), cached: false, tookMs: Date.now() - t0 };
  } catch (e) {
    console.error('generateSceneToR2 error:', e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
