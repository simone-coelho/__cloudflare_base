// src/services/visit.ts
// ---------------------------------------------------------------------------
// Visit boundaries and entry channel: the two dimensions Mandeep named and the
// two levels doc 22's pooling ladder leans on hardest.
//
// WHY THIS EXISTS. The stored session record has a 30-day TTL, so it already
// spans visits, and `metadata.sessionCount` was incremented inside
// createOrUpdateSession, which runs on every call. It counted events. A shopper
// who fired twelve events on her first visit read as "4 or more", and that number
// was surfaced to the decision layer as `session_count` and forwarded to ODP.
//
// That is worse than a missing dimension. Doc 22 section 5.4 pools evidence up a
// ladder whose levels are channel, then visit bucket, then region, then affinity
// cell, and a missing level degrades gracefully: pooling falls back to the
// nearest populated ancestor and says so in the explain record. A WRONG level
// does not. It attributes a real outcome to a cell the shopper was never in, and
// nothing surfaces as an error.
//
// Everything here is pure. The boundary rule, the bucket cut and the channel
// table are the parts worth arguing about, so they are the parts that can be
// tested without a KV binding or a Request.
// ---------------------------------------------------------------------------

import { deviceClassOf, type DeviceClass } from './platform';

/**
 * Idle gap that ends a visit. Thirty minutes is the long-standing analytics
 * convention, which matters here for a specific reason: the customer will
 * reconcile our visit counts against their own analytics, and a number that
 * disagrees with their tool is a number we spend a meeting defending.
 */
export const VISIT_GAP_MS = 30 * 60 * 1000;

/** Doc 22 section 5.4's visit bucket. */
export type VisitBucket = '1' | '2-3' | '4+';

/**
 * P37 (decision D2, ruling R-P47): the recency of a visit, from the shopper's
 * stored last visit to the moment this visit opens, in whole days: the same
 * day (under one full day), within 7 days (1 to 7 full days), 8 to 30 days (at
 * least 8 and fewer than 30 full days) and 30 and more (30 full days or more).
 * A first visit has none: there is no stored last visit to measure from.
 */
export type RecencyBucket = 'same_day' | 'within_7_days' | '8_to_30_days' | '30_and_more';
/** The vocabulary a `recency` seed rule may name, exactly, in order. */
export const RECENCY_BUCKETS: readonly RecencyBucket[] = ['same_day', 'within_7_days', '8_to_30_days', '30_and_more'];
/** The bucket itself when it is one of the four, else null. */
export function recencyBucketOf(value: unknown): RecencyBucket | null {
  return value === 'same_day' || value === 'within_7_days' || value === '8_to_30_days' || value === '30_and_more' ? value : null;
}
/**
 * The bucket of the whole days from the stored last visit's start to `now`, or
 * undefined when there is no usable stored last visit (a first visit, a record
 * written before the visit was kept, a clock that runs backwards): unknown stays
 * unknown, never a guess.
 */
export function recencyOf(lastVisitAt: number | null | undefined, now: number): RecencyBucket | undefined {
  if (typeof lastVisitAt !== 'number' || !Number.isFinite(lastVisitAt) || !Number.isFinite(now) || now < lastVisitAt) return undefined;
  // Whole days of 24 hours (86 400 000 ms), counted down: 29 days and 23 hours is 29.
  const days = Math.floor((now - lastVisitAt) / 86_400_000);
  return days < 1 ? 'same_day' : days <= 7 ? 'within_7_days' : days < 30 ? '8_to_30_days' : '30_and_more';
}

/** Doc 22 section 5.4's channel values. */
export type EntryChannel =
  | 'direct' | 'paid_social' | 'paid_search' | 'email' | 'organic' | 'referral';
/** The six channel words, the channel values of every tenant that publishes no context vocabulary. */
export const ENTRY_CHANNELS: readonly EntryChannel[] = ['direct', 'paid_social', 'paid_search', 'email', 'organic', 'referral'];

/**
 * P36: a value of a tenant's context vocabulary — a channel, a source platform
 * or a landing-page type — is an id: lower case letters, digits and
 * underscores, starting with a letter, at most 64 characters. `unknown` and
 * `any` are the cell's and the order context's own words, so they are never an id.
 */
export const CONTEXT_ID = /^[a-z][a-z0-9_]{0,63}$/;
export const isContextId = (v: unknown): v is string => typeof v === 'string' && CONTEXT_ID.test(v) && v !== 'unknown' && v !== 'any';

/**
 * P36 (decision D1): one published classification rule. Every condition it
 * names must hold: `utmMedium` lists mediums; `utmSource` lists sources, each
 * matched whole or as a token of a token-form source; `utmCampaign` lists
 * tokens of the campaign; `referrer` is `none` (a page view whose referrer is
 * empty or the site's own host), `external` (a referrer host that is not the
 * site's own) or registrable domains (dot-boundary); `untagged` means no
 * utm_medium, utm_source or utm_campaign is declared.
 */
export interface ChannelRule {
  channel: string;
  utmMedium?: string[];
  utmSource?: string[];
  utmCampaign?: string[];
  referrer?: 'none' | 'external' | string[];
  untagged?: true;
}

