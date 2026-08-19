// @vitest-environment node
// src/demos/brighthour/demoClock.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// demoClock spec. Two things must be true, and the demo's honesty rests on both:
//   1. demoNow / realFor are exact inverses — a lifecycle boundary computed in
//      demo time converts back to the exact real instant an alarm must fire at.
//   2. Every window the catalog materializes is a REAL ISO timestamp. We scale
//      the clock; we never fake the stamps.
// The ET arithmetic is cross-validated against Intl (the tz database) rather
// than against itself — the only test of a hand-rolled DST rule worth writing.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from 'vitest';
import {
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  etMidnightAtOrBefore,
  etMidnightForDate,
  etOffsetMsAt,
  makeDemoClock,
  materializeWindow,
  materializeWindowMs,
  nextEtMidnightAfter,
  toIso,
  toMs,
} from './demoClock';

/** Demo day zero: midnight ET, 19 Aug 2026 — the day the TBO in the catalog opens. */
const EPOCH = etMidnightForDate(2026, 8, 19); // 2026-08-19T04:00:00.000Z (EDT)
const REAL_ANCHOR = Date.UTC(2026, 8, 3, 14, 0, 0); // a real presentation slot

describe('makeDemoClock (affine, pure, no ambient clock)', () => {
  it('multiplier 1 is real time', () => {
    const clock = makeDemoClock({ anchorRealMs: REAL_ANCHOR, anchorDemoMs: EPOCH, multiplier: 1 });
    expect(clock.demoNow(REAL_ANCHOR)).toBe(EPOCH);
    expect(clock.demoNow(REAL_ANCHOR + 90_000)).toBe(EPOCH + 90_000);
    expect(clock.realFor(EPOCH + 90_000)).toBe(REAL_ANCHOR + 90_000);
  });

  it('anchors map to each other exactly', () => {
    const clock = makeDemoClock({ anchorRealMs: REAL_ANCHOR, anchorDemoMs: EPOCH, multiplier: 360 });
    expect(clock.demoNow(REAL_ANCHOR)).toBe(EPOCH);
    expect(clock.realFor(EPOCH)).toBe(REAL_ANCHOR);
  });

  it('×360 plays a 24h offer window in 240 seconds of room time (§B4)', () => {
    const clock = makeDemoClock({ anchorRealMs: REAL_ANCHOR, anchorDemoMs: EPOCH, multiplier: 360 });
    const windowEnd = EPOCH + 24 * MS_PER_HOUR;
    expect(clock.realFor(windowEnd) - clock.realFor(EPOCH)).toBe(240 * 1_000);
    // …and the other direction: 4 minutes in the room is a full demo day.
    expect(clock.demoNow(REAL_ANCHOR + 4 * MS_PER_MINUTE) - EPOCH).toBe(24 * MS_PER_HOUR);
  });

  it('×360 plays a 3-hour nested reveal in 30 seconds and 4.5 days in 18 minutes', () => {
    const clock = makeDemoClock({ anchorRealMs: REAL_ANCHOR, anchorDemoMs: EPOCH, multiplier: 360 });
    const real = (demoMs: number) => clock.realFor(EPOCH + demoMs) - clock.realFor(EPOCH);
    expect(real(3 * MS_PER_HOUR)).toBe(30_000);
    expect(real(108 * MS_PER_HOUR)).toBe(18 * MS_PER_MINUTE);
    expect(real(120 * MS_PER_HOUR)).toBe(20 * MS_PER_MINUTE);
  });

  it('demoNow and realFor are inverses across multipliers (seeded property)', () => {
    // The guarantee that matters: the round trip is exact TO THE MILLISECOND,
    // which is the only resolution alarms and ISO stamps have. The raw residual
    // is bounded well below that — at epoch scale (~1.8e12 ms) a double carries
    // ~2e-4 ms of representation slack, which compression amplifies by roughly
    // the multiplier (≈0.35 ms at ×1440). Half a millisecond is exactly the
    // condition under which rounding recovers the instant, so that is the bound.
    const RESIDUAL_MS = 0.5;
    let seed = 20260819;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed / 2 ** 32);
    for (const multiplier of [1, 2.5, 60, 360, 1440]) {
      const clock = makeDemoClock({ anchorRealMs: REAL_ANCHOR, anchorDemoMs: EPOCH, multiplier });
      for (let i = 0; i < 200; i++) {
        const real = REAL_ANCHOR + Math.floor((rand() - 0.5) * 10_000_000);
        const backToReal = clock.realFor(clock.demoNow(real));
        expect(Math.round(backToReal)).toBe(real);
        expect(Math.abs(backToReal - real)).toBeLessThan(RESIDUAL_MS);

        const demo = EPOCH + Math.floor((rand() - 0.5) * 1_000_000_000);
        const backToDemo = clock.demoNow(clock.realFor(demo));
        expect(Math.round(backToDemo)).toBe(demo);
        expect(Math.abs(backToDemo - demo)).toBeLessThan(RESIDUAL_MS);
      }
    }
  });

  it('is monotonic and exposes its tuning for the ops panel', () => {
    const clock = makeDemoClock({ anchorRealMs: REAL_ANCHOR, anchorDemoMs: EPOCH, multiplier: 360 });
    expect(clock.demoNow(REAL_ANCHOR + 1)).toBeGreaterThan(clock.demoNow(REAL_ANCHOR));
    expect(clock.config).toEqual({ anchorRealMs: REAL_ANCHOR, anchorDemoMs: EPOCH, multiplier: 360 });
  });

  it('rejects a degenerate clock rather than producing nonsense time', () => {
    const base = { anchorRealMs: REAL_ANCHOR, anchorDemoMs: EPOCH };
    expect(() => makeDemoClock({ ...base, multiplier: 0 })).toThrow(TypeError);
    expect(() => makeDemoClock({ ...base, multiplier: -360 })).toThrow(TypeError);
    expect(() => makeDemoClock({ ...base, multiplier: NaN })).toThrow(TypeError);
    expect(() => makeDemoClock({ ...base, multiplier: Infinity })).toThrow(TypeError);
    expect(() => makeDemoClock({ anchorRealMs: NaN, anchorDemoMs: EPOCH, multiplier: 1 })).toThrow(TypeError);
  });
});

