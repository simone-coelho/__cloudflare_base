// src/routes/config.ts
// ─────────────────────────────────────────────────────────────────────────────
// CW0's surface: the read/write API over the versioned reflex config store.
// This is what makes §1.4 ("weights, decay horizons and thresholds are versioned
// configuration, effective immediately with no deployment") operable, and it is
// what the tuning UI (CW9) drives — the UI is a client of these routes, never a
// second path into KV.
//
// Administrative reads, validation and writes require an operator access token.
// Authentication precedes every handler, independently of AUTH_MODE. Enforced
// requests additionally bind explicit operator grants and storage to one tenant.
//
// Every mutation is validated before it is stored, versioned, attributed to an
// actor, and appended to a browsable audit index. Nothing here can put a config
// on the decision path that validateReflexConfig would reject.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono, type Context } from 'hono';
import { PublicationError, publicationMeta, publicationScope } from '@/config/publication';
import { LegacyDocumentError } from '@/config/versionedStore';
import { InputError, readInputJson } from '@/config/input';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '@/types/env';
import type { AuthContext } from '@/middleware/auth';
import { hasOperatorGrant, operatorJwt } from '@/middleware/operatorAuth';
import { isValidTenantId, type TenantVariables } from '@/tenancy/tenant';
import {
  reflexScopeForTenant,
  isDemoConfigScope,
  ReflexConfigUnavailableError,
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

type Ctx = { Bindings: Env; Variables: TenantVariables & { auth: AuthContext; reflexScope?: ConfigScope } };

export const configRoutes = new Hono<Ctx>();
configRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  return operatorJwt()(c, next);
});
configRoutes.use('*', async (c, next) => {
  const tenant = c.get('tenant'), user = c.get('auth')?.user;
  if (!user || !['access', 'service'].includes(user.type ?? '')) return c.json({ error: 'Typed operator credential required' }, 401);
  if (!isValidTenantId(tenant) || !hasOperatorGrant(c.env, user.sub, tenant, c.get('auth'))) return c.json({ error: 'Tenant scope unavailable' }, 403);
  const tenants = c.req.queries('tenant'), scopes = c.req.queries('scope');
  if (tenants && (tenants.length !== 1 || tenants[0] !== tenant) || scopes && scopes.length !== 1) return c.json({ error: 'Tenant scope unavailable' }, 403);
  const scope = scopes?.[0] ?? reflexScopeForTenant(tenant);
  if (publicationScope({ name: 'reflex' }, scope) !== tenant) return c.json({ error: 'Tenant scope unavailable' }, 403);
  c.set('reflexScope', scope); return next();
});
configRoutes.onError((error, c) => {
  if (error instanceof InputError) return c.json({ ok: false, error: error.message, code: error.code,
    ...(error.status === 413 ? { budget: error.budget, limit: error.limit, observed: error.observed } : {}) }, error.status);
  if (error instanceof PublicationError) return c.json({ ok: false, error: error.message, code: error.code }, error.status);
  if (error instanceof LegacyDocumentError) {
    c.header('Cache-Control', 'no-store');
    return c.json({ ok: false, error: error.message, code: error.code }, error.status);
  }
  if (error instanceof HTTPException) return error.getResponse();
  if (error instanceof ReflexConfigUnavailableError) return c.json({ error: error.message }, 503);
  return c.json({ error: 'Configuration operation failed' }, 500);
});

/** Validated once before handlers; malformed selectors never select a fallback. */
function scopeOf(c: { get: (key: 'reflexScope') => ConfigScope | undefined }): ConfigScope {
  return c.get('reflexScope')!;
}

const warningsFor = async (config: Parameters<typeof configWarnings>[0], scope: ConfigScope) =>
  configWarnings(config, isDemoConfigScope(scope) ? await compiledDefaultFor(scope) : null);

/**
 * Who made the change, for the revision's audit line. A person's name first,
 * then their email, then the token's subject: the history is read by people,
 * and "Local Ops changed the view weight" beats a UUID. Since 2026-09-05 the
 * operator signs in on the page, so the token carries a name.
 */
function actorOf(c: { get: (k: 'auth') => AuthContext | undefined }): string {
  const u = c.get('auth')?.user as { sub?: string; email?: string; name?: string } | undefined;
  return u?.sub || 'unknown';
}