/**
 * P36: the learn document's member `contextVocabulary`, a tenant's published,
 * versioned context settings: its channel values and the rules that classify an
 * arrival into them, its source platforms and the networks that name them, its
 * landing-page types, and optionally its visit-bucket cut and ladder depth.
 */
export interface ContextVocabulary {
  channels: Array<{ id: string; name: string }>;
  rules: ChannelRule[];
  sourcePlatforms: Array<{ id: string; name: string; networks: string[] }>;
  landingPageTypes: Array<{ id: string; name: string }>;
  /** Whole-number lower bounds ascending from 1; omitted: today's cut [1, 2, 4]. */
  visitBuckets?: number[];
  /** Today's order c, v, s, r, a (R-P51) and the depth consulted; omitted: depth 5. */
  ladder?: { order: string[]; depth: number };
}

/**
 * P36: the published vocabulary as an arrival is classified under it, with the
 * learn revision that published it (recorded beside what it classified).
 */
export interface PublishedVocabulary { revision: number; vocabulary: ContextVocabulary }

export interface ChannelSignals {
  utmMedium?: string | null;
  utmSource?: string | null;
  /**
   * The paid search keyword the campaign declared (`utm_term`). It is an arrival
   * SIGNAL and nothing else: a keyword is what the shopper typed, never evidence
   * of a channel, so `classifyEntryChannel` never reads it, and it is never
   * persisted to the shopper record, the cell or any downstream payload.
   */
  utmTerm?: string | null;
  /**
   * P36: the campaign name the link declared (`utm_campaign`). Read only by a
   * tenant's published `utmCampaign` rule (the brand split); today's classifier
   * never reads it, and it is never persisted.
   */
  utmCampaign?: string | null;
  /** Full referrer URL or bare host; both are accepted. */
  referrer?: string | null;
  /** The site's own host, so a same-site referrer is not read as a referral. */
  siteHost?: string | null;
}

/** The same bounded input contract at HTTP, socket and snapshot boundaries. */
export const ENTRY_QUERY_LIMIT = 4096;
const ENTRY_LIMITS = { utmMedium: 128, utmSource: 256, utmTerm: 256, utmCampaign: 256, referrer: 2048, siteHost: 253 } as const;
/** P36: the bound on a campaign name, the same one `utm_source` carries. */
export const ENTRY_CAMPAIGN_LIMIT: number = ENTRY_LIMITS.utmCampaign;
/** The bound on a campaign term, the same one `utm_source` carries. */
export const ENTRY_TERM_LIMIT: number = ENTRY_LIMITS.utmTerm;
/** The one place a host string is parsed: a full URL, or a bare authority. Null when unusable. */
function parsed(value: string): URL | null {
  try { return new URL(value.includes('://') ? value : `https://${value}`); } catch { return null; }
}
/**
 * The host of an authority a document actually reported: a bare hostname, or the
 * `hostname[:port]` form `location.host` produces. Returns the ASCII, lower-cased
 * hostname URL parsing normalizes the name to, or `''` when the value is not that
 * form — a scheme, a path, a query, a fragment, credentials, whitespace or free
 * text is not an authority, and a port URL parsing itself refuses is not a port.
 *
 * The test is structural rather than a string comparison against the input,
 * because parsing normalizes: it DROPS the scheme's default port (`host:443`
 * parses with an empty `port`, so `url.host` is not the input) and rewrites an
 * internationalized name into its punycode form.
 */
function authorityHost(value: string): string {
  if (value === '' || /[/\\?#@\s]/.test(value)) return '';
  const url = parsed(value);
  if (!url) return '';
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '' || url.username !== '' || url.password !== '') return '';
  // Whatever follows the authority's port separator must be the port itself, so
  // a bare trailing colon is not the `hostname[:port]` form. An IPv6 literal
  // carries its own colons inside brackets.
  const separator = value.indexOf(':', value.startsWith('[') ? value.indexOf(']') + 1 : 0);
  if (separator !== -1 && !/^[0-9]+$/.test(value.slice(separator + 1))) return '';
  return url.hostname;
}
/**
 * A fully-qualified name ends in the empty root label. `www.google.com.` and
 * `www.google.com` are the same host, so the root label is stripped before any
 * comparison; it is never stripped from the ACCEPTED value, which is the
 * spelling the document reported.
 */
function rootStripped(host: string): string {
  return host.endsWith('.') ? host.slice(0, -1) : host;
}
/** A hostname and nothing else: a URL, a path or free text does not round-trip. */
function isHostname(value: string): boolean {
  const host = authorityHost(value);
  return host !== '' && host.length <= ENTRY_LIMITS.siteHost;
}
/**
 * Which fields must carry a host. `siteHost` always does: it is compared with
 * the referrer's host, so a site host that is a URL, a path or free text cannot
 * match and silently relabels a real external arrival as `direct`. `referrer`
 * accepts a full URL on the live-event path, and is host-only where a boundary
 * carries it in a query string.
 */
function hostField(key: string, hostOnly: boolean): boolean {
  return key === 'siteHost' || (hostOnly && key === 'referrer');
}
export function validEntry(value: unknown, hostOnly = false): value is ChannelSignals | undefined {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, v]) => Object.hasOwn(ENTRY_LIMITS, key)
    && (v === undefined || (typeof v === 'string' && v.length <= ENTRY_LIMITS[key as keyof typeof ENTRY_LIMITS]
      && (!hostField(key, hostOnly) || v === '' || isHostname(v)))));
}

