// src/units/P108/_pins.ts
// P108 (E32, R-P707): the pinned visitors and hours of the exploration
// controls, and the two seams that draw them, shared by unit:P108.XB1–XB3 and
// by the R10s of src/units/P04/LEDGER.unit.test.ts (N1/N2's CONTROL).
//
// Why. The exploration controls drew a random visitor (`vis-${crypto.randomUUID()}`,
// src/identity/sessionCapability.ts newAnonymousSession) at the wall-clock hour,
// and `explorationPick` (src/learn/explore.ts) hashes exactly those
// (`bucketOf(visitor, slot, hourKeyOf(now))`): 94 of 200,000 such draws land on
// a raw bucket of at least 0.9995 and do not explore at share 1
// (_evidence/parity-step3/S55/analyst-intermittents/DESIGN.md §4,
// logs/p04-probe-share1.log). A control that draws a pinned visitor at a pinned
// hour measures the product, never the draw.
//
// The seam (DESIGN.md §4.3 (a)): an injected subject at a fixed Date. The
// product's own mint runs unchanged; only the identifier it draws first is the
// pinned one (`drawnAs`), and the clock every call of the world reads is fixed
// at the pinned hour for the whole world, its mount included (`atPinnedHour`),
// so no retention birth lies ahead of the clock that checks it.
//
// Every subject is FOUND, never chosen by hand: the first of a fixed sequence
// of identifiers in the mint's own shape whose bucket, computed by the
// product's own `bucketOf`, satisfies the stated predicate.

import { expect, vi } from 'vitest';

import { bucketOf, contextBucketOf, hourKeyOf } from '@/learn/explore';

import { LAYOUT } from '../_parity';

/** The pinned hour: 30 October 2026, 14:01:00 UTC, one minute into the hour, so a world built at it stays inside it. */
export const PINNED_AT = Date.UTC(2026, 9, 30, 14, 1, 0);
/** A second and a third pinned hour of the corpus (XB2): the next hour and a day later. */
export const CORPUS_HOURS: readonly number[] = [PINNED_AT, PINNED_AT + 3_600_000, PINNED_AT + 24 * 3_600_000];

/** The n-th identifier of the fixed sequence, in the shape `crypto.randomUUID` answers (version 4, variant 8). */
export const uuidOf = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
/** The visitor the mint makes of a drawn identifier (src/identity/sessionCapability.ts newAnonymousSession). */
export const subjectOf = (uuid: string): string => `vis-${uuid}`;
/** The shape the session capability admits for an anonymous subject (src/identity/sessionCapability.ts valid). */
export const ANONYMOUS_SUBJECT = /^vis-[0-9a-f-]{36}$/;

export interface Pin { uuid: string; subject: string; at: number; slot: string; raw: number }

/** The search bound: a window 0.0005 wide is met on average once in 2,000 draws. */
const SEARCH_CAP = 200_000;

/** The first identifier of the fixed sequence whose raw bucket (visitor, slot, hour of `at`) satisfies `accept`. */
export function subjectWhere(slot: string, at: number, accept: (raw: number) => boolean, from = 0): Pin {
  const hour = hourKeyOf(at);
  for (let n = from; n < from + SEARCH_CAP; n++) {
    const uuid = uuidOf(n), subject = subjectOf(uuid), raw = bucketOf(subject, slot, hour);
    if (accept(raw)) return { uuid, subject, at, slot, raw };
  }
  throw new Error(`PRECONDITION: no identifier of the fixed sequence from ${from} met the predicate on ${slot} at ${new Date(at).toISOString()}`);
}

/** The first context key of a fixed sequence whose raw context bucket (P30's `contextBucketOf`) satisfies `accept`. */
export function contextWhere(slot: string, at: number, accept: (raw: number) => boolean): { context: string; raw: number } {
  const hour = hourKeyOf(at);
  for (let n = 0; n < SEARCH_CAP; n++) {
    const context = `pdp|paid_social|1|mobile|r${n}`, raw = contextBucketOf(context, slot, hour);
    if (accept(raw)) return { context, raw };
  }
  throw new Error(`PRECONDITION: no context of the fixed sequence met the predicate on ${slot}`);
}

/** The bucket `explorationPick` compares with the share today: the raw bucket rounded to three decimals (src/learn/explore.ts). */
export const roundedBucket = (raw: number): number => Math.round(raw * 1000) / 1000;
/** A boundary visitor: a raw bucket of at least 0.9995, which rounds to 1.000. */
export const isBoundary = (raw: number): boolean => raw >= 0.9995;
/** An interior visitor, far from every rounding boundary that matters at share 1. */
export const isInterior = (raw: number): boolean => raw < 0.5;

// ---------------------------------------------------------------------------
// The pinned subjects of the controls (read by unit:P108.XB3).
// ---------------------------------------------------------------------------

/** The slot P04's controls explore: the page's declared layout slot (src/units/_parity.ts LAYOUT). */
export const P04_SLOT = LAYOUT;
/**
 * P04 N1/N2's CONTROL (R10 by name, R-P707): the visitor its exploring world
 * serves, an interior one at the pinned hour, so the control's "the slot's
 * exploration ran on this decision" holds under today's rule and the fixed one
 * alike, whatever the wall clock.
 */
export const P04_CONTROL: Pin = subjectWhere(P04_SLOT, PINNED_AT, isInterior);

// ---------------------------------------------------------------------------
// The seams.
// ---------------------------------------------------------------------------

/**
 * Runs `world` with the clock fixed at `at`: `Date` and `Date.now` read `at`
 * for every call inside (vitest's fake Date; timers stay real). The whole
 * world is built inside, its mount included, so the decision's hour is the
 * pinned one and no stored birth lies ahead of the clock that reads it.
 */
export async function atPinnedHour<T>(at: number, world: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ['Date'], now: at });
  try {
    return await world();
  } finally {
    vi.useRealTimers();
  }
}

/**
 * Draws a shopper through the product's own mint with the pinned identifier:
 * the FIRST `crypto.randomUUID` the draw makes, which is the mint's visitor
 * draw (`newAnonymousSession`), answers `pin.uuid`; every later one is the real
 * function. PRECONDITION: the drawn shopper's subject is the pinned one.
 */
export async function drawnAs<S extends { subject: string }>(pin: Pick<Pin, 'uuid' | 'subject'>, draw: () => Promise<S>): Promise<S> {
  const spy = vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(pin.uuid as ReturnType<typeof crypto.randomUUID>);
  try {
    const shopper = await draw();
    expect(shopper.subject, `PRECONDITION: the shopper is drawn as the pinned visitor ${pin.subject}`).toBe(pin.subject);
    return shopper;
  } finally {
    spy.mockRestore();
  }
}