const configMeta = (c: Context<Ctx>) => {
  const meta = publicationMeta(c.req.raw.headers, actorOf(c));
  meta.authorize = async () => {
    let allowed = false;
    await operatorJwt()(c, async () => {
      const user = c.get('auth').user;
      if (user?.sub !== meta.actor || !['access', 'service'].includes(user.type ?? '') || !Number.isSafeInteger(user.exp) || user.exp! * 1000 <= Date.now()
        || !hasOperatorGrant(c.env, user.sub, c.get('tenant'), c.get('auth'))) throw new PublicationError('Current operator authority required', 403, 'operator_required');
      allowed = true;
    });
    if (!allowed) throw new PublicationError('Current operator authority required', 403, 'operator_required');
  }; return meta;
};

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * The config in force. `source` tells the caller whether they are looking at
 * stored tuning or the compiled default, which is the first question anyone
 * debugging "why didn't my change take effect" actually has.
 */
configRoutes.get('/reflex', async (c) => {
  const scope = scopeOf(c);
  const revision = await readReflexConfigRevision(c.env, scope, Date.now(), undefined, true);
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
    authored: revision?.authored,
    publication: revision?.publication,
    inherited: revision?.inherited ?? [],
    warnings: revision ? await warningsFor(revision.config, scope) : [],
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
 * Authenticated dry run: a patch can disclose the stored configuration it merges.
 */
configRoutes.post('/reflex/validate', async (c) => {
  const body = await readInputJson(c.req.raw.body);
  if (body === null) return c.json({ error: 'body must be JSON' }, 400);
  const patch = (body as { patch?: ReflexConfigPatch }).patch;
  const candidate = patch
    ? applyPatch((await readReflexConfigRevision(c.env, scopeOf(c), Date.now(), undefined, true))!.authored, patch)
    : (body as { config?: unknown }).config ?? body;
  const result = validateReflexConfig(candidate);
  return result.ok
    ? c.json({ valid: true, config: result.config, warnings: await warningsFor(result.config, scopeOf(c)) })
    : c.json({ valid: false, errors: result.errors }, 422);
});

// ── Writes ───────────────────────────────────────────────────────────────────

/** Full replace. The whole document, validated as a whole. */
configRoutes.put('/reflex', async (c) => {
  const meta = configMeta(c);
  const body = await readInputJson(c.req.raw.body);
  if (body === null) return c.json({ error: 'body must be JSON' }, 400);
  const { config, note } = body as { config?: unknown; note?: string };
  const result = await writeReflexConfig(c.env, scopeOf(c), config ?? body, {
    ...meta,
    note: typeof note === 'string' ? note.slice(0, 500) : '',
  });
  return result.ok
    ? c.json({ ok: true, revision: result.revision.revision, publication: result.revision.publication, authored: result.revision.authored, version: result.revision.config.version, config: result.revision.config,
               inherited: result.revision.inherited, warnings: await warningsFor(result.revision.config, scopeOf(c)) })
    : c.json({ ok: false, errors: result.errors }, 422);
});

/**
 * Partial tune — one slider, one call. The merged result is validated as a whole,
 * so a patch cannot sneak past an invariant by only touching one side of it.
 */
configRoutes.patch('/reflex', async (c) => {
  const meta = configMeta(c);
  const body = await readInputJson(c.req.raw.body);
  if (body === null) return c.json({ error: 'body must be JSON' }, 400);
  const { patch, note } = body as { patch?: ReflexConfigPatch; note?: string };
  const result = await patchReflexConfig(c.env, scopeOf(c), (patch ?? body) as ReflexConfigPatch, {
    ...meta,
    note: typeof note === 'string' ? note.slice(0, 500) : '',
  });
  return result.ok
    ? c.json({ ok: true, revision: result.revision.revision, publication: result.revision.publication, authored: result.revision.authored, version: result.revision.config.version, config: result.revision.config,
               inherited: result.revision.inherited, warnings: await warningsFor(result.revision.config, scopeOf(c)) })
    : c.json({ ok: false, errors: result.errors }, 422);
});

/** Roll forward to an old body. The revision counter never rewinds. */
configRoutes.post('/reflex/rollback/:n', async (c) => {
  const meta = configMeta(c);
  const n = Number(c.req.param('n'));
  if (!Number.isInteger(n) || n < 1) return c.json({ error: 'revision must be a positive integer' }, 400);
  const body = await readInputJson(c.req.raw.body, {});
  const note = (body as { note?: string })?.note;
  const result = await rollbackReflexConfig(c.env, scopeOf(c), n, {
    ...meta,
    note: typeof note === 'string' ? note.slice(0, 500) : undefined,
  });
  return result.ok
    ? c.json({ ok: true, revision: result.revision.revision, publication: result.revision.publication, authored: result.revision.authored, version: result.revision.config.version })
    : c.json({ ok: false, errors: result.errors }, 404);
});

export default configRoutes;
