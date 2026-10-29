// src/learn/fan.ts
// The three fan-ins the learning loop needs, with explicit incomplete receipts
// and none of them able to throw: served decisions into the visitor's ring,
// exposures into the slot's statistics object, and an outcome into the ring,
// which attributes it and forwards the credits itself.

import type { Env } from '@/types/env';
import type { LiftSnapshot, NotAdopted, NotAdoptedChange, Republished, RepublishedChange, StaleMarker } from './stats';

/**
 * P62 (amendment 6, R-P110 decision 1), P72 (amendment 10, R-P236): the lift
 * witness's budget, sized for the edge. It is the round trip to the statistics
 * object and nothing else (W38 B7, below): one edge round trip to a warm
 * statistics object, measured on the platform at a largest 478 ms inside a
 * warm tail, with the owner's buffer: 600 ms. It bounds the wait, not the read:
 * a read inside it answers as soon as it is done. A deployment may set another
 * through `LIFT_WITNESS_BUDGET_MS` (`learningReadBudgets`).
 */
export const LIFT_WITNESS_BUDGET_MS = 600;
/**
 * P62 (R-P110 decision 1), P72: the visitor ring read's budget, the same shape
 * (one hop to the visitor's `DecisionRing`, whose own bounded read is far below
 * the statistics object's) and the same default: 600 ms. A deployment may set
 * another through `RING_READ_BUDGET_MS`.
 */
export const RING_READ_BUDGET_MS = 600;
/**
 * P62 (R-P110 decision 2, R-P112(6)): how long after its PUBLICATION a copy that
 * is no longer the statistics object's latest is still served, when the object
 * recognises it (its version and digest among its recent publications) under the
 * same witness, healthy. At least an isolate's hold of a copy (`LIFT_TTL_MS`,
 * 60 s) plus the store's largest observed propagation (55.8 s); ten minutes, the
 * analysis's own bound, so a copy published shortly before a quiet spell ends
 * is still recognised after the next publication supersedes it.
 */
export const LIFT_RECENT_WINDOW_MS = 600_000;
/** P62: at most this many recent publications are kept by one statistics object, however many it makes inside the window. */
export const LIFT_RECENT_PUBLICATIONS = 32;
/**
 * P62: an override is admitted below the SDK's deadline (`ACK_DEADLINE_MS`,
 * src/sdk/core.ts: 5 000 ms), which cuts every request the SDK makes, the
 * decision included: a budget of that or more would let one read outlast the
 * request waiting on it.
 */
export const LEARNING_READ_BUDGET_CEILING_MS = 5_000;
const BUDGET_NAMES = ['LIFT_WITNESS_BUDGET_MS', 'RING_READ_BUDGET_MS'] as const;
/**
 * P62 (R-P110 decision 1): the two budgets in force for a decision. A deployment
 * value under the constant's own name is admitted when it is a whole number of
 * milliseconds above 0 and below `LEARNING_READ_BUDGET_CEILING_MS`, given as
 * its decimal text (or as that number); any other value is refused, the code
 * default stays in force and the refusal is named (`refused`, sorted). An unset
 * value is the default and names nothing.
 */
export function learningReadBudgets(env: object): LearningReadBudgets {
  const vars = env as Partial<Record<(typeof BUDGET_NAMES)[number], unknown>>, refused: string[] = [];
  const admitted = (name: (typeof BUDGET_NAMES)[number], fallback: number): number => {
    const value = vars[name];
    if (value === undefined || value === null) return fallback;
    const ms = typeof value === 'number' ? value : typeof value === 'string' && /^[0-9]+$/.test(value) ? Number(value) : Number.NaN;
    if (Number.isSafeInteger(ms) && ms > 0 && ms < LEARNING_READ_BUDGET_CEILING_MS) return ms;
    refused.push(name);
    return fallback;
  };
  const lift = admitted('LIFT_WITNESS_BUDGET_MS', LIFT_WITNESS_BUDGET_MS), ring = admitted('RING_READ_BUDGET_MS', RING_READ_BUDGET_MS);
  return { lift, ring, ...(refused.length ? { refused: refused.sort() } : {}) };
}

/**
 * Live authority is never satisfied by an eventually-consistent KV/cache hit.
 *
 * W38 B7 (amendment A36): the witness budget is the round trip to the statistics
 * object, and nothing else. The snapshot's own digest — the reader's work, which
 * grows with the snapshot (a snapshot at the object's counter caps is about
 * 680 KB) — is settled BEFORE the budget starts, so a large snapshot is never
 * refused because digesting it and the round trip together outlasted the budget. A
 * caller that holds the snapshot across reads passes its memoized digest
 * (`digest`, asked for only once the witness will be checked), so a cached read
 * never digests the snapshot again. The comparison itself is
 * unchanged: a digest the object did not publish, or an answer after the budget,
 * serves nothing, and a digest that cannot be computed is a failed witness.
 *
 * P61 (amendment 6, R-P110): today's callers keep this boolean; it is `true`
 * exactly when `liftWitnessOutcome` below answers `served`.
 */
export async function currentLiftWitness(env: Pick<Env, 'LEARN_STATS'>, tenant: string, brand: string, slot: string, snapshot: LiftSnapshot, page?: string,
  digest?: () => Promise<string>): Promise<boolean> {
  return await liftWitnessOutcome(env, tenant, brand, slot, snapshot, page, digest) === 'served';
}
/** P61: what the witness can say of a copy that is present and compatible (`none` and `incompatible` are the reader's). */
export type LiftWitnessOutcome = Exclude<LiftReadOutcome, 'none' | 'incompatible'>;
/** P62: the witness's outcome and, for a copy served that is not the object's latest publication, what it is (`explain.lift.asOf`). */
export interface LiftWitnessVerdict { outcome: LiftWitnessOutcome; asOf?: LiftAsOf }
/** P62 (R-P110): the statistics object's light witness door (LearnStats `/witness`); `/health` stays the operators'. */
export const LIFT_WITNESS_DOOR = 'https://learn/witness';
/** P61: `liftWitnessVerdict`'s outcome alone. */
export async function liftWitnessOutcome(env: Pick<Env, 'LEARN_STATS'>, tenant: string, brand: string, slot: string, snapshot: LiftSnapshot, page?: string,
  digest?: () => Promise<string>, budgetMs?: number): Promise<LiftWitnessOutcome> {
  return (await liftWitnessVerdict(env, tenant, brand, slot, snapshot, page, digest, budgetMs)).outcome;
}
/**
 * P61 (amendment 6, R-P110): the witness of `currentLiftWitness`, returning its
 * reason instead of a boolean, the first of these that applies:
 *   · `failed`: no statistics binding, a digest that cannot be computed, a call
 *     that errored, or an answer that is not this placement's witness answer
 *     (not OK, not JSON, another tenant, brand, slot or page);
 *   · `late`: no answer within the budget (the call is aborted, as before);
 *   · `unhealthy`: the object answered a state other than `healthy`;
 *   · `served`: the object's current witness, its latest publication's witness,
 *     version and digest all match the copy; or (P62) the copy is one of the
 *     object's recent publications, recognised by version and digest inside
 *     `LIFT_RECENT_WINDOW_MS` from its publication, and the object's current
 *     witness (configuration, fence, projection) is the copy's: then `asOf`
 *     names the copy's version and publication time and the latest version;
 *   · `superseded`: a copy the object no longer accepts because it has moved on
 *     since: one of its recent publications under another witness, or a copy
 *     outside the window whose later version the object has published (named
 *     by its version alone: the object keeps no older publication);
 *   · `unrecognized`: any other copy, a version or a digest the object never
 *     published (a forged or damaged copy, or one without a witness); a version
 *     it published inside the window under another digest (P62); and (R-P113)
 *     the object's latest publication when the object's witness has changed
 *     since (a reset or a transition moved the fence), so the witness the
 *     object now confirms is not that copy's.
 * P62: it asks the object's light witness door, under the budget in force
 * (`learningReadBudgets`, or `budgetMs` when the caller holds it).
 */
