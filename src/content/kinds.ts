// src/content/kinds.ts
// Three document kinds for the versioned store (src/config/versionedStore.ts):
// no second versioning system. Each validator returns EVERY error;
// slots/learn retain compiled fallbacks. Content has an explicit conditional R2
// authority: missing initialization or corrupt publication fails closed.

import type { DocumentKind, ValidationResult } from '@/config/versionedStore';
import { ENTRY_TERM_LIMIT, entryChannelOf, entryNetworkOf, isContextId, RECENCY_BUCKETS, recencyBucketOf, type ContextVocabulary } from '@/services/visit';
import { DEVICE_CLASSES, deviceClassOf, platformWordOf } from '@/services/platform';
import type { ComplementsRule, ConfiguredOrder, ContentCatalog, ContextOnlySwitch, ContentPiece, DiversityRule, FatigueRule, FreshnessRule, LearnConfig, OrderContext, PositionBand, PositionPin, SeedRule, SignalFloor, SlotCatalog, SlotStrategy, StageRule, StageWord,
  VocabularyApproval, VocabularyAttribute, VocabularyDocument, VocabularyValue } from './types';
import { compileSlotConstraints, slotPins } from './slotConstraints';
import { isRewardType, REWARD_TYPES, type RewardType } from '@/ledger/records';
import { TYPE_FALLBACK_RETIRED, typeFallbackRetired } from './typeAffinity';
import { TODAY_TERMS, type ContextTerms } from './cell';
import { ELIGIBILITY_SIGNALS } from './lifecycle';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** P10: a signal count or floor — a whole number of 0 or more (a nonnegative safe integer). */
const isSignalCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const LIFECYCLE = new Set(['live', 'draft', 'expired']);
const SLUG = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/** `name+rN`, replacing any earlier `+rN`, so two revisions never share a label. */
function stampLabel(base: string | undefined, fallback: string, revision: number): string {
  const root = (base ?? fallback).replace(/\+r\d+$/, '') || fallback;
  return `${root}+r${revision}`;
}

// ── content ─────────────────────────────────────────────────────────────────

/**
 * Every field name `validatePiece` reads: the published content piece
 * (kit 03 "The content piece"). This is the validator's own closed set — a name
 * outside it is carried by no stored piece, so a write answer names it on the
 * advisory diagnostics channel instead of dropping it without a word (F27 §5.4).
 * The feed adapter's accepted spellings are this set plus its aliases
 * (`FEED_FIELD_ALIASES`, src/content/import.ts); nothing else is a field.
 *
 * P44 (R-P78): the set lists P08's `pooled` and P16's `successEvent`, both
 * read by `validatePiece` and documented in kit 03's piece table, so a write
 * that declares either keeps it without naming it as an ignored field, and the
 * feed's accepted set, which derives from this one, carries both.
 */
export const PIECE_FIELDS: ReadonlySet<string> = new Set(['id', 'customerContentId', 'type', 'title', 'subtitle', 'excerpt', 'runtime',
  'tags', 'slotTypes', 'lifecycle', 'window', 'eligibleWhen', 'art', 'renderUrl', 'merchandising', 'journeyStageFit', 'freshnessDate',
  'featuredProductIds', 'complements', 'inStock', 'pooled', 'successEvent']);

/**
 * Every key `contentCatalog` below reads on the catalogue DOCUMENT itself: its
 * `pieces`, its optional authored `version` label and (P32) its optional
 * `typeFallback` marker. The same rule as
 * `PIECE_FIELDS`, one level up — a key beside these reaches no stored document,
 * so a write answer names it rather than dropping it without a word (F27 §5.4).
 * How a request CARRIES its catalogue (a body's `document`, a feed export's
 * records key) is the envelope, not a field of the catalogue, and is listed by
 * the path that reads it, never here.
 */
export const CATALOG_DOCUMENT_FIELDS: ReadonlySet<string> = new Set(['pieces', 'version', 'typeFallback']);

/**
 * One offending value a refusal names, so a content team can find the row it
 * came from and not only read the accepted vocabulary back. Bounded and
 * printable, like every other authored value this document reports.
 */
function quoted(value: unknown): string {
  const text = typeof value === 'string' ? value
    : typeof value === 'number' || typeof value === 'boolean' || value === null ? String(value) : typeof value;
  const printable = [...text.slice(0, 64)].map((ch) => {
    const code = ch.codePointAt(0)!;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f) ? ' ' : ch;
  }).join('');
  return `'${printable}'${text.length > 64 ? '\u2026' : ''}`;
}

/** A stage in either vocabulary, as Tapestry's word; null when it is neither. */
export function stageWordOf(v: unknown): StageWord | null {
  if (v === 'explore') return 'exploring';
  if (v === 'consider') return 'considering';
  if (v === 'decide') return 'deciding';
  return storedStageWordOf(v);
}
function storedStageWordOf(v: unknown): StageWord | null {
  if (v === 'exploring' || v === 'considering' || v === 'deciding') return v;
  if (v === 'early') return 'exploring';
  if (v === 'mid') return 'considering';
  if (v === 'late') return 'deciding';
  return null;
}

/** P31: the journey stages a rule may name, in the engine's words. */
const RULE_STAGES: readonly StageWord[] = ['exploring', 'considering', 'deciding'];
const RULE_SIGNALS = 'entry_channel, visit_bucket or journey_stage';

/**
 * P31: one module's eligibility rule — `regions`, region keys such as US or
 * US-WA, and `context`, the engine's own signals each with the values that
 * admit the module — refused by name when malformed. On publication (`terms`)
 * a rule names only the engine's own signals (`ELIGIBILITY_SIGNALS`), each
 * value of its vocabulary: a channel of the terms (today's six words for a
 * tenant without a context vocabulary; P31 R-P59 (4): a tenant's own channel
 * ids), a visit bucket of the terms (1, 2-3, 4+; a tenant's own cut), or a
 * journey stage (exploring, considering, deciding); a refusal quotes the
 * offending signal or value. The publication store, which holds no tenant,
 * reads a channel and a bucket by their grammar alone (`'grammar'`), as it
 * reads a slots document (P36); the authoring door (src/routes/content.ts)
 * checks them against the tenant's terms first (`catalogRuleErrors`). A
 * RETAINED document (`terms` null) is read by the grammar of the rule alone,
 * so a rule a later contract refuses keeps its catalogue readable and, naming
 * what the engine cannot satisfy, admits nothing.
 */
function eligibilityRule(raw: unknown, at: string, terms: SlotTerms | null): ValidationResult<{ regions?: string[]; context?: Record<string, string[]> }> {
  if (!isRecord(raw)) return { ok: false, errors: [`${at}: object with regions and/or context`] };
  const errors: string[] = [];
  const extra = Object.keys(raw).filter((k) => !['regions', 'context'].includes(k));
  if (extra.length) errors.push(`${at}: unknown member(s) ${extra.join(', ')}; expected regions and/or context`);
  const rule: { regions?: string[]; context?: Record<string, string[]> } = {};
  if (raw.regions !== undefined) {
    const regions = raw.regions;
    const unusable = Array.isArray(regions) ? regions.filter((v) => !(isStr(v) && /^[A-Za-z]{2}(-[A-Za-z0-9]{1,3})?$/.test(v))) : [];
    if (!Array.isArray(regions) || !regions.length || regions.length > 64 || unusable.length) {
      errors.push(`${at}.regions: 1..64 region keys such as US or US-WA`
        + (unusable.length ? `; not a region key: ${unusable.slice(0, 5).map(quoted).join(', ')}${unusable.length > 5 ? ', …' : ''}` : ''));
    } else rule.regions = (regions as string[]).map((v) => v.trim().toUpperCase());
  }
  if (raw.context !== undefined) {
    const context = raw.context;
    if (!isRecord(context) || !Object.keys(context).length || Object.keys(context).length > 8) {
      errors.push(`${at}.context: object of 1..8 signal names → accepted values`);
    } else {
      const ctx: Record<string, string[]> = {};
      for (const [name, values] of Object.entries(context)) {
        if (!/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(name)) { errors.push(`${at}.context.${name}: signal name must be 1..32 letters, digits or underscore`); continue; }
        if (terms && !(ELIGIBILITY_SIGNALS as readonly string[]).includes(name)) {
          errors.push(`${at}.context.${name}: unknown signal ${quoted(name)}; a rule names regions and the engine's own signals ${RULE_SIGNALS}`); continue;
        }
        if (!Array.isArray(values) || !values.length || values.length > 32
          || !values.every((v) => isStr(v) && v.trim() && v.length <= 64)) {
          errors.push(`${at}.context.${name}: 1..32 non-empty values of at most 64 characters`); continue;
        }
        const words = (values as string[]).map((v) => v.trim());
        if (terms) {
          const admits = name === 'entry_channel' ? (w: string) => channelInTerms(w, terms)
            : name === 'visit_bucket' ? (w: string) => bucketInTerms(w, terms) : (w: string) => (RULE_STAGES as readonly string[]).includes(w);
          const outside = words.filter((w) => !admits(w));
          if (outside.length) {
            const vocabulary = name === 'entry_channel' ? channelWords(terms) : name === 'visit_bucket' ? `a visit bucket (${bucketWords(terms)})` : `a journey stage (${RULE_STAGES.join(' | ')})`;
            errors.push(`${at}.context.${name}: ${outside.slice(0, 5).map(quoted).join(', ')}${outside.length > 5 ? ', …' : ''} ${outside.length === 1 ? 'is' : 'are'} not ${vocabulary}`); continue;
          }
        }
        ctx[name] = words;
      }
      if (Object.keys(ctx).length) rule.context = ctx;
    }
  }
  if (!errors.length && !rule.regions && !rule.context) errors.push(`${at}: name at least one of regions or context`);
  return errors.length ? { ok: false, errors } : { ok: true, value: rule };
}

function validatePiece(p: unknown, i: number, seen: Set<string>, errors: string[], stored: boolean, terms: SlotTerms = TODAY_TERMS): ContentPiece | null {
  const at = `pieces[${i}]`;
  if (!isRecord(p)) { errors.push(`${at}: must be an object`); return null; }
  const id = p.id, cid = p.customerContentId, type = p.type, title = p.title;
  if (!isStr(id)) errors.push(`${at}.id: required string`);
  else if (seen.has(id)) errors.push(`${at}.id: duplicate '${id}'`);
  else seen.add(id);
  if (!isStr(cid)) errors.push(`${at}.customerContentId: required string`);
  if (!isStr(type)) errors.push(`${at}.type: required string`);
  if (!isStr(title)) errors.push(`${at}.title: required string`);
  const tags: Record<string, string[]> = {};
  if (!isRecord(p.tags)) errors.push(`${at}.tags: required object of dimension → string[]`);
  else for (const [dim, vals] of Object.entries(p.tags)) {
    if (!Array.isArray(vals) || !vals.every(isStr)) { errors.push(`${at}.tags.${dim}: must be a non-empty string array`); continue; }
    if (!stored && new Set(vals).size !== vals.length) errors.push(`${at}.tags.${dim}: duplicate values are not allowed`);
    tags[dim] = [...vals];
  }
  const slotTypes = Array.isArray(p.slotTypes) && p.slotTypes.length && p.slotTypes.every(isStr) ? [...p.slotTypes] as string[] : null;
  if (!slotTypes) errors.push(`${at}.slotTypes: required non-empty string array`);
  let status = 'live';
  if (p.lifecycle !== undefined) {
    if (!isRecord(p.lifecycle) || !isStr(p.lifecycle.status) || !LIFECYCLE.has(p.lifecycle.status))
      errors.push(`${at}.lifecycle.status: must be live | draft | expired`);
    else status = p.lifecycle.status;
  }
  if (p.art !== undefined && p.art !== null && typeof p.art !== 'string') errors.push(`${at}.art: string or null`);
  if (p.renderUrl !== undefined && !(isStr(p.renderUrl) && /^(https?:\/\/|\/)/i.test(p.renderUrl))) errors.push(`${at}.renderUrl: http(s) URL or site-relative path`);
  if (p.excerpt !== undefined && typeof p.excerpt !== 'string') errors.push(`${at}.excerpt: string when present`);
  if (!stored) for (const key of ['subtitle', 'runtime']) {
    if (p[key] !== undefined && typeof p[key] !== 'string') errors.push(`${at}.${key}: string when present`);
  }
  let window: { from?: string; to?: string } | undefined;
  if (p.window !== undefined) {
    if (!isRecord(p.window)) errors.push(`${at}.window: object with from and/or to`);
    else {
      window = {};
      for (const k of ['from', 'to'] as const) {
        const v = p.window[k];
        if (v === undefined) continue;
        if (!isStr(v) || !Number.isFinite(Date.parse(v))) errors.push(`${at}.window.${k}: ISO 8601 date-time`);
        else window[k] = v;
      }
      if (window.from && window.to && Date.parse(window.from) >= Date.parse(window.to)) errors.push(`${at}.window: from must precede to`);
    }
  }
  // P31: the module's eligibility rule by context. Bounded on every axis,
  // because it is authored by a feed and it decides whether a piece may be
  // served at all (`eligibilityRule` below).
  let eligibleWhen: { regions?: string[]; context?: Record<string, string[]> } | undefined;
  if (p.eligibleWhen !== undefined) {
    const checked = eligibilityRule(p.eligibleWhen, `${at}.eligibleWhen`, stored ? null : terms);
    if (checked.ok) eligibleWhen = checked.value; else errors.push(...checked.errors);
  }
  let merchandising: Record<string, number> | undefined;
  if (p.merchandising !== undefined) {
    if (!isRecord(p.merchandising)) errors.push(`${at}.merchandising: object of season | promotion | margin → number 0..1`);
    else {
      merchandising = {};
      for (const [term, v] of Object.entries(p.merchandising)) {
        if (!['season', 'promotion', 'margin'].includes(term) || !isNum(v) || v < 0 || v > 1) { errors.push(`${at}.merchandising.${term}: season | promotion | margin, number 0..1`); continue; }
        merchandising[term] = v;
      }
    }
  }
  let journeyStageFit: StageWord[] | undefined;
  if (p.journeyStageFit !== undefined) {
    const raw = Array.isArray(p.journeyStageFit) ? p.journeyStageFit : null;
    const words = raw?.map(stored ? storedStageWordOf : stageWordOf);
    if (!raw || !raw.length || !words || words.some((w) => w === null)) {
      // W19 F2.01: name the words the feed actually sent that this vocabulary
      // cannot read, beside the vocabulary itself; the accepted list alone never
      // says which row of the export has to be fixed.
      const unusable = raw ? raw.filter((_, index) => words![index] === null).map(quoted) : [];
      errors.push(`${at}.journeyStageFit: non-empty array of exploring | considering | deciding (early | mid | late${stored ? '' : ' | explore | consider | decide'} also accepted)`
        + (unusable.length ? `; unusable: ${unusable.slice(0, 5).join(', ')}${unusable.length > 5 ? ', …' : ''}` : ''));
    }
    else journeyStageFit = [...new Set(words as StageWord[])];
  }
  if (p.freshnessDate !== undefined && !(isStr(p.freshnessDate) && Number.isFinite(Date.parse(p.freshnessDate)))) errors.push(`${at}.freshnessDate: ISO 8601 date-time`);
  let featuredProductIds: string[] | undefined;
  if (p.featuredProductIds !== undefined) {
    if (!Array.isArray(p.featuredProductIds) || !p.featuredProductIds.every(isStr)) errors.push(`${at}.featuredProductIds: array of product id strings`);
    else featuredProductIds = [...new Set((p.featuredProductIds as string[]).map((x) => x.trim()).filter(Boolean))];
  }
  // The products the piece completes, validated exactly as the products it features are.
  let complements: string[] | undefined;
  if (p.complements !== undefined) {
    if (!Array.isArray(p.complements) || !p.complements.every(isStr)) errors.push(`${at}.complements: array of product id strings`);
    else complements = [...new Set((p.complements as string[]).map((x) => x.trim()).filter(Boolean))];
  }
  if (p.inStock !== undefined && typeof p.inStock !== 'boolean') errors.push(`${at}.inStock: boolean when present`);
  // P08 (decision D1, freeze item 27): pooling is DECLARED per module, with the
  // one value `true`. Any other value is refused by name rather than read as
  // undeclared, which would leave the author believing the module pooled. A
  // retained document is read, never refused, for it: there only `true`
  // declares, and anything else is the undeclared module it always was.
  if (!stored && p.pooled !== undefined && p.pooled !== true) {
    errors.push(`${at}.pooled: ${quoted(p.pooled)} is not a pooling declaration; true pools the module's evidence in one record across every page it is served on, and absent keeps it per placement`);
  }
  // P16 (decision D1, freeze item 14): the module's own success event, one
  // reward of the list spelled exactly as the learn dials spell it. Any other
  // value is refused by name rather than read as undeclared, which would leave
  // the author believing the module is credited for it. A retained document is
  // read, never refused, for it: a value outside the list there is the
  // undeclared module it always was. Like `pooled` (P08), it is listed in
  // PIECE_FIELDS (P44), so a write carrying it is never named as an ignored field.
  if (!stored && p.successEvent !== undefined && !isRewardType(p.successEvent)) {
    errors.push(`${at}.successEvent: ${quoted(p.successEvent)} is not a success event; one of ${REWARD_TYPES.join(' | ')}, the reward an outcome of the module counts as its success (absent: the slot's own reward)`);
  }
  if (!isStr(id) || !isStr(cid) || !isStr(type) || !isStr(title) || !slotTypes) return null;
  return {
    id, customerContentId: cid, type, title, tags, slotTypes,
    ...(merchandising && Object.keys(merchandising).length ? { merchandising } : {}),
    ...(journeyStageFit ? { journeyStageFit } : {}),
    ...(isStr(p.freshnessDate) ? { freshnessDate: p.freshnessDate } : {}),
    ...(featuredProductIds && featuredProductIds.length ? { featuredProductIds } : {}),
    ...(complements && complements.length ? { complements } : {}),
    ...(typeof p.inStock === 'boolean' ? { inStock: p.inStock } : {}),
    lifecycle: { status: status as ContentPiece['lifecycle']['status'] },
    ...(isStr(p.subtitle) ? { subtitle: p.subtitle } : {}),
    ...(p.art === undefined ? {} : { art: p.art as string | null }),
    ...(isStr(p.runtime) ? { runtime: p.runtime } : {}),
    ...(isStr(p.renderUrl) ? { renderUrl: p.renderUrl } : {}),
    ...(isStr(p.excerpt) ? { excerpt: p.excerpt } : {}),
    ...(window && (window.from || window.to) ? { window } : {}),
    ...(eligibleWhen ? { eligibleWhen } : {}),
    ...(p.pooled === true ? { pooled: true as const } : {}),
    ...(isRewardType(p.successEvent) ? { successEvent: p.successEvent } : {}),
  };
}

