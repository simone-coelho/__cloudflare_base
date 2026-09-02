// src/reflex/configStore.ts
// ─────────────────────────────────────────────────────────────────────────────
// CW0 — the versioned reflex config store.
//
// Scope appendix §1.4 promises that "weights, decay horizons and thresholds are
// versioned configuration, effective immediately with no deployment." Until this
// module, ReflexConfig was a compile-time constant (DEFAULT_REFLEX_CONFIG) and
// the only way to retune the engine was to ship code. This is the store that
// makes the clause true, and the read/write API in src/routes/config.ts is its
// surface.
//
// Three properties this module exists to guarantee:
//
//   1. THE ENGINE NEVER BREAKS ON CONFIG. Every failure path — missing key, KV
//      outage, malformed JSON, a config that violates an invariant — resolves to
//      DEFAULT_REFLEX_CONFIG *by identity*. Tuning can be wrong; it can never
//      take the decision path down.
//
//   2. AN INVALID CONFIG IS NEVER STORED. validate() runs before any write, and
//      the hysteresis invariant (θ_out < θ_in, per effective dimension) is
//      enforced rather than assumed. θ_out ≥ θ_in makes audiences flap on every
//      event: a shopper enters and exits continuously, which reads to a customer
//      as the engine being broken. That is a one-character mistake in a form
//      field, so the form is not where it gets caught.
//
//   3. EVERY DECISION CAN BE TRACED TO THE CONFIG THAT PRODUCED IT. config.version
//      is stamped into decision IDs and explain records (composer.ts, and
//      MeridianReflex). If tuning changed the weights without changing the
//      version string, two decisions made under different weights would carry the
//      same provenance and the explain record would be false. So a write STAMPS
//      the version with its revision: 'reflex-demo-v1' becomes
//      'reflex-demo-v1+r3'. The author's name for the config survives; the
//      revision makes it honest.
//
// Reads are served from an isolate cache with a short TTL, so the hot path pays
// no KV read per decision. "Effective immediately" is measured against a
// DEPLOYMENT, which is the comparison the clause draws; the honest number is
// CACHE_TTL_MS below, and a write invalidates the writing isolate at once.
// ─────────────────────────────────────────────────────────────────────────────

import { DEFAULT_REFLEX_CONFIG, type DimensionSpec, type ReflexConfig } from '@/reflex/core';
import type { Env } from '@/types/env';
import * as store from '@/config/versionedStore';
import { deepFreeze, structuredCopy } from '@/config/versionedStore';

/**
 * Config scope. Today this is the demo surface ('coach' | 'brighthour'). CW1
 * (multi-tenancy) makes it '{tenant}:{surface}' — the key builder below is the
 * only place that has to learn about it, which is why scope is a string here and
 * not the DemoSurface union.
 */
export type ConfigScope = string;

export const DEFAULT_SCOPE: ConfigScope = 'coach';

/** Inherited from the generic store so there is one number, not two. */
export const CACHE_TTL_MS = store.CACHE_TTL_MS;
export const INDEX_LIMIT = store.INDEX_LIMIT;

/** A stored config plus who changed it, when, and why. */
export interface ConfigRevision {
  revision: number;
  config: ReflexConfig;
  actor: string;
  note: string;
  at: number;
}

export interface ConfigIndexEntry {
  revision: number;
  version: string;
  actor: string;
  note: string;
  at: number;
}

export type ValidationResult =
  | { ok: true; config: ReflexConfig }
  | { ok: false; errors: string[] };

export type WriteResult =
  | { ok: true; revision: ConfigRevision }
  | { ok: false; errors: string[] };

// ── Validation ───────────────────────────────────────────────────────────────

const MAX_TAU_MS = 30 * 24 * 60 * 60 * 1000; // 30 days: a decay horizon, not a lease
const MAX_DIMENSIONS = 32;
const MAX_WEIGHTS = 200;
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function checkNumber(
  errors: string[], path: string, v: unknown,
  { min, max, exclusiveMin = false, integer = false }:
    { min: number; max: number; exclusiveMin?: boolean; integer?: boolean },
): void {
  if (!isFiniteNumber(v)) { errors.push(`${path} must be a finite number`); return; }
  if (integer && !Number.isInteger(v)) errors.push(`${path} must be an integer`);
  if (exclusiveMin ? v <= min : v < min) {
    errors.push(`${path} must be ${exclusiveMin ? 'greater than' : 'at least'} ${min} (got ${v})`);
  }
  if (v > max) errors.push(`${path} must be at most ${max} (got ${v})`);
}