export async function liftWitnessVerdict(env: Pick<Env, 'LEARN_STATS'>, tenant: string, brand: string, slot: string, snapshot: LiftSnapshot, page?: string,
  digest?: () => Promise<string>, budgetMs: number = learningReadBudgets(env).lift): Promise<LiftWitnessVerdict> {
  if (!env.LEARN_STATS) return { outcome: 'failed' };
  if (typeof snapshot.witness !== 'string' || !/^[a-f0-9]{64}$/.test(snapshot.witness)) return { outcome: 'unrecognized' };
  const namespace = env.LEARN_STATS;
  let expected: string;
  try { expected = await (digest ? digest() : recoveryDigest(snapshot)); } catch { return { outcome: 'failed' }; }
  const abort = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  const probe = async (): Promise<LiftWitnessVerdict> => { try {
    // W26 R2: a page-scoped placement is witnessed by its own page's object,
    // which answers for that page and no other.
    const response = await namespace.get(namespace.idFromName(statsName(tenant, brand, slot, page))).fetch(LIFT_WITNESS_DOOR, {
      method: 'POST', body: JSON.stringify({ tenant, brand, slot, ...(page ? { page } : {}) }), signal: abort.signal,
    });
    const value = await response.json() as Record<string, unknown>;
    const publication = value.publication as { witness?: string; digest?: string; version?: number } | null;
    if (!response.ok || value.ok !== true || value.tenant !== tenant || value.brand !== brand || value.slot !== slot || (value.page ?? undefined) !== page) return { outcome: 'failed' };
    if (value.state !== 'healthy') return { outcome: 'unhealthy' };
    const published = !!publication && publication.witness === snapshot.witness && publication.version === snapshot.version && publication.digest === expected;
    if (published) return { outcome: value.witness === snapshot.witness ? 'served' : 'unrecognized' };
    // P62: the object's recent publications, inside the window it answers for.
    const recent = (Array.isArray(value.recent) ? value.recent as Array<Record<string, unknown>> : [])
      .find(entry => entry !== null && typeof entry === 'object' && entry.version === snapshot.version);
    if (recent && recent.digest === expected && typeof recent.publishedAt === 'number' && Number.isFinite(recent.publishedAt)) {
      if (value.witness === snapshot.witness && publication && typeof publication.version === 'number')
        return { outcome: 'served', asOf: { latest: publication.version, publishedAt: recent.publishedAt, version: snapshot.version } };
      return { outcome: 'superseded' };
    }
    if (recent) return { outcome: 'unrecognized' };
    return { outcome: publication && typeof publication.version === 'number' && typeof snapshot.version === 'number' && publication.version > snapshot.version ? 'superseded' : 'unrecognized' };
  } catch { return { outcome: 'failed' }; } };
  try { return await Promise.race([probe(), new Promise<LiftWitnessVerdict>(resolve => { timer = setTimeout(() => { abort.abort(); resolve({ outcome: 'late' }); }, budgetMs); })]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
/** P61: whole milliseconds since `started` (a `performance.now()` reading), never negative. */
export const elapsedMs = (started: number): number => Math.max(0, Math.round(performance.now() - started));
import type { ContentPiece, DecisionRecord, LearningRead, LearningReadBudgets, LiftAsOf, LiftReadOutcome, RingReadOutcome, SlotAttribution, SlotCatalog } from '@/content/types';
import { isOffLimitsLayoutRecord, isRewardType, type OutcomeRecord } from '@/ledger/records';
import { attribute, recordedMoneyPolicy, successCreditOf, type AttributionPolicy, type MoneyPolicy, type MoneyRefusal, type RingEntry } from './policy';
// The ring's own reach, read from the module that declares it and that
// `@/durable-objects/DecisionRing` re-exports under the same name. It is read
// from there and NOT from the ring itself because the ring imports this module:
// measured under this repository's own runner, `import { RING_MAX_AGE_MS } from
// '@/durable-objects/DecisionRing'` here resolves to `undefined` whenever the
// ring is the first of the two to load (src/learn/learn.test.ts imports it at
// line 10, this module at line 12), which silently emptied the statistics
// object's applied-delivery journal.
import { ADOPTED_MEMBERS, emptyStats, recordExposure, recordSuccess, REPUBLISHED_MEMBERS, RING_MAX_AGE_MS, type StatsConfig, type StatsState } from './stats';
import type { RewardType } from '@/ledger/records';
import { loadTombstone } from '@/ledger/erasure';
import { isLedgerMessage } from '@/ledger/writer';
import { byteLength, equalLogicalRows, logicalIdentity, MANAGED_BYTES, recordEvidenceLoss } from '@/ledger/delivery';
import { requireRetention, type RetentionEnv } from '@/retention';
import { pinRetention } from '@/identity/sessionAuthority';
import { recoveryDigest, learningEffectId, type LearningEffect, type LearningGeneration } from '@/ledger/recovery';
import { PublicationError, pinPublication, publicationScope, readPinnedPublication } from '@/config/publication';
import { isCatalogueName, slotPagesOf, SLOTS_KIND } from '@/content/kinds';

/** Physical input/comparison budgets, not retained-history or provider limits. */
export const FAN_LIMITS = { rows: 1000, recordBytes: MANAGED_BYTES, work: 1_000_000 } as const;

/**
 * The online path's own horizon, used for two things that must never drift
 * apart. It IS the visitor ring's own reach — `RING_MAX_AGE_MS`, exported by
 * the object that enforces it (`@/durable-objects/DecisionRing`) and re-exported
 * here under the name the online path already reads — so there is one constant
 * and not a second copy of its value (W22 A1.02):
 *   · W22 A1.01 — whatever window the tenant's published policy asks for, this
 *     is the horizon the online path can actually apply, which is what its
 *     snapshot's `appliedWindowsMs` declares.
 *   · W22 D1.02 (F16 §7, §2.3; ruling R104(c)) — it is also how far back the
 *     two halves of the online path can recognize a REDELIVERY they have
 *     already applied: the exposure in `LearnStats` and the credit in
 *     `DecisionRing` forget a delivery at the same moment, and neither claims
 *     idempotence beyond it. A repeat arriving after it is applied again, and
 *     no unit claims otherwise.
 *
 */
export const ONLINE_RING_REACH_MS = RING_MAX_AGE_MS;

export const ringName = (tenant: string, visitorId: string) => `${tenant}:${visitorId}`;
/**
 * W26 R2 (F21 §6(b), §8 "Page in `statsName`/`liftKey`"; LANE-LOG R198): the
 * storage identity of one placement.
 *
 * A slot name the tenant's catalogue carries on ONE page keeps the page-less
 * identity it has always had — `tenant:brand:slot`, `lift:tenant:brand:slot`,
 * `lift/tenant/brand/slot/` — and with it every statistic already learned under
 * it. A name a RETAINED catalogue carries on more than one page
 * (`pageScopedSlotNames`, `src/content/kinds.ts`) is qualified by the page, as
 * `slot@page`, so `home/hero` and `pdp/hero` are two statistics objects, two
 * snapshots and two archives, and neither is ever read for the other. `page` is
 * passed ONLY for a page-scoped name; every caller resolves that through
 * `identityPage`.
 *
 * A qualified name can never be another placement's plain name, and nothing can
 * address or create one except by its slot and its page (review D3): a page is
 * always a catalogue page name (`isCatalogueName`: no `:`, `@` or `/`), and no
 * slot name ever carries `@` — a catalogue slot is a slug, and these three
 * functions, every statistics object, every fan-in and every operator route
 * refuse one that does (`isPlacementSlot`). They THROW rather than build a name
 * from anything else, so a caller that skipped its own check still cannot reach
 * a page-separated object under another name.
 */
export const isPlacementSlot = (slot: unknown): slot is string => typeof slot === 'string' && slot.length > 0 && !slot.includes('@');
export const placementSlot = (slot: string, page?: string) => {
  if (!isPlacementSlot(slot) || (page !== undefined && page !== '' && !isCatalogueName(page))) throw new Error('Learning placement unavailable');
  return page ? `${slot}@${page}` : slot;
};
export const statsName = (tenant: string, brand: string, slot: string, page?: string) => `${tenant}:${brand}:${placementSlot(slot, page)}`;
export const liftKey = (tenant: string, brand: string, slot: string, page?: string) => `lift:${tenant}:${brand}:${placementSlot(slot, page)}`;
/** Phase 3 (doc 22 §12.3): every published snapshot is also archived by version, so a replay can read the one in force. */
export const liftArchiveKey = (tenant: string, brand: string, slot: string, version: number, page?: string) => `lift/${tenant}/${brand}/${placementSlot(slot, page)}/${version}.json`;
/**
 * P05 (decision D2): where a placement's statistics object publishes its
 * position-policy history (`positionHistoryOf`, src/learn/stats.ts), beside the
 * snapshot archive and named so no archive reading takes it for a version. The
 * object writes it; the online credit and the hourly fold both read it.
 */
export const positionHistoryKey = (tenant: string, brand: string, slot: string, page?: string) => `lift/${tenant}/${brand}/${placementSlot(slot, page)}/positions.json`;
/**
 * P42 (R-P78, decision D1): where a placement's statistics object records the
 * marker of a publication refused for the pooled cause (`StaleMarker`): its own
 * key, beside the snapshot's and never inside it, so the snapshot at `liftKey`,
 * its archive and its witness stay exactly what was published and the serving
 * path reads nothing new. Only that refusal writes it; a placement that has
 * never been refused so has no such key, and no publication of any placement
 * reads or writes it. A later successful publication supersedes it without a
 * call of its own: the marker applies only while the snapshot in force is the
 * one it names (`staleMarkerIn`). `lift-stale:` is a prefix no `liftKey` starts with.
 */
export const liftStaleKey = (tenant: string, brand: string, slot: string, page?: string) => `lift-stale:${tenant}:${brand}:${placementSlot(slot, page)}`;
/** P42: a module named by a marker, bounded as the statistics object bounds an item name. */
const staleModule = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256
  && ![...v].some(char => char.charCodeAt(0) < 32) && !Object.prototype.hasOwnProperty.call(Object.prototype, v);
const plainObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const exactly = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key));
/**
 * P42: the marker, when `value` is one exactly as the statistics object writes
 * it — keys `lastPublished`, `modules` and `placement` and no other; a published
 * version and time, or null; one to 256 module names, sorted and distinct; a
 * catalogue page and slot — rebuilt with its keys sorted (R-P3). Anything else
 * is no marker (null), so nothing that is not one is ever answered as one.
 */
export function staleMarkerOf(value: unknown): StaleMarker | null {
  if (!plainObject(value) || !exactly(value, ['lastPublished', 'modules', 'placement'])) return null;
  const { lastPublished: last, modules, placement } = value;
  if (last !== null && (!plainObject(last) || !exactly(last, ['publishedAt', 'version'])
    || !Number.isSafeInteger(last.version) || (last.version as number) <= 0
    || typeof last.publishedAt !== 'number' || !Number.isFinite(new Date(last.publishedAt).getTime()))) return null;
  if (!Array.isArray(modules) || modules.length === 0 || modules.length > 256 || !modules.every(staleModule)
    || modules.some((module, i) => i > 0 && !((modules[i - 1] as string) < module))) return null;
  if (!plainObject(placement) || !exactly(placement, ['page', 'slot']) || !isCatalogueName(placement.page) || !isCatalogueName(placement.slot)) return null;
  return { lastPublished: last === null ? null : { publishedAt: last.publishedAt as number, version: last.version as number },
    modules: [...modules as string[]], placement: { page: placement.page, slot: placement.slot } };
}
/**
 * P42: the marker while it still applies — while the snapshot in force is the one
 * it names (its version and publication time), or, for a placement that has never
 * published, while there is still no snapshot in force. Once a publication
 * succeeds the snapshot in force is another one, and the marker no longer applies.
 */
export function staleMarkerIn(marker: StaleMarker | null, inForce: unknown): StaleMarker | null {
  if (!marker) return null;
  if (marker.lastPublished === null) return inForce === null || inForce === undefined ? marker : null;
  return plainObject(inForce) && inForce.version === marker.lastPublished.version && inForce.publishedAt === marker.lastPublished.publishedAt ? marker : null;
}
/**
 * P42: the refusal's sentence, composed from the marker alone, so the statistics
 * object and the operator's publish route say the same words: the faulty page,
 * its slot, every pooled module the refused placement reads from it, and the
 * version its snapshot stays at (or that it stays unpublished). It begins with
 * today's `statistics recovery required`, which every other recovery refusal
 * keeps unchanged.
 */
export function staleRefusalOf(marker: StaleMarker): string {
  const { page, slot } = marker.placement;
  return `statistics recovery required: this pooled publication was refused because the statistics of page ${page}, slot ${slot} could not be read`
    + ` for the pooled module${marker.modules.length > 1 ? 's' : ''} ${marker.modules.join(', ')}; `
    + (marker.lastPublished
      ? `the slot's snapshot stays at version ${marker.lastPublished.version}, its last successful publication, until a publication succeeds`
      : 'the slot has no successful publication yet and stays unpublished until a publication succeeds');
}
/**
 * P42: the marker of a statistics object's answer that is exactly the pooled
 * refusal — `{ ok: false, error, stale }`, no other member, a well-formed marker
 * and the object's own sentence for it — or null for any other answer.
 */
export function staleRefusalIn(body: unknown): StaleMarker | null {
  if (!plainObject(body) || !exactly(body, ['ok', 'error', 'stale']) || body.ok !== false) return null;
  const marker = staleMarkerOf(body.stale);
  return marker && body.error === staleRefusalOf(marker) ? marker : null;
}
/**
 * P49 (R-P78, decision D1): where a placement's statistics object records what a
 * publication refused after a learn republish names (`Republished`), with the
 * snapshot in force it left in force: its own key, beside the snapshot's and
 * never inside it, as P42's marker is (`liftStaleKey`). Only that refusal writes
 * it; no publication of any placement reads or writes it, and a later successful
 * publication supersedes it without a call of its own: it applies only while the
 * snapshot in force is the one it names (`republishedIn`). `lift-republished:` is a
 * prefix no `liftKey` and no `liftStaleKey` starts with. P55: a generation
 * transition whose own publication does not succeed supersedes it with one put
 * under this same key (`supersededRecordOf`).
 */
export const liftRepublishedKey = (tenant: string, brand: string, slot: string, page?: string) => `lift-republished:${tenant}:${brand}:${placementSlot(slot, page)}`;
/** P49: the snapshot in force a refusal leaves in force, its version and publication time, or null where there is none. */
type InForce = { publishedAt: number; version: number } | null;
const inForceOf = (value: unknown): InForce | undefined => {
  if (value === null) return null;
  if (!plainObject(value) || !exactly(value, ['publishedAt', 'version']) || !Number.isSafeInteger(value.version) || (value.version as number) <= 0
    || typeof value.publishedAt !== 'number' || !Number.isFinite(new Date(value.publishedAt).getTime())) return undefined;
  return { publishedAt: value.publishedAt, version: value.version as number };
};
/** P49: a value a changed member may name, by member: the closed words of the slot's dials, or a finite number of the `stats` block. */
const republishedValue = (member: RepublishedChange['member'], v: unknown): v is string | number => {
  if (member === 'reward') return isRewardType(v);
  if (member === 'objective') return v === 'unit' || v === 'revenue' || v === 'margin';
  if (member === 'measurementBasis') return v === 'served-v1' || v === 'rendered-v1';
  return typeof v === 'number' && Number.isFinite(v);
};
/**
 * P49: the member, when `value` is one exactly as the statistics object writes
 * it — keys `changed`, `endedBy` and `slot`, with `page` for a page-scoped
 * placement, and no other; one to eight changes, each exactly `member`, `new` and
 * `old`, a member of the tuple (`REPUBLISHED_MEMBERS`), sorted and distinct, both
 * values of that member's kind and different; `endedBy` the generation
 * transition; a catalogue slot and page — rebuilt with its keys sorted (R-P3).
 * Anything else is no member (null), so nothing that is not one is ever
 * answered as one.
 */
export function republishedOf(value: unknown): Republished | null {
  if (!plainObject(value)) return null;
  const scoped = Object.hasOwn(value, 'page');
  if (!exactly(value, scoped ? ['changed', 'endedBy', 'page', 'slot'] : ['changed', 'endedBy', 'slot'])
    || value.endedBy !== 'generation_transition' || !isCatalogueName(value.slot) || (scoped && !isCatalogueName(value.page))) return null;
  const changed = value.changed;
  if (!Array.isArray(changed) || changed.length === 0 || changed.length > REPUBLISHED_MEMBERS.length) return null;
  const out: RepublishedChange[] = [];
  for (const entry of changed as unknown[]) {
    if (!plainObject(entry) || !exactly(entry, ['member', 'new', 'old'])) return null;
    const member = REPUBLISHED_MEMBERS.find(name => name === entry.member);
    if (!member || (out.length > 0 && !(out[out.length - 1]!.member < member))) return null;
    if (!republishedValue(member, entry.new) || !republishedValue(member, entry.old) || entry.new === entry.old) return null;
    out.push({ member, new: entry.new, old: entry.old });
  }
  return { changed: out, endedBy: 'generation_transition', ...(scoped ? { page: value.page as string } : {}), slot: value.slot as string };
}
/**
 * P49: what a statistics object records under `liftRepublishedKey` — `{ lastPublished, republished }`
 * exactly, the snapshot in force the refusal left in force (or null) and the member — or null for
 * anything else.
 */
export function republishedRecordOf(value: unknown): { lastPublished: InForce; republished: Republished } | null {
  if (!plainObject(value) || !exactly(value, ['lastPublished', 'republished'])) return null;
  const lastPublished = inForceOf(value.lastPublished), republished = republishedOf(value.republished);
  return lastPublished === undefined || !republished ? null : { lastPublished, republished };
}
/**
 * P49: the member while it still applies — while the snapshot in force is the one
 * the refusal left in force (its version and publication time), or, for a
 * placement that had never published, while there is still none. Once a
 * publication succeeds (the generation transition publishes one) the snapshot in
 * force is another one, and the member no longer applies.
 */
export function republishedIn(record: { lastPublished: InForce; republished: Republished } | null, inForce: unknown): Republished | null {
  if (!record) return null;
  if (record.lastPublished === null) return inForce === null || inForce === undefined ? record.republished : null;
  return plainObject(inForce) && inForce.version === record.lastPublished.version && inForce.publishedAt === record.lastPublished.publishedAt
    ? record.republished : null;
}
/**
 * P55 (R-P78, decision D1): what a generation transition whose own publication did
 * not succeed leaves under `liftRepublishedKey` in place of P49's record it
 * supersedes: the record in its own form, the snapshot in force it named kept,
 * with no change left outstanding (`changed: []`), because the transition adopted
 * every changed member (P50 refuses one that does not). A record naming no change
 * is no record (`republishedRecordOf`, since `republishedOf` requires one change or
 * more), so neither lift read carries `republished` for the placement any longer;
 * what still holds the slot then is the cause that failed the transition's
 * publication, which P42's `stale` names when it is the pooled fault.
 */
export function supersededRecordOf(record: { lastPublished: InForce; republished: Republished }): { lastPublished: InForce; republished: Republished } {
  return { lastPublished: record.lastPublished, republished: { ...record.republished, changed: [] } };
}
/**
 * P49: the refusal's sentence, composed from the member, the tenant and the
 * version of the snapshot in force alone, so the statistics object and the
 * operator's publish route say the same words: the slot (and its page), each
 * changed member with its old and new values, the version the slot's statistics
 * stay at (or that the slot stays unpublished), and what ends it, with the route.
 * It begins with today's `statistics recovery required`, which every other
 * recovery refusal keeps unchanged.
 */
export function republishedRefusalOf(republished: Republished, tenant: string, version: number | null): string {
  const changes = republished.changed.map(c => `${c.member} from ${c.old} to ${c.new}`);
  const list = changes.length > 1 ? `${changes.slice(0, -1).join(', ')} and ${changes[changes.length - 1]}` : changes[0];
  return `statistics recovery required: the learn document republished for slot ${republished.slot}${republished.page ? ` on page ${republished.page}` : ''}`
    + ` changed ${list}; `
    + (version === null ? 'the slot has no successful publication yet and stays unpublished' : `the slot's statistics stay at version ${version}`)
    + ` until an operator starts the new generation with POST /v1/${tenant}/learn/generation`
    + ` (or the document is republished with the old value${changes.length > 1 ? 's' : ''})`;
}
/**
 * P49: the member and the version of a statistics object's answer that is exactly
 * the refusal after a learn republish — `{ ok: false, error, republished }`, no
 * other member, a well-formed member and the object's own sentence for it, for
 * this tenant and a version that is a safe whole number — or null for any other
 * answer.
 */
export function republishedRefusalIn(body: unknown, tenant: string): { republished: Republished; version: number | null } | null {
  if (!plainObject(body) || !exactly(body, ['ok', 'error', 'republished']) || body.ok !== false || typeof body.error !== 'string') return null;
  const republished = republishedOf(body.republished);
  if (!republished) return null;
  const at = /; the slot's statistics stay at version ([1-9][0-9]{0,15}) until /.exec(body.error);
  const version = at ? Number(at[1]) : null;
  if (version !== null && !Number.isSafeInteger(version)) return null;
  return body.error === republishedRefusalOf(republished, tenant, version) ? { republished, version } : null;
}
/**
 * P50 (R-P78, decision D1): the member, when `value` is one exactly as the
 * statistics object writes it — keys `changed` and `slot`, with `page` for a
 * page-scoped placement, and no other; one to three changes, each exactly
 * `member`, `new` and `old`, a member an operator adopts (`ADOPTED_MEMBERS`),
 * sorted and distinct, both values words of that member and different; a
 * catalogue slot and page — rebuilt with its keys sorted (R-P3). Anything else
 * is no member (null), so nothing that is not one is ever answered as one.
 */
export function notAdoptedOf(value: unknown): NotAdopted | null {
  if (!plainObject(value)) return null;
  const scoped = Object.hasOwn(value, 'page');
  if (!exactly(value, scoped ? ['changed', 'page', 'slot'] : ['changed', 'slot'])
    || !isCatalogueName(value.slot) || (scoped && !isCatalogueName(value.page))) return null;
  const changed = value.changed;
  if (!Array.isArray(changed) || changed.length === 0 || changed.length > ADOPTED_MEMBERS.length) return null;
  const out: NotAdoptedChange[] = [];
  for (const entry of changed as unknown[]) {
    if (!plainObject(entry) || !exactly(entry, ['member', 'new', 'old'])) return null;
    const member = ADOPTED_MEMBERS.find(name => name === entry.member);
    if (!member || (out.length > 0 && !(out[out.length - 1]!.member < member))) return null;
    if (!republishedValue(member, entry.new) || !republishedValue(member, entry.old) || entry.new === entry.old) return null;
    out.push({ member, new: entry.new as string, old: entry.old as string });
  }
  return { changed: out, ...(scoped ? { page: value.page as string } : {}), slot: value.slot as string };
}
/**
 * P50: the refusal's sentence, composed from the member and the tenant alone, so
 * the statistics object and the operator's transition route say the same words:
 * the slot (and its page), each member not adopted with its old and new values,
 * that the slot would count no exposure, and how to adopt each: a `reward` or an
 * `objective` by naming its new value in the body of the transition (or by a
 * republish restoring the old value), the `measurementBasis`, which no
 * transition moves, only by a republish restoring the old basis.
 */
export function notAdoptedRefusalOf(notAdopted: NotAdopted, tenant: string): string {
  const and = (parts: string[]) => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] ?? '');
  const named = notAdopted.changed.filter(c => c.member !== 'measurementBasis');
  const basis = notAdopted.changed.find(c => c.member === 'measurementBasis');
  const how = [
    ...(named.length ? [`name ${and(named.map(c => `${c.member} ${c.new}`))} in the body of POST /v1/${tenant}/learn/generation`
      + ` (or republish the learn document with ${and(named.map(c => `${c.member} ${c.old}`))})`] : []),
    ...(basis ? [`republish the learn document with measurementBasis ${basis.old}, since no generation transition moves the measurement basis`] : []),
  ];
  return `generation transition refused: the learn document republished for slot ${notAdopted.slot}${notAdopted.page ? ` on page ${notAdopted.page}` : ''}`
    + ` changed ${and(notAdopted.changed.map(c => `${c.member} from ${c.old} to ${c.new}`))}`
    + ` and this transition does not adopt ${notAdopted.changed.length > 1 ? 'them' : 'it'}, so the slot would count no exposure; ${how.join('; and ')}`;
}
/**
 * P50: the member of a statistics object's answer that is exactly the
 * transition's refusal of a member it does not adopt — `{ ok: false, error,
 * notAdopted }`, no other member, a well-formed member and the object's own
 * sentence for it, for this tenant — or null for any other answer.
 */