/**
 * Publication rejects a malformed catalogue. One argument: a rule's words are
 * checked against today's terms, the six channel words and 1, 2-3, 4+ (a
 * tenant without the settings). P31 (R-P59 (4)): the authoring door passes the
 * tenant's terms (`catalogRuleErrors`), and the publication store, which holds
 * no tenant, the grammar alone (`CONTENT_KIND.validate`).
 */
export function validateContentCatalog(candidate: unknown, terms: SlotTerms = TODAY_TERMS): ValidationResult<ContentCatalog> {
  return contentCatalog(candidate, false, terms);
}
function validateStoredContentCatalog(candidate: unknown): ValidationResult<ContentCatalog> {
  return contentCatalog(candidate, true);
}

/** P31 (R-P59 (4)): whether a catalogue names a rule's entry channel or visit bucket, the words a tenant's vocabulary decides. */
export function catalogNamesRuleWords(candidate: unknown): boolean {
  const pieces = isRecord(candidate) && Array.isArray(candidate.pieces) ? candidate.pieces : [];
  return pieces.some((p) => isRecord(p) && isRecord(p.eligibleWhen) && isRecord(p.eligibleWhen.context)
    && (Object.hasOwn(p.eligibleWhen.context, 'entry_channel') || Object.hasOwn(p.eligibleWhen.context, 'visit_bucket')));
}

/**
 * P31 (R-P59 (4)): the refusals of a catalogue's eligibility rules against a
 * tenant's terms — its channel ids and the names of its visit-bucket cut, or
 * today's six words and 1, 2-3, 4+ for a tenant without the settings — each
 * worded as the validator words it, addressed `pieces[i].eligibleWhen…`. Every
 * other member is left to the catalogue's own validator. Pure.
 */
export function catalogRuleErrors(candidate: unknown, terms: ContextTerms): string[] {
  const pieces = isRecord(candidate) && Array.isArray(candidate.pieces) ? candidate.pieces : [];
  const errors: string[] = [];
  pieces.forEach((p, i) => {
    if (!isRecord(p) || p.eligibleWhen === undefined) return;
    const checked = eligibilityRule(p.eligibleWhen, `pieces[${i}].eligibleWhen`, terms);
    if (!checked.ok) errors.push(...checked.errors);
  });
  return errors;
}

function contentCatalog(candidate: unknown, stored: boolean, terms: SlotTerms = TODAY_TERMS): ValidationResult<ContentCatalog> {
  const errors: string[] = [];
  if (!isRecord(candidate)) return { ok: false, errors: ['catalog: must be an object'] };
  if (candidate.version !== undefined && !isStr(candidate.version)) errors.push('version: string when present');
  // P32 (decision D3): the marker that retires the free-text type fallback is
  // the one exact word; any other value is refused by name rather than read as
  // the fallback held, which would leave the author believing it retired.
  if (candidate.typeFallback !== undefined && candidate.typeFallback !== TYPE_FALLBACK_RETIRED) {
    errors.push(`typeFallback: ${quoted(candidate.typeFallback)} is not a catalogue marker; '${TYPE_FALLBACK_RETIRED}' retires the free-text type fallback, and absent keeps it`);
  }
  if (!Array.isArray(candidate.pieces)) return { ok: false, errors: [...errors, 'pieces: required array'] };
  const seen = new Set<string>();
  const pieces: ContentPiece[] = [];
  candidate.pieces.forEach((p, i) => { const v = validatePiece(p, i, seen, errors, stored, terms); if (v) pieces.push(v); });
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { ...(isStr(candidate.version) ? { version: candidate.version } : {}),
    ...(candidate.typeFallback === TYPE_FALLBACK_RETIRED ? { typeFallback: TYPE_FALLBACK_RETIRED } : {}), pieces } };
}

export const EMPTY_CATALOG: ContentCatalog = { version: 'content-empty', pieces: [] };

export const CONTENT_KIND: DocumentKind<ContentCatalog> = {
  name: 'content',
  publication: 'r2',
  // P31 (R-P59 (4)): the store holds no tenant, so it reads a rule's channel and
  // bucket by their grammar alone; the authoring door (src/routes/content.ts)
  // checks each against the tenant's own vocabulary and cut first, and the
  // decision reads every rule against the cell the tenant's terms derive.
  validate: (candidate) => validateContentCatalog(candidate, 'grammar'),
  validateStored: validateStoredContentCatalog,
  stamp: (v, r) => ({ ...v, version: stampLabel(v.version, 'content', r) }),
  versionOf: (v) => v.version ?? '',
};

// ── slots ───────────────────────────────────────────────────────────────────

/**
 * W16 C3: the arrival signals a seed rule may read; `platform` is the request's
 * own OS family. P36: `source_platform` and `landing_page_type` are the visit's
 * context attributes, named by the tenant's published vocabulary. P37: `device`
 * is the request's own device class and `recency` the visit's recency bucket,
 * each named from a fixed vocabulary that no tenant setting changes.
 */
const SEED_SIGNALS = new Set(['entry_channel', 'campaign_term', 'referrer_network', 'platform', 'source_platform', 'landing_page_type', 'device', 'recency']);

/**
 * P36 (R-P46): the vocabulary a slots document is checked against. A tenant's
 * terms (`contextTermsOf`; today's terms for a tenant without the settings) at
 * every door that holds the tenant — authoring and the decision — or, where no
 * tenant is in hand (the publication store's own write and read of a document
 * the authoring door already checked), the grammar alone: any id for a channel,
 * a source platform or a landing-page type, any bucket name for a bucket.
 */
export type SlotTerms = ContextTerms | 'grammar';
/** A bucket's name: a whole number, a range `a-b`, or an open `N+`. */
const BUCKET_NAME = /^(?:[1-9][0-9]{0,4}|[1-9][0-9]{0,4}-[1-9][0-9]{0,4}|[1-9][0-9]{0,4}\+)$/;
const SIX_WORDS = 'one of the six channel words (direct | paid_social | paid_search | email | organic | referral)';
/** Whether a channel word is in the terms: today's six words exactly, a tenant's ids, or any id. */
const channelInTerms = (word: unknown, terms: SlotTerms): boolean => terms === 'grammar' ? isContextId(word)
  : typeof word === 'string' && (terms.published ? terms.channels.has(word) : entryChannelOf(word) === word);
const channelWords = (terms: SlotTerms): string => terms === 'grammar' ? `a channel id (${CONTEXT_ID_WORDS})`
  : terms.published ? `one of this tenant's channel ids (${[...terms.channels].join(' | ')})` : SIX_WORDS;
const bucketInTerms = (name: unknown, terms: SlotTerms): boolean => typeof name === 'string' && (terms === 'grammar' ? BUCKET_NAME.test(name) : terms.buckets.includes(name));
const bucketWords = (terms: SlotTerms): string => terms === 'grammar' ? 'a whole number, a range such as 2-3 or an open bucket such as 4+' : terms.buckets.join(' | ');
/** The source platforms or landing-page types a seed may name, in words. */
const idsWords = (ids: ReadonlySet<string>, what: string): string => ids.size ? `one of this tenant's ${what} ids (${[...ids].join(' | ')})`
  : `one of the tenant's published ${what} ids; this tenant publishes none (contextVocabulary)`;
/** Bounded like every other authored list in this document. */
const SEED_RULES_MAX = 100, SEED_TAGS_MAX = 50, SEED_DAMPEN_MAX = 4;

/**
 * W16 C3 / R30: one slot's contextual seed rule set, against the dimensions that
 * slot actually weights. Errors are returned as suffixes of the slot's own
 * address, so a refusal names the rule that caused it.
 *
 * The same function validates a published candidate and a RETAINED document at
 * decision time: a rule set the current contract refuses is ignored whole rather
 * than partially applied, because half a rule set is a ranking nobody authored.
 */
export function validateSeedRules(candidate: unknown, weights: Readonly<Record<string, number>>, terms: SlotTerms = TODAY_TERMS): ValidationResult<SeedRule[]> {
  if (!Array.isArray(candidate)) return { ok: false, errors: [': must be an array of seed rules'] };
  const errors: string[] = [];
  if (candidate.length > SEED_RULES_MAX) errors.push(`: at most ${SEED_RULES_MAX} rules`);
  const rules: SeedRule[] = [];
  candidate.forEach((raw, index) => {
    const at = `[${index}]`;
    if (!isRecord(raw)) { errors.push(`${at}: must be an object`); return; }
    const before = errors.length;
    const signal = raw.signal, value = raw.value, weight = raw.weight;
    if (!isStr(signal) || !SEED_SIGNALS.has(signal)) errors.push(`${at}.signal: entry_channel | campaign_term | referrer_network | platform | source_platform | landing_page_type | device | recency`);
    if (!isStr(value) || value.length > ENTRY_TERM_LIMIT) errors.push(`${at}.value: required string of 1..${ENTRY_TERM_LIMIT} characters`);
    // A signal value outside its own vocabulary names a context that cannot
    // occur, so it could only ever be dead configuration or a typo for a live one.
    // P36 (R-P46): the channel words are the tenant's own when it publishes them.
    else if (signal === 'entry_channel' && !channelInTerms(value, terms)) errors.push(terms !== 'grammar' && !terms.published
      ? `${at}.value: entry_channel names one of the six channel words, exactly` : `${at}.value: entry_channel names ${channelWords(terms)}, exactly`);
    else if (signal === 'source_platform' && !(terms === 'grammar' ? isContextId(value) : terms.sourcePlatforms.has(value))) {
      errors.push(`${at}.value: source_platform names ${terms === 'grammar' ? `an id (${CONTEXT_ID_WORDS})` : idsWords(terms.sourcePlatforms, 'source platform')}, exactly`);
    }
    else if (signal === 'landing_page_type' && !(terms === 'grammar' ? isContextId(value) : terms.landingPageTypes.has(value))) {
      errors.push(`${at}.value: landing_page_type names ${terms === 'grammar' ? `an id (${CONTEXT_ID_WORDS})` : idsWords(terms.landingPageTypes, 'landing-page type')}, exactly`);
    }
    else if (signal === 'referrer_network' && entryNetworkOf(value) !== value) errors.push(`${at}.value: referrer_network names a known network's registrable domain, exactly`);
    else if (signal === 'platform' && platformWordOf(value) !== value) errors.push(`${at}.value: platform names an OS family, ios | android, exactly`);
    else if (signal === 'device' && deviceClassOf(value) !== value) errors.push(`${at}.value: device names a device class, ${DEVICE_CLASSES.join(' | ')}, exactly (a tablet counts as desktop)`);
    else if (signal === 'recency' && recencyBucketOf(value) !== value) errors.push(`${at}.value: recency names a recency bucket, ${RECENCY_BUCKETS.join(' | ')}, exactly`);
    if (!isNum(weight) || weight < 0 || weight > 1) errors.push(`${at}.weight: number 0..1`);
    // The dampen reads the SHOPPER's own memberships, not the piece, so its
    // dimensions need not be ones this slot weights.
    let dampen: SeedRule['dampen'];
    if (raw.dampen !== undefined) {
      const list = raw.dampen, held = new Set<string>();
      if (!Array.isArray(list) || list.length < 1 || list.length > SEED_DAMPEN_MAX) errors.push(`${at}.dampen: 1..${SEED_DAMPEN_MAX} of { dimension, value, factor 0..1 }`);
      else {
        dampen = [];
        for (const d of list as unknown[]) {
          if (!isRecord(d) || !isStr(d.dimension) || !isStr(d.value) || !isNum(d.factor) || d.factor < 0 || d.factor > 1) { errors.push(`${at}.dampen: each is { dimension, value, factor 0..1 }`); continue; }
          const pair = `${d.dimension}\u0000${d.value}`;
          if (held.has(pair)) { errors.push(`${at}.dampen: duplicate interest`); continue; }
          held.add(pair);
          dampen.push({ dimension: d.dimension, value: d.value, factor: d.factor });
        }
      }
    }
    const tags: SeedRule['tags'] = [];
    if (!Array.isArray(raw.tags) || raw.tags.length < 1 || raw.tags.length > SEED_TAGS_MAX) errors.push(`${at}.tags: 1..${SEED_TAGS_MAX} canonical tags`);
    else {
      const pairs = new Set<string>();
      for (const tag of raw.tags as unknown[]) {
        if (!isRecord(tag) || !isStr(tag.dimension) || !isStr(tag.value)) { errors.push(`${at}.tags: each tag is { dimension, value }, both non-empty strings`); continue; }
        // A dimension this slot does not weight can never reach the score, so a
        // rule naming one is refused where it is authored, not silently inert.
        if (!Object.hasOwn(weights, tag.dimension)) { errors.push(`${at}.tags: '${tag.dimension}' is not a dimension this slot weights`); continue; }
        const pair = `${tag.dimension}\u0000${tag.value}`;
        if (pairs.has(pair)) { errors.push(`${at}.tags: duplicate exact pair`); continue; }
        pairs.add(pair);
        tags.push({ dimension: tag.dimension, value: tag.value });
      }
    }
    if (errors.length === before) rules.push({ signal: signal as SeedRule['signal'], value: value as string, tags, weight: weight as number, ...(dampen ? { dampen } : {}) });
  });
  return errors.length ? { ok: false, errors } : { ok: true, value: rules };
}

/** P02: the governance version that introduces the layout declaration (`layout` on a slot). */
export const LAYOUT_GOVERNANCE_VERSION = 4;

/** A slot member `layout` that declares something: anything but absent or `false`. */
const declaresLayout = (s: unknown): boolean => isRecord(s) && s.layout !== undefined && s.layout !== false;
/** P01: a slot member `orders` that carries something: anything but absent or an empty list. */
const carriesOrders = (s: unknown): boolean => isRecord(s) && s.orders !== undefined && !(Array.isArray(s.orders) && s.orders.length === 0);
/** P04: a slot member `positionPins` or `offLimitsPieceIds` that carries something: anything but absent or an empty list. */
const carriesList = (s: unknown, key: 'positionPins' | 'offLimitsPieceIds'): boolean => isRecord(s) && s[key] !== undefined && !(Array.isArray(s[key]) && s[key].length === 0);
const carriesModuleRules = (s: unknown): boolean => carriesList(s, 'positionPins') || carriesList(s, 'offLimitsPieceIds');
/** P30: a slot member `contextOnly`, whatever it carries (a switch that is off is still authored on the slot). */
const carriesContextOnly = (s: unknown): boolean => isRecord(s) && s.contextOnly !== undefined;
/** P26: a slot member `inner` that carries something: anything but absent or an empty object. */
const carriesInner = (s: unknown): boolean => isRecord(s) && s.inner !== undefined && !(isRecord(s.inner) && Object.keys(s.inner).length === 0);

// ── P01: per-context orders on the declared layout slot ─────────────────────

/** The visit buckets a context may name, as the cell derives them (`src/content/cell.ts`), or `any`. */
const VISIT_BUCKET_WORDS: ReadonlySet<string> = new Set(['1', '2-3', '4+']);
/** More than every distinct context the grammar can name (seven channel choices × eight bucket choices). */
const ORDERS_MAX = 64;
const hasExactly = (v: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key));

/**
 * P01 (decision D1): one slot's per-context orders, structurally. Errors are
 * suffixes of the slot's `orders` address, so a refusal names the order, the
 * part and the offending value. The same function reads a published candidate
 * and a RETAINED version-4 document; the rules that relate an order to the rest
 * of its slot (pins, exclusions, the layout declaration, overlapping contexts)
 * are authoring rules in `validateSlotCatalog`, never reinterpreted on a read.
 */
export function validateOrders(candidate: unknown, take: number, terms: SlotTerms = TODAY_TERMS): ValidationResult<ConfiguredOrder[]> {
  if (!Array.isArray(candidate)) return { ok: false, errors: [': must be an array of { context, modules } orders'] };
  const errors: string[] = [];
  if (candidate.length > ORDERS_MAX) errors.push(`: at most ${ORDERS_MAX} orders`);
  const orders: ConfiguredOrder[] = [];
  Array.from(candidate).forEach((raw: unknown, index) => {
    const at = `[${index}]`;
    if (!isRecord(raw) || !hasExactly(raw, ['context', 'modules'])) { errors.push(`${at}: an order is { context, modules } and nothing else`); return; }
    const before = errors.length;
    let channel: OrderContext['channel'] | null = null, visitBuckets: OrderContext['visitBuckets'] | null = null;
    let device: OrderContext['device'];
    const context = raw.context;
    // P37: a context may also name a device, beside or instead of (with `any`) a channel and a visit bucket.
    if (!isRecord(context) || !(hasExactly(context, ['channel', 'visitBuckets']) || hasExactly(context, ['channel', 'device', 'visitBuckets']))) {
      errors.push(`${at}.context: { channel, visitBuckets } and optionally device, and nothing else`);
    } else {
      if (Object.hasOwn(context, 'device')) {
        const d = deviceClassOf(context.device);
        if (d) device = d;
        else errors.push(`${at}.context.device: ${quoted(context.device)} is not a device class (${DEVICE_CLASSES.join(' | ')}; a tablet counts as desktop); omit it to match every device`);
      }
      const c = context.channel;
      // P36 (R-P46): the tenant's channel ids and the names of its published cut.
      if (c === 'any' || channelInTerms(c, terms)) channel = c as OrderContext['channel'];
      else errors.push(`${at}.context.channel: ${quoted(c)} is not ${channelWords(terms)} or any; a shopper whose channel is unknown matches no context`);
      const b = context.visitBuckets;
      if (b === 'any') visitBuckets = 'any';
      else if (!Array.isArray(b) || b.length === 0) errors.push(`${at}.context.visitBuckets: a non-empty list of visit buckets (${bucketWords(terms)}), or any`);
      else {
        const seen = new Set<string>();
        Array.from(b).forEach((v: unknown, k) => {
          if (!bucketInTerms(v, terms)) errors.push(`${at}.context.visitBuckets[${k}]: ${quoted(v)} is not a visit bucket (${bucketWords(terms)}); a shopper whose visit is unknown matches no context`);
          else if (seen.has(v as string)) errors.push(`${at}.context.visitBuckets[${k}]: ${quoted(v)} is listed twice`);
          else seen.add(v as string);
        });
        if (errors.length === before) visitBuckets = [...b] as string[];
      }
    }
    const modules = raw.modules;
    if (!Array.isArray(modules) || modules.length < 1 || modules.length > take) {
      errors.push(`${at}.modules: 1 to ${take} module ids (the slot's take); an order may list fewer modules than take, never more`);
    } else {
      const seen = new Set<string>();
      Array.from(modules).forEach((id: unknown, k) => {
        if (typeof id !== 'string' || id.length < 1 || id.length > 1024) errors.push(`${at}.modules[${k}]: a module id, a string of 1..1024 UTF-16 units`);
        else if (seen.has(id)) errors.push(`${at}.modules[${k}]: ${quoted(id)} is repeated; an order names each module once`);
        else seen.add(id);
      });
    }
    if (errors.length === before && channel && visitBuckets) {
      // Keys in sorted order, as every member a replay compares is built; a device only when named.
      orders.push({ context: { channel, ...(device ? { device } : {}), visitBuckets }, modules: [...(modules as string[])] });
    }
  });
  return errors.length ? { ok: false, errors } : { ok: true, value: orders };
}

