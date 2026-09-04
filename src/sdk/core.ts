// src/sdk/core.ts
// The shared core: identity, the event bus, and transport. Non-negotiable as a
// shared piece because events and decisions must be keyed to the same visitor
// id and one socket serves both directions. Extracted from the demo storefront:
// the socket URL, the welcome frame, the reconnect delay, the action envelope
// and the POST-versus-push dedupe are its behavior, verbatim.

import { DEFAULT_VISITOR_KEY, entrySignals, mintAnonId, mintSessionId, mintVisitorId, writeVisitorId } from './identity';
import { toWire } from './wire';
import type {
  ActionEnvelope, ClientConfig, CoreEvents, DecisionSet, EngineUpdate, EntrySignals, Host, Paths,
  SdkEventType, SocketLike, SocketStatus,
} from './types';

export const DEFAULT_PATHS: Paths = {
  action: '/realtime/action',
  ws: '/realtime/ws',
  reflex: '/realtime/reflex',
  snapshot: '/v1/{tenant}/decisions/snapshot',
  identityLink: '/v1/{tenant}/identity/link',
  identityDetach: '/v1/{tenant}/identity/detach',
};

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
}

export function resolveConfig(c: ClientConfig, host: Host): ResolvedConfig {
  const origin = host.location ? `${host.location.protocol}//${host.location.host}` : '';
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
  };
}

export interface SendOptions {
  /** Fire-and-forget through the beacon API, for page-hide moments. */
  beacon?: boolean;
  keepalive?: boolean;
}

export interface Core {
  readonly config: ResolvedConfig;
  readonly host: Host;
  readonly visitorId: string;
  readonly anonId: string;
  readonly sessionId: string;
  readonly entry: EntrySignals;
  readonly socketStatus: SocketStatus;
  on<K extends keyof CoreEvents>(event: K, fn: CoreEvents[K]): () => void;
  emit<K extends keyof CoreEvents>(event: K, ...args: Parameters<CoreEvents[K]>): void;
  /** The envelope POST /realtime/action validates, for this event. Pure. */
  envelope(type: SdkEventType, data?: Record<string, unknown>): ActionEnvelope;
  send(type: SdkEventType, data?: Record<string, unknown>, opts?: SendOptions): Promise<EngineUpdate | null>;
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
  let visitorId = mintVisitorId(host, cfg.visitorIdKey);
  const anonId = mintAnonId(host);
  const sessionId = mintSessionId(host);
  const entry = entrySignals(host);

  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  function on<K extends keyof CoreEvents>(event: K, fn: CoreEvents[K]): () => void {
    const set = listeners.get(event) ?? new Set();
    set.add(fn as (...args: unknown[]) => void);
    listeners.set(event, set);
    return () => { set.delete(fn as (...args: unknown[]) => void); };
  }
  function emit<K extends keyof CoreEvents>(event: K, ...args: Parameters<CoreEvents[K]>): void {
    for (const fn of listeners.get(event) ?? []) { try { fn(...args); } catch { /* a listener must never break the page */ } }
  }

  // A shopper's own action returns the update in the POST response AND echoes
  // it over the socket. Apply once: both carry the same server timestamp.
  let lastAppliedTs: number | undefined;
  function applyIncoming(update: EngineUpdate, fromPush: boolean, rttMs: number | null): void {
    if (typeof update.timestamp === 'number') {
      if (fromPush && update.timestamp === lastAppliedTs) return;
      lastAppliedTs = update.timestamp;
    }
    emit('update', update, { fromPush, rttMs });
  }

  function url(path: string, query?: Record<string, string | undefined>): string {
    const base = `${cfg.endpoint}${path.replace('{tenant}', encodeURIComponent(cfg.tenant))}`;
    const parts = Object.entries(query ?? {}).filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    return parts.length ? `${base}?${parts.join('&')}` : base;
  }
  function headers(extra: Record<string, string> = {}): Record<string, string> {
    return { ...(cfg.sdkKey ? { 'X-SDK-Key': cfg.sdkKey } : {}), ...extra };
  }

  function envelope(type: SdkEventType, data: Record<string, unknown> = {}): ActionEnvelope {
    const w = toWire(type, data);
    return {
      type: w.type,
      userId: visitorId,
      anonymousId: anonId,
      sessionId,
      data: w.data,
      source: cfg.source,
      ...(cfg.surface ? { surface: cfg.surface } : {}),
      entry,
      timestamp: host.now(),
    };
  }

