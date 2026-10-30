// src/learn/report.ts
// Doc 22 §4.2, §7, §10, §12.2: the batch half of attribution, over the ledger.
// Because both ledgers are immutable, attribution is a read: any number of
// reporting policies can run over the same day's decisions and outcomes and
// produce the lift grid the engine WOULD have learned under each, beside the
// learning policy, without changing what is served. The same pass counts what
// explored against the configured share (§7) and reports raw attribution
// counts by arm (§10), from R2 and never from Analytics Engine. Pure
// where it can be: `buildReport` takes records; `runReport` fetches them.

import type { DecisionRecord, LearnConfig } from '@/content/types';
import { hidden, loadTombstones, withoutErased } from '@/ledger/erasure';
import { requireRetention, type RetentionEnv } from '@/retention';
import { isProductSortKey, isLearningKey, validDecisionMeasurement, type OutcomeRecord, type RewardType } from '@/ledger/records';
import { boundedLedgerText, equalLogicalRows, logicalIdentity, preferredCopy } from '@/ledger/delivery';
import type { R2Like } from '@/ledger/writer';
import { attribute, DEFAULT_POLICY, namedSlotOf, successCreditOf, type AttributionPolicy, type RingEntry } from './policy';
import { ringAtHour, ringEntryOf } from './fan';
import { buildSnapshot, DEFAULT_STATS, emptyStats, levelKeys, parentKey, recordExposure, recordSuccess, type AttributionContract, type LiftSnapshot, type StatsConfig } from './stats';
import { attributionContractOf, policyOf, slotConfigsOf, validAttributionContract } from './route';
import { effectiveExploration, type ExploreMode } from './explore';
import { indexPriors, priorCapacityExceeded, type PriorIndex, type PriorsDoc } from './priors';

export interface ReportPolicy extends AttributionPolicy { name: string }

/** Application refusal budgets, not measured Worker capacity or a data-retention policy. */
export const REPORT_LIMITS = { records: 50_000, policies: 6, objects: 800,
  objectBytes: 16 * 1024 * 1024, rawBytes: 16 * 1024 * 1024, work: 1_000_000,
  cells: 16_384, outputBytes: 8 * 1024 * 1024, requestBytes: 64 * 1024,
  aggregateObjects: 24, aggregateBytes: 16 * 1024 * 1024,
  savedBytes: 8 * 1024 * 1024, windowBytes: 16 * 1024 * 1024, summaryBytes: 64 * 1024 } as const;
/**
 * P104 (RF1): a slot's learning state is bounded at the live table's capacity per slot and policy (LEARN_LIMITS,
 * src/durable-objects/LearnStats.ts: 256 items, 4,096 counters), so a day's cells are bounded per slot, times the
 * policies, and no longer across the whole day.
 */
export const SLOT_CAPACITY = { items: 256, counters: 4096 } as const;
/** A saved day's grid rows for one slot: per policy its own row, an item row per item, a level per counter and a slot rate per counter. */
const SLOT_GRID_ROWS = (1 + SLOT_CAPACITY.items + 2 * SLOT_CAPACITY.counters) * REPORT_LIMITS.policies;
export class ReportBudgetExceeded extends Error {
  readonly code = 'report_budget_exceeded';
  constructor(readonly budget: keyof typeof REPORT_LIMITS, readonly limit: number, readonly observed: number) { super('report budget exceeded'); }
}
export class ReportInputError extends Error { constructor() { super('invalid raw report input'); } }
export class ReportUnavailableError extends Error { constructor() { super('report unavailable'); } }
/**
 * W22 D1.03 (F16 §5(j)): the reader met two genuinely DIFFERENT rows under one
 * logical id. At-least-once delivery cannot prevent it and the writer really
 * stores it, so the reader refuses the day rather than merge the two — and,
 * unlike the unnamed input refusal it used to raise, it says which id and which
 * stream, so an operator can act on it and the caller can file it.
 */
export class ReportRowConflict extends ReportInputError {
  readonly code = 'report_row_conflict';
  constructor(readonly stream: 'decision' | 'outcome', readonly id: string, readonly row: Record<string, unknown>) {
    super();
    // A conflict IS an input the reader refuses, so every caller that already
    // refuses on `ReportInputError` keeps refusing exactly as before; what is
    // new is that this one can be named and filed.
    this.message = 'conflicting rows under one logical id';
  }
}
export class ReportTooLarge extends ReportBudgetExceeded {
  constructor(readonly objects: number, readonly max: number) { super('objects', max, objects); }
}
const utf8 = new TextEncoder();
const nonAscii = /[\u0080-\uFFFF]/;
const byteLength = (value: string) => nonAscii.test(value) ? utf8.encode(value).length : value.length;
const bound = (budget: keyof typeof REPORT_LIMITS, observed: number) => {
  if (observed > REPORT_LIMITS[budget]) throw new ReportBudgetExceeded(budget, REPORT_LIMITS[budget], observed);
};
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const name = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256 && byteLength(v) <= 256 && !Object.hasOwn(Object.prototype, v);
const optionalName = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.length <= 256 && byteLength(v) <= 256 && !Object.hasOwn(Object.prototype, v));
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const time = (v: unknown) => finite(v) && Number.isFinite(new Date(v).getTime());
const rewards = new Set(['click', 'dwell', 'video_complete', 'wishlist', 'add_to_bag', 'purchase', 'custom']);
function products(v: unknown): number {
  if (v === undefined || v === null) return 0;
  if (!Array.isArray(v)) throw new ReportInputError();
  // The work cap also bounds admission's own product traversal.
  bound('work', v.length);
  for (const p of v) if (!name(p)) throw new ReportInputError();
  return v.length;
}
export function validateReportPolicies(policies: readonly ReportPolicy[]): void {
  bound('policies', policies.length);
  for (const p of policies) {
    if (!object(p) || !name(p.name) || !['session', 'visitor'].includes(p.scope)
      || !['direct', 'any'].includes(p.match) || !['first', 'last'].includes(p.credit) || !object(p.windowsMs)) throw new ReportInputError();
    for (const [key, v] of Object.entries(p.windowsMs)) if (!rewards.has(key) || !finite(v) || v < 0) throw new ReportInputError();
  }
}

/** Recorded computation only: never an enrollment, control or business-metric attestation. */
export interface ComputationBasis {
  /** 1: legacy; 2: exact references; 3: current-input logical dedup, not repaired carry-in. */
  version: 1 | 2 | 3 | 4;
  unit: 'credited_outcomes_per_content_item_decision';
  profile: { source: 'raw-day' | 'hourly-ring'; horizonMs: number | null; ringCap: number | null };
  policies: Array<{ name: string; role: 'learning' | 'reporting'; policy: AttributionPolicy }>;
  slots: Array<{ slot: string; reward: RewardType; objective: 'unit' | 'revenue' | 'margin'; tauLearnMs: number; measurementBasis?: 'served-v1' | 'rendered-v1' }>;
}
export function effectiveReportPolicy(p: AttributionPolicy): AttributionPolicy {
  return { scope: p.scope, match: p.match, credit: p.credit,
    windowsMs: Object.fromEntries([...rewards].map(reward => [reward, p.windowsMs[reward as RewardType] ?? p.windowsMs.custom ?? 30 * 60_000])) };
}
const only = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
/** Malformed/absent legacy metadata stays unknown; it is not reconstructed from current config. */
export function recordedComputation(value: unknown): ComputationBasis | null {
  if (!object(value) || !only(value, ['version', 'unit', 'profile', 'policies', 'slots']) || (value.version !== 1 && value.version !== 2 && value.version !== 3 && value.version !== 4)
    || value.unit !== 'credited_outcomes_per_content_item_decision' || !object(value.profile)
    || !only(value.profile, ['source', 'horizonMs', 'ringCap']) || !Array.isArray(value.policies) || !value.policies.length
    || value.policies.length > REPORT_LIMITS.policies || !Array.isArray(value.slots) || value.slots.length > REPORT_LIMITS.cells) return null;
  const p = value.profile;
  if (!(p.source === 'raw-day' && p.horizonMs === null && p.ringCap === null)
    && !(p.source === 'hourly-ring' && finite(p.horizonMs) && p.horizonMs >= 0 && Number.isSafeInteger(p.ringCap) && Number(p.ringCap) > 0)) return null;
  let learning = 0; const labels = new Set<string>();
  for (const row of value.policies) {
    if (!object(row) || !only(row, ['name', 'role', 'policy']) || !name(row.name) || (row.role !== 'learning' && row.role !== 'reporting')
      || !object(row.policy) || !only(row.policy, ['scope', 'match', 'credit', 'windowsMs'])) return null;
    if (labels.has(row.name)) return null; labels.add(row.name);
    try { validateReportPolicies([{ ...row.policy, name: row.name } as ReportPolicy]); } catch { return null; }
    const windows = row.policy.windowsMs;
    if (!object(windows) || Object.keys(windows).length !== rewards.size
      || [...rewards].some(r => !Object.hasOwn(windows, r))) return null;
    if (row.role === 'learning') learning++;
  }
  if (learning !== 1) return null;
  const seen = new Set<string>();
  for (const row of value.slots) {
    if (!object(row) || !only(row, ['slot', 'reward', 'objective', 'tauLearnMs', ...(value.version === 4 ? ['measurementBasis'] : [])]) || !name(row.slot) || seen.has(row.slot)
      || (value.version === 4 && row.measurementBasis !== 'served-v1' && row.measurementBasis !== 'rendered-v1')
      || !rewards.has(row.reward as string) || (row.objective !== 'unit' && row.objective !== 'revenue' && row.objective !== 'margin')
      || !finite(row.tauLearnMs) || row.tauLearnMs <= 0) return null;
    seen.add(row.slot);
  }
  if (byteLength(JSON.stringify(value)) > REPORT_LIMITS.summaryBytes) return null;
  return { version: value.version, unit: 'credited_outcomes_per_content_item_decision',
    profile: { source: p.source as ComputationBasis['profile']['source'], horizonMs: p.horizonMs as number | null, ringCap: p.ringCap as number | null },
    policies: (value.policies as ComputationBasis['policies']).map(row => ({ name: row.name, role: row.role, policy: effectiveReportPolicy(row.policy) })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    slots: (value.slots as ComputationBasis['slots']).map(row => ({ slot: row.slot, reward: row.reward, objective: row.objective, tauLearnMs: row.tauLearnMs, ...(value.version === 4 ? { measurementBasis: row.measurementBasis } : {}) })).sort((a, b) => a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0) };
}
export function computationBasis(learn: LearnConfig, policies: ComputationBasis['policies'], slots: Iterable<string>, profile: ComputationBasis['profile']): ComputationBasis {
  const cfg = slotConfigsOf(learn);
  const basis: ComputationBasis = { version: 4, unit: 'credited_outcomes_per_content_item_decision', profile: { ...profile },
    policies: policies.map(p => ({ name: p.name, role: p.role, policy: effectiveReportPolicy(p.policy) })),
    slots: [...new Set(slots)].sort().map(slot => ({ slot, reward: cfg[slot]?.reward ?? 'click', objective: cfg[slot]?.objective ?? 'unit', measurementBasis: cfg[slot]?.measurementBasis ?? 'served-v1', tauLearnMs: (learn.stats ?? DEFAULT_STATS).tauLearnMs })) };
  bound('summaryBytes', byteLength(JSON.stringify(basis)));
  const recorded = recordedComputation(basis);
  if (!recorded) throw new ReportInputError();
  return recorded;
}
export function slotComputation(basis: ComputationBasis | null, slot: string): string | null {
  const config = basis?.slots.find(s => s.slot === slot), learning = basis?.policies.find(p => p.role === 'learning');
  return config && learning ? JSON.stringify([basis!.version, basis!.unit, basis!.profile.source, basis!.profile.horizonMs, basis!.profile.ringCap,
    effectiveReportPolicy(learning.policy), config.reward, config.objective, config.tauLearnMs, config.measurementBasis ?? 'served-v1']) : null;
}
export const rowShapeOf = (row: unknown, stream: 'decision' | 'outcome'): void => rowShape(row, stream);
function rowShape(row: unknown, stream: 'decision' | 'outcome'): void {
  if (!object(row) || !name(row.tenant) || !name(row.brand) || !name(row.visitor_id) || !optionalName(row.session_id) || !time(row.ts)) throw new ReportInputError();
  const id = row[stream === 'decision' ? 'decision_id' : 'outcome_id'];
  if (typeof id !== 'string' || !id || byteLength(id) > 2048) throw new ReportInputError();
  if (stream === 'outcome') {
    if (!rewards.has(row.type as string) || !optionalName(row.item_id) || !optionalName(row.slot)
      || (row.value !== null && row.value !== undefined && !finite(row.value)) || (row.margin !== null && row.margin !== undefined && !finite(row.margin))) throw new ReportInputError();
    products(row.products); return;
  }
  if (typeof row.decision_id !== 'string' || !row.decision_id || byteLength(row.decision_id) > 2048
    || !name(row.slot) || !name(row.item_id) || !name(row.arm) || !optionalName(row.page) || !finite(row.position)
    || typeof row.explored !== 'boolean' || !object(row.cell)) throw new ReportInputError();
  if (!validDecisionMeasurement(row as unknown as DecisionRecord)) throw new ReportInputError();
  for (const key of ['channel', 'visit_bucket', 'stage', 'region', 'affinity']) if (!optionalName(row.cell[key])) throw new ReportInputError();
  products(row.featured_product_ids);
}

export interface DuplicateCounts { decisions: number; outcomes: number }
/** W22 D1.03: logical ids whose conflict is already filed, so the day reads again with the row excluded. */
export type ResolvedConflicts = ReadonlySet<string>;
export const conflictKey = (stream: 'decision' | 'outcome', id: string): string => JSON.stringify([stream, id]);
export interface DuplicateWitness { brand: string; visitor_id: string; ts: number; stream: 'decision' | 'outcome'; count: number }
export function validDuplicateCounts(value: unknown): value is DuplicateCounts {
  return object(value) && only(value, ['decisions', 'outcomes'])
    && [value.decisions, value.outcomes].every(n => Number.isSafeInteger(n) && Number(n) >= 0);
}

/** Complete logical JSON comparison. Only validated top-level transport provenance is excluded. */
export class ReportRowIdentity {
  private rows = new Map<string, { row: Record<string, unknown>; stream: 'decision' | 'outcome'; count: number }>();
  private bytes = 0;
  private work = 0;
  private conflicted: DuplicateCounts = { decisions: 0, outcomes: 0 };
  /** W30 F1.01: the same exclusions as witnesses, so a caller that counts by BRAND (the hourly fold) can. */
  private conflictedRows: DuplicateWitness[] = [];
  /** `resolved` holds the conflicts an operator surface already carries; a row
   * whose conflict is filed is excluded and COUNTED instead of refusing the day.
   * `brand`, when the caller is reading ONE brand's day, is that brand: every
   * row is still admitted and deduplicated, and what belongs to the brand is
   * what the caller counts (W22 R1.06, W22 D1.05). */
  constructor(private tenant: string, private resolved: ResolvedConflicts = new Set<string>(), private brand?: string) {}
  private spend(n = 1): void { bound('work', this.work += n); }
  admit(value: unknown, stream: 'decision' | 'outcome'): boolean {
    this.spend(); rowShape(value, stream);
    const row = value as Record<string, unknown>;
    if (row.tenant !== this.tenant) throw new ReportInputError();
    const identity = logicalIdentity(row, stream);
    if (identity === null) throw new ReportInputError();
    let serialized: string;
    try { serialized = JSON.stringify(row); } catch { throw new ReportInputError(); }
    bound('rawBytes', this.bytes += byteLength(serialized));
    const id = row[stream === 'decision' ? 'decision_id' : 'outcome_id'];
    const key = JSON.stringify([row.tenant, stream, id]), prior = this.rows.get(key);
    if (!prior) { this.rows.set(key, { row, stream, count: 0 }); return true; }
    // Old timestamp-derived outcome IDs can represent separate identical events:
    // such an id cannot prove an exact retry, and it cannot name a conflict
    // either — neither row can be shown to be the intruder — so it keeps the
    // unnamed refusal it has always had and is never filed or excluded.
    if (identity === 'legacy') throw new ReportInputError();
    if (!equalLogicalRows(prior.row, row, n => this.spend(n))) {
      // W22 D1.03: two different rows under one STABLE logical id are never
      // merged. Either the conflict is already filed — then this row is
      // excluded and counted — or the read fails closed and NAMES it.
      //
      // W22 D1.05: a conflict belongs to its own brand. When one brand's day is
      // being read, only a conflict that touches THAT brand — on either side of
      // the collision, so the refusal stays closed for the brand asked for —
      // refuses it or is counted on it; a collision between two other brands of
      // the same tenant excludes its row here and says nothing about this
      // brand's day. The same scope the `duplicates` beside it already have.
      const mine = this.brand === undefined || row.brand === this.brand || prior.row.brand === this.brand;
      if (mine) {
        const key = conflictKey(stream, String(id));
        if (!this.resolved.has(key)) throw new ReportRowConflict(stream, String(id), row);
        if (this.brand === undefined || row.brand === this.brand) {
          this.conflicted[stream === 'decision' ? 'decisions' : 'outcomes']++;
          this.conflictedRows.push({ brand: row.brand as string, visitor_id: row.visitor_id as string, ts: row.ts as number, stream, count: 1 });
        }
      }
      return false;
    }
    // P103 (R-P604, R-P629): copies of one logical row are kept by the one rule every reader shares (`preferredCopy`:
    // the ring-stamped copy, then the earliest-born), never by read order; the kept object is updated in place, so a
    // caller that already holds it reads the preferred copy.
    if (preferredCopy(row, prior.row)) { for (const key of Object.keys(prior.row)) delete prior.row[key]; Object.assign(prior.row, row); }
    prior.count++; return false;
  }
  /** Rows excluded because their conflict is filed, in the vocabulary `duplicates` uses. */
  conflicts(): DuplicateCounts { return { ...this.conflicted }; }
  /** W30 F1.01: the same exclusions, each named by the brand it belongs to. */
  conflictRows(): DuplicateWitness[] { return [...this.conflictedRows]; }
  duplicates(): DuplicateWitness[] {
    return [...this.rows.values()].filter(r => r.count > 0).map(({ row, stream, count }) =>
      ({ brand: row.brand as string, visitor_id: row.visitor_id as string, ts: row.ts as number, stream, count }));
  }
}

/** Linear, early-stopping admission before ring sorts, counters, policy clones or snapshots. */
function admitReport(i: ReportInput): void {
  if (!Array.isArray(i.decisions) || !Array.isArray(i.outcomes) || !Array.isArray(i.reporting)
    || !name(i.tenant) || !name(i.brand) || !time(i.now)) throw new ReportInputError();
  bound('records', i.decisions.length); bound('records', i.outcomes.length);
  bound('policies', i.reporting.length + 1); validateReportPolicies([i.learning, ...i.reporting]);
  const cfg = i.learn.stats ?? DEFAULT_STATS;
  if (!finite(cfg.tauLearnMs) || cfg.tauLearnMs <= 0 || !finite(cfg.n0) || cfg.n0 <= 0 || !finite(cfg.nMin)
    || !finite(cfg.liftMin) || !finite(cfg.liftMax)) throw new ReportInputError();
  const visitors = new Map<string, { count: number; products: number }>();
  const projected = new Map<string, Map<string | null, Set<string>>>();
  const projections = new Map<string, string[]>();
  let cells = 0;
  let rawBytes = 0, work = 0;
  const spend = (n: number) => { work += n; bound('work', work); };
  const cell = (slot: string, item: string | null, key: string) => {
    let byItem = projected.get(slot); if (!byItem) { byItem = new Map(); projected.set(slot, byItem); }
    let keys = byItem.get(item); if (!keys) { keys = new Set(); byItem.set(item, keys); }
    if (keys.has(key)) return false;
    if (byteLength(key) > 2048 || Object.hasOwn(Object.prototype, key)) throw new ReportInputError();
    keys.add(key); bound('cells', ++cells * (i.reporting.length + 1)); return true;
  };
  for (const d of i.decisions) {
    rowShape(d, 'decision'); rawBytes += byteLength(JSON.stringify(d)); bound('rawBytes', rawBytes);
    const v = visitors.get(d.visitor_id) ?? { count: 0, products: 0 };
    v.count++; v.products += d.featured_product_ids?.length ?? 0; visitors.set(d.visitor_id, v); spend(1 + (d.featured_product_ids?.length ?? 0));
    // Include default rows: a first duplicate ID can attribute their credits to personalization.
    const c = d.cell, projectionId = JSON.stringify([c.channel || 'unknown', c.visit_bucket || 'unknown', c.stage ?? 'unknown', c.region ?? 'none', c.affinity ?? 'none']);
    let keys = projections.get(projectionId);
    if (!keys) { keys = levelKeys(c); projections.set(projectionId, keys); }
    for (const key of keys) {
      cell(d.slot, d.item_id, key);
      for (let k: string | null = key; k !== null; k = parentKey(k)) if (!cell(d.slot, null, k)) break;
    }
  }
  const sortWork = (n: number) => n * (1 + Math.ceil(Math.log2(Math.max(2, n))));
  for (const v of visitors.values()) spend(sortWork(v.count));
  for (const o of i.outcomes) {
    rowShape(o, 'outcome'); rawBytes += byteLength(JSON.stringify(o)); bound('rawBytes', rawBytes);
    const named = o.products?.length ?? (o.item_id ? 1 : 0), v = visitors.get(o.visitor_id);
    spend(1 + named + (i.reporting.length + 1) * (v ? sortWork(v.count) + v.products * named : 1));
  }
}

export function rawReportJson(report: DayReport): string {
  return reportPayloadJson(report);
}
export function reportPayloadJson(report: unknown): string {
  const body = JSON.stringify(report); bound('outputBytes', byteLength(body)); return body;
}

export interface ReportReadBudget { bytes: number; cells: number }
export interface SavedReportReader { get(key: string, options?: R2GetOptions): Promise<unknown> }
export function validateReportIds(ids: { tenant: string; brand: string; date: string }): void {
  if (!name(ids.tenant) || !name(ids.brand) || !/^\d{4}-\d{2}-\d{2}$/.test(ids.date)) throw new ReportInputError();
  const day = Date.parse(ids.date + 'T00:00:00Z');
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== ids.date) throw new ReportInputError();
}

