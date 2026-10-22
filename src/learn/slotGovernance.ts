// src/learn/slotGovernance.ts
// W20 G2 (rulings R83, R86): what the decision path REFUSED for a tenant's
// slots, where an operator can read it.
//
// A refused pin has no delivery decision and no ledger row, and a pinned slot
// that could not fill its `take` writes only the records it served, so neither
// occurrence can be counted from the ledger, the day report or the learning
// snapshot. They are counted here instead: per tenant and per slot, since a
// stated horizon, in ONE operator-facing document that the operator slots page
// (`GET /v1/:tenant/learn/slots?evidence=1`) joins onto its entries exactly as
// it already joins each slot's learning evidence, and that the ops monitor sums
// for its tenant-level counter.
//
// The shape of this module follows from what it may not do:
//   · It is never read on the shopper's decision path, so no read of it can
//     fail a decision. The decision path only WRITES, fire and forget, after
//     the answer has been produced, and every failure is swallowed.
//   · It holds no shopper state: a slot name, the merchandiser's own pinned
//     piece id, the refusal reason the composer recorded, and counts. No
//     visitor, session, cell, arm or affinity term may be written here.
//   · It is BOUNDED in every direction — slots tracked, distinct pins named per
//     slot, the length of a name it will store, and the serialized size of the
//     whole document — so an operator-authored document with thousands of dead
//     pins can never grow it without limit.
//   · It is never silent: a slot with nothing to report reads as zero, with the
//     horizon those zeros are measured from, not as an absent member.
//
// The counts are a monotonic diagnostic within their horizon, not an accounting
// ledger: the read-modify-write is last-write-wins, so concurrent page loads may
// collapse to one increment rather than one each — the counts are a FLOOR, never
// an overcount — and the counter makes no claim beyond "this happened, at least
// this often, since `since`".

import type { Env } from '@/types/env';

/**
 * The scope the counters are kept at, stated on every block that carries them
 * (R99(c)). One document per tenant (`slot-governance:v1:<tenant>`) is written
 * by every page load of that tenant, whichever brand the load was for, and read
 * back whole by every brand's operator surface — so the counts an operator sees
 * beside one brand's learning evidence are the tenant's, counted across all of
 * that tenant's brands.
 *
 * It is a platform constant rather than a binding or a stored value: this is the
 * only scope these counters exist at, so the word is STATED on the answer and is
 * never read out of the store. A document written before the member existed
 * therefore reads as `tenant` without any re-interpretation of its counts, and a
 * `scope` some other tooling wrote into the store can never reach an answer.
 */
export const SLOT_GOVERNANCE_SCOPE = 'tenant';
export type SlotGovernanceScope = typeof SLOT_GOVERNANCE_SCOPE;

/** The per-slot block the operator slots page carries. Zero is reported as zero. */
export interface SlotGovernance {
  /** Epoch milliseconds: the horizon these counts start at. */
  since: number;
  /** The scope these counts are kept at: one document per tenant, covering every brand of it. */
  scope: SlotGovernanceScope;
  /** Occurrences of a refused pin for this slot since `since`. */
  refusedPinCount: number;
  /** The distinct pins refused, with the reason the composer recorded; bounded. */
  refusedPins: Array<{ pinnedPieceId: string; reason: string; count: number }>;
  /** Times this pinned slot served fewer pieces than its `take`. */
  shortTakeCount: number;
  /** Positions left empty across those times. */
  shortTakePositions: number;
  /**
   * P47 (R-P78): occurrences since `since` of a pin of this slot left reserved
   * and unserved because the layout did not return its module (P43's
   * `module_not_returned` entry). Such a pin refuses nothing, so it is counted
   * here and never in `refusedPinCount`.
   */
  unreturnedPinCount: number;
  /** The distinct such pins, bounded as `refusedPins` is, each naming the module and the layout slot. */
  unreturnedPins: UnreturnedPin[];
}

/** P47: one pin left reserved and unserved, keys sorted (R-P3): how often, the piece, and the module and layout slot. */
export interface UnreturnedPin { count: number; pinnedPieceId: string; within: { module: string; slot: string } }

