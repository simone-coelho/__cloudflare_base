// src/durable-objects/LearnStats.ts
// One object per tenant, brand and slot. Application budgets bound admission;
// refusal never evicts evidence or changes the estimator's pooling semantics.

import type { Env } from '@/types/env';
import { SyntheticObjectBoundary, syntheticOperation } from '@/ops/synthetic';
import type { Cell } from '@/content/types';
import type { RewardType } from '@/ledger/records';
import { accumulationGeneration, ADOPTED_MEMBERS, anchoredAfter, boundStats, latestAnchor, coarsenStats, depth, buildSnapshot, emptyStats, isPooledKey, levelKeys, nextPositionHistory, parentKey, positionEffectsOf, positionHistoryOf, positionWeightAt, recordExposure, recordSuccess, unpagedKey, type AttributionContract, type Counter, type PairCounts, type PooledCounters, type NotAdopted, type NotAdoptedChange, type PositionPolicy, type RebuildBasis, type Republished, type RepublishedChange, type StaleMarker, type StatsState, type LiftSnapshot, type Level } from '@/learn/stats';
import { foldRetainedDay, isPlacementSlot, LIFT_RECENT_PUBLICATIONS, LIFT_RECENT_WINDOW_MS, liftArchiveKey, liftKey, liftRepublishedKey, liftStaleKey, notAdoptedOf, notAdoptedRefusalOf, ONLINE_RING_REACH_MS, pooledPlacementsOf, positionHistoryKey, republishedIn, republishedOf, republishedRecordOf, republishedRefusalOf, staleMarkerOf, staleRefusalOf, statsName, supersededRecordOf, type SlotLearnConfig, type StatsWriteReceipt } from '@/learn/fan';
import { loadDay, REPORT_LIMITS } from '@/learn/report';
import type { DecisionRecord, MeasurementBasis } from '@/content/types';
import { committedPublication, pinPublication, publicationVersion, readOptionalPinnedPublication, readPinnedPublication } from '@/config/publication';
import { CONTENT_KIND, isCatalogueName, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { DEFAULT_STATS } from '@/learn/stats';
import { indexPriors, priorUnitErrors, PRIORS_KIND } from '@/learn/priors';
import { attributionContractOf, policyOf } from '@/learn/route';
import { loadTombstone } from '@/ledger/erasure';
import { requireRetention } from '@/retention';
import { learningEffectId, recoveryDigest, RECOVERY_LIMITS, type LearningEffect, type LearningGeneration } from '@/ledger/recovery';
import { channelIn } from '@/services/visit';
import { contextTermsOf, TODAY_TERMS, type ContextTerms } from '@/content/cell';

const PUBLISH_DELAY_MS = 30_000;
/** Conservative application budgets, not a measurement of a provider limit. */
export const LEARN_LIMITS = { requestBytes: 256 * 1024, rows: 1000, stateBytes: 512 * 1024,
  items: 256, counters: 4096, component: 256, keyBytes: 2048,
  priorRows: 4096, priorBytes: 256 * 1024, snapshotBytes: 2 * 1024 * 1024,
  repairBytes: 8 * 1024 * 1024, repairCounters: 65536, totalBytes: 640 * 1024,
  /** P05: the highest position, counted from 1 within a slot, an adjacent swap or a credit may name. */
  positions: 64 } as const;
const rewards = new Set(['click', 'dwell', 'video_complete', 'wishlist', 'add_to_bag', 'purchase', 'custom']);
const utf8 = new TextEncoder();
interface EffectMarker { digest: string; subject: string; ts: number; expiresAt: number; item: string }
/**
 * W26 R2: `page` is present only on the object of a PAGE-SCOPED placement — a
 * slot name a retained catalogue carries on more than one page — and is then
 * part of this object's identity exactly as the tenant, brand and slot are.
 */
interface Stored { tenant: string; brand: string; slot: string; page?: string; config: SlotLearnConfig; stats: StatsState;
  effects?: Record<string, EffectMarker>; retiredEffects?: Record<string, { digest: string; expiresAt: number }>;
  /**
   * P05 (decision D1): per adjacent pair (k, k + 1), keyed by k, what the slot's
   * swaps have shown (`PairCounts`). Absent on a slot that has swapped nothing,
   * so no other object's state gains a member.
   */
  positions?: Record<string, PairCounts> }
/** Every instant the alarm must remove a live or retired learning-effect marker at. */
const effectExpiries = (stored: Stored | null | undefined): number[] =>
  [...Object.values(stored?.effects ?? {}), ...Object.values(stored?.retiredEffects ?? {})].map(marker => marker.expiresAt);
interface GenerationFence { whole: number; items: Record<string, number> }
/**
 * P05: `position` is the decision's position counted from 1 within its slot,
 * carried for a module of a page's declared layout slot; `swap` names the two
 * adjacent positions an adjacent swap exchanged on that decision, carried only
 * for the two modules it exchanged.
 */
type Row = { item: string; cell: Cell; ts: number; reward?: RewardType; weight?: number; effect?: LearningEffect; decision?: string; digest?: string;
  position?: number; swap?: [number, number] };
/**
 * W22 D1.02 (F16 §7, §2.3): the bounded, durable journal of exposures this
 * object has already applied, so a REDELIVERED exposure — the at-least-once
 * repeat F16 §2.3 measured counting one impression twice — is recognized and
 * not counted again. It is keyed by the decision's own logical id, which the
 * `/exposures` payload now carries, because a decision is served exactly once.
 *
 * It lives under its own storage key rather than inside `learn`, so it can
 * never take room from the estimator's counters or make `fit()` coarsen them,
 * and it is charged against the object's existing total bound. It is pruned to
 * the online horizon and then to these two caps, oldest first; a repeat that
 * arrives after it has been pruned is applied again, and nothing claims
 * otherwise. Credits are NOT journalled here: the visitor's ring is the one
 * place that can tell two outcomes apart, and it does that before it sends.
 */
const SEEN_KEY = 'learnSeen';
/**
 * W23 H1.01: the basis the operator's explicit reset started this object again
 * on. Its own storage key, written in the same transaction as the reset, so a
 * snapshot published afterwards can say what it was built from and no reader
 * mistakes post-reset counters for the tenant's whole history. Absent on an
 * object that was never repaired; charged against the object's total bound.
 * W23 R2: the object's own `/reset` keeps it, since what is counted after that
 * reset still stands on the repair it names.
 */
const REBUILT_KEY = 'learnRebuilt';
/**
 * W24 G1.01/G1.02: the authorized ACCUMULATION transition this object is running
 * under, and the moment its generation started counting.
 *
 * It exists because an accumulation change can never arrive on an ordinary
 * write: `candidate()` refuses one with 409, so counters built under one
 * objective are never silently reinterpreted under another. The only way past
 * that refusal is an operator act on `POST /v1/:tenant/learn/generation`, which
 * discards the counters and starts a fresh generation — and this record is what
 * the object keeps of it, so that
 *   · the published snapshot can name when learning restarted, even when the
 *     fresh generation has counted nothing yet and has no evidence to date
 *     itself from, and
 *   · `priorsFor` can tell an accumulation an operator authorized from a
 *     configuration that simply drifted away from the tenant's document. The
 *     estimator half is still required to match the published document exactly;
 *     only the accumulation an audited operation moved this object to is
 *     accepted beside it, and an ordinary write under the document's own
 *     configuration is still refused until the document follows.
 *
 * Its own storage key, charged against the object's total bound, and discarded
 * with the counters it describes by every reset.
 */
const GENERATION_KEY = 'learnGeneration';
interface AccumulationTransition {
  /** The audited operation that authorized it. */
  operationId: string;
  /** When the generation started counting: the snapshot's `restartedAt`. */
  at: number;
  reward: RewardType;
  objective: 'unit' | 'revenue' | 'margin';
  measurementBasis: MeasurementBasis;
  /** W24 T1.02: the retained day this generation was folded from, when it was. */
  rebuiltFrom?: { date: string; decisions: number; outcomes: number };
}
/**
 * P62 (amendment 6, R-P110 decision 2): this object's recent publications,
 * `{ version, digest, publishedAt }` each, oldest first, kept inside
 * `LIFT_RECENT_WINDOW_MS` from each one's publication and at most
 * `LIFT_RECENT_PUBLICATIONS` of them, so that the witness door recognises a copy
 * a later publication superseded while the edge still serves it. Written with
 * each publication, before the copy reaches the serving key; its own storage
 * key, charged against the object's total bound. Best effort: a list that
 * cannot be written or read recognises the latest publication alone, as before.
 */
const RECENT_KEY = 'learnRecent';
interface RecentPublication { version: number; digest: string; publishedAt: number }
/** P62: the well-formed entries of a stored list, the most recent `LIFT_RECENT_PUBLICATIONS`; anything else recognises nothing. */
function recentPublicationsOf(value: unknown): RecentPublication[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry: unknown): entry is RecentPublication => fields(entry, ['version', 'digest', 'publishedAt'])
    && Number.isSafeInteger(entry.version) && (entry.version as number) > 0 && typeof entry.digest === 'string' && /^[a-f0-9]{64}$/.test(entry.digest)
    && time(entry.publishedAt)).slice(-LIFT_RECENT_PUBLICATIONS).map(entry => ({ version: entry.version, digest: entry.digest, publishedAt: entry.publishedAt }));
}
/** P62: what a state's witness is computed from beside the fence: its identity (W26 R2: its page), its configuration and its projection. */
interface WitnessBasis { tenant: string; brand: string; slot: string; page?: string; config: SlotLearnConfig; projection: { depth: number; closed: boolean } | null }
/**
 * P62 (amendment 6, R-P110; R-P112(5)): the verdict the witness door answers
 * from, of the state this object held at `epoch` (every assignment of the state
 * it holds moves the epoch, so a verdict never outlives its state): cached when
 * the state is committed, or established once from storage by an object that
 * holds none (an evicted object's first call), never by digesting the state.
 */
interface HeldVerdict {
  epoch: number;
  /** As `/health` refuses it: a stored state that is not one, or is past the repair bound. */
  refused?: true;
  /** The state's identity; absent when the object holds no state (`empty`). */
  identity?: { tenant: unknown; brand: unknown; slot: unknown; page?: unknown };
  /** Present only when the state validates and fits the object's total bound. */
  basis?: WitnessBasis;
  /** `latestAnchor` of the state: it is healthy while this is not after the object's clock (W23 H1.01). */
  anchor: number;
  /** The state's witness under the fence it was last asked for. */
  witness?: { fence: string; value: Promise<string> };
}
const witnessBasisOf = (d: Stored): WitnessBasis => ({ tenant: d.tenant, brand: d.brand, slot: d.slot, ...(d.page ? { page: d.page } : {}), config: d.config,
  projection: d.stats.bounded ? { depth: d.stats.bounded.depth, closed: d.stats.bounded.closed === true } : null });
// W26 R2: a page-scoped object's witness binds its page; a page-less one is unchanged.
const witnessOf = (basis: WitnessBasis, fence: GenerationFence): Promise<string> => recoveryDigest({ tenant: basis.tenant, brand: basis.brand, slot: basis.slot,
  ...(basis.page ? { page: basis.page } : {}), config: basis.config, fence, projection: basis.projection });
/** P62: the verdict of a state this object has just committed, which `fit` and `totalBound` have accepted. */
const committedVerdict = (d: Stored, epoch: number): HeldVerdict => ({ epoch, identity: { tenant: d.tenant, brand: d.brand, slot: d.slot, page: d.page },
  basis: witnessBasisOf(d), anchor: latestAnchor(d.stats) });
const SEEN_MAX_BYTES = 32 * 1024;
const SEEN_MAX_ROWS = 512;
interface SeenExposure { id: string; digest: string; ts: number }
class Refusal extends Error {
  constructor(readonly status: 400 | 409 | 413 | 503, message: string) { super(message); }
}
const capacity = () => new Refusal(413, 'statistics capacity exceeded');
const invalid = () => new Refusal(400, 'invalid statistics input');
const recovery = () => new Refusal(503, 'statistics recovery required');
/**
 * P42 (R-P78, decision D1): a sibling placement's `/pooled` door could not be
 * read while this placement assembled a pooled record — `objectName`, `page` and `slot`
 * that placement's, `modules` the pooled modules this placement reads from it,
 * sorted, `original` what the read threw. Internal: `publish()` turns it into the
 * named refusal (`StaleRefusal`); every other reader of the snapshot rethrows
 * `original`, so it fails exactly as it did before.
 */
class PooledFault extends Error {
  constructor(readonly objectName: string, readonly page: string, readonly slot: string, readonly modules: string[], readonly original: unknown) {
    super('pooled statistics unavailable');
  }
}
/** P42: a publication refused for the pooled cause, answered `503 { ok: false, error, stale }` with its sentence and its marker. */
class StaleRefusal extends Refusal {
  constructor(readonly stale: StaleMarker) { super(503, staleRefusalOf(stale)); }
}
/**
 * P49 (R-P78, decision D1): the configuration check refused because the published
 * learn document names another accumulation tuple for the slot than the one its
 * statistics accumulate under, and no authorized transition accounts for it —
 * `changed` the members that differ. It IS today's refusal, `503 statistics
 * recovery required`, to every caller but `publish()`, which turns it into the
 * named refusal (`RepublishRefusal`); every other reader of the snapshot answers
 * exactly what it answered before.
 */
class RepublishFault extends Refusal {
  constructor(readonly changed: RepublishedChange[]) { super(503, 'statistics recovery required'); }
}
/** P49: a publication refused after a learn republish, answered `503 { ok: false, error, republished }` with its sentence and its member. */
class RepublishRefusal extends Refusal {
  constructor(readonly republished: Republished, words: string) { super(503, words); }
}
/**
 * P50 (R-P78, decision D1): a generation transition refused because it does not
 * adopt a member of the slot's tuple that a learn republish changed, answered
 * `409 { ok: false, error, notAdopted }` with its sentence and its member.
 */
class NotAdoptedRefusal extends Refusal {
  constructor(readonly notAdopted: NotAdopted, words: string) { super(409, words); }
}
/**
 * P50: the most learn revisions a transition reads back, through
 * `publicationVersion`, to find the one in force when the slot's statistics
 * started; a history longer than this is one that cannot be read, and then any
 * difference counts (R-P84 addendum 2), so nothing is silently admitted.
 */
