// src/sdk/listen.ts
// The listen module: decisions in, defaults guaranteed. A page hydrates from the
// snapshot at first paint, subscribes per slot, and is told plainly when there
// is nothing — because the page never waits on us and never shows a hole.

import { decisionRequiresConsent, dwellMinFor, type Core, type FirstRequest } from './core';
import { snapshotEntry } from '../services/visit';
import { HEAD_STATE_KEY } from './identity';
import type { ActionEnvelope, ContentDecision, DecisionSet, ElementLike, EngineUpdate, LayoutExposure, RenderAcknowledgment, SdkEventType } from './types';
import type { ServerBootstrap } from './server';

export interface HydrateOptions {
  page: string;
  /**
   * The entry channel, if the page knows it; recorded on the decision's cell
   * when it is one of the tenant's published channel ids (today's six words for
   * a tenant without a context vocabulary). Any other word is ignored.
   */
  channel?: string;
  /**
   * P31: the identifiers of the modules that have nothing to show for this
   * page view. Each is withheld before ranking: it is neither returned nor
   * counted as an exposure, and the slot fills from the remaining ranking. The
   * report can only withhold, never add. Sent on the decision request as a JSON
   * string of the identifiers, each once; nothing is sent when it names none.
   */
  nothingToShow?: string[];
  /**
   * P79: the product of a product page view, your product identifier, the same value your product events
   * carry as `productId`. It is part of the page view: a `hydrate` or `refresh` naming another product opens
   * a new page view (its own page instance, deadline, holds and receipts), as another page or channel does.
   * P80: sent, trimmed, as the decision request's `ctx.anchor` only when it is 1 to 64 characters after
   * trimming; any other value sends neither it nor `variantId`, and the page view is served as one without an anchor.
   */
  productId?: string;
  /**
   * P79: the variant of that product (a colour, a size); a change of `variantId` alone opens no page view.
   * P80: sent, trimmed, as `ctx.variant` beside the anchor only when it is 1 to 64 characters after trimming.
   */
  variantId?: string;
}

/** P79: two page views' options name the same page view when they name the same page, channel and product (a variant switch keeps it). */
const samePageView = (a: HydrateOptions, b: HydrateOptions): boolean => a.page === b.page && a.channel === b.channel && a.productId === b.productId;

/** P80: a page-asserted signal's value within the engine's bound (1 to 64 characters after trimming), trimmed; else undefined. */
function signalValue(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length >= 1 && trimmed.length <= 64 ? trimmed : undefined;
}

/**
 * P80: the page view's product as the anchor of a slot scoped to it (`ctx.anchor`), its variant beside it
 * (`ctx.variant`), each only within the engine's bound: a product out of it sends neither, so the page view is
 * served as one without an anchor rather than refused whole; a variant out of it is dropped alone.
 */
function anchorSignals(o: HydrateOptions): { 'ctx.anchor'?: string; 'ctx.variant'?: string } {
  const anchor = signalValue(o.productId), variant = anchor === undefined ? undefined : signalValue(o.variantId);
  return { ...(anchor !== undefined ? { 'ctx.anchor': anchor } : {}), ...(variant !== undefined ? { 'ctx.variant': variant } : {}) };
}

/** P31: the report as the decision request carries it — a JSON array of the identifiers, each once — or undefined when it names none. */
function nothingToShowField(ids: unknown): string | undefined {
  if (!Array.isArray(ids)) return undefined;
  const named = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  return named.length ? JSON.stringify(named) : undefined;
}

export type SlotCallback = (decisions: ContentDecision[], set: DecisionSet) => void;
export type SetCallback = (set: DecisionSet | null) => void;

