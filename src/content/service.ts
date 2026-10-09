// src/content/service.ts
// The decision service: everything decide.ts needs, resolved from where it lives,
// with strict owned consent before profile computation or measurement. Cold
// decisions do not create behavior; only necessary refusal records may be
// persisted here. Owned state failures are terminal, never consenting defaults.

import type { Env } from '@/types/env';
import { assertOwnerScope, currentOwnerConsent, pinRetention, pinProfileRetention, requireConsentPurpose, ownerBindingIdentity } from '@/identity/sessionAuthority';
import { assertSessionTarget, SessionAccessError, SHOPPER_HEADER, type SessionCapability } from '@/identity/sessionCapability';
import { carriedSaltVersion, PublicationError, pinPublication, readPinnedPublication, readPublication } from '@/config/publication';
import { resolveTenantReflexConfigRevision } from '@/demos/registry';
import { ReflexConfigUnavailableError } from '@/reflex/configStore';
import { snapshot as reflexSnapshot, type AffinitySnapshot, type CatalogVocabulary, type ReflexConfig } from '@/reflex/core';
import { SessionManager } from '@/services/SessionManager';
import {
  journeyCountersNow, journeySource as journeySourceOf, journeyStageFrom, journeyThresholdsInForce,
  journeyWordOf, PERSISTED_STAGE, type JourneyWord,
} from '@/services/JourneyStage';
import { projectVisit, validEntry, validVisitContext, entryChannelOf, type ChannelSignals, type VisitContext } from '@/services/visit';
import { platformWordOf, type PlatformWord } from '@/services/platform';
import { DEFAULT_TENANT, type TenantId } from '@/tenancy/tenant';
import { shopperObject } from '@/tenancy/objects';
import { CONTENT_KIND, DEFAULT_LEARN, EMPTY_CATALOG, LEARN_KIND, pageScopedSlotNames, SLOTS_KIND } from './kinds';
import { enrollmentAnchorOf, enrollmentFor, ineligibleEnrollment, recordAnchorUnavailable } from './holdout';
import { cellFor, type CfLike } from './cell';
import { armUnder, consentOf, consentFromCookies, refusalHints, intersectConsent, storedConsent, personalizes, type Consent } from './consent';
import { decideContent, layoutBlendOf } from './decide';
import { blendAffinity, lambdaFor, readTrend, regionKeyOf, sharesWithin } from '@/reflex/regionTrend';
import { currentLiftWitness, fanDecisions, identityPage, liftKey, readRing, reportLearningIncomplete, servedCounts, type SlotLearnConfig } from '@/learn/fan';
import { recordSlotGovernance } from '@/learn/slotGovernance';
import { EXTERNAL_POLICY_REASON, externalModelPolicy } from '@/learn/external';
import { DEFAULT_STATS, type LiftSnapshot } from '@/learn/stats';
import type { ExternalTerm } from './types';
import type { ContentDecisionSet, ContentPiece, EnrollmentProvenance, HoldoutConfig, LayoutDiagnostic, SlotCatalog } from './types';
import { captureRetention, RetentionUnavailable } from '@/retention';
import { recoverDecisions, recoveryDigest } from '@/ledger/recovery';
import { createRenderOffer } from './renderOffer';
import { syntheticOperation } from '@/ops/synthetic';

export interface ServeRequest {
  /** Public snapshots are offers. Only a subsequent authenticated render may capture them. */
  offer?: { pageInstance?: string };
  tenant: string;
  brand?: string;
  page: string;
  visitorId: string;
  cookieHeader: string | null;
  /** Explicit false-only withdrawal hints; true never upgrades stored consent. */
  consent?: Partial<Consent>;
  /** The client's browsing session, when the SDK sends one: what the decision's session_id carries, so an outcome from the same client compares equal. */
  sessionId?: string | null;
  /** Non-authoritative event/decision attribution; never passed to profile lookup. */
  browsingSessionId?: string | null;
  cf?: CfLike | null;
  channel?: string | null;
  /**
   * Named conditions the caller asserts are true for this request — Garrett's
   * weather, and the same door for device, campaign or customer type. They gate
   * pieces that carry a matching `eligibleWhen` rule and nothing else: a signal
   * here can never boost, re-rank or become behavioural evidence.
   */
  context?: Readonly<Record<string, string>>;
  /** Observed arrival context, not an override of an established visit entry. */
  entry?: ChannelSignals;
  /** The OS family the request reports (src/services/platform.ts), for `platform` seed rules: the OS family is read from the request; the fired seed (ios or android) is recorded on the receipt as a driver; nothing finer is read or kept. */
  platform?: PlatformWord | null;
  nowMs?: number;
  /** The brand whose shopper state this request reads, as the tenancy middleware resolved it. */
  stateTenant?: TenantId;
  /** Verified public caller context; unsigned callers may request only state-free refused defaults. */
  principal?: SessionCapability;
  capability?: string;
  /**
   * W20 G2 (R94(1)): the platform composing this page to check ITSELF, not a
   * shopper being served. The engine's own self-check composes the tenant's real
   * page, so its refusals would otherwise land in the operator's governance
   * counters and report the probe's configuration back as the tenant's serving.
   * A caller declares it; the flag is general, names no visitor, channel or id,
   * and changes nothing else about the decision. Ordinary callers never set it.
   */
  selfCheck?: boolean;
}

