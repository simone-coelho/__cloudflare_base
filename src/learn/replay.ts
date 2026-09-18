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
import { CONTENT_KIND, DEFAULT_LEARN, DEFAULT_SLOTS, EMPTY_CATALOG, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { decideContent } from '@/content/decide';
import { HISTORICAL_EXPLORATION } from '@/learn/explore';
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
export interface ReplayResult {
  ok: boolean;
  equal: boolean;
  reason?: string;
  diff: ReplayDiff[];
  served: DecisionRecord;
  replayed: DecisionRecord | null;
  used: { catalog: number; slots: number; learn: number; lift: number; prior: number } | null;
}

/** What a replay may legitimately differ on: nothing. These are the fields compared, in the order a reader wants them. */
export function compareRecords(served: DecisionRecord, replayed: DecisionRecord): ReplayDiff[] {
  const diff: ReplayDiff[] = [];
  const eq = (field: string, a: unknown, b: unknown) => { if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) diff.push({ field, served: a ?? null, replayed: b ?? null }); };
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
  return diff;
}

export interface ReplayDeps {
  doc<T>(kind: DocumentKind<T>, scope: string, revision: number): Promise<T | null>;
  archive(tenant: string, brand: string, slot: string, version: number): Promise<LiftSnapshot | null>;
}
class ReplayDependencyError extends Error {}

export function replayDeps(env: Env): ReplayDeps {
  return {
    doc: async (kind, scope, revision) => {
      const retained = await readVersion(env, kind, scope, revision);
      if (retained && retained.revision !== revision) throw new ReplayDependencyError(`configuration dependency ${kind.name}/${revision} has a mismatched revision`);
      return retained?.value ?? null;
    },
    archive: async (tenant, brand, slot, version) => {
      try {
        const obj = await env.STORAGE.get(liftArchiveKey(tenant, brand, slot, version));
        return obj ? ((await obj.json()) as LiftSnapshot) : null;
      } catch { return null; }
    },
  };
}

const fail = (served: DecisionRecord, reason: string): ReplayResult => ({ ok: false, equal: false, reason, diff: [], served, replayed: null, used: null });
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const identity = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value) && value >= 0;
type Manifest = NonNullable<DecisionInputs['replay']>;

