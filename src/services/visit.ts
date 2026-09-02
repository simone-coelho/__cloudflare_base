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
  /** Full referrer URL or bare host; both are accepted. */
  referrer?: string | null;
  /** The site's own host, so a same-site referrer is not read as a referral. */
  siteHost?: string | null;
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
const EMAIL_MEDIUMS = new Set(['email', 'e-mail', 'e_mail', 'newsletter', 'crm']);
const ORGANIC_MEDIUMS = new Set(['organic', 'organic_search']);
const REFERRAL_MEDIUMS = new Set(['referral', 'affiliate', 'partner']);
const SOCIAL_MEDIUMS = new Set(['social', 'social_media', 'sm']);

const EMAIL_SOURCES = new Set(['klaviyo', 'mailchimp', 'braze', 'sfmc', 'salesforce_marketing_cloud', 'sendgrid', 'iterable', 'newsletter', 'email']);
const SEARCH_HOSTS = ['google.', 'bing.', 'duckduckgo.', 'yahoo.', 'ecosia.', 'baidu.', 'yandex.', 'brave.', 'startpage.'];
const SOCIAL_HOSTS = ['facebook.', 'fb.', 'instagram.', 'tiktok.', 'pinterest.', 'snapchat.', 'twitter.', 'x.com', 't.co', 'linkedin.', 'lnkd.in', 'reddit.', 'youtube.', 'threads.'];

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

const matches = (host: string, needles: string[]) =>
  needles.some((n) => host === n.replace(/\.$/, '') || host.includes(n));

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
    if (PAID_SEARCH_MEDIUMS.has(medium)) return 'paid_search';
    if (PAID_SOCIAL_MEDIUMS.has(medium)) return 'paid_social';
    if (EMAIL_MEDIUMS.has(medium)) return 'email';
    if (REFERRAL_MEDIUMS.has(medium)) return 'referral';
    if (ORGANIC_MEDIUMS.has(medium)) return 'organic';
    // A bare `social` medium is ambiguous. Treat it as paid when the source is a
    // known ad platform, because that is what a campaign builder almost always
    // means by tagging it at all; otherwise it is a referral from that network.
    if (SOCIAL_MEDIUMS.has(medium)) {
      return matches(source, SOCIAL_HOSTS) || SOCIAL_HOSTS.some((h) => source.startsWith(h.replace(/\.$/, '')))
        ? 'paid_social'
        : 'referral';
    }
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
