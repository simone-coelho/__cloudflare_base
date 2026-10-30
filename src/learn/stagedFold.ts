// src/learn/stagedFold.ts — P104 (E29): the learning report's fold in fixed-size steps, each a message on the
// existing events queue: a plan (the five-minute run, or the close of the hour before), partition pages, leaves of
// visitors that split as they grow, a merge tree, and a close committed by two conditional writes. Every step holds
// a bounded input (STEP) whatever the traffic; a step past its bound is refused by name (fold_step_bound), and a
// closed hour so refused is stored where the day reads it. The per-shard code of the one-request fold runs unchanged
// in each leaf (cleanupShard, foldableRows, hourBrands, foldShard, countMembership) and in the close (closeBrands);
// a merge combines its partials' statistics with mergeStats and never replays rows. The open hour, the
// custom-policy day past one page (a job, read by its policy digest) and the W24 rebuild take the same steps.
import type { DecisionRecord, LearnConfig } from '@/content/types';
import { foldRetainedDay, type SlotLearnConfig } from './fan';
import type { AttributionPolicy } from './policy';
import type { StatsState } from './stats';
import { createHash } from 'node:crypto';
import type { Env } from '@/types/env';
import { loadTombstones, type Tombstone } from '@/ledger/erasure';
import { logicalIdentity, LOGICAL_EXCLUDED_FIELDS, preferredCopy } from '@/ledger/delivery';
import { isLearningKey, type OutcomeRecord } from '@/ledger/records';
import { requireRetention, type RetentionEnv, type RetentionStamp } from '@/retention';
import { slotConfigsOf } from './route';
import { DEFAULT_STATS, emptyStats, type StatsConfig } from './stats';
import { ReportInputError, ReportRowConflict, rowShapeOf, type DuplicateWitness } from './report';
import {
  buildHour, cleanupHourlyState, closedHours, compactOf, foldShard, hourKey, HOUR_MS, mergeStats, openHours, openKey, openStateKey,
  policiesOf, refusedHourKey, shardKey, SHARDS, RING_CAP, DEFAULT_HORIZON_MS, stagedInternals as I,
  type CompactDecision, type FoldContext, type HourAggregate, type HourBrand, type R2Agg, type ShardState,
} from './hourly';

const MiB = 1024 * 1024;
/**
 * Each step's fixed inputs (the work order's RF1): a partition page at most 16 MiB and 200 ledger objects; a leaf at
 * most 8 MiB of state and 8 MiB of rows; a merge at most 64 partials; abandoned outputs collected after 15 minutes.
 */
export const STEP = { pageBytes: 16 * MiB, pageObjects: 200, leafStateBytes: 8 * MiB, leafRowBytes: 8 * MiB, fanIn: 64, graceMs: 15 * 60_000 } as const;
export class FoldStepBound extends Error {
  readonly code = 'fold_step_bound';
  constructor(readonly step: 'partition' | 'leaf' | 'merge' | 'close' | 'day', readonly limit: number, readonly observed: number) { super('fold step past its bound'); }
}
export interface FoldMessage { kind: 'fold'; v: 1; tenant: string; gen: string; step: 'partition' | 'leaves' | 'leaf' | 'merge' | 'close'; page?: number; leaf?: string; level?: number; group?: number }
export const isFoldMessage = (b: unknown): b is FoldMessage => !!b && typeof b === 'object' && (b as { kind?: unknown }).kind === 'fold';
type Send = (messages: FoldMessage[]) => Promise<void>;
/** The steps sent on the events queue, at most 100 messages a sendBatch as the platform allows. */
export const queueSend = (env: Pick<Env, 'EVENT_QUEUE'>): Send => async messages => {
  for (let i = 0; i < messages.length; i += 100) await env.EVENT_QUEUE.sendBatch(messages.slice(i, i + 100).map(body => ({ body, contentType: 'json' as const })));
};

const foldPrefix = (t: string) => `aggregates/${t}/fold/`;
const headKey = (t: string) => `${foldPrefix(t)}head.json`;
const genPrefix = (t: string, gen: string) => `${foldPrefix(t)}g/${gen}/`;
const pad2 = (n: number) => String(n).padStart(2, '0');

interface Inflight { gen: string; date: string; hour: number }
interface Head { version: 1; seq: number; leaves: Record<string, string | null>; inflight: Inflight | null; open: Inflight | null; refused?: Record<string, string> }
interface Plan {
  version: 1; tenant: string; gen: string; date: string; hour: number; open: boolean; now: number; refold: boolean; aggregateEtag: string | null;
  objects: Array<{ key: string; etag: string | null; size: number }>; pages: Array<[number, number]>; leaves: Record<string, string | null>;
  learn: LearnConfig; basis: string;
  /**
   * R-P660: the depth the hour's rows are partitioned at — deep enough that a leaf's share of the hour's ledger stays
   * within 6 MiB (of its 8 MiB of rows); a leaf above it is split for the hour, its children reading its state filtered.
   */
  rowDepth?: number;
  /** The W24 rebuild of one slot from one retained day, on the same steps. */
  rebuild?: RebuildJob;
  /** R-P615: an hour of a custom-policy day job (its state record, the policies it folds under). */
  job?: { key: string; policies: Array<ReturnType<typeof policiesOf>[number]> };
}
export interface RebuildJob { tenant: string; brand: string; slot: string; page?: string; date: string; before: string; at: number; operationId: string; config: SlotLearnConfig; policy: AttributionPolicy; name: string }
interface Entry { p: [number, number]; s: 'd' | 'o'; id: string; g: string; l: boolean; c?: CompactDecision; o?: OutcomeRecord; r?: DecisionRecord }
/**
 * What a leaf hands to the merge, and a merge to the next: the hour's brands (statistics summed with mergeStats, so a
 * merge holds at most 64 partials and never the hour's rows or an update log; R-P660), and what the close needs.
 */
interface HourPartial {
  brands: Record<string, HourBrand>; unaccounted: string[]; stranded: Record<string, number[]>; credited: Record<string, string[]>;
  ringsFolded: boolean; recoveryFrom: number; states: Record<string, string | null>; leaves: number;
}

const utf8 = new TextEncoder();
const bytesOf = (s: string) => utf8.encode(s).length;
async function digest(text: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(text))), b => b.toString(16).padStart(2, '0')).join('');
}
function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map(k => [k, (v as Record<string, unknown>)[k]])) : v));
}
async function logicalDigest(row: Record<string, unknown>): Promise<string> {
  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) if (!LOGICAL_EXCLUDED_FIELDS.includes(k)) copy[k] = v;
  return createHash('sha256').update(stable(copy)).digest('hex');
}

