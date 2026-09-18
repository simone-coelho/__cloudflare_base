// src/ledger/ledger.test.ts
// Phase 0: records go out after the response, land in R2 as range-named
// batches under the brand and hour, and come back by id with no index.

import { describe, it, expect, vi } from 'vitest';
import { enqueueDecisions as enqueueDecisionsActual, enqueueOutcome as enqueueOutcomeActual, pointsForDecisions, pointForOutcome, LEDGER_BODY_BYTES, LEDGER_BATCH_BYTES, LEDGER_BATCH_MESSAGES, type LedgerDeliveryReceipt } from './enqueue';
import { consumeLedger as consumeLedgerActual } from './consume';
import { candidateKeys, expandLedgerMessage, findById, isLedgerMessage, persistDeliveries, writeBatches, type R2Like } from './writer';
import * as ledgerWriter from './writer';
import { hourPrefix, isProductSortRecord, outcomeFromAction as outcomeActual, parseId, rewardOf, ts36, type OutcomeRecord, type ProductSortRecord } from './records';
import { decideContent as decideActual } from '@/content/decide';
import type { ContentPiece, DecisionRecord, SlotStrategy } from '@/content/types';
import { loadTombstones, pendingPrefix, rewriteErasures, tombstoneKey, writeTombstone } from './erasure';
import { scheduleProductSort } from './productSort';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import { decisionRoutes } from '@/routes/decisions';
import { tenantMiddleware, tenantConfig } from '@/tenancy/middleware';
import type { Env } from '@/types/env';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { loadHourRecords } from '@/learn/hourly';
import { countDayObjects, loadDay } from '@/learn/report';
import { DecisionRing } from '@/durable-objects/DecisionRing';
import { initializePublicationSet, pinPublication, invalidatePublicationCache } from '@/config/publication';
import { CONTENT_KIND, DEFAULT_LEARN, LEARN_KIND, SLOTS_KIND, validateContentCatalog, validateSlotCatalog } from '@/content/kinds';
import { invalidateCache, readRevision, readVersion } from '@/config/versionedStore';
import { liftArchiveKey } from '@/learn/fan';
import { buildSnapshot, DEFAULT_STATS, emptyStats, recordExposure } from '@/learn/stats';
import { memoryStore, type SubjectAuditDetail, type OperationAuditDetail } from '@/auth/store';
import { receiptOf } from '@/learn/receipts';
import { createHash } from 'node:crypto';
import { Miniflare } from 'miniflare';
import { DELIVERY_FIELD, MANAGED_BYTES, MANAGED_MARKER, managedKey, readDelivery, type CaptureReceipt } from './delivery';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { captureRetention, type RetentionEnv } from '@/retention';
import { replayDecision, type ReplayDeps } from '@/learn/replay';
import { captureQuarantine, loadQuarantine, operateQuarantine, eraseQuarantineSubject, expireQuarantine, quarantinePrefix } from './quarantine';
import { recoveryDigest } from './recovery';

const fixtureBirth = Date.now() - 1000;
const ledgerFixturePolicy = { TENANTS: JSON.stringify({ provisioned: ['coach', 'meridian', 'harbor'] }), RETENTION: JSON.stringify({ version: 1,
  tenants: Object.fromEntries(['coach', 'meridian', 'harbor'].map(tenant => [tenant, Object.fromEntries(['ledger', 'online', 'hourly'].map(category => [category,
    { id: 'synthetic-' + category, revision: 1, durationMs: 365 * 86400_000, basis: 'admitted', renewal: 'new-record-only' }]))])) }) } as RetentionEnv;
const stamped = (tenant: string, at: number) => captureRetention(ledgerFixturePolicy, tenant, at, fixtureBirth);
const decideContent = (...args: Parameters<typeof decideActual>) => { const result = decideActual(...args); result.records = result.records.map(row => ({ ...row, retention: stamped(row.tenant, row.ts) })); return result; };
const outcomeFromAction = (...args: Parameters<typeof outcomeActual>) => { const row = outcomeActual(...args); return row ? { ...row, retention: stamped(row.tenant, row.ts) } : null; };

/** Existing writer/producer units now explicitly select a synthetic policy and
 * the real owner class. This is not the separate native owner/R2 acceptance. */
const ledgerEnvironments = new WeakMap<object, Env>();
function ledgerFixtureEnvironment<T extends object>(input: T): T & Env {
  const known = ledgerEnvironments.get(input); if (known) return known as T & Env;
  const env = Object.create(input) as T & Env;
  if (!('TENANTS' in input)) Object.defineProperty(env, 'TENANTS', { value: ledgerFixturePolicy.TENANTS });
  if (!('RETENTION' in input)) Object.defineProperty(env, 'RETENTION', { configurable: true, get: () => {
    const policies = JSON.parse(ledgerFixturePolicy.RETENTION!).tenants;
    return JSON.stringify({ version: 1, tenants: Object.fromEntries(tenantConfig(env).provisioned.map(tenant => [tenant, policies[tenant] ?? {}])) });
  } });
  if (!('SHOPPER_REFLEX' in input)) {
    const objects = new Map<string, ShopperReflex>();
    Object.defineProperty(env, 'SHOPPER_REFLEX', { value: { idFromName: (name: string) => name, get: (name: string) => ({ fetch: async (url: RequestInfo | URL, init?: RequestInit) => {
      let object = objects.get(name);
      if (!object) {
        const data = new Map<string, unknown>(); let alarm: number | null = null;
        const state = { id: name, storage: { get: async (key: string | string[]) => structuredClone(Array.isArray(key) ? new Map(key.map(k => [k, data.get(k)])) : data.get(key)),
          put: async (key: string | Record<string, unknown>, value?: unknown) => { if (typeof key === 'string') data.set(key, structuredClone(value)); else for (const [k, v] of Object.entries(key)) data.set(k, structuredClone(v)); },
          list: async () => structuredClone(data), getAlarm: async () => alarm, setAlarm: async (at: number) => { alarm = at; } }, getWebSockets: () => [], waitUntil() {} } as unknown as DurableObjectState;
        object = new ShopperReflex(state, env); objects.set(name, object);
      }
      return object.fetch(new Request(url, init));
    } }) } });
  }
  ledgerEnvironments.set(input, env); return env;
}
const consumeLedger = (env: Parameters<typeof consumeLedgerActual>[0], ...args: Tail<Parameters<typeof consumeLedgerActual>>) => consumeLedgerActual(ledgerFixtureEnvironment(env), ...args);
type Tail<T extends unknown[]> = T extends [unknown, ...infer Rest] ? Rest : never;
const enqueueDecisions = (env: Parameters<typeof enqueueDecisionsActual>[0], ...args: Tail<Parameters<typeof enqueueDecisionsActual>>) => enqueueDecisionsActual(ledgerFixtureEnvironment(env), ...args);
const enqueueOutcome = (env: Parameters<typeof enqueueOutcomeActual>[0], ...args: Tail<Parameters<typeof enqueueOutcomeActual>>) => enqueueOutcomeActual(ledgerFixtureEnvironment(env), ...args);

class FakeR2 {
  store = new Map<string, string>(); puts = 0;
  async put(key: string, body: string, options?: R2PutOptions): Promise<unknown> {
    const old = this.store.get(key), condition = options?.onlyIf as R2Conditional | undefined;
    if (condition?.etagDoesNotMatch === '*' && old !== undefined || condition?.etagMatches !== undefined && (old === undefined || createHash('md5').update(old).digest('hex') !== condition.etagMatches)) return null;
    this.puts++; this.store.set(key, body); return { etag: createHash('md5').update(body).digest('hex') };
  }
  async get(key: string): Promise<{ text(): Promise<string>; etag?: string; size?: number; body?: ReadableStream<Uint8Array> } | null> {
    const b = this.store.get(key); return b === undefined ? null : { text: async () => b, etag: createHash('md5').update(b).digest('hex') };
  }
  async delete(key: string) { this.store.delete(key); }
  async list(opts: { prefix: string }) { return { objects: [...this.store.keys()].filter((k) => k.startsWith(opts.prefix)).sort().map((key) => ({ key })), truncated: false }; }
}
class ManagedR2 extends FakeR2 {
  metadata = new Map<string, Record<string, string>>();
  etag(body: string) { return createHash('md5').update(body).digest('hex'); }
  async put(key: string, body: string, options?: R2PutOptions) {
    const current = this.store.get(key), condition = options?.onlyIf as R2Conditional | undefined;
    if (condition?.etagDoesNotMatch === '*' && current !== undefined) return null;
    if (condition?.etagMatches !== undefined && (current === undefined || this.etag(current) !== condition.etagMatches)) return null;
    await super.put(key, body); this.metadata.set(key, { ...options?.customMetadata });
    return { etag: this.etag(body) };
  }
  async get(key: string) {
    const body = this.store.get(key);
    return body === undefined ? null : { text: async () => body, size: new TextEncoder().encode(body).length,
      etag: this.etag(body), customMetadata: this.metadata.get(key) };
  }
  dataKeys() { return [...this.store.keys()].filter(managedKey); }
  rows() { return this.dataKeys().flatMap(key => this.store.get(key)!.split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)); }
}

describe('W09.09 durable quarantine preserves original proof and physical privacy', () => {
  const fixture = () => {
    class Cases extends ManagedR2 {
      async put(key: string, body: string, options?: R2PutOptions) { const result = await super.put(key, body, options); return result && { ...result, key, size: new TextEncoder().encode(body).length }; }
    }
    const r2 = new Cases(), policies = JSON.parse(ledgerFixturePolicy.RETENTION!);
    for (const tenant of Object.keys(policies.tenants)) for (const category of ['recovery', 'quarantine']) policies.tenants[tenant][category] = {
      id: 'synthetic-' + category, revision: 1, durationMs: 60_000, basis: 'admitted', renewal: 'new-record-only' };
    const env = ledgerFixtureEnvironment({ STORAGE: r2, TENANTS: ledgerFixturePolicy.TENANTS, RETENTION: JSON.stringify(policies),
      IDENTITY_SALT: 'w0909-synthetic-provenance-material-only', LEDGER_RECOVERY_ENABLED: 'true',
      LEDGER_RECOVERY_CONFIG: JSON.stringify({ version: 1, sourceQueue: 'source', deadLetterQueue: 'dlq',
        unknown: { id: 'synthetic-explicit-disposal', revision: 1, durationMs: 60_000, basis: 'admitted', renewal: 'new-record-only', disposal: 'delete-on-expiry' } }) } as unknown as Env);
    return { r2, env };
  };
  it.each(['tampered', 'unreadable'].flatMap(fault => ['expiry', 'erasure'].map(mode => ({ fault, mode }))))('W09.09 rework quarantine isolates $fault cases during $mode with retry discovery', async ({ fault, mode }) => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      clock.mockReturnValue(T0);
      const { r2, env } = fixture(), bad = await captureQuarantine(env, 'dlq', 'bad-' + mode, { unassigned: 'held' });
      const good = await captureQuarantine(env, 'dlq', 'good-' + mode, managedOutcome('erase-independent'));
      const badKey = quarantinePrefix + bad.id + '.json', goodKey = quarantinePrefix + good.id + '.json', original = r2.store.get(badKey)!;
      // Two bounded pages exercise wrap/restart. The isolated bad page may not
      // prevent the following valid page or silently become a complete erase.
      const keys = [badKey, goodKey];
      vi.spyOn(r2, 'list').mockImplementation(async (options: { prefix: string; cursor?: string; startAfter?: string }) => {
        const start = options.cursor ? Number(options.cursor) : options.startAfter ? keys.indexOf(options.startAfter) + 1 : 0;
        return { objects: keys.slice(start, start + 1).map(key => ({ key })), truncated: start === 0, ...(start === 0 ? { cursor: '1' } : {}) };
      });
      const get = r2.get.bind(r2); let unavailable = true;
      if (fault === 'tampered') { const value = JSON.parse(original); value.provenance = '0'.repeat(64); r2.store.set(badKey, JSON.stringify(value)); }
      else vi.spyOn(r2, 'get').mockImplementation(async key => { if (key === badKey && unavailable) throw new Error('isolated key outage'); return get(key); });
      if (mode === 'expiry') {
        clock.mockReturnValue(T0 + 60_000);
        const first = await expireQuarantine(env, null);
        expect(first).toMatchObject({ removed: 0, unresolved: 1, next: bad.id });
        const next = await expireQuarantine(env, null, first.next!);
        expect(next).toMatchObject({ removed: 1, unresolved: 0, next: null });
        expect((await loadQuarantine(env, good.id))!.value.wire).toBeUndefined();
        expect((await expireQuarantine(env, null)).unresolved).toBe(1);
      } else {
        await writeTombstone(r2, 'coach', 'erase-independent', 'synthetic-owner', T0);
        expect(await eraseQuarantineSubject(env, 'coach', 'erase-independent', T0)).toBe(false);
        expect(await eraseQuarantineSubject(env, 'coach', 'erase-independent', T0)).toBe(false);
        expect((await loadQuarantine(env, good.id))!.value).toMatchObject({ state: 'suppressed_erased' });
        expect((await loadQuarantine(env, good.id))!.value.wire).toBeUndefined();
        // A fresh invocation retries the earlier unresolved case, not a false
        // terminal journal left by the otherwise successful second page.
        expect(await eraseQuarantineSubject(env, 'coach', 'erase-independent', T0)).toBe(false);
      }
      expect(r2.store.has(badKey)).toBe(true); unavailable = false; r2.store.set(badKey, original);
      if (mode === 'erasure') {
        let complete = false; for (let i = 0; i < 4 && !complete; i++) complete = await eraseQuarantineSubject(env, 'coach', 'erase-independent', T0);
        expect(complete).toBe(true);
      } else expect((await expireQuarantine(env, null)).removed).toBe(1);
    } finally { clock.mockRestore(); }
  });
  it('ACKs only durable exact wire, reconciles committed-response-lost, binds ownership/source and refuses unsafe legacy replay', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      const { r2, env } = fixture(), body = managedOutcome('case-owner'), wire = JSON.stringify(body), put = r2.put.bind(r2);
      vi.spyOn(r2, 'put').mockImplementationOnce(async (...args) => { await put(...args); throw new Error('lost capture reply'); });
      const captured = await captureQuarantine(env, 'dlq', 'one', body);
      expect(captured.wire).toBe(wire); expect(captured.tenant).toBeNull(); expect(captured.safety).toBe('managed');
      expect((await captureQuarantine(env, 'dlq', 'one', body)).admittedAt).toBe(captured.admittedAt);
      await expect(captureQuarantine(env, 'dlq', 'one', { ...body, record: { ...body.record, value: 91 } })).rejects.toThrow();
      const key = quarantinePrefix + captured.id + '.json', raw = r2.store.get(key)!;
      const malformed = JSON.parse(raw); malformed.source.message = 'other'; r2.store.set(key, JSON.stringify(malformed));
      await expect(loadQuarantine(env, captured.id)).rejects.toThrow('provenance'); r2.store.set(key, raw);
      const result = await operateQuarantine(env, captured.id, { digest: captured.digest, revision: 1 }, 'redrive', undefined, async tenant => { expect(tenant).toBeNull(); });
      expect(result.state).toBe('recovered'); expect(result.effects).toMatchObject({ total: 1, newlyStored: 1, unknown: 0 });
      expect(r2.rows()).toHaveLength(1);
      await expect(operateQuarantine(env, captured.id, { digest: captured.digest, revision: result.revision }, 'resolve', 'irrecoverable', async () => {})).rejects.toThrow();
      const legacy = { kind: 'ledger', type: 'outcome', record: body.record }, history = await captureQuarantine(env, 'dlq', 'legacy', legacy);
      await expect(operateQuarantine(env, history.id, { digest: history.digest, revision: 1 }, 'redrive', undefined, async () => {})).rejects.toThrow('Safe redrive');
      const unresolved = await operateQuarantine(env, history.id, { digest: history.digest, revision: 1 }, 'resolve', 'irrecoverable', async () => {});
      expect(unresolved.terminalLoss).toBeNull(); expect((await loadQuarantine(env, history.id))!.value.wire).toBe(JSON.stringify(legacy));
    } finally { clock.mockRestore(); }
  });
  it('replays authenticated mixed-owner survivors with original ordinals and never repopulates completed erasure through managed or recognizable legacy arrivals', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      const { r2, env } = fixture(), a = set('erased').records[0]!, b = set('survives').records[0]!;
      const body = { kind: 'ledger', type: 'decisions', version: 1, delivery_id: crypto.randomUUID(), records: [a, b] };
      await writeTombstone(r2, 'coach', 'erased', 'synthetic-owner', T0);
      expect(await eraseQuarantineSubject(env, 'coach', 'erased', T0)).toBe(true);
      const captured = await captureQuarantine(env, 'dlq', 'mixed', body);
      expect(captured.wire).toBeUndefined(); expect(captured.survivors!.rows.map(row => row.ordinal)).toEqual([1]);
      expect(JSON.stringify(captured.survivors)).not.toContain(a.decision_id);
      const key = quarantinePrefix + captured.id + '.json', good = r2.store.get(key)!, forged = JSON.parse(good);
      forged.survivors.rows[0].ordinal = 0; r2.store.set(key, JSON.stringify(forged));
      await expect(loadQuarantine(env, captured.id)).rejects.toThrow(); r2.store.set(key, good);
      const out = await operateQuarantine(env, captured.id, { digest: captured.digest, revision: 1 }, 'redrive', undefined, async () => {});
      expect(out.state).toBe('recovered'); expect(captureConserved(out.effects!)).toMatchObject({ total: 2, newlyStored: 1, suppressed: 1 });
      expect(r2.rows().map(row => row[DELIVERY_FIELD])).toEqual([{ id: body.delivery_id, ordinal: 1 }]);
      const late = await captureQuarantine(env, 'dlq', 'late-legacy', { kind: 'ledger', type: 'decision', record: a });
      expect(late.state).toBe('suppressed_erased'); expect(late.wire).toBeUndefined(); expect(late.legacyRows).toBeUndefined();
      const conflict = { ...body, records: [a] }; r2.store.set('ledger-delivery/identities/' + conflict.delivery_id + '.json', '{}');
      const removed = await captureQuarantine(env, 'dlq', 'all-erased-conflict', conflict);
      expect(removed.state).toBe('suppressed_erased'); expect(removed.wire).toBeUndefined();
    } finally { clock.mockRestore(); }
  });
  it('fails closed without unknown policy and purges expired retained payloads without reporting loss as recovery', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      const { r2, env } = fixture(), body = { unknown: ['opaque', 1] }, config = env.LEDGER_RECOVERY_CONFIG!;
      env.LEDGER_RECOVERY_CONFIG = JSON.stringify({ version: 1, sourceQueue: 'source', deadLetterQueue: 'dlq' });
      await expect(captureQuarantine(env, 'dlq', 'no-policy', body)).rejects.toThrow(); expect(r2.puts).toBe(0);
      env.LEDGER_RECOVERY_CONFIG = config;
      const captured = await captureQuarantine(env, 'dlq', 'unknown', body);
      clock.mockReturnValue(captured.expiresAt); await expireQuarantine(env, null);
      const expired = (await loadQuarantine(env, captured.id))!.value;
      expect(expired.state).toBe('expired_unrecovered'); expect(expired.terminalLoss).toBeNull(); expect(expired.wire).toBeUndefined();
      expect(expired.digest).toBe(await recoveryDigest(JSON.stringify(body)));
    } finally { clock.mockRestore(); }
  });
  it('keeps survivor repair proof through temporary claim outage, rejects malformed owner replies and caps recognizable legacy by its original deadline', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(T0);
    try {
      const { r2, env } = fixture(), a = set('later-erased').records[0]!, b = set('later-survivor').records[0]!;
      const body = { kind: 'ledger', type: 'decisions', version: 1, delivery_id: crypto.randomUUID(), records: [a, b] };
      const captured = await captureQuarantine(env, 'dlq', 'proof-outage', body);
      expect((await ledgerWriter.prepareDeliveryClaims(r2, [readDelivery(body)])).ready).toEqual([true]);
      await writeTombstone(r2, 'coach', a.visitor_id, 'synthetic-owner', T0);
      const get = r2.get.bind(r2), fault = vi.spyOn(r2, 'get').mockImplementation(async key => {
        if (key.startsWith('ledger-delivery/')) throw new Error('synthetic claim outage'); return get(key);
      });
      expect(await eraseQuarantineSubject(env, 'coach', a.visitor_id, T0)).toBe(true); fault.mockRestore();
      const partial = (await loadQuarantine(env, captured.id))!.value;
      expect(partial.wire).toBeUndefined(); expect(partial.survivors!.rows.map(row => row.ordinal)).toEqual([1]);
      expect(partial.survivors!.claims).toEqual({}); expect(partial.survivors!.identityDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(partial)).not.toContain(a.decision_id);
      const malformed = Object.create(env) as Env;
      Object.defineProperty(malformed, 'SHOPPER_REFLEX', { value: { idFromName: (name: string) => name,
        get: () => ({ fetch: async () => Response.json({ ok: true }) }) } });
      await expect(operateQuarantine(malformed, captured.id, { digest: captured.digest, revision: partial.revision }, 'redrive', undefined, async () => {})).rejects.toThrow('receipt');
      expect((await loadQuarantine(env, captured.id))!.value).toEqual(partial);
      const repaired = await operateQuarantine(env, captured.id, { digest: captured.digest, revision: partial.revision }, 'redrive', undefined, async () => {});
      expect(repaired.state).toBe('recovered'); expect(captureConserved(repaired.effects!)).toMatchObject({ total: 2, newlyStored: 1, suppressed: 1 });
      expect(r2.rows()[0]![DELIVERY_FIELD]).toEqual({ id: body.delivery_id, ordinal: 1 });
      const policies = JSON.parse(env.RETENTION!); policies.tenants.coach.ledger.durationMs = 500; env.RETENTION = JSON.stringify(policies);
      const legacy = outcomeFromAction({ type: 'purchase', userId: 'legacy-short', timestamp: T0 }, 'coach')!;
      legacy.retention = captureRetention(env, 'coach', T0, T0);
      const retained = await captureQuarantine(env, 'dlq', 'legacy-short', { kind: 'ledger', type: 'outcome', record: legacy });
      expect(retained.expiresAt).toBe(T0 + 500); clock.mockReturnValue(T0 + 500);
      await expireQuarantine(env, null); expect((await loadQuarantine(env, retained.id))!.value.wire).toBeUndefined();
    } finally { clock.mockRestore(); }
  });
});
const managedOutcome = (visitor: string, at = T0, tenant = 'coach') => ({ kind: 'ledger' as const, type: 'outcome' as const,
  version: 1 as const, delivery_id: crypto.randomUUID(), record: outcomeFromAction({ type: 'purchase', userId: visitor, timestamp: at }, tenant)! });
function captureConserved(capture: CaptureReceipt) {
  expect(capture.newlyStored + capture.alreadyPresent + capture.suppressed + capture.unknown + capture.notAttempted).toBe(capture.total);
  return capture;
}

describe('W03.07 canonical queue tenant admission', () => {
  it('pre-admits every managed/legacy constituent before storage and preserves sibling dispositions and removed work', async () => {
    const record = (tenant: string) => ({ ...set('same-visitor').records[0]!, tenant, retention:stamped(tenant,T0),
      decision_id: set('same-visitor').records[0]!.decision_id.replace(/^coach:/, tenant + ':') });
    const r2 = new ManagedR2(), get = vi.spyOn(r2, 'get'), list = vi.spyOn(r2, 'list');
    const rejected = [false, true].map(managed => ({ kind: 'ledger', type: 'decisions', records: [record('meridian'), record('harbor')],
      ...(managed ? { version: 1, delivery_id: crypto.randomUUID() } : {}) }));
    const env = { STORAGE: r2 as never, DEPLOYMENT_PROFILE: 'customer' as const, TENANTS: JSON.stringify({ provisioned: ['meridian'] }) };
    expect(await consumeLedger(env, rejected)).toMatchObject({ written: 0, dispositions: ['retry', 'retry'] });
    expect(get).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled(); expect(r2.puts).toBe(0);
    const sibling = managedOutcome('safe-sibling', T0, 'meridian');
    expect(await consumeLedger(env, [rejected[0], sibling, rejected[1]])).toMatchObject({ dispositions: ['retry', 'ack', 'retry'], written: 1 });
    expect(r2.rows().map(row => row.tenant)).toEqual(['meridian']);
    const storage = vi.fn(() => { throw new Error('Registry must precede binding'); });
    for (const TENANTS of [undefined, '', 'bad', JSON.stringify({ provisioned: [] })]) {
      expect(await consumeLedger({ DEPLOYMENT_PROFILE: 'customer', TENANTS, get STORAGE() { return storage(); } }, rejected))
        .toMatchObject({ dispositions: ['retry', 'retry'], written: 0 });
    }
    expect(storage).not.toHaveBeenCalled();
    env.TENANTS = JSON.stringify({ provisioned: ['meridian', 'harbor'] });
    expect(await consumeLedger(env, rejected)).toMatchObject({ dispositions: ['ack', 'ack'], written: 4 });
    expect(r2.rows().map(row => row.tenant)).toEqual(expect.arrayContaining(['meridian', 'harbor']));
  });
});
class FakeQueue { sent: unknown[] = []; async send(b: unknown) { this.sent.push(b); } async sendBatch(ms: Array<{ body: unknown }>) { for (const m of ms) this.sent.push(m.body); } }
class FakeAE { points: unknown[] = []; writeDataPoint(p: unknown) { this.points.push(p); } }

