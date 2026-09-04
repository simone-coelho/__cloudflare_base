// src/durable-objects/LearnStats.ts
// One object per tenant, brand and slot (doc 22 §5, §6.1): decayed exposure
// and success counts per item at every pooling level, and the slot's own.
// Publishes a versioned lift snapshot to KV on a coalescing alarm; the
// decision path reads KV, never this object. Population aggregates only.

import type { Env } from '@/types/env';
import type { Cell } from '@/content/types';
import type { RewardType } from '@/ledger/records';
import type { Credit } from '@/learn/policy';
import { buildSnapshot, DEFAULT_STATS, emptyStats, recordExposure, recordSuccess, type StatsConfig, type StatsState } from '@/learn/stats';
import { liftArchiveKey, liftKey, type SlotLearnConfig } from '@/learn/fan';
import { readRevision } from '@/config/versionedStore';
import { indexPriors, PRIORS_KIND } from '@/learn/priors';

const PUBLISH_DELAY_MS = 30_000;

interface Stored { tenant: string; brand: string; slot: string; config: SlotLearnConfig; stats: StatsState }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export class LearnStats {
  private state: DurableObjectState;
  private env: Env;
  private data: Stored | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(state: DurableObjectState, env: Env) { this.state = state; this.env = env; }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    switch (url.pathname) {
      case '/exposures': {
        const b = (await request.json().catch(() => null)) as { tenant?: string; brand?: string; slot?: string; config?: SlotLearnConfig; exposures?: Array<{ item: string; cell: Cell; ts: number }> } | null;
        if (!b?.tenant || !b.brand || !b.slot || !Array.isArray(b.exposures)) return json({ ok: false, error: 'tenant, brand, slot, exposures required' }, 400);
        await this.serialize(async () => {
          const d = await this.load(b.tenant!, b.brand!, b.slot!, b.config);
          for (const e of b.exposures!) if (e?.item && e.cell) recordExposure(d.stats, e.item, e.cell, Number(e.ts) || Date.now(), d.config.stats);
          await this.save(); await this.arm();
        });
        return json({ ok: true });
      }
      case '/credits': {
        const b = (await request.json().catch(() => null)) as { tenant?: string; brand?: string; slot?: string; config?: SlotLearnConfig; credits?: Credit[] } | null;
        if (!b?.tenant || !b.brand || !b.slot || !Array.isArray(b.credits)) return json({ ok: false, error: 'tenant, brand, slot, credits required' }, 400);
        await this.serialize(async () => {
          const d = await this.load(b.tenant!, b.brand!, b.slot!, b.config);
          for (const c of b.credits!) if (c?.item && c.cell && c.reward) recordSuccess(d.stats, c.item, c.cell, c.reward as RewardType, Number(c.ts) || Date.now(), Number(c.weight) || 1, d.config.stats);
          await this.save(); await this.arm();
        });
        return json({ ok: true });
      }
      case '/snapshot': {
        const out = await this.serialize(async () => { const d = this.data ?? (await this.loadIfAny()); return d ? buildSnapshot(d.stats, d, d.config.reward, Date.now(), d.config.stats, await this.priorsFor(d)) : null; });
        return json({ ok: true, snapshot: out });
      }
      case '/publish': { await this.serialize(() => this.publish()); return json({ ok: true }); }
      case '/reset': { await this.serialize(async () => { await this.state.storage.deleteAll(); this.data = null; }); return json({ ok: true, reset: true }); }
      // Doc 22 §12.2, the merchandiser's `reset`: discard one item's evidence and start again from the
      // prior. The slot's own counters keep what they saw; only the item's estimate restarts.
      case '/reset-item': {
        const b = (await request.json().catch(() => null)) as { item?: string } | null;
        if (!b?.item) return json({ ok: false, error: 'item required' }, 400);
        const had = await this.serialize(async () => {
          const d = await this.loadIfAny();
          if (!d || !d.stats.items[b.item!]) return false;
          delete d.stats.items[b.item!];
          await this.save(); await this.publish();
          return true;
        });
        return json({ ok: true, item: b.item, had });
      }
      default: return json({ ok: false, error: 'not found' }, 404);
    }
  }

  async alarm(): Promise<void> { await this.serialize(() => this.publish()); }

  private async loadIfAny(): Promise<Stored | null> {
    if (this.data) return this.data;
    const stored = (await this.state.storage.get('learn')) as Stored | undefined;
    if (stored) this.data = stored;
    return this.data;
  }

  private async load(tenant: string, brand: string, slot: string, config?: SlotLearnConfig): Promise<Stored> {
    const existing = await this.loadIfAny();
    const cfg: SlotLearnConfig = config ?? existing?.config ?? { reward: 'click', stats: DEFAULT_STATS };
    if (!existing) this.data = { tenant, brand, slot, config: cfg, stats: emptyStats() };
    else existing.config = cfg;   // the latest configuration a caller sent is the one in force
    return this.data!;
  }

  private async save(): Promise<void> { if (this.data) await this.state.storage.put('learn', this.data); }

  private async arm(): Promise<void> {
    if ((await this.state.storage.getAlarm()) === null) await this.state.storage.setAlarm(Date.now() + PUBLISH_DELAY_MS);
  }

  private async publish(): Promise<void> {
    const d = await this.loadIfAny();
    if (!d || d.stats.events === 0) return;
    const snap = buildSnapshot(d.stats, d, d.config.reward, Date.now(), d.config.stats, await this.priorsFor(d));
    const body = JSON.stringify(snap);
    try { await this.env.CACHE.put(liftKey(d.tenant, d.brand, d.slot), body); } catch { /* try again on the next alarm */ }
    // Phase 3 (doc 22 §12.3): the archive a replay reads. Best effort; KV is what serves.
    try { await this.env.STORAGE.put(liftArchiveKey(d.tenant, d.brand, d.slot, snap.version), body, { httpMetadata: { contentType: 'application/json' } }); } catch { /* the next publish archives again */ }
  }

  /** Doc 22 §8: the imported priors for this slot, from the tenant's versioned prior document. */
  private async priorsFor(d: Stored): Promise<{ version: number; index: ReturnType<typeof indexPriors> } | null> {
    try {
      const rev = await readRevision(this.env, PRIORS_KIND, d.tenant);
      return rev ? { version: rev.revision, index: indexPriors(rev.value, d.slot) } : null;
    } catch { return null; }
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }
}