export function notAdoptedRefusalIn(body: unknown, tenant: string): NotAdopted | null {
  if (!plainObject(body) || !exactly(body, ['ok', 'error', 'notAdopted']) || body.ok !== false || typeof body.error !== 'string') return null;
  const notAdopted = notAdoptedOf(body.notAdopted);
  return notAdopted && body.error === notAdoptedRefusalOf(notAdopted, tenant) ? notAdopted : null;
}
/** W26 R2: the page that enters a placement's identity — its own page for a page-scoped slot name, none for any other. */
export const identityPage = (scoped: ReadonlySet<string>, slot: string, page: string | undefined): string | undefined =>
  scoped.has(slot) ? page : undefined;
/** W26 R2: a placement's slot is a placement slot, and a page-scoped one names a catalogue page; anything else could address another object. */
const placementValid = (scoped: ReadonlySet<string>, slot: string, page: unknown): boolean => isPlacementSlot(slot) && (!scoped.has(slot) || isCatalogueName(page));

/**
 * W26 R2 (review D2): the slot names of the tenant's PUBLISHED catalogue whose
 * identity carries the page, for a caller that has not already read the
 * catalogue.
 *
 * A tenant that publishes no catalogue has no cross-page name, and its answer
 * is the empty set: no publication authority bound at all, a publication that
 * was never initialized, or a committed set without a slot catalogue in it.
 * ANYTHING ELSE that stops the catalogue being read — a transient storage
 * outage, a damaged set — THROWS. The placement of a cross-page name cannot be
 * known then, and answering with the page-less name would pool both pages'
 * evidence, silently, into an object nothing serves. Every caller turns the
 * throw into a refusal it names: a fan-in's receipt is `config` and nothing is
 * sent, and the owner's recovery leaves the operation unprepared so its own
 * retry resolves the catalogue again. A typed owner or consent refusal raised
 * inside the read propagates unchanged.
 */
export async function pageScopedSlotsOf(env: Partial<Pick<Env, 'STORAGE'>>, tenant: string): Promise<ReadonlySet<string>> {
  return new Set([...await publishedSlotPagesOf(env, tenant)].filter(([, pages]) => pages.length > 1).map(([slot]) => slot));
}
/** W26 R2: the pages each slot name of the tenant's published catalogue is carried on, under `pageScopedSlotsOf`'s rules. */
export async function publishedSlotPagesOf(env: Partial<Pick<Env, 'STORAGE'>>, tenant: string): Promise<Map<string, string[]>> {
  const storage = env.STORAGE as { get?: unknown; put?: unknown } | undefined;
  if (!storage || typeof storage.get !== 'function' || typeof storage.put !== 'function') return new Map();
  const scope = publicationScope(SLOTS_KIND, tenant);
  let pin: Awaited<ReturnType<typeof pinPublication>>;
  try { pin = await pinPublication(env as Env, scope, true); }
  catch (error) {
    if (error instanceof PublicationError && error.code === 'publication_uninitialized') return new Map();
    throw error;
  }
  if (!Object.values(pin.refs).some(ref => ref.kind === SLOTS_KIND.name && ref.scope === scope)) return new Map();
  return slotPagesOf((await readPinnedPublication(env as Env, SLOTS_KIND, tenant, pin)).value);
}
/** W26 R2: a `pageScoped` member on the wire — sorted catalogue slot names, or null when malformed. */
export function pageScopedOf(value: unknown): ReadonlySet<string> | null {
  if (value === undefined) return new Set();
  if (!Array.isArray(value) || value.length > FAN_LIMITS.rows || value.some(name => !isCatalogueName(name))) return null;
  return new Set(value as string[]);
}
/** W26 R2: the wire form of a set of page-scoped names — absent when empty, so an unscoped body is byte-identical to before. */
export const pageScopedWire = (scoped: ReadonlySet<string>): { pageScoped?: string[] } => scoped.size ? { pageScoped: [...scoped].sort() } : {};

