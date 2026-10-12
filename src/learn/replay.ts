// src/learn/replay.ts
// Doc 22 §12.3. Given a decision record, fetch what produced it (the catalog,
// slots and learn documents at the recorded revisions, the lift snapshot at the
// recorded version from the archive, the interest vector and model scores the
// record carries) and decide again. Equality is the proof that the engine is
// deterministic and that the receipt is the truth rather than a narrative
// about it. A record from before Phase 3 has no inputs block and no document
// revisions; the replay says so instead of guessing.

import type { Env } from '@/types/env';
import { requireRetention } from '@/retention';
import { readVersion, type DocumentKind } from '@/config/versionedStore';
import { CONTENT_KIND, DEFAULT_LEARN, DEFAULT_SLOTS, EMPTY_CATALOG, LEARN_KIND, pageScopedSlotNames, SLOTS_KIND } from '@/content/kinds';
import { BLEND_RULES, contextOnlySlots, decideContent, LAYOUT_RULES, layoutBlendOf, MODULE_RULES, ORDER_RULES, SIGNAL_FLOOR_RULES } from '@/content/decide';
import { HISTORICAL_EXPLORATION, HISTORICAL_EXPLORATION_RULES, recordedExplorationRules } from '@/learn/explore';
import { HISTORICAL_PINS, HISTORICAL_PINS_V1, HISTORICAL_GOVERNANCE, HISTORICAL_GOVERNANCE_V1 } from '@/reflex/contentCompose';
import { slotPins, rankedCapacity } from '@/content/slotConstraints';
import { HISTORICAL_CONTENT_TYPES } from '@/content/typeAffinity';
import { isEligibleAt } from '@/content/lifecycle';
import { isEventNonce, isEventTimestamp } from '@/events/actionTypes';
import { validDecisionMeasurement } from '@/ledger/records';
import type { ContentCatalog, DecisionInputs, DecisionRecord, LearnConfig, SlotCatalog, SlotStrategy } from '@/content/types';
import { liftArchiveKey } from './fan';
import type { LiftSnapshot } from './stats';

export interface ReplayDiff { field: string; served: unknown; replayed: unknown }
/**
 * What KIND of answer a replay is. A bare `equal: false` cannot be triaged: a
 * receipt whose served item is right and whose candidate list drifted is not
 * the same event as a receipt that served a different item, and neither is a
 * record this build cannot replay at all. Total, and derived from `diff` alone
 * so it can never disagree with the comparison it summarizes.
 */
export type ReplayClassification = 'equal' | 'item' | 'candidates-only' | 'explanation' | 'not-replayable';
export interface ReplayResult {
  ok: boolean;
  equal: boolean;
  classification: ReplayClassification;
  reason?: string;
  diff: ReplayDiff[];
  served: DecisionRecord;
  replayed: DecisionRecord | null;
  used: { catalog: number; slots: number; learn: number; lift: number; prior: number } | null;
}

/** The one derivation of {@link ReplayClassification}: no caller states a class of its own. */
export function classifyReplay(ok: boolean, diff: ReplayDiff[]): ReplayClassification {
  if (!ok) return 'not-replayable';
  if (diff.length === 0) return 'equal';
  if (diff.some(entry => entry.field === 'item_id')) return 'item';
  if (diff.every(entry => entry.field === 'candidates')) return 'candidates-only';
  return 'explanation';
}

/**
 * W27 R5: a compared value as JSON text in which key order is not a value. A
 * record admitted through the recovery path is stored with every object's keys
 * sorted (`recoveryJSON`, src/ledger/recovery.ts) while the replay builds its
 * record in insertion order, so comparing plain `JSON.stringify` text reported
 * equal values as an explanation difference. Every plain object is written with
 * its keys in one order; an array keeps its own order, because drivers and
 * candidates are ranked lists and another order is another value. Everything
 * else is `JSON.stringify`'s own reading, as before (an undefined member is
 * absent, a non-finite number is null).
 */
function valueJSON(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item !== null && typeof item === 'object' && !Array.isArray(item)
    && (Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, (item as Record<string, unknown>)[key]]))
    : item);
}

/**
 * What a replay may legitimately differ on: nothing. These are the fields compared, in the order a reader wants them.
 * Each field is compared by value ({@link valueJSON}), and a difference carries both values as the records hold them.
 */
