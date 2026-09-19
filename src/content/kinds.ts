// src/content/kinds.ts
// Three document kinds for the versioned store (src/config/versionedStore.ts):
// no second versioning system. Each validator returns EVERY error;
// slots/learn retain compiled fallbacks. Content has an explicit conditional R2
// authority: missing initialization or corrupt publication fails closed.

import type { DocumentKind, ValidationResult } from '@/config/versionedStore';
import { ENTRY_TERM_LIMIT, entryChannelOf, entryNetworkOf } from '@/services/visit';
import type { ContentCatalog, ContentPiece, DiversityRule, FatigueRule, FreshnessRule, LearnConfig, SeedRule, SlotCatalog, SlotStrategy, StageRule, StageWord } from './types';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
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
 */
export const PIECE_FIELDS: ReadonlySet<string> = new Set(['id', 'customerContentId', 'type', 'title', 'subtitle', 'excerpt', 'runtime',
  'tags', 'slotTypes', 'lifecycle', 'window', 'art', 'renderUrl', 'merchandising', 'journeyStageFit', 'freshnessDate',
  'featuredProductIds', 'inStock']);

/**
 * Every key `contentCatalog` below reads on the catalogue DOCUMENT itself: its
 * `pieces` and its optional authored `version` label. The same rule as
 * `PIECE_FIELDS`, one level up — a key beside these reaches no stored document,
 * so a write answer names it rather than dropping it without a word (F27 §5.4).
 * How a request CARRIES its catalogue (a body's `document`, a feed export's
 * records key) is the envelope, not a field of the catalogue, and is listed by
 * the path that reads it, never here.
 */
export const CATALOG_DOCUMENT_FIELDS: ReadonlySet<string> = new Set(['pieces', 'version']);

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

function validatePiece(p: unknown, i: number, seen: Set<string>, errors: string[], stored: boolean): ContentPiece | null {
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
  if (p.inStock !== undefined && typeof p.inStock !== 'boolean') errors.push(`${at}.inStock: boolean when present`);
  if (!isStr(id) || !isStr(cid) || !isStr(type) || !isStr(title) || !slotTypes) return null;
  return {
    id, customerContentId: cid, type, title, tags, slotTypes,
    ...(merchandising && Object.keys(merchandising).length ? { merchandising } : {}),
    ...(journeyStageFit ? { journeyStageFit } : {}),
    ...(isStr(p.freshnessDate) ? { freshnessDate: p.freshnessDate } : {}),
    ...(featuredProductIds && featuredProductIds.length ? { featuredProductIds } : {}),
    ...(typeof p.inStock === 'boolean' ? { inStock: p.inStock } : {}),
    lifecycle: { status: status as ContentPiece['lifecycle']['status'] },
    ...(isStr(p.subtitle) ? { subtitle: p.subtitle } : {}),
    ...(p.art === undefined ? {} : { art: p.art as string | null }),
    ...(isStr(p.runtime) ? { runtime: p.runtime } : {}),
    ...(isStr(p.renderUrl) ? { renderUrl: p.renderUrl } : {}),
    ...(isStr(p.excerpt) ? { excerpt: p.excerpt } : {}),
    ...(window && (window.from || window.to) ? { window } : {}),
  };
}

export function validateContentCatalog(candidate: unknown): ValidationResult<ContentCatalog> {
  return contentCatalog(candidate, false);
}
function validateStoredContentCatalog(candidate: unknown): ValidationResult<ContentCatalog> {
  return contentCatalog(candidate, true);
}
function contentCatalog(candidate: unknown, stored: boolean): ValidationResult<ContentCatalog> {
  const errors: string[] = [];
  if (!isRecord(candidate)) return { ok: false, errors: ['catalog: must be an object'] };
  if (candidate.version !== undefined && !isStr(candidate.version)) errors.push('version: string when present');
  if (!Array.isArray(candidate.pieces)) return { ok: false, errors: [...errors, 'pieces: required array'] };
  const seen = new Set<string>();
  const pieces: ContentPiece[] = [];
  candidate.pieces.forEach((p, i) => { const v = validatePiece(p, i, seen, errors, stored); if (v) pieces.push(v); });
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { ...(isStr(candidate.version) ? { version: candidate.version } : {}), pieces } };
}

export const EMPTY_CATALOG: ContentCatalog = { version: 'content-empty', pieces: [] };

export const CONTENT_KIND: DocumentKind<ContentCatalog> = {
  name: 'content',
  publication: 'r2',
  validate: validateContentCatalog,
  validateStored: validateStoredContentCatalog,
  stamp: (v, r) => ({ ...v, version: stampLabel(v.version, 'content', r) }),
  versionOf: (v) => v.version ?? '',
};

// ── slots ───────────────────────────────────────────────────────────────────

