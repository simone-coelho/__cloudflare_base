// src/routes/demoBootstrap.ts
// ─────────────────────────────────────────────────────────────────────────────
// DEMO SCOPE BOOTSTRAP — the one door that creates a configuration publication
// set for a demo tenant that has none.
//
// WHY THIS EXISTS. Every configuration read and write goes through one
// explicitly initialized R2 publication set (docs/kit/02-api-reference.md §530).
// There is no compiled-default or legacy-KV fallback, and no HTTP endpoint
// initializes configuration, so a brand-new scope answers
// "Coherent configuration publication is uninitialized" to everything — reads
// included. `initializePublicationSet` is the library capability that creates
// one, and until now it had no caller outside the test suite. Safe desired-state
// provisioning for CUSTOMER stamps is still remediation item W08 and decision
// D01; this route does not touch that and must never become that.
//
// WHAT KEEPS IT SAFE, in the order the request meets them:
//
//   1. It is not mounted at all on the customer deployment profile.
//   2. It refuses unless ENVIRONMENT is development and AUTH_MODE is not
//      enforced-on-a-customer-stamp — it is a local and demo-stamp facility.
//   3. It takes the same operator credential and per-tenant grant every other
//      configuration write takes.
//   4. IT CANNOT OVERWRITE ANYTHING. If the scope already has a head, it
//      refuses with 409 and changes nothing. Creation only, once, ever. Every
//      later change goes through /content and /config like anyone else's.
//   5. Every document it seeds is validated by its own DocumentKind first, so
//      an invalid baseline is refused before a set exists rather than after.
//
// It is deliberately boring: four documents, one intent, no inference. The
// caller supplies every member; nothing is discovered, defaulted or migrated.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono';
import type { Env } from '@/types/env';
import type { AuthContext } from '@/middleware/auth';
import { operatorJwt } from '@/middleware/operatorAuth';
import { isValidTenantId, type TenantVariables } from '@/tenancy/tenant';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { REFLEX_KIND, reflexScopeForTenant, invalidateConfigCache } from '@/reflex/configStore';
import { initializePublicationSet, readPublication, PublicationError, type PublicationBaseline } from '@/config/publication';

type Ctx = { Bindings: Env; Variables: TenantVariables & { auth: AuthContext } };
export const demoBootstrapRoutes = new Hono<Ctx>();

/** The four documents a scope needs before the decision service can answer. */
const MEMBERS = ['reflex', 'catalog', 'slots', 'learn'] as const;
type Member = (typeof MEMBERS)[number];

demoBootstrapRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  return operatorJwt()(c, next);
});

/**
 * Already-initialized detection, by the same read every serving path uses. A
 * scope that answers anything at all is off limits to this route.
 */
async function alreadyInitialized(env: Env, scope: string): Promise<boolean> {
  try {
    await readPublication(env, CONTENT_KIND, scope);
    return true;
  } catch (error) {
    if (error instanceof PublicationError && error.code === 'publication_uninitialized') return false;
    throw error;
  }
}

demoBootstrapRoutes.post('/', async (c) => {
  if (c.env.DEPLOYMENT_PROFILE === 'customer') return c.json({ ok: false, error: 'Not available' }, 404);
  if (c.env.ENVIRONMENT !== 'development') {
    return c.json({ ok: false, error: 'Demo scope bootstrap is a development facility' }, 403);
  }

  const scope = c.get('tenant');
  if (!isValidTenantId(scope)) return c.json({ ok: false, error: 'Invalid scope' }, 400);

  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; }
  catch { return c.json({ ok: false, error: 'A JSON body with reflex, catalog, slots and learn is required' }, 400); }

  const missing = MEMBERS.filter((m) => !body[m] || typeof body[m] !== 'object');
  if (missing.length) {
    return c.json({ ok: false, error: `Supply every member in one intent; missing: ${missing.join(', ')}` }, 422);
  }

  // Validate before anything is created, so a bad baseline never becomes a set.
  const kinds: Record<Member, { kind: PublicationBaseline['kind']; scope: string }> = {
    reflex: { kind: REFLEX_KIND as PublicationBaseline['kind'], scope: reflexScopeForTenant(scope) },
    catalog: { kind: CONTENT_KIND as PublicationBaseline['kind'], scope },
    slots: { kind: SLOTS_KIND as PublicationBaseline['kind'], scope },
    learn: { kind: LEARN_KIND as PublicationBaseline['kind'], scope },
  };
  const errors: Record<string, unknown> = {};
  for (const member of MEMBERS) {
    const result = kinds[member].kind.validate(body[member]);
    if (!result.ok) errors[member] = result.errors;
  }
  if (Object.keys(errors).length) return c.json({ ok: false, error: 'Invalid baseline configuration', errors }, 422);

  if (await alreadyInitialized(c.env, scope)) {
    return c.json({ ok: false, error: `Scope "${scope}" already has a publication set; change it through /content and /config`, code: 'already_initialized' }, 409);
  }

  const actor = c.get('auth')?.user?.email || c.get('auth')?.user?.sub || 'demo-bootstrap';
  const at = Date.now();
  const baselines: PublicationBaseline[] = MEMBERS.map((member) => ({
    kind: kinds[member].kind,
    scope: kinds[member].scope,
    revision: { revision: 1, value: body[member], actor, note: `demo scope bootstrap: ${member}`, at },
  }));

  try {
    const pin = await initializePublicationSet(c.env, baselines, `0:${crypto.randomUUID()}`);
    invalidateConfigCache(reflexScopeForTenant(scope));
    return c.json({ ok: true, scope, members: MEMBERS, publication: pin });
  } catch (error) {
    if (error instanceof PublicationError) return c.json({ ok: false, error: error.message, code: error.code }, error.status);
    throw error;
  }
});
