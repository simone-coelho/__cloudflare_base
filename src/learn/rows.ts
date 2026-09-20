// src/learn/rows.ts
// Doc 28 §4: the operator application pages, filters and sorts on the server.
// A slot's lift snapshot is one object with every item at every populated
// cell; this turns it into rows the application asks for one page at a time,
// with the catalog's names and the merchandiser's controls joined on, and
// keeps the page stable with a cursor that names the snapshot version it was
// cut from. Pure; the routes do the reading.

import type { ItemControl, SlotCatalog, ContentCatalog, LearnConfig } from '@/content/types';
import { isEligibleAt } from '@/content/lifecycle';
import { slotPins, rankedCapacity } from '@/content/slotConstraints';
import { LEVEL_WORDS, liftReferenceOf, type LiftReference, type LiftSnapshot, type Level } from './stats';
import type { SlotGovernance } from './slotGovernance';

/**
 * W26 X1.01 (F21 §8): what this estimate has been corrected for, by name.
 *
 * `uncorrected-v1` is the only value the platform can honestly write today: the
 * lift is a ratio of observed rates, and nothing in it accounts for the rank a
 * piece was shown at or for which placement it was shown in. F21 §2 measured
 * both — a 3.80× spread from rank alone against a true content difference of
 * 1.00×, and a 3.54× spread from cross-placement credit — so a reader who takes
 * the table for incremental business lift is reading it wrong, and until now
 * nothing on the row told them. It is a NAME and not a number: the correction
 * itself is an owner and Data Science decision (`W26.P1.01`), and when one is
 * agreed it arrives as a further value here, never as a silent change to `lift`.
 */
export type LiftCorrection = 'uncorrected-v1';

export interface LiftRow {
  measurementBasis: 'served-v1' | 'rendered-v1';
  /** What the estimate corrects for. See `LiftCorrection`: nothing, today. */
  correction: LiftCorrection;
  objective: 'unit' | 'revenue' | 'margin';
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
  /** W25 Z1.01: what `lift` was measured against — the slot's rate in this cell, or nothing at all. */
  liftReference: LiftReference;
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
        measurementBasis: snap.measurementBasis ?? 'served-v1', correction: 'uncorrected-v1', objective: snap.objective ?? 'unit',
        item: id, customer_item_id: nm?.customerContentId ?? null, title: nm?.title ?? null,
        key, level: st.level, level_words: LEVEL_WORDS[st.level as Level] ?? String(st.level),
        n: st.n, s: st.s, p0: st.p0, p_hat: st.p_hat, lift: st.lift, n0,
        evidence: r3(st.n / (st.n + n0)),
        liftReference: liftReferenceOf(st),
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

/**
 * The items under the slot's observation floor, least observed first: what
 * exploration serves on purpose.
 *
 * W25 V1.01 (F20 §4.4): a snapshot holds one row per item the slot has learned
 * about AND one per item an imported prior names, and an imported prior can name
 * an item the tenant's catalogue does not carry — a stale warehouse export, an
 * id that was retired. Such a row has no observation, so it sorts to the top of
 * this list and is offered to a merchandiser as the thing exploration should
 * serve next, which the decision path can never serve. `catalogue`, when the
 * caller has one, is the set of ids that exist; rows outside it are not offered.
 * Absent (a caller that has no catalogue in hand), nothing is filtered and the
 * list is exactly what it was.
 */
export function exploringRows(snap: LiftSnapshot, names: Names, floor: number, catalogue?: ReadonlySet<string>): ExploringRow[] {
  const out: ExploringRow[] = [];
  for (const [id, byKey] of Object.entries(snap.items)) {
    if (catalogue && !catalogue.has(id)) continue;
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
  /** Additive ordered fixed positions and potential ranked remainder. */
  pinnedPieceIds?: string[];
  rankedCapacity?: number;
  /** The dimensions the slot weights. */
  dimensions: string[];
  /** The rules set on the slot strategy: merchandising, stage, freshness, fatigue, diversity. */
  rules: string[];
  /** Pieces in the catalog eligible for the slot right now. */
  pieces: number;
  reward: string;
  objective: string;
  /** Legacy index inputs omit this and mean served-v1; current writers emit it. */
  measurementBasis?: 'served-v1' | 'rendered-v1';
  gamma: number;
  exploration: string;
  /** Retained unsupported configuration, not an active exploration policy. */
  configuredExploration?: 'thompson';
  autonomy: string;
  controls: number;
  /** Filled by the route when asked: what the slot has learned so far. */
  evidence?: { items: number; events: number; publishedAt: number } | null;
  /**
   * W20 G2 (R83, R86(a)): filled by the route beside `evidence`, under the same
   * flag and the same budget — what the decision path REFUSED for this slot
   * since the horizon the block states: the dead pins, with the reason the
   * composer recorded, and the times the pinned slot could not fill its `take`.
   * Zero is reported as zero; it reports configuration, never shopper state.
   */
  governance?: SlotGovernance;
}

/**
 * What one slot has learned, as the slots index reports it.
 *
 * W25 V1.01 (F20 §4.4): `items` counts the items of the TENANT'S CATALOGUE this
 * slot holds evidence or a prior for. A prior row for an id the catalogue does
 * not carry is still in the snapshot — it is what the tenant imported — but it
 * is not something the slot has learned about, because no decision can ever
 * serve it; counting it told an operator the slot knew about three pieces when
 * the page can only ever show two.
 */
export function slotEvidence(snap: LiftSnapshot | null, catalogue: ReadonlySet<string>): SlotIndexEntry['evidence'] {
  if (!snap) return null;
  let items = 0;
  for (const id of Object.keys(snap.items ?? {})) if (catalogue.has(id)) items++;
  return { items, events: snap.events, publishedAt: snap.publishedAt };
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
        pinnedPieceIds: [...slotPins(s)], rankedCapacity: rankedCapacity(s),
        dimensions: Object.keys(s.weights).filter((k) => (s.weights[k] ?? 0) > 0),
        rules, pieces: live.filter((p) => p.slotTypes.includes(s.slot)).length,
        reward: d.reward ?? 'click', objective: d.objective ?? 'unit', gamma: d.gamma ?? 0,
        measurementBasis: d.measurementBasis ?? 'served-v1',
        exploration: d.exploration?.mode === 'thompson' ? 'off' : d.exploration?.mode ?? 'off',
        ...(d.exploration?.mode === 'thompson' ? { configuredExploration: 'thompson' as const } : {}),
        autonomy: d.autonomy?.mode ?? 'configured',
        controls: Object.keys(d.items ?? {}).length,
      });
      total++;
    }
    if (entries.length) pages.push({ page, slots: entries });
  }
  return { total, pages };
}