/** W16 C3: the three arrival signals a seed rule may read. */
const SEED_SIGNALS = new Set(['entry_channel', 'campaign_term', 'referrer_network']);
/** Bounded like every other authored list in this document. */
const SEED_RULES_MAX = 100, SEED_TAGS_MAX = 50;

/**
 * W16 C3 / R30: one slot's contextual seed rule set, against the dimensions that
 * slot actually weights. Errors are returned as suffixes of the slot's own
 * address, so a refusal names the rule that caused it.
 *
 * The same function validates a published candidate and a RETAINED document at
 * decision time: a rule set the current contract refuses is ignored whole rather
 * than partially applied, because half a rule set is a ranking nobody authored.
 */
export function validateSeedRules(candidate: unknown, weights: Readonly<Record<string, number>>): ValidationResult<SeedRule[]> {
  if (!Array.isArray(candidate)) return { ok: false, errors: [': must be an array of seed rules'] };
  const errors: string[] = [];
  if (candidate.length > SEED_RULES_MAX) errors.push(`: at most ${SEED_RULES_MAX} rules`);
  const rules: SeedRule[] = [];
  candidate.forEach((raw, index) => {
    const at = `[${index}]`;
    if (!isRecord(raw)) { errors.push(`${at}: must be an object`); return; }
    const before = errors.length;
    const signal = raw.signal, value = raw.value, weight = raw.weight;
    if (!isStr(signal) || !SEED_SIGNALS.has(signal)) errors.push(`${at}.signal: entry_channel | campaign_term | referrer_network`);
    if (!isStr(value) || value.length > ENTRY_TERM_LIMIT) errors.push(`${at}.value: required string of 1..${ENTRY_TERM_LIMIT} characters`);
    // A signal value outside its own vocabulary names a context that cannot
    // occur, so it could only ever be dead configuration or a typo for a live one.
    else if (signal === 'entry_channel' && entryChannelOf(value) !== value) errors.push(`${at}.value: entry_channel names one of the six channel words, exactly`);
    else if (signal === 'referrer_network' && entryNetworkOf(value) !== value) errors.push(`${at}.value: referrer_network names a known network's registrable domain, exactly`);
    if (!isNum(weight) || weight < 0 || weight > 1) errors.push(`${at}.weight: number 0..1`);
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
    if (errors.length === before) rules.push({ signal: signal as SeedRule['signal'], value: value as string, tags, weight: weight as number });
  });
  return errors.length ? { ok: false, errors } : { ok: true, value: rules };
}

function validateSlot(s: unknown, page: string, i: number, seen: Set<string>, errors: string[], governance: 0 | 1 | 2 | 3): SlotStrategy | null {
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
  if (governance === 3 && Object.hasOwn(s, 'pinnedPieceIds')) {
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
    const checked = validateSeedRules(s.seeds, weights);
    if (!checked.ok) for (const error of checked.errors) errors.push(`${at}.seeds${error}`);
    else seeds = checked.value;
  }
  if (!isStr(slot) || !isNum(take) || !isRecord(s.weights)) return null;
  return {
    slot, take, weights, ...(isStr(s.pinnedPieceId) ? { pinnedPieceId: s.pinnedPieceId } : {}), ...(merchandising && Object.keys(merchandising).length ? { merchandising } : {}),
    ...(governance && typeof s.offLimits === 'boolean' ? { offLimits: s.offLimits } : {}), ...(excludedPieceIds ? { excludedPieceIds } : {}),
    ...(allowedTypes ? { allowedTypes } : {}), ...(excludedTags ? { excludedTags } : {}), ...(pinnedPieceIds ? { pinnedPieceIds } : {}),
    ...(stage && Object.keys(stage).length ? { stage } : {}), ...(freshness ? { freshness } : {}), ...(fatigue ? { fatigue } : {}), ...(diversity ? { diversity } : {}),
    ...(seeds ? { seeds } : {}),
  };
}

function parseSlotCatalog(candidate: unknown, current = false): ValidationResult<SlotCatalog> {
  const errors: string[] = [];
  if (!isRecord(candidate)) return { ok: false, errors: ['slots: must be an object'] };
  const marked = Object.hasOwn(candidate, 'governanceVersion');
  if (marked && candidate.governanceVersion !== 1 && candidate.governanceVersion !== 2 && candidate.governanceVersion !== 3) errors.push('governanceVersion: only versions 1, 2 and 3 are supported');
  const governance = current || candidate.governanceVersion === 3 ? 3 : candidate.governanceVersion === 2 ? 2 : marked ? 1 : 0;
  if (candidate.version !== undefined && !isStr(candidate.version)) errors.push('version: string when present');
  if (!isRecord(candidate.pages)) return { ok: false, errors: [...errors, 'pages: required object of page → slot[]'] };
  const pages: Record<string, SlotStrategy[]> = {};
  for (const [page, list] of Object.entries(candidate.pages)) {
    if (!SLUG.test(page)) { errors.push(`pages.${page}: page name must be a slug`); continue; }
    if (!Array.isArray(list)) { errors.push(`pages.${page}: must be an array`); continue; }
    const seen = new Set<string>();
    const slots: SlotStrategy[] = [];
    list.forEach((s, i) => { const v = validateSlot(s, page, i, seen, errors, governance); if (v) slots.push(v); });
    pages[page] = slots;
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { ...(isStr(candidate.version) ? { version: candidate.version } : {}), ...(governance ? { governanceVersion: governance } : {}), pages } };
}