/** No unbounded json() fallback. Native size and actual stream bytes precede parsing. */
export async function storedReportText(value: unknown, budget: ReportReadBudget,
  perObject: 'savedBytes' | 'aggregateBytes', combined: 'windowBytes' | 'aggregateBytes'): Promise<string> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let body: ReadableStream<Uint8Array> | undefined;
  try {
    if (!object(value)) throw new ReportUnavailableError();
    body = value.body as ReadableStream<Uint8Array> | undefined;
    const check = (size: number) => { bound(perObject, size); bound(combined, budget.bytes + size); };
    if (value.size !== undefined) {
      if (!Number.isSafeInteger(value.size) || Number(value.size) < 0) throw new ReportUnavailableError();
      check(Number(value.size));
    }
    let text = '', size = 0;
    if (body) {
      reader = body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
      for (;;) {
        const next = await reader.read(); if (next.done) break;
        if (!(next.value instanceof Uint8Array)) throw new ReportUnavailableError();
        size += next.value.byteLength; check(size); text += decoder.decode(next.value, { stream: true });
      }
      text += decoder.decode();
    } else {
      if (typeof value.text !== 'function') throw new ReportUnavailableError();
      text = await value.text(); if (typeof text !== 'string') throw new ReportUnavailableError();
      size = byteLength(text); check(size); // text-only adapters have already materialized their body
    }
    budget.bytes += size; return text;
  } catch (error) {
    try { if (reader) await reader.cancel(); else if (body) await body.cancel(); } catch { /* retain original refusal */ }
    throw error instanceof ReportBudgetExceeded ? error : new ReportUnavailableError();
  } finally { reader?.releaseLock(); }
}

/** Bound exposed/pooled structures; legacy coverage remains the normalizer's concern. */
function savedShape(value: unknown, ids: { tenant: string; brand: string; date: string }, budget: ReportReadBudget): asserts value is DayReport {
  if (!object(value) || value.tenant !== ids.tenant || value.brand !== ids.brand || value.date !== ids.date) throw new ReportUnavailableError();
  const fail = (): never => { throw new ReportUnavailableError(); };
  const count = (v: unknown) => { if (!finite(v) || v < 0) fail(); };
  const row = () => bound('cells', ++budget.cells);
  const map = (v: unknown): Record<string, unknown> => { if (!object(v)) return fail(); return v; };
  const field = (key: string, max = 256) => { if (!key || key.length > max || byteLength(key) > max || Object.hasOwn(Object.prototype, key)) fail(); };
  // Fields absent from older window-only records are not invented or required.
  for (const [slot, rows] of Object.entries(map(value.holdout))) {
    field(slot); row(); if (!Array.isArray(rows)) fail();
    for (const r of rows as unknown[]) {
      row(); const a = map(r); if (!name(a.arm)) fail(); count(a.decisions); count(a.credited);
      if (Number(a.decisions) > 0 && !Number.isFinite(Number(a.credited) / Number(a.decisions))) fail();
    }
  }
  if (value.counts !== undefined) { const c = map(value.counts); for (const k of ['decisions', 'outcomes', 'visitors']) count(c[k]); if (typeof c.truncated !== 'boolean'
    || (Object.hasOwn(c, 'duplicates') && !validDuplicateCounts(c.duplicates))
    || (Object.hasOwn(c, 'conflicts') && !validDuplicateCounts(c.conflicts))) fail(); }
  if (value.policies !== undefined) {
    if (!Array.isArray(value.policies)) fail();
    bound('policies', (value.policies as unknown[]).length);
    // W26 R1.01: `legacyCredits` is validated when present and never required —
    // a day report retained before it existed stays readable.
    for (const p of value.policies as unknown[]) { const v = map(p); row(); if (!name(v.name) || (v.role !== 'learning' && v.role !== 'reporting')) fail(); count(v.credits);
      if (v.legacyCredits !== undefined) count(v.legacyCredits); }
  }
  if (value.exploration !== undefined) {
    if (!Array.isArray(value.exploration)) fail();
    for (const e of value.exploration as unknown[]) { const v = map(e); row(); if (!name(v.slot)) fail(); count(v.decisions); count(v.explored); }
  }
  if (value.grids !== undefined) for (const [slot, policies] of Object.entries(map(value.grids))) {
    field(slot);
    // P104 (RF1): bounded per slot (SLOT_GRID_ROWS), not across the day.
    let slotRows = 0; const row = () => { if (++slotRows > SLOT_GRID_ROWS) bound('cells', REPORT_LIMITS.cells + 1); };
    for (const [policy, snap] of Object.entries(map(policies))) {
      field(policy); row(); const s = map(snap);
      if (s.tenant !== ids.tenant || s.brand !== ids.brand || s.slot !== slot) fail();
      for (const [item, levels] of Object.entries(map(s.items))) {
        field(item); row();
        for (const [key, level] of Object.entries(map(levels))) {
          field(key, 2048); row(); const l = map(level);
          for (const k of ['n', 's', 'p0', 'p_hat', 'lift']) count(l[k]);
        }
      }
      for (const [key, rate] of Object.entries(map(s.slotRates))) {
        field(key, 2048); row(); const r = map(rate); for (const k of ['n', 's', 'rate']) count(r[k]);
      }
    }
  }
}

async function savedDocument(r2: SavedReportReader, ids: { tenant: string; brand: string; date: string },
  budget: ReportReadBudget): Promise<{ report: DayReport; text: string; etag: string | undefined } | null> {
  validateReportIds(ids);
  try {
    const obj = await r2.get(reportKey(ids.tenant, ids.brand, ids.date));
    if (obj === null) return null;
    const text = await storedReportText(obj, budget, 'savedBytes', 'windowBytes');
    const report: unknown = JSON.parse(text);
    if (object(report)) delete report._parts;
    savedShape(report, ids, budget); return { report, text, etag: objectEtag(obj) };
  } catch (error) { throw error instanceof ReportBudgetExceeded ? error : new ReportUnavailableError(); }
}

/**
 * W33 O4: the whole stored day with the etag of the object it came from, for a
 * writer that replaces exactly that object or nothing. The leading summary
 * frame is the writer's, not the day's, and is not part of the answer.
 */
export async function readStoredDay(r2: SavedReportReader, ids: { tenant: string; brand: string; date: string }): Promise<{ report: DayReport; etag: string } | null> {
  const doc = await savedDocument(r2, ids, { bytes: 0, cells: 0 });
  if (!doc) return null;
  if (doc.etag === undefined) throw new ReportUnavailableError();
  const { _summary: _frame, ...report } = doc.report as DayReport & { _summary?: unknown };
  void _frame;
  return { report, etag: doc.etag };
}

export async function readSavedReport(r2: SavedReportReader, ids: { tenant: string; brand: string; date: string },
  budget: ReportReadBudget = { bytes: 0, cells: 0 }): Promise<DayReport | null> {
  return (await savedDocument(r2, ids, budget))?.report ?? null;
}