/** Request channel is a vocabulary, never a free-form statistics key. */
export function entryChannelOf(value: unknown): EntryChannel | null {
  if (typeof value !== 'string') return null;
  const channel = value.trim().toLowerCase();
  return (ENTRY_CHANNELS as readonly string[]).includes(channel) ? channel as EntryChannel : null;
}

/**
 * P36: the channel a value names in the vocabulary in force — one of the six
 * words for a tenant without the settings, one of the tenant's published channel
 * ids otherwise — or null. Trimmed and lower-cased as `entryChannelOf` reads.
 */
export function channelIn(value: unknown, channels: ReadonlySet<string> | null | undefined): string | null {
  if (!channels) return entryChannelOf(value);
  if (typeof value !== 'string') return null;
  const channel = value.trim().toLowerCase();
  return channels.has(channel) ? channel : null;
}

/**
 * R14: `direct` is a real page view on the site's own host — a present, valid
 * `siteHost` with a referrer the document actually reported (empty or same-site).
 * An absent referrer, or an empty or invalid site host, is missing evidence.
 */
function pageView(entry: ChannelSignals): boolean {
  return typeof entry.referrer === 'string' && siteOf(entry.siteHost) !== '';
}

/**
 * The channel an arrival is evidence OF, which is not the same question as the
 * classifier's. `classifyEntryChannel` always answers with one of the six values
 * and `direct` is its terminal fallback, so anything that STORES the answer asks
 * first whether the arrival reports anything at all: an unrecognized campaign
 * tag with no referrer and no site host is not evidence of a direct arrival, and
 * unknown stays unknown (R14, unit W16.C2.04).
 */
function observedChannel(entry?: ChannelSignals, vocabulary?: ContextVocabulary | null): string | undefined {
  if (!validEntry(entry) || !entry || !Object.values(entry).some(v => typeof v === 'string')) return undefined;
  // P36: a tenant's published mapping classifies, first rule that holds; an
  // arrival no rule names records unknown, never a guess (R-P9, R-P23 C10).
  if (vocabulary) return classifyByVocabulary(entry, vocabulary) ?? undefined;
  const channel = classifyEntryChannel(entry);
  return channel !== 'direct' || pageView(entry) ? channel : undefined;
}

/** P36: a source or campaign split into its tokens, on `_`, `-` and white space. */
const tokensOf = (value: string): string[] => value.split(/[\s_-]+/).filter(token => token !== '');

/** P36: whether every condition a published rule names holds for this arrival. */
function ruleHolds(rule: ChannelRule, entry: ChannelSignals): boolean {
  const medium = norm(entry.utmMedium), source = norm(entry.utmSource), campaign = norm(entry.utmCampaign);
  if (rule.utmMedium && (medium === '' || !rule.utmMedium.some(m => norm(m) === medium))) return false;
  if (rule.utmSource && (source === '' || !rule.utmSource.some(s => {
    const wanted = norm(s);
    return wanted === source || (!source.includes('.') && tokensOf(source).includes(wanted));
  }))) return false;
  if (rule.utmCampaign && (campaign === '' || !rule.utmCampaign.some(t => tokensOf(campaign).includes(norm(t))))) return false;
  if (rule.untagged === true && (medium !== '' || source !== '' || campaign !== '')) return false;
  if (rule.referrer !== undefined) {
    const host = hostOf(norm(entry.referrer)), site = siteOf(entry.siteHost);
    const sameSite = host !== '' && site !== '' && (host === site || host.endsWith(`.${site}`));
    if (rule.referrer === 'none') { if (!pageView(entry) || (host !== '' && !sameSite)) return false; }
    else if (rule.referrer === 'external') { if (host === '' || sameSite) return false; }
    else if (!matches(host, rule.referrer.map(domain => norm(domain)))) return false;
  }
  return true;
}

/** P36: the channel the tenant's published rules give this arrival — the first rule that holds — or null. */
export function classifyByVocabulary(entry: ChannelSignals, vocabulary: ContextVocabulary): string | null {
  for (const rule of vocabulary.rules) if (ruleHolds(rule, entry)) return rule.channel;
  return null;
}

/**
 * P36: the source platform an arrival names under the tenant's published
 * platforms: a utm_source that is a host, or a token-form utm_source naming a
 * recognised network (the classifier's own tokens and aliases), is the
 * declaration and is read first; else the referrer's host. A platform names a
 * network by the registrable domains it lists (dot-boundary). None: absent.
 */
export function sourcePlatformOf(entry: ChannelSignals | null | undefined, vocabulary: ContextVocabulary): string | undefined {
  if (!entry || !validEntry(entry)) return undefined;
  const platforms = vocabulary.sourcePlatforms;
  const byHost = (host: string) => platforms.find(p => matches(host, p.networks.map(n => norm(n))))?.id;
  const source = norm(entry.utmSource);
  if (source !== '') {
    if (source.includes('.')) { const id = byHost(hostOf(source)); if (id) return id; }
    else for (const token of sourceTokens(source)) {
      if (!SOCIAL_SOURCES.has(token) && !SEARCH_SOURCES.has(token)) continue;
      const id = platforms.find(p => p.networks.some(n => norm(n).split('.')[0] === token))?.id;
      if (id) return id;
    }
  }
  return byHost(hostOf(norm(entry.referrer)));
}