/** Where each input came from, so a reader can tell a tuned scope from a compiled default. */
/** KV/cache supplies immutable estimates; the object supplies current health/generation. */
const LIFT_TTL_MS = 60_000;
/** The serving read's own limit on one stored snapshot's UTF-8 bytes. */
const LIFT_SNAPSHOT_MAX_BYTES = 2 * 1024 * 1024;
/** At most this many snapshots are held by one isolate, whatever their size. */
export const LIFT_CACHE_MAX_ENTRIES = 256;
/**
 * W38 B1 (F32 §4.4, document 35 §6 "bound … cache"): at most this many bytes of
 * snapshot text are held by one isolate, however few entries they make.
 *
 * The entry cap alone bounds nothing about memory: 256 snapshots at the read's
 * own 2 MiB limit are 512 MiB of text in a 128 MB isolate (F32 §1.5). The byte
 * cap admits four snapshots at that limit, or a dozen at the statistics object's
 * own counter caps (about 680 KB each), and is the same order as the
 * publication cache beside it (8 MiB, src/config/publication.ts). It is charged
 * with the UTF-8 bytes each snapshot was read as, which is what the serving
 * read's own limit counts; the oldest entries are evicted first, so a byte cap
 * bounds the cache without disabling it.
 */
export const LIFT_CACHE_MAX_BYTES = 8 * 1024 * 1024;
interface LiftEntry {
  binding: Env['CACHE']; stats: Env['LEARN_STATS']; key: string; at: number; value: LiftSnapshot | null; bytes: number;
  /**
   * W38 B7: the digest of the snapshot this entry holds, computed at most once
   * per entry and never inside the witness's 50 ms budget.
   */
  digest?: Promise<string>;
}
const liftCache = new Set<LiftEntry>();
let liftCacheBytes = 0;
function forgetLift(entry: LiftEntry): void { if (liftCache.delete(entry)) liftCacheBytes -= entry.bytes; }
export function invalidateLiftCache(): void { liftCache.clear(); liftCacheBytes = 0; }
/**
 * W38 B7 (amendment A36): the witness compares the statistics object's
 * published digest with the digest of the snapshot this isolate holds. Digesting
 * a large snapshot is this reader's own work, so it is done once per cached
 * entry, before the witness's 50 ms round-trip budget starts, and a cached read
 * reuses it. A failure to digest is a failed witness: no lift, never an error.
 */
function liftDigest(entry: LiftEntry): Promise<string> {
  entry.digest ??= recoveryDigest(entry.value);
  return entry.digest;
}
/**
 * The lift snapshot in force for one placement. W26 R2: `page` is passed only
 * for a page-scoped slot name (`identityPage`), and then the snapshot, its
 * isolate cache entry and its live witness are that page's own.
 */
export async function readLift(env: Pick<Env, 'CACHE' | 'LEARN_STATS'>, tenant: string, brand: string, slot: string, now: number, config: SlotLearnConfig, page?: string): Promise<LiftSnapshot | null> {
  const compatible = (value: LiftSnapshot | null) => value !== null && typeof value === 'object' && !Array.isArray(value)
    && value.tenant === tenant && value.brand === brand && value.slot === slot && value.reward === config.reward
    && (value.measurementBasis ?? 'served-v1') === (config.measurementBasis ?? 'served-v1')
    && (value.objective === undefined ? 'unit' : value.objective) === (config.objective ?? 'unit') && value.tauLearnMs === config.stats.tauLearnMs
    && value.n0 === config.stats.n0 && value.nMin === config.stats.nMin
    && value.liftMin === config.stats.liftMin && value.liftMax === config.stats.liftMax;
  const key = liftKey(tenant, brand, slot, page);
  const binding = ownerBindingIdentity(env.CACHE), stats = ownerBindingIdentity(env.LEARN_STATS);
  const resident = () => [...liftCache].find(e => e.binding === binding && e.stats === stats && e.key === key);
  const hit = resident();
  if (hit && now >= hit.at && now - hit.at < LIFT_TTL_MS) {
    return compatible(hit.value) && await currentLiftWitness(env, tenant, brand, slot, hit.value!, page, () => liftDigest(hit)) ? hit.value : null;
  }
  let value: LiftSnapshot | null = null, bytes = 0;
  try {
    const stream = await env.CACHE.get(key, 'stream');
    if (stream) {
      const reader = stream.getReader(), decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
      let size = 0, raw = '';
      try { for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
        if (size > LIFT_SNAPSHOT_MAX_BYTES) { await reader.cancel(); throw new Error('Snapshot capacity'); }
        raw += decoder.decode(next.value, { stream: true }); } raw += decoder.decode(); }
      finally { reader.releaseLock(); }
      value = JSON.parse(raw) as LiftSnapshot; bytes = size;
    }
  } catch { value = null; bytes = 0; }
  // One entry per placement: whatever another request stored for it while this
  // one read is replaced, so no snapshot is ever charged to the cache twice.
  for (let stale = resident(); stale; stale = resident()) forgetLift(stale);
  const entry: LiftEntry = { binding, stats, key, at: now, value, bytes };
  if (bytes <= LIFT_CACHE_MAX_BYTES) {
    while (liftCache.size && (liftCache.size >= LIFT_CACHE_MAX_ENTRIES || liftCacheBytes + bytes > LIFT_CACHE_MAX_BYTES)) forgetLift(liftCache.values().next().value!);
    liftCache.add(entry); liftCacheBytes += bytes;
  }
  // Cache the raw snapshot, never one request's compatibility verdict.
  return compatible(value) && await currentLiftWitness(env, tenant, brand, slot, value!, page, () => liftDigest(entry)) ? value : null;
}

/** What each slot learns against: its reward and the estimator's constants, from the learn document. */
export function slotLearnConfigOf(learn: { stats?: SlotLearnConfig['stats']; slots?: Record<string, { reward?: SlotLearnConfig['reward']; measurementBasis?: SlotLearnConfig['measurementBasis'] }> }): (slot: string) => SlotLearnConfig {
  const stats = learn.stats ?? DEFAULT_STATS;
  return (slot) => ({ reward: learn.slots?.[slot]?.reward ?? 'click', stats, measurementBasis: learn.slots?.[slot]?.measurementBasis ?? 'served-v1', objective: (learn.slots?.[slot] as { objective?: 'unit' | 'revenue' | 'margin' } | undefined)?.objective ?? 'unit' });
}