// ── leaves: residue classes of today's visitor hash, extendible ────────────────
export const leafId = (depth: number, residue: number) => `${depth}.${residue}`;
const parseLeaf = (id: string) => { const [d, r] = id.split('.').map(Number); return { depth: d!, residue: r! }; };
const hashOf = (visitor: string): number => fnv(visitor);
function fnv(visitor: string): number { let h = 0x811c9dc5; for (let i = 0; i < visitor.length; i++) { h ^= visitor.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h; }
export function leafOf(leaves: Record<string, string | null>, visitor: string): string {
  const h = hashOf(visitor);
  for (let depth = 0; depth < 24; depth++) { const id = leafId(depth, h % (SHARDS * 2 ** depth)); if (Object.hasOwn(leaves, id)) return id; }
  return leafId(0, h % SHARDS);
}

// ── storage helpers ────────────────────────────────────────────────────────────
async function readJson<T>(r2: R2Agg, key: string): Promise<{ value: T; etag: string } | null> {
  const got = await r2.get(key) as { text(): Promise<string>; etag: string } | null;
  if (!got) return null;
  return { value: JSON.parse(await got.text()) as T, etag: got.etag };
}
async function readRange(r2: R2Agg, key: string, offset: number, length: number): Promise<string> {
  const got = await (r2 as unknown as { get(k: string, o: unknown): Promise<{ text(): Promise<string> } | null> }).get(key, { range: { offset, length } });
  if (!got) throw new ReportInputError();
  return got.text();
}
async function listAll(r2: R2Agg, prefix: string): Promise<Array<{ key: string; size?: number; etag?: string; uploaded?: Date }>> {
  const out: Array<{ key: string; size?: number; etag?: string; uploaded?: Date }> = []; let cursor: string | undefined;
  do {
    const page = await r2.list({ prefix, cursor, limit: 1000 }) as { objects: Array<{ key: string; size?: number; etag?: string; uploaded?: Date }>; truncated: boolean; cursor?: string };
    out.push(...page.objects); cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}
const put = (r2: R2Agg, key: string, body: string, onlyIf?: unknown) => r2.put(key, body, { ...(onlyIf ? { onlyIf } : {}), httpMetadata: { contentType: 'application/json' } });
/** The first step to reach a fan-out sends it: a create-only marker; one whose send was lost is found by the five-minute run's resume. */
async function once(r2: R2Agg, p: { tenant: string; gen: string }, name: string, send: () => Promise<void>): Promise<void> {
  if (await put(r2, `${genPrefix(p.tenant, p.gen)}sent/${name}`, '1', { etagDoesNotMatch: '*' })) await send();
}

async function readHead(r2: R2Agg, tenant: string): Promise<{ head: Head | null; etag: string | null }> {
  const got = await readJson<Head>(r2, headKey(tenant));
  return got ? { head: got.value, etag: got.etag } : { head: null, etag: null };
}
/** The depth-0 leaves of a store today's code wrote: its 64 shards, as they stand. */
async function legacyLeaves(r2: R2Agg, tenant: string): Promise<Record<string, string | null>> {
  const present = new Set((await listAll(r2, `aggregates/${tenant}/rings/`)).map(o => o.key));
  return Object.fromEntries(Array.from({ length: SHARDS }, (_, r) => [leafId(0, r), present.has(shardKey(tenant, r)) ? shardKey(tenant, r) : null]));
}
async function writeHead(r2: R2Agg, tenant: string, head: Head, etag: string | null): Promise<boolean> {
  return !!(await put(r2, headKey(tenant), JSON.stringify(head), etag === null ? { etagDoesNotMatch: '*' } : { etagMatches: etag }));
}

// ── plan (the five-minute run) ────────────────────────────────────────────────
async function plan(r2: R2Agg, tenant: string, learn: LearnConfig, at: { date: string; hour: number }, now: number, leaves: Record<string, string | null>, open: boolean, job?: Plan['job']): Promise<Plan> {
  const listed = await I.listObjects(r2, `${tenant}/${at.date}/${pad2(at.hour)}/`);
  const keys = [...listed.keys()].filter(isLearningKey).sort((a, b) => (I.startOf(a) < I.startOf(b) ? -1 : I.startOf(a) > I.startOf(b) ? 1 : a < b ? -1 : 1));
  const objects = keys.map(key => ({ key, etag: listed.get(key)?.etag ?? null, size: listed.get(key)?.size ?? 0 }));
  const pages: Array<[number, number]> = [];
  let start = 0, bytes = 0;
  for (let i = 0; i < objects.length; i++) {
    if (i > start && (bytes + objects[i]!.size > STEP.pageBytes || i - start >= STEP.pageObjects)) { pages.push([start, i]); start = i; bytes = 0; }
    bytes += objects[i]!.size;
  }
  if (objects.length) pages.push([start, objects.length]);
  let refold = false, aggregateEtag: string | null = null;
  if (!open && !job) {
    const stored = await I.readHourBody(r2, hourKey(tenant, at.date, at.hour));
    aggregateEtag = stored.etag;
    if (stored.body !== null) {
      try { const prev = JSON.parse(stored.body) as { objects?: number; objectsRead?: number }; refold = objects.length > (prev.objects ?? 0) || objects.length > (prev.objectsRead ?? 0); } catch { refold = false; }
    }
  }
  const gen = crypto.randomUUID();
  const basis = await digest(stable([objects.map(o => [o.key, o.etag, o.size]), { date: at.date, hour: at.hour }]));
  const p: Plan = { version: 1, tenant, gen, date: at.date, hour: at.hour, open, now, refold, aggregateEtag, objects, pages, leaves, learn, basis, rowDepth: rowDepthOf(objects), ...(job ? { job } : {}) };
  await put(r2, `${genPrefix(tenant, gen)}plan.json`, JSON.stringify(p), { etagDoesNotMatch: '*' });
  return p;
}
const kickoff = (p: Plan): FoldMessage[] => p.pages.length
  ? p.pages.map((_, page) => ({ kind: 'fold', v: 1, tenant: p.tenant, gen: p.gen, step: 'partition', page }))
  : [{ kind: 'fold', v: 1, tenant: p.tenant, gen: p.gen, step: 'leaves' }];

// ── the steps ─────────────────────────────────────────────────────────────────
export async function runFoldStep(env: Env, m: FoldMessage, send: Send): Promise<void> {
  const r2 = env.STORAGE as unknown as R2Agg;
  const stored = await readJson<Plan>(r2, `${genPrefix(m.tenant, m.gen)}plan.json`);
  if (!stored) return; // an abandoned generation, already collected
  const p = stored.value;
  try {
    if (m.step === 'partition') await partition(r2, p, m.page!, send);
    else if (m.step === 'leaves') await fanLeaves(r2, p, send);
    else if (m.step === 'leaf') await (p.rebuild ? rebuildLeaf(r2, p, m.leaf!, send) : leaf(env, r2, p, m.leaf!, send));
    else if (m.step === 'merge') await (p.rebuild ? rebuildMerge(r2, p, m.level!, m.group!, send) : merge(r2, p, m.level!, m.group!, send));
    else if (m.step === 'close') await (p.rebuild ? rebuildClose(env, r2, p) : close(env, r2, p));
  } catch (error) {
    if (error instanceof FoldStepBound && p.job) { await jobRefuse(r2, p, { code: error.code, step: error.step, limit: error.limit, observed: error.observed }); return; }
    if (error instanceof FoldStepBound) { await refuse(env, r2, p, error); return; }
    if (p.open && (error instanceof ReportRowConflict || error instanceof ReportInputError)) { await refuse(env, r2, p, error); return; }
    throw error;
  }
}

async function partition(r2: R2Agg, p: Plan, page: number, send: Send): Promise<void> {
  const [from, to] = p.pages[page]!;
  let size = 0;
  for (let i = from; i < to; i++) size += p.objects[i]!.size;
  if (size > STEP.pageBytes && to - from === 1) throw new FoldStepBound('partition', STEP.pageBytes, size);
  const sections = new Map<string, string[]>();
  for (let i = from; i < to; i++) {
    const o = p.objects[i]!;
    const got = await r2.get(o.key) as { text(): Promise<string> } | null;
    if (!got) throw new ReportInputError();
    const text = await got.text();
    const stream = o.key.includes('/decision/') ? 'decision' : 'outcome';
    let line = 0, offset = 0;
    while (offset < text.length) {
      const end = text.indexOf('\n', offset), raw = text.slice(offset, end < 0 ? text.length : end); offset = end < 0 ? text.length : end + 1;
      const ln = line++;
      if (!raw) continue;
      let row: Record<string, unknown>;
      try { row = JSON.parse(raw) as Record<string, unknown>; } catch { throw new ReportInputError(); }
      rowShapeOf(row, stream);
      if (row.tenant !== p.tenant) throw new ReportInputError();
      const identity = logicalIdentity(row, stream);
      if (identity === null) throw new ReportInputError();
      const id = String(row[stream === 'decision' ? 'decision_id' : 'outcome_id']);
      const entry: Entry = { p: [i, ln], s: stream === 'decision' ? 'd' : 'o', id, g: await logicalDigest(row), l: identity === 'legacy',
        ...(stream === 'decision' ? (p.rebuild ? { r: row as unknown as DecisionRecord } : { c: compactOf(row as never) }) : { o: row as unknown as OutcomeRecord }) };
      const leafKey = rowLeaf(p, String(row.visitor_id));
      const list = sections.get(leafKey) ?? []; list.push(JSON.stringify(entry)); sections.set(leafKey, list);
    }
  }
  const index: Record<string, [number, number]> = {};
  const parts: string[] = []; let at = 0;
  for (const leafKey of [...sections.keys()].sort()) {
    const body = '[' + sections.get(leafKey)!.join(',') + ']';
    const n = bytesOf(body); index[leafKey] = [at, n]; at += n; parts.push(body);
  }
  sections.clear();
  await put(r2, `${genPrefix(p.tenant, p.gen)}p/${page}.pack`, parts.join(''));
  await put(r2, `${genPrefix(p.tenant, p.gen)}p/${page}.idx`, JSON.stringify(index));
  const done = (await listAll(r2, `${genPrefix(p.tenant, p.gen)}p/`)).filter(o => o.key.endsWith('.idx')).length;
  if (done === p.pages.length) await once(r2, p, 'leaves', () => send([{ kind: 'fold', v: 1, tenant: p.tenant, gen: p.gen, step: 'leaves' }]));
}

/** The depth an hour's rows are partitioned at: each of its 64·2^d leaves' shares within 6 MiB (R-P660). */
function rowDepthOf(objects: Array<{ size: number }>): number {
  const bytes = objects.reduce((n, o) => n + o.size, 0);
  let depth = 0;
  while (depth < 12 && bytes / (SHARDS * 2 ** depth) > STEP.leafRowBytes * 0.75) depth++;
  return depth;
}
/** The leaf a row of the hour belongs to: its visitor's leaf of the head, or at the hour's row depth when that is deeper. */
function rowLeaf(p: Plan, visitor: string): string {
  const found = leafOf(p.leaves, visitor), depth = p.rowDepth ?? 0;
  return parseLeaf(found).depth >= depth ? found : leafId(depth, fnv(visitor) % (SHARDS * 2 ** depth));
}
/** The head's leaf whose state a leaf of this hour starts from: itself, or the ancestor split for the hour. */
function stateSource(p: Plan, id: string): string | null {
  if (p.leaves[id]) return id;
  const { depth, residue } = parseLeaf(id);
  for (let d = depth - 1; d >= 0; d--) { const anc = leafId(d, residue % (SHARDS * 2 ** d)); if (p.leaves[anc]) return anc; }
  return null;
}
async function fanLeaves(r2: R2Agg, p: Plan, send: Send): Promise<void> {
  const ids = new Set<string>();
  // A leaf of the head shallower than the hour's row depth is split for the hour: each of its descendants at that depth
  // is a leaf of the hour, holding its own visitors' state.
  for (const [id, key] of Object.entries(p.leaves)) {
    if (key === null) continue;
    const { depth, residue } = parseLeaf(id), target = p.rowDepth ?? 0;
    if (depth >= target) { ids.add(id); continue; }
    for (let j = 0; j < 2 ** (target - depth); j++) ids.add(leafId(target, residue + j * SHARDS * 2 ** depth));
  }
  for (let page = 0; page < p.pages.length; page++) {
    const idx = await readJson<Record<string, [number, number]>>(r2, `${genPrefix(p.tenant, p.gen)}p/${page}.idx`);
    if (!idx) throw new ReportInputError();
    for (const id of Object.keys(idx.value)) ids.add(id);
  }
  // In today's shard order (residue, then depth), so a depth-0 hour merges its leaves as today's fold visits its shards.
  const leaves = [...ids].sort((a, b) => { const x = parseLeaf(a), y = parseLeaf(b); return (x.residue % SHARDS) - (y.residue % SHARDS) || x.depth - y.depth || x.residue - y.residue; });
  await put(r2, `${genPrefix(p.tenant, p.gen)}leaves.json`, JSON.stringify(leaves));
  if (!leaves.length) { await once(r2, p, 'close', () => send([{ kind: 'fold', v: 1, tenant: p.tenant, gen: p.gen, step: 'close' }])); return; }
  await once(r2, p, 'leaf', () => send(leaves.map(leaf => ({ kind: 'fold', v: 1, tenant: p.tenant, gen: p.gen, step: 'leaf', leaf }))));
}

function splitState(state: ShardState, id: string): Array<{ id: string; state: ShardState }> {
  const { depth, residue } = parseLeaf(id), modulus = SHARDS * 2 ** (depth + 1);
  const children = [residue, residue + SHARDS * 2 ** depth].map(r => ({ id: leafId(depth + 1, r), r, state: JSON.parse(JSON.stringify({ ...state, rings: {}, seen: {}, seenAt: undefined, seenRetention: undefined, seenDays: undefined, seenDaysRetention: undefined, enrollment: undefined, deferred: undefined })) as ShardState }));
  const pick = (visitor: string) => children.find(c => fnv(visitor) % modulus === c.r)!.state;
  for (const [visitor, ring] of Object.entries(state.rings)) pick(visitor).rings[visitor] = ring;
  for (const [brand, ids] of Object.entries(state.seen)) { for (const c of children) c.state.seen[brand] = []; for (const v of ids) pick(v).seen[brand]!.push(v); }
  const byVisitor = <T>(get: (s: ShardState) => Record<string, Record<string, T>> | undefined, set: (s: ShardState, v: Record<string, Record<string, T>>) => void) => {
    const src = get(state); if (!src) return;
    for (const c of children) set(c.state, {});
    for (const [brand, values] of Object.entries(src)) {
      for (const c of children) (get(c.state)!)[brand] = {};
      for (const [visitor, v] of Object.entries(values)) (get(pick(visitor))!)[brand]![visitor] = v;
    }
  };
  byVisitor(s => s.seenAt, (s, v) => { s.seenAt = v; });
  byVisitor(s => s.seenRetention as Record<string, Record<string, RetentionStamp>> | undefined, (s, v) => { s.seenRetention = v; });
  const byDate = <T>(get: (s: ShardState) => Record<string, Record<string, Record<string, T>>> | undefined, set: (s: ShardState, v: Record<string, Record<string, Record<string, T>>>) => void) => {
    const src = get(state); if (!src) return;
    for (const c of children) set(c.state, {});
    for (const [date, brands] of Object.entries(src)) for (const [brand, values] of Object.entries(brands)) {
      for (const c of children) ((get(c.state)![date] ??= {})[brand] = {});
      for (const [visitor, v] of Object.entries(values)) get(pick(visitor))![date]![brand]![visitor] = v;
    }
  };
  byDate(s => s.enrollment, (s, v) => { s.enrollment = v; });
  byDate(s => s.deferred, (s, v) => { s.deferred = v; });
  byDate(s => s.seenDaysRetention, (s, v) => { s.seenDaysRetention = v; });
  if (state.seenDays) {
    for (const c of children) c.state.seenDays = {};
    for (const [date, brands] of Object.entries(state.seenDays)) for (const [brand, ids] of Object.entries(brands)) {
      for (const c of children) ((c.state.seenDays![date] ??= {})[brand] = []);
      for (const v of ids) pick(v).seenDays![date]![brand]!.push(v);
    }
  }
  for (const c of children) for (const k of Object.keys(c.state) as Array<keyof ShardState>) if (c.state[k] === undefined) delete c.state[k];
  return children.map(c => ({ id: c.id, state: c.state }));
}

/** R-P604, R-P629: of two copies of one logical row, the one every reader keeps (P103's preferredCopy, src/ledger/delivery.ts). */
const preferredOf = (a: unknown, b: unknown): boolean => !!a && !!b && preferredCopy(a as Record<string, unknown>, b as Record<string, unknown>);
async function leaf(env: Env, r2: R2Agg, p: Plan, id: string, send: Send): Promise<void> {
  const prefix = genPrefix(p.tenant, p.gen);
  // The leaf's rows, from every page's pack, by range; their size checked before they are read.
  const spans: Array<{ page: number; at: [number, number] }> = [];
  let rowBytes = 0;
  for (let page = 0; page < p.pages.length; page++) {
    const idx = await readJson<Record<string, [number, number]>>(r2, `${prefix}p/${page}.idx`);
    if (!idx) throw new ReportInputError();
    const at = idx.value[id]; if (at) { spans.push({ page, at }); rowBytes += at[1]; }
  }
  if (rowBytes > STEP.leafRowBytes) throw new FoldStepBound('leaf', STEP.leafRowBytes, rowBytes);
  const entries: Entry[] = [];
  for (const s of spans) entries.push(...(JSON.parse(await readRange(r2, `${prefix}p/${s.page}.pack`, s.at[0], s.at[1])) as Entry[]));
  entries.sort((a, b) => a.p[0] - b.p[0] || a.p[1] - b.p[1]);
  // De-duplicated in global order; of the equal copies of one logical row the one preferredOf names is kept (R-P604, R-P629).
  const first = new Map<string, Entry>(), count = new Map<string, number>(), conflicts: DuplicateWitness[] = [], place = new Map<string, number>();
  const decisions: CompactDecision[] = [], outcomes: OutcomeRecord[] = [];
  for (const e of entries) {
    const key = `${e.s}|${e.id}`, prior = first.get(key);
    if (!prior) { first.set(key, e); place.set(key, e.s === 'd' ? decisions.push(e.c!) - 1 : outcomes.push(e.o!) - 1); continue; }
    if (e.l) throw new ReportInputError();
    if (prior.g === e.g) {
      count.set(key, (count.get(key) ?? 0) + 1);
      if (preferredOf(e.o ?? e.c?.entry, prior.o ?? prior.c?.entry)) { first.set(key, e); if (e.s === 'd') decisions[place.get(key)!] = e.c!; else outcomes[place.get(key)!] = e.o!; }
      continue;
    }
    const stream = e.s === 'd' ? 'decision' : 'outcome';
    if (!await I.filedConflict(env as unknown as RetentionEnv, stream, e.id)) {
      const place = p.objects[e.p[0]]!, got = await r2.get(place.key) as { text(): Promise<string> } | null;
      const row = got ? JSON.parse((await got.text()).split('\n')[e.p[1]]!) as Record<string, unknown> : {};
      if (!p.job) throw new ReportRowConflict(stream, e.id, row);
      const { captureReadConflict } = await import('@/ledger/quarantine');
      await captureReadConflict(env, stream, e.id, row as never);
    }
    const c = e.c, o = e.o;
    conflicts.push({ brand: (c ? c.entry.brand : o!.brand) as string, visitor_id: c ? c.visitor_id : o!.visitor_id, ts: c ? c.ts : o!.ts, stream, count: 1 });
  }
  const duplicates: DuplicateWitness[] = [];
  for (const [key, n] of count) { const e = first.get(key)!; duplicates.push({ brand: (e.c ? e.c.entry.brand : e.o!.brand) as string, visitor_id: e.c ? e.c.visitor_id : e.o!.visitor_id, ts: e.c ? e.c.ts : e.o!.ts, stream: e.s === 'd' ? 'decision' : 'outcome', count: n }); }
  // The leaf's state (a v2 shard of today's store at depth 0, or the version the head names).
  const residue = parseLeaf(id).residue % SHARDS;
  const source = stateSource(p, id), stateKey = source ? p.leaves[source]! : null;
  let original = stateKey ? (await I.readHourBody(r2, stateKey)).body : null;
  // A leaf split from its ancestor for the hour starts from the ancestor's state, its own visitors only (splitState down the path).
  if (original !== null && source !== id) {
    let at = { id: source!, state: I.shardState(original, parseLeaf(source!).residue % SHARDS) };
    const { residue: target } = parseLeaf(id);
    while (parseLeaf(at.id).depth < parseLeaf(id).depth) at = splitState(at.state, at.id).find(c => target % (SHARDS * 2 ** parseLeaf(c.id).depth) === parseLeaf(c.id).residue)!;
    original = JSON.stringify(at.state);
  }
  if (original !== null && bytesOf(original) > STEP.leafStateBytes * 1.5) throw new FoldStepBound('leaf', STEP.leafStateBytes, bytesOf(original));
  const tombs = await loadTombstones(r2 as never, p.tenant) as Map<string, Tombstone>;
  const state = I.cleanupShard(I.shardState(original, residue), p.tenant, tombs, p.now);
  const learn = p.learn, statsCfg: StatsConfig = learn.stats ?? DEFAULT_STATS, slotCfg = slotConfigsOf(learn), policies = p.job ? p.job.policies : policiesOf(learn);
  const loaded = { decisions, outcomes, ...(duplicates.length ? { duplicates } : {}), ...(conflicts.length ? { conflicts } : {}) };
  const rows = I.foldableRows(loaded, tombs, slotCfg);
  const retentionEnv = env as unknown as RetentionEnv;
  if (env.RETENTION) {
    for (const record of [...rows.decisions.map(row => row.entry), ...rows.outcomes]) {
      requireRetention(retentionEnv, record.retention?.ledger, p.tenant, 'ledger', p.now);
      requireRetention(retentionEnv, record.retention?.hourly, p.tenant, 'hourly', p.now);
    }
    for (const ring of Object.values(state.rings)) for (const row of ring) requireRetention(retentionEnv, row.retention?.hourly, p.tenant, 'hourly', p.now);
  }
  const brands = I.hourBrands(loaded, rows.decisions, rows.outcomes, tombs, policies, statsCfg);
  const from = Date.UTC(Number(p.date.slice(0, 4)), Number(p.date.slice(5, 7)) - 1, Number(p.date.slice(8, 10)), p.hour);
  const creditedSlots = new Map<string, Set<string>>();
  const ctx: FoldContext = { tenant: p.tenant, date: p.date, from, to: from + HOUR_MS, refold: p.refold, policies, slotCfg, statsCfg, horizonMs: DEFAULT_HORIZON_MS, ringCap: RING_CAP,
    tombs, brands, creditedSlots, retainedIds: new Set(), retainedBudget: { work: 0, bytes: 0 }, incomingIds: new Set(rows.decisions.map(d => d.entry.id)) };
  const positions = I.positionHistories(r2, p.tenant);
  ctx.positionWeight = positions.weight;
  await positions.load([...rows.decisions.map(d => d.entry), ...Object.values(state.rings).flat()]);
  const r = foldShard(state, rows.decisions, rows.outcomes, ctx);
  const unaccounted = new Set<string>(), stranded = new Map<string, Set<number>>();
  I.countMembership(brands, unaccounted, stranded, r.state, p.date, p.hour);
  // The next state version, named by nothing until the head names it.
  const states: Record<string, string | null> = {};
  if (!p.open && source && source !== id) states[source] = null;
  if (!p.open) {
    const next = r.state; next.generation = p.gen; delete next.pending; delete next.cleanup;
    const body = JSON.stringify(next);
    if (body === original && source === id) states[id] = stateKey;
    else if (bytesOf(body) <= STEP.leafStateBytes) { const key = `${prefix}s/${id}.json`; await put(r2, key, body); states[id] = key; }
    else {
      // A leaf past 8 MiB splits by visitor hash, moving only its own visitors.
      states[id] = null;
      const queue = splitState(next, id);
      while (queue.length) {
        const child = queue.shift()!, text = JSON.stringify(child.state);
        if (bytesOf(text) > STEP.leafStateBytes && Object.keys(child.state.rings).length > 1) { queue.push(...splitState(child.state, child.id)); continue; }
        const key = `${prefix}s/${child.id}.json`; await put(r2, key, text); states[child.id] = key;
      }
    }
  }
  const partialBody: HourPartial = { brands, unaccounted: [...unaccounted], stranded: Object.fromEntries([...stranded].map(([b, h]) => [b, [...h]])),
    credited: Object.fromEntries([...creditedSlots].map(([b, s]) => [b, [...s]])), ringsFolded: r.folded, recoveryFrom: r.floor >= 0 ? r.floor + HOUR_MS : 0, states, leaves: 1 };
  await put(r2, `${prefix}l/${id}.json`, JSON.stringify(partialBody));
  const leaves = await readJson<string[]>(r2, `${prefix}leaves.json`);
  const done = (await listAll(r2, `${prefix}l/`)).length;
  if (leaves && done === leaves.value.length) await once(r2, p, 'm0', () => send(mergeLevel(p, 0, leaves.value.length)));
}

function mergeLevel(p: Plan, level: number, inputs: number): FoldMessage[] {
  const groups = Math.ceil(inputs / STEP.fanIn);
  return Array.from({ length: groups }, (_, group) => ({ kind: 'fold', v: 1, tenant: p.tenant, gen: p.gen, step: 'merge', level, group }));
}

/** Two partials of one hour as one: leaves hold disjoint visitors, so the date's distinct counts ADD (unlike two hours, which take the larger). */
function mergeInto(into: HourPartial, from: HourPartial, tau: number): void {
  for (const [brand, b] of Object.entries(from.brands)) {
    const cur = into.brands[brand];
    if (!cur) { into.brands[brand] = JSON.parse(JSON.stringify(b)) as HourBrand; continue; }
    const visitors = cur.visitorsDay + b.visitorsDay;
    const assignments = cur.assignments && b.assignments ? { v: { ...cur.assignments.visitors }, o: JSON.parse(JSON.stringify(cur.assignments.outcomes)) as Record<string, Record<string, number>> } : null;
    const carry = cur.carryIn && b.carryIn ? { evicted: cur.carryIn.evicted + b.carryIn.evicted, unplaced: cur.carryIn.unplaced + b.carryIn.unplaced } : cur.carryIn ?? b.carryIn;
    const named = cur.named && b.named ? I.addNamed(cur.named, b.named) : cur.named ?? b.named;
    const bothAssign = !!cur.assignments && !!b.assignments;
    I.mergeBrandIntoFn(cur, b, tau);
    cur.visitorsDay = visitors;
    if (carry) cur.carryIn = carry;
    if (named) cur.named = named;
    if (bothAssign && cur.assignments && assignments) {
      for (const [arm, n] of Object.entries(b.assignments!.visitors)) assignments.v[arm] = (assignments.v[arm] ?? 0) + n;
      for (const [arm, byType] of Object.entries(b.assignments!.outcomes)) for (const [t, n] of Object.entries(byType)) (assignments.o[arm] ??= {})[t] = (assignments.o[arm]![t] ?? 0) + n;
      cur.assignments.visitors = assignments.v; cur.assignments.outcomes = assignments.o;
    }
  }
  into.unaccounted = [...new Set([...into.unaccounted, ...from.unaccounted])];
  for (const [b, hours] of Object.entries(from.stranded)) into.stranded[b] = [...new Set([...(into.stranded[b] ?? []), ...hours])];
  for (const [b, slots] of Object.entries(from.credited)) into.credited[b] = [...new Set([...(into.credited[b] ?? []), ...slots])];
  into.ringsFolded &&= from.ringsFolded;
  into.recoveryFrom = Math.max(into.recoveryFrom, from.recoveryFrom);
  Object.assign(into.states, from.states);
  into.leaves += from.leaves;
}
const emptyPartial = (): HourPartial => ({ brands: {}, unaccounted: [], stranded: {}, credited: {}, ringsFolded: true, recoveryFrom: 0, states: {}, leaves: 0 });

async function merge(r2: R2Agg, p: Plan, level: number, group: number, send: Send): Promise<void> {
  const prefix = genPrefix(p.tenant, p.gen);
  const leaves = (await readJson<string[]>(r2, `${prefix}leaves.json`))!.value;
  let inputs = leaves.length; for (let l = 0; l < level; l++) inputs = Math.ceil(inputs / STEP.fanIn);
  const keys = Array.from({ length: Math.min(STEP.fanIn, inputs - group * STEP.fanIn) }, (_, i) => level === 0 ? `${prefix}l/${leaves[group * STEP.fanIn + i]}.json` : `${prefix}m/${level - 1}/${group * STEP.fanIn + i}.json`);
  const tau = (p.learn.stats ?? DEFAULT_STATS).tauLearnMs;
  const total = emptyPartial();
  for (const key of keys) { const part = await readJson<HourPartial>(r2, key); if (!part) throw new ReportInputError(); mergeInto(total, part.value, tau); }
  const groups = Math.ceil(inputs / STEP.fanIn);
  await put(r2, `${prefix}m/${level}/${group}.json`, JSON.stringify(total));
  const done = (await listAll(r2, `${prefix}m/${level}/`)).length;
  if (done < groups) return;
  if (groups === 1) await once(r2, p, 'close', () => send([{ kind: 'fold', v: 1, tenant: p.tenant, gen: p.gen, step: 'close' }]));
  else await once(r2, p, `m${level + 1}`, () => send(mergeLevel(p, level + 1, groups)));
}

async function finalPartial(r2: R2Agg, p: Plan): Promise<HourPartial> {
  const prefix = genPrefix(p.tenant, p.gen);
  const leaves = (await readJson<string[]>(r2, `${prefix}leaves.json`))?.value ?? [];
  if (!leaves.length) return emptyPartial();
  let inputs = leaves.length, level = 0;
  while (Math.ceil(inputs / STEP.fanIn) > 1) { inputs = Math.ceil(inputs / STEP.fanIn); level++; }
  const got = await readJson<HourPartial>(r2, `${prefix}m/${level}/0.json`);
  if (!got) throw new ReportInputError();
  return got.value;
}

async function close(env: Env, r2: R2Agg, p: Plan): Promise<void> {
  const final = await finalPartial(r2, p);
  const learn = p.learn, policies = p.job ? p.job.policies : policiesOf(learn);
  const brands = final.brands;
  // Every leaf of the head that held no state and no row this hour adds nothing; brands present on no leaf still say their carry-in.
  I.closeBrands(brands, policies, learn, new Set(final.unaccounted), new Map(Object.entries(final.stranded).map(([b, h]) => [b, new Set(h)])),
    new Map(Object.entries(final.credited).map(([b, s]) => [b, new Set(s)])), DEFAULT_HORIZON_MS, RING_CAP);
  const from = Date.UTC(Number(p.date.slice(0, 4)), Number(p.date.slice(5, 7)) - 1, Number(p.date.slice(8, 10)), p.hour);
  const agg: HourAggregate = { version: 1, generation: p.gen, tenant: p.tenant, date: p.date, hour: p.hour, from, to: from + HOUR_MS, builtAt: p.now, objects: p.objects.length,
    objectsRead: p.objects.length, truncated: false, horizonMs: DEFAULT_HORIZON_MS, shards: SHARDS, ringsFolded: final.ringsFolded, recoveryFrom: final.recoveryFrom, brands };
  const body = JSON.stringify(agg);
  if (p.job) { await put(r2, `${p.job.key.slice(0, -'job.json'.length)}h/${pad2(p.hour)}.json`, body); await jobAdvance(env, r2, p, final.states); return; }
  I.preparedAggregate(body, p.tenant, { date: p.date, hour: p.hour }, I.buildOptions({}), learn);
  if (p.open) {
    await put(r2, openKey(p.tenant, p.date, p.hour), body);
    await put(r2, openStateKey(p.tenant, p.date, p.hour), JSON.stringify({ version: 1, tenant: p.tenant, date: p.date, hour: p.hour, basis: p.basis, status: 'current', through: p.now,
      generation: p.gen, content: await digest(body), segments: [] }));
    await clearOpen(r2, p);
    await I.publishDate(r2, p.tenant, p.date, learn, p.now);
    return;
  }
  // The commit, write one: the hour aggregate, create-only on a first fold, on the etag the plan noted for a re-fold.
  const written = await put(r2, hourKey(p.tenant, p.date, p.hour), body, p.aggregateEtag === null ? { etagDoesNotMatch: '*' } : { etagMatches: p.aggregateEtag });
  if (!written) {
    const current = await I.readHourBody(r2, hourKey(p.tenant, p.date, p.hour));
    if (!current.body || (JSON.parse(current.body) as { generation?: string }).generation !== p.gen) return; // another coordinator's hour: stop
  }
  const committed = await commitHead(r2, p, final.states);
  // The date's day, summed one hour at a time, published once the hour is committed (as today's fold publishes after it folds).
  await I.publishDate(r2, p.tenant, p.date, learn, p.now);
  // Every due hour, in order: the next one is planned as soon as this one is committed, not at the next five-minute run.
  if (committed) await planNextDue(env, r2, p.tenant, learn, Date.now(), queueSend(env));
}
/** The commit, write two: the head names the new leaf versions and clears the plan in flight. */
async function commitHead(r2: R2Agg, p: Plan, states: Record<string, string | null>): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { head, etag } = await readHead(r2, p.tenant);
    if (!head || head.inflight?.gen !== p.gen) return false; // already committed (adopted)
    const leaves = { ...head.leaves };
    for (const [id, key] of Object.entries(states)) { if (key === null) delete leaves[id]; else leaves[id] = key; }
    // a split parent leaves the head; its children enter it
    for (const [id, key] of Object.entries(states)) if (key === null) delete leaves[id];
    await put(r2, dayStartKey(p.tenant, p.date), JSON.stringify(head.leaves), { etagDoesNotMatch: '*' });
    if (await writeHead(r2, p.tenant, { ...head, seq: head.seq + 1, leaves, inflight: null }, etag)) return true;
  }
  return false;
}
async function clearOpen(r2: R2Agg, p: Plan): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { head, etag } = await readHead(r2, p.tenant);
    if (!head || head.open?.gen !== p.gen) return;
    if (await writeHead(r2, p.tenant, { ...head, open: null }, etag)) return;
  }
}
async function refuse(env: Env, r2: R2Agg, p: Plan, error: unknown): Promise<void> {
  if (p.open) {
    const refusal = error instanceof FoldStepBound ? { at: p.now, error: error.message, code: error.code, step: error.step, limit: error.limit, observed: error.observed }
      : error instanceof ReportRowConflict ? { at: p.now, error: error.message, code: error.code, conflict: { stream: error.stream } }
        : { at: p.now, error: 'report input invalid', code: 'report_input_invalid' };
    await put(r2, openStateKey(p.tenant, p.date, p.hour), JSON.stringify({ version: 1, tenant: p.tenant, date: p.date, hour: p.hour, basis: p.basis, status: 'refused', through: null,
      generation: null, content: null, refusal, segments: [] }));
    await clearOpen(r2, p);
    await I.publishDate(r2, p.tenant, p.date, p.learn, p.now);
    return;
  }
  // A closed hour past a bound: the plan is abandoned and the hour named refused for this listing; newer hours go on.
  // R-P660: the refusal is stored where the day reads it (refusedHourKey), so the day names the hour among its missing
  // hours with the refusal, and goes on naming it after later hours fold.
  {
    const refusal = error instanceof FoldStepBound ? { at: p.now, error: error.message, code: error.code, step: error.step, limit: error.limit, observed: error.observed }
      : error instanceof ReportRowConflict ? { at: p.now, error: error.message, code: error.code, conflict: { stream: error.stream } }
        : { at: p.now, error: 'report input invalid', code: 'report_input_invalid' };
    await put(r2, refusedHourKey(p.tenant, p.date, p.hour), JSON.stringify({ hour: p.hour, basis: p.basis, refusal }));
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const { head, etag } = await readHead(r2, p.tenant);
    if (!head || head.inflight?.gen !== p.gen) break;
    if (await writeHead(r2, p.tenant, { ...head, inflight: null, refused: { ...(head.refused ?? {}), [`${p.date}/${pad2(p.hour)}`]: p.basis } }, etag)) break;
  }
  await I.publishDate(r2, p.tenant, p.date, p.learn, p.now);
}

