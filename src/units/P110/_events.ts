// src/units/P110/_events.ts
// P110 (E34, amendment 13; R-P738): the event wait the gate's tests share with unit:P110.GS3, plain code with no test
// framework import, so the native fixture of src/index.api-boundary.test.ts bundles it into workerd and the meta-leg
// drives the very function the fixture runs.
//
// W04.03's socket observations (src/index.api-boundary.test.ts, the native socket fixture's `waitFor`) polled every
// 10 ms under a 4 s wall-clock deadline (R-P716: no upper wall-clock bound on a shared box). The counted form waits on
// the events themselves: each observation is re-checked when the socket records a frame or a close, never against a
// clock. An observation that never comes leaves its wait pending, so the test fails on its own timeout.
//
// Inside workerd a request whose only pending work is a promise another context resolves (a socket message the
// object sends) is cancelled as hung (P110's first variant run, S58/specifier/logs/v-w0403-late-new.log: "The Workers
// runtime canceled this request because it detected that your Worker's code had hung"). `keepAliveMs` keeps a timer
// pending while the wait lasts — each tick only re-checks the predicate; it is never a deadline and decides nothing.

/** Waits that resolve on recorded events: `until(predicate)` resolves once `predicate` holds, checked now and on every `recorded()`. */
export interface EventWait {
  /** Resolves once `predicate` holds: checked now, after every recorded event, and on every keep-alive tick if one is given. */
  until(predicate: () => boolean, keepAliveMs?: number): Promise<void>;
  /** Call after recording an event (a frame, a close): every pending wait whose predicate now holds resolves. */
  recorded(): void;
  /** The waits still pending. */
  pending(): number;
}

export function eventWait(): EventWait {
  let waiting: Array<{ predicate: () => boolean; resolve: () => void }> = [];
  const recorded = () => {
    const still: typeof waiting = [];
    for (const w of waiting) { if (w.predicate()) w.resolve(); else still.push(w); }
    waiting = still;
  };
  return {
    until(predicate, keepAliveMs) {
      if (predicate()) return Promise.resolve();
      return new Promise<void>(resolve => {
        const tick = keepAliveMs === undefined ? undefined : setInterval(recorded, keepAliveMs);
        waiting.push({ predicate, resolve: () => { if (tick !== undefined) clearInterval(tick); resolve(); } });
      });
    },
    recorded,
    pending: () => waiting.length,
  };
}
