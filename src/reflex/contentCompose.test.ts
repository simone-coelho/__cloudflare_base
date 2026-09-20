// src/reflex/contentCompose.test.ts
// The candidate sets the ledger records: what was considered, in rank order,
// with the chosen pieces included — and the decisions unchanged by asking for them.

import { describe, it, expect } from 'vitest';
import { composeContent, composeContentDetailed, HISTORICAL_GOVERNANCE, HISTORICAL_GOVERNANCE_V1, HISTORICAL_PINS, type ContentPieceLike, type ContentSlotSpec, type AffinityViewLike } from './contentCompose';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const piece = (id: string, tags: Record<string, string[]>, slots: string[]): ContentPieceLike =>
  ({ id, customerContentId: `cms-${id}`, type: 'editorial', title: id, tags, slotTypes: slots });

const pieces = [
  piece('a', { occasion: ['evening'], line: ['drover'] }, ['hero', 'story']),
  piece('b', { occasion: ['weekend'] }, ['hero', 'story']),
  piece('c', { line: ['drover'] }, ['story']),
  piece('p', {}, ['merch']),
];
const slots: ContentSlotSpec[] = [
  { slot: 'merch', take: 1, weights: {}, pinnedPieceId: 'p' },
  { slot: 'hero', take: 1, weights: { occasion: 0.35, line: 0.25 } },
  { slot: 'story', take: 2, weights: { occasion: 0.3, line: 0.25 } },
];
const affinity = { dims: { occasion: { evening: 0.8 }, line: { drover: 0.7 } } };

