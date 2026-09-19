// src/content/consent.ts
// CW31 (BTIE D10), the content service's half of consent. Two switches the
// session has always stored and nothing honoured: `trackingConsent` and
// `personalizationEnabled`. Either off means the shopper gets the site's own
// defaults, the holdout's `default` arm, whatever the hash would have said.
// Tracking off also means the engine writes nothing about the request: no
// decision record, no ring, no exposure, no outcome. Missing, expired or legacy
// boolean-only state is OFF; only a scoped explicit instruction grants a purpose.
//
// The session host carries the switches on `preferences`; the shopper object
// reports them as `consent: { tracking, personalization }` on its snapshot and
// on its ingest envelope (the delivery session's half); the SDK's cookies
// mirror them for the paths that only see the request.

import type { Arm } from './types';

export const CONSENT_LIFETIME_MS = 30 * 86400 * 1000;
export type ConsentSwitch = 'tracking' | 'personalization';
export interface ConsentChoice { value: boolean; chosenAt: number; expiresAt: number }
export interface ConsentInstruction {
  version: 1; tenant: string; subject: string; revision: string;
  tracking?: ConsentChoice; personalization?: ConsentChoice;
  operation?: { id: string; grant: string; expected: string | null; tracking?: boolean; personalization?: boolean };
}
export interface Consent { tracking: boolean; personalization: boolean; instruction?: ConsentInstruction }
export const CONSENTING: Consent = { tracking: true, personalization: true };
export const REFUSING: Consent = { tracking: false, personalization: false };
export const CONSENT_SWITCHES: ConsentSwitch[] = ['tracking', 'personalization'];

/** Only an explicit owner-issued record can authorize a purpose. Legacy switches
 * remain restrictions, never evidence of a choice. No browser clock is authority. */
