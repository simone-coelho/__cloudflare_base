// src/learn/rows.ts
// Doc 28 §4: the operator application pages, filters and sorts on the server.
// A slot's lift snapshot is one object with every item at every populated
// cell; this turns it into rows the application asks for one page at a time,
// with the catalog's names and the merchandiser's controls joined on, and
// keeps the page stable with a cursor that names the snapshot version it was
// cut from. Pure; the routes do the reading.

import type { ItemControl, SlotCatalog, ContentCatalog, LearnConfig } from '@/content/types';
import { isEligibleAt } from '@/content/lifecycle';
import { LEVEL_WORDS, type LiftSnapshot, type Level } from './stats';

export interface LiftRow {
  item: string;
  customer_item_id: string | null;
  title: string | null;
  key: string;
  level: number;
  level_words: string;
  n: number;
  s: number;
  p0: number;
  p_hat: number;
  lift: number;
  n0: number;
  /** n over n plus n₀: how much of the estimate is live observation rather than the prior. */
  evidence: number;
  prior: { p: number; n: number } | null;
  control: 'freeze' | 'reject' | null;
}

export const SORT_KEYS = ['item', 'name', 'key', 'n', 's', 'p_hat', 'p0', 'lift', 'evidence'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type RowLevel = 'pooled' | 'cells' | 'exploring';

export interface RowsQuery {
  level: RowLevel;
  /** Only this item's rows (the drill-down into its cells). */
  item?: string;
  /** Substring, case-insensitive, over the item id, the customer's id, the title and the cell key. */
  q?: string;
  sort?: SortKey;
  dir?: 'asc' | 'desc';
  offset?: number;
  limit?: number;
}

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export type Names = ReadonlyMap<string, { customerContentId?: string; title?: string }>;

/** Every row of the snapshot at the level asked, names and controls joined on. */
export function rowsOf(snap: LiftSnapshot, names: Names, controls: Record<string, ItemControl> | undefined, level: RowLevel, item?: string): LiftRow[] {
  const out: LiftRow[] = [];
  for (const [id, byKey] of Object.entries(snap.items)) {
    if (item && id !== item) continue;
    const nm = names.get(id);
    for (const [key, st] of Object.entries(byKey)) {
      if (level === 'pooled' ? key !== '*' : key === '*') continue;
      const n0 = st.n0 ?? snap.n0;
      out.push({
        item: id, customer_item_id: nm?.customerContentId ?? null, title: nm?.title ?? null,
        key, level: st.level, level_words: LEVEL_WORDS[st.level as Level] ?? String(st.level),
        n: st.n, s: st.s, p0: st.p0, p_hat: st.p_hat, lift: st.lift, n0,
        evidence: r3(st.n / (st.n + n0)),
        prior: st.prior ?? null,
        control: controls?.[id]?.mode ?? null,
      });
    }
  }
  return out;
}

const nameOf = (r: LiftRow) => r.customer_item_id ?? r.title ?? r.item;

/** One page: filtered, sorted, cut. `total` counts what matched, not what was cut. */
export function pageRows(rows: readonly LiftRow[], q: RowsQuery): { total: number; offset: number; limit: number; rows: LiftRow[]; next: number | null } {
  const needle = (q.q ?? '').trim().toLowerCase();
  const matched = needle
    ? rows.filter((r) => r.item.toLowerCase().includes(needle) || (r.customer_item_id ?? '').toLowerCase().includes(needle) || (r.title ?? '').toLowerCase().includes(needle) || r.key.toLowerCase().includes(needle))
    : [...rows];
  const sort: SortKey = q.sort && (SORT_KEYS as readonly string[]).includes(q.sort) ? q.sort : 'lift';
  const dir = q.dir === 'asc' ? 1 : q.dir === 'desc' ? -1 : (sort === 'item' || sort === 'name' || sort === 'key' ? 1 : -1);
  const valueOf = (r: LiftRow): string | number => (sort === 'name' ? nameOf(r) : (r as unknown as Record<string, string | number>)[sort]);
  matched.sort((a, b) => {
    const x = valueOf(a), y = valueOf(b);
    const c = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y) : Number(x) - Number(y);
    return c * dir || a.item.localeCompare(b.item) || a.level - b.level;
  });
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(q.limit ?? DEFAULT_LIMIT)));
  const offset = Math.max(0, Math.floor(q.offset ?? 0));
  const page = matched.slice(offset, offset + limit);
  return { total: matched.length, offset, limit, rows: page, next: offset + limit < matched.length ? offset + limit : null };
}