export interface Listen {
  /**
   * Fetch the first-paint snapshot and apply it. Resolves null on absence or failure, never rejects.
   * P34: the page view's first snapshot request starts its one deadline (`hydrateTimeoutMs`); no
   * re-ask restarts it, so by then every slot subscriber has the decisions or the empty list.
   */
  hydrate(opts: HydrateOptions): Promise<DecisionSet | null>;
  /**
   * One active refresh and one coalesced pending intent; no overlapping fetches. P34: an
   * acknowledged event during the page view's first snapshot does not cancel it: its answer is
   * delivered, then one refresh follows (P81: only while no socket is connected).
   */
  refresh(opts?: HydrateOptions): Promise<DecisionSet | null>;
  /**
   * P34: hold the slot's decisions for this page view. Until released, a later answer of the same
   * page view leaves the slot as it was last delivered: its subscribers are not called with another
   * list and its painted receipts stay valid, so `rendered` and the correlated outcomes of a held
   * module carry the decision identifier it was painted with. The returned function releases it,
   * and so does a new page view; the next answer then repaints the slot (a release does not repaint
   * by itself). Known absence (a consent refusal, an identity change, a failed answer) is never held.
   */
  hold(slot: string): () => void;
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
  /**
   * Correlated content outcomes wait for the exact painted render ACK. The
   * viewable impression is never one of them: the SDK measures it (`visible`).
   */
  outcome(type: SdkEventType, contentId: string, slot: string, attrs?: Record<string, unknown>): Promise<EngineUpdate | null>;
  /**
   * P40 (decisions D1, D2): what the page's visibility port reports for a
   * painted piece, `true` while at least half of it is on screen. Once its render
   * acknowledgement is held, one second in view without interruption sends its
   * one viewable impression (`content_viewable`) for the page instance; leaving
   * view, a detach, `destroy`, a consent refusal or a new generation cancels the
   * second. The declarative capture and `rendered` with an element report it.
   */
  visible(slot: string, contentId: string, shown: boolean, decisionId?: string): void;
  /**
   * P30 (decision D2): the per-view beacon of a page drawn from a cached layout:
   * the `X-Context-Key` the cached layout was answered under, the page, the
   * layout slot and the module ids drawn, in drawn order. Sent as one
   * `layout_exposure` action, once per page view and slot (the page view a
   * `hydrate` or `refresh` of that page opened, else the one this call opens for
   * the cached page), only under the shopper's tracking consent and never in
   * listen-only mode; it asks for no decisions. The key is sent as given: the
   * engine counts the drawn modules only for a key it issued. Resolves when sent
   * or not sent, never rejects.
   */
  layoutExposure(beacon: LayoutExposure): Promise<void>;
  destroy(): void;
}

export interface ListenOptions {
  /** Minimum on-screen time before a dwell event is worth sending. */
  dwellMinMs?: number;
  /** P40: a slot's own dwell minimum, by slot; every other slot keeps `dwellMinMs`. */
  dwellMinMsBySlot?: Record<string, number>;
  /** Optional periodic publication refresh; minimum 1s, maximum 5min. */
  refreshMs?: number;
}

