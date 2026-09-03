// src/durable-objects/DecisionRing.ts
// The visitor's own object for what she was shown (doc 22 §3.3, §4.3): the
// 200-deep ring of served decisions, a long index of ids, and online
// attribution. One writer, itself. When an outcome arrives it applies the
// learning policy against the ring, emits credited pairs to each slot's
// statistics object, and moves on. No global join anywhere.

import type { Env } from '@/types/env';
import type { DecisionRecord } from '@/content/types';
import type { OutcomeRecord } from '@/ledger/records';
import { attribute, type AttributionPolicy, type RingEntry } from '@/learn/policy';
import { ringEntryOf, statsName, type SlotLearnConfig } from '@/learn/fan';

const RING_MAX = 200;
const RING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const INDEX_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

interface Stored { ring: DecisionRecord[]; index: Array<{ id: string; ts: number }> }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export class DecisionRing {
  private state: DurableObjectState;
  private env: Env;
  private data: Stored | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(state: DurableObjectState, env: Env) { this.state = state; this.env = env; }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    switch (url.pathname) {
      case '/append': {
        const body = (await request.json().catch(() => null)) as { records?: DecisionRecord[] } | null;
        if (!body || !Array.isArray(body.records)) return json({ ok: false, error: 'records required' }, 400);
        const n = await this.serialize(() => this.append(body.records!));
        return json({ ok: true, ring: n });
      }
      case '/outcome': {
        const body = (await request.json().catch(() => null)) as { tenant?: string; brand?: string; outcome?: OutcomeRecord; policy?: AttributionPolicy; slotConfig?: Record<string, SlotLearnConfig> } | null;
        if (!body?.outcome || !body.policy || !body.tenant) return json({ ok: false, error: 'outcome and policy required' }, 400);
        const credits = await this.serialize(() => this.outcome(body.tenant!, body.brand ?? body.tenant!, body.outcome!, body.policy!, body.slotConfig ?? {}));
        return json({ ok: true, credits });
      }
      case '/recent': {
        const d = await this.serialize(() => this.load());
        return json({ ok: true, ring: d.ring, index: d.index.length });
      }
      case '/reset': {
        await this.serialize(async () => { await this.state.storage.deleteAll(); this.data = { ring: [], index: [] }; });
        return json({ ok: true, reset: true });
      }
      default: return json({ ok: false, error: 'not found' }, 404);
    }
  }

  private async load(): Promise<Stored> {
    if (!this.data) this.data = ((await this.state.storage.get('ring')) as Stored | undefined) ?? { ring: [], index: [] };
    return this.data;
  }

  private async save(): Promise<void> { if (this.data) await this.state.storage.put('ring', this.data); }

  private async append(records: DecisionRecord[]): Promise<number> {
    const d = await this.load();
    const now = Math.max(Date.now(), ...records.map((r) => r.ts));
    d.ring.push(...records);
    d.index.push(...records.map((r) => ({ id: r.decision_id, ts: r.ts })));
    d.ring = d.ring.filter((r) => now - r.ts <= RING_MAX_AGE_MS).slice(-RING_MAX);
    d.index = d.index.filter((e) => now - e.ts <= INDEX_MAX_AGE_MS);
    await this.save();
    return d.ring.length;
  }

  private async outcome(tenant: string, brand: string, outcome: OutcomeRecord, policy: AttributionPolicy, slotConfig: Record<string, SlotLearnConfig>): Promise<number> {
    const d = await this.load();
    const ring: RingEntry[] = d.ring.map(ringEntryOf);
    const credits = attribute(outcome, ring, policy);
    // Credits fan to each slot's statistics object, off this object's own path too.
    const bySlot = new Map<string, typeof credits>();
    for (const c of credits) bySlot.set(c.slot, [...(bySlot.get(c.slot) ?? []), c]);
    const ns = this.env.LEARN_STATS;
    if (ns) {
      for (const [slot, list] of bySlot) {
        const body = JSON.stringify({ tenant, brand, slot, config: slotConfig[slot], credits: list });
        const p = ns.get(ns.idFromName(statsName(tenant, brand, slot))).fetch('https://learn/credits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).then(() => undefined, () => undefined);
        try { (this.state as unknown as { waitUntil?: (p: Promise<unknown>) => void }).waitUntil?.(p); } catch { /* older runtime */ }
      }
    }
    return credits.length;
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }
}
