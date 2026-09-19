// src/units/W16/C3.unit.test.ts
// W16 criteria C3 (contextual seeds at gamma zero) and C7 (zero-base honesty).
//
// One `describe('unit:W16.C3.0N' | 'unit:W16.C7.0N')` per unit of batch W16-B2,
// one `it` per ruled leg. Every expected value comes from the W16-B2 ruling
// table in `docs/remediation/LANE-LOG.md`, the admitted C3/C7 text in
// `docs/handover/HANDOFF-2026-09-18.md` §5, document 35 §2 F13 / §3 N20 / §5
// W16, and `docs/architecture/tapestry_requirements.txt` line 153 (Cross-Channel
// Awareness: "Ad creative, search keywords, audience segment, influencer style
// all inform on-site experience from first page") — never from what the engine
// returns today.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE RULED VOCABULARY (R21: named here, absent from the code, so these units
// are RED on the missing members as well as on the behavior).
//
// The engine already has a published, versioned, per-slot strategy document —
// the `slots` kind (`SLOTS_KIND`, `src/content/kinds.ts`), published through the
// conditional R2 publication authority with revisions and `rollback`
// (`src/config/publication.ts`, `src/config/versionedStore.ts`). A contextual
// seed rule set is a per-slot strategy, so it is carried there rather than in a
// second versioning system (METHOD §6, "reuse before writing"):
//
//   SlotStrategy.seeds?: SeedRule[]                       (src/content/types.ts)
//   interface SeedRule {
//     signal: 'entry_channel' | 'campaign_term' | 'referrer_network';
//     value: string;                     // the signal value this rule fires on
//     tags: Array<{ dimension: string; value: string }>;  // canonical tags
//     weight: number;                    // 0..1, the codebase's rule-weight range
//   }
//   DecideInput.entry?: ChannelSignals   (src/content/decide.ts) — the arrival
//     context the campaign-term and referrer-network signals are read from; the
//     entry-channel signal is read from the cell, which already carries the
//     established owned channel (R13).
//   ChannelSignals.utmTerm?: string      (src/services/visit.ts) — the search
//     keyword the customer requirement names; bounded like the other fields.
//   DecisionRecord.explain.contextual?: {
//     applied: number;                   // the seeds' delta in the FINAL
//                                        // pre-lift base AFTER merchandising
//     drivers: Array<{ signal: string; value: string; dimension: string;
//                      tag: string; weight: number; contribution: number }>;
//   }
//     R30(4): the field carries NO version of its own. The rule-set version a
//     receipt names is the `slots` revision the decision already stamps on the
//     record (`versions.slots`, src/content/decide.ts:306), which is also what
//     the public snapshot payload carries.
//   DecisionRecord.explain.lift.applied: number  — the score delta the learned
//     lift actually caused, itemised the way every other term in this engine is
//     ("each term is itemised as the delta it caused", src/content/decide.ts:118;
//     `applied` on stage, freshness and fatigue). N20: a multiplicative term on
//     an exactly zero base causes nothing, and the receipt must say so.
//   ContentDecisionSet.seedDiagnostics?: Array<{ slot: string; reason: string }>
//     — refused configuration, never a fabricated influence, in the pattern of
//     `pinDiagnostics`.
//
// THE RULED ARITHMETIC. A seed supplies the missing interest for a canonical tag
// this arrival is evidence for, so it enters the slot's own multiply: a rule
// contributes `rule.weight × slot.weights[tag.dimension]` to every eligible
// piece carrying that tag, in the base, BEFORE merchandising. Therefore
//   · a piece the rules do not name gains exactly nothing (seeds are never a
//     global floor — document 35 §3 N20, open decision D09);
//   · a piece whose final pre-lift base after merchandising is exactly zero
//     stays exactly zero, and the contextual contribution recorded for it is
//     exactly zero, because it is measured in that final pre-lift base;
//   · the learned lift then multiplies that base, so at γ = 0 the seeds are the
//     only contextual influence there is, which is what F13 says is missing.
// Every contribution is rounded to three decimals, as the engine's other
// itemised deltas are. The clause is pinned at both ends of the merchandising
// multiplier: a boost of 0 records exactly 0, a boost of 0.5 records exactly
// half (R30(2)).
//
// R30(1): `seeds` is NOT gated behind `governanceVersion`. It joins
// merchandising, stage, freshness, fatigue and diversity, which are read on
// every slot regardless of the marker (src/content/kinds.ts:218-259): retained
// documents are interpreted by `validateStored` → `parseSlotCatalog` with the
// governance the document itself declares, and the fixtures here publish none.
//
// R30(5): a `referrer_network` rule's `value` is a network's REGISTRABLE DOMAIN
// (`instagram.com`), matched against the arrival with the dot-boundary rule the
// classifier already uses (`matches`, src/services/visit.ts:233), so
// `instagram.com.evil.example` is not Instagram (unit W16.C2.02). An
// `entry_channel` rule's `value` is one of the six channel words. A value that
// is neither is refused at publication and, if retained, ignored whole at
// decision time.
//
// R30(3): `utmTerm` is a bounded arrival field like the others, 256 characters
// as `utmSource` is (`ENTRY_LIMITS`, src/services/visit.ts:49). It is a seeding
// signal and nothing else: it never changes the classified entry channel and it
// is never persisted (unit W16.C3.09).
//
// The host legs drive the mounted route production serves (R19):
// `GET /v1/:tenant/decisions/snapshot` behind `requireShopper`, on both hosts,
// in the pattern of `src/units/W16/C2.unit.test.ts`. The route publishes the
// ranking (`decisions[].contentId` and `decisions[].score`) but not the
// receipts, so every record-level clause is a `host-internal` leg and the
// missing public observable is the `residual` on that unit's units.json row.

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';

import type { Env } from '@/types/env';
import realtimeRoutes from '@/routes/realtime';
import { decisionRoutes } from '@/routes/decisions';
import { tenantMiddleware } from '@/tenancy/middleware';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { newAnonymousSession, verifySessionCapability, SHOPPER_HEADER, type SessionCapability } from '@/identity/sessionCapability';
import { admitOwnerPrincipal, runOwnerOperation } from '@/identity/sessionAuthority';
import { shopperObjectName } from '@/tenancy/objects';
import { storedConsent, type ConsentInstruction } from '@/content/consent';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND, validateSlotCatalog } from '@/content/kinds';
import { initializePublicationSet, pinPublication, publishSet, type PublicationBaseline } from '@/config/publication';
import { invalidateCache, rollback } from '@/config/versionedStore';
import { invalidateLiftCache, serveContentDecisions } from '@/content/service';
import { configuredDestinations } from '@/connectors/config';
import type { RetentionCategory, RetentionPolicy } from '@/retention';
import { ENTRY_QUERY_LIMIT, classifyEntryChannel, snapshotEntry, validEntry, type ChannelSignals } from '@/services/visit';
import { decideContent } from '@/content/decide';
import { receiptOf } from '@/learn/receipts';
import type { Names } from '@/learn/rows';
import type { LiftSnapshot } from '@/learn/stats';
import type { Cell, ContentDecisionSet, ContentPiece, DecisionRecord, SeedRule, SlotStrategy } from '@/content/types';

// ---------------------------------------------------------------------------
// The ruled-but-absent members, each read through exactly one accessor so the
// specification branch reports one typecheck error per ruled name (R21) and the
// implementer has one place to look for the contract.
// ---------------------------------------------------------------------------

/** R21: `SlotStrategy.seeds` — the slot's published contextual seed rule set. */
const withSeeds = (slot: SlotStrategy, seeds: SeedRule[]): SlotStrategy => ({ ...slot, seeds });
/** R21: the same member, read back out of a validated `slots` document. */
const seedsOf = (slot: SlotStrategy): SeedRule[] | undefined => slot.seeds;
/** R21: `DecisionRecord.explain.contextual`. */
const contextualOf = (record: DecisionRecord) => record.explain.contextual;
/** R21: `DecisionRecord.explain.lift.applied` — the delta the learned lift caused. */
const liftAppliedOf = (record: DecisionRecord) => record.explain.lift?.applied;
/** R21: `ContentDecisionSet.seedDiagnostics`. */
const seedDiagnosticsOf = (set: ContentDecisionSet) => set.seedDiagnostics;
/** R21: `ChannelSignals.utmTerm` — the search keyword the customer paper names. */
const CAMPAIGN_TERM: keyof ChannelSignals = 'utmTerm';
const arrival = (o: { medium?: string; source?: string; term?: string; referrer?: string; siteHost?: string }): ChannelSignals => ({
  ...(o.medium === undefined ? {} : { utmMedium: o.medium }),
  ...(o.source === undefined ? {} : { utmSource: o.source }),
  ...(o.term === undefined ? {} : { [CAMPAIGN_TERM]: o.term }),
  ...(o.referrer === undefined ? {} : { referrer: o.referrer }),
  ...(o.siteHost === undefined ? {} : { siteHost: o.siteHost }),
});

// ---------------------------------------------------------------------------
// Customer-shaped fixtures. Coach's own taxonomy — Handbags, Small Leather
// Goods, Accessories (admitted C8) — plus one piece in a category no rule ever
// names, so an unknown and cross-category input is part of the fixture rather
// than an afterthought. The taxonomy lives here, never in product code (METHOD
// §6): the rule set carries it as published configuration.
// ---------------------------------------------------------------------------

const TENANT = 'meridian';
const SITE = 'shop.coach.com';
const T0 = 1_725_000_000_000;