export interface DecisionSources {
  catalog: { version: string | null; revision: number; pieces: number };
  slots: { version: string | null; revision: number; count: number };
  learn: { version: string | null; revision: number };
  config: { label: string; revision: number };
  /**
   * W16 C4 (R32(1)): the journey threshold set this decision derived its stage
   * from. The version IS the reflex document's own revision identity, because
   * the thresholds ride that document; `reason` says why none was in force when
   * the engine fell closed to the first stage of the journey.
   */
  journey: { version: string | null; revision: number; reason: string | null };
  /** Phase 3 (doc 22 §9): their model's answer for this page, when a slot on it weights one. */
  external: { kind: string; ref: string; ok: boolean; ms: number; version: string | null; reason: string | null } | null;
  state: 'do' | 'session' | 'none';
  /**
   * W16 R5 (LANE-LOG R19, R98(b)): present, as `'unreadable'`, only when her
   * stored record exists but cannot be read out under the retention policy in
   * force, so she was served the site's default decision. Absent otherwise: a
   * refusal is named by `consent`, and an expired session gets no decision.
   */
  record?: 'unreadable';
  /** CW31: the shopper's consent switches as the host reported them, and whether the engine personalized at all. */
  consent: Consent & { personalized: boolean };
  /** Milliseconds per stage of this decision: documents, shopper, trend, lift, decide. */
  timings: Record<string, number>;
}

interface ShopperRead {
  affinity: AffinitySnapshot | null;
  sessionId: string | null;
  isNewSession: boolean | null;
  state: DecisionSources['state'];
  /**
   * W16 C4 (R29): the journey stage of the shopper's CURRENT VISIT in the shared
   * vocabulary, as whichever host holds the counters reports it; null when the
   * shopper is not personalized. The persisted cell token is derived from it at
   * the one mapping point, never stored a second way.
   */
  stage: JourneyWord | null;
  /** CW31: the shopper's two consent switches, from whichever host holds them; a host that says nothing is consenting. */
  consent: Consent;
  visit?: VisitContext | null;
  lastSeen?: number | null;
  /**
   * W16 R5 (LANE-LOG R19, R98(b)): her stored record exists but cannot be read
   * out — the retained-data authority its profile stamp was born under is no
   * longer the one in force (`requireRetention`). Nothing of the record is
   * carried (no affinity, stage or visit), and the decision serves the site's
   * default, naming why. Distinct from a refusal (her own choice) and from an
   * expired session (no answer at all).
   */
  unreadable?: true;
}

/** Her record could not be read out: the answer carries nothing of it (W16 R5). */
const unreadableShopper = (sessionId: string, state: DecisionSources['state'], consent: Consent): ShopperRead =>
  ({ affinity: null, sessionId, isNewSession: null, state, stage: null, consent, visit: null, lastSeen: null, unreadable: true });

/**
 * One owned read, with necessary refusal persistence before any profile view.
 * No cookie/user pointer, session creation, visit advancement or silent fallback.
 */
async function readShopper(
  env: Env, visitorId: string, hints: Consent, cfg: ReflexConfig | null, now: number, tenant: TenantId,
  principal: SessionCapability,
  capability?: string,
): Promise<ShopperRead> {
  if ((env.REFLEX_HOST ?? 'session') === 'do') {
    try {
      // The brand's object for this visitor; the default brand keeps the bare name.
      const stub = shopperObject(env.SHOPPER_REFLEX, visitorId, tenant);
      if (!capability) throw new SessionAccessError();
      const headers = { [SHOPPER_HEADER]: capability, 'X-Tenant': tenant, Cookie: [
        ...(!hints.tracking ? ['opt_tracking_consent=false'] : []),
        ...(!hints.personalization ? ['opt_personalization_enabled=false'] : []),
      ].join('; ') };
      const res = await stub.fetch('https://shopper-reflex/snapshot?projection=content', { headers });
      if (!res.ok) throw new SessionAccessError();
      const body = (await res.json()) as { ok?: boolean; affinity?: AffinitySnapshot | null; journeyStage?: string | null; consent?: unknown; visit?: VisitContext & { lastSeen?: number }; record?: unknown };
      if (!body || body.ok !== true || body.consent === undefined) throw new SessionAccessError();
      // W16 R5: the object answered that her record cannot be read out. Only a
      // consenting shopper's record is ever read, so only she can be told so; a
      // refusal is answered as the refusal it is.
      if (body.record !== undefined) {
        const consent = intersectConsent(storedConsent(body.consent), hints);
        if (body.record !== 'unreadable' || body.affinity != null || body.journeyStage != null || body.visit != null) throw new SessionAccessError();
        if (personalizes(consent)) return unreadableShopper(principal.sessionId, 'do', consent);
      }
      if (body.visit != null && (!validVisitContext(body.visit) || (body.visit.lastSeen !== undefined
        && (typeof body.visit.lastSeen !== 'number' || !Number.isFinite(body.visit.lastSeen) || body.visit.lastSeen < 0)))) throw new SessionAccessError();
      const consent = intersectConsent(storedConsent(body.consent), hints);
      return { affinity: personalizes(consent) ? body.affinity ?? null : null, sessionId: principal.sessionId, isNewSession: null, state: 'do',
        stage: personalizes(consent) ? journeyWordOf(body.journeyStage) : null, consent,
        visit: personalizes(consent) ? body.visit : null, lastSeen: personalizes(consent) ? body.visit?.lastSeen : null };
    } catch {
      throw new SessionAccessError();
    }
  }
  try {
    const manager = new SessionManager(env, { tenant, principal });
    const sessionId = principal.sessionId;
    const sessionData = await manager.readRaw(sessionId, true);
    const consent = intersectConsent(await currentOwnerConsent() ?? consentOf(sessionData), hints);
    if (!personalizes(consent)) await manager.restrictConsent(sessionId, consent, { sessionId, data: sessionData });
    if (personalizes(consent) && sessionData) {
      // W16 R5: a record whose profile stamp the authority in force no longer
      // honours is not read out, and refusing to SERVE her page is not a
      // retention remedy: she is served the site's default, named unreadable.
      try { pinProfileRetention(env, sessionData, tenant); }
      catch (error) {
        if (!(error instanceof RetentionUnavailable)) throw error;
        return unreadableShopper(sessionId, 'session', consent);
      }
    }
    if (personalizes(consent) && !cfg) throw new ReflexConfigUnavailableError(tenant);
    return {
      affinity: personalizes(consent) && sessionData?.reflex && cfg ? reflexSnapshot(sessionData.reflex, now, cfg) : null,
      sessionId, isNewSession: null, state: 'session',
      // W16 C4: the same derivation the session host's own hydrate answers with
      // — this visit's counters against the published journey thresholds.
      stage: personalizes(consent) && cfg
        ? journeyStageFrom(journeyCountersNow(sessionData?.journey, sessionData?.metadata.lastSeen, now), journeyThresholdsInForce(cfg))
        : null,
      visit: personalizes(consent) ? sessionData?.metadata : null,
      lastSeen: personalizes(consent) ? sessionData?.metadata.lastSeen : null,
      consent,
    };
  } catch {
    throw new SessionAccessError();
  }
}

