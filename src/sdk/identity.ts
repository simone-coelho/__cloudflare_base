// src/sdk/identity.ts
// First-party identity, no fingerprinting. The visitor id is what every event
// and every decision is keyed on, and what the shopper's own object is named
// by, so it must be the same across tabs and reloads: localStorage first, the
// cookie as fallback, both written. The formats are the demo storefront's,
// verbatim, so a visitor known to the demo is the same visitor to the SDK.

import { ENTRY_TERM_LIMIT } from '../services/visit';
import type { EntrySignals, Host } from './types';

export const DEFAULT_VISITOR_KEY = 'opt_visitor_id';
const YEAR_SECONDS = 60 * 60 * 24 * 365;

export function mintVisitorId(host: Host, key = DEFAULT_VISITOR_KEY): string {
  let id: string | null = null;
  try { id = host.storage.get(key); } catch { /* storage may be unavailable */ }
  if (!id) { try { id = host.cookie.get(key); } catch { /* cookies may be blocked */ } }
  if (!id) id = freshVisitorId(host);
  writeVisitorId(host, key, id);
  return id;
}

/** A brand-new anonymous visitor id, the format the storefront mints. */
export function freshVisitorId(host: Host): string {
  return `vis-${host.uuid()}`;
}

/** Both stores, the same format: what identify() and logout() write when the id changes (CW25). */
export function writeVisitorId(host: Host, key: string, id: string): void {
  try { host.storage.set(key, id); } catch { /* ignore */ }
  try { host.cookie.set(key, id, YEAR_SECONDS); } catch { /* ignore */ }
}

/** Per page load, for legacy capture paths that still key on it. */
export function mintAnonId(host: Host): string {
  return `v-${host.uuid().replace(/-/g, '').slice(0, 9).toUpperCase()}`;
}

/**
 * The browsing session: one id across page loads and tabs until the shopper has been idle for
 * `idleMs` (30 minutes by default, the convention analytics tools share). Kept in storage as
 * `{ id, at }`; every event touches `at`. This is the session attribution's "session scope" means:
 * the decision carries it and the outcome carries it, so the two can be compared.
 */
export const DEFAULT_SESSION_KEY = 'opt_session';
export const DEFAULT_SESSION_IDLE_MS = 30 * 60 * 1000;

export function currentSessionId(host: Host, key = DEFAULT_SESSION_KEY, idleMs = DEFAULT_SESSION_IDLE_MS): string {
  const now = host.now();
  let stored: { id?: unknown; at?: unknown } | null = null;
  try { const raw = host.storage.get(key); stored = raw ? (JSON.parse(raw) as { id?: unknown; at?: unknown }) : null; } catch { stored = null; }
  const id = stored && typeof stored.id === 'string' && typeof stored.at === 'number' && now - stored.at < idleMs ? stored.id : mintSessionId(host);
  try { host.storage.set(key, JSON.stringify({ id, at: now })); } catch { /* storage may be unavailable: the id lives for this load */ }
  return id;
}

export function mintSessionId(host: Host): string {
  return `s-${host.now().toString(36).toUpperCase()}${host.uuid().replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

/** Explicit identity changes rotate attribution, independently of profile authority. */
export function rotateBrowsingSession(host: Host, key = DEFAULT_SESSION_KEY): void {
  try { host.storage.set(key, JSON.stringify({ id: `s-${host.uuid()}`, at: host.now() })); } catch { /* unavailable storage */ }
}

/**
 * How this page load arrived: captured once from the current document and sent
 * with every action, because the client cannot know which event will be the
 * one that crosses a visit boundary. The server decides that.
 */
export function entrySignals(host: Host): EntrySignals {
  let utmMedium = '', utmSource = '', utmTerm = '';
  try {
    const usp = new URLSearchParams(host.location?.search ?? '');
    utmMedium = usp.get('utm_medium') ?? '';
    utmSource = usp.get('utm_source') ?? '';
    // The campaign's search keyword, for the slots that publish a contextual
    // seed rule for it. Refused rather than trimmed at its own bound, the same
    // one the server boundary enforces: a truncated keyword is a DIFFERENT
    // keyword, and it could seed a rule this arrival is not evidence for. The
    // rest of the arrival still travels, so an overlong term costs the term only.
    utmTerm = usp.get('utm_term') ?? '';
    if (utmTerm.length > ENTRY_TERM_LIMIT) utmTerm = '';
  } catch { /* no search */ }
  // Absent stays absent: a page load with no keyword carries no keyword field,
  // so the arrival every other page load sends is unchanged.
  return { utmMedium, utmSource, ...(utmTerm ? { utmTerm } : {}),
    referrer: host.referrer ?? '', siteHost: host.location?.hostname ?? '' };
}