// ── the five-minute run ───────────────────────────────────────────────────────
/** What the run finds missing of a generation in flight: the steps to send again (one listing per 1,000 outputs). */
async function missingSteps(r2: R2Agg, p: Plan): Promise<FoldMessage[]> {
  const prefix = genPrefix(p.tenant, p.gen);
  const present = new Set((await listAll(r2, prefix)).map(o => o.key.slice(prefix.length)));
  const msg = (x: Partial<FoldMessage>): FoldMessage => ({ kind: 'fold', v: 1, tenant: p.tenant, gen: p.gen, ...x } as FoldMessage);
  const idx = p.pages.map((_, page) => page).filter(page => !present.has(`p/${page}.idx`));
  if (idx.length) return idx.map(page => msg({ step: 'partition', page }));
  if (!present.has('leaves.json')) return [msg({ step: 'leaves' })];
  const leaves = (await readJson<string[]>(r2, `${prefix}leaves.json`))!.value;
  const missingLeaves = leaves.filter(id => !present.has(`l/${id}.json`));
  if (missingLeaves.length) return missingLeaves.map(leaf => msg({ step: 'leaf', leaf }));
  let inputs = leaves.length, level = 0;
  while (inputs > 0) {
    const groups = Math.ceil(inputs / STEP.fanIn);
    const missing = Array.from({ length: groups }, (_, g) => g).filter(g => !present.has(`m/${level}/${g}.json`));
    if (missing.length) return missing.map(group => msg({ step: 'merge', level, group }));
    if (groups === 1) break;
    inputs = groups; level++;
  }
  return [msg({ step: 'close' })];
}

