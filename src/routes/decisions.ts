// src/routes/decisions.ts
// CW4 — the content decision surface (scope appendix §2.3, API-first delivery).
//
//   GET /v1/:tenant/decisions/snapshot?page=home&visitorId=…[&brand=&channel=]
//
// Returns the delivery contract the customer's front end paints (`decisions`,
// one per slot position, addressed by their own content id) and the ledger
// records the outcome-learning design records (`records`, doc 22 §3.1). Reads
// only; never cached; SDK-key authentication arrives with CW10.

import { Hono } from 'hono';
import { assertShopperSelectors, parseShopperContext } from '@/identity/sessionAuthority';
import type { Env } from '@/types/env';
import { syntheticOperation } from '@/ops/synthetic';
import { serveContentDecisions } from '@/content/service';
import { requireRetention, type RetentionStamp } from '@/retention';
import { ENTRY_QUERY_LIMIT, validEntry, type ChannelSignals } from '@/services/visit';
import { NAMESPACE_MARKER, type TenantVariables } from '@/tenancy/tenant';
import { tenantConfig } from '@/tenancy/middleware';
import { enqueueDecisions } from '@/ledger/enqueue';
import { findById, isLedgerMessage, type R2Like } from '@/ledger/writer';
import { eraseVisitorLedger, hidden, loadTombstones, retentionDays, rewriteTenantErasures, type R2Erasable } from '@/ledger/erasure';
import type { DecisionRecord } from '@/content/types';
import { isLearningKey, parseId, type CapturedRecord, type LedgerStream } from '@/ledger/records';
import { validCarrier, DELIVERY_FIELD } from '@/ledger/delivery';
import { readTrend, regionKeyOf, rollupTenant } from '@/reflex/regionTrend';
import { liftArchiveKey, liftKey, ringName, statsName } from '@/learn/fan';
import { decideProposal, PROPOSALS_KIND, runCycle, type ProposalsDoc } from '@/learn/cycle';
import { readMonitor, runMonitor } from '@/ops/monitor';
import type { DocumentKind } from '@/config/versionedStore';
import { pinPublication, readPinnedPublication, publicationMeta, PublicationError, publish, type PublicationPin } from '@/config/publication';
import { replayDecision } from '@/learn/replay';
import { conflictKey, exportReconciliation, readReportView, reportPayloadJson, REPORT_MAX_OBJECTS, REPORT_LIMITS, ReportBudgetExceeded, ReportInputError, ReportRowConflict, ReportUnavailableError, ReportRevisionChanged, validateReportPolicies, type ReportPolicy } from '@/learn/report';
import { captureReadConflict, readConflictFiled } from '@/ledger/quarantine';
/** W22 D1.03: conflicts one read may file before it answers with the last of them. */
const REPORT_CONFLICTS = 8;
import { ReportTooLarge, runDayReport } from '@/learn/hourly';
import { datesBetween, WindowRangeError, windowReport } from '@/measure/window';
import { LEARN_KIND, CONTENT_KIND, SLOTS_KIND } from '@/content/kinds';
import { decodeCursor, encodeCursor, exploringRows, pageOf, pageRows, rowsOf, slotsIndex, DEFAULT_LIMIT, MAX_LIMIT, SORT_KEYS, type RowLevel, type SortKey } from '@/learn/rows';
import { receiptOf } from '@/learn/receipts';
import { emptySlotGovernance, readSlotGovernance } from '@/learn/slotGovernance';
import { queueOf } from '@/learn/queue';
import { DEFAULT_EXPLORE } from '@/learn/explore';
import type { ContentCatalog, EnrollmentProvenance, SlotCatalog } from '@/content/types';
import type { LiftSnapshot } from '@/learn/stats';
import { invalidateLiftCache } from '@/content/service';
import { readEnrollmentHealth } from '@/content/holdout';
import type { LearnConfig } from '@/content/types';
import { referenceScore, type ExternalRequest } from '@/learn/external';
import type { AuthContext } from '@/middleware/auth';
import { hasOperatorGrant, operatorJwt } from '@/middleware/operatorAuth';
import { operatorWrites } from '@/middleware/edgeAccess';
import { requireShopper, shopperPrincipal, capabilityToken, SessionAccessError } from '@/identity/sessionCapability';
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
 * writing anything — and the retained statuses were never verified as applied
 * (`GET learn/proposals` publishes the same `verified: false`). Any answer that
 * reports proposal work carries these two facts beside it, so a count is never
 * read as an action a person can take today. Stamped, not derived from
 * configuration, because no configuration a tenant can set makes the mutation
 * available: the routes below refuse unconditionally (F24 §5, document 35 §5
 * W29). It is stated here, once, beside the constants the same routes share.
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
 * GET /v1/:tenant/lift/rows?slot=&brand=&level=pooled|cells&item=&q=&sort=&dir=&limit=&cursor= (doc 28 §4).
 * The grid as pages: one pooled row per item, or one item's cells; filtered, sorted and cut by the
 * server, with the catalog's names and the merchandiser's controls joined on. The cursor names the
 * snapshot version it was cut from, so a page never straddles two snapshots; when the snapshot has
 * moved on, the answer is 409 and the application starts the listing again. Same access as /lift.
 */