export class ReportRevisionChanged extends Error { constructor() { super('report changed; reload the first page'); } }
interface ReportCursor { v: 1; tenant: string; brand: string; date: string; slot: string; limit: number; offset: number; revision: string }
export interface ReportPage { slot: string; revision: string; total: number; offset: number; limit: number; next: string | null; previous: string | null }
const revisionShape = (v: unknown): v is string => typeof v === 'string' && v.length === 64 && !/[^a-f0-9]/.test(v);
const reportCursor = (c: ReportCursor) => btoa(String.fromCharCode(...utf8.encode(JSON.stringify(c)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Opt-in browser projection. The full read remains bounded; no second get or full serialization for identity. */
export async function readReportView(r2: SavedReportReader, ids: { tenant: string; brand: string; date: string },
  query: { slot?: string; limit?: string; cursor?: string; revision?: string }): Promise<{ report: DayReport; page?: ReportPage } | null> {
  validateReportIds(ids);
  const { slot } = query;
  if (query.revision !== undefined && !revisionShape(query.revision)) throw new ReportInputError();
  if (slot === undefined && (query.limit !== undefined || query.cursor !== undefined)) throw new ReportInputError();
  let limit = 50, cursor: ReportCursor | undefined;
  if (slot !== undefined) {
    if (!name(slot) || !slot.trim()) throw new ReportInputError();
    if (query.limit !== undefined) {
      if (query.limit.length > 3 || !/^[1-9]/.test(query.limit) || /[^0-9]/.test(query.limit)) throw new ReportInputError();
      limit = Number(query.limit); if (limit > 500) throw new ReportInputError();
    }
    if (query.cursor !== undefined) {
      try {
        if (!query.cursor || query.cursor.length > 2048 || /[^A-Za-z0-9_-]/.test(query.cursor)) throw new ReportInputError();
        const bytes = Uint8Array.from(atob(query.cursor.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
        const c: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
        if (!object(c) || Object.keys(c).sort().join(',') !== 'brand,date,limit,offset,revision,slot,tenant,v'
          || c.v !== 1 || c.tenant !== ids.tenant || c.brand !== ids.brand || c.date !== ids.date || c.slot !== slot || c.limit !== limit
          || !Number.isSafeInteger(c.offset) || Number(c.offset) < 0 || Number(c.offset) > REPORT_LIMITS.cells || Number(c.offset) % limit !== 0
          || !revisionShape(c.revision)) throw new ReportInputError();
        cursor = c as unknown as ReportCursor;
      } catch { throw new ReportInputError(); }
    }
    if (cursor && query.revision !== undefined && cursor.revision !== query.revision) throw new ReportInputError();
    // JSON escaping can exceed the wire token budget even for bounded UTF-8 components.
    // Reserve the maximum admitted offset width so every emitted link remains readable.
    if (reportCursor({ v: 1, ...ids, slot, limit, offset: REPORT_LIMITS.cells, revision: '0'.repeat(64) }).length > 2048) throw new ReportInputError();
  }
  const parted = await partedDay(r2, ids, slot);
  if (parted === 'missing') return null;
  if ('whole' in parted) {
    const doc = await savedDocument({ get: async () => parted.whole } as unknown as SavedReportReader, ids, { bytes: 0, cells: 0 });
    if (!doc) return null;
    const report = diagnosticDayReport(doc.report);
    if (slot === undefined && query.revision === undefined) return { report };
    const revision = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(doc.text))), b => b.toString(16).padStart(2, '0')).join('');
    return pageOf(report, revision, slot, limit, cursor, query, ids);
  }
  if ('report' in parted) {
    const report = diagnosticDayReport(parted.report);
    // The slot index rides beside the head: every slot whose grid is in a part.
    if (slot === undefined && query.revision === undefined) return { report: { ...report, slots: (parted.report as unknown as { slots?: string[] }).slots ?? [] } as DayReport };
    const revision = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(parted.text))), b => b.toString(16).padStart(2, '0')).join('');
    return pageOf(report, revision, slot, limit, cursor, query, ids);
  }
  const doc = await savedDocument(r2, ids, { bytes: 0, cells: 0 });
  if (!doc) return null;
  const report = diagnosticDayReport(doc.report);
  if (slot === undefined && query.revision === undefined) return { report };
  const revision = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(doc.text))), b => b.toString(16).padStart(2, '0')).join('');
  return pageOf(report, revision, slot, limit, cursor, query, ids);
}
/** A stored day of parts: its head, and the asked slot's part read by its byte range; the whole day where it is within 8 MiB and no slot is asked. */
async function partedDay(r2: SavedReportReader, ids: { tenant: string; brand: string; date: string }, slot: string | undefined): Promise<{ report: DayReport; text: string } | { whole: unknown } | 'missing'> {
  const ranged = r2 as unknown as { get(key: string, o?: unknown): Promise<{ text(): Promise<string>; size?: number; customMetadata?: Record<string, string>; body?: { cancel?(): unknown } } | null> };
  // One get, as today: a day stored in parts says so in its object's metadata (written with it), so a day within 8 MiB is read whole by that one get.
  const whole = await ranged.get(reportKey(ids.tenant, ids.brand, ids.date));
  if (whole === null) return 'missing';
  if (!whole || typeof whole !== 'object' || whole.customMetadata?.parts !== '1') return { whole };
  try { await whole.body?.cancel?.(); } catch { /* its body is not read */ }
  const first = await ranged.get(reportKey(ids.tenant, ids.brand, ids.date), { range: { offset: 0, length: REPORT_LIMITS.summaryBytes * 4 } });
  if (first === null) return 'missing';
  const lead = await first.text();
  const lines = lead.split('\n');
  if (!lines[1]?.startsWith('"_parts":')) throw new ReportUnavailableError();
  const index = JSON.parse(lines[1].slice('"_parts":'.length, -1)) as { slots: Record<string, [string, string]> };
  const size = Number(whole.size ?? first.size ?? 0);
  const headStart = byteLength(lines[0]!) + 1 + byteLength(lines[1]!) + 1;
  const ranges = Object.values(index.slots).map(([o]) => Number(o));
  const headEnd = ranges.length ? Math.min(...ranges) - byteLength(',"grids":{') : size - 1;
  const headText = await (await ranged.get(reportKey(ids.tenant, ids.brand, ids.date), { range: { offset: headStart, length: headEnd - headStart } }))!.text();
  const head = JSON.parse('{' + headText + '}') as DayReport;
  let grids: Record<string, unknown> = {}, partText = '';
  if (slot !== undefined && index.slots[slot]) {
    const [o, l] = index.slots[slot]!;
    partText = await (await ranged.get(reportKey(ids.tenant, ids.brand, ids.date), { range: { offset: Number(o), length: Number(l) } }))!.text();
    grids = JSON.parse('{' + partText + '}') as Record<string, unknown>;
  }
  const report = { ...head, grids, ...(slot === undefined ? { slots: Object.keys(index.slots) } : {}) } as unknown as DayReport;
  savedShape(report, ids, { bytes: 0, cells: 0 });
  return { report, text: headText + partText };
}
function pageOf(report: DayReport, revision: string, slot: string | undefined, limit: number, cursor: ReportCursor | undefined,
  query: { revision?: string }, ids: { tenant: string; brand: string; date: string }): { report: DayReport; page?: ReportPage } {
  if ((query.revision !== undefined && query.revision !== revision) || (cursor && cursor.revision !== revision)) throw new ReportRevisionChanged();
  if (slot === undefined) return { report };
  if (!object(report.grids) || !Array.isArray(report.policies) || !report.counts || !finite(report.builtAt)) throw new ReportUnavailableError();
  const grid = report.grids[slot], names = report.policies.map(p => p.name);
  const items = [...new Set(names.flatMap(n => Object.keys(grid?.[n]?.items ?? {})))].sort();
  const offset = cursor?.offset ?? 0;
  if (offset > 0 && offset >= items.length) throw new ReportInputError();
  const selected = items.slice(offset, offset + limit), projected: Record<string, LiftSnapshot> = {};
  if (grid) for (const n of names) {
    const snap = grid[n]; if (!snap) continue;
    const entries: LiftSnapshot['items'] = {};
    for (const item of selected) if (snap.items[item]) entries[item] = snap.items[item]['*'] ? { '*': snap.items[item]['*']! } : {};
    projected[n] = { ...snap, items: entries, slotRates: snap.slotRates['*'] ? { '*': snap.slotRates['*'] } : {} };
  }
  const at = (offset: number) => reportCursor({ v: 1, ...ids, slot, limit, offset, revision });
  return { report: { ...report, grids: grid ? { [slot]: projected } : {} },
    page: { slot, revision, total: items.length, offset, limit, next: offset + limit < items.length ? at(offset + limit) : null, previous: offset > 0 ? at(Math.max(0, offset - limit)) : null } };
}

const SUMMARY_START = '{"_summary":';
type ReportSummary = Pick<DayReport, 'tenant' | 'brand' | 'date' | 'builtAt' | 'counts' | 'hours' | 'coverage' | 'computation' | 'armVisitors' | 'allocation' | 'attributionContract' | 'provenance'> & {
  version: 1; holdout: Record<string, Array<Pick<ArmRow, 'arm' | 'decisions' | 'credited'>>>;
};
function summaryShape(s: unknown, ids: { tenant: string; brand: string; date: string }, budget: ReportReadBudget): asserts s is DayReport {
  // `armVisitors` rides the summary because the window pools it from here; a
  // summary written before it existed simply does not carry the key. W31 M1.01:
  // `allocation` rides it for the same reason and on the same terms — the window
  // states the allocation its days agree on, and a summary written before the
  // key existed is unknown, never re-derived (R149).
  if (!object(s) || s.version !== 1 || !finite(s.builtAt) || !object(s.counts)
    || !Object.hasOwn(s, 'coverage') || Object.keys(s).some(k => !['version', 'tenant', 'brand', 'date', 'builtAt', 'counts', 'holdout', 'hours', 'coverage', 'computation', 'armVisitors', 'allocation', 'attributionContract', 'provenance'].includes(k))) throw new ReportUnavailableError();
  savedShape(s, ids, budget);
}
function summaryLine(line: string, ids: { tenant: string; brand: string; date: string }, budget: ReportReadBudget): DayReport {
  bound('summaryBytes', byteLength(line) + 1);
  if (!line.startsWith(SUMMARY_START) || !line.endsWith(',')) throw new ReportUnavailableError();
  const summary: unknown = JSON.parse(line.slice(SUMMARY_START.length, -1));
  summaryShape(summary, ids, budget); return summary;
}

/** One canonical body, one put. Writer-owned plain results are serialized without an await. */
export function canonicalReportJson(report: DayReport): string {
  if (Object.hasOwn(report, '_summary')) throw new ReportInputError();
  const summary: ReportSummary = { version: 1, tenant: report.tenant, brand: report.brand, date: report.date,
    builtAt: report.builtAt, counts: report.counts,
    holdout: Object.fromEntries(Object.entries(report.holdout).map(([slot, rows]) =>
      [slot, rows.map(({ arm, decisions, credited }) => ({ arm, decisions, credited }))])),
    ...(report.hours ? { hours: report.hours } : {}), coverage: reportCoverage(report), computation: recordedComputation(report.computation),
    armVisitors: validArmVisitors(report.armVisitors, 'distinct_visitors'),
    // W31 M1.01: the window states the published allocation its days agree on,
    // and it pools from this frame, so the allocation rides it rather than being
    // bought with a second read. Absent where the day records none.
    ...(validAllocation(report.allocation) ? { allocation: validAllocation(report.allocation)! } : {}),
    // W22 A1.01: the window pools from the summary, so the contract it pooled
    // under has to be readable without opening the whole grid.
    ...(validAttributionContract(report.attributionContract) ? { attributionContract: validAttributionContract(report.attributionContract)! } : {}),
    // W33 O3/O4: the window pools from this frame, so a day's provenance rides
    // it — a declared day is withheld from the pool without opening its grid.
    ...(validProvenance(report.provenance) ? { provenance: validProvenance(report.provenance)! } : {}) };
  const prefix = SUMMARY_START + JSON.stringify(summary) + ',\n';
  bound('summaryBytes', byteLength(prefix));
  // A day within 8 MiB is stored exactly as today; a day past it as its head and one part per slot.
  const whole = JSON.stringify(report);
  if (byteLength(prefix) + byteLength(whole) <= REPORT_LIMITS.outputBytes) return prefix + whole.slice(1);
  const { grids, ...head } = report;
  const slotNames = Object.keys(grids ?? {});
  const parts = slotNames.map(slot => JSON.stringify(slot) + ':' + JSON.stringify(grids[slot]));
  const headJson = JSON.stringify(head);
  // The index names each slot's byte range; its numbers are padded so its own length is known before they are.
  const pad = (n: number) => String(n).padStart(12, '0');
  const indexOf = (offsets: number[]) => '"_parts":' + JSON.stringify({ version: 1, slots: Object.fromEntries(slotNames.map((s, i) => [s, [pad(offsets[i] ?? 0), pad(byteLength(parts[i]!))]])) }) + ',\n';
  const probe = indexOf(slotNames.map(() => 0));
  let at = byteLength(prefix) + byteLength(probe) + byteLength(headJson.slice(1, -1)) + byteLength(',"grids":{');
  const offsets = parts.map((part, i) => { const start = at + (i ? 1 : 0); at = start + byteLength(part); return start; });
  return prefix + indexOf(offsets) + headJson.slice(1, -1) + ',"grids":{' + parts.join(',') + '}}';
}

/** Read only bytes needed to identify the leading frame, charging whole received chunks. */
async function summaryPrefix(value: unknown, budget: ReportReadBudget): Promise<{ bytes: Uint8Array; complete: boolean }> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, body: ReadableStream<Uint8Array> | undefined;
  try {
    if (!object(value)) throw new ReportUnavailableError();
    body = value.body as ReadableStream<Uint8Array> | undefined;
    const size = value.size;
    if (size !== undefined) {
      if (!Number.isSafeInteger(size) || Number(size) < 0) throw new ReportUnavailableError();
      bound('savedBytes', Number(size)); // full-object size is NOT the returned range length
    }
    const bytes = new Uint8Array(REPORT_LIMITS.summaryBytes); let received = 0;
    const add = (chunk: Uint8Array) => {
      budget.bytes += chunk.byteLength; bound('windowBytes', budget.bytes);
      received += chunk.byteLength; bound('summaryBytes', received);
      bytes.set(chunk, received - chunk.byteLength);
    };
    if (body) {
      reader = body.getReader();
      for (;;) {
        const next = await reader.read(); if (next.done) break;
        if (!(next.value instanceof Uint8Array)) throw new ReportUnavailableError();
        add(next.value);
        if (next.value.includes(10) || received >= REPORT_LIMITS.summaryBytes) break;
        // A nonframed prefix needs no additional prefix bytes before the full fallback.
        if (received >= SUMMARY_START.length && SUMMARY_START.split('').some((c, i) => bytes[i] !== c.charCodeAt(0))) break;
      }
    } else {
      if (typeof value.text !== 'function') throw new ReportUnavailableError();
      const text: unknown = await value.text(); if (typeof text !== 'string') throw new ReportUnavailableError();
      add(utf8.encode(text));
    }
    return { bytes: bytes.subarray(0, received), complete: size !== undefined && Number(size) === received };
  } catch (error) { throw error instanceof ReportBudgetExceeded ? error : new ReportUnavailableError(); }
  finally {
    try { if (reader) await reader.cancel(); else if (body) await body.cancel(); } catch { /* no read-side retry */ }
    reader?.releaseLock();
  }
}

