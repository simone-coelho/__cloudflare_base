// src/learn/phase3.test.ts
// Phase 3 (doc 22 §8, §9, §12.3): imported priors, their model as one weighted
// term, and replay as the proof of determinism.

import { describe, it, expect } from 'vitest';
import { indexPriors, parsePriorsCsv, validatePriors } from './priors';
import { buildSnapshot, DEFAULT_STATS, emptyStats, levelKeys, liftFor, recordExposure, recordSuccess, type LiftSnapshot } from './stats';
import { coerceResponse, referenceScore, scoreExternal, type ExternalRequest } from './external';
import { decideContent as decidePure } from '@/content/decide';
import { captureRetention } from '@/retention';
import { HISTORICAL_EXPLORATION } from './explore';
import { HISTORICAL_PINS, HISTORICAL_PINS_V1, HISTORICAL_GOVERNANCE, HISTORICAL_GOVERNANCE_V1 } from '@/reflex/contentCompose';
import { HISTORICAL_CONTENT_TYPES } from '@/content/typeAffinity';
import { compareRecords, replayDecision, type ReplayDeps } from './replay';
import { CONTENT_KIND, DEFAULT_SLOTS, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import type { ContentPiece, DecisionRecord, LearnConfig, SlotStrategy } from '@/content/types';
import type { Env } from '@/types/env';

const cell = { channel: 'direct', visit_bucket: '1' as const, region: 'US-NY', affinity: 'occasion:evening' };
const NOW = Date.now();
// Synthetic original admission authority, captured with each newly generated
// record; replay keeps this exact stamp and never renews it.
const replayEnv = { TENANTS: JSON.stringify({ provisioned: ['coach'] }), RETENTION: JSON.stringify({ version: 1, tenants: { coach: {
  ledger: { id: 'synthetic-replay-ledger', revision: 1, durationMs: 86400_000, basis: 'occurred', renewal: 'new-record-only' },
} } }) } as Env;
const decideContent: typeof decidePure = (...args) => {
  const set = decidePure(...args);
  for (const record of set.records) record.retention = captureRetention(replayEnv, record.tenant, record.ts);
  return set;
};

describe('imported priors (doc 22 §8)', () => {
  it('W25.01 preserves structured identities at every level and selects the exact finer prior without phantom evidence', () => {
    const st = emptyStats();
    for (let i = 0; i < 100; i++) recordExposure(st, 'warm', cell, NOW, DEFAULT_STATS);
    for (let i = 0; i < 5; i++) recordSuccess(st, 'warm', cell, 'click', NOW, 1, DEFAULT_STATS);
    const snapshot = (rows: Parameters<typeof indexPriors>[0]) => buildSnapshot(st,
      { tenant: 'coach', brand: 'coach', slot: 'hero' }, 'click', NOW, DEFAULT_STATS, { version: 7, index: indexPriors(rows, 'hero') });
    for (const [level, key] of levelKeys(cell).entries()) {
      const doc = { rows: [{ slot: 'hero', item: 'cold', cell: key, p_prior: 0.1, n_equiv: 200 }] };
      expect(validatePriors(doc).ok).toBe(true);
      const snap = snapshot(doc), look = liftFor(snap, 'cold', cell)!;
      expect(Object.keys(snap.items).sort()).toEqual(['cold', 'warm']);
      expect(Object.keys(snap.items.cold!)).toEqual([key]);
      expect(snap.slotRates).not.toHaveProperty('v=1');
      expect(look).toMatchObject({ level, n: 0, s: 0, n0: 200, prior: { p: 0.1, n: 200 }, version: NOW });
      expect(snap.priorVersion).toBe(7);
      expect(look.p0).toBeCloseTo(0.05, 12); expect(look.p_hat).toBeCloseTo(0.1, 12); expect(look.lift).toBeCloseTo(2, 12);
      expect(st.items).not.toHaveProperty('cold'); expect(st.events).toBe(100);
    }
    const coarse = { slot: 'hero', item: 'cold', cell: 'c=direct', p_prior: 0.12, n_equiv: 50 };
    const fine = { ...coarse, cell: 'c=direct|v=1', p_prior: 0.02, n_equiv: 400 };
    for (const rows of [[coarse, fine], [fine, coarse]]) {
      const snap = snapshot({ rows });
      expect(liftFor(snap, 'cold', cell)).toMatchObject({ level: 2, n: 0, s: 0, n0: 400, prior: { p: 0.02, n: 400 }, lift: 0.5 });
      expect(liftFor(snap, 'cold', { ...cell, visit_bucket: '2-3' })).toMatchObject({ level: 1, prior: { p: 0.12, n: 50 } });
    }
    expect(liftFor(snapshot({ rows: [{ ...fine, n_equiv: 20 }] }), 'cold', cell)).toBeNull();
    // Their old flat keys collided; the second cell is not a supported ladder
    // key, and the canonical grammar refuses it by name (ruling R151; unit
    // W25.G1.01: `'*'` or a prefix of the ladder order c=, v=, s=, r=, a=).
    // `indexPriors` below does not validate, so the flat-key separation is
    // still proved on exactly these two identities.
    const rows = [{ ...fine, item: 'a', p_prior: 0.1 }, { ...fine, item: 'a|c=direct', cell: 'v=1', p_prior: 0.2 }];
    const refused = validatePriors({ rows });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.errors.join(' ')).toMatch(/rows\[1\]\.cell/);
      expect(refused.errors.join(' ')).toMatch(/c=.*v=.*s=.*r=.*a=/);
    }
    // The duplicate check, on ladder-valid rows, so it proves duplication and
    // not the grammar: the same slot, item and cell twice is refused by row.
    const ladder = [{ ...fine, item: 'a', p_prior: 0.1 }, { ...coarse, item: 'a', p_prior: 0.2 }];
    expect(validatePriors({ rows: ladder }).ok).toBe(true);
    const duplicated = validatePriors({ rows: [...ladder, ladder[0]!] });
    expect(duplicated.ok).toBe(false);
    if (!duplicated.ok) expect(duplicated.errors.join(' ')).toMatch(/rows\[2\]: duplicate/);
    const indexed = indexPriors({ rows }, 'hero');
    expect(indexed.size).toBe(2); expect(indexed.get('a')!.get('c=direct|v=1')).toEqual({ p: 0.1, n: 400 });
    expect(indexed.get('a|c=direct')!.get('v=1')).toEqual({ p: 0.2, n: 400 });
    const snap = snapshot({ rows });
    expect(Object.keys(snap.items).sort()).toEqual(['a', 'a|c=direct', 'warm']);
    expect(snap.items.a!['c=direct|v=1']!.prior).toEqual({ p: 0.1, n: 400 });
    expect(snap.items['a|c=direct']!['v=1']!.prior).toEqual({ p: 0.2, n: 400 });
  });

  it('validates rows, rejects what is not a prior, and reads the CSV a warehouse exports', () => {
    const ok = validatePriors({ version: 'snowflake-2026-09-01', rows: [{ slot: 'hero', item: 'a', cell: '*', p_prior: 0.1, n_equiv: 200 }, { slot: 'hero', item: 'a', cell: 'c=direct', p_prior: 0.12, n_equiv: 50 }] });
    expect(ok.ok).toBe(true);
    const bad = validatePriors({ rows: [{ slot: 'hero', item: '', cell: 'nonsense', p_prior: 2, n_equiv: 0 }, { slot: 'hero', item: 'a', p_prior: 0.1, n_equiv: 1 }, { slot: 'hero', item: 'a', cell: '*', p_prior: 0.1, n_equiv: 1 }] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join(' ')).toMatch(/item: required.*cell.*p_prior.*n_equiv.*duplicate/s);
    const csv = parsePriorsCsv('slot,item,cell,p_prior,n_equiv\nhero,a,,0.10,200\nhero,b,"c=direct|v=1",0.02,20\n');
    expect(csv.rows).toEqual([{ slot: 'hero', item: 'a', cell: '*', p_prior: 0.1, n_equiv: 200 }, { slot: 'hero', item: 'b', cell: 'c=direct|v=1', p_prior: 0.02, n_equiv: 20 }]);
    expect(validatePriors(csv).ok).toBe(true);
    expect([...indexPriors(csv, 'hero')].map(([item, cells]) => [item, [...cells]])).toEqual([
      ['a', [['*', { p: 0.1, n: 200 }]]], ['b', [['c=direct|v=1', { p: 0.02, n: 20 }]]],
    ]);
    expect(indexPriors(csv, 'story').size).toBe(0);
  });

  it('an item with a prior and no live events has an estimate, is eligible, and its lift is p̂ over the slot rate', () => {
    const st = emptyStats();
    for (let i = 0; i < 100; i++) recordExposure(st, 'b', cell, NOW - i, DEFAULT_STATS);   // the slot's rate: 5 in 100
    for (let i = 0; i < 5; i++) recordSuccess(st, 'b', cell, 'click', NOW - i, 1, DEFAULT_STATS);
    const priors = { version: 3, index: indexPriors({ rows: [{ slot: 'hero', item: 'a', cell: '*', p_prior: 0.1, n_equiv: 200 }] }, 'hero') };
    const snap = buildSnapshot(st, { tenant: 'coach', brand: 'coach', slot: 'hero' }, 'click', NOW, DEFAULT_STATS, priors);
    expect(snap.priorVersion).toBe(3);
    const a = snap.items.a!['*']!;
    expect(a.n).toBe(0); expect(a.n0).toBe(200); expect(a.prior).toEqual({ p: 0.1, n: 200 });
    expect(a.p_hat).toBeCloseTo(0.1, 3);          // (0 + 200 × 0.1) / (0 + 200)
    expect(a.p0).toBeCloseTo(0.05, 2);            // the slot's own rate stays the reference
    expect(a.lift).toBeCloseTo(2, 2);             // 0.1 / 0.05, at the clamp
    const look = liftFor(snap, 'a', cell)!;
    expect(look).not.toBeNull(); expect(look.level).toBe(0); expect(look.n0).toBe(200); expect(look.prior).toEqual({ p: 0.1, n: 200 });
    // a prior at '*' reaches the finer keys of the item: two live exposures in a cell do not outweigh a belief worth 200
    for (let i = 0; i < 2; i++) recordExposure(st, 'a', cell, NOW - i, DEFAULT_STATS);
    const fine = liftFor(buildSnapshot(st, { tenant: 'coach', brand: 'coach', slot: 'hero' }, 'click', NOW, DEFAULT_STATS, priors), 'a', cell)!;
    expect(fine.level).toBe(5); expect(fine.n).toBeCloseTo(1 + Math.exp(-1 / DEFAULT_STATS.tauLearnMs), 12);
    expect(fine.n0).toBe(200); expect(fine.prior).toEqual({ p: 0.1, n: 200 });
    expect(fine.p_hat).toBeCloseTo(20 / 202, 3);
    // b has no prior: n₀ is the slot's, as before
    expect(snap.items.b!['*']!.n0).toBe(DEFAULT_STATS.n0); expect(snap.items.b!['*']!.prior).toBeUndefined();
    // without priors the snapshot is what Phase 1 built
    const plain = buildSnapshot(st, { tenant: 'coach', brand: 'coach', slot: 'hero' }, 'click', NOW, DEFAULT_STATS, null);
    expect(plain.items.a!['*']!.prior).toBeUndefined(); expect(plain.items.a!['*']!.n0).toBe(DEFAULT_STATS.n0); expect(plain.priorVersion).toBe(0);
  });
});

