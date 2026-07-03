/**
 * Consumer-facing AI features, powered by the SAME Gemini backend as Opal.
 *  - POST /ai/search   — Gemini parses the NL query (generateObject) → deterministic rank over the
 *                        REAL catalog, blended with the shopper's live affinity. Returns product ids.
 *  - POST /ai/concierge — streaming Gemini stylist; the compact catalog rides in-context and the model
 *                        must end with "PICKS: <id>,…" using REAL ids (client resolves → can't hallucinate).
 */
import { Hono } from 'hono';
import { generateObject, streamText, type ModelMessage } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { Env } from '@/types/env';
import { IntentSchema, rankByIntent, buildCompactCatalog, getCatalog, OCCASIONS, type Affinity } from '@/services/CatalogIntent';

const ai = new Hono<{ Bindings: Env }>();

ai.post('/search', async (c) => {
  const t0 = Date.now();
  try {
    const body = await c.req.json().catch(() => ({} as any));
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    const limit = typeof body.limit === 'number' ? body.limit : 9;
    const affinity: Affinity = body.affinity && typeof body.affinity === 'object' ? body.affinity : {};
    if (!query) return c.json({ ok: false, error: 'empty query' }, 400);
    if (!c.env.GEMINI_API_KEY) return c.json({ ok: false, error: 'GEMINI_API_KEY not configured', source: 'fallback' });

    const google = createGoogleGenerativeAI({ apiKey: c.env.GEMINI_API_KEY });
    const { object: intent } = await generateObject({
      model: google(c.env.GEMINI_MODEL || 'gemini-2.5-flash'),
      schema: IntentSchema,
      prompt:
        `You parse a luxury-handbag shopper's natural-language search into structured intent, AND write the\n` +
        `editorial copy + scene for a campaign "Edit" hero image that will headline the results.\n` +
        `Allowed occasion tags — map free text ONTO these EXACT values: ${OCCASIONS.join(', ')}.\n` +
        `The catalog price range is $65-$795. Only fill structured fields the query implies; leave others empty or null.\n` +
        `Always write headline, subhead and sceneContext — make them specific to THIS request, on-brand for Coach,\n` +
        `aspirational but tasteful. The sceneContext stages ONE hero bag (no people, no faces, no text in the image).\n` +
        `Query: """${query}"""`,
    });

    const ranked = rankByIntent(getCatalog(), intent, affinity, limit);
    const top = ranked[0];
    return c.json({
      ok: true,
      intent,
      productIds: ranked.map((p) => p.id),
      hero: top ? { productId: top.id, productName: top.name } : null,
      tookMs: Date.now() - t0,
      source: 'gemini',
    });
  } catch (e) {
    console.error('ai/search error:', e);
    return c.json({ ok: false, error: e instanceof Error ? e.message : String(e), source: 'fallback' });
  }
});

ai.post('/concierge', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({} as any));
    const rawMessages: any[] = Array.isArray(body.messages) ? body.messages : [];
    const affinity = body.affinity && typeof body.affinity === 'object' ? body.affinity : {};
    const avoidIds: string[] = Array.isArray(body.avoidIds) ? body.avoidIds.filter((x: any) => typeof x === 'string') : [];
    if (!c.env.GEMINI_API_KEY) return c.json({ error: 'GEMINI_API_KEY not configured' }, 503);
    if (!rawMessages.length) return c.json({ error: 'no messages' }, 400);

    const compact = buildCompactCatalog(getCatalog());
    const system =
      `You are the Coach Style Concierge — a warm, concise luxury stylist. Help shoppers complete a look, ` +
      `build outfits/capsules, and choose for occasions. Recommend ONLY products from this catalog (JSON):\n${compact}\n\n` +
      `Rules:\n` +
      `- Pick 2-4 pieces that genuinely pair (anchor bag + complementary small leather good / accessory).\n` +
      `- Give 2-4 sentences of on-brand rationale; reference pieces by name. No prices unless asked.\n` +
      `- This is a CONVERSATION: each new message may REFINE or CORRECT the previous one. Always honor the shopper's MOST RECENT request. ` +
      `When they ask for something different (other colors, styles, lines, vibe, or price), CHANGE your picks to satisfy it and show FRESH pieces — do NOT return the same items again unless one is clearly the single best match for the new request.\n` +
      `- Honor color requests using each product's "color" field. "darker"/"deeper"/"richer"/"moody" → Black, Deep Berry, Moss, Walnut, 1941 Saddle, Grey; "lighter"/"neutral"/"soft" → Chalk, Ivory, Cream, Light Saddle. If they say to avoid a shade, never pick it. Name the colorway you mean in your rationale.\n` +
      `- If the catalog genuinely can't satisfy the request, say so and offer the closest alternative — never silently repeat the same pieces.\n` +
      (affinity.dominantLine ? `- Lean toward the ${affinity.dominantLine} line when it fits, but the shopper's explicit request always wins.\n` : '') +
      (affinity.currentProductId ? `- The shopper is currently viewing product ${affinity.currentProductId}; consider pairing with it.\n` : '') +
      (avoidIds.length ? `- Earlier in THIS conversation you already showed these product ids: ${avoidIds.join(', ')}. The shopper is refining their request — recommend DIFFERENT pieces that better fit their LATEST message. Reuse one of those ids ONLY if it is unmistakably the single best match for the new request, and if so, say why.\n` : '') +
      `- End your reply with EXACTLY one final line: "PICKS: <id>, <id>, <id>" using product id values from the catalog. Put nothing after it.`;

    const messages: ModelMessage[] = rawMessages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content ?? ''),
    }));

    const google = createGoogleGenerativeAI({ apiKey: c.env.GEMINI_API_KEY });
    const result = streamText({ model: google(c.env.GEMINI_MODEL || 'gemini-2.5-flash'), system, messages });
    return result.toTextStreamResponse();
  } catch (e) {
    console.error('ai/concierge error:', e);
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

export { ai as aiRoutes };