/** What one page load produced, as the decision path reports it. */
export interface SlotGovernanceOccurrences {
  refusedPins: ReadonlyArray<{ slot: string; pinnedPieceId: string; reason: string }>;
  /** `short_take` (R86(b)): a pinned slot that served and still fell short. */
  shortTakes: ReadonlyArray<{ slot: string; empty: number }>;
  /**
   * P47: the page's `module_not_returned` entries (P43), apart from its
   * refusals: the inner slot, its pinned piece and, in `within`, the module the
   * layout did not return and the layout slot. Absent reads as none.
   */
  unreturnedPins?: ReadonlyArray<{ slot: string; pinnedPieceId: string; within?: { module: string; slot: string } }>;
}

/**
 * The tenant-level counts, in the SAME vocabulary the per-slot block uses
 * (R94(2)): one word for one fact on both operator surfaces. The slots page
 * carries these two counts per slot and adds its `refusedPins[]` detail; the
 * monitor carries them summed over the tenant's slots and adds nothing.
 */
export interface TenantSlotGovernance {
  since: number;
  /** The same word for the same fact as the per-slot block: these counts are the tenant's. */
  scope: SlotGovernanceScope;
  refusedPinCount: number;
  shortTakeCount: number;
  /**
   * P47: the tenant's total of pins left reserved and unserved because their
   * module was not returned, after today's members. Present once the tenant's
   * document has counted one within its horizon; a document that never has is
   * in its former shape and answers without it, so a tenant whose pages only
   * refuse reads exactly as before.
   */
  unreturnedPinCount?: number;
}

/** One read of the document: per slot, plus the tenant totals the monitor reports. */
export interface SlotGovernanceView extends TenantSlotGovernance {
  bySlot: Map<string, SlotGovernance>;
}

/**
 * The window the counts are measured over. Counts restart when it lapses, so a
 * refusal an operator fixed months ago never keeps a slot lit for ever. It is a
 * platform constant rather than a binding: no tenant may be told a different
 * horizon than the one the answer states, and the answer always states it.
 */
export const SLOT_GOVERNANCE_HORIZON_MS = 30 * 86_400_000;
/**
 * The most slots one tenant's document counts for within a horizon: the first
 * 200 distinct slots that refuse or fall short are counted, and an occurrence of
 * a further slot is not. The operator slots page joins a block onto every slot it
 * lists, so such a slot reads as zero until the horizon restarts.
 */
const MAX_SLOTS = 200;
/** Distinct pins named per slot; the count keeps counting past it. */
const MAX_PINS_PER_SLOT = 10;
/** A pin id longer than this is counted but not named, so one document cannot carry unbounded text. */
const MAX_ID_LENGTH = 128;
/** The reason vocabulary is short words; anything longer is not one of ours. */
const MAX_REASON_LENGTH = 64;
/** The whole document, serialized. Nothing is written that would exceed it. */
const MAX_BYTES = 128 * 1024;

export const slotGovernanceKey = (tenant: string): string => `slot-governance:v1:${tenant}`;

/** A slot with nothing to report, at the horizon the answer states (R86(b)). */
export const emptySlotGovernance = (since: number): SlotGovernance =>
  ({ since, scope: SLOT_GOVERNANCE_SCOPE, refusedPinCount: 0, refusedPins: [], shortTakeCount: 0, shortTakePositions: 0,
    unreturnedPinCount: 0, unreturnedPins: [] });

interface StoredSlot {
  refusedPinCount: number;
  refusedPins: Array<{ pinnedPieceId: string; reason: string; count: number }>;
  shortTakeCount: number;
  shortTakePositions: number;
  /**
   * P47: written on a slot only from the first pin of it counted as left
   * reserved and unserved, so a slot that only ever refused keeps exactly the
   * bytes it was written with before the members existed.
   */
  unreturnedPinCount?: number;
  unreturnedPins?: UnreturnedPin[];
}
/**
 * What is kept in the store: the horizon and the counts, and nothing that an
 * answer states for itself. The scope is not one of these fields — it is the
 * constant above, applied when the view is projected — so no stored byte can
 * make a document claim a scope its counts were not kept at, and a document
 * written before the member existed needs no migration to be read.
 */
