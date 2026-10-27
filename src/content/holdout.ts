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

// P84 (E8, N4): the pure draw lives in src/sdk/armDraw.ts, imported by nothing
// else, so the head script bundles the very function the engine runs here.
import { armFor, bucketOf, fnv1a, hash32, mix32 } from '@/sdk/armDraw';
export { armFor, bucketOf, fnv1a, hash32, mix32 };

/**
 * W21 E1 (F07 §5.7): the experiment an arm belongs to. The published salt is
 * part of the name, so rotating the salt starts a NEW experiment rather than
 * silently re-randomising the running one; a reader of any record can tell
 * which experiment it belongs to without consulting today's configuration.
 */
export const experimentIdFor = (tenant: string, brand: string, salt: string): string => `${tenant}:${brand}:${salt}`;

/**
 * W21 E1.02/E1.03 (ruling R118(1)): the experiment provenance an OUTCOME record
 * carries, resolved where the outcome is RECORDED.
 *
 * It belongs to the producer, not to the queue consumer. The producer knows her
 * consent at that moment, reads outside any namespace fence a synthetic
 * operation may have put around the queue, and cannot lose a ledger message by
 * failing: a consumer that reached the tenant's publication documents instead
 * dead-lettered the message inside such a fence and added a storage read to
 * every batch. Here the block is an annotation computed beside the record and
 * nothing more: any failure leaves the outcome unstamped and the record intact.
 */
export async function outcomeEnrollment(
  env: Env, tenant: TenantId, brand: string, visitorId: string, personalizing: boolean,
): Promise<EnrollmentProvenance | null> {
  try {
    const { LEARN_KIND } = await import('./kinds');
    const { readPublication, carriedSaltVersion } = await import('@/config/publication');
    const published = await readPublication(env, LEARN_KIND, tenant, true);
    const config = published?.value;
    if (!config?.holdout) return null;
    const holdout: HoldoutConfig = { ...config.holdout, salt: config.holdout.salt || brand };
    // W21 E1.07 (NR3, R130): carried on the head this producer already read, so
    // recording an outcome walks no history either. Used only where the salt it
    // was computed for is the salt in force; otherwise the explicit unknown.
    const annotation = carriedSaltVersion(published);
    const saltVersion = annotation && annotation.salt === holdout.salt ? annotation.version : null;
    if (!personalizing) return ineligibleEnrollment({ tenant, brand, holdout, saltVersion, reason: 'personalization_consent' });
    const anchor = await enrollmentAnchorOf(env, tenant, visitorId);
    if (anchor.unavailable) return ineligibleEnrollment({ tenant, brand, holdout, saltVersion, reason: 'anchor_unavailable' });
    return enrollmentFor({ tenant, brand, holdout, saltVersion, anchor: anchor.anchor, anchorGeneration: anchor.anchorGeneration }).provenance;
  } catch { return null; }
}

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
 * Who counts: the operator's learn publication, and only where the revision
 * before it carries no exact count (`derivedFor`, src/config/publication.ts);
 * every other publication carries the count forward from the revision before.
 * The serving path never calls this (W21 NR3): a decision, an outcome stamp and
 * a context table read the annotation the learn revision in force carries.
 *
 * P95 (E20): there is no read horizon. The count reads every earlier learn
 * revision once, oldest to newest, under one pinned publication set, so a
 * history of any length the platform still stores counts exactly. Its cost is
 * one object read per earlier revision, paid once on the operator's time.
 *
 * W21 E1.07 (NR4): a count over part of the history is never answered.
 * Counting a window made the number go DOWN across a rotation — a tenant whose
 * salt rotated at revisions 2 and 30 read `2` at revision 31 and `1` at
 * revision 60 — and gave two different salts the same count, so a consumer
 * keyed on `(id, saltVersion)` would pool two experiments that never ran
 * together. A count that cannot finish — a revision the store cannot produce,
 * purged or unreadable, a retained history that starts later — is unknown,
 * says so with `null`, and is never cached: the next healthy count is exact.
 * Only an exact count is remembered, per (scope, revision, salt) per isolate.
 */
