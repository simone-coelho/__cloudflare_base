// src/learn/rows.test.ts
// Doc 28: the grid is paged, filtered and sorted by the server; cells are a
// drill-down per item; the cursor is bound to the snapshot version; the slots
// index groups every slot by page with what is set on it.

import { describe, it, expect } from 'vitest';
import { decodeCursor, encodeCursor, exploringRows, pageOf, pageRows, rowsOf, slotsIndex } from './rows';
import type { LiftSnapshot } from './stats';
import type { ContentCatalog, LearnConfig, SlotCatalog } from '@/content/types';

const st = (level: number, key: string, n: number, s: number, lift: number) => ({ level: level as 0 | 1 | 2 | 3 | 4 | 5, key, n, s, p0: 0.07, n0: 30, p_hat: 0.07 * lift, lift });
const snap: LiftSnapshot = {
  tenant: 'coach', brand: 'coach', slot: 'hero', reward: 'click', objective: 'unit', version: 1000, publishedAt: 1000, events: 60,
  n0: 30, nMin: 30, liftMin: 0.5, liftMax: 2, priorVersion: 0,
  items: {
    a: { '*': st(0, '*', 40, 5, 1.4), 'c=paid': st(1, 'c=paid', 30, 4, 1.5), 'c=paid|v=1': st(2, 'c=paid|v=1', 10, 1, 1.1) },
    b: { '*': st(0, '*', 20, 1, 0.8), 'c=paid': st(1, 'c=paid', 20, 1, 0.8) },
    c: { '*': st(0, '*', 5, 0, 0.9) },
  },
  slotRates: { '*': { n: 65, s: 6, rate: 0.07 } },
};
const names = new Map([['a', { customerContentId: 'CCH-001', title: 'The Tabby Shop' }], ['b', { customerContentId: 'CCH-003', title: 'Three ways' }]]);
const controls = { b: { mode: 'freeze' as const, lift: 1.2 } };

describe('the grid, paged by the server', () => {
  it('the pooled row per item, names and controls joined, sorted by lift by default', () => {
    const rows = rowsOf(snap, names, controls, 'pooled');
    expect(rows.map((r) => r.item)).toEqual(['a', 'b', 'c']);
    const page = pageRows(rows, { level: 'pooled' });
    expect(page.rows.map((r) => [r.item, r.customer_item_id, r.lift, r.control])).toEqual([['a', 'CCH-001', 1.4, null], ['c', null, 0.9, null], ['b', 'CCH-003', 0.8, 'freeze']]);
    expect(page.rows[0]).toMatchObject({ level: 0, level_words: 'everyone', n: 40, s: 5, evidence: 0.571 });
    expect([page.total, page.offset, page.limit, page.next]).toEqual([3, 0, 50, null]);
  });

  it('cells are a drill-down per item, never the whole table', () => {
    const all = rowsOf(snap, names, undefined, 'cells');
    expect(all.map((r) => `${r.item}:${r.key}`)).toEqual(['a:c=paid', 'a:c=paid|v=1', 'b:c=paid']);
    const one = rowsOf(snap, names, undefined, 'cells', 'a');
    expect(one.map((r) => r.key)).toEqual(['c=paid', 'c=paid|v=1']);
    expect(one[1]!.level_words).toBe('channel and visit bucket');
  });

  it('filters by id, customer id, title or cell, sorts by any column either way, and cuts pages with a next offset', () => {
    const rows = rowsOf(snap, names, controls, 'pooled');
    expect(pageRows(rows, { level: 'pooled', q: 'tabby' }).rows.map((r) => r.item)).toEqual(['a']);
    expect(pageRows(rows, { level: 'pooled', q: 'cch-003' }).rows.map((r) => r.item)).toEqual(['b']);
    expect(pageRows(rows, { level: 'pooled', sort: 'n', dir: 'asc' }).rows.map((r) => r.item)).toEqual(['c', 'b', 'a']);
    expect(pageRows(rows, { level: 'pooled', sort: 'name' }).rows.map((r) => r.item)).toEqual(['c', 'a', 'b']);   // an unnamed item sorts by its id
    const p1 = pageRows(rows, { level: 'pooled', limit: 2 });
    expect([p1.rows.map((r) => r.item), p1.total, p1.next]).toEqual([['a', 'c'], 3, 2]);
    const p2 = pageRows(rows, { level: 'pooled', limit: 2, offset: 2 });
    expect([p2.rows.map((r) => r.item), p2.next]).toEqual([['b'], null]);
    expect(pageRows(rows, { level: 'pooled', limit: 9999 }).limit).toBe(500);
  });

  it('the cursor carries the version and the query and refuses what it cannot read', () => {
    const c = encodeCursor({ v: 1000, o: 50, level: 'pooled', q: 'tab', sort: 'n', dir: 'asc', limit: 50 });
    expect(c).not.toMatch(/[+/=]/);
    expect(decodeCursor(c)).toEqual({ v: 1000, o: 50, level: 'pooled', q: 'tab', sort: 'n', dir: 'asc', limit: 50 });
    expect(decodeCursor('not-a-cursor')).toBeNull();
    expect(decodeCursor(encodeCursor({ v: 1, o: 0, level: 'nope' as 'pooled' }))).toBeNull();
  });
});