/** P36: the landing-page type an event's `data.pageType` names, when it is one of the tenant's ids. */
export function landingPageTypeOf(pageType: unknown, vocabulary: ContextVocabulary): string | undefined {
  if (typeof pageType !== 'string') return undefined;
  const id = pageType.trim().toLowerCase();
  return vocabulary.landingPageTypes.some(t => t.id === id) ? id : undefined;
}

/** Snapshot URLs carry host-only referrers; raw URL/path/query is never sent. */
export function snapshotEntry(entry: ChannelSignals): string | undefined {
  const referrer = typeof entry.referrer === 'string' ? hostOf(entry.referrer) : entry.referrer;
  if (entry.referrer && !referrer) return undefined;
  const value = { ...entry, ...(entry.referrer === undefined ? {} : { referrer }) };
  if (!validEntry(value, true) || !Object.values(value).some(v => typeof v === 'string')) return undefined;
  const json = JSON.stringify(value);
  return json.length <= ENTRY_QUERY_LIMIT ? json : undefined;
}

/**
 * The visit as it is stored inside the shopper's existing record. P36: a visit
 * classified under a tenant's published vocabulary may carry one of its channel
 * ids, its source platform and its landing-page type, and then names the learn
 * revision whose vocabulary classified it (`vocabularyRevision`). All three are
 * written only when there is something to write, so a tenant without the
 * settings stores exactly what it stored before.
 */
export interface VisitContext {
  visitCount?: number; lastVisitAt?: number; entryChannel?: string;
  sourcePlatform?: string; landingPageType?: string; vocabularyRevision?: number;
  /**
   * P37: the device class the request that opened this visit reported, and the
   * recency of this visit from the stored last visit. Written only by the event
   * that opens the visit, only when there is one, and carried for the visit.
   */
  device?: DeviceClass; recency?: RecencyBucket;
}
/** A positive whole revision: the mark of a visit classified under a published vocabulary. */
const vocabularyMark = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;
export function validVisitContext(value: unknown): value is VisitContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as VisitContext;
  // P36: only a visit marked with the vocabulary that classified it may carry a
  // value outside the six words; an unmarked unknown value stays invalid.
  const marked = vocabularyMark(v.vocabularyRevision);
  return (v.visitCount === undefined || (Number.isSafeInteger(v.visitCount) && v.visitCount >= 1))
    && (v.lastVisitAt === undefined || (Number.isSafeInteger(v.lastVisitAt) && v.lastVisitAt >= 0))
    && (v.vocabularyRevision === undefined || marked)
    && (v.entryChannel === undefined || entryChannelOf(v.entryChannel) === v.entryChannel || (marked && isContextId(v.entryChannel)))
    && (v.sourcePlatform === undefined || (marked && isContextId(v.sourcePlatform)))
    && (v.landingPageType === undefined || (marked && isContextId(v.landingPageType)))
    && (v.device === undefined || deviceClassOf(v.device) === v.device)
    && (v.recency === undefined || recencyBucketOf(v.recency) === v.recency);
}

/** P36: what an accepted event tells the visit beyond its arrival, and the published vocabulary it is read under. */
export interface VisitInputs {
  /** The tenant's published context vocabulary with its learn revision; absent or null: today's six words. */
  vocabulary?: PublishedVocabulary | null;
  /** The event's own `data.pageType`: the landing-page type when it names one of the vocabulary's ids. */
  pageType?: unknown;
  /** P37: the device class the event's own request reported (`deviceOf`); absent or null: no device. */
  device?: DeviceClass | null;
}

/** Whether a visit carries a value only a published vocabulary could have given it. */
const needsMark = (v: VisitContext): boolean =>
  (v.entryChannel !== undefined && entryChannelOf(v.entryChannel) !== v.entryChannel) || v.sourcePlatform !== undefined || v.landingPageType !== undefined;

