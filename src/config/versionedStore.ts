// src/config/versionedStore.ts
// ---------------------------------------------------------------------------
// One versioned-document store, for every kind of configuration.
//
// WHY THIS IS GENERIC. CW0 built versioning, validation, an audit index, rollback
// and an isolate cache for exactly one document: ReflexConfig. The outcome-learning
// design (doc 22) then specified four version counters on every decision record,
// `versions: { config, lift, prior, policy }`, and a configuration catalog (its
// section 13) of eighteen parameter groups that are not ReflexConfig fields:
// reward definitions, attribution policies, the gamma trust dial per slot,
// exploration, holdout, autonomy bounds, and item freeze/reset/reject.
//
// Doc 22 says of all of them that "every entry is versioned with change history
// and applies without a deployment" (13), that each item control "is a versioned
// configuration change" (12.2), and that "a rollback is a version pointer" (11).
// It never names a mechanism, because it was written before this store existed.
//
// So either this store becomes generic, or phases 0 to 3 build a second one and
// the programme ends up with two answers to "what changed, when, by whom, and how
// do I put it back". This is the cheap moment to decide that. A document kind
// supplies a name, a validator, and optionally a stamp and a merge; it inherits
// versioning, attribution, audit, rollback, failure-safety and caching.
//
// KEYS ARE UNCHANGED for the reflex kind: reflex:config:{scope}:current,
// :rev:{n}, :index. Nothing already written needs migrating. Doc 22's lift
// snapshots take their own prefix, reserved below.
//
// THE FAILURE POSTURE IS INHERITED TOO: every read resolves to the caller's
// fallback rather than throwing, and every stored value is re-validated on the way
// out, because a document written by an older build is untrusted input like any
// other.
// ---------------------------------------------------------------------------

import type { Env } from '@/types/env';

/** How long a resolved document is trusted inside one isolate before re-reading. */
export const CACHE_TTL_MS = 30_000;

/** Revisions kept in the browsable index. Every revision body is kept regardless. */
export const INDEX_LIMIT = 50;

/**
 * KV prefixes this store owns, so nothing else claims them. Doc 22 section 6.1
 * publishes lift snapshots to KV under versioned keys with a version marker, and
 * its section 14 adds prior and policy documents. Those are separate kinds here,
 * or separate prefixes there, but never the same key space by accident.
 */
export const RESERVED_PREFIXES = [
  'reflex:config:', 'learn:config:', 'lift:', 'prior:', 'policy:',
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
}

/**
 * A kind of configuration document. The optional hooks are where a kind's own
 * semantics live; everything else is inherited.
 */
export interface DocumentKind<T> {
  /** KV namespace segment. Its prefix must be listed in RESERVED_PREFIXES. */
  name: string;
  /** Total validation of untrusted input. Returns EVERY error, not the first. */
  validate(candidate: unknown): ValidationResult<T>;
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

// -- Keys -------------------------------------------------------------------

const keyCurrent = (kind: string, scope: Scope) => `${kind}:config:${scope}:current`;
const keyRevision = (kind: string, scope: Scope, n: number) => `${kind}:config:${scope}:rev:${n}`;
const keyIndex = (kind: string, scope: Scope) => `${kind}:config:${scope}:index`;

// -- Isolate cache ----------------------------------------------------------

interface CacheEntry { at: number; revision: Revision<unknown> | null }
const isolateCache = new Map<string, CacheEntry>();
const cacheKey = (kind: string, scope: Scope) => `${kind} ${scope}`;

/** Drop cached documents. Called on every write; exported for tests. */
export function invalidateCache(kind?: string, scope?: Scope): void {
  if (kind === undefined) { isolateCache.clear(); return; }
  if (scope === undefined) {
    for (const k of [...isolateCache.keys()]) if (k.startsWith(`${kind} `)) isolateCache.delete(k);
    return;
  }
  isolateCache.delete(cacheKey(kind, scope));
}

// -- Read -------------------------------------------------------------------

/**
 * The stored revision, or null when nothing is stored or what is stored cannot be
 * trusted. Never throws: a KV failure must not become a decision failure.
 */
export async function readRevision<T>(
  env: Env, kind: DocumentKind<T>, scope: Scope, nowMs: number = Date.now(),
): Promise<Revision<T> | null> {
  const ck = cacheKey(kind.name, scope);
  const cached = isolateCache.get(ck);
  if (cached && nowMs - cached.at < CACHE_TTL_MS) return cached.revision as Revision<T> | null;

  let revision: Revision<T> | null = null;
  try {
    revision = coerce(await env.CACHE.get(keyCurrent(kind.name, scope), 'json'), kind, scope);
  } catch (err) {
    // Do not cache a failure: the next call retries, and until then the caller's
    // fallback serves.
    console.warn(`[config:${kind.name}] read failed for scope "${scope}", serving fallback`, err);
    return null;
  }
  isolateCache.set(ck, { at: nowMs, revision: revision as Revision<unknown> | null });
  return revision;
}

/** The document to use, falling back to a compiled default the caller supplies. */
export async function read<T>(
  env: Env, kind: DocumentKind<T>, scope: Scope, fallback: T, nowMs: number = Date.now(),
): Promise<T> {
  const revision = await readRevision(env, kind, scope, nowMs);
  return revision ? revision.value : fallback;
}

/** A specific historical revision, for diffing, replay and rollback. */
export async function readVersion<T>(
  env: Env, kind: DocumentKind<T>, scope: Scope, revision: number,
): Promise<Revision<T> | null> {
  try {
    return coerce(await env.CACHE.get(keyRevision(kind.name, scope, revision), 'json'), kind, scope);
  } catch {
    return null;
  }
}

export async function readIndex<T>(
  env: Env, kind: DocumentKind<T>, scope: Scope,
): Promise<IndexEntry[]> {
  try {
    const raw = await env.CACHE.get(keyIndex(kind.name, scope), 'json');
    return Array.isArray(raw) ? (raw as IndexEntry[]) : [];
  } catch {
    return [];
  }
}

/**
 * A stored envelope is untrusted input too: it may predate a validation rule, or
 * have been written by an older build. Re-validate on read, and refuse rather than
 * serve something we would not accept on write.
 */
function coerce<T>(raw: unknown, kind: DocumentKind<T>, scope: Scope): Revision<T> | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const envelope = raw as Record<string, unknown>;
  // `config` is the field name from when this store held only ReflexConfig. Read
  // both, so nothing already written has to be migrated.
  const body = 'value' in envelope ? envelope.value : envelope.config;
  const result = kind.validate(body);
  if (!result.ok) {
    console.warn(
      `[config:${kind.name}] stored document for scope "${scope}" is invalid and was ignored: ` +
      result.errors.join('; '),
    );
    return null;
  }
  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return {
    revision: num(envelope.revision, 0),
    value: result.value,
    actor: typeof envelope.actor === 'string' ? envelope.actor : 'unknown',
    note: typeof envelope.note === 'string' ? envelope.note : '',
    at: num(envelope.at, 0),
  };
}