export function compareRecords(served: DecisionRecord, replayed: DecisionRecord): ReplayDiff[] {
  const diff: ReplayDiff[] = [];
  const eq = (field: string, a: unknown, b: unknown) => { if (valueJSON(a ?? null) !== valueJSON(b ?? null)) diff.push({ field, served: a ?? null, replayed: b ?? null }); };
  eq('decision_id', served.decision_id, replayed.decision_id);
  eq('request_id', served.request_id, replayed.request_id);
  eq('measurementBasis', served.measurementBasis ?? 'served-v1', replayed.measurementBasis ?? 'served-v1');
  eq('rendered', served.rendered, replayed.rendered);
  eq('item_id', served.item_id, replayed.item_id);
  if (served.inputs?.replay?.pins === 'prefix-reserved-v2') eq('ranking_position', served.ranking_position, replayed.ranking_position);
  eq('explored', served.explored, replayed.explored);
  eq('authority', served.authority, replayed.authority);
  eq('explain.exploration', served.explain.exploration, replayed.explain.exploration);
  eq('explain.score_base', served.explain.score_base, replayed.explain.score_base);
  eq('explain.score_final', served.explain.score_final, replayed.explain.score_final);
  eq('explain.lift', served.explain.lift, replayed.explain.lift);
  eq('explain.external', served.explain.external, replayed.explain.external);
  eq('explain.drivers', served.explain.drivers, replayed.explain.drivers);
  eq('candidates', served.candidates, replayed.candidates);
  // P01: the configured order a position was set by, compared by value like every explain member.
  eq('explain.configuredOrder', served.explain.configuredOrder, replayed.explain.configuredOrder);
  // P28: the layout blend's terms, compared by value like every explain member (and built with sorted keys).
  eq('explain.blend', served.explain.blend, replayed.explain.blend);
  // P10: the signal floor a context-only position was decided under and the count, by value (keys sorted).
  eq('explain.signalFloor', served.explain.signalFloor, replayed.explain.signalFloor);
  // P07: the context prior's itemisation, by value (keys sorted); absent on both for a record decided without it.
  eq('explain.contextPrior', served.explain.contextPrior, replayed.explain.contextPrior);
  // P04: the rule that placed a module and the position it set, by value (keys sorted); absent on both for any other record.
  eq('explain.moduleRule', served.explain.moduleRule, replayed.explain.moduleRule);
  return diff;
}

export interface ReplayDeps {
  doc<T>(kind: DocumentKind<T>, scope: string, revision: number): Promise<T | null>;
  /**
   * W26 R2 (amendment A49): `page` is passed only for a slot name the recorded
   * catalogue carries on more than one page, whose snapshots are archived under
   * that page's own placement (`liftArchiveKey`, src/learn/fan.ts).
   */
  archive(tenant: string, brand: string, slot: string, version: number, page?: string): Promise<LiftSnapshot | null>;
}
class ReplayDependencyError extends Error {}

export function replayDeps(env: Env): ReplayDeps {
  return {
    doc: async (kind, scope, revision) => {
      const retained = await readVersion(env, kind, scope, revision);
      if (retained && retained.revision !== revision) throw new ReplayDependencyError(`configuration dependency ${kind.name}/${revision} has a mismatched revision`);
      return retained?.value ?? null;
    },
    // An archive that could not be read is not an archive that is gone. A
    // transport failure or a body that will not parse is a live fault an
    // operator can act on; reporting it as a permanent absence is a guess, and
    // the wrong one (F22 §7.2). The private failure text never leaves here: the
    // caller writes the operator-visible sentence for both diagnoses.
    archive: async (tenant, brand, slot, version, page) => {
      const unreadable = new ReplayDependencyError(`lift dependency ${slot}/${version} could not be read`);
      let object: R2ObjectBody | null;
      try { object = await env.STORAGE.get(liftArchiveKey(tenant, brand, slot, version, page)); }
      catch { throw unreadable; }
      if (!object) return null;
      try { return (await object.json()) as LiftSnapshot; }
      catch { throw unreadable; }
    },
  };
}

