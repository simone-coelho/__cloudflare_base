// src/learn/fan.ts
// The three fan-ins the learning loop needs, each a no-op without its binding
// and none of them able to throw: served decisions into the visitor's ring,
// exposures into the slot's statistics object, and an outcome into the ring,
// which attributes it and forwards the credits itself.

import type { Env } from '@/types/env';
import type { DecisionRecord } from '@/content/types';
import type { OutcomeRecord } from '@/ledger/records';
import type { AttributionPolicy, RingEntry } from './policy';
import type { StatsConfig } from './stats';
import type { RewardType } from '@/ledger/records';

export const ringName = (tenant: string, visitorId: string) => `${tenant}:${visitorId}`;
export const statsName = (tenant: string, brand: string, slot: string) => `${tenant}:${brand}:${slot}`;
export const liftKey = (tenant: string, brand: string, slot: string) => `lift:${tenant}:${brand}:${slot}`;
/** Phase 3 (doc 22 §12.3): every published snapshot is also archived by version, so a replay can read the one in force. */
export const liftArchiveKey = (tenant: string, brand: string, slot: string, version: number) => `lift/${tenant}/${brand}/${slot}/${version}.json`;

type NS = DurableObjectNamespace | undefined;
async function post(ns: NS, name: string, path: string, body: unknown): Promise<Response | null> {
  if (!ns) return null;
  try {
    const stub = ns.get(ns.idFromName(name));
    return await stub.fetch(`https://learn${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch { return null; }
}

export const ringEntryOf = (r: DecisionRecord): RingEntry =>
  ({ id: r.decision_id, ts: r.ts, page: r.page, slot: r.slot, item: r.item_id, session_id: r.session_id, arm: r.arm, cell: r.cell });

/** The slot's configuration the statistics object publishes against. */
export interface SlotLearnConfig { reward: RewardType; stats: StatsConfig }

/** After a decision set is served: the ring gets the full records, each slot's object gets its exposures. */
export async function fanDecisions(env: Pick<Env, 'DECISION_RING' | 'LEARN_STATS'>, set: { tenant: string; brand: string; visitor_id: string; records: DecisionRecord[] }, slotConfig: (slot: string) => SlotLearnConfig): Promise<void> {
  if (set.records.length === 0) return;
  const jobs: Promise<unknown>[] = [
    post(env.DECISION_RING, ringName(set.tenant, set.visitor_id), '/append', { tenant: set.tenant, visitorId: set.visitor_id, records: set.records }),
  ];
  const bySlot = new Map<string, DecisionRecord[]>();
  for (const r of set.records) { if (r.arm === 'personalized' || r.arm === 'no_learning') bySlot.set(r.slot, [...(bySlot.get(r.slot) ?? []), r]); }
  for (const [slot, records] of bySlot) {
    jobs.push(post(env.LEARN_STATS, statsName(set.tenant, set.brand, slot), '/exposures', {
      tenant: set.tenant, brand: set.brand, slot, config: slotConfig(slot),
      exposures: records.map((r) => ({ item: r.item_id, cell: r.cell, ts: r.ts })),
    }));
  }
  await Promise.all(jobs.map((j) => j.catch(() => undefined)));
}

/** An outcome to the visitor's ring, which attributes it under the policy and forwards the credits. */
export async function fanOutcome(env: Pick<Env, 'DECISION_RING'>, tenant: string, outcome: OutcomeRecord, policy: AttributionPolicy, brand: string, slotConfig: Record<string, SlotLearnConfig>): Promise<void> {
  await post(env.DECISION_RING, ringName(tenant, outcome.visitor_id), '/outcome', { tenant, brand, outcome, policy, slotConfig });
}
