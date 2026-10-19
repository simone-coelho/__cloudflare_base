// src/routes/live.ts
// ─────────────────────────────────────────────────────────────────────────────
// The Bright Hour storefront API, mounted at /live/api (QVC brief §4.2: the
// route is `/live`, the same static-assets mechanism every other demo surface
// uses — zero routing code for the page itself; this is only its data plane).
//
// Four doors, and each one is deliberately thin:
//
//   POST /live/api/page              → the composed page: one decision per slot,
//                                      each with its explain record, plus the
//                                      closed-form next lifecycle boundary.
//   POST /live/api/event             → the shopper's signal, PROXIED into the
//                                      existing /realtime/action pipeline with
//                                      surface:'brighthour' stamped, under the
//                                      visitor's own shopper session.
//   GET  /live/api/reflex            → the visitor's live affinity snapshot,
//                                      delegated to the (now surface-aware)
//                                      /realtime/reflex.
//   GET  /live/api/decisions/export  → Beat 7's warehouse-shaped rows.
//
// WHY THE EVENT ROUTE PROXIES INSTEAD OF RE-IMPLEMENTING (the choice the build
// spec asked to be justified): /realtime/action is not a thin handler — it is
// the ingestion path. It captures to D1 off the response path, forwards to ODP,
// upserts the profile on membership change, honors REFLEX_HOST='do', and runs
// the reflex → qualify → decide → push loop. Re-implementing any of that for a
// second surface would fork the pipeline and guarantee drift. Posting from the
// page DIRECTLY to /realtime/action was the alternative; it was rejected because
// the browser would then have to be trusted to stamp `surface` on every call,
// and one page bug would silently score Bright Hour behaviour into the Coach
// demo's audience space. Stamping the surface SERVER-SIDE, in one place, makes
// the isolation contract structural rather than a convention the page must
// remember. The proxy also drops the pipeline's Set-Cookie headers on purpose:
// the Bright Hour page uses credentials:'omit' and resolves identity by its own
// visitorId, so no coach session cookie can ever cross the surface boundary.
// The shopper session the pipeline requires is issued to that visitorId inside
// the worker and never leaves it (see "The demo visitor's shopper authority").
//
// The composer itself is pure (src/demos/brighthour/composer.ts). Everything
// clock-, session- and D1-shaped lives here, at the edge of it.
// ─────────────────────────────────────────────────────────────────────────────

import type { TenantVariables } from '@/tenancy/tenant';
import { shopperObject } from '@/tenancy/objects';
import { DEFAULT_TENANT, type TenantId } from '@/tenancy/tenant';
import { tenantMiddleware } from '@/tenancy/middleware';
import { Hono, type Context } from 'hono';
import { z } from 'zod';

import type { Env } from '@/types/env';
import { getConnectors } from '@/connectors';
import { RealtimeSegmentEngine } from '@/services/RealtimeSegmentEngine';
import { snapshot as reflexSnapshot } from '@/reflex/core';
import { resolveReflexConfig } from '@/demos/registry';
import realtimeRoutes from '@/routes/realtime';
import { identityRoutes } from '@/routes/identity';
import { SHOPPER_HEADER } from '@/identity/sessionCapability';
import { errorHandler } from '@/middleware/error';
import { makeDemoClock } from '@/demos/brighthour/demoClock';
import {
  BH_EXPERIMENT_SLOT,
  frameOffer,
  getAssignment,
  getBhExperimentIds,
  launchBhExperiment,
  stampExperiment,
  trackBhOfferClick,
  type BhAssignment,
} from '@/demos/brighthour/experiment';
import { resolveBhGeoCohort, type BhGeoInput } from '@/demos/brighthour/geoCohort';
import { gateWrite } from '@/services/fxEnv';
import {
  BH_DECISION_COLUMNS,
  clockMultiplierOf,
  composePage,
  decisionRows,
  loadComposerCatalog,
  stampEngineLatency,
  writeDecisionRows,
  type DimensionScores,
} from '@/demos/brighthour/composer';

const liveRoutes = new Hono<{ Bindings: Env; Variables: TenantVariables }>();

/** Every Bright Hour call is this surface, stamped server-side. Never inferred. */
const SURFACE = 'brighthour';

/** The execution context, or undefined where there is none (tests, sub-fetches). */
function execCtxOf(c: { executionCtx: ExecutionContext }): ExecutionContext | undefined {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
}

/** Run a promise off the response path; degrade cleanly where no ctx exists. */
function background(c: { executionCtx: ExecutionContext }, p: Promise<unknown>): void {
  const ctx = execCtxOf(c);
  if (ctx) ctx.waitUntil(p);
  else void p; // still runs — it just isn't kept alive by the runtime
}

// ── The demo visitor's shopper authority ─────────────────────────────────────
//
// Every shopper door of today's engine (/realtime/action, /realtime/reflex)
// admits a caller only on a signed shopper session capability — one tenant, one
// subject, one session, a bounded lifetime — and serves her from her own
// object. The Bright Hour page holds no credential: `public/` is served
// wholesale, so a token written there is a credential anyone can fetch, and the
// page identifies its visitor by the id it keeps in its own storage. So, as the
// Top Offers route does for operator authority (src/routes/topOffers.ts), the
// credential stays in the worker:
//
//   • It is issued only where DEPLOYMENT_PROFILE is 'demo'. Anywhere else every
//     shopper call this surface makes is answered with the refusal, and the
//     worker's own boundary (src/index.ts) does not route /live/api on a
//     customer stamp at all.
//   • It is never fabricated. It is the capability the identity session door
//     (POST /v1/:tenant/identity/session) issues to any new anonymous browser,
//     with its own subject, session, grant and lifetime. Nothing here widens it:
//     this surface only remembers which one was issued for which visitor, in
//     this isolate, until shortly before it expires.
//   • Every shopper call this surface makes carries it and X-Tenant and
//     re-enters the ordinary doors, so the same tenant resolution, capability
//     check, owner forwarding, consent, retention and refusals apply as for any
//     browser. Whatever a door refuses is answered as refused, with the door's
//     own status and reason, never as accepted.

type LiveContext = Context<{ Bindings: Env; Variables: TenantVariables }>;

/** The in-process origin every sub-request names. Never a network call. */
const INTERNAL_ORIGIN = 'https://brighthour.internal';

/**
 * The ordinary shopper doors, at the paths the worker mounts them (src/index.ts)
 * and behind the same tenant resolution and error handler. The owner forwarding
 * inside them selects its operation by that path, so the path must be the real one.
 */