const fail = (served: DecisionRecord, reason: string): ReplayResult =>
  ({ ok: false, equal: false, classification: 'not-replayable', reason, diff: [], served, replayed: null, used: null });
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const identity = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value) && value >= 0;
type Manifest = NonNullable<DecisionInputs['replay']>;
/** The page manifest grammar this build implements. A record written at a later one is a rollout event. */
const MANIFEST_VERSION = 1;

/**
 * A manifest a later build wrote is refused for a reason that NAMES the version
 * it was handed, instead of being pooled with a corrupt record: rollout is only
 * a mechanism if an operator can tell "this build is behind that record" from
 * "this record is damaged". Only a nonnegative safe integer above the version
 * implemented here qualifies; every other `version` fails the recorded-identity
 * rule and keeps `invalid page replay manifest`, so nothing arbitrary a record
 * carries is interpolated into an operator-visible sentence.
 *
 * W27 R3 (amendment A22): claiming a later version does not excuse damage this
 * build CAN recognize. A slot row's `lift` and `prior` are dependency
 * identities, and every recorded identity is a nonnegative safe integer
 * whatever grammar carries it (kit 02, "nonnegative safe-integer … identities
 * before dependency reads"). So a present `lift` or `prior` that is anything
 * else — a negative, a fraction, a non-finite number, one past the safe-integer
 * range, a string, `null`, a boolean, an object or an array — is corrupt at any
 * version and keeps `invalid page replay manifest`, before any archive is read.
 * A later-version manifest whose identities are all sound keeps the rollout
 * sentence.
 */
function manifestVersionRefusal(value: unknown): string | null {
  if (!object(value) || !identity(value.version) || value.version <= MANIFEST_VERSION) return null;
  if (Array.isArray(value.slots) && value.slots.some(row => object(row)
    && ['lift', 'prior'].some(key => own(row, key) && !identity(row[key])))) return null;
  return `page replay manifest version ${value.version} is not supported`;
}

