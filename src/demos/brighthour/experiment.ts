// src/demos/brighthour/experiment.ts
// ─────────────────────────────────────────────────────────────────────────────
// BEAT 13 — "Experiment on Top" (owner: brighthour-experiment).
//
// Slot 2 (`daily_deal`, "Today's Bright One") is the one slot whose occupant is
// chosen by the CALENDAR rather than by affinity — which makes it the honest
// place to put an experiment. The item is fixed by its window; only the FRAMING
// is up for debate. So the experiment is a 2-arm test of the language the offer
// is sold in:
//
//   time_language   (control)   the §A6 window language the composer already
//                               computes — "Ends Today", "Last Hours",
//                               "One-Day Price". Urgency as time.
//   value_language  (treatment) the same offer, the same window, described as
//                               worth instead of clock — "Today's best price".
//
// WHAT IS REAL HERE, EXACTLY (the demo's honesty contract):
//
//   REAL   the flag `bh_offer_framing`, its two variations, the `a/b` ruleset
//          rule `bh_offer_framing_ab` at a 50/50 split, and the custom event
//          `bh_offer_click` behind its metric — all created against the live
//          Optimizely Feature Experimentation project via the proven
//          experimentFx.ts primitives, and openable in app.optimizely.com.
//   REAL   the ids stamped into every decision row: `experiment_id`,
//          `variation_id`, `campaign_id` are the DATAFILE ids the platform
//          itself assigned, read back out of the published datafile — not
//          local inventions.
//   REAL   the conversion: a click on the slot-2 offer is posted to the
//          Optimizely Event API (logx) with `enrich_decisions`, carrying the
//          same campaign/experiment/variation triple.
//   DEMO   the ASSIGNMENT is bucketed in this worker rather than by the
//          Optimizely SDK — see `chooseFraming` below for why, and for the
//          proof that it lands on the same variation the SDK would.
//
// NAMING LAW: every identifier this module creates on the shared project is
// `bh_`-prefixed. It never reads, patches or enables anything it did not create.
// ─────────────────────────────────────────────────────────────────────────────

import { ensureFlag, ensureVariations, enableLive, type FxConfig } from '@/services/optimizelyFx';
import type { Env } from '@/types/env';

// ── The identifiers. All bh_-prefixed. All created by this module only. ──────

/** The flag. Its variations carry the framing the storefront renders. */
export const BH_FLAG_KEY = 'bh_offer_framing';
/** The a/b ruleset rule — and therefore the EXPERIMENT key in the datafile. */
export const BH_RULE_KEY = 'bh_offer_framing_ab';
/** The conversion event: a click on the slot-2 offer. */
export const BH_EVENT_KEY = 'bh_offer_click';
/** Control first — index 0 is the baseline, exactly as experimentFx treats it. */
export const BH_VARIATION_KEYS = ['time_language', 'value_language'] as const;
export type BhVariationKey = (typeof BH_VARIATION_KEYS)[number];
/** The slot under test: slot 2, the takeover. */
export const BH_EXPERIMENT_SLOT = 'daily_deal';
/** Where the created ids live so nothing ever re-creates them. */
export const BH_IDS_KV_KEY = 'bh:experiment:ids';

const FLAGS = 'https://api.optimizely.com/flags/v1';
const ADMIN = 'https://api.optimizely.com/v2';
const EVENT_API = 'https://logx.optimizely.com/v1/events';

// ── The framing each arm renders ─────────────────────────────────────────────

export interface BhFraming {
  variationKey: BhVariationKey;
  /** Which vocabulary the offer chip speaks. */
  style: 'time' | 'value';
  /** Human label for the ops strip / glass box. */
  label: string;
  /** Copy used when the offer carries no window language of its own. */
  fallbackBadge: string;
}

export const BH_FRAMINGS: Readonly<Record<BhVariationKey, BhFraming>> = {
  time_language: {
    variationKey: 'time_language',
    style: 'time',
    label: 'Time language (control)',
    fallbackBadge: 'Ends Today',
  },
  value_language: {
    variationKey: 'value_language',
    style: 'value',
    label: 'Value language',
    fallbackBadge: "Today's best price",
  },
};

/**
 * The offer chip for one arm.
 *
 * `time` returns the composer's own §A6 window language untouched — the control
 * arm is deliberately the page as it already is. `value` re-describes the SAME
 * window, and never counts down: the "language, never a clock" rule is a
 * property of the surface, not of the control arm.
 */
