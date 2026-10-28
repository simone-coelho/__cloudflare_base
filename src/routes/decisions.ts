// src/routes/decisions.ts
// CW4 — the content decision surface (scope appendix §2.3, API-first delivery).
//
//   GET /v1/:tenant/decisions/snapshot?page=home&visitorId=…[&brand=&channel=]
//
// Returns the delivery contract the customer's front end paints (`decisions`,
// one per slot position, addressed by their own content id) and the ledger
// records the outcome-learning design records (`records`, doc 22 §3.1). Reads
// only; never cached; SDK-key authentication arrives with CW10.

import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { assertShopperSelectors, carryOwnerCustomerId, forwardShopperRequest, parseShopperContext } from '@/identity/sessionAuthority';
import { anonymousWithConsent, type SessionParts } from '@/identity/consentContinuity';
import type { MintTarget } from '@/identity/sessionCapability';
import { armClassOf, defaultArmProbability } from '@/sdk/armDraw';
import { consentFromCookies, intersectConsent, refusalHints } from '@/content/consent';
import type { Env } from '@/types/env';
import { syntheticOperation } from '@/ops/synthetic';
import { contextTableInForce, sealContextKey, serveContentDecisions, type ContextTableInForce } from '@/content/service';
import { requireRetention, type RetentionStamp } from '@/retention';
import { ENTRY_QUERY_LIMIT, validEntry, type ChannelSignals } from '@/services/visit';
import { deviceOf, platformOf } from '@/services/platform';
import { NAMESPACE_MARKER, type TenantVariables } from '@/tenancy/tenant';
import { tenantConfig } from '@/tenancy/middleware';
import { enqueueDecisions } from '@/ledger/enqueue';
import { findById, isLedgerMessage, type R2Like } from '@/ledger/writer';
import { eraseVisitorLedger, hidden, loadTombstones, retentionDays, rewriteTenantErasures, type R2Erasable } from '@/ledger/erasure';
import type { DecisionRecord } from '@/content/types';
import { isCarriedCustomerId, isLearningKey, parseId, type CapturedRecord, type LedgerStream } from '@/ledger/records';
import { validCarrier, DELIVERY_FIELD } from '@/ledger/delivery';
import { readTrend, regionKeyOf, rollupTenant } from '@/reflex/regionTrend';
import { liftArchiveKey, liftKey, liftRepublishedKey, liftStaleKey, notAdoptedRefusalIn, notAdoptedRefusalOf, placementSlot, republishedIn, republishedRecordOf, republishedRefusalIn, republishedRefusalOf, ringName, staleMarkerIn, staleMarkerOf, staleRefusalIn, staleRefusalOf, statsName } from '@/learn/fan';
import { decideProposal, PROPOSALS_KIND, runCycle, type ProposalsDoc } from '@/learn/cycle';
import { readMonitor, runMonitor } from '@/ops/monitor';
import type { DocumentKind } from '@/config/versionedStore';
import { catalogPartPointer, pinPublication, readCatalogPart, readPinnedPublication, publicationMeta, PublicationError, publish, type PublicationPin } from '@/config/publication';
import { replayDecision } from '@/learn/replay';
import { conflictKey, exportReconciliation, readReportView, reportPayloadJson, reportPriors, REPORT_MAX_OBJECTS, REPORT_LIMITS, ReportBudgetExceeded, ReportInputError, ReportRowConflict, ReportUnavailableError, ReportRevisionChanged, validateReportPolicies, type ReportPolicy, type ReportPriors } from '@/learn/report';
import { PRIORS_KIND } from '@/learn/priors';
import { captureReadConflict, readConflictFiled } from '@/ledger/quarantine';
/** W22 D1.03: conflicts one read may file before it answers with the last of them. */
const REPORT_CONFLICTS = 8;
import { ReportTooLarge, runDayReport } from '@/learn/hourly';
import { datesBetween, WindowRangeError, windowReport } from '@/measure/window';
import { catalogParted, LEARN_KIND, CONTENT_KIND, isCatalogueName, SLOTS_KIND, slotPagesOf } from '@/content/kinds';
import { catalogNames, decodeCursor, encodeCursor, exploringRows, namedRows, NO_NAMES, pageOf, pageRows, rowsOf, slotEvidence, slotsIndex, toEvidenceFloorOf, DEFAULT_LIMIT, MAX_LIMIT, SORT_KEYS, type RowLevel, type SlotIndexEntry, type SortKey } from '@/learn/rows';
import { evidenceFloorOf } from '@/content/decide';
import { receiptOf } from '@/learn/receipts';
import { emptySlotGovernance, observeSlotGovernance, SLOT_GOVERNANCE_SCOPE, type SlotGovernance, type SlotGovernanceScope } from '@/learn/slotGovernance';
import { queueOf } from '@/learn/queue';
import { DEFAULT_EXPLORE, effectiveExploration } from '@/learn/explore';
import type { ContentCatalog, EnrollmentProvenance, SlotCatalog } from '@/content/types';
import type { LiftSnapshot, Republished, StaleMarker } from '@/learn/stats';
import { invalidateLiftCache } from '@/content/service';
import { armFor, readArmDraw, readEnrollmentHealth, recordArmDraw, type ArmDrawReason } from '@/content/holdout';
import type { LearnConfig } from '@/content/types';
import { referenceScore, type ExternalRequest } from '@/learn/external';
import type { AuthContext } from '@/middleware/auth';
import { hasOperatorGrant, operatorJwt } from '@/middleware/operatorAuth';
import { operatorWrites } from '@/middleware/edgeAccess';
import { boundedShopperBody, requireShopper, shopperPrincipal, shopperTenant, capabilityToken, verifySessionCapability, SessionAccessError, SHOPPER_HEADER } from '@/identity/sessionCapability';
import { auditedLearningRecovery, auditedSubjectRead, auditedSubjectOperation } from '@/auth/subjectAudit';
import { storeFor } from '@/auth/accounts';

export const decisionRoutes = new Hono<{ Bindings: Env; Variables: TenantVariables & { auth: AuthContext } }>();

// Each administrative request pins one uncached coherent set for all readers.
const requestPins = new WeakMap<object, Promise<PublicationPin>>();
async function readConfig<T>(c: { env: Env }, kind: DocumentKind<T>, tenant: string): Promise<T> {
  let pin = requestPins.get(c);
  if (!pin) { pin = pinPublication(c.env, tenant); requestPins.set(c, pin); }
  return (await readPinnedPublication(c.env, kind, tenant, await pin)).value;
}
/**
 * The tenant's proposal list for a work queue, where a tenant that has never
 * run a learning cycle has published no proposals document at all.
 *
 * Absence and unreadability are kept apart, which is the whole point: the
 * publication SET is still read and still authoritative, and only the set's own
 * statement that this member does not exist answers "no proposals". A storage
 * or authority failure still refuses, exactly as it did.
 */
async function publishedProposals(c: { env: Env }, tenant: string): Promise<ProposalsDoc> {
  let pin = requestPins.get(c);
  if (!pin) { pin = pinPublication(c.env, tenant); requestPins.set(c, pin); }
  const set = await pin;
  const published = Object.values(set.refs).some(ref => ref.kind === PROPOSALS_KIND.name && ref.scope === tenant);
  return published ? readConfig<ProposalsDoc>(c, PROPOSALS_KIND, tenant) : { proposals: [] };
}
/**
 * W25 R4 (LANE-LOG R183): the tenant's published prior document, from the same
 * pin as the learn document the report is built under, as the priors input of
 * the day report (`reportPriors`). Absence and unreadability are kept apart the
 * way `publishedProposals` keeps them: only the set's own statement that the
 * tenant publishes no prior document answers "no priors", and the report then
 * builds its grids prior-free and declares `applied: false`. A storage or
 * authority failure refuses the build, exactly as the learn read beside it does,
 * so no report is ever built prior-free because a read failed.
 */
async function publishedReportPriors(c: { env: Env }, tenant: string, learn: LearnConfig): Promise<ReportPriors | null> {
  let pin = requestPins.get(c);
  if (!pin) { pin = pinPublication(c.env, tenant); requestPins.set(c, pin); }
  const set = await pin;
  if (!Object.values(set.refs).some(ref => ref.kind === PRIORS_KIND.name && ref.scope === tenant)) return null;
  const revision = await readPinnedPublication(c.env, PRIORS_KIND, tenant, set);
  return reportPriors(revision.value, revision.revision, learn);
}
/**
 * W26 R2 (F21 §6(b), §8; LANE-LOG R198): the tenant's catalogue as the learning
 * identity reads it — the pages each slot name is carried on — from the same
 * request pin as every other document the route reads. A tenant whose
 * publication carries no catalogue has none, and every name is page-less.
 */
async function publishedSlotPages(c: { env: Env }, tenant: string): Promise<Map<string, string[]>> {
  let pin = requestPins.get(c);
  if (!pin) { pin = pinPublication(c.env, tenant); requestPins.set(c, pin); }
  const set = await pin;
  if (!Object.values(set.refs).some(ref => ref.kind === SLOTS_KIND.name && ref.scope === tenant)) return new Map();
  return slotPagesOf(await readConfig<SlotCatalog>(c, SLOTS_KIND, tenant));
}
/**
 * W26 R2: the placement an operator request addresses. `page` is the decision
 * request's own member name. For a slot name the catalogue carries on more than
 * one page it is REQUIRED and must be one of those pages, because each page's
 * placement is its own statistics object and there is no pooled one to answer
 * with; the refusal names the pages. For any other name the identity is the
 * page-less one it has always had, and a page, when named, must be the page
 * the catalogue carries the slot on.
 */
type Placement = { ok: true; page?: string } | { ok: false; error: string; pages?: string[] };
/**
 * W26 R2 (review D3): every route that names one slot's statistics takes a
 * CATALOGUE slot name — a slug, never carrying the `@` of a page-scoped
 * placement's object name — so no operator can address a placement except by
 * its slot and its `page`, or create an object under another placement's name.
 */
const SLOT_REQUIRED = 'slot required: a slot name of the catalogue';
function placementOf(pages: ReadonlyMap<string, string[]>, slot: string, asked: string | undefined): Placement {
  const page = asked?.trim() || undefined;
  if (page !== undefined && !isCatalogueName(page)) return { ok: false, error: 'page must be a page name of the catalogue' };
  const on = pages.get(slot) ?? [];
  if (on.length > 1) {
    if (page === undefined || !on.includes(page)) return { ok: false, error: `slot '${slot}' is on more than one page (${on.join(', ')}), and each page's placement learns apart; name one with page=`, pages: on };
    return { ok: true, page };
  }
  if (page !== undefined && on.length === 1 && on[0] !== page) return { ok: false, error: `slot '${slot}' is not on page '${page}'`, pages: on };
  return { ok: true };
}
const placementRefusal = (placement: Extract<Placement, { ok: false }>) => ({ ok: false, error: placement.error, ...(placement.pages ? { pages: placement.pages } : {}) });

/**
 * P11 (decision D1): the page a placement is on — the page `page=` names for a
 * slot the catalogue carries on more than one page, else the one page it
 * carries the slot on — or undefined where the slot is on no page.
 */
function placementPageOf(pages: ReadonlyMap<string, string[]>, slot: string, page: string | undefined): string | undefined {
  const on = pages.get(slot) ?? [];
  return page ?? (on.length === 1 ? on[0] : undefined);
}
/**
 * P11 (decision D1): the configured evidence floor of that page, `{ floor, page }`
 * (keys sorted), or null where it publishes none or there is no page; an answer
 * then carries no floor member at all.
 */
function placementEvidenceFloor(learn: Pick<LearnConfig, 'evidenceFloors'> | null, at: string | undefined): { floor: number; page: string } | null {
  const floor = learn && at !== undefined ? evidenceFloorOf(learn, at) : null;
  return floor === null || at === undefined ? null : { floor, page: at };
}
/**
 * P11: the tenant's learn document from the request's own pin, for a route that
 * reads no other member of it, or null where the sealed set itself says the
 * tenant publishes none (absence and unreadability kept apart, as
 * `publishedProposals` keeps them: a listed document that cannot be read
 * refuses exactly as every other read of it does).
 */
async function publishedLearn(c: { env: Env }, tenant: string): Promise<LearnConfig | null> {
  let pin = requestPins.get(c);
  if (!pin) { pin = pinPublication(c.env, tenant); requestPins.set(c, pin); }
  const set = await pin;
  if (!Object.values(set.refs).some(ref => ref.kind === LEARN_KIND.name && ref.scope === tenant)) return null;
  return readConfig<LearnConfig>(c, LEARN_KIND, tenant);
}

/**
 * The decisions an outcome credits, with the provenance each of them was
 * DECIDED under. Only the outcome's own explicit reference is followed: a
 * record that names no decision is not searched for one, because guessing which
 * decision an outcome credits is the reporting policy's job and not the
 * export's. Bounded by that one lookup, and any failure to read it leaves the
 * list empty rather than refusing the export.
 */
async function creditedDecisionProvenance(c: { env: Env }, tenant: string, outcome: CapturedRecord): Promise<Array<{ decision_id: string; experiment?: EnrollmentProvenance }>> {
  const reference = (outcome as { decision_id?: unknown }).decision_id;
  if (typeof reference !== 'string' || !reference || !validLedgerSelector(tenant, reference)) return [];
  try {
    const decision = await findById<DecisionRecord>(c.env.STORAGE as unknown as R2Like, reference, 'decision');
    if (!decision || decision.record.tenant !== tenant || decision.record.visitor_id !== outcome.visitor_id) return [];
    return [{ decision_id: reference, ...(decision.record.experiment ? { experiment: decision.record.experiment } : {}) }];
  } catch { return []; }
}
const TENANT = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
/**
 * W20 G2 (R89(a), R94(4)): how many refused pins the served snapshot names, at
 * most. The same sample bound the advisory pin channel already publishes
 * (`src/content/slotDiagnostics.ts`), so both answers bound one operator-authored
 * list the same way and the totals beside the sample say what was left out.
 */
const RUNTIME_PIN_SAMPLE = 50;
const HISTORY_VISITOR = /^[A-Za-z0-9_.-]{1,200}$/;
const HISTORY_UNAVAILABLE = 'Visitor history unavailable';
/**
 * W29 U1.01: what this deployment can do with a stored proposal. Autonomy
 * mutation is withdrawn for every tenant — `POST learn/cycle` and
 * `POST learn/proposals/:id/:decision` answer 503 below without reading or
 * writing anything — and the retained statuses were never verified as applied.
 * Any answer that reports proposal work carries these two facts beside it, so a
 * count is never read as an action a person can take today. Stamped, not derived
 * from configuration, because no configuration a tenant can set makes the
 * mutation available: the routes below refuse unconditionally (F24 §5, document
 * 35 §5 W29). It is stated here, once, beside the constants the same routes
 * share, and every answer reads it (W29 R3, LANE-LOG R176): the work queue
 * carries it whole as `autonomy`, and the `GET learn/proposals` history takes
 * its `mutationAvailable` and its `verified` from these two members, so the two
 * answers cannot part.
 */
const AUTONOMY_WITHDRAWN = { mutationAvailable: false, proposalStatusesVerified: false } as const;

function validLedgerSelector(tenant: string, id: string): boolean {
  const carrier = parseId(id);
  return !!carrier && carrier.tenant === tenant && isLedgerMessage({ kind: 'ledger', type: 'decision',
    record: { decision_id: id, tenant, visitor_id: id.split(':')[2], ts: carrier.ts } });
}
function ownedLedgerRecord(record: CapturedRecord, tenant: string, id: string, stream: LedgerStream): boolean {
  return validCarrier(record as unknown as Record<string, unknown>, stream) && record.tenant === tenant
    && ('outcome_id' in record ? record.outcome_id : 'decision_id' in record ? record.decision_id : record.record_id) === id;
}

/** The object's current projection owns cutoff filtering; a failed read is not an empty ring. */
type RecentHistory = { ok: true; ring: DecisionRecord[]; index: number; retentionWitness: RetentionStamp | null };
function assertRecent(env: Env, tenant: string, value: RecentHistory): void {
  if (value.ring.length || value.index) requireRetention(env, value.retentionWitness, tenant, 'online');
  for (const row of value.ring) requireRetention(env, row.retention?.online, tenant, 'online');
}
async function operatorRecent(env: Env, tenant: string, visitorId: string): Promise<RecentHistory> {
  const ns = env.DECISION_RING;
  if (!ns) throw new Error(HISTORY_UNAVAILABLE);
  const response = await ns.get(ns.idFromName(ringName(tenant, visitorId))).fetch('https://learn/recent');
  if (!response.ok) throw new Error(HISTORY_UNAVAILABLE);
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(HISTORY_UNAVAILABLE);
  const value = body as { ok?: unknown; ring?: unknown; index?: unknown };
  if (value.ok !== true || !Array.isArray(value.ring) || !Number.isSafeInteger(value.index) || (value.index as number) < 0
    || !value.ring.every(record => isLedgerMessage({ kind: 'ledger', type: 'decision', record })
      && record.tenant === tenant && record.visitor_id === visitorId)) throw new Error(HISTORY_UNAVAILABLE);
  const result: RecentHistory = { ok: true, ring: value.ring as DecisionRecord[], index: value.index as number,
    retentionWitness: response.headers.get('X-Retention-Witness') === null ? null : JSON.parse(response.headers.get('X-Retention-Witness')!) as RetentionStamp };
  assertRecent(env, tenant, result); return result;
}