/** Decision D1's specificity: the number of the context's parts that are not `any`; P37: a named device is one more. */
export const contextSpecificity = (context: OrderContext): number =>
  (context.channel === 'any' ? 0 : 1) + (context.visitBuckets === 'any' ? 0 : 1) + (context.device === undefined ? 0 : 1);
/** The buckets a context matches: `any` is every bucket of the tenant's cut (today's buckets where no tenant is in hand). */
const bucketsOf = (context: OrderContext, terms: SlotTerms = TODAY_TERMS): string[] =>
  context.visitBuckets === 'any' ? [...(terms === 'grammar' ? VISIT_BUCKET_WORDS : terms.buckets)] : [...context.visitBuckets];
const contextWords = (context: OrderContext): string =>
  `channel ${quoted(context.channel)}, visit buckets ${context.visitBuckets === 'any' ? quoted('any') : context.visitBuckets.join(' | ')}${context.device === undefined ? '' : `, device ${quoted(context.device)}`}`;
/** A shopper both contexts match, in words, or null when no shopper can match both. */
function sharedShopper(a: OrderContext, b: OrderContext, terms: SlotTerms = TODAY_TERMS): string | null {
  if (a.channel !== 'any' && b.channel !== 'any' && a.channel !== b.channel) return null;
  // P37: two contexts naming different devices never match one shopper.
  if (a.device !== undefined && b.device !== undefined && a.device !== b.device) return null;
  const inB = new Set(bucketsOf(b, terms)), bucket = bucketsOf(a, terms).find(v => inB.has(v));
  if (bucket === undefined) return null;
  const channel = a.channel !== 'any' ? a.channel : b.channel !== 'any' ? b.channel : 'any channel';
  const device = a.device ?? b.device;
  return `${channel === 'any channel' ? channel : `channel ${quoted(channel)}`}, visit ${bucket}${device === undefined ? '' : `, on a ${device} device`}`;
}

// ── P15: position bands inside one slot ─────────────────────────────────────

/** The members a position band carries, and nothing else (decision D1). */
const BAND_KEYS = ['from', 'to', 'weights'] as const;
/** At most this many bands on one slot: each covers at least one position of a take of at most 50. */
const BANDS_MAX = 50;
const wholePosition = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;
const positionsWords = (from: number, to: number): string => (from === to ? `position ${from}` : `positions ${from} to ${to}`);

/**
 * P15 (decision D1): one slot's position bands, against the slot's `take`.
 * Errors are suffixes of the slot's `bands` address and name the band, the
 * member and the positions, so a refusal says which band and where. Each band
 * is exactly `{ from, to, weights }`: `from` and `to` whole positions counted
 * from 1 within the slot, `from` no later than `to`, and `weights` the band's
 * own `{ dimension: weight }`, each 0 to 1, as the slot's `weights`; a band
 * overrides only the slot's dimension weights, so any other setting is refused.
 * Listed from position 1, each band starts where the one before it ends, and
 * the last one ends at the take: the bands are contiguous, do not overlap and
 * together cover positions 1 to take. An empty list covers nothing and is
 * refused. The same function reads a published candidate and a RETAINED
 * document (no revision written before this build carries bands).
 */
export function validateBands(candidate: unknown, take: number): ValidationResult<PositionBand[]> {
  const shape = `position bands are a list of { from, to, weights }, contiguous and together covering positions 1 to ${take} (the slot's take)`;
  if (!Array.isArray(candidate)) return { ok: false, errors: [`: ${shape}`] };
  if (candidate.length === 0) return { ok: false, errors: [`: an empty list covers no position; ${shape}, or leave bands out`] };
  const errors: string[] = [];
  if (candidate.length > BANDS_MAX) errors.push(`: at most ${BANDS_MAX} bands`);
  const bands: PositionBand[] = [];
  // Each band's positions where they are well formed, by its place in the list.
  const spans: Array<{ k: number; from: number; to: number }> = [];
  let allSpans = true;
  Array.from(candidate).forEach((raw: unknown, k) => {
    const at = `[${k}]`;
    if (!isRecord(raw)) { errors.push(`${at}: a band is { from, to, weights } and nothing else`); allSpans = false; return; }
    const before = errors.length;
    const other = Object.keys(raw).filter(key => !(BAND_KEYS as readonly string[]).includes(key));
    if (other.length) errors.push(`${at}: a band overrides only the slot's dimension weights, so it carries { from, to, weights } and nothing else; ${other.map(key => quoted(key)).join(', ')} ${other.length === 1 ? 'is' : 'are'} not a band setting`);
    const from = raw.from, to = raw.to;
    let span = true;
    if (!wholePosition(from) || from > take) { errors.push(`${at}.from: ${quoted(from)} is not a position of the slot; a band starts at a whole position from 1 to ${take} (its take), counted from 1`); span = false; }
    if (!wholePosition(to) || to > take) { errors.push(`${at}.to: ${quoted(to)} is not a position of the slot; a band ends at a whole position from 1 to ${take} (its take), and the bands cover positions 1 to take`); span = false; }
    else if (wholePosition(from) && to < from) { errors.push(`${at}.to: the band ends at position ${to}, before it starts at position ${from}`); span = false; }
    if (span) {
      // R-P76 (3): the list is in position order, each band listed after the bands of earlier positions.
      const previous = spans[spans.length - 1];
      if (previous && (from as number) < previous.from) errors.push(`${at}: covers ${positionsWords(from as number, to as number)} but is listed after bands[${previous.k}] (${positionsWords(previous.from, previous.to)}); the bands are listed in position order, from position 1, each starting where the one before it ends`);
      spans.push({ k, from: from as number, to: to as number });
    } else allSpans = false;
    const weights: Record<string, number> = {};
    if (!isRecord(raw.weights)) errors.push(`${at}.weights: required object of dimension → number 0..1, the weights this band's positions are ranked with in place of the slot's`);
    else for (const [dim, w] of Object.entries(raw.weights)) {
      if (!isNum(w) || w < 0 || w > 1) { errors.push(`${at}.weights.${dim}: number 0..1`); continue; }
      weights[dim] = w;
    }
    // Keys in sorted order, as every member a replay reads is built.
    if (errors.length === before) bands.push({ from: from as number, to: to as number, weights });
  });
  // The positions the bands cover, read in position order whatever the order of
  // the list: an overlap is named wherever two bands share a position; a gap, a
  // late first band and a short last band only when every band's positions are
  // known, since a band refused above might have covered them.
  const ordered = [...spans].sort((a, b) => a.from - b.from || a.k - b.k);
  let reach: { k: number; to: number } | null = null;
  for (const band of ordered) {
    if (!reach) {
      if (allSpans && band.from > 1) errors.push(`[${band.k}]: the earliest band starts at position ${band.from}, so ${positionsWords(1, band.from - 1)} ${band.from === 2 ? 'lies' : 'lie'} in no band; the bands start at position 1 and cover positions 1 to take`);
    } else if (band.from <= reach.to) {
      const other = spans.find(s => s.k === reach!.k)!;
      errors.push(`[${band.k}]: ${positionsWords(band.from, band.to)} overlap bands[${other.k}] (${positionsWords(other.from, other.to)}); the bands are contiguous and do not overlap`);
    } else if (allSpans && band.from > reach.to + 1) {
      errors.push(`[${band.k}]: starts at position ${band.from}, so ${positionsWords(reach.to + 1, band.from - 1)} ${band.from - 1 === reach.to + 1 ? 'lies' : 'lie'} in no band (bands[${reach.k}] ends at position ${reach.to}); the bands are contiguous, with no gap, and cover positions 1 to take`);
    }
    if (!reach || band.to > reach.to) reach = { k: band.k, to: band.to };
  }
  if (allSpans && reach && reach.to < take) errors.push(`: the bands end at position ${reach.to}, short of the slot's take ${take}; together they cover positions 1 to ${take}, contiguous, so ${positionsWords(reach.to + 1, take)} ${reach.to + 1 === take ? 'lies' : 'lie'} in no band`);
  return errors.length ? { ok: false, errors } : { ok: true, value: bands };
}

// ── P04: position pins and off-limits marks on the declared layout slot ─────

/** At most this many position pins on one slot: no more than the largest take. */
const POSITION_PINS_MAX = 50;
/** At most this many off-limits marks on one slot, the bound `excludedPieceIds` keeps. */
const OFF_LIMITS_MAX = 1000;
const moduleId = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= 1024;

/**
 * P04: one slot's position pins, structurally. Errors are suffixes of the
 * slot's `positionPins` address and name the module, so a refusal says which
 * pin and where. Each pin is exactly `{ pieceId, position }`, `position` a whole
 * number from 1 to the slot's `take`; one position holds one module and a module
 * is pinned once. The rules that relate the pins to the rest of the slot and the
 * page (prefix pins, exclusions, off-limits marks, orders, other slots' pins, the
 * layout declaration) are authoring rules in `validateSlotCatalog`.
 */
export function validatePositionPins(candidate: unknown, take: number): ValidationResult<PositionPin[]> {
  if (!Array.isArray(candidate)) return { ok: false, errors: [': must be an array of { pieceId, position } pins'] };
  const errors: string[] = [];
  if (candidate.length > POSITION_PINS_MAX) errors.push(`: at most ${POSITION_PINS_MAX} position pins`);
  const pins: PositionPin[] = [], atPosition = new Map<number, number>(), ofModule = new Map<string, number>();
  Array.from(candidate).forEach((raw: unknown, k) => {
    if (!isRecord(raw) || !hasExactly(raw, ['pieceId', 'position'])) { errors.push(`[${k}]: a position pin is { pieceId, position } and nothing else`); return; }
    const id = raw.pieceId, position = raw.position;
    if (!moduleId(id)) { errors.push(`[${k}].pieceId: a module id, a string of 1..1024 UTF-16 units`); return; }
    if (typeof position !== 'number' || !Number.isInteger(position) || position < 1 || position > take) {
      errors.push(`[${k}].position: ${quoted(position)} pins ${quoted(id)} outside the slot's positions 1 to ${take} (its take); a position is counted from 1`); return;
    }
    const other = atPosition.get(position), twice = ofModule.get(id);
    if (twice !== undefined) { errors.push(`[${k}]: ${quoted(id)} is pinned twice (positionPins[${twice}] already pins it at position ${pins[twice]!.position}); a module holds one position`); return; }
    if (other !== undefined) { errors.push(`[${k}]: ${quoted(id)} is pinned at position ${position}, where positionPins[${other}] already pins ${quoted(pins[other]!.pieceId)}; one position holds one module`); return; }
    atPosition.set(position, pins.length); ofModule.set(id, pins.length);
    // Keys in sorted order, as every member a replay reads is built.
    pins.push({ pieceId: id, position });
  });
  return errors.length ? { ok: false, errors } : { ok: true, value: pins };
}

/** P04: one slot's off-limits marks, structurally: distinct module ids. */
export function validateOffLimitsPieceIds(candidate: unknown): ValidationResult<string[]> {
  if (!Array.isArray(candidate) || candidate.length > OFF_LIMITS_MAX) return { ok: false, errors: [`: at most ${OFF_LIMITS_MAX} distinct module ids, each a string of 1..1024 UTF-16 units`] };
  const errors: string[] = [], seen = new Set<string>();
  Array.from(candidate).forEach((id: unknown, k) => {
    if (!moduleId(id)) errors.push(`[${k}]: a module id, a string of 1..1024 UTF-16 units`);
    else if (seen.has(id)) errors.push(`[${k}]: ${quoted(id)} is listed twice; a module is marked off-limits once`);
    else seen.add(id);
  });
  return errors.length ? { ok: false, errors } : { ok: true, value: [...seen] };
}

/**
 * P04: the authoring rules that relate a slot's position pins and off-limits
 * marks to the rest of its slot, applied at publication only. Both are set only
 * on the page's declared layout slot; a slot pinned whole by `pinnedPieceId` is
 * never ranked and carries no position pin; a position pin lies after the
 * prefix pins and pins no module the prefix pins or the slot excludes by id; a
 * module is never both pinned and off-limits. Pins of other slots of the page
 * and the slot's orders are checked where those are (`validateSlotCatalog`,
 * `orderAuthoringErrors`).
 */
function moduleRuleAuthoringErrors(page: string, index: number, slot: SlotStrategy): string[] {
  const at = `pages.${page}[${index}]`, pins = slot.positionPins ?? [], marks = slot.offLimitsPieceIds ?? [];
  if (!pins.length && !marks.length) return [];
  const errors: string[] = [];
  if (slot.layout !== true) {
    if (pins.length) errors.push(`${at}.positionPins: slot '${slot.slot}' is not the declared layout slot of page '${page}'; modules are pinned at a position only on the slot that declares layout: true`);
    if (marks.length) errors.push(`${at}.offLimitsPieceIds: slot '${slot.slot}' is not the declared layout slot of page '${page}'; modules are marked off-limits only on the slot that declares layout: true`);
    return errors;
  }
  const prefix = slot.pinnedPieceIds ?? [];
  if (pins.length && slot.pinnedPieceId) errors.push(`${at}.positionPins: slot '${slot.slot}' serves one pinned piece (pinnedPieceId) and is never ranked, so it carries no position pins`);
  pins.forEach((pin, k) => {
    if (pin.position <= prefix.length) errors.push(`${at}.positionPins[${k}]: ${quoted(pin.pieceId)} is pinned at position ${pin.position}, where the prefix pin ${quoted(prefix[pin.position - 1])} already sits (pinnedPieceIds); one position holds one module`);
    if (prefix.includes(pin.pieceId)) errors.push(`${at}.positionPins[${k}]: ${quoted(pin.pieceId)} is pinned twice: pinnedPieceIds already pins it; a module holds one position`);
    if (!slot.offLimits && slot.excludedPieceIds?.includes(pin.pieceId)) errors.push(`${at}.positionPins[${k}]: ${quoted(pin.pieceId)} is excluded from slot '${slot.slot}' (excludedPieceIds), so the pin could never serve it`);
  });
  const positioned = new Set(pins.map((pin) => pin.pieceId)), pinned = new Set([...prefix, ...(slot.pinnedPieceId ? [slot.pinnedPieceId] : [])]);
  marks.forEach((id, k) => {
    if (positioned.has(id) || pinned.has(id)) errors.push(`${at}.offLimitsPieceIds[${k}]: ${quoted(id)} is both pinned (${positioned.has(id) ? 'positionPins' : 'pinnedPieceIds'}) and off-limits; a module is held at its pinned position or at its baseline position, never both`);
  });
  return errors;
}

/**
 * P01 (O5, decision D1): the authoring rules that relate a slot's orders to the
 * rest of its slot, applied at publication only. An order is published only on
 * the page's declared layout slot, never on an off-limits one; it keeps every
 * pinned module at its position and lists no module the slot excludes by id,
 * nor one another slot of the page pins (a pin reserves its module page-wide);
 * one context carries one order, and two contexts that match one shopper with
 * equal specificity are refused, so the most specific match always decides.
 */
function orderAuthoringErrors(page: string, index: number, slot: SlotStrategy, pageSlots: readonly SlotStrategy[], terms: SlotTerms = TODAY_TERMS): string[] {
  const at = `pages.${page}[${index}].orders`, orders = slot.orders ?? [];
  if (slot.layout !== true) return [`${at}: slot '${slot.slot}' is not the declared layout slot of page '${page}'; per-context orders are set only on the slot that declares layout: true`];
  if (slot.offLimits) return [`${at}: slot '${slot.slot}' is off-limits and serves no module, so it carries no order`];
  const errors: string[] = [], pins = slotPins(slot), excluded = new Set(slot.excludedPieceIds ?? []);
  const pinnedElsewhere = new Map<string, string>();
  for (const other of pageSlots) if (other !== slot && !other.offLimits) {
    // P04: a module another slot pins at a position is reserved page-wide too.
    for (const id of [...slotPins(other), ...(other.positionPins ?? []).map((pin) => pin.pieceId)]) if (!pinnedElsewhere.has(id)) pinnedElsewhere.set(id, other.slot);
  }
  orders.forEach((order, k) => {
    order.modules.forEach((id, p) => {
      if (excluded.has(id)) errors.push(`${at}[${k}].modules[${p}]: ${quoted(id)} is excluded from slot '${slot.slot}' (excludedPieceIds), so the order could not serve it`);
      else if (pinnedElsewhere.has(id)) errors.push(`${at}[${k}].modules[${p}]: ${quoted(id)} is pinned by slot '${pinnedElsewhere.get(id)}' of page '${page}', which reserves it page-wide, so this order could not serve it`);
    });
    pins.forEach((pin, p) => {
      if (order.modules[p] !== pin) errors.push(`${at}[${k}].modules[${p}]: the slot pins ${quoted(pin)} at position ${p + 1}; an order keeps every pinned module at its position`);
    });
    // P04: and every module pinned at a position, at that position.
    for (const pin of slot.positionPins ?? []) {
      if (order.modules[pin.position - 1] !== pin.pieceId) errors.push(`${at}[${k}].modules[${pin.position - 1}]: the slot pins ${quoted(pin.pieceId)} at position ${pin.position} (positionPins); an order keeps every pinned module at its position`);
    }
    for (let j = 0; j < k; j++) {
      const a = orders[j]!.context, b = order.context;
      const same = a.channel === b.channel && bucketsOf(a, terms).length === bucketsOf(b, terms).length && bucketsOf(a, terms).every(v => bucketsOf(b, terms).includes(v))
        && (a.visitBuckets === 'any') === (b.visitBuckets === 'any') && a.device === b.device;
      if (same) { errors.push(`${at}[${k}].context: two orders for one context (${contextWords(b)}); orders[${j}] already sets it`); continue; }
      const shared = sharedShopper(a, b, terms);
      if (shared !== null && contextSpecificity(a) === contextSpecificity(b)) {
        errors.push(`${at}[${k}].context: ${contextWords(b)} and orders[${j}] (${contextWords(a)}) both match one shopper (${shared}) with equal specificity ${contextSpecificity(b)}; the most specific context must decide, so make one more specific or remove one`);
      }
    }
  });
  return errors;
}