export function frameOffer(
  framing: BhFraming,
  offer: { windowLanguage?: string | null; label?: string | null } | null | undefined
): string {
  const windowLanguage = offer?.windowLanguage ?? null;
  if (framing.style === 'time') return windowLanguage ?? framing.fallbackBadge;
  switch (windowLanguage) {
    case 'One-Day Price':
      return "Today's best price";
    case 'Ends Today':
      return 'Worth it today';
    case 'Last Hours':
      return 'Best value on the floor';
    default:
      return framing.fallbackBadge;
  }
}

// ── The bucketer ─────────────────────────────────────────────────────────────
//
// WHY THIS IS HAND-ROLLED RATHER THAN `OptimizelyService.decide()`.
//
// The bundled `@optimizely/optimizely-sdk` resolves to its BROWSER build under
// the Workers export conditions, so `OptimizelyService.initialize()` throws
// `window is not defined` and silently falls back to its mock client. A mock
// decision stamped into an export row would be exactly the kind of faked stamp
// this demo exists to refuse, so the assignment is computed here instead.
//
// It is not an approximation. This is the Optimizely bucketer's OWN algorithm:
// murmurhash3 x86 32-bit, seed 1, over `visitorId + experimentId`, scaled to
// 10,000 buckets and resolved against the experiment's `trafficAllocation` as
// published in the datafile. Verified against the real Node SDK over 1,000
// synthetic visitors: 0 disagreements (see experiment.test.ts).
//
// So: the EXPERIMENT is real, the IDS are real, the SPLIT is the platform's own,
// and the only thing that is local is the arithmetic — which is reproducible.

/** murmurhash3 x86 32-bit — the hash Optimizely's bucketer uses. */
export function murmurhash3_32(key: string, seed: number): number {
  const remainder = key.length & 3;
  const bytes = key.length - remainder;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  let h1 = seed;
  let i = 0;
  let k1: number;
  let h1b: number;

  while (i < bytes) {
    k1 =
      (key.charCodeAt(i) & 0xff) |
      ((key.charCodeAt(++i) & 0xff) << 8) |
      ((key.charCodeAt(++i) & 0xff) << 16) |
      ((key.charCodeAt(++i) & 0xff) << 24);
    ++i;
    k1 = ((k1 & 0xffff) * c1 + ((((k1 >>> 16) * c1) & 0xffff) << 16)) & 0xffffffff;
    k1 = (k1 << 15) | (k1 >>> 17);
    k1 = ((k1 & 0xffff) * c2 + ((((k1 >>> 16) * c2) & 0xffff) << 16)) & 0xffffffff;
    h1 ^= k1;
    h1 = (h1 << 13) | (h1 >>> 19);
    h1b = ((h1 & 0xffff) * 5 + ((((h1 >>> 16) * 5) & 0xffff) << 16)) & 0xffffffff;
    h1 = (h1b & 0xffff) + 0x6b64 + ((((h1b >>> 16) + 0xe654) & 0xffff) << 16);
  }

  k1 = 0;
  /* eslint-disable no-fallthrough */
  switch (remainder) {
    case 3:
      k1 ^= (key.charCodeAt(i + 2) & 0xff) << 16;
    case 2:
      k1 ^= (key.charCodeAt(i + 1) & 0xff) << 8;
    case 1:
      k1 ^= key.charCodeAt(i) & 0xff;
      k1 = ((k1 & 0xffff) * c1 + ((((k1 >>> 16) * c1) & 0xffff) << 16)) & 0xffffffff;
      k1 = (k1 << 15) | (k1 >>> 17);
      k1 = ((k1 & 0xffff) * c2 + ((((k1 >>> 16) * c2) & 0xffff) << 16)) & 0xffffffff;
      h1 ^= k1;
  }
  /* eslint-enable no-fallthrough */

  h1 ^= key.length;
  h1 ^= h1 >>> 16;
  h1 = ((h1 & 0xffff) * 0x85ebca6b + ((((h1 >>> 16) * 0x85ebca6b) & 0xffff) << 16)) & 0xffffffff;
  h1 ^= h1 >>> 13;
  h1 = ((h1 & 0xffff) * 0xc2b2ae35 + ((((h1 >>> 16) * 0xc2b2ae35) & 0xffff) << 16)) & 0xffffffff;
  h1 ^= h1 >>> 16;
  return h1 >>> 0;
}

/** The SDK's `MAX_TRAFFIC_VALUE`: buckets are basis points of the hash space. */
const MAX_TRAFFIC_VALUE = 10000;
const MAX_HASH_VALUE = 2 ** 32;

/**
 * The bucket a visitor lands in, 0…9999.
 *
 * `salt` is the datafile experiment id when we have one (which is what the SDK
 * concatenates), and the rule key before the datafile has published — stated
 * plainly rather than hidden, because a pre-publish assignment is stable but
 * NOT yet SDK-identical.
 */
