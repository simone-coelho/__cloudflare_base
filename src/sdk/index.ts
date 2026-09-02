// src/sdk/index.ts
// edge-personalization: one package. `createClient` wires the shared core and
// the two modules; everything else is exported for integrators who want parts.

import { createCore, DEFAULT_PATHS, type Core } from './core';
import { createEmit, GA4_MAPPING, type Emit } from './emit';
import { createListen, type Listen, type ListenOptions } from './listen';
import { browserHost, memoryHost } from './host';
import { VERSION } from './version';
import type { ClientConfig, CoreEvents, Host } from './types';

export interface Client {
  readonly VERSION: string;
  readonly visitorId: string;
  readonly sessionId: string;
  readonly core: Core;
  readonly emit: Emit;
  readonly listen: Listen;
  /** Open the realtime channel. Optional: everything works over fetch and snapshot without it. */
  connect(): void;
  disconnect(): void;
  on<K extends keyof CoreEvents>(event: K, fn: CoreEvents[K]): () => void;
}

export function createClient(config: ClientConfig, host: Host = browserHost(), options: ListenOptions = {}): Client {
  const core = createCore(config, host);
  const listen = createListen(core, options);
  const emit = createEmit(core, listen);
  return {
    VERSION, visitorId: core.visitorId, sessionId: core.sessionId, core, emit, listen,
    connect: () => core.connect(),
    disconnect: () => core.disconnect(),
    on: (event, fn) => core.on(event, fn),
  };
}

export { VERSION, DEFAULT_PATHS, GA4_MAPPING, browserHost, memoryHost, createCore, createEmit, createListen };
export type { ClientConfig, Host, Core, Emit, Listen, CoreEvents };
export type * from './types';