const saltVersions = new Map<string, number>();
export function invalidateSaltVersions(): void { saltVersions.clear(); }
export async function saltVersionOf(env: Env, scope: string, revision: number, brand: string, salt: string): Promise<number | null> {
  // A first revision has nothing behind it, so nothing is unseen.
  if (!Number.isSafeInteger(revision) || revision <= 1) return 1;
  const key = `${scope}\u0000${revision}\u0000${salt}`;
  const cached = saltVersions.get(key);
  if (cached !== undefined) return cached;
  // Oldest to newest: one more at each change of the effective salt, starting
  // from the first revision's, then the salt of `revision` itself.
  let version = 0, current: string | undefined;
  try {
    const { LEARN_KIND } = await import('./kinds');
    const { pinPublication, publicationScope, publicationVersion } = await import('@/config/publication');
    // One committed set for the whole count: every earlier revision is read
    // against the same history, and none of them costs a head read of its own.
    const pinned = await pinPublication(env, publicationScope(LEARN_KIND, scope));
    for (let n = 1; n < revision; n++) {
      const prior = await publicationVersion(env, LEARN_KIND, scope, n, pinned);
      // A revision the store cannot produce leaves the count unfinished; it is
      // not evidence that the history ends, or continues, as its neighbours do.
      if (!prior) return null;
      const priorSalt = prior.value.holdout?.salt || brand;
      if (priorSalt !== current) { version++; current = priorSalt; }
    }
  } catch { return null; /* an unreadable history is not a reason to refuse a publication, and not a licence to guess a count */ }
  if (salt !== current) version++;
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
  tenant: string; brand: string; holdout: HoldoutConfig; saltVersion: number | null;
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
 * W21 E1.05 (ruling R118(3)): how often a decision could not read an enrollment
 * anchor, for the operator's work queue.
 *
 * A shopper served the site's default because her anchor could not be read is a
 * correct answer and a silent one: nothing about it is visible to the person who
 * runs the tenant unless it is counted. This is a per-tenant COUNT over a
 * bounded window and nothing else — no visitor id, no session, no arm — written
 * after the answer, never on the shopper's time, and never able to fail a
 * decision. It rides the same operator cache the slot-governance counters use,
 * so no binding and no store is added.
 */
export const ENROLLMENT_HEALTH_HORIZON_MS = 30 * 86_400_000;
export const enrollmentHealthKey = (tenant: string): string => `enrollment-health:v1:${tenant}`;
interface EnrollmentHealth { version: 1; since: number; anchorUnavailable: number }
const healthDocument = (raw: unknown, now: number): EnrollmentHealth | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as { version?: unknown; since?: unknown; anchorUnavailable?: unknown };
  if (value.version !== 1 || typeof value.since !== 'number' || !Number.isSafeInteger(value.since)
    || value.since < 0 || value.since > now || now - value.since >= ENROLLMENT_HEALTH_HORIZON_MS) return null;
  const count = value.anchorUnavailable;
  return { version: 1, since: value.since,
    anchorUnavailable: typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : 0 };
};
/** Never throws: an unreadable counter answers zero at a horizon of now. */
export async function readEnrollmentHealth(env: Pick<Env, 'CACHE'>, tenant: string, now: number): Promise<{ since: number; anchorUnavailable: number }> {
  try {
    const stored = healthDocument(await env.CACHE.get(enrollmentHealthKey(tenant), 'json'), now);
    return stored ? { since: stored.since, anchorUnavailable: stored.anchorUnavailable } : { since: now, anchorUnavailable: 0 };
  } catch { return { since: now, anchorUnavailable: 0 }; }
}
export async function recordAnchorUnavailable(env: Pick<Env, 'CACHE'>, tenant: string, now: number): Promise<void> {
  try {
    const previous = healthDocument(await env.CACHE.get(enrollmentHealthKey(tenant), 'json'), now);
    const next: EnrollmentHealth = { version: 1, since: previous?.since ?? now, anchorUnavailable: (previous?.anchorUnavailable ?? 0) + 1 };
    await env.CACHE.put(enrollmentHealthKey(tenant), JSON.stringify(next),
      { expirationTtl: Math.floor(ENROLLMENT_HEALTH_HORIZON_MS / 1000) });
  } catch { /* a diagnostic counter never fails a decision, and never retries on the shopper's time */ }
}