/**
 * P01 (O5, R-P24): the cross-document half of the order refusals, which only the
 * route that holds both documents can make: every module an order names must be
 * a piece of the published catalogue that names the slot in its `slotTypes`,
 * and one the slot's own tag and type gates admit. Pure; the caller supplies the
 * catalogue it read. A later catalogue change is not refused here: the decision
 * serves the order without a module that is no longer eligible. P32: the gates
 * read the catalogue's marker as the decision does, so under `typeFallback:
 * 'retired'` a `contentType` exclusion refuses a module by its own tag alone.
 */
export function slotOrderCatalogueErrors(document: Pick<SlotCatalog, 'pages'>, catalog: Pick<ContentCatalog, 'pieces' | 'typeFallback'>): string[] {
  const byId = new Map<string, ContentPiece>();
  for (const piece of catalog.pieces) if (!byId.has(piece.id)) byId.set(piece.id, piece);
  const errors: string[] = [];
  for (const [page, slots] of Object.entries(document.pages)) {
    slots.forEach((slot, index) => {
      if (!slot.orders?.length) return;
      const gate = compileSlotConstraints(typeFallbackRetired(catalog) ? { ...slot, typeFallback: TYPE_FALLBACK_RETIRED } : slot);
      slot.orders.forEach((order, k) => order.modules.forEach((id, p) => {
        const at = `pages.${page}[${index}].orders[${k}].modules[${p}]`, piece = byId.get(id);
        if (!piece) { errors.push(`${at}: ${quoted(id)} is not a registered module: no piece of the published catalogue has that id`); return; }
        if (!piece.slotTypes.includes(slot.slot)) { errors.push(`${at}: ${quoted(id)} is in the catalogue but does not name slot '${slot.slot}' in its slotTypes, so the slot can never serve it`); return; }
        const refusal = gate.refusal(piece);
        if (refusal) errors.push(`${at}: ${quoted(id)} is refused by slot '${slot.slot}' (${refusal.reason === 'type_not_allowed' ? `its type ${quoted(piece.type)} is not in allowedTypes`
          : refusal.reason === 'excluded_tag' ? `excludedTags pair ${refusal.dimension ?? ''}=${refusal.value ?? ''}` : refusal.reason}), so the order could not serve it`);
      }));
    });
  }
  return errors;
}

// ── P26: the inner content slots of the declared layout slot ────────────────

/**
 * P26 (decision D1): a layout slot's inner content slots, structurally: an
 * object of module id (a string of 1..1024 UTF-16 units) to the name of a slot
 * (a slug), each kept exactly as authored. Errors are suffixes of the member's
 * path. Which slots the names may be, and which slot may carry the member, are
 * authoring rules (`innerAuthoringErrors`); whether each module is one the
 * layout could return is checked against the catalogue at the slots route
 * (`slotInnerCatalogueErrors`).
 */
export function validateInner(candidate: unknown): ValidationResult<Record<string, string>> {
  if (!isRecord(candidate)) return { ok: false, errors: [': an object of module id → the name of a slot of the same page, the module\'s inner content slot'] };
  const errors: string[] = [], entries: Array<[string, string]> = [];
  for (const [id, name] of Object.entries(candidate)) {
    if (!moduleId(id)) { errors.push(`[${quoted(id)}]: a module id, a string of 1..1024 UTF-16 units`); continue; }
    if (!isStr(name) || !SLUG.test(name)) { errors.push(`[${quoted(id)}]: ${quoted(name)} is not a slot name; the module's inner content slot is named by its slot (a slug)`); continue; }
    entries.push([id, name]);
  }
  // Own data properties only, whatever a module id is spelt as.
  return errors.length ? { ok: false, errors } : { ok: true, value: Object.fromEntries(entries) };
}

/**
 * P26 (decision D1): the authoring rules of a slot's inner content slots,
 * applied at publication only and named `pages.{page}[i].inner`: the member is
 * set only on the page's declared layout slot; each value names a slot of the
 * same page that is no layout slot (the layout slot itself included); and one
 * inner slot holds the content of one module.
 */
function innerAuthoringErrors(page: string, index: number, slot: SlotStrategy, pageSlots: readonly SlotStrategy[]): string[] {
  const at = `pages.${page}[${index}].inner`, inner = slot.inner;
  if (!inner) return [];
  if (slot.layout !== true) return [`${at}: slot '${slot.slot}' is not the declared layout slot of page '${page}'; a module's inner content slots are named only on the slot that declares layout: true`];
  const errors: string[] = [], byName = new Map(pageSlots.map((s) => [s.slot, s] as const)), owner = new Map<string, string>();
  for (const [module, name] of Object.entries(inner)) {
    const here = `${at}[${quoted(module)}]`, target = byName.get(name);
    if (!target) { errors.push(`${here}: ${quoted(name)} is no slot of page '${page}'; a module's inner content slot is an ordinary slot of the same page`); continue; }
    if (target.layout === true) { errors.push(`${here}: ${quoted(name)} is ${target === slot ? 'this layout slot itself' : `a layout slot of page '${page}'`}; a module's inner content slot is an ordinary content slot, never a layout slot`); continue; }
    const first = owner.get(name);
    if (first !== undefined) errors.push(`${here}: ${quoted(name)} is already the inner content slot of module ${quoted(first)}; one inner slot holds the content of one module`);
    else owner.set(name, module);
  }
  return errors;
}

/**
 * P26 (NC5, R-P24): a layout slot's inner content slots name modules, and only
 * the catalogue says which modules exist, so the refusal of a key naming a
 * module the catalogue does not define as a candidate of that layout slot — no
 * piece has that id, or the piece does not name the layout slot in its
 * `slotTypes`, so the layout could never return it — is made at the slots
 * route beside P01's order check (src/routes/content.ts), against the catalogue
 * published with it in the same request or else the one in force.
 */
export function slotInnerCatalogueErrors(document: Pick<SlotCatalog, 'pages'>, catalog: Pick<ContentCatalog, 'pieces'>): string[] {
  const byId = new Map<string, ContentPiece>();
  for (const piece of catalog.pieces) if (!byId.has(piece.id)) byId.set(piece.id, piece);
  const errors: string[] = [];
  for (const [page, slots] of Object.entries(document.pages)) {
    slots.forEach((slot, index) => {
      if (!slot.inner || slot.layout !== true) return;
      for (const module of Object.keys(slot.inner)) {
        const at = `pages.${page}[${index}].inner[${quoted(module)}]`, piece = byId.get(module);
        if (!piece) errors.push(`${at}: ${quoted(module)} is not a module of slot '${slot.slot}': no piece of the published catalogue has that id`);
        else if (!piece.slotTypes.includes(slot.slot)) errors.push(`${at}: ${quoted(module)} is in the catalogue but does not name slot '${slot.slot}' in its slotTypes, so the layout can never return it`);
      }
    });
  }
  return errors;
}

/**
 * @param governance The version the document is read under (0 = unmarked legacy).
 * @param earlyMark For a WRITE only: the version 1, 2 or 3 the candidate is marked
 *   with, under which a layout declaration is refused by name (P02.A4); null
 *   otherwise. A retained document marked earlier than 4 ignores the member, as
 *   it ignores every member introduced after it.
 */
function validateSlot(s: unknown, page: string, i: number, seen: Set<string>, errors: string[], governance: 0 | 1 | 2 | 3 | 4,
  earlyMark: 1 | 2 | 3 | null = null, terms: SlotTerms = TODAY_TERMS): SlotStrategy | null {
  const at = `pages.${page}[${i}]`;
  if (!isRecord(s)) { errors.push(`${at}: must be an object`); return null; }
  const slot = s.slot;
  if (!isStr(slot) || !SLUG.test(slot)) errors.push(`${at}.slot: required slug`);
  else if (seen.has(slot)) errors.push(`${at}.slot: duplicate '${slot}' on page '${page}'`);
  else seen.add(slot);
  const take = s.take;
  if (!isNum(take) || !Number.isInteger(take) || take < 1 || take > 50) errors.push(`${at}.take: integer 1..50`);
  const weights: Record<string, number> = {};
  if (!isRecord(s.weights)) errors.push(`${at}.weights: required object of dimension → number`);
  else for (const [dim, w] of Object.entries(s.weights)) {
    if (!isNum(w) || w < 0 || w > 1) { errors.push(`${at}.weights.${dim}: number 0..1`); continue; }
    weights[dim] = w;
  }
  if (s.pinnedPieceId !== undefined && !isStr(s.pinnedPieceId)) errors.push(`${at}.pinnedPieceId: string when present`);
  let pinnedPieceIds: string[] | undefined;
  if (governance >= 3 && Object.hasOwn(s, 'pinnedPieceIds')) {
    const ids = s.pinnedPieceIds;
    if (!Array.isArray(ids) || ids.length > 50 || !Array.from(ids).every(isStr) || new Set(ids).size !== ids.length) errors.push(`${at}.pinnedPieceIds: at most 50 distinct exact nonempty strings`);
    else pinnedPieceIds = [...ids];
    if (Object.hasOwn(s, 'pinnedPieceId')) errors.push(`${at}: scalar and prefix pins are mutually exclusive`);
  }
  let excludedPieceIds: string[] | undefined;
  if (governance) {
    if (Object.hasOwn(s, 'offLimits') && typeof s.offLimits !== 'boolean') errors.push(`${at}.offLimits: boolean when present`);
    if (Object.hasOwn(s, 'excludedPieceIds')) {
      const ids = s.excludedPieceIds;
      if (!Array.isArray(ids) || ids.length > 1000 || Array.from(ids).some(id => typeof id !== 'string' || id.length < 1 || id.length > 1024)
        || new Set(ids).size !== ids.length) errors.push(`${at}.excludedPieceIds: at most 1000 distinct exact IDs, each 1..1024 UTF-16 units`);
      else excludedPieceIds = [...ids] as string[];
    }
  }
  let allowedTypes: string[] | undefined, excludedTags: SlotStrategy['excludedTags'];
  if (governance >= 2) {
    const exactString = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= 1024;
    if (Object.hasOwn(s, 'allowedTypes')) {
      const values = s.allowedTypes;
      if (!Array.isArray(values) || values.length < 1 || values.length > 1000 || Array.from(values).some(v => !exactString(v))
        || new Set(values).size !== values.length) errors.push(`${at}.allowedTypes: 1..1000 distinct exact rendering types, each 1..1024 UTF-16 units`);
      else allowedTypes = [...values] as string[];
    }
    if (Object.hasOwn(s, 'excludedTags')) {
      const pairs = s.excludedTags, tuples = new Map<string, Set<string>>();
      if (!Array.isArray(pairs) || pairs.length > 1000) errors.push(`${at}.excludedTags: at most 1000 exact dimension/value pairs`);
      else {
        excludedTags = [];
        for (const pair of Array.from(pairs)) {
          if (!isRecord(pair) || Reflect.ownKeys(pair).length !== 2 || !Object.hasOwn(pair, 'dimension') || !Object.hasOwn(pair, 'value')
            || !exactString(pair.dimension) || !exactString(pair.value)) {
            errors.push(`${at}.excludedTags: each pair must have only dimension and value, strings of 1..1024 UTF-16 units`); continue;
          }
          let values = tuples.get(pair.dimension);
          if (!values) { values = new Set(); tuples.set(pair.dimension, values); }
          if (values.has(pair.value)) errors.push(`${at}.excludedTags: duplicate exact pair`);
          else { values.add(pair.value); excludedTags.push({ dimension: pair.dimension, value: pair.value }); }
        }
      }
    }
  }
  let merchandising: Record<string, number> | undefined;
  if (s.merchandising !== undefined) {
    if (!isRecord(s.merchandising)) errors.push(`${at}.merchandising: object of season | promotion | margin → weight -1..1, maxBoost ≥ 1, minBoost 0..1`);
    else {
      merchandising = {};
      for (const [k, v] of Object.entries(s.merchandising)) {
        const okTerm = ['season', 'promotion', 'margin'].includes(k) && isNum(v) && v >= -1 && v <= 1;
        const okMax = k === 'maxBoost' && isNum(v) && v >= 1;
        const okMin = k === 'minBoost' && isNum(v) && v >= 0 && v <= 1;
        if (!okTerm && !okMax && !okMin) { errors.push(`${at}.merchandising.${k}: season | promotion | margin in -1..1, maxBoost ≥ 1, minBoost 0..1`); continue; }
        merchandising[k] = v as number;
      }
    }
  }
  let stage: StageRule | undefined;
  if (s.stage !== undefined) {
    if (!isRecord(s.stage)) errors.push(`${at}.stage: object with outOfStage 0..1 and/or inStage 0..1`);
    else {
      stage = {};
      for (const [k, v] of Object.entries(s.stage)) {
        if ((k !== 'outOfStage' && k !== 'inStage') || !isNum(v) || v < 0 || v > 1) { errors.push(`${at}.stage.${k}: outOfStage | inStage, number 0..1`); continue; }
        stage[k] = v;
      }
    }
  }
  let freshness: FreshnessRule | undefined;
  if (s.freshness !== undefined) {
    const f = s.freshness;
    if (!isRecord(f) || !isNum(f.weight) || f.weight < 0 || f.weight > 1 || !isNum(f.halfLifeDays) || f.halfLifeDays <= 0) errors.push(`${at}.freshness: { weight 0..1, halfLifeDays > 0 }`);
    else freshness = { weight: f.weight, halfLifeDays: f.halfLifeDays };
  }
  let fatigue: FatigueRule | undefined;
  if (s.fatigue !== undefined) {
    const f = s.fatigue;
    if (!isRecord(f) || !isNum(f.weight) || f.weight < 0 || f.weight > 1 || !isNum(f.windowHours) || f.windowHours <= 0 || !isNum(f.cap) || !Number.isInteger(f.cap) || f.cap < 1) errors.push(`${at}.fatigue: { weight 0..1, windowHours > 0, cap integer ≥ 1 }`);
    else fatigue = { weight: f.weight, windowHours: f.windowHours, cap: f.cap };
  }
  // The composer's `prefer` hook, published: prefer what completes the request's anchor product.
  let complements: ComplementsRule | undefined;
  if (s.complements !== undefined) {
    const c = s.complements;
    if (!isRecord(c) || !isNum(c.weight) || c.weight < 0 || c.weight > 1) errors.push(`${at}.complements: { weight 0..1 }`);
    else complements = { weight: c.weight };
  }
  let diversity: DiversityRule | undefined;
  if (s.diversity !== undefined) {
    const d = s.diversity;
    if (!isRecord(d) || !isStr(d.dimension) || !isNum(d.max) || !Number.isInteger(d.max) || d.max < 1) errors.push(`${at}.diversity: { dimension: a tag dimension, max: integer ≥ 1 }`);
    else diversity = { dimension: d.dimension.trim(), max: d.max };
  }
  // W16 C3 / R30(1): the seed rule set is read on every slot regardless of the
  // governance marker, as merchandising, stage, freshness, fatigue and diversity
  // are: a retained document is interpreted with the governance it declares, and
  // the rules are scored against the weights that stand beside them.
  let seeds: SeedRule[] | undefined;
  if (s.seeds !== undefined) {
    const checked = validateSeedRules(s.seeds, weights, terms);
    if (!checked.ok) for (const error of checked.errors) errors.push(`${at}.seeds${error}`);
    else seeds = checked.value;
  }
  // P02: the page's declared layout slot. Its K is the slot's own `take`, held
  // to 1..50 above like every take; one per page is a publication rule
  // (`validateSlotCatalog`). `false` declares nothing and is not kept.
  let layout = false;
  if (declaresLayout(s)) {
    if (governance >= LAYOUT_GOVERNANCE_VERSION) {
      if (typeof s.layout !== 'boolean') errors.push(`${at}.layout: boolean when present (true declares this page's layout slot)`);
      else layout = s.layout;
    } else if (earlyMark !== null) {
      errors.push(`${at}.layout: a layout declaration needs governanceVersion ${LAYOUT_GOVERNANCE_VERSION}, the version that introduces it; this document is marked governanceVersion ${earlyMark}`);
    }
  }
  // P01: the layout slot's per-context orders, a version-4 member like the
  // declaration itself. An empty list carries nothing and is not kept.
  let orders: ConfiguredOrder[] | undefined;
  if (carriesOrders(s)) {
    if (governance >= LAYOUT_GOVERNANCE_VERSION) {
      const checked = validateOrders(s.orders, isNum(take) && Number.isInteger(take) && take >= 1 && take <= 50 ? take : 50, terms);
      if (!checked.ok) for (const error of checked.errors) errors.push(`${at}.orders${error}`);
      else orders = checked.value;
    } else if (earlyMark !== null) {
      errors.push(`${at}.orders: per-context orders need governanceVersion ${LAYOUT_GOVERNANCE_VERSION}, the version that introduces them; this document is marked governanceVersion ${earlyMark}`);
    }
  }
  // P04: the layout slot's position pins and off-limits marks, version-4
  // members like the declaration itself. An empty list carries nothing and is
  // not kept; how they relate to the rest of the slot and the page are
  // authoring rules of `validateSlotCatalog`, never reinterpreted on a read.
  let positionPins: PositionPin[] | undefined;
  if (carriesList(s, 'positionPins')) {
    if (governance >= LAYOUT_GOVERNANCE_VERSION) {
      const checked = validatePositionPins(s.positionPins, isNum(take) && Number.isInteger(take) && take >= 1 && take <= 50 ? take : 50);
      if (!checked.ok) for (const error of checked.errors) errors.push(`${at}.positionPins${error}`);
      else positionPins = checked.value;
    } else if (earlyMark !== null) {
      errors.push(`${at}.positionPins: modules pinned at a position need governanceVersion ${LAYOUT_GOVERNANCE_VERSION}, the version that introduces them; this document is marked governanceVersion ${earlyMark}`);
    }
  }
  let offLimitsPieceIds: string[] | undefined;
  if (carriesList(s, 'offLimitsPieceIds')) {
    if (governance >= LAYOUT_GOVERNANCE_VERSION) {
      const checked = validateOffLimitsPieceIds(s.offLimitsPieceIds);
      if (!checked.ok) for (const error of checked.errors) errors.push(`${at}.offLimitsPieceIds${error}`);
      else offLimitsPieceIds = checked.value;
    } else if (earlyMark !== null) {
      errors.push(`${at}.offLimitsPieceIds: off-limits modules need governanceVersion ${LAYOUT_GOVERNANCE_VERSION}, the version that introduces them; this document is marked governanceVersion ${earlyMark}`);
    }
  }
  // P10: the slot's own signal floor, read under every governance version like
  // the seed rules: a whole number of 0 or more, or `never`. That `never` is
  // published only on the page's declared layout slot is an authoring rule of
  // `validateSlotCatalog`, never reinterpreted on a read.
  let signalFloor: SignalFloor | undefined;
  if (s.signalFloor !== undefined) {
    if (s.signalFloor === 'never' || isSignalCount(s.signalFloor)) signalFloor = s.signalFloor;
    else errors.push(`${at}.signalFloor: ${quoted(s.signalFloor)} is not a signal floor; a slot's floor is a whole number of 0 or more, or never on the page's declared layout slot`);
  }
  // P30 (decision D1): the context-only layout switch, a version-4 member like
  // the declaration itself, kept exactly as authored: `enabled`, and `region`
  // when given. That it is published only on the page's declared layout slot is
  // an authoring rule of `validateSlotCatalog`, never reinterpreted on a read.
  let contextOnly: ContextOnlySwitch | undefined;
  if (carriesContextOnly(s)) {
    if (governance >= LAYOUT_GOVERNANCE_VERSION) {
      const c = s.contextOnly;
      if (!isRecord(c) || typeof c.enabled !== 'boolean' || (c.region !== undefined && typeof c.region !== 'boolean')
        || Object.keys(c).some(key => key !== 'enabled' && key !== 'region')) {
        errors.push(`${at}.contextOnly: { enabled: boolean, region?: boolean } when present — the context-only layout switch, off by default (absent or enabled: false)`);
      } else contextOnly = { enabled: c.enabled, ...(c.region !== undefined ? { region: c.region } : {}) };
    } else if (earlyMark !== null) {
      errors.push(`${at}.contextOnly: the context-only layout switch needs governanceVersion ${LAYOUT_GOVERNANCE_VERSION}, the version that introduces it; this document is marked governanceVersion ${earlyMark}`);
    }
  }
  // P15 (decision D1): the slot's position bands, read under every governance
  // version like the seed rules (no revision written before this build carries
  // them). Absent means none; any list, an empty one included, must be
  // contiguous over positions 1 to take, each band carrying only its weights.
  let bands: PositionBand[] | undefined;
  if (s.bands !== undefined && isNum(take) && Number.isInteger(take) && take >= 1 && take <= 50) {
    const checked = validateBands(s.bands, take);
    if (!checked.ok) for (const error of checked.errors) errors.push(`${at}.bands${error}`);
    else bands = checked.value;
  }
  // P26 (decision D1): the layout slot's inner content slots, a version-4
  // member like the declaration itself, kept exactly as authored: each module
  // id to the name of a slot of the same page. An empty object carries nothing
  // and is not kept. How it relates to the page (the declared layout slot only,
  // a slot of the page that is no layout slot, one module per inner slot) is an
  // authoring rule of `validateSlotCatalog`, never reinterpreted on a read.
  let inner: Record<string, string> | undefined;
  if (carriesInner(s)) {
    if (governance >= LAYOUT_GOVERNANCE_VERSION) {
      const checked = validateInner(s.inner);
      if (!checked.ok) for (const error of checked.errors) errors.push(`${at}.inner${error}`);
      else inner = checked.value;
    } else if (earlyMark !== null) {
      errors.push(`${at}.inner: a module's inner content slots need governanceVersion ${LAYOUT_GOVERNANCE_VERSION}, the version that introduces them; this document is marked governanceVersion ${earlyMark}`);
    }
  }
  if (!isStr(slot) || !isNum(take) || !isRecord(s.weights)) return null;
  return {
    slot, take, weights, ...(isStr(s.pinnedPieceId) ? { pinnedPieceId: s.pinnedPieceId } : {}), ...(merchandising && Object.keys(merchandising).length ? { merchandising } : {}),
    ...(governance && typeof s.offLimits === 'boolean' ? { offLimits: s.offLimits } : {}), ...(excludedPieceIds ? { excludedPieceIds } : {}),
    ...(allowedTypes ? { allowedTypes } : {}), ...(excludedTags ? { excludedTags } : {}), ...(pinnedPieceIds ? { pinnedPieceIds } : {}),
    ...(stage && Object.keys(stage).length ? { stage } : {}), ...(freshness ? { freshness } : {}), ...(fatigue ? { fatigue } : {}), ...(diversity ? { diversity } : {}),
    ...(seeds ? { seeds } : {}), ...(layout ? { layout: true as const } : {}), ...(orders ? { orders } : {}), ...(complements ? { complements } : {}),
    ...(signalFloor !== undefined ? { signalFloor } : {}),
    ...(positionPins ? { positionPins } : {}), ...(offLimitsPieceIds ? { offLimitsPieceIds } : {}),
    ...(contextOnly ? { contextOnly } : {}),
    ...(bands ? { bands } : {}),
    ...(inner ? { inner } : {}),
  };
}

