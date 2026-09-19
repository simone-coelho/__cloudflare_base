// src/durable-objects/ShopperReflex.ts
// ─────────────────────────────────────────────────────────────────────────────
// ShopperReflex — the per-shopper hot Durable Object (doc 16 §6, P2).
//
// A SQLite-backed DO (wrangler migration v4, `new_sqlite_classes`) that owns BOTH
// the WebSocket and the affinity state, so state and compute are co-located and
// hot: event → decay+add → evaluate audiences → changed? → push, all inside one
// object, no KV session round-trip, no cross-object hop on the push.
//
//   • One object per shopper, keyed on the STABLE visitor id
//     (SHOPPER_REFLEX.idFromName(opt_visitor_id)) — every tab/device carrying the
//     same id lands on the same object and receives the same pushes.
//   • WebSocket Hibernation API (`state.acceptWebSocket` / `webSocketMessage`):
//     objects park at near-zero cost between events and survive eviction. The
//     socket attachment carries ONLY `{shopperId}` — the ~2KB attachment cap is a
//     hard rule; ALL state lives in `ctx.storage` and rehydrates on wake.
//   • Two ingest doors, ONE handler: `webSocketMessage` (`{type:'action', …}`
//     frames) and `fetch POST /ingest` (no-WS clients, sendBeacon on unload, and
//     the existing POST /realtime/action which forwards here when
//     REFLEX_HOST='do'). Both call the same `ingest(event)`; the DO stamps
//     `Date.now()` on arrival — client timestamps are advisory only (§4).
//   • Closed-form alarms: core's `nextCrossing()` solves the exact instant the
//     earliest current membership decays below θ_out; `alarm()` re-evaluates
//     lazily (decay is read-time math — the alarm never mutates scores), pushes
//     the exits, and schedules the next crossing. No polling, exact-time exits.
//   • Explicit category retention expires tagged behavior, never the owner's
//     security/erasure/recovery records or separate necessary choice clocks.
//
// ENGINE REUSE, NOT REIMPLEMENTATION — the design decision, recorded:
// RealtimeSegmentEngine is session-coupled by construction (SessionManager/KV
// sessions, cookie headers, and a broadcast that hops to the relay DO), so it is
// NOT instantiated in here. Instead this DO hosts a THIN pipeline that calls the
// SAME modules the request path calls — zero math or policy is copied:
//   ReflexCore (@/reflex/core)      → apply/tick/snapshot/attributesFrom/nextCrossing
//   attribute accrual + engagement  → applyEventToAttributes / calculateEngagementScore
//                                     (exported verbatim from RealtimeSegmentEngine)
//   qualification                   → getConnectors(env).segments — KvAudienceStore +
//                                     evaluateCondition via MockSegmentProvider,
//                                     seeded by the shared ensureAudiencesSeeded
//   journey stage                   → storedJourneyStage (@/services/JourneyStage)
//   ODP loop                        → updateOdpRing / refreshOdpSeedIfDue /
//                                     forwardEventToOdp / upsertOdpProfile (@/services/odpLoop)
//   decisions                       → getConnectors(env).decisions.decideAll over
//                                     CATALOG_FLAG_KEYS (Mock or Live per DECISION_SOURCE)
//
// Identity note: the ODP vuid remains SESSION-derived (SHA-256 of the DO-held
// sessionId, minted once per shopper object) until the identity cutover maps
// vuid ⇄ stable shopperId (doc 16 §8). "New shopper" rotates the client's
// visitor id → a fresh object → a fresh sessionId → a fresh vuid.
// ─────────────────────────────────────────────────────────────────────────────

import { actionOf, resolvedContentTouches, isContentAction } from '@/reflex/contentTelemetry';
import { liveVisit, mergeVisits, projectVisit, validEntry, validVisitContext, visitBucket, type VisitContext } from '@/services/visit';
import { bufferedEventAllowed, bufferedInterest, validBufferedAction } from '@/reflex/bufferedAction';
import type { Env } from '@/types/env';
import { SyntheticObjectBoundary, SyntheticUnavailable } from '@/ops/synthetic';
import { z } from 'zod';
import { historicalReflexSchema, sessionDataSchema, SessionManager, SESSION_TTL_SECONDS, type SessionData } from '@/services/SessionManager';
import { assertShopperSelectors, admitOwnerPrincipal, coarseRequestCF, dispatchOwnedRequest, ownedRequestPath, ownerHeld, ownerEnvironment, ownerEffect, recheckOwnerInvocation, retainOwnerWork, runOwnerOperation, requireConsentPurpose } from '@/identity/sessionAuthority';
import { ledgerOperationOwners, executeHeldLedger, executeLedgerOperation, forwardLedgerOperation, LEDGER_OPERATION_HARD_BYTES, type LedgerOwnerOperation } from '@/identity/sessionAuthority';
import { retentionBirth, externalRetentionBirths, mergeExternalRetention, requireRetention, readRetention, mergeRetention, RetentionUnavailable, type RetentionStamp, type ExternalRetention } from '@/retention';
import { pinRetention, pinProfileRetention, ownerRetentionDeadline, currentOwnerIdentity, pinRecoveryDeadline } from '@/identity/sessionAuthority';
import { runOwnerRecovery, resumeOwnerRecovery, disposeOwnerRecovery, recoveryCleanup, retireOwnerRecovery, stripExpiredOwnerRecovery, authorizeRecoveryBodies, authorizeRecoverySurvivors, recoveryOwnershipProof, RECOVERY_LIMITS, type OwnerRecovery, type RecoveryInput } from '@/ledger/recovery';
import { consentFromCookies, intersectConsent, refusalHints, storedConsent, personalizes, chooseConsent, consentInstruction, instructionOf, liveInstruction, carryConsent, consentDeadline, withConsent, CONSENT_SWITCHES, REFUSING, type Consent, type ConsentOperation } from '@/content/consent';
import { assertSessionTarget, capabilityToken, verifySessionCapability, shopperTenant, SHOPPER_HEADER, SHOPPER_PROTOCOL, SHOPPER_MAX_AGE, newAnonymousSession, signSessionCapability, issueContinuityProof, continuityDigest, SessionAccessError, type ContinuityDescriptor, type SessionCapability } from '@/identity/sessionCapability';
import { shopperObjectName } from '@/tenancy/objects';
import { IdentityStore, type ShopperRecord } from '@/identity/store';
import { isShopperId, isSalted } from '@/identity/shopperId';
import { loadTombstone, writeTombstone, resetVisitorRing } from '@/ledger/erasure';
import { canonicalErasureDiscoverySchema, canonicalErasureSchema, captureCanonicalErasure, erasureEffectOwners, executeOwnerErasure, ownerErasureEffectSchema, historicalErasureCapsuleSchema, erasureRawDigest } from '@/identity/erase';
import { DEFAULT_TENANT, isValidTenantId, tenantKey, type TenantId, type KVLike } from '@/tenancy/tenant';
import { ACTION_EVENT_TYPE_SET } from '@/events/actionTypes';
import { applyHistorical, mergeReflexStates } from '@/reflex/identityMerge';
import { fanInRegionTrend } from '@/reflex/regionTrend';
import { ReflexConfigUnavailableError } from '@/reflex/configStore';
import { PublicationError } from '@/config/publication';
import { applyProfileSnapshot, enrichmentInputs, mergeEnrichment, readEnrichment, type ImportOutcome, type ProfileEnrichment, type ProfileSnapshotRow } from '@/identity/profileEnrichment';
import type { PersonalizationUpdate } from './PersonalizationWebSocket';
import {
  apply as applyReflex,
  attributesFrom as reflexAttributes,
  emptyState,
  extractTouches,
  needsCatalogVocabulary,
  placeEvent,
  nextCrossing,
  snapshot as reflexSnapshot,
  tick as tickReflex,
  EMPTY_VOCABULARY,
  type RecognitionSignals,
  type ReflexConfig,
  type ReflexResult,
  type ReflexState,
} from '@/reflex/core';
import { tenantCatalogVocabulary, type CatalogVocabularySource } from '@/content/service';
import { getConnectors, type Connectors } from '@/connectors';
import { CATALOG_FLAG_KEYS } from '@/connectors/DecisionProvider';
import { advanceVisitJourney, FIRST_JOURNEY_STAGE, journeyCountersNow, journeyStageFrom, journeyThresholdsInForce, PERSISTED_STAGE, readTimeStageChange, storedJourneyStage, type JourneyWord, type VisitJourney } from '@/services/JourneyStage';
import {
  RETAIL_SIGNAL_DEFAULTS,
  applyEventToAttributes,
  calculateEngagementScore,
  ensureAudiencesSeeded,
  hasSegmentChanges,
  type ActionEvent,
} from '@/services/RealtimeSegmentEngine';
import {
  forwardEventToOdp,
  mapActionToOdp,
  projectOdpState,
  projectedOdpSegments,
  mergeOdpState,
  odpEnabled,
  refreshOdpSeedIfDue,
  stageOnlyOdpProjection,
  updateOdpRing,
  upsertOdpProfile,
  warnStageProjectionSkipped,
} from '@/services/odpLoop';
import {
  DEFAULT_SURFACE,
  tenantAudienceKeyPrefix,
  resolveTenantCatalog,
  resolveTenantReflexConfig,
  resolveSurface,
  type DemoSurface,
} from '@/demos/registry';

/**
 * Storage key `'affinity'` — exactly the record doc 16 §6 / the P2 spec mandates.
 * `reflex` is raw (R, tLast) per dimension·value — NEVER pre-decayed (§4).
 */
export interface AffinityRecord {
  externalRetention?: ExternalRetention;
  retention?: RetentionStamp;
  shopperId: string;
  reflex: ReflexState;
  odpContext?: string;
  odpSeed: string[];
  odpSeedAt: number;
  odpRecentEvents: Array<Record<string, unknown>>;
  lastSeen: number;
  configVersion: string;
}

/**
 * Storage key `'pipeline'` — the DO-side companion record that lets ingest() run
 * the SAME pipeline as the request path (behavioral counters → journey stage →
 * qualification → decisions). Kept under a SEPARATE key so `'affinity'` stays
 * byte-shaped to the spec. (Documented deviation: doc 16 §6 lists only the
 * affinity record; without these the DO could not qualify the counter-based seed
 * audiences or derive the journey stage the request path derives.)
 */
export interface PipelineRecord extends VisitContext {
  profileEnrichment?: ProfileEnrichment;
  attributes: Record<string, any>;
  segments: string[];
  journeyStage: 'early' | 'mid' | 'late';
  /**
   * W16 C4: the counters of the CURRENT VISIT the reported journey stage is
   * derived from, beside the cumulative `attributes` above and separate from
   * the durable taste vector in the `affinity` record. Absent on records
   * written before this field; those start their journey from zero.
   */
  journey?: VisitJourney;
  /** DO-held session id. No longer what the ODP vuid derives from — see visitorId. */
  sessionId: string;
  /**
   * The stable first-party visitor id (`opt_visitor_id`), which is also the name
   * this object is keyed on. Persisted for the same reason `surface` is: the
   * alarm and snapshot paths run with no event to resolve it from, and the ODP
   * vuid must not change just because a write happened on one of those paths.
   * ABSENT on records written before the CW7b cutover; those fall back to the
   * session id and keep exactly the identity they already had.
   */
  visitorId?: string;
  firstSeen: number;
  sessionCount: number;
  /** Demo surface this shopper object belongs to (@/demos/registry). ABSENT ⇒
      'coach' — every record written before the multi-surface split is retail's.
      Persisted because the alarm/snapshot paths have no event to resolve from. */
  surface?: DemoSurface;
}

/** Routing authority for audiences, not provenance for pre-existing behavior. */
type AudienceOwner = Pick<SessionCapability, 'tenant' | 'subject' | 'sessionId'>;
type InternalContext = Pick<SessionCapability, 'tenant' | 'subject'>;

const identityId = z.string().regex(/^[A-Za-z0-9_.-]{1,200}$/);
const identityTime = z.number().int().safe().nonnegative();
const assuranceSchema = z.enum(['signed', 'site']);
const linkSourceSchema = z.enum(['login', 'signup', 'checkout', 'import', 'other']);
const consentSchema = z.custom<Consent>(value => { try { storedConsent(value); return value !== undefined; } catch { return false; } });
const grantSchema = z.object({ tenant: z.string().refine(isValidTenantId), subject: identityId, sessionId: identityId,
  kind: z.enum(['anonymous', 'recognized']), grantId: z.string().uuid(), authorityEpoch: z.string().uuid(),
  iat: identityTime, exp: identityTime,
}).strict().refine(g => g.exp > g.iat && g.exp - g.iat <= SHOPPER_MAX_AGE
  && (g.kind === 'recognized' ? isShopperId(g.subject) : /^vis-[0-9a-f-]{36}$/.test(g.subject)));