const T0 = Date.UTC(2026, 10, 27, 14, 5, 0);   // 2026-11-27 14:05 UTC
const piece = (id: string, tags: Record<string, string[]>, slots: string[]): ContentPiece =>
  ({ id, customerContentId: `cms-${id}`, type: 'editorial', title: id, tags, slotTypes: slots, lifecycle: { status: 'live' } });
const slots: SlotStrategy[] = [{ slot: 'hero', take: 1, weights: { line: 0.3 } }, { slot: 'story', take: 2, weights: { line: 0.3 } }];
const set = (visitorId: string, nowMs = T0) => decideContent({
  tenant: 'coach', brand: 'coach', page: 'home', visitorId, sessionId: 's', identityAnchor: 'visitor', nowMs,
  pieces: [piece('a', { line: ['Drover'] }, ['hero', 'story']), piece('b', { line: ['Tabby'] }, ['story']), piece('c', {}, ['story'])],
  slots, affinity: { dims: { line: { Drover: 0.7 } } }, cell: { channel: 'direct', visit_bucket: '1', region: 'US-NY', affinity: 'line:Drover' },
  arm: 'personalized', versions: { config: 1, lift: 0, prior: 0, policy: 0 }, configLabel: 'v1',
});

/** Actual operator routes, catalog publication and DecisionRing; only bindings and credentials are synthetic. */
async function operatorHistoryFixture() {
  invalidatePublicationCache();
  const objects = new Map<string, string>(), etags = new Map<string, string>();
  let version = 0;
  const storage = {
    get: vi.fn(async (key: string) => {
      const raw = objects.get(key);
      return raw === undefined ? null : { etag: etags.get(key), size: new TextEncoder().encode(raw).length,
        body: new Response(raw).body, text: async () => raw, json: async () => JSON.parse(raw) as unknown };
    }),
    put: vi.fn(async (key: string, raw: string, options?: R2PutOptions) => {
      const condition = options?.onlyIf;
      if (condition instanceof Headers ? objects.has(key) : condition && condition.etagMatches !== etags.get(key)) return null;
      objects.set(key, raw); etags.set(key, `history-${++version}`);
      return { key, etag: etags.get(key), size: new TextEncoder().encode(raw).length };
    }),
    delete: vi.fn(async (key: string) => { objects.delete(key); etags.delete(key); }),
    list: vi.fn(async (options: { prefix: string }) => ({ objects: [...objects.keys()].filter(key => key.startsWith(options.prefix)).map(key => ({ key })), truncated: false })),
  };
  const rings = new Map<string, { object: DecisionRing; data: Map<string, unknown> }>();
  const fetch = vi.fn(async (name: string, input: RequestInfo | URL, init?: RequestInit) => {
    const ring = rings.get(name);
    if (!ring) throw new Error('synthetic missing object');
    return ring.object.fetch(new Request(input, init));
  });
  const names = vi.fn((name: string) => name);
  const accounts = memoryStore();
  const env = ledgerFixtureEnvironment({ AUTH_MODE: 'enforced', JWT_SECRET: 'w0611-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
    IDENTITY_SALT: 'w0304-synthetic-identity-audit-material', ACCOUNTS: accounts,
    STORAGE: storage, DECISION_RING: { idFromName: names, get: (name: string) => ({ fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(name, input, init) }) },
    TENANTS: JSON.stringify({ provisioned: ['meridian', 'harbor'], operatorGrants: { 'history-meridian': ['meridian'], 'history-harbor': ['harbor'] } }),
  } as unknown as Env);
  const tokens = new Map<string, string>();
  for (const tenant of ['meridian', 'harbor']) {
    tokens.set(tenant, await new SignJWT({ type: 'service', roles: ['admin'] }).setProtectedHeader({ alg: 'HS256' }).setSubject(`history-${tenant}`)
      .setIssuer('i').setAudience('a').setExpirationTime('5m').sign(new TextEncoder().encode(env.JWT_SECRET)));
    await initializePublicationSet(env, [
      { kind: CONTENT_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'synthetic-history', note: '', value: { pieces: [piece('a', {}, ['hero']), piece('b', {}, ['hero'])].map(p => ({ ...p, title: `${tenant}-${p.id}` })) } } },
      { kind: SLOTS_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'synthetic-history', note: '', value: { pages: { home: [{ slot: 'hero', take: 1, weights: {} }] } } } },
      { kind: LEARN_KIND, scope: tenant, revision: { revision: 1, at: 1, actor: 'synthetic-history', note: '', value: DEFAULT_LEARN } },
    ], `0:${crypto.randomUUID()}`);
  }
  const writes = vi.fn();
  const seed = (tenant: string, visitor: string, rows: DecisionRecord[], indexRows = rows) => {
    const data = new Map<string, unknown>([['ring', structuredClone({ ring: rows, index: indexRows.map(row => ({ id: row.decision_id, ts: row.ts, retention: row.retention?.online })) })]]);
    const state = { storage: { get: async (key: string) => structuredClone(data.get(key)),
      put: async (key: string, value: unknown) => { writes(); data.set(key, structuredClone(value)); },
      getAlarm: async () => null, setAlarm: async () => {},
      deleteAll: async () => { writes(); data.clear(); } } } as unknown as DurableObjectState;
    rings.set(`${tenant}:${visitor}`, { object: new DecisionRing(state, env), data });
  };
  const row = (tenant: string, visitor: string, at: number, position = 0): DecisionRecord => ({ ...set(visitor, at).records[0]!, retention: stamped(tenant, at),
    tenant, brand: tenant, decision_id: `${tenant}:${ts36(at)}:${visitor}:history:${position}`, position, item_id: position ? 'b' : 'a' });
  const app = new Hono().use('*', tenantMiddleware()).route('/v1', decisionRoutes);
  const request = (tenant: string, suffix: string, token = tokens.get(tenant), method = 'GET', body?: string, headers: Record<string,string> = {}) =>
    app.request(`/v1/${tenant}/${suffix}`, { method, headers: { 'X-Tenant': tenant, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, ...(body === undefined ? {} : { body }) }, env);
  const get = (tenant: string, visitor: string, suffix: string, token = tokens.get(tenant), selected = tenant) =>
    app.request(`/v1/${tenant}/visitors/${encodeURIComponent(visitor)}/${suffix}`, { headers: {
      'X-Tenant': selected, ...(token ? { Authorization: `Bearer ${token}` } : {}),
    } }, env);
  const snapshot = () => JSON.stringify({ objects: [...objects], rings: [...rings].map(([key, ring]) => [key, [...ring.data]]) });
  storage.get.mockClear(); storage.put.mockClear(); storage.list.mockClear();
  return { env, storage, objects, rings, fetch, names, writes, seed, row, get, tokens, snapshot, request, accounts };
}

it('W27.01 requires acknowledged operator publication and preserves one durable reset intent until its continuation is acknowledged', async () => {
  const f = await operatorHistoryFixture(), values = new Map<string, string>(); invalidateCache();
  const put = vi.fn(async (key: string, body: string) => { values.set(key, body); });
  f.env.CACHE = { get: async (key: string) => { const body = values.get(key); return body === undefined ? null : JSON.parse(body) as unknown; }, put } as unknown as KVNamespace;
  const downstream = vi.fn(async (): Promise<Response> => Response.json({ ok: true }));
  f.env.LEARN_STATS = { idFromName: (name: string) => name, get: () => ({ fetch: downstream }) } as unknown as DurableObjectNamespace;
  const body = { slot: 'hero', item: 'A' }, before = f.snapshot();
  const failures = [() => { throw new Error('PRIVATE transport'); }, () => new Response('{'),
    () => Response.json(null), () => Response.json({ ok: false, error: 'PRIVATE downstream' }),
    () => Response.json({ ok: true }), () => Response.json({ ok: true, published: false, snapshot: null, item: 'A', had: true }, { status: 503 }),
    () => Response.json({ ok: true, published: true, snapshot: { tenant: 'harbor', brand: 'meridian', slot: 'hero', version: 1 }, item: 'wrong', had: true })];
  const publish = () => f.request('meridian','learn/publish',undefined,'POST',JSON.stringify(body));
  expect((await f.request('meridian', 'learn/publish', f.tokens.get('harbor'), 'POST', JSON.stringify(body))).status).toBe(403);
  expect(downstream).not.toHaveBeenCalled();
  for(const failure of failures){
    downstream.mockImplementationOnce(async()=>failure()); const response=await publish();
    expect(response.status).toBe(503);expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ok:false,error:'statistics acknowledgement unavailable'});
    expect(f.snapshot()).toBe(before);expect(put).not.toHaveBeenCalled();
  }
  downstream.mockResolvedValueOnce(Response.json({ok:true,published:false,snapshot:null}));
  expect(await (await publish()).json()).toEqual({ok:true,tenant:'meridian',brand:'meridian',slot:'hero',published:false,snapshot:null});
  const state=emptyStats();recordExposure(state,'A',{channel:'direct',visit_bucket:'1',region:null,affinity:null},Date.now(),DEFAULT_STATS);
  const snapshot=buildSnapshot(state,{tenant:'meridian',brand:'meridian',slot:'hero'},'click',Date.now(),DEFAULT_STATS);
  downstream.mockResolvedValueOnce(Response.json({ok:true,published:true,snapshot}));
  expect(await(await publish()).json()).toMatchObject({ok:true,published:true,snapshot});expect(put).not.toHaveBeenCalled();
  // W11 supersedes reset-after-ACK: retain an exactly retryable intent before
  // downstream work, while never calling ambiguous continuation a success.
  const id='history-meridian',sid='human-reset';
  await f.accounts.put({id,email:'synthetic-reset@example.invalid',name:'Synthetic',roles:['admin'],permissions:[],disabled:false,must_change_password:false});
  await f.accounts.putSession({jti:sid,accountId:id,tokenHash:'synthetic-session-only',createdAt:Date.now(),expiresAt:Date.now()+300000});
  const human=await new SignJWT({type:'access',sid,roles:['admin']}).setProtectedHeader({alg:'HS256'}).setSubject(id).setIssuer('i').setAudience('a').setExpirationTime('5m').sign(new TextEncoder().encode(f.env.JWT_SECRET));
  const pin=await pinPublication(f.env,'meridian'),operationId='1:'+crypto.randomUUID(),headers={'If-Match':'"1/'+pin.revision+'/'+pin.digest+'"','Idempotency-Key':operationId};
  downstream.mockClear();
  expect((await f.request('meridian','learn/items/reset',undefined,'POST',JSON.stringify(body),headers)).status).toBe(403);
  expect(downstream).not.toHaveBeenCalled();expect(f.snapshot()).toBe(before);
  const reset=()=>f.request('meridian','learn/items/reset',human,'POST',JSON.stringify(body),headers);
  let retained:string|undefined;
  for(const failure of failures){
    downstream.mockImplementationOnce(async()=>failure());const response=await reset();
    expect(response.status).toBe(503);const answer=await response.json();
    expect(answer).toMatchObject({ok:false,resetOutcome:'unknown',revision:2,operationId});expect(JSON.stringify(answer)).not.toContain('PRIVATE');
    expect(await readRevision(f.env,LEARN_KIND,'meridian')).toMatchObject({revision:2,actor:id,note:'item reset admitted'});
    retained??=f.snapshot();expect(f.snapshot()).toBe(retained);
  }
  downstream.mockResolvedValueOnce(Response.json({ok:true,item:'A',had:true,publicationOutcome:'current'}));
  const response=await reset();expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ok:true,had:true,resetCompleted:true,publicationOutcome:'current',revision:2});
  expect(f.snapshot()).toBe(retained);expect(put).not.toHaveBeenCalled();
});

it('W03.05 audits ledger erasure and bounded rewrite without equating partial receipts or ambiguous writes with completion', async () => {
  const f = await operatorHistoryFixture(), visitor = 'vis-erase-audit'; f.env.LEDGER_RETENTION_DAYS = '1';
  const post = (suffix: string, body: unknown = {}) => f.request('meridian', suffix, undefined, 'POST', typeof body === 'string' ? body : JSON.stringify(body));
  const detail = () => JSON.parse(f.accounts.log.at(-1)!.detail!) as OperationAuditDetail;
  const real = f.accounts.auditOperations.bind(f.accounts), write = vi.spyOn(f.accounts, 'auditOperations');
  const before = f.snapshot(); write.mockRejectedValueOnce(new Error('PRIVATE_ADMISSION'));
  const denied = await post('ledger/erasures', { visitorId: visitor }); expect(denied.status).toBe(503);
  expect(f.snapshot()).toBe(before); expect(f.storage.get).not.toHaveBeenCalled(); expect(f.storage.put).not.toHaveBeenCalled();
  f.fetch.mockResolvedValue(Response.json({ ok: true }));
  const ringFailed = await post('ledger/erasures', { visitorId: visitor });
  expect(ringFailed.status).toBe(200); expect(await ringFailed.json()).toMatchObject({ ok: false, ring: 'failed' });
  expect(detail().result).toMatchObject({ outcome: 'ledger_erase', ok: false, ring: 'failed', complete: false });
  const ns = f.env.DECISION_RING; f.env.DECISION_RING = undefined as never;
  expect((await post('ledger/erasures', { visitorId: 'vis-unbound' })).status).toBe(200);
  expect(detail().result).toMatchObject({ ok: true, ring: 'unbound', complete: false }); f.env.DECISION_RING = ns;
  const today = await post('ledger/erasures/rewrite'); expect(today.status).toBe(200);
  expect(detail().result).toMatchObject({ outcome: 'ledger_rewrite', more: true, remaining: 2, complete: false });
  const at = Date.now() - 86_400_000, subject = 'vis-old-audit';
  for (const i of [0, 1]) await writeBatches(f.storage, [{ kind: 'ledger', type: 'decision', record: f.row('meridian', subject, at - i - 1, i) }], 'audit-rewrite-' + i);
  await writeTombstone(f.storage, 'meridian', subject, 'synthetic', at);
  const partial = await post('ledger/erasures/rewrite', { maxObjects: 1 }); expect(partial.status).toBe(200);
  expect(detail().result).toMatchObject({ outcome: 'ledger_rewrite', more: true, objects_opened: 1, complete: false });
  const saved = f.snapshot(), count = f.accounts.log.length;
  for (const bad of ['{', 'null', '[]', '{"maxObjects":0}', '{"maxObjects":1.5}', '{"maxObjects":"1"}', '{"extra":true}']) {
    expect((await post('ledger/erasures/rewrite', bad)).status).toBe(400);
  }
  for (const bad of [{ visitorId: 7 }, { visitorId: 'bad/value' }, { visitorId: visitor, extra: true }]) expect((await post('ledger/erasures', bad)).status).toBe(400);
  expect(f.accounts.log).toHaveLength(count); expect(f.snapshot()).toBe(saved);
  write.mockImplementation(async rows => { if (JSON.parse(rows[0]!.detail!).phase === 'result') throw new Error('PRIVATE_RESULT'); await real(rows); });
  const ambiguous = await post('ledger/erasures', { visitorId: 'vis-post-effect' });
  expect(ambiguous.status).toBe(503); expect(await ambiguous.json()).toMatchObject({ outcome: 'outcome_unknown', operationMayHaveApplied: true, auditStatus: 'unconfirmed', requestId: expect.any(String) });
  expect(f.objects.has(tombstoneKey('meridian', 'vis-post-effect'))).toBe(true); expect(detail().phase).toBe('admitted');
  write.mockImplementation(real); f.storage.get.mockRejectedValueOnce(new Error('PRIVATE_CALLBACK'));
  const unknown = await post('ledger/erasures', { visitorId: 'vis-throw' }); expect(unknown.status).toBe(503);
  expect(detail().result).toEqual({ outcome: 'outcome_unknown', operationMayHaveApplied: true }); expect(await unknown.text()).not.toContain('PRIVATE');
});

it('W27.03 enforces exact retained dependency identity through authenticated audited replay without customer-store writes', async () => {
  const f = await operatorHistoryFixture(), tenant = 'meridian', at = Date.now() - 1000;
  const values = new Map<string, string>();
  const kv = { get: vi.fn(async (key: string, mode: string) => {
    expect(mode).toBe('stream'); return values.has(key) ? new Response(values.get(key)!).body : null;
  }),
    put: vi.fn(async (key: string, value: string) => { values.set(key, value); }) };
  f.env.CACHE = kv as unknown as KVNamespace; invalidateCache();
  const page = [{ slot: 'hero', take: 1, weights: {} }];
  expect(await readVersion(f.env, SLOTS_KIND, tenant, 1)).toMatchObject({revision:1,value:{pages:{home:page}}});
  expect(await readVersion(f.env, LEARN_KIND, tenant, 1)).toMatchObject({revision:1,value:DEFAULT_LEARN});
  const catalog = (await readVersion(f.env, CONTENT_KIND, tenant, 1))!.value;
  const state = emptyStats(), cell = { channel: 'direct', visit_bucket: '1' as const, region: null, affinity: null };
  for (let n = 0; n < 100; n++) recordExposure(state, 'a', cell, at, DEFAULT_STATS);
  const snapshot = buildSnapshot(state, { tenant, brand: tenant, slot: 'hero' }, 'click', at, DEFAULT_STATS);
  const archiveKey = liftArchiveKey(tenant, tenant, 'hero', snapshot.version);
  await f.storage.put(archiveKey, JSON.stringify(snapshot));
  const record = decideContent({ tenant, brand: tenant, page: 'home', visitorId: 'replay-subject', sessionId: 's', identityAnchor: 'visitor', nowMs: at,
    pieces: catalog.pieces, slots: page, affinity: null, cell, arm: 'personalized',
    versions: { config: 0, catalog: 1, slots: 1, learn: 1, lift: 0, prior: 0, policy: 1 }, configLabel: 'synthetic',
    learning: { snapshots: { hero: snapshot }, gammaOf: () => 0 } }).records[0]!;
  expect(record).toMatchObject({ item_id: 'a', versions: { lift: at }, explain: { lift: { n: 100 } } });
  await writeBatches(f.storage, [{ kind: 'ledger', type: 'decision', record }], 'w2703');
  const rowKey = [...f.objects.keys()].find(key => key.endsWith('.ndjson'))!, rowBody = f.objects.get(rowKey)!;
  const baseline = new Map(f.objects), kvBaseline = new Map(values);
  kv.put.mockClear(); f.storage.put.mockClear(); f.storage.delete.mockClear();
  const detail = () => JSON.parse(f.accounts.log.at(-1)!.detail!) as SubjectAuditDetail;
  const get = kv.get.getMockImplementation()!, r2get = f.storage.get.getMockImplementation()!, list = f.storage.list.getMockImplementation()!;
  const beforeRead = () => expect(detail().phase).toBe('admitted');
  kv.get.mockImplementation((key, mode) => { beforeRead(); return get(key, mode); });
  f.storage.get.mockImplementation(key => { beforeRead(); return r2get(key); });
  f.storage.list.mockImplementation(options => { beforeRead(); return list(options); });
  const path = 'replay/' + record.decision_id;
  const request = async () => {
    const before = f.accounts.log.length, response = await f.request(tenant, path);
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(f.accounts.log.length).toBe(before + 2);
    const pair = f.accounts.log.slice(-2).map(row => JSON.parse(row.detail!) as SubjectAuditDetail);
    expect(pair[0]!.phase).toBe('admitted'); expect(pair[1]).toMatchObject({ phase: 'result', status: 200, requestId: pair[0]!.requestId, subjectRef: expect.stringMatching(/^[a-f0-9]{64}$/) });
    return response.json() as Promise<{ ok: boolean; equal: boolean; reason?: string; used: unknown }>;
  };
  const initialReplay = await request();
  expect(initialReplay, initialReplay.reason).toMatchObject({ ok: true, equal: true, used: { catalog: 1, slots: 1, learn: 1, lift: at } });
  for (const kind of ['slots', 'learn']) {
    const key = `config-publication/v1/${tenant}/${kind}/rev/1.json`, saved = f.objects.get(key)!;
    for (const revision of [2, 0, -1, 0.5, '1', null]) {
      f.objects.set(key, JSON.stringify({ ...JSON.parse(saved), revision })); invalidatePublicationCache();
      expect(await request()).toMatchObject({ ok: false, equal: false, reason: 'recorded configuration dependency could not be read' });
    }
    f.objects.delete(key); invalidatePublicationCache();
    expect(await request()).toMatchObject({ ok: false, equal: false, reason: 'recorded configuration dependency could not be read' });
    f.objects.set(key, saved); invalidatePublicationCache();
    f.storage.get.mockImplementation(read => { beforeRead(); if (read === key) throw new Error('PRIVATE_DEPENDENCY'); return r2get(read); });
    const failed = await request(); expect(failed.ok).toBe(false); expect(JSON.stringify(failed)).not.toContain('PRIVATE_DEPENDENCY');
    f.storage.get.mockImplementation(read => { beforeRead(); return r2get(read); }); invalidatePublicationCache();
  }
  const savedArchive = f.objects.get(archiveKey)!; f.objects.delete(archiveKey);
  expect(await request()).toMatchObject({ ok: false, reason: `lift dependency hero/${at} is not in the archive` }); f.objects.set(archiveKey, savedArchive);
  f.objects.set(rowKey, rowBody.replace('"catalog":1', '"catalog":null')); kv.get.mockClear();
  expect(await request()).toMatchObject({ ok: false, reason: 'invalid replay versions tuple' }); expect(kv.get).not.toHaveBeenCalled();
  expect(f.storage.get.mock.calls.at(-1)![0]).not.toBe(archiveKey); f.objects.set(rowKey, rowBody);
  const auditCount = f.accounts.log.length; f.storage.get.mockClear(); f.storage.list.mockClear();
  expect((await f.request(tenant, path, f.tokens.get('harbor'))).status).toBe(403);
  expect((await f.request(tenant, path, '')).status).toBe(401);
  expect(f.accounts.log.length).toBe(auditCount); expect(f.storage.get).not.toHaveBeenCalled(); expect(f.storage.list).not.toHaveBeenCalled();
  expect(await request()).toMatchObject({ ok: true, equal: true });
  expect(f.objects).toEqual(baseline); expect(values).toEqual(kvBaseline);
  expect(f.storage.put).not.toHaveBeenCalled(); expect(f.storage.delete).not.toHaveBeenCalled(); expect(kv.put).not.toHaveBeenCalled(); expect(f.writes).not.toHaveBeenCalled();
});

it('W03.04 acknowledges admission and results for six reads, hashes actual subjects and withholds failed disclosures', async () => {
  const f = await operatorHistoryFixture(), visitor = 'audit-subject', at = Date.now() - 1000;
  const row = f.row('meridian', visitor, at);
  f.seed('meridian', visitor, [row]);
  await writeBatches(f.storage, [{ kind: 'ledger', type: 'decision', record: row }], 'audit-fixture');
  f.storage.put.mockClear();
  const before = f.snapshot(), detail = () => JSON.parse(f.accounts.log.at(-1)!.detail!) as SubjectAuditDetail;
  const realAudit = f.accounts.audit.bind(f.accounts), order: string[] = [];
  let checkingRead = true;
  const audit = vi.spyOn(f.accounts, 'audit').mockImplementation(async entry => {
    order.push(JSON.parse(entry.detail!).phase); await realAudit(entry);
  });
  const beforeRead = () => { if (checkingRead) { expect(detail().phase).toBe('admitted'); order.push('read'); } };
  const get = f.storage.get.getMockImplementation()!, list = f.storage.list.getMockImplementation()!, fetch = f.fetch.getMockImplementation()!;
  f.storage.get.mockImplementation(key => { beforeRead(); return get(key); });
  f.storage.list.mockImplementation(options => { beforeRead(); return list(options); });
  f.fetch.mockImplementation((name, input, init) => { beforeRead(); return fetch(name, input, init); });
  const paths = ['visitors/' + visitor + '/recent', 'visitors/' + visitor + '/receipts',
    'ledger/' + row.decision_id, 'replay/' + row.decision_id, 'ledger/batches?date=' + new Date(at).toISOString().slice(0, 10), 'ledger/erasures'];
  for (const [index, path] of paths.entries()) {
    order.length = 0;
    const response = await f.request('meridian', path);
    expect(response.status, path).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(order[0]).toBe('admitted'); expect(order.at(-1)).toBe('result'); expect(order).toContain('read');
    const pair = f.accounts.log.slice(-2).map(entry => JSON.parse(entry.detail!) as SubjectAuditDetail);
    expect(pair[0]!.requestId).toBe(pair[1]!.requestId); expect(pair[1]!.status).toBe(200);
    if (index === 2 || index === 3) expect(pair[1]!.subjectRef).toMatch(/^[a-f0-9]{64}$/);
  }
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(f.env.IDENTITY_SALT), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = [...new Uint8Array(await crypto.subtle.sign('HMAC', key,
    new TextEncoder().encode(JSON.stringify(['operator-subject-read', 1, 'meridian', 'visitor', visitor]))))].map(b => b.toString(16).padStart(2, '0')).join('');
  const records = f.accounts.log.map(entry => JSON.parse(entry.detail!) as SubjectAuditDetail);
  expect(records[0]!.selector).toEqual({ kind: 'visitor', ref: expected }); expect(records[5]!.subjectRef).toBe(expected);
  expect(JSON.stringify(f.accounts.log)).not.toContain(visitor); expect(JSON.stringify(f.accounts.log)).not.toContain(row.decision_id);
  expect(JSON.stringify(f.accounts.log)).not.toContain(f.env.IDENTITY_SALT);
  expect(f.accounts.log.every(entry => entry.tenant === 'meridian' && entry.actorId === 'history-meridian' && !entry.actorEmail && !entry.targetId)).toBe(true);
  // A pending admission prevents reads; a pending result prevents response release.
  for (const phase of ['admitted', 'result']) {
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), reached = new Promise<void>(resolve => { entered = resolve; });
    audit.mockImplementation(async entry => { if (JSON.parse(entry.detail!).phase === phase) { entered(); await gate; } await realAudit(entry); });
    f.fetch.mockClear(); let returned = false;
    const pending = Promise.resolve(f.request('meridian', paths[0]!)).then(response => { returned = true; return response; });
    await reached; expect(returned).toBe(false); expect(f.fetch.mock.calls.length).toBe(phase === 'admitted' ? 0 : 1);
    release(); expect((await pending).status).toBe(200);
  }
  for (const phase of ['admitted', 'result']) {
    audit.mockImplementation(async entry => { if (JSON.parse(entry.detail!).phase === phase) throw new Error('PRIVATE_ACK_FAILURE'); await realAudit(entry); });
    f.fetch.mockClear(); const count = f.accounts.log.length;
    const response = await f.request('meridian', paths[0]!);
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ ok: false, error: 'Subject audit unavailable' });
    expect(f.fetch.mock.calls.length).toBe(phase === 'admitted' ? 0 : 1); expect(f.accounts.log.length - count).toBe(phase === 'admitted' ? 0 : 1);
  }
  audit.mockImplementation(realAudit);
  const keyName = [...f.objects].find(([name]) => name.endsWith('.ndjson'))![0], original = f.objects.get(keyName)!;
  for (const path of paths.slice(2, 4)) {
    f.objects.set(keyName, original.replace('"tenant":"meridian"', '"tenant":"harbor"'));
    const response = await f.request('meridian', path);
    expect(response.status).toBe(503); expect(detail()).toMatchObject({ phase: 'result', status: 503 }); expect(detail().subjectRef).toBeUndefined();
  }
  f.objects.set(keyName, original);
  expect((await f.request('meridian', 'ledger/' + row.decision_id.replace(':history:', ':missing:'))).status).toBe(404);
  expect(detail().status).toBe(404);
  checkingRead = false;
  await writeTombstone(f.storage, 'meridian', visitor, 'synthetic', at);
  checkingRead = true;
  expect((await f.request('meridian', paths[2]!)).status).toBe(410); expect(detail().status).toBe(410);
  // Remove only the synthetic barrier from the comparison; the readers did not write it.
  expect(f.writes).not.toHaveBeenCalled(); expect(f.storage.delete).not.toHaveBeenCalled();
  expect(JSON.parse(before).rings).toEqual(JSON.parse(f.snapshot()).rings);
  expect(f.storage.put.mock.calls.every(([name]) => name.startsWith('erasures/'))).toBe(true);
});