describe('what is exploring, paged', () => {
  it('lists the items under the floor, least observed first, and pages any list', () => {
    const rows = exploringRows(snap, names, 30);
    expect(rows).toEqual([{ item: 'c', customer_item_id: null, title: null, n: 5, to_floor: 25 }, { item: 'b', customer_item_id: 'CCH-003', title: 'Three ways', n: 20, to_floor: 10 }]);
    expect(exploringRows(snap, names, 5)).toEqual([]);
    const p = pageOf(rows, 1, 1);
    expect([p.total, p.offset, p.limit, p.rows.map((r) => r.item), p.next]).toEqual([2, 1, 1, ['b'], null]);
    expect(pageOf(rows, 0, 0).limit).toBe(50);
  });
});

describe('the slots index', () => {
  const slots: SlotCatalog = { pages: {
    home: [{ slot: 'merch', take: 1, weights: {}, pinnedPieceId: 'm' }, { slot: 'hero', take: 1, weights: { line: 0.3, occasion: 0 }, stage: { outOfStage: 0.5 }, freshness: { weight: 0.2, halfLifeDays: 7 } }],
    pdp: [{ slot: 'rail', take: 3, weights: { line: 0.3 }, diversity: { dimension: 'line', max: 1 }, merchandising: { season: 0.2 } }],
  } };
  const piece = (id: string, slotTypes: string[], status: 'live' | 'draft' = 'live') => ({ id, customerContentId: id, type: 't', title: id, tags: {}, slotTypes, lifecycle: { status } });
  const catalog: ContentCatalog = { pieces: [piece('m', ['merch']), piece('h1', ['hero', 'rail']), piece('h2', ['hero'], 'draft'), piece('r1', ['rail'])] };
  const learn: LearnConfig = { holdout: { share: 0, salt: '', arms: ['default'] }, slots: { hero: { reward: 'click', gamma: 0.5, exploration: { mode: 'rotation', share: 0.1, floor: 50 }, items: { h1: { mode: 'reject' } } }, rail: { reward: 'purchase', objective: 'revenue' } } };

  it('groups every slot by page with what is set on it, and counts the pieces eligible now', () => {
    const idx = slotsIndex(slots, catalog, learn, Date.now());
    expect(idx.total).toBe(3);
    expect(idx.pages.map((p) => [p.page, p.slots.map((s) => s.slot)])).toEqual([['home', ['merch', 'hero']], ['pdp', ['rail']]]);
    const hero = idx.pages[0]!.slots[1]!;
    expect(hero).toMatchObject({ take: 1, pinned: null, dimensions: ['line'], rules: ['stage', 'freshness'], pieces: 1, reward: 'click', objective: 'unit', gamma: 0.5, exploration: 'rotation', autonomy: 'configured', controls: 1 });
    const rail = idx.pages[1]!.slots[0]!;
    expect(rail).toMatchObject({ rules: ['merchandising', 'diversity'], pieces: 2, reward: 'purchase', objective: 'revenue' });
    expect(idx.pages[0]!.slots[0]).toMatchObject({ pinned: 'm', pieces: 1 });
  });

  it('narrows by slot or page name', () => {
    expect(slotsIndex(slots, catalog, learn, Date.now(), 'rai').pages.map((p) => p.slots.map((s) => s.slot))).toEqual([['rail']]);
    expect(slotsIndex(slots, catalog, learn, Date.now(), 'HOME').total).toBe(2);
    expect(slotsIndex(slots, catalog, learn, Date.now(), 'zzz')).toEqual({ total: 0, pages: [] });
  });
});
