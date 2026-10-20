// src/learn/route.ts
// The one call the action route makes for an outcome: read the scope's learn
// document (cached by the store), then hand the outcome to the visitor's ring,
// which attributes it and forwards the credits. Never throws, never awaited on
// the response path; with durable recovery on, the shopper's owner holds its
// answer for the outcome's durable admission only, and the attribution and
// credits continue after the answer (P59). With durable recovery on, the route
// makes the same call in its two halves (P65): the preparation before the
// behaviour capture's admission, which carries what it builds, and the admission
// once the engine has answered.

import type { Env } from '@/types/env';
import { readRevision } from '@/config/versionedStore';
import { DEFAULT_LEARN, LEARN_KIND } from '@/content/kinds';
import type { LearnConfig, SlotAttribution } from '@/content/types';
import type { OutcomeRecord } from '@/ledger/records';
import type { OutcomeRecoveryInput, RecoveryOptions, RecoveryReceipt } from '@/ledger/recovery';
import { recordEvidenceLoss } from '@/ledger/delivery';
import { DEFAULT_POLICY, type AttributionPolicy } from './policy';
import { DEFAULT_STATS, type AttributionContract } from './stats';
import { fanOutcome, reportLearningIncomplete, type SlotLearnConfig } from './fan';
import { admitOwnedRecovery, afterOwnerAnswer, ownerOperationActive } from '@/identity/sessionAuthority';

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
 * P65 (amendment 7, R-P124(1)): the learning preparation of an outcome's durable
 * admission, alone: the scope's learn document read (cached by the store), and
 * the brand-wide policy, the slots' configurations and the default configuration
 * taken from it, built into the outcome's recovery input. It writes, counts and
 * logs nothing, and throws what the read throws. The action route makes it BEFORE
 * the behaviour capture's durable admission, which carries what it builds
 * (src/ledger/recovery.ts `CarriedOutcome`), so this read decides whether
 * anything is carried, and nothing reads the learn document again for that
 * outcome, whoever admits it.
 */
export async function prepareOutcomeAdmission(env: Env, scope: string, outcome: OutcomeRecord): Promise<OutcomeRecoveryInput> {
  const rev = await readRevision(env, LEARN_KIND, scope);
  const learn = rev?.value ?? DEFAULT_LEARN;
  return { kind: 'outcome', tenant: scope, subject: outcome.visitor_id, brand: outcome.brand, outcome,
    policy: brandPolicyOf(learn), configs: slotConfigsOf(learn), defaultConfig: { reward: 'click', objective: 'unit', stats: learn.stats ?? DEFAULT_STATS } };
}

/**
 * P65: an outcome's durable admission from its prepared input (above), exactly as
 * `outcomeToLearning` admits it with durable recovery on: P59's answer at its
 * admission when asked, P64's `onAdmitted` told once that admission completed (it
 * committed, or an earlier admission of the same outcome replayed), an incomplete
 * end reported as `learning_incomplete`. Never throws. A failure of the admission
 * itself is reported, never counted (R-P125(2)): it fails the action, and a
 * carried copy of the outcome is the alarm's to write.
 */
export async function admitPreparedOutcome(input: OutcomeRecoveryInput,
  options?: Pick<RecoveryOptions, 'answerAtAdmission'> & { onAdmitted?: () => void }): Promise<void> {
  try {
    const report = (receipt: RecoveryReceipt | undefined) => { if (receipt?.source.state !== 'recovered') reportLearningIncomplete('outcome', receipt?.learning ?? null); };
    const result = await admitOwnedRecovery(input, options?.answerAtAdmission ? { answerAtAdmission: true, afterEffects: report } : undefined);
    try { options?.onAdmitted?.(); } catch { /* a report only: the admission stands */ }
    // Answered at admission: no effect has run yet; they are reported when they end (`afterEffects`).
    if (options?.answerAtAdmission && result.source.state === 'pending' && result.learning === undefined) return;
    report(result);
  } catch {
    reportLearningIncomplete('outcome', null);
  }
}

/**
 * P64 (amendment 7, R-P125), P65 (R-P124(4)): an outcome lost before its durable
 * admission because its learning preparation failed. Logged as
 * `learning_incomplete` and counted once in the tenant's `producerFailed`
 * lost-evidence counter, which the monitor reads (src/ledger/delivery.ts
 * `recordEvidenceLoss`). The count adds nothing before the answer: inside the
 * shopper's owner it runs once the owner has answered and outside it
 * (`afterOwnerAnswer`, R-P115: kept alive by the owner's waitUntil, never retained
 * work the owner drains before it answers, never queued in its serializer), with
 * the operator cache alone; an owner that refuses it, or an operation that did not
 * answer, counts nothing; outside an owner operation it is counted here. Never
 * throws.
 */
export async function outcomePreparationFailed(env: Env, scope: string): Promise<void> {
  reportLearningIncomplete('outcome', null);
  if (ownerOperationActive(env)) void afterOwnerAnswer(operator => recordEvidenceLoss(operator, scope, 'producerFailed', 1)).catch(() => undefined);
  else await recordEvidenceLoss(env, scope, 'producerFailed', 1);
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
 * failure is counted once (`outcomePreparationFailed`, above), beside the
 * `learning_incomplete` line. Nothing is counted here without durable recovery,
 * where the producer (`enqueueOutcome`) hands the outcome on and counts its own
 * failures, nor once the outcome is handed to its admission (`admitOwnedRecovery`):
 * its admission failing fails the action itself (the owner's drain rethrows it), a
 * refusal of the owner's authority or recovery configuration there is a refusal,
 * not a lost row, and an effect after the admission is the alarm's to complete.
 *
 * P64 (R-P125): `onAdmitted` is told, once, that the outcome's durable admission
 * completed (`admitOwnedRecovery` resolved: its admission committed, or an earlier
 * one of the same outcome replayed), so the action route names the outcome on its
 * answer only then. It reports and decides nothing; its failure is ignored, and the
 * function still resolves to nothing.
 *
 * P65 (amendment 7): with durable recovery on, these are the preparation and the
 * admission above, in that order; the action route calls them apart.
 */
export async function outcomeToLearning(env: Env, scope: string, outcome: OutcomeRecord,
  options?: Pick<RecoveryOptions, 'answerAtAdmission'> & { onAdmitted?: () => void }): Promise<void> {
  if (env.LEDGER_RECOVERY_ENABLED === 'true') {
    let input: OutcomeRecoveryInput;
    try { input = await prepareOutcomeAdmission(env, scope, outcome); }
    catch { await outcomePreparationFailed(env, scope); return; }
    await admitPreparedOutcome(input, options);
    return;
  }
  try {
    const rev = await readRevision(env, LEARN_KIND, scope);
    const learn = rev?.value ?? DEFAULT_LEARN;
    // P33 (S4F-C6): the ring receives the brand-wide policy and each slot's own
    // attribution policy on that slot's configuration, its one carrier there.
    const result = await fanOutcome(env, scope, outcome, brandPolicyOf(learn), outcome.brand, slotConfigsOf(learn),
      { reward: 'click', objective: 'unit', stats: learn.stats ?? DEFAULT_STATS });
    reportLearningIncomplete('outcome', result);
  } catch {
    reportLearningIncomplete('outcome', null);
  }
}