const req: ExternalRequest = {
  tenant: 'coach', brand: 'coach', page: 'home', slots: ['hero'], cell,
  affinity: { occasion: { evening: 0.8 }, line: { drover: 0.6 } },
  candidates: [{ id: 'a', tags: { occasion: ['evening'], line: ['drover'] } }, { id: 'd', tags: { occasion: ['evening'] } }, { id: 'n', tags: { occasion: ['weekend'] } }],
};

describe('their model as one term (doc 22 §9)', () => {
  it('the response shape is enforced and scores are clamped', () => {
    expect(coerceResponse({ version: 'm1', scores: { a: 1.7, b: -1, c: 'x', d: 0.4 } })).toEqual({ version: 'm1', scores: { a: 1, b: 0, d: 0.4 } });
    expect(coerceResponse({ scores: {} })).toBeNull();
    expect(coerceResponse('nope')).toBeNull();
  });

  it('the reference scorer is the mean best match over the dimensions the shopper has interest in', () => {
    const r = referenceScore(req);
    expect(r.version).toBe('reference-1');
    expect(r.scores).toEqual({ a: 0.7, d: 0.4, n: 0 });   // a: (0.8 + 0.6) / 2; d: (0.8 + 0) / 2; n: nothing
    expect(referenceScore({ ...req, affinity: {} }).scores).toEqual({ a: 0, d: 0, n: 0 });
  });

  it('table reads KV, service posts the contract, a slow service is omitted with the reason', async () => {
    const kv = { get: async (k: string) => (k === 'ext:coach:coach' ? { version: 't1', scores: { a: 0.9 } } : null) };
    const table = await scoreExternal({ kind: 'table', ref: 'ext', timeoutMs: 20, fallback: 'omit' }, req, NOW, { kv });
    expect(table).toMatchObject({ ok: true, version: 't1', scores: { a: 0.9 } });
    let posted: unknown = null;
    const fetchOk = async (_u: string, init: RequestInit) => { posted = JSON.parse(String(init.body)); return new Response(JSON.stringify({ version: 's1', scores: { n: 1 } })); };
    const svc = await scoreExternal({ kind: 'service', ref: 'https://model.example/score', timeoutMs: 50, fallback: 'omit' }, req, NOW, { fetch: fetchOk });
    expect(svc).toMatchObject({ ok: true, version: 's1', scores: { n: 1 } });
    expect(posted).toMatchObject({ tenant: 'coach', candidates: [{ id: 'a' }, { id: 'd' }, { id: 'n' }] });
    const slow = async () => new Promise<Response>((resolve) => setTimeout(() => resolve(new Response('{}')), 200));
    const late = await scoreExternal({ kind: 'service', ref: 'https://model.example/score', timeoutMs: 10, fallback: 'omit' }, req, NOW, { fetch: slow });
    expect(late.ok).toBe(false); if (!late.ok) expect(late.reason).toMatch(/timeout after 10ms/);
    const noBinding = await scoreExternal({ kind: 'service', ref: 'MODEL', timeoutMs: 10, fallback: 'omit' }, req, NOW, {});
    expect(noBinding).toMatchObject({ ok: false, reason: 'no service binding named MODEL' });
    const noAi = await scoreExternal({ kind: 'workers_ai', ref: '@cf/x', timeoutMs: 10, fallback: 'omit' }, req, NOW, {});
    expect(noAi).toMatchObject({ ok: false, reason: 'no AI binding on this deployment' });
  });
});

