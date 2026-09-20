// src/content/holdout.ts
// Doc 22 §10. The arm is a hash of an identifier and a salt: deterministic,
// sticky, and needing no storage of its own. W21 E1.01 (F07 §1.2, §7(b)) fixes
// WHICH identifier: the shopper's persistent enrollment anchor, not whatever id
// the browser is carrying at this moment. Hashing the current id made signing
// in move a shopper between arms and emptied the control population of exactly
// the people who came back.

import type { Env } from '@/types/env';
import { IdentityStore } from '@/identity/store';
import { isShopperId } from '@/identity/shopperId';
import type { TenantId } from '@/tenancy/tenant';
import type { Arm, EnrollmentProvenance, HoldoutConfig } from './types';

/** FNV-1a, 32-bit. Small, fast, and the same everywhere it is used in this repo. */
export function fnv1a(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * The finalizer murmur3 ends with: every input bit reaches every output bit. FNV-1a alone leaves ids
 * that differ only in their last character a fixed distance apart, so a customer whose visitor ids are
 * sequential (account numbers, a commerce customer list) would get a holdout that is a block sample,
 * not a random one (found 2026-09-04; 180 of 200 blocks of ten consecutive ids on one arm, 0 after).
 */
export function mix32(h: number): number {
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** A well-mixed 32-bit hash of a string: FNV-1a with the finalizer. The same everywhere a bucket is drawn. */
export const hash32 = (s: string): number => mix32(fnv1a(s));

/** A visitor's position in [0, 1), stable for a given salt. */
export function bucketOf(visitorId: string, salt: string): number {
  return hash32(`${salt}:${visitorId}`) / 4294967296;
}

/**
 * W21 E1 (F07 §5.7): the experiment an arm belongs to. The published salt is
 * part of the name, so rotating the salt starts a NEW experiment rather than
 * silently re-randomising the running one; a reader of any record can tell
 * which experiment it belongs to without consulting today's configuration.
 */
export const experimentIdFor = (tenant: string, brand: string, salt: string): string => `${tenant}:${brand}:${salt}`;

/**
 * W21 E1.03 (ruling R118(6)): the version of the SALT, which is not the version
 * of the document that carries it.
 *
 * `saltVersion` freezes a randomisation (F07 §7), so it may only move when the
 * randomisation moves. Reading it off the learn document's revision made every
 * unrelated edit — a regional threshold, a slot's gamma — mint a second
 * `saltVersion` for one running experiment, and a consumer keyed on
 * `(id, saltVersion)` would split it in two. It is therefore the number of
 * DISTINCT effective salts this tenant has published up to the pinned revision:
 * 1 for the first, unchanged by a revision that keeps the salt, and one more on
 * each rotation — which also starts a new experiment id.
 *
 * Cost: nothing at all for a tenant on its first learn revision, and otherwise
 * one bounded walk per (scope, revision) per isolate, cached. The walk reads at
 * most `SALT_HISTORY_READS` earlier revisions; a tenant with a longer history
 * than that is counted over the window it can see, which is stable for a given
 * revision and never churns, and the bound is named as owed work.
 */
const SALT_HISTORY_READS = 24;
const saltVersions = new Map<string, number>();
export function invalidateSaltVersions(): void { saltVersions.clear(); }
export async function saltVersionOf(env: Env, scope: string, revision: number, brand: string, salt: string): Promise<number> {
  if (!Number.isSafeInteger(revision) || revision <= 1) return 1;
  const key = `${scope}\u0000${revision}\u0000${salt}`;
  const cached = saltVersions.get(key);
  if (cached !== undefined) return cached;
  let version = 1, current = salt;
  try {
    const { LEARN_KIND } = await import('./kinds');
    const { publicationVersion } = await import('@/config/publication');
    for (let n = revision - 1, reads = 0; n >= 1 && reads < SALT_HISTORY_READS; n--, reads++) {
      const prior = await publicationVersion(env, LEARN_KIND, scope, n);
      if (!prior) break;
      const priorSalt = prior.value.holdout?.salt || brand;
      if (priorSalt !== current) { version++; current = priorSalt; }
    }
  } catch { /* an unreadable history is not a reason to refuse a decision; the count stands at what was read */ }
  if (saltVersions.size >= 256) saltVersions.clear();
  saltVersions.set(key, version);
  return version;
}

/**
 * W21 E1.01 (F07 §7(b)): the enrollment of a shopper, drawn ONCE against her
 * persistent enrollment anchor rather than against whatever id the browser is
 * carrying at this moment. The anchor is resolved from state that outlives the
 * browser (`enrollmentAnchorOf`, below), so the draw is the
 * same draw on every later decision and across recognition; this function is
 * pure, and given the same anchor and the same published salt it can only
 * answer the same arm.
 */
export function enrollmentFor(input: {
  tenant: string; brand: string; holdout: HoldoutConfig; saltVersion: number;
  anchor: string; anchorGeneration: number;
}): { arm: Arm; provenance: EnrollmentProvenance } {
  const salt = input.holdout.salt || input.brand;
  const arm = armFor(input.anchor, { ...input.holdout, salt });
  return {
    arm,
    provenance: {
      id: experimentIdFor(input.tenant, input.brand, salt),
      saltVersion: input.saltVersion,
      arm,
      anchorGeneration: input.anchorGeneration,
    },
  };
}

/**
 * W21 E1.02 (F07 §1.4, ruling R108): the provenance of a shopper who is NOT in
 * the experiment. She is served exactly what the control arm is served, and her
 * records say `ineligible` rather than `default`, so consent traffic is never
 * counted as a randomised control. No anchor is resolved and no bucket is
 * drawn, because she is not randomised at all; `anchorGeneration` is the only
 * generation the platform mints.
 */
export function ineligibleEnrollment(input: { tenant: string; brand: string; holdout: HoldoutConfig; saltVersion: number;
  reason: NonNullable<EnrollmentProvenance['reason']> }): EnrollmentProvenance {
  return {
    id: experimentIdFor(input.tenant, input.brand, input.holdout.salt || input.brand),
    saltVersion: input.saltVersion,
    arm: 'ineligible',
    reason: input.reason,
    anchorGeneration: 1,
  };
}

/**
 * W21 E1.01 (F07 §1.2, §2.2, §7(b)): the shopper's PERSISTENT enrollment anchor.
 *
 * The arm used to be recomputed on every request from whatever id the browser
 * was carrying at that moment, so signing in moved a shopper between arms and
 * emptied the control population of exactly the people who came back. The
 * anchor fixes that without storing a second copy of the assignment: it is the
 * identity the platform already keeps for her, and the arm is a pure function
 * of the anchor and the published salt, so it is the same arm on every later
 * decision and after recognition.
 *
 * THE PUBLISHED MERGE POLICY, applied here and stated in the kit: across an
 * identity link the enrollment recorded FIRST wins — the anchor of a recognised
 * shopper is the earliest browser linked to her, on whichever browser she
 * returns with, and her recognised id never redraws it. `anchorGeneration` is
 * the generation of that anchor; nothing replaces an anchor today, and
 * recognition explicitly does not, so it is 1.
 *
 * The record is read from the identity projection both hosts already write
 * (`identity:shopper:<id>`), so no new per-shopper state is created and the
 * existing erasure of that projection erases the anchor with it.
 */
export interface AnchorReading { anchor: string; anchorGeneration: number; unavailable?: true }
export async function enrollmentAnchorOf(env: Env, tenant: TenantId, subject: string): Promise<AnchorReading> {
  // An anonymous browser IS its own anchor: nothing is read, so nothing can be
  // unavailable. Only a recognised subject has an anchor to look up.
  if (!isShopperId(subject)) return { anchor: subject, anchorGeneration: 1 };
  let record: { visitors?: Array<{ visitorId: string; linkedAt: number }> } | null;
  // R118(3) with the build review's F4: a store that cannot answer never fails
  // her page, and R118(3) with F5: it never licenses a fresh draw either. Both
  // failures answer the same way — no anchor — and the caller serves the site's
  // own defaults as an ineligible assignment with the reason named.
  try { record = await new IdentityStore(env.SESSIONS as never, tenant).shopper(subject); }
  catch { return { anchor: subject, anchorGeneration: 1, unavailable: true }; }
  let earliest: { visitorId: string; linkedAt: number } | null = null;
  // Ties keep the earlier ROW: the registry appends members in link order, so
  // two links inside one millisecond still resolve to the one recorded first.
  for (const member of record?.visitors ?? []) {
    if (typeof member?.visitorId !== 'string' || !member.visitorId || !Number.isFinite(member.linkedAt)) continue;
    if (!earliest || member.linkedAt < earliest.linkedAt) earliest = member;
  }
  // A recognised subject whose projection is absent or expired has an anchor we
  // cannot see. Her current id is NOT a substitute for it: drawing from it is
  // exactly F07 §2.2's contamination, so the assignment is withheld instead.
  if (!earliest) return { anchor: subject, anchorGeneration: 1, unavailable: true };
  return { anchor: earliest.visitorId, anchorGeneration: 1 };
}

export function armFor(visitorId: string, h: HoldoutConfig): Arm {
  const share = Math.min(1, Math.max(0, Number.isFinite(h.share) ? h.share : 0));
  if (share <= 0) return 'personalized';
  const b = bucketOf(visitorId, h.salt);
  if (b >= share) return 'personalized';
  // Inside the holdout slice, split evenly across the configured arms.
  const arms = h.arms.length ? h.arms : (['default'] as const);
  const idx = Math.min(arms.length - 1, Math.floor((b / share) * arms.length));
  return arms[idx] ?? 'default';
}
