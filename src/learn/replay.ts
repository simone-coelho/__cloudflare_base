// src/learn/replay.ts
// Doc 22 §12.3. Given a decision record, fetch what produced it (the catalog,
// slots and learn documents at the recorded revisions, the lift snapshot at the
// recorded version from the archive, the interest vector and model scores the
// record carries) and decide again. Equality is the proof that the engine is
// deterministic and that the receipt is the truth rather than a narrative
// about it. A record from before Phase 3 has no inputs block and no document
// revisions; the replay says so instead of guessing.

import type { Env } from '@/types/env';
import { readVersion, type DocumentKind } from '@/config/versionedStore';
import { CONTENT_KIND, DEFAULT_LEARN, DEFAULT_SLOTS, EMPTY_CATALOG, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { decideContent } from '@/content/decide';
import type { ContentCatalog, DecisionRecord, LearnConfig, SlotCatalog } from '@/content/types';
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
  eq('item_id', served.item_id, replayed.item_id);
  eq('explored', served.explored, replayed.explored);
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

export function replayDeps(env: Env): ReplayDeps {
  return {
    doc: async (kind, scope, revision) => (await readVersion(env, kind, scope, revision))?.value ?? null,
    archive: async (tenant, brand, slot, version) => {
      try {
        const obj = await env.STORAGE.get(liftArchiveKey(tenant, brand, slot, version));
        return obj ? ((await obj.json()) as LiftSnapshot) : null;
      } catch { return null; }
    },
  };
}

const fail = (served: DecisionRecord, reason: string): ReplayResult => ({ ok: false, equal: false, reason, diff: [], served, replayed: null, used: null });

export async function replayDecision(env: Env, served: DecisionRecord, deps: ReplayDeps = replayDeps(env)): Promise<ReplayResult> {
  const v = served.versions;
  if (v.catalog === undefined || v.slots === undefined || v.learn === undefined) return fail(served, 'the record predates the versions tuple: the documents it was decided on cannot be identified');
  if (!served.inputs) return fail(served, 'the record carries no inputs block');
  const scope = served.tenant;
  const [catalog, slots, learn, snapshot] = await Promise.all([
    v.catalog > 0 ? deps.doc<ContentCatalog>(CONTENT_KIND, scope, v.catalog) : Promise.resolve(EMPTY_CATALOG),
    v.slots > 0 ? deps.doc<SlotCatalog>(SLOTS_KIND, scope, v.slots) : Promise.resolve(DEFAULT_SLOTS),
    v.learn > 0 ? deps.doc<LearnConfig>(LEARN_KIND, scope, v.learn) : Promise.resolve(DEFAULT_LEARN),
    v.lift > 0 ? deps.archive(served.tenant, served.brand, served.slot, v.lift) : Promise.resolve(null),
  ]);
  if (!catalog) return fail(served, `catalog revision ${v.catalog} is not in the store`);
  if (!slots) return fail(served, `slots revision ${v.slots} is not in the store`);
  if (!learn) return fail(served, `learn revision ${v.learn} is not in the store`);
  if (v.lift > 0 && !snapshot) return fail(served, `lift snapshot ${v.lift} is not in the archive (published before archiving began, or not yet written)`);
  if (snapshot && (snapshot.priorVersion ?? 0) !== v.prior) return fail(served, `the archived snapshot was built with prior revision ${snapshot.priorVersion ?? 0}, the record says ${v.prior}`);

  const dials = learn.slots?.[served.slot];
  const inputs = served.inputs;
  const regional = served.explain.regional && inputs.regional_share
    ? (({ contribution: _c, ...summary }) => ({ ...summary, share: inputs.regional_share! }))(served.explain.regional)
    : null;
  const extCfg = learn.external ?? null;
  const set = decideContent({
    tenant: served.tenant, brand: served.brand, page: served.page, visitorId: served.visitor_id, sessionId: served.session_id,
    identityAnchor: served.identity_anchor, nowMs: served.ts,
    pieces: catalog.pieces, slots: slots.pages[served.page] ?? [],
    affinity: { dims: inputs.affinity }, regional, cell: served.cell, arm: served.arm,
    versions: { ...served.versions }, configLabel: served.config_label,
    candidateLimit: Math.max(10, served.candidates.length),
    learning: {
      snapshots: { [served.slot]: snapshot },
      gammaOf: (slot) => learn.slots?.[slot]?.gamma ?? 0,
      exploreOf: (slot) => learn.slots?.[slot]?.exploration ?? null,
      controlOf: (slot, item) => learn.slots?.[slot]?.items?.[item] ?? null,
    },
    external: inputs.external
      ? { kind: extCfg?.kind ?? 'table', ref: extCfg?.ref ?? '', weightOf: (slot) => learn.slots?.[slot]?.external?.weight ?? 0, status: 'ok', version: inputs.external.version, scores: inputs.external.scores }
      : extCfg && served.explain.external && 'status' in served.explain.external
        ? { kind: extCfg.kind, ref: extCfg.ref, weightOf: (slot) => learn.slots?.[slot]?.external?.weight ?? 0, status: 'unavailable', reason: served.explain.external.reason }
        : null,
  });
  void dials;
  const replayed = set.records.find((r) => r.slot === served.slot && r.position === served.position) ?? null;
  if (!replayed) return { ok: true, equal: false, reason: 'the replay produced no decision for this slot and position', diff: [{ field: 'item_id', served: served.item_id, replayed: null }], served, replayed: null, used: { catalog: v.catalog, slots: v.slots, learn: v.learn, lift: v.lift, prior: v.prior } };
  const diff = compareRecords(served, replayed);
  return { ok: true, equal: diff.length === 0, diff, served, replayed, used: { catalog: v.catalog, slots: v.slots, learn: v.learn, lift: v.lift, prior: v.prior } };
}