const piece = (id: string, tags: Record<string, string[]>): ContentPiece =>
  ({ id, customerContentId: `cms-${id}`, type: 'editorial', title: id, tags, slotTypes: ['hero'], lifecycle: { status: 'live' } });
const pieces = [piece('a', { occasion: ['evening'], line: ['drover'] }), piece('d', { occasion: ['evening'] }), piece('n', { occasion: ['weekend'] })];
const slots: SlotStrategy[] = [{ slot: 'hero', take: 1, weights: { occasion: 0.35, line: 0.25 } }];
const base = {
  tenant: 'coach', brand: 'coach', page: 'home', visitorId: 'v1', sessionId: 's1', identityAnchor: 'visitor' as const, nowMs: NOW,
  pieces, slots, affinity: { dims: { occasion: { evening: 0.8 }, line: { drover: 0.7 } } }, cell,
  arm: 'personalized' as const, versions: { config: 1, catalog: 2, slots: 3, learn: 4, lift: 0, prior: 0, policy: 4 }, configLabel: 'v1',
};
const weightOf = (slot: string) => (slot === 'hero' ? 0.5 : 0);

it('W15 replay retains original ranking identity/time and rendered metadata with exact configured frozen units', async () => {
  const config: LearnConfig = { holdout: { share: 0, salt: '', arms: ['default'] }, slots: { hero: {
    reward: 'purchase', objective: 'revenue', measurementBasis: 'rendered-v1', gamma: 1, items: { a: { mode: 'freeze', lift: 1.5 } },
  } } };
  const record = decideContent({ ...base, learning: { snapshots: {}, gammaOf: () => 1, controlOf: (_slot, item) => config.slots!.hero!.items?.[item] ?? null,
    metadataOf: () => ({ reward: 'purchase', objective: 'revenue', measurementBasis: 'rendered-v1' }) } }).records[0]!;
  record.measurementBasis = 'rendered-v1'; record.rendered = { version: 1, eventId: 'original-render', at: NOW + 1000, pageInstance: 'original-page' };
  const deps: ReplayDeps = { doc: async kind => (kind === CONTENT_KIND ? { pieces } : kind === SLOTS_KIND ? { governanceVersion: 3, pages: { home: slots } } : config) as never,
    archive: async () => { throw new Error('No snapshot was consumed'); } };
  const before = JSON.stringify(record), result = await replayDecision(replayEnv, record, deps);
  expect(result).toMatchObject({ ok: true, equal: true, diff: [], replayed: { decision_id: record.decision_id, ts: NOW, rendered: record.rendered,
    explain: { lift: { reward: 'purchase', objective: 'revenue', measurementBasis: 'rendered-v1' } } } });
  expect(JSON.stringify(record)).toBe(before); expect(result.replayed!.retention).toEqual(record.retention);
  expect(await replayDecision(replayEnv, record, { ...deps, doc: async kind => kind === LEARN_KIND ? { ...config, slots: { hero: { measurementBasis: 'served-v1' } } } as never : deps.doc(kind, 'coach', 1) }))
    .toMatchObject({ ok: false, reason: 'recorded measurement basis differs from its configuration' });
});

describe('the term on the decision', () => {
  it('w_ext × score joins the base score, is a driver, and is on the receipt with the inputs', () => {
    const out = decideContent({ ...base, external: { kind: 'service', ref: 'https://m/score', weightOf, status: 'ok', version: 's1', scores: { n: 1, a: 0 } } });
    const hero = out.records.find((r) => r.slot === 'hero')!;
    expect(hero.item_id).toBe('n');                                        // 0 + 0.5 × 1 beats a's 0.455 + 0.5 × 0
    expect(hero.explain.score_base).toBeCloseTo(0.5, 3);
    expect(hero.explain.external).toEqual({ kind: 'service', ref: 'https://m/score', version: 's1', weight: 0.5, score: 1, contribution: 0.5 });
    expect(hero.explain.drivers).toContainEqual({ dim: 'external', value: 's1', a: 1, weight: 0.5 });
    expect(hero.candidates.find((c) => c.contentId === 'a')!.score).toBeCloseTo(0.455, 3);
    expect(hero.inputs).toEqual({ affinity: { occasion: { evening: 0.8 }, line: { drover: 0.7 } }, external: { version: 's1', scores: { n: 1, a: 0 } },
      replay: { version: 1, exploration: 'supported-only', pins: 'prefix-reserved-v2', contentTypes: 'catalog-tags-v1', governance: 'slot-gates-v2', learning: false, candidateLimit: 10, slots: [{ slot: 'hero', lift: 0, prior: 0 }] } });
    expect(hero.versions).toMatchObject({ catalog: 2, slots: 3, learn: 4, prior: 0 });
  });

  it('a prior in force for the served item is on the receipt beside n₀, and prior_v names the document', () => {
    const st = emptyStats();
    for (let i = 0; i < 100; i++) recordExposure(st, 'd', cell, NOW - i, DEFAULT_STATS);
    for (let i = 0; i < 5; i++) recordSuccess(st, 'd', cell, 'click', NOW - i, 1, DEFAULT_STATS);
    const priors = { version: 7, index: indexPriors({ rows: [{ slot: 'hero', item: 'a', cell: '*', p_prior: 0.5, n_equiv: 200 }] }, 'hero') };
    const snap = buildSnapshot(st, { tenant: 'coach', brand: 'coach', slot: 'hero' }, 'click', NOW, DEFAULT_STATS, priors);
    const out = decideContent({ ...base, learning: { snapshots: { hero: snap }, gammaOf: () => 1 } });
    const hero = out.records.find((r) => r.slot === 'hero')!;
    expect(hero.item_id).toBe('a');
    expect(hero.explain.lift).toMatchObject({ n: 0, n0: 200, p_hat: 0.5, lift: 2, gamma: 1, prior: { p: 0.5, n: 200 } });
    expect(hero.versions.prior).toBe(7);
    expect(hero.explain.score_final).toBeCloseTo(0.455 * 2, 3);
  });

  it('an unavailable model leaves the scores alone and says so; the default arm never sees it', () => {
    const out = decideContent({ ...base, external: { kind: 'table', ref: 'ext', weightOf, status: 'unavailable', reason: 'timeout after 20ms' } });
    const hero = out.records.find((r) => r.slot === 'hero')!;
    expect(hero.item_id).toBe('a'); expect(hero.explain.score_base).toBeCloseTo(0.455, 3);
    expect(hero.explain.external).toEqual({ kind: 'table', ref: 'ext', status: 'unavailable', reason: 'timeout after 20ms' });
    expect(hero.inputs?.external).toBeUndefined();
    const held = decideContent({ ...base, arm: 'default', external: { kind: 'table', ref: 'ext', weightOf, status: 'ok', version: 't1', scores: { n: 1 } } });
    expect(held.records.find((r) => r.slot === 'hero')!.explain.external).toBeUndefined();
  });
});

