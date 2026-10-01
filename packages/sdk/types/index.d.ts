import { createCore, DEFAULT_PATHS, type Core } from './core.js';
import { createEmit, GA4_MAPPING, type Emit } from './emit.js';
import { createListen, type Listen, type ListenOptions } from './listen.js';
import { createIdentity, type Identity, type IdentifyOptions, type IdentifyResult, type LogoutResult } from './identify.js';
import { browserHost, memoryHost } from './host.js';
import { VERSION } from './version.js';
import type { ClientConfig, CoreEvents, Host } from './types.js';
export interface Client {
    readonly VERSION: string;
    readonly visitorId: string;
    readonly sessionId: string;
    readonly core: Core;
    readonly emit: Emit;
    readonly listen: Listen;
    /** CW25: tell the edge which account this browser belongs to. On success the browser carries the person's shopper id. */
    identify(accountId: string, options?: IdentifyOptions): Promise<IdentifyResult>;
    /** CW25: detach, mint a fresh anonymous id, reconnect under it. */
    logout(): Promise<LogoutResult>;
    /** Open the realtime channel. Optional: everything works over fetch and snapshot without it. */
    connect(): void;
    disconnect(): void;
    destroy(): void;
    on<K extends keyof CoreEvents>(event: K, fn: CoreEvents[K]): () => void;
}
export declare function createClient(config: ClientConfig, host?: Host, options?: ListenOptions): Client;
export { VERSION, DEFAULT_PATHS, GA4_MAPPING, browserHost, memoryHost, createCore, createEmit, createListen, createIdentity };
export type { ClientConfig, Host, Core, Emit, Listen, CoreEvents, Identity, IdentifyOptions, IdentifyResult, LogoutResult };
export type * from './types.js';
