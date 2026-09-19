// src/sdk/core.ts
// The shared core: identity, the event bus, and transport. Non-negotiable as a
// shared piece because events and decisions must be keyed to the same visitor
// id and one socket serves both directions. Extracted from the demo storefront:
// the socket URL, the welcome frame, the reconnect delay, the action envelope
// and the POST-versus-push dedupe are its behavior, verbatim.

import { currentSessionId, DEFAULT_VISITOR_KEY, entrySignals, writeVisitorId, rotateBrowsingSession } from './identity';
import { toWire } from './wire';
import { isEventNonce, isEventTimestamp } from '../events/actionTypes';
import type {
  ActionEnvelope, ClientConfig, CoreEvents, DecisionSet, DomLike, ElementLike, EngineUpdate, EntrySignals, Host, Paths,
  SdkEventType, SocketLike, SocketStatus, ConsentInstruction, RenderAcknowledgment,
} from './types';

export const DEFAULT_PATHS: Paths = {
  identitySession: '/v1/{tenant}/identity/session',
  action: '/realtime/action',
  ws: '/realtime/ws',
  reflex: '/realtime/reflex',
  snapshot: '/v1/{tenant}/decisions/snapshot',
  identityLink: '/v1/{tenant}/identity/link',
  identityDetach: '/v1/{tenant}/identity/detach',
};

/** Only explicit default sets (including editorial pins) and empty absence
 * are public. Unknown/exploration arms need consent even with zero scores. */
export function decisionRequiresConsent(set: Pick<DecisionSet, 'arm' | 'decisions'>): boolean {
  if (!Array.isArray(set.decisions)) return true;
  return (set.arm !== undefined && set.arm !== 'default') || set.decisions.length > 0 && (set.arm !== 'default'
    || set.decisions.some(d => d?.strategy === 'affinity' || Boolean(d?.explain?.drivers?.length)));
}

export interface ResolvedConfig {
  tenant: string;
  brand?: string;
  endpoint: string;
  sdkKey?: string;
  source: string;
  surface?: string;
  listenOnly: boolean;
  heartbeatMs: number;
  reconnectMs: number;
  hydrateTimeoutMs: number;
  visitorIdKey: string;
  paths: Paths;
  sessionBroker?: string;
}

export function resolveConfig(c: ClientConfig, host: Host): ResolvedConfig {
  const origin = host.location ? `${host.location.protocol}//${host.location.host}` : '';
  if (c.sessionBroker !== undefined && (!origin || !/^\/[A-Za-z0-9_/-]{1,160}$/.test(c.sessionBroker) || c.sessionBroker.startsWith('//'))) throw new Error('First-party broker unavailable');
  return {
    tenant: c.tenant,
    ...(c.brand ? { brand: c.brand } : {}),
    endpoint: (c.endpoint ?? origin).replace(/\/+$/, ''),
    ...(c.sdkKey ? { sdkKey: c.sdkKey } : {}),
    source: c.source ?? 'sdk',
    ...(c.surface ? { surface: c.surface } : {}),
    listenOnly: Boolean(c.listenOnly),
    heartbeatMs: c.heartbeatMs ?? 25_000,
    reconnectMs: c.reconnectMs ?? 3_000,
    hydrateTimeoutMs: c.hydrateTimeoutMs ?? 1_500,
    visitorIdKey: c.visitorIdKey ?? DEFAULT_VISITOR_KEY,
    paths: { ...DEFAULT_PATHS, ...(c.paths ?? {}) },
    ...(c.sessionBroker ? { sessionBroker: origin + c.sessionBroker } : {}),
  };
}

export interface SendOptions {
  /** Fire-and-forget through the beacon API, for page-hide moments. */
  beacon?: boolean;
  keepalive?: boolean;
}

export function contentInteraction(type: SdkEventType, data: Record<string, unknown>): SdkEventType | undefined {
  return [data.action, data.eventName, data.event, type].map(name => typeof name === 'string' ? name.trim() : '')
    .find(name => ['content_impression', 'content_click', 'content_dwell', 'video_complete'].includes(name)) as SdkEventType | undefined;
}
/**
 * What one client owns on the page it was given, so it can hand all of it
 * back. Every DOM listener the SDK adds is recorded with its element, type and
 * handler and removed with a real `removeEventListener` on release; an element
 * is observed once per client however many capture paths name it, so a
 * declarative scan and a `rendered()` call over the same node produce one
 * observation and one dwell rather than two (document 35 §5 W17; F34 §2A/§2B/§3).
 * It is bookkeeping over whatever nodes the page hands the SDK: nothing here
 * is tenant-, customer- or taxonomy-specific.
 */
export interface PageBindings {
  /** Register a listener this client owns. The release removes it from the element. */
  addListener(el: ElementLike, type: string, handler: (ev: unknown) => void): () => void;
  /** Observe an element once per client. Null when this client already observes it. */
  addObserver(dom: DomLike, el: ElementLike, cb: (visible: boolean) => void): (() => void) | null;
  /** Whether this client already holds an observation of the element. */
  observes(el: ElementLike): boolean;
  /** Hand back every listener and observation this client still holds. */
  release(): void;
}

function createPageBindings(): PageBindings {
  const listeners = new Set<() => void>();
  const observed = new Map<ElementLike, () => void>();
  return {
    addListener(el, type, handler) {
      let released = false;
      const off = (): void => {
        if (released) return;
        released = true;
        listeners.delete(off);
        // A port without the release half leaves the handler registered; the
        // caller's own inactive guard keeps it from ever reporting again.
        el.removeEventListener?.(type, handler);
      };
      listeners.add(off);
      el.addEventListener(type, handler);
      return off;
    },
    addObserver(dom, el, cb) {
      if (observed.has(el)) return null;
      let released = false;
      let detach: (() => void) | undefined = undefined;
      const off = (): void => {
        if (released) return;
        released = true;
        if (observed.get(el) === off) observed.delete(el);
        // A synchronous observer can release before `observe` has returned its
        // detacher; the assignment below then runs it immediately.
        detach?.();
      };
      observed.set(el, off);
      const stop = dom.observe(el, cb);
      if (released) { stop(); return off; }
      detach = stop;
      return off;
    },
    observes: (el) => observed.has(el),
    release() { for (const off of [...listeners]) off(); for (const off of [...observed.values()]) off(); },
  };
}

