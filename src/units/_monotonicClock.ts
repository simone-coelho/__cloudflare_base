// src/units/_monotonicClock.ts
// Amendment A51 (owner-approved 2026-09-29): a test clock that never goes
// backwards. Test harness only; no product file, assertion or threshold
// changes.
//
// `./_monotonicClock.setup.ts` is registered in vitest.config.ts
// `test.setupFiles`, so every test worker installs this floor before any test
// file is imported: the worker's `Date.now` returns
//     floor = max(floor, underlying clock)
// on every read, so it never decreases.
//
// Why. The wall clock of the WSL2 host that runs the gates steps by about
// ±3–55 ms every ~30 s. A backwards step landing between a record's retention
// birth and its check trips the exact `value.bornAt > now` guard
// (src/retention.ts:98) and turns a passing test into a 503 or an untyped 500:
// W14.07 (src/routes/content.test.ts:1624) and very probably W14.02
// (src/routes/sort.test.ts:478). See
// /home/simonecoelho/rem/_evidence/flake-triage-503/REPORT.md.
//
// What keeps working:
//   - Fake timers. `vi.useFakeTimers()` swaps the global `Date` for a fake
//     whose `now` is the fake clock (vi.setSystemTime moves it freely, also
//     backwards and below the floor); the floor is neither read nor updated
//     while time is fake. `vi.useRealTimers()` puts back this same `Date`
//     object, whose `now` is still the floor. `vi.setSystemTime()` without
//     fake timers (vitest's mock Date) restores the same object too.
//   - `vi.spyOn(Date, 'now')`. The spy wraps the floored function and
//     `mockRestore()` puts it back. A mocked value never enters the floor.
//
// Choices and limits:
//   - `new Date()` with no argument is NOT floored; it still reads the host
//     clock. The constructor's clock read cannot be patched in place: it needs
//     a replacement global `Date` (subclass or Proxy). That is not safe here:
//     vitest 1.6.1's mock Date restores the `Date` it captured at load, before
//     any setup file (node_modules/vitest/dist/vendor/date.Ns1pGd_X.js:1,:48),
//     so the replacement would silently drop out of a worker after
//     `vi.setSystemTime()` + `vi.useRealTimers()`; and it breaks
//     `value.constructor === Date` for dates from fake timers and
//     structuredClone. The product's four no-argument `new Date()` reads
//     (src/content/enrichment.ts:163, :236; src/routes/decisions.ts:1339;
//     src/routes/geo.ts:25) stamp a creation or review time, pick a default
//     report day and a season month; none is an ordering check like
//     src/retention.ts:98.
//   - Code running inside workerd (src/units/_native.ts,
//     src/index.api-boundary.test.ts) has its own runtime and its own `Date`;
//     it is not covered.
//   - Product code is not changed. src/retention.ts:98 stays exact, so a real
//     backwards step, or clock skew between hosts, can still make production
//     answer 503: a residual for live acceptance.
//   - Each worker has its own floor; nothing is shared between workers.

/** Where the installed clock is kept on `globalThis`, once per worker. */
export const MONOTONIC_CLOCK_KEY = Symbol.for('cfbase.test.monotonicDateNow');

export interface MonotonicClock {
  /** The clock under the floor: the worker's own `Date.now` as found at install. */
  source: () => number;
  /** The highest value `source` has shown; what `now` returns while `source` is below it. */
  floor: number;
  /** The function installed as `Date.now`. */
  readonly now: () => number;
}

/** A clock that reads `source` and never returns less than it returned before. */
export function monotonicClock(source: () => number): MonotonicClock {
  const clock: MonotonicClock = { source, floor: Number.NEGATIVE_INFINITY, now };
  function now(): number {
    const reading = clock.source();
    if (reading > clock.floor) clock.floor = reading;
    return clock.floor;
  }
  return clock;
}

type Host = Record<symbol, MonotonicClock | undefined>;

/** The clock installed in this worker, or `undefined` when none was installed. */
export function installedMonotonicClock(): MonotonicClock | undefined {
  return (globalThis as unknown as Host)[MONOTONIC_CLOCK_KEY];
}

/**
 * Install the floor as this worker's `Date.now`. Idempotent: a second call
 * returns the clock already installed and never wraps the floor in a floor.
 */
export function installMonotonicDateNow(): MonotonicClock {
  const installed = installedMonotonicClock();
  if (installed) return installed;
  const clock = monotonicClock(Date.now.bind(Date));
  Date.now = clock.now;
  (globalThis as unknown as Host)[MONOTONIC_CLOCK_KEY] = clock;
  return clock;
}
