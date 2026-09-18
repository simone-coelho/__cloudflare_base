// src/ledger/erasure.ts
// Doc 22 §15, CW28: erasure across the ledger. The ledger is append-only and
// its R2 partition is the warehouse's export, so "delete this visitor's rows"
// is two things with one list between them.
//
// A TOMBSTONE per visitor, written the moment erasure is requested, that every
// reader honours at once: the day report, the point lookup, the replay and the
// export listing all drop a row whose visitor is tombstoned and whose time is
// at or before the erasure. And a scheduled REWRITE that walks the tenant's
// partition newest day first over the retention window, removes those rows
// from the batch objects, deletes an object that empties, and records scan
// completion WITHOUT retiring the active suppression predicate. A run resumes where
// it stopped, and is idempotent: a day done twice removes nothing the second
// time. Aggregates are untouched, because counts are not personal data.
//
// The rows a visitor produces AFTER the erasure are new evidence, kept: an
// erasure is a point in time, not a ban. The retention window is the ledger's
// configured scan horizon, not an approved physical-retention policy. Barrier
// removal requires a later authorized lifecycle; no automatic expiry is implied.

import type { Env } from '@/types/env';
import { MANAGED_MARKER, managedKey, managedRows, claimKey, claimText, readClaim, DELIVERY_FIELD, validCarrier } from './delivery';
import { z } from 'zod';
import { readRetention } from '@/retention';
import { parseId, fromTs36, hourPrefix, type LedgerStream } from './records';

export interface Tombstone {
  tenant: string;
  visitor_id: string;
  /** When erasure was requested. Rows at or before it are hidden, then removed. */
  erased_at: number;
  actor: string;
  /** The oldest day (UTC, YYYY-MM-DD) the rewrite has already cleaned for this visitor; absent before the first pass. */
  done_through?: string;
  rows_removed: number;
  objects_rewritten: number;
  objects_deleted: number;
  /** Completed configured scan, not exhaustive/external erasure. The barrier stays active. */
  rewritten_at?: number;
  window_days?: number;
  /** Durable day coordinator; never discard this reference while recovery is pending. */
  rewrite?: { id: string; day: string };
}

/** What remains after the rewrite: the audit of an erasure, with the visitor id replaced by a hash. */
export interface RetiredTombstone {
  tenant: string;
  visitor_hash: string;
  erased_at: number;
  rewritten_at: number;
  window_days: number;
  rows_removed: number;
  objects_rewritten: number;
  objects_deleted: number;
}

export interface R2Erasable {
  put(key: string, body: string, opts?: unknown): Promise<unknown>;
  get(key: string): Promise<{ text(): Promise<string>; etag?: string; customMetadata?: Record<string, string>; size?: number } | null>;
  delete(key: string): Promise<unknown>;
  list(opts: { prefix: string; cursor?: string; limit?: number }): Promise<{ objects: Array<{ key: string }>; truncated: boolean; cursor?: string }>;
}
export type R2Readable = Pick<R2Erasable, 'get' | 'list'>;

export const DEFAULT_RETENTION_DAYS = 90;
const DAY = 86_400_000;

export const pendingPrefix = (tenant: string) => `erasures/${tenant}/pending/`;
export const retiredPrefix = (tenant: string) => `erasures/${tenant}/retired/`;
export const tombstoneKey = (tenant: string, visitorId: string) => `${pendingPrefix(tenant)}${encodeURIComponent(visitorId)}.json`;
const rewriteKey = (tenant: string) => `erasures/${tenant}/rewrite.json`;
const observedEtag = Symbol('erasure-observed-etag');
type Observed = { [observedEtag]?: string | null };
function observed<T extends object>(value: T, etag: unknown): T {
  if (typeof etag !== 'string' || !etag) throw new Error('Erasure conditional state unavailable');
  Object.assign(value, { [observedEtag]: etag }); return value;
}
function completedRewrite(value: unknown, tenant: string): value is { version: 2; tenant: string; id: string; complete: true; retention?: z.infer<typeof retentionCursorSchema> } {
  const v = value as Record<string, unknown> | null;
  return !!v && ['complete,id,tenant,version', 'complete,id,retention,tenant,version'].includes(Object.keys(v).sort().join(','))
    && v.version === 2 && v.tenant === tenant && v.complete === true && typeof v.id === 'string' && /^[a-f0-9]{32}$/.test(v.id)
    && (v.retention === undefined || retainedCursor(v.retention, tenant));
}
const retentionCursorSchema = z.object({ version: z.literal(4), tenant: z.string(), id: z.string().regex(/^[a-f0-9]{32}$/),
  complete: z.literal(true), cursor: z.string().min(1).max(4096).nullable(), at: z.number().int().safe().nonnegative() }).strict();
const retentionIntentSchema = z.object({ before: z.string().regex(/^[a-f0-9]{64}$/), after: z.string().regex(/^[a-f0-9]{64}$/),
  removed: z.number().int().positive(), beforeLength: z.number().int().positive().max(16 * 1024 * 1024),
  afterLength: z.number().int().nonnegative(), latestBefore: z.string().regex(/^[a-f0-9]{64}$/), latestAfter: z.string().regex(/^[a-f0-9]{64}$/),
  latestBeforeLength: z.number().int().positive().max(16 * 1024 * 1024), latestAfterLength: z.number().int().nonnegative().max(16 * 1024 * 1024), afterProven: z.boolean(),
  claims: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)).optional(),
}).strict().refine(v => v.before !== v.after && v.afterLength < v.beforeLength && v.latestBeforeLength >= v.beforeLength
  && v.latestAfterLength >= v.afterLength && (v.afterProven || v.latestBeforeLength - v.latestAfterLength === v.beforeLength - v.afterLength));
const retentionRewriteSchema = z.object({ version: z.literal(3), tenant: z.string(), id: z.string().regex(/^[a-f0-9]{32}$/),
  at: z.number().int().safe().nonnegative(), cursor: z.string().min(1).max(4096).nullable(), next: z.string().min(1).max(4096).nullable(),
  keys: z.array(z.string().min(1).max(4096)).max(100), index: z.number().int().nonnegative(),
  removed: z.number().int().safe().nonnegative(), rewritten: z.number().int().safe().nonnegative(), intent: retentionIntentSchema.optional(),
}).strict();
function retainedCursor(value: unknown, tenant: string): boolean {
  const parsed = retentionCursorSchema.safeParse(value); return parsed.success && parsed.data.tenant === tenant;
}
function retainedJournal(value: unknown, tenant: string) {
  const j = retentionRewriteSchema.parse(value);
  if (j.tenant !== tenant || !validTenant(tenant) || !validTime(j.at) || j.index > j.keys.length || j.rewritten > j.index
    || (j.intent && j.index >= j.keys.length) || (j.next !== null && j.next === j.cursor)
    || j.keys.some((key, i) => !key.startsWith(tenant + '/') || (i > 0 && key <= j.keys[i - 1]!))) return failRewrite();
  if (j.intent?.claims) checkedClaimWitness(j.intent.claims, tenant);
  return j;
}