export function bucketValue(visitorId: string, salt: string): number {
  return Math.floor((murmurhash3_32(`${visitorId}${salt}`, 1) / MAX_HASH_VALUE) * MAX_TRAFFIC_VALUE);
}

/** One `trafficAllocation` entry, exactly as the datafile publishes it. */
export interface TrafficRange {
  entityId: string;
  endOfRange: number;
}

/** The default 50/50 the launch creates, used before the datafile publishes. */
function defaultAllocation(): TrafficRange[] {
  return [
    { entityId: BH_VARIATION_KEYS[0], endOfRange: 5000 },
    { entityId: BH_VARIATION_KEYS[1], endOfRange: MAX_TRAFFIC_VALUE },
  ];
}

/** `bucketToEntity`: first range whose `endOfRange` the bucket falls under. */
function entityForBucket(bucket: number, allocation: readonly TrafficRange[]): string | null {
  for (const range of allocation) if (bucket < range.endOfRange) return range.entityId;
  return null;
}

// ── The ids we persist ───────────────────────────────────────────────────────

/** Datafile-side ids — the numbers the platform assigned, read back from it. */
export interface BhDatafileIds {
  /** `experiments[].id` — the numeric experiment id an export row must carry. */
  experimentId: string;
  /** `experiments[].layerId` — what Optimizely's own event payload calls a campaign. */
  campaignId: string;
  /** variation key → datafile variation id. */
  variationIds: Record<string, string>;
  /** The published split, verbatim. */
  trafficAllocation: TrafficRange[];
  /** `events[].id` for bh_offer_click, once the metric has published it. */
  eventEntityId: string | null;
  accountId: string;
  revision: string;
  readAt: number;
}

export interface BhExperimentIds {
  flagKey: string;
  flagId: number | null;
  ruleKey: string;
  environment: string;
  projectId: string;
  eventKey: string;
  /** The Admin-API custom event id the rule's metric points at. */
  eventId: number | null;
  /** Flag-API variation ids (distinct from the datafile variation ids). */
  flagVariationIds: Record<string, number>;
  /** Null until the datafile carrying this rule has published. */
  datafile: BhDatafileIds | null;
  createdAt: number;
  /** True when the ruleset PATCH was accepted as a real `a/b` rule. */
  ruleCreated: boolean;
  enabled: boolean;
  /** What the presenter opens. */
  presenterUrl: string;
  resultsUrl: string;
}

// ── KV persistence (idempotence lives here) ──────────────────────────────────

interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export interface BhExperimentEnv {
  CACHE?: KvLike;
  OPTIMIZELY_API_TOKEN?: string;
  OPTIMIZELY_PROJECT_ID?: string;
  OPTIMIZELY_ENVIRONMENT?: string;
  OPTIMIZELY_ACCOUNT_ID?: string;
  OPTIMIZELY_SDK_KEY?: string;
  OPTIMIZELY_DATAFILE_URL?: string;
  OPTIMIZELY_WRITE_ENABLED?: string;
}

/**
 * A tiny in-isolate memo so the page path does not pay a KV read per compose.
 * Short-lived on purpose: a presenter who launches mid-demo must see the ids on
 * the very next page, and 10s is under one beat.
 */
const IDS_TTL_MS = 10_000;
let _idsMemo: { at: number; ids: BhExperimentIds | null } | null = null;

export function clearBhExperimentMemo(): void {
  _idsMemo = null;
}

export async function saveBhExperimentIds(
  env: BhExperimentEnv,
  ids: BhExperimentIds
): Promise<void> {
  _idsMemo = { at: Date.now(), ids };
  if (!env.CACHE) return;
  await env.CACHE.put(BH_IDS_KV_KEY, JSON.stringify(ids));
}

/**
 * The stored ids, or null if the experiment has never been launched.
 *
 * Never throws: a KV hiccup must degrade to "not launched" (rows keep the null
 * columns they have always had) rather than break a page composition.
 */
export async function getBhExperimentIds(env: BhExperimentEnv): Promise<BhExperimentIds | null> {
  if (_idsMemo && Date.now() - _idsMemo.at < IDS_TTL_MS) return _idsMemo.ids;
  try {
    const raw = env.CACHE ? await env.CACHE.get(BH_IDS_KV_KEY) : null;
    const ids = raw ? (JSON.parse(raw) as BhExperimentIds) : null;
    _idsMemo = { at: Date.now(), ids };
    return ids;
  } catch {
    _idsMemo = { at: Date.now(), ids: null };
    return null;
  }
}