const authoritySchema = z.object({ version: z.literal(1), epoch: z.string().uuid(), grants: z.record(z.string(), grantSchema) }).strict();
type GrantAuthority = z.infer<typeof authoritySchema>;
// ── W16 C6: anonymous return continuity ─────────────────────────────────────
// ONE storage key, by exact name (R48(b)2). The object keeps the digest of the
// current proof, the generation and the chain's original fixed expiry — never
// the proof itself and never its signature — plus the one deterministic
// successor receipt a lost response may be answered from, once.
const CONTINUITY_KEY = 'continuity';
/** Every key in the object's own allow-lists, widened by exact key for C6. */
const OWNED_STATE_KEYS = ['affinity', 'pipeline', 'audienceOwner', 'consent', CONTINUITY_KEY];
const continuityDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const continuityRecordSchema = z.object({
  version: z.literal(1),
  chain: z.string().uuid(),
  generation: z.number().int().positive(),
  digest: continuityDigestSchema,
  issuedAt: identityTime,
  expiresAt: identityTime,
  mode: z.enum(['direct', 'broker']),
  purpose: z.string().min(1).max(120),
  revision: z.number().int().nonnegative(),
  /** The subject's own browsing session: a return joins it, never invents a
   * second one, so her retained taste is the same record on either host. */
  sessionId: identityId,
  /** The single lost-response receipt: the consumed digest, the operation it
   * was consumed under, and the exact grant that answer carried. */
  receipt: z.object({ operationId: z.string().uuid(), digest: continuityDigestSchema, grant: grantSchema }).strict().optional(),
}).strict();
type ContinuityRecord = z.infer<typeof continuityRecordSchema>;
const continuitySettingsSchema = z.object({
  mode: z.enum(['direct', 'broker']), windowMs: z.number().finite().positive(),
  purpose: z.string().min(1).max(120), revision: z.number().int().nonnegative(),
}).strict();
const rotationSchema = z.object({ operation: z.enum(['detach', 'reset']), source: grantSchema, replacement: grantSchema,
  consent: consentSchema, status: z.enum(['prepared', 'complete']),
}).strict();
const intentSchema = z.object({ version: z.literal(1), id: z.string().uuid(), tenant: z.string().refine(isValidTenantId),
  visitorId: identityId.refine(value => !isShopperId(value)), sourceSessionId: identityId, sourceEpoch: z.string().uuid(),
  shopperId: z.string().refine(isShopperId), at: identityTime, assurance: assuranceSchema, source: linkSourceSchema, salted: z.boolean(),
}).strict();
const registrationSchema = z.object({ version: z.literal(1), intent: intentSchema, targetEpoch: z.string().uuid(), sequence: identityTime.refine(n => n > 0) }).strict();
const admissionSchema = registrationSchema.omit({ intent: true }).extend({ digest: z.string().regex(/^[a-f0-9]{64}$/) });
const registrationAckSchema = z.object({ version: z.literal(1), sequence: identityTime.refine(n => n > 0), erasureId: z.string().uuid(), digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const erasureReceiptSchema = z.object({ version: z.literal(1), kind: z.enum(['target', 'source', 'object']),
  highWater: identityTime, witness: z.string().regex(/^[a-f0-9]{64}$/).nullable(), continuationEpoch: z.string().uuid().optional(),
  canonical: canonicalErasureSchema.optional(),
  physical: historicalErasureCapsuleSchema.optional(),
  cutoff: identityTime.optional(),
}).strict().refine(value => value.kind === 'target' ? value.witness === null
  && value.physical === undefined && value.cutoff === undefined : value.canonical === undefined && value.highWater === 0
    && (value.kind === 'source' ? value.witness !== null : value.witness === null && value.physical === undefined && value.cutoff === undefined));
const registrationKey = (sequence: number) => 'identityRegistration:' + String(sequence).padStart(16, '0');
const sourceErasureKey = (erasureId: string, witness: string) => 'identitySourceErasure:' + erasureId + ':' + witness;
const sessionErasureSchema = z.object({ version: z.literal(1), sessionId: identityId, epoch: z.string().uuid(),
  receiptKey: z.string().min(1), witness: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
}).strict();
const sessionErasureKey = (erasureId: string, sid: string) => 'identitySessionErasure:' + erasureId + ':' + sid;
const transferSchema = z.object({
  version: z.literal(1), id: z.string().uuid(), tenant: z.string().refine(isValidTenantId),
  visitorId: identityId.refine(value => !isShopperId(value)), sourceSessionId: identityId,
  shopperId: z.string().refine(isShopperId), sourceEpoch: z.string().uuid(), targetEpoch: z.string().uuid(), targetSequence: identityTime.refine(n => n > 0), at: identityTime,
  assurance: assuranceSchema, source: linkSourceSchema, salted: z.boolean(),
  profileDigest: z.string().regex(/^[a-f0-9]{64}$/), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  affinity: z.custom<AffinityRecord | null>(), pipeline: z.custom<PipelineRecord | null>(),
}).strict();
type IdentityTransfer = z.infer<typeof transferSchema>;
const identityResultSchema = z.object({
  shopperId: z.string().refine(isShopperId), visitorId: identityId, outcome: z.literal('linked'),
  assurance: assuranceSchema, sessionId: identityId, audiences: z.array(z.string()), cookieHeaders: z.array(z.string().max(4096)).max(16),
  changes: z.object({ entered: z.array(z.string()), exited: z.array(z.string()), explain: z.array(z.object({
    ts: z.number(), audience: z.string(), dim: z.string(), value: z.string(), direction: z.enum(['enter', 'exit']),
    score: z.number(), thetaIn: z.number(), thetaOut: z.number(), trigger: z.string(), configVersion: z.string(),
  })) }), consent: consentSchema, grant: grantSchema,
});
const preparedTransferSchema = z.object({ transfer: transferSchema, status: z.enum(['prepared', 'complete']), scrubbed: z.literal(true).optional() }).strict()
  .refine(value => !value.scrubbed || value.status === 'complete' && value.transfer.affinity === null && value.transfer.pipeline === null);
const transferReceiptSchema = z.object({ transfer: transferSchema.omit({ affinity: true, pipeline: true }), result: identityResultSchema,
  retention: z.custom<RetentionStamp>().optional(), externalRetention: z.custom<ExternalRetention>().optional(), scrubbed: z.literal(true).optional() }).strict();
const memberSchema = z.object({ visitorId: identityId, linkedAt: identityTime, assurance: assuranceSchema, source: linkSourceSchema }).strict();
const membersSchema = z.object({ shopperId: z.string().refine(isShopperId), createdAt: identityTime, salted: z.boolean(),
  visitors: z.array(memberSchema).max(50), retention: z.custom<RetentionStamp>().optional(),
  history: z.object({ rows: identityTime, latestAt: identityTime, appliedAt: identityTime }).optional(),
}).strict();
async function identityDigest(value: unknown): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function transferFingerprint(transfer: Omit<IdentityTransfer, 'fingerprint' | 'affinity' | 'pipeline'>): Promise<string> {
  return identityDigest([transfer.version, transfer.id, transfer.tenant, transfer.visitorId, transfer.sourceSessionId,
    transfer.shopperId, transfer.sourceEpoch, transfer.targetEpoch, transfer.targetSequence, transfer.at, transfer.assurance, transfer.source, transfer.salted, transfer.profileDigest]);
}

interface IngestOutcome {
  status: number;
  body: Record<string, unknown>;
  update: PersonalizationUpdate | null;
}

/**
 * Event types accepted at this object's doors. The same list POST /realtime/action
 * validates against, imported rather than restated: this Set used to be written
 * out here beside a comment asking it to stay in step, and it did not. It was
 * missing `purchase` and all four content events, so the object answered 400 to
 * every content click and staging stayed on the slower session host (doc 31 §4).
 */
const ACTION_EVENT_TYPES = ACTION_EVENT_TYPE_SET;

/** Never set an alarm in the past; give the current event a beat to settle. */
const MIN_ALARM_DELAY_MS = 50;

/** Cheap per-minute in-DO rate limit (doc 16 §12) — override with REFLEX_RATE_LIMIT_PER_MIN. */
const DEFAULT_RATE_LIMIT_PER_MIN = 240;


/**
 * Closed-form alarm time (doc 16 §6): the earlier of
 *   • the exact instant the earliest CURRENT membership decays below θ_out
 *     (core's nextCrossing — t* = tLast + τ·ln(R·(1−θ_out)/(K·θ_out))), and
 *   • the retention horizon (lastSeen + retentionMs — idle self-expiry, §12),
 * clamped to now+MIN_ALARM_DELAY_MS so a boundary crossing fires immediately but
 * never busy-loops. Pure — exported for the P2 test suite.
 */
export function computeNextAlarm(
  reflex: ReflexState,
  lastSeen: number,
  now: number,
  config: ReflexConfig,
  retentionMs: number
): number {
  const crossing = nextCrossing(reflex, now, config);
  const retentionAt = lastSeen + retentionMs;
  const at = crossing === null ? retentionAt : Math.min(crossing, retentionAt);
  return Math.max(at, now + MIN_ALARM_DELAY_MS);
}

export class ShopperReflex {
  private state: DurableObjectState;
  /** CW25. The NAME of the person's object this browser's object forwards to; undefined until read. */
  private forwardTo: string | null | undefined = undefined;
  /**
   * CW31. The shopper's two consent switches, stored under their own key so the
   * instruction survives when nothing else may be written. Absent means OFF;
   * undefined is the unread in-memory sentinel.
   */
  private consent: Consent | null | undefined = undefined;
  private rawEnv: Env;
  private synthetic: SyntheticObjectBoundary;
  private get env(): Env { return ownerEnvironment(this, this.rawEnv); }

  /** In-memory mirrors of storage; rehydrated from ctx.storage on wake. */
  private affinity: AffinityRecord | null = null;
  private pipeline: PipelineRecord | null = null;
  // Missing means legacy; null means explicitly invalidated by an identity write.
  // Keep malformed values distinct so they cannot regain authority.
  private audienceOwner: unknown = undefined;
  private loaded = false;
  private seeded = new Set<DemoSurface>();

  /** Serializes ingest/alarm runs — the reducer is strictly sequential even when
      awaits on KV/ODP would otherwise let events interleave. */
  private chain: Promise<unknown> = Promise.resolve();
  private projectionChain: Promise<unknown> = Promise.resolve();

  /** Cheap per-minute rate limit. In-memory by design (zero storage writes): a
      hibernation wake resets it, but sustained bursts — the abuse case — keep the
      object alive, so the window holds exactly when it matters. */
  private rate = { windowStart: 0, count: 0 };
  private dropped = { rateLimited: 0, unknownProduct: 0, invalid: 0 };

  constructor(state: DurableObjectState, env: Env) {
    this.synthetic = new SyntheticObjectBoundary(state, env, 'SHOPPER_REFLEX', () => {
      this.invalidateMirrors(); this.affinity = null; this.pipeline = null; this.audienceOwner = undefined;
      this.seeded.clear(); this.rate = { windowStart: 0, count: 0 };
    });
    this.state = this.synthetic.state;
    this.rawEnv = this.synthetic.env;
  }

  // ── HTTP surface ────────────────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    return this.synthetic.run(request, () => this.fetchScoped(request)).catch(error => {
      if (error instanceof SyntheticUnavailable) { const response = json({ ok: false, error: 'Shopper session unavailable' }, 401); response.headers.set('X-Monitor-Refusal', 'boundary'); return response; }
      throw error;
    });
  }

  private async fetchScoped(request: Request): Promise<Response> {
    const url = new URL(request.url);
    let principal: SessionCapability | undefined;
    let internal: InternalContext | undefined;
    if (capabilityToken(request) !== null || request.headers.get('Upgrade') === 'websocket') {
      try {
        assertShopperSelectors(request);
        principal = await verifySessionCapability(this.env, capabilityToken(request), shopperTenant(this.env, request));
        assertSessionTarget(principal, url.searchParams.get('userId'), url.searchParams.get('sessionId'));
        if (this.state.id.toString() !== this.env.SHOPPER_REFLEX.idFromName(shopperObjectName(principal.tenant, principal.subject)).toString()) throw new SessionAccessError();
      } catch { return json({ ok: false, error: 'Shopper session unavailable' }, 401); }
    }

    // Only internal callers construct these headers. Public signed requests use
    // their capability, never a body owner/config or forwarded header authority.
    if (!principal && (request.headers.has('X-Reflex-Tenant') || request.headers.has('X-Reflex-Subject'))) {
      const tenant = request.headers.get('X-Reflex-Tenant'), subject = request.headers.get('X-Reflex-Subject');
      if (!isValidTenantId(tenant) || !subject || !/^[A-Za-z0-9_.-]{1,200}$/.test(subject)
        || !this.isActualObject(tenant, subject)) return json({ ok: false, error: 'Shopper context unavailable' }, 401);
      internal = { tenant, subject };
    }
    if (!principal && !internal && (url.pathname.startsWith('/identity/') || url.pathname === '/consent/refusal')) {
      return json({ ok: false, error: 'Shopper context unavailable' }, 401);
    }

    if (url.pathname === '/authority/request') {
      if (!principal) return json({ ok: false, error: 'Shopper session unavailable' }, 401);
      const selected = request.headers.get('X-Owner-Request-URL');
      if (!selected || selected.length > 8192) return json({ ok: false }, 401);
      const headers = new Headers(request.headers); headers.delete('X-Owner-Request-URL');
      let cf: unknown = {};
      const transferred = headers.get('X-Owner-Coarse-CF'); headers.delete('X-Owner-Coarse-CF');
      if (transferred) { if (transferred.length > 256) return json({ ok: false }, 401); try { cf = JSON.parse(transferred); } catch { return json({ ok: false }, 401); } }
      const routed = new Request(selected, { method: request.method, headers,
        ...(request.body ? { body: request.body, duplex: 'half' } : {}),
      } as RequestInit);
      Object.defineProperty(routed, 'cf', { value: coarseRequestCF(cf) });
      try { assertShopperSelectors(routed); } catch { return json({ ok: false }, 401); }
      if (!ownedRequestPath(routed) || shopperTenant(this.env, routed) !== principal.tenant) return json({ ok: false }, 401);
      return this.serialize(async () => {
        // Rotation/link receipts validate their exact retired source themselves.
        const transition = /\/(?:identity\/(?:link|detach)|session\/reset)$/.test(new URL(routed.url).pathname);
        if (!transition) {
          const preferences = /\/session\/(?:[^/]+\/)?preferences$/.test(new URL(routed.url).pathname)
            ? await routed.clone().json() as Record<string, unknown> : null;
          const restrictive = !!preferences;
          try { await this.assertOwned(principal!, routed, restrictive); }
          catch { throw new SessionAccessError(); }
        }
        return dispatchOwnedRequest(this, this.env, routed, principal!, req => this.fetch(req));
      }).catch(error => {
        if (error instanceof SessionAccessError) return json({ ok: false, error: 'Shopper session unavailable' }, 401);
        throw error;
      });
    }
    if (url.pathname === '/authority/relay-frame' || url.pathname === '/authority/relay-upgrade') {
      if (!principal) return json({ ok: false }, 401);
      return this.serialize(async () => {
        await this.assertOwned(principal!, request, false, false);
        if (url.pathname === '/authority/relay-frame') {
          const body = z.object({ connectionId: z.string().uuid(), type: z.enum(['heartbeat', 'subscribe', 'unsubscribe']) }).strict().parse(await request.json());
          return this.relayOperation('frame', principal!.subject, principal!.tenant, body);
        }
        const target = new URL(request.url); target.pathname = '/owner/upgrade';
        return this.env.PERSONALIZATION_WEBSOCKET.get(this.env.PERSONALIZATION_WEBSOCKET.idFromName(shopperObjectName(principal!.tenant, principal!.subject)))
          .fetch(new Request(target, request));
      });
    }
    if (request.method === 'POST' && url.pathname === '/identity/link') {
      return this.handleLink(request, principal ?? internal!);
    }
    if (request.method === 'POST' && url.pathname === '/identity/admission') {
      if (principal) return json({ ok: false, error: 'Internal admission required' }, 401);
      return this.handleTransferAdmission(request, internal!);
    }
    if (request.method === 'POST' && url.pathname === '/identity/transfer') {
      if (principal) return json({ ok: false, error: 'Internal transfer required' }, 401);
      return this.handleTransfer(request, internal!);
    }
    if (request.method === 'POST' && url.pathname === '/identity/recovery/proof') {
      if (principal || !internal || !this.isActualObject(internal.tenant, internal.subject)) return json({ ok: false }, 401);
      const text = await request.text(); if (new TextEncoder().encode(text).length > 1024 * 1024) return json({ ok: false }, 413);
      const body = z.object({ wire: z.string().max(512 * 1024) }).strict().parse(JSON.parse(text));
      return this.serialize(async () => json({ ok: true, proof: await recoveryOwnershipProof(this.state.storage, internal!.tenant, internal!.subject, body.wire) }));
    }
    if (request.method === 'POST' && url.pathname === '/identity/ledger') {
      if (principal || !internal) return json({ ok: false }, 401);
      const bytes = await request.text();
      if (new TextEncoder().encode(bytes).byteLength > LEDGER_OPERATION_HARD_BYTES) return json({ ok: false }, 413);
      const raw = z.object({ operation: z.unknown(), index: z.number().int().nonnegative() }).strict().parse(JSON.parse(bytes));
      const operation = raw.operation as LedgerOwnerOperation, owners = await ledgerOperationOwners(this.env, operation);
      if (owners[raw.index]?.tenant !== internal.tenant || owners[raw.index]?.subject !== internal.subject) throw new SessionAccessError();
      return this.serialize(() => executeHeldLedger(this, owners, async () => {
        if (operation.kind === 'survivors') {
          pinRecoveryDeadline(operation.value.expiresAt);
          await authorizeRecoverySurvivors(this.state.storage, this.env, operation.value, internal!.tenant, internal!.subject,
            (saved, until) => this.recoveryGuard(saved, until));
        }
        if (operation.kind === 'quarantine' && operation.value.expiresAt > Date.now()) pinRecoveryDeadline(operation.value.expiresAt);
        if (operation.kind === 'quarantine' && operation.value.ownership && operation.value.expiresAt > Date.now()) {
          await authorizeRecoveryBodies(this.state.storage, this.env, internal!.tenant, internal!.subject, [JSON.parse(operation.wire)],
            (saved, until) => this.recoveryGuard(saved, until));
          pinRecoveryDeadline(operation.value.expiresAt);
        }
        if (operation.kind === 'consume' && operation.recoveryDeadline !== undefined) pinRecoveryDeadline(operation.recoveryDeadline);
        if (operation.kind === 'consume' && operation.recovery) await authorizeRecoveryBodies(this.state.storage, this.env,
          internal!.tenant, internal!.subject, operation.bodies, (saved, until) => this.recoveryGuard(saved, until));
        const result = raw.index + 1 < owners.length
          ? await forwardLedgerOperation(this.env, operation, owners, raw.index + 1)
          : await executeLedgerOperation(this.env, operation);
        return json(result);
      }));
    }
    if (request.method === 'POST' && url.pathname === '/identity/erase/effect') {
      if (principal || !internal) return json({ ok: false }, 401);
      const effect = ownerErasureEffectSchema.parse(await request.json());
      const owners = erasureEffectOwners(effect);
      if (effect.job.tenant !== internal.tenant || owners[effect.index] !== internal.subject) throw new SessionAccessError();
      return this.serialize(async () => {
        const guard = (path: string, sessionId?: string) => this.handleIdentityErasure(new Request('https://owner' + path, {
          method: 'POST', body: JSON.stringify({ erasureId: effect.erasureId, ...(sessionId ? { sessionId } : {}) }),
        }), internal!, path);
        if (effect.job.canonical?.subject === internal!.subject) {
          const receipt = erasureReceiptSchema.parse(await this.state.storage.get('identityErasure:' + effect.erasureId));
          if (JSON.stringify(receipt.canonical) !== JSON.stringify(effect.job.canonical)) throw new SessionAccessError();
          // Digest witnesses never inherit the legacy session-only exception:
          // even byte-identical or absent successor KV requires the same empty barrier.
          await guard('/identity/erase/guard');
        }
        if (effect.step.kind !== 'session') await guard('/identity/erase/guard');
        const relevant = effect.step.kind === 'session'
          ? effect.job.sessions.filter(session => 'session:' + session.sid === effect.step.key)
          : effect.job.sessions.filter(session => session.userId === internal!.subject);
        for (const session of relevant) await guard('/identity/erase/session', session.sid);
        if (effect.index + 1 < owners.length) {
          const next = owners[effect.index + 1];
          return this.env.SHOPPER_REFLEX.get(this.env.SHOPPER_REFLEX.idFromName(shopperObjectName(internal!.tenant, next)))
            .fetch('https://owner/identity/erase/effect', { method: 'POST', headers: {
              'Content-Type': 'application/json', 'X-Reflex-Tenant': internal!.tenant, 'X-Reflex-Subject': next,
            }, body: JSON.stringify({ ...effect, index: effect.index + 1 }) });
        }
        await executeOwnerErasure(this.env, effect);
        return json({ ok: true });
      });
    }
    if (request.method === 'POST' && url.pathname.startsWith('/identity/erase/')) {
      if (principal) return json({ ok: false, error: 'Internal erasure required' }, 401);
      return this.handleIdentityErasure(request, internal!, url.pathname);
    }
    if (request.method === 'POST' && url.pathname === '/identity/activate') {
      if (!principal) return json({ ok: false }, 401);
      const body = z.object({ consent: consentSchema, existingOnly: z.boolean().optional() }).strict().parse(await request.json());
      return this.serialize(async () => {
        try {
          await this.assertOwned(principal!, undefined, false, !body.existingOnly);
          const consent = carryConsent(body.consent, principal!, storedConsent(await this.state.storage.get('consent')));
          await this.scheduleConsentAlarm(consent);
          assertSessionTarget(principal!);
          if (consent.instruction) await this.state.storage.put('consent', consent.instruction);
          this.consent = consent;
          if ((this.env.REFLEX_HOST ?? 'session') === 'session' && !personalizes(consent)) {
            await new SessionManager(this.env, { tenant: principal!.tenant, principal }).restrictConsent(principal!.sessionId, consent);
          }
          await this.scheduleConsentAlarm();
          return json({ ok: true, consent });
        } catch { this.invalidateMirrors(); return json({ ok: false }, 401); }
      });
    }
    if (request.method === 'POST' && url.pathname === '/identity/rotate') {
      if (!principal) return json({ ok: false }, 401);
      return this.handleRotation(request, principal);
    }
    // W16 C6. Issue needs the shopper's own live capability; a consume has none
    // by construction (her capability expired days ago), so it is an internal
    // call from the session route, which has already verified the proof's
    // signature, tenant, transport and configuration revision.
    if (request.method === 'POST' && url.pathname === '/identity/continuity/issue') {
      if (!principal) return json({ ok: false }, 401);
      return this.handleContinuityIssue(request, principal);
    }
    if (request.method === 'POST' && url.pathname === '/identity/continuity/consume') {
      if (principal || !internal) return json({ ok: false }, 401);
      return this.handleContinuityConsume(request, internal);
    }

    if (request.headers.get('Upgrade') === 'websocket') {
      return this.serialize(async () => {
        try { await this.assertOwned(principal!, request); } catch { return json({ ok: false, error: 'Shopper session unavailable' }, 401); }
        return this.handleUpgrade(url, principal!);
      });
    }
    if ((principal && url.pathname === '/consent' && request.method === 'GET') || (url.pathname === '/consent/refusal' && request.method === 'POST')) {
      return this.serialize(async () => {
        try {
          if (principal) await this.assertOwned(principal, undefined, true);
          const current = storedConsent(await this.state.storage.get('consent'));
          this.consent = current;
          const consent = request.method === 'POST'
            ? await this.setConsent(intersectConsent(current, refusalHints(await request.json()))) : current;
          if (principal && request.method === 'POST' && (this.env.REFLEX_HOST ?? 'session') === 'session') {
            await new SessionManager(this.env, { tenant: principal.tenant, principal }).restrictConsent(principal.sessionId, consent);
          }
          return json({ ok: true, consent });
        } catch { return json({ ok: false, error: 'Consent state unavailable' }, 503); }
      });
    }
    if (principal && ['/personalization', '/segments', '/analytics'].includes(url.pathname)) {
      const p = principal;
      return this.serialize(async () => {
        try { await this.assertOwned(p, request); } catch { return json({ ok: false, error: 'Shopper session unavailable' }, 401); }
        const now = Date.now();
        if (url.pathname === '/analytics') {
          if (this.affinity) pinProfileRetention(this.env, this.affinity, p.tenant);
          const analytics = { sessionId: p.sessionId, analytics: {
          sessionDuration: this.pipeline ? now - this.pipeline.firstSeen : 0,
          pageViews: this.pipeline?.attributes.page_views ?? 0,
          engagementScore: calculateEngagementScore(this.pipeline?.attributes ?? {}), segmentHistory: projectedOdpSegments(this.pipeline?.segments ?? [], this.affinity, await projectOdpState(this.env, this.audienceTenant(p), this.affinity)),
          }, timestamp: now };
          recheckOwnerInvocation(this); return json(analytics);
        }
        const consent = await this.consentNow();
        assertSessionTarget(p);
        let tenant: TenantId;
        try { tenant = this.audienceTenant(p); } catch { return json({ ok: false, error: 'Shopper session unavailable' }, 401); }
        // An owned read is an answer from THIS tenant's configured runtime, so
        // the configuration authority is required before any answer is served,
        // including the necessary refusal below: an absent, invalid or
        // unreadable publication refuses here with its own typed error rather
        // than serving a default. A demo scope keeps its compiled identity.
        await resolveTenantReflexConfig(this.env, tenant, this.surface());
        if (!personalizes(consent)) {
          if (url.pathname === '/segments') return request.method === 'POST'
            ? json({ ok: false, error: 'Shopper consent refused segment assignment' }, 403)
            : json({ userId: p.subject, segments: [], timestamp: now });
          return json({ userId: p.subject, sessionId: p.sessionId, isNewSession: !this.pipeline,
            config: { segments: [], featureVariables: {}, featureFlags: {}, experiments: {} }, cookiesSet: false, timestamp: now });
        }
        requireConsentPurpose(consent, 'personalization');
        const connectors = getConnectors(this.env, tenant);
        if (url.pathname === '/segments') {
          if (request.method === 'POST') {
            const body = await request.json() as { segment?: unknown; source?: unknown };
            if (typeof body.segment !== 'string') return json({ ok: false, error: 'segment required' }, 400);
            if (!this.affinity && this.pipeline) throw new SessionAccessError();
            const freshRetention = this.affinity ? undefined : retentionBirth(this.env, tenant, 'profile', now, now);
            const freshExternal = this.affinity ? undefined : externalRetentionBirths(this.env, tenant, now, now);
            if (freshRetention) pinProfileRetention(this.env, { retention: freshRetention, externalRetention: freshExternal }, tenant);
            const cfg = await resolveTenantReflexConfig(this.env, tenant, this.surface());
            assertSessionTarget(p);
            const affinity = this.affinity ?? { shopperId: p.subject, reflex: emptyState(cfg), odpSeed: [], odpSeedAt: 0, odpRecentEvents: [], lastSeen: now, configVersion: cfg.version,
              retention: freshRetention, externalRetention: freshExternal };
            const previous = this.pipeline ?? { attributes: {}, segments: [], journeyStage: 'early' as const, sessionId: p.sessionId, visitorId: p.subject, firstSeen: now, sessionCount: 0 };
            const pipeline = { ...previous, segments: [...new Set([...await this.enrichedSegments(connectors, tenant, now), body.segment])] };
            const update = await this.buildUpdate(connectors, now, typeof body.source === 'string' ? body.source : 'manual', null, calculateEngagementScore(pipeline.attributes), cfg, tenant, p, { affinity, pipeline, segmentsProjected: true });
            assertSessionTarget(p);
            await this.persistAudienceState(affinity, pipeline, { tenant, subject: p.subject, sessionId: p.sessionId });
            assertSessionTarget(p);
            await this.pushFrame(update);
            return json({ success: true, userId: p.subject, segment: body.segment, timestamp: now });
          }
          await this.ensureSeeded(this.surface(), tenant);
          assertSessionTarget(p);
          const segments = this.pipeline && (this.pipeline.profileEnrichment !== undefined || this.affinity?.odpSeed !== undefined) ? await this.enrichedSegments(connectors, tenant, now)
            : await connectors.segments.fetchQualifiedSegments(p.subject, {
            userId: p.subject, attributes: { ...RETAIL_SIGNAL_DEFAULTS, ...this.pipeline?.attributes }, segments: this.pipeline?.segments ?? [],
            ...(tenant === DEFAULT_TENANT ? { surface: this.surface() } : {}),
          });
          assertSessionTarget(p);
          return json({ userId: p.subject, segments, timestamp: now });
        }
        const cfg = await resolveTenantReflexConfig(this.env, tenant, this.surface());
        const update = this.affinity && this.pipeline && consent.tracking && consent.personalization
          ? await this.buildUpdate(connectors, now, 'snapshot', null, calculateEngagementScore(this.pipeline.attributes), cfg, tenant, p) : null;
        assertSessionTarget(p);
        return json({ userId: p.subject, sessionId: p.sessionId, isNewSession: !this.pipeline, config: {
          segments: update?.data.segments ?? this.pipeline?.segments ?? [], featureVariables: update?.data.featureVariables ?? {},
          featureFlags: Object.fromEntries(Object.entries(update?.data.decisions ?? {}).map(([key, decision]) => [key, decision.enabled])),
          experiments: Object.fromEntries(Object.entries(update?.data.decisions ?? {}).filter(([, decision]) => decision.variationKey).map(([key, decision]) => [key, decision.variationKey])),
        }, cookiesSet: false, timestamp: now });
      });
    }

    // CW25. A browser that was recognised forwards to the person's object: the
    // same snapshot, one hop. Ingest must enforce THIS object's ownership before
    // any effect; linked legacy browsers cannot forward unsigned mutations.
    if (!principal && url.pathname === '/snapshot') {
      await this.load();
      if (!internal) {
        const subject = this.affinity?.shopperId ?? this.pipeline?.visitorId;
        if (!subject || !this.isActualObject(DEFAULT_TENANT, subject)) return json({ ok: false, error: 'Shopper context unavailable' }, 401);
        internal = { tenant: DEFAULT_TENANT, subject };
      }
      const forwarded = await this.forwardIfLinked(request, internal);
      if (forwarded) return forwarded;
    }
    if (request.method === 'POST' && url.pathname === '/ingest') {
      return this.handleIngest(request, principal);
    }
    if (request.method === 'GET' && url.pathname === '/snapshot') {
      return this.serialize(async () => {
        try { if (principal) await this.assertOwned(principal, request); else this.assertInternalState(internal!); } catch { return json({ ok: false, error: 'Shopper session unavailable' }, 401); }
        if (url.searchParams.get('projection') === 'content') {
          if (!principal) return json({ ok: false, error: 'Shopper session unavailable' }, 401);
          const consent = await this.consentNow();
          // This projection serves decisions, so it is an answer from THIS
          // tenant's configured runtime and the authority is required before any
          // answer, including the refusal projection below: an absent, invalid or
          // unreadable configuration publication refuses here with its own typed
          // error instead of a default. A demo scope keeps its compiled identity.
          const cfg = await resolveTenantReflexConfig(this.env, principal.tenant, this.surface());
          if (!personalizes(consent)) return json({ ok: true, consent, affinity: null, journeyStage: null });
          requireConsentPurpose(consent, 'personalization');
          if (this.affinity) pinProfileRetention(this.env, this.affinity, principal.tenant);
          const at = Date.now();
          return json({ ok: true, consent,
            affinity: this.affinity ? reflexSnapshot(this.affinity.reflex, at, cfg) : null,
            // W16 C4 / R29: the content decision reads the shared word here and
            // maps it to the persisted cell token through PERSISTED_STAGE; the
            // same derivation the SDK hydrate answers with.
            journeyStage: journeyStageFrom(journeyCountersNow(this.pipeline?.journey, this.affinity?.lastSeen, at), journeyThresholdsInForce(cfg)),
            visit: this.pipeline ? { visitCount: this.pipeline.visitCount, lastVisitAt: this.pipeline.lastVisitAt,
              entryChannel: this.pipeline.entryChannel, lastSeen: this.affinity?.lastSeen } : null,
          });
        }
        if (url.searchParams.get('projection') === 'sort') {
          if (!principal) return json({ ok: false, error: 'Shopper session unavailable' }, 401);
          // This caller needs only consent-authorized dimensions, not a general
          // private snapshot. Ownership and any necessary refusal write above
          // complete inside the same serialized operation before this projection.
          await this.load();
          const consent = await this.consentNow();
          const surface = resolveSurface({ surface: url.searchParams.get('surface') ?? this.surface() });
          // As above: the sort projection serves decisions, so the configuration
          // authority is required before any answer, refusal included.
          const cfg = await resolveTenantReflexConfig(this.env, principal.tenant, surface);
          if (!personalizes(consent)) return json({ ok: true, consent, affinity: null, surface });
          if (this.affinity) pinProfileRetention(this.env, this.affinity, principal.tenant);
          requireConsentPurpose(consent, 'personalization');
          return json({ ok: true, consent, surface, affinity: this.affinity ? { dims: reflexSnapshot(this.affinity.reflex, Date.now(), cfg).dims } : null });
        }
        return this.handleSnapshot(principal?.tenant ?? internal!.tenant, principal);
      });
    }
    // CW25, the identity doors. `export` reads what this browser learned;
    // `absorb` folds another object's export into this one, which then IS the
    // person; `forward` leaves this object pointing at the person's.
    if (request.method === 'GET' && url.pathname === '/identity/export') {
      return this.serialize(async () => {
        try { if (principal) await this.assertOwned(principal, request); } catch { return json({ ok: false, error: 'Shopper session unavailable' }, 401); }
        await this.load();
        if (!principal) this.assertInternalState(internal!);
        return json({ ok: true, affinity: this.affinity, pipeline: this.pipeline, forwardTo: await this.forwardTarget(), ...(principal ? { consent: storedConsent(await this.state.storage.get('consent')) } : {}) });
      });
    }
    if (request.method === 'POST' && url.pathname === '/identity/absorb') {
      return this.handleAbsorb(request, principal ?? internal!);
    }
    if (request.method === 'POST' && url.pathname === '/identity/import/result') {
      if (principal || !internal) return json({ ok: false }, 401);
      const body = z.object({ operationId: z.string().uuid() }).strict().parse(await request.json());
      return this.serialize(async () => {
        return this.completeImportProjection('identityImport:' + body.operationId, internal!);
      });
    }
    if (request.method === 'POST' && url.pathname === '/identity/import/admission/result') {
      if (principal || !internal) return json({ ok: false }, 401);
      const body = z.object({ operationId: z.string().uuid() }).strict().parse(await request.json());
      return this.serialize(async () => {
        const saved = await this.state.storage.get<{ epoch: string; expires: number }>('identityImport:' + body.operationId);
        if (!saved || saved.epoch !== (await this.grantAuthority())?.epoch || saved.expires <= Date.now()) throw new SessionAccessError();
        return json({ prepared: true });
      });
    }
    if (request.method === 'POST' && ['/identity/import', '/identity/import/admission'].includes(url.pathname)) {
      if (principal) return json({ ok: false, error: 'Historical import requires internal operator authority' }, 401);
      return this.handleImport(request, internal!, url.pathname.endsWith('/admission'));
    }
    // CW31. The shopper's consent switches, as the site reports them. This is the
    // one write that happens even when tracking is off: it is the instruction
    // not to write, and it has to be remembered to be honoured.
    if (request.method === 'POST' && url.pathname === '/consent') {
      let body: { tracking?: unknown; personalization?: unknown; choice?: ConsentOperation } = {};
      try { body = await request.json(); } catch { return json({ ok: false, error: 'invalid JSON body' }, 400); }
      return this.serialize(async () => {
        try {
          if (principal) await this.assertOwned(principal, undefined, true);
          else await this.assertLegacyWriter();
        } catch { return json({ ok: false, error: 'Shopper session unavailable' }, 401); }
        if (!principal || await this.transferState() || await this.intentState()) return json({ ok: false, error: 'Explicit owned choice required' }, 401);
        try {
          const patch = Object.fromEntries(CONSENT_SWITCHES.filter(k => body[k] !== undefined).map(k => [k, body[k]]));
          const hints = consentFromCookies(request.headers.get('Cookie'));
          for (const key of CONSENT_SWITCHES) if (typeof body[key] === 'boolean') hints[key] = true;
          const next = chooseConsent(intersectConsent(storedConsent(await this.state.storage.get('consent')), hints), patch, body.choice!, principal);
          await this.scheduleConsentAlarm(consentInstruction(next));
          assertSessionTarget(principal);
          try { await this.state.storage.put('consent', next); }
          catch (error) { this.consent = undefined; throw error; }
          this.consent = consentInstruction(next);
          if (!this.consent.tracking) await retireOwnerRecovery(this.state.storage);
          await this.scheduleConsentAlarm();
          assertSessionTarget(principal);
          return json({ ok: true, consent: this.consent });
        } catch (error) {
          if (error instanceof Error && error.message === 'Consent choice conflict') return json({ ok: false, error: error.message }, 409);
          if (error instanceof Error && error.message === 'Invalid explicit consent choice') return json({ ok: false, error: error.message }, 400);
          throw error;
        }
      });
    }
    if (request.method === 'POST' && url.pathname === '/identity/forward') {
      let body: { to?: unknown } = {};
      try { body = await request.json(); } catch { /* fallthrough */ }
      if (typeof body.to !== 'string' || body.to === '') return json({ ok: false, error: 'to required' }, 400);
      await this.serialize(async () => {
        if (principal) await this.assertOwned(principal, request);
        else await this.assertLegacyWriter();
        await this.load();
        this.assertInternalState(principal ?? internal!);
        await this.assertNotTransferred();
        try { await this.state.storage.put('forwardTo', body.to); }
        catch (error) { this.forwardTo = undefined; throw error; }
        this.forwardTo = body.to as string;
      });
      return json({ ok: true, forwardTo: body.to });
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      if (principal) return this.serialize(async () => {
        try { await this.assertOwned(principal!); }
        catch { return json({ ok: false }, 401); }
        return json({ status: 'healthy', shopperId: this.affinity?.shopperId ?? null, sockets: this.state.getWebSockets().length,
          audiences: this.affinity?.reflex.audiences ?? [], lastSeen: this.affinity?.lastSeen ?? null, dropped: this.dropped });
      });
      await this.load();
      return json({
        status: 'healthy',
        shopperId: this.affinity?.shopperId ?? null,
        sockets: this.state.getWebSockets().length,
        audiences: this.affinity?.reflex.audiences ?? [],
        lastSeen: this.affinity?.lastSeen ?? null,
        dropped: this.dropped,
      });
    }
    // Erasure door (§12 privacy/lifecycle): wipes the vector + memberships.
    // GDPR/CCPA path and the operator's hard reset. Category expiry is selective.
    if (request.method === 'POST' && url.pathname === '/reset') {
      return this.serialize(async () => {
        try { if (principal) await this.assertOwned(principal, request); } catch { return json({ ok: false, error: 'Shopper session unavailable' }, 401); }
        await this.eraseWithBarrier();
        return json({ ok: true });
      });
    }

    return new Response('Not Found', { status: 404 });
  }

  // ── Door 1: the WebSocket (Hibernation API) ─────────────────────────────────

  private async handleUpgrade(url: URL, principal: SessionCapability): Promise<Response> {
    assertSessionTarget(principal, url.searchParams.get('userId'), url.searchParams.get('sessionId'));
    const shopperId = principal.subject;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Hibernation accept: the runtime may evict this object between messages and
    // wake it on the next frame — near-zero idle cost, sockets stay connected.
    this.state.acceptWebSocket(server);
    // HARD RULE: the attachment carries ONLY {shopperId} (~2KB cap). All affinity
    // state lives in ctx.storage and rehydrates via load() on wake.
    server.serializeAttachment({ shopperId, principal });

    // Same welcome frame the relay DO sends — client transport code is unchanged.
    server.send(
      JSON.stringify({
        type: 'connected',
        connectionId: crypto.randomUUID(),
        userId: shopperId,
        timestamp: Date.now(),
      })
    );

    return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': SHOPPER_PROTOCOL } });
  }

  /** Hibernation handler — wakes the object on any client frame. */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;
    let frame: any;
    try {
      frame = JSON.parse(message);
    } catch {
      return;
    }
    if (!frame || typeof frame !== 'object') return;
    if (frame.processing !== undefined || frame.event?.processing !== undefined) {
      ws.close(1008, 'Buffered actions require HTTP'); return;
    }
    const attachment = (safeAttachment(ws) ?? {}) as { shopperId?: string; principal?: SessionCapability };
    try {
      if (!attachment.principal) throw new SessionAccessError();
      assertSessionTarget(attachment.principal, frame.userId, frame.sessionId);
      if (frame.event) assertSessionTarget(attachment.principal, frame.event.userId, frame.event.sessionId);
    } catch { ws.close(1008, 'Shopper session unavailable'); return; }

    if (frame.type === 'heartbeat') {
      await this.serialize(async () => {
        try {
          await this.assertOwned(attachment.principal!, undefined, false, false);
          ws.send(JSON.stringify({ type: 'heartbeat_response', timestamp: Date.now() }));
        } catch { ws.close(1008, 'Shopper session unavailable'); }
      });
      return;
    }

    if (frame.type !== 'action') return; // subscribe/unsubscribe etc. — no-ops here

    const event = this.normalizeEvent(frame, attachment.shopperId);
    if (!event) {
      this.dropped.invalid++;
      return;
    }
    // Same reducer as POST /ingest; the outcome reaches the client as the push
    // this ingest emits over the DO's own sockets (no HTTP response on this door).
    await this.serialize(async () => {
      try { await this.assertOwned(attachment.principal!, undefined, false, false); assertSessionTarget(attachment.principal!, event.userId); }
      catch { ws.close(1008, 'Shopper session unavailable'); return; }
      return this.ingest(event, attachment.principal);
    });
  }

  async webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    // Nothing to clean: connection bookkeeping IS state.getWebSockets(); shopper
    // state persists in storage; the pending alarm keeps decay-out + retention live.
  }

  async webSocketError(_ws: WebSocket, error: unknown): Promise<void> {
    console.error('ShopperReflex webSocketError');
  }

  // ── Door 2: POST /ingest ────────────────────────────────────────────────────

  private async handleIngest(request: Request, principal?: SessionCapability): Promise<Response> {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return json({ success: false, error: 'invalid JSON body' }, 400);
    }
    if (body?.processing !== undefined || body?.event?.processing !== undefined) {
      const now = Date.now();
      if (Object.hasOwn(body, 'event') || !validBufferedAction(body, now)) return json({ success: false, error: 'Invalid buffered action' }, 400);
      const event = this.normalizeEvent(body);
      if (!event) return json({ success: false, error: 'Invalid buffered action' }, 400);
      if (!principal) return json({ success: false, error: 'Shopper session unavailable' }, 401);
      try { assertSessionTarget(principal, event.userId, body.sessionId); }
      catch { return json({ success: false, error: 'Shopper session unavailable' }, 401); }
      const outcome = await this.serialize(() => this.ingestBuffered({ ...event, processing: 'buffered',
        eventId: body.eventId, timestamp: body.timestamp, browsingSessionId: body.browsingSessionId }, principal, request, Date.now()));
      return json(outcome.body, outcome.status);
    }
    const event = this.normalizeEvent(body, undefined);
    if (!event) {
      this.dropped.invalid++;
      return json({ success: false, error: 'invalid action event' }, 400);
    }
    // This internal HTTP door receives the route's coarse request.cf fields.
    // Keep them transient; shared socket normalization must ignore client geo.
    if (principal && body.geo && typeof body.geo === 'object') event.geo = {
      country: typeof body.geo.country === 'string' ? body.geo.country : null,
      regionCode: typeof body.geo.regionCode === 'string' ? body.geo.regionCode : null,
    };
    const outcome = await this.serialize(async () => {
      try {
        if (principal) { assertSessionTarget(principal, event.userId, body.sessionId); await this.assertOwned(principal, request); }
        else {
          await this.assertLegacyWriter();
          await this.load();
          await this.assertNotTransferred();
          if (this.audienceOwner !== undefined || !this.isActualObject(DEFAULT_TENANT, event.userId) || await this.forwardTarget()
            || (this.affinity && this.affinity.shopperId !== event.userId)
            || (this.pipeline?.visitorId && this.pipeline.visitorId !== event.userId)) throw new SessionAccessError();
        }
      } catch { return { body: { success: false, error: 'Shopper session unavailable' }, status: 401, update: null }; }
      return this.ingest(event, principal);
    });
    return json(outcome.body, outcome.status);
  }

  /**
   * Accept either a bare ActionEvent (the POST /realtime/action body shape) or a
   * WS frame `{type:'action', event:{…}}` / flattened `{type:'action', action, data}`.
   */
  private normalizeEvent(raw: any, fallbackShopperId?: string): ActionEvent | null {
    const src = raw && typeof raw === 'object' && raw.event && typeof raw.event === 'object' ? raw.event : raw;
    if (!src || typeof src !== 'object') return null;

    const type =
      typeof src.type === 'string' && ACTION_EVENT_TYPES.has(src.type)
        ? src.type
        : typeof src.action === 'string' && ACTION_EVENT_TYPES.has(src.action)
          ? src.action
          : null;
    if (!type) return null;

    const userId = typeof src.userId === 'string' && src.userId ? src.userId : fallbackShopperId;
    if (!userId || !validEntry(src.entry)) return null;

    return {
      type: type as ActionEvent['type'],
      userId,
      ...(typeof src.anonymousId === 'string' ? { anonymousId: src.anonymousId } : {}),
      data: src.data && typeof src.data === 'object' ? src.data : {},
      source: typeof src.source === 'string' ? src.source : 'ws',
      ...(typeof src.surface === 'string' ? { surface: src.surface } : {}),
      ...(src.entry === undefined ? {} : { entry: src.entry }),
      // Advisory only — ingest() stamps its own arrival time (§4).
      timestamp: typeof src.timestamp === 'number' ? src.timestamp : Date.now(),
    };
  }

  /** Buffered HTTP has no live counters, seeding, region/ODP work or retention refresh. */
  private async ingestBuffered(event: ActionEvent, principal: SessionCapability, request: Request, now: number): Promise<IngestOutcome> {
    try {
      assertSessionTarget(principal, event.userId);
      if (!this.isActualObject(principal.tenant, principal.subject)) throw new SessionAccessError();
      await this.assertGrant(principal, false);
      await this.assertNotTransferred();
      if (!this.allowIngest(now)) return { status: 429, update: null,
        body: { success: false, error: 'rate_limited', retryAfterMs: this.rate.windowStart + 60_000 - now } };
      const stored = await this.state.storage.get(['affinity', 'pipeline', 'forwardTo', 'audienceOwner', 'consent']);
      if (stored.get('forwardTo') !== undefined) throw new SessionAccessError();
      const affinity = stored.get('affinity') as AffinityRecord | undefined;
      const pipeline = stored.get('pipeline') as PipelineRecord | undefined;
      const currentConsent = storedConsent(stored.get('consent'));
      const consent = intersectConsent(currentConsent, consentFromCookies(request.headers.get('Cookie')), refusalHints(event.data?.consent));
      // W16 C8.09 (R21): the buffered answer carries the same input diagnostic
      // the live answer carries, naming every product reference the engine could
      // not place. Absent until the event has actually been placed.
      const answer = (interestApplied: boolean, dropped?: string, signals?: RecognitionSignals): IngestOutcome => ({ status: 200, update: null,
        body: { success: true, processing: 'buffered', interestApplied, sessionId: principal.sessionId, cookiesUpdated: false, consent,
          ...(dropped ? { dropped } : {}), ...(signals ? { signals } : {}) } });
      if (affinity === undefined || pipeline === undefined) return answer(false, 'profile_missing');
      try {
        z.object({ shopperId: z.literal(principal.subject), reflex: historicalReflexSchema,
          odpContext: z.string().optional(), odpSeed: z.array(z.string()), odpSeedAt: z.number().finite().nonnegative(),
          odpRecentEvents: z.array(z.record(z.string(), z.unknown())), lastSeen: z.number().finite().nonnegative(), configVersion: z.string(),
        }).parse(affinity);
        z.object({ attributes: z.record(z.string(), z.unknown()), segments: z.array(z.string()),
          journeyStage: z.enum(['early', 'mid', 'late']), sessionId: z.literal(principal.sessionId),
          visitorId: z.literal(principal.subject).optional(), firstSeen: z.number().finite().nonnegative(), sessionCount: z.number().finite().nonnegative(),
        }).parse(pipeline);
        if (!validVisitContext(pipeline)) throw new SessionAccessError();
        readEnrichment(pipeline.profileEnrichment);
      } catch { throw new SessionAccessError(); }
      assertSessionTarget(principal, event.userId);
      // Rehydrate only validated committed state. The candidate stays local until put succeeds.
      this.affinity = affinity; this.pipeline = pipeline; this.audienceOwner = stored.get('audienceOwner'); this.loaded = true;
      const tenant = this.audienceTenant(principal);
      if (consent.tracking !== currentConsent.tracking || consent.personalization !== currentConsent.personalization) {
        await this.setConsent(consent);
      }
      this.consent = consent;
      if (!consent.tracking) return answer(false, 'tracking_refused');
      requireConsentPurpose(consent, 'tracking');
      pinProfileRetention(this.env, affinity, tenant);
      if (!await bufferedEventAllowed(this.env, tenant, principal.subject, event.timestamp)) return answer(false, 'erased');
      if (!consent.personalization) return answer(false);
      requireConsentPurpose(consent, 'personalization');
      const interest = await bufferedInterest(this.env, tenant, event, { ...pipeline, reflex: affinity.reflex,
        attributes: { ...RETAIL_SIGNAL_DEFAULTS, ...pipeline.attributes }, odpSeed: affinity.odpSeed, odpContext: affinity.odpContext,
        ...{ externalRetention: affinity.externalRetention } }, getConnectors(this.env, tenant).segments, now);
      assertSessionTarget(principal, event.userId);
      if (!interest.applied) return answer(false, undefined, interest.signals);
      const nextAffinity = { ...affinity, reflex: interest.reflex!, configVersion: interest.reflex!.configVersion };
      const nextPipeline = { ...pipeline, segments: interest.segments };
      // Do not write/bless audienceOwner or extend the retained lifetime.
      await this.persistAudienceState(nextAffinity, nextPipeline, this.audienceOwner, false);
      const wake = computeNextAlarm(nextAffinity.reflex, nextAffinity.lastSeen, now, interest.config!, this.retentionMs());
      const pending = await this.state.storage.getAlarm();
      if (pending === null || wake < pending) await this.state.storage.setAlarm(wake);
      return answer(true, undefined, interest.signals);
    } catch (error) {
      return { status: error instanceof SessionAccessError ? 401 : 503, update: null,
        body: { success: false, error: 'Buffered action unavailable' } };
    }
  }

  // ── THE reducer: one handler behind both doors ──────────────────────────────

  private async ingest(event: ActionEvent, principal?: SessionCapability): Promise<IngestOutcome> {
    // The ENGINE clock is authoritative — a forged/skewed client clock cannot
    // inflate affinity (doc 16 §4). Everything downstream uses this stamp.
    const now = Date.now();

    if (!this.allowIngest(now)) {
      this.dropped.rateLimited++;
      return {
        status: 429,
        body: { success: false, error: 'rate_limited', retryAfterMs: this.rate.windowStart + 60_000 - now },
        update: null,
      };
    }

    await this.load();
    // Both HTTP and socket actions may restrict switches, never enable them.
    // The explicit preference door retains that separate authority.
    const hints = refusalHints(event.data?.consent);
    const currentConsent = await this.consentNow();
    const consent = !hints.tracking || !hints.personalization
      ? await this.setConsent(intersectConsent(currentConsent, hints)) : currentConsent;
    if (!consent.tracking) return {
      status: 200,
      body: { success: true, message: 'Action not tracked: shopper consent refused', sessionId: principal?.sessionId ?? this.pipeline?.sessionId ?? null, cookiesUpdated: false, consent },
      update: null,
    };
    requireConsentPurpose(consent, 'tracking');
    if (personalizes(consent)) requireConsentPurpose(consent, 'personalization');
    let tenant: TenantId;
    try { tenant = principal ? this.audienceTenant(principal) : DEFAULT_TENANT; }
    catch { return { status: 401, body: { success: false, error: 'Shopper session unavailable' }, update: null }; }
    const owner = principal ? { tenant, subject: principal.subject, sessionId: principal.sessionId } : undefined;
    const retention = this.affinity ? pinProfileRetention(this.env, this.affinity, tenant)
      : pinRetention(this.env, retentionBirth(this.env, tenant, 'profile', now, now), tenant, 'profile');
    const externalRetention = this.affinity?.externalRetention ?? (!this.affinity ? externalRetentionBirths(this.env, tenant, now, now) : undefined);
    pinProfileRetention(this.env, { retention, externalRetention }, tenant);

    // Surface hints select demo products only for the default tenant. The
    // validated owner above remains authoritative for every catalog lookup.
    const surface = resolveSurface({
      source: event.source,
      surface: event.surface ?? (event.data as Record<string, unknown> | undefined)?.surface as string | undefined,
    });
    const surfaceCatalog = await resolveTenantCatalog(tenant, surface);
    const cfg = await resolveTenantReflexConfig(this.env, tenant, surface);

    // Trust & abuse (§12): validate referenced products against the in-memory
    // catalog index — an unknown productId is dropped and counted, never scored.
    const data = event.data ?? {};
    const pid = data.productId ?? data.product_id ?? data.sku;
    const product = pid != null ? surfaceCatalog?.getProduct(String(pid)) : undefined;
    // W16 C8.03/C8.08/C8.10 (R47, R64, R67): the vocabulary an input is measured
    // against is the catalogue THIS tenant decides from, read once per event
    // beside the config. Each value answers for itself, and the answer names
    // every product reference the engine could not place. A content interaction
    // carries its own attributes into the registry exactly as a product event
    // does, so it answers to the same vocabulary; only an event with nothing for
    // the vocabulary to answer about skips the read.
    const eventData = data as Record<string, unknown>;
    const heldProduct = product as unknown as Record<string, unknown> | undefined;
    const contentEvent = isContentAction(actionOf(event));
    const vocabulary = contentEvent || needsCatalogVocabulary(eventData, heldProduct, cfg)
      ? await tenantCatalogVocabulary(this.env, tenant, cfg, surfaceCatalog as unknown as CatalogVocabularySource | null)
      : EMPTY_VOCABULARY;
    const placed = placeEvent(eventData, heldProduct, cfg, vocabulary);
    let signals: RecognitionSignals = placed.signals;
    // CW24: where the scope scores event-carried attributes, an unknown id with
    // registry attributes on it is a customer's product, not an abuse attempt —
    // but a value on a dimension the tenant's own catalogue names, that the
    // catalogue does not name, stays unknown and builds nothing (HANDOFF §12),
    // so an event whose every value is refused reaches the drop below.
    const eventTouches = !product && cfg.eventAttributes === 'event-when-unknown' ? placed.touches : [];
    if (pid != null && !product && eventTouches.length === 0) {
      this.dropped.unknownProduct++;
      return {
        status: 200,
        body: {
          success: true,
          message: 'Action ignored: unknown productId',
          dropped: 'unknown_product',
          // The counter says THAT one was dropped; this names WHICH input it was.
          signals,
          sessionId: this.pipeline?.sessionId ?? null,
          cookiesUpdated: false,
          consent,
        },
        update: null,
      };
    }

    // Resolve before changing the audience owner or any aliased pipeline state.
    const reflexOn = (this.env.REFLEX_ENABLED ?? 'true') !== 'false';
    const contentEventTouches = reflexOn && contentEvent
      ? await resolvedContentTouches(this.env, tenant, eventData, cfg, vocabulary) : null;
    // A content event is placed by the tenant's content catalogue against the
    // same vocabulary, so its diagnostic answers from the touches that read
    // produced — the same "at least one value built taste" rule (R64).
    if (contentEventTouches) signals = { recognized: contentEventTouches.length > 0, unrecognized: [] };
    await this.ensureSeeded(surface, tenant);
    const connectors = getConnectors(this.env, tenant); // fresh per run — mirrors the per-request triad

    const aff: AffinityRecord = this.affinity ?? {
      shopperId: event.userId,
      reflex: emptyState(cfg),
      odpSeed: [],
      odpSeedAt: 0,
      odpRecentEvents: [],
      lastSeen: now,
      configVersion: cfg.version,
    };
    const pipe: PipelineRecord = this.pipeline ? { ...this.pipeline } : {
      attributes: {},
      segments: [],
      journeyStage: 'early',
      sessionId: principal?.sessionId ?? crypto.randomUUID(),
      firstSeen: now,
      sessionCount: 0,
      // Only non-default surfaces are tagged, so a retail record's stored bytes
      // are exactly what they were before the split.
      ...(surface === DEFAULT_SURFACE ? {} : { surface }),
    };

    // The stable id rides in on every event as `userId`. Recorded once and kept,
    // so a later alarm or snapshot resolves the same vuid as a live event would.
    if (!pipe.visitorId && typeof event.userId === 'string' && event.userId !== '') {
      pipe.visitorId = event.userId;
    }

    // 1. Behavioral counters — the SAME accrual the request path runs.
    const attributes = { ...pipe.attributes };
    applyEventToAttributes(attributes, event, surfaceCatalog);
    const engagementScore = calculateEngagementScore(attributes);

    // 2. The pure core (§4): decay-then-accumulate + hysteresis evaluation.
    let reflex: ReflexResult | null = null;
    if (reflexOn) {
      const action = actionOf(event);
      const touches = contentEventTouches ?? (product ? extractTouches(product as unknown as Record<string, unknown>, cfg) : eventTouches);
      reflex = applyReflex(
        aff.reflex,
        {
          action,
          touches,
        },
        now,
        cfg
      );
      // CW6: the same touches, fanned into the shopper's region as a population count.
      // Registered with the object's own waitUntil so the call survives the reply.
      const keepAlive = retainOwnerWork;
      if (principal && !(principal.tenant === DEFAULT_TENANT && surface !== DEFAULT_SURFACE)) {
        keepAlive(fanInRegionTrend(this.env, {
          tenant: principal.tenant, geo: event.geo, now, touches, w: cfg.weights[action] ?? 0,
        }));
      }
    }

    const odp = await projectOdpState(this.env, tenant, aff);
    const projectedSegments = projectedOdpSegments(pipe.segments, aff, odp);
    // 3. Local qualification through the ODP seam (KvAudienceStore + evaluateCondition).
    const ctxAttrs: Record<string, any> = { ...RETAIL_SIGNAL_DEFAULTS, ...attributes };
    const qualCtx = {
      userId: aff.shopperId,
      anonymousId: event.anonymousId,
      attributes: ctxAttrs,
      segments: pipe.profileEnrichment === undefined ? projectedSegments : [],
      ...(tenant === DEFAULT_TENANT ? { surface } : {}),
    };
    // W16 C4: the journey of THIS VISIT, counted beside the cumulative
    // attributes. The boundary is the stored lastSeen, exactly as liveVisit
    // reads it below, and the purchase that counts in its own decision closes
    // the journey so the NEXT decision starts again from zero (R32(3)).
    const newJourney = advanceVisitJourney(pipe.journey, this.affinity?.lastSeen, now, event);
    const journeyThresholds = journeyThresholdsInForce(cfg);
    const journeyWord = journeyStageFrom(newJourney.counters, journeyThresholds);
    const priorWord = journeyStageFrom(journeyCountersNow(pipe.journey, this.affinity?.lastSeen, now), journeyThresholds);
    // W16 C5.09 (R85(b)): ONE derivation behind one name. What this object
    // STORES for her, and what it tells the customer's own destination, is the
    // stage the engine REPORTS for this visit, carried into the persisted
    // grammar by the one mapping point (R32(2)) — not the older cumulative rule,
    // which counts her whole history and so still said `late` after the purchase
    // that closed her journey. A shopper this object may not personalize keeps
    // whatever was stored: nothing about her is derived without that authority.
    const journeyStage = personalizes(consent) || aff.odpSeed.some(s => !odp.odpSeed.includes(s)) ? PERSISTED_STAGE[journeyWord] : pipe.journeyStage;
    ctxAttrs.journey_stage = journeyStage;
    // Reflex scores are computed FRESH into the context (they decay by construction —
    // never persisted), so store-published affinity audiences can gte them.
    if (reflex) Object.assign(ctxAttrs, reflexAttributes(reflex.state, now, cfg));
    const external = personalizes(consent) ? enrichmentInputs(pipe.profileEnrichment) : { attributes: {}, audiences: [] };
    Object.assign(ctxAttrs, external.attributes);
    let localSegments: string[] = [];
    try {
      if (personalizes(consent)) localSegments = await connectors.segments.fetchQualifiedSegments(aff.shopperId, qualCtx);
    } catch (e) {
      console.error('ShopperReflex qualification failed (degrading to reflex-only)');
    }

    // 4. ODP loop (§8) — same ring + seed policy as the request path (shared fns).
    let { odpSeed, odpSeedAt, odpRecentEvents: odpRing } = odp;
    let odpReceipt: { receiptId: string; type: string; action?: string; product_id?: string } | undefined;
    const membershipChanged = !!reflex && (reflex.changes.entered.length > 0 || reflex.changes.exited.length > 0);
    if (personalizes(consent) && odpEnabled(this.env, tenant)) {
      odpRing = updateOdpRing(odpRing, event, now, tenant, this.env);
      ({ seed: odpSeed, seedAt: odpSeedAt } = await refreshOdpSeedIfDue(
        this.env,
        tenant,
        { visitorId: pipe.visitorId, sessionId: pipe.sessionId },
        odpRing,
        { seed: odpSeed, seedAt: odpSeedAt },
        now,
        membershipChanged
      ));
    }
    if (odpEnabled(this.env, tenant)) {
      // Forward to the memory OFF the hot path. Fire-and-forget: a DO stays alive
      // while I/O is in flight, and forwardEventToOdp never throws. The receipt
      // lands over THIS object's own sockets — no relay hop.
      const mapped = mapActionToOdp(event, tenant, this.env);
      if (mapped) {
        odpReceipt = {
          receiptId: crypto.randomUUID(),
          type: mapped.type,
          ...(mapped.action ? { action: mapped.action } : {}),
          ...(typeof mapped.data.product_id === 'string' ? { product_id: mapped.data.product_id } : {}),
        };
        retainOwnerWork(forwardEventToOdp(this.env, tenant, event, { visitorId: pipe.visitorId, sessionId: pipe.sessionId }, odpReceipt.receiptId, (receipt) => {
          const publication = this.serialize(() => this.pushFrame({ type: 'odp_receipt', userId: aff.shopperId, data: receipt }));
          // A late provider callback re-enters the owner and rechecks each
          // current recipient; it never reuses a released invocation's grant.
          if (ownerHeld(this)) retainOwnerWork(publication);
          else this.state.waitUntil(publication);
        }));
      }
    }

    // 5. Union (local ∪ reflex ∪ ODP seed) + change detection — same triggers.
    // The surface namespace is applied to the core's membership keys here so they
    // match the generated audience keys (prefix '' for coach ⇒ same array).
    const prefix = tenantAudienceKeyPrefix(tenant, surface);
    const reflexAudiences = reflex
      ? prefix
        ? reflex.state.audiences.map((k) => prefix + k)
        : reflex.state.audiences
      : [];
    const newSegments = personalizes(consent) ? Array.from(
      new Set([...localSegments, ...reflexAudiences, ...odpSeed, ...external.audiences])
    ) : projectedSegments;
    const segmentsChanged = hasSegmentChanges(pipe.segments, newSegments);
    // Either grammar moving is a personalization trigger: the stored audience
    // attribute, or the reported journey word the SDK paints (W16 C4).
    const stageChanged = pipe.journeyStage !== journeyStage || priorWord !== journeyWord;

    // 6. Derive candidates without publishing them to readers.
    const nextAffinity: AffinityRecord = {
      retention, externalRetention,
      shopperId: aff.shopperId,
      reflex: reflex ? reflex.state : aff.reflex,
      odpContext: odp.odpContext,
      odpSeed,
      odpSeedAt,
      odpRecentEvents: odpRing,
      lastSeen: now,
      configVersion: cfg.version,
    };
    const nextPipeline: PipelineRecord = {
      profileEnrichment: pipe.profileEnrichment,
      attributes,
      segments: newSegments,
      journeyStage,
      journey: newJourney,
      sessionId: pipe.sessionId,
      visitorId: pipe.visitorId,
      firstSeen: pipe.firstSeen,
      sessionCount: pipe.sessionCount + 1,
      ...liveVisit(pipe, this.affinity?.lastSeen, now, event.entry),
      ...(surface === DEFAULT_SURFACE ? {} : { surface }),
    };

    // 7. Build against the candidate; derivation failure leaves committed mirrors intact.
    let update: PersonalizationUpdate | null = null;
    if (personalizes(consent) && (segmentsChanged || stageChanged)) {
      update = await this.buildUpdate(connectors, now, event.source, reflex, engagementScore, cfg, tenant, undefined,
        { affinity: nextAffinity, pipeline: nextPipeline, journeyWord });
    }

    // 8. Publish only after the coalesced write resolves. Later output/alarm
    // failures do not undo this accepted write (disk flush remains the platform's responsibility).
    const sessionIdOut = nextPipeline.sessionId;
    await this.persistAudienceState(nextAffinity, nextPipeline, owner);
    if (update) {
      await this.pushFrame({ ...update, serverTimestamp: Date.now() });
      // §4 score upsert: on membership changes, persist the reflex's live scores
      // onto the ODP profile (the memory carrying the edge's numbers).
      const affPayload = update.data.affinity;
      if (consent.tracking && odpEnabled(this.env, tenant) && affPayload && membershipChanged) {
        retainOwnerWork(upsertOdpProfile(this.env, tenant, { visitorId: pipe.visitorId, sessionId: pipe.sessionId }, affPayload, journeyStage));
      }
    }

    await this.scheduleNextCrossing(now, cfg);

    return {
      status: 200,
      body: {
        success: true,
        message: update
          ? 'Action processed and personalization updated'
          : 'Action processed, no personalization changes needed',
        ...(update ? { update } : {}),
        signals,
        sessionId: sessionIdOut,
        cookiesUpdated: false, // identity is the stable visitor id — no session cookies on this host
        ...(odpReceipt ? { odp: odpReceipt } : {}),
        consent,
      },
      update,
    };
  }

  // ── The push envelope (same PersonalizationUpdate shape as the request path) ─

  private async buildUpdate(
    connectors: Connectors,
    now: number,
    source: string,
    reflex: ReflexResult | null,
    engagementScore: number,
    cfg: ReflexConfig,
    tenant: TenantId,
    principal?: SessionCapability,
    candidate?: { affinity: AffinityRecord; pipeline: PipelineRecord; segmentsProjected?: boolean;
      /** W16 C4: the stage THIS event's own decision was made in, which a purchase moves before it closes the journey. */
      journeyWord?: JourneyWord },
  ): Promise<PersonalizationUpdate> {
    requireConsentPurpose(await this.consentNow(), 'personalization');
    const aff = candidate?.affinity ?? this.affinity!;
    const original = candidate?.pipeline ?? this.pipeline!;
    const odp = await projectOdpState(this.env, tenant, aff);
    const segments = source === 'snapshot'
      ? await this.enrichedSegments(connectors, tenant, now, cfg, aff, original)
      : candidate?.segmentsProjected ? original.segments : projectedOdpSegments(original.segments, aff, odp);
    // W16 C5.09 (R85(b)): a seed this tenant no longer confirms cannot move her
    // stage. The older cumulative rule let a segment pin one ahead of the counts,
    // so losing `ready_to_buy` moved it; the one derivation reads only the
    // counters of the current visit, so recomputing here could only put the
    // legacy value back.
    const pipe = { ...original, segments };
    const surface = pipe.surface ?? DEFAULT_SURFACE;
    const surfaceCatalog = await resolveTenantCatalog(tenant, surface);
    if (principal) assertSessionTarget(principal);
    const reflexOn = (this.env.REFLEX_ENABLED ?? 'true') !== 'false';

    const attributes: Record<string, any> = { ...RETAIL_SIGNAL_DEFAULTS, ...pipe.attributes };
    if (reflexOn) Object.assign(attributes, reflexAttributes(aff.reflex, now, cfg));

    const visit = projectVisit(pipe, aff.lastSeen, now);
    const userAttributes = {
      segments: pipe.segments,
      ...attributes,
      engagement_score: engagementScore,
      session_count: pipe.sessionCount,
      visit_number: visit.visitNumber,
      visit_bucket: visit.visitNumber === null ? 'unknown' : visitBucket(visit.visitNumber),
      entry_channel: visit.entryChannel ?? 'unknown',
      journey_stage: pipe.journeyStage,
      days_since_first_seen: Math.floor((now - pipe.firstSeen) / (24 * 60 * 60 * 1000)),
      // No cookie-consent surface on this host (no PII either) — mirrors the
      // session path's defaults for a consenting shopper.
      tracking_consent: true,
      personalization_enabled: true,
    };

    const decisions = await connectors.decisions.decideAll(
      CATALOG_FLAG_KEYS,
      aff.shopperId,
      pipe.segments,
      userAttributes
    );
    if (principal) assertSessionTarget(principal);
    const featureVariables: Record<string, any> = {};
    for (const [flagKey, decision] of Object.entries(decisions)) {
      featureVariables[flagKey] = decision.variables;
    }

    const anchorLine =
      typeof pipe.attributes.viewed_product_line === 'string'
        ? pipe.attributes.viewed_product_line
        : undefined;
    const recommendations = surfaceCatalog?.getRecommendations({ line: anchorLine }, pipe.segments, 8) ?? [];
    const sortOrder = surfaceCatalog
      ?.sortForSegments(null, pipe.segments, pipe.attributes)
      .slice(0, 24)
      .map((p) => p.id) ?? [];

    return {
      type: 'personalization_update',
      userId: aff.shopperId,
      data: {
        segments: pipe.segments,
        decisions,
        featureVariables,
        recommendations,
        sortOrder,
        // R29: the frame carries the shared vocabulary. An event's own decision
        // names the stage that event reached; every other caller (a manual
        // segment change, an alarm, a snapshot) projects the visit at read time.
        journeyStage: candidate?.journeyWord
          ?? journeyStageFrom(journeyCountersNow(pipe.journey, aff.lastSeen, now), journeyThresholdsInForce(cfg)),
        // Live affinity payload for the Affinity Instrument: dims (original catalog
        // value names) + memberships + this event's EXPLAIN records (§12 glass box)
        // + the ODP-confirmed subset — the exact shape the request path pushes.
        affinity: reflexOn
          ? {
              ...reflexSnapshot(aff.reflex, now, cfg),
              changed: reflex ? reflex.changes.explain : [],
              odpConfirmed: (await projectOdpState(this.env, tenant, aff)).odpSeed,
            }
          : undefined,
        sessionId: pipe.sessionId,
        engagementScore,
        timestamp: now,
        source,
      } as PersonalizationUpdate['data'],
    };
  }

  /** Push to every socket THIS object holds — never a cross-object hop. */
  private async pushFrame(frame: unknown): Promise<void> {
    const consent = await this.consentNow();
    const purpose = (frame as { type?: string })?.type === 'odp_receipt' ? 'tracking' : 'personalization';
    requireConsentPurpose(consent, purpose);
    const message = JSON.stringify(frame);
    for (const ws of this.state.getWebSockets()) {
      try {
        const p = (safeAttachment(ws) as { principal?: SessionCapability } | null)?.principal;
        if (!p || this.forwardTo) throw new SessionAccessError();
        await this.assertOwned(p, undefined, false, false, false);
        assertSessionTarget(p, (frame as { userId?: string })?.userId);
        requireConsentPurpose(consent, purpose);
        ws.send(message);
      } catch {
        try { ws.close(1008, 'Shopper session unavailable'); } catch { /* already closed */ }
        /* runtime reaps dead hibernated sockets */
      }
    }
  }

  // ── Closed-form alarm: exit-by-decay without polling + retention ────────────

  private retentionMs(): number {
    const retention = this.affinity?.retention;
    return retention && this.affinity ? Math.max(0, retention.expiresAt - this.affinity.lastSeen) : Infinity;
  }

  private async scheduleNextCrossing(now: number, cfg: ReflexConfig): Promise<void> {
    if (!this.affinity) return;
    const at = computeNextAlarm(
      this.affinity.reflex,
      this.affinity.lastSeen,
      now,
      cfg,
      this.retentionMs()
    );
    await this.scheduleProjectionAlarm(at);
  }

  async alarm(): Promise<void> {
    return this.synthetic.run(undefined, () => this.alarmScoped());
  }

  private async alarmScoped(): Promise<void> {
    await this.serialize(async () => {
      // Strip the entire locally expired cohort before consent projections,
      // external KV maintenance or the first recovery child's remote wait.
      await stripExpiredOwnerRecovery(this.state.storage, (tenant, subject) => this.isActualObject(tenant, subject));
      await this.pruneConsent();
      await this.scheduleConsentAlarm();
      // W16 C6. Above the behavioral gates below, because the session host
      // holds no affinity here and would return before reaching them. Cleanup
      // is the chain's own original expiry: nothing is extended, nothing else
      // of hers is touched, and an expired chain leaves no record behind.
      const continuityState = await this.state.storage.get(CONTINUITY_KEY);
      if (continuityState !== undefined) {
        const chain = continuityRecordSchema.parse(continuityState);
        if (chain.expiresAt <= Date.now()) await this.state.storage.delete(CONTINUITY_KEY);
        else await this.armContinuityAlarm(chain.expiresAt);
      }
      await this.load();
      const now = Date.now();
      const surface = this.surface();
      if (this.affinity?.retention && !this.isActualObject(this.affinity.retention.tenant, this.affinity.shopperId)) throw new SessionAccessError();
      await this.pruneExternalCopies(now);
      await this.pruneBehaviorCopies(now);
      const recovery = await this.state.storage.list<OwnerRecovery>({ prefix: 'recoveryOperation:', limit: RECOVERY_LIMITS.operations + 1 });
      if (recovery.size > RECOVERY_LIMITS.operations) throw new SessionAccessError();
      for (const [key, operation] of recovery) {
        if (key !== 'recoveryOperation:' + operation.id || !this.isActualObject(operation.tenant, operation.subject)) throw new SessionAccessError();
        try {
          if (operation.cleanup || operation.expiresAt <= Date.now()) await disposeOwnerRecovery(this.state.storage, this.env, operation, operation.cleanup === 'erased');
          else await resumeOwnerRecovery(this.state.storage, this.env, operation, (principal, until) => this.recoveryGuard(principal, until));
        } catch {
          // Retained work stays pending; failed checks never imply recovery.
          await this.scheduleProjectionAlarm(operation.expiresAt > Date.now() ? Math.min(operation.expiresAt, Date.now() + 30_000) : Date.now() + 30_000);
        }
      }
      const imports = await this.state.storage.list<{ expires: number; result?: unknown; published?: boolean }>({ prefix: 'identityImport:' });
      for (const [key, receipt] of imports) {
        if (!Number.isSafeInteger(receipt.expires)) throw new SessionAccessError();
        // A committed but unpublished result is recovery debt. Its old
        // lifetime still refuses publication/reapplication; expiry must not
        // erase the operation commitment and make it look newly admissible.
        if (receipt.expires <= now && !(Object.hasOwn(receipt, 'result') && receipt.published !== true)) await this.state.storage.delete(key);
      }
      const projections = await this.state.storage.list<{ value: string | null; expires: number | null; pending?: boolean }>({ prefix: 'sessionProjection:' });
      for (const [key, entry] of projections) {
        if ((entry.value === null && !entry.pending) || entry.expires === null || entry.expires > now) continue;
        const physical = key.slice('sessionProjection:'.length);
        // Publication retains an exact digest/epoch on an ambiguous delete.
        await this.sessionProjectionStore().get(physical);
      }
      const members = await this.state.storage.get<ShopperRecord>('identityMembers');
      if (members?.retention && !this.isActualObject(members.retention.tenant, members.shopperId)) throw new SessionAccessError();
      if (members?.retention && readRetention(members.retention, members.retention.tenant, 'identity').expiresAt <= now) {
        const physical = tenantKey(members.retention.tenant, 'identity:shopper:' + members.shopperId);
        const raw = await this.rawEnv.SESSIONS.get(physical);
        if (raw !== null && raw !== JSON.stringify(members)) throw new SessionAccessError();
        if (raw !== null) await this.rawEnv.SESSIONS.delete(physical);
        await this.state.storage.delete('identityMembers');
      }
      if (this.affinity?.retention && readRetention(this.affinity.retention, this.affinity.retention.tenant, 'profile').expiresAt <= now) {
        await this.state.storage.transaction(async transaction => { await transaction.delete(['affinity', 'pipeline', 'audienceOwner']); });
        this.invalidateMirrors(); await this.load();
      }
      if (!this.affinity) {
        const next = Math.min(...[...imports.values()].filter(receipt => receipt.expires > now).map(receipt => receipt.expires));
        if (Number.isFinite(next)) await this.scheduleProjectionAlarm(next);
        return; // already erased or necessary-only refusal
      }

      // Untagged historical state remains held; neither an old idle default nor
      // a newly supplied setting enrolls it in automatic deletion or evaluation.
      if (!this.affinity.retention) return;

      // Necessary retention cleanup stays above this gate. A pending timer may
      // not qualify, seed, personalize or mutate behavioral state after refusal.
      const owner = this.trustedAudienceOwner();
      if (!owner || await this.transferState() || await this.intentState() || await this.forwardTarget() || !personalizes(await this.consentNow())) {
        await this.scheduleProjectionAlarm(Math.max(this.affinity.lastSeen + this.retentionMs(), now + MIN_ALARM_DELAY_MS));
        return;
      }
      requireConsentPurpose(await this.consentNow(), 'personalization');
      pinProfileRetention(this.env, this.affinity, owner.tenant);

      // Lazy re-evaluation: tick() NEVER accumulates — decay is read-time math, so
      // the alarm never mutates scores; it only re-reads them at `now` and applies
      // the θ_out exits the closed form predicted.
      let cfg: ReflexConfig;
      try { cfg = await resolveTenantReflexConfig(this.env, owner.tenant, surface); }
      catch (error) {
        // A configuration refusal must not cost the shopper her retention
        // guarantee. Re-arm exactly the deadline a successful alarm would have
        // left, write nothing else, and let the typed refusal stand so the
        // failure is visible instead of a quiet no-op: either class counts
        // (ruling R28), and anything untyped was never this timer's to absorb.
        if (!(error instanceof ReflexConfigUnavailableError) && !(error instanceof PublicationError)) throw error;
        await this.scheduleProjectionAlarm(Math.max(this.affinity.lastSeen + this.retentionMs(), now + MIN_ALARM_DELAY_MS));
        throw error;
      }
      const res = tickReflex(this.affinity.reflex, now, cfg);
      let affinity = { ...this.affinity, reflex: res.state, configVersion: cfg.version };
      let pipeline = this.pipeline;
      let update: PersonalizationUpdate | null = null;

      const exited = res.changes.exited.length > 0 || res.changes.entered.length > 0;
      if (exited && pipeline) {
        await this.ensureSeeded(surface, owner.tenant);
        const connectors = getConnectors(this.env, owner.tenant);
        // Re-run the qualification tail with the decayed memberships — the union
        // shrinks, decisions revert, and the "they wandered off" push goes out.
        const odp = await projectOdpState(this.env, owner.tenant, affinity);
        const ctxAttrs: Record<string, any> = { ...RETAIL_SIGNAL_DEFAULTS, ...pipeline.attributes };
        const qualCtx = {
          userId: affinity.shopperId,
          attributes: ctxAttrs,
          segments: pipeline.profileEnrichment === undefined ? projectedOdpSegments(pipeline.segments, affinity, odp) : [],
          ...(owner.tenant === DEFAULT_TENANT ? { surface } : {}),
        };
        // W16 C5.09 (R85(b)): the alarm writes the same stored stage the event
        // path writes, from the same one derivation. Nothing was delivered, so
        // the counters are the ones this visit already holds, read at `now`
        // across whatever boundary time has crossed — the alarm invents no
        // interaction and no threshold.
        const journeyStage = storedJourneyStage(pipeline.journey, affinity.lastSeen, now, cfg);
        ctxAttrs.journey_stage = journeyStage;
        Object.assign(ctxAttrs, reflexAttributes(res.state, now, cfg));
        const external = enrichmentInputs(pipeline.profileEnrichment);
        Object.assign(ctxAttrs, external.attributes);
        let localSegments: string[] = [];
        try {
          localSegments = await connectors.segments.fetchQualifiedSegments(affinity.shopperId, qualCtx);
        } catch (e) {
          console.error('ShopperReflex alarm qualification failed');
        }
        let { odpSeed, odpSeedAt } = odp;
        if (odpEnabled(this.env, owner.tenant)) {
          ({ seed: odpSeed, seedAt: odpSeedAt } = await refreshOdpSeedIfDue(
            this.env,
            owner.tenant,
            { visitorId: pipeline.visitorId, sessionId: pipeline.sessionId },
            odp.odpRecentEvents,
            { seed: odpSeed, seedAt: odpSeedAt },
            now,
            true // membership changed — instant read, same policy as the ingest path
          ));
        }
        affinity = { ...affinity, ...odp, odpSeed, odpSeedAt };
        const prefix = tenantAudienceKeyPrefix(owner.tenant, surface);
        const newSegments = Array.from(
          new Set([
            ...localSegments,
            ...(prefix ? res.state.audiences.map((k) => prefix + k) : res.state.audiences),
            ...odpSeed,
            ...external.audiences,
          ])
        );
        const changed =
          hasSegmentChanges(pipeline.segments, newSegments) ||
          pipeline.journeyStage !== journeyStage;
        pipeline = { ...pipeline, segments: newSegments, journeyStage };

        if (changed) {
          const engagementScore = calculateEngagementScore(pipeline.attributes);
          update = await this.buildUpdate(connectors, now, 'reflex_alarm', res, engagementScore, cfg, owner.tenant, undefined, { affinity, pipeline });
        }
      }

      await this.persistAudienceState(affinity, pipeline, owner);
      if (update) await this.pushFrame({ ...update, serverTimestamp: Date.now() });
      await this.scheduleNextCrossing(now, cfg); // next exit, or the retention horizon
    });
  }

  // ── Snapshot door (same shape as GET /realtime/reflex) ─────────────────────

  private async handleSnapshot(tenant: TenantId, principal?: SessionCapability): Promise<Response> {
    await this.load();
    const consent = await this.consentNow();
    const allowed = personalizes(consent);
    if (allowed) requireConsentPurpose(consent, 'personalization');
    // W16 C5.06 (R63). Exactly one retained-data authority is pinned here — the
    // shopper's own PROFILE stamp. When the authority it was born under is no
    // longer in force, nothing of that record may be read out, projected or
    // sent; but refusing to SERVE her page is not a retention remedy. The read
    // then answers with no retained profile at all, and the skip is reported
    // once, in coded words that name nobody and are the same words the session
    // host uses. Nothing else is absorbed: any other failure propagates, and the
    // destination's own retained-data policy is pinned inside the projection.
    let profileRetained = true;
    if (allowed && this.affinity) {
      try { pinProfileRetention(this.env, this.affinity, tenant); }
      catch (error) {
        if (!(error instanceof RetentionUnavailable)) throw error;
        profileRetained = false;
        warnStageProjectionSkipped();
      }
    }
    const usable = allowed && profileRetained;
    const cfg = await resolveTenantReflexConfig(this.env, tenant, this.surface());
    const now = Date.now();
    if (principal) assertSessionTarget(principal);

    // W16 C5: this read may have moved her stage on its own — the visit those
    // counters belonged to ended while she was away. That is a stage-only
    // change: it fabricates no event, writes nothing and renews no retained
    // lifetime, and the single thing it is allowed to do is tell the tenant's
    // configured destination the stage, off the response path. The session
    // host does the identical thing in GET /realtime/reflex.
    if (usable && this.affinity && this.pipeline) {
      const projection = stageOnlyOdpProjection(this.env, tenant,
        { visitorId: this.pipeline.visitorId, sessionId: this.pipeline.sessionId },
        reflexSnapshot(this.affinity.reflex, now, cfg),
        readTimeStageChange(this.pipeline.journey, this.affinity.lastSeen, now, journeyThresholdsInForce(cfg)));
      if (projection) retainOwnerWork(projection);
    }

    return json({
      ok: true,
      now,
      // Shape mirrors the session-path handler in src/routes/realtime.ts (the
      // client's honest drain animation reads these) — keep the two in sync.
      config: {
        version: cfg.version,
        tauMs: cfg.tauMs,
        K: cfg.K,
        thetaIn: cfg.thetaIn,
        thetaOut: cfg.thetaOut,
        dims: Object.fromEntries(
          cfg.dimensions
            .filter((d) => d.tauMs || d.K || d.thetaIn || d.thetaOut)
            .map((d) => [d.key, { tauMs: d.tauMs, K: d.K, thetaIn: d.thetaIn, thetaOut: d.thetaOut }])
        ),
      },
      affinity: usable && this.affinity
        ? {
            ...reflexSnapshot(this.affinity.reflex, now, cfg),
            odpConfirmed: (await projectOdpState(this.env, tenant, this.affinity)).odpSeed,
          }
        : null,
      // W16 C4 / R29: the journey stage in the shared vocabulary, derived from
      // THIS VISIT's counters against the tenant's published journey thresholds
      // — identically on the session host (src/routes/realtime.ts, GET /reflex).
      // The content decision maps it to the persisted cell token through the one
      // mapping point rather than recomputing it.
      journeyStage: usable
        ? journeyStageFrom(journeyCountersNow(this.pipeline?.journey, this.affinity?.lastSeen, now), journeyThresholdsInForce(cfg))
        : null,
      visit: usable ? projectVisit(this.pipeline, this.affinity?.lastSeen, now) : null,
      // CW31: the switches the content decision and the outcome path honour.
      consent,
      sessionId: this.pipeline?.sessionId ?? null,
    });
  }

  // ── Plumbing ────────────────────────────────────────────────────────────────

  /** Rehydrate the in-memory mirrors from ctx.storage (one read for both keys). */
  // ── CW31: consent ──────────────────────────────────────────────────────────

  /** Only live explicit choices authorize optional purposes; absence is OFF. */
  private async consentNow(): Promise<Consent> {
    if (this.consent === undefined) {
      const stored = (await this.state.storage.get('consent')) as { tracking?: unknown; personalization?: unknown } | undefined;
      this.consent = stored === undefined ? null : storedConsent(stored);
    }
    const result = storedConsent(this.consent ?? undefined);
    if (result.instruction && !this.isActualObject(result.instruction.tenant, result.instruction.subject)) throw new SessionAccessError();
    return result;
  }

  /** Merge what the site said into the stored switches. Only an explicit boolean changes a switch. */
  private async setConsent(body: { tracking?: unknown; personalization?: unknown; instruction?: Consent['instruction'] }): Promise<Consent> {
    const current = await this.consentNow();
    const next = intersectConsent(current, refusalHints(body));
    if (JSON.stringify(next) !== JSON.stringify(current)) {
      try {
        await this.scheduleConsentAlarm(next);
        recheckOwnerInvocation(this);
        if (next.instruction) await this.state.storage.put('consent', next.instruction);
        else await this.state.storage.delete('consent');
      }
      catch { this.consent = undefined; throw new SessionAccessError(); }
      this.consent = next;
      if (!next.tracking) await retireOwnerRecovery(this.state.storage);
    }
    return next;
  }

  /** Expiry removes only choice payloads. Existing security receipts and behavior
   * have independent lifetimes and are never erased by this alarm. */
  private async pruneConsent(): Promise<void> {
    const raw = await this.state.storage.get('consent');
    const current = storedConsent(raw), live = liveInstruction(current.instruction);
    if (live) {
      if (JSON.stringify(raw) !== JSON.stringify(live)) await this.state.storage.put('consent', live);
    } else if (raw !== undefined) await this.state.storage.delete('consent');
    this.consent = consentInstruction(live);
    if (!this.consent.tracking) await retireOwnerRecovery(this.state.storage);
    for (const prefix of ['grantRotation:', 'identityReceipt:']) {
      for (const [key, rawReceipt] of await this.state.storage.list<Record<string, any>>({ prefix })) {
        const receipt = structuredClone(rawReceipt), block = prefix === 'identityReceipt:' ? receipt.result : receipt;
        if (!block?.consent) continue;
        const next = storedConsent(block.consent);
        if (JSON.stringify(block.consent) !== JSON.stringify(next)) { block.consent = next; await this.state.storage.put(key, receipt); }
      }
    }
  }
  private consentCopyDeadline(values: unknown[]): number {
    let deadline = Infinity;
    for (const value of values) {
      const block = value as { version?: unknown; instruction?: unknown } | undefined;
      const record = instructionOf(block?.version === 1 ? value : block?.instruction);
      for (const key of CONSENT_SWITCHES) if (record?.[key]) deadline = Math.min(deadline, record[key]!.expiresAt);
    }
    return deadline;
  }
  private async scheduleConsentAlarm(...additional: unknown[]): Promise<void> {
    const values = [...additional, await this.state.storage.get('consent')];
    for (const prefix of ['grantRotation:', 'identityReceipt:']) for (const row of (await this.state.storage.list<Record<string, any>>({ prefix })).values()) values.push(prefix === 'identityReceipt:' ? row.result?.consent : row.consent);
    const deadline = this.consentCopyDeadline(values);
    const alarm = await this.state.storage.getAlarm();
    if (Number.isFinite(deadline) && (alarm === null || alarm > deadline)) await this.state.storage.setAlarm(Math.max(Date.now(), deadline));
  }

  private invalidateMirrors(): void {
    this.loaded = false; this.consent = undefined; this.forwardTo = undefined;
  }

  /** Called inside serialization: only never-adopted objects admit legacy writers. */
  private async assertLegacyWriter(): Promise<void> {
    // Raw presence is the fence, including an empty barrier or malformed value.
    if (await this.state.storage.get('grantAuthority') !== undefined) throw new SessionAccessError();
  }

  private async grantAuthority(): Promise<GrantAuthority | null> {
    const raw = await this.state.storage.get('grantAuthority');
    if (raw === undefined) return null;
    const authority = authoritySchema.parse(raw);
    for (const [id, grant] of Object.entries(authority.grants)) {
      if (id !== grant.grantId || grant.authorityEpoch !== authority.epoch || !this.isActualObject(grant.tenant, grant.subject)) throw new SessionAccessError();
    }
    return authority;
  }

  /** Recover only the necessary canonical SID after selective profile cleanup.
   * Current grants alone (or raw membership/KV) cannot prove prior adoption. */
  private async retainedCanonicalSid(authority: GrantAuthority | null): Promise<string | undefined> {
    const grants = Object.values(authority?.grants ?? {});
    if (!grants.length) return undefined;
    if (!authority || this.affinity || this.pipeline || this.audienceOwner !== undefined) throw new SessionAccessError();
    const first = grants[0]!;
    if (grants.some(grant => grant.kind !== 'recognized' || grant.sessionId !== first.sessionId
      || grant.tenant !== first.tenant || grant.subject !== first.subject || grant.authorityEpoch !== authority.epoch)) throw new SessionAccessError();
    const missing = new Map(grants.map(grant => [grant.grantId, grant]));
    const highWater = await this.registrationHighWater();
    let after: string | undefined, inspected = 0;
    while (missing.size) {
      const page = await this.state.storage.list<unknown>({ prefix: 'identityReceipt:', ...(after ? { startAfter: after } : {}), limit: 32 });
      if (!page.size) throw new SessionAccessError();
      for (const [key, raw] of page) {
        if (after && key <= after || ++inspected > highWater) throw new SessionAccessError();
        after = key;
        const candidate = raw as { result?: { grant?: { grantId?: string } } } | null;
        const grant = missing.get(candidate?.result?.grant?.grantId ?? '');
        if (!grant) continue;
        const receipt = transferReceiptSchema.parse(raw), transfer = receipt.transfer;
        if (!receipt.scrubbed || key !== 'identityReceipt:' + transfer.id || transfer.tenant !== first.tenant
          || transfer.shopperId !== first.subject || transfer.targetEpoch !== authority.epoch
          || transfer.targetSequence > highWater || transfer.fingerprint !== await transferFingerprint(transfer)
          || receipt.result.shopperId !== first.subject || receipt.result.sessionId !== first.sessionId
          || receipt.result.visitorId !== transfer.visitorId || receipt.result.assurance !== transfer.assurance
          || JSON.stringify(receipt.result.grant) !== JSON.stringify(grant)) throw new SessionAccessError();
        const intent = intentSchema.strip().parse(transfer);
        const registration = registrationSchema.parse(await this.state.storage.get(registrationKey(transfer.targetSequence)));
        const admission = admissionSchema.parse(await this.state.storage.get('identityAdmission:' + transfer.id));
        if (registration.sequence !== transfer.targetSequence || registration.targetEpoch !== authority.epoch
          || JSON.stringify(registration.intent) !== JSON.stringify(intent)
          || admission.sequence !== transfer.targetSequence || admission.targetEpoch !== authority.epoch
          || admission.digest !== await identityDigest(intent)) throw new SessionAccessError();
        missing.delete(grant.grantId);
      }
    }
    return first.sessionId;
  }

  /** Missing authority is adoptable only once, before any transition/barrier. */
  private async assertGrant(principal: SessionCapability, adopt: boolean): Promise<GrantAuthority> {
    const parsed = grantSchema.safeParse(principal);
    if (!parsed.success) throw new SessionAccessError();
    const grant = parsed.data;
    assertSessionTarget(grant);
    if (!this.isActualObject(grant.tenant, grant.subject)) throw new SessionAccessError();
    let authority = await this.grantAuthority();
    if (!authority) {
      if (!adopt) throw new SessionAccessError();
      const prior = await this.state.storage.list();
      const allowed = new Set(OWNED_STATE_KEYS);
      if ([...prior.keys()].some(key => !allowed.has(key))
        || (prior.has('affinity') !== prior.has('pipeline'))
        || (prior.has('affinity') && (!this.affinity || !this.pipeline))
        || (!this.affinity && grant.kind !== 'anonymous')) throw new SessionAccessError();
      storedConsent(prior.get('consent'));
      authority = { version: 1, epoch: grant.authorityEpoch, grants: { [grant.grantId]: grant } };
      try { await this.state.storage.put('grantAuthority', authority); }
      catch (error) { this.invalidateMirrors(); throw error; }
    }
    if (authority.epoch !== grant.authorityEpoch
      || JSON.stringify(authority.grants[grant.grantId]) !== JSON.stringify(grant)) throw new SessionAccessError();
    return authority;
  }

  private closeGrants(grantId?: string): void {
    for (const ws of this.state.getWebSockets()) {
      const p = (safeAttachment(ws) as { principal?: SessionCapability } | null)?.principal;
      if (grantId === undefined || p?.grantId === grantId) {
        try { ws.close(1008, 'Shopper session unavailable'); } catch { /* already closed */ }
      }
    }
  }

  /** Erasure and its deny barrier are one commit, including after a lost acknowledgement. */
  private retainSessionEligibility(prior: Map<string, unknown>, additions: Record<string, unknown>, erasureId: string,
    receiptKey: string, witness: string | null, sessions: Array<{ sessionId: string; epoch: string }>): void {
    for (const session of sessions) {
      const key = sessionErasureKey(erasureId, session.sessionId), saved = additions[key] ?? prior.get(key);
      const entry = sessionErasureSchema.parse({ version: 1, ...session, receiptKey, witness });
      if (saved !== undefined) {
        const previous = sessionErasureSchema.parse(saved);
        if (previous.sessionId !== entry.sessionId || previous.epoch !== entry.epoch) throw new SessionAccessError();
      } else additions[key] = entry;
    }
  }

  private async eraseWithBarrier(retained: Record<string, unknown> = {}, eligibility?: {
    erasureId: string; receiptKey: string; witness: string | null;
    source?: { sessionId: string; epoch: string };
  }): Promise<void> {
    const relayPrincipal = Object.values((await this.grantAuthority())?.grants ?? {})[0];
    const grantAuthority: GrantAuthority = { version: 1, epoch: crypto.randomUUID(), grants: {} };
    try {
      await this.state.storage.transaction(async transaction => {
        const prior = await transaction.list(), keep: Record<string, unknown> = {};
        for (const [key, value] of prior) {
          if (key === 'identitySequence') keep[key] = identityTime.parse(value);
          else if (key.startsWith('identityRegistration:')) {
            const entry = z.union([registrationSchema, registrationAckSchema]).parse(value);
            if (key !== registrationKey(entry.sequence) || ('intent' in entry && !this.isActualObject(entry.intent.tenant, entry.intent.shopperId))) throw new SessionAccessError();
            keep[key] = entry;
          } else if (key.startsWith('identityAdmission:')) {
            z.string().uuid().parse(key.slice('identityAdmission:'.length)); keep[key] = admissionSchema.parse(value);
          } else if (key.startsWith('identityErasure:')) {
            z.string().uuid().parse(key.slice('identityErasure:'.length)); keep[key] = erasureReceiptSchema.parse(value);
          } else if (key.startsWith('identitySourceErasure:')) {
            const [, witness] = z.tuple([z.string().uuid(), z.string().regex(/^[a-f0-9]{64}$/)])
              .parse(key.slice('identitySourceErasure:'.length).split(':'));
            const entry = erasureReceiptSchema.parse(value);
            if (entry.kind !== 'source' || entry.witness !== witness) throw new SessionAccessError();
            keep[key] = entry;
          } else if (key.startsWith('identityRetired:')) {
            z.string().uuid().parse(key.slice('identityRetired:'.length)); keep[key] = z.string().regex(/^[a-f0-9]{64}$/).parse(value);
          } else if (key.startsWith('externalAdmission:')) {
            z.string().regex(/^[a-f0-9]{64}$/).parse(key.slice('externalAdmission:'.length));
            const record = z.object({ digest: z.string().regex(/^[a-f0-9]{64}$/) }).passthrough().parse(value);
            keep[key] = { digest: record.digest, expired: true };
          } else if (key.startsWith('recoveryOperation:')) {
            const entry = value as OwnerRecovery;
            if (entry.version !== 1 || key !== 'recoveryOperation:' + entry.id || !/^[a-f0-9]{64}$/.test(entry.id)
              || !this.isActualObject(entry.tenant, entry.subject) || !Array.isArray(entry.destinations)) throw new SessionAccessError();
            // A shopper/session reset retires authority, but is not a ledger
            // erasure and must not invent a tombstone-backed cleanup debt.
            keep[key] = recoveryCleanup(entry, !!eligibility, !eligibility);
            await transaction.put(key, keep[key]);
          } else if (key.startsWith('recoveryLogical:') || key.startsWith('recoveryTerminal:')) {
            if (!/^[a-f0-9]{64}$/.test(key.slice(key.indexOf(':') + 1))) throw new SessionAccessError();
            keep[key] = value;
          } else if (key.startsWith('identitySessionErasure:')) {
            const [erasureId, sid] = z.tuple([z.string().uuid(), identityId]).parse(key.slice('identitySessionErasure:'.length).split(':'));
            const entry = sessionErasureSchema.parse(value);
            if (sid !== entry.sessionId || (entry.receiptKey !== 'identityErasure:' + erasureId
              && entry.receiptKey !== sourceErasureKey(erasureId, entry.witness ?? ''))) throw new SessionAccessError();
            keep[key] = entry;
          }
        }
        const additions: Record<string, unknown> = { ...retained, grantAuthority };
        if (eligibility) {
          // Only the transaction that actually removes current owner state may
          // authorize later shared-key cleanup. A retired receipt is not a barrier.
          for (const [key, value] of Object.entries(retained)) {
            if (key.startsWith('identityErasure:') || key.startsWith('identitySourceErasure:')) {
              additions[key] = { ...erasureReceiptSchema.parse(value), continuationEpoch: grantAuthority.epoch };
            }
          }
          const ownerReceipt = 'identityErasure:' + eligibility.erasureId;
          if (prior.has(ownerReceipt) && !Object.hasOwn(retained, ownerReceipt)) {
            additions[ownerReceipt] = { ...erasureReceiptSchema.parse(prior.get(ownerReceipt)), continuationEpoch: grantAuthority.epoch };
          }
          const authority = prior.has('grantAuthority') ? authoritySchema.parse(prior.get('grantAuthority')) : null;
          const sessions = eligibility.source ? [eligibility.source] : Object.entries(authority?.grants ?? {}).map(([id, grant]) => {
            if (id !== grant.grantId || grant.authorityEpoch !== authority!.epoch || !this.isActualObject(grant.tenant, grant.subject)) throw new SessionAccessError();
            return { sessionId: grant.sessionId, epoch: grant.authorityEpoch };
          });
          this.retainSessionEligibility(prior, additions, eligibility.erasureId, eligibility.receiptKey, eligibility.witness, sessions);
        }
        if (prior.has('identityIntent')) {
          const intent = intentSchema.parse(prior.get('identityIntent'));
          additions['identityRetired:' + intent.sourceEpoch] = await identityDigest(intent);
        }
        const keys = [...prior.keys()].filter(key => !Object.hasOwn(keep, key));
        for (let at = 0; at < keys.length; at += 128) await transaction.delete(keys.slice(at, at + 128));
        await transaction.put(additions);
        await transaction.deleteAlarm();
        const copies = Object.entries({ ...keep, ...additions }).flatMap(([key, value]) => {
          const record = value as { consent?: unknown; result?: { consent?: unknown } };
          return key === 'consent' ? [value] : key.startsWith('grantRotation:') ? [record.consent]
            : key.startsWith('identityReceipt:') ? [record.result?.consent] : [];
        });
        const choiceDeadline = this.consentCopyDeadline(copies);
        if (Number.isFinite(choiceDeadline)) await transaction.setAlarm(Math.max(Date.now(), choiceDeadline));
        if (Object.keys(keep).some(key => key.startsWith('recoveryOperation:'))) await transaction.setAlarm(Date.now() + 1);
      });
    } finally {
      this.invalidateMirrors(); this.closeGrants();
      if (relayPrincipal && (this.env.REFLEX_HOST ?? 'session') === 'session') {
        await this.relayOperation('revoke', relayPrincipal.subject, relayPrincipal.tenant);
      }
    }
  }

  // ── W16 C6: anonymous return continuity ───────────────────────────────────

  private continuityDescriptorOf(record: Omit<ContinuityRecord, 'digest' | 'receipt'> & { digest?: string },
    tenant: string, subject: string): ContinuityDescriptor {
    return { tenant, subject, chain: record.chain, generation: record.generation, issuedAt: record.issuedAt,
      expiresAt: record.expiresAt, mode: record.mode, purpose: record.purpose, revision: record.revision };
  }

  /** Never later than the chain's own expiry, and never past an earlier one
   * this object already holds: cleanup is a deadline, not a lifetime. */
  private async armContinuityAlarm(expiresAt: number): Promise<void> {
    const alarm = await this.state.storage.getAlarm();
    if (alarm === null || alarm > expiresAt) await this.state.storage.setAlarm(Math.max(Date.now() + 1, expiresAt));
  }

  /** The chain in force for this object, or null when there is none that the
   * published configuration still recognizes. Never extends anything. */
  private liveContinuity(saved: unknown, settings: z.infer<typeof continuitySettingsSchema>, now: number): ContinuityRecord | null {
    if (saved === undefined) return null;
    const record = continuityRecordSchema.parse(saved);
    return record.expiresAt <= now || record.mode !== settings.mode
      || record.revision !== settings.revision || record.purpose !== settings.purpose ? null : record;
  }

  /**
   * Report the chain this shopper's browser should carry, minting one if the
   * published configuration admits it and she has made a current explicit
   * choice. Idempotent: asking again inside the window re-reports the SAME
   * generation on the SAME original expiry and re-derives the same proof.
   */
  private async handleContinuityIssue(request: Request, principal: SessionCapability): Promise<Response> {
    const settings = continuitySettingsSchema.parse(await request.json());
    return this.serialize(async () => {
      try {
        await this.assertOwned(principal, undefined, false);
        const consent = await this.consentNow();
        // HANDOFF §12: the session consent record authorizes no credential of
        // its own, and a recognition proof outlives the visit — so only a
        // current explicit choice issues one.
        if (!personalizes(consent)) return json({ ok: true, enabled: false, reason: 'consent' });
        requireConsentPurpose(consent, 'personalization');
        const now = Date.now();
        let record = this.liveContinuity(await this.state.storage.get(CONTINUITY_KEY), settings, now);
        if (!record) {
          const fresh = { version: 1 as const, chain: crypto.randomUUID(), generation: 1, issuedAt: now,
            expiresAt: now + Math.floor(settings.windowMs), mode: settings.mode, purpose: settings.purpose,
            revision: settings.revision, sessionId: principal.sessionId };
          const minted = await issueContinuityProof(this.env, this.continuityDescriptorOf(fresh, principal.tenant, principal.subject));
          record = continuityRecordSchema.parse({ ...fresh, digest: await continuityDigest(minted) });
          assertSessionTarget(principal);
          await this.state.storage.put(CONTINUITY_KEY, record);
          await this.armContinuityAlarm(record.expiresAt);
          return json({ ok: true, enabled: true, descriptor: this.continuityDescriptorOf(record, principal.tenant, principal.subject), proof: minted });
        }
        const descriptor = this.continuityDescriptorOf(record, principal.tenant, principal.subject);
        const proof = await issueContinuityProof(this.env, descriptor);
        // The stored digest is the only thing that can say this is her chain.
        if (await continuityDigest(proof) !== record.digest) throw new SessionAccessError();
        await this.armContinuityAlarm(record.expiresAt);
        return json({ ok: true, enabled: true, descriptor, proof });
      } catch (error) { this.invalidateMirrors(); throw error; }
    });
  }

  /**
   * Recognize the physical subject behind a presented proof, once. The chain
   * rotates to its next generation on its ORIGINAL expiry, a fresh ordinary
   * capability joins the shopper's existing browsing session inside the
   * existing authority epoch — a capability minted outside this object is
   * refused — and the consumed generation can never be presented again.
   */
  private async handleContinuityConsume(request: Request, context: InternalContext): Promise<Response> {
    const body = z.object({ proof: z.string().min(1).max(2048), operationId: z.string().uuid(),
      settings: continuitySettingsSchema }).strict().parse(await request.json());
    return this.serialize(async () => {
      // Nothing here refuses the REQUEST: an unrecognized proof is a cold
      // shopper, and the route answers her with a brand-new anonymous session.
      const cold = () => json({ ok: true, recognized: false });
      try {
        await this.load();
        this.assertInternalState(context);
        if (await this.forwardTarget()) return cold();
        const consent = await this.consentNow();
        if (!personalizes(consent)) return cold();
        const saved = await this.state.storage.get(CONTINUITY_KEY);
        if (saved === undefined) return cold();
        const now = Date.now();
        const record = this.liveContinuity(saved, body.settings, now);
        if (!record) return cold();
        const presented = await continuityDigest(body.proof);
        const authority = await this.grantAuthority();
        if (!authority) return cold();
        if (record.receipt && record.receipt.operationId === body.operationId && record.receipt.digest === presented) {
          // The one deterministic successor receipt, answered once: the same
          // subject, the same generation, the same grant, the same proof.
          const { receipt, ...rest } = record;
          const descriptor = this.continuityDescriptorOf(record, context.tenant, context.subject);
          await this.state.storage.put(CONTINUITY_KEY, continuityRecordSchema.parse(rest));
          return json({ ok: true, recognized: true, grant: receipt.grant, descriptor, consent,
            proof: await issueContinuityProof(this.env, descriptor) });
        }
        if (presented !== record.digest) return cold();
        const next = { ...record, generation: record.generation + 1 };
        const descriptor = this.continuityDescriptorOf(next, context.tenant, context.subject);
        const proof = await issueContinuityProof(this.env, descriptor);
        const issuedAt = Math.floor(now / 1000);
        const grant = grantSchema.parse({ tenant: context.tenant, subject: context.subject, sessionId: record.sessionId,
          kind: 'anonymous', grantId: crypto.randomUUID(), authorityEpoch: authority.epoch,
          iat: issuedAt, exp: issuedAt + SHOPPER_MAX_AGE });
        authority.grants[grant.grantId] = grant;
        const stored = continuityRecordSchema.parse({ ...next, digest: await continuityDigest(proof),
          receipt: { operationId: body.operationId, digest: presented, grant } });
        await this.state.storage.put({ grantAuthority: authority, [CONTINUITY_KEY]: stored });
        await this.armContinuityAlarm(stored.expiresAt);
        return json({ ok: true, recognized: true, grant, descriptor, consent, proof });
      } catch (error) { this.invalidateMirrors(); throw error; }
    });
  }

  private async handleRotation(request: Request, principal: SessionCapability): Promise<Response> {
    const body = z.object({ operation: z.enum(['detach', 'reset']), consent: consentSchema }).strict().parse(await request.json());
    return this.serialize(async () => {
      try {
        const source = grantSchema.parse(principal), key = 'grantRotation:' + source.grantId;
        assertSessionTarget(source);
        const saved = await this.state.storage.get(key);
        let rotation: z.infer<typeof rotationSchema>;
        const current = storedConsent(await this.state.storage.get('consent'));
        if (saved === undefined) {
          await this.assertOwned(source);
          const minted = await newAnonymousSession(this.env, source.tenant);
          const replacement = { tenant: minted.tenant, subject: minted.subject, sessionId: minted.sessionId, kind: minted.kind,
            grantId: minted.grantId, authorityEpoch: minted.authorityEpoch, iat: minted.iat, exp: minted.exp };
          rotation = rotationSchema.parse({ operation: body.operation, source, replacement,
            consent: intersectConsent(current, body.consent), status: 'prepared' });
          await this.scheduleConsentAlarm(rotation.consent);
          await this.state.storage.put(key, rotation);
        } else {
          rotation = rotationSchema.parse(saved);
          if (rotation.operation !== body.operation || JSON.stringify(rotation.source) !== JSON.stringify(source)
            || rotation.replacement.tenant !== source.tenant || rotation.replacement.kind !== 'anonymous'
            || rotation.replacement.subject === source.subject) throw new SessionAccessError();
          if (rotation.status === 'prepared') await this.assertGrant(source, false);
          else {
            const authority = await this.grantAuthority();
            if (!authority || authority.grants[source.grantId]
              || (rotation.operation === 'detach' ? authority.epoch !== source.authorityEpoch : authority.epoch === source.authorityEpoch)) throw new SessionAccessError();
          }
        }
        const consent = intersectConsent(current, rotation.consent, body.consent);
        // A newer refusal on the source is durable before any replacement response.
        if (JSON.stringify(consent) !== JSON.stringify(rotation.consent) || JSON.stringify(consent) !== JSON.stringify(current)) {
          rotation = { ...rotation, consent };
          await this.scheduleConsentAlarm(consent);
          await this.state.storage.put({ [key]: rotation, consent });
          this.consent = consent;
        }
        const replacement = await signSessionCapability(this.env, rotation.replacement);
        const target = this.env.SHOPPER_REFLEX.get(this.env.SHOPPER_REFLEX.idFromName(shopperObjectName(source.tenant, replacement.subject)));
        const response = await target.fetch('https://shopper-reflex/identity/activate', {
          method: 'POST', headers: { [SHOPPER_HEADER]: replacement.capability, 'X-Tenant': source.tenant, 'Content-Type': 'application/json' },
          body: JSON.stringify({ consent, existingOnly: rotation.status === 'complete' }),
        });
        if (!response.ok) throw new SessionAccessError();
        const result = z.object({ ok: z.literal(true), consent: consentSchema }).parse(await response.json());
        if ((!consent.tracking && result.consent.tracking) || (!consent.personalization && result.consent.personalization)) throw new SessionAccessError();
        if (rotation.status === 'prepared') {
          const complete = { ...rotation, status: 'complete' as const };
          if (rotation.operation === 'reset') await this.eraseWithBarrier({ [key]: complete, consent });
          else {
            const authority = await this.assertGrant(source, false);
            delete authority.grants[source.grantId];
            // W16 C6: logout retires the recognition chain BEFORE the grant it
            // belonged to, so no window exists where the browser could come
            // back as a shopper this device just stopped being.
            try { await this.state.storage.delete(CONTINUITY_KEY);
              await this.state.storage.put({ grantAuthority: authority, [key]: complete, consent }); }
            finally {
              this.closeGrants(source.grantId);
              if ((this.env.REFLEX_HOST ?? 'session') === 'session') await this.relayOperation('revoke', source.subject, source.tenant);
            }
          }
        }
        await this.scheduleConsentAlarm();
        return json({ ok: true, grant: rotation.replacement, consent: result.consent });
      } catch (error) { this.invalidateMirrors(); throw error; }
    });
  }

  // ── CW25: identity ─────────────────────────────────────────────────────────

  private async transferState() {
    const value = await this.state.storage.get('identityTransfer');
    return value === undefined ? null : preparedTransferSchema.parse(value);
  }

  private async intentState() {
    const value = await this.state.storage.get('identityIntent');
    return value === undefined ? null : intentSchema.parse(value);
  }

  private async assertNotTransferred(): Promise<void> {
    if (await this.transferState() || await this.intentState()) throw new SessionAccessError();
  }

  private async registrationHighWater(): Promise<number> {
    const sequence = identityTime.parse(await this.state.storage.get('identitySequence') ?? 0);
    const tail = await this.state.storage.list({ prefix: 'identityRegistration:', reverse: true, limit: 1 });
    const last = [...tail][0];
    if (!last) { if (sequence !== 0) throw new SessionAccessError(); }
    else {
      const entry = z.union([registrationSchema, registrationAckSchema]).parse(last[1]);
      if (entry.sequence !== sequence || last[0] !== registrationKey(sequence)) throw new SessionAccessError();
    }
    return sequence;
  }

  private async validateTransfer(value: unknown, receiptOnly = false): Promise<IdentityTransfer> {
    const transfer = transferSchema.parse(value), { affinity, pipeline } = transfer;
    if ((affinity === null) !== (pipeline === null) || affinity === undefined || pipeline === undefined) throw new SessionAccessError();
    if (affinity !== null) z.object({ shopperId: z.literal(transfer.visitorId), reflex: historicalReflexSchema,
      odpContext: z.string().optional(), odpSeed: z.array(z.string()), odpSeedAt: z.number().finite().nonnegative(), odpRecentEvents: z.array(z.record(z.string(), z.unknown())),
      lastSeen: z.number().finite().nonnegative(), configVersion: z.string(),
    }).parse(affinity);
    if (pipeline !== null) {
      z.object({ sessionId: z.literal(transfer.sourceSessionId), visitorId: z.literal(transfer.visitorId).optional(),
        attributes: z.record(z.string(), z.unknown()), segments: z.array(z.string()), journeyStage: z.enum(['early', 'mid', 'late']),
        firstSeen: z.number().finite().nonnegative(), sessionCount: z.number().finite().nonnegative(),
      }).parse(pipeline);
      if (!validVisitContext(pipeline)) throw new SessionAccessError();
      readEnrichment(pipeline.profileEnrichment);
    }
    if (receiptOnly && (affinity !== null || pipeline !== null)) throw new SessionAccessError();
    if ((!receiptOnly && transfer.profileDigest !== await identityDigest({ affinity, pipeline }))
      || transfer.fingerprint !== await transferFingerprint(transfer)) throw new SessionAccessError();
    return transfer;
  }

  /** Capture the target generation before source preparation, without creating behavior. */
  private async handleTransferAdmission(request: Request, context: InternalContext): Promise<Response> {
    const { intent } = z.object({ intent: intentSchema }).strict().parse(await request.json());
    if (intent.tenant !== context.tenant || intent.shopperId !== context.subject) throw new SessionAccessError();
    return this.serialize(async () => {
      try {
        const key = 'identityAdmission:' + intent.id, digest = await identityDigest(intent), saved = await this.state.storage.get(key);
        if (saved !== undefined) {
          const admission = admissionSchema.parse(saved);
          if (admission.digest !== digest) throw new SessionAccessError();
          const registration = registrationSchema.parse(await this.state.storage.get(registrationKey(admission.sequence)));
          if (registration.targetEpoch !== admission.targetEpoch || registration.sequence !== admission.sequence
            || JSON.stringify(registration.intent) !== JSON.stringify(intent)) throw new SessionAccessError();
          return json({ ok: true, epoch: registration.targetEpoch, registration });
        }
        await this.load(); this.assertInternalState(context); await this.assertNotTransferred();
        if (!isShopperId(context.subject) || await this.forwardTarget()
          || (!!this.affinity !== !!this.pipeline)
          || (this.audienceOwner !== undefined && this.audienceOwner !== null && !this.trustedAudienceOwner())) throw new SessionAccessError();
        storedConsent(await this.state.storage.get('consent'));
        let authority = await this.grantAuthority();
        if (!authority) {
          const prior = await this.state.storage.list(), allowed = new Set(OWNED_STATE_KEYS);
          if ([...prior.keys()].some(key => !allowed.has(key))
            || (prior.has('affinity') !== prior.has('pipeline'))
            || (prior.has('affinity') && (!this.affinity || !this.pipeline))) throw new SessionAccessError();
          authority = { version: 1, epoch: crypto.randomUUID(), grants: {} };
        }
        if (this.pipeline) {
          if (Object.values(authority.grants).some(grant => grant.sessionId !== this.pipeline!.sessionId)) throw new SessionAccessError();
        } else await this.retainedCanonicalSid(authority);
        const sequence = await this.registrationHighWater() + 1;
        const registration = registrationSchema.parse({ version: 1, intent, targetEpoch: authority.epoch, sequence });
        await this.state.storage.put({ grantAuthority: authority, identitySequence: sequence,
          [key]: { version: 1, digest, targetEpoch: authority.epoch, sequence }, [registrationKey(sequence)]: registration });
        return json({ ok: true, epoch: authority.epoch, registration });
      } catch (error) { this.invalidateMirrors(); throw error; }
    });
  }

  /** Erasure coordinates outside the target lock; each local operation is recoverable. */
  private async handleIdentityErasure(request: Request, context: InternalContext, path: string): Promise<Response> {
    const body = z.object({ erasureId: z.string().uuid(), registration: registrationSchema.optional(),
      after: identityTime.optional(), limit: z.number().int().min(1).max(32).optional(), sessionId: identityId.optional(),
      canonical: z.literal(1).optional(), discovered: canonicalErasureDiscoverySchema.optional(),
      capture: identityTime.optional(), physical: historicalErasureCapsuleSchema.optional(), entry: z.number().int().min(0).max(1).optional(),
    }).strict().parse(await request.json());
    if ((body.canonical !== undefined || body.discovered !== undefined) && (path !== '/identity/erase/begin'
      || body.canonical !== 1 || !body.discovered || body.discovered.tenant !== context.tenant
      || body.discovered.subject !== context.subject || body.discovered.erasureId !== body.erasureId)) throw new SessionAccessError();
    if (body.capture !== undefined && !['/identity/erase/source', '/identity/erase/source-effects'].includes(path)) throw new SessionAccessError();
    if ((body.physical !== undefined || body.entry !== undefined) && path !== '/identity/erase/physical') throw new SessionAccessError();
    return this.serialize(async () => {
      const key = 'identityErasure:' + body.erasureId, saved = await this.state.storage.get(key);
      const receipt = saved === undefined ? null : erasureReceiptSchema.parse(saved);
      if (path === '/identity/erase/source-effects') {
        const registration = body.registration;
        if (!registration || body.capture === undefined || registration.intent.tenant !== context.tenant || registration.intent.visitorId !== context.subject
          || !this.isActualObject(context.tenant, context.subject) || body.after !== undefined || body.limit !== undefined || body.sessionId !== undefined) throw new SessionAccessError();
        const witness = await identityDigest(registration);
        const exactRaw = await this.state.storage.get(sourceErasureKey(body.erasureId, witness));
        // The retained first protocol stored one exact source receipt at the
        // generic key. It proves effects only with this same witness AND cutoff;
        // an old receipt lacking the captured cutoff is never upgraded here.
        const exact = erasureReceiptSchema.parse(exactRaw === undefined && receipt?.kind === 'source' && receipt.witness === witness ? receipt : exactRaw);
        if (exact.kind !== 'source' || exact.witness !== witness || exact.cutoff !== body.capture) throw new SessionAccessError();
        await writeTombstone(this.rawEnv.STORAGE, context.tenant, context.subject, 'identity-erasure', body.capture);
        if (await resetVisitorRing(this.rawEnv, context.tenant, context.subject) === 'failed') throw new SessionAccessError();
        return json({ ok: true });
      }
      if (path === '/identity/erase/physical') {
        const capsule = body.physical, registration = body.registration;
        if (!capsule || body.entry === undefined || !registration || body.after !== undefined || body.limit !== undefined
          || body.sessionId !== undefined || !this.isActualObject(context.tenant, context.subject)
          || capsule.tenant !== context.tenant || capsule.subject !== context.subject || capsule.erasureId !== body.erasureId
          || capsule.sourceEpoch !== registration.intent.sourceEpoch || capsule.registrationDigest !== await identityDigest(registration)) throw new SessionAccessError();
        const exact = erasureReceiptSchema.parse(await this.state.storage.get(sourceErasureKey(body.erasureId, capsule.registrationDigest)));
        if (exact.kind !== 'source' || exact.witness !== capsule.registrationDigest || !exact.physical
          || JSON.stringify(exact.physical) !== JSON.stringify(capsule)) throw new SessionAccessError();
        const guard = async () => {
          const authority = await this.grantAuthority();
          if (!authority || authority.epoch !== exact.continuationEpoch || Object.keys(authority.grants).length) throw new SessionAccessError();
          const state = await this.state.storage.get(['affinity', 'pipeline', 'identityIntent', 'identityTransfer', 'forwardTo']);
          if ([...state.values()].some(value => value !== undefined && value !== null)) throw new SessionAccessError();
        };
        await guard();
        const entry = capsule.entries[body.entry]; if (!entry) throw new SessionAccessError();
        const raw = await this.rawEnv.SESSIONS.get(entry.key);
        if (raw !== null && (typeof raw !== 'string' || await erasureRawDigest(raw) !== entry.digest)) throw new SessionAccessError();
        await guard();
        if (raw !== null) await this.rawEnv.SESSIONS.delete(entry.key);
        await guard(); return json({ ok: true });
      }
      if (path === '/identity/erase/guard') {
        if (body.sessionId !== undefined || body.registration || body.after !== undefined || body.limit !== undefined
          || !receipt?.continuationEpoch || !this.isActualObject(context.tenant, context.subject)) throw new SessionAccessError();
        const authority = await this.grantAuthority();
        if (!authority || authority.epoch !== receipt.continuationEpoch || Object.keys(authority.grants).length) throw new SessionAccessError();
        const current = await this.state.storage.get(['affinity', 'pipeline', 'identityIntent', 'identityTransfer', 'forwardTo']);
        if ([...current.values()].some(value => value !== undefined && value !== null)) throw new SessionAccessError();
        return json({ ok: true });
      }
      if (path === '/identity/erase/session') {
        if (!body.sessionId || body.registration || body.after !== undefined || body.limit !== undefined || !receipt) throw new SessionAccessError();
        const witness = sessionErasureSchema.parse(await this.state.storage.get(sessionErasureKey(body.erasureId, body.sessionId)));
        if (witness.sessionId !== body.sessionId || (witness.receiptKey !== key
          && witness.receiptKey !== sourceErasureKey(body.erasureId, witness.witness ?? ''))) throw new SessionAccessError();
        const exact = erasureReceiptSchema.parse(await this.state.storage.get(witness.receiptKey));
        if (exact.witness !== witness.witness || (witness.witness !== null ? exact.kind !== 'source' : exact.kind === 'source')) throw new SessionAccessError();
        const authority = await this.grantAuthority();
        await this.load(); this.assertInternalState(context);
        if (Object.values(authority?.grants ?? {}).some(grant => grant.sessionId === body.sessionId && grant.authorityEpoch !== witness.epoch)
          || (this.pipeline?.sessionId === body.sessionId && authority?.epoch !== witness.epoch)) throw new SessionAccessError();
        return json({ ok: true });
      }
      if (body.sessionId !== undefined) throw new SessionAccessError();
      if (path === '/identity/erase/begin') {
        if (!isShopperId(context.subject) || body.registration || body.after !== undefined || body.limit !== undefined) throw new SessionAccessError();
        if (receipt) {
          if (receipt.kind !== 'target' || receipt.witness !== null) throw new SessionAccessError();
          if (body.canonical && (!receipt.canonical || receipt.canonical.tenant !== context.tenant
            || receipt.canonical.subject !== context.subject || receipt.canonical.erasureId !== body.erasureId
            || receipt.canonical.discoveryDigest !== await identityDigest(body.discovered))) throw new SessionAccessError();
          return json({ ok: true, highWater: receipt.highWater, ...(body.canonical ? { canonical: receipt.canonical } : {}) });
        }
        await this.load(); this.assertInternalState(context); await this.assertNotTransferred();
        if (await this.forwardTarget()) throw new SessionAccessError();
        const highWater = await this.registrationHighWater();
        const authority = await this.grantAuthority();
        let canonical: z.infer<typeof canonicalErasureSchema> | undefined;
        if (body.canonical) {
          const discovered = body.discovered!;
          const projection = discovered.session ? await this.state.storage.get<{ value: string | null; expires: number | null }>(
            'sessionProjection:' + tenantKey(context.tenant, 'session:' + discovered.session.sid)) : undefined;
          const members = await this.state.storage.get('identityMembers');
          const published = members === undefined ? undefined : membersSchema.parse(members);
          if (published && published.shopperId !== context.subject) throw new SessionAccessError();
          canonical = await captureCanonicalErasure(this.rawEnv, discovered, authority?.epoch ?? null, {
            session: projection && (projection.expires === null || projection.expires > Date.now()) && typeof projection.value === 'string'
              ? projection.value : undefined,
            shopper: published === undefined ? undefined : JSON.stringify(published),
          });
        }
        if (canonical?.session && (!authority || (this.pipeline?.sessionId !== canonical.session.sid
          && !Object.values(authority.grants).some(grant => grant.sessionId === canonical.session!.sid)))) throw new SessionAccessError();
        await this.eraseWithBarrier({ [key]: { version: 1, kind: 'target', highWater, witness: null, ...(canonical ? { canonical } : {}) } },
          { erasureId: body.erasureId, receiptKey: key, witness: null });
        return json({ ok: true, highWater, ...(canonical ? { canonical } : {}) });
      }
      if (path === '/identity/erase/page' || path === '/identity/erase/ack') {
        if (!isShopperId(context.subject) || !receipt || receipt.kind !== 'target' || receipt.witness !== null) throw new SessionAccessError();
        if (path === '/identity/erase/page') {
          if (body.registration || body.after === undefined || body.limit === undefined || body.after > receipt.highWater) throw new SessionAccessError();
          const stored = await this.state.storage.list({ prefix: 'identityRegistration:', startAfter: registrationKey(body.after), limit: body.limit });
          const entries: Array<z.infer<typeof registrationSchema> | z.infer<typeof registrationAckSchema>> = [];
          for (const [name, value] of stored) {
            const entry = z.union([registrationSchema, registrationAckSchema]).parse(value);
            if (name !== registrationKey(entry.sequence)) throw new SessionAccessError();
            if (entry.sequence > receipt.highWater) break;
            if (entry.sequence !== body.after + entries.length + 1
              || ('intent' in entry && (entry.intent.tenant !== context.tenant || entry.intent.shopperId !== context.subject))) throw new SessionAccessError();
            entries.push(entry);
          }
          const next = entries.at(-1)?.sequence ?? body.after;
          if (next < receipt.highWater && entries.length !== body.limit) throw new SessionAccessError();
          return json({ ok: true, highWater: receipt.highWater, entries, next, complete: next === receipt.highWater });
        }
        const registration = body.registration;
        if (!registration || body.after !== undefined || body.limit !== undefined || registration.sequence > receipt.highWater
          || registration.intent.tenant !== context.tenant || registration.intent.shopperId !== context.subject) throw new SessionAccessError();
        const digest = await identityDigest(registration), registrationId = registrationKey(registration.sequence);
        const current = z.union([registrationSchema, registrationAckSchema]).parse(await this.state.storage.get(registrationId));
        if ('intent' in current ? JSON.stringify(current) !== JSON.stringify(registration) : current.digest !== digest) throw new SessionAccessError();
        if ('intent' in current) await this.state.storage.put(registrationId, { version: 1, sequence: registration.sequence, erasureId: body.erasureId, digest });
        return json({ ok: true });
      }
      if (path === '/identity/erase/source') {
        const registration = body.registration;
        if (!registration || body.after !== undefined || body.limit !== undefined
          || registration.intent.tenant !== context.tenant || registration.intent.visitorId !== context.subject) throw new SessionAccessError();
        const witness = await identityDigest(registration), intentDigest = await identityDigest(registration.intent);
        if (receipt?.kind === 'target') throw new SessionAccessError();
        const completionKey = sourceErasureKey(body.erasureId, witness), completed = await this.state.storage.get(completionKey);
        if (completed !== undefined) {
          const exact = erasureReceiptSchema.parse(completed);
          if (!receipt || exact.kind !== 'source' || exact.witness !== witness) throw new SessionAccessError();
          if (body.capture !== undefined && exact.physical && exact.physical.cutoff !== body.capture) throw new SessionAccessError();
          return json({ ok: true, ...(body.capture !== undefined ? { physical: exact.physical ?? null } : {}) });
        }
        // The first protocol artifact kept one exact source receipt at the generic guard key.
        if (receipt?.kind === 'source' && receipt.witness === witness) return json({ ok: true, ...(body.capture !== undefined ? { physical: null } : {}) });
        const retired = await this.state.storage.get('identityRetired:' + registration.intent.sourceEpoch);
        const complete = { [completionKey]: { version: 1, kind: 'source', highWater: 0, witness, ...(body.capture !== undefined ? { cutoff: body.capture } : {}) },
          ...(!receipt ? { [key]: { version: 1, kind: 'object', highWater: 0, witness: null } } : {}) };
        const eligibility = { erasureId: body.erasureId, receiptKey: completionKey, witness,
          source: { sessionId: registration.intent.sourceSessionId, epoch: registration.intent.sourceEpoch } };
        if (retired !== undefined) {
          if (retired !== intentDigest) throw new SessionAccessError();
          // A previous reset already removed this exact generation. Never erase its successor.
          await this.state.storage.transaction(async transaction => {
            const prior = await transaction.list();
            this.retainSessionEligibility(prior, complete, body.erasureId, completionKey, witness, [eligibility.source]);
            await transaction.put(complete);
          });
          return json({ ok: true, ...(body.capture !== undefined ? { physical: null } : {}) });
        }
        const intent = await this.intentState(), authority = await this.grantAuthority();
        if (!intent || JSON.stringify(intent) !== JSON.stringify(registration.intent) || !authority
          || authority.epoch !== intent.sourceEpoch) throw new SessionAccessError();
        const transfer = await this.transferState();
        if (transfer && (transfer.transfer.targetEpoch !== registration.targetEpoch
          || transfer.transfer.targetSequence !== registration.sequence
          || JSON.stringify(intentSchema.strip().parse(transfer.transfer)) !== JSON.stringify(intent))) throw new SessionAccessError();
        await this.load(); this.assertInternalState(context);
        if (this.pipeline && this.pipeline.sessionId !== intent.sourceSessionId) throw new SessionAccessError();
        let physical: z.infer<typeof historicalErasureCapsuleSchema> | undefined;
        if (body.capture !== undefined) {
          const entries: z.infer<typeof historicalErasureCapsuleSchema>['entries'] = [];
          const ownedSid = this.pipeline?.sessionId === intent.sourceSessionId || Object.values(authority.grants).some(grant =>
            grant.tenant === context.tenant && grant.subject === context.subject && grant.sessionId === intent.sourceSessionId && grant.authorityEpoch === intent.sourceEpoch);
          if (ownedSid) for (const kind of ['session', 'pointer'] as const) {
            const key = tenantKey(context.tenant, kind === 'session' ? 'session:' + intent.sourceSessionId : 'user:' + context.subject);
            const projection = await this.state.storage.get<{ value: string | null }>('sessionProjection:' + key);
            if (!projection || typeof projection.value !== 'string') continue;
            if (kind === 'session') {
              const value = sessionDataSchema.parse(JSON.parse(projection.value));
              if (value.userId !== context.subject) throw new SessionAccessError();
            } else identityId.parse(projection.value);
            const raw = await this.rawEnv.SESSIONS.get(key);
            if (raw !== null && raw !== projection.value) throw new SessionAccessError();
            entries.push({ kind, key, sid: intent.sourceSessionId, digest: await erasureRawDigest(projection.value) });
          }
          physical = historicalErasureCapsuleSchema.parse({ version: 1, tenant: context.tenant, subject: context.subject,
            erasureId: body.erasureId, sourceEpoch: intent.sourceEpoch, cutoff: body.capture, registrationDigest: witness, entries });
          Object.assign(complete[completionKey]!, { physical });
        }
        await this.eraseWithBarrier(complete, eligibility);
        return json({ ok: true, ...(body.capture !== undefined ? { physical: physical ?? null } : {}) });
      }
      if (path === '/identity/erase/object') {
        if (body.registration || body.after !== undefined || body.limit !== undefined) throw new SessionAccessError();
        if (!receipt) {
          // A KV projection is not authority to erase a prospective source generation.
          for (const marker of ['identityIntent', 'identityTransfer']) {
            if ((await this.state.storage.list({ prefix: marker, limit: 1 })).has(marker)) throw new SessionAccessError();
          }
          if ((await this.state.storage.list({ prefix: 'identityRetired:', limit: 1 })).size) throw new SessionAccessError();
          await this.eraseWithBarrier({ [key]: { version: 1, kind: 'object', highWater: 0, witness: null } },
            { erasureId: body.erasureId, receiptKey: key, witness: null });
        }
        return json({ ok: true });
      }
      return json({ ok: false }, 404);
    });
  }

  /** The source holds its serialization through the target acknowledgement. */
  private async handleLink(request: Request, context: InternalContext | SessionCapability): Promise<Response> {
    const body = z.object({ shopperId: z.string().refine(isShopperId), now: identityTime,
      assurance: assuranceSchema, source: linkSourceSchema, salted: z.boolean(),
    }).strict().parse(await request.json());
    return this.serialize(async () => {
      const principal = 'kind' in context ? context : undefined;
      if (!this.isActualObject(context.tenant, context.subject) || isShopperId(context.subject)
        || (principal && principal.kind !== 'anonymous')) throw new SessionAccessError();
      if (principal) assertSessionTarget(principal);
      let prepared = await this.transferState();
      let intent = await this.intentState();
      const target = this.env.SHOPPER_REFLEX.get(this.env.SHOPPER_REFLEX.idFromName(shopperObjectName(context.tenant, body.shopperId)));
      if (principal && (prepared || intent)) await this.assertGrant(principal, false);
      if (!intent) {
        if (prepared) throw new SessionAccessError();
        if (principal) await this.assertOwned(principal, request);
        else { await this.load(); this.assertInternalState(context); if (await this.forwardTarget()) throw new SessionAccessError(); }
        const sourceConsent = await this.consentNow();
        if (personalizes(sourceConsent) && this.affinity) {
          requireConsentPurpose(sourceConsent, 'personalization');
          pinProfileRetention(this.env, this.affinity, context.tenant);
          await resolveTenantReflexConfig(this.env, context.tenant, this.surface());
        }
        let authority = await this.grantAuthority();
        if (!authority) {
          const prior = await this.state.storage.list(), allowed = new Set(OWNED_STATE_KEYS);
          if ([...prior.keys()].some(key => !allowed.has(key)) || (prior.has('affinity') !== prior.has('pipeline'))) throw new SessionAccessError();
          authority = { version: 1, epoch: crypto.randomUUID(), grants: {} };
        }
        intent = intentSchema.parse({ version: 1, id: crypto.randomUUID(), tenant: context.tenant, visitorId: context.subject,
          sourceSessionId: principal?.sessionId ?? this.pipeline?.sessionId ?? crypto.randomUUID(), sourceEpoch: authority.epoch,
          shopperId: body.shopperId, at: body.now, assurance: body.assurance, source: body.source, salted: body.salted });
        if (principal) assertSessionTarget(principal);
        await this.state.storage.put({ identityIntent: intent, grantAuthority: authority });
      }
      if (intent.tenant !== context.tenant || intent.visitorId !== context.subject || intent.shopperId !== body.shopperId
        || intent.assurance !== body.assurance || intent.source !== body.source || intent.salted !== body.salted
        || (principal && intent.sourceSessionId !== principal.sessionId)
        || (await this.grantAuthority())?.epoch !== intent.sourceEpoch) throw new SessionAccessError();
      if (!prepared) {
        await this.load(); this.assertInternalState(context);
        const admission = await target.fetch('https://shopper-reflex/identity/admission', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Reflex-Tenant': context.tenant, 'X-Reflex-Subject': body.shopperId },
          body: JSON.stringify({ intent }),
        });
        if (!admission.ok) throw new SessionAccessError();
        const { registration } = z.object({ ok: z.literal(true), epoch: z.string().uuid(), registration: registrationSchema }).strict().parse(await admission.json());
        if (JSON.stringify(registration.intent) !== JSON.stringify(intent)) throw new SessionAccessError();
        if (principal) assertSessionTarget(principal);
        const profile = structuredClone({ affinity: this.affinity, pipeline: this.pipeline });
        const draft = { ...intent, targetEpoch: registration.targetEpoch, targetSequence: registration.sequence, ...profile,
          profileDigest: await identityDigest(profile) };
        const transfer = await this.validateTransfer({ ...draft, fingerprint: await transferFingerprint(draft) });
        prepared = { transfer, status: 'prepared' };
        if (principal) assertSessionTarget(principal);
        await this.state.storage.put('identityTransfer', prepared);
      }
      const transfer = await this.validateTransfer(prepared.transfer, prepared.scrubbed === true);
      if (JSON.stringify(intentSchema.strip().parse(transfer)) !== JSON.stringify(intent)) throw new SessionAccessError();
      if (transfer.tenant !== context.tenant || transfer.visitorId !== context.subject || transfer.shopperId !== body.shopperId
        || transfer.assurance !== body.assurance || transfer.source !== body.source || transfer.salted !== body.salted
        || (principal && transfer.sourceSessionId !== principal.sessionId)) throw new SessionAccessError();
      // Never replay a captured consent value: refusal can arrive between retries.
      this.consent = storedConsent(await this.state.storage.get('consent'));
      if (personalizes(this.consent) && transfer.affinity) pinProfileRetention(this.env, transfer.affinity, context.tenant);
      const consent = intersectConsent(this.consent, consentFromCookies(request.headers.get('Cookie')));
      if (consent.tracking !== this.consent.tracking || consent.personalization !== this.consent.personalization) await this.setConsent(consent);
      if (principal) assertSessionTarget(principal);
      const response = await target.fetch('https://shopper-reflex/identity/transfer', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Reflex-Tenant': context.tenant, 'X-Reflex-Subject': body.shopperId },
        body: JSON.stringify({ transfer, consent, receiptRequired: prepared.status === 'complete', ...(prepared.scrubbed ? { scrubbed: true } : {}),
          ...(principal ? { sourceCapability: capabilityToken(request) } : {}) }),
      });
      const resultBody = await response.json() as { ok?: unknown; result?: unknown };
      if (!response.ok || resultBody.ok !== true) throw new SessionAccessError();
      const result = identityResultSchema.parse(resultBody.result);
      if (result.shopperId !== transfer.shopperId || result.visitorId !== transfer.visitorId || result.assurance !== transfer.assurance) throw new SessionAccessError();
      // A compact completed operation may recover only its already-issued
      // identity receipt. Never re-publish a profile or renew a copied deadline.
      if (prepared.scrubbed) { if (principal) assertSessionTarget(principal); return json({ ok: true, result }); }
      const forwardTo = shopperObjectName(context.tenant, body.shopperId);
      const sourceKey = tenantKey(context.tenant, 'session:' + transfer.sourceSessionId);
      const projectionKey = 'sessionProjection:' + sourceKey;
      const projection = (this.env.REFLEX_HOST ?? 'session') === 'session'
        ? await this.state.storage.get<{ value: string | null; expires: number | null; metadata?: unknown }>(projectionKey) : undefined;
      const source = projection?.value ? sessionDataSchema.parse(JSON.parse(projection.value)) : null;
      if (source && (source.userId !== context.subject || (source.forwardTo !== undefined && source.forwardTo !== result.sessionId))) throw new SessionAccessError();
      const forwarded = source ? { ...projection!, value: JSON.stringify({ ...source, forwardTo: result.sessionId }), pending: true } : undefined;
      const pointerKey = tenantKey(context.tenant, 'user:' + context.subject), pointerProjectionKey = 'sessionProjection:' + pointerKey;
      const forwardedPointer = forwarded ? { ...forwarded, value: result.sessionId } : undefined;
      if (principal) assertSessionTarget(principal);
      // W16 C6: this browser is about to become a person. The anonymous
      // recognition chain is retired first; a link never carries one forward.
      try { await this.state.storage.delete(CONTINUITY_KEY);
        await this.state.storage.put({ identityTransfer: { transfer, status: 'complete' }, forwardTo,
          ...(forwarded ? { [projectionKey]: forwarded, [pointerProjectionKey]: forwardedPointer } : {}) }); }
      catch (error) { this.forwardTo = undefined; this.loaded = false; throw error; }
      this.forwardTo = forwardTo;
      if (forwarded) {
        // Source-owned recovery publication; target never calls back into source.
        const options = { ...(forwarded.expires === null ? {} : { expiration: Math.floor(forwarded.expires / 1000) }),
          ...(forwarded.metadata === undefined ? {} : { metadata: forwarded.metadata }) };
        if (principal) assertSessionTarget(principal);
        if (forwarded.expires !== null && forwarded.expires - Date.now() < 60_000) await this.rawEnv.SESSIONS.delete(sourceKey);
        else await this.rawEnv.SESSIONS.put(sourceKey, forwarded.value, options);
        if (principal) assertSessionTarget(principal);
        if (forwarded.expires !== null && forwarded.expires - Date.now() < 60_000) await this.rawEnv.SESSIONS.delete(pointerKey);
        else await this.rawEnv.SESSIONS.put(pointerKey, result.sessionId, options);
        await this.state.storage.put({ [projectionKey]: { ...forwarded, pending: false }, [pointerProjectionKey]: { ...forwardedPointer!, pending: false } });
      }
      if (principal) assertSessionTarget(principal);
      return json({ ok: true, result });
    });
  }

  /** Receipt, state and compatibility membership share the target's one commit. */
  private async handleTransfer(request: Request, context: InternalContext): Promise<Response> {
    const body = z.object({ transfer: transferSchema, consent: consentSchema, receiptRequired: z.boolean().optional(), scrubbed: z.literal(true).optional(), sourceCapability: z.string().optional() }).strict().parse(await request.json());
    if (body.scrubbed && body.receiptRequired !== true) throw new SessionAccessError();
    const transfer = await this.validateTransfer(body.transfer, body.scrubbed === true);
    if (transfer.tenant !== context.tenant || transfer.shopperId !== context.subject) throw new SessionAccessError();
    return this.serialize(async () => {
      if (body.sourceCapability) {
        const source = await verifySessionCapability(this.rawEnv, body.sourceCapability, context.tenant);
        if (source.subject !== transfer.visitorId || source.sessionId !== transfer.sourceSessionId || source.authorityEpoch !== transfer.sourceEpoch) throw new SessionAccessError();
        // Source serialization remains held by the one-way RPC. Bind its public
        // expiry to every target effect as well, without a reverse owner callback.
        admitOwnerPrincipal(this, source);
      }
      await this.load(); this.assertInternalState(context); await this.assertNotTransferred();
      if (await this.forwardTarget()) throw new SessionAccessError();
      const authority = await this.grantAuthority();
      if (!authority || authority.epoch !== transfer.targetEpoch) throw new SessionAccessError();
      const registration = registrationSchema.parse(await this.state.storage.get(registrationKey(transfer.targetSequence)));
      if (registration.targetEpoch !== transfer.targetEpoch || registration.sequence !== transfer.targetSequence
        || JSON.stringify(registration.intent) !== JSON.stringify(intentSchema.strip().parse(transfer))) throw new SessionAccessError();
      const key = 'identityReceipt:' + transfer.id, saved = await this.state.storage.get(key);
      if (body.receiptRequired && saved === undefined) throw new SessionAccessError();
      if (body.scrubbed) {
        const receipt = transferReceiptSchema.parse(saved);
        if (JSON.stringify(receipt.transfer) !== JSON.stringify(transferReceiptSchema.shape.transfer.strip().parse(transfer))
          || receipt.transfer.fingerprint !== await transferFingerprint(receipt.transfer)
          || receipt.result.shopperId !== transfer.shopperId || receipt.result.visitorId !== transfer.visitorId
          || receipt.result.assurance !== transfer.assurance) throw new SessionAccessError();
        await this.assertGrant(receipt.result.grant, false);
        const current = await this.consentNow(), consent = carryConsent(body.consent, context, current);
        if (JSON.stringify(consent) !== JSON.stringify(current)) await this.setConsent(consent);
        const cookieHeaders = new SessionManager(this.env, { tenant: context.tenant }).generateConsentCookieHeaders(
          { trackingConsent: consent.tracking, personalizationEnabled: consent.personalization }, consent);
        return json({ ok: true, result: { ...receipt.result, consent, cookieHeaders, audiences: [], changes: { entered: [], exited: [], explain: [] } } });
      }
      const store = this.identityStore(context.tenant);
      const rawMembers = await this.state.storage.get('identityMembers');
      // One-time compatibility adoption is not proof that historical KV data was complete.
      const adopted = rawMembers === undefined && saved === undefined ? await store.shopperProjection(context.subject) : rawMembers;
      let members: ShopperRecord = adopted === undefined && saved === undefined
        ? { shopperId: context.subject, createdAt: transfer.at, salted: transfer.salted, visitors: [],
          retention: retentionBirth(this.env, context.tenant, 'identity', transfer.at, transfer.at) } : membersSchema.parse(adopted);
      pinRetention(this.env, members.retention, context.tenant, 'identity');
      const identityAlarm = await this.state.storage.getAlarm();
      if (identityAlarm === null || identityAlarm > members.retention!.expiresAt) await this.state.storage.setAlarm(members.retention!.expiresAt);
      if (members.shopperId !== context.subject || new Set(members.visitors.map(member => member.visitorId)).size !== members.visitors.length) throw new SessionAccessError();
      const current = storedConsent(await this.state.storage.get('consent')), consent = carryConsent(body.consent, context, current);
      this.consent = current;
      let receipt: z.infer<typeof transferReceiptSchema>;
      if (saved !== undefined) {
        receipt = transferReceiptSchema.parse(saved);
        if (receipt.transfer.fingerprint !== transfer.fingerprint || receipt.transfer.fingerprint !== await transferFingerprint(receipt.transfer)
          || receipt.result.shopperId !== transfer.shopperId || receipt.result.assurance !== transfer.assurance
          || receipt.result.visitorId !== transfer.visitorId
          || (this.pipeline && receipt.result.sessionId !== this.pipeline.sessionId)) throw new SessionAccessError();
        await this.assertGrant(receipt.result.grant, false);
        // A later refusal changes only consent; the accepted merge is never replayed or undone.
        if (consent.tracking !== current.tracking || consent.personalization !== current.personalization) await this.setConsent(consent);
      } else {
        if (personalizes(consent)) requireConsentPurpose(consent, 'personalization');
        const from = personalizes(consent) ? transfer.affinity : null, fromPipe = personalizes(consent) ? transfer.pipeline : null;
        const now = Date.now();
        // Refusal permits the identity receipt, not a tick of existing behavior.
        const retained = !personalizes(consent) && this.affinity && this.pipeline
          ? { affinity: this.affinity, pipeline: this.pipeline,
            merged: { state: this.affinity.reflex, changes: { entered: [], exited: [], explain: [] } } } : null;
        const cfg = !personalizes(consent) ? undefined : await resolveTenantReflexConfig(this.env, context.tenant, this.surface());
        const candidate = personalizes(consent) ? await this.mergedIdentity(context.tenant, context.subject, from, fromPipe, now, cfg!) : retained;
        const sessionId = candidate?.pipeline.sessionId ?? await this.retainedCanonicalSid(authority) ?? crypto.randomUUID();
        const merged = candidate?.merged ?? { state: { audiences: [] }, changes: { entered: [], exited: [], explain: [] } };
        const issuedAt = Math.floor(now / 1000);
        const grant = grantSchema.parse({ tenant: context.tenant, subject: context.subject, sessionId,
          kind: 'recognized', grantId: crypto.randomUUID(), authorityEpoch: authority.epoch, iat: issuedAt, exp: issuedAt + SHOPPER_MAX_AGE });
        authority.grants[grant.grantId] = grant;
        members = { ...members, visitors: [...members.visitors.filter(member => member.visitorId !== transfer.visitorId),
          { visitorId: transfer.visitorId, linkedAt: transfer.at, assurance: transfer.assurance, source: transfer.source }].slice(-50) };
        const result = { shopperId: transfer.shopperId, visitorId: transfer.visitorId, outcome: 'linked' as const,
          assurance: transfer.assurance, sessionId, changes: merged.changes,
          audiences: merged.state.audiences, cookieHeaders: [], consent, grant };
        const identity = transferReceiptSchema.shape.transfer.strip().parse(transfer);
        receipt = { transfer: identity, result, ...(candidate?.affinity.retention ? { retention: candidate.affinity.retention, externalRetention: candidate.affinity.externalRetention } : {}) };
        await this.scheduleConsentAlarm(consent);
        if (personalizes(consent)) await this.persistAudienceState(candidate!.affinity, candidate!.pipeline, null, true,
          { [key]: receipt, identityMembers: members, consent, grantAuthority: authority });
        else { recheckOwnerInvocation(this); await this.state.storage.put({ [key]: receipt, identityMembers: members, consent, grantAuthority: authority }); }
        this.consent = consent;
        if (cfg) await this.scheduleNextCrossing(now, cfg);
      }
      await this.scheduleConsentAlarm();
      if (personalizes(await this.consentNow())) await this.publishCurrentSession(context);
      const sourceSnapshot = (this.env.REFLEX_HOST ?? 'session') === 'session'
        ? await new SessionManager(this.env, { tenant: context.tenant }).readSnapshot(transfer.sourceSessionId) : null;
      if (sourceSnapshot && sourceSnapshot.data.userId !== transfer.visitorId) throw new SessionAccessError();
      await store.publish({ retention: members.retention, visitorId: transfer.visitorId, shopperId: transfer.shopperId, linkedAt: transfer.at,
        assurance: transfer.assurance, source: transfer.source,
        ...(sourceSnapshot ? { ownSessionId: transfer.sourceSessionId } : {}) }, members);
      const allowed = await this.consentNow();
      const session = personalizes(allowed) ? await this.importSessionData(context) : undefined, manager = new SessionManager(this.env, { tenant: context.tenant });
      if (personalizes(allowed)) requireConsentPurpose(allowed, 'personalization');
      if (personalizes(allowed)) pinProfileRetention(this.env, this.affinity, context.tenant);
      if (personalizes(allowed) && !receipt.scrubbed && receipt.retention) pinRetention(this.env, receipt.retention, context.tenant, 'profile');
      if (personalizes(allowed) && !receipt.scrubbed) for (const [category, stamp] of Object.entries(receipt.externalRetention ?? {})) pinRetention(this.env, stamp, context.tenant, category as RetentionStamp['category']);
      const cookieHeaders = session && personalizes(allowed) ? manager.createCookieHeaders(manager.generateSessionCookies(session, this.pipeline!.sessionId))
        : manager.generateConsentCookieHeaders({ trackingConsent: allowed.tracking, personalizationEnabled: allowed.personalization }, allowed);
      return json({ ok: true, result: { ...receipt.result, ...(!personalizes(allowed) ? { audiences: [], changes: { entered: [], exited: [], explain: [] } } : {}), cookieHeaders, consent: allowed } });
    });
  }

  private async forwardTarget(): Promise<string | null> {
    if (this.forwardTo === undefined) {
      this.forwardTo = ((await this.state.storage.get('forwardTo')) as string | undefined) ?? null;
    }
    return this.forwardTo;
  }

  /** Called INSIDE the same serialized operation as the effect, never before it. */
  private async assertOwned(principal: SessionCapability, request?: Request, restrictiveConsent = false, adopt = true, admit = true): Promise<void> {
    assertSessionTarget(principal);
    if (!this.isActualObject(principal.tenant, principal.subject)) throw new SessionAccessError();
    const transfer = await this.transferState(), intent = await this.intentState();
    if ((transfer || intent) && (!restrictiveConsent || (transfer?.transfer ?? intent)!.sourceSessionId !== principal.sessionId)) throw new SessionAccessError();
    if (await this.forwardTarget() && !(restrictiveConsent && (transfer || intent))) throw new SessionAccessError();
    await this.load();
    if ((this.affinity && this.affinity.shopperId !== principal.subject)
      || (this.pipeline?.visitorId && this.pipeline.visitorId !== principal.subject)
      || (this.pipeline && this.pipeline.sessionId !== principal.sessionId)) throw new SessionAccessError();
    await this.assertGrant(principal, adopt);
    if (admit) admitOwnerPrincipal(this, principal);
    if ((this.env.REFLEX_HOST ?? 'session') === 'session') {
      const projection = await this.state.storage.get<{ expires: number | null }>('sessionProjection:' + tenantKey(principal.tenant, 'session:' + principal.sessionId));
      if (projection?.expires !== null && projection?.expires !== undefined && projection.expires <= Date.now()) {
        await this.sessionProjectionStore().get(tenantKey(principal.tenant, 'session:' + principal.sessionId));
      }
    }
    // Cookies can restrict this owned object, never select a profile or enable consent.
    const hints = consentFromCookies(request?.headers.get('Cookie'));
    if (!hints.tracking || !hints.personalization) await this.setConsent({
      ...(!hints.tracking ? { tracking: false } : {}),
      ...(!hints.personalization ? { personalization: false } : {}),
    });
  }

  /**
   * When this object forwards, hand the request to the person's object by its
   * stored name. The name carries the brand prefix already, so no tenant needs
   * to be known here. A socket upgrade is NOT forwarded: the client is told the
   * id to reconnect under, and reconnects.
   */
  private async forwardIfLinked(request: Request, context: InternalContext): Promise<Response | null> {
    const to = await this.forwardTarget();
    if (!to) return null;
    const prefix = context.tenant === DEFAULT_TENANT ? '' : `t:${context.tenant}:`;
    const subject = to.slice(prefix.length);
    if (!to.startsWith(prefix) || !/^[A-Za-z0-9_.-]{1,200}$/.test(subject)) return json({ ok: false, error: 'Shopper context unavailable' }, 401);
    const stub = this.env.SHOPPER_REFLEX.get(this.env.SHOPPER_REFLEX.idFromName(to));
    const headers = new Headers(request.headers);
    headers.set('X-Reflex-Tenant', context.tenant); headers.set('X-Reflex-Subject', subject);
    const res = await stub.fetch(new Request(request, { headers }));
    const body = await res.text();
    const responseHeaders = new Headers(res.headers);
    responseHeaders.set('X-Forwarded-Shopper', to);
    return new Response(body, { status: res.status, headers: responseHeaders });
  }

  /**
   * Fold another object's export into this one. The reflex vectors merge on the
   * decay invariant; counters add; first seen is the earliest. This object
   * becomes the person: its shopper id is the canonical one from here on.
   */
  private async mergedIdentity(tenant: string, shopperId: string, from: AffinityRecord | null, fromPipe: PipelineRecord | null, now: number, cfg: ReflexConfig) {
    const retention = this.affinity && from ? mergeRetention(this.affinity.retention, from.retention, tenant, 'profile')
      : this.affinity ? requireRetention(this.env, this.affinity.retention, tenant, 'profile')
      : from ? requireRetention(this.env, from.retention, tenant, 'profile') : retentionBirth(this.env, tenant, 'profile', now, now);
    const externalRetention = this.affinity && from ? mergeExternalRetention(this.affinity.externalRetention, from.externalRetention, tenant)
      : this.affinity ? this.affinity.externalRetention : from ? from.externalRetention : externalRetentionBirths(this.env, tenant, now, now);
    pinProfileRetention(this.env, { retention, externalRetention }, tenant);
    const profileEnrichment = mergeEnrichment(this.pipeline?.profileEnrichment, fromPipe?.profileEnrichment);
    const previousExternal = new Set([...enrichmentInputs(this.pipeline?.profileEnrichment).audiences, ...enrichmentInputs(fromPipe?.profileEnrichment).audiences]);
    const merged = mergeReflexStates(this.affinity?.reflex, from?.reflex, now, cfg);

    const odp = await mergeOdpState(this.env, tenant, this.affinity, from);
    const affinity: AffinityRecord = {
      retention, externalRetention,
      shopperId,
      reflex: merged.state,
      ...odp,
      lastSeen: Math.max(this.affinity?.lastSeen ?? 0, from?.lastSeen ?? 0) || now,
      configVersion: cfg.version,
    };
    const attributes: Record<string, any> = { ...(fromPipe?.attributes ?? {}), ...(this.pipeline?.attributes ?? {}) };
    for (const k of Object.keys(RETAIL_SIGNAL_DEFAULTS)) {
      const a = this.pipeline?.attributes?.[k]; const b = fromPipe?.attributes?.[k];
      if (typeof a === 'number' && typeof b === 'number') attributes[k] = a + b;
    }
    const pipeline: PipelineRecord = {
      profileEnrichment,
      attributes,
      segments: [...new Set([...[
        ...(this.pipeline?.segments ?? []).filter(s => !this.affinity?.odpSeed.includes(s)),
        ...(fromPipe?.segments ?? []).filter(s => !from?.odpSeed.includes(s)),
      ].filter(segment => !previousExternal.has(segment)), ...merged.state.audiences, ...enrichmentInputs(profileEnrichment).audiences, ...odp.odpSeed])].sort(),
      journeyStage: this.pipeline?.journeyStage ?? fromPipe?.journeyStage ?? 'early',
      // A person's canonical projection cannot share a physical KV key with
      // the browser source whose raw SID witness must remain independently owned.
      sessionId: this.pipeline?.sessionId ?? await this.retainedCanonicalSid(await this.grantAuthority()) ?? crypto.randomUUID(),
      visitorId: shopperId,
      firstSeen: Math.min(this.pipeline?.firstSeen ?? now, fromPipe?.firstSeen ?? now),
      sessionCount: (this.pipeline?.sessionCount ?? 0) + (fromPipe?.sessionCount ?? 0),
      ...mergeVisits(this.pipeline, fromPipe),
      surface: this.pipeline?.surface ?? fromPipe?.surface,
    };
    // W16 C5.09 (R85(b)): the one derivation reads no segment, so a seed this
    // tenant no longer confirms cannot move the folded record's stage.
    return { affinity, pipeline, merged };
  }

  private async handleAbsorb(request: Request, context: InternalContext | SessionCapability): Promise<Response> {
    let body: { shopperId?: unknown; affinity?: AffinityRecord | null; pipeline?: PipelineRecord | null; now?: unknown; consent?: unknown } = {};
    try { body = await request.json(); } catch { return json({ ok: false, error: 'invalid JSON body' }, 400); }
    if (typeof body.shopperId !== 'string' || body.shopperId === '') return json({ ok: false, error: 'shopperId required' }, 400);
    const shopperId = body.shopperId;
    if (shopperId !== context.subject) return json({ ok: false, error: 'Shopper context mismatch' }, 401);
    if (body.pipeline != null && !validVisitContext(body.pipeline)) return json({ ok: false, error: 'Invalid visit context' }, 400);
    const now = typeof body.now === 'number' ? body.now : Date.now();

    return this.serialize(async () => {
      if ('kind' in context) await this.assertOwned(context, request);
      else await this.assertLegacyWriter();
      await this.load();
      this.assertInternalState(context);
      await this.assertNotTransferred();
      if (body.consent !== undefined) {
        const current = storedConsent(await this.state.storage.get('consent'));
        this.consent = current;
        const consent = intersectConsent(current, storedConsent(body.consent));
        if (!consent.tracking || !consent.personalization) await this.setConsent(consent);
      }
      requireConsentPurpose(await this.consentNow(), 'personalization');
      const cfg = await resolveTenantReflexConfig(this.env, context.tenant, this.surface());
      const from = body.affinity ?? null;
      const fromPipe = body.pipeline ?? null;
      const { affinity, pipeline, merged } = await this.mergedIdentity(context.tenant, shopperId, from, fromPipe, now, cfg);
      await this.persistAudienceState(affinity, pipeline, null);
      await this.scheduleNextCrossing(now, cfg);
      return json({ ok: true, shopperId, sessionId: pipeline.sessionId, audiences: merged.state.audiences, changes: merged.changes, ...(body.consent !== undefined ? { consent: await this.consentNow() } : {}) });
    });
  }

  /**
   * Apply historical rows, each at its own time, then evaluate at now. Touches
   * arrive already extracted by the route against the registry; this object
   * only does the arithmetic, and touches nothing about visits or lastSeen.
   */
  private async handleImport(request: Request, context: InternalContext, prepare = false): Promise<Response> {
    let body: { shopperId?: unknown; rows?: unknown; now?: unknown; operationId?: unknown; history?: unknown; retentionDependencies?: unknown } = {};
    try { body = await request.json(); } catch { return json({ ok: false, error: 'invalid JSON body' }, 400); }
    const rows = Array.isArray(body.rows) ? body.rows as Array<{ action: string; at: number; touches: Array<{ dim: string; value: string }> } | ProfileSnapshotRow> : [];
    const now = typeof body.now === 'number' ? body.now : Date.now();
    if (body.shopperId !== context.subject) return json({ ok: false, error: 'Shopper context mismatch' }, 401);
    return this.serialize(async () => {
      if (!this.isActualObject(context.tenant, context.subject)) throw new SessionAccessError();
      await this.assertNotTransferred();
      if (rows.length > 1000 || rows.some(row => !Number.isSafeInteger(row.at) || row.at < 0)) throw new SessionAccessError();
      const dependencies = z.array(z.unknown()).max(1000).parse(body.retentionDependencies ?? [])
        .map(stamp => pinRetention(this.env, stamp, context.tenant, 'identity'));
      const operationId = body.operationId === undefined ? crypto.randomUUID() : z.string().uuid().parse(body.operationId);
      const operationKey = 'identityImport:' + operationId;
      const digest = await identityDigest({ tenant: context.tenant, subject: context.subject, rows, now, history: body.history === true, ...(dependencies.length ? { dependencies } : {}) });
      let authority = await this.grantAuthority();
      const saved = await this.state.storage.get<{ epoch: string; digest: string; witness?: string; expires: number; result?: Record<string, unknown>; history?: boolean; scrubbed?: boolean }>(operationKey);
      if (saved) {
        if (saved.scrubbed || saved.expires <= Date.now() || saved.digest !== digest || saved.epoch !== (authority?.epoch ?? null)) throw new SessionAccessError();
        if (saved.result) return prepare ? json({ prepared: true }) : this.completeImportProjection(operationKey, context);
      }
      if (!prepare && !saved) throw new SessionAccessError();
      const tombstone = await loadTombstone(this.env.STORAGE, context.tenant, context.subject);
      if (tombstone && rows.some(row => row.at <= tombstone.erased_at)) throw new SessionAccessError();
      // Do not use load()/forwardTarget(): their legacy nullish defaults erase
      // the distinction between a missing record and corrupt persisted state.
      const stored = await this.state.storage.get(['affinity', 'pipeline', 'forwardTo', 'audienceOwner']);
      if (stored.get('forwardTo') !== undefined) throw new SessionAccessError();
      let affinity = stored.get('affinity') as AffinityRecord | undefined;
      let pipeline = stored.get('pipeline') as PipelineRecord | undefined;
      const consentRaw = await this.state.storage.get('consent');
      const consent = storedConsent(consentRaw);
      let adopted: { key: string; value: string; expires: number | null; pending: boolean; metadata?: unknown } | undefined;
      if (affinity === undefined && pipeline === undefined && (this.env.REFLEX_HOST ?? 'session') === 'session') {
        const sid = await this.rawEnv.SESSIONS.get(tenantKey(context.tenant, 'user:' + context.subject));
        if (sid !== null) {
          if (typeof sid !== 'string' || !identityId.safeParse(sid).success) throw new SessionAccessError();
          // A readable legacy pointer is not an adoption witness. Retained exact
          // grant ownership can authorize backend work even after bearer expiry.
          if (!authority || !Object.values(authority.grants).some(g => g.subject === context.subject && g.tenant === context.tenant && g.sessionId === sid)) throw new SessionAccessError();
          const key = tenantKey(context.tenant, 'session:' + sid), value = await this.rawEnv.SESSIONS.get(key);
          if (value !== null) {
            if (typeof value !== 'string') throw new SessionAccessError();
            const raw = JSON.parse(value) as Record<string, unknown>;
            sessionDataSchema.omit({ preferences: true }).parse(raw);
            if (raw.reflex !== undefined) historicalReflexSchema.parse(raw.reflex);
            if (raw.userId !== context.subject || raw.forwardTo !== undefined
              || (isShopperId(context.subject) ? (raw.identity as SessionData['identity'])?.shopperId !== context.subject : raw.identity !== undefined)) throw new SessionAccessError();
            if (raw.preferences === undefined) return json({ ok: true, applied: 0, audiences: [], reason: 'consent_missing' });
            const preferences = z.object({ trackingConsent: z.boolean().optional(), personalizationEnabled: z.boolean().optional() }).parse(raw.preferences);
            if (preferences.trackingConsent === undefined || preferences.personalizationEnabled === undefined) return json({ ok: true, applied: 0, audiences: [], reason: 'consent_missing' });
            if (!preferences.trackingConsent || !preferences.personalizationEnabled) return json({ ok: true, applied: 0, audiences: [], reason: 'consent_refused' });
            const session = sessionDataSchema.parse(raw);
            const prior = await this.state.storage.get<{ value: string | null; expires: number | null }>('sessionProjection:' + key);
            if (prior && (prior.value !== value || (prior.expires !== null && prior.expires <= Date.now()))) throw new SessionAccessError();
            const listed = await this.rawEnv.SESSIONS.list({ prefix: key, limit: 2 });
            const entry = listed.keys.find(entry => entry.name === key);
            if (!entry) throw new SessionAccessError();
            const expires = prior ? prior.expires : entry.expiration === undefined ? null : entry.expiration * 1000;
            if (expires !== null && expires <= Date.now()) throw new SessionAccessError();
            pinProfileRetention(this.env, session, context.tenant);
            const cfg = await resolveTenantReflexConfig(this.env, context.tenant, resolveSurface({ surface: session.surface }));
            affinity = { retention: pinProfileRetention(this.env, session, context.tenant), externalRetention: session.externalRetention, shopperId: context.subject, reflex: session.reflex ?? emptyState(cfg), odpContext: session.odpContext,
              odpSeed: session.odpSeed ?? [], odpSeedAt: session.odpSeedAt ?? 0, odpRecentEvents: session.odpRecentEvents ?? [], lastSeen: session.metadata.lastSeen, configVersion: cfg.version };
            pipeline = { attributes: session.attributes, segments: session.segments, journeyStage: session.metadata.journeyStage ?? PERSISTED_STAGE[FIRST_JOURNEY_STAGE],
              sessionId: sid, visitorId: context.subject, firstSeen: session.metadata.firstSeen, sessionCount: session.metadata.sessionCount,
              visitCount: session.metadata.visitCount, lastVisitAt: session.metadata.lastVisitAt, entryChannel: session.metadata.entryChannel,
              surface: resolveSurface({ surface: session.surface }), profileEnrichment: session.profileEnrichment };
            // Raw booleans are never affirmative authority for backend adoption.
            if (!personalizes(consent)) return json({ ok: true, applied: 0, audiences: [], reason: 'consent_refused' });
            adopted = { key, value, expires, pending: false, ...(entry.metadata === undefined ? {} : { metadata: entry.metadata }) };
          }
        }
      }
      try {
        if (affinity !== undefined) z.object({ shopperId: z.literal(context.subject), reflex: historicalReflexSchema,
          odpContext: z.string().optional(), odpSeed: z.array(z.string()), odpSeedAt: z.number().finite().nonnegative(),
          odpRecentEvents: z.array(z.record(z.string(), z.unknown())), lastSeen: z.number().finite().nonnegative(), configVersion: z.string(),
        }).parse(affinity);
        if (pipeline !== undefined) z.object({ attributes: z.record(z.string(), z.unknown()), segments: z.array(z.string()),
          journeyStage: z.enum(['early', 'mid', 'late']), sessionId: z.string().regex(/^[A-Za-z0-9_.-]{1,200}$/),
          visitorId: z.literal(context.subject).optional(), firstSeen: z.number().finite().nonnegative(),
          sessionCount: z.number().finite().nonnegative(),
        }).parse(pipeline);
        if (pipeline !== undefined) {
          if (!validVisitContext(pipeline)) throw new SessionAccessError();
          readEnrichment(pipeline.profileEnrichment);
        }
      } catch { throw new SessionAccessError(); }
      if (affinity === undefined || pipeline === undefined) return json({ ok: true, applied: 0, audiences: [], reason: 'profile_missing' });
      if (consentRaw === undefined) return json({ ok: true, applied: 0, audiences: [], reason: 'consent_missing' });
      if (!consent.tracking || !consent.personalization) return json({ ok: true, applied: 0, audiences: [], reason: 'consent_refused' });
      instructionOf(consent.instruction, context);
      requireConsentPurpose(consent, 'personalization');
      pinProfileRetention(this.env, affinity, context.tenant);
      const witness = await identityDigest({ affinity, pipeline, consent, adopted, tombstone, owner: stored.get('audienceOwner') });
      if (saved && saved.witness !== witness) throw new SessionAccessError();
      if (prepare) {
        if (!saved) {
          if (!authority) {
            const prior = await this.state.storage.list(), allowed = new Set(OWNED_STATE_KEYS);
            if ([...prior.keys()].some(key => !allowed.has(key))) throw new SessionAccessError();
            authority = { version: 1, epoch: crypto.randomUUID(), grants: {} };
          }
          await this.state.storage.put({ grantAuthority: authority, [operationKey]: { epoch: authority.epoch, digest, witness, expires: Date.now() + SESSION_TTL_SECONDS * 1000 } });
        }
        await this.scheduleProjectionAlarm(await this.state.storage.getAlarm() ?? Date.now() + SESSION_TTL_SECONDS * 1000);
        return json({ prepared: true });
      }
      const cfg = await resolveTenantReflexConfig(this.env, context.tenant, resolveSurface({ surface: pipeline.surface }));
      let state = affinity.reflex;
      let profileEnrichment = readEnrichment(pipeline.profileEnrichment);
      let behavioral = false;
      const outcomes: ImportOutcome[] = [];
      for (const [index, row] of rows.entries()) {
        if ('kind' in row) {
          const next = applyProfileSnapshot(profileEnrichment, row, now);
          profileEnrichment = next.state;
          outcomes.push(next.reason ? { index, applied: false, reason: next.reason } : { index, applied: true });
        } else {
          state = applyHistorical(state, { action: row.action, touches: row.touches }, row.at, cfg);
          behavioral = true;
          outcomes.push({ index, applied: true });
        }
      }
      const applied = outcomes.filter(outcome => outcome.applied).length;
      // Arm every original dependency before committing a completed copy, even
      // when this import has no behavioral delta and will not tick/schedule.
      await this.scheduleProjectionAlarm(Math.min(...this.copiedRetention({ retention: affinity.retention,
        externalRetention: affinity.externalRetention, dependencies }, context.tenant).map(stamp => stamp.expiresAt)));
      if (!applied) {
        await this.load();
        const result = { ok: true, applied: 0, outcomes, audiences: [], sessionId: pipeline.sessionId,
          data: adopted ? sessionDataSchema.parse(JSON.parse(adopted.value)) : await this.importSessionData(context) };
        await this.state.storage.put(operationKey, { epoch: authority!.epoch, digest, result, retention: affinity.retention, externalRetention: affinity.externalRetention, dependencies, owner: context, history: false, expires: saved!.expires, published: true });
        return json(result);
      }
      const evaluated = behavioral ? tickReflex(state, now, cfg) : { state: affinity.reflex, changes: { entered: [], exited: [], explain: [] } };
      const oldExternal = new Set(enrichmentInputs(pipeline.profileEnrichment).audiences);
      const savedOwner = stored.get('audienceOwner');
      const owner = !rows.some(row => 'kind' in row) ? null : savedOwner === undefined || savedOwner === null ? savedOwner : z.object({
        tenant: z.literal(context.tenant), subject: z.literal(context.subject), sessionId: z.literal(pipeline.sessionId),
      }).strict().parse(savedOwner);
      const nextAffinity: AffinityRecord = {
        ...affinity,
        reflex: evaluated.state,
        configVersion: behavioral ? cfg.version : affinity.configVersion,
      };
      const nextPipeline: PipelineRecord = { ...pipeline, profileEnrichment,
        segments: [...new Set([...pipeline.segments.filter(segment => !oldExternal.has(segment)), ...evaluated.state.audiences, ...enrichmentInputs(profileEnrichment).audiences])].sort() };
      // The serialized import publishes mirrors only after the one storage
      // commit succeeds. A rejected put cannot expose uncommitted typed data.
      const history = body.history === true && isShopperId(context.subject) && behavioral;
      let members: ShopperRecord | undefined;
      if (history) {
        const raw = await this.state.storage.get('identityMembers');
        const old = raw === undefined ? await this.identityStore(context.tenant).shopperProjection(context.subject) : raw;
        members = old === undefined ? { shopperId: context.subject, createdAt: pipeline.firstSeen, salted: isSalted(this.env), visitors: [],
          retention: retentionBirth(this.env, context.tenant, 'identity', pipeline.firstSeen, affinity.retention!.bornAt) } : membersSchema.parse(old);
        pinRetention(this.env, members.retention, context.tenant, 'identity');
        const identityAlarm = await this.state.storage.getAlarm();
        if (identityAlarm === null || identityAlarm > members.retention!.expiresAt) await this.state.storage.setAlarm(members.retention!.expiresAt);
        if (members.shopperId !== context.subject) throw new SessionAccessError();
        const behavioralRows = rows.filter(row => !('kind' in row));
        members = { ...members, history: { rows: (members.history?.rows ?? 0) + behavioralRows.length,
          latestAt: Math.max(members.history?.latestAt ?? 0, ...behavioralRows.map(row => row.at)), appliedAt: now } };
      }
      const result = { ok: true, applied, outcomes, audiences: [...new Set([...evaluated.state.audiences, ...enrichmentInputs(profileEnrichment).audiences])].sort(), changes: evaluated.changes };
      const projectionKey = 'sessionProjection:' + tenantKey(context.tenant, 'session:' + pipeline.sessionId);
      const originalProjection = adopted ?? await this.state.storage.get<{ value: string | null; expires: number | null; pending: boolean; metadata?: unknown }>(projectionKey);
      let updatedProjection: Record<string, unknown> | undefined;
      if (originalProjection?.value) {
        const original = sessionDataSchema.parse(JSON.parse(originalProjection.value));
        if (original.userId !== context.subject || original.forwardTo !== undefined) throw new SessionAccessError();
        updatedProjection = { value: JSON.stringify({ ...original, metadata: { ...original.metadata, lastSegmentUpdate: now } }),
          expires: originalProjection.expires, pending: originalProjection.pending,
          ...(originalProjection.metadata === undefined ? {} : { metadata: originalProjection.metadata }) };
      }
      await this.persistAudienceState(nextAffinity, nextPipeline, owner, true, {
        [operationKey]: { epoch: authority!.epoch, digest, result, retention: affinity.retention, externalRetention: affinity.externalRetention, dependencies, owner: context, history, expires: saved!.expires, published: false }, ...(members ? { identityMembers: members } : {}),
        ...(updatedProjection ? { [projectionKey]: updatedProjection } : {}), ...(adopted ? { consent } : {}),
      });
      const response = await this.completeImportProjection(operationKey, context);
      if (behavioral) await this.scheduleNextCrossing(now, cfg);
      return response;
    });
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    const stored = await this.state.storage.get(['affinity', 'pipeline', 'audienceOwner']);
    const affinity = stored.get('affinity') as AffinityRecord | undefined;
    const pipeline = stored.get('pipeline') as PipelineRecord | undefined;
    if (affinity != null) z.object({ shopperId: z.string(), reflex: historicalReflexSchema,
      odpContext: z.string().optional(), odpSeed: z.array(z.string()), odpSeedAt: z.number().finite().nonnegative(),
      odpRecentEvents: z.array(z.record(z.string(), z.unknown())), lastSeen: z.number().finite().nonnegative(), configVersion: z.string(),
    }).parse(affinity);
    if (pipeline != null) z.object({ attributes: z.record(z.string(), z.unknown()), segments: z.array(z.string()),
      journeyStage: z.enum(['early', 'mid', 'late']), sessionId: z.string(), visitorId: z.string().optional(),
      firstSeen: z.number().finite().nonnegative(), sessionCount: z.number().finite().nonnegative(),
    }).parse(pipeline);
    if (pipeline != null && !validVisitContext(pipeline)) throw new SessionAccessError();
    readEnrichment(pipeline?.profileEnrichment);
    this.affinity = affinity ?? null;
    this.pipeline = pipeline ?? null;
    this.audienceOwner = stored.get('audienceOwner');
    this.loaded = true;
  }

  private async enrichedSegments(connectors: Connectors, tenant: TenantId, now: number, selectedConfig?: ReflexConfig,
    affinity = this.affinity, pipeline = this.pipeline): Promise<string[]> {
    if (!pipeline || !affinity || !personalizes(await this.consentNow())) return [];
    const external = enrichmentInputs(pipeline.profileEnrichment);
    const surface = pipeline.surface ?? DEFAULT_SURFACE;
    const cfg = selectedConfig ?? await resolveTenantReflexConfig(this.env, tenant, surface);
    const currentReflex = (this.env.REFLEX_ENABLED ?? 'true') !== 'false' ? tickReflex(affinity.reflex, now, cfg).state : undefined;
    const attributes = { ...RETAIL_SIGNAL_DEFAULTS, ...pipeline.attributes };
    const context = { userId: affinity.shopperId, attributes, segments: [], ...(tenant === DEFAULT_TENANT ? { surface } : {}) };
    // W16 C5.09 (R85(b)): one derivation, read at `now` so this read crosses the
    // visit boundary exactly as the snapshot and the projection do.
    attributes.journey_stage = storedJourneyStage(pipeline.journey, affinity.lastSeen, now, cfg);
    if (currentReflex) Object.assign(attributes, reflexAttributes(currentReflex, now, cfg));
    Object.assign(attributes, external.attributes);
    const local = await connectors.segments.fetchQualifiedSegments(affinity.shopperId, context);
    const prefix = tenantAudienceKeyPrefix(tenant, surface);
    const reflex = currentReflex?.audiences ?? [];
    return [...new Set([...(pipeline.profileEnrichment === undefined ? pipeline.segments.filter(s => !affinity.odpSeed.includes(s)) : []), ...local, ...reflex.map(key => prefix + key), ...((await projectOdpState(this.env, tenant, affinity)).odpSeed), ...external.audiences])].sort();
  }

  /** Same audiences the request path seeds (idempotent; version-gated to one KV read). */
  private async ensureSeeded(surface: DemoSurface, tenant: TenantId): Promise<void> {
    if (this.affinity) pinProfileRetention(this.env, this.affinity, tenant);
    if (tenant !== DEFAULT_TENANT) return;
    if (this.seeded.has(surface)) return;
    try {
      const catalog = await resolveTenantCatalog(tenant, surface);
      if (!catalog) return;
      await ensureAudiencesSeeded(this.env, catalog, surface, tenant);
      this.seeded.add(surface);
    } catch (error) {
      console.error('ShopperReflex: audience seeding failed');
    }
  }

  private isActualObject(tenant: TenantId, subject: string): boolean {
    try { return this.state.id.toString() === this.env.SHOPPER_REFLEX.idFromName(shopperObjectName(tenant, subject)).toString(); }
    catch { return false; }
  }

  private assertInternalState(context: InternalContext): void {
    if (!this.isActualObject(context.tenant, context.subject)
      || (this.affinity && this.affinity.shopperId !== context.subject)
      || (this.pipeline?.visitorId && this.pipeline.visitorId !== context.subject)) throw new SessionAccessError();
  }

  private trustedAudienceOwner(): AudienceOwner | null {
    const owner = this.audienceOwner as Partial<AudienceOwner> | null | undefined;
    if (!owner || typeof owner !== 'object' || !isValidTenantId(owner.tenant)
      || typeof owner.subject !== 'string' || !/^[A-Za-z0-9_.-]{1,200}$/.test(owner.subject)
      || typeof owner.sessionId !== 'string' || !/^[A-Za-z0-9_.-]{1,200}$/.test(owner.sessionId)
      || !this.affinity || !this.pipeline || this.affinity.shopperId !== owner.subject
      || this.pipeline.sessionId !== owner.sessionId
      || (this.pipeline.visitorId && this.pipeline.visitorId !== owner.subject)
      || !this.isActualObject(owner.tenant, owner.subject)) return null;
    return owner as AudienceOwner;
  }

  /** Signed reads may route an unbound legacy record, but never bless it in storage. */
  private audienceTenant(principal: SessionCapability): TenantId {
    if (this.audienceOwner !== undefined && this.audienceOwner !== null) {
      const owner = this.trustedAudienceOwner();
      if (!owner || owner.tenant !== principal.tenant || owner.subject !== principal.subject
        || owner.sessionId !== principal.sessionId) throw new SessionAccessError();
    }
    return principal.tenant;
  }

  private async persistAudienceState(affinity: AffinityRecord, pipeline: PipelineRecord | null, owner: unknown, writeOwner = true, extra: Record<string, unknown> = {}): Promise<void> {
    recheckOwnerInvocation(this);
    const tenant = affinity.retention?.tenant ?? this.affinity?.retention?.tenant
      ?? (owner as AudienceOwner | undefined)?.tenant ?? this.trustedAudienceOwner()?.tenant ?? DEFAULT_TENANT;
    const stamp = affinity.retention ?? this.affinity?.retention;
    const retention = pinRetention(this.env, this.affinity ? mergeRetention(this.affinity.retention, stamp, tenant, 'profile') : stamp, tenant, 'profile');
    affinity = { ...affinity, retention, externalRetention: this.affinity
      ? mergeExternalRetention(this.affinity.externalRetention, affinity.externalRetention, tenant) : affinity.externalRetention };
    pinProfileRetention(this.env, affinity, tenant);
    try {
      const alarm = await this.state.storage.getAlarm();
      const deadline = Math.min(retention.expiresAt, ...Object.values(affinity.externalRetention ?? {}).map(stamp => stamp!.expiresAt));
      if (alarm === null || alarm > deadline) await this.state.storage.setAlarm(deadline);
      recheckOwnerInvocation(this);
      await this.state.storage.put({ affinity, pipeline, ...(!writeOwner || owner === undefined ? {} : { audienceOwner: owner }), ...extra });
    } catch (error) {
      // Rejection does not tell us whether storage accepted the write. Retain
      // old mirrors only as nonauthoritative values; every reader must reload.
      this.loaded = false;
      this.consent = undefined;
      throw error;
    }
    this.affinity = affinity;
    this.pipeline = pipeline;
    this.audienceOwner = owner;
    this.loaded = true;
  }

  /** The surface this shopper object belongs to (persisted; absent ⇒ coach). */
  private surface(): DemoSurface {
    return this.pipeline?.surface ?? DEFAULT_SURFACE;
  }

  private allowIngest(now: number): boolean {
    const limitRaw = Number(this.env.REFLEX_RATE_LIMIT_PER_MIN ?? DEFAULT_RATE_LIMIT_PER_MIN);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : DEFAULT_RATE_LIMIT_PER_MIN;
    if (now - this.rate.windowStart >= 60_000) {
      this.rate = { windowStart: now, count: 0 };
    }
    this.rate.count++;
    return this.rate.count <= limit;
  }

  private identityStore(tenant: string): IdentityStore {
    const kv = this.rawEnv.SESSIONS as unknown as KVLike;
    return new IdentityStore({
      get: (key, type) => ownerEffect(() => kv.get(key, type)),
      put: (key, value, options) => ownerEffect(() => kv.put(key, value, options)),
      delete: key => ownerEffect(() => kv.delete(key)),
      list: options => ownerEffect(() => kv.list!(options)),
    }, tenant);
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    if (ownerHeld(this)) return fn();
    const start = () => runOwnerOperation(this, this.rawEnv, fn, this.sessionProjectionStore(), (...args) => this.relayOperation(...args), () => this.consentNow(), hints => this.setConsent(hints),
      (id, digest, occurredAt) => this.admitEventRetention(id, digest, occurredAt), (input, principal) => this.admitRecovery(input, principal));
    const run = this.chain.then(start, start);
    this.chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async recoveryGuard(principal: SessionCapability, until: number): Promise<void> {
    if (!ownerHeld(this) || !Number.isSafeInteger(until) || until <= Date.now()) throw new SessionAccessError();
    await this.assertOwned(principal, undefined, false, false);
    const consent = await this.consentNow();
    requireConsentPurpose(consent, 'tracking');
    if (consentDeadline(consent, 'tracking') < until || until <= Date.now()) throw new SessionAccessError();
  }

  private async admitRecovery(input: RecoveryInput, principal: SessionCapability) {
    if (!this.isActualObject(input.tenant, input.subject) || !ownerHeld(this)) throw new SessionAccessError();
    const consent = await this.consentNow(), until = Math.min(consentDeadline(consent, 'tracking'), principal.exp * 1000);
    return runOwnerRecovery(this.state.storage, this.env, input, principal, until, (saved, deadline) => this.recoveryGuard(saved, deadline));
  }

  private async admitEventRetention(id: string, digest: string, occurredAt: number): Promise<ExternalRetention> {
    const owner = currentOwnerIdentity();
    if (!owner || !this.isActualObject(owner.tenant, owner.subject) || !ownerHeld(this)) throw new SessionAccessError();
    identityId.parse(id); z.string().regex(/^[a-f0-9]{64}$/).parse(digest); identityTime.parse(occurredAt);
    const key = 'externalAdmission:' + await identityDigest(id), raw = await this.state.storage.get(key);
    const schema = z.object({ digest: z.string().regex(/^[a-f0-9]{64}$/), expired: z.boolean(), tenant: z.string().optional(), subject: identityId.optional(),
      stamps: z.custom<ExternalRetention>().optional() }).strict();
    if (raw !== undefined) {
      const prior = schema.parse(raw);
      if (prior.digest !== digest || prior.expired || !prior.stamps || prior.tenant !== owner.tenant || prior.subject !== owner.subject) throw new SessionAccessError();
      for (const [category, stamp] of Object.entries(prior.stamps)) readRetention(stamp, owner.tenant, category as RetentionStamp['category']);
      return structuredClone(prior.stamps);
    }
    const now = Date.now(), stamps = externalRetentionBirths(this.env, owner.tenant, occurredAt, now);
    const values = Object.values(stamps), deadline = Math.min(...values.map(stamp => stamp!.expiresAt));
    if (!values.length || !Number.isFinite(deadline)) throw new SessionAccessError();
    const alarm = await this.state.storage.getAlarm();
    if (alarm === null || alarm > deadline) await this.state.storage.setAlarm(deadline);
    recheckOwnerInvocation(this);
    await this.state.storage.put(key, { digest, expired: false, tenant: owner.tenant, subject: owner.subject, stamps });
    return structuredClone(stamps);
  }

  private async relayOperation(operation: string, subject: string, tenant: string, payload?: unknown): Promise<Response> {
    if (!ownerHeld(this) || !this.isActualObject(tenant, subject)) throw new SessionAccessError();
    const authority = await this.grantAuthority();
    const grants = Object.values(authority?.grants ?? {}).filter(p => p.exp > Date.now() / 1000).map(p => p.grantId);
    let consentExpiresAt: number | undefined;
    if (operation === 'broadcast') {
      const consent = await this.consentNow(), purpose = (payload as { type?: string })?.type === 'odp_receipt' ? 'tracking' : 'personalization';
      requireConsentPurpose(consent, purpose);
      // Receiver's existing per-send field is a transient eligibility ceiling;
      // the stored W05 choice metadata and its original clocks are untouched.
      consentExpiresAt = Math.min(consentDeadline(consent, purpose), ownerRetentionDeadline(tenant));
    }
    recheckOwnerInvocation(this);
    const response = await this.env.PERSONALIZATION_WEBSOCKET.get(this.env.PERSONALIZATION_WEBSOCKET.idFromName(shopperObjectName(tenant, subject)))
      .fetch('https://relay/owner/' + operation, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant, subject, grants, payload, consentExpiresAt }) });
    recheckOwnerInvocation(this);
    if (!response.ok) throw new SessionAccessError();
    return response;
  }

  /** Durable owner state is authoritative; KV is an acknowledged compatibility projection. */
  private sessionProjectionStore(backend?: InternalContext): KVLike {
    const binding = this.env.SESSIONS as unknown as KVLike;
    const check = () => recheckOwnerInvocation(this);
    const keyFor = (key: string) => 'sessionProjection:' + key;
    type Projection = { value: string | null; expires: number | null; pending: boolean; metadata?: unknown;
      retentionErase?: { digest: string; epoch: string }; retentionReplace?: { digest: string; epoch: string } };
    const publish = async (key: string, record: Projection) => {
      check();
      if (record.retentionErase) {
        if ((await this.grantAuthority())?.epoch !== record.retentionErase.epoch) throw new SessionAccessError();
        const actual = await binding.get(key);
        if (actual !== null && (typeof actual !== 'string' || await identityDigest(actual) !== record.retentionErase.digest)) throw new SessionAccessError();
        check();
      }
      if (record.retentionReplace) {
        if ((await this.grantAuthority())?.epoch !== record.retentionReplace.epoch) throw new SessionAccessError();
        const actual = await binding.get(key);
        if (actual !== record.value && (typeof actual !== 'string' || await identityDigest(actual) !== record.retentionReplace.digest)) throw new SessionAccessError();
        check();
      }
      if (record.value === null || (record.expires !== null && record.expires - Date.now() < 60_000)) await binding.delete(key);
      else await binding.put(key, record.value, { ...(record.expires === null ? {} : { expiration: Math.floor(record.expires / 1000) }),
        ...(record.metadata === undefined ? {} : { metadata: record.metadata }) });
      check();
      await this.state.storage.put(keyFor(key), { ...record, pending: false });
    };
    return {
      get: async (key, type) => {
        check();
        await this.projectionChain;
        check();
        const stored = await this.state.storage.get<Projection>(keyFor(key));
        if (!stored) {
          // No historical KV value acquires authority merely by being readable.
          const previous = await binding.get(key);
          check();
          if (previous !== null) throw new SessionAccessError();
          return null;
        }
        if (stored.expires !== null && stored.expires <= Date.now()) {
          if (stored.value === null) { if (stored.pending) await publish(key, stored); return null; }
          const authority = await this.grantAuthority();
          if (!authority) throw new SessionAccessError();
          const erased: Projection = { value: null, expires: stored.expires, pending: true,
            retentionErase: { digest: await identityDigest(stored.value), epoch: authority.epoch } };
          await this.state.storage.put(keyFor(key), erased);
          await publish(key, erased);
          return null;
        }
        if (stored.pending) await publish(key, stored);
        check();
        const value = stored.expires !== null && stored.expires <= Date.now() ? null : stored.value;
        return type === 'json' && value !== null ? JSON.parse(value) : value;
      },
      put: (key, value, options) => this.orderProjection(async () => {
        check();
        if (typeof value !== 'string') throw new SessionAccessError();
        const opts = options as { expirationTtl?: number; expiration?: number; metadata?: unknown } | undefined;
        const ttl = opts?.expirationTtl;
        const record: Projection = { value, expires: opts?.expiration ? opts.expiration * 1000 : ttl ? Date.now() + ttl * 1000 : null,
          pending: true, ...(opts?.metadata === undefined ? {} : { metadata: opts.metadata }) };
        const isSession = /(?:^|:)session:[^:]+$/.test(key);
        const rawSession = isSession ? JSON.parse(value) as Record<string, unknown> : undefined;
        // Validate all known fields without discarding unrelated acknowledged
        // session material during a narrow buffered/metadata-preserving write.
        const session = rawSession ? { ...rawSession, ...sessionDataSchema.parse(rawSession) } : undefined;
        if (session) {
          const authority = await this.grantAuthority();
          const grant = Object.values(authority?.grants ?? {}).find(p => tenantKey(p.tenant, 'session:' + p.sessionId) === key && p.subject === session.userId)
            ?? (backend && authority && this.isActualObject(backend.tenant, backend.subject) && this.pipeline
              && session.userId === backend.subject && tenantKey(backend.tenant, 'session:' + this.pipeline.sessionId) === key
              ? { ...backend, sessionId: this.pipeline.sessionId } : undefined);
          if (!grant || session.forwardTo !== undefined) throw new SessionAccessError();
          const consent = await this.consentNow();
          if (consent.tracking) {
            let retention = pinProfileRetention(this.env, session, grant.tenant);
            record.expires = record.expires === null ? retention.expiresAt : Math.min(record.expires, retention.expiresAt);
            const prior = await this.state.storage.get<Projection>(keyFor(key));
            if (prior?.value) {
              const previous = sessionDataSchema.parse(JSON.parse(prior.value));
              retention = mergeRetention(previous.retention, retention, grant.tenant, 'profile');
              session.retention = retention;
              session.externalRetention = mergeExternalRetention(previous.externalRetention, session.externalRetention, grant.tenant);
              record.value = JSON.stringify(session);
              record.expires = Math.min(record.expires, retention.expiresAt, prior.expires ?? Infinity);
            }
            const deadline = Math.min(record.expires, ...this.copiedRetention(session, grant.tenant).map(stamp => stamp.expiresAt));
            const alarm = await this.state.storage.getAlarm();
            if (alarm === null || alarm > deadline) await this.state.storage.setAlarm(deadline);
          }
          if (!personalizes(consent)) {
            // A negative instruction neither creates nor recomputes behavior/config.
            check();
            try { await this.state.storage.put({ [keyFor(key)]: record }); }
            catch (error) { this.invalidateMirrors(); throw error; }
            this.consent = consent;
            await publish(key, record);
            if (record.expires !== null) {
              const alarm = await this.state.storage.getAlarm();
              if (alarm === null || alarm > record.expires) await this.state.storage.setAlarm(record.expires);
            }
            return;
          }
          requireConsentPurpose(consent, 'personalization');
          const cfg = await resolveTenantReflexConfig(this.env, grant.tenant, resolveSurface({ surface: session.surface }));
          check();
          const affinity: AffinityRecord = { shopperId: session.userId, reflex: session.reflex ?? emptyState(cfg),
            retention: session.retention, externalRetention: session.externalRetention,
            odpContext: session.odpContext, odpSeed: session.odpSeed ?? [], odpSeedAt: session.odpSeedAt ?? 0,
            odpRecentEvents: session.odpRecentEvents ?? [], lastSeen: session.metadata.lastSeen, configVersion: cfg.version };
          const pipeline: PipelineRecord = { attributes: session.attributes, segments: session.segments,
            journeyStage: session.metadata.journeyStage ?? PERSISTED_STAGE[FIRST_JOURNEY_STAGE], sessionId: grant.sessionId, visitorId: session.userId,
            firstSeen: session.metadata.firstSeen, sessionCount: session.metadata.sessionCount, visitCount: session.metadata.visitCount,
            lastVisitAt: session.metadata.lastVisitAt, entryChannel: session.metadata.entryChannel,
            surface: resolveSurface({ surface: session.surface }), profileEnrichment: session.profileEnrichment };
          const audienceOwner = { tenant: grant.tenant, subject: grant.subject, sessionId: grant.sessionId };
          requireConsentPurpose(consent, 'tracking');
          try { await this.state.storage.put({ [keyFor(key)]: record, affinity, pipeline, audienceOwner }); }
          catch (error) { this.invalidateMirrors(); throw error; }
          this.affinity = affinity; this.pipeline = pipeline; this.consent = consent; this.audienceOwner = audienceOwner; this.loaded = true;
        } else await this.state.storage.put(keyFor(key), record);
        await publish(key, record);
        if (record.expires !== null) {
          const alarm = await this.state.storage.getAlarm();
          if (alarm === null || alarm > record.expires) await this.state.storage.setAlarm(record.expires);
        }
      }),
      delete: key => this.orderProjection(async () => {
        check();
        const record: Projection = { value: null, expires: null, pending: true };
        await this.state.storage.put(keyFor(key), record); await publish(key, record);
      }),
      list: async options => {
        check();
        await this.projectionChain;
        check();
        if (options?.cursor) throw new SessionAccessError();
        const stored = await this.state.storage.list<Projection>({ prefix: keyFor(options?.prefix ?? ''), limit: options?.limit ?? 1000 });
        check();
        for (const entry of stored.values()) {
          if (!entry || (entry.value !== null && typeof entry.value !== 'string')
            || (entry.expires !== null && (!Number.isSafeInteger(entry.expires) || entry.expires < 0))
            || (Object.hasOwn(entry, 'metadata') && entry.metadata === undefined)) throw new SessionAccessError();
        }
        return { keys: [...stored].filter(([, entry]) => entry.value !== null && (entry.expires === null || entry.expires > Date.now()))
          .map(([key, entry]) => ({ name: key.slice('sessionProjection:'.length),
            ...(entry.expires === null ? {} : { expiration: Math.floor(entry.expires / 1000) }),
            ...(entry.metadata === undefined ? {} : { metadata: entry.metadata }) })), list_complete: true };
      },
    };
  }

  private orderProjection(work: () => Promise<void>): Promise<void> {
    recheckOwnerInvocation(this);
    const result = this.projectionChain.then(work, work);
    this.projectionChain = result.then(() => undefined, () => undefined);
    return result;
  }

  private async scheduleProjectionAlarm(at: number): Promise<void> {
    const records = await this.state.storage.list<{ value: string | null; expires: number | null }>({ prefix: 'sessionProjection:' });
    const expiry = Math.min(...[...records.values()].filter(row => row.value !== null && row.expires !== null).map(row => row.expires!));
    const imports = await this.state.storage.list<{ expires: number; result?: unknown; published?: boolean }>({ prefix: 'identityImport:' });
    const now = Date.now();
    const receiptExpiry = Math.min(...[...imports.values()].filter(row => row.expires > now
      || !(Object.hasOwn(row, 'result') && row.published !== true)).map(row => row.expires));
    const members = await this.state.storage.get<ShopperRecord>('identityMembers');
    const identityExpiry = members?.retention ? readRetention(members.retention, members.retention.tenant, 'identity').expiresAt : Infinity;
    const profileExpiry = this.affinity?.retention?.expiresAt ?? Infinity;
    await this.scheduleConsentAlarm();
    const existing = await this.state.storage.getAlarm();
    const copyExpiry = await this.behaviorCopyDeadline();
    const next = Math.min(at, expiry, receiptExpiry, identityExpiry, profileExpiry, copyExpiry, existing ?? Infinity);
    if (Number.isFinite(next)) await this.state.storage.setAlarm(next);
  }

  /** Remove only expired provider copies. No behavioral tick, profile renewal,
   * identity adoption or security reset occurs in this cleanup. */
  private async pruneExternalCopies(now: number): Promise<void> {
    const prune = <T extends { externalRetention?: ExternalRetention; odpSeed?: string[]; odpContext?: string; odpSeedAt?: number; odpRecentEvents?: Array<Record<string, unknown>>; segments?: string[] }>(value: T, tenant: string): T | null => {
      const stamps = { ...value.externalRetention }; let changed = false, odp = false;
      for (const [category, raw] of Object.entries(stamps)) {
        const stamp = readRetention(raw, tenant, category as RetentionStamp['category']);
        if (stamp.expiresAt <= now) { delete stamps[category as RetentionStamp['category']]; changed = true; odp ||= category.startsWith('external.odp.'); }
      }
      if (!changed) return null;
      return { ...value, externalRetention: stamps, ...(odp ? { odpContext: '', odpSeed: [], odpSeedAt: 0, odpRecentEvents: [],
        ...(value.segments ? { segments: value.segments.filter(segment => !value.odpSeed?.includes(segment)) } : {}) } : {}) };
    };
    let affinity: AffinityRecord | null = null;
    if (this.affinity?.externalRetention) {
      const tenant = this.affinity.retention?.tenant;
      if (!tenant || !this.isActualObject(tenant, this.affinity.shopperId)) throw new SessionAccessError();
      affinity = prune(this.affinity, tenant);
    }
    const updates: Array<{ key: string; record: { value: string; expires: number | null; pending: boolean; metadata?: unknown; retentionReplace: { digest: string; epoch: string } } }> = [];
    const authority = await this.grantAuthority();
    for (const [key, record] of await this.state.storage.list<{ value: string | null; expires: number | null; pending: boolean; metadata?: unknown }>({ prefix: 'sessionProjection:' })) {
      if (!record.value || record.expires !== null && record.expires <= now || !/(?:^|:)session:[^:]+$/.test(key)) continue;
      const physical = key.slice('sessionProjection:'.length), session = sessionDataSchema.parse(JSON.parse(record.value));
      if (!session.externalRetention || !Object.keys(session.externalRetention).length) continue;
      const tenant = session.retention?.tenant;
      if (!tenant || !authority || !this.isActualObject(tenant, session.userId)
        || !physical.startsWith(tenantKey(tenant, 'session:'))) throw new SessionAccessError();
      const next = prune(session, tenant); if (!next) continue;
      // W16 C5.09 (R85(b)): pruning a destination copy removes a seed, and the
      // one derivation reads no segment, so it moves no stage.
      if (record.pending) await this.sessionProjectionStore().get(physical);
      const raw = await this.rawEnv.SESSIONS.get(physical);
      if (raw !== record.value) throw new SessionAccessError();
      updates.push({ key, record: { ...record, value: JSON.stringify(next), pending: true,
        retentionReplace: { epoch: authority.epoch, digest: await identityDigest(record.value) } } });
    }
    if (affinity && this.affinity) {
      const segments = this.pipeline ? projectedOdpSegments(this.pipeline.segments, this.affinity, affinity) : [];
      // W16 C5.09 (R85(b)): same — a pruned seed moves no stage under the one
      // derivation, which counts only what she did in this visit.
      const pipeline = this.pipeline ? { ...this.pipeline, segments } : null;
      await this.state.storage.put({ affinity, pipeline }); this.affinity = affinity; this.pipeline = pipeline;
    }
    for (const update of updates) {
      await this.state.storage.put(update.key, update.record);
      await this.sessionProjectionStore().get(update.key.slice('sessionProjection:'.length));
    }
  }

  private copiedRetention(value: { retention?: RetentionStamp; externalRetention?: ExternalRetention; dependencies?: RetentionStamp[] }, tenant: string): RetentionStamp[] {
    return [ ...(value.retention ? [readRetention(value.retention, tenant, 'profile')] : []),
      ...Object.entries(value.externalRetention ?? {}).map(([category, stamp]) => {
        if (!category.startsWith('external.')) throw new SessionAccessError();
        return readRetention(stamp, tenant, category as RetentionStamp['category']);
      }), ...(value.dependencies ?? []).map(stamp => readRetention(stamp, tenant, 'identity')) ];
  }

  private async behaviorCopyDeadline(): Promise<number> {
    const values: RetentionStamp[] = [];
    if (this.affinity?.externalRetention) {
      const tenant = this.affinity.retention?.tenant;
      if (!tenant || !this.isActualObject(tenant, this.affinity.shopperId)) throw new SessionAccessError();
      for (const [category, stamp] of Object.entries(this.affinity.externalRetention)) values.push(readRetention(stamp, tenant, category as RetentionStamp['category']));
    }
    const transfer = await this.transferState();
    if (transfer?.status === 'complete' && !transfer.scrubbed && transfer.transfer.affinity?.retention) values.push(...this.copiedRetention(transfer.transfer.affinity, transfer.transfer.tenant));
    for (const value of (await this.state.storage.list<Record<string, any>>({ prefix: 'identityReceipt:' })).values()) if (!value.scrubbed && value.retention) {
      const receipt = transferReceiptSchema.parse(value);
      if (!this.isActualObject(receipt.transfer.tenant, receipt.transfer.shopperId)) throw new SessionAccessError();
      values.push(...this.copiedRetention(value, receipt.transfer.tenant));
    }
    for (const value of (await this.state.storage.list<Record<string, any>>({ prefix: 'identityImport:' })).values()) if (value.published && !value.scrubbed && value.retention) {
      if (!value.owner || !this.isActualObject(value.owner.tenant, value.owner.subject)) throw new SessionAccessError();
      values.push(...this.copiedRetention(value, value.owner.tenant));
    }
    for (const value of (await this.state.storage.list<Record<string, any>>({ prefix: 'externalAdmission:' })).values()) if (!value.expired) {
      if (!this.isActualObject(value.tenant, value.subject)) throw new SessionAccessError();
      for (const [category, stamp] of Object.entries(value.stamps ?? {})) values.push(readRetention(stamp, value.tenant, category as RetentionStamp['category']));
    }
    return Math.min(...values.map(stamp => readRetention(stamp, stamp.tenant, stamp.category).expiresAt));
  }

  private async pruneBehaviorCopies(now: number): Promise<void> {
    const transfer = await this.transferState();
    if (transfer?.status === 'complete' && !transfer.scrubbed && transfer.transfer.affinity?.retention
      && this.copiedRetention(transfer.transfer.affinity, transfer.transfer.tenant).some(stamp => stamp.expiresAt <= now)) {
      await this.state.storage.put('identityTransfer', { ...transfer, scrubbed: true, transfer: { ...transfer.transfer, affinity: null, pipeline: null } });
    }
    for (const prefix of ['identityReceipt:', 'identityImport:']) for (const [key, value] of await this.state.storage.list<Record<string, any>>({ prefix })) {
      if (value.scrubbed || !value.retention || (prefix === 'identityImport:' && !value.published)) continue;
      const identity = prefix === 'identityReceipt:' ? transferReceiptSchema.parse(value).transfer : value.owner;
      const tenant = identity?.tenant, subject = prefix === 'identityReceipt:' ? identity?.shopperId : identity?.subject;
      if (!this.isActualObject(tenant, subject)) throw new SessionAccessError();
      if (!this.copiedRetention(value, tenant).some(stamp => stamp.expiresAt <= now)) continue;
      // Only optional completed response material is discarded. Epoch, payload
      // commitment, grant/registration witnesses and unfinished recovery survive.
      const result = { ...value.result, audiences: [], cookieHeaders: [], changes: { entered: [], exited: [], explain: [] } };
      delete result.data;
      const next: Record<string, unknown> = { ...value, result, scrubbed: true }; delete next.retention;
      delete next.externalRetention; delete next.dependencies;
      await this.state.storage.put(key, next);
    }
    for (const [key, raw] of await this.state.storage.list<Record<string, any>>({ prefix: 'externalAdmission:' })) {
      if (!/^[a-f0-9]{64}$/.test(key.slice('externalAdmission:'.length)) || !/^[a-f0-9]{64}$/.test(raw.digest) || typeof raw.expired !== 'boolean') throw new SessionAccessError();
      if (raw.expired) continue;
      if (!this.isActualObject(raw.tenant, raw.subject)) throw new SessionAccessError();
      const stamps = { ...raw.stamps } as ExternalRetention;
      for (const [category, stamp] of Object.entries(stamps)) if (readRetention(stamp, raw.tenant, category as RetentionStamp['category']).expiresAt <= now) delete stamps[category as RetentionStamp['category']];
      // The digest-only terminal commitment prevents re-birth after alarm and
      // restart. No event payload, subject copy or expired policy is retained.
      await this.state.storage.put(key, Object.keys(stamps).length ? { digest: raw.digest, expired: false, tenant: raw.tenant, subject: raw.subject, stamps } : { digest: raw.digest, expired: true });
    }
    const next = await this.behaviorCopyDeadline();
    if (Number.isFinite(next)) { const alarm = await this.state.storage.getAlarm(); if (alarm === null || alarm > next) await this.state.storage.setAlarm(next); }
  }

  private async publishCurrentSession(context: InternalContext, expires = Date.now() + SESSION_TTL_SECONDS * 1000): Promise<void> {
    if ((this.env.REFLEX_HOST ?? 'session') !== 'session' || !this.affinity || !this.pipeline) return;
    const pipe = this.pipeline, affinity = this.affinity, consent = await this.consentNow();
    const retention = pinProfileRetention(this.env, affinity, context.tenant);
    expires = Math.min(expires, retention.expiresAt);
    const key = tenantKey(context.tenant, 'session:' + pipe.sessionId);
    const previous = await this.state.storage.get<{ value: string | null; expires: number | null }>('sessionProjection:' + key);
    const original = previous?.value ? sessionDataSchema.parse(JSON.parse(previous.value)) : undefined;
    if (original && (original.userId !== context.subject || original.forwardTo !== undefined)) throw new SessionAccessError();
    const value: SessionData = { ...original, retention: affinity.retention, externalRetention: affinity.externalRetention, userId: context.subject, segments: pipe.segments, attributes: pipe.attributes,
      surface: pipe.surface, reflex: affinity.reflex, profileEnrichment: pipe.profileEnrichment,
      odpContext: affinity.odpContext, odpSeed: affinity.odpSeed, odpSeedAt: affinity.odpSeedAt, odpRecentEvents: affinity.odpRecentEvents,
      ...(isShopperId(context.subject) ? { identity: original?.identity ?? { shopperId: context.subject, linkedAt: pipe.firstSeen } } : {}),
      metadata: { ...original?.metadata, firstSeen: pipe.firstSeen, lastSeen: affinity.lastSeen, sessionCount: pipe.sessionCount,
        visitCount: pipe.visitCount, lastVisitAt: pipe.lastVisitAt, entryChannel: pipe.entryChannel,
        engagementScore: calculateEngagementScore(pipe.attributes), journeyStage: pipe.journeyStage,
        lastSegmentUpdate: original?.metadata.lastSegmentUpdate ?? affinity.lastSeen },
      preferences: { trackingConsent: consent.tracking, personalizationEnabled: consent.personalization,
        cookieConsent: original?.preferences.cookieConsent ?? true } };
    const store = this.sessionProjectionStore(context);
    // Recovery must not extend an already established compatibility lifetime.
    const expiration = Math.floor((previous?.expires === null || previous?.expires === undefined ? expires : Math.min(previous.expires, expires)) / 1000);
    if (expiration * 1000 <= Date.now()) throw new SessionAccessError();
    await store.put(key, JSON.stringify(value), { expiration });
    await store.put(tenantKey(context.tenant, 'user:' + context.subject), pipe.sessionId, { expiration });
  }

  private async importSessionData(context: InternalContext): Promise<SessionData | undefined> {
    if ((this.env.REFLEX_HOST ?? 'session') !== 'session' || !this.pipeline) return undefined;
    const value = await this.sessionProjectionStore(context).get(tenantKey(context.tenant, 'session:' + this.pipeline.sessionId));
    return typeof value === 'string' ? withConsent(sessionDataSchema.parse(JSON.parse(value)), await this.consentNow()) : undefined;
  }

  private async completeImportProjection(key: string, context: InternalContext): Promise<Response> {
    const saved = await this.state.storage.get<{ epoch: string | null; result: Record<string, unknown>; history: boolean; expires: number; published: boolean; scrubbed?: boolean; retention?: RetentionStamp; externalRetention?: ExternalRetention; dependencies?: RetentionStamp[] }>(key);
    if (!saved?.result || saved.scrubbed || saved.epoch !== ((await this.grantAuthority())?.epoch ?? null) || saved.expires <= Date.now()) throw new SessionAccessError();
    pinRetention(this.env, saved.retention, context.tenant, 'profile');
    for (const [category, stamp] of Object.entries(saved.externalRetention ?? {})) pinRetention(this.env, stamp, context.tenant, category as RetentionStamp['category']);
    for (const stamp of saved.dependencies ?? []) pinRetention(this.env, stamp, context.tenant, 'identity');
    requireConsentPurpose(await this.consentNow(), 'personalization');
    await this.load(); this.assertInternalState(context);
    pinProfileRetention(this.env, this.affinity, context.tenant);
    if (saved.result.applied === 0) return json(saved.result);
    if (!saved.published) {
      await this.publishImportProjection(context, saved.history, saved.expires);
      await this.state.storage.put(key, { ...saved, published: true });
    }
    await this.scheduleProjectionAlarm(saved.expires);
    return json({ ...saved.result, sessionId: this.pipeline?.sessionId, data: await this.importSessionData(context) });
  }

  private async publishImportProjection(context: InternalContext, history: boolean, expires: number): Promise<void> {
    await this.publishCurrentSession(context, expires);
    if (history) {
      const members = membersSchema.parse(await this.state.storage.get('identityMembers'));
      if (members.shopperId !== context.subject) throw new SessionAccessError();
      const retention = pinRetention(this.env, members.retention, context.tenant, 'identity');
      await (this.env.SESSIONS as unknown as KVLike).put(tenantKey(context.tenant, 'identity:shopper:' + context.subject),
        JSON.stringify(members), { expiration: Math.floor(retention.expiresAt / 1000) });
    }
  }
}

function safeAttachment(ws: WebSocket): unknown {
  try {
    return ws.deserializeAttachment();
  } catch {
    return null;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
