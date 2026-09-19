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

/**
 * Idle gap that ends a visit. Thirty minutes is the long-standing analytics
 * convention, which matters here for a specific reason: the customer will
 * reconcile our visit counts against their own analytics, and a number that
 * disagrees with their tool is a number we spend a meeting defending.
 */
export const VISIT_GAP_MS = 30 * 60 * 1000;

/** Doc 22 section 5.4's visit bucket. */
export type VisitBucket = '1' | '2-3' | '4+';

/** Doc 22 section 5.4's channel values. */
export type EntryChannel =
  | 'direct' | 'paid_social' | 'paid_search' | 'email' | 'organic' | 'referral';

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
  /** Full referrer URL or bare host; both are accepted. */
  referrer?: string | null;
  /** The site's own host, so a same-site referrer is not read as a referral. */
  siteHost?: string | null;
}

/** The same bounded input contract at HTTP, socket and snapshot boundaries. */
export const ENTRY_QUERY_LIMIT = 4096;
const ENTRY_LIMITS = { utmMedium: 128, utmSource: 256, utmTerm: 256, referrer: 2048, siteHost: 253 } as const;
/** The bound on a campaign term, the same one `utm_source` carries. */
export const ENTRY_TERM_LIMIT: number = ENTRY_LIMITS.utmTerm;
/** A hostname and nothing else: a URL, a path or free text does not round-trip. */
function isHostname(value: string): boolean {
  return value.length <= ENTRY_LIMITS.siteHost && hostOf(value) === value.toLowerCase();
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
  return ['direct', 'paid_social', 'paid_search', 'email', 'organic', 'referral'].includes(channel) ? channel as EntryChannel : null;
}

/**
 * R14: `direct` is a real page view on the site's own host — a present, valid
 * `siteHost` with a referrer the document actually reported (empty or same-site).
 * An absent referrer, or an empty or invalid site host, is missing evidence.
 */
function pageView(entry: ChannelSignals): boolean {
  return typeof entry.referrer === 'string' && norm(entry.siteHost) !== '';
}

/**
 * The channel an arrival is evidence OF, which is not the same question as the
 * classifier's. `classifyEntryChannel` always answers with one of the six values
 * and `direct` is its terminal fallback, so anything that STORES the answer asks
 * first whether the arrival reports anything at all: an unrecognized campaign
 * tag with no referrer and no site host is not evidence of a direct arrival, and
 * unknown stays unknown (R14, unit W16.C2.04).
 */
function observedChannel(entry?: ChannelSignals): EntryChannel | undefined {
  if (!validEntry(entry) || !entry || !Object.values(entry).some(v => typeof v === 'string')) return undefined;
  const channel = classifyEntryChannel(entry);
  return channel !== 'direct' || pageView(entry) ? channel : undefined;
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

export interface VisitContext { visitCount?: number; lastVisitAt?: number; entryChannel?: EntryChannel }
export function validVisitContext(value: unknown): value is VisitContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as VisitContext;
  return (v.visitCount === undefined || (Number.isSafeInteger(v.visitCount) && v.visitCount >= 1))
    && (v.lastVisitAt === undefined || (Number.isSafeInteger(v.lastVisitAt) && v.lastVisitAt >= 0))
    && (v.entryChannel === undefined || entryChannelOf(v.entryChannel) === v.entryChannel);
}

/** Only an accepted live event uses this candidate; readers use projectVisit. */
export function liveVisit(previous: VisitContext | null | undefined, lastSeen: number | null | undefined, now: number, entry?: ChannelSignals): VisitContext {
  const prior = previous && validVisitContext(previous) ? previous : undefined;
  const opening = isNewVisit(lastSeen, now);
  return { visitCount: nextVisitCount(prior?.visitCount, lastSeen, now),
    lastVisitAt: opening ? now : prior?.lastVisitAt ?? now,
    entryChannel: (!opening ? prior?.entryChannel : undefined) ?? observedChannel(entry) };
}

/** Stable, non-mutating view: an unknown legacy count is not evidence of visit 1. */
export function projectVisit(previous: VisitContext | null | undefined, lastSeen: number | null | undefined, now: number, entry?: ChannelSignals): { visitNumber: number | null; entryChannel: EntryChannel | null } {
  const prior = previous && validVisitContext(previous) ? previous : undefined;
  const known = prior?.visitCount !== undefined && typeof lastSeen === 'number' && Number.isFinite(lastSeen) && lastSeen >= 0;
  return { visitNumber: known ? nextVisitCount(prior.visitCount, lastSeen, now) : null,
    entryChannel: (!isNewVisit(lastSeen, now) ? prior?.entryChannel : undefined) ?? observedChannel(entry) ?? null };
}

