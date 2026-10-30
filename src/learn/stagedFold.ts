// src/learn/stagedFold.ts — P104 (E29): the learning report's fold in fixed-size steps, each a message on the
// existing events queue: a plan (the five-minute run, or the close of the hour before), partition pages, leaves of
// visitors partitioned by rows (a leaf whose rows pass its bound is re-sectioned deeper by visitor hash, so every leaf
// holds at most its bound of rows), a merge tree, and a close committed by two conditional writes. Every step holds a
// bounded input (STEP) whatever the traffic; a step no partition depth brings within its bound (one visitor's rows past
// a leaf's) is refused by name (fold_step_bound), and a closed hour so refused is stored where the day reads it. The
// per-shard code of the one-request fold runs unchanged in each leaf (cleanupShard, foldableRows, hourBrands, foldShard,
// countMembership) and in the close (closeBrands); a merge combines its partials' statistics with mergeStats and never
// replays rows. The open hour, the custom-policy day past one page (a job, read by its policy digest) and the W24
// rebuild take the same steps.
//
// A generation's steps are delivered at least once and in any order: every step's output is written once and a step
// whose output stands does nothing again; a generation that is committed, refused or planned again carries a closed
// marker, after which its steps change nothing; and the versions a live generation names are never collected.
import type { DecisionRecord, LearnConfig } from '@/content/types';
import { foldRetainedDay, type SlotLearnConfig } from './fan';
import type { AttributionPolicy } from './policy';
import type { StatsState } from './stats';
import { createHash } from 'node:crypto';
import type { Env } from '@/types/env';
import { loadTombstones, type Tombstone } from '@/ledger/erasure';
import { logicalIdentity, LOGICAL_EXCLUDED_FIELDS, preferredCopy } from '@/ledger/delivery';
import { isLearningKey, type OutcomeRecord } from '@/ledger/records';
import { requireRetention, RetentionUnavailable, type RetentionEnv, type RetentionStamp } from '@/retention';
import { slotConfigsOf } from './route';
import { DEFAULT_STATS, emptyStats, type StatsConfig } from './stats';
import { ReportBudgetExceeded, ReportInputError, ReportRowConflict, ReportUnavailableError, rowShapeOf, type DuplicateWitness } from './report';
import {
  buildHour, cleanupHourlyState, closedHours, compactOf, foldHeadKey, foldShard, hourKey, hourOf, hourStart, HOUR_MS, mergeStats, openHours, openKey, openStateKey,
  policiesOf, REFOLD_MATURITY_MS, refusedHourKey, shardKey, SHARDS, RING_CAP, DEFAULT_HORIZON_MS, stagedInternals as I,
  type CompactDecision, type FoldContext, type HourAggregate, type HourBrand, type R2Agg, type ShardState,
} from './hourly';

const MiB = 1024 * 1024;
/**
 * Each step's fixed inputs (the work order's RF1): a partition page at most 16 MiB and 200 ledger objects; a leaf at
 * most 8 MiB of state and 8 MiB of rows; a merge at most 64 partials; abandoned outputs collected after 15 minutes; a
 * leaf's rows re-sectioned no deeper than `maxDepth`; a finished job's day and a finished rebuild's record kept `keepMs`.
 */
export const STEP = { pageBytes: 16 * MiB, pageObjects: 200, leafStateBytes: 8 * MiB, leafRowBytes: 8 * MiB, fanIn: 64, graceMs: 15 * 60_000, maxDepth: 20, keepMs: 24 * 3_600_000,
  /** What one step removes of the fold's own objects no live generation holds: a leaf, beside its fold; the five-minute run, beside its listing. */
  retire: { bytes: 16 * MiB, objects: 64 }, collect: { bytes: 16 * MiB, objects: 100 } } as const;
export class FoldStepBound extends Error {
  readonly code = 'fold_step_bound';
  constructor(readonly step: 'partition' | 'leaf' | 'merge' | 'close' | 'day', readonly limit: number, readonly observed: number) { super('fold step past its bound'); }
}
/** A ledger object the plan named is gone (the erasure rewrite deletes an object it empties): the generation is planned again from a fresh listing. */
class PlanStale extends Error { constructor() { super('a planned ledger object is gone'); } }
/** An output of the generation's own earlier step is missing: the step is delivered again (never read as empty). */
class FoldOutputMissing extends Error { constructor(what: string) { super(`fold output missing: ${what}`); } }
/** The hour's aggregate as built is not one the day can read (its shape): refused as its inputs give it, never retried. */
class AggregateInvalid extends Error { readonly code = 'aggregate_invalid'; constructor() { super('hour aggregate invalid'); } }
/** The minutes a refusal that may pass (retention unavailable) waits before a five-minute run plans its hour again. */
const RETRY_MS = 5 * 60_000;

export interface FoldMessage {
  kind: 'fold'; v: 1; tenant: string; gen: string; step: 'partition' | 'leaves' | 'resect' | 'leaf' | 'merge' | 'close';
  page?: number; leaf?: string; level?: number; group?: number; round?: number;
  /** A leaf's share of the fold's own objects no live generation holds, which it removes beside its fold. */
  retire?: string[];
}
export const isFoldMessage = (b: unknown): b is FoldMessage => !!b && typeof b === 'object' && (b as { kind?: unknown }).kind === 'fold';
type Send = (messages: FoldMessage[]) => Promise<void>;
/** The steps sent on the events queue, at most 100 messages a sendBatch as the platform allows. */
export const queueSend = (env: Pick<Env, 'EVENT_QUEUE'>): Send => async messages => {
  for (let i = 0; i < messages.length; i += 100) await env.EVENT_QUEUE.sendBatch(messages.slice(i, i + 100).map(body => ({ body, contentType: 'json' as const })));
};

const foldPrefix = (t: string) => `aggregates/${t}/fold/`;
const headKey = foldHeadKey;
const genPrefix = (t: string, gen: string) => `${foldPrefix(t)}g/${gen}/`;
const closedKey = (t: string, gen: string) => `${genPrefix(t, gen)}closed`;
const rebuildKey = (t: string, operationId: string) => `${foldPrefix(t)}rebuilds/${operationId}.json`;
const pad2 = (n: number) => String(n).padStart(2, '0');

interface Inflight { gen: string; date: string; hour: number }
interface Head { version: 1; seq: number; leaves: Record<string, string | null>; inflight: Inflight | null; open: Inflight | null; refused?: Record<string, string> }
interface Plan {
  version: 1; tenant: string; gen: string; date: string; hour: number; open: boolean; now: number; refold: boolean; aggregateEtag: string | null;
  objects: Array<{ key: string; etag: string | null; size: number }>; pages: Array<[number, number]>; leaves: Record<string, string | null>;
  learn: LearnConfig; basis: string;
  /**
   * R-P660, R-P684: the depth the hour's rows are first sectioned at — deep enough that a leaf's average share of the
   * hour's ledger stays within 6 MiB (of its 8 MiB of rows); a leaf whose rows still pass its bound is re-sectioned
   * deeper (`resect`), so every leaf of the hour holds at most 8 MiB of rows.
   */
  rowDepth?: number;
  /** The W24 rebuild of one slot from one retained day, on the same steps. */
  rebuild?: RebuildJob;
  /** R-P615: an hour of a custom-policy day job (its state record, the policies it folds under). */
  job?: { key: string; policies: Array<ReturnType<typeof policiesOf>[number]> };
  /** A job's warm-up hour (the horizon before its day): its rings are folded, its aggregate is not the day's. */
  warm?: boolean;
}
export interface RebuildJob { tenant: string; brand: string; slot: string; page?: string; date: string; before: string; at: number; operationId: string; config: SlotLearnConfig; policy: AttributionPolicy; name: string }
/** A staged rebuild under its own identity (its operation id): the generation it runs, and how it ended. */
interface RebuildRecord { version: 1; job: RebuildJob; gen: string; status: 'running' | 'applied' | 'superseded' | 'refused'; refusal?: Record<string, unknown>; finishedAt?: number }
interface Entry { p: [number, number]; s: 'd' | 'o'; id: string; g: string; l: boolean; c?: CompactDecision; o?: OutcomeRecord; r?: DecisionRecord }
/**
 * One section of a pack: its byte range, the number of distinct visitor hashes its rows carry, and that hash where it
 * is one (a section of one visitor's rows cannot be split by any depth).
 */
