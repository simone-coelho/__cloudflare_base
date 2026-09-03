// src/learn/cycle.ts
// The autonomy cycle for a scope (doc 22 §11): for each slot in assisted or
// autonomous mode, read the lift snapshot in force, build the evidence, and
// either write a proposal for a person or apply the one move within bounds as
// a new revision of the slots document with the evidence in its note. Runs on
// the daily cron and on demand. Proposals are a versioned document kind of
// their own, so approving, rejecting and applying all leave a trail.

import type { Env } from '@/types/env';
import { read, readRevision, write, type DocumentKind, type ValidationResult } from '@/config/versionedStore';
import { DEFAULT_LEARN, DEFAULT_SLOTS, EMPTY_CATALOG, CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import type { LearnConfig, SlotCatalog } from '@/content/types';
import { liftKey } from './fan';
import type { LiftSnapshot } from './stats';
import { applyProposal, DEFAULT_AUTONOMY, proposeFor, type AutonomyConfig, type Proposal } from './autonomy';

export interface ProposalsDoc { version?: string; proposals: Proposal[] }
const MAX_PROPOSALS = 200;

export const PROPOSALS_KIND: DocumentKind<ProposalsDoc> = {
  name: 'proposals',
  validate: (c: unknown): ValidationResult<ProposalsDoc> => {
    if (typeof c !== 'object' || c === null || Array.isArray(c)) return { ok: false, errors: ['proposals: must be an object'] };
    const d = c as { version?: unknown; proposals?: unknown };
    if (!Array.isArray(d.proposals)) return { ok: false, errors: ['proposals: array required'] };
    return { ok: true, value: { ...(typeof d.version === 'string' ? { version: d.version } : {}), proposals: (d.proposals as Proposal[]).slice(-MAX_PROPOSALS) } };
  },
  stamp: (v, r) => ({ ...v, version: `proposals+r${r}` }),
  versionOf: (v) => v.version ?? '',
};
export const EMPTY_PROPOSALS: ProposalsDoc = { proposals: [] };

export function autonomyOf(learn: LearnConfig, slot: string): AutonomyConfig {
  const a = learn.slots?.[slot]?.autonomy;
  return a ? { mode: a.mode, step: a.step, min: a.min, max: a.max, pinned: a.pinned, minN: a.minN } : DEFAULT_AUTONOMY;
}

export interface CycleResult { slot: string; page: string; action: 'none' | 'proposed' | 'applied'; reason: string; proposal?: Proposal; revision?: number }

/** One cycle for a scope: every page's slots, in assisted or autonomous mode. */
export async function runCycle(env: Env, scope: string, brand = scope, now = Date.now(), actor = 'autonomy-cycle'): Promise<CycleResult[]> {
  const learn = (await readRevision(env, LEARN_KIND, scope, now))?.value ?? DEFAULT_LEARN;
  const slotsDoc = await read<SlotCatalog>(env, SLOTS_KIND, scope, DEFAULT_SLOTS, now);
  const catalog = await read(env, CONTENT_KIND, scope, EMPTY_CATALOG, now);
  const tags: Record<string, Record<string, readonly string[]>> = Object.fromEntries(catalog.pieces.map((p) => [p.id, p.tags]));
  const results: CycleResult[] = [];
  let nextSlots = slotsDoc; let changed = false; const notes: string[] = [];
  const proposalsDoc = await read<ProposalsDoc>(env, PROPOSALS_KIND, scope, EMPTY_PROPOSALS, now);
  const newProposals: Proposal[] = [];

  for (const [page, list] of Object.entries(slotsDoc.pages)) {
    for (const strategy of list) {
      const cfg = autonomyOf(learn, strategy.slot);
      if (cfg.mode === 'configured' || strategy.pinnedPieceId) { results.push({ slot: strategy.slot, page, action: 'none', reason: strategy.pinnedPieceId ? 'pinned slot' : 'configured' }); continue; }
      let snap: LiftSnapshot | null = null;
      try { snap = (await env.CACHE.get(liftKey(scope, brand, strategy.slot), 'json')) as LiftSnapshot | null; } catch { snap = null; }
      const { proposal, reason } = proposeFor({ tenant: scope, brand, slot: strategy.slot }, strategy.weights, tags, snap, cfg, now);
      if (!proposal) { results.push({ slot: strategy.slot, page, action: 'none', reason }); continue; }
      if (cfg.mode === 'autonomous') {
        const weights = applyProposal(strategy.weights, proposal, cfg);
        nextSlots = { ...nextSlots, pages: { ...nextSlots.pages, [page]: nextSlots.pages[page]!.map((s) => (s.slot === strategy.slot ? { ...s, weights } : s)) } };
        changed = true;
        notes.push(`${strategy.slot}: ${proposal.dimension} ${proposal.from} → ${proposal.to} (spread ${proposal.evidence[0]?.spread}, ${Math.round(proposal.exposures)} exposures, snapshot ${proposal.snapshotVersion})`);
        newProposals.push({ ...proposal, status: 'applied', note: 'applied autonomously within bounds' });
        results.push({ slot: strategy.slot, page, action: 'applied', reason, proposal });
      } else {
        newProposals.push(proposal);
        results.push({ slot: strategy.slot, page, action: 'proposed', reason, proposal });
      }
    }
  }
  if (newProposals.length) {
    await write(env, PROPOSALS_KIND, scope, { ...proposalsDoc, proposals: [...proposalsDoc.proposals, ...newProposals] }, { actor, note: `cycle: ${newProposals.length} proposal(s)`, nowMs: now });
  }
  if (changed) {
    const res = await write(env, SLOTS_KIND, scope, nextSlots, { actor, note: `autonomous cycle: ${notes.join('; ')}`, nowMs: now });
    if (res.ok) for (const r of results) if (r.action === 'applied') r.revision = res.revision.revision;
  }
  return results;
}

/** A person's decision on a proposal: apply it as a new slots revision with the evidence in the note, or reject it. */
export async function decideProposal(env: Env, scope: string, id: string, decision: 'apply' | 'reject', actor: string, now = Date.now()): Promise<{ ok: boolean; error?: string; revision?: number }> {
  const doc = await read<ProposalsDoc>(env, PROPOSALS_KIND, scope, EMPTY_PROPOSALS, now);
  const p = doc.proposals.find((x) => x.id === id);
  if (!p) return { ok: false, error: 'proposal not found' };
  if (p.status !== 'proposed') return { ok: false, error: `proposal already ${p.status}` };
  let revision: number | undefined;
  if (decision === 'apply') {
    const learn = (await readRevision(env, LEARN_KIND, scope, now))?.value ?? DEFAULT_LEARN;
    const cfg = autonomyOf(learn, p.slot);
    const slotsDoc = await read<SlotCatalog>(env, SLOTS_KIND, scope, DEFAULT_SLOTS, now);
    const pages = Object.fromEntries(Object.entries(slotsDoc.pages).map(([page, list]) => [page, list.map((s) => (s.slot === p.slot ? { ...s, weights: applyProposal(s.weights, p, cfg) } : s))]));
    const res = await write(env, SLOTS_KIND, scope, { ...slotsDoc, pages }, { actor, note: `proposal ${p.id} applied by ${actor}: ${p.dimension} ${p.from} → ${p.to} (spread ${p.evidence[0]?.spread}, ${Math.round(p.exposures)} exposures)`, nowMs: now });
    if (!res.ok) return { ok: false, error: res.errors.join('; ') };
    revision = res.revision.revision;
  }
  const next = { ...doc, proposals: doc.proposals.map((x) => (x.id === id ? { ...x, status: decision === 'apply' ? 'applied' as const : 'rejected' as const, note: `${decision} by ${actor}` } : x)) };
  await write(env, PROPOSALS_KIND, scope, next, { actor, note: `proposal ${id} ${decision}`, nowMs: now });
  return { ok: true, ...(revision !== undefined ? { revision } : {}) };
}