/**
 * W37 T5 (decision D2): the decision history the per-shopper export answers for
 * the ids of one person at one tenant — for each id their receipts, exactly as
 * `GET visitors/{id}/receipts` answers them (every one, not one page), the
 * entries of their own ring as `GET visitors/{id}/recent` answers them, and each
 * receipted decision's ledger record as `GET ledger/{id}` answers it. It writes
 * no per-read audit: the export's own subject-operation audit covers it. A ring
 * that cannot be read, or a record whose retention authority is no longer
 * honoured, refuses the export rather than leaving their history out; an erased
 * record is never answered.
 */
export async function subjectDecisionHistory(c: { env: Env }, tenant: string, ids: readonly string[]): Promise<{
  receipts: Record<string, ReturnType<typeof receiptOf>[]>; recent: Record<string, DecisionRecord[]>; records: Record<string, Record<string, unknown>>;
}> {
  const receipts: Record<string, ReturnType<typeof receiptOf>[]> = {}, recent: Record<string, DecisionRecord[]> = {};
  const records: Record<string, Record<string, unknown>> = {};
  const rings: Array<[string, DecisionRecord[]]> = [];
  for (const id of ids) {
    if (!HISTORY_VISITOR.test(id)) throw new Error(HISTORY_UNAVAILABLE);
    rings.push([id, (await operatorRecent(c.env, tenant, id)).ring]);
  }
  if (!rings.some(([, ring]) => ring.length)) return { receipts, recent, records };
  const catalog = await readConfig<ContentCatalog>(c, CONTENT_KIND, tenant);
  const tombs = await loadTombstones(c.env.STORAGE as unknown as R2Erasable, tenant);
  for (const [id, ring] of rings) {
    recent[id] = ring;
    const ordered = ring.slice().sort((a, b) => b.ts - a.ts || a.position - b.position);
    const names = catalogNames(catalog, ordered.map(r => r.item_id));
    receipts[id] = ordered.map(r => receiptOf(r, names));
    for (const decision of ordered) {
      const recordId = decision.decision_id;
      if (Object.hasOwn(records, recordId) || !validLedgerSelector(tenant, recordId)) continue;
      const found = await findById<CapturedRecord>(c.env.STORAGE as unknown as R2Like, recordId, 'decision');
      if (!found) continue;
      if (!ownedLedgerRecord(found.record, tenant, recordId, 'decision')) throw new Error(HISTORY_UNAVAILABLE);
      if (hidden(tombs, found.record)) continue;
      requireRetention(c.env, found.record.retention?.ledger, tenant, 'ledger');
      records[recordId] = Object.fromEntries(Object.entries(found.record).filter(([key]) => key !== DELIVERY_FIELD));
    }
  }
  return { receipts, recent, records };
}

/** W37 T5: the ledger objects one export call may open, and the stored bytes it may read. */
export const SUBJECT_EXPORT_LIMITS = { objects: REPORT_LIMITS.objects, bytes: 16 * 1024 * 1024 } as const;
const EXPORT_STREAMS: readonly LedgerStream[] = ['decision', 'outcome', 'product-sort', 'behavior'];

/**
 * W37 T5: where a subject's ledger scan resumes. `key: null` is the partition's
 * start. With `line: null` the object `key` has been read whole and the scan
 * continues after it; with `line: n` the scan resumes inside the object `key`
 * at its row n (rows are its non-empty lines, in order).
 */
export interface LedgerScanPosition { key: string | null; line: number | null }

/**
 * W37 T5 (decision D2): every row the tenant's ledger partition holds for the shopper,
 * per stream, as stored — the R2 partition "is the export" (doc 22 §12.4), and
 * a row names its person or browser in `visitor_id`. The partition has no
 * per-shopper index, so the whole of the tenant's partition is read, oldest key
 * first, and nothing of any other tenant (its keys start with `{tenant}/`).
 * Whether a row's person or browser is the shopper's is decided by `owns`, again by
 * every call; `owns` answers `null` when the call may decide no more, and the
 * scan then stops at that row. One call also opens at most
 * `SUBJECT_EXPORT_LIMITS` of the partition. `next` is where the same export
 * continues. A row an erasure hides is never answered.
 */
export async function subjectLedgerRows(env: Env, tenant: string, owns: (visitorId: string) => Promise<boolean | null>,
  from: LedgerScanPosition | null): Promise<{ rows: Record<LedgerStream, Record<string, unknown>[]>; complete: boolean; next: LedgerScanPosition | null }> {
  const prefix = `${tenant}/`;
  if (!TENANT.test(tenant) || (from?.key != null && (!from.key.startsWith(prefix) || from.key.length > 1024))) throw new Error('Ledger export unavailable');
  const tombs = await loadTombstones(env.STORAGE as unknown as R2Erasable, tenant);
  const rows = Object.fromEntries(EXPORT_STREAMS.map(stream => [stream, [] as Record<string, unknown>[]])) as Record<LedgerStream, Record<string, unknown>[]>;
  let opened = 0, bytes = 0;
  /** Reads one object's rows from row `skip`; answers the row at which `owns` stopped the call, or null when the object is read whole. */
  const read = async (key: string, skip: number): Promise<number | null> => {
    const stream = key.split('/')[3] as LedgerStream;
    if (!EXPORT_STREAMS.includes(stream)) return null;
    const object = await env.STORAGE.get(key);
    opened++;
    if (!object) return null;
    const text = await object.text();
    bytes += text.length;
    let index = -1;
    for (const line of text.split('\n')) {
      if (!line) continue;
      index++;
      if (index < skip) continue;
      let row: unknown;
      try { row = JSON.parse(line); } catch { continue; }
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      const value = row as { tenant?: unknown; visitor_id?: unknown; ts?: unknown };
      if ((value.tenant !== undefined && value.tenant !== tenant) || typeof value.visitor_id !== 'string') continue;
      const verdict = await owns(value.visitor_id);
      if (verdict === null) return index;
      if (!verdict) continue;
      if (tombs.has(value.visitor_id) && (typeof value.ts !== 'number' || hidden(tombs, value as { visitor_id: string; ts: number }))) continue;
      rows[stream].push(row as Record<string, unknown>);
    }
    return null;
  };
  let last: string | null = from?.key ?? null;
  if (from?.key != null && from.line !== null) {
    const stopped = await read(from.key, from.line);
    if (stopped !== null) return { rows, complete: false, next: { key: from.key, line: stopped } };
  }
  let cursor: string | undefined;
  const cursors = new Set<string>();
  for (;;) {
    const page = await env.STORAGE.list({ prefix, limit: 1000, ...(cursor ? { cursor } : last ? { startAfter: last } : {}) });
    for (const listed of page.objects) {
      if (!listed.key.startsWith(prefix)) throw new Error('Ledger export unavailable');
      // Keys at or before the position are already read (a listing may not honour startAfter).
      if (last !== null && listed.key <= last) continue;
      const stream = listed.key.split('/')[3] as LedgerStream;
      if (EXPORT_STREAMS.includes(stream) && opened > 0
        && (opened >= SUBJECT_EXPORT_LIMITS.objects || bytes + (listed.size ?? 0) > SUBJECT_EXPORT_LIMITS.bytes)) return { rows, complete: false, next: { key: last, line: null } };
      const stopped = await read(listed.key, 0);
      if (stopped !== null) return { rows, complete: false, next: { key: listed.key, line: stopped } };
      last = listed.key;
    }
    if (!page.truncated) return { rows, complete: true, next: null };
    if (!page.cursor || cursors.has(page.cursor)) throw new Error('Ledger export unavailable');
    cursors.add(page.cursor); cursor = page.cursor;
  }
}

/** Only minimized tenant read-audit rows, never the global account audit. */
decisionRoutes.get('/:tenant/audit', operatorJwt(), async (c) => {
  const tenant = c.req.param('tenant'), auth = c.get('auth');
  if (c.get('tenant') !== tenant || !hasOperatorGrant(c.env, auth?.user?.sub, tenant, auth) || !auth?.user?.roles?.includes('admin')) {
    return c.json({ ok: false, error: 'Tenant audit authority required' }, 403);
  }
  const limitText = c.req.query('limit'), beforeText = c.req.query('before');
  const limit = limitText === undefined ? 50 : Number(limitText), before = beforeText === undefined ? undefined : Number(beforeText);
  if ((limitText !== undefined && !/^[1-9][0-9]*$/.test(limitText)) || !Number.isInteger(limit) || limit < 1 || limit > 100
    || (beforeText !== undefined && (!/^[1-9][0-9]*$/.test(beforeText) || !Number.isSafeInteger(before) || before! < 1))) {
    return c.json({ ok: false, error: 'Invalid audit page' }, 400);
  }
  return auditedSubjectRead(c, tenant, 'audit', undefined, async () => {
    const rows = await storeFor(c.env).subjectAudit(tenant, before, limit), entries = rows.slice(0, limit);
    return c.json({ ok: true, tenant, entries, before: rows.length > limit ? entries.at(-1)!.id : null });
  }, true);
});

/**
 * GET /v1/:tenant/trend[?region=US-NY]
 * The population prior in force for a region: which level answered (region,
 * country, everyone), how much evidence it holds, and the shares themselves.
 * Aggregates only, so it is open. Absent ?region=, the request's own geolocation.
 */
decisionRoutes.get('/:tenant/trend', async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const cf = ((c.req.raw as unknown as { cf?: { country?: string; regionCode?: string } }).cf) ?? null;
  const region = (c.req.query('region') ?? '').trim().toUpperCase() || regionKeyOf(cf);
  const minEvents = Math.max(1, Number(c.req.query('minEvents') ?? 30) || 30);
  const read = await readTrend(c.env, tenant, region, minEvents);
  c.header('Cache-Control', 'no-store');
  if (!read) return c.json({ ok: true, tenant, region, level: null, snapshot: null });
  return c.json({ ok: true, tenant, region, asked: region, level: read.level, answered: read.region, snapshot: read.snapshot });
});

/**
 * W26 R2: the page a paged operator read addresses — the query's `page=`, or the
 * page its cursor was cut for. A cursor cut for one page's table never pages
 * another's: the two naming different pages is refused.
 */
function pagedPlacement(pages: ReadonlyMap<string, string[]>, slot: string, asked: string | undefined, cursor: { p?: string } | null): Placement {
  const query = asked?.trim() || undefined;
  if (cursor?.p !== undefined && query !== undefined && cursor.p !== query) return { ok: false, error: 'the cursor was cut for another page; start the listing again' };
  const placement = placementOf(pages, slot, cursor?.p ?? query);
  if (placement.ok && cursor && (cursor.p ?? undefined) !== placement.page) return { ok: false, error: 'the cursor was cut for another placement; start the listing again' };
  return placement;
}

/**
 * P42 (R-P78, decision D1): the stale marker of a placement whose last publication
 * was refused because another placement's pooled statistics could not be read,
 * while the snapshot in force is still the one it names; null otherwise. A marker
 * that cannot be read, or is not one, is no marker: the read answers as before.
 */
async function staleMarkerFor(c: { env: Env }, tenant: string, brand: string, slot: string, page: string | undefined, inForce: unknown): Promise<StaleMarker | null> {
  try { return staleMarkerIn(staleMarkerOf(await c.env.CACHE.get(liftStaleKey(tenant, brand, slot, page), 'json')), inForce); } catch { return null; }
}

/**
 * P49 (R-P78, decision D1): what a placement's last publication refused after a
 * learn republish names (`republished`), while the snapshot in force is still the
 * one that refusal left in force; null otherwise. A record that cannot be read, or
 * is not one, is none: the read answers as before.
 */
async function republishedFor(c: { env: Env }, tenant: string, brand: string, slot: string, page: string | undefined, inForce: unknown): Promise<Republished | null> {
  try { return republishedIn(republishedRecordOf(await c.env.CACHE.get(liftRepublishedKey(tenant, brand, slot, page), 'json')), inForce); } catch { return null; }
}

/** P42 and P49: the members a lift read carries last, beside the snapshot in force, while they apply. */
async function liftMarksFor(c: { env: Env }, tenant: string, brand: string, slot: string, page: string | undefined, inForce: unknown) {
  const [stale, republished] = await Promise.all([staleMarkerFor(c, tenant, brand, slot, page, inForce), republishedFor(c, tenant, brand, slot, page, inForce)]);
  return { ...(stale ? { stale } : {}), ...(republished ? { republished } : {}) };
}

/**
 * GET /v1/:tenant/lift/rows?slot=&brand=&page=&level=pooled|cells&item=&q=&sort=&dir=&limit=&cursor= (doc 28 §4).
 * The grid as pages: one pooled row per item, or one item's cells; filtered, sorted and cut by the
 * server, with the catalog's names and the merchandiser's controls joined on. The cursor names the
 * snapshot version it was cut from, so a page never straddles two snapshots; when the snapshot has
 * moved on, the answer is 409 and the application starts the listing again. Same access as /lift.
 * W26 R2: `page=` names the placement where the catalogue carries the slot name on more than one
 * page (required there, and carried by the cursor); a slot on one page is read without it.
 * P42: a placement whose snapshot in force is stale (`staleMarkerFor`) also answers `stale`, last.
 * P49: and one whose publications are refused after a learn republish (`republishedFor`), `republished`, last.
 */
decisionRoutes.get('/:tenant/lift/rows', operatorWrites(), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const slot = (c.req.query('slot') ?? '').trim();
  if (!isCatalogueName(slot)) return c.json({ ok: false, error: SLOT_REQUIRED }, 400);
  const brand = (c.req.query('brand') ?? '').trim() || tenant;
  const cur = decodeCursor(c.req.query('cursor'));
  if (c.req.query('cursor') && !cur) return c.json({ ok: false, error: 'cursor not recognised' }, 400);
  const placement = pagedPlacement(await publishedSlotPages(c, tenant), slot, c.req.query('page'), cur);
  c.header('Cache-Control', 'no-store');
  if (!placement.ok) return c.json(placementRefusal(placement), 400);
  const { page } = placement, at = page ? { page } : {};
  const levelQ = c.req.query('level');
  const level: RowLevel = cur ? cur.level : levelQ === 'cells' ? 'cells' : 'pooled';
  const item = cur ? cur.item : ((c.req.query('item') ?? '').trim() || undefined);
  const q = cur ? cur.q : ((c.req.query('q') ?? '').trim() || undefined);
  const sortQ = cur ? cur.sort : (c.req.query('sort') ?? '').trim();
  const sort = sortQ && (SORT_KEYS as readonly string[]).includes(sortQ) ? (sortQ as SortKey) : undefined;
  if (sortQ && !sort) return c.json({ ok: false, error: `sort must be one of ${SORT_KEYS.join(', ')}` }, 400);
  const dirQ = cur ? cur.dir : c.req.query('dir');
  const dir = dirQ === 'asc' || dirQ === 'desc' ? dirQ : undefined;
  const limit = cur ? cur.limit ?? DEFAULT_LIMIT : Math.max(1, Math.min(MAX_LIMIT, Number(c.req.query('limit')) || DEFAULT_LIMIT));
  const offset = cur ? cur.o : 0;
  let snapshot: LiftSnapshot | null = null;
  try { snapshot = (await c.env.CACHE.get(liftKey(tenant, brand, slot, page), 'json')) as LiftSnapshot | null; } catch { snapshot = null; }
  const marked = await liftMarksFor(c, tenant, brand, slot, page, snapshot);
  if (!snapshot) return c.json({ ok: true, tenant, brand, slot, ...at, version: 0, published: false, level, total: 0, offset: 0, limit, rows: [], cursor: null, ...marked });
  if (cur && cur.v !== snapshot.version) return c.json({ ok: false, error: 'the snapshot has moved on since this page was cut; start the listing again', version: snapshot.version }, 409);
  const [catalog, learn] = await Promise.all([readConfig<ContentCatalog>(c, CONTENT_KIND, tenant), readConfig<LearnConfig>(c, LEARN_KIND, tenant)]);
  // W32 S1.01 (F32 §4 item 5): the names are joined onto the rows this answer
  // really names, never through a map of the whole catalogue. A query that
  // SEARCHES or SORTS by name has to rank every candidate row by its name, so
  // it asks for the snapshot's own ids — bounded by the rows the operator can
  // see, still never by the catalogue; every other query asks for the page's
  // ids alone, after the page is cut. Neither form changes the answer: the
  // filter and the sort are the same function of the same rows.
  const searching = q !== undefined || sort === 'name';
  const names = searching ? catalogNames(catalog, Object.keys(snapshot.items ?? {})) : NO_NAMES;
  const rows = rowsOf(snapshot, names, learn.slots?.[slot]?.items, level, item);
  const cut = pageRows(rows, { level, item, q, sort, dir, offset, limit });
  if (!searching) cut.rows = namedRows(cut.rows, catalogNames(catalog, cut.rows.map((r) => r.item)));
  cut.rows = unresolvedRows(catalog, cut.rows);
  const cursor = cut.next === null ? null : encodeCursor({ v: snapshot.version, o: cut.next, level, item, q, sort, dir, limit, ...(page ? { p: page } : {}) });
  // W25 V1.01: the grid states WHICH prior document its numbers were built with,
  // so an export a data scientist downloads can be reconciled against the
  // document they imported. 0 where the snapshot was built without one.
  return c.json({ ok: true, tenant, brand, slot, ...at, version: snapshot.version, published: true, publishedAt: snapshot.publishedAt, reward: snapshot.reward, objective: snapshot.objective ?? 'unit', measurementBasis: snapshot.measurementBasis ?? 'served-v1', n0: snapshot.n0, nMin: snapshot.nMin, priorVersion: snapshot.priorVersion ?? 0, level, item: item ?? null, q: q ?? null, sort: sort ?? 'lift', dir: dir ?? (sort === 'item' || sort === 'name' || sort === 'key' ? 'asc' : 'desc'), total: cut.total, offset: cut.offset, limit: cut.limit, rows: cut.rows, cursor, ...marked });
});