function manifestOf(value: unknown, page: SlotStrategy[], served: DecisionRecord): Manifest | null {
  if (!object(value) || Object.keys(value).filter(key => key !== 'exploration' && key !== 'pins' && key !== 'contentTypes' && key !== 'governance').sort().join(',') !== 'candidateLimit,learning,slots,version'
    || (own(value, 'exploration') && value.exploration !== 'supported-only')
    || (own(value, 'pins') && value.pins !== 'reserved-eligible-v1' && value.pins !== 'prefix-reserved-v2')
    || (own(value, 'contentTypes') && value.contentTypes !== 'catalog-tags-v1')
    || (own(value, 'governance') && value.governance !== 'slot-gates-v1' && value.governance !== 'slot-gates-v2')
    || value.version !== 1 || typeof value.learning !== 'boolean' || !finite(value.candidateLimit)
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
  if (prefixPolicy) {
    if (!identity(served.position) || served.position >= configured.take) return null;
    if (pinPosition) {
      if (served.authority !== 'pin' || served.item_id !== ids[served.position] || own(served, 'ranking_position') || served.versions.lift !== 0 || served.versions.prior !== 0) return null;
    } else if (served.authority === 'pin' || !identity(served.ranking_position) || served.ranking_position > 49 || served.ranking_position !== served.position - ids.length) return null;
  }
  if (!pinPosition && (target.lift !== served.versions.lift || target.prior !== served.versions.prior)) return null;
  return { version: 1, learning: value.learning, candidateLimit: value.candidateLimit, slots: rows,
    ...(own(value, 'exploration') ? { exploration: 'supported-only' as const } : {}),
    ...(own(value, 'pins') ? { pins: value.pins as NonNullable<Manifest['pins']> } : {}),
    ...(own(value, 'contentTypes') ? { contentTypes: 'catalog-tags-v1' as const } : {}),
    ...(own(value, 'governance') ? { governance: value.governance as NonNullable<Manifest['governance']> } : {}) };
}

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
  const manifest = hasManifest ? manifestOf(inputs.replay, page, served) : null;
  if (hasManifest && !manifest) return fail(served, 'invalid page replay manifest');
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
  for (const row of dependencies) {
    if (row.lift === 0) { snapshots[row.slot] = null; continue; }
    let snapshot: LiftSnapshot | null;
    try { snapshot = await deps.archive(served.tenant, served.brand, row.slot, row.lift); }
    catch { return fail(served, `lift dependency ${row.slot}/${row.lift} could not be read`); }
    requireRetention(env, served.retention?.ledger, served.tenant, 'ledger');
    if (!snapshot) return fail(served, `lift dependency ${row.slot}/${row.lift} is not in the archive`);
    if (!usableSnapshot(snapshot, served, row) || (snapshot.measurementBasis ?? 'served-v1') !== (learn.slots?.[row.slot]?.measurementBasis ?? 'served-v1')) return fail(served, `lift dependency ${row.slot}/${row.lift} has inconsistent identity, prior or structure`);
    snapshots[row.slot] = snapshot;
  }
  const regional = served.explain.regional && inputs.regional_share
    ? (({ contribution: _c, ...summary }) => ({ ...summary, share: inputs.regional_share! }))(served.explain.regional)
    : null;
  const extCfg = learn.external ?? null;
  let set: ReturnType<typeof decideContent>;
  requireRetention(env, served.retention?.ledger, served.tenant, 'ledger');
  try { set = decideContent({
    ...(hasNonce ? { requestId: served.request_id } : {}),
    tenant: served.tenant, brand: served.brand, page: served.page, visitorId: served.visitor_id, sessionId: served.session_id,
    identityAnchor: served.identity_anchor, nowMs: served.ts,
    pieces: catalog.pieces, slots: selected,
    ...(rankingSlots ? { replayRankingSlots: rankingSlots } : {}),
    affinity: { dims: inputs.affinity }, regional, cell: served.cell, arm: served.arm,
    versions: { ...served.versions }, configLabel: served.config_label,
    candidateLimit: manifest?.candidateLimit ?? Math.max(10, served.candidates.length),
    learning: learning ? {
      snapshots,
      gammaOf: (slot) => learn.slots?.[slot]?.gamma ?? 0,
      exploreOf: (slot) => learn.slots?.[slot]?.exploration ?? null,
      controlOf: (slot, item) => learn.slots?.[slot]?.items?.[item] ?? null,
      metadataOf: (slot) => ({ reward: learn.slots?.[slot]?.reward ?? 'click', objective: learn.slots?.[slot]?.objective ?? 'unit', measurementBasis: learn.slots?.[slot]?.measurementBasis ?? 'served-v1' }),
    } : null,
    external: inputs.external
      ? { kind: extCfg?.kind ?? 'table', ref: extCfg?.ref ?? '', weightOf: (slot) => learn.slots?.[slot]?.external?.weight ?? 0, status: 'ok', version: inputs.external.version, scores: inputs.external.scores }
      : extCfg && served.explain.external && 'status' in served.explain.external
        ? { kind: extCfg.kind, ref: extCfg.ref, weightOf: (slot) => learn.slots?.[slot]?.external?.weight ?? 0, status: 'unavailable', reason: served.explain.external.reason }
        : null,
    served: inputs.served ?? null,
  }, manifest?.exploration === 'supported-only' ? undefined : HISTORICAL_EXPLORATION,
  prefixPolicy ? undefined : manifest?.pins === 'reserved-eligible-v1' ? HISTORICAL_PINS_V1 : HISTORICAL_PINS,
  manifest?.contentTypes === 'catalog-tags-v1' ? undefined : HISTORICAL_CONTENT_TYPES,
  manifest?.governance === 'slot-gates-v2' ? undefined : manifest?.governance === 'slot-gates-v1' ? HISTORICAL_GOVERNANCE_V1 : HISTORICAL_GOVERNANCE); } catch { return fail(served, 'recorded replay inputs could not be evaluated'); }
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
  if (!replayed) return { ok: true, equal: false, reason: 'the replay produced no decision for this slot and position', diff: [{ field: 'item_id', served: served.item_id, replayed: null }], served, replayed: null, used };
  const diff = compareRecords(served, replayed);
  return { ok: true, equal: diff.length === 0, diff, served, replayed, used };
}
