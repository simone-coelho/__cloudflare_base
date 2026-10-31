// src/units/P110/_counted.ts
// P110 (E34, amendment 13; R-P738, under R-P716: no upper wall-clock bound on a shared box; the time stays printed):
// the counted forms the gate's tests share with unit:P110.GS1-GS3, so that what the meta-legs prove is the very code
// the converted tests run.
//
//   · `virtualClock` (P102.CR4, P97.FV3, P76.FA1): `performance.now()` reads a clock that moves only when a held
//     interval of the harness ends — `hold(ms)` waits its `ms` on the real timer as before, then moves the clock to
//     at least `ms` past where it stood when the hold began. Every duration the product reports from
//     `performance.now()` (the documents stage's trips, src/config/publication.ts `since`; the owner's parts,
//     src/identity/consentContinuity.ts `ownerTimer`; the door's Server-Timing, src/routes/decisions.ts and
//     src/content/service.ts `lap`) is then the sum of the held intervals on its own path, whatever the machine's
//     load adds in CPU. Two holds begun before either ends overlap (one wave), as on the real clock; a hold begun
//     after another ended adds to it (a serial wave). A duration that counts a hold it should not, or a wave too
//     many, is off by that hold's whole length, on every run.
//   · `armedState` (W12.02's later leg, src/index.api-boundary.test.ts): a native object's state with its alarm read
//     as armed or not, every other member exact. The object re-arms its own alarm (its own deadline, a later one
//     while its scope lives), so the alarm's absolute time can move between two reads without any request.

import { vi } from 'vitest';

/** A `performance.now()` that moves only at the end of a held interval (see the header). */
export interface VirtualClock {
  /** The clock's reading, as `performance.now()` answers it while installed. */
  now(): number;
  /** Waits `ms` on the real timer, then moves the clock to at least `ms` past its reading when the hold began. */
  hold(ms: number): Promise<void>;
  /** Every hold, in the order begun: its start on the clock and its length. */
  readonly holds: Array<{ from: number; ms: number }>;
  /** Restores the real `performance.now()`. */
  restore(): void;
}

/** Installs a virtual `performance.now()` (see the header) until `restore()`. */
export function virtualClock(): VirtualClock {
  let at = 0;
  const holds: Array<{ from: number; ms: number }> = [];
  const spy = vi.spyOn(performance, 'now').mockImplementation(() => at);
  return {
    now: () => at,
    async hold(ms: number) {
      const from = at;
      holds.push({ from, ms });
      await new Promise<void>(resolve => setTimeout(resolve, ms));
      at = Math.max(at, from + ms);
    },
    holds,
    restore: () => { spy.mockRestore(); },
  };
}

/** Runs `work` with a virtual `performance.now()` installed, restoring the real one after. */
export async function onVirtualClock<T>(work: (clock: VirtualClock) => Promise<T>): Promise<T> {
  const clock = virtualClock();
  try { return await work(clock); } finally { clock.restore(); }
}

/** A native object's state as W12.02 reads it (`/__w12/state`): its entries, its alarm, its work and resets. */
export interface NativeState { entries: Array<[string, unknown]>; alarm: number | null; work: number; resets: number }

/** The state with its alarm read as armed or not; every other member exact (see the header). */
export const armedState = <S extends { alarm: number | null }>(state: S): Omit<S, 'alarm'> & { alarm: 'armed' | 'unarmed' } =>
  ({ ...state, alarm: state.alarm === null ? 'unarmed' : 'armed' });

/**
 * The waves of remote calls made from `from` that went through before `until` (an answer), as a latency lever records
 * them (`at` when made, `end` when it went through): a call made before every call of the open wave went through joins
 * that wave; otherwise it opens the next one (R-P734's form, src/units/P61/LEDGER.unit.test.ts `wavesBefore`). With a
 * fixed latency on every remote call, an answer in under N such latencies is an answer after fewer than N waves; the
 * CPU between them is not counted (the trade R-P707 ruled).
 */
export function wavesBefore(calls: ReadonlyArray<{ at: number; end?: number }>, from: number, until: number): number {
  let waves = 0, openUntil = Number.NEGATIVE_INFINITY;
  for (const call of calls.slice(from).filter(c => c.end !== undefined && c.end <= until).sort((a, b) => a.at - b.at)) {
    if (waves > 0 && call.at < openUntil) openUntil = Math.min(openUntil, call.end!);
    else { waves++; openUntil = call.end!; }
  }
  return waves;
}