describe('instant normalization', () => {
  it('accepts ISO strings and epoch ms, and reports absence as null', () => {
    expect(toMs('2026-08-19T04:00:00.000Z')).toBe(EPOCH);
    expect(toMs(EPOCH)).toBe(EPOCH);
    expect(toMs(null)).toBeNull();
    expect(toMs(undefined)).toBeNull();
    expect(toMs('not a date')).toBeNull();
    expect(toMs(NaN)).toBeNull();
  });

  it('toIso round-trips and refuses non-finite input', () => {
    expect(toIso(EPOCH)).toBe('2026-08-19T04:00:00.000Z');
    expect(toMs(toIso(EPOCH + 12_345))).toBe(EPOCH + 12_345);
    expect(() => toIso(NaN)).toThrow(TypeError);
  });
});

describe('materializeWindow (catalog offsets → real ISO windows)', () => {
  it('materializes the 24h TBO from demo day zero', () => {
    expect(materializeWindow({ startOffsetHours: 0, durationHours: 24 }, EPOCH)).toEqual({
      windowStart: '2026-08-19T04:00:00.000Z',
      windowEnd: '2026-08-20T04:00:00.000Z',
    });
  });

  it('materializes BH2 on its offset 9pm ET clock (§A13)', () => {
    expect(materializeWindow({ startOffsetHours: 21, durationHours: 24 }, EPOCH)).toEqual({
      windowStart: '2026-08-20T01:00:00.000Z',
      windowEnd: '2026-08-21T01:00:00.000Z',
    });
  });

  it('handles negative offsets — an offer already running when the demo opens', () => {
    expect(materializeWindow({ startOffsetHours: -24, durationHours: 24 }, EPOCH)).toEqual({
      windowStart: '2026-08-18T04:00:00.000Z',
      windowEnd: '2026-08-19T04:00:00.000Z',
    });
    expect(materializeWindow({ startOffsetHours: -6.5, durationHours: 12 }, EPOCH)).toEqual({
      windowStart: '2026-08-18T21:30:00.000Z',
      windowEnd: '2026-08-19T09:30:00.000Z',
    });
  });

  it('covers the whole window grammar: 2h intraday · 4.5 days · 120h · 49h (§A13)', () => {
    const hours = (o: { startOffsetHours: number; durationHours: number }) => {
      const { startMs, endMs } = materializeWindowMs(o, EPOCH);
      return (endMs - startMs) / MS_PER_HOUR;
    };
    expect(hours({ startOffsetHours: 12, durationHours: 2 })).toBe(2); // Lunch Hour Steals
    expect(hours({ startOffsetHours: 0, durationHours: 108 })).toBe(108); // Harvest Kitchen, 4.5d
    expect(hours({ startOffsetHours: 0, durationHours: 120 })).toBe(120); // the tentpole
    expect(hours({ startOffsetHours: 0, durationHours: 49 })).toBe(49); // Nonstop Holiday Party
  });

  it('agrees with its numeric core and refuses malformed offsets', () => {
    const offsets = { startOffsetHours: 3.25, durationHours: 4.5 };
    const iso = materializeWindow(offsets, EPOCH);
    const ms = materializeWindowMs(offsets, EPOCH);
    expect(toMs(iso.windowStart)).toBe(ms.startMs);
    expect(toMs(iso.windowEnd)).toBe(ms.endMs);

    expect(() => materializeWindow({ startOffsetHours: 0, durationHours: -1 }, EPOCH)).toThrow(TypeError);
    expect(() => materializeWindow({ startOffsetHours: NaN, durationHours: 1 }, EPOCH)).toThrow(TypeError);
    expect(() => materializeWindow({ startOffsetHours: 0, durationHours: 1 }, NaN)).toThrow(TypeError);
  });
});

