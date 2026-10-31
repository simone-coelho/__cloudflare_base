// src/units/P110/_pin.ts
// P110 (E34, amendment 13; R-P738): the pinned visitor of P10.F2's exploration CONTROL, shared with unit:P110.GS5.
// Kept apart from ./_counted.ts so that the files importing the counted forms do not load P108's pins and the harness.

import { bucketOf, hourKeyOf } from '@/learn/explore';

import { subjectOf, uuidOf } from '../P108/_pins';

/**
 * P10.F2's CONTROL (P110.GS5, R-P738): a pinned visitor in place of a random one. The first identifier of P108's fixed
 * sequence (src/units/P108/_pins.ts `uuidOf`, in the mint's shape) whose raw bucket on `slot`, computed by the product's
 * own `bucketOf`, is interior (below 0.5, far from every rounding boundary at share 1) at the hour of `at` AND at the
 * next hour, so a leg that crosses the hour keeps an interior visitor. Found, never chosen by hand.
 */
export function interiorAcrossHours(slot: string, at: number): { uuid: string; subject: string; raw: [number, number] } {
  for (let n = 0; n < 200_000; n++) {
    const uuid = uuidOf(n), subject = subjectOf(uuid);
    const raw: [number, number] = [bucketOf(subject, slot, hourKeyOf(at)), bucketOf(subject, slot, hourKeyOf(at + 3_600_000))];
    if (raw[0] < 0.5 && raw[1] < 0.5) return { uuid, subject, raw };
  }
  throw new Error(`PRECONDITION: no identifier of the fixed sequence is interior on ${slot} at ${new Date(at).toISOString()} and the next hour`);
}
