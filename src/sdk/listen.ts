// src/sdk/listen.ts
// The listen module: decisions in, defaults guaranteed. A page hydrates from the
// snapshot at first paint, subscribes per slot, and is told plainly when there
// is nothing — because the page never waits on us and never shows a hole.

import type { Core } from './core';
import type { ContentDecision, DecisionSet, ElementLike } from './types';

export interface HydrateOptions {
  page: string;
  /** The entry channel, if the page knows it; recorded on the decision's cell. */
  channel?: string;
}

export type SlotCallback = (decisions: ContentDecision[], set: DecisionSet) => void;
export type SetCallback = (set: DecisionSet | null) => void;

export interface Listen {
  /** Fetch the first-paint snapshot and apply it. Resolves null on absence or failure, never rejects. */
  hydrate(opts: HydrateOptions): Promise<DecisionSet | null>;
  /**
   * Called with the slot's decisions, in order, every time a set arrives —
   * with an empty array when the set has nothing for the slot, so a page can
   * revert to its default. Returns the unsubscribe function.
   */
  subscribe(slot: string, cb: SlotCallback): () => void;
  /** Called with each set as it arrives, and with null on graceful absence. */
  onDecisions(cb: SetCallback): () => void;
  /** Apply a set from any source (a socket frame, a server-rendered payload). */
  apply(set: DecisionSet): void;
  current(): DecisionSet | null;
  /**
   * Tell the SDK what was painted. The automatic capture path starts here: an
   * impression is sent once per slot and piece, and dwell is measured while the
   * element is on screen when one is given. Off in listen-only mode.
   */
  rendered(slot: string, contentId: string, el?: ElementLike): void;
}

export interface ListenOptions {
  /** Minimum on-screen time before a dwell event is worth sending. */
  dwellMinMs?: number;
}

export function createListen(core: Core, opts: ListenOptions = {}): Listen {
  const host = core.host;
  const dwellMinMs = opts.dwellMinMs ?? 1_000;
  const slotSubs = new Map<string, Set<SlotCallback>>();
  const setSubs = new Set<SetCallback>();
  const impressed = new Set<string>();
  let current: DecisionSet | null = null;

  function notifyAbsence(): void { for (const cb of setSubs) { try { cb(null); } catch { /* never break the page */ } } }

  function apply(set: DecisionSet): void {
    current = set;
    impressed.clear();
    const bySlot = new Map<string, ContentDecision[]>();
    for (const d of set.decisions ?? []) { const list = bySlot.get(d.slot) ?? []; list.push(d); bySlot.set(d.slot, list); }
    for (const list of bySlot.values()) list.sort((a, b) => a.order - b.order);
    for (const [slot, subs] of slotSubs) {
      const list = bySlot.get(slot) ?? [];
      for (const cb of subs) { try { cb(list, set); } catch { /* never break the page */ } }
    }
    for (const cb of setSubs) { try { cb(set); } catch { /* never break the page */ } }
  }

  core.on('decisions', (set) => apply(set));

  async function hydrate(o: HydrateOptions): Promise<DecisionSet | null> {
    let settled = false;
    let timedOut = false;
    const timer = host.setTimeout(() => { if (!settled) { timedOut = true; notifyAbsence(); } }, core.config.hydrateTimeoutMs);
    const json = (await core.getJson(core.config.paths.snapshot, {
      page: o.page, visitorId: core.visitorId, brand: core.config.brand, channel: o.channel,
    })) as { ok?: boolean; page?: string; arm?: string; versions?: Record<string, number>; config_label?: string; decisions?: unknown; ts?: number } | null;
    settled = true;
    host.clearTimeout(timer);
    if (!json || json.ok !== true || !Array.isArray(json.decisions)) {
      if (!timedOut) notifyAbsence();
      return null;
    }
    const set: DecisionSet = {
      page: json.page ?? o.page,
      ...(json.arm ? { arm: json.arm } : {}),
      ...(json.versions ? { versions: json.versions } : {}),
      ...(json.config_label ? { config_label: json.config_label } : {}),
      ...(typeof json.ts === 'number' ? { ts: json.ts } : {}),
      decisions: json.decisions as ContentDecision[],
    };
    // A late snapshot after the timeout is still applied: absence first, then
    // the decision when it arrives. The page never waited.
    apply(set);
    return set;
  }

  function subscribe(slot: string, cb: SlotCallback): () => void {
    const set = slotSubs.get(slot) ?? new Set<SlotCallback>();
    set.add(cb);
    slotSubs.set(slot, set);
    if (current) {
      const list = (current.decisions ?? []).filter((d) => d.slot === slot).sort((a, b) => a.order - b.order);
      try { cb(list, current); } catch { /* ignore */ }
    }
    return () => { set.delete(cb); };
  }

  function onDecisions(cb: SetCallback): () => void {
    setSubs.add(cb);
    return () => { setSubs.delete(cb); };
  }

  function rendered(slot: string, contentId: string, el?: ElementLike): void {
    if (core.config.listenOnly) return;
    const key = `${slot}:${contentId}`;
    if (impressed.has(key)) return;
    impressed.add(key);
    const piece = (current?.decisions ?? []).find((d) => d.slot === slot && d.contentId === contentId);
    const data = { contentId, slot, ...(piece ? { customerContentId: piece.customerContentId, contentType: piece.type } : {}) };
    void core.send('content_impression', data);
    if (el && host.dom) {
      let shownAt: number | null = null;
      const off = host.dom.observe(el, (visible) => {
        if (visible) { if (shownAt === null) shownAt = host.now(); return; }
        if (shownAt === null) return;
        const ms = host.now() - shownAt;
        shownAt = null;
        if (ms >= dwellMinMs) void core.send('content_dwell', { ...data, ms });
        off();
      });
    }
  }

  return { hydrate, subscribe, onDecisions, apply, current: () => current, rendered };
}