/**
 * GET /v1/:tenant/brands (doc 28 §4, the application's last free-text box): the brands this stamp serves,
 * in manifest order, limited to the operator's grants in enforced mode. A brand is a tenant here; the scope in the path
 * names whose documents the application is reading.
 */
decisionRoutes.get('/:tenant/brands', operatorWrites(), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const cfg = tenantConfig(c.env);
  c.header('Cache-Control', 'no-store');
  if (!cfg.provisioned.includes(tenant)) return c.json({ ok: false, error: 'Tenant unavailable' }, 403);
  const brands = cfg.provisioned.map((id, index) => ({ id, default: index === 0 }))
    .filter(({ id }) => c.env.AUTH_MODE !== 'enforced' || hasOperatorGrant(c.env, c.get('auth')?.user?.sub, id, c.get('auth')));
  return c.json({ ok: true, tenant, brands });
});

/**
 * W20 R4: the `governance` block of one slot on the operator slots page, in the
 * one word the advisory pin channel already uses for the same fact (`status`,
 * `slot-pin-diagnostics/v1`). `available` carries the counts the counter store
 * answered — zero reported as zero; `unavailable` says the store could not be
 * read and states no count and no horizon, because a zero there would be a zero
 * nobody observed. The engine's own `SlotGovernance` stays numeric: the outage is
 * a fact about this read, so its variant is typed here, where the read is made.
 */
type AvailableSlotGovernance = { status: 'available' } & SlotGovernance;
interface UnavailableSlotGovernance {
  status: 'unavailable';
  since: null;
  scope: SlotGovernanceScope;
  refusedPinCount: null;
  refusedPins: null;
  shortTakeCount: null;
  shortTakePositions: null;
  /** P47: the unreturned pins' count and names, `null` as every count is when the store could not be read. */
  unreturnedPinCount: null;
  unreturnedPins: null;
}
type SlotRow = Omit<SlotIndexEntry, 'governance'> & { governance?: AvailableSlotGovernance | UnavailableSlotGovernance };
const UNAVAILABLE_GOVERNANCE: UnavailableSlotGovernance = { status: 'unavailable', since: null, scope: SLOT_GOVERNANCE_SCOPE,
  refusedPinCount: null, refusedPins: null, shortTakeCount: null, shortTakePositions: null, unreturnedPinCount: null, unreturnedPins: null };

/**
 * GET /v1/:tenant/learn/slots?brand=&q=&evidence=1 (doc 28 §4): every slot on every page, grouped by
 * page, with what is configured on it and how many pieces are eligible now; `q` narrows by slot or
 * page name; `evidence=1` adds what each slot has learned so far (items, events, when published),
 * for up to 200 slots, and every slot's `governance` block. The application's picker and its overview.
 */
decisionRoutes.get('/:tenant/learn/slots', operatorWrites(), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const brand = (c.req.query('brand') ?? '').trim() || tenant;
  const q = (c.req.query('q') ?? '').trim() || undefined;
  const now = Date.now();
  const [slots, catalog, learn] = await Promise.all([readConfig<SlotCatalog>(c, SLOTS_KIND, tenant), readConfig<ContentCatalog>(c, CONTENT_KIND, tenant), readConfig<LearnConfig>(c, LEARN_KIND, tenant)]);
  const index = slotsIndex(slots, catalog, learn, now, q);
  let pages: Array<{ page: string; slots: Array<SlotIndexEntry | SlotRow> }> = index.pages;
  if (c.req.query('evidence') === '1') {
    // W20 G2 (R83, R86(a)): beside what each slot has LEARNED, what the decision
    // path REFUSED for it — the dead pins and the pinned slots that could not
    // fill their take, per slot, since the horizon the block states. One read of
    // one tenant document, and never silent: a slot with nothing to report
    // carries zeros, not an absent member, and a store that could not be read is
    // named on every block (R4) rather than reported as zeros.
    const governance = await observeSlotGovernance(c.env, tenant, now);
    const governanceOf = (slot: string): AvailableSlotGovernance | UnavailableSlotGovernance => governance
      ? { status: 'available', ...(governance.bySlot.get(slot) ?? emptySlotGovernance(governance.since)) }
      : { ...UNAVAILABLE_GOVERNANCE };
    // W25 V1.01 (F20 §4.4): the ids this tenant's catalogue carries, so a prior
    // for an item it does not carry is not counted as something the slot has
    // learned about. The catalogue is the one this answer already read.
    const catalogue = new Set(catalog.pieces.map((p) => p.id));
    // The 200-slot budget bounds the per-slot `evidence` reads, one store read
    // each. The governance block is already in memory from the one read above, so
    // it is joined onto EVERY row, the rows past the budget included (W20 R3).
    let budget = 200;
    pages = [];
    for (const page of index.pages) {
      const rows: SlotRow[] = [];
      for (const s of page.slots) {
        const row: SlotRow = { ...s, governance: governanceOf(s.slot) };
        rows.push(row);
        if (budget-- <= 0) { row.evidence = null; continue; }
        try {
          // W26 R2: a page-scoped row's evidence is its own page's placement.
          const snap = (await c.env.CACHE.get(liftKey(tenant, brand, s.slot, s.pageScoped ? s.page : undefined), 'json')) as LiftSnapshot | null;
          row.evidence = slotEvidence(snap, catalogue);
        } catch { row.evidence = null; }
      }
      pages.push({ page: page.page, slots: rows });
    }
  }
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, tenant, brand, q: q ?? null, total: index.total, pages });
});

/**
 * GET /v1/:tenant/learn/exploring?slot=&brand=&page=&limit=&cursor= (doc 28 §4): the items under the slot's
 * observation floor, least observed first, paged; with the slot's exploration mode, share and floor.
 * W26 R2: `page=` names the placement as it does on `/lift/rows`.
 */
decisionRoutes.get('/:tenant/learn/exploring', operatorWrites(), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const slot = (c.req.query('slot') ?? '').trim();
  if (!isCatalogueName(slot)) return c.json({ ok: false, error: SLOT_REQUIRED }, 400);
  const brand = (c.req.query('brand') ?? '').trim() || tenant;
  const cur = decodeCursor(c.req.query('cursor'));
  if (c.req.query('cursor') && !cur) return c.json({ ok: false, error: 'cursor not recognised' }, 400);
  const slotPages = await publishedSlotPages(c, tenant);
  const placement = pagedPlacement(slotPages, slot, c.req.query('page'), cur);
  if (!placement.ok) { c.header('Cache-Control', 'no-store'); return c.json(placementRefusal(placement), 400); }
  const { page } = placement, at = page ? { page } : {};
  const limit = cur ? cur.limit ?? DEFAULT_LIMIT : Math.max(1, Math.min(MAX_LIMIT, Number(c.req.query('limit')) || DEFAULT_LIMIT));
  const [snapshot, catalog, learn] = await Promise.all([
    c.env.CACHE.get(liftKey(tenant, brand, slot, page), 'json').catch(() => null) as Promise<LiftSnapshot | null>,
    readConfig<ContentCatalog>(c, CONTENT_KIND, tenant), readConfig<LearnConfig>(c, LEARN_KIND, tenant),
  ]);
  const ex = learn.slots?.[slot]?.exploration ?? null;
  // W28.W1.01: one representation of "the mode the engine runs, and the retained
  // setting where they differ" — the same helper the day report's §7 row uses.
  const eff = effectiveExploration(ex);
  // W28.R4: the share is the one the helper says a runnable policy reserves.
  // A dial that cannot explore — `off` that kept a stored share, a retained
  // withdrawn mode, no exploration block at all — reserves none, and this answer
  // says 0 for all three, as the day report's row says `configured: null`.
  const effective = { mode: eff.mode ?? 'off', share: eff.configured ?? 0,
    ...(eff.unsupported ? { configuredMode: eff.configuredMode, unsupported: true } : {}) };
  const floor = ex?.floor ?? DEFAULT_EXPLORE.floor;
  // P11 (decision D1): the page's configured evidence floor, from the learn
  // document this answer already read, and each row's exposures to it. A
  // different floor from the exploration floor above, which keeps its name and
  // its meaning; absent where the page has none, so the answer is as before.
  const evidenceFloor = placementEvidenceFloor(learn, placementPageOf(slotPages, slot, page)), floored = evidenceFloor ? { evidenceFloor } : {};
  c.header('Cache-Control', 'no-store');
  if (!snapshot) return c.json({ ok: true, tenant, brand, slot, ...at, version: 0, published: false, ...effective, floor, ...floored, total: 0, offset: 0, limit, rows: [], cursor: null });
  if (cur && cur.v !== snapshot.version) return c.json({ ok: false, error: 'the snapshot has moved on since this page was cut; start the listing again', version: snapshot.version }, 409);
  // W25 V1.01 (F20 §4.4): what exploration should serve next can only be an item
  // the catalogue carries; a prior row for an id it does not carry is never
  // offered here. The catalogue is the one this answer already read.
  //
  // W32 S1.01: MEMBERSHIP is the whole catalogue and stays the whole catalogue —
  // it is what decides which rows exist at all, and a page-bounded set here
  // would silently drop every row the page did not reach, which is exactly the
  // clause W25 added. What is bounded is the NAME join: the list is cut to the
  // page first, and only the page's ids are looked up, because the order this
  // list is in (least observed first, then id) does not depend on a name.
  // P86 (S10): a catalogue with parts cannot say which part carries an id no row names an anchor for, so its rows are
  // kept and each id the shared pieces do not carry is named unresolved; without parts, W25's rule as before.
  const catalogue = catalogParted(catalog) ? undefined : new Set(catalog.pieces.map((p) => p.id));
  const cut = pageOf(exploringRows(snapshot, NO_NAMES, floor, catalogue, evidenceFloor?.floor), cur ? cur.o : 0, limit);
  cut.rows = unresolvedRows(catalog, namedRows(cut.rows, catalogNames(catalog, cut.rows.map((r) => r.item))));
  const cursor = cut.next === null ? null : encodeCursor({ v: snapshot.version, o: cut.next, level: 'exploring', limit, ...(page ? { p: page } : {}) });
  return c.json({ ok: true, tenant, brand, slot, ...at, version: snapshot.version, published: true, ...effective, floor, ...floored, total: cut.total, offset: cut.offset, limit: cut.limit, rows: cut.rows, cursor });
});

/**
 * GET /v1/:tenant/monitor: the platform's last self-check for the tenant, and POST runs one now. Operator token.
 */
decisionRoutes.get('/:tenant/monitor', operatorJwt(), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const last = await readMonitor(c.env, tenant);
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, tenant, last, alerts: 'Optional delivery requires exact destination policy; a sent receipt is HTTP acceptance, not paging confirmation.' });
});
decisionRoutes.post('/:tenant/monitor', operatorJwt(), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const result = await runMonitor(c.env, tenant);
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, result });
});

/**
 * GET /v1/:tenant/learn/queue?brand= (doc 28 §3.5): what needs a person, as counts. Authenticated,
 * because the erasure count and the slot list are operator facts.
 */
decisionRoutes.get('/:tenant/learn/queue', operatorJwt(), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const brand = (c.req.query('brand') ?? '').trim() || tenant;
  const now = Date.now();
  const [slots, catalog, learn, proposals, tombs] = await Promise.all([
    readConfig<SlotCatalog>(c, SLOTS_KIND, tenant), readConfig<ContentCatalog>(c, CONTENT_KIND, tenant), readConfig<LearnConfig>(c, LEARN_KIND, tenant),
    publishedProposals(c, tenant), loadTombstones(c.env.STORAGE as unknown as R2Erasable, tenant),
  ]);
  const index = slotsIndex(slots, catalog, learn, now);
  const entries = index.pages.flatMap((p) => p.slots);
  const queueCatalogue = new Set(catalog.pieces.map((p) => p.id));
  let budget = 200;
  for (const s of entries) {
    if (budget-- <= 0) { s.evidence = null; continue; }
    // W26 R2: a page-scoped row's evidence is its own page's placement.
    try { const snap = (await c.env.CACHE.get(liftKey(tenant, brand, s.slot, s.pageScoped ? s.page : undefined), 'json')) as LiftSnapshot | null; s.evidence = slotEvidence(snap, queueCatalogue); } catch { s.evidence = null; }
  }
  c.header('Cache-Control', 'no-store');
  // W21 E1.05 (R118(3)): the enrollment-anchor failures of the last thirty days,
  // read from the same operator cache the governance counters use; unreadable
  // answers zero rather than failing the queue.
  // It is not part of `queueOf`'s pure computation over the published documents:
  // it is a counter read from the operator cache, so it is answered beside it.
  const health = await readEnrollmentHealth(c.env, tenant, now);
  // P84 (E8, R-P359 Q8): the arm-draw diagnostics, counted and read as the enrollment counter is.
  const armDraw = await readArmDraw(c.env, tenant, now);
  // W29 U1.01: this answer is the landing page of an operator application, so
  // its `proposals_pending` must not stand alone while every apply and reject
  // is withdrawn (503, below). The withdrawal is reported beside the counts,
  // for the same reason the enrollment counter is: it is not part of `queueOf`'s
  // pure computation over the published documents, it is what this deployment
  // can do with them. `proposals_pending` is a count of historical `proposed`
  // statuses, and the statuses it excludes are stored records, not verified
  // applications — the same two facts `GET learn/proposals` answers.
  return c.json({ ok: true, tenant, brand, ...queueOf({ proposals: proposals.proposals.filter((p) => p.brand === brand), slots: entries, learn,
    erasuresPending: tombs.size }), enrollment_anchor_unavailable: health.anchorUnavailable, arm_draw: armDraw, autonomy: AUTONOMY_WITHDRAWN });
});

/**
 * GET /v1/:tenant/visitors/:visitorId/receipts?limit=&cursor= (doc 28 §4): what this shopper was served,
 * newest first, each with the sentences that say why, from the shopper's own ring. Authenticated, like /recent.
 * Records at or before the retained erasure cutoff are suppressed by the ring.
 */
decisionRoutes.get('/:tenant/visitors/:visitorId/receipts', operatorJwt(), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  const visitorId = (c.req.param('visitorId') ?? '').trim();
  if (!TENANT.test(tenant) || !HISTORY_VISITOR.test(visitorId)) return c.json({ ok: false, error: 'bad tenant or visitor id' }, 400);
  const cur = decodeCursor(c.req.query('cursor'));
  if (c.req.query('cursor') && !cur) return c.json({ ok: false, error: 'cursor not recognised' }, 400);
  const limit = cur ? cur.limit ?? DEFAULT_LIMIT : Math.max(1, Math.min(MAX_LIMIT, Number(c.req.query('limit')) || DEFAULT_LIMIT));
  c.header('Cache-Control', 'no-store');
  let witness: RecentHistory | undefined;
  const response = await auditedSubjectRead(c, tenant, 'receipts', visitorId, async () => { try {
    const [ringRes, catalog] = await Promise.all([
      operatorRecent(c.env, tenant, visitorId), readConfig<ContentCatalog>(c, CONTENT_KIND, tenant),
    ]);
    witness = ringRes; assertRecent(c.env, tenant, ringRes);
    const ring = ringRes.ring.slice().sort((a, b) => b.ts - a.ts || a.position - b.position);
    const page = pageOf(ring, cur ? cur.o : 0, limit);
    // W32 S1.01 (F32 §4 item 5): the receipts this page carries name at most
    // `limit` pieces, so the catalogue is asked for those and no more.
    const names = catalogNames(await withRecordParts(c.env, tenant, catalog, page.rows), page.rows.map((r) => r.item_id));
    const cursor = page.next === null ? null : encodeCursor({ v: 0, o: page.next, level: 'exploring', limit });
    return c.json({ ok: true, tenant, visitor_id: visitorId, total: page.total, offset: page.offset, limit: page.limit, receipts: page.rows.map((r) => receiptOf(r, names)), cursor });
  } catch { return c.json({ ok: false, error: HISTORY_UNAVAILABLE }, 503); } });
  if (response.ok && witness) try { assertRecent(c.env, tenant, witness); }
  catch { return c.json({ ok: false, error: HISTORY_UNAVAILABLE }, 503); }
  return response;
});

/**
 * P86 (R-P407 (5), S10): the learn routes' rows over a catalogue with parts. A
 * row carries no anchor, so an id the shared pieces do not carry cannot be
 * resolved to a part: it is kept and named `unresolved: true`, its title and
 * customer id null. A catalogue without parts: the rows as they were.
 */