export function instructionOf(value: unknown, scope?: { tenant: string; subject: string }): ConsentInstruction | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object') throw new Error('Consent state unavailable');
  const v = value as ConsentInstruction;
  if (v.version !== 1 || typeof v.tenant !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(v.tenant)
    || typeof v.subject !== 'string' || !/^[A-Za-z0-9_.-]{1,200}$/.test(v.subject)
    || typeof v.revision !== 'string' || !/^[A-Za-z0-9_-]{1,96}$/.test(v.revision)
    || scope && (v.tenant !== scope.tenant || v.subject !== scope.subject)
    || Object.keys(v).some(k => !['version', 'tenant', 'subject', 'revision', 'tracking', 'personalization', 'operation'].includes(k))) throw new Error('Consent state unavailable');
  for (const key of CONSENT_SWITCHES) {
    const c = v[key];
    if (c !== undefined && (!c || typeof c.value !== 'boolean' || !Number.isSafeInteger(c.chosenAt) || c.chosenAt < 0
      || !Number.isSafeInteger(c.expiresAt) || c.expiresAt - c.chosenAt !== CONSENT_LIFETIME_MS
      || Object.keys(c).some(k => !['value', 'chosenAt', 'expiresAt'].includes(k)))) throw new Error('Consent state unavailable');
  }
  if (v.operation !== undefined) {
    const o = v.operation;
    if (!o || typeof o.id !== 'string' || !/^[A-Za-z0-9_-]{1,96}$/.test(o.id)
      || typeof o.grant !== 'string' || o.grant.length > 1024
      || !(o.expected === null || typeof o.expected === 'string')
      || Object.keys(o).some(k => !['id', 'grant', 'expected', 'tracking', 'personalization'].includes(k))
      || CONSENT_SWITCHES.some(k => o[k] !== undefined && typeof o[k] !== 'boolean')) throw new Error('Consent state unavailable');
  }
  return v;
}
export function liveInstruction(value: ConsentInstruction | undefined, now = Date.now()): ConsentInstruction | undefined {
  if (!value) return undefined;
  const next = { ...value };
  for (const key of CONSENT_SWITCHES) if (next[key] && next[key]!.expiresAt <= now) delete next[key];
  if (!next.tracking && !next.personalization) return undefined;
  // Retry metadata is necessary only while its original bearer can be used.
  if (next.operation) {
    try { if ((JSON.parse(next.operation.grant) as { exp: number }).exp * 1000 <= now) delete next.operation; }
    catch { delete next.operation; }
  }
  return next;
}
export function consentInstruction(value: ConsentInstruction | undefined, now = Date.now()): Consent {
  const instruction = liveInstruction(value, now);
  const allowed = (k: ConsentSwitch) => instruction?.[k]?.value === true && instruction[k]!.chosenAt <= now;
  return { tracking: allowed('tracking'), personalization: allowed('personalization'), ...(instruction ? { instruction } : {}) };
}
export function consentDeadline(consent: Consent, purpose: 'tracking' | 'personalization'): number {
  const c = storedConsent(consent);
  return purpose === 'tracking' ? c.tracking ? c.instruction!.tracking!.expiresAt : 0
    : personalizes(c) ? Math.min(c.instruction!.tracking!.expiresAt, c.instruction!.personalization!.expiresAt) : 0;
}
/** A response projection, deliberately absent from JSON/raw behavioral storage. */
export function withConsent<T extends object>(value: T, consent: Consent): T & { consent: Consent } {
  return Object.defineProperty(value, 'consent', { value: consent, configurable: true, enumerable: false }) as T & { consent: Consent };
}
export function carryConsent(source: Consent, scope: { tenant: string; subject: string }, target?: Consent): Consent {
  const original = storedConsent(source);
  const current = target?.instruction ? intersectConsent(original, target) : original;
  if (!current.instruction) return { ...REFUSING };
  const next = { ...current.instruction, tenant: scope.tenant, subject: scope.subject, operation: undefined };
  for (const key of CONSENT_SWITCHES) if (next[key]) next[key] = { ...next[key]!, value: current[key] };
  return consentInstruction(next);
}
export interface ConsentOperation { id: string; expectedRevision: string | null; grantId: string; iat: number; exp: number }
export function chooseConsent(value: unknown, patch: Partial<Record<ConsentSwitch, boolean>>, operation: ConsentOperation,
  principal: { tenant: string; subject: string; grantId?: string; authorityEpoch?: string; iat: number; exp: number }, now = Date.now()): ConsentInstruction {
  if (!operation || typeof operation.id !== 'string' || !/^[A-Za-z0-9_-]{1,96}$/.test(operation.id)
    || !(operation.expectedRevision === null || typeof operation.expectedRevision === 'string')
    || !principal.grantId || operation.grantId !== principal.grantId || operation.iat !== principal.iat || operation.exp !== principal.exp
    || principal.iat * 1000 > now || principal.exp * 1000 <= now || principal.exp - principal.iat > 86400
    || !CONSENT_SWITCHES.some(k => typeof patch[k] === 'boolean')
    || Object.keys(patch).some(k => !CONSENT_SWITCHES.includes(k as ConsentSwitch) || typeof patch[k as ConsentSwitch] !== 'boolean')) throw new Error('Invalid explicit consent choice');
  const original = storedConsent(value).instruction;
  if (original) instructionOf(original, principal);
  const current = liveInstruction(original, now);
  const request = { id: operation.id, grant: JSON.stringify({ grantId: principal.grantId, authorityEpoch: principal.authorityEpoch, iat: principal.iat, exp: principal.exp }),
    expected: operation.expectedRevision, ...patch };
  if (current?.operation?.id === operation.id) {
    if (JSON.stringify(current.operation) !== JSON.stringify(request)) throw new Error('Consent choice conflict');
    return current;
  }
  if ((current?.revision ?? null) !== operation.expectedRevision) throw new Error('Consent choice conflict');
  const next: ConsentInstruction = { ...(current ?? {}), version: 1, tenant: principal.tenant, subject: principal.subject,
    revision: operation.id, operation: request };
  for (const key of CONSENT_SWITCHES) if (typeof patch[key] === 'boolean') next[key] = { value: patch[key]!, chosenAt: now, expiresAt: now + CONSENT_LIFETIME_MS };
  return next;
}