/** Existing link policy: sum known counts, take entry from the later visit start. */
export function mergeVisits(base?: VisitContext | null, from?: VisitContext | null): VisitContext {
  const a = base && validVisitContext(base) ? base : undefined, b = from && validVisitContext(from) ? from : undefined;
  const later = (b?.lastVisitAt ?? 0) > (a?.lastVisitAt ?? 0) ? b : a;
  return { visitCount: (a?.visitCount ?? 0) + (b?.visitCount ?? 0) || undefined,
    lastVisitAt: later?.lastVisitAt, entryChannel: later?.entryChannel };
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
const PAID_SOCIAL_MEDIUMS = new Set(['paid_social', 'paidsocial', 'paid-social', 'social_paid', 'cpm', 'display', 'banner']);
/** A click declared paid without naming the network; the source decides which paid cell it belongs to. */
const PAID_MEDIUMS = new Set(['paid']);
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
 */
const SEARCH_HOSTS = ['google.com', 'bing.com', 'duckduckgo.com', 'yahoo.com', 'ecosia.org', 'baidu.com', 'yandex.com', 'brave.com', 'startpage.com'];
const SOCIAL_HOSTS = ['facebook.com', 'fb.com', 'fb.me', 'meta.com', 'instagram.com', 'tiktok.com', 'pinterest.com', 'snapchat.com',
  'twitter.com', 'x.com', 't.co', 'linkedin.com', 'lnkd.in', 'reddit.com', 'youtube.com', 'threads.net'];
/**
 * The same networks as a campaign DECLARES them in `utm_source`: a bare network
 * name rather than a host. Matched exactly, so `tiktok.evil.example` is not
 * TikTok; a source that is itself a host goes through the host rule instead.
 */
const SOCIAL_SOURCES = new Set(['facebook', 'fb', 'meta', 'instagram', 'tiktok', 'pinterest', 'snapchat', 'twitter', 'linkedin', 'reddit', 'youtube', 'threads']);

function norm(v: string | null | undefined): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

/** Host of a referrer that may be a full URL or a bare host. Empty when unusable. */
function hostOf(referrer: string): string {
  if (referrer === '') return '';
  try {
    return new URL(referrer.includes('://') ? referrer : `https://${referrer}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Exact host, or a dot-boundary subdomain of it. Never a substring or a prefix. */
const matches = (host: string, domains: string[]) =>
  host !== '' && domains.some((domain) => host === domain || host.endsWith(`.${domain}`));

/** A `utm_source` declares a social network by its name or by its own host. */
const declaresSocial = (source: string) => source !== '' && (SOCIAL_SOURCES.has(source) || matches(source, SOCIAL_HOSTS));

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
export function classifyEntryChannel(signals: ChannelSignals): EntryChannel {
  const medium = norm(signals.utmMedium);
  const source = norm(signals.utmSource);

  if (medium !== '') {
    // Meta's default campaign builder commonly emits utm_medium=cpc, and a bare
    // `paid` names no network at all. The declared source disambiguates both
    // BEFORE the generic paid-search table; otherwise a Facebook click poisons
    // the paid-search cell (unit W16.C2.03).
    const paid = PAID_SEARCH_MEDIUMS.has(medium) || PAID_MEDIUMS.has(medium);
    if (paid && declaresSocial(source)) return 'paid_social';
    if (paid) return 'paid_search';
    if (PAID_SOCIAL_MEDIUMS.has(medium)) return 'paid_social';
    if (EMAIL_MEDIUMS.has(medium)) return 'email';
    if (REFERRAL_MEDIUMS.has(medium)) return 'referral';
    if (ORGANIC_MEDIUMS.has(medium)) return 'organic';
    // A bare `social` medium is ambiguous. Treat it as paid when the source is a
    // known ad platform, because that is what a campaign builder almost always
    // means by tagging it at all; otherwise it is a referral from that network.
    if (SOCIAL_MEDIUMS.has(medium)) return declaresSocial(source) ? 'paid_social' : 'referral';
  }

  if (source !== '' && EMAIL_SOURCES.has(source)) return 'email';

  const host = hostOf(norm(signals.referrer));
  if (host === '') return 'direct';

  const site = norm(signals.siteHost);
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