const TRANSITION_HISTORY_READS = 50;
/** P50: the slot's own `measurementBasis`, `objective` and `reward` in a learn document, as the configuration check reads them. */
const slotTuple = (learn: { slots?: Record<string, { reward?: string; objective?: string; measurementBasis?: string } | undefined> }, slot: string) => {
  const dials = learn.slots?.[slot];
  return { measurementBasis: dials?.measurementBasis ?? 'served-v1', objective: dials?.objective ?? 'unit', reward: dials?.reward ?? 'click' } as Record<NotAdoptedChange['member'], string>;
};
/**
 * P49: the members of the slot's accumulation tuple whose value in the published
 * learn document (`now`, as the configuration check reads it) differs from the
 * one the slot's statistics accumulate under (`was`), in `REPUBLISHED_MEMBERS`
 * order, each with its old and new values.
 */
function republishedChanges(was: SlotLearnConfig, now: { reward: string; objective: string; measurementBasis: string; stats: SlotLearnConfig['stats'] }): RepublishedChange[] {
  const pairs: Array<[RepublishedChange['member'], unknown, unknown]> = [
    ['measurementBasis', was.measurementBasis ?? 'served-v1', now.measurementBasis], ['objective', was.objective ?? 'unit', now.objective],
    ['reward', was.reward, now.reward], ['stats.liftMax', was.stats.liftMax, now.stats?.liftMax], ['stats.liftMin', was.stats.liftMin, now.stats?.liftMin],
    ['stats.n0', was.stats.n0, now.stats?.n0], ['stats.nMin', was.stats.nMin, now.stats?.nMin], ['stats.tauLearnMs', was.stats.tauLearnMs, now.stats?.tauLearnMs],
  ];
  return pairs.filter(([, old, next]) => old !== next).map(([member, old, next]) => ({ member, new: next as string | number, old: old as string | number }));
}
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
  && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const fields = (v: unknown, keys: string[]): v is Record<string, unknown> => object(v) && Object.keys(v).every(k => keys.includes(k));
const component = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= LEARN_LIMITS.component;
const itemName = (v: unknown): v is string => component(v) && !Object.prototype.hasOwnProperty.call(Object.prototype, v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const control = (v: string): boolean => [...v].some(char => char.charCodeAt(0) < 32);
const time = (v: unknown): v is number => finite(v) && Number.isFinite(new Date(v).getTime());
/**
 * W26 R2 (review D3): a slot this object is named for or written under never
 * carries `@`, the page qualifier of a page-scoped placement's name, so no
 * object can be created or addressed under another placement's identity.
 */
const slotName = (v: unknown): v is string => component(v) && isPlacementSlot(v);
/** W26 R2: a placement's page, where one is named at all, is a catalogue page name. */
const pageValid = (v: unknown): v is string | undefined => v === undefined || isCatalogueName(v);
/** W26 R2: the page is part of an object's identity; absent on one side is absent on the other. */
const samePage = (stored: { page?: unknown }, asked: unknown): boolean => (stored.page ?? undefined) === (asked ?? undefined);
function bytes(v: unknown): number {
  return utf8.encode(JSON.stringify(v, (_key, value: unknown) => {
    if (typeof value === 'number' && !Number.isFinite(value)) throw invalid();
    return value;
  })).length;
}
function keyBound(key: string): void {
  if (Object.prototype.hasOwnProperty.call(Object.prototype, key)) throw invalid();
  if (!key || utf8.encode(key).length > LEARN_LIMITS.keyBytes || key.split('|').length > 5) throw capacity();
  if (key !== '*' && key.split('|').some((part, i) => !part.startsWith(['c=', 'v=', 's=', 'r=', 'a='][i]!)
    || part.length < 3 || part.length > LEARN_LIMITS.component + 2 || part.slice(2).includes('=') || control(part.slice(2)))) throw invalid();
}
/**
 * P08 (decision D2): a key of a pooled record, or a prior cell written for one —
 * `p=<page>` first, then today's levels in today's order, at most six pairs —
 * bounded exactly as `keyBound` bounds every other key. Any other key is held
 * to `keyBound` itself, unchanged. Stored counters never carry a pooled key: a
 * pooled module's evidence is kept in each placement as every module's is.
 */
function pooledKeyBound(key: string): void {
  if (!isPooledKey(key)) { keyBound(key); return; }
  if (Object.prototype.hasOwnProperty.call(Object.prototype, key)) throw invalid();
  const parts = key.split('|');
  if (utf8.encode(key).length > LEARN_LIMITS.keyBytes || parts.length > 6) throw capacity();
  if (parts.some((part, i) => !part.startsWith(['p=', 'c=', 'v=', 's=', 'r=', 'a='][i]!)
    || part.length < 3 || part.length > LEARN_LIMITS.component + 2 || part.slice(2).includes('=') || control(part.slice(2)))) throw invalid();
}
/** P08: what a placement's counters MEAN — the accumulation tuple two placements must share for their evidence to be one record. */
const accumulationOf = (config: SlotLearnConfig) => ({ reward: config.reward, objective: config.objective ?? 'unit',
  measurementBasis: config.measurementBasis ?? 'served-v1', tauLearnMs: config.stats.tauLearnMs });
/** P08: one stored counter, as `stateValid` reads it. */
const counterValid = (c: unknown): c is Counter => {
  const entry = (v: unknown) => fields(v, ['s', 't']) && finite(v.s) && v.s >= 0 && time(v.t);
  return fields(c, ['n', 's']) && entry(c.n) && object(c.s) && Object.entries(c.s).every(([reward, e]) => rewards.has(reward) && entry(e));
};
function configValid(v: unknown): v is SlotLearnConfig {
  if (!fields(v, ['reward', 'stats', 'objective', 'measurementBasis']) || typeof v.reward !== 'string' || !rewards.has(v.reward)
    || v.measurementBasis !== undefined && v.measurementBasis !== 'served-v1' && v.measurementBasis !== 'rendered-v1'
    || (v.objective !== undefined && (typeof v.objective !== 'string' || !['unit', 'revenue', 'margin'].includes(v.objective)))) return false;
  const s = v.stats;
  return fields(s, ['n0', 'tauLearnMs', 'liftMin', 'liftMax', 'nMin'])
    && finite(s.n0) && s.n0 > 0 && finite(s.tauLearnMs) && s.tauLearnMs > 0
    && finite(s.nMin) && Number.isSafeInteger(s.nMin) && s.nMin >= 1
    && finite(s.liftMin) && s.liftMin > 0 && s.liftMin <= 1
    && finite(s.liftMax) && s.liftMax >= 1 && s.liftMax > s.liftMin;
}
function stateValid(value: unknown, repairing = false): asserts value is Stored {
  if (!fields(value, ['tenant', 'brand', 'slot', 'page', 'config', 'stats', 'effects', 'retiredEffects', 'positions']) || !component(value.tenant) || !component(value.brand)
    || !slotName(value.slot) || (value.page !== undefined && !isCatalogueName(value.page)) || !configValid(value.config)) throw invalid();
  if (value.effects !== undefined && (!object(value.effects) || Object.keys(value.effects).length > RECOVERY_LIMITS.effects
    || Object.entries(value.effects).some(([id, m]) => !/^[a-f0-9]{64}$/.test(id)
      || !fields(m, ['digest', 'subject', 'ts', 'expiresAt', 'item']) || typeof m.digest !== 'string' || !/^[a-f0-9]{64}$/.test(m.digest)
      || !component(m.subject) || !time(m.ts) || !time(m.expiresAt) || !itemName(m.item)))) throw invalid();
  if (value.retiredEffects !== undefined && (!object(value.retiredEffects)
    || Object.entries(value.retiredEffects).some(([id, m]) => !/^[a-f0-9]{64}$/.test(id) || !fields(m, ['digest', 'expiresAt'])
      || typeof m.digest !== 'string' || !/^[a-f0-9]{64}$/.test(m.digest) || !time(m.expiresAt)))) throw invalid();
  if (Object.keys(value.effects ?? {}).length + Object.keys(value.retiredEffects ?? {}).length > RECOVERY_LIMITS.effects) throw capacity();
  // P05: the adjacent swaps' counts, one entry per pair's lower position, whole numbers.
  const whole = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
  if (value.positions !== undefined && (!object(value.positions) || Object.entries(value.positions).some(([k, c]) => !/^[1-9][0-9]*$/.test(k)
    || Number(k) >= LEARN_LIMITS.positions || !fields(c, ['pairs', 'first', 'second']) || !whole(c.pairs) || !whole(c.first) || !whole(c.second)))) throw invalid();
  const st = value.stats;
  if (!fields(st, ['items', 'slot', 'events', 'updatedAt', 'bounded']) || !object(st.items) || !object(st.slot)
    || !Number.isSafeInteger(st.events) || (st.events as number) < 0 || !time(st.updatedAt)) throw invalid();
  if (bytes(value) > (repairing ? LEARN_LIMITS.repairBytes : LEARN_LIMITS.stateBytes)
    || Object.keys(st.items).length > (repairing ? LEARN_LIMITS.repairCounters : LEARN_LIMITS.items)) throw capacity();
  const entryValid = (v: unknown) => fields(v, ['s', 't']) && finite(v.s) && v.s >= 0 && time(v.t);
  if (st.bounded !== undefined && (!fields(st.bounded, ['depth', 'omitted', 'omittedEvents', 'selection', 'closed'])
    || !Number.isInteger(st.bounded.depth) || Number(st.bounded.depth) < 0 || Number(st.bounded.depth) > 5
    || !Number.isSafeInteger(st.bounded.omittedEvents) || Number(st.bounded.omittedEvents) < 0
    || !['first-seen', 'lexical-repair'].includes(String(st.bounded.selection))
    || st.bounded.closed !== undefined && typeof st.bounded.closed !== 'boolean')) throw invalid();
  let count = 0;
  const maps: Array<[string, unknown]> = [['', st.slot], ...Object.entries(st.items)];
  if (st.bounded) maps.push(['omitted', { '*': (st.bounded as StatsState['bounded'])!.omitted }]);
  for (const [index, [item, map]] of maps.entries()) {
    if ((index > 0 && !itemName(item)) || !object(map)) throw invalid();
    for (const [key, c] of Object.entries(map)) {
      keyBound(key);
      if (++count > (repairing ? LEARN_LIMITS.repairCounters : LEARN_LIMITS.counters)) throw capacity();
      if (!repairing && st.bounded && depth(key) > Number((st.bounded as StatsState['bounded'])!.depth)) throw invalid();
      if (!fields(c, ['n', 's']) || !entryValid(c.n) || !object(c.s)
        || Object.entries(c.s).some(([reward, e]) => !rewards.has(reward) || !entryValid(e))) throw invalid();
    }
  }
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
function failure(error: unknown): Response {
  if (error instanceof StaleRefusal) return json({ ok: false, error: error.message, stale: error.stale }, 503);
  if (error instanceof RepublishRefusal) return json({ ok: false, error: error.message, republished: error.republished }, 503);
  if (error instanceof NotAdoptedRefusal) return json({ ok: false, error: error.message, notAdopted: error.notAdopted }, 409);
  return error instanceof Refusal
    ? json({ ok: false, error: error.message, ...(error.status === 413 || error.status === 409 ? { applied: false } : {}) }, error.status)
    : json({ ok: false, error: 'statistics acknowledgement unavailable' }, 503);
}
/** Count the actual stream, not a caller-controlled Content-Length. */
async function input(request: Request): Promise<Record<string, unknown>> {
  if (!request.body) throw invalid();
  const reader = request.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  let size = 0, text = '';
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > LEARN_LIMITS.requestBytes) throw capacity();
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
    const value: unknown = JSON.parse(text); if (!object(value)) throw invalid(); return value;
  } catch (error) {
    try { await reader.cancel(); } catch { /* cancellation cannot replace the refusal */ }
    throw error instanceof Refusal ? error : invalid();
  } finally { reader.releaseLock(); }
}
function rowsOf(rows: unknown[], kind: StatsWriteReceipt['kind']): Row[] {
  if (rows.length > LEARN_LIMITS.rows) throw capacity();
  const accepted: Row[] = [];
  for (const row of rows) {
    // Retain the old handler's ineligible/null-row skipped contract.
    if (!object(row) || !row.item || !row.cell || (kind === 'credits' && !row.reward)) continue;
    if (!itemName(row.item) || !object(row.cell)) throw invalid();
    for (const name of ['channel', 'visit_bucket', 'stage', 'region', 'affinity']) {
      const v = row.cell[name]; if (v !== undefined && v !== null && (!component(v) || v.includes('|') || v.includes('=') || control(v))) throw invalid();
    }
    const cell = row.cell as unknown as Cell;
    for (const key of levelKeys(cell)) keyBound(key);
    // Retain the absent/null-row contract: only an ABSENT time is the object's
    // own present. W23 T1.01: a time that is PRESENT must be what the event door
    // itself requires — a safe integer inside the calendar (`isEventTimestamp`,
    // `src/events/actionTypes.ts:37`; HANDOFF-2026-09-16 §6 :227 "valid
    // calendar/integer timestamps") — so this object is never laxer than the
    // door in front of it. `Number(true)` is 1 and `new Date(1.5)` is a valid
    // date, so neither a boolean nor a fractional millisecond may be coerced
    // into evidence; both are refused before any counter is touched.
    const supplied = row.ts !== undefined && row.ts !== null;
    const ts = supplied ? Number(row.ts) : Date.now();
    const weight = row.weight === undefined || row.weight === null ? 1 : Number(row.weight);
    if ((supplied && (typeof row.ts !== 'number' || !Number.isSafeInteger(row.ts)))
      || !time(ts) || !Number.isFinite(weight) || weight < 0 || (kind === 'credits' && (typeof row.reward !== 'string' || !rewards.has(row.reward)))) throw invalid();
    if (row.decision !== undefined && (typeof row.decision !== 'string' || !row.decision || utf8.encode(row.decision).length > LEARN_LIMITS.keyBytes)) throw invalid();
    if (row.digest !== undefined && (typeof row.digest !== 'string' || !/^[a-f0-9]{64}$/.test(row.digest))) throw invalid();
    // P05: a position counted from 1 within the slot, and the adjacent pair a swap exchanged, naming that position.
    const place = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 1 && (v as number) <= LEARN_LIMITS.positions;
    if (row.position !== undefined && !place(row.position)) throw invalid();
    if (row.swap !== undefined && (!Array.isArray(row.swap) || row.swap.length !== 2 || !place(row.swap[0]) || row.swap[1] !== (row.swap[0] as number) + 1
      || (row.position !== row.swap[0] && row.position !== row.swap[1]))) throw invalid();
    accepted.push({ item: row.item, cell, ts, ...(kind === 'credits' ? { reward: row.reward as RewardType, weight } : {}),
      ...(typeof row.decision === 'string' ? { decision: row.decision } : {}),
      ...(typeof row.digest === 'string' ? { digest: row.digest } : {}),
      ...(row.position !== undefined ? { position: row.position as number } : {}),
      ...(row.swap !== undefined ? { swap: [row.swap[0] as number, row.swap[1] as number] as [number, number] } : {}),
      ...(Object.hasOwn(row, 'effect') ? { effect: row.effect as LearningEffect } : {}) });
  }
  return accepted;
}