decisionRoutes.get('/:tenant/lift/rows', operatorWrites(), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const slot = (c.req.query('slot') ?? '').trim();
  if (!slot) return c.json({ ok: false, error: 'slot required' }, 400);
  const brand = (c.req.query('brand') ?? '').trim() || tenant;
  const cur = decodeCursor(c.req.query('cursor'));
  if (c.req.query('cursor') && !cur) return c.json({ ok: false, error: 'cursor not recognised' }, 400);
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
  try { snapshot = (await c.env.CACHE.get(liftKey(tenant, brand, slot), 'json')) as LiftSnapshot | null; } catch { snapshot = null; }
  c.header('Cache-Control', 'no-store');
  if (!snapshot) return c.json({ ok: true, tenant, brand, slot, version: 0, published: false, level, total: 0, offset: 0, limit, rows: [], cursor: null });
  if (cur && cur.v !== snapshot.version) return c.json({ ok: false, error: 'the snapshot has moved on since this page was cut; start the listing again', version: snapshot.version }, 409);
  const [catalog, learn] = await Promise.all([readConfig<ContentCatalog>(c, CONTENT_KIND, tenant), readConfig<LearnConfig>(c, LEARN_KIND, tenant)]);
  const names = new Map(catalog.pieces.map((p) => [p.id, { customerContentId: p.customerContentId, title: p.title }]));
  const rows = rowsOf(snapshot, names, learn.slots?.[slot]?.items, level, item);
  const page = pageRows(rows, { level, item, q, sort, dir, offset, limit });
  const cursor = page.next === null ? null : encodeCursor({ v: snapshot.version, o: page.next, level, item, q, sort, dir, limit });
  return c.json({ ok: true, tenant, brand, slot, version: snapshot.version, published: true, publishedAt: snapshot.publishedAt, reward: snapshot.reward, objective: snapshot.objective ?? 'unit', measurementBasis: snapshot.measurementBasis ?? 'served-v1', n0: snapshot.n0, nMin: snapshot.nMin, level, item: item ?? null, q: q ?? null, sort: sort ?? 'lift', dir: dir ?? (sort === 'item' || sort === 'name' || sort === 'key' ? 'asc' : 'desc'), total: page.total, offset: page.offset, limit: page.limit, rows: page.rows, cursor });
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
 * GET /v1/:tenant/learn/slots?brand=&q=&evidence=1 (doc 28 §4): every slot on every page, grouped by
 * page, with what is configured on it and how many pieces are eligible now; `q` narrows by slot or
 * page name; `evidence=1` adds what each slot has learned so far (items, events, when published),
 * for up to 200 slots. The application's picker and its overview.
 */
decisionRoutes.get('/:tenant/learn/slots', operatorWrites(), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const brand = (c.req.query('brand') ?? '').trim() || tenant;
  const q = (c.req.query('q') ?? '').trim() || undefined;
  const now = Date.now();
  const [slots, catalog, learn] = await Promise.all([readConfig<SlotCatalog>(c, SLOTS_KIND, tenant), readConfig<ContentCatalog>(c, CONTENT_KIND, tenant), readConfig<LearnConfig>(c, LEARN_KIND, tenant)]);
  const index = slotsIndex(slots, catalog, learn, now, q);
  if (c.req.query('evidence') === '1') {
    // W20 G2 (R83, R86(a)): beside what each slot has LEARNED, what the decision
    // path REFUSED for it — the dead pins and the pinned slots that could not
    // fill their take, per slot, since the horizon the block states. One read of
    // one tenant document, joined under the same flag and the same budget as the
    // evidence it sits next to, and never silent: a slot with nothing to report
    // carries zeros, not an absent member.
    const governance = await readSlotGovernance(c.env, tenant, now);
    let budget = 200;
    for (const page of index.pages) for (const s of page.slots) {
      if (budget-- <= 0) { s.evidence = null; continue; }
      s.governance = governance.bySlot.get(s.slot) ?? emptySlotGovernance(governance.since);
      try {
        const snap = (await c.env.CACHE.get(liftKey(tenant, brand, s.slot), 'json')) as LiftSnapshot | null;
        s.evidence = snap ? { items: Object.keys(snap.items).length, events: snap.events, publishedAt: snap.publishedAt } : null;
      } catch { s.evidence = null; }
    }
  }
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, tenant, brand, q: q ?? null, total: index.total, pages: index.pages });
});