/** The cursor names the snapshot version and the query it belongs to, so a page never straddles two snapshots. */
export interface Cursor { v: number; o: number; level: RowLevel; item?: string; q?: string; sort?: SortKey; dir?: 'asc' | 'desc'; limit?: number }
const b64 = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))));
export const encodeCursor = (c: Cursor): string => b64(JSON.stringify(c));
export function decodeCursor(s: string | undefined | null): Cursor | null {
  if (!s) return null;
  try {
    const c = JSON.parse(unb64(s)) as Cursor;
    return c && typeof c.v === 'number' && typeof c.o === 'number' && (c.level === 'pooled' || c.level === 'cells' || c.level === 'exploring') ? c : null;
  } catch { return null; }
}

// ── What is exploring ────────────────────────────────────────────────────────

export interface ExploringRow { item: string; customer_item_id: string | null; title: string | null; n: number; to_floor: number }

/** The items under the slot's observation floor, least observed first: what exploration serves on purpose. */
export function exploringRows(snap: LiftSnapshot, names: Names, floor: number): ExploringRow[] {
  const out: ExploringRow[] = [];
  for (const [id, byKey] of Object.entries(snap.items)) {
    const n = byKey['*']?.n ?? 0;
    if (n >= floor) continue;
    const nm = names.get(id);
    out.push({ item: id, customer_item_id: nm?.customerContentId ?? null, title: nm?.title ?? null, n: r3(n), to_floor: r3(floor - n) });
  }
  return out.sort((a, b) => a.n - b.n || a.item.localeCompare(b.item));
}

/** A plain page of any list, with the next offset. */
export function pageOf<T>(list: readonly T[], offset: number, limit: number): { total: number; offset: number; limit: number; rows: T[]; next: number | null } {
  const lim = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit || DEFAULT_LIMIT)));
  const off = Math.max(0, Math.floor(offset || 0));
  return { total: list.length, offset: off, limit: lim, rows: list.slice(off, off + lim), next: off + lim < list.length ? off + lim : null };
}

// ── The slots index ──────────────────────────────────────────────────────────

export interface SlotIndexEntry {
  page: string;
  slot: string;
  take: number;
  pinned: string | null;
  /** The dimensions the slot weights. */
  dimensions: string[];
  /** The rules set on the slot strategy: merchandising, stage, freshness, fatigue, diversity. */
  rules: string[];
  /** Pieces in the catalog eligible for the slot right now. */
  pieces: number;
  reward: string;
  objective: string;
  gamma: number;
  exploration: string;
  autonomy: string;
  controls: number;
  /** Filled by the route when asked: what the slot has learned so far. */
  evidence?: { items: number; events: number; publishedAt: number } | null;
}

/** Every slot on every page, grouped by page, with what is configured on it; `q` narrows by slot or page name. */
export function slotsIndex(slots: SlotCatalog, catalog: ContentCatalog, learn: LearnConfig, nowMs: number, q?: string): { total: number; pages: Array<{ page: string; slots: SlotIndexEntry[] }> } {
  const needle = (q ?? '').trim().toLowerCase();
  const live = catalog.pieces.filter((p) => isEligibleAt(p, nowMs));
  const pages: Array<{ page: string; slots: SlotIndexEntry[] }> = [];
  let total = 0;
  for (const [page, list] of Object.entries(slots.pages)) {
    const entries: SlotIndexEntry[] = [];
    for (const s of list) {
      if (needle && !s.slot.toLowerCase().includes(needle) && !page.toLowerCase().includes(needle)) continue;
      const d = learn.slots?.[s.slot] ?? {};
      const rules: string[] = [];
      if (s.merchandising && Object.values(s.merchandising).some((v) => v)) rules.push('merchandising');
      if (s.stage) rules.push('stage');
      if (s.freshness) rules.push('freshness');
      if (s.fatigue) rules.push('fatigue');
      if (s.diversity) rules.push('diversity');
      entries.push({
        page, slot: s.slot, take: s.take, pinned: s.pinnedPieceId ?? null,
        dimensions: Object.keys(s.weights).filter((k) => (s.weights[k] ?? 0) > 0),
        rules, pieces: live.filter((p) => p.slotTypes.includes(s.slot)).length,
        reward: d.reward ?? 'click', objective: d.objective ?? 'unit', gamma: d.gamma ?? 0,
        exploration: d.exploration?.mode ?? 'off', autonomy: d.autonomy?.mode ?? 'configured',
        controls: Object.keys(d.items ?? {}).length,
      });
      total++;
    }
    if (entries.length) pages.push({ page, slots: entries });
  }
  return { total, pages };
}