/** New canonical reports need one short range; legacy fallback is one independent full version. */
export async function readWindowSummary(r2: SavedReportReader, ids: { tenant: string; brand: string; date: string }, budget: ReportReadBudget): Promise<DayReport | null> {
  return (await readCanonicalSummary(r2, ids, budget)).report;
}

/**
 * W33 O2: the canonical day object a writer NOTED before it read any of its
 * sources, so its write can be made conditional on exactly that object. `etag`
 * is `null` where no day was stored, and `undefined` where the note could not be
 * taken (a failed listing, or a stored day that states no etag, which R2 always
 * states): a write cannot be made conditional on that, so it is refused rather
 * than made blind.
 */
export interface CanonicalNote { etag: string | null | undefined }
const objectEtag = (value: unknown): string | undefined =>
  object(value) && typeof value.etag === 'string' && value.etag.length > 0 && value.etag.length <= 256 ? value.etag : undefined;

/** `readWindowSummary`, answering also the etag of the object whose summary it returned. */
export async function readCanonicalSummary(r2: SavedReportReader, ids: { tenant: string; brand: string; date: string },
  budget: ReportReadBudget): Promise<{ report: DayReport | null; etag: string | null | undefined }> {
  validateReportIds(ids);
  try {
    const first = await r2.get(reportKey(ids.tenant, ids.brand, ids.date), { range: { offset: 0, length: REPORT_LIMITS.summaryBytes } });
    if (first === null) return { report: null, etag: null };
    const prefix = await summaryPrefix(first, budget), decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
    const marked = prefix.bytes.length >= SUMMARY_START.length && SUMMARY_START.split('').every((c, i) => prefix.bytes[i] === c.charCodeAt(0));
    if (marked) {
      const end = prefix.bytes.indexOf(10);
      if (end < 0) {
        if (prefix.bytes.length === REPORT_LIMITS.summaryBytes) throw new ReportBudgetExceeded('summaryBytes', REPORT_LIMITS.summaryBytes, REPORT_LIMITS.summaryBytes + 1);
        throw new ReportUnavailableError();
      }
      // Decode only the framed line: the following grid can end mid-codepoint in this range.
      const line = decoder.decode(prefix.bytes.subarray(0, end));
      return { report: summaryLine(line, ids, budget), etag: objectEtag(first) };
    }
    if (prefix.complete) {
      const report: unknown = JSON.parse(decoder.decode(prefix.bytes));
      if (object(report) && Object.hasOwn(report, '_summary')) throw new ReportUnavailableError();
      savedShape(report, ids, budget); return { report, etag: objectEtag(first) };
    }
    // Discard every prefix fact. A concurrent replacement is read wholly, never mixed.
    const whole = await r2.get(reportKey(ids.tenant, ids.brand, ids.date));
    const full = await storedReportText(whole, budget, 'savedBytes', 'windowBytes');
    const report: unknown = JSON.parse(full);
    if (object(report) && Object.hasOwn(report, '_summary')) {
      const end = full.indexOf('\n');
      if (end < 0) { bound('summaryBytes', byteLength(full) + 1); throw new ReportUnavailableError(); }
      summaryLine(full.slice(0, end), ids, budget);
    }
    savedShape(report, ids, budget);
    return { report, etag: objectEtag(whole) };
  } catch (error) { throw error instanceof ReportBudgetExceeded ? error : new ReportUnavailableError(); }
}

/**
 * W33 O2: note the canonical day object BEFORE reading any source — one listing
 * of the day's own key, which states the stored object's etag, so the note costs
 * no read of the day and no read of any source. A listing that names the key
 * without an etag (never R2's) is completed by a one-byte read of the object.
 */
export async function noteCanonicalDay(r2: SavedReportReader & { list(options: { prefix: string; limit?: number }): Promise<unknown> },
  ids: { tenant: string; brand: string; date: string }): Promise<CanonicalNote> {
  validateReportIds(ids);
  const key = reportKey(ids.tenant, ids.brand, ids.date);
  try {
    const page = await r2.list({ prefix: key, limit: 1 });
    const listed = object(page) && Array.isArray(page.objects) ? (page.objects as unknown[]).find(o => object(o) && o.key === key) : undefined;
    if (listed === undefined) return { etag: null };
    const etag = objectEtag(listed);
    if (etag !== undefined) return { etag };
    const obj = await r2.get(key, { range: { offset: 0, length: 1 } });
    if (obj === null) return { etag: null };
    try { if (object(obj) && obj.body instanceof ReadableStream) await obj.body.cancel(); } catch { /* the etag is what was asked */ }
    return { etag: objectEtag(obj) };
  } catch { return { etag: undefined }; }
}

/**
 * W33 O2 (document 35 §5 row W33, "Protect against concurrent overlay/canonical
 * writes"): the one way a canonical day is written — by the POST without
 * `policies`, the nightly job, the five-minute job and `repairCanonicalDay`.
 * The put is conditional on the object `note` names: the object the writer
 * noted before it read any source (the five-minute job's note is the etag of
 * the summary it read; the repair's, the etag of the day it judged). If ANY
 * other write reached the day after the note, the put is refused and the stored
 * day stands, so a writer whose sources were read before a newer day was stored
 * never replaces it. There is no read at write time and no comparison of build
 * times. Answers whether this body was stored; a refusal is not an error. An
 * unknown note refuses, and a storage failure throws.
 */
export async function writeCanonicalDay(r2: { put(key: string, body: string, opts?: unknown): Promise<unknown> },
  ids: { tenant: string; brand: string; date: string }, body: string, note: CanonicalNote): Promise<boolean> {
  if (note.etag === undefined) throw new ReportUnavailableError();
  const written = await r2.put(reportKey(ids.tenant, ids.brand, ids.date), body,
    { onlyIf: note.etag === null ? { etagDoesNotMatch: '*' } : { etagMatches: note.etag }, httpMetadata: { contentType: 'application/json' },
      ...(body.startsWith('"_parts":', body.indexOf('\n') + 1) ? { customMetadata: { parts: '1' } } : {}) });
  return written !== null;
}

export interface ReportInput {
  tenant: string;
  brand: string;
  date: string;
  /** The learning policy in force (from the learn document) and the reporting overlays to compare. */
  learning: ReportPolicy;
  reporting: ReportPolicy[];
  learn: LearnConfig;
  decisions: readonly DecisionRecord[];
  outcomes: readonly OutcomeRecord[];
  /** P104 (RF6): the previous day's decisions, carried into the rings only, as the hourly fold carries them. */
  carry?: readonly DecisionRecord[];
  now: number;
  truncated: boolean;
  /** W22 D1.03: conflicts already filed, excluded here instead of refusing the day. */
  resolved?: ResolvedConflicts;
  /**
   * W25 O1.01 (F20 §5, §7): the imported priors these grids are to be built
   * with, in the shape `buildSnapshot` already takes — the prior document's
   * revision and its resolved index. `indexPriors` resolves one SLOT at a time,
   * so a caller with more than one slot passes a function and gets asked per
   * slot; a caller with one index passes it and it is used for every slot it has
   * rows for. Absent, the grids are built prior-free, exactly as every caller
   * builds them today, and the report SAYS so in `gridPriors` rather than
   * leaving a reader to discover it by comparing numbers.
   */
  priors?: { version: number; index: PriorIndex | ((slot: string) => PriorIndex | null | undefined) } | null;
}

/** The priors input of `buildReport`, as a production caller hands it over. */
export type ReportPriors = NonNullable<ReportInput['priors']>;

/**
 * W25 R4 (LANE-LOG R183): the tenant's published prior document as the input
 * `buildReport` takes, resolved per slot under the tenant's own learn document —
 * the index the statistics object would build for that slot, read the way
 * `LearnStats` reads it (`indexPriors` under the slot's measurement basis).
 *
 * A slot whose objective is `revenue` or `margin` gets no index: an imported
 * prior is a probability, the statistics object refuses to publish such a slot
 * rather than apply one in the wrong unit (W25 Z1.01), and the offline grid does
 * not do what the live table refuses to — its grid is built prior-free and says
 * so (`priorVersion: 0` on that grid). A document past the bound every reader
 * indexes within is refused here, before any grid is built, rather than read as
 * no prior at all.
 */
export function reportPriors(doc: PriorsDoc, version: number, learn: LearnConfig): ReportPriors {
  if (priorCapacityExceeded(doc) || !Number.isSafeInteger(version) || version < 0) throw new ReportUnavailableError();
  const configs = slotConfigsOf(learn);
  return { version, index: (slot: string) => {
    const config = configs[slot];
    if ((config?.objective ?? 'unit') !== 'unit') return null;
    return indexPriors(doc, slot, config?.measurementBasis ?? 'served-v1');
  } };
}

/** The prior index in force for one slot, or null where the grid is prior-free. */
function priorsForSlot(priors: ReportInput['priors'], slot: string): PriorIndex | null {
  if (!priors) return null;
  const index = typeof priors.index === 'function' ? priors.index(slot) : priors.index;
  return index && index.size > 0 ? index : null;
}

export interface ArmRow {
  arm: string;
  decisions: number;
  credited: number;
  creditedPerDecision: number | null;
  /** Compatibility alias for credit intensity, not a probability; repeat credits may exceed decisions. */
  rate: number | null;
}
export const REPORT_MEASUREMENT = {
  kind: 'attribution_diagnostic',
  unit: 'credited_outcomes_per_content_item_decision',
  inference: 'unavailable',
  experimentalCoverage: 'not_assessed',
} as const;

/**
 * W21 C1.03 (F25 §5.3, §7): the per-arm DENOMINATORS, which decisions are not.
 * Within a day the figure is distinct visitors; pooled across days it is
 * visitor-days, and the basis says which, because a visitor active on two days
 * is two visitor-days and calling both "visitors" would misstate the design
 * effect. A source that predates the version field is unknown — `null`, never
 * zero and never re-derived from the decision counts it does hold.
 */
export interface ArmVisitors {
  version: 1;
  basis: 'distinct_visitors' | 'visitor_days';
  arms: Array<{ arm: string; visitors: number }>;
}
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
export function validArmVisitors(value: unknown, basis: ArmVisitors['basis']): ArmVisitors | null {
  if (!object(value) || value.version !== 1 || value.basis !== basis || !Array.isArray(value.arms)
    || value.arms.length > REPORT_LIMITS.cells) return null;
  const arms: ArmVisitors['arms'] = [];
  const seen = new Set<string>();
  for (const row of value.arms as unknown[]) {
    if (!object(row) || !name(row.arm) || !count(row.visitors) || seen.has(row.arm)) return null;
    seen.add(row.arm); arms.push({ arm: row.arm, visitors: row.visitors });
  }
  return { version: 1, basis, arms: arms.sort((a, b) => a.arm.localeCompare(b.arm)) };
}

/**
 * W21 C1.03 (F25 §1.3): the allocation in force when the day was built, so
 * sample sufficiency is computable on the customer's side under their own
 * protocol (D04) instead of being answered here from a fixed confidence and an
 * assumption of equal arms. Recorded from the tenant's published learn
 * document; absent on a report built before it was recorded.
 */
export interface ReportAllocation { version: 1; source: 'published'; share: number; arms: string[] }
/** The allocation a report records: the tenant's published holdout share and arms. */
export function publishedAllocation(learn: LearnConfig): ReportAllocation {
  const share = finite(learn.holdout?.share) ? Math.min(1, Math.max(0, learn.holdout.share)) : 0;
  return { version: 1, source: 'published', share, arms: [...(learn.holdout?.arms ?? [])] };
}
/**
 * W25 O1.01: a stored report's own declaration about its grids, read back
 * conservatively. Anything that is not exactly the declaration is unknown, and
 * unknown is absent — never re-derived as "prior-free".
 */
export function validGridPriors(value: unknown): { applied: boolean; priorVersion: number } | null {
  if (!object(value) || typeof value.applied !== 'boolean' || !finite(value.priorVersion)
    || value.priorVersion < 0 || !Number.isInteger(value.priorVersion)) return null;
  return { applied: value.applied, priorVersion: value.priorVersion };
}

export function validAllocation(value: unknown): ReportAllocation | null {
  if (!object(value) || value.version !== 1 || value.source !== 'published' || !finite(value.share)
    || value.share < 0 || value.share > 1 || !Array.isArray(value.arms) || value.arms.length > REPORT_LIMITS.policies
    || (value.arms as unknown[]).some(arm => !name(arm))) return null;
  return { version: 1, source: 'published', share: value.share, arms: [...(value.arms as string[])] };
}

/**
 * W33 O3 (document 35 §5 row W33, N09): the policy and version identity that
 * produced a stored day. `policies` is the ordered list of policy names the
 * day's numbers were computed under; `status` says how the day came to be under
 * the canonical key:
 *
 *  · `canonical` — a canonical writer published it from the hour aggregates or
 *    the ledger, under the learning policy and the preset overlays;
 *  · `repaired` — `repairCanonicalDay` found the day overwritten by a custom
 *    overlay and replaced it with the day the canonical writer computes from the
 *    retained sources;
 *  · `declared` — the same repair found the day overwritten and its sources
 *    gone, so the day is kept readable with the numbers it held, its `policies`
 *    name the overlay that produced them, and the window no longer pools it.
 *
 * Anything that is not exactly this shape is unknown, and unknown reads `null`:
 * a day written before the member existed is never taken for a recorded
 * canonical one.
 */
export interface DayProvenance { version: 1; status: 'canonical' | 'repaired' | 'declared'; policies: string[] }
export function validProvenance(value: unknown): DayProvenance | null {
  if (!object(value) || !only(value, ['version', 'status', 'policies']) || value.version !== 1
    || (value.status !== 'canonical' && value.status !== 'repaired' && value.status !== 'declared')
    || !Array.isArray(value.policies) || !value.policies.length || value.policies.length > REPORT_LIMITS.policies
    || !(value.policies as unknown[]).every(name) || new Set(value.policies).size !== value.policies.length) return null;
  return { version: 1, status: value.status, policies: [...(value.policies as string[])] };
}
/** What a canonical writer records: the names of the policies its own numbers were computed under, in order. */
export function dayProvenance(report: Pick<DayReport, 'policies'>, status: DayProvenance['status']): DayProvenance | null {
  return validProvenance({ version: 1, status, policies: report.policies.map(p => p.name) });
}
/**
 * W33 O4: is a stored day's policy set the canonical one — its learning policy
 * followed by exactly the preset overlays of that same learning policy, by name
 * and by effective definition, in order? That is what every canonical writer
 * has computed since the presets existed (they are unchanged since CW22), so a
 * day that fails it was written by a custom overlay (N09). `null` when the
 * stored policies cannot be read at all: that is not evidence either way.
 */