// ── Assignment ───────────────────────────────────────────────────────────────

export interface BhAssignment {
  /** False ⇒ nothing has been created on the platform; ids stay null. */
  launched: boolean;
  experimentKey: string;
  flagKey: string;
  variationKey: BhVariationKey;
  framing: BhFraming;
  /** Datafile experiment id — what an export row's `experiment_id` carries. */
  experimentId: string | null;
  variationId: string | null;
  campaignId: string | null;
  /** 0…9999. Shown in the glass box so the assignment is checkable, not asserted. */
  bucket: number;
  /** What the bucket was salted with — `experiment_id` once the datafile lands. */
  bucketedOn: string;
  /** True ⇒ salted with the datafile experiment id, i.e. SDK-identical. */
  sdkIdentical: boolean;
  slotId: string;
  /**
   * Which path produced the arm.
   *   'sdk'  — the real Optimizely SDK (lite/edge build) decided it.
   *   'hash' — the degraded path: the SDK's own bucketing arithmetic, run here.
   * Reported verbatim by /live/api/experiment/status so a presenter is never
   * guessing which one the room is looking at.
   */
  source: 'sdk' | 'hash';
  /** Rule the SDK served the decision from — proof it came off the real rule. */
  ruleKey?: string | null;
}

/**
 * THE SEAM. Pure, synchronous, and the only thing a caller needs.
 *
 * Same visitor ⇒ same arm, forever, with no storage and no sticky cookie: the
 * hash IS the memory. Pass the ids when they are known (the row stamp and the
 * conversion need the platform's numbers); omit them and you still get a stable
 * arm, which is what keeps the page working before anything is launched.
 */
export function chooseFraming(visitorId: string, ids?: BhExperimentIds | null): BhAssignment {
  const datafile = ids?.datafile ?? null;
  const salt = datafile?.experimentId ?? BH_RULE_KEY;
  const bucket = bucketValue(visitorId, salt);

  const allocation = datafile?.trafficAllocation?.length
    ? datafile.trafficAllocation
    : defaultAllocation();
  const entity = entityForBucket(bucket, allocation);

  // With a datafile the entity is a variation ID; without one it is already the
  // key (defaultAllocation names the keys). Resolve both to a key.
  let variationKey: BhVariationKey = BH_VARIATION_KEYS[0];
  if (entity) {
    const byId = datafile
      ? Object.entries(datafile.variationIds).find(([, id]) => id === entity)?.[0]
      : undefined;
    const candidate = (byId ?? entity) as BhVariationKey;
    if (BH_VARIATION_KEYS.includes(candidate)) variationKey = candidate;
  }

  return {
    launched: Boolean(ids && datafile),
    experimentKey: BH_RULE_KEY,
    flagKey: BH_FLAG_KEY,
    variationKey,
    framing: BH_FRAMINGS[variationKey],
    experimentId: datafile?.experimentId ?? null,
    variationId: datafile?.variationIds?.[variationKey] ?? null,
    campaignId: datafile?.campaignId ?? null,
    bucket,
    bucketedOn: salt,
    sdkIdentical: Boolean(datafile?.experimentId),
    slotId: BH_EXPERIMENT_SLOT,
    source: 'hash',
  };
}

/**
 * Impression bookkeeping: the SDK mints a decision event on `decide()`, and the
 * Bright Hour page recomposes on a timer — so an unguarded decide would post one
 * impression per poll and drown the results page in noise. First decide per
 * visitor per isolate sends the impression; every later one is a silent read.
 */
const IMPRESSED = new Set<string>();
const IMPRESSED_MAX = 5000;

/**
 * ONE Optimizely client per isolate, not one per request.
 *
 * `OptimizelyService.initialize()` parses the whole datafile and builds a client;
 * doing that per page compose is precisely the single-threaded cost that wedged
 * this worker once already (see the burst-ingestion note in routes/live.ts). The
 * instance memoizes its own client, so reusing it makes the decide a lookup.
 * Rebuilt every 60s so a republished datafile is picked up within a beat.
 */
const SDK_TTL_MS = 60_000;
let _sdk: { at: number; svc: { decide: OptimizelyDecide } | null } | null = null;

type OptimizelyDecide = (
  flagKey: string,
  userId: string,
  attrs?: Record<string, string | number | boolean>,
  sendImpression?: boolean
) => Promise<{ variationKey: string | null; ruleKey: string | null } | null>;

