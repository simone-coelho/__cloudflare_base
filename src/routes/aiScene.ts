/**
 * /ai/scene — styled editorial scenes for AI Search + the Style Concierge.
 *
 * The HEADLINE demo queries are pre-generated to static assets (scripts/pregen-scenes.mjs →
 * /images/generated/<key>.jpg, instant on stage). THIS route is the robustness path for any
 * NOVEL query: it generates a scene on demand from the REAL product shot and caches it in R2,
 * so the second ask is instant and the system never "looks like idiots" on an unrehearsed prompt.
 *
 *   GET  /ai/scene/:productId/:sceneId   — serve the cached scene bytes from R2 (404 on miss)
 *   POST /ai/scene  { productId, sceneId, type, sceneContext, aspect }
 *                                        — cache-first; on miss, send the real on-white product
 *                                          image as a REFERENCE to Gemini "nano banana", store the
 *                                          result in R2, return its GET url. Never throws to the
 *                                          client — on any failure returns { ok:false } so the UI
 *                                          falls back to the (already-real) ranked grid / cards.
 *
 * Reference-image → scene is the whole point: only the multimodal image model keeps the real bag.
 */
import { Hono } from 'hono';
import type { Env } from '@/types/env';
import { getCatalog } from '@/services/CatalogIntent';

const scene = new Hono<{ Bindings: Env }>();

const GLAPI = 'https://generativelanguage.googleapis.com/v1beta';

// Same fidelity contract the offline pre-gen uses, so live + pre-genned scenes look consistent.
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

const slug = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
const r2KeyFor = (productId: string, sceneId: string) => `scene/live/${slug(productId)}__${slug(sceneId)}.jpg`;

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Fetch the real on-white product shot (static asset) as a base64 reference for the image model.
 *  Uses the ASSETS binding (reliable server-side read); falls back to a self-fetch if it's absent.
 *  Guards on content-type because not_found_handling=SPA returns index.html (200) for misses. */
async function loadReference(env: Env, req: Request, productId: string): Promise<{ data: string; mime: string } | null> {
  const get = (u: string) => (env.ASSETS ? env.ASSETS.fetch(new Request(u)) : fetch(u));
  for (const ext of ['jpg', 'png', 'jpeg', 'webp']) {
    try {
      const url = new URL(`/images/${productId}.${ext}`, req.url).toString();
      const r = await get(url);
      if (!r.ok) continue;
      const ct = r.headers.get('content-type') || '';
      if (!ct.startsWith('image/')) continue;   // SPA fallback served index.html → not the asset
      const buf = new Uint8Array(await r.arrayBuffer());
      if (!buf.length) continue;
      let bin = '';
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      return { data: btoa(bin), mime: ext === 'jpg' ? 'image/jpeg' : `image/${ext}` };
    } catch { /* try next ext */ }
  }
  return null;
}

const sceneUrl = (productId: string, sceneId: string) => `/ai/scene/${encodeURIComponent(productId)}/${encodeURIComponent(sceneId)}`;

// ── GET: serve a cached scene from R2 ────────────────────────────────────────
scene.get('/:productId/:sceneId', async (c) => {
  const productId = c.req.param('productId');
  const sceneId = c.req.param('sceneId');
  try {
    const obj = await c.env.STORAGE.get(r2KeyFor(productId, sceneId));
    if (!obj) return c.json({ ok: false, error: 'not cached' }, 404);
    return new Response(obj.body, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Scene-Source': 'r2',
      },
    });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// ── POST: cache-first generate-on-miss ───────────────────────────────────────
scene.post('/', async (c) => {
  const t0 = Date.now();
  try {
    const body = await c.req.json().catch(() => ({} as any));
    const productId = String(body.productId || '').trim();
    const sceneId = slug(String(body.sceneId || body.type || 'scene'));
    const type = body.type === 'concierge' ? 'concierge' : 'search';
    const sceneContext = String(body.sceneContext || '').trim().slice(0, 240);
    const aspect = typeof body.aspect === 'string' ? body.aspect : type === 'concierge' ? '4:5' : '16:9';
    if (!productId || !sceneContext) return c.json({ ok: false, error: 'productId and sceneContext required' }, 400);

    const key = r2KeyFor(productId, sceneId);

    // 1) cache hit → return the GET url immediately
    const head = await c.env.STORAGE.head(key).catch(() => null);
    if (head) return c.json({ ok: true, url: sceneUrl(productId, sceneId), cached: true, tookMs: Date.now() - t0 });

    if (!c.env.GEMINI_API_KEY) return c.json({ ok: false, error: 'image model not configured' });

    // 2) resolve the REAL product + its reference shot (server-side → can't be spoofed)
    const product = getCatalog().find((p) => p.id === productId);
    if (!product) return c.json({ ok: false, error: 'unknown product' }, 404);
    const ref = await loadReference(c.env, c.req.raw, productId);
    if (!ref) return c.json({ ok: false, error: 'no reference image' });

    // 3) generate
    const prompt = type === 'concierge' ? conciergeLookPrompt(product.name, sceneContext) : searchHeroPrompt(product.name, sceneContext);
    const model = c.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';
    const r = await fetch(`${GLAPI}/models/${model}:generateContent?key=${c.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: ref.mime, data: ref.data } }] }],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } },
      }),
    });
    if (!r.ok) {
      const detail = (await r.text().catch(() => '')).slice(0, 180);
      console.error('ai/scene gen HTTP', r.status, detail);
      return c.json({ ok: false, error: `image model ${r.status}` });
    }
    const j: any = await r.json();
    const part = (j?.candidates?.[0]?.content?.parts || []).map((x: any) => x.inlineData || x.inline_data).find((x: any) => x?.data);
    if (!part?.data) return c.json({ ok: false, error: `no image (finish=${j?.candidates?.[0]?.finishReason})` });

    // 4) cache in R2 and return the GET url
    const bytes = b64ToBytes(part.data);
    await c.env.STORAGE.put(key, bytes, {
      httpMetadata: { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' },
      customMetadata: { productId, sceneId, type, model },
    });
    return c.json({ ok: true, url: sceneUrl(productId, sceneId), cached: false, tookMs: Date.now() - t0 });
  } catch (e) {
    console.error('ai/scene error:', e);
    return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

export { scene as aiSceneRoutes };