function manifestOf(value: unknown, page: SlotStrategy[], served: DecisionRecord, learn: LearnConfig, floor: { tenant: number; signals: unknown }): Manifest | null {
  if (!object(value) || Object.keys(value).filter(key => key !== 'exploration' && key !== 'pins' && key !== 'contentTypes' && key !== 'governance' && key !== 'layout' && key !== 'orders' && key !== 'blend' && key !== 'signalFloor' && key !== 'moduleRules').sort().join(',') !== 'candidateLimit,learning,slots,version'
    || (own(value, 'exploration') && value.exploration !== 'supported-only')
    || (own(value, 'pins') && value.pins !== 'reserved-eligible-v1' && value.pins !== 'prefix-reserved-v2')
    || (own(value, 'contentTypes') && value.contentTypes !== 'catalog-tags-v1')
    || (own(value, 'governance') && value.governance !== 'slot-gates-v1' && value.governance !== 'slot-gates-v2')
    // P02: the layout marker is written only for a page that declares a layout
    // slot, so a marker over a page revision that declares none is inconsistent.
    || (own(value, 'layout') && (value.layout !== LAYOUT_RULES || !page.some(slot => slot.layout === true)))
    // P01: the orders marker is written only on a decision a configured order
    // served, which only a declared layout slot carrying orders can do.
    || (own(value, 'orders') && (value.orders !== ORDER_RULES || !own(value, 'layout')
      || !page.some(slot => slot.layout === true && Array.isArray(slot.orders) && slot.orders.length > 0)))
    // P28: the blend marker is written only on a decision the learning layer made
    // on which a declared layout slot ranked by the blend its learn dials opt into.
    || (own(value, 'blend') && (value.blend !== BLEND_RULES || !own(value, 'layout') || value.learning !== true
      || !page.some(slot => slot.layout === true && layoutBlendOf(learn, slot.slot) !== null)))
    // P10: the signal-floor marker is written only on a decision of an arm that
    // personalizes on which a slot of the page was below its floor, with the
    // count it was decided with beside it; a marker no floor of the recorded
    // revision explains, or one without a whole count, is inconsistent.
    || (own(value, 'signalFloor') && (value.signalFloor !== SIGNAL_FLOOR_RULES || served.arm === 'default'
      || !(typeof floor.signals === 'number' && Number.isSafeInteger(floor.signals) && floor.signals >= 0)
      || contextOnlySlots(page, { floor: floor.tenant, signals: floor.signals }, served.arm).size === 0))
    // P04: the module-rules marker is written only on a decision under the
    // current pin policy on which a position pin or an off-limits mark of the
    // page's declared layout slot decided something.
    || (own(value, 'moduleRules') && (value.moduleRules !== MODULE_RULES || !own(value, 'layout') || value.pins !== 'prefix-reserved-v2'
      || !page.some(slot => slot.layout === true && Boolean(slot.positionPins?.length || slot.offLimitsPieceIds?.length))))
    || value.version !== MANIFEST_VERSION || typeof value.learning !== 'boolean' || !finite(value.candidateLimit)
    || !Array.isArray(value.slots) || value.slots.length !== page.length || (served.arm === 'default' && value.learning)) return null;
  const seen = new Set<string>(), rows: Manifest['slots'] = [];
  for (const [index, row] of Array.from(value.slots).entries()) {
    if (!object(row) || Object.keys(row).sort().join(',') !== 'lift,prior,slot' || typeof row.slot !== 'string'
      || row.slot !== page[index]!.slot || seen.has(row.slot) || !identity(row.lift) || !identity(row.prior)
      || (row.lift === 0 && row.prior !== 0) || ((!value.learning || page[index]!.pinnedPieceId
        || (value.pins === 'prefix-reserved-v2' && rankedCapacity({ ...page[index]!, offLimits: false }) === 0)
        || (own(value, 'governance') && page[index]!.offLimits)) && (row.lift !== 0 || row.prior !== 0))) return null;
    seen.add(row.slot); rows.push({ slot: row.slot, lift: row.lift, prior: row.prior });
  }
  const target = rows.find(row => row.slot === served.slot);
  const configured = page.find(slot => slot.slot === served.slot);
  if (!target || !configured) return null;
  const prefixPolicy = value.pins === 'prefix-reserved-v2';
  const ids = prefixPolicy ? slotPins(configured) : [];
  const pinPosition = prefixPolicy && served.position < ids.length;
  // P04: under the module-rules marker a position after the prefix may hold a
  // module a position pin or an off-limits mark placed — authority `pin`, the
  // rule and its position on the record and consistent with the revision, no
  // ranking ordinal and no snapshot — and a ranked position's ordinal counts
  // the ranked positions before it, which those fixed positions do not join;
  // the replay decides the page again and compares both.
  const ruled = own(value, 'moduleRules');
  const rule = ruled && served.authority === 'pin' && !pinPosition ? served.explain?.moduleRule as unknown : undefined;
  const fixedPosition = rule !== undefined;
  if (prefixPolicy) {
    if (!identity(served.position) || served.position >= configured.take) return null;
    if (pinPosition) {
      if (served.authority !== 'pin' || served.item_id !== ids[served.position] || own(served, 'ranking_position') || served.versions.lift !== 0 || served.versions.prior !== 0) return null;
    } else if (fixedPosition) {
      if (!object(rule) || Object.keys(rule).sort().join(',') !== 'position,rule' || !identity(rule.position) || rule.position <= ids.length || rule.position > configured.take
        || (rule.rule === 'pinned' ? !(configured.positionPins ?? []).some(pin => pin.pieceId === served.item_id && pin.position === rule.position)
          : rule.rule !== 'off_limits' || !(configured.offLimitsPieceIds ?? []).includes(served.item_id))
        || own(served, 'ranking_position') || served.versions.lift !== 0 || served.versions.prior !== 0) return null;
    } else if (served.authority === 'pin' || !identity(served.ranking_position) || served.ranking_position > 49
      || (ruled ? served.ranking_position > served.position - ids.length : served.ranking_position !== served.position - ids.length)) return null;
  }
  if (!pinPosition && !fixedPosition && (target.lift !== served.versions.lift || target.prior !== served.versions.prior)) return null;
  return { version: 1, learning: value.learning, candidateLimit: value.candidateLimit, slots: rows,
    ...(own(value, 'exploration') ? { exploration: 'supported-only' as const } : {}),
    ...(own(value, 'pins') ? { pins: value.pins as NonNullable<Manifest['pins']> } : {}),
    ...(own(value, 'contentTypes') ? { contentTypes: 'catalog-tags-v1' as const } : {}),
    ...(own(value, 'governance') ? { governance: value.governance as NonNullable<Manifest['governance']> } : {}),
    ...(own(value, 'layout') ? { layout: LAYOUT_RULES } : {}),
    ...(own(value, 'orders') ? { orders: ORDER_RULES } : {}),
    ...(own(value, 'blend') ? { blend: BLEND_RULES } : {}),
    ...(own(value, 'signalFloor') ? { signalFloor: SIGNAL_FLOOR_RULES } : {}),
    ...(ruled ? { moduleRules: MODULE_RULES } : {}) };
}