export function canonicalPolicySet(policies: unknown): boolean | null {
  if (!Array.isArray(policies) || !policies.length || policies.length > REPORT_LIMITS.policies) return null;
  const rows: Array<{ name: string; role: string; policy: AttributionPolicy }> = [];
  for (const row of policies as unknown[]) {
    if (!object(row) || !name(row.name) || (row.role !== 'learning' && row.role !== 'reporting') || !object(row.policy)) return null;
    try { validateReportPolicies([{ ...(row.policy as unknown as AttributionPolicy), name: row.name }]); } catch { return null; }
    rows.push({ name: row.name, role: row.role, policy: row.policy as unknown as AttributionPolicy });
  }
  const [learning, ...reporting] = rows;
  if (learning!.role !== 'learning' || learning!.name !== 'learning' || reporting.some(row => row.role !== 'reporting')) return false;
  const presets = presetPolicies(learning!.policy);
  const same = (a: AttributionPolicy, b: AttributionPolicy) => JSON.stringify(effectiveReportPolicy(a)) === JSON.stringify(effectiveReportPolicy(b));
  return reporting.length === presets.length && presets.every((preset, i) => reporting[i]!.name === preset.name && same(reporting[i]!.policy, preset));
}

/**
 * W21 E1.04 (F07 §2.5, §7): business outcomes counted by ENROLLMENT and by
 * VISITOR, independently of whether a served piece matched them. A control
 * visitor's purchase counts for control whether or not she was served anything
 * related to it, and two purchases by one visitor are one purchasing visitor.
 * No rate is published here: CVR, revenue per visitor and the return rate are
 * the customer's own unit definitions (D04, W21.P1.01).
 */
export interface VisitorOutcomes {
  version: 1;
  basis: 'enrolled_visitors';
  arms: Array<{ arm: string; visitors: number; byType: Record<string, number> }>;
}
export function validVisitorOutcomes(value: unknown): VisitorOutcomes | null {
  if (!object(value) || value.version !== 1 || value.basis !== 'enrolled_visitors' || !Array.isArray(value.arms)
    || value.arms.length > REPORT_LIMITS.cells) return null;
  const arms: VisitorOutcomes['arms'] = [];
  const seen = new Set<string>();
  for (const row of value.arms as unknown[]) {
    if (!object(row) || !name(row.arm) || !count(row.visitors) || seen.has(row.arm) || !object(row.byType)) return null;
    const byType: Record<string, number> = {};
    for (const [type, n] of Object.entries(row.byType)) {
      if (!rewards.has(type) || !count(n)) return null;
      byType[type] = n;
    }
    seen.add(row.arm); arms.push({ arm: row.arm, visitors: row.visitors, byType });
  }
  return { version: 1, basis: 'enrolled_visitors', arms: arms.sort((a, b) => a.arm.localeCompare(b.arm)) };
}

/**
 * The day's NAMED outcomes (`NAMED_OUTCOMES`, src/ledger/records.ts): every
 * outcome carried as the `custom` reward, counted under its own event name, so
 * a partner pickup and a retailer referral each read as themselves beside the
 * orders (`visitorOutcomes`, the `purchase` type) and the attach (the slot
 * grids), never inside either and never as a sale: no value, currency or
 * revenue is read for them. Per name:
 *
 * - `outcomes`: the day's outcome records carried under it;
 * - `credited`: the decisions the LEARNING policy credited them to, whatever
 *   reward the slot itself learns from, because this is attribution and not
 *   learning (a slot learns from a named outcome only when it publishes
 *   `reward: 'custom'`);
 * - `bySlot`: slot → item → credits, the decision that earned each.
 *
 * Null where the day cannot say (an hour folded before this member existed);
 * absent on a report built before it existed.
 */
export interface NamedOutcomes {
  version: 1;
  basis: 'learning_policy';
  events: Record<string, NamedOutcomeRow>;
}
export interface NamedOutcomeRow { outcomes: number; credited: number; bySlot: Record<string, Record<string, number>> }
export const emptyNamedOutcomes = (): NamedOutcomes => ({ version: 1, basis: 'learning_policy', events: {} });
/** The row a named outcome counts under, or null when the outcome is not one (or its name cannot be a report key). */
export function namedOutcomeRow(named: NamedOutcomes, outcome: Pick<OutcomeRecord, 'type' | 'event'>): NamedOutcomeRow | null {
  if (outcome.type !== 'custom' || !name(outcome.event)) return null;
  return (named.events[outcome.event] ??= { outcomes: 0, credited: 0, bySlot: {} });
}
/** One credit to the decision that earned it; its slot and item are named where they can be report keys. */
export function creditNamedOutcome(row: NamedOutcomeRow, slot: string, item: string): void {
  row.credited += 1;
  if (!name(slot) || !name(item)) return;
  const items = (row.bySlot[slot] ??= {});
  items[item] = (items[item] ?? 0) + 1;
}
/** Two days', or two hours', named outcomes as one: every count adds. */
export function addNamedOutcomes(into: NamedOutcomes, from: NamedOutcomes): NamedOutcomes {
  for (const [event, row] of Object.entries(from.events)) {
    const to = (into.events[event] ??= { outcomes: 0, credited: 0, bySlot: {} });
    to.outcomes += row.outcomes; to.credited += row.credited;
    for (const [slot, items] of Object.entries(row.bySlot)) {
      const out = (to.bySlot[slot] ??= {});
      for (const [item, n] of Object.entries(items)) out[item] = (out[item] ?? 0) + n;
    }
  }
  return into;
}
/** Read back conservatively: anything that is not exactly the declaration is unknown, and unknown is null. */
export function validNamedOutcomes(value: unknown): NamedOutcomes | null {
  if (!object(value) || value.version !== 1 || value.basis !== 'learning_policy' || !object(value.events)
    || Object.keys(value.events).length > REPORT_LIMITS.cells) return null;
  const out = emptyNamedOutcomes();
  let cells = 0;
  for (const [event, row] of Object.entries(value.events)) {
    if (!name(event) || !object(row) || !count(row.outcomes) || !count(row.credited) || !object(row.bySlot)) return null;
    const bySlot: NamedOutcomeRow['bySlot'] = {};
    let named = 0;
    for (const [slot, items] of Object.entries(row.bySlot)) {
      if (!name(slot) || !object(items)) return null;
      const kept: Record<string, number> = {};
      for (const [item, n] of Object.entries(items)) {
        if (!name(item) || !count(n) || ++cells > REPORT_LIMITS.cells) return null;
        kept[item] = n; named += n;
      }
      bySlot[slot] = kept;
    }
    if (named > row.credited) return null;
    out.events[event] = { outcomes: row.outcomes, credited: row.credited, bySlot };
  }
  return out;
}

export function attributionArm(arm: string, decisions: number, credited: number): ArmRow {
  const creditedPerDecision = decisions > 0 ? credited / decisions : null;
  return { arm, decisions, credited, creditedPerDecision, rate: creditedPerDecision };
}
/**
 * §7: what explored in the slot, against the share the slot can actually
 * reserve. W28.W1.01: `mode` is the mode the engine RAN. Where the retained
 * document names a mode the engine will not run, the row publishes no share and
 * names the stored setting in `configuredMode`/`unsupported` — the words
 * `GET learn/exploring` answers with — so "configured 10%, realized 0%" is never
 * read off a policy that cannot explore at all.
 */
export interface ExploreRow {
  slot: string; decisions: number; explored: number; realized: number;
  configured: number | null; mode: string | null;
  /** The retained setting, where the engine will not run it. Absent for a supported mode. */
  configuredMode?: ExploreMode;
  /** Set with `configuredMode`: retained configuration, not an active policy. */
  unsupported?: boolean;
}

/** Reported source limitations, not delivery completeness or experimental maturity. */
export interface ReportCoverage {
  version: 1;
  source: 'aggregates' | 'ledger' | 'unknown';
  metadata: 'recorded' | 'absent' | 'invalid';
  status: 'incomplete' | 'unknown';
  maturity: 'unknown';
  truncated: boolean;
  visitorsIncomplete: boolean | null;
  missingHours: number[];
  truncatedHours: number[];
  unadvancedHours: number[];
  unknownHours: number[];
  horizons: Array<{ hour: number; horizonMs: number | null }>;
  minHorizonMs: number | null;
  /**
   * W21 C1.08 (R149): the built hours that cannot say what the experimental
   * ASSIGNMENT was, because they were folded before the aggregates carried it.
   * `[]` where every built hour carries it; `null` where the stored report does
   * not record the member at all, which is the honest unknown a report written
   * before this release is owed. A day with any such hour is grouped by the arm
   * SERVED and answers `armVisitors` and `visitorOutcomes` null.
   *
   * W21 R1 (LANE-LOG R156): also the built hours that carry the assignment of
   * every decision but could not PLACE one of their outcomes — its visitor had
   * no decision of the date at or before it, and none later in that hour, so
   * her first decision of the day (the raw-day rule) may lie in a later hour.
   * A day naming such an hour keeps its arm rows and `armVisitors` and answers
   * `visitorOutcomes` null.
   *
   * Optional in the stored evidence: a report written before this release does
   * not carry it and is still `metadata: 'recorded'`.
   */
  unassignedHours?: number[] | null;
  /**
   * W30 M1.01 (F17 §6 item 1): the published re-fold horizon this day was built
   * under, measured from each hour's own END. Inside it a folded hour is still
   * re-checked against its ledger prefix; past it the hour is final BY
   * DECLARATION. Absent where the source does not state it (R149).
   */
  refoldHorizonMs?: number;
  /**
   * W30 M1.01/R1.01: per built hour, `open` inside the horizon above, `final`
   * past it, and `repaired` where the hour's aggregate was WRITTEN after it
   * became final — a rebuild a caller asked for, or a first fold that reached
   * the hour late. Derived from the aggregate's own `builtAt`, so it needs no
   * new stored member, and an hour is in exactly one of the three.
   */
  maturities?: Array<{ hour: number; maturity: 'open' | 'final' | 'repaired' }>;
  /**
   * W30 M1.01: ledger objects that reached an hour's prefix after that hour was
   * final. They are COUNTED and NAMED here and applied nowhere: the rows stay in
   * the ledger, which is what makes this a declaration and not a cutoff
   * (HANDOFF-2026-09-16 :234, "User did not approve a blanket age cutoff").
   */
  lateAfterMaturity?: Array<{ hour: number; objects: number }>;
  /**
   * W30 V1.01: per built hour, the outcomes whose carry-in history the fold
   * could not reach — `evicted` where the visitor's attribution ring was full at
   * the moment the outcome was attributed and no credit was earned, `unplaced`
   * where no decision of the visitor's date could be found for it at all.
   */
  carryInHours?: Array<{ hour: number; evicted: number; unplaced: number }>;
  /** W30 C1.01/F1.01: per built hour, the ledger objects it holds and the objects the fold OPENED. */
  objectScan?: Array<{ hour: number; objects: number; read: number }>;
  /**
   * W30 F1.01 (W22 R143): the version-1 shard migration bound — the earliest
   * hour a repair can still put into the batch rings, because a version-1 state
   * remembers only a high-water mark. `0` where no shard imposes one.
   */
  recoveryFromMs?: number;
}

/**
 * Lane E6: why an open hour's latest working fold was refused, as the day
 * report names it. `code` is the refusal's own. A budget refusal carries the
 * budget, its limit and the figure observed, as the 413 answer does; a row
 * conflict carries its stream, and not its id, which names a visitor and would
 * outlive an erasure in a saved report.
 */
export interface OpenHourRefusal {
  at: number;
  error: string;
  code: string;
  budget?: string;
  limit?: number;
  observed?: number;
  conflict?: { stream: 'decision' | 'outcome' };
  step?: string;
}
/** Lane E6: one open hour of a day report (`DayReport.hours.open`). */
export interface OpenHourEntry { hour: number; status: 'current' | 'refused'; through: number | null; refusal?: OpenHourRefusal }

export interface DayReport {
  tenant: string;
  brand: string;
  date: string;
  builtAt: number;
  counts: { decisions: number; outcomes: number; visitors: number; truncated: boolean; duplicates?: DuplicateCounts;
    /** W22 D1.03: rows excluded because two different rows share their logical id and the conflict is filed. */
    conflicts?: DuplicateCounts };
  /**
   * W26 R1.01 (doc 35 §5 W26, "unknown legacy outcomes"): `credits` is what this
   * policy credited; `legacyCredits` is how many of them came from an outcome
   * that named NEITHER a placement nor a decision — the legacy shape the SDK's
   * `unknown` sentinel and every pre-correlation integration still send.
   *
   * Such an outcome is still credited, deliberately and by the declared legacy
   * rule: it is spread over every placement of the item in the window, so one
   * click on a piece in two slots pays two credits. That is a defensible rule
   * and a poor measurement, and the two were indistinguishable on the report —
   * a day of legacy traffic read exactly like a day of named-placement credit.
   * Counting them apart is what lets an operator see how much of the day's
   * evidence is a guess about where the shopper was.
   *
   * OPTIONAL on the type, because retained day reports were written before it
   * existed and are still valid; every report this build produces sets it.
   */
  policies: Array<{ name: string; policy: AttributionPolicy; role: 'learning' | 'reporting'; credits: number; legacyCredits?: number }>;
  /** slot → policy name → the grid the engine would have learned under that policy, from this day alone. */
  grids: Record<string, Record<string, LiftSnapshot>>;
  exploration: ExploreRow[];
  measurement: typeof REPORT_MEASUREMENT;
  /** slot → raw attribution counts under the learning policy. */
  holdout: Record<string, ArmRow[]>;
  /** Empty compatibility collections. These counts cannot support experimental inference. */
  holdoutComparison: Record<string, never[]>;
  /** W21 C1.03: per-arm distinct visitors for the day. Null where the source predates the field. */
  armVisitors?: ArmVisitors | null;
  /** W21 C1.03: the published allocation the day was served under. Absent on a report built before it was recorded. */
  allocation?: ReportAllocation;
  /** W21 E1.04: per-arm enrolled visitors and the outcome types they produced. Null where the source predates the field, or names an hour in `coverage.unassignedHours`. */
  visitorOutcomes?: VisitorOutcomes | null;
  /** The named outcomes (a partner pickup, a retailer referral) by their own names, credited to the decisions that earned them; never a sale. */
  namedOutcomes?: NamedOutcomes | null;
  /** CW28: tombstones pending for the tenant, and the rows this report dropped for them (doc 22 §15). */
  erasures?: { pending: number; rows_hidden: number };
  /** Doc 31 §3: how the day was built. `aggregates`: the sum of the hours in `built`, the closed hours still unfolded in `missing`, the batch ring's reach in `horizonMs`; `ledger`: read straight from the day's records. */
  hours?: { source: 'aggregates' | 'ledger'; built: number[]; missing: number[]; horizonMs?: number;
    /**
     * Lane E6: the open hours — the hour still open, and the hour just closed
     * until its own fold is due — the five-minute job has started a WORKING
     * aggregate for. Absent when there is none, which is every report written
     * before it existed. Each says where it stands:
     *
     *  · `current`: the hour is in `built`, summed from a working fold of
     *    everything the ledger held at `through`, and nothing that fold reads
     *    has changed since. The hour's final fold replaces it.
     *  · `refused`: the hour's latest working fold was refused, and `refusal`
     *    says why — the budget with its limit and the observed figure, or the
     *    row conflict's stream. Where an earlier fold stands the hour is in
     *    `built` from THAT fold and `through` is when it read the ledger: the
     *    hour is stale, and says so. Where none stands `through` is null and
     *    the hour is not in `built`.
     *
     * Either way the day is incomplete by its own account.
     */
    open?: OpenHourEntry[] };
  coverage?: ReportCoverage;
  /** Null/absent means unknown. Equality is not experimental compatibility. */
  computation?: ComputationBasis | null;
  /** W22 A1.01: the one named, versioned attribution contract this day was built under. Absent on a report built before it existed. */
  attributionContract?: AttributionContract;
  /**
   * W25 O1.01 (F20 §5, §10): whether the lift grids in this report were built
   * with the tenant's imported priors, and which revision of them.
   *
   * The live table shrinks a cold item toward its imported prior at the prior's
   * strength; an offline grid built without the document shrinks the same item
   * toward the slot at the configured n₀. Those are two different numbers for
   * the same item, and a data scientist reconciling the report against the table
   * used to have nothing to tell them apart. This member is DERIVED from what
   * the grids were actually built with, so `{ applied: false, priorVersion: 0 }`
   * is a statement about this report's own grids and not a stamp.
   *
   * Optional: a report written before this release does not carry it, and
   * absence means unknown, never "prior-free".
   */
  gridPriors?: { applied: boolean; priorVersion: number };
  /**
   * W33 O3: the policy and version identity that produced this stored day
   * (`DayProvenance`). Set by the canonical writers and the repair; absent on a
   * response-only overlay and on a day written before it existed, which the
   * read answers `null`.
   */
  provenance?: DayProvenance | null;
}

