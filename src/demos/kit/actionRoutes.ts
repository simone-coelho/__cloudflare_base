// src/demos/kit/actionRoutes.ts
// ──────────────────────────────────────────────────────
// A demo's merchandiser half and its receipts, as one factory
// (docs/demo-kit/Demo-Kit-Design.md §2.1). Extracted from src/routes/vantage.ts,
// itself a fork of src/routes/topOffers.ts, without changing what it serves. A
// demo declares its constants in src/demos/<slug>.config.ts (its tenant, its
// operator subject, its closed list of beats, its reset order, its report
// slots and the intents its page may assert) and gets back four routes:
//
//   POST /beat     { name, kind?, note? }                     one named beat, published
//   POST /reset    {}                                         the opening state, in reset order
//   POST /receipt  { decisionId | decisionIds, context? }     her own decisions only
//   POST /report   { date, slot, build? }                     one slot's day report
//
// Every merchandiser press is a real versioned publish against the demo
// tenant, and every "why these" is the decision's own ledger record, because
// the argument of a demo is that nothing is staged in the browser.
//
// Both need operator authority, and `public/` is served wholesale, so the
// credential stays in the worker. What makes these actions safe to expose
// without a login:
//
//   • They exist only where DEPLOYMENT_PROFILE is 'demo'. On a customer worker
//     every path here answers 404: absent, not merely refused.
//   • /beat and /reset accept a closed set of NAMES and nothing else, copied
//     and frozen when the routes are built. No request body carries a document,
//     so there is no payload to smuggle: the document is the worker's own
//     static asset, the same file the page reads, so the demo has one source of
//     truth for what a beat means. The worst an anonymous caller can do is move
//     the demo tenant between states the demo ships.
//   • /receipt answers only the caller's OWN decisions: it requires the
//     shopper's session capability, refuses an id that names another visitor
//     (or another tenant) before any read, checks the record's owner after it,
//     and returns a projection that leaves out the visitor and session ids and
//     the replay inputs (the affinity vector).
//   • Nothing fabricates authority. Each action mints a genuine 60-second
//     operator token and re-enters the ordinary pipeline, so the same grant
//     check, tenant binding, validation, publication concurrency and subject
//     audit apply as for any other operator.
// ──────────────────────────────────────────────────────

import { Hono, type Context } from 'hono';
import { SignJWT } from 'jose';
import type { Env } from '@/types/env';
import { isValidTenantId, type TenantVariables } from '@/tenancy/tenant';
import { requireShopper, shopperPrincipal } from '@/identity/sessionCapability';
import {
  assertedContextOf, assertedOf, isRecord, noteOf, ownDecisionId, publishedDocument, receiptOf, reportTooLarge, type BeatKind,
} from './helpers';

/** A demo's constants for its action routes: what its src/demos/<slug>.config.ts declares. */
export interface DemoActionConfig {
  /** The demo's own tenant. Every call the routes dispatch names it, and a receipt id must carry it as its prefix. */
  tenant: string;
  /** The subject the demo publishes and reads as. TENANTS must grant it the demo tenant. */
  operator: string;
  /**
   * The beat documents the page may ask the worker to publish, and the document
   * kind each one is. The list is closed on purpose: it is the whole reason
   * these routes need no login.
   */
  beats: Readonly<Record<string, BeatKind>>;
  /** The opening state, in the order it is published. Every name is on the beat list. */
  reset: readonly string[];
  /** The slots a day report may be read for. */
  reportSlots: ReadonlySet<string>;
  /** The values the page may assert as `ctx.intent` (its buy-box toggle), reported on a receipt request. */
  asserted: ReadonlySet<string>;
  /** Where the worker's own assets serve the beat documents, as an absolute path: `/vantage/beats`. */
  beatsPath: string;
  /** The script that writes those documents, named when one is missing. */
  seedScript: string;
}