/** The fold's own objects no head names and no plan in flight holds, past the 15-minute grace. */
async function collect(r2: R2Agg, tenant: string, head: Head, now: number): Promise<void> {
  const keep = new Set(Object.values(head.leaves).filter((k): k is string => !!k));
  const live = [head.inflight?.gen, head.open?.gen].filter(Boolean).map(g => genPrefix(tenant, g!));
  for (const o of await listAll(r2, `${foldPrefix(tenant)}daystart/`)) for (const k of Object.values((await readJson<Record<string, string | null>>(r2, o.key))?.value ?? {})) if (k) keep.add(k);
  for (const o of await listAll(r2, `${foldPrefix(tenant)}jobs/`)) if (o.key.endsWith('/job.json')) {
    const j = (await readJson<JobState>(r2, o.key))?.value;
    if (j?.status !== 'running') continue;
    for (const k of Object.values(j.leaves)) if (k) keep.add(k);
    if (j.gen) live.push(genPrefix(tenant, j.gen));
  }
  const stale: string[] = [];
  for (const o of await listAll(r2, `${foldPrefix(tenant)}g/`)) {
    if (keep.has(o.key) || live.some(prefix => o.key.startsWith(prefix))) continue;
    if (o.uploaded && now - o.uploaded.getTime() < STEP.graceMs) continue;
    stale.push(o.key);
  }
  for (const o of await listAll(r2, `aggregates/${tenant}/rings/`)) if (!keep.has(o.key) && !(o.uploaded && now - o.uploaded.getTime() < STEP.graceMs)) stale.push(o.key);
  // The open hours' working objects outlive their hour by at most one run, as the one-request fold's job kept them
  // (src/learn/hourly.ts foldOpenHours); a ledger copy that fold kept is removed with them (the steps read the
  // ledger itself), so no erased visitor's row outlives it in a copy.
  const openPrefix = `aggregates/${tenant}/open/`, open = new Set(openHours(now).map(at => `${at.date}/${pad2(at.hour)}`));
  for (const o of await listAll(r2, openPrefix)) {
    const m = /^(\d{4}-\d{2}-\d{2})\/(\d{2})\.(json|state\.json)$/.exec(o.key.slice(openPrefix.length));
    if (!m || !open.has(`${m[1]}/${m[2]}`)) stale.push(o.key);
  }
  for (const key of stale) await (r2 as unknown as { delete(k: string): Promise<void> }).delete(key);
}