it('W03.04 provides bounded tenant-admin audit pages without legacy bypass and refuses missing authority or audit material', async () => {
  const f = await operatorHistoryFixture(), visitor = 'same-subject', at = Date.now() - 1000;
  for (const tenant of ['meridian', 'harbor']) {
    f.seed(tenant, visitor, [f.row(tenant, visitor, at)]);
    expect((await f.get(tenant, visitor, 'recent')).status).toBe(200);
  }
  const firstRef = JSON.parse(f.accounts.log[0]!.detail!).selector.ref;
  expect(JSON.parse(f.accounts.log[2]!.detail!).selector.ref).not.toBe(firstRef);
  const size = f.accounts.log.length;
  const response = await f.request('meridian', 'audit?limit=2');
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  const page = await response.json() as { entries: Array<{ id: number; tenant: string }>; before: number };
  expect(page.entries).toHaveLength(2); expect(page.entries.every(entry => entry.tenant === 'meridian')).toBe(true);
  expect(f.accounts.log.length - size).toBe(2);
  const next = await (await f.request('meridian', 'audit?limit=2&before=' + page.before)).json() as typeof page;
  expect(next.entries.every(entry => entry.id < page.before)).toBe(true);
  expect(await f.accounts.recentAudit(100)).toEqual([]);
  const token = async (sub: string, roles: string[]) => new SignJWT({ type: 'service', roles }).setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub).setIssuer('i').setAudience('a').setExpirationTime('5m').sign(new TextEncoder().encode(f.env.JWT_SECRET));
  const operator = await token('history-meridian', ['operator']);
  for (const mode of ['enforced', 'open'] as const) {
    f.env.AUTH_MODE = mode;
    for (const deniedToken of ['', operator, f.tokens.get('harbor')!]) {
      const count = f.accounts.log.length;
      expect((await f.request('meridian', 'audit', deniedToken)).status).toBe(deniedToken ? 403 : 401);
      expect(f.accounts.log).toHaveLength(count);
    }
    expect((await f.request('meridian', 'audit')).status).toBe(200);
  }
  const count = f.accounts.log.length;
  expect((await f.get('meridian', visitor, 'recent')).status).toBe(200); expect(f.accounts.log).toHaveLength(count);
  f.env.AUTH_MODE = 'enforced';
  for (const query of ['limit=0', 'limit=101', 'limit=1.5', 'before=0', 'before=9007199254740992']) {
    expect((await f.request('meridian', 'audit?' + query)).status).toBe(400);
  }
  f.env.IDENTITY_SALT = ''; f.fetch.mockClear();
  expect((await f.get('meridian', visitor, 'recent')).status).toBe(503); expect(f.fetch).not.toHaveBeenCalled();
  expect((await f.request('meridian', 'audit')).status).toBe(503);
  f.env.IDENTITY_SALT = 'restored-synthetic-key';
  const longActor = 'a'.repeat(201);
  f.env.TENANTS = JSON.stringify({ provisioned: ['meridian'], operatorGrants: { [longActor]: ['meridian'], 'history-meridian': ['meridian'] } });
  expect((await f.get('meridian', visitor, 'recent', await token(longActor, ['admin']))).status).toBe(503);
  const longId = f.row('meridian', visitor, at).decision_id.replace(':history:', ':' + 'x'.repeat(2050) + ':');
  expect((await f.request('meridian', 'ledger/' + longId)).status).toBe(503); expect(f.fetch).not.toHaveBeenCalled();
  const read = vi.spyOn(f.accounts, 'subjectAudit').mockRejectedValueOnce(new Error('PRIVATE_D1_READ'));
  const failed = await f.request('meridian', 'audit'); expect(failed.status).toBe(503);
  expect(await failed.text()).not.toContain('PRIVATE'); expect(read).toHaveBeenCalledOnce();
  expect(JSON.parse(f.accounts.log.at(-1)!.detail!)).toMatchObject({ phase: 'result', operation: 'audit', status: 503 });
  expect(f.storage.put).not.toHaveBeenCalled(); expect(f.storage.delete).not.toHaveBeenCalled(); expect(f.writes).not.toHaveBeenCalled();
});

it('W06.11 refuses unavailable, malformed or mis-scoped operator history without disclosure or writes', async () => {
  const f = await operatorHistoryFixture(), visitor = 'v-history', at = Date.now() - 10_000;
  const row = f.row('meridian', visitor, at), good = { ok: true, ring: [row], index: 1 };
  f.seed('meridian', visitor, [row]);
  const before = f.snapshot();
  for (const suffix of ['recent', 'receipts']) {
    for (const bad of ['t:harbor:v', 'bad/visitor', 'bad visitor', 'x'.repeat(201)]) {
      expect((await f.get('meridian', bad, suffix)).status).toBe(400);
    }
    expect((await f.get('meridian', visitor, suffix, '')).status).toBe(401);
    expect((await f.get('harbor', visitor, suffix, f.tokens.get('meridian'))).status).toBe(403);
    expect((await f.get('meridian', visitor, suffix, f.tokens.get('meridian'), 'harbor')).status).toBe(403);
  }
  expect(f.names).not.toHaveBeenCalled(); expect(f.storage.get).not.toHaveBeenCalled(); expect(f.storage.list).not.toHaveBeenCalled();
  const responses: Array<() => Promise<Response>> = [
    async () => { throw new Error('private upstream failure'); },
    async () => new Response('private upstream body', { status: 503 }),
    async () => new Response('{private invalid JSON'),
    ...[null, [], {}, { ...good, ok: false }, { ...good, ring: null }, { ...good, index: undefined },
      { ...good, index: -1 }, { ...good, index: 0.5 }, { ...good, index: Number.MAX_SAFE_INTEGER + 1 },
      { ...good, ring: [null] }, { ...good, ring: [{ ...row, ts: at + 1 }] },
      { ...good, ring: [f.row('harbor', visitor, at)] }, { ...good, ring: [f.row('meridian', 'v-other', at)] },
    ].map(body => async () => Response.json(body)),
  ];
  for (const reply of responses) {
    f.fetch.mockImplementation(reply);
    for (const suffix of ['recent', 'receipts']) {
      const response = await f.get('meridian', visitor, suffix);
      expect(response.status).toBe(503); expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({ ok: false, error: 'Visitor history unavailable' });
    }
  }
  f.fetch.mockImplementation(async () => Response.json({ ...good, ring: [{ ...row, explain: null }] }, { headers: { 'X-Retention-Witness': JSON.stringify(row.retention!.online!) } }));
  expect((await f.get('meridian', visitor, 'receipts')).status).toBe(503);
  f.fetch.mockImplementation(async () => Response.json({ ...good, private: 'not an output field' }, { headers: { 'X-Retention-Witness': JSON.stringify(row.retention!.online!) } }));
  expect(await (await f.get('meridian', visitor, 'recent')).json()).toEqual(good);
  invalidatePublicationCache();
  const catalogGet=f.storage.get.getMockImplementation()!, head='config-publication/v2/meridian/head.json';
  f.storage.get.mockClear();
  f.storage.get.mockImplementation(async key=>{if(key===head)throw new Error('private catalog failure');return catalogGet(key);});
  const catalogFailure = await f.get('meridian', visitor, 'receipts');
  expect(catalogFailure.status).toBe(503); expect(await catalogFailure.json()).toEqual({ ok: false, error: 'Visitor history unavailable' });
  expect(f.storage.get.mock.calls.some(([key])=>key===head)).toBe(true); f.storage.get.mockImplementation(catalogGet);
  f.env.DECISION_RING = undefined as never;
  for (const suffix of ['recent', 'receipts']) expect((await f.get('meridian', visitor, suffix)).status).toBe(503);
  expect(f.snapshot()).toBe(before); expect(f.writes).not.toHaveBeenCalled(); expect(f.storage.put).not.toHaveBeenCalled();
  expect(f.storage.delete).not.toHaveBeenCalled();
  expect(f.storage.list).not.toHaveBeenCalled();
});

it('W06.11 preserves actual cached cutoff projections, empty history and paged named receipts in two tenants', async () => {
  const f = await operatorHistoryFixture(), visitor = 'v-history', at = Date.now() - 10_000;
  const rows = new Map<string, DecisionRecord[]>();
  for (const tenant of ['meridian', 'harbor']) {
    const records = [f.row(tenant, visitor, at - 1), f.row(tenant, visitor, at), f.row(tenant, visitor, at + 1, 1), f.row(tenant, visitor, at + 1)];
    rows.set(tenant, records); f.seed(tenant, visitor, records);
    expect(await (await f.get(tenant, visitor, 'recent')).json()).toEqual({ ok: true, ring: records, index: 4 });
  }
  await writeTombstone(f.storage, 'meridian', visitor, 'synthetic', at);
  f.storage.put.mockClear();
  const before = f.snapshot();
  expect(await (await f.get('meridian', visitor, 'recent')).json()).toEqual({ ok: true, ring: rows.get('meridian')!.slice(2), index: 2 });
  expect(await (await f.get('harbor', visitor, 'recent')).json()).toEqual({ ok: true, ring: rows.get('harbor'), index: 4 });
  const first = await f.get('meridian', visitor, 'receipts?limit=1');
  expect(first.status).toBe(200); expect(first.headers.get('cache-control')).toBe('no-store');
  const page = await first.json() as { receipts: Array<{ decision_id: string; title: string; customer_item_id: string }>; cursor: string };
  expect(page).toMatchObject({ ok: true, tenant: 'meridian', visitor_id: visitor, total: 2, offset: 0, limit: 1,
    receipts: [{ decision_id: rows.get('meridian')![3]!.decision_id, title: 'meridian-a', customer_item_id: 'cms-a' }] });
  expect(typeof page.cursor).toBe('string');
  const next = await f.get('meridian', visitor, `receipts?cursor=${encodeURIComponent(page.cursor)}`);
  expect(next.status).toBe(200);
  expect(await next.json()).toMatchObject({ total: 2, offset: 1, limit: 1, cursor: null,
    receipts: [{ decision_id: rows.get('meridian')![2]!.decision_id, title: 'meridian-b', customer_item_id: 'cms-b' }] });
  const other = await f.get('harbor', visitor, 'receipts');
  expect(other.status).toBe(200);
  const otherPage = await other.json() as { total: number; receipts: Array<{ title: string }> };
  expect(otherPage.total).toBe(4); expect(otherPage.receipts.slice(0, 2).map(receipt => receipt.title)).toEqual(['harbor-a', 'harbor-b']);
  expect(f.snapshot()).toBe(before);
  await writeTombstone(f.storage, 'harbor', visitor, 'synthetic', at + 1);
  const afterSecondCutoff = f.snapshot();
  expect(await (await f.get('harbor', visitor, 'recent')).json()).toEqual({ ok: true, ring: [], index: 0 });
  expect(await (await f.get('harbor', visitor, 'receipts')).json()).toMatchObject({ ok: true, total: 0, receipts: [], cursor: null });
  expect(f.snapshot()).toBe(afterSecondCutoff);
  // Restart with an index-only legacy ring; its retained index remains cutoff-filtered.
  f.seed('meridian', visitor, [], rows.get('meridian')!);
  f.seed('meridian', 'v-empty', []);
  f.storage.put.mockClear();
  const finalBefore = f.snapshot();
  expect(await (await f.get('meridian', visitor, 'recent')).json()).toEqual({ ok: true, ring: [], index: 2 });
  for (const subject of [visitor, 'v-empty']) {
    const receipt = await f.get('meridian', subject, 'receipts');
    expect(receipt.status).toBe(200); expect(await receipt.json()).toMatchObject({ ok: true, total: 0, receipts: [], cursor: null });
  }
  expect(await (await f.get('meridian', 'v-empty', 'recent')).json()).toEqual({ ok: true, ring: [], index: 0 });
  expect(f.snapshot()).toBe(finalBefore); expect(f.writes).not.toHaveBeenCalled(); expect(f.storage.put).not.toHaveBeenCalled();
  expect(f.storage.delete).not.toHaveBeenCalled();
  expect(f.storage.list).not.toHaveBeenCalled();
  expect(f.names.mock.calls.every(([name]) => name === `meridian:${visitor}` || name === `harbor:${visitor}` || name === 'meridian:v-empty')).toBe(true);
});

it('W06.12 rechecks original row and index-only lifetimes after the actual result audit before private release', async () => {
  const now = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  try {
    const f = await operatorHistoryFixture(), visitor = 'v-release-expiry', row = f.row('meridian', visitor, now - 1000);
    f.seed('meridian', visitor, [row]);
    await writeBatches(f.storage, [{ kind: 'ledger', type: 'decision', record: row }], 'w0612-release');
    const before = f.snapshot(), audit = f.accounts.audit.bind(f.accounts);
    const paths = ['visitors/' + visitor + '/recent', 'visitors/' + visitor + '/receipts', 'ledger/' + row.decision_id, 'replay/' + row.decision_id];
    for (const path of paths) {
      clock.mockReturnValue(now);
      const positive = await f.request('meridian', path); expect(positive.status).toBe(200);
      expect(await positive.text()).toContain(visitor);
      const held = vi.spyOn(f.accounts, 'audit').mockImplementation(async entry => {
        await audit(entry);
        if (JSON.parse(entry.detail!).phase === 'result') clock.mockReturnValue(row.retention!.ledger!.expiresAt);
      });
      const refused = await f.request('meridian', path); held.mockRestore();
      expect(refused.status).toBe(503); expect(refused.headers.get('cache-control')).toBe('no-store');
      expect(await refused.text()).not.toContain(visitor);
      // The durable audit describes the completed read, never client delivery.
      expect(JSON.parse(f.accounts.log.at(-1)!.detail!)).toMatchObject({ phase: 'result', status: 200 });
      expect(f.snapshot()).toBe(before);
    }
    clock.mockReturnValue(now); f.seed('meridian', visitor, [], [row]);
    expect(await (await f.get('meridian', visitor, 'recent')).json()).toEqual({ ok: true, ring: [], index: 1 });
    const state = f.snapshot(), held = vi.spyOn(f.accounts, 'audit').mockImplementation(async entry => {
      await audit(entry); if (JSON.parse(entry.detail!).phase === 'result') clock.mockReturnValue(row.retention!.online!.expiresAt);
    });
    const refused = await f.get('meridian', visitor, 'recent'); held.mockRestore();
    expect(refused.status).toBe(503); expect(await refused.text()).not.toContain('"index"'); expect(f.snapshot()).toBe(state);
    expect(f.writes).not.toHaveBeenCalled();
    // Exact original data authority also fences dependency consumption, not
    // only the HTTP release. Numerical archives retain their own semantics.
    clock.mockReturnValue(now);
    const page = [{ slot: 'hero', take: 1, weights: {} }], catalog = { pieces: [piece('a', {}, ['hero'])] };
    const cell = { channel: 'direct', visit_bucket: '1' as const, region: null, affinity: null }, stats = emptyStats();
    for (let i = 0; i < 100; i++) recordExposure(stats, 'a', cell, now, DEFAULT_STATS);
    const snapshot = buildSnapshot(stats, { tenant: 'meridian', brand: 'meridian', slot: 'hero' }, 'click', now, DEFAULT_STATS);
    const served = decideContent({ tenant: 'meridian', brand: 'meridian', page: 'home', visitorId: visitor, sessionId: 's', identityAnchor: 'visitor', nowMs: now,
      pieces: catalog.pieces, slots: page, affinity: null, cell, arm: 'personalized', configLabel: 'synthetic',
      versions: { config: 0, catalog: 1, slots: 1, learn: 1, lift: 0, prior: 0, policy: 1 }, learning: { snapshots: { hero: snapshot }, gammaOf: () => 0 } }).records[0]!;
    const archive = vi.fn(async () => snapshot);
    const deps: ReplayDeps = { doc: async kind => (kind.name === CONTENT_KIND.name ? catalog : kind.name === SLOTS_KIND.name ? { pages: { home: page } } : DEFAULT_LEARN) as never, archive };
    const replayed = await replayDecision(f.env, served, deps); expect(replayed).toMatchObject({ ok: true, equal: true });
    expect(replayed.replayed!.retention).toEqual(served.retention); expect(archive).toHaveBeenCalledTimes(1); archive.mockClear();
    await expect(replayDecision(f.env, served, { ...deps, doc: async (...args) => {
      const value = await deps.doc(...args); clock.mockReturnValue(served.retention!.ledger!.expiresAt); return value;
    } })).rejects.toThrow(); expect(archive).not.toHaveBeenCalled();
    clock.mockReturnValue(now);
    await expect(replayDecision(f.env, served, { ...deps, archive: async () => {
      clock.mockReturnValue(served.retention!.ledger!.expiresAt); return snapshot;
    } })).rejects.toThrow();
  } finally { clock.mockRestore(); vi.restoreAllMocks(); }
});

describe('ids and prefixes', () => {
  it('the id carries the brand and the time, and the hour prefix follows from it', () => {
    const r = set('v1').records[0]!;
    expect(parseId(r.decision_id)).toEqual({ tenant: 'coach', ts: T0 });
    expect(hourPrefix('coach', T0)).toBe('coach/2026-11-27/14');
    expect(ts36(T0)).toHaveLength(9);
    expect(parseId('garbage')).toBeNull();
  });

  it('knows which wire events are rewards, including the ones the SDK sends as custom', () => {
    expect(rewardOf({ type: 'add_to_cart', userId: 'v' })).toEqual({ type: 'add_to_bag', event: 'add_to_cart' });
    expect(rewardOf({ type: 'custom', userId: 'v', data: { event: 'purchase' } })).toEqual({ type: 'purchase', event: 'purchase' });
    expect(rewardOf({ type: 'custom', userId: 'v', data: { event: 'content_dwell' } })).toEqual({ type: 'dwell', event: 'content_dwell' });
    expect(rewardOf({ type: 'product_view', userId: 'v' })).toBeNull();
    expect(rewardOf({ type: 'custom', userId: 'v', data: { event: 'content_impression' } })).toBeNull();
    const o = outcomeFromAction({ type: 'custom', userId: 'v9', sessionId: 's9', timestamp: T0, data: { event: 'purchase', orderId: 'o1', value: 395, currency: 'USD' } }, 'coach', 'coach', 'personalized')!;
    expect(o).toMatchObject({ outcome_id: `coach:${ts36(T0)}:v9:purchase`, type: 'purchase', item_id: 'o1', value: 395, currency: 'USD', arm: 'personalized', session_id: 's9' });
  });
});