/**
 * P08 (decision D1, freeze item 27): one placement a module the catalogue
 * declares pooled is served in — a slot it names (`slotTypes`) on a page the
 * slots document carries that slot on. `identity` is the page in the
 * placement's own storage identity, present only for a page-scoped slot name
 * (W26 R2, `identityPage`), so the placement is the very object its decisions
 * are fanned to and its credits forwarded to, untouched.
 */
export interface PooledPlacement { slot: string; page: string; identity?: string }
/**
 * P08 (decisions D1, D2): every placement of every module the catalogue
 * declares pooled, by module. A pooled module's exposures and credits keep
 * landing where they always have — each placement's own statistics object,
 * page-scoped where W26 R2 says so — and every placement's publication reads
 * them all into the module's ONE record, the page as its level after everyone
 * (`LearnStats`, `buildSnapshot`). An undeclared module has no entry: it is
 * never read outside its own placement, exactly as before. Pure.
 */
export function pooledPlacementsOf(pieces: ReadonlyArray<Pick<ContentPiece, 'id' | 'slotTypes' | 'pooled'>>, slots: Pick<SlotCatalog, 'pages'> | null | undefined): Map<string, PooledPlacement[]> {
  const pages = slotPagesOf(slots);
  const scoped = new Set([...pages].filter(([, on]) => on.length > 1).map(([slot]) => slot));
  const out = new Map<string, PooledPlacement[]>();
  for (const piece of pieces) {
    if (piece.pooled !== true || out.has(piece.id)) continue;
    const placements: PooledPlacement[] = [];
    for (const slot of new Set(piece.slotTypes)) for (const page of pages.get(slot) ?? []) {
      if (!isPlacementSlot(slot) || !isCatalogueName(page)) continue;
      placements.push({ slot, page, ...(scoped.has(slot) ? { identity: page } : {}) });
    }
    if (placements.length) out.set(piece.id, placements);
  }
  return out;
}

type NS = DurableObjectNamespace | undefined;
export interface StatsWriteReceipt {
  version: 1 | 2; kind: 'exposures' | 'credits'; received: number; processed: number; skipped: number;
  newlyApplied?: number; alreadyApplied?: number; suppressed?: number;
  /** Save was acknowledged; scheduling is separate from processing and from publication. */
  alarm: 'scheduled' | 'unknown';
}
interface AppendCounts {
  kind: 'append'; received: number; accepted: number; cutoffSkipped: number;
  /** Resulting bounded ring and long index depths, not retained-input counts. */
  retained: number; indexed: number;
}
/** v1 acceptance is legacy, not evidence of unique admission. */
export type AppendReceipt = AppendCounts & ({ version: 1 } | { version: 2; duplicates: number });
export interface DestinationCounts { destinations: number; acknowledged: number; unknown: number; notAttempted: number }
export interface StatsDelivery extends DestinationCounts {
  received: number; processed: number; skipped: number; rowsUnknown: number; rowsNotAttempted: number; alarmsUnknown: number;
  newlyApplied?: number; alreadyApplied?: number; suppressed?: number;
}
/** W24 R1.02: the money policy and its rule live in the one credit rule's module (P103); re-exported for their readers here. */
export { moneyRefusal, type MoneyPolicy, type MoneyRefusal } from './policy';

export interface OutcomeReceipt {
  version: 1; kind: 'outcome'; received: 1; cutoffSkipped: number;
  attributed: number; eligible: number; weightSkipped: number; credits: StatsDelivery;
  /**
   * W24 R1.01/R1.02, as W24 R1.03/R1.04 place it: NO slot the ring would have
   * credited took this outcome, and why — `reward` because none of them learns
   * from this reward, `money` because the platform will not weigh it in the
   * objective's own unit without a published policy. Absent whenever at least
   * one slot was credited, so it always reads "no slot learns from this" and
   * never "this one did not, that one did", which `refusedBySlot` says instead.
   */
  notCredited?: 'reward' | 'money';
  /** W24 R1.02: the money the platform refused to weigh, named. */
  money?: MoneyRefusal;
  /**
   * W24 R1.03/R1.04: one entry per slot the visitor's ring WOULD have credited
   * and did not, naming which rule refused it — `reward` when the slot learns
   * against another reward, `money` when the slot's objective is money and the
   * platform will not weigh this outcome in it. The decision is per credited
   * slot, made where the ring groups its per-slot batches, so an outcome is
   * never dropped for one slot's reason on another slot's behalf.
   *
   * OPTIONAL and absent when nothing was refused, and carried through rather
   * than required, for the same reason `outsideWindow` is: `outcomeReply`
   * rebuilds a ring reply member by member and the object's own reply is not
   * the only body that reaches it.
   */
  refusedBySlot?: Record<string, 'reward' | 'money'>;
  /**
   * W24 R1.03: how many slots refused it — the number of `refusedBySlot`'s
   * entries, carried as a count so the receipt's own arithmetic accounts for
   * the refusal beside `attributed` and `eligible`. `attributed` counts the
   * slots that were credited and no others, so `attributed = eligible +
   * weightSkipped` still holds and a refusal is never read as a credit.
   */
  refused?: number;
  /**
   * W23 T1.01: how many ring decisions this outcome matched but could not be
   * credited to, because more time had passed than the reward's own attribution
   * window allows (doc 22 §4.1). Zero when nothing matched it at all: a miss by
   * item is not a miss by time, and an operator can tell the two apart.
   *
   * OPTIONAL, and carried through rather than required, because `outcomeReply`
   * below rebuilds a ring reply member by member and the object's reply is not
   * the only body that reaches it: `src/learn/holdoutArms.test.ts:279`/`:300`
   * feed it a synthetic receipt that has no such member and must still be
   * accepted as valid. The visitor's own `DecisionRing` always sets it.
   */
  outsideWindow?: number;
  /**
   * W26 C1.01 (F21 §6(c), §8): how many correlated decisions this outcome NAMED
   * and could not be credited to because it carries another brand than the
   * decision was served under. Zero when nothing disagreed; the credit is
   * refused either way, and this is what makes the refusal legible rather than
   * indistinguishable from "nothing matched".
   *
   * OPTIONAL and carried through rather than required, for exactly the reason
   * `outsideWindow` above is: `outcomeReply` rebuilds a ring reply member by
   * member and the visitor's object is not the only body that reaches it
   * (`src/learn/holdoutArms.test.ts:279`/`:300` feed a synthetic receipt that
   * has no such member and must still be accepted). The visitor's own
   * `DecisionRing` always sets it.
   */
  brandMismatched?: number;
  /**
   * P33 (decision D1, freeze item 11; R-P35, S4F-C5): the itemisation of how
   * the outcome was credited, on the attribution record the visitor's ring
   * derives when it credits the outcome — this receipt, kept on the ring's
   * credit plan. One entry per slot whose learn dials name their own
   * attribution policy, sorted by slot: `policy` is that policy and `credited`
   * the decision identifiers it credited, `[]` when none, the same decisions
   * the plan's credit effects carry. Written for every outcome, one that
   * credits nothing included, and ABSENT when no slot names a policy of its
   * own, so such a receipt is exactly what it was. The stored outcome record
   * is the admitted source and never carries it.
   */
  attribution?: SlotAttributionEntry[];
}
/** P33: one slot's line of the itemisation. */
export interface SlotAttributionEntry { slot: string; policy: SlotAttribution; credited: string[] }
export interface LearningReceipt {
  version: 1; kind: 'decisions' | 'outcome'; ok: boolean;
  code: 'complete' | 'invalid' | 'barrier' | 'config' | 'incomplete'; received: number; cutoffSkipped: number;
  /** Current decision calls only: surviving copies coalesced within this call, never durable deduplication. */
  coalesced?: number;
  ring: DestinationCounts; exposures: StatsDelivery; append: AppendReceipt | null; outcome: OutcomeReceipt | null;
}
const destinations = (): DestinationCounts => ({ destinations: 0, acknowledged: 0, unknown: 0, notAttempted: 0 });
export const emptyStatsDelivery = (): StatsDelivery => ({ ...destinations(), received: 0, processed: 0, skipped: 0, rowsUnknown: 0, rowsNotAttempted: 0, alarmsUnknown: 0 });
const receipt = (kind: LearningReceipt['kind'], received: number): LearningReceipt => ({ version: 1, kind, ok: true, code: 'complete', received,
  cutoffSkipped: 0, ...(kind === 'decisions' ? { coalesced: 0 } : {}), ring: destinations(), exposures: emptyStatsDelivery(), append: null, outcome: null });
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const total = (expected: number, ...values: number[]): boolean => values.every(count) && count(expected) && values.reduce((a, b) => a + b, 0) === expected;
function admission() {
  let work = 0, size = 0;
  const spend = (n = 1) => { if ((work += n) > FAN_LIMITS.work) throw new Error('Learning input unavailable'); };
  const detach = <T extends DecisionRecord | OutcomeRecord>(row: T, stream: 'decision' | 'outcome'): T => {
    spend();
    const valid = (v: unknown): v is T => object(v) && isLedgerMessage({ kind: 'ledger', type: stream, record: v })
      && logicalIdentity(v, stream) !== null;
    // Inspect own reserved fields before JSON can drop an explicitly undefined value.
    if (!valid(row)) throw new Error('Learning input unavailable');
    const body = JSON.stringify(row);
    if ((size += byteLength(body)) > FAN_LIMITS.recordBytes) throw new Error('Learning input unavailable');
    const copy: unknown = JSON.parse(body);
    if (!valid(copy)) throw new Error('Learning input unavailable');
    return copy;
  };
  return { spend, detach };
}
function isStatsDelivery(v: unknown): v is StatsDelivery {
  if (!object(v) || !['destinations', 'acknowledged', 'unknown', 'notAttempted', 'received', 'processed', 'skipped', 'rowsUnknown', 'rowsNotAttempted', 'alarmsUnknown'].every(k => count(v[k]))) return false;
  const d = v as unknown as StatsDelivery;
  if (['newlyApplied', 'alreadyApplied', 'suppressed'].some(key => Object.hasOwn(v, key))
    && (!count(d.newlyApplied) || !count(d.alreadyApplied) || !count(d.suppressed)
      || !total(d.processed, d.newlyApplied, d.alreadyApplied, d.suppressed))) return false;
  return total(d.destinations, d.acknowledged, d.unknown, d.notAttempted)
    && total(d.received, d.processed, d.skipped, d.rowsUnknown, d.rowsNotAttempted)
    && d.alarmsUnknown <= d.acknowledged && d.destinations <= d.received
    && (d.unknown === 0 ? d.rowsUnknown === 0 : d.rowsUnknown >= d.unknown)
    && (d.notAttempted === 0 ? d.rowsNotAttempted === 0 : d.rowsNotAttempted >= d.notAttempted)
    && (d.acknowledged === 0 ? d.processed + d.skipped === 0 : d.processed + d.skipped >= d.acknowledged);
}
const statsComplete = (d: StatsDelivery): boolean => d.unknown === 0 && d.notAttempted === 0 && d.skipped === 0 && d.alarmsUnknown === 0;