const piece = (id: string, customerContentId: string, type: string, title: string,
  tags: Record<string, string[]>, slotTypes: string[] = ['hero'], merchandising?: Record<string, number>): ContentPiece => ({
  id, customerContentId, type, title, tags, slotTypes,
  ...(merchandising ? { merchandising } : {}), lifecycle: { status: 'live' },
});

/**
 * Catalogue order is the merchandiser's order and decides every tie
 * (`src/reflex/contentCompose.ts:149`). It deliberately does NOT match any
 * seeded order below, so a ranking that never moved is visible.
 */
const PIECES: ContentPiece[] = [
  piece('signature-charms-editorial', 'cms-1001', 'editorial', 'Signature charms', { category: ['Accessories'], line: ['Signature'] }),
  piece('fragrance-note-editorial', 'cms-1002', 'editorial', 'A note on fragrance', { category: ['Fragrance'] }),
  piece('tabby-in-motion-film', 'cms-1003', 'video', 'The Tabby, in motion', { category: ['Handbags'], line: ['Tabby'] }),
  piece('willow-slg-editorial', 'cms-1004', 'editorial', 'Willow, small leather goods', { category: ['Small Leather Goods'], line: ['Willow'] }),
];
const CATALOGUE_ORDER = ['signature-charms-editorial', 'fragrance-note-editorial', 'tabby-in-motion-film', 'willow-slg-editorial'];

/**
 * The same catalogue, with last season's carryover marked on the Willow piece,
 * so a merchandising rule can take it to exactly zero (C3.07, C7.01).
 */
const PIECES_WITH_SEASON: ContentPiece[] = [
  PIECES[0]!, PIECES[1]!, PIECES[2]!,
  piece('willow-slg-editorial', 'cms-1004', 'editorial', 'Willow, small leather goods',
    { category: ['Small Leather Goods'], line: ['Willow'] }, ['hero'], { season: 1 }),
];

/** One hero slot, take 4, so every piece is served and the whole order is observable. */
const HERO: SlotStrategy = { slot: 'hero', take: 4, weights: { category: 0.5, line: 0.3 } };
/**
 * The same slot with a merchandising rule that can reach exactly zero: season
 * at full negative weight and an explicit `minBoost: 0` (both inside the
 * published ranges `src/content/kinds.ts:224-226`), so a piece carrying
 * `season: 1` is multiplied to exactly 0 after merchandising.
 */
const HERO_ZEROING: SlotStrategy = { ...HERO, merchandising: { season: -1, minBoost: 0 } };
/**
 * R30(2): the same slot with a HALF merchandising multiplier — season at −0.5,
 * the default floor of 0.5 — so a piece carrying `season: 1` is multiplied to
 * exactly half. It pins "measured in the final pre-lift base after
 * merchandising" between the two ends: boost 0 records 0, boost 0.5 records half.
 */
const HERO_HALVING: SlotStrategy = { ...HERO, merchandising: { season: -0.5 } };

/**
 * The published rule set, version 1. Three rules, one per ruled context signal,
 * each naming canonical tags in dimensions this slot weights.
 */
const SEEDS_V1: SeedRule[] = [
  { signal: 'entry_channel', value: 'paid_social', tags: [{ dimension: 'category', value: 'Handbags' }], weight: 0.6 },
  { signal: 'campaign_term', value: 'tabby handbag', tags: [{ dimension: 'line', value: 'Tabby' }], weight: 0.4 },
  // R30(5): the network is named by its registrable domain, matched with the
  // classifier's own dot-boundary rule against the arrival's referrer host (or a
  // `utm_source` that is itself a host).
  { signal: 'referrer_network', value: 'instagram.com', tags: [{ dimension: 'category', value: 'Small Leather Goods' }], weight: 0.5 },
];
/** Version 2: the merchandiser moves the paid-social seed to small leather goods. */
const SEEDS_V2: SeedRule[] = [
  { signal: 'entry_channel', value: 'paid_social', tags: [{ dimension: 'category', value: 'Small Leather Goods' }], weight: 0.8 },
];

// The ruled contributions of SEEDS_V1 for this slot (weight × the slot's weight
// for the tag's dimension, rounded to three decimals):
const TABBY_CHANNEL = 0.3;    // 0.6 × 0.5, entry_channel → category Handbags
const TABBY_TERM = 0.12;      // 0.4 × 0.3, campaign_term → line Tabby
const WILLOW_NETWORK = 0.25;  // 0.5 × 0.5, referrer_network → category Small Leather Goods
const WILLOW_V2 = 0.4;        // 0.8 × 0.5, version 2's entry_channel rule
/** The same network contribution as it lands after a merchandising boost of 0.5. */
const WILLOW_HALVED = 0.125;  // 0.25 × 0.5
/** R30(3): `utmTerm` is bounded at 256, the bound `utmSource` already carries. */
const TERM_LIMIT = 256;

/** The paid-social arrival the customer's Cross-Channel Awareness row describes. */
const ARRIVAL = arrival({ medium: 'cpc', source: 'instagram', referrer: 'l.instagram.com', siteHost: SITE });
/** The same arrival carrying the paid search keyword (`utm_term`). */
const ARRIVAL_TERM = arrival({ medium: 'cpc', source: 'instagram', term: 'tabby handbag', referrer: 'l.instagram.com', siteHost: SITE });
/** An ordinary organic return: none of the three rules is evidence for it. */
const ARRIVAL_ORGANIC = arrival({ referrer: 'www.google.com', siteHost: SITE });

const PAID_SOCIAL_CELL: Cell = { channel: 'paid_social', visit_bucket: '1', region: null, affinity: null, stage: 'unknown' };
const ORGANIC_CELL: Cell = { ...PAID_SOCIAL_CELL, channel: 'organic' };

const NO_NAMES: Names = new Map();

/**
 * Learned lift at the root pooling level, well over `nMin`, for BOTH candidates
 * the zero-base units rank: 1.5 for the Tabby film and 1.2 for the Willow piece,
 * so the candidate merchandising takes to zero genuinely has a learned lift to
 * claim. Doc 22 §6: the estimate is the ratio, the trust dial γ is separate.
 */
const LEARNED: LiftSnapshot = {
  tenant: TENANT, brand: TENANT, slot: 'hero', reward: 'click', objective: 'unit', measurementBasis: 'served-v1',
  tauLearnMs: 1_814_400_000, version: 7, publishedAt: T0, events: 1200, n0: 30, nMin: 30, liftMin: 0.5, liftMax: 2, priorVersion: 0,
  items: {
    'tabby-in-motion-film': { '*': { level: 0, key: '*', n: 120, s: 9, p0: 0.05, n0: 30, p_hat: 0.075, lift: 1.5 } },
    'willow-slg-editorial': { '*': { level: 0, key: '*', n: 80, s: 4.8, p0: 0.05, n0: 30, p_hat: 0.06, lift: 1.2 } },
  },
  slotRates: { '*': { n: 2400, s: 120, rate: 0.05 } },
};

// ---------------------------------------------------------------------------
// The logic harness: the real pure decision, `decideContent`, with real inputs.
// ---------------------------------------------------------------------------

function runDecide(o: {
  slots: SlotStrategy[];
  pieces?: ContentPiece[];
  affinity?: { dims: Record<string, Record<string, number>> } | null;
  entry?: ChannelSignals;
  cell?: Cell;
  gamma?: number;
  snapshots?: Record<string, LiftSnapshot | null>;
  slotsRevision?: number;
}): ContentDecisionSet {
  return decideContent({
    tenant: TENANT, brand: TENANT, page: 'home', visitorId: 'w16-c3-shopper', sessionId: 'w16-c3-session',
    identityAnchor: 'visitor', nowMs: T0,
    pieces: o.pieces ?? PIECES, slots: o.slots,
    affinity: o.affinity ?? null,
    cell: o.cell ?? PAID_SOCIAL_CELL, arm: 'personalized',
    versions: { config: 1, catalog: 1, slots: o.slotsRevision ?? 1, learn: 1, lift: 0, prior: 0, policy: 1 },
    configLabel: 'w16-c3-fixture',
    learning: { snapshots: o.snapshots ?? {}, gammaOf: () => o.gamma ?? 0 },
    // R21: the arrival context the campaign-term and referrer-network signals
    // are read from. The entry-channel signal is read from `cell.channel`.
    entry: o.entry,
  });
}

/** The served order for one slot, as `[contentId, score]` pairs. */
const orderOf = (set: ContentDecisionSet, slot = 'hero'): Array<[string, number]> =>
  set.decisions.filter(d => d.slot === slot).map(d => [d.contentId, d.score]);
const recordFor = (set: ContentDecisionSet, id: string, slot = 'hero'): DecisionRecord =>
  set.records.find(r => r.item_id === id && r.slot === slot)!;
/** The base order: every candidate at exactly zero, in catalogue order. */
const coldCatalogueOrder = (ids: string[] = CATALOGUE_ORDER): Array<[string, number]> => ids.map(id => [id, 0]);

// ---------------------------------------------------------------------------
// Host fixture — the real mounted app, the real SessionManager path and the real
// ShopperReflex class, one construction per host. Pattern reused from
// `src/units/W16/C2.unit.test.ts` and `src/routes/realtime.sdkContract.test.ts`;
// neither suite is imported.
// ---------------------------------------------------------------------------

