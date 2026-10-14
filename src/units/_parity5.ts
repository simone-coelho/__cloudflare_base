// src/units/_parity5.ts
// The fifth shared harness of the parity unit files: what the S5 tickets of the
// second parity programme (P36, P37, P38, P40, P39)
// need beyond src/units/_parity.ts and src/units/_parity4.ts, which are pinned
// by receipted tickets and never edited here.
//
// It holds no expected value of any ticket. It adds three things:
//   · a shopper whose every request carries the headers a browser sends (the
//     client hints and the user agent), whose snapshot may carry the page's own
//     channel, and who can return after days as the same shopper on either host
//     through the reachable anonymous return path (unit:W16.C6's published
//     continuity configuration and recognition proof, mounted as `src/index.ts`
//     mounts the identity routes) — a capability lives 24 hours and the shopper
//     object admits only the grants it stored, so nothing else is a return;
//   · a write of any content kind by name (`PUT /content/:kind` with the
//     authored preconditions), for kinds the first harness's `putDocument` does
//     not type (`priors`, and a kind a ticket adds);
//   · a neutral home page (one served-v1 content slot and four pieces tagged on
//     two dimensions the slot weights), on which a seed rule's lift is read off
//     the public snapshot: a cold shopper has no interest, so every piece's base
//     is exactly zero and a fired rule is the only thing that moves a score.
// Documents are read from the tree this file lives in, never the working directory.

import { Hono } from 'hono';
import { expect } from 'vitest';

import { invalidatePublicationCache } from '@/config/publication';
import { storedConsent } from '@/content/consent';
import { newAnonymousSession, SHOPPER_HEADER } from '@/identity/sessionCapability';
import { identityRoutes } from '@/routes/identity';
import { tenantMiddleware } from '@/tenancy/middleware';
import { shopperObjectName } from '@/tenancy/objects';
import type { TenantId } from '@/tenancy/tenant';
import type { Env } from '@/types/env';

import { asOperator, BRAND, slotPositionOf, TENANT, type Answer, type Decision, type Grant, type Mounted, type Snapshot } from './_parity';

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

// ---------------------------------------------------------------------------
// The shopper, with the headers of the shopper's browser.
// ---------------------------------------------------------------------------

export interface Visitor {
  grant: Grant;
  subject: string;
  /** The headers the shopper's browser sends on every request (client hints, user agent). Mutable, for a test that changes device. */
  headers: Record<string, string>;
  /** A real accepted event through the mounted app (`POST /realtime/action`), carrying the arrival the SDK sends with every action. */
  action: (event: { type: string; data: Record<string, unknown> }, opts?: { entry?: Record<string, string>; headers?: Record<string, string> }) => Promise<Answer>;
  /** `POST /v1/:tenant/decisions/snapshot`, the route production serves; `channel` is the page's own channel (HydrateOptions.channel). */
  snapshot: (page: string, opts?: { pageInstance?: string; entry?: Record<string, string>; channel?: string; headers?: Record<string, string> }) => Promise<Snapshot>;
  /** The SDK-visible hydrate projection (`GET /realtime/reflex`). */
  hydrate: (opts?: { headers?: Record<string, string> }) => Promise<Answer>;
  /** The render acknowledgement the SDK sends for a decision it painted (as src/units/_parity.ts sends it). */
  ack: (snapshot: Snapshot, decision: Decision) => Promise<Answer>;
  /**
   * The shopper's return after the capability's 24 hours, on the reachable anonymous
   * return path (unit:W16.C6, the published continuity configuration of
   * `continuityReflex`): no capability, the recognition proof the shopper holds
   * presented to `POST /v1/:tenant/identity/session`, a fresh capability for the
   * same subject answered and kept, and the rotated proof kept for the next
   * return. Only for a visitor created with `continuity: true`.
   */
  returnNow: () => Promise<void>;
  /** The shopper's explicit choice made again over the one stored (consent lives 30 days, src/content/consent.ts:17). */
  chooseAgain: () => Promise<void>;
}

/** A synthetic, customer-neutral continuity configuration (the shape unit:W16.C6 rules), wide enough for every return below. */
export const CONTINUITY_FIXTURE = { mode: 'direct', windowMs: 90 * DAY_MS, purpose: 'parity5-return-recognition', retentionApproved: true } as const;
/** The tenant's registry document with the continuity block, so an anonymous return after days is the same shopper. */
export const continuityReflex = (base: Record<string, unknown>) => ({ ...base, continuity: { ...CONTINUITY_FIXTURE } });