type Posted<T> = { state: 'acknowledged'; receipt: T } | { state: 'unknown' | 'notAttempted' };
/** No retries: a failed HTTP/body acknowledgement can follow a committed non-idempotent write. */
async function post<T>(ns: NS, name: string, path: string, body: unknown, validate: (body: unknown) => T | null, signal?: AbortSignal): Promise<Posted<T>> {
  if (!ns) return { state: 'notAttempted' };
  try {
    const stub = ns.get(ns.idFromName(name));
    const response = await stub.fetch(`https://learn${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...(signal ? { signal } : {}) });
    if (!response.ok) return { state: 'unknown' };
    const accepted = validate(await response.json());
    return accepted ? { state: 'acknowledged', receipt: accepted } : { state: 'unknown' };
  } catch { return { state: 'unknown' }; }
}

export async function deliverStats(ns: NS, name: string, kind: StatsWriteReceipt['kind'], body: unknown, received: number): Promise<StatsDelivery> {
  const out = emptyStatsDelivery();
  if (!received) return out;
  out.destinations = 1; out.received = received;
  const result = await post(ns, name, '/' + kind, body, value => {
    if (!object(value) || value.ok !== true || !object(value.receipt)) return null;
    const r = value.receipt;
    const managed = object(body) && body.version === 2;
    return r.version === (managed ? 2 : 1) && r.kind === kind && r.received === received && count(r.processed) && count(r.skipped)
      && total(received, r.processed, r.skipped) && (r.alarm === 'scheduled' || r.alarm === 'unknown')
      && (!managed || (count(r.newlyApplied) && count(r.alreadyApplied) && count(r.suppressed) && total(r.processed, r.newlyApplied, r.alreadyApplied, r.suppressed)))
      ? { version: r.version, kind, received, processed: r.processed, skipped: r.skipped, alarm: r.alarm,
        ...(managed ? { newlyApplied: Number(r.newlyApplied), alreadyApplied: Number(r.alreadyApplied), suppressed: Number(r.suppressed) } : {}) } : null;
  });
  if (result.state === 'acknowledged') {
    out.acknowledged = 1; out.processed = result.receipt.processed; out.skipped = result.receipt.skipped;
    out.alarmsUnknown = Number(result.receipt.alarm === 'unknown');
    if (result.receipt.version === 2) Object.assign(out, { newlyApplied: result.receipt.newlyApplied,
      alreadyApplied: result.receipt.alreadyApplied, suppressed: result.receipt.suppressed });
  } else if (result.state === 'unknown') { out.unknown = 1; out.rowsUnknown = received; }
  else { out.notAttempted = 1; out.rowsNotAttempted = received; }
  return out;
}
export function sumStatsDeliveries(parts: readonly StatsDelivery[]): StatsDelivery {
  const out = emptyStatsDelivery();
  for (const part of parts) for (const key of Object.keys(part) as Array<keyof StatsDelivery>) out[key] = (out[key] ?? 0) + (part[key] ?? 0);
  return out;
}
function appendReply(value: unknown, received: number): AppendReceipt | null {
  if (!object(value) || value.ok !== true || !object(value.receipt)) return null;
  const r = value.receipt;
  if (r.kind !== 'append' || r.received !== received || !count(r.accepted) || !count(r.cutoffSkipped)
    || !count(r.retained) || r.retained > 200 || !count(r.indexed) || value.ring !== r.retained) return null;
  const counts: AppendCounts = { kind: 'append', received, accepted: r.accepted, cutoffSkipped: r.cutoffSkipped, retained: r.retained, indexed: r.indexed };
  if (r.version === 1 && total(received, r.accepted, r.cutoffSkipped)) return { ...counts, version: 1 };
  return r.version === 2 && count(r.duplicates) && total(received, r.accepted, r.duplicates, r.cutoffSkipped)
    ? { ...counts, version: 2, duplicates: r.duplicates } : null;
}
/**
 * W24 R1.03/R1.04: the per-slot refusals on a ring reply, read back. A map of
 * slot names to the rule that refused each one, or null when the member is
 * anything else — a refusal the caller cannot read is a malformed reply, never
 * a silent credit. Built with `Object.fromEntries` so a slot named `__proto__`
 * becomes an own property rather than reaching a setter.
 */
function refusalsBySlot(value: unknown): Record<string, 'reward' | 'money'> | null {
  if (!object(value)) return null;
  const entries = Object.entries(value);
  if (!entries.length || entries.some(([slot, reason]) => !slot || (reason !== 'reward' && reason !== 'money'))) return null;
  return Object.fromEntries(entries) as Record<string, 'reward' | 'money'>;
}
/**
 * P33: the itemisation on a ring reply, read back: entries of exactly
 * `{ slot, policy, credited }`, one per slot, `policy` the module-tied policy
 * and `credited` decision identifiers, never more credited decisions than the
 * receipt credited. Null when malformed: an itemisation the caller cannot read
 * is a malformed reply, never a silent credit.
 */
function attributionReply(value: unknown, eligible: unknown): SlotAttributionEntry[] | null {
  if (!Array.isArray(value) || !value.length || value.length > FAN_LIMITS.rows || !count(eligible)) return null;
  const out: SlotAttributionEntry[] = [], seen = new Set<string>();
  let credited = 0;
  for (const entry of value as unknown[]) {
    if (!object(entry) || Object.keys(entry).some(key => key !== 'slot' && key !== 'policy' && key !== 'credited')
      || typeof entry.slot !== 'string' || !entry.slot || seen.has(entry.slot) || entry.policy !== 'module-tied'
      || !Array.isArray(entry.credited) || entry.credited.some(id => typeof id !== 'string' || !id)) return null;
    seen.add(entry.slot); credited += entry.credited.length;
    out.push({ slot: entry.slot, policy: 'module-tied', credited: [...entry.credited as string[]] });
  }
  return credited <= eligible ? out : null;
}
/** W24 R1.02: the money refusal on a ring reply, read back; null when malformed. */
function moneyReply(value: unknown): MoneyRefusal | null {
  if (!object(value) || value.reason !== 'money_policy_unset'
    || Object.keys(value).some(key => key !== 'reason' && key !== 'code')
    || (value.code !== undefined && typeof value.code !== 'string')) return null;
  return { ...(typeof value.code === 'string' ? { code: value.code } : {}), reason: 'money_policy_unset' };
}
function outcomeReply(value: unknown): OutcomeReceipt | null {
  if (!object(value) || value.ok !== true || !object(value.receipt)) return null;
  const r = value.receipt;
  // W24 R1.03: the refusal members, present or absent, never malformed — and
  // `refused` IS the number of entries in `refusedBySlot`, so a reply cannot
  // claim a count its own named refusals do not carry. W24 R4 (LANE-LOG R203;
  // W24-B2 build review finding 1): the two travel TOGETHER or not at all, the
  // way the ring emits them (`DecisionRing.outcome()`). A `refused` with no
  // `refusedBySlot` beside it — what a partially deployed or faulty ring would
  // send — is a count nobody named, refused as malformed exactly as every other
  // member that does not account for itself: `ring.unknown`, no outcome
  // receipt, the learning receipt not ok. Never admitted as a refusal the
  // receipt cannot name, and never read as a credit.
  const refusedBySlot = r.refusedBySlot === undefined ? undefined : refusalsBySlot(r.refusedBySlot);
  const money = r.money === undefined ? undefined : moneyReply(r.money);
  // P33: present or absent, never malformed.
  const attribution = r.attribution === undefined ? undefined : attributionReply(r.attribution, r.eligible);
  if (r.version !== 1 || r.kind !== 'outcome' || r.received !== 1 || !count(r.cutoffSkipped) || r.cutoffSkipped > 1
    || !count(r.attributed) || !count(r.eligible) || !count(r.weightSkipped) || !total(r.attributed, r.eligible, r.weightSkipped)
    || value.credits !== r.attributed || !isStatsDelivery(r.credits) || r.credits.received !== r.eligible
    || (r.cutoffSkipped === 1 && r.attributed !== 0)
    // W23 T1.01, W26 C1.01: present or absent, never malformed.
    || (r.outsideWindow !== undefined && !count(r.outsideWindow))
    || (r.brandMismatched !== undefined && !count(r.brandMismatched))
    || refusedBySlot === null || money === null || attribution === null
    || (refusedBySlot === undefined ? r.refused !== undefined : r.refused !== Object.keys(refusedBySlot).length)
    // "No slot learns from this" is a statement about an outcome nothing took.
    || (r.notCredited !== undefined && (!['reward', 'money'].includes(r.notCredited as string) || r.attributed !== 0))) return null;
  const credits: StatsDelivery = { ...r.credits };
  return { version: 1, kind: 'outcome', received: 1, cutoffSkipped: r.cutoffSkipped, attributed: r.attributed, eligible: r.eligible, weightSkipped: r.weightSkipped, credits,
    ...(r.outsideWindow !== undefined ? { outsideWindow: r.outsideWindow as number } : {}),
    ...(r.brandMismatched !== undefined ? { brandMismatched: r.brandMismatched as number } : {}),
    ...(refusedBySlot !== undefined ? { refusedBySlot } : {}),
    ...(r.refused !== undefined ? { refused: r.refused as number } : {}),
    ...(money !== undefined ? { money } : {}),
    ...(r.notCredited !== undefined ? { notCredited: r.notCredited as 'reward' | 'money' } : {}),
    ...(attribution !== undefined ? { attribution } : {}) };
}
/**
 * W22 R1.01: rows whose fan-out post was ATTEMPTED and not accepted — the
 * refusal F16 §5(c) says every caller records as delivered. A destination that
 * was never called (`notAttempted`) is a binding that is absent, not a post
 * that was refused, and is not counted here.
 */
export function fanOutRejectedRows(out: LearningReceipt): number {
  // The statistics objects only. The visitor's ring is one destination for a
  // whole set, and its own failure is already a receipt the caller reports; it
  // is not a row the statistics refused, and counting it here would say a row
  // of evidence was rejected when the ring simply did not answer.
  return out.exposures.rowsUnknown + (out.outcome?.credits.rowsUnknown ?? 0);
}
async function reportFanOutLoss(env: Partial<Pick<Env, 'CACHE'>>, tenant: string, out: LearningReceipt): Promise<LearningReceipt> {
  await recordEvidenceLoss(env, tenant, 'fanOutRejected', fanOutRejectedRows(out));
  return out;
}
function finish(out: LearningReceipt): LearningReceipt {
  out.ok = out.code === 'complete' && total(out.ring.destinations, out.ring.acknowledged, out.ring.unknown, out.ring.notAttempted)
    && out.ring.acknowledged === out.ring.destinations && isStatsDelivery(out.exposures)
    && statsComplete(out.exposures) && (!out.outcome || statsComplete(out.outcome.credits));
  if (!out.ok && out.code === 'complete') out.code = 'incomplete';
  return out;
}
/**
 * Only current background wrappers report: one fixed numeric summary, never raw
 * identifiers or errors.
 *
 * W24 R3 (LANE-LOG R203; W24-B2 build review finding 3): the line shows what
 * the outcome receipt says was REFUSED beside what it says was attributed —
 * `refused`, a count like every other member (zero when nothing was refused or
 * no receipt came back), and `refusedBySlot`, the receipt's own map of the
 * configured slot names to the rule that refused each (`reward` or `money`),
 * present only when the receipt carries one. Slot names are the tenant's
 * published slot catalogue, not a visitor, content or error identifier; a
 * line with nothing refused stays wholly numeric.
 */
export function reportLearningIncomplete(kind: LearningReceipt['kind'], result: LearningReceipt | null): void {
  if (result?.ok) return;
  try {
    const credits = result?.outcome?.credits;
    const refusedBySlot = result?.outcome?.refusedBySlot;
    console.warn('learning_incomplete', {
      version: 1, kind: kind === 'decisions' ? 0 : 1, code: result ? ['complete', 'invalid', 'barrier', 'config', 'incomplete'].indexOf(result.code) : 3,
      received: result?.received ?? 1, cutoffSkipped: result?.cutoffSkipped ?? 0,
      coalesced: result?.coalesced ?? 0,
      ringAcknowledged: result?.ring.acknowledged ?? 0, ringUnknown: result?.ring.unknown ?? 0, ringNotAttempted: result?.ring.notAttempted ?? 1,
      exposureProcessed: result?.exposures.processed ?? 0, exposureSkipped: result?.exposures.skipped ?? 0,
      exposureUnknown: result?.exposures.rowsUnknown ?? 0, exposureNotAttempted: result?.exposures.rowsNotAttempted ?? 0,
      creditPlanKnown: Number(result?.outcome !== null && result?.outcome !== undefined), attributed: result?.outcome?.attributed ?? 0,
      eligible: result?.outcome?.eligible ?? 0, weightSkipped: result?.outcome?.weightSkipped ?? 0,
      refused: result?.outcome?.refused ?? 0,
      creditProcessed: credits?.processed ?? 0, creditSkipped: credits?.skipped ?? 0, creditUnknown: credits?.rowsUnknown ?? 0, creditNotAttempted: credits?.rowsNotAttempted ?? 0,
      alarmsUnknown: (result?.exposures.alarmsUnknown ?? 0) + (credits?.alarmsUnknown ?? 0),
      ...(refusedBySlot ? { refusedBySlot: Object.fromEntries(Object.entries(refusedBySlot)) } : {}),
    });
  } catch { /* Diagnostics must not throw or cause a retry. */ }
}

/**
 * CW30: the visitor's ring, read on the decision path under a time budget so
 * the fatigue term can never extend a decision by more than `timeoutMs`. Null
 * when the ring is unbound, slow or failing: no penalty, never an error.
 * P62 (R-P110 decision 1, R-P112(1)): the budget is `RING_READ_BUDGET_MS`
 * unless the caller holds another, and the ring call is aborted when it runs
 * out, as the lift witness's is, so nothing that waits for the calls a
 * decision started (the shopper's owner drains them before it answers) waits
 * on the ring past it.
 */
export async function readRing(env: Pick<Env, 'DECISION_RING'>, tenant: string, visitorId: string, timeoutMs = RING_READ_BUDGET_MS): Promise<RingEntry[] | null> {
  return (await readRingWithOutcome(env, tenant, visitorId, timeoutMs)).ring;
}
/**
 * P61 (amendment 6, R-P110): `readRing`, telling how the read ended, with its
 * whole milliseconds from its start to its outcome: `read` (the ring answered
 * within the budget, an empty ring included), `late` (it did not), `failed`
 * (no ring binding, a call that errored, or an answer that is not a ring
 * answer). The read, its budget and what it serves are `readRing`'s, unchanged.
 */
export async function readRingWithOutcome(env: Pick<Env, 'DECISION_RING'>, tenant: string, visitorId: string, timeoutMs = RING_READ_BUDGET_MS):
  Promise<{ ring: RingEntry[] | null; read: LearningRead<RingReadOutcome> }> {
  const started = performance.now();
  const told = (ring: RingEntry[] | null, outcome: RingReadOutcome) => ({ ring, read: { ms: elapsedMs(started), outcome } });
  const ns = env.DECISION_RING;
  if (!ns) return told(null, 'failed');
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const read = ns.get(ns.idFromName(ringName(tenant, visitorId))).fetch('https://learn/recent', { signal: abort.signal }).then(async (res) => {
      // The ring keeps the full served records; attribution and the fatigue term read them as entries.
      const body = (await res.json()) as { ok?: boolean; ring?: Array<DecisionRecord | RingEntry> };
      return body.ok && Array.isArray(body.ring) ? body.ring.map((r) => ('decision_id' in r ? ringEntryOf(r) : r)) : null;
    });
    const late = new Promise<'late'>((resolve) => { timer = setTimeout(() => { abort.abort(); resolve('late'); }, timeoutMs); });
    const ring = await Promise.race([read, late]);
    return ring === 'late' ? told(null, 'late') : told(ring, ring ? 'read' : 'failed');
  } catch { return told(null, 'failed'); } finally { if (timer !== undefined) clearTimeout(timer); }
}

/**
 * CW30: slot → item → how many times this shopper was served that item, from
 * the ring entries, inside the window the slot's own fatigue rule sets.
 *
 * W26 F1.01 (F21 §6(a)): the count is this shopper's history of the ITEM
 * across every placement in the brand — every slot, every page, either arm —
 * and only the WINDOW and the basis come from the slot being scored. That is
 * the settled behaviour (HANDOFF-2026-09-16:230 "W26.04 live fatigue now
 * filters to brand, retaining intended cross-placement global-item history. Do
 * not accidentally add slot/page/arm fatigue restrictions as a 'fix.'";
 * HANDOFF-2026-09-18:322), and it is what a shopper means by "I keep seeing
 * this": she does not see slots. The ring this reads is already one brand's,
 * so the brand is the scope and no filter here narrows it further. The doc said
 * "that slot's" and the code never did; the words were the defect, not the
 * number.
 */
export function servedCounts(ring: readonly RingEntry[], slots: ReadonlyArray<{ slot: string; fatigue?: { weight: number; windowHours: number }; measurementBasis?: import('@/content/types').MeasurementBasis }>, now: number): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const s of slots) {
    if (!s.fatigue || s.fatigue.weight <= 0) continue;
    const since = now - s.fatigue.windowHours * 3_600_000;
    const counts: Record<string, number> = {};
    for (const e of ring) {
      const basis = e.measurementBasis ?? 'served-v1';
      const at = basis === 'rendered-v1' ? e.renderedAt : e.ts;
      if (basis === (s.measurementBasis ?? 'served-v1') && typeof at === 'number' && at >= since && at <= now) counts[e.item] = (counts[e.item] ?? 0) + 1;
    }
    if (Object.keys(counts).length) out[s.slot] = counts;
  }
  return out;
}

/**
 * P05: what a decision tells the statistics object about its position — the
 * position counted from 1 within its slot, for a module of a page's declared
 * layout slot (a record carrying the layout reason, P29), the only slot a
 * position estimate and its normalisation exist for; and, on each of the two
 * modules an adjacent swap exchanged, the pair it exchanged. `swapOnly` keeps
 * only the latter. Empty for any other record, so its row is exactly as before.
 */
export function positionRowOf(r: DecisionRecord | undefined, swapOnly = false): { position?: number; swap?: [number, number] } {
  if (!r || !Number.isSafeInteger(r.position) || r.position < 0 || r.position >= 64) return {};
  const x = r.explain?.exploration;
  if (x?.mode === 'adjacent-swap' && Array.isArray(x.positions) && x.positions.length === 2 && Number.isSafeInteger(x.positions[0])
    && x.positions[1] === x.positions[0] + 1 && (r.position + 1 === x.positions[0] || r.position + 1 === x.positions[1])) {
    return { position: r.position + 1, swap: [x.positions[0], x.positions[1]] };
  }
  return !swapOnly && r.explain?.layoutReason !== undefined ? { position: r.position + 1 } : {};
}

export const ringEntryOf = (r: DecisionRecord): RingEntry =>
  ({ id: r.decision_id, tenant: r.tenant, visitor_id: r.visitor_id, brand: r.brand, ts: r.ts, page: r.page, slot: r.slot, position: r.position,
    measurementBasis: r.measurementBasis ?? 'served-v1', ...(r.rendered ? { renderedAt: r.rendered.at } : {}),
    item: r.item_id, session_id: r.session_id, arm: r.arm, cell: r.cell, ...(r.retention ? { retention: r.retention } : {}), ...(r.featured_product_ids?.length ? { products: [...r.featured_product_ids] } : {}),
    ...successEntryOf(r) });

/**
 * P16 (decision D1, freeze items 14 and 43): the success event a decision's
 * record names (`explain.successEvent`), as attribution and the credit read it
 * off the ring entry: the event and the table's value, exactly as recorded. A
 * member that is present and not one this platform writes — an event outside
 * the reward list, a value that is neither null nor a finite number above zero,
 * another member — is kept as an event no outcome carries, so the decision is
 * credited nothing rather than credited by a guess. Absent on a record that
 * names none, so its entry is exactly as before.
 */
function successEntryOf(r: DecisionRecord): Pick<RingEntry, 'successEvent'> {
  const named: unknown = (r.explain as { successEvent?: unknown } | undefined)?.successEvent;
  if (named === undefined) return {};
  const read = object(named) && Object.keys(named).sort().join(',') === 'event,value' && isRewardType(named.event)
    && (named.value === null || (typeof named.value === 'number' && Number.isFinite(named.value) && named.value > 0));
  return { successEvent: read ? { event: named.event as string, value: named.value as number | null } : { event: '', value: null } };
}

/**
 * The slot's configuration the statistics object publishes against. P33
 * (R-P39, S4F-C6): `attribution`, the slot's own attribution policy, rides it
 * only to the visitor's ring (`slotConfigsOf`), which credits by it and never
 * forwards it: the configuration a statistics object receives is exactly
 * reward, stats, objective and measurement basis.
 */
export interface SlotLearnConfig { reward: RewardType; stats: StatsConfig; measurementBasis?: import('@/content/types').MeasurementBasis; /** CW27: absent means unit. */ objective?: 'unit' | 'revenue' | 'margin';
  attribution?: SlotAttribution }

export async function learningGenerations(ns: NS, name: string, items: string[]): Promise<Record<string, LearningGeneration>> {
  if (!ns) throw new Error('Learning generation unavailable');
  const response = await ns.get(ns.idFromName(name)).fetch('https://learn/generation', { method: 'POST', body: JSON.stringify({ items: [...new Set(items)] }) });
  if (!response.ok) throw new Error('Learning generation unavailable');
  const value: unknown = await response.json();
  if (!object(value) || value.ok !== true || !count(value.whole) || !object(value.items)
    || items.some(item => !count((value.items as Record<string, unknown>)[item]))) throw new Error('Learning generation unavailable');
  return Object.fromEntries(items.map(item => [item, { whole: value.whole as number, item: Number((value.items as Record<string, unknown>)[item]) }]));
}

/**
 * W26 R2: every statistics object a set of personalized records lands in, by
 * name — the managed path prepares its effects against these and the recovery
 * record names them for cleanup, so both follow the page-separated object.
 */
export function exposureDestinations(records: readonly DecisionRecord[], scoped: ReadonlySet<string>): string[] {
  const names = new Set<string>();
  // P29 (decision D2): an off-limits layout slot's record is no exposure, so it lands in no statistics object.
  for (const row of records) if (row.arm === 'personalized' && !isOffLimitsLayoutRecord(row)) {
    if (!placementValid(scoped, row.slot, row.page)) throw new Error('Learning placement unavailable');
    names.add(statsName(row.tenant, row.brand, row.slot, identityPage(scoped, row.slot, row.page)));
  }
  return [...names];
}

export async function prepareExposureEffects(env: Env, records: DecisionRecord[], consentUntil: number, scoped: ReadonlySet<string> = new Set()): Promise<Record<string, LearningEffect>> {
  const result: Record<string, LearningEffect> = {}, groups = new Map<string, DecisionRecord[]>();
  for (const row of records) if (row.arm === 'personalized' && !isOffLimitsLayoutRecord(row)) {
    if (!placementValid(scoped, row.slot, row.page)) throw new Error('Learning placement unavailable');
    const name = statsName(row.tenant, row.brand, row.slot, identityPage(scoped, row.slot, row.page)); groups.set(name, [...(groups.get(name) ?? []), row]);
  }
  for (const [name, rows] of groups) {
    const generations = await learningGenerations(env.LEARN_STATS, name, rows.map(row => row.item_id));
    for (const row of rows) result[row.decision_id] = { version: 1,
      id: await learningEffectId('exposures', name, row.decision_id), decision: row.decision_id,
      tenant: row.tenant, subject: row.visitor_id, generation: generations[row.item_id]!,
      retention: requireRetention(env, row.retention?.online, row.tenant, 'online'), consentUntil };
  }
  return result;
}

/**
 * After a decision set is served: the ring gets the full records, each
 * placement's object gets its exposures.
 *
 * W26 R2: `pageScoped` is the set of slot names whose identity carries the page
 * (`pageScopedSlotNames`), as the caller already holds it — the serving path
 * from the catalogue it decided with, the managed path from what its recovery
 * record prepared. A caller that holds none has it read here, once, before
 * either destination starts (`pageScopedSlotsOf`).
 */
export async function fanDecisions(env: Pick<Env, 'DECISION_RING' | 'LEARN_STATS' | 'STORAGE'> & Partial<RetentionEnv> & Partial<Pick<Env, 'CACHE'>>, set: { tenant: string; brand: string; visitor_id: string; records: DecisionRecord[] }, slotConfig: (slot: string) => SlotLearnConfig, managed?: { effects: Record<string, LearningEffect> }, pageScoped?: ReadonlySet<string>): Promise<LearningReceipt> {
  const out = receipt('decisions', Array.isArray(set.records) ? set.records.length : 0);
  try {
    const { tenant, brand, visitor_id: visitorId, records: input } = set, budget = admission();
    out.code = 'invalid';
    if (!Array.isArray(input)) return finish(out);
    const received = input.length;
    out.received = received;
    if (received > FAN_LIMITS.rows) return finish(out);
    // Capture finite membership before any row's toJSON can resize the caller's array.
    const members: DecisionRecord[] = [];
    for (let i = 0; i < received; i++) {
      budget.spend();
      if (!Object.hasOwn(input, i)) return finish(out);
      members.push(input[i]!);
    }
    const owned = (r: DecisionRecord) => r.tenant === tenant && r.visitor_id === visitorId && r.brand === brand;
    const detached: DecisionRecord[] = [];
    for (const row of members) {
      if (!object(row) || !owned(row)) return finish(out);
      // P29 (decision D2): an off-limits layout slot's record goes to the ledger
      // only: never to the shopper's ring, which receipts and attribution read,
      // and never to the statistics as an exposure.
      if (isOffLimitsLayoutRecord(row)) continue;
      const copy = budget.detach(row, 'decision');
      if (!owned(copy)) return finish(out);
      detached.push(copy);
    }
    if (!detached.length) { out.code = 'complete'; return finish(out); }
    out.code = 'barrier';
    const tombstone = await loadTombstone(env.STORAGE, tenant, visitorId);
    const surviving = detached.filter(r => !tombstone || r.ts > tombstone.erased_at);
    out.cutoffSkipped = detached.length - surviving.length;
    out.code = 'invalid';
    const unique = new Map<string, DecisionRecord>();
    for (const row of surviving) {
      budget.spend();
      const previous = unique.get(row.decision_id);
      if (previous && !equalLogicalRows(previous as unknown as Record<string, unknown>, row as unknown as Record<string, unknown>, budget.spend)) return finish(out);
      if (!previous) unique.set(row.decision_id, row);
    }
    // Publish the count only after the entire surviving cohort reconciles.
    out.coalesced = surviving.length - unique.size;
    const records = [...unique.values()];
    for (const row of records) pinRetention(env as RetentionEnv, row.retention?.online, tenant, 'online');
    out.code = 'complete';
    if (!records.length) return out;
    out.code = 'config';
    // W26 R2: one destination per PLACEMENT — the slot, and its page where the
    // catalogue carries the slot name on more than one page. Only a set that
    // reaches the statistics at all needs the catalogue.
    let scoped: ReadonlySet<string>;
    try { scoped = pageScoped ?? (records.some(r => r.arm === 'personalized') ? await pageScopedSlotsOf(env, tenant) : new Set<string>()); }
    catch {
      // Review D2: the catalogue could not be read, so no placement's identity
      // is known. Refused as `config`, naming both destinations not attempted.
      out.ring = { destinations: 1, acknowledged: 0, unknown: 0, notAttempted: 1 };
      return finish(out);
    }
    const bySlot = new Map<string, { slot: string; page?: string; rows: DecisionRecord[] }>();
    // Holdout decisions remain in the ring, never the personalized statistics.
    for (const r of records) if (r.arm === 'personalized') {
      if (!placementValid(scoped, r.slot, r.page)) { out.code = 'invalid'; return finish(out); }
      const page = identityPage(scoped, r.slot, r.page), name = statsName(tenant, brand, r.slot, page);
      const group = bySlot.get(name) ?? { slot: r.slot, ...(page ? { page } : {}), rows: [] };
      group.rows.push(r); bySlot.set(name, group);
    }
    const rowCount = [...bySlot.values()].reduce((n, g) => n + g.rows.length, 0);
    const markNotAttempted = (): void => {
      out.ring = { destinations: 1, acknowledged: 0, unknown: 0, notAttempted: 1 };
      out.exposures = { ...emptyStatsDelivery(), destinations: bySlot.size, notAttempted: bySlot.size, received: rowCount, rowsNotAttempted: rowCount };
    };
    // G9 (W09.BASE.03): a configuration read that throws still leaves through the
    // catch below as `config`, now naming the ring and every placement's rows it
    // did not attempt, as the catalogue refusal above names its destination.
    try { if (records.some(row => (row.measurementBasis ?? 'served-v1') !== (slotConfig(row.slot).measurementBasis ?? 'served-v1'))) return finish(out); }
    catch (error) { markNotAttempted(); throw error; }
    markNotAttempted();
    // W22 D1.02 (F16 §7): "put `decision_id` back into the `/exposures` payload
    // so `LearnStats` can do the same". A decision is served once, so its
    // logical id is what makes a redelivered exposure recognizable — and the
    // digest of the WHOLE served record travels with it, because two different
    // records under one id are two events, not a repeat (F16 §5(j)), and the
    // payload alone cannot tell them apart. The managed path carries neither:
    // its effect marker already proves the same thing, and adding fields to its
    // row would change the digest every stored marker was written under.
    const exposures = await Promise.all([...bySlot].map(async ([name, { slot, page, rows }]) => ({ name, body: {
      tenant, brand, slot, ...(page ? { page } : {}), config: slotConfig(slot), ...(managed ? { version: 2 } : {}),
      exposures: await Promise.all(rows.map(async r => ({ item: r.item_id, cell: r.cell, ts: r.rendered?.at ?? r.ts,
        // P05: a module an adjacent swap exchanged carries its position and the pair, so the object counts the swap.
        ...positionRowOf(r, true),
        ...(managed ? { effect: managed.effects[r.decision_id] } : { decision: r.decision_id, digest: await recoveryDigest(r) }) }))),
    } })));
    // All validation/barrier/config reads precede starting either destination.
    for (const row of records) requireRetention(env as RetentionEnv, row.retention?.online, tenant, 'online');
    out.code = 'complete';
    out.ring.unknown = 1; out.ring.notAttempted = 0;
    out.exposures.unknown = out.exposures.destinations; out.exposures.notAttempted = 0;
    out.exposures.rowsUnknown = out.exposures.received; out.exposures.rowsNotAttempted = 0;
    const [ring, stats] = await Promise.all([
      post(env.DECISION_RING, ringName(tenant, visitorId), '/append', { tenant, visitorId, records, ...(managed ? { version: 2 } : {}) }, b => appendReply(b, records.length)),
      Promise.all(exposures.map(({ name, body }) => deliverStats(env.LEARN_STATS, name, 'exposures', body, body.exposures.length))),
    ]);
    out.ring.unknown = 0; out.ring[ring.state] = 1;
    if (ring.state === 'acknowledged') out.append = ring.receipt;
    out.exposures = sumStatsDeliveries(stats);
  } catch { if (out.code === 'complete') out.code = 'incomplete'; }
  return reportFanOutLoss(env, set.tenant, finish(out));
}

/** P30: the purpose a cached layout's exposure identity is drawn under, so it can never be another row's. */
const LAYOUT_EXPOSURE_PURPOSE = 'layout-exposure/v1';

/**
 * P30 (decision D2): the exposures of a CACHED layout, counted from its per-view
 * beacon (`layout_exposure`): one exposure per drawn module, in the slot's own
 * statistics object, in the cell of the context the key named — its channel and
 * visit bucket, nothing of the shopper's (stage unknown, no region, no interest)
 * — so they land at level 2 (channel and visit bucket) and the coarser levels,
 * whatever the device. The caller admitted the beacon (src/content/service.ts
 * `admitLayoutExposure`; P85: `admitCarouselExposure`, the painted images of a
 * carousel the head script ordered before paint, counted the same way). Each row's identity is the page view's own — the
 * shopper, the page, the slot, the position drawn and the page instance — with
 * no module or key in it, so the object's applied-delivery journal (W22 D1.02)
 * recognises any repeat for the same page view and counts it once; the subject
 * stands where every journal identity carries it, so erasure removes it as it
 * removes a decision's. The holdout's arms are never counted (the caller refuses
 * their keys) and nothing reaches the shopper's ring: no decision of the
 * shopper's stands behind a cached layout. Never throws; a delivery the object
 * did not acknowledge is counted as lost evidence, like any fan-out's.
 */
export async function fanLayoutExposure(env: Pick<Env, 'LEARN_STATS'> & Partial<Pick<Env, 'CACHE'>>, input: {
  tenant: string; brand: string; slot: string; /** W26 R2: the page of a page-scoped slot name only. */ page?: string; viewPage: string;
  config: SlotLearnConfig; subject: string; pageInstance: string; modules: readonly string[]; cell: DecisionRecord['cell']; at: number;
}): Promise<StatsDelivery> {
  try {
    const { tenant, brand, slot, page, config } = input;
    const exposures = await Promise.all(input.modules.map(async (item, position) => ({ item, cell: input.cell, ts: input.at,
      decision: `${tenant}:view:${input.subject}:${input.viewPage}:${slot}:${position}:${input.pageInstance}`,
      digest: await recoveryDigest([LAYOUT_EXPOSURE_PURPOSE, tenant, brand, input.subject, input.viewPage, slot, position, input.pageInstance]) })));
    const delivery = await deliverStats(env.LEARN_STATS, statsName(tenant, brand, slot, page), 'exposures',
      { tenant, brand, slot, ...(page ? { page } : {}), config, exposures }, exposures.length);
    await recordEvidenceLoss(env, tenant, 'fanOutRejected', delivery.rowsUnknown);
    return delivery;
  } catch { return emptyStatsDelivery(); }
}

/**
 * An outcome to the visitor's ring, which attributes it under the policy and forwards the credits.
 * P103 (R-P588, R-P620): the ring decides the outcome under the money policy its record carries (`money`, this
 * parameter, is no longer read there), and `onDecided` is told the policy it answered it decided under (null for none),
 * only when the ring answered one; `signal` aborts the ring call (the direct path's `RING_DECISION_BOUND_MS`).
 */
export async function fanOutcome(env: Pick<Env, 'DECISION_RING' | 'STORAGE'> & Partial<RetentionEnv> & Partial<Pick<Env, 'CACHE'>>, tenant: string, outcome: OutcomeRecord, policy: AttributionPolicy, brand: string, slotConfig: Record<string, SlotLearnConfig>, defaultSlotConfig?: SlotLearnConfig, managed?: { consentUntil: number }, money?: MoneyPolicy | null, pageScoped?: ReadonlySet<string>, onDecided?: (stamp: MoneyPolicy | null) => void, signal?: AbortSignal): Promise<LearningReceipt> {
  const out = receipt('outcome', 1);
  try {
    out.code = 'invalid';
    if (!object(outcome) || outcome.tenant !== tenant || outcome.brand !== brand) return finish(out);
    const copy = admission().detach(outcome, 'outcome');
    if (copy.tenant !== tenant || copy.brand !== brand) return finish(out);
    outcome = copy;
    out.code = 'barrier';
    const tombstone = await loadTombstone(env.STORAGE, tenant, outcome.visitor_id);
    out.code = 'complete';
    if (tombstone && outcome.ts <= tombstone.erased_at) { out.cutoffSkipped = 1; return out; }
    pinRetention(env as RetentionEnv, outcome.retention?.online, tenant, 'online');
    /**
     * W24 R1.03/R1.04 (build review findings 1 and 2; F19 §7 gap 1, §5.1): the
     * reward filter and the money mechanics are decided PER CREDITED SLOT,
     * inside `DecisionRing.outcome()` where the ring groups its per-slot
     * batches with each slot's own `config` — the way the fold filters each
     * hour's credits per slot (`src/learn/hourly.ts`, `src/learn/report.ts`
     * "the slot learns against one reward").
     *
     * The producer's own filter is WITHDRAWN rather than reduced, and nothing
     * is decided here: the producer cannot see which slots this outcome would
     * be credited to. The slot an outcome NAMES is only the slot it happened
     * in; under a published `policy.match: 'any'` (`src/content/kinds.ts`) the
     * credit goes to every slot whose ring entry the policy matches, so
     * dropping the outcome for the named slot's reward cost a second,
     * legitimately purchase-learning slot its credit, and taking a money
     * objective from ANY money slot in scope refused every unit-objective slot
     * its credits too. Keeping half the rule here as well would state the same
     * rule in two places and let them drift.
     *
     * An outcome is therefore NEVER dropped before the ring for a reward or an
     * objective reason: the ring is the visitor's own record and her delivery
     * journal, not only a credit engine. The tenant's published money policy is
     * carried to it unchanged — resolved at the producer, decided where the
     * slot is known — and the statistics object's own guard remains a
     * compatibility check on the accumulation tuple, never a reward filter.
     */
    /**
     * W26 R2: which slot names carry the page in their identity, resolved here
     * at the producer and carried to the ring, which knows the page of every
     * decision it credits and routes each credit to its own page's object.
     * Review D2: a catalogue that cannot be read refuses the outcome here, as
     * `config`, with the ring not attempted — never a guessed identity.
     */
    out.code = 'config';
    out.ring = { destinations: 1, acknowledged: 0, unknown: 0, notAttempted: 1 };
    const scoped = pageScoped ?? await pageScopedSlotsOf(env, tenant);
    out.code = 'complete';
    out.ring.notAttempted = 0; out.ring.unknown = 1;
    const ring = await post(env.DECISION_RING, ringName(tenant, outcome.visitor_id), '/outcome', { tenant, brand, outcome, policy, slotConfig, defaultSlotConfig,
      ...(money === undefined || money === null ? {} : { money }), ...pageScopedWire(scoped),
      ...(managed ? { version: 2, consentUntil: managed.consentUntil } : {}) }, value => {
        // P103 (R-P620, R-P653): the ring's decision is its answer's `decidedUnder`, the money policy it decided the
        // outcome under or null for none; an answer without one, or with one that is not a policy, decided nothing.
        if (onDecided && object(value) && value.ok === true && Object.hasOwn(value, 'decidedUnder')) {
          const stamp = value.decidedUnder === null ? null : recordedMoneyPolicy(value.decidedUnder);
          if (stamp !== null || value.decidedUnder === null) onDecided(stamp);
        }
        return outcomeReply(value);
      }, signal);
    out.ring.unknown = 0; out.ring[ring.state] = 1;
    if (ring.state === 'acknowledged') out.outcome = ring.receipt;
  } catch { if (out.code === 'complete') out.code = 'incomplete'; }
  return reportFanOutLoss(env, tenant, finish(out));
}

/**
 * W24 T1.02 (document 35 §5 row W24 :426 "Implement reset as explicit
 * containment or trustworthy rebuild/promote from retained events"; F19 §7 "the
 * M piece, reusing report.ts / hourly.ts").
 *
 * The counters one day of RETAINED evidence produces for one slot, folded the
 * way the batch already folds it: the personalized decisions of that slot are
 * its exposures, and every outcome is attributed against its own visitor's ring
 * under the tenant's published learning policy, filtered to the slot's reward
 * (`report.ts`, `hourly.ts`) and weighed by its objective. Pure, so the same
 * day always folds to the same counters and a reader can recompute them.
 *
 * `at` is the moment the rebuilt generation STARTS. The retained evidence is
 * admitted at that moment rather than at its original event times, because a
 * rebuild starts a generation now out of what the platform still holds: it is
 * not a reconstruction of the decay an object that had been counting all along
 * would show, and the snapshot says so through `rebuiltFrom` and `restartedAt`.
 *
 * P33 (decision D1, freeze item 11): `policy` is the tenant's learning policy
 * as `policyOf` reads it, each slot's own attribution policy included
 * (`slotAttribution`), so a module-tied slot is folded by the rule the
 * visitor's ring credited it by, and a slot without one exactly as before.
 *
 * P16 (decision D1, freeze items 14 and 43): a decision whose record names its
 * success event (a slot with a conversion table) is folded by the rule the
 * ring credited it by (`successCreditOf`): an outcome of that event, at the
 * value the record names in the slot's currency; a record that names none,
 * exactly as before.
 */
export function foldRetainedDay(input: {
  tenant: string; brand: string; slot: string; config: SlotLearnConfig; policy: AttributionPolicy;
  decisions: readonly DecisionRecord[]; outcomes: readonly OutcomeRecord[]; at: number;
  /** W26 R2: the page of a page-scoped placement; only that page's decisions and credits are folded. */
  page?: string;
}): { stats: StatsState; decisions: number; outcomes: number } {
  const stats = emptyStats();
  const basis = input.config.measurementBasis ?? 'served-v1';
  const rings = new Map<string, RingEntry[]>(), seen = new Set<string>(), pageOf = new Map<string, string>();
  const placed = (page: string | undefined) => input.page === undefined || page === input.page;
  let decisions = 0, outcomes = 0;
  for (const d of input.decisions) {
    if (!object(d) || d.tenant !== input.tenant || d.brand !== input.brand || seen.has(d.decision_id)) continue;
    // P29 (decision D2): an off-limits layout slot's record never entered the
    // shopper's ring, so a rebuilt ring holds it no more than the live one did:
    // it is neither an exposure nor a decision any outcome can be credited to.
    if (isOffLimitsLayoutRecord(d)) continue;
    seen.add(d.decision_id); pageOf.set(d.decision_id, d.page);
    rings.set(d.visitor_id, [...(rings.get(d.visitor_id) ?? []), ringEntryOf(d)]);
    if (d.slot !== input.slot || !placed(d.page) || d.arm !== 'personalized' || (d.measurementBasis ?? 'served-v1') !== basis) continue;
    recordExposure(stats, d.item_id, d.cell, input.at, input.config.stats, input.at);
    decisions++;
  }
  for (const o of input.outcomes) {
    if (!object(o) || o.tenant !== input.tenant || o.brand !== input.brand) continue;
    const ring = rings.get(o.visitor_id);
    if (!ring) continue;
    let credited = false;
    for (const c of attribute(o, ring, input.policy)) {
      if (c.slot !== input.slot || !placed(pageOf.get(c.decision_id))) continue;
      // The slot learns against one reward — or, P16, the decision against the
      // success event its record names, at its value in the slot's currency —
      // by the one rule the visitor's ring credits by (`successCreditOf`).
      const success = successCreditOf(ring.find((e) => e.id === c.decision_id)?.successEvent, input.config, o);
      if (success === null || 'refused' in success) continue;
      const weight = success.weight;
      if (weight <= 0) continue;
      recordSuccess(stats, c.item, c.cell, success.reward, input.at, weight, input.config.stats, input.at);
      credited = true;
    }
    if (credited) outcomes++;
  }
  return { stats, decisions, outcomes };
}

// ── P61 (amendment 6, R-P110): every learning read, counted per tenant ───────
//
// The decision path names how each lift read and the ring read ended on its
// answer (`sources.lift`, `sources.ring`); these counters keep the same outcomes
// for the tenant, where the monitor reads them (`learningReads` on its result).
// They follow the W20 G2 slot-governance counters (src/learn/slotGovernance.ts)
// rule for rule: one small document per tenant in the operator cache (`CACHE`),
// so no binding or store is added; written after the answer, never before it
// (inside the shopper's owner once it has answered and outside it, never in its
// serializer, R-P115; outside an owner as after-response work), under the
// three conditions those counters are written under (the shopper's tracking
// consent, no synthetic operation, no self-check), so the
// monitor's own probe decisions and a shopper who withheld tracking are never
// counted; never read on a decision path, and never able to fail one; holding
// outcome words and counts only, nothing of the shopper; a floor, never an
// overcount (the read-modify-write is last-write-wins, so concurrent decisions
// may collapse into one increment); counted since a stated horizon, after which
// the counts restart.

/** P61: the lift read's outcomes, in the vocabulary `sources.lift` names them in. */
export const LIFT_READ_OUTCOMES: readonly LiftReadOutcome[] = ['served', 'none', 'incompatible', 'late', 'superseded', 'unrecognized', 'unhealthy', 'failed'];
/** P61: the ring read's outcomes, in the vocabulary `sources.ring` names them in. */
export const RING_READ_OUTCOMES: readonly RingReadOutcome[] = ['read', 'late', 'failed', 'skipped'];
/** P61: the one scope these counts are kept at, stated on every answer and never read from the store: the tenant's, across its brands. */
export const LEARNING_READS_SCOPE = 'tenant';
/** P61: the window the counts are measured over, the slot-governance counters' own; they restart when it lapses. */
export const LEARNING_READS_HORIZON_MS = 30 * 86_400_000;
export const learningReadsKey = (tenant: string): string => `learning-reads:v1:${tenant}`;

/** P61: the tenant's counts of every outcome since `since`, zero reported as zero. */
export interface LearningReads {
  since: number;
  scope: typeof LEARNING_READS_SCOPE;
  lift: Record<LiftReadOutcome, number>;
  ring: Record<RingReadOutcome, number>;
}
interface StoredLearningReads { version: 1; since: number; lift: Record<LiftReadOutcome, number>; ring: Record<RingReadOutcome, number> }

const wholeCount = (value: unknown): number => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0);
/** Every outcome of the vocabulary with its stored count; anything stored that is not a whole, non-negative number reads as zero, and nothing outside the vocabulary is copied. */
function outcomeCounts<O extends string>(names: readonly O[], block: unknown): Record<O, number> {
  const held = block && typeof block === 'object' && !Array.isArray(block) ? block : null;
  return Object.fromEntries(names.map(name => [name, wholeCount(held ? Object.getOwnPropertyDescriptor(held, name)?.value : undefined)])) as Record<O, number>;
}
/** The stored document, read back defensively: one written in another shape, or past its horizon, is none. */
function learningReadsDocument(raw: unknown, now: number): StoredLearningReads | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as { version?: unknown; since?: unknown; lift?: unknown; ring?: unknown };
  const since = value.since;
  if (value.version !== 1 || typeof since !== 'number' || !Number.isSafeInteger(since) || since < 0 || since > now
    || now - since >= LEARNING_READS_HORIZON_MS) return null;
  return { version: 1, since, lift: outcomeCounts(LIFT_READ_OUTCOMES, value.lift), ring: outcomeCounts(RING_READ_OUTCOMES, value.ring) };
}

/**
 * P61: what the monitor reports for the tenant: every outcome counted since the
 * horizon, zeros at a horizon of now when nothing was counted yet, or
 * `undefined` when the store could not be read, so no result states a zero it
 * did not observe. Never throws.
 */
export async function observeLearningReads(env: Pick<Env, 'CACHE'>, tenant: string, now: number): Promise<LearningReads | undefined> {
  try {
    const stored = learningReadsDocument(await env.CACHE.get(learningReadsKey(tenant), 'json'), now);
    return { since: stored?.since ?? now, scope: LEARNING_READS_SCOPE,
      lift: stored?.lift ?? outcomeCounts(LIFT_READ_OUTCOMES, null), ring: stored?.ring ?? outcomeCounts(RING_READ_OUTCOMES, null) };
  } catch { return undefined; }
}

/**
 * P61: one decision's outcomes added to the tenant's counts: each slot's lift
 * read and the ring read. Called after the decision is answered (the decision
 * path hands it to `afterOwnerAnswer`, with the operator cache alone); it
 * resolves whatever happens, so no failure of this diagnostic can reach a
 * shopper's decision.
 */
export async function recordLearningReads(env: Pick<Env, 'CACHE'>, tenant: string, reads: { lift: readonly LiftReadOutcome[]; ring: RingReadOutcome }, now: number): Promise<void> {
  try {
    const document: StoredLearningReads = learningReadsDocument(await env.CACHE.get(learningReadsKey(tenant), 'json'), now)
      ?? { version: 1, since: now, lift: outcomeCounts(LIFT_READ_OUTCOMES, null), ring: outcomeCounts(RING_READ_OUTCOMES, null) };
    for (const outcome of reads.lift) if (LIFT_READ_OUTCOMES.includes(outcome)) document.lift[outcome] = Math.min(document.lift[outcome] + 1, Number.MAX_SAFE_INTEGER);
    if (RING_READ_OUTCOMES.includes(reads.ring)) document.ring[reads.ring] = Math.min(document.ring[reads.ring] + 1, Number.MAX_SAFE_INTEGER);
    await env.CACHE.put(learningReadsKey(tenant), JSON.stringify(document), { expirationTtl: Math.floor(LEARNING_READS_HORIZON_MS / 1000) });
  } catch { /* a diagnostic counter never fails a decision, and never retries on the shopper's time */ }
}