/**
 * W22 A1.01: how far back the DIRECT-RECORD recomputation can credit. It reads
 * one day of decisions and one day of outcomes and attributes the second
 * against the first, so whatever the policy asks for, this path cannot see a
 * decision from the day before: its reach is the day itself.
 */
export const RAW_DAY_REACH_MS = 86_400_000;

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Conservative read projection; independently known legacy warnings always survive. */
export function reportCoverage(report: Pick<DayReport, 'counts' | 'hours' | 'coverage'>, evidence: unknown = report.coverage): ReportCoverage {
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const hour = (v: unknown): v is number => Number.isInteger(v) && Number(v) >= 0 && Number(v) < 24;
  const hours = (v: unknown): v is number[] => Array.isArray(v) && v.length <= 24 && Array.from(v).every(hour) && new Set(v).size === v.length;
  const knownHours = (v: unknown): number[] => Array.isArray(v) ? [...new Set(v.filter(hour))].sort((a, b) => a - b) : [];
  const e = object(evidence) ? evidence : {};
  const source = report.hours?.source === 'aggregates' || report.hours?.source === 'ledger' ? report.hours.source
    : report.hours === undefined && e.version === 1 && e.source === 'ledger' ? 'ledger' : 'unknown';
  const built = knownHours(report.hours?.built), missing = knownHours(report.hours?.missing);
  // Lane E6: an open hour, current or refused, is not final, so a day that
  // names one is incomplete by its own account.
  const open = Array.isArray(report.hours?.open) ? Array.from(report.hours.open as unknown[]).filter(v => hour(v) || (object(v) && hour(v.hour))) : [];
  // W21 C1.08 (R149): optional in the evidence, because a report written before
  // this release cannot carry it and is not thereby invalid. Present, it is a
  // list of built hours or the explicit unknown.
  const assignment = e.unassignedHours === undefined || e.unassignedHours === null
    || (hours(e.unassignedHours) && e.unassignedHours.every(h => knownHours(report.hours?.built).includes(h)));
  // W30 (R149, R177): every member this batch adds is OPTIONAL in the stored
  // evidence — a report written before this release carries none and is still
  // `metadata: 'recorded'` — and, where it is present, it is a list of BUILT
  // hours, in hour order, with exactly the members it is declared with.
  const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
  const perHour = (v: unknown, keys: readonly string[], check: (row: Record<string, unknown>) => boolean): boolean => {
    if (v === undefined) return true;
    if (!Array.isArray(v) || v.length > 24) return false;
    let previous = -1;
    for (let i = 0; i < v.length; i++) {
      const row: unknown = v[i];
      if (!Object.hasOwn(v, i) || !object(row) || Object.keys(row).length !== keys.length + 1
        || !hour(row.hour) || !built.includes(row.hour) || row.hour <= previous
        || !keys.every(key => Object.hasOwn(row, key)) || !check(row)) return false;
      previous = row.hour;
    }
    return true;
  };
  const maturityRows = perHour(e.maturities, ['maturity'], row => row.maturity === 'open' || row.maturity === 'final' || row.maturity === 'repaired');
  const lateRows = perHour(e.lateAfterMaturity, ['objects'], row => count(row.objects));
  const carryRows = perHour(e.carryInHours, ['evicted', 'unplaced'], row => count(row.evicted) && count(row.unplaced));
  const scanRows = perHour(e.objectScan, ['objects', 'read'], row => count(row.objects) && count(row.read) && Number(row.read) <= Number(row.objects));
  const bounds = (e.refoldHorizonMs === undefined || count(e.refoldHorizonMs)) && (e.recoveryFromMs === undefined || count(e.recoveryFromMs));
  const valid = e.version === 1 && e.source === source && source !== 'unknown' && assignment &&
    maturityRows && lateRows && carryRows && scanRows && bounds &&
    typeof e.truncated === 'boolean' && (typeof e.visitorsIncomplete === 'boolean' || e.visitorsIncomplete === null) &&
    hours(e.missingHours) && hours(e.truncatedHours) && hours(e.unadvancedHours) && hours(e.unknownHours) &&
    e.truncatedHours.every(h => built.includes(h)) && e.unadvancedHours.every(h => built.includes(h)) && e.unknownHours.every(h => built.includes(h)) &&
    Array.isArray(e.horizons) && e.horizons.length === built.length && Array.from(e.horizons).every((v: unknown, i: number) =>
      object(v) && v.hour === built[i] && (v.horizonMs === null || (typeof v.horizonMs === 'number' && Number.isFinite(v.horizonMs) && v.horizonMs >= 0))) &&
    ((hours(report.hours?.built) && hours(report.hours?.missing)) || (source === 'ledger' && report.hours === undefined)) && (source !== 'ledger' || built.length === 0);
  const metadata = evidence === undefined || e.metadata === 'absent' ? 'absent' : !valid || e.metadata === 'invalid' ? 'invalid' : 'recorded';
  const truncatedHours = knownHours(e.truncatedHours).filter(h => built.includes(h));
  const unadvancedHours = knownHours(e.unadvancedHours).filter(h => built.includes(h));
  const horizons: ReportCoverage['horizons'] = valid ? (e.horizons as ReportCoverage['horizons']).map(v => ({ ...v })) : built.map(h => ({ hour: h, horizonMs: null }));
  const unknownHours = valid ? knownHours([...(e.unknownHours as number[]), ...horizons.filter(h => h.horizonMs === null).map(h => h.hour)]) : built;
  const missingHours = knownHours([...missing, ...knownHours(e.missingHours)]);
  const visitorsIncomplete = e.visitorsIncomplete === true ? true : valid ? e.visitorsIncomplete as boolean | null : null;
  const truncated = report.counts?.truncated === true || e.truncated === true || truncatedHours.length > 0;
  // W30: the members are echoed only where the source really states them, and a
  // list is copied row by row so nothing the evidence carried beside them rides
  // through. `null`/absent is the honest unknown, never an empty list.
  const copy = <T>(v: unknown, ok: boolean, row: (value: Record<string, unknown>) => T): T[] | undefined =>
    valid && ok && Array.isArray(v) ? (v as Record<string, unknown>[]).map(row) : undefined;
  const maturities = copy(e.maturities, maturityRows, r => ({ hour: r.hour as number, maturity: r.maturity as 'open' | 'final' | 'repaired' }));
  const lateAfterMaturity = copy(e.lateAfterMaturity, lateRows, r => ({ hour: r.hour as number, objects: r.objects as number }));
  const carryInHours = copy(e.carryInHours, carryRows, r => ({ hour: r.hour as number, evicted: r.evicted as number, unplaced: r.unplaced as number }));
  const objectScan = copy(e.objectScan, scanRows, r => ({ hour: r.hour as number, objects: r.objects as number, read: r.read as number }));
  // W30 M1.01/V1.01: a row the day holds but does not include, and a
  // visitor-level outcome it could not place, are both reasons the day is
  // INCOMPLETE — data exists that the numbers do not carry.
  const late = (lateAfterMaturity ?? []).some(row => row.objects > 0);
  const unplaced = (carryInHours ?? []).some(row => row.unplaced > 0);
  return {
    version: 1, source, metadata,
    status: truncated || visitorsIncomplete === true || missingHours.length || unadvancedHours.length || late || unplaced || open.length ? 'incomplete' : 'unknown',
    maturity: 'unknown', truncated, visitorsIncomplete, missingHours, truncatedHours, unadvancedHours, unknownHours, horizons,
    ...(valid && count(e.refoldHorizonMs) ? { refoldHorizonMs: e.refoldHorizonMs } : {}),
    ...(maturities ? { maturities } : {}),
    ...(lateAfterMaturity ? { lateAfterMaturity } : {}),
    ...(carryInHours ? { carryInHours } : {}),
    ...(objectScan ? { objectScan } : {}),
    ...(valid && count(e.recoveryFromMs) ? { recoveryFromMs: e.recoveryFromMs } : {}),
    // Stated only where the source really states it: an absent, unknown or
    // unreadable evidence block reads `null`, never an empty list, which would
    // claim every built hour carries the assignment.
    unassignedHours: valid && Array.isArray(e.unassignedHours) ? knownHours(e.unassignedHours).filter(h => built.includes(h)) : null,
    // Never reinterpret the old hours.horizonMs (the last hour) as a minimum.
    minHorizonMs: valid && metadata === 'recorded' && source === 'aggregates' && horizons.length > 0 && !missingHours.length && !unknownHours.length
      ? Math.min(...horizons.map(h => h.horizonMs!)) : null,
  };
}

/**
 * Withdraw historic inference at read time without rewriting the stored report.
 *
 * W21 C1 with position 8 (ruling R108): a report of ours states no business
 * target at all — not a value, not a standing, not the vocabulary. The per-arm
 * denominators, the published allocation and the visitor-level outcomes below
 * are counts the customer computes their own comparison from; nothing here is
 * read against a target.
 */
export function diagnosticDayReport(report: DayReport): DayReport {
  const holdout = Object.fromEntries(Object.entries(report.holdout ?? {}).map(([slot, rows]) =>
    [slot, rows.map(({ arm, decisions, credited }) => attributionArm(arm, decisions, credited))]));
  const coverage = reportCoverage(report);
  const allocation = validAllocation(report.allocation);
  return {
    tenant: report.tenant, brand: report.brand, date: report.date, builtAt: report.builtAt,
    counts: report.counts, policies: report.policies, grids: report.grids, exploration: report.exploration,
    // W25 O1.01: the declaration belongs to the grids it describes, so it is
    // carried with them, and only when the stored report really carries one.
    ...(validGridPriors(report.gridPriors) ? { gridPriors: validGridPriors(report.gridPriors)! } : {}),
    measurement: REPORT_MEASUREMENT, holdout,
    holdoutComparison: Object.fromEntries(Object.keys(holdout).map((slot) => [slot, []])),
    armVisitors: validArmVisitors(report.armVisitors, 'distinct_visitors'),
    ...(allocation ? { allocation } : {}),
    visitorOutcomes: validVisitorOutcomes(report.visitorOutcomes),
    namedOutcomes: validNamedOutcomes(report.namedOutcomes),
    ...(report.erasures ? { erasures: report.erasures } : {}),
    ...(report.hours ? { hours: report.hours } : {}),
    coverage,
    computation: recordedComputation(report.computation),
    ...(validAttributionContract(report.attributionContract) ? { attributionContract: validAttributionContract(report.attributionContract)! } : {}),
    // W33 O3: always answered — a day that records none is the explicit unknown.
    provenance: validProvenance(report.provenance),
  };
}

/** Presets a data scientist reaches for first (§4.2): the natural reporting overlays. */
export function presetPolicies(learning: AttributionPolicy): ReportPolicy[] {
  // The name comes after the spread: the learning policy may carry its own.
  const base = { scope: learning.scope, match: learning.match, credit: learning.credit, windowsMs: learning.windowsMs };
  return [
    { ...base, name: 'first-touch', credit: 'first' },
    { ...base, name: 'any-item', match: 'any' },
    { ...base, name: 'visitor-scope', scope: 'visitor' },
    { ...base, name: 'purchase-1d', windowsMs: { ...base.windowsMs, purchase: 24 * 60 * 60 * 1000 } },
  ];
}

/** Rings per visitor from the day's decisions, oldest first: what the online object would have held. */
export function ringsOf(decisions: readonly DecisionRecord[]): Map<string, RingEntry[]> {
  const rings = new Map<string, RingEntry[]>();
  for (const d of decisions) {
    const list = rings.get(d.visitor_id) ?? [];
    list.push(ringEntryOf(d));
    rings.set(d.visitor_id, list);
  }
  for (const list of rings.values()) list.sort((a, b) => a.ts - b.ts);
  return rings;
}

/** Physical pin positions are not ranked exploration opportunities. Old receipts retain their basis. */
export function explorationOpportunity(d: DecisionRecord): boolean {
  if (d.inputs?.replay?.pins !== 'prefix-reserved-v2') return d.position === 0;
  if (d.authority === 'pin') {
    if (Object.hasOwn(d, 'ranking_position')) throw new ReportInputError();
    return false;
  }
  const position = d.ranking_position;
  if (!Number.isInteger(position) || position === undefined || position < 0 || position > 49
    || !Number.isInteger(d.position) || position > d.position) throw new ReportInputError();
  return position === 0;
}

