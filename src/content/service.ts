// src/content/service.ts
// The decision service: everything decide.ts needs, resolved from where it lives,
// with strict owned consent before profile computation or measurement. Cold
// decisions do not create behavior; only necessary refusal records may be
// persisted here. Owned state failures are terminal, never consenting defaults.

import type { Env } from '@/types/env';
import { assertOwnerScope, currentOwnerConsent, pinRetention, pinProfileRetention, requireConsentPurpose, ownerBindingIdentity } from '@/identity/sessionAuthority';
import { assertSessionTarget, SessionAccessError, SHOPPER_HEADER, type SessionCapability } from '@/identity/sessionCapability';
import { PublicationError, pinPublication, readPinnedPublication } from '@/config/publication';
import { resolveTenantReflexConfigRevision } from '@/demos/registry';
import { ReflexConfigUnavailableError } from '@/reflex/configStore';
import { snapshot as reflexSnapshot, type AffinitySnapshot, type ReflexConfig } from '@/reflex/core';
import { SessionManager } from '@/services/SessionManager';
import {
  journeyCountersNow, journeyStageFrom, journeyThresholdsOf, journeyWordOf,
  NO_JOURNEY_THRESHOLDS, PERSISTED_STAGE, type JourneyWord,
} from '@/services/JourneyStage';
import { projectVisit, validEntry, validVisitContext, entryChannelOf, type ChannelSignals, type VisitContext } from '@/services/visit';
import { DEFAULT_TENANT, type TenantId } from '@/tenancy/tenant';
import { shopperObject } from '@/tenancy/objects';
import { CONTENT_KIND, DEFAULT_LEARN, EMPTY_CATALOG, LEARN_KIND, SLOTS_KIND } from './kinds';
import { armFor } from './holdout';
import { cellFor, type CfLike } from './cell';
import { armUnder, consentOf, consentFromCookies, refusalHints, intersectConsent, storedConsent, personalizes, type Consent } from './consent';
import { decideContent } from './decide';
import { blendAffinity, lambdaFor, readTrend, regionKeyOf } from '@/reflex/regionTrend';
import { currentLiftWitness, fanDecisions, liftKey, readRing, reportLearningIncomplete, servedCounts, type SlotLearnConfig } from '@/learn/fan';
import { DEFAULT_STATS, type LiftSnapshot } from '@/learn/stats';
import type { ExternalTerm } from './types';
import type { ContentDecisionSet, SlotCatalog } from './types';
import { captureRetention } from '@/retention';
import { recoverDecisions } from '@/ledger/recovery';
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
  /** Observed arrival context, not an override of an established visit entry. */
  entry?: ChannelSignals;
  nowMs?: number;
  /** The brand whose shopper state this request reads, as the tenancy middleware resolved it. */
  stateTenant?: TenantId;
  /** Verified public caller context; unsigned callers may request only state-free refused defaults. */
  principal?: SessionCapability;
  capability?: string;
}

