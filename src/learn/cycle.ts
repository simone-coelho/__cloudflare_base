// src/learn/cycle.ts
// Autonomy mutation is withdrawn until its policy/evidence gates and
// transactional write/receipt recovery are implemented. Historical proposals
// remain readable; their stored statuses are not verified application receipts.

import type { Env } from '@/types/env';
import type { DocumentKind, ValidationResult } from '@/config/versionedStore';
import type { LearnConfig } from '@/content/types';
import { DEFAULT_AUTONOMY, type AutonomyConfig, type Proposal } from './autonomy';

export interface ProposalsDoc { version?: string; proposals: Proposal[] }
const MAX_PROPOSALS = 200;

export const PROPOSALS_KIND: DocumentKind<ProposalsDoc> = {
  name: 'proposals',
  publication: 'r2',
  validate: (c: unknown): ValidationResult<ProposalsDoc> => {
    if (typeof c !== 'object' || c === null || Array.isArray(c)) return { ok: false, errors: ['proposals: must be an object'] };
    const d = c as { version?: unknown; proposals?: unknown };
    if (!Array.isArray(d.proposals) || d.proposals.length > MAX_PROPOSALS) return { ok: false, errors: ['proposals: bounded array required'] };
    if (d.proposals.some(p => !p || typeof p !== 'object' || Array.isArray(p)
      || ['id', 'tenant', 'brand', 'slot', 'dimension'].some(k => typeof p[k] !== 'string' || !p[k] || p[k].length > 256)
      || ['at', 'from', 'to', 'exposures', 'snapshotVersion'].some(k => typeof p[k] !== 'number' || !Number.isFinite(p[k]))
      || !['configured', 'assisted', 'autonomous'].includes(p.mode) || !['proposed', 'applied', 'rejected'].includes(p.status)
      || !Array.isArray(p.evidence) || p.evidence.length > 256)) return { ok: false, errors: ['proposals: invalid retained proposal'] };
    return { ok: true, value: { ...(typeof d.version === 'string' ? { version: d.version } : {}), proposals: d.proposals as Proposal[] } };
  },
  stamp: (v, r) => ({ ...v, version: `proposals+r${r}` }),
  versionOf: (v) => v.version ?? '',
};
export const EMPTY_PROPOSALS: ProposalsDoc = { proposals: [] };

export function autonomyOf(learn: LearnConfig, slot: string): AutonomyConfig {
  const a = learn.slots?.[slot]?.autonomy;
  return a ? { mode: a.mode, step: a.step, min: a.min, max: a.max, pinned: a.pinned, minN: a.minN } : DEFAULT_AUTONOMY;
}

export interface AutonomyUnavailable {
  ok: false;
  code: 'autonomy_unavailable';
  error: string;
}

function unavailable(): AutonomyUnavailable {
  return { ok: false, code: 'autonomy_unavailable', error: 'Autonomy cycles and proposal changes are unavailable pending safe application and evidence controls.' };
}

/** Unconditional refusal: do not inspect bindings, configuration or proposals. */
export const runCycle: (env: Env, scope: string, brand?: string, now?: number, actor?: string) => Promise<AutonomyUnavailable> =
  async () => unavailable();

/** Both apply and reject would mutate unprotected receipts, so both refuse. */
export const decideProposal: (env: Env, scope: string, id: string, decision: 'apply' | 'reject', actor: string, now?: number) => Promise<AutonomyUnavailable> =
  async () => unavailable();