/**
 * GET /v1/:tenant/learn/exploring?slot=&brand=&limit=&cursor= (doc 28 §4): the items under the slot's
 * observation floor, least observed first, paged; with the slot's exploration mode, share and floor.
 */
decisionRoutes.get('/:tenant/learn/exploring', operatorWrites(), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const slot = (c.req.query('slot') ?? '').trim();
  if (!slot) return c.json({ ok: false, error: 'slot required' }, 400);
  const brand = (c.req.query('brand') ?? '').trim() || tenant;
  const cur = decodeCursor(c.req.query('cursor'));
  if (c.req.query('cursor') && !cur) return c.json({ ok: false, error: 'cursor not recognised' }, 400);
  const limit = cur ? cur.limit ?? DEFAULT_LIMIT : Math.max(1, Math.min(MAX_LIMIT, Number(c.req.query('limit')) || DEFAULT_LIMIT));
  const [snapshot, catalog, learn] = await Promise.all([
    c.env.CACHE.get(liftKey(tenant, brand, slot), 'json').catch(() => null) as Promise<LiftSnapshot | null>,
    readConfig<ContentCatalog>(c, CONTENT_KIND, tenant), readConfig<LearnConfig>(c, LEARN_KIND, tenant),
  ]);
  const ex = learn.slots?.[slot]?.exploration ?? null;
  const effective = { mode: ex?.mode === 'thompson' ? 'off' : ex?.mode ?? 'off', share: ex?.mode === 'thompson' ? 0 : ex?.share ?? 0,
    ...(ex?.mode === 'thompson' ? { configuredMode: 'thompson', unsupported: true } : {}) };
  const floor = ex?.floor ?? DEFAULT_EXPLORE.floor;
  c.header('Cache-Control', 'no-store');
  if (!snapshot) return c.json({ ok: true, tenant, brand, slot, version: 0, published: false, ...effective, floor, total: 0, offset: 0, limit, rows: [], cursor: null });
  if (cur && cur.v !== snapshot.version) return c.json({ ok: false, error: 'the snapshot has moved on since this page was cut; start the listing again', version: snapshot.version }, 409);
  const names = new Map(catalog.pieces.map((p) => [p.id, { customerContentId: p.customerContentId, title: p.title }]));
  const page = pageOf(exploringRows(snapshot, names, floor), cur ? cur.o : 0, limit);
  const cursor = page.next === null ? null : encodeCursor({ v: snapshot.version, o: page.next, level: 'exploring', limit });
  return c.json({ ok: true, tenant, brand, slot, version: snapshot.version, published: true, ...effective, floor, total: page.total, offset: page.offset, limit: page.limit, rows: page.rows, cursor });
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
  let budget = 200;
  for (const s of entries) {
    if (budget-- <= 0) { s.evidence = null; continue; }
    try { const snap = (await c.env.CACHE.get(liftKey(tenant, brand, s.slot), 'json')) as LiftSnapshot | null; s.evidence = snap ? { items: Object.keys(snap.items).length, events: snap.events, publishedAt: snap.publishedAt } : null; } catch { s.evidence = null; }
  }
  c.header('Cache-Control', 'no-store');
  // W21 E1.05 (R118(3)): the enrollment-anchor failures of the last thirty days,
  // read from the same operator cache the governance counters use; unreadable
  // answers zero rather than failing the queue.
  // It is not part of `queueOf`'s pure computation over the published documents:
  // it is a counter read from the operator cache, so it is answered beside it.
  const health = await readEnrollmentHealth(c.env, tenant, now);
  // W29 U1.01: this answer is the landing page of an operator application, so
  // its `proposals_pending` must not stand alone while every apply and reject
  // is withdrawn (503, below). The withdrawal is reported beside the counts,
  // for the same reason the enrollment counter is: it is not part of `queueOf`'s
  // pure computation over the published documents, it is what this deployment
  // can do with them. `proposals_pending` is a count of historical `proposed`
  // statuses, and the statuses it excludes are stored records, not verified
  // applications — the same two facts `GET learn/proposals` answers.
  return c.json({ ok: true, tenant, brand, ...queueOf({ proposals: proposals.proposals.filter((p) => p.brand === brand), slots: entries, learn,
    erasuresPending: tombs.size }), enrollment_anchor_unavailable: health.anchorUnavailable, autonomy: AUTONOMY_WITHDRAWN });
});