describe('producer', () => {
  it('W07.05 dormant behavioral AE helpers cannot inspect arbitrary dimensions or touch the binding', () => {
    const effect = vi.fn(() => { throw new Error('private'); });
    const binding = new Proxy({}, { get: effect }) as AnalyticsEngineDataset;
    const records = new Proxy([], { get: effect }) as unknown as DecisionRecord[];
    pointsForDecisions(binding, records); pointForOutcome(binding, new Proxy({}, { get: effect }) as OutcomeRecord);
    expect(effect).not.toHaveBeenCalled();
  });
  it('W06.12 enqueues exact decision/outcome records while independently refusing AE without destination retention', async () => {
    const q = new FakeQueue(), ae = new FakeAE();
    const s = set('v1');
    await enqueueDecisions({ EVENT_QUEUE: q as never, ANALYTICS: ae as never }, s.records);
    expect(q.sent).toHaveLength(1);
    expect(q.sent[0]).toMatchObject({ kind: 'ledger', type: 'decisions', records: [{ decision_id: s.records[0]!.decision_id }, { decision_id: s.records[1]!.decision_id }, { decision_id: s.records[2]!.decision_id }] });
    expect(ae.points).toHaveLength(0);
    await enqueueOutcome({ EVENT_QUEUE: q as never, ANALYTICS: ae as never }, outcomeFromAction({ type: 'add_to_cart', userId: 'v1', timestamp: T0, data: { productId: 'p1' } }, 'coach'));
    expect(q.sent).toHaveLength(2);
    expect(ae.points).toHaveLength(0);
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(enqueueDecisions({ EVENT_QUEUE: undefined as never, ANALYTICS: undefined as never }, s.records))
        .resolves.toMatchObject({ code: 'queue_unavailable', records: { total: 3, notAttempted: 3 } });
    } finally { diagnostic.mockRestore(); }
    pointsForDecisions(undefined, s.records);
  });

  it('W09.01 packs real decision sets by UTF-8 bytes with lossless legacy expansion, storage and receipts', async () => {
    const size = (body: unknown) => new TextEncoder().encode(JSON.stringify(body)).length;
    const cases = [[8, 8, 24, false, 36032], [30, 8, 24, false, 135062], [30, 6, 24, true, 188672], [8, 8, 128, true, 291941]] as const;
    for (const [positions, dimensions, values, regional, baselineBytes] of cases) {
      const dims: Array<[string, string[]]> = Array.from({ length: dimensions }, (_, d) => [`dim${d}`, Array.from({ length: values }, (_, v) => `dim${d}-v${v}`)]);
      const catalog = validateContentCatalog({ pieces: Array.from({ length: 400 }, (_, i) => ({
        id: `piece-${i}`, customerContentId: `cms-entry-${100000 + i}`, type: 'editorial', title: `Editorial ${i}`,
        tags: Object.fromEntries(dims.map(([d, vs]) => [d, [vs[i % values], vs[(i + 5) % values]]])),
        slotTypes: [`slot-${i % positions}`, 'any'], lifecycle: { status: 'live' },
      })) });
      const page = validateSlotCatalog({ pages: { home: Array.from({ length: positions }, (_, i) => ({
        slot: `slot-${i}`, take: 1, weights: Object.fromEntries(dims.map(([d]) => [d, 0.3])),
      })) } });
      expect(catalog.ok && page.ok).toBe(true);
      if (!catalog.ok || !page.ok) throw new Error('synthetic catalog validation');
      const vector = Object.fromEntries(dims.map(([d, vs]) => [d, Object.fromEntries(vs.map((v, i) => [v, Math.round((1 - i / values) * 1000) / 1000]))]));
      const nowMs = Date.UTC(2026, 8, 6, 12);
      const produced = decideContent({
        tenant: 'coach', brand: 'coach', page: 'home', visitorId: 'v-audit-0001', sessionId: 's-audit-0001', identityAnchor: 'visitor', nowMs,
        pieces: catalog.value.pieces, slots: page.value.pages.home!, affinity: { dims: vector },
        ...(regional ? { regional: { region: 'US-NY', level: 'region' as const, lambda: 0.3, version: 1, events: 480, share: vector } } : {}),
        cell: { channel: 'paid_social', visit_bucket: '2-3', region: 'US-NY', affinity: 'dim0-v0', stage: 'mid' },
        arm: 'personalized', versions: { config: 12, catalog: 4, slots: 3, learn: 2, lift: 0, prior: 0, policy: 1 }, configLabel: 'autumn-2026-r12',
      });
      expect(produced.records).toHaveLength(positions);
      const oldProjection = structuredClone(produced.records);
      for (const record of oldProjection) { delete record.inputs!.replay; delete record.ranking_position; delete record.retention; }
      expect(size({ kind: 'ledger', type: 'decisions', records: oldProjection })).toBe(baselineBytes);
      const actualBytes = size({ kind: 'ledger', type: 'decisions', records: produced.records });
      const manifestBytes = size({ replay: produced.records[0]!.inputs!.replay }) - 1; // comma plus field, without object braces
      const rankingBytes = size({ ranking_position: 0 }) - 1;
      expect(produced.records.every(record => record.ranking_position === 0)).toBe(true);
      const retentionBytes = size({ retention: produced.records[0]!.retention }) - 1;
      expect(actualBytes - baselineBytes).toBe(positions * (manifestBytes + rankingBytes + retentionBytes));
      expect(produced.records[0]!.inputs!.replay!.slots).toHaveLength(positions);
      const bodies: unknown[] = [], batchSizes: number[] = [];
      const queue = { send: vi.fn(), sendBatch: vi.fn(async (messages: Array<{ body: unknown; contentType: string }>) => {
        expect(messages.length).toBeLessThanOrEqual(LEDGER_BATCH_MESSAGES);
        expect(messages.reduce((sum, m) => sum + size(m.body), 0)).toBeLessThanOrEqual(LEDGER_BATCH_BYTES);
        batchSizes.push(messages.length);
        for (const m of messages) {
          expect(m.contentType).toBe('json'); expect(typeof m.body).toBe('object');
          expect(size(m.body)).toBeLessThanOrEqual(LEDGER_BODY_BYTES);
          expect(m.body).toMatchObject({ kind: 'ledger', type: 'decisions', version: 1 }); bodies.push(m.body);
        }
      }) };
      const ae = new FakeAE();
      const result = await enqueueDecisions({ EVENT_QUEUE: queue as never, ANALYTICS: ae as never }, produced.records);
      expect(result).toEqual({ code: 'accepted', prepared: true,
        records: { total: positions, acknowledged: positions, unknown: 0, notAttempted: 0 },
        messages: { total: bodies.length, acknowledged: bodies.length, unknown: 0, notAttempted: 0 } });
      expect(queue.send).not.toHaveBeenCalled(); expect(ae.points).toHaveLength(0);
      const frame = size({ kind: 'ledger', type: 'decisions', version: 1, records: [] });
      let planned = 1, bytes = frame, count = 0;
      for (const record of produced.records) {
        if (bytes + size(record) + (count ? 1 : 0) > LEDGER_BODY_BYTES) { planned++; bytes = frame; count = 0; }
        bytes += size(record) + (count ? 1 : 0); count++;
      }
      expect(bodies.length).toBe(planned);
      if (actualBytes > LEDGER_BATCH_BYTES) expect(batchSizes.length).toBeGreaterThan(1);
      console.info('W27.02 packing bytes', { positions, dimensions, values, regional, baselineBytes, manifestBytes, rankingBytes,
        addedBytes: actualBytes - baselineBytes, actualBytes, messages: bodies.length, batches: batchSizes.length });
      const expected = JSON.parse(JSON.stringify(produced.records)) as DecisionRecord[];
      expect(bodies.flatMap(expandLedgerMessage).map(m => m.record)).toEqual(expected);
      const r2 = new FakeR2();
      expect(await consumeLedger({ STORAGE: r2 as never }, bodies, nowMs)).toMatchObject({ ok: true, written: positions, skipped: 0 });
      for (const original of expected) {
        const found = await findById<DecisionRecord>(r2, original.decision_id, 'decision');
        expect(found?.record).toEqual(original);
        expect(receiptOf(found!.record, new Map())).toEqual(receiptOf(original, new Map()));
      }
    }

    const q = new FakeQueue(), record = structuredClone(set('v-unicode').records[0]!);
    record.explain.note = 'é🙂';
    const envelope = () => ({ kind: 'ledger', type: 'decisions', version: 1, records: [record] });
    record.explain.note += 'x'.repeat(LEDGER_BODY_BYTES - size(envelope()));
    expect(size(envelope())).toBe(LEDGER_BODY_BYTES);
    expect((await enqueueDecisions({ EVENT_QUEUE: q as never, ANALYTICS: undefined as never }, [record])).code).toBe('accepted');
    expect(size(q.sent[0])).toBe(LEDGER_BODY_BYTES);
    record.explain.note += 'x';
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect((await enqueueDecisions({ EVENT_QUEUE: q as never, ANALYTICS: undefined as never }, [record])).code).toBe('oversized_record');
      expect(q.sent).toHaveLength(1);
      const outcome = outcomeFromAction({ type: 'purchase', userId: 'v-unicode', timestamp: T0 }, 'coach')!;
      outcome.currency = 'é🙂';
      const outcomeBody = () => ({ kind: 'ledger', type: 'outcome', version: 1, record: outcome });
      outcome.currency += 'x'.repeat(LEDGER_BODY_BYTES - size(outcomeBody()));
      expect((await enqueueOutcome({ EVENT_QUEUE: q as never, ANALYTICS: undefined as never }, outcome)).code).toBe('accepted');
      expect(size(q.sent[1])).toBe(LEDGER_BODY_BYTES);
      expect(expandLedgerMessage(q.sent[1]).map(m => m.record)).toEqual([outcome]);
      outcome.currency += 'x';
      expect((await enqueueOutcome({ EVENT_QUEUE: q as never, ANALYTICS: undefined as never }, outcome)).code).toBe('oversized_record');
      expect(q.sent).toHaveLength(2);
    } finally { diagnostic.mockRestore(); }
  });

  it('W09.01 refuses preflight loss and conserves partial queue acceptance with frozen payloads and safe diagnostics', async () => {
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const env = (queue?: unknown, ae?: FakeAE) => ({ EVENT_QUEUE: queue as never, ANALYTICS: ae as never });
    const conserved = (result: LedgerDeliveryReceipt) => {
      for (const c of [result.records, result.messages]) expect(c.acknowledged + c.unknown + c.notAttempted).toBe(c.total);
      return result;
    };
    const rows = Array.from({ length: 12 }, (_, i) => {
      const row = structuredClone(set(`v-PRIVATE-${i}`).records[0]!); row.explain.note = 'x'.repeat(70_000); return row;
    });
    try {
      const q = new FakeQueue(), ae = new FakeAE();
      expect(conserved(await enqueueDecisions(env(q), []))).toMatchObject({ code: 'empty', messages: { total: 0 } });
      expect(conserved(await enqueueOutcome(env(q), null))).toMatchObject({ code: 'empty', records: { total: 0 } });
      expect(diagnostic).not.toHaveBeenCalled();
      expect(conserved(await enqueueDecisions(env(undefined, ae), rows))).toMatchObject({ code: 'queue_unavailable', prepared: true,
        records: { total: 12, notAttempted: 12 }, messages: { total: 12, notAttempted: 12 } });
      expect(ae.points).toHaveLength(0);
      const capability = { get sendBatch(): never { throw new Error('PRIVATE_CAPABILITY'); }, send: vi.fn() };
      expect(conserved(await enqueueDecisions(env(capability), rows))).toMatchObject({ code: 'queue_unavailable', records: { notAttempted: 12, unknown: 0 } });
      expect(capability.send).not.toHaveBeenCalled();
      const oversized = structuredClone(rows[0]!); oversized.explain.note = '🙂'.repeat(40_000);
      const cyclic = structuredClone(rows[0]!); Object.assign(cyclic, { circular: cyclic });
      const bigint = Object.assign(structuredClone(rows[0]!), { privateValue: 1n });
      const throwing = Object.assign(structuredClone(rows[0]!), { toJSON() { throw new Error('PRIVATE_SERIALIZATION'); } });
      for (const [bad, code] of [[oversized, 'oversized_record'], [cyclic, 'serialization_failed'], [bigint, 'serialization_failed'], [throwing, 'serialization_failed']] as const) {
        const before = diagnostic.mock.calls.length;
        expect(conserved(await enqueueDecisions(env(q), [...rows, bad]))).toEqual({ code, prepared: false,
          records: { total: 13, acknowledged: 0, unknown: 0, notAttempted: 13 },
          messages: { total: 0, acknowledged: 0, unknown: 0, notAttempted: 0 } });
        expect(diagnostic.mock.calls.length).toBe(before + 1); expect(q.sent).toHaveLength(0);
      }
      const outcome = outcomeFromAction({ type: 'purchase', userId: 'v-outcome', timestamp: T0 }, 'coach')!;
      Object.assign(outcome, { circular: outcome });
      expect(conserved(await enqueueOutcome(env(q), outcome))).toMatchObject({ code: 'serialization_failed', prepared: false, records: { notAttempted: 1 } });
      for (const failAt of [1, 2]) {
        let calls = 0;
        const queue = { send: vi.fn(), sendBatch: vi.fn(async (messages: Array<{ body: unknown; contentType: string }>) => {
          expect(messages).toHaveLength(3); expect(messages.every(m => m.contentType === 'json')).toBe(true);
          if (++calls === failAt) throw new Error('PRIVATE_QUEUE_REJECTION');
        }) };
        const result = conserved(await enqueueDecisions(env(queue), rows));
        expect(result).toMatchObject({ code: 'queue_rejected', prepared: true,
          records: { total: 12, acknowledged: (failAt - 1) * 3, unknown: 3, notAttempted: 12 - failAt * 3 },
          messages: { total: 12, acknowledged: (failAt - 1) * 3, unknown: 3, notAttempted: 12 - failAt * 3 } });
        expect(queue.sendBatch).toHaveBeenCalledTimes(failAt); expect(queue.send).not.toHaveBeenCalled();
      }
      const sequential = { send: vi.fn(async (_body: unknown, options: unknown) => {
        expect(options).toEqual({ contentType: 'json' });
        if (sequential.send.mock.calls.length === 2) throw new Error('PRIVATE_SINGLE_REJECTION');
      }) };
      expect(conserved(await enqueueDecisions(env(sequential), rows))).toMatchObject({ code: 'queue_rejected',
        records: { total: 12, acknowledged: 1, unknown: 1, notAttempted: 10 }, messages: { total: 12, acknowledged: 1, unknown: 1, notAttempted: 10 } });
      expect(sequential.send).toHaveBeenCalledTimes(2);

      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; }), bodies: unknown[] = [];
      const frozen = { send: vi.fn(), sendBatch: vi.fn(async (messages: Array<{ body: unknown }>) => {
        bodies.push(...messages.map(m => m.body)); if (frozen.sendBatch.mock.calls.length === 1) await gate;
      }) };
      const expected = JSON.parse(JSON.stringify(rows)) as DecisionRecord[];
      const pending = enqueueDecisions(env(frozen), rows);
      expect(frozen.sendBatch).toHaveBeenCalledTimes(1);
      for (const row of rows) { row.explain.note = 'PRIVATE_MUTATED'.repeat(30_000); row.inputs!.affinity = { mutated: { value: 99 } }; }
      rows.splice(3); release();
      expect(conserved(await pending)).toMatchObject({ code: 'accepted', records: { total: 12, acknowledged: 12 }, messages: { total: 12, acknowledged: 12 } });
      expect(bodies.flatMap(expandLedgerMessage).map(m => m.record)).toEqual(expected);
      for (const [label, summary] of diagnostic.mock.calls) {
        expect(label).toBe('ledger_delivery_failed');
        expect(Object.entries(summary as Record<string, unknown>).every(([key, value]) => key === 'code' ? typeof value === 'string' : typeof value === 'number')).toBe(true);
      }
      expect(JSON.stringify(diagnostic.mock.calls)).not.toMatch(/PRIVATE|coach|visitor|payload|stack/);
      diagnostic.mockImplementation(() => { throw new Error('PRIVATE_LOGGER'); });
      await expect(enqueueDecisions(env(), rows)).resolves.toMatchObject({ code: 'oversized_record', prepared: false });
      const failQueue = { send: async () => { throw new Error('PRIVATE_SEND'); } };
      await expect(enqueueOutcome(env(failQueue), outcomeFromAction({ type: 'purchase', userId: 'v', timestamp: T0 }, 'coach')))
        .resolves.toMatchObject({ code: 'queue_rejected', records: { total: 1, unknown: 1 } });
    } finally { diagnostic.mockRestore(); }
  });
});

it('W09.08 isolates optional analytics and queue acquisition failures for both producer families and recovery modes', async () => {
  const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    for (const family of ['decisions', 'outcome']) for (const flag of [undefined, 'true']) {
      for (const failure of ['analytics_binding', 'analytics_schedule', 'queue_binding']) {
        const q = new FakeQueue(), ae = new FakeAE(), r2 = new ManagedR2(), accesses: string[] = [];
        let scheduled = 0;
        const env = {
          get LEDGER_RECOVERY_ENABLED() { accesses.push('mode'); return flag; },
          get ANALYTICS() {
            accesses.push('analytics'); if (failure === 'analytics_binding') throw new Error('PRIVATE_ANALYTICS');
            return { writeDataPoint(point: unknown) {
              scheduled++; if (failure === 'analytics_schedule') throw new Error('PRIVATE_SCHEDULING'); ae.writeDataPoint(point);
            } } as never;
          },
          get EVENT_QUEUE() { accesses.push('queue'); if (failure === 'queue_binding') throw new Error('PRIVATE_QUEUE'); return q as never; },
          get STORAGE() { accesses.push('storage'); return r2 as never; },
        };
        const rows = set('v-binding').records, outcome = managedOutcome('v-binding').record;
        const expected = JSON.parse(JSON.stringify(family === 'decisions' ? rows : [outcome])) as Array<DecisionRecord | OutcomeRecord>;
        const result = family === 'decisions' ? await enqueueDecisions(env, rows) : await enqueueOutcome(env, outcome);
        const unavailable = failure === 'queue_binding', fallback = unavailable && flag === 'true';
        expect(result).toMatchObject({ code: unavailable ? 'queue_unavailable' : 'accepted', prepared: true,
          records: { total: expected.length, acknowledged: unavailable ? 0 : expected.length, unknown: 0, notAttempted: unavailable ? expected.length : 0 },
          messages: { total: 1, acknowledged: unavailable ? 0 : 1, unknown: 0, notAttempted: unavailable ? 1 : 0 } });
        expect(accesses).not.toContain('analytics');
        expect(accesses.filter(value => value !== 'storage')).toEqual(['mode', 'queue']);
        expect(scheduled).toBe(0); expect(ae.points).toHaveLength(0);
        if (unavailable) expect(q.sent).toEqual([]);
        else {
          expect(q.sent.flatMap(expandLedgerMessage).map(message => message.record)).toEqual(expected);
          if (flag === 'true') expect(q.sent[0]).toHaveProperty('delivery_id', expect.any(String));
          else expect(q.sent[0]).not.toHaveProperty('delivery_id');
        }
        if (fallback) {
          expect(captureConserved(result.capture!)).toMatchObject({ ok: true, newlyStored: expected.length, unknown: 0, notAttempted: 0 });
          expect(r2.rows().map(row => { const value = { ...row }; delete value[DELIVERY_FIELD]; return value; })).toEqual(expected);
          for (const row of r2.rows()) expect(row[DELIVERY_FIELD]).toMatchObject({ id: expect.any(String), ordinal: expect.any(Number) });
        } else { expect(result).not.toHaveProperty('capture'); expect(r2.store.size).toBe(0); }
      }
    }
    for (const [label, summary] of diagnostic.mock.calls) {
      expect(label).toBe('ledger_delivery_failed');
      expect(Object.entries(summary as Record<string, unknown>).every(([key, value]) => key === 'code' || key === 'captureCode'
        ? typeof value === 'string' : typeof value === 'number')).toBe(true);
    }
    expect(JSON.stringify(diagnostic.mock.calls)).not.toMatch(/PRIVATE|v-binding|coach|decision_id|outcome_id/);
  } finally { diagnostic.mockRestore(); }
});

it('W09.08 refuses unreadable recovery settings and distinguishes inert or unattempted work from uncertain capture', async () => {
  const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const counts = (total: number) => ({ total, acknowledged: 0, unknown: 0, notAttempted: total });
  try {
    const accessed: string[] = [], trapped = new Proxy({} as Env, { get(_target, name) { accessed.push(String(name)); throw new Error('PRIVATE_EMPTY'); } });
    expect(await enqueueDecisions(trapped, [])).toEqual({ code: 'empty', prepared: true, records: counts(0), messages: counts(0) });
    expect(await enqueueOutcome(trapped, null)).toEqual({ code: 'empty', prepared: true, records: counts(0), messages: counts(0) });
    expect(accessed).toEqual([]); expect(diagnostic).not.toHaveBeenCalled();
    for (const family of ['decisions', 'outcome']) {
      const rows = set('v-config').records, outcome = managedOutcome('v-config').record, total = family === 'decisions' ? rows.length : 1;
      const produce = (env: Parameters<typeof enqueueDecisions>[0]) => family === 'decisions' ? enqueueDecisions(env, rows) : enqueueOutcome(env, outcome);
      for (const loggerThrows of [false, true]) {
        accessed.length = 0;
        diagnostic.mockImplementation(() => { if (loggerThrows) throw new Error('PRIVATE_LOGGER'); });
        await expect(produce(trapped)).resolves.toEqual({ code: 'configuration_unavailable', prepared: false, records: counts(total), messages: counts(0) });
        expect(accessed).toEqual(['LEDGER_RECOVERY_ENABLED']);
      }
      diagnostic.mockImplementation(() => undefined);
      for (const flag of [undefined, 'true', true, 'TRUE']) {
        const r2 = new ManagedR2(), accesses: string[] = [];
        const env = {
          get LEDGER_RECOVERY_ENABLED() { accesses.push('mode'); return flag as never; },
          get ANALYTICS() { accesses.push('analytics'); return undefined as never; },
          get EVENT_QUEUE() { accesses.push('queue'); return undefined as never; },
          get STORAGE() { accesses.push('storage'); return r2 as never; },
        };
        const result = await produce(env);
        expect(result).toMatchObject({ code: 'queue_unavailable', prepared: true, records: counts(total), messages: counts(1) });
        expect(accesses).not.toContain('analytics');
        expect(accesses.filter(value => value !== 'storage')).toEqual(['mode', 'queue']);
        if (flag === 'true') expect(captureConserved(result.capture!)).toMatchObject({ newlyStored: total, unknown: 0, notAttempted: 0 });
        else { expect(result).not.toHaveProperty('capture'); expect(r2.store.size).toBe(0); }
      }
      for (const failure of ['missing', 'binding', 'post_call']) {
        const r2 = new ManagedR2(); let storageReads = 0;
        const env = { LEDGER_RECOVERY_ENABLED: 'true', EVENT_QUEUE: undefined as never, ANALYTICS: undefined as never,
          get STORAGE() { storageReads++; if (failure === 'binding') throw new Error('PRIVATE_STORAGE'); return (failure === 'missing' ? undefined : r2) as never; },
        };
        const persist = vi.spyOn(ledgerWriter, 'persistDeliveries');
        if (failure === 'post_call') persist.mockRejectedValueOnce(new Error('PRIVATE_AFTER_CALL'));
        try {
          const result = await produce(env);
          expect(result).toMatchObject({ code: 'queue_unavailable', records: counts(total), messages: counts(1) });
          expect(captureConserved(result.capture!)).toEqual({ ok: false, total, newlyStored: 0, alreadyPresent: 0, suppressed: 0,
            unknown: failure === 'post_call' ? total : 0, notAttempted: failure === 'post_call' ? 0 : total, objects: 0, code: 'storage_unavailable' });
          expect(storageReads).toBe(failure === 'post_call' ? 2 : 1); expect(persist).toHaveBeenCalledTimes(failure === 'post_call' ? 1 : 0);
          expect(r2.store.size).toBe(0);
        } finally { persist.mockRestore(); }
      }
      for (const flag of [undefined, 'true']) for (const failure of ['serialization', 'oversized']) {
        let queueReads = 0; const r2 = new ManagedR2();
        const env = { LEDGER_RECOVERY_ENABLED: flag, ANALYTICS: undefined as never, STORAGE: r2 as never,
          get EVENT_QUEUE(): never { queueReads++; throw new Error('PRIVATE_PREFLIGHT_QUEUE'); },
        };
        const decision = structuredClone(rows[0]!), action = structuredClone(outcome);
        if (failure === 'serialization') { Object.assign(decision, { circular: decision }); Object.assign(action, { circular: action }); }
        else { decision.explain.note = 'x'.repeat(140_000); action.currency = 'x'.repeat(140_000); }
        const result = family === 'decisions' ? await enqueueDecisions(env, [decision]) : await enqueueOutcome(env, action);
        expect(result).toMatchObject({ code: failure === 'serialization' ? 'serialization_failed' : 'oversized_record', prepared: false,
          records: counts(1), messages: counts(0) });
        expect(queueReads).toBe(0);
        if (flag === 'true' && failure === 'oversized') expect(captureConserved(result.capture!)).toMatchObject({ newlyStored: 1, unknown: 0, notAttempted: 0 });
        else { expect(result).not.toHaveProperty('capture'); expect(r2.store.size).toBe(0); }
      }
    }
    expect(JSON.stringify(diagnostic.mock.calls)).not.toMatch(/PRIVATE|v-config|coach|decision_id|outcome_id/);
  } finally { diagnostic.mockRestore(); }
});

it('W09.02 preserves grouped canonical storage across partial and regrouped retries without collapsing distinct deliveries', async () => {
  const r2 = new ManagedR2(), first = managedOutcome('v-retry'), second = managedOutcome('v-retry', T0 + 3_600_000);
  const put = r2.put.bind(r2); let writes = 0;
  const fault = vi.spyOn(r2, 'put').mockImplementation(async (key, body, options) => {
    if (managedKey(key) && ++writes === 2) throw new Error('synthetic partial write');
    return put(key, body, options);
  });
  const partial = await consumeLedger({ STORAGE: r2 as never }, [first, second]);
  expect(partial).toMatchObject({ ok: false, written: 1, capture: { newlyStored: 1, unknown: 1, notAttempted: 0 } });
  captureConserved(partial.capture!); fault.mockRestore();
  for (const messages of [[second, first], [first], [second, first, second]]) {
    const result = await consumeLedger({ STORAGE: r2 as never }, messages);
    expect(result.ok).toBe(true); captureConserved(result.capture!);
  }
  expect(r2.dataKeys()).toHaveLength(2); expect(r2.rows()).toHaveLength(2);
  for (const message of [first, second]) {
    const found = await findById<OutcomeRecord>(r2, message.record.outcome_id, 'outcome');
    expect(found?.record).toEqual({ ...message.record, [DELIVERY_FIELD]: { id: message.delivery_id, ordinal: 0 } });
  }
  const twin = { ...first, delivery_id: crypto.randomUUID() }, grouped = new ManagedR2();
  expect((await consumeLedger({ STORAGE: grouped as never }, [first, twin])).capture).toMatchObject({ newlyStored: 2 });
  expect(grouped.dataKeys()).toHaveLength(1); expect(grouped.rows()).toHaveLength(2);
  const again = await consumeLedger({ STORAGE: grouped as never }, [twin, first, first]);
  expect(captureConserved(again.capture!)).toMatchObject({ newlyStored: 0, alreadyPresent: 3 });
  expect(grouped.rows()).toHaveLength(2);
  for (const replacement of [managedOutcome('changed'), managedOutcome('v-retry', T0 + 3_600_000), managedOutcome('v-retry', T0, 'harbor')]) {
    const before = JSON.stringify([...grouped.store]);
    const conflict = await consumeLedger({ STORAGE: grouped as never }, [{ ...replacement, delivery_id: first.delivery_id }]);
    expect(conflict).toMatchObject({ ok: false, capture: { code: 'conflict', notAttempted: 1 } });
    expect(JSON.stringify([...grouped.store])).toBe(before);
  }
  const many = new ManagedR2(), messages = Array.from({ length: 101 }, (_, i) => managedOutcome(`v-${i}`, T0 + i));
  expect((await consumeLedger({ STORAGE: many as never }, messages)).written).toBe(101);
  expect(many.dataKeys()).toHaveLength(2);
  expect((await consumeLedger({ STORAGE: many as never }, [...messages].reverse())).capture).toMatchObject({ alreadyPresent: 101, newlyStored: 0 });
  expect(many.dataKeys()).toHaveLength(2); expect(many.rows()).toHaveLength(101);
  expect((await loadHourRecords(many, 'coach', '2026-11-27', 14)).objects).toBe(2);
  expect(await countDayObjects(many, 'coach', '2026-11-27')).toBe(2);
  await consumeLedger({ STORAGE: many as never }, [managedOutcome('v-date-tenant', T0, '2026-09-11')]);
  expect(await countDayObjects(many, 'ledger-delivery', '2026-09-11')).toBe(0);
  expect((await loadHourRecords(many, 'ledger-delivery', '2026-09-11', 14)).objects).toBe(0);
  expect([...many.store.keys()].filter(key => key.startsWith('ledger-delivery/')).every(key => key.startsWith('ledger-delivery/claims/') || key.startsWith('ledger-delivery/identities/'))).toBe(true);
});