function parseSlotCatalog(candidate: unknown, current = false, terms: SlotTerms = TODAY_TERMS): ValidationResult<SlotCatalog> {
  const errors: string[] = [];
  if (!isRecord(candidate)) return { ok: false, errors: ['slots: must be an object'] };
  const marked = Object.hasOwn(candidate, 'governanceVersion');
  const mark = candidate.governanceVersion;
  if (marked && mark !== 1 && mark !== 2 && mark !== 3 && mark !== LAYOUT_GOVERNANCE_VERSION) errors.push('governanceVersion: only versions 1, 2, 3 and 4 are supported');
  // P02: version 4 introduces the layout declaration and otherwise reads as 3.
  // A write is read under the current contract — 3, as before — unless it is
  // marked 4, or is unmarked and declares a layout (then it is written as 4, so
  // its retained revision keeps the declaration). A write marked 1, 2 or 3 that
  // declares a layout is refused by name; a RETAINED document marked earlier
  // than 4 ignores the member, as it ignores every later member.
  // P01: per-context orders are a version-4 member too, so an unmarked write
  // carrying them is read under version 4 and refused there if misplaced.
  // P04: as are position pins and off-limits marks.
  // P26: as are a layout slot's inner content slots.
  const declares = current && !marked && isRecord(candidate.pages)
    && Object.values(candidate.pages).some(list => Array.isArray(list) && list.some(s => declaresLayout(s) || carriesOrders(s) || carriesModuleRules(s) || carriesContextOnly(s) || carriesInner(s)));
  const governance = mark === LAYOUT_GOVERNANCE_VERSION || declares ? LAYOUT_GOVERNANCE_VERSION : current || mark === 3 ? 3 : mark === 2 ? 2 : marked ? 1 : 0;
  const earlyMark = current && (mark === 1 || mark === 2 || mark === 3) ? mark : null;
  if (candidate.version !== undefined && !isStr(candidate.version)) errors.push('version: string when present');
  // P10: the tenant's signal floor, a whole number of 0 or more (absent is 0).
  // `never` belongs to the declared layout slot alone and is never a tenant floor.
  const signalFloor = candidate.signalFloor;
  if (signalFloor !== undefined && !isSignalCount(signalFloor)) {
    errors.push(signalFloor === 'never'
      ? 'signalFloor: never is not a tenant floor; it is set only on a page\'s declared layout slot (its own signalFloor), and the tenant floor is a whole number of 0 or more'
      : `signalFloor: ${quoted(signalFloor)} is not a signal floor; the tenant floor is a whole number of 0 or more (0, the default, is off)`);
  }
  if (!isRecord(candidate.pages)) return { ok: false, errors: [...errors, 'pages: required object of page → slot[]'] };
  const pages: Record<string, SlotStrategy[]> = {};
  for (const [page, list] of Object.entries(candidate.pages)) {
    if (!SLUG.test(page)) { errors.push(`pages.${page}: page name must be a slug`); continue; }
    if (!Array.isArray(list)) { errors.push(`pages.${page}: must be an array`); continue; }
    const seen = new Set<string>();
    const slots: SlotStrategy[] = [];
    list.forEach((s, i) => { const v = validateSlot(s, page, i, seen, errors, governance, earlyMark, terms); if (v) slots.push(v); });
    pages[page] = slots;
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { ...(isStr(candidate.version) ? { version: candidate.version } : {}), ...(governance ? { governanceVersion: governance } : {}),
    ...(isSignalCount(signalFloor) ? { signalFloor } : {}), pages } };
}

/**
 * Publication rejects local contradictions without reinterpreting retained revisions.
 * One argument: today's terms, the six channel words and 1, 2-3, 4+ (a tenant
 * without the settings). P36 (R-P46): the authoring door passes the tenant's
 * terms, and the publication store, which holds no tenant, the grammar alone.
 */
export function validateSlotCatalog(candidate: unknown, terms: SlotTerms = TODAY_TERMS): ValidationResult<SlotCatalog> {
  const checked = parseSlotCatalog(candidate, true, terms);
  if (!checked.ok) return checked;
  const errors: string[] = [];
  /**
   * W26 I1.01 (F21 §6(b), §8): the learning identity is tenant/brand/slot and
   * carries no page, so two placements that share a slot name on two pages pool
   * into ONE statistics object without anyone saying so — a hero on the home
   * page and a hero on a product page learn from each other's exposures. F21 §8
   * offers two remedies, "page in `statsName`/`liftKey`, or an enforced global
   * uniqueness of slot names across pages". The first is a storage migration of
   * every retained snapshot; this is the second, and it removes the ambiguity
   * where it is created rather than after the fact.
   *
   * It is an AUTHORING rule, applied here and never in `parseSlotCatalog` /
   * `validateStored`: a document already retained with a cross-page duplicate
   * keeps reading exactly as it did, because refusing it at read time would
   * take a tenant's live catalogue away from them to fix a naming problem.
   * W26 R2 gives that retained document the first remedy as well: for the
   * names it carries on more than one page, the page is part of the storage
   * identity (`pageScopedSlotNames` below), so it never pools silently either.
   */
  const pageOfSlot = new Map<string, string>();
  for (const [page, slots] of Object.entries(checked.value.pages)) {
    for (const slot of slots) {
      const owner = pageOfSlot.get(slot.slot);
      if (owner !== undefined) errors.push(`pages.${page}.${slot.slot}: slot name '${slot.slot}' is already used on page '${owner}'; slot names must be unique across the pages of a brand, because one slot name is one statistics object`);
      else pageOfSlot.set(slot.slot, page);
    }
  }
  // P02: a page's layout is ONE declared slot of K positions; a second
  // declaration on the same page is a contradiction, refused where it is
  // authored (a retained document is never reinterpreted here).
  for (const [page, slots] of Object.entries(checked.value.pages)) {
    const declared = slots.filter(slot => slot.layout === true);
    for (const extra of declared.slice(1)) {
      errors.push(`pages.${page}.${extra.slot}: a page declares at most one layout slot; '${declared[0]!.slot}' is already the layout of page '${page}'`);
    }
  }
  // P01: per-context orders, refused where they are authored whenever they
  // could not be served exactly (a retained document is never reinterpreted).
  for (const [page, slots] of Object.entries(checked.value.pages)) {
    slots.forEach((slot, index) => { if (slot.orders) errors.push(...orderAuthoringErrors(page, index, slot, slots, terms)); });
  }
  // P04: position pins and off-limits marks, refused where they are authored
  // whenever they could not be served as published (a retained document is
  // never reinterpreted).
  for (const [page, slots] of Object.entries(checked.value.pages)) {
    slots.forEach((slot, index) => errors.push(...moduleRuleAuthoringErrors(page, index, slot)));
  }
  // P10 (F3): `never` keeps a slot context-only for every shopper, which is what
  // makes a page's layout one answer per context; it is published only on the
  // page's declared layout slot, so a content slot always keeps a floor its
  // shoppers can pass.
  for (const [page, slots] of Object.entries(checked.value.pages)) {
    slots.forEach((slot, index) => {
      if (slot.signalFloor === 'never' && slot.layout !== true) errors.push(`pages.${page}[${index}].signalFloor: never is set only on the page's declared layout slot (layout: true); slot '${slot.slot}' is not the declared layout slot of page '${page}', so its floor is a whole number of 0 or more`);
    });
  }
  // P30 (decision D1): the context-only switch makes a page's layout one answer
  // per context, so it is set only on the page's declared layout slot; on any
  // other slot it is refused by name where it is authored (a retained document
  // is never reinterpreted, and the decision reads the switch on the declared
  // layout slot alone).
  for (const [page, slots] of Object.entries(checked.value.pages)) {
    slots.forEach((slot, index) => {
      if (slot.contextOnly !== undefined && slot.layout !== true) errors.push(`pages.${page}[${index}].contextOnly: slot '${slot.slot}' is not the declared layout slot of page '${page}'; the context-only switch is set only on the slot that declares layout: true`);
    });
  }
  // P26 (decision D1): a module's inner content slots are named only on the
  // page's declared layout slot, each an ordinary slot of the same page, one
  // per module; refused by name where they are authored (a retained document is
  // never reinterpreted, and the decision nests only under the declared layout).
  for (const [page, slots] of Object.entries(checked.value.pages)) {
    slots.forEach((slot, index) => errors.push(...innerAuthoringErrors(page, index, slot, slots)));
  }
  for (const [page, slots] of Object.entries(checked.value.pages)) {
    const owners = new Map<string, string>();
    for (const slot of slots) {
      if (slot.offLimits) continue;
      if (slot.pinnedPieceId && slot.take !== 1) errors.push(`pages.${page}.${slot.slot}: pinned slots must take exactly 1`);
      if (slot.pinnedPieceIds && slot.pinnedPieceIds.length > slot.take) errors.push(`pages.${page}.${slot.slot}: pin prefix cannot exceed take`);
      for (const id of slot.pinnedPieceIds ?? (slot.pinnedPieceId ? [slot.pinnedPieceId] : [])) {
        if (slot.excludedPieceIds?.includes(id)) errors.push(`pages.${page}.${slot.slot}: pinnedPieceId is explicitly excluded`);
        const owner = owners.get(id);
        if (owner !== undefined) errors.push(`pages.${page}.${slot.slot}: pinnedPieceId duplicates pin in ${owner}`);
        else owners.set(id, slot.slot);
      }
      // P04: a module pinned at a position is reserved page-wide, as a prefix pin is.
      for (const pin of slot.positionPins ?? []) {
        const owner = owners.get(pin.pieceId);
        if (owner === undefined) owners.set(pin.pieceId, slot.slot);
        else if (owner !== slot.slot) errors.push(`pages.${page}.${slot.slot}: positionPins pins ${quoted(pin.pieceId)}, which ${owner} already pins; a pin reserves its module page-wide`);
      }
    }
  }
  return errors.length ? { ok: false, errors } : checked;
}

/** A page or slot name as every catalogue spells it (`SLUG`): no `:`, `@` or `/`. */
export const isCatalogueName = (v: unknown): v is string => typeof v === 'string' && SLUG.test(v);

/**
 * W26 R2 (F21 §6(b), §8 "Page in `statsName`/`liftKey`"; LANE-LOG R198): the
 * pages each slot name of a catalogue is carried on, in catalogue order.
 *
 * I1.01 above refuses a NEW catalogue that reuses a slot name on a second page.
 * A document RETAINED from before that rule still reads (`validateStored`), and
 * for its cross-page names the page is part of the learning identity: those
 * placements are learned, published, served, reported, monitored and cleaned up
 * as separate objects (`statsName`, `liftKey`, `liftArchiveKey` in
 * `src/learn/fan.ts`), never pooled. Every occurrence counts, an off-limits one
 * included, so switching a placement on or off never moves another placement's
 * evidence to a different object.
 */
export function slotPagesOf(catalog: Pick<SlotCatalog, 'pages'> | null | undefined): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [page, slots] of Object.entries(catalog?.pages ?? {})) {
    if (!Array.isArray(slots)) continue;
    for (const s of slots) {
      if (!isRecord(s) || typeof s.slot !== 'string') continue;
      const pages = out.get(s.slot) ?? [];
      if (!pages.includes(page)) pages.push(page);
      out.set(s.slot, pages);
    }
  }
  return out;
}

/**
 * W26 R2: the slot names whose storage identity carries the page — the names a
 * catalogue carries on MORE than one page. A name carried on one page keeps the
 * page-less identity it has always had, and every statistic learned under it.
 * Sorted, so every consumer that commits to the list sees one order.
 */
export function pageScopedSlotNames(catalog: Pick<SlotCatalog, 'pages'> | null | undefined): string[] {
  return [...slotPagesOf(catalog)].filter(([, pages]) => pages.length > 1).map(([slot]) => slot).sort();
}

/**
 * Starting weights for a homepage, on the default registry's dimensions. These
 * are proposed, not discovered: the customer agrees them at registry sign-off
 * and tunes from there. Nobody is handed an empty form on day one.
 */