// ── The tenant's own catalogue vocabulary (W16 C8.03, R47, R64) ─────────────
//
// What an ingest host is allowed to refuse comes from the catalogue THIS tenant
// PUBLISHES, never from a list written in product code: the values its published
// content catalogue tags carry, dimension by dimension. It is read here, beside
// the decision path's own read of the same document, so the two halves of the
// platform can never disagree about what the tenant's taxonomy is.
//
// The two halves are deliberately different in kind:
//
//   · `values` — the authority over attribute VALUES — comes from published
//     data only. A demo product catalogue bundled with this repository is not
//     the tenant's published taxonomy, and letting it refuse a customer's event
//     attributes would make one brand's rows a constant in product code
//     (document 35 §6) and would invert CW24, whose whole point is that a
//     customer's site scores against THEIR catalog, their events, not a copy of
//     one held here.
//   · `ids` — the authority over whether a product REFERENCE can be placed —
//     also takes the ids of a product catalogue the engine actually holds for
//     the tenant, because holding the product is exactly what placing its id
//     means; it is the same fact the per-event `getProduct` lookup establishes,
//     extended to the `items[]` references that lookup never sees.

/** Any product catalogue the tenant holds, read structurally so no host type leaks in. */
export interface CatalogVocabularySource {
  getAllProducts(): ReadonlyArray<Record<string, unknown>>;
}

/**
 * Keyed by the documents it is derived from and CHECKED against the tenant and
 * the registry version it was built for (review finding F6): the sentinel that
 * stands for "no readable content catalogue" is one shared object, so without
 * the tenant on the entry two scopes could otherwise be served each other's
 * vocabulary. A mismatch simply recomputes.
 */
interface VocabularyEntry { tenant: string; version: string; value: CatalogVocabulary }
const NO_CONTENT_CATALOG = {};
const NO_PRODUCT_CATALOG = {};
// Held weakly on both axes, so a republished document simply misses and the
// superseded entry is collected. No TTL and no explicit invalidation can go
// stale against it.
const vocabularyCache = new WeakMap<object, WeakMap<object, VocabularyEntry>>();

/**
 * The vocabulary the ingest hosts measure an event against.
 *
 * A tenant whose content catalogue is absent or unreadable publishes no
 * vocabulary here, so nothing is called unrecognized and the engine behaves
 * exactly as it did before R47: a publication outage must not turn into refused
 * traffic on the ingest path, and the decision path's own fail-closed authority
 * over the same document is untouched by this read. Only the publication
 * authority's own typed failure is absorbed (review finding F2) — a typed owner
 * or consent refusal raised inside the storage read is that request's own answer
 * and propagates unchanged.
 */
export async function tenantCatalogVocabulary(
  env: Env, tenant: string, config: ReflexConfig, products?: CatalogVocabularySource | null,
): Promise<CatalogVocabulary> {
  const ids = new Set<string>();
  const values = new Map<string, Set<string>>();
  const name = (dim: string, value: string) => {
    let set = values.get(dim);
    if (!set) { set = new Set<string>(); values.set(dim, set); }
    set.add(value);
  };
  let document: object = NO_CONTENT_CATALOG;
  const productKey: object = products ?? NO_PRODUCT_CATALOG;
  let cacheable = true;
  try {
    const revision = await readPublication(env, CONTENT_KIND, tenant, true);
    const catalog = revision?.value;
    if (catalog) {
      document = catalog;
      const cached = vocabularyCache.get(document)?.get(productKey);
      if (cached && cached.tenant === tenant && cached.version === config.version) return cached.value;
      for (const piece of catalog.pieces as ReadonlyArray<Pick<ContentPiece, 'tags' | 'featuredProductIds'>>) {
        for (const [dim, tagged] of Object.entries(piece.tags ?? {})) for (const value of tagged) name(dim, value);
        for (const id of piece.featuredProductIds ?? []) ids.add(id);
      }
    }
  } catch (error) {
    if (!(error instanceof PublicationError)) throw error;
    // The authority is absent or unreadable: this tenant names no vocabulary for
    // as long as that lasts, and the outage is not cached past its own read.
    cacheable = false;
  }
  // Ids only: a product the engine holds can be placed by id. Its attribute
  // values are NOT a vocabulary this tenant published, so they refuse nothing.
  for (const product of products?.getAllProducts() ?? []) {
    const id = product.id;
    if (typeof id === 'string' && id) ids.add(id);
  }
  const value: CatalogVocabulary = { ids, values };
  if (cacheable) {
    let byProducts = vocabularyCache.get(document);
    if (!byProducts) { byProducts = new WeakMap<object, VocabularyEntry>(); vocabularyCache.set(document, byProducts); }
    byProducts.set(productKey, { tenant, version: config.version, value });
  }
  return value;
}

