// src/demos/meridian/MeridianReflex.ts
// ─────────────────────────────────────────────────────────────────────────────
// One Durable Object per Meridian visitor. SQLite-backed, hibernating socket,
// closed-form alarm.
//
// WHY ITS OWN CLASS. The strongest beat in the session is the unprompted exit:
// the presenter stops touching the page and, about fifty seconds later, it
// changes on its own because an alarm fired and affinity had decayed past θ_out.
// That behaviour exists only on a DO host. The shared engine reaches it via
// REFLEX_HOST, which is a single GLOBAL var — flipping it would also move Coach
// onto a path that has never run in production. So Meridian owns its object and
// always uses it. Nothing to toggle, nobody else affected.
//
// WHAT THIS OBJECT DOES NOT DO. It does not compose the page. It returns the
// affinity vector and the membership delta; the client composes from its own
// bundled catalog using the same pure ranker (composer.ts). That is the First
// National Bank architecture, inherited on purpose: the visual beat renders from
// local state and never awaits the network, which is the property that makes a
// demo survive venue wifi.
//
// DECAY IS READ-TIME MATH. Raw scores are never pre-decayed. `tick()` re-reads
// at `now` and never accumulates, so the alarm can produce an EXIT without any
// event having occurred. That is the mechanism behind the beat.
// ─────────────────────────────────────────────────────────────────────────────

import {
  apply as applyReflex,
  tick as tickReflex,
  snapshot as snapshotReflex,
  nextCrossing,
  emptyState,
  extractTouches,
  type ReflexState,
  type ReflexConfig,
  type ReflexResult,
  type Touch,
} from '@/reflex/core';
import { configFor, stageTouchFor } from './reflexConfig';
import { resolve, itemById } from './catalog';
import type { Vertical } from './types';

/** Never set an alarm in the past; give the current event a beat to settle. */
const MIN_ALARM_DELAY_MS = 50;
/** Idle horizon: no events, no sockets, past this → the object erases itself. */
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** In-memory burst guard. A hibernation wake resets it, which is correct: a
    sustained burst keeps the object alive, so the window holds when it matters. */
const RATE_LIMIT_PER_MIN = 300;

interface StoredAffinity {
  visitorId: string;
  vertical: Vertical;
  reflex: ReflexState;
  lastSeen: number;
  configVersion: string;
  /** Monotonic — the client drops out-of-order frames without a clock. */
  seq: number;
}

export interface MeridianEvent {
  action: string;
  itemId?: string;
  /** Content blocks score through the same vector as items. */
  blockId?: string;
  /** Free-form dimension touches — used by search, which has no single item. */
  touches?: Touch[];
  at?: number;
}

/**
 * Closed-form alarm: the earlier of the instant the earliest current membership
 * decays below θ_out, and the retention horizon. Clamped so a boundary crossing
 * fires immediately but never busy-loops. Pure — exported for tests.
 */
export function computeNextAlarm(
  reflex: ReflexState,
  lastSeen: number,
  now: number,
  config: ReflexConfig,
): number {
  const crossing = nextCrossing(reflex, now, config);
  const retentionAt = lastSeen + RETENTION_MS;
  const at = crossing === null ? retentionAt : Math.min(crossing, retentionAt);
  return Math.max(at, now + MIN_ALARM_DELAY_MS);
}

export class MeridianReflex {
  private state: DurableObjectState;
  private aff: StoredAffinity | null = null;
  private loaded = false;
  /** Strictly serializes ingest and alarm runs. The reducer is never re-entrant. */
  private chain: Promise<unknown> = Promise.resolve();
  private rate = { windowStart: 0, count: 0 };
  private dropped = { rateLimited: 0, unknownId: 0, wrongVertical: 0, invalid: 0 };

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

  // ── HTTP surface ───────────────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get('Upgrade') === 'websocket') return this.acceptSocket(url);