export class LearnStats {
  private held: Stored | null = null;
  /** P62: moved by every assignment of the state this object holds (`data`), which a cached witness verdict names. */
  private epoch = 0;
  private verdict: HeldVerdict | null = null;
  /** P62: the verdict being established for an epoch, so concurrent first calls of an evicted object read its state once. */
  private establishing: { epoch: number; verdict: Promise<HeldVerdict> } | null = null;
  private get data(): Stored | null { return this.held; }
  private set data(value: Stored | null) { this.held = value; this.epoch++; }
  /**
   * P05: this placement's published position-policy history, as last read from
   * or written to its one copy in storage (`positionHistoryKey`); null until
   * first needed. This object is its only writer.
   */
  private positionPolicies: { key: string; policies: PositionPolicy[] } | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private lastAllocated = 0;
  private synthetic: SyntheticObjectBoundary;
  constructor(private state: DurableObjectState, private env: Env) {
    this.synthetic = new SyntheticObjectBoundary(state, env, 'LEARN_STATS', () => { this.data = null; this.lastAllocated = 0; this.positionPolicies = null; });
    this.state = this.synthetic.state; this.env = this.synthetic.env;
  }

  async fetch(request: Request): Promise<Response> {
    return this.synthetic.run(request, () => this.fetchScoped(request)).catch(error => failure(error));
  }