type Span = [number, number, number, string?];
type Index = Record<string, Span>;
/** A round of re-sectioning: each leaf past its rows bound and the depth it is re-sectioned at, and the (leaf, page) sections to re-section. */
interface Round { leaves: Record<string, number>; outputs: Array<[string, number]> }
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
const modulus = (depth: number) => SHARDS * 2 ** depth;
function fnv(visitor: string): number { let h = 0x811c9dc5; for (let i = 0; i < visitor.length; i++) { h ^= visitor.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h; }
const hex8 = (h: number) => h.toString(16).padStart(8, '0');
/** The head's leaf holding a visitor hash: the head's leaves partition the hash space, so exactly one of its ancestors is named. */
function leafOfHash(leaves: Record<string, string | null>, h: number): string {
  for (let depth = 0; depth <= STEP.maxDepth + 4; depth++) { const id = leafId(depth, h % modulus(depth)); if (Object.hasOwn(leaves, id)) return id; }
  return leafId(0, h % SHARDS);
}
export const leafOf = (leaves: Record<string, string | null>, visitor: string): string => leafOfHash(leaves, fnv(visitor));
/** The leaf ids of `id`'s ancestors, nearest first. */
function ancestors(id: string): string[] {
  const { depth, residue } = parseLeaf(id), out: string[] = [];
  for (let d = depth - 1; d >= 0; d--) out.push(leafId(d, residue % modulus(d)));
  return out;
}
/** Every descendant of `id` at `depth`. */
function descendants(id: string, depth: number): string[] {
  const at = parseLeaf(id), out: string[] = [];
  for (let j = 0; j < 2 ** (depth - at.depth); j++) out.push(leafId(depth, at.residue + j * modulus(at.depth)));
  return out;
}

// ── storage helpers ────────────────────────────────────────────────────────────
type Listed = { key: string; size?: number; etag?: string; uploaded?: Date };
async function readJson<T>(r2: R2Agg, key: string): Promise<{ value: T; etag: string } | null> {
  const got = await r2.get(key) as { text(): Promise<string>; etag: string } | null;
  if (!got) return null;
  return { value: JSON.parse(await got.text()) as T, etag: got.etag };
}
/** An object's identity and metadata without its body (R2's head; a get whose body is left unread where a store has no head). */
async function headOf(r2: R2Agg, key: string): Promise<{ etag: string; customMetadata?: Record<string, string> } | null> {
  const store = r2 as unknown as { head?(k: string): Promise<{ etag: string; customMetadata?: Record<string, string> } | null> };
  if (typeof store.head === 'function') return store.head(key);
  const got = await r2.get(key) as { etag: string; customMetadata?: Record<string, string>; body?: { cancel?(): unknown } | null } | null;
  if (got) { try { await got.body?.cancel?.(); } catch { /* its body is not read */ } }
  return got;
}
const exists = async (r2: R2Agg, key: string) => (await headOf(r2, key)) !== null;
async function readRange(r2: R2Agg, key: string, offset: number, length: number): Promise<string> {
  const got = await (r2 as unknown as { get(k: string, o: unknown): Promise<{ text(): Promise<string> } | null> }).get(key, { range: { offset, length } });
  if (!got) throw new FoldOutputMissing(key);
  return got.text();
}
/** Every object under a prefix, a page of the listing at a time (never the whole listing held). */
async function eachListed(r2: R2Agg, prefix: string, visit: (o: Listed) => Promise<boolean | void> | boolean | void): Promise<boolean> {
  let cursor: string | undefined;
  do {
    const page = await r2.list({ prefix, cursor, limit: 1000 }) as { objects: Listed[]; truncated: boolean; cursor?: string };
    for (const o of page.objects) if (await visit(o) === false) return false;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return true;
}
async function listKeys(r2: R2Agg, prefix: string): Promise<Set<string>> {
  const out = new Set<string>();
  await eachListed(r2, prefix, o => { out.add(o.key); });
  return out;
}
const put = (r2: R2Agg, key: string, body: string, onlyIf?: unknown, customMetadata?: Record<string, string>) =>
  r2.put(key, body, { ...(onlyIf ? { onlyIf } : {}), httpMetadata: { contentType: 'application/json' }, ...(customMetadata ? { customMetadata } : {}) });
const del = (r2: R2Agg, key: string) => (r2 as unknown as { delete(k: string): Promise<void> }).delete(key);
/** The first step to reach a fan-out sends it: a create-only marker; one whose send was lost is found by the five-minute run's resume. */
async function once(r2: R2Agg, p: { tenant: string; gen: string }, name: string, send: () => Promise<void>): Promise<void> {
  if (await put(r2, `${genPrefix(p.tenant, p.gen)}sent/${name}`, '1', { etagDoesNotMatch: '*' })) await send();
}
const msg = (p: { tenant: string; gen: string }, x: Partial<FoldMessage>): FoldMessage => ({ kind: 'fold', v: 1, tenant: p.tenant, gen: p.gen, ...x } as FoldMessage);
const closeMarker = (r2: R2Agg, p: { tenant: string; gen: string }) => put(r2, closedKey(p.tenant, p.gen), '1');

async function readHead(r2: R2Agg, tenant: string): Promise<{ head: Head | null; etag: string | null }> {
  const got = await readJson<Head>(r2, headKey(tenant));
  return got ? { head: got.value, etag: got.etag } : { head: null, etag: null };
}
/** The depth-0 leaves of a store today's code wrote: its 64 shards, as they stand. */
async function legacyLeaves(r2: R2Agg, tenant: string): Promise<Record<string, string | null>> {
  const present = await listKeys(r2, `aggregates/${tenant}/rings/`);
  return Object.fromEntries(Array.from({ length: SHARDS }, (_, r) => [leafId(0, r), present.has(shardKey(tenant, r)) ? shardKey(tenant, r) : null]));
}
/** A refused hour as the head names it: the basis it was refused on, or, for a refusal that may pass, the time it is tried again. */
const RETRY = 'retry@';
const refusedMark = (basis: string, retryAt: number | null) => (retryAt === null ? basis : `${RETRY}${retryAt}`);
/** The refusals of the lookback only: an older hour is never planned again, so its basis is not kept. */
function recentRefused(refused: Record<string, string> | undefined, now: number): Record<string, string> | undefined {
  if (!refused) return undefined;
  const floor = now - 27 * HOUR_MS, kept = Object.entries(refused).filter(([at]) => hourStart(at.slice(0, 10), Number(at.slice(11, 13))) >= floor);
  return kept.length ? Object.fromEntries(kept) : undefined;
}
async function writeHead(r2: R2Agg, tenant: string, head: Head, etag: string | null): Promise<boolean> {
  const { refused, ...rest } = head, kept = recentRefused(refused, Date.now());
  return !!(await put(r2, headKey(tenant), JSON.stringify({ ...rest, ...(kept ? { refused: kept } : {}) }), etag === null ? { etagDoesNotMatch: '*' } : { etagMatches: etag }));
}

// ── an hour aggregate's facts, from its metadata (never its body, where the staged fold wrote it) ───────────────
interface HourFacts { generation: string | null; objects: number; objectsRead: number; builtAt: number; truncated: boolean; lateObjects: number; etag: string }
const factsMeta = (a: { generation?: string | null; objects: number; objectsRead: number; builtAt: number; truncated: boolean; lateObjects?: number }): Record<string, string> =>
  ({ fold: '1', generation: a.generation ?? '', objects: String(a.objects), objectsRead: String(a.objectsRead), builtAt: String(a.builtAt), truncated: a.truncated ? '1' : '0',
    lateObjects: String(a.lateObjects ?? 0) });
async function hourFacts(r2: R2Agg, key: string): Promise<HourFacts | null> {
  const head = await headOf(r2, key);
  if (!head) return null;
  const m = head.customMetadata;
  if (m?.fold === '1') return { generation: m.generation || null, objects: Number(m.objects), objectsRead: Number(m.objectsRead), builtAt: Number(m.builtAt),
    truncated: m.truncated === '1', lateObjects: Number(m.lateObjects) || 0, etag: head.etag };
  // An aggregate the one-request fold wrote carries no metadata: its body, once.
  const stored = await I.readHourBody(r2, key);
  if (stored.body === null) return null;
  const a = JSON.parse(stored.body) as { generation?: string; objects?: number; objectsRead?: number; builtAt?: number; truncated?: boolean; lateObjects?: number };
  return { generation: a.generation ?? null, objects: Number(a.objects ?? 0), objectsRead: Number(a.objectsRead ?? a.objects ?? 0), builtAt: Number(a.builtAt ?? 0),
    truncated: a.truncated === true, lateObjects: Number.isSafeInteger(a.lateObjects) ? Number(a.lateObjects) : 0, etag: stored.etag! };
}

// ── plan (the five-minute run, a close, a job, a rebuild) ────────────────────────
const byStart = (a: string, b: string) => (I.startOf(a) < I.startOf(b) ? -1 : I.startOf(a) > I.startOf(b) ? 1 : a < b ? -1 : 1);
async function hourObjects(r2: R2Agg, tenant: string, at: { date: string; hour: number }): Promise<Plan['objects']> {
  const listed = await I.listObjects(r2, `${tenant}/${at.date}/${pad2(at.hour)}/`);
  return [...listed.keys()].filter(isLearningKey).sort(byStart).map(key => ({ key, etag: listed.get(key)?.etag ?? null, size: listed.get(key)?.size ?? 0 }));
}
const basisOf = (objects: Plan['objects'], at: { date: string; hour: number }) => digest(stable([objects.map(o => [o.key, o.etag, o.size]), { date: at.date, hour: at.hour }]));
function pagesOf(objects: Plan['objects']): Array<[number, number]> {
  const pages: Array<[number, number]> = [];
  let start = 0, bytes = 0;
  for (let i = 0; i < objects.length; i++) {
    if (i > start && (bytes + objects[i]!.size > STEP.pageBytes || i - start >= STEP.pageObjects)) { pages.push([start, i]); start = i; bytes = 0; }
    bytes += objects[i]!.size;
  }
  if (objects.length) pages.push([start, objects.length]);
  return pages;
}
async function plan(r2: R2Agg, tenant: string, learn: LearnConfig, at: { date: string; hour: number }, now: number, leaves: Record<string, string | null>, open: boolean,
  job?: Plan['job'], warm?: boolean): Promise<Plan> {
  const objects = await hourObjects(r2, tenant, at);
  let refold = false, aggregateEtag: string | null = null;
  if (!open && !job) {
    const facts = await hourFacts(r2, hourKey(tenant, at.date, at.hour));
    aggregateEtag = facts?.etag ?? null;
    if (facts) refold = objects.length > facts.objects || objects.length > facts.objectsRead;
  }
  const gen = crypto.randomUUID();
  const p: Plan = { version: 1, tenant, gen, date: at.date, hour: at.hour, open, now, refold, aggregateEtag, objects, pages: pagesOf(objects), leaves, learn,
    basis: await basisOf(objects, at), rowDepth: rowDepthOf(objects), ...(job ? { job } : {}), ...(warm ? { warm } : {}) };
  await put(r2, `${genPrefix(tenant, gen)}plan.json`, JSON.stringify(p), { etagDoesNotMatch: '*' });
  return p;
}
const kickoff = (p: Plan): FoldMessage[] => p.pages.length ? p.pages.map((_, page) => msg(p, { step: 'partition', page })) : [msg(p, { step: 'leaves' })];

// ── the steps ─────────────────────────────────────────────────────────────────
export async function runFoldStep(env: Env, m: FoldMessage, send: Send): Promise<void> {
  const r2 = env.STORAGE as unknown as R2Agg;
  const stored = await readJson<Plan>(r2, `${genPrefix(m.tenant, m.gen)}plan.json`);
  if (!stored) return; // an abandoned generation, already collected
  const p = stored.value;
  // A generation committed, refused or planned again takes no further step: a step delivered after that changes nothing.
  if (m.step !== 'close' && await exists(r2, closedKey(p.tenant, p.gen))) return;
  try {
    if (m.step === 'partition') await partition(r2, p, m.page!, send);
    else if (m.step === 'leaves') await fanLeaves(r2, p, send);
    else if (m.step === 'resect') await resect(r2, p, m.leaf!, m.page!, m.round!, send);
    else if (m.step === 'leaf') {
      await (p.rebuild ? rebuildLeaf(r2, p, m.leaf!, send) : leaf(env, r2, p, m.leaf!, send));
      for (const key of m.retire ?? []) await del(r2, key);
    }
    else if (m.step === 'merge') await (p.rebuild ? rebuildMerge(r2, p, m.level!, m.group!, send) : merge(r2, p, m.level!, m.group!, send));
    else if (m.step === 'close') await (p.rebuild ? rebuildClose(env, r2, p) : close(env, r2, p));
  } catch (error) {
    if (error instanceof PlanStale) { await restart(env, r2, p); return; }
    // R-P702: what the same inputs give again (a step's bound, a report budget, an input or an aggregate the day cannot
    // read) is refused by name and stored where the day reads it, and the fold goes on; what may pass (retention
    // unavailable) is named the same way and tried again at a later run; anything else (storage) is delivered again.
    // A closed hour's unfiled conflict waits for its filing, as today's fold waits (RF3).
    // (A conflict is a ReportInputError too, but it waits for its filing: it is never settled here.)
    const settled = error instanceof FoldStepBound || error instanceof ReportBudgetExceeded || error instanceof AggregateInvalid
      || (error instanceof ReportInputError && !(error instanceof ReportRowConflict));
    const passing = error instanceof RetentionUnavailable;
    if (!settled && !passing && !(p.open && error instanceof ReportRowConflict)) throw error;
    const refusal = refusalOf(error, p.now);
    if (p.rebuild) await rebuildRefuse(r2, p, refusal);
    else if (p.job) await jobRefuse(r2, p, refusal);
    else await refuse(env, r2, p, refusal, passing ? Date.now() + RETRY_MS : null);
  }
}
function refusalOf(error: unknown, at: number): Record<string, unknown> {
  return error instanceof FoldStepBound ? { at, error: error.message, code: error.code, step: error.step, limit: error.limit, observed: error.observed }
    : error instanceof ReportRowConflict ? { at, error: error.message, code: error.code, conflict: { stream: error.stream } }
      : error instanceof ReportBudgetExceeded ? { at, error: error.message, code: error.code, budget: error.budget, limit: error.limit, observed: error.observed }
        : error instanceof AggregateInvalid ? { at, error: error.message, code: error.code }
          : error instanceof RetentionUnavailable ? { at, error: 'retention unavailable', code: 'retention_unavailable' }
            : { at, error: 'report input invalid', code: 'report_input_invalid' };
}
/** The close's check of the hour's aggregate: a shape the day cannot read is AggregateInvalid; a budget past is itself. */
function prepared(p: Plan, body: string): void {
  try { I.preparedAggregate(body, p.tenant, { date: p.date, hour: p.hour }, I.buildOptions({}), p.learn); }
  catch (error) { throw error instanceof ReportUnavailableError ? new AggregateInvalid() : error; }
}

async function partition(r2: R2Agg, p: Plan, page: number, send: Send): Promise<void> {
  const prefix = genPrefix(p.tenant, p.gen);
  if (!await exists(r2, `${prefix}p/${page}.idx`)) {
    const [from, to] = p.pages[page]!;
    let size = 0;
    for (let i = from; i < to; i++) size += p.objects[i]!.size;
    if (size > STEP.pageBytes && to - from === 1) throw new FoldStepBound('partition', STEP.pageBytes, size);
    // Each row as one line of its leaf's section, led by its visitor's hash, so a section can be re-sectioned without parsing it.
    const sections = new Map<string, { lines: string[]; hashes: Set<number> }>();
    for (let i = from; i < to; i++) {
      const o = p.objects[i]!;
      const got = await r2.get(o.key) as { text(): Promise<string> } | null;
      if (!got) throw new PlanStale();
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
        const h = fnv(String(row.visitor_id)), leafKey = rowLeaf(p, h);
        let section = sections.get(leafKey);
        if (!section) sections.set(leafKey, section = { lines: [], hashes: new Set() });
        section.lines.push(hex8(h) + ' ' + JSON.stringify(entry)); section.hashes.add(h);
      }
    }
    const index: Index = {}, parts: string[] = [];
    let at = 0;
    for (const leafKey of [...sections.keys()].sort()) {
      const { lines, hashes } = sections.get(leafKey)!, body = lines.join('\n') + '\n', n = bytesOf(body);
      index[leafKey] = hashes.size === 1 ? [at, n, 1, hex8([...hashes][0]!)] : [at, n, hashes.size]; at += n; parts.push(body);
    }
    sections.clear();
    await put(r2, `${prefix}p/${page}.pack`, parts.join(''));
    await put(r2, `${prefix}p/${page}.idx`, JSON.stringify(index));
  }
  let done = 0;
  await eachListed(r2, `${prefix}p/`, o => { if (o.key.endsWith('.idx')) done++; });
  if (done === p.pages.length) await once(r2, p, 'leaves-0', () => send([msg(p, { step: 'leaves' })]));
}

/** The depth an hour's rows are first sectioned at: each of its 64·2^d leaves' average share within 6 MiB (R-P660). */
function rowDepthOf(objects: Array<{ size: number }>): number {
  const bytes = objects.reduce((n, o) => n + o.size, 0);
  let depth = 0;
  while (depth < 12 && bytes / modulus(depth) > STEP.leafRowBytes * 0.75) depth++;
  return depth;
}
/** The leaf a row of the hour is sectioned into: its visitor's leaf of the head, or at the hour's row depth when that is deeper. */
function rowLeaf(p: Plan, h: number): string {
  const found = leafOfHash(p.leaves, h), depth = p.rowDepth ?? 0;
  return parseLeaf(found).depth >= depth ? found : leafId(depth, h % modulus(depth));
}
/** The head's leaf whose state a leaf of this hour starts from: itself, or the ancestor split for the hour. */
function stateSource(p: Plan, id: string): string | null {
  if (p.leaves[id]) return id;
  for (const anc of ancestors(id)) if (p.leaves[anc]) return anc;
  return null;
}
async function readRounds(r2: R2Agg, p: Plan): Promise<Round[]> {
  const prefix = genPrefix(p.tenant, p.gen), rounds: Round[] = [];
  for (let k = 0; ; k++) { const got = await readJson<Round>(r2, `${prefix}rounds/${k}.json`); if (!got) return rounds; rounds.push(got.value); }
}
/**
 * Where the rows of leaf `id` lie in page `page`: its own section of the page's pack, or, where an ancestor's section was
 * re-sectioned toward it, its section of that re-section; null where the page holds none of its rows.
 */
async function sectionOf(r2: R2Agg, p: Plan, id: string, page: number, resected: ReadonlySet<string>, main?: Index): Promise<{ key: string; span: Span } | null> {
  const prefix = genPrefix(p.tenant, p.gen);
  const inIndex = (idx: Index) => (Object.hasOwn(idx, id) ? id : ancestors(id).find(a => Object.hasOwn(idx, a)) ?? null);
  const idx = main ?? (await readJson<Index>(r2, `${prefix}p/${page}.idx`))?.value;
  if (!idx) throw new FoldOutputMissing(`p/${page}.idx`);
  let key = inIndex(idx);
  if (key === null) return null;
  let where = { key: `${prefix}p/${page}.pack`, span: idx[key]! };
  while (key !== id) {
    if (!resected.has(key)) return null;
    const sub = (await readJson<Index>(r2, `${prefix}r/${key}/${page}.idx`))?.value;
    if (!sub) throw new FoldOutputMissing(`r/${key}/${page}.idx`);
    const next: string | null = inIndex(sub);
    if (next === null) return null;
    where = { key: `${prefix}r/${key}/${page}.pack`, span: sub[next]! };
    key = next;
  }
  return where;
}
/** A leaf's rows: its sections of every page, read by range. */
async function rowsOf(r2: R2Agg, p: Plan, id: string): Promise<Entry[]> {
  const rounds = await readRounds(r2, p), resected = new Set(rounds.flatMap(r => Object.keys(r.leaves)));
  const spans: Array<{ key: string; span: Span }> = [];
  let rowBytes = 0;
  for (let page = 0; page < p.pages.length; page++) {
    const where = await sectionOf(r2, p, id, page, resected);
    if (where) { spans.push(where); rowBytes += where.span[1]; }
  }
  if (rowBytes > STEP.leafRowBytes) throw new FoldStepBound('leaf', STEP.leafRowBytes, rowBytes);
  const entries: Entry[] = [];
  for (const s of spans) for (const line of (await readRange(r2, s.key, s.span[0], s.span[1])).split('\n')) if (line) entries.push(JSON.parse(line.slice(9)) as Entry);
  return entries.sort((a, b) => a.p[0] - b.p[0] || a.p[1] - b.p[1]);
}

/**
 * The hour's leaves, once every page is sectioned: a leaf whose rows pass its bound is re-sectioned deeper by visitor
 * hash (a round of `resect` steps, then this step again), so the hour folds at the depth that keeps every leaf within
 * its rows bound; a leaf of one visitor's rows past it is refused by name, since no depth divides it (R-P684).
 */
async function fanLeaves(r2: R2Agg, p: Plan, send: Send): Promise<void> {
  const prefix = genPrefix(p.tenant, p.gen);
  const listed = await readJson<string[]>(r2, `${prefix}leaves.json`);
  if (listed) { await sendLeaves(r2, p, listed.value, send); return; }
  const rounds = await readRounds(r2, p);
  // Every section of the hour, after the re-sectioning rounds so far: leaf → its sections, page by page.
  const sections = new Map<string, Array<{ page: number; span: Span }>>();
  const add = (id: string, page: number, span: Span) => { const list = sections.get(id) ?? []; list.push({ page, span }); sections.set(id, list); };
  for (let page = 0; page < p.pages.length; page++) {
    const idx = await readJson<Index>(r2, `${prefix}p/${page}.idx`);
    if (!idx) throw new FoldOutputMissing(`p/${page}.idx`);
    for (const [id, span] of Object.entries(idx.value)) add(id, page, span);
  }
  for (const round of rounds) for (const resected of Object.keys(round.leaves)) {
    const at = sections.get(resected) ?? [];
    sections.delete(resected);
    for (const { page } of at) {
      const sub = await readJson<Index>(r2, `${prefix}r/${resected}/${page}.idx`);
      if (!sub) throw new FoldOutputMissing(`r/${resected}/${page}.idx`);
      for (const [id, span] of Object.entries(sub.value)) add(id, page, span);
    }
  }
  const over: Record<string, number> = {}, outputs: Array<[string, number]> = [];
  for (const [id, at] of sections) {
    const bytes = at.reduce((n, s) => n + s.span[1], 0);
    if (bytes <= STEP.leafRowBytes) continue;
    const { depth } = parseLeaf(id), hashes = new Set(at.map(s => (s.span[2] === 1 ? s.span[3] : '*')));
    if ((hashes.size === 1 && !hashes.has('*')) || depth >= STEP.maxDepth) throw new FoldStepBound('leaf', STEP.leafRowBytes, bytes);
    over[id] = Math.min(STEP.maxDepth, depth + Math.max(1, Math.ceil(Math.log2(bytes / (STEP.leafRowBytes * 0.75)))));
    for (const s of at) outputs.push([id, s.page]);
  }
  if (outputs.length) {
    const k = rounds.length, key = `${prefix}rounds/${k}.json`;
    await put(r2, key, JSON.stringify({ leaves: over, outputs } satisfies Round), { etagDoesNotMatch: '*' });
    const round = (await readJson<Round>(r2, key))!.value;
    await once(r2, p, `resect-${k}`, () => send(round.outputs.map(([leaf, page]) => msg(p, { step: 'resect', leaf, page, round: k }))));
    return;
  }
  // The leaves of the hour: every leaf holding state (split to the row depth, and with every re-sectioning, so the head
  // stays a partition), and every leaf holding rows.
  const ids = new Set<string>();
  for (const [id, key] of Object.entries(p.leaves)) {
    if (key === null) continue;
    const { depth } = parseLeaf(id), target = p.rowDepth ?? 0;
    for (const d of depth >= target ? [id] : descendants(id, target)) ids.add(d);
  }
  for (const round of rounds) for (const [resected, depth] of Object.entries(round.leaves)) if (ids.delete(resected)) for (const d of descendants(resected, depth)) ids.add(d);
  for (const id of sections.keys()) ids.add(id);
  // In today's shard order (residue, then depth), so a depth-0 hour merges its leaves as today's fold visits its shards.
  const leaves = [...ids].sort((a, b) => { const x = parseLeaf(a), y = parseLeaf(b); return (x.residue % SHARDS) - (y.residue % SHARDS) || x.depth - y.depth || x.residue - y.residue; });
  await put(r2, `${prefix}leaves.json`, JSON.stringify(leaves), { etagDoesNotMatch: '*' });
  await sendLeaves(r2, p, (await readJson<string[]>(r2, `${prefix}leaves.json`))!.value, send);
}
async function sendLeaves(r2: R2Agg, p: Plan, leaves: string[], send: Send): Promise<void> {
  if (!leaves.length) { await once(r2, p, 'close', () => send([msg(p, { step: 'close' })])); return; }
  await once(r2, p, 'leaf', async () => {
    // The fold's own objects no live generation holds (the hour before's working objects, the versions its commit
    // superseded), shared among the hour's leaves, each removing at most its share beside its own fold: no step removes
    // more than a bounded share, whatever the tenant's state.
    const { stale } = await staleObjects(r2, p.tenant, Date.now(), { bytes: leaves.length * STEP.retire.bytes, objects: Math.min(leaves.length * STEP.retire.objects, leaves.length * 4 + 1000) });
    // Dealt round the leaves in turn, so each leaf's share is about the same (a leaf whose share is full is passed over).
    const shares = leaves.map(() => ({ keys: [] as string[], bytes: 0 }));
    const full = (x: { keys: string[]; bytes: number }, size: number) => x.keys.length >= STEP.retire.objects || (x.keys.length > 0 && x.bytes + size > STEP.retire.bytes);
    let at = 0;
    for (const o of stale) {
      let tries = 0;
      while (tries < shares.length && full(shares[at]!, o.size)) { at = (at + 1) % shares.length; tries++; }
      if (tries >= shares.length) break;
      shares[at]!.keys.push(o.key); shares[at]!.bytes += o.size; at = (at + 1) % shares.length;
    }
    await send(leaves.map((leaf, i) => msg(p, { step: 'leaf', leaf, ...(shares[i]!.keys.length ? { retire: shares[i]!.keys } : {}) })));
  });
}

/** One section of a leaf past its rows bound, re-sectioned at the round's depth by the hash each line leads with (never parsed). */
async function resect(r2: R2Agg, p: Plan, id: string, page: number, k: number, send: Send): Promise<void> {
  const prefix = genPrefix(p.tenant, p.gen);
  const rounds = await readRounds(r2, p), round = rounds[k];
  if (!round) throw new FoldOutputMissing(`rounds/${k}.json`);
  if (!await exists(r2, `${prefix}r/${id}/${page}.idx`)) {
    const depth = round.leaves[id]!, earlier = new Set(rounds.slice(0, k).flatMap(r => Object.keys(r.leaves)));
    const where = await sectionOf(r2, p, id, page, earlier);
    const children = new Map<string, { lines: string[]; hashes: Set<number> }>();
    if (where) {
      const text = await readRange(r2, where.key, where.span[0], where.span[1]);
      let offset = 0;
      while (offset < text.length) {
        const end = text.indexOf('\n', offset), line = text.slice(offset, end < 0 ? text.length : end); offset = end < 0 ? text.length : end + 1;
        if (!line) continue;
        const h = parseInt(line.slice(0, 8), 16), child = leafId(depth, h % modulus(depth));
        let c = children.get(child);
        if (!c) children.set(child, c = { lines: [], hashes: new Set() });
        c.lines.push(line); c.hashes.add(h);
      }
    }
    const index: Index = {}, parts: string[] = [];
    let at = 0;
    for (const child of [...children.keys()].sort()) {
      const { lines, hashes } = children.get(child)!, body = lines.join('\n') + '\n', n = bytesOf(body);
      index[child] = hashes.size === 1 ? [at, n, 1, hex8([...hashes][0]!)] : [at, n, hashes.size]; at += n; parts.push(body);
    }
    children.clear();
    await put(r2, `${prefix}r/${id}/${page}.pack`, parts.join(''));
    await put(r2, `${prefix}r/${id}/${page}.idx`, JSON.stringify(index));
  }
  const present = await listKeys(r2, `${prefix}r/`);
  if (round.outputs.every(([leaf, pg]) => present.has(`${prefix}r/${leaf}/${pg}.idx`))) await once(r2, p, `leaves-${k + 1}`, () => send([msg(p, { step: 'leaves' })]));
}

function splitState(state: ShardState, id: string): Array<{ id: string; state: ShardState }> {
  const { depth, residue } = parseLeaf(id), mod = modulus(depth + 1);
  const children = [residue, residue + modulus(depth)].map(r => ({ id: leafId(depth + 1, r), r, state: JSON.parse(JSON.stringify({ ...state, rings: {}, seen: {}, seenAt: undefined, seenRetention: undefined, seenDays: undefined, seenDaysRetention: undefined, enrollment: undefined, deferred: undefined })) as ShardState }));
  const pick = (visitor: string) => children.find(c => fnv(visitor) % mod === c.r)!.state;
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
  // A leaf whose partial stands has folded: delivered again, it folds nothing again (its state version is never rewritten).
  if (!await exists(r2, `${prefix}l/${id}.json`)) await foldLeaf(env, r2, p, id);
  const leaves = await readJson<string[]>(r2, `${prefix}leaves.json`);
  let done = 0;
  await eachListed(r2, `${prefix}l/`, () => { done++; });
  if (leaves && done === leaves.value.length) await once(r2, p, 'm0', () => send(mergeLevel(p, 0, leaves.value.length)));
}
async function foldLeaf(env: Env, r2: R2Agg, p: Plan, id: string): Promise<void> {
  const prefix = genPrefix(p.tenant, p.gen);
  const entries = await rowsOf(r2, p, id);
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
      const where = p.objects[e.p[0]]!, got = await r2.get(where.key) as { text(): Promise<string> } | null;
      const row = got ? JSON.parse((await got.text()).split('\n')[e.p[1]] ?? '{}') as Record<string, unknown> : {};
      if (!p.job) throw new ReportRowConflict(stream, e.id, row);
      const { captureReadConflict } = await import('@/ledger/quarantine');
      await captureReadConflict(env, stream, e.id, row as never);
    }
    const c = e.c, o = e.o;
    conflicts.push({ brand: (c ? c.entry.brand : o!.brand) as string, visitor_id: c ? c.visitor_id : o!.visitor_id, ts: c ? c.ts : o!.ts, stream, count: 1 });
  }
  const duplicates: DuplicateWitness[] = [];
  for (const [key, n] of count) { const e = first.get(key)!; duplicates.push({ brand: (e.c ? e.c.entry.brand : e.o!.brand) as string, visitor_id: e.c ? e.c.visitor_id : e.o!.visitor_id, ts: e.c ? e.c.ts : e.o!.ts, stream: e.s === 'd' ? 'decision' : 'outcome', count: n }); }
  // The leaf's state: a v2 shard of today's store at depth 0, or the version the head names — never empty where a version is named.
  const residue = parseLeaf(id).residue % SHARDS;
  const source = stateSource(p, id), stateKey = source ? p.leaves[source]! : null;
  let original = stateKey ? (await I.readHourBody(r2, stateKey)).body : null;
  if (stateKey && original === null) throw new FoldOutputMissing(stateKey);
  // A leaf split from its ancestor for the hour starts from the ancestor's state, its own visitors only (splitState down the path).
  if (original !== null && source !== id) {
    let at = { id: source!, state: I.shardState(original, parseLeaf(source!).residue % SHARDS) };
    const { residue: target } = parseLeaf(id);
    while (parseLeaf(at.id).depth < parseLeaf(id).depth) at = splitState(at.state, at.id).find(c => target % modulus(parseLeaf(c.id).depth) === parseLeaf(c.id).residue)!;
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
  const from = hourStart(p.date, p.hour);
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
      // A leaf past 8 MiB of state splits by visitor hash, moving only its own visitors.
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
}

