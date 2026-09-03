// src/durable-objects/RegionTrend.ts
// One object per tenant and region: the population's decaying interest vector.
// Holds no visitor ids, no sessions, nothing personal: counts per dimension
// value on the same lazy-decay invariant the shopper's own vector uses. Ingest
// is fire-and-forget from the scoring hosts; publishing to KV is coalesced on a
// short alarm so a burst of events costs one write, not a thousand.

import type { Env } from '@/types/env';
import {
  REGION_TAU_MS, applyTrend, snapshotOf, trendKey, type IngestFrame, type RegionState,
} from '@/reflex/regionTrend';

const PUBLISH_DELAY_MS = 30_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export class RegionTrend {
  private state: DurableObjectState;
  private env: Env;
  private trend: RegionState | null = null;
  private loaded = false;
  private dirty = false;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    switch (url.pathname) {
      case '/ingest': {
        const frame = (await request.json().catch(() => null)) as Partial<IngestFrame> | null;
        if (!frame || !Array.isArray(frame.touches)) return json({ ok: false, error: 'frame required' }, 400);
        if (!frame.tenant || !frame.region) return json({ ok: false, error: 'tenant and region required' }, 400);
        const full: IngestFrame = { tenant: frame.tenant, region: frame.region, touches: frame.touches, w: Number(frame.w) || 0, ts: Number(frame.ts) || Date.now() };
        await this.serialize(() => this.ingest(full));
        return json({ ok: true });
      }
      case '/snapshot': {
        const out = await this.serialize(async () => {
          await this.load(url);
          return this.trend ? snapshotOf(this.trend, Date.now(), this.trend.updatedAt) : null;
        });
        return json({ ok: true, snapshot: out });
      }
      case '/publish': {
        await this.serialize(() => this.publish());
        return json({ ok: true });
      }
      case '/reset': {
        await this.serialize(async () => { await this.state.storage.deleteAll(); this.trend = null; this.loaded = true; this.dirty = false; });
        return json({ ok: true, reset: true });
      }
      default:
        return json({ ok: false, error: 'not found' }, 404);
    }
  }

  /** The coalesced publish. */
  async alarm(): Promise<void> {
    await this.serialize(() => this.publish());
  }

  private async ingest(frame: IngestFrame): Promise<void> {
    await this.load(undefined, frame.tenant, frame.region);
    if (!this.trend) return;
    this.trend = applyTrend(this.trend, { touches: frame.touches, w: frame.w, ts: frame.ts }, REGION_TAU_MS);
    this.dirty = true;
    await this.state.storage.put('trend', this.trend);
    const pending = await this.state.storage.getAlarm();
    if (pending === null) await this.state.storage.setAlarm(Date.now() + PUBLISH_DELAY_MS);
  }

  private async publish(): Promise<void> {
    await this.load();
    // Publish whenever there is something to publish. The in-memory `dirty` flag
    // is an optimization for the explicit /publish door only: an alarm after an
    // eviction must still write, or a burst of frames would never reach KV.
    if (!this.trend || this.trend.events === 0) return;
    const now = Date.now();
    const snap = snapshotOf(this.trend, now, now);
    try {
      await this.env.CACHE.put(trendKey(this.trend.tenant, this.trend.region), JSON.stringify(snap));
      this.dirty = false;
    } catch {
      // KV unavailable: stay dirty and try again on the next ingest's alarm.
    }
  }

  /** The object learns its own name from the first frame (or the URL) and keeps it. */
  private async load(url?: URL, tenant?: string, region?: string): Promise<void> {
    if (!this.loaded) {
      this.trend = ((await this.state.storage.get('trend')) as RegionState | undefined) ?? null;
      this.loaded = true;
    }
    if (!this.trend) {
      const t = tenant ?? url?.searchParams.get('tenant') ?? '';
      const r = region ?? url?.searchParams.get('region') ?? '';
      if (t && r) this.trend = { tenant: t, region: r, dims: {}, events: 0, updatedAt: 0 };
    }
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }
}