function unresolvedRows<T extends { item: string }>(catalog: ContentCatalog, rows: T[]): T[] {
  if (!catalogParted(catalog)) return rows;
  const shared = new Set(catalog.pieces.map((p) => p.id));
  return rows.map((row) => shared.has(row.item) ? row : { ...row, unresolved: true });
}
/**
 * P86 (R-P407 (5)): the receipts' names over a catalogue with parts: each
 * record whose item the shared pieces do not carry names the anchor it was
 * decided for (P80's scope), and that anchor's part is read — at most one part
 * per anchor on the page, never a content-id index. A part that cannot be read
 * leaves those names out, as an id the catalogue does not carry is.
 */
async function withRecordParts(env: Env, tenant: string, catalog: ContentCatalog, records: ReadonlyArray<{ item_id: string; inputs?: { anchor?: unknown } }>): Promise<ContentCatalog> {
  if (!catalogParted(catalog)) return catalog;
  const shared = new Set(catalog.pieces.map((p) => p.id)), anchors = new Set<string>();
  for (const r of records) if (!shared.has(r.item_id) && typeof r.inputs?.anchor === 'string') anchors.add(r.inputs.anchor);
  const pieces = [...catalog.pieces];
  for (const anchor of anchors) {
    // P93: the anchor's pointer through its shard on a sharded catalogue; a shard or part that cannot be read leaves the names out.
    try {
      const pointer = await catalogPartPointer(env, tenant, catalog, anchor);
      if (pointer) pieces.push(...((await readCatalogPart(env, tenant, pointer.digest)).pieces as ContentCatalog['pieces']));
    } catch { /* names left out */ }
  }
  return { ...catalog, pieces };
}

/**
 * GET /v1/:tenant/lift?slot=hero[&brand=][&page=][&version=]
 * The lift snapshot in force for a slot: every item's decayed counts, estimate and
 * lift at every pooling level, and the slot's own rate per cell. Operator access
 * is required in enforced mode. This is the console's grid (doc 22 §12.2) as data.
 * W26 R2: `page=` names the placement where the catalogue carries the slot name on
 * more than one page, for the snapshot in force and for an archived version alike.
 * P42: beside the snapshot in force (never an archived one), `stale`, last, while it is stale (`staleMarkerFor`).
 * P49: and `republished`, last, while a learn republish keeps its publications refused (`republishedFor`).
 */
decisionRoutes.get('/:tenant/lift', operatorWrites(), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const slot = (c.req.query('slot') ?? '').trim();
  if (!isCatalogueName(slot)) return c.json({ ok: false, error: SLOT_REQUIRED }, 400);
  const brand = (c.req.query('brand') ?? '').trim() || tenant;
  const slotPages = await publishedSlotPages(c, tenant);
  const placement = placementOf(slotPages, slot, c.req.query('page'));
  c.header('Cache-Control', 'no-store');
  if (!placement.ok) return c.json(placementRefusal(placement), 400);
  const { page } = placement;
  let snapshot: unknown = null;
  // Phase 3 / CW22: ?version= reads an archived snapshot instead of the one in force.
  const version = Number(c.req.query('version') ?? 0) || 0;
  if (version > 0) {
    try { const obj = await c.env.STORAGE.get(liftArchiveKey(tenant, brand, slot, version, page)); snapshot = obj ? await obj.json() : null; } catch { snapshot = null; }
  } else {
    try { snapshot = await c.env.CACHE.get(liftKey(tenant, brand, slot, page), 'json'); } catch { snapshot = null; }
  }
  // P11 (decision D1): the page's configured evidence floor and every item's
  // exposures to it at level everyone, beside the snapshot, which is unchanged;
  // absent where the page has none (or the tenant publishes no learn document).
  // The learn document is read only for a slot that is on a page at all.
  const floorPage = placementPageOf(slotPages, slot, page);
  const evidenceFloor = floorPage === undefined ? null : placementEvidenceFloor(await publishedLearn(c, tenant), floorPage);
  const marked = version > 0 ? {} : await liftMarksFor(c, tenant, brand, slot, page, snapshot);
  return c.json({ ok: true, tenant, brand, slot, ...(page ? { page } : {}), snapshot,
    ...(evidenceFloor ? { evidenceFloor, toEvidenceFloor: toEvidenceFloorOf(snapshot, evidenceFloor.floor) } : {}), ...marked });
});

/** GET /v1/:tenant/visitors/:visitorId/recent: what this visitor was shown, from the visitor's own object. Authenticated. */
decisionRoutes.get('/:tenant/visitors/:visitorId/recent', operatorJwt(), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  const visitorId = (c.req.param('visitorId') ?? '').trim();
  if (!TENANT.test(tenant) || !HISTORY_VISITOR.test(visitorId)) return c.json({ ok: false, error: 'bad tenant or visitor id' }, 400);
  c.header('Cache-Control', 'no-store');
  let witness: RecentHistory | undefined;
  const response = await auditedSubjectRead(c, tenant, 'recent', visitorId, async () => {
    try { witness = await operatorRecent(c.env, tenant, visitorId); const { retentionWitness: _private, ...body } = witness; return c.json(body); }
    catch { return c.json({ ok: false, error: HISTORY_UNAVAILABLE }, 503); }
  });
  if (response.ok && witness) try { assertRecent(c.env, tenant, witness); }
  catch { return c.json({ ok: false, error: HISTORY_UNAVAILABLE }, 503); }
  return response;
});

/**
 * Autonomy mutations are unavailable. Authenticated GET retains historical
 * proposals, whose stored statuses and completeness are not verified.
 */
decisionRoutes.post('/:tenant/learn/cycle', operatorJwt(), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const actor = (c as unknown as { get: (k: 'auth') => AuthContext | undefined }).get('auth')?.user?.sub ?? 'operator';
  const result = await runCycle(c.env, tenant, (c.req.query('brand') ?? '').trim() || tenant, Date.now(), actor);
  c.header('Cache-Control', 'no-store');
  return c.json(result, 503);
});
decisionRoutes.get('/:tenant/learn/proposals', operatorJwt(), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const doc = await readConfig<ProposalsDoc>(c, PROPOSALS_KIND, tenant);
  c.header('Cache-Control', 'no-store');
  // The withdrawal and the unverified statuses are the work queue's two facts, read from the one statement of them.
  return c.json({ ok: true, tenant, proposals: doc.proposals, history: { historical: true, verified: AUTONOMY_WITHDRAWN.proposalStatusesVerified,
    readOnly: true, complete: false, mutationAvailable: AUTONOMY_WITHDRAWN.mutationAvailable,
    note: 'Stored proposal statuses are unverified. This bounded listing is not a complete audit trail.' } });
});
decisionRoutes.post('/:tenant/learn/proposals/:id/:decision', operatorJwt(), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  const decision = c.req.param('decision');
  if (!TENANT.test(tenant) || (decision !== 'apply' && decision !== 'reject')) return c.json({ ok: false, error: 'tenant slug and apply | reject' }, 400);
  const actor = (c as unknown as { get: (k: 'auth') => AuthContext | undefined }).get('auth')?.user?.sub ?? 'operator';
  const res = await decideProposal(c.env, tenant, c.req.param('id') ?? '', decision, actor);
  c.header('Cache-Control', 'no-store');
  return c.json(res, 503);
});

/** POST /v1/:tenant/trend/rollup: what the hourly cron does, on demand. Authenticated. */
decisionRoutes.post('/:tenant/trend/rollup', operatorJwt(), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  return c.json({ ok: true, tenant, ...(await rollupTenant(c.env, tenant)) });
});

// Validate the body/query before owner forwarding: malformed context must not
// cause even grant adoption. Legacy GET remains guarded for existing callers.
/**
 * A malformed entry context is a REQUEST error, not a session refusal. It is
 * raised only after `requireShopper` has admitted the caller, so an
 * unauthenticated or refused caller still gets the 401 it always got, while an
 * admitted one now reaches the route's own documented
 * `400 'Invalid entry context'` below — unreachable for as long as this threw
 * the access error first (ruling R46).
 */
class InvalidEntryContext extends Error {}
/**
 * P31: the page's report of the modules that have nothing to show for this page
 * view — a JSON array of module identifiers, sent as one string field like
 * `entry` — malformed. A REQUEST error, raised as the entry context's is.
 */
class InvalidNothingToShow extends Error {}
/**
 * P84 (E8, D2): the `arm` member a brand-new browser's first decision request
 * carries, the JSON text of `{ class, tableVersion }` the head script drew
 * (`class` `default` or `personalized`, `tableVersion` the context table's
 * version, 1 to 128 characters, the whole text at most 256), anything else
 * malformed. A REQUEST error answered `400 'Invalid arm member'` on every path
 * (R-P371), a new browser's first request included, before anything is issued.
 */
class InvalidArmMember extends Error {}
type ArmClass = 'default' | 'personalized';
const ARM_MEMBER_LIMIT = 256;
function armMemberOf(raw: string): { class: ArmClass; tableVersion: string } | null {
  if (raw.length > ARM_MEMBER_LIMIT) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === 2 && (v.class === 'default' || v.class === 'personalized') && typeof v.tableVersion === 'string'
    && v.tableVersion.length >= 1 && v.tableVersion.length <= 128 ? { class: v.class, tableVersion: v.tableVersion } : null;
}
/**
 * P80 (R-P264): a named context signal (`ctx.<name>`) outside its bounds — a
 * name outside /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/, a value that is empty or over 64
 * characters, or more than 8 signals — on the query string or in the body. With
 * a session it is answered 400 with the message; on a new browser's first
 * request it is one of the checks made before the session is issued.
 */
class InvalidContextSignal extends Error {}
/** P80: the request's named context signals, bounded (`InvalidContextSignal`), by name, their values trimmed. */
function contextSignalsOf(context: Record<string, string>): Record<string, string> {
  const signals: Record<string, string> = {};
  for (const [key, value] of Object.entries(context)) {
    if (!key.startsWith('ctx.')) continue;
    const name = key.slice(4);
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(name)) throw new InvalidContextSignal('Invalid context signal name');
    if (typeof value !== 'string' || !value.trim() || value.length > 64) throw new InvalidContextSignal('Invalid context signal value');
    if (Object.keys(signals).length >= 8) throw new InvalidContextSignal('Too many context signals');
    signals[name] = value.trim();
  }
  return signals;
}
/**
 * A malformed consent hint (`trackingConsent`, `personalizationEnabled`): a
 * value that is not exactly `'true'` or `'false'`, or a hint the query names
 * more than once. A REQUEST error, raised as the entry context's is, and only
 * after every selector, tenant and customer-identifier check, so each of those
 * refusals stays the 401 it was; an admitted caller reaches the route's own
 * documented `400 'Invalid consent hint'`.
 */
class InvalidConsentHint extends Error {}
const CONSENT_HINTS = ['trackingConsent', 'personalizationEnabled'] as const;
/** P31: the report's bounds: the field's length, the identifiers it names, and one identifier's length. */
const NOTHING_TO_SHOW_LIMIT = 4096, NOTHING_TO_SHOW_MODULES = 64, MODULE_ID_LIMIT = 256;
/**
 * P31: the identifiers the page reports have nothing to show, each once, in the
 * order sent; null when the field is not a JSON array of at most
 * `NOTHING_TO_SHOW_MODULES` non-empty identifiers. An empty array is no report.
 */
function nothingToShowOf(raw: string): string[] | null {
  if (raw.length > NOTHING_TO_SHOW_LIMIT) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(value) || value.length > NOTHING_TO_SHOW_MODULES
    || !value.every((id) => typeof id === 'string' && id.length > 0 && id.length <= MODULE_ID_LIMIT)) return null;
  return [...new Set(value as string[])];
}
async function snapshotContext(request: Request): Promise<Record<string, string>> {
  // The consent hints' own shape is checked below as a request error; every
  // other selector is checked here exactly as before.
  assertShopperSelectors(request, { consentHints: 'route' });
  if (request.method === 'GET') {
    const query = new URL(request.url).searchParams;
    const context = Object.fromEntries(query);
    if (context.tenant !== undefined) throw new SessionAccessError();
    if (context.entry !== undefined) {
      try { if (context.entry.length > ENTRY_QUERY_LIMIT || !validEntry(JSON.parse(context.entry), true)) throw new Error(); } catch { throw new InvalidEntryContext(); }
    }
    if (context.nothingToShow !== undefined && nothingToShowOf(context.nothingToShow) === null) throw new InvalidNothingToShow();
    if (context.arm !== undefined && armMemberOf(context.arm) === null) throw new InvalidArmMember();
    contextSignalsOf(context);
    for (const key of CONSENT_HINTS) {
      const values = query.getAll(key);
      if (values.length > 1 || (values.length === 1 && values[0] !== 'true' && values[0] !== 'false')) throw new InvalidConsentHint();
    }
    return context;
  }
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].length) throw new SessionAccessError();
  let value: unknown;
  try { value = parseShopperContext(await request.clone().text()); } catch { throw new SessionAccessError(); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SessionAccessError();
  const out: Record<string, string> = {};
  // P84 (E8, D2, R-P371): `arm`, the class a brand-new browser's head script
  // drew, is admitted as it comes and checked below, after every selector,
  // tenant and customer-identifier check, so a malformed one is the request
  // error `InvalidArmMember` (400, on a new browser's first request too).
  let arm: unknown;
  for (const [key, item] of Object.entries(value)) {
    if (key === 'arm') { arm = item; continue; }
    // P13 (decision D1): the allow-list gains exactly one key, `customerId`, the
    // customer's identifier the page carried (never a selector: it names no
    // visitor and no session, and `userId`, `visitorId`, `sessionId` stay refused).
    // P80: and the named context signals `ctx.<name>`, as the query string carries
    // them, under the same bounds (checked with the query's, below).
    if ((!['page', 'brand', 'channel', 'entry', 'browsingSessionId', 'trackingConsent', 'personalizationEnabled', 'pageInstance', 'nothingToShow', 'customerId'].includes(key) && !key.startsWith('ctx.'))
      // P31: the report's own bounds are its validator's, below, so an overlong report is a request error.
      // P80 (R-P264): a context signal's own bounds are its validator's, below, so an overlong one is a request error.
      || typeof item !== 'string' || (key !== 'nothingToShow' && !key.startsWith('ctx.') && item.length > (key === 'entry' ? ENTRY_QUERY_LIMIT : 128))) throw new SessionAccessError();
    out[key] = item;
  }
  if (out.entry !== undefined) {
    try { if (!validEntry(JSON.parse(out.entry), true)) throw new Error(); } catch { throw new InvalidEntryContext(); }
  }
  if (out.nothingToShow !== undefined && nothingToShowOf(out.nothingToShow) === null) throw new InvalidNothingToShow();
  contextSignalsOf(out);
  if (out.customerId !== undefined && !isCarriedCustomerId(out.customerId)) throw new SessionAccessError();
  if (arm !== undefined) {
    if (typeof arm !== 'string' || armMemberOf(arm) === null) throw new InvalidArmMember();
    out.arm = arm;
  }
  for (const key of CONSENT_HINTS) if (out[key] !== undefined && out[key] !== 'true' && out[key] !== 'false') throw new InvalidConsentHint();
  return out;
}

/**
 * P84 (E8, D2 mechanism (a), R-P359 Q8): the mint of a brand-new browser's
 * identifier into the class its page drew before paint. The holdout in force
 * (the learn document of one pinned set, its salt the brand's where it names
 * none, as the decision's), the probability `p` that one new identifier's arm
 * is in the class (`default`: share × its count in the arms ÷ the arms, as
 * `armFor` splits it; `personalized`: the rest) and the cap of draws: one where
 * p is 0 or 1 (no draw can change the outcome), else min(4096, ⌈ln 10⁻⁶ ÷
 * ln(1 − p)⌉), so a class that can be met is missed at most once in a million.
 * Null where the holdout cannot be read: the identifier is then drawn as without
 * the member and nothing is claimed for it.
 */
interface ArmMint { target: MintTarget; p: number; learnRevision: number }
async function armMint(env: Env, tenant: string, brand: string, cls: ArmClass): Promise<ArmMint | null> {
  try {
    const learn = await readPinnedPublication(env, LEARN_KIND, tenant, await pinPublication(env, tenant, true));
    const holdout = { ...learn.value.holdout, salt: learn.value.holdout.salt || brand };
    const pDefault = defaultArmProbability(holdout), p = cls === 'default' ? pDefault : 1 - pDefault;
    const cap = p <= 0 || p >= 1 ? 1 : Math.min(4096, Math.ceil(Math.log(1e-6) / Math.log(1 - p)));
    return { target: { accept: (subject) => armClassOf(armFor(subject, holdout)) === cls, cap }, p, learnRevision: learn.revision };
  } catch { return null; }
}
/**
 * P84: what became of the page's class, said on the first answer as
 * `armRequest` and, where it was not met, counted for the operator (the learn
 * queue's `arm_draw`, after the answer, never a synthetic operation's): met
 * (`honoured: true`), `capped` (not met within the cap), `mismatch` (a share of
 * 0 or 1 that cannot meet it at all) or `republished` (a learn publication
 * between the mint's holdout read and the decision's own pin moved the
 * identifier out of the class, read against the holdout in force after it).
 */