function mergeLevel(p: Plan, level: number, inputs: number): FoldMessage[] {
  return Array.from({ length: Math.ceil(inputs / STEP.fanIn) }, (_, group) => msg(p, { step: 'merge', level, group }));
}
/** The inputs of one merge: at most 64 partials, the leaves' at level 0, the level below's above it. */
function mergeInputs(prefix: string, leaves: string[], level: number, group: number): { keys: string[]; groups: number } {
  let inputs = leaves.length; for (let l = 0; l < level; l++) inputs = Math.ceil(inputs / STEP.fanIn);
  const keys = Array.from({ length: Math.min(STEP.fanIn, inputs - group * STEP.fanIn) }, (_, i) => level === 0 ? `${prefix}l/${leaves[group * STEP.fanIn + i]}.json` : `${prefix}m/${level - 1}/${group * STEP.fanIn + i}.json`);
  return { keys, groups: Math.ceil(inputs / STEP.fanIn) };
}
async function mergeFanIn(r2: R2Agg, p: Plan, level: number, groups: number, send: Send): Promise<void> {
  let done = 0;
  await eachListed(r2, `${genPrefix(p.tenant, p.gen)}m/${level}/`, () => { done++; });
  if (done < groups) return;
  if (groups === 1) await once(r2, p, 'close', () => send([msg(p, { step: 'close' })]));
  else await once(r2, p, `m${level + 1}`, () => send(mergeLevel(p, level + 1, groups)));
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
  const leaves = (await readJson<string[]>(r2, `${prefix}leaves.json`))?.value;
  if (!leaves) throw new FoldOutputMissing('leaves.json');
  const { keys, groups } = mergeInputs(prefix, leaves, level, group);
  if (!await exists(r2, `${prefix}m/${level}/${group}.json`)) {
    const tau = (p.learn.stats ?? DEFAULT_STATS).tauLearnMs;
    const total = emptyPartial();
    for (const key of keys) { const part = await readJson<HourPartial>(r2, key); if (!part) throw new FoldOutputMissing(key); mergeInto(total, part.value, tau); }
    await put(r2, `${prefix}m/${level}/${group}.json`, JSON.stringify(total));
  }
  await mergeFanIn(r2, p, level, groups, send);
}

