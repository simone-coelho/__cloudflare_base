// src/sdk/listen.ts
// The listen module: decisions in, defaults guaranteed. A page hydrates from the
// snapshot at first paint, subscribes per slot, and is told plainly when there
// is nothing — because the page never waits on us and never shows a hole.

import { decisionRequiresConsent, type Core } from './core';
import { snapshotEntry } from '../services/visit';
import type { ActionEnvelope, ContentDecision, DecisionSet, ElementLike, EngineUpdate, RenderAcknowledgment, SdkEventType } from './types';
import type { ServerBootstrap } from './server';

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
  /** One active refresh and one coalesced pending intent; no overlapping fetches. */
  refresh(opts?: HydrateOptions): Promise<DecisionSet | null>;
  /** Verify the same broker grant and existing DOM before adopting without repaint. */
  adopt(bootstrap: unknown, opts: HydrateOptions): Promise<boolean>;
  /**
   * Called with the slot's decisions, in order, every time a set arrives —
   * with an empty array on known absence or when the set has nothing for the slot, so a page can
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
  rendered(slot: string, contentId: string, el?: ElementLike, decisionId?: string): Promise<RenderAcknowledgment | null>;
  /** Correlated content outcomes wait for the exact painted render ACK. */
  outcome(type: SdkEventType, contentId: string, slot: string, attrs?: Record<string, unknown>): Promise<EngineUpdate | null>;
  destroy(): void;
}

export interface ListenOptions {
  /** Minimum on-screen time before a dwell event is worth sending. */
  dwellMinMs?: number;
  /** Optional periodic publication refresh; minimum 1s, maximum 5min. */
  refreshMs?: number;
}