it('W06.12 preserves full managed grouping and positions for byte-heavy100-message cohorts and indivisible fallback', async () => {
  const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  const r2 = new ManagedR2(), base = set('v-byte-cohort').records[0]!;
  const bodies = Array.from({ length: 100 }, (_, ordinal) => ({ kind: 'ledger', type: 'decisions', version: 1, delivery_id: crypto.randomUUID(),
    records: [{ ...structuredClone(base), decision_id: base.decision_id + '-byte-' + ordinal,
      explain: { ...base.explain, note: 'x'.repeat(100000) } }] }));
  expect(bodies.every(body => size(body) < LEDGER_BODY_BYTES)).toBe(true);
  expect(size(bodies)).toBeGreaterThan(8 * 1024 * 1024);
  const consumed = await consumeLedger({ STORAGE: r2 as never }, bodies);
  expect(consumed).toMatchObject({ ok: true, written: 100, skipped: 0, dispositions: bodies.map(() => 'ack'), capture: { newlyStored: 100, notAttempted: 0, unknown: 0 } });
  expect(r2.dataKeys()).toHaveLength(1); expect(r2.rows()).toHaveLength(100);
  const claims = [...r2.store].filter(([key]) => key.startsWith('ledger-delivery/'));
  expect(await consumeLedger({ STORAGE: r2 as never }, [...bodies].reverse())).toMatchObject({ ok: true, written: 0, capture: { alreadyPresent: 100, newlyStored: 0 } });
  expect([...r2.store].filter(([key]) => key.startsWith('ledger-delivery/'))).toEqual(claims); expect(r2.dataKeys()).toHaveLength(1);
  const fallback = new ManagedR2(), row = structuredClone(base); row.explain.note = 'x'.repeat(9 * 1024 * 1024);
  const result = await enqueueDecisions({ STORAGE: fallback as never, EVENT_QUEUE: undefined as never, ANALYTICS: undefined as never, LEDGER_RECOVERY_ENABLED: 'true' }, [row]);
  expect(result).toMatchObject({ code: 'oversized_record', capture: { ok: true, newlyStored: 1, unknown: 0, notAttempted: 0 } });
  expect(fallback.dataKeys()).toHaveLength(1); expect(fallback.rows()).toHaveLength(1);
  const physical = fallback.rows()[0] as Record<string, unknown>; delete physical[DELIVERY_FIELD]; expect(physical).toEqual(row);
}, 30000);

it('W09.02 producer fallback shares frozen identity with uncertain queue delivery and remains exactly default-off', async () => {
  const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const env = (r2: ManagedR2, queue?: unknown, flag?: string) => ({ STORAGE: r2 as never, EVENT_QUEUE: queue as never, ANALYTICS: undefined as never, LEDGER_RECOVERY_ENABLED: flag });
  try {
    for (const flag of [undefined, 'false', 'TRUE', '1']) {
      const r2 = new ManagedR2(), q = new FakeQueue();
      expect((await enqueueDecisions(env(r2, q, flag), set('v-legacy').records)).code).toBe('accepted');
      expect(q.sent[0]).not.toHaveProperty('delivery_id'); expect(r2.puts).toBe(0);
    }
    const r2 = new ManagedR2(), rows = Array.from({ length: 12 }, (_, i) => {
      const row = structuredClone(set(`v-managed-${i}`).records[0]!); row.explain.note = 'x'.repeat(70000); return row;
    }), original = structuredClone(rows), queued: unknown[] = [];
    let release!: () => void, calls = 0;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const queue = { send: vi.fn(), sendBatch: vi.fn(async (messages: Array<{ body: unknown; contentType: string }>) => {
      calls++; queued.push(...messages.map(message => message.body));
      expect(messages.every(message => message.contentType === 'json')).toBe(true);
      expect((await consumeLedger({ STORAGE: r2 as never }, messages.map(message => message.body))).ok).toBe(true);
      if (calls === 1) await gate;
      if (calls === 2) throw new Error('PRIVATE_ACCEPTED_THEN_REJECTED');
    }) };
    const pending = enqueueDecisions(env(r2, queue, 'true'), rows);
    rows.forEach(row => { row.explain.note = 'PRIVATE_CHANGED'; row.inputs!.affinity = {}; });
    release();
    const result = await pending;
    expect(result).toMatchObject({ code: 'queue_rejected', records: { total: 12, acknowledged: 3, unknown: 3, notAttempted: 6 },
      capture: { ok: true, total: 9, newlyStored: 6, alreadyPresent: 3, unknown: 0, notAttempted: 0 } });
    captureConserved(result.capture!); expect(queue.sendBatch).toHaveBeenCalledTimes(2); expect(queue.send).not.toHaveBeenCalled();
    expect(r2.rows()).toHaveLength(12); expect(r2.dataKeys()).toHaveLength(3);
    const unwrapped = r2.rows().map(row => { const original = { ...row }; delete original[DELIVERY_FIELD]; return original; });
    expect(unwrapped).toEqual(JSON.parse(JSON.stringify(original)));
    expect((await consumeLedger({ STORAGE: r2 as never }, queued)).capture).toMatchObject({ alreadyPresent: 6, newlyStored: 0 });
    expect(r2.rows()).toHaveLength(12);
    const missing = new ManagedR2(), outcome = managedOutcome('v-missing').record;
    expect((await enqueueOutcome(env(missing, undefined, 'true'), outcome)).capture).toMatchObject({ ok: true, newlyStored: 1 });
    const oversized = structuredClone(set('v-big').records[0]!); oversized.explain.note = 'é'.repeat(100000);
    const noQueue = new FakeQueue();
    expect((await enqueueDecisions(env(missing, noQueue, 'true'), [oversized])).capture).toMatchObject({ newlyStored: 1, ok: true });
    expect(noQueue.sent).toHaveLength(0);
    await writeTombstone(missing, 'coach', 'v-erased', 'actor', T0);
    const suppressed = await enqueueOutcome(env(missing, undefined, 'true'), managedOutcome('v-erased').record);
    expect(captureConserved(suppressed.capture!)).toMatchObject({ newlyStored: 0, suppressed: 1 });
    const malformed = Object.assign(structuredClone(oversized), { [DELIVERY_FIELD]: { id: crypto.randomUUID(), ordinal: 0 } });
    const before = missing.puts;
    expect((await enqueueDecisions(env(missing, noQueue, 'true'), [malformed])).code).toBe('serialization_failed');
    const cyclic = Object.assign(structuredClone(oversized), { cycle: {} }); cyclic.cycle = cyclic;
    expect((await enqueueDecisions(env(missing, noQueue, 'true'), [cyclic])).code).toBe('serialization_failed');
    expect(missing.puts).toBe(before);
    expect(JSON.stringify(diagnostic.mock.calls)).not.toMatch(/PRIVATE|v-managed|v-missing|v-erased|coach|delivery_id/);
    expect(diagnostic.mock.calls.some(([, summary]) => (summary as { captureOk?: number }).captureOk === 1)).toBe(true);
    diagnostic.mockImplementation(() => { throw new Error('PRIVATE_LOG'); });
    const unavailable = new ManagedR2(); unavailable.put = async () => { throw new Error('PRIVATE_STORAGE_429'); };
    await expect(enqueueOutcome(env(unavailable, undefined, 'true'), outcome)).resolves.toMatchObject({ capture: { ok: false, notAttempted: 1 } });
  } finally { diagnostic.mockRestore(); }
});

it('W06.12 preserves earlier cohort proof but classifies dispatched lost or malformed replies as unknown', async () => {
  const changes: Array<[string, (value: any) => void]> = [
    ['lost-response', () => { throw new Error('synthetic lost owner acknowledgement'); }],
    ['missing-capture', value => { delete value.capture; }],
    ['wrong-total', value => { value.capture.total++; }],
    ['negative', value => { value.capture.newlyStored = -1; value.capture.alreadyPresent = 2; }],
    ['nan', value => { value.capture.objects = NaN; }],
    ['malformed-position', value => { value.dispositions[0] = 'not-an-ack'; }],
    ['legacy-count', value => { value.written = 0; }],
  ];
  for (const [mode, change] of changes) {
    const r2 = new ManagedR2(), actual = ledgerFixtureEnvironment({ STORAGE: r2 as never });
    const namespace = actual.SHOPPER_REFLEX, env = Object.create(actual) as Env;
    let altered = false;
    Object.defineProperty(env, 'SHOPPER_REFLEX', { value: { idFromName: namespace.idFromName.bind(namespace), get: (id: DurableObjectId) => {
      const stub = namespace.get(id);
      return { fetch: async (url: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(url, init), input = await request.clone().json() as { index: number; operation: { bodies?: unknown[] } };
        const response = await stub.fetch(request);
        if (!altered && input.index === 0 && input.operation.bodies?.length === 1) {
          altered = true; const result = await response.json(); change(result); return Response.json(result);
        }
        return response;
      } };
    } } });
    const bodies: unknown[] = Array.from({ length: 9 }, (_, index) => managedOutcome('v-cohort-proof-' + index));
    if (mode === 'legacy-count') { const { delivery_id: _id, ...legacy } = bodies[8] as ReturnType<typeof managedOutcome>; bodies[8] = legacy; }
    const result = await consumeLedgerActual(env, bodies);
    expect(altered, mode).toBe(true);
    expect(result, mode).toMatchObject({ ok: false, written: 8, dispositions: [...Array(8).fill('ack'), 'retry'],
      capture: { total: mode === 'legacy-count' ? 8 : 9, newlyStored: 8, unknown: mode === 'legacy-count' ? 0 : 1, notAttempted: 0, ok: mode === 'legacy-count' } });
    captureConserved(result.capture!); expect(r2.rows()).toHaveLength(mode === 'legacy-count' ? 8 : 9);
    expect(await consumeLedgerActual(actual, bodies)).toMatchObject({ ok: true, capture: { newlyStored: 0, alreadyPresent: mode === 'legacy-count' ? 8 : 9 } });
  }
  const refused = new ManagedR2(); refused.put = async () => { throw new Error('synthetic preparation unavailable'); };
  expect(await consumeLedger({ STORAGE: refused as never }, Array.from({ length: 9 }, (_, i) => managedOutcome('v-unprepared-' + i))))
    .toMatchObject({ ok: false, written: 0, capture: { total: 9, unknown: 0, notAttempted: 9 } });
  for (const invalid of [{ dispositions: ['invalid'] }, { dispositions: new Array(1) }, { newlyStored: -1, alreadyPresent: 2 }, { objects: NaN }, { total: 2 }]) {
    const r2 = new ManagedR2(), fake = vi.spyOn(ledgerWriter, 'persistDeliveries').mockResolvedValue({ ok: true, code: 'captured', total: 1,
      newlyStored: 1, alreadyPresent: 0, suppressed: 0, unknown: 0, notAttempted: 0, objects: 1, dispositions: ['ack'], ...invalid } as never);
    const logs = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const result = await enqueueOutcome({ STORAGE: r2 as never, EVENT_QUEUE: undefined as never, ANALYTICS: undefined as never,
        LEDGER_RECOVERY_ENABLED: 'true' }, managedOutcome('v-fallback-proof').record);
      expect(result.capture).toMatchObject({ ok: false, newlyStored: 0, unknown: 1, notAttempted: 0 });
      captureConserved(result.capture!); expect(r2.rows()).toEqual([]);
    } finally { fake.mockRestore(); logs.mockRestore(); }
  }
});

it('W09.02 bounds failed capture and verifies conditional claims and appends against native in-memory R2', async () => {
  const message = managedOutcome('v-bounds'), delivery = readDelivery(message);
  const capped = new ManagedR2(), large = structuredClone(message); large.record.currency = 'x'.repeat(MANAGED_BYTES);
  expect(await persistDeliveries(capped, [readDelivery(large)])).toMatchObject({ ok: false, code: 'capture_limit', notAttempted: 1 });
  expect(capped.puts).toBe(0);
  for (const mode of ['null', 'throw', 'ack', 'committed-throw'] as const) {
    const r2 = new ManagedR2(), put = r2.put.bind(r2); let attempts = 0;
    const fault = vi.spyOn(r2, 'put').mockImplementation(async (key, body, options) => {
      if (!managedKey(key)) return put(key, body, options);
      attempts++;
      if (mode === 'null') return null;
      if (mode === 'committed-throw') await put(key, body, options);
      if (mode === 'ack') return undefined as never;
      throw new Error('synthetic storage failure');
    });
    const failed = captureConserved(await persistDeliveries(r2, [delivery]));
    expect(failed).toMatchObject({ ok: false, newlyStored: 0, unknown: mode === 'null' ? 0 : 1, notAttempted: mode === 'null' ? 1 : 0 });
    expect(attempts).toBe(mode === 'null' ? 4 : 1); fault.mockRestore();
    const retried = captureConserved(await persistDeliveries(r2, [delivery]));
    expect(retried).toMatchObject({ ok: true, alreadyPresent: mode === 'committed-throw' ? 1 : 0, newlyStored: mode === 'committed-throw' ? 0 : 1 });
    expect(r2.rows()).toHaveLength(1);
  }
  for (const mode of ['journal-undefined', 'journal-corrupt', 'claim-digest', 'claim-range', 'row-conflict', 'row-range', 'marker-missing'] as const) {
    const r2 = new ManagedR2(); await persistDeliveries(r2, [delivery]);
    const dataKey = r2.dataKeys()[0]!;
    if (mode === 'journal-undefined') {
      const get = r2.get.bind(r2); r2.get = async key => key === 'erasures/coach/rewrite.json' ? undefined as never : get(key);
    } else if (mode === 'journal-corrupt') r2.store.set('erasures/coach/rewrite.json', '{}');
    else if (mode.startsWith('claim-')) {
      const key = [...r2.store.keys()].find(key => key.startsWith('ledger-delivery/claims/'))!, claim = JSON.parse(r2.store.get(key)!);
      if (mode === 'claim-digest') claim.digest = '0'.repeat(64);
      else claim.key = claim.key.replace(/\/[0-9a-z]{9}-[0-9a-z]{9}-managed-/, '/000000000-000000001-managed-');
      r2.store.set(key, JSON.stringify(claim));
    } else if (mode === 'marker-missing') r2.metadata.delete(dataKey);
    else {
      const row = JSON.parse(r2.store.get(dataKey)!);
      if (mode === 'row-range') { row.ts++; row.outcome_id = `coach:${ts36(row.ts)}:v-bounds:purchase`; }
      else row.currency = 'CONFLICT';
      r2.store.set(dataKey, JSON.stringify(row) + '\n');
    }
    const before = r2.puts;
    expect((await persistDeliveries(r2, [delivery])).ok, mode).toBe(false); expect(r2.puts).toBe(before);
  }
  const runtime = new Miniflare({ cf: false, modules: true, script: 'export default { fetch() { return new Response("synthetic"); } };',
    compatibilityDate: '2025-06-01', r2Buckets: ['LEDGER'], outboundService() { throw new Error('No external network in W09.02'); } });
  try {
    const native = await runtime.getR2Bucket('LEDGER'), store = native as unknown as R2Like;
    const created = await native.put('conditional-smoke', 'one', { onlyIf: { etagDoesNotMatch: '*' } });
    expect(created?.etag).toBeTruthy();
    expect(await native.put('conditional-smoke', 'two', { onlyIf: { etagDoesNotMatch: '*' } })).toBeNull();
    expect(await native.put('conditional-smoke', 'two', { onlyIf: { etagMatches: 'stale' } })).toBeNull();
    expect((await native.put('conditional-smoke', '', { onlyIf: { etagMatches: created!.etag }, customMetadata: { [MANAGED_MARKER]: '1' } }))?.etag).toBeTruthy();
    expect((await native.get('conditional-smoke'))?.customMetadata).toEqual({ [MANAGED_MARKER]: '1' });
    const both = await Promise.all([persistDeliveries(store, [delivery]), persistDeliveries(store, [delivery])]);
    expect(both.every(result => result.ok)).toBe(true); both.forEach(captureConserved);
    expect(both.reduce((sum, result) => sum + result.newlyStored, 0)).toBe(1);
    expect(both.reduce((sum, result) => sum + result.alreadyPresent, 0)).toBe(1);
    expect((await native.list({ prefix: 'coach/' })).objects).toHaveLength(1);
    expect((await findById<OutcomeRecord>(store, message.record.outcome_id, 'outcome'))?.record).toMatchObject(message.record);
  } finally { await runtime.dispose(); }
}, 30000);

describe('consumer and lookup', () => {
  it('writes one range-named object per brand, hour and stream, and finds a record by id with no index', async () => {
    const r2 = new FakeR2();
    const a = set('v1', T0), b = set('v2', T0 + 60_000), c = set('v3', T0 + 3_600_000 * 2);   // two in one hour, one two hours later
    const outcome = outcomeFromAction({ type: 'add_to_cart', userId: 'v1', timestamp: T0 + 5_000, data: { productId: 'p1' } }, 'coach')!;
    const bodies = [
      ...a.records.map((record) => ({ kind: 'ledger', type: 'decision', record })),
      ...b.records.map((record) => ({ kind: 'ledger', type: 'decision', record })),
      ...c.records.map((record) => ({ kind: 'ledger', type: 'decision', record })),
      { kind: 'ledger', type: 'outcome', record: outcome },
      { kind: 'scene', productId: 'x' },            // not ours: skipped, never written
      { kind: 'ledger', type: 'decision', record: { decision_id: 'no-time-in-this-id' } },
      'garbage',
    ];
    const res = await consumeLedger({ STORAGE: r2 as never }, bodies, T0 + 10_000);
    expect(res).toMatchObject({ ok: false, written: 10, objects: 3, skipped: 3,
      dispositions: [...Array.from({ length: 10 }, () => 'ack'), 'retry', 'retry', 'retry'] });
    const keys = [...r2.store.keys()].sort();
    expect(keys.filter((k) => k.startsWith('coach/2026-11-27/14/decision/'))).toHaveLength(1);
    expect(keys.filter((k) => k.startsWith('coach/2026-11-27/16/decision/'))).toHaveLength(1);
    expect(keys.filter((k) => k.startsWith('coach/2026-11-27/14/outcome/'))).toHaveLength(1);
    const hourObj = keys.find((k) => k.startsWith('coach/2026-11-27/14/decision/'))!;
    expect(hourObj).toMatch(new RegExp(`/${ts36(T0)}-${ts36(T0 + 60_000)}-`));   // named by its id range
    expect(r2.store.get(hourObj)!.trim().split('\n')).toHaveLength(6);

    const target = b.records[2]!;
    expect(await candidateKeys(r2, 'coach', T0 + 60_000, 'decision')).toEqual([hourObj]);
    const found = await findById<DecisionRecord>(r2, target.decision_id, 'decision');
    expect(found?.key).toBe(hourObj);
    expect(found?.record).toEqual(target);
    const o = await findById<OutcomeRecord>(r2, outcome.outcome_id, 'outcome');
    expect(o?.record).toEqual(outcome);
    expect(await findById(r2, `coach:${ts36(T0 + 999_999_999)}:nobody:home:hero:0`, 'decision')).toBeNull();
    expect(isLedgerMessage({ kind: 'ledger', type: 'decision', record: { decision_id: 'x' } })).toBe(false);
  });

  it('an R2 failure reports not ok, so the caller can retry the admitted cohort', async () => {
    const r2 = new FakeR2(); r2.put = async () => { throw new Error('R2 unavailable'); };
    const res = await consumeLedger({ STORAGE: r2 as never }, set('v1').records.map((record) => ({ kind: 'ledger', type: 'decision', record })));
    expect(res.ok).toBe(false); expect(res.error).toContain('storage');
    expect(await writeBatches(new FakeR2(), [], 'b')).toEqual([]);
  });

  it('suppresses delayed decisions/outcomes before and after scan completion, keeping post-cutoff and other-visitor rows in two tenants', async () => {
    const message = (tenant: string, visitor: string, ts: number, outcome = false) => outcome
      ? { kind: 'ledger', type: 'outcome', record: outcomeFromAction({ type: 'content_click', userId: visitor, timestamp: ts }, tenant)! }
      : { kind: 'ledger', type: 'decision', record: { ...set(visitor, ts).records[0]!, tenant, retention: stamped(tenant, ts), decision_id: set(visitor, ts).records[0]!.decision_id.replace(/^coach:/, tenant + ':') } };
    for (const completed of [false, true]) {
      const r2 = new FakeR2();
      for (const tenant of ['meridian', 'harbor']) {
        await writeTombstone(r2, tenant, 'v-erased', 'actor', T0);
        if (completed) await rewriteErasures(r2, tenant, { now: T0 + 86_400_000, retentionDays: 1 });
      }
      const list = vi.spyOn(r2, 'list'), before = r2.puts;
      const bodies = ['meridian', 'harbor'].flatMap(tenant => [message(tenant, 'v-erased', T0 - 1), message(tenant, 'v-erased', T0, true),
        message(tenant, 'v-erased', T0 + 1), message(tenant, 'v-other', T0 - 1, true)]);
      const TENANTS = JSON.stringify({ provisioned: ['meridian', 'harbor'] });
      const res = await consumeLedger({ STORAGE: r2 as never, TENANTS }, bodies, T0 + 100);
      expect(res).toMatchObject({ ok: true, written: 4, suppressed: 4, skipped: 0, objects: 4 });
      expect(r2.puts - before).toBe(4);
      expect(list.mock.calls.map(([opts]) => opts.prefix).sort()).toEqual([pendingPrefix('harbor'), pendingPrefix('meridian')]);
      for (const tenant of ['meridian', 'harbor']) {
        const rows = [...r2.store].filter(([k]) => k.startsWith(tenant + '/')).flatMap(([, body]) => body.trim().split('\n').map(line => JSON.parse(line)));
        expect(rows.map(r => [r.visitor_id, r.ts]).sort()).toEqual([['v-erased', T0 + 1], ['v-other', T0 - 1]]);
      }
      const puts = r2.puts;
      expect(await consumeLedger({ STORAGE: r2 as never, TENANTS }, [bodies[0], bodies[1]])).toMatchObject({ ok: true, written: 0, objects: 0, suppressed: 2 });
      expect(r2.puts).toBe(puts);
      // A barrier for the same visitor in one tenant never suppresses another tenant.
      const isolated = new FakeR2(); await writeTombstone(isolated, 'meridian', 'v-erased', 'actor', T0);
      const separate = await consumeLedger({ STORAGE: isolated as never, TENANTS }, [message('meridian', 'v-erased', T0), message('harbor', 'v-erased', T0)]);
      expect(separate).toMatchObject({ written: 1, suppressed: 1 });
      expect([...isolated.store.keys()].filter(k => k.startsWith('harbor/'))).toHaveLength(1);
    }
  });

  it('fails the entire batch before writes on missing/corrupt/read-failed barriers, including an incomplete listing', async () => {
    for (const failure of ['missing', 'corrupt', 'wrong-tenant', 'wrong-key', 'read', 'list', 'truncated']) {
      const r2 = new FakeR2(), key = tombstoneKey('coach', 'v1'); await writeTombstone(r2, 'coach', 'v1', 'actor', T0);
      if (failure === 'missing') r2.get = async () => null;
      if (failure === 'corrupt') r2.store.set(key, 'null');
      if (failure === 'wrong-tenant' || failure === 'wrong-key') r2.store.set(key, JSON.stringify({ ...JSON.parse(r2.store.get(key)!), [failure === 'wrong-tenant' ? 'tenant' : 'visitor_id']: 'other' }));
      if (failure === 'read') r2.get = async () => { throw new Error('synthetic read failure'); };
      if (failure === 'list') r2.list = async () => { throw new Error('synthetic list failure'); };
      if (failure === 'truncated') r2.list = async () => ({ objects: [], truncated: true });
      const puts = r2.puts;
      expect(await consumeLedger({ STORAGE: r2 as never }, [{ kind: 'ledger', type: 'decisions', records: set('v-other').records }])).toMatchObject({ ok: false, written: 0, objects: 0, suppressed: 0 });
      expect(r2.puts).toBe(puts); await expect(loadTombstones(r2, 'coach')).rejects.toThrow();
    }
  });

  it('rejects mismatched tenant/time/visitor carriers and malformed subjects for singles, sets and direct batching', async () => {
    const valid = set('v1').records[0]!;
    const bad = [{ ...valid, tenant: 'harbor' }, { ...valid, ts: T0 + 1 }, { ...valid, ts: T0 + 0.5 },
      { ...valid, visitor_id: 'other' }, { ...valid, visitor_id: '' }, { ...valid, visitor_id: 'v'.repeat(201) },
      { ...valid, visitor_id: 'bad/visitor' }, { ...valid, ts: -1 }, { ...valid, ts: Number.MAX_SAFE_INTEGER + 1 }];
    const messages = bad.map(record => ({ kind: 'ledger' as const, type: 'decision' as const, record }));
    for (const message of messages) expect(isLedgerMessage(message)).toBe(false);
    expect(expandLedgerMessage({ kind: 'ledger', type: 'decisions', records: [...bad, valid] })).toEqual([]);
    const r2 = new FakeR2(); expect(await consumeLedger({ STORAGE: r2 as never }, messages)).toMatchObject({ written: 0, suppressed: 0, skipped: bad.length, ok: false,
      dispositions: bad.map(() => 'retry') });
    expect(await writeBatches(r2, messages, 'invalid')).toEqual([]); expect(r2.puts).toBe(0);
    const outcome = outcomeFromAction({ type: 'purchase', userId: 'v1', timestamp: T0 }, 'coach')!;
    for (const record of [{ ...outcome, tenant: 'harbor' }, { ...outcome, ts: T0 + 1 }, { ...outcome, visitor_id: 'v2' }]) {
      expect(isLedgerMessage({ kind: 'ledger', type: 'outcome', record })).toBe(false);
    }
  });
});

