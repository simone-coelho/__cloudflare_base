// src/routes/topOffers.ts
// ──────────────────────────────────────────────────────
// The Lantern & Lane "Top Offers" demo (docs/qvc) — its merchandiser half.
//
// The page performs a merchandiser's day: a window closes, a promotion arrives,
// a creative is swapped, a weight is set, a piece is pinned, the slot takes two
// instead of four. Every one of those is a real versioned publish against the
// demo tenant, because the whole argument of the demo is that nothing is staged
// in the browser.
//
// A publish needs operator authority. Locally the seed writes a 12-hour token
// into public/top-offers/beats/ and the page picks it up — which is fine on
// loopback and unacceptable anywhere else, because `public/` is served
// wholesale (wrangler.toml [assets]) and a token in a static directory on a
// shared host is a credential anyone can fetch.
//
// So the credential stays in the worker. The page asks for a NAMED BEAT; this
// route applies it. Three things make that safe to expose without a login:
//
//   • It exists only where DEPLOYMENT_PROFILE is 'demo'. On a customer worker
//     the route is not mounted at all — not disabled, absent.
//   • It accepts a closed set of names and nothing else. There is no request
//     body that carries a document, so there is no payload to smuggle. The
//     worst an anonymous caller can do is move the demo tenant between states
//     the demo itself ships.
//   • It never fabricates authority. It mints a genuine short-lived operator
//     token and re-enters /content through the ordinary pipeline, so the same
//     grant check, tenant binding, validation and publication concurrency apply
//     as for any other operator. Supplying a permissive `authorize` to the
//     store directly would have been shorter and would have put a hole in the
//     authority model.
// ──────────────────────────────────────────────────────

import { Hono } from 'hono';
import { SignJWT } from 'jose';
import type { Env } from '@/types/env';

/** The demo's own tenant. Not configurable: this route exists for one demo. */
const TENANT = 'shn';

/**
 * The beat documents the page is allowed to ask for, by kind. These are the
 * files scripts/seed-shn.mjs writes into public/top-offers/beats/, and the list
 * is closed on purpose — it is the whole reason this route needs no login.
 */
const BEATS: Readonly<Record<string, readonly string[]>> = {
  catalog: ['catalog-1', 'catalog-clock', 'catalog-arrival', 'catalog-final', 'catalog-showcase', 'catalog-grown'],
  slots: ['slots-1', 'slots-promo', 'slots-pin', 'slots-take2'],
};

/** The subject the demo publishes as. TENANTS must grant it the demo tenant. */
const OPERATOR = 'top-offers-demo';

/** Long enough for one read-then-write handshake, short enough to be useless if it leaks. */
const TOKEN_TTL_SECONDS = 60;

