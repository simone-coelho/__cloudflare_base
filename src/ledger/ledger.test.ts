// src/ledger/ledger.test.ts
// Phase 0: records go out after the response, land in R2 as range-named
// batches under the brand and hour, and come back by id with no index.

import { describe, it, expect } from 'vitest';
import { enqueueDecisions, enqueueOutcome, pointsForDecisions } from './enqueue';
import { consumeLedger } from './consume';
import { candidateKeys, findById, isLedgerMessage, writeBatches } from './writer';
import { hourPrefix, outcomeFromAction, parseId, rewardOf, ts36, type OutcomeRecord } from './records';
import { decideContent } from '@/content/decide';
import type { ContentPiece, DecisionRecord, SlotStrategy } from '@/content/types';

class FakeR2 {
  store = new Map<string, string>(); puts = 0;
  async put(key: string, body: string) { this.puts++; this.store.set(key, body); }
  async get(key: string) { const b = this.store.get(key); return b === undefined ? null : { text: async () => b }; }
  async list(opts: { prefix: string }) { return { objects: [...this.store.keys()].filter((k) => k.startsWith(opts.prefix)).sort().map((key) => ({ key })), truncated: false }; }
}
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
  it('enqueues one message per record and writes one point per record, never throwing', async () => {
    const q = new FakeQueue(), ae = new FakeAE();
    const s = set('v1');
    await enqueueDecisions({ EVENT_QUEUE: q as never, ANALYTICS: ae as never }, s.records);
    expect(q.sent).toHaveLength(3);
    expect(q.sent[0]).toMatchObject({ kind: 'ledger', type: 'decision', record: { decision_id: s.records[0]!.decision_id } });
    expect(ae.points).toHaveLength(3);
    expect((ae.points[0] as { blobs: string[] }).blobs.slice(0, 5)).toEqual(['decision', 'coach', 'coach', 'home', 'hero']);
    await enqueueOutcome({ EVENT_QUEUE: q as never, ANALYTICS: ae as never }, outcomeFromAction({ type: 'add_to_cart', userId: 'v1', timestamp: T0, data: { productId: 'p1' } }, 'coach'));
    expect(q.sent).toHaveLength(4);
    await expect(enqueueDecisions({ EVENT_QUEUE: undefined as never, ANALYTICS: undefined as never }, s.records)).resolves.toBeUndefined();
    pointsForDecisions(undefined, s.records);
  });
});

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
    expect(res).toMatchObject({ ok: true, written: 10, objects: 3, skipped: 3 });
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

  it('an R2 failure is the one case that reports not ok, so the caller can retry the batch', async () => {
    const r2 = new FakeR2(); r2.put = async () => { throw new Error('R2 unavailable'); };
    const res = await consumeLedger({ STORAGE: r2 as never }, set('v1').records.map((record) => ({ kind: 'ledger', type: 'decision', record })));
    expect(res.ok).toBe(false); expect(res.error).toContain('R2');
    expect(await writeBatches(new FakeR2(), [], 'b')).toEqual([]);
  });
});