describe('replay (doc 22 §12.3)', () => {
  it('W20.04 replays three governance generations independently', async () => {
    const page: SlotStrategy[] = [{ slot: 'hero', take: 1, weights: {}, excludedPieceIds: ['a'], allowedTypes: ['film'], excludedTags: [{ dimension: 'contentType', value: 'video' }] },
      { slot: 'silent', take: 1, weights: {}, offLimits: true }];
    const catalog: ContentPiece[] = ['a', 'b', 'c', 'd'].map(id => ({ id, customerContentId: id, type: id === 'c' ? 'editorial' : 'film', title: id,
      tags: { contentType: [id === 'b' ? 'video' : 'other'] }, slotTypes: ['hero'], lifecycle: { status: 'live' } }));
    const deps: ReplayDeps = { doc: async kind => (kind === CONTENT_KIND ? { pieces: catalog } : kind === SLOTS_KIND ? { governanceVersion: 2, pages: { home: page } }
      : { holdout: { share: 0, salt: '', arms: ['default'] } }) as never, archive: async () => { throw new Error('unused archive'); } };
    for (const arm of ['personalized', 'default', 'no_learning'] as const) {
      for (const other of [[undefined, undefined, undefined], [HISTORICAL_EXPLORATION, undefined, undefined], [undefined, HISTORICAL_PINS, undefined], [undefined, undefined, HISTORICAL_CONTENT_TYPES]] as const) {
        for (const [policy, marker, item] of [[HISTORICAL_GOVERNANCE, undefined, 'a'], [HISTORICAL_GOVERNANCE_V1, 'slot-gates-v1', 'b'], [undefined, 'slot-gates-v2', 'd']] as const) {
          const out = decideContent({ ...base, pieces: catalog, slots: page, arm, affinity: null }, other[0], other[1], other[2], policy);
          expect(out.records.map(r => r.item_id)).toEqual([item]);
          const wire = JSON.parse(JSON.stringify(out.records[0]!)) as DecisionRecord;
          expect(wire.inputs!.replay!.governance).toBe(marker);
          expect(wire.inputs!.replay!.slots).toEqual([{ slot: 'hero', lift: 0, prior: 0 }, { slot: 'silent', lift: 0, prior: 0 }]);
          expect(await replayDecision(replayEnv, wire, deps)).toMatchObject({ ok: true, equal: true });
        }
      }
    }
    const current = decideContent({ ...base, pieces: catalog, slots: page, affinity: null }).records[0]!;
    for (const governance of [null, undefined, 'slot-gates-v3', 'slot-gates-v2 ']) {
      const invalid = structuredClone(current); invalid.inputs!.replay!.governance = governance as never;
      expect(await replayDecision(replayEnv, invalid, deps)).toMatchObject({ ok: false, reason: 'invalid page replay manifest' });
    }
    // The v1 document parser does not reinterpret unknown fields as v2 controls.
    const stored = SLOTS_KIND.validateStored!({ governanceVersion: 1, pages: { home: page } });
    expect(stored.ok).toBe(true);
    if (stored.ok) {
      expect(stored.value.pages.home![0]).not.toHaveProperty('excludedTags');
      expect(stored.value.pages.home![0]).not.toHaveProperty('allowedTypes');
      const old = decideContent({ ...base, pieces: catalog, slots: stored.value.pages.home!, affinity: null }, undefined, undefined, undefined, HISTORICAL_GOVERNANCE_V1).records[0]!;
      expect(old.item_id).toBe('b');
      expect(await replayDecision(replayEnv, old, { ...deps, doc: async kind => kind === SLOTS_KIND ? stored.value as never : deps.doc(kind, 'coach', 1) })).toMatchObject({ ok: true, equal: true });
    }
  });

  it('W20.03 replays independent hard gates with zero dormant dependencies and retains legacy zero-version slots', async () => {
    const page: SlotStrategy[] = [
      { slot: 'silent', take: 1, weights: {}, offLimits: true },
      { slot: 'hero', take: 1, weights: { topic: 1 }, excludedPieceIds: ['p'] },
      { slot: 'pin', take: 1, weights: {}, pinnedPieceId: 'p', offLimits: true },
    ];
    const catalog: ContentPiece[] = ['p', 'q'].map(id => ({ id, customerContentId: id, type: 'editorial', title: id,
      tags: { topic: [id] }, slotTypes: page.map(s => s.slot), lifecycle: { status: 'live' } }));
    const calls: string[] = [];
    const config: LearnConfig = { holdout: { share: 0, salt: '', arms: ['default'] } };
    const deps: ReplayDeps = { doc: async kind => (kind === CONTENT_KIND ? { pieces: catalog } : kind === SLOTS_KIND ? { governanceVersion: 1, pages: { home: page } } : config) as never,
      archive: async () => { calls.push('archive'); throw new Error('unused dormant archive'); } };
    for (const arm of ['personalized', 'default', 'no_learning'] as const) {
      const input = { ...base, arm, pieces: catalog, slots: page, affinity: { dims: { topic: { p: 1, q: 0.2 } } },
        learning: { snapshots: { silent: { version: 123, priorVersion: 7 } as LiftSnapshot }, gammaOf: () => 0 } };
      for (const policies of [[undefined, undefined, undefined], [HISTORICAL_EXPLORATION, undefined, undefined],
        [undefined, HISTORICAL_PINS, undefined], [undefined, undefined, HISTORICAL_CONTENT_TYPES]] as const) {
        const current = decideContent(input, policies[0], policies[1], policies[2]), record = current.records[0]!;
        expect(current.records.map(r => [r.slot, r.item_id])).toEqual([['hero', 'q']]);
        expect(record.inputs!.replay).toMatchObject({ governance: 'slot-gates-v2', slots: page.map(s => ({ slot: s.slot, lift: 0, prior: 0 })) });
        expect(await replayDecision(replayEnv, JSON.parse(JSON.stringify(record)) as DecisionRecord, deps)).toMatchObject({ ok: true, equal: true });
        expect(calls).toEqual([]);
        const old = decideContent({ ...input, learning: null }, policies[0], policies[1], policies[2], HISTORICAL_GOVERNANCE);
        expect(old.records.some(r => r.slot === 'pin' && r.item_id === 'p')).toBe(true);
        expect(old.records[0]!.inputs!.replay).not.toHaveProperty('governance');
        for (const r of old.records) expect(await replayDecision(replayEnv, r, deps)).toMatchObject({ ok: true, equal: true });
      }
      const record = decideContent(input).records[0]!;
      for (const value of [undefined, null, false, {}, [], 'old', 'slot-gates-v1 ']) {
        const invalid = structuredClone(record); invalid.inputs!.replay!.governance = value as never;
        expect(await replayDecision(replayEnv, invalid, deps)).toMatchObject({ ok: false, reason: 'invalid page replay manifest' });
      }
      const forged = structuredClone(record); forged.inputs!.replay!.slots[0]!.lift = 123;
      expect(await replayDecision(replayEnv, forged, deps)).toMatchObject({ ok: false, reason: 'invalid page replay manifest' });
    }
    const zero = decideContent({ ...base, pieces: catalog, slots: DEFAULT_SLOTS.pages.home!, arm: 'default',
      versions: { ...base.versions, slots: 0, learn: 0 } }, undefined, undefined, undefined, HISTORICAL_GOVERNANCE).records[0]!;
    expect(await replayDecision(replayEnv, zero, deps)).toMatchObject({ ok: true, equal: true });
    const marked = structuredClone(zero); marked.inputs!.replay!.governance = 'slot-gates-v1';
    expect(await replayDecision(replayEnv, marked, deps)).toMatchObject({ ok: false, reason: 'the recorded slot is absent from the page revision' });
  });

  it('W27.03 refuses malformed consumed revision identities before all reads and preserves explicit zero and missing legacy tuples', async () => {
    const original = decideContent(base).records[0]!, calls: string[] = [];
    const guarded: ReplayDeps = {
      doc: async kind => { calls.push(kind.name); return { pieces } as never; },
      archive: async () => { calls.push('archive'); return null; },
    };
    for (const versions of [null, undefined, [], 'versions', 1, true, new Date(), Object.create({ ...original.versions })]) {
      const result = await replayDecision(replayEnv, { ...original, versions: versions as never }, guarded);
      expect(result).toMatchObject({ ok: false, reason: 'invalid replay versions tuple' }); expect(calls).toEqual([]);
    }
    for (const key of ['catalog', 'slots', 'learn', 'lift', 'prior']) {
      for (const value of [null, undefined, '1', false, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        const result = await replayDecision(replayEnv, { ...original, versions: { ...original.versions, [key]: value } as never }, guarded);
        expect(result).toMatchObject({ ok: false, reason: 'invalid replay versions tuple' }); expect(calls).toEqual([]);
      }
    }
    for (const key of ['catalog', 'slots', 'learn']) {
      const old = structuredClone(original); delete (old.versions as unknown as Record<string, unknown>)[key];
      expect((await replayDecision(replayEnv, old, guarded)).reason).toMatch(/predates the versions tuple/); expect(calls).toEqual([]);
    }
    const zero = decideContent({ ...base, slots: DEFAULT_SLOTS.pages.home!, arm: 'default',
      versions: { ...base.versions, slots: 0, learn: 0 } }, undefined, undefined, undefined, HISTORICAL_GOVERNANCE).records[0]!;
    expect(await replayDecision(replayEnv, zero, guarded)).toMatchObject({ ok: true, equal: true, used: { catalog: 2, slots: 0, learn: 0, lift: 0, prior: 0 } });
    expect(calls).toEqual(['content']);
    calls.length = 0;
    const allZero = structuredClone(zero); allZero.versions.catalog = 0;
    expect(await replayDecision(replayEnv, allZero, guarded)).toMatchObject({ ok: true, equal: false, reason: 'the replay produced no decision for this slot and position' });
    expect(calls).toEqual([]); // Compiled empty catalog is used, not a hidden fetch or invented historical body.
  });

  const pageFixture = (mode: 'off' | 'rotation' | 'thompson' = 'off') => {
    const page: SlotStrategy[] = ['first', 'hero', 'later', 'pin'].map(slot => ({ ...slots[0]!, slot,
      ...(slot === 'pin' ? { pinnedPieceId: 'd' } : {}) }));
    const catalog = pieces.map(p => ({ ...p, slotTypes: page.map(s => s.slot) }));
    const snapshots: Record<string, LiftSnapshot> = {};
    for (const [index, slot] of page.entries()) {
      const state = emptyStats();
      for (const item of ['a', 'd', 'n']) {
        const count = mode === 'rotation' && item === 'd' ? 1 : 100;
        for (let i = 0; i < count; i++) recordExposure(state, item, cell, NOW, DEFAULT_STATS);
        const successes = mode === 'rotation' ? 0 : item === 'd' ? 90 : 1;
        for (let i = 0; i < successes; i++) recordSuccess(state, item, cell, 'click', NOW, 1, DEFAULT_STATS);
      }
      snapshots[slot.slot] = { ...buildSnapshot(state, { tenant: 'coach', brand: 'coach', slot: slot.slot }, 'click', NOW, DEFAULT_STATS), version: NOW + index, priorVersion: 7 };
    }
    const config: LearnConfig = { holdout: { share: 0, salt: '', arms: ['default'] }, slots: {
      first: { gamma: mode === 'off' ? 1 : 0, exploration: { mode, share: 1, floor: 50 } }, hero: { gamma: 0 }, later: { gamma: 0 },
    } };
    const calls: string[] = [];
    const dependencies: ReplayDeps = {
      doc: async kind => (kind === CONTENT_KIND ? { pieces: catalog } : kind === SLOTS_KIND ? { pages: { home: page } } : config) as never,
      archive: async (_tenant, _brand, slot, version) => { calls.push(slot); return snapshots[slot]?.version === version ? snapshots[slot]! : null; },
    };
    page[2]!.fatigue = { weight: 0.1, windowHours: 24, cap: 3 };
    const input = { ...base, pieces: catalog, slots: page, candidateLimit: 1, served: { later: { n: 1 } }, learning: { snapshots,
      gammaOf: (slot: string) => config.slots?.[slot]?.gamma ?? 0, exploreOf: (slot: string) => config.slots?.[slot]?.exploration ?? null } };
    return { page, catalog, snapshots, config, calls, dependencies, input };
  };

  it('W20.05 replays exact pin positions and ranked ordinals with only consumed prefix archives', async () => {
    const page: SlotStrategy[] = [
      { slot: 'broken', take: 3, weights: {}, pinnedPieceIds: ['missing', 'g'] },
      { slot: 'hero', take: 4, weights: { topic: 1 }, pinnedPieceIds: ['b', 'a'] },
      { slot: 'later', take: 2, weights: { topic: 1 }, pinnedPieceIds: ['f'] },
      { slot: 'scalar', take: 1, weights: {}, pinnedPieceId: 'e' },
    ];
    const catalog: ContentPiece[] = [...'abcdefgh'].map((id, index) => ({ id, customerContentId: id, title: id, type: 'editorial', tags: { topic: [id] }, slotTypes: page.map(s => s.slot), lifecycle: { status: 'live' }, inStock: index !== 7 }));
    const state = emptyStats();
    for (let n = 0; n < 60; n++) recordExposure(state, 'c', cell, NOW, DEFAULT_STATS);
    const snapshots = Object.fromEntries(page.map((slot, index) => [slot.slot, { ...buildSnapshot(state, { tenant: 'coach', brand: 'coach', slot: slot.slot }, 'click', NOW, DEFAULT_STATS), version: NOW + index, priorVersion: 0 }]));
    const config: LearnConfig = { holdout: { share: 0, salt: '', arms: ['default'] }, slots: Object.fromEntries(page.map(slot => [slot.slot, { gamma: 0, exploration: { mode: 'rotation' as const, share: 1, floor: 50 } }])) };
    const calls: string[] = [];
    const deps: ReplayDeps = { doc: async kind => (kind === CONTENT_KIND ? { pieces: catalog } : kind === SLOTS_KIND ? { governanceVersion: 3, pages: { home: page } } : config) as never,
      archive: async (_t, _b, slot, version) => { calls.push(slot); if (slot === 'broken') throw new Error('unused refused archive'); return snapshots[slot]?.version === version ? snapshots[slot]! : null; } };
    const input = { ...base, slots: page, pieces: catalog, candidateLimit: 10, affinity: { dims: { topic: { a: 1, b: 1, c: 0.5, d: 0.4, g: 0.3 } } },
      learning: { snapshots, gammaOf: () => 0, exploreOf: (slot: string) => config.slots![slot]!.exploration! } };
    for (const arm of ['personalized', 'no_learning', 'default'] as const) {
      const set = decideContent({ ...input, arm });
      expect(set.records.filter(r => r.slot === 'hero').slice(0, 2).map(r => [r.position, r.item_id])).toEqual([[0, 'b'], [1, 'a']]);
      expect(set.records.some(r => r.slot === 'broken')).toBe(false);
      expect(set.records[0]!.inputs!.replay).toMatchObject({ pins: 'prefix-reserved-v2', slots: [{ slot: 'broken', lift: 0, prior: 0 },
        { slot: 'hero', lift: arm === 'default' ? 0 : snapshots.hero!.version, prior: 0 }, { slot: 'later', lift: arm === 'default' ? 0 : snapshots.later!.version, prior: 0 }, { slot: 'scalar', lift: 0, prior: 0 }] });
      for (const record of set.records) {
        if (record.authority === 'pin') {
          expect(record).not.toHaveProperty('ranking_position'); expect(record.versions).toMatchObject({ lift: 0, prior: 0 });
          expect(record.candidates).toEqual([{ contentId: record.item_id, score: 0 }]);
          expect(record.explain).toMatchObject({ drivers: [], score_base: 0, score_final: 0, lift: null });
          for (const field of ['regional', 'external', 'control', 'exploration']) expect(record.explain).not.toHaveProperty(field);
        } else {
          expect(record.ranking_position).toBe(record.position - (record.slot === 'hero' ? 2 : 1));
          expect(record.candidates.some(c => ['a', 'b', 'e', 'f'].includes(c.contentId))).toBe(false);
        }
        calls.length = 0; expect(await replayDecision(replayEnv, record, deps)).toMatchObject({ ok: true, equal: true, diff: [] });
        expect(calls).toEqual(arm === 'default' || record.authority === 'pin' ? [] : record.slot === 'hero' ? ['hero'] : ['hero', 'later']);
      }
      const tail = set.records.find(r => r.slot === 'hero' && r.ranking_position === 0)!;
      expect(tail.explored).toBe(arm === 'personalized');
      if (arm !== 'default') expect((await replayDecision(replayEnv, tail, { ...deps, archive: async () => null })).ok).toBe(false);
      for (const changed of [{ ...tail, ranking_position: 1 }, { ...tail, ranking_position: undefined }, { ...tail, ranking_position: 50 },
        { ...set.records[0]!, position: 1 }, { ...set.records[0]!, ranking_position: 0 }, { ...tail, authority: 'pin' as const }]) {
        expect((await replayDecision(replayEnv, changed, deps)).ok).toBe(false);
      }
    }
    for (const pinsPolicy of [HISTORICAL_PINS, HISTORICAL_PINS_V1] as const) {
      const old = decideContent(input, undefined, pinsPolicy);
      for (const record of old.records) {
        expect(record).not.toHaveProperty('ranking_position');
        expect(await replayDecision(replayEnv, record, { ...deps, archive: async (_t, _b, slot) => snapshots[slot]! })).toMatchObject({ ok: true, equal: true });
      }
    }
    const forged = structuredClone(decideContent(input).records[2]!); forged.inputs!.replay!.pins = 'prefix-reserved-v3' as never;
    expect((await replayDecision(replayEnv, forged, deps)).ok).toBe(false);
  });

  it('W27.02 replays coupled slots, gamma-zero rotation and Thompson, and genuine pins without unused dependencies', async () => {
    for (const mode of ['off', 'rotation', 'thompson'] as const) {
      const f = pageFixture(mode), set = decideContent(f.input, HISTORICAL_EXPLORATION, HISTORICAL_PINS, HISTORICAL_CONTENT_TYPES, HISTORICAL_GOVERNANCE);
      expect(set.records).toHaveLength(4);
      expect(set.records[0]!.item_id).toBe('d'); expect(set.records[1]!.item_id).toBe('a');
      expect(decideContent({ ...f.input, learning: null }, undefined, HISTORICAL_PINS).records[1]!.item_id).toBe('d');
      if (mode !== 'off') expect(set.records[0]!.explain.exploration).toMatchObject({ mode });
      const expected = f.page.map(slot => ({ slot: slot.slot, lift: slot.slot === 'pin' ? 0 : f.snapshots[slot.slot]!.version, prior: slot.slot === 'pin' ? 0 : 7 }));
      const target = structuredClone(set.records[1]!);
      expect(target.inputs!.replay).toEqual({ version: 1, learning: true, candidateLimit: 1, slots: expected });
      f.snapshots.first!.version++;
      expect(target.inputs!.replay!.slots).toEqual(expected); f.snapshots.first!.version--;
      for (const record of [set.records[0]!, target]) {
        f.calls.length = 0;
        const replay = await replayDecision(replayEnv, record, f.dependencies);
        expect(replay).toMatchObject({ ok: true, equal: true, diff: [] });
        expect(f.calls).toEqual(record.slot === 'first' ? ['first'] : ['first', 'hero']);
        expect(replay.replayed!.inputs!.replay).toEqual(target.inputs!.replay);
        expect(replay.replayed!.inputs).toEqual(record.inputs);
        expect(replay.replayed!.inputs).not.toBe(record.inputs);
        expect(replay.replayed!.inputs!.served).not.toBe(record.inputs!.served);
        expect((await replayDecision(replayEnv, replay.replayed!, f.dependencies)).equal).toBe(true);
      }
      const pin = set.records[3]!;
      expect(pin).toMatchObject({ item_id: 'd', authority: 'pin', versions: { lift: 0, prior: 0 } });
      f.calls.length = 0;
      expect((await replayDecision(replayEnv, pin, { ...f.dependencies, archive: async () => { throw new Error('unused archive'); } })).equal).toBe(true);
      expect(f.calls).toEqual([]);
      const legacyPin = structuredClone(pin); delete legacyPin.inputs!.replay; legacyPin.versions.lift = 123; legacyPin.versions.prior = 9;
      expect(await replayDecision(replayEnv, legacyPin, f.dependencies)).toMatchObject({ equal: true, used: { lift: 0, prior: 0 } });
      const held = decideContent({ ...f.input, arm: 'default', candidateLimit: 10 }, undefined, HISTORICAL_PINS).records[1]!;
      expect(held.inputs!.replay!.learning).toBe(false); expect(held.inputs!.replay!.slots.every(row => row.lift === 0 && row.prior === 0)).toBe(true);
      delete held.inputs!.replay;
      expect((await replayDecision(replayEnv, held, f.dependencies)).equal).toBe(true);
    }
  });

  it('W27.02 refuses malformed or missing page dependencies and ambiguous legacy records, and compares choice metadata', async () => {
    const f = pageFixture('rotation'), original = decideContent(f.input, undefined, HISTORICAL_PINS).records[1]!;
    const manifest = original.inputs!.replay!;
    const invalid: unknown[] = [null, undefined, {}, { ...manifest, learning: 'yes' },
      { ...manifest, candidateLimit: Infinity }, { ...manifest, extra: 1 }, { ...manifest, slots: manifest.slots.slice(1) },
      { ...manifest, slots: [...manifest.slots].reverse() }, { ...manifest, slots: manifest.slots.map(() => manifest.slots[0]) },
      ...[-1, 1.1, Number.MAX_SAFE_INTEGER + 1].map(lift => ({ ...manifest, slots: manifest.slots.map((row, i) => i ? row : { ...row, lift }) })),
      { ...manifest, slots: manifest.slots.map(row => row.slot === 'hero' ? { ...row, prior: 8 } : row) },
      { ...manifest, learning: false }, { ...manifest, slots: manifest.slots.map(row => row.slot === 'pin' ? { ...row, lift: 1 } : row) }];
    for (const value of invalid) {
      const record = structuredClone(original); record.inputs!.replay = value as never;
      expect(await replayDecision(replayEnv, record, f.dependencies)).toMatchObject({ ok: false, reason: 'invalid page replay manifest' });
    }
    // R161 (the lead's ruling on the W27-B1 collision): a manifest version this
    // build does not implement is still REFUSED, and unit W27.O1.01 rules that
    // the refusal names the version it was handed instead of pooling a rollout
    // event with a corrupt manifest.
    const ahead = structuredClone(original); ahead.inputs!.replay = { ...manifest, version: 2 } as never;
    expect(await replayDecision(replayEnv, ahead, f.dependencies)).toMatchObject({ ok: false, reason: 'page replay manifest version 2 is not supported' });
    for (const snapshot of [null, { ...f.snapshots.first!, tenant: 'other' }, { ...f.snapshots.first!, brand: 'other' },
      { ...f.snapshots.first!, slot: 'hero' }, { ...f.snapshots.first!, version: 1 }, { ...f.snapshots.first!, priorVersion: 8 },
      { ...f.snapshots.first!, items: { a: { '*': { n: 1 } } } }]) {
      const result = await replayDecision(replayEnv, original, { ...f.dependencies, archive: async () => snapshot as LiftSnapshot | null });
      expect(result.ok).toBe(false); expect(result.reason).toContain('first/' + f.snapshots.first!.version);
    }
    expect((await replayDecision(replayEnv, original, { ...f.dependencies, archive: async () => { throw new Error('private'); } })).reason).toContain('could not be read');
    const legacy = structuredClone(original); delete legacy.inputs!.replay;
    expect((await replayDecision(replayEnv, legacy, f.dependencies)).reason).toMatch(/legacy personalized multi-slot/);
    const first = decideContent(f.input, undefined, HISTORICAL_PINS).records[0]!, forged = structuredClone(first);
    forged.authority = 'pin'; forged.explain.exploration!.bucket += 0.1;
    expect((await replayDecision(replayEnv, forged, f.dependencies)).diff.map(d => d.field)).toEqual(['authority', 'explain.exploration']);
    const single = { ...f.input, slots: [f.page[0]!] }, singleDeps: ReplayDeps = { ...f.dependencies,
      doc: async (kind, scope, revision) => kind === SLOTS_KIND ? { pages: { home: single.slots } } as never : f.dependencies.doc(kind, scope, revision) };
    const known = decideContent(single, undefined, HISTORICAL_PINS).records[0]!; delete known.inputs!.replay;
    expect((await replayDecision(replayEnv, known, singleDeps)).equal).toBe(false); // Old custom candidateLimit=1 cannot be recovered.
    const standard = decideContent({ ...single, candidateLimit: 10 }, undefined, HISTORICAL_PINS).records[0]!; delete standard.inputs!.replay;
    expect((await replayDecision(replayEnv, standard, singleDeps)).equal).toBe(true);
    const ambiguous = decideContent({ ...single, learning: { ...single.learning, snapshots: {} } }, undefined, HISTORICAL_PINS).records[0]!; delete ambiguous.inputs!.replay;
    expect((await replayDecision(replayEnv, ambiguous, singleDeps)).reason).toMatch(/ambiguous learning/);
    f.config.slots!.first!.exploration = { mode: 'off', share: 0, floor: 50 };
    f.config.slots!.first!.items = { a: { mode: 'freeze', lift: 2 } };
    expect((await replayDecision(replayEnv, ambiguous, singleDeps)).reason).toMatch(/ambiguous learning/);
    const absent = decideContent({ ...base }).records[0]!;
    expect(absent.inputs!.replay!.learning).toBe(false);
  });

  it('W28.01 distinguishes old coupled Thompson replay from new withdrawn choices and refuses invalid policy markers', async () => {
    const f = pageFixture('thompson');
    const old = decideContent(f.input, HISTORICAL_EXPLORATION, HISTORICAL_PINS), live = decideContent(f.input, undefined, HISTORICAL_PINS);
    expect(old.records.slice(0, 2).map(r => r.item_id)).toEqual(['d', 'a']);
    expect(live.records.slice(0, 2).map(r => r.item_id)).toEqual(['a', 'd']);
    expect(old.records[0]!.explain.exploration!.mode).toBe('thompson');
    expect(old.records[1]!.inputs!.replay).not.toHaveProperty('exploration');
    expect(live.records[1]!.inputs!.replay!.exploration).toBe('supported-only');
    for (const record of [...old.records, ...live.records]) {
      const replay = await replayDecision(replayEnv, structuredClone(record), f.dependencies);
      expect(replay).toMatchObject({ ok: true, equal: true });
      expect(replay.replayed!.inputs).toEqual(record.inputs);
    }
    for (const policy of [null, undefined, false, 'historical', [], {}, 'supported-only ']) {
      const record = structuredClone(live.records[1]!); record.inputs!.replay!.exploration = policy as never;
      f.calls.length = 0;
      expect(await replayDecision(replayEnv, record, f.dependencies)).toMatchObject({ ok: false, reason: 'invalid page replay manifest' });
      expect(f.calls).toEqual([]);
    }
    const forged = structuredClone(old.records[1]!); forged.inputs!.replay!.exploration = 'supported-only';
    expect((await replayDecision(replayEnv, forged, f.dependencies)).equal).toBe(false);
  });

  it('W20.01 replays reserved pins independently of exploration across arms, eligibility gates and inherited contradictions', async () => {
    for (const arm of ['default', 'no_learning', 'personalized'] as const) {
      const f = pageFixture(), before = structuredClone(f.page);
      const set = decideContent({ ...f.input, arm }, undefined, HISTORICAL_PINS_V1);
      expect(set.records.map(r => [r.slot, r.item_id])).toEqual([['first', 'a'], ['hero', 'n'], ['pin', 'd']]);
      expect(set.pinDiagnostics).toBeUndefined();
      for (const record of set.records) {
        expect(record.inputs!.replay!.pins).toBe('reserved-eligible-v1');
        expect(record.inputs!.replay!.exploration).toBe('supported-only');
        f.calls.length = 0;
        const replay = await replayDecision(replayEnv, record, f.dependencies);
        expect(replay).toMatchObject({ ok: true, equal: true, diff: [] });
        expect(f.calls).toEqual(arm === 'default' || record.slot === 'pin' ? [] : record.slot === 'first' ? ['first'] : ['first', 'hero']);
        expect(replay.replayed!.inputs).toEqual(record.inputs);
        expect(replay.replayed!.inputs).not.toBe(record.inputs);
        expect(replay.replayed!.inputs!.replay!.slots).not.toBe(record.inputs!.replay!.slots);
      }
      expect(f.page).toEqual(before);
    }
    const f = pageFixture('thompson');
    const mixed = decideContent(f.input, HISTORICAL_EXPLORATION, HISTORICAL_PINS_V1).records[0]!;
    expect(mixed.inputs!.replay).toHaveProperty('pins', 'reserved-eligible-v1');
    expect(mixed.inputs!.replay).not.toHaveProperty('exploration');
    expect((await replayDecision(replayEnv, mixed, f.dependencies)).equal).toBe(true);
    for (const policy of [null, undefined, false, 'historical', [], {}, 'reserved-eligible-v1 ']) {
      const record = structuredClone(mixed); record.inputs!.replay!.pins = policy as never;
      f.calls.length = 0;
      expect(await replayDecision(replayEnv, record, f.dependencies)).toMatchObject({ ok: false, reason: 'invalid page replay manifest' });
      expect(f.calls).toEqual([]);
    }
    for (const changed of [
      { lifecycle: { status: 'draft' as const } }, { lifecycle: { status: 'expired' as const } }, { inStock: false },
      { window: { from: new Date(NOW + 1).toISOString() } }, { window: { to: new Date(NOW).toISOString() } },
    ]) {
      const invalid = decideContent({ ...f.input, pieces: f.catalog.map(p => p.id === 'd' ? { ...p, ...changed } : p) });
      expect(invalid.pinDiagnostics).toEqual([{ slot: 'pin', pinnedPieceId: 'd', reason: 'missing_or_ineligible' }]);
      expect(invalid.decisions.some(d => d.slot === 'pin' || d.contentId === 'd')).toBe(false);
      expect(invalid.records.some(r => r.slot === 'pin' || r.item_id === 'd')).toBe(false);
    }
    // Retained invalid pin configurations remain exactly replayable only under
    // absent pin markers; current receipts cannot claim that legacy behavior.
    for (const invalid of ['slot_type', 'invalid_take', 'duplicate_pin'] as const) {
      const retained = pageFixture();
      if (invalid === 'slot_type') retained.catalog.find(p => p.id === 'd')!.slotTypes = ['first', 'hero', 'later'];
      if (invalid === 'invalid_take') retained.page[3]!.take = 2;
      if (invalid === 'duplicate_pin') {
        retained.page.push({ ...retained.page[3]!, slot: 'duplicate' });
        retained.catalog.find(p => p.id === 'd')!.slotTypes.push('duplicate');
      }
      const current = decideContent(retained.input), old = decideContent(retained.input, undefined, HISTORICAL_PINS);
      const refusedSlot = invalid === 'duplicate_pin' ? 'duplicate' : 'pin';
      expect(current.pinDiagnostics).toEqual([{ slot: refusedSlot, pinnedPieceId: 'd', reason: invalid,
        ...(invalid === 'duplicate_pin' ? { ownerSlot: 'pin' } : {}) }]);
      expect(current.records.some(r => r.slot === refusedSlot)).toBe(false);
      const receipt = old.records.find(r => r.slot === refusedSlot)!;
      expect(receipt.inputs!.replay).not.toHaveProperty('pins');
      expect(receipt.inputs!.replay!.exploration).toBe('supported-only');
      const noArchive = { ...retained.dependencies, archive: async () => { throw new Error('unused ranked snapshot'); } };
      expect((await replayDecision(replayEnv, receipt, noArchive)).equal).toBe(true);
      const forged = structuredClone(receipt); forged.inputs!.replay!.pins = 'reserved-eligible-v1';
      expect(await replayDecision(replayEnv, forged, noArchive)).toMatchObject({ ok: true, equal: false, replayed: null });
      if (invalid === 'duplicate_pin') {
        const owner = current.records.find(r => r.slot === 'pin')!;
        expect((await replayDecision(replayEnv, owner, noArchive)).equal).toBe(true);
      }
    }
  });

  const learn: LearnConfig = { holdout: { share: 0, salt: '', arms: ['default'] }, external: { kind: 'service', ref: 'https://m/score', timeoutMs: 20, fallback: 'omit' }, slots: { hero: { gamma: 1, external: { weight: 0.5 } } } };
  const deps: ReplayDeps = {
    doc: async (kind, _scope, revision) => {
      if (kind === CONTENT_KIND && revision === 2) return { pieces } as never;
      if (kind === SLOTS_KIND && revision === 3) return { pages: { home: slots } } as never;
      if (kind === LEARN_KIND && revision === 4) return learn as never;
      return null;
    },
    archive: async () => null,
  };
  const served = (): DecisionRecord => decideContent({ ...base, external: { kind: 'service', ref: 'https://m/score', weightOf, status: 'ok', version: 's1', scores: { n: 1, a: 0 } } }).records.find((r) => r.slot === 'hero')!;

  it('the same record decided again from its versions and inputs is equal', async () => {
    const r = await replayDecision(replayEnv, served(), deps);
    expect(r.ok).toBe(true); expect(r.equal).toBe(true); expect(r.diff).toEqual([]);
    expect(r.used).toEqual({ catalog: 2, slots: 3, learn: 4, lift: 0, prior: 0 });
  });

  it('a tampered receipt is caught, and a record without the tuple is refused rather than guessed', async () => {
    const tampered = served(); tampered.item_id = 'a'; tampered.explain.score_final = 9;
    const r = await replayDecision(replayEnv, tampered, deps);
    expect(r.equal).toBe(false);
    expect(r.diff.map((d) => d.field)).toEqual(['item_id', 'explain.score_final']);
    expect(compareRecords(tampered, r.replayed!).length).toBe(2);
    const old = served(); delete (old as { versions: Partial<DecisionRecord['versions']> }).versions.catalog;
    const refused = await replayDecision(replayEnv, old, deps);
    expect(refused.ok).toBe(false); expect(refused.reason).toMatch(/predates the versions tuple/);
    const missing = await replayDecision(replayEnv, { ...served(), versions: { ...base.versions, catalog: 9 } }, deps);
    expect(missing.ok).toBe(false); expect(missing.reason).toMatch(/catalog revision 9/);
  });
});