/**
 * GET /v1/:tenant/visitors/:visitorId/receipts?limit=&cursor= (doc 28 §4): what this shopper was served,
 * newest first, each with the sentences that say why, from her own ring. Authenticated, like /recent.
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
    const names = new Map(catalog.pieces.map((p) => [p.id, { customerContentId: p.customerContentId, title: p.title }]));
    const page = pageOf(ring, cur ? cur.o : 0, limit);
    const cursor = page.next === null ? null : encodeCursor({ v: 0, o: page.next, level: 'exploring', limit });
    return c.json({ ok: true, tenant, visitor_id: visitorId, total: page.total, offset: page.offset, limit: page.limit, receipts: page.rows.map((r) => receiptOf(r, names)), cursor });
  } catch { return c.json({ ok: false, error: HISTORY_UNAVAILABLE }, 503); } });
  if (response.ok && witness) try { assertRecent(c.env, tenant, witness); }
  catch { return c.json({ ok: false, error: HISTORY_UNAVAILABLE }, 503); }
  return response;
});

/**
 * GET /v1/:tenant/lift?slot=hero[&brand=]
 * The lift snapshot in force for a slot: every item's decayed counts, estimate and
 * lift at every pooling level, and the slot's own rate per cell. Operator access
 * is required in enforced mode. This is the console's grid (doc 22 §12.2) as data.
 */