const shopperDoors = new Hono<{ Bindings: Env; Variables: TenantVariables }>();
shopperDoors.use('*', tenantMiddleware());
shopperDoors.onError(errorHandler);
shopperDoors.route('/realtime', realtimeRoutes);
shopperDoors.route('/v1', identityRoutes);

/** The session the identity door issued for one Bright Hour visitor. */
interface DemoShopper {
  tenant: TenantId;
  subject: string;
  sessionId: string;
  capability: string;
  /** The capability's own expiry, in epoch seconds. */
  exp: number;
}

/** A door's refusal: the step it refused, the door's status and its own reason. */
class Refused extends Error {
  constructor(
    readonly stage: 'session' | 'event' | 'affinity',
    readonly status: number,
    readonly reason: string
  ) {
    super(reason);
    this.name = 'Refused';
  }
}

/** A held session is replaced this long before its own expiry, never used past it. */
const RENEW_BEFORE_SECONDS = 5 * 60;
/** One demo stage, many visitors: past this bound the oldest entry goes first. */
const MAX_DEMO_SHOPPERS = 10_000;

interface DemoShopperEntry {
  issued: Promise<DemoShopper>;
  shopper?: DemoShopper;
}
const demoShoppers = new Map<string, DemoShopperEntry>();
const demoShopperKey = (tenant: TenantId, visitorId: string) => `${tenant}\u0000${visitorId}`;
const nowSeconds = () => Math.floor(Date.now() / 1000);

/** The request's tenant, named as readAffinity names it when none was resolved. */
function tenantOrDefault(tenant: TenantId | undefined): TenantId {
  return tenant ?? DEFAULT_TENANT;
}