type Dispatch = (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;
type Ctx = { Bindings: Env };

/** A note is attribution, not free text: it lands in the audit index. */
const noteOf = (value: unknown) =>
  (typeof value === 'string' ? value : '').replace(/[^\p{L}\p{N} .,:;'’—-]/gu, '').slice(0, 120);

/**
 * The operator credential, minted in the worker and never returned to anyone.
 * `type: 'service'` and the issuer/audience pair are what the operator
 * middleware verifies; the grant itself comes from TENANTS, not from here.
 */
async function mintOperatorToken(env: Env): Promise<string> {
  const key = new TextEncoder().encode(env.JWT_SECRET);
  return new SignJWT({ sub: OPERATOR, roles: ['operator'], type: 'service' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(key);
}

export function topOffersRoutes(dispatch: Dispatch) {
  const routes = new Hono<Ctx>();

  // Absent, not merely refused, off the demo profile.
  routes.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    if (c.env.DEPLOYMENT_PROFILE !== 'demo') return c.json({ error: 'Not Found' }, 404);
    return next();
  });

  routes.post('/beat', async (c) => {
    const body = await c.req.json().catch(() => null) as { kind?: unknown; name?: unknown; note?: unknown } | null;
    if (!body) return c.json({ ok: false, error: 'body must be JSON' }, 400);

    const kind = typeof body.kind === 'string' ? body.kind : '';
    const name = typeof body.name === 'string' ? body.name : '';
    const allowed = BEATS[kind];
    if (!allowed) return c.json({ ok: false, error: 'kind must be catalog or slots' }, 400);
    if (!allowed.includes(name)) return c.json({ ok: false, error: 'unknown beat' }, 400);

    if (!c.env.JWT_SECRET || !c.env.JWT_ISSUER || !c.env.JWT_AUDIENCE) {
      return c.json({ ok: false, error: 'the demo tenant is not provisioned on this worker' }, 503);
    }

    // The document comes from the worker's own static assets, which is the same
    // file the page would have read — so the demo has exactly one source of
    // truth for what a beat means, and the browser cannot substitute another.
    const origin = new URL(c.req.url).origin;
    const asset = await c.env.ASSETS.fetch(new Request(`${origin}/top-offers/beats/${name}.json`));
    if (!asset.ok) return c.json({ ok: false, error: `${name}.json is missing — run scripts/seed-shn.mjs` }, 503);
    const document = await asset.json().catch(() => null);
    if (!document) return c.json({ ok: false, error: `${name}.json is not JSON` }, 503);

    const token = await mintOperatorToken(c.env);
    const auth = { Authorization: `Bearer ${token}`, 'X-Tenant': TENANT };
    const url = `${origin}/content/${kind}?scope=${TENANT}`;

    // Read the base first: a versioned publish is conditional on the revision
    // and publication digest it was authored against, exactly as the operator
    // console does it. This is an in-process dispatch, not a network call.
    const read = await dispatch(new Request(url, { headers: auth }), c.env, c.executionCtx);
    if (read.status === 401 || read.status === 403) {
      return c.json({ ok: false, error: `the demo operator has no grant on "${TENANT}"` }, 503);
    }
    const base = await read.json().catch(() => null) as
      { revision?: number; publication?: { revision: number; digest: string } } | null;
    if (!read.ok || !base?.publication) {
      return c.json({ ok: false, error: `no publication base for ${kind} — run /ops/demo-bootstrap` }, 503);
    }

    const write = await dispatch(new Request(url, {
      method: 'PUT',
      headers: {
        ...auth,
        'content-type': 'application/json',
        'If-Match': `"${base.revision}/${base.publication.revision}/${base.publication.digest}"`,
        'Idempotency-Key': `${base.revision}:${crypto.randomUUID()}`,
      },
      body: JSON.stringify({ document, note: noteOf(body.note) }),
    }), c.env, c.executionCtx);

    const result = await write.json().catch(() => null) as { ok?: boolean; revision?: number; error?: string } | null;
    if (!write.ok || result?.ok !== true) {
      return c.json({ ok: false, error: result?.error ?? `publishing ${kind} failed` }, 502);
    }
    return c.json({ ok: true, kind, name, revision: result.revision });
  });

  /**
   * The day report (beat 15). Reading the ledger is an operator read like any
   * other, so it goes the same way: minted authority, ordinary pipeline, and
   * nothing but a date and a slot crossing the wire from the browser.
   */
  routes.post('/report', async (c) => {
    const body = await c.req.json().catch(() => null) as { date?: unknown; slot?: unknown; build?: unknown } | null;
    const date = typeof body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : '';
    const slot = typeof body?.slot === 'string' && /^[a-z0-9-]{1,40}$/.test(body.slot) ? body.slot : '';
    if (!date || !slot) return c.json({ ok: false, error: 'date (YYYY-MM-DD) and slot are required' }, 400);
    if (!c.env.JWT_SECRET || !c.env.JWT_ISSUER || !c.env.JWT_AUDIENCE) {
      return c.json({ ok: false, error: 'the demo tenant is not provisioned on this worker' }, 503);
    }

    const origin = new URL(c.req.url).origin;
    const token = await mintOperatorToken(c.env);
    const auth = { Authorization: `Bearer ${token}`, 'X-Tenant': TENANT };

    if (body?.build === true) {
      const made = await dispatch(new Request(`${origin}/v1/${TENANT}/learn/report`, {
        method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ date }),
      }), c.env, c.executionCtx);
      if (!made.ok) return c.json({ ok: false, error: `the report could not be built (${made.status})` }, 502);
    }

    const read = await dispatch(new Request(
      `${origin}/v1/${TENANT}/learn/report?date=${date}&slot=${slot}`, { headers: auth },
    ), c.env, c.executionCtx);
    const result = await read.json().catch(() => null) as { report?: unknown; error?: string } | null;
    if (!read.ok || !result?.report) return c.json({ ok: false, error: result?.error ?? `no report for ${date}` }, 502);
    return c.json({ ok: true, report: result.report });
  });

  return routes;
}
