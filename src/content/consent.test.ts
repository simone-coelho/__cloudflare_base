// src/content/consent.test.ts
// CW31 (BTIE D10), the content service's half: either switch off means the
// site's defaults whatever the holdout hash says; tracking off means the
// engine writes nothing about the request (no ring, no exposure, no ledger);
// explicit scoped authority is required; unknown and legacy defaults are OFF.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Env } from '@/types/env';
import { invalidateCache, write as writePublication, type DocumentKind, type WriteMeta } from '@/config/versionedStore';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from './kinds';
import { armUnder, consentFromCookies, consentOf, personalizes } from './consent';
import { serveContentDecisions, invalidateLiftCache } from './service';
import { compareRecords, replayDecision, replayDeps } from '@/learn/replay';
import type { DecisionRecord, LearnConfig, SlotCatalog } from './types';
import { consumeLedger } from '@/ledger/consume';
import { recoveryDigest } from '@/ledger/recovery';
import { enqueueDecisions } from '@/ledger/enqueue';
import { expandLedgerMessage, findById } from '@/ledger/writer';
import { newAnonymousSession, issueSessionCapability, SessionAccessError } from '@/identity/sessionCapability';
import { outcomeToLearning } from '@/learn/route';
import { outcomeFromAction, parseId } from '@/ledger/records';
import { decideContent, type DecideInput } from './decide';
import { HISTORICAL_EXPLORATION } from '@/learn/explore';
import { HISTORICAL_PINS } from '@/reflex/contentCompose';
import { HISTORICAL_CONTENT_TYPES } from './typeAffinity';
import { initializePublicationSet, readPublication } from '@/config/publication';
import { PROPOSALS_KIND, EMPTY_PROPOSALS } from '@/learn/cycle';
import { tombstoneKey } from '@/ledger/erasure';
import * as configStore from '@/config/versionedStore';
import { DEFAULT_STATS, buildSnapshot, emptyStats, levelKeys, liftFor, recordExposure, recordSuccess, type LiftSnapshot, type StatsState } from '@/learn/stats';
import { liftArchiveKey, liftKey } from '@/learn/fan';
import { LearnStats } from '@/durable-objects/LearnStats';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { DEFAULT_POLICY, type RingEntry } from '@/learn/policy';
import { parsePriorsCsv, PRIORS_KIND, validatePriors } from '@/learn/priors';
import { slotsIndex } from '@/learn/rows';
import { queueOf } from '@/learn/queue';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { chooseConsent, carryConsent, storedConsent, CONSENT_LIFETIME_MS, consentInstruction } from './consent';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { admitOwnerPrincipal, ownerEnvironment, runOwnerOperation } from '@/identity/sessionAuthority';
import type { Consent } from './consent';
import type { RecoveryInput } from '@/ledger/recovery';
import { captureRetention } from '@/retention';

describe('W05.10 explicit consent primitives', () => {
  const principal = { tenant: 'meridian', subject: 'vis-fixture', grantId: 'grant', authorityEpoch: 'epoch', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 };
  it('rejects absent/legacy/unproven authority while missing hints stay neutral, preserving carried wrapper restrictions', () => {
    expect(storedConsent(undefined)).toEqual({ tracking: false, personalization: false });
    expect(storedConsent({ tracking: true, personalization: true })).toEqual({ tracking: false, personalization: false });
    expect(consentFromCookies(null)).toEqual({ tracking: true, personalization: true });
    const now = Date.now(), operation = { id: 'first', expectedRevision: null, grantId: 'grant', iat: principal.iat, exp: principal.exp };
    const record = chooseConsent(undefined, { tracking: true, personalization: true }, operation, principal, now);
    const wrapped = { ...consentInstruction(record), tracking: false };
    const carried = carryConsent(wrapped, { tenant: 'meridian', subject: 'sh_destination' });
    expect(carried.tracking).toBe(false); expect(carried.instruction?.tracking?.expiresAt).toBe(now + CONSENT_LIFETIME_MS);
    const fullGrant = { ...principal, subject: 'sh_destination', sessionId: 'new-sid', kind: 'recognized' as const };
    const exact = carryConsent(wrapped, fullGrant);
    expect(Object.entries(exact.instruction!).filter(([, value]) => value !== undefined).map(([key]) => key).sort())
      .toEqual(['personalization', 'revision', 'subject', 'tenant', 'tracking', 'version']);
    expect(storedConsent(exact)).toEqual(exact); expect(exact.instruction?.tracking).toEqual(carried.instruction?.tracking);
    const partial = chooseConsent(wrapped, { personalization: false }, { ...operation, id: 'next', expectedRevision: 'first' }, principal, now + 1);
    expect(partial.tracking).toEqual({ ...record.tracking, value: false });
    expect(partial.personalization?.chosenAt).toBe(now + 1);
    expect(() => storedConsent(null)).toThrow('unavailable');
  });
  it('uses server time once, rejects changed/stale/current-grant replay, and expires switches independently', () => {
    const now = Date.now(), operation = { id: 'first', expectedRevision: null, grantId: 'grant', iat: principal.iat, exp: principal.exp };
    const first = chooseConsent(undefined, { tracking: true }, operation, principal, now);
    expect(chooseConsent(first, { tracking: true }, operation, principal, now + 1)).toEqual(first);
    expect(() => chooseConsent(first, { tracking: false }, operation, principal, now + 1)).toThrow('conflict');
    expect(() => chooseConsent(first, { tracking: true }, operation, { ...principal, grantId: 'fresh' }, now + 1)).toThrow('Invalid');
    const second = chooseConsent(first, { personalization: true }, { ...operation, id: 'second', expectedRevision: 'first' }, principal, now + 100);
    expect(second.tracking).toEqual(first.tracking);
    expect(consentInstruction(second, now + CONSENT_LIFETIME_MS)).toMatchObject({ tracking: false, personalization: true });
    expect(consentInstruction(second, now + CONSENT_LIFETIME_MS + 100)).toEqual({ tracking: false, personalization: false });
  });
});

class FakeKV {
  store = new Map<string, string>();
  reads: string[] = [];
  async get(key: string, type?: string): Promise<unknown> { this.reads.push(key); const raw = this.store.get(key); return raw === undefined ? null : type === 'stream' ? new Response(raw).body : JSON.parse(raw); }
  async put(key: string, value: string): Promise<void> { this.store.set(key, value); }
}
/** A namespace whose one object answers every fetch with `reply` and records what was asked. */
const fakeNs = (reply: unknown, calls: string[]) => ({
  idFromName: (n: string) => n,
  get: (id: string) => ({ fetch: async (url: string, init?: { method?: string }) => { calls.push(`${id} ${init?.method ?? 'GET'} ${new URL(url).pathname}`); return new Response(JSON.stringify(reply), { status: 200, headers: { 'Content-Type': 'application/json' } }); } }),
}) as unknown as DurableObjectNamespace;

const piece = (id: string) => ({ id, customerContentId: `cms-${id}`, type: 'editorial', title: id, tags: { line: ['Drover'] }, slotTypes: ['hero'] });
const visitor = 'vis-00000000-0000-4000-8000-000000000001';
const fixtureConsent = new WeakMap<Env, Consent>();
/** A test author explicitly reads and captures the base before each new draft. */
async function write<T>(env: Env, kind: DocumentKind<T>, scope: string, value: unknown, meta: WriteMeta) {
  const base = await readPublication(env, kind, scope);
  return writePublication(env, kind, scope, value, { expectedRevision: base.revision, expectedPublication: base.publication,
    operationId: base.revision + ':' + crypto.randomUUID(), ...meta });
}

async function envWith(snapshot: Record<string, unknown>, learn: LearnConfig = { holdout: { share: 0, salt: '', arms: ['default'] } }, pageSlots = ['hero'], tenant = 'coach', retainedLearn = false): Promise<{ env: Env; ring: string[]; shopper: string[] }> {
  const ring: string[] = [], shopper: string[] = [];
  const objects = new Map<string, { text: string; etag: string }>();
  let version = 0;
  const storage = {
    async list(options: { prefix: string }) { return { objects: [...objects.keys()].filter(key => key.startsWith(options.prefix)).map(key => ({ key })), truncated: false }; },
    async get(key: string) {
      const value = objects.get(key);
      return value ? { key, etag: value.etag, size: new TextEncoder().encode(value.text).length,
        body: new Response(value.text).body, text: async () => value.text, json: async () => JSON.parse(value.text) as unknown } : null;
    },
    async put(key: string, text: string, options?: R2PutOptions) {
      const condition = options?.onlyIf;
      if (condition instanceof Headers ? objects.has(key) : condition && condition.etagMatches !== objects.get(key)?.etag) return null;
      const etag = 'fixture-' + (++version); objects.set(key, { text, etag });
      return { key, etag, size: new TextEncoder().encode(text).length };
    },
  };
  const env = {
    CACHE: new FakeKV(), REFLEX_HOST: 'do', ENVIRONMENT: 'test',
    STORAGE: storage, // Real synthetic publication, with definite absence for unseeded barrier keys.
    JWT_SECRET: 'w0504-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
    SHOPPER_REFLEX: fakeNs({ ok: true, affinity: null, journeyStage: 'mid', consent: { tracking: true, personalization: true }, ...snapshot }, shopper),
    DECISION_RING: fakeNs({ ok: true }, ring),
    TENANTS: JSON.stringify({ provisioned: [tenant] }),
    RETENTION: JSON.stringify({ version: 1, tenants: { [tenant]: Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly', 'recovery'].map(category => [category,
      { id: 'explicit-content-fixture-' + category, revision: 1, durationMs: 365 * 86400_000, basis: 'admitted', renewal: 'new-record-only' }])) } }),
  } as unknown as Env;
  const declared = (snapshot.consent ?? { tracking: true, personalization: true }) as { tracking: boolean; personalization: boolean };
  const now = Date.now(), consent = { ...declared, instruction: { version: 1 as const, tenant, subject: visitor, revision: 'fixture-choice',
    tracking: { value: declared.tracking, chosenAt: now, expiresAt: now + CONSENT_LIFETIME_MS },
    personalization: { value: declared.personalization, chosenAt: now, expiresAt: now + CONSENT_LIFETIME_MS } } };
  fixtureConsent.set(env, consent);
  env.SHOPPER_REFLEX = fakeNs({ ok: true, affinity: null, journeyStage: 'mid', ...snapshot, consent }, shopper);
  invalidateCache();
  const values = [
    [CONTENT_KIND, tenant, { pieces: [piece('a'), piece('b')].map(p => ({ ...p, slotTypes: pageSlots, lifecycle: { status: 'live' as const } })) }],
    [SLOTS_KIND, tenant, { pages: { home: pageSlots.map(slot => ({ slot, take: 1, weights: { line: 0.5 } })) } }],
    [LEARN_KIND, tenant, learn], [REFLEX_KIND, reflexScopeForTenant(tenant), DEFAULT_REFLEX_CONFIG],
    [PRIORS_KIND, tenant, { rows: [] }], [PROPOSALS_KIND, tenant, EMPTY_PROPOSALS],
  ] as Array<[DocumentKind<unknown>, string, unknown]>;
  expect((await initializePublicationSet(env, values.map(([kind, scope, value]) => ({ kind, scope,
    ...(kind.name === 'learn' && retainedLearn ? { retainedValue: true as const } : {}), revision: { revision: 1, at: 1, actor: 'test', note: '', value } })), '0:' + crypto.randomUUID())).revision).toBe(1);
  return { env, ring, shopper };
}
const serve = async (env: Env, nowMs?: number, guarded = false) => {
  const principal = await issueSessionCapability(env, { tenant: 'coach', subject: visitor, sessionId: 's1', kind: 'anonymous',
    grantId: '10000000-0000-4000-8000-000000000001', authorityEpoch: '20000000-0000-4000-8000-000000000001' });
  const owner = {};
  return runOwnerOperation(owner, env, async () => {
    admitOwnerPrincipal(owner, principal);
    const result = await serveContentDecisions(guarded ? ownerEnvironment(owner, env) : env, { tenant: 'coach', page: 'home', visitorId: visitor, sessionId: 's1', channel: 'direct', cf: null, cookieHeader: null, stateTenant: 'coach', principal, capability: principal.capability, nowMs });
    await result.afterResponse; return result;
  }, undefined, undefined, async () => fixtureConsent.get(env)!);
};

