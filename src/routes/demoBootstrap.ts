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
//
// P48 (R-P78, decision D1): beside the four, the set gets the two members a
// tenant needs to read and publish its imported priors and its proposals,
// `priors` = EMPTY_PRIORS and `proposals` = EMPTY_PROPOSALS at revision 1, the
// compiled empties init-local and the W08 door write ("no imported prior, no
// proposal"), so the caller still supplies every member that carries a
// decision. A scope created with four before that has one path to the same
// set, `POST /ops/demo-bootstrap/complete`: once, the two compiled empties it
// lacks and nothing else, under the same guards, credential and grant.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono';
import type { Env } from '@/types/env';
import type { AuthContext } from '@/middleware/auth';
import { operatorJwt } from '@/middleware/operatorAuth';
import { isValidTenantId, type TenantVariables } from '@/tenancy/tenant';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { REFLEX_KIND, reflexScopeForTenant, invalidateConfigCache } from '@/reflex/configStore';
import { completePublicationSet, initializePublicationSet, readPublication, PublicationError, type PublicationBaseline } from '@/config/publication';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import { EMPTY_PROPOSALS, PROPOSALS_KIND } from '@/learn/cycle';

type Ctx = { Bindings: Env; Variables: TenantVariables & { auth: AuthContext } };
export const demoBootstrapRoutes = new Hono<Ctx>();

/** The four documents a scope needs before the decision service can answer. */
const MEMBERS = ['reflex', 'catalog', 'slots', 'learn'] as const;
type Member = (typeof MEMBERS)[number];
/** P48: the two members the door seeds as their compiled empties; a body never supplies them. */
const SEEDED = ['priors', 'proposals'] as const;
const SET_MEMBERS = [...MEMBERS, ...SEEDED];

/** The facility's two guards: never on the customer profile, only in development. */
function facilityRefusal(env: Env): { body: { ok: false; error: string }; status: 403 | 404 } | null {
  if (env.DEPLOYMENT_PROFILE === 'customer') return { body: { ok: false, error: 'Not available' }, status: 404 };
  if (env.ENVIRONMENT !== 'development') return { body: { ok: false, error: 'Demo scope bootstrap is a development facility' }, status: 403 };
  return null;
}

/**
 * P48 (R-P83 and its addenda): the one-time path answers its two guards before
 * the credential middleware below, which then takes the operator credential and
 * the per-tenant grant for it exactly as for the door, before its handler reads
 * anything. A customer stamp's boundary answers 404 here before any of it.
 */
demoBootstrapRoutes.use('/complete', async (c, next) => {
  const refused = facilityRefusal(c.env);
  if (refused) { c.header('Cache-Control', 'no-store'); return c.json(refused.body, refused.status); }
  return next();
});

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
  const refused = facilityRefusal(c.env);
  if (refused) return c.json(refused.body, refused.status);

  const scope = c.get('tenant');
  if (!isValidTenantId(scope)) return c.json({ ok: false, error: 'Invalid scope' }, 400);

  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; }
  catch { return c.json({ ok: false, error: 'A JSON body with reflex, catalog, slots and learn is required' }, 400); }

  const missing = MEMBERS.filter((m) => !body[m] || typeof body[m] !== 'object');
  if (missing.length) {
    return c.json({ ok: false, error: `Supply every member in one intent; missing: ${missing.join(', ')}` }, 422);
  }
  // P48: the door seeds these two itself; a document supplied for one is refused, never dropped in silence.
  const supplied = SEEDED.filter((m) => Object.hasOwn(body, m));
  if (supplied.length) {
    return c.json({ ok: false, error: `The demo bootstrap creates ${SEEDED.join(' and ')} as their compiled empties and accepts no document for them (supplied: ${supplied.join(', ')}); publish priors through PUT /content/priors once the set exists` }, 422);
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
  // P48: then the two compiled empties, in the same one initialization.
  baselines.push(
    { kind: PRIORS_KIND as PublicationBaseline['kind'], scope, revision: { revision: 1, value: EMPTY_PRIORS, actor, note: 'demo scope bootstrap: priors', at } },
    { kind: PROPOSALS_KIND as PublicationBaseline['kind'], scope, revision: { revision: 1, value: EMPTY_PROPOSALS, actor, note: 'demo scope bootstrap: proposals', at } },
  );

  try {
    const pin = await initializePublicationSet(c.env, baselines, `0:${crypto.randomUUID()}`);
    invalidateConfigCache(reflexScopeForTenant(scope));
    return c.json({ ok: true, scope, members: SET_MEMBERS, publication: pin });
  } catch (error) {
    if (error instanceof PublicationError) return c.json({ ok: false, error: error.message, code: error.code }, error.status);
    throw error;
  }
});

/**
 * P48: POST /ops/demo-bootstrap/complete — a scope the door created with four
 * members gets the two compiled empties it lacks, once, and nothing else
 * changes (src/config/publication.ts `completePublicationSet`). No document is
 * read. Its guards answer above, the credential and the grant in the
 * middleware; a set that has both answers `added: []` and writes nothing, and a
 * scope with no set is refused 503 `publication_uninitialized` (the door
 * creates it, with six).
 */
demoBootstrapRoutes.post('/complete', async (c) => {
  const scope = c.get('tenant');
  if (!isValidTenantId(scope)) return c.json({ ok: false, error: 'Invalid scope' }, 400);
  const actor = c.get('auth')?.user?.email || c.get('auth')?.user?.sub || 'demo-bootstrap';
  try {
    const { added, set } = await completePublicationSet(c.env, scope, { actor, note: 'demo scope bootstrap: complete' });
    return c.json({ added, members: SET_MEMBERS, ok: true, publication: set, scope });
  } catch (error) {
    if (error instanceof PublicationError) return c.json({ ok: false, error: error.message, code: error.code }, error.status);
    throw error;
  }
});