async function sdkClient(env: BhExperimentEnv): Promise<{ decide: OptimizelyDecide } | null> {
  if (_sdk && Date.now() - _sdk.at < SDK_TTL_MS) return _sdk.svc;
  try {
    const { OptimizelyService } = await import('@/services/OptimizelyService');
    const svc = new OptimizelyService(env as unknown as Env) as unknown as { decide: OptimizelyDecide };
    _sdk = { at: Date.now(), svc };
    return svc;
  } catch {
    _sdk = { at: Date.now(), svc: null };
    return null;
  }
}

/** Drop the memoized client — used after a launch republishes the datafile. */
export function clearBhSdkMemo(): void {
  _sdk = null;
}

function firstImpressionFor(visitorId: string): boolean {
  if (IMPRESSED.has(visitorId)) return false;
  if (IMPRESSED.size >= IMPRESSED_MAX) IMPRESSED.clear();
  IMPRESSED.add(visitorId);
  return true;
}

/**
 * THE SHIPPED ASSIGNMENT PATH.
 *
 * 1. Ask the REAL Optimizely SDK. `OptimizelyService` now loads the lite/edge
 *    build against the KV-cached datafile, so `decide()` genuinely runs the
 *    platform's bucketer over the platform's published traffic allocation, and
 *    hands back the rule key it served from.
 * 2. If the SDK cannot answer — no SDK key, datafile not yet published with our
 *    rule, mock fallback in force — drop to `chooseFraming`, which is the SDK's
 *    OWN arithmetic (murmurhash3 seed 1 over visitorId+experimentId, resolved
 *    against the datafile's trafficAllocation) executed locally. Verified
 *    identical to the SDK over 1,000 visitors in experiment.test.ts.
 *
 * Both paths are labeled in `source`. Neither one invents a variation.
 */
export async function getAssignment(
  env: BhExperimentEnv,
  visitorId: string
): Promise<BhAssignment> {
  const ids = await getBhExperimentIds(env);
  const fallback = chooseFraming(visitorId, ids);
  if (!ids?.datafile) return fallback;

  try {
    const svc = await sdkClient(env);
    if (!svc) return fallback;
    const decision = await svc.decide(BH_FLAG_KEY, visitorId, {}, firstImpressionFor(visitorId));
    const key = decision?.variationKey as BhVariationKey | undefined;
    // Only trust a decision that came off OUR rule with one of OUR arms — a
    // rollout default or a renamed variation must fall through, not be adopted.
    if (!key || !BH_VARIATION_KEYS.includes(key) || decision?.ruleKey !== BH_RULE_KEY) {
      return fallback;
    }
    return {
      ...fallback,
      variationKey: key,
      framing: BH_FRAMINGS[key],
      variationId: ids.datafile.variationIds?.[key] ?? null,
      source: 'sdk',
      ruleKey: decision.ruleKey ?? null,
    };
  } catch {
    return fallback;
  }
}

// ── Stamping the decision row ────────────────────────────────────────────────

/** The three columns Beat 13 fills in — nothing else in the row moves. */
export interface StampableRow {
  slot_id: string;
  experiment_id: string | null;
  variation_id: string | null;
  campaign_id: string | null;
}

/**
 * Stamp the assignment onto the row for the slot under test, IN PLACE.
 *
 * Only `daily_deal` is stamped. Every other slot keeps its null columns because
 * no experiment governs it — an export that claimed otherwise would be telling
 * the customer's analysts a story their own SQL would later contradict.
 * Returns how many rows were stamped, so a caller can assert on it.
 */
export function stampExperiment<T extends StampableRow>(
  rows: readonly T[],
  assignment: BhAssignment | null | undefined
): number {
  if (!assignment?.launched || !assignment.experimentId) return 0;
  let stamped = 0;
  for (const row of rows) {
    if (row.slot_id !== assignment.slotId) continue;
    row.experiment_id = assignment.experimentId;
    row.variation_id = assignment.variationId;
    row.campaign_id = assignment.campaignId;
    stamped += 1;
  }
  return stamped;
}

// ── REST plumbing (mirrors experimentFx.ts's private helper) ─────────────────

interface ApiResult {
  status: number;
  ok: boolean;
  json: any;
}

async function api(
  cfg: FxConfig,
  method: string,
  url: string,
  body?: unknown
): Promise<ApiResult> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, ok: res.ok, json };
}

/**
 * Ensure the `bh_offer_click` custom event exists and hand back its id.
 *
 * Verbatim the experimentFx.ts ladder, which was proven live in June: LIST to
 * reuse (custom events surface on /v2/events; GET on /custom_events is 405),
 * POST to create, and — the bulletproof leg — scrape the id out of the duplicate
 * -key 400, because that error carries it.
 */