/** Ask the identity session door for a new anonymous session, as a new browser does. */
async function issueDemoShopper(env: Env, tenant: TenantId, ctx: ExecutionContext): Promise<DemoShopper> {
  const res = await shopperDoors.fetch(
    new Request(`${INTERNAL_ORIGIN}/v1/${encodeURIComponent(tenant)}/identity/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tenant': tenant },
      body: '{}',
    }),
    env,
    ctx
  );
  const body = (await res.json().catch(() => null)) as {
    ok?: unknown;
    error?: unknown;
    session?: Partial<Record<keyof DemoShopper, unknown>>;
  } | null;
  const s = body?.session;
  if (!res.ok || body?.ok !== true || !s || s.tenant !== tenant || typeof s.subject !== 'string'
    || typeof s.sessionId !== 'string' || typeof s.capability !== 'string' || typeof s.exp !== 'number') {
    throw new Refused('session', res.ok ? 502 : res.status,
      typeof body?.error === 'string' ? body.error : 'the identity session door issued no session');
  }
  return { tenant, subject: s.subject, sessionId: s.sessionId, capability: s.capability, exp: s.exp };
}

/**
 * The visitor's session: the one already issued while it has time left, else a
 * new one from the identity door. Concurrent first calls share one issue, and a
 * refused issue is not remembered, so her next call asks the door again.
 */
function demoShopperFor(env: Env, tenant: TenantId, visitorId: string, ctx: ExecutionContext): Promise<DemoShopper> {
  if (env.DEPLOYMENT_PROFILE !== 'demo') {
    return Promise.reject(new Refused('session', 403, 'the demo shopper session is issued only on the demo profile'));
  }
  const key = demoShopperKey(tenant, visitorId);
  const held = demoShoppers.get(key);
  if (held && (!held.shopper || held.shopper.exp - nowSeconds() > RENEW_BEFORE_SECONDS)) return held.issued;
  const entry: DemoShopperEntry = { issued: issueDemoShopper(env, tenant, ctx) };
  demoShoppers.delete(key);
  demoShoppers.set(key, entry);
  if (demoShoppers.size > MAX_DEMO_SHOPPERS) {
    const oldest = demoShoppers.keys().next().value;
    if (oldest !== undefined) demoShoppers.delete(oldest);
  }
  void entry.issued.then(
    (shopper) => {
      entry.shopper = shopper;
    },
    () => {
      if (demoShoppers.get(key) === entry) demoShoppers.delete(key);
    }
  );
  return entry.issued;
}

/** The visitor's session for this request, its issue's background work kept alive. */
async function demoShopperOf(c: LiveContext, visitorId: string): Promise<DemoShopper> {
  const { ctx, settled } = collectingCtx();
  try {
    return await demoShopperFor(c.env, tenantOrDefault(c.get('tenant')), visitorId, ctx);
  } finally {
    background(c, settled());
  }
}

/** The session this isolate already holds for the visitor, if any. Never issues one. */
async function heldDemoShopper(tenant: TenantId, visitorId: string): Promise<DemoShopper | undefined> {
  const held = demoShoppers.get(demoShopperKey(tenant, visitorId));
  if (!held) return undefined;
  try {
    const shopper = await held.issued;
    return shopper.exp > nowSeconds() ? shopper : undefined;
  } catch {
    return undefined; // a refused issue holds no session
  }
}

/** A session the doors no longer admit is not used again: her next call is issued a new one. */
function forgetDemoShopper(shopper: DemoShopper, visitorId: string): void {
  const key = demoShopperKey(shopper.tenant, visitorId);
  if (demoShoppers.get(key)?.shopper === shopper) demoShoppers.delete(key);
}

/** What every shopper call of this surface carries. */
const shopperHeaders = (shopper: DemoShopper): Record<string, string> => ({
  [SHOPPER_HEADER]: shopper.capability,
  'X-Tenant': shopper.tenant,
});

/** Her live affinity snapshot, read through her own session on the Bright Hour tuning. */
const reflexRequestOf = (shopper: DemoShopper) =>
  new Request(
    `${INTERNAL_ORIGIN}/realtime/reflex?userId=${encodeURIComponent(shopper.subject)}&surface=${SURFACE}`,
    { headers: shopperHeaders(shopper) }
  );

/**
 * A refusal, answered as one. 400 and 413 are the request's own fault and keep
 * their status; anything else a door refused is this surface failing to get the
 * call through, so 503 for the session and 502 for the rest. The door's own
 * status and reason are carried either way.
 */
function refusedAnswer(c: LiveContext, refusal: Refused, extra: Record<string, unknown> = {}) {
  const status = refusal.status === 400 || refusal.status === 413 ? refusal.status
    : refusal.stage === 'session' ? 503 : 502;
  return c.json(
    { ok: false, success: false, surface: SURFACE, stage: refusal.stage, status: refusal.status, error: refusal.reason, ...extra },
    status as 502
  );
}

// ── Burst-safe ingestion (the scroll-storm fix) ──────────────────────────────
//
// WHY THIS EXISTS. A presenter scrolling the storefront surfaces ~32 cards at
// once, and every one of them is an impression. Posted concurrently, each of
// those events entered `processActionEvent` reading the SAME "before" session,
// so each independently concluded its segments had changed and each ran the
// expensive step-6 decision leg (RealtimeSegmentEngine.getPersonalizationConfig
// → FeatureVariableManager → a per-request OptimizelyService.initialize()).
// That leg is hundreds of milliseconds of single-threaded work per call, so N
// concurrent impressions cost N× of it, serialized on the isolate — measured at
// 12.6s inside ONE call at 8-way concurrency, and 47s wall for the burst. The
// worker looked wedged to every visitor because the isolate had no thread left.
//
// It was also silently WRONG: eight unsynchronized read-modify-write cycles over
// one KV session mean last-write-wins, so seven of the eight events' scoring was
// simply lost. Sequential traffic never showed either symptom, because event N+1
// reads N's persisted state, finds nothing changed, and takes the cheap early
// return — which is exactly why the Coach storefront (one event at a time, at
// human pace) has never tripped this.
//
// So Bright Hour ingestion is SERIALIZED PER VISITOR inside the isolate. A burst
// becomes a queue: the first event pays the decision leg, the rest take the
// cheap path, and each one sees its predecessor's state instead of racing it.
// Throughput is unchanged (the work was single-threaded regardless) — what goes
// away is the N× stampede and the lost updates.

/** One in-flight chain per visitor. Module-scoped: one queue per isolate. */
interface IngestQueue {
  /** Resolves when everything queued so far has drained. */
  tail: Promise<unknown>;
  /** How many jobs are still outstanding — the read path's cheap depth probe. */
  depth: number;
}
const ingestChains = new Map<string, IngestQueue>();

/**
 * Await every in-flight ingestion chain. FOR TESTS. The burst tests used to wait
 * for the queue to "go quiet" on a wall clock, which is a race dressed as an
 * assertion: under load the quiet period arrived before the last write did and
 * the test failed for reasons unrelated to the code under test. Awaiting the
 * tails is the same question asked deterministically.
 */
export async function __drainIngestChainsForTests(): Promise<void> {
  // Tails can enqueue more work (a reply that schedules a push), so loop until
  // a full pass finds nothing outstanding.
  for (let pass = 0; pass < 50; pass++) {
    const tails = [...ingestChains.values()].map((q) => q.tail);
    if (tails.length === 0) return;
    await Promise.all(tails);
    if ([...ingestChains.values()].every((q) => q.depth <= 0)) return;
  }
}

/**
 * Queue `fn` behind anything already running for this visitor, and hand back a
 * promise for THIS job. A rejection never poisons the chain, and the map entry
 * is dropped once the queue drains so a long demo cannot leak visitors.
 */
function serialByVisitor<T>(visitorId: string, fn: () => Promise<T>): Promise<T> {
  const q = ingestChains.get(visitorId);
  const prev = q ? q.tail : Promise.resolve();
  const run = prev.then(fn, fn);
  const entry: IngestQueue = { tail: Promise.resolve(), depth: (q?.depth ?? 0) + 1 };
  entry.tail = run.then(
    () => {
      entry.depth -= 1;
    },
    () => {
      entry.depth -= 1;
    }
  );
  ingestChains.set(visitorId, entry);
  void entry.tail.then(() => {
    const current = ingestChains.get(visitorId);
    if (current === entry && current.depth <= 0) ingestChains.delete(visitorId);
  });
  return run;
}

/**
 * Wait for this visitor's queued ingestion to drain — but only when the queue is
 * SHALLOW enough that waiting is cheap.
 *
 * This is what keeps READ-YOUR-WRITES true at interactive pace: a shopper clicks,
 * the page recomposes, and the composition reflects the click rather than the
 * state before it. At burst pace it deliberately does NOT wait. Thirty-two
 * impressions are ~30 pipeline passes deep, and a read that queued behind them
 * would hand the presenter a spinner for the length of the drain — trading the
 * old wedge for a new one. Past the threshold the read simply takes the affinity
 * as it stands: a fraction of a scroll-burst behind, on a score that decays
 * continuously anyway, and corrected by the next poll.
 *
 * The time bound is a second guard, not the primary one. It cannot be the
 * primary one: the drain is largely CPU-bound, and a timer cannot fire on an
 * isolate that is busy — which is exactly how a "2s budget" becomes 20 seconds.
 */
const SETTLE_MAX_DEPTH = 4;

async function settleVisitor(visitorId: string, budgetMs = 2000): Promise<void> {
  const q = ingestChains.get(visitorId);
  if (!q || q.depth > SETTLE_MAX_DEPTH) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      q.tail,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, budgetMs);
      }),
    ]);
  } catch {
    /* the chain swallows its own failures; a read must never inherit one */
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * An ExecutionContext for work that outlives its request.
 *
 * The deferred ingestion still calls into /realtime/action, which registers its
 * own background work (the D1 capture, the ODP forward and profile upsert) on
 * whatever ctx it is handed. Handing it the REAL one would mean calling
 * waitUntil on a request that has already responded; this collector takes those
 * promises instead and folds them into the deferred job's own lifetime, so the
 * capture/ODP legs keep running exactly as they did before.
 */
function collectingCtx(): { ctx: ExecutionContext; settled: () => Promise<void> } {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(p: Promise<unknown>) {
      pending.push(Promise.resolve(p).catch(() => {}));
    },
    passThroughOnException() {},
  } as unknown as ExecutionContext;
  return {
    ctx,
    settled: async () => {
      await Promise.allSettled(pending);
    },
  };
}

// ── Affinity read (the same seams the engine uses, surface-parameterized) ────

interface AffinityRead {
  sessionId: string | null;
  dims: DimensionScores;
  memberships: string[];
}

/**
 * The visitor's live affinity, resolved exactly the way RealtimeSegmentEngine's
 * reflex block does — including the P2 split: with REFLEX_HOST='do' the vector
 * lives in the shopper's own ShopperReflex DO and is read there.
 *
 * Scores are computed against REAL time, never demo time. Affinity decays at
 * the pace of the shopper's attention; only the OFFER calendar is compressed
 * (demoClock). Conflating the two would be exactly the kind of faked stamp the
 * clock module exists to forbid.
 *
 * `cookieHeader` is never passed: identity here is the Bright Hour visitorId,
 * so the coach session cookie can neither be read nor written on this path.
 *
 * W36 (F14 R8). `clientSessionId` is the session the page's client sent. On the
 * session host it is looked up before the visitor's `user:` pointer, so a
 * pointer read that misses composes her page from her own session instead of
 * a new, empty one. It is used only when the record it names is this
 * visitor's own: another visitor's record is never served or written, even
 * when the first read of the id misses or fails (the engine binds its reread
 * to this visitor), and an id that names none serves what no id serves. The
 * object host needs none: the visitor's own object is the identity there.
 */
async function readAffinity(
  env: Env, visitorId: string, realNowMs: number,
  // Named rather than defaulted silently: an invisible default is the exact
  // hazard @/tenancy is written against.
  tenant: TenantId = DEFAULT_TENANT,
  clientSessionId?: string,
): Promise<AffinityRead> {
  if ((env.REFLEX_HOST ?? 'session') === 'do') {
    const stub = shopperObject(env.SHOPPER_REFLEX, visitorId, tenant);
    const res = await stub.fetch('https://shopper-reflex/snapshot');
    const body = (await res.json()) as { affinity?: { dims?: DimensionScores; audiences?: string[] } };
    return {
      sessionId: null, // the DO IS the identity on this host
      dims: body?.affinity?.dims ?? {},
      memberships: body?.affinity?.audiences ?? [],
    };
  }

  // The request's tenant, as the object host above already uses it.
  const engine = new RealtimeSegmentEngine(env, getConnectors(env, tenant), { tenant });
  const { sessionId, sessionData } = await engine.getOrCreateSessionFromCookies(null, visitorId, undefined, clientSessionId);
  if (!sessionData.reflex) return { sessionId, dims: {}, memberships: [] };

  const cfg = await resolveReflexConfig(env, SURFACE);
  const snap = reflexSnapshot(sessionData.reflex, realNowMs, cfg);
  return { sessionId, dims: snap.dims, memberships: snap.audiences };
}

/**
 * The same affinity, read through the session this surface issued her: the
 * ordinary /realtime/reflex door, her capability, the Bright Hour tuning. A
 * refused or unreadable answer is a refusal of the page, never an empty vector
 * served as if she were new.
 */
async function readOwnedAffinity(
  env: Env, shopper: DemoShopper, visitorId: string, ctx: ExecutionContext | undefined,
): Promise<AffinityRead> {
  const res = await shopperDoors.fetch(reflexRequestOf(shopper), env, ctx);
  const body = (await res.json().catch(() => null)) as {
    ok?: unknown;
    error?: unknown;
    affinity?: { dims?: DimensionScores; audiences?: string[] } | null;
  } | null;
  if (!res.ok || !body || body.ok === false) {
    if (res.status === 401) forgetDemoShopper(shopper, visitorId);
    throw new Refused('affinity', res.ok ? 502 : res.status,
      typeof body?.error === 'string' ? body.error : 'her session could not be read');
  }
  return {
    sessionId: shopper.sessionId,
    dims: body.affinity?.dims ?? {},
    memberships: body.affinity?.audiences ?? [],
  };
}

// ── Beat 13: the experiment view the page carries ────────────────────────────

/**
 * The assignment, plus the copy it actually produces for slot 2.
 *
 * `frameOffer` is applied to the offer the composer already chose, so the arm
 * changes the LANGUAGE and nothing else — same item, same window, same gates.
 * That is the whole point of putting the experiment on this slot: it isolates
 * framing from selection, and an analyst can see that it does.
 */
function experimentView(assignment: BhAssignment, page: { decisions: { slot_id: string; offer: unknown }[] }) {
  const slot = page.decisions.find((d) => d.slot_id === BH_EXPERIMENT_SLOT);
  const offer = (slot?.offer ?? null) as { windowLanguage?: string | null; label?: string | null } | null;
  return {
    experimentKey: assignment.experimentKey,
    flagKey: assignment.flagKey,
    slotId: assignment.slotId,
    variationKey: assignment.variationKey,
    variationId: assignment.variationId,
    experimentId: assignment.experimentId,
    campaignId: assignment.campaignId,
    launched: assignment.launched,
    /** 'sdk' = the real Optimizely SDK decided it; 'hash' = the labeled fallback. */
    source: assignment.source,
    ruleKey: assignment.ruleKey ?? null,
    bucket: assignment.bucket,
    bucketedOn: assignment.bucketedOn,
    framing: assignment.framing.style,
    /** What the slot-2 offer chip reads under this arm. */
    offerCopy: frameOffer(assignment.framing, offer),
  };
}

// ── POST /live/api/page ──────────────────────────────────────────────────────

const pageSchema = z.object({
  visitorId: z.string().min(1),
  page: z.string().optional(),
  /** Beat 9: force the layout instead of waiting for the dimension to cross θin. */
  missionOverride: z.enum(['mission', 'browse']).optional(),
  /**
   * The category shelf the visitor navigated into ("Shop by Category"), by its
   * display name — 'Electronics & Tech'. The composer resolves it against the
   * catalog and ignores anything no item carries, so a stale link composes the
   * ordinary page instead of an empty rail.
   */
  focusCategory: z.string().min(1).max(64).optional(),
  sessionId: z.string().optional(),
  demoRunId: z.string().optional(),
  /** Beat 5: the presenter's quota switch — off shows the monotone page. */
  quotaEnabled: z.boolean().optional(),
  /** Beat 14: whether the VIP savings event is running (§C3's exclusion roster). */
  vipOfferActive: z.boolean().optional(),
  /**
   * Real instant the demo timeline is pinned to — normally the page's own load
   * stamp. With BRIGHTHOUR_CLOCK_MULTIPLIER=1 (the default) it has no effect at
   * all: demo time IS real time.
   */
  clockAnchorMs: z.number().optional(),
  /**
   * Beat 2f: the presenter's time-travel offset, in ms of DEMO time.
   *
   * `clockAnchorMs` alone cannot move the timeline: the map is
   * `demo(t) = anchorDemo + (t − anchorReal)·m`, and the route pins
   * `anchorDemo = anchorReal`, so at the default m=1 the anchor cancels and
   * demo time is exactly real time whatever anchor you pass. Advancing the
   * clock means displacing the DEMO anchor — which is precisely what this is.
   *
   * Offset 0 (or absent) is byte-identical to the previous behaviour.
   *
   * Scope: OFFER WINDOWS only. Affinity decay deliberately keeps reading
   * `realNowMs` below, so time travel never fakes a decay beat.
   */
  clockOffsetMs: z.number().optional(),
});

liveRoutes.post('/page', async (c) => {
  const startedAt = Date.now();
  try {
    const body = await c.req.json();
    const input = pageSchema.parse(body);

    const realNowMs = Date.now();
    const { epochMs, items, events } = await loadComposerCatalog(c.env, realNowMs);

    // demoClock: scale the RATE of time, never the stamps. Anchored at the
    // presenter's own start instant so a multiplier accelerates FROM now rather
    // than catapulting the timeline past every window in the catalog.
    const multiplier = clockMultiplierOf(c.env);
    const anchorRealMs =
      typeof input.clockAnchorMs === 'number' && Number.isFinite(input.clockAnchorMs)
        ? input.clockAnchorMs
        : realNowMs;
    // Beat 2f: displace the DEMO anchor to time-travel the offer calendar.
    // Zero keeps demo time pinned to real time exactly as before.
    const clockOffsetMs =
      typeof input.clockOffsetMs === 'number' && Number.isFinite(input.clockOffsetMs)
        ? input.clockOffsetMs
        : 0;
    const clock = makeDemoClock({
      anchorRealMs,
      anchorDemoMs: anchorRealMs + clockOffsetMs,
      multiplier,
    });
    const nowMs = Math.round(clock.demoNow(realNowMs));

    // Read-your-writes: the composition must reflect every event this visitor
    // has already had accepted, so drain their queue (bounded) before reading.
    await settleVisitor(input.visitorId);

    // Her own session, when this surface has issued her one: the events she sent
    // were scored there, so that is what her page is composed from. A visitor
    // this isolate holds no session for is read exactly as before.
    const shopper = await heldDemoShopper(tenantOrDefault(c.get('tenant')), input.visitorId);
    const affinity = shopper
      ? await readOwnedAffinity(c.env, shopper, input.visitorId, execCtxOf(c))
      : await readAffinity(c.env, input.visitorId, realNowMs, c.get('tenant'), input.sessionId);
    const sessionId = input.sessionId ?? affinity.sessionId;

    const page = composePage({
      visitorId: input.visitorId,
      nowMs,
      items,
      events,
      scores: affinity.dims,
      memberships: affinity.memberships,
      reflexConfig: await resolveReflexConfig(c.env, SURFACE),
      experimentIds: await getBhExperimentIds(c.env).catch(() => null),
      sessionMission: input.missionOverride,
      focusCategory: input.focusCategory ?? null,
      page: input.page ?? 'home',
      sessionId,
      demoRunId: input.demoRunId ?? sessionId ?? null,
      epochMs,
      clockMultiplier: multiplier,
      config: {
        ...(input.quotaEnabled === undefined ? {} : { quotaEnabled: input.quotaEnabled }),
        ...(input.vipOfferActive === undefined ? {} : { vipOfferActive: input.vipOfferActive }),
      },
    });

    stampEngineLatency(page, Date.now() - startedAt);

    // Beat 13: which arm of the slot-2 framing experiment this visitor is in.
    // Costs nothing until the experiment has actually been launched (the module
    // returns immediately when there is no published datafile), and it can never
    // break a composition — a failed assignment is simply no assignment.
    const assignment = await getAssignment(c.env, input.visitorId).catch(() => null);

    // Beat 7 + 13: one row per slot decision, and the slot under test carries
    // the experiment triple in the SAME row as its affinity scores. Written OFF
    // the response path — the shopper never waits on the warehouse.
    const rows = decisionRows(page);
    stampExperiment(rows, assignment);
    background(c, writeDecisionRows(c.env, rows));

    return c.json({
      ok: true,
      ...page,
      // The composer is pure and owns no experiment concept (its seam lands
      // separately); the assignment is therefore surfaced alongside the page
      // rather than inside a decision, so nothing in composer.ts had to move.
      experiment: assignment ? experimentView(assignment, page) : null,
      // Real-time instant the next lifecycle boundary lands on — what a client
      // timer must actually schedule against when the clock is compressed.
      nextTransitionAtReal:
        page.nextTransitionAt === null ? null : Math.round(clock.realFor(page.nextTransitionAt)),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ ok: false, error: 'Invalid page request', details: error.issues }, 400);
    }
    if (error instanceof Refused) return refusedAnswer(c, error);
    console.error('Error composing Bright Hour page');
    return c.json(
      { ok: false, error: error instanceof Error ? error.message : 'compose failed' },
      500
    );
  }
});

// ── GET /live/api/geo ────────────────────────────────────────────────────────

/**
 * The geo-cohort COLD START: what the very first paint can honestly say to a
 * visitor nobody has ever seen (src/demos/brighthour/geoCohort.ts).
 *
 * The geography is read off `request.cf` — Cloudflare resolves it at the edge and
 * hands it to the Worker ON the request, so there is no client script to block,
 * no pixel to refuse and no third party involved. Under `wrangler dev` the local
 * runtime populates only part of `cf` (city is frequently absent), which is why
 * the payload's `precision` field is explicit and the banner degrades city →
 * region → 'your area'. In production the same code path sees the richer object.
 *
 * QA / rehearsal overrides (?city=&region=&regionCode=&postal=&metro=) are the
 * LABELLED path: any of them present and the payload reports source:'query'
 * instead of 'edge', exactly like the Coach /geo/cohort route. Never mixed with
 * the real cf, so a forced state cannot be silently corrected by the edge ZIP.
 *
 * Coach's own /geo routes are untouched: this shares their brain, not their door.
 */
liveRoutes.get('/geo', async (c) => {
  try {
    const cf = ((c.req.raw as unknown as { cf?: Record<string, unknown> }).cf ?? {}) as Record<string, unknown>;
    const q = c.req.query();
    const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

    const hasOverride =
      q.city != null || q.region != null || q.regionCode != null || q.postal != null || q.metro != null;

    const geo: BhGeoInput = hasOverride
      ? {
          city: str(q.city),
          region: str(q.region),
          regionCode: str(q.regionCode) ?? str(q.region),
          metroCbsa: str(q.metro),
          postalCode: str(q.postal),
          country: str(q.country) ?? 'US',
          source: 'query',
        }
      : {
          city: str(cf.city),
          region: str(cf.region),
          regionCode: str(cf.regionCode),
          metroCbsa: null, // the edge's metroCode is a Nielsen DMA — the ZIP crosswalk owns CBSA
          dmaCode: str(cf.metroCode),
          postalCode: str(cf.postalCode),
          country: str(cf.country),
          source: 'edge',
        };

    const realNowMs = Date.now();
    const { items } = await loadComposerCatalog(c.env, realNowMs);
    const cohort = await resolveBhGeoCohort(c.env, geo, items, realNowMs);
    return c.json({ ok: true, ...cohort });
  } catch (error) {
    console.error('Error resolving Bright Hour geo cohort');
    return c.json(
      { ok: false, error: error instanceof Error ? error.message : 'geo cohort failed' },
      500
    );
  }
});

// ── POST /live/api/event ─────────────────────────────────────────────────────

/**
 * Action names /realtime/action's schema accepts verbatim. Everything else the
 * live-commerce catalog makes possible (clip_play, offer_click, host_page_view,
 * search_to_pdp, …) rides as type:'custom' with `data.action` carrying the real
 * name — which is precisely the field the reflex core weighs (BRIGHTHOUR_WEIGHTS).
 */
const PASSTHROUGH_TYPES: ReadonlySet<string> = new Set([
  'product_view',
  'add_to_cart',
  'wishlist_add',
  'page_view',
  'button_click',
  'custom',
]);

const eventSchema = z.object({
  visitorId: z.string().min(1),
  /** Normalized action name, e.g. 'product_view' | 'clip_play' | 'offer_click'. */
  action: z.string().min(1),
  itemId: z.string().optional(),
  sessionId: z.string().optional(),
  data: z.record(z.string(), z.any()).optional(),
  timestamp: z.number().optional(),
});

type EventInput = z.infer<typeof eventSchema>;

/** The /realtime/action body for one Bright Hour signal, surface stamped here. */
function actionPayloadOf(input: EventInput, shopper: DemoShopper): Record<string, unknown> {
  return {
    type: PASSTHROUGH_TYPES.has(input.action) ? input.action : 'custom',
    // The subject her session was issued for: the door admits no other.
    userId: shopper.subject,
    // Both are stamped: `surface` is authoritative in the registry, `source`
    // is the belt-and-braces fallback for anything reading provenance only.
    surface: SURFACE,
    source: SURFACE,
    data: {
      ...(input.data ?? {}),
      action: input.action,
      ...(input.itemId ? { product_id: input.itemId } : {}),
    },
    timestamp: input.timestamp ?? Date.now(),
    // The page's own session id names her BROWSING session, which attributes
    // the event; her profile session is the one her capability carries, and
    // the door refuses any other in `sessionId`.
    ...(input.sessionId ? { browsingSessionId: input.sessionId } : {}),
  };
}

/**
 * Push one signal through the shared pipeline, under her own session.
 *
 * ONE ingestion path for both demos. No Cookie header goes in, and no Set-Cookie
 * comes back out — the surfaces share a pipeline, never an identity. The answer
 * is read, never just drained: anything but the pipeline's own acceptance is a
 * refusal, thrown with the pipeline's status and reason.
 */
async function ingestOne(env: Env, ctx: ExecutionContext, shopper: DemoShopper, input: EventInput): Promise<void> {
  const res = await shopperDoors.fetch(
    new Request(`${INTERNAL_ORIGIN}/realtime/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...shopperHeaders(shopper) },
      body: JSON.stringify(actionPayloadOf(input, shopper)),
    }),
    env,
    ctx
  );
  const body = (await res.json().catch(() => undefined)) as { success?: unknown; error?: unknown } | undefined;
  if (!res.ok || body?.success !== true) {
    throw new Refused('event', res.ok ? 502 : res.status,
      typeof body?.error === 'string' ? body.error : `the pipeline answered ${res.status} without accepting the event`);
  }
}

