// src/learn/phase2.test.ts
// Exploration is deterministic in its inputs and honest on the receipt; the
// item controls hold or ignore a lift. Autonomy mutation is withdrawn before
// binding access; authenticated historical reads retain unverified records.

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { decisionRoutes } from '@/routes/decisions';
import type { Env } from '@/types/env';
import { betaSample, bucketOf, explorationPick, hourKeyOf, HISTORICAL_EXPLORATION } from './explore';
import { DEFAULT_LEARN, CONTENT_KIND, EMPTY_CATALOG, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { PRIORS_KIND, indexPriors, validatePriors, parsePriorsCsv } from './priors';
import { LearnStats } from '@/durable-objects/LearnStats';
import { DEFAULT_STATS, emptyStats, recordExposure } from './stats';
import { memoryStore } from '@/auth/store';
import { memoryAuthority } from '@/auth/authority';
import { tenantMiddleware } from '@/tenancy/middleware';
import { initializePublicationSet, readPublication } from '@/config/publication';
import { applyProposal, DEFAULT_AUTONOMY, evidenceFor, proposeFor } from './autonomy';
import { decideProposal, PROPOSALS_KIND, runCycle } from './cycle';
import { decideContent } from '@/content/decide';
import { invalidateCache, write } from '@/config/versionedStore';
import type { LiftSnapshot } from './stats';
import type { ContentPiece, SlotStrategy } from '@/content/types';

class AuthorityR2 {
  objects = new Map<string, { text: string; etag: string }>(); count = 0; failArchive = false;
  gate?: (key: string) => Promise<void>;
  async get(key: string) {
    await this.gate?.(key); const v = this.objects.get(key);
    return v ? { key, etag: v.etag, size: new TextEncoder().encode(v.text).length, body: new Response(v.text).body } : null;
  }
  async put(key: string, text: string, options?: R2PutOptions) {
    if (this.failArchive && key.startsWith('lift/')) throw new Error('Synthetic archive unavailable');
    const condition = options?.onlyIf;
    if (condition instanceof Headers ? this.objects.has(key) : condition && condition.etagMatches !== this.objects.get(key)?.etag) return null;
    const etag = 'fixture-' + (++this.count); this.objects.set(key, { text, etag }); return { key, etag, size: new TextEncoder().encode(text).length };
  }
}
const T0 = 1_725_000_000_000;
const snap = (items: Record<string, { n: number; s: number; lift: number }>, slotN = 1000): LiftSnapshot => ({
  tenant: 'coach', brand: 'coach', slot: 'hero', reward: 'click', version: 5, publishedAt: 5, events: slotN, n0: 30, nMin: 30, liftMin: 0.5, liftMax: 2,
  items: Object.fromEntries(Object.entries(items).map(([id, x]) => [id, { '*': { level: 0 as const, key: '*', n: x.n, s: x.s, p0: 0.1, p_hat: 0.1 * x.lift, lift: x.lift } }])),
  slotRates: { '*': { n: slotN, s: slotN * 0.1, rate: 0.1 } },
});
const ranked = [{ id: 'a', score: 0.5 }, { id: 'b', score: 0.4 }, { id: 'c', score: 0.3 }];

it('W15 prior basis is explicit in JSON/CSV and never promotes retained served pseudo-counts to rendered evidence', () => {
  const rows = [{ slot: 'hero', item: 'a', cell: '*', p_prior: .2, n_equiv: 30 },
    { slot: 'hero', item: 'a', cell: '*', p_prior: .4, n_equiv: 10, measurementBasis: 'rendered-v1' as const }];
  const valid = validatePriors({ rows }); expect(valid.ok).toBe(true);
  expect(indexPriors({ rows }, 'hero').get('a')!.get('*')).toEqual({ p: .2, n: 30 });
  expect(indexPriors({ rows }, 'hero', 'rendered-v1').get('a')!.get('*')).toEqual({ p: .4, n: 10 });
  expect(indexPriors({ rows: [rows[0]!] }, 'hero', 'rendered-v1').size).toBe(0);
  expect(validatePriors({ rows: [{ ...rows[0], measurementBasis: 'viewable' }] }).ok).toBe(false);
  const csv = parsePriorsCsv('slot,item,cell,p_prior,n_equiv,measurementBasis\nhero,a,*,0.4,10,rendered-v1\n');
  expect(csv).toMatchObject({ rows: [rows[1]] }); expect(rows[0]).not.toHaveProperty('measurementBasis');
});

describe('exploration', () => {
  it('rotation: a bucket under the share serves the least-observed under-observed item; over it, nothing', () => {
    const cfg = { mode: 'rotation' as const, share: 0.5, floor: 50 };
    const s = snap({ a: { n: 500, s: 60, lift: 1.2 }, b: { n: 3, s: 0, lift: 1 }, c: { n: 10, s: 1, lift: 1 } });
    // Find a visitor id in the bucket and one out of it, so the test does not depend on a particular hash.
    const ids = Array.from({ length: 200 }, (_, i) => `v${i}`);
    const inn = ids.find((v) => bucketOf(v, 'hero', hourKeyOf(T0)) < 0.5)!;
    const out = ids.find((v) => bucketOf(v, 'hero', hourKeyOf(T0)) >= 0.5)!;
    const pick = explorationPick({ visitorId: inn, slot: 'hero', nowMs: T0, ranked, snapshot: s, cfg })!;
    expect(pick.mode).toBe('rotation'); expect(pick.pieceId).toBe('b'); expect(pick.reason).toContain('n 3 < floor 50');
    expect(explorationPick({ visitorId: out, slot: 'hero', nowMs: T0, ranked, snapshot: s, cfg })).toBeNull();
    // Nothing under-observed: nothing to explore, whatever the bucket.
    expect(explorationPick({ visitorId: inn, slot: 'hero', nowMs: T0, ranked, snapshot: snap({ a: { n: 500, s: 60, lift: 1 }, b: { n: 500, s: 50, lift: 1 }, c: { n: 500, s: 50, lift: 1 } }), cfg })).toBeNull();
    expect(explorationPick({ visitorId: inn, slot: 'hero', nowMs: T0, ranked, snapshot: s, cfg: { ...cfg, mode: 'off' } })).toBeNull();
    // Deterministic: the same inputs pick the same thing; a new hour may not.
    expect(explorationPick({ visitorId: inn, slot: 'hero', nowMs: T0, ranked, snapshot: s, cfg })).toEqual(pick);
  });

  it('historical Thompson: ranks on a seeded sample, flags only when the sample disagrees, and the sample is recomputable', () => {
    // a is tight at 0.3; b's posterior is wide around it, so the sample beats a about half the time;
    // the old fixture (b at 3 of 4) beat a in effect always and only passed because the seeds were poorly mixed
    const s = snap({ a: { n: 1000, s: 300, lift: 1 }, b: { n: 4, s: 1, lift: 1 }, c: { n: 1000, s: 50, lift: 0.5 } });
    const cfg = { mode: 'thompson' as const, share: 1, floor: 0 };
    let flagged = 0;
    for (let i = 0; i < 200; i++) {
      const p = explorationPick({ visitorId: `t${i}`, slot: 'hero', nowMs: T0, ranked, snapshot: s, cfg }, HISTORICAL_EXPLORATION);
      if (p) { flagged++; expect(p.samples).toBeDefined(); expect(p.ranking![0]).toBe(p.pieceId); expect(explorationPick({ visitorId: `t${i}`, slot: 'hero', nowMs: T0, ranked, snapshot: s, cfg }, HISTORICAL_EXPLORATION)).toEqual(p); }
    }
    expect(flagged).toBeGreaterThan(20);      // b's wide posterior wins often
    expect(flagged).toBeLessThan(180);        // and not always
    const rng = () => 0.5;
    expect(betaSample(rng, 1, 1)).toBeGreaterThan(0);
  });

  // R162 (an R10 correction for W28.C1.01): the expectation below was stale, not the mode. F23 §4.1
  // names the old one as a lie — "a decision that WAS made by a random draw is recorded as not
  // explored" — and doc 22 §7 promises the realized share can be verified rather than trusted, which
  // an unflagged leader draw defeats. Uniform inside the share is unchanged; a draw that lands on
  // the leader is now the exploration it was.
  it('epsilon: uniform inside the share, and a draw that lands on the leader is the exploration it was', () => {
    const cfg = { mode: 'epsilon' as const, share: 1, floor: 0 };
    const picks = new Set<string | null>();
    for (let i = 0; i < 100; i++) picks.add(explorationPick({ visitorId: `e${i}`, slot: 'hero', nowMs: T0, ranked, snapshot: null, cfg })?.pieceId ?? null);
    expect(picks.has('b') && picks.has('c')).toBe(true);
    expect(picks.has('a'), 'R162 / W28.C1.01 — the uniform draw names the leader for some visitors inside the share, and that decision is an exploration too').toBe(true);
  });
});

const piece = (id: string, tags: Record<string, string[]>, slots: string[]): ContentPiece =>
  ({ id, customerContentId: `cms-${id}`, type: 'editorial', title: id, tags, slotTypes: slots, lifecycle: { status: 'live' } });
const pieces = [piece('a', { occasion: ['evening'], line: ['drover'] }, ['hero']), piece('d', { occasion: ['evening'] }, ['hero']), piece('n', { occasion: ['weekend'] }, ['hero'])];
const slots: SlotStrategy[] = [{ slot: 'hero', take: 1, weights: { occasion: 0.35, line: 0.25 } }];
const base = {
  tenant: 'coach', brand: 'coach', page: 'home', visitorId: 'v1', sessionId: 's1', identityAnchor: 'visitor' as const, nowMs: T0,
  pieces, slots, affinity: { dims: { occasion: { evening: 0.8 }, line: { drover: 0.7 } } },
  cell: { channel: 'direct', visit_bucket: '1' as const, region: 'US-NY', affinity: 'occasion:evening' },
  arm: 'personalized' as const, versions: { config: 1, lift: 0, prior: 0, policy: 0 }, configLabel: 'v1',
};

describe('the decision with exploration and controls', () => {
  it('W28.01 suppresses Thompson in direct live helpers without changing other score channels or accepting a request flag', () => {
    const snapshot = snap({ a: { n: 100, s: 1, lift: 0.5 }, d: { n: 100, s: 90, lift: 2 }, n: { n: 100, s: 1, lift: 0.5 } });
    for (const share of [0, 1]) for (const gamma of [0, 1]) {
      const cfg = { mode: 'thompson' as const, share, floor: 50 };
      const learning = { snapshots: { hero: snapshot }, gammaOf: () => gamma, exploreOf: () => cfg };
      const input = { ...base, learning, historical: true };
      const current = decideContent(input), off = decideContent({ ...input, learning: { ...learning, exploreOf: () => ({ ...cfg, mode: 'off' as const }) } });
      expect(current.records).toEqual(off.records); expect(current.records).toHaveLength(1);
      expect(current.records[0]!.inputs!.replay!.exploration).toBe('supported-only');
      expect(current.records[0]!.explored).toBe(false);
      expect(explorationPick({ visitorId: 'v1', slot: 'hero', nowMs: T0, ranked, snapshot, cfg }, 'historical' as never)).toBeNull();
    }
  });

  it('W11.02 W28.01 retained Thompson stays inactive; actual human reset retains intent, fences revocation and retries only publication', async () => {
    invalidateCache();
    const secret = 'w2801-synthetic-operator-signing', at = Date.now(), accounts = memoryStore(), authority = memoryAuthority(accounts);
    await accounts.put({ id: 'ops', email: 'ops@example.invalid', name: 'Synthetic', roles: ['operator'], permissions: ['read'], updatedAt: at });
    await accounts.putSession({ jti: 'session', accountId: 'ops', tokenHash: 'synthetic', createdAt: at, expiresAt: at + 300000 });
    const membership = { tenant: 'coach', accountId: 'ops', role: 'operator' as const, revision: 'r1', updatedAt: at, disabled: false, removed: false };
    authority.memberships.set(JSON.stringify(['ops', 'coach']), membership);
    const storage = new AuthorityR2(), cache = new Map<string, string>(), env = { JWT_SECRET: secret, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
      AUTH_MODE: 'enforced', DEPLOYMENT_PROFILE: 'customer', ACCOUNTS: accounts, AUTHORITY: authority,
      TENANTS: JSON.stringify({ provisioned: ['coach'] }), STORAGE: storage,
      CACHE: { get: async (key: string) => cache.has(key) ? JSON.parse(cache.get(key)!) : null, put: async (key: string, value: string) => { cache.set(key, value); } },
    } as unknown as Env;
    const legacy = { ...DEFAULT_LEARN, slots: { hero: { gamma: 0.7, exploration: { mode: 'thompson', share: 1, floor: 50 } } } };
    await initializePublicationSet(env, [
      { kind: CONTENT_KIND, scope: 'coach', revision: { revision: 1, value: EMPTY_CATALOG, actor: 'fixture', at, note: '' } },
      { kind: LEARN_KIND, scope: 'coach', retainedValue: true, revision: { revision: 3, value: legacy, actor: 'old', at, note: '' } },
      { kind: SLOTS_KIND, scope: 'coach', revision: { revision: 2, value: { pages: { home: slots } }, actor: 'old', at, note: '' } },
      { kind: PRIORS_KIND, scope: 'coach', revision: { revision: 1, value: { rows: [] }, actor: 'fixture', at, note: '' } },
    ], '0:' + crypto.randomUUID());
    class State {
      map = new Map<string, unknown>(); alarm: number | null = null;
      async get(k: string) { return structuredClone(this.map.get(k)); } async put(k: string, v: unknown) { this.map.set(k, structuredClone(v)); }
      async getAlarm() { return this.alarm; } async setAlarm(n: number) { this.alarm = n; }
      async transaction<T>(run: (s: State) => Promise<T>) { return run(this); }
    }
    const state = new State(), stats = emptyStats(), cell = { channel: 'direct', visit_bucket: '1' as const, region: null, affinity: null };
    recordExposure(stats, 'a', cell, at, DEFAULT_STATS);
    state.map.set('learn', { tenant: 'coach', brand: 'coach', slot: 'hero', config: { reward: 'click', stats: DEFAULT_STATS }, stats });
    const object = new LearnStats({ storage: state } as unknown as DurableObjectState, env); let resets = 0, beforeReset: (() => Promise<void>) | undefined;
    env.LEARN_STATS = { idFromName: (name: string) => name, get: () => ({ fetch: async (url: string, init: RequestInit) => {
      resets++; await beforeReset?.(); return object.fetch(new Request(url, init));
    } }) } as unknown as DurableObjectNamespace;
    const token = await new SignJWT({ sub: 'ops', type: 'access', sid: 'session' }).setProtectedHeader({ alg: 'HS256' }).setIssuer('i').setAudience('a').setExpirationTime('5m').sign(new TextEncoder().encode(secret));
    const app = new Hono(); app.use('*', tenantMiddleware()); app.route('/v1', decisionRoutes);
    const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'X-Tenant': 'coach' };
    const authored = async () => { const base = await readPublication(env, LEARN_KIND, 'coach'); return { ...headers,
      'If-Match': '"' + base.revision + '/' + base.publication!.revision + '/' + base.publication!.digest + '"', 'Idempotency-Key': base.revision + ':' + crypto.randomUUID() }; };
    const ask = (path: string, h = headers, body?: unknown) => app.request('http://w/v1/coach/' + path,
      { headers: h, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) }, env);
    for (const published of [false, true]) {
      if (published) cache.set('lift:coach:coach:hero', JSON.stringify(snap({ a: { n: 1, s: 0, lift: 1 } })));
      expect(await (await ask('learn/exploring?slot=hero')).json()).toMatchObject({ mode: 'off', share: 0, configuredMode: 'thompson', unsupported: true });
      expect(await (await ask('learn/slots')).json()).toMatchObject({ pages: [{ slots: [expect.objectContaining({ exploration: 'off', configuredExploration: 'thompson' })] }] });
    }
    const reset = { slot: 'hero', item: 'a' }, legacyBytes = storage.objects.get('config-publication/v1/coach/learn/rev/3.json')!.text;
    expect((await ask('learn/items/reset', await authored(), reset)).status).toBe(422); expect(resets).toBe(0);
    const base = await readPublication(env, LEARN_KIND, 'coach');
    expect((await write(env, LEARN_KIND, 'coach', { ...DEFAULT_LEARN, slots: { hero: { gamma: 0.7 } } },
      { actor: 'ops', expectedRevision: base.revision, expectedPublication: base.publication, operationId: base.revision + ':' + crypto.randomUUID() })).ok).toBe(true);
    const intent = await authored(); let release!: () => void, entered!: () => void;
    const wait = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { entered = r; });
    storage.gate = async key => { if (key.endsWith('/set/3.json')) { storage.gate = undefined; entered(); await wait; } };
    const delayed = ask('learn/items/reset', intent, reset); await started;
    authority.memberships.set(JSON.stringify(['ops', 'coach']), { ...membership, disabled: true }); release();
    expect((await delayed).status).toBe(403); expect(resets).toBe(0); expect(state.map.has('learnReset')).toBe(false);
    authority.memberships.set(JSON.stringify(['ops', 'coach']), membership); storage.failArchive = true;
    beforeReset = async () => {
      beforeReset = undefined;
      const current = await readPublication(env, LEARN_KIND, 'coach');
      expect((await write(env, LEARN_KIND, 'coach', { ...current.value, slots: { hero: { gamma: 0.9 } } },
        { actor: 'ops', expectedRevision: current.revision, expectedPublication: current.publication,
          operationId: current.revision + ':' + crypto.randomUUID() })).ok).toBe(true);
    };
    expect(await (await ask('learn/items/reset', intent, reset)).json()).toMatchObject({ ok: true, resetCompleted: true, publicationOutcome: 'unknown' });
    expect((await readPublication(env, LEARN_KIND, 'coach')).value.slots?.hero.gamma).toBe(0.9);
    const committedFence = structuredClone(state.map.get('learnFence')), originalReceipt = structuredClone(state.map.get('learnReset'));
    const after = state.map.get('learn') as { stats: ReturnType<typeof emptyStats> }; recordExposure(after.stats, 'a', cell, at + 1, DEFAULT_STATS);
    storage.failArchive = false;
    expect(await (await ask('learn/items/reset', intent, reset)).json()).toMatchObject({ ok: true, publicationOutcome: 'acknowledged' });
    expect(state.map.get('learnFence')).toEqual(committedFence); expect(state.map.get('learnReset')).toEqual(originalReceipt);
    expect((await readPublication(env, LEARN_KIND, 'coach')).value.slots?.hero.gamma).toBe(0.9);
    expect((state.map.get('learn') as typeof after).stats.items.a!['*']!.n.s).toBe(1);
    expect(storage.objects.get('config-publication/v1/coach/learn/rev/3.json')!.text).toBe(legacyBytes);
  });

  it('an exploration pick is served first, flagged, and explained; the holdout arm never explores', () => {
    const s = snap({ a: { n: 500, s: 60, lift: 1.2 }, d: { n: 500, s: 50, lift: 1 }, n: { n: 2, s: 0, lift: 1 } });
    const inn = Array.from({ length: 300 }, (_, i) => `x${i}`).find((v) => bucketOf(v, 'hero', hourKeyOf(T0)) < 0.5)!;
    const out = decideContent({ ...base, visitorId: inn, learning: { snapshots: { hero: s }, gammaOf: () => 0, exploreOf: () => ({ mode: 'rotation', share: 0.5, floor: 50 }) } });
    const hero = out.records.find((r) => r.slot === 'hero')!;
    expect(hero.item_id).toBe('n'); expect(hero.explored).toBe(true);
    expect(hero.explain.exploration).toMatchObject({ mode: 'rotation', reason: expect.stringContaining('under-observed') });
    expect(hero.candidates[0]!.contentId).toBe('n');
    const held = decideContent({ ...base, visitorId: inn, arm: 'default', learning: { snapshots: { hero: s }, gammaOf: () => 0, exploreOf: () => ({ mode: 'rotation', share: 1, floor: 50 }) } });
    expect(held.records.find((r) => r.slot === 'hero')!.explored).toBe(false);
  });

  it('reject ignores an item\'s lift; freeze holds it at the chosen value', () => {
    const s = snap({ a: { n: 500, s: 10, lift: 0.5 }, d: { n: 500, s: 50, lift: 2 } });
    const learning = (items: Record<string, { mode: 'reject' | 'freeze'; lift?: number }>) => ({ snapshots: { hero: s }, gammaOf: () => 1, controlOf: (_slot: string, item: string) => items[item] ?? null });
    const plain = decideContent({ ...base, learning: learning({}) });
    expect(plain.records.find((r) => r.slot === 'hero')!.item_id).toBe('d');   // 0.28 × 2 beats 0.455 × 0.5
    // Doc 22 §12.2: reject ignores the learned lift for the item, which then competes on its base score
    // alone. d keeps the slot on base (0.28) because a's lift of 0.5 halves a to 0.2275; the receipt says so.
    const rejected = decideContent({ ...base, learning: learning({ d: { mode: 'reject' } }) });
    const hr = rejected.records.find((r) => r.slot === 'hero')!;
    expect(hr.item_id).toBe('d'); expect(hr.explain.control).toBe('reject'); expect(hr.explain.lift).toBeNull();
    expect(hr.explain.score_final).toBeCloseTo(0.28, 3);
    expect(hr.candidates.find((c) => c.contentId === 'a')!.score).toBeCloseTo(0.455 * 0.5, 2);   // candidate scores are rounded to 3 decimals
    const frozen = decideContent({ ...base, learning: learning({ a: { mode: 'freeze', lift: 3 } }) });
    const hf = frozen.records.find((r) => r.slot === 'hero')!;
    expect(hf.item_id).toBe('a'); expect(hf.explain.control).toBe('freeze'); expect(hf.explain.lift).toMatchObject({ lift: 3, level_words: 'frozen by a merchandiser' });
    expect(hf.explain.score_final).toBeCloseTo(0.455 * 3, 3);
  });
});

