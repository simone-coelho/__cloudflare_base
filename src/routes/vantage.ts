// src/routes/vantage.ts
// ──────────────────────────────────────────────────────
// The Vantage carrier demo (docs/verizon): its merchandiser half and its
// receipts. A fork of src/routes/topOffers.ts, for the `vantage` tenant.
//
// The page performs a merchandiser's day (two weeks pass, Black Friday arrives,
// the iPhone Duo pre-order is pinned) and shows why every decision came back
// the way it did. Every merchandiser press is a real versioned publish against
// the demo tenant, and every "why these" is the decision's own ledger record,
// because the argument of the demo is that nothing is staged in the browser.
//
// Both need operator authority, and `public/` is served wholesale, so the
// credential stays in the worker. What makes these actions safe to expose
// without a login:
//
//   • They exist only where DEPLOYMENT_PROFILE is 'demo'. On a customer worker
//     every path here answers 404: absent, not merely refused.
//   • /beat and /reset accept a closed set of NAMES and nothing else. No request
//     body carries a document, so there is no payload to smuggle: the document
//     is the worker's own static asset, the same file the page reads, so the
//     demo has one source of truth for what a beat means. The worst an anonymous
//     caller can do is move the demo tenant between states the demo ships.
//   • /receipt answers only the caller's OWN decisions: it requires the
//     shopper's session capability, refuses an id that names another visitor
//     before any read, checks the record's owner after it, and returns a
//     projection that leaves out the visitor and session ids and the replay
//     inputs (the affinity vector).
//   • Nothing fabricates authority. Each action mints a genuine 60-second
//     operator token and re-enters the ordinary pipeline, so the same grant
//     check, tenant binding, validation, publication concurrency and subject
//     audit apply as for any other operator.
// ──────────────────────────────────────────────────────

import { Hono, type Context } from 'hono';
import { SignJWT } from 'jose';
import type { Env } from '@/types/env';
import type { TenantVariables } from '@/tenancy/tenant';
import { requireShopper, shopperPrincipal } from '@/identity/sessionCapability';

/** The demo's own tenant. Not configurable: this route exists for one demo. */
export const VANTAGE_TENANT = 'vantage';

/**
 * The beat documents the page may ask the worker to publish, and the document
 * kind each one is. These are files scripts/seed-vantage.mjs writes into
 * public/vantage/beats/. The list is closed on purpose: it is the whole reason
 * this route needs no login. Context beats (the other twelve) are read by the
 * page directly and publish nothing.
 */
export const VANTAGE_BEATS: Readonly<Record<string, 'catalog' | 'slots'>> = Object.freeze({
  'open-catalog': 'catalog',
  'open-slots': 'slots',
  '11-two-weeks-pass': 'catalog',
  '12-black-friday': 'catalog',
  '13-pin-duo-preorder': 'slots',
});

/** The opening state, slots first so the catalog lands on the opening slots. */
export const VANTAGE_RESET: readonly string[] = Object.freeze(['open-slots', 'open-catalog']);

/** The slots a day report may be read for. */
export const VANTAGE_REPORT_SLOTS: ReadonlySet<string> = new Set(['hero', 'deals', 'pdp-modules', 'plan-pairing']);

/** The subject the demo publishes and reads as. TENANTS must grant it the demo tenant. */
const OPERATOR = 'vantage-demo';

/** Long enough for one read-then-write handshake, short enough to be useless if it leaks. */
const TOKEN_TTL_SECONDS = 60;

/** How many receipts one press may ask for: a homepage is one hero and four deals. */
const RECEIPTS_PER_REQUEST = 12;