/** Publication rejects local contradictions without reinterpreting retained revisions. */
export function validateSlotCatalog(candidate: unknown): ValidationResult<SlotCatalog> {
  const checked = parseSlotCatalog(candidate, true);
  if (!checked.ok) return checked;
  const errors: string[] = [];
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
    }
  }
  return errors.length ? { ok: false, errors } : checked;
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

export const SLOTS_KIND: DocumentKind<SlotCatalog> = {
  name: 'slots',
  publication: 'r2',
  validate: validateSlotCatalog,
  validateStored: (candidate) => parseSlotCatalog(candidate),
  stamp: (v, r) => ({ ...v, version: stampLabel(v.version, 'slots', r) }),
  versionOf: (v) => v.version ?? '',
};

// ── learn (holdout only, for now) ───────────────────────────────────────────

const ARMS = new Set(['default', 'no_learning']);

export function validateLearnConfig(candidate: unknown): ValidationResult<LearnConfig> {
  return validateRetainedLearn(candidate, false);
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
  // W21 C1.04 (F25 §5.2): the tenant's OWN pre-set business targets, as relative
  // lift. Published configuration, never a number compiled into this platform,
  // and ordered so a document cannot declare a target under its own minimum.
  let targets: LearnConfig['targets'];
  if (candidate.targets !== undefined) {
    const t = candidate.targets;
    if (!isRecord(t) || !isNum(t.minimum) || !isNum(t.target) || !isNum(t.stretch)) errors.push('targets: minimum, target and stretch as numbers');
    else if (!(t.minimum <= t.target && t.target <= t.stretch)) errors.push('targets: minimum ≤ target ≤ stretch');
    else targets = { minimum: t.minimum, target: t.target, stretch: t.stretch };
  }
  let regional: LearnConfig['regional'];
  if (candidate.regional !== undefined) {
    const g = candidate.regional;
    if (!isRecord(g)) errors.push('regional: object when present');
    else {
      if (typeof g.enabled !== 'boolean') errors.push('regional.enabled: boolean');
      if (!isNum(g.kBlend) || g.kBlend <= 0 || g.kBlend > 100) errors.push('regional.kBlend: number in (0, 100]');
      if (!isNum(g.minEvents) || !Number.isInteger(g.minEvents) || g.minEvents < 1) errors.push('regional.minEvents: positive integer');
      if (typeof g.enabled === 'boolean' && isNum(g.kBlend) && isNum(g.minEvents)) regional = { enabled: g.enabled, kBlend: g.kBlend, minEvents: g.minEvents };
    }
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
    if (!isRecord(g) || !['service', 'table', 'workers_ai'].includes(String(g.kind)) || typeof g.ref !== 'string' || !g.ref.trim()) errors.push('external: kind service|table|workers_ai and a ref');
    else {
      const timeoutMs = g.timeoutMs === undefined ? 20 : g.timeoutMs;
      if (!isNum(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) errors.push('external.timeoutMs: 1..5000 milliseconds');
      if (g.fallback !== undefined && g.fallback !== 'omit') errors.push('external.fallback: omit');
      if (!errors.some((e) => e.startsWith('external'))) external = { kind: g.kind as 'service' | 'table' | 'workers_ai', ref: g.ref.trim(), timeoutMs: timeoutMs as number, fallback: 'omit' };
    }
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
          if (!isRecord(e) || typeof e.mode !== 'string' || !['rotation', 'thompson', 'epsilon', 'off'].includes(e.mode) || !isNum(e.share) || e.share < 0 || e.share > 1 || !isNum(e.floor) || !Number.isInteger(e.floor) || e.floor < 0) errors.push(`slots.${slot}.exploration: mode ${historical ? 'rotation|thompson|epsilon|off' : 'rotation|epsilon|off'}, share 0..1, floor integer ≥ 0`);
          else if (e.mode === 'thompson' && !historical) errors.push(`slots.${slot}.exploration: Thompson is unsupported; choose off, rotation or epsilon`);
          else dials.exploration = { mode: e.mode as 'rotation' | 'thompson' | 'epsilon' | 'off', share: e.share, floor: e.floor };
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
      ...(targets ? { targets } : {}),
      ...(regional ? { regional } : {}),
      ...(policy ? { policy } : {}),
      ...(stats ? { stats } : {}),
      ...(external ? { external } : {}),
      ...(slots ? { slots } : {}),
    },
  };
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