export const DEFAULT_SLOTS: SlotCatalog = {
  version: 'slots-default',
  pages: {
    home: [
      { slot: 'hero', take: 1, weights: { occasion: 0.35, line: 0.25, category: 0.2, priceBand: 0.2 } },
      { slot: 'story', take: 2, weights: { occasion: 0.3, category: 0.25, silhouette: 0.25, priceBand: 0.2 } },
      { slot: 'rail', take: 5, weights: { line: 0.3, category: 0.25, occasion: 0.25, silhouette: 0.2 } },
    ],
  },
};

/**
 * P36 (R-P46): whether a slots document names anything a tenant's context
 * vocabulary decides — a seed rule on the channel, the source platform or the
 * landing-page type, or a per-context order — so the authoring door reads the
 * tenant's learn document only for such a document.
 */
export function slotsNameContext(candidate: unknown): boolean {
  if (!isRecord(candidate) || !isRecord(candidate.pages)) return false;
  return Object.values(candidate.pages).some(list => Array.isArray(list) && list.some(s => isRecord(s)
    && (carriesOrders(s) || (Array.isArray(s.seeds) && s.seeds.some(r => isRecord(r) && ['entry_channel', 'source_platform', 'landing_page_type'].includes(String(r.signal)))))));
}

export const SLOTS_KIND: DocumentKind<SlotCatalog> = {
  name: 'slots',
  publication: 'r2',
  // P36: the store holds no tenant, so it reads a channel, a bucket, a source
  // platform or a landing-page type by its grammar alone; the authoring door
  // (src/routes/content.ts) checks each against the tenant's own vocabulary
  // first, and the decision reads every rule against it again.
  validate: (candidate) => validateSlotCatalog(candidate, 'grammar'),
  validateStored: (candidate) => parseSlotCatalog(candidate, false, 'grammar'),
  stamp: (v, r) => ({ ...v, version: stampLabel(v.version, 'slots', r) }),
  versionOf: (v) => v.version ?? '',
};

// ── learn (holdout only, for now) ───────────────────────────────────────────

const ARMS = new Set(['default', 'no_learning']);

/**
 * `regional.dimensions` names registry dimensions, so it is held to what a
 * registry can define (src/reflex/configStore.ts): at most its 32 dimensions,
 * each an exact, distinct, non-empty key that is not a reserved object key. An
 * empty list is refused: `enabled: false` is how the prior is switched off.
 * This document is validated without the registry in hand; a well-formed name
 * the tenant's registry does not define matches nothing at decision time,
 * because a region only ever holds the dimensions its events carried.
 */
const REGIONAL_DIMENSIONS_MAX = 32;
const RESERVED_DIMENSION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function regionalDimensionsOf(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length < 1 || v.length > REGIONAL_DIMENSIONS_MAX) return null;
  if (!v.every((d) => isStr(d) && d.trim() === d && !RESERVED_DIMENSION_KEYS.has(d)) || new Set(v).size !== v.length) return null;
  return [...v] as string[];
}

export function validateLearnConfig(candidate: unknown): ValidationResult<LearnConfig> {
  return validateRetainedLearn(candidate, false);
}

/**
 * P28 (decision D1): the layout blend's dial, structurally — `{ p }` and nothing
 * else, `p` a number from 0 to 1, 0 when absent. P06 (decision D2) adds
 * `shadowP`, the p the slot's shadow order is ranked at, a number from 0 to 1,
 * 0.1 when absent. Errors are suffixes of the dial's address
 * (`slots.{slot}.blend`), so a refusal names the blend and the member.
 */
function blendDialErrors(candidate: unknown): string[] {
  if (!isRecord(candidate) || Object.keys(candidate).some(key => key !== 'p' && key !== 'shadowP')) return [': an object { p, shadowP } and nothing else, p a number from 0 to 1 (0 when absent), shadowP a number from 0 to 1 (0.1 when absent)'];
  const errors: string[] = [];
  if (candidate.p !== undefined && (!isNum(candidate.p) || candidate.p < 0 || candidate.p > 1)) errors.push(`.p: must be a number from 0 to 1, got ${quoted(candidate.p)}`);
  if (candidate.shadowP !== undefined && (!isNum(candidate.shadowP) || candidate.shadowP < 0 || candidate.shadowP > 1)) errors.push(`.shadowP: must be a number from 0 to 1 (the p of the slot's shadow order, 0.1 when absent), got ${quoted(candidate.shadowP)}`);
  return errors;
}

/**
 * P28 (decision D1, R-P31): the cross-document half of the blend's refusals,
 * which only the route that holds both documents can make: a slot whose learn
 * dials opt into the blend must be a page's DECLARED layout slot (P02's
 * `layout: true`) in the slots document, and on no page an ordinary slot of the
 * same name. Pure; the caller supplies the slots document it read. A later
 * slots change is not refused here: the decision applies the blend only on a
 * slot that declares the layout and decides any other slot exactly as before.
 */
export function learnBlendLayoutErrors(learn: Pick<LearnConfig, 'slots'>, slots: Pick<SlotCatalog, 'pages'>): string[] {
  const errors: string[] = [];
  for (const [slot, dials] of Object.entries(learn.slots ?? {})) {
    if (dials.blend === undefined) continue;
    const occurrences = Object.entries(slots.pages).flatMap(([page, list]) => list.filter(s => s.slot === slot).map(s => ({ page, declared: s.layout === true })));
    const undeclared = occurrences.find(o => !o.declared);
    if (!occurrences.length) errors.push(`slots.${slot}.blend: slot '${slot}' is on no page of the slots document; the blend is set only on a page's declared layout slot (layout: true, governanceVersion ${LAYOUT_GOVERNANCE_VERSION})`);
    else if (undeclared) errors.push(`slots.${slot}.blend: slot '${slot}' is not the declared layout slot of page '${undeclared.page}'; the blend is set only on a page's declared layout slot (layout: true, governanceVersion ${LAYOUT_GOVERNANCE_VERSION})`);
  }
  return errors;
}

/**
 * P05: does this learn document name the adjacent-swap mode or the
 * position-normalisation switch on any slot? Only such a document needs the
 * cross-document rule below, so a caller holding the slots document reads it
 * for nothing else.
 */
export function namesPositionDials(learn: Pick<LearnConfig, 'slots'>): boolean {
  return Object.values(learn.slots ?? {}).some(dials => dials.exploration?.mode === 'adjacent-swap' || dials.positionNormalization !== undefined);
}

/**
 * P05: the cross-document half of the adjacent swap's refusals, on the pattern
 * of `learnBlendLayoutErrors`: a slot whose learn dials name the adjacent-swap
 * mode or the position-normalisation switch must be a page's DECLARED layout
 * slot (P02's `layout: true`) in the slots document, and on no page an
 * ordinary slot of the same name — positions are counted within the layout
 * slot, and only there do swaps and their estimate exist. Pure; the caller
 * supplies the slots document it read. A later slots change is not refused
 * here: the decision swaps only on a slot that declares the layout.
 */
export function learnPositionLayoutErrors(learn: Pick<LearnConfig, 'slots'>, slots: Pick<SlotCatalog, 'pages'>): string[] {
  const errors: string[] = [];
  for (const [slot, dials] of Object.entries(learn.slots ?? {})) {
    const named: Array<[string, string]> = [
      ...(dials.exploration?.mode === 'adjacent-swap' ? [['exploration', 'the adjacent-swap mode'] as [string, string]] : []),
      ...(dials.positionNormalization !== undefined ? [['positionNormalization', 'the position-normalisation switch of the adjacent-swap estimate'] as [string, string]] : []),
    ];
    if (!named.length) continue;
    const occurrences = Object.entries(slots.pages).flatMap(([page, list]) => list.filter(s => s.slot === slot).map(s => ({ page, declared: s.layout === true })));
    const undeclared = occurrences.find(o => !o.declared);
    for (const [member, what] of named) {
      if (!occurrences.length) errors.push(`slots.${slot}.${member}: slot '${slot}' is on no page of the slots document; ${what} is set only on a page's declared layout slot (layout: true, governanceVersion ${LAYOUT_GOVERNANCE_VERSION})`);
      else if (undeclared) errors.push(`slots.${slot}.${member}: slot '${slot}' is not the declared layout slot of page '${undeclared.page}'; ${what} is set only on a page's declared layout slot (layout: true, governanceVersion ${LAYOUT_GOVERNANCE_VERSION})`);
    }
  }
  return errors;
}

// ── P36: the context vocabulary (the learn document's `contextVocabulary`) ──

/** The value a refusal names, printed in full up to a bound, so a long id is still named. */
function shown(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? typeof value;
  return `'${[...text.slice(0, 160)].map((ch) => { const code = ch.codePointAt(0)!; return code < 0x20 || (code >= 0x7f && code <= 0x9f) ? ' ' : ch; }).join('')}'${text.length > 160 ? '\u2026' : ''}`;
}
const CONTEXT_ID_WORDS = 'lower case letters, digits and underscores, starting with a letter, at most 64 characters, and neither unknown nor any';
/** A registrable domain as the network tables write one: lower case labels joined by dots. */
const DOMAIN = /^(?=.{3,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
/** The ladder's key letters in today's order (R-P51: the only order a vocabulary may name). */
const LADDER_ORDER: readonly string[] = ['c', 'v', 's', 'r', 'a'];
const VOCABULARY_MEMBERS = new Set(['channels', 'rules', 'sourcePlatforms', 'landingPageTypes', 'visitBuckets', 'ladder']);
const RULE_MEMBERS = new Set(['channel', 'utmMedium', 'utmSource', 'utmCampaign', 'referrer', 'untagged']);
const VOCABULARY_LIST_MAX = 64, VOCABULARY_RULES_MAX = 200, VOCABULARY_VALUES_MAX = 64, VOCABULARY_BUCKETS_MAX = 16, VOCABULARY_BOUND_MAX = 10_000;

/** One list of `{ id, name }` values (with `extra` members), each id in the grammar and listed once. */
function vocabularyIds(raw: unknown, at: string, errors: string[], extra?: (v: Record<string, unknown>, at: string) => void): string[] {
  const ids: string[] = [];
  if (!Array.isArray(raw) || raw.length > VOCABULARY_LIST_MAX) { errors.push(`${at}: a list of at most ${VOCABULARY_LIST_MAX} { id, name } values`); return ids; }
  Array.from(raw).forEach((v: unknown, i) => {
    const here = `${at}[${i}]`;
    if (!isRecord(v)) { errors.push(`${here}: an object { id, name }`); return; }
    const keys = extra ? ['id', 'name', 'networks'] : ['id', 'name'];
    for (const key of Object.keys(v)) if (!keys.includes(key)) errors.push(`${here}.${key}: not a member of this value (${keys.join(', ')})`);
    if (!isContextId(v.id)) errors.push(`${here}.id: ${shown(v.id)} is not an id: ${CONTEXT_ID_WORDS}`);
    else if (ids.includes(v.id)) errors.push(`${here}.id: ${shown(v.id)} is listed twice`);
    else ids.push(v.id);
    if (!isStr(v.name) || v.name.length > 128) errors.push(`${here}.name: a name of 1..128 characters`);
    extra?.(v, here);
  });
  return ids;
}
/** A rule's list condition: 1..64 non-empty strings of at most 256 characters. */
function vocabularyTokens(raw: unknown, at: string, errors: string[]): void {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > VOCABULARY_VALUES_MAX || !Array.from(raw).every((v) => isStr(v) && v.trim() !== '' && v.length <= 256)) {
    errors.push(`${at}: a list of 1..${VOCABULARY_VALUES_MAX} non-empty values of at most 256 characters, got ${shown(raw)}`);
  }
}
/** A list of registrable domains, as a network is named. */
function vocabularyDomains(raw: unknown, at: string, errors: string[]): void {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > VOCABULARY_VALUES_MAX) { errors.push(`${at}: a list of 1..${VOCABULARY_VALUES_MAX} registrable domains`); return; }
  Array.from(raw).forEach((v: unknown, i) => { if (typeof v !== 'string' || !DOMAIN.test(v)) errors.push(`${at}[${i}]: ${shown(v)} is not a registrable domain in lower case (for example example.com)`); });
}

/**
 * P36 (decision D1, R-P46, R-P51, R-P52): the context vocabulary, refused whole
 * on any error, each error naming `contextVocabulary`, the member and the
 * offending value. `visitBuckets` and `ladder` are optional (today's cut and
 * today's order at depth 5 when omitted); the ladder's order is today's
 * c, v, s, r, a and nothing else, its depth 1 to the order's length; the cut's
 * bounds are whole numbers strictly ascending from 1. The value is kept exactly
 * as authored.
 */
export function validateContextVocabulary(raw: unknown): ValidationResult<ContextVocabulary> {
  const at = 'contextVocabulary', errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: [`${at}: an object of channels, rules, sourcePlatforms, landingPageTypes, and optionally visitBuckets and ladder`] };
  for (const key of Object.keys(raw)) if (!VOCABULARY_MEMBERS.has(key)) errors.push(`${at}.${key}: not a member of the context vocabulary (${[...VOCABULARY_MEMBERS].join(', ')})`);
  const channels = vocabularyIds(raw.channels, `${at}.channels`, errors);
  if (Array.isArray(raw.channels) && raw.channels.length === 0) errors.push(`${at}.channels: at least one channel value`);
  if (!Array.isArray(raw.rules) || raw.rules.length > VOCABULARY_RULES_MAX) errors.push(`${at}.rules: a list of at most ${VOCABULARY_RULES_MAX} classification rules`);
  else Array.from(raw.rules).forEach((rule: unknown, i) => {
    const here = `${at}.rules[${i}]`;
    if (!isRecord(rule)) { errors.push(`${here}: an object { channel, and at least one of utmMedium, utmSource, utmCampaign, referrer, untagged }`); return; }
    for (const key of Object.keys(rule)) if (!RULE_MEMBERS.has(key)) errors.push(`${here}.${key}: not a member of a rule (${[...RULE_MEMBERS].join(', ')})`);
    if (typeof rule.channel !== 'string' || !channels.includes(rule.channel)) errors.push(`${here}.channel: ${shown(rule.channel)} is not one of the vocabulary's channel ids`);
    if (!['utmMedium', 'utmSource', 'utmCampaign', 'referrer', 'untagged'].some((key) => rule[key] !== undefined)) errors.push(`${here}: names at least one condition (utmMedium, utmSource, utmCampaign, referrer or untagged)`);
    for (const key of ['utmMedium', 'utmSource', 'utmCampaign'] as const) if (rule[key] !== undefined) vocabularyTokens(rule[key], `${here}.${key}`, errors);
    if (rule.referrer !== undefined && rule.referrer !== 'none' && rule.referrer !== 'external') vocabularyDomains(rule.referrer, `${here}.referrer`, errors);
    if (rule.untagged !== undefined && rule.untagged !== true) errors.push(`${here}.untagged: true when present (no utm_medium, utm_source or utm_campaign declared)`);
  });
  vocabularyIds(raw.sourcePlatforms, `${at}.sourcePlatforms`, errors, (v, here) => vocabularyDomains(v.networks, `${here}.networks`, errors));
  vocabularyIds(raw.landingPageTypes, `${at}.landingPageTypes`, errors);
  if (raw.visitBuckets !== undefined) {
    const cut = raw.visitBuckets;
    const whole = Array.isArray(cut) && cut.length >= 1 && cut.length <= VOCABULARY_BUCKETS_MAX
      && Array.from(cut).every((b: unknown) => typeof b === 'number' && Number.isSafeInteger(b) && b >= 1 && b <= VOCABULARY_BOUND_MAX);
    if (!whole || (cut as number[])[0] !== 1 || (cut as number[]).some((b, i, all) => i > 0 && b <= all[i - 1]!)) {
      errors.push(`${at}.visitBuckets: ${shown(cut)} is not a cut; the lower bounds of the visit buckets are 1..${VOCABULARY_BUCKETS_MAX} whole numbers strictly ascending from 1 (today's cut is [1, 2, 4]: buckets 1, 2-3 and 4+)`);
    }
  }
  if (raw.ladder !== undefined) {
    const ladder = raw.ladder;
    if (!isRecord(ladder) || !hasExactly(ladder, ['order', 'depth'])) errors.push(`${at}.ladder: { order, depth } and nothing else`);
    else {
      const order = ladder.order;
      if (!Array.isArray(order) || order.length !== LADDER_ORDER.length || !Array.from(order).every((k: unknown, i) => k === LADDER_ORDER[i])) {
        errors.push(`${at}.ladder.order: ${shown(order)} is not the ladder's order; the order is c, v, s, r, a (channel, visit bucket, stage, region, affinity), and only its depth is set here`);
      }
      const depth = ladder.depth;
      if (typeof depth !== 'number' || !Number.isSafeInteger(depth) || depth < 1 || depth > LADDER_ORDER.length) {
        errors.push(`${at}.ladder.depth: ${shown(depth)} is not a depth; the levels consulted below everyone are a whole number from 1 to ${LADDER_ORDER.length}`);
      }
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: structuredClone(raw) as unknown as ContextVocabulary };
}

