// src/ledger/erasure.test.ts
// CW28 (doc 22 §15): a tombstone hides a visitor's rows at once, the rewrite
// removes them from the batch objects newest day first over the retention
// window, records scan completion but preserves the barrier, resumes past its cap,
// and never touches another visitor or a row from after the erasure.

import { describe, it, expect, vi } from 'vitest';
import { persistDeliveries, writeBatches } from './writer';
import { ts36, type LedgerMessage } from './records';
import { dayOf, eraseVisitorLedger, resetVisitorRing, hidden, loadTombstones, pendingPrefix, retiredPrefix, rewriteErasures, rewriteTenantErasures, rewriteExpiredLedger, tombstoneKey, withoutErased, writeTombstone } from './erasure';
import type { DecisionRecord } from '@/content/types';
import { createHash } from 'node:crypto';
import { DELIVERY_FIELD, MANAGED_MARKER, managedKey, type Delivery } from './delivery';
import { retentionBirth, type RetentionEnv } from '@/retention';
import type { Env } from '@/types/env';
import { ShopperReflex } from '@/durable-objects/ShopperReflex';
import { recoveryDigest } from './recovery';

function erasureEnvironment(r2: FakeR2, ring?: DurableObjectNamespace): Env {
  const env = { STORAGE: r2, DECISION_RING: ring, TENANTS: JSON.stringify({ provisioned: ['coach'] }) } as unknown as Env;
  const objects = new Map<string, ShopperReflex>();
  env.SHOPPER_REFLEX = { idFromName: (name: string) => name, get: (name: string) => ({ fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    let object = objects.get(name);
    if (!object) {
      const data = new Map<string, unknown>();
      const state = { id: name, storage: { get: async (key: string) => structuredClone(data.get(key)),
        put: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); }, list: async () => structuredClone(data) },
        getWebSockets: () => [] } as unknown as DurableObjectState;
      object = new ShopperReflex(state, env); objects.set(name, object);
    }
    return object.fetch(new Request(input, init));
  } }) } as unknown as DurableObjectNamespace;
  return env;
}

class FakeR2 {
  store = new Map<string, string>(); puts = 0; deletes = 0;
  completedFrom: Array<{ tenant: string; id: string; phase: string }> = [];
  opens: string[] = [];
  mutations: string[] = [];
  async put(key: string, body: string, options?: R2PutOptions): Promise<unknown> {
    const old = this.store.get(key), condition = options?.onlyIf as R2Conditional | undefined;
    if (condition?.etagDoesNotMatch === '*' && old !== undefined || condition?.etagMatches !== undefined && (old === undefined || createHash('md5').update(old).digest('hex') !== condition.etagMatches)) return null;
    if (key === 'erasures/coach/rewrite.json' && JSON.parse(body).version === 2 && old !== undefined) {
      expect(condition?.etagMatches).toBe(createHash('md5').update(old).digest('hex'));
      const prior = JSON.parse(old); this.completedFrom.push({ tenant: prior.tenant, id: prior.id, phase: prior.phase });
    }
    if (!key.startsWith('erasures/')) this.mutations.push(`put ${key}`); this.puts++; this.store.set(key, body); return { etag: createHash('md5').update(body).digest('hex') };
  }
  async get(key: string) { if (!key.startsWith('erasures/')) this.opens.push(key); const b = this.store.get(key); return b === undefined ? null : { text: async () => b, etag: createHash('md5').update(b).digest('hex') }; }
  async delete(key: string) { if (!key.startsWith('erasures/')) this.mutations.push(`delete ${key}`); this.deletes++; this.store.delete(key); }
  async list(opts: { prefix: string }) { return { objects: [...this.store.keys()].filter((k) => k.startsWith(opts.prefix)).sort().map((key) => ({ key })), truncated: false }; }
  keys(prefix: string) { return [...this.store.keys()].filter((k) => k.startsWith(prefix)).sort(); }
  rows(prefix: string) { return this.keys(prefix).flatMap((k) => this.store.get(k)!.split('\n').filter(Boolean).map((l) => JSON.parse(l) as { visitor_id: string; ts: number })); }
}
class ManagedR2 extends FakeR2 {
  metadata = new Map<string, Record<string, string>>();
  etag(body: string) { return createHash('md5').update(body).digest('hex'); }
  async put(key: string, body: string, options?: R2PutOptions) {
    const current = this.store.get(key), condition = options?.onlyIf as R2Conditional | undefined;
    if (condition?.etagDoesNotMatch === '*' && current !== undefined) return null;
    if (condition?.etagMatches !== undefined && (current === undefined || this.etag(current) !== condition.etagMatches)) return null;
    await super.put(key, body, options); this.metadata.set(key, { ...options?.customMetadata }); return { etag: this.etag(body) };
  }
  async get(key: string) {
    const object = await super.get(key), body = this.store.get(key);
    return object && body !== undefined ? { ...object, etag: this.etag(body), customMetadata: this.metadata.get(key), size: new TextEncoder().encode(body).length } : null;
  }
}

const DAY = 86_400_000;
const D = Date.UTC(2026, 10, 27, 14, 0, 0);          // 2026-11-27 14:00, the erasure day
const dec = (visitor: string, ts: number, n = 0): LedgerMessage => ({
  kind: 'ledger', type: 'decision',
  record: { decision_id: `coach:${ts36(ts)}:${visitor}:home:hero:${n}`, tenant: 'coach', brand: 'coach', visitor_id: visitor, ts, page: 'home', slot: 'hero', item_id: 'a' } as unknown as DecisionRecord,
});
const out = (visitor: string, ts: number): LedgerMessage => ({
  kind: 'ledger', type: 'outcome',
  record: { outcome_id: `coach:${ts36(ts)}:${visitor}:click`, tenant: 'coach', brand: 'coach', visitor_id: visitor, ts, type: 'click', event: 'click', item_id: 'a', slot: 'hero', value: null, currency: null, margin: null, products: null, session_id: null, arm: null },
});

/**
 * Two days of ledger. Objects are per stream and hour, so: 11-26 14h decisions hold only v1 (will empty);
 * 11-26 15h decisions are mixed (rewritten) and its outcomes hold only v1 (will empty); 11-27 13h decisions
 * are mixed (rewritten); 11-27 14h holds v1's one row from after the erasure (untouched).
 */
