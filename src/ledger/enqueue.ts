// src/ledger/enqueue.ts
// The producer side: after the response, never on it. A decision causes three
// writes (doc 22 §3.4): a message to the queue, a point to Analytics Engine, and
// an append to the shopper's own object. This file is the first two; the third
// is Phase 1's, where the ring feeds attribution.

import type { Env } from '@/types/env';
import type { DecisionRecord } from '@/content/types';
import { LEDGER_KIND, type LedgerMessage, type OutcomeRecord } from './records';

type QueueLike = { send(body: unknown): Promise<void>; sendBatch?(messages: Array<{ body: unknown }>): Promise<void> };
type AnalyticsLike = { writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void };

async function sendAll(queue: QueueLike | undefined, messages: LedgerMessage[]): Promise<void> {
  if (!queue || messages.length === 0) return;
  try {
    if (queue.sendBatch) { await queue.sendBatch(messages.map((body) => ({ body }))); return; }
    for (const body of messages) await queue.send(body);
  } catch {
    // The ledger is off the response path; a queue hiccup must never surface to the shopper.
  }
}

/** One small point per decision: counts, rates and grids, never measurement (doc 22 §10). */
export function pointsForDecisions(analytics: AnalyticsLike | undefined, records: readonly DecisionRecord[]): void {
  if (!analytics) return;
  for (const r of records) {
    try {
      analytics.writeDataPoint({
        blobs: ['decision', r.tenant, r.brand, r.page, r.slot, r.item_id, r.arm, r.authority, r.explain.regional?.level ?? 'none', r.cell.channel, r.cell.visit_bucket, r.cell.region ?? ''],
        doubles: [r.explored ? 1 : 0, r.explain.score_base, r.position],
        indexes: [r.tenant],
      });
    } catch { /* buffered by the runtime; never on the response path */ }
  }
}

export function pointForOutcome(analytics: AnalyticsLike | undefined, o: OutcomeRecord): void {
  if (!analytics) return;
  try {
    analytics.writeDataPoint({
      blobs: ['outcome', o.tenant, o.brand, o.type, o.event, o.slot ?? '', o.item_id ?? '', o.arm ?? ''],
      doubles: [o.value ?? 0],
      indexes: [o.tenant],
    });
  } catch { /* ignore */ }
}

/** Enqueue every record of a served decision set and write its points. Resolves without throwing. */
export async function enqueueDecisions(env: Pick<Env, 'EVENT_QUEUE' | 'ANALYTICS'>, records: readonly DecisionRecord[]): Promise<void> {
  pointsForDecisions(env.ANALYTICS as unknown as AnalyticsLike | undefined, records);
  await sendAll(env.EVENT_QUEUE as unknown as QueueLike | undefined, records.map((record) => ({ kind: LEDGER_KIND, type: 'decision', record })));
}

export async function enqueueOutcome(env: Pick<Env, 'EVENT_QUEUE' | 'ANALYTICS'>, outcome: OutcomeRecord | null): Promise<void> {
  if (!outcome) return;
  pointForOutcome(env.ANALYTICS as unknown as AnalyticsLike | undefined, outcome);
  await sendAll(env.EVENT_QUEUE as unknown as QueueLike | undefined, [{ kind: LEDGER_KIND, type: 'outcome', record: outcome }]);
}
