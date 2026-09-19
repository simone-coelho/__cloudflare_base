// src/sdk/teardown.ts
// The client teardown, in one place. `createClient().destroy()` delegates to
// it (src/sdk/index.ts), and it lives here rather than inline in `index.ts`
// because `index.ts` needs the DOM lib and is excluded from the application
// typecheck: the teardown is ordinary composition over the four modules a
// client is made of, so it is typechecked, reviewed and driven like the rest of
// the SDK, with nothing DOM-shaped of its own (document 35 §5 W17).

import type { Core } from './core';
import type { Emit } from './emit';
import type { Identity } from './identify';
import type { Listen } from './listen';

/**
 * Hand the page back everything one client holds, whether or not the page kept
 * the detach functions and in either teardown order: the decision and capture
 * state (`listen`), the attachments `emit` laid on the page — the declarative
 * scans, and the tag layer, whose own `push` comes back by identity when this
 * client held the last attachment — the realtime channel, and every listener
 * and observation the client still owns. Afterwards the page has no live
 * listener, wrapper, observer or pending callback of the SDK's, and nothing it
 * does reaches the transport (src/sdk/README.md "Binding and unbinding";
 * document 35 §2 F12/F34 §2B/§2D/§2G).
 */
export function destroyClient(core: Core, listen: Listen, emit: Emit, identity: Identity): void {
  // `identity` owns nothing of the page's: its state is the core's session and
  // generation, which the core releases below. It is named here so the teardown
  // covers every module `createClient` composes and a module cannot be added to
  // the client without deciding what its teardown is.
  void identity;
  listen.destroy();
  emit.release();
  core.disconnect();
  core.bindings.release();
}