/**
 * Accept a batch of signals: queue them on the visitor's chain, IN ORDER, and
 * return a promise for the whole drain. Ordering matters — the reflex weighs a
 * view differently once a cart-add has landed, so a burst must be replayed in
 * the sequence the shopper produced it, never interleaved.
 */
/**
 * A breath between consecutive pipeline passes.
 *
 * One pass is a few hundred milliseconds of largely CPU-bound work (audience
 * qualification over the generated set, then the decision leg). Draining a
 * thirty-two-card scroll back-to-back therefore hands the isolate several
 * unbroken seconds of compute, and every OTHER visitor's request — a bystander's
 * page composition, the presenter's own next poll — queues behind it. Measured:
 * a bystander page went to 14.7s during an unthrottled drain.
 *
 * Yielding between passes costs the burst nothing that matters (it is background
 * work nobody is waiting on) and gives the runtime a scheduling point where real
 * requests get served. The drain takes marginally longer; the storefront stays
 * answerable throughout, which is the trade that matters on a demo stage.
 */
const DRAIN_YIELD_MS = 45;

/**
 * Beat 13's conversion. Which signals count as "the shopper acted on the offer
 * under test" — an intent-bearing click on the slot-2 card, never an impression
 * and never a quantity fiddle. The slot check is what keeps the metric honest:
 * a cart-add anywhere else on the page is not evidence about this framing.
 */