/** θ_out < θ_in or audiences flap. Checked on EFFECTIVE values, per dimension. */
function checkHysteresis(errors: string[], path: string, thetaIn: unknown, thetaOut: unknown): void {
  if (!isFiniteNumber(thetaIn) || !isFiniteNumber(thetaOut)) return; // shape errors already reported
  if (thetaOut >= thetaIn) {
    errors.push(
      `${path}: thetaOut (${thetaOut}) must be strictly below thetaIn (${thetaIn}). ` +
      `Equal or inverted thresholds remove the hysteresis band and make membership flap on every event.`,
    );
  }
}

function validateDimension(errors: string[], d: unknown, i: number, seen: Set<string>, global: ReflexConfig): void {
  const path = `dimensions[${i}]`;
  if (typeof d !== 'object' || d === null || Array.isArray(d)) {
    errors.push(`${path} must be an object`); return;
  }
  const spec = d as Record<string, unknown>;

  if (typeof spec.key !== 'string' || spec.key.trim() === '') {
    errors.push(`${path}.key must be a non-empty string`);
  } else if (RESERVED_KEYS.has(spec.key)) {
    errors.push(`${path}.key must not be "${spec.key}"`);
  } else if (seen.has(spec.key)) {
    errors.push(`${path}.key "${spec.key}" is duplicated; dimension keys must be unique`);
  } else {
    seen.add(spec.key);
  }

  if (typeof spec.source !== 'string' || spec.source.trim() === '') {
    errors.push(`${path}.source must be a non-empty string`);
  }
  if (spec.multi !== undefined && typeof spec.multi !== 'boolean') {
    errors.push(`${path}.multi must be a boolean when present`);
  }

  if (spec.derive !== undefined) {
    if (spec.derive !== 'band') {
      errors.push(`${path}.derive must be "band" when present`);
    } else {
      const cuts = spec.cuts;
      const labels = spec.labels;
      if (!Array.isArray(cuts) || cuts.length === 0 || !cuts.every(isFiniteNumber)) {
        errors.push(`${path}.cuts must be a non-empty array of finite numbers when derive is "band"`);
      } else if (!cuts.every((c, j) => j === 0 || (c as number) > (cuts[j - 1] as number))) {
        errors.push(`${path}.cuts must be strictly ascending`);
      }
      if (!Array.isArray(labels) || !labels.every((l) => typeof l === 'string' && l !== '')) {
        errors.push(`${path}.labels must be an array of non-empty strings when derive is "band"`);
      } else if (Array.isArray(cuts) && labels.length !== cuts.length + 1) {
        errors.push(
          `${path}.labels must have exactly one more entry than cuts ` +
          `(${cuts.length} cuts need ${cuts.length + 1} labels, got ${labels.length})`,
        );
      }
    }
  } else if (spec.cuts !== undefined || spec.labels !== undefined) {
    errors.push(`${path}: cuts/labels are only meaningful with derive: "band"`);
  }

  // Per-dimension overrides obey the same bounds as the globals they replace.
  if (spec.tauMs !== undefined) checkNumber(errors, `${path}.tauMs`, spec.tauMs, { min: 0, max: MAX_TAU_MS, exclusiveMin: true });
  if (spec.K !== undefined) checkNumber(errors, `${path}.K`, spec.K, { min: 0, max: 1e6, exclusiveMin: true });
  if (spec.thetaIn !== undefined) checkNumber(errors, `${path}.thetaIn`, spec.thetaIn, { min: 0, max: 1, exclusiveMin: true });
  if (spec.thetaOut !== undefined) checkNumber(errors, `${path}.thetaOut`, spec.thetaOut, { min: 0, max: 1 });

  // The effective pair is what the engine actually applies: an override falls
  // back to the global. A dimension that overrides only one side can still
  // invert the band against the other, which is the subtle way this goes wrong.
  // Only reported when this dimension overrides a threshold — otherwise a single
  // broken global would repeat itself once per dimension, and the one error a
  // merchandiser has to act on would be buried in copies of itself.
  if (spec.thetaIn !== undefined || spec.thetaOut !== undefined) {
    checkHysteresis(
      errors, path,
      spec.thetaIn !== undefined ? spec.thetaIn : global.thetaIn,
      spec.thetaOut !== undefined ? spec.thetaOut : global.thetaOut,
    );
  }
}

/**
 * Total validation of an untrusted candidate. Returns every error, not the
 * first: a merchandiser fixing a form should see the whole list once.
 */