function validateRetainedLearn(candidate: unknown, historical = true): ValidationResult<LearnConfig> {
  const errors: string[] = [];
  if (!isRecord(candidate)) return { ok: false, errors: ['learn: must be an object'] };
  if (candidate.version !== undefined && !isStr(candidate.version)) errors.push('version: string when present');
  const h = candidate.holdout;
  if (!isRecord(h)) return { ok: false, errors: [...errors, 'holdout: required object'] };
  if (!isNum(h.share) || h.share < 0 || h.share > 1) errors.push('holdout.share: number 0..1');
  if (h.salt !== undefined && typeof h.salt !== 'string') errors.push('holdout.salt: string when present');
  const arms = Array.isArray(h.arms) ? h.arms : null;
  if (!arms || !arms.every((a) => isStr(a) && ARMS.has(a))) errors.push('holdout.arms: array of default | no_learning');
  else if (new Set(arms).size !== arms.length) errors.push('holdout.arms: no duplicates');
  let regional: LearnConfig['regional'];
  if (candidate.regional !== undefined) {
    const g = candidate.regional;
    if (!isRecord(g)) errors.push('regional: object when present');
    else {
      if (typeof g.enabled !== 'boolean') errors.push('regional.enabled: boolean');
      if (!isNum(g.kBlend) || g.kBlend <= 0 || g.kBlend > 100) errors.push('regional.kBlend: number in (0, 100]');
      if (!isNum(g.minEvents) || !Number.isInteger(g.minEvents) || g.minEvents < 1) errors.push('regional.minEvents: positive integer');
      // Absent means every dimension the region carries, so a document without it reads exactly as before.
      const dimensions = g.dimensions === undefined ? undefined : regionalDimensionsOf(g.dimensions);
      if (dimensions === null) errors.push(`regional.dimensions: 1..${REGIONAL_DIMENSIONS_MAX} distinct registry dimension names when present`);
      if (typeof g.enabled === 'boolean' && isNum(g.kBlend) && isNum(g.minEvents)) regional = { enabled: g.enabled, kBlend: g.kBlend, minEvents: g.minEvents, ...(dimensions ? { dimensions } : {}) };
    }
  }
  // P07 (decision D1, freeze item 22): the context prior's own block, in the
  // regional block's grammar — `enabled`, its own K (`kBlend`), `minEvents` and
  // optional `dimensions`. Absent is off, so a document without it decides
  // exactly as before. A new write that gets it wrong is refused, naming the
  // member; a RETAINED document whose block the current contract refuses keeps
  // reading with the block dropped, never partially applied.
  let contextPrior: LearnConfig['contextPrior'];
  if (candidate.contextPrior !== undefined) {
    const g = candidate.contextPrior;
    const refused: string[] = [];
    if (!isRecord(g)) refused.push('contextPrior: object when present');
    else {
      if (typeof g.enabled !== 'boolean') refused.push('contextPrior.enabled: boolean');
      if (!isNum(g.kBlend) || g.kBlend <= 0 || g.kBlend > 100) refused.push('contextPrior.kBlend: number in (0, 100]');
      if (!isNum(g.minEvents) || !Number.isInteger(g.minEvents) || g.minEvents < 1) refused.push('contextPrior.minEvents: positive integer');
      const dimensions = g.dimensions === undefined ? undefined : regionalDimensionsOf(g.dimensions);
      if (dimensions === null) refused.push(`contextPrior.dimensions: 1..${REGIONAL_DIMENSIONS_MAX} distinct registry dimension names when present`);
      if (!refused.length) contextPrior = { enabled: g.enabled as boolean, kBlend: g.kBlend as number, minEvents: g.minEvents as number, ...(dimensions ? { dimensions } : {}) };
    }
    if (!historical) errors.push(...refused);
  }
  const REWARDS = new Set(['click', 'dwell', 'video_complete', 'wishlist', 'add_to_bag', 'purchase', 'custom']);
  let policy: LearnConfig['policy'];
  if (candidate.policy !== undefined) {
    const g = candidate.policy;
    if (!isRecord(g)) errors.push('policy: object when present');
    else {
      if (g.scope !== 'session' && g.scope !== 'visitor') errors.push('policy.scope: session | visitor');
      if (g.match !== 'direct' && g.match !== 'any') errors.push('policy.match: direct | any');
      if (g.credit !== 'last' && g.credit !== 'first') errors.push('policy.credit: last | first');
      const w: Record<string, number> = {};
      if (g.windowsMs !== undefined) {
        if (!isRecord(g.windowsMs)) errors.push('policy.windowsMs: object of reward → milliseconds');
        else for (const [k, v] of Object.entries(g.windowsMs)) { if (!REWARDS.has(k) || !isNum(v) || v <= 0) errors.push(`policy.windowsMs.${k}: known reward and positive milliseconds`); else w[k] = v; }
      }
      if (!errors.some((e) => e.startsWith('policy'))) policy = { scope: g.scope as 'session' | 'visitor', match: g.match as 'direct' | 'any', credit: g.credit as 'last' | 'first', windowsMs: w };
    }
  }
  let stats: LearnConfig['stats'];
  if (candidate.stats !== undefined) {
    const g = candidate.stats;
    if (!isRecord(g)) errors.push('stats: object when present');
    else {
      if (!isNum(g.n0) || g.n0 <= 0) errors.push('stats.n0: positive number');
      if (!isNum(g.tauLearnMs) || g.tauLearnMs <= 0) errors.push('stats.tauLearnMs: positive milliseconds');
      if (!isNum(g.liftMin) || !isNum(g.liftMax) || g.liftMin <= 0 || g.liftMax < 1 || g.liftMin > 1 || g.liftMin >= g.liftMax) errors.push('stats.liftMin/liftMax: 0 < liftMin ≤ 1 ≤ liftMax');
      if (!isNum(g.nMin) || !Number.isInteger(g.nMin) || g.nMin < 1) errors.push('stats.nMin: positive integer');
      if (!errors.some((e) => e.startsWith('stats'))) stats = { n0: g.n0 as number, tauLearnMs: g.tauLearnMs as number, liftMin: g.liftMin as number, liftMax: g.liftMax as number, nMin: g.nMin as number };
    }
  }
  let external: LearnConfig['external'];
  if (candidate.external !== undefined) {
    const g = candidate.external;
    // W34 E3 (F30, decision D1): the deployment's external-model policy
    // (`EXTERNAL_MODEL_POLICY`, src/learn/external.ts) enables no model — `off`
    // is its only state — so a NEW document naming one is refused, whatever the
    // kind. A document stored before this rule still reads (`validateStored`),
    // and its term is served withdrawn, never scored.
    if (!historical) errors.push('external: refused — the deployment\'s external-model policy (EXTERNAL_MODEL_POLICY) is off and enables no service, table or workers_ai model; remove `external`');
    else if (!isRecord(g) || !['service', 'table', 'workers_ai'].includes(String(g.kind)) || typeof g.ref !== 'string' || !g.ref.trim()) errors.push('external: kind service|table|workers_ai and a ref');
    else {
      const timeoutMs = g.timeoutMs === undefined ? 20 : g.timeoutMs;
      if (!isNum(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) errors.push('external.timeoutMs: 1..5000 milliseconds');
      if (g.fallback !== undefined && g.fallback !== 'omit') errors.push('external.fallback: omit');
      if (!errors.some((e) => e.startsWith('external'))) external = { kind: g.kind as 'service' | 'table' | 'workers_ai', ref: g.ref.trim(), timeoutMs: timeoutMs as number, fallback: 'omit' };
    }
  }
  // P36: the tenant's context vocabulary. A new document is refused whole on
  // any error, naming the member and the offending value; a RETAINED document
  // whose vocabulary the current contract refuses keeps reading with the member
  // dropped (today's six words, cut and ladder), never partially applied.
  let contextVocabulary: LearnConfig['contextVocabulary'];
  if (candidate.contextVocabulary !== undefined) {
    const checked = validateContextVocabulary(candidate.contextVocabulary);
    if (checked.ok) contextVocabulary = checked.value;
    else if (!historical) errors.push(...checked.errors);
  }
  // P11 (decision D1): the evidence floor per page type. A new document naming
  // anything but a page key and a whole number of 1 or more is refused, each
  // error naming `evidenceFloors.<page>`; a RETAINED document whose floors the
  // current contract refuses keeps reading with the member dropped, never
  // partially applied. Kept only where the document gives it, so a document
  // without floors reads back exactly as it was written.
  let evidenceFloors: LearnConfig['evidenceFloors'];
  if (candidate.evidenceFloors !== undefined) {
    const refused = evidenceFloorErrors(candidate.evidenceFloors);
    if (!refused.length) evidenceFloors = Object.fromEntries(Object.entries(candidate.evidenceFloors as Record<string, number>));
    else if (!historical) errors.push(...refused);
  }
  let slots: LearnConfig['slots'];
  if (candidate.slots !== undefined) {
    if (!isRecord(candidate.slots)) errors.push('slots: object of slot → dials');
    else {
      slots = {};
      for (const [slot, d] of Object.entries(candidate.slots)) {
        if (!SLUG.test(slot) || !isRecord(d)) { errors.push(`slots.${slot}: slug → object`); continue; }
        const dials: NonNullable<LearnConfig['slots']>[string] = {};
        if (d.measurementBasis !== undefined) {
          if (d.measurementBasis !== 'served-v1' && d.measurementBasis !== 'rendered-v1') errors.push(`slots.${slot}.measurementBasis: served-v1 | rendered-v1`);
          else dials.measurementBasis = d.measurementBasis;
        }
        if (d.gamma !== undefined) { if (!isNum(d.gamma) || d.gamma < 0 || d.gamma > 1) errors.push(`slots.${slot}.gamma: number 0..1`); else dials.gamma = d.gamma; }
        if (d.reward !== undefined) { if (!isStr(d.reward) || !REWARDS.has(d.reward)) errors.push(`slots.${slot}.reward: known reward`); else dials.reward = d.reward as NonNullable<typeof dials.reward>; }
        if (d.objective !== undefined) {
          if (!isStr(d.objective) || !['unit', 'revenue', 'margin'].includes(d.objective)) errors.push(`slots.${slot}.objective: unit | revenue | margin`);
          else if (d.objective !== 'unit' && !['purchase', 'add_to_bag'].includes((dials.reward ?? d.reward ?? 'click') as string)) errors.push(`slots.${slot}.objective: ${d.objective} needs a reward that carries a value (purchase or add_to_bag)`);
          else dials.objective = d.objective as 'unit' | 'revenue' | 'margin';
        }
        if (d.exploration !== undefined) {
          const e = d.exploration;
          // P05: the adjacent swap's share is named with the mode, so a share outside 0..1 is refused saying which dial it is.
          if (isRecord(e) && e.mode === 'adjacent-swap' && (!isNum(e.share) || e.share < 0 || e.share > 1)) errors.push(`slots.${slot}.exploration: the adjacent-swap mode's share is the fraction of the slot's decisions that swap one adjacent pair, a number from 0 to 1; got ${shown(e.share)}`);
          else if (!isRecord(e) || typeof e.mode !== 'string' || !['rotation', 'thompson', 'epsilon', 'off', 'adjacent-swap'].includes(e.mode) || !isNum(e.share) || e.share < 0 || e.share > 1 || !isNum(e.floor) || !Number.isInteger(e.floor) || e.floor < 0) errors.push(`slots.${slot}.exploration: mode ${historical ? 'rotation|thompson|epsilon|off|adjacent-swap' : 'rotation|epsilon|off|adjacent-swap'}, share 0..1, floor integer ≥ 0`);
          else if (e.mode === 'thompson' && !historical) errors.push(`slots.${slot}.exploration: Thompson is unsupported; choose off, rotation or epsilon`);
          else dials.exploration = { mode: e.mode as 'rotation' | 'thompson' | 'epsilon' | 'off' | 'adjacent-swap', share: e.share, floor: e.floor };
        }
        // P05 (decision D2): the position-normalisation switch, kept exactly as
        // authored; off when absent. Whether the slot is a page's declared layout
        // slot is the cross-document rule `learnPositionLayoutErrors` states.
        if (d.positionNormalization !== undefined) {
          if (typeof d.positionNormalization === 'boolean') dials.positionNormalization = d.positionNormalization;
          else if (!historical) errors.push(`slots.${slot}.positionNormalization: true or false (absent means off)`);
        }
        // P33 (decision D1, freeze item 11): the slot's own attribution policy,
        // kept exactly as authored; `module-tied` is the only one, and absent
        // the brand-wide policy credits the slot as before. A RETAINED document
        // naming another keeps reading with the member dropped, so its slot is
        // credited exactly as it was.
        if (d.attribution !== undefined) {
          if (d.attribution === 'module-tied') dials.attribution = 'module-tied';
          else if (!historical) errors.push(`slots.${slot}.attribution: module-tied is the only attribution policy a slot may carry of its own (absent: the brand-wide policy credits the slot); got ${shown(d.attribution)}`);
        }
        // P16 (decision D1, freeze items 14 and 43): the slot's conversion
        // table into its own currency, kept exactly as authored; absent, the
        // slot's reward and objective credit it as before. A RETAINED document
        // whose table the current contract refuses keeps reading with the
        // member dropped, so its slot is credited exactly as it was.
        if (d.conversions !== undefined) {
          const refused = conversionTableErrors(d.conversions, slot);
          if (!refused.length) dials.conversions = Object.fromEntries(Object.entries(d.conversions as Record<string, number>)) as NonNullable<typeof dials.conversions>;
          else if (!historical) errors.push(...refused);
        }
        if (d.autonomy !== undefined) {
          const a = d.autonomy;
          const okMode = isRecord(a) && ['configured', 'assisted', 'autonomous'].includes(String(a.mode));
          const okNums = isRecord(a) && isNum(a.step) && a.step > 0 && a.step <= 1 && isNum(a.min) && isNum(a.max) && a.min >= 0 && a.max <= 1 && a.min < a.max && isNum(a.minN) && Number.isInteger(a.minN) && a.minN >= 1;
          const okPinned = isRecord(a) && Array.isArray(a.pinned) && a.pinned.every(isStr);
          if (!okMode || !okNums || !okPinned) errors.push(`slots.${slot}.autonomy: mode configured|assisted|autonomous, step (0,1], 0 ≤ min < max ≤ 1, pinned string[], minN ≥ 1`);
          else dials.autonomy = { mode: a.mode as 'configured' | 'assisted' | 'autonomous', step: a.step as number, min: a.min as number, max: a.max as number, pinned: [...(a.pinned as string[])], minN: a.minN as number };
        }
        if (d.external !== undefined) {
          const x = d.external;
          if (!isRecord(x) || !isNum(x.weight) || x.weight < 0 || x.weight > 1) errors.push(`slots.${slot}.external.weight: number 0..1`);
          else dials.external = { weight: x.weight };
        }
        if (d.items !== undefined) {
          if (!isRecord(d.items)) errors.push(`slots.${slot}.items: object of item → control`);
          else {
            dials.items = {};
            for (const [item, ctl] of Object.entries(d.items)) {
              if (!isRecord(ctl) || (ctl.mode !== 'reject' && ctl.mode !== 'freeze') || (ctl.mode === 'freeze' && (!isNum(ctl.lift) || ctl.lift <= 0))) { errors.push(`slots.${slot}.items.${item}: mode reject, or freeze with a positive lift`); continue; }
              dials.items[item] = ctl.mode === 'freeze' ? { mode: 'freeze', lift: ctl.lift as number } : { mode: 'reject' };
            }
          }
        }
        // P28 (decision D1): the layout blend's opt-in, kept exactly as authored.
        // Whether the slot is a page's declared layout slot is a cross-document
        // rule, made where both documents are at hand (`learnBlendLayoutErrors`,
        // applied by src/routes/content.ts). A RETAINED document whose blend the
        // current contract refuses keeps reading with the blend dropped, never
        // partially applied, so its slot decides exactly as it did before.
        if (d.blend !== undefined) {
          const refused = blendDialErrors(d.blend);
          if (!refused.length) dials.blend = { ...(isRecord(d.blend) && d.blend.p !== undefined ? { p: d.blend.p as number } : {}),
            // P06 (decision D2): the shadow order's p, kept exactly as authored; absent reads as 0.1.
            ...(isRecord(d.blend) && d.blend.shadowP !== undefined ? { shadowP: d.blend.shadowP as number } : {}) };
          else if (!historical) for (const error of refused) errors.push(`slots.${slot}.blend${error}`);
        }
        slots[slot] = dials;
      }
    }
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      ...(isStr(candidate.version) ? { version: candidate.version } : {}),
      holdout: { share: h.share as number, salt: (h.salt as string | undefined) ?? '', arms: [...(arms as LearnConfig['holdout']['arms'])] },
      ...(regional ? { regional } : {}),
      ...(contextPrior ? { contextPrior } : {}),
      ...(policy ? { policy } : {}),
      ...(stats ? { stats } : {}),
      ...(external ? { external } : {}),
      ...(slots ? { slots } : {}),
      ...(contextVocabulary ? { contextVocabulary } : {}),
      ...(evidenceFloors ? { evidenceFloors } : {}),
    },
  };
}

/**
 * P16 (decision D1, freeze items 14 and 43): the refusals of a slot's
 * conversion table: an object naming at least one reward of the list, each
 * valued by a finite number above zero, what one success of it is worth in the
 * slot's own currency. Each error names `conversions` (`slots.<slot>.conversions`
 * or `slots.<slot>.conversions.<reward>`) and the offending value.
 */
function conversionTableErrors(candidate: unknown, slot: string): string[] {
  const at = `slots.${slot}.conversions`;
  if (!isRecord(candidate)) return [`${at}: ${shown(candidate)} is not a conversion table; an object of reward (${REWARD_TYPES.join(' | ')}) → a finite number above zero, what one success of it is worth in the slot's currency`];
  const entries = Object.entries(candidate);
  if (!entries.length) return [`${at}: an empty table values no reward, so the slot would learn nothing; name at least one reward with its value in the slot's currency, or leave conversions out to credit the slot's own reward as before`];
  const errors: string[] = [];
  for (const [reward, value] of entries) {
    if (!isRewardType(reward)) errors.push(`${at}: ${shown(reward)} is not a reward; a conversion table names rewards of the list (${REWARD_TYPES.join(' | ')})`);
    else if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) errors.push(`${at}.${reward}: ${shown(value)} is not a conversion value; a finite number above zero, what one ${reward} success is worth in the slot's currency`);
  }
  return errors;
}

/**
 * P41 (R-P78, decision D1): the advisory a learn publication carries when a
 * slot's conversion table does not name the slot's own reward. The table is
 * published exactly as P16 accepts it (any table of rewards to values above
 * zero) and nothing it does changes; the operator is told that every module on
 * that slot which declares no success event now earns nothing, because its
 * record names the slot's reward with `value: null` (decide.ts successEventOf).
 * The envelope is the common core of the catalogue's and the slots document's
 * advisory channels (catalogDiagnostics.ts, slotDiagnostics.ts), keys sorted
 * (R-P3), with the same 50-warning sample and omitted count.
 */
export interface LearnConversionDiagnostics {
  advisory: true;
  omittedWarningCount: number;
  schema: 'learn-conversion-diagnostics/v1';
  status: 'available';
  warningCount: number;
  warnings: LearnConversionWarning[];
}
export interface LearnConversionWarning {
  code: 'conversions_omit_slot_reward';
  consequence: 'undeclared_pieces_earn_nothing';
  reward: RewardType;
  slot: string;
}
const LEARN_CONVERSION_WARNING_SAMPLE = 50;