/** The key of the merge tree's root (the one partial the close reads), or null for an hour of no leaves. */
async function rootOf(r2: R2Agg, p: Plan): Promise<string | null> {
  const prefix = genPrefix(p.tenant, p.gen);
  const leaves = (await readJson<string[]>(r2, `${prefix}leaves.json`))?.value ?? [];
  if (!leaves.length) return null;
  let inputs = leaves.length, level = 0;
  while (Math.ceil(inputs / STEP.fanIn) > 1) { inputs = Math.ceil(inputs / STEP.fanIn); level++; }
  return `${prefix}m/${level}/0.json`;
}
async function finalPartial(r2: R2Agg, p: Plan): Promise<HourPartial> {
  const root = await rootOf(r2, p);
  if (!root) return emptyPartial();
  const got = await readJson<HourPartial>(r2, root);
  if (!got) throw new FoldOutputMissing(root);
  return got.value;
}

async function close(env: Env, r2: R2Agg, p: Plan): Promise<void> {
  const closed = await exists(r2, closedKey(p.tenant, p.gen));
  if (p.job) {
    if (!closed) {
      const agg = await hourAggregate(r2, p);
      if (!p.warm) await put(r2, `${p.job.key.slice(0, -'job.json'.length)}h/${pad2(p.hour)}.json`, JSON.stringify(agg.value));
      await closeMarker(r2, p);
    }
    await jobAdvance(env, r2, p, (await finalPartial(r2, p)).states);
    return;
  }
  if (p.open) {
    if (closed) return;
    // A plan the head no longer names (superseded by a newer one) writes nothing.
    const { head } = await readHead(r2, p.tenant);
    if (head?.open?.gen !== p.gen) { await closeMarker(r2, p); return; }
    const agg = await hourAggregate(r2, p), body = JSON.stringify(agg.value);
    prepared(p, body);
    await put(r2, openKey(p.tenant, p.date, p.hour), body);
    await put(r2, openStateKey(p.tenant, p.date, p.hour), JSON.stringify({ version: 1, tenant: p.tenant, date: p.date, hour: p.hour, basis: p.basis, status: 'current', through: p.now,
      generation: p.gen, content: await digest(body), segments: [] }));
    await closeMarker(r2, p);
    await clearOpen(r2, p);
    await I.publishDate(r2, p.tenant, p.date, p.learn, p.now);
    return;
  }
  const key = hourKey(p.tenant, p.date, p.hour);
  if (!closed) {
    const agg = await hourAggregate(r2, p), body = JSON.stringify(agg.value);
    prepared(p, body);
    // The commit, write one: the hour aggregate, create-only on a first fold, on the etag the plan noted for a re-fold.
    const written = await put(r2, key, body, p.aggregateEtag === null ? { etagDoesNotMatch: '*' } : { etagMatches: p.aggregateEtag }, factsMeta(agg.value));
    if (!written && (await hourFacts(r2, key))?.generation !== p.gen) return; // another coordinator's hour: stop
    await closeMarker(r2, p);
  } else if ((await hourFacts(r2, key))?.generation !== p.gen) return;
  // The commit, write two; then the date's day, summed one hour at a time, and every due hour in order.
  const committed = await commitHead(r2, p, (await finalPartial(r2, p)).states);
  await I.publishDate(r2, p.tenant, p.date, p.learn, p.now);
  if (committed) await planNextDue(env, r2, p.tenant, p.learn, Date.now(), queueSend(env));
}
/** The hour's aggregate from the merge tree's root: every brand closed as today's fold closes it. */
async function hourAggregate(r2: R2Agg, p: Plan): Promise<{ value: HourAggregate; states: Record<string, string | null> }> {
  const final = await finalPartial(r2, p);
  const policies = p.job ? p.job.policies : policiesOf(p.learn);
  I.closeBrands(final.brands, policies, p.learn, new Set(final.unaccounted), new Map(Object.entries(final.stranded).map(([b, h]) => [b, new Set(h)])),
    new Map(Object.entries(final.credited).map(([b, s]) => [b, new Set(s)])), DEFAULT_HORIZON_MS, RING_CAP);
  const from = hourStart(p.date, p.hour);
  return { value: { version: 1, generation: p.gen, tenant: p.tenant, date: p.date, hour: p.hour, from, to: from + HOUR_MS, builtAt: p.now, objects: p.objects.length,
    objectsRead: p.objects.length, truncated: false, horizonMs: DEFAULT_HORIZON_MS, shards: SHARDS, ringsFolded: final.ringsFolded, recoveryFrom: final.recoveryFrom, brands: final.brands },
  states: final.states };
}
/**
 * The head's leaves with an hour's new versions applied, kept a partition of the hash space: a leaf split for the hour
 * leaves it, its descendants enter it, and a region an ancestor left that no new version covers is named empty (null).
 */