async function ensureBhEvent(cfg: FxConfig): Promise<{ id: number | null; diag: unknown }> {
  const list = await api(cfg, 'GET', `${ADMIN}/events?project_id=${cfg.projectId}&per_page=200`);
  const items: any[] = Array.isArray(list.json) ? list.json : list.json?.items || [];
  const found = items.find((e) => e && (e.key === BH_EVENT_KEY || e.api_name === BH_EVENT_KEY));
  if (found?.id) return { id: found.id, diag: { reused: true } };

  const created = await api(cfg, 'POST', `${ADMIN}/projects/${cfg.projectId}/custom_events`, {
    key: BH_EVENT_KEY,
    name: 'Bright Hour — offer click',
    description: "Click on the slot-2 offer (Today's Bright One). Beat 13 conversion metric.",
    archived: false,
  });
  if (created.ok && created.json?.id) return { id: created.json.id, diag: { created: true } };

  const dup = JSON.stringify(created.json || '').match(/id:\s*(\d+)/);
  if (dup) return { id: Number(dup[1]), diag: { reusedFromDuplicate: true } };
  return { id: null, diag: { listStatus: list.status, createStatus: created.status, createBody: created.json } };
}

function rulesetUrl(cfg: FxConfig, env: string): string {
  return `${FLAGS}/projects/${cfg.projectId}/flags/${BH_FLAG_KEY}/environments/${env}/ruleset`;
}

/** The FX app deep-links a presenter opens. */
export function presenterUrls(projectId: string, environment: string): {
  presenterUrl: string;
  resultsUrl: string;
} {
  const base = `https://app.optimizely.com/v2/projects/${projectId}/flags/manage/${BH_FLAG_KEY}`;
  return {
    presenterUrl: `${base}/rules/${environment}`,
    resultsUrl: `${base}/rules/${environment}/rule/${BH_RULE_KEY}/results`,
  };
}

// ── Reading the ids back out of the published datafile ───────────────────────

function datafileUrl(env: BhExperimentEnv): string | null {
  if (env.OPTIMIZELY_DATAFILE_URL) return env.OPTIMIZELY_DATAFILE_URL;
  if (env.OPTIMIZELY_SDK_KEY) return `https://cdn.optimizely.com/datafiles/${env.OPTIMIZELY_SDK_KEY}.json`;
  return null;
}

/**
 * Read the platform's OWN ids for our rule out of the published datafile.
 *
 * This is the step that makes `experiment_id` in an export row defensible: the
 * value is the id Optimizely minted and publishes to every SDK on earth, not a
 * flag id we relabelled. Returns null while the CDN is still catching up —
 * publication lags a ruleset PATCH by seconds — and the launch simply reports
 * that, rather than inventing a number.
 */
export async function readDatafileIds(env: BhExperimentEnv): Promise<BhDatafileIds | null> {
  const url = datafileUrl(env);
  if (!url) return null;
  // NOT `cache: 'no-store'` — workerd does not implement that RequestInit field
  // and throws on it. The Cloudflare-native bypass is the cf hints plus the
  // no-cache header (the same trick OptimizelyService.createFreshClient uses).
  const res = await fetch(`${url}?cb=${Date.now()}`, {
    headers: { 'Cache-Control': 'no-cache' },
    cf: { cacheTtl: 0, cacheEverything: false },
  } as RequestInit);
  if (!res.ok) return null;
  const df = (await res.json()) as any;

  const experiment = (df?.experiments || []).find((e: any) => e?.key === BH_RULE_KEY);
  if (!experiment?.id) return null;

  const variationIds: Record<string, string> = {};
  for (const v of experiment.variations || []) if (v?.key && v?.id) variationIds[v.key] = String(v.id);

  const event = (df?.events || []).find((e: any) => e?.key === BH_EVENT_KEY);

  return {
    experimentId: String(experiment.id),
    campaignId: String(experiment.layerId ?? ''),
    variationIds,
    trafficAllocation: (experiment.trafficAllocation || []).map((t: any) => ({
      entityId: String(t.entityId),
      endOfRange: Number(t.endOfRange),
    })),
    eventEntityId: event?.id ? String(event.id) : null,
    accountId: String(df?.accountId ?? env.OPTIMIZELY_ACCOUNT_ID ?? ''),
    revision: String(df?.revision ?? ''),
    readAt: Date.now(),
  };
}

// ── Launch ───────────────────────────────────────────────────────────────────

export interface BhLaunchResult {
  ok: boolean;
  /** True ⇒ nothing was written; the stored ids were handed back verbatim. */
  reused: boolean;
  ids: BhExperimentIds | null;
  error?: string;
  diagnostics?: unknown;
}