/**
 * W21 E1.02 (F07 §1.4, ruling R108): the provenance of a shopper who is NOT in
 * the experiment. She is served exactly what the control arm is served, and her
 * records say `ineligible` rather than `default`, so consent traffic is never
 * counted as a randomised control. No anchor is resolved and no bucket is
 * drawn, because she is not randomised at all; `anchorGeneration` is the only
 * generation the platform mints.
 */
export function ineligibleEnrollment(input: { tenant: string; brand: string; holdout: HoldoutConfig; saltVersion: number | null;
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

/**
 * P84 (E8, N4, R-P359 Q8): the arm-draw diagnostics, for the operator's work
 * queue beside the enrollment counter. A brand-new browser's page draws its
 * class before paint and the engine mints the new identifier into that class
 * (`newAnonymousSession` with a target); each time it cannot, the reason is
 * counted: `capped` (the class was not met within the cap of redraws),
 * `mismatch` (a share of 0 or 1 cannot meet the class at all), `republished`
 * (a learn publication between the holdout read at the mint and the decision's
 * own pin moved the identifier out of the class) and `ignored` (a request that
 * already carries a session named a class, which never changes its arm). A
 * per-tenant COUNT over a bounded window and nothing else — no visitor id, no
 * session, no class — written after the answer, never able to fail a decision.
 *
 * P94 (E19, R-P485, R-P503): the count is a durable increment, so draws recorded
 * together are all counted and the operator's read is exact. It is held by the
 * tenant's own object on the learn statistics binding, named
 * `arm-draw:v1:<tenant>` (never a slot's name, so it shares no slot's
 * statistics state), on that object's one storage key and under its serializer
 * (src/durable-objects/LearnStats.ts `armDraw`). The operator-cache document it
 * replaces is neither read nor written, so the count starts at zero where this
 * release first records. A call to the object that cannot be made, fails, or
 * does not answer within `ARM_DRAW_READ_BOUND_MS` is abandoned with its transport
 * aborted: a record is then lost and a read answers zeros; neither ever throws.
 */
export const ARM_DRAW_REASONS = ['capped', 'ignored', 'mismatch', 'republished'] as const;
export type ArmDrawReason = (typeof ARM_DRAW_REASONS)[number];
export type ArmDrawCounts = Record<ArmDrawReason, number>;
/** The name of the tenant's arm-draw object on the learn statistics binding. */
export const armDrawKey = (tenant: string): string => `arm-draw:v1:${tenant}`;
/** P94: how long one call to the tenant's arm-draw object (a read or a record) may take before it is answered without it. */
export const ARM_DRAW_READ_BOUND_MS = 2_000;
/** P94: what the tenant's arm-draw object holds on its one storage key. */
export interface ArmDrawDocument extends ArmDrawCounts { version: 1; since: number }
/** P94: the four counts of a value, each a non-negative safe integer or else zero, and nothing else of it. */
export function armDrawCountsOf(value: unknown): ArmDrawCounts {
  const held = (value !== null && typeof value === 'object' ? value : {}) as Partial<Record<ArmDrawReason, unknown>>;
  const count = (key: ArmDrawReason) => { const n = held[key]; return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : 0; };
  return { capped: count('capped'), ignored: count('ignored'), mismatch: count('mismatch'), republished: count('republished') };
}
/**
 * P94: the window in force at `now`, or null when there is none (nothing held,
 * a value that is not one, or thirty days or more past its `since`). Only that
 * horizon ends a window (R4): a `now` before `since` — a caller whose clock is
 * behind, a record arriving late — is counted in the window in force and never
 * restarts it, so records made together cannot reset each other's counts.
 */
export function armDrawWindow(raw: unknown, now: number): ArmDrawDocument | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (value.version !== 1 || typeof value.since !== 'number' || !Number.isSafeInteger(value.since)
    || value.since < 0 || now - value.since >= ENROLLMENT_HEALTH_HORIZON_MS) return null;
  return { version: 1, since: value.since, ...armDrawCountsOf(value) };
}
/**
 * P94: one call to the tenant's arm-draw object: the counts it answers, or null
 * when the binding is absent, the call fails or is refused, or it has not
 * answered within `ARM_DRAW_READ_BOUND_MS` — then its transport is aborted, not
 * merely raced, so nothing is left waiting on it.
 */
async function armDrawCall(env: Pick<Env, 'LEARN_STATS'>, tenant: string, path: '/arm-draw/record' | '/arm-draw/read',
  body: Record<string, unknown>): Promise<ArmDrawCounts | null> {
  const namespace = env.LEARN_STATS;
  if (!namespace) return null;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<null>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(null); }, ARM_DRAW_READ_BOUND_MS); });
  const call = (async () => {
    const response = await namespace.get(namespace.idFromName(armDrawKey(tenant))).fetch(`https://learn${path}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
    if (!response.ok) { await response.body?.cancel().catch(() => undefined); return null; }
    return armDrawCountsOf(await response.json());
  })();
  try { return await Promise.race([call, bound]); }
  catch { return null; }
  finally { clearTimeout(timer); }
}
/**
 * P94 (R-P503, R-P515): how a record made inside the shopper's owner follows
 * that owner's answer. The session runtime (src/identity/sessionAuthority.ts)
 * hands it over when it loads (`handArmDrawToOwner`); this module imports
 * nothing of that runtime, so no bundle that reaches it — the publication
 * store's included — carries the session runtime for it. Where the runtime is
 * not loaded no owner operation can be active, and a record is made directly.
 */
export interface ArmDrawOwnerHandOver {
  /** Whether a call made with `env` runs inside an active owner operation of the same deployment. */
  active(env: Pick<Env, 'LEARN_STATS'> & Partial<Pick<Env, 'SESSIONS'>>): boolean;
  /** Registers `work` to start once that operation has answered, outside it, handed the learn statistics binding. */
  after(work: (env: Pick<Env, 'LEARN_STATS'>) => Promise<unknown>): Promise<void>;
}
let armDrawOwner: ArmDrawOwnerHandOver | null = null;
/** P94: the session runtime's one registration of the owner hand-over (a later registration replaces it). */
export function handArmDrawToOwner(handOver: ArmDrawOwnerHandOver): void { armDrawOwner = handOver; }
/** Never throws: an absent, failing or slow counter answers zeros, after at most `ARM_DRAW_READ_BOUND_MS`. */
export async function readArmDraw(env: Pick<Env, 'LEARN_STATS'>, tenant: string, now: number): Promise<ArmDrawCounts> {
  return await armDrawCall(env, tenant, '/arm-draw/read', { now }) ?? armDrawCountsOf(null);
}
/**
 * Never throws, and never holds the answer it follows (R-P503). Outside the
 * shopper's owner (the first-request door) the caller hands the returned promise
 * to the platform's waitUntil after its answer. Inside the owner (a request
 * carrying a session, the carousel beacon) any work the caller hands on is work
 * the owner drains before it answers, and every binding call there is retained
 * (src/identity/sessionAuthority.ts `ownerEffect`); so there the record is
 * handed over (`ArmDrawOwnerHandOver`, the owner's `afterOwnerAnswer`) with the
 * learn statistics binding instead: it starts once the owner has answered,
 * outside the owner, and the promise returned here settles at once. An owner
 * operation that does not answer, or that refuses the hand-over, records nothing.
 */
export async function recordArmDraw(env: Pick<Env, 'LEARN_STATS'> & Partial<Pick<Env, 'SESSIONS'>>, tenant: string, reason: ArmDrawReason,
  now: number): Promise<void> {
  const body = { reason, now }, owner = armDrawOwner;
  if (owner && env.SESSIONS !== undefined) {
    try {
      if (owner.active(env)) {
        void owner.after(operator => armDrawCall(operator, tenant, '/arm-draw/record', body)).catch(() => undefined);
        return;
      }
    } catch { return; /* a hand-over that cannot be made loses the record, never the answer */ }
  }
  await armDrawCall(env, tenant, '/arm-draw/record', body);
}