function applyStates(leaves: Record<string, string | null>, states: Record<string, string | null>): Record<string, string | null> {
  const next = { ...leaves }, added = Object.entries(states).filter(([, key]) => key !== null).map(([id]) => id);
  for (const [id, key] of Object.entries(states)) if (key === null) delete next[id]; else next[id] = key;
  const removed = new Set<string>();
  for (const id of added) for (const anc of ancestors(id)) if (Object.hasOwn(next, anc)) { delete next[anc]; removed.add(anc); }
  for (const [id, key] of Object.entries(states)) if (key === null && Object.hasOwn(leaves, id)) removed.add(id);
  const taken = new Set(Object.keys(next));
  const fill = (id: string): void => {
    if (taken.has(id)) return;
    const { depth } = parseLeaf(id);
    const below = [...taken].some(t => { const x = parseLeaf(t); return x.depth > depth && x.residue % modulus(depth) === parseLeaf(id).residue; });
    if (!below) { next[id] = null; taken.add(id); return; }
    for (const child of descendants(id, depth + 1)) fill(child);
  };
  for (const id of removed) if (!added.some(a => a === id)) fill(id);
  return next;
}
/** The commit, write two: the head names the new leaf versions and clears the plan in flight. */
async function commitHead(r2: R2Agg, p: Plan, states: Record<string, string | null>): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { head, etag } = await readHead(r2, p.tenant);
    if (!head || head.inflight?.gen !== p.gen) return false; // already committed (adopted)
    if (await writeHead(r2, p.tenant, { ...head, seq: head.seq + 1, leaves: applyStates(head.leaves, states), inflight: null }, etag)) return true;
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
async function refuse(env: Env, r2: R2Agg, p: Plan, refusal: Record<string, unknown>, retryAt: number | null = null): Promise<void> {
  await closeMarker(r2, p);
  if (p.open) {
    const { head } = await readHead(r2, p.tenant);
    if (head?.open?.gen !== p.gen) return;
    // A refusal the same inputs give again keeps its basis (the hour is not folded again until its ledger changes); one
    // that may pass keeps none, so the next run folds the hour again.
    await put(r2, openStateKey(p.tenant, p.date, p.hour), JSON.stringify({ version: 1, tenant: p.tenant, date: p.date, hour: p.hour, basis: retryAt === null ? p.basis : null,
      status: 'refused', through: null, generation: null, content: null, refusal, segments: [] }));
    await clearOpen(r2, p);
    await I.publishDate(r2, p.tenant, p.date, p.learn, p.now);
    return;
  }
  // A closed hour past a bound: the plan is abandoned and the hour named refused for this listing; newer hours go on.
  // R-P660: the refusal is stored where the day reads it (refusedHourKey), so the day names the hour among its missing
  // hours with the refusal, and goes on naming it after later hours fold.
  // One that may pass is planned again by a five-minute run once `retryAt` is past (as today's catch-up tries a failed
  // hour again at its next run), the hours after it folding meanwhile.
  await put(r2, refusedHourKey(p.tenant, p.date, p.hour), JSON.stringify({ hour: p.hour, basis: p.basis, ...(retryAt === null ? {} : { retryAt }), refusal }));
  let cleared = false;
  for (let attempt = 0; attempt < 4 && !cleared; attempt++) {
    const { head, etag } = await readHead(r2, p.tenant);
    if (!head || head.inflight?.gen !== p.gen) break;
    cleared = await writeHead(r2, p.tenant, { ...head, inflight: null, refused: { ...(head.refused ?? {}), [`${p.date}/${pad2(p.hour)}`]: refusedMark(p.basis, retryAt) } }, etag);
  }
  await I.publishDate(r2, p.tenant, p.date, p.learn, p.now);
  if (cleared) await planNextDue(env, r2, p.tenant, p.learn, Date.now(), queueSend(env));
}
/**
 * A ledger object the plan named is gone: the generation is closed and its hour planned again from a fresh listing, as
 * today's catch-up lists an hour again on its next run, so the hour folds and is never left in flight unnamed.
 */
async function restart(env: Env, r2: R2Agg, p: Plan): Promise<void> {
  await closeMarker(r2, p);
  if (p.rebuild) { await replanRebuild(env, r2, p); return; }
  if (p.job) {
    const cur = await readJson<JobState>(r2, p.job.key);
    if (!cur || cur.value.gen !== p.gen) return;
    const next: JobState = { ...cur.value, gen: null };
    if (await put(r2, p.job.key, JSON.stringify(next), { etagMatches: cur.etag })) await jobNext(env, r2, p.job.key, next);
    return;
  }
  if (p.open) { await clearOpen(r2, p); return; }
  for (let attempt = 0; attempt < 4; attempt++) {
    const { head, etag } = await readHead(r2, p.tenant);
    if (!head || head.inflight?.gen !== p.gen) return;
    if (await writeHead(r2, p.tenant, { ...head, inflight: null }, etag)) { await planNextDue(env, r2, p.tenant, p.learn, Date.now(), queueSend(env)); return; }
  }
}

