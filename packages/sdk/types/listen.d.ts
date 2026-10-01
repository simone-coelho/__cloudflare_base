import { type Core } from './core.js';
import type { ContentDecision, DecisionSet, ElementLike, EngineUpdate, RenderAcknowledgment, SdkEventType } from './types.js';
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
export declare function createListen(core: Core, opts?: ListenOptions): Listen;
