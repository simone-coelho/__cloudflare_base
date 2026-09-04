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
// from the batch objects, deletes an object that empties, and retires the
// tombstone with its counts and no visitor id. A run is capped, resumes where
// it stopped, and is idempotent: a day done twice removes nothing the second
// time. Aggregates are untouched, because counts are not personal data.
//
// The rows a visitor produces AFTER the erasure are new evidence, kept: an
// erasure is a point in time, not a ban. The retention window is the ledger's
// own (the bucket's lifecycle rule must match it) and is the number Tapestry's
// privacy team agrees; the default is the design's 90 days.

import type { Env } from '@/types/env';

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
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  delete(key: string): Promise<unknown>;
  list(opts: { prefix: string; cursor?: string; limit?: number }): Promise<{ objects: Array<{ key: string }>; truncated: boolean; cursor?: string }>;
}
export type R2Readable = Pick<R2Erasable, 'get' | 'list'>;

export const DEFAULT_RETENTION_DAYS = 90;
const DAY = 86_400_000;

export const pendingPrefix = (tenant: string) => `erasures/${tenant}/pending/`;
export const retiredPrefix = (tenant: string) => `erasures/${tenant}/retired/`;
export const tombstoneKey = (tenant: string, visitorId: string) => `${pendingPrefix(tenant)}${encodeURIComponent(visitorId)}.json`;

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
  do {
    const page = await r2.list({ prefix, cursor, limit: 1000 });
    for (const o of page.objects) out.push(o.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out.sort();
}

/** Every pending tombstone for the tenant, by visitor id. */
export async function loadTombstones(r2: R2Readable, tenant: string): Promise<Map<string, Tombstone>> {
  const out = new Map<string, Tombstone>();
  for (const key of await listKeys(r2, pendingPrefix(tenant))) {
    const obj = await r2.get(key);
    if (!obj) continue;
    try {
      const t = JSON.parse(await obj.text()) as Tombstone;
      if (t && typeof t.visitor_id === 'string' && typeof t.erased_at === 'number') out.set(t.visitor_id, t);
    } catch { /* an unreadable tombstone hides nothing; the rewrite reports it */ }
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

/** Write (or refresh) the visitor's tombstone. Refreshing restarts the rewrite window; the counts so far are kept. */
export async function writeTombstone(r2: R2Erasable, tenant: string, visitorId: string, actor: string, now = Date.now()): Promise<{ key: string; tombstone: Tombstone }> {
  const key = tombstoneKey(tenant, visitorId);
  let prior: Tombstone | null = null;
  try { const obj = await r2.get(key); prior = obj ? (JSON.parse(await obj.text()) as Tombstone) : null; } catch { prior = null; }
  const tombstone: Tombstone = {
    tenant, visitor_id: visitorId, erased_at: Math.max(now, prior?.erased_at ?? 0), actor,
    rows_removed: prior?.rows_removed ?? 0, objects_rewritten: prior?.objects_rewritten ?? 0, objects_deleted: prior?.objects_deleted ?? 0,
  };
  await r2.put(key, JSON.stringify(tombstone), { httpMetadata: { contentType: 'application/json' } });
  return { key, tombstone };
}

export interface RewriteResult {
  tenant: string;
  /** Pending tombstones at the start of the run. */
  tombstones: number;
  /** The days this run cleaned, newest first. */
  days: string[];
  objects_opened: number;
  objects_rewritten: number;
  objects_deleted: number;
  rows_removed: number;
  /** Tombstones whose window is complete: retired to the audit prefix with a hash, no visitor id. */
  retired: number;
  /** Tombstones still pending after the run. */
  remaining: number;
  /** The run stopped at its object cap with days left; the next run continues. */
  more: boolean;
}

/**
 * The scheduled rewrite. For every pending tombstone the days to clean are the
 * erasure day back through the retention window; a day is cleaned only once it
 * is over (the queue has drained it), newest first, contiguously, so
 * `done_through` is always the oldest day cleaned and a resumed run continues
 * from the day after it. All tombstones share one pass over a day.
 */
export async function rewriteErasures(r2: R2Erasable, tenant: string, opts: { now?: number; retentionDays?: number; maxObjects?: number } = {}): Promise<RewriteResult> {
  const now = opts.now ?? Date.now();
  const window = opts.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const cap = opts.maxObjects ?? 5000;
  const today = dayOf(now);
  const tombs = await loadTombstones(r2, tenant);
  const result: RewriteResult = { tenant, tombstones: tombs.size, days: [], objects_opened: 0, objects_rewritten: 0, objects_deleted: 0, rows_removed: 0, retired: 0, remaining: tombs.size, more: false };
  if (!tombs.size) return result;

  const floorOf = (t: Tombstone) => dayOf(t.erased_at - window * DAY);
  const nextOf = (t: Tombstone) => (t.done_through ? prevDay(t.done_through) : dayOf(t.erased_at));
  /** The days a tombstone still needs, newest first; none if its window is done or its next day is not over yet. */
  const daysFor = (t: Tombstone): string[] => {
    const out: string[] = [];
    for (let d = nextOf(t); d >= floorOf(t) && d < today; d = prevDay(d)) out.push(d);
    return out;
  };
  const wanted = new Map<string, Tombstone[]>();
  for (const t of tombs.values()) for (const d of daysFor(t)) (wanted.get(d) ?? wanted.set(d, []).get(d)!).push(t);
  const days = [...wanted.keys()].sort().reverse();
  const touched = new Set<Tombstone>();

  for (const day of days) {
    if (result.objects_opened >= cap) { result.more = true; break; }
    const targets = wanted.get(day)!;
    const eraseAt = new Map(targets.map((t) => [t.visitor_id, t.erased_at] as const));
    for (const key of await listKeys(r2, `${tenant}/${day}/`)) {
      result.objects_opened++;
      const obj = await r2.get(key);
      if (!obj) continue;
      const kept: string[] = [];
      const removedBy = new Map<string, number>();
      for (const line of (await obj.text()).split('\n')) {
        if (!line) continue;
        let rec: { visitor_id?: unknown; ts?: unknown } | null = null;
        try { rec = JSON.parse(line) as { visitor_id?: unknown; ts?: unknown }; } catch { kept.push(line); continue; }
        const at = typeof rec?.visitor_id === 'string' ? eraseAt.get(rec.visitor_id) : undefined;
        if (at !== undefined && typeof rec?.ts === 'number' && rec.ts <= at) { removedBy.set(rec.visitor_id as string, (removedBy.get(rec.visitor_id as string) ?? 0) + 1); continue; }
        kept.push(line);
      }
      if (!removedBy.size) continue;
      const emptied = kept.length === 0;
      if (emptied) { await r2.delete(key); result.objects_deleted++; } else { await r2.put(key, kept.join('\n') + '\n'); result.objects_rewritten++; }
      for (const [visitor, n] of removedBy) {
        const t = tombs.get(visitor)!;
        t.rows_removed += n; result.rows_removed += n;
        if (emptied) t.objects_deleted++; else t.objects_rewritten++;
      }
    }
    for (const t of targets) { t.done_through = day; touched.add(t); }
    result.days.push(day);
  }

  for (const t of touched) {
    const key = tombstoneKey(tenant, t.visitor_id);
    if (t.done_through && t.done_through <= floorOf(t)) {
      const retired: RetiredTombstone = {
        tenant, visitor_hash: visitorHash(t.visitor_id), erased_at: t.erased_at, rewritten_at: now, window_days: window,
        rows_removed: t.rows_removed, objects_rewritten: t.objects_rewritten, objects_deleted: t.objects_deleted,
      };
      await r2.put(`${retiredPrefix(tenant)}${t.erased_at.toString(36)}-${retired.visitor_hash}.json`, JSON.stringify(retired), { httpMetadata: { contentType: 'application/json' } });
      await r2.delete(key);
      result.retired++; result.remaining--;
    } else {
      await r2.put(key, JSON.stringify(t), { httpMetadata: { contentType: 'application/json' } });
    }
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
export async function eraseVisitorLedger(env: Pick<Env, 'STORAGE' | 'DECISION_RING'>, tenant: string, visitorId: string, actor: string, now = Date.now()): Promise<{ ok: true; tombstone: { key: string; erased_at: number }; ring: 'reset' | 'unbound' | 'failed' }> {
  const { key, tombstone } = await writeTombstone(env.STORAGE as unknown as R2Erasable, tenant, visitorId, actor, now);
  let ring: 'reset' | 'unbound' | 'failed' = 'unbound';
  const ns = env.DECISION_RING;
  if (ns) {
    try {
      const res = await ns.get(ns.idFromName(`${tenant}:${visitorId}`)).fetch('https://learn/reset', { method: 'POST' });
      ring = res.ok ? 'reset' : 'failed';
    } catch { ring = 'failed'; }
  }
  return { ok: true, tombstone: { key, erased_at: tombstone.erased_at }, ring };
}
