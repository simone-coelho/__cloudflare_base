// src/ledger/erasure.test.ts
// CW28 (doc 22 §15): a tombstone hides a visitor's rows at once, the rewrite
// removes them from the batch objects newest day first over the retention
// window, retires the tombstone with a hash and no id, resumes past its cap,
// and never touches another visitor or a row from after the erasure.

import { describe, it, expect } from 'vitest';
import { writeBatches } from './writer';
import { ts36, type LedgerMessage } from './records';
import { dayOf, eraseVisitorLedger, hidden, loadTombstones, pendingPrefix, retiredPrefix, rewriteErasures, tombstoneKey, withoutErased, writeTombstone } from './erasure';
import type { DecisionRecord } from '@/content/types';

class FakeR2 {
  store = new Map<string, string>(); puts = 0; deletes = 0;
  async put(key: string, body: string) { this.puts++; this.store.set(key, body); }
  async get(key: string) { const b = this.store.get(key); return b === undefined ? null : { text: async () => b }; }
  async delete(key: string) { this.deletes++; this.store.delete(key); }
  async list(opts: { prefix: string }) { return { objects: [...this.store.keys()].filter((k) => k.startsWith(opts.prefix)).sort().map((key) => ({ key })), truncated: false }; }
  keys(prefix: string) { return [...this.store.keys()].filter((k) => k.startsWith(prefix)).sort(); }
  rows(prefix: string) { return this.keys(prefix).flatMap((k) => this.store.get(k)!.split('\n').filter(Boolean).map((l) => JSON.parse(l) as { visitor_id: string; ts: number })); }
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

  it('the rewrite removes the rows from the objects, deletes an emptied object, keeps the other visitor and the rows after the erasure, and retires the tombstone with a hash', async () => {
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
    expect(r2.keys(pendingPrefix('coach'))).toEqual([]);
    const retired = r2.keys(retiredPrefix('coach'));
    expect(retired).toHaveLength(1);
    const audit = JSON.parse(r2.store.get(retired[0]!)!) as Record<string, unknown>;
    expect(audit.visitor_id).toBeUndefined();
    expect(audit).toMatchObject({ tenant: 'coach', erased_at: D, window_days: 3, rows_removed: 5, objects_rewritten: 2, objects_deleted: 2 });
    expect(typeof audit.visitor_hash).toBe('string');
    expect(String(audit.visitor_hash)).not.toContain('v1');
    // A second run has nothing to do.
    const again = await rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 3 });
    expect(again.tombstones).toBe(0); expect(again.rows_removed).toBe(0);
  });

  it('stops at its object cap after a whole day, keeps hiding meanwhile, and the next run continues from the day after', async () => {
    const r2 = new FakeR2();
    await seed(r2);
    await writeTombstone(r2, 'coach', 'v1', 'privacy@coach', D);
    const first = await rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 3, maxObjects: 1 });
    expect(first.days).toEqual(['2026-11-27']); expect(first.more).toBe(true); expect(first.retired).toBe(0); expect(first.remaining).toBe(1);
    const tombs = await loadTombstones(r2, 'coach');
    expect(tombs.get('v1')?.done_through).toBe('2026-11-27');
    expect(hidden(tombs, { visitor_id: 'v1', ts: D - DAY })).toBe(true);   // the 11-26 rows are still hidden by the readers
    expect(r2.rows('coach/2026-11-26').filter((x) => x.visitor_id === 'v1')).toHaveLength(4);
    const second = await rewriteErasures(r2, 'coach', { now: D + DAY, retentionDays: 3, maxObjects: 100 });
    expect(second.days).toEqual(['2026-11-26', '2026-11-25', '2026-11-24']);
    expect(second.rows_removed).toBe(4); expect(second.retired).toBe(1);
    expect(r2.rows('coach/2026-11-26').filter((x) => x.visitor_id === 'v1')).toHaveLength(0);
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
      get: (id: string) => ({ fetch: async (url: string, init?: { method?: string }) => { calls.push(`${id} ${init?.method ?? 'GET'} ${new URL(url).pathname}`); return new Response('{"ok":true}', { status: 200 }); } }),
    } as unknown as DurableObjectNamespace;
    const res = await eraseVisitorLedger({ STORAGE: r2 as unknown as R2Bucket, DECISION_RING: ns }, 'coach', 'v1', 'privacy@coach', D);
    expect(res).toEqual({ ok: true, tombstone: { key: tombstoneKey('coach', 'v1'), erased_at: D }, ring: 'reset' });
    expect(calls).toEqual(['coach:v1 POST /reset']);
    expect(r2.store.has(tombstoneKey('coach', 'v1'))).toBe(true);
    const unbound = await eraseVisitorLedger({ STORAGE: r2 as unknown as R2Bucket }, 'coach', 'v3', 'privacy@coach', D);
    expect(unbound.ring).toBe('unbound');
  });
});