async function armOutcome(env: Env, tenant: string, brand: string, cls: ArmClass, mint: ArmMint, subject: string, answeredLearn: unknown): Promise<{ class: ArmClass; honoured: boolean; reason?: ArmDrawReason }> {
  const after = typeof answeredLearn === 'number' && answeredLearn !== mint.learnRevision ? await armMint(env, tenant, brand, cls) : null;
  if ((after ?? mint).target.accept(subject)) return { class: cls, honoured: true };
  return { class: cls, honoured: false, reason: after ? 'republished' : mint.p <= 0 || mint.p >= 1 ? 'mismatch' : 'capped' };
}
/** P84: the arm-draw count, after the answer; it can neither fail nor delay a decision. */
function countArmDraw(c: { env: Env; executionCtx: ExecutionContext }, tenant: string, reason: ArmDrawReason): void {
  if (syntheticOperation()) return;
  const counted = recordArmDraw(c.env, tenant, reason, Date.now());
  try { c.executionCtx.waitUntil(counted); } catch { void counted; }
}

/**
 * P96 (E21, R-P526): one `total` on the first request's answer. The platform's timing middleware (src/index.ts,
 * `hono/timing`) appends its own `total;dur=…;desc="Total Response Time"` to an answer after the route has answered;
 * the first-request door names its own `total`, the door's whole time (P76), so on the answer that carries it the door
 * tells the middleware, which then adds nothing there. The mark is a request-scoped context variable under a symbol
 * private to this module: no header, body or other route can set it, and only the door's own answer carrying its
 * `total` sets it, after that answer is built. Its reader also asks that no error was answered after it (Hono records
 * one as `c.error` wherever its error handler replaced the answer), so a door answer an error replaced, every door
 * refusal and every other route keep the platform's entry exactly as before.
 */
const OWN_TOTAL: unique symbol = Symbol('the first-request door answered its own total');
type OwnTotalVariables = { [OWN_TOTAL]?: true };
/** Whether this answer is the first-request door's, which names its own `total` (read by src/index.ts's timing middleware). */
export const answersOwnTotal = (c: Context<{ Variables: OwnTotalVariables }>): boolean => c.error === undefined && c.get(OWN_TOTAL) === true;

/**
 * P13 (H4, decision D1): a new visitor's first decision is served on the first
 * request. A POST to the decision request that carries no shopper session at
 * all (no `X-Shopper-Session`, no socket protocol) is the one call a new
 * visitor makes: it is checked exactly as the session route and this route
 * check a request before anything is written — the tenant (the path's and the
 * request's), the body's bound and time limit, the strict key allow-list (no
 * selector, no query), the entry, the nothing-to-show report and the consent
 * hints — and any failure is the same `401` writing nothing. Only then is the
 * session issued, the very grant POST /v1/:tenant/identity/session issues a
 * browser with no capability (`anonymousWithConsent`, with the consent default
 * that route gives it: the cookies' and the request's own refusal hints, which
 * can only restrict), and the request is re-entered under it through the
 * shopper's own object, where every existing check of this route runs on it
 * unchanged. The answer is the first decision set with the issued session as
 * `session`, in the shape the session route answers. A request that carries a
 * session, valid or not, never takes this path, so a forged, stale or foreign
 * one is refused `401` as before and a valid one gets no `session` member; a
 * GET without one is refused as before. The site-key gate runs before any of it
 * at the edge. Nothing about the customer's identifier selects anything here:
 * the session is a fresh anonymous visitor's, whatever the body carries.
 */
const firstDecisionRequest = createMiddleware<{ Bindings: Env; Variables: TenantVariables & OwnTotalVariables }>(async (c, next) => {
  if (c.req.method !== 'POST' || capabilityToken(c.req.raw) !== null) return next();
  const doorStarted = performance.now();
  const tenant = shopperTenant(c.env, c.req.raw, c.get('tenant'));
  if ((c.req.param('tenant') ?? '') !== tenant) throw new SessionAccessError();
  let text: string, context: Record<string, string>;
  try {
    text = await boundedShopperBody(c.req.raw, 8192, 5000);
    context = await snapshotContext(c.req.raw);
  } catch (error) {
    // P84 (R-P371): a malformed `arm` member is a request error here too, refused before a session is issued.
    if (error instanceof InvalidArmMember) { c.header('Cache-Control', 'no-store'); return c.json({ ok: false, error: 'Invalid arm member' }, 400); }
    throw new SessionAccessError();
  }
  const hints = intersectConsent(consentFromCookies(c.req.header('Cookie') ?? null), refusalHints({
    ...(context.trackingConsent === 'false' ? { tracking: false } : {}),
    ...(context.personalizationEnabled === 'false' ? { personalization: false } : {}),
  }));
  // P84 (E8, D2 mechanism (a)): the class the page drew before paint; the identifier is minted into it.
  const brand = (context.brand ?? '').trim() || tenant;
  const drawn = context.arm === undefined ? null : armMemberOf(context.arm);
  const mintStarted = performance.now();
  const mint = drawn ? await armMint(c.env, tenant, brand, drawn.class) : null;
  let armMs = performance.now() - mintStarted;
  const sessionStarted = performance.now();
  const parts: SessionParts = {};
  const session = await anonymousWithConsent(c.env, tenant, hints, mint?.target, parts);
  const verifyStarted = performance.now();
  const principal = await verifySessionCapability(c.env, session.capability, tenant);
  const verified = performance.now();
  const sessionMs = verified - sessionStarted;
  // P97 (FV3, R-P547): the session entry's parts, a diagnostic beside sources.timings (never in Server-Timing): the
  // mint, the activation's round trip, the verify and the shopper object's own parts of the activation.
  const sessionParts = { mint: parts.mint ?? 0, activate: parts.activate ?? 0, verify: Math.round(verified - verifyStarted), object: parts.object ?? {} };
  const headers = new Headers(c.req.raw.headers);
  headers.set(SHOPPER_HEADER, session.capability);
  // The member is the mint's alone: the decision is re-entered without it, as a request carrying a session.
  if (context.arm !== undefined) {
    text = JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(text) as Record<string, unknown>).filter(([key]) => key !== 'arm')));
    headers.delete('Content-Length');
  }
  const forwardStarted = performance.now();
  const answered = await forwardShopperRequest(c.env, new Request(c.req.raw.url, { method: 'POST', headers, body: text }), principal,
    (c.req.raw as Request & { cf?: unknown }).cf);
  // A refusal or a failure is answered as the route answered it, without the
  // session: the SDK then takes the session route as before.
  if (answered.status !== 200) return answered;
  const body = await answered.json().catch(() => null) as Record<string, unknown> | null;
  const forwardMs = performance.now() - forwardStarted;
  if (!body || body.ok !== true) return c.json({ ok: false, error: 'Snapshot unavailable' }, 503);
  // P30 (decision D2): the first decision set's context key, as the route answered it.
  const contextKey = answered.headers.get('X-Context-Key');
  if (contextKey) c.header('X-Context-Key', contextKey);
  c.header('Cache-Control', 'no-store');
  const outcomeStarted = performance.now();
  const armRequest = drawn && mint ? await armOutcome(c.env, tenant, brand, drawn.class, mint, session.subject, (body.versions as { learn?: unknown } | undefined)?.learn) : null;
  armMs += performance.now() - outcomeStarted;
  if (armRequest?.reason) countArmDraw(c, tenant, armRequest.reason);
  // P76 (E12, R-P438): the first request names its own time beside the forwarded decision's five stages, in whole
  // milliseconds, in Server-Timing and in sources.timings (a cross-origin page cannot read the header): `session` (the
  // issue, the activation on the new shopper's object and the verify), `forward` (the forward's round trip less those
  // stages), `arm` (only when the page drew a class: its mint and outcome) and `total`, the first request's whole time,
  // which the others add up to but for the request's own reading of its body. P96: the platform's own `total` is not
  // added beside it (answersOwnTotal above), so each name is on the answer once, the header's entries the body's.
  const sources = (body.sources ?? {}) as { timings?: Record<string, number> };
  const stages = sources.timings ?? {};
  const stageMs = Object.values(stages).reduce((sum, ms) => sum + (Number.isFinite(ms) ? ms : 0), 0);
  const own: Record<string, number> = { session: Math.round(sessionMs), forward: Math.max(0, Math.round(forwardMs - stageMs)),
    ...(drawn ? { arm: Math.round(armMs) } : {}), total: Math.round(performance.now() - doorStarted) };
  const timing = answered.headers.get('Server-Timing');
  c.header('Server-Timing', [timing, ...Object.entries(own).map(([name, ms]) => `${name};dur=${ms}`)].filter(Boolean).join(', '));
  const answer = c.json({ ...body, sources: { ...sources, timings: { ...stages, ...own }, sessionParts }, session, ...(armRequest ? { armRequest } : {}) });
  c.set(OWN_TOTAL, true);
  return answer;
});
/**
 * P84 (E8; the rendering record's N1, R-P359 Q3 and Q6): GET
 * /v1/:tenant/context-table/:page[/:version], the page's context table
 * (`contextTableInForce`, src/content/service.ts), shopper-free: no session, no cookie, nothing about a
 * shopper read or named, behind the site-key gate like every /v1 read on a
 * customer deployment. Computed on read as a pure function of ONE pinned
 * publication set (the slots and learn documents in force), its `version` the
 * SHA-256 of its canonical bytes, so a publication that changes an input moves
 * it and one that does not leaves it byte for byte. The stable address is
 * public for a minute; the versioned one, while that version is the one in
 * force, for a year and immutable, and 404 once it is not. A page without a
 * declared layout slot has none (404). The server render fetches it and inlines
 * it for the head script (src/sdk/head.ts).
 */
const contextTable = createMiddleware<{ Bindings: Env; Variables: TenantVariables }>(async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim(), page = c.req.param('page') ?? '', version = c.req.param('version');
  const none = (status: 404 | 503, error: string) => { c.header('Cache-Control', 'no-store'); return c.json({ ok: false, error }, status); };
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(tenant)) return none(404, 'no context table for that page');
  let doc: ContextTableInForce | null = null;
  // P85 (R-P393 Q3): the one computation the carousel beacon's admission reads too (src/content/service.ts).
  try { doc = await contextTableInForce(c.env, tenant, page); } catch (error) {
    if (error instanceof PublicationError && error.status === 404) return none(404, 'no context table for that page');
    return none(503, 'Context table unavailable');
  }
  if (!doc) return none(404, 'no context table for that page');
  if (version !== undefined && version !== doc.version) return none(404, 'that version of the context table is no longer in force; read the stable address');
  c.header('Cache-Control', version === undefined ? 'public, max-age=60' : 'public, max-age=31536000, immutable');
  return c.json(doc);
});
decisionRoutes.get('/:tenant/context-table/:page', contextTable);
decisionRoutes.get('/:tenant/context-table/:page/:version', contextTable);
decisionRoutes.on(['GET', 'POST'], '/:tenant/decisions/snapshot', firstDecisionRequest, requireShopper({ forward: false, bodyLimit: 8192, bodyTimeoutMs: 5000 }), async (c, next) => {
  try { await snapshotContext(c.req.raw); }
  catch (error) {
    if (error instanceof InvalidEntryContext) return c.json({ ok: false, error: 'Invalid entry context' }, 400);
    if (error instanceof InvalidNothingToShow) return c.json({ ok: false, error: 'Invalid nothing-to-show report' }, 400);
    if (error instanceof InvalidArmMember) return c.json({ ok: false, error: 'Invalid arm member' }, 400);
    if (error instanceof InvalidContextSignal) return c.json({ ok: false, error: error.message }, 400);
    if (error instanceof InvalidConsentHint) return c.json({ ok: false, error: 'Invalid consent hint' }, 400);
    throw error;
  }
  await next();
}, requireShopper(), async (c) => {
  let context: Record<string, string>;
  try { context = await snapshotContext(c.req.raw); }
  catch (error) {
    if (error instanceof InvalidEntryContext) return c.json({ ok: false, error: 'Invalid entry context' }, 400);
    if (error instanceof InvalidNothingToShow) return c.json({ ok: false, error: 'Invalid nothing-to-show report' }, 400);
    if (error instanceof InvalidArmMember) return c.json({ ok: false, error: 'Invalid arm member' }, 400);
    if (error instanceof InvalidContextSignal) return c.json({ ok: false, error: error.message }, 400);
    if (error instanceof InvalidConsentHint) return c.json({ ok: false, error: 'Invalid consent hint' }, 400);
    throw error;
  }
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const principal = shopperPrincipal(c.req.raw);
  const visitorId = principal.subject;
  if (!visitorId) return c.json({ ok: false, error: 'visitorId required' }, 400);
  // A visitor id is a Durable Object name and a session key. One that starts with
  // the namespace marker would address another brand's namespace directly.
  if (visitorId.startsWith(NAMESPACE_MARKER)) return c.json({ ok: false, error: 'visitorId may not start with the namespace marker' }, 400);
  const page = ((context.page ?? 'home').trim() || 'home').slice(0, 64);
  const brand = (context.brand ?? '').trim() || undefined;
  const channel = (context.channel ?? '').trim() || null;
  let entry: ChannelSignals | undefined;
  const entries = context.entry === undefined ? undefined : [context.entry];
  if (entries !== undefined) {
    try {
      if (entries.length !== 1 || entries[0]!.length > ENTRY_QUERY_LIMIT) throw new Error('Invalid entry');
      const value: unknown = JSON.parse(entries[0]!);
      if (!validEntry(value, true)) throw new Error('Invalid entry');
      entry = value;
    } catch { return c.json({ ok: false, error: 'Invalid entry context' }, 400); }
  }
  // Additive server-side withdrawal hints; only exact booleans are accepted.
  const consent: { tracking?: boolean; personalization?: boolean } = {};
  for (const [query, key] of [['trackingConsent', 'tracking'], ['personalizationEnabled', 'personalization']] as const) {
    const values = context[query] === undefined ? undefined : [context[query]!];
    if (values === undefined) continue;
    if (values.length !== 1 || (values[0] !== 'true' && values[0] !== 'false')) return c.json({ ok: false, error: 'Invalid consent hint' }, 400);
    consent[key] = values[0] === 'true';
  }
  /**
   * Named conditions the caller asserts for this request, as `ctx.<name>=value`:
   * the anchor product (`ctx.anchor`) a slot's `complements` rule reads, and on
   * the demo profile alone a region that selects the regional prior. P31: they
   * gate no piece — a module's `eligibleWhen` rule reads the decision's cell —
   * and a signal here can never boost a piece, re-rank the slot, or become
   * behavioural evidence about the shopper. Bounded hard, because the query
   * string is caller-controlled.
   */
  // P80 (R-P264): bounded with the request's other checks (`snapshotContext`, above), so a new browser's first
  // request is refused before its session is issued; read here as admitted.
  const eligibilityContext = contextSignalsOf(context);

  // P31: the page's report of the modules with nothing to show for this page view (validated above).
  const nothingToShow = context.nothingToShow === undefined ? null : nothingToShowOf(context.nothingToShow);

  const sessionId = principal.sessionId;
  const cf = ((c.req.raw as unknown as { cf?: unknown }).cf ?? null) as { country?: string; regionCode?: string } | null;

  // Two names, on purpose, until CW1 provisions tenants: the path names the SCOPE
  // the documents are read under; the tenancy middleware names the brand whose
  // shopper state and session this request belongs to.
  const out = await serveContentDecisions(c.env, {
    tenant, brand, page, visitorId, sessionId, channel, entry, cf, cookieHeader: c.req.header('Cookie') ?? null, consent,
    // The OS family this request reports, for `platform` seed rules: the OS family is read from the request;
    // the fired seed (ios or android) is recorded on the receipt as a driver; nothing finer is read or kept.
    platform: platformOf(c.req.raw.headers),
    // P37: the device class this request reports (client hint, else user agent), for `device` seed rules and
    // configured orders naming a device: the class is read from the request; the user agent itself is never kept.
    device: deviceOf(c.req.raw.headers),
    stateTenant: c.get('tenant'), principal, capability: capabilityToken(c.req.raw)!,
    // The offer envelope is the RENDERED-measurement path, and it only does
    // anything when the caller supplies a page instance (see service.ts:568 —
    // without one, no render offer is minted). Passing it unconditionally had
    // one effect and one only: it suppressed served-v1 ledger capture
    // (service.ts:527) for every caller that never opted into rendered
    // measurement, so their decisions were never written and a day report
    // counted zero exposures against real outcomes. The documented default is
    // that a missing basis stays served-v1, so send the envelope only when the
    // caller actually asked for the other path.
    ...(context.pageInstance ? { offer: { pageInstance: context.pageInstance } } : {}),
    browsingSessionId: (context.browsingSessionId ?? '').trim().slice(0, 128) || undefined,
    ...(Object.keys(eligibilityContext).length ? { context: eligibilityContext } : {}),
    // P31: withheld before ranking: neither returned, nor recorded, nor counted as an exposure.
    ...(nothingToShow?.length ? { nothingToShow } : {}),
    // P13 (decision D1): the customer's identifier the POST body carried (validated above), written beside
    // visitor_id on the records under tracking consent and read by nothing that decides.
    ...(c.req.method === 'POST' && context.customerId !== undefined ? { customerId: context.customerId } : {}),
  }).catch((error: unknown) => {
    if (error instanceof PublicationError && error.code === 'part_unavailable') return null;
    throw error;
  });
  // P86 (R-P412 (2), R-P415): the page's anchor names a catalogue part that cannot be read (lost, or a body
  // that is not its digest's): the page fails 503 `part_unavailable`, never served from the shared pieces alone.
  if (out === null) return c.json({ ok: false, error: 'Catalogue part unavailable', code: 'part_unavailable' }, 503);
  // P13 (R-P66 item 2): under the tracking consent the decision was made with, the
  // carried identifier is handed to the shopper's own object for the browser's
  // link answer, after the decision, which it never reads; a failure changes
  // nothing of the answer (the value is carried again on the next request).
  if (c.req.method === 'POST' && context.customerId !== undefined && out.sources.consent.tracking) await carryOwnerCustomerId(c.env, principal, context.customerId);
  // Where the time went, for whoever is measuring: one Server-Timing entry per stage.
  c.header('Server-Timing', Object.entries(out.sources.timings).map(([k, v]) => `${k};dur=${v}`).join(', '));
  // P30 (decision D2): a page whose declared layout slot is context-only names
  // its context in the `X-Context-Key` header, sealed (src/content/service.ts):
  // the page, the channel, the visit bucket, the device and, where admitted, the
  // region — or its default variant — never a visitor, session or decision
  // identifier, and never a member of the answer. A key that cannot be sealed is
  // left off; the decision is the same either way, and the answer stays no-store.
  if (out.contextKey) {
    const key = await sealContextKey(c.env, tenant, out.brand, out.contextKey);
    if (key) c.header('X-Context-Key', key);
  }
  // P84 (E8, D2): a request carrying a session never changes its arm: a class it names is ignored, said and counted.
  const ignoredArm = context.arm === undefined ? null : armMemberOf(context.arm);
  if (ignoredArm) countArmDraw(c, tenant, 'ignored');
  // Phase 0 and Phase 1, after the response, never on it: the ledger, the visitor's ring, each slot's exposures.
  // CW31: nothing at all when the shopper withheld tracking consent.
  // Ruling L-R10 (P02 decision D1): exactly the records the serve-time capture
  // took, so a declared layout slot measured on served-v1 is never written here.
  const ledger = out.write && c.env.LEDGER_RECOVERY_ENABLED !== 'true' ? enqueueDecisions(c.env, out.ledgerRecords) : Promise.resolve();
  // G16 (W06.05 under the W09 owner rule): this route runs inside the shopper's
  // owner, whose waitUntil retains work until it answers. It retains everything
  // after the answer but a learning fan-out waiting on its erasure read, which
  // runs inside the owner later and which the owner keeps alive with the
  // platform's waitUntil (`continueAfterOwnerRead`); otherwise `ownerDrain` is
  // `afterResponse` itself.
  try { c.executionCtx.waitUntil(ledger); c.executionCtx.waitUntil(out.ownerDrain); } catch { void ledger; void out.afterResponse; }
  c.header('Cache-Control', 'no-store');
  const refusedPins = out.pinDiagnostics ?? [];
  // Private replay inputs travel only inside authenticated encrypted offers.
  const payload = { ok: true, tenant, brand: out.brand, page: out.page, ts: out.ts, arm: out.arm,
    // W21 E1.03: the experiment this answer belongs to — `arm` above is the
    // experience served, `experiment.arm` the experimental assignment — so a
    // customer can join their own outcome data to the population the shopper was
    // served in. Absent for an unsigned caller, which is no shopper.
    ...(out.experiment ? { experiment: out.experiment } : {}),
    ...(ignoredArm ? { armRequest: { class: ignoredArm.class, honoured: false, reason: 'ignored' } } : {}),
    versions: out.versions, config_label: out.config_label, decisions: out.decisions,
    // P89 (E14, R-P459 S2): the shopper's own shot order on a page whose context table names a carousel (null where
    // none is carried); absent elsewhere, so every other answer is as before. A pushed set is this answer.
    ...(out.shotOrder !== undefined ? { shotOrder: out.shotOrder } : {}),
    // A refused pin has no delivery decision and no ledger row, so without this member
    // the refusal reaches nothing outside the worker: the slot silently falls back to
    // the site's own default. The decision set already names each refusal (slot, pinned
    // piece, position within the pin prefix, reason); the answer carries that array
    // BOUNDED, and only when there is something to name.
    //
    // W20 G2 (R89(a)): the array is a sample of at most RUNTIME_PIN_SAMPLE entries in
    // slot order, with the totals beside it — the count/omitted-count pattern the
    // advisory pin channel already uses (`slotDiagnostics`). Every pin of every slot on
    // a page is operator-authored and unbounded in number, so an unbounded member would
    // let one published document push this answer past the size guard below and turn a
    // served snapshot into a 503 for a shopper. Bounded here, before that guard.
    ...(refusedPins.length ? { pinDiagnostics: refusedPins.slice(0, RUNTIME_PIN_SAMPLE),
      refusedCount: refusedPins.length, omittedCount: Math.max(0, refusedPins.length - RUNTIME_PIN_SAMPLE) } : {}),
    ...(syntheticOperation()?.tenant === tenant && syntheticOperation()?.subject === principal.subject && syntheticOperation()?.sessionId === principal.sessionId ? { records: out.records } : {}),
    sources: out.sources, ...(context.pageInstance ? { pageInstance: context.pageInstance } : {}) };
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > 2 * 1024 * 1024) return c.json({ ok: false, error: 'Snapshot unavailable' }, 503);
  return c.json(payload);
});

