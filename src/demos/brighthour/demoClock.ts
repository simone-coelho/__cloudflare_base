// src/demos/brighthour/demoClock.ts
// ─────────────────────────────────────────────────────────────────────────────
// demoClock — compressed demo time with REAL timestamps (brief §3 item 4).
//
// The house honesty rule: **scale the clock, never fake the stamps.** A demo
// clock is an affine map between real wall time and demo time:
//
//     demo(t) = anchorDemo + (t − anchorReal) · multiplier
//     real(d) = anchorReal + (d − anchorDemo) / multiplier
//
// Every timestamp the storefront renders, every ISO string in the decision-row
// export, is a genuine `new Date(ms).toISOString()` — it is only the *rate* of
// time that is compressed. ×360 plays a 24h offer window in 4 minutes of room
// time; a 4.5-day event in ~18 min; a 3-hour nested reveal in 30s (recon §B4).
//
// Same discipline as src/reflex/core.ts: pure functions, no I/O, no ambient
// clock read — `realNowMs` is always a parameter. Nothing here calls Date.now().
//
// Also the home of ET calendar math. QVC's whole offer grammar is pinned to
// US/Eastern — the TSV "kicks off at midnight ET" (recon §A4/§A13) and their
// on-air API pins the timezone explicitly. Catalog items therefore store
// *offsets from a demo epoch* (midnight ET of demo day zero) and the loader
// materializes real windows with materializeWindow(). The ET offset is computed
// arithmetically from the US federal DST rule rather than via Intl, so the
// module is dependency-free, identical in Node and workerd, and provably pure.
// ─────────────────────────────────────────────────────────────────────────────

export const MS_PER_SECOND = 1_000;
export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

/** An instant as the catalog stores it (ISO-8601) or as the engine computes it (epoch ms). */
export type Instant = string | number | null | undefined;

// ── Instant normalization ────────────────────────────────────────────────────

/** ISO string | epoch ms | null/undefined → epoch ms, or null when absent/unparseable. */
export function toMs(v: Instant): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

/** Epoch ms → real ISO-8601 string. The stamps are never fabricated (§B4). */
export function toIso(ms: number): string {
  if (!Number.isFinite(ms)) throw new TypeError(`toIso: expected a finite epoch ms, got ${String(ms)}`);
  return new Date(Math.round(ms)).toISOString();
}

// ── The clock ────────────────────────────────────────────────────────────────

export interface DemoClockConfig {
  /** Real wall-clock instant the demo timeline is pinned to (epoch ms). */
  anchorRealMs: number;
  /** Demo-timeline instant that `anchorRealMs` maps to (epoch ms). */
  anchorDemoMs: number;
  /** Compression factor. 1 = real time; 360 = a 24h window plays in 4 minutes. */
  multiplier: number;
}

export interface DemoClock {
  /** Demo-timeline instant for a real instant. The engine's `now`. */
  demoNow(realNowMs: number): number;
  /** Real instant a demo-timeline instant lands on — what a setTimeout/alarm needs. */
  realFor(demoMs: number): number;
  /** The tuning that produced this clock (for the ops/glass-box panel). */
  readonly config: Readonly<DemoClockConfig>;
}

/**
 * Build the affine demo clock. Pure: the returned closures read only their
 * captured config and their argument — never Date.now().
 *
 * `demoNow` and `realFor` are exact inverses (up to float representation), so
 * a lifecycle boundary computed in demo time converts back to an exact real
 * instant for the alarm that will fire it — the reflex core's nextCrossing()
 * pattern, moved onto the calendar.
 */
export function makeDemoClock(cfg: DemoClockConfig): DemoClock {
  const { anchorRealMs, anchorDemoMs, multiplier } = cfg;
  if (!Number.isFinite(anchorRealMs)) throw new TypeError('makeDemoClock: anchorRealMs must be finite');
  if (!Number.isFinite(anchorDemoMs)) throw new TypeError('makeDemoClock: anchorDemoMs must be finite');
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new TypeError(`makeDemoClock: multiplier must be a finite number > 0, got ${String(multiplier)}`);
  }
  const config = Object.freeze({ anchorRealMs, anchorDemoMs, multiplier });
  return {
    config,
    demoNow: (realNowMs: number): number => anchorDemoMs + (realNowMs - anchorRealMs) * multiplier,
    realFor: (demoMs: number): number => anchorRealMs + (demoMs - anchorDemoMs) / multiplier,
  };
}

// ── Window materialization (catalog offsets → real windows) ──────────────────