/** Only an accepted live event uses this candidate; readers use projectVisit. */
export function liveVisit(previous: VisitContext | null | undefined, lastSeen: number | null | undefined, now: number, entry?: ChannelSignals, inputs?: VisitInputs): VisitContext {
  const prior = previous && validVisitContext(previous) ? previous : undefined;
  const opening = isNewVisit(lastSeen, now);
  const carried = !opening ? prior : undefined;
  const published = inputs?.vocabulary ?? null;
  const out: VisitContext = { visitCount: nextVisitCount(prior?.visitCount, lastSeen, now),
    lastVisitAt: opening ? now : prior?.lastVisitAt ?? now,
    entryChannel: carried?.entryChannel ?? observedChannel(entry, published?.vocabulary) };
  // P36: the source platform from the visit's arrival and the landing-page type
  // from its first event naming one of the tenant's types, kept for the visit;
  // written only when there is one, beside the revision that classified it.
  const sourcePlatform = carried?.sourcePlatform ?? (published ? sourcePlatformOf(entry, published.vocabulary) : undefined);
  const landingPageType = carried?.landingPageType ?? (published ? landingPageTypeOf(inputs?.pageType, published.vocabulary) : undefined);
  if (sourcePlatform !== undefined) out.sourcePlatform = sourcePlatform;
  if (landingPageType !== undefined) out.landingPageType = landingPageType;
  // P37: the visit's device and recency, written by the event that opens it —
  // the device its own request reported, the recency from the stored last
  // visit's start — and carried unchanged for the rest of the visit; each only
  // when there is one (a request reporting no device, a first visit).
  const device = opening ? deviceClassOf(inputs?.device) ?? undefined : carried?.device;
  const recency = opening ? recencyOf(prior?.lastVisitAt, now) : carried?.recency;
  if (device !== undefined) out.device = device;
  if (recency !== undefined) out.recency = recency;
  if (needsMark(out)) {
    const mark = published?.revision ?? carried?.vocabularyRevision;
    if (vocabularyMark(mark)) out.vocabularyRevision = mark;
  }
  return out;
}

/** P36: the visit as a decision reads it; `sourcePlatform` and `landingPageType` only when there is one. */
export interface ProjectedVisit { visitNumber: number | null; entryChannel: string | null; sourcePlatform?: string; landingPageType?: string }

/** Stable, non-mutating view: an unknown legacy count is not evidence of visit 1. */
export function projectVisit(previous: VisitContext | null | undefined, lastSeen: number | null | undefined, now: number, entry?: ChannelSignals,
  vocabulary?: ContextVocabulary | null): ProjectedVisit {
  const prior = previous && validVisitContext(previous) ? previous : undefined;
  const known = prior?.visitCount !== undefined && typeof lastSeen === 'number' && Number.isFinite(lastSeen) && lastSeen >= 0;
  const continuing = !isNewVisit(lastSeen, now) ? prior : undefined;
  const sourcePlatform = continuing?.sourcePlatform ?? (vocabulary ? sourcePlatformOf(entry, vocabulary) : undefined);
  const landingPageType = continuing?.landingPageType;
  return { visitNumber: known ? nextVisitCount(prior.visitCount, lastSeen, now) : null,
    entryChannel: continuing?.entryChannel ?? observedChannel(entry, vocabulary) ?? null,
    ...(sourcePlatform !== undefined ? { sourcePlatform } : {}), ...(landingPageType !== undefined ? { landingPageType } : {}) };
}

/**
 * P37: the arrival context a read answers beside the visit (`GET /realtime/reflex`
 * `arrival`): the device and the recency the visit in progress recorded; for a
 * visit that would open now, the recency the stored last visit gives it (the
 * device is the opening request's own, so none is claimed before it). Each
 * member only when there is one; a shopper with no stored visit answers {}.
 */
export interface ProjectedArrival { device?: DeviceClass; recency?: RecencyBucket }
export function projectArrival(previous: VisitContext | null | undefined, lastSeen: number | null | undefined, now: number): ProjectedArrival {
  const prior = previous && validVisitContext(previous) ? previous : undefined;
  if (!prior) return {};
  if (!isNewVisit(lastSeen, now)) return { ...(prior.device !== undefined ? { device: prior.device } : {}), ...(prior.recency !== undefined ? { recency: prior.recency } : {}) };
  const recency = recencyOf(prior.lastVisitAt, now);
  return recency !== undefined ? { recency } : {};
}

/** P36: a visit's context attributes and the revision that classified them, only those it records; P37: and its device and recency. */
export function visitContextMembers(v: VisitContext | null | undefined): Pick<VisitContext, 'sourcePlatform' | 'landingPageType' | 'vocabularyRevision' | 'device' | 'recency'> {
  return { ...(v?.sourcePlatform !== undefined ? { sourcePlatform: v.sourcePlatform } : {}),
    ...(v?.landingPageType !== undefined ? { landingPageType: v.landingPageType } : {}),
    ...(v?.vocabularyRevision !== undefined ? { vocabularyRevision: v.vocabularyRevision } : {}),
    ...(v?.device !== undefined ? { device: v.device } : {}),
    ...(v?.recency !== undefined ? { recency: v.recency } : {}) };
}

/** Existing link policy: sum known counts, take entry from the later visit start. */
export function mergeVisits(base?: VisitContext | null, from?: VisitContext | null): VisitContext {
  const a = base && validVisitContext(base) ? base : undefined, b = from && validVisitContext(from) ? from : undefined;
  const later = (b?.lastVisitAt ?? 0) > (a?.lastVisitAt ?? 0) ? b : a;
  return { visitCount: (a?.visitCount ?? 0) + (b?.visitCount ?? 0) || undefined,
    lastVisitAt: later?.lastVisitAt, entryChannel: later?.entryChannel,
    // P36: the later visit's own context attributes travel with its channel.
    ...visitContextMembers(later) };
}

// -- Visit boundaries -------------------------------------------------------