export const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const msOfDay = (day: string): number => Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));
const prevDay = (day: string): string => dayOf(msOfDay(day) - DAY);

/** FNV-1a over the id, with its length: enough to tell audit rows apart, and no way back to the id. */
export function visitorHash(id: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${h.toString(16).padStart(8, '0')}-${id.length}`;
}

/** The retention window in days: `LEDGER_RETENTION_DAYS`, or the design's default. */
export function retentionDays(env: Pick<Env, 'LEDGER_RETENTION_DAYS'>): number {
  const n = Number(env.LEDGER_RETENTION_DAYS);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_RETENTION_DAYS;
}

export async function listKeys(r2: R2Readable, prefix: string): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const page = await r2.list({ prefix, cursor, limit: 1000 });
    for (const o of page.objects) out.push(o.key);
    if (page.truncated && (typeof page.cursor !== 'string' || !page.cursor || seen.has(page.cursor))) throw new Error('Erasure listing unavailable');
    cursor = page.truncated ? page.cursor : undefined;
    if (cursor) seen.add(cursor);
  } while (cursor);
  return out.sort();
}

const validSubject = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9_.-]{1,200}$/.test(id);
const validTenant = (id: unknown): id is string => typeof id === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id);
const validTime = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && Number.isFinite(new Date(n).getTime());
const validDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && Number.isFinite(Date.parse(v)) && dayOf(Date.parse(v)) === v;
function checkedTombstone(value: unknown, tenant: string, key: string): Tombstone {
  const t = value as Tombstone | null;
  if (!t || !validTenant(tenant) || t.tenant !== tenant || !validSubject(t.visitor_id)
    || key !== tombstoneKey(tenant, t.visitor_id) || !validTime(t.erased_at)
    || typeof t.actor !== 'string' || t.actor.length < 1 || t.actor.length > 200
    || ![t.rows_removed, t.objects_rewritten, t.objects_deleted].every(n => Number.isSafeInteger(n) && n >= 0)
    || (t.done_through !== undefined && (!validDay(t.done_through) || t.done_through > dayOf(t.erased_at)))
    || ((t.rewritten_at === undefined) !== (t.window_days === undefined))
    || (t.rewrite !== undefined && (!t.rewrite || typeof t.rewrite.id !== 'string' || !/^[a-f0-9]{32}$/.test(t.rewrite.id)
      || !validDay(t.rewrite.day) || t.rewrite.day > (t.done_through ? prevDay(t.done_through) : dayOf(t.erased_at)) || t.rewritten_at !== undefined))
    || (t.rewritten_at !== undefined && (!validTime(t.rewritten_at) || t.rewritten_at < t.erased_at
      || !Number.isSafeInteger(t.window_days) || t.window_days! < 1
      || !Number.isFinite(new Date(t.erased_at - t.window_days! * DAY).getTime())
      || !t.done_through || t.done_through > dayOf(t.erased_at - t.window_days! * DAY)))) throw new Error('Erasure state unavailable');
  return t;
}

/** Exact active barrier, including completed scans. Only a definite missing key means no cutoff. */
export async function loadTombstone(r2: Pick<R2Readable, 'get'>, tenant: string, visitorId: string): Promise<Tombstone | null> {
  if (!r2 || typeof r2.get !== 'function' || !validTenant(tenant) || !validSubject(visitorId)) throw new Error('Erasure state unavailable');
  const key = tombstoneKey(tenant, visitorId), obj = await r2.get(key);
  if (obj === null) return null;
  if (!obj || typeof obj.text !== 'function') throw new Error('Erasure state unavailable');
  return checkedTombstone(JSON.parse(await obj.text()), tenant, key);
}

/** Every active barrier, including completed scans. Listed absence/corruption is not consent to write. */
export async function loadTombstones(r2: R2Readable, tenant: string): Promise<Map<string, Tombstone>> {
  if (!validTenant(tenant)) throw new Error('Erasure state unavailable');
  const out = new Map<string, Tombstone>();
  for (const key of await listKeys(r2, pendingPrefix(tenant))) {
    const obj = await r2.get(key);
    if (!obj) throw new Error('Erasure state unavailable');
    const t = observed(checkedTombstone(JSON.parse(await obj.text()), tenant, key), obj.etag);
    out.set(t.visitor_id, t);
  }
  return out;
}

/** Is this row hidden: its visitor is tombstoned and it happened at or before the erasure. */
export function hidden(tombs: ReadonlyMap<string, Pick<Tombstone, 'erased_at'>>, rec: { visitor_id: string; ts: number }): boolean {
  const t = tombs.get(rec.visitor_id);
  return t !== undefined && rec.ts <= t.erased_at;
}

export function withoutErased<T extends { visitor_id: string; ts: number }>(records: readonly T[], tombs: ReadonlyMap<string, Pick<Tombstone, 'erased_at'>>): T[] {
  return tombs.size ? records.filter((r) => !hidden(tombs, r)) : [...records];
}

/** Same-cutoff retries preserve progress; a genuinely later erasure restarts the window. */
export async function writeTombstone(r2: R2Erasable, tenant: string, visitorId: string, actor: string, now = Date.now()): Promise<{ key: string; tombstone: Tombstone }> {
  if (!validTenant(tenant) || !validSubject(visitorId) || !validTime(now) || typeof actor !== 'string' || actor.length < 1 || actor.length > 200) throw new Error('Erasure state unavailable');
  const key = tombstoneKey(tenant, visitorId);
  let prior: Tombstone | null = null;
  const obj = await r2.get(key);
  if (obj) {
    prior = checkedTombstone(JSON.parse(await obj.text()), tenant, key);
    if (now <= prior.erased_at) return { key, tombstone: prior };
  }
  // A later cutoff must not replace the snapshots/counters of an unfinished
  // physical pass. Same/earlier requests above remain harmless barrier retries.
  const journal = await readRewrite(r2, tenant);
  if (prior?.rewrite || journal?.targets.some(t => t.base.visitor_id === visitorId)) throw new Error('Erasure rewrite recovery required');
  const tombstone: Tombstone = {
    tenant, visitor_id: visitorId, erased_at: Math.max(now, prior?.erased_at ?? 0), actor,
    rows_removed: prior?.rows_removed ?? 0, objects_rewritten: prior?.objects_rewritten ?? 0, objects_deleted: prior?.objects_deleted ?? 0,
  };
  await putJson(r2, key, tombstone, obj ? observed(prior!, obj.etag) : null);
  return { key, tombstone };
}

export interface RewriteResult {
  retention?: { opened: number; removed: number; rewritten: number; more: boolean };
  tenant: string;
  /** Active barriers at the start, including already completed scans. */
  tombstones: number;
  /** The days this run cleaned, newest first. */
  days: string[];
  objects_opened: number;
  /** Mutations durably credited this run, including reconciled earlier attempts. */
  objects_rewritten: number;
  objects_deleted: number;
  rows_removed: number;
  /** Legacy field: scans completed this run; their active barriers are NOT retired. */
  retired: number;
  /** Physical scans still pending after the run, not the number of active barriers. */
  remaining: number;
  /** The run stopped at its object cap with days left; the next run continues. */
  more: boolean;
}

type Counts = Pick<Tombstone, 'rows_removed' | 'objects_rewritten' | 'objects_deleted'>;
interface RewriteJournal {
  version: 1;
  tenant: string;
  id: string;
  day: string;
  window_days: number;
  phase: 'preparing' | 'scanning' | 'finalizing';
  keys: string[];
  index: number;
  targets: Array<{ base: Tombstone; credit: Counts; successor?: Tombstone }>;
  retention?: z.infer<typeof retentionCursorSchema>;
  intent?: { before: string; after: string | null; removed: number[]; prefixLength?: number; afterLength?: number;
    appended?: { before: string; after: string; beforeLength: number; afterLength: number };
    appendedAfter?: { hash: string; length: number }; claims?: Record<string, string> };
}
const zeroCounts = (): Counts => ({ rows_removed: 0, objects_rewritten: 0, objects_deleted: 0 });
const countsValid = (c: Counts): boolean => !!c && [c.rows_removed, c.objects_rewritten, c.objects_deleted].every(n => Number.isSafeInteger(n) && n >= 0);
function failRewrite(): never { throw new Error('Erasure rewrite state unavailable or conflicting'); }
function ordinaryLegacyRawKey(key: string, tenant: string, day: string): boolean {
  const prefix = tenant + '/' + day + '/';
  if (!key.startsWith(prefix)) return false;
  const match = /^(\d{2})\/(decision|outcome|product-sort|behavior)\/([0-9a-z]{9})-([0-9a-z]{9})-([A-Za-z0-9_.-]{1,200})\.ndjson$/.exec(key.slice(prefix.length));
  if (!match || Number(match[1]) > 23 || /^managed(?:-|$)/i.test(match[5]!)) return false;
  const min = fromTs36(match[3]!), max = fromTs36(match[4]!);
  return Number.isSafeInteger(min) && min >= 0 && Number.isSafeInteger(max) && min <= max && Number.isFinite(new Date(max).getTime())
    && hourPrefix(tenant, min) === `${tenant}/${day}/${match[1]}` && hourPrefix(tenant, max) === `${tenant}/${day}/${match[1]}`;
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const stateOf = (t: Tombstone): unknown[] => [t.tenant, t.visitor_id, t.erased_at, t.actor, t.done_through,
  t.rows_removed, t.objects_rewritten, t.objects_deleted, t.rewritten_at, t.window_days, t.rewrite?.id, t.rewrite?.day];
const anchored = (j: RewriteJournal, t: Tombstone): Tombstone => ({ ...t, rewrite: { id: j.id, day: j.day } });
const totalFor = (j: RewriteJournal, target: RewriteJournal['targets'][number]): Tombstone => ({
  ...(target.successor ?? target.base), ...(!target.successor ? { done_through: j.day } : {}),
  rows_removed: target.base.rows_removed + target.credit.rows_removed,
  objects_rewritten: target.base.objects_rewritten + target.credit.objects_rewritten,
  objects_deleted: target.base.objects_deleted + target.credit.objects_deleted,
});
function monotonicSuccessor(base: Tombstone, value: Tombstone): boolean {
  return value.tenant === base.tenant && value.visitor_id === base.visitor_id && value.erased_at > base.erased_at
    && value.done_through === undefined && value.rewritten_at === undefined && value.window_days === undefined && value.rewrite === undefined
    && value.rows_removed === base.rows_removed && value.objects_rewritten === base.objects_rewritten && value.objects_deleted === base.objects_deleted;
}
function checkedRewrite(value: unknown, tenant: string): RewriteJournal {
  const j = value as RewriteJournal | null;
  if (!j || j.version !== 1 || j.tenant !== tenant || typeof j.id !== 'string' || !/^[a-f0-9]{32}$/.test(j.id)
    || !validDay(j.day) || !Number.isSafeInteger(j.window_days) || j.window_days < 1
    || !['preparing', 'scanning', 'finalizing'].includes(j.phase) || !Array.isArray(j.keys)
    || !Number.isSafeInteger(j.index) || j.index < 0 || j.index > j.keys.length
    || !Array.isArray(j.targets) || !j.targets.length) return failRewrite();
  const prefix = `${tenant}/${j.day}/`;
  if (j.retention !== undefined && !retainedCursor(j.retention, tenant)) failRewrite();
  if (j.keys.some((key, i) => typeof key !== 'string' || !key.startsWith(prefix) || key.length <= prefix.length
    || (i > 0 && key <= j.keys[i - 1]!))) return failRewrite();
  const visitors = new Set<string>();
  for (const target of j.targets) {
    if (!target || !target.base) return failRewrite();
    const t = checkedTombstone(target.base, tenant, tombstoneKey(tenant, target.base.visitor_id));
    if (t.rewrite || t.rewritten_at !== undefined || visitors.has(t.visitor_id) || !countsValid(target.credit)
      || j.day !== (t.done_through ? prevDay(t.done_through) : dayOf(t.erased_at))
      || !Number.isFinite(new Date(t.erased_at - j.window_days * DAY).getTime())
      || j.day < dayOf(t.erased_at - j.window_days * DAY)
      || target.credit.objects_rewritten + target.credit.objects_deleted > j.index
      || target.credit.rows_removed < target.credit.objects_rewritten + target.credit.objects_deleted
      || (target.credit.rows_removed > 0 && target.credit.objects_rewritten + target.credit.objects_deleted === 0)
      || !countsValid(totalFor(j, target))) return failRewrite();
    visitors.add(t.visitor_id);
    if (target.successor) {
      const successor = checkedTombstone(target.successor, tenant, tombstoneKey(tenant, t.visitor_id));
      if (!monotonicSuccessor(t, successor)) failRewrite();
    }
  }
  if (j.phase === 'preparing' && (j.index !== 0 || j.intent || j.targets.some(t => !same(t.credit, zeroCounts())))) return failRewrite();
  if (j.phase === 'finalizing' && (j.index !== j.keys.length || j.intent)) return failRewrite();
  if (j.intent !== undefined && (!j.intent || j.phase !== 'scanning' || j.index >= j.keys.length
    || typeof j.intent.before !== 'string' || !/^[a-f0-9]{64}$/.test(j.intent.before)
    || (j.intent.after !== null && (typeof j.intent.after !== 'string' || !/^[a-f0-9]{64}$/.test(j.intent.after)))
    || j.intent.before === j.intent.after || !Array.isArray(j.intent.removed) || j.intent.removed.length !== j.targets.length
    || !j.intent.removed.every(n => Number.isSafeInteger(n) && n >= 0) || !j.intent.removed.some(n => n > 0))) return failRewrite();
  if (j.intent) for (const [i, target] of j.targets.entries()) {
    const total = totalFor(j, target), removed = j.intent.removed[i]!;
    if (!countsValid({ rows_removed: total.rows_removed + removed,
      objects_rewritten: total.objects_rewritten + (removed > 0 && j.intent.after !== null ? 1 : 0),
      objects_deleted: total.objects_deleted + (removed > 0 && j.intent.after === null ? 1 : 0) })) return failRewrite();
  }
  if (j.intent?.prefixLength !== undefined && (!managedKey(j.keys[j.index]!) || !Number.isSafeInteger(j.intent.prefixLength)
    || j.intent.prefixLength < 1 || j.intent.prefixLength > 16 * 1024 * 1024 || j.intent.after === null)) failRewrite();
  if (j.intent?.afterLength !== undefined && (j.intent.prefixLength === undefined || !Number.isSafeInteger(j.intent.afterLength)
    || j.intent.afterLength < 0 || j.intent.afterLength >= j.intent.prefixLength)) failRewrite();
  if (j.intent?.appendedAfter !== undefined && (j.intent.afterLength === undefined
    || Object.keys(j.intent.appendedAfter).sort().join(',') !== 'hash,length'
    || !/^[a-f0-9]{64}$/.test(j.intent.appendedAfter.hash) || !Number.isSafeInteger(j.intent.appendedAfter.length)
    || j.intent.appendedAfter.length <= (j.intent.appended?.afterLength ?? j.intent.afterLength) || j.intent.appendedAfter.length > 16 * 1024 * 1024)) failRewrite();
  if (j.intent?.appended && (j.intent.prefixLength === undefined || Object.keys(j.intent.appended).sort().join(',') !== 'after,afterLength,before,beforeLength'
    || !/^[a-f0-9]{64}$/.test(j.intent.appended.before) || !/^[a-f0-9]{64}$/.test(j.intent.appended.after)
    || j.intent.appended.before === j.intent.appended.after || !Number.isSafeInteger(j.intent.appended.beforeLength)
    || !Number.isSafeInteger(j.intent.appended.afterLength) || j.intent.appended.beforeLength <= j.intent.prefixLength
    || j.intent.appended.beforeLength > 16 * 1024 * 1024 || j.intent.appended.afterLength < 0
    || j.intent.appended.beforeLength - j.intent.appended.afterLength !== j.intent.prefixLength - j.intent.afterLength!)) failRewrite();
  if (j.intent?.claims) checkedClaimWitness(j.intent.claims, tenant);
  if ((j.intent?.appended || j.intent?.appendedAfter) && !j.intent.claims) failRewrite();
  return j;
}

function checkedClaimWitness(value: Record<string, string>, tenant: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 2000
    || Object.entries(value).some(([key, hash]) => !/^[a-f0-9]{64}$/.test(hash)
      || !(key.startsWith(`ledger-delivery/claims/${tenant}/`) || /^ledger-delivery\/identities\/[a-f0-9-]{36}\.json$/.test(key)))) failRewrite();
}
async function recheckClaims(r2: R2Readable, tenant: string, claims: Record<string, string> = {}): Promise<void> {
  checkedClaimWitness(claims, tenant);
  for (const [key, expected] of Object.entries(claims)) {
    const bytes = await claimText(await r2.get(key), key.startsWith('ledger-delivery/claims/') ? 'partition' : 'whole');
    if (await fingerprint(bytes) !== expected) failRewrite();
  }
}
/** New suffix bytes need the writer's immutable partition AND whole-envelope
 * claims, not merely plausible transport UUIDs. V2 proves surviving original
 * ordinals; immutable v1 still requires its entire original partition. */
async function proveManagedSuffix(r2: R2Readable, tenant: string, key: string, body: string, prefixLength: number,
  metadata: Record<string, string> | undefined, prior: Record<string, string> = {}): Promise<Record<string, string>> {
  await recheckClaims(r2, tenant, prior);
  const all = managedRows(body, key, metadata), suffix = managedRows(body.slice(prefixLength), key, metadata), claims = { ...prior };
  if (!body.endsWith('\n')) failRewrite();
  const lines = body.slice(0, -1).split('\n');
  if (lines.some(line => !line)) failRewrite();
  const exact = new Map(all.map((row, index) => [`${row[DELIVERY_FIELD].id}:${row[DELIVERY_FIELD].ordinal}`, lines[index]! + '\n']));
  const stream = key.split('/')[3] as LedgerStream;
  const hour = key.split('/').slice(0, 3).join('/');
  for (const id of new Set(suffix.map(row => row[DELIVERY_FIELD].id))) {
    const rows = all.filter(row => row[DELIVERY_FIELD].id === id).sort((a, b) => a[DELIVERY_FIELD].ordinal - b[DELIVERY_FIELD].ordinal);
    const expected = { id, tenant, hour, stream };
    const path = claimKey(expected), wholePath = `ledger-delivery/identities/${id}.json`;
    const [partObject, wholeObject] = await Promise.all([r2.get(path), r2.get(wholePath)]);
    const [partBytes, wholeBytes] = await Promise.all([claimText(partObject, 'partition'), claimText(wholeObject, 'whole')]);
    const whole = JSON.parse(wholeBytes);
    if (!whole || Object.keys(whole).sort().join(',') !== 'count,digest,id,version' || whole.version !== 1 || whole.id !== id
      || !/^[a-f0-9]{64}$/.test(whole.digest) || !Number.isSafeInteger(whole.count) || whole.count < rows.length
      || rows.some(row => row[DELIVERY_FIELD].ordinal >= whole.count)) failRewrite();
    const part = readClaim(JSON.parse(partBytes), expected, whole.count);
    if (part.key !== key || rows.length > part.count) failRewrite();
    if (part.version === 1 || rows.length === part.count) {
      if (rows.length !== part.count || await fingerprint(rows.map(row => exact.get(`${id}:${row[DELIVERY_FIELD].ordinal}`)).join('')) !== part.digest) failRewrite();
    }
    if (part.version === 2) {
      const hashes = new Map(part.rows!.map(row => [row.ordinal, row.digest]));
      for (const row of rows) if (await fingerprint(exact.get(`${id}:${row[DELIVERY_FIELD].ordinal}`)!) !== hashes.get(row[DELIVERY_FIELD].ordinal)) failRewrite();
    }
    if (whole.count === rows.length) {
      const full = rows.map((row, index) => { if (row[DELIVERY_FIELD].ordinal !== index) failRewrite(); const record = { ...row }; delete (record as Record<string, unknown>)[DELIVERY_FIELD]; return { type: stream, record }; });
      if (await fingerprint(JSON.stringify(full)) !== whole.digest) failRewrite();
    }
    for (const [name, bytes] of [[path, partBytes], [wholePath, wholeBytes]]) {
      const hash = await fingerprint(bytes!); if (claims[name!] && claims[name!] !== hash) failRewrite(); claims[name!] = hash;
    }
  }
  checkedClaimWitness(claims, tenant); return claims;
}
async function readRewrite(r2: R2Readable, tenant: string): Promise<RewriteJournal | null> {
  const object = await r2.get(rewriteKey(tenant)); if (!object) return null;
  const value = JSON.parse(await object.text());
  if (value?.version === 3) { retainedJournal(value, tenant); return null; }
  if (completedRewrite(value, tenant) || retainedCursor(value, tenant)) return null;
  return observed(checkedRewrite(value, tenant), object.etag);
}
async function readRewriteSlot(r2: R2Readable, tenant: string): Promise<{ journal: RewriteJournal | null; etag: string | null; retention?: z.infer<typeof retentionCursorSchema> }> {
  const obj = await r2.get(rewriteKey(tenant));
  if (!obj) return { journal: null, etag: null };
  if (typeof obj.etag !== 'string' || !obj.etag) return failRewrite();
  const value: unknown = JSON.parse(await obj.text());
  const retention = retainedCursor(value, tenant) ? retentionCursorSchema.parse(value)
    : completedRewrite(value, tenant) ? value.retention : checkedRewrite(value, tenant).retention;
  return { journal: completedRewrite(value, tenant) || retainedCursor(value, tenant) ? null : observed(checkedRewrite(value, tenant), obj.etag), etag: obj.etag, retention };
}
/** Managed writers call after the data-object read, before every conditional append. */
export async function assertManagedWriteAvailable(r2: R2Readable, tenant: string, day: string): Promise<void> {
  const object = await r2.get(rewriteKey(tenant));
  if (object === null) return;
  if (!object || typeof object.text !== 'function') throw new Error('Managed ledger recovery required');
  const value: unknown = JSON.parse(await object.text());
  if (completedRewrite(value, tenant) || retainedCursor(value, tenant)) return;
  if ((value as { version?: number })?.version === 3) { retainedJournal(value, tenant); throw new Error('Managed ledger recovery required'); }
  const journal = checkedRewrite(value, tenant);
  if (journal.day === day) throw new Error('Managed ledger recovery required');
}
async function putJson(r2: R2Erasable, key: string, value: object, expected: object | null): Promise<void> {
  const etag = expected === null ? null : (expected as Observed)[observedEtag];
  if (etag === undefined || (etag !== null && (typeof etag !== 'string' || !etag))) return failRewrite();
  const result = await r2.put(key, JSON.stringify(value), { onlyIf: etag === null ? { etagDoesNotMatch: '*' } : { etagMatches: etag },
    httpMetadata: { contentType: 'application/json' } });
  if (!result || typeof result !== 'object' || typeof (result as { etag?: unknown }).etag !== 'string' || !(result as { etag: string }).etag) return failRewrite();
  observed(value, (result as { etag: string }).etag);
}
async function saveRewrite(r2: R2Erasable, j: RewriteJournal): Promise<void> {
  checkedRewrite(j, j.tenant);
  await putJson(r2, rewriteKey(j.tenant), j, j);
}
async function currentTarget(r2: R2Readable, tenant: string, visitor: string): Promise<Tombstone> {
  const key = tombstoneKey(tenant, visitor), obj = await r2.get(key);
  if (!obj) return failRewrite();
  return observed(checkedTombstone(JSON.parse(await obj.text()), tenant, key), obj.etag);
}
async function fingerprint(body: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function filterObject(body: string, j: RewriteJournal): { body: string | null; removed: number[] } {
  const kept: string[] = [], removed = j.targets.map(() => 0);
  const targets = new Map(j.targets.map((t, index) => [t.base.visitor_id, { at: t.base.erased_at, index }]));
  for (const line of body.split('\n')) {
    if (!line) continue;
    let rec: { visitor_id?: unknown; ts?: unknown } | null = null;
    try { rec = JSON.parse(line); } catch { kept.push(line); continue; }
    const target = typeof rec?.visitor_id === 'string' ? targets.get(rec.visitor_id) : undefined;
    if (target && typeof rec?.ts === 'number' && rec.ts <= target.at) removed[target.index]!++;
    else kept.push(line);
  }
  return { body: kept.length ? kept.join('\n') + '\n' : null, removed };
}

/**
 * One shared, manifest-bound pass per day. The object budget includes recovery
 * reads, not metadata/listing operations. The manifest still has whole-day
 * listing/memory cost; this is not a physical-deletion SLA or a concurrent-writer
 * fence. Incompatible rollback must preserve the journal and its anchors.
 */
export async function rewriteErasures(r2: R2Erasable, tenant: string, opts: { now?: number; retentionDays?: number; maxObjects?: number } = {}, ownedSubjects?: readonly string[]): Promise<RewriteResult> {
  const now = opts.now ?? Date.now(), window = opts.retentionDays ?? DEFAULT_RETENTION_DAYS, cap = opts.maxObjects ?? 5000;
  if (!validTime(now) || !Number.isSafeInteger(window) || window < 1 || !Number.isSafeInteger(cap) || cap < 1
    || !Number.isFinite(new Date(now - window * DAY).getTime())) throw new Error('Erasure scan unavailable');
  const today = dayOf(now), allTombs = await loadTombstones(r2, tenant);
  const tombs = new Map([...allTombs].filter(([subject]) => !ownedSubjects || ownedSubjects.includes(subject)));
  const slot = await readRewriteSlot(r2, tenant);
  let journal = slot.journal, journalEtag = slot.etag;
  if (journal && ownedSubjects && journal.targets.some(target => !ownedSubjects.includes(target.base.visitor_id))) failRewrite();
  for (const t of tombs.values()) if (t.rewrite && (!journal || t.rewrite.id !== journal.id || t.rewrite.day !== journal.day
    || !journal.targets.some(target => target.base.visitor_id === t.visitor_id))) failRewrite();
  const result: RewriteResult = { tenant, tombstones: tombs.size, days: [], objects_opened: 0, objects_rewritten: 0,
    objects_deleted: 0, rows_removed: 0, retired: 0, remaining: [...tombs.values()].filter(t => t.rewritten_at === undefined).length, more: false };
  const floorOf = (t: Tombstone) => dayOf(t.erased_at - window * DAY);
  const nextOf = (t: Tombstone) => t.done_through ? prevDay(t.done_through) : dayOf(t.erased_at);
  for (;;) {
    if (!journal) {
      const eligible = [...tombs.values()].filter(t => t.rewritten_at === undefined && nextOf(t) >= floorOf(t) && nextOf(t) < today);
      if (!eligible.length) break;
      if (result.objects_opened >= cap) { result.more = true; break; }
      const day = eligible.map(nextOf).sort().reverse()[0]!;
      journal = { version: 1, tenant, id: crypto.randomUUID().replace(/-/g, ''), day, window_days: window, phase: 'preparing',
        ...(slot.retention ? { retention: slot.retention } : {}),
        keys: await listKeys(r2, `${tenant}/${day}/`), index: 0,
        targets: eligible.filter(t => nextOf(t) === day).map(base => ({ base, credit: zeroCounts() })) };
      Object.assign(journal, { [observedEtag]: journalEtag });
      await saveRewrite(r2, journal); // Even ambiguous creation precedes every anchor/mutation.
    }
    let j: RewriteJournal = journal;
    if (j.window_days !== window || j.day >= today) failRewrite();
    // Complete partial anchor installation before touching any ledger object.
    for (const [position, initial] of j.targets.entries()) {
      let target = initial;
      const current = await currentTarget(r2, tenant, target.base.visitor_id);
      if (j.phase === 'preparing' && monotonicSuccessor(target.successor ?? target.base, current)) {
        // A cutoff admitted before this journal existed may win its tombstone
        // CAS before anchoring. Preserve the frozen pass and save the exact
        // successor separately; its newer scan never inherits this day's cursor.
        target = { ...target, successor: current };
        j = { ...j, targets: j.targets.map((entry, index) => index === position ? target : entry) };
        await saveRewrite(r2, j);
      }
      const expected = anchored(j, target.successor ?? target.base);
      if (j.phase === 'finalizing' && same(stateOf(current), stateOf(totalFor(j, target)))) continue;
      if (!same(stateOf(current), stateOf(expected))) {
        if (j.phase !== 'preparing' || !same(stateOf(current), stateOf(target.successor ?? target.base))) failRewrite();
        await putJson(r2, tombstoneKey(tenant, current.visitor_id), expected, current);
      }
      tombs.set(current.visitor_id, expected);
    }
    if (j.phase === 'preparing') {
      j = { ...j, phase: 'scanning' };
      await saveRewrite(r2, j);
    }
    while (j.phase === 'scanning' && j.index < j.keys.length && result.objects_opened < cap) {
      const key = j.keys[j.index]!;
      result.objects_opened++;
      const obj = await r2.get(key), body = obj ? await obj.text() : null;
      if (obj === undefined) failRewrite();
      const managed = managedKey(key);
      if (managed && obj) {
        if (!obj.etag) failRewrite();
        managedRows(body!, key, obj.customMetadata);
      }
      const before = body === null ? null : await fingerprint(body);
      if (!j.intent) {
        if (obj === null && ordinaryLegacyRawKey(key, tenant, j.day)) {
          // W06.03 compatibility: definite absence observes no removal by us.
          // Current anchors and this exact journal CAS still own the checkpoint.
          const next = { ...j, index: j.index + 1 };
          await saveRewrite(r2, next); j = next; continue;
        }
        const filtered = body === null ? null : filterObject(body, j);
        if (!filtered) failRewrite(); // A listed disappearance is not a completed scan.
        if (!filtered.removed.some(n => n > 0)) {
          const next = { ...j, index: j.index + 1 };
          await saveRewrite(r2, next); // Exact observed unchanged bytes earn zero removal credit.
          j = next;
          continue;
        }
        j = { ...j, intent: { before: before!, after: filtered.body === null && !managed ? null : await fingerprint(filtered.body ?? ''), removed: filtered.removed,
          ...(managed ? { prefixLength: body!.length, afterLength: (filtered.body ?? '').length } : {}) } };
        await saveRewrite(r2, j); // No destructive call without a durable exact intent.
      }
      let intent = j.intent!;
      await recheckClaims(r2, tenant, intent.claims);
      if (intent.appendedAfter && body !== null && filterObject(body, j).removed.some(count => count > 0)) failRewrite();
      if (managed && body !== null && before !== intent.before && before !== intent.after
        && before !== intent.appended?.before && before !== intent.appended?.after && before !== intent.appendedAfter?.hash && intent.prefixLength !== undefined) {
        const filtered = filterObject(body, j);
        const afterLength = intent.appendedAfter?.length ?? intent.appended?.afterLength ?? intent.afterLength;
        const afterHash = intent.appendedAfter?.hash ?? intent.appended?.after ?? intent.after;
        const beforeLength = intent.appended?.beforeLength ?? intent.prefixLength;
        const beforeHash = intent.appended?.before ?? intent.before;
        if (afterLength !== undefined && body.length > afterLength
          && await fingerprint(body.slice(0, afterLength)) === afterHash && filtered.removed.every(count => count === 0)) {
          intent = { ...intent, claims: await proveManagedSuffix(r2, tenant, key, body, afterLength, obj!.customMetadata, intent.claims), appendedAfter: { hash: before!, length: body.length } };
        } else {
          if (intent.appendedAfter || body.length <= beforeLength || await fingerprint(body.slice(0, beforeLength)) !== beforeHash
            || !same(filtered.removed, intent.removed)) failRewrite();
          intent = { ...intent, claims: await proveManagedSuffix(r2, tenant, key, body, beforeLength, obj!.customMetadata, intent.claims), appended: { before: before!, after: await fingerprint(filtered.body ?? ''), beforeLength: body.length, afterLength: (filtered.body ?? '').length } };
        }
        j = { ...j, intent }; await saveRewrite(r2, j);
      }
      const expectedBefore = intent.appended?.before ?? intent.before, expectedAfter = intent.appendedAfter?.hash ?? intent.appended?.after ?? intent.after;
      if (!intent.appendedAfter && before === expectedBefore && body !== null) {
        const filtered = filterObject(body, j);
        if (!same(filtered.removed, intent.removed) || (filtered.body === null && !managed ? null : await fingerprint(filtered.body ?? '')) !== expectedAfter) failRewrite();
        if (managed) {
          const put = await r2.put(key, filtered.body ?? '', { onlyIf: { etagMatches: obj!.etag },
            customMetadata: { ...obj!.customMetadata, [MANAGED_MARKER]: '1' }, httpMetadata: { contentType: 'application/x-ndjson' } });
          if (!put || typeof put !== 'object' || typeof (put as { etag?: unknown }).etag !== 'string' || !(put as { etag: string }).etag) failRewrite();
        } else if (filtered.body === null) await r2.delete(key);
        else {
          if (!obj?.etag) failRewrite();
          const put = await r2.put(key, filtered.body, { onlyIf: { etagMatches: obj.etag } });
          if (!put || typeof put !== 'object' || typeof (put as { etag?: unknown }).etag !== 'string') failRewrite();
        }
      } else if (before !== expectedAfter) failRewrite();
      await recheckClaims(r2, tenant, intent.claims);
      // Exact after-state includes absence only for an intended committed delete.
      const targets = j.targets.map((target, i) => ({
        ...target,
        credit: {
          rows_removed: target.credit.rows_removed + intent.removed[i]!,
          objects_rewritten: target.credit.objects_rewritten + (intent.removed[i]! > 0 && intent.after !== null ? 1 : 0),
          objects_deleted: target.credit.objects_deleted + (intent.removed[i]! > 0 && intent.after === null ? 1 : 0),
        },
      }));
      const next: RewriteJournal = { ...j, targets, index: j.index + 1 };
      delete next.intent;
      await saveRewrite(r2, next); // Cursor and every visitor's credit are one checkpoint.
      result.rows_removed += intent.removed.reduce((a, b) => a + b, 0);
      if (intent.after === null) result.objects_deleted++; else result.objects_rewritten++;
      j = next;
    }
    if (j.index < j.keys.length) { journal = j; result.more = true; break; }
    if (j.phase !== 'finalizing') {
      j = { ...j, phase: 'finalizing' };
      await saveRewrite(r2, j);
    }
    for (const target of j.targets) {
      const current = await currentTarget(r2, tenant, target.base.visitor_id), final = totalFor(j, target);
      if (!same(stateOf(current), stateOf(final))) {
        if (!same(stateOf(current), stateOf(anchored(j, target.successor ?? target.base)))) failRewrite();
        await putJson(r2, tombstoneKey(tenant, current.visitor_id), final, current);
      }
      tombs.set(current.visitor_id, final);
    }
    // Never delete a mutable shared journal key after a check. A compact CAS
    // completion marker cannot erase a successor or lose an ambiguous final ack.
    const completed = { version: 2, tenant, id: j.id, complete: true, ...(j.retention ? { retention: j.retention } : {}) };
    await putJson(r2, rewriteKey(tenant), completed, j);
    journalEtag = (completed as Observed)[observedEtag]!;
    result.days.push(j.day);
    journal = null;
  }
  for (const t of tombs.values()) {
    if (t.rewritten_at === undefined && !t.rewrite && t.done_through && t.done_through <= floorOf(t)) {
      const retired: RetiredTombstone = {
        tenant, visitor_hash: visitorHash(t.visitor_id), erased_at: t.erased_at, rewritten_at: now, window_days: window,
        rows_removed: t.rows_removed, objects_rewritten: t.objects_rewritten, objects_deleted: t.objects_deleted,
      };
      const auditKey = `${retiredPrefix(tenant)}${t.erased_at.toString(36)}-${retired.visitor_hash}.json`, existing = await r2.get(auditKey);
      if (existing) {
        const prior = JSON.parse(await existing.text()) as RetiredTombstone;
        if (!validTime(prior.rewritten_at) || prior.rewritten_at < t.erased_at
          || !same({ ...prior, rewritten_at: now }, retired)) failRewrite();
        retired.rewritten_at = prior.rewritten_at;
      } else await putJson(r2, auditKey, retired, null);
      const current = await currentTarget(r2, tenant, t.visitor_id);
      if (!same(stateOf(current), stateOf(t))) failRewrite();
      const completed = { ...t, rewritten_at: retired.rewritten_at, window_days: window };
      await putJson(r2, tombstoneKey(tenant, t.visitor_id), completed, current);
      tombs.set(t.visitor_id, completed);
      result.retired++;
    }
  }
  result.remaining = [...tombs.values()].filter(t => t.rewritten_at === undefined).length;
  return result;
}

/** Cutoff publication is owner-ordered with every capture. A later rewrite
 * observes those durable monotonic barriers and owns its journal/data by CAS;
 * it does not recursively acquire the potentially large historical target set. */
export async function rewriteTenantErasures(env: Env, tenant: string, options: { now?: number; retentionDays?: number; maxObjects?: number } = {}): Promise<RewriteResult> {
  const { LEDGER_OWNER_LIMIT } = await import('@/identity/sessionAuthority');
  const slot = await env.STORAGE.get(rewriteKey(tenant));
  const retained = slot ? JSON.parse(await slot.text()) : null;
  if (retained?.version === 3) {
    const retention = await rewriteExpiredLedger(env.STORAGE, tenant, options.now, options.maxObjects);
    const tombs = await loadTombstones(env.STORAGE, tenant);
    const remaining = [...tombs.values()].filter(t => t.rewritten_at === undefined).length;
    return { tenant, tombstones: tombs.size, days: [], objects_opened: retention.opened, objects_rewritten: 0, objects_deleted: 0, rows_removed: 0,
      retired: 0, remaining, more: retention.more || remaining > 0, retention };
  }
  const journal = await readRewrite(env.STORAGE, tenant), tombs = await loadTombstones(env.STORAGE, tenant);
  const subjects = journal ? journal.targets.map(target => target.base.visitor_id)
    : [...tombs.values()].filter(t => t.rewritten_at === undefined).map(t => t.visitor_id).sort().slice(0, LEDGER_OWNER_LIMIT);
  const result = await rewriteErasures(env.STORAGE, tenant, options, subjects);
  const after = await loadTombstones(env.STORAGE, tenant);
  result.tombstones = after.size;
  result.remaining = [...after.values()].filter(t => t.rewritten_at === undefined).length;
  result.more ||= result.remaining > 0;
  const remainingBudget = (options.maxObjects ?? 5000) - result.objects_opened;
  if (!await readRewrite(env.STORAGE, tenant) && remainingBudget > 0) {
    result.retention = await rewriteExpiredLedger(env.STORAGE, tenant, options.now, remainingBudget);
    result.objects_opened += result.retention.opened; result.more ||= result.retention.more;
  } else if (!result.more) result.more = true;
  return result;
}

/** Tagged physical expiry shares the existing CAS rewrite slot. It never
 * creates/advances tombstones or expires delivery claims and recovery plans. */
export async function rewriteExpiredLedger(r2: R2Erasable, tenant: string, now = Date.now(), maxObjects = 100): Promise<{ opened: number; removed: number; rewritten: number; more: boolean }> {
  if (!validTenant(tenant) || !validTime(now) || !Number.isSafeInteger(maxObjects) || maxObjects < 1) failRewrite();
  const slot = await r2.get(rewriteKey(tenant)), raw = slot ? JSON.parse(await slot.text()) : null;
  if (raw?.version === 1) { checkedRewrite(raw, tenant); return { opened: 0, removed: 0, rewritten: 0, more: true }; }
  let j: z.infer<typeof retentionRewriteSchema>;
  if (raw?.version === 3) j = retainedJournal(raw, tenant);
  else {
    if (raw !== null && !completedRewrite(raw, tenant) && !retainedCursor(raw, tenant)) failRewrite();
    const continuation = raw?.version === 4 ? retentionCursorSchema.parse(raw) : raw?.retention ? retentionCursorSchema.parse(raw.retention) : null;
    const cursor = continuation?.cursor ?? null;
    const page = await r2.list({ prefix: tenant + '/', ...(cursor === null ? {} : { cursor }), limit: 100 });
    if (!page || !Array.isArray(page.objects) || page.objects.length > 100 || typeof page.truncated !== 'boolean'
      || (page.truncated && (!page.cursor || page.cursor === cursor))) failRewrite();
    j = retainedJournal({ version: 3, tenant, id: crypto.randomUUID().replace(/-/g, ''), at: cursor === null ? now : continuation!.at,
      cursor, next: page.truncated ? page.cursor : null, keys: page.objects.map(object => object.key).sort(), index: 0, removed: 0, rewritten: 0 }, tenant);
  }
  if (slot) observed(j, slot.etag); else Object.assign(j, { [observedEtag]: null });
  const persist = async (next: typeof j) => { retainedJournal(next, tenant); await putJson(r2, rewriteKey(tenant), next, j); j = next; };
  if (raw?.version !== 3) await persist(j);
  const filter = async (body: string, key: string) => {
    if (new TextEncoder().encode(body).byteLength > 16 * 1024 * 1024) failRewrite();
    let removed = 0; const kept: string[] = [];
    for (const line of body.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
      let row: any; try { row = JSON.parse(line); } catch { kept.push(line); continue; }
      if (row?.retention?.ledger === undefined) { kept.push(line); continue; }
      const stream = key.split('/')[3], id = stream === 'decision' ? row.decision_id : stream === 'outcome' ? row.outcome_id : row.record_id;
      const carrier = typeof id === 'string' ? parseId(id) : null;
      if (!carrier || carrier.tenant !== tenant || row.tenant !== tenant || carrier.ts !== row.ts || id.split(':')[2] !== row.visitor_id
        || !key.startsWith(`${tenant}/${dayOf(row.ts)}/${String(new Date(row.ts).getUTCHours()).padStart(2, '0')}/${stream}/`)
        || !['decision', 'outcome', 'product-sort', 'behavior'].includes(stream!) || !validCarrier(row, stream as LedgerStream)) failRewrite();
      if (readRetention(row.retention.ledger, tenant, 'ledger').expiresAt <= j.at) removed++; else kept.push(line);
    }
    return { body: kept.join(''), removed };
  };
  const result = { opened: 0, removed: 0, rewritten: 0, more: true };
  while (j.index < j.keys.length && result.opened < maxObjects) {
    const key = j.keys[j.index]!;
    // Only the established raw record partition, never claims/config/aggregates.
    if (!/^[^/]+\/\d{4}-\d{2}-\d{2}\/\d{2}\/(decision|outcome|product-sort|behavior)\//.test(key)) { await persist({ ...j, index: j.index + 1 }); continue; }
    result.opened++;
    const object = await r2.get(key); if (!object || !object.etag) failRewrite();
    const body = await object.text(), hash = await fingerprint(body), managed = managedKey(key);
    if (managed) managedRows(body, key, object.customMetadata);
    const filtered = await filter(body, key);
    if (!j.intent) {
      if (!filtered.removed) { await persist({ ...j, index: j.index + 1 }); continue; }
      await persist({ ...j, intent: { before: hash, after: await fingerprint(filtered.body), removed: filtered.removed,
        beforeLength: body.length, afterLength: filtered.body.length, latestBefore: hash, latestAfter: await fingerprint(filtered.body),
        latestBeforeLength: body.length, latestAfterLength: filtered.body.length, afterProven: false } });
    }
    let intent = j.intent!;
    await recheckClaims(r2, tenant, intent.claims);
    if (hash !== intent.latestAfter && (!intent.afterProven && hash !== intent.latestBefore || intent.afterProven)) {
      if (!managed) failRewrite();
      if (body.length > intent.latestAfterLength && await fingerprint(body.slice(0, intent.latestAfterLength)) === intent.latestAfter && filtered.removed === 0) {
        intent = { ...intent, claims: await proveManagedSuffix(r2, tenant, key, body, intent.latestAfterLength, object.customMetadata, intent.claims), latestAfter: hash, latestAfterLength: body.length, afterProven: true };
      } else {
        if (intent.afterProven || body.length <= intent.latestBeforeLength || await fingerprint(body.slice(0, intent.latestBeforeLength)) !== intent.latestBefore
          || filtered.removed !== intent.removed) failRewrite();
        intent = { ...intent, claims: await proveManagedSuffix(r2, tenant, key, body, intent.latestBeforeLength, object.customMetadata, intent.claims), latestBefore: hash, latestAfter: await fingerprint(filtered.body), latestBeforeLength: body.length, latestAfterLength: filtered.body.length };
      }
      await persist({ ...j, intent });
    }
    if (!intent.afterProven && hash === intent.latestBefore) {
      if (filtered.removed !== intent.removed || await fingerprint(filtered.body) !== intent.latestAfter) failRewrite();
      const put = await r2.put(key, filtered.body, { onlyIf: { etagMatches: object.etag },
        ...(object.customMetadata ? { customMetadata: object.customMetadata } : {}), httpMetadata: { contentType: 'application/x-ndjson' } });
      if (!put || typeof put !== 'object' || typeof (put as { etag?: unknown }).etag !== 'string') failRewrite();
    } else if (hash !== intent.latestAfter) failRewrite();
    await recheckClaims(r2, tenant, intent.claims);
    const next = { ...j, index: j.index + 1, removed: j.removed + intent.removed, rewritten: j.rewritten + 1 }; delete next.intent;
    await persist(next); result.removed += intent.removed; result.rewritten++;
  }
  if (j.index === j.keys.length) {
    await putJson(r2, rewriteKey(tenant), retentionCursorSchema.parse({ version: 4, tenant, id: j.id, complete: true, cursor: j.next, at: j.at }), j);
    result.more = j.next !== null;
  }
  return result;
}

/**
 * The ledger half of an erasure, in one call for the identity route to make:
 * the tombstone, so every reader hides the rows now and the rewrite removes
 * them; and the visitor's own ring of served decisions, emptied. The profile
 * and the long index live in the shopper's object, which the identity route
 * erases itself.
 */
export async function resetVisitorRing(env: Pick<Env, 'DECISION_RING'>, tenant: string, visitorId: string): Promise<'reset' | 'unbound' | 'failed'> {
  let ring: 'reset' | 'unbound' | 'failed' = 'unbound';
  const ns = env.DECISION_RING;
  if (ns) {
    try {
      const res = await ns.get(ns.idFromName(`${tenant}:${visitorId}`)).fetch('https://learn/erase', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenant, visitorId }) });
      const body = await res.json() as { ok?: unknown; reset?: unknown };
      ring = res.ok && body.ok === true && body.reset === true ? 'reset' : 'failed';
    } catch { ring = 'failed'; }
  }
  return ring;
}

export async function eraseVisitorLedger(env: Pick<Env, 'STORAGE' | 'DECISION_RING'> & Partial<Pick<Env, 'TENANTS' | 'DEPLOYMENT_PROFILE' | 'SHOPPER_REFLEX' | 'SESSIONS'>>, tenant: string, visitorId: string, actor: string, now = Date.now()): Promise<{ ok: boolean; tombstone: { key: string; erased_at: number }; ring: 'reset' | 'unbound' | 'failed' }> {
  const { ledgerOperationHeld, ledgerUnderOwners } = await import('@/identity/sessionAuthority');
  if (!ledgerOperationHeld([{ tenant, subject: visitorId }])) {
    return ledgerUnderOwners(env as Env, { kind: 'erase', tenant, subject: visitorId, actor, now });
  }
  const { key, tombstone } = await writeTombstone(env.STORAGE as unknown as R2Erasable, tenant, visitorId, actor, now);
  const { eraseQuarantineSubject } = await import('./quarantine');
  if (!await eraseQuarantineSubject(env as Env, tenant, visitorId, tombstone.erased_at)) {
    return { ok: false, tombstone: { key, erased_at: tombstone.erased_at }, ring: 'failed' };
  }
  const ring = await resetVisitorRing(env, tenant, visitorId);
  return { ok: ring !== 'failed', tombstone: { key, erased_at: tombstone.erased_at }, ring };
}
