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
    /**
     * The first-decision deadline of a page view: measured from its first snapshot
     * request, never restarted by a re-ask (P34). By then every slot subscriber has
     * the decisions or the empty list (graceful absence); a later answer still paints.
     */
    hydrateTimeoutMs?: number;
    /** Storage key for the first-party visitor id. Shared with the demo storefront by default. */
    visitorIdKey?: string;
    paths?: Partial<Paths>;
    /** Same-origin first-party HttpOnly session broker; no fallback if configured. */
    sessionBroker?: string;
}
/** Server-issued explicit instruction. Boolean cookies and response hints are
 * restrictions only and cannot stand in for this authority. */
export interface ConsentInstruction {
    version: 1;
    tenant: string;
    subject: string;
    revision: string;
    tracking?: {
        value: boolean;
        chosenAt: number;
        expiresAt: number;
    };
    personalization?: {
        value: boolean;
        chosenAt: number;
        expiresAt: number;
    };
}
export interface Paths {
    identitySession: string;
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
    onmessage: ((ev: {
        data: unknown;
    }) => void) | null;
    onclose: ((ev?: unknown) => void) | null;
    onerror: ((ev?: unknown) => void) | null;
    send(data: string): void;
    close(): void;
}
export interface ElementLike {
    getAttribute(name: string): string | null;
    addEventListener(type: string, listener: (ev: unknown) => void): void;
    /**
     * The release half of `addEventListener`. Real lifecycle ownership needs it:
     * a guard that merely ignores a second bind still leaves the first listener
     * on a node whose attributes changed underneath it (F34 §3/§6). Optional
     * only because a port may be read-only; where it is absent the SDK keeps the
     * handler inert instead, and the node keeps a listener it can never fire.
     */
    removeEventListener?(type: string, listener: (ev: unknown) => void): void;
}
/** The slice of a document the declarative capture path needs. */
export interface DomLike {
    querySelectorAll(selector: string): ArrayLike<ElementLike> & Iterable<ElementLike>;
    /** Visibility callbacks: `visible` true when at least half the element is on screen. */
    observe(el: ElementLike, cb: (visible: boolean) => void): () => void;
}
export interface Host {
    now(): number;
    /** Opaque safe token (1..96 ASCII letters/digits/_/-); need not be a UUID. */
    uuid(): string;
    storage: {
        get(key: string): string | null;
        set(key: string, value: string): void;
    };
    /** Real cross-context exclusion (Web Locks in browsers); absence refuses shared identity authority. */
    acquireAuthorityLock?: (name: string) => Promise<() => void>;
    onStorageChange?: (key: string, listener: () => void) => () => void;
    cookie: {
        get(key: string): string | null;
        set(key: string, value: string, maxAgeSeconds: number): void;
    };
    location: {
        href: string;
        host: string;
        hostname: string;
        protocol: string;
        search: string;
    } | null;
    referrer: string;
    fetch: (url: string, init?: RequestInitLike) => Promise<ResponseLike>;
    sendBeacon?: (url: string, body: string) => boolean;
    openSocket?: (url: string, protocols?: string[]) => SocketLike;
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
    signal?: AbortSignal;
}
export interface ResponseLike {
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
    body?: ReadableStream<Uint8Array> | null;
}
/**
 * What the SDK lets an integrator say happened. P40: `content_viewable` is the
 * viewable impression the SDK itself measures (never the page's to send),
 * `video_view` the video watched for three seconds, `product_dwell` a product
 * page held past its dwell threshold (`productId`, `dwellMs`).
 */
export type SdkEventType = 'page_view' | 'product_view' | 'add_to_cart' | 'wishlist_add' | 'purchase' | 'content_impression' | 'content_click' | 'content_dwell' | 'video_complete' | 'content_viewable' | 'video_view' | 'product_dwell' | 'email_open' | 'form_submit' | 'button_click' | 'custom';
/**
 * `utmTerm` is the campaign's search keyword, present only when the page load
 * carries one within its bound: a keyword is a seeding signal, never evidence of
 * a channel, and an absent one is absent rather than empty so the arrival every
 * other page load sends is unchanged. `utmCampaign` is the campaign name, under
 * the same rule: present only when the landing URL carries `utm_campaign`, read
 * only by a tenant's published classification rule, never stored (P36).
 */