/** True when enough idle time has passed that this request begins a new visit. */
export function isNewVisit(
  lastSeenMs: number | null | undefined,
  nowMs: number,
  gapMs: number = VISIT_GAP_MS,
): boolean {
  if (lastSeenMs === null || lastSeenMs === undefined || !Number.isFinite(lastSeenMs)) return true;
  return nowMs - lastSeenMs >= gapMs;
}

/**
 * The visit number this request belongs to.
 *
 * Increments only on a boundary. Called on every event, it returns the same
 * number for every event in one visit, which is the whole point and the thing
 * `sessionCount` got wrong.
 */
export function nextVisitCount(
  previous: number | null | undefined,
  lastSeenMs: number | null | undefined,
  nowMs: number,
  gapMs: number = VISIT_GAP_MS,
): number {
  const prior = typeof previous === 'number' && Number.isFinite(previous) && previous >= 1
    ? Math.floor(previous)
    : 0;
  if (prior === 0) return 1;
  return isNewVisit(lastSeenMs, nowMs, gapMs) ? prior + 1 : prior;
}

/**
 * Doc 22's bucket, and Mandeep's own cut: most purchases land on the second and
 * third visit, so those three are one bucket and everything past them is another.
 */
export function visitBucket(visitCount: number | null | undefined): VisitBucket {
  const n = typeof visitCount === 'number' && Number.isFinite(visitCount) ? Math.floor(visitCount) : 1;
  if (n <= 1) return '1';
  if (n <= 3) return '2-3';
  return '4+';
}

// -- Entry channel ----------------------------------------------------------

const PAID_SEARCH_MEDIUMS = new Set(['cpc', 'ppc', 'paidsearch', 'paid_search', 'paid-search', 'sem', 'search_paid']);
const PAID_SOCIAL_MEDIUMS = new Set(['paid_social', 'paidsocial', 'paid-social', 'social_paid', 'display', 'banner']);
/**
 * A click declared paid without naming a cell: the RECOGNIZED NETWORK in the
 * source decides which paid cell it belongs to, and with no recognized network
 * there is no paid cell it can honestly join (unit W16.C2.11).
 */
const NETWORK_PAID_MEDIUMS = new Set(['paid', 'cpm']);
const EMAIL_MEDIUMS = new Set(['email', 'e-mail', 'e_mail', 'newsletter', 'crm']);
const ORGANIC_MEDIUMS = new Set(['organic', 'organic_search']);
const REFERRAL_MEDIUMS = new Set(['referral', 'affiliate', 'partner']);
const SOCIAL_MEDIUMS = new Set(['social', 'social_media', 'sm']);

const EMAIL_SOURCES = new Set(['klaviyo', 'mailchimp', 'braze', 'sfmc', 'salesforce_marketing_cloud', 'sendgrid', 'iterable', 'newsletter', 'email']);
/**
 * Entry networks are named by the domain they are registered under, because
 * that is the only part of a host a stranger cannot choose. A host belongs to a
 * network when it IS that domain or a dot-boundary subdomain of it, never when
 * it merely contains or begins with it: `www.google.com` and `search.brave.com`
 * are the network, `google.com.evil.example`, `notgoogle.com` and
 * `evilgoogle.co` are not (units W16.C2.01, W16.C2.02).
 *
 * A network reached in another market is registered under a DIFFERENT domain,
 * often on a country-code or multi-label public suffix, so each market is listed
 * against the network that owns it (unit W16.C2.10). There is deliberately no
 * generic "strip the last two or three labels" suffix rule anywhere: such a rule
 * would let anyone who registers `evilgoogle.co.uk` or `google.com.co.evil.example`
 * look like the network to the matcher. Serving a new market means adding its
 * suffix to that one network's list.
 */
const SEARCH_HOSTS = [
  // google, per market
  'google.com', 'google.ca', 'google.de', 'google.fr', 'google.it', 'google.es', 'google.nl', 'google.be', 'google.ch',
  'google.at', 'google.se', 'google.no', 'google.dk', 'google.fi', 'google.ie', 'google.pt', 'google.pl', 'google.cz',
  'google.sk', 'google.hu', 'google.ro', 'google.bg', 'google.gr', 'google.hr', 'google.si', 'google.lt', 'google.lv',
  'google.ee', 'google.rs', 'google.ru', 'google.cl', 'google.ae',
  'google.co.uk', 'google.co.in', 'google.co.jp', 'google.co.kr', 'google.co.id', 'google.co.th', 'google.co.nz',
  'google.co.za', 'google.co.il', 'google.com.au', 'google.com.br', 'google.com.mx', 'google.com.co', 'google.com.ar',
  'google.com.pe', 'google.com.tr', 'google.com.sa', 'google.com.eg', 'google.com.ng', 'google.com.hk', 'google.com.tw',
  'google.com.sg', 'google.com.my', 'google.com.ph', 'google.com.vn', 'google.com.ua',
  // yahoo, per market
  'yahoo.com', 'yahoo.ca', 'yahoo.de', 'yahoo.es', 'yahoo.fr', 'yahoo.it', 'yahoo.co.jp', 'yahoo.co.uk',
  'yahoo.com.au', 'yahoo.com.br', 'yahoo.com.mx',
  // yandex, per market
  'yandex.com', 'yandex.ru', 'yandex.by', 'yandex.kz', 'yandex.uz', 'yandex.com.tr',
  // the single-domain networks
  'bing.com', 'duckduckgo.com', 'ecosia.org', 'baidu.com', 'brave.com', 'startpage.com',
];
const SOCIAL_HOSTS = ['facebook.com', 'fb.com', 'fb.me', 'meta.com', 'instagram.com', 'tiktok.com', 'pinterest.com', 'snapchat.com',
  'twitter.com', 'x.com', 't.co', 'linkedin.com', 'lnkd.in', 'reddit.com', 'youtube.com', 'threads.net'];
