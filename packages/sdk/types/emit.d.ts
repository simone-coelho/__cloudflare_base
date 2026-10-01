import { type Core } from './core.js';
import type { Listen } from './listen.js';
import type { DomLike, EngineUpdate, SdkEventType } from './types.js';
export interface PurchaseInput {
    orderId: string;
    value: number;
    currency?: string;
    items?: Array<{
        productId: string;
        quantity?: number;
        price?: number;
        [k: string]: unknown;
    }>;
    [k: string]: unknown;
}
export type DataLayerMapper = (entry: Record<string, unknown>) => {
    type: SdkEventType;
    data: Record<string, unknown>;
} | null;
export type DataLayerMapping = Record<string, DataLayerMapper>;
export interface DeclarativeOptions {
    dom?: DomLike;
    dwellMinMs?: number;
}
export interface DataLayerOptions {
    layer?: unknown[];
    mapping?: DataLayerMapping;
    replay?: boolean;
}
export interface Emit {
    track(type: SdkEventType, data?: Record<string, unknown>): Promise<EngineUpdate | null>;
    pageView(data?: Record<string, unknown>): Promise<EngineUpdate | null>;
    productView(productId: string, attrs?: Record<string, unknown>): Promise<EngineUpdate | null>;
    addToCart(productId: string, attrs?: Record<string, unknown>): Promise<EngineUpdate | null>;
    wishlistAdd(productId: string, attrs?: Record<string, unknown>): Promise<EngineUpdate | null>;
    /** The conversion event. Sent with keepalive so a navigation away does not lose it. */
    purchase(input: PurchaseInput): Promise<EngineUpdate | null>;
    contentImpression(contentId: string, slot: string, attrs?: Record<string, unknown>): Promise<EngineUpdate | null>;
    contentClick(contentId: string, slot: string, attrs?: Record<string, unknown>): Promise<EngineUpdate | null>;
    contentDwell(contentId: string, slot: string, ms: number, attrs?: Record<string, unknown>): Promise<EngineUpdate | null>;
    videoComplete(contentId: string, slot: string, attrs?: Record<string, unknown>): Promise<EngineUpdate | null>;
    custom(name: string, data?: Record<string, unknown>): Promise<EngineUpdate | null>;
    /** Scan `[data-op-content]` and `[data-op-track]` elements. Returns a detach function. */
    declarative(opts?: DeclarativeOptions): () => void;
    /** Wrap a dataLayer's push. Returns a detach function that restores it. */
    dataLayer(opts?: DataLayerOptions): () => void;
    /**
     * Release every attachment this client laid on the page — its declarative
     * scans and its tag-layer capture — whether or not the page kept the detach
     * functions. What `client.destroy()` runs (src/sdk/teardown.ts).
     */
    release(): void;
    rendered: Listen['rendered'];
}
/** GA4-style events, the shape most tag layers already produce. Override per site. */
export declare const GA4_MAPPING: DataLayerMapping;
export declare function createEmit(core: Core, listen: Listen): Emit;