it('W09.03 rejects whole malformed envelopes, isolates valid siblings and preserves conservative grouped capture dispositions', async () => {
  const rows = set('v-legacy').records;
  const legacy = { kind: 'ledger', type: 'decisions', records: rows };
  const singleton = { kind: 'ledger', version: 1, type: 'decision', record: set('v-single').records[0]! };
  const outcome = { kind: 'ledger', version: 1, type: 'outcome', record: outcomeFromAction({ type: 'purchase', userId: 'v-outcome', timestamp: T0 }, 'coach')! };
  const managed = managedOutcome('v-managed');
  const rejected = [
    { ...legacy, records: [rows[0], { ...rows[1], decision_id: 'unplaceable' }] },
    { ...legacy, records: [] }, { ...legacy, records: null },
    { ...legacy, version: 2 }, { ...legacy, version: undefined },
    ...[null, undefined, '', 'bad-uuid'].map(delivery_id => ({ ...managed, delivery_id })),
    { ...managed, version: 2 },
    { ...singleton, record: { ...singleton.record, [DELIVERY_FIELD]: { id: managed.delivery_id, ordinal: 0 } } },
    { ...legacy, records: [{ ...rows[0], [DELIVERY_FIELD]: { id: managed.delivery_id, ordinal: 0 } }] },
    { ...legacy, records: Object.assign(new Array(2), { 0: rows[0] }) }, null,
  ];
  const r2 = new ManagedR2(), bodies = [rejected[0], legacy, rejected[2], singleton, rejected[6], managed, outcome, ...rejected.slice(3, 6), rejected[1], ...rejected.slice(7)];
  const expected = bodies.map(body => [legacy, singleton, managed, outcome].includes(body as typeof legacy) ? 'ack' : 'retry');
  const result = await consumeLedger({ STORAGE: r2 as never }, bodies);
  expect(result).toMatchObject({ ok: false, written: rows.length + 3, objects: 3, skipped: rejected.length, dispositions: expected });
  const canonicalRows = [...r2.store].filter(([key]) => key.startsWith('coach/')).flatMap(([, body]) => body.split('\n').filter(Boolean).map(line => JSON.parse(line)));
  expect(canonicalRows).toHaveLength(rows.length + 3);
  expect(canonicalRows.filter(row => row.visitor_id === 'v-legacy')).toEqual(rows);
  expect(r2.rows()).toHaveLength(1);
  const beforeRetry = r2.rows();
  expect(await consumeLedger({ STORAGE: r2 as never }, [managed])).toMatchObject({ ok: true, written: 0, dispositions: ['ack'], capture: { alreadyPresent: 1 } });
  expect(r2.rows()).toEqual(beforeRetry);
  expect(await consumeLedger({ STORAGE: r2 as never }, [])).toMatchObject({ ok: true, dispositions: [] });

  // Definite erasure suppression is successful handling, including managed input.
  const erased = new ManagedR2();
  for (const visitor of ['v-legacy', 'v-single', 'v-outcome', 'v-managed']) await writeTombstone(erased, 'coach', visitor, 'synthetic-ops', T0);
  const suppressed = await consumeLedger({ STORAGE: erased as never }, [legacy, managed, singleton, outcome, rejected[0]]);
  expect(suppressed).toMatchObject({ ok: false, written: 0, suppressed: rows.length + 3, skipped: 1, dispositions: ['ack', 'ack', 'ack', 'ack', 'retry'] });
  expect([...erased.store.keys()].filter(key => key.startsWith('coach/'))).toEqual([]);

  // A barrier failure starts no puts. Parsing failure alone is not a cohort failure.
  const unavailable = new ManagedR2();
  unavailable.list = async () => { throw new Error('private barrier failure'); };
  expect(await consumeLedger({ STORAGE: unavailable as never }, [rejected[0], legacy, managed])).toMatchObject({ ok: false, skipped: 1, dispositions: ['retry', 'retry', 'retry'] });
  expect(unavailable.puts).toBe(0);
  const invalidOnly = new ManagedR2();
  const invalidGet = vi.spyOn(invalidOnly, 'get'), invalidList = vi.spyOn(invalidOnly, 'list');
  expect(await consumeLedger({ STORAGE: invalidOnly as never }, rejected)).toMatchObject({ ok: false, skipped: rejected.length, dispositions: rejected.map(() => 'retry') });
  expect(invalidGet).not.toHaveBeenCalled(); expect(invalidList).not.toHaveBeenCalled(); expect(invalidOnly.puts).toBe(0);

  // Explicit managed completion survives an independent legacy storage failure.
  const partial = new ManagedR2(), put = partial.put.bind(partial);
  partial.put = async (key, body, options) => {
    if (key.includes('/decision/')) throw new Error('private storage failure');
    return put(key, body, options);
  };
  const failed = await consumeLedger({ STORAGE: partial as never }, [managed, legacy, rejected[0]]);
  expect(failed).toMatchObject({ ok: false, written: 1, skipped: 1, dispositions: ['ack', 'retry', 'retry'], capture: { newlyStored: 1 } });
  expect(partial.rows()).toHaveLength(1);
  expect(JSON.stringify(failed)).not.toContain('private');
  const conflict = { ...managed, record: { ...managed.record, event: 'changed' } };
  expect(await consumeLedger({ STORAGE: r2 as never }, [singleton, conflict])).toMatchObject({ ok: false, skipped: 0, dispositions: ['ack', 'retry'], capture: { code: 'conflict' } });
  expect(r2.rows()).toEqual(beforeRetry);
});

it('W09.07 isolates exact managed delivery completion while preserving grouped storage, erasure barriers and independent legacy persistence', async () => {
  const legacy = { kind: 'ledger', type: 'decisions', records: [set('v-independent-legacy').records[0]!] };
  for (const mode of ['commitment', 'claim'] as const) {
    const r2 = new ManagedR2(), original = managedOutcome('v-poison'), poisoned = structuredClone(original);
    expect((await consumeLedger({ STORAGE: r2 as never }, [original])).dispositions).toEqual(['ack']);
    if (mode === 'commitment') poisoned.record.currency = 'different-payload';
    else {
      const path = [...r2.store.keys()].find(key => key.startsWith('ledger-delivery/claims/'))!;
      r2.store.set(path, JSON.stringify({ ...JSON.parse(r2.store.get(path)!), digest: '0'.repeat(64) }));
    }
    const first = managedOutcome('v-healthy-first'), second = managedOutcome('v-healthy-second'), before = r2.rows();
    const result = await consumeLedger({ STORAGE: r2 as never }, [poisoned, first, legacy, second]);
    expect(result).toMatchObject({ ok: false, written: 3, objects: 2, skipped: 0, dispositions: ['retry', 'ack', 'ack', 'ack'],
      capture: { code: 'conflict', total: 3, newlyStored: 2, notAttempted: 1, dispositions: ['retry', 'ack', 'ack'] } });
    captureConserved(result.capture!);
    expect(r2.rows()).toEqual([...before, expect.objectContaining(first.record), expect.objectContaining(second.record)]);
    expect(r2.dataKeys()).toHaveLength(2); // Both healthy new deliveries share one new object.
    expect([...r2.store.keys()].filter(key => key.includes('/decision/'))).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/v-poison|v-healthy|delivery_id|different-payload/);
  }

  // All conflicting occurrences refuse before either identity is committed.
  const collisions = new ManagedR2(), first = managedOutcome('v-same-id'), changed = structuredClone(first), healthy = managedOutcome('v-clean-id');
  changed.record.currency = 'changed';
  const collided = await consumeLedger({ STORAGE: collisions as never }, [first, healthy, changed, first, healthy]);
  expect(collided).toMatchObject({ ok: false, dispositions: ['retry', 'ack', 'retry', 'retry', 'ack'],
    capture: { total: 5, newlyStored: 1, alreadyPresent: 1, notAttempted: 3, code: 'conflict' } });
  captureConserved(collided.capture!); expect(collisions.rows()).toHaveLength(1); expect(collisions.dataKeys()).toHaveLength(1);
  expect([...collisions.store.keys()].some(key => key.includes(first.delivery_id))).toBe(false);

  // A delivery spans two hours; duplicate input positions share physical writes.
  // Failure of the first key must still let later independent destinations finish.
  for (const mode of ['first-key', 'second-key', 'lost-ack'] as const) {
    const r2 = new ManagedR2(), multi = { kind: 'ledger' as const, type: 'decisions' as const, version: 1 as const,
      delivery_id: crypto.randomUUID(), records: [set('v-multi', T0).records[0]!, set('v-multi', T0 + 3_600_000).records[0]!] };
    const independent = managedOutcome('v-later-independent', T0 + 7_200_000), put = r2.put.bind(r2);
    const failedPrefix = `${hourPrefix('coach', T0 + (mode === 'second-key' ? 3_600_000 : 0))}/decision/`;
    let failures = 0;
    const fault = vi.spyOn(r2, 'put').mockImplementation(async (key, body, options) => {
      if (managedKey(key) && key.startsWith(failedPrefix)) {
        failures++;
        if (mode === 'lost-ack') await put(key, body, options);
        throw new Error('PRIVATE storage acknowledgement lost');
      }
      return put(key, body, options);
    });
    const partial = await consumeLedger({ STORAGE: r2 as never }, [multi, independent, multi]);
    expect(partial).toMatchObject({ ok: false, written: 2, objects: 2, dispositions: ['retry', 'ack', 'retry'],
      capture: { total: 5, newlyStored: 2, alreadyPresent: 1, unknown: 2, notAttempted: 0, code: 'storage_unavailable' } });
    captureConserved(partial.capture!); expect(failures).toBe(1);
    expect(r2.rows()).toHaveLength(mode === 'lost-ack' ? 3 : 2);
    const claims = [...r2.store].filter(([key]) => key.startsWith('ledger-delivery/claims/'));
    expect(JSON.stringify(partial)).not.toContain('PRIVATE'); fault.mockRestore();
    const retried = await consumeLedger({ STORAGE: r2 as never }, [multi, multi]);
    expect(retried).toMatchObject({ ok: true, dispositions: ['ack', 'ack'], capture: { total: 4,
      newlyStored: mode === 'lost-ack' ? 0 : 1, alreadyPresent: mode === 'lost-ack' ? 4 : 3, unknown: 0, notAttempted: 0 } });
    captureConserved(retried.capture!); expect(r2.rows()).toHaveLength(3); expect(r2.dataKeys()).toHaveLength(3);
    expect([...r2.store].filter(([key]) => key.startsWith('ledger-delivery/claims/'))).toEqual(claims);
  }

  // Same-key uncertainty keeps both co-resident deliveries retrying without rerouting.
  const shared = new ManagedR2(), sharedInputs = [managedOutcome('v-shared-a'), managedOutcome('v-shared-b')];
  const put = shared.put.bind(shared);
  const failing = vi.spyOn(shared, 'put').mockImplementation(async (key, body, options) => {
    if (managedKey(key)) throw new Error('PRIVATE shared key');
    return put(key, body, options);
  });
  const sharedFailure = await consumeLedger({ STORAGE: shared as never }, sharedInputs);
  expect(sharedFailure).toMatchObject({ dispositions: ['retry', 'retry'], capture: { unknown: 2, notAttempted: 0 } });
  captureConserved(sharedFailure.capture!); failing.mockRestore();
  expect((await consumeLedger({ STORAGE: shared as never }, sharedInputs.reverse())).dispositions).toEqual(['ack', 'ack']);
  expect(shared.rows()).toHaveLength(2); expect(shared.dataKeys()).toHaveLength(1);

  // Missing, mis-sized or malformed internal proof cannot acknowledge a managed input.
  for (const proof of [undefined, [], ['ack', 'ack'], ['invalid'], new Array(1)]) {
    const r2 = new ManagedR2();
    const fake = vi.spyOn(ledgerWriter, 'persistDeliveries').mockResolvedValue({ ok: true, total: 1, newlyStored: 0,
      alreadyPresent: 1, suppressed: 0, unknown: 0, notAttempted: 0, objects: 0, code: 'captured', dispositions: proof } as never);
    try {
      expect(await consumeLedger({ STORAGE: r2 as never }, [managedOutcome('v-proof'), legacy])).toMatchObject({
        ok: false, dispositions: ['retry', 'ack'], error: 'Managed ledger capture unavailable' });
      expect([...r2.store.keys()].filter(key => key.includes('/decision/'))).toHaveLength(1);
    } finally { fake.mockRestore(); }
  }
});

describe('one message per decision set (doc 31)', () => {
  it('the producer sends the set as one message and the consumer expands it into its records', async () => {
    const q = new FakeQueue(), ae = new FakeAE();
    const out = set('v-set');
    await enqueueDecisions({ EVENT_QUEUE: q as never, ANALYTICS: ae as never }, out.records);
    expect(q.sent).toHaveLength(1);
    const m = q.sent[0] as { kind: string; type: string; records: unknown[] };
    expect([m.kind, m.type, m.records.length]).toEqual(['ledger', 'decisions', out.records.length]);
    const expanded = expandLedgerMessage(m);
    expect(expanded.map((x) => x.type)).toEqual(out.records.map(() => 'decision'));
    expect(expandLedgerMessage({ kind: 'ledger', type: 'decisions', records: [{ nope: true }] })).toEqual([]);
    expect(expandLedgerMessage({ kind: 'ledger', type: 'outcome', record: outcomeFromAction({ type: 'content_click', userId: 'v', timestamp: 5, data: { contentId: 'a' } }, 'coach') })).toHaveLength(1);
    // The consumer writes the set's records as one object per hour and stream.
    const r2 = new FakeR2();
    const res = await consumeLedger({ STORAGE: r2 as never }, [m], 1);
    expect([res.written, res.objects, res.skipped, res.ok]).toEqual([out.records.length, 1, 0, true]);
  });
});

it('W22.03 reconciles every bounded lookup candidate before audited ledger or replay disclosure', async () => {
  const row = set('v-lookup').records[0]!, id = row.decision_id;
  const prefix = (stream = 'decision') => `${hourPrefix('coach', T0)}/${stream}/`;
  const key = (n: number, stream = 'decision', at = T0) => `${prefix(stream)}${ts36(at)}-${ts36(at)}-${n}.ndjson`;
  const fixture = (rows: unknown[], stream = 'decision') => {
    const r2 = new FakeR2(); rows.forEach((r, n) => r2.store.set(key(n, stream), JSON.stringify(r) + '\n')); return r2;
  };
  const provenance = (ordinal = 0) => ({ id: crypto.randomUUID(), ordinal });
  const read = (r2: R2Like, target = id, stream: 'decision' | 'outcome' | 'product-sort' = 'decision') => findById(r2, target, stream);
  const refuses = async (r2: FakeR2, target = id, stream: 'decision' | 'outcome' | 'product-sort' = 'decision') => {
    const saved = [...r2.store], puts = r2.puts;
    await expect(read(r2, target, stream)).rejects.toThrow(); expect([...r2.store]).toEqual(saved); expect(r2.puts).toBe(puts);
  };
  const reordered = Object.fromEntries(Object.entries(row).reverse());
  const retries = fixture([row, { ...reordered, _ledger_delivery: provenance() }, { ...row, _ledger_delivery: provenance(1) }]);
  expect(await read(retries)).toEqual({ key: key(0), record: row }); expect(retries.puts).toBe(0);
  expect(await read(retries, id + '-absent')).toBeNull(); expect(await read(new FakeR2())).toBeNull();
  expect(await read(new FakeR2(), 'invalid')).toBeNull();
  for (const changed of [{ ...row, arm: 'default' }, { ...row, explain: { ...row.explain, extra: true } },
    { ...row, candidates: [] }, { ...row, inputs: { ...row.inputs, extra: { _ledger_delivery: provenance() } } },
    { ...row, _ledger_delivery: { id: 'invalid', ordinal: 0 } }, { ...row, _ledger_delivery: { ...provenance(), extra: true } },
    { ...row, tenant: 'harbor' }, { ...row, visitor_id: 'another' }, { ...row, ts: T0 + 1 }, null, [], 42]) {
    // A valid first record must not hide a later conflict or invalid nonmatching row.
    await refuses(fixture([row, changed]));
  }
  const withArrays = { ...row, extra: [{ a: 1, b: [2, 3] }] };
  expect((await read(fixture([withArrays, { ...withArrays, extra: [{ b: [2, 3], a: 1 }] }])))?.record).toEqual(withArrays);
  await refuses(fixture([withArrays, { ...withArrays, extra: [{ a: 1, b: [3, 2] }] }]));
  const legacy = outcomeFromAction({ type: 'purchase', userId: 'v-lookup', timestamp: T0 }, 'coach')!;
  expect((await read(fixture([legacy], 'outcome'), legacy.outcome_id, 'outcome'))?.record).toEqual(legacy);
  await refuses(fixture([legacy, legacy], 'outcome'), legacy.outcome_id, 'outcome');
  await refuses(fixture([{ ...legacy, _ledger_delivery: provenance() }, { ...legacy, _ledger_delivery: provenance() }], 'outcome'), legacy.outcome_id, 'outcome');
  const event = outcomeFromAction({ type: 'purchase', userId: 'v-lookup', timestamp: T0, eventId: 'lookup-event' }, 'coach')!;
  const events = fixture([event, { ...event, _ledger_delivery: provenance() },
    outcomeFromAction({ type: 'purchase', userId: 'v-lookup', timestamp: T0, eventId: 'distinct-event' }, 'coach')!], 'outcome');
  expect((await read(events, event.outcome_id, 'outcome'))?.record).toEqual(event);
  for (const changed of [{ ...event, value: 1 }, { ...event, event_id: undefined }, { ...event, event_id_source: 'bad' },
    { ...event, outcome_id: event.outcome_id + '-different' }, { ...event, type: 'click' }]) await refuses(fixture([event, changed], 'outcome'), event.outcome_id, 'outcome');

  const echo = fixture([legacy], 'outcome'), echoGet = vi.spyOn(echo, 'get');
  let pages = 0;
  echo.list = async () => ++pages === 1 ? { objects: [{ key: key(0, 'outcome') }], truncated: true, cursor: 'next' }
    : { objects: [{ key: key(0, 'outcome') }], truncated: false };
  expect((await read(echo, legacy.outcome_id, 'outcome'))?.record).toEqual(legacy); expect(echoGet).toHaveBeenCalledOnce(); expect(pages).toBe(2);
  for (const page of [null, { objects: null, truncated: false }, { objects: [], truncated: 'false' },
    { objects: [null], truncated: false }, { objects: [{ key: 3 }], truncated: false },
    { objects: [{ key: key(0) }], truncated: true }, { objects: [], truncated: true, cursor: '' },
    { objects: [], truncated: false, cursor: 1 }, { objects: [], truncated: true, cursor: 'x'.repeat(2049) }]) {
    const r2 = fixture([row]); r2.list = async () => page as never; await refuses(r2);
  }
  const cyclic = fixture([row]); let cycles = 0;
  cyclic.list = async () => { cycles++; return { objects: [{ key: key(0) }], truncated: true, cursor: 'same' }; };
  await refuses(cyclic); expect(cycles).toBe(2);
  for (const badKey of [`${prefix()}legacy.ndjson`, key(0).replace('coach/', 'harbor/'), key(0).replace('/decision/', '/outcome/'),
    `${prefix()}${ts36(T0 + 1)}-${ts36(T0)}-reverse.ndjson`, key(0, 'decision', T0 + 3_600_000), `${prefix()}${'x'.repeat(2048)}`]) {
    const r2 = fixture([row]); r2.list = async () => ({ objects: [{ key: key(0) }, { key: badKey }], truncated: false }); await refuses(r2);
  }
  for (const bad of ['{bad-json', 'null', '[]', '42']) {
    const r2 = fixture([row, row]); r2.store.set(key(1), bad); await refuses(r2);
  }
  const missing = fixture([row]), originalGet = missing.get.bind(missing);
  missing.list = async () => ({ objects: [{ key: key(0) }, { key: key(1) }], truncated: false });
  await refuses(missing); missing.store.set(key(1), JSON.stringify(row)); expect((await read(missing))?.record).toEqual(row);
  missing.get = async name => name === key(1) ? { text: async () => 42 as never } : originalGet(name); await refuses(missing);
  missing.get = async name => { if (name === key(1)) throw new Error('PRIVATE_INPUT'); return originalGet(name); }; await refuses(missing);
  const elsewhere = fixture([row]); elsewhere.store.set(key(1), JSON.stringify(set('other', T0 + 1).records[0]));
  await refuses(elsewhere);

  const objects = fixture([]);
  for (let n = 0; n < 800; n++) objects.store.set(key(n), '');
  expect(await read(objects)).toBeNull(); objects.store.set(key(800), ''); await refuses(objects);
  const metadata = fixture([row]), outside = key(1, 'decision', T0 + 1), longKey = outside.replace('-1.ndjson', '-' + 'é'.repeat(980) + '.ndjson');
  metadata.list = async () => ({ objects: Array.from({ length: 600 }, () => ({ key: longKey })), truncated: false }); await refuses(metadata);
  const rowWork = fixture([row]); rowWork.store.set(key(0), '\n'.repeat(1_000_000)); await refuses(rowWork);
  const wide = { ...row, extra: Array(1_000_001).fill(0) }; await refuses(fixture([wide, wide]));
  const exact = fixture([row]); exact.store.set(key(0), JSON.stringify(row).padEnd(MANAGED_BYTES, ' '));
  expect((await read(exact))?.record).toEqual(row);
  const large = fixture([row, row]); large.store.set(key(1), 'é'.repeat(MANAGED_BYTES / 2 + 1)); await refuses(large);
  const total = fixture([row, row]); total.store.set(key(0), JSON.stringify(row).padEnd(MANAGED_BYTES / 2, ' '));
  const unread = vi.fn(async () => JSON.stringify(row)), totalGet = total.get.bind(total);
  total.get = async name => name === key(1) ? { text: unread, size: MANAGED_BYTES / 2 + 1 } : totalGet(name);
  await refuses(total); expect(unread).not.toHaveBeenCalled();
  for (const failure of ['size', 'stream', 'utf8', 'negative-size']) {
    const r2 = fixture([row, row]), get = r2.get.bind(r2), cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(c) {
      if (failure === 'stream') { c.enqueue(new Uint8Array(MANAGED_BYTES)); c.enqueue(new Uint8Array(1)); }
      if (failure === 'utf8') c.enqueue(new Uint8Array([255]));
    }, cancel });
    r2.get = async name => name === key(1) ? { text: unread, body,
      ...(failure === 'size' ? { size: MANAGED_BYTES + 1 } : failure === 'negative-size' ? { size: -1 } : {}) } : get(name);
    await refuses(r2); expect(cancel).toHaveBeenCalledOnce(); expect(body.locked).toBe(false); expect(unread).not.toHaveBeenCalled();
  }
  const pending = fixture([row]);
  let entered!: () => void, release!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const blockedBody = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([255])); },
    async cancel() { entered(); await gate; } });
  pending.get = async () => ({ body: blockedBody, text: unread });
  let returned = false;
  const refusing = read(pending).catch(() => { returned = true; });
  await reached; expect(returned).toBe(false); release(); await refusing; expect(blockedBody.locked).toBe(false);

  const product: ProductSortRecord = { version: 1, request_id: crypto.randomUUID(), record_id: '', tenant: 'coach', visitor_id: 'v-lookup', session_id: 's', ts: T0,
    configVersion: 'v1', mode: 'sort', consent: { tracking: true, personalization: true }, weights: { affinity: 1, dims: {} }, affinityWeight: 1,
    order: [], items: [], inputCount: 0, dropped: 0, filteredCount: 0, eligibleCount: 0, returnedCount: 0, limit: null, intent: null };
  product.record_id = `coach:${ts36(T0)}:v-lookup:product-sort:${product.request_id}`;
  expect((await read(fixture([product, product], 'product-sort'), product.record_id, 'product-sort'))?.record).toEqual(product);
  await refuses(fixture([product, { ...product, configVersion: 'v2' }], 'product-sort'), product.record_id, 'product-sort');
  await refuses(fixture([product, { ...product, version: 2 }], 'product-sort'), product.record_id, 'product-sort');

  const f = await operatorHistoryFixture(), served = f.row('meridian', 'private-lookup-subject', Date.now() - 1000);
  await writeBatches(f.storage, [{ kind: 'ledger', type: 'decision', record: served }], 'first');
  await writeBatches(f.storage, [{ kind: 'ledger', type: 'decision', record: { ...served, explain: { ...served.explain, score_final: 42 } } }], 'later');
  const paths = ['ledger/' + served.decision_id, 'replay/' + served.decision_id], baseline = f.snapshot();
  const cache = { get: vi.fn(), put: vi.fn() }; f.env.CACHE = cache as unknown as KVNamespace;
  f.storage.put.mockClear(); f.storage.delete.mockClear(); f.storage.get.mockClear();
  for (const path of paths) {
    const before = f.accounts.log.length, response = await f.request('meridian', path);
    expect(response.status).toBe(503); expect(response.headers.get('cache-control')).toBe('no-store');
    const answer = await response.text(); expect(answer).not.toContain(served.visitor_id); expect(answer).not.toContain('score_final');
    const pair = f.accounts.log.slice(before).map(entry => JSON.parse(entry.detail!) as SubjectAuditDetail);
    expect(pair).toHaveLength(2); expect(pair[0]!.phase).toBe('admitted'); expect(pair[1]).toMatchObject({ phase: 'result', status: 503 });
    expect(pair[1]!.subjectRef).toBeUndefined();
  }
  expect(f.storage.get.mock.calls.every(([name]) => name.endsWith('.ndjson'))).toBe(true);
  expect(cache.get).not.toHaveBeenCalled(); expect(cache.put).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled();
  expect(f.storage.put).not.toHaveBeenCalled(); expect(f.storage.delete).not.toHaveBeenCalled(); expect(f.writes).not.toHaveBeenCalled(); expect(f.snapshot()).toBe(baseline);
  const later = [...f.objects.keys()].find(name => name.endsWith('-later.ndjson'))!;
  f.objects.set(later, JSON.stringify(served)); expect((await f.request('meridian', paths[0]!)).status).toBe(200);
});