/**
 * P41: one warning per slot of the learn document whose `conversions` table
 * does not value the slot's own reward (its `reward` dial, `click` when the
 * dial is absent, `custom` included: the table must name `custom` itself), in
 * slot-name order, the order the store keeps a published document's slots in
 * (publication.ts canonical), so the validate door lists them exactly as the
 * PUT of the same document will; null when no slot warns, so a document without a
 * table, or whose every table names its slot's reward, is answered exactly as
 * before. A pure function of the document alone: it reads neither the slots
 * document nor anything stored, so a table on a slot no page carries is told
 * like any other (it starts to omit the moment a page carries the slot, by a
 * slots publication that never re-reads this document). Callers give it the
 * success answer of `PUT /content/learn` and `POST /content/learn/validate`
 * only; no read of the document carries it.
 */
export function learnConversionDiagnostics(learn: Pick<LearnConfig, 'slots'> | null | undefined): LearnConversionDiagnostics | null {
  const slots = learn && isRecord(learn.slots) ? learn.slots : null;
  if (!slots) return null;
  const warnings: LearnConversionWarning[] = [];
  let warningCount = 0;
  for (const slot of Object.keys(slots).sort()) {
    const dials = slots[slot];
    if (!dials || typeof dials !== 'object') continue;
    const conversions: unknown = dials.conversions;
    if (!isRecord(conversions)) continue;
    const reward: RewardType = dials.reward ?? 'click';
    // The value an undeclared module's record would carry (successEventOf): a finite number above zero, else null.
    const value = Object.hasOwn(conversions, reward) ? conversions[reward] : undefined;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) continue;
    warningCount++;
    if (warnings.length < LEARN_CONVERSION_WARNING_SAMPLE) warnings.push({ code: 'conversions_omit_slot_reward', consequence: 'undeclared_pieces_earn_nothing', reward, slot });
  }
  return warningCount ? { advisory: true, omittedWarningCount: warningCount - warnings.length, schema: 'learn-conversion-diagnostics/v1', status: 'available', warningCount, warnings } : null;
}

/**
 * P11 (decision D1): the refusals of a learn document's `evidenceFloors`: an
 * object of page key (a page name of the slots document) → floor, each floor a
 * whole number of 1 or more. Each error names `evidenceFloors` or
 * `evidenceFloors.<page>` and the offending value.
 */
function evidenceFloorErrors(candidate: unknown): string[] {
  if (!isRecord(candidate)) return [`evidenceFloors: ${shown(candidate)} is not a set of evidence floors; an object of page key → floor, each floor a whole number of 1 or more`];
  const errors: string[] = [];
  for (const [page, floor] of Object.entries(candidate)) {
    if (!SLUG.test(page)) errors.push(`evidenceFloors: the page name ${shown(page)} is not a page key; a page name of the slots document is a slug`);
    else if (typeof floor !== 'number' || !Number.isSafeInteger(floor) || floor < 1) errors.push(`evidenceFloors.${page}: ${shown(floor)} is not an evidence floor; a page's floor is a whole number of 1 or more, the exposures an estimate needs before it is applied as measured`);
  }
  return errors;
}

/** Five percent, one default arm, salted by the brand at decision time; the regional prior on, gated at 30 events. */
export const DEFAULT_LEARN: LearnConfig = {
  version: 'learn-default',
  holdout: { share: 0.05, salt: '', arms: ['default'] },
  regional: { enabled: true, kBlend: 1, minEvents: 30 },
  // Doc 22 §4.2's proposed default policy and §5.1's constants. Every slot runs at γ = 0 (shadow)
  // on the click reward until a person raises the dial or names another reward.
  policy: { scope: 'session', match: 'direct', credit: 'last', windowsMs: { click: 1_800_000, dwell: 1_800_000, video_complete: 1_800_000, wishlist: 21_600_000, add_to_bag: 21_600_000, purchase: 604_800_000, custom: 1_800_000 } },
  stats: { n0: 30, tauLearnMs: 1_814_400_000, liftMin: 0.5, liftMax: 2, nMin: 30 },
  slots: {},
};

export const LEARN_KIND: DocumentKind<LearnConfig> = {
  name: 'learn',
  publication: 'r2',
  validate: validateLearnConfig,
  validateStored: validateRetainedLearn,
  stamp: (v, r) => ({ ...v, version: stampLabel(v.version, 'learn', r) }),
  versionOf: (v) => v.version ?? '',
};

// ── P38: the published vocabulary (the `vocabulary` kind and its approval) ───
//
// A tenant publishes its attribute vocabulary as a document of its own kind,
// versioned like every content document. A stored revision governs nothing: it
// takes effect only when the tenant's operator approves it (decision D1), and
// the approval is a member of its own (`vocabulary-approval`) carrying the
// approved revision's number and document, so a later revision blocks nothing
// and the ingest hosts read one member and never an older revision body. While
// an approval is in effect, an attribute the vocabulary lists is GOVERNED: a
// value on it is stored, and builds interest, only as one of the attribute's
// ids, mapped through the one mapping table (an id maps to itself, a synonym to
// its value's id; decision D2). A tenant with no approval in effect is governed
// by nothing here.

/** An id: lower-case letters and digits, words joined by single underscores, at most 64 characters. */
const VALUE_ID = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
const VALUE_ID_WORDS = 'lower-case letters and digits, words joined by single underscores, at most 64 characters, so none of the tag separators : ; |';
export const isVocabularyId = (v: unknown): v is string => typeof v === 'string' && v.length <= 64 && VALUE_ID.test(v);
const ATTRIBUTES_MAX = 64, ATTRIBUTE_VALUES_MAX = 1000, VALUE_SYNONYMS_MAX = 50, VALUE_NAME_MAX = 256, SYNONYM_MAX = 64, ATTRIBUTE_KEY_MAX = 64, VERSION_MAX = 256;
/**
 * The ruled schema's two named attributes (the investigation §3.4 registry
 * draft): every `productType` value names exactly one parent, and where the
 * document lists `category` that parent is one of its ids.
 */
const PRODUCT_TYPE = 'productType', PARENT_ATTRIBUTE = 'category';
const DOCUMENT_MEMBERS = ['version', 'attributes'], VALUE_MEMBERS = ['id', 'name', 'synonyms', 'parent'];
const RESERVED_ATTRIBUTE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
// eslint-disable-next-line no-control-regex -- A key or a word with a control character could never be matched or shown.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
/** An attribute key is the registry dimension and catalogue tag key it governs: 1..64 characters, trimmed, none of the tag separators. */
const attributeKeyOf = (key: string): boolean => key.length >= 1 && key.length <= ATTRIBUTE_KEY_MAX && key.trim() === key
  && !/[:;|]/.test(key) && !CONTROL.test(key) && !RESERVED_ATTRIBUTE_KEYS.has(key);
/** A synonym is a word a source system sends: 1..64 characters (an event value is cut at 64), trimmed, no control character. */
const synonymOf = (word: unknown): word is string => typeof word === 'string' && word.length >= 1 && word.length <= SYNONYM_MAX
  && word.trim() === word && !CONTROL.test(word);

/**
 * P38 (VA1): the vocabulary document, refused whole on any error, each error
 * naming the attribute, the value and the offending id or word: an id outside
 * the grammar, a duplicate id, a `productType` value naming no parent or more
 * than one, and a synonym that maps to two values (a synonym of two values, or
 * a synonym that is another value's id). The value is kept exactly as authored:
 * the display names keep the tenant's wording, nothing is trimmed or stamped.
 */
export function validateVocabulary(candidate: unknown): ValidationResult<VocabularyDocument> {
  if (!isRecord(candidate)) return { ok: false, errors: ['vocabulary: must be an object { version?, attributes }'] };
  const errors: string[] = [];
  for (const key of Object.keys(candidate)) if (!DOCUMENT_MEMBERS.includes(key)) errors.push(`${shown(key)}: not a member of the vocabulary document (version, attributes)`);
  if (candidate.version !== undefined && (!isStr(candidate.version) || candidate.version.length > VERSION_MAX)) errors.push(`version: a string of 1..${VERSION_MAX} characters when present`);
  if (!isRecord(candidate.attributes)) return { ok: false, errors: [...errors, 'attributes: required object of attribute key → { values }'] };
  const entries = Object.entries(candidate.attributes);
  if (entries.length < 1 || entries.length > ATTRIBUTES_MAX) errors.push(`attributes: 1..${ATTRIBUTES_MAX} attributes`);
  // The category ids a product type's parent is read against, when the document lists the category attribute.
  const category = candidate.attributes[PARENT_ATTRIBUTE];
  const categoryIds = Object.hasOwn(candidate.attributes, PARENT_ATTRIBUTE) && isRecord(category) && Array.isArray(category.values)
    ? new Set((category.values as unknown[]).map(v => (isRecord(v) && isVocabularyId(v.id) ? v.id : null)).filter((id): id is string => id !== null)) : null;
  const kept: Array<[string, VocabularyAttribute]> = [];
  for (const [key, raw] of entries) {
    if (!attributeKeyOf(key)) { errors.push(`attributes[${shown(key)}]: an attribute key is the registry dimension it governs: 1..${ATTRIBUTE_KEY_MAX} characters, trimmed, none of : ; | and no control character`); continue; }
    const at = `attributes.${key}`;
    if (!isRecord(raw)) { errors.push(`${at}: an object { values }`); continue; }
    for (const member of Object.keys(raw)) if (member !== 'values') errors.push(`${at}.${member}: not a member of an attribute (values)`);
    if (!Array.isArray(raw.values) || raw.values.length < 1 || raw.values.length > ATTRIBUTE_VALUES_MAX) {
      errors.push(`${at}.values: a list of 1..${ATTRIBUTE_VALUES_MAX} values { id, name, synonyms?, parent? }`); continue;
    }
    const ids = new Map<string, number>(), values: VocabularyValue[] = [];
    const list = raw.values as unknown[];
    list.forEach((v, i) => {
      const here = `${at}.values[${i}]`;
      if (!isRecord(v)) { errors.push(`${here}: an object { id, name, synonyms?, parent? }`); return; }
      for (const member of Object.keys(v)) if (!VALUE_MEMBERS.includes(member)) errors.push(`${here}.${member}: not a member of a vocabulary value (id, name, synonyms, parent)`);
      const id = v.id, label = shown(id);
      if (!isVocabularyId(id)) errors.push(`${here}.id: ${label} is not an id: ${VALUE_ID_WORDS}`);
      else if (ids.has(id)) errors.push(`${here}.id: ${label} is a duplicate id of ${at} (values[${ids.get(id)}] has it)`);
      else ids.set(id, i);
      if (typeof v.name !== 'string' || v.name.trim() === '' || v.name.length > VALUE_NAME_MAX) errors.push(`${here}.name: the display name of ${label}, 1..${VALUE_NAME_MAX} characters`);
      if (v.synonyms !== undefined) {
        if (!Array.isArray(v.synonyms) || v.synonyms.length > VALUE_SYNONYMS_MAX) errors.push(`${here}.synonyms: a list of at most ${VALUE_SYNONYMS_MAX} words for ${label}`);
        else (v.synonyms as unknown[]).forEach((word, j) => {
          if (!synonymOf(word)) errors.push(`${here}.synonyms[${j}]: ${shown(word)} for ${label} is not a word: 1..${SYNONYM_MAX} characters, no leading or trailing space, no control character`);
        });
      }
      if (key === PRODUCT_TYPE && v.parent === undefined) errors.push(`${here}.parent: ${label} names no parent; every ${PRODUCT_TYPE} value names exactly one parent ${PARENT_ATTRIBUTE}, an id`);
      else if (Array.isArray(v.parent)) errors.push(`${here}.parent: ${label} names ${v.parent.length === 0 ? 'no parent' : v.parent.length === 1 ? 'its parent as a list' : `${v.parent.length} parents (${shown((v.parent as unknown[]).join(', '))})`}; a value names exactly one parent, an id`);
      else if (v.parent !== undefined && !isVocabularyId(v.parent)) errors.push(`${here}.parent: ${shown(v.parent)}, the parent of ${label}, is not an id: ${VALUE_ID_WORDS}`);
      else if (v.parent !== undefined && key === PRODUCT_TYPE && categoryIds && !categoryIds.has(v.parent)) {
        errors.push(`${here}.parent: ${label} names the parent ${shown(v.parent)}, which ${PARENT_ATTRIBUTE} does not list`);
      }
      if (isVocabularyId(id)) values.push({ id, name: v.name as string, ...(v.synonyms !== undefined ? { synonyms: [...(v.synonyms as string[])] } : {}),
        ...(v.parent !== undefined ? { parent: v.parent as string } : {}) });
    });
    // One mapping table: a word maps to one value. A synonym of two values, or a
    // synonym that is another value's id, would map one word to two values.
    const owners = new Map<string, string>();
    for (const v of list) {
      if (!isRecord(v) || !isVocabularyId(v.id) || !Array.isArray(v.synonyms)) continue;
      const own = v.id;
      for (const word of v.synonyms as unknown[]) {
        if (!synonymOf(word) || word === own) continue;
        if (ids.has(word)) errors.push(`${at}: the synonym ${shown(word)} of ${shown(own)} maps to two values (${own} and the value whose id it is)`);
        else if (owners.has(word) && owners.get(word) !== own) errors.push(`${at}: the synonym ${shown(word)} maps to two values (${owners.get(word)} and ${own})`);
        else owners.set(word, own);
      }
    }
    kept.push([key, { values }]);
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { ...(candidate.version !== undefined ? { version: candidate.version as string } : {}), attributes: Object.fromEntries(kept) } };
}

export const VOCABULARY_KIND: DocumentKind<VocabularyDocument> = {
  name: 'vocabulary',
  publication: 'r2',
  validate: validateVocabulary,
  // No stamp: a revision is stored and answered exactly as the tenant authored it.
  versionOf: (v) => v.version ?? '',
};

/** P38 (decision D1): the approval in effect — the approved revision and its document, nothing else. */
export function validateVocabularyApproval(candidate: unknown): ValidationResult<VocabularyApproval> {
  if (!isRecord(candidate) || Object.keys(candidate).some(key => key !== 'revision' && key !== 'document')) return { ok: false, errors: ['approval: an object { revision, document }'] };
  const errors: string[] = [];
  if (typeof candidate.revision !== 'number' || !Number.isSafeInteger(candidate.revision) || candidate.revision < 1) errors.push('approval.revision: the approved vocabulary revision, a whole number of 1 or more');
  const document = validateVocabulary(candidate.document);
  if (!document.ok) errors.push(...document.errors.map(error => `approval.document: ${error}`));
  return errors.length || !document.ok ? { ok: false, errors } : { ok: true, value: { revision: candidate.revision as number, document: document.value } };
}

export const VOCABULARY_APPROVAL_KIND: DocumentKind<VocabularyApproval> = {
  name: 'vocabulary-approval',
  publication: 'r2',
  validate: validateVocabularyApproval,
  versionOf: (v) => `vocabulary revision ${v.revision}`,
};

/** One governed attribute: its ids, and the mapping table (an id to itself, a synonym to its value's id). */
export interface AttributeTable { ids: ReadonlySet<string>; words: ReadonlyMap<string, string> }
/** P38: the vocabulary in effect, compiled once per approval: the approved revision and every governed attribute's table. */
export interface VocabularyTable { revision: number; attributes: ReadonlyMap<string, AttributeTable> }

/** The mapping table of an approval. Ids are entered first, so no synonym can ever stand for another value's id. */
export function vocabularyTableOf(approval: VocabularyApproval): VocabularyTable {
  const attributes = new Map<string, AttributeTable>();
  for (const [key, attribute] of Object.entries(approval.document.attributes)) {
    const ids = new Set<string>(), words = new Map<string, string>();
    for (const value of attribute.values) { ids.add(value.id); words.set(value.id, value.id); }
    for (const value of attribute.values) for (const word of value.synonyms ?? []) if (!words.has(word)) words.set(word, value.id);
    attributes.set(key, { ids, words });
  }
  return { revision: approval.revision, attributes };
}

/** The ids a refusal offers, bounded. */
const idsOffered = (table: AttributeTable): string => {
  const ids = [...table.ids];
  return `${ids.slice(0, 8).join(' | ')}${ids.length > 8 ? ` | … (${ids.length} ids)` : ''}`;
};

/**
 * P38 (VA2): a catalogue publication under the vocabulary in effect. Every
 * value of a governed tag is mapped through the table and stored as its id
 * (each id once, in the order first named); a value that maps to nothing refuses
 * the whole publication, each error naming the piece's id, the field
 * `tags.<attribute>` and the value. An ungoverned tag, and anything that is not
 * a piece's list of strings, is left exactly as it came for the catalogue
 * validator to decide. Pure; the caller holds the table the publication's own
 * base set carries.
 */
export function governedCatalogue(candidate: unknown, table: VocabularyTable): ValidationResult<unknown> {
  if (!isRecord(candidate) || !Array.isArray(candidate.pieces)) return { ok: true, value: candidate };
  const errors: string[] = [];
  const pieces = (candidate.pieces as unknown[]).map((piece, i) => {
    if (!isRecord(piece) || !isRecord(piece.tags)) return piece;
    let mapped = false;
    // Rebuilt from entries, so an authored key is never read as anything but a key.
    const tags = Object.fromEntries(Object.entries(piece.tags).map(([dim, values]) => {
      const attribute = table.attributes.get(dim);
      if (!attribute || !Array.isArray(values) || !values.every(isStr)) return [dim, values];
      const ids: string[] = [];
      for (const value of values as string[]) {
        const id = attribute.words.get(value);
        if (id === undefined) errors.push(`pieces[${i}] ${isStr(piece.id) ? shown(piece.id) : '(no id)'} tags.${dim}: ${shown(value)} is outside the vocabulary in effect (revision ${table.revision}); name one of its ids (${idsOffered(attribute)}) or a synonym it lists`);
        else if (!ids.includes(id)) ids.push(id);
      }
      mapped = true;
      return [dim, ids];
    }));
    return mapped ? { ...piece, tags } : piece;
  });
  return errors.length ? { ok: false, errors } : { ok: true, value: { ...candidate, pieces } };
}
