// src/routes/operator.ts
// The merchandiser (operator) console surface — the wedge in Hero Moment 3.
// See docs/architecture/05-demo-build-spec.md §3 (Hero Moment 3) and §4.
//
// REAL SEAMS, MOCKED CALLS: every handler drives the connector layer through the
// same interfaces the live products expose. In mock mode (CONNECTOR_MODE=mock,
// the default) there is no external dependency — Opal's NL→audience step is the
// MockAudienceAuthoring intent matcher, and a published audience lands in the
// shared AudienceStore that MockSegmentProvider reads on the shopper's very next
// event, so a brand-new audience qualifies with zero redeploy.
//
// Two-call governance gate (mirrors the MCP write model, ref §8.1):
//   POST /audiences/suggest  -> AI DRAFTS audiences (status:'suggested'). NOTHING live.
//   POST /audiences/publish  -> human-approved publish (createAudience) -> now live,
//                               then we flash connected storefronts "new audience live".

import { Hono } from 'hono';
import type { Env } from '@/types/env';
import type { AudienceCondition, AudienceDef, QualificationContext } from '@/connectors';
import { getConnectors, KvAudienceStore } from '@/connectors';
import { evaluateCondition } from '@/connectors/evaluateCondition';
import { SEED_AUDIENCES } from '@/data/seed-audiences';
import insightsData from '@/data/insights.json';
import type { PersonalizationUpdate } from '@/durable-objects/PersonalizationWebSocket';
import { z } from 'zod';

const operatorRoutes = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Idempotent boot seed. The Coach launch audiences (SEED_AUDIENCES) must be
// present before SegmentProvider can qualify anyone into them. KvAudienceStore.seed()
// will NOT clobber audiences created live by Opal, so calling this at the start of
// every handler is safe and keeps the operator console self-bootstrapping.
// ---------------------------------------------------------------------------
async function ensureSeeded(env: Env): Promise<void> {
  await new KvAudienceStore(env).seed(SEED_AUDIENCES);
}

// ---------------------------------------------------------------------------
// Zod request shapes.
// ---------------------------------------------------------------------------
const suggestSchema = z.object({
  nlPrompt: z.string().min(1, 'nlPrompt is required'),
});

// An AudienceCondition is a recursive tree: a leaf predicate object OR a
// ['and'|'or'|'not', ...] tuple. We validate it loosely (z.any() on the tree)
// because the canonical contract lives in src/connectors/types.ts and the drafts
// the operator publishes are produced by suggestAudiences() against that contract.
const conditionSchema: z.ZodType<AudienceCondition> = z.any();

const audienceSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  conditions: conditionSchema,
  evaluation: z.enum(['realtime', 'batch']).default('realtime'),
  source: z.enum(['opal_nl', 'manual', 'seed']).default('opal_nl'),
  status: z.enum(['suggested', 'draft', 'published', 'archived']).default('suggested'),
  createdAt: z.number().optional(),
  audienceId: z.string().optional(),
  recommendedModule: z.string().optional(),
  anchorLine: z.string().optional(),
  stats: z.record(z.number()).optional(),
});

const publishSchema = z.object({
  audience: audienceSchema,
});