it('W09.09 actual content caller freezes one combined admission before either sink and owner completion drains admission failure or delay', async () => {
  for (const fail of [false, true]) {
    const { env, ring } = await envWith({}); env.LEDGER_RECOVERY_ENABLED = 'true';
    const principal = await issueSessionCapability(env, { tenant: 'coach', subject: visitor, sessionId: 's1', kind: 'anonymous' }), owner = {};
    const statistics: string[] = []; env.LEARN_STATS = fakeNs({ ok: true }, statistics);
    const queue = vi.fn(); env.EVENT_QUEUE = { send: queue } as unknown as Queue;
    let entered!: () => void, release!: () => void, admitted: RecoveryInput | undefined;
    const started = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    let complete = false;
    const pending = runOwnerOperation(owner, env, async () => {
      admitOwnerPrincipal(owner, principal);
      const result = await serveContentDecisions(env, { tenant: 'coach', page: 'home', visitorId: visitor, sessionId: 's1', channel: 'direct',
        cf: null, cookieHeader: null, stateTenant: 'coach', principal, capability: principal.capability });
      void result.afterResponse.catch(() => {}); return result;
    }, undefined, undefined, async () => fixtureConsent.get(env)!, undefined, undefined, async input => {
      admitted = structuredClone(input); entered(); await gate;
      if (fail) throw new Error('synthetic durable admission unavailable');
      return { version: 1, operation: 'a'.repeat(64), durable: true, source: { expected: input.kind === 'decisions' ? input.records.length : 1, state: 'recovered' } };
    });
    const observed = pending.then(value => { complete = true; return value; }, error => { complete = true; throw error; });
    await Promise.race([started, observed.then(() => { throw new Error('Owner returned before admission'); })]);
    await Promise.resolve(); expect(complete).toBe(false); expect(ring).toEqual([]); expect(statistics).toEqual([]); expect(queue).not.toHaveBeenCalled();
    expect(admitted).toMatchObject({ kind: 'decisions', tenant: 'coach', subject: visitor, configs: { hero: expect.any(Object) } });
    if (fail) { const rejection = expect(observed).rejects.toThrow('synthetic durable admission unavailable'); release(); await rejection; }
    else { release(); const result = await observed; expect(admitted && admitted.kind === 'decisions' && admitted.records).toEqual(result.records); }
  }
});

describe('CW31 consent, the pure part', () => {
  it('W26.02 projects exact tracked receipt IDs without changing decisions records or consent effects', async () => {
    for (const tracking of [true, false]) {
      const { env, ring } = await envWith({ consent: { tracking, personalization: true } }, undefined, ['hero', 'story']);
      const now = Date.now(), first = await serve(env, now), second = await serve(env, now);
      await Promise.all([first.afterResponse, second.afterResponse]);
      expect(first.write).toBe(tracking); expect(first.decisions).toHaveLength(2);
      for (const set of [first, second]) {
        const positions = new Map<string, number>();
        for (const [index, decision] of set.decisions.entries()) {
          const record = set.records[index]!;
          expect(record).toMatchObject({ item_id: decision.contentId, slot: decision.slot, customer_item_id: decision.customerContentId,
            position: positions.get(decision.slot) ?? 0 });
          positions.set(decision.slot, record.position + 1);
          expect(decision.order).toBe(index);
          if (tracking) expect(decision.decisionId).toBe(record.decision_id);
          else expect(decision).not.toHaveProperty('decisionId');
        }
        expect(new Set(set.records.map(r => r.decision_id)).size).toBe(2);
      }
      const withoutIds = (set: typeof first) => set.decisions.map(d => { const copy = { ...d }; delete copy.decisionId; return copy; });
      expect(withoutIds(first)).toEqual(withoutIds(second));
      if (tracking) {
        expect(new Set([...first.decisions, ...second.decisions].map(d => d.decisionId)).size).toBe(4);
        expect(ring.filter(c => c.endsWith('/append'))).toHaveLength(2);
      } else expect(ring).toEqual([]);
    }
  });
  it('reads either source, treats absent or legacy authority as OFF, and forces the default arm when either switch is off', () => {
    expect(consentOf(null)).toEqual({ tracking: false, personalization: false });
    expect(consentOf({ preferences: { trackingConsent: false, personalizationEnabled: true } })).toEqual({ tracking: false, personalization: false });
    expect(consentOf({ consent: { tracking: true, personalization: false } })).toEqual({ tracking: false, personalization: false });
    expect(() => consentOf({ consent: { tracking: 'false' } })).toThrow('unavailable');
    expect(consentFromCookies('opt_session=abc; opt_tracking_consent=false; opt_personalization_enabled=true')).toEqual({ tracking: false, personalization: true });
    expect(consentFromCookies(null)).toEqual({ tracking: true, personalization: true });
    expect(armUnder({ tracking: true, personalization: true }, 'personalized')).toBe('personalized');
    expect(armUnder({ tracking: true, personalization: false }, 'personalized')).toBe('default');
    expect(armUnder({ tracking: false, personalization: true }, 'no_learning')).toBe('default');
    expect(personalizes({ tracking: true, personalization: false })).toBe(false);
  });
});