// ── the five-minute run ───────────────────────────────────────────────────────
/** What the run finds missing of a generation in flight: the steps to send again (one listing per 1,000 outputs). */
async function missingSteps(r2: R2Agg, p: Plan): Promise<FoldMessage[]> {
  const prefix = genPrefix(p.tenant, p.gen);
  const present = new Set<string>();
  await eachListed(r2, prefix, o => { present.add(o.key.slice(prefix.length)); });
  if (present.has('closed')) return [msg(p, { step: 'close' })];
  const idx = p.pages.map((_, page) => page).filter(page => !present.has(`p/${page}.idx`));
  if (idx.length) return idx.map(page => msg(p, { step: 'partition', page }));
  if (!present.has('leaves.json')) {
    const rounds = await readRounds(r2, p), last = rounds.length - 1, round = rounds[last];
    const missing = round ? round.outputs.filter(([leaf, page]) => !present.has(`r/${leaf}/${page}.idx`)) : [];
    if (missing.length) return missing.map(([leaf, page]) => msg(p, { step: 'resect', leaf, page, round: last }));
    return [msg(p, { step: 'leaves' })];
  }
  const leaves = (await readJson<string[]>(r2, `${prefix}leaves.json`))!.value;
  const missingLeaves = leaves.filter(id => !present.has(`l/${id}.json`));
  if (missingLeaves.length) return missingLeaves.map(leaf => msg(p, { step: 'leaf', leaf }));
  let inputs = leaves.length, level = 0;
  while (inputs > 0) {
    const groups = Math.ceil(inputs / STEP.fanIn);
    const missing = Array.from({ length: groups }, (_, g) => g).filter(g => !present.has(`m/${level}/${g}.json`));
    if (missing.length) return missing.map(group => msg(p, { step: 'merge', level, group }));
    if (groups === 1) break;
    inputs = groups; level++;
  }
  return [msg(p, { step: 'close' })];
}

/**
 * The fold's own objects no live generation holds, past the 15-minute grace, a page of the listing at a time and at most
 * `limit` of them: the head's versions and those of the plans in flight (the hour, the open hour, a running job, a
 * running rebuild) are kept; a finished job's day and a finished rebuild's record are kept `STEP.keepMs`, a job's hours
 * only until its day is built. Also the running rebuilds, for the run to resume.
 */
async function staleObjects(r2: R2Agg, tenant: string, now: number, limit: { bytes: number; objects: number }): Promise<{ stale: Array<{ key: string; size: number }>; running: RebuildRecord[] }> {
  const { head } = await readHead(r2, tenant);
  const keep = new Set(Object.values(head?.leaves ?? {}).filter((k): k is string => !!k));
  const live = new Set<string>([head?.inflight?.gen, head?.open?.gen].filter((g): g is string => !!g));
  if (head?.open) for (const k of Object.values((await readJson<Plan>(r2, `${genPrefix(tenant, head.open.gen)}plan.json`))?.value.leaves ?? {})) if (k) keep.add(k);
  const old = (at: number | undefined) => at !== undefined && at + STEP.keepMs <= now;
  const finished: string[] = [], running: RebuildRecord[] = [], records: string[] = [];
  await eachListed(r2, `${foldPrefix(tenant)}jobs/`, async o => {
    if (!o.key.endsWith('/job.json')) return;
    const j = (await readJson<JobState>(r2, o.key))?.value;
    if (!j) return;
    if (j.status === 'running') { for (const k of Object.values(j.leaves)) if (k) keep.add(k); if (j.gen) live.add(j.gen); return; }
    if (old(j.finishedAt)) finished.push(o.key.slice(0, -'job.json'.length));
  });
  await eachListed(r2, `${foldPrefix(tenant)}rebuilds/`, async o => {
    const rec = (await readJson<RebuildRecord>(r2, o.key))?.value;
    if (!rec) return;
    if (rec.status === 'running') { running.push(rec); live.add(rec.gen); } else if (old(rec.finishedAt)) records.push(o.key);
  });
  const stale: Array<{ key: string; size: number }> = [];
  let bytes = 0;
  /** Taken while within the limit (the first always, whatever its size); false once the limit is reached. */
  const take = (o: Listed): boolean => {
    const size = o.size ?? 0;
    if (stale.length >= limit.objects || (stale.length && bytes + size > limit.bytes)) return false;
    stale.push({ key: o.key, size }); bytes += size; return true;
  };
  const grace = (o: Listed) => !!o.uploaded && now - o.uploaded.getTime() < STEP.graceMs;
  // The open hours' working objects outlive their hour by at most one run, as the one-request fold's job kept them
  // (src/learn/hourly.ts foldOpenHours); a ledger copy that fold kept is removed with them (the steps read the
  // ledger itself), so no erased visitor's row outlives it in a copy.
  const openPrefix = `aggregates/${tenant}/open/`, open = new Set(openHours(now).map(at => `${at.date}/${pad2(at.hour)}`));
  if (!await eachListed(r2, openPrefix, o => {
    const m = /^(\d{4}-\d{2}-\d{2})\/(\d{2})\.(json|state\.json)$/.exec(o.key.slice(openPrefix.length));
    return m && open.has(`${m[1]}/${m[2]}`) ? undefined : take(o);
  })) return { stale, running };
  for (const key of records) if (!take({ key, size: 0 })) return { stale, running };
  for (const prefix of finished) if (!await eachListed(r2, prefix, take)) return { stale, running };
  const gens = `${foldPrefix(tenant)}g/`;
  if (!await eachListed(r2, gens, o => {
    const gen = o.key.slice(gens.length, o.key.indexOf('/', gens.length));
    return keep.has(o.key) || live.has(gen) || grace(o) ? undefined : take(o);
  })) return { stale, running };
  // A store the one-request fold wrote: its shards once no head names them.
  await eachListed(r2, `aggregates/${tenant}/rings/`, o => (keep.has(o.key) || grace(o) ? undefined : take(o)));
  return { stale, running };
}

/** An open hour's listing as its plan would take it, and the basis it would be planned on. */
async function openBasis(r2: R2Agg, tenant: string, at: { date: string; hour: number }): Promise<string | null> {
  const objects = await hourObjects(r2, tenant, at);
  return objects.length ? basisOf(objects, at) : null;
}
/**
 * An open hour whose ledger has moved past the working fold that stands — its steps just sent, still running, or waiting
 * behind a closed hour's — is named refused with open_fold_deferred, its standing working aggregate summed and saying so,
 * until its own steps have folded it (as today's run names one its budget deferred).
 */
async function deferOpen(r2: R2Agg, tenant: string, learn: LearnConfig, now: number, only?: { date: string; hour: number }): Promise<void> {
  const dates = new Set<string>();
  for (const at of openHours(now)) {
    if (only && (only.date !== at.date || only.hour !== at.hour)) continue;
    const standing = await readJson<{ status?: string; basis?: string | null } & Record<string, unknown>>(r2, openStateKey(tenant, at.date, at.hour));
    if (!standing || standing.value.status !== 'current') continue;
    const basis = await openBasis(r2, tenant, at);
    if (basis === null || basis === standing.value.basis) continue;
    const deferred = { ...standing.value, status: 'refused', refusal: { at: now, error: 'working fold deferred', code: 'open_fold_deferred' } };
    if (await put(r2, openStateKey(tenant, at.date, at.hour), JSON.stringify(deferred), { etagMatches: standing.etag })) dates.add(at.date);
  }
  for (const date of [...dates].sort()) await I.publishDate(r2, tenant, date, learn, now);
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
  // The run removes at most a bounded share of the fold's own objects no live generation holds; the hour's leaves remove the rest.
  const { stale, running: rebuilds } = await staleObjects(r2, tenant, now, STEP.collect);
  for (const o of stale) await del(r2, o.key);
  // A staged W24 rebuild in flight resumes from the outputs present (a lost step, a close whose apply was not acknowledged).
  for (const rec of rebuilds) {
    const p = (await readJson<Plan>(r2, `${genPrefix(tenant, rec.gen)}plan.json`))?.value;
    if (!p) { await replanRebuild(env, r2, { tenant, gen: rec.gen, rebuild: rec.job } as Plan); continue; }
    const missing = await missingSteps(r2, p);
    result.resumed += missing.length; await send(missing);
  }
  // A plan in flight: finish its head write, or send its missing steps; newer hours wait, and an open hour behind them is named deferred.
  if (head.inflight) {
    const p = (await readJson<Plan>(r2, `${genPrefix(tenant, head.inflight.gen)}plan.json`))?.value;
    if (!p) await writeHead(r2, tenant, { ...head, inflight: null }, etag);
    else if ((await hourFacts(r2, hourKey(tenant, p.date, p.hour)))?.generation === p.gen) {
      await closeMarker(r2, p);
      await commitHead(r2, p, (await finalPartial(r2, p)).states);
    } else if (await exists(r2, closedKey(tenant, p.gen))) {
      // Refused (its refusal stored) or planned again, the head not yet told: the head is told, and the hour planned anew or named.
      const stored = (await readJson<{ basis?: string; retryAt?: number }>(r2, refusedHourKey(tenant, p.date, p.hour)))?.value;
      const refused = stored?.basis === p.basis ? refusedMark(p.basis, stored.retryAt ?? null) : null;
      await writeHead(r2, tenant, { ...head, inflight: null, ...(refused ? { refused: { ...(head.refused ?? {}), [`${p.date}/${pad2(p.hour)}`]: refused } } : {}) }, etag);
    } else {
      const missing = await missingSteps(r2, p);
      result.resumed += missing.length; await send(missing);
      await deferOpen(r2, tenant, learn, now);
      return result;
    }
  }
  const due = await planNextDue(env, r2, tenant, learn, now, send);
  if (due.planned) { result.planned = due.planned; await deferOpen(r2, tenant, learn, now); return result; }
  ({ head, etag } = await readHead(r2, tenant)); if (!head) return result;
  const { datesBuilt, lateByDate } = due;
  // Nothing to fold: the dates' days, summed one hour at a time, where the saved day does not name every built hour.
  for (const date of [...datesBuilt.keys()].filter(d => datesBuilt.get(d)!.size).sort().slice(-3)) {
    try { if (await I.publishIfStale(r2, tenant, date, learn, now, lateByDate.get(date))) result.published.push(date); } catch { /* next run */ }
  }
  // The open hour, on the same steps, never moving the head: one open plan at a time. One still running for an hour
  // still open is resumed, and an open hour behind it is named deferred; one for an hour no longer open is closed.
  const opens = openHours(now);
  if (head.open) {
    const p = (await readJson<Plan>(r2, `${genPrefix(tenant, head.open.gen)}plan.json`))?.value;
    const running = !!p && !await exists(r2, closedKey(tenant, p.gen));
    if (p && running && opens.some(at => at.date === p.date && at.hour === p.hour)) {
      await deferOpen(r2, tenant, learn, now);
      const missing = await missingSteps(r2, p); result.resumed += missing.length; await send(missing);
      return result;
    }
    if (p && running) await closeMarker(r2, p);
    if (!await writeHead(r2, tenant, { ...head, open: null }, etag)) return result;
    ({ head, etag } = await readHead(r2, tenant)); if (!head) return result;
  }
  for (const at of opens) {
    const basis = await openBasis(r2, tenant, at);
    if (basis === null) continue;
    const standing = await readJson<{ basis: string | null }>(r2, openStateKey(tenant, at.date, at.hour));
    if (standing?.value.basis === basis) continue;
    const p = await plan(r2, tenant, learn, at, now, head.leaves, true);
    if (!await writeHead(r2, tenant, { ...head, open: { gen: p.gen, date: at.date, hour: at.hour } }, etag)) return result;
    // Until its steps have folded what the run found, the hour is named deferred (its standing working aggregate summed).
    await deferOpen(r2, tenant, learn, now, at);
    await send(kickoff(p));
    return result;
  }
  return result;
}