// ---------------------------------------------------------------------------
// POST /operator/audiences/suggest  — Opal NL draft step (nothing goes live).
// ---------------------------------------------------------------------------
operatorRoutes.post('/audiences/suggest', async (c) => {
  try {
    await ensureSeeded(c.env);
    const body = await c.req.json();
    const { nlPrompt } = suggestSchema.parse(body);

    // Opal: plain-language request -> DRAFT AudienceDef[] (status:'suggested').
    const drafts = await getConnectors(c.env).audiences.suggestAudiences(nlPrompt);

    return c.json({
      success: true,
      nlPrompt,
      count: drafts.length,
      // The operator console renders these as Opal "review cards" — a human approves
      // before anything is published (the governance beat).
      drafts,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Error suggesting audiences:', error);

    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid suggest request', details: error.errors }, 400);
    }
    return c.json({
      error: 'Failed to suggest audiences',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /operator/audiences/publish  — human-approved publish, then flash storefronts.
// ---------------------------------------------------------------------------
operatorRoutes.post('/audiences/publish', async (c) => {
  try {
    await ensureSeeded(c.env);
    const body = await c.req.json();
    const { audience } = publishSchema.parse(body);

    const connectors = getConnectors(c.env);

    // Human-approved Publish. Persists into the shared AudienceStore that
    // MockSegmentProvider reads — live to qualification with no redeploy.
    const def = audience as AudienceDef;
    const audienceId = await connectors.audiences.createAudience(def);

    // Flash currently-connected storefronts: "new audience live". We notify the
    // users who already qualify for the brand-new audience (so the matching module
    // can pop), falling back to every connected shopper when we can't cheaply
    // resolve a per-user QualificationContext (it's a global merchandising notice).
    const notified = await broadcastAudiencePublished(c.env, { ...def, audienceId });

    return c.json({
      success: true,
      audienceId,
      audience: { ...def, audienceId, status: 'published' as const },
      notifiedUsers: notified,
      message: `Audience '${def.name}' published and live for qualification`,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Error publishing audience:', error);

    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid publish request', details: error.errors }, 400);
    }
    return c.json({
      error: 'Failed to publish audience',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /operator/audiences  — the live audience list (seed + Opal-created).
// ---------------------------------------------------------------------------
operatorRoutes.get('/audiences', async (c) => {
  try {
    await ensureSeeded(c.env);
    const audiences = await new KvAudienceStore(c.env).listPublished();

    return c.json({
      success: true,
      count: audiences.length,
      audiences,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Error listing audiences:', error);
    return c.json({
      error: 'Failed to list audiences',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /operator/insights  — pre-aggregated ODP insight aggregates for the
// back-office view (served from the bundled synthetic Coach NA dataset).
// ---------------------------------------------------------------------------
operatorRoutes.get('/insights', async (c) => {
  const data = insightsData as {
    _meta?: Record<string, any>;
    aggregates?: Record<string, any>;
    insights?: any[];
  };

  return c.json({
    success: true,
    meta: data._meta ?? {},
    aggregates: data.aggregates ?? {},
    // Lightweight index of the audience corpus (full conditions live behind /audiences).
    insights: (data.insights ?? []).map((i: any) => ({
      key: i.key,
      name: i.name,
      description: i.description,
      recommended_module: i.recommended_module,
      anchor_line: i.anchor_line,
      stats: i.stats,
    })),
    timestamp: Date.now(),
  });
});

// ---------------------------------------------------------------------------
// Broadcast helper. Fans an 'audience_published' PersonalizationUpdate to the
// PERSONALIZATION_WEBSOCKET DO via its per-user /broadcast HTTP endpoint (the
// transport the DO already exposes). We resolve the set of connected users from
// the 'admin' DO's /connections view, then notify those who qualify for the new
// audience — or all connected users if none can be resolved/qualified — so the
// "new audience live" flash reaches active storefront sessions.
// ---------------------------------------------------------------------------
async function broadcastAudiencePublished(env: Env, def: AudienceDef): Promise<number> {
  try {
    const connectedUsers = await getConnectedUsers(env);
    if (connectedUsers.length === 0) return 0;

    // Prefer the users who already qualify for the new audience (their matching
    // module can pop immediately). Evaluate the published condition tree against
    // each connected user's live qualification context.
    const connectors = getConnectors(env);
    const targets: string[] = [];
    for (const userId of connectedUsers) {
      const ctx = await loadQualificationContext(env, userId);
      try {
        if (evaluateCondition(def.conditions, ctx.attributes)) targets.push(userId);
      } catch {
        // Malformed/condition error — skip qualification, still get the global flash below.
      }
    }

    // If nobody concretely qualifies (or contexts are empty cold-start sessions),
    // still flash every connected storefront — it's a merchandising-wide notice.
    const recipients = targets.length > 0 ? targets : connectedUsers;

    await Promise.all(
      recipients.map((userId) =>
        sendUpdate(env, userId, {
          type: 'audience_published',
          userId,
          data: {
            timestamp: Date.now(),
            source: 'operator',
            audienceWentLive: { key: def.key, name: def.name },
          },
        })
      )
    );

    return recipients.length;
  } catch (error) {
    // Broadcasting is best-effort — a notify failure must not fail the publish.
    console.error('Error broadcasting audience_published:', error);
    return 0;
  }
}

/** Read the set of currently-connected userIds from the 'admin' DO connections view. */
async function getConnectedUsers(env: Env): Promise<string[]> {
  try {
    const id = env.PERSONALIZATION_WEBSOCKET.idFromName('admin');
    const stub = env.PERSONALIZATION_WEBSOCKET.get(id);
    const res = await stub.fetch(new Request('http://do/connections'));
    if (!res.ok) return [];
    const info = (await res.json()) as { users?: string[] };
    return Array.isArray(info.users) ? info.users : [];
  } catch (error) {
    console.error('Error reading connected users:', error);
    return [];
  }
}

/**
 * Build a best-effort QualificationContext for a connected user from the cached
 * UserProfile written by RealtimeSegmentEngine (profile:<userId>). Falls back to
 * an empty cold-start context so qualification still runs deterministically.
 */
async function loadQualificationContext(env: Env, userId: string): Promise<QualificationContext> {
  try {
    const profile = (await env.CACHE.get(`profile:${userId}`, 'json')) as
      | { segments?: string[]; attributes?: Record<string, any> }
      | null;
    if (profile) {
      return {
        userId,
        attributes: profile.attributes ?? {},
        segments: profile.segments ?? [],
      };
    }
  } catch {
    // ignore — cold-start fallback below
  }
  return { userId, attributes: {}, segments: [] };
}

/** Send one per-user PersonalizationUpdate through the user's DO /broadcast endpoint. */
async function sendUpdate(env: Env, userId: string, update: PersonalizationUpdate): Promise<void> {
  const id = env.PERSONALIZATION_WEBSOCKET.idFromName(userId);
  const stub = env.PERSONALIZATION_WEBSOCKET.get(id);
  await stub.fetch(
    new Request('http://do/broadcast', {
      method: 'POST',
      body: JSON.stringify(update),
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

export default operatorRoutes;
export { operatorRoutes };