const referenceKey = (tenant: string, visitor: string, id: string) => JSON.stringify([tenant, visitor, id]);

export function buildReport(i: ReportInput, conflictingReferences?: ReadonlySet<string>): DayReport {
  if (!Array.isArray(i.decisions) || !Array.isArray(i.outcomes)) throw new ReportInputError();
  bound('work', i.decisions.length + i.outcomes.length);
  const identity = new ReportRowIdentity(i.tenant, i.resolved);
  let decisions = 0, outcomes = 0;
  i = { ...i, decisions: i.decisions.filter(row => { if (!identity.admit(row, 'decision')) return false; bound('records', ++decisions); return true; }),
    outcomes: i.outcomes.filter(row => { if (!identity.admit(row, 'outcome')) return false; bound('records', ++outcomes); return true; }) };
  admitReport(i);
  // Current reports name their configured measurement basis. Historical rows
  // remain untouched; a served receipt is never promoted into a rendered count.
  i = { ...i, decisions: i.decisions.filter(d => (d.measurementBasis ?? 'served-v1') === (i.learn.slots?.[d.slot]?.measurementBasis ?? 'served-v1')) };
  const own = new Set(i.decisions.map(d => d.decision_id));
  const rings = ringsOf([...(i.carry ?? []).filter(c => !own.has(c.decision_id)), ...i.decisions]);
  // Identity admission has already refused conflicting primary IDs.
  const decisionsById = new Map<string, DecisionRecord>();
  for (const d of i.decisions) if (!decisionsById.has(d.decision_id)) decisionsById.set(d.decision_id, d);
  const slotCfg = slotConfigsOf(i.learn);
  const statsCfg: StatsConfig = i.learn.stats ?? DEFAULT_STATS;
  const exposures = new Map<string, ReturnType<typeof emptyStats>>();
  const slotCounts = new Map<string, { arms: Map<string, number>; decisions: number; explored: number }>();
  // W21 C1.03/E1.04: the day's DENOMINATORS, per arm, in visitors. Kept beside
  // the decision counts rather than derived from them: the two differ by the
  // decisions each visitor was served, which is exactly the quantity the design
  // effect needs and the quantity decisions alone cannot supply (F25 §5.3).
  const armVisitorIds = new Map<string, Set<string>>();
  // W21 E1.04 (R118(4)): each visitor's assignments IN TIME, so an outcome can be
  // attributed to the one in force when it happened instead of to every arm she
  // appeared on that day — a consent transition would otherwise put one
  // purchase into both the ineligible and the randomised control rows.
  const visitorTimeline = new Map<string, Array<{ ts: number; assignment: string }>>();
  // W21 E1.02 (R108): the arms of a report are the experimental ASSIGNMENTS,
  // where the record carries one — so a shopper who was never drawn appears as
  // `ineligible` and is never pooled into the randomised control. A record
  // written before the provenance block existed is read by its served arm
  // exactly as before and is never re-interpreted.
  const assignmentOf = (d: DecisionRecord): string => d.experiment?.arm ?? d.arm;
  const assignmentById = new Map<string, string>();
  for (const d of i.decisions) {
    const assignment = assignmentOf(d);
    if (d.experiment?.arm !== undefined && !assignmentById.has(d.decision_id)) assignmentById.set(d.decision_id, assignment);
    const counts = slotCounts.get(d.slot) ?? { arms: new Map<string, number>(), decisions: 0, explored: 0 };
    counts.arms.set(assignment, (counts.arms.get(assignment) ?? 0) + 1);
    if (explorationOpportunity(d) && d.arm !== 'default') { counts.decisions++; if (d.explored) counts.explored++; }
    slotCounts.set(d.slot, counts);
    const enrolled = armVisitorIds.get(assignment) ?? new Set<string>();
    enrolled.add(d.visitor_id); armVisitorIds.set(assignment, enrolled);
    const timeline = visitorTimeline.get(d.visitor_id) ?? [];
    timeline.push({ ts: d.ts, assignment }); visitorTimeline.set(d.visitor_id, timeline);
    if (d.arm === 'personalized') {
      const st = exposures.get(d.slot) ?? emptyStats();
      recordExposure(st, d.item_id, d.cell, d.rendered?.at ?? d.ts, statsCfg); exposures.set(d.slot, st);
    }
  }
  const slots = [...slotCounts.keys()].sort();
  const policies: DayReport['policies'] = [];
  const grids: DayReport['grids'] = {};
  /** W25 O1.01: prior-free until a grid below is actually built with a prior. */
  let gridPriors: { applied: boolean; priorVersion: number } = { applied: false, priorVersion: 0 };
  const holdout: DayReport['holdout'] = {};
  const holdoutComparison: DayReport['holdoutComparison'] = {};

  const all: Array<{ p: ReportPolicy; role: 'learning' | 'reporting' }> = [{ p: i.learning, role: 'learning' }, ...i.reporting.map((p) => ({ p, role: 'reporting' as const }))];
  for (const { p, role } of all) {
    // Exposures: the personalized arm's decisions only, as the fan-in records them (§10: holdout traffic
    // never feeds the statistics; the arms are compared from the ledger below).
    const states = new Map([...exposures].map(([slot, state]) => [slot, structuredClone(state)]));
    const stateOf = (slot: string) => { let s = states.get(slot); if (!s) { s = emptyStats(); states.set(slot, s); } return s; };
    // Credits under this policy, from every outcome against its visitor's ring.
    let credits = 0;
    // W26 R1.01: of those credits, the ones an outcome bought without naming
    // where the shopper was — no placement and no decision reference — so the
    // report can say how much of the day rests on the legacy spread rule.
    let legacyCredits = 0;
    const armCredits = new Map<string, number>();
    for (const o of i.outcomes) {
      if (Object.hasOwn(o, 'decision_id') && conflictingReferences?.has(referenceKey(o.tenant, o.visitor_id, o.decision_id!))) continue;
      const whole = rings.get(o.visitor_id);
      if (!whole) continue;
      const ring = ringAtHour(whole, o.ts);
      const legacy = !Object.hasOwn(o, 'decision_id') && namedSlotOf(o.slot) === null;
      for (const c of attribute(o, ring, p)) {
        const reward = slotCfg[c.slot]?.reward ?? 'click';
        const success = successCreditOf(ring.find(d => d.id === c.decision_id)?.successEvent, { reward, objective: slotCfg[c.slot]?.objective }, o);
        if (success === null || 'refused' in success) continue;  // P103: the one credit rule, the record's own policy
        credits += 1;
        if (legacy) legacyCredits += 1;
        // Explicit selection already proved one subject-owned target. Only
        // absent-ID legacy attribution retains the global first-match lookup.
        // The subject-scoped lookup is unchanged; only the LABEL it resolves to
        // is the assignment, and only when that same decision carried one.
        const resolved = Object.hasOwn(o, 'decision_id') ? ring.find(d => d.id === c.decision_id)?.arm
          : decisionsById.get(c.decision_id)?.arm;
        const arm = (resolved === undefined ? undefined : assignmentById.get(c.decision_id)) ?? resolved ?? 'personalized';
        armCredits.set(`${c.slot}|${arm}`, (armCredits.get(`${c.slot}|${arm}`) ?? 0) + 1);
        if (arm === 'personalized') { const w = success.weight; if (w > 0) recordSuccess(stateOf(c.slot), c.item, c.cell, success.reward, c.ts, w, statsCfg); }
      }
    }
    policies.push({ name: p.name, policy: { scope: p.scope, match: p.match, credit: p.credit, windowsMs: p.windowsMs }, role, credits, legacyCredits });
    for (const slot of slots) {
      const st = states.get(slot) ?? emptyStats();
      // W25 O1.01: the declaration below is derived here, from the index this
      // grid was really handed, so it cannot say one thing while the grid holds
      // another.
      const index = priorsForSlot(i.priors, slot);
      if (index) gridPriors = { applied: true, priorVersion: i.priors!.version };
      (grids[slot] ??= {})[p.name] = buildSnapshot(st, { tenant: i.tenant, brand: i.brand, slot }, slotCfg[slot]?.reward ?? 'click', i.now, statsCfg,
        index ? { version: i.priors!.version, index } : null, slotCfg[slot]?.objective ?? 'unit', slotCfg[slot]?.measurementBasis ?? 'served-v1');
    }
    // §10: the arms, under the learning policy only.
    if (role === 'learning') {
      for (const slot of slots) {
        const counts = slotCounts.get(slot)!;
        const arms = [...counts.arms.keys()].sort();
        holdout[slot] = arms.map((arm) => {
          const decisions = counts.arms.get(arm)!;
          const credited = armCredits.get(`${slot}|${arm}`) ?? 0;
          return attributionArm(arm, decisions, credited);
        });
        holdoutComparison[slot] = [];
      }
    }
  }

  // §7: what explored, against the configured share.
  const exploration: ExploreRow[] = slots.map((slot) => {
    const { decisions, explored } = slotCounts.get(slot)!;
    const cfg = i.learn.slots?.[slot]?.exploration ?? null;
    return { slot, decisions, explored, realized: decisions ? r3(explored / decisions) : 0, ...effectiveExploration(cfg) };
  });

  // W21 E1.04: outcomes by the arm the VISITOR is enrolled in, never by whether
  // a served piece matched the outcome. A visitor served on two arms in one day
  // counts once under each; under persistent enrollment there is only one.
  for (const timeline of visitorTimeline.values()) timeline.sort((a, b) => a.ts - b.ts);
  /** The assignment in force at `ts`: her last decision at or before it, else her first of the day. */
  const assignmentAt = (visitor: string, ts: number): string | null => {
    const timeline = visitorTimeline.get(visitor);
    if (!timeline?.length) return null;
    let held: string | null = null;
    for (const entry of timeline) { if (entry.ts > ts) break; held = entry.assignment; }
    return held ?? timeline[0]!.assignment;
  };
  const outcomeVisitors = new Map<string, Map<string, Set<string>>>();
  for (const o of i.outcomes) {
    const arm = assignmentAt(o.visitor_id, o.ts);
    if (arm === null) continue;
    const byType = outcomeVisitors.get(arm) ?? new Map<string, Set<string>>();
    const visitors = byType.get(o.type) ?? new Set<string>();
    visitors.add(o.visitor_id); byType.set(o.type, visitors); outcomeVisitors.set(arm, byType);
  }
  // The named outcomes, each under its own name, credited to the decisions the
  // learning policy pays — the same attribution the holdout rows above count,
  // without the slot's own reward filter, because a named outcome is counted
  // where it was earned whatever the slot learns from.
  const namedOutcomes = emptyNamedOutcomes();
  for (const o of i.outcomes) {
    const row = namedOutcomeRow(namedOutcomes, o);
    if (!row) continue;
    row.outcomes += 1;
    if (Object.hasOwn(o, 'decision_id') && conflictingReferences?.has(referenceKey(o.tenant, o.visitor_id, o.decision_id!))) continue;
    const ring = rings.get(o.visitor_id);
    if (!ring) continue;
    for (const c of attribute(o, ring, i.learning)) creditNamedOutcome(row, c.slot, c.item);
  }
  const armNames = [...armVisitorIds.keys()].sort((a, b) => a.localeCompare(b));
  const armVisitors: ArmVisitors = { version: 1, basis: 'distinct_visitors',
    arms: armNames.map(arm => ({ arm, visitors: armVisitorIds.get(arm)!.size })) };
  const visitorOutcomes: VisitorOutcomes = { version: 1, basis: 'enrolled_visitors',
    arms: armNames.map(arm => ({ arm, visitors: armVisitorIds.get(arm)!.size,
      byType: Object.fromEntries([...(outcomeVisitors.get(arm) ?? new Map<string, Set<string>>())]
        .sort(([a], [b]) => a.localeCompare(b)).map(([type, visitors]) => [type, visitors.size] as const)) })) };

  const report: DayReport = {
    tenant: i.tenant, brand: i.brand, date: i.date, builtAt: i.now,
    counts: { decisions: i.decisions.length, outcomes: i.outcomes.length, visitors: rings.size, truncated: i.truncated },
    policies, grids, gridPriors, exploration, measurement: REPORT_MEASUREMENT, holdout, holdoutComparison,
    armVisitors, visitorOutcomes, namedOutcomes, allocation: publishedAllocation(i.learn),
    computation: new Set(policies.map(p => p.name)).size === policies.length
      ? computationBasis(i.learn, policies, slots, { source: 'raw-day', horizonMs: null, ringCap: null }) : null,
    // W22 A1.01: what the tenant's published policy asks for, and the one day
    // this path could actually read it over.
    attributionContract: attributionContractOf(i.learn, RAW_DAY_REACH_MS),
    coverage: reportCoverage({ counts: { decisions: i.decisions.length, outcomes: i.outcomes.length, visitors: rings.size, truncated: i.truncated }, hours: { source: 'ledger', built: [], missing: [] } }, {
      version: 1, source: 'ledger', truncated: i.truncated, visitorsIncomplete: null,
      // W21 C1.08: this branch reads the records themselves, so every row it
      // counted carries whatever assignment it was written with; there is no
      // built hour that cannot say.
      unassignedHours: [],
      missingHours: [], truncatedHours: [], unadvancedHours: [], unknownHours: [], horizons: [],
    }),
  };
  const duplicates = identity.duplicates();
  if (duplicates.length) report.counts.duplicates = { decisions: duplicates.filter(d => d.stream === 'decision' && d.brand === i.brand).reduce((n, d) => n + d.count, 0),
    outcomes: duplicates.filter(d => d.stream === 'outcome' && d.brand === i.brand).reduce((n, d) => n + d.count, 0) };
  rawReportJson(report);
  return report;
}

interface RawReadBudget { objects: number; bytes: number; keys?: Record<'decision' | 'outcome', string[]> }
async function rawKeys(r2: R2Like, prefix: string, budget: RawReadBudget): Promise<Record<'decision' | 'outcome', string[]>> {
  const keys = { decision: [] as string[], outcome: [] as string[] }, cursors = new Set<string>();
  let cursor: string | undefined, visited = 0;
  do {
    bound('work', ++visited);
    const page = await r2.list({ prefix, cursor, limit: 1000 });
    for (const o of page.objects) {
      bound('work', ++visited);
      if (isProductSortKey(o.key)) continue;
      const decision = o.key.includes('/decision/'), outcome = o.key.includes('/outcome/');
      if (!decision && !outcome) continue;
      if (++budget.objects > REPORT_LIMITS.objects) throw new ReportTooLarge(budget.objects, REPORT_LIMITS.objects);
      if (decision) keys.decision.push(o.key); if (outcome) keys.outcome.push(o.key);
    }
    if (page.truncated && (!page.cursor || cursors.has(page.cursor))) throw new ReportInputError();
    cursor = page.truncated ? page.cursor : undefined; if (cursor) cursors.add(cursor);
  } while (cursor);
  keys.decision.sort(); keys.outcome.sort(); budget.keys = keys; return keys;
}
export async function rawText(obj: NonNullable<Awaited<ReturnType<R2Like['get']>>>, budget: RawReadBudget): Promise<string> {
  return boundedLedgerText(obj, budget, bound, () => new ReportInputError());
}