/** The identity routes, mounted as `src/index.ts` mounts them (`app.route('/v1', identityRoutes)`), over the same bindings. */
const identityApp = new Hono<{ Bindings: Env }>();
identityApp.use('*', tenantMiddleware());
identityApp.route('/v1', identityRoutes);
async function identitySession(m: Mounted, body: Record<string, unknown>, capability?: string): Promise<Answer> {
  const pending: Promise<unknown>[] = [];
  const response = await identityApp.fetch(new Request(`https://shop.invalid/v1/${TENANT}/identity/session`, {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'X-Tenant': TENANT, 'Content-Type': 'application/json', ...(capability ? { [SHOPPER_HEADER]: capability } : {}) },
  }), m.env, { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext);
  const answer = { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
  while (pending.length) await Promise.all(pending.splice(0));
  await m.drain();
  return answer;
}

/**
 * A shopper with a session grant, the given browser headers and, unless
 * `consent` is null, the shopper's own explicit choice through the real route. With
 * `continuity`, the shopper also holds the recognition proof the published continuity
 * configuration issues the shopper, for `returnNow`.
 */
export async function visitorOn(m: Mounted, opts: { headers?: Record<string, string>; consent?: { tracking: boolean; personalization: boolean } | null; continuity?: boolean } = {}): Promise<Visitor> {
  let grant: Grant = await newAnonymousSession(m.env, TENANT);
  let proof = '';
  const consent = opts.consent === undefined ? { tracking: true, personalization: true } : opts.consent;
  const call = async (path: string, body?: unknown, extra: Record<string, string> = {}): Promise<Answer> => {
    const response = await m.fetch(new Request(`https://shop.invalid${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...visitor.headers, ...extra, 'X-Tenant': TENANT, [SHOPPER_HEADER]: grant.capability, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
    const answer = { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
    await m.drain();
    return answer;
  };
  const choose = async () => {
    if (!consent) return;
    const stored = m.shoppers.get(shopperObjectName(TENANT as TenantId, grant.subject))?.data.get('consent');
    const expectedRevision = stored === undefined ? null : storedConsent(stored).instruction?.revision ?? null;
    const chosen = await call(`/realtime/session/${grant.sessionId}/preferences`, { trackingConsent: consent.tracking, personalizationEnabled: consent.personalization,
      choice: { id: crypto.randomUUID(), expectedRevision, grantId: grant.grantId, iat: grant.iat, exp: grant.exp } });
    expect(chosen.status, `PRECONDITION (${m.host}): the shopper's explicit choice is accepted (${JSON.stringify(chosen.body).slice(0, 200)})`).toBe(200);
  };
  const visitor: Visitor = {
    grant, subject: grant.subject, headers: { ...(opts.headers ?? {}) },
    action: (event, o = {}) => call('/realtime/action', { ...event, source: 'sdk', userId: grant.subject, sessionId: grant.sessionId,
      timestamp: Date.now(), eventId: crypto.randomUUID(), ...(o.entry ? { entry: o.entry } : {}) }, o.headers),
    snapshot: async (page, o = {}) => {
      const body: Record<string, string> = { page, brand: BRAND };
      if (o.pageInstance) body.pageInstance = o.pageInstance;
      if (o.entry) body.entry = JSON.stringify(o.entry);
      if (o.channel !== undefined) body.channel = o.channel;
      const answer = await call(`/v1/${TENANT}/decisions/snapshot`, body, o.headers);
      return { ...answer, page, ...(o.pageInstance ? { pageInstance: o.pageInstance } : {}), decisions: (answer.body.decisions ?? []) as Decision[] };
    },
    hydrate: (o = {}) => call('/realtime/reflex', undefined, o.headers),
    ack: (snap, d) => call('/realtime/action', { type: 'content_impression', source: 'sdk', userId: grant.subject, sessionId: grant.sessionId,
      eventId: crypto.randomUUID(), timestamp: Date.now(),
      data: { contentId: d.contentId, decisionId: d.decisionId, renderOffer: d.renderOffer, page: snap.page, pageInstance: snap.pageInstance,
        slot: d.slot, position: d.order, slotPosition: slotPositionOf(snap, d) } }),
    returnNow: async () => {
      expect(proof.length > 0, `PRECONDITION (${m.host}): the shopper holds a recognition proof (the visitor was created with continuity)`).toBe(true);
      const back = await identitySession(m, { continuity: { proof, operationId: crypto.randomUUID() } });
      const session = (back.body.session ?? {}) as Grant & { capability?: string };
      const report = (back.body.continuity ?? {}) as { enabled?: boolean; proof?: string };
      expect([back.status, session.subject === visitor.subject, report.enabled],
        `PRECONDITION (${m.host}): the shopper's return is recognised as the same shopper on the continuity path (${JSON.stringify(back.body).slice(0, 240)})`).toEqual([200, true, true]);
      grant = session; visitor.grant = grant;
      proof = typeof report.proof === 'string' ? report.proof : '';
    },
    chooseAgain: () => choose(),
  };
  await choose();
  if (opts.continuity) {
    const issued = await identitySession(m, {}, grant.capability);
    const report = (issued.body.continuity ?? {}) as { enabled?: boolean; proof?: string };
    expect([issued.status, report.enabled], `PRECONDITION (${m.host}): the published continuity configuration issues the shopper a recognition proof (${JSON.stringify(issued.body).slice(0, 240)})`).toEqual([200, true]);
    proof = typeof report.proof === 'string' ? report.proof : '';
  }
  return visitor;
}

// ---------------------------------------------------------------------------
// The operator, for any content kind.
// ---------------------------------------------------------------------------

/**
 * `PUT /content/:kind` with the authored preconditions (kit 02: If-Match plus
 * Idempotency-Key), for any kind the route names. When the kind's own read does
 * not answer 200 (a kind the platform does not serve yet), that read is returned
 * as the answer, so a unit names it instead of dying on it.
 */
export async function putKind(m: Mounted, kind: string, document: unknown, note = 'parity'): Promise<Answer> {
  const base = await asOperator(m, 'GET', `/content/${kind}?scope=${TENANT}`);
  if (base.status !== 200) return base;
  const publication = base.body.publication as { revision: number; digest: string } | undefined;
  const answer = await asOperator(m, 'PUT', `/content/${kind}?scope=${TENANT}`, { document, note }, {
    ...(publication ? { 'If-Match': `"${base.body.revision as number}/${publication.revision}/${publication.digest}"` } : {}),
    'Idempotency-Key': `${base.body.revision as number}:${crypto.randomUUID()}`,
  });
  invalidatePublicationCache();
  return answer;
}

/** `GET /content/:kind` as the operator: the document in force, its revision and whatever else the route answers. */
export const readKind = (m: Mounted, kind: string) => asOperator(m, 'GET', `/content/${kind}?scope=${TENANT}`);

// ---------------------------------------------------------------------------
// A neutral home page, for reading a seed rule's lift off the public snapshot.
// ---------------------------------------------------------------------------

export const HOME = 'home';
export const HERO = 'home-hero';
/** The slot's weights: a fired rule tagging `line` adds weight × 1, one tagging `category` adds weight × 0.5 (unit:W16.C3.01's arithmetic). */
export const HERO_WEIGHTS = { line: 1, category: 0.5 } as const;

/** Four live pieces in catalogue order, each carrying exactly one line and one category, none of them shared. */
export const HOME_PIECES = [
  { id: 'story.harbor', customerContentId: 'CMS-STORY-HARBOR', type: 'editorial', title: 'The harbor edit', tags: { line: ['Harbor'], category: ['Bags'] }, slotTypes: [HERO], lifecycle: { status: 'live' } },
  { id: 'story.meadow', customerContentId: 'CMS-STORY-MEADOW', type: 'editorial', title: 'The meadow edit', tags: { line: ['Meadow'], category: ['Shoes'] }, slotTypes: [HERO], lifecycle: { status: 'live' } },
  { id: 'story.summit', customerContentId: 'CMS-STORY-SUMMIT', type: 'video', title: 'The summit film', tags: { line: ['Summit'], category: ['Jewelry'] }, slotTypes: [HERO], lifecycle: { status: 'live' } },
  { id: 'story.coast', customerContentId: 'CMS-STORY-COAST', type: 'editorial', title: 'The coast edit', tags: { line: ['Coast'], category: ['Accessories'] }, slotTypes: [HERO], lifecycle: { status: 'live' } },
] as const;
export const HOME_ORDER = HOME_PIECES.map(p => p.id);

/** The home page's one slot: take 4 over the four pieces, with the given seed rules (none when omitted). */
export const heroSlot = (seeds?: unknown[], over: Record<string, unknown> = {}) =>
  ({ slot: HERO, take: 4, weights: { ...HERO_WEIGHTS }, ...(seeds ? { seeds } : {}), ...over });
/** A seed rule tagging one line: a cold shopper's matching piece scores exactly `weight` × 1. */
export const lineSeed = (signal: string, value: string, line: string, weight: number) => ({ signal, value, tags: [{ dimension: 'line', value: line }], weight });
/** The slots document of the home page (no governance marker: seeds are read on every slot, unit:W16.C3 R30(1)). */
export const homeSlots = (seeds?: unknown[]) => ({ version: 'parity5-slots', pages: { [HOME]: [heroSlot(seeds)] } });
/** The learn document: no holdout, the regional prior off, the hero measured served-v1 at γ 0; `extra` adds members. */
export const homeLearn = (extra: Record<string, unknown> = {}) => ({ version: 'parity5-learn',
  holdout: { share: 0, salt: 'parity5', arms: ['default'] }, regional: { enabled: false, kBlend: 1, minEvents: 30 },
  slots: { [HERO]: { measurementBasis: 'served-v1', reward: 'click' } }, ...extra });

/** The hero's served order with each piece's public score, as the snapshot answers it. */
export const heroOf = (snap: { decisions: Decision[] }): Array<[string, number | undefined]> =>
  snap.decisions.filter(d => d.slot === HERO).sort((a, b) => a.order - b.order).map(d => [d.contentId, d.score]);

/** The `why` sentences of every receipt of a piece, joined, from receipts read through the operator route. */
export const whyOf = (receipts: Array<Record<string, unknown>>, item: string): string[] =>
  receipts.filter(r => r.item === item).flatMap(r => (Array.isArray(r.why) ? r.why : []) as string[]);
