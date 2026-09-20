// src/learn/fan.ts
// The three fan-ins the learning loop needs, with explicit incomplete receipts
// and none of them able to throw: served decisions into the visitor's ring,
// exposures into the slot's statistics object, and an outcome into the ring,
// which attributes it and forwards the credits itself.

import type { Env } from '@/types/env';
import type { LiftSnapshot } from './stats';

/** Live authority is never satisfied by an eventually-consistent KV/cache hit. */
export async function currentLiftWitness(env: Pick<Env, 'LEARN_STATS'>, tenant: string, brand: string, slot: string, snapshot: LiftSnapshot): Promise<boolean> {
  if (!env.LEARN_STATS || typeof snapshot.witness !== 'string' || !/^[a-f0-9]{64}$/.test(snapshot.witness)) return false;
  const namespace = env.LEARN_STATS;
  const abort = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  const probe = async () => { try {
    const response = await namespace.get(namespace.idFromName(statsName(tenant, brand, slot))).fetch('https://learn/health', {
      method: 'POST', body: JSON.stringify({ tenant, brand, slot }), signal: abort.signal,
    });
    const value = await response.json() as Record<string, unknown>;
    const publication = value.publication as { witness?: string; digest?: string; version?: number } | null;
    return response.ok && value.ok === true && value.state === 'healthy' && value.tenant === tenant && value.brand === brand
      && value.slot === slot && value.witness === snapshot.witness && !!publication && publication.witness === snapshot.witness
      && publication.version === snapshot.version && publication.digest === await recoveryDigest(snapshot);
  } catch { return false; } };
  try { return await Promise.race([probe(), new Promise<false>(resolve => { timer = setTimeout(() => { abort.abort(); resolve(false); }, 50); })]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
import type { DecisionRecord } from '@/content/types';
import type { OutcomeRecord } from '@/ledger/records';
import type { AttributionPolicy, RingEntry } from './policy';
// The ring's own reach, read from the module that declares it and that
// `@/durable-objects/DecisionRing` re-exports under the same name. It is read
// from there and NOT from the ring itself because the ring imports this module:
// measured under this repository's own runner, `import { RING_MAX_AGE_MS } from
// '@/durable-objects/DecisionRing'` here resolves to `undefined` whenever the
// ring is the first of the two to load (src/learn/learn.test.ts imports it at
// line 10, this module at line 12), which silently emptied the statistics
// object's applied-delivery journal.
import { RING_MAX_AGE_MS, type StatsConfig } from './stats';
import type { RewardType } from '@/ledger/records';
import { loadTombstone } from '@/ledger/erasure';
import { isLedgerMessage } from '@/ledger/writer';
import { byteLength, equalLogicalRows, logicalIdentity, MANAGED_BYTES, recordEvidenceLoss } from '@/ledger/delivery';
import { requireRetention, type RetentionEnv } from '@/retention';
import { pinRetention } from '@/identity/sessionAuthority';
import { recoveryDigest, learningEffectId, type LearningEffect, type LearningGeneration } from '@/ledger/recovery';

/** Physical input/comparison budgets, not retained-history or provider limits. */
export const FAN_LIMITS = { rows: 1000, recordBytes: MANAGED_BYTES, work: 1_000_000 } as const;

/**
 * The online path's own horizon, used for two things that must never drift
 * apart. It IS the visitor ring's own reach — `RING_MAX_AGE_MS`, exported by
 * the object that enforces it (`@/durable-objects/DecisionRing`) and re-exported
 * here under the name the online path already reads — so there is one constant
 * and not a second copy of its value (W22 A1.02):
 *   · W22 A1.01 — whatever window the tenant's published policy asks for, this
 *     is the horizon the online path can actually apply, which is what its
 *     snapshot's `appliedWindowsMs` declares.
 *   · W22 D1.02 (F16 §7, §2.3; ruling R104(c)) — it is also how far back the
 *     two halves of the online path can recognize a REDELIVERY they have
 *     already applied: the exposure in `LearnStats` and the credit in
 *     `DecisionRing` forget a delivery at the same moment, and neither claims
 *     idempotence beyond it. A repeat arriving after it is applied again, and
 *     no unit claims otherwise.
 *
 */
export const ONLINE_RING_REACH_MS = RING_MAX_AGE_MS;

export const ringName = (tenant: string, visitorId: string) => `${tenant}:${visitorId}`;
export const statsName = (tenant: string, brand: string, slot: string) => `${tenant}:${brand}:${slot}`;
export const liftKey = (tenant: string, brand: string, slot: string) => `lift:${tenant}:${brand}:${slot}`;
/** Phase 3 (doc 22 §12.3): every published snapshot is also archived by version, so a replay can read the one in force. */
export const liftArchiveKey = (tenant: string, brand: string, slot: string, version: number) => `lift/${tenant}/${brand}/${slot}/${version}.json`;

type NS = DurableObjectNamespace | undefined;
export interface StatsWriteReceipt {
  version: 1 | 2; kind: 'exposures' | 'credits'; received: number; processed: number; skipped: number;
  newlyApplied?: number; alreadyApplied?: number; suppressed?: number;
  /** Save was acknowledged; scheduling is separate from processing and from publication. */
  alarm: 'scheduled' | 'unknown';
}
interface AppendCounts {
  kind: 'append'; received: number; accepted: number; cutoffSkipped: number;
  /** Resulting bounded ring and long index depths, not retained-input counts. */
  retained: number; indexed: number;
}
/** v1 acceptance is legacy, not evidence of unique admission. */
export type AppendReceipt = AppendCounts & ({ version: 1 } | { version: 2; duplicates: number });
export interface DestinationCounts { destinations: number; acknowledged: number; unknown: number; notAttempted: number }
export interface StatsDelivery extends DestinationCounts {
  received: number; processed: number; skipped: number; rowsUnknown: number; rowsNotAttempted: number; alarmsUnknown: number;
  newlyApplied?: number; alreadyApplied?: number; suppressed?: number;
}
export interface OutcomeReceipt {
  version: 1; kind: 'outcome'; received: 1; cutoffSkipped: number;
  attributed: number; eligible: number; weightSkipped: number; credits: StatsDelivery;
  /**
   * W23 T1.01: how many ring decisions this outcome matched but could not be
   * credited to, because more time had passed than the reward's own attribution
   * window allows (doc 22 §4.1). Zero when nothing matched it at all: a miss by
   * item is not a miss by time, and an operator can tell the two apart.
   *
   * OPTIONAL, and carried through rather than required, because `outcomeReply`
   * below rebuilds a ring reply member by member and the object's reply is not
   * the only body that reaches it: `src/learn/holdoutArms.test.ts:279`/`:300`
   * feed it a synthetic receipt that has no such member and must still be
   * accepted as valid. The visitor's own `DecisionRing` always sets it.
   */
  outsideWindow?: number;
}
export interface LearningReceipt {
  version: 1; kind: 'decisions' | 'outcome'; ok: boolean;
  code: 'complete' | 'invalid' | 'barrier' | 'config' | 'incomplete'; received: number; cutoffSkipped: number;
  /** Current decision calls only: surviving copies coalesced within this call, never durable deduplication. */
  coalesced?: number;
  ring: DestinationCounts; exposures: StatsDelivery; append: AppendReceipt | null; outcome: OutcomeReceipt | null;
}
const destinations = (): DestinationCounts => ({ destinations: 0, acknowledged: 0, unknown: 0, notAttempted: 0 });
export const emptyStatsDelivery = (): StatsDelivery => ({ ...destinations(), received: 0, processed: 0, skipped: 0, rowsUnknown: 0, rowsNotAttempted: 0, alarmsUnknown: 0 });
const receipt = (kind: LearningReceipt['kind'], received: number): LearningReceipt => ({ version: 1, kind, ok: true, code: 'complete', received,
  cutoffSkipped: 0, ...(kind === 'decisions' ? { coalesced: 0 } : {}), ring: destinations(), exposures: emptyStatsDelivery(), append: null, outcome: null });
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const total = (expected: number, ...values: number[]): boolean => values.every(count) && count(expected) && values.reduce((a, b) => a + b, 0) === expected;
function admission() {
  let work = 0, size = 0;
  const spend = (n = 1) => { if ((work += n) > FAN_LIMITS.work) throw new Error('Learning input unavailable'); };
  const detach = <T extends DecisionRecord | OutcomeRecord>(row: T, stream: 'decision' | 'outcome'): T => {
    spend();
    const valid = (v: unknown): v is T => object(v) && isLedgerMessage({ kind: 'ledger', type: stream, record: v })
      && logicalIdentity(v, stream) !== null;
    // Inspect own reserved fields before JSON can drop an explicitly undefined value.
    if (!valid(row)) throw new Error('Learning input unavailable');
    const body = JSON.stringify(row);
    if ((size += byteLength(body)) > FAN_LIMITS.recordBytes) throw new Error('Learning input unavailable');
    const copy: unknown = JSON.parse(body);
    if (!valid(copy)) throw new Error('Learning input unavailable');
    return copy;
  };
  return { spend, detach };
}
function isStatsDelivery(v: unknown): v is StatsDelivery {
  if (!object(v) || !['destinations', 'acknowledged', 'unknown', 'notAttempted', 'received', 'processed', 'skipped', 'rowsUnknown', 'rowsNotAttempted', 'alarmsUnknown'].every(k => count(v[k]))) return false;
  const d = v as unknown as StatsDelivery;
  if (['newlyApplied', 'alreadyApplied', 'suppressed'].some(key => Object.hasOwn(v, key))
    && (!count(d.newlyApplied) || !count(d.alreadyApplied) || !count(d.suppressed)
      || !total(d.processed, d.newlyApplied, d.alreadyApplied, d.suppressed))) return false;
  return total(d.destinations, d.acknowledged, d.unknown, d.notAttempted)
    && total(d.received, d.processed, d.skipped, d.rowsUnknown, d.rowsNotAttempted)
    && d.alarmsUnknown <= d.acknowledged && d.destinations <= d.received
    && (d.unknown === 0 ? d.rowsUnknown === 0 : d.rowsUnknown >= d.unknown)
    && (d.notAttempted === 0 ? d.rowsNotAttempted === 0 : d.rowsNotAttempted >= d.notAttempted)
    && (d.acknowledged === 0 ? d.processed + d.skipped === 0 : d.processed + d.skipped >= d.acknowledged);
}
const statsComplete = (d: StatsDelivery): boolean => d.unknown === 0 && d.notAttempted === 0 && d.skipped === 0 && d.alarmsUnknown === 0;

type Posted<T> = { state: 'acknowledged'; receipt: T } | { state: 'unknown' | 'notAttempted' };
/** No retries: a failed HTTP/body acknowledgement can follow a committed non-idempotent write. */
async function post<T>(ns: NS, name: string, path: string, body: unknown, validate: (body: unknown) => T | null): Promise<Posted<T>> {
  if (!ns) return { state: 'notAttempted' };
  try {
    const stub = ns.get(ns.idFromName(name));
    const response = await stub.fetch(`https://learn${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) return { state: 'unknown' };
    const accepted = validate(await response.json());
    return accepted ? { state: 'acknowledged', receipt: accepted } : { state: 'unknown' };
  } catch { return { state: 'unknown' }; }
}

export async function deliverStats(ns: NS, name: string, kind: StatsWriteReceipt['kind'], body: unknown, received: number): Promise<StatsDelivery> {
  const out = emptyStatsDelivery();
  if (!received) return out;
  out.destinations = 1; out.received = received;
  const result = await post(ns, name, '/' + kind, body, value => {
    if (!object(value) || value.ok !== true || !object(value.receipt)) return null;
    const r = value.receipt;
    const managed = object(body) && body.version === 2;
    return r.version === (managed ? 2 : 1) && r.kind === kind && r.received === received && count(r.processed) && count(r.skipped)
      && total(received, r.processed, r.skipped) && (r.alarm === 'scheduled' || r.alarm === 'unknown')
      && (!managed || (count(r.newlyApplied) && count(r.alreadyApplied) && count(r.suppressed) && total(r.processed, r.newlyApplied, r.alreadyApplied, r.suppressed)))
      ? { version: r.version, kind, received, processed: r.processed, skipped: r.skipped, alarm: r.alarm,
        ...(managed ? { newlyApplied: Number(r.newlyApplied), alreadyApplied: Number(r.alreadyApplied), suppressed: Number(r.suppressed) } : {}) } : null;
  });
  if (result.state === 'acknowledged') {
    out.acknowledged = 1; out.processed = result.receipt.processed; out.skipped = result.receipt.skipped;
    out.alarmsUnknown = Number(result.receipt.alarm === 'unknown');
    if (result.receipt.version === 2) Object.assign(out, { newlyApplied: result.receipt.newlyApplied,
      alreadyApplied: result.receipt.alreadyApplied, suppressed: result.receipt.suppressed });
  } else if (result.state === 'unknown') { out.unknown = 1; out.rowsUnknown = received; }
  else { out.notAttempted = 1; out.rowsNotAttempted = received; }
  return out;
}
export function sumStatsDeliveries(parts: readonly StatsDelivery[]): StatsDelivery {
  const out = emptyStatsDelivery();
  for (const part of parts) for (const key of Object.keys(part) as Array<keyof StatsDelivery>) out[key] = (out[key] ?? 0) + (part[key] ?? 0);
  return out;
}
function appendReply(value: unknown, received: number): AppendReceipt | null {
  if (!object(value) || value.ok !== true || !object(value.receipt)) return null;
  const r = value.receipt;
  if (r.kind !== 'append' || r.received !== received || !count(r.accepted) || !count(r.cutoffSkipped)
    || !count(r.retained) || r.retained > 200 || !count(r.indexed) || value.ring !== r.retained) return null;
  const counts: AppendCounts = { kind: 'append', received, accepted: r.accepted, cutoffSkipped: r.cutoffSkipped, retained: r.retained, indexed: r.indexed };
  if (r.version === 1 && total(received, r.accepted, r.cutoffSkipped)) return { ...counts, version: 1 };
  return r.version === 2 && count(r.duplicates) && total(received, r.accepted, r.duplicates, r.cutoffSkipped)
    ? { ...counts, version: 2, duplicates: r.duplicates } : null;
}
function outcomeReply(value: unknown): OutcomeReceipt | null {
  if (!object(value) || value.ok !== true || !object(value.receipt)) return null;
  const r = value.receipt;
  if (r.version !== 1 || r.kind !== 'outcome' || r.received !== 1 || !count(r.cutoffSkipped) || r.cutoffSkipped > 1
    || !count(r.attributed) || !count(r.eligible) || !count(r.weightSkipped) || !total(r.attributed, r.eligible, r.weightSkipped)
    || value.credits !== r.attributed || !isStatsDelivery(r.credits) || r.credits.received !== r.eligible
    || (r.cutoffSkipped === 1 && r.attributed !== 0)
    // W23 T1.01: present or absent, never malformed.
    || (r.outsideWindow !== undefined && !count(r.outsideWindow))) return null;
  const credits: StatsDelivery = { ...r.credits };
  return { version: 1, kind: 'outcome', received: 1, cutoffSkipped: r.cutoffSkipped, attributed: r.attributed, eligible: r.eligible, weightSkipped: r.weightSkipped, credits,
    ...(r.outsideWindow !== undefined ? { outsideWindow: r.outsideWindow as number } : {}) };
}
/**
 * W22 R1.01: rows whose fan-out post was ATTEMPTED and not accepted — the
 * refusal F16 §5(c) says every caller records as delivered. A destination that
 * was never called (`notAttempted`) is a binding that is absent, not a post
 * that was refused, and is not counted here.
 */
export function fanOutRejectedRows(out: LearningReceipt): number {
  // The statistics objects only. The visitor's ring is one destination for a
  // whole set, and its own failure is already a receipt the caller reports; it
  // is not a row the statistics refused, and counting it here would say a row
  // of evidence was rejected when the ring simply did not answer.
  return out.exposures.rowsUnknown + (out.outcome?.credits.rowsUnknown ?? 0);
}
async function reportFanOutLoss(env: Partial<Pick<Env, 'CACHE'>>, tenant: string, out: LearningReceipt): Promise<LearningReceipt> {
  await recordEvidenceLoss(env, tenant, 'fanOutRejected', fanOutRejectedRows(out));
  return out;
}
function finish(out: LearningReceipt): LearningReceipt {
  out.ok = out.code === 'complete' && total(out.ring.destinations, out.ring.acknowledged, out.ring.unknown, out.ring.notAttempted)
    && out.ring.acknowledged === out.ring.destinations && isStatsDelivery(out.exposures)
    && statsComplete(out.exposures) && (!out.outcome || statsComplete(out.outcome.credits));
  if (!out.ok && out.code === 'complete') out.code = 'incomplete';
  return out;
}
/** Only current background wrappers report: one fixed numeric summary, never raw identifiers or errors. */
export function reportLearningIncomplete(kind: LearningReceipt['kind'], result: LearningReceipt | null): void {
  if (result?.ok) return;
  try {
    const credits = result?.outcome?.credits;
    console.warn('learning_incomplete', {
      version: 1, kind: kind === 'decisions' ? 0 : 1, code: result ? ['complete', 'invalid', 'barrier', 'config', 'incomplete'].indexOf(result.code) : 3,
      received: result?.received ?? 1, cutoffSkipped: result?.cutoffSkipped ?? 0,
      coalesced: result?.coalesced ?? 0,
      ringAcknowledged: result?.ring.acknowledged ?? 0, ringUnknown: result?.ring.unknown ?? 0, ringNotAttempted: result?.ring.notAttempted ?? 1,
      exposureProcessed: result?.exposures.processed ?? 0, exposureSkipped: result?.exposures.skipped ?? 0,
      exposureUnknown: result?.exposures.rowsUnknown ?? 0, exposureNotAttempted: result?.exposures.rowsNotAttempted ?? 0,
      creditPlanKnown: Number(result?.outcome !== null && result?.outcome !== undefined), attributed: result?.outcome?.attributed ?? 0,
      eligible: result?.outcome?.eligible ?? 0, weightSkipped: result?.outcome?.weightSkipped ?? 0,
      creditProcessed: credits?.processed ?? 0, creditSkipped: credits?.skipped ?? 0, creditUnknown: credits?.rowsUnknown ?? 0, creditNotAttempted: credits?.rowsNotAttempted ?? 0,
      alarmsUnknown: (result?.exposures.alarmsUnknown ?? 0) + (credits?.alarmsUnknown ?? 0),
    });
  } catch { /* Diagnostics must not throw or cause a retry. */ }
}

/**
 * CW30: the visitor's ring, read on the decision path under a time budget so
 * the fatigue term can never extend a decision by more than `timeoutMs`. Null
 * when the ring is unbound, slow or failing: no penalty, never an error.
 */
export async function readRing(env: Pick<Env, 'DECISION_RING'>, tenant: string, visitorId: string, timeoutMs = 60): Promise<RingEntry[] | null> {
  const ns = env.DECISION_RING;
  if (!ns) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const read = ns.get(ns.idFromName(ringName(tenant, visitorId))).fetch('https://learn/recent').then(async (res) => {
      // The ring keeps the full served records; attribution and the fatigue term read them as entries.
      const body = (await res.json()) as { ok?: boolean; ring?: Array<DecisionRecord | RingEntry> };
      return body.ok && Array.isArray(body.ring) ? body.ring.map((r) => ('decision_id' in r ? ringEntryOf(r) : r)) : null;
    });
    const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
    return await Promise.race([read, late]);
  } catch { return null; } finally { if (timer !== undefined) clearTimeout(timer); }
}

/** CW30: slot → item → times served inside that slot's fatigue window, from the ring entries. */
export function servedCounts(ring: readonly RingEntry[], slots: ReadonlyArray<{ slot: string; fatigue?: { weight: number; windowHours: number }; measurementBasis?: import('@/content/types').MeasurementBasis }>, now: number): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const s of slots) {
    if (!s.fatigue || s.fatigue.weight <= 0) continue;
    const since = now - s.fatigue.windowHours * 3_600_000;
    const counts: Record<string, number> = {};
    for (const e of ring) {
      const basis = e.measurementBasis ?? 'served-v1';
      const at = basis === 'rendered-v1' ? e.renderedAt : e.ts;
      if (basis === (s.measurementBasis ?? 'served-v1') && typeof at === 'number' && at >= since && at <= now) counts[e.item] = (counts[e.item] ?? 0) + 1;
    }
    if (Object.keys(counts).length) out[s.slot] = counts;
  }
  return out;
}

export const ringEntryOf = (r: DecisionRecord): RingEntry =>
  ({ id: r.decision_id, tenant: r.tenant, visitor_id: r.visitor_id, brand: r.brand, ts: r.ts, page: r.page, slot: r.slot, position: r.position,
    measurementBasis: r.measurementBasis ?? 'served-v1', ...(r.rendered ? { renderedAt: r.rendered.at } : {}),
    item: r.item_id, session_id: r.session_id, arm: r.arm, cell: r.cell, ...(r.retention ? { retention: r.retention } : {}), ...(r.featured_product_ids?.length ? { products: [...r.featured_product_ids] } : {}) });

/** The slot's configuration the statistics object publishes against. */
export interface SlotLearnConfig { reward: RewardType; stats: StatsConfig; measurementBasis?: import('@/content/types').MeasurementBasis; /** CW27: absent means unit. */ objective?: 'unit' | 'revenue' | 'margin' }

export async function learningGenerations(ns: NS, name: string, items: string[]): Promise<Record<string, LearningGeneration>> {
  if (!ns) throw new Error('Learning generation unavailable');
  const response = await ns.get(ns.idFromName(name)).fetch('https://learn/generation', { method: 'POST', body: JSON.stringify({ items: [...new Set(items)] }) });
  if (!response.ok) throw new Error('Learning generation unavailable');
  const value: unknown = await response.json();
  if (!object(value) || value.ok !== true || !count(value.whole) || !object(value.items)
    || items.some(item => !count((value.items as Record<string, unknown>)[item]))) throw new Error('Learning generation unavailable');
  return Object.fromEntries(items.map(item => [item, { whole: value.whole as number, item: Number((value.items as Record<string, unknown>)[item]) }]));
}

export async function prepareExposureEffects(env: Env, records: DecisionRecord[], consentUntil: number): Promise<Record<string, LearningEffect>> {
  const result: Record<string, LearningEffect> = {}, groups = new Map<string, DecisionRecord[]>();
  for (const row of records) if (row.arm === 'personalized') {
    const name = statsName(row.tenant, row.brand, row.slot); groups.set(name, [...(groups.get(name) ?? []), row]);
  }
  for (const [name, rows] of groups) {
    const generations = await learningGenerations(env.LEARN_STATS, name, rows.map(row => row.item_id));
    for (const row of rows) result[row.decision_id] = { version: 1,
      id: await learningEffectId('exposures', name, row.decision_id), decision: row.decision_id,
      tenant: row.tenant, subject: row.visitor_id, generation: generations[row.item_id]!,
      retention: requireRetention(env, row.retention?.online, row.tenant, 'online'), consentUntil };
  }
  return result;
}

/** After a decision set is served: the ring gets the full records, each slot's object gets its exposures. */
export async function fanDecisions(env: Pick<Env, 'DECISION_RING' | 'LEARN_STATS' | 'STORAGE'> & Partial<RetentionEnv> & Partial<Pick<Env, 'CACHE'>>, set: { tenant: string; brand: string; visitor_id: string; records: DecisionRecord[] }, slotConfig: (slot: string) => SlotLearnConfig, managed?: { effects: Record<string, LearningEffect> }): Promise<LearningReceipt> {
  const out = receipt('decisions', Array.isArray(set.records) ? set.records.length : 0);
  try {
    const { tenant, brand, visitor_id: visitorId, records: input } = set, budget = admission();
    out.code = 'invalid';
    if (!Array.isArray(input)) return finish(out);
    const received = input.length;
    out.received = received;
    if (received > FAN_LIMITS.rows) return finish(out);
    // Capture finite membership before any row's toJSON can resize the caller's array.
    const members: DecisionRecord[] = [];
    for (let i = 0; i < received; i++) {
      budget.spend();
      if (!Object.hasOwn(input, i)) return finish(out);
      members.push(input[i]!);
    }
    const owned = (r: DecisionRecord) => r.tenant === tenant && r.visitor_id === visitorId && r.brand === brand;
    const detached: DecisionRecord[] = [];
    for (const row of members) {
      if (!object(row) || !owned(row)) return finish(out);
      const copy = budget.detach(row, 'decision');
      if (!owned(copy)) return finish(out);
      detached.push(copy);
    }
    if (!detached.length) { out.code = 'complete'; return finish(out); }
    out.code = 'barrier';
    const tombstone = await loadTombstone(env.STORAGE, tenant, visitorId);
    const surviving = detached.filter(r => !tombstone || r.ts > tombstone.erased_at);
    out.cutoffSkipped = detached.length - surviving.length;
    out.code = 'invalid';
    const unique = new Map<string, DecisionRecord>();
    for (const row of surviving) {
      budget.spend();
      const previous = unique.get(row.decision_id);
      if (previous && !equalLogicalRows(previous as unknown as Record<string, unknown>, row as unknown as Record<string, unknown>, budget.spend)) return finish(out);
      if (!previous) unique.set(row.decision_id, row);
    }
    // Publish the count only after the entire surviving cohort reconciles.
    out.coalesced = surviving.length - unique.size;
    const records = [...unique.values()];
    for (const row of records) pinRetention(env as RetentionEnv, row.retention?.online, tenant, 'online');
    out.code = 'complete';
    if (!records.length) return out;
    const bySlot = new Map<string, DecisionRecord[]>();
    // Holdout decisions remain in the ring, never the personalized statistics.
    for (const r of records) if (r.arm === 'personalized') bySlot.set(r.slot, [...(bySlot.get(r.slot) ?? []), r]);
    out.code = 'config';
    if (records.some(row => (row.measurementBasis ?? 'served-v1') !== (slotConfig(row.slot).measurementBasis ?? 'served-v1'))) return finish(out);
    out.ring = { destinations: 1, acknowledged: 0, unknown: 0, notAttempted: 1 };
    out.exposures = { ...emptyStatsDelivery(), destinations: bySlot.size, notAttempted: bySlot.size,
      received: [...bySlot.values()].reduce((n, rows) => n + rows.length, 0), rowsNotAttempted: [...bySlot.values()].reduce((n, rows) => n + rows.length, 0) };
    // W22 D1.02 (F16 §7): "put `decision_id` back into the `/exposures` payload
    // so `LearnStats` can do the same". A decision is served once, so its
    // logical id is what makes a redelivered exposure recognizable — and the
    // digest of the WHOLE served record travels with it, because two different
    // records under one id are two events, not a repeat (F16 §5(j)), and the
    // payload alone cannot tell them apart. The managed path carries neither:
    // its effect marker already proves the same thing, and adding fields to its
    // row would change the digest every stored marker was written under.
    const exposures = await Promise.all([...bySlot].map(async ([slot, rows]) => ({ slot, body: {
      tenant, brand, slot, config: slotConfig(slot), ...(managed ? { version: 2 } : {}),
      exposures: await Promise.all(rows.map(async r => ({ item: r.item_id, cell: r.cell, ts: r.rendered?.at ?? r.ts,
        ...(managed ? { effect: managed.effects[r.decision_id] } : { decision: r.decision_id, digest: await recoveryDigest(r) }) }))),
    } })));
    // All validation/barrier/config reads precede starting either destination.
    for (const row of records) requireRetention(env as RetentionEnv, row.retention?.online, tenant, 'online');
    out.code = 'complete';
    out.ring.unknown = 1; out.ring.notAttempted = 0;
    out.exposures.unknown = out.exposures.destinations; out.exposures.notAttempted = 0;
    out.exposures.rowsUnknown = out.exposures.received; out.exposures.rowsNotAttempted = 0;
    const [ring, stats] = await Promise.all([
      post(env.DECISION_RING, ringName(tenant, visitorId), '/append', { tenant, visitorId, records, ...(managed ? { version: 2 } : {}) }, b => appendReply(b, records.length)),
      Promise.all(exposures.map(({ slot, body }) => deliverStats(env.LEARN_STATS, statsName(tenant, brand, slot), 'exposures', body, body.exposures.length))),
    ]);
    out.ring.unknown = 0; out.ring[ring.state] = 1;
    if (ring.state === 'acknowledged') out.append = ring.receipt;
    out.exposures = sumStatsDeliveries(stats);
  } catch { if (out.code === 'complete') out.code = 'incomplete'; }
  return reportFanOutLoss(env, set.tenant, finish(out));
}

/** An outcome to the visitor's ring, which attributes it under the policy and forwards the credits. */
export async function fanOutcome(env: Pick<Env, 'DECISION_RING' | 'STORAGE'> & Partial<RetentionEnv> & Partial<Pick<Env, 'CACHE'>>, tenant: string, outcome: OutcomeRecord, policy: AttributionPolicy, brand: string, slotConfig: Record<string, SlotLearnConfig>, defaultSlotConfig?: SlotLearnConfig, managed?: { consentUntil: number }): Promise<LearningReceipt> {
  const out = receipt('outcome', 1);
  try {
    out.code = 'invalid';
    if (!object(outcome) || outcome.tenant !== tenant || outcome.brand !== brand) return finish(out);
    const copy = admission().detach(outcome, 'outcome');
    if (copy.tenant !== tenant || copy.brand !== brand) return finish(out);
    outcome = copy;
    out.code = 'barrier';
    const tombstone = await loadTombstone(env.STORAGE, tenant, outcome.visitor_id);
    out.code = 'complete';
    if (tombstone && outcome.ts <= tombstone.erased_at) { out.cutoffSkipped = 1; return out; }
    pinRetention(env as RetentionEnv, outcome.retention?.online, tenant, 'online');
    out.ring.destinations = 1; out.ring.unknown = 1;
    const ring = await post(env.DECISION_RING, ringName(tenant, outcome.visitor_id), '/outcome', { tenant, brand, outcome, policy, slotConfig, defaultSlotConfig,
      ...(managed ? { version: 2, consentUntil: managed.consentUntil } : {}) }, outcomeReply);
    out.ring.unknown = 0; out.ring[ring.state] = 1;
    if (ring.state === 'acknowledged') out.outcome = ring.receipt;
  } catch { if (out.code === 'complete') out.code = 'incomplete'; }
  return reportFanOutLoss(env, tenant, finish(out));
}