/** General callers retain explicit truncation; raw reports supply one shared strict budget. */
export async function loadDay<T>(r2: R2Like, tenant: string, date: string, stream: 'decision' | 'outcome', cap: number, strict?: RawReadBudget, resolved?: ResolvedConflicts, brand?: string): Promise<{ records: T[]; truncated: boolean; duplicates?: DuplicateWitness[]; conflicts?: DuplicateCounts }> {
  const prefix = `${tenant}/${date}/`;
  const keys: string[] = strict ? (strict.keys ?? await rawKeys(r2, prefix, strict))[stream] : [];
  let cursor: string | undefined;
  if (!strict) {
    do {
      const page = await r2.list({ prefix, cursor, limit: 1000 });
      for (const o of page.objects) if (!isProductSortKey(o.key) && o.key.includes(`/${stream}/`)) keys.push(o.key);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    keys.sort();
  }
  const records: T[] = [], identity = new ReportRowIdentity(tenant, resolved, brand);
  let truncated = false, lines = 0;
  for (const key of keys) {
    const obj = await r2.get(key);
    if (!obj) { if (strict) throw new ReportUnavailableError(); else continue; }
    const text = strict ? await rawText(obj, strict) : await obj.text();
    // Scan one record at a time; do not allocate a full split array before the row guard.
    let offset = 0;
    while (offset < text.length) {
      bound('work', ++lines);
      const end = text.indexOf('\n', offset), line = text.slice(offset, end < 0 ? text.length : end); offset = end < 0 ? text.length : end + 1;
      if (!line) continue;
      let row: unknown;
      try { row = JSON.parse(line); } catch { if (strict) throw new ReportInputError(); else continue; }
      if (!identity.admit(row, stream)) continue;
      if (records.length >= cap) {
        if (strict) throw new ReportBudgetExceeded('records', cap, records.length + 1);
        truncated = true; break;
      }
      records.push(row as T);
    }
    if (truncated) break;
  }
  const duplicates = identity.duplicates(), conflicts = identity.conflicts();
  return { records, truncated, ...(duplicates.length ? { duplicates } : {}),
    ...(conflicts.decisions || conflicts.outcomes ? { conflicts } : {}) };
}

export const reportKey = (tenant: string, brand: string, date: string) => `reports/${tenant}/${brand}/${date}.json`;
export const reportPrefix = (tenant: string) => `reports/${tenant}/`;
export const REPORT_CAP = REPORT_LIMITS.records;
/** A Worker may open only so many storage objects in one request; past this many ledger objects a day is built by the nightly job, not on demand. */
export const REPORT_MAX_OBJECTS = REPORT_LIMITS.objects;

/** How many ledger objects a day holds, both streams, without opening any. */
export async function countDayObjects(r2: R2Like, tenant: string, date: string, stopAfter = Infinity): Promise<number> {
  let n = 0, cursor: string | undefined, visited = 0;
  const cursors = new Set<string>();
  do {
    if (Number.isFinite(stopAfter)) bound('work', ++visited);
    const page = await r2.list({ prefix: `${tenant}/${date}/`, cursor, limit: 1000 });
    for (const object of page.objects) {
      if (Number.isFinite(stopAfter)) bound('work', ++visited);
      if (isLearningKey(object.key) && ++n > stopAfter) return n;
    }
    if (Number.isFinite(stopAfter) && page.truncated && (!page.cursor || cursors.has(page.cursor))) throw new ReportInputError();
    cursor = page.truncated ? page.cursor : undefined;
    if (Number.isFinite(stopAfter) && cursor) cursors.add(cursor);
  } while (cursor);
  return n;
}

/**
 * W22 R1.05 (document 35 §5 row W22, "durable online/R2/fold/export
 * reconciliation"; F16 §4.4): what the day's export partition actually holds,
 * beside what the platform published for the same day.
 *
 * `rows` is the physical count a warehouse job would load if it read every
 * listed object line by line. `distinct` applies exactly the reader's own
 * dedup — `ReportRowIdentity`, the same admission `loadDay` uses — and then the
 * erasures the listing already tells the consumer to apply, so it is the number
 * the report counted from the same objects. `report` is the day report the
 * platform published for this brand. `agrees` is false whenever the two cannot
 * be shown to match, including when the read stopped short: it never claims an
 * agreement it did not observe.
 *
 * W22 R1.06: every one of those counts is scoped to `ids.brand`, the same
 * selector the report route takes, because `report` is one brand's saved day.
 * A tenant's objects hold every brand it serves, so counting all of them
 * against one brand's report made `agrees` structurally false for any
 * multi-brand tenant and told an operator reading a healthy day that the export
 * disagreed. Admission is NOT scoped: every row of the day is still validated
 * and deduplicated exactly as before, and only the counters are the brand's.
 *
 * It opens no object the listing did not already name and lists nothing a
 * second time: the caller passes the keys it has just listed, and the report is
 * a point read of its own key. The comparison is over the ledger's own logical
 * ids, which every exported row already carries; nothing here re-derives a
 * record's provenance.
 */
export interface ExportReconciliation {
  rows: { decisions: number; outcomes: number };
  distinct: { decisions: number; outcomes: number };
  report: { decisions: number; outcomes: number };
  agrees: boolean;
}

export async function exportReconciliation(
  r2: R2Like, ids: { tenant: string; brand: string; date: string }, keys: readonly string[],
  tombs: ReadonlyMap<string, Pick<import('@/ledger/erasure').Tombstone, 'erased_at'>>,
): Promise<ExportReconciliation | null> {
  try {
    validateReportIds(ids);
    const identity = new ReportRowIdentity(ids.tenant, undefined, ids.brand);
    const rows = { decisions: 0, outcomes: 0 };
    const distinct = { decisions: 0, outcomes: 0 };
    const budget: RawReadBudget = { objects: 0, bytes: 0 };
    let lines = 0;
    for (const key of [...keys].sort()) {
      const stream: 'decision' | 'outcome' | null = key.includes('/decision/') ? 'decision' : key.includes('/outcome/') ? 'outcome' : null;
      if (!stream || isProductSortKey(key)) continue;
      if (++budget.objects > REPORT_LIMITS.objects) throw new ReportTooLarge(budget.objects, REPORT_LIMITS.objects);
      const obj = await r2.get(key);
      if (!obj) continue;                 // the listing raced a delete; it holds nothing now
      const text = await rawText(obj, budget);
      const field = stream === 'decision' ? 'decisions' : 'outcomes';
      let offset = 0;
      while (offset < text.length) {
        bound('work', ++lines);
        const end = text.indexOf('\n', offset), line = text.slice(offset, end < 0 ? text.length : end);
        offset = end < 0 ? text.length : end + 1;
        if (!line) continue;
        const row: unknown = JSON.parse(line);
        // Admitted first, so a row of any brand is validated and deduplicated
        // exactly as it was; counted second, and only for the brand asked for.
        const admitted = identity.admit(row, stream);
        if ((row as { brand?: unknown }).brand !== ids.brand) continue;
        rows[field]++;
        if (!admitted) continue;
        bound('records', distinct[field] + 1);
        if (!hidden(tombs, row as { visitor_id: string; ts: number })) distinct[field]++;
      }
    }
    const saved = await readWindowSummary(r2 as unknown as SavedReportReader, ids, { bytes: 0, cells: 0 });
    const published = !!saved?.counts;
    const report = { decisions: finite(saved?.counts?.decisions) ? saved!.counts.decisions : 0,
      outcomes: finite(saved?.counts?.outcomes) ? saved!.counts.outcomes : 0 };
    const agrees = published && distinct.decisions === report.decisions && distinct.outcomes === report.outcomes;
    return { rows, distinct, report, agrees };
  } catch { return null; }
}

export async function runReport(
  r2: R2Like & { put(key: string, body: string, opts?: unknown): Promise<unknown> },
  ids: { tenant: string; brand: string; date: string },
  learn: LearnConfig,
  reporting: ReportPolicy[] | null,
  now = Date.now(),
  retentionEnv?: RetentionEnv,
  resolved?: ResolvedConflicts,
  /**
   * W25 R4: the tenant's published prior document (`reportPriors`), so a day
   * built from the ledger records builds its grids the way the live table does
   * and its `gridPriors` declares the revision it applied. Absent, the grids are
   * built prior-free and the report declares that instead.
   */
  priors?: ReportPriors | null,
  /**
   * W33 O2: the canonical day object the caller noted before it read any source
   * (`runDayReport` notes once, before it lists the hour aggregates, and hands
   * the note here when the day falls back to the ledger). Absent, a canonical
   * build notes it itself, before it reads the ledger.
   */
  note?: CanonicalNote,
): Promise<DayReport> {
  return ledgerReport(r2, ids, learn, reporting, now, retentionEnv, resolved, priors, reporting === null, note);
}

/**
 * W33 O4: the canonical day from the ledger exactly as `runReport(…, null, …)`
 * computes it — the learning policy and the preset overlays, prior-free as the
 * nightly job builds it — WITHOUT writing it, so the repair can make its own
 * write conditional on the affected day it read.
 */
export async function rebuildLedgerDay(r2: R2Like & { put(key: string, body: string, opts?: unknown): Promise<unknown> },
  ids: { tenant: string; brand: string; date: string }, learn: LearnConfig, now: number, retentionEnv?: RetentionEnv): Promise<DayReport> {
  return ledgerReport(r2, ids, learn, null, now, retentionEnv, undefined, null, false);
}

async function ledgerReport(
  r2: R2Like & { put(key: string, body: string, opts?: unknown): Promise<unknown> },
  ids: { tenant: string; brand: string; date: string }, learn: LearnConfig, reporting: ReportPolicy[] | null, now: number,
  retentionEnv: RetentionEnv | undefined, resolved: ResolvedConflicts | undefined, priors: ReportPriors | null | undefined, persist: boolean,
  note?: CanonicalNote,
): Promise<DayReport> {
  const learning: ReportPolicy = { name: 'learning', ...policyOf(learn) };
  const overlays = reporting ?? presetPolicies(learning);
  bound('policies', overlays.length + 1); validateReportPolicies([learning, ...overlays]);
  const budget: RawReadBudget = { objects: 0, bytes: 0 };
  // W33 O2: a canonical build notes the day object before it reads the ledger.
  const noted = reporting === null && persist ? note ?? await noteCanonicalDay(r2 as unknown as Parameters<typeof noteCanonicalDay>[0], ids) : undefined;
  // Sequential reads share limits and stop before later streams/erasure reads on refusal.
  // W22 D1.05: the day is read for ONE brand, and the reader is told which, so
  // a conflict in another brand of the same tenant neither refuses this brand's
  // day nor is counted on it.
  const d = await loadDay<DecisionRecord>(r2, ids.tenant, ids.date, 'decision', REPORT_CAP, budget, resolved, ids.brand);
  const o = await loadDay<OutcomeRecord>(r2, ids.tenant, ids.date, 'outcome', REPORT_CAP, budget, resolved, ids.brand);
  const tombs = await loadTombstones(r2, ids.tenant);
  const before = new Date(Date.parse(ids.date + 'T00:00:00Z') - 86_400_000).toISOString().slice(0, 10);
  const carried = withoutErased((await loadDay<DecisionRecord>(r2, ids.tenant, before, 'decision', REPORT_CAP)).records.filter(x => x.brand === ids.brand), tombs);
  // CW28: an erased visitor's rows are dropped here at once; the nightly rewrite removes them from the objects.
  const dBrand = d.records.filter((x) => x.brand === ids.brand), oBrand = o.records.filter((x) => x.brand === ids.brand);
  const decisions = withoutErased(dBrand, tombs), outcomes = withoutErased(oBrand, tombs);
  if (retentionEnv) for (const row of [...decisions, ...outcomes]) requireRetention(retentionEnv, row.retention?.ledger, ids.tenant, 'ledger');
  // Brand filtering must not hide an ambiguous explicit target in the already
  // loaded subject history. This only withholds credit; report counts stay scoped.
  const seen = new Set<string>(), conflicts = new Set<string>();
  if (outcomes.some(row => Object.hasOwn(row, 'decision_id'))) {
    for (const row of withoutErased(d.records, tombs)) {
      const key = referenceKey(row.tenant, row.visitor_id, row.decision_id);
      if (seen.has(key)) conflicts.add(key); else seen.add(key);
    }
  }
  const report = buildReport({
    ...ids, learning, reporting: overlays, learn,
    decisions, outcomes, carry: carried, ...(resolved ? { resolved } : {}), ...(priors ? { priors } : {}),
    now, truncated: d.truncated || o.truncated,
  }, conflicts);
  report.erasures = { pending: tombs.size, rows_hidden: dBrand.length + oBrand.length - decisions.length - outcomes.length };
  const duplicates = [...(d.duplicates ?? []), ...(o.duplicates ?? [])].filter(row => row.brand === ids.brand && !hidden(tombs, row));
  if (duplicates.length) report.counts.duplicates = { decisions: duplicates.filter(row => row.stream === 'decision').reduce((n, row) => n + row.count, 0),
    outcomes: duplicates.filter(row => row.stream === 'outcome').reduce((n, row) => n + row.count, 0) };
  // W22 D1.03: the rows this day excluded because their conflict is filed,
  // counted in the same vocabulary as the duplicates beside them.
  const excluded = { decisions: (d.conflicts?.decisions ?? 0), outcomes: (o.conflicts?.outcomes ?? 0) };
  if (excluded.decisions || excluded.outcomes) report.counts.conflicts = excluded;
  report.hours = { source: 'ledger', built: [], missing: [] };
  // Explicit overlays (even [] or the preset list) are response-only. They must not
  // replace the canonical aggregate/raw report subsequently read by GET/window.
  if (reporting === null) {
    // W33 O3: the canonical day records the policy set that produced it.
    report.provenance = dayProvenance(report, 'canonical');
    const body = canonicalReportJson(report);
    if (retentionEnv) for (const row of [...decisions, ...outcomes]) requireRetention(retentionEnv, row.retention?.ledger, ids.tenant, 'ledger');
    // W33 O2: conditional on the object noted before the ledger was read, so a
    // canonical day stored while this one was reading it is never replaced; a
    // refused write leaves the response carrying a day that is not stored.
    if (persist && noted) try { await writeCanonicalDay(r2, ids, body, noted); } catch { /* the response still carries it */ }
  } else rawReportJson(report);
  if (retentionEnv) for (const row of [...decisions, ...outcomes]) requireRetention(retentionEnv, row.retention?.ledger, ids.tenant, 'ledger');
  return report;
}

export { DEFAULT_POLICY };