export interface EntrySignals {
    utmMedium: string;
    utmSource: string;
    utmTerm?: string;
    utmCampaign?: string;
    referrer: string;
    siteHost: string;
}
/** The envelope POST /realtime/action validates. Field for field what the demo storefront sends. */
export interface ActionEnvelope {
    /** Logical event identity, minted once per consent-approved envelope. */
    eventId?: string;
    type: string;
    userId: string;
    anonymousId: string;
    sessionId: string;
    /** Attribution only; never a profile locator or authority proof. */
    browsingSessionId: string;
    data: Record<string, unknown>;
    source: string;
    surface?: string;
    entry: EntrySignals;
    timestamp: number;
    /** P13: the customer's identifier the page passed (`setCustomerId`), while tracking is allowed. Carried, never proof. */
    customerId?: string;
}
/** One decision from GET /v1/:tenant/decisions/snapshot, or a `content_decisions` frame. */
export interface ContentDecision {
    /** Exact original served receipt, when tracking was allowed. Not a render acknowledgment. */
    decisionId?: string;
    /** Opaque short-lived encrypted admission, never a behavior/debug payload. */
    renderOffer?: string;
    contentId: string;
    customerContentId: string;
    type: string;
    slot: string;
    /** The page-wide order the decision is drawn at. */
    order: number;
    /**
     * The decision's position within its slot (P03 decision D3): what its record
     * calls `position`, from 0. The engine names it on every decision it answers.
     * The SDK carries it on the render acknowledgement beside the page-wide `order`
     * as `position`, and on every engagement of the placement beside the
     * acknowledged `decisionId`, without the page-wide order. The SDK keys a
     * painted receipt by slot, this position and the item (P34), the position
     * derived from the delivered list, which is this value whenever it is named.
     */
    slotPosition?: number;
    score: number;
    strategy: 'affinity' | 'default' | 'tenant-pinned';
    explain: {
        drivers: Array<{
            dim: string;
            value: string;
            a: number;
            weight: number;
        }>;
        note?: string;
    };
}
export interface DecisionSet {
    page: string;
    pageInstance?: string;
    arm?: string;
    versions?: Record<string, number>;
    config_label?: string;
    decisions: ContentDecision[];
    ts?: number;
}
export interface RenderAcknowledgment {
    version: 1;
    decisionId: string;
    eventId: string;
    pageInstance: string;
    status: 'durable';
    source: 'pending' | 'recovered';
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
    generation: (generation: number) => void;
    update: (update: EngineUpdate, meta: {
        fromPush: boolean;
        rttMs: number | null;
    }) => void;
    decisions: (set: DecisionSet) => void;
    /** An ODP receipt: from the POST response (`fetch`, the dispatch) or the socket (`push`, ODP answered). */
    receipt: (receipt: unknown, meta: {
        via: 'fetch' | 'push';
    }) => void;
    audience: (audience: unknown) => void;
    socket: (status: SocketStatus) => void;
    sent: (envelope: ActionEnvelope, meta: {
        via: 'fetch' | 'beacon' | 'socket';
    }) => void;
    /** CW25: the visitor id changed, because a person signed in (identified) or out (logout). */
    identity: (change: {
        visitorId: string;
        previous: string;
        reason: 'identified' | 'logout';
    }) => void;
}
/**
 * P12 (decision D1): the identifier-change statement a site's backend signs when
 * a shopper's account identifier changes from one form to another (the one
 * assigned at first landing, then the one derived from the e-mail address). The
 * signature is an HMAC-SHA256, base64url, keyed by the tenant's identity secret,
 * over `tenant \n account-change \n from \n to \n exp`, where `to` is the account
 * identifier passed to identify(). The SDK carries it unchanged; the two
 * accounts' profiles merge only on a statement that verifies, and only once.
 */
export interface AccountChangeStatement {
    /** The earlier account identifier, whose profile merges into the one being signed in to. */
    from: string;
    /** Unix seconds the statement expires, at most 24 h ahead. */
    exp: number;
    /** The backend's signature over both identifiers and `exp`. */
    statement: string;
}