type Dispatch = (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;
type Ctx = { Bindings: Env; Variables: TenantVariables };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A note is attribution, not free text: it lands in the audit index. */
export const noteOf = (value: unknown): string =>
  (typeof value === 'string' ? value : '').replace(/[^\p{L}\p{N} .,:;'’—-]/gu, '').slice(0, 120);

/**
 * The document a beat file publishes, or null. The file must say it is this
 * beat, that it is a publish, and that it publishes the kind the closed list
 * names for it; anything else (a context beat, a renamed file, the static
 * host's HTML fallback for a missing asset) publishes nothing.
 */
export function publishedDocument(beat: unknown, name: string, kind: 'catalog' | 'slots'): Record<string, unknown> | null {
  if (!isRecord(beat) || beat.name !== name || beat.kind !== 'publish') return null;
  const publish = beat.publish;
  if (!isRecord(publish) || publish.kind !== kind || !isRecord(publish.document)) return null;
  return publish.document;
}

/**
 * Whether a decision id names one of THIS visitor's decisions. Ids are
 * `${tenant}:${ts36}:${visitorId}:${page}:${slot}:${position}[:n1:${nonce}]`
 * (src/content/decide.ts), so the owner is checkable before anything is read.
 */
export function ownDecisionId(id: unknown, subject: string): id is string {
  if (typeof id !== 'string' || id.length > 512 || !subject) return false;
  if (!/^[A-Za-z0-9:._~-]+$/.test(id)) return false;
  const prefix = `${VANTAGE_TENANT}:`;
  if (!id.startsWith(prefix)) return false;
  const rest = id.slice(prefix.length);
  const at = rest.indexOf(':');
  if (at <= 0 || !/^[0-9a-z]+$/.test(rest.slice(0, at))) return false;
  return rest.slice(at + 1).startsWith(`${subject}:`);
}

/**
 * What the "why these" panel may show of one ledger record: everything that
 * explains the decision, nothing that identifies the visitor or replays her
 * vector. `explain` carries the drivers, the arrival seeds (`contextual`),
 * merchandising, stage, freshness, fatigue, diversity and the regional blend.
 */
const RECEIPT_FIELDS = ['decision_id', 'ts', 'page', 'slot', 'position', 'ranking_position', 'item_id', 'customer_item_id',
  'arm', 'authority', 'explored', 'cell', 'journey', 'versions', 'config_label', 'candidates', 'explain', 'measurementBasis',
  'featured_product_ids'] as const;

export function receiptOf(record: Record<string, unknown>): Record<string, unknown> {
  const receipt: Record<string, unknown> = {};
  for (const field of RECEIPT_FIELDS) if (record[field] !== undefined) receipt[field] = record[field];
  return receipt;
}

/** The buy-box toggle's values, as the page asserts them on the snapshot (`ctx.intent`). */
const ASSERTED_INTENTS = new Set(['new', 'add-line', 'upgrade', 'byod']);
/** A region key as the engine builds them: country, or country-region. */
const REGION_KEY = /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/;

export type AssertedContext = { intent?: string; region?: string };

/**
 * The page's own assertions for the snapshot that produced the decisions, as
 * the page reports them on the receipt request: `{ intent, region }`. Null
 * when absent; an Error when present and not a value the page can assert.
 */
export function assertedContextOf(value: unknown): AssertedContext | null | Error {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) return new Error('context must be an object of intent and region');
  const out: AssertedContext = {};
  for (const [key, raw] of Object.entries(value)) {
    const name = key.replace(/^ctx./, '');
    if (name !== 'intent' && name !== 'region') return new Error(`context names ${key}; only intent and region are asserted`);
    if (typeof raw !== 'string') return new Error(`context.${name} must be a string`);
    const v = name === 'region' ? raw.trim().toUpperCase() : raw.trim();
    if (name === 'intent' && !ASSERTED_INTENTS.has(v)) return new Error(`context.intent must be one of ${[...ASSERTED_INTENTS].join(', ')}`);
    if (name === 'region' && !REGION_KEY.test(v)) return new Error('context.region must be a region key such as US-TX');
    out[name] = v;
  }
  return out;
}

/**
 * What was ASSERTED, rather than observed, for one decision, and where each
 * value comes from, so the page can label it as asserted. The ledger at HEAD
 * records no asserted intent at all, and records an asserted region only when
 * it selected the regional prior (`explain.regional.asserted`, the demo
 * profile's override); anything else is the page's own report of the request
 * that produced the decision. The edge's region is `cell.region`, observed.
 */
export function assertedOf(record: Record<string, unknown>, context: AssertedContext | null): Record<string, unknown> | null {
  const asserted: Record<string, { value: string; from: 'record' | 'request' }> = {};
  const explain = isRecord(record.explain) ? record.explain : {};
  const regional = isRecord(explain.regional) ? explain.regional : null;
  if (regional?.asserted === true && typeof regional.region === 'string') asserted['ctx.region'] = { value: regional.region, from: 'record' };
  else if (context?.region) asserted['ctx.region'] = { value: context.region, from: 'request' };
  if (context?.intent) asserted['ctx.intent'] = { value: context.intent, from: 'request' };
  return Object.keys(asserted).length ? asserted : null;
}

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

/**
 * The engine's refusal of a day report (a 413: one of its report budgets), as
 * the page prints it. The engine builds one whole UTC day, the narrowest window
 * it accepts (it has no slot or hour filter), so a busy day can outgrow the
 * budget whatever the page asks for; the honest answer names the window and the
 * budget rather than passing it off as a gateway failure.
 */
export function reportTooLarge(date: string, slot: string, refusal: unknown): Record<string, unknown> {
  const r = isRecord(refusal) ? refusal : {};
  const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    ok: false, code: 'report_too_large', error: 'report too large for the window',
    window: { date, unit: 'UTC day', slot },
    budget: typeof r.budget === 'string' ? r.budget.slice(0, 40) : null, limit: count(r.limit), observed: count(r.observed),
  };
}

const provisioned = (env: Env) => Boolean(env.JWT_SECRET && env.JWT_ISSUER && env.JWT_AUDIENCE);
const UNPROVISIONED = { ok: false, error: 'the demo tenant is not provisioned on this worker' } as const;

type Outcome = { status: 200 | 400 | 502 | 503; body: Record<string, unknown> };

export function vantageRoutes(dispatch: Dispatch) {
  const routes = new Hono<Ctx>();

  // Absent, not merely refused, off the demo profile.
  routes.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    if (c.env.DEPLOYMENT_PROFILE !== 'demo') return c.json({ error: 'Not Found' }, 404);
    return next();
  });

  /** One named beat, published exactly as the operator console would publish it. */
  async function applyBeat(c: Context<Ctx>, name: string, note: string, token: string): Promise<Outcome> {
    const kind = VANTAGE_BEATS[name]!;
    const origin = new URL(c.req.url).origin;
    const asset = await c.env.ASSETS.fetch(new Request(`${origin}/vantage/beats/${name}.json`));
    const beat = asset.ok ? await asset.json().catch(() => null) : null;
    const document = publishedDocument(beat, name, kind);
    if (!document) {
      return { status: 503, body: { ok: false, name, error: `${name}.json is missing or is not a ${kind} publish; run scripts/seed-vantage.mjs, then redeploy` } };
    }

    const auth = { Authorization: `Bearer ${token}`, 'X-Tenant': VANTAGE_TENANT };
    const url = `${origin}/content/${kind}?scope=${VANTAGE_TENANT}`;

    // Read the base first: a versioned publish is conditional on the revision
    // and publication digest it was authored against, exactly as the operator
    // console does it. This is an in-process dispatch, not a network call.
    const read = await dispatch(new Request(url, { headers: auth }), c.env, c.executionCtx);
    const base = await read.json().catch(() => null) as
      { revision?: number; publication?: { revision: number; digest: string }; error?: string } | null;
    if (read.status === 401 || read.status === 403) {
      return { status: 503, body: { ok: false, name, stage: 'read', status: read.status,
        error: base?.error ?? `the demo operator has no grant on "${VANTAGE_TENANT}"` } };
    }
    if (!read.ok || !base?.publication) {
      return { status: 503, body: { ok: false, name, stage: 'read', status: read.status,
        error: base?.error ?? `no publication base for ${kind}; run /ops/demo-bootstrap` } };
    }

    const write = await dispatch(new Request(url, {
      method: 'PUT',
      headers: {
        ...auth,
        'content-type': 'application/json',
        'If-Match': `"${base.revision}/${base.publication.revision}/${base.publication.digest}"`,
        'Idempotency-Key': `${base.revision}:${crypto.randomUUID()}`,
      },
      body: JSON.stringify({ document, note }),
    }), c.env, c.executionCtx);

    const result = await write.json().catch(() => null) as { ok?: boolean; revision?: number; error?: string; errors?: unknown } | null;
    if (!write.ok || result?.ok !== true) {
      return { status: 502, body: { ok: false, name, stage: 'write', status: write.status,
        error: result?.error ?? `publishing ${kind} failed`, ...(result?.errors ? { errors: result.errors } : {}) } };
    }
    return { status: 200, body: { ok: true, name, kind, revision: result.revision } };
  }

  routes.post('/beat', async (c) => {
    const body = await c.req.json().catch(() => null) as { name?: unknown; kind?: unknown; note?: unknown } | null;
    if (!isRecord(body)) return c.json({ ok: false, error: 'body must be a JSON object' }, 400);
    const name = typeof body.name === 'string' ? body.name : '';
    if (!Object.hasOwn(VANTAGE_BEATS, name)) {
      return c.json({ ok: false, error: `unknown beat; the publishable beats are ${Object.keys(VANTAGE_BEATS).join(', ')}` }, 400);
    }
    if (body.kind !== undefined && body.kind !== VANTAGE_BEATS[name]) return c.json({ ok: false, error: `${name} publishes ${VANTAGE_BEATS[name]}` }, 400);
    if (!provisioned(c.env)) return c.json(UNPROVISIONED, 503);
    const outcome = await applyBeat(c, name, noteOf(body.note), await mintOperatorToken(c.env));
    return c.json(outcome.body, outcome.status);
  });

  /** The opening state in one press: the opening slots, then the opening catalog. */
  routes.post('/reset', async (c) => {
    if (!provisioned(c.env)) return c.json(UNPROVISIONED, 503);
    const token = await mintOperatorToken(c.env);
    const applied: Record<string, unknown>[] = [];
    for (const name of VANTAGE_RESET) {
      const outcome = await applyBeat(c, name, `reset: ${name}`, token);
      if (outcome.status !== 200) return c.json({ ...outcome.body, applied }, outcome.status);
      applied.push(outcome.body);
    }
    return c.json({ ok: true, applied });
  });

  /**
   * The receipt: one decision's ledger record, for the page's "why these" panel.
   * The snapshot answer carries a thin receipt (drivers, note, diversity); the
   * seeds, merchandising, stage, freshness, fatigue and the regional blend live
   * only on the record. Body: { decisionId } or { decisionIds: [...] }, ids from
   * the snapshot's own `decisions[].decisionId`, with the shopper's
   * X-Shopper-Session, and optionally `context: { intent, region }`: what the
   * page asserted on the snapshot that produced them. Answer: { ok, record } for
   * one id, { ok, records, pending } for several; each is the record's
   * projection (receiptOf) with `asserted` (assertedOf) when anything was.
   * The record is written by the ledger's queue consumer a few seconds after
   * the snapshot, so an id not yet written answers 202 and `pending`, and the
   * page asks again.
   */
  routes.post('/receipt', requireShopper({ forward: false, bodyLimit: 8192 }), async (c) => {
    const body = await c.req.json().catch(() => null) as { decisionId?: unknown; decisionIds?: unknown; context?: unknown } | null;
    const many = isRecord(body) && Array.isArray(body.decisionIds);
    const ids: unknown[] = many ? (body!.decisionIds as unknown[]) : [isRecord(body) ? body.decisionId : undefined];
    if (!ids.length || ids.length > RECEIPTS_PER_REQUEST) {
      return c.json({ ok: false, error: `ask for 1..${RECEIPTS_PER_REQUEST} decisions` }, 400);
    }
    const subject = shopperPrincipal(c.req.raw).subject;
    if (!ids.every((id) => ownDecisionId(id, subject))) {
      return c.json({ ok: false, error: 'every decisionId must name one of this shopper’s own decisions' }, 400);
    }
    const context = assertedContextOf(isRecord(body) ? body.context : undefined);
    if (context instanceof Error) return c.json({ ok: false, error: context.message }, 400);
    if (!provisioned(c.env)) return c.json(UNPROVISIONED, 503);

    const origin = new URL(c.req.url).origin;
    const auth = { Authorization: `Bearer ${await mintOperatorToken(c.env)}`, 'X-Tenant': VANTAGE_TENANT };
    const receipts: Record<string, unknown>[] = [];
    const pending: string[] = [];
    for (const id of ids as string[]) {
      const read = await dispatch(new Request(`${origin}/v1/${VANTAGE_TENANT}/ledger/${encodeURIComponent(id)}`, { headers: auth }),
        c.env, c.executionCtx);
      if (read.status === 404) { pending.push(id); continue; }
      const result = await read.json().catch(() => null) as { record?: unknown; error?: string } | null;
      if (!read.ok || !isRecord(result?.record)) {
        return c.json({ ok: false, decisionId: id, status: read.status, error: result?.error ?? 'the receipt could not be read' }, 502);
      }
      // The owner, checked on the record itself as well as on the id.
      if (result.record.visitor_id !== subject) return c.json({ ok: false, error: 'not found' }, 404);
      const asserted = assertedOf(result.record, context);
      receipts.push({ ...receiptOf(result.record), ...(asserted ? { asserted } : {}) });
    }
    if (!receipts.length) {
      return c.json({ ok: false, pending, error: 'not yet written by the ledger consumer; ask again in a few seconds' }, 202);
    }
    return c.json(many ? { ok: true, records: receipts, pending } : { ok: true, record: receipts[0] });
  });

  /**
   * The day report (beat 15). Reading the ledger is an operator read like any
   * other, so it goes the same way: minted authority, ordinary pipeline, and
   * nothing but a date and a slot crossing the wire from the browser. With
   * `build`, the engine first builds the date's report: one whole UTC day, the
   * narrowest window it builds, whichever slot is named. A build or read the
   * engine refuses on a report budget answers 413 `report_too_large` with the
   * window and the budget, and a refused build reads nothing after it.
   */
  routes.post('/report', async (c) => {
    const body = await c.req.json().catch(() => null) as { date?: unknown; slot?: unknown; build?: unknown } | null;
    const date = typeof body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : '';
    const slot = typeof body?.slot === 'string' && VANTAGE_REPORT_SLOTS.has(body.slot) ? body.slot : '';
    if (!date || !slot) return c.json({ ok: false, error: `date (YYYY-MM-DD) and a slot (${[...VANTAGE_REPORT_SLOTS].join(', ')}) are required` }, 400);
    if (!provisioned(c.env)) return c.json(UNPROVISIONED, 503);

    const origin = new URL(c.req.url).origin;
    const auth = { Authorization: `Bearer ${await mintOperatorToken(c.env)}`, 'X-Tenant': VANTAGE_TENANT };

    if (body?.build === true) {
      const made = await dispatch(new Request(`${origin}/v1/${VANTAGE_TENANT}/learn/report`, {
        method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ date }),
      }), c.env, c.executionCtx);
      if (made.status === 413) return c.json(reportTooLarge(date, slot, await made.json().catch(() => null)), 413);
      if (!made.ok) return c.json({ ok: false, error: `the report could not be built (${made.status})` }, 502);
    }

    const read = await dispatch(new Request(
      `${origin}/v1/${VANTAGE_TENANT}/learn/report?date=${date}&slot=${slot}`, { headers: auth },
    ), c.env, c.executionCtx);
    const result = await read.json().catch(() => null) as { report?: unknown; error?: string } | null;
    if (read.status === 413) return c.json(reportTooLarge(date, slot, result), 413);
    if (!read.ok || !result?.report) return c.json({ ok: false, error: result?.error ?? `no report for ${date}` }, 502);
    return c.json({ ok: true, report: result.report });
  });

  return routes;
}