const BH_OFFER_CLICK_ACTIONS: ReadonlySet<string> = new Set([
  'add_to_cart',
  'product_click',
  'waitlist',
  'preorder',
  'offer_click',
]);

function isBhOfferClick(input: EventInput): boolean {
  if (!BH_OFFER_CLICK_ACTIONS.has(input.action)) return false;
  return input.data?.slot_id === BH_EXPERIMENT_SLOT;
}

/** One signal and the session it is sent under. */
interface Member {
  input: EventInput;
  shopper: DemoShopper;
}

/**
 * Queue every member on its visitor's chain, in order. `answers` holds each
 * member's pipeline answer (null = accepted, else its refusal) as soon as its
 * own pass has answered; `settled` is everything after that — the conversion
 * forward, the breath between passes and the background work the passes
 * registered — which stays off the response path.
 */
function acceptEvents(env: Env, members: readonly Member[]): { answers: Promise<Array<Refused | null>>; settled: Promise<void> } {
  const { ctx, settled } = collectingCtx();
  const answered: Array<Promise<Refused | null>> = [];
  const jobs = members.map(({ input, shopper }) => {
    let answer: (refusal: Refused | null) => void = () => undefined;
    answered.push(new Promise<Refused | null>((resolve) => {
      answer = resolve;
    }));
    return serialByVisitor(input.visitorId, async () => {
      let refusal: Refused | null = null;
      try {
        await ingestOne(env, ctx, shopper, input);
      } catch (error) {
        // A single refused signal never breaks the queue behind it, and is
        // answered as refused, never as accepted.
        refusal = error instanceof Refused ? error : new Refused('event', 500, 'the pipeline could not be reached');
        if (refusal.status === 401) forgetDemoShopper(shopper, input.visitorId);
        console.error('Bright Hour ingestion refused');
      } finally {
        answer(refusal);
      }

      // Beat 13: the same click, once the pipeline accepted it, forwarded to
      // Optimizely as the experiment's conversion, attributed to the arm this
      // visitor was bucketed into. A no-op until the experiment is launched AND
      // published, and its failure is never allowed to matter — measurement
      // rides behind ingestion, not in front of it.
      if (!refusal && isBhOfferClick(input)) {
        try {
          const assignment = await getAssignment(env, input.visitorId);
          await trackBhOfferClick(env, input.visitorId, assignment, {
            itemId: input.itemId ?? null,
            action: input.action,
            timestamp: input.timestamp,
          });
        } catch (error) {
          console.error('Bright Hour conversion forward failed (non-fatal)');
        }
      }
      // Only when something is actually queued behind us — a lone click must
      // still land as fast as the pipeline can carry it.
      if ((ingestChains.get(input.visitorId)?.depth ?? 0) > 1) {
        await new Promise((resolve) => setTimeout(resolve, DRAIN_YIELD_MS));
      }
    });
  });
  return { answers: Promise.all(answered), settled: Promise.allSettled(jobs).then(() => settled()) };
}