// ── the W24 rebuild on the same steps ─────────────────────────────────────────
/**
 * The retained day and the day before it (the carry-in), as the hourly fold reads them, partitioned by visitor; each leaf
 * folds its visitors with the one ring rule. The rebuild runs under its own identity (its operation id): its record names
 * the generation it runs, the five-minute run keeps that generation from collection and resumes it, and a refusal is
 * stored there, never as an hour of a date.
 */
export async function planRebuild(env: Env, job: RebuildJob): Promise<void> {
  const r2 = env.STORAGE as unknown as R2Agg;
  const p = await rebuildPlan(r2, job);
  await put(r2, rebuildKey(job.tenant, job.operationId), JSON.stringify({ version: 1, job, gen: p.gen, status: 'running' } satisfies RebuildRecord), { etagDoesNotMatch: '*' });
}
/** The planned rebuild's steps sent, once its transition is stored (a lost send is resumed by the five-minute run). */
export async function startRebuild(env: Env, job: RebuildJob): Promise<void> {
  const r2 = env.STORAGE as unknown as R2Agg, rec = (await readJson<RebuildRecord>(r2, rebuildKey(job.tenant, job.operationId)))?.value;
  const p = rec?.status === 'running' ? (await readJson<Plan>(r2, `${genPrefix(job.tenant, rec.gen)}plan.json`))?.value : undefined;
  if (p) await queueSend(env)(kickoff(p));
}
async function rebuildPlan(r2: R2Agg, job: RebuildJob): Promise<Plan> {
  const objects: Plan['objects'] = [];
  for (const date of [job.before, job.date]) for (let hour = 0; hour < 24; hour++) objects.push(...await hourObjects(r2, job.tenant, { date, hour }));
  const gen = crypto.randomUUID();
  const p: Plan = { version: 1, tenant: job.tenant, gen, date: job.date, hour: 0, open: false, now: job.at, refold: false, aggregateEtag: null, objects, pages: pagesOf(objects), leaves: {},
    rowDepth: rowDepthOf(objects), learn: {} as LearnConfig, basis: '', rebuild: job };
  await put(r2, `${genPrefix(job.tenant, gen)}plan.json`, JSON.stringify(p), { etagDoesNotMatch: '*' });
  return p;
}
/** A rebuild whose plan is gone or stale: a new generation over a fresh listing, named by the rebuild's record. */
async function replanRebuild(env: Env, r2: R2Agg, p: Pick<Plan, 'tenant' | 'gen' | 'rebuild'>): Promise<void> {
  const key = rebuildKey(p.tenant, p.rebuild!.operationId), cur = await readJson<RebuildRecord>(r2, key);
  if (!cur || cur.value.status !== 'running' || cur.value.gen !== p.gen) return;
  const next = await rebuildPlan(r2, cur.value.job);
  if (await put(r2, key, JSON.stringify({ ...cur.value, gen: next.gen } satisfies RebuildRecord), { etagMatches: cur.etag })) await queueSend(env)(kickoff(next));
}
async function rebuildRefuse(r2: R2Agg, p: Plan, refusal: Record<string, unknown>): Promise<void> {
  await closeMarker(r2, p);
  await rebuildFinish(r2, p, 'refused', refusal);
}
async function rebuildFinish(r2: R2Agg, p: Plan, status: 'applied' | 'superseded' | 'refused', refusal?: Record<string, unknown>): Promise<void> {
  const key = rebuildKey(p.tenant, p.rebuild!.operationId);
  for (let attempt = 0; attempt < 4; attempt++) {
    const cur = await readJson<RebuildRecord>(r2, key);
    if (!cur || cur.value.status !== 'running' || cur.value.gen !== p.gen) return;
    if (await put(r2, key, JSON.stringify({ ...cur.value, status, ...(refusal ? { refusal } : {}), finishedAt: Date.now() } satisfies RebuildRecord), { etagMatches: cur.etag })) return;
  }
}
/** The day's ledger bytes and the day before's, to choose the steps over one request. */
export async function rebuildBytes(env: Env, tenant: string, dates: string[]): Promise<number> {
  let n = 0;
  for (const date of dates) await eachListed(env.STORAGE as unknown as R2Agg, `${tenant}/${date}/`, o => { if (isLearningKey(o.key)) n += o.size ?? 0; });
  return n;
}
interface RebuildPartial { stats: StatsState; decisions: number; outcomes: number }
async function rebuildLeaf(r2: R2Agg, p: Plan, id: string, send: Send): Promise<void> {
  const prefix = genPrefix(p.tenant, p.gen), job = p.rebuild!;
  if (!await exists(r2, `${prefix}l/${id}.json`)) {
    // A rebuild leaf holds its visitors' rows of both days within the same 8 MiB of rows as an hour's leaf (R-P684).
    const entries = await rowsOf(r2, p, id);
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
  }
  const leaves = await readJson<string[]>(r2, `${prefix}leaves.json`);
  let done = 0;
  await eachListed(r2, `${prefix}l/`, () => { done++; });
  if (leaves && done === leaves.value.length) await once(r2, p, 'm0', () => send(mergeLevel(p, 0, leaves.value.length)));
}
async function rebuildMerge(r2: R2Agg, p: Plan, level: number, group: number, send: Send): Promise<void> {
  const prefix = genPrefix(p.tenant, p.gen);
  const leaves = (await readJson<string[]>(r2, `${prefix}leaves.json`))?.value;
  if (!leaves) throw new FoldOutputMissing('leaves.json');
  const { keys, groups } = mergeInputs(prefix, leaves, level, group);
  if (!await exists(r2, `${prefix}m/${level}/${group}.json`)) {
    const tau = p.rebuild!.config.stats.tauLearnMs;
    let total: RebuildPartial = { stats: emptyStats(), decisions: 0, outcomes: 0 };
    for (const key of keys) {
      const part = (await readJson<RebuildPartial>(r2, key))?.value;
      if (!part) throw new FoldOutputMissing(key);
      total = { stats: mergeStats(total.stats, part.stats, tau), decisions: total.decisions + part.decisions, outcomes: total.outcomes + part.outcomes };
    }
    await put(r2, `${prefix}m/${level}/${group}.json`, JSON.stringify(total));
  }
  await mergeFanIn(r2, p, level, groups, send);
}
async function rebuildClose(env: Env, r2: R2Agg, p: Plan): Promise<void> {
  const job = p.rebuild!, record = (await readJson<RebuildRecord>(r2, rebuildKey(p.tenant, job.operationId)))?.value;
  if (record?.status !== 'running' || record.gen !== p.gen) return; // applied, refused or planned again: nothing more
  const root = await rootOf(r2, p);
  let total: RebuildPartial = { stats: emptyStats(), decisions: 0, outcomes: 0 };
  if (root) { const got = await readJson<RebuildPartial>(r2, root); if (!got) throw new FoldOutputMissing(root); total = got.value; }
  await closeMarker(r2, p);
  const stub = env.LEARN_STATS!.get(env.LEARN_STATS!.idFromName(job.name));
  // Applied once: the transition that planned it takes the day's counters once (a delivery after that adds nothing); a
  // transition since has superseded it (409).
  const answer = await stub.fetch('https://learn/rebuild-apply', { method: 'POST', body: JSON.stringify({ operationId: job.operationId, date: job.date, ...total }) });
  if (!answer.ok && answer.status !== 409) throw new Error('rebuild not applied');
  await rebuildFinish(r2, p, answer.ok ? 'applied' : 'superseded');
}


// ── the custom-policy day past a page: a job on the same steps (R-P615) ──────────
// The date re-run hour by hour under the learning policy and the request's policies, into the job's own namespace,
// from an empty state after the horizon before the day (48 hours, its warm-up: the rings the hourly fold holds at the
// day's start, rebuilt from the ledger, so no state is kept per day); its day summed one hour at a time from the job's
// hours. A finished job's day is kept `STEP.keepMs`, then collected; the same request then starts a new job.
export interface ReportJob { id: string; tenant: string; brand: string; date: string; digest: string; at: number;
  /** The job's hours in order: the warm-up hours of the horizon before the day (1), then the day's own (0). */
  hours: Array<[string, number, 0 | 1]>; learn: LearnConfig; policies: Array<ReturnType<typeof policiesOf>[number]> }
export interface JobState { version: 1; job: ReportJob; leaves: Record<string, string | null>; done: number; gen: string | null; status: 'running' | 'done' | 'refused'; refusal?: Record<string, unknown>; finishedAt?: number }
const jobPrefix = (t: string, date: string, d: string) => `${foldPrefix(t)}jobs/${date}/${d}/`;
export const jobDigest = (brand: string, policies: unknown): Promise<string> => digest(stable({ brand, policies }));
export const jobLocation = (tenant: string, date: string, brand: string, d: string): string =>
  `/v1/${tenant}/learn/report?date=${date}&brand=${encodeURIComponent(brand)}&policy=${d}`;
