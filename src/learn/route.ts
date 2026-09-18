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
import { DEFAULT_STATS } from './stats';
import { fanOutcome, reportLearningIncomplete, type SlotLearnConfig } from './fan';
import { admitOwnedRecovery } from '@/identity/sessionAuthority';

export function policyOf(learn: LearnConfig): AttributionPolicy {
  const p = learn.policy;
  return p ? { scope: p.scope, match: p.match, credit: p.credit, windowsMs: { ...DEFAULT_POLICY.windowsMs, ...p.windowsMs } } : DEFAULT_POLICY;
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