decisionRoutes.get('/:tenant/lift', operatorWrites(), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  if (!TENANT.test(tenant)) return c.json({ ok: false, error: 'tenant must be a short slug' }, 400);
  const slot = (c.req.query('slot') ?? '').trim();
  if (!slot) return c.json({ ok: false, error: 'slot required' }, 400);
  const brand = (c.req.query('brand') ?? '').trim() || tenant;
  let snapshot: unknown = null;
  // Phase 3 / CW22: ?version= reads an archived snapshot instead of the one in force.
  const version = Number(c.req.query('version') ?? 0) || 0;
  if (version > 0) {
    try { const obj = await c.env.STORAGE.get(liftArchiveKey(tenant, brand, slot, version)); snapshot = obj ? await obj.json() : null; } catch { snapshot = null; }
  } else {
    try { snapshot = await c.env.CACHE.get(liftKey(tenant, brand, slot), 'json'); } catch { snapshot = null; }
  }
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, tenant, brand, slot, snapshot });
});

/** GET /v1/:tenant/visitors/:visitorId/recent: what this visitor was shown, from her own object. Authenticated. */
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
  return c.json({ ok: true, tenant, proposals: doc.proposals, history: { historical: true, verified: false, readOnly: true, complete: false, mutationAvailable: false, note: 'Stored proposal statuses are unverified. This bounded listing is not a complete audit trail.' } });
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
async function snapshotContext(request: Request): Promise<Record<string, string>> {
  assertShopperSelectors(request);
  if (request.method === 'GET') {
    const context = Object.fromEntries(new URL(request.url).searchParams);
    if (context.tenant !== undefined) throw new SessionAccessError();
    if (context.entry !== undefined) {
      try { if (context.entry.length > ENTRY_QUERY_LIMIT || !validEntry(JSON.parse(context.entry), true)) throw new Error(); } catch { throw new InvalidEntryContext(); }
    }
    for (const key of ['trackingConsent', 'personalizationEnabled']) if (context[key] !== undefined && context[key] !== 'true' && context[key] !== 'false') throw new SessionAccessError();
    return context;
  }
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].length) throw new SessionAccessError();
  let value: unknown;
  try { value = parseShopperContext(await request.clone().text()); } catch { throw new SessionAccessError(); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SessionAccessError();
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!['page', 'brand', 'channel', 'entry', 'browsingSessionId', 'trackingConsent', 'personalizationEnabled', 'pageInstance'].includes(key)
      || typeof item !== 'string' || item.length > (key === 'entry' ? ENTRY_QUERY_LIMIT : 128)) throw new SessionAccessError();
    out[key] = item;
  }
  if (out.entry !== undefined) {
    try { if (!validEntry(JSON.parse(out.entry), true)) throw new Error(); } catch { throw new InvalidEntryContext(); }
  }
  for (const key of ['trackingConsent', 'personalizationEnabled']) if (out[key] !== undefined && out[key] !== 'true' && out[key] !== 'false') throw new SessionAccessError();
  return out;
}
decisionRoutes.on(['GET', 'POST'], '/:tenant/decisions/snapshot', requireShopper({ forward: false, bodyLimit: 8192, bodyTimeoutMs: 5000 }), async (c, next) => {
  try { await snapshotContext(c.req.raw); }
  catch (error) { if (error instanceof InvalidEntryContext) return c.json({ ok: false, error: 'Invalid entry context' }, 400); throw error; }
  await next();
}, requireShopper(), async (c) => {
  let context: Record<string, string>;
  try { context = await snapshotContext(c.req.raw); }
  catch (error) { if (error instanceof InvalidEntryContext) return c.json({ ok: false, error: 'Invalid entry context' }, 400); throw error; }
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
  const sessionId = principal.sessionId;
  const cf = ((c.req.raw as unknown as { cf?: unknown }).cf ?? null) as { country?: string; regionCode?: string } | null;

  // Two names, on purpose, until CW1 provisions tenants: the path names the SCOPE
  // the documents are read under; the tenancy middleware names the brand whose
  // shopper state and session this request belongs to.
  const out = await serveContentDecisions(c.env, {
    tenant, brand, page, visitorId, sessionId, channel, entry, cf, cookieHeader: c.req.header('Cookie') ?? null, consent,
    stateTenant: c.get('tenant'), principal, capability: capabilityToken(c.req.raw)!,
    offer: { pageInstance: context.pageInstance },
    browsingSessionId: (context.browsingSessionId ?? '').trim().slice(0, 128) || undefined,
  });
  // Where the time went, for whoever is measuring: one Server-Timing entry per stage.
  c.header('Server-Timing', Object.entries(out.sources.timings).map(([k, v]) => `${k};dur=${v}`).join(', '));
  // Phase 0 and Phase 1, after the response, never on it: the ledger, the visitor's ring, each slot's exposures.
  // CW31: nothing at all when the shopper withheld tracking consent.
  const ledger = out.write && c.env.LEDGER_RECOVERY_ENABLED !== 'true' ? enqueueDecisions(c.env, out.records) : Promise.resolve();
  try { c.executionCtx.waitUntil(ledger); c.executionCtx.waitUntil(out.afterResponse); } catch { void ledger; void out.afterResponse; }
  c.header('Cache-Control', 'no-store');
  const refusedPins = out.pinDiagnostics ?? [];
  // Private replay inputs travel only inside authenticated encrypted offers.
  const payload = { ok: true, tenant, brand: out.brand, page: out.page, ts: out.ts, arm: out.arm,
    // W21 E1.03: the experiment this answer belongs to — `arm` above is the
    // experience served, `experiment.arm` the experimental assignment — so a
    // customer can join their own outcome data to the population we served her
    // in. Absent for an unsigned caller, which is no shopper.
    ...(out.experiment ? { experiment: out.experiment } : {}),
    versions: out.versions, config_label: out.config_label, decisions: out.decisions,
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
 * a visitor and empties her ring (the identity route calls the same function
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
  return c.json({ ok: result.ok, equal: result.equal, ...(result.reason ? { reason: result.reason } : {}), used: result.used, diff: result.diff, key: found.key, served: result.served, replayed: result.replayed });
  });
  if (response.ok && witness) try { requireRetention(c.env, witness, tenant, 'ledger'); }
  catch { c.header('Cache-Control', 'no-store'); return c.json({ ok: false, error: HISTORY_UNAVAILABLE }, 503); }
  return response;
});

