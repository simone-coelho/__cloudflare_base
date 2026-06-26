/**
 * /ai/scene — styled editorial scenes for AI Search + the Style Concierge.
 *
 * Headline/occasion queries are pre-generated (static assets + the occasion×SKU grid). THIS route is
 * the robustness path for any NOVEL query. It is ASYNC by default: on a cache miss it ENQUEUES a
 * background job (Cloudflare Queue) and returns instantly — the request never blocks on the ~8s
 * generation. The queue consumer runs generateSceneToR2 and stores the bytes in R2; the client polls
 * the GET endpoint until ready (and the scene is cached for everyone after). Pass {sync:true} to
 * generate inline (used by pre-warm / validation tooling).
 *
 *   GET  /ai/scene/:productId/:sceneId   — serve the cached scene from R2 (404 until ready)
 *   POST /ai/scene  { productId, sceneId, type, sceneContext, aspect, sync? }
 *        → { ok, status: 'ready' | 'queued', url }   (never throws; client falls back to the grid)
 */
import { Hono } from 'hono';
import type { Env } from '@/types/env';
import { generateSceneToR2, r2KeyFor, sceneUrl, slug, type SceneJob } from '@/services/sceneGen';

const scene = new Hono<{ Bindings: Env }>();

// ── GET: serve a cached scene from R2 ────────────────────────────────────────
scene.get('/:productId/:sceneId', async (c) => {
  const productId = c.req.param('productId');
  const sceneId = c.req.param('sceneId');
  try {
    const obj = await c.env.STORAGE.get(r2KeyFor(productId, sceneId));
    if (!obj) return c.json({ ok: false, error: 'not cached' }, 404);
    return new Response(obj.body, {
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Scene-Source': 'r2' },
    });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// ── POST: cache-first; async-enqueue on miss (or sync for pre-warm) ───────────
scene.post('/', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({} as any));
    const productId = String(body.productId || '').trim();
    const sceneId = slug(String(body.sceneId || body.type || 'scene'));
    const type = body.type === 'concierge' ? 'concierge' : 'search';
    const sceneContext = String(body.sceneContext || '').trim().slice(0, 240);
    const aspect = typeof body.aspect === 'string' ? body.aspect : type === 'concierge' ? '4:5' : '16:9';
    if (!productId || !sceneContext) return c.json({ ok: false, error: 'productId and sceneContext required' }, 400);

    const url = sceneUrl(productId, sceneId);

    // 1) already cached → ready immediately
    const head = await c.env.STORAGE.head(r2KeyFor(productId, sceneId)).catch(() => null);
    if (head) return c.json({ ok: true, status: 'ready', url, cached: true });

    const job: SceneJob = { kind: 'scene', productId, sceneId, type, sceneContext, aspect };

    // 2) sync (pre-warm / validation) → generate inline and return when ready
    if (body.sync) {
      const res = await generateSceneToR2(c.env, job);
      return c.json(res.ok ? { ok: true, status: 'ready', url: res.url, cached: res.cached } : { ok: false, error: res.error });
    }

    // 3) async (default) → enqueue a background job, return instantly; client polls the GET url.
    try {
      await c.env.EVENT_QUEUE.send(job);
      return c.json({ ok: true, status: 'queued', url });
    } catch (e) {
      // Queue unavailable → fall back to inline generation so the scene still caches.
      console.error('ai/scene enqueue failed, generating inline:', e);
      const res = await generateSceneToR2(c.env, job);
      return c.json(res.ok ? { ok: true, status: 'ready', url: res.url, cached: res.cached } : { ok: false, error: res.error });
    }
  } catch (e) {
    console.error('ai/scene error:', e);
    return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

export { scene as aiSceneRoutes };
