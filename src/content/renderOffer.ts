import type { Env } from '@/types/env';
import type { DecisionRecord } from './types';
import type { Consent } from './consent';
import { consentDeadline, personalizes } from './consent';
import { readSigningConfig } from '@/auth/signingConfig.mjs';
import { assertOwnerScope, currentOwnerConsent, requireConsentPurpose } from '@/identity/sessionAuthority';
import { SessionAccessError, type SessionCapability } from '@/identity/sessionCapability';
import { pinPublication } from '@/config/publication';
import { recoverDecisions, recoveryJSON } from '@/ledger/recovery';
import type { SlotLearnConfig } from '@/learn/fan';
import { requireRetention } from '@/retention';
import { parseId } from '@/ledger/records';
import { isEventNonce, isEventTimestamp } from '@/events/actionTypes';

const encoder = new TextEncoder();
const PURPOSE = 'content-render-offer/v1';
const MAX_BYTES = 1024 * 1024;
export const RENDER_OFFER_WINDOW_MS = 5 * 60_000;
interface Offer {
  version: 1; principal: SessionCapability; consentRevision: string;
  publication: string; pageInstance: string; until: number; record: DecisionRecord; config: SlotLearnConfig;
}
export interface RenderAcknowledgment {
  version: 1; decisionId: string; eventId: string; pageInstance: string;
  status: 'durable'; source: 'pending' | 'recovered';
}
const encode = (v: Uint8Array) => {
  let raw = ''; for (let i = 0; i < v.length; i += 8192) raw += String.fromCharCode(...v.subarray(i, i + 8192));
  return btoa(raw).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
};
const decode = (v: string) => {
  if (!/^[A-Za-z0-9_-]+$/.test(v)) throw new SessionAccessError();
  const out = Uint8Array.from(atob(v.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  if (encode(out) !== v) throw new SessionAccessError(); return out;
};
async function cipher(env: Env) {
  const cfg = readSigningConfig(env); if (!cfg) throw new SessionAccessError();
  const material = await crypto.subtle.importKey('raw', cfg.key, 'HKDF', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(JSON.stringify([cfg.issuer, cfg.audience])),
    info: encoder.encode(PURPOSE) }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { key, additionalData: encoder.encode(JSON.stringify([PURPOSE, cfg.issuer, cfg.audience])) };
}
function lifetime(env: Env, value: Offer, now: number): void {
  if (value.version !== 1 || !isEventNonce(value.pageInstance) || !Number.isSafeInteger(value.until) || value.until <= now
    || value.until > value.record.ts + RENDER_OFFER_WINDOW_MS || value.record.ts > now
    || value.record.tenant !== value.principal.tenant || value.record.visitor_id !== value.principal.subject
    || value.record.measurementBasis !== 'rendered-v1' || value.record.rendered !== undefined
    || value.config.measurementBasis !== 'rendered-v1' || parseId(value.record.decision_id)?.ts !== value.record.ts
    || parseId(value.record.decision_id)?.tenant !== value.principal.tenant
    || value.record.decision_id.split(':')[2] !== value.principal.subject) throw new SessionAccessError();
  for (const category of ['ledger', 'online'] as const) {
    const stamp = requireRetention(env, value.record.retention?.[category], value.principal.tenant, category, now);
    if (value.until > stamp.expiresAt) throw new SessionAccessError();
  }
}
/** No durable write: exact private replay inputs are encrypted, not returned as clear browser metadata. */
export async function createRenderOffer(env: Env, principal: SessionCapability, consent: Consent, record: DecisionRecord,
  config: SlotLearnConfig, publication: string, pageInstance: string): Promise<string> {
  assertOwnerScope(env, principal);
  if (!consent.tracking || !consent.instruction || !isEventNonce(pageInstance)) throw new SessionAccessError();
  requireConsentPurpose(consent, personalizes(consent) ? 'personalization' : 'tracking');
  const value: Offer = { version: 1, principal, consentRevision: consent.instruction.revision, publication, pageInstance,
    until: Math.min(record.ts + RENDER_OFFER_WINDOW_MS, principal.exp * 1000, consentDeadline(consent, personalizes(consent) ? 'personalization' : 'tracking'),
      record.retention?.ledger?.expiresAt ?? 0, record.retention?.online?.expiresAt ?? 0), record, config };
  lifetime(env, value, Date.now());
  const raw = encoder.encode(recoveryJSON(value)); if (raw.byteLength > MAX_BYTES) throw new SessionAccessError();
  const { key, additionalData } = await cipher(env), iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, key, raw);
  lifetime(env, value, Date.now());
  return `ro1.${encode(iv)}.${encode(new Uint8Array(sealed))}`;
}
/** Fresh owner admission plus the original sealed grant/config/lifetime. Retries never recapture a birth. */
export async function redeemRenderOffer(env: Env, principal: SessionCapability, consent: Consent,
  event: { eventId?: string; timestamp?: number; data: Record<string, unknown> }): Promise<RenderAcknowledgment> {
  assertOwnerScope(env, principal);
  const token = event.data.renderOffer;
  if (typeof token !== 'string' || token.length > Math.ceil((MAX_BYTES + 16) * 4 / 3) + 32
    || !isEventNonce(event.eventId) || !isEventTimestamp(event.timestamp)) throw new SessionAccessError();
  const parts = token.split('.'); if (parts.length !== 3 || parts[0] !== 'ro1') throw new SessionAccessError();
  let value: Offer;
  try {
    const { key, additionalData } = await cipher(env), iv = decode(parts[1]!); if (iv.length !== 12) throw new Error();
    const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData }, key, decode(parts[2]!));
    if (raw.byteLength > MAX_BYTES) throw new Error(); value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(raw));
  } catch { throw new SessionAccessError(); }
  lifetime(env, value, Date.now());
  if (recoveryJSON(value.principal) !== recoveryJSON(principal) || value.pageInstance !== event.data.pageInstance
    || value.record.decision_id !== event.data.decisionId || value.record.item_id !== event.data.contentId
    || value.record.slot !== event.data.slot || value.record.page !== event.data.page
    || value.record.position !== event.data.position || event.timestamp! < value.record.ts || event.timestamp! > Date.now()) throw new SessionAccessError();
  const pin = await pinPublication(env, principal.tenant);
  const current = await currentOwnerConsent();
  if (pin.digest !== value.publication || !current?.tracking || !consent.tracking || current.instruction?.revision !== value.consentRevision
    || consent.instruction?.revision !== value.consentRevision || value.record.arm !== 'default' && (!personalizes(current) || !personalizes(consent))) throw new SessionAccessError();
  requireConsentPurpose(current, value.record.arm !== 'default' ? 'personalization' : 'tracking');
  lifetime(env, value, Date.now());
  const record: DecisionRecord = { ...value.record, rendered: { version: 1, eventId: event.eventId!, at: event.timestamp!, pageInstance: value.pageInstance } };
  const receipt = await recoverDecisions(env, { tenant: principal.tenant, brand: record.brand, visitor_id: principal.subject, records: [record] }, () => value.config, value.until);
  if (!receipt.durable || !['pending', 'recovered'].includes(receipt.source.state)) throw new SessionAccessError();
  return { version: 1, decisionId: record.decision_id, eventId: event.eventId!, pageInstance: value.pageInstance,
    status: 'durable', source: receipt.source.state as 'pending' | 'recovered' };
}
