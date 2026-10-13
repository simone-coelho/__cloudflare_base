import type { ActionEnvelope, ClientConfig, CoreEvents, DecisionSet, DomLike, ElementLike, EngineUpdate, EntrySignals, Host, Paths, SdkEventType, SocketStatus, RenderAcknowledgment } from './types.js';
export declare const DEFAULT_PATHS: Paths;
/** Only explicit default sets (including editorial pins) and empty absence
 * are public. Unknown/exploration arms need consent even with zero scores. */
export declare function decisionRequiresConsent(set: Pick<DecisionSet, 'arm' | 'decisions'>): boolean;
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
export declare function resolveConfig(c: ClientConfig, host: Host): ResolvedConfig;
export interface SendOptions {
    /** Fire-and-forget through the beacon API, for page-hide moments. */
    beacon?: boolean;
    keepalive?: boolean;
}
export declare function contentInteraction(type: SdkEventType, data: Record<string, unknown>): SdkEventType | undefined;
/**
 * P40: the dwell minimum of a slot — the one a page configured for that slot
 * (`dwellMinMsBySlot`, a number of milliseconds from 0), else the minimum every
 * other slot keeps (`dwellMinMs`, one second unless configured). Only a number
 * is a minimum, so nothing an object inherits can stand for one.
 */
export declare function dwellMinFor(slot: string, fallback: number, bySlot?: Record<string, number>): number;
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
/**
 * P13 (H4): the decision request `listen.hydrate` hands `ready()`. When the
 * browser holds no capability of its own and no recognition proof (direct mode
 * only: a first-party broker owns the session), the bootstrap sends this request
 * with no session and adopts the session its answer issues: one call, then
 * `answered` is set and `answer` is the decision set (null when its consent
 * forbids it). Otherwise `answered` stays unset and the session is taken from
 * the session route as before, also when the answer carries no session.
 */
export interface FirstRequest {
    body: Record<string, string>;
    answered?: boolean;
    answer?: unknown;
}
export interface Core {
    readonly generation: number;
    /** Only a current explicit server choice permits collection or personalization. */
    readonly consent: {
        tracking: boolean;
        personalization: boolean;
    };
    readonly trackingAllowed: boolean;
    onConsentChange(fn: () => void): () => void;
    /** Collect only after owned readiness, dropping work crossed by withdrawal or identity change. */
    capture(fn: () => void): void;
    /** `first`: P13, the decision request a new visitor's session is issued with (listen.hydrate only). */
    ready(transition?: boolean, first?: FirstRequest): Promise<boolean>;
    /**
     * P13 (decision D1): `callback` runs once when this client has loaded (its
     * first readiness), or once at the next turn when registered after that. A
     * callback that throws changes nothing of the client.
     */
    onLoaded(callback: () => void): void;
    /**
     * P13 (decision D1): the customer's own identifier for this shopper (a hashed
     * identifier, 1 to 128 of letters, digits and `_ + / = . -`), passed before
     * recognition. While tracking is allowed every action envelope and decision
     * request carries it as `customerId`, beside the engine's own visitor
     * identifier; it is never proof of identity: it links, merges and selects
     * nothing, and a sign-in still needs identify() with the backend's signature.
     * Any other value clears it, as does a logout. True when it is carried.
     */
    setCustomerId(id: string | null | undefined): boolean;
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
    bindContent(handler: (type: SdkEventType, data: Record<string, unknown>) => Promise<EngineUpdate | null>): {
        send: Core['send'];
        release(): void;
    };
    /** Retry this exact consent-approved render envelope; success is not an engine update. */
    sendRender(envelope: ActionEnvelope): Promise<RenderAcknowledgment | null>;
    matchesSessionWitness(witness: string): Promise<boolean>;
    url(path: string, query?: Record<string, string | undefined>): string;
    headers(extra?: Record<string, string>): Record<string, string>;
    getJson(path: string, query?: Record<string, string | undefined>): Promise<unknown | null>;
    /** POST JSON with the site key and credentials; never throws. */
    postJson(path: string, body: unknown): Promise<{
        ok: boolean;
        status: number;
        json: unknown;
    }>;
    /** CW25: the browser now carries this id. Writes both stores, announces the change, reconnects the socket if it was open. */
    setVisitorId(id: string, reason: 'identified' | 'logout'): void;
    connect(): void;
    disconnect(): void;
    /** Apply an engine update from either door, once. */
    applyIncoming(update: EngineUpdate, fromPush: boolean, rttMs: number | null): void;
}
export declare function createCore(config: ClientConfig, host: Host): Core;
