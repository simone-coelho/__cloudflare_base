// src/durable-objects/RegionTrend.ts
// One object per tenant and region: the population's decaying interest vector.
// Holds no visitor ids, no sessions, nothing personal: counts per dimension
// value on the same lazy-decay invariant the shopper's own vector uses. Ingest
// is fire-and-forget from the scoring hosts; publishing to KV is coalesced on a
// short alarm so a burst of events costs one write, not a thousand.

import type { Env } from '@/types/env';
import { SyntheticObjectBoundary } from '@/ops/synthetic';
import { isEventTimestamp } from '@/events/actionTypes';
import {
  REGION_GENERATION, REGION_STATE_KEY, REGION_TAU_MS, applyTrend, matchesTrendScope,
  objectName, snapshotOf, trendKey, type IngestFrame, type RegionState,
} from '@/reflex/regionTrend';

const PUBLISH_DELAY_MS = 30_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export class RegionTrend {
  private state: DurableObjectState;
  private env: Env;
  private synthetic: SyntheticObjectBoundary;
  private trend: RegionState | null = null;
  private loaded = false;
  private invalidState = false;
  private dirty = false;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(state: DurableObjectState, env: Env) {
    this.synthetic = new SyntheticObjectBoundary(state, env, 'REGION_TREND', () => {
      this.trend = null; this.loaded = false; this.invalidState = false; this.dirty = false;
    });
    this.state = this.synthetic.state;
    this.env = this.synthetic.env;
  }

  async fetch(request: Request): Promise<Response> {
    return this.synthetic.run(request, () => this.fetchScoped(request)).catch(() => json({ ok: false }, 503));
  }

  private async fetchScoped(request: Request): Promise<Response> {
    const url = new URL(request.url);
    switch (url.pathname) {
      case '/ingest': {
        const frame = (await request.json().catch(() => null)) as Partial<IngestFrame> | null;
        if (!frame || !Array.isArray(frame.touches)) return json({ ok: false, error: 'frame required' }, 400);
        if (!isEventTimestamp(frame.ts)) return json({ ok: false, error: 'invalid event timestamp' }, 400);
        if (!this.boundScope(frame)) return json({ ok: false, error: 'regional scope mismatch' }, 409);
        const full: IngestFrame = { generation: REGION_GENERATION, tenant: frame.tenant!, region: frame.region!, touches: frame.touches, w: Number(frame.w) || 0, ts: frame.ts };
        if (!await this.serialize(() => this.ingest(full))) return json({ ok: false, error: 'regional state mismatch' }, 409);
        return json({ ok: true });
      }
      case '/snapshot': {
        const out = await this.serialize(async () => {
          await this.load();
          return this.trend ? snapshotOf(this.trend, Date.now(), this.trend.updatedAt) : null;
        });
        return json({ ok: true, snapshot: out });
      }
      case '/publish': {
        await this.serialize(() => this.publish());
        return json({ ok: true });
      }
      case '/reset': {
        await this.serialize(async () => {
          await this.load();
          if (!this.trend) return;
          await this.state.storage.delete(REGION_STATE_KEY);
          this.trend = null; this.dirty = false;
        });
        return json({ ok: true, reset: true });
      }
      default:
        return json({ ok: false, error: 'not found' }, 404);
    }
  }

  /** The coalesced publish. */
  async alarm(): Promise<void> {
    await this.synthetic.run(undefined, () => this.serialize(() => this.publish()));
  }

  private async ingest(frame: IngestFrame): Promise<boolean> {
    await this.load();
    if (this.invalidState || !this.boundScope(frame)) return false;
    if (!this.trend) this.trend = { generation: REGION_GENERATION, tenant: frame.tenant, region: frame.region, dims: {}, events: 0, updatedAt: 0 };
    if (!matchesTrendScope(this.trend, frame.tenant, frame.region)) return false;
    this.trend = applyTrend(this.trend, { touches: frame.touches, w: frame.w, ts: frame.ts }, REGION_TAU_MS);
    this.dirty = true;
    await this.state.storage.put(REGION_STATE_KEY, this.trend);
    const pending = await this.state.storage.getAlarm();
    if (pending === null) await this.state.storage.setAlarm(Date.now() + PUBLISH_DELAY_MS);
    return true;
  }

  private async publish(): Promise<void> {
    await this.load();
    // Publish whenever there is something to publish. The in-memory `dirty` flag
    // is an optimization for the explicit /publish door only: an alarm after an
    // eviction must still write, or a burst of frames would never reach KV.
    if (!this.trend || !this.boundScope(this.trend) || this.trend.events === 0) return;
    const now = Date.now();
    const snap = snapshotOf(this.trend, now, now);
    try {
      await this.env.CACHE.put(trendKey(this.trend.tenant, this.trend.region), JSON.stringify(snap));
      this.dirty = false;
    } catch {
      // KV unavailable: stay dirty and try again on the next ingest's alarm.
    }
  }

  private boundScope(value: { generation?: unknown; tenant?: unknown; region?: unknown }): boolean {
    if (typeof value.tenant !== 'string' || typeof value.region !== 'string'
      || !matchesTrendScope(value, value.tenant, value.region)) return false;
    return this.state.id.toString() === this.env.REGION_TREND?.idFromName(objectName(value.tenant, value.region)).toString();
  }

  /** Never load or promote legacy accumulators, including after an old alarm. */
  private async load(): Promise<void> {
    if (!this.loaded) {
      const stored = (await this.state.storage.get(REGION_STATE_KEY)) as RegionState | undefined;
      this.invalidState = stored != null && !this.boundScope(stored);
      this.trend = stored && !this.invalidState ? stored : null;
      this.loaded = true;
    }
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }
}