/**
 * The region a caller asserted, as a region key, when it may select the
 * regional prior: on the demo profile only. Null everywhere else, and for a
 * value that is not a region key, so the edge region stays the prior's input.
 */
export function demoAssertedRegion(env: Pick<Env, 'DEPLOYMENT_PROFILE'>, asserted: string | undefined): string | null {
  if (env.DEPLOYMENT_PROFILE !== 'demo' || typeof asserted !== 'string') return null;
  const key = asserted.trim().toUpperCase();
  return /^[A-Z]{2}(?:-[A-Z0-9]{1,3})?$/.test(key) ? key : null;
}

export async function serveContentDecisions(
  env: Env, r: ServeRequest,
): Promise<ContentDecisionSet & { sources: DecisionSources; afterResponse: Promise<void>; /** CW31: false when tracking is withheld, and nothing about this request may be written. */ write: boolean;
  /**
   * Ruling L-R10 (P02 decision D1): the records the serve-time capture took, the
   * only ones a caller may write to the ledger when `write` holds — every record
   * of the answer except a declared layout slot measured on any basis but
   * rendered-v1, which is served and never captured at serve time.
   */
  ledgerRecords: ContentDecisionSet['records'] }> {
  if (!validEntry(r.entry, true)) throw new SessionAccessError();
  const hints = intersectConsent(consentFromCookies(r.cookieHeader), refusalHints(r.consent));
  // The monitor's explicit refusal is a synthetic default probe, not authority
  // to look up a shopper. No other unsigned service use may select private state.
  if (!r.principal && (hints.tracking || hints.personalization)) throw new SessionAccessError();
  if (r.principal) {
    assertOwnerScope(env, r.principal);
    assertSessionTarget(r.principal, r.visitorId, r.sessionId);
    if (r.principal.tenant !== r.tenant || r.principal.tenant !== (r.stateTenant ?? DEFAULT_TENANT)) throw new SessionAccessError();
  }
  const now = r.nowMs ?? Date.now();
  const scope = r.tenant;
  const brand = r.brand ?? r.tenant;
  // Where the time goes, in milliseconds per stage, on the answer and on the Server-Timing header.
  const timings: Record<string, number> = {};
  let mark = performance.now();
  const lap = (name: string) => { const t = performance.now(); timings[name] = Math.round(t - mark); mark = t; };

  let publicationDigest = '';
  const [catalogRev, slotsRev, learnRev, cfgRev] = await (async () => {
    const pin = await pinPublication(env, scope, true);
    publicationDigest = pin.digest;
    return Promise.all([
      readPinnedPublication(env, CONTENT_KIND, scope, pin),
      readPinnedPublication(env, SLOTS_KIND, scope, pin),
      readPinnedPublication(env, LEARN_KIND, scope, pin),
      resolveTenantReflexConfigRevision(env, scope, undefined, now, pin),
    ]);
  })().catch(async error => {
    // A document outage cannot discard an explicit owned refusal. This read
    // persists only the restriction and never computes an affinity view.
    if ((error instanceof ReflexConfigUnavailableError || error instanceof PublicationError) && r.principal && !personalizes(hints)) {
      await readShopper(env, r.visitorId, hints, null, now, r.principal.tenant, r.principal, r.capability);
    }
    throw error;
  });
  const catalog = catalogRev?.value ?? EMPTY_CATALOG;
  // Authoring defaults are not permission to select when hard controls cannot be read.
  const slotsDoc: SlotCatalog = slotsRev?.value ?? { pages: {} };
  const learn = learnRev?.value ?? DEFAULT_LEARN;
  const cfg = cfgRev.config;
  const configRevision = cfgRev.revision;
  // W16 C4 (R32(1), R49): the journey thresholds ride the reflex document, so
  // the version a receipt names is that document's own revision identity. A
  // tenant that has published no block is decided by the engine's compiled
  // default at revision 0, named and diagnosed as such; a block that will not
  // validate fails closed to the first stage with no version at all.
  const { version, revision, reason } = journeySourceOf(cfg, configRevision);
  const journeySource = { version, revision, reason };
  lap('documents');

  const shopper: ShopperRead = r.principal
    ? await readShopper(env, r.visitorId, hints, cfg, now, r.stateTenant ?? DEFAULT_TENANT, r.principal, r.capability)
    : { affinity: null, sessionId: null, isNewSession: null, state: 'none', stage: null, consent: hints };
  lap('shopper');
  const consent = shopper.consent;
  if (consent.tracking) requireConsentPurpose(consent, personalizes(consent) ? 'personalization' : 'tracking');
  // W16 R5: an unreadable record is served the site's default decision under her
  // own consent — nothing of the record is an input, and nothing is written that
  // her consent does not already cover. Her ASSIGNMENT is untouched: it is a pure
  // function of her anchor and the published salt, not of the record, so the
  // experiment keeps her where she is and the served experience says `default`.
  const unreadable = shopper.unreadable === true;
  const personalized = personalizes(consent) && !unreadable;
  const visit = projectVisit(shopper.visit, shopper.lastSeen, now, consent.tracking ? r.entry : undefined);
  const cell = cellFor({
    cf: consent.tracking ? r.cf : null, snap: personalized ? shopper.affinity : null, cfg,
    // A caller cannot relabel an already-established visit. The explicit
    // channel is only a bounded fallback when owned state has no entry yet.
    channel: consent.tracking ? visit.entryChannel ?? entryChannelOf(r.channel) : null,
    visitNumber: personalized ? visit.visitNumber : null,
    // R32(2): the ONE mapping point from the reported vocabulary to the
    // persisted cell token, so the ladder key and every learning statistic keyed
    // on `s=mid` are exactly what they were before C4. `cellFor` records
    // anything it does not recognise as unknown.
    stage: personalized && shopper.stage ? PERSISTED_STAGE[shopper.stage] : null,
  });
  // W21 E1 (F07 §1.4, §7(b)): consent first, then enrollment. A shopper without
  // personalization consent is not drawn into the experiment at all; a
  // consenting shopper is enrolled against her PERSISTENT anchor and the
  // published salt, so the same draw answers on every later decision and
  // survives recognition. (`armUnder` labels the refusing shopper `default`
  // today and the ruled `ineligible` waits on the assertions named there.)
  const holdoutInForce: HoldoutConfig = { ...learn.holdout, salt: learn.holdout.salt || brand };
  // W21 E1.07 (NR3, ruling R130): the salt version is CARRIED where the head is
  // read. It used to be walked here — up to 24 prior learn revisions read before
  // the shopper's first answer on a cold isolate — for a number that is
  // provenance and never a serving input. The publish that changed the history
  // computed it; this reads it off the head it already holds, so the decision
  // performs no read of its own and cannot fail or wait on one. It is used only
  // where the salt it was computed for is the salt in force; anything else is
  // the explicit unknown, never a number from another experiment (NR4).
  const saltCarried = carriedSaltVersion(learnRev);
  const saltVersion = saltCarried && saltCarried.salt === holdoutInForce.salt ? saltCarried.version : null;
  // The anchor is looked up only for a shopper who is in the experiment at all.
  const anchor = personalizes(consent) ? await enrollmentAnchorOf(env, r.stateTenant ?? DEFAULT_TENANT, r.visitorId) : null;
  const enrolled = anchor && !anchor.unavailable
    ? enrollmentFor({ tenant: r.tenant, brand, holdout: holdoutInForce, saltVersion,
      anchor: anchor.anchor, anchorGeneration: anchor.anchorGeneration })
    : null;
  // W21 E1.02 (R108): she is served the site's own defaults either way — the
  // EXPERIENCE is unchanged — and the provenance says which population she is
  // in. A shopper who has not consented to personalization is `ineligible`: not
  // drawn, so no anchor is consulted for her and no bucket is taken, and a
  // report can never pool her with the randomised control.
  const enrollment: EnrollmentProvenance | null = enrolled?.provenance
    ?? (r.principal ? ineligibleEnrollment({ tenant: r.tenant, brand, holdout: holdoutInForce, saltVersion,
      reason: personalizes(consent) ? 'anchor_unavailable' : 'personalization_consent' }) : null);
  const arm = unreadable ? 'default' : armUnder(consent, enrolled?.arm ?? 'default');
  const slots = slotsDoc.pages[r.page] ?? [];
  const activeSlots = slots.filter(slot => !slot.offLimits);
  // W26 R2: the slot names this catalogue — the one this page is decided with —
  // carries on more than one page. Derived from the document already read
  // above, so it adds no read to the serving path and cannot fail on it: each
  // such placement reads its own page's lift, and its exposures are fanned to
  // its own page's object.
  const pageScoped: ReadonlySet<string> = new Set(pageScopedSlotNames(slotsDoc));

  // CW6: the population prior. Read from KV through the isolate cache, never
  // from the object; blended into a COPY of the affinity view. Off for the
  // holdout's default arm, since defaults are the point of that arm.
  const regionalCfg = learn.regional ?? { enabled: false, kBlend: 1, minEvents: 30 };
  let affinity: { dims: Record<string, Record<string, number>> } | null = personalized ? shopper.affinity : null;
  let regional: (NonNullable<Parameters<typeof decideContent>[0]['regional']> & { asserted?: true }) | null = null;
  if (regionalCfg.enabled && arm !== 'default') {
    // DEMO PROFILE ONLY: an asserted region also selects the prior, so one
    // laptop can rehearse two regions. Every other profile keeps the rule
    // below (an asserted region moves no affinity); the receipt says asserted.
    const assertedPrior = demoAssertedRegion(env, consent.tracking ? r.context?.region : undefined);
    const trend = await readTrend(env, scope, assertedPrior ?? regionKeyOf(r.cf), regionalCfg.minEvents, now);
    if (trend) {
      const lambda = lambdaFor(shopper.affinity?.dims, regionalCfg.kBlend);
      // Only the dimensions the tenant lets the prior blend (absent: all). The
      // same shares travel to the decision, so its receipt and the record's
      // replay inputs itemise exactly what the region contributed.
      const share = sharesWithin(trend.snapshot.share, regionalCfg.dimensions);
      const blended = blendAffinity(shopper.affinity?.dims, share, lambda);
      affinity = { dims: blended.dims };
      regional = { region: trend.region, level: trend.level, lambda, version: trend.snapshot.version, events: trend.snapshot.events, share,
        ...(assertedPrior ? { asserted: true as const } : {}) };
    }
  }

  lap('trend');
  // What the state hung on: the DO host keys it on the durable visitor id, the
  // session host on the cookie, and a failed read on nothing at all.
  const identityAnchor = shopper.state === 'do' ? 'visitor' : shopper.state === 'session' ? 'session' : 'none';

  // W34.01: external scoring is withdrawn from live decisions, including table
  // lookup. Stored settings cannot authorize runtime inference or external work.
  // Keep the omission explicit on weighted receipts and replayable from them.
  // W34 E2: the policy in force is the deployment's `EXTERNAL_MODEL_POLICY`,
  // read here and resolved fail-closed (absent, invalid or unreadable is off,
  // the only policy this build implements), so the read cannot fail the
  // decision or change what is served; the receipt's reason is the policy's.
  const externalPolicy = externalModelPolicy(env);
  const extCfg = learn.external ?? null;
  const extWeightOf = (slot: string) => learn.slots?.[slot]?.external?.weight ?? 0;
  const wantsExt = extCfg !== null && arm !== 'default' && activeSlots.some((s) => extWeightOf(s.slot) > 0);
  const external: ExternalTerm | null = wantsExt && extCfg
    ? { kind: extCfg.kind, ref: extCfg.ref, weightOf: extWeightOf, status: 'unavailable', reason: EXTERNAL_POLICY_REASON[externalPolicy] }
    : null;

  // Phase 1: the lift snapshot per slot, and the trust dial. Shadow by default.
  const snapshots: Record<string, LiftSnapshot | null> = {};
  const configOf = slotLearnConfigOf(learn);
  // CW30: the visitor's ring, only when a slot on the page has a fatigue dial, never for the default arm, under a time budget.
  const wantsRing = arm !== 'default' && activeSlots.some((s) => (s.fatigue?.weight ?? 0) > 0);
  const [ring] = await Promise.all([wantsRing ? readRing(env, r.tenant, r.visitorId) : Promise.resolve(null), ...(arm === 'default' ? [] : activeSlots.map(async (s) => { snapshots[s.slot] = await readLift(env, scope, brand, s.slot, now, configOf(s.slot), identityPage(pageScoped, s.slot, r.page)); }))]);
  for (const entry of ring ?? []) if (entry.brand === brand) pinRetention(env, entry.retention?.online, r.tenant, 'online');
  const served = ring ? servedCounts(ring.filter(e => e.brand === brand), activeSlots.map(s => ({ ...s, measurementBasis: configOf(s.slot).measurementBasis })), now) : null;
  lap('lift');
  const gammaOf = (slot: string) => learn.slots?.[slot]?.gamma ?? 0;
  const exploreOf = (slot: string) => learn.slots?.[slot]?.exploration ?? null;
  const controlOf = (slot: string, item: string) => learn.slots?.[slot]?.items?.[item] ?? null;
  // P28 (decision D1): the layout blend a slot's dials opt into, read from the
  // learn document already held above — no read of its own, so it can neither
  // fail nor wait — and applied by the decision on the declared layout slot only.
  const blendOf = (slot: string) => layoutBlendOf(learn, slot);

  const set = decideContent({
    ...(consent.tracking ? { requestId: crypto.randomUUID() } : {}),
    tenant: r.tenant, brand, page: r.page, visitorId: r.visitorId, sessionId: r.browsingSessionId || r.sessionId || shopper.sessionId, identityAnchor, nowMs: now,
    pieces: catalog.pieces, slots, affinity, regional, cell, arm,
    // Garrett's targeting rule needs two things: where she is, and whatever
    // condition the caller says holds right now.
    //
    // An ASSERTED region wins over the edge's own, and deliberately. The edge
    // resolves location from the connection, which is coarse and sometimes only
    // a country; the integrator often knows better — a server-side caller has
    // the customer's account region, and a page may carry a chosen store or a
    // delivery postcode. The edge value is the fallback when nothing is
    // asserted, so an integration that says nothing behaves exactly as before.
    //
    // The trust boundary, stated: this input is caller-controlled, and it can
    // only ever admit content the merchandiser already published with a rule
    // naming that region. It grants no access, moves no affinity and is never
    // stored as evidence about the shopper. Region rides consent exactly as the
    // learning cell does — a shopper who withholds tracking is located by
    // nobody, asserted or not.
    eligibility: {
      region: consent.tracking ? (r.context?.region ?? regionKeyOf(r.cf) ?? null) : null,
      ...(r.context ? { signals: r.context } : {}),
    },
    versions: { config: configRevision, catalog: catalogRev?.revision ?? 0, slots: slotsRev?.revision ?? 0, learn: learnRev?.revision ?? 0, lift: 0, prior: 0, policy: learnRev?.revision ?? 0 },
    configLabel: cfg.version,
    learning: { snapshots, gammaOf, exploreOf, controlOf, metadataOf: configOf, blendOf },
    external,
    served,
    // W16 C3: the arrival's context for this page load, for the slots that
    // publish seed rules. Observed only, under the same tracking gate as the
    // visit it is read with: the arrival is read from the request; a fired seed
    // (its signal and value) is recorded on the receipt as a driver; nothing
    // else of it is kept by the decision.
    ...(consent.tracking && r.entry ? { entry: r.entry } : {}),
    // The OS family the request reports, under the same gate as the arrival,
    // and her own memberships for a seed rule's dampen (none without consent).
    ...(consent.tracking && platformWordOf(r.platform) ? { platform: platformWordOf(r.platform) } : {}),
    ...(personalizes(consent) && shopper.affinity?.audiences?.length ? { audiences: shopper.affinity.audiences } : {}),
  });

  lap('decide');
  if (consent.tracking) for (const record of set.records) record.retention = captureRetention(env, r.tenant, record.ts, now);
  for (const record of set.records) record.measurementBasis = configOf(record.slot).measurementBasis ?? 'served-v1';
  // P02 decision D1: the page's declared layout slot that its learn document
  // does not measure on rendered-v1, named on the set (keys sorted). Configuration
  // only — the same answer for every shopper on the page — and present only when
  // there is something to name.
  const layoutDiagnostics: LayoutDiagnostic[] = [];
  for (const slot of activeSlots) {
    if (slot.layout !== true) continue;
    const measurementBasis = configOf(slot.slot).measurementBasis ?? 'served-v1';
    if (measurementBasis !== 'rendered-v1') layoutDiagnostics.push({ measurementBasis, reason: 'measurement_basis', slot: slot.slot });
  }
  // W21 E1.03 (position 8): every arm-tagged record names the experiment it was
  // decided under, as the decision path answered it. The producer writes it so
  // that nothing downstream has to reconstruct it from a later configuration.
  if (enrollment) for (const record of set.records) record.experiment = enrollment;
  // W16 C4: every record — and so every receipt read off it — names the stage it
  // was decided in and the threshold version that derived it. Omitted where the
  // engine did not personalize, because there is no derived stage to claim.
  if (personalized && shopper.stage) {
    const journey = { stage: shopper.stage, version: journeySource.version };
    for (const record of set.records) record.journey = journey;
  }
  // CW31: a shopper who declined personalization sees why on every receipt.
  if (!personalizes(consent)) for (const rec of set.records) rec.explain.note = `the site's defaults: ${!consent.tracking && !consent.personalization ? 'tracking and personalization are' : !consent.tracking ? 'tracking is' : 'personalization is'} off by the shopper's choice`;
  // W16 R5: and one whose record could not be read sees that, not a choice she never made.
  else if (unreadable) for (const rec of set.records) rec.explain.note = "the site's defaults: the shopper's stored record is unreadable under the retention policy in force";
  // The owner drains actual private I/O. In durable mode the shared admission
  // must finish before either ledger or learning effects can start.
  // CW31: with tracking withheld the engine writes nothing about this request, here or in the ledger (`write`).
  const synthetic = syntheticOperation();
  const trustedSynthetic = synthetic?.tenant === r.tenant && synthetic.subject === r.visitorId && synthetic.sessionId === r.sessionId && synthetic.expiresAt > Date.now();
  // P02 decision D1: a declared layout slot is captured only on rendered-v1, by
  // the render acknowledgement of a module the page drew. On any other basis it
  // is served — offered for no acknowledgement, below — and never captured at
  // serve time, because a module returned is not a module drawn. Derived from
  // the documents already read: no read is added, nothing here can fail.
  const unmeasuredLayout = new Set(layoutDiagnostics.map(d => d.slot));
  const capturable = (record: (typeof set.records)[number]) => !unmeasuredLayout.has(record.slot);
  const captureRecords = r.offer ? trustedSynthetic ? set.records.filter(record => record.measurementBasis === 'served-v1' && capturable(record)) : []
    : set.records.every(record => record.measurementBasis === 'served-v1') ? set.records.filter(capturable) : [];
  const servedCapture = !r.offer && captureRecords.length > 0;
  const captureSet = { ...set, records: captureRecords };
  const captured = consent.tracking && captureRecords.length > 0
    ? env.LEDGER_RECOVERY_ENABLED === 'true'
      ? recoverDecisions(env, captureSet, slotLearnConfigOf(learn)).then(result => { if (result.source.state !== 'recovered') reportLearningIncomplete('decisions', result.learning ?? null); })
      : fanDecisions(env, captureSet, slotLearnConfigOf(learn), undefined, pageScoped).then(result => reportLearningIncomplete('decisions', result))
    : Promise.resolve();
  // W20 G2 (R83, R86(a)/(b)): a refused pin has no decision and no ledger row,
  // and a pinned slot that fell short writes only what it served, so neither
  // reaches any operator surface by itself. The occurrences are counted for the
  // tenant's slots here, after the answer is decided, fire and forget: the
  // counter is never read on this path, its failures are swallowed inside
  // `recordSlotGovernance`, and nothing about the shopper is written to it.
  // Three conditions, each on its own ground: the shopper's tracking refusal
  // means the engine writes nothing at all about this request (CW31); an
  // isolated synthetic operation is the platform's own traffic; and a caller
  // that declares `selfCheck` is the platform composing the page to check
  // itself (R94(1)). Together they make the tenant-level signal the monitor
  // answers with the tenant's own serving, never a synthetic-probe value.
  const governance = {
    refusedPins: (set.pinDiagnostics ?? []).map(d => ({ slot: d.slot, pinnedPieceId: d.pinnedPieceId, reason: d.reason })),
    shortTakes: (set.shortTakes ?? []).map(s => ({ slot: s.slot, empty: s.empty })),
  };
  const counted = consent.tracking && !synthetic && !r.selfCheck && (governance.refusedPins.length > 0 || governance.shortTakes.length > 0)
    ? recordSlotGovernance(env, scope, governance, now)
    : Promise.resolve();
  // W21 E1.05 (R118(3)): a decision that could not read its anchor is counted
  // for the operator, after the answer, under the same three conditions the
  // governance counters use — the shopper's tracking refusal means nothing is
  // written about her request, and neither a synthetic operation nor the
  // platform's own self-check is the tenant's traffic.
  const anchorCounted = anchor?.unavailable && consent.tracking && !synthetic && !r.selfCheck
    ? recordAnchorUnavailable(env, scope, now)
    : Promise.resolve();
  const afterResponse = Promise.all([captured, counted, anchorCounted]).then(() => undefined);

  // P03 decision D3: every decision names its position within its slot — what its
  // record calls `position` — as `slotPosition`, beside the page-wide `order`, so
  // the page's render acknowledgement and its engagements can carry it. Read off
  // the record already composed: no read is added and nothing here can fail.
  const decisions = await Promise.all(set.decisions.map(async (served, index) => {
    const record = set.records[index]!;
    const decision = { ...served, slotPosition: record.position };
    if (!consent.tracking) return decision;
    if (r.offer) {
      if (!r.offer.pageInstance || record.measurementBasis !== 'rendered-v1' || !r.principal) return decision;
      return { ...decision, decisionId: record.decision_id, renderOffer: await createRenderOffer(env, r.principal, consent, record,
        configOf(record.slot), publicationDigest, r.offer.pageInstance) };
    }
    return { ...decision, decisionId: record.decision_id };
  }));
  return {
    ...set,
    ...(enrollment ? { experiment: enrollment } : {}),
    ...(layoutDiagnostics.length ? { layoutDiagnostics } : {}),
    decisions,
    afterResponse,
    write: consent.tracking && servedCapture,
    ledgerRecords: captureRecords,
    sources: {
      catalog: { version: catalog.version ?? null, revision: catalogRev?.revision ?? 0, pieces: catalog.pieces.length },
      slots: { version: slotsDoc.version ?? null, revision: slotsRev?.revision ?? 0, count: slots.length },
      learn: { version: learn.version ?? null, revision: learnRev?.revision ?? 0 },
      config: { label: cfg.version, revision: configRevision },
      journey: journeySource,
      external: external ? { kind: external.kind, ref: external.ref, ok: false, ms: 0, version: null, reason: external.reason } : null,
      state: shopper.state,
      ...(unreadable ? { record: 'unreadable' as const } : {}),
      consent: { ...consent, personalized },
      timings,
    },
  };
}