it('W14.02 validates isolated product readback/export, strict erasure and background failures while preserving content budgets and queue types', async () => {
  const tenants=['meridian','product-sort','decision','outcome'];
  const policy={TENANTS:JSON.stringify({provisioned:tenants}),RETENTION:JSON.stringify({version:1,tenants:Object.fromEntries(tenants.map(tenant=>[tenant,JSON.parse(ledgerFixturePolicy.RETENTION!).tenants.meridian]))})};
  const originalStamp=(tenant:string,ts:number)=>captureRetention(policy,tenant,ts,fixtureBirth);
  const make = (tenant: string, ts = T0): ProductSortRecord => {
    const request_id = crypto.randomUUID();
    return { version: 1, record_id: `${tenant}:${ts36(ts)}:v-sort:product-sort:${request_id}`, request_id, tenant, visitor_id: 'v-sort', session_id: 's-sort', ts,
      configVersion: 'synthetic-v1', mode: 'sort', consent: { tracking: true, personalization: true }, weights: { affinity: 1, dims: {} }, affinityWeight: 1,
      order: ['p1'], items: [{ id: 'p1', rank: 0, feedRank: 0, score: 0, drivers: [] }], inputCount: 1, dropped: 0, filteredCount: 0,
      eligibleCount: 1, returnedCount: 1, limit: null, intent: null, retention:originalStamp(tenant,ts) };
  };
  const r2 = new FakeR2(), records = [make('meridian'), make('product-sort')];
  for (const record of records) {
    expect(isProductSortRecord(record)).toBe(true);
    const message = { kind: 'ledger' as const, type: 'product-sort' as const, record };
    expect(isLedgerMessage(message)).toBe(false); expect(expandLedgerMessage(message)).toEqual([message]);
    // W14 extends capture, not learning: acknowledge this durable stream,
    // while the learning-only discriminator remains false.
    const consumed=new ManagedR2();
    expect(await consumeLedger({ ...policy, STORAGE: consumed as never }, [message])).toMatchObject({ skipped: 0, written: 1, dispositions:['ack'] });
    expect((await findById<ProductSortRecord>(consumed,record.record_id,'product-sort'))?.record).toEqual(record);
    expect(await writeBatches(r2, [message], record.request_id)).toHaveLength(1);
    expect((await findById<ProductSortRecord>(r2, record.record_id, 'product-sort'))?.record).toEqual(record);
    expect(await findById(r2, record.record_id, 'decision')).toBeNull();
  }
  expect(r2.store.size).toBe(2);
  const base = records[0]!;
  for (const bad of [
    { ...base, version: 2 }, { ...base, tenant: 'other' }, { ...base, ts: T0 + 1 }, { ...base, visitor_id: 'other' },
    { ...base, session_id: 'bad/session' }, { ...base, inputCount: 2 }, { ...base, candidates: [] },
    { ...base, items: [{ ...base.items[0]!, score: Infinity }] }, { ...base, items: [{ ...base.items[0]!, rank: 1 }] },
    { ...base, consent: { tracking: false, personalization: true } },
  ]) {
    expect(isProductSortRecord(bad)).toBe(false);
    expect(await writeBatches(r2, [{ kind: 'ledger', type: 'product-sort', record: bad as ProductSortRecord }], base.request_id)).toEqual([]);
  }
  const malformed = new FakeR2(), key = [...r2.store.keys()][0]!;
  malformed.store.set(key, JSON.stringify({ ...base, version: 2 }) + '\n');
  await expect(findById(malformed, base.record_id, 'product-sort')).rejects.toThrow('Ledger record unavailable');

  const tenant = 'product-sort', date = new Date(T0).toISOString().slice(0, 10), content = set('v-content').records[0]!;
  const decision = { ...content, tenant, brand: tenant, retention:originalStamp(tenant,T0), decision_id: content.decision_id.replace(/^coach:/, `${tenant}:`) };
  const outcome = {...outcomeFromAction({ type: 'purchase', userId: 'v-content', timestamp: T0 }, tenant)!,retention:originalStamp(tenant,T0)};
  await writeBatches(r2, [{ kind: 'ledger', type: 'decision', record: decision }, { kind: 'ledger', type: 'outcome', record: outcome }], 'content');
  r2.store.set(`${hourPrefix(tenant, T0)}/decisions/legacy.ndjson`, '');
  expect(await countDayObjects(r2, tenant, date)).toBe(2);
  const hour = await loadHourRecords(r2, tenant, date, 14, 2);
  expect(hour).toMatchObject({ objects: 2, read: 2, truncated: false }); expect(hour.decisions).toHaveLength(1); expect(hour.outcomes).toEqual([outcome]);
  expect((await loadDay(r2, tenant, date, 'decision', 500)).records).toEqual([decision]);

  const e = { RETENTION:policy.RETENTION, STORAGE: r2, AUTH_MODE: 'enforced', JWT_SECRET: 'w1402-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
    IDENTITY_SALT: 'w0304-synthetic-product-audit-material', ACCOUNTS: memoryStore(),
    TENANTS: JSON.stringify({ provisioned: tenants, operatorGrants: { 'operator-meridian': ['meridian'], 'operator-sort': [tenant] } }) } as unknown as Env;
  const app = new Hono().use('*', tenantMiddleware()).route('/v1', decisionRoutes);
  const tokens = await Promise.all(['operator-meridian', 'operator-sort'].map(sub => new SignJWT({ type: 'service' }).setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub).setIssuer('i').setAudience('a').setExpirationTime('5m').sign(new TextEncoder().encode(e.JWT_SECRET))));
  const get = (owner: string, suffix: string, token = tokens[owner === 'meridian' ? 0 : 1]!, headerTenant = owner) =>
    app.request(`/v1/${owner}/ledger/${suffix}`, { headers: { 'X-Tenant': headerTenant, ...(token ? { Authorization: `Bearer ${token}` } : {}) } }, e);
  for (const record of records) {
    const response = await get(record.tenant, `${encodeURIComponent(record.record_id)}?stream=product-sort`);
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ ok: true, stream: 'product-sort', record });
    const batches = await (await get(record.tenant, `batches?date=${date}&stream=product-sort`)).json() as { objects: Array<{ key: string }> };
    expect(batches.objects).toHaveLength(1); expect(batches.objects[0]!.key.endsWith(`-${record.request_id}.ndjson`)).toBe(true);
  }
  const retainedKey=[...r2.store].find(([,raw])=>raw.includes(base.record_id))![0],retainedRaw=r2.store.get(retainedKey)!;
  for(const retention of [undefined,{...base.retention,ledger:{...base.retention!.ledger!,expiresAt:fixtureBirth-1}}]){
    r2.store.set(retainedKey,JSON.stringify({...base,retention})+'\n');
    expect((await get('meridian',`${base.record_id}?stream=product-sort`)).status).toBe(503);
  }
  r2.store.set(retainedKey,retainedRaw);
  const defaultExport = await (await get(tenant, `batches?date=${date}`)).json() as { stream: string; objects: Array<{ key: string }> };
  expect(defaultExport.stream).toBe('both'); expect(defaultExport.objects).toHaveLength(2);
  expect(defaultExport.objects.every(object => ['decision','outcome'].includes(object.key.split('/')[3]!))).toBe(true);
  expect(defaultExport.objects.some(object => object.key.endsWith('/decisions/legacy.ndjson'))).toBe(false);
  // A tenant can itself be named after an existing stream. Its product receipts
  // must not enter a content selector through legacy substring matching.
  for (const stream of ['decision', 'outcome'] as const) {
    const storage = new FakeR2(), product = make(stream);
    const row = stream === 'decision' ? { ...content, tenant: stream, decision_id: content.decision_id.replace(/^coach:/, `${stream}:`) }
      : outcomeFromAction({ type: 'purchase', userId: 'v-content', timestamp: T0 }, stream)!;
    await writeBatches(storage, [{ kind: 'ledger', type: 'product-sort', record: product }], product.request_id);
    storage.store.set(`${hourPrefix(stream, T0)}/${stream}/legacy.ndjson`, JSON.stringify(row) + '\n');
    expect(await loadDay(storage, stream, date, stream, 1)).toEqual({ records: [row], truncated: false });
    const response = await app.request(`/v1/${stream}/ledger/batches?date=${date}&stream=${stream}`, {
      headers: { 'X-Tenant': stream, Authorization: `Bearer ${tokens[0]}` },
    }, { ...e, STORAGE: storage, TENANTS: JSON.stringify({ provisioned: [stream], operatorGrants: { 'operator-meridian': [stream] } }) } as unknown as Env);
    expect(response.status).toBe(200);
    expect((await response.json() as { objects: Array<{ key: string }> }).objects.map(object => object.key))
      .toEqual([`${hourPrefix(stream, T0)}/${stream}/legacy.ndjson`]);
  }
  const reads = vi.spyOn(r2, 'get'), lists = vi.spyOn(r2, 'list');
  expect((await get('meridian', `${base.record_id}?stream=product-sort`, '')).status).toBe(401);
  expect((await get(tenant, `${records[1]!.record_id}?stream=product-sort`, tokens[0])).status).toBe(403);
  expect((await get('meridian', `${base.record_id}?stream=product-sort`, tokens[0], tenant)).status).toBe(403);
  expect((await get('meridian', `${records[1]!.record_id}?stream=product-sort`)).status).toBe(400);
  expect(reads).not.toHaveBeenCalled(); expect(lists).not.toHaveBeenCalled(); reads.mockRestore(); lists.mockRestore();
  await writeTombstone(r2, 'meridian', 'v-sort', 'synthetic', T0);
  expect((await get('meridian', `${base.record_id}?stream=product-sort`)).status).toBe(410);
  expect((await rewriteErasures(r2, 'meridian', { now: T0 + 86_400_000, retentionDays: 1 })).rows_removed).toBe(1);
  expect(await findById(r2, base.record_id, 'product-sort')).toBeNull();
  expect((await get(tenant, `${records[1]!.record_id}?stream=product-sort`)).status).toBe(200);

  // Durable admission supersedes the old waitUntil/scheduled-success oracle.
  // Direct sink faults still prove fail-closed erasure/read/write semantics;
  // the actual owned route/fallback/restart is exercised by sort.test.ts.
    for (const failure of ['cutoff', 'post-cutoff', 'corrupt', 'wrong-tenant', 'read', 'undefined', 'put']) {
      const storage = new ManagedR2(), at = failure === 'post-cutoff' ? T0 + 1 : T0;
      if (failure !== 'put') await writeTombstone(storage, 'meridian', 'v-sort', 'synthetic', T0);
      const barrier = tombstoneKey('meridian', 'v-sort');
      if (failure === 'corrupt') storage.store.set(barrier, 'null');
      if (failure === 'wrong-tenant') storage.store.set(barrier, JSON.stringify({ ...JSON.parse(storage.store.get(barrier)!), tenant: 'other' }));
      if (failure === 'read') storage.get = async () => { throw new Error('private-storage-marker'); };
      if (failure === 'undefined') storage.get = async () => undefined as never;
      if (failure === 'put') storage.put = async () => { throw new Error('private-put-marker'); };
      const record = make('meridian', at);
      expect(await scheduleProductSort(storage, () => {throw new Error('No fire-and-forget success');}, record, record.consent, DEFAULT_REFLEX_CONFIG,
        { order: record.order, items: record.items, affinityWeight: 1, dropped: 0 }, 1, undefined)).toEqual({status:'not_scheduled',reason:'capture_unavailable'});
      const result=await persistDeliveries(storage,[readDelivery({kind:'ledger',version:1,type:'product-sort',record,delivery_id:record.request_id})]);
      if(failure==='post-cutoff')expect(result).toMatchObject({ok:true,newlyStored:1,dispositions:['ack']});
      else if(failure==='cutoff')expect(result).toMatchObject({ok:true,suppressed:1,newlyStored:0,dispositions:['ack']});
      else expect(result).toMatchObject({ok:false,newlyStored:0,dispositions:['retry']});
      expect(storage.dataKeys()).toHaveLength(failure==='post-cutoff'?1:0);
    }
});