/**
 * W21 C1.07 (F12): how many pages of one listing prefix a windowed export reads
 * before it stops and says so. The bound is on the WORK, not on the calendar, so
 * a window of empty days costs the walk that passes over them and nothing more.
 */
const WINDOW_LIST_PAGES = 8;
/** The longest prefix two keys of the same shape share. */
function sharedPrefix(a: string, b: string): string {
  let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return a.slice(0, n);
}
/**
 * The listing prefixes a window is swept under: one per calendar year the window
 * touches (at most two, since a window is at most 184 inclusive days), each
 * narrowed to the longest prefix that year's own days share. A whole day keeps
 * its trailing separator, so a one-day sweep lists exactly what a `date=` listing
 * lists. Dates arrive sorted and contiguous.
 */
function windowPrefixes(tenant: string, dates: readonly string[]): string[] {
  const years = new Map<string, { first: string; last: string }>();
  for (const date of dates) {
    const year = date.slice(0, 4), seen = years.get(year);
    if (seen) seen.last = date; else years.set(year, { first: date, last: date });
  }
  return [...years.values()].map(({ first, last }) => {
    const shared = sharedPrefix(first, last);
    return `${tenant}/${shared}${shared.length === first.length ? '/' : ''}`;
  });
}

/**
 * GET /v1/:tenant/ledger/batches?date=YYYY-MM-DD[&stream=decision|outcome|product-sort][&cursor=]
 * The export (doc 22 §12.4) is the R2 partition itself; this lists one day's
 * batch objects so a warehouse job knows what to fetch. Authenticated.
 * Registered before /ledger/:id so the literal segment wins.
 */
decisionRoutes.get('/:tenant/ledger/batches', operatorJwt(), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  const date = (c.req.query('date') ?? '').trim();
  // W21 E1.03 (position 8): the comparison is computed on the customer's side,
  // from records this export delivers, so the export takes the WINDOW they are
  // comparing over instead of making them walk it one date at a time.
  // `date=` remains exactly what it was: one day, the same answer as before.
  const from = (c.req.query('from') ?? '').trim(), to = (c.req.query('to') ?? '').trim();
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const windowed = from !== '' || to !== '';
  if (!TENANT.test(tenant) || (windowed ? date !== '' || !day.test(from) || !day.test(to) : !day.test(date))) {
    return c.json({ ok: false, error: 'tenant slug and date=YYYY-MM-DD, or from=YYYY-MM-DD and to=YYYY-MM-DD' }, 400);
  }
  let dates: string[];
  try { dates = windowed ? datesBetween(from, to) : [date]; }
  catch (error) { return c.json({ ok: false, error: error instanceof WindowRangeError ? error.message : 'Invalid window' }, 400); }
  const selected = c.req.query('stream');
  if (selected && !['decision', 'outcome', 'product-sort', 'behavior'].includes(selected)) return c.json({ ok: false, error: 'Invalid stream' }, 400);
  const stream = selected as LedgerStream | undefined;
  const cursor = (c.req.query('cursor') ?? '').trim() || undefined;
  // A cursor continues one day's listing; it cannot be read across a window,
  // because the days are listed in order and a cursor names a position in one.
  if (cursor && dates.length !== 1) return c.json({ ok: false, error: 'cursor continues a single date' }, 400);
  return auditedSubjectRead(c, tenant, 'batches', undefined, async () => {
  const tombs = await loadTombstones(c.env.STORAGE as unknown as R2Erasable, tenant);
  const objects: Array<{ key: string; date: string; size: number; uploaded: string }> = [];
  let truncated = false, nextCursor: string | undefined, listedDays = 0;
  // W21 C1.07 (F12): the days of a window are one ORDERED key space, so the
  // window is swept under the prefixes its days share instead of one listing per
  // day. A six-month window whose content is two days cost 184 sequential
  // listings; it now costs one per calendar year the window touches (at most
  // two, since a window is at most 184 days), plus its pages. The object budget
  // is applied where an object is TAKEN rather than between days, so a day that
  // starts inside the budget can no longer carry the answer past it, and the
  // answer names the days the sweep actually reached.
  let reached: string | null = null;
  const reach = (value: string) => { if (reached === null || value > reached) reached = value; };
  if (windowed && dates.length > 1) {
    sweep:
    for (const prefix of windowPrefixes(tenant, dates)) {
      let page: string | undefined;
      for (let read = 0; read < WINDOW_LIST_PAGES; read++) {
        // W21 C1.09 (the W21-B2 build review, finding 1): the sweep BEGINS at the
        // window's first day. The prefix a window's days share is the calendar
        // year, so without this the listing starts at the year's first key and a
        // tenant with more objects earlier that year than the page budget
        // (`WINDOW_LIST_PAGES` × 1000) spends the whole budget skipping keys
        // `continue` already discards, and is answered an empty window it really
        // has days in. `startAfter` resumes at the first key strictly after
        // `<tenant>/<from>`, which is before every key of `<tenant>/<from>/…`,
        // so no object of the window is skipped and the earlier ones are never
        // paged through. It is passed on the FIRST page only: a continuation
        // carries its position in the cursor, which already began after it.
        const listed = await c.env.STORAGE.list({ prefix,
          ...(page ? { cursor: page } : { startAfter: `${tenant}/${from}` }), limit: 1000 });
        let past = false;
        for (const o of listed.objects) {
          const objectDate = o.key.split('/')[1] ?? '';
          if (objectDate < from) continue;
          if (objectDate > to) { past = true; break; }
          if (!(stream ? o.key.split('/')[3] === stream : isLearningKey(o.key))) { reach(objectDate); continue; }
          if (objects.length >= REPORT_LIMITS.objects) { truncated = true; break sweep; }
          objects.push({ key: o.key, date: objectDate, size: o.size, uploaded: o.uploaded instanceof Date ? o.uploaded.toISOString() : String(o.uploaded) });
          reach(objectDate);
        }
        if (past || !listed.truncated) break;
        page = listed.cursor;
        // The listing budget is the one bound a window cannot talk its way past:
        // a prefix with more pages than this stops the request and says so.
        if (read + 1 >= WINDOW_LIST_PAGES) { truncated = true; break sweep; }
      }
    }
    // Everything up to the last day the sweep reached was read in full; a sweep
    // that ran to the end of its prefixes read the whole window.
    listedDays = truncated ? dates.filter(d => reached !== null && d <= reached).length : dates.length;
  } else {
    for (const listedDate of dates) {
      // The object budget the single-day listing already applied, applied to the
      // window as a whole: a window answers what it read and says it stopped.
      if (objects.length >= REPORT_LIMITS.objects) { truncated = true; break; }
      const listed = await c.env.STORAGE.list({ prefix: `${tenant}/${listedDate}/`, ...(cursor ? { cursor } : {}), limit: 1000 });
      listedDays++;
      for (const o of listed.objects) {
        if (!(stream ? o.key.split('/')[3] === stream : isLearningKey(o.key))) continue;
        objects.push({ key: o.key, date: listedDate, size: o.size, uploaded: o.uploaded instanceof Date ? o.uploaded.toISOString() : String(o.uploaded) });
      }
      if (listed.truncated) { truncated = true; nextCursor = listed.cursor; break; }
    }
  }
  c.header('Cache-Control', 'no-store');
  // W22 R1.05: a single-date listing reconciles itself with the day the platform
  // published — the rows the objects hold, the distinct rows after the reader's
  // own dedup, and the saved report's own counts — so a warehouse loading the
  // partition and an operator reading the report cannot disagree in silence.
  // Only a listing that can see the WHOLE day carries it: a window lists several
  // days, a cursor lists part of one, a `stream` filter hides the other stream,
  // and a truncated listing has already stopped short. It opens only the objects
  // it just listed and reads the report by its own key; it lists nothing twice.
  const counts = windowed || cursor || stream || truncated ? null
    : await exportReconciliation(c.env.STORAGE as unknown as Parameters<typeof exportReconciliation>[0],
      { tenant, brand: (c.req.query('brand') ?? '').trim() || tenant, date }, objects.map(o => o.key), tombs);
  // CW28: a warehouse job applies the pending erasures to what it loads; the nightly rewrite makes the objects themselves clean.
  return c.json({ ok: true, tenant, ...(windowed ? { from, to, days: dates.slice(0, listedDays) } : { date }),
    stream: stream ?? 'both', objects, truncated, ...(nextCursor ? { cursor: nextCursor } : {}),
    ...(counts ? { counts } : {}),
    erasures: { pending: tombs.size, list: `/v1/${tenant}/ledger/erasures` } });
  });
});

/**
 * CW28, the ledger half of erasure (doc 22 §15). GET lists the pending
 * tombstones so an export consumer can apply them at once; POST writes one for
 * a visitor and empties that visitor's ring (the identity route calls the same function
 * after erasing the profile); POST .../rewrite runs the scheduled rewrite now,
 * as the nightly cron does. All authenticated; the list carries visitor ids.
 * Registered before /ledger/:id so the literal segment wins.
 */
decisionRoutes.get('/:tenant/ledger/erasures', operatorJwt(), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  return auditedSubjectRead(c, tenant, 'erasures', undefined, async () => {
  const tombs = await loadTombstones(c.env.STORAGE as unknown as R2Erasable, tenant);
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, tenant, retentionDays: retentionDays(c.env), pending: [...tombs.values()].sort((a, b) => b.erased_at - a.erased_at) });
  });
});
decisionRoutes.post('/:tenant/ledger/erasures', operatorJwt(), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const b: unknown = await c.req.json().catch(() => null);
  if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some(key => key !== 'visitorId')) return c.json({ ok: false, error: 'visitorId required' }, 400);
  const value = (b as { visitorId?: unknown }).visitorId, visitorId = typeof value === 'string' ? value.trim() : '';
  if (!HISTORY_VISITOR.test(visitorId)) return c.json({ ok: false, error: 'visitorId required' }, 400);
  const actor = (c as unknown as { get: (k: 'auth') => AuthContext | undefined }).get('auth')?.user?.sub ?? 'operator';
  return auditedSubjectOperation(c, tenant, 'ledger_erase', { kind: 'visitor', value: visitorId }, async report => {
    const res = await eraseVisitorLedger(c.env, tenant, visitorId, actor);
    report.result({ outcome: 'ledger_erase', ok: res.ok, ring: res.ring, complete: false, cutoff: res.tombstone.erased_at });
    return c.json({ ...res, tenant });
  });
});
decisionRoutes.post('/:tenant/ledger/erasures/rewrite', operatorJwt(), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  let b: unknown;
  try { const text = await c.req.text(); b = text.trim() ? JSON.parse(text) : {}; }
  catch { return c.json({ ok: false, error: 'invalid JSON body' }, 400); }
  if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some(key => key !== 'maxObjects')) return c.json({ ok: false, error: 'Invalid rewrite options' }, 400);
  const maxObjects = (b as { maxObjects?: unknown }).maxObjects;
  if (maxObjects !== undefined && (typeof maxObjects !== 'number' || !Number.isSafeInteger(maxObjects) || maxObjects < 1)) return c.json({ ok: false, error: 'Invalid rewrite options' }, 400);
  return auditedSubjectOperation(c, tenant, 'ledger_rewrite', { kind: 'tenant' }, async report => {
    const result = await rewriteTenantErasures(c.env, tenant, { retentionDays: retentionDays(c.env), ...(typeof maxObjects === 'number' ? { maxObjects } : {}) });
    if (result.tenant !== tenant) throw new Error('Rewrite receipt unavailable');
    report.result({ outcome: 'ledger_rewrite', complete: false, more: result.more, remaining: result.remaining, tombstones: result.tombstones,
      objects_opened: result.objects_opened, objects_rewritten: result.objects_rewritten, objects_deleted: result.objects_deleted,
      rows_removed: result.rows_removed, retired: result.retired });
    return c.json({ ok: true, ...result });
  });
});

/**
 * GET /v1/:tenant/ledger/:id[?stream=outcome|product-sort]
 * One record by id, straight from R2 with no index (doc 22 §3.4): the id names
 * the brand and the hour, the batch objects are named by the id range they hold.
 * Authenticated, because a record carries a visitor id. Behind by the queue lag
 * during a peak; exact afterwards.
 */