/**
 * Create the Beat 13 experiment on the real project. IDEMPOTENT twice over:
 * KV short-circuits a second call, and every underlying primitive
 * (ensureFlag / ensureVariations / the ruleset GET before PATCH) reuses rather
 * than duplicates — so even a cold isolate with an empty KV converges on the
 * same artifact instead of a second one.
 *
 * `force: true` re-runs the ensure ladder against the platform (used to refresh
 * the datafile ids after publication) without ever creating a second rule.
 */
export async function launchBhExperiment(
  env: BhExperimentEnv,
  opts: { force?: boolean } = {}
): Promise<BhLaunchResult> {
  const existing = await getBhExperimentIds(env);
  if (existing && !opts.force) {
    // Ids exist but the datafile had not published yet — top them up cheaply,
    // still without touching the platform's write surface.
    if (!existing.datafile) {
      const datafile = await readDatafileIds(env).catch(() => null);
      if (datafile) {
        const refreshed = { ...existing, datafile };
        await saveBhExperimentIds(env, refreshed);
        return { ok: true, reused: true, ids: refreshed };
      }
    }
    return { ok: true, reused: true, ids: existing };
  }

  const cfg: FxConfig = {
    token: String(env.OPTIMIZELY_API_TOKEN ?? ''),
    projectId: String(env.OPTIMIZELY_PROJECT_ID ?? ''),
    environment: env.OPTIMIZELY_ENVIRONMENT || 'development',
    sdkKey: env.OPTIMIZELY_SDK_KEY,
  };
  const environment = cfg.environment as string;

  // 1) The flag. Its variables are what a storefront reads to render the arm.
  const flag = await ensureFlag(cfg, {
    key: BH_FLAG_KEY,
    name: 'Bright Hour — offer framing',
    description:
      "Beat 13. Slot 2 (Today's Bright One) sells the same offer in two vocabularies: time language vs value language. Owner: Bright Hour demo (bh_).",
    variable_definitions: {
      framing: {
        key: 'framing',
        type: 'string',
        default_value: 'time',
        description: 'Vocabulary for the slot-2 offer chip: time | value.',
      },
      badge_override: {
        key: 'badge_override',
        type: 'string',
        default_value: '',
        description: 'Copy that replaces the computed window language (value arm only).',
      },
    },
  });

  // 2) Two variations. Control first — index 0 is the baseline.
  const flagVariationIds = await ensureVariations(
    cfg,
    BH_FLAG_KEY,
    BH_VARIATION_KEYS.map((key) => ({
      key,
      name: BH_FRAMINGS[key].label,
      variables: {
        framing: { value: BH_FRAMINGS[key].style },
        badge_override: { value: key === 'value_language' ? BH_FRAMINGS[key].fallbackBadge : '' },
      },
    }))
  );

  // 3) The metric event. An FX experiment rule needs ≥1 metric.
  const event = await ensureBhEvent(cfg);

  // 4) The a/b rule at 50/50. A/B rather than MAB or CMAB deliberately: the
  //    dossier §5 records that the CMAB results page is still "in development",
  //    and a beat whose whole point is "open the real product and look" cannot
  //    rest on a readout that does not render yet.
  let ruleCreated = false;
  let diagnostics: unknown;
  const ruleset = await api(cfg, 'GET', rulesetUrl(cfg, environment));
  if (ruleset.json?.rules?.[BH_RULE_KEY]) {
    ruleCreated = true;
  } else {
    const metric = event.id
      ? {
          event_id: Number(event.id),
          event_type: 'custom',
          scope: 'visitor',
          aggregator: 'unique',
          winning_direction: 'increasing',
          display_title: 'Offer click',
        }
      : { aggregator: 'sum', field: 'revenue', scope: 'visitor', winning_direction: 'increasing' };

    const patch = [
      {
        op: 'add',
        path: `/rules/${BH_RULE_KEY}`,
        value: {
          key: BH_RULE_KEY,
          name: 'Bright Hour — offer framing (A/B)',
          type: 'a/b',
          distribution_mode: 'manual',
          percentage_included: 10000,
          audience_conditions: [],
          variations: {
            [BH_VARIATION_KEYS[0]]: {
              key: BH_VARIATION_KEYS[0],
              name: BH_FRAMINGS[BH_VARIATION_KEYS[0]].label,
              percentage_included: 5000,
            },
            [BH_VARIATION_KEYS[1]]: {
              key: BH_VARIATION_KEYS[1],
              name: BH_FRAMINGS[BH_VARIATION_KEYS[1]].label,
              percentage_included: 5000,
            },
          },
          metrics: [metric],
        },
      },
      { op: 'add', path: '/rule_priorities/-', value: BH_RULE_KEY },
    ];
    const patched = await api(cfg, 'PATCH', rulesetUrl(cfg, environment), patch);
    ruleCreated = patched.ok;
    if (!patched.ok) {
      // No silent fallback to targeted_delivery here: a targeted delivery is not
      // an experiment, and Beat 13 would then be showing the room something that
      // is not what the line claims. Fail loudly and let the runbook skip it.
      return {
        ok: false,
        reused: false,
        ids: null,
        error: `ruleset PATCH rejected: ${patched.status} ${JSON.stringify(patched.json)}`,
        diagnostics: { metricEvent: event.diag, flagId: flag?.id },
      };
    }
  }

  // 5) Live in the environment (flag-on, then rule-on). Two calls, always.
  let enabled = true;
  try {
    await enableLive(cfg, BH_FLAG_KEY, environment, BH_RULE_KEY);
  } catch (e) {
    enabled = false;
    diagnostics = { enableError: e instanceof Error ? e.message : String(e) };
  }

  // 6) The platform's own ids, read back from the datafile it publishes.
  const datafile = await readDatafileIds(env).catch(() => null);

  // 7) Point the SDK at the datafile that now contains this rule. Without this,
  //    OptimizelyService keeps serving its KV-cached copy (300s) and `decide()`
  //    would answer from a datafile that predates the launch — so the presenter
  //    would see the hash path for five minutes after a live launch.
  if (datafile) {
    try {
      const { OptimizelyService } = await import('@/services/OptimizelyService');
      await new OptimizelyService(env as unknown as Env).refreshDatafileCache();
    } catch {
      /* the SDK path simply stays on its cached datafile; the hash path covers it */
    }
    clearBhSdkMemo();
  }

  const ids: BhExperimentIds = {
    flagKey: BH_FLAG_KEY,
    flagId: typeof flag?.id === 'number' ? flag.id : null,
    ruleKey: BH_RULE_KEY,
    environment,
    projectId: cfg.projectId,
    eventKey: BH_EVENT_KEY,
    eventId: event.id,
    flagVariationIds,
    datafile,
    createdAt: Date.now(),
    ruleCreated,
    enabled,
    ...presenterUrls(cfg.projectId, environment),
  };
  await saveBhExperimentIds(env, ids);
  return { ok: true, reused: false, ids, diagnostics };
}