describe('CW31 consent on the content service', () => {
  beforeEach(() => { invalidateCache(); invalidateLiftCache(); });

  it('W26.04 keeps actual fatigue ranking receipts and replay within the requested brand', async () => {
    const now = Date.now(), tenant = 'meridian', brand = 'alpha';
    const { env, ring } = await envWith({ affinity: { dims: { line: { Drover: 1 } } } }, undefined, ['hero'], tenant);
    expect((await write(env, REFLEX_KIND, reflexScopeForTenant(tenant), DEFAULT_REFLEX_CONFIG, { actor: 'synthetic' })).ok).toBe(true);
    expect((await write(env, SLOTS_KIND, tenant, { pages: { home: [{ slot: 'hero', take: 2, weights: { line: 1 },
      fatigue: { weight: 0.6, windowHours: 24, cap: 3 } }] } }, { actor: 'test' })).ok).toBe(true);
    const principal = await issueSessionCapability(env, { tenant, subject: visitor, sessionId: 's1', kind: 'anonymous' });
    const request = { tenant, brand, stateTenant: tenant, page: 'home', visitorId: visitor, sessionId: 's1', principal,
      capability: principal.capability, channel: 'direct', cf: null, cookieHeader: null, nowMs: now };
    const reply: { ok: boolean; ring: RingEntry[] } = { ok: true, ring: [] };
    env.DECISION_RING = fakeNs(reply, ring);
    const base: RingEntry = { id: 'history', tenant, visitor_id: visitor, ts: now - 1000, page: 'other-page', slot: 'other-slot',
      item: 'a', session_id: 'old-session', arm: 'personalized', retention: captureRetention(env, tenant, now - 1000),
      cell: { channel: 'direct', visit_bucket: '1', region: null, affinity: null } };
    const foreign = [{ ...base, id: 'foreign', brand: 'beta' }], missing = [{ ...base, id: 'brandless' }];
    const own = [{ ...base, id: 'own-default', brand, arm: 'default' }, { ...base, id: 'own-no-learning', brand, arm: 'no_learning', page: 'third-page', slot: 'third-slot' }];
    const owned = (input: typeof request & { consent?: Consent }) => {
      const owner = {}; return runOwnerOperation(owner, env, async () => {
        admitOwnerPrincipal(owner, principal); const result = await serveContentDecisions(env, input); await result.afterResponse; return result;
      }, undefined, undefined, async () => fixtureConsent.get(env)!);
    };
    const get = async (history: RingEntry[]) => { reply.ring = history; return owned(request); };
    const projection = (set: Awaited<ReturnType<typeof get>>) => set.records.map(r => ({ item: r.item_id, candidates: r.candidates, explain: r.explain, inputs: r.inputs }));
    const empty = await get([]);
    expect(empty.decisions.map(d => d.contentId)).toEqual(['a', 'b']); expect(empty.records[0]!.inputs!.served).toEqual({});
    for (const history of [foreign, missing]) expect(projection(await get(history))).toEqual(projection(empty));
    const local = await get(own), mixed = await get([...foreign, ...own, ...missing]);
    expect(projection(mixed)).toEqual(projection(local)); expect(local.decisions.map(d => d.contentId)).toEqual(['b', 'a']);
    expect(local.records.every(r => r.tenant === tenant && r.brand === brand)).toBe(true);
    const fatigued = local.records.find(r => r.item_id === 'a')!;
    expect(fatigued.explain.fatigue).toMatchObject({ served: 2, windowHours: 24, applied: -0.4 });
    expect(fatigued.explain.score_base).toBeCloseTo(0.6, 12); expect(fatigued.inputs!.served).toEqual({ hero: { a: 2 } });
    expect(local.records.find(r => r.item_id === 'b')!.explain.fatigue).toBeUndefined();
    const recorded = JSON.parse(JSON.stringify(local.records)) as DecisionRecord[], reads = ring.filter(c => c.endsWith('/recent')).length;
    reply.ring = [{ ...base, brand, item: 'b' }, ...foreign];
    for (const record of recorded) {
      const replay = await replayDecision(env, record);
      expect(replay).toMatchObject({ ok: true, equal: true, diff: [] }); expect(replay.replayed!.inputs!.served).toEqual({ hero: { a: 2 } });
    }
    expect(ring.filter(c => c.endsWith('/recent'))).toHaveLength(reads);
    const defaults = await owned({ ...request, consent: { tracking: false, personalization: false } }); await defaults.afterResponse;
    expect(defaults.arm).toBe('default'); expect(defaults.records.every(r => r.explain.fatigue === undefined)).toBe(true);
    expect(ring.filter(c => c.endsWith('/recent'))).toHaveLength(reads);
  });

  it('W20.05 serves dense prefixes and ranked tails with real receipts cached revisions and queue readback', async () => {
    const now = Date.now();
    for (const arm of ['personalized', 'no_learning', 'default'] as const) {
      const learn: LearnConfig = { holdout: { share: arm === 'personalized' ? 0 : 1, salt: 'prefix', arms: [arm === 'no_learning' ? 'no_learning' : 'default'] }, slots: { hero: { gamma: 0.5 }, full: { gamma: 0.5 }, off: { gamma: 0.5 } } };
      const { env } = await envWith({ affinity: { dims: { line: { Drover: 1 } } } }, learn, ['hero', 'full', 'off']);
      const catalog = [...'abcdef'].map(id => ({ ...piece(id), slotTypes: ['hero', 'full', 'off'], lifecycle: { status: 'live' as const } }));
      expect((await write(env, CONTENT_KIND, 'coach', { pieces: catalog }, { actor: 'fixture', expectedRevision: 1, operationId: '1:' + crypto.randomUUID() })).ok).toBe(true);
      const document: SlotCatalog = { pages: { home: [
        { slot: 'hero', take: 3, weights: { line: 1 }, pinnedPieceIds: ['b', 'a'], excludedPieceIds: ['d'] },
        { slot: 'full', take: 2, weights: { line: 1 }, pinnedPieceIds: ['e', 'f'] },
        { slot: 'off', take: 1, weights: {}, pinnedPieceIds: ['missing'], offLimits: true },
      ] } };
      expect((await write(env, SLOTS_KIND, 'coach', document, { actor: 'fixture' })).ok).toBe(true);
      const kv = env.CACHE as unknown as FakeKV, bytes = kv.store.get('slots:config:coach:rev:2');
      const first = await serve(env, now); await first.afterResponse;
      const cached = await serve(env, now + 1); await cached.afterResponse;
      for (const set of [first, cached]) {
        expect(set.arm).toBe(arm); expect(set.decisions.map(d => [d.slot, d.contentId])).toEqual([['hero', 'b'], ['hero', 'a'], ['hero', 'c'], ['full', 'e'], ['full', 'f']]);
        expect(set.records.map(r => [r.position, r.ranking_position])).toEqual([[0, undefined], [1, undefined], [2, 0], [0, undefined], [1, undefined]]);
      }
      const wire: unknown[] = [];
      env.EVENT_QUEUE = { sendBatch: async (messages: Array<{ body: unknown }>) => { wire.push(...messages.map(m => structuredClone(m.body))); } } as unknown as Queue;
      expect((await enqueueDecisions(env, first.records)).code).toBe('accepted'); expect((await consumeLedger(env, wire, now + 2)).written).toBe(5);
      for (const record of first.records) {
        const retained = (await findById<DecisionRecord>(env.STORAGE, record.decision_id, 'decision'))!.record;
        expect(retained).toEqual(record); expect(await replayDecision(env, retained)).toMatchObject({ ok: true, equal: true });
      }
      const idx = slotsIndex(document, { pieces: catalog }, learn, now), rows = idx.pages.flatMap(p => p.slots);
      expect(rows.map(r => [r.slot, r.pinnedPieceIds, r.rankedCapacity])).toEqual([['hero', ['b', 'a'], 1], ['full', ['e', 'f'], 0], ['off', ['missing'], 0]]);
      expect(queueOf({ proposals: [], slots: rows, learn, erasuresPending: 0 }).slots_without_evidence).toEqual([{ page: 'home', slot: 'hero' }]);
      expect(queueOf({ proposals: [], slots: rows, learn, erasuresPending: 0 }).slots_acting).toEqual([{ page: 'home', slot: 'hero', gamma: 0.5 }]);
      expect(kv.store.get('slots:config:coach:rev:2')).toBe(bytes);
      const legacy = JSON.stringify({ revision: 3, at: 1, actor: 'retained', note: '', value: { governanceVersion: 2, pages: { home: [{ slot: 'hero', take: 1, weights: {}, pinnedPieceIds: { unknown: true } }] } } });
      kv.store.set('slots:config:coach:current', legacy); kv.store.set('slots:config:coach:rev:3', legacy); invalidateCache();
      const old = await serve(env, now + 3); await old.afterResponse; expect(old.decisions.map(d => d.contentId)).toEqual(['a']);
      expect(kv.store.get('slots:config:coach:rev:3')).toBe(legacy);
    }
  });

  it('W20.04 serves format-two constraints on all arms with cached and retained revisions', async () => {
    const now = Date.now();
    for (const arm of ['personalized', 'default', 'no_learning'] as const) {
      const learn: LearnConfig = { holdout: { share: arm === 'personalized' ? 0 : 1, salt: 'types', arms: [arm === 'no_learning' ? 'no_learning' : 'default'] } };
      const { env } = await envWith({ affinity: { dims: { contentType: { video: 1, film: 0.8 } } } }, learn, ['hero', 'tagpin', 'typepin']);
      const tags: Array<Record<string, string[]>> = [
        { contentType: [...Array.from({ length: 9 }, (_, i) => `format-${i}`), 'video'] }, {}, { contentType: [] },
        { contentType: ['video'] }, { contentType: [' video '] }, { contentType: ['safe', '<blocked>'] },
      ];
      const catalog = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, index) => ({ ...piece(id), type: id === 'd' ? 'editorial' : 'film', tags: tags[index]!, slotTypes: ['hero', 'tagpin', 'typepin'], lifecycle: { status: 'live' as const } }));
      expect((await write(env, CONTENT_KIND, 'coach', { pieces: catalog }, { actor: 'fixture', expectedRevision: 1, operationId: '1:' + crypto.randomUUID() })).ok).toBe(true);
      const excludedTags = ['video', 'film', '<blocked>'].map(value => ({ dimension: 'contentType', value }));
      const document: SlotCatalog = { pages: { home: [
        { slot: 'tagpin', take: 1, weights: {}, pinnedPieceId: 'a', excludedTags },
        { slot: 'typepin', take: 1, weights: {}, pinnedPieceId: 'd', allowedTypes: ['film'] },
        { slot: 'hero', take: 6, weights: { contentType: 1 }, allowedTypes: ['film'], excludedTags },
      ] } };
      expect((await write(env, SLOTS_KIND, 'coach', document, { actor: 'fixture' })).ok).toBe(true);
      const kv = env.CACHE as unknown as FakeKV, heldBytes = kv.store.get('slots:config:coach:rev:2');
      for (const time of [now, now + 1]) {
        const out = await serve(env, time); await out.afterResponse;
        expect(out.arm).toBe(arm);
        expect(out.decisions.map(d => [d.slot, d.contentId, d.type])).toEqual([['hero', 'c', 'film'], ['hero', 'e', 'film']]);
        expect(out.records.map(r => r.item_id)).toEqual(['c', 'e']);
        expect(out.pinDiagnostics?.map(d => d.reason)).toEqual(['excluded_tag', 'type_not_allowed']);
        expect(out.records[0]!.inputs!.replay!.governance).toBe('slot-gates-v2');
        for (const record of out.records) expect(await replayDecision(env, JSON.parse(JSON.stringify(record)) as DecisionRecord)).toMatchObject({ ok: true, equal: true });
      }
      // Stored v1 never gains new constraints from formerly unknown fields.
      const retained = { governanceVersion: 1, pages: { home: [{ slot: 'hero', take: 1, weights: {}, excludedTags: null, allowedTypes: [] }] } };
      kv.store.set('slots:config:coach:current', JSON.stringify({ revision: 3, value: retained, at: 1, actor: 'old', note: '' })); invalidateCache();
      const old = await serve(env, now + 2); await old.afterResponse;
      expect(old.decisions[0]!.contentId).toBe('a'); expect(old.sources.slots.revision).toBe(3);
      expect(kv.store.get('slots:config:coach:rev:2')).toBe(heldBytes);
      kv.store.delete('slots:config:coach:current'); invalidateCache();
      const absent = await serve(env, now + 3); await absent.afterResponse;
      expect(absent.records).toEqual([]); expect(absent.decisions).toEqual([]); expect(absent.sources.slots.revision).toBe(0);
    }
  });

  it('W20.03 serves hard gates across arms and cached reads without optional dormant work or compiled absence fill', async () => {
    const now = Date.now();
    for (const arm of ['personalized', 'default', 'no_learning'] as const) {
      const learn: LearnConfig = { holdout: { share: arm === 'personalized' ? 0 : 1, salt: 'gates', arms: [arm === 'no_learning' ? 'no_learning' : 'default'] },
        external: { kind: 'table', ref: 'dormant', timeoutMs: 10, fallback: 'omit' }, slots: { hero: { gamma: 1, external: { weight: 1 } }, story: { gamma: 0 } } };
      const { env, ring } = await envWith({ affinity: { dims: { line: { Drover: 1 } } } }, learn, ['hero', 'story', 'silent']);
      const kv = env.CACHE as unknown as FakeKV;
      const document: SlotCatalog = { pages: { home: [
        { slot: 'hero', take: 1, weights: { line: 1 }, pinnedPieceId: 'a', offLimits: true, fatigue: { weight: 1, windowHours: 24, cap: 3 } },
        { slot: 'story', take: 2, weights: { line: 1 }, excludedPieceIds: ['a'] },
        { slot: 'silent', take: 1, weights: {}, offLimits: true },
      ] } };
      expect((await write(env, SLOTS_KIND, 'coach', document, { actor: 'fixture' })).ok).toBe(true);
      kv.reads.length = 0; ring.length = 0;
      for (const at of [now, now + 1]) {
        const out = await serve(env, at); await out.afterResponse;
        expect(out.arm).toBe(arm); expect(out.decisions.map(d => [d.slot, d.contentId])).toEqual([['story', 'b']]);
        expect(out.records.map(r => [r.slot, r.item_id])).toEqual([['story', 'b']]);
        expect(out.sources.external).toBeNull();
        expect(out.records[0]!.inputs!.replay).toMatchObject({ governance: 'slot-gates-v2', slots: document.pages.home!.map(s => ({ slot: s.slot, lift: 0, prior: 0 })) });
        expect(out.pinDiagnostics).toEqual([{ slot: 'hero', pinnedPieceId: 'a', reason: 'off_limits' }]);
      }
      expect(kv.reads).not.toContain(liftKey('coach', 'coach', 'hero'));
      expect(kv.reads).not.toContain(liftKey('coach', 'coach', 'silent'));
      expect(ring.some(call => call.includes(' GET '))).toBe(false);
      const allOff = { ...document, pages: { home: document.pages.home!.map(s => ({ ...s, offLimits: true })) } };
      expect((await write(env, SLOTS_KIND, 'coach', allOff, { actor: 'fixture' })).ok).toBe(true);
      ring.length = 0; kv.reads.length = 0;
      const quiet = await serve(env, now + 2); await quiet.afterResponse;
      expect(quiet.records).toEqual([]); expect(quiet.decisions).toEqual([]); expect(ring).toEqual([]);
      expect(kv.reads.some(key => key.startsWith('lift:'))).toBe(false);
      kv.store.delete('slots:config:coach:current');
      const cached = await serve(env, now + 3); await cached.afterResponse;
      expect(cached.records).toEqual([]); expect(cached.sources.slots.revision).toBe(3);
      for (const value of [null, '{bad-json', JSON.stringify({ revision: 4, at: 1, actor: 'fixture', note: '', value: {
        governanceVersion: 1, pages: { home: [{ slot: 'hero', take: 1, weights: {}, offLimits: 'true' }] },
      } }), JSON.stringify({ revision: 4, at: 1, actor: 'fixture', note: '', value: { governanceVersion: 4, pages: {} } })]) {
        if (value === null) kv.store.delete('slots:config:coach:current'); else kv.store.set('slots:config:coach:current', value);
        invalidateCache(); ring.length = 0;
        const absent = await serve(env, now + 4); await absent.afterResponse;
        expect(absent.records).toEqual([]); expect(absent.decisions).toEqual([]);
        expect(absent.sources.slots).toEqual({ version: null, revision: 0, count: 0 }); expect(ring).toEqual([]);
      }
      const originalGet = kv.get.bind(kv);
      const outage = vi.spyOn(kv, 'get').mockImplementation(async (key, type) => {
        if (key === 'slots:config:coach:current') throw new Error('synthetic slot outage');
        return originalGet(key, type);
      }); invalidateCache();
      const unavailable = await serve(env, now + 5); await unavailable.afterResponse;
      expect(unavailable.decisions).toEqual([]); expect(unavailable.sources.slots.count).toBe(0); outage.mockRestore();
      kv.store.set('slots:config:coach:current', JSON.stringify({ revision: 4, at: 1, actor: 'old', note: '', value: {
        pages: { home: [{ slot: 'hero', take: 1, weights: {}, offLimits: 'unknown', excludedPieceIds: [null] }] },
      } })); invalidateCache();
      const legacy = await serve(env, now + 6); await legacy.afterResponse;
      expect(legacy.records.map(r => r.item_id)).toEqual(['a']); expect(legacy.sources.slots.revision).toBe(4);
    }
  });

  it('W19.02 serves and replays projected content formats with independent historical policy', async () => {
    const now = Date.now(), affinity = { dims: { contentType: { film: 1, video: 0.6 } } };
    const { env } = await envWith({ affinity });
    const pieces = [
      { ...piece('a'), type: 'editorial', tags: {}, lifecycle: { status: 'live' as const } },
      { ...piece('b'), type: 'film', tags: {}, lifecycle: { status: 'live' as const } },
      { ...piece('c'), type: 'film', tags: { contentType: ['video'] }, lifecycle: { status: 'live' as const } },
      { ...piece('d'), type: 'film', tags: { contentType: [] }, lifecycle: { status: 'live' as const } },
    ];
    expect((await write(env, CONTENT_KIND, 'coach', { pieces }, { actor: 'fixture', expectedRevision: 1, operationId: '1:' + crypto.randomUUID() })).ok).toBe(true);
    const slots = [{ slot: 'hero', take: 1, weights: { contentType: 1 } }];
    expect((await write(env, SLOTS_KIND, 'coach', { pages: { home: slots } }, { actor: 'fixture' })).ok).toBe(true);
    const catalog = (await configStore.readRevision(env, CONTENT_KIND, 'coach'))!;
    const catalogBefore = JSON.stringify(catalog), bytes = await (await env.STORAGE.get('config-publication/v1/coach/content/rev/2.json'))!.text();
    const current = await serve(env, now); await current.afterResponse;
    expect(current.records[0]!.item_id).toBe('b'); expect(current.decisions[0]!.type).toBe('film');
    expect(current.records[0]!.explain.drivers).toContainEqual({ dim: 'contentType', value: 'film', a: 1, weight: 1 });
    expect(current.records[0]!.inputs!.replay!.contentTypes).toBe('catalog-tags-v1');
    const served = current.records[0]!;
    const input: DecideInput = { tenant: served.tenant, brand: served.brand, page: served.page, visitorId: served.visitor_id,
      sessionId: served.session_id, identityAnchor: served.identity_anchor, nowMs: now, pieces: catalog.value.pieces, slots,
      affinity, cell: served.cell, arm: 'personalized', versions: served.versions, configLabel: served.config_label };
    const historical = decideContent({ ...input, requestId: crypto.randomUUID() }, undefined, undefined, HISTORICAL_CONTENT_TYPES);
    for (const record of historical.records) record.retention = captureRetention(env, record.tenant, record.ts);
    expect(historical.records[0]!.item_id).toBe('c');
    expect(historical.records[0]!.inputs!.replay).toMatchObject({ pins: 'prefix-reserved-v2', exploration: 'supported-only' });
    expect(historical.records[0]!.inputs!.replay).not.toHaveProperty('contentTypes');
    const wire: unknown[] = [];
    env.EVENT_QUEUE = { sendBatch: async (messages: Array<{ body: unknown }>) => { wire.push(...messages.map(message => JSON.parse(JSON.stringify(message.body)) as unknown)); } } as unknown as Queue;
    expect((await enqueueDecisions(env, [served, historical.records[0]!])).code).toBe('accepted');
    const principal = await issueSessionCapability(env, { tenant: 'coach', subject: visitor, sessionId: 's1', kind: 'anonymous' }), owner = {};
    expect((await runOwnerOperation(owner, env, async () => {
      admitOwnerPrincipal(owner, principal); return consumeLedger(env, wire, now + 1);
    }, undefined, undefined, async () => fixtureConsent.get(env)!)).written).toBe(2);
    for (const record of [served, historical.records[0]!]) {
      const persisted = (await findById<DecisionRecord>(env.STORAGE, record.decision_id, 'decision'))!.record;
      expect(persisted).toEqual(record);
      expect(await replayDecision(env, persisted)).toMatchObject({ ok: true, equal: true });
    }
    // Content-type policy is independent of either other historical switch.
    for (const exploration of [undefined, HISTORICAL_EXPLORATION] as const) for (const pins of [undefined, HISTORICAL_PINS] as const) {
      const live = decideContent(input, exploration, pins), old = decideContent(input, exploration, pins, HISTORICAL_CONTENT_TYPES);
      expect(live.records[0]!.item_id).toBe('b'); expect(old.records[0]!.item_id).toBe('c');
      for (const record of [live.records[0]!, old.records[0]!]) {
        record.retention = captureRetention(env, record.tenant, record.ts);
        expect(await replayDecision(env, JSON.parse(JSON.stringify(record)) as DecisionRecord)).toMatchObject({ ok: true, equal: true });
      }
    }
    for (const value of [undefined, null, false, {}, [], 'old', 'catalog-tags-v1 ']) {
      const invalid = structuredClone(served); invalid.inputs!.replay!.contentTypes = value as never;
      expect(await replayDecision(env, invalid)).toMatchObject({ ok: false, reason: 'invalid page replay manifest' });
    }
    const forged = structuredClone(historical.records[0]!); forged.inputs!.replay!.contentTypes = 'catalog-tags-v1';
    expect((await replayDecision(env, forged)).equal).toBe(false);
    const legacy = structuredClone(historical.records[0]!); delete legacy.inputs!.replay;
    expect((await replayDecision(env, legacy)).equal).toBe(true);
    const regional = decideContent({ ...input, regional: { region: 'US-NY', level: 'region', lambda: 0.4, version: 1, events: 100, share: { contentType: { film: 1 } } } });
    expect(regional.records[0]!.item_id).toBe('b'); expect(regional.records[0]!.explain.regional!.contribution).toBe(0.4);
    expect(regional.records[0]!.explain.drivers).toContainEqual({ dim: 'regional', value: 'US-NY', a: 0.4, weight: 1 });
    const defaults = { ...input, arm: 'default' as const, pieces: pieces.slice(0, 3).map((p, index) => ({ ...p, type: index < 2 ? 'film' : 'editorial', tags: {} })),
      slots: [{ ...slots[0]!, take: 2, diversity: { dimension: 'contentType', max: 1 } }] };
    expect(decideContent(defaults).records.map(r => r.item_id)).toEqual(['a', 'b']);
    expect(decideContent(defaults).decisions).toEqual(decideContent(defaults, undefined, undefined, HISTORICAL_CONTENT_TYPES).decisions);
    expect(decideContent({ ...input, arm: 'no_learning' }).records[0]!.item_id).toBe('b');
    for (const change of [{ lifecycle: { status: 'draft' as const } }, { inStock: false }, { window: { to: new Date(now - 1).toISOString() } }, { slotTypes: ['elsewhere'] }]) {
      const guarded = { ...input, pieces: input.pieces.map(p => p.id === 'b' ? { ...p, ...change } : p) };
      expect(decideContent(guarded).records[0]!.item_id).toBe('c');
      expect(decideContent({ ...guarded, slots: [{ ...slots[0]!, pinnedPieceId: 'b' }] }).records).toEqual([]);
    }
    for (const arm of ['default', 'personalized'] as const) expect(decideContent({ ...input, arm, slots: [{ ...slots[0]!, pinnedPieceId: 'b' }] }).records[0]).toMatchObject({ item_id: 'b', authority: 'pin', explain: { score_base: 0 } });
    expect(JSON.stringify(catalog)).toBe(catalogBefore);
    expect(await (await env.STORAGE.get('config-publication/v1/coach/content/rev/2.json'))!.text()).toBe(bytes);
    expect((await configStore.readRevision(env, CONTENT_KIND, 'coach'))!.value.pieces[1]!.tags).toEqual({});
  });

  it('W28.01 serves retained Thompson documents as off on fresh and cached reads and replays both live and historical choices', async () => {
    const now = Date.now(), names = ['first', 'hero'];
    const learn: LearnConfig = { holdout: { share: 0, salt: '', arms: ['default'] }, stats: DEFAULT_STATS,
      slots: { first: { gamma: 0, reward: 'click', objective: 'unit' }, hero: { gamma: 0 } } };
    for (const share of [0, 1]) {
      const legacy: LearnConfig = { ...learn, slots: { ...learn.slots, first: { ...learn.slots!.first, exploration: { mode: 'thompson', share, floor: 50 } } } };
      const { env } = await envWith({ affinity: { dims: { line: { Drover: 0.9 } } } }, legacy, names, 'coach', true);
      const kv = env.CACHE as unknown as FakeKV, snapshots: Record<string, LiftSnapshot> = {}, objects = new Map<string, LearnStats>();
      const cell = { channel: 'direct', visit_bucket: 'unknown' as const, stage: 'mid' as const, region: null, affinity: 'line:Drover' };
      for (const slot of names) {
        const state = emptyStats();
        for (const item of ['a', 'b']) {
          for (let i = 0; i < 100; i++) recordExposure(state, item, cell, now, DEFAULT_STATS);
          for (let i = 0; i < (item === 'b' ? 90 : 1); i++) recordSuccess(state, item, cell, 'click', now, 1, DEFAULT_STATS);
        }
        const map = new Map<string, unknown>([['learn', { tenant: 'coach', brand: 'coach', slot, config: { reward: 'click', objective: 'unit', stats: DEFAULT_STATS }, stats: state }]]);
        const storage = { get: async (key: string) => structuredClone(map.get(key)), put: async (key: string, value: unknown) => { map.set(key, structuredClone(value)); },
          getAlarm: async () => null, setAlarm: async () => { /* Synthetic alarm scheduling has no wall-clock runner. */ } };
        const object = new LearnStats({ storage } as unknown as DurableObjectState, env); objects.set('coach:coach:' + slot, object);
        const response = await object.fetch(new Request('https://learn/publish', { method: 'POST', body: '{}' }));
        expect(response.status).toBe(200);
        snapshots[slot] = (await response.json() as { snapshot: LiftSnapshot }).snapshot;
      }
      env.LEARN_STATS = { idFromName: (name: string) => name, get: (name: string) => ({ fetch: (url: string, init?: RequestInit) => objects.get(name)!.fetch(new Request(url, init)) }) } as unknown as DurableObjectNamespace;
      const key = 'config-publication/v1/coach/learn/rev/1.json', raw = await (await env.STORAGE.get(key))!.text();
      invalidateCache(); invalidateLiftCache();
      const reads = vi.spyOn(env.STORAGE, 'get');
      for (const cached of [false, true]) {
        const beforeReads = reads.mock.calls.filter(([k]) => k === key).length;
        const result = await serve(env, Date.now()); await result.afterResponse;
        expect(result.records.map(r => r.item_id)).toEqual(['a', 'b']);
        expect(result.records.every(r => !r.explored && r.inputs!.replay!.exploration === 'supported-only')).toBe(true);
        expect(result.records[0]!.explain.lift).not.toBeNull();
        expect(reads.mock.calls.filter(([k]) => k === key).length - beforeReads).toBe(cached ? 0 : 1);
        expect(kv.reads).not.toContain('learn:config:coach:current');
        const target = result.records[1]!;
        expect(await replayDecision(env, JSON.parse(JSON.stringify(target)) as DecisionRecord)).toMatchObject({ ok: true, equal: true });
        const deps = replayDeps(env), catalog = await deps.doc(CONTENT_KIND, 'coach', 1), page = await deps.doc(SLOTS_KIND, 'coach', 1);
        expect(await deps.doc(LEARN_KIND, 'coach', 1)).toEqual(legacy);
        const old = decideContent({ tenant: target.tenant, brand: target.brand, page: target.page, visitorId: target.visitor_id,
          sessionId: target.session_id, identityAnchor: target.identity_anchor, nowMs: target.ts, requestId: target.request_id,
          pieces: catalog!.pieces, slots: page!.pages.home!, affinity: { dims: target.inputs!.affinity }, cell: target.cell,
          arm: target.arm, versions: target.versions, configLabel: target.config_label,
          learning: { snapshots, gammaOf: () => 0, exploreOf: slot => legacy.slots?.[slot]?.exploration ?? null } }, HISTORICAL_EXPLORATION);
        expect(old.records.map(r => r.item_id)).toEqual(['b', 'a']);
        for (const record of old.records) record.retention = structuredClone(target.retention);
        expect(old.records[0]!.explain.exploration!.mode).toBe('thompson');
        expect(await replayDecision(env, old.records[1]!)).toMatchObject({ ok: true, equal: true });
      }
      reads.mockRestore(); expect(await (await env.STORAGE.get(key))!.text()).toBe(raw);
    }
  });

  it('W27.02 replays the actual coupled service decision after complete queue and canonical ledger serialization', async () => {
    invalidateLiftCache();
    const now = Date.now(), config = { reward: 'click' as const, objective: 'unit' as const, stats: DEFAULT_STATS };
    const { env } = await envWith({ affinity: { dims: { line: { Drover: 0.9 } } } }, {
      holdout: { share: 0, salt: '', arms: ['default'] }, stats: DEFAULT_STATS,
      slots: { first: { reward: 'click', objective: 'unit', gamma: 1 }, hero: { reward: 'click', objective: 'unit', gamma: 0 } },
    }, ['first', 'hero']);
    const objects = new Map<string, LearnStats>(), versions = new Map<string, number>();
    const cell = { channel: 'direct', visit_bucket: 'unknown' as const, stage: 'mid' as const, region: null, affinity: 'line:Drover' };
    for (const slot of ['first', 'hero']) {
      const saved = new Map<string, unknown>(); let alarm: number | null = null;
      const storage = { get: async (key: string) => structuredClone(saved.get(key)),
        put: async (key: string, value: unknown) => { saved.set(key, structuredClone(value)); },
        getAlarm: async () => alarm, setAlarm: async (at: number) => { alarm = at; } };
      const stats = new LearnStats({ storage } as unknown as DurableObjectState, env); objects.set('coach:coach:' + slot, stats);
      const send = (path: string, body: unknown) => stats.fetch(new Request('https://learn' + path, { method: 'POST', body: JSON.stringify(body) }));
      const owner = { tenant: 'coach', brand: 'coach', slot, config };
      for (const item of ['a', 'b']) {
        expect((await send('/exposures', { ...owner, exposures: Array.from({ length: 100 }, () => ({ item, cell, ts: now })) })).status).toBe(200);
        expect((await send('/credits', { ...owner, credits: Array.from({ length: item === 'b' ? 90 : 1 }, () => ({ item, cell, ts: now, reward: 'click', weight: 1 })) })).status).toBe(200);
      }
      const published = await (await send('/publish', {})).json() as { ok: boolean; snapshot: LiftSnapshot };
      expect(published.ok).toBe(true); versions.set(slot, published.snapshot.version);
      expect(await replayDeps(env).archive('coach', 'coach', slot, published.snapshot.version)).toEqual(published.snapshot);
    }
    env.LEARN_STATS = { idFromName: (name: string) => name, get: (name: string) => ({ fetch: (url: string, init: RequestInit) => objects.get(name)!.fetch(new Request(url, init)) }) } as unknown as DurableObjectNamespace;
    env.DECISION_RING = fakeNs({ ok: true, ring: 2, receipt: { version: 1, kind: 'append', received: 2, accepted: 2, cutoffSkipped: 0, retained: 2, indexed: 2 } }, []);
    const wire: unknown[] = [];
    env.EVENT_QUEUE = { sendBatch: async (messages: Array<{ body: unknown }>) => { wire.push(...messages.map(m => JSON.parse(JSON.stringify(m.body)) as unknown)); } } as unknown as Queue;
    const served = await serve(env, now + 1); await served.afterResponse;
    expect(served.records.map(record => record.item_id)).toEqual(['b', 'a']);
    expect(served.records[0]!.explain.lift!.lift).toBeGreaterThan(1);
    expect(served.write).toBe(true);
    expect((await enqueueDecisions(env, served.records)).code).toBe('accepted');
    expect(wire.flatMap(expandLedgerMessage).map(message => message.record)).toEqual(served.records);
    const principal = await issueSessionCapability(env, { tenant: 'coach', subject: visitor, sessionId: 's1', kind: 'anonymous' }), owner = {};
    const captured = await runOwnerOperation(owner, env, async () => {
      admitOwnerPrincipal(owner, principal); return consumeLedger(env, wire, now + 2);
    }, undefined, undefined, async () => fixtureConsent.get(env)!);
    expect(captured).toMatchObject({ ok: true, written: 2 });
    const target = served.records[1]!, persisted = (await findById<DecisionRecord>(env.STORAGE, target.decision_id, 'decision'))!.record;
    expect(persisted).toEqual(target);
    expect(persisted.inputs!.replay).toEqual({ version: 1, exploration: 'supported-only', pins: 'prefix-reserved-v2', contentTypes: 'catalog-tags-v1', governance: 'slot-gates-v2', learning: true, candidateLimit: 10,
      slots: ['first', 'hero'].map(slot => ({ slot, lift: versions.get(slot), prior: 1 })) });
    const dependencies = replayDeps(env), calls: string[] = [];
    const replay = await replayDecision(env, persisted, { ...dependencies, archive: async (tenant, brand, slot, version) => {
      calls.push(slot); return dependencies.archive(tenant, brand, slot, version);
    } });
    expect(calls).toEqual(['first', 'hero']); expect(replay).toMatchObject({ ok: true, equal: true, diff: [] });
    expect(replay.replayed!.inputs!.replay).toEqual(persisted.inputs!.replay);
  });

  it('W27.01 keeps the live winner archived through publication failure and replays the acknowledged replacement', async () => {
    invalidateLiftCache();
    const now = Date.now(), config = { reward: 'click' as const, objective: 'unit' as const, stats: DEFAULT_STATS };
    const { env } = await envWith({ affinity: { dims: { line: { Drover: 0.9 } } } }, {
      holdout: { share: 0, salt: '', arms: ['default'] }, stats: DEFAULT_STATS, slots: { hero: { reward: 'click', objective: 'unit', gamma: 1 } },
    });
    const saved = new Map<string, unknown>(); let alarm: number | null = null;
    const storage = { get: async (key: string) => structuredClone(saved.get(key)),
      put: async (key: string, value: unknown) => { saved.set(key, structuredClone(value)); },
      getAlarm: async () => alarm, setAlarm: async (at: number) => { alarm = at; } };
    const stats = new LearnStats({ storage } as unknown as DurableObjectState, env);
    const send = (path: string, body: unknown = {}) => stats.fetch(new Request('https://learn' + path, { method: 'POST', body: JSON.stringify(body) }));
    env.LEARN_STATS = { idFromName: (name: string) => name, get: () => ({ fetch: (url: string, init: RequestInit) => stats.fetch(new Request(url, init)) }) } as unknown as DurableObjectNamespace;
    env.DECISION_RING = fakeNs({ ok: true, ring: 1, receipt: { version: 1, kind: 'append', received: 1, accepted: 1, cutoffSkipped: 0, retained: 1, indexed: 1 } }, []);
    const cell = { channel: 'direct', visit_bucket: 'unknown' as const, stage: 'mid' as const, region: null, affinity: 'line:Drover' };
    const add = async (item: string, successes: number) => {
      const owner = { tenant: 'coach', brand: 'coach', slot: 'hero', config };
      expect((await send('/exposures', { ...owner, exposures: Array.from({ length: 100 }, () => ({ item, cell, ts: now })) })).status).toBe(200);
      expect((await send('/credits', { ...owner, credits: Array.from({ length: successes }, () => ({ item, cell, ts: now, reward: 'click', weight: 1 })) })).status).toBe(200);
    };
    await add('a', 5);
    const first = await (await send('/publish')).json() as { ok: boolean; snapshot: LiftSnapshot };
    expect(first.ok).toBe(true);
    const oldArchiveKey = liftArchiveKey('coach', 'coach', 'hero', first.snapshot.version);
    const oldArchive = await (await env.STORAGE.get(oldArchiveKey))!.text();
    const before = await serve(env, now + 1); await before.afterResponse;
    expect(before.records).toHaveLength(1); expect(before.records[0]!.item_id).toBe('a');
    expect(before.records[0]!.versions.lift).toBe(first.snapshot.version);
    await add('b', 30);
    const archive = vi.spyOn(env.STORAGE, 'put').mockRejectedValueOnce(new Error('synthetic unavailable archive'));
    const failed = await send('/publish'); expect(failed.status).toBe(503);
    expect(await failed.json()).not.toHaveProperty('applied'); archive.mockRestore();
    invalidateLiftCache();
    const retained = await serve(env, now + 2); await retained.afterResponse;
    expect(retained.records[0]!.item_id).toBe('a'); expect(retained.records[0]!.versions.lift).toBe(first.snapshot.version);
    const next = await (await send('/publish')).json() as { ok: boolean; published: boolean; snapshot: LiftSnapshot };
    expect(next).toMatchObject({ ok: true, published: true }); expect(next.snapshot.version).not.toBe(first.snapshot.version);
    const dependencies = replayDeps(env);
    expect(await dependencies.archive('coach', 'coach', 'hero', next.snapshot.version)).toEqual(next.snapshot);
    expect(await (await env.STORAGE.get(oldArchiveKey))!.text()).toBe(oldArchive);
    invalidateLiftCache();
    const after = await serve(env, now + 3); await after.afterResponse;
    expect(after.records).toHaveLength(1); const record = after.records[0]!;
    expect(record.item_id).toBe('b'); expect(record.explain.lift!.lift).toBeGreaterThan(1);
    expect(record.versions.lift).toBe(next.snapshot.version);
    expect((await replayDecision(env, record, dependencies))).toMatchObject({ ok: true, equal: true, diff: [], used: { lift: next.snapshot.version } });
    expect((await replayDecision(env, before.records[0]!, dependencies))).toMatchObject({ ok: true, equal: true, diff: [], used: { lift: first.snapshot.version } });
  });

  it('W25.01 publishes validated CSV and JSON fine priors for a cold item and changes the actual live winner with raw provenance', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      for (const format of ['csv', 'json']) {
        invalidateLiftCache(); warn.mockClear();
        const now = Date.now(), config = { reward: 'click' as const, objective: 'unit' as const, stats: DEFAULT_STATS };
        const { env } = await envWith({ affinity: { dims: { line: { Drover: 0.9 } } } }, {
          holdout: { share: 0, salt: '', arms: ['default'] }, stats: DEFAULT_STATS, slots: { hero: { reward: 'click', objective: 'unit', gamma: 1 } },
        });
        const saved = new Map<string, unknown>(); let alarm: number | null = null;
        const storage = { get: async (key: string) => structuredClone(saved.get(key)),
          put: async (key: string, value: unknown) => { saved.set(key, structuredClone(value)); },
          getAlarm: async () => alarm, setAlarm: async (at: number) => { alarm = at; } };
        const stats = new LearnStats({ storage } as unknown as DurableObjectState, env);
        const send = (path: string, body?: unknown) => stats.fetch(new Request('https://learn' + path,
          body === undefined ? undefined : { method: 'POST', body: JSON.stringify(body) }));
        env.LEARN_STATS = { idFromName: (name: string) => name, get: () => ({ fetch: (url: string, init: RequestInit) => stats.fetch(new Request(url, init)) }) } as unknown as DurableObjectNamespace;
        env.DECISION_RING = fakeNs({ ok: true, ring: 1, receipt: { version: 1, kind: 'append', received: 1, accepted: 1, cutoffSkipped: 0, retained: 1, indexed: 1 } }, []);
        const cell = { channel: 'direct', visit_bucket: 'unknown' as const, stage: 'mid' as const, region: null, affinity: 'line:Drover' };
        const owner = { tenant: 'coach', brand: 'coach', slot: 'hero', config };
        expect((await send('/exposures', { ...owner, exposures: Array.from({ length: 100 }, () => ({ item: 'a', cell, ts: now })) })).status).toBe(200);
        expect((await send('/credits', { ...owner, credits: Array.from({ length: 5 }, () => ({ item: 'a', cell, ts: now, reward: 'click', weight: 1 })) })).status).toBe(200);
        expect((await send('/publish', {})).status).toBe(200);
        const before = await serve(env, now + 1); await before.afterResponse;
        expect(before.records).toHaveLength(1); expect(before.records[0]!.item_id).toBe('a');
        expect(before.records[0]!.explain.score_base).toBeGreaterThan(0);
        const key = levelKeys(before.records[0]!.cell)[5]!;
        const candidate = format === 'csv'
          ? parsePriorsCsv('slot,item,cell,p_prior,n_equiv\nhero,b,"' + key + '",0.1,200\n')
          : { rows: [{ slot: 'hero', item: 'b', cell: key, p_prior: 0.1, n_equiv: 200 }] };
        const valid = validatePriors(candidate); expect(valid.ok).toBe(true);
        if (!valid.ok) throw new Error('synthetic prior invalid');
        const imported = await write(env, PRIORS_KIND, 'coach', valid.value, { actor: 'synthetic' });
        expect(imported.ok).toBe(true); if (!imported.ok) throw new Error('synthetic prior write failed');
        const publication = await (await send('/publish', {})).json() as { ok: boolean; published: boolean; snapshot: LiftSnapshot };
        expect(publication).toMatchObject({ ok: true, published: true });
        const snap = publication.snapshot;
        expect(Object.keys(snap.items).sort()).toEqual(['a', 'b']); expect(Object.keys(snap.items.b!)).toEqual([key]);
        expect(snap.items.b![key]).toMatchObject({ n: 0, s: 0, n0: 200, prior: { p: 0.1, n: 200 } });
        expect(snap.items.b![key]!.p0).toBeGreaterThan(0); expect(snap.priorVersion).toBe(imported.revision.revision);
        expect((saved.get('learn') as { stats: StatsState }).stats.items).not.toHaveProperty('b');
        expect(JSON.parse((env.CACHE as unknown as FakeKV).store.get(liftKey('coach', 'coach', 'hero'))!)).toEqual(snap);
        invalidateLiftCache();
        const after = await serve(env, now + 2); await after.afterResponse;
        expect(after.records).toHaveLength(1);
        const record = after.records[0]!;
        expect(record.item_id).toBe('b'); expect(record.explain.score_base).toBeGreaterThan(0);
        expect(record.explain.score_final).toBeGreaterThan(record.explain.score_base);
        expect(record.explain.lift).toMatchObject({ level: 5, n: 0, s: 0, n0: 200, p_hat: 0.1, prior: { p: 0.1, n: 200 }, gamma: 1, lift: 2 });
        expect(record.versions).toMatchObject({ prior: imported.revision.revision, lift: snap.version });
        expect(warn).not.toHaveBeenCalled();
      }
    } finally { warn.mockRestore(); invalidateCache(); invalidateLiftCache(); }
  });

  it('W10.03 checks actual serving health on cold and cached snapshots and falls back after reset/restart', async () => {
    const now = Date.now(), { env } = await envWith({ affinity: { dims: { line: { Drover: 0.9 } } } }, {
      holdout: { share: 0, salt: '', arms: ['default'] }, stats: DEFAULT_STATS, slots: { hero: { gamma: 1, reward: 'click' } },
    });
    class Storage {
      map = new Map<string, unknown>(); alarm: number | null = null;
      async get(k: string) { return structuredClone(this.map.get(k)); }
      async put(k: string, v: unknown) { this.map.set(k, structuredClone(v)); }
      async delete(k: string) { this.map.delete(k); } async deleteAll() { this.map.clear(); }
      async getAlarm() { return this.alarm; } async setAlarm(n: number) { this.alarm = n; }
      async transaction<T>(fn: (s: Storage) => Promise<T>) { return fn(this); }
    }
    const storage = new Storage(), state = { storage } as unknown as DurableObjectState;
    let target = new LearnStats(state, env), health = 0, held = false;
    env.LEARN_STATS = { idFromName: (n: string) => n, get: () => ({ fetch: (url: string, init?: RequestInit) => {
      if (url.endsWith('/health')) {
        health++;
        if (held) return new Promise<Response>((_resolve, reject) => {
          const fail = () => reject(new DOMException('Synthetic transport aborted', 'AbortError'));
          if (init?.signal?.aborted) fail(); else init?.signal?.addEventListener('abort', fail, { once: true });
        });
      }
      return target.fetch(new Request(url, init));
    } }) } as unknown as DurableObjectNamespace;
    env.DECISION_RING = fakeNs({ ok: true, receipt: { version: 1, kind: 'append', received: 1, accepted: 1, cutoffSkipped: 0, retained: 1, indexed: 1 } }, []);
    const cell = { channel: 'direct', visit_bucket: 'unknown', region: null, affinity: null };
    const send = (path: string, body: unknown) => target.fetch(new Request('https://learn' + path, { method: 'POST', body: JSON.stringify(body) }));
    const base = { tenant: 'coach', brand: 'coach', slot: 'hero', config: { reward: 'click', objective: 'unit', stats: DEFAULT_STATS } };
    expect((await send('/exposures', { ...base, exposures: Array.from({ length: 200 }, (_, i) => ({ item: i % 2 ? 'a' : 'b', cell, ts: now })) })).status).toBe(200);
    expect((await send('/credits', { ...base, credits: Array.from({ length: 50 }, () => ({ item: 'b', cell, ts: now, reward: 'click', weight: 1 })) })).status).toBe(200);
    expect((await send('/publish', {})).status).toBe(200);
    invalidateLiftCache();
    const samples: number[] = [];
    for (let i = 0; i < 2; i++) { const start = performance.now(), out = await serve(env, now + 1, true); samples.push(performance.now() - start);
      expect(out.records[0]!.explain.lift).not.toBeNull(); await out.afterResponse; }
    expect(health).toBe(2);
    const cache = env.CACHE as unknown as FakeKV, key = liftKey('coach', 'coach', 'hero'), original = cache.store.get(key)!;
    for (const items of [null, {}, { b: { '*': { lift: 1000 } } }]) {
      cache.store.set(key, JSON.stringify({ ...JSON.parse(original), items })); invalidateLiftCache();
      const out = await serve(env, now + 1, true); expect(out.records[0]!.explain.lift).toBeNull(); await out.afterResponse;
    }
    cache.store.set(key, original); invalidateLiftCache(); held = true;
    const start = performance.now(), refused = await serve(env, now + 1, true); const heldMs = performance.now() - start;
    expect(refused.records[0]!.explain.lift).toBeNull(); expect(heldMs).toBeLessThan(400); held = false;
    vi.spyOn(env.STORAGE, 'put').mockRejectedValueOnce(new Error('Synthetic archive failure'));
    expect((await send('/reset-item', { item: 'b' })).status).toBe(503);
    const afterItemReset = await serve(env, now + 1, true); expect(afterItemReset.records[0]!.explain.lift).toBeNull();
    expect((await send('/reset', {})).status).toBe(200);
    target = new LearnStats(state, env);
    for (const cold of [false, true]) { if (cold) invalidateLiftCache(); const out = await serve(env, now + 1, true);
      expect(out.records[0]!.explain.lift).toBeNull(); await out.afterResponse; }
    expect(health).toBe(9); expect(samples.every(n => Number.isFinite(n) && n >= 0)).toBe(true);
    console.log('W10.03 actual serving health samples ' + JSON.stringify({ coldWarmMs: samples, heldOwnerTransportMs: heldMs, healthRequests: health, scope: 'synthetic-coach-hero' }));
  });

  it('W24.01 gates fresh and cached lift evidence and preserves explicit default-slot credits through the actual cascade', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    invalidateLiftCache();
    try {
      const now = Date.now(), base: LearnConfig = { holdout: { share: 0, salt: '', arms: ['default'] }, stats: DEFAULT_STATS,
        slots: { hero: { reward: 'click', objective: 'unit', gamma: 1 } } };
      const { env } = await envWith({ affinity: { dims: { line: { Drover: 0.9 } } } }, base);
      env.DECISION_RING = fakeNs({ ok: true, receipt: { version: 1, kind: 'append', received: 1, accepted: 1, cutoffSkipped: 0, retained: 1, indexed: 1 } }, []);
      env.LEARN_STATS = fakeNs({ ok: true, receipt: { version: 1, kind: 'exposures', received: 1, processed: 1, skipped: 0, alarm: 'scheduled' } }, []);
      const st = emptyStats(), cell = { channel: 'direct', visit_bucket: '1' as const, region: null, affinity: null };
      for (const item of ['a', 'b']) for (let i = 0; i < 100; i++) recordExposure(st, item, cell, now, DEFAULT_STATS);
      for (let i = 0; i < 50; i++) recordSuccess(st, 'b', cell, 'click', now, 1, DEFAULT_STATS);
      const snap = buildSnapshot(st, { tenant: 'coach', brand: 'coach', slot: 'hero' }, 'click', now, DEFAULT_STATS);
      snap.witness = 'a'.repeat(64);
      const statsWriter = env.LEARN_STATS;
      env.LEARN_STATS = { idFromName: (name: string) => name, get: (name: string) => ({ fetch: (url: string, init?: RequestInit) =>
        url.endsWith('/health') ? recoveryDigest(snap).then(digest => Response.json({ ok: true, state: 'healthy', tenant: 'coach', brand: 'coach', slot: 'hero', witness: snap.witness,
          publication: { witness: snap.witness, digest, version: snap.version } }))
          : statsWriter.get(statsWriter.idFromName(name)).fetch(url, init) }) } as unknown as DurableObjectNamespace;
      const cache = env.CACHE as unknown as FakeKV, key = liftKey('coach', 'coach', 'hero');
      cache.store.set(key, JSON.stringify(snap));
      const check = async (learned: boolean) => {
        const out = await serve(env, now + 1); await out.afterResponse;
        expect(out.records).toHaveLength(1);
        if (learned) { expect(out.records[0]!.item_id).toBe('b'); expect(out.records[0]!.explain.lift?.lift).toBeGreaterThan(1); }
        else expect(out.records[0]!.explain.lift).toBeNull();
        return out;
      };
      await check(true);
      const reads = cache.reads.filter(k => k === key).length;
      const changed: LearnConfig[] = [
        ...(['unit', 'revenue'] as const).map(objective => ({ ...base, slots: { hero: { ...base.slots!.hero!, reward: 'purchase' as const, objective } } })),
        ...Object.entries({ tauLearnMs: DEFAULT_STATS.tauLearnMs * 2, n0: 17, nMin: 31, liftMin: 0.25, liftMax: 3 })
          .map(([field, value]) => ({ ...base, stats: { ...DEFAULT_STATS, [field]: value } })),
      ];
      for (const config of changed) {
        expect((await write(env, LEARN_KIND, 'coach', config, { actor: 'test' })).ok).toBe(true);
        await check(false);
        expect((await write(env, LEARN_KIND, 'coach', base, { actor: 'test' })).ok).toBe(true);
        await check(true);
      }
      expect(cache.reads.filter(k => k === key)).toHaveLength(reads); // No per-request verdict poisoned the raw cache.
      for (const delta of [{ tenant: 'other' }, { brand: 'other' }, { slot: 'other' }, { reward: 'purchase' },
        { objective: 'margin' }, { objective: null }, { tauLearnMs: undefined }, { tauLearnMs: 1 }, { n0: 1 }, { nMin: 1 }, { liftMin: 0.1 }, { liftMax: 4 }]) {
        invalidateLiftCache(); cache.store.set(key, JSON.stringify({ ...snap, ...delta })); await check(false);
      }
      const legacy = { ...snap }; delete legacy.tauLearnMs;
      expect(liftFor(legacy, 'b', cell)!.lift).toBeGreaterThan(1); // Archived pure values remain readable.
      invalidateLiftCache(); cache.store.set(key, JSON.stringify(snap));
      expect((await write(env, LEARN_KIND, 'coach', { ...base, slots: { hero: { ...base.slots!.hero!, gamma: 0 } } }, { actor: 'test' })).ok).toBe(true);
      const shadow = await serve(env, now + 1); await shadow.afterResponse;
      expect(shadow.records[0]!.explain.lift?.gamma).toBe(0);

      // Real service -> route -> ring -> statistics, including a valid slot absent from learn.slots.
      for (const tau of [DEFAULT_STATS.tauLearnMs, DEFAULT_STATS.tauLearnMs * 2]) {
        invalidateLiftCache(); warn.mockClear();
        const cfg = { ...DEFAULT_STATS, tauLearnMs: tau }, f = await envWith({}, { holdout: base.holdout, stats: cfg });
        class Storage {
          map = new Map<string, unknown>(); alarm: number | null = null;
          async get(k: string) { return structuredClone(this.map.get(k)); }
          async put(k: string, v: unknown) { this.map.set(k, structuredClone(v)); }
          async getAlarm() { return this.alarm; } async setAlarm(at: number) { this.alarm = at; }
          async list(options: { prefix?: string; limit?: number } = {}) { return new Map([...this.map].filter(([key]) => key.startsWith(options.prefix ?? '')).slice(0, options.limit)); }
        }
        const saved = new Storage(), ringSaved = new Storage();
        const stats = new LearnStats({ storage: saved } as unknown as DurableObjectState, f.env);
        const ring = new DecisionRing({ storage: ringSaved } as unknown as DurableObjectState, f.env);
        const calls: Array<{ path: string; status: number }> = [];
        f.env.LEARN_STATS = { idFromName: (name: string) => name, get: () => ({ fetch: async (url: string, init: RequestInit) => {
          const response = await stats.fetch(new Request(url, init)); calls.push({ path: new URL(url).pathname, status: response.status }); return response;
        } }) } as unknown as DurableObjectNamespace;
        f.env.DECISION_RING = { idFromName: (name: string) => name, get: () => ({ fetch: (url: string, init: RequestInit) => ring.fetch(new Request(url, init)) }) } as unknown as DurableObjectNamespace;
        const served = await serve(f.env, now); await served.afterResponse;
        expect(served.records).toHaveLength(1); expect(served.arm).toBe('personalized');
        const event = outcomeFromAction({ type: 'content_click', userId: visitor, timestamp: now + 1, sessionId: 's1',
          data: { contentId: served.records[0]!.item_id, slot: 'hero' } }, 'coach')!;
        event.retention = captureRetention(f.env, 'coach', event.ts);
        await outcomeToLearning(f.env, 'coach', event);
        expect(calls).toEqual([{ path: '/exposures', status: 200 }, { path: '/credits', status: 200 }]);
        const stored = saved.map.get('learn') as { config: unknown; stats: StatsState };
        expect(stored.config).toEqual({ reward: 'click', objective: 'unit', stats: cfg });
        expect(stored.stats.events).toBe(1); expect(stored.stats.slot['*']!.s.click!.s).toBe(1);
        expect(stored.stats.items[served.records[0]!.item_id]!['*']!.s.click!.s).toBe(1);
        expect(warn).not.toHaveBeenCalled();
        for (const body of [ {}, { defaultSlotConfig: { reward: 'click', stats: cfg }, slotConfig: { hero: null } },
          { defaultSlotConfig: { reward: 'click', stats: cfg }, slotConfig: { hero: { reward: 'click', stats: cfg, objective: 'invalid' } } }]) {
          const response = await ring.fetch(new Request('https://ring/outcome', { method: 'POST', body: JSON.stringify({
            tenant: 'coach', brand: 'coach', outcome: event, policy: DEFAULT_POLICY, ...body }) }));
          expect(response.status).toBe(503); expect(calls).toHaveLength(2);
        }
        expect((await write(f.env, LEARN_KIND, 'coach', { holdout: base.holdout, stats: { ...cfg, tauLearnMs: tau * 3 } }, { actor: 'test' })).ok).toBe(true);
        await outcomeToLearning(f.env, 'coach', event);
        expect(calls.at(-1)).toEqual({ path: '/credits', status: 409 }); expect(saved.map.get('learn')).toEqual(stored);
        expect(warn.mock.calls.at(-1)).toEqual(['learning_incomplete', expect.objectContaining({ kind: 1, creditUnknown: 1 })]);
      }
    } finally { warn.mockRestore(); invalidateCache(); invalidateLiftCache(); }
  });

  it('W09.05 separates same-clock service requests without changing scoring and replays exact new and legacy identities', async () => {
    const { env } = await envWith({}), now = Date.now();
    const a = await serve(env, now), b = await serve(env, now); await Promise.all([a.afterResponse, b.afterResponse]);
    const first = a.records[0]!, second = b.records[0]!;
    expect(first.ts).toBe(second.ts); expect(first.request_id).toBeTruthy();
    expect(first.decision_id).not.toBe(second.decision_id);
    const decisionFields = (set: typeof a) => set.decisions.map((decision, index) => {
      expect(decision.decisionId).toBe(set.records[index]!.decision_id);
      const fields = { ...decision }; delete fields.decisionId; return fields;
    });
    expect(decisionFields(a)).toEqual(decisionFields(b));
    expect(compareRecords(first, second).map(d => d.field)).toEqual(['decision_id', 'request_id']);
    expect(parseId(first.decision_id)).toMatchObject({ tenant: 'coach', ts: now });
    const replay = await replayDecision(env, first); expect(replay).toMatchObject({ ok: true, equal: true });
    expect(replay.replayed!.decision_id).toBe(first.decision_id);
    const legacy = { ...first }; delete legacy.request_id;
    legacy.decision_id = `${legacy.tenant}:${legacy.ts.toString(36)}:${legacy.visitor_id}:${legacy.page}:${legacy.slot}:${legacy.position}`;
    expect(await replayDecision(env, legacy)).toMatchObject({ ok: true, equal: true });
    for (const record of [{ ...first, request_id: '' }, { ...first, request_id: 'abc\n' },
      { ...first, request_id: undefined }, { ...first, decision_id: legacy.decision_id },
      { ...legacy, decision_id: first.decision_id }]) {
      expect(await replayDecision(env, record)).toMatchObject({ ok: false, equal: false });
    }
    const input = { tenant: 'coach', brand: 'coach', page: 'old:n1:page', visitorId: visitor, sessionId: 's1', identityAnchor: first.identity_anchor,
      nowMs: now, pieces: [{ ...piece('a'), slotTypes: ['old:n1:slot'], lifecycle: { status: 'live' as const } }], slots: [{ slot: 'old:n1:slot', take: 1, weights: {} }],
      affinity: null, cell: first.cell, arm: first.arm, versions: first.versions, configLabel: first.config_label };
    const pure = decideContent({ ...input, requestId: 'stable' });
    expect(pure.records).toHaveLength(1); expect(pure.records[0]).toMatchObject({ request_id: 'stable' });
    expect(pure).toEqual(decideContent({ ...input, requestId: 'stable' }));
    expect(() => decideContent({ ...input, requestId: 'bad\n' })).toThrow('Invalid decision identity');
    // Legacy delimiters inside a known page/slot are not classified as a nonce suffix.
    const ambiguous = { ...legacy, page: input.page, slot: input.slots[0]!.slot };
    ambiguous.decision_id = `${ambiguous.tenant}:${now.toString(36)}:${visitor}:${ambiguous.page}:${ambiguous.slot}:0`;
    expect((await replayDecision(env, ambiguous)).reason).not.toMatch(/identity/);
    const refused = await envWith({ consent: { tracking: false, personalization: true } });
    const uuid = vi.spyOn(crypto, 'randomUUID');
    try {
      const out = await serve(refused.env, now); await out.afterResponse;
      expect(out.write).toBe(false); expect(out.records[0]).not.toHaveProperty('request_id');
      expect(uuid).not.toHaveBeenCalled(); expect(refused.ring).toEqual([]);
    } finally { uuid.mockRestore(); }
  });

  it('W04.02 owned state honors a prior false hint without restoring legacy profile mirrors', async () => {
    const { env, ring } = await envWith({});
    Object.assign(env, { JWT_SECRET: 'w0402-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a' });
    const principal = await newAnonymousSession(env, 'coach');
    const out = await serveContentDecisions(env, { tenant: 'coach', stateTenant: 'coach', page: 'home', visitorId: principal.subject, sessionId: principal.sessionId,
      principal, capability: principal.capability, cookieHeader: 'opt_segments=PRIVATE; opt_session_id=victim; opt_tracking_consent=false' });
    await out.afterResponse;
    expect(out.arm).toBe('default'); expect(out.write).toBe(false); expect(ring).toEqual([]);
    expect(out.sources.consent.tracking).toBe(false);
  });

  it('a consenting shopper is personalized, recorded, and fed to the ring', async () => {
    const { env, ring } = await envWith({});
    const out = await serve(env);
    await out.afterResponse;
    expect(out.arm).toBe('personalized');
    expect(out.write).toBe(true);
    expect(out.sources.consent).toEqual({ ...fixtureConsent.get(env), personalized: true });
    expect(out.records).toHaveLength(1);
    expect(out.sources.external).toBeNull();
    expect(out.records[0]!.explain.external).toBeUndefined();
    expect(out.records[0]!.inputs?.external).toBeUndefined();
    expect(out.records[0]!.explain.note ?? '').not.toContain('shopper');
    expect(ring).toEqual([`coach:${visitor} POST /append`]);
  });

  it('tracking withheld: the defaults, no ring, no ledger, and the receipt says why', async () => {
    const { env, ring } = await envWith({ consent: { tracking: false, personalization: true } });
    const out = await serve(env);
    await out.afterResponse;
    expect(out.arm).toBe('default');
    expect(out.write).toBe(false);
    expect(out.sources.consent).toEqual({ ...fixtureConsent.get(env), personalized: false });
    expect(out.records[0]!.arm).toBe('default');
    expect(out.records[0]!.explain.note).toContain('tracking is off by the shopper');
    expect(ring).toEqual([]);
  });

  it('personalization withheld with tracking on: the defaults, still recorded', async () => {
    const { env, ring } = await envWith({ consent: { tracking: true, personalization: false } });
    const out = await serve(env);
    await out.afterResponse;
    expect(out.arm).toBe('default');
    expect(out.write).toBe(true);
    expect(out.records[0]!.explain.note).toContain('personalization is off by the shopper');
    expect(ring).toEqual([`coach:${visitor} POST /append`]);
  });

  it('W06.05 checks erasure in the background and suppresses unavailable or pre-cutoff fan-out without blocking the decision response', async () => {
    const { env, ring } = await envWith({});
    const catalog = env.STORAGE;
    let release!: (value: null) => void;
    const pending = new Promise<null>(resolve => { release = resolve; });
    env.STORAGE = { ...catalog, get: (key: string) => key === tombstoneKey('coach', visitor) ? pending : catalog.get(key) } as never;
    const out = await serve(env);
    expect(out.records).toHaveLength(1); expect(ring).toEqual([]);
    release(null); await out.afterResponse;
    expect(ring).toEqual([`coach:${visitor} POST /append`]);
    for (const mode of ['refused-by-cutoff', 'unavailable', 'corrupt']) {
      ring.length = 0;
      env.STORAGE = { ...catalog, get: async (key: string) => {
        if (key !== tombstoneKey('coach', visitor)) return catalog.get(key);
        if (mode === 'unavailable') throw new Error('synthetic erasure storage failure');
        return { text: async () => mode === 'corrupt' ? 'null' : JSON.stringify({ tenant: 'coach', visitor_id: visitor,
          erased_at: Date.now() + 60_000, actor: 'ops', rows_removed: 0, objects_rewritten: 0, objects_deleted: 0 }) };
      } } as never;
      const result = await serve(env); await result.afterResponse;
      expect(result.records).toHaveLength(1); expect(ring).toEqual([]);
    }
  });

  it('W09.04 current callers consume incomplete learning receipts while the actual owner drains pending effects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { env } = await envWith({});
      let release!: () => void, started!: () => void;
      const held = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { started = resolve; });
      const ring = vi.fn(async () => { started(); await held; return new Response('private upstream body', { status: 503 }); });
      env.DECISION_RING = { idFromName: (name: string) => name, get: () => ({ fetch: ring }) } as unknown as DurableObjectNamespace;
      const statsCalls: string[] = [];
      env.LEARN_STATS = fakeNs({ ok: true, receipt: { version: 1, kind: 'exposures', received: 1, processed: 1, skipped: 0, alarm: 'scheduled' } }, statsCalls);
      let returned = false;
      const pending = serve(env).then(result => { returned = true; return result; });
      await entered;
      expect(returned).toBe(false); expect(warn).not.toHaveBeenCalled();
      release(); const out = await pending; await out.afterResponse; expect(out.records).toHaveLength(1);
      expect(ring).toHaveBeenCalledTimes(1); expect(statsCalls).toHaveLength(1); expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]).toEqual(['learning_incomplete', expect.objectContaining({ kind: 0, ringUnknown: 1, exposureProcessed: 1 })]);
      const event = outcomeFromAction({ type: 'content_click', userId: visitor, timestamp: out.records[0]!.ts + 1,
        sessionId: 's1', data: { contentId: out.records[0]!.item_id, slot: 'hero' } }, 'coach')!;
      event.retention = structuredClone(out.records[0]!.retention);
      warn.mockClear();
      await outcomeToLearning(env, 'coach', event);
      expect(ring).toHaveBeenCalledTimes(2); expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]).toEqual(['learning_incomplete', expect.objectContaining({ kind: 1, ringUnknown: 1, creditPlanKnown: 0 })]);
      const numeric = warn.mock.calls[0]![1] as Record<string, unknown>;
      expect(Object.values(numeric).every(value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)).toBe(true);
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(/private|vis-|coach|cms-|content_click/);

      invalidateCache(); warn.mockClear();
      env.CACHE = { get: async () => { throw new Error('private configuration'); } } as unknown as KVNamespace;
      await outcomeToLearning(env, 'coach', event);
      // Legacy config reads deliberately fall back; this task does not make them strict reads.
      expect(ring).toHaveBeenCalledTimes(3); expect(warn).toHaveBeenCalledTimes(2);
      expect(warn.mock.calls[0]).toEqual(['[config] read failed, serving fallback']);
      expect(warn.mock.calls[1]).toEqual(['learning_incomplete', expect.objectContaining({ kind: 1, ringUnknown: 1 })]);
      // A propagated preparation failure is distinct: inject it at the existing dependency seam.
      const failedConfig = vi.spyOn(configStore, 'readRevision').mockRejectedValueOnce(new Error('private preparation'));
      try {
        warn.mockClear(); await outcomeToLearning(env, 'coach', event);
        expect(ring).toHaveBeenCalledTimes(3); expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]).toEqual(['learning_incomplete', expect.objectContaining({ kind: 1, code: 3, ringNotAttempted: 1, creditPlanKnown: 0 })]);
        failedConfig.mockRejectedValueOnce(new Error('private preparation'));
        warn.mockImplementation(() => { throw new Error('private logger'); });
        await expect(outcomeToLearning(env, 'coach', event)).resolves.toBeUndefined();
      } finally { failedConfig.mockRestore(); }

      warn.mockImplementation(() => undefined); warn.mockClear();
      const withheld = await envWith({ consent: { tracking: false, personalization: true } });
      await (await serve(withheld.env)).afterResponse;
      expect(withheld.ring).toEqual([]); expect(warn).not.toHaveBeenCalled();
      const success = await envWith({});
      success.env.DECISION_RING = fakeNs({ ok: true, ring: 1, receipt: { version: 1, kind: 'append', received: 1, accepted: 1, cutoffSkipped: 0, retained: 1, indexed: 1 } }, success.ring);
      success.env.LEARN_STATS = fakeNs({ ok: true, receipt: { version: 1, kind: 'exposures', received: 1, processed: 1, skipped: 0, alarm: 'scheduled' } }, []);
      await (await serve(success.env)).afterResponse;
      expect(success.ring).toHaveLength(1); expect(warn).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });
});