/**
 * POST /v1/:tenant/models/reference (doc 22 §9). The reference implementation
 * of the model contract, as a service a data science team can call to see the
 * shape, and point the `service` kind at by URL to see the term on a receipt.
 * Stateless; no visitor id crosses it.
 */
decisionRoutes.post('/:tenant/models/reference', async (c) => {
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

/** GET /v1/:tenant/lift/history?slot=[&brand=]: every archived snapshot version for the slot (doc 22 §12.2). */
decisionRoutes.get('/:tenant/lift/history', operatorWrites(), async (c) => {
  const tenant = (c.req.param('tenant') ?? '').trim();
  const slot = (c.req.query('slot') ?? '').trim();
  if (!TENANT.test(tenant) || !slot) return c.json({ ok: false, error: 'tenant slug and slot' }, 400);
  const brand = (c.req.query('brand') ?? '').trim() || tenant;
  const prefix = `lift/${tenant}/${brand}/${slot}/`;
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
  return c.json({ ok: true, tenant, brand, slot, versions });
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
    || Object.keys(b).some(key => !['operation', 'kind', 'slot', 'brand', 'visitorId', 'digest', 'generation', 'operationId', 'intent'].includes(key))
    || b.kind === 'stats' && (!component(b.slot) || !component(b.brand) || b.visitorId !== undefined)
    || b.kind === 'ring' && (!component(b.visitorId) || b.slot !== undefined || b.brand !== undefined)) return c.json({ ok: false }, 400);
  if (b.operation === 'repair' && (typeof b.digest !== 'string' || !/^[a-f0-9]{64}$/.test(b.digest) || !Number.isSafeInteger(b.generation) || Number(b.generation) < 0
    || typeof b.operationId !== 'string' || !/^[a-f0-9]{32}$/.test(b.operationId) || b.intent !== (b.kind === 'stats' ? 'coarsen' : 'compact'))) return c.json({ ok: false }, 400);
  if (b.operation === 'status' && ['digest', 'generation', 'operationId', 'intent'].some(key => b[key] !== undefined)) return c.json({ ok: false }, 400);
  const kind = b.kind as 'stats' | 'ring', operation = b.operation as 'status' | 'repair';
  const target = kind === 'stats' ? statsName(tenant, b.brand as string, b.slot as string) : ringName(tenant, b.visitorId as string);
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
  let b: { slot?: string; item?: string; brand?: string } | null, receipt;
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
    if (!b || Object.keys(b).some(key => !['slot', 'item', 'brand'].includes(key))
      || typeof b.slot !== 'string' || typeof b.item !== 'string' || !b.slot || !b.item || b.slot.length > 200 || b.item.length > 256
      || b.brand !== undefined && (typeof b.brand !== 'string' || !b.brand || b.brand.length > 200)) return c.json({ ok: false, error: 'Invalid reset target' }, 400);
    if (!c.env.LEARN_STATS) return c.json({ ok: false, error: 'LEARN_STATS binding absent' }, 503);
    const request = { type: 'item-reset', item: b.item, slot: b.slot, brand: b.brand ?? tenant };
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
    const stub = c.env.LEARN_STATS!.get(c.env.LEARN_STATS!.idFromName(statsName(tenant, b!.brand ?? tenant, b!.slot!)));
    const response = await stub.fetch('https://learn/reset-item', { method: 'POST', body: JSON.stringify({
      item: b!.item, tenant, slot: b!.slot, brand: b!.brand ?? tenant, publication: receipt.publication,
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
  const b = (await c.req.json().catch(() => null)) as { slot?: string; brand?: string } | null;
  if (!b?.slot) return c.json({ ok: false, error: 'slot required' }, 400);
  const brand = (b.brand ?? '').trim() || tenant;
  if (!c.env.LEARN_STATS) return c.json({ ok: false, error: 'LEARN_STATS binding absent on this stamp' }, 503);
  c.header('Cache-Control', 'no-store');
  try {
    const stub = c.env.LEARN_STATS.get(c.env.LEARN_STATS.idFromName(statsName(tenant, brand, b.slot)));
    const response = await stub.fetch('https://learn/publish', { method: 'POST' });
    const res = await response.json() as { ok?: unknown; published?: unknown; snapshot?: { tenant?: unknown; brand?: unknown; slot?: unknown; version?: unknown } | null } | null;
    if (!response.ok || !res || res.ok !== true || typeof res.published !== 'boolean'
      || (res.published ? !res.snapshot || res.snapshot.tenant !== tenant || res.snapshot.brand !== brand || res.snapshot.slot !== b.slot
        || !Number.isSafeInteger(res.snapshot.version) || (res.snapshot.version as number) <= 0 : res.snapshot !== null)) throw new Error();
    invalidateLiftCache();
    // Acknowledged archive then KV write, not global KV propagation or client receipt.
    return c.json({ ok: true, tenant, brand, slot: b.slot, published: res.published, snapshot: res.snapshot });
  } catch {
    invalidateLiftCache();
    return c.json({ ok: false, error: 'statistics acknowledgement unavailable' }, 503);
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
        report = await runDayReport(c.env.STORAGE as unknown as Parameters<typeof runDayReport>[0], { tenant, brand, date }, learn, policies, Date.now(), { maxObjects: REPORT_MAX_OBJECTS }, c.env, resolved);
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
