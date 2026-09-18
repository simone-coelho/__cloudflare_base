import type { Env } from '@/types/env';
import type { Consent } from '@/content/consent';
import type { SessionCapability } from '@/identity/sessionCapability';
import { admitOwnedRecovery, requireConsentPurpose } from '@/identity/sessionAuthority';
import { captureRetention, externalRetentionBirths } from '@/retention';
import { behaviorItemSchema, isBehaviorRecord, ts36, type BehaviorRecord } from './records';
import type { RecoveryReceipt } from './recovery';

/** Deliberate typed event projection, not arbitrary raw data, query, URL, IP,
 * cookies, credentials, geography or private affinity. Actual event identity
 * and original time are retained rather than inferred from reward aggregates. */
const fields = ['productId', 'product_id', 'sku', 'contentId', 'content_id', 'decisionId', 'slot', 'pageType', 'event',
  'ms', 'dwellMs', 'value', 'price', 'margin', 'currency', 'quantity', 'orderId', 'line', 'category', 'occasion', 'color', 'silhouette', 'priceBand'] as const;
export type BehaviorPersistence = { status: 'not_captured'; reason: 'tracking_refused' | 'legacy_demo' }
  | { status: 'durable'; recordId: string; receipt: RecoveryReceipt };
export async function captureBehavior(env: Env, principal: SessionCapability, consent: Consent,
  event: { type: string; eventId: string; eventIdSource: 'provided' | 'request'; timestamp: number; source: string; data: Record<string, unknown> },
  sessionId: string | null): Promise<BehaviorPersistence> {
  if (!consent.tracking) return { status: 'not_captured', reason: 'tracking_refused' };
  requireConsentPurpose(consent, 'tracking');
  if (env.LEDGER_RECOVERY_ENABLED !== 'true' && env.DEPLOYMENT_PROFILE === 'demo') return { status: 'not_captured', reason: 'legacy_demo' };
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
  const receipt = await admitOwnedRecovery({ kind: 'behavior', tenant: principal.tenant, subject: principal.subject, brand: principal.tenant, record });
  return { status: 'durable', recordId: record.record_id, receipt };
}