/** Re-enters the worker's own app: the ordinary pipeline, in process, never a network call. */
export type Dispatch = (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;
type Ctx = { Bindings: Env; Variables: TenantVariables };

/** Long enough for one read-then-write handshake, short enough to be useless if it leaks. */
const TOKEN_TTL_SECONDS = 60;

/** How many receipts one press may ask for: a homepage is one hero and four deals. */
const RECEIPTS_PER_REQUEST = 12;

/** A beat name becomes an asset file name, so it stays a plain word. */
const BEAT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
/** An absolute asset path of plain segments, with no trailing slash. */
const ASSET_PATH = /^(?:\/[A-Za-z0-9][A-Za-z0-9_-]*)+$/;

/**
 * The config as the routes hold it: checked, copied and frozen when they are
 * built, so a misconfigured demo fails at startup and nothing done to the
 * caller's objects afterwards can widen a closed list.
 */
function settled(config: DemoActionConfig): DemoActionConfig {
  const fail = (why: string): never => { throw new Error(`demoActionRoutes: ${why}`); };
  const { tenant, operator, beatsPath, seedScript } = config;
  if (!isValidTenantId(tenant)) fail(`"${String(tenant)}" is not a tenant id`);
  if (typeof operator !== 'string' || !operator) fail('an operator subject is required');
  if (typeof beatsPath !== 'string' || !ASSET_PATH.test(beatsPath)) fail(`beatsPath "${String(beatsPath)}" is not an absolute asset path such as /vantage/beats`);
  if (typeof seedScript !== 'string' || !seedScript) fail('a seed script is required');
  const beats: Record<string, BeatKind> = Object.create(null);
  for (const [name, kind] of Object.entries(isRecord(config.beats) ? config.beats : fail('beats must be an object of name → kind'))) {
    if (!BEAT_NAME.test(name)) fail(`beat "${name}" is not a plain name`);
    if (kind !== 'catalog' && kind !== 'slots') fail(`beat "${name}" publishes "${String(kind)}"; a beat publishes catalog or slots`);
    beats[name] = kind;
  }
  const reset = Array.isArray(config.reset) ? [...config.reset] : fail('reset must be a list of beat names');
  for (const name of reset) if (typeof name !== 'string' || !Object.hasOwn(beats, name)) fail(`reset names "${String(name)}", which is not on the beat list`);
  const names = (set: ReadonlySet<string>, what: string): ReadonlySet<string> => {
    if (!(set instanceof Set)) fail(`${what} must be a Set`);
    for (const value of set) if (typeof value !== 'string' || !value) fail(`${what} holds ${JSON.stringify(value)}, not a name`);
    return new Set(set);
  };
  return Object.freeze({
    tenant, operator, beatsPath, seedScript,
    beats: Object.freeze(beats), reset: Object.freeze(reset),
    reportSlots: names(config.reportSlots, 'reportSlots'), asserted: names(config.asserted, 'asserted'),
  });
}

/**
 * The operator credential, minted in the worker and never returned to anyone.
 * `type: 'service'` and the issuer/audience pair are what the operator
 * middleware verifies; the grant itself comes from TENANTS, not from here.
 */
async function mintOperatorToken(env: Env, operator: string): Promise<string> {
  const key = new TextEncoder().encode(env.JWT_SECRET);
  return new SignJWT({ sub: operator, roles: ['operator'], type: 'service' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(key);
}

const provisioned = (env: Env) => Boolean(env.JWT_SECRET && env.JWT_ISSUER && env.JWT_AUDIENCE);
const UNPROVISIONED = { ok: false, error: 'the demo tenant is not provisioned on this worker' } as const;

type Outcome = { status: 200 | 400 | 502 | 503; body: Record<string, unknown> };

/** The four routes for one demo: its constants, plus the worker's own app to re-enter. */
export function demoActionRoutes(config: DemoActionConfig & { dispatch: Dispatch }) {
  const { tenant, operator, beats, reset, reportSlots, asserted, beatsPath, seedScript } = settled(config);
  const { dispatch } = config;
  if (typeof dispatch !== 'function') throw new Error('demoActionRoutes: dispatch must re-enter the worker’s own app');
  const routes = new Hono<Ctx>();

  // Absent, not merely refused, off the demo profile.
  routes.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    if (c.env.DEPLOYMENT_PROFILE !== 'demo') return c.json({ error: 'Not Found' }, 404);
    return next();
  });

  /** One named beat, published exactly as the operator console would publish it. */
  async function applyBeat(c: Context<Ctx>, name: string, note: string, token: string): Promise<Outcome> {
    const kind = beats[name]!;
    const origin = new URL(c.req.url).origin;
    const asset = await c.env.ASSETS.fetch(new Request(`${origin}${beatsPath}/${name}.json`));
    const beat = asset.ok ? await asset.json().catch(() => null) : null;
    const document = publishedDocument(beat, name, kind);
    if (!document) {
      return { status: 503, body: { ok: false, name, error: `${name}.json is missing or is not a ${kind} publish; run ${seedScript}, then redeploy` } };
    }

    const auth = { Authorization: `Bearer ${token}`, 'X-Tenant': tenant };
    const url = `${origin}/content/${kind}?scope=${tenant}`;

    // Read the base first: a versioned publish is conditional on the revision
    // and publication digest it was authored against, exactly as the operator
    // console does it. This is an in-process dispatch, not a network call.
    const read = await dispatch(new Request(url, { headers: auth }), c.env, c.executionCtx);
    const base = await read.json().catch(() => null) as
      { revision?: number; publication?: { revision: number; digest: string }; error?: string } | null;
    if (read.status === 401 || read.status === 403) {
      return { status: 503, body: { ok: false, name, stage: 'read', status: read.status,
        error: base?.error ?? `the demo operator has no grant on "${tenant}"` } };
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
    if (!Object.hasOwn(beats, name)) {
      return c.json({ ok: false, error: `unknown beat; the publishable beats are ${Object.keys(beats).join(', ')}` }, 400);
    }
    if (body.kind !== undefined && body.kind !== beats[name]) return c.json({ ok: false, error: `${name} publishes ${beats[name]}` }, 400);
    if (!provisioned(c.env)) return c.json(UNPROVISIONED, 503);
    const outcome = await applyBeat(c, name, noteOf(body.note), await mintOperatorToken(c.env, operator));
    return c.json(outcome.body, outcome.status);
  });

  /** The opening state in one press: each reset beat in its order (Vantage: the opening slots, then the opening catalog). */
  routes.post('/reset', async (c) => {
    if (!provisioned(c.env)) return c.json(UNPROVISIONED, 503);
    const token = await mintOperatorToken(c.env, operator);
    const applied: Record<string, unknown>[] = [];
    for (const name of reset) {
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
    if (!ids.every((id) => ownDecisionId(id, subject, tenant))) {
      return c.json({ ok: false, error: 'every decisionId must name one of this shopper’s own decisions' }, 400);
    }
    const context = assertedContextOf(isRecord(body) ? body.context : undefined, asserted);
    if (context instanceof Error) return c.json({ ok: false, error: context.message }, 400);
    if (!provisioned(c.env)) return c.json(UNPROVISIONED, 503);

    const origin = new URL(c.req.url).origin;
    const auth = { Authorization: `Bearer ${await mintOperatorToken(c.env, operator)}`, 'X-Tenant': tenant };
    const receipts: Record<string, unknown>[] = [];
    const pending: string[] = [];
    for (const id of ids as string[]) {
      const read = await dispatch(new Request(`${origin}/v1/${tenant}/ledger/${encodeURIComponent(id)}`, { headers: auth }),
        c.env, c.executionCtx);
      if (read.status === 404) { pending.push(id); continue; }
      const result = await read.json().catch(() => null) as { record?: unknown; error?: string } | null;
      if (!read.ok || !isRecord(result?.record)) {
        return c.json({ ok: false, decisionId: id, status: read.status, error: result?.error ?? 'the receipt could not be read' }, 502);
      }
      // The owner, checked on the record itself as well as on the id.
      if (result.record.visitor_id !== subject) return c.json({ ok: false, error: 'not found' }, 404);
      const assertedOn = assertedOf(result.record, context);
      receipts.push({ ...receiptOf(result.record), ...(assertedOn ? { asserted: assertedOn } : {}) });
    }
    if (!receipts.length) {
      return c.json({ ok: false, pending, error: 'not yet written by the ledger consumer; ask again in a few seconds' }, 202);
    }
    return c.json(many ? { ok: true, records: receipts, pending } : { ok: true, record: receipts[0] });
  });

  /**
   * The day report. Reading the ledger is an operator read like any other, so
   * it goes the same way: minted authority, ordinary pipeline, and nothing but
   * a date and a slot crossing the wire from the browser. With `build`, the
   * engine first builds the date's report: one whole UTC day, the narrowest
   * window it builds, whichever slot is named. A build or read the engine
   * refuses on a report budget answers 413 `report_too_large` with the window
   * and the budget, and a refused build reads nothing after it.
   */
  routes.post('/report', async (c) => {
    const body = await c.req.json().catch(() => null) as { date?: unknown; slot?: unknown; build?: unknown } | null;
    const date = typeof body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : '';
    const slot = typeof body?.slot === 'string' && reportSlots.has(body.slot) ? body.slot : '';
    if (!date || !slot) return c.json({ ok: false, error: `date (YYYY-MM-DD) and a slot (${[...reportSlots].join(', ')}) are required` }, 400);
    if (!provisioned(c.env)) return c.json(UNPROVISIONED, 503);

    const origin = new URL(c.req.url).origin;
    const auth = { Authorization: `Bearer ${await mintOperatorToken(c.env, operator)}`, 'X-Tenant': tenant };

    if (body?.build === true) {
      const made = await dispatch(new Request(`${origin}/v1/${tenant}/learn/report`, {
        method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ date }),
      }), c.env, c.executionCtx);
      if (made.status === 413) return c.json(reportTooLarge(date, slot, await made.json().catch(() => null)), 413);
      if (!made.ok) return c.json({ ok: false, error: `the report could not be built (${made.status})` }, 502);
    }

    const read = await dispatch(new Request(
      `${origin}/v1/${tenant}/learn/report?date=${date}&slot=${slot}`, { headers: auth },
    ), c.env, c.executionCtx);
    const result = await read.json().catch(() => null) as { report?: unknown; error?: string } | null;
    if (read.status === 413) return c.json(reportTooLarge(date, slot, result), 413);
    if (!read.ok || !result?.report) return c.json({ ok: false, error: result?.error ?? `no report for ${date}` }, 502);
    return c.json({ ok: true, report: result.report });
  });

  return routes;
}