decisionRoutes.get('/:tenant/ledger/:id', operatorJwt(), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  const id = (c.req.param('id') ?? '').trim();
  if (!TENANT.test(tenant) || !validLedgerSelector(tenant, id)) return c.json({ ok: false, error: 'id must belong to the tenant in the path' }, 400);
  const selected = c.req.query('stream') ?? 'decision';
  if (!['decision', 'outcome', 'product-sort', 'behavior'].includes(selected)) return c.json({ ok: false, error: 'Invalid stream' }, 400);
  const stream = selected as LedgerStream;
  let witness: RetentionStamp | undefined;
  const response = await auditedSubjectRead(c, tenant, 'ledger', id, async bindSubject => {
  const found = await findById<CapturedRecord>(c.env.STORAGE as unknown as R2Like, id, stream);
  c.header('Cache-Control', 'no-store');
  if (!found) return c.json({ ok: false, error: stream === 'product-sort' ? 'not found, or persistence did not complete' : 'not found, or not yet written by the consumer' }, 404);
  if (!ownedLedgerRecord(found.record, tenant, id, stream)) return c.json({ ok: false, error: 'Ledger record unavailable' }, 503);
  await bindSubject(found.record.visitor_id);
  if (hidden(await loadTombstones(c.env.STORAGE as unknown as R2Erasable, tenant), found.record)) return c.json({ ok: false, error: 'erased at the visitor\'s request' }, 410);
  witness = structuredClone(requireRetention(c.env, found.record.retention?.ledger, tenant, 'ledger'));
  const record = Object.fromEntries(Object.entries(found.record).filter(([key]) => key !== DELIVERY_FIELD));
  // W21 E1.03 (ruling R118(7)): an outcome is delivered beside the provenance of
  // the DECISIONS it credits, so a join across a salt rotation is never empty.
  // The decision's own block is copied as it was stored — never re-derived from
  // today's published salt, which is the hazard R101(a) forbids — and an
  // outcome whose credited decision carries none, or that names no decision at
  // all, simply has nothing to add.
  const credited = stream === 'outcome' ? await creditedDecisionProvenance(c, tenant, found.record) : [];
  if (stream === 'outcome' && record.experiment === undefined && credited.length === 1 && credited[0]!.experiment) {
    record.experiment = credited[0]!.experiment;
  }
  return c.json({ ok: true, stream, key: found.key, record, ...(stream === 'outcome' ? { creditedDecisions: credited } : {}) });
  });
  if (response.ok && witness) try { requireRetention(c.env, witness, tenant, 'ledger'); }
  catch { c.header('Cache-Control', 'no-store'); return c.json({ ok: false, error: HISTORY_UNAVAILABLE }, 503); }
  return response;
});

/**
 * GET /v1/:tenant/replay/:id (doc 22 §12.3). Fetch the decision record, decide
 * again from the documents at the recorded revisions, the archived lift
 * snapshot and the inputs the record carries, and compare. Authenticated,
 * because the record carries a visitor id. Behind by the queue lag at a peak.
 */
decisionRoutes.get('/:tenant/replay/:id', operatorJwt(), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  const id = (c.req.param('id') ?? '').trim();
  if (!TENANT.test(tenant) || !validLedgerSelector(tenant, id)) return c.json({ ok: false, error: 'id must belong to the tenant in the path' }, 400);
  let witness: RetentionStamp | undefined;
  const response = await auditedSubjectRead(c, tenant, 'replay', id, async bindSubject => {
  const found = await findById<DecisionRecord>(c.env.STORAGE as unknown as R2Like, id, 'decision');
  c.header('Cache-Control', 'no-store');
  if (!found) return c.json({ ok: false, error: 'not found, or not yet written by the consumer' }, 404);
  if (!ownedLedgerRecord(found.record, tenant, id, 'decision')) return c.json({ ok: false, error: 'Ledger record unavailable' }, 503);
  await bindSubject(found.record.visitor_id);
  if (hidden(await loadTombstones(c.env.STORAGE as unknown as R2Erasable, tenant), found.record)) return c.json({ ok: false, error: 'erased at the visitor\'s request' }, 410);
  const result = await replayDecision(c.env, found.record);
  witness = structuredClone(requireRetention(c.env, found.record.retention?.ledger, tenant, 'ledger'));
  return c.json({ ok: result.ok, equal: result.equal, classification: result.classification, ...(result.reason ? { reason: result.reason } : {}), used: result.used, diff: result.diff, key: found.key, served: result.served, replayed: result.replayed });
  });
  if (response.ok && witness) try { requireRetention(c.env, witness, tenant, 'ledger'); }
  catch { c.header('Cache-Control', 'no-store'); return c.json({ ok: false, error: HISTORY_UNAVAILABLE }, 503); }
  return response;
});

/**
 * POST /v1/:tenant/models/reference (doc 22 §9). The reference implementation
 * of the model contract, as a service a data science team can call to see the
 * shape. Stateless; no visitor id crosses it. W34 E4 (F30): it carries the
 * operator authentication and tenant scope of the learn write routes — the
 * gate of POST learn/cycle, an operator token holding the resolved tenant's
 * grant in enforced mode — so no site key, shopper session or other tenant's
 * operator reaches it. No live decision calls it: the external-model policy is
 * off (src/learn/external.ts).
 */
decisionRoutes.post('/:tenant/models/reference', operatorJwt(), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const body = (await c.req.json().catch(() => null)) as Partial<ExternalRequest> | null;
  if (!body || typeof body !== 'object' || !Array.isArray(body.candidates)) return c.json({ ok: false, error: 'a contract request: affinity and candidates' }, 400);
  const req: ExternalRequest = {
    tenant, brand: typeof body.brand === 'string' ? body.brand : tenant, page: typeof body.page === 'string' ? body.page : '', slots: Array.isArray(body.slots) ? body.slots.map(String) : [],
    cell: (body.cell as ExternalRequest['cell']) ?? { channel: 'unknown', visit_bucket: 'unknown', region: null, affinity: null },
    affinity: body.affinity && typeof body.affinity === 'object' ? body.affinity : {},
    candidates: body.candidates.filter((x): x is ExternalRequest['candidates'][number] => Boolean(x) && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string').map((x) => ({ id: x.id, tags: x.tags && typeof x.tags === 'object' ? x.tags : {} })),
  };
  return c.json(referenceScore(req));
});

/**
 * GET /v1/:tenant/lift/history?slot=[&brand=][&page=]: every archived snapshot version for the slot (doc 22 §12.2).
 * W26 R2: a page-scoped placement's archive is its own page's; `page=` names it.
 */
decisionRoutes.get('/:tenant/lift/history', operatorWrites(), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  const slot = (c.req.query('slot') ?? '').trim();
  if (!TENANT.test(tenant) || !isCatalogueName(slot)) return c.json({ ok: false, error: 'tenant slug and slot' }, 400);
  const brand = (c.req.query('brand') ?? '').trim() || tenant;
  const placement = placementOf(await publishedSlotPages(c, tenant), slot, c.req.query('page'));
  if (!placement.ok) { c.header('Cache-Control', 'no-store'); return c.json(placementRefusal(placement), 400); }
  const { page } = placement;
  const prefix = `lift/${tenant}/${brand}/${placementSlot(slot, page)}/`;
  const versions: Array<{ version: number; size: number; uploaded: string }> = [];
  let cursor: string | undefined;
  do {
    const page = await c.env.STORAGE.list({ prefix, ...(cursor ? { cursor } : {}), limit: 1000 });
    for (const o of page.objects) {
      const v = Number(o.key.slice(prefix.length).replace(/\.json$/, ''));
      if (v > 0) versions.push({ version: v, size: o.size, uploaded: o.uploaded instanceof Date ? o.uploaded.toISOString() : String(o.uploaded) });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  versions.sort((a, b) => b.version - a.version);
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, tenant, brand, slot, ...(page ? { page } : {}), versions });
});

/**
 * POST /v1/:tenant/learn/items/reset (doc 22 §12.2): discard one item's evidence in one slot and start
 * again from the prior. The next snapshot publishes at once; the learn document gets a revision whose
 * content is unchanged and whose note records who reset what, so the audit trail shows it.
 */
decisionRoutes.post('/:tenant/learn/recovery', operatorJwt(), async (c) => {
  const tenant = String(c.get('tenant'));
  if (c.req.param('tenant') !== tenant || new URL(c.req.url).search !== '') return c.json({ ok: false, error: 'Invalid recovery scope' }, 400);
  let text = '', size = 0;
  const reader = c.req.raw.body?.getReader();
  if (!reader) return c.json({ ok: false }, 400);
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
    for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
      if (size > 4096) { await reader.cancel(); return c.json({ ok: false }, 413); } text += decoder.decode(next.value, { stream: true }); }
    text += decoder.decode();
  } catch { return c.json({ ok: false }, 400); } finally { reader.releaseLock(); }
  let b: Record<string, unknown>;
  try { b = JSON.parse(text); } catch { return c.json({ ok: false }, 400); }
  const component = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_.-]{1,200}$/.test(v);
  if (!b || Array.isArray(b) || typeof b !== 'object' || !['status', 'repair'].includes(String(b.operation)) || !['stats', 'ring'].includes(String(b.kind))
    || Object.keys(b).some(key => !['operation', 'kind', 'slot', 'brand', 'page', 'visitorId', 'digest', 'generation', 'operationId', 'intent'].includes(key))
    || b.kind === 'stats' && (!component(b.slot) || !component(b.brand) || b.visitorId !== undefined || b.page !== undefined && !isCatalogueName(b.page))
    || b.kind === 'ring' && (!component(b.visitorId) || b.slot !== undefined || b.brand !== undefined || b.page !== undefined)) return c.json({ ok: false }, 400);
  if (b.operation === 'repair' && (typeof b.digest !== 'string' || !/^[a-f0-9]{64}$/.test(b.digest) || !Number.isSafeInteger(b.generation) || Number(b.generation) < 0
    || typeof b.operationId !== 'string' || !/^[a-f0-9]{32}$/.test(b.operationId)
    // W23 H1.01 (document 35 §5 row W23 :425 "Rebuild or explicitly reset
    // damaged item and slot state"): statistics have two repair intents. The
    // merge-and-keep one, `coarsen`, and the explicit `reset` for damaged
    // counters that cannot be merged back into honesty — the same audited,
    // human-operator route, the same digest/generation precondition, the same
    // two audit phases. The ring's only intent is still `compact`.
    || !(b.kind === 'stats' ? b.intent === 'coarsen' || b.intent === 'reset' : b.intent === 'compact'))) return c.json({ ok: false }, 400);
  if (b.operation === 'status' && ['digest', 'generation', 'operationId', 'intent'].some(key => b[key] !== undefined)) return c.json({ ok: false }, 400);
  const kind = b.kind as 'stats' | 'ring', operation = b.operation as 'status' | 'repair';
  // W26 R2: recovery addresses one statistics OBJECT exactly, as it always has:
  // `page` names a page-scoped placement's object, and without it the target is
  // the page-less object — which, for a slot name a retained catalogue carries
  // on more than one page, is the object its pages pooled into before W26 R2
  // and is still a legitimate target to inspect or repair.
  const target = kind === 'stats' ? statsName(tenant, b.brand as string, b.slot as string, b.page as string | undefined) : ringName(tenant, b.visitorId as string);
  return auditedLearningRecovery(c, tenant, operation, kind, target,
    operation === 'repair' ? { digest: b.digest as string, generation: b.generation as number } : {}, async () => {
      const ns = kind === 'stats' ? c.env.LEARN_STATS : c.env.DECISION_RING;
      if (!ns) return c.json({ ok: false, error: 'Learning object unavailable' }, 503);
      return ns.get(ns.idFromName(target)).fetch('https://learn/' + (operation === 'repair' ? 'recover' : 'recovery'), {
        method: 'POST', body: JSON.stringify({ ...b, tenant }),
      });
    });
});

decisionRoutes.post('/:tenant/learn/items/reset', operatorJwt(), async (c) => {
  const tenant = c.get('tenant'), user = c.get('auth')?.user;
  c.header('Cache-Control', 'no-store');
  if (c.req.param('tenant') !== tenant || new URL(c.req.url).search !== '' || !user || user.type !== 'access'
    || !hasOperatorGrant(c.env, user.sub, tenant, c.get('auth'))) return c.json({ ok: false, error: 'Current tenant operator required' }, 403);
  let b: { slot?: string; item?: string; brand?: string; page?: string } | null, receipt, page: string | undefined;
  const authorize = async () => {
    let allowed = false;
    await operatorJwt()(c, async () => {
      const current = c.get('auth').user;
      if (current?.sub !== user.sub || current.type !== 'access' || !Number.isSafeInteger(current.exp) || current.exp! * 1000 <= Date.now()
        || !hasOperatorGrant(c.env, current.sub, tenant, c.get('auth'))) throw new PublicationError('Current human operator required', 403, 'operator_required');
      allowed = true;
    });
    if (!allowed) throw new PublicationError('Current human operator required', 403, 'operator_required');
  };
  try {
    const meta = publicationMeta(c.req.raw.headers, user.sub);
    meta.authorize = authorize;
    b = await c.req.json();
    if (!b || Object.keys(b).some(key => !['slot', 'item', 'brand', 'page'].includes(key))
      || !isCatalogueName(b.slot) || typeof b.item !== 'string' || !b.item || b.item.length > 256
      || b.brand !== undefined && (typeof b.brand !== 'string' || !b.brand || b.brand.length > 200)
      || b.page !== undefined && typeof b.page !== 'string') return c.json({ ok: false, error: 'Invalid reset target' }, 400);
    if (!c.env.LEARN_STATS) return c.json({ ok: false, error: 'LEARN_STATS binding absent' }, 503);
    // W26 R2: the reset discards evidence in ONE placement's object, named by its page where the catalogue says so.
    const placement = placementOf(await publishedSlotPages(c, tenant), b.slot, b.page);
    if (!placement.ok) return c.json(placementRefusal(placement), 400);
    page = placement.page;
    const request = { type: 'item-reset', item: b.item, slot: b.slot, brand: b.brand ?? tenant, ...(page ? { page } : {}) };
    // Publish the retained reset INTENT first. Exact retry resolves this original
    // operation, never reads a fresh base or replaces intervening configuration.
    const result = await publish(c.env, LEARN_KIND, tenant, request, { ...meta, note: 'item reset admitted' }, current => current);
    if (!result.ok) return c.json(result, 422);
    receipt = result.revision;
  } catch (error) {
    if (error instanceof PublicationError) return c.json({ ok: false, error: error.message, code: error.code }, error.status);
    return c.json({ ok: false, error: 'Reset admission unavailable' }, 503);
  }
  try {
    await authorize();
    const stub = c.env.LEARN_STATS!.get(c.env.LEARN_STATS!.idFromName(statsName(tenant, b!.brand ?? tenant, b!.slot!, page)));
    const response = await stub.fetch('https://learn/reset-item', { method: 'POST', body: JSON.stringify({
      item: b!.item, tenant, slot: b!.slot, brand: b!.brand ?? tenant, ...(page ? { page } : {}), publication: receipt.publication,
      operationId: c.req.header('Idempotency-Key'),
    }) });
    const result = await response.json() as { ok?: unknown; item?: unknown; had?: unknown; resetCompleted?: unknown; publicationOutcome?: unknown };
    invalidateLiftCache();
    if (!response.ok || result.ok !== true || result.item !== b!.item || typeof result.had !== 'boolean') {
      return c.json({ ok: false, error: 'Reset continuation acknowledgement unavailable', resetOutcome: 'unknown',
        revision: receipt.revision, publication: receipt.publication, operationId: c.req.header('Idempotency-Key') }, 503);
    }
    return c.json({ ok: true, had: result.had, resetCompleted: true, publicationOutcome: result.publicationOutcome,
      revision: receipt.revision, publication: receipt.publication });
  } catch {
    invalidateLiftCache();
    return c.json({ ok: false, error: 'Reset continuation acknowledgement unavailable', resetOutcome: 'unknown',
      revision: receipt.revision, publication: receipt.publication, operationId: c.req.header('Idempotency-Key') }, 503);
  }
});

/**
 * POST /v1/:tenant/learn/publish { slot, brand? }: publish the slot's lift snapshot now, as the object's
 * alarm does within the minute. For an operator who has just changed a dial, and for the acceptance run.
 */