const fixtureRetentionPolicy: RetentionPolicy = { id: 'w16-b2-fixture-policy', revision: 1, durationMs: 365 * 86400_000, basis: 'admitted', renewal: 'new-record-only' };
const fixtureCategories = (tenants: string[]) => Object.fromEntries(tenants.map(tenant => [tenant,
  Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly'].map(category => [category, fixtureRetentionPolicy])) as Record<RetentionCategory, RetentionPolicy>]));

class UnitKV {
  data = new Map<string, string>();
  async get(key: string, type?: string) { const v = this.data.get(key); return v === undefined ? null : type === 'stream' ? new Response(v).body : type === 'json' ? JSON.parse(v) : v; }
  async put(key: string, value: string) { this.data.set(key, value); }
  async delete(key: string) { this.data.delete(key); }
  async list(o?: { prefix?: string; limit?: number; cursor?: string }) {
    const keys = [...this.data.keys()].filter(k => k.startsWith(o?.prefix ?? '')).sort(), start = Number(o?.cursor ?? 0), end = start + (o?.limit ?? 1000);
    return { keys: keys.slice(start, end).map(name => ({ name })), list_complete: end >= keys.length, ...(end < keys.length ? { cursor: String(end) } : {}) };
  }
}

class UnitR2 {
  data = new Map<string, string>();
  versions = new Map<string, number>();
  metadata = new Map<string, Record<string, string>>();
  async get(key: string) {
    const raw = this.data.get(key); if (raw === undefined) return null;
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length,
      customMetadata: this.metadata.get(key), body: new Response(raw).body, text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async put(key: string, raw: string, options?: R2PutOptions) {
    const old = this.data.has(key) ? 'v' + this.versions.get(key) : null, condition = options?.onlyIf;
    const absent = condition instanceof Headers ? condition.get('If-None-Match') === '*' : condition?.etagDoesNotMatch === '*';
    const match = condition instanceof Headers ? condition.get('If-Match') : condition?.etagMatches;
    if (absent && old !== null || match != null && match !== old && match !== JSON.stringify(old)) return null;
    this.data.set(key, raw); this.versions.set(key, (this.versions.get(key) ?? 0) + 1); this.metadata.set(key, { ...options?.customMetadata });
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length };
  }
  async delete(key: string) { this.data.delete(key); }
  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
    const names = [...this.data.keys()].filter(k => k.startsWith(options.prefix ?? '')).sort(), start = Number(options.cursor ?? 0), end = start + (options.limit ?? 1000);
    return { objects: names.slice(start, end).map(key => ({ key })), truncated: end < names.length, ...(end < names.length ? { cursor: String(end) } : {}) };
  }
}

/** The published documents for a host fixture: this catalogue and this hero slot. */
const documentChanges = (tenant: string, slots: unknown[], pieces: ContentPiece[] = PIECES): PublicationBaseline[] => [
  { kind: CONTENT_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'w16-b2-fixture', note: '', value: { pieces } } },
  { kind: SLOTS_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'w16-b2-fixture', note: '', value: { pages: { home: slots } } } },
  { kind: LEARN_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'w16-b2-fixture', note: '', value: {
    holdout: { share: 0, salt: 'w16-b2', arms: ['default'] }, regional: { enabled: false, kBlend: 1, minEvents: 30 }, slots: {} } } },
];

async function fixturePublication(env: Env, tenant: string, changes: PublicationBaseline[] = []) {
  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = tenant): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: 1, actor: 'w16-b2-fixture', note: '', value } });
  const defaults = [baseline(REFLEX_KIND, { ...DEFAULT_REFLEX_CONFIG, eventAttributes: 'event-when-unknown' }, reflexScopeForTenant(tenant)),
    baseline(CONTENT_KIND, { pieces: [] }), baseline(SLOTS_KIND, { pages: {} }), baseline(LEARN_KIND, { holdout: { share: 0, salt: 'w16-b2', arms: ['default'] } })];
  if (!await env.STORAGE.get('config-publication/v2/' + tenant + '/head.json')) {
    return initializePublicationSet(env, defaults.map(base => changes.find(change => change.kind.name === base.kind.name && change.scope === base.scope) ?? base), '0:' + crypto.randomUUID());
  }
}

