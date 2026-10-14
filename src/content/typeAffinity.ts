// Catalog format vocabulary is independent of the rendering kind. Never repair
// stored metadata here: this policy is shared by future touches and live input.
export const HISTORICAL_CONTENT_TYPES = Symbol('historical content-type affinity');

/**
 * P32 (decision D3): the catalogue document's marker that retires the free-text
 * type fallback (`typeFallback: 'retired'` beside its `pieces`). A catalogue that
 * declares it takes a piece's content format from the piece's own `contentType`
 * tag alone — in ranking, in slot exclusions and in what an engagement teaches —
 * so a piece without that tag has no content format. A catalogue without it
 * keeps the fallback below exactly as before.
 */
export const TYPE_FALLBACK_RETIRED = 'retired' as const;
export type TypeFallbackMarker = typeof TYPE_FALLBACK_RETIRED;

/** P32: whether a catalogue document retires the fallback. Only the exact marker does. */
export function typeFallbackRetired(catalog: { typeFallback?: unknown } | null | undefined): boolean {
  return catalog?.typeFallback === TYPE_FALLBACK_RETIRED;
}

const reserved = new Set(['__proto__', 'prototype', 'constructor']);
// eslint-disable-next-line no-control-regex -- reject control characters without rewriting canonical keys
const unsafe = /[\x00-\x1f\x7f-\x9f<>]/;
const safe = (value: unknown): value is string => typeof value === 'string'
  && value.length > 0 && value.length <= 64 && value.trim() === value
  && !unsafe.test(value) && !reserved.has(value);
/** A catalogue tag value safe to learn as an interest key: the same rule the content format answers to. */
export const isLearnableValue = safe;

/**
 * The piece's content format: its own `contentType` tag, or — only where the
 * catalogue has not retired the fallback (P32) — its safe free-text `type`.
 */
export function contentTypeValues(piece: { type: unknown; tags: Readonly<Record<string, unknown>> }, retired = false): readonly string[] | null {
  const own = Object.prototype.hasOwnProperty.call(piece.tags, 'contentType');
  if (!own && retired) return null;
  const values: unknown = own ? piece.tags.contentType : [piece.type];
  if (!Array.isArray(values) || values.length < 1 || values.length > 8) return null;
  const seen = new Set<string>();
  for (const value of values) {
    if (!safe(value) || seen.has(value)) return null;
    seen.add(value);
  }
  return values as string[];
}

/** P32: whether the fallback supplies this piece's format — no own `contentType` tag, and a usable `type`. */
export function formatFromTypeFallback(piece: { type: unknown; tags: Readonly<Record<string, unknown>> }): boolean {
  return !Object.prototype.hasOwnProperty.call(piece.tags, 'contentType') && contentTypeValues(piece) !== null;
}

/**
 * P32: whether a slot reads a piece's content format at all — it weighs the
 * `contentType` dimension, excludes a `contentType` value, or spreads its
 * positions over `contentType` — so a format the fallback supplies can change
 * what the slot decides. A slot that reads none decides the same with or
 * without the fallback.
 */
export function slotReadsContentFormat(slot: { weights?: Readonly<Record<string, number>>; excludedTags?: ReadonlyArray<{ dimension: string }>;
  diversity?: { dimension: string } }): boolean {
  const weight = slot.weights?.contentType;
  return (typeof weight === 'number' && weight !== 0)
    || (slot.excludedTags ?? []).some(pair => pair.dimension === 'contentType')
    || slot.diversity?.dimension === 'contentType';
}

/**
 * P32: whether the fallback can change a decision over these slots: some piece
 * whose format the fallback supplies names a slot that reads the format.
 */
export function typeFallbackReaches(pieces: ReadonlyArray<{ type: unknown; tags: Readonly<Record<string, unknown>>; slotTypes: readonly string[] }>,
  slots: ReadonlyArray<Parameters<typeof slotReadsContentFormat>[0] & { slot: string }>): boolean {
  const reading = new Set(slots.filter(slotReadsContentFormat).map(slot => slot.slot));
  return reading.size > 0 && pieces.some(piece => formatFromTypeFallback(piece) && piece.slotTypes.some(slot => reading.has(slot)));
}

/** Clone only an absent own dimension with a usable fallback; explicit tags win. */
export function withContentTypeAffinity<T extends { type: string; tags: Readonly<Record<string, readonly string[]>> }>(piece: T): T {
  if (Object.prototype.hasOwnProperty.call(piece.tags, 'contentType')) return piece;
  const values = contentTypeValues(piece);
  return values ? { ...piece, tags: { ...piece.tags, contentType: values } } : piece;
}