/** A slot as a page decided before the layout declaration existed reads it: without the declaration. */
const undeclared = (slot: SlotStrategy): SlotStrategy => {
  if (slot.layout === undefined) return slot;
  const { layout: _layout, ...rest } = slot; void _layout;
  return rest;
};
/** P01: a slot as a decision that served no configured order reads it: without its orders. */
const unordered = (slot: SlotStrategy): SlotStrategy => {
  if (slot.orders === undefined) return slot;
  const { orders: _orders, ...rest } = slot; void _orders;
  return rest;
};

/** P04: a slot as a decision on which no position pin or off-limits mark decided anything reads it: without them. */
const unruled = (slot: SlotStrategy): SlotStrategy => {
  if (slot.positionPins === undefined && slot.offLimitsPieceIds === undefined) return slot;
  const { positionPins: _pins, offLimitsPieceIds: _marks, ...rest } = slot; void _pins; void _marks;
  return rest;
};

/** Identity and the numeric structure consumed by lift/exploration, not a new archive schema. */
function usableSnapshot(value: unknown, served: DecisionRecord, row: Manifest['slots'][number]): value is LiftSnapshot {
  if (!object(value) || value.tenant !== served.tenant || value.brand !== served.brand || value.slot !== row.slot
    || value.version !== row.lift || (value.priorVersion ?? 0) !== row.prior || typeof value.reward !== 'string' || !value.reward
    || !finite(value.n0) || value.n0 < 0 || !finite(value.nMin) || value.nMin < 0 || !object(value.items) || !object(value.slotRates)) return false;
  for (const levels of Object.values(value.items)) {
    if (!object(levels)) return false;
    for (const stat of Object.values(levels)) {
      if (!object(stat) || !identity(stat.level) || stat.level > 5 || typeof stat.key !== 'string'
        || !['n', 's', 'p0', 'p_hat', 'lift'].every(key => finite(stat[key]) && stat[key] >= 0)
        || (own(stat, 'n0') && !finite(stat.n0))
        || (own(stat, 'prior') && (!object(stat.prior) || !finite(stat.prior.p) || !finite(stat.prior.n)))) return false;
    }
  }
  return true;
}