    switch (url.pathname) {
      case '/ingest': {
        const body = (await request.json().catch(() => null)) as
          | { visitorId?: string; vertical?: Vertical; events?: MeridianEvent[] }
          | null;
        if (!body?.visitorId) return json({ ok: false, error: 'visitorId required' }, 400);
        const out = await this.serialize(() =>
          this.ingest(body.visitorId!, body.vertical ?? 'retail', body.events ?? []),
        );
        return json(out);
      }
      case '/snapshot': {
        const out = await this.serialize(() => this.snapshot());
        return json(out);
      }
      case '/vertical': {
        const body = (await request.json().catch(() => null)) as { vertical?: Vertical } | null;
        if (!body?.vertical) return json({ ok: false, error: 'vertical required' }, 400);
        const out = await this.serialize(() => this.swapVertical(body.vertical!));
        return json(out);
      }
      case '/reset': {
        await this.serialize(async () => {
          await this.state.storage.deleteAll();
          this.aff = null;
          this.loaded = true;
        });
        return json({ ok: true, reset: true });
      }
      default:
        return json({ ok: false, error: 'not found' }, 404);
    }
  }

  // ── Door 1: the hibernating socket ─────────────────────────────────────────

  private acceptSocket(url: URL): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    // Hibernation API: the object may evict from memory between frames and the
    // socket survives. State lives in storage, so waking is a read, not a rebuild.
    this.state.acceptWebSocket(server);
    const visitorId = url.searchParams.get('visitorId') ?? '';
    const vertical = (url.searchParams.get('vertical') as Vertical) ?? 'retail';
    server.serializeAttachment({ visitorId, vertical });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;
    let msg: any;
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    if (msg?.type === 'ping') return void ws.send(JSON.stringify({ type: 'pong' }));
    if (msg?.type !== 'action') return;

    const att = (ws.deserializeAttachment() ?? {}) as { visitorId?: string; vertical?: Vertical };
    const visitorId = msg.visitorId ?? att.visitorId;
    if (!visitorId) return;
    await this.serialize(() =>
      this.ingest(visitorId, msg.vertical ?? att.vertical ?? 'retail', [msg.event ?? msg]),
    );
  }

  async webSocketClose(): Promise<void> {
    // Nothing to tear down: state is in storage and the pending alarm keeps
    // decay-out alive whether or not anyone is listening.
  }

  async webSocketError(_ws: WebSocket, error: unknown): Promise<void> {
    console.error('MeridianReflex socket error:', error);
  }

  // ── The reducer — one path behind both doors ───────────────────────────────

  private async ingest(visitorId: string, vertical: Vertical, events: MeridianEvent[]) {
    await this.load();
    const now = Date.now();

    if (!this.allow(now)) {
      this.dropped.rateLimited += events.length;
      return { ok: false, error: 'rate limited', dropped: { ...this.dropped } };
    }

    const cfg = configFor(vertical);
    if (!this.aff || this.aff.visitorId !== visitorId) {
      this.aff = {
        visitorId,
        vertical,
        reflex: emptyState(cfg),
        lastSeen: now,
        configVersion: cfg.version,
        seq: 0,
      };
    }
    if (this.aff.vertical !== vertical) return this.swapVertical(vertical);

    let result: ReflexResult | null = null;
    const applied: string[] = [];

    for (const ev of events) {
      const touches = this.touchesFor(ev, vertical, cfg);
      if (touches === null) continue;
      // An action with no entry in the weights table accumulates nothing and
      // does it silently — which is exactly how a beat ends up looking dead on
      // stage while every endpoint returns 200. Say so.
      if (!(ev.action in cfg.weights)) {
        console.warn(`[meridian] action "${ev.action}" has no weight in ${cfg.version} — it will accumulate nothing`);
      }
      // Weight comes from the config's action table, not from the caller — a
      // client cannot inflate its own signal.
      result = applyReflex(this.aff.reflex, { touches, action: ev.action }, ev.at ?? now, cfg);
      this.aff.reflex = result.state;
      applied.push(ev.action);
    }

    // No usable event still re-evaluates — that is how a bare tick produces exits.
    if (!result) result = tickReflex(this.aff.reflex, now, cfg);
    this.aff.reflex = result.state;
    this.aff.lastSeen = now;
    this.aff.configVersion = cfg.version;
    this.aff.seq += 1;

    await this.state.storage.put({ affinity: this.aff });
    await this.scheduleAlarm(now, cfg);

    const frame = this.frame(now, cfg, result, 'action');
    if (result.changes.entered.length || result.changes.exited.length) this.push(frame);

    return { ok: true, applied, dropped: { ...this.dropped }, ...frame };
  }

  /**
   * Resolve an event to dimension touches.
   *
   * The shared engine silently DROPS unknown product ids at its trust gate, which
   * is how a surface can look alive while learning nothing. We count every miss
   * and return it on the wire, so a mis-seeded catalog is loud, not invisible.
   */
  private touchesFor(ev: MeridianEvent, vertical: Vertical, cfg: ReflexConfig): Touch[] | null {
    // The stage touch is derived from the VERB, so it is appended here rather
    // than sent on the wire — client and server read the same table and cannot
    // disagree about what a click meant.
    const stage = stageTouchFor(ev.action, vertical);
    const withStage = (t: Touch[]) => (stage ? [...t, stage] : t);

    if (Array.isArray(ev.touches) && ev.touches.length) return withStage(ev.touches);

    const id = ev.itemId ?? ev.blockId;
    if (!id) {
      this.dropped.invalid += 1;
      return null;
    }
    const r = resolve(id, vertical);
    if (!r.ok) {
      if (r.reason === 'unknown-id') this.dropped.unknownId += 1;
      else this.dropped.wrongVertical += 1;
      return null;
    }
    return withStage(extractTouches(r.item as unknown as Record<string, unknown>, cfg));
  }

  // ── The vertical swap ──────────────────────────────────────────────────────

  /**
   * Swapping the catalog swaps the registry with it. The visitor's accumulated
   * scores are keyed by dimension and value, and BOTH change — so the honest
   * move is a fresh vector under the new config rather than pretending a
   * `styleWorld` score means something as a `lifeStage` score. The instrument
   * keeps its six rows; only the labels and the numbers behind them are new.
   */
  private async swapVertical(vertical: Vertical) {
    await this.load();
    const now = Date.now();
    const cfg = configFor(vertical);
    const visitorId = this.aff?.visitorId ?? 'unknown';
    this.aff = {
      visitorId,
      vertical,
      reflex: emptyState(cfg),
      lastSeen: now,
      configVersion: cfg.version,
      seq: (this.aff?.seq ?? 0) + 1,
    };
    await this.state.storage.put({ affinity: this.aff });
    await this.scheduleAlarm(now, cfg);
    const frame = this.frame(now, cfg, null, 'vertical_swap');
    this.push(frame);
    return { ok: true, swapped: vertical, ...frame };
  }

  // ── The closed-form alarm — exit without polling ───────────────────────────

  private async scheduleAlarm(now: number, cfg: ReflexConfig): Promise<void> {
    if (!this.aff) return;
    await this.state.storage.setAlarm(computeNextAlarm(this.aff.reflex, this.aff.lastSeen, now, cfg));
  }

  async alarm(): Promise<void> {
    await this.serialize(async () => {
      await this.load();
      if (!this.aff) return;
      const now = Date.now();

      if (now - this.aff.lastSeen >= RETENTION_MS && this.state.getWebSockets().length === 0) {
        await this.state.storage.deleteAll();
        this.aff = null;
        return;
      }

      const cfg = configFor(this.aff.vertical);
      // tick() never accumulates — it re-reads at `now` and applies the θ_out
      // exits the closed form predicted. Nobody clicked anything.
      const res = tickReflex(this.aff.reflex, now, cfg);
      this.aff = { ...this.aff, reflex: res.state, seq: this.aff.seq + 1 };

      if (res.changes.entered.length || res.changes.exited.length) {
        await this.state.storage.put({ affinity: this.aff });
        this.push(this.frame(now, cfg, res, 'alarm'));
      }
      await this.scheduleAlarm(now, cfg);
    });
  }

  // ── Frames, snapshot, plumbing ─────────────────────────────────────────────

  private frame(now: number, cfg: ReflexConfig, res: ReflexResult | null, source: string) {
    const snap = snapshotReflex(this.aff!.reflex, now, cfg);
    return {
      type: 'meridian_update' as const,
      source,
      seq: this.aff!.seq,
      vertical: this.aff!.vertical,
      configVersion: cfg.version,
      at: now,
      affinity: snap,
      /**
       * The RAW state, so the client can adopt it wholesale and keep decaying
       * from it correctly. Sending only the decayed snapshot left the client
       * painting bars from the server while still COMPOSING from its own mirror
       * — two sources of truth that agree until they do not. Bounded by
       * maxValuesPerDim x dimensions, so it is small.
       */
      state: this.aff!.reflex,
      changes: res ? res.changes : { entered: [], exited: [] },
      explain: res ? res.changes.explain : [],
    };
  }

  private async snapshot() {
    await this.load();
    if (!this.aff) return { ok: true, empty: true };
    const cfg = configFor(this.aff.vertical);
    const now = Date.now();
    // Read-time decay: a snapshot of an idle visitor is correctly lower than the
    // last frame they were sent, with no write and no alarm involved.
    return { ok: true, ...this.frame(now, cfg, tickReflex(this.aff.reflex, now, cfg), 'snapshot') };
  }

  private push(frame: unknown): void {
    const payload = JSON.stringify(frame);
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        /* a dead socket is not an error worth failing an ingest over */
      }
    }
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.aff = (await this.state.storage.get<StoredAffinity>('affinity')) ?? null;
    this.loaded = true;
  }

  private allow(now: number): boolean {
    if (now - this.rate.windowStart >= 60_000) this.rate = { windowStart: now, count: 0 };
    this.rate.count += 1;
    return this.rate.count <= RATE_LIMIT_PER_MIN;
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