export interface Core {
  readonly generation: number;
  /** Only a current explicit server choice permits collection or personalization. */
  readonly consent: { tracking: boolean; personalization: boolean };
  readonly trackingAllowed: boolean;
  onConsentChange(fn: () => void): () => void;
  /** Collect only after owned readiness, dropping work crossed by withdrawal or identity change. */
  capture(fn: () => void): void;
  ready(transition?: boolean): Promise<boolean>;
  beginTransition(): number;
  finishTransition(generation: number): void;
  forgetSession(generation: number): void;
  isCurrent(generation: number): boolean;
  adoptSession(session: unknown, generation: number, reason: 'identified' | 'logout'): boolean;
  readonly config: ResolvedConfig;
  readonly host: Host;
  /** The page listeners and observations this client owns, and their release. */
  readonly bindings: PageBindings;
  readonly visitorId: string;
  readonly anonId: string;
  readonly sessionId: string;
  readonly profileSessionId: string;
  readonly entry: EntrySignals;
  /**
   * R18: the browsing session that produced the CACHED `entry` signals, empty
   * while tracking is not allowed. It is deliberately not the current browsing
   * session: after an idle rollover it still names the session the cached entry
   * belongs to until the next entry read recomputes from the current document.
   */
  readonly entrySessionId: string;
  readonly socketStatus: SocketStatus;
  on<K extends keyof CoreEvents>(event: K, fn: CoreEvents[K]): () => void;
  emit<K extends keyof CoreEvents>(event: K, ...args: Parameters<CoreEvents[K]>): void;
  /** Builds one event identity/time pair; reuse the envelope to retain that identity. */
  envelope(type: SdkEventType, data?: Record<string, unknown>): ActionEnvelope;
  send(type: SdkEventType, data?: Record<string, unknown> | (() => Record<string, unknown>), opts?: SendOptions): Promise<EngineUpdate | null>;
  /** Internal listen wiring: legacy core.send content paths use the same ACK gate. */
  bindContent(handler: (type: SdkEventType, data: Record<string, unknown>) => Promise<EngineUpdate | null>): { send: Core['send']; release(): void };
  /** Retry this exact consent-approved render envelope; success is not an engine update. */
  sendRender(envelope: ActionEnvelope): Promise<RenderAcknowledgment | null>;
  matchesSessionWitness(witness: string): Promise<boolean>;
  url(path: string, query?: Record<string, string | undefined>): string;
  headers(extra?: Record<string, string>): Record<string, string>;
  getJson(path: string, query?: Record<string, string | undefined>): Promise<unknown | null>;
  /** POST JSON with the site key and credentials; never throws. */
  postJson(path: string, body: unknown): Promise<{ ok: boolean; status: number; json: unknown }>;
  /** CW25: the browser now carries this id. Writes both stores, announces the change, reconnects the socket if it was open. */
  setVisitorId(id: string, reason: 'identified' | 'logout'): void;
  connect(): void;
  disconnect(): void;
  /** Apply an engine update from either door, once. */
  applyIncoming(update: EngineUpdate, fromPush: boolean, rttMs: number | null): void;
}

