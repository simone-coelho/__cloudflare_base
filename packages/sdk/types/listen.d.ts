import { type Core } from './core.js';
import type { ContentDecision, DecisionSet, ElementLike, EngineUpdate, RenderAcknowledgment, SdkEventType } from './types.js';
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
     * acknowledged event or a socket open during the page view's first snapshot does not cancel it:
     * its answer is delivered, then exactly one refresh follows.
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
export declare function createListen(core: Core, opts?: ListenOptions): Listen;