function boundary(host: string) {
  const cache = new UnitKV(), sessions = new UnitKV();
  const pending: Promise<unknown>[] = [];
  const objects = new Map<string, { shopper: ShopperReflex; data: Map<string, unknown>; state: DurableObjectState; alarms: number[]; sockets: WebSocket[] }>();
  const env = { DEPLOYMENT_PROFILE: 'demo', CACHE: cache, SESSIONS: sessions, CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: host,
    STORAGE: new UnitR2(),
    JWT_SECRET: 'w16-b2-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a', IDENTITY_SECRETS: 'meridian:backend-proof',
    TENANTS: JSON.stringify({ provisioned: ['coach', 'meridian'] }),
    PERSONALIZATION_WEBSOCKET: { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ connections: 0 }) }) },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
  } as unknown as Env;
  cache.data.set(`reflex:config:${reflexScopeForTenant(TENANT)}:current`,
    JSON.stringify({ revision: 1, at: 1, actor: 'w16-b2-fixture', note: '', value: { ...DEFAULT_REFLEX_CONFIG, eventAttributes: 'event-when-unknown' } }));
  let automaticRetention = JSON.stringify({ version: 1, tenants: fixtureCategories(['coach', 'meridian']) });
  env.RETENTION = automaticRetention;
  const configureRetention = async () => {
    if (env.RETENTION !== automaticRetention) return;
    try {
      const tenants = JSON.parse(env.TENANTS!).provisioned as string[], policies = fixtureCategories(tenants);
      for (const tenant of tenants) for (const destination of await configuredDestinations(env, tenant, () => {})) policies[tenant]![destination.category] = fixtureRetentionPolicy;
      automaticRetention = JSON.stringify({ version: 1, tenants: policies }); env.RETENTION = automaticRetention;
    } catch { /* a malformed registry still reaches the production refusal */ }
  };
  const ns = {
    idFromName: (n: string) => n,
    get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      let item = objects.get(name);
      if (!item) {
        const data = new Map<string, unknown>();
        const alarms: number[] = [], sockets: WebSocket[] = [];
        const storage = {
          get: async (k: string | string[]) => structuredClone(Array.isArray(k) ? new Map(k.map(v => [v, data.get(v)])) : data.get(k)),
          put: async (k: string | Record<string, unknown>, v?: unknown) => {
            if (typeof k === 'string') data.set(k, structuredClone(v)); else for (const [key, value] of Object.entries(k)) data.set(key, structuredClone(value));
          },
          list: async (options?: { prefix?: string; startAfter?: string; limit?: number; reverse?: boolean }) =>
            structuredClone(new Map([...data].filter(([key]) => key.startsWith(options?.prefix ?? '') && (!options?.startAfter || key > options.startAfter))
              .sort(([a], [b]) => (options?.reverse ? -1 : 1) * a.localeCompare(b)).slice(0, options?.limit))),
          transaction: async (run: (tx: DurableObjectTransaction) => Promise<unknown>) => {
            const candidate = structuredClone(data);
            let deleteAlarm = false, nextAlarm: number | undefined;
            const tx = { list: async () => structuredClone(candidate), get: async (key: string) => structuredClone(candidate.get(key)),
              delete: async (keys: string | string[]) => { const list = typeof keys === 'string' ? [keys] : keys; for (const key of list) candidate.delete(key); return list.length; },
              put: async (values: string | Record<string, unknown>, value?: unknown) => {
                if (typeof values === 'string') candidate.set(values, structuredClone(value));
                else for (const [key, item] of Object.entries(values)) candidate.set(key, structuredClone(item));
              },
              deleteAlarm: async () => { deleteAlarm = true; },
              setAlarm: async (at: number) => { nextAlarm = at; },
            } as unknown as DurableObjectTransaction;
            const result = await run(tx);
            data.clear(); for (const [key, value] of candidate) data.set(key, value);
            if (deleteAlarm) alarms.length = 0;
            if (nextAlarm !== undefined) alarms.push(nextAlarm);
            return result;
          },
          deleteAll: async () => data.clear(), delete: async (k: string) => data.delete(k),
          setAlarm: async (at: number) => { alarms.push(at); }, getAlarm: async () => alarms.at(-1) ?? null,
        };
        const state = { id: name, storage, getWebSockets: () => sockets, waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as DurableObjectState;
        item = { data, state, alarms, sockets, shopper: new ShopperReflex(state, env) };
        objects.set(name, item);
      }
      return item.shopper.fetch(new Request(input, init));
    } }),
  };
  env.SHOPPER_REFLEX = ns as unknown as DurableObjectNamespace;
  const app = new Hono<{ Bindings: Env }>();
  // R19: the routes production serves, mounted as `src/index.ts` mounts them.
  app.use('*', tenantMiddleware()); app.route('/realtime', realtimeRoutes); app.route('/v1', decisionRoutes);
  const call = async (path: string, capability?: string, body?: unknown, tenant = TENANT) => {
    await configureRetention();
    const request = new Request(`https://synthetic.invalid${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'X-Tenant': tenant, ...(capability === undefined ? {} : { [SHOPPER_HEADER]: capability }), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return app.request(request, undefined, env, { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {}, props: {} });
  };
  const drain = async () => { while (pending.length) await Promise.all(pending.splice(0)); await new Promise(r => setTimeout(r, 10)); };
  return { env, app, cache, sessions, objects, call, drain, configureRetention };
}

async function explicitChoice(f: ReturnType<typeof boundary>, grant: Awaited<ReturnType<typeof newAnonymousSession>>) {
  const current = f.objects.get(shopperObjectName(grant.tenant, grant.subject))?.data.get('consent');
  const choice = { id: crypto.randomUUID(), expectedRevision: storedConsent(current).instruction?.revision ?? null,
    grantId: grant.grantId, iat: grant.iat, exp: grant.exp };
  const response = await f.call(`/realtime/session/${grant.sessionId}/preferences`,
    grant.capability, { trackingConsent: true, personalizationEnabled: true, choice }, grant.tenant);
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as { consent?: { tracking: boolean; personalization: boolean; instruction?: ConsentInstruction } };
}

interface HostFixture {
  f: ReturnType<typeof boundary>;
  grant: Awaited<ReturnType<typeof newAnonymousSession>>;
  principal: SessionCapability;
  /** R19: the mounted route production serves, and the ranking it publishes. */
  snapshot: (entry?: ChannelSignals) => Promise<{ status: number; order: Array<[string, number]>; slotsRevision: number | undefined }>;
  /**
   * The same decision one layer in, because the route publishes no receipts:
   * `/v1/:tenant/decisions/snapshot` returns `records` only inside a synthetic
   * operation (`src/routes/decisions.ts:478`). Named `host-internal` per R19;
   * the missing public observable is the `residual` on each row in units.json.
   */
  decide: (entry?: ChannelSignals) => Promise<ContentDecisionSet>;
  /** A real accepted page view through the mounted app, on whichever host this fixture runs. */
  action: (entry?: ChannelSignals) => Promise<number>;
  /** Publish a new revision of the `slots` document through the real publication path. */
  publishSlots: (slots: unknown[], authorize?: () => Promise<void>) => Promise<{ ok: boolean; errors?: string[]; revision?: number }>;
  /** Roll the `slots` document back to an earlier revision through the real path. */
  rollbackSlots: (toRevision: number) => Promise<{ ok: boolean; revision?: number }>;
  /** The hero slot inside the head's reserved-but-uncommitted `slots` document, if any. */
  pendingSlot: () => Promise<SlotStrategy | undefined>;
  /** Everything this host actually stored, as text, for the never-persisted clause. */
  stored: () => string;
}

async function hostFixture(host: 'session' | 'do', slots: unknown[], pieces: ContentPiece[] = PIECES): Promise<HostFixture> {
  invalidateCache(); invalidateLiftCache();
  const f = boundary(host);
  const grant = await newAnonymousSession(f.env, TENANT);
  await fixturePublication(f.env, TENANT, documentChanges(TENANT, slots, pieces));
  await explicitChoice(f, grant);
  const principal = await verifySessionCapability(f.env, grant.capability, TENANT);
  const snapshot = async (entry?: ChannelSignals) => {
    const query = '?page=home' + (entry === undefined ? '' : `&entry=${encodeURIComponent(JSON.stringify(entry))}`);
    const response = await f.call(`/v1/${TENANT}/decisions/snapshot${query}`, grant.capability);
    const body = await response.clone().json().catch(() => ({})) as
      { decisions?: Array<{ contentId: string; score: number; slot: string }>; versions?: { slots?: number } };
    await f.drain();
    return { status: response.status,
      order: (body.decisions ?? []).filter(d => d.slot === 'hero').map(d => [d.contentId, d.score] as [string, number]),
      slotsRevision: body.versions?.slots };
  };
  const decide = async (entry?: ChannelSignals) => {
    // Production reaches this function inside the shopper owner's invocation
    // (requireShopper → forwardShopperRequest → the object's owned operation);
    // the same admission is established here so the real guards run.
    const owner = {};
    const out = await runOwnerOperation(owner, f.env, async () => {
      admitOwnerPrincipal(owner, principal);
      return serveContentDecisions(f.env, {
        tenant: TENANT, page: 'home', visitorId: grant.subject, sessionId: grant.sessionId, cookieHeader: null,
        stateTenant: TENANT, principal, capability: grant.capability, cf: null,
        channel: null, ...(entry === undefined ? {} : { entry }),
      });
    }, f.sessions as unknown as Parameters<typeof runOwnerOperation>[3],
    undefined,
    (async () => f.objects.get(shopperObjectName(TENANT, grant.subject))?.data.get('consent')) as unknown as Parameters<typeof runOwnerOperation>[5]);
    await f.drain();
    return out;
  };
  const action = async (entry?: ChannelSignals) => {
    const response = await f.call('/realtime/action', grant.capability, {
      type: 'page_view', source: 'sdk', userId: grant.subject, sessionId: grant.sessionId,
      timestamp: Date.now(), eventId: crypto.randomUUID(), data: {}, ...(entry === undefined ? {} : { entry }),
    });
    await f.drain();
    return response.status;
  };
  const publishSlots = async (value: unknown[], authorize?: () => Promise<void>) => {
    invalidateCache(); invalidateLiftCache();
    const pin = await pinPublication(f.env, TENANT), current = pin.refs[SLOTS_KIND.name + ':' + TENANT]!.revision;
    const result = await publishSet(f.env, [{ kind: SLOTS_KIND, scope: TENANT, request: { pages: { home: value } }, candidate: () => ({ pages: { home: value } }) }],
      { actor: 'w16-b2-fixture', expectedRevision: current, expectedPublication: { revision: pin.revision, digest: pin.digest },
        operationId: current + ':' + crypto.randomUUID(), ...(authorize ? { authorize } : {}) });
    invalidateCache(); invalidateLiftCache();
    return result.ok ? { ok: true as const, revision: result.revision.revision } : { ok: false as const, errors: result.errors };
  };
  const rollbackSlots = async (toRevision: number) => {
    invalidateCache(); invalidateLiftCache();
    const pin = await pinPublication(f.env, TENANT), current = pin.refs[SLOTS_KIND.name + ':' + TENANT]!.revision;
    const result = await rollback(f.env, SLOTS_KIND, TENANT, toRevision,
      { actor: 'w16-b2-fixture', expectedRevision: current, expectedPublication: { revision: pin.revision, digest: pin.digest },
        operationId: current + ':' + crypto.randomUUID() });
    invalidateCache(); invalidateLiftCache();
    return result.ok ? { ok: true as const, revision: result.revision.revision } : { ok: false as const };
  };
  const pendingSlot = async () => {
    const object = await f.env.STORAGE.get('config-publication/v2/' + TENANT + '/head.json');
    const head = object === null ? null : await object.json() as
      { pending?: { documents?: Array<{ kind: string; value: { pages: Record<string, SlotStrategy[]> } }> } | null };
    return head?.pending?.documents?.find(d => d.kind === SLOTS_KIND.name)?.value.pages.home![0];
  };
  const stored = () => JSON.stringify([
    [...f.objects].map(([name, object]) => [name, [...object.data]]),
    [...f.sessions.data], [...f.cache.data],
  ]);
  return { f, grant, principal, snapshot, decide, action, publishSlots, rollbackSlots, pendingSlot, stored };
}

/** Establish the owned paid-social entry channel, exactly as a first page view does. */
async function arrived(host: 'session' | 'do', slots: unknown[], pieces: ContentPiece[] = PIECES): Promise<HostFixture> {
  const h = await hostFixture(host, slots, pieces);
  expect(await h.action(ARRIVAL), `${host}: the arrival page view must be accepted`).toBe(200);
  return h;
}

const HOSTS = ['session', 'do'] as const;

// ---------------------------------------------------------------------------

describe('unit:W16.C3.01', () => {
  it('logic: a published per-slot seed rule set maps entry channel, campaign term and referrer network to canonical tags, and ranks the seeded candidates above equal-base candidates at gamma zero', () => {
    const slot = withSeeds(HERO, SEEDS_V1);

    // A cold shopper: no affinity at all, γ = 0, so every candidate's base is
    // exactly equal — exactly zero — before the seeds speak. This is F13's case:
    // "current context fields alone do not guarantee seeded influence at gamma zero".
    expect(orderOf(runDecide({ slots: [HERO], entry: ARRIVAL_TERM }))).toEqual(coldCatalogueOrder());

    const seeded = runDecide({ slots: [slot], entry: ARRIVAL_TERM });
    expect(orderOf(seeded)).toEqual([
      ['tabby-in-motion-film', TABBY_CHANNEL + TABBY_TERM],   // 0.3 + 0.12
      ['willow-slg-editorial', WILLOW_NETWORK],               // 0.25
      ['signature-charms-editorial', 0],
      ['fragrance-note-editorial', 0],
    ]);

    // One signal at a time, so each rule is separately earned and none of them
    // is a blanket boost.
    expect(orderOf(runDecide({ slots: [slot], entry: arrival({ medium: 'cpc', source: 'instagram', referrer: 'l.instagram.com', siteHost: SITE }) })))
      .toEqual([['tabby-in-motion-film', TABBY_CHANNEL], ['willow-slg-editorial', WILLOW_NETWORK],
        ['signature-charms-editorial', 0], ['fragrance-note-editorial', 0]]);
    // An organic return declares none of the three signals: the rule set is in
    // force and contributes nothing, and the catalogue order stands.
    expect(orderOf(runDecide({ slots: [slot], cell: ORGANIC_CELL, entry: ARRIVAL_ORGANIC }))).toEqual(coldCatalogueOrder());
    // A campaign term nobody published a rule for is not evidence for anything.
    expect(orderOf(runDecide({ slots: [slot], cell: ORGANIC_CELL,
      entry: arrival({ term: 'willow tote', referrer: 'www.google.com', siteHost: SITE }) }))).toEqual(coldCatalogueOrder());
    // A lookalike of the seeded network is not that network (W16.C2.02's rule,
    // and R30(5)'s dot-boundary match on the registrable domain).
    expect(orderOf(runDecide({ slots: [slot], cell: ORGANIC_CELL,
      entry: arrival({ source: 'instagram.evil.example', referrer: 'instagram.com.evil.example', siteHost: SITE }) }))).toEqual(coldCatalogueOrder());
    // Another known network is not this one.
    expect(orderOf(runDecide({ slots: [slot], cell: ORGANIC_CELL,
      entry: arrival({ referrer: 'www.pinterest.com', siteHost: SITE }) }))).toEqual(coldCatalogueOrder());
    // A `utm_source` that is itself the network's host belongs to the network,
    // with no referrer at all.
    expect(orderOf(runDecide({ slots: [slot], cell: ORGANIC_CELL, entry: arrival({ source: 'instagram.com', siteHost: SITE }) })))
      .toEqual([['willow-slg-editorial', WILLOW_NETWORK], ['signature-charms-editorial', 0],
        ['fragrance-note-editorial', 0], ['tabby-in-motion-film', 0]]);

    // The itemization: one driver per rule that fired, naming the signal, the
    // canonical tag it seeded and the delta it caused.
    expect(contextualOf(recordFor(seeded, 'tabby-in-motion-film'))).toEqual({
      applied: TABBY_CHANNEL + TABBY_TERM,
      drivers: [
        { signal: 'entry_channel', value: 'paid_social', dimension: 'category', tag: 'Handbags', weight: 0.6, contribution: TABBY_CHANNEL },
        { signal: 'campaign_term', value: 'tabby handbag', dimension: 'line', tag: 'Tabby', weight: 0.4, contribution: TABBY_TERM },
      ],
    });
    expect(contextualOf(recordFor(seeded, 'willow-slg-editorial'))).toEqual({
      applied: WILLOW_NETWORK,
      drivers: [{ signal: 'referrer_network', value: 'instagram.com', dimension: 'category', tag: 'Small Leather Goods', weight: 0.5, contribution: WILLOW_NETWORK }],
    });
    // A candidate the rules never matched says so with zero rather than silence.
    expect(contextualOf(recordFor(seeded, 'fragrance-note-editorial'))).toEqual({ applied: 0, drivers: [] });
    // R30(4): the rule-set version a receipt names is the `slots` revision the
    // decision already stamps, not a second number inside the contextual field.
    for (const id of CATALOGUE_ORDER) expect(recordFor(seeded, id).versions.slots, id).toBe(1);
  });

  it('host: the mounted snapshot route ranks the seeded candidates first for a cold shopper on both hosts', async () => {
    for (const host of HOSTS) {
      const h = await arrived(host, [withSeeds(HERO, SEEDS_V1)]);
      const seen = await h.snapshot(ARRIVAL_TERM);
      // The campaign term is part of the bounded arrival contract: a seed rule
      // cannot map a search keyword the boundary refuses to carry
      // (tapestry_requirements.txt:153, "search keywords ... inform on-site
      // experience from first page").
      expect(seen.status, `${host}: the public route must accept an arrival carrying the campaign term`).toBe(200);
      expect(seen.order, host).toEqual([
        ['tabby-in-motion-film', TABBY_CHANNEL + TABBY_TERM],
        ['willow-slg-editorial', WILLOW_NETWORK],
        ['signature-charms-editorial', 0],
        ['fragrance-note-editorial', 0],
      ]);
    }
  });

  it('host-internal: both hosts itemize the contextual contribution on the receipt of the decision the route served', async () => {
    for (const host of HOSTS) {
      const h = await arrived(host, [withSeeds(HERO, SEEDS_V1)]);
      const set = await h.decide(ARRIVAL);
      expect(set.cell.channel, host).toBe('paid_social');
      expect(orderOf(set), host).toEqual([
        ['tabby-in-motion-film', TABBY_CHANNEL],
        ['willow-slg-editorial', WILLOW_NETWORK],
        ['signature-charms-editorial', 0],
        ['fragrance-note-editorial', 0],
      ]);
      expect(contextualOf(recordFor(set, 'tabby-in-motion-film')), host).toEqual({
        applied: TABBY_CHANNEL,
        drivers: [{ signal: 'entry_channel', value: 'paid_social', dimension: 'category', tag: 'Handbags', weight: 0.6, contribution: TABBY_CHANNEL }],
      });
      expect(recordFor(set, 'tabby-in-motion-film').versions.slots, host).toBe(1);
    }
  });
});

describe('unit:W16.C3.02', () => {
  it('logic: a slot is seeded only by its own published rule set', () => {
    const heroOnly = { slot: 'hero', take: 2, weights: { category: 0.5 } } satisfies SlotStrategy;
    const railOnly = { slot: 'rail', take: 2, weights: { category: 0.5 } } satisfies SlotStrategy;
    // Two slots, disjoint pieces, each slot holding one Handbags piece — the
    // page dedupes, so a piece belongs to exactly one slot.
    const pieces: ContentPiece[] = [
      piece('tabby-hero-film', 'cms-2001', 'video', 'Tabby, hero', { category: ['Handbags'] }, ['hero']),
      piece('willow-hero-editorial', 'cms-2002', 'editorial', 'Willow, hero', { category: ['Small Leather Goods'] }, ['hero']),
      piece('willow-rail-editorial', 'cms-2003', 'editorial', 'Willow, rail', { category: ['Small Leather Goods'] }, ['rail']),
      piece('tabby-rail-film', 'cms-2004', 'video', 'Tabby, rail', { category: ['Handbags'] }, ['rail']),
    ];
    const handbags: SeedRule[] = [{ signal: 'entry_channel', value: 'paid_social', tags: [{ dimension: 'category', value: 'Handbags' }], weight: 0.6 }];

    // Published for the hero only.
    const onHero = runDecide({ slots: [withSeeds(heroOnly, handbags), railOnly], pieces, entry: ARRIVAL });
    expect(orderOf(onHero, 'hero')).toEqual([['tabby-hero-film', 0.3], ['willow-hero-editorial', 0]]);
    expect(orderOf(onHero, 'rail')).toEqual([['willow-rail-editorial', 0], ['tabby-rail-film', 0]]);
    expect(contextualOf(recordFor(onHero, 'tabby-rail-film', 'rail'))).toBeUndefined();

    // Published for the rail only: now the rail's Handbags piece leads and the
    // hero, which has no rule set, keeps its catalogue order at exactly zero.
    const onRail = runDecide({ slots: [heroOnly, withSeeds(railOnly, handbags)], pieces, entry: ARRIVAL });
    expect(orderOf(onRail, 'rail')).toEqual([['tabby-rail-film', 0.3], ['willow-rail-editorial', 0]]);
    expect(orderOf(onRail, 'hero')).toEqual([['tabby-hero-film', 0], ['willow-hero-editorial', 0]]);
    expect(contextualOf(recordFor(onRail, 'tabby-hero-film', 'hero'))).toBeUndefined();
  });
});

describe('unit:W16.C3.03', () => {
  it('logic: with no rule set published there is no contextual influence and the base order stands', () => {
    // The discriminating control first: with a rule set, this arrival moves the
    // ranking. Without one, the very same arrival must move nothing.
    expect(orderOf(runDecide({ slots: [withSeeds(HERO, SEEDS_V1)], entry: ARRIVAL_TERM })))
      .toEqual([['tabby-in-motion-film', TABBY_CHANNEL + TABBY_TERM], ['willow-slg-editorial', WILLOW_NETWORK],
        ['signature-charms-editorial', 0], ['fragrance-note-editorial', 0]]);

    const bare = runDecide({ slots: [HERO], entry: ARRIVAL_TERM });
    expect(orderOf(bare)).toEqual(coldCatalogueOrder());
    // Nothing is invented: no contextual field on any receipt, and no diagnostic
    // about a rule set that was never published.
    for (const id of CATALOGUE_ORDER) expect(contextualOf(recordFor(bare, id)), id).toBeUndefined();
    expect(seedDiagnosticsOf(bare)).toBeUndefined();
    // An empty rule set is the same as none: it is not an excuse to invent one.
    const empty = runDecide({ slots: [withSeeds(HERO, [])], entry: ARRIVAL_TERM });
    expect(orderOf(empty)).toEqual(coldCatalogueOrder());
  });
});

describe('unit:W16.C3.04', () => {
  it('logic: publication refuses an invalid rule and the decision ignores a rule set that became invalid, whole, with a diagnostic', () => {
    const document = (seeds: unknown) => ({ governanceVersion: 3, pages: { home: [{ slot: 'hero', take: 4, weights: { category: 0.5, line: 0.3 }, seeds }] } });

    // A valid rule set publishes and is RETAINED: a validator that silently drops
    // the rules would publish a document that cannot seed anything.
    const good = validateSlotCatalog(document(SEEDS_V1));
    expect(good.ok).toBe(true);
    expect(good.ok && seedsOf(good.value.pages.home![0]!)).toEqual(SEEDS_V1);

    // Every invalid rule is refused at publication, with the error naming the
    // rule that caused it (`pages.<page>[<i>]` is this validator's own address
    // form, src/content/kinds.ts:159).
    const refusals: Array<[string, unknown]> = [
      // An unknown canonical tag: `wombat` is not a dimension this slot weights,
      // so nothing it names could ever reach the score
      // (src/reflex/contentCompose.ts:259).
      ['unknown canonical tag', [{ signal: 'entry_channel', value: 'paid_social', tags: [{ dimension: 'wombat', value: 'Handbags' }], weight: 0.6 }]],
      ['out-of-range weight (high)', [{ signal: 'entry_channel', value: 'paid_social', tags: [{ dimension: 'category', value: 'Handbags' }], weight: 1.5 }]],
      ['out-of-range weight (negative)', [{ signal: 'entry_channel', value: 'paid_social', tags: [{ dimension: 'category', value: 'Handbags' }], weight: -0.2 }]],
      ['malformed weight', [{ signal: 'entry_channel', value: 'paid_social', tags: [{ dimension: 'category', value: 'Handbags' }], weight: 'high' }]],
      ['unknown signal', [{ signal: 'phase_of_moon', value: 'waxing', tags: [{ dimension: 'category', value: 'Handbags' }], weight: 0.6 }]],
      ['no tags', [{ signal: 'entry_channel', value: 'paid_social', tags: [], weight: 0.6 }]],
      ['malformed tag', [{ signal: 'entry_channel', value: 'paid_social', tags: [{ dimension: 'category' }], weight: 0.6 }]],
      ['empty signal value', [{ signal: 'entry_channel', value: '', tags: [{ dimension: 'category', value: 'Handbags' }], weight: 0.6 }]],
      ['rules must be a list', { entry_channel: 'paid_social' }],
      // R30(5): an entry-channel value outside the six-word vocabulary
      // (src/services/visit.ts entryChannelOf) names a cell that cannot exist.
      ['entry channel outside the vocabulary', [{ signal: 'entry_channel', value: 'social', tags: [{ dimension: 'category', value: 'Handbags' }], weight: 0.6 }]],
      ['entry channel that is a network', [{ signal: 'entry_channel', value: 'instagram.com', tags: [{ dimension: 'category', value: 'Handbags' }], weight: 0.6 }]],
      // R30(5): a referrer-network value is a KNOWN network's registrable
      // domain; free text and a bare network name are neither.
      ['referrer network nobody knows', [{ signal: 'referrer_network', value: 'notanetwork.example', tags: [{ dimension: 'category', value: 'Handbags' }], weight: 0.6 }]],
      ['referrer network as a bare name', [{ signal: 'referrer_network', value: 'instagram', tags: [{ dimension: 'category', value: 'Handbags' }], weight: 0.6 }]],
      ['referrer network as a subdomain', [{ signal: 'referrer_network', value: 'l.instagram.com', tags: [{ dimension: 'category', value: 'Handbags' }], weight: 0.6 }]],
    ];
    for (const [name, seeds] of refusals) {
      const result = validateSlotCatalog(document(seeds));
      expect(result.ok, name).toBe(false);
      expect(!result.ok && result.errors.some(e => e.startsWith('pages.home[0].seeds')), `${name}: ${!result.ok && result.errors.join(' | ')}`).toBe(true);
    }

    // A rule set that became invalid after publication (a retained document the
    // current contract refuses) is ignored WHOLE at decision time: the valid
    // rule beside it is not applied either, and the refusal is diagnosed.
    const mixed = runDecide({
      slots: [withSeeds(HERO, [
        SEEDS_V1[0]!,
        { signal: 'entry_channel', value: 'paid_social', tags: [{ dimension: 'category', value: 'Handbags' }], weight: 4 },
      ])],
      entry: ARRIVAL_TERM,
    });
    expect(orderOf(mixed)).toEqual(coldCatalogueOrder());
    for (const id of CATALOGUE_ORDER) expect(contextualOf(recordFor(mixed, id)), id).toBeUndefined();
    expect(seedDiagnosticsOf(mixed)).toEqual([{ slot: 'hero', reason: 'invalid_rule_set' }]);

    // The same, whole, for a retained rule whose VALUE the current contract
    // refuses (R30(5)): an entry channel outside the six-word vocabulary.
    const stale = runDecide({
      slots: [withSeeds(HERO, [
        SEEDS_V1[2]!,
        { signal: 'entry_channel', value: 'social', tags: [{ dimension: 'category', value: 'Handbags' }], weight: 0.6 },
      ])],
      entry: ARRIVAL_TERM,
    });
    expect(orderOf(stale)).toEqual(coldCatalogueOrder());
    expect(seedDiagnosticsOf(stale)).toEqual([{ slot: 'hero', reason: 'invalid_rule_set' }]);
    // A page whose other slot has a sound rule set is not punished for it.
    const oneBad = runDecide({
      slots: [withSeeds(HERO, [{ signal: 'referrer_network', value: 'nonsense', tags: [{ dimension: 'category', value: 'Handbags' }], weight: 0.6 }]),
        // The rail weights both dimensions SEEDS_V1 names, so its rule set is
        // sound; only the hero's is refused.
        withSeeds({ slot: 'rail', take: 1, weights: { category: 0.5, line: 0.3 } }, SEEDS_V1)],
      pieces: [...PIECES, piece('tabby-rail-film', 'cms-1005', 'video', 'Tabby, rail', { category: ['Handbags'] }, ['rail'])],
      entry: ARRIVAL_TERM,
    });
    expect(orderOf(oneBad, 'hero')).toEqual(coldCatalogueOrder());
    expect(orderOf(oneBad, 'rail')).toEqual([['tabby-rail-film', TABBY_CHANNEL]]);
    expect(seedDiagnosticsOf(oneBad)).toEqual([{ slot: 'hero', reason: 'invalid_rule_set' }]);
  });

  it('host: the real publication path refuses an invalid rule set and the route keeps serving the published ranking, on both hosts', async () => {
    for (const host of HOSTS) {
      const h = await arrived(host, [withSeeds(HERO, SEEDS_V1)]);
      const refused = await h.publishSlots([{ slot: 'hero', take: 4, weights: { category: 0.5, line: 0.3 },
        seeds: [{ signal: 'entry_channel', value: 'paid_social', tags: [{ dimension: 'category', value: 'Handbags' }], weight: 1.5 }] }]);
      expect(refused.ok, `${host}: an out-of-range seed weight must be refused at publication`).toBe(false);
      expect(refused.errors?.some(e => e.startsWith('pages.home[0].seeds')), `${host}: ${refused.errors?.join(' | ')}`).toBe(true);
      // Fail closed means the refused rule set changed nothing: the revision in
      // force still serves, and it still seeds.
      const seen = await h.snapshot(ARRIVAL);
      expect(seen.status, host).toBe(200);
      expect(seen.slotsRevision, host).toBe(1);
      expect(seen.order, host).toEqual([
        ['tabby-in-motion-film', TABBY_CHANNEL],
        ['willow-slg-editorial', WILLOW_NETWORK],
        ['signature-charms-editorial', 0],
        ['fragrance-note-editorial', 0],
      ]);
    }
  });
});

describe('unit:W16.C3.05', () => {
  it('host: a drafted rule set that was authored but never committed never influences a decision, on both hosts', async () => {
    for (const host of HOSTS) {
      // Version 1 is published and in force.
      const h = await arrived(host, [withSeeds(HERO, SEEDS_V1)]);
      // Version 2 is authored through the real publication path but its
      // authority recheck refuses at the commit step, so it is reserved and
      // never committed: the head keeps a pending set nobody published.
      let checks = 0;
      await expect(h.publishSlots([withSeeds(HERO, SEEDS_V2)], async () => {
        if (++checks > 1) throw new Error('authority withdrawn before the commit');
      })).rejects.toThrow();

      // The draft really is in the store, and it really does carry version 2's
      // rule set: without this the unit could degrade into the absent-rule-set
      // case and pass for the wrong reason.
      const draft = await h.pendingSlot();
      expect(draft?.take, `${host}: the drafted slots document must be reserved in the publication head`).toBe(4);
      expect(seedsOf(draft!), `${host}: the reserved draft must carry the drafted rule set`).toEqual(SEEDS_V2);

      const seen = await h.snapshot(ARRIVAL);
      expect(seen.status, `${host}: a draft in flight must not stop the committed rule set from serving`).toBe(200);
      expect(seen.slotsRevision, host).toBe(1);
      // The committed rule set decides; the draft's small-leather-goods seed
      // does not move Willow to the front.
      expect(seen.order, host).toEqual([
        ['tabby-in-motion-film', TABBY_CHANNEL],
        ['willow-slg-editorial', WILLOW_NETWORK],
        ['signature-charms-editorial', 0],
        ['fragrance-note-editorial', 0],
      ]);
    }
  });
});

describe('unit:W16.C3.06', () => {
  it('logic: the learned lift applies on top of the seeded base, and the seeds change neither the learned statistics nor the receipt\'s learned-influence field', () => {
    // A shopper with a real, small learned interest in the Tabby line, and a
    // learned lift of 1.5 for that piece at trust 1.
    const affinity = { dims: { line: { Tabby: 0.5 } } };
    const snapshots = { hero: LEARNED };
    const before = structuredClone(LEARNED);

    const plain = runDecide({ slots: [HERO], affinity, entry: ARRIVAL, gamma: 1, snapshots });
    const seeded = runDecide({ slots: [withSeeds(HERO, SEEDS_V1)], affinity, entry: ARRIVAL, gamma: 1, snapshots });

    // Without seeds: interest 0.5 × the line weight 0.3 = 0.15, lifted to 0.225.
    expect(orderOf(plain)[0]).toEqual(['tabby-in-motion-film', 0.225]);
    // With seeds: the same lift, now on the seeded base 0.15 + 0.3 = 0.45.
    expect(orderOf(seeded)[0]).toEqual(['tabby-in-motion-film', 0.675]);

    const plainRecord = recordFor(plain, 'tabby-in-motion-film'), seededRecord = recordFor(seeded, 'tabby-in-motion-film');
    expect(plainRecord.explain.score_base).toBe(0.15);
    expect(seededRecord.explain.score_base).toBe(0.45);
    // Every learned input is identical — a seed is context, never evidence — and
    // the field differs ONLY in the delta the lift actually caused, which is
    // measured on the base it multiplied (R30(4), the same arithmetic W16.C7.01
    // pins): 0.15 × (1.5 − 1) = 0.075 plain, 0.45 × (1.5 − 1) = 0.225 seeded.
    expect({ ...seededRecord.explain.lift, applied: undefined }).toEqual({ ...plainRecord.explain.lift, applied: undefined });
    expect(liftAppliedOf(plainRecord)).toBe(0.075);
    expect(liftAppliedOf(seededRecord)).toBe(0.225);
    expect(seededRecord.explain.lift?.lift).toBe(1.5);
    expect(seededRecord.explain.lift?.gamma).toBe(1);
    // ... and it is recorded separately from the contextual contribution.
    expect(contextualOf(seededRecord)).toEqual({
      applied: TABBY_CHANNEL,
      drivers: [{ signal: 'entry_channel', value: 'paid_social', dimension: 'category', tag: 'Handbags', weight: 0.6, contribution: TABBY_CHANNEL }],
    });
    expect(seededRecord.versions.slots).toBe(1);
    // The seed is not smuggled into the shopper's interest vector, so the replay
    // inputs and the learned statistics are untouched.
    expect(seededRecord.inputs?.affinity).toEqual({ line: { Tabby: 0.5 } });
    expect(snapshots.hero).toEqual(before);
  });
});

describe('unit:W16.C3.07', () => {
  it('logic: seeds are not a global floor — a candidate whose final pre-lift base after merchandising is exactly zero stays exactly zero', () => {
    // The seeded candidate Willow carries `season: 1`; the slot's merchandising
    // rule weights season at −1 with an explicit floor of 0, so Willow's
    // merchandised base is exactly zero however well the rules seeded it.
    const set = runDecide({ slots: [withSeeds(HERO_ZEROING, SEEDS_V1)], pieces: PIECES_WITH_SEASON, entry: ARRIVAL_TERM });

    expect(orderOf(set)).toEqual([
      ['tabby-in-motion-film', TABBY_CHANNEL + TABBY_TERM],
      ['signature-charms-editorial', 0],
      ['fragrance-note-editorial', 0],
      ['willow-slg-editorial', 0],
    ]);

    const zeroed = recordFor(set, 'willow-slg-editorial');
    // The seed reached the base, merchandising took the whole of it, and nothing
    // put it back: exactly zero, not an epsilon (document 35 §3 N20; D09 forbids
    // a global score floor).
    expect(zeroed.explain.score_base).toBe(WILLOW_NETWORK);
    expect(zeroed.explain.merchandising?.boost).toBe(0);
    expect(zeroed.explain.score_final).toBe(0);
    // The contextual contribution is measured in that final pre-lift base, so
    // for this candidate the seeds contributed exactly nothing.
    expect(contextualOf(zeroed)).toEqual({
      applied: 0,
      drivers: [{ signal: 'referrer_network', value: 'instagram.com', dimension: 'category', tag: 'Small Leather Goods', weight: 0.5, contribution: 0 }],
    });
    // A candidate the rules never named is not floored either.
    const unnamed = recordFor(set, 'fragrance-note-editorial');
    expect(unnamed.explain.score_final).toBe(0);
    expect(contextualOf(unnamed)).toEqual({ applied: 0, drivers: [] });
    // Raising every weight to the top of its range does not lift either of them.
    const loud = runDecide({ slots: [withSeeds(HERO_ZEROING, SEEDS_V1.map(rule => ({ ...rule, weight: 1 })))],
      pieces: PIECES_WITH_SEASON, entry: ARRIVAL_TERM });
    expect(recordFor(loud, 'willow-slg-editorial').explain.score_final).toBe(0);
    expect(recordFor(loud, 'fragrance-note-editorial').explain.score_final).toBe(0);

    // R30(2), the other end of the same clause: a merchandising boost of 0.5
    // halves the contextual contribution rather than zeroing or ignoring it, so
    // "measured in the final pre-lift base after merchandising" is pinned
    // between 0 and 1 and cannot be satisfied by a special case at zero.
    const halved = runDecide({ slots: [withSeeds(HERO_HALVING, SEEDS_V1)], pieces: PIECES_WITH_SEASON, entry: ARRIVAL_TERM });
    expect(orderOf(halved)).toEqual([
      ['tabby-in-motion-film', TABBY_CHANNEL + TABBY_TERM],
      ['willow-slg-editorial', WILLOW_HALVED],
      ['signature-charms-editorial', 0],
      ['fragrance-note-editorial', 0],
    ]);
    const half = recordFor(halved, 'willow-slg-editorial');
    expect(half.explain.score_base).toBe(WILLOW_NETWORK);
    expect(half.explain.merchandising?.boost).toBe(0.5);
    expect(half.explain.score_final).toBe(WILLOW_HALVED);
    expect(contextualOf(half)).toEqual({
      applied: WILLOW_HALVED,
      drivers: [{ signal: 'referrer_network', value: 'instagram.com', dimension: 'category', tag: 'Small Leather Goods', weight: 0.5, contribution: WILLOW_HALVED }],
    });
    // The candidate the season rule does not touch keeps its whole contribution.
    expect(contextualOf(recordFor(halved, 'tabby-in-motion-film'))?.applied).toBe(TABBY_CHANNEL + TABBY_TERM);
  });
});

/** The ranking the published rule set produces, version by version. */
const V1_ORDER: Array<[string, number]> = [
  ['tabby-in-motion-film', TABBY_CHANNEL],
  ['willow-slg-editorial', WILLOW_NETWORK],
  ['signature-charms-editorial', 0],
  ['fragrance-note-editorial', 0],
];
const V2_ORDER: Array<[string, number]> = [
  ['willow-slg-editorial', WILLOW_V2],
  ['signature-charms-editorial', 0],
  ['fragrance-note-editorial', 0],
  ['tabby-in-motion-film', 0],
];

describe('unit:W16.C3.08', () => {
  it('host: a new rule-set version takes effect for the decisions the route serves next, and rollback restores the previous ranking, on both hosts', async () => {
    for (const host of HOSTS) {
      const h = await arrived(host, [withSeeds(HERO, SEEDS_V1)]);

      const first = await h.snapshot(ARRIVAL);
      expect(first.status, host).toBe(200);
      expect(first.slotsRevision, host).toBe(1);
      expect(first.order, host).toEqual(V1_ORDER);

      // Version 2 moves the paid-social seed to small leather goods.
      const published = await h.publishSlots([withSeeds(HERO, SEEDS_V2)]);
      expect(published.ok, `${host}: version 2 must publish`).toBe(true);
      expect(published.revision, host).toBe(2);
      const second = await h.snapshot(ARRIVAL);
      expect(second.slotsRevision, host).toBe(2);
      expect(second.order, host).toEqual(V2_ORDER);

      // Rolling back to version 1 restores version 1's ranking, under the
      // rollback's own revision.
      const rolled = await h.rollbackSlots(1);
      expect(rolled.ok, `${host}: the rollback must publish`).toBe(true);
      expect(rolled.revision, host).toBe(3);
      const third = await h.snapshot(ARRIVAL);
      expect(third.slotsRevision, host).toBe(3);
      expect(third.order, host).toEqual(V1_ORDER);
    }
  });

  it('host-internal: every receipt names the rule-set version the decision used, across the new version and the rollback, on both hosts', async () => {
    for (const host of HOSTS) {
      const h = await arrived(host, [withSeeds(HERO, SEEDS_V1)]);
      // R30(4): the version a receipt names is the `slots` revision the decision
      // stamps (src/content/decide.ts:306), beside the contribution it caused.
      const one = recordFor(await h.decide(ARRIVAL), 'tabby-in-motion-film');
      expect(contextualOf(one), host).toEqual({
        applied: TABBY_CHANNEL,
        drivers: [{ signal: 'entry_channel', value: 'paid_social', dimension: 'category', tag: 'Handbags', weight: 0.6, contribution: TABBY_CHANNEL }],
      });
      expect(one.versions.slots, host).toBe(1);

      expect((await h.publishSlots([withSeeds(HERO, SEEDS_V2)])).revision, host).toBe(2);
      const two = recordFor(await h.decide(ARRIVAL), 'willow-slg-editorial');
      expect(contextualOf(two), host).toEqual({
        applied: WILLOW_V2,
        drivers: [{ signal: 'entry_channel', value: 'paid_social', dimension: 'category', tag: 'Small Leather Goods', weight: 0.8, contribution: WILLOW_V2 }],
      });
      expect(two.versions.slots, host).toBe(2);

      expect((await h.rollbackSlots(1)).revision, host).toBe(3);
      const three = recordFor(await h.decide(ARRIVAL), 'tabby-in-motion-film');
      expect(contextualOf(three), host).toEqual({
        applied: TABBY_CHANNEL,
        drivers: [{ signal: 'entry_channel', value: 'paid_social', dimension: 'category', tag: 'Handbags', weight: 0.6, contribution: TABBY_CHANNEL }],
      });
      expect(three.versions.slots, host).toBe(3);
    }
  });
});

describe('unit:W16.C3.09', () => {
  it('logic: the campaign term is a bounded arrival field, refused rather than truncated, and inert for classification', () => {
    // R30(3): 256 characters, the bound `utmSource` already carries
    // (ENTRY_LIMITS, src/services/visit.ts:49). At the bound it is carried; one
    // character beyond it the whole arrival is refused, never trimmed into
    // something that would seed a different rule.
    expect(validEntry({ utmTerm: 'x'.repeat(TERM_LIMIT) })).toBe(true);
    expect(validEntry({ utmTerm: 'x'.repeat(TERM_LIMIT + 1) })).toBe(false);
    // It is not a host field, so the host-only boundary accepts it unchanged.
    expect(validEntry({ utmTerm: 'tabby handbag', siteHost: SITE }, true)).toBe(true);
    expect(validEntry({ utmTerm: 7 })).toBe(false);

    // The bounded snapshot contract carries it verbatim.
    const carried = snapshotEntry(ARRIVAL_TERM);
    expect(carried).toBeDefined();
    expect(carried!.length).toBeLessThanOrEqual(ENTRY_QUERY_LIMIT);
    expect(JSON.parse(carried!)).toEqual({ utmMedium: 'cpc', utmSource: 'instagram', utmTerm: 'tabby handbag', referrer: 'l.instagram.com', siteHost: SITE });
    expect(snapshotEntry(arrival({ term: 'x'.repeat(TERM_LIMIT + 1), siteHost: SITE }))).toBeUndefined();

    // Inert beyond seeding: a search keyword is what the shopper typed, never
    // evidence of a channel. Every arrival classifies identically with and
    // without one, including terms that read like a channel or a network.
    const arrivals: ChannelSignals[] = [
      ARRIVAL, ARRIVAL_ORGANIC,
      arrival({ referrer: '', siteHost: SITE }),
      arrival({ medium: 'email', source: 'klaviyo', siteHost: SITE }),
      arrival({ referrer: 'partner.example', siteHost: SITE }),
      arrival({ medium: 'wombat-unrecognized', siteHost: SITE }),
    ];
    for (const signals of arrivals) {
      const plain = classifyEntryChannel(signals);
      for (const term of ['tabby handbag', 'facebook', 'paid_social', 'www.google.com', 'x'.repeat(TERM_LIMIT)]) {
        expect(classifyEntryChannel({ ...signals, ...arrival({ term }) }), `${JSON.stringify(signals)} + ${term.slice(0, 16)}`).toBe(plain);
      }
    }
  });

  it('host: the route carries a term at the bound, refuses one beyond it, and the term is never persisted, on both hosts', async () => {
    for (const host of HOSTS) {
      const h = await arrived(host, [withSeeds(HERO, SEEDS_V1)]);
      // A distinctive keyword, so finding it anywhere in stored state is proof.
      const TERM = 'coach-tabby-keyword-w16b2';
      expect(await h.action(arrival({ medium: 'cpc', source: 'instagram', term: TERM, referrer: 'l.instagram.com', siteHost: SITE })),
        `${host}: a page view carrying the search keyword must be accepted`).toBe(200);

      // The event really was ingested — otherwise "never persisted" is vacuous.
      const set = await h.decide();
      expect(set.cell.channel, host).toBe('paid_social');
      expect(set.cell.visit_bucket, host).toBe('1');
      // The term adds no dimension to the cell the statistics are pooled on
      // (doc 22 §5.4; src/learn/stats.ts levelKeys reads exactly these five).
      expect(Object.keys(recordFor(set, 'tabby-in-motion-film').cell).sort(), host)
        .toEqual(['affinity', 'channel', 'region', 'stage', 'visit_bucket']);
      // And it is in nothing this host stored. The ODP payload is projected from
      // that same stored state (src/services/odpLoop.ts:426-443), so a keyword
      // that is never stored cannot reach it; the live ODP call itself is the
      // admitted K3 check, not this unit.
      expect(h.stored().includes(TERM), `${host}: the keyword must not be persisted`).toBe(false);
      expect(JSON.stringify(set.records).includes(TERM), `${host}: the keyword must not be written to the ledger record`).toBe(false);

      // The bound, at the public boundary: carried at 256, refused beyond it.
      expect((await h.snapshot(arrival({ term: 'x'.repeat(TERM_LIMIT), siteHost: SITE }))).status, host).toBe(200);
      expect((await h.snapshot(arrival({ term: 'x'.repeat(TERM_LIMIT + 1), siteHost: SITE }))).status, host).toBe(401);
    }
  });
});

describe('unit:W16.C7.01', () => {
  it('logic: contextual influence is computed from the final pre-lift base after merchandising, an exactly zero base stays zero, and the receipt records the delta the learned lift actually caused', () => {
    const set = runDecide({ slots: [withSeeds(HERO_ZEROING, SEEDS_V1)], pieces: PIECES_WITH_SEASON,
      entry: ARRIVAL_TERM, gamma: 1, snapshots: { hero: LEARNED } });

    // The candidate the lift really moved: base 0.42, merchandising boost 1,
    // lift 1.5 at trust 1 → 0.63, a delta of +0.21.
    const moved = recordFor(set, 'tabby-in-motion-film');
    expect(moved.explain.score_base).toBe(TABBY_CHANNEL + TABBY_TERM);
    expect(moved.explain.merchandising?.boost).toBe(1);
    expect(moved.explain.score_final).toBe(0.63);
    expect(moved.explain.lift?.lift).toBe(1.5);
    expect(liftAppliedOf(moved)).toBe(0.21);

    // The candidate whose final pre-lift base after merchandising is exactly
    // zero: a multiplicative learned term cannot change it (document 35 §3 N20),
    // so the receipt records exactly that and claims nothing else.
    const zeroed = recordFor(set, 'willow-slg-editorial');
    expect(zeroed.explain.merchandising?.boost).toBe(0);
    expect(zeroed.explain.score_final).toBe(0);
    expect(contextualOf(zeroed)?.applied).toBe(0);
    expect(liftAppliedOf(zeroed)).toBe(0);
    // The rendered receipt tells the same story: base 0.25, merchandised to 0.
    const receipt = receiptOf(zeroed, NO_NAMES);
    expect(receipt.score_base).toBe(WILLOW_NETWORK);
    expect(receipt.score_final).toBe(0);
    // R30(4) and C7's central clause, in the words the shopper's receipt uses:
    // the candidate the lift really moved says it was applied at the trust dial
    // (src/learn/receipts.ts:63-68), and the candidate it could not move NEVER
    // says so. A prose line that claims influence the ranking never had is the
    // whole of N20.
    const why = (record: DecisionRecord) => receiptOf(record, NO_NAMES).why.join(' ');
    expect(why(moved)).toContain('applied at trust');
    expect(why(zeroed)).not.toContain('applied at trust');

    // R30(2): the same clause at a boost of 0.5. The learned lift is real here,
    // so what it may claim is the delta it caused on the halved base and nothing
    // more: 0.125 → 0.15, a delta of +0.025.
    const halved = runDecide({ slots: [withSeeds(HERO_HALVING, SEEDS_V1)], pieces: PIECES_WITH_SEASON,
      entry: ARRIVAL_TERM, gamma: 1, snapshots: { hero: LEARNED } });
    const half = recordFor(halved, 'willow-slg-editorial');
    expect(half.explain.merchandising?.boost).toBe(0.5);
    expect(contextualOf(half)?.applied).toBe(WILLOW_HALVED);
    expect(half.explain.lift?.lift).toBe(1.2);
    expect(half.explain.score_final).toBe(0.15);
    expect(liftAppliedOf(half)).toBe(0.025);
    expect(why(half)).toContain('applied at trust');
  });

  it('host: the mounted snapshot route serves an exactly zero score for a candidate merchandised to zero, on both hosts', async () => {
    for (const host of HOSTS) {
      const h = await arrived(host, [withSeeds(HERO_ZEROING, SEEDS_V1)], PIECES_WITH_SEASON);
      const seen = await h.snapshot(ARRIVAL);
      expect(seen.status, host).toBe(200);
      expect(seen.order, host).toEqual([
        ['tabby-in-motion-film', TABBY_CHANNEL],
        ['signature-charms-editorial', 0],
        ['fragrance-note-editorial', 0],
        ['willow-slg-editorial', 0],
      ]);
    }
  });
});

describe('unit:W16.C7.02', () => {
  it('host: the mounted snapshot route serves the seeded ranking with a rule set and the base order without one, at gamma zero, on both hosts', async () => {
    for (const host of HOSTS) {
      const seeded = await arrived(host, [withSeeds(HERO, SEEDS_V1)]);
      const withRules = await seeded.snapshot(ARRIVAL);
      expect(withRules.status, host).toBe(200);
      expect(withRules.order, host).toEqual(V1_ORDER);

      const bare = await arrived(host, [HERO]);
      const without = await bare.snapshot(ARRIVAL);
      expect(without.status, host).toBe(200);
      expect(without.order, host).toEqual(coldCatalogueOrder());
    }
  });

  it('host-internal: receipts record the contextual contribution and its rule-set version separately from the learned lift, and record neither when no rule set is published at gamma zero', async () => {
    for (const host of HOSTS) {
      // A published rule set at γ = 0: the contextual contribution is on the
      // receipt beside the `slots` revision it came from, and the learned-lift
      // field is null because nothing has been learned for this piece here.
      const seeded = await arrived(host, [withSeeds(HERO, SEEDS_V1)]);
      const withRules = recordFor(await seeded.decide(ARRIVAL), 'tabby-in-motion-film');
      expect(contextualOf(withRules), host).toEqual({
        applied: TABBY_CHANNEL,
        drivers: [{ signal: 'entry_channel', value: 'paid_social', dimension: 'category', tag: 'Handbags', weight: 0.6, contribution: TABBY_CHANNEL }],
      });
      expect(withRules.versions.slots, host).toBe(1);
      expect(withRules.explain.lift, host).toBeNull();
      expect(withRules.explain.score_final, host).toBe(TABBY_CHANNEL);

      // No rule set and γ = 0: both are absent, and nothing is invented in
      // their place — the catalogue order serves at exactly zero.
      const bare = await arrived(host, [HERO]);
      const set = await bare.decide(ARRIVAL);
      const plain = recordFor(set, 'tabby-in-motion-film');
      expect(contextualOf(plain), host).toBeUndefined();
      expect(plain.explain.lift, host).toBeNull();
      expect(orderOf(set), host).toEqual(coldCatalogueOrder());
    }
  });
});
