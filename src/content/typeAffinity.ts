// Catalog format vocabulary is independent of the rendering kind. Never repair
// stored metadata here: this policy is shared by future touches and live input.
export const HISTORICAL_CONTENT_TYPES = Symbol('historical content-type affinity');

const reserved = new Set(['__proto__', 'prototype', 'constructor']);
// eslint-disable-next-line no-control-regex -- reject control characters without rewriting canonical keys
const unsafe = /[\x00-\x1f\x7f-\x9f<>]/;
const safe = (value: unknown): value is string => typeof value === 'string'
  && value.length > 0 && value.length <= 64 && value.trim() === value
  && !unsafe.test(value) && !reserved.has(value);

export function contentTypeValues(piece: { type: unknown; tags: Readonly<Record<string, unknown>> }): readonly string[] | null {
  const values: unknown = Object.prototype.hasOwnProperty.call(piece.tags, 'contentType') ? piece.tags.contentType : [piece.type];
  if (!Array.isArray(values) || values.length < 1 || values.length > 8) return null;
  const seen = new Set<string>();
  for (const value of values) {
    if (!safe(value) || seen.has(value)) return null;
    seen.add(value);
  }
  return values as string[];
}

/** Clone only an absent own dimension with a usable fallback; explicit tags win. */
export function withContentTypeAffinity<T extends { type: string; tags: Readonly<Record<string, readonly string[]>> }>(piece: T): T {
  if (Object.prototype.hasOwnProperty.call(piece.tags, 'contentType')) return piece;
  const values = contentTypeValues(piece);
  return values ? { ...piece, tags: { ...piece.tags, contentType: values } } : piece;
}
