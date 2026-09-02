// src/content/import.ts
// The import adapter and the provider seam (scope appendix 1.3: content
// registered through a CMS or DAM API, or a JSON or CSV export). Whatever the
// source, the path is the same: normalize into the catalog's shape, validate
// every piece, write one versioned revision. Nothing here talks to the store;
// the route does that, so the same functions serve a file, a paste, or a pull.

import type { ContentCatalog, ContentPiece } from './types';

// ── Normalization: many export shapes, one catalog shape ────────────────────

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `line:Drover;occasion:evening|everyday` or an object of arrays, or an object of strings. */
export function normalizeTags(v: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const add = (dim: string, value: unknown) => {
    const d = dim.trim(); if (!d) return;
    const vals = Array.isArray(value) ? value : String(value ?? '').split('|');
    const clean = vals.map((x) => String(x).trim()).filter(Boolean);
    if (!clean.length) return;
    out[d] = [...new Set([...(out[d] ?? []), ...clean])];
  };
  if (isRecord(v)) { for (const [dim, val] of Object.entries(v)) add(dim, val); return out; }
  if (typeof v === 'string') {
    for (const part of v.split(';')) { const i = part.indexOf(':'); if (i > 0) add(part.slice(0, i), part.slice(i + 1)); }
  }
  return out;
}

export function normalizeList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split('|').map((x) => x.trim()).filter(Boolean);
  return [];
}

/**
 * One raw record from any source into a candidate piece. Accepts the field
 * names the demo catalog, a typical CMS export, and the CSV columns use. What
 * comes out still goes through the catalog validator; this only reshapes.
 */
export function normalizePiece(raw: unknown): Record<string, unknown> | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id) ?? str(raw.systemId) ?? str(raw.contentId);
  const customerContentId = str(raw.customerContentId) ?? str(raw.cmsId) ?? str(raw.customerId) ?? id;
  const type = str(raw.type) ?? str(raw.contentType) ?? str(raw.kind);
  const status = isRecord(raw.lifecycle) ? str(raw.lifecycle.status) : str(raw.status);
  const windowFrom = (isRecord(raw.window) ? str(raw.window.from) : undefined) ?? str(raw.windowFrom) ?? str(raw.publishAt);
  const windowTo = (isRecord(raw.window) ? str(raw.window.to) : undefined) ?? str(raw.windowTo) ?? str(raw.expireAt);
  const art = raw.art === null ? null : str(raw.art);
  return {
    ...(id ? { id } : {}),
    ...(customerContentId ? { customerContentId } : {}),
    ...(type ? { type } : {}),
    ...(str(raw.title) ? { title: str(raw.title) } : {}),
    ...(str(raw.subtitle) ? { subtitle: str(raw.subtitle) } : {}),
    tags: normalizeTags(raw.tags),
    slotTypes: normalizeList(raw.slotTypes ?? raw.slots),
    lifecycle: { status: status ?? 'live' },
    ...(art !== undefined ? { art } : {}),
    ...(str(raw.renderUrl) ?? str(raw.url) ? { renderUrl: str(raw.renderUrl) ?? str(raw.url) } : {}),
    ...(str(raw.excerpt) ? { excerpt: str(raw.excerpt) } : {}),
    ...(str(raw.runtime) ? { runtime: str(raw.runtime) } : {}),
    ...(windowFrom || windowTo ? { window: { ...(windowFrom ? { from: windowFrom } : {}), ...(windowTo ? { to: windowTo } : {}) } } : {}),
  };
}

/** The array of records inside a JSON export: the body itself, `pieces`, `content`, `items`, or a dotted path. */
export function recordsFromJson(body: unknown, path?: string): unknown[] {
  if (path) {
    let cur: unknown = body;
    for (const seg of path.split('.').filter(Boolean)) cur = isRecord(cur) ? cur[seg] : undefined;
    return Array.isArray(cur) ? cur : [];
  }
  if (Array.isArray(body)) return body;
  if (isRecord(body)) for (const k of ['pieces', 'content', 'items', 'data']) if (Array.isArray(body[k])) return body[k] as unknown[];
  return [];
}

// ── CSV ─────────────────────────────────────────────────────────────────────

/** RFC 4180-style: quoted fields may hold commas, newlines and doubled quotes. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  const [header, ...body] = rows;
  if (!header) return [];
  const names = header.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(names.map((n, i) => [n, (r[i] ?? '').trim()])));
}

export const CSV_COLUMNS = [
  'id', 'customerContentId', 'type', 'title', 'subtitle', 'tags', 'slotTypes', 'status', 'art', 'renderUrl', 'excerpt', 'runtime', 'windowFrom', 'windowTo',
] as const;

// ── Assembly ────────────────────────────────────────────────────────────────

export type ImportMode = 'replace' | 'merge';

/** Candidate pieces from raw records; nulls dropped, order kept. */
export function candidatesFrom(records: unknown[]): Record<string, unknown>[] {
  return records.map(normalizePiece).filter((p): p is Record<string, unknown> => p !== null);
}

/** Replace the catalog, or upsert by id into the current one, keeping the current order for known ids. */
export function assemble(current: ContentCatalog, incoming: Record<string, unknown>[], mode: ImportMode): { pieces: unknown[] } {
  if (mode === 'replace') return { pieces: incoming };
  const byId = new Map<string, unknown>(current.pieces.map((p: ContentPiece) => [p.id, p]));
  for (const p of incoming) { const id = typeof p.id === 'string' ? p.id : ''; if (id) byId.set(id, p); }
  return { pieces: [...byId.values()] };
}

// ── The provider seam ───────────────────────────────────────────────────────

export interface ContentSource {
  /** The raw records, however the source holds them. */
  pull(): Promise<unknown[]>;
}

/**
 * A CMS or DAM that exposes JSON over HTTP: the first adapter, and the shape
 * every later one fills. http(s) only; the caller decides what URLs are allowed.
 */
export class HttpJsonSource implements ContentSource {
  constructor(
    private readonly url: string,
    private readonly path?: string,
    private readonly fetchImpl: (input: string, init?: RequestInit) => Promise<Response> = (input, init) => fetch(input, init),
  ) {
    if (!/^https?:\/\//i.test(url)) throw new Error('source url must be http(s)');
  }
  async pull(): Promise<unknown[]> {
    const res = await this.fetchImpl(this.url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`source responded ${res.status}`);
    return recordsFromJson(await res.json(), this.path);
  }
}
