// src/learn/route.ts
// The one call the action route makes for an outcome: read the scope's learn
// document (cached by the store), then hand the outcome to the visitor's ring,
// which attributes it and forwards the credits. Never throws, never awaited on
// the response path; with durable recovery on, the shopper's owner holds its
// answer for the outcome's durable admission only, and the attribution and
// credits continue after the answer (P59).

import type { Env } from '@/types/env';
import { readRevision } from '@/config/versionedStore';
import { DEFAULT_LEARN, LEARN_KIND } from '@/content/kinds';
import type { LearnConfig, SlotAttribution } from '@/content/types';
import type { OutcomeRecord } from '@/ledger/records';
import type { RecoveryInput, RecoveryOptions, RecoveryReceipt } from '@/ledger/recovery';
import { recordEvidenceLoss } from '@/ledger/delivery';
import { DEFAULT_POLICY, type AttributionPolicy } from './policy';
import { DEFAULT_STATS, type AttributionContract } from './stats';
import { fanOutcome, reportLearningIncomplete, type SlotLearnConfig } from './fan';
import { admitOwnedRecovery } from '@/identity/sessionAuthority';

/**
 * P33 (decision D1, freeze item 11): slot → its own attribution policy, for the
 * slots whose learn dials name one (`module-tied`, the only one), or null when
 * no slot does. One reading of the document, so every carrier below names the
 * same slots.
 */
export function slotAttributionsOf(learn: LearnConfig): Record<string, SlotAttribution> | null {
  const out: Record<string, SlotAttribution> = {};
  for (const [slot, d] of Object.entries(learn.slots ?? {})) if (d?.attribution === 'module-tied') out[slot] = 'module-tied';
  return Object.keys(out).length ? Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : null;
}

/** The brand-wide learning policy alone: the four axes, never a slot's own policy. */
function brandPolicyOf(learn: LearnConfig): AttributionPolicy {
  const p = learn.policy;
  return p ? { scope: p.scope, match: p.match, credit: p.credit, windowsMs: { ...DEFAULT_POLICY.windowsMs, ...p.windowsMs } } : DEFAULT_POLICY;
}

/**
 * The tenant's learning policy. P33: with `slotAttribution` beside the four
 * axes when a slot's dials name their own attribution policy, so each fold of
 * the ledger — the offline recomputation (`foldRetainedDay`, which the
 * statistics object calls with this policy), the hourly fold and the raw day —
 * credits that slot as the visitor's ring does; a document whose slots name
 * none answers exactly the policy it always did.
 */
export function policyOf(learn: LearnConfig): AttributionPolicy {
  const brand = brandPolicyOf(learn), own = slotAttributionsOf(learn);
  return own ? { ...brand, slotAttribution: own } : brand;
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

/**
 * Each slot's learning configuration. P33 (R-P39, S4F-C6): the slot's own
 * attribution policy rides here as `attribution`, only on a slot whose dials
 * name one, because this is the configuration the visitor's ring receives and
 * admits member by member; the ring keeps it out of the credit batch it sends
 * the statistics object, whose configuration stays exactly reward, stats,
 * objective and measurement basis.
 */
export function slotConfigsOf(learn: LearnConfig): Record<string, SlotLearnConfig> {
  const stats = learn.stats ?? DEFAULT_STATS;
  const out: Record<string, SlotLearnConfig> = {};
  for (const [slot, d] of Object.entries(learn.slots ?? {})) out[slot] = { reward: d.reward ?? 'click', stats, objective: d.objective ?? 'unit', measurementBasis: d.measurementBasis ?? 'served-v1',
    ...(d.attribution === 'module-tied' ? { attribution: d.attribution } : {}) };
  return out;
}

/**
 * An outcome into the learning loop for its scope. Resolves without throwing.
 *
 * P59 (amendment 5): with durable recovery on and `answerAtAdmission`, it resolves
 * once the outcome's durable admission is committed and its alarm armed (P56's
 * mechanism, src/ledger/recovery.ts `RecoveryOptions`); the outcome's effects
 * (attribution, queue, ledger, credits) continue right after the owner's answer in
 * the shopper's own serializer, the alarm the backstop, and an incomplete end of
 * them is reported when they end, as it is reported here when they run before the
 * answer. The admitted outcome, its policy and configurations are the same either
 * way; an admission that fails still fails as before.
 *
 * P64 (amendment 7): with durable recovery on, the outcome reaches the ledger only
 * through its durable admission here (the action route hands it to no producer
 * beside it), so a failure of its learning preparation (the learn document's read,
 * the policy and configurations taken from it), before the outcome is handed to
 * that admission, loses it while the action still answers as before. Such a
 * failure is counted once in the tenant's `producerFailed` lost-evidence counter,
 * which the monitor reads (src/ledger/delivery.ts `recordEvidenceLoss`), beside the
 * `learning_incomplete` line. Nothing is counted here without durable recovery,
 * where the producer (`enqueueOutcome`) hands the outcome on and counts its own
 * failures, nor once the outcome is handed to its admission (`admitOwnedRecovery`):
 * its admission failing fails the action itself (the owner's drain rethrows it), a
 * refusal of the owner's authority or recovery configuration there is a refusal,
 * not a lost row, and an effect after the admission is the alarm's to complete.
 */
export async function outcomeToLearning(env: Env, scope: string, outcome: OutcomeRecord, options?: Pick<RecoveryOptions, 'answerAtAdmission'>): Promise<void> {
  let preparing = false;
  try {
    preparing = env.LEDGER_RECOVERY_ENABLED === 'true';
    const rev = await readRevision(env, LEARN_KIND, scope);
    const learn = rev?.value ?? DEFAULT_LEARN;
    if (env.LEDGER_RECOVERY_ENABLED === 'true') {
      const report = (receipt: RecoveryReceipt | undefined) => { if (receipt?.source.state !== 'recovered') reportLearningIncomplete('outcome', receipt?.learning ?? null); };
      const input: RecoveryInput = { kind: 'outcome', tenant: scope, subject: outcome.visitor_id, brand: outcome.brand, outcome,
        policy: brandPolicyOf(learn), configs: slotConfigsOf(learn), defaultConfig: { reward: 'click', objective: 'unit', stats: learn.stats ?? DEFAULT_STATS } };
      preparing = false;
      const result = await admitOwnedRecovery(input, options?.answerAtAdmission ? { answerAtAdmission: true, afterEffects: report } : undefined);
      // Answered at admission: no effect has run yet; they are reported when they end (`afterEffects`).
      if (options?.answerAtAdmission && result.source.state === 'pending' && result.learning === undefined) return;
      report(result);
      return;
    }
    // P33 (S4F-C6): the ring receives the brand-wide policy and each slot's own
    // attribution policy on that slot's configuration, its one carrier there.
    const result = await fanOutcome(env, scope, outcome, brandPolicyOf(learn), outcome.brand, slotConfigsOf(learn),
      { reward: 'click', objective: 'unit', stats: learn.stats ?? DEFAULT_STATS });
    reportLearningIncomplete('outcome', result);
  } catch {
    reportLearningIncomplete('outcome', null);
    if (preparing) await recordEvidenceLoss(env, scope, 'producerFailed', 1);
  }
}