/**
 * POST /live/api/event — one signal.
 *
 * Answers 202 once the pipeline has ACCEPTED the signal, which it does on this
 * visitor's queue behind her other events; the capture, provider and
 * conversion legs that pass registers stay off the response path. Nothing on
 * the page reads this response body (public/live/live.js checks `r.ok` and
 * discards the rest), and the affinity it produces is read back through
 * /live/api/page and /live/api/reflex — both of which settle this visitor's
 * queue first, so the numbers a presenter sees are never behind the events
 * they just generated.
 *
 * A signal that cannot be sent under her session (the identity door refused
 * one), or that the pipeline refused, is answered as refused with the door's
 * status and reason — never 202, never `success: true`.
 *
 * `success: true` and the `surface` stamp are kept in the body: they are the
 * fields this surface's contract has always carried.
 */
liveRoutes.post('/event', async (c) => {
  try {
    const body = await c.req.json();
    const input = eventSchema.parse(body);
    const shopper = await demoShopperOf(c, input.visitorId);

    const { answers, settled } = acceptEvents(c.env, [{ input, shopper }]);
    background(c, settled);
    const [refusal] = await answers;
    if (refusal) return refusedAnswer(c, refusal, { accepted: 0 });

    return c.json(
      { ok: true, success: true, accepted: 1, deferred: false, surface: SURFACE },
      202
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ ok: false, error: 'Invalid event', details: error.issues }, 400);
    }
    if (error instanceof Refused) return refusedAnswer(c, error, { accepted: 0 });
    console.error('Error forwarding Bright Hour event');
    return c.json(
      { ok: false, error: error instanceof Error ? error.message : 'event failed' },
      500
    );
  }
});

