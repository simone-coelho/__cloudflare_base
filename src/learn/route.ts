// src/learn/route.ts
// The one call the action route makes for an outcome: read the scope's learn
// document (cached by the store), then hand the outcome to the visitor's ring,
// which attributes it and forwards the credits. Never throws, never awaited on
// the response path.

import type { Env } from '@/types/env';
import { readRevision } from '@/config/versionedStore';
import { DEFAULT_LEARN, LEARN_KIND } from '@/content/kinds';
import type { LearnConfig } from '@/content/types';
import type { OutcomeRecord } from '@/ledger/records';
import { DEFAULT_POLICY, type AttributionPolicy } from './policy';
import { DEFAULT_STATS, type AttributionContract } from './stats';
import { fanOutcome, reportLearningIncomplete, type SlotLearnConfig } from './fan';
import { admitOwnedRecovery } from '@/identity/sessionAuthority';

export function policyOf(learn: LearnConfig): AttributionPolicy {
  const p = learn.policy;
  return p ? { scope: p.scope, match: p.match, credit: p.credit, windowsMs: { ...DEFAULT_POLICY.windowsMs, ...p.windowsMs } } : DEFAULT_POLICY;
}

/**
 * W22 A1.01: the one named, versioned attribution contract, built from the
 * tenant's OWN published policy and from the reach the calling path really has.
 *
 * `version` is a platform constant: it names the meaning of these numbers, and
 * a stored report written under an earlier version is read as such and never
 * pooled with a later one. Nothing here is a stamped window — `windowsMs` is
 * derived from `policyOf`, which is the tenant's published document, and
 * `appliedWindowsMs` is derived from `reachMs`, which each path supplies from
 * the horizon it actually used: the fold's `BuildOptions.horizonMs`, the raw
 * day's single day, the online ring's own age limit.
 */
export const ATTRIBUTION_CONTRACT_NAME = 'attribution' as const;
export const ATTRIBUTION_CONTRACT_VERSION = 1;
export function attributionContractOf(learn: LearnConfig, reachMs: number): AttributionContract {
  const policy = policyOf(learn);
  const windowsMs: Record<string, number> = {}, appliedWindowsMs: Record<string, number> = {};
  const reach = Number.isFinite(reachMs) && reachMs >= 0 ? reachMs : 0;
  for (const [reward, asked] of Object.entries(policy.windowsMs)) {
    if (typeof asked !== 'number' || !Number.isFinite(asked) || asked < 0) continue;
    windowsMs[reward] = asked;
    appliedWindowsMs[reward] = Math.min(asked, reach);
  }
  return { name: ATTRIBUTION_CONTRACT_NAME, version: ATTRIBUTION_CONTRACT_VERSION,
    history: { scope: policy.scope, match: policy.match, credit: policy.credit }, windowsMs, appliedWindowsMs };
}
/** A contract read back off a stored document: only a well-formed one is honoured. */
export function validAttributionContract(value: unknown): AttributionContract | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const number = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  const map = (m: unknown): Record<string, number> | null => {
    if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
    const out: Record<string, number> = {};
    for (const [key, entry] of Object.entries(m)) { if (!number(entry) || Object.hasOwn(Object.prototype, key)) return null; out[key] = entry; }
    return out;
  };
  const history = v.history as Record<string, unknown> | undefined;
  const windowsMs = map(v.windowsMs), appliedWindowsMs = map(v.appliedWindowsMs);
  if (v.name !== ATTRIBUTION_CONTRACT_NAME || !Number.isSafeInteger(v.version) || Number(v.version) < 0
    || !history || !['session', 'visitor'].includes(history.scope as string) || !['direct', 'any'].includes(history.match as string)
    || !['first', 'last'].includes(history.credit as string) || !windowsMs || !appliedWindowsMs
    || Object.keys(windowsMs).some(reward => !(reward in appliedWindowsMs) || appliedWindowsMs[reward]! > windowsMs[reward]!)) return null;
  return { name: ATTRIBUTION_CONTRACT_NAME, version: v.version as number,
    history: history as AttributionContract['history'], windowsMs, appliedWindowsMs };
}

export function slotConfigsOf(learn: LearnConfig): Record<string, SlotLearnConfig> {
  const stats = learn.stats ?? DEFAULT_STATS;
  const out: Record<string, SlotLearnConfig> = {};
  for (const [slot, d] of Object.entries(learn.slots ?? {})) out[slot] = { reward: d.reward ?? 'click', stats, objective: d.objective ?? 'unit', measurementBasis: d.measurementBasis ?? 'served-v1' };
  return out;
}

/** An outcome into the learning loop for its scope. Resolves without throwing. */
export async function outcomeToLearning(env: Env, scope: string, outcome: OutcomeRecord): Promise<void> {
  try {
    const rev = await readRevision(env, LEARN_KIND, scope);
    const learn = rev?.value ?? DEFAULT_LEARN;
    if (env.LEDGER_RECOVERY_ENABLED === 'true') {
      const result = await admitOwnedRecovery({ kind: 'outcome', tenant: scope, subject: outcome.visitor_id, brand: outcome.brand, outcome,
        policy: policyOf(learn), configs: slotConfigsOf(learn), defaultConfig: { reward: 'click', objective: 'unit', stats: learn.stats ?? DEFAULT_STATS } });
      if (result.source.state !== 'recovered') reportLearningIncomplete('outcome', result.learning ?? null);
      return;
    }
    const result = await fanOutcome(env, scope, outcome, policyOf(learn), outcome.brand, slotConfigsOf(learn),
      { reward: 'click', objective: 'unit', stats: learn.stats ?? DEFAULT_STATS });
    reportLearningIncomplete('outcome', result);
  } catch { reportLearningIncomplete('outcome', null); }
}