interface StoredDocument { version: 1; since: number; slots: Record<string, StoredSlot> }

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
const name = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;

/**
 * Read back what was stored, defensively: the document is our own, but it comes
 * from a store an operator's other tooling can reach, so nothing is trusted and
 * nothing hostile is copied through to an answer.
 */
function parseDocument(raw: unknown, now: number): StoredDocument | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as { version?: unknown; since?: unknown; slots?: unknown };
  if (value.version !== 1) return null;
  const since = value.since;
  if (typeof since !== 'number' || !Number.isSafeInteger(since) || since < 0 || since > now
    || now - since >= SLOT_GOVERNANCE_HORIZON_MS) return null;
  const slots: Record<string, StoredSlot> = {};
  const stored = value.slots;
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return { version: 1, since, slots };
  for (const [slot, entry] of Object.entries(stored as Record<string, unknown>)) {
    if (Object.keys(slots).length >= MAX_SLOTS) break;
    if (name(slot, 128) === null || !entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const row = entry as { refusedPinCount?: unknown; refusedPins?: unknown; shortTakeCount?: unknown; shortTakePositions?: unknown;
      unreturnedPinCount?: unknown; unreturnedPins?: unknown };
    const refusedPins: StoredSlot['refusedPins'] = [];
    if (Array.isArray(row.refusedPins)) {
      for (const pin of row.refusedPins as unknown[]) {
        if (refusedPins.length >= MAX_PINS_PER_SLOT) break;
        if (!pin || typeof pin !== 'object' || Array.isArray(pin)) continue;
        const candidate = pin as { pinnedPieceId?: unknown; reason?: unknown; count?: unknown };
        const pinnedPieceId = name(candidate.pinnedPieceId, MAX_ID_LENGTH), reason = name(candidate.reason, MAX_REASON_LENGTH);
        if (pinnedPieceId === null || reason === null) continue;
        refusedPins.push({ pinnedPieceId, reason, count: count(candidate.count) });
      }
    }
    slots[slot] = { refusedPinCount: count(row.refusedPinCount), refusedPins,
      shortTakeCount: count(row.shortTakeCount), shortTakePositions: count(row.shortTakePositions),
      ...(row.unreturnedPinCount !== undefined || row.unreturnedPins !== undefined
        ? { unreturnedPinCount: count(row.unreturnedPinCount), unreturnedPins: parseUnreturned(row.unreturnedPins) } : {}) };
  }
  return { version: 1, since, slots };
}

/** P47: the stored unreturned pins, each rebuilt with its keys sorted; one that cannot be named whole is dropped. */
function parseUnreturned(value: unknown): UnreturnedPin[] {
  const pins: UnreturnedPin[] = [];
  if (!Array.isArray(value)) return pins;
  for (const pin of value as unknown[]) {
    if (pins.length >= MAX_PINS_PER_SLOT) break;
    if (!pin || typeof pin !== 'object' || Array.isArray(pin)) continue;
    const candidate = pin as { count?: unknown; pinnedPieceId?: unknown; within?: unknown };
    const named = unreturnedName(candidate.pinnedPieceId, candidate.within);
    if (named) pins.push({ count: count(candidate.count), ...named });
  }
  return pins;
}

/** P47: a pin's piece, module and layout slot, each a name this document stores, or `null` when any is not. */
function unreturnedName(pinnedPieceIdValue: unknown, withinValue: unknown): Omit<UnreturnedPin, 'count'> | null {
  const pinnedPieceId = name(pinnedPieceIdValue, MAX_ID_LENGTH);
  if (pinnedPieceId === null || !withinValue || typeof withinValue !== 'object' || Array.isArray(withinValue)) return null;
  const within = withinValue as { module?: unknown; slot?: unknown };
  const module = name(within.module, MAX_ID_LENGTH), slot = name(within.slot, 128);
  return module === null || slot === null ? null : { pinnedPieceId, within: { module, slot } };
}

