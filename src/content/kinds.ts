// src/content/kinds.ts
// Three document kinds for the versioned store (src/config/versionedStore.ts):
// no second versioning system. Each validator returns EVERY error, and each
// kind has a compiled fallback so a missing or corrupt document can never take
// the decision path down (doc 22 §18.1's failure posture, inherited).

import type { DocumentKind, ValidationResult } from '@/config/versionedStore';
import type { ContentCatalog, ContentPiece, LearnConfig, SlotCatalog, SlotStrategy } from './types';

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

function validatePiece(p: unknown, i: number, seen: Set<string>, errors: string[]): ContentPiece | null {
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
  if (!isStr(id) || !isStr(cid) || !isStr(type) || !isStr(title) || !slotTypes) return null;
  return {
    id, customerContentId: cid, type, title, tags, slotTypes,
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
  const errors: string[] = [];
  if (!isRecord(candidate)) return { ok: false, errors: ['catalog: must be an object'] };
  if (candidate.version !== undefined && !isStr(candidate.version)) errors.push('version: string when present');
  if (!Array.isArray(candidate.pieces)) return { ok: false, errors: [...errors, 'pieces: required array'] };
  const seen = new Set<string>();
  const pieces: ContentPiece[] = [];
  candidate.pieces.forEach((p, i) => { const v = validatePiece(p, i, seen, errors); if (v) pieces.push(v); });
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { ...(isStr(candidate.version) ? { version: candidate.version } : {}), pieces } };
}

export const EMPTY_CATALOG: ContentCatalog = { version: 'content-empty', pieces: [] };

export const CONTENT_KIND: DocumentKind<ContentCatalog> = {
  name: 'content',
  validate: validateContentCatalog,
  stamp: (v, r) => ({ ...v, version: stampLabel(v.version, 'content', r) }),
  versionOf: (v) => v.version ?? '',
};

// ── slots ───────────────────────────────────────────────────────────────────

function validateSlot(s: unknown, page: string, i: number, seen: Set<string>, errors: string[]): SlotStrategy | null {
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
  if (!isStr(slot) || !isNum(take) || !isRecord(s.weights)) return null;
  return { slot, take, weights, ...(isStr(s.pinnedPieceId) ? { pinnedPieceId: s.pinnedPieceId } : {}) };
}

export function validateSlotCatalog(candidate: unknown): ValidationResult<SlotCatalog> {
  const errors: string[] = [];
  if (!isRecord(candidate)) return { ok: false, errors: ['slots: must be an object'] };
  if (candidate.version !== undefined && !isStr(candidate.version)) errors.push('version: string when present');
  if (!isRecord(candidate.pages)) return { ok: false, errors: [...errors, 'pages: required object of page → slot[]'] };
  const pages: Record<string, SlotStrategy[]> = {};
  for (const [page, list] of Object.entries(candidate.pages)) {
    if (!SLUG.test(page)) { errors.push(`pages.${page}: page name must be a slug`); continue; }
    if (!Array.isArray(list)) { errors.push(`pages.${page}: must be an array`); continue; }
    const seen = new Set<string>();
    const slots: SlotStrategy[] = [];
    list.forEach((s, i) => { const v = validateSlot(s, page, i, seen, errors); if (v) slots.push(v); });
    pages[page] = slots;
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { ...(isStr(candidate.version) ? { version: candidate.version } : {}), pages } };
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
  validate: validateSlotCatalog,
  stamp: (v, r) => ({ ...v, version: stampLabel(v.version, 'slots', r) }),
  versionOf: (v) => v.version ?? '',
};

// ── learn (holdout only, for now) ───────────────────────────────────────────

const ARMS = new Set(['default', 'no_learning']);

export function validateLearnConfig(candidate: unknown): ValidationResult<LearnConfig> {
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
      if (typeof g.enabled === 'boolean' && isNum(g.kBlend) && isNum(g.minEvents)) regional = { enabled: g.enabled, kBlend: g.kBlend, minEvents: g.minEvents };
    }
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      ...(isStr(candidate.version) ? { version: candidate.version } : {}),
      holdout: { share: h.share as number, salt: (h.salt as string | undefined) ?? '', arms: [...(arms as LearnConfig['holdout']['arms'])] },
      ...(regional ? { regional } : {}),
    },
  };
}

/** Five percent, one default arm, salted by the brand at decision time; the regional prior on, gated at 30 events. */
export const DEFAULT_LEARN: LearnConfig = {
  version: 'learn-default',
  holdout: { share: 0.05, salt: '', arms: ['default'] },
  regional: { enabled: true, kBlend: 1, minEvents: 30 },
};

export const LEARN_KIND: DocumentKind<LearnConfig> = {
  name: 'learn',
  validate: validateLearnConfig,
  stamp: (v, r) => ({ ...v, version: stampLabel(v.version, 'learn', r) }),
  versionOf: (v) => v.version ?? '',
};