export interface StagedRun { planned: string | null; resumed: number; published: string[] }
export async function stagedFiveMinuteRun(env: Env, tenant: string, learn: LearnConfig, now: number, send: Send): Promise<StagedRun> {
  const r2 = env.STORAGE as unknown as R2Agg;
  const result: StagedRun = { planned: null, resumed: 0, published: [] };
  let { head, etag } = await readHead(r2, tenant);
  if (!head) {
    // A store today's code wrote: an interrupted v1/v2 plan or cleanup is finished by today's code first.
    const zero = await I.readHourBody(r2, shardKey(tenant, 0));
    const state = I.shardState(zero.body, 0);
    const pending = I.pendingHour(state, tenant);
    if (pending) await buildHour(r2, tenant, { date: pending.date, hour: pending.hour }, learn, now, pending.options, env as unknown as RetentionEnv);
    else if (state.cleanup) await cleanupHourlyState(r2, tenant, SHARDS, now);
    head = { version: 1, seq: 0, leaves: await legacyLeaves(r2, tenant), inflight: null, open: null };
    if (!await writeHead(r2, tenant, head, null)) return result;
    ({ head, etag } = await readHead(r2, tenant));
    if (!head) return result;
  }
  await collect(r2, tenant, head, now);
  // A plan in flight: finish its head write, or send its missing steps; newer hours wait.
  if (head.inflight) {
    const p = (await readJson<Plan>(r2, `${genPrefix(tenant, head.inflight.gen)}plan.json`))?.value;
    if (!p) { await writeHead(r2, tenant, { ...head, inflight: null }, etag); return result; }
    const agg = await I.readHourBody(r2, hourKey(tenant, p.date, p.hour));
    if (agg.body && (JSON.parse(agg.body) as { generation?: string }).generation === p.gen) {
      if (await commitHead(r2, p, (await finalPartial(r2, p)).states)) result.planned = (await planNextDue(env, r2, tenant, learn, now, send)).planned;
      return result;
    }
    const missing = await missingSteps(r2, p);
    result.resumed = missing.length; await send(missing);
    return result;
  }
  const due = await planNextDue(env, r2, tenant, learn, now, send);
  if (due.planned) { result.planned = due.planned; return result; }
  ({ head, etag } = await readHead(r2, tenant)); if (!head) return result;
  const { datesBuilt, lateByDate } = due;
  // Nothing to fold: the dates' days, summed one hour at a time, where the saved day does not name every built hour.
  for (const date of [...datesBuilt.keys()].filter(d => datesBuilt.get(d)!.size).sort().slice(-3)) {
    try { if (await I.publishIfStale(r2, tenant, date, learn, now, lateByDate.get(date))) result.published.push(date); } catch { /* next run */ }
  }
  // The open hour, on the same steps, never moving the head.
  for (const at of openHours(now)) {
    if (head.open) {
      const p = (await readJson<Plan>(r2, `${genPrefix(tenant, head.open.gen)}plan.json`))?.value;
      if (p && p.date === at.date && p.hour === at.hour) { const missing = await missingSteps(r2, p); result.resumed += missing.length; await send(missing); continue; }
      ({ head, etag } = await readHead(r2, tenant)); if (!head) return result;
      if (!await writeHead(r2, tenant, { ...head, open: null }, etag)) return result;
      ({ head, etag } = await readHead(r2, tenant)); if (!head) return result;
    }
    const listed = await I.listObjects(r2, `${tenant}/${at.date}/${pad2(at.hour)}/`);
    if (![...listed.keys()].some(isLearningKey)) continue;
    const keys = [...listed.keys()].filter(isLearningKey).sort((a, b) => (I.startOf(a) < I.startOf(b) ? -1 : I.startOf(a) > I.startOf(b) ? 1 : a < b ? -1 : 1));
    const basis = await digest(stable([keys.map(k => [k, listed.get(k)?.etag ?? null, listed.get(k)?.size ?? 0]), { date: at.date, hour: at.hour }]));
    const standing = await readJson<{ basis: string | null }>(r2, openStateKey(tenant, at.date, at.hour));
    if (standing?.value.basis === basis) continue;
    const p = await plan(r2, tenant, learn, at, now, head.leaves, true);
    if (!await writeHead(r2, tenant, { ...head, open: { gen: p.gen, date: at.date, hour: at.hour } }, etag)) return result;
    await send(kickoff(p));
  }
  return result;
}
// ── the W24 rebuild on the same steps ─────────────────────────────────────────
/** The retained day and the day before it (the carry-in), as the hourly fold reads them, partitioned by visitor; each leaf folds its visitors with the one ring rule. */
export async function planRebuild(env: Env, job: RebuildJob): Promise<void> {
  const r2 = env.STORAGE as unknown as R2Agg;
  const objects: Plan['objects'] = [];
  for (const date of [job.before, job.date]) for (let hour = 0; hour < 24; hour++) {
    const listed = await I.listObjects(r2, `${job.tenant}/${date}/${pad2(hour)}/`);
    const keys = [...listed.keys()].filter(isLearningKey).sort((a, b) => (I.startOf(a) < I.startOf(b) ? -1 : I.startOf(a) > I.startOf(b) ? 1 : a < b ? -1 : 1));
    objects.push(...keys.map(key => ({ key, etag: listed.get(key)?.etag ?? null, size: listed.get(key)?.size ?? 0 })));
  }
  const pages: Array<[number, number]> = [];
  let start = 0, bytes = 0;
  for (let i = 0; i < objects.length; i++) {
    if (i > start && (bytes + objects[i]!.size > STEP.pageBytes || i - start >= STEP.pageObjects)) { pages.push([start, i]); start = i; bytes = 0; }
    bytes += objects[i]!.size;
  }
  if (objects.length) pages.push([start, objects.length]);
  const gen = crypto.randomUUID();
  const p: Plan = { version: 1, tenant: job.tenant, gen, date: job.date, hour: 0, open: false, now: job.at, refold: false, aggregateEtag: null, objects, pages, leaves: {}, rowDepth: rowDepthOf(objects),
    learn: {} as LearnConfig, basis: '', rebuild: job };
  await put(r2, `${genPrefix(job.tenant, gen)}plan.json`, JSON.stringify(p), { etagDoesNotMatch: '*' });
  await queueSend(env)(kickoff(p));
}
/** The day's ledger bytes and the day before's, to choose the steps over one request. */
export async function rebuildBytes(env: Env, tenant: string, dates: string[]): Promise<number> {
  let n = 0;
  for (const date of dates) for (const o of await listAll(env.STORAGE as unknown as R2Agg, `${tenant}/${date}/`)) if (isLearningKey(o.key)) n += o.size ?? 0;
  return n;
}
interface RebuildPartial { stats: StatsState; decisions: number; outcomes: number }
async function rebuildLeaf(r2: R2Agg, p: Plan, id: string, send: Send): Promise<void> {
  const prefix = genPrefix(p.tenant, p.gen), job = p.rebuild!;
  const spans: Array<{ page: number; at: [number, number] }> = [];
  let rowBytes = 0;
  for (let page = 0; page < p.pages.length; page++) {
    const idx = await readJson<Record<string, [number, number]>>(r2, `${prefix}p/${page}.idx`);
    if (!idx) throw new ReportInputError();
    const at = idx.value[id]; if (at) { spans.push({ page, at }); rowBytes += at[1]; }
  }
  // A rebuild leaf reads two days (the day and its carry-in), so its rows are bounded at two leaves' worth.
  if (rowBytes > 2 * STEP.leafRowBytes) throw new FoldStepBound('leaf', 2 * STEP.leafRowBytes, rowBytes);
  const entries: Entry[] = [];
  for (const s of spans) entries.push(...(JSON.parse(await readRange(r2, `${prefix}p/${s.page}.pack`, s.at[0], s.at[1])) as Entry[]));
  entries.sort((a, b) => a.p[0] - b.p[0] || a.p[1] - b.p[1]);
  const carry: DecisionRecord[] = [], decisions: DecisionRecord[] = [], outcomes: OutcomeRecord[] = [];
  const dayOf = (ts: number) => new Date(ts).toISOString().slice(0, 10);
  // Of the copies of one logical row, the one preferredOf keeps (R-P604, R-P629), as the hour's leaf keeps it.
  const kept = new Map<string, Entry>();
  for (const e of entries) { const key = `${e.s}|${e.id}`, prior = kept.get(key); if (!prior || preferredOf(e.r ?? e.o, prior.r ?? prior.o)) kept.set(key, e); }
  for (const e of kept.values()) {
    if (e.s === 'd') (dayOf(e.r!.ts) === job.date ? decisions : carry).push(e.r!);
    else if (dayOf(e.o!.ts) === job.date) outcomes.push(e.o!);
  }
  const tombs = await loadTombstones(r2 as never, p.tenant) as Map<string, Tombstone>;
  const visible = <T extends { visitor_id: string; ts: number }>(rows: T[]) => rows.filter(row => { const cut = tombs.get(row.visitor_id)?.erased_at; return cut === undefined || row.ts > cut; });
  const day = foldRetainedDay({ tenant: job.tenant, brand: job.brand, slot: job.slot, config: job.config, policy: job.policy, decisions: visible(decisions), outcomes: visible(outcomes),
    carry: visible(carry), at: job.at, ...(job.page ? { page: job.page } : {}) });
  await put(r2, `${prefix}l/${id}.json`, JSON.stringify({ stats: day.stats, decisions: day.decisions, outcomes: day.outcomes } satisfies RebuildPartial));
  const leaves = await readJson<string[]>(r2, `${prefix}leaves.json`);
  const done = (await listAll(r2, `${prefix}l/`)).length;
  if (leaves && done === leaves.value.length) await once(r2, p, 'm0', () => send(mergeLevel(p, 0, leaves.value.length)));
}
async function rebuildMerge(r2: R2Agg, p: Plan, level: number, group: number, send: Send): Promise<void> {
  const prefix = genPrefix(p.tenant, p.gen);
  const leaves = (await readJson<string[]>(r2, `${prefix}leaves.json`))!.value;
  let inputs = leaves.length; for (let l = 0; l < level; l++) inputs = Math.ceil(inputs / STEP.fanIn);
  const keys = Array.from({ length: Math.min(STEP.fanIn, inputs - group * STEP.fanIn) }, (_, i) => level === 0 ? `${prefix}l/${leaves[group * STEP.fanIn + i]}.json` : `${prefix}m/${level - 1}/${group * STEP.fanIn + i}.json`);
  const tau = p.rebuild!.config.stats.tauLearnMs;
  let total: RebuildPartial = { stats: emptyStats(), decisions: 0, outcomes: 0 };
  for (const key of keys) { const part = (await readJson<RebuildPartial>(r2, key))!.value; total = { stats: mergeStats(total.stats, part.stats, tau), decisions: total.decisions + part.decisions, outcomes: total.outcomes + part.outcomes }; }
  await put(r2, `${prefix}m/${level}/${group}.json`, JSON.stringify(total));
  const groups = Math.ceil(inputs / STEP.fanIn);
  const done = (await listAll(r2, `${prefix}m/${level}/`)).length;
  if (done < groups) return;
  if (groups === 1) await once(r2, p, 'close', () => send([{ kind: 'fold', v: 1, tenant: p.tenant, gen: p.gen, step: 'close' }]));
  else await once(r2, p, `m${level + 1}`, () => send(mergeLevel(p, level + 1, groups)));
}
async function rebuildClose(env: Env, r2: R2Agg, p: Plan): Promise<void> {
  const prefix = genPrefix(p.tenant, p.gen), job = p.rebuild!;
  const leaves = (await readJson<string[]>(r2, `${prefix}leaves.json`))?.value ?? [];
  let total: RebuildPartial = { stats: emptyStats(), decisions: 0, outcomes: 0 };
  if (leaves.length) {
    let inputs = leaves.length, level = 0;
    while (Math.ceil(inputs / STEP.fanIn) > 1) { inputs = Math.ceil(inputs / STEP.fanIn); level++; }
    total = (await readJson<RebuildPartial>(r2, `${prefix}m/${level}/0.json`))!.value;
  }
  const stub = env.LEARN_STATS!.get(env.LEARN_STATS!.idFromName(job.name));
  const answer = await stub.fetch('https://learn/rebuild-apply', { method: 'POST', body: JSON.stringify({ operationId: job.operationId, date: job.date, ...total }) });
  if (!answer.ok && answer.status !== 409) throw new Error('rebuild not applied');
}