describe('the autonomy cycle', () => {
  const tags = { a: { occasion: ['evening'], line: ['drover'] }, d: { occasion: ['evening'] }, n: { occasion: ['weekend'] } };
  const weights = { occasion: 0.35, line: 0.25 };

  it('evidence groups lift by tag value per weighted dimension; the proposal raises the most discriminating one by one step', () => {
    const s = snap({ a: { n: 400, s: 60, lift: 1.5 }, d: { n: 400, s: 40, lift: 1 }, n: { n: 400, s: 20, lift: 0.5 } }, 1200);
    const ev = evidenceFor(weights, tags, s);
    expect(ev[0]!.dimension).toBe('occasion');
    expect(ev[0]!.values.evening.meanLift).toBeCloseTo(1.25, 2);
    expect(ev[0]!.values.weekend.meanLift).toBe(0.5);
    expect(ev[0]!.spread).toBeCloseTo(0.75, 2);
    expect(ev[1]!.spread).toBe(0);                                                  // line has one value: nothing to separate
    const cfg = { ...DEFAULT_AUTONOMY, mode: 'assisted' as const, minN: 500 };
    const { proposal, reason } = proposeFor({ tenant: 'coach', brand: 'coach', slot: 'hero' }, weights, tags, s, cfg, T0);
    expect(proposal).toMatchObject({ dimension: 'occasion', from: 0.35, to: 0.4, status: 'proposed', exposures: 1200 });
    expect(reason).toContain('occasion');
    expect(proposeFor({ tenant: 'coach', brand: 'coach', slot: 'hero' }, weights, tags, s, { ...cfg, minN: 5000 }, T0).proposal).toBeNull();
    expect(proposeFor({ tenant: 'coach', brand: 'coach', slot: 'hero' }, weights, tags, s, { ...cfg, pinned: ['occasion'] }, T0).proposal).toBeNull();
    expect(proposeFor({ tenant: 'coach', brand: 'coach', slot: 'hero' }, weights, tags, s, { ...cfg, mode: 'configured' }, T0).proposal).toBeNull();
    expect(applyProposal(weights, { dimension: 'occasion', to: 1.7 }, cfg)).toEqual({ occasion: 1, line: 0.25 });
  });

  it('withdraws cycle/apply/reject before all environment access, including concurrent retries', async () => {
    const accesses: string[] = [];
    const refuseAccess = (kind: string) => { accesses.push(kind); throw new Error('unexpected environment access'); };
    const env = new Proxy({} as Env, {
      get: (_target, key) => refuseAccess(String(key)),
      has: (_target, key) => refuseAccess(String(key)),
      ownKeys: () => refuseAccess('enumerate'),
      getOwnPropertyDescriptor: (_target, key) => refuseAccess(String(key)),
    });
    const ask = () => [
      runCycle(env, 'coach', 'coach', T0, 'cron'),
      decideProposal(env, 'coach', 'stale-proposed', 'apply', 'operator', T0),
      decideProposal(env, 'coach', 'already-applied', 'reject', 'admin', T0),
    ];
    for (let retry = 0; retry < 2; retry++) {
      const results = await Promise.all([...ask(), ...ask()]);
      for (const result of results) {
        expect(result).toMatchObject({ ok: false, code: 'autonomy_unavailable', error: expect.stringContaining('unavailable') });
        expect(result).not.toHaveProperty('revision');
        expect(result).not.toHaveProperty('results');
      }
    }
    expect(accesses).toEqual([]);
  });

  it('real authenticated routes refuse all mutations and retain read-only unverified historical records', async () => {
    invalidateCache();
    const secret = 'w2901-local-synthetic-signing-material';
    const proposals = ['proposed', 'applied', 'rejected'].map((status, i) => ({
      id: 'same-slot-id', tenant: 'coach', brand: 'coach', slot: 'hero', at: T0 - 30 * 86_400_000,
      mode: 'autonomous', dimension: 'occasion', from: 0.1, to: 0.15, status,
      snapshotVersion: i, exposures: 10_000, evidence: [], note: 'historical unverified receipt',
    }));
    const stored = new Map([
      ['proposals:config:coach:current', JSON.stringify({ revision: 7, value: { proposals }, actor: 'fixture', note: '', at: T0 })],
      ['slots:config:coach:current', JSON.stringify({ pages: { home: [{ slot: 'hero', weights: { occasion: 0.9 }, pinnedPieceId: 'a' }], other: [{ slot: 'hero', weights: { occasion: 0.9 } }] } })],
      ['learn:config:coach:current', JSON.stringify({ slots: { hero: { autonomy: { mode: 'autonomous', pinned: ['occasion'], step: 0.05 } } } })],
    ]);
    const calls: string[] = [];
    const before = [...stored];
    const env = {
      JWT_SECRET: secret, JWT_ISSUER: 'w2901', JWT_AUDIENCE: 'w2901',
      CACHE: {
        async get(key: string, type?: string) { calls.push('get:' + key); const value = stored.get(key); return value ? type === 'stream' ? new Response(value).body : JSON.parse(value) : null; },
        async put() { calls.push('put'); throw new Error('unexpected write'); },
        async delete() { calls.push('delete'); throw new Error('unexpected delete'); },
        async list() { calls.push('list'); throw new Error('unexpected list'); },
      },
    } as unknown as Env;
    env.STORAGE = new AuthorityR2() as unknown as R2Bucket;
    await initializePublicationSet(env, [{ kind: PROPOSALS_KIND, scope: 'coach',
      revision: { revision: 7, value: { proposals }, actor: 'fixture', note: '', at: T0 } }], '6:' + crypto.randomUUID());
    const app = new Hono().route('/v1', decisionRoutes);
    const request = (path: string, method: string, token?: string) => app.request('http://local/v1/coach/learn/' + path, {
      method, headers: token ? { authorization: 'Bearer ' + token } : {},
    }, env);
    for (const token of [undefined, 'invalid']) {
      for (const [path, method] of [['cycle', 'POST'], ['proposals/missing/apply', 'POST'], ['proposals/same-slot-id/reject', 'POST'], ['proposals', 'GET']]) {
        expect((await request(path, method, token)).status).toBe(401);
      }
    }
    expect(calls).toEqual([]);
    for (const role of ['operator', 'admin']) {
      const token = await new SignJWT({ sub: 'synthetic-' + role, roles: [role], permissions: [role === 'admin' ? '*' : 'read'] })
        .setProtectedHeader({ alg: 'HS256' }).setIssuer('w2901').setAudience('w2901').setExpirationTime('5m')
        .sign(new TextEncoder().encode(secret));
      for (let retry = 0; retry < 2; retry++) {
        const results = await Promise.all(['cycle?brand=other', 'proposals/same-slot-id/apply', 'proposals/missing/apply', 'proposals/same-slot-id/reject']
          .map(path => request(path, 'POST', token)));
        for (const result of results) {
          expect(result.status).toBe(503);
          expect(result.headers.get('cache-control')).toBe('no-store');
          expect(await result.json()).toMatchObject({ ok: false, code: 'autonomy_unavailable', error: expect.stringContaining('unavailable') });
        }
      }
      expect(calls).toEqual([]);
      const history = await request('proposals', 'GET', token);
      expect(history.status).toBe(200);
      expect(history.headers.get('cache-control')).toBe('no-store');
      expect(await history.json()).toMatchObject({
        ok: true, proposals,
        history: { historical: true, verified: false, readOnly: true, complete: false, mutationAvailable: false },
      });
      expect(calls).toEqual([]); // Configuration comes only from the explicit R2 baseline.
      expect([...stored]).toEqual(before);
      calls.length = 0; invalidateCache();
    }
    expect(PROPOSALS_KIND.name).toBe('proposals');
  });
});
