// Every active configuration kind uses the same strict conditional R2 authority.
// Legacy KV keys are retained history only, never fallback or mutation authority.
import type { Env } from '@/types/env';
import { invalidatePublicationCache, publicationVersion, publicationHistory, publish, readPublication } from './publication';
export const CACHE_TTL_MS = 30_000;
export const INDEX_LIMIT = 50;
export const LEGACY_DOCUMENT_MAX_BYTES = 2 * 1024 * 1024;
export class LegacyDocumentError extends Error {
  readonly status: 413 | 503;
  constructor(readonly code: 'document_too_large' | 'document_unavailable') {
    super(code === 'document_too_large' ? 'Configuration document exceeds the application size limit' : 'Stored configuration is unavailable; operation refused');
    this.name = 'LegacyDocumentError'; this.status = code === 'document_too_large' ? 413 : 503;
  }
}
export const RESERVED_PREFIXES = [
  'reflex:config:', 'learn:config:', 'lift:', 'prior:', 'policy:',
  // CW4 (plan 21, the seam): the content catalog and per-page slot strategies.
  'content:config:', 'slots:config:',
  // Phase 2 (doc 22 §11): the autonomy cycle's proposals, with their evidence.
  'proposals:config:',
] as const;

export type Scope = string;

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

/** A stored document plus who changed it, when, and why. */
export interface Revision<T> {
  revision: number;
  value: T;
  actor: string;
  note: string;
  at: number;
  /** Coherent authority identity actually read, never synthesized at save time. */
  publication?: { revision: number; digest: string };
}

export interface IndexEntry {
  revision: number;
  /** The kind's own identity string for this revision, when it has one. */
  version: string;
  actor: string;
  note: string;
  at: number;
}

export type WriteResult<T> =
  | { ok: true; revision: Revision<T> }
  | { ok: false; errors: string[] };

export interface WriteMeta {
  actor: string;
  note?: string;
  nowMs?: number;
  /** Required by the coherent conditional publication authority. */
  expectedRevision?: number;
  operationId?: string;
  expectedPublication?: { revision: number; digest: string };
  /** Current authority recheck supplied by authenticated ingress, not serialized intent. */
  authorize?: () => Promise<void>;
}

/**
 * A kind of configuration document. The optional hooks are where a kind's own
 * semantics live; everything else is inherited.
 */
export interface DocumentKind<T> {
  /** KV namespace segment. Its prefix must be listed in RESERVED_PREFIXES. */
  name: string;
  /** Explicit authority marker; all active kinds use the coherent authority. */
  publication?: 'r2';
  /** Total validation of untrusted input. Returns EVERY error, not the first. */
  validate(candidate: unknown): ValidationResult<T>;
  /** Explicit historical read compatibility; never used to authorize a write. */
  validateStored?(candidate: unknown): ValidationResult<T>;
  /**
   * Write the revision number into the document's own identity, when it has one.
   * ReflexConfig needs this: config.version is stamped into decision IDs and
   * explain records, so two revisions must never share a version string.
   */
  stamp?(value: T, revision: number): T;
  /** The kind's identity string, for the audit index. */
  versionOf?(value: T): string;
  /** Merge a patch onto a base. Defaults to deepMerge. */
  applyPatch?(base: T, patch: unknown): T;
}


export function invalidateCache(_kind?: string, _scope?: Scope): void { void _kind; void _scope; invalidatePublicationCache(); }
export async function readRevision<T>(env: Env, kind: DocumentKind<T>, scope: Scope, _nowMs = Date.now()): Promise<Revision<T>> {
  void _nowMs;
  return readPublication(env, kind, scope, true);
}
export async function read<T>(env: Env, kind: DocumentKind<T>, scope: Scope, _fallback: T, nowMs = Date.now()): Promise<T> {
  return (await readRevision(env, kind, scope, nowMs)).value;
}
export async function readVersion<T>(env: Env, kind: DocumentKind<T>, scope: Scope, revision: number): Promise<Revision<T> | null> {
  return publicationVersion(env, kind, scope, revision);
}
export async function readIndex<T>(env: Env, kind: DocumentKind<T>, scope: Scope): Promise<IndexEntry[]> {
  return publicationHistory(env, kind, scope);
}
export async function readRevisionForMutation<T>(env: Env, kind: DocumentKind<T>, scope: Scope, revision?: number): Promise<Revision<T> | null> {
  return revision === undefined ? readPublication(env, kind, scope) : publicationVersion(env, kind, scope, revision);
}
export async function write<T>(env: Env, kind: DocumentKind<T>, scope: Scope, candidate: unknown, meta: WriteMeta): Promise<WriteResult<T>> {
  return publish(env, kind, scope, { type: 'replace', candidate }, meta, () => candidate);
}
export async function patch<T>(env: Env, kind: DocumentKind<T>, scope: Scope, _fallback: T, p: unknown, meta: WriteMeta): Promise<WriteResult<T>> {
  return publish(env, kind, scope, { type: 'patch', patch: p }, meta, base => kind.applyPatch ? kind.applyPatch(base, p) : deepMerge(base, p));
}
export async function rollback<T>(env: Env, kind: DocumentKind<T>, scope: Scope, toRevision: number, meta: WriteMeta): Promise<WriteResult<T>> {
  return publish(env, kind, scope, { type: 'rollback', toRevision }, { ...meta, note: meta.note ?? `rollback to revision ${toRevision}` }, async () => {
    const target = await publicationVersion(env, kind, scope, toRevision); return target?.value ?? null;
  });
}
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Objects merge key by key; arrays and scalars replace. A kind overrides this when
 * it needs something smarter, as ReflexConfig does for its dimensions array.
 */
export function deepMerge<T>(base: T, patchValue: unknown): T {
  if (typeof patchValue !== 'object' || patchValue === null || Array.isArray(patchValue)) {
    return (patchValue === undefined ? base : patchValue) as T;
  }
  const out = structuredCopy(base) as Record<string, unknown>;
  for (const [k, v] of Object.entries(patchValue as Record<string, unknown>)) {
    if (RESERVED_KEYS.has(k)) continue;
    const cur = out[k];
    const bothPlainObjects =
      v !== null && typeof v === 'object' && !Array.isArray(v) &&
      cur !== null && typeof cur === 'object' && !Array.isArray(cur);
    out[k] = bothPlainObjects ? deepMerge(cur, v) : v;
  }
  return out as T;
}

export function structuredCopy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    Object.freeze(v);
    for (const key of Object.keys(v as Record<string, unknown>)) {
      deepFreeze((v as Record<string, unknown>)[key]);
    }
  }
  return v;
}