async function seed(r2: FakeR2) {
  const before = D - DAY;
  await writeBatches(r2, [dec('v1', before + 1000), dec('v1', before + 2000, 1)], 'b1');
  await writeBatches(r2, [dec('v2', before + 3_600_000), dec('v1', before + 3_600_500, 1), out('v1', before + 3_601_000)], 'b2');
  await writeBatches(r2, [dec('v1', D - 60_000), dec('v2', D - 50_000), dec('v1', D + 60_000, 2)], 'b3');
}

describe('CW28 erasure across the ledger', () => {
  it('W06.12 authenticates actual partial-survivor writer appends and lost-ack recovery without inventing v1 subset proof', async () => {
    for (const mode of ['before', 'lost-ack', 'v1-subset'] as const) {
      const r2 = new ManagedR2();
      const policy = { TENANTS: JSON.stringify({ provisioned: ['coach'] }), RETENTION: JSON.stringify({ version: 1, tenants: { coach: { ledger: {
        id: 'current-writer', revision: 1, durationMs: 365 * DAY, basis: 'admitted', renewal: 'new-record-only' } } } }) } as RetentionEnv;
      const tagged = (visitor: string, at: number) => { const row = out(visitor, at); row.record.retention = { ledger: retentionBirth(policy, 'coach', 'ledger', at) }; return row; };
      const a: Delivery = { id: crypto.randomUUID(), messages: [tagged('erased', D + 1000)] },
        b: Delivery = { id: crypto.randomUUID(), messages: [tagged('suppressed', D + 1000), tagged('survivor', D + 2000)] };
      await writeTombstone(r2, 'coach', 'suppressed', 'fixture', D + 1000);
      expect(await persistDeliveries(r2, [a, b])).toMatchObject({ ok: true, newlyStored: 2, suppressed: 1, dispositions: ['ack', 'ack'] });
      const key = r2.keys('coach/')[0]!, lines = r2.store.get(key)!.trimEnd().split('\n'), before = lines[0]! + '\n';
      const claimKey = r2.keys('ledger-delivery/claims/').find(key => key.endsWith(b.id + '.json'))!;
      const fullClaim = JSON.parse(r2.store.get(claimKey)!);
      expect(fullClaim).toMatchObject({ version: 2, count: 2, rows: [{ ordinal: 0 }, { ordinal: 1 }] });
      if (mode === 'v1-subset') { const { rows: _rows, ...legacy } = fullClaim; r2.store.set(claimKey, JSON.stringify({ ...legacy, version: 1 })); }
      r2.store.set(key, before); // Exact earlier incomplete data object; immutable original claims survive.
      await writeTombstone(r2, 'coach', 'erased', 'fixture', D + 1500);
      const list = r2.list.bind(r2), put = r2.put.bind(r2); let reads = 0, interrupted = false;
      let writerEntered!: () => void, releaseWriter!: () => void, eraserEntered!: () => void, releaseEraser!: () => void;
      const writerAtGate = new Promise<void>(resolve => { writerEntered = resolve; }), writerGate = new Promise<void>(resolve => { releaseWriter = resolve; });
      const eraserAtGate = new Promise<void>(resolve => { eraserEntered = resolve; }), eraserGate = new Promise<void>(resolve => { releaseEraser = resolve; });
      const listing = vi.spyOn(r2, 'list').mockImplementation(async options => {
        const result = await list(options);
        if (options.prefix === pendingPrefix('coach') && ++reads === 2) { writerEntered(); await writerGate; }
        return result;
      });
      const writing = vi.spyOn(r2, 'put').mockImplementation(async (name, bytes, options) => {
        if (name === key && !interrupted) {
          interrupted = true;
          eraserEntered(); await eraserGate;
        }
        return put(name, bytes, options);
      });
      const writer = persistDeliveries(r2, [b]); await writerAtGate;
      const erased = rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 1 }).then(() => null, error => error);
      await eraserAtGate; releaseWriter();
      expect(await writer).toMatchObject({ ok: true, newlyStored: 1, suppressed: 1, dispositions: ['ack'] });
      releaseEraser(); expect(await erased).toBeInstanceOf(Error); listing.mockRestore(); writing.mockRestore();
      const journal = r2.store.get('erasures/coach/rewrite.json'), physical = r2.store.get(key);
      if (mode === 'v1-subset') {
        await expect(rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 1 })).rejects.toThrow();
        expect(r2.store.get(key)).toBe(physical); expect(r2.store.get('erasures/coach/rewrite.json')).toBe(journal);
      } else {
        if (mode === 'lost-ack') {
          const lost = vi.spyOn(r2, 'put').mockImplementation(async (name, bytes, options) => {
            const result = await put(name, bytes, options);
            if (name === key && result !== null) throw new Error('synthetic proved erasure acknowledgement lost');
            return result;
          });
          await expect(rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 1 })).rejects.toThrow(); lost.mockRestore();
          const proved = r2.store.get('erasures/coach/rewrite.json'), after = r2.store.get(key), original = r2.store.get(claimKey)!;
          const { rows: _rows, ...downgraded } = JSON.parse(original); r2.store.set(claimKey, JSON.stringify({ ...downgraded, version: 1 }));
          await expect(rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 1 })).rejects.toThrow();
          expect(r2.store.get('erasures/coach/rewrite.json')).toBe(proved); expect(r2.store.get(key)).toBe(after);
          r2.store.set(claimKey, original);
          // A streamed BOM is changed claim bytes, not a normalized duplicate
          // of the immutable witness already saved in the recovery intent.
          r2.store.set(claimKey, '\ufeff' + original);
          const get = r2.get.bind(r2);
          const streamed = vi.spyOn(r2, 'get').mockImplementation(async name => {
            const object = await get(name);
            if (name !== claimKey || !object) return object;
            const bytes = new TextEncoder().encode(r2.store.get(name)!);
            return { ...object, size: bytes.byteLength, body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } }) };
          });
          await expect(rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 1 })).rejects.toThrow();
          expect(r2.store.get('erasures/coach/rewrite.json')).toBe(proved); expect(r2.store.get(key)).toBe(after);
          streamed.mockRestore(); r2.store.set(claimKey, original);
        }
        expect(await rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 1 })).toMatchObject({ rows_removed: 1 });
        expect(r2.rows('coach/').map(row => row.visitor_id)).toEqual(['survivor']);
        expect(JSON.parse(r2.store.get(key)!.trim())['_ledger_delivery']).toEqual({ id: b.id, ordinal: 1 });
        expect((await rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 1 })).rows_removed).toBe(0);
      }
      expect(JSON.parse(r2.store.get(claimKey)!)).toEqual(mode === 'v1-subset' ? (() => { const { rows: _rows, ...legacy } = fullClaim; return { ...legacy, version: 1 }; })() : fullClaim);
    }
  });

  it('W06.12 resumes only claim-proven BEFORE and lost-ack AFTER suffixes, retaining exact counters and unproven-claim refusal', async () => {
    for (const branch of ['before', 'after', 'missing-claim', 'changed-claim', 'normalized-line'] as const) {
      const r2 = new ManagedR2(), a: Delivery = { id: crypto.randomUUID(), messages: [out('erased', D + 1000)] },
        b: Delivery = { id: crypto.randomUUID(), messages: [out('survivor', D + 2000)] };
      expect((await persistDeliveries(r2, [a, b])).ok).toBe(true);
      const key = r2.keys('coach/')[0]!, all = r2.store.get(key)!.trimEnd().split('\n'), before = all[0]! + '\n', suffix = all[1]! + '\n';
      // Durable claims survived an earlier incomplete grouped data write.
      r2.store.set(key, before);
      await writeTombstone(r2, 'coach', 'erased', 'fixture', D + 1500);
      const put = r2.put.bind(r2); let interrupted = false;
      const fault = vi.spyOn(r2, 'put').mockImplementation(async (name, bytes, options) => {
        if (name === key && !interrupted) {
          interrupted = true;
          if (branch === 'after') { await put(name, bytes, options); await put(name, bytes + suffix, { customMetadata: r2.metadata.get(key) }); throw new Error('synthetic lost acknowledgement before completion'); }
          await put(name, before + suffix, { customMetadata: r2.metadata.get(key) });
        }
        return put(name, bytes, options);
      });
      await expect(rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 1 })).rejects.toThrow(); fault.mockRestore();
      expect(interrupted).toBe(true);
      const journal = r2.store.get('erasures/coach/rewrite.json')!, claim = r2.keys('ledger-delivery/claims/').find(key => key.endsWith(b.id + '.json'))!;
      if (branch === 'missing-claim') r2.store.delete(claim);
      if (branch === 'changed-claim') r2.store.set(claim, r2.store.get(claim)!.replace('"count":1', '"count":2'));
      if (branch === 'normalized-line') r2.store.set(key, before + JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(suffix)).reverse())) + '\n');
      if (branch === 'missing-claim' || branch === 'changed-claim' || branch === 'normalized-line') {
        const physical = r2.store.get(key);
        await expect(rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 1 })).rejects.toThrow();
        expect(r2.store.get(key)).toBe(physical); expect(r2.store.get('erasures/coach/rewrite.json')).toBe(journal);
        expect((await loadTombstones(r2, 'coach')).get('erased')?.rows_removed).toBe(0); continue;
      }
      expect(await rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 1 })).toMatchObject({ rows_removed: 1, objects_rewritten: 1 });
      expect(r2.store.get(key)).toBe(suffix);
      expect(r2.rows('coach/').map(row => row.visitor_id)).toEqual(['survivor']);
      expect((await loadTombstones(r2, 'coach')).get('erased')?.rows_removed).toBe(1);
      expect((await rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 1 })).rows_removed).toBe(0);
    }
  });

  it('W06.12 retains complete large v2 partition claims, noncontiguous ordinals and strict malformed-proof refusal', async () => {
    const r2 = new ManagedR2(), messages = Array.from({ length: 66 }, (_, i) => out('proof-' + i, D + (i === 1 ? 3600000 : 0) + i));
    const delivery: Delivery = { id: crypto.randomUUID(), messages };
    expect(await persistDeliveries(r2, [delivery])).toMatchObject({ ok: true, newlyStored: 66, dispositions: ['ack'] });
    const key = r2.keys('ledger-delivery/claims/').find(key => key.includes('/14/'))!, original = r2.store.get(key)!, claim = JSON.parse(original);
    expect(new TextEncoder().encode(original).byteLength).toBeGreaterThan(4096);
    expect(claim).toMatchObject({ version: 2, count: 65 });
    expect(claim.rows.map((row: { ordinal: number }) => row.ordinal)).toEqual(messages.map((_, i) => i).filter(i => i !== 1));
    expect(await persistDeliveries(r2, [delivery])).toMatchObject({ ok: true, newlyStored: 0, alreadyPresent: 66, dispositions: ['ack'] });
    for (const fault of ['duplicate', 'range', 'hash', 'missing']) {
      const invalid = structuredClone(claim);
      if (fault === 'duplicate') invalid.rows[1].ordinal = invalid.rows[0].ordinal;
      if (fault === 'range') invalid.rows.at(-1).ordinal = 66;
      if (fault === 'hash') invalid.rows[0].digest = '0'.repeat(64);
      if (fault === 'missing') delete invalid.rows;
      r2.store.set(key, JSON.stringify(invalid)); const before = [...r2.store];
      expect(await persistDeliveries(r2, [delivery])).toMatchObject({ ok: false, dispositions: ['retry'], newlyStored: 0 });
      expect([...r2.store]).toEqual(before); r2.store.set(key, original);
    }
    const { rows: _rows, ...legacy } = claim; r2.store.set(key, JSON.stringify({ ...legacy, version: 1 }));
    const v1 = r2.store.get(key);
    expect(await persistDeliveries(r2, [delivery])).toMatchObject({ ok: true, newlyStored: 0, alreadyPresent: 66, dispositions: ['ack'] });
    expect(r2.store.get(key)).toBe(v1); // An old complete claim is never silently upgraded.
  });

  it('W06.12 shares the physical object budget and preserves expiry continuation through erasure-mode handoffs', async () => {
    class Pages extends ManagedR2 {
      async list(options: { prefix: string; cursor?: string; limit?: number }) {
        const keys = this.keys(options.prefix), start = Number(options.cursor ?? 0), end = start + (options.limit ?? 1000);
        return { objects: keys.slice(start, end).map(key => ({ key })), truncated: end < keys.length, ...(end < keys.length ? { cursor: String(end) } : {}) };
      }
    }
    const r2 = new Pages(), at = D + 3000;
    const policy = { TENANTS: JSON.stringify({ provisioned: ['coach'] }), RETENTION: JSON.stringify({ version: 1, tenants: { coach: { ledger: {
      id: 'expiry-fixture', revision: 1, durationMs: 1000, basis: 'admitted', renewal: 'new-record-only' } } } }) } as RetentionEnv;
    const stamp = retentionBirth(policy, 'coach', 'ledger', D, D);
    for (let i = 0; i < 120; i++) {
      const message = out('retained-' + i, D + i); message.record.retention = { ledger: stamp };
      await writeBatches(r2, [message], 'expiry-' + i);
    }
    const legacy = out('legacy', D + 500), legacyKey = (await writeBatches(r2, [legacy], 'legacy'))[0]!.key;
    const originalLegacy = r2.store.get(legacyKey);
    expect(await rewriteExpiredLedger(r2, 'coach', at, 100)).toMatchObject({ opened: 100, removed: 100, more: true });
    const saved = JSON.parse(r2.store.get('erasures/coach/rewrite.json')!); expect(saved).toMatchObject({ version: 4, cursor: '100', at });
    await writeTombstone(r2, 'coach', 'unrelated-previous-day', 'fixture', D - DAY + 1000);
    const env = { ...policy, STORAGE: r2 } as unknown as Env;
    let remaining = true;
    for (let attempt = 0; attempt < 40 && remaining; attempt++) {
      if (attempt === 3) await writeTombstone(r2, 'coach', 'unrelated-today', 'fixture', D + 2000);
      const old = r2.opens.length, result = await rewriteTenantErasures(env, 'coach', { now: at + attempt, maxObjects: 1, retentionDays: 1 });
      expect(r2.opens.length - old).toBeLessThanOrEqual(1); expect(result.objects_opened).toBeLessThanOrEqual(1);
      const cursor = JSON.parse(r2.store.get('erasures/coach/rewrite.json')!);
      if (cursor.version === 3) expect(cursor.at).toBe(at);
      remaining = cursor.version !== 4 || cursor.cursor !== null;
    }
    expect(remaining).toBe(false); expect(r2.rows('coach/').map(row => row.visitor_id)).toEqual(['legacy']);
    expect(r2.store.get(legacyKey)).toBe(originalLegacy);
    expect(r2.keys('erasures/coach/pending/')).toHaveLength(2);
  });

  it('W09.02 managed erasure holds CAS conflicts, reconciles lost acknowledgements, and retains empty-object provenance', async () => {
    for (const mode of ['conflict', 'lost-ack', 'empty'] as const) {
      const r2 = new ManagedR2(), delivery: Delivery = { id: crypto.randomUUID(), messages: [dec('v-managed', D + 1000),
        ...(mode === 'empty' ? [] : [dec('v-survivor', D + 61000)])] };
      expect((await persistDeliveries(r2, [delivery])).ok).toBe(true);
      const key = [...r2.store.keys()].find(managedKey)!, journalKey = 'erasures/coach/rewrite.json';
      r2.metadata.set(key, { [MANAGED_MARKER]: '1', preserved: 'yes' });
      await writeTombstone(r2, 'coach', 'v-managed', 'actor', D + 60000);
      const put = r2.put.bind(r2); let fired = false, savedIntent = '';
      const fault = vi.spyOn(r2, 'put').mockImplementation(async (target, body, options) => {
        if (target === key && !fired && mode !== 'empty') {
          fired = true; savedIntent = r2.store.get(journalKey)!;
          if (mode === 'conflict') {
            // A conditional append that won after the eraser read its snapshot.
            const appended = { ...dec('v-racing', D + 60500).record, [DELIVERY_FIELD]: { id: crypto.randomUUID(), ordinal: 0 } };
            await put(key, r2.store.get(key)! + JSON.stringify(appended) + '\n', { customMetadata: r2.metadata.get(key) });
            return put(target, body, options); // stale body ETag: null, never overwrite the append
          }
          await put(target, body, options); throw new Error('synthetic managed write committed, acknowledgement lost');
        }
        return put(target, body, options);
      });
      if (mode === 'empty') await rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 1 });
      else await expect(rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 1 })).rejects.toThrow();
      fault.mockRestore();
      if (mode !== 'empty') {
        expect(r2.store.get(journalKey)).toBe(savedIntent);
        expect((await loadTombstones(r2, 'coach')).get('v-managed')?.rows_removed).toBe(0);
        const puts = r2.puts, before = r2.store.get(key);
        expect(await persistDeliveries(r2, [delivery])).toMatchObject({ ok: false, code: 'recovery_required', newlyStored: 0 });
        expect(r2.puts).toBe(puts); expect(r2.store.get(key)).toBe(before);
        if (mode === 'conflict') {
          await expect(rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 1 })).rejects.toThrow();
          expect(r2.store.get(journalKey)).toBe(savedIntent); expect(r2.store.get(key)).toBe(before);
          expect(r2.rows('coach/').map(row => row.visitor_id)).toEqual(['v-managed', 'v-survivor', 'v-racing']);
          continue;
        }
        const resumed = await rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 1 });
        expect(resumed).toMatchObject({ rows_removed: 1, objects_rewritten: 1, objects_deleted: 0 });
      }
      expect(r2.metadata.get(key)).toEqual({ [MANAGED_MARKER]: '1', preserved: 'yes' });
      expect(r2.store.has(key)).toBe(true); expect(r2.deletes).toBe(0);
      const observed = r2.completedFrom.at(-1)!;
      expect(observed).toEqual({ tenant: 'coach', id: expect.stringMatching(/^[a-f0-9]{32}$/), phase: 'finalizing' });
      expect(JSON.parse(r2.store.get(journalKey)!)).toEqual({ version: 2, tenant: observed.tenant, id: observed.id, complete: true });
      expect(r2.mutations).not.toContain(`delete ${key}`);
      expect((await loadTombstones(r2, 'coach')).get('v-managed')).toMatchObject({ rows_removed: 1, objects_rewritten: 1, objects_deleted: 0 });
      if (mode === 'empty') expect(r2.store.get(key)).toBe('');
      else expect(r2.rows('coach/').map(row => row.visitor_id)).toEqual(['v-survivor']);
      const before = r2.store.get(key), replay = await persistDeliveries(r2, [delivery]);
      expect(replay).toMatchObject({ ok: true, newlyStored: 0, suppressed: 1, alreadyPresent: mode === 'empty' ? 0 : 1 });
      expect(r2.store.get(key)).toBe(before);
      expect((await rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 1 })).rows_removed).toBe(0);
    }
  });
  it('a tombstone hides the visitor\'s rows at or before the erasure, and nothing else', async () => {
    const r2 = new FakeR2();
    await writeTombstone(r2, 'coach', 'v1', 'privacy@coach', D);
    const tombs = await loadTombstones(r2, 'coach');
    expect(tombs.get('v1')?.erased_at).toBe(D);
    expect(hidden(tombs, { visitor_id: 'v1', ts: D })).toBe(true);
    expect(hidden(tombs, { visitor_id: 'v1', ts: D - 1 })).toBe(true);
    expect(hidden(tombs, { visitor_id: 'v1', ts: D + 1 })).toBe(false);
    expect(hidden(tombs, { visitor_id: 'v2', ts: D - 1 })).toBe(false);
    const rows = [{ visitor_id: 'v1', ts: D - 5 }, { visitor_id: 'v2', ts: D - 5 }, { visitor_id: 'v1', ts: D + 5 }];
    expect(withoutErased(rows, tombs).map((r) => `${r.visitor_id}@${r.ts - D}`)).toEqual(['v2@-5', 'v1@5']);
    // Refreshing keeps the later erasure time and the counts.
    await writeTombstone(r2, 'coach', 'v1', 'privacy@coach', D - 10);
    expect((await loadTombstones(r2, 'coach')).get('v1')?.erased_at).toBe(D);
  });

  it('the rewrite removes matching rows, keeps other visitors/post-cutoff rows, and retains the barrier after its completion audit', async () => {
    const r2 = new FakeR2();
    await seed(r2);
    await writeTombstone(r2, 'coach', 'v1', 'privacy@coach', D);
    const r = await rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 3 });
    expect(r.tombstones).toBe(1);
    expect(r.days).toEqual(['2026-11-27', '2026-11-26', '2026-11-25', '2026-11-24']);
    expect(r.rows_removed).toBe(5);           // v1: two at 11-26 14h, a decision and an outcome at 15h, one before the erasure on 11-27
    expect(r.objects_deleted).toBe(2);        // the two objects that held only v1
    expect(r.objects_rewritten).toBe(2);      // the two mixed objects
    expect(r.retired).toBe(1); expect(r.remaining).toBe(0); expect(r.more).toBe(false);
    const left = r2.rows('coach/2026-11-2');
    expect(left.map((x) => `${x.visitor_id}@${Math.round((x.ts - D) / 1000)}`).sort()).toEqual(['v1@60', 'v2@-50', 'v2@-82800']);
    expect(r2.keys(pendingPrefix('coach'))).toEqual([tombstoneKey('coach', 'v1')]);
    expect((await loadTombstones(r2, 'coach')).get('v1')).toMatchObject({ erased_at: D, rewritten_at: D + DAY, window_days: 3 });
    expect(hidden(await loadTombstones(r2, 'coach'), { visitor_id: 'v1', ts: D })).toBe(true);
    const retired = r2.keys(retiredPrefix('coach'));
    expect(retired).toHaveLength(1);
    const audit = JSON.parse(r2.store.get(retired[0]!)!) as Record<string, unknown>;
    expect(audit.visitor_id).toBeUndefined();
    expect(audit).toMatchObject({ tenant: 'coach', erased_at: D, window_days: 3, rows_removed: 5, objects_rewritten: 2, objects_deleted: 2 });
    expect(typeof audit.visitor_hash).toBe('string');
    expect(String(audit.visitor_hash)).not.toContain('v1');
    // A second run has nothing to do.
    const puts = r2.puts, deletes = r2.deletes;
    const again = await rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 3 });
    expect(again.tombstones).toBe(1); expect(again.remaining).toBe(0); expect(again.rows_removed).toBe(0);
    expect(r2.puts).toBe(puts); expect(r2.deletes).toBe(deletes);
    const completed = r2.store.get(tombstoneKey('coach', 'v1'));
    await writeTombstone(r2, 'coach', 'v1', 'retry-actor', D);
    expect(r2.store.get(tombstoneKey('coach', 'v1'))).toBe(completed);
    const later = await writeTombstone(r2, 'coach', 'v1', 'new-actor', D + 1);
    expect(later.tombstone).toMatchObject({ erased_at: D + 1, rows_removed: 5, actor: 'new-actor' });
    expect(later.tombstone).not.toHaveProperty('done_through'); expect(later.tombstone).not.toHaveProperty('rewritten_at'); expect(later.tombstone).not.toHaveProperty('window_days');
  });

  it('caps ledger opens inside a dense day and resumes its durable manifest without prematurely completing that day', async () => {
    const r2 = new FakeR2();
    await seed(r2);
    await writeTombstone(r2, 'coach', 'v1', 'privacy@coach', D);
    const first = await rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 3, maxObjects: 1 });
    expect(first.objects_opened).toBe(1); expect(r2.opens).toHaveLength(1);
    expect(first.days).toEqual([]); expect(first.more).toBe(true); expect(first.retired).toBe(0); expect(first.remaining).toBe(1);
    const tombs = await loadTombstones(r2, 'coach');
    expect(tombs.get('v1')?.done_through).toBeUndefined();
    expect(tombs.get('v1')?.rows_removed).toBe(0); // Durable credits live in the unfinished day journal.
    const journal = JSON.parse(r2.store.get('erasures/coach/rewrite.json')!);
    expect(journal).toMatchObject({ day: '2026-11-27', index: 1, phase: 'scanning', targets: [{ credit: { rows_removed: 1 } }] });
    expect(journal.keys).toHaveLength(2); expect(journal.intent).toBeUndefined();
    expect(hidden(tombs, { visitor_id: 'v1', ts: D - DAY })).toBe(true);   // the 11-26 rows are still hidden by the readers
    expect(r2.rows('coach/2026-11-26').filter((x) => x.visitor_id === 'v1')).toHaveLength(4);
    const second = await rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 3, maxObjects: 100 });
    expect(second.days).toEqual(['2026-11-27', '2026-11-26', '2026-11-25', '2026-11-24']);
    expect(second.rows_removed).toBe(4); expect(second.retired).toBe(1);
    expect(r2.rows('coach/2026-11-26').filter((x) => x.visitor_id === 'v1')).toHaveLength(0);
    expect((await loadTombstones(r2, 'coach')).get('v1')).toMatchObject({ rows_removed: 5, objects_deleted: 2, objects_rewritten: 2 });
    expect(new Set(r2.opens).size).toBe(r2.opens.length);
    const completed = r2.completedFrom.at(-1)!; expect(completed).toMatchObject({ tenant: 'coach', phase: 'finalizing' });
    expect(JSON.parse(r2.store.get('erasures/coach/rewrite.json')!)).toEqual({ version: 2, tenant: 'coach', id: completed.id, complete: true });
    for (const maxObjects of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const opens = r2.opens.length, puts = r2.puts;
      await expect(rewriteErasures(r2, 'coach', { now: D + DAY, maxObjects })).rejects.toThrow();
      expect(r2.opens).toHaveLength(opens); expect(r2.puts).toBe(puts);
    }
  });

  it('never cleans a day that is not over yet, so rows still in the queue are not missed', async () => {
    const r2 = new FakeR2();
    await seed(r2);
    await writeTombstone(r2, 'coach', 'v1', 'privacy@coach', D);
    const r = await rewriteErasures(r2, 'coach', { now: D + 3_600_000, retentionDays: 3 });   // same day, an hour later
    expect(r.days).toEqual([]); expect(r.rows_removed).toBe(0); expect(r.remaining).toBe(1);
    expect((await loadTombstones(r2, 'coach')).get('v1')?.done_through).toBeUndefined();
    expect(dayOf(D)).toBe('2026-11-27');
  });

  it('eraseVisitorLedger writes the tombstone and empties the visitor\'s ring', async () => {
    const r2 = new FakeR2();
    const calls: string[] = [];
    const ns = {
      idFromName: (n: string) => n,
      get: (id: string) => ({ fetch: async (url: string, init?: { method?: string }) => { calls.push(`${id} ${init?.method ?? 'GET'} ${new URL(url).pathname}`); return new Response('{"ok":true,"reset":true}', { status: 200 }); } }),
    } as unknown as DurableObjectNamespace;
    const res = await eraseVisitorLedger(erasureEnvironment(r2, ns), 'coach', 'v1', 'privacy@coach', D);
    expect(res).toEqual({ ok: true, tombstone: { key: tombstoneKey('coach', 'v1'), erased_at: D }, ring: 'reset' });
    expect(calls).toEqual(['coach:v1 POST /erase']);
    expect(r2.store.has(tombstoneKey('coach', 'v1'))).toBe(true);
    const unbound = await eraseVisitorLedger(erasureEnvironment(r2), 'coach', 'v3', 'privacy@coach', D);
    expect(unbound.ring).toBe('unbound');
  });

  it('preserves same/earlier retries and holds a later cutoff until its anchored day has recovered', async () => {
    const r2 = new FakeR2(); await seed(r2); await writeTombstone(r2, 'coach', 'v1', 'original-actor', D);
    await rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 3, maxObjects: 1 });
    const key = tombstoneKey('coach', 'v1'), before = r2.store.get(key), puts = r2.puts;
    for (const at of [D, D - 1]) await writeTombstone(r2, 'coach', 'v1', 'retry-actor', at);
    expect(r2.store.get(key)).toBe(before); expect(r2.puts).toBe(puts);
    const journal = r2.store.get('erasures/coach/rewrite.json');
    await expect(writeTombstone(r2, 'coach', 'v1', 'new-actor', D + 1)).rejects.toThrow('recovery required');
    expect(r2.store.get(key)).toBe(before); expect(r2.store.get('erasures/coach/rewrite.json')).toBe(journal);
    await rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 3 });
    const later = await writeTombstone(r2, 'coach', 'v1', 'new-actor', D + 1);
    expect(later.tombstone).toMatchObject({ erased_at: D + 1, actor: 'new-actor', rows_removed: 5 });
    expect(later.tombstone).not.toHaveProperty('done_through');
  });

  it('fails closed on unreadable/corrupt prior tombstones and reports malformed/failed ring acknowledgments without restarting progress', async () => {
    const valid = { tenant: 'coach', visitor_id: 'v1', erased_at: D, actor: 'actor', rows_removed: 0, objects_rewritten: 0, objects_deleted: 0 };
    const malformed = [{ erased_at: -1 }, { erased_at: D + 0.5 }, { erased_at: Number.MAX_SAFE_INTEGER + 1 },
      { done_through: '9999-99-99' }, { done_through: '2025-02-29' }, { actor: '' }, { actor: 'x'.repeat(201) },
      { tenant: 'harbor' }, { visitor_id: 'other' }, { visitor_id: 'bad/visitor' }, { rows_removed: -1 },
      { rewritten_at: D + DAY }, { window_days: 3 }, { rewritten_at: D + DAY, window_days: 3, done_through: '2026-11-27' }];
    for (const value of ['null', '{}', 'not-json', JSON.stringify({ tenant: 'other', visitor_id: 'v1', erased_at: D }),
      ...malformed.map(change => JSON.stringify({ ...valid, ...change }))]) {
      const r2 = new FakeR2(); r2.store.set(tombstoneKey('coach', 'v1'), value);
      await expect(writeTombstone(r2, 'coach', 'v1', 'actor', D)).rejects.toThrow(); expect(r2.puts).toBe(0);
      await expect(loadTombstones(r2, 'coach')).rejects.toThrow(); expect(r2.puts).toBe(0);
    }
    const r2 = new FakeR2(); const reader = vi.spyOn(r2, 'get').mockRejectedValueOnce(new Error('synthetic read failure'));
    await expect(writeTombstone(r2, 'coach', 'v1', 'actor', D)).rejects.toThrow(); expect(r2.puts).toBe(0); reader.mockRestore();
    await writeTombstone(r2, 'coach', 'v1', 'actor', D); const puts = r2.puts,before=new Map(r2.store);
    const barrier='ledger-quarantine-erasure/'+await recoveryDigest({tenant:'coach',subject:'v1'})+'.json';
    for (const [body, status] of [[{ ok: true }, 200], [{ ok: false, reset: true }, 200], [{ ok: true, reset: true }, 503], [null, 200]] as const) {
      const ns = { idFromName: (n: string) => n, get: () => ({ fetch: async () => Response.json(body, { status }) }) } as unknown as DurableObjectNamespace;
      const failed = await eraseVisitorLedger(erasureEnvironment(r2, ns), 'coach', 'v1', 'retry', D);
      expect(failed.ok).toBe(false); expect(failed.ring).toBe('failed'); expect(r2.puts).toBe(puts+1);
      expect(JSON.parse(r2.store.get(barrier)!)).toMatchObject({cutoff:D,cursor:null,complete:true});
      expect(new Map([...r2.store].filter(([key])=>key!==barrier))).toEqual(before);
      expect(await resetVisitorRing({ DECISION_RING: ns }, 'coach', 'v1')).toBe('failed'); expect(r2.puts).toBe(puts+1);
    }
  });

  it('reconciles before/after failures in prepare, intent, mutation, checkpoint and multi-target finalization exactly once', async () => {
    const journalKey = 'erasures/coach/rewrite.json', day = dayOf(D);
    for (const stage of ['create', 'anchor', 'intent', 'rewrite', 'delete', 'checkpoint', 'finalize', 'cleanup']) {
      for (const committed of [false, true]) {
        const r2 = new FakeR2(), at = D + 120_000, deleting = stage === 'delete';
        await writeBatches(r2, [dec('v1', D + 60_000), dec('v2', D + 61_000),
          ...(!deleting ? [dec('v3', D + 62_000), dec('v1', D + 180_000, 1)] : [])], 'recover');
        const objectKey = r2.keys('coach/')[0]!, original = r2.store.get(objectKey)!;
        const foreignKey = `harbor/${day}/14/decision/untouched.ndjson`;
        await r2.put(foreignKey, original);
        for (const visitor of ['v1', 'v2']) await writeTombstone(r2, 'coach', visitor, 'actor', at);
        r2.mutations = []; r2.opens = [];
        let fired = false;
        const put = r2.put.bind(r2), del = r2.delete.bind(r2);
        const putting = vi.spyOn(r2, 'put').mockImplementation(async (key, body, options) => {
          const metadata = key.startsWith('erasures/') ? JSON.parse(body) : null;
          const selected = (stage === 'create' && key === journalKey && metadata.phase === 'preparing')
            || (stage === 'anchor' && key === tombstoneKey('coach', 'v2') && metadata.rewrite)
            || (stage === 'intent' && key === journalKey && metadata.intent)
            || (stage === 'rewrite' && key === objectKey)
            || (stage === 'checkpoint' && key === journalKey && metadata.index === 1 && metadata.phase === 'scanning' && !metadata.intent)
            || (stage === 'finalize' && key === tombstoneKey('coach', 'v2') && metadata.done_through === day && !metadata.rewrite)
            || (stage === 'cleanup' && key === journalKey && metadata.version === 2 && metadata.complete === true);
          if (!fired && selected) {
            fired = true; if (committed) await put(key, body, options);
            throw new Error(`synthetic ${stage} ${committed ? 'after' : 'before'}`);
          }
          return put(key, body, options);
        });
        const deletingCall = vi.spyOn(r2, 'delete').mockImplementation(async key => {
          expect(key).not.toBe(journalKey);
          if (!fired && stage === 'delete' && key === objectKey) {
            fired = true; if (committed) await del(key);
            throw new Error(`synthetic ${stage} ${committed ? 'after' : 'before'}`);
          }
          await del(key);
        });
        await expect(rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 1, maxObjects: 1 })).rejects.toThrow('synthetic');
        expect(fired, `${stage}/${committed}`).toBe(true);
        putting.mockRestore(); deletingCall.mockRestore();
        expect(r2.opens.length).toBeLessThanOrEqual(1);
        const durable = r2.store.get(journalKey);
        if (durable && JSON.parse(durable).version !== 2 && JSON.parse(durable).phase !== 'finalizing') {
          for (const t of (await loadTombstones(r2, 'coach')).values()) expect(t.done_through).toBeUndefined();
        }
        const opens = r2.opens.length;
        const resumed = await rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 1, maxObjects: 1 });
        expect(resumed.objects_opened).toBeLessThanOrEqual(1); expect(r2.opens.length - opens).toBe(resumed.objects_opened);
        await rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 1, maxObjects: 1 });
        const completed = await loadTombstones(r2, 'coach');
        for (const t of completed.values()) expect(t).toMatchObject({ rows_removed: 1, objects_deleted: deleting ? 1 : 0,
          objects_rewritten: deleting ? 0 : 1, done_through: '2026-11-26', rewritten_at: D + DAY });
        expect(r2.mutations).toEqual([`${deleting ? 'delete' : 'put'} ${objectKey}`]);
        expect(r2.rows('coach/').map(r => `${r.visitor_id}@${r.ts - D}`)).toEqual(deleting ? [] : ['v3@62000', 'v1@180000']);
        expect(r2.store.get(foreignKey)).toBe(original); expect(r2.opens).not.toContain(foreignKey);
        const marker = r2.completedFrom.at(-1)!; expect(marker).toMatchObject({ tenant: 'coach', phase: 'finalizing' });
        expect(JSON.parse(r2.store.get(journalKey)!)).toEqual({ version: 2, tenant: 'coach', id: marker.id, complete: true });
        const puts = r2.puts, deletes = r2.deletes;
        const again = await rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 1 });
        expect(again.rows_removed).toBe(0); expect(again.objects_opened).toBe(0);
        expect(r2.puts).toBe(puts); expect(r2.deletes).toBe(deletes);
      }
    }
  });

  it('rejects missing/corrupt coordinators, conflicting objects and unbound manifests without inventing removal credits', async () => {
    const initial = new FakeR2(), journalKey = 'erasures/coach/rewrite.json';
    await seed(initial); await writeTombstone(initial, 'coach', 'v1', 'actor', D);
    const put = initial.put.bind(initial);
    const fault = vi.spyOn(initial, 'put').mockImplementation(async (key, body, options) => {
      const result = await put(key, body, options);
      if (key === journalKey && JSON.parse(body).intent) throw new Error('synthetic prepared intent');
      return result;
    });
    await expect(rewriteErasures(initial, 'coach', { now: D + DAY, retentionDays: 3 })).rejects.toThrow('prepared intent');
    fault.mockRestore();
    const originalJournal = JSON.parse(initial.store.get(journalKey)!);
    const objectKey = originalJournal.keys[originalJournal.index];
    for (const change of ['missing', 'json', 'tenant', 'day', 'foreign-key', 'duplicate-key', 'cutoff', 'hash', 'counter', 'anchor', 'changed-object', 'missing-object']) {
      const r2 = new FakeR2(); r2.store = new Map(initial.store);
      const journal = JSON.parse(initial.store.get(journalKey)!);
      if (change === 'missing') r2.store.delete(journalKey);
      else if (change === 'json') r2.store.set(journalKey, 'not-json');
      else if (change === 'anchor') {
        const key = tombstoneKey('coach', 'v1'), t = JSON.parse(r2.store.get(key)!);
        t.rewrite.id = 'a'.repeat(32); r2.store.set(key, JSON.stringify(t));
      } else if (change === 'changed-object') r2.store.set(objectKey, 'conflicting object\n');
      else if (change === 'missing-object') r2.store.delete(objectKey);
      else {
        if (change === 'tenant') journal.tenant = 'harbor';
        if (change === 'day') journal.day = '2026-99-99';
        if (change === 'foreign-key') journal.keys[0] = journal.keys[0].replace('coach/', 'harbor/');
        if (change === 'duplicate-key') journal.keys[1] = journal.keys[0];
        if (change === 'cutoff') journal.targets[0].base.erased_at++;
        if (change === 'hash') journal.intent.before = 'invalid';
        if (change === 'counter') journal.targets[0].credit.rows_removed = 10;
        r2.store.set(journalKey, JSON.stringify(journal));
      }
      await expect(rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 3, maxObjects: 1 })).rejects.toThrow();
      expect(r2.mutations, change).toEqual([]); expect(r2.puts, change).toBe(0);
      expect(r2.opens.length).toBeLessThanOrEqual(1);
      expect((await loadTombstones(r2, 'coach')).get('v1')?.rows_removed).toBe(0);
    }
  });

  it('keeps prior object credit through a mid-day failure and accounts a listed disappearance as zero', async () => {
    const r2 = new FakeR2(), journalKey = 'erasures/coach/rewrite.json';
    for (const [i, time] of [D - 3_600_000, D - 7_200_000, D - 10_800_000].entries()) await writeBatches(r2, [dec('v1', time)], `dense-${i}`);
    await writeTombstone(r2, 'coach', 'v1', 'actor', D);
    const keys = r2.keys('coach/'), get = r2.get.bind(r2);
    const fault = vi.spyOn(r2, 'get').mockImplementation(async key => {
      if (key === keys[1]) throw new Error('synthetic second-object read failure');
      return get(key);
    });
    await expect(rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 1 })).rejects.toThrow('second-object');
    fault.mockRestore();
    expect(JSON.parse(r2.store.get(journalKey)!)).toMatchObject({ index: 1, targets: [{ credit: { rows_removed: 1, objects_deleted: 1 } }] });
    expect((await loadTombstones(r2, 'coach')).get('v1')?.done_through).toBeUndefined();
    r2.store.delete(keys[1]!); // Externally missing after listing: it cannot be claimed as our removal.
    const resumed = await rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 1, maxObjects: 1 });
    expect(resumed).toMatchObject({ objects_opened: 1, rows_removed: 0, objects_deleted: 0, days: [], more: true });
    expect(JSON.parse(r2.store.get(journalKey)!)).toMatchObject({ index: 2, targets: [{ credit: { rows_removed: 1, objects_deleted: 1 } }] });
    await rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 1 });
    expect((await loadTombstones(r2, 'coach')).get('v1')).toMatchObject({ rows_removed: 2, objects_deleted: 2, rewritten_at: D + DAY });
    expect(r2.rows('coach/')).toEqual([]); expect(r2.opens.filter(key => key === keys[0])).toHaveLength(1);
  });

  it('W06.12 checkpoints only definite known-legacy absence with zero credit and an unchanged CAS owner', async () => {
    for (const mode of ['null', 'undefined', 'error', 'managed', 'unknown', 'stale-cas'] as const) {
      const r2 = new FakeR2(), journalKey = 'erasures/coach/rewrite.json';
      await writeBatches(r2, [dec('v1', D - 60_000)], 'known-legacy');
      let key = r2.keys('coach/')[0]!;
      if (mode === 'managed' || mode === 'unknown') {
        const replacement = key.replace('known-legacy.ndjson', mode === 'managed' ? 'managed-malformed.ndjson' : 'unknown/name.ndjson');
        r2.store.set(replacement, r2.store.get(key)!); r2.store.delete(key); key = replacement;
      }
      await writeTombstone(r2, 'coach', 'v1', 'fixture', D); r2.mutations = [];
      const get = r2.get.bind(r2); let captured: string | undefined;
      const fault = vi.spyOn(r2, 'get').mockImplementation(async name => {
        if (name !== key) return get(name);
        captured = r2.store.get(journalKey); r2.store.delete(key);
        if (mode === 'error') throw new Error('synthetic unavailable read');
        if (mode === 'undefined') return undefined as never;
        if (mode === 'stale-cas') {
          const advanced = { ...JSON.parse(captured!), index: 1 };
          r2.store.set(journalKey, JSON.stringify(advanced)); captured = r2.store.get(journalKey);
        }
        return null;
      });
      if (mode === 'null') {
        expect(await rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 1, maxObjects: 1 }))
          .toMatchObject({ rows_removed: 0, objects_deleted: 0, objects_rewritten: 0 });
      } else {
        await expect(rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 1, maxObjects: 1 })).rejects.toThrow();
        if (captured !== undefined) expect(r2.store.get(journalKey)).toBe(captured);
        expect((await loadTombstones(r2, 'coach')).get('v1')?.done_through).toBeUndefined();
      }
      expect((await loadTombstones(r2, 'coach')).get('v1')?.rows_removed).toBe(0);
      expect(r2.mutations).toEqual([]); expect(r2.deletes).toBe(0); fault.mockRestore();
    }
  });

  it('retains scan progress across audit/completion failures and finalizes a reached floor on restart without rescanning', async () => {
    for (const failure of ['audit', 'marker', 'ambiguous-marker']) {
      const r2 = new FakeR2(); await seed(r2); await writeTombstone(r2, 'coach', 'v1', 'actor', D);
      const put = r2.put.bind(r2), key = tombstoneKey('coach', 'v1');
      const fault = vi.spyOn(r2, 'put').mockImplementation(async (k, body, options) => {
        if ((failure === 'audit' && k.startsWith(retiredPrefix('coach')))
          || (failure !== 'audit' && k === key && JSON.parse(body).rewritten_at !== undefined)) {
          if (failure === 'ambiguous-marker') await put(k, body, options);
          throw new Error('synthetic finalization failure');
        }
        return put(k, body, options);
      });
      await expect(rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 3 })).rejects.toThrow(); fault.mockRestore();
      const barrier = (await loadTombstones(r2, 'coach')).get('v1')!;
      expect(barrier).toMatchObject({ erased_at: D, done_through: '2026-11-24', rows_removed: 5 });
      expect(hidden(new Map([['v1', barrier]]), { visitor_id: 'v1', ts: D })).toBe(true);
      const retry = await rewriteErasures(r2, 'coach', { now: D + 2 * DAY, retentionDays: 3 });
      expect(retry.days).toEqual([]); expect(retry.objects_opened).toBe(0); expect(retry.rows_removed).toBe(0); expect(retry.remaining).toBe(0);
      expect(r2.keys(retiredPrefix('coach'))).toHaveLength(1);
      expect((await loadTombstones(r2, 'coach')).get('v1')?.rewritten_at).toBeDefined();
      expect(r2.rows('coach/').filter(r => r.visitor_id === 'v1' && r.ts <= D)).toEqual([]);
    }
  });
});