describe('composeContentDetailed', () => {
  it('W20.05 reserves atomic ordered prefixes and ranks only their captured eligible remainder', () => {
    const corpus = ['a', 'b', 'c', 'd', 'e'].map(id => piece(id, { topic: [id], group: [id === 'd' ? 'other' : 'same'] }, ['hero', 'first', 'later', 'owner']));
    const page: ContentSlotSpec[] = [{ slot: 'hero', take: 4, weights: { topic: 1 }, pinnedPieceIds: ['b', 'a'], diversity: { dimension: 'group', max: 1 }, excludedPieceIds: ['e'] }];
    for (const view of [affinity, { dims: {} }]) {
      const calls: string[] = [];
      const out = composeContentDetailed(corpus, view, page, 10, p => { calls.push(p.id); return 1; }, (_slot, ranked) => ({ first: ranked[0]!.id }));
      expect(out.decisions.map(d => d.contentId)).toEqual(['b', 'a', 'd', 'c']);
      expect(out.decisions.map(d => d.strategy)).toEqual(['tenant-pinned', 'tenant-pinned', 'affinity', 'affinity']);
      expect(out.decisions[3]!.explain.diversity?.relaxed).toBe(true);
      expect(calls).toEqual(['c', 'd']); expect(out.candidates.hero?.map(p => p.contentId)).toEqual(['c', 'd']);
    }
    for (const patch of [{ pinnedPieceIds: ['a', 'missing'] }, { pinnedPieceIds: ['a', 'b'], excludedPieceIds: ['b'] },
      { pinnedPieceIds: ['a', 'b'], excludedTags: [{ dimension: 'topic', value: 'b' }] },
      { pinnedPieceIds: ['a', 'b'], allowedTypes: ['film'] }, { pinnedPieceIds: ['a', 'b'], offLimits: true }]) {
      const out = composeContentDetailed(corpus, affinity, [{ ...page[0]!, ...patch }, { slot: 'later', take: 1, weights: {}, pinnedPieceId: 'a' }], 10,
        () => { throw new Error('refused prefix ranked'); });
      expect(out.decisions.map(d => [d.slot, d.contentId])).toEqual([['later', 'a']]);
      expect(out.pinDiagnostics?.some(d => d.slot === 'hero' && d.pinIndex !== undefined)).toBe(true);
    }
    const conflict = composeContentDetailed(corpus, affinity, [{ slot: 'owner', take: 1, weights: {}, pinnedPieceId: 'b' }, page[0]!, { slot: 'later', take: 1, weights: {}, pinnedPieceId: 'a' }]);
    expect(conflict.decisions.map(d => d.contentId)).toEqual(['b', 'a']); expect(conflict.pinDiagnostics).toContainEqual({ slot: 'hero', pinnedPieceId: 'b', pinIndex: 0, reason: 'duplicate_pin', ownerSlot: 'owner' });
    for (const invalid of [{ ...corpus[1]!, lifecycle: { status: 'draft' } }, { ...corpus[1]!, slotTypes: ['elsewhere'] }]) {
      expect(composeContentDetailed([corpus[0]!, invalid], affinity, [{ ...page[0]!, take: 2 }]).decisions).toEqual([]);
    }
    const later: ContentSlotSpec = { slot: 'later', take: 3, weights: {}, pinnedPieceIds: ['b', 'a'], diversity: { dimension: 'group', max: 1 } };
    const mutable = corpus.map(p => ({ ...p, tags: { ...p.tags } }));
    const out = composeContentDetailed([piece('trigger', {}, ['first']), ...mutable], { dims: {} }, [{ slot: 'first', take: 1, weights: {}, prefer: { bonus: 0, label: 'mutation', test: () => {
      later.take = 1; later.pinnedPieceIds = [...later.pinnedPieceIds!].reverse(); later.pinnedPieceId = 'e'; later.diversity = { dimension: 'topic', max: 99 };
      mutable[1]!.id = 'changed'; mutable[0]!.tags = { group: ['other'] }; return false;
    } } }, later]);
    expect(out.decisions.map(d => d.contentId)).toEqual(['trigger', 'b', 'a', 'd']);
    expect(out.candidates.later?.map(p => p.contentId)).toEqual(['c', 'd', 'e']);
    expect(composeContentDetailed(corpus, affinity, [{ ...page[0]!, take: 2 }], 10, () => { throw new Error('full prefix scored'); }, () => { throw new Error('full prefix explored'); }).decisions.map(d => d.contentId)).toEqual(['b', 'a']);
  });

  it('W20.04 gates exact tags and rendering types before hooks and pin reservation', () => {
    const corpus = ['a', 'b', 'c', 'd'].map(id => ({ ...piece(id, { topic: [id], group: ['shared'], flag: [id === 'a' ? 'blocked' : 'ok'] }, ['hero', 'tagpin', 'typepin', 'other']), type: id === 'd' ? 'editorial' : 'film' }));
    const views: AffinityViewLike[] = [{ dims: { topic: { a: 1, b: 0.8, c: 0.2, d: 1 } } }, { dims: {} }];
    for (const view of views) {
      const calls: string[] = [];
      const page: ContentSlotSpec[] = [
        { slot: 'hero', take: 3, weights: { topic: 1 }, allowedTypes: ['film'], excludedTags: [{ dimension: 'flag', value: 'blocked' }], diversity: { dimension: 'group', max: 1 },
          prefer: { test: p => { calls.push(`prefer:${p.id}`); return true; }, bonus: 1, label: 'test' } },
        { slot: 'tagpin', take: 1, weights: {}, pinnedPieceId: 'a', excludedTags: [{ dimension: 'flag', value: 'blocked' }] },
        { slot: 'typepin', take: 1, weights: {}, pinnedPieceId: 'd', allowedTypes: ['film'] },
        { slot: 'other', take: 1, weights: {} },
      ];
      const out = composeContentDetailed(corpus, view, page, 10,
        (p, slot, score) => { calls.push(`adjust:${slot}:${p.id}`); return score; },
        (slot, ranked) => { calls.push(`explore:${slot}:${ranked.map(p => p.id).join(',')}`); return { first: 'a' }; });
      expect(out.decisions.map(d => [d.slot, d.contentId])).toEqual([['hero', 'b'], ['hero', 'c'], ['other', 'a']]);
      expect(out.decisions[1]!.explain.diversity?.relaxed).toBe(true);
      expect(out.candidates.hero?.map(p => p.contentId)).toEqual(['b', 'c']);
      expect(out.pinDiagnostics?.map(d => d.reason)).toEqual(['excluded_tag', 'type_not_allowed']);
      expect(calls).toEqual(['prefer:b', 'adjust:hero:b', 'prefer:c', 'adjust:hero:c', 'explore:hero:b,c', 'adjust:other:a', 'adjust:other:d', 'explore:other:a,d']);
      const allBlocked = composeContentDetailed(corpus, view, [{ ...page[0]!, allowedTypes: ['missing'] }], 10,
        () => { throw new Error('forbidden adjustment'); }, () => { throw new Error('forbidden exploration'); });
      expect(allBlocked).toEqual({ decisions: [], candidates: { hero: [] } });
    }
    const settings: ContentSlotSpec = { slot: 'hero', take: 4, weights: {}, excludedPieceIds: ['d'], excludedTags: [{ dimension: 'flag', value: 'blocked' }], allowedTypes: ['film'] };
    for (const [policy, ids] of [[undefined, ['b', 'c']], [HISTORICAL_GOVERNANCE_V1, ['a', 'b', 'c']], [HISTORICAL_GOVERNANCE, ['a', 'b', 'c', 'd']]] as const) {
      expect(composeContentDetailed(corpus, { dims: {} }, [settings], 10, undefined, undefined, undefined, policy).decisions.map(d => d.contentId)).toEqual(ids);
    }
    const later: ContentSlotSpec = { slot: 'later', take: 3, weights: {}, allowedTypes: ['film'], excludedTags: [{ dimension: 'flag', value: 'blocked' }] };
    const mutable = [piece('trigger', {}, ['first']), ...corpus.slice(0, 3).map(p => ({ ...p, slotTypes: ['later'] }))];
    mutable[2]!.type = 'editorial';
    const snapshot = composeContentDetailed(mutable, { dims: {} }, [{ slot: 'first', take: 1, weights: {}, prefer: { bonus: 0, label: 'mutation', test: () => {
      later.allowedTypes = ['editorial']; later.excludedTags = []; mutable[1]!.tags = {}; mutable[2]!.type = 'film'; return false;
    } } }, later]);
    expect(snapshot.decisions.map(d => d.contentId)).toEqual(['trigger', 'c']);
    for (const [dimension, value] of [['a:b', 'c'], ['a', 'b:c'], ['__proto__', ' x\ny '], ['quote"[]', '<literal>']]) {
      const exact = piece('exact', { [dimension!]: [value!] }, ['hero']);
      expect(composeContentDetailed([exact], { dims: {} }, [{ slot: 'hero', take: 1, weights: {}, excludedTags: [{ dimension: dimension!, value: value! }] }]).decisions).toEqual([]);
      expect(composeContentDetailed([exact], { dims: {} }, [{ slot: 'hero', take: 1, weights: {}, excludedTags: [{ dimension: dimension! + ' ', value: value! }] }]).decisions).toHaveLength(1);
    }
  });

  it('W20.03 gates off-limits and exact exclusions before pins and every candidate hook without forbidden fill', () => {
    const corpus = ['a', 'b', 'c'].map(id => piece(id, { topic: [id], group: ['shared'] }, ['hero', 'off', 'excluded-pin', 'other']));
    const views: AffinityViewLike[] = [{ dims: { topic: { a: 1, b: 0.8, c: 0.2 } } }, { dims: {} }];
    for (const view of views) {
      const calls: string[] = [];
      const page: ContentSlotSpec[] = [
        { slot: 'hero', take: 3, weights: { topic: 1 }, excludedPieceIds: ['a'], diversity: { dimension: 'group', max: 1 },
          prefer: { test: p => { calls.push(`prefer:${p.id}`); return true; }, bonus: 10, label: 'fixture' } },
        { slot: 'off', take: 5, weights: {}, offLimits: true, pinnedPieceId: 'a' },
        { slot: 'excluded-pin', take: 1, weights: {}, excludedPieceIds: ['b'], pinnedPieceId: 'b' },
        { slot: 'other', take: 1, weights: {} },
      ];
      const out = composeContentDetailed(corpus, view, page, 10,
        (p, slot, score) => { calls.push(`adjust:${slot}:${p.id}`); return score; },
        (slot, ranked) => { calls.push(`explore:${slot}:${ranked.map(p => p.id).join(',')}`); return { first: 'a' }; });
      expect(out.decisions.map(d => [d.slot, d.contentId])).toEqual([['hero', 'b'], ['hero', 'c'], ['other', 'a']]);
      expect(out.candidates.hero?.map(p => p.contentId)).toEqual(['b', 'c']);
      expect(out.decisions[1]!.explain.diversity).toMatchObject({ dimension: 'group', relaxed: true });
      expect(out.candidates).not.toHaveProperty('off'); expect(out.candidates).not.toHaveProperty('excluded-pin');
      expect(out.pinDiagnostics).toEqual([{ slot: 'off', pinnedPieceId: 'a', reason: 'off_limits' }, { slot: 'excluded-pin', pinnedPieceId: 'b', reason: 'excluded' }]);
      expect(calls).toEqual(['prefer:b', 'adjust:hero:b', 'prefer:c', 'adjust:hero:c', 'explore:hero:b,c', 'adjust:other:a']);
      const empty = composeContentDetailed(corpus, view, [{ ...page[0]!, excludedPieceIds: ['a', 'b', 'c'] }], 10,
        () => { throw new Error('forbidden adjustment'); }, () => { throw new Error('forbidden exploration'); });
      expect(empty).toEqual({ decisions: [], candidates: { hero: [] } });
      for (const pins of [undefined, HISTORICAL_PINS] as const) {
        expect(composeContentDetailed(corpus, view, [page[1]!], 10, undefined, undefined, pins).decisions).toEqual([]);
        const dormant = { ...page[1]!, take: 1 };
        expect(composeContentDetailed(corpus, view, [dormant], 10, undefined, undefined, pins, HISTORICAL_GOVERNANCE).decisions[0]!.contentId).toBe('a');
      }
    }
    const exact = [' a ', 'a,b', 'a\nb', '"[]"', '__proto__'];
    const corpusExact = exact.map(id => piece(id, {}, ['hero']));
    expect(composeContentDetailed(corpusExact, { dims: {} }, [{ slot: 'hero', take: 5, weights: {}, excludedPieceIds: ['a', 'a,b', 'a\nb', '"[]"', '__proto__'] }]).decisions.map(d => d.contentId)).toEqual([' a ']);
  });

  it('returns exactly the decisions composeContent returns', () => {
    expect(composeContentDetailed(pieces, affinity, slots).decisions).toEqual(composeContent(pieces, affinity, slots));
  });

  it('records the ranked candidates per slot, chosen included, deduped across slots', () => {
    const { decisions, candidates } = composeContentDetailed(pieces, affinity, slots);
    expect(candidates.merch).toEqual([{ contentId: 'p', score: 0 }]);
    expect(candidates.hero?.map((c) => c.contentId)).toEqual(['a', 'b']);
    expect(candidates.hero?.[0]?.score).toBeCloseTo(0.8 * 0.35 + 0.7 * 0.25, 3);
    // `a` went to the hero, so the story's candidate set never contains it.
    expect(candidates.story?.map((c) => c.contentId)).toEqual(['c', 'b']);
    expect(decisions.filter((d) => d.slot === 'story').map((d) => d.contentId)).toEqual(['c', 'b']);
  });

  it('honours the candidate limit', () => {
    const { candidates } = composeContentDetailed(pieces, affinity, slots, 1);
    expect(candidates.story).toHaveLength(1);
    expect(candidates.story?.[0]?.contentId).toBe('c');
  });

  it('W20.01 reserves only valid pins before ranking with first-valid ownership and no refused-pin fill', () => {
    const corpus = [piece('best', { occasion: ['evening'] }, ['hero', 'pin', 'duplicate']),
      piece('next', {}, ['hero']), { ...piece('draft', {}, ['pin']), lifecycle: { status: 'draft' } }];
    const hero: ContentSlotSpec = { slot: 'hero', take: 2, weights: { occasion: 1 } };
    const pin: ContentSlotSpec = { slot: 'pin', take: 1, weights: {}, pinnedPieceId: 'best' };
    for (const view of [affinity, { dims: {} }]) {
      const calls: string[] = [];
      const result = composeContentDetailed(corpus, view, [hero, pin], 10,
        (p, slot, score) => { calls.push(`${slot}:${p.id}`); return score; },
        slot => { calls.push(`explore:${slot}`); return null; });
      expect(result.decisions.map(d => [d.slot, d.contentId])).toEqual([['hero', 'next'], ['pin', 'best']]);
      expect(result.candidates.hero).toEqual([{ contentId: 'next', score: 0 }]);
      expect(result.candidates.pin).toEqual([{ contentId: 'best', score: 0 }]);
      expect(result.pinDiagnostics).toBeUndefined();
      expect(calls).toEqual(['hero:next']);
    }
    const duplicated = composeContentDetailed(corpus, affinity, [hero, pin, { ...pin, slot: 'duplicate' }]);
    expect(duplicated.decisions.map(d => d.contentId)).toEqual(['next', 'best']);
    expect(duplicated.pinDiagnostics).toEqual([{ slot: 'duplicate', pinnedPieceId: 'best', reason: 'duplicate_pin', ownerSlot: 'pin' }]);
    expect(duplicated.candidates.duplicate).toBeUndefined();
    for (const [invalid, reason] of [
      [{ ...pin, take: 0 }, 'invalid_take'], [{ ...pin, take: 2 }, 'invalid_take'],
      [{ ...pin, pinnedPieceId: 'missing' }, 'missing_or_ineligible'],
      [{ ...pin, pinnedPieceId: 'draft' }, 'missing_or_ineligible'],
      [{ ...pin, slot: 'wrong' }, 'slot_type'],
    ] as const) {
      const result = composeContentDetailed(corpus, affinity, [hero, invalid]);
      expect(result.decisions.map(d => d.contentId)).toEqual(['best', 'next']);
      expect(result.decisions.every(d => d.slot === 'hero')).toBe(true);
      expect(result.candidates[invalid.slot]).toBeUndefined();
      expect(result.pinDiagnostics).toEqual([{ slot: invalid.slot, pinnedPieceId: invalid.pinnedPieceId, reason }]);
    }
    const recovered = composeContentDetailed(corpus, affinity, [{ ...pin, slot: 'wrong' }, hero, pin]);
    expect(recovered.decisions.map(d => [d.slot, d.contentId])).toEqual([['hero', 'next'], ['pin', 'best']]);
    expect(recovered.pinDiagnostics).toEqual([{ slot: 'wrong', pinnedPieceId: 'best', reason: 'slot_type' }]);
    expect(composeContentDetailed([corpus[0]!], affinity, [hero, pin]).decisions.map(d => d.slot)).toEqual(['pin']);
  });
});

