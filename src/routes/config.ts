// src/routes/config.ts
// ─────────────────────────────────────────────────────────────────────────────
// CW0's surface: the read/write API over the versioned reflex config store.
// This is what makes §1.4 ("weights, decay horizons and thresholds are versioned
// configuration, effective immediately with no deployment") operable, and it is
// what the tuning UI (CW9) drives — the UI is a client of these routes, never a
// second path into KV.
//
// READS ARE OPEN, WRITES ARE AUTHENTICATED. A write here retunes decisioning for
// every shopper on the scope, so it fails closed: with no verifiable token the
// route 401s rather than falling back to an unauthenticated path. That is
// deliberately stricter than the operator routes next door, which CW10 still has
// to bring up to the same line.
//
// Every mutation is validated before it is stored, versioned, attributed to an
// actor, and appended to a browsable audit index. Nothing here can put a config
// on the decision path that validateReflexConfig would reject.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono';
import type { Env } from '@/types/env';
import { jwt, type AuthContext } from '@/middleware/auth';
import {
  DEFAULT_SCOPE,
  applyPatch,
  patchReflexConfig,
  readConfigIndex,
  compiledDefaultFor,
  configWarnings,
  readReflexConfig,
  readReflexConfigRevision,
  readReflexConfigVersion,
  rollbackReflexConfig,
  validateReflexConfig,
  writeReflexConfig,
  type ConfigScope,
  type ReflexConfigPatch,
} from '@/reflex/configStore';

type Ctx = { Bindings: Env; Variables: { auth: AuthContext } };

export const configRoutes = new Hono<Ctx>();

/** Scope comes from ?scope=; CW1 will resolve it from the tenant instead. */
function scopeOf(c: { req: { query: (k: string) => string | undefined } }): ConfigScope {
  const raw = (c.req.query('scope') ?? '').trim();
  if (raw === '') return DEFAULT_SCOPE;
  // Scope is part of a KV key. Keep it to a shape that cannot escape the prefix.
  return /^[a-z0-9][a-z0-9:_-]{0,63}$/i.test(raw) ? raw : DEFAULT_SCOPE;
}

function actorOf(c: { get: (k: 'auth') => AuthContext | undefined }): string {
  return c.get('auth')?.user?.sub ?? c.get('auth')?.user?.email ?? 'unknown';
}

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * The config in force. `source` tells the caller whether they are looking at
 * stored tuning or the compiled default, which is the first question anyone
 * debugging "why didn't my change take effect" actually has.
 */
configRoutes.get('/reflex', async (c) => {
  const scope = scopeOf(c);
  const revision = await readReflexConfigRevision(c.env, scope);
  const config = revision ? revision.config : await readReflexConfig(c.env, scope);
  return c.json({
    scope,
    source: revision ? 'stored' : 'compiled-default',
    revision: revision?.revision ?? 0,
    actor: revision?.actor ?? null,
    note: revision?.note ?? null,
    at: revision?.at ?? null,
    // The EFFECTIVE config: weights the stored document omits are filled from
    // the compiled default and named in `inherited`; a dimension the default has
    // and the document lacks is never added, only named in `warnings`.
    config,
    inherited: revision?.inherited ?? [],
    warnings: revision ? configWarnings(revision.config, await compiledDefaultFor(scope)) : [],
  });
});

configRoutes.get('/reflex/history', async (c) => {
  const scope = scopeOf(c);
  return c.json({ scope, revisions: await readConfigIndex(c.env, scope) });
});

configRoutes.get('/reflex/revisions/:n', async (c) => {
  const scope = scopeOf(c);
  const n = Number(c.req.param('n'));
  if (!Number.isInteger(n) || n < 1) return c.json({ error: 'revision must be a positive integer' }, 400);
  const revision = await readReflexConfigVersion(c.env, scope, n);
  if (!revision) return c.json({ error: `revision ${n} not found for scope "${scope}"` }, 404);
  return c.json({ scope, ...revision });
});

/**
 * Dry run. Open, because it writes nothing and because a form that can only tell
 * you a value is wrong AFTER you commit it is a form people learn to distrust.
 */
configRoutes.post('/reflex/validate', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (body === null) return c.json({ error: 'body must be JSON' }, 400);
  const patch = (body as { patch?: ReflexConfigPatch }).patch;
  const candidate = patch
    ? applyPatch(await readReflexConfig(c.env, scopeOf(c)), patch)
    : (body as { config?: unknown }).config ?? body;
  const result = validateReflexConfig(candidate);
  return result.ok
    ? c.json({ valid: true, config: result.config, warnings: configWarnings(result.config, await compiledDefaultFor(scopeOf(c))) })
    : c.json({ valid: false, errors: result.errors }, 422);
});

// ── Writes ───────────────────────────────────────────────────────────────────

configRoutes.use('/reflex', async (c, next) => {
  if (c.req.method === 'GET') return next();
  return jwt({ required: true })(c, next);
});
configRoutes.use('/reflex/rollback/*', jwt({ required: true }));

/** Full replace. The whole document, validated as a whole. */
configRoutes.put('/reflex', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (body === null) return c.json({ error: 'body must be JSON' }, 400);
  const { config, note } = body as { config?: unknown; note?: string };
  const result = await writeReflexConfig(c.env, scopeOf(c), config ?? body, {
    actor: actorOf(c),
    note: typeof note === 'string' ? note.slice(0, 500) : '',
  });
  return result.ok
    ? c.json({ ok: true, revision: result.revision.revision, version: result.revision.config.version, config: result.revision.config,
               inherited: result.revision.inherited, warnings: configWarnings(result.revision.config, await compiledDefaultFor(scopeOf(c))) })
    : c.json({ ok: false, errors: result.errors }, 422);
});

/**
 * Partial tune — one slider, one call. The merged result is validated as a whole,
 * so a patch cannot sneak past an invariant by only touching one side of it.
 */
configRoutes.patch('/reflex', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (body === null) return c.json({ error: 'body must be JSON' }, 400);
  const { patch, note } = body as { patch?: ReflexConfigPatch; note?: string };
  const result = await patchReflexConfig(c.env, scopeOf(c), (patch ?? body) as ReflexConfigPatch, {
    actor: actorOf(c),
    note: typeof note === 'string' ? note.slice(0, 500) : '',
  });
  return result.ok
    ? c.json({ ok: true, revision: result.revision.revision, version: result.revision.config.version, config: result.revision.config,
               inherited: result.revision.inherited, warnings: configWarnings(result.revision.config, await compiledDefaultFor(scopeOf(c))) })
    : c.json({ ok: false, errors: result.errors }, 422);
});

/** Roll forward to an old body. The revision counter never rewinds. */
configRoutes.post('/reflex/rollback/:n', async (c) => {
  const n = Number(c.req.param('n'));
  if (!Number.isInteger(n) || n < 1) return c.json({ error: 'revision must be a positive integer' }, 400);
  const body = await c.req.json().catch(() => ({}));
  const note = (body as { note?: string })?.note;
  const result = await rollbackReflexConfig(c.env, scopeOf(c), n, {
    actor: actorOf(c),
    note: typeof note === 'string' ? note.slice(0, 500) : undefined,
  });
  return result.ok
    ? c.json({ ok: true, revision: result.revision.revision, version: result.revision.config.version })
    : c.json({ ok: false, errors: result.errors }, 404);
});

export default configRoutes;