// ── POST /live/api/events (batch) ────────────────────────────────────────────

/**
 * A scroll surfaces cards in bulk, and the storefront already buffers and drains
 * them one at a time — so the natural unit of this surface was always the BATCH,
 * not the single POST. Accepts either a bare array or `{ events: [...] }`, with
 * an optional top-level `visitorId` the members may inherit.
 *
 * Thirty-two impressions become one request instead of thirty-two, which is the
 * difference between one queue and a stampede at the door. The singular endpoint
 * above stays exactly as valid — this is additive.
 */
const eventsBatchSchema = z.union([
  z.array(eventSchema.partial({ visitorId: true })).min(1).max(200),
  z.object({
    visitorId: z.string().min(1).optional(),
    events: z.array(eventSchema.partial({ visitorId: true })).min(1).max(200),
  }),
]);

liveRoutes.post('/events', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = eventsBatchSchema.parse(body);
    const isArray = Array.isArray(parsed);
    const fallbackVisitor = isArray ? undefined : parsed.visitorId;
    const raw = isArray ? parsed : parsed.events;

    const inputs: EventInput[] = [];
    for (const member of raw) {
      const visitorId = member.visitorId ?? fallbackVisitor;
      if (!visitorId) {
        return c.json(
          { ok: false, error: 'Every event needs a visitorId (inline or top-level)' },
          400
        );
      }
      inputs.push({ ...member, visitorId });
    }

    // Every visitor in the batch has her session before any member is queued:
    // a refused issue refuses the whole batch, and nothing of it is sent.
    const visitors = [...new Set(inputs.map((input) => input.visitorId))];
    const issued = await Promise.all(visitors.map((visitorId) => demoShopperOf(c, visitorId)));
    const shoppers = new Map(visitors.map((visitorId, i) => [visitorId, issued[i]!] as const));

    const { answers, settled } = acceptEvents(
      c.env,
      inputs.map((input) => ({ input, shopper: shoppers.get(input.visitorId)! }))
    );
    background(c, settled);
    const results = await answers;
    const refused = results.flatMap((refusal, index) =>
      refusal ? [{ index, stage: refusal.stage, status: refusal.status, error: refusal.reason }] : []);
    const first = results.find((refusal): refusal is Refused => refusal !== null);
    if (first) return refusedAnswer(c, first, { accepted: inputs.length - refused.length, refused });

    return c.json(
      {
        ok: true,
        success: true,
        accepted: inputs.length,
        deferred: false,
        surface: SURFACE,
      },
      202
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ ok: false, error: 'Invalid event batch', details: error.issues }, 400);
    }
    if (error instanceof Refused) return refusedAnswer(c, error, { accepted: 0 });
    console.error('Error forwarding Bright Hour event batch');
    return c.json(
      { ok: false, error: error instanceof Error ? error.message : 'event batch failed' },
      500
    );
  }
});

// ── GET /live/api/reflex ─────────────────────────────────────────────────────

/**
 * The affinity snapshot, delegated to /realtime/reflex with `surface` set — so
 * the Bright Hour instrument reads the Bright Hour τ/θ per dimension rather than
 * the coach defaults. One snapshot implementation, two surfaces.
 */