// ── the custom-policy day past a page: a job on the same steps (R-P615) ──────────
// The date re-run hour by hour from the head's version at the date's start, under the learning policy and the
// request's policies, into the job's own namespace; its day summed one hour at a time from the job's hours.
export interface ReportJob { id: string; tenant: string; brand: string; date: string; digest: string; at: number; hours: number[]; learn: LearnConfig;
  policies: Array<ReturnType<typeof policiesOf>[number]> }
export interface JobState { version: 1; job: ReportJob; leaves: Record<string, string | null>; done: number; gen: string | null; status: 'running' | 'done' | 'refused'; refusal?: Record<string, unknown> }
const jobPrefix = (t: string, date: string, d: string) => `${foldPrefix(t)}jobs/${date}/${d}/`;
const dayStartKey = (t: string, date: string) => `${foldPrefix(t)}daystart/${date}.json`;
export const jobDigest = (brand: string, policies: unknown): Promise<string> => digest(stable({ brand, policies }));
export const jobLocation = (tenant: string, date: string, brand: string, d: string): string =>
  `/v1/${tenant}/learn/report?date=${date}&brand=${encodeURIComponent(brand)}&policy=${d}`;
export const progressOf = (j: JobState) => ({ id: j.job.id, status: j.status, hours: j.job.hours.length, done: j.done });
/** Is the day's ledger past one page (16 MiB or 200 objects)? */
export async function pastPage(env: Env, tenant: string, date: string): Promise<boolean> {
  let bytes = 0, n = 0;
  for (const o of await listAll(env.STORAGE as unknown as R2Agg, `${tenant}/${date}/`)) if (isLearningKey(o.key)) { bytes += o.size ?? 0; n++; }
  return bytes > STEP.pageBytes || n > STEP.pageObjects;
}
/** The job for this day, brand and policy set: the one already named, or a new one planned. */
export async function reportJob(env: Env, ids: { tenant: string; brand: string; date: string }, learn: LearnConfig, reporting: Array<{ name: string } & Record<string, unknown>>, now: number): Promise<JobState> {
  const r2 = env.STORAGE as unknown as R2Agg;
  const d = await jobDigest(ids.brand, reporting), key = `${jobPrefix(ids.tenant, ids.date, d)}job.json`;
  const held = await readJson<JobState>(r2, key);
  if (held) return held.value;
  const policies = [policiesOf(learn)[0]!, ...reporting.map(p => ({ ...p, role: 'reporting' as const }))] as ReportJob['policies'];
  const start = Date.UTC(Number(ids.date.slice(0, 4)), Number(ids.date.slice(5, 7)) - 1, Number(ids.date.slice(8, 10)));
  const hours = Array.from({ length: 24 }, (_, h) => h).filter(h => start + h * HOUR_MS <= now);
  const leaves = (await readJson<Record<string, string | null>>(r2, dayStartKey(ids.tenant, ids.date)))?.value
    ?? (await readHead(r2, ids.tenant)).head?.leaves ?? await legacyLeaves(r2, ids.tenant);
  const state: JobState = { version: 1, job: { id: crypto.randomUUID(), ...ids, digest: d, at: now, hours, learn, policies }, leaves, done: 0, gen: null, status: 'running' };
  if (!await put(r2, key, JSON.stringify(state), { etagDoesNotMatch: '*' })) return (await readJson<JobState>(r2, key))!.value;
  await jobNext(env, r2, key, state);
  return state;
}
export async function readJob(env: Env, ids: { tenant: string; brand: string; date: string }, d: string): Promise<{ state: JobState; day: unknown } | null> {
  const r2 = env.STORAGE as unknown as R2Agg, prefix = jobPrefix(ids.tenant, ids.date, d);
  const state = (await readJson<JobState>(r2, `${prefix}job.json`))?.value;
  if (!state || state.job.brand !== ids.brand) return null;
  return { state, day: state.status === 'done' ? (await readJson<unknown>(r2, `${prefix}day.json`))?.value ?? null : null };
}
async function jobNext(env: Env, r2: R2Agg, key: string, state: JobState): Promise<void> {
  const { job } = state;
  if (state.done >= job.hours.length) { await jobDay(env, r2, key); return; }
  const p = await plan(r2, job.tenant, job.learn, { date: job.date, hour: job.hours[state.done]! }, job.at, state.leaves, false, { key, policies: job.policies });
  const cur = await readJson<JobState>(r2, key);
  if (!cur || cur.value.done !== state.done || cur.value.gen !== null) return;
  if (!await put(r2, key, JSON.stringify({ ...cur.value, gen: p.gen }), { etagMatches: cur.etag })) return;
  await queueSend(env)(kickoff(p));
}
async function jobAdvance(env: Env, r2: R2Agg, p: Plan, states: Record<string, string | null>): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const cur = await readJson<JobState>(r2, p.job!.key);
    if (!cur || cur.value.gen !== p.gen) return; // already advanced
    const leaves = { ...cur.value.leaves };
    for (const [id, k] of Object.entries(states)) { if (k === null) delete leaves[id]; else leaves[id] = k; }
    const next: JobState = { ...cur.value, leaves, done: cur.value.done + 1, gen: null };
    if (await put(r2, p.job!.key, JSON.stringify(next), { etagMatches: cur.etag })) { await jobNext(env, r2, p.job!.key, next); return; }
  }
}
async function jobDay(env: Env, r2: R2Agg, key: string): Promise<void> {
  const cur = await readJson<JobState>(r2, key);
  if (!cur || cur.value.status !== 'running') return;
  const { job } = cur.value, prefix = key.slice(0, -'job.json'.length);
  const report = await I.jobDayFromHours(r2, `${prefix}h/`, { tenant: job.tenant, brand: job.brand, date: job.date }, job.learn, job.at);
  await put(r2, `${prefix}day.json`, JSON.stringify(report));
  await put(r2, key, JSON.stringify({ ...cur.value, status: 'done' }), { etagMatches: cur.etag });
}
async function jobRefuse(r2: R2Agg, p: Plan, refusal: Record<string, unknown>): Promise<void> {
  const cur = await readJson<JobState>(r2, p.job!.key);
  if (!cur || cur.value.gen !== p.gen) return;
  await put(r2, p.job!.key, JSON.stringify({ ...cur.value, status: 'refused', refusal }), { etagMatches: cur.etag });
}

