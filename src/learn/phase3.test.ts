// src/learn/phase3.test.ts
// Phase 3 (doc 22 §8, §9, §12.3): imported priors, their model as one weighted
// term, and replay as the proof of determinism.

import { describe, it, expect } from 'vitest';
import { indexPriors, parsePriorsCsv, validatePriors } from './priors';
import { buildSnapshot, DEFAULT_STATS, emptyStats, liftFor, recordExposure, recordSuccess } from './stats';
import { coerceResponse, referenceScore, scoreExternal, type ExternalRequest } from './external';
import { decideContent } from '@/content/decide';
import { compareRecords, replayDecision, type ReplayDeps } from './replay';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import type { ContentPiece, DecisionRecord, LearnConfig, SlotStrategy } from '@/content/types';
import type { Env } from '@/types/env';

const cell = { channel: 'direct', visit_bucket: '1' as const, region: 'US-NY', affinity: 'occasion:evening' };
const NOW = Date.now();

describe('imported priors (doc 22 §8)', () => {
  it('validates rows, rejects what is not a prior, and reads the CSV a warehouse exports', () => {
    const ok = validatePriors({ version: 'snowflake-2026-09-01', rows: [{ slot: 'hero', item: 'a', cell: '*', p_prior: 0.1, n_equiv: 200 }, { slot: 'hero', item: 'a', cell: 'c=direct', p_prior: 0.12, n_equiv: 50 }] });
    expect(ok.ok).toBe(true);
    const bad = validatePriors({ rows: [{ slot: 'hero', item: '', cell: 'nonsense', p_prior: 2, n_equiv: 0 }, { slot: 'hero', item: 'a', p_prior: 0.1, n_equiv: 1 }, { slot: 'hero', item: 'a', cell: '*', p_prior: 0.1, n_equiv: 1 }] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join(' ')).toMatch(/item: required.*cell.*p_prior.*n_equiv.*duplicate/s);
    const csv = parsePriorsCsv('slot,item,cell,p_prior,n_equiv\nhero,a,,0.10,200\nhero,b,"c=direct|v=1",0.02,20\n');
    expect(csv.rows).toEqual([{ slot: 'hero', item: 'a', cell: '*', p_prior: 0.1, n_equiv: 200 }, { slot: 'hero', item: 'b', cell: 'c=direct|v=1', p_prior: 0.02, n_equiv: 20 }]);
    expect(validatePriors(csv).ok).toBe(true);
    expect([...indexPriors(csv, 'hero').keys()]).toEqual(['a|*', 'b|c=direct|v=1']);
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
    expect(fine.level).toBe(4); expect(fine.n).toBe(2); expect(fine.n0).toBe(200); expect(fine.prior).toEqual({ p: 0.1, n: 200 });
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

describe('the term on the decision', () => {
  it('w_ext × score joins the base score, is a driver, and is on the receipt with the inputs', () => {
    const out = decideContent({ ...base, external: { kind: 'service', ref: 'https://m/score', weightOf, status: 'ok', version: 's1', scores: { n: 1, a: 0 } } });
    const hero = out.records.find((r) => r.slot === 'hero')!;
    expect(hero.item_id).toBe('n');                                        // 0 + 0.5 × 1 beats a's 0.455 + 0.5 × 0
    expect(hero.explain.score_base).toBeCloseTo(0.5, 3);
    expect(hero.explain.external).toEqual({ kind: 'service', ref: 'https://m/score', version: 's1', weight: 0.5, score: 1, contribution: 0.5 });
    expect(hero.explain.drivers).toContainEqual({ dim: 'external', value: 's1', a: 1, weight: 0.5 });
    expect(hero.candidates.find((c) => c.contentId === 'a')!.score).toBeCloseTo(0.455, 3);
    expect(hero.inputs).toEqual({ affinity: { occasion: { evening: 0.8 }, line: { drover: 0.7 } }, external: { version: 's1', scores: { n: 1, a: 0 } } });
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
    const r = await replayDecision({} as Env, served(), deps);
    expect(r.ok).toBe(true); expect(r.equal).toBe(true); expect(r.diff).toEqual([]);
    expect(r.used).toEqual({ catalog: 2, slots: 3, learn: 4, lift: 0, prior: 0 });
  });

  it('a tampered receipt is caught, and a record without the tuple is refused rather than guessed', async () => {
    const tampered = served(); tampered.item_id = 'a'; tampered.explain.score_final = 9;
    const r = await replayDecision({} as Env, tampered, deps);
    expect(r.equal).toBe(false);
    expect(r.diff.map((d) => d.field)).toEqual(['item_id', 'explain.score_final']);
    expect(compareRecords(tampered, r.replayed!).length).toBe(2);
    const old = served(); delete (old as { versions: Partial<DecisionRecord['versions']> }).versions.catalog;
    const refused = await replayDecision({} as Env, old, deps);
    expect(refused.ok).toBe(false); expect(refused.reason).toMatch(/predates the versions tuple/);
    const missing = await replayDecision({} as Env, { ...served(), versions: { ...base.versions, catalog: 9 } }, deps);
    expect(missing.ok).toBe(false); expect(missing.reason).toMatch(/catalog revision 9/);
  });
});