/** Where each input came from, so a reader can tell a tuned scope from a compiled default. */
/** KV/cache supplies immutable estimates; the object supplies current health/generation. */
const LIFT_TTL_MS = 60_000;
const liftCache = new Set<{ binding: Env['CACHE']; stats: Env['LEARN_STATS']; key: string; at: number; value: LiftSnapshot | null }>();
export function invalidateLiftCache(): void { liftCache.clear(); }
export async function readLift(env: Pick<Env, 'CACHE' | 'LEARN_STATS'>, tenant: string, brand: string, slot: string, now: number, config: SlotLearnConfig): Promise<LiftSnapshot | null> {
  const compatible = (value: LiftSnapshot | null) => value !== null && typeof value === 'object' && !Array.isArray(value)
    && value.tenant === tenant && value.brand === brand && value.slot === slot && value.reward === config.reward
    && (value.measurementBasis ?? 'served-v1') === (config.measurementBasis ?? 'served-v1')
    && (value.objective === undefined ? 'unit' : value.objective) === (config.objective ?? 'unit') && value.tauLearnMs === config.stats.tauLearnMs
    && value.n0 === config.stats.n0 && value.nMin === config.stats.nMin
    && value.liftMin === config.stats.liftMin && value.liftMax === config.stats.liftMax;
  const key = liftKey(tenant, brand, slot);
  const binding = ownerBindingIdentity(env.CACHE), stats = ownerBindingIdentity(env.LEARN_STATS);
  const hit = [...liftCache].find(e => e.binding === binding && e.stats === stats && e.key === key);
  if (hit && now >= hit.at && now - hit.at < LIFT_TTL_MS) return compatible(hit.value) && await currentLiftWitness(env, tenant, brand, slot, hit.value!) ? hit.value : null;
  let value: LiftSnapshot | null = null;
  try {
    const stream = await env.CACHE.get(key, 'stream');
    if (stream) {
      const reader = stream.getReader(), decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
      let size = 0, raw = '';
      try { for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
        if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('Snapshot capacity'); }
        raw += decoder.decode(next.value, { stream: true }); } raw += decoder.decode(); }
      finally { reader.releaseLock(); }
      value = JSON.parse(raw) as LiftSnapshot;
    }
  } catch { value = null; }
  if (hit) liftCache.delete(hit);
  if (liftCache.size >= 256) liftCache.delete(liftCache.values().next().value!);
  liftCache.add({ binding, stats, key, at: now, value });
  // Cache the raw snapshot, never one request's compatibility verdict.
  return compatible(value) && await currentLiftWitness(env, tenant, brand, slot, value!) ? value : null;
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
}

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
      const body = (await res.json()) as { ok?: boolean; affinity?: AffinitySnapshot | null; journeyStage?: string | null; consent?: unknown; visit?: VisitContext & { lastSeen?: number } };
      if (!body || body.ok !== true || body.consent === undefined) throw new SessionAccessError();
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
    if (personalizes(consent) && sessionData) pinProfileRetention(env, sessionData, tenant);
    if (personalizes(consent) && !cfg) throw new ReflexConfigUnavailableError(tenant);
    return {
      affinity: personalizes(consent) && sessionData?.reflex && cfg ? reflexSnapshot(sessionData.reflex, now, cfg) : null,
      sessionId, isNewSession: null, state: 'session',
      // W16 C4: the same derivation the session host's own hydrate answers with
      // — this visit's counters against the published journey thresholds.
      stage: personalizes(consent) && cfg
        ? journeyStageFrom(journeyCountersNow(sessionData?.journey, sessionData?.metadata.lastSeen, now), cfg.journey)
        : null,
      visit: personalizes(consent) ? sessionData?.metadata : null,
      lastSeen: personalizes(consent) ? sessionData?.metadata.lastSeen : null,
      consent,
    };
  } catch {
    throw new SessionAccessError();
  }
}

