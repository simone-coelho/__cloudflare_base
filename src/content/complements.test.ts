// src/content/complements.test.ts
// A piece's `complements` (the products it completes) and a slot's
// `complements` rule, which passes the composer's `prefer` hook so the pieces
// completing the anchor product the request names (`ctx.anchor`) are preferred
// and say so on the receipt. Fails closed: no anchor named, nothing preferred.

import { describe, it, expect } from 'vitest';
import { validateContentCatalog, validateSlotCatalog } from './kinds';
import { ANCHOR_SIGNAL, decideContent, type DecideInput } from './decide';
import { candidatesFrom } from './import';
import { receiptOf } from '@/learn/receipts';
import type { ContentPiece, SlotStrategy } from './types';

const piece = (id: string, tags: Record<string, string[]>, extra: Partial<ContentPiece> = {}): ContentPiece =>
  ({ id, customerContentId: `cms-${id}`, type: 'module', title: id, tags, slotTypes: ['companions'], lifecycle: { status: 'live' }, ...extra });

// Two companions with identical tags: only `complements` tells them apart.
const dryer = piece('dryer-gas', { finish: ['black-steel'] }, { complements: ['WM4000HBA', 'WM6700HBA'], featuredProductIds: ['DLG4000B'] });
const pedestal = piece('pedestal', { finish: ['black-steel'] }, { complements: ['WM9999XYZ'] });
const plain = piece('protection', { finish: ['black-steel'] });
const slot: SlotStrategy = { slot: 'companions', take: 3, weights: { finish: 0.4 }, complements: { weight: 0.3 } };

const base: DecideInput = {
  tenant: 'oh', brand: 'oh', page: 'washer', visitorId: 'v1', sessionId: 's1', identityAnchor: 'session', nowMs: 1_790_000_000_000,
  pieces: [plain, pedestal, dryer], slots: [slot], affinity: { dims: { finish: { 'black-steel': 0.5 } } },
  cell: { channel: 'organic', visit_bucket: '1', region: 'US-NC', affinity: 'finish:black-steel' },
  arm: 'personalized', versions: { config: 1, lift: 0, prior: 0, policy: 0 }, configLabel: 'oh-v1',
};
const withAnchor = (anchor: string | undefined, over: Partial<DecideInput> = {}): DecideInput =>
  ({ ...base, ...(anchor === undefined ? {} : { eligibility: { signals: { [ANCHOR_SIGNAL]: anchor } } }), ...over });
const order = (input: DecideInput) => decideContent(input).decisions.map((d) => d.contentId);
const names = new Map<string, { customerContentId: string; title: string }>();

describe('the piece field complements', () => {
  it('is validated like featuredProductIds: an array of product id strings, trimmed, de-duplicated, empty entries dropped', () => {
    const ok = validateContentCatalog({ pieces: [{ ...plain, complements: [' WM4000HBA ', 'WM4000HBA', 'WM6700HBA'] }] });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.pieces[0]!.complements).toEqual(['WM4000HBA', 'WM6700HBA']);
    // An empty list is the same as none, exactly as an empty featuredProductIds is.
    const empty = validateContentCatalog({ pieces: [{ ...plain, complements: [] }] });
    expect(empty.ok && Object.hasOwn(empty.value.pieces[0]!, 'complements')).toBe(false);
    for (const bad of ['WM4000HBA', [1], [''], [null], {}]) {
      const r = validateContentCatalog({ pieces: [{ ...plain, complements: bad }] });
      expect(r.ok, JSON.stringify(bad)).toBe(false);
      if (!r.ok) expect(r.errors).toEqual(['pieces[0].complements: array of product id strings']);
    }
  });

  it('travels through the feed adapter under its own name, as a list or a pipe-separated cell', () => {
    const [json, csv] = candidatesFrom([{ ...plain, complements: ['A', 'B'] }, { ...plain, id: 'p2', complements: 'A|B' }]);
    expect(json!.complements).toEqual(['A', 'B']);
    expect(csv!.complements).toEqual(['A', 'B']);
  });
});