export function createListen(core: Core, opts: ListenOptions = {}): Listen {
  const host = core.host;
  const dwellMinMs = opts.dwellMinMs ?? 1_000;
  const slotSubs = new Map<string, Set<SlotCallback>>();
  const setSubs = new Set<SetCallback>();
  type Paint = { piece: ContentDecision; page: string; pageInstance: string; generation: number; envelope: ActionEnvelope;
    ack?: RenderAcknowledgment; pending?: Promise<RenderAcknowledgment | null>; attempts: number; observed?: boolean };
  const painted = new Map<string, Paint>();
  const observers = new Set<() => void>();
  let current: DecisionSet | null = null;
  let absence: DecisionSet | null = null;
  let selected: HydrateOptions | undefined, pageInstance = '', destroyed = false;
  let refreshing: Promise<DecisionSet | null> | undefined, trailing = false;
  let adopted = false;
  const content = core.bindContent((type, data) => type === 'content_impression'
    ? rendered(String(data.slot ?? ''), String(data.contentId ?? ''), undefined, typeof data.decisionId === 'string' ? data.decisionId : undefined).then(() => null)
    : outcome(type, String(data.contentId ?? ''), String(data.slot ?? ''), data));
  const placement = (d: Pick<ContentDecision, 'slot' | 'order' | 'contentId'>) => JSON.stringify([d.slot, d.order, d.contentId]);
  const sameAsset = (a: ContentDecision, b: ContentDecision) => a.customerContentId === b.customerContentId && a.type === b.type;
  const permitted = (set: DecisionSet | null) => {
    if (!set || !decisionRequiresConsent(set)) return true;
    const consent = core.consent;
    return consent.tracking && consent.personalization;
  };
  let intent = 0, delivery = 0;
  function resetCapture(): void { painted.clear(); for (const stop of [...observers]) stop(); }
  const offConsent = core.onConsentChange(() => { if (!core.trackingAllowed) resetCapture(); if (!permitted(current)) deliver(null, current?.page ?? ''); });

  function admittedCurrent(): DecisionSet | null {
    const candidate = current;
    if (!candidate) return null;
    const owned = core.isCurrent(core.generation);
    const admitted = owned && permitted(candidate);
    // Consent observation can reenter delivery. Never erase its successor.
    if (candidate !== current) return null;
    if (admitted) return candidate;
    current = null;
    // A still-owned consent refusal is known absence. Unobserved foreign-tab
    // ownership change must not publish even the former owner's page context.
    if (owned) absence = { page: candidate.page, decisions: [] };
    resetCapture();
    return null;
  }

  function deliver(set: DecisionSet | null, page: string): number {
    const generation = core.generation;
    const owner = intent;
    if (!permitted(set)) set = null;
    if (generation !== core.generation || owner !== intent) return -1;
    const epoch = ++delivery;
    // Read purpose/authority before the reentrancy fences: observing a new
    // refusal can itself synchronously dispatch a newer absence/default.
    const active = () => permitted(set) && (!set || core.isCurrent(generation))
      && generation === core.generation && owner === intent && epoch === delivery;
    const previous = current;
    if (!set || previous && (previous.page !== set.page || previous.pageInstance !== set.pageInstance)) resetCapture();
    if (set) {
      const keys = new Set(set.decisions.map(placement));
      for (const key of painted.keys()) if (!keys.has(key)) painted.delete(key);
      // An unchanged DOM placement keeps the receipt that was actually painted,
      // even when a newer poll carries another offer for the same item.
      set = { ...set, decisions: set.decisions.map(d => {
        const paint = painted.get(placement(d));
        if (paint && !sameAsset(paint.piece, d)) painted.delete(placement(d));
        return paint && sameAsset(paint.piece, d) && paint.generation === generation && paint.pageInstance === set!.pageInstance ? paint.piece : d;
      }) };
    }
    const unchanged = previous && set && previous.page === set.page && previous.pageInstance === set.pageInstance
      && JSON.stringify(previous.decisions) === JSON.stringify(set.decisions);
    current = set;
    adopted = false;
    absence = set ? null : { page, decisions: [] };
    const context = set ?? absence!;
    if (unchanged) return epoch;
    const bySlot = new Map<string, ContentDecision[]>();
    for (const d of context.decisions ?? []) { const list = bySlot.get(d.slot) ?? []; list.push(d); bySlot.set(d.slot, list); }
    for (const list of bySlot.values()) list.sort((a, b) => a.order - b.order);
    for (const [slot, subs] of slotSubs) {
      const list = bySlot.get(slot) ?? [];
      if (set && previous && previous.page === set.page && previous.pageInstance === set.pageInstance
        && JSON.stringify(previous.decisions.filter(d => d.slot === slot).sort((a, b) => a.order - b.order)) === JSON.stringify(list)) continue;
      for (const cb of subs) { if (!active()) return epoch; try { cb(list, context); } catch { /* never break the page */ } }
    }
    for (const cb of setSubs) { if (!active()) return epoch; try { cb(set); } catch { /* never break the page */ } }
    return epoch;
  }

  function apply(set: DecisionSet): void {
    if (!core.isCurrent(core.generation)) return;
    ++intent;
    deliver(set, set.page);
  }

  const offDecisions = core.on('decisions', (set) => apply(set));
  const offGeneration = core.on('generation', () => {
    const page = current?.page ?? absence?.page ?? '';
    // Generation rejects old async work itself. Do not steal an in-progress
    // ready() call's intent merely because its own expired grant was renewed.
    pageInstance = ''; deliver(null, page);
  });

  async function hydrate(o: HydrateOptions): Promise<DecisionSet | null> {
    if (destroyed) return null;
    if (!pageInstance || !selected || selected.page !== o.page || selected.channel !== o.channel) { pageInstance = host.uuid(); resetCapture(); }
    selected = { ...o };
    // ready() can synchronously change identity and reenter through a listener.
    const owner = ++intent;
    const pending = core.ready();
    const generation = core.generation;
    const active = () => owner === intent && generation === core.generation;
    if (!active()) return null;
    let settled = false;
    let timedOut = false;
    const timer = host.setTimeout(() => { if (!settled && active()) { timedOut = true; deliver(null, o.page); } }, core.config.hydrateTimeoutMs);
    if (!await pending || !active() || !core.isCurrent(generation)) {
      settled = true; host.clearTimeout(timer);
      if (!timedOut && active()) deliver(null, o.page);
      return null;
    }
    const consent = core.consent;
    const json = (await core.getJson(core.config.paths.snapshot, {
      page: o.page,
      pageInstance,
      browsingSessionId: consent.tracking ? core.sessionId : undefined, brand: core.config.brand, channel: consent.tracking ? o.channel : undefined,
      entry: consent.tracking ? snapshotEntry(core.entry) : undefined,
      trackingConsent: consent.tracking ? undefined : 'false', personalizationEnabled: consent.personalization ? undefined : 'false',
    })) as { ok?: boolean; page?: string; pageInstance?: string; arm?: string; versions?: Record<string, number>; config_label?: string; decisions?: unknown; ts?: number } | null;
    settled = true;
    host.clearTimeout(timer);
    if (!active() || !core.isCurrent(generation)) return null;
    if (!json || json.ok !== true || !Array.isArray(json.decisions) || json.page !== undefined && json.page !== o.page
      || json.pageInstance !== undefined && json.pageInstance !== pageInstance) {
      if (!timedOut) deliver(null, o.page);
      return null;
    }
    const set: DecisionSet = {
      page: json.page ?? o.page,
      ...(json.pageInstance ? { pageInstance: json.pageInstance } : {}),
      ...(json.arm ? { arm: json.arm } : {}),
      ...(json.versions ? { versions: json.versions } : {}),
      ...(json.config_label ? { config_label: json.config_label } : {}),
      ...(typeof json.ts === 'number' ? { ts: json.ts } : {}),
      decisions: json.decisions as ContentDecision[],
    };
    // A late snapshot after the timeout is still applied: absence first, then
    // the decision when it arrives. The page never waited.
    const epoch = deliver(set, set.page);
    const accepted = admittedCurrent();
    return accepted && active() && epoch === delivery && core.isCurrent(generation) ? accepted : null;
  }

  function refresh(o?: HydrateOptions): Promise<DecisionSet | null> {
    if (destroyed || !o && !selected) return Promise.resolve(null);
    if (o && selected && (o.page !== selected.page || o.channel !== selected.channel)) {
      ++intent; selected = { ...o }; pageInstance = host.uuid(); resetCapture();
    } else if (o) selected = { ...o };
    if (refreshing) { ++intent; trailing = true; return refreshing; }
    const operation = (async () => {
      let result: DecisionSet | null = null;
      do { trailing = false; result = await hydrate(selected!); } while (trailing && !destroyed);
      return result;
    })();
    refreshing = operation;
    const finish = () => { if (refreshing === operation) { refreshing = undefined; trailing = false; } };
    void operation.then(finish, finish);
    return operation;
  }

  function subscribe(slot: string, cb: SlotCallback): () => void {
    const set = slotSubs.get(slot) ?? new Set<SlotCallback>();
    set.add(cb);
    slotSubs.set(slot, set);
    const context = admittedCurrent() ?? absence;
    if (context && !adopted) {
      const list = (context.decisions ?? []).filter((d) => d.slot === slot).sort((a, b) => a.order - b.order);
      try { cb(list, context); } catch { /* ignore */ }
    }
    return () => { set.delete(cb); };
  }

  function onDecisions(cb: SetCallback): () => void {
    setSubs.add(cb);
    return () => { setSubs.delete(cb); };
  }

  async function rendered(slot: string, contentId: string, el?: ElementLike, decisionId?: string): Promise<RenderAcknowledgment | null> {
    if (destroyed || core.config.listenOnly || !core.trackingAllowed) return null;
    const set = admittedCurrent(), matches = set?.decisions.filter(d => d.slot === slot && d.contentId === contentId
      && (decisionId === undefined || decisionId === d.decisionId)) ?? [];
    if (!set?.pageInstance || matches.length !== 1) return null;
    const piece = matches[0]!;
    if (!piece.renderOffer || !piece.decisionId) return null;
    const key = placement(piece), generation = core.generation;
    let paint = painted.get(key);
    if (!paint) {
      const data = { contentId, slot, decisionId: piece.decisionId, page: set.page, position: piece.order, pageInstance: set.pageInstance,
        renderOffer: piece.renderOffer, customerContentId: piece.customerContentId, contentType: piece.type };
      paint = { piece, page: set.page, pageInstance: set.pageInstance, generation, envelope: core.envelope('content_impression', data), attempts: 0 };
      painted.set(key, paint);
    }
    const selectedPaint = paint;
    const active = () => !destroyed && painted.get(key) === selectedPaint && core.isCurrent(generation) && core.trackingAllowed
      && current?.pageInstance === selectedPaint.pageInstance;
    if (!active()) return null;
    if (!paint.ack && !paint.pending && paint.attempts < 3) {
      paint.attempts++;
      paint.pending = core.sendRender(paint.envelope).then(ack => {
        if (!active()) return null;
        if (ack) selectedPaint.ack = ack;
        return ack;
      }).finally(() => { selectedPaint.pending = undefined; });
    }
    const ack = paint.ack ?? await paint.pending ?? null;
    if (!ack || !active()) return null;
    if (el && host.dom && !paint.observed) {
        paint.observed = true;
        const { renderOffer: _offer, ...data } = paint.envelope.data;
        void _offer; // Intentionally exclude the admission capability from dwell.
        let shownAt: number | null = null;
        let off: () => void = () => undefined; let stopped = false;
        const stop = () => { if (stopped) return; stopped = true; shownAt = null; off(); observers.delete(stop); };
        observers.add(stop);
        off = host.dom.observe(el, (visible) => {
          if (stopped || !active()) { stop(); return; }
          if (visible) { if (shownAt === null) shownAt = host.now(); return; }
          if (shownAt === null) return;
          const ms = host.now() - shownAt;
          shownAt = null;
          if (ms >= dwellMinMs) void outcome('content_dwell', contentId, slot, { ...data, ms });
          stop();
        });
        if (stopped) off();
    }
    return ack;
  }

  async function outcome(type: SdkEventType, contentId: string, slot: string, attrs: Record<string, unknown> = {}): Promise<EngineUpdate | null> {
    if (type === 'content_impression') return null;
    const candidates = [...painted.values()].filter(p => p.piece.slot === slot && p.piece.contentId === contentId
      && (attrs.decisionId === undefined || attrs.decisionId === p.piece.decisionId));
    if (candidates.length !== 1) return null;
    const paint = candidates[0]!, ack = paint.ack ?? await paint.pending;
    if (!ack || destroyed || !core.isCurrent(paint.generation) || !core.trackingAllowed || current?.pageInstance !== paint.pageInstance
      || painted.get(placement(paint.piece)) !== paint) return null;
    const { renderOffer: _offer, action: _action, event: _event, eventName: _eventName, ...safe } = attrs;
    void _offer; void _action; void _event; void _eventName;
    return content.send(type, { ...safe, contentId, slot, decisionId: ack.decisionId });
  }

  async function adopt(value: unknown, o: HydrateOptions): Promise<boolean> {
    const owner = ++intent, generation = core.generation;
    const fail = () => { if (owner === intent && generation === core.generation) deliver(null, o.page); return false; };
    if (destroyed || !value || typeof value !== 'object') return fail();
    const b = value as ServerBootstrap;
    if (b.version !== 1 || b.tenant !== core.config.tenant || b.endpoint !== core.config.endpoint || b.page !== o.page
      || typeof b.pageInstance !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(b.pageInstance) || !Number.isSafeInteger(b.until)
      || b.until <= host.now() || b.until > host.now() + 30_000 || !Array.isArray(b.decisions) || b.decisions.length > 1000
      || !host.dom || !await core.ready() || !await core.matchesSessionWitness(b.sessionWitness)
      || generation !== core.generation || owner !== intent || !permitted(b)) return fail();
    const elements = [...host.dom.querySelectorAll('[data-op-page-instance]')];
    const expected = new Map<string, ContentDecision>();
    for (const d of b.decisions) {
      if (!d || typeof d.contentId !== 'string' || typeof d.slot !== 'string' || !Number.isSafeInteger(d.order) || expected.has(placement(d))) return fail();
      expected.set(placement(d), d);
    }
    if (elements.length !== expected.size) return fail();
    const matched = new Set<string>();
    for (const el of elements) {
      const key = placement({ slot: el.getAttribute('data-op-slot') ?? '', contentId: el.getAttribute('data-op-content') ?? '', order: Number(el.getAttribute('data-op-position')) });
      const d = expected.get(key);
      if (!d || matched.has(key) || el.getAttribute('data-op-page-instance') !== b.pageInstance
        || (el.getAttribute('data-op-decision-id') ?? undefined) !== d.decisionId) return fail();
      matched.add(key);
    }
    if (owner !== intent || generation !== core.generation || !core.isCurrent(generation) || host.now() >= b.until || !permitted(b)) return fail();
    resetCapture(); selected = { ...o }; pageInstance = b.pageInstance; current = { ...b, decisions: b.decisions.map(d => ({ ...d })) }; absence = null; adopted = true; ++delivery;
    for (const el of elements) void rendered(el.getAttribute('data-op-slot')!, el.getAttribute('data-op-content')!, el,
      el.getAttribute('data-op-decision-id') ?? undefined);
    return true;
  }

  const offSent = core.on('sent', event => { if (!['content_impression', 'content_dwell'].includes(event.type) && selected) void refresh(); });
  const offSocket = core.on('socket', status => { if (status === 'connected' && selected) void refresh(); });
  const timer = opts.refreshMs === undefined ? undefined : host.setInterval(() => { if (selected) void refresh(); }, Math.max(1_000, Math.min(300_000, opts.refreshMs)));
  function destroy(): void { destroyed = true; ++intent; resetCapture(); content.release(); offSent(); offSocket(); offConsent(); offDecisions(); offGeneration(); if (timer !== undefined) host.clearInterval(timer); slotSubs.clear(); setSubs.clear(); current = null; absence = null; }
  return { hydrate, refresh, adopt, subscribe, onDecisions, apply, current: admittedCurrent, rendered, outcome, destroy };
}