/**
 * The next due hour of the lookback (oldest first, a missing hour or a stale one), planned unless a plan is in flight;
 * the quiet hours of a stateless tenant closed in place on the way. Called by the five-minute run and by each close, so
 * every due hour is folded in order without waiting for a run.
 */
async function planNextDue(env: Env, r2: R2Agg, tenant: string, learn: LearnConfig, now: number, send: Send): Promise<{ planned: string | null; datesBuilt: Map<string, Set<number>>; lateByDate: Map<string, Map<number, number>> }> {
  const { head, etag } = await readHead(r2, tenant);
  const datesBuilt = new Map<string, Set<number>>(), lateByDate = new Map<string, Map<number, number>>();
  if (!head || head.inflight) return { planned: null, datesBuilt, lateByDate };
  const candidates = closedHours(now, 26);
  const builtAt = new Map<number, number>();
  for (const c of candidates) {
    const stored = await I.readHourBody(r2, hourKey(tenant, c.date, c.hour));
    let fold = stored.body === null;
    if (!fold) {
      const verdict = await I.staleHour(r2, tenant, c, builtAt, false, 100_000, now);
      if (verdict.late) { try { await I.conditionalBody(r2, hourKey(tenant, c.date, c.hour), verdict.late.body, verdict.late.etag); } catch { /* next run */ } }
      if (!verdict.refold && verdict.lateObjects !== undefined) { const m = lateByDate.get(c.date) ?? new Map<number, number>(); m.set(c.hour, verdict.lateObjects); lateByDate.set(c.date, m); }
      fold = verdict.refold;
    }
    const refusedBasis = head.refused?.[`${c.date}/${pad2(c.hour)}`];
    if (fold && refusedBasis) {
      const listed = await I.listObjects(r2, `${tenant}/${c.date}/${pad2(c.hour)}/`);
      const keys = [...listed.keys()].filter(isLearningKey).sort((a, b) => (I.startOf(a) < I.startOf(b) ? -1 : I.startOf(a) > I.startOf(b) ? 1 : a < b ? -1 : 1));
      if (await digest(stable([keys.map(k => [k, listed.get(k)?.etag ?? null, listed.get(k)?.size ?? 0]), { date: c.date, hour: c.hour }])) === refusedBasis) fold = false;
    }
    if (fold && !Object.values(head.leaves).some(Boolean)
      && ![...(await I.listObjects(r2, `${tenant}/${c.date}/${pad2(c.hour)}/`)).keys()].some(isLearningKey)) {
      // A quiet hour of a tenant with no state takes no step: its (empty) aggregate is closed here, as the close would.
      const from = Date.UTC(Number(c.date.slice(0, 4)), Number(c.date.slice(5, 7)) - 1, Number(c.date.slice(8, 10)), c.hour);
      const agg: HourAggregate = { version: 1, generation: crypto.randomUUID(), tenant, date: c.date, hour: c.hour, from, to: from + HOUR_MS, builtAt: now, objects: 0, objectsRead: 0,
        truncated: false, horizonMs: DEFAULT_HORIZON_MS, shards: SHARDS, ringsFolded: true, recoveryFrom: 0, brands: {} };
      await put(r2, hourKey(tenant, c.date, c.hour), JSON.stringify(agg), stored.etag === null ? { etagDoesNotMatch: '*' } : { etagMatches: stored.etag });
      builtAt.set(from, now);
      const set = datesBuilt.get(c.date) ?? new Set<number>(); set.add(c.hour); datesBuilt.set(c.date, set);
      continue;
    }
    if (fold) {
      const p = await plan(r2, tenant, learn, c, now, head.leaves, false);
      if (!await writeHead(r2, tenant, { ...head, inflight: { gen: p.gen, date: c.date, hour: c.hour } }, etag)) return { planned: null, datesBuilt, lateByDate };
      // A quiet hour of a small state (no ledger object, at most 64 leaves) takes its bounded steps here, one after
      // another, rather than a queue hop each; an hour with rows, or a state past 64 leaves, takes them on the queue.
      if (!p.objects.length && Object.values(head.leaves).filter(Boolean).length <= SHARDS) {
        const inline: Send = async messages => { for (const m of messages) await runFoldStep(env, m, inline); };
        await inline(kickoff(p));
      } else await send(kickoff(p));
      return { planned: `${c.date}/${pad2(c.hour)}`, datesBuilt, lateByDate };
    }
    if (stored.body !== null || fold === false) { const s = datesBuilt.get(c.date) ?? new Set<number>(); if (stored.body !== null) s.add(c.hour); datesBuilt.set(c.date, s); }
  }
  return { planned: null, datesBuilt, lateByDate };
}