export function createCore(config: ClientConfig, host: Host): Core {
  const cfg = resolveConfig(config, host);
  const bindings = createPageBindings();
  let visitorId = '', sessionId = '', anonId = '';
  let generation = 0;
  let eventSequence = 0;
  let transitioning = false;
  let capability = '';
  let expiresAt = 0;
  let bootstrapping: Promise<boolean> | null = null;
  const capabilityKey = `opt_shopper_session:${encodeURIComponent(cfg.endpoint)}:${encodeURIComponent(cfg.tenant)}`;
  const refusalKey = `opt_shopper_refusal:${encodeURIComponent(cfg.endpoint)}:${encodeURIComponent(cfg.tenant)}`;
  const refusalCookie = encodeURIComponent(refusalKey);
  const lifetime = 30 * 86400 * 1000;
  let instruction: ConsentInstruction | undefined;
  let consentTimer: unknown;
  let consentClock = -Infinity;
  const consentNow = () => Math.max(host.now(), consentClock);
  const refusalExpiry: Partial<Record<'tracking' | 'personalization', number>> = {};
  const mirrorOwned: Partial<Record<'tracking' | 'personalization', string>> = {};
  const mirrorExpected: Partial<Record<'tracking' | 'personalization', string | null>> = {};
  const mirrorRevision: Partial<Record<'tracking' | 'personalization', string>> = {};
  const sharedPending: Partial<Record<'tracking' | 'personalization', boolean>> = {};
  function readRefusal(): { tracking?: false; personalization?: false } {
    const result: { tracking?: false; personalization?: false } = {};
    for (const key of ['tracking', 'personalization'] as const) {
      delete sharedPending[key];
      try {
        const raw = host.cookie.get(`${refusalCookie}_${key}`);
        if (!raw) continue;
        const v = JSON.parse(decodeURIComponent(raw));
        if (v.version !== 1 || v.endpoint !== cfg.endpoint || v.tenant !== cfg.tenant || v.switch !== key) { result[key] = false; continue; }
        const choice = v.choice;
        if (choice?.value === false && Number.isSafeInteger(choice.expiresAt) && Number.isSafeInteger(choice.chosenAt)
          && choice.expiresAt - choice.chosenAt === lifetime && choice.expiresAt > consentNow()) {
          result[key] = false; refusalExpiry[key] = choice.expiresAt;
          sharedPending[key] = v.pending === true;
        }
      } catch { result[key] = false; }
    }
    return result;
  }
  function acceptInstruction(value: unknown, subject = visitorId): boolean {
    const v = value as ConsentInstruction | undefined;
    if (!v || v.version !== 1 || v.tenant !== cfg.tenant || v.subject !== subject || typeof v.revision !== 'string') return false;
    for (const key of ['tracking', 'personalization'] as const) {
      const c = v[key];
      if (c !== undefined && (typeof c.value !== 'boolean' || !Number.isSafeInteger(c.chosenAt) || !Number.isSafeInteger(c.expiresAt)
        || c.expiresAt - c.chosenAt !== lifetime)) return false;
    }
    instruction = JSON.parse(JSON.stringify(v)) as ConsentInstruction;
    if (consentTimer !== undefined) host.clearTimeout(consentTimer);
    const schedule = () => {
      const now = consentNow();
      const expiry = Math.min(...(['tracking', 'personalization'] as const).flatMap(k => instruction?.[k] && instruction[k]!.expiresAt > now ? [instruction[k]!.expiresAt] : []));
      const delay = Math.min(2147483647, Math.max(1, expiry - now));
      if (Number.isFinite(expiry)) consentTimer = host.setTimeout(() => {
        // A clock rollback cannot extend the authority whose timer already elapsed.
        consentClock = Math.max(consentClock, now + delay);
        for (const key of ['tracking', 'personalization'] as const) if (instruction?.[key] && instruction[key]!.expiresAt <= consentNow()) delete instruction[key];
        if (!instruction?.tracking && !instruction?.personalization) instruction = undefined;
        consentChanged(); schedule();
      }, delay);
      (consentTimer as { unref?: () => void } | undefined)?.unref?.();
    };
    schedule();
    return true;
  }
  const anchorKey = `${capabilityKey}:authority`;
  let anchor = '', transitionExpected: string | undefined;
  let lease: { generation: number; release: () => void } | undefined;
  const readAnchor = () => host.storage.get(anchorKey) ?? '';
  const sharedCurrent = () => {
    try {
      const observed = readAnchor();
      if (anchor && observed === anchor) return true;
      const saved = observed ? JSON.parse(observed) : undefined;
      if (capability && saved?.version === 1 && saved.persisted === true && saved.pending === false
        && host.storage.get(capabilityKey) === capability) { anchor = observed; return true; }
      return false;
    } catch { return false; }
  };
  function writeAnchor(persisted: boolean, pending = false): boolean {
    if (!lease || lease.generation !== generation) return false;
    const next = JSON.stringify({ version: 1, id: host.uuid(), persisted, pending });
    anchor = next;
    try { host.storage.set(anchorKey, next); return readAnchor() === next; } catch { return false; }
  }
  function releaseLease(g: number): void {
    if (lease?.generation === g) { const release = lease.release; lease = undefined; release(); }
  }
  let recovery: { tracking?: false; personalization?: false } = {};
  try {
    recovery = readRefusal();
  } catch { recovery = { tracking: false, personalization: false }; }
  type Switch = 'tracking' | 'personalization';
  type Refusal = { tracking?: false; personalization?: false };
  const switches: Switch[] = ['tracking', 'personalization'];
  const cookieNames = { tracking: 'opt_tracking_consent', personalization: 'opt_personalization_enabled' };
  const active: Refusal = { ...recovery };
  const pendingRefusal: Refusal = {};
  const consentListeners = new Set<() => void>();
  let consentEpoch = 0;
  let activityEpoch = 0;
  let entry: EntrySignals | undefined;
  let entrySessionId = '';
  function onConsentChange(fn: () => void): () => void { consentListeners.add(fn); return () => { consentListeners.delete(fn); }; }
  function notifyConsent(): void { for (const fn of consentListeners) { try { fn(); } catch { /* collector isolation */ } } }
  function consentChanged(): void {
    consentEpoch++;
    entry = undefined;
    entrySessionId = '';
    notifyConsent();
  }
  async function saveRefusal(clear?: Partial<Record<'tracking' | 'personalization', string | null>>): Promise<void> {
    let marker: Refusal = { ...recovery, ...pendingRefusal };
    try {
      if (capability && host.storage.get(capabilityKey) !== capability) marker = Object.keys(active).length ? { ...marker, ...active } : { tracking: false, personalization: false };
      const write = () => {
        for (const key of switches) {
          const name = `${refusalCookie}_${key}`, observed = host.cookie.get(name);
          const expiresAt = marker[key] === false ? refusalExpiry[key] ?? 0 : 0;
          const copy = { version: 1, endpoint: cfg.endpoint, tenant: cfg.tenant, subject: visitorId, switch: key,
            revision: mirrorRevision[key] ?? instruction?.revision, pending: pendingRefusal[key] === false,
            choice: { value: false, chosenAt: expiresAt - lifetime, expiresAt } };
          if (expiresAt > consentNow()) {
            if (observed && observed !== mirrorOwned[key] && observed !== mirrorExpected[key]) continue;
            const bytes = encodeURIComponent(JSON.stringify(copy));
            host.cookie.set(name, bytes, Math.max(0, Math.floor((expiresAt - consentNow()) / 1000)));
            mirrorOwned[key] = bytes;
          } else if (observed && (observed === mirrorOwned[key] || clear && Object.hasOwn(clear, key) && observed === clear[key])) {
            host.cookie.set(name, '', 0); delete mirrorOwned[key];
          }
        }
        host.storage.set(refusalKey, ''); // retire the old unbounded instruction copy
      };
      if (lease?.generation === generation && sharedCurrent()) write();
      else if (host.acquireAuthorityLock && sharedCurrent()) {
        const expected = anchor, g = generation;
        await host.acquireAuthorityLock(anchorKey).then(release => {
          try { if (g === generation && readAnchor() === expected) write(); }
          finally { release(); }
        }).catch(() => undefined);
      }
    } catch { /* memory still restricts */ }
  }
  function restrict(value: unknown, local = false): void {
    if (!value || typeof value !== 'object') return;
    const couldCapture = active.tracking !== false && pendingRefusal.personalization !== false;
    let changed = false, save = false;
    for (const key of switches) if ((value as Refusal)[key] === false) {
      if (active[key] !== false) { active[key] = false; changed = true; }
      if (local && pendingRefusal[key] !== false) { pendingRefusal[key] = false; save = true; }
    }
    if (couldCapture && (active.tracking === false || pendingRefusal.personalization === false)) activityEpoch++;
    if (save) saveRefusal();
    if (changed || save) consentChanged();
  }
  function acknowledge(value: unknown): void {
    restrict(value);
    if (!value || typeof value !== 'object') return;
    const held = pendingRefusal.personalization === false;
    let cleared = false;
    for (const key of switches) if ((value as Refusal)[key] === false && pendingRefusal[key] === false) { delete pendingRefusal[key]; cleared = true; }
    if (cleared) saveRefusal();
    if (held && pendingRefusal.personalization !== false) consentChanged();
  }
  function cookieFalse(key: Switch): boolean {
    try { return host.cookie.get(cookieNames[key]) === 'false'; } catch { return false; }
  }
  function consent(): { tracking: boolean; personalization: boolean } {
    // Cookie events are not delivered across tabs; every use observes the scoped
    // negative mirror, including a failed choice whose server reply never arrived.
    restrict(readRefusal());
    const hints: Refusal = {};
    for (const key of switches) if (active[key] !== false && cookieFalse(key)) hints[key] = false;
    restrict(hints, true);
    const allowed = (key: Switch) => active[key] !== false && instruction?.[key]?.value === true
      && instruction[key]!.chosenAt <= consentNow() && instruction[key]!.expiresAt > consentNow();
    return { tracking: allowed('tracking'), personalization: allowed('personalization') };
  }
  function trackingAllowed(): boolean { return consent().tracking && pendingRefusal.personalization !== false && !sharedPending.personalization && !transitioning; }
  function personalizationAllowed(): boolean { const c = consent(); return c.tracking && c.personalization && !transitioning; }
  function capture(fn: () => void): void {
    if (transitioning) return;
    if (isCurrent(generation)) { if (trackingAllowed()) fn(); return; }
    const pending = ready(), g = generation, epoch = activityEpoch;
    void pending.then(ok => { if (ok && isCurrent(g) && epoch === activityEpoch && trackingAllowed()) { try { fn(); } catch { /* collector isolation */ } } });
  }
  function rememberUnknownConsent(): void {
    recovery = { tracking: false, personalization: false };
    for (const key of switches) if (instruction?.[key]) refusalExpiry[key] = instruction[key]!.expiresAt;
    restrict(recovery);
    saveRefusal();
  }
  const session = () => {
    if (!trackingAllowed()) return '';
    const current = currentSessionId(host);
    if (entrySessionId !== current) { entrySessionId = current; entry = undefined; }
    return current;
  };
  const entryOf = (): EntrySignals => {
    if (!trackingAllowed()) return { utmMedium: '', utmSource: '', referrer: '', siteHost: '' };
    session();
    return entry ??= entrySignals(host);
  };

  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  let updateDelivery = 0;
  function on<K extends keyof CoreEvents>(event: K, fn: CoreEvents[K]): () => void {
    const set = listeners.get(event) ?? new Set();
    set.add(fn as (...args: unknown[]) => void);
    listeners.set(event, set);
    return () => { set.delete(fn as (...args: unknown[]) => void); };
  }
  function emit<K extends keyof CoreEvents>(event: K, ...args: Parameters<CoreEvents[K]>): void {
    const g = generation;
    const delivery = event === 'update' ? ++updateDelivery : updateDelivery;
    for (const fn of listeners.get(event) ?? []) {
      if (generation !== g || (event === 'update' && delivery !== updateDelivery)
        || (['sent', 'receipt', 'update', 'audience', 'decisions', 'identity'].includes(event) && !isCurrent(g))
        || ((event === 'sent' || event === 'receipt') && !trackingAllowed())
        || ((event === 'update' || event === 'audience') && !personalizationAllowed())
        || (event === 'decisions' && decisionRequiresConsent(args[0] as DecisionSet) && !personalizationAllowed())
        || (event === 'update' && (generation !== g || delivery !== updateDelivery))) break;
      try { fn(...args); } catch { /* a listener must never break the page */ }
    }
  }

  // Timestamp freshness is advisory, not a server sequence. Retain bounded exact
  // wire-JSON echoes only at the high-water; distinct same-millisecond updates live.
  let lastAppliedTs: number | undefined;
  const updateEchoes = new Set<string>();
  let updateEchoUnits = 0;
  function receiveUpdate(update: EngineUpdate, fromPush: boolean, rttMs: number | null): boolean {
    const g = generation, owner = updateDelivery;
    const current = () => personalizationAllowed() && isCurrent(g) && owner === updateDelivery;
    if (!current()) return false;
    const timestamp = update.timestamp;
    if (!current()) return false;
    if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
      if (lastAppliedTs !== undefined && timestamp < lastAppliedTs) return false;
      let fingerprint: string | undefined;
      try { fingerprint = JSON.stringify(update); } catch { /* non-wire callers may be unserializable */ }
      // A getter/toJSON can synchronously deliver a newer update or change identity.
      if (!current()) return false;
      if (lastAppliedTs === undefined || timestamp > lastAppliedTs) {
        lastAppliedTs = timestamp;
        updateEchoes.clear(); updateEchoUnits = 0;
      }
      if (typeof fingerprint === 'string' && fingerprint.length <= 65536) {
        if (updateEchoes.has(fingerprint)) return false;
        while (updateEchoes.size >= 32 || updateEchoUnits + fingerprint.length > 65536) {
          const oldest = updateEchoes.values().next().value!;
          updateEchoes.delete(oldest); updateEchoUnits -= oldest.length;
        }
        updateEchoes.add(fingerprint); updateEchoUnits += fingerprint.length;
      }
    }
    emit('update', update, { fromPush, rttMs });
    return personalizationAllowed() && g === generation && updateDelivery === owner + 1;
  }
  function applyIncoming(update: EngineUpdate, fromPush: boolean, rttMs: number | null): void {
    receiveUpdate(update, fromPush, rttMs);
  }

  function url(path: string, query?: Record<string, string | undefined>): string {
    const base = `${cfg.endpoint}${path.replace('{tenant}', encodeURIComponent(cfg.tenant))}`;
    const parts = Object.entries(query ?? {}).filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    return parts.length ? `${base}?${parts.join('&')}` : base;
  }
  function headers(extra: Record<string, string> = {}): Record<string, string> {
    return { ...(cfg.sdkKey ? { 'X-SDK-Key': cfg.sdkKey } : {}), 'X-Tenant': cfg.tenant, ...(isCurrent(generation) ? { 'X-Shopper-Session': capability } : {}), ...extra };
  }

  function isCurrent(g: number): boolean { return g === generation && !!capability && expiresAt * 1000 > host.now() && sharedCurrent(); }
  function beginTransition(): number {
    try { sharedCurrent(); transitionExpected = capability ? anchor : readAnchor(); } catch { transitionExpected = undefined; }
    const g = ++generation;
    transitioning = true;
    bootstrapping = null;
    lastAppliedTs = undefined;
    updateEchoes.clear(); updateEchoUnits = 0; updateDelivery++;
    entry = undefined;
    entrySessionId = '';
    const reconnect = wanted;
    disconnect();
    if (g !== generation) return g;
    wanted = reconnect;
    emit('generation', g);
    return g;
  }
  function finishTransition(g: number): void {
    if (g !== generation) { releaseLease(g); return; }
    if (lease?.generation === g && sharedCurrent()) {
      let persisted = false;
      try { persisted = !!capability && host.storage.get(capabilityKey) === capability; } catch { /* refuse recovery */ }
      if (!writeAnchor(persisted)) { capability = ''; expiresAt = 0; }
    }
    releaseLease(g);
    transitioning = false;
    notifyConsent();
    if (wanted) connect();
  }
  function forgetSession(g: number): void {
    if (g !== generation) return;
    rememberUnknownConsent();
    capability = ''; expiresAt = 0; visitorId = ''; sessionId = ''; anonId = '';
    if (lease?.generation === g && sharedCurrent()) {
      try { host.storage.set(capabilityKey, ''); } catch { /* storage unavailable */ }
      writeVisitorId(host, cfg.visitorIdKey, '');
      writeAnchor(false);
    }
    if (trackingAllowed()) rotateBrowsingSession(host);
  }
  function adoptSession(value: unknown, g: number, reason: 'identified' | 'logout'): boolean {
    const v = value as { tenant?: unknown; subject?: unknown; sessionId?: unknown; capability?: unknown; kind?: unknown; exp?: unknown; iat?: unknown; consent?: { tracking?: unknown; personalization?: unknown; instruction?: unknown } } | null;
    if (g !== generation || lease?.generation !== g || !sharedCurrent() || !v || v.tenant !== cfg.tenant || typeof v.subject !== 'string' || !v.subject
      || typeof v.sessionId !== 'string' || !v.sessionId || typeof v.capability !== 'string' || !/^ss1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v.capability)
      || (v.kind !== 'anonymous' && v.kind !== 'recognized') || typeof v.exp !== 'number' || !Number.isSafeInteger(v.exp)
      || typeof v.iat !== 'number' || !Number.isSafeInteger(v.iat) || v.iat > host.now() / 1000 || v.exp * 1000 <= host.now() || v.exp - v.iat > 86400 || v.exp <= v.iat) return false;
    // A recovery response must acknowledge every restriction before activity resumes.
    if ((recovery.tracking === false && v.consent?.tracking !== false)
      || (recovery.personalization === false && v.consent?.personalization !== false)) return false;
    acknowledge(v.consent);
    instruction = undefined;
    acceptInstruction(v.consent?.instruction, v.subject);
    const acceptedInstruction = instruction as ConsentInstruction | undefined;
    for (const key of switches) if (acceptedInstruction?.[key]) refusalExpiry[key] = Math.min(refusalExpiry[key] ?? Infinity, acceptedInstruction[key]!.expiresAt);
    if (g !== generation) return false;
    const previous = visitorId;
    if (previous && previous !== v.subject && consent().tracking) rotateBrowsingSession(host);
    visitorId = v.subject; sessionId = v.sessionId; capability = v.capability; expiresAt = v.exp;
    anonId = v.kind === 'anonymous' ? v.subject : '';
    const retained = { ...active, ...recovery, ...pendingRefusal };
    if (Object.keys(retained).length) saveRefusal();
    try { host.storage.set(capabilityKey, capability); } catch { /* storage unavailable */ }
    recovery = {};
    for (const key of switches) if (v.consent?.[key] === false) delete pendingRefusal[key];
    let anchored = false;
    try {
      // Browser storage wrappers may swallow quota errors: verify the new anchor first.
      anchored = host.storage.get(capabilityKey) === capability;
      if (anchored) saveRefusal();
    } catch { /* a retained marker can only restrict a later recovery */ }
    if (!anchored) try {
      saveRefusal();
    } catch { /* all client persistence may be unavailable; in-memory identity remains current */ }
    if (!writeAnchor(anchored, transitioning)) { capability = ''; expiresAt = 0; return false; }
    writeVisitorId(host, cfg.visitorIdKey, visitorId);
    emit('identity', { visitorId, previous, reason });
    if (g !== generation) return false;
    if (wanted && !transitioning) connect();
    return true;
  }
  function ready(transition = false): Promise<boolean> {
    consent();
    if (transitioning && !transition) return Promise.resolve(false);
    if (isCurrent(generation) && (!transition || lease?.generation === generation)) return Promise.resolve(true);
    if (bootstrapping) return bootstrapping;
    if (capability && !transition) {
      const g = beginTransition();
      if (g !== generation) return Promise.resolve(false);
      rememberUnknownConsent();
      transitioning = false; capability = ''; expiresAt = 0; visitorId = ''; sessionId = '';
    }
    const g = generation;
    const retiring = { capability, visitorId, expiresAt };
    let revocationAttempted = false;
    const refuseTransition = async (): Promise<boolean> => {
      if (transition && g === generation && retiring.capability && retiring.expiresAt * 1000 > host.now() && !revocationAttempted) {
        revocationAttempted = true;
        try { await host.fetch(url(cfg.paths.identityDetach), { method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-Tenant': cfg.tenant, 'X-Shopper-Session': retiring.capability,
            ...(cfg.sdkKey ? { 'X-SDK-Key': cfg.sdkKey } : {}) }, body: JSON.stringify({ visitorId: retiring.visitorId }) }); }
        catch { /* Unknown revocation remains failure, never successful logout. */ }
        // No anchor/capability clear: an unreadable store may already hold a newer grant.
        rememberUnknownConsent();
      }
      return false;
    };
    const operation = (async () => {
      try {
        if (!host.acquireAuthorityLock) return refuseTransition();
        if (lease?.generation !== g) {
          const release = await host.acquireAuthorityLock(anchorKey);
          if (g !== generation) { release(); return false; }
          lease = { generation: g, release };
          const previous = readAnchor();
          if (transition && transitionExpected !== previous) return refuseTransition();
          anchor = previous;
          let persisted = false;
          try { persisted = !!capability && host.storage.get(capabilityKey) === capability; } catch { /* refuse shared recovery */ }
          const marker = readRefusal();
          if (Object.keys(marker).length) {
            const value = marker;
            recovery = { ...recovery, ...value }; restrict(value);
          }
          if (!writeAnchor(persisted, true)) {
            return refuseTransition();
          }
          if (capability && expiresAt * 1000 > host.now()) return true;
          let saved: { persisted?: unknown; pending?: unknown } | undefined;
          try { saved = previous ? JSON.parse(previous) : undefined; } catch { return false; }
          // An interrupted transition or failed capability write never revives the old account.
          if (saved && (saved.persisted !== true || saved.pending === true) && !Object.keys(recovery).length) rememberUnknownConsent();
        }
        let persisted = '';
        try { persisted = host.storage.get(capabilityKey) ?? ''; } catch { /* storage unavailable */ }
        if (Object.keys(recovery).length) persisted = '';
        const request = () => boundedJSON(cfg.sessionBroker ?? url(cfg.paths.identitySession), { method: 'POST', credentials: 'include', headers: { ...headers({ 'Content-Type': 'application/json' }), ...(persisted ? { 'X-Shopper-Session': persisted } : {}) }, body: JSON.stringify(Object.keys(active).length ? { consent: active } : {}) }, 16384);
        let res = await request();
        if (res.status === 401 && persisted && g === generation && !cfg.sessionBroker) {
          rememberUnknownConsent();
          persisted = '';
          try { host.storage.set(capabilityKey, ''); } catch { /* storage unavailable */ }
          res = await request();
        }
        const body = res.json as { ok?: unknown; session?: unknown } | null;
        if (g !== generation) return false;
        if (!res.ok || body?.ok !== true) {
          if (res.status === 401) try { host.storage.set(capabilityKey, ''); } catch { /* storage unavailable */ }
          return false;
        }
        return adoptSession(body.session, g, 'logout');
      } catch { return refuseTransition(); }
      finally {
        if (!transition) {
          if (g === generation && lease?.generation === g && sharedCurrent()) {
            let persisted = false;
            try { persisted = !!capability && host.storage.get(capabilityKey) === capability; } catch { /* unavailable */ }
            if (!writeAnchor(persisted)) { capability = ''; expiresAt = 0; }
          }
          releaseLease(g);
        }
      }
    })();
    bootstrapping = operation;
    void operation.finally(() => { if (bootstrapping === operation) bootstrapping = null; });
    return operation;
  }

  function envelope(type: SdkEventType, data: Record<string, unknown> = {}): ActionEnvelope {
    const tracking = trackingAllowed();
    const w = toWire(type, tracking ? data : {});
    const timestamp = host.now();
    let eventId: string | undefined;
    if (tracking && isCurrent(generation)) {
      if (!isEventTimestamp(timestamp) || eventSequence >= Number.MAX_SAFE_INTEGER) throw new Error('Event identity unavailable');
      const token = host.uuid();
      if (!isEventNonce(token) || token.length > 96) throw new Error('Event identity unavailable');
      eventId = `${token}-${(++eventSequence).toString(36)}`;
    }
    return {
      ...(eventId !== undefined ? { eventId } : {}),
      type: w.type,
      userId: visitorId,
      anonymousId: anonId,
      sessionId,
      browsingSessionId: session(),
      data: w.data,
      source: cfg.source,
      ...(cfg.surface ? { surface: cfg.surface } : {}),
      entry: entryOf(),
      timestamp,
    };
  }

  let contentHandler: ((type: SdkEventType, data: Record<string, unknown>) => Promise<EngineUpdate | null>) | undefined;
  function bindContent(handler: NonNullable<typeof contentHandler>) {
    contentHandler = handler;
    return { send: sendRaw, release() { if (contentHandler === handler) contentHandler = undefined; } };
  }
  async function send(type: SdkEventType, input: Record<string, unknown> | (() => Record<string, unknown>) = {}, opts: SendOptions = {}): Promise<EngineUpdate | null> {
    const pending = ready(), g = generation, epoch = activityEpoch;
    if (!await pending || !isCurrent(g) || !trackingAllowed() || epoch !== activityEpoch) return null;
    try {
      const data = typeof input === 'function' ? input() : input, content = contentInteraction(type, data);
      return content ? contentHandler ? contentHandler(content, data) : null : sendRaw(type, data, opts);
    } catch { return null; }
  }
  async function sendRaw(type: SdkEventType, data: Record<string, unknown> | (() => Record<string, unknown>) = {}, opts: SendOptions = {}): Promise<EngineUpdate | null> {
    if (transitioning) return null;
    const pending = ready();
    const g = generation, epoch = activityEpoch;
    if (!await pending || !isCurrent(g) || !trackingAllowed() || epoch !== activityEpoch) return null;
    try {
      const env = envelope(type, typeof data === 'function' ? data() : data);
      const body = JSON.stringify(env);
      if (!isCurrent(g) || !trackingAllowed() || epoch !== activityEpoch) return null;
      const target = url(cfg.paths.action), t0 = host.now();
      const res = await host.fetch(target, {
        method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), credentials: 'include', body,
        ...(opts.keepalive || opts.beacon ? { keepalive: true } : {}),
      });
      const json = (await res.json()) as { update?: { data?: EngineUpdate }; odp?: unknown; consent?: unknown } | null;
      if (!res.ok || !isCurrent(g)) return null;
      if (epoch === activityEpoch) acknowledge(json?.consent);
      else restrict(json?.consent);
      if (!trackingAllowed() || epoch !== activityEpoch) return null;
      emit('sent', env, { via: 'fetch' });
      if (!isCurrent(g) || !trackingAllowed() || epoch !== activityEpoch) return null;
      if (json?.odp) emit('receipt', json.odp, { via: 'fetch' });
      if (!isCurrent(g) || !trackingAllowed() || epoch !== activityEpoch) return null;
      const update = personalizationAllowed() ? json?.update?.data ?? null : null;
      const applied = update && receiveUpdate(update, false, host.now() - t0);
      return applied && isCurrent(g) && personalizationAllowed() ? update : null;
    } catch {
      return null;
    }
  }

  async function boundedJSON(path: string, init: import('./types').RequestInitLike, maxBytes = 2 * 1024 * 1024): Promise<{ ok: boolean; status: number; json: unknown }> {
    const controller = new AbortController(); let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const timer = host.setTimeout(() => controller.abort(), 5000);
    let abort!: () => void;
    const stopped = new Promise<never>((_, reject) => { abort = () => { void reader?.cancel().catch(() => undefined); reject(new Error('Request deadline')); }; controller.signal.addEventListener('abort', abort, { once: true }); });
    const work = (async () => {
      const response = await host.fetch(path, { ...init, signal: controller.signal });
      if (controller.signal.aborted) { void response.body?.cancel().catch(() => undefined); throw new Error('Request deadline'); }
      if (!response.body) return { ok: response.ok, status: response.status, json: await response.json() };
      reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      for (;;) {
        const part = await reader.read(); if (controller.signal.aborted) throw new Error('Request deadline');
        if (part.done) break;
        size += part.value.byteLength; if (size > maxBytes) throw new Error('Response bound'); chunks.push(part.value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return { ok: response.ok, status: response.status, json: JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)) as unknown };
    })();
    try { return await Promise.race([work, stopped]); }
    finally { host.clearTimeout(timer); controller.signal.removeEventListener('abort', abort); controller.abort(); void reader?.cancel().catch(() => undefined); }
  }

  async function sendRender(env: ActionEnvelope): Promise<RenderAcknowledgment | null> {
    const g = generation, epoch = activityEpoch;
    if (transitioning || !isCurrent(g) || !trackingAllowed() || env.type !== 'content_impression'
      || !isEventNonce(env.eventId) || !isEventTimestamp(env.timestamp) || env.userId !== visitorId || env.sessionId !== sessionId
      || typeof env.data.renderOffer !== 'string') return null;
    try {
      const body = JSON.stringify(env);
      const res = await boundedJSON(url(cfg.paths.action), { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), credentials: 'include', body });
      const json = res.json as { render?: RenderAcknowledgment; consent?: unknown } | null;
      if (!res.ok || !isCurrent(g) || epoch !== activityEpoch) return null;
      acknowledge(json?.consent);
      const ack = json?.render;
      if (!trackingAllowed() || epoch !== activityEpoch || !ack || ack.version !== 1 || ack.status !== 'durable'
        || !['pending', 'recovered'].includes(ack.source) || ack.eventId !== env.eventId || ack.decisionId !== env.data.decisionId
        || ack.pageInstance !== env.data.pageInstance) return null;
      const { renderOffer: _offer, ...data } = env.data;
      void _offer; // Public listeners never receive the admission capability.
      emit('sent', { ...env, data }, { via: 'fetch' });
      return isCurrent(g) && epoch === activityEpoch && trackingAllowed() ? { ...ack } : null;
    } catch { return null; }
  }

  async function matchesSessionWitness(witness: string): Promise<boolean> {
    const g = generation, token = capability;
    if (!cfg.sessionBroker || !isCurrent(g) || !/^[a-f0-9]{64}$/.test(witness)) return false;
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))].map(v => v.toString(16).padStart(2, '0')).join('');
    return isCurrent(g) && token === capability && digest === witness;
  }

  async function getJson(path: string, query?: Record<string, string | undefined>): Promise<unknown | null> {
    const pending = ready();
    const g = generation;
    if (!await pending || !isCurrent(g)) return null;
    try {
      if (path === cfg.paths.snapshot) {
        const c = consent();
        query = { ...query, ...(!c.tracking ? { browsingSessionId: undefined, channel: undefined, entry: undefined, trackingConsent: 'false' } : {}), ...(!c.personalization ? { personalizationEnabled: 'false' } : {}) };
      }
      const epoch = consentEpoch;
      const snapshotRequest = path === cfg.paths.snapshot;
      if (snapshotRequest && ((query?.visitorId !== undefined && query.visitorId !== visitorId)
        || (query?.userId !== undefined && query.userId !== visitorId) || (query?.sessionId !== undefined && query.sessionId !== sessionId))) return null;
      // Keep the snapshot acknowledgment/epoch protocol below, but keep context
      // and identity out of request URLs. The verified bearer owns both IDs.
      const context = snapshotRequest ? { ...query } : undefined;
      if (context) { delete context.visitorId; delete context.userId; delete context.sessionId; }
      const res = await boundedJSON(url(path, snapshotRequest ? undefined : query), snapshotRequest
        ? { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), credentials: 'include', body: JSON.stringify(context ?? {}) }
        : { method: 'GET', headers: headers(), credentials: 'include' });
      const json = res.json;
      if (!res.ok || !isCurrent(g)) return null;
      if (path === cfg.paths.snapshot) {
        if (epoch !== consentEpoch) return null;
        const snapshot = json as { ok?: unknown; arm?: string; decisions?: unknown; sources?: { consent?: unknown } } | null;
        if (snapshot?.ok === true && Array.isArray(snapshot.decisions)) {
          acknowledge(snapshot.sources?.consent);
          // A legitimate refusal acknowledgment changes the epoch itself.
          // Fence later changes, including withdrawal/re-enable on this grant,
          // across the actual mirror await without suppressing public defaults.
          const acknowledgedEpoch = consentEpoch;
          await saveRefusal();
          if (decisionRequiresConsent({ arm: snapshot.arm, decisions: snapshot.decisions })
            && (!personalizationAllowed() || acknowledgedEpoch !== consentEpoch)) return null;
        }
        else restrict(snapshot?.sources?.consent);
      }
      return isCurrent(g) ? json : null;
    } catch {
      return null;
    }
  }

  type ChoiceOperation = { id: string; expectedRevision: string | null; grantId: string; iat: number; exp: number };
  let pendingChoice: { capability: string; payload: string; operation: ChoiceOperation; at: number; acknowledged: boolean } | undefined;
  async function postJson(path: string, body: unknown): Promise<{ ok: boolean; status: number; json: unknown }> {
    const behaviorRequest = path === cfg.paths.action;
    if (behaviorRequest && (!consent().tracking || transitioning)) return { ok: false, status: 0, json: null };
    const g = generation;
    consent();
    const legacyPreferences = path === `/realtime/session/${encodeURIComponent(sessionId)}/preferences`;
    const preferenceRequest = isCurrent(g) && (path === '/realtime/session/preferences' || legacyPreferences)
      && body !== null && typeof body === 'object' && !Array.isArray(body)
      && ((body as { userId?: unknown }).userId === undefined || (body as { userId?: unknown }).userId === visitorId);
    if (/^\/realtime\/session\/(?:[^/]+\/)?preferences$/.test(path) && !preferenceRequest) return { ok: false, status: 0, json: null };
    const fields = body as { trackingConsent?: unknown; personalizationEnabled?: unknown } | null;
    const requested = preferenceRequest ? { tracking: fields?.trackingConsent, personalization: fields?.personalizationEnabled } : {};
    if (preferenceRequest) {
      path = '/realtime/session/preferences';
      body = { ...(body as Record<string, unknown>) };
      delete (body as Record<string, unknown>).userId;
    }
    const oldFalse = preferenceRequest ? { tracking: cookieFalse('tracking'), personalization: cookieFalse('personalization') } : {};
    const oldScoped = preferenceRequest ? Object.fromEntries(switches.map(key => [key, host.cookie.get(`${refusalCookie}_${key}`)])) as Record<Switch, string | null> : undefined;
    let choice: ChoiceOperation | undefined;
    if (preferenceRequest) {
      try {
        const claims = JSON.parse(atob(capability.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
        const supplied = (body as { choice?: ChoiceOperation }).choice;
        const payload = JSON.stringify(requested);
        const retry = pendingChoice?.capability === capability && pendingChoice.payload === payload
          && (supplied ? supplied.id === pendingChoice.operation.id : !pendingChoice.acknowledged);
        choice = supplied ?? (retry ? pendingChoice!.operation : { id: host.uuid(), expectedRevision: instruction?.revision ?? null,
          grantId: claims.grantId, iat: claims.iat, exp: claims.exp });
        if (!retry) pendingChoice = { capability, payload, operation: choice, at: consentNow(), acknowledged: false };
        body = { ...(body as Record<string, unknown>), choice };
      } catch { return { ok: false, status: 0, json: null }; }
      for (const key of switches) if (requested[key] === false) {
        refusalExpiry[key] = pendingChoice!.at + lifetime; mirrorRevision[key] = choice!.id; mirrorExpected[key] = oldScoped![key];
      }
      consentEpoch++; restrict(requested, true);
    }
    const epoch = consentEpoch, ownedSession = sessionId;
    const actionEpoch = activityEpoch;
    const identityRequest = path === cfg.paths.identityLink || path === cfg.paths.identityDetach;
    if (!await ready(identityRequest) || !isCurrent(g)) return { ok: false, status: 0, json: null };
    try {
      if (behaviorRequest && (!trackingAllowed() || actionEpoch !== activityEpoch)) return { ok: false, status: 0, json: null };
      const serialized = JSON.stringify(body);
      if (!isCurrent(g) || (behaviorRequest && (!trackingAllowed() || actionEpoch !== activityEpoch))) return { ok: false, status: 0, json: null };
      const res = await host.fetch(url(path), { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), credentials: 'include', body: serialized });
      let json: unknown = null;
      try { json = await res.json(); } catch { json = null; }
      if (behaviorRequest && res.ok && isCurrent(g)) restrict((json as { consent?: unknown } | null)?.consent);
      if (behaviorRequest && (!trackingAllowed() || actionEpoch !== activityEpoch)) return { ok: false, status: 0, json: null };
      if (preferenceRequest && res.ok && isCurrent(g) && ownedSession === sessionId) {
        consent();
        const ack = json as { success?: unknown; sessionId?: unknown; preferences?: { trackingConsent?: unknown; personalizationEnabled?: unknown }; consent?: { instruction?: ConsentInstruction } } | null;
        if (epoch === consentEpoch && ack?.success === true && ack.sessionId === ownedSession
          && choice && ack.consent?.instruction?.revision === choice.id && acceptInstruction(ack.consent.instruction)) {
          if (pendingChoice?.operation.id === choice.id) pendingChoice.acknowledged = true;
          const accepted = { tracking: ack.preferences?.trackingConsent, personalization: ack.preferences?.personalizationEnabled };
          let changed = false;
          for (const key of switches) {
            if (requested[key] === true && accepted[key] === true) {
              if (host.cookie.get(`${refusalCookie}_${key}`) !== oldScoped![key]) { restrict({ [key]: false }, true); continue; }
              if (cookieFalse(key) && !oldFalse[key]) { restrict({ [key]: false }, true); continue; }
              if (cookieFalse(key)) try { host.cookie.set(cookieNames[key], '', 0); } catch { /* a retained false still restricts */ }
              if (!cookieFalse(key)) {
                changed ||= active[key] === false;
                delete active[key]; delete pendingRefusal[key]; delete recovery[key];
              }
            } else if (accepted[key] === false) {
              restrict({ [key]: false });
              changed ||= pendingRefusal[key] === false;
              delete pendingRefusal[key];
            }
          }
          await saveRefusal(Object.fromEntries(switches.filter(key => requested[key] === true && accepted[key] === true).map(key => [key, oldScoped![key]])));
          const shared = readRefusal();
          for (const key of switches) if (requested[key] === true && accepted[key] === true
            && pendingRefusal[key] !== false && shared[key] !== false && !cookieFalse(key)) delete active[key];
          if (changed) consentChanged();
        }
      }
      return isCurrent(g) ? { ok: res.ok, status: res.status, json } : { ok: false, status: 0, json: null };
    } catch {
      return { ok: false, status: 0, json: null };
    }
  }

  function setVisitorId(id: string, reason: 'identified' | 'logout'): void {
    const previous = visitorId;
    if (!id) return;
    const g = beginTransition();
    if (g !== generation) return;
    rememberUnknownConsent();
    capability = ''; expiresAt = 0; sessionId = ''; anonId = '';
    if (trackingAllowed()) rotateBrowsingSession(host);
    visitorId = id;
    // This compatibility setter has no asynchronous exclusive lease. It may
    // invalidate local work, never overwrite another tab's durable authority.
    emit('identity', { visitorId: id, previous, reason });
    finishTransition(g);
    // Pushes go to the object named by the id: a socket still open under the old one hears nothing.
    if (wanted) connect();
  }

  // ── The socket ──────────────────────────────────────────────────────────────
  let socket: SocketLike | null = null;
  let status: SocketStatus = host.openSocket ? 'closed' : 'unavailable';
  let wanted = false;
  let heartbeat: unknown = null;
  let reconnectTimer: unknown = null;
  let socketGeneration = 0;

  function setStatus(s: SocketStatus): void { status = s; emit('socket', s); }

  function socketUrl(): string | null {
    if (!cfg.endpoint) return null;
    const base = cfg.endpoint.replace(/^http(s?):/, (_m, secure: string) => `ws${secure}:`);
    const q = new URLSearchParams({ tenant: cfg.tenant });
    return `${base}${cfg.paths.ws}?${q.toString()}`;
  }

  function handleFrame(raw: unknown): void {
    const g = generation;
    let msg: { type?: string; data?: Record<string, unknown>; [k: string]: unknown };
    try { msg = typeof raw === 'string' ? JSON.parse(raw) : (raw as typeof msg); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    const data = (msg.data ?? {}) as Record<string, unknown>;
    switch (msg.type) {
      case 'connected': setStatus('connected'); return;
      case 'heartbeat_response': return;
      case 'odp_receipt': emit('receipt', data, { via: 'push' }); return;
      case 'content_decisions':
        restrict((msg.sources as { consent?: unknown } | undefined)?.consent);
        if (personalizationAllowed() || !decisionRequiresConsent(msg as unknown as DecisionSet)) emit('decisions', msg as unknown as DecisionSet);
        return;
      default: break;
    }
    if (msg.type === 'audience_published' || data.audienceWentLive) emit('audience', data.audienceWentLive ?? msg.audienceWentLive ?? data);
    if (!isCurrent(g)) return;
    if (msg.type === 'personalization_update' || msg.type === 'segment_update' || data.segments) {
      const ms = typeof data.decisionMs === 'number' ? data.decisionMs : null;
      applyIncoming(data as EngineUpdate, true, ms);
    }
  }

  function stopHeartbeat(): void { if (heartbeat !== null) { host.clearInterval(heartbeat); heartbeat = null; } }

  function connect(): void {
    wanted = true;
    const g = generation, sg = ++socketGeneration;
    void ready().then(ok => {
      if (ok && wanted && isCurrent(g) && sg === socketGeneration) openSocket(g, sg);
    });
  }
  function openSocket(g: number, sg: number): void {
    if (!host.openSocket) { setStatus('unavailable'); return; }
    const target = socketUrl();
    if (!target) { setStatus('unavailable'); return; }
    if (reconnectTimer !== null) { host.clearTimeout(reconnectTimer); reconnectTimer = null; }
    setStatus('connecting');
    if (g !== generation || sg !== socketGeneration || !wanted || transitioning) return;
    try {
      const key = cfg.sdkKey ? new TextEncoder().encode(cfg.sdkKey) : undefined;
      if (key && (key.length > 512 || cfg.sdkKey?.trim() !== cfg.sdkKey)) throw new Error('Invalid site key');
      const protocol = key ? 'sdk-key-v1.' + btoa(String.fromCharCode(...key)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_') : undefined;
      socket = host.openSocket(target, ['shopper-session-v1', capability, ...(protocol ? [protocol] : [])]);
    } catch { setStatus('error'); return; }
    const s = socket;
    const current = () => sg === socketGeneration && isCurrent(g);
    s.onopen = () => {
      if (!current()) { s.close(); return; }
      setStatus('connected');
      stopHeartbeat();
      heartbeat = host.setInterval(() => {
        if (!current()) { s.close(); return; }
        if (s.readyState === 1) { try { s.send(JSON.stringify({ type: 'heartbeat' })); } catch { /* dying socket */ } }
      }, cfg.heartbeatMs);
    };
    s.onmessage = (ev) => { if (current()) handleFrame(ev.data); };
    s.onerror = () => { if (current()) setStatus('error'); };
    s.onclose = () => {
      if (!current()) return;
      stopHeartbeat();
      if (!wanted) { setStatus('closed'); return; }
      setStatus('reconnecting');
      reconnectTimer = host.setTimeout(() => { reconnectTimer = null; if (wanted) connect(); }, cfg.reconnectMs);
    };
  }

  function disconnect(): void {
    socketGeneration++;
    wanted = false;
    stopHeartbeat();
    if (reconnectTimer !== null) { host.clearTimeout(reconnectTimer); reconnectTimer = null; }
    try { socket?.close(); } catch { /* ignore */ }
    socket = null;
    setStatus('closed');
  }

  host.onStorageChange?.(anchorKey, () => {
    if (!capability || sharedCurrent()) return;
    const g = beginTransition();
    if (g !== generation) return;
    capability = ''; expiresAt = 0; visitorId = ''; sessionId = ''; anonId = '';
    transitioning = false;
    notifyConsent();
  });

  return {
    config: cfg, host, bindings, get entry() { return entryOf(); },
    get consent() { return consent(); }, get trackingAllowed() { return trackingAllowed(); }, onConsentChange, capture,
    get anonId() { return anonId; },
    get generation() { return generation; },
    ready, beginTransition, finishTransition, forgetSession, isCurrent, adoptSession,
    get visitorId() { return visitorId; },
    get sessionId() { return session(); },
    /** Read only: naming the session never rolls one over or recomputes the entry. */
    get entrySessionId() { return entrySessionId; },
    get profileSessionId() { return sessionId; },
    get socketStatus() { return status; },
    on, emit, envelope, send, bindContent, sendRender, matchesSessionWitness, url, headers, getJson, postJson, setVisitorId, connect, disconnect, applyIncoming,
  };
}