  async function send(type: SdkEventType, data: Record<string, unknown> = {}, opts: SendOptions = {}): Promise<EngineUpdate | null> {
    const env = envelope(type, data);
    const body = JSON.stringify(env);
    const target = url(cfg.paths.action);
    if (opts.beacon && host.sendBeacon) {
      let ok = false;
      try { ok = host.sendBeacon(target, body); } catch { ok = false; }
      if (ok) { emit('sent', env, { via: 'beacon' }); return null; }
    }
    const t0 = host.now();
    try {
      const res = await host.fetch(target, {
        method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), credentials: 'include', body,
        ...(opts.keepalive ? { keepalive: true } : {}),
      });
      const json = (await res.json()) as { update?: { data?: EngineUpdate }; odp?: unknown } | null;
      emit('sent', env, { via: 'fetch' });
      if (json?.odp) emit('receipt', json.odp);
      const update = json?.update?.data ?? null;
      if (update) applyIncoming(update, false, host.now() - t0);
      return update;
    } catch {
      return null;
    }
  }

  async function getJson(path: string, query?: Record<string, string | undefined>): Promise<unknown | null> {
    try {
      const res = await host.fetch(url(path, query), { method: 'GET', headers: headers(), credentials: 'include' });
      return await res.json();
    } catch {
      return null;
    }
  }

  async function postJson(path: string, body: unknown): Promise<{ ok: boolean; status: number; json: unknown }> {
    try {
      const res = await host.fetch(url(path), { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), credentials: 'include', body: JSON.stringify(body) });
      let json: unknown = null;
      try { json = await res.json(); } catch { json = null; }
      return { ok: res.ok, status: res.status, json };
    } catch {
      return { ok: false, status: 0, json: null };
    }
  }

  function setVisitorId(id: string, reason: 'identified' | 'logout'): void {
    const previous = visitorId;
    if (!id || id === previous) return;
    visitorId = id;
    writeVisitorId(host, cfg.visitorIdKey, id);
    emit('identity', { visitorId: id, previous, reason });
    // Pushes go to the object named by the id: a socket still open under the old one hears nothing.
    if (wanted) { disconnect(); connect(); }
  }

  // ── The socket ──────────────────────────────────────────────────────────────
  let socket: SocketLike | null = null;
  let status: SocketStatus = host.openSocket ? 'closed' : 'unavailable';
  let wanted = false;
  let heartbeat: unknown = null;
  let reconnectTimer: unknown = null;

  function setStatus(s: SocketStatus): void { status = s; emit('socket', s); }

  function socketUrl(): string | null {
    if (!cfg.endpoint) return null;
    const base = cfg.endpoint.replace(/^http(s?):/, (_m, secure: string) => `ws${secure}:`);
    const q = new URLSearchParams({ userId: visitorId, ...(cfg.sdkKey ? { sdkKey: cfg.sdkKey } : {}) });
    return `${base}${cfg.paths.ws}?${q.toString()}`;
  }

  function handleFrame(raw: unknown): void {
    let msg: { type?: string; data?: Record<string, unknown>; [k: string]: unknown };
    try { msg = typeof raw === 'string' ? JSON.parse(raw) : (raw as typeof msg); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    const data = (msg.data ?? {}) as Record<string, unknown>;
    switch (msg.type) {
      case 'connected': setStatus('connected'); return;
      case 'heartbeat_response': return;
      case 'odp_receipt': emit('receipt', data); return;
      case 'content_decisions': emit('decisions', msg as unknown as DecisionSet); return;
      default: break;
    }
    if (msg.type === 'audience_published' || data.audienceWentLive) emit('audience', data.audienceWentLive ?? msg.audienceWentLive ?? data);
    if (msg.type === 'personalization_update' || msg.type === 'segment_update' || data.segments) {
      const ms = typeof data.decisionMs === 'number' ? data.decisionMs : null;
      applyIncoming(data as EngineUpdate, true, ms);
    }
  }

  function stopHeartbeat(): void { if (heartbeat !== null) { host.clearInterval(heartbeat); heartbeat = null; } }

  function connect(): void {
    wanted = true;
    if (!host.openSocket) { setStatus('unavailable'); return; }
    const target = socketUrl();
    if (!target) { setStatus('unavailable'); return; }
    if (reconnectTimer !== null) { host.clearTimeout(reconnectTimer); reconnectTimer = null; }
    setStatus('connecting');
    try { socket = host.openSocket(target); } catch { setStatus('error'); return; }
    const s = socket;
    s.onopen = () => {
      setStatus('connected');
      stopHeartbeat();
      heartbeat = host.setInterval(() => {
        if (s.readyState === 1) { try { s.send(JSON.stringify({ type: 'heartbeat' })); } catch { /* dying socket */ } }
      }, cfg.heartbeatMs);
    };
    s.onmessage = (ev) => handleFrame(ev.data);
    s.onerror = () => setStatus('error');
    s.onclose = () => {
      stopHeartbeat();
      if (!wanted) { setStatus('closed'); return; }
      setStatus('reconnecting');
      reconnectTimer = host.setTimeout(() => { reconnectTimer = null; if (wanted) connect(); }, cfg.reconnectMs);
    };
  }

  function disconnect(): void {
    wanted = false;
    stopHeartbeat();
    if (reconnectTimer !== null) { host.clearTimeout(reconnectTimer); reconnectTimer = null; }
    try { socket?.close(); } catch { /* ignore */ }
    socket = null;
    setStatus('closed');
  }

  return {
    config: cfg, host, anonId, sessionId, entry,
    get visitorId() { return visitorId; },
    get socketStatus() { return status; },
    on, emit, envelope, send, url, headers, getJson, postJson, setVisitorId, connect, disconnect, applyIncoming,
  };
}