export function validateReflexConfig(candidate: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return { ok: false, errors: ['config must be a JSON object'] };
  }
  const c = candidate as Record<string, unknown>;

  if (typeof c.version !== 'string' || c.version.trim() === '') {
    errors.push('version must be a non-empty string');
  } else if (c.version.length > 120) {
    errors.push('version must be at most 120 characters');
  }

  checkNumber(errors, 'tauMs', c.tauMs, { min: 0, max: MAX_TAU_MS, exclusiveMin: true });
  checkNumber(errors, 'K', c.K, { min: 0, max: 1e6, exclusiveMin: true });
  checkNumber(errors, 'thetaIn', c.thetaIn, { min: 0, max: 1, exclusiveMin: true });
  checkNumber(errors, 'thetaOut', c.thetaOut, { min: 0, max: 1 });
  checkNumber(errors, 'epsilon', c.epsilon, { min: 0, max: 1, exclusiveMin: true });
  checkNumber(errors, 'maxValuesPerDim', c.maxValuesPerDim, { min: 1, max: 1000, integer: true });
  checkHysteresis(errors, 'config', c.thetaIn, c.thetaOut);

  if (!Array.isArray(c.dimensions)) {
    errors.push('dimensions must be an array');
  } else if (c.dimensions.length === 0) {
    errors.push('dimensions must not be empty; an engine with no dimensions scores nothing');
  } else if (c.dimensions.length > MAX_DIMENSIONS) {
    errors.push(`dimensions must have at most ${MAX_DIMENSIONS} entries (got ${c.dimensions.length})`);
  } else {
    const seen = new Set<string>();
    const globalish = c as unknown as ReflexConfig;
    c.dimensions.forEach((d, i) => validateDimension(errors, d, i, seen, globalish));
  }

  if (typeof c.weights !== 'object' || c.weights === null || Array.isArray(c.weights)) {
    errors.push('weights must be a JSON object mapping action name to number');
  } else {
    const entries = Object.entries(c.weights as Record<string, unknown>);
    if (entries.length > MAX_WEIGHTS) {
      errors.push(`weights must have at most ${MAX_WEIGHTS} entries (got ${entries.length})`);
    }
    for (const [action, w] of entries) {
      if (RESERVED_KEYS.has(action)) { errors.push(`weights."${action}" is a reserved key`); continue; }
      if (action.trim() === '') { errors.push('weights has an empty action name'); continue; }
      checkNumber(errors, `weights.${action}`, w, { min: 0, max: 1000 });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, config: deepFreeze(structuredCopy(c)) as unknown as ReflexConfig };
}

// ── Version stamping ─────────────────────────────────────────────────────────

const REVISION_SUFFIX = /\+r\d+$/;

/** 'reflex-demo-v1' + revision 3 → 'reflex-demo-v1+r3'. Re-stamping replaces. */
export function stampVersion(baseVersion: string, revision: number): string {
  return `${baseVersion.replace(REVISION_SUFFIX, '')}+r${revision}`;
}

// -- The reflex kind -------------------------------------------------------
//
// Everything below is a thin binding over @/config/versionedStore. Versioning,
// attribution, the audit index, rollback, the isolate cache and the failure
// posture are inherited; what is specific to ReflexConfig is the validator above,
// the version stamp, and the dimension-aware merge.
//
// The generic store exists because doc 22 needs four more versioned documents
// (lift, prior, policy, and the per-slot learning catalog in its section 13) and
// says of all of them only that they are "versioned with change history" without
// naming a mechanism. This is the mechanism. Phase 0 onwards should add a
// DocumentKind rather than a second store.

export const REFLEX_KIND: store.DocumentKind<ReflexConfig> = {
  name: 'reflex',
  validate(candidate) {
    const r = validateReflexConfig(candidate);
    return r.ok ? { ok: true, value: r.config } : { ok: false, errors: r.errors };
  },
  stamp: (value, revision) =>
    deepFreeze({ ...structuredCopy(value), version: stampVersion(value.version, revision) }) as ReflexConfig,
  versionOf: (value) => value.version,
  applyPatch: (base, p) => applyPatch(base, (p ?? {}) as ReflexConfigPatch),
};

/** Drop cached configs. Called on every write; exported for tests. */
export function invalidateConfigCache(scope?: ConfigScope): void {
  store.invalidateCache(REFLEX_KIND.name, scope);
}

const asConfigRevision = (r: store.Revision<ReflexConfig> | null): ConfigRevision | null =>
  r === null ? null : { revision: r.revision, config: r.value, actor: r.actor, note: r.note, at: r.at };