/** Transition hints can withdraw a switch, never enable one. */
export function refusalHints(value: unknown): Consent {
  const v = value as Partial<Consent> | null;
  return { tracking: v?.tracking !== false, personalization: v?.personalization !== false };
}

export function intersectConsent(...values: Consent[]): Consent {
  const result: Consent = { tracking: values.every(v => v.tracking), personalization: values.every(v => v.personalization) };
  const records = values.flatMap(v => v.instruction ? [instructionOf(v.instruction)!] : []);
  if (records.length) {
    const next = { ...records[0]! };
    for (const k of CONSENT_SWITCHES) {
      const choices = records.flatMap(r => r[k] ? [r[k]!] : []).sort((a, b) => a.expiresAt - b.expiresAt);
      if (choices[0]) next[k] = { ...choices[0], value: result[k] };
    }
    result.instruction = liveInstruction(next);
    const current = consentInstruction(result.instruction);
    result.tracking &&= current.tracking; result.personalization &&= current.personalization;
  }
  return result;
}

/** Missing and legacy booleans are OFF; malformed state remains an error. */
export function storedConsent(value: unknown): Consent {
  if (value === undefined) return { ...REFUSING };
  if (value === null) throw new Error('Consent state unavailable');
  const v = value as Partial<Consent> & Partial<ConsentInstruction>;
  if (v.version === 1) return consentInstruction(instructionOf(v));
  if (typeof v.tracking !== 'boolean' || typeof v.personalization !== 'boolean') throw new Error('Consent state unavailable');
  const c = consentInstruction(instructionOf(v.instruction));
  const result = { ...c, tracking: c.tracking && v.tracking, personalization: c.personalization && v.personalization };
  if (c.instruction) {
    result.instruction = { ...c.instruction };
    for (const key of CONSENT_SWITCHES) if (result.instruction[key] && !result[key]) result.instruction[key] = { ...result.instruction[key]!, value: false };
  }
  return result;
}

const flag = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : fallback);

/** Request-only current-owner projection; legacy preferences grant no purpose. */
export function consentOf(src: {
  preferences?: { trackingConsent?: unknown; personalizationEnabled?: unknown } | null;
  consent?: { tracking?: unknown; personalization?: unknown; instruction?: ConsentInstruction } | null;
} | null | undefined): Consent {
  const current = storedConsent(src?.consent ?? undefined);
  return current;
}

/** From the request's cookies, which the session host mirrors the preferences into. */
export function consentFromCookies(cookieHeader: string | null | undefined): Consent {
  const jar: Record<string, string> = {};
  for (const part of (cookieHeader ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0) jar[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return { tracking: flag(jar.opt_tracking_consent, true), personalization: flag(jar.opt_personalization_enabled, true) };
}

/** Whether the engine may personalize for this shopper at all. */
export const personalizes = (c: Consent): boolean => c.tracking && c.personalization;

/**
 * The arm the shopper actually gets: the site's defaults unless both switches are on.
 *
 * W21 E1.02 (F07 §1.4) rules that the refusing shopper is recorded `ineligible`
 * rather than `default`, so the control arm holds randomised controls only. The
 * vocabulary for it is in place (`Arm`, `personalizingArm`, the report and the
 * documentation) and the value is NOT yet served, because two shipped
 * assertions lock the present answer and an implementer may not edit a test:
 * `src/content/consent.test.ts:222-223` ("forces the default arm when either
 * switch is off", on this function) and `src/content/consent.test.ts:272`
 * (`expect(defaults.arm).toBe('default')` on the mounted service). Changing one
 * word here serves the ruled value; the ruling on those two assertions is the
 * lead's (R10).
 */
export const armUnder = (c: Consent, arm: Arm): Arm => (personalizes(c) ? arm : 'default');