export async function serveContentDecisions(
  env: Env, r: ServeRequest,
): Promise<ContentDecisionSet & { sources: DecisionSources; afterResponse: Promise<void>; /** CW31: false when tracking is withheld, and nothing about this request may be written. */ write: boolean }> {
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
  // W16 C4 (R32(1)): the journey thresholds ride the reflex document, so the
  // version a receipt names is that document's own revision identity. With no
  // valid block published the engine uses no version at all and says why — it
  // never invents a threshold.
  const journeySource = journeyThresholdsOf(cfg.journey)
    ? { version: cfg.version, revision: configRevision, reason: null }
    : { version: null, revision: 0, reason: NO_JOURNEY_THRESHOLDS };
  lap('documents');

  const shopper: ShopperRead = r.principal
    ? await readShopper(env, r.visitorId, hints, cfg, now, r.stateTenant ?? DEFAULT_TENANT, r.principal, r.capability)
    : { affinity: null, sessionId: null, isNewSession: null, state: 'none', stage: null, consent: hints };
  lap('shopper');
  const consent = shopper.consent;
  if (consent.tracking) requireConsentPurpose(consent, personalizes(consent) ? 'personalization' : 'tracking');
  const visit = projectVisit(shopper.visit, shopper.lastSeen, now, consent.tracking ? r.entry : undefined);
  const cell = cellFor({
    cf: consent.tracking ? r.cf : null, snap: personalizes(consent) ? shopper.affinity : null, cfg,
    // A caller cannot relabel an already-established visit. The explicit
    // channel is only a bounded fallback when owned state has no entry yet.
    channel: consent.tracking ? visit.entryChannel ?? entryChannelOf(r.channel) : null,
    visitNumber: personalizes(consent) ? visit.visitNumber : null,
    // R32(2): the ONE mapping point from the reported vocabulary to the
    // persisted cell token, so the ladder key and every learning statistic keyed
    // on `s=mid` are exactly what they were before C4. `cellFor` records
    // anything it does not recognise as unknown.
    stage: personalizes(consent) && shopper.stage ? PERSISTED_STAGE[shopper.stage] : null,
  });
  // CW31: either consent switch off means the site's own defaults, whatever the holdout hash says.
  const arm = armUnder(consent, armFor(r.visitorId, { ...learn.holdout, salt: learn.holdout.salt || brand }));
  const slots = slotsDoc.pages[r.page] ?? [];
  const activeSlots = slots.filter(slot => !slot.offLimits);

  // CW6: the population prior. Read from KV through the isolate cache, never
  // from the object; blended into a COPY of the affinity view. Off for the
  // holdout's default arm, since defaults are the point of that arm.
  const regionalCfg = learn.regional ?? { enabled: false, kBlend: 1, minEvents: 30 };
  let affinity: { dims: Record<string, Record<string, number>> } | null = personalizes(consent) ? shopper.affinity : null;
  let regional: Parameters<typeof decideContent>[0]['regional'] = null;
  if (regionalCfg.enabled && arm !== 'default') {
    const trend = await readTrend(env, scope, regionKeyOf(r.cf), regionalCfg.minEvents, now);
    if (trend) {
      const lambda = lambdaFor(shopper.affinity?.dims, regionalCfg.kBlend);
      const blended = blendAffinity(shopper.affinity?.dims, trend.snapshot.share, lambda);
      affinity = { dims: blended.dims };
      regional = { region: trend.region, level: trend.level, lambda, version: trend.snapshot.version, events: trend.snapshot.events, share: trend.snapshot.share };
    }
  }

  lap('trend');
  // What the state hung on: the DO host keys it on the durable visitor id, the
  // session host on the cookie, and a failed read on nothing at all.
  const identityAnchor = shopper.state === 'do' ? 'visitor' : shopper.state === 'session' ? 'session' : 'none';

  // W34.01: external scoring is withdrawn from live decisions, including table
  // lookup. Stored settings cannot authorize runtime inference or external work.
  // Keep the omission explicit on weighted receipts and replayable from them.
  const extCfg = learn.external ?? null;
  const extWeightOf = (slot: string) => learn.slots?.[slot]?.external?.weight ?? 0;
  const wantsExt = extCfg !== null && arm !== 'default' && activeSlots.some((s) => extWeightOf(s.slot) > 0);
  const external: ExternalTerm | null = wantsExt && extCfg
    ? { kind: extCfg.kind, ref: extCfg.ref, weightOf: extWeightOf, status: 'unavailable', reason: 'external scoring disabled by deployment policy' }
    : null;

  // Phase 1: the lift snapshot per slot, and the trust dial. Shadow by default.
  const snapshots: Record<string, LiftSnapshot | null> = {};
  const configOf = slotLearnConfigOf(learn);
  // CW30: the visitor's ring, only when a slot on the page has a fatigue dial, never for the default arm, under a time budget.
  const wantsRing = arm !== 'default' && activeSlots.some((s) => (s.fatigue?.weight ?? 0) > 0);
  const [ring] = await Promise.all([wantsRing ? readRing(env, r.tenant, r.visitorId) : Promise.resolve(null), ...(arm === 'default' ? [] : activeSlots.map(async (s) => { snapshots[s.slot] = await readLift(env, scope, brand, s.slot, now, configOf(s.slot)); }))]);
  for (const entry of ring ?? []) if (entry.brand === brand) pinRetention(env, entry.retention?.online, r.tenant, 'online');
  const served = ring ? servedCounts(ring.filter(e => e.brand === brand), activeSlots.map(s => ({ ...s, measurementBasis: configOf(s.slot).measurementBasis })), now) : null;
  lap('lift');
  const gammaOf = (slot: string) => learn.slots?.[slot]?.gamma ?? 0;
  const exploreOf = (slot: string) => learn.slots?.[slot]?.exploration ?? null;
  const controlOf = (slot: string, item: string) => learn.slots?.[slot]?.items?.[item] ?? null;

  const set = decideContent({
    ...(consent.tracking ? { requestId: crypto.randomUUID() } : {}),
    tenant: r.tenant, brand, page: r.page, visitorId: r.visitorId, sessionId: r.browsingSessionId || r.sessionId || shopper.sessionId, identityAnchor, nowMs: now,
    pieces: catalog.pieces, slots, affinity, regional, cell, arm,
    versions: { config: configRevision, catalog: catalogRev?.revision ?? 0, slots: slotsRev?.revision ?? 0, learn: learnRev?.revision ?? 0, lift: 0, prior: 0, policy: learnRev?.revision ?? 0 },
    configLabel: cfg.version,
    learning: { snapshots, gammaOf, exploreOf, controlOf, metadataOf: configOf },
    external,
    served,
  });

  lap('decide');
  if (consent.tracking) for (const record of set.records) record.retention = captureRetention(env, r.tenant, record.ts, now);
  for (const record of set.records) record.measurementBasis = configOf(record.slot).measurementBasis ?? 'served-v1';
  // W16 C4: every record — and so every receipt read off it — names the stage it
  // was decided in and the threshold version that derived it. Omitted where the
  // engine did not personalize, because there is no derived stage to claim.
  if (personalizes(consent) && shopper.stage) {
    const journey = { stage: shopper.stage, version: journeySource.version };
    for (const record of set.records) record.journey = journey;
  }
  // CW31: a shopper who declined personalization sees why on every receipt.
  if (!personalizes(consent)) for (const rec of set.records) rec.explain.note = `the site's defaults: ${!consent.tracking && !consent.personalization ? 'tracking and personalization are' : !consent.tracking ? 'tracking is' : 'personalization is'} off by the shopper's choice`;
  // The owner drains actual private I/O. In durable mode the shared admission
  // must finish before either ledger or learning effects can start.
  // CW31: with tracking withheld the engine writes nothing about this request, here or in the ledger (`write`).
  const synthetic = syntheticOperation();
  const trustedSynthetic = synthetic?.tenant === r.tenant && synthetic.subject === r.visitorId && synthetic.sessionId === r.sessionId && synthetic.expiresAt > Date.now();
  const captureRecords = r.offer ? trustedSynthetic ? set.records.filter(record => record.measurementBasis === 'served-v1') : []
    : set.records.every(record => record.measurementBasis === 'served-v1') ? set.records : [];
  const servedCapture = !r.offer && captureRecords.length > 0;
  const captureSet = { ...set, records: captureRecords };
  const afterResponse = consent.tracking && captureRecords.length > 0
    ? env.LEDGER_RECOVERY_ENABLED === 'true'
      ? recoverDecisions(env, captureSet, slotLearnConfigOf(learn)).then(result => { if (result.source.state !== 'recovered') reportLearningIncomplete('decisions', result.learning ?? null); })
      : fanDecisions(env, captureSet, slotLearnConfigOf(learn)).then(result => reportLearningIncomplete('decisions', result))
    : Promise.resolve();

  const decisions = await Promise.all(set.decisions.map(async (decision, index) => {
    const record = set.records[index]!;
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
    decisions,
    afterResponse,
    write: consent.tracking && servedCapture,
    sources: {
      catalog: { version: catalog.version ?? null, revision: catalogRev?.revision ?? 0, pieces: catalog.pieces.length },
      slots: { version: slotsDoc.version ?? null, revision: slotsRev?.revision ?? 0, count: slots.length },
      learn: { version: learn.version ?? null, revision: learnRev?.revision ?? 0 },
      config: { label: cfg.version, revision: configRevision },
      journey: journeySource,
      external: external ? { kind: external.kind, ref: external.ref, ok: false, ms: 0, version: null, reason: external.reason } : null,
      state: shopper.state,
      consent: { ...consent, personalized: personalizes(consent) },
      timings,
    },
  };
}