// Existing ledger fixture, extended at the actual SQL-API fetch boundary. The
// delivered procedure JavaScript executes; this shim does NOT attest Snowflake
// SQL parsing, transaction concurrency, installation or historical deletion.
describe('W14.07 scheduled warehouse source, receiver and readback custody',()=>{
  class WarehouseR2 extends ManagedR2 {
    calls=0;
    async get(key:string){this.calls++;const value=await super.get(key);return value?{...value,key,body:new Response(await value.text()).body}:null;}
    async put(key:string,body:string,options?:R2PutOptions){this.calls++;const value=await super.put(key,body,options);return value?{...value,key,size:new TextEncoder().encode(body).length}:null;}
    async head(key:string){this.calls++;const body=this.store.get(key);return body===undefined?null:{key,etag:this.etag(body),size:new TextEncoder().encode(body).length};}
    async list(options:{prefix:string;limit?:number;cursor?:string}){this.calls++;const keys=[...this.store.keys()].filter(key=>key.startsWith(options.prefix)).sort();
      const from=Number(options.cursor??0),to=from+(options.limit??1000);return{objects:keys.slice(from,to).map(key=>({key})),truncated:to<keys.length,cursor:String(to)};}
  }
  async function fixture(overrides:Record<string,unknown>={}){
    const {generateKeyPairSync,createPublicKey}=await import('node:crypto'),{readFileSync}=await import('node:fs'),{runInNewContext}=await import('node:vm');
    const {connectorDigest,configuredDestinations}=await import('@/connectors/config');
    const r2=new WarehouseR2(),pair=generateKeyPairSync('rsa',{modulusLength:2048}),privateKey=pair.privateKey.export({type:'pkcs8',format:'pem'}).toString().trim();
    const fingerprint='SHA256:'+createHash('sha256').update(createPublicKey(pair.privateKey).export({type:'spki',format:'der'})).digest('base64');
    const config={version:1 as const,enabled:true as const,provider:'snowflake-sql-api' as const,account:'LOCAL_FIXTURE',origin:'https://fixture.snowflakecomputing.com/',
      user:'FIXTURE',keyPairRef:'CONNECTOR_SECRET_WAREHOUSE',database:'FIXTURE',schema:'PUBLIC',warehouse:'LOCAL',role:'DELIVERY',procedure:'APPLY_DELIVERY_V1' as const,
      identityNamespace:'fixture-v1',mappingRevision:'v1',approval:{egress:'fixture',metering:'fixture',providerRetention:'fixture'},cadenceMs:60000,startAt:0,timeoutMs:30000,responseBytes:2*1024*1024,maxObjects:100,maxRows:256,maxBytes:2*1024*1024,...overrides};
    const env={...ledgerFixturePolicy,STORAGE:r2,IDENTITY_SALT:'warehouse-fixture-stable-custody-only',TENANT_CONNECTORS:JSON.stringify({version:1,tenants:{coach:{warehouse:config}}}),
      CONNECTOR_SECRET_WAREHOUSE:JSON.stringify({privateKey,publicKeyFingerprint:fingerprint})} as unknown as Env;
    const policy=JSON.parse(env.RETENTION!);for(const destination of await configuredDestinations(env,'coach',()=>undefined))policy.tenants.coach[destination.category]={id:'warehouse-test',revision:1,durationMs:60000,basis:'admitted',renewal:'new-record-only'};env.RETENTION=JSON.stringify(policy);
    const generation=await connectorDigest({purpose:'warehouse',tenant:'coach',...config});
    type Row={tenant:string;generation:string;source:string;ss:number;part:number;id:string;subject:string;ts:number;expiry:number;hash:string;wire:string};
    type Source={admitted:number;committed:number;revision:string;total?:number;digest?:string};
    const state={rows:[] as Row[],parts:[] as Array<[string,string,string,number,number]>,sources:new Map<string,Source>(),operations:new Map<string,unknown[]>(),cutoffs:new Map<string,number>()};
    let snapshot:typeof state|undefined;
    const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
    const key=(v:unknown[])=>JSON.stringify(v),rows=(b:unknown[])=>state.rows.filter(r=>r.tenant===b[0]&&r.generation===b[1]&&r.source===b[2]&&r.ss===b[3]);
    const live=(r:Row)=>r.expiry>Date.now()&&r.ts>(state.cutoffs.get(key([r.tenant,r.subject]))??-1);
    const q=(sql:string,b:unknown[])=>{
      if(b.some(v=>v!==null&&typeof v!=='string'&&typeof v!=='number'))throw Error('Unsupported Snowflake bind type');
      let result:unknown[][]=[];
      if(sql==='BEGIN TRANSACTION')snapshot=structuredClone(state);
      else if(sql==='ROLLBACK'){if(snapshot)Object.assign(state,snapshot);}
      else if(sql==='COMMIT')snapshot=undefined;
      else if(sql.startsWith('SELECT SHA2('))result=[[hash(String(b[0]))]];
      else if(sql==='SELECT BASE64_DECODE_STRING(?)')result=[[Buffer.from(String(b[0]),'base64').toString('utf8')]];
      else if(sql==='SELECT DATE_PART(EPOCH_MILLISECOND,CURRENT_TIMESTAMP())')result=[[Date.now()]];
      else if(sql.startsWith('MERGE INTO DELIVERY_LOCK_V1')){/* fixture lock: execution is serial, concurrency stays live-only */}
      else if(sql.startsWith('SELECT SERIAL'))result=[[0]];
      else if(sql.startsWith('SELECT DIGEST FROM DELIVERY_OPERATION')){const o=state.operations.get(key(b));result=o?[[o[3]]]:[];}
      else if(sql.startsWith('MERGE INTO DELIVERY_CUTOFF')){const k=key(b.slice(0,2));state.cutoffs.set(k,Math.max(state.cutoffs.get(k)??-1,Number(b[2])));}
      else if(sql.startsWith('DELETE FROM DELIVERY_ROW_V1 R USING'))state.rows=state.rows.filter(r=>r.tenant!==b[0]||r.ts>(state.cutoffs.get(key([r.tenant,r.subject]))??-1));
      else if(sql.startsWith('DELETE FROM DELIVERY_ROW_V1 WHERE TENANT=? AND EXPIRES'))state.rows=state.rows.filter(r=>r.tenant!==b[0]||r.expiry>Date.now());
      else if(sql.startsWith('SELECT ADMITTED,COMMITTED,REVISION')){const s=state.sources.get(key(b));result=s?[[s.admitted,s.committed,s.revision]]:[];}
      else if(sql.startsWith('MERGE INTO DELIVERY_SOURCE')){const k=key(b.slice(0,3)),old=state.sources.get(k);state.sources.set(k,{admitted:Number(b[3]),committed:old?.committed??0,revision:String(b[4])});}
      else if(sql.startsWith('SELECT COALESCE(MAX(AT)'))result=[[state.cutoffs.get(key(b))??-1]];
      else if(sql.startsWith('SELECT MAX(AT)'))result=[[state.cutoffs.get(key(b))??null]];
      else if(sql.startsWith('SELECT COUNT(*) FROM DELIVERY_ROW_V1 WHERE TENANT=? AND GENERATION=? AND ID='))result=[[state.rows.filter(r=>r.tenant===b[0]&&r.generation===b[1]&&r.id===b[2]&&r.hash!==b[3]).length]];
      else if(sql.startsWith('SELECT COUNT(*) FROM DELIVERY_ROW_V1 WHERE TENANT=? AND GENERATION=? AND SOURCE='))result=[[rows(b).filter(r=>r.id===b[4]).length]];
      else if(sql.startsWith('SELECT COUNT(*) FROM DELIVERY_ROW_V1 WHERE TENANT=? AND EXPIRES'))result=[[state.rows.filter(r=>r.tenant===b[0]&&r.expiry<=Date.now()).length]];
      else if(sql.startsWith('INSERT INTO DELIVERY_ROW'))state.rows.push({tenant:String(b[0]),generation:String(b[1]),source:String(b[2]),ss:Number(b[3]),part:Number(b[4]),id:String(b[5]),subject:String(b[6]),ts:Number(b[7]),expiry:Number(b[8]),hash:String(b[9]),wire:String(b[10])});
      else if(sql.startsWith('SELECT COUNT(*) FROM DELIVERY_PART'))result=[[state.parts.filter(p=>key(p.slice(0,b.length))===key(b)).length]];
      else if(sql.startsWith('INSERT INTO DELIVERY_PART'))state.parts.push(b as [string,string,string,number,number]);
      else if(sql.startsWith('WITH RECURSIVE LIVE')){
        let digest=hash(''),count=0;for(let part=0;part<=Number(b[8]);part++){
          if(!state.parts.some(p=>key(p)===key([...b.slice(0,4),part])))throw Error('Missing part');
          const selected=rows(b).filter(r=>r.part===part&&live(r)).sort((a,b)=>Buffer.compare(Buffer.from(a.id),Buffer.from(b.id)));
          count+=selected.length;digest=hash(digest+'\n'+hash(selected.map(r=>r.id+':'+hash(r.wire)).join('\n')));
        }result=[[count,digest]];
      }else if(sql.startsWith('UPDATE DELIVERY_SOURCE')){const s=state.sources.get(key(b.slice(3)))!;s.committed=Number(b[0]);s.total=Number(b[1]);s.digest=String(b[2]);}
      else if(sql.startsWith('DELETE FROM DELIVERY_ROW_V1 WHERE TENANT=? AND GENERATION'))state.rows=state.rows.filter(r=>key([r.tenant,r.generation,r.source])!==key(b.slice(0,3))||r.ss===b[3]||b.length===5&&r.ss===b[4]);
      else if(sql.startsWith('DELETE FROM DELIVERY_PART'))state.parts=state.parts.filter(p=>key(p.slice(0,3))!==key(b.slice(0,3))||p[3]===b[3]||b.length===5&&p[3]===b[4]);
      else if(sql.startsWith('INSERT INTO DELIVERY_OPERATION'))state.operations.set(key(b.slice(0,3)),[...b.slice(0,8),b[8]==='true',...b.slice(9)]);
      else if(sql.startsWith('SELECT DIGEST,SEQUENCE,SOURCE')){const o=state.operations.get(key(b));result=o?[[o[3],o[4],o[5],o[6],o[7],o[8],o[9],o[10],o[12]]]:[];}
      else if(sql.startsWith('SELECT R.ID,SHA2(R.WIRE,256)'))result=rows(b).filter(r=>r.part===b[4]&&live(r)).sort((a,b)=>Buffer.compare(Buffer.from(a.id),Buffer.from(b.id))).map(r=>[r.id,hash(r.wire)]);
      else if(sql.startsWith('SELECT COMMITTED')){const s=state.sources.get(key(b));result=s?[[s.committed]]:[];}
      else throw Error('Unhandled delivered SQL: '+sql);
      let index=-1;return{next:()=>++index<result.length,getColumnValue:(n:number)=>result[index]![n-1]};
    };
    const sql=readFileSync('scripts/sql/snowflake-warehouse-v1.sql','utf8');
    const execute=(read:boolean,wire:string)=>{const name=read?'READ_DELIVERY_V1':'APPLY_DELIVERY_V1',body=sql.split('CREATE OR REPLACE PROCEDURE '+name+'(')[1]!.split('$$')[1]!;
      return runInNewContext('(function(){'+body+'})()', {WIRE:wire,snowflake:{createStatement:({sqlText,binds}:{sqlText:string;binds:unknown[]})=>({execute:()=>q(sqlText,binds??[])})},Date});};
    const requests:Array<{id:string;read:boolean;wire:string}>=[];
    const remote=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
      const url=new URL(String(input));expect(url.origin).toBe(config.origin.slice(0,-1));expect(init?.redirect).toBe('manual');
      const body=JSON.parse(String(init?.body)),wire=body.bindings['1'].value as string,read=String(body.statement).includes('READ_DELIVERY');
      const id=url.searchParams.get('requestId')!;requests.push({id,read,wire});const value=execute(read,wire);
      return Response.json({statementHandle:id,resultSetMetaData:{numRows:1,rowType:[{name:'RESULT',type:'variant'}],partitionInfo:[{rowCount:1}]},data:[[JSON.stringify(value)]]});
    });
    const append=async(n:number,visitor=(i:number)=>'v-'+i)=>{
      const {externalRetentionBirths}=await import('@/retention'),at=Date.now(),key=hourPrefix('coach',at)+'/outcome/fixture.ndjson';
      const records=Array.from({length:n},(_,i)=>({...managedOutcome(visitor(i),at).record,retention:captureRetention(env,'coach',at),externalRetention:externalRetentionBirths(env,'coach',at)}));
      await r2.put(key,records.map(r=>JSON.stringify(r)).join('\n')+'\n');return {key,records};
    };
    const journalKey='warehouse/v1/coach/jobs/'+generation+'.json';
    const journal=()=>JSON.parse(r2.store.get(journalKey)??'null');
    const advance=async(until:()=>boolean,maximum=20)=>{const{runWarehouse}=await import('./warehouse');for(let i=0;i<maximum&&!until();i++){
      const result=await runWarehouse(env,'coach');expect(result.status,JSON.stringify(journal())).not.toBe('failed');}expect(until(),JSON.stringify(journal())).toBe(true);};
    return{env,config,generation,r2,state,requests,remote,execute,append,journal,journalKey,advance};
  }
  it('executes actual receiver JS with supported binds, exact row/hash readback and complete >10000-row restart windows',async()=>{
    const f=await fixture(),{runWarehouse}=await import('./warehouse'),clock=vi.spyOn(Date,'now').mockReturnValue(Date.now());
    try{
      const input=await f.append(10001,i=>i%2?'Z_'+i:'a_'+i);expect(new TextEncoder().encode(f.r2.store.get(input.key)!).length).toBeLessThan(MANAGED_BYTES);
      let greatest=0;
      for(let attempt=0;attempt<100;attempt++){
        const before=f.r2.calls,result=await runWarehouse(f.env,'coach');greatest=Math.max(greatest,f.r2.calls-before);
        expect(result.status).not.toBe('failed');
        const source=f.state.sources.get(JSON.stringify(['coach',f.generation,input.key]));if(source?.committed){expect(source.total).toBe(10001);break;}
      }
      expect(f.state.rows).toHaveLength(10001);expect(f.state.sources.get(JSON.stringify(['coach',f.generation,input.key]))?.total).toBe(10001);
      expect(greatest).toBeLessThan(4096);expect(new Set(f.requests.map(r=>r.id)).size).toBe(f.requests.length);
      expect(f.requests.some(r=>r.read)).toBe(true);
      for(const [key,body]of f.r2.store)if(key.includes('/jobs/')){expect(body).not.toContain('eyJ');expect(JSON.parse(body).seal).toMatch(/^[a-f0-9]{64}$/);}
      const duplicate=f.requests.find(r=>!r.read&&JSON.parse(r.wire).rows.length)!;
      expect(f.execute(false,duplicate.wire)).toMatchObject({duplicate:true});expect(f.state.rows).toHaveLength(10001);
    }finally{clock.mockRestore();f.remote.mockRestore();}
  },120000);
  it('rejects resealed foreign pending fields before SQL and retains quiet expired-destination cleanup without current upload config',async()=>{
    const f=await fixture(),{runWarehouse}=await import('./warehouse');
    const at=Date.now(),clock=vi.spyOn(Date,'now').mockReturnValue(at);
    try{
      const input=await f.append(2);
      const key='warehouse/v1/coach/jobs/'+f.generation+'.json';
      for(let i=0;i<8;i++){const result=await runWarehouse(f.env,'coach');expect(result.status).not.toBe('failed');
        const candidate=JSON.parse(f.r2.store.get(key)!);if(candidate.pending&&!candidate.pending.cleanup)break;}
      const original=f.r2.store.get(key)!;const saved=JSON.parse(original);
      expect(saved.pending).toBeDefined();const before=f.requests.length;
      for(const mutate of [(p:Record<string,unknown>)=>{p.tenant='meridian';},(p:Record<string,unknown>)=>{p.generation='a'.repeat(64);},
        (p:Record<string,unknown>)=>{p.total=99;},(p:Record<string,unknown>)=>{p.source='coach/2000-01-01/00/outcome/foreign.ndjson';}]){
        const bad=JSON.parse(original);mutate(bad.pending.payload);bad.pending.digest=createHash('sha256').update(JSON.stringify(bad.pending.payload)).digest('hex');
        await f.r2.put(key,JSON.stringify(bad));expect((await runWarehouse(f.env,'coach')).status).toBe('failed');expect(f.requests).toHaveLength(before);
      }
      await f.r2.put(key,original);
      for(let i=0;i<8;i++)await runWarehouse(f.env,'coach');expect(f.state.rows.some(row=>row.source===input.key)).toBe(true);
      delete f.env.TENANT_CONNECTORS;clock.mockReturnValue(at+120000);
      for(let i=0;i<8;i++)await runWarehouse(f.env,'coach');
      expect(f.state.rows).toHaveLength(0);expect(f.requests.filter(r=>!r.read).slice(-1).map(r=>JSON.parse(r.wire).rows)).toEqual([[]]);
      expect([...f.state.operations.values()].every(operation=>operation[11]==='[]')).toBe(true);
    }finally{clock.mockRestore();f.remote.mockRestore();}
  });
  it('uses ID-first UTF8 order, rejects future-part finalization and refuses appending to a committed source',async()=>{
    const f=await fixture();try{
      const input=await f.append(4,()=> 'same-owner'),suffixes=['1','10','\uE000','\u{10000}'];
      const records=input.records.map((r,i)=>({...r,outcome_id:`coach:${ts36(r.ts)}:same-owner:purchase:${suffixes[i]}`}));
      await f.r2.put(input.key,records.map(r=>JSON.stringify(r)).join('\n')+'\n');
      await f.advance(()=>f.state.rows.length===4&&[...f.state.sources.values()].some(s=>s.total===4));
      const wire=f.requests.find(r=>!r.read&&JSON.parse(r.wire).rows.length===4)!.wire,original=JSON.parse(wire);
      const after=structuredClone(f.state);
      expect(()=>f.execute(false,JSON.stringify({...original,operation:crypto.randomUUID(),sequence:original.sequence+1,part:1,rows:[],final:false}))).toThrow();expect(f.state).toEqual(after);
      const source=input.key+'-separate',base={...original,source,sourceSequence:100,sequence:100,operation:crypto.randomUUID(),rows:[],part:2,final:false,total:0};
      f.execute(false,JSON.stringify(base));const staged=structuredClone(f.state),hash=(v:string)=>createHash('sha256').update(v).digest('hex');
      expect(()=>f.execute(false,JSON.stringify({...base,operation:crypto.randomUUID(),sequence:101,part:0,final:true,sourceDigest:hash(hash('')+'\n'+hash(''))}))).toThrow();expect(f.state).toEqual(staged);
    }finally{f.remote.mockRestore();}
  });
  it('restarts a shorter replacement at offset zero when HEAD observes A but GET returns B',async()=>{
    const f=await fixture({maxRows:1});try{
      const input=await f.append(3);await f.r2.put(input.key,input.records.map(r=>JSON.stringify({...r,fixturePadding:'x'.repeat(1000)})).join('\n')+'\n');const original=f.r2.store.get(input.key)!;
      await f.advance(()=>!!f.journal()?.source?.offset&&!f.journal()?.pending);
      const firstSequence=f.journal().source.sequence,firstOffset=f.journal().source.offset;
      const oldWire=f.requests.find(r=>!r.read&&JSON.parse(r.wire).rows.length)!.wire;
      const replacement=JSON.stringify({...input.records[0],value:1})+'\n';expect(replacement.length).toBeLessThan(firstOffset);
      const get=f.r2.get.bind(f.r2);let switched=false;
      const spy=vi.spyOn(f.r2,'get').mockImplementation(async key=>{if(key===input.key&&!switched){switched=true;await f.r2.put(key,replacement);}return get(key);});
      await f.advance(()=>switched&&!!f.journal()?.pending);spy.mockRestore();
      expect(f.journal().source.offset).toBe(0);expect(f.journal().source.sequence).toBeGreaterThan(firstSequence);expect(f.journal().pending.payload.rows).toHaveLength(1);
      await f.advance(()=>f.state.sources.get(JSON.stringify(['coach',f.generation,input.key]))?.total===1);
      expect(f.state.rows.filter(r=>r.source===input.key)).toHaveLength(1);expect(f.r2.store.get(input.key)).not.toBe(original);
      expect(f.state.rows.some(r=>r.ss===firstSequence)).toBe(false);expect(f.state.parts.some(p=>p[3]===firstSequence)).toBe(false);
      const committed=structuredClone(f.state);f.execute(false,oldWire);expect(f.state).toEqual(committed);
      expect(()=>f.execute(false,JSON.stringify({...JSON.parse(oldWire),operation:crypto.randomUUID()}))).toThrow();expect(f.state).toEqual(committed);
      const latest=JSON.parse(f.requests.filter(r=>!r.read&&JSON.parse(r.wire).rows.length).at(-1)!.wire);
      const changed={...latest,operation:crypto.randomUUID(),sequence:latest.sequence+1,sourceSequence:latest.sourceSequence+1,rows:JSON.parse(oldWire).rows,final:false};
      expect(()=>f.execute(false,JSON.stringify(changed))).toThrow();expect(f.state).toEqual(committed);
      expect(()=>f.execute(false,JSON.stringify({...latest,operation:crypto.randomUUID(),sequence:latest.sequence+1,sourceSequence:latest.sourceSequence+1,sourceDigest:'0'.repeat(64)}))).toThrow();expect(f.state).toEqual(committed);
    }finally{f.remote.mockRestore();}
  });
  it('retains pending 202/429 handles but retires completed reads before failed checkpoint and requests fresh proof',async()=>{
    const f=await fixture(),{runWarehouse}=await import('./warehouse');try{
      await f.append(1);await f.advance(()=>!!f.journal()?.pending&&!f.journal().pending.cleanup);
      const pending=f.journal().pending,normal=f.remote.getMockImplementation()!,handle=crypto.randomUUID();let polls=0,readPosts=0;
      f.remote.mockImplementation(async(input,init)=>{const url=new URL(String(input));
        if(init?.method==='GET'){expect(url.pathname.endsWith(handle)).toBe(true);polls++;if(polls===1)return Response.json({statementHandle:handle},{status:429});
          const value=f.execute(true,JSON.stringify({tenant:'coach',generation:f.generation,operation:pending.payload.operation,digest:pending.digest}));
          return Response.json({statementHandle:handle,resultSetMetaData:{numRows:1,rowType:[{}],partitionInfo:[{rowCount:1}]},data:[[JSON.stringify(value)]]});}
        const read=String(JSON.parse(String(init?.body)).statement).includes('READ_DELIVERY');if(read&&readPosts++===0)return Response.json({statementHandle:handle},{status:202});
        return normal(input,init);});
      expect((await runWarehouse(f.env,'coach')).status).not.toBe('failed');expect(f.journal().pending.readHandle).toBe(handle);
      expect((await runWarehouse(f.env,'coach')).status).not.toBe('failed');expect(f.journal().pending.readHandle).toBe(handle);
      const put=f.r2.put.bind(f.r2);let failed=false;
      const save=vi.spyOn(f.r2,'put').mockImplementation(async(key,body,options)=>{if(key===f.journalKey&&polls===2&&!failed){failed=true;throw Error('Synthetic checkpoint failure');}return put(key,body,options);});
      expect((await runWarehouse(f.env,'coach')).status).toBe('failed');expect(failed).toBe(true);save.mockRestore();expect(f.journal().pending.readHandle).toBeUndefined();
      f.state.rows[0]!.wire=JSON.stringify({changed:true});expect((await runWarehouse(f.env,'coach')).status).toBe('failed');
      expect(readPosts).toBe(2);expect(polls).toBe(2);expect(f.journal().pending).toBeDefined();
    }finally{f.remote.mockRestore();}
  });
  it('atomically reserves the last generation, resumes interrupted publication and continues prior cleanup at capacity',async()=>{
    const f=await fixture(),{runWarehouse,warehouseDestinations}=await import('./warehouse'),{connectorDigest}=await import('@/connectors/config');try{
      const generations=[];for(let i=0;i<99;i++){const configuration={...f.config,mappingRevision:'historical-'+i},digest=await connectorDigest({purpose:'warehouse',tenant:'coach',...configuration});generations.push(digest);
        await f.r2.put('warehouse/v1/coach/generations/'+digest+'.json',JSON.stringify({version:1,tenant:'coach',digest,configuration}));}
      await f.r2.put('warehouse/v1/coach/inventory.json',JSON.stringify({generations}));
      const competitor={...f.env,TENANT_CONNECTORS:JSON.stringify({version:1,tenants:{coach:{warehouse:{...f.config,mappingRevision:'competitor'}}}})} as Env;
      await Promise.all([runWarehouse(f.env,'coach'),runWarehouse(competitor,'coach')]);
      const inventory=JSON.parse(f.r2.store.get('warehouse/v1/coach/inventory.json')!);expect(inventory.generations).toHaveLength(100);expect(new Set(inventory.generations).size).toBe(100);
      expect(await warehouseDestinations(f.env,'coach')).toHaveLength(100);
      const extra={...f.env,TENANT_CONNECTORS:JSON.stringify({version:1,tenants:{coach:{warehouse:{...f.config,mappingRevision:'refused-101'}}}})} as Env;
      const before=f.requests.length;for(let i=0;i<210&&f.requests.length===before;i++)expect((await runWarehouse(extra,'coach')).reason).toBe('generation_capacity');
      expect(f.requests.length).toBeGreaterThan(before);expect(await warehouseDestinations(f.env,'coach')).toHaveLength(100);
    }finally{f.remote.mockRestore();}
    const next=await fixture();try{
      const key='warehouse/v1/coach/generations/'+next.generation+'.json',put=next.r2.put.bind(next.r2);let refused=true;
      const fault=vi.spyOn(next.r2,'put').mockImplementation(async(k,body,options)=>{if(k===key&&refused)throw Error('Interrupted publication');return put(k,body,options);});
      await runWarehouse(next.env,'coach');expect(JSON.parse(next.r2.store.get('warehouse/v1/coach/inventory.json')!).generations).toEqual([next.generation]);expect(next.r2.store.has(key)).toBe(false);
      refused=false;await runWarehouse(next.env,'coach');fault.mockRestore();expect(await warehouseDestinations(next.env,'coach')).toHaveLength(1);
      expect(JSON.parse(next.r2.store.get('warehouse/v1/coach/inventory.json')!).generations).toEqual([next.generation]);
    }finally{next.remote.mockRestore();}
  },30000);
  it('delivers a complete near-1MiB escaped UTF8 product receipt through the bounded final SQL request without truncation',async()=>{
    const f=await fixture();try{
      const {externalRetentionBirths}=await import('@/retention'),at=Date.now(),request_id=crypto.randomUUID(),id='p'+String.fromCharCode(34,92)+'é'.repeat(100);
      const large=id.repeat(4200),row:ProductSortRecord={version:1,record_id:`coach:${ts36(at)}:large-product:product-sort:${request_id}`,request_id,tenant:'coach',visitor_id:'large-product',session_id:'private-session',ts:at,
        configVersion:'fixture',mode:'sort',consent:{tracking:true,personalization:true},weights:{affinity:1,dims:{}},affinityWeight:1,order:[large],
        items:[{id:large,rank:0,feedRank:0,score:0,drivers:[]}],inputCount:1,dropped:0,filteredCount:0,eligibleCount:1,returnedCount:1,limit:null,intent:null,
        retention:captureRetention(f.env,'coach',at),externalRetention:externalRetentionBirths(f.env,'coach',at)};
      // Tune the synthetic ID to the existing receipt envelope, not a smaller
      // warehouse-only eligibility limit. Quotes/backslashes/UTF8 remain exact.
      row.order[0]=large.slice(0,230000);row.items[0]!.id=row.order[0]!;
      const bytes=new TextEncoder().encode(JSON.stringify(row)+'\n').length;expect(bytes).toBeGreaterThan(900000);expect(bytes).toBeLessThanOrEqual(1024*1024);expect(isProductSortRecord(row)).toBe(true);
      await f.r2.put(hourPrefix('coach',at)+'/product-sort/large.ndjson',JSON.stringify(row)+'\n');
      const transport=f.remote.getMockImplementation()!;let maximum=0;
      f.remote.mockImplementation(async(input,init)=>{maximum=Math.max(maximum,new TextEncoder().encode(String(init?.body)).length);return transport(input,init);});
      await f.advance(()=>f.state.rows.length===1&&[...f.state.sources.values()].some(s=>s.total===1));
      const saved=JSON.parse(f.state.rows[0]!.wire);expect(saved.order).toEqual(row.order);expect(saved.items).toEqual(row.items);expect(saved.record_id).toBe(row.record_id);
      expect(saved.session_id).toBeUndefined();expect(saved.visitor_id).not.toBe(row.visitor_id);expect(maximum).toBeLessThanOrEqual(8*1024*1024);
      expect(f.state.rows[0]!.expiry).toBe(Math.min(row.retention!.ledger!.expiresAt,...Object.values(row.externalRetention!).map(s=>{expect(s).toBeDefined();return s!.expiresAt;})));
    }finally{f.remote.mockRestore();}
  },30000);
  it('rechecks held source custody before new APPLY and minimizes expired or withdrawn commitments before failed optional source reads',async()=>{
    const{runWarehouse}=await import('./warehouse');
    for(const cause of ['revision','expiry','withdrawal']){
      const f=await fixture(),clock=vi.spyOn(Date,'now').mockReturnValue(Date.now());let release:()=>void=()=>undefined;
      try{const input=await f.append(1);await f.advance(()=>!!f.journal()?.pending&&!f.journal().pending.cleanup);const before=f.requests.length;
        const get=f.r2.get.bind(f.r2);
        if(cause==='revision'){
          let entered!:()=>void;const gate=new Promise<void>(r=>{release=r;}),seen=new Promise<void>(r=>{entered=r;});let held=false;
          const spy=vi.spyOn(f.r2,'get').mockImplementation(async key=>{const value=await get(key);if(key===input.key&&!held){held=true;entered();await gate;}return value;});
          const pending=runWarehouse(f.env,'coach');await seen;await f.r2.put(input.key,JSON.stringify(input.records[0])+'\n\n');release();
          expect((await pending).status).toBe('failed');expect(f.requests).toHaveLength(before);spy.mockRestore();
        }else{
          if(cause==='expiry')clock.mockReturnValue(f.journal().pending.expiresAt);else delete f.env.TENANT_CONNECTORS;
          f.remote.mockRejectedValue(new Error('Synthetic cleanup transport unavailable'));
          const spy=vi.spyOn(f.r2,'get').mockImplementation(async key=>{if(key===input.key||key.startsWith('erasures/coach/pending/'))throw Error('Synthetic optional read unavailable');return get(key);});
          await runWarehouse(f.env,'coach');spy.mockRestore();
          const pending=f.journal().pending;expect(pending.cleanup).toBe(true);expect(pending.payload.mode).toBe('barrier');expect(pending.payload.rows).toEqual([]);expect(pending.stamps).toEqual([]);
          expect(JSON.stringify(f.journal())).not.toContain(input.records[0]!.outcome_id);expect(f.requests).toHaveLength(before);
        }
      }finally{release();clock.mockRestore();f.remote.mockRestore();}
    }
  });
  it('rejects incomplete scalar SQL envelopes and bounds serialized POST bytes before transport',async()=>{
    const f=await fixture(),{warehouseStatement}=await import('@/connectors/snowflake'),{connectorDeadline}=await import('@/connectors/model');
    try{const id=crypto.randomUUID(),good={statementHandle:id,resultSetMetaData:{numRows:1,rowType:[{}],partitionInfo:[{rowCount:1}]},data:[['{}']]};
      for(const body of [{...good,statementHandle:crypto.randomUUID()},{...good,resultSetMetaData:{...good.resultSetMetaData,numRows:2}},
        {...good,resultSetMetaData:{...good.resultSetMetaData,partitionInfo:[{rowCount:1},{rowCount:1}]}},{...good,data:[['{}','{}']]},{...good,data:[['{}'],['{}']]}]){
        f.remote.mockResolvedValueOnce(Response.json(body));
        await expect(connectorDeadline(1000,d=>warehouseStatement(f.env,f.config,id,'{}',true,id,d,async()=>undefined,()=>undefined))).rejects.toThrow();
      }
      const before=f.remote.mock.calls.length;
      await expect(connectorDeadline(1000,d=>warehouseStatement(f.env,f.config,id,'"'.repeat(5*1024*1024),false,undefined,d,async()=>undefined,()=>undefined))).rejects.toThrow();
      expect(f.remote).toHaveBeenCalledTimes(before);
      let cancelled=false;
      f.remote.mockResolvedValueOnce(new Response(new ReadableStream({cancel(){cancelled=true;}}),{status:302,headers:{Location:'https://unapproved.invalid/sql'}}));
      await expect(connectorDeadline(1000,d=>warehouseStatement(f.env,f.config,id,'{}',false,undefined,d,async()=>undefined,()=>undefined))).rejects.toThrow();
      expect(cancelled).toBe(true);expect(f.remote).toHaveBeenCalledTimes(before+1);expect(f.remote.mock.calls.at(-1)![1]?.redirect).toBe('manual');
    }finally{f.remote.mockRestore();}
  });
  it('freezes registered historical erasure obligations before a held pre-cutoff APPLY and keeps valid post-cutoff delivery',async()=>{
    const f=await fixture(),{runWarehouse}=await import('./warehouse'),{eraseSubject}=await import('@/identity/erase');
    const at=Date.now(),clock=vi.spyOn(Date,'now').mockReturnValue(at);let release:()=>void=()=>undefined;
    try{
      const values=new Map<string,string>(),kv={get:async(key:string,type?:string)=>{const value=values.get(key);return value===undefined?null:type==='json'?JSON.parse(value):value;},
        put:async(key:string,value:string)=>{values.set(key,value);},delete:async(key:string)=>{values.delete(key);},
        list:async(o?:{prefix?:string})=>({keys:[...values.keys()].filter(k=>k.startsWith(o?.prefix??'')).sort().map(name=>({name})),list_complete:true})};
      f.env.SESSIONS=kv as unknown as KVNamespace;f.env.CACHE=kv as unknown as KVNamespace;
      const input=await f.append(1,()=> 'erased-owner');await f.advance(()=>!!f.journal()?.pending&&!f.journal().pending.cleanup);
      let entered!:()=>void;const seen=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{release=r;}),normal=f.remote.getMockImplementation()!;let held=false;
      f.remote.mockImplementation(async(url,init)=>{const body=JSON.parse(String(init?.body));if(!held&&body.statement.includes('APPLY_DELIVERY')&&JSON.parse(body.bindings['1'].value).rows.length){held=true;entered();await gate;}return normal(url,init);});
      const pending=runWarehouse(f.env,'coach');await seen;
      // This already-registered destination is genuinely absent from today's
      // configuration during the freeze, not merely removed after assertions.
      const configured=f.env.TENANT_CONNECTORS;delete f.env.TENANT_CONNECTORS;
      let receipt=await eraseSubject(f.env,'coach',{visitorId:'erased-owner'},'local-fixture',at);
      for(let n=0;n<20&&receipt.status==='pending';n++)receipt=await eraseSubject(f.env,'coach',{visitorId:'erased-owner'},'local-fixture',at);
      expect(receipt.httpStatus,JSON.stringify(receipt)).toBeLessThan(400);expect(receipt.complete).toBe(false);
      const frozen=[...f.r2.store].filter(([key])=>key.endsWith('/destinations.json')).map(([,raw])=>JSON.parse(raw));
      expect(frozen).toHaveLength(1);expect(frozen[0].obligations).toEqual(expect.arrayContaining([expect.objectContaining({kind:'warehouse',configurationDigest:f.generation,
        configuration:expect.objectContaining({identityNamespace:f.config.identityNamespace,mappingRevision:f.config.mappingRevision}),identities:[expect.objectContaining({subject:'erased-owner',providerId:expect.any(String)})]})]));
      const provider=frozen[0].obligations.find((o:{kind:string})=>o.kind==='warehouse').identities[0].providerId;
      release();expect((await pending).status).toBe('failed');f.remote.mockImplementation(normal);
      await f.advance(()=>f.state.rows.every(row=>row.subject!==provider)&&f.state.cutoffs.get(JSON.stringify(['coach',provider]))===at,30);
      f.env.TENANT_CONNECTORS=configured;
      await f.advance(()=>!f.journal()?.pending&&f.journal()?.due>at,30);
      clock.mockReturnValue(f.journal().due);
      // A new policy-authorized row keeps its own original birth. Do not renew
      // an expired old row or lower the receiver cutoff to make it visible.
      const fresh=await f.append(1,()=> 'erased-owner');await f.advance(()=>f.state.rows.some(row=>row.id===fresh.records[0]!.outcome_id),30);
      const transferred=f.state.rows.find(row=>row.id===fresh.records[0]!.outcome_id)!;
      expect(transferred.ts).toBe(fresh.records[0]!.ts);expect(transferred.expiry).toBe(Math.min(fresh.records[0]!.retention!.ledger!.expiresAt,...Object.values(fresh.records[0]!.externalRetention!).map(s=>{expect(s).toBeDefined();return s!.expiresAt;})));
      expect(f.state.cutoffs.get(JSON.stringify(['coach',provider]))).toBe(at);
      expect(f.state.rows.some(row=>row.id===input.records[0]!.outcome_id)).toBe(false);
      delete f.env.TENANT_CONNECTORS;expect([...f.r2.store].filter(([key])=>key.endsWith('/destinations.json')).map(([,raw])=>JSON.parse(raw))).toEqual(frozen);
    }finally{release();clock.mockRestore();f.remote.mockRestore();}
  });
  it('shares one cron slice and advances lexical tenant continuation after removals and additions',async()=>{
    const f=await fixture(),{runWarehouses}=await import('./warehouse');try{
      const tenants=Array.from({length:100},(_,i)=>'tenant-'+String(i).padStart(3,'0'));
      f.env.TENANTS=JSON.stringify({provisioned:tenants});delete f.env.TENANT_CONNECTORS;
      for(const expected of ['tenant-000','tenant-001','tenant-003','tenant-004']){
        const list=expected==='tenant-003'?tenants.filter(t=>!['tenant-001','tenant-002'].includes(t)):tenants;
        const before=f.r2.calls;await runWarehouses(f.env,list);expect(f.r2.calls-before).toBeLessThanOrEqual(4096);
        expect(JSON.parse(f.r2.store.get('warehouse/v1/schedule.json')!).after).toBe(expected);
      }
      expect(f.requests).toHaveLength(0);
    }finally{f.remote.mockRestore();}
  });
});
