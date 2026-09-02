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
import { jwt } from '@/middleware/auth';

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
  stats: z.record(z.string(), z.number()).optional(),
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
      return c.json({ error: 'Invalid suggest request', details: error.issues }, 400);
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
      return c.json({ error: 'Invalid publish request', details: error.issues }, 400);
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

// ---------------------------------------------------------------------------
// POST /operator/events/reset — wipe ONLY demo-captured events (demo_events).
//
// The companion to the storefront's client-only Restart (↻) control: this clears
// the SERVER-side demo data. The historical synthetic dataset (coach_odp_profiles
// / coach_transactions / coach_purchase_items / coach_catalog) is NEVER touched —
// every statement below addresses only `demo_events`, which can physically hold
// nothing but demo rows (CHECK(source='demo') in migration 0002). Optional body
// { scope:'all'|'run'|'session'|'vuid', value } narrows the wipe to one demo run.
// ---------------------------------------------------------------------------
const resetEventsSchema = z.object({
  scope: z.enum(['all', 'run', 'session', 'vuid']).default('all'),
  value: z.string().optional(),
});

operatorRoutes.post('/events/reset', async (c) => {
  try {
    if (!c.env.DB) {
      return c.json({ error: 'D1 not configured (DB binding missing)' }, 503);
    }
    const body = await c.req.json().catch(() => ({}));
    const { scope, value } = resetEventsSchema.parse(body ?? {});

    // NOTE: every branch is scoped to demo_events AND source='demo'. There is no
    // code path here that can reference a historical table — isolation by design.
    let stmt: D1PreparedStatement;
    if (scope === 'run' && value) {
      stmt = c.env.DB.prepare(`DELETE FROM demo_events WHERE source = 'demo' AND demo_run_id = ?`).bind(value);
    } else if (scope === 'session' && value) {
      stmt = c.env.DB.prepare(`DELETE FROM demo_events WHERE source = 'demo' AND session_id = ?`).bind(value);
    } else if (scope === 'vuid' && value) {
      stmt = c.env.DB.prepare(`DELETE FROM demo_events WHERE source = 'demo' AND vuid = ?`).bind(value);
    } else {
      stmt = c.env.DB.prepare(`DELETE FROM demo_events WHERE source = 'demo'`);
    }
    const res = await stmt.run();
    const deleted = res.meta?.changes ?? 0;

    return c.json({
      success: true,
      scope,
      value: value ?? null,
      deletedDemoEvents: deleted,
      message: `Cleared ${deleted} demo-captured event(s). Historical data untouched.`,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Error resetting demo events:', error);
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid reset request', details: error.issues }, 400);
    }
    return c.json({
      error: 'Failed to reset demo events',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /operator/events/stats — quick demo-vs-historical counts (for the console
// and to label the storefront's "Clear demo data" control). Read-only.
// ---------------------------------------------------------------------------
operatorRoutes.get('/events/stats', async (c) => {
  try {
    if (!c.env.DB) {
      return c.json({ success: true, dbBound: false, demoEvents: 0, demoVisitors: 0 });
    }
    const row = await c.env.DB.prepare(
      `SELECT COUNT(*) AS demo_events, COUNT(DISTINCT vuid) AS demo_visitors
         FROM demo_events WHERE source = 'demo'`
    ).first<{ demo_events: number; demo_visitors: number }>();
    return c.json({
      success: true,
      dbBound: true,
      demoEvents: row?.demo_events ?? 0,
      demoVisitors: row?.demo_visitors ?? 0,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Error reading demo event stats:', error);
    return c.json({
      error: 'Failed to read demo event stats',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// ---------------------------------------------------------------------------
// The three human verbs — scope appendix §1.2: "Your team renames, pins, or
// prunes anything the engine proposes."
//
// The generator has always honoured the RESULT of these. audienceGenerator.ts
// skips a pinned audience before it looks at anything else (:193), and skips one
// whose stored content no longer hashes to the generator's own output (:197).
// What was missing was any way to perform them: suggest and publish were the only
// operator verbs, and they act on NEW audiences, not on the ones already live.
//
// AUTHENTICATED, unlike the routes above. These change who qualifies for what on
// the live site, so they fail closed with no verifiable token. The older operator
// routes are still open; CW10 owns bringing them to the same line, and a new write
// surface should not inherit that gap just because it exists.
// ---------------------------------------------------------------------------

const renameSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
});
const pinSchema = z.object({ pinned: z.boolean() });

const audienceWrites = jwt({ required: true });

/**
 * Rename. The KEY is deliberately not changeable: it is load-bearing in cookies,
 * stored decisions and ODP qualification, so a rename is a label change and never
 * an identity change. Renaming also makes the def stop hashing to its recorded
 * generatorHash, which is what tells regeneration a human owns it now.
 */
operatorRoutes.post('/audiences/:key/rename', audienceWrites, async (c) => {
  try {
    const key = c.req.param('key');
    const { name, description } = renameSchema.parse(await c.req.json());
    const updated = await new KvAudienceStore(c.env).rename(key, name, description);
    if (!updated) return c.json({ error: `Audience '${key}' not found` }, 404);
    return c.json({
      success: true, audience: updated,
      message: `Renamed to '${name}'. Regeneration will now leave this audience alone.`,
      timestamp: Date.now(),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid rename request', details: error.issues }, 400);
    }
    console.error('Error renaming audience:', error);
    return c.json({ error: 'Failed to rename audience' }, 500);
  }
});

/** Pin or unpin. A pinned audience is never touched by regeneration, even when
    its content still matches what the generator would produce. */
operatorRoutes.post('/audiences/:key/pin', audienceWrites, async (c) => {
  try {
    const key = c.req.param('key');
    const { pinned } = pinSchema.parse(await c.req.json());
    const updated = await new KvAudienceStore(c.env).setPinned(key, pinned);
    if (!updated) return c.json({ error: `Audience '${key}' not found` }, 404);
    return c.json({
      success: true, audience: updated,
      message: pinned
        ? 'Pinned. Regeneration will never modify or archive this audience.'
        : 'Unpinned. Regeneration may modify this audience again.',
      timestamp: Date.now(),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid pin request', details: error.issues }, 400);
    }
    console.error('Error pinning audience:', error);
    return c.json({ error: 'Failed to pin audience' }, 500);
  }
});

/**
 * Prune. Archive rather than delete: the key stays resolvable, so a decision
 * recorded weeks ago that names this audience can still be explained. Archived
 * audiences drop straight out of qualification, because listPublished() filters
 * on status.
 */
operatorRoutes.post('/audiences/:key/prune', audienceWrites, async (c) => {
  try {
    const key = c.req.param('key');
    const store = new KvAudienceStore(c.env);
    const existing = await store.get(key);
    if (!existing) return c.json({ error: `Audience '${key}' not found` }, 404);
    await store.archive(key);
    return c.json({
      success: true,
      audience: { ...existing, status: 'archived' as const },
      message: `Pruned '${existing.name}'. It no longer qualifies anyone; its key stays resolvable for past decisions.`,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error('Error pruning audience:', error);
    return c.json({ error: 'Failed to prune audience' }, 500);
  }
});

export default operatorRoutes;
export { operatorRoutes };
