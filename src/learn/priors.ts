// src/learn/priors.ts
// Doc 22 §8, imported priors. A prior is pseudo-counts: for one slot, item and
// cell key, a rate p_prior and a strength n_equiv. The snapshot builder uses
// them as p₀ and n₀ for that key until live evidence outweighs them, a level
// with a prior counts the prior's strength toward the evidence threshold (that
// is what importing one means), and every receipt names the prior document's
// revision. The document is versioned like every other tuning document. It
// arrives as JSON rows or as CSV with the same five columns, which is what a
// warehouse exports.

import type { DocumentKind, ValidationResult } from '@/config/versionedStore';
import { parseCsv } from '@/content/import';

export interface PriorRow { slot: string; item: string; cell: string; p_prior: number; n_equiv: number; measurementBasis?: import('@/content/types').MeasurementBasis }
export interface PriorsDoc { version?: string; rows: PriorRow[] }
export const EMPTY_PRIORS: PriorsDoc = { version: 'prior-empty', rows: [] };

const SLUG = /^[a-z0-9][a-z0-9:_.-]{0,63}$/i;
/** '*' or `k=v` pairs joined by '|', in the ladder's order (doc 22 §5.4): the same keys the snapshot uses. */
const CELL = /^(\*|[a-z_]+=[^|]*(\|[a-z_]+=[^|]*)*)$/;

export function validatePriors(candidate: unknown): ValidationResult<PriorsDoc> {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return { ok: false, errors: ['priors: must be an object with rows'] };
  const c = candidate as Record<string, unknown>;
  if (!Array.isArray(c.rows)) return { ok: false, errors: ['rows: array required'] };
  const errors: string[] = [];
  const rows: PriorRow[] = [];
  const seen = new Set<string>();
  c.rows.forEach((r, i) => {
    if (!r || typeof r !== 'object') { errors.push(`rows[${i}]: object`); return; }
    const x = r as Record<string, unknown>;
    const slot = String(x.slot ?? '').trim(), item = String(x.item ?? '').trim(), cell = String(x.cell ?? '*').trim() || '*';
    const p = Number(x.p_prior), n = Number(x.n_equiv);
    const before = errors.length;
    if (x.measurementBasis !== undefined && x.measurementBasis !== 'served-v1' && x.measurementBasis !== 'rendered-v1') errors.push(`rows[${i}].measurementBasis: served-v1 | rendered-v1`);
    if (!SLUG.test(slot)) errors.push(`rows[${i}].slot: slug`);
    if (!item) errors.push(`rows[${i}].item: required`);
    if (!CELL.test(cell)) errors.push(`rows[${i}].cell: '*' or k=v pairs joined by |`);
    if (!Number.isFinite(p) || p < 0 || p > 1) errors.push(`rows[${i}].p_prior: number 0..1`);
    if (!Number.isFinite(n) || n <= 0) errors.push(`rows[${i}].n_equiv: positive number`);
    const key = JSON.stringify([slot, item, cell, x.measurementBasis ?? 'served-v1']);
    if (seen.has(key)) errors.push(`rows[${i}]: duplicate of ${key}`);
    seen.add(key);
    if (errors.length === before) rows.push({ slot, item, cell, p_prior: p, n_equiv: n, ...(x.measurementBasis !== undefined ? { measurementBasis: x.measurementBasis as import('@/content/types').MeasurementBasis } : {}) });
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { ...(typeof c.version === 'string' ? { version: c.version } : {}), rows } };
}

/** The five columns, in any order, one row per prior. Blank cell means '*'. */
export function parsePriorsCsv(text: string): PriorsDoc {
  const rows = parseCsv(text).map((r) => ({
    slot: r.slot ?? '', item: r.item ?? '', cell: r.cell?.trim() || '*',
    p_prior: Number(r.p_prior), n_equiv: Number(r.n_equiv),
    ...(r.measurementBasis ? { measurementBasis: r.measurementBasis as import('@/content/types').MeasurementBasis } : {}),
  }));
  return { rows };
}

export const PRIORS_KIND: DocumentKind<PriorsDoc> = {
  name: 'prior',
  publication: 'r2',
  validate: validatePriors,
  stamp: (v, r) => ({ ...v, version: `${(v.version ?? 'prior').replace(/\+r\d+$/, '')}+r${r}` }),
  versionOf: (v) => v.version ?? '',
};

/** Exact item → exact cell → prior, for one slot; neither identifier is split. */
export type PriorIndex = Map<string, Map<string, { p: number; n: number }>>;

export function indexPriors(doc: PriorsDoc | null | undefined, slot: string, measurementBasis: import('@/content/types').MeasurementBasis = 'served-v1'): PriorIndex {
  // Bound expansion here too; legacy document validation must not silently
  // turn an over-capacity retained prior into an absent/zero prior.
  if (doc && (doc.rows.length > 4096 || new TextEncoder().encode(JSON.stringify(doc)).length > 256 * 1024)) throw new Error('Prior capacity exceeded');
  const out: PriorIndex = new Map();
  for (const r of doc?.rows ?? []) if (r.slot === slot && (r.measurementBasis ?? 'served-v1') === measurementBasis) {
    const cells = out.get(r.item) ?? new Map<string, { p: number; n: number }>();
    cells.set(r.cell, { p: r.p_prior, n: r.n_equiv });
    out.set(r.item, cells);
  }
  return out;
}
