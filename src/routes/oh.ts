// src/routes/oh.ts
// ──────────────────────────────────────────────────────
// The OH demo for LG (docs/lg/OH-Demo-Design.md): its merchandiser half, its receipts and
// its cold-start panel, for the `oh` tenant. Thin, by design: the routes and
// their safety model (absent off the demo profile, a closed list of beat names, a
// genuine 60-second operator token into the ordinary pipeline, receipts for the
// caller's own decisions only, the cold-start read in aggregate and never scored)
// live in the demo kit's factories, src/demos/kit/; OH's constants live in
// src/demos/oh.config.ts. Scaffolded by scripts/demo-kit/new-demo.mjs.
//
// One addition of OH's own (lane P3): the live sign-in of beat 15.
//
//   POST /sign-in  { account }   the caller's own browser linked to a fictional account
//
// A real site's backend knows who signed in, signs the claim with its identity
// secret, and the page carries the signature to the link (src/identity/assertion.ts).
// The demo has no backend of its own, so this route is that backend for a closed
// list of fictional accounts, and nothing more:
//
//   • It exists only where DEPLOYMENT_PROFILE is 'demo'. Elsewhere it is absent (404).
//   • The body is { account } and nothing else, and the account is a NAME from
//     OH_ACCOUNTS (src/demos/oh.config.ts). The account id it stands for is the
//     server's; no id, visitor or document crosses from the page.
//   • It links only the CALLER's own browser: the visitor is the subject of the
//     shopper capability she presents, on the demo's own tenant, and an already
//     recognised browser is refused, exactly as the link route refuses it.
//   • The assertion is minted here, with the worker's IDENTITY_SECRETS (the
//     tenant's current secret, through the identity code's own secretsFor and
//     signAssertion), for two minutes, and goes only into an in-process call to
//     the ordinary link route (POST /v1/oh/identity/link): the same verification,
//     the same merge, the same consent, the same session rotation as any site's
//     signed link. The secret and the assertion never leave the worker and are
//     never logged.
//   • The answer is { ok: true, linked: true, session }: success, the linked
//     flag, and the shopper session she carries from now on. The link retires her
//     anonymous session (her object forwards to the person, and refuses the old
//     capability), so the page must carry the recognised one, as the SDK's
//     identify() adopts it from the link route's own answer. No assertion, no
//     account id, no shopper id field, no audience list, nothing of the secret.
//
// Mounted in src/index.ts (the scaffold printed the lines; lane P3 applied them):
//   app.route('/oh/api', ohRoutes(async (request, env, ctx) => app.fetch(request, env, ctx)));
//   app.route('/oh/api/coldstart', ohColdStartRoutes);
// ──────────────────────────────────────────────────────

import { Hono } from 'hono';
import type { Env } from '@/types/env';
import type { TenantVariables } from '@/tenancy/tenant';
import { demoActionRoutes, type Dispatch } from '@/demos/kit/actionRoutes';
import { demoColdStartRoutes } from '@/demos/kit/coldStartRoutes';
import { isRecord } from '@/demos/kit/helpers';
import { capabilityToken, requireShopper, shopperPrincipal, SHOPPER_HEADER } from '@/identity/sessionCapability';
import { secretsFor, signAssertion } from '@/identity/assertion';
import { OH_ACCOUNTS, OH_ACTIONS, OH_COLD_START, OH_TENANT } from '@/demos/oh.config';

export { OH_TENANT, OH_BEATS, OH_RESET, OH_REPORT_SLOTS, OH_ACCOUNTS } from '@/demos/oh.config';

type Ctx = { Bindings: Env; Variables: TenantVariables };

/** Long enough for the one in-process link, short enough to be useless anywhere else. */
export const SIGN_IN_ASSERTION_TTL_SECONDS = 120;

/**
 * The account id a demo account name stands for: the server's, derived from the
 * name alone, so the same fictional person is the same person on every device.
 * Fictional, never a real customer's identifier.
 */