export const progressOf = (j: JobState) => ({ id: j.job.id, status: j.status, hours: j.job.hours.length, done: j.done });
/** Is the day's ledger past one page (16 MiB or 200 objects)? */
export async function pastPage(env: Env, tenant: string, date: string): Promise<boolean> {
  let bytes = 0, n = 0;
  await eachListed(env.STORAGE as unknown as R2Agg, `${tenant}/${date}/`, o => { if (isLearningKey(o.key)) { bytes += o.size ?? 0; n++; } });
  return bytes > STEP.pageBytes || n > STEP.pageObjects;
}
/** The job for this day, brand and policy set: the one already named, or a new one planned. */
export async function reportJob(env: Env, ids: { tenant: string; brand: string; date: string }, learn: LearnConfig, reporting: Array<{ name: string } & Record<string, unknown>>, now: number): Promise<JobState> {
  const r2 = env.STORAGE as unknown as R2Agg;
  const d = await jobDigest(ids.brand, reporting), key = `${jobPrefix(ids.tenant, ids.date, d)}job.json`;
  const held = await readJson<JobState>(r2, key);
  if (held) return held.value;
  const policies = [policiesOf(learn)[0]!, ...reporting.map(p => ({ ...p, role: 'reporting' as const }))] as ReportJob['policies'];
  const start = hourStart(ids.date, 0), hours: ReportJob['hours'] = [];
  for (let t = start - DEFAULT_HORIZON_MS; t < start; t += HOUR_MS) { const h = hourOf(t); hours.push([h.date, h.hour, 1]); }
  for (let h = 0; h < 24 && start + h * HOUR_MS <= now; h++) hours.push([ids.date, h, 0]);
  // Its leaves start as the empty partition of the hash space (the 64 depth-0 leaves, no state), so every visitor's leaf is one.
  const leaves = Object.fromEntries(Array.from({ length: SHARDS }, (_, r) => [leafId(0, r), null]));
  const state: JobState = { version: 1, job: { id: crypto.randomUUID(), ...ids, digest: d, at: now, hours, learn, policies }, leaves, done: 0, gen: null, status: 'running' };
  if (!await put(r2, key, JSON.stringify(state), { etagDoesNotMatch: '*' })) return (await readJson<JobState>(r2, key))!.value;
  await jobNext(env, r2, key, state);
  return (await readJson<JobState>(r2, key))?.value ?? state;
}
export async function readJob(env: Env, ids: { tenant: string; brand: string; date: string }, d: string): Promise<{ state: JobState; day: unknown } | null> {
  const r2 = env.STORAGE as unknown as R2Agg, prefix = jobPrefix(ids.tenant, ids.date, d);
  const state = (await readJson<JobState>(r2, `${prefix}job.json`))?.value;
  if (!state || state.job.brand !== ids.brand) return null;
  return { state, day: state.status === 'done' ? (await readJson<unknown>(r2, `${prefix}day.json`))?.value ?? null : null };
}
/** The job's next hour planned: a warm-up hour with no ledger object takes no step (its rings are folded on with the next one). */
async function jobNext(env: Env, r2: R2Agg, key: string, state: JobState): Promise<void> {
  let cur = state;
  for (;;) {
    const { job } = cur;
    if (cur.done >= job.hours.length) { await jobDay(r2, key); return; }
    const [date, hour, warm] = job.hours[cur.done]!;
    if (warm && !(await hourObjects(r2, job.tenant, { date, hour })).length) {
      const stored = await readJson<JobState>(r2, key);
      if (!stored || stored.value.done !== cur.done || stored.value.gen !== null) return;
      const next: JobState = { ...stored.value, done: stored.value.done + 1 };
      if (!await put(r2, key, JSON.stringify(next), { etagMatches: stored.etag })) return;
      cur = next; continue;
    }
    const p = await plan(r2, job.tenant, job.learn, { date, hour }, job.at, cur.leaves, false, { key, policies: job.policies }, warm === 1);
    const stored = await readJson<JobState>(r2, key);
    if (!stored || stored.value.done !== cur.done || stored.value.gen !== null) return;
    if (!await put(r2, key, JSON.stringify({ ...stored.value, gen: p.gen }), { etagMatches: stored.etag })) return;
    await queueSend(env)(kickoff(p));
    return;
  }
}
async function jobAdvance(env: Env, r2: R2Agg, p: Plan, states: Record<string, string | null>): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const cur = await readJson<JobState>(r2, p.job!.key);
    if (!cur || cur.value.gen !== p.gen) return; // already advanced
    const next: JobState = { ...cur.value, leaves: applyStates(cur.value.leaves, states), done: cur.value.done + 1, gen: null };
    if (await put(r2, p.job!.key, JSON.stringify(next), { etagMatches: cur.etag })) { await jobNext(env, r2, p.job!.key, next); return; }
  }
}
async function jobDay(r2: R2Agg, key: string): Promise<void> {
  const cur = await readJson<JobState>(r2, key);
  if (!cur || cur.value.status !== 'running') return;
  const { job } = cur.value, prefix = key.slice(0, -'job.json'.length);
  let report: unknown;
  try { report = await I.jobDayFromHours(r2, `${prefix}h/`, { tenant: job.tenant, brand: job.brand, date: job.date }, job.learn, job.at); }
  catch (error) {
    // R-P702: a day its hours cannot make (a budget, an input) is the job's refusal, named on its read; storage is tried again.
    if (!(error instanceof ReportBudgetExceeded || error instanceof ReportInputError)) throw error;
    await put(r2, key, JSON.stringify({ ...cur.value, status: 'refused', refusal: refusalOf(error, job.at), leaves: {}, finishedAt: Date.now() } satisfies JobState), { etagMatches: cur.etag });
    return;
  }
  await put(r2, `${prefix}day.json`, JSON.stringify(report));
  if (!await put(r2, key, JSON.stringify({ ...cur.value, status: 'done', leaves: {}, finishedAt: Date.now() } satisfies JobState), { etagMatches: cur.etag })) return;
  // The day is built: its hours are not kept.
  const hours: string[] = [];
  await eachListed(r2, `${prefix}h/`, o => { hours.push(o.key); });
  for (const k of hours) await del(r2, k);
}
async function jobRefuse(r2: R2Agg, p: Plan, refusal: Record<string, unknown>): Promise<void> {
  await closeMarker(r2, p);
  const cur = await readJson<JobState>(r2, p.job!.key);
  if (!cur || cur.value.gen !== p.gen) return;
  await put(r2, p.job!.key, JSON.stringify({ ...cur.value, status: 'refused', refusal, leaves: {}, finishedAt: Date.now() } satisfies JobState), { etagMatches: cur.etag });
}

/**
 * The next due hour of the lookback (oldest first, a missing hour or a stale one), planned unless a plan is in flight;
 * the quiet hours of a stateless tenant closed in place on the way. Called by the five-minute run and by each close, so
 * every due hour is folded in order without waiting for a run. Each hour is judged by its aggregate's metadata and one
 * listing of its ledger, never by reading the aggregate, so the run holds no hour's aggregate.
 */
async function planNextDue(env: Env, r2: R2Agg, tenant: string, learn: LearnConfig, now: number, send: Send): Promise<{ planned: string | null; datesBuilt: Map<string, Set<number>>; lateByDate: Map<string, Map<number, number>> }> {
  const { head, etag } = await readHead(r2, tenant);
  const datesBuilt = new Map<string, Set<number>>(), lateByDate = new Map<string, Map<number, number>>();
  if (!head || head.inflight) return { planned: null, datesBuilt, lateByDate };
  const builtAt = new Map<number, number>();
  const stateless = !Object.values(head.leaves).some(Boolean);
  for (const c of closedHours(now, 26)) {
    const key = hourKey(tenant, c.date, c.hour), facts = await hourFacts(r2, key);
    const objects = await hourObjects(r2, tenant, c);
    let fold = facts === null;
    if (facts) {
      // W22 R1.02, W30 R1.01/M1.01: stale where its ledger grew within the re-fold horizon, where a cap cut it short, or
      // where an earlier hour was built after it; past the horizon a grown hour is final and names its late objects.
      builtAt.set(c.from, facts.builtAt);
      let late: number | undefined;
      if (facts.truncated && 100_000 > facts.objectsRead) fold = true;
      else if (objects.length > facts.objects) {
        if (now <= c.from + HOUR_MS + REFOLD_MATURITY_MS) fold = true;
        else {
          late = objects.length - facts.objects;
          if (facts.lateObjects !== late) {
            try {
              const stored = await I.readHourBody(r2, key);
              if (stored.body !== null && stored.etag === facts.etag) {
                const a = { ...(JSON.parse(stored.body) as HourAggregate & { lateObjects?: number }), lateObjects: late };
                await put(r2, key, JSON.stringify(a), { etagMatches: facts.etag }, factsMeta(a));
              }
            } catch { /* next run */ }
          }
        }
      } else {
        late = facts.lateObjects > 0 ? facts.lateObjects : 0;
        fold = [...builtAt].some(([from, when]) => from < c.from && when > facts.builtAt);
      }
      if (!fold && late !== undefined) { const m = lateByDate.get(c.date) ?? new Map<number, number>(); m.set(c.hour, late); lateByDate.set(c.date, m); }
    }
    // A refused hour waits: one the same inputs refuse again until its ledger changes, one that may pass until its retry time.
    const mark = head.refused?.[`${c.date}/${pad2(c.hour)}`];
    if (fold && mark && (mark.startsWith(RETRY) ? Number(mark.slice(RETRY.length)) > now : await basisOf(objects, c) === mark)) fold = false;
    if (fold && stateless && !objects.length) {
      // A quiet hour of a tenant with no state takes no step: its (empty) aggregate is closed here, as the close would.
      const agg: HourAggregate = { version: 1, generation: crypto.randomUUID(), tenant, date: c.date, hour: c.hour, from: c.from, to: c.from + HOUR_MS, builtAt: now, objects: 0, objectsRead: 0,
        truncated: false, horizonMs: DEFAULT_HORIZON_MS, shards: SHARDS, ringsFolded: true, recoveryFrom: 0, brands: {} };
      await put(r2, key, JSON.stringify(agg), facts === null ? { etagDoesNotMatch: '*' } : { etagMatches: facts.etag }, factsMeta(agg));
      builtAt.set(c.from, now);
      const set = datesBuilt.get(c.date) ?? new Set<number>(); set.add(c.hour); datesBuilt.set(c.date, set);
      continue;
    }
    if (fold) {
      const p = await plan(r2, tenant, learn, c, now, head.leaves, false);
      if (!await writeHead(r2, tenant, { ...head, inflight: { gen: p.gen, date: c.date, hour: c.hour } }, etag)) return { planned: null, datesBuilt, lateByDate };
      // A quiet hour of a small state (no ledger object, at most 64 leaves) takes its bounded steps here, one after
      // another, rather than a queue hop each; an hour with rows, or a state past 64 leaves, takes them on the queue.
      if (!p.objects.length && Object.values(head.leaves).filter(Boolean).length <= SHARDS) {
        // (Inline, its leaves remove nothing: removal stays a bounded share of queued steps and of each run.)
        const inline: Send = async messages => { for (const m of messages) await runFoldStep(env, { ...m, retire: undefined }, inline); };
        await inline(kickoff(p));
      } else await send(kickoff(p));
      return { planned: `${c.date}/${pad2(c.hour)}`, datesBuilt, lateByDate };
    }
    const s = datesBuilt.get(c.date) ?? new Set<number>(); if (facts) s.add(c.hour); datesBuilt.set(c.date, s);
  }
  return { planned: null, datesBuilt, lateByDate };
}