export function createListen(core: Core, opts: ListenOptions = {}): Listen {
  const host = core.host;
  const dwellMinMs = opts.dwellMinMs ?? 1_000;
  const slotSubs = new Map<string, Set<SlotCallback>>();
  const setSubs = new Set<SetCallback>();
  type Paint = { key: string; piece: ContentDecision; page: string; pageInstance: string; generation: number; envelope: ActionEnvelope;
    ack?: RenderAcknowledgment; pending?: Promise<RenderAcknowledgment | null>; attempts: number; observed?: boolean;
    /** P03 decision D3: the placement's position within its slot, carried by its acknowledgement and every engagement of it. */
    slotPosition?: number;
    /** P40: the running one-second viewable timer, and whether the viewable impression was sent on this page instance. */
    viewTimer?: unknown; viewed?: boolean };
  const painted = new Map<string, Paint>();
  /** P40: the placements the page's visibility port reports at least half in view now. */
  const views = new Set<string>();
  const observers = new Set<() => void>();
  let current: DecisionSet | null = null;
  let absence: DecisionSet | null = null;
  let selected: HydrateOptions | undefined, pageInstance = '', destroyed = false;
  let refreshing: Promise<DecisionSet | null> | undefined, trailing = false;
  let adopted = false;
  /**
   * P34: the page view (its page instance) and its one first-decision deadline,
   * measured from its first snapshot request; `met` once anything was delivered,
   * `expired` once the deadline delivered the empty list.
   */
  let pageView: { instance: string; deadline?: unknown; met: boolean; expired?: boolean } = { instance: '', met: true };
  /** P34: the page view's first snapshot while in flight, and whether an acknowledged event or a socket open asked to follow it. */
  let opening: { owner: number; follow?: boolean } | undefined;
  /** P34: the slots the page holds, each for the page view it was held in. */
  const holds = new Map<object, { slot: string; pageInstance: string }>();
  /** P30: the page view of a page drawn from a cache without a snapshot of its own, and the page views and slots already reported. */
  let cachedView: { page: string; productId?: string; instance: string } | null = null;
  const exposed = new Set<string>();
  const content = core.bindContent((type, data) => type === 'content_impression'
    ? rendered(String(data.slot ?? ''), String(data.contentId ?? ''), undefined, typeof data.decisionId === 'string' ? data.decisionId : undefined).then(() => null)
    : outcome(type, String(data.contentId ?? ''), String(data.slot ?? ''), data));
  /** Each slot's decisions, in order. */
  function bySlot(decisions: ContentDecision[]): Map<string, ContentDecision[]> {
    const slots = new Map<string, ContentDecision[]>();
    for (const d of decisions) { const list = slots.get(d.slot) ?? []; list.push(d); slots.set(d.slot, list); }
    for (const list of slots.values()) list.sort((a, b) => a.order - b.order);
    return slots;
  }
  /**
   * P34: a painted receipt is keyed by its slot, its position within the slot and
   * its item. The position is derived from the delivered list (the slot's
   * decisions in order, from 0), which is the engine's `slotPosition` whenever the
   * answer names it, on delivery and on adoption alike; a shift of the page-wide
   * `order` alone changes no key.
   */
  function placements(set: DecisionSet | null): Map<ContentDecision, string> {
    const keys = new Map<ContentDecision, string>();
    for (const [slot, list] of bySlot(set?.decisions ?? [])) list.forEach((d, i) => keys.set(d, JSON.stringify([slot, i, d.contentId])));
    return keys;
  }
  const placement = (set: DecisionSet | null, d: ContentDecision) => placements(set).get(d) ?? '';
  /** The decisions of a set a page's report names: by slot and piece, and by receipt when it gives one. */
  const pick = (set: DecisionSet | null, slot: string, contentId: string, decisionId?: string) => set?.decisions.filter(d => d.slot === slot
    && d.contentId === contentId && (decisionId === undefined || decisionId === d.decisionId)) ?? [];
  /**
   * P03 decision D3: a placement's position within its slot, what its decision
   * record calls `position`, exactly as the engine named it on the decision
   * (`slotPosition`, a whole number from 0). A decision that does not name it (a
   * server-rendered bootstrap, an earlier engine) has none, and the SDK never
   * computes one: its acknowledgement is then admitted on `position`, as before.
   */
  const slotPositionOf = (piece: ContentDecision): number | undefined =>
    Number.isSafeInteger(piece.slotPosition) && piece.slotPosition! >= 0 ? piece.slotPosition : undefined;
  const sameAsset = (a: ContentDecision, b: ContentDecision) => a.customerContentId === b.customerContentId && a.type === b.type;
  const permitted = (set: DecisionSet | null) => {
    if (!set || !decisionRequiresConsent(set)) return true;
    const consent = core.consent;
    return consent.tracking && consent.personalization;
  };
  let intent = 0, delivery = 0;
  function resetCapture(): void { for (const paint of painted.values()) host.clearTimeout(paint.viewTimer); painted.clear(); views.clear(); for (const stop of [...observers]) stop(); }

  /**
   * P40 (decisions D1, D2): a painted placement in view or out of it, by its key.
   * In view, once its render acknowledgement is held, a one-second timer starts;
   * leaving view, a detach of the capture that reported it, and `resetCapture`
   * (a consent refusal, a new generation or page instance, `destroy`) stop it.
   * When it fires the placement must still be in view and still the painted one,
   * and the page's own clock must say the second has passed (a timer that fires
   * early waits out the rest); then its one viewable impression on this page
   * instance is sent, with the fields of its acknowledgement and never the
   * admission capability.
   */
  function view(key: string, shown: boolean): void {
    const paint = painted.get(key);
    if (!shown) {
      views.delete(key);
      if (paint) { host.clearTimeout(paint.viewTimer); paint.viewTimer = undefined; }
      return;
    }
    views.add(key);
    if (!paint?.ack || paint.viewed || paint.viewTimer !== undefined) return;
    const since = host.now();
    const wait = (ms: number): void => {
      paint.viewTimer = host.setTimeout(() => {
        paint.viewTimer = undefined;
        const left = since + 1_000 - host.now();
        if (!views.has(key) || painted.get(key) !== paint || paint.viewed) return;
        if (left > 0) { if (left < 1_000) wait(left); return; }
        paint.viewed = true;
        const { renderOffer: _offer, ...data } = paint.envelope.data;
        void _offer;
        void content.send('content_viewable', data);
      }, ms);
    };
    wait(1_000);
  }
  function visible(slot: string, contentId: string, shown: boolean, decisionId?: string): void {
    const set = admittedCurrent(), matches = pick(set, slot, contentId, decisionId);
    if (matches.length === 1) view(placement(set, matches[0]!), shown);
  }
  const offConsent = core.onConsentChange(() => { if (!core.trackingAllowed) resetCapture(); keepForHead(); if (!permitted(current)) deliver(null, current?.page ?? ''); });

  /**
   * P84 (E8): what the head script reads before the next paint, kept under `opt_head` beside its own state: the
   * consent the engine acknowledged (so a page without the server render's hint knows it, and a withdrawal reaches
   * the next paint) and, from an answer, its experiment (the id names the salt, `<tenant>:<brand>:<salt>`, with the
   * salt version), from which the head script computes the class of a browser the engine knows.
   */
  function keepForHead(experiment?: unknown): void {
    try {
      let prior: unknown = null;
      try { prior = JSON.parse(host.storage.get(HEAD_STATE_KEY) ?? 'null'); } catch { prior = null; }
      const c = core.consent, e = experiment as { id?: unknown; saltVersion?: unknown } | null | undefined;
      host.storage.set(HEAD_STATE_KEY, JSON.stringify({ ...(prior && typeof prior === 'object' && !Array.isArray(prior) ? prior : {}),
        ...(e && typeof e.id === 'string' ? { experiment: { id: e.id, saltVersion: typeof e.saltVersion === 'number' ? e.saltVersion : null } } : {}),
        consent: { personalization: c.tracking && c.personalization, tracking: c.tracking } }));
    } catch { /* storage unavailable: the head script paints the default row */ }
  }
  /** P84 (E8, D2): the class the head script drew for this browser, as the first decision request carries it, or none. */
  function headDraw(): string | undefined {
    try {
      const state = JSON.parse(host.storage.get(HEAD_STATE_KEY) ?? 'null') as { arm?: { class?: unknown; tableVersion?: unknown } } | null;
      const arm = state?.arm;
      return arm && (arm.class === 'default' || arm.class === 'personalized') && typeof arm.tableVersion === 'string' && arm.tableVersion.length <= 128
        ? JSON.stringify({ class: arm.class, tableVersion: arm.tableVersion }) : undefined;
    } catch { return undefined; }
  }

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
    // P34: the page view has received the decisions or the empty list: its deadline is met.
    pageView.met = true; host.clearTimeout(pageView.deadline);
    for (const [token, held] of holds) if (held.pageInstance !== pageInstance) holds.delete(token);
    // Read purpose/authority before the reentrancy fences: observing a new
    // refusal can itself synchronously dispatch a newer absence/default.
    const active = () => permitted(set) && (!set || core.isCurrent(generation))
      && generation === core.generation && owner === intent && epoch === delivery;
    const previous = current;
    const sameView = !!set && !!previous && previous.page === set.page && previous.pageInstance === set.pageInstance;
    if (!set || previous && !sameView) resetCapture();
    if (set) {
      // P34: a slot the page holds for this page view stays as it was last
      // delivered, its painted receipts with it; known absence is never held.
      const held = new Set(sameView ? [...holds.values()].filter(h => h.pageInstance === set!.pageInstance).map(h => h.slot) : []);
      if (held.size) {
        const done = new Set<string>();
        const keep = (slot: string) => done.has(slot) ? [] : (done.add(slot), previous!.decisions.filter(d => d.slot === slot));
        set = { ...set, decisions: [...set.decisions.flatMap(d => held.has(d.slot) ? keep(d.slot) : [d]), ...[...held].flatMap(keep)] };
      }
      const keys = placements(set), live = new Set(keys.values());
      for (const key of painted.keys()) if (!live.has(key)) painted.delete(key);
      // An unchanged DOM placement keeps the receipt that was actually painted,
      // even when a newer poll carries another offer for the same item; it takes
      // the page-wide order the newer answer gives it, so its slot stays in order.
      set = { ...set, decisions: set.decisions.map(d => {
        const key = keys.get(d)!, paint = painted.get(key);
        if (paint && !sameAsset(paint.piece, d)) painted.delete(key);
        return paint && sameAsset(paint.piece, d) && paint.generation === generation && paint.pageInstance === set!.pageInstance
          ? paint.piece.order === d.order ? paint.piece : { ...paint.piece, order: d.order } : d;
      }) };
    }
    const unchanged = sameView && JSON.stringify(previous!.decisions) === JSON.stringify(set!.decisions);
    current = set;
    adopted = false;
    absence = set ? null : { page, decisions: [] };
    const context = set ?? absence!;
    if (unchanged) return epoch;
    // P34: a slot whose placements are unchanged is not repainted, whatever the
    // page-wide order of its decisions now is.
    const lists = bySlot(context.decisions ?? []), before = sameView ? bySlot(previous!.decisions) : undefined;
    const shape = (list: ContentDecision[] = []) => JSON.stringify(list.map(d => ({ ...d, order: 0 })));
    for (const [slot, subs] of slotSubs) {
      const list = lists.get(slot) ?? [];
      if (before && shape(before.get(slot)) === shape(list)) continue;
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

  const offDecisions = core.on('decisions', (set) => { if (!set.pageInstance || !pageInstance || set.pageInstance === pageInstance) apply(set); }); // P81: another page view's pushed set is not drawn
  const offGeneration = core.on('generation', () => {
    cachedView = null; exposed.clear();
    const page = current?.page ?? absence?.page ?? '';
    // Generation rejects old async work itself. Do not steal an in-progress
    // ready() call's intent merely because its own expired grant was renewed.
    pageInstance = ''; deliver(null, page);
  });

  function hydrate(o: HydrateOptions): Promise<DecisionSet | null> { return load(o, false); }

  async function load(o: HydrateOptions, looped: boolean): Promise<DecisionSet | null> {
    if (destroyed) return null;
    if (!pageInstance || !selected || !samePageView(selected, o)) { pageInstance = host.uuid(); resetCapture(); }
    selected = { ...o };
    // ready() can synchronously change identity and reenter through a listener.
    const owner = ++intent;
    // P34: the first snapshot request of a page view starts its one deadline,
    // a hard ceiling: no re-ask restarts it, and a re-ask after the first
    // delivery leaves the page as it is until its own answer or failure.
    let flight: typeof opening;
    if (pageView.instance !== pageInstance) {
      host.clearTimeout(pageView.deadline);
      const v: typeof pageView = pageView = { instance: pageInstance, met: false };
      v.deadline = host.setTimeout(() => {
        if (pageView === v && !v.met && !destroyed && pageInstance === v.instance) { v.expired = true; deliver(null, o.page); }
      }, core.config.hydrateTimeoutMs);
      opening = flight = { owner };
    }
    const v = pageView, expired = v.expired;
    /** The deadline already delivered the empty list while this request was in flight. */
    const timedOut = () => !!v.expired && !expired;
    try {
      // P13 (H4): a new visitor's session is issued with this decision request, one
      // call; consent-dependent context (session, channel) is never sent then.
      const nothingToShow = nothingToShowField(o.nothingToShow);
      // P80: the page view's product (P79) is the anchor product of a slot scoped to it, its variant beside it, within bounds.
      const anchor = anchorSignals(o);
      // P84 (E8, R-P363 C2, R-P366): the arrival, only where a recorded choice already grants tracking (none is
      // computed before one), and the class the head script drew (D2): the engine mints the identifier into it.
      const arrival = core.consent.tracking ? snapshotEntry(core.entry) : undefined, drawn = headDraw();
      const first: FirstRequest = { body: { page: o.page, pageInstance, ...(core.config.brand ? { brand: core.config.brand } : {}), ...(nothingToShow ? { nothingToShow } : {}), ...anchor,
        ...(arrival ? { entry: arrival } : {}), ...(drawn ? { arm: drawn } : {}) } };
      const pending = core.ready(false, first);
      const generation = core.generation;
      const active = () => owner === intent && generation === core.generation;
      if (!active()) return null;
      if (!await pending || !active() || !core.isCurrent(generation)) {
        if (!timedOut() && active()) deliver(null, o.page);
        return null;
      }
      const consent = core.consent;
      const json = (first.answered ? first.answer : await core.getJson(core.config.paths.snapshot, {
        page: o.page,
        pageInstance,
        browsingSessionId: consent.tracking ? core.sessionId : undefined, brand: core.config.brand, channel: consent.tracking ? o.channel : undefined,
        entry: consent.tracking ? snapshotEntry(core.entry) : undefined,
        trackingConsent: consent.tracking ? undefined : 'false', personalizationEnabled: consent.personalization ? undefined : 'false',
        nothingToShow, ...anchor,
      })) as { ok?: boolean; page?: string; pageInstance?: string; arm?: string; versions?: Record<string, number>; config_label?: string; decisions?: unknown; ts?: number } | null;
      if (!active() || !core.isCurrent(generation)) return null;
      if (!json || json.ok !== true || !Array.isArray(json.decisions) || json.page !== undefined && json.page !== o.page
        || json.pageInstance !== undefined && json.pageInstance !== pageInstance) {
        if (!timedOut()) deliver(null, o.page);
        return null;
      }
      keepForHead((json as { experiment?: unknown }).experiment);
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
    } finally {
      // P34: an acknowledged event or a socket open during this first snapshot
      // asked to follow it: now that its answer is delivered, one refresh.
      if (opening === flight) opening = undefined;
      if (flight?.follow && owner === intent && !destroyed) { if (looped) trailing = true; else void refresh(); }
    }
  }

  function refresh(o?: HydrateOptions): Promise<DecisionSet | null> {
    if (destroyed || !o && !selected) return Promise.resolve(null);
    if (o && selected && !samePageView(o, selected)) {
      ++intent; selected = { ...o }; pageInstance = host.uuid(); resetCapture();
    } else if (o) selected = { ...o };
    if (refreshing) { ++intent; trailing = true; return refreshing; }
    const operation = (async () => {
      let result: DecisionSet | null = null;
      do { trailing = false; result = await load(selected!, true); } while (trailing && !destroyed);
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
    const set = admittedCurrent(), matches = pick(set, slot, contentId, decisionId);
    if (!set?.pageInstance || matches.length !== 1) return null;
    const piece = matches[0]!;
    if (!piece.renderOffer || !piece.decisionId) return null;
    const key = placement(set, piece), generation = core.generation;
    let paint = painted.get(key);
    if (!paint) {
      // P03 decision D1: this acknowledgement is the module's one impression on
      // this page instance. Decision D3: it names the page-wide order as
      // `position` and the position within the slot as `slotPosition`.
      const slotPosition = slotPositionOf(piece);
      const data = { contentId, slot, decisionId: piece.decisionId, page: set.page, position: piece.order,
        ...(slotPosition !== undefined ? { slotPosition } : {}), pageInstance: set.pageInstance,
        renderOffer: piece.renderOffer, customerContentId: piece.customerContentId, contentType: piece.type };
      paint = { key, piece, page: set.page, pageInstance: set.pageInstance, generation, envelope: core.envelope('content_impression', data), attempts: 0,
        ...(slotPosition !== undefined ? { slotPosition } : {}) };
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
        // P40: a placement already in view starts its viewable second now.
        if (ack) { selectedPaint.ack = ack; if (views.has(key)) view(key, true); }
        return ack;
      }).finally(() => { selectedPaint.pending = undefined; });
    }
    // P60: `pending` spans the acknowledgement's one retry after a cut (core.ts `sendRender`), so a
    // retry answered `pending` or `recovered` arms the placement here (its dwell), in `view` (its
    // viewable second) and in `outcome` (its engagements); only a retry cut too leaves it unarmed.
    const ack = paint.ack ?? await paint.pending ?? null;
    if (!ack || !active()) return null;
    // One observation per element per client: when the declarative scan already
    // watches this node, the page is not observed twice and the dwell is not
    // counted twice (document 35 §5 W17; F34 §2B/§2D).
    if (el && host.dom && !paint.observed && !core.bindings.observes(el)) {
        paint.observed = true;
        const { renderOffer: _offer, ...data } = paint.envelope.data;
        void _offer; // Intentionally exclude the admission capability from dwell.
        let shownAt: number | null = null;
        let off: () => void = () => undefined; let stopped = false;
        const stop = () => { if (stopped) return; stopped = true; shownAt = null; view(key, false); off(); observers.delete(stop); };
        observers.add(stop);
        const release = core.bindings.addObserver(host.dom, el, (visible) => {
          if (stopped || !active()) { stop(); return; }
          view(key, visible);
          if (visible) { if (shownAt === null) shownAt = host.now(); return; }
          if (shownAt === null) return;
          const ms = host.now() - shownAt;
          shownAt = null;
          if (ms >= dwellMinFor(slot, dwellMinMs, opts.dwellMinMsBySlot)) void outcome('content_dwell', contentId, slot, { ...data, ms });
          stop();
        });
        if (release) off = release;
        if (stopped) off();
    }
    return ack;
  }

  async function outcome(type: SdkEventType, contentId: string, slot: string, attrs: Record<string, unknown> = {}): Promise<EngineUpdate | null> {
    if (type === 'content_impression' || type === 'content_viewable') return null;
    const candidates = [...painted.values()].filter(p => p.piece.slot === slot && p.piece.contentId === contentId
      && (attrs.decisionId === undefined || attrs.decisionId === p.piece.decisionId));
    if (candidates.length !== 1) return null;
    const paint = candidates[0]!, ack = paint.ack ?? await paint.pending;
    if (!ack || destroyed || !core.isCurrent(paint.generation) || !core.trackingAllowed || current?.pageInstance !== paint.pageInstance
      || painted.get(paint.key) !== paint) return null;
    const { renderOffer: _offer, action: _action, event: _event, eventName: _eventName, slotPosition: _slotPosition, ...safe } = attrs;
    void _offer; void _action; void _event; void _eventName; void _slotPosition;
    // P03 decision D3: an engagement names the position within the slot of the
    // placement it engaged as its acknowledgement did — never what the page says
    // about it — beside the receipt of that acknowledgement.
    return content.send(type, { ...safe, contentId, slot, decisionId: ack.decisionId,
      ...(paint.slotPosition !== undefined ? { slotPosition: paint.slotPosition } : {}) });
  }

  /** A server-rendered element's placement as its attributes name it: slot, page-wide position (`data-op-position`) and item. */
  const element = (d: Pick<ContentDecision, 'slot' | 'order' | 'contentId'>) => JSON.stringify([d.slot, d.order, d.contentId]);

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
      if (!d || typeof d.contentId !== 'string' || typeof d.slot !== 'string' || !Number.isSafeInteger(d.order) || expected.has(element(d))) return fail();
      expected.set(element(d), d);
    }
    if (elements.length !== expected.size) return fail();
    const matched = new Set<string>();
    for (const el of elements) {
      const key = element({ slot: el.getAttribute('data-op-slot') ?? '', contentId: el.getAttribute('data-op-content') ?? '', order: Number(el.getAttribute('data-op-position')) });
      const d = expected.get(key);
      if (!d || matched.has(key) || el.getAttribute('data-op-page-instance') !== b.pageInstance
        || (el.getAttribute('data-op-decision-id') ?? undefined) !== d.decisionId) return fail();
      matched.add(key);
    }
    if (owner !== intent || generation !== core.generation || !core.isCurrent(generation) || host.now() >= b.until || !permitted(b)) return fail();
    resetCapture(); selected = { ...o }; pageInstance = b.pageInstance; current = { ...b, decisions: b.decisions.map(d => ({ ...d })) }; absence = null; adopted = true; ++delivery;
    // P34: the server's paint is this page view's first delivery; a later snapshot is a re-ask.
    host.clearTimeout(pageView.deadline); pageView = { instance: b.pageInstance, met: true };
    for (const el of elements) void rendered(el.getAttribute('data-op-slot')!, el.getAttribute('data-op-content')!, el,
      el.getAttribute('data-op-decision-id') ?? undefined);
    return true;
  }

  /**
   * P34: an acknowledged event asks again (P81: only while no socket is connected:
   * a connected socket gets the engine's push). While the page view's first snapshot
   * is in flight it is not cancelled: its answer is delivered, then one refresh
   * follows, however many arrived; later they coalesce as `refresh()` does.
   */
  function follow(): void {
    if (!selected) return;
    if (opening && opening.owner === intent) opening.follow = true;
    else void refresh();
  }

  async function layoutExposure(beacon: LayoutExposure): Promise<void> {
    if (destroyed || core.config.listenOnly || !core.trackingAllowed || !beacon || typeof beacon !== 'object') return;
    const { contextKey, page, slot } = beacon, modules: unknown[] = Array.isArray(beacon.modules) ? beacon.modules : [];
    if (typeof contextKey !== 'string' || !contextKey || contextKey.length > 512 || typeof page !== 'string' || !page || typeof slot !== 'string' || !slot
      || !modules.length || modules.length > 50 || !modules.every(id => typeof id === 'string' && id.length > 0) || new Set(modules).size !== modules.length) return;
    // The page view: the one a snapshot of this page (and product) opened, else the cached page's own, opened by
    // its first report. P79: a layout drawn for another product belongs to that product's own page view.
    const productId = typeof beacon.productId === 'string' && beacon.productId ? beacon.productId : undefined;
    const instance = pageInstance && selected?.page === page && (productId === undefined || selected.productId === productId) ? pageInstance
      : cachedView?.page === page && cachedView.productId === productId ? cachedView.instance : (cachedView = { page, productId, instance: host.uuid() }).instance;
    const once = JSON.stringify([instance, slot]);
    if (exposed.has(once)) return;
    if (exposed.size >= 256) exposed.delete(exposed.values().next().value!);
    exposed.add(once);
    await core.send('layout_exposure', { contextKey, page, slot, modules: [...modules] as string[], pageInstance: instance });
  }

  function hold(slot: string): () => void {
    const token = {};
    if (!destroyed) holds.set(token, { slot, pageInstance });
    return () => { holds.delete(token); };
  }

  // P30: nor does the cached layout's beacon, which reports what a cache drew.
  const offSent = core.on('sent', event => { if (!['content_impression', 'content_dwell', 'content_viewable', 'layout_exposure'].includes(event.type) && core.socketStatus !== 'connected') follow(); });
  // P81: a socket open asks nothing again; the engine pushes the page view's changes. P74 (R-P311): a socket connected
  // again after it was lost (closed, reconnecting or in error after this view's first connection) asks once, since the
  // engine dropped the page view it pushes to with the shopper's last socket; a first open asks nothing, an open during
  // the first snapshot follows it with nothing, and the welcome frame (no change of status) is never a reconnect.
  let joined = false, lost = false;
  const offSocket = core.on('socket', status => {
    if (status === 'connected') { if (lost) { lost = false; follow(); } joined = true; }
    else if (joined && (status === 'reconnecting' || status === 'closed' || status === 'error')) lost = true;
  });
  const timer = opts.refreshMs === undefined ? undefined : host.setInterval(() => { if (selected) void refresh(); }, Math.max(1_000, Math.min(300_000, opts.refreshMs)));
  function destroy(): void { destroyed = true; ++intent; resetCapture(); host.clearTimeout(pageView.deadline); holds.clear(); exposed.clear(); cachedView = null; content.release(); offSent(); offSocket(); offConsent(); offDecisions(); offGeneration(); if (timer !== undefined) host.clearInterval(timer); slotSubs.clear(); setSubs.clear(); current = null; absence = null; }
  return { hydrate, refresh, hold, adopt, subscribe, onDecisions, apply, current: admittedCurrent, rendered, outcome, visible, layoutExposure, destroy };
}