// The admitted original module is the oracle, not a copied ranking implementation.
const beforeSha = '0f8888e00ee83f96290a4395dd2566d531395de0b53f708e5a29ffb985d0affe';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function sources() {
  const baseline = JSON.parse(readFileSync('docs/remediation/design/W38.05/baseline.json', 'utf8')) as {
    owned: Array<{ path: string; sha256: string; content_gzip_base64: string }>;
  };
  const original = baseline.owned.find(x => x.path === 'src/reflex/contentCompose.ts')!;
  const before = gunzipSync(Buffer.from(original.content_gzip_base64, 'base64')).toString('utf8');
  expect(original.sha256).toBe(beforeSha); expect(hash(before)).toBe(beforeSha);
  return { before, current: readFileSync('src/reflex/contentCompose.ts', 'utf8') };
}
function evaluate(source: string, instrument = false) {
  const exports = {} as { composeContentDetailed: typeof composeContentDetailed };
  const work = { driver_sort_calls: 0, driver_rows: 0 };
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  // Separate realms: never patch the test process or timed modules' Array.prototype.
  const observer = instrument ? `const nativeSort = Array.prototype.sort;
    Array.prototype.sort = function(compare) {
      if (this.length && this[0] && typeof this[0].dim === 'string' && 'a' in this[0] && 'weight' in this[0]) {
        work.driver_sort_calls++; work.driver_rows += this.length;
      }
      return nativeSort.call(this, compare);
    };` : '';
  // Only the two actual pure dependencies of the current composer are allowed.
  // Keep its own realm/instrumentation and the retained-source oracle untouched.
  const dependencies = new Map<string, object>();
  const require = (name: string): object => {
    const path = name === '@/content/slotConstraints' ? 'src/content/slotConstraints.ts' : name === './typeAffinity' ? 'src/content/typeAffinity.ts' : null;
    if (!path) throw new Error(`Unexpected composer dependency: ${name}`);
    const cached = dependencies.get(path); if (cached) return cached;
    const exports = {};
    dependencies.set(path, exports);
    const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    runInNewContext(code, { exports, require });
    return exports;
  };
  runInNewContext(observer + compiled, { exports, work, require });
  return { compose: exports.composeContentDetailed, work };
}