async function loadDocument(env: Pick<Env, 'CACHE'>, tenant: string, now: number): Promise<StoredDocument | null> {
  const raw: unknown = await env.CACHE.get(slotGovernanceKey(tenant), 'json');
  return parseDocument(raw, now);
}

/**
 * What an operator surface reports for this tenant, or `null` when the counter
 * store could not be read (W20 R4). A slot that is absent from a document that
 * WAS read has zero occurrences, not an absent block, so the caller fills every
 * slot it lists with `emptySlotGovernance(view.since)`; a store that could not
 * be read observed nothing, and the caller says so instead of stating zeros —
 * the operator slots page names the outage on every block, and the monitor
 * drops its member.
 *
 * Never throws.
 */
export async function observeSlotGovernance(env: Pick<Env, 'CACHE'>, tenant: string, now: number): Promise<SlotGovernanceView | null> {
  try { return viewOf(await loadDocument(env, tenant, now), now); } catch { return null; }
}

/**
 * The counts alone, for a caller that has no outage to report: an unreadable
 * store reads as zeros at a horizon of now. No operator surface uses this —
 * they read `observeSlotGovernance`, which tells the two apart.
 */
export async function readSlotGovernance(env: Pick<Env, 'CACHE'>, tenant: string, now: number): Promise<SlotGovernanceView> {
  return await observeSlotGovernance(env, tenant, now) ?? viewOf(null, now);
}

function viewOf(document: StoredDocument | null, now: number): SlotGovernanceView {
  const since = document?.since ?? now;
  const bySlot = new Map<string, SlotGovernance>();
  let refusedPinCount = 0, shortTakeCount = 0, unreturnedPinCount = 0, unreturnedCounted = false;
  for (const [slot, entry] of Object.entries(document?.slots ?? {})) {
    bySlot.set(slot, { since, scope: SLOT_GOVERNANCE_SCOPE, refusedPinCount: entry.refusedPinCount,
      refusedPins: entry.refusedPins.map(pin => ({ ...pin })),
      shortTakeCount: entry.shortTakeCount, shortTakePositions: entry.shortTakePositions,
      unreturnedPinCount: entry.unreturnedPinCount ?? 0,
      unreturnedPins: (entry.unreturnedPins ?? []).map(pin => ({ count: pin.count, pinnedPieceId: pin.pinnedPieceId,
        within: { module: pin.within.module, slot: pin.within.slot } })) });
    refusedPinCount += entry.refusedPinCount;
    shortTakeCount += entry.shortTakeCount;
    if (entry.unreturnedPinCount !== undefined) { unreturnedCounted = true; unreturnedPinCount += entry.unreturnedPinCount; }
  }
  return { since, scope: SLOT_GOVERNANCE_SCOPE, bySlot, refusedPinCount, shortTakeCount,
    ...(unreturnedCounted ? { unreturnedPinCount } : {}) };
}

/**
 * The tenant-level counter the ops monitor answers with: the same counts the
 * operator slots page reads, summed over the tenant's slots — never a value the
 * synthetic probe produced. `undefined` when the store could not be read, so a
 * monitor result never states a zero it did not observe.
 */
export async function tenantSlotGovernance(env: Pick<Env, 'CACHE'>, tenant: string, now: number): Promise<TenantSlotGovernance | undefined> {
  const view = await observeSlotGovernance(env, tenant, now);
  return view ? { since: view.since, scope: view.scope, refusedPinCount: view.refusedPinCount, shortTakeCount: view.shortTakeCount,
    ...(view.unreturnedPinCount !== undefined ? { unreturnedPinCount: view.unreturnedPinCount } : {}) } : undefined;
}

/**
 * Add one page load's occurrences. Called fire and forget from the decision
 * path after the answer is produced; it resolves whatever happens, so no
 * failure of this diagnostic can reach a shopper's decision.
 */