describe('US/Eastern calendar math (their clock — §A4 midnight ET)', () => {
  /** The offset the tz database reports, derived from formatted wall-clock parts. */
  function intlEtOffsetMs(ms: number): number {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(ms));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const hour = get('hour') === 24 ? 0 : get('hour');
    const wall = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
    return wall - Math.floor(ms / 1000) * 1000;
  }

  it('matches the tz database every 6 hours for two full years', () => {
    let mismatches = 0;
    for (let ms = Date.UTC(2026, 0, 1); ms < Date.UTC(2028, 0, 1); ms += 6 * MS_PER_HOUR) {
      if (etOffsetMsAt(ms) !== intlEtOffsetMs(ms)) mismatches++;
    }
    expect(mismatches).toBe(0);
  });

  it('flips exactly at the 2026 transitions', () => {
    const springForward = Date.UTC(2026, 2, 8, 7); // 2nd Sunday in March, 07:00Z
    const fallBack = Date.UTC(2026, 10, 1, 6); // 1st Sunday in November, 06:00Z
    expect(etOffsetMsAt(springForward - 1)).toBe(-5 * MS_PER_HOUR);
    expect(etOffsetMsAt(springForward)).toBe(-4 * MS_PER_HOUR);
    expect(etOffsetMsAt(fallBack - 1)).toBe(-4 * MS_PER_HOUR);
    expect(etOffsetMsAt(fallBack)).toBe(-5 * MS_PER_HOUR);
  });

  it('etMidnightForDate lands on real midnight ET in both offsets', () => {
    expect(toIso(etMidnightForDate(2026, 8, 19))).toBe('2026-08-19T04:00:00.000Z'); // EDT
    expect(toIso(etMidnightForDate(2026, 1, 15))).toBe('2026-01-15T05:00:00.000Z'); // EST
    expect(toIso(etMidnightForDate(2026, 3, 8))).toBe('2026-03-08T05:00:00.000Z'); // spring-forward day
    expect(toIso(etMidnightForDate(2026, 11, 1))).toBe('2026-11-01T04:00:00.000Z'); // fall-back day
  });

  it('etMidnightAtOrBefore is idempotent and never in the future', () => {
    for (let ms = Date.UTC(2026, 2, 1); ms < Date.UTC(2026, 2, 15); ms += 37 * MS_PER_MINUTE) {
      const midnight = etMidnightAtOrBefore(ms);
      expect(midnight).toBeLessThanOrEqual(ms);
      expect(etMidnightAtOrBefore(midnight)).toBe(midnight);
      expect(ms - midnight).toBeLessThan(26 * MS_PER_HOUR);
    }
  });

  it('ET days run 23h / 24h / 25h — the reason a 49-hour event exists (§A13)', () => {
    const dayLength = (ms: number) => nextEtMidnightAfter(ms) - etMidnightAtOrBefore(ms);
    expect(dayLength(Date.UTC(2026, 7, 19, 12))).toBe(24 * MS_PER_HOUR);
    expect(dayLength(Date.UTC(2026, 2, 8, 12))).toBe(23 * MS_PER_HOUR); // spring forward
    expect(dayLength(Date.UTC(2026, 10, 1, 12))).toBe(25 * MS_PER_HOUR); // fall back
  });

  it('nextEtMidnightAfter is strictly after, including at midnight itself', () => {
    const midnight = etMidnightForDate(2026, 8, 19);
    expect(nextEtMidnightAfter(midnight)).toBe(midnight + MS_PER_DAY);
    expect(nextEtMidnightAfter(midnight + 23 * MS_PER_HOUR)).toBe(midnight + MS_PER_DAY);
    expect(nextEtMidnightAfter(midnight - 1)).toBe(midnight);
  });
});