describe('W05.04 strict owned envelopes and state-free unsigned default probe', () => {
  it('rejects failed or missing/malformed owned consent envelopes before fanout', async () => {
    for (const reply of [null, {}, { ok: false }, { ok: true }, { ok: true, consent: null }, { ok: true, consent: {} }, { ok: true, consent: { tracking: 'false', personalization: true } }, 'http-error']) {
      const { env, ring } = await envWith({});
      env.SHOPPER_REFLEX = reply === 'http-error'
        ? { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json({ ok: true, consent: { tracking: true, personalization: true } }, { status: 503 }) }) } as never
        : fakeNs(reply, []);
      await expect(serve(env)).rejects.toBeInstanceOf(SessionAccessError);
      expect(ring).toEqual([]);
    }
  });

  it('permits only explicit both-false unsigned defaults, with no shopper or measurement I/O', async () => {
    for (const host of ['session', 'do']) {
      const { env, ring } = await envWith({ affinity: { dims: { line: { PRIVATE: 1 } } } });
      env.REFLEX_HOST = host as Env['REFLEX_HOST'];
      const touched = vi.fn(() => { throw new Error('synthetic must not touch shopper state'); });
      Object.defineProperties(env, { SESSIONS: { get: touched }, SHOPPER_REFLEX: { get: touched } });
      const request = { tenant: 'coach', stateTenant: 'coach', page: 'home', visitorId: 'monitor-synthetic', sessionId: 'monitor-synthetic',
        cookieHeader: null, cf: { country: 'US', regionCode: 'NY' }, channel: 'private-channel' };
      for (const hints of [{ cookieHeader: 'opt_tracking_consent=false; opt_personalization_enabled=false' }, { consent: { tracking: false, personalization: false } }]) {
        const out = await serveContentDecisions(env, { ...request, ...hints }); await out.afterResponse;
        expect(out.sources.state).toBe('none'); expect(out.write).toBe(false); expect(out.arm).toBe('default');
        expect(out.records).toHaveLength(1); expect(out.records[0]!.item_id).toBe('a');
        expect(out.cell).toEqual({ channel: 'unknown', visit_bucket: 'unknown', region: null, affinity: null, stage: 'unknown' });
        expect(out.records[0]!.explain.note).toContain('tracking and personalization are off');
      }
      for (const consent of [undefined, { tracking: false }, { personalization: false }, { tracking: true, personalization: true }]) {
        await expect(serveContentDecisions(env, { ...request, consent })).rejects.toBeInstanceOf(SessionAccessError);
      }
      expect(touched).not.toHaveBeenCalled(); expect(ring).toEqual([]);
      expect((env.CACHE as unknown as FakeKV).reads.some(key => key.startsWith('lift:'))).toBe(false);
    }
  });
});