export function ohAccountId(name: string): string {
  return `oh-demo-${name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
}

/** The closed list, copied and frozen when the module loads: name → account id. */
const ACCOUNTS: ReadonlyMap<string, string> = new Map(OH_ACCOUNTS.map((name) => [name, ohAccountId(name)]));

/** The live sign-in (beat 15), re-entering the worker's own app through `dispatch`. */
export function ohSignInRoutes(dispatch: Dispatch) {
  if (typeof dispatch !== 'function') throw new Error('ohSignInRoutes: dispatch must re-enter the worker’s own app');
  const routes = new Hono<Ctx>();

  // Absent, not merely refused, off the demo profile.
  routes.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    if (c.env.DEPLOYMENT_PROFILE !== 'demo') return c.json({ error: 'Not Found' }, 404);
    return next();
  });

  routes.post('/sign-in', requireShopper({ forward: false, bodyLimit: 1024 }), async (c) => {
    const principal = shopperPrincipal(c.req.raw);
    // Her session on another demo's tenant is not a session here.
    if (principal.tenant !== OH_TENANT) return c.json({ ok: false, error: 'not found' }, 404);
    const body = await c.req.json().catch(() => null) as unknown;
    if (!isRecord(body) || Object.keys(body).length !== 1 || typeof body.account !== 'string') {
      return c.json({ ok: false, error: 'the body is { account } and nothing else' }, 400);
    }
    const accountId = ACCOUNTS.get(body.account);
    if (accountId === undefined) {
      return c.json({ ok: false, error: `not a demo account; the demo accounts are ${OH_ACCOUNTS.join(', ')}` }, 400);
    }
    // The link refuses a browser that already carries a person (detach first); say so before minting anything.
    if (principal.kind !== 'anonymous') return c.json({ ok: false, error: 'this browser is already signed in' }, 409);
    const secret = secretsFor(c.env, OH_TENANT)[0];
    if (!secret) return c.json({ ok: false, error: 'identity verification is not configured on this worker' }, 503);

    const exp = Math.floor(Date.now() / 1000) + SIGN_IN_ASSERTION_TTL_SECONDS;
    const assertion = await signAssertion(secret, OH_TENANT, principal.subject, accountId, exp);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json', 'X-Tenant': OH_TENANT, [SHOPPER_HEADER]: capabilityToken(c.req.raw)!,
    };
    // The link route sits behind the site-key gate and reads the consent refusal cookies: hers, passed on as she sent them.
    const sdkKey = c.req.header('X-SDK-Key'), cookie = c.req.header('Cookie');
    if (sdkKey) headers['X-SDK-Key'] = sdkKey;
    if (cookie) headers.Cookie = cookie;
    const origin = new URL(c.req.url).origin;
    const linked = await dispatch(new Request(`${origin}/v1/${OH_TENANT}/identity/link`, {
      method: 'POST', headers, body: JSON.stringify({ visitorId: principal.subject, accountId, source: 'login', exp, assertion }),
    }), c.env, c.executionCtx);
    const out = await linked.json().catch(() => null) as { ok?: unknown; session?: unknown; error?: unknown } | null;
    const session = isRecord(out) ? out.session : null;
    if (!linked.ok || out?.ok !== true || !isRecord(session) || session.kind !== 'recognized' || typeof session.capability !== 'string') {
      // The link route's own refusal names the reason (expired, does not verify, not configured); it never carries proof.
      const why = isRecord(out) && typeof out.error === 'string' ? out.error.slice(0, 200) : `the link answered ${linked.status}`;
      return c.json({ ok: false, linked: false, error: `the sign-in was refused: ${why}` }, linked.status === 401 || linked.status === 409 ? linked.status : 502);
    }
    // The session cookies follow the person on this device, as the link route sets them for the SDK.
    // Headers iteration yields each Set-Cookie on its own (the Fetch standard), so no cookie is folded into another.
    for (const [name, value] of linked.headers) if (name.toLowerCase() === 'set-cookie') c.header('Set-Cookie', value, { append: true });
    return c.json({ ok: true, linked: true, session });
  });

  return routes;
}

/** The beat, reset, receipt and report routes, and the live sign-in, re-entering the worker's own app through `dispatch`. */
export function ohRoutes(dispatch: Dispatch) {
  const routes = new Hono<Ctx>();
  routes.route('/', ohSignInRoutes(dispatch));
  routes.route('/', demoActionRoutes({ ...OH_ACTIONS, dispatch }));
  return routes;
}

/** The cold-start panel and its seed door. */
export const ohColdStartRoutes = demoColdStartRoutes(OH_COLD_START);