/** How the catalog stores a window: hours relative to the demo epoch. */
export interface WindowOffsets {
  /** Hours from the demo epoch to the window start. May be negative (already-running offers). */
  startOffsetHours: number;
  /** Window length in hours. 24 / 48 / 72 / 120 / 4.5d / 2h intraday (recon §A13). */
  durationHours: number;
}

export interface MaterializedWindowMs {
  startMs: number;
  endMs: number;
}

/** ISO form — exactly the shape the item schema carries (recon §B3). */
export interface MaterializedWindow {
  windowStart: string;
  windowEnd: string;
}

/** Numeric core of materializeWindow — what the engine consumes. */
export function materializeWindowMs(offsets: WindowOffsets, epochMs: number): MaterializedWindowMs {
  const { startOffsetHours, durationHours } = offsets;
  if (!Number.isFinite(epochMs)) throw new TypeError('materializeWindow: epochMs must be finite');
  if (!Number.isFinite(startOffsetHours)) throw new TypeError('materializeWindow: startOffsetHours must be finite');
  if (!Number.isFinite(durationHours) || durationHours < 0) {
    throw new TypeError(`materializeWindow: durationHours must be a finite number >= 0, got ${String(durationHours)}`);
  }
  const startMs = Math.round(epochMs + startOffsetHours * MS_PER_HOUR);
  const endMs = Math.round(startMs + durationHours * MS_PER_HOUR);
  return { startMs, endMs };
}

/**
 * Catalog offsets → the real ISO window the item carries.
 * The offer window is a first-class field on the ITEM (recon §A4) — this is the
 * one place demo-day-relative authoring becomes a genuine timestamp pair.
 */
export function materializeWindow(offsets: WindowOffsets, epochMs: number): MaterializedWindow {
  const { startMs, endMs } = materializeWindowMs(offsets, epochMs);
  return { windowStart: toIso(startMs), windowEnd: toIso(endMs) };
}

// ── US/Eastern calendar math (their clock, arithmetically) ───────────────────

const EST_OFFSET_MS = -5 * MS_PER_HOUR;
const EDT_OFFSET_MS = -4 * MS_PER_HOUR;

/** UTC ms of the `n`-th Sunday of a month, at a fixed UTC hour. */
function nthSundayUtc(year: number, monthIndex: number, n: number, utcHour: number): number {
  const first = Date.UTC(year, monthIndex, 1);
  const dow = new Date(first).getUTCDay(); // 0 = Sunday
  const day = 1 + ((7 - dow) % 7) + (n - 1) * 7;
  return Date.UTC(year, monthIndex, day, utcHour);
}

/**
 * America/New_York UTC offset at `ms` (−4h EDT / −5h EST), from the US federal
 * rule in force since 2007: DST starts the 2nd Sunday in March at 07:00 UTC and
 * ends the 1st Sunday in November at 06:00 UTC. Both transitions fall inside
 * the same UTC year, so a single year lookup is sufficient.
 */
export function etOffsetMsAt(ms: number): number {
  const year = new Date(ms).getUTCFullYear();
  const dstStart = nthSundayUtc(year, 2, 2, 7); // March, 2nd Sunday, 07:00Z
  const dstEnd = nthSundayUtc(year, 10, 1, 6); // November, 1st Sunday, 06:00Z
  return ms >= dstStart && ms < dstEnd ? EDT_OFFSET_MS : EST_OFFSET_MS;
}

/** Start of the ET calendar day containing `ms` — QVC's "midnight ET" (§A4). */
export function etMidnightAtOrBefore(ms: number): number {
  let offset = etOffsetMsAt(ms);
  // Two passes settle the DST-transition days: midnight ET is never inside the
  // 2am gap, so the offset resolved AT the candidate midnight is the right one.
  for (let i = 0; i < 2; i++) {
    const midnight = Math.floor((ms + offset) / MS_PER_DAY) * MS_PER_DAY - offset;
    const settled = etOffsetMsAt(midnight);
    if (settled === offset) return midnight;
    offset = settled;
  }
  return Math.floor((ms + offset) / MS_PER_DAY) * MS_PER_DAY - offset;
}

/** The next midnight ET strictly after `ms` — the "today" boundary for §D2 language. */
export function nextEtMidnightAfter(ms: number): number {
  // +36h always lands inside the following ET day (ET days run 23h–25h).
  return etMidnightAtOrBefore(etMidnightAtOrBefore(ms) + 36 * MS_PER_HOUR);
}

/**
 * Midnight ET of a calendar date — the demo epoch (day zero) the catalog's
 * offsets are measured from. `month` is 1-based.
 */
export function etMidnightForDate(year: number, month: number, day: number): number {
  // Noon UTC is comfortably inside the ET day for both offsets.
  return etMidnightAtOrBefore(Date.UTC(year, month - 1, day, 12));
}