describe('W38.05 served explanations', () => {
  it('W38.05 preserves complete outputs and hook traces against retained source including mutated and nonfinite inputs', () => {
    const code = sources(), before = evaluate(code.before).compose, current = evaluate(code.current).compose;
    const run = (compose: typeof composeContentDetailed, mode: 'first' | 'ranking' | 'cold' | 'numeric') => {
      const trace: unknown[] = [];
      const tags = { d0: ['a', 'b'], d1: ['a', 'b'], d2: ['a', 'b'] };
      const corpus = ['a', 'b', 'c', 'd', 'e', 'pin'].map(id => piece(id, structuredClone(tags), id === 'pin' ? ['hero', 'rail', 'pin'] : ['hero', 'rail']));
      corpus.push({ ...piece('draft', tags, ['hero']), lifecycle: { status: 'draft' } });
      const dims = { d0: { a: 1, b: 1 }, d1: { a: 1, b: 1 }, d2: { a: 1, b: 1 } };
      if (mode === 'cold') for (const values of Object.values(dims)) { values.a = 0; values.b = 0; }
      if (mode === 'numeric') { dims.d0.a = NaN; dims.d1.a = Infinity; dims.d2.a = -Infinity; }
      const specs: ContentSlotSpec[] = [
        { slot: 'pin', take: 1, weights: {}, pinnedPieceId: 'pin' },
        { slot: 'hero', take: 2, weights: { d0: 1, d1: 1, d2: 1 } },
        { slot: 'rail', take: 3, weights: { d0: 1, d1: 1, d2: mode === 'numeric' ? -1 : 1 }, diversity: { dimension: 'd0', max: 1 } },
      ];
      if (mode !== 'cold') specs[1]!.prefer = { test: p => {
        trace.push(['prefer', p.id]);
        // Scores/drivers have already read this candidate; a later reread is observably wrong.
        if (p.id === 'a') { corpus[0]!.tags = { changed: ['after-score'] }; dims.d0.a = 2; }
        return p.id === 'b';
      }, bonus: 1, label: 'completion' };
      const adjust: NonNullable<Parameters<typeof composeContentDetailed>[4]> = (p, slot, base) => {
        trace.push(['adjust', slot, p.id, base]);
        if (mode === 'cold') return base;
        if (p.id === 'a') { specs[1]!.weights = { d0: 9, d1: 1, d2: 1 }; return NaN; }
        if (p.id === 'b') return Infinity;
        if (p.id === 'c') return -1;
        return base + 0.125;
      };
      const explore: NonNullable<Parameters<typeof composeContentDetailed>[5]> = (slot, ranked) => {
        trace.push(['explore', slot, structuredClone(ranked)]);
        if (mode === 'cold' || mode === 'numeric') return null;
        corpus.forEach(p => { p.tags = { d0: ['after-explore'] }; }); dims.d1.b = 100;
        return mode === 'ranking' ? { ranking: ranked.map(x => x.id).reverse() } : { first: ranked[ranked.length - 1]!.id };
      };
      const output = compose(corpus, { dims }, specs, 10, adjust, explore);
      return { output: structuredClone(output), trace: structuredClone(trace) };
    };
    for (const mode of ['first', 'ranking', 'cold', 'numeric'] as const) {
      const expected = run(before, mode), evaluated = run(current, mode), imported = run(composeContentDetailed, mode);
      expect(evaluated).toEqual(expected); expect(imported).toEqual(expected);
      expect(expected.output.decisions).toHaveLength(6);
      expect(expected.trace.filter(x => (x as string[])[0] === 'adjust')).toHaveLength(8);
      expect(expected.trace.filter(x => (x as string[])[0] === 'prefer')).toHaveLength(mode === 'cold' ? 0 : 5);
      expect(expected.output.decisions[0]!.strategy).toBe('tenant-pinned');
      if (mode === 'numeric') expect(expected.output.candidates.hero!.some(x => Number.isNaN(x.score))).toBe(true);
      if (mode === 'cold') expect(expected.output.decisions.slice(1).every(x => x.strategy === 'default' && x.explain.drivers.length === 0)).toBe(true);
      if (mode === 'ranking') expect(expected.output.decisions.slice(1).some(x => x.explain.diversity?.relaxed)).toBe(true);
    }
    const tied = [piece('tie', { x: ['a', 'b', 'c', 'd', 'e', 'f'] }, ['hero'])];
    const args = [tied, { dims: { x: { a: 1, b: 1, c: 1, d: 1, e: 1, f: 1 } } }, [{ slot: 'hero', take: 1, weights: { x: 1 } }]] as const;
    const result = composeContentDetailed(...args);
    expect(structuredClone(result)).toEqual(structuredClone(before(...args)));
    expect(result.decisions[0]!.explain.drivers.map(x => x.value)).toEqual(['a', 'b', 'c', 'd']);
    result.decisions[0]!.explain.drivers[0]!.a = 99;
    expect(composeContentDetailed(...args).decisions[0]!.explain.drivers[0]!.a).toBe(1);
  });

  it('W38.05 measures paired actual composer work and warm timings at 30 and 1000 pieces', () => {
    const code = sources(), before = evaluate(code.before), current = evaluate(code.current);
    const workload = (count: number, trace?: unknown[]): Parameters<typeof composeContentDetailed> => {
      const corpus = Array.from({ length: count }, (_, i) => piece(`p${i}`, Object.fromEntries(Array.from({ length: 8 }, (_, d) =>
        [`d${d}`, [`v${(i + d) % 5}`, `v${(i + d + 2) % 5}`]])), i === 0 ? ['hero', 'story', 'rail', 'pin'] : ['hero', 'story', 'rail']));
      const view = { dims: Object.fromEntries(Array.from({ length: 8 }, (_, d) => [`d${d}`, Object.fromEntries(Array.from({ length: 5 }, (_, v) => [`v${v}`, (v + 1) / 10]))])) };
      const weights = Object.fromEntries(Array.from({ length: 8 }, (_, d) => [`d${d}`, (d + 1) / 20]));
      const specs: ContentSlotSpec[] = [{ slot: 'pin', take: 1, weights: {}, pinnedPieceId: 'p0' }, ...['hero', 'story', 'rail'].map((slot, i) => ({
        slot, take: [1, 2, 5][i]!, weights,
        prefer: { test: (p: ContentPieceLike) => { trace?.push(['prefer', slot, p.id]); return Number(p.id.slice(1)) % 9 === 0; }, bonus: 0.03, label: 'completion' },
        ...(slot === 'rail' ? { diversity: { dimension: 'd0', max: 2 } } : {}),
      }))];
      return [corpus, view, specs, 10,
        (p, slot, base) => { trace?.push(['adjust', slot, p.id, base]); return base * (1 + Number(p.id.slice(1)) % 7 / 20); },
        (slot, ranked) => { trace?.push(['explore', slot, ranked.map(x => [x.id, x.score])]); return slot === 'story' ? { first: ranked[ranked.length - 1]!.id } : null; }];
    };
    for (const count of [30, 1000]) {
      const beforeTrace: unknown[] = [], currentTrace: unknown[] = [], importedTrace: unknown[] = [];
      const expected = structuredClone(before.compose(...workload(count, beforeTrace)));
      // R163 (an R10 correction for W28.C1.01), in ONE member and no other: this oracle's frozen
      // composer records the candidate support SLICED AFTER the exploration reorder, which F23 §4.2
      // names as the defect. At 1000 pieces the story slot explores the last-scored piece, so the
      // ruled support keeps beside it the one scored candidate the old slice dropped. The served
      // RANKING is unchanged — `decisions` is still compared whole, and so are the traces, the
      // timings, the SHA pin, the workload and the decision count — and only the recorded support
      // differs, by exactly the single entry the rule adds. Any other difference, in `candidates`
      // or anywhere else, still fails this oracle.
      // R167(3): only the slot the workload's own explore callback names can gain the ruled entry,
      // asked of the callback itself rather than assumed, so a candidate wrongly added to any other
      // slot still fails this oracle.
      const hook = workload(count)[5]!;
      const exploringSlots = ['pin', 'hero', 'story', 'rail']
        .filter(slot => hook(slot, [{ id: 'x', score: 1 }, { id: 'y', score: 0 }]) !== null);
      expect(exploringSlots, 'R167(3) — the workload explores exactly one slot').toEqual(['story']);
      const oracle = (output: ReturnType<typeof composeContentDetailed> | undefined) => {
        if (!output) return output;
        const candidates: typeof output.candidates = {};
        for (const [slot, rows] of Object.entries(output.candidates)) {
          const frozen = expected.candidates[slot] ?? [];
          const added = exploringSlots.includes(slot) ? rows.filter(row => !frozen.some(kept => kept.contentId === row.contentId)) : [];
          candidates[slot] = added.length === 1 ? rows.filter(row => row.contentId !== added[0]!.contentId) : rows;
        }
        return { ...output, candidates };
      };
      expect(oracle(structuredClone(current.compose(...workload(count, currentTrace))))).toEqual(expected);
      expect(oracle(structuredClone(composeContentDetailed(...workload(count, importedTrace))))).toEqual(expected);
      expect(currentTrace).toEqual(beforeTrace); expect(importedTrace).toEqual(beforeTrace);
      expect(expected.decisions).toHaveLength(9);
      const oldWork = evaluate(code.before, true), newWork = evaluate(code.current, true);
      expect(structuredClone(oldWork.compose(...workload(count)))).toEqual(expected);
      expect(oracle(structuredClone(newWork.compose(...workload(count))))).toEqual(expected);
      expect(oldWork.work.driver_sort_calls).toBe(3 * count - 7);
      expect(newWork.work.driver_sort_calls).toBe(8);
      expect(newWork.work.driver_rows).toBeLessThan(oldWork.work.driver_rows);
      const args = workload(count); // No trace/work instrumentation or construction in the timed region.
      for (let i = 0; i < 10; i++) { before.compose(...args); current.compose(...args); }
      const samples = { before: [] as number[], current: [] as number[] };
      for (let sample = 0; sample < 5; sample++) {
        for (const side of sample % 2 ? ['current', 'before'] as const : ['before', 'current'] as const) {
          const compose = side === 'before' ? before.compose : current.compose;
          let output: ReturnType<typeof composeContentDetailed> | undefined;
          const start = performance.now();
          for (let call = 0; call < 20; call++) output = compose(...args);
          samples[side].push(performance.now() - start);
          // R163: the timed loop alternates the frozen and the current composer, so the same
          // one-member normalisation applies here and at the instrumented current composer above.
          expect(oracle(structuredClone(output))).toEqual(expected);
        }
      }
      const median = (values: number[]) => [...values].sort((a, b) => a - b)[2]!;
      console.log('W38.05 measurement', JSON.stringify({ pieces: count, dimensions: 8, tags_per_dimension: 2, takes: [1, 2, 5], pins: 1, candidate_limit: 10,
        warmups: 10, samples: 5, calls_per_sample: 20, parity: true, callback_parity: true,
        output_sha256: hash(JSON.stringify(expected)), callback_sha256: hash(JSON.stringify(beforeTrace)),
        before: { samples_ms: samples.before, median_ms: median(samples.before), ...oldWork.work },
        current: { samples_ms: samples.current, median_ms: median(samples.current), ...newWork.work },
        median_improved: median(samples.current) < median(samples.before) }));
    }
  });
});