liveRoutes.get('/reflex', async (c) => {
  const visitorId = c.req.query('visitorId') || c.req.query('userId') || 'anonymous';
  // Same read-your-writes contract the composition gets: the instrument never
  // shows a shopper fewer signals than the ones already accepted from them.
  await settleVisitor(visitorId);
  let shopper: DemoShopper;
  try {
    shopper = await demoShopperOf(c, visitorId);
  } catch (error) {
    if (error instanceof Refused) return refusedAnswer(c, error);
    throw error;
  }
  const res = await shopperDoors.fetch(reflexRequestOf(shopper), c.env, execCtxOf(c));
  const out = (await res.json()) as Record<string, unknown>;
  return c.json({ ...out, surface: SURFACE, visitorId }, res.status as 200);
});

// ── Beat 13: /live/api/experiment/* ──────────────────────────────────────────
//
// Deliberately under /live/api/experiment rather than /live/ops-api: the Offer
// Desk owns the ops namespace, and two agents landing routes in one namespace on
// the night before a demo is how a merge takes out a beat.

/**
 * POST /live/api/experiment/launch — create the REAL artifact on the project.
 *
 * Write-gated exactly like every other write in this repo (fxEnv.gateWrite), and
 * idempotent: a second call returns the stored ids rather than a second
 * experiment. `?force=1` re-runs the ensure ladder (used to pick up the datafile
 * ids once the CDN has published them) — it still cannot create a duplicate,
 * because every primitive underneath reuses what it finds.
 */
liveRoutes.post('/experiment/launch', async (c) => {
  const gate = gateWrite(c.env);
  if (!gate.enabled) {
    return c.json({ ok: false, error: gate.reason, gated: true }, 403);
  }
  try {
    const force = c.req.query('force') === '1';
    const result = await launchBhExperiment(c.env, { force });
    if (!result.ok) {
      return c.json(
        { ok: false, error: result.error ?? 'launch rejected', diagnostics: result.diagnostics },
        502
      );
    }
    return c.json({
      ok: true,
      reused: result.reused,
      surface: SURFACE,
      ids: result.ids,
      presenterUrl: result.ids?.presenterUrl ?? null,
      resultsUrl: result.ids?.resultsUrl ?? null,
      // Honest about the one thing a presenter can be caught by: the CDN has to
      // publish before the SDK — and the export row — can carry real ids.
      datafilePublished: Boolean(result.ids?.datafile),
      note: result.ids?.datafile
        ? 'Experiment live and published; ids stamp into decision rows now.'
        : 'Rule created; the datafile has not published yet. Re-POST with ?force=1 in a few seconds to pick up the platform ids.',
    });
  } catch (error) {
    console.error('Bright Hour experiment launch failed');
    return c.json(
      { ok: false, error: error instanceof Error ? error.message : 'launch failed' },
      500
    );
  }
});

/**
 * GET /live/api/experiment/status — the runbook's gate check.
 *
 * Answers with the created ids, the presenter URL, and (given ?visitorId=) the
 * arm that visitor is in and which path decided it. Read-only and ungated: a
 * presenter checking their gate must never need write credentials.
 */
liveRoutes.get('/experiment/status', async (c) => {
  try {
    const ids = await getBhExperimentIds(c.env);
    const visitorId = c.req.query('visitorId') || c.req.query('userId');
    const assignment = visitorId ? await getAssignment(c.env, visitorId) : null;
    return c.json({
      ok: true,
      surface: SURFACE,
      launched: Boolean(ids),
      datafilePublished: Boolean(ids?.datafile),
      ids,
      presenterUrl: ids?.presenterUrl ?? null,
      resultsUrl: ids?.resultsUrl ?? null,
      slotId: BH_EXPERIMENT_SLOT,
      visitorId: visitorId ?? null,
      assignment,
      writeGate: gateWrite(c.env).reason,
    });
  } catch (error) {
    console.error('Bright Hour experiment status failed');
    return c.json(
      { ok: false, error: error instanceof Error ? error.message : 'status failed' },
      500
    );
  }
});

// ── GET /live/api/decisions/export ───────────────────────────────────────────

/**
 * Beat 7, as an exhibit: the rows themselves, flat, in the shape a warehouse
 * would receive them. JSON-typed columns stay as stored TEXT — this is the
 * export, not a viewmodel. `?parse=1` inflates them for the on-screen panel.
 *
 * "We hand them the rows; they compute the lift."
 */
liveRoutes.get('/decisions/export', async (c) => {
  try {
    if (!c.env.DB) return c.json({ ok: false, error: 'D1 is not bound' }, 503);

    const since = Number(c.req.query('since'));
    const limitRaw = Number(c.req.query('limit'));
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.trunc(limitRaw)), 1000) : 200;
    const visitorId = c.req.query('visitorId');
    const demoRunId = c.req.query('demoRunId');
    const slotId = c.req.query('slotId');

    const where: string[] = [];
    const binds: unknown[] = [];
    if (Number.isFinite(since)) {
      where.push('ts >= ?');
      binds.push(since);
    }
    if (visitorId) {
      where.push('visitor_id = ?');
      binds.push(visitorId);
    }
    if (demoRunId) {
      where.push('demo_run_id = ?');
      binds.push(demoRunId);
    }
    if (slotId) {
      where.push('slot_id = ?');
      binds.push(slotId);
    }

    const sql =
      `SELECT ${BH_DECISION_COLUMNS.join(', ')} FROM bh_decisions` +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      ' ORDER BY ts DESC, slot_id ASC LIMIT ?';
    binds.push(limit);

    const result = await c.env.DB.prepare(sql).bind(...binds).all();
    let rows = (result.results ?? []) as Record<string, unknown>[];

    if (c.req.query('parse') === '1') {
      const jsonCols = ['candidate_set', 'gates_passed', 'gates_failed', 'dimension_scores'];
      rows = rows.map((row) => {
        const out = { ...row };
        for (const col of jsonCols) {
          if (typeof out[col] === 'string') {
            try {
              out[col] = JSON.parse(out[col] as string);
            } catch {
              /* leave the raw TEXT — an export must never lie about its bytes */
            }
          }
        }
        return out;
      });
    }

    return c.json({
      ok: true,
      surface: SURFACE,
      columns: [...BH_DECISION_COLUMNS],
      count: rows.length,
      since: Number.isFinite(since) ? since : null,
      rows,
    });
  } catch (error) {
    console.error('Error exporting Bright Hour decisions');
    return c.json(
      { ok: false, error: error instanceof Error ? error.message : 'export failed' },
      500
    );
  }
});

export { liveRoutes };
export default liveRoutes;