describe('the slot rule complements', () => {
  it('takes one weight in the engine’s 0..1 rule range and refuses anything else', () => {
    const ok = validateSlotCatalog({ pages: { washer: [{ ...slot, complements: { weight: 0.3 } }] } });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.pages.washer![0]!.complements).toEqual({ weight: 0.3 });
    for (const bad of [{ weight: 1.5 }, { weight: -0.1 }, { weight: '0.3' }, {}, 0.3, null]) {
      const r = validateSlotCatalog({ pages: { washer: [{ ...slot, complements: bad }] } });
      expect(r.ok, JSON.stringify(bad)).toBe(false);
      if (!r.ok) expect(r.errors).toEqual(['pages.washer[0].complements: { weight 0..1 }']);
    }
  });

  it('prefers the piece that completes the anchor the request names, through the composer’s prefer hook, and says so', () => {
    expect(order(withAnchor(undefined))).toEqual(['protection', 'pedestal', 'dryer-gas']);
    const set = decideContent(withAnchor('WM4000HBA'));
    expect(set.decisions.map((d) => d.contentId)).toEqual(['dryer-gas', 'protection', 'pedestal']);
    const first = set.records[0]!;
    // 0.5 × 0.4 from her finish, plus the rule's 0.3 for completing the washer she is looking at.
    expect(first.explain.score_base).toBeCloseTo(0.5, 6);
    expect(first.explain.drivers).toContainEqual({ dim: 'completes', value: 'WM4000HBA', a: 1, weight: 0.3 });
    expect(first.authority).toBe('engine');
    // Itemised on the receipt in the words the receipt already has for a completes driver.
    expect(receiptOf(first, names).why).toContain('Completes what she committed to: WM4000HBA (+0.3).');
    // The pieces that do not complete it carry no such driver and no such sentence.
    for (const r of set.records.slice(1)) {
      expect(r.explain.drivers.some((d) => d.dim === 'completes')).toBe(false);
      expect(receiptOf(r, names).why.some((w) => w.startsWith('Completes'))).toBe(false);
    }
    // The other id it lists completes it just as well; the match is exact, never a prefix.
    expect(order(withAnchor('WM6700HBA'))[0]).toBe('dryer-gas');
    expect(order(withAnchor('WM4000'))[0]).toBe('protection');
  });

  it('itemises the completes driver even where four stronger interest terms would push it off the served explain', () => {
    const tags = { a: ['1'], b: ['1'], c: ['1'], d: ['1'] };
    const strong = piece('strong', tags, { complements: ['TV-65'] });
    const page: SlotStrategy = { slot: 'companions', take: 1, weights: { a: 1, b: 1, c: 1, d: 1 }, complements: { weight: 0.05 } };
    const set = decideContent(withAnchor('TV-65', { pieces: [strong], slots: [page], affinity: { dims: { a: { 1: 0.9 }, b: { 1: 0.9 }, c: { 1: 0.9 }, d: { 1: 0.9 } } } }));
    const drivers = set.records[0]!.explain.drivers;
    expect(drivers.filter((d) => d.dim === 'completes')).toEqual([{ dim: 'completes', value: 'TV-65', a: 1, weight: 0.05 }]);
    expect(drivers.filter((d) => d.dim !== 'completes')).toHaveLength(4);
    expect(receiptOf(set.records[0]!, names).why).toContain('Completes what she committed to: TV-65 (+0.05).');
  });

  it('fails closed: no anchor, an anchor nothing completes, a zero weight, the default arm and a pin all prefer nothing', () => {
    const bare = decideContent(withAnchor(undefined));
    const cases: Array<[string, DecideInput]> = [
      ['no anchor named', withAnchor(undefined)],
      ['an empty anchor', withAnchor('   ')],
      ['an anchor no piece completes', withAnchor('NOTHING-COMPLETES-THIS')],
      ['a zero weight', withAnchor('WM4000HBA', { slots: [{ ...slot, complements: { weight: 0 } }] })],
      ['a slot with no rule', withAnchor('WM4000HBA', { slots: [{ slot: 'companions', take: 3, weights: { finish: 0.4 } }] })],
    ];
    for (const [why, input] of cases) {
      const set = decideContent(input);
      expect(set.decisions.map((d) => d.contentId), why).toEqual(bare.decisions.map((d) => d.contentId));
      expect(set.records.map((r) => r.explain.score_base), why).toEqual(bare.records.map((r) => r.explain.score_base));
      expect(set.records.some((r) => r.explain.drivers.some((d) => d.dim === 'completes')), why).toBe(false);
    }
    // The holdout's default arm is the site's own defaults: catalogue order, nothing preferred.
    const holdout = decideContent(withAnchor('WM4000HBA', { arm: 'default' }));
    expect(holdout.decisions.map((d) => d.contentId)).toEqual(['protection', 'pedestal', 'dryer-gas']);
    expect(holdout.records.every((r) => r.explain.drivers.length === 0 && r.authority === 'default')).toBe(true);
    // A pinned position never ranked, so it is never said to have completed anything.
    const pinned = decideContent(withAnchor('WM4000HBA', { slots: [{ ...slot, take: 1, pinnedPieceId: 'dryer-gas' }] }));
    expect(pinned.records[0]).toMatchObject({ item_id: 'dryer-gas', authority: 'pin' });
    expect(pinned.records[0]!.explain.drivers).toEqual([]);
  });

  it('is deterministic in its inputs, and the anchor is the only request context it reads', () => {
    const input = withAnchor('WM4000HBA');
    expect(decideContent(input)).toEqual(decideContent(input));
    const other = decideContent({ ...input, eligibility: { signals: { [ANCHOR_SIGNAL]: 'WM4000HBA', weather: 'snow' } } });
    expect(other.decisions.map((d) => d.contentId)).toEqual(['dryer-gas', 'protection', 'pedestal']);
    // The name the request contract carries it under.
    expect(ANCHOR_SIGNAL).toBe('anchor');
  });
});
