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

/**
 * CW30: the visitor's ring, read on the decision path under a time budget so
 * the fatigue term can never extend a decision by more than `timeoutMs`. Null
 * when the ring is unbound, slow or failing: no penalty, never an error.
 */
export async function readRing(env: Pick<Env, 'DECISION_RING'>, tenant: string, visitorId: string, timeoutMs = 60): Promise<RingEntry[] | null> {
  const ns = env.DECISION_RING;
  if (!ns) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const read = ns.get(ns.idFromName(ringName(tenant, visitorId))).fetch('https://learn/recent').then(async (res) => {
      // The ring keeps the full served records; attribution and the fatigue term read them as entries.
      const body = (await res.json()) as { ok?: boolean; ring?: Array<DecisionRecord | RingEntry> };
      return body.ok && Array.isArray(body.ring) ? body.ring.map((r) => ('decision_id' in r ? ringEntryOf(r) : r)) : null;
    });
    const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); });
    return await Promise.race([read, late]);
  } catch { return null; } finally { if (timer !== undefined) clearTimeout(timer); }
}

/** CW30: slot → item → times served inside that slot's fatigue window, from the ring entries. */
export function servedCounts(ring: readonly RingEntry[], slots: ReadonlyArray<{ slot: string; fatigue?: { weight: number; windowHours: number } }>, now: number): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const s of slots) {
    if (!s.fatigue || s.fatigue.weight <= 0) continue;
    const since = now - s.fatigue.windowHours * 3_600_000;
    const counts: Record<string, number> = {};
    for (const e of ring) if (e.ts >= since && e.ts <= now) counts[e.item] = (counts[e.item] ?? 0) + 1;
    if (Object.keys(counts).length) out[s.slot] = counts;
  }
  return out;
}

export const ringEntryOf = (r: DecisionRecord): RingEntry =>
  ({ id: r.decision_id, ts: r.ts, page: r.page, slot: r.slot, item: r.item_id, session_id: r.session_id, arm: r.arm, cell: r.cell, ...(r.featured_product_ids?.length ? { products: [...r.featured_product_ids] } : {}) });

/** The slot's configuration the statistics object publishes against. */
export interface SlotLearnConfig { reward: RewardType; stats: StatsConfig; /** CW27: absent means unit. */ objective?: 'unit' | 'revenue' | 'margin' }

/** After a decision set is served: the ring gets the full records, each slot's object gets its exposures. */
export async function fanDecisions(env: Pick<Env, 'DECISION_RING' | 'LEARN_STATS'>, set: { tenant: string; brand: string; visitor_id: string; records: DecisionRecord[] }, slotConfig: (slot: string) => SlotLearnConfig): Promise<void> {
  if (set.records.length === 0) return;
  const jobs: Promise<unknown>[] = [
    post(env.DECISION_RING, ringName(set.tenant, set.visitor_id), '/append', { tenant: set.tenant, visitorId: set.visitor_id, records: set.records }),
  ];
  const bySlot = new Map<string, DecisionRecord[]>();
  // Doc 22 §10, absolute: holdout traffic never feeds the statistics. Only the personalized arm's
  // exposures count; the ring still keeps every arm's decisions, for the receipt and the report.
  for (const r of set.records) { if (r.arm === 'personalized') bySlot.set(r.slot, [...(bySlot.get(r.slot) ?? []), r]); }
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