  private async fetchScoped(request: Request): Promise<Response> {
    try {
      const path = new URL(request.url).pathname;
      if (path === '/monitor-effects') {
        const scope = syntheticOperation(), b = await input(request);
        if (!scope || !Array.isArray(b.effects) || !b.effects.length || b.effects.length > 16) throw invalid();
        return this.serialize(async () => {
          const d = await this.loadIfAny(); let complete = !!d && d.tenant === scope.tenant && d.brand === scope.tenant;
          for (const raw of b.effects as Array<Record<string, unknown>>) {
            if (!['exposures', 'credits'].includes(String(raw.kind)) || typeof raw.decision !== 'string' || typeof raw.item !== 'string'
              || raw.kind === 'credits' && typeof raw.outcome !== 'string') throw invalid();
            const id = await learningEffectId(raw.kind as 'exposures' | 'credits', statsName(scope.tenant, scope.tenant, String(d?.slot), d?.page), raw.decision, raw.outcome as string | undefined);
            const marker = d?.effects?.[id]; complete &&= !!marker && marker.subject === scope.subject && marker.item === raw.item && marker.expiresAt > Date.now();
          }
          if (complete && d) {
            // Ingestion markers do not prove serving publication. Exercise the
            // actual immutable archive and KV publication, then read back the
            // same current snapshot before reporting a completed monitor.
            const snapshot = await this.publish();
            if (!snapshot) complete = false;
            else {
              const [archive, cached] = await Promise.all([
                this.env.STORAGE.get(liftArchiveKey(d.tenant, d.brand, d.slot, snapshot.version, d.page)),
                this.env.CACHE.get(liftKey(d.tenant, d.brand, d.slot, d.page), 'json'),
              ]);
              complete = !!archive && await recoveryDigest(await archive.json()) === await recoveryDigest(snapshot)
                && await recoveryDigest(cached) === await recoveryDigest(snapshot);
            }
          }
          return json({ complete });
        });
      }
      if (path === '/health' || path === '/recovery' || path === '/recover') {
        const b = await input(request);
        if (!component(b.tenant) || !component(b.brand) || !slotName(b.slot) || !pageValid(b.page)) throw invalid();
        // A read-only committed-state health query must not queue behind an
        // unrelated archive/KV publication wait.
        return await (path === '/health' ? this.recoveryControl(b, path) : this.serialize(() => this.recoveryControl(b, path)));
      }
      if (path === '/witness') {
        // P62 (amendment 6, R-P110): the decision path's light witness door,
        // answered from the verdict held for the committed state (never queued,
        // as `/health` is not); `/health` stays as it is for operators.
        const b = await input(request);
        if (!component(b.tenant) || !component(b.brand) || !slotName(b.slot) || !pageValid(b.page)) throw invalid();
        return await this.witnessDoor(b);
      }
      if (path === '/generation') {
        const b = await input(request);
        if (!Array.isArray(b.items) || b.items.length > LEARN_LIMITS.items || b.items.some(item => !itemName(item))) throw invalid();
        const items = b.items;
        return await this.serialize(async () => {
          const fence = await this.fence();
          const current = await this.loadIfAny(); if (current) await this.totalBound(current, fence);
          // The first generation is durable before it can be included in a plan.
          await this.state.storage.put('learnFence', fence);
          return json({ ok: true, whole: fence.whole, items: Object.fromEntries(items.map(item => [String(item), fence.items[String(item)] ?? 0])) });
        });
      }
      if (path === '/erase-effects' || path === '/cleanup-effects') {
        const b = await input(request);
        if (!component(b.tenant) || !component(b.subject) || (path === '/erase-effects' && !time(b.cutoff))) throw invalid();
        return await this.serialize(async () => {
          const current = await this.loadIfAny();
          if (current && current.tenant !== b.tenant) throw invalid();
          const barrier = await loadTombstone(this.env.STORAGE, b.tenant as string, b.subject as string);
          if (path === '/erase-effects' && (!barrier || barrier.erased_at < (b.cutoff as number))) throw invalid();
          const candidate = current && structuredClone(current);
          let next = Infinity;
          if (candidate?.effects) {
            for (const [id, marker] of Object.entries(candidate.effects)) if (marker.subject === b.subject) {
              if (b.retired === true && marker.expiresAt > Date.now()) {
                (candidate.retiredEffects ??= {})[id] = { digest: marker.digest, expiresAt: marker.expiresAt };
                delete candidate.effects[id];
              } else if (marker.expiresAt <= Date.now() || barrier && marker.ts <= barrier.erased_at) delete candidate.effects[id];
              else next = Math.min(next, marker.expiresAt);
            }
            await this.commit(candidate);
            if (b.retired === true) await this.arm();
          }
          // W22 D1.02: the journal holds decision ids, which carry the subject,
          // so erasure removes hers from it exactly as it removes her markers.
          const journal = await this.seenExposures();
          const remaining = journal.filter(row => row.id.split(':')[2] !== b.subject);
          if (remaining.length !== journal.length) await this.rememberExposures(remaining);
          if (Number.isFinite(next)) {
            const prior = await this.state.storage.getAlarm();
            if (prior === null || prior > next) await this.state.storage.setAlarm(next);
          }
          return json({ ok: true, complete: !Number.isFinite(next), ...(Number.isFinite(next) ? { next } : {}) });
        });
      }
      if (path === '/exposures' || path === '/credits') {
        const kind = path === '/exposures' ? 'exposures' : 'credits', b = await input(request), raw = b[kind];
        if (!component(b.tenant) || !component(b.brand) || !slotName(b.slot) || !pageValid(b.page) || !Array.isArray(raw)
          || !configValid(b.config)) throw invalid();
        const rows = rowsOf(raw, kind);
        const managed = b.version === 2;
        if ((b.version !== undefined && b.version !== 2) || (managed ? rows.length !== raw.length || rows.some(row => !row.effect) : rows.some(row => row.effect))) throw invalid();
        return await this.writeRows(kind, raw.length, b.tenant, b.brand, b.slot, b.config, rows, managed, b.page as string | undefined);
      }
      if (path === '/pooled') {
        // P08 (decisions D1, D2): this placement's own counters for the pooled
        // modules another placement's publication reads into each module's ONE
        // record, with what they mean (`accumulationOf`). A read of COMMITTED
        // state, never queued behind this object's own work and never caching
        // anything, so two placements publishing at once never wait on each other.
        const b = await input(request);
        if (!component(b.tenant) || !component(b.brand) || !slotName(b.slot) || !pageValid(b.page) || !Array.isArray(b.items)
          || b.items.length > LEARN_LIMITS.items || b.items.some(item => !itemName(item))) throw invalid();
        const current = await this.committed();
        if (current && (current.tenant !== b.tenant || current.brand !== b.brand || current.slot !== b.slot || !samePage(current, b.page))) throw recovery();
        const items: Record<string, Record<string, Counter>> = {};
        if (current) for (const item of b.items as string[]) if (Object.hasOwn(current.stats.items, item)) items[item] = current.stats.items[item]!;
        return json({ ok: true, config: current ? accumulationOf(current.config) : null, items });
      }
      if (path === '/snapshot') {
        const snapshot = await this.serialize(() => this.currentSnapshot());
        return json({ ok: true, snapshot });
      }
      /**
       * W24 G1.02: the authorized accumulation transition, on its OWN path.
       * `/generation` is this object's fence endpoint and stays exactly what it
       * is — the numeric per-item recovery generation a managed plan is pinned
       * to — and this is the transition that changes what the counters MEAN.
       */
      if (path === '/transition') {
        const b = await input(request);
        if (!component(b.tenant) || !component(b.brand) || !slotName(b.slot) || !pageValid(b.page)
          || typeof b.operationId !== 'string' || !/^[a-f0-9]{32}$/.test(b.operationId)
          || (b.reward !== undefined && (typeof b.reward !== 'string' || !rewards.has(b.reward)))
          || (b.objective !== undefined && (typeof b.objective !== 'string' || !['unit', 'revenue', 'margin'].includes(b.objective)))
          || (b.rebuildFrom !== undefined && (typeof b.rebuildFrom !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.rebuildFrom)))) throw invalid();
        return await this.serialize(() => this.transition(b));
      }
      if (path === '/publish') {
        const snap = await this.serialize(() => this.publish());
        return json({ ok: true, published: snap !== null, snapshot: snap });
      }
      if (path === '/reset') {
        await this.serialize(async () => {
          try {
            const saved = await this.state.storage.get('learnFence');
            const current = await this.state.storage.get<Stored>('learn');
            // W23 R2 (LANE-LOG R209): an object that carries a rebuild basis is
            // never wiped whole, because `deleteAll` would take the basis with it.
            if (saved === undefined && !current?.stats?.bounded && await this.state.storage.get('learnReset') === undefined
              && await this.state.storage.get(REBUILT_KEY) === undefined && this.env.LEDGER_RECOVERY_ENABLED !== 'true') await this.state.storage.deleteAll();
            else {
              const fence = await this.fence();
              if (!Number.isSafeInteger(fence.whole + 1)) throw recovery();
              await this.state.storage.transaction(async tx => {
                await tx.put('learnFence', { whole: fence.whole + 1, items: {} });
                // The counters go, and so does the accumulation transition that
                // started them (W24). The rebuild basis STAYS, byte for byte
                // (W23 R2, LANE-LOG R209): a reset removes evidence and never
                // restores any, so whatever this object counts afterwards still
                // stands on that repair and holds none of the history before it.
                // Dropping the basis here would let the next snapshot read as the
                // tenant's whole history. It names the audited operation that
                // made it, its moment, the generation it moved to then and, for a
                // ledger rebuild, the retained day; only a later explicit reset or
                // a ledger rebuild replaces it.
                await tx.delete('learn'); await tx.delete(SEEN_KEY); await tx.delete(GENERATION_KEY);
              });
            }
          } finally { this.data = null; }
        });
        return json({ ok: true, reset: true });
      }
      if (path === '/reset-item') {
        const b = await input(request); if (!itemName(b.item)) throw invalid();
        if (b.publication !== undefined || b.operationId !== undefined) return await this.serialize(() => this.publishedReset(b));
        const had = await this.serialize(async () => {
          const current = await this.loadIfAny();
          const fenced = await this.state.storage.get('learnFence') !== undefined || await this.state.storage.get('learnPublished') !== undefined
            || !!current?.stats.bounded || this.env.LEDGER_RECOVERY_ENABLED === 'true';
          if (fenced) {
            const fence = await this.fence(), item = b.item as string;
            if (!(item in fence.items) && Object.keys(fence.items).length >= LEARN_LIMITS.items) throw capacity();
            fence.items[item] = (fence.items[item] ?? 0) + 1;
            if (!Number.isSafeInteger(fence.items[item])) throw recovery();
            const candidate = current && structuredClone(current), had = !!candidate && Object.hasOwn(candidate.stats.items, item);
            if (candidate) {
              delete candidate.stats.items[item];
              for (const [id, marker] of Object.entries(candidate.effects ?? {})) if (marker.item === item) delete candidate.effects![id];
              stateValid(candidate);
              await this.totalBound(candidate, fence);
            }
            try {
              await this.state.storage.transaction(async tx => { await tx.put('learnFence', fence); if (candidate) await tx.put('learn', candidate); });
            } finally { this.data = null; }
            if (had) try { await this.publish(); } catch { throw new Error('statistics publication unavailable'); }
            return had;
          }
          if (!current || !Object.prototype.hasOwnProperty.call(current.stats.items, b.item as string)) return false;
          const candidate = structuredClone(current); delete candidate.stats.items[b.item as string];
          await this.commit(candidate);
          // Publication can refuse after the deletion committed: never report applied:false.
          try { await this.publish(); } catch { throw new Error('statistics publication unavailable'); }
          return true;
        });
        return json({ ok: true, item: b.item, had });
      }
      return json({ ok: false, error: 'not found' }, 404);
    } catch (error) { return failure(error); }
  }

  async alarm(): Promise<void> { return this.synthetic.run(undefined, () => this.alarmScoped()); }
  private async alarmScoped(): Promise<void> { await this.serialize(async () => {
    const current = await this.loadIfAny();
    if (current?.effects || current?.retiredEffects) {
      const candidate = structuredClone(current);
      for (const [id, marker] of Object.entries(candidate.effects ?? {})) if (marker.expiresAt <= Date.now()) delete candidate.effects![id];
      for (const [id, marker] of Object.entries(candidate.retiredEffects ?? {})) if (marker.expiresAt <= Date.now()) delete candidate.retiredEffects![id];
      await this.commit(candidate);
    }
    try { await this.publish(); }
    finally {
      const expiry = [...Object.values(this.data?.effects ?? {}), ...Object.values(this.data?.retiredEffects ?? {})].map(marker => marker.expiresAt).filter(at => at > Date.now());
      if (expiry.length) {
        const next = Math.min(...expiry), currentAlarm = await this.state.storage.getAlarm();
        if (currentAlarm === null || currentAlarm <= Date.now() || currentAlarm > next) await this.state.storage.setAlarm(next);
      }
    }
  }); }

  private async fence(): Promise<GenerationFence> {
    const value = await this.state.storage.get<GenerationFence>('learnFence') ?? { whole: 0, items: {} };
    if (!fields(value, ['whole', 'items']) || !Number.isSafeInteger(value.whole) || value.whole < 0 || !object(value.items)
      || Object.keys(value.items).length > LEARN_LIMITS.items || Object.entries(value.items).some(([key, n]) => !itemName(key) || !Number.isSafeInteger(n) || n < 0)) throw recovery();
    return structuredClone(value);
  }

  private async loadIfAny(): Promise<Stored | null> {
    if (this.data) return this.data;
    const stored: unknown = await this.state.storage.get('learn');
    if (stored === undefined) return null;
    try { stateValid(stored); } catch { throw recovery(); }
    this.data = stored; return stored;
  }

  /** P08: the committed state, read without caching it, for a read that is not serialized (`/pooled`). */
  private async committed(): Promise<Stored | null> {
    if (this.data) return this.data;
    const stored: unknown = await this.state.storage.get('learn');
    if (stored === undefined) return null;
    try { stateValid(stored); } catch { throw recovery(); }
    return stored;
  }

  private async candidate(tenant: string, brand: string, slot: string, config: SlotLearnConfig, page?: string): Promise<Stored> {
    const existing = await this.loadIfAny();
    if (existing && (existing.tenant !== tenant || existing.brand !== brand || existing.slot !== slot || !samePage(existing, page))) throw recovery();
    // A forward anchor only: the stored tuple does not attest to legacy history.
    if (existing && (existing.config.reward !== config.reward
      || (existing.config.objective ?? 'unit') !== (config.objective ?? 'unit')
      || (existing.config.measurementBasis ?? 'served-v1') !== (config.measurementBasis ?? 'served-v1')
      || existing.config.stats.tauLearnMs !== config.stats.tauLearnMs)) {
      throw new Refusal(409, 'statistics configuration incompatible');
    }
    return existing ? { ...structuredClone(existing), config }
      : { tenant, brand, slot, ...(page ? { page } : {}), config, stats: { ...emptyStats(), bounded: { depth: 5, omitted: { n: { s: 0, t: 0 }, s: {} }, omittedEvents: 0, selection: 'first-seen' } } };
  }

  private async commit(candidate: Stored): Promise<void> {
    this.fit(candidate); await this.totalBound(candidate);
    try { await this.state.storage.put('learn', candidate); }
    catch (error) { this.data = null; throw error; }
    this.data = candidate;
    this.verdict = committedVerdict(candidate, this.epoch);
  }

  private writeRows(kind: StatsWriteReceipt['kind'], received: number, tenant: string, brand: string, slot: string,
    config: SlotLearnConfig, rows: Row[], managed = false, page?: string): Promise<Response> {
    return this.serialize(async () => {
      const candidate = await this.candidate(tenant, brand, slot, config, page);
      const fence = managed ? await this.fence() : null;
      // W22 D1.02: the unmanaged online path's own idempotence. The managed
      // path already proves it with effect markers, so the journal is read only
      // where there are none.
      // W23 T1.01/T1.02: the object's own present, read once so every row of one
      // batch is folded against the same clock and the arithmetic cannot depend
      // on how long the batch took. Rows stamped before it keep their own time
      // exactly; a row stamped after it is still counted, at the present.
      const engineNow = Date.now();
      const journal = !managed && kind === 'exposures' ? await this.seenExposures() : null;
      // P36 (R-P52): a bounded object counts each row under the tenant's own
      // terms — its channel ids and its published cut's buckets — so a tenant
      // with a context vocabulary learns in its own cells; anything else, and
      // every value of a tenant without the settings outside today's six words
      // and three buckets, is counted under unknown exactly as before.
      const terms = candidate.stats.bounded ? await this.contextTerms(tenant) : TODAY_TERMS;
      // P05 (decision D2): a credit that names its position is weighed by the
      // position policy in force when it happened — the newest this object had
      // published at or before the credit's time — exactly as the hourly fold
      // weighs it. A history that cannot be read weighs nothing: the credit is
      // applied exactly as before.
      let policies: readonly PositionPolicy[] | null = null;
      if (kind === 'credits' && rows.some(row => row.position !== undefined)) {
        try { policies = await this.positionHistory(candidate); } catch { policies = null; }
      }
      const applied = journal ? new Set(journal.map(row => `${row.id}:${row.digest}`)) : null;
      const added: SeenExposure[] = [];
      let newlyApplied = 0, alreadyApplied = 0, suppressed = 0;
      if (managed) {
        candidate.effects ??= {};
        for (const [id, marker] of Object.entries(candidate.effects)) if (marker.expiresAt <= Date.now()) delete candidate.effects[id];
        for (const [id, marker] of Object.entries(candidate.retiredEffects ?? {})) if (marker.expiresAt <= Date.now()) delete candidate.retiredEffects![id];
      }
      for (const row of rows) {
        if (managed) {
          const effect = row.effect;
          if (!fields(effect, ['version', 'id', 'decision', 'outcome', 'tenant', 'subject', 'generation', 'retention', 'consentUntil'])
            || effect.version !== 1 || effect.tenant !== tenant || !component(effect.subject) || typeof effect.decision !== 'string'
            || !fields(effect.generation, ['whole', 'item']) || !time(effect.consentUntil)
            || effect.consentUntil <= Date.now() || effect.id !== await learningEffectId(kind, statsName(tenant, brand, slot, page), effect.decision, effect.outcome)) throw invalid();
          const expected = effect.generation as LearningGeneration;
          if (expected.whole !== fence!.whole || expected.item !== (fence!.items[row.item] ?? 0)) throw new Refusal(409, 'statistics generation changed');
          const retention = requireRetention(this.env, effect.retention, tenant, 'online');
          const barrier = await loadTombstone(this.env.STORAGE, tenant, effect.subject);
          if (barrier && row.ts <= barrier.erased_at) { suppressed++; continue; }
          const digest = await recoveryDigest({ kind, tenant, brand, slot, ...(page ? { page } : {}), config, row }), prior = candidate.effects![effect.id];
          const retired = candidate.retiredEffects?.[effect.id];
          if (retired) { if (retired.digest !== digest) throw new Refusal(409, 'statistics effect conflict'); suppressed++; continue; }
          if (prior) {
            if (prior.digest !== digest) throw new Refusal(409, 'statistics effect conflict');
            alreadyApplied++; continue;
          }
          if (Object.keys(candidate.effects!).length + Object.keys(candidate.retiredEffects ?? {}).length >= RECOVERY_LIMITS.effects) throw capacity();
          candidate.effects![effect.id] = { digest, subject: effect.subject, ts: row.ts,
            expiresAt: Math.min(retention.expiresAt, effect.consentUntil), item: row.item };
        }
        // A redelivered exposure is not applied a second time. It is reported as
        // PROCESSED, not skipped: the delivery is complete — this object already
        // holds that impression — and a skip would tell the fan-out it failed.
        // The key is the decision's logical id AND the digest of the record it
        // was served from: a different record under the same id is a different
        // event and is applied, never silently dropped (F16 §5(j)).
        if (applied && row.decision && row.digest) {
          const key = `${row.decision}:${row.digest}`;
          if (applied.has(key)) continue;
          applied.add(key); added.push({ id: row.decision, digest: row.digest, ts: row.ts });
        }
        const cell = candidate.stats.bounded ? { ...row.cell, channel: channelIn(row.cell.channel, terms.published ? terms.channels : null) ?? 'unknown',
          visit_bucket: terms.buckets.includes(row.cell.visit_bucket) ? row.cell.visit_bucket : 'unknown',
          stage: ['early', 'mid', 'late'].includes(row.cell.stage ?? '') ? row.cell.stage : 'unknown' } as Cell : row.cell;
        if (kind === 'exposures') recordExposure(candidate.stats, row.item, cell, row.ts, candidate.config.stats, engineNow);
        else recordSuccess(candidate.stats, row.item, cell, row.reward!, row.ts, row.weight! * positionWeightAt(policies, row.position, row.ts), candidate.config.stats, engineNow);
        // P05 (decision D1): the adjacent swaps' evidence. A swapped decision is
        // counted once, when its module at the pair's lower position is exposed;
        // a click credited to either module it exchanged is counted at the
        // position that module was served at. Counted exactly when the row is
        // applied, so a redelivery recognized above counts nothing again.
        if (row.swap) {
          const pair = ((candidate.positions ??= {})[String(row.swap[0])] ??= { pairs: 0, first: 0, second: 0 });
          if (kind === 'exposures') { if (row.position === row.swap[0]) pair.pairs += 1; }
          else if (row.reward === 'click') { if (row.position === row.swap[0]) pair.first += 1; else pair.second += 1; }
        }
        this.fit(candidate);
        newlyApplied++;
      }
      // Hashing and barrier reads above may yield past any earlier row's deadline.
      for (const row of rows) if (managed) {
        requireRetention(this.env, row.effect!.retention, tenant, 'online');
        if (row.effect!.consentUntil <= Date.now()) throw invalid();
      }
      if (managed) {
        this.fit(candidate); await this.totalBound(candidate);
        try { await this.state.storage.transaction(async tx => {
          await tx.put('learnFence', fence!);
          for (const row of rows) {
            requireRetention(this.env, row.effect!.retention, tenant, 'online');
            if (row.effect!.consentUntil <= Date.now()) throw invalid();
          }
          await tx.put('learn', candidate);
        }); }
        catch (error) { this.data = null; throw error; }
        this.data = candidate;
        this.verdict = committedVerdict(candidate, this.epoch);
      } else await this.commit(candidate);
      if (journal && added.length) await this.rememberExposures([...journal, ...added]);
      let alarm: StatsWriteReceipt['alarm'] = 'scheduled';
      try { await this.arm(); } catch { alarm = 'unknown'; }
      const receipt: StatsWriteReceipt = { version: managed ? 2 : 1, kind, received, processed: rows.length, skipped: received - rows.length, alarm,
        ...(managed ? { newlyApplied, alreadyApplied, suppressed } : {}) };
      return json({ ok: true, receipt });
    });
  }

  /** The journal as it stands, pruned to the online horizon. Never throws on a
   * shape it does not recognize: an unreadable journal means no repeat can be
   * recognized, which is the behaviour before it existed, never a refusal. */
  private async seenExposures(): Promise<SeenExposure[]> {
    let stored: unknown;
    try { stored = await this.state.storage.get(SEEN_KEY); } catch { return []; }
    if (!Array.isArray(stored)) return [];
    const now = Date.now(), out: SeenExposure[] = [];
    for (const entry of stored as unknown[]) {
      if (!fields(entry, ['id', 'digest', 'ts']) || typeof entry.id !== 'string' || !entry.id
        || typeof entry.digest !== 'string' || !/^[a-f0-9]{64}$/.test(entry.digest) || !time(entry.ts)) continue;
      if (now - (entry.ts as number) > ONLINE_RING_REACH_MS) continue;
      out.push({ id: entry.id, digest: entry.digest, ts: entry.ts as number });
    }
    return out;
  }
  /** Oldest first, inside both caps and inside the object's total bound. */
  private async rememberExposures(rows: SeenExposure[]): Promise<void> {
    try {
      const now = Date.now();
      let kept = rows.filter(row => now - row.ts <= ONLINE_RING_REACH_MS).sort((a, b) => a.ts - b.ts);
      if (kept.length > SEEN_MAX_ROWS) kept = kept.slice(-SEEN_MAX_ROWS);
      while (kept.length && bytes(kept) > SEEN_MAX_BYTES) kept = kept.slice(1);
      await this.totalBound(this.data, undefined, undefined, undefined, kept);
      await this.state.storage.put(SEEN_KEY, kept);
    } catch { /* a repeat this object cannot remember is applied again, never refused */ }
  }

  private async arm(): Promise<void> {
    await this.loadIfAny();
    const next = Math.min(Date.now() + PUBLISH_DELAY_MS, ...effectExpiries(this.data));
    const previous = await this.state.storage.getAlarm();
    if (previous === null || previous > next) await this.state.storage.setAlarm(next);
  }

  /**
   * W24 G1.02. The whole transition, under this object's own serialization:
   * the superseded published version is archived before anything replaces it,
   * the fence advances so nothing prepared against the old generation can land,
   * the counters go (or are rebuilt from one retained day), and the new
   * generation is published to the one key the serving path reads.
   */
  private async transition(b: Record<string, unknown>): Promise<Response> {
    const tenant = b.tenant as string, brand = b.brand as string, slot = b.slot as string, operationId = b.operationId as string;
    const page = b.page as string | undefined;
    const current = await this.loadIfAny();
    if (current && (current.tenant !== tenant || current.brand !== brand || current.slot !== slot || !samePage(current, page))) throw invalid();
    // The ESTIMATOR is never the operator's to move here: it is the tenant's
    // published document's, exactly as an ordinary write reads it.
    const pin = await pinPublication(this.env, tenant, true);
    const learn = await readPinnedPublication(this.env, LEARN_KIND, tenant, pin);
    const dials = learn.value.slots?.[slot];
    const config: SlotLearnConfig = {
      reward: (b.reward as RewardType | undefined) ?? current?.config.reward ?? dials?.reward ?? 'click',
      stats: learn.value.stats ?? DEFAULT_STATS,
      objective: (b.objective as 'unit' | 'revenue' | 'margin' | undefined) ?? current?.config.objective ?? dials?.objective ?? 'unit',
      measurementBasis: current?.config.measurementBasis ?? dials?.measurementBasis ?? 'served-v1',
    };
    if (!configValid(config)) throw invalid();
    // P50 (R-P78, D1): before anything is written, a transition that would leave
    // the slot counting nothing because it does not adopt a member a learn
    // republish changed is refused, naming the member and how to adopt it.
    const notAdopted = await this.notAdopted(current, config, learn, tenant, slot, page);
    if (notAdopted) throw new NotAdoptedRefusal(notAdopted, notAdoptedRefusalOf(notAdopted, tenant));
    const at = Date.now();
    // What this transition SUPERSEDES, preserved under its own version before
    // the new generation replaces it. A retained archive is never overwritten:
    // the body already stored under that version is the one it published.
    let archivedVersion: number | null = null;
    const head = await this.env.CACHE.get(liftKey(tenant, brand, slot, page), 'json') as LiftSnapshot | null;
    if (object(head) && Number.isSafeInteger(head.version) && head.version > 0
      && head.tenant === tenant && head.brand === brand && head.slot === slot) {
      const body = JSON.stringify(head);
      if (utf8.encode(body).length > LEARN_LIMITS.snapshotBytes) throw capacity();
      try {
        await this.env.STORAGE.put(liftArchiveKey(tenant, brand, slot, head.version, page), body, {
          onlyIf: new Headers({ 'If-None-Match': '*' }), httpMetadata: { contentType: 'application/json' },
        });
      } catch { throw new Refusal(503, 'statistics archive unavailable'); }
      archivedVersion = head.version;
    }
    const fence = await this.fence(), nextFence: GenerationFence = { whole: fence.whole + 1, items: {} };
    if (!Number.isSafeInteger(nextFence.whole)) throw recovery();
    let stats: StatsState = { ...emptyStats(), bounded: { depth: 5, omitted: { n: { s: 0, t: 0 }, s: {} }, omittedEvents: 0, selection: 'first-seen' } };
    let rebuiltFrom: AccumulationTransition['rebuiltFrom'];
    if (typeof b.rebuildFrom === 'string') {
      const day = await this.rebuildFromLedger(tenant, brand, slot, config, learn.value, b.rebuildFrom, at, page);
      stats = { ...day.stats, bounded: stats.bounded };
      rebuiltFrom = { date: b.rebuildFrom, decisions: day.decisions, outcomes: day.outcomes };
    }
    const candidate: Stored = { tenant, brand, slot, ...(page ? { page } : {}), config, stats };
    this.fit(candidate);
    const record: AccumulationTransition = { operationId, at, reward: config.reward,
      objective: config.objective ?? 'unit', measurementBasis: config.measurementBasis ?? 'served-v1',
      ...(rebuiltFrom ? { rebuiltFrom } : {}) };
    // W23 H1.01's vocabulary: a basis describes the repair the counters standing
    // now were started on. A rebuild has one; a transition that discards them has
    // none, so any basis describing the discarded counters goes with them.
    const basis: RebuildBasis | null = rebuiltFrom
      ? { basis: 'ledger-rebuild', operationId, at, generation: nextFence.whole, date: rebuiltFrom.date } : null;
    await this.totalBound(candidate, nextFence, undefined, undefined, undefined, record);
    try {
      await this.state.storage.transaction(async tx => {
        await tx.put('learnFence', nextFence);
        await tx.put('learn', candidate);
        await tx.put(GENERATION_KEY, record);
        await tx.delete(SEEN_KEY);
        if (basis) await tx.put(REBUILT_KEY, basis); else await tx.delete(REBUILT_KEY);
      });
    } finally { this.data = null; }
    // The fresh generation is published at once, so no isolate and no cache can
    // go on serving the generation this one superseded.
    let publicationOutcome = 'acknowledged';
    let failed: unknown = null;
    try { await this.publish(true); } catch (error) { publicationOutcome = 'unknown'; failed = error; }
    // P55 (R-P78, D1): this transition adopted the republish P49's record names,
    // so where its own publication did not succeed the record no longer holds the
    // slot; unless that publication was itself refused for a republish, whose record
    // it has just written.
    if (publicationOutcome === 'unknown' && !(failed instanceof RepublishRefusal)) await this.supersedeRepublished(tenant, brand, slot, page, head);
    return json({ ok: true, generation: accumulationGeneration({ objective: record.objective, reward: record.reward, tauLearnMs: config.stats.tauLearnMs }, at),
      restartedAt: at, archivedVersion, publicationOutcome, ...(rebuiltFrom ? { rebuiltFrom } : {}) });
  }

  /**
   * P55 (R-P78, decision D1): after a generation transition's transaction, when its
   * own publication did not succeed, P49's record for the placement — read once,
   * under its own key — is superseded with one put under that same key
   * (`supersededRecordOf`) if it still holds the slot, that is if it names the
   * snapshot that was in force when the transition started (`head`, which the
   * failed publication left in force). A placement with no record, a record that
   * cannot be read or is not one, and a record that had already lapsed are left
   * as they are, and nothing else is written. A successful publication never comes
   * here: it ends the record by version, as before. Where the read or the put
   * fails, the transition answers as it would have and the reads keep the record.
   */
  private async supersedeRepublished(tenant: string, brand: string, slot: string, page: string | undefined, head: unknown): Promise<void> {
    const key = liftRepublishedKey(tenant, brand, slot, page);
    try {
      const record = republishedRecordOf(await this.env.CACHE.get(key, 'json'));
      if (record && republishedIn(record, head)) await this.env.CACHE.put(key, JSON.stringify(supersededRecordOf(record)));
    } catch { /* the reads keep the record until a publication succeeds, as before */ }
  }

  /**
   * P50 (R-P78, decision D1): what the transition about to start does not adopt,
   * or null. A member of the tuple (`ADOPTED_MEMBERS`) is CHANGED when its value in
   * the learn document in force differs from the slot's accumulation's own value,
   * and NOT ADOPTED when the accumulation this transition would start does not
   * take the document's value for it. The one exception is a slot moved ahead of a
   * document that has not changed for that slot: with a generation record on file,
   * a member whose value for this slot, in every learn revision published after the
   * record's `at`, is what it was in the latest revision published at or before
   * that `at` is not changed. With no record on file, or a history that cannot be
   * read (a damaged record, no such revision readable, a read failing, or more than
   * `TRANSITION_HISTORY_READS` revisions), any difference counts. An object that
   * holds no accumulation, and a transition that adopts every changed member, read
   * nothing more than today and are answered as today.
   */
  private async notAdopted(current: Stored | null, config: SlotLearnConfig, learn: { revision: number; at: number; value: Parameters<typeof slotTuple>[0] },
    tenant: string, slot: string, page: string | undefined): Promise<NotAdopted | null> {
    if (!current) return null;
    const held: Record<NotAdoptedChange['member'], string> = { measurementBasis: current.config.measurementBasis ?? 'served-v1',
      objective: current.config.objective ?? 'unit', reward: current.config.reward };
    const starting: Record<NotAdoptedChange['member'], string> = { measurementBasis: config.measurementBasis ?? 'served-v1',
      objective: config.objective ?? 'unit', reward: config.reward };
    const documented = slotTuple(learn.value, slot);
    const candidates = ADOPTED_MEMBERS.filter(member => documented[member] !== held[member] && starting[member] !== documented[member]);
    if (!candidates.length) return null;
    let unchanged: (member: NotAdoptedChange['member']) => boolean = () => false;
    try {
      const record = await this.accumulationTransition();
      if (record) {
        let baseline: Record<NotAdoptedChange['member'], string> | null = null;
        const later: Array<Record<NotAdoptedChange['member'], string>> = [];
        for (let n = learn.revision; n >= 1 && learn.revision - n <= TRANSITION_HISTORY_READS; n--) {
          const revision = n === learn.revision ? learn : await publicationVersion(this.env, LEARN_KIND, tenant, n);
          if (!revision) break;
          const values = slotTuple(revision.value, slot);
          if (revision.at <= record.at) { baseline = values; break; }
          later.push(values);
        }
        const since = baseline;
        if (since) unchanged = member => later.every(values => values[member] === since[member]);
      }
    } catch { unchanged = () => false; /* a history that cannot be read admits nothing silently */ }
    const changed = candidates.filter(member => !unchanged(member)).map(member => ({ member, new: documented[member], old: held[member] }));
    if (!changed.length) return null;
    // Formed from checked values, so always well formed; where it could not be, the transition is still refused.
    const member = notAdoptedOf({ changed, ...(page ? { page } : {}), slot });
    if (!member) throw recovery();
    return member;
  }

  /**
   * W24 T1.02: one retained day, folded into this slot's counters the way the
   * batch folds it, under the tenant's own published learning policy. A day the
   * reader cannot read WHOLE is refused rather than folded in part: a rebuild
   * that silently dropped evidence would be exactly the untrustworthy rebuild
   * the ruling forbids.
   */
  private async rebuildFromLedger(tenant: string, brand: string, slot: string, config: SlotLearnConfig,
    learn: Parameters<typeof policyOf>[0], date: string, at: number, page?: string): Promise<{ stats: StatsState; decisions: number; outcomes: number }> {
    const decisions = await loadDay<DecisionRecord>(this.env.STORAGE, tenant, date, 'decision', REPORT_LIMITS.records);
    const outcomes = await loadDay<import('@/ledger/records').OutcomeRecord>(this.env.STORAGE, tenant, date, 'outcome', REPORT_LIMITS.records);
    if (decisions.truncated || outcomes.truncated) throw capacity();
    return foldRetainedDay({ tenant, brand, slot, config, policy: policyOf(learn),
      decisions: decisions.records, outcomes: outcomes.records, at, ...(page ? { page } : {}) });
  }

  /** W24 G1.01/G1.02: the authorized transition on record, or undefined. Damaged is refused, never ignored. */
  private async accumulationTransition(): Promise<AccumulationTransition | undefined> {
    const value: unknown = await this.state.storage.get(GENERATION_KEY);
    if (value === undefined) return undefined;
    if (!fields(value, ['operationId', 'at', 'reward', 'objective', 'measurementBasis', 'rebuiltFrom'])
      || typeof value.operationId !== 'string' || !/^[a-f0-9]{32}$/.test(value.operationId) || !time(value.at)
      || typeof value.reward !== 'string' || !rewards.has(value.reward)
      || !['unit', 'revenue', 'margin'].includes(String(value.objective))
      || !['served-v1', 'rendered-v1'].includes(String(value.measurementBasis))
      || (value.rebuiltFrom !== undefined && (!fields(value.rebuiltFrom, ['date', 'decisions', 'outcomes'])
        || typeof value.rebuiltFrom.date !== 'string' || !Number.isSafeInteger(value.rebuiltFrom.decisions)
        || !Number.isSafeInteger(value.rebuiltFrom.outcomes)))) throw recovery();
    return value as unknown as AccumulationTransition;
  }

  private async snapshot(d: Stored): Promise<LiftSnapshot> {
    const priors = await this.priorsFor(d);
    // W22 A1.01: the online path has the tenant's published policy in scope
    // here — `priorsFor` has just read the same learn document against which
    // this object's configuration is checked — so the snapshot declares the
    // window that document asks for, and the horizon the visitor's ring really
    // keeps (`ONLINE_RING_REACH_MS`, the ring's own age limit), never
    // a constant of its own.
    const contract = await this.attributionContract(d);
    // P08 (decisions D1, D2): each pooled module's ONE record, read from every
    // placement it is served in. Undefined for a catalogue that declares no
    // pooled module this slot serves, and then nothing below changes.
    const pooled = await this.pooledCounters(d);
    const isPooled = (item: string) => !!pooled && Object.hasOwn(pooled, item);
    // Count exactly the item/cell identities the builder will materialize.
    const byItem = new Map(Object.entries(d.stats.items).filter(([item]) => !isPooled(item)).map(([item, keys]) => [item, new Set(Object.keys(keys))]));
    const slotKeys = new Set(Object.keys(d.stats.slot));
    for (const [item, record] of Object.entries(pooled ?? {})) byItem.set(item, new Set(Object.keys(record)));
    for (const [item, cells] of priors?.index ?? []) {
      if (!itemName(item)) throw capacity();
      const keys = byItem.get(item) ?? new Set<string>();
      // P08: a prior cell is read under the ladder of the record it names (`buildSnapshot`).
      for (const cell of cells.keys()) if (cell === '*' || isPooledKey(cell) === isPooled(item)) keys.add(cell);
      byItem.set(item, keys);
    }
    if (byItem.size > LEARN_LIMITS.items) throw capacity();
    let count = 0;
    for (const keys of byItem.values()) for (const key of keys) {
      pooledKeyBound(key); count++;
      for (let k: string | null = unpagedKey(key); k !== null; k = parentKey(k)) slotKeys.add(k);
    }
    if (count + slotKeys.size > LEARN_LIMITS.counters) throw capacity();
    // W24 G1.01: a generation this object was actually restarted into dates
    // itself from that restart, and not from evidence it may not have yet.
    const restarted = await this.accumulationTransition();
    const snap = buildSnapshot(d.stats, d, d.config.reward, Date.now(), d.config.stats, priors, d.config.objective ?? 'unit', d.config.measurementBasis ?? 'served-v1', contract, restarted?.at, pooled);
    // P05 (decision D1): each position's effect from the slot's adjacent swaps, only where it has swapped.
    const effects = positionEffectsOf(d.positions);
    if (effects) snap.positionEffects = effects;
    snap.witness = await this.witness(d, await this.fence());
    // W23 H1.01: only an object that was actually repaired names a basis.
    const basis = await this.rebuiltFrom();
    if (basis) snap.rebuiltFrom = basis;
    if (bytes(snap) > LEARN_LIMITS.snapshotBytes) throw capacity();
    return snap;
  }

  /**
   * W25 N1.01 (doc 22 §8, F20 §4.5): the slot this object IS, for a slot that
   * holds imported priors and has never recorded an event.
   *
   * An object learns its tenant, brand and slot from the first write it is sent.
   * A slot whose only evidence is a prior has had no write, so without this it
   * could never publish the estimate the prior gives it, and a cold item would
   * wait for the very exposure the prior exists to avoid needing. The identity
   * is not guessed: it is the name this object was addressed by, CHECKED against
   * the namespace the way every other object here checks its own address
   * (`state.id` against `idFromName`, as `ShopperReflex` and `RegionTrend` do),
   * so an id that was not derived from a slot name answers nothing at all. The
   * configuration comes from the tenant's own published learning document, the
   * same read `priorsFor` verifies this object's stored configuration against.
   *
   * Nothing is written to storage here and `this.data` is not set: the estimator
   * still has no counters, and the first real write creates them as it always
   * did. This is an address and a published configuration, never evidence.
   */
  private async priorOnlyIdentity(): Promise<Stored | null> {
    const namespace = this.env.LEARN_STATS;
    const id: unknown = this.state.id;
    if (!namespace || !id) return null;
    const declared = (id as { name?: unknown }).name;
    const named = typeof declared === 'string' ? declared : String(id);
    const parts = named.split(':');
    if (parts.length < 3) return null;
    const [tenant, brand, ...rest] = parts;
    // W26 R2: a page-scoped placement is addressed as `slot@page`; the page is
    // part of the identity and the slot alone names its configuration.
    const placement = rest.join(':'), at = placement.lastIndexOf('@');
    const slot = at > 0 && isCatalogueName(placement.slice(at + 1)) ? placement.slice(0, at) : placement;
    const page = slot === placement ? undefined : placement.slice(at + 1);
    if (!component(tenant) || !component(brand) || !slotName(slot)) return null;
    if (namespace.idFromName(statsName(tenant, brand, slot, page)).toString() !== String(id)) return null;
    const pin = await pinPublication(this.env, tenant, true);
    const learn = await readPinnedPublication(this.env, LEARN_KIND, tenant, pin);
    const dials = learn.value.slots?.[slot];
    return { tenant, brand, slot, ...(page ? { page } : {}), stats: emptyStats(),
      config: { reward: dials?.reward ?? 'click', stats: learn.value.stats ?? DEFAULT_STATS,
        objective: dials?.objective ?? 'unit', measurementBasis: dials?.measurementBasis ?? 'served-v1' } };
  }

  /**
   * W25 R3 (LANE-LOG R183): what this object would publish now, answered on
   * `/snapshot` from the SAME identity and the same builder `publish()` uses.
   *
   * A slot that has recorded events answers from its counters, as it always did.
   * A slot that never recorded one has no stored state, and before this it
   * answered "nothing" even when W25 N1.01 had made it publishable on its
   * imported prior alone — so every reader of the object's own snapshot, the
   * monitor's sink comparison among them, saw a slot the serving path was
   * ranking as holding no estimate. It now answers the prior-derived snapshot,
   * under the same gate as publication: a never-written slot with nothing to
   * publish still answers null. Nothing is written. Where the tenant's published
   * documents cannot be read, the read fails exactly as its publication would,
   * rather than answering a "nothing" it did not establish.
   */
  private async currentSnapshot(): Promise<LiftSnapshot | null> {
    try {
      const stored = await this.loadIfAny();
      if (stored) return await this.snapshot(stored);
      const identity = await this.priorOnlyIdentity();
      if (!identity) return null;
      const snap = await this.snapshot(identity);
      return Object.keys(snap.items).length === 0 ? null : snap;
    } catch (error) {
      // P42: a read is not a publication; a pooled fault fails it exactly as before.
      throw error instanceof PooledFault ? error.original : error;
    }
  }

  /**
   * `force` (W24 G1.02): publish even when there is nothing to publish yet. A
   * generation transition MUST reach `liftKey`, because the point of it is that
   * the superseded generation stops being served; a fresh generation with
   * nothing learned yet is exactly what the serving path should read, and
   * `liftFor` answers "nothing learned" from it as it always has. It is the only
   * caller that passes it, and it never bypasses W25's gate for anyone else.
   */
  private async publish(force = false): Promise<LiftSnapshot | null> {
    const d = await this.loadIfAny() ?? await this.priorOnlyIdentity();
    if (!d) return null;
    // State/prior/snapshot refusals retain their existing semantics. Freeze the
    // estimates and publication time once; allocation never recomputes them.
    // P42 (R-P78, D1): the pooled cause alone is refused by name, through every
    // caller of this publication alike (the /publish door, the alarm and the rest).
    // P49 (R-P78, D1): and so is a learn republish that changed the slot's
    // accumulation tuple, which the configuration check meets first.
    const frozen = await this.snapshot(d).catch(async (error: unknown) => {
      throw error instanceof PooledFault ? await this.staleRefusal(d, error)
        : error instanceof RepublishFault ? await this.republishRefusal(d, error) : error;
    });
    // P05 (decision D2): the position policy this publication puts in force:
    // normalised only while the slot's switch is on in the tenant's learn
    // document AND the swaps have estimated a position's effect. The history is
    // consulted only for a slot that has swapped or holds a history already —
    // any other slot publishes exactly as before, reading nothing more — and it
    // is read before any write, so an unreadable one refuses the publication.
    const effects: Record<string, number> = {};
    for (const e of frozen.positionEffects ?? []) if (typeof e.effect === 'number' && e.effect > 0) effects[String(e.position)] = e.effect;
    const normalize = Object.keys(effects).length > 0 && await this.positionSwitch(d);
    const history = Object.keys(d.positions ?? {}).length > 0 || (this.positionPolicies?.policies.length ?? 0) > 0
      ? await this.positionHistory(d) : null;
    // W25 N1.01 (doc 22 §8, F20 §4.5): an item with an imported prior and no
    // live events yet HAS an estimate — that is what importing a prior is for —
    // so a slot whose only evidence is its priors publishes it, and a cold item
    // is ranked on the prior the day it is imported instead of on the day the
    // slot first records an event. The gate is not lifted, it is asked of the
    // snapshot rather than of the event counter: a slot with nothing at all to
    // publish still publishes nothing.
    if (!force && d.stats.events === 0 && Object.keys(frozen.items).length === 0) return null;
    let version = Math.max(frozen.version, this.lastAllocated + 1);
    try {
      for (let attempt = 0; attempt < 8; attempt++, version++) {
        if (!Number.isSafeInteger(version) || version <= 0) throw new Error('Snapshot version unavailable');
        const snap = { ...frozen, version }, body = JSON.stringify(snap), size = utf8.encode(body).length;
        if (size > LEARN_LIMITS.snapshotBytes) throw capacity();
        const publication = { witness: snap.witness, digest: await recoveryDigest(snap), version };
        await this.totalBound(d, undefined, publication);
        this.lastAllocated = version;
        const key = liftArchiveKey(d.tenant, d.brand, d.slot, version, d.page);
        const archived = await this.env.STORAGE.put(key, body, {
          onlyIf: new Headers({ 'If-None-Match': '*' }), httpMetadata: { contentType: 'application/json' },
        });
        if (archived === null) continue; // A retained key is never overwritten, including after reset/restart.
        // P05: a changed position policy is published before the snapshot reaches
        // the serving key, under this version as the moment it takes force.
        const nextHistory = history ? nextPositionHistory(history, { at: version, normalize, effects: normalize ? effects : {} }, Date.now()) : null;
        if (nextHistory) {
          const key = positionHistoryKey(d.tenant, d.brand, d.slot, d.page);
          await this.env.STORAGE.put(key, JSON.stringify({ version: 1, tenant: d.tenant, brand: d.brand, slot: d.slot, ...(d.page ? { page: d.page } : {}), policies: nextHistory }),
            { httpMetadata: { contentType: 'application/json' } });
          this.positionPolicies = { key, policies: nextHistory };
        }
        if (!archived || archived.key !== key || typeof archived.etag !== 'string' || !archived.etag.trim()
          || archived.etag.length > 256 || archived.size !== size) throw new Error('Archive acknowledgement unavailable');
        await this.state.storage.put('learnPublished', publication);
        await this.rememberPublication(d, publication, snap.publishedAt);
        await this.env.CACHE.put(liftKey(d.tenant, d.brand, d.slot, d.page), body);
        return snap;
      }
      throw new Error('Snapshot versions occupied');
    } catch (error) {
      if (error instanceof Refusal) throw error;
      // An archive or KV acknowledgement can be lost after its write. Keep any
      // orphan archive, schedule only publication again, and never claim rollback.
      // W27 R4 (amendment A19, LANE-LOG R161): the retry is due 30 seconds out,
      // but the alarm is also what removes a learning-effect marker at its
      // expiry, so it is set to the EARLIER of the two and a pending expiry is
      // never pushed later than it is due.
      await this.state.storage.setAlarm(Math.min(Date.now() + PUBLISH_DELAY_MS, ...effectExpiries(d)));
      throw new Error('Snapshot publication unavailable');
    }
  }

  /**
   * P42 (R-P78, decision D1): a publication refused because a sibling placement's
   * `/pooled` door could not be read is told, never hidden, and fail closed stays:
   * nothing is published and the snapshot in force keeps serving. The marker
   * (`StaleMarker`) names the faulty placement, the pooled modules this placement
   * reads from it and the snapshot in force (`lastPublished`, read from the
   * placement's own snapshot key; null where it has never published), and is
   * recorded under the placement's own marker key (`liftStaleKey`), which nothing
   * but this refusal writes: a publication that succeeds makes no new call and
   * keeps no new key, and the marker stops applying once the snapshot in force is
   * another one (`staleMarkerIn`). The refusal says the same in words
   * (`staleRefusalOf`). Where the snapshot in force cannot be read or is not this
   * placement's, the refusal is exactly what it was before; where recording the
   * marker fails, the refusal still names it and the lift reads cannot.
   */
  private async staleRefusal(d: Stored, fault: PooledFault): Promise<unknown> {
    let head: unknown;
    try { head = await this.env.CACHE.get(liftKey(d.tenant, d.brand, d.slot, d.page), 'json'); } catch { return fault.original; }
    let lastPublished: StaleMarker['lastPublished'] = null;
    if (head !== null && head !== undefined) {
      if (!object(head) || head.tenant !== d.tenant || head.brand !== d.brand || head.slot !== d.slot
        || !Number.isSafeInteger(head.version) || (head.version as number) <= 0 || !time(head.publishedAt)) return fault.original;
      lastPublished = { publishedAt: head.publishedAt as number, version: head.version as number };
    }
    const stale = staleMarkerOf({ lastPublished, modules: fault.modules, placement: { page: fault.page, slot: fault.slot } });
    if (!stale) return fault.original;
    try { await this.env.CACHE.put(liftStaleKey(d.tenant, d.brand, d.slot, d.page), JSON.stringify(stale)); }
    catch { /* the refusal still names the placement; only the reads go without the marker */ }
    return new StaleRefusal(stale);
  }

  /**
   * P49 (R-P78, decision D1): a publication refused by the configuration check
   * because the learn document was republished with a changed accumulation tuple is
   * told, never left bare, and fail closed stays: nothing is published and the
   * snapshot in force keeps serving. The member (`Republished`) names the slot (and
   * its page), each changed member with its old and new values, and what ends it;
   * it is recorded with the snapshot in force (read from the placement's own
   * snapshot key; null where it has never published) under the placement's own key
   * (`liftRepublishedKey`), which nothing but this refusal writes: a publication that
   * succeeds makes no new call and keeps no new key, and the member stops applying
   * once the snapshot in force is another one (`republishedIn`). The refusal says the
   * same in words (`republishedRefusalOf`). Where the member cannot be formed, or the
   * snapshot in force cannot be read or is not this placement's, the refusal is
   * exactly what it was before; where recording it fails, the refusal still names
   * it and the lift reads cannot.
   */
  private async republishRefusal(d: Stored, fault: RepublishFault): Promise<unknown> {
    const republished = republishedOf({ changed: fault.changed, endedBy: 'generation_transition', ...(d.page ? { page: d.page } : {}), slot: d.slot });
    if (!republished) return recovery();
    let head: unknown;
    try { head = await this.env.CACHE.get(liftKey(d.tenant, d.brand, d.slot, d.page), 'json'); } catch { return recovery(); }
    let lastPublished: { publishedAt: number; version: number } | null = null;
    if (head !== null && head !== undefined) {
      if (!object(head) || head.tenant !== d.tenant || head.brand !== d.brand || head.slot !== d.slot
        || !Number.isSafeInteger(head.version) || (head.version as number) <= 0 || !time(head.publishedAt)) return recovery();
      lastPublished = { publishedAt: head.publishedAt as number, version: head.version as number };
    }
    try { await this.env.CACHE.put(liftRepublishedKey(d.tenant, d.brand, d.slot, d.page), JSON.stringify({ lastPublished, republished })); }
    catch { /* the refusal still names the republish; only the reads go without the member */ }
    return new RepublishRefusal(republished, republishedRefusalOf(republished, d.tenant, lastPublished?.version ?? null));
  }

  /** P05: this placement's position-policy history, read once from its one copy and then held; a malformed copy refuses. */
  private async positionHistory(d: Pick<Stored, 'tenant' | 'brand' | 'slot' | 'page'>): Promise<PositionPolicy[]> {
    const key = positionHistoryKey(d.tenant, d.brand, d.slot, d.page);
    if (this.positionPolicies?.key === key) return this.positionPolicies.policies;
    const stored = await this.env.STORAGE.get(key);
    const policies = stored === null ? [] : positionHistoryOf(await stored.json(), { tenant: d.tenant, brand: d.brand, slot: d.slot, ...(d.page ? { page: d.page } : {}) });
    if (policies === null) throw recovery();
    this.positionPolicies = { key, policies };
    return policies;
  }

  /** P05 (decision D2): whether the slot's position-normalisation switch is on in the tenant's current learn document. */
  private async positionSwitch(d: Stored): Promise<boolean> {
    const pin = await pinPublication(this.env, d.tenant, true);
    const learn = await readPinnedPublication(this.env, LEARN_KIND, d.tenant, pin);
    return learn.value.slots?.[d.slot]?.positionNormalization === true;
  }

  /**
   * P36 (R-P52): the tenant's context terms, from its current learn publication,
   * read as this object already reads that document (`attributionContract`,
   * `priorsFor`). It cannot refuse a write: a publication that cannot be read
   * answers today's terms, so a row is then counted exactly as before.
   */
  private async contextTerms(tenant: string): Promise<ContextTerms> {
    try {
      const pin = await pinPublication(this.env, tenant, true);
      const learn = await readPinnedPublication(this.env, LEARN_KIND, tenant, pin);
      return contextTermsOf(learn.value.contextVocabulary);
    } catch { return TODAY_TERMS; }
  }

  /** The tenant's published attribution policy, as this object's own snapshot
   * declares it. Absent when the publication cannot be read: the snapshot then
   * carries no contract rather than a guessed one. */
  private async attributionContract(d: Stored): Promise<AttributionContract | undefined> {
    try {
      const pin = await pinPublication(this.env, d.tenant, true);
      const learn = await readPinnedPublication(this.env, LEARN_KIND, d.tenant, pin);
      return attributionContractOf(learn.value, ONLINE_RING_REACH_MS);
    } catch { return undefined; }
  }

  /**
   * P08 (decisions D1, D2; freeze item 27): the pooled records this placement
   * publishes. The catalogue in force says which modules it declares pooled; a
   * module this slot serves is one of them only where this object is one of the
   * module's placements (`pooledPlacementsOf`: a slot it names, on a page the
   * slots document carries the slot on, under W26 R2's own identity). Each such
   * module's evidence stays where it lands — every placement's own object — and
   * is read here from all of them, this one included: one counter list per
   * pooled key, `*` holding every page's root and `p=<page>…` each page's own
   * counters. A placement whose counters mean something else (another reward,
   * objective, measurement basis or decay horizon) is not part of this record.
   *
   * Read from the same publication set this object reads its priors and learn
   * document from. A catalogue that declares no pooled module this slot serves
   * reads nothing more and answers undefined, so its snapshot is exactly what it
   * was. Fails closed: an unreadable catalogue, slots document or placement
   * refuses the publication, as an unreadable prior does, and the snapshot in
   * force keeps serving; it never publishes a record that pools part of the
   * evidence.
   */
  private async pooledCounters(d: Stored): Promise<PooledCounters | undefined> {
    const pin = await pinPublication(this.env, d.tenant, true);
    const catalog = await readOptionalPinnedPublication(this.env, CONTENT_KIND, d.tenant, pin);
    const declared = (catalog?.value.pieces ?? []).filter(piece => piece.pooled === true && piece.slotTypes.includes(d.slot));
    if (!declared.length) return undefined;
    const slots = await readOptionalPinnedPublication(this.env, SLOTS_KIND, d.tenant, pin);
    const self = statsName(d.tenant, d.brand, d.slot, d.page);
    const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    const modules = new Map<string, Array<{ name: string; slot: string; page: string; identity?: string }>>();
    for (const [item, placements] of pooledPlacementsOf(declared, slots?.value)) {
      if (!itemName(item)) throw capacity();
      const named = placements.map(p => ({ ...p, name: statsName(d.tenant, d.brand, p.slot, p.identity) }))
        .sort((a, b) => order(a.page, b.page) || order(a.name, b.name));
      if (named.some(p => p.name === self)) modules.set(item, named);
    }
    if (!modules.size) return undefined;
    // One read per other placement, naming the pooled modules it serves.
    const wanted = new Map<string, { slot: string; page: string; identity?: string; items: Set<string> }>();
    for (const [item, placements] of modules) for (const p of placements) if (p.name !== self) {
      const entry = wanted.get(p.name) ?? { slot: p.slot, page: p.page, ...(p.identity ? { identity: p.identity } : {}), items: new Set<string>() };
      entry.items.add(item); wanted.set(p.name, entry);
    }
    const held = new Map<string, Readonly<Record<string, Record<string, Counter>>>>([[self, d.stats.items]]);
    // P42 (R-P78, D1): a placement whose door cannot be read is named, never
    // skipped (fail closed stays). Every read is awaited, and where several fail
    // the one named is the first in page, then slot, then object-name order, so
    // the same publication always names the same placement.
    if (wanted.size && !this.env.LEARN_STATS) throw recovery();
    const faults: PooledFault[] = [];
    await Promise.all([...wanted].map(async ([name, w]) => {
      const items = [...w.items].sort();
      try {
        const counters = await this.placementCounters(d, name, w.slot, w.identity, items);
        if (counters) held.set(name, counters);
      } catch (error) { faults.push(new PooledFault(name, w.page, w.slot, items, error)); }
    }));
    const fault = faults.sort((a, b) => order(a.page, b.page) || order(a.slot, b.slot) || order(a.objectName, b.objectName))[0];
    if (fault) throw fault;
    const out: PooledCounters = {};
    for (const item of [...modules.keys()].sort(order)) {
      const record: Record<string, Counter[]> = {};
      for (const p of modules.get(item)!) {
        const counters = held.get(p.name), byKey = counters && Object.hasOwn(counters, item) ? counters[item]! : null;
        if (!byKey) continue;
        for (const [key, c] of Object.entries(byKey)) {
          const at = key === '*' ? `p=${p.page}` : `p=${p.page}|${key}`;
          (record[at] ??= []).push(c);
          if (key === '*') (record['*'] ??= []).push(c);
        }
      }
      out[item] = record;
    }
    return out;
  }

  /**
   * P08: one other placement's counters for the pooled modules named, read
   * through its own `/pooled` door; null where its counters mean something else
   * than this object's (`accumulationOf`), so they are no part of its record.
   * Anything malformed or unanswered refuses (the publication then fails closed).
   */
  private async placementCounters(d: Stored, name: string, slot: string, page: string | undefined, items: string[]): Promise<Record<string, Record<string, Counter>> | null> {
    const namespace = this.env.LEARN_STATS;
    if (!namespace) throw recovery();
    const response = await namespace.get(namespace.idFromName(name)).fetch('https://learn/pooled', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant: d.tenant, brand: d.brand, slot, ...(page ? { page } : {}), items }) });
    if (!response.ok) throw recovery();
    const value: unknown = await response.json();
    if (!fields(value, ['ok', 'config', 'items']) || value.ok !== true || !object(value.items)) throw recovery();
    const config = value.config, mine = accumulationOf(d.config);
    if (config !== null && (!fields(config, ['reward', 'objective', 'measurementBasis', 'tauLearnMs']) || typeof config.reward !== 'string')) throw recovery();
    const out: Record<string, Record<string, Counter>> = {};
    for (const [item, byKey] of Object.entries(value.items)) {
      if (!items.includes(item) || !object(byKey)) throw recovery();
      for (const [key, c] of Object.entries(byKey)) { keyBound(key); if (!counterValid(c)) throw recovery(); }
      out[item] = byKey as Record<string, Counter>;
    }
    if (config === null) return out;
    return config.reward === mine.reward && config.objective === mine.objective && config.measurementBasis === mine.measurementBasis
      && config.tauLearnMs === mine.tauLearnMs ? out : null;
  }

  private async priorsFor(d: Stored): Promise<{ version: number; index: ReturnType<typeof indexPriors> } | null> {
    // Unavailable authority is not an explicit empty prior document. Never
    // publish a prior-free replacement merely because the authority failed.
    // Lane E2: a committed set that carries NO prior member is not a failure of
    // the authority. The sealed set is the authority's whole answer, and it says
    // this tenant has imported no priors (the demo bootstrap creates reflex,
    // catalog, slots and learn, and no prior). That reads as no priors, the
    // snapshot's `priorVersion` 0, and learns exactly what an empty document
    // does. A prior member the set lists and that cannot be read still refuses.
    const pin = await pinPublication(this.env, d.tenant, true);
    const [rev, learn] = await Promise.all([readOptionalPinnedPublication(this.env, PRIORS_KIND, d.tenant, pin), readPinnedPublication(this.env, LEARN_KIND, d.tenant, pin)]);
    const configured = { reward: learn.value.slots?.[d.slot]?.reward ?? 'click', stats: learn.value.stats ?? DEFAULT_STATS,
      objective: learn.value.slots?.[d.slot]?.objective ?? 'unit', measurementBasis: learn.value.slots?.[d.slot]?.measurementBasis ?? 'served-v1' };
    const stored = await recoveryDigest({ ...d.config, objective: d.config.objective ?? 'unit', measurementBasis: d.config.measurementBasis ?? 'served-v1' });
    if (await recoveryDigest(configured) !== stored) {
      // W24 G1.02: an AUTHORIZED transition is the one way this object's
      // accumulation may stand ahead of the tenant's document. The estimator is
      // still compared against the document exactly as before — only the
      // objective, the reward and the measurement basis an audited operation
      // moved this object to are accepted beside it — so unauthorized drift is
      // refused as it always was, and an ordinary write under the document's own
      // configuration still meets `candidate()`'s 409 until the document follows.
      const authorized = await this.accumulationTransition();
      // P49 (R-P78, D1): the refusal names what differs from the accumulation —
      // the document's tuple as the check accepts it, the authorized transition's
      // reward, objective and basis in place of the document's where one is on
      // record — and is today's where nothing nameable differs.
      const accepted = authorized ? { ...configured, reward: authorized.reward, objective: authorized.objective, measurementBasis: authorized.measurementBasis } : configured;
      if (!authorized || await recoveryDigest(accepted) !== stored) {
        const changed = republishedChanges(d.config, accepted);
        throw changed.length ? new RepublishFault(changed) : recovery();
      }
    }
    // The configuration check above still ran: absence of priors excuses nothing else.
    if (!rev) return null;
    if (!Array.isArray(rev.value.rows) || rev.value.rows.length > LEARN_LIMITS.priorRows || bytes(rev.value) > LEARN_LIMITS.priorBytes) throw capacity();
    // W25 Z1.01 (F20 §1.5): a prior is a probability, and a slot whose objective
    // is money does not learn one. The import door refuses such a row, so this
    // can only be a document retained from before that rule; applying it would
    // shrink the item toward a rate in the wrong unit and quietly demote it to
    // the lift floor. The publication is refused instead, naming the unit, so
    // the operator re-exports the document rather than reading a demotion as
    // evidence. The refusal is on the prior, never on the slot's own counters.
    const unit = priorUnitErrors(rev.value, (slot) => (slot === d.slot ? d.config.objective ?? 'unit' : 'unit'));
    if (unit.length) throw new Refusal(409, `statistics prior unit incompatible: ${unit[0]}`);
    for (const row of rev.value.rows) if (row.slot === d.slot) {
      if (!itemName(row.item)) throw capacity();
      // P08: a cell may name a pooled module's page level under the bumped grammar.
      pooledKeyBound(row.cell);
    }
    const index = indexPriors(rev.value, d.slot, d.config.measurementBasis ?? 'served-v1');
    if (d.stats.bounded) for (const [item, keys] of index) {
      if (d.stats.bounded.closed && !Object.hasOwn(d.stats.items, item)) { index.delete(item); continue; }
      // P08: a pooled record's cell is not one of this placement's own levels, so its own projection does not cut it.
      for (const key of keys.keys()) if (!isPooledKey(key) && depth(key) > d.stats.bounded.depth) keys.delete(key);
      if (!keys.size) index.delete(item);
    }
    return { version: rev.revision, index };
  }

  private fit(candidate: Stored): void {
    for (;;) {
      try { stateValid(candidate); return; }
      catch (error) {
        if (!(error instanceof Refusal) || error.status !== 413 || !candidate.stats.bounded || candidate.stats.bounded.depth === 0) throw error;
        boundStats(candidate.stats, (candidate.stats.bounded.depth - 1) as Level);
      }
    }
  }
  private async totalBound(candidate: Stored | null, fence?: GenerationFence, publication?: unknown, reset?: unknown, seen?: unknown, generation?: unknown,
    recent?: unknown): Promise<void> {
    // Fixed key inventory: learn, fence, publication identity, one repair
    // receipt, the bounded exposure journal (W22 D1.02), the rebuild basis
    // (W23 H1.01), the accumulation transition on record (W24 G1.02) and the
    // recent publications (P62).
    if (bytes(candidate) + bytes(fence ?? await this.fence()) + bytes(await this.state.storage.get('learnRepair') ?? null)
      + bytes(publication ?? await this.state.storage.get('learnPublished') ?? null)
      + bytes(reset ?? await this.state.storage.get('learnReset') ?? null)
      + bytes(seen ?? await this.state.storage.get(SEEN_KEY) ?? null)
      + bytes(generation ?? await this.state.storage.get(GENERATION_KEY) ?? null)
      + bytes(await this.state.storage.get(REBUILT_KEY) ?? null)
      + bytes(recent ?? await this.state.storage.get(RECENT_KEY) ?? null) > LEARN_LIMITS.totalBytes) throw capacity();
  }
  private async publishedReset(b: Record<string, unknown>): Promise<Response> {
    if (!component(b.tenant) || !component(b.brand) || !slotName(b.slot) || !pageValid(b.page) || !itemName(b.item) || typeof b.operationId !== 'string'
      || !object(b.publication)) throw invalid();
    const id = b.publication as unknown as { revision: number; digest: string };
    const set = await committedPublication(this.env, b.tenant, id), op = set.operation;
    if (op.kind !== 'learn' || op.scope !== b.tenant || op.operationId !== b.operationId || op.initialize || op.note !== 'item reset admitted') throw invalid();
    const requestDigest = await recoveryDigest({ operationId: op.operationId, expectedRevision: op.expectedRevision, expectedPublication: op.base,
      actor: op.actor, note: op.note, changes: [{ kind: 'learn', scope: b.tenant, request: { type: 'item-reset', item: b.item, slot: b.slot, brand: b.brand, ...(b.page ? { page: b.page } : {}) } }] });
    if (requestDigest !== op.requestDigest) throw invalid();
    type Receipt = { operationId: string; publication: { revision: number; digest: string }; item: string; had: boolean };
    const prior = await this.state.storage.get<Receipt>('learnReset');
    if (prior && prior.publication.revision >= id.revision) {
      if (prior.operationId !== b.operationId || prior.publication.digest !== id.digest || prior.item !== b.item) throw new Refusal(409, 'Reset has been superseded; destructive replay refused');
      // The deletion is already committed. Publication alone may be retried.
      let publicationOutcome = 'acknowledged';
      try { await this.publish(); } catch { publicationOutcome = 'unknown'; }
      return json({ ok: true, item: b.item, had: prior.had, resetCompleted: true, publicationOutcome });
    }
    const current = await this.loadIfAny();
    if (current && (current.tenant !== b.tenant || current.brand !== b.brand || current.slot !== b.slot || !samePage(current, b.page))) throw invalid();
    const fence = await this.fence(), item = b.item;
    if (!(item in fence.items) && Object.keys(fence.items).length >= LEARN_LIMITS.items) throw capacity();
    fence.items[item] = (fence.items[item] ?? 0) + 1; if (!Number.isSafeInteger(fence.items[item])) throw recovery();
    const candidate = current && structuredClone(current), had = !!candidate && Object.hasOwn(candidate.stats.items, item);
    if (candidate) {
      delete candidate.stats.items[item];
      for (const [key, marker] of Object.entries(candidate.effects ?? {})) if (marker.item === item) delete candidate.effects![key];
      stateValid(candidate);
    }
    const receipt: Receipt = { operationId: b.operationId, publication: id, item, had };
    await this.totalBound(candidate, fence, undefined, receipt);
    try {
      await this.state.storage.transaction(async tx => {
        await tx.put('learnFence', fence); if (candidate) await tx.put('learn', candidate); await tx.put('learnReset', receipt);
      });
    } finally { this.data = null; }
    let publicationOutcome = 'acknowledged';
    try { await this.publish(); } catch { publicationOutcome = 'unknown'; }
    return json({ ok: true, item, had, resetCompleted: true, publicationOutcome });
  }
  /**
   * W23 H1.01. The operator-authorised explicit reset: the damaged counters go,
   * the generation advances so nothing prepared against the old one can land,
   * and the object remembers the BASIS it was started again on so its next
   * published snapshot names it. It is local and it is conditional on this
   * object's own affected history: it touches no other brand, no other slot and
   * no other tenant, and a slot that is never called stays byte-identical.
   * Running any repair against production state is a separate authority
   * (`W23.P1.01`) and is not this code's to give.
   */
  private async explicitReset(operationId: string, digest: string, fence: GenerationFence, publication: unknown): Promise<Response> {
    const nextFence: GenerationFence = { whole: fence.whole + 1, items: {} };
    if (!Number.isSafeInteger(nextFence.whole)) throw recovery();
    const basis: RebuildBasis = { basis: 'explicit-reset', operationId, at: Date.now(), generation: nextFence.whole };
    const after = await recoveryDigest({ raw: null, fence: nextFence });
    const receipt = { operationId, before: digest, after, generation: fence.whole };
    if (bytes(null) + bytes(nextFence) + bytes(receipt) + bytes(basis) + bytes(publication ?? null)
      + bytes(await this.state.storage.get('learnReset') ?? null) > LEARN_LIMITS.totalBytes) throw capacity();
    try {
      await this.state.storage.transaction(async tx => {
        if (await recoveryDigest({ raw: await tx.get('learn') ?? null, fence: await tx.get('learnFence') ?? { whole: 0, items: {} } }) !== digest) throw new Refusal(409, 'statistics recovery precondition changed');
        await tx.delete('learn'); await tx.delete(SEEN_KEY); await tx.delete(GENERATION_KEY);
        await tx.put('learnFence', nextFence); await tx.put('learnRepair', receipt); await tx.put(REBUILT_KEY, basis);
      });
    } finally { this.data = null; }
    await this.arm();
    return json({ ok: true, recovered: true, reset: true, digest: after, generation: nextFence.whole });
  }

  /**
   * The rebuild basis this object carries, or undefined when it was never
   * repaired. A marker that is not the shape this object writes is damaged
   * state, not an absent basis: it is refused rather than published as a
   * snapshot claiming to hold the tenant's whole history.
   */
  private async rebuiltFrom(): Promise<RebuildBasis | undefined> {
    const value: unknown = await this.state.storage.get(REBUILT_KEY);
    if (value === undefined) return undefined;
    // W24 T1.02 adds the second basis: counters started again from one retained
    // day, which names that day so no reader takes them for the whole history.
    if (!fields(value, ['basis', 'operationId', 'at', 'generation', 'date'])
      || (value.basis !== 'explicit-reset' && value.basis !== 'ledger-rebuild')
      || typeof value.operationId !== 'string' || !/^[a-f0-9]{32}$/.test(value.operationId)
      || !time(value.at) || !Number.isSafeInteger(value.generation) || (value.generation as number) < 0
      || (value.basis === 'ledger-rebuild' ? typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date) : value.date !== undefined)) throw recovery();
    return { basis: value.basis, operationId: value.operationId, at: value.at as number, generation: value.generation as number,
      ...(typeof value.date === 'string' ? { date: value.date } : {}) };
  }

  private witness(d: Stored, fence: GenerationFence): Promise<string> {
    return witnessOf(witnessBasisOf(d), fence);
  }

  /**
   * P62 (amendment 6, R-P110 decision 2): the publication just made joins the
   * recent ones (`RECENT_KEY`), those older than the window from their own
   * publication dropped, at most `LIFT_RECENT_PUBLICATIONS` kept. Never refuses
   * the publication: where the list cannot be read, bounded or written, only
   * the latest publication is recognised, which is fail-closed.
   */
  private async rememberPublication(d: Stored, publication: { witness?: string; digest: string; version: number }, publishedAt: number): Promise<void> {
    try {
      const now = Date.now();
      const kept = recentPublicationsOf(await this.state.storage.get(RECENT_KEY))
        .filter(entry => entry.version !== publication.version && now - entry.publishedAt <= LIFT_RECENT_WINDOW_MS);
      const recent = [...kept, { version: publication.version, digest: publication.digest, publishedAt }].slice(-LIFT_RECENT_PUBLICATIONS);
      await this.totalBound(d, undefined, publication, undefined, undefined, undefined, recent);
      await this.state.storage.put(RECENT_KEY, recent);
    } catch { /* fail closed: the latest publication alone is recognised */ }
  }

  /**
   * P62 (amendment 6, R-P110; R-P112(5)): the verdict of the state this object
   * holds, as `/health` would give it, without the whole-state digest `/health`
   * gives operators. Cached when the state is committed; for a state loaded and
   * not yet verified, or for an object that holds none (an evicted object's first
   * call), established once — reading the stored state at most once — and cached
   * under the epoch it was read at, so a state replaced meanwhile is never
   * described by it.
   */
  private async heldVerdict(): Promise<HeldVerdict> {
    const epoch = this.epoch;
    if (this.verdict?.epoch === epoch) return this.verdict;
    let establishing = this.establishing;
    if (establishing?.epoch !== epoch) {
      const started = { epoch, verdict: this.establishVerdict(epoch) };
      this.establishing = establishing = started;
      void started.verdict.catch(() => undefined).finally(() => { if (this.establishing === started) this.establishing = null; });
    }
    return establishing.verdict;
  }
  private async establishVerdict(epoch: number): Promise<HeldVerdict> {
    const raw: unknown = this.data ?? await this.state.storage.get('learn');
    let verdict: HeldVerdict = { epoch, anchor: Number.NEGATIVE_INFINITY };
    if (raw !== undefined && (!object(raw) || bytes(raw) > LEARN_LIMITS.repairBytes)) verdict = { epoch, refused: true, anchor: Number.NEGATIVE_INFINITY };
    else if (raw !== undefined) {
      const identity = { tenant: raw.tenant, brand: raw.brand, slot: raw.slot, page: raw.page };
      let valid = true;
      try { stateValid(raw); await this.totalBound(raw); } catch { valid = false; }
      verdict = valid ? { epoch, identity, basis: witnessBasisOf(raw as unknown as Stored), anchor: latestAnchor((raw as unknown as Stored).stats) }
        : { epoch, identity, anchor: Number.NEGATIVE_INFINITY };
    }
    if (this.epoch === epoch) this.verdict = verdict;
    return verdict;
  }

  /**
   * P62 (amendment 6, R-P110): `POST /witness`. The verdict `/health` gives for
   * the committed state — `state`, the latest `publication` and the current
   * `witness`, each exactly as `/health` answers it — read from the verdict held
   * for that state (`heldVerdict`), never by re-reading or digesting the whole
   * state; and `recent`, this object's recent publications inside
   * `LIFT_RECENT_WINDOW_MS` from their own publication (R-P112(6)). A state
   * `/health` refuses, or another placement's, is refused the same way.
   */
  private async witnessDoor(b: Record<string, unknown>): Promise<Response> {
    const fence = await this.fence(), verdict = await this.heldVerdict(), identity = verdict.identity;
    if (verdict.refused || (identity && (identity.tenant !== b.tenant || identity.brand !== b.brand || identity.slot !== b.slot || !samePage(identity, b.page)))) throw recovery();
    const now = Date.now(), healthy = !!verdict.basis && !(verdict.anchor > now);
    const publication = await this.state.storage.get<{ digest: string; witness: string; version: number }>('learnPublished');
    const recent = recentPublicationsOf(await this.state.storage.get(RECENT_KEY)).filter(entry => now - entry.publishedAt <= LIFT_RECENT_WINDOW_MS);
    let witness: string | null = null;
    if (healthy) {
      const key = JSON.stringify(fence);
      if (verdict.witness?.fence !== key) {
        const value = witnessOf(verdict.basis!, fence);
        verdict.witness = { fence: key, value };
        void value.catch(() => { if (verdict.witness?.value === value) delete verdict.witness; });
      }
      witness = await verdict.witness!.value;
    }
    return json({ ok: true, tenant: b.tenant, brand: b.brand, slot: b.slot, ...(b.page ? { page: b.page } : {}),
      state: !identity ? 'empty' : healthy ? 'healthy' : 'recovery-required',
      publication: publication && /^[a-f0-9]{64}$/.test(publication.digest) && /^[a-f0-9]{64}$/.test(publication.witness) && Number.isSafeInteger(publication.version)
        ? { digest: publication.digest, witness: publication.witness, version: publication.version } : null,
      witness, recent });
  }
  private async recoveryControl(b: Record<string, unknown>, path: string): Promise<Response> {
    const raw: unknown = await this.state.storage.get('learn'), fence = await this.fence();
    if (raw !== undefined && (!object(raw) || raw.tenant !== b.tenant || raw.brand !== b.brand || raw.slot !== b.slot || !samePage(raw, b.page))) throw recovery();
    const size = bytes(raw ?? null);
    if (size > LEARN_LIMITS.repairBytes) throw recovery();
    const digest = await recoveryDigest({ raw: raw ?? null, fence });
    let healthy = true;
    try { if (raw !== undefined) { stateValid(raw); await this.totalBound(raw); } } catch { healthy = false; }
    // W23 H1.01 (F18 §6.3, §8: "fixing `bump` does not repair counters whose
    // `t` is already skewed; those objects must be reset and refolded, or
    // rebuilt from the ledger"). A state anchored after this object's own clock
    // is damaged historical state and says so, instead of reporting itself
    // healthy and being served from. This READ repairs nothing: the anchor is
    // corrected only when an event is recorded, so an operator sees the damage
    // for as long as it is there, which is what the explicit reset exists for.
    if (healthy && raw !== undefined && anchoredAfter((raw as unknown as Stored).stats, Date.now())) healthy = false;
    const publication = await this.state.storage.get<{ digest: string; witness: string; version: number }>('learnPublished');
    if (path !== '/recover') return json({ ok: true, tenant: b.tenant, brand: b.brand, slot: b.slot, ...(b.page ? { page: b.page } : {}),
      state: raw === undefined ? 'empty' : healthy ? 'healthy' : 'recovery-required', generation: fence.whole, digest, bytes: size,
      publication: publication && /^[a-f0-9]{64}$/.test(publication.digest) && /^[a-f0-9]{64}$/.test(publication.witness) && Number.isSafeInteger(publication.version)
        ? { digest: publication.digest, witness: publication.witness, version: publication.version } : null,
      witness: healthy && raw !== undefined ? await this.witness(raw as unknown as Stored, fence) : null });
    // W23 H1.01: two repair intents, both operator-authorised and audited by the
    // route in front of this object. `coarsen` keeps the evidence and merges it;
    // `reset` discards damaged counters outright and records the basis, for
    // state that cannot be merged back into honesty.
    if ((b.intent !== 'coarsen' && b.intent !== 'reset') || typeof b.operationId !== 'string' || !/^[a-f0-9]{32}$/.test(b.operationId)
      || typeof b.digest !== 'string' || !/^[a-f0-9]{64}$/.test(b.digest) || !Number.isSafeInteger(b.generation)) throw invalid();
    const prior = await this.state.storage.get<{ operationId: string; before: string; after: string; generation: number }>('learnRepair');
    if (prior?.operationId === b.operationId) {
      if (prior.before !== b.digest || prior.generation !== b.generation || prior.after !== digest) throw new Refusal(409, 'statistics recovery precondition changed');
      this.data = null; await this.arm();
      return json({ ok: true, recovered: true, digest, generation: fence.whole });
    }
    if (digest !== b.digest || fence.whole !== b.generation || raw === undefined) throw new Refusal(409, 'statistics recovery precondition changed');
    // An explicit reset is exactly the repair for state no validation can
    // accept, so it does not demand that the damaged state validate first.
    if (b.intent === 'reset') return this.explicitReset(b.operationId, digest, fence, publication);
    stateValid(raw, true); // bounded full shape/provenance validation, not a reset
    const candidate = structuredClone(raw);
    if (!candidate.stats.slot['*'] || Object.values(candidate.stats.items).some(map => !map['*'])) throw recovery();
    coarsenStats(candidate.stats, candidate.config.stats);
    this.fit(candidate);
    const nextFence = { whole: fence.whole + 1, items: {} };
    if (!Number.isSafeInteger(nextFence.whole)) throw recovery();
    const after = await recoveryDigest({ raw: candidate, fence: nextFence });
    const receipt = { operationId: b.operationId, before: digest, after, generation: fence.whole };
    if (bytes(candidate) + bytes(nextFence) + bytes(receipt) + bytes(publication ?? null) + bytes(await this.state.storage.get('learnReset') ?? null) > LEARN_LIMITS.totalBytes) throw capacity();
    try {
      await this.state.storage.transaction(async tx => {
        if (await recoveryDigest({ raw: await tx.get('learn') ?? null, fence: await tx.get('learnFence') ?? { whole: 0, items: {} } }) !== digest) throw new Refusal(409, 'statistics recovery precondition changed');
        await tx.put('learn', candidate); await tx.put('learnFence', nextFence); await tx.put('learnRepair', receipt);
      });
    } catch (error) {
      this.data = null;
      const readback = await recoveryDigest({ raw: await this.state.storage.get('learn') ?? null, fence: await this.fence() });
      if (readback !== after) throw error;
    }
    this.data = null;
    await this.arm();
    return json({ ok: true, recovered: true, digest: after, generation: nextFence.whole });
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn); this.chain = run.catch(() => undefined); return run;
  }
}