// ── Conversion (the Optimizely Event API — logx) ─────────────────────────────

/**
 * Post a `bh_offer_click` conversion for this visitor, attributed to the arm
 * they were bucketed into.
 *
 * `enrich_decisions: true` is what makes an unattached decision block count:
 * Optimizely attributes the event to the campaign/experiment/variation triple we
 * hand it, which is exactly the triple already stamped into the export row. One
 * fetch, fire-and-forget, and a no-op unless the experiment has really launched
 * — so this can sit on the ingestion path without ever being able to slow or
 * break it.
 */
export async function trackBhOfferClick(
  env: BhExperimentEnv,
  visitorId: string,
  assignment: BhAssignment,
  extra: { itemId?: string | null; action?: string | null; timestamp?: number } = {}
): Promise<{ sent: boolean; status?: number; reason?: string }> {
  const ids = await getBhExperimentIds(env);
  const datafile = ids?.datafile;
  if (!assignment.launched || !datafile?.eventEntityId || !assignment.variationId) {
    return { sent: false, reason: 'experiment not published (no datafile event/variation id)' };
  }
  const accountId = datafile.accountId || String(env.OPTIMIZELY_ACCOUNT_ID ?? '');
  if (!accountId) return { sent: false, reason: 'no account id' };

  const timestamp = extra.timestamp ?? Date.now();
  const payload = {
    account_id: accountId,
    anonymize_ip: true,
    client_name: 'brighthour-edge',
    client_version: '1.0.0',
    enrich_decisions: true,
    visitors: [
      {
        visitor_id: visitorId,
        attributes: [],
        snapshots: [
          {
            decisions: [
              {
                campaign_id: assignment.campaignId,
                experiment_id: assignment.experimentId,
                variation_id: assignment.variationId,
              },
            ],
            events: [
              {
                entity_id: datafile.eventEntityId,
                key: BH_EVENT_KEY,
                timestamp,
                uuid: crypto.randomUUID(),
                tags: {
                  slot_id: assignment.slotId,
                  ...(extra.itemId ? { item_id: extra.itemId } : {}),
                  ...(extra.action ? { action: extra.action } : {}),
                },
              },
            ],
          },
        ],
      },
    ],
  };

  try {
    const res = await fetch(EVENT_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { sent: res.ok, status: res.status };
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