decisionRoutes.post('/:tenant/learn/publish', operatorJwt(), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const b = (await c.req.json().catch(() => null)) as { slot?: string; brand?: string; page?: string } | null;
  if (!isCatalogueName(b?.slot)) return c.json({ ok: false, error: SLOT_REQUIRED }, 400);
  const brand = (b.brand ?? '').trim() || tenant;
  if (!c.env.LEARN_STATS) return c.json({ ok: false, error: 'LEARN_STATS binding absent on this stamp' }, 503);
  c.header('Cache-Control', 'no-store');
  // W26 R2: one placement's object, named by its page where the catalogue says so.
  const placement = placementOf(await publishedSlotPages(c, tenant), b.slot, typeof b.page === 'string' ? b.page : undefined);
  if (!placement.ok) return c.json(placementRefusal(placement), 400);
  const { page } = placement;
  try {
    const stub = c.env.LEARN_STATS.get(c.env.LEARN_STATS.idFromName(statsName(tenant, brand, b.slot, page)));
    const response = await stub.fetch('https://learn/publish', { method: 'POST' });
    const res = await response.json() as { ok?: unknown; published?: unknown; snapshot?: { tenant?: unknown; brand?: unknown; slot?: unknown; version?: unknown } | null } | null;
    // P42 (R-P78, decision D1): the one refusal passed through is the object's
    // pooled refusal, and only when its answer is exactly that (503, `{ ok: false,
    // error, stale }`, a well-formed marker and the object's own sentence for it).
    // The words answered are composed here from the checked marker, so no other
    // downstream text is ever echoed; every other refusal stays the one below.
    const stale = response.status === 503 ? staleRefusalIn(res) : null;
    if (stale) { invalidateLiftCache(); return c.json({ ok: false, error: staleRefusalOf(stale), stale }, 503); }
    // P49 (R-P78, D1): likewise the object's refusal after a learn republish, only
    // when its answer is exactly that (503, `{ ok: false, error, republished }`, a
    // well-formed member naming this placement and the object's own sentence for
    // it); the words are composed here from the checked member and version.
    const named = response.status === 503 ? republishedRefusalIn(res, tenant) : null;
    if (named && named.republished.slot === b.slot && named.republished.page === page) {
      invalidateLiftCache();
      return c.json({ ok: false, error: republishedRefusalOf(named.republished, tenant, named.version), republished: named.republished }, 503);
    }
    if (!response.ok || !res || res.ok !== true || typeof res.published !== 'boolean'
      || (res.published ? !res.snapshot || res.snapshot.tenant !== tenant || res.snapshot.brand !== brand || res.snapshot.slot !== b.slot
        || !Number.isSafeInteger(res.snapshot.version) || (res.snapshot.version as number) <= 0 : res.snapshot !== null)) throw new Error();
    invalidateLiftCache();
    // Acknowledged archive then KV write, not global KV propagation or client receipt.
    return c.json({ ok: true, tenant, brand, slot: b.slot, ...(page ? { page } : {}), published: res.published, snapshot: res.snapshot });
  } catch {
    invalidateLiftCache();
    return c.json({ ok: false, error: 'statistics acknowledgement unavailable' }, 503);
  }
});

/**
 * POST /v1/:tenant/learn/generation { slot, brand?, reward?, objective?, rebuildFrom? }
 *
 * W24 G1.02 (document 35 §5 row W24 :426 "authorized generation transition with
 * no stale oscillation or mixed cached snapshots … reset as explicit containment
 * or trustworthy rebuild/promote from retained events"; F19 §7; the authorized
 * rebuild/promote left OPEN in HANDOFF-2026-09-16 :228).
 *
 * The ACCUMULATION semantics of a slot — what a counter means: the objective, the
 * reward it is filtered to — can never change on an ordinary write. The statistics
 * object refuses that with 409 so counters built under one objective are never
 * silently reinterpreted under another. This is the one authorized way past it,
 * and it is a transition rather than a reinterpretation: the superseded published
 * version is archived under its own version, the counters are discarded (or
 * rebuilt from one retained day), a fresh generation starts, and it is published
 * at once to the key the serving path reads so no isolate goes on serving the
 * generation it superseded.
 *
 * WHO may authorize it in production, and on what evidence, is an owner decision
 * (D09, W24.P1.01). Until it is settled this carries the operator credential the
 * other learning operations carry and names no production approver of its own.
 */
const TRANSITION_REWARDS = new Set(['click', 'dwell', 'video_complete', 'wishlist', 'add_to_bag', 'purchase', 'custom']);
decisionRoutes.post('/:tenant/learn/generation', operatorJwt(), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  c.header('Cache-Control', 'no-store');
  const b = (await c.req.json().catch(() => null)) as { slot?: unknown; brand?: unknown; page?: unknown; reward?: unknown; objective?: unknown; rebuildFrom?: unknown } | null;
  if (!b || typeof b !== 'object' || Array.isArray(b)
    || Object.keys(b).some(key => !['slot', 'brand', 'page', 'reward', 'objective', 'rebuildFrom'].includes(key))
    || (b.page !== undefined && typeof b.page !== 'string')
    || !isCatalogueName(b.slot)
    || (b.brand !== undefined && (typeof b.brand !== 'string' || !b.brand || b.brand.length > 200))
    || (b.reward !== undefined && (typeof b.reward !== 'string' || !TRANSITION_REWARDS.has(b.reward)))
    || (b.objective !== undefined && (typeof b.objective !== 'string' || !['unit', 'revenue', 'margin'].includes(b.objective)))
    || (b.rebuildFrom !== undefined && (typeof b.rebuildFrom !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.rebuildFrom)))
    // A transition that names nothing would discard a generation's evidence for
    // no declared change, which is a reset and has its own audited operation.
    || (b.reward === undefined && b.objective === undefined && b.rebuildFrom === undefined)) {
    return c.json({ ok: false, error: 'slot, and at least one of reward, objective or rebuildFrom' }, 400);
  }
  const brand = (b.brand ?? '').trim() || tenant;
  if (!c.env.LEARN_STATS) return c.json({ ok: false, error: 'LEARN_STATS binding absent on this stamp' }, 503);
  const supplied = (c.req.header('Idempotency-Key') ?? '').trim();
  if (supplied && !/^[a-f0-9]{32}$/.test(supplied)) return c.json({ ok: false, error: 'Idempotency-Key must be 32 hexadecimal characters' }, 400);
  const operationId = supplied || crypto.randomUUID().replace(/-/g, '');
  // W26 R2: the transition restarts ONE placement's object, named by its page where the catalogue says so.
  const placement = placementOf(await publishedSlotPages(c, tenant), b.slot, b.page as string | undefined);
  if (!placement.ok) return c.json(placementRefusal(placement), 400);
  const { page } = placement;
  try {
    const stub = c.env.LEARN_STATS.get(c.env.LEARN_STATS.idFromName(statsName(tenant, brand, b.slot, page)));
    const response = await stub.fetch('https://learn/transition', { method: 'POST', body: JSON.stringify({
      tenant, brand, slot: b.slot, ...(page ? { page } : {}), operationId,
      ...(b.reward !== undefined ? { reward: b.reward } : {}), ...(b.objective !== undefined ? { objective: b.objective } : {}),
      ...(b.rebuildFrom !== undefined ? { rebuildFrom: b.rebuildFrom } : {}),
    }) });
    const res = await response.json() as { ok?: unknown; generation?: unknown; restartedAt?: unknown; archivedVersion?: unknown;
      publicationOutcome?: unknown; rebuiltFrom?: unknown } | null;
    // Every isolate's per-request lift cache is dropped here for the same reason
    // publication drops it: what it holds is a generation that no longer stands.
    invalidateLiftCache();
    // P50 (R-P78, D1): the one refusal passed through is the object's refusal of a
    // transition that does not adopt a member a learn republish changed, only when
    // its answer is exactly that (409, `{ ok: false, error, notAdopted }`, a
    // well-formed member naming this placement and the object's own sentence for
    // it); the words are composed here from the checked member, and every other
    // refusal stays the one below.
    const notAdopted = response.status === 409 ? notAdoptedRefusalIn(res, tenant) : null;
    if (notAdopted && notAdopted.slot === b.slot && notAdopted.page === page) {
      return c.json({ ok: false, error: notAdoptedRefusalOf(notAdopted, tenant), notAdopted, operationId }, 409);
    }
    if (!response.ok || !res || res.ok !== true || typeof res.generation !== 'string' || !res.generation
      || !Number.isSafeInteger(res.restartedAt) || (res.archivedVersion !== null && !Number.isSafeInteger(res.archivedVersion))) {
      return c.json({ ok: false, error: 'statistics acknowledgement unavailable', operationId }, response.status === 409 ? 409 : 503);
    }
    return c.json({ ok: true, tenant, brand, slot: b.slot, ...(page ? { page } : {}), operationId, generation: res.generation,
      restartedAt: res.restartedAt, archivedVersion: res.archivedVersion ?? null,
      publicationOutcome: res.publicationOutcome ?? 'unknown', ...(res.rebuiltFrom ? { rebuiltFrom: res.rebuiltFrom } : {}) });
  } catch {
    invalidateLiftCache();
    return c.json({ ok: false, error: 'statistics acknowledgement unavailable', operationId }, 503);
  }
});

/**
 * POST /v1/:tenant/learn/report (doc 22 §4.2, §7, §10): the day's ledger under the learning policy and
 * any reporting policies, side by side; what explored; the holdout arms. Body: { date, brand?, policies? }.
 * GET reads the last report built for the day. Aggregates only; no visitor id in the result.
 */
const reportUtf8 = new TextEncoder();
async function reportBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.body) throw new ReportInputError();
  const reader = request.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  let size = 0, text = '';
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > REPORT_LIMITS.requestBytes) throw new ReportBudgetExceeded('requestBytes', REPORT_LIMITS.requestBytes, size);
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ReportInputError();
    return value as Record<string, unknown>;
  } catch (error) {
    try { await reader.cancel(); } catch { /* retain original refusal */ }
    throw error instanceof ReportBudgetExceeded ? error : new ReportInputError();
  } finally { reader.releaseLock(); }
}

decisionRoutes.post('/:tenant/learn/report', operatorJwt(), async (c) => {
  c.header('Cache-Control', 'no-store');
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  try {
    const b = await reportBody(c.req.raw) as { date?: string; brand?: string; policies?: unknown };
    if ((b.date !== undefined && typeof b.date !== 'string') || (b.brand !== undefined && typeof b.brand !== 'string')
      || (b.policies !== undefined && !Array.isArray(b.policies))) throw new ReportInputError();
    const date = (b.date ?? new Date().toISOString().slice(0, 10)).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ ok: false, error: 'date=YYYY-MM-DD' }, 400);
    const brand = (b.brand ?? '').trim() || tenant;
    if (!brand || brand.length > 256 || reportUtf8.encode(brand).length > 256 || Object.hasOwn(Object.prototype, brand)) throw new ReportInputError();
    let policies: ReportPolicy[] | null = null;
    const defaultWindows = new Set<ReportPolicy>();
    if (Array.isArray(b.policies)) {
      if (b.policies.length + 1 > REPORT_LIMITS.policies) throw new ReportBudgetExceeded('policies', REPORT_LIMITS.policies, b.policies.length + 1);
      policies = [];
      for (const p of b.policies as Array<Record<string, unknown>>) {
        if (!p || typeof p !== 'object' || Array.isArray(p)) throw new ReportInputError();
        const okScope = p.scope === 'session' || p.scope === 'visitor', okMatch = p.match === 'direct' || p.match === 'any', okCredit = p.credit === 'last' || p.credit === 'first';
        if (typeof p.name !== 'string' || p.name.length > 256 || reportUtf8.encode(p.name).length > 256 || !okScope || !okMatch || !okCredit) throw new ReportInputError();
        const windowsMs: Record<string, number> = {};
        if (p.windowsMs !== undefined) {
          if (!p.windowsMs || typeof p.windowsMs !== 'object' || Array.isArray(p.windowsMs)) throw new ReportInputError();
          for (const [k, v] of Object.entries(p.windowsMs)) {
            if (Object.hasOwn(Object.prototype, k) || typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new ReportInputError();
            if (v > 0) windowsMs[k] = v; // retain POST's historical zero-entry omission
          }
        }
        const policy: ReportPolicy = { name: p.name.slice(0, 40), scope: p.scope as 'session' | 'visitor', match: p.match as 'direct' | 'any', credit: p.credit as 'last' | 'first', windowsMs };
        policies.push(policy); if (!Object.keys(windowsMs).length) defaultWindows.add(policy);
      }
      validateReportPolicies(policies);
    }
    const learn = await readConfig<LearnConfig>(c, LEARN_KIND, tenant);
    for (const policy of defaultWindows) policy.windowsMs = learn.policy?.windowsMs ?? {};
    // W25 R4: a day built from the ledger records builds its grids with the
    // tenant's prior document, as the live table does, and says which revision.
    const priors = await publishedReportPriors(c, tenant, learn);
    // Doc 31 §3: the day is the sum of its hour aggregates; only custom policies, or a day from before the
    // fold existed, are computed from the records, and such a day must be one a request can read.
    //
    // W22 D1.03 (F16 §5(j)): at-least-once delivery can put two genuinely
    // DIFFERENT rows under one logical id, and the reader refuses the day
    // rather than merge them. A conflict that is not yet filed is FILED here,
    // durably, in this tenant's own scope and named by that id, and the refusal
    // carries the id so an operator can act on it. A conflict that is already
    // filed excludes its row and is counted on the day, so the day reads again.
    // Bounded: a request files at most this many, then answers with the last.
    const resolved = new Set<string>();
    let report: Awaited<ReturnType<typeof runDayReport>> | null = null, conflict: ReportRowConflict | null = null;
    for (let attempt = 0; attempt <= REPORT_CONFLICTS; attempt++) {
      try {
        report = await runDayReport(c.env.STORAGE as unknown as Parameters<typeof runDayReport>[0], { tenant, brand, date }, learn, policies, Date.now(), { maxObjects: REPORT_MAX_OBJECTS, priors }, c.env, resolved);
        conflict = null; break;
      } catch (error) {
        if (!(error instanceof ReportRowConflict)) throw error;
        conflict = error;
        if (resolved.has(conflictKey(error.stream, error.id))) throw error;   // filed but still refused: do not loop
        if (await readConflictFiled(c.env, error.stream, error.id)) { resolved.add(conflictKey(error.stream, error.id)); continue; }
        await captureReadConflict(c.env, error.stream, error.id, error.row as unknown as Parameters<typeof captureReadConflict>[3]);
        break;
      }
    }
    if (conflict) return c.json({ ok: false, error: conflict.message, code: conflict.code,
      conflict: { stream: conflict.stream, id: conflict.id } }, 409);
    return c.json({ ok: true, report });
  } catch (e) {
    if (e instanceof ReportBudgetExceeded) return c.json({ ok: false, error: e.message, code: e.code, budget: e.budget, limit: e.limit, observed: e.observed,
      ...(e instanceof ReportTooLarge ? { objects: e.objects, max: e.max } : {}) }, 413);
    if (e instanceof ReportInputError) return c.json({ ok: false, error: e.message }, 400);
    if (e instanceof ReportUnavailableError) return c.json({ ok: false, error: e.message }, 503);
    throw e;
  }
});
/**
 * CW34 (delivery lane, named in plan 21): the day reports over a window, pooled per
 * slot and arm as attribution diagnostics. Reads reports already built;
 * missing reports and known incomplete days remain visible.
 *
 * W21 C1.05 (F25 §5.1, ruling R112(d)): both report READS carry the same gate as
 * the build POST beside them, `operatorJwt()`, in every deployment auth mode.
 * `operatorWrites()` let an open-mode deployment answer per-arm conversion rates,
 * intervals and target standing to any caller who could view source on the
 * storefront, while the console's own error handler already expected 401/403
 * here. The credential is the one the build POST already accepts — a service or
 * human operator token — never an account session.
 */
decisionRoutes.get('/:tenant/learn/report/window', operatorJwt(), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  const from = (c.req.query('from') ?? '').trim();
  const to = (c.req.query('to') ?? '').trim();
  if (!TENANT.test(tenant) || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return c.json({ ok: false, error: 'tenant slug, from=YYYY-MM-DD and to=YYYY-MM-DD' }, 400);
  const brand = (c.req.query('brand') ?? '').trim() || tenant;
  c.header('Cache-Control', 'no-store');
  try {
    const report = await windowReport(c.env.STORAGE as unknown as Parameters<typeof windowReport>[0], { tenant, brand, from, to });
    reportPayloadJson({ ok: true, report });
    return c.json({ ok: true, report });
  } catch (error) {
    if (error instanceof WindowRangeError) return c.json({ ok: false, error: error.message }, 400);
    if (error instanceof ReportBudgetExceeded) return c.json({ ok: false, error: error.message, code: error.code, budget: error.budget, limit: error.limit, observed: error.observed }, 413);
    if (error instanceof ReportInputError) return c.json({ ok: false, error: error.message }, 400);
    if (error instanceof ReportUnavailableError) return c.json({ ok: false, error: error.message }, 503);
    throw error;
  }
});
decisionRoutes.get('/:tenant/learn/report', operatorJwt(), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  const date = (c.req.query('date') ?? '').trim();
  if (!TENANT.test(tenant) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ ok: false, error: 'tenant slug and date=YYYY-MM-DD' }, 400);
  const brand = (c.req.query('brand') ?? '').trim() || tenant;
  c.header('Cache-Control', 'no-store');
  try {
    const view = await readReportView(c.env.STORAGE, { tenant, brand, date }, {
      slot: c.req.query('slot'), limit: c.req.query('limit'), cursor: c.req.query('cursor'), revision: c.req.query('revision'),
    });
    if (view === null) return c.json({ ok: false, error: 'no report built for that day yet' }, 404);
    reportPayloadJson({ ok: true, ...view });
    return c.json({ ok: true, ...view });
  } catch (error) {
    if (error instanceof ReportRevisionChanged) return c.json({ ok: false, error: error.message, code: 'report_changed' }, 409);
    if (error instanceof ReportBudgetExceeded) return c.json({ ok: false, error: error.message, code: error.code, budget: error.budget, limit: error.limit, observed: error.observed }, 413);
    if (error instanceof ReportInputError) return c.json({ ok: false, error: error.message }, 400);
    if (error instanceof ReportUnavailableError) return c.json({ ok: false, error: error.message }, 503);
    throw error;
  }
});
