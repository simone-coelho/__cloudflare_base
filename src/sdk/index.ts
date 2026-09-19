// src/sdk/index.ts
// edge-personalization: one package. `createClient` wires the shared core and
// the two modules; everything else is exported for integrators who want parts.

import { createCore, DEFAULT_PATHS, type Core } from './core';
import { createEmit, GA4_MAPPING, type Emit } from './emit';
import { createListen, type Listen, type ListenOptions } from './listen';
import { createIdentity, type Identity, type IdentifyOptions, type IdentifyResult, type LogoutResult } from './identify';
import { browserHost, memoryHost } from './host';
import { destroyClient } from './teardown';
import { VERSION } from './version';
import type { ClientConfig, CoreEvents, Host } from './types';

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

export function createClient(config: ClientConfig, host: Host = browserHost(), options: ListenOptions = {}): Client {
  const core = createCore(config, host);
  const listen = createListen(core, options);
  const emit = createEmit(core, listen);
  const identity = createIdentity(core);
  return {
    VERSION, get visitorId() { return core.visitorId; }, get sessionId() { return core.sessionId; }, core, emit, listen,
    identify: (accountId, options) => identity.identify(accountId, options),
    logout: () => identity.logout(),
    connect: () => core.connect(),
    disconnect: () => core.disconnect(),
    // Whichever order a page tears down in, nothing of the SDK is left on it:
    // the attachments, listeners and observations this client owns go back too,
    // whether or not the page kept the detach functions (W17, src/sdk/teardown.ts).
    destroy: () => destroyClient(core, listen, emit, identity),
    on: (event, fn) => core.on(event, fn),
  };
}

export { VERSION, DEFAULT_PATHS, GA4_MAPPING, browserHost, memoryHost, createCore, createEmit, createListen, createIdentity };
export type { ClientConfig, Host, Core, Emit, Listen, CoreEvents, Identity, IdentifyOptions, IdentifyResult, LogoutResult };
export type * from './types';