export async function recordSlotGovernance(
  env: Pick<Env, 'CACHE'>, tenant: string, occurrences: SlotGovernanceOccurrences, now: number,
): Promise<void> {
  try {
    const unreturned = occurrences.unreturnedPins ?? [];
    if (!occurrences.refusedPins.length && !occurrences.shortTakes.length && !unreturned.length) return;
    const previous = await loadDocument(env, tenant, now);
    const document: StoredDocument = previous ?? { version: 1, since: now, slots: {} };
    const slotOf = (slot: string): StoredSlot | null => {
      const existing = document.slots[slot];
      if (existing) return existing;
      if (Object.keys(document.slots).length >= MAX_SLOTS) return null;
      const created: StoredSlot = { refusedPinCount: 0, refusedPins: [], shortTakeCount: 0, shortTakePositions: 0 };
      document.slots[slot] = created;
      return created;
    };
    for (const refusal of occurrences.refusedPins) {
      const slot = name(refusal.slot, 128) === null ? null : slotOf(refusal.slot);
      if (!slot) continue;
      slot.refusedPinCount += 1;
      const pinnedPieceId = name(refusal.pinnedPieceId, MAX_ID_LENGTH), reason = name(refusal.reason, MAX_REASON_LENGTH);
      if (pinnedPieceId === null || reason === null) continue;   // counted, not named: the count is never wrong
      const named = slot.refusedPins.find(pin => pin.pinnedPieceId === pinnedPieceId && pin.reason === reason);
      if (named) named.count += 1;
      else if (slot.refusedPins.length < MAX_PINS_PER_SLOT) slot.refusedPins.push({ pinnedPieceId, reason, count: 1 });
    }
    for (const shortfall of occurrences.shortTakes) {
      const slot = name(shortfall.slot, 128) === null ? null : slotOf(shortfall.slot);
      if (!slot) continue;
      slot.shortTakeCount += 1;
      slot.shortTakePositions += count(shortfall.empty);
    }
    // P47 (R-P78): a pin left reserved and unserved because its module was not
    // returned refuses nothing; it is counted apart, per page load as a refusal
    // is, and named with its module and layout slot, never in `refusedPins`.
    for (const pin of unreturned) {
      const slot = name(pin.slot, 128) === null ? null : slotOf(pin.slot);
      if (!slot) continue;
      slot.unreturnedPinCount = (slot.unreturnedPinCount ?? 0) + 1;
      const pins = slot.unreturnedPins ??= [];
      const named = unreturnedName(pin.pinnedPieceId, pin.within);
      if (named === null) continue;   // counted, not named, as a refusal is
      const seen = pins.find(p => p.pinnedPieceId === named.pinnedPieceId && p.within.module === named.within.module && p.within.slot === named.within.slot);
      if (seen) seen.count += 1;
      else if (pins.length < MAX_PINS_PER_SLOT) pins.push({ count: 1, ...named });
    }
    // The counts are never dropped to stay inside the budget; the NAMES are.
    // A tenant whose document would outgrow the cap keeps every occurrence
    // counted and loses the per-pin sample first, so the operator still sees
    // that the slot is refusing and how often.
    const bytes = new TextEncoder();
    let body = JSON.stringify(document);
    for (const cap of [3, 0]) {
      if (bytes.encode(body).byteLength <= MAX_BYTES) break;
      for (const slot of Object.values(document.slots)) {
        if (slot.refusedPins.length > cap) slot.refusedPins.length = cap;
        if (slot.unreturnedPins && slot.unreturnedPins.length > cap) slot.unreturnedPins.length = cap;
      }
      body = JSON.stringify(document);
    }
    if (bytes.encode(body).byteLength > MAX_BYTES) return;   // the last state stands; nothing unbounded is written
    await env.CACHE.put(slotGovernanceKey(tenant), body,
      { expirationTtl: Math.floor(SLOT_GOVERNANCE_HORIZON_MS / 1000) });
  } catch { /* a diagnostic counter never fails a decision, and never retries on the shopper's time */ }
}