describe('W34.01 deployment-off external scoring on the actual service', () => {
  const reason = 'external scoring disabled by deployment policy';
  const snapshot = { affinity: { dims: { line: { Drover: 0.9 } } } };
  const configurations: NonNullable<LearnConfig['external']>[] = [
    { kind: 'service', ref: 'https://synthetic.invalid/score', timeoutMs: 50, fallback: 'omit' },
    { kind: 'service', ref: 'MODEL', timeoutMs: 50, fallback: 'omit' },
    { kind: 'workers_ai', ref: 'synthetic-model', timeoutMs: 50, fallback: 'omit' },
    { kind: 'table', ref: 'synthetic-table', timeoutMs: 50, fallback: 'omit' },
  ];

  beforeEach(() => { invalidateCache(); invalidateLiftCache(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it.each(configurations)('withdraws $kind / $ref despite a valid positive-weight stored document', async (external) => {
    const { env, ring, shopper } = await envWith(snapshot, {
      holdout: { share: 0, salt: '', arms: ['default'] },
      external, slots: { hero: { external: { weight: 0.5 } } },
    });
    // All adapters would succeed and favour b if the live service invoked one.
    const answer = { version: 'synthetic-v1', scores: { b: 1 } };
    const fetchCall = vi.fn(async () => Response.json(answer));
    const bindingCall = vi.fn(async () => Response.json(answer));
    const aiCall = vi.fn(async () => answer);
    const bindingRead = vi.fn(() => ({ fetch: bindingCall }));
    const aiRead = vi.fn(() => ({ run: aiCall }));
    vi.stubGlobal('fetch', fetchCall);
    Object.defineProperties(env, { MODEL: { get: bindingRead }, AI: { get: aiRead } });
    const kv = env.CACHE as unknown as FakeKV;
    kv.store.set('ext:coach:coach', JSON.stringify(answer));

    const out = await serve(env);
    await out.afterResponse;
    const rec = out.records[0]!;
    expect(out.sources.learn.revision).toBe(1);
    expect(out.arm).toBe('personalized');
    expect(rec.item_id).toBe('a');
    expect(rec.explain.score_final).toBeCloseTo(0.45, 3);
    expect(out.sources.external).toEqual({ kind: external.kind, ref: external.ref, ok: false, ms: 0, version: null, reason });
    expect(rec.explain.external).toEqual({ kind: external.kind, ref: external.ref, status: 'unavailable', reason });
    expect(rec.inputs?.external).toBeUndefined();
    expect(rec.explain.drivers.some((driver) => driver.dim === 'external')).toBe(false);
    expect(kv.reads.filter((key) => key.startsWith('ext:'))).toEqual([]);
    for (const call of [fetchCall, bindingCall, aiCall, bindingRead, aiRead]) expect(call).not.toHaveBeenCalled();
    expect(shopper).toEqual([`${visitor} GET /snapshot`]);
    expect(ring).toEqual([`coach:${visitor} POST /append`]);

    if (external.kind === 'table') {
      const replay = await replayDecision(env, rec);
      expect(replay).toMatchObject({ ok: true, equal: true, diff: [] });
      expect(replay.replayed?.explain.external).toEqual(rec.explain.external);
      expect(kv.reads.filter((key) => key.startsWith('ext:'))).toEqual([]);
    }
  });

  it.each(['zero weight', 'default arm'])('keeps an inactive term absent: %s', async (mode) => {
    const { env } = await envWith(snapshot, {
      holdout: { share: mode === 'default arm' ? 1 : 0, salt: '', arms: ['default'] },
      external: configurations[0], slots: { hero: { external: { weight: mode === 'zero weight' ? 0 : 0.5 } } },
    });
    const fetchCall = vi.fn(async () => Response.json({ version: 'unused', scores: { b: 1 } }));
    vi.stubGlobal('fetch', fetchCall);
    const out = await serve(env);
    await out.afterResponse;
    expect(out.arm).toBe(mode === 'default arm' ? 'default' : 'personalized');
    expect(out.records[0]!.item_id).toBe('a');
    expect(out.sources.external).toBeNull();
    expect(out.records[0]!.explain.external).toBeUndefined();
    expect(out.records[0]!.inputs?.external).toBeUndefined();
    expect(fetchCall).not.toHaveBeenCalled();
  });
});