const asWriteResult = (r: store.WriteResult<ReflexConfig>): WriteResult =>
  r.ok ? { ok: true, revision: asConfigRevision(r.revision) as ConfigRevision } : r;

/**
 * The stored revision for a scope, or null when nothing is stored or what is
 * stored cannot be trusted. Never throws.
 */
export async function readReflexConfigRevision(
  env: Env, scope: ConfigScope = DEFAULT_SCOPE, nowMs: number = Date.now(),
): Promise<ConfigRevision | null> {
  return asConfigRevision(await store.readRevision(env, REFLEX_KIND, scope, nowMs));
}

/**
 * The config the engine should score with. Falls back to DEFAULT_REFLEX_CONFIG
 * BY IDENTITY, which is what callers holding the constant already compare against.
 */
export async function readReflexConfig(
  env: Env, scope: ConfigScope = DEFAULT_SCOPE, nowMs: number = Date.now(),
): Promise<ReflexConfig> {
  return store.read(env, REFLEX_KIND, scope, DEFAULT_REFLEX_CONFIG, nowMs);
}

/** A specific historical revision, for diffing, replay and rollback. */
export async function readReflexConfigVersion(
  env: Env, scope: ConfigScope, revision: number,
): Promise<ConfigRevision | null> {
  return asConfigRevision(await store.readVersion(env, REFLEX_KIND, scope, revision));
}

export async function readConfigIndex(
  env: Env, scope: ConfigScope = DEFAULT_SCOPE,
): Promise<ConfigIndexEntry[]> {
  return store.readIndex(env, REFLEX_KIND, scope);
}

export interface WriteMeta {
  actor: string;
  note?: string;
  nowMs?: number;
}

/** Validate, version, store, audit. */
export async function writeReflexConfig(
  env: Env, scope: ConfigScope, candidate: unknown, meta: WriteMeta,
): Promise<WriteResult> {
  return asWriteResult(await store.write(env, REFLEX_KIND, scope, candidate, meta));
}

/**
 * A partial tune: the shape the tuning surface posts when one slider moves.
 * Dimension patches merge BY KEY rather than replacing the array, so adjusting
 * one dimension's tau cannot silently drop the others.
 */
export interface ReflexConfigPatch {
  version?: string;
  tauMs?: number;
  K?: number;
  thetaIn?: number;
  thetaOut?: number;
  epsilon?: number;
  maxValuesPerDim?: number;
  weights?: Record<string, number>;
  dimensions?: Array<Partial<DimensionSpec> & { key: string }>;
}

/**
 * Apply a patch to a base config. Pure; the caller validates the result.
 *
 * Named fields rather than a blind deep merge, because `dimensions` is an array
 * whose identity is a key, not a position: a generic merge would replace it
 * wholesale and drop every dimension the patch did not mention. Unknown fields
 * are carried through untouched by the copy, so a document that grows a field
 * this build does not know about survives a round trip.
 */
export function applyPatch(base: ReflexConfig, patch: ReflexConfigPatch): ReflexConfig {
  const next = structuredCopy(base) as ReflexConfig;

  for (const field of ['version', 'tauMs', 'K', 'thetaIn', 'thetaOut', 'epsilon', 'maxValuesPerDim'] as const) {
    if (patch[field] !== undefined) (next as unknown as Record<string, unknown>)[field] = patch[field];
  }
  if (patch.weights) next.weights = { ...next.weights, ...patch.weights };

  if (patch.dimensions) {
    for (const dp of patch.dimensions) {
      if (!dp || typeof dp.key !== 'string') continue;
      const i = next.dimensions.findIndex((d) => d.key === dp.key);
      if (i >= 0) next.dimensions[i] = { ...next.dimensions[i], ...dp };
      else next.dimensions.push(dp as DimensionSpec);
    }
  }
  return next;
}

/** Read current, merge the patch, write. The tuning surface's one call. */
export async function patchReflexConfig(
  env: Env, scope: ConfigScope, patch: ReflexConfigPatch, meta: WriteMeta,
): Promise<WriteResult> {
  return asWriteResult(
    await store.patch(env, REFLEX_KIND, scope, DEFAULT_REFLEX_CONFIG, patch, meta),
  );
}

/**
 * Roll back by writing the old body forward as a NEW revision. The counter never
 * rewinds, so the audit records that a rollback happened rather than erasing the
 * revisions it undid.
 */
export async function rollbackReflexConfig(
  env: Env, scope: ConfigScope, toRevision: number, meta: WriteMeta,
): Promise<WriteResult> {
  return asWriteResult(await store.rollback(env, REFLEX_KIND, scope, toRevision, meta));
}
