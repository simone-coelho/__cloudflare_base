// src/units/_monotonicClock.test.ts
// Amendment A51: the deterministic test of the test-harness clock floor
// (src/units/_monotonicClock.ts), which vitest.config.ts `test.setupFiles`
// installs in every test worker. It steps the UNDERLYING clock backwards on
// purpose and shows that `Date.now` never decreases, then that fake timers,
// vi.setSystemTime and Date.now spies still work, also after they are
// restored, and that none of their values leaks into the floor.
//
// This file imports only side-effect-free exports. The only installer is the
// setup file, so the first test measures the registration itself.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installMonotonicDateNow, installedMonotonicClock, monotonicClock, type MonotonicClock } from './_monotonicClock';

const REGISTERED = 'vitest.config.ts test.setupFiles registers src/units/_monotonicClock.setup.ts';
/** 2100-01-01T00:00:00.000Z: a fake time far above any real reading. */
const FAR_FUTURE = Date.UTC(2100, 0, 1);

function installed(): MonotonicClock {
  const clock = installedMonotonicClock();
  if (!clock) throw new Error(`A51: no monotonic clock installed in this worker (${REGISTERED})`);
  return clock;
}

/** The host clock under the installed floor, as the setup file found it. */
const hostSource = installedMonotonicClock()?.source;

/**
 * Replace the clock UNDER the installed floor by a hand-stepped one for the
 * length of `body`: `set(value)` makes the underlying clock read `value`.
 */
function steppedUnderlying<T>(body: (set: (value: number) => void) => T): T {
  const clock = installed(), source = clock.source;
  let underlying = clock.floor;
  clock.source = () => underlying;
  try { return body(value => { underlying = value; }); } finally { clock.source = source; }
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  const clock = installedMonotonicClock();
  if (clock && hostSource) clock.source = hostSource;
});

describe('A51 test-harness clock: Date.now never goes backwards', () => {
  it('is installed in this worker by the vitest setup file, once, as Date.now', () => {
    const clock = installedMonotonicClock();
    expect(typeof clock?.now, REGISTERED).toBe('function');
    expect(Date.now, 'the global Date.now is the floored clock').toBe(clock!.now);
    expect(installMonotonicDateNow(), 'a second install returns the installed clock').toBe(clock);
    expect(Date.now, 'and never wraps the floor in another floor').toBe(clock!.now);
    const first = Date.now(), second = Date.now();
    expect(second).toBeGreaterThanOrEqual(first);
    expect(Math.abs(first - hostSource!()), 'it follows the host clock').toBeLessThan(1000);
  });

  it('the floor: every read returns max(floor, underlying), exact values from a scripted clock', () => {
    const script = [100, 105, 96, 104, 105, 110, 109, 1_000_000, 0, 1_000_001];
    let at = 0;
    const clock = monotonicClock(() => script[at++]!);
    const reads = script.map(() => clock.now());
    expect(reads).toEqual([100, 105, 105, 105, 105, 110, 110, 1_000_000, 1_000_000, 1_000_001]);
    expect(clock.floor).toBe(1_000_001);
  });

  it('an injected backwards step in the underlying clock never makes Date.now decrease', () => {
    Date.now(); // one real read, so the floor is a real time
    const f0 = installed().floor;
    const reads = steppedUnderlying(set => {
      const out: number[] = [];
      set(f0 + 1); out.push(Date.now());
      set(f0 + 3); out.push(Date.now());
      set(f0 + 3 - 9); out.push(Date.now()); // a 9 ms step back, as in W14.07
      set(f0 + 3 - 1000); out.push(Date.now()); // a 1000 ms step back
      set(f0 + 2); out.push(Date.now()); // the clock recovers, still below the floor
      set(f0 + 4); out.push(Date.now()); // and passes it
      let value = f0 + 4;
      for (let i = 1; i <= 20; i++) { value += i % 2 ? 10 : -5; set(value); out.push(Date.now()); } // +10 ms, then a 5 ms step back, ten times
      return out;
    });
    expect(reads.slice(0, 6)).toEqual([f0 + 1, f0 + 3, f0 + 3, f0 + 3, f0 + 3, f0 + 4]);
    // underlying: +14 +9 +19 +14 +24 +19 ...; each step back holds at the last peak
    expect(reads.slice(6)).toEqual([14, 14, 19, 19, 24, 24, 29, 29, 34, 34, 39, 39, 44, 44, 49, 49, 54, 54, 59, 59].map(d => f0 + d));
    for (let i = 1; i < reads.length; i++) expect(reads[i]!, `read ${i}`).toBeGreaterThanOrEqual(reads[i - 1]!);
    expect(Date.now, 'the floor is still the global Date.now').toBe(installed().now);
  });

  it('fake timers still work after a backwards step, fake time never enters the floor, and the floor resumes after restore', () => {
    Date.now();
    const f0 = installed().floor;
    steppedUnderlying(set => { set(f0 + 2); Date.now(); set(f0 + 2 - 50); expect(Date.now()).toBe(f0 + 2); });
    const before = Date.now();

    vi.useFakeTimers();
    vi.setSystemTime(FAR_FUTURE);
    expect(Date.now()).toBe(FAR_FUTURE);
    expect(new Date().toISOString()).toBe('2100-01-01T00:00:00.000Z');
    let fired = 0;
    setTimeout(() => { fired = Date.now(); }, 250);
    vi.advanceTimersByTime(250);
    expect(fired).toBe(FAR_FUTURE + 250);
    vi.setSystemTime(1_000); // fake time may go backwards, even below the floor
    expect(Date.now()).toBe(1_000);
    vi.useRealTimers();

    expect(Date.now, 'restored to the floored clock').toBe(installed().now);
    const after = Date.now();
    expect(after).toBeGreaterThanOrEqual(before);
    expect(after, 'the fake 2100 never entered the floor').toBeLessThan(FAR_FUTURE);
    expect(Math.abs(after - hostSource!()), 'back on the host clock').toBeLessThan(1000);
    steppedUnderlying(set => { set(after - 50); expect(Date.now(), 'still floored after the fake timers').toBe(after); });

    vi.useFakeTimers(); // and fake timers install again over the floor
    vi.setSystemTime(2_000);
    expect(Date.now()).toBe(2_000);
    vi.useRealTimers();
    expect(Date.now()).toBeGreaterThanOrEqual(after);
  });

  it('vi.spyOn(Date, "now") still works over the floor and mockRestore puts the floor back', () => {
    const before = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(42);
    expect(Date.now()).toBe(42);
    spy.mockReturnValue(FAR_FUTURE);
    expect(Date.now()).toBe(FAR_FUTURE);
    spy.mockRestore();
    expect(Date.now, 'restored to the floored clock').toBe(installed().now);
    const after = Date.now();
    expect(after).toBeGreaterThanOrEqual(before);
    expect(after, 'a mocked value never enters the floor').toBeLessThan(FAR_FUTURE);
    steppedUnderlying(set => { set(after - 9); expect(Date.now(), 'still floored after the spy').toBe(after); });
  });

  it('vi.setSystemTime without fake timers still works and vi.useRealTimers puts the floor back', () => {
    const before = Date.now();
    vi.setSystemTime(FAR_FUTURE);
    expect(Date.now()).toBe(FAR_FUTURE);
    expect(new Date().getTime()).toBe(FAR_FUTURE);
    vi.useRealTimers();
    expect(Date.now, 'restored to the floored clock').toBe(installed().now);
    const after = Date.now();
    expect(after).toBeGreaterThanOrEqual(before);
    expect(after, 'the mocked date never entered the floor').toBeLessThan(FAR_FUTURE);
  });
});
