// src/sdk/types.ts
// The customer SDK, one package with a shared core and two modules (the decision
// recorded in the delivery guide and the BTI architecture §12). Everything the
// SDK touches in a browser arrives through `Host`, so the same code runs in
// Node under test and is a port, not a rewrite, on a native client.

export interface ClientConfig {
  /** The scope the decisions are made for. Tenancy (CW1) binds it server-side. */
  tenant: string;
  brand?: string;
  /** Base URL of the platform. Defaults to the page's own origin. */
  endpoint?: string;
  /** Sent as a header on fetches and a query on the socket. Enforced by CW10. */
  sdkKey?: string;
  /** Names the caller on every event. */
  source?: string;
  /** Optional demo surface; the engine resolves tuning by it. */
  surface?: string;
  /**
   * Listen-only: the SDK's own capture paths (automatic and declarative) stay
   * off, for a customer keeping their existing analytics pipeline. The explicit
   * API and the dataLayer adapter still send, because they are that pipeline.
   */
  listenOnly?: boolean;
  heartbeatMs?: number;
  reconnectMs?: number;
  /** How long hydrate() waits for the snapshot before declaring graceful absence. */
  hydrateTimeoutMs?: number;
  /** Storage key for the first-party visitor id. Shared with the demo storefront by default. */
  visitorIdKey?: string;
  paths?: Partial<Paths>;
}

export interface Paths {
  action: string;
  ws: string;
  reflex: string;
  /** Receives `{tenant}` substitution. */
  snapshot: string;
  /** CW25: the identity stitching routes the client half calls. */
  identityLink: string;
  identityDetach: string;
}

/** A WebSocket-shaped thing. The browser's WebSocket satisfies it; tests fake it. */
export interface SocketLike {
  readyState: number;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface ElementLike {
  getAttribute(name: string): string | null;
  addEventListener(type: string, listener: (ev: unknown) => void): void;
}

/** The slice of a document the declarative capture path needs. */
export interface DomLike {
  querySelectorAll(selector: string): ArrayLike<ElementLike> & Iterable<ElementLike>;
  /** Visibility callbacks: `visible` true when at least half the element is on screen. */
  observe(el: ElementLike, cb: (visible: boolean) => void): () => void;
}

export interface Host {
  now(): number;
  uuid(): string;
  storage: { get(key: string): string | null; set(key: string, value: string): void };
  cookie: { get(key: string): string | null; set(key: string, value: string, maxAgeSeconds: number): void };
  location: { href: string; host: string; hostname: string; protocol: string; search: string } | null;
  referrer: string;
  fetch: (url: string, init?: RequestInitLike) => Promise<ResponseLike>;
  sendBeacon?: (url: string, body: string) => boolean;
  openSocket?: (url: string) => SocketLike;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  /** Fires on page hide / unload, for the beacon path. */
  onPageHide?: (fn: () => void) => void;
  dom?: DomLike;
  /** window.dataLayer, when a tag layer exists. */
  dataLayer?: unknown[];
}

export interface RequestInitLike {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  credentials?: 'include' | 'omit' | 'same-origin';
  keepalive?: boolean;
}
export interface ResponseLike { ok: boolean; status: number; json(): Promise<unknown> }

// ── Events ──────────────────────────────────────────────────────────────────

/** What the SDK lets an integrator say happened. */
export type SdkEventType =
  | 'page_view' | 'product_view' | 'add_to_cart' | 'wishlist_add' | 'purchase'
  | 'content_impression' | 'content_click' | 'content_dwell' | 'video_complete'
  | 'email_open' | 'form_submit' | 'button_click' | 'custom';

export interface EntrySignals { utmMedium: string; utmSource: string; referrer: string; siteHost: string }

/** The envelope POST /realtime/action validates. Field for field what the demo storefront sends. */
export interface ActionEnvelope {
  type: string;
  userId: string;
  anonymousId: string;
  sessionId: string;
  data: Record<string, unknown>;
  source: string;
  surface?: string;
  entry: EntrySignals;
  timestamp: number;
}

// ── Decisions ───────────────────────────────────────────────────────────────

/** One decision from GET /v1/:tenant/decisions/snapshot, or a `content_decisions` frame. */
export interface ContentDecision {
  contentId: string;
  customerContentId: string;
  type: string;
  slot: string;
  order: number;
  score: number;
  strategy: 'affinity' | 'default' | 'tenant-pinned';
  explain: { drivers: Array<{ dim: string; value: string; a: number; weight: number }>; note?: string };
}

export interface DecisionSet {
  page: string;
  arm?: string;
  versions?: Record<string, number>;
  config_label?: string;
  decisions: ContentDecision[];
  ts?: number;
}

/** What the engine pushes after an action: the demo storefront applies this whole. */
export interface EngineUpdate {
  timestamp?: number;
  segments?: string[];
  affinity?: unknown;
  decisions?: Record<string, unknown>;
  recommendations?: unknown[];
  sortOrder?: string[];
  journeyStage?: string;
  decisionMs?: number;
  [k: string]: unknown;
}

export type SocketStatus = 'connecting' | 'connected' | 'reconnecting' | 'error' | 'closed' | 'unavailable';

export interface CoreEvents {
  update: (update: EngineUpdate, meta: { fromPush: boolean; rttMs: number | null }) => void;
  decisions: (set: DecisionSet) => void;
  /** An ODP receipt: from the POST response (`fetch`, the dispatch) or the socket (`push`, ODP answered). */
  receipt: (receipt: unknown, meta: { via: 'fetch' | 'push' }) => void;
  audience: (audience: unknown) => void;
  socket: (status: SocketStatus) => void;
  sent: (envelope: ActionEnvelope, meta: { via: 'fetch' | 'beacon' | 'socket' }) => void;
  /** CW25: the visitor id changed, because a person signed in (identified) or out (logout). */
  identity: (change: { visitorId: string; previous: string; reason: 'identified' | 'logout' }) => void;
}
