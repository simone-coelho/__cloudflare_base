// src/sdk/identity.ts
// First-party identity, no fingerprinting. The visitor id is what every event
// and every decision is keyed on, and what the shopper's own object is named
// by, so it must be the same across tabs and reloads: localStorage first, the
// cookie as fallback, both written. The formats are the demo storefront's,
// verbatim, so a visitor known to the demo is the same visitor to the SDK.

import type { EntrySignals, Host } from './types';

export const DEFAULT_VISITOR_KEY = 'opt_visitor_id';
const YEAR_SECONDS = 60 * 60 * 24 * 365;

export function mintVisitorId(host: Host, key = DEFAULT_VISITOR_KEY): string {
  let id: string | null = null;
  try { id = host.storage.get(key); } catch { /* storage may be unavailable */ }
  if (!id) { try { id = host.cookie.get(key); } catch { /* cookies may be blocked */ } }
  if (!id) id = `vis-${host.uuid()}`;
  try { host.storage.set(key, id); } catch { /* ignore */ }
  try { host.cookie.set(key, id, YEAR_SECONDS); } catch { /* ignore */ }
  return id;
}

/** Per page load, for legacy capture paths that still key on it. */
export function mintAnonId(host: Host): string {
  return `v-${host.uuid().replace(/-/g, '').slice(0, 9).toUpperCase()}`;
}

export function mintSessionId(host: Host): string {
  return `s-${host.now().toString(36).toUpperCase()}`;
}

/**
 * How this page load arrived: captured once from the current document and sent
 * with every action, because the client cannot know which event will be the
 * one that crosses a visit boundary. The server decides that.
 */
export function entrySignals(host: Host): EntrySignals {
  let utmMedium = '', utmSource = '';
  try {
    const usp = new URLSearchParams(host.location?.search ?? '');
    utmMedium = usp.get('utm_medium') ?? '';
    utmSource = usp.get('utm_source') ?? '';
  } catch { /* no search */ }
  return { utmMedium, utmSource, referrer: host.referrer ?? '', siteHost: host.location?.hostname ?? '' };
}