// -- Write ------------------------------------------------------------------

/**
 * Validate, version, store, audit. The immutable revision body is written BEFORE
 * the current pointer moves, so a failure between the two leaves the pointer on a
 * revision that is known to exist.
 */
export async function write<T>(
  env: Env, kind: DocumentKind<T>, scope: Scope, candidate: unknown, meta: WriteMeta,
): Promise<WriteResult<T>> {
  const result = kind.validate(candidate);
  if (!result.ok) return result;

  const nowMs = meta.nowMs ?? Date.now();
  const previous = await readRevision(env, kind, scope, nowMs);
  const revisionNumber = (previous?.revision ?? 0) + 1;
  const value = kind.stamp ? kind.stamp(result.value, revisionNumber) : result.value;

  const revision: Revision<T> = {
    revision: revisionNumber, value,
    actor: meta.actor, note: meta.note ?? '', at: nowMs,
  };
  // `config` is written alongside `value` so a build that predates this
  // generalization can still read what a newer build wrote.
  const body = JSON.stringify({ ...revision, config: value });

  await env.CACHE.put(keyRevision(kind.name, scope, revisionNumber), body);
  await env.CACHE.put(keyCurrent(kind.name, scope), body);

  const index = await readIndex(env, kind, scope);
  const entry: IndexEntry = {
    revision: revisionNumber,
    version: kind.versionOf ? kind.versionOf(value) : String(revisionNumber),
    actor: revision.actor, note: revision.note, at: nowMs,
  };
  await env.CACHE.put(keyIndex(kind.name, scope), JSON.stringify([entry, ...index].slice(0, INDEX_LIMIT)));

  invalidateCache(kind.name, scope);
  return { ok: true, revision };
}

/** Read current, merge the patch, write. One slider, one call. */
export async function patch<T>(
  env: Env, kind: DocumentKind<T>, scope: Scope, fallback: T, p: unknown, meta: WriteMeta,
): Promise<WriteResult<T>> {
  const current = await read(env, kind, scope, fallback, meta.nowMs ?? Date.now());
  const merged = kind.applyPatch ? kind.applyPatch(current, p) : deepMerge(current, p);
  return write(env, kind, scope, merged, meta);
}

/**
 * Roll back by writing the old body forward as a NEW revision. The counter never
 * rewinds, so the audit records that a rollback happened rather than erasing the
 * revisions it undid. Doc 22 section 11 calls a rollback "a version pointer", and
 * it is one: the pointer moves to a new revision whose body equals the old one.
 * Nothing anywhere should implement a rewinding counter, because an autonomy job
 * that rewinds loses the record of what it tried.
 */
export async function rollback<T>(
  env: Env, kind: DocumentKind<T>, scope: Scope, toRevision: number, meta: WriteMeta,
): Promise<WriteResult<T>> {
  const target = await readVersion(env, kind, scope, toRevision);
  if (!target) return { ok: false, errors: [`revision ${toRevision} not found for scope "${scope}"`] };
  return write(env, kind, scope, target.value, {
    ...meta,
    note: meta.note ?? `rollback to revision ${toRevision}`,
  });
}

// -- Helpers shared by every kind -------------------------------------------

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
