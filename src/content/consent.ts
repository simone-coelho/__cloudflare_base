// src/content/consent.ts
// CW31 (BTIE D10), the content service's half of consent. Two switches the
// session has always stored and nothing honoured: `trackingConsent` and
// `personalizationEnabled`. Either off means the shopper gets the site's own
// defaults, the holdout's `default` arm, whatever the hash would have said.
// Tracking off also means the engine writes nothing about the request: no
// decision record, no ring, no exposure, no outcome. Absent means consenting,
// which is what every stored session and every object already says today.
//
// The session host carries the switches on `preferences`; the shopper object
// reports them as `consent: { tracking, personalization }` on its snapshot and
// on its ingest envelope (the delivery session's half); the SDK's cookies
// mirror them for the paths that only see the request.

import type { Arm } from './types';

export interface Consent { tracking: boolean; personalization: boolean }
export const CONSENTING: Consent = { tracking: true, personalization: true };

const flag = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : fallback);

/** From a session's preferences or an object's `consent` block; anything missing reads as consenting. */
export function consentOf(src: {
  preferences?: { trackingConsent?: unknown; personalizationEnabled?: unknown } | null;
  consent?: { tracking?: unknown; personalization?: unknown } | null;
} | null | undefined): Consent {
  const tracking = flag(src?.consent?.tracking, flag(src?.preferences?.trackingConsent, true));
  const personalization = flag(src?.consent?.personalization, flag(src?.preferences?.personalizationEnabled, true));
  return { tracking, personalization };
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

/** The arm the shopper actually gets: the site's defaults unless both switches are on. */
export const armUnder = (c: Consent, arm: Arm): Arm => (personalizes(c) ? arm : 'default');