export async function replayDecision(env: Env, served: DecisionRecord, deps: ReplayDeps = replayDeps(env)): Promise<ReplayResult> {
  requireRetention(env, served.retention?.ledger, served.tenant, 'ledger');
  const result = await replayAdmitted(env, served, deps);
  requireRetention(env, served.retention?.ledger, served.tenant, 'ledger');
  return result;
}
async function replayAdmitted(env: Env, served: DecisionRecord, deps: ReplayDeps): Promise<ReplayResult> {
  if (!validDecisionMeasurement(served)) return fail(served, 'invalid measurement basis');
  const hasNonce = Object.prototype.hasOwnProperty.call(served, 'request_id');
  if (hasNonce && (!isEventNonce(served.request_id) || !isEventTimestamp(served.ts))) return fail(served, 'invalid decision identity');
  const baseId = `${served.tenant}:${served.ts.toString(36)}:${served.visitor_id}:${served.page}:${served.slot}:${served.position}`;
  if (served.decision_id !== `${baseId}${hasNonce ? `:n1:${served.request_id}` : ''}`) return fail(served, 'inconsistent decision identity');
  const v = served.versions;
  if (!object(v)) return fail(served, 'invalid replay versions tuple');
  if (!['catalog', 'slots', 'learn'].every(key => own(v, key))) return fail(served, 'the record predates the versions tuple: the documents it was decided on cannot be identified');
  if (v.catalog === undefined || v.slots === undefined || v.learn === undefined) return fail(served, 'invalid replay versions tuple');
  if (!['catalog', 'slots', 'learn', 'lift', 'prior'].every(key => own(v, key) && identity(v[key]))) return fail(served, 'invalid replay versions tuple');
  if (!served.inputs) return fail(served, 'the record carries no inputs block');
  const scope = served.tenant;
  let documents: [ContentCatalog | null, SlotCatalog | null, LearnConfig | null];
  try { documents = await Promise.all([
    v.catalog > 0 ? deps.doc<ContentCatalog>(CONTENT_KIND, scope, v.catalog) : Promise.resolve(EMPTY_CATALOG),
    v.slots > 0 ? deps.doc<SlotCatalog>(SLOTS_KIND, scope, v.slots)
      : Promise.resolve(object(served.inputs.replay) && own(served.inputs.replay, 'governance') ? { pages: {} } : DEFAULT_SLOTS),
    v.learn > 0 ? deps.doc<LearnConfig>(LEARN_KIND, scope, v.learn) : Promise.resolve(DEFAULT_LEARN),
  ]); } catch (error) { return fail(served, error instanceof ReplayDependencyError ? error.message : 'recorded configuration dependency could not be read'); }
  requireRetention(env, served.retention?.ledger, served.tenant, 'ledger');
  const [catalog, slots, learn] = documents;
  if (!catalog) return fail(served, `catalog revision ${v.catalog} is not in the store`);
  if (!slots) return fail(served, `slots revision ${v.slots} is not in the store`);
  if (!learn) return fail(served, `learn revision ${v.learn} is not in the store`);
  if ((learn.slots?.[served.slot]?.measurementBasis ?? 'served-v1') !== (served.measurementBasis ?? 'served-v1')) return fail(served, 'recorded measurement basis differs from its configuration');
  const inputs = served.inputs;
  const page = slots.pages[served.page] ?? [], targetIndex = page.findIndex(slot => slot.slot === served.slot);
  if (targetIndex < 0) return fail(served, 'the recorded slot is absent from the page revision');
  const target = page[targetIndex]!;
  const hasManifest = own(inputs, 'replay');
  const manifest = hasManifest ? manifestOf(inputs.replay, page, served, learn, { tenant: slots.signalFloor ?? 0, signals: inputs.signals }) : null;
  if (hasManifest && !manifest) return fail(served, manifestVersionRefusal(inputs.replay) ?? 'invalid page replay manifest');
  // W28.R2 (amendment A20): the exploration rules the record was decided under
  // are the ones it STATES, beside the manifest (`inputs.explorationRules`). A
  // record that states none was written before them and replays under the rules
  // before; a marker this build does not implement refuses, before any archive
  // is read — never a guess, and never whichever rules happen to reproduce it.
  const rules = recordedExplorationRules(inputs);
  if (rules === 'invalid') return fail(served, 'invalid exploration rules marker');
  const prefixPolicy = manifest?.pins === 'prefix-reserved-v2';
  const pinned = prefixPolicy ? served.position < slotPins(target).length : Boolean(target.pinnedPieceId);
  const pinId = prefixPolicy ? slotPins(target)[served.position] : target.pinnedPieceId;
  if (pinned && !catalog.pieces.some(piece => piece.id === pinId && piece.id === served.item_id && isEligibleAt(piece, served.ts))) return fail(served, 'the recorded item is not the eligible catalog pin');
  const rankingSlots = prefixPolicy ? new Set(pinned ? [] : page.slice(0, targetIndex + 1).map(slot => slot.slot)) : undefined;
  const selected = prefixPolicy ? page : manifest?.pins === 'reserved-eligible-v1'
    ? page.filter((slot, index) => Boolean(slot.pinnedPieceId) || (!pinned && index <= targetIndex))
    : pinned ? [target] : page.slice(0, targetIndex + 1);
  let learning = manifest?.learning ?? false;
  if (!hasManifest && !pinned && served.arm !== 'default') {
    if (page.length !== 1) return fail(served, 'legacy personalized multi-slot record has no page replay manifest');
    if (!identity(v.lift) || !identity(v.prior) || (v.lift === 0 && v.prior !== 0)) return fail(served, 'invalid legacy snapshot identity');
    const dials = learn.slots?.[served.slot];
    if (v.lift === 0 && ((served.arm !== 'no_learning' && dials?.exploration && dials.exploration.mode !== 'off') || Object.keys(dials?.items ?? {}).length)) return fail(served, 'legacy zero-lift record has ambiguous learning choice settings');
    learning = v.lift > 0;
  }
  const dependencies = manifest?.slots.filter(row => rankingSlots ? rankingSlots.has(row.slot) : selected.some(slot => slot.slot === row.slot))
    ?? [{ slot: served.slot, lift: learning && !pinned ? v.lift : 0, prior: learning && !pinned ? v.prior : 0 }];
  const snapshots: Record<string, LiftSnapshot | null> = Object.create(null) as Record<string, LiftSnapshot | null>;
  // W26 R2 (amendment A49): the serving path read each page-scoped slot's lift
  // from its own page's placement, as the catalogue it decided with said
  // (src/content/service.ts); that catalogue is the recorded revision read
  // above, so the replay reads the same page's archive, never the page-less one.
  const pageScoped = new Set(pageScopedSlotNames(slots));
  for (const row of dependencies) {
    if (row.lift === 0) { snapshots[row.slot] = null; continue; }
    let snapshot: LiftSnapshot | null;
    try { snapshot = await (pageScoped.has(row.slot)
      ? deps.archive(served.tenant, served.brand, row.slot, row.lift, served.page)
      : deps.archive(served.tenant, served.brand, row.slot, row.lift)); }
    catch { return fail(served, `lift dependency ${row.slot}/${row.lift} could not be read`); }
    requireRetention(env, served.retention?.ledger, served.tenant, 'ledger');
    if (!snapshot) return fail(served, `lift dependency ${row.slot}/${row.lift} is not in the archive`);
    if (!usableSnapshot(snapshot, served, row) || (snapshot.measurementBasis ?? 'served-v1') !== (learn.slots?.[row.slot]?.measurementBasis ?? 'served-v1')) return fail(served, `lift dependency ${row.slot}/${row.lift} has inconsistent identity, prior or structure`);
    snapshots[row.slot] = snapshot;
  }
  const regional = served.explain.regional && inputs.regional_share
    ? (({ contribution: _c, ...summary }) => ({ ...summary, share: inputs.regional_share! }))(served.explain.regional)
    : null;
  // P07: the context prior is already in the recorded interest vector; the record's
  // itemisation and the shares it carries let the replay itemise it again. A
  // record that carries no shares was decided without it and replays as before.
  const recordedContext = served.explain.contextPrior;
  const contextBlend = recordedContext && inputs.context_share
    ? { channel: recordedContext.channel, events: recordedContext.events, lambda: recordedContext.lambda, level: recordedContext.level,
      version: recordedContext.version, visitBucket: recordedContext.visitBucket, share: inputs.context_share }
    : null;
  const extCfg = learn.external ?? null;
  let set: ReturnType<typeof decideContent>;
  requireRetention(env, served.retention?.ledger, served.tenant, 'ledger');
  try { set = decideContent({
    ...(hasNonce ? { requestId: served.request_id } : {}),
    tenant: served.tenant, brand: served.brand, page: served.page, visitorId: served.visitor_id, sessionId: served.session_id,
    identityAnchor: served.identity_anchor, nowMs: served.ts,
    // P02: a record that states no layout marker is replayed as its page was
    // decided — without the declaration — whatever the revision carries.
    // P01: and a record that states no orders marker without the page's orders.
    // P04: and a record that states no module-rules marker without its position pins and off-limits marks.
    pieces: catalog.pieces, slots: (manifest?.layout === LAYOUT_RULES ? selected : selected.map(undeclared)).map(slot => manifest?.orders === ORDER_RULES ? slot : unordered(slot))
      .map(slot => manifest?.moduleRules === MODULE_RULES ? slot : unruled(slot)),
    ...(rankingSlots ? { replayRankingSlots: rankingSlots } : {}),
    affinity: { dims: inputs.affinity }, regional, ...(contextBlend ? { contextBlend } : {}), cell: served.cell, arm: served.arm,
    versions: { ...served.versions }, configLabel: served.config_label,
    candidateLimit: manifest?.candidateLimit ?? Math.max(10, served.candidates.length),
    learning: learning ? {
      snapshots,
      gammaOf: (slot) => learn.slots?.[slot]?.gamma ?? 0,
      exploreOf: (slot) => learn.slots?.[slot]?.exploration ?? null,
      controlOf: (slot, item) => learn.slots?.[slot]?.items?.[item] ?? null,
      metadataOf: (slot) => ({ reward: learn.slots?.[slot]?.reward ?? 'click', objective: learn.slots?.[slot]?.objective ?? 'unit', measurementBasis: learn.slots?.[slot]?.measurementBasis ?? 'served-v1' }),
      // P28: a record that states the blend marker is replayed with the blend its
      // learn revision opts into; one that states none, without it, which is
      // what that decision did.
      ...(manifest?.blend === BLEND_RULES ? { blendOf: (slot: string) => layoutBlendOf(learn, slot) } : {}),
    } : null,
    external: inputs.external
      ? { kind: extCfg?.kind ?? 'table', ref: extCfg?.ref ?? '', weightOf: (slot) => learn.slots?.[slot]?.external?.weight ?? 0, status: 'ok', version: inputs.external.version, scores: inputs.external.scores }
      : extCfg && served.explain.external && 'status' in served.explain.external
        ? { kind: extCfg.kind, ref: extCfg.ref, weightOf: (slot) => learn.slots?.[slot]?.external?.weight ?? 0, status: 'unavailable', reason: served.explain.external.reason }
        : null,
    served: inputs.served ?? null,
    // P10: a record that states the signal-floor marker is replayed with the
    // floor of its slots revision and the count it was decided with, its
    // context-only slots scored on the prior shares it recorded; one that
    // states none, with no floor, which is what that decision did.
    ...(manifest?.signalFloor === SIGNAL_FLOOR_RULES
      ? { signalFloor: { floor: slots.signalFloor ?? 0, signals: inputs.signals as number }, contextPrior: inputs.regional_share ?? null,
        // P07: and the context prior's recorded shares beside the region's, when it applied.
        contextBlendShare: inputs.context_share ?? null } : {}),
  }, manifest?.exploration === 'supported-only' ? undefined : HISTORICAL_EXPLORATION,
  prefixPolicy ? undefined : manifest?.pins === 'reserved-eligible-v1' ? HISTORICAL_PINS_V1 : HISTORICAL_PINS,
  manifest?.contentTypes === 'catalog-tags-v1' ? undefined : HISTORICAL_CONTENT_TYPES,
  manifest?.governance === 'slot-gates-v2' ? undefined : manifest?.governance === 'slot-gates-v1' ? HISTORICAL_GOVERNANCE_V1 : HISTORICAL_GOVERNANCE,
  rules === 'current' ? undefined : HISTORICAL_EXPLORATION_RULES); } catch { return fail(served, 'recorded replay inputs could not be evaluated'); }
  const replayed = set.records.find((r) => r.slot === served.slot && r.position === served.position) ?? null;
  // Rendering is an authenticated later observation, not a new ranking time.
  // Preserve that observation while recomputing the original decision inputs.
  if (replayed) {
    if (served.measurementBasis) replayed.measurementBasis = served.measurementBasis;
    if (served.rendered) replayed.rendered = { ...served.rendered };
    if (replayed.explain.lift && served.explain.lift) {
      if (served.explain.lift.measurementBasis === undefined) delete replayed.explain.lift.measurementBasis;
      if (served.explain.lift.objective === undefined) delete replayed.explain.lift.objective;
    }
  }
  if (replayed) replayed.retention = structuredClone(served.retention);
  // Prefix execution is an optimization, not a replacement page history.
  // Later slots may be the only users of a carried fatigue/model input.
  if (replayed?.inputs) {
    replayed.inputs = structuredClone(inputs);
    if (manifest) replayed.inputs.replay = manifest;
    else delete replayed.inputs.replay;
  }
  const used = { catalog: v.catalog, slots: v.slots, learn: v.learn, lift: snapshots[served.slot]?.version ?? 0, prior: snapshots[served.slot]?.priorVersion ?? 0 };
  if (!replayed) {
    const absent: ReplayDiff[] = [{ field: 'item_id', served: served.item_id, replayed: null }];
    return { ok: true, equal: false, classification: classifyReplay(true, absent), reason: 'the replay produced no decision for this slot and position', diff: absent, served, replayed: null, used };
  }
  const diff = compareRecords(served, replayed);
  return { ok: true, equal: diff.length === 0, classification: classifyReplay(true, diff), diff, served, replayed, used };
}