/**
 * The same networks as a campaign DECLARES them in `utm_source`: a bare network
 * name rather than a host. Matched as a whole token, so `tiktok.evil.example` is
 * not TikTok; a source that is itself a host goes through the host rule instead.
 */
const SOCIAL_SOURCES = new Set(['facebook', 'fb', 'meta', 'instagram', 'tiktok', 'pinterest', 'snapchat', 'twitter', 'linkedin', 'reddit', 'youtube', 'threads']);
/** R27(b): the search networks a campaign names in `utm_source`, the same networks as above. */
const SEARCH_SOURCES = new Set(['google', 'bing', 'yahoo', 'duckduckgo', 'yandex', 'baidu', 'ecosia', 'brave', 'startpage']);
/**
 * Abbreviations a campaign builder writes instead of the network's name. An
 * alias names the NETWORK, so a resolved token is read exactly where the
 * network's own name is read (R25(a)); the list is explicit, never a prefix or
 * substring test.
 */
const SOURCE_ALIASES: Record<string, string> = { fb: 'facebook', ig: 'instagram', insta: 'instagram', yt: 'youtube', ddg: 'duckduckgo' };

function norm(v: string | null | undefined): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

/**
 * Host of a referrer that may be a full URL or a bare host, in the form the
 * network tables are written in: ASCII, lower case, no root label. Empty when
 * unusable.
 */
function hostOf(referrer: string): string {
  const url = referrer === '' ? null : parsed(referrer);
  return url ? rootStripped(url.hostname.toLowerCase()) : '';
}

/**
 * The site's own name, for the same-site comparison. Neither the port a page
 * reported nor the root label of a fully-qualified name is part of the site's
 * identity, and an internationalized name is compared in the ASCII form parsing
 * produces (units W16.C2.13, W16.C2.14).
 */
function siteOf(value: string | null | undefined): string {
  return typeof value === 'string' ? rootStripped(authorityHost(value.trim())) : '';
}

/** Exact host, or a dot-boundary subdomain of it. Never a substring or a prefix. */
const matches = (host: string, domains: string[]) =>
  host !== '' && domains.some((domain) => host === domain || host.endsWith(`.${domain}`));

/**
 * A `utm_source` is written in one of two forms and R27(a) judges them by
 * different rules. A HOST form — anything containing a dot — is judged ONLY by
 * the host rule, so `facebook.attacker.example` is a stranger's host and not
 * Facebook. A TOKEN form (`facebook_ads`, `TikTok-Ads`, ` meta ads `) names the
 * network in one of its tokens, split on `_`, `-` and whitespace; `.` is not a
 * separator.
 */
function sourceTokens(source: string): string[] {
  return source.split(/[\s_-]+/).filter(token => token !== '').map(token => SOURCE_ALIASES[token] ?? token);
}

/** Does this `utm_source` name one of these networks, by token or by its own host? */
function declaresNetwork(source: string, names: Set<string>, hosts: string[]): boolean {
  if (source === '') return false;
  return source.includes('.') ? matches(hostOf(source), hosts) : sourceTokens(source).some(token => names.has(token));
}

const declaresSocial = (source: string) => declaresNetwork(source, SOCIAL_SOURCES, SOCIAL_HOSTS);
const declaresSearch = (source: string) => declaresNetwork(source, SEARCH_SOURCES, SEARCH_HOSTS);

/**
 * The network a value NAMES, canonically; null when it is not one this engine
 * knows. The vocabulary is the search and social tables above: every network is
 * named by the registrable domain it is registered under, so configuration that
 * names a network (a contextual seed rule, for one) can be refused where it is
 * authored — free text, a bare product name and a subdomain someone else can
 * register are all values that could otherwise only ever be silently inert.
 */
export function entryNetworkOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const domain = value.trim().toLowerCase();
  return SEARCH_HOSTS.includes(domain) || SOCIAL_HOSTS.includes(domain) ? domain : null;
}

/**
 * Whether an arrival came FROM that network: its referrer host, or a
 * `utm_source` that is itself a host, under the classifier's own dot-boundary
 * rule — so `instagram.com.evil.example` is not Instagram and neither is
 * `notinstagram.com`.
 */
export function arrivedFromNetwork(entry: ChannelSignals | null | undefined, network: string): boolean {
  const domain = entryNetworkOf(network);
  if (!entry || domain === null) return false;
  return matches(hostOf(norm(entry.referrer)), [domain]) || matches(norm(entry.utmSource), [domain]);
}

