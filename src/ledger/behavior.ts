import type { Env } from '@/types/env';
import type { Consent } from '@/content/consent';
import type { SessionCapability } from '@/identity/sessionCapability';
import { admitOwnedRecovery, requireConsentPurpose, withdrawOwnedCarry } from '@/identity/sessionAuthority';
import { captureRetention, externalRetentionBirths } from '@/retention';
import { behaviorItemSchema, isBehaviorRecord, ts36, type BehaviorRecord } from './records';
import type { CarriedOutcome, RecoveryInput, RecoveryOptions, RecoveryReceipt } from './recovery';

/** Deliberate typed event projection, not arbitrary raw data, query, URL, IP,
 * cookies, credentials, geography or private affinity. Actual event identity
 * and original time are retained rather than inferred from reward aggregates. */
const fields = ['productId', 'product_id', 'sku', 'contentId', 'content_id', 'decisionId', 'slot', 'pageType', 'event',
  'ms', 'dwellMs', 'value', 'price', 'margin', 'currency', 'quantity', 'orderId', 'line', 'category', 'occasion', 'color', 'silhouette', 'priceBand'] as const;
export type BehaviorPersistence = { status: 'not_captured'; reason: 'tracking_refused' | 'legacy_demo' }
  | { status: 'durable'; recordId: string; receipt: RecoveryReceipt };
type BehaviorEvent = { type: string; eventId: string; eventIdSource: 'provided' | 'request'; timestamp: number; source: string; data: Record<string, unknown> };
export async function captureBehavior(env: Env, principal: SessionCapability, consent: Consent, event: BehaviorEvent,
  sessionId: string | null, options?: RecoveryOptions): Promise<BehaviorPersistence> {
  return (await captureBehaviorCarrying(env, principal, consent, event, sessionId, options)).persistence;
}

/**
 * P65 (amendment 7, R-P124): a behaviour capture, and the outcome its durable
 * admission carries. `persistence` is exactly what `captureBehavior` answers.
 * `carrying` says this admission was handed an outcome to carry; `withdraw`
 * withdraws whatever outcome the captured operation carries (none: nothing),
 * awaited and never retained by the owner (`withdrawOwnedCarry`), so its failure
 * is the caller's and the outcome it leaves carried is the alarm's to settle.
 */
export interface BehaviorCapture { persistence: BehaviorPersistence; carrying: boolean; withdraw: () => Promise<void> }
const NOTHING_CARRIED = async (): Promise<void> => { /* not captured: nothing was admitted, so nothing is carried */ };
/**
 * P65: `captureBehavior` whose durable admission carries `carried`, the outcome
 * the action route prepared for the same event before this admission (one
 * transaction: src/ledger/recovery.ts `CarriedOutcome`). The record, its id, its
 * projection, the operation and its receipt are the same with or without it.
 */
export async function captureBehaviorCarrying(env: Env, principal: SessionCapability, consent: Consent, event: BehaviorEvent,
  sessionId: string | null, options?: RecoveryOptions, carried?: CarriedOutcome): Promise<BehaviorCapture> {
  if (!consent.tracking) return { persistence: { status: 'not_captured', reason: 'tracking_refused' }, carrying: false, withdraw: NOTHING_CARRIED };
  requireConsentPurpose(consent, 'tracking');
  if (env.LEDGER_RECOVERY_ENABLED !== 'true' && env.DEPLOYMENT_PROFILE === 'demo') return { persistence: { status: 'not_captured', reason: 'legacy_demo' }, carrying: false, withdraw: NOTHING_CARRIED };
  const data: BehaviorRecord['data'] = {};
  for (const key of fields) if (Object.hasOwn(event.data, key)) {
    const value = event.data[key];
    if ((key === 'ms' || key === 'dwellMs') && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new Error('Behavior duration unavailable');
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number'
      || Array.isArray(value) && value.every(v => typeof v === 'string')) data[key] = value;
    else throw new Error('Behavior projection unavailable');
  }
  if(Object.hasOwn(event.data,'items')){
    if(!Array.isArray(event.data.items)||event.data.items.length>500)throw new Error('Behavior items unavailable');
    data.items=event.data.items.map(item=>{
      if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('Behavior item unavailable');
      const allowed=['id','productId','product_id','sku','item_id','quantity','value','price','margin','currency'];
      return behaviorItemSchema.parse(Object.fromEntries(Object.entries(item).filter(([key])=>allowed.includes(key))));
    });
  }
  const record: BehaviorRecord = { version: 1, record_id: `${principal.tenant}:${ts36(event.timestamp)}:${principal.subject}:behavior:${event.eventId}`,
    tenant: principal.tenant, brand: principal.tenant, visitor_id: principal.subject, session_id: sessionId,
    event_id: event.eventId, event_id_source: event.eventIdSource, event: event.type, source: event.source, ts: event.timestamp, data,
    retention: captureRetention(env, principal.tenant, event.timestamp), externalRetention: externalRetentionBirths(env, principal.tenant, event.timestamp) };
  if (!isBehaviorRecord(record)) throw new Error('Behavior record unavailable');
  const input: Extract<RecoveryInput, { kind: 'behavior' }> = { kind: 'behavior', tenant: principal.tenant, subject: principal.subject, brand: principal.tenant, record,
    ...(carried ? { carried } : {}) };
  const receipt = await admitOwnedRecovery(input, options);
  return { persistence: { status: 'durable', recordId: record.record_id, receipt }, carrying: carried !== undefined,
    withdraw: () => withdrawOwnedCarry({ kind: 'behavior', tenant: input.tenant, subject: input.subject, brand: input.brand, record }) };
}