/**
 * Google's auto-tagged click: the `gclid` Google Ads appends to the landing URL
 * when auto-tagging is on, in place of any UTM tag. It is a CLASSIFICATION
 * input and deliberately not a member of `ChannelSignals`: the entry contract
 * (`validEntry`, W16 C2) still refuses any key it does not list, so no request
 * carries it yet. Widening that contract is the remediation track's ruling; the
 * classifier reads it already, so the ruling is one line at the boundary.
 */
export interface AutoTagSignals {
  /** The Google click id, as the landing URL carried it. Only its presence is read; the value is never kept. */
  gclid?: string | null;
}
/** A click id is an opaque token of about a hundred characters; anything empty or unbounded is not one. */
const GCLID_LIMIT = 512;
function autoTagged(signals: AutoTagSignals): boolean {
  const id = signals.gclid;
  return typeof id === 'string' && id.trim() !== '' && id.length <= GCLID_LIMIT;
}

/**
 * The source an arrival names: its declared `utm_source`; for an auto-tagged
 * click that declares none, the referrer's host when it is a search engine,
 * which is where Google's own click came from; otherwise null, never a guess.
 */
export function entrySourceOf(signals: ChannelSignals & AutoTagSignals): string | null {
  const source = norm(signals.utmSource);
  if (source !== '') return source;
  if (!autoTagged(signals)) return null;
  const host = hostOf(norm(signals.referrer));
  return matches(host, SEARCH_HOSTS) ? host : null;
}

/**
 * Classify the visit's entry into one of doc 22's six channels.
 *
 * Precedence is deliberate: a UTM tag is a DECLARATION by whoever built the link,
 * and it beats the referrer, which is merely where the click came from. Paid
 * traffic is often referred by the same hosts as organic, so without that order
 * a paid social click and an organic social click are indistinguishable.
 *
 * ONE MAPPING IS A JUDGEMENT CALL AND DOC 22 SHOULD RATIFY IT: an untagged click
 * from a social host is classed `referral`, not `organic`. In a six-value
 * grouping "organic" conventionally means organic SEARCH, and there is no
 * "organic social" bucket to put it in. Classing it organic would silently pool
 * untagged social alongside search, which are not comparable populations.
 */
export function classifyEntryChannel(signals: ChannelSignals & AutoTagSignals): EntryChannel {
  const medium = norm(signals.utmMedium);
  const source = norm(signals.utmSource);

  // An auto-tagged Google click that declares no source is a paid search click:
  // Google Ads wrote the click id, and without a declared source nothing else
  // names the network. Read before the referrer, which on such a click is the
  // search engine and would otherwise read as organic. A declared `utm_source`
  // is still the link builder's declaration and is judged by the rules below.
  if (source === '' && autoTagged(signals)) return 'paid_search';

  if (medium !== '') {
    // Meta's default campaign builder commonly emits utm_medium=cpc, and a bare
    // `paid` or `cpm` names no network at all. The declared source disambiguates
    // both BEFORE the generic paid-search table; otherwise a Facebook click
    // poisons the paid-search cell (unit W16.C2.03).
    if (PAID_SEARCH_MEDIUMS.has(medium) || NETWORK_PAID_MEDIUMS.has(medium)) {
      if (declaresSocial(source)) return 'paid_social';
      // R27(b): a medium that declares paid SEARCH names its own cell. A medium
      // that only says "paid" names none, so a recognized search network in the
      // source is what puts the click in the paid-search cell; with no
      // recognized network it belongs in neither paid cell, and the arrival's
      // own evidence answers instead — which, with nothing observed, is unknown
      // (R14, unit W16.C2.11).
      if (PAID_SEARCH_MEDIUMS.has(medium) || declaresSearch(source)) return 'paid_search';
    }
    else if (PAID_SOCIAL_MEDIUMS.has(medium)) return 'paid_social';
    else if (EMAIL_MEDIUMS.has(medium)) return 'email';
    else if (REFERRAL_MEDIUMS.has(medium)) return 'referral';
    else if (ORGANIC_MEDIUMS.has(medium)) return 'organic';
    // A bare `social` medium is ambiguous. Treat it as paid when the source is a
    // known ad platform, because that is what a campaign builder almost always
    // means by tagging it at all; otherwise it is a referral from that network.
    else if (SOCIAL_MEDIUMS.has(medium)) return declaresSocial(source) ? 'paid_social' : 'referral';
  }

  if (source !== '' && EMAIL_SOURCES.has(source)) return 'email';

  const host = hostOf(norm(signals.referrer));
  if (host === '') return 'direct';

  const site = siteOf(signals.siteHost);
  // A same-site referrer is internal navigation, not an entry. The visit keeps
  // whatever it was entered on rather than being relabelled mid-visit.
  if (site !== '' && (host === site || host.endsWith(`.${site}`))) return 'direct';

  if (matches(host, SEARCH_HOSTS)) return 'organic';
  return 'referral';
}

/** The two attribute names the engine and ODP already use for these dimensions. */
export interface VisitAttributes {
  visit_number: number;
  visit_bucket: VisitBucket;
  entry_channel: EntryChannel;
}

export function visitAttributes(visitCount: number, channel: EntryChannel): VisitAttributes {
  return { visit_number: visitCount, visit_bucket: visitBucket(visitCount), entry_channel: channel };
}
