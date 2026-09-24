// src/units/W35/LEDGER.unit.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// W35 · Transactional shopper authority — the step-3 acceptance tests for the
// frozen work order (docs/remediation/delivery-control/program.json, ticket W35).
//
// AUTHORITY (document 35 §5 row W35, verbatim in the work order): "Choose and
// prove transactional shopper authority. If using ShopperReflex, first carry
// session/identity/visit/channel/consent and complete link/erase/SDK/sort/
// fatigue parity. Test concurrent writes, stale pointers, delayed creates,
// restart, ownership and rollback." Decision D1 (HANDOFF-2026-09-18 §7 Shopper
// authority; docs/remediation/decisions/D03-shopper-authority-direction-
// approved-2026-09-15.json): the existing per-shopper Durable Object is the
// local authority and parity is proven for it; the production host stays
// `session` (wrangler.toml REFLEX_HOST), cutover is LIVE2.
//
// WITNESSES the expected values come from:
//   · F14 (document 35 §2; 35-verification-reports/F14.md R1–R10, §5): the
//     authority must not lose concurrent updates (R1–R3), orphan a profile on a
//     pointer miss (R8), let a deferred create overwrite later state (R9), or
//     split a person on a link (R10); "no lost update" is measured against the
//     same events applied one after another.
//   · F13 (document 35 §2; F13.md §5 C): the object host must carry the visit
//     and entry channel the session host carries; visit boundaries are
//     VISIT_GAP_MS (src/services/visit.ts:30).
//   · The link contract (src/identity/link.ts:1-22, docs/architecture/
//     25-identity-stitching.md): a new link folds the browser's profile into
//     the person's.
//   · docs/api/01-rest-endpoints.md:26: `GET /realtime/reflex` — "the object
//     host answers the identical shape".
//   · docs/architecture/16-edge-affinity-reflex.md:269 (trust & abuse: an
//     unknown productId is dropped and counted) and docs/kit/02-api-reference.md
//     :111-113 (the `dropped: "unknown_product"` answer for an event whose
//     product we do not hold and whose every value the catalogue refuses).
//   · docs/kit/03-payload-schemas.md:545 (`personalization_update`, the stage
//     words and their reset), settled decision D06-W05 (explicit choice).
//   · The customer's own journey (docs/architecture/tapestry_requirements.txt
//     :113-121): Sarah arrives from an Instagram ad, views a black leather
//     crossbody at $450, a second similar crossbody, bounces into another
//     category — the fixture's event sequence, with an unknown product and a
//     cross-category view as part of it.
//
// CRITERIA and legs:
//   A1  host (both hosts, in process, the mounted routes and the real
//       ShopperReflex, as src/routes/realtime.sdkContract.test.ts does) and
//       sdk (the real `createClient` entry over a jsdom page, both hosts).
//   A2  host (object host) and native (object host in workerd via the shared
//       Miniflare harness src/units/_native.ts, with a real process restart).
//   A3  host (both hosts: the public link door delegates to the object
//       transfer on both, src/identity/link.ts:75).
//   Already proven by legacy tests in the acceptance command's second part and
//   cited, not rewritten: W35.03 (realtime.sdkContract.test.ts "recovers
//   prepare, absorb, publication and completion failures after restart without
//   another merge", "serializes source events and competing links…", "binds
//   transfer authority…"), W35.04–W35.07 (same file), W35.01 and W35.08 (same
//   file, W37.03 suite), W35.07 (src/routes/identity.test.ts), W35.02
//   (src/sdk/listen.test.ts and the W35.02 suite of the same file).
//
// Every clause is a soft assertion whose message names the behaviour, so one
// run reports every missing behaviour of a leg, not only the first.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import { SignJWT } from 'jose';
import { harness, publish, openSession, choose, HOSTS, fixtureCategories, type Harness, type Host, type Shopper } from './harness';
import { bundleNativeWorker, nativeScratchDirectory, openNativeRuntime, type NativeRuntime } from '../_native';
import { invalidateCache } from '@/config/versionedStore';
import { invalidateLiftCache } from '@/content/service';
import { signAssertion } from '@/identity/assertion';
import { shopperIdFor } from '@/identity/shopperId';
import { tenantKey } from '@/tenancy/tenant';
import { VISIT_GAP_MS } from '@/services/visit';
import { memoryHost } from '@/sdk/memoryHost';
import { authorityLocks } from '@/sdk/testHost';
import type { EngineUpdate, Host as SdkHost, ResponseLike } from '@/sdk/types';

const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: { url: string; referrer?: string }) => {
    window: { location: { href: string; host: string; hostname: string; protocol: string; search: string }; document: { referrer: string } };
  };
};
/**
 * The real SDK entry (src/sdk/index.ts, `createClient`). It is loaded by its path
 * at run time because the application's type program excludes the DOM-typed SDK
 * entry and browser host (tsconfig.json "exclude"; the SDK has its own tsconfig),
 * so the shape this file uses is declared here rather than imported.
 */
const SDK_ENTRY = '../../sdk/index';
interface SdkClient {
  core: { ready(): Promise<boolean>; postJson(path: string, body: unknown): Promise<{ status: number }>; readonly profileSessionId: string;
    readonly consent: { tracking: boolean; personalization: boolean } };
  emit: { pageView(data?: Record<string, unknown>): Promise<unknown>; productView(id: string, attrs?: Record<string, unknown>): Promise<unknown>;
    addToCart(id: string, attrs?: Record<string, unknown>): Promise<unknown>; purchase(input: Record<string, unknown>): Promise<unknown> };
  listen: { hydrate(o: { page: string }): Promise<{ arm?: string; decisions: Array<{ contentId: string }> } | null> };
  identify(accountId: string, options: { getAssertion(claim: { tenant: string; visitorId: string; accountId: string }): Promise<{ assertion: string; exp: number }> }):
    Promise<{ ok: true; outcome: string | null } | { ok: false; status: number }>;
  on(event: 'update', fn: (update: EngineUpdate) => void): () => void;
  destroy(): void;
}
async function sdkEntry(): Promise<{ createClient(config: { tenant: string; endpoint: string; source: string }, host: SdkHost): SdkClient }> {
  return import(/* @vite-ignore */ SDK_ENTRY) as Promise<{ createClient(config: { tenant: string; endpoint: string; source: string }, host: SdkHost): SdkClient }>;
}

// ── The fixture: the tenant's published catalogue, in the customer's taxonomy ─
const TENANT = 'meridian';
const BACKEND_PROOF = 'w35-backend-proof'; // harness IDENTITY_SECRETS
const PIECES = [
  { id: 'tabby-lookbook', customerContentId: 'cms-tabby', type: 'lookbook', title: 'Tabby, black leather', tags: { line: ['Tabby'], category: ['Handbags'] }, slotTypes: ['hero'], lifecycle: { status: 'live' } },
  { id: 'rogue-story', customerContentId: 'cms-rogue', type: 'editorial', title: 'Rogue', tags: { line: ['Rogue'], category: ['Handbags'] }, slotTypes: ['hero'], lifecycle: { status: 'live' } },
  { id: 'lowline-shoes', customerContentId: 'cms-lowline', type: 'editorial', title: 'Lowline sneakers', tags: { line: ['Lowline'], category: ['Shoes'] }, slotTypes: ['hero'], lifecycle: { status: 'live' } },
];
// A fatigue dial on the hero (CW30), so the served-count path is part of the sequence.
const SLOTS = { pages: { home: [{ slot: 'hero', take: 3, weights: { line: 1, category: 0.5 }, fatigue: { weight: 0.5, windowHours: 24, cap: 3 } }] } };
const LEARN = { holdout: { share: 0, salt: 'w35-ledger', arms: ['default'] }, slots: { hero: { measurementBasis: 'rendered-v1', gamma: 0 } } };
const INSTAGRAM = { utmMedium: 'paid_social', utmSource: 'instagram', referrer: 'www.instagram.com', siteHost: 'shop.invalid' };
const NEWSLETTER = { utmMedium: 'email', utmSource: 'newsletter', referrer: '', siteHost: 'shop.invalid' };
const TABBY_450 = { productId: 'tabby-26-black', line: 'Tabby', category: 'Handbags', subcategory: 'Crossbody', silhouette: 'structured', price_usd: 450 };
const TABBY_395 = { productId: 'tabby-20-black', line: 'Tabby', category: 'Handbags', subcategory: 'Crossbody', silhouette: 'structured', price_usd: 395 };
const LOWLINE = { productId: 'lowline-sneaker', line: 'Lowline', category: 'Shoes', price_usd: 150 };
const ROGUE = { productId: 'rogue-25', line: 'Rogue', category: 'Handbags', price_usd: 550 };
/** A product the tenant does not hold, every value of which its catalogue refuses. */
const UNKNOWN = { productId: 'not-a-held-sku', line: 'Not-A-Line', category: 'Not-A-Category' };
const VISIT_ONE: Array<{ type: string; data: Record<string, unknown>; entry?: typeof INSTAGRAM }> = [
  { type: 'page_view', data: {}, entry: INSTAGRAM },
  { type: 'product_view', data: TABBY_450 },
  { type: 'product_view', data: TABBY_395 },
  { type: 'product_view', data: LOWLINE },
  { type: 'product_view', data: UNKNOWN },
  { type: 'add_to_cart', data: TABBY_450 },
  { type: 'wishlist_add', data: LOWLINE },
  { type: 'purchase', data: { orderId: 'w35-order-1', value: 450, currency: 'USD', items: [{ productId: TABBY_450.productId, quantity: 1, price: 450 }] } },
  { type: 'product_view', data: ROGUE },
];
const UNKNOWN_INDEX = 4;
const VISIT_TWO: Array<{ type: string; data: Record<string, unknown>; entry?: typeof NEWSLETTER }> = [
  { type: 'page_view', data: {}, entry: NEWSLETTER },
  { type: 'product_view', data: ROGUE },
];
const CANDIDATES = [
  { id: 'rogue-25', line: 'Rogue', category: 'Handbags' }, { id: 'lowline-sneaker', line: 'Lowline', category: 'Shoes' },
  { id: 'tabby-26-black', line: 'Tabby', category: 'Handbags' }, { id: 'other-brand-item', line: 'Unlisted', category: 'Unlisted' },
];

// ── Helpers ────────────────────────────────────────────────────────────────
type Json = Record<string, unknown>;
async function body(response: Response): Promise<Json> { const text = await response.text(); try { return JSON.parse(text) as Json; } catch { return { raw: text }; } }
/** Stable placeholders for per-run ids, in order of first appearance, so two hosts' records line up. */
function normalizer() {
  const names = new Map<string, string>(), counts = new Map<string, number>();
  const name = (value: string, kind: string) => {
    if (!names.has(value)) { const n = counts.get(kind) ?? 0; counts.set(kind, n + 1); names.set(value, `${kind}#${n}`); }
    return names.get(value)!;
  };
  return (value: unknown): unknown => JSON.parse(JSON.stringify(value ?? null)
    .replace(/vis-[0-9a-f-]{36}/g, v => name(v, 'visitor'))
    .replace(/s-[0-9a-f-]{36}/g, v => name(v, 'session'))
    .replace(/sh_[0-9a-f]{32}/g, v => name(v, 'shopper'))
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, v => name(v, 'id')));
}
async function operatorToken(h: Harness) {
  return new SignJWT({ sub: 'w35-ledger-operator', type: 'service', roles: ['admin'] }).setProtectedHeader({ alg: 'HS256' })
    .setIssuer('i').setAudience('a').setExpirationTime('5m').sign(new TextEncoder().encode(h.env.JWT_SECRET));
}
async function signedLink(h: Harness, who: Shopper, accountId: string) {
  const exp = Math.floor(Date.now() / 1000) + 120;
  const assertion = await signAssertion(BACKEND_PROOF, TENANT, who.subject, accountId, exp);
  return h.call(`/v1/${TENANT}/identity/link`, { capability: who.capability, body: { visitorId: who.subject, accountId, exp, assertion } });
}
const act = (h: Harness, who: Shopper, event: { type: string; data: Json; entry?: unknown }, extra: Json = {}) =>
  h.call('/realtime/action', { capability: who.capability, body: { ...event, ...extra, source: 'sdk', userId: who.subject, sessionId: who.sessionId } });
/** The owned record's behavioural state, rounded, as the object stores it. */
function ownerState(h: Harness, subject: string) {
  const item = h.shoppers.get(tenantKey(TENANT, subject));
  const affinity = item?.data.get('affinity') as { reflex?: { dims?: Record<string, Record<string, { s: number }>>; audiences?: string[] } } | undefined;
  const pipeline = item?.data.get('pipeline') as { attributes?: Json; segments?: string[]; journey?: unknown; journeyStage?: string } | undefined;
  const { last_activity: _time, ...attributes } = (pipeline?.attributes ?? {}) as Json; void _time;
  return {
    dims: Object.fromEntries(Object.entries(affinity?.reflex?.dims ?? {}).map(([dim, values]) =>
      [dim, Object.fromEntries(Object.entries(values).map(([value, entry]) => [value, Math.round(entry.s * 1e6) / 1e6]))])),
    audiences: [...(affinity?.reflex?.audiences ?? [])].sort(), attributes, segments: [...(pipeline?.segments ?? [])].sort(),
    journey: pipeline?.journey ?? null, stage: pipeline?.journeyStage ?? null,
  };
}

// ── A1 · the host leg: one event sequence through both hosts ────────────────
interface Observed { checkpoints: Record<string, unknown>; anchors: Record<string, unknown> }

async function sequenceOn(host: Host, t0: number, clock: { mockReturnValue(value: number): unknown }): Promise<Observed> {
  let now = t0; clock.mockReturnValue(now);
  const tick = (ms = 1000) => { now += ms; clock.mockReturnValue(now); };
  invalidateCache(); invalidateLiftCache();
  const h = harness(host); h.env.LEDGER_RECOVERY_ENABLED = 'true';
  await publish(h.env, TENANT, { content: { pieces: PIECES }, slots: SLOTS, learn: LEARN });
  const checkpoints: Record<string, unknown> = {}, anchors: Record<string, unknown> = {};
  const answer = (b: Json) => ({ success: b.success, dropped: b.dropped ?? null, signals: b.signals ?? null, sessionId: b.sessionId ?? null, error: b.error ?? null });
  const reads = async (who: Shopper, label: string) => {
    const reflex = await h.call('/realtime/reflex', { capability: who.capability });
    const reflexBody = await body(reflex);
    const { now: _now, ...reflexAnswer } = reflexBody; void _now;
    checkpoints[`${label} · GET /realtime/reflex`] = [reflex.status, reflexAnswer];
    const segments = await h.call(`/realtime/segments/${who.subject}`, { capability: who.capability });
    const { timestamp: _t1, ...segmentsAnswer } = await body(segments); void _t1;
    checkpoints[`${label} · GET /realtime/segments`] = [segments.status, segmentsAnswer];
    const personalization = await h.call(`/realtime/personalization/${who.subject}`, { capability: who.capability });
    const { timestamp: _t2, ...personalizationAnswer } = await body(personalization); void _t2;
    checkpoints[`${label} · GET /realtime/personalization`] = [personalization.status, personalizationAnswer];
    const pageInstance = `w35-page-${label.replace(/[^a-z0-9]/gi, '-')}`;
    const snapshot = await h.call(`/v1/${TENANT}/decisions/snapshot`, { capability: who.capability, body: { page: 'home', pageInstance } });
    const set = await body(snapshot) as { arm?: string; experiment?: unknown; decisions?: Array<{ contentId: string; slot: string; decisionId?: string; renderOffer?: string; explain?: { drivers?: Array<{ dim: string; value: string }> } }>; sources?: { journey?: unknown; consent?: { tracking?: boolean; personalization?: boolean; personalized?: boolean }; state?: string } };
    checkpoints[`${label} · decision snapshot`] = [snapshot.status, { arm: set.arm, experiment: set.experiment ?? null,
      decisions: (set.decisions ?? []).map(d => ({ contentId: d.contentId, slot: d.slot, drivers: (d.explain?.drivers ?? []).map(x => `${x.dim}:${x.value}`) })),
      journey: set.sources?.journey ?? null, consent: set.sources?.consent ? { tracking: set.sources.consent.tracking, personalization: set.sources.consent.personalization, personalized: set.sources.consent.personalized } : null }];
    const sort = await h.call('/sort', { capability: who.capability, body: { userId: who.subject, sessionId: who.sessionId, candidates: CANDIDATES } });
    const sorted = await body(sort) as { order?: unknown; items?: unknown; persistence?: { status?: string }; configVersion?: unknown };
    checkpoints[`${label} · POST /sort`] = [sort.status, { order: sorted.order ?? null, items: sorted.items ?? null, configVersion: sorted.configVersion ?? null, persistence: sorted.persistence?.status ?? null }];
    return { reflex: reflexBody, set, pageInstance };
  };

  // Visit one: Sarah, from an Instagram ad.
  const sarah = await openSession(h);
  checkpoints['explicit choice (tracking and personalization on)'] = (await choose(h, sarah, true, true)).status;
  const visitOne: unknown[] = [];
  for (const [index, event] of VISIT_ONE.entries()) {
    tick(); const response = await act(h, sarah, event, { eventId: `w35-v1-${index}`, timestamp: now });
    const b = await body(response); visitOne.push([response.status, answer(b)]);
    if (index === UNKNOWN_INDEX) anchors.unknownProduct = [response.status, b.dropped ?? null, (b.signals as { unrecognized?: unknown } | undefined)?.unrecognized ?? null];
  }
  checkpoints['visit one · every action answer'] = visitOne;
  await h.drain(); tick();
  const first = await reads(sarah, 'visit one');
  anchors.visitOne = (first.reflex as { visit?: unknown }).visit ?? null;
  // Her page renders the offered hero: the render acknowledgements are the fatigue input (CW30).
  const acks: unknown[] = [];
  for (const [position, decision] of (first.set.decisions ?? []).entries()) {
    if (!decision.renderOffer) continue;
    tick(); const response = await act(h, sarah, { type: 'content_impression', data: { contentId: decision.contentId, decisionId: decision.decisionId,
      renderOffer: decision.renderOffer, page: 'home', pageInstance: first.pageInstance, slot: decision.slot, position } }, { eventId: `w35-ack-${position}`, timestamp: now });
    const b = await body(response); acks.push([response.status, (b.render as { status?: string } | undefined)?.status ?? null]);
  }
  checkpoints['render acknowledgements of the offered hero'] = acks;
  anchors.acks = acks;
  await h.drain(); tick();
  const rendered = await reads(sarah, 'after the rendered hero');
  anchors.fatigue = (rendered.set.decisions ?? []).map(d => [d.contentId, (d.explain?.drivers ?? []).filter(x => x.dim === 'fatigue').map(x => x.value)]);

  // Visit two, after the visit gap, from the newsletter.
  tick(VISIT_GAP_MS + 60_000);
  const visitTwo: unknown[] = [];
  for (const [index, event] of VISIT_TWO.entries()) { tick(); const response = await act(h, sarah, event, { eventId: `w35-v2-${index}`, timestamp: now }); visitTwo.push([response.status, answer(await body(response))]); }
  checkpoints['visit two · every action answer'] = visitTwo;
  await h.drain(); tick();
  anchors.visitTwo = ((await reads(sarah, 'visit two')).reflex as { visit?: unknown }).visit ?? null;

  // Consent: she withdraws personalization, browses tracked-only, and turns it back on.
  tick(); checkpoints['explicit choice (personalization off)'] = (await choose(h, sarah, true, false)).status;
  tick(); const off = await act(h, sarah, { type: 'product_view', data: TABBY_450 }, { eventId: 'w35-off-0', timestamp: now });
  checkpoints['tracked-only action answer'] = [off.status, answer(await body(off))];
  await h.drain(); tick();
  anchors.personalizationOff = ((await reads(sarah, 'personalization off')).reflex as { consent?: unknown; affinity?: unknown });
  tick(); checkpoints['explicit choice (personalization on again)'] = (await choose(h, sarah, true, true)).status;
  tick();
  const beforeLink = await reads(sarah, 'personalization on again');

  // Identity: she signs in; the link folds her browser's profile into the person (no tick in between).
  const linked = await signedLink(h, sarah, 'w35-ledger-person');
  const link = await body(linked) as { outcome?: string; shopperId?: string; audiences?: unknown; changes?: unknown; carry?: string; session?: Shopper & { consent?: { tracking?: boolean; personalization?: boolean } } };
  checkpoints['link · answer'] = [linked.status, { outcome: link.outcome ?? null, shopperId: link.shopperId ?? null, audiences: link.audiences ?? null, changes: link.changes ?? null,
    carry: link.carry ?? null, session: link.session ? { kind: link.session.kind, consent: { tracking: link.session.consent?.tracking, personalization: link.session.consent?.personalization } } : null }];
  const person = link.session as Shopper;
  const afterLink = await reads(person, 'the person, right after the link');
  anchors.link = { before: (beforeLink.reflex as { affinity?: { dims?: unknown } }).affinity?.dims ?? null, after: (afterLink.reflex as { affinity?: { dims?: unknown } }).affinity?.dims ?? null };
  tick(); const stale = await act(h, sarah, { type: 'product_view', data: TABBY_395 }, { eventId: 'w35-stale-0', timestamp: now });
  checkpoints['her old anonymous grant after the link'] = stale.status;
  anchors.staleGrant = stale.status;

  // A second device of hers signs in to the same person.
  const phone = await openSession(h); await choose(h, phone, true, true);
  tick(); const phoneView = await act(h, phone, { type: 'product_view', data: LOWLINE }, { eventId: 'w35-phone-0', timestamp: now });
  checkpoints['second device · action answer'] = [phoneView.status, answer(await body(phoneView))];
  tick(); const second = await signedLink(h, phone, 'w35-ledger-person');
  const secondLink = await body(second) as typeof link;
  checkpoints['second device · link answer'] = [second.status, { outcome: secondLink.outcome ?? null, shopperId: secondLink.shopperId ?? null, audiences: secondLink.audiences ?? null,
    changes: secondLink.changes ?? null, session: secondLink.session ? { kind: secondLink.session.kind } : null }];
  tick(); await reads(secondLink.session as Shopper, 'the person, from the second device');
  const token = await operatorToken(h);
  const identity = await h.call(`/v1/${TENANT}/identity/shopper/${link.shopperId}`, { headers: { Authorization: `Bearer ${token}` } });
  const devices = ((await body(identity) as { shopper?: { visitors?: Array<{ visitorId?: string; assurance?: string; source?: string }> } }).shopper?.visitors ?? []);
  checkpoints['identity · the person\'s linked devices'] = [identity.status, devices.map(v => ({ visitorId: v.visitorId, assurance: v.assurance, source: v.source }))];
  anchors.identity = [identity.status, devices.map(v => v.visitorId).sort(), [sarah.subject, phone.subject].sort()];
  anchors.sort = checkpoints['visit one · POST /sort'];

  // Erasure of the person, retried while the operator is told it is pending.
  tick(); let erased: Json = {}, erasedStatus = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await h.call(`/v1/${TENANT}/identity/erase`, { body: { shopperId: link.shopperId }, headers: { Authorization: `Bearer ${token}` } });
    erasedStatus = response.status; erased = await body(response); await h.drain();
    if (erasedStatus !== 202) break;
  }
  const profiles = ((erased.profiles ?? []) as Array<{ host: string; result: string }>).map(p => `${p.host}:${p.result}`).sort();
  checkpoints['erase · the final receipt'] = [erasedStatus, { status: erased.status ?? null, localComplete: erased.localComplete ?? null, complete: erased.complete ?? null,
    links: erased.links ?? null, profiles, targets: ((erased.targets ?? []) as unknown[]).length }];
  const afterErase = await h.call('/realtime/reflex', { capability: person.capability });
  checkpoints['erase · the person\'s grant afterwards'] = afterErase.status;
  anchors.erase = { status: erased.status ?? null, grant: afterErase.status };
  const laptop = await openSession(h); await choose(h, laptop, true, true);
  tick(); const relinked = await signedLink(h, laptop, 'w35-ledger-person');
  const relink = await body(relinked) as typeof link;
  checkpoints['erase · signing in again'] = [relinked.status, relink.outcome ?? null];
  if (relink.session) anchors.relinked = ((await reads(relink.session as Shopper, 'the person, signed in again after erasure')).reflex as { affinity?: unknown }).affinity ?? null;
  return { checkpoints, anchors };
}

// ── A1 · the SDK leg ───────────────────────────────────────────────────────
/**
 * Every cookie value or cookie header one update carries: a `cookies` or
 * `cookieHeaders` member that is not empty, or any other string shaped as an
 * assignment of one of the platform's own `opt_*` cookies. The documented
 * `personalization_update` (docs/kit/03-payload-schemas.md:545) has no cookie
 * member at all, and the session cookie is HttpOnly
 * (`opt_session_id=…; HttpOnly`): page script must never read it.
 */
function cookieCarriage(update: Json): string[] {
  const found: string[] = [];
  const empty = (value: unknown) => (Array.isArray(value) && value.length === 0)
    || (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0);
  for (const member of ['cookies', 'cookieHeaders']) {
    if (Object.hasOwn(update, member) && !empty(update[member])) found.push(`${member}: ${JSON.stringify(update[member])}`);
  }
  JSON.stringify(update, (key, value: unknown) => {
    if (key === 'cookies' || key === 'cookieHeaders') return undefined;
    if (typeof value === 'string' && /\bopt_[a-z_]+=/.test(value)) found.push(`${key}: ${value}`);
    return value;
  });
  return found;
}

/** A browser page for the real SDK entry: jsdom supplies the page, the harness is the network. */
function page(h: Harness, url: string, referrer: string, storage: Map<string, string>, now: () => number): SdkHost {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url, ...(referrer ? { referrer } : {}) });
  const location = dom.window.location;
  return memoryHost({
    acquireAuthorityLock: authorityLocks(), now, uuid: () => crypto.randomUUID(),
    storage: { get: key => storage.get(key) ?? null, set: (key, value) => { storage.set(key, value); } },
    location: { get href() { return location.href; }, host: location.host, hostname: location.hostname, protocol: location.protocol, get search() { return location.search; } },
    referrer: dom.window.document.referrer,
    fetch: async (target, init): Promise<ResponseLike> => {
      const response = await h.app.request(new Request(target, { method: init?.method ?? 'GET', headers: init?.headers as Record<string, string> | undefined, body: init?.body }),
        undefined, h.env, { waitUntil: () => {}, passThroughOnException() {}, props: {} });
      const text = await response.text();
      return { ok: response.ok, status: response.status, json: async () => JSON.parse(text) as unknown };
    },
  });
}

async function sdkSequenceOn(host: Host, t0: number, clock: { mockImplementation(fn: () => number): unknown }): Promise<unknown[]> {
  let now = t0; clock.mockImplementation(() => now);
  const tick = (ms = 1000) => { now += ms; };
  invalidateCache(); invalidateLiftCache();
  const h = harness(host);
  await publish(h.env, TENANT, { content: { pieces: PIECES }, slots: SLOTS, learn: LEARN });
  const storage = new Map<string, string>(), seen: unknown[] = [];
  const { createClient } = await sdkEntry();
  const open = (url: string, referrer: string) => {
    const client = createClient({ tenant: TENANT, endpoint: 'https://w35.invalid', source: 'sdk' }, page(h, url, referrer, storage, () => now));
    client.on('update', (update: EngineUpdate) => {
      const { timestamp: _t, serverTimestamp: _s, decisionMs: _d, ...rest } = (update ?? {}) as Json; void _t; void _s; void _d;
      seen.push({ update: rest });
    });
    return client;
  };
  const tab = open('https://shop.invalid/?utm_source=instagram&utm_medium=paid_social', 'https://www.instagram.com/');
  seen.push({ ready: await tab.core.ready() });
  seen.push({ choice: (await tab.core.postJson(`/realtime/session/${tab.core.profileSessionId}/preferences`, { trackingConsent: true, personalizationEnabled: true })).status });
  tick(); await tab.emit.pageView();
  tick(); await tab.emit.productView(TABBY_450.productId, { ...TABBY_450 });
  tick(); await tab.emit.productView(TABBY_395.productId, { ...TABBY_395 });
  tick(); await tab.emit.productView(LOWLINE.productId, { ...LOWLINE });
  tick(); await tab.emit.productView(UNKNOWN.productId, { ...UNKNOWN });
  tick(); await tab.emit.addToCart(TABBY_450.productId, { ...TABBY_450 });
  tick(); const home = await tab.listen.hydrate({ page: 'home' });
  seen.push({ decisions: home ? { arm: home.arm, contentIds: home.decisions.map(d => d.contentId) } : null });
  tick(); await tab.emit.purchase({ orderId: 'w35-sdk-order', value: 450, currency: 'USD', items: [{ productId: TABBY_450.productId, quantity: 1, price: 450 }] });
  tab.destroy();
  tick(VISIT_GAP_MS + 60_000);
  const next = open('https://shop.invalid/?utm_source=newsletter&utm_medium=email', '');
  seen.push({ ready: await next.core.ready() });
  tick(); await next.emit.pageView();
  tick(); await next.emit.productView(ROGUE.productId, { ...ROGUE });
  tick(); const again = await next.listen.hydrate({ page: 'home' });
  seen.push({ decisions: again ? { arm: again.arm, contentIds: again.decisions.map(d => d.contentId) } : null });
  const identified = await next.identify('w35-ledger-sdk-person', { getAssertion: async claim => {
    const exp = Math.floor(now / 1000) + 120;
    return { exp, assertion: await signAssertion(BACKEND_PROOF, claim.tenant, claim.visitorId, claim.accountId, exp) };
  } });
  seen.push({ identified: identified.ok ? { ok: true, outcome: identified.outcome } : { ok: false, status: identified.status } });
  tick(); const signedIn = await next.listen.hydrate({ page: 'home' });
  seen.push({ decisions: signedIn ? { arm: signedIn.arm, contentIds: signedIn.decisions.map(d => d.contentId) } : null, consent: next.core.consent });
  tick(); await next.emit.productView(TABBY_395.productId, { ...TABBY_395 });
  next.destroy();
  return normalizer()(seen) as unknown[];
}

// ── A1 · the host leg: she chose tracking only, then signs in ───────────────
// The sequence the W41 specifier measured at base 4fbdddc (evidence
// /home/simonecoelho/rem/_evidence/step3/W40-W41/specifier/REPORT.md, item 3):
// a shopper who signs in after choosing tracking only (personalization off) is
// answered 401 "Shopper session unavailable" on her first /realtime/action on
// the session host, while the object host admits her. Witnesses:
// docs/kit/02-api-reference.md:447 ("Tracking-only measurement remains
// permitted; both switches are required for personalization"; linking does not
// renew or change her choice), settled decision D06-W05 (explicit choice), and
// docs/api/01-rest-endpoints.md:26 (the object host answers the identical shape).
const TRACKING_ONLY_PERSON = 'w35-ledger-tracking-only-person';
async function trackingOnlySignInOn(host: Host, t0: number, clock: { mockReturnValue(value: number): unknown }): Promise<Observed> {
  let now = t0; clock.mockReturnValue(now);
  const tick = (ms = 1000) => { now += ms; clock.mockReturnValue(now); };
  invalidateCache(); invalidateLiftCache();
  const h = harness(host); h.env.LEDGER_RECOVERY_ENABLED = 'true';
  await publish(h.env, TENANT, { content: { pieces: PIECES }, slots: SLOTS, learn: LEARN });
  const checkpoints: Record<string, unknown> = {}, anchors: Record<string, unknown> = {};
  /** Every answer to a request she makes with her signed-in grant, in order: none may be a refusal. */
  const admitted: Array<[string, number]> = [];
  const answer = (b: Json) => ({ success: b.success, dropped: b.dropped ?? null, signals: b.signals ?? null, sessionId: b.sessionId ?? null, error: b.error ?? null });
  const action = async (who: Shopper, label: string, event: { type: string; data: Json; entry?: unknown }, eventId: string) => {
    tick(); const response = await act(h, who, event, { eventId, timestamp: now });
    const b = await body(response); admitted.push([label, response.status]);
    checkpoints[label] = [response.status, answer(b)];
    return [response.status, b.success ?? null] as const;
  };
  // Her reads, with the same projections as the one-sequence host leg above.
  const reads = async (who: Shopper, label: string) => {
    const reflex = await h.call('/realtime/reflex', { capability: who.capability });
    const reflexBody = await body(reflex); admitted.push([`${label} · GET /realtime/reflex`, reflex.status]);
    const { now: _now, ...reflexAnswer } = reflexBody; void _now;
    checkpoints[`${label} · GET /realtime/reflex`] = [reflex.status, reflexAnswer];
    const segments = await h.call(`/realtime/segments/${who.subject}`, { capability: who.capability });
    const { timestamp: _t1, ...segmentsAnswer } = await body(segments); void _t1; admitted.push([`${label} · GET /realtime/segments`, segments.status]);
    checkpoints[`${label} · GET /realtime/segments`] = [segments.status, segmentsAnswer];
    const personalization = await h.call(`/realtime/personalization/${who.subject}`, { capability: who.capability });
    const { timestamp: _t2, ...personalizationAnswer } = await body(personalization); void _t2; admitted.push([`${label} · GET /realtime/personalization`, personalization.status]);
    checkpoints[`${label} · GET /realtime/personalization`] = [personalization.status, personalizationAnswer];
    const snapshot = await h.call(`/v1/${TENANT}/decisions/snapshot`, { capability: who.capability, body: { page: 'home', pageInstance: `w35-tracking-only-${label.replace(/[^a-z0-9]/gi, '-')}` } });
    const set = await body(snapshot) as { arm?: string; experiment?: unknown; decisions?: Array<{ contentId: string; slot: string; explain?: { drivers?: Array<{ dim: string; value: string }> } }>; sources?: { journey?: unknown; consent?: { tracking?: boolean; personalization?: boolean; personalized?: boolean } } };
    admitted.push([`${label} · decision snapshot`, snapshot.status]);
    checkpoints[`${label} · decision snapshot`] = [snapshot.status, { arm: set.arm, experiment: set.experiment ?? null,
      decisions: (set.decisions ?? []).map(d => ({ contentId: d.contentId, slot: d.slot, drivers: (d.explain?.drivers ?? []).map(x => `${x.dim}:${x.value}`) })),
      journey: set.sources?.journey ?? null, consent: set.sources?.consent ? { tracking: set.sources.consent.tracking, personalization: set.sources.consent.personalization, personalized: set.sources.consent.personalized } : null }];
    const sort = await h.call('/sort', { capability: who.capability, body: { userId: who.subject, sessionId: who.sessionId, candidates: CANDIDATES } });
    const sorted = await body(sort) as { order?: unknown; items?: unknown; persistence?: { status?: string }; configVersion?: unknown };
    admitted.push([`${label} · POST /sort`, sort.status]);
    checkpoints[`${label} · POST /sort`] = [sort.status, { order: sorted.order ?? null, items: sorted.items ?? null, configVersion: sorted.configVersion ?? null, persistence: sorted.persistence?.status ?? null }];
    return reflexBody;
  };

  // Sarah lands from Instagram and chooses tracking only; she has made no event yet.
  const sarah = await openSession(h);
  checkpoints['explicit choice (tracking on, personalization off)'] = (await choose(h, sarah, true, false)).status;
  // She signs in: a first link of this browser to a new person.
  tick(); const linked = await signedLink(h, sarah, TRACKING_ONLY_PERSON);
  const link = await body(linked) as { outcome?: string; shopperId?: string; audiences?: unknown; changes?: unknown; carry?: string; session?: Shopper & { consent?: { tracking?: boolean; personalization?: boolean } } };
  checkpoints['link · answer'] = [linked.status, { outcome: link.outcome ?? null, shopperId: link.shopperId ?? null, audiences: link.audiences ?? null, changes: link.changes ?? null,
    carry: link.carry ?? null, session: link.session ? { kind: link.session.kind, consent: { tracking: link.session.consent?.tracking, personalization: link.session.consent?.personalization } } : null }];
  const person = link.session as Shopper;
  // Her first /realtime/action as the signed-in person, then her browsing, a cross-category view among it.
  anchors.firstAction = await action(person, 'signed in, tracking only · her first action (page_view, from Instagram)', { type: 'page_view', data: {}, entry: INSTAGRAM }, 'w35-tracking-only-0');
  await action(person, 'signed in, tracking only · product_view (Tabby crossbody)', { type: 'product_view', data: TABBY_450 }, 'w35-tracking-only-1');
  await action(person, 'signed in, tracking only · product_view (Lowline, another category)', { type: 'product_view', data: LOWLINE }, 'w35-tracking-only-2');
  await h.drain(); tick();
  anchors.trackingOnly = await reads(person, 'signed in, tracking only');
  // She turns personalization on with her signed-in grant, and browses on.
  tick(); const on = await choose(h, person, true, true); admitted.push(['explicit choice (personalization on)', on.status]);
  checkpoints['explicit choice (personalization on), signed in'] = on.status;
  await action(person, 'signed in, personalization on · product_view (Rogue)', { type: 'product_view', data: ROGUE }, 'w35-tracking-only-3');
  await h.drain(); tick();
  anchors.optedIn = await reads(person, 'signed in, personalization on');
  anchors.admitted = admitted;
  return { checkpoints, anchors };
}

describe('unit:W35.A1', () => {
  it('host: one event sequence — Sarah\'s Instagram visit with a cross-category and an unknown product, her rendered hero, a newsletter return visit, a personalization withdrawal and return, her sign-in from two devices and her erasure — leaves the same session, identity, visit, channel and consent state and the same link, erase, sort and fatigue results on the session host and the object host', async () => {
    const t0 = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(t0);
    const observed: Partial<Record<Host, Observed>> = {};
    try {
      for (const host of HOSTS) observed[host] = await sequenceOn(host, t0, clock);
    } finally { clock.mockRestore(); vi.restoreAllMocks(); }
    const session = observed.session!, object = observed.do!;
    // Parity: every checkpoint of the one sequence, host against host.
    // Ids are replaced per checkpoint, so one divergence cannot shift the next checkpoint's names.
    for (const key of Object.keys(session.checkpoints)) {
      expect.soft(normalizer()(object.checkpoints[key]), `W35.A1 — ${key}: the object host answers exactly what the session host answers`)
        .toEqual(normalizer()(session.checkpoints[key]));
    }
    expect.soft(Object.keys(object.checkpoints), 'W35.A1 — the object host reaches every checkpoint of the sequence').toEqual(Object.keys(session.checkpoints));
    // Witness anchors, on each host, so that parity cannot be reached by both hosts losing the same thing.
    for (const [host, run] of [['session', session], ['object', object]] as const) {
      expect.soft(run.anchors.visitOne, `W35.A1 (${host} host) — visit one is her first visit, entered from paid social (F13; visit.ts)`).toEqual({ visitNumber: 1, entryChannel: 'paid_social' });
      expect.soft(run.anchors.visitTwo, `W35.A1 (${host} host) — after the visit gap the newsletter opens her second visit (F13; VISIT_GAP_MS)`).toEqual({ visitNumber: 2, entryChannel: 'email' });
      expect.soft(run.anchors.unknownProduct, `W35.A1 (${host} host) — a product the tenant does not hold, every value refused, is dropped and counted, never scored, and names the product (doc 16:269; kit 02:111-113)`)
        .toEqual([200, 'unknown_product', [UNKNOWN.productId]]);
      expect.soft(run.anchors.fatigue, `W35.A1 (${host} host) — the rendered hero carries its served count into the next decision (CW30 fatigue)`)
        .toEqual(expect.arrayContaining([['tabby-lookbook', ['served 1 time in 24 h']]]));
      expect.soft(run.anchors.personalizationOff, `W35.A1 (${host} host) — with personalization withdrawn the hydrate carries no profile and her switches (D06-W05)`)
        .toMatchObject({ affinity: null, consent: { tracking: true, personalization: false } });
      expect.soft((run.anchors.link as { after: unknown }).after, `W35.A1 (${host} host) — her first sign-in folds her browser's whole profile into the person: the person's taste right after the link is her browser's taste right before it (link.ts:1-22)`)
        .toEqual((run.anchors.link as { before: unknown }).before);
      expect.soft(run.anchors.staleGrant, `W35.A1 (${host} host) — her superseded anonymous grant writes nothing after the link`).toBe(401);
      expect.soft(run.anchors.acks, `W35.A1 (${host} host) — each offered hero piece she rendered is acknowledged durably (W15 render admission)`).toEqual([[200, 'durable'], [200, 'durable'], [200, 'durable']]);
      const [identityStatus, linkedDevices, herDevices] = run.anchors.identity as [number, string[], string[]];
      expect.soft({ status: identityStatus, devices: linkedDevices }, `W35.A1 (${host} host) — the person's identity holds exactly her two signed-in devices (link contract)`).toEqual({ status: 200, devices: herDevices });
      const [sortStatus, sorted] = run.anchors.sort as [number, { order: unknown[] | null; persistence: string | null }];
      expect.soft({ status: sortStatus, candidates: sorted.order?.length ?? 0 }, `W35.A1 (${host} host) — the sort answers her whole candidate page (candidate-preserving)`).toEqual({ status: 200, candidates: CANDIDATES.length });
      expect.soft(run.anchors.erase, `W35.A1 (${host} host) — the person is erased locally and her grant no longer reads anything`).toEqual({ status: 'local_complete', grant: 401 });
      expect.soft(run.anchors.relinked, `W35.A1 (${host} host) — signing in again after erasure starts from nothing: no taste, no audience`).toMatchObject({ dims: {}, audiences: [] });
    }
  }, 120_000);

  it('sdk: the real SDK entry (createClient) on a jsdom page, driven through the same journey — Instagram landing, browsing with an unknown product, hydrate, purchase, a newsletter return page, sign-in — receives the same updates, decisions, identity and consent from the session host and the object host, and from neither host an update carrying a cookie value or a cookie header', async () => {
    const t0 = Date.now(), clock = vi.spyOn(Date, 'now');
    const seen: Partial<Record<Host, unknown[]>> = {};
    try {
      for (const host of HOSTS) seen[host] = await sdkSequenceOn(host, t0, clock);
    } finally { clock.mockRestore(); vi.restoreAllMocks(); }
    expect.soft(seen.do, 'W35.A1 — the SDK sees the same stream of updates, decisions, identity and consent from the object host as from the session host').toEqual(seen.session);
    const updates = (host: Host) => (seen[host] ?? []).filter((entry): entry is { update: Json } => typeof entry === 'object' && entry !== null && 'update' in entry);
    for (const host of HOSTS) {
      expect.soft(updates(host).length, `W35.A1 (${host} host) — the SDK receives personalization updates during the journey`).toBeGreaterThan(0);
      expect.soft(updates(host).map(u => u.update.journeyStage), `W35.A1 (${host} host) — every update names a journey word (kit 03:545)`)
        .toEqual(updates(host).map(() => expect.stringMatching(/^(exploring|thinking|deciding)$/)));
      // Per host, so parity cannot be reached by both hosts leaking: the session
      // host puts the shopper's cookie values and Set-Cookie headers — the
      // HttpOnly `opt_session_id` among them — in its update data today
      // (src/services/RealtimeSegmentEngine.ts:715-716).
      expect.soft(updates(host).flatMap((u, index) => cookieCarriage(u.update).map(found => `update ${index} · ${found}`)),
        `W35.A1 (${host} host) — no update the SDK receives carries a cookie value or a cookie header: the documented personalization_update has no cookie member (kit 03:545) and the HttpOnly session cookie never reaches page script`)
        .toEqual([]);
    }
  }, 120_000);

  it('host: a shopper who chooses tracking only (personalization off) and then signs in — her first /realtime/action as the signed-in person, her browsing and reads, her turning personalization on and her next view — is answered the same by the session host and the object host, and neither host refuses her', async () => {
    const t0 = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(t0);
    const observed: Partial<Record<Host, Observed>> = {};
    try {
      // The object host first: it is the host measured admitting her at base.
      for (const host of ['do', 'session'] as const) observed[host] = await trackingOnlySignInOn(host, t0, clock);
    } finally { clock.mockRestore(); vi.restoreAllMocks(); }
    const session = observed.session!, object = observed.do!;
    for (const key of Object.keys(object.checkpoints)) {
      expect.soft(normalizer()(session.checkpoints[key]), `W35.A1 (tracking only, then signed in) — ${key}: both hosts answer her the same (docs/api/01-rest-endpoints.md:26)`)
        .toEqual(normalizer()(object.checkpoints[key]));
    }
    expect.soft(Object.keys(session.checkpoints), 'W35.A1 (tracking only, then signed in) — the session host reaches every checkpoint of the sequence').toEqual(Object.keys(object.checkpoints));
    for (const [host, run] of [['object', object], ['session', session]] as const) {
      expect.soft(run.anchors.firstAction, `W35.A1 (${host} host) — her first /realtime/action after signing in with tracking only is admitted, never answered "Shopper session unavailable" (kit 02:447: tracking-only measurement remains permitted)`)
        .toEqual([200, true]);
      const admitted = run.anchors.admitted as Array<[string, number]>;
      expect.soft(admitted, `W35.A1 (${host} host) — no request she makes with her signed-in grant is refused: she consented to tracking (kit 02:447; D06-W05)`)
        .toEqual(admitted.map(([label]) => [label, 200]));
      expect.soft(run.anchors.trackingOnly, `W35.A1 (${host} host) — signed in with tracking only, her reads carry no profile and her own switches, carried to the person (kit 02:447; D06-W05)`)
        .toMatchObject({ affinity: null, consent: { tracking: true, personalization: false } });
      expect.soft(run.anchors.optedIn, `W35.A1 (${host} host) — once she turns personalization on, both switches are on and the view she makes next shapes her taste (kit 02:447: both switches are required for personalization)`)
        .toMatchObject({ consent: { tracking: true, personalization: true }, affinity: { dims: { line: { [ROGUE.line]: expect.any(Number) } } } });
    }
  }, 120_000);
});

// ── A2 · concurrency, stale pointers, delayed creates and restart ──────────
const BURST = [
  TABBY_450, TABBY_395, ROGUE, LOWLINE,
  { productId: 'tabby-18', line: 'Tabby', category: 'Handbags', price_usd: 350 },
  { productId: 'rogue-2', line: 'Rogue', category: 'Handbags', price_usd: 495 },
  { productId: 'lowline-2', line: 'Lowline', category: 'Shoes', price_usd: 175 },
  { productId: 'tabby-26-chalk', line: 'Tabby', category: 'Handbags', price_usd: 450 },
];
async function objectHost(t0: number, clock: { mockReturnValue(value: number): unknown }) {
  clock.mockReturnValue(t0); invalidateCache(); invalidateLiftCache();
  const h = harness('do');
  await publish(h.env, TENANT, { content: { pieces: PIECES }, slots: { pages: { home: [{ slot: 'hero', take: 3, weights: { line: 1, category: 0.5 } }] } } });
  const shopper = async () => { const g = await openSession(h); expect((await choose(h, g, true, true)).status, 'fixture: her explicit choice is accepted').toBe(200); return g; };
  return { h, shopper };
}
/** The verified principal a hibernated socket carries (ShopperReflex.ts:856). */
function socketOf(g: Shopper) {
  const { capability: _c, ...verified } = g as Shopper & Json; void _c;
  const { consent: _consent, ...principal } = verified as Json; void _consent;
  return { deserializeAttachment: () => ({ shopperId: g.subject, principal }), send: vi.fn(), close: vi.fn() };
}

describe('unit:W35.A2', () => {
  it('host: concurrent writes through the HTTP door, the shopper\'s socket and the buffered door leave the object host exactly the owner state the same writes leave one after another — no lost update', async () => {
    const t0 = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(t0);
    try {
      const { h, shopper } = await objectHost(t0, clock);
      const concurrent = await shopper(), sequential = await shopper();
      const sockets = new Map([concurrent, sequential].map(g => [g.subject, socketOf(g)]));
      for (const g of [concurrent, sequential]) h.shopper(TENANT, g.subject).sockets.push(sockets.get(g.subject) as unknown as WebSocket);
      clock.mockReturnValue(t0 + 1000);
      const writes = (g: Shopper) => [
        ...BURST.map((data, i) => () => act(h, g, { type: 'product_view', data }, { eventId: `w35-burst-${i}`, timestamp: t0 + 1000 }).then(r => r.status)),
        () => h.shopper(TENANT, g.subject).shopper.webSocketMessage(sockets.get(g.subject) as unknown as WebSocket,
          JSON.stringify({ type: 'action', event: { type: 'product_view', userId: g.subject, sessionId: g.sessionId, source: 'sdk', data: ROGUE } })).then(() => 'socket'),
        () => h.shopper(TENANT, g.subject).shopper.webSocketMessage(sockets.get(g.subject) as unknown as WebSocket,
          JSON.stringify({ type: 'action', event: { type: 'add_to_cart', userId: g.subject, sessionId: g.sessionId, source: 'sdk', data: TABBY_450 } })).then(() => 'socket'),
        () => act(h, g, { type: 'product_view', data: LOWLINE }, { processing: 'buffered', eventId: 'w35-buffered-0', timestamp: t0 + 500, browsingSessionId: 'w35-earlier-tab' }).then(r => r.status),
      ];
      const answers = await Promise.all(writes(concurrent).map(write => write()));
      for (const write of writes(sequential)) await write();
      expect.soft(answers, 'W35.A2 — every concurrent write is answered, none refused or failed').toEqual([...BURST.map(() => 200), 'socket', 'socket', 200]);
      expect.soft(sockets.get(concurrent.subject)!.close.mock.calls, 'W35.A2 — her socket stays open through the burst').toEqual([]);
      const burstState = ownerState(h, concurrent.subject);
      expect.soft(burstState, 'W35.A2 — the concurrent burst leaves exactly the owner state of the same writes applied one after another').toEqual(ownerState(h, sequential.subject));
      expect.soft(burstState.attributes.product_views, 'W35.A2 — all nine live product views are counted (eight over HTTP, one over her socket)').toBe(9);
      expect.soft(burstState.attributes.cart_adds, 'W35.A2 — the socket\'s cart add is counted').toBe(1);
      expect.soft(Object.keys(burstState.dims.line ?? {}).sort(), 'W35.A2 — every line she touched builds taste, the cross-category one included').toEqual(['Lowline', 'Rogue', 'Tabby']);
    } finally { clock.mockRestore(); vi.restoreAllMocks(); }
  }, 60_000);

  it('host: a brand-new shopper whose creating write is delayed keeps every later write, and the reads that arrive meanwhile create nothing', async () => {
    const t0 = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(t0);
    try {
      const { h, shopper } = await objectHost(t0, clock);
      const delayed = await shopper(), twin = await shopper();
      const stored = h.shopper(TENANT, delayed.subject);
      const put = stored.state.storage.put.bind(stored.state.storage);
      let entered!: () => void, release!: () => void, held = false;
      const reached = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
      const hold = vi.spyOn(stored.state.storage, 'put').mockImplementation(async (...args: Parameters<typeof stored.state.storage.put>) => {
        const key = args[0] as unknown;
        if (!held && typeof key === 'object' && key !== null && 'affinity' in key) { held = true; entered(); await gate; }
        return (put as (...a: unknown[]) => Promise<void>)(...args);
      });
      clock.mockReturnValue(t0 + 1000);
      const creating = act(h, delayed, { type: 'product_view', data: TABBY_450 });
      await reached;
      const meanwhile = [
        act(h, delayed, { type: 'product_view', data: TABBY_395 }), act(h, delayed, { type: 'product_view', data: LOWLINE }),
        act(h, delayed, { type: 'add_to_cart', data: TABBY_450 }),
        h.call(`/v1/${TENANT}/decisions/snapshot`, { capability: delayed.capability, body: { page: 'home' } }),
        h.call('/sort', { capability: delayed.capability, body: { userId: delayed.subject, sessionId: delayed.sessionId, candidates: CANDIDATES } }),
        h.call(`/realtime/personalization/${delayed.subject}`, { capability: delayed.capability }),
      ];
      await new Promise(resolve => setTimeout(resolve, 25));
      expect.soft([...stored.data.keys()].filter(key => key === 'affinity' || key === 'pipeline'), 'W35.A2 — while her creating write is delayed no read has created a profile of its own').toEqual([]);
      release();
      const statuses = (await Promise.all([creating, ...meanwhile])).map(r => r.status);
      hold.mockRestore();
      for (const data of [TABBY_450, TABBY_395, LOWLINE]) await act(h, twin, { type: 'product_view', data });
      await act(h, twin, { type: 'add_to_cart', data: TABBY_450 });
      expect.soft(statuses, 'W35.A2 — the delayed create and everything that arrived behind it are answered').toEqual([200, 200, 200, 200, 200, 200, 200]);
      expect.soft(ownerState(h, delayed.subject), 'W35.A2 — the delayed create did not overwrite the writes behind it: her state is the same writes applied in order').toEqual(ownerState(h, twin.subject));
      expect.soft(ownerState(h, delayed.subject).attributes.product_views, 'W35.A2 — all three product views survive the delayed create').toBe(3);
    } finally { clock.mockRestore(); vi.restoreAllMocks(); }
  }, 60_000);

  it('host: stale forwarding pointers — her writes racing her own sign-in, her superseded grant, and a history import read through a stale identity index — never lose an acknowledged update and never write to the retired record', async () => {
    const t0 = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(t0);
    try {
      const { h, shopper } = await objectHost(t0, clock);
      const sarah = await shopper();
      for (const data of [TABBY_450, TABBY_395]) expect((await act(h, sarah, { type: 'product_view', data })).status, 'fixture: her browsing is accepted').toBe(200);
      clock.mockReturnValue(t0 + 1000);
      const racing = [ROGUE, LOWLINE, BURST[4]!, BURST[5]!, BURST[6]!, BURST[7]!];
      const [first, second, linked, ...rest] = await Promise.all([
        act(h, sarah, { type: 'product_view', data: racing[0]! }), act(h, sarah, { type: 'product_view', data: racing[1]! }),
        signedLink(h, sarah, 'w35-ledger-race'),
        ...racing.slice(2).map(data => act(h, sarah, { type: 'product_view', data })),
      ]);
      const racingStatuses = [first!, second!, ...rest].map(r => r.status);
      const person = await shopperIdFor(h.env, TENANT, 'w35-ledger-race');
      expect.soft(linked!.status, 'W35.A2 — her sign-in completes while her own writes race it').toBe(200);
      expect.soft(racingStatuses.every(status => status === 200 || status === 401), 'W35.A2 — every racing write is either acknowledged or refused, never failed').toBe(true);
      const acknowledged = racingStatuses.filter(status => status === 200).length;
      expect.soft(ownerState(h, person).attributes.product_views, 'W35.A2 — every acknowledged write, before or during the link, is in the one owner state, the person\'s').toBe(2 + acknowledged);
      const retired = JSON.stringify([...h.shopper(TENANT, sarah.subject).data].filter(([key]) => key === 'affinity' || key === 'pipeline'));
      // The superseded grant, on every door that could write or read her profile.
      clock.mockReturnValue(t0 + 2000);
      const superseded = [
        (await act(h, sarah, { type: 'product_view', data: ROGUE })).status,
        (await act(h, sarah, { type: 'product_view', data: ROGUE }, { processing: 'buffered', eventId: 'w35-stale-buffered', timestamp: t0 + 1500, browsingSessionId: 'w35-stale-tab' })).status,
        (await h.call(`/realtime/segments/${sarah.subject}`, { capability: sarah.capability, body: { segment: 'w35-stale' } })).status,
        (await h.call('/realtime/reflex', { capability: sarah.capability })).status,
        (await h.call('/sort', { capability: sarah.capability, body: { userId: sarah.subject, sessionId: sarah.sessionId, candidates: CANDIDATES } })).status,
      ];
      expect.soft(superseded, 'W35.A2 — her superseded anonymous grant is refused on every door').toEqual([401, 401, 401, 401, 401]);
      // A history import that resolves her visitor id through an identity index that has not seen the link yet.
      const token = await operatorToken(h), before = ownerState(h, person).attributes.product_views as number;
      h.kv.miss.add(tenantKey(TENANT, 'identity:visitor:' + sarah.subject));
      const imported = await h.call(`/v1/${TENANT}/identity/events`, { headers: { Authorization: `Bearer ${token}` },
        body: { rows: [{ visitorId: sarah.subject, action: 'product_view', at: t0 + 1500, product: { line: 'Tabby', category: 'Handbags' } }] } });
      h.kv.miss.clear();
      const report = await body(imported) as { applied?: number };
      const landed = (ownerState(h, person).attributes.product_views as number) - before;
      if (imported.status === 200) expect.soft(landed, 'W35.A2 — a row the import acknowledges as applied through a stale identity index lands on the one owner, the person')
        .toBe(report.applied);
      else expect.soft({ refused: imported.status >= 400, landed }, 'W35.A2 — or the import refuses it outright, having applied nothing anywhere').toEqual({ refused: true, landed: 0 });
      expect.soft(JSON.stringify([...h.shopper(TENANT, sarah.subject).data].filter(([key]) => key === 'affinity' || key === 'pipeline')),
        'W35.A2 — nothing after the link is written to her retired browser record').toBe(retired);
    } finally { clock.mockRestore(); vi.restoreAllMocks(); }
  }, 60_000);

  it('host: a restart after the bursts leaves byte-identical owner state and alarm, and the restarted object keeps every concurrent write', async () => {
    const t0 = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(t0);
    try {
      const { h, shopper } = await objectHost(t0, clock);
      const sarah = await shopper(), twin = await shopper();
      clock.mockReturnValue(t0 + 1000);
      await Promise.all(BURST.map(data => act(h, sarah, { type: 'product_view', data })));
      const stored = h.shopper(TENANT, sarah.subject), bytes = JSON.stringify([...stored.data]), alarms = [...stored.alarms];
      h.restart(TENANT, sarah.subject);
      const answer = await h.call('/realtime/reflex', { capability: sarah.capability });
      expect.soft(answer.status, 'W35.A2 — the restarted object serves her').toBe(200);
      expect.soft(JSON.stringify([...stored.data]), 'W35.A2 — a restart leaves her stored owner state byte-identical').toBe(bytes);
      expect.soft(stored.alarms, 'W35.A2 — and her scheduled alarm').toEqual(alarms);
      clock.mockReturnValue(t0 + 2000);
      const after = await Promise.all(BURST.map(data => act(h, sarah, { type: 'product_view', data })));
      clock.mockReturnValue(t0 + 1000); for (const data of BURST) await act(h, twin, { type: 'product_view', data });
      clock.mockReturnValue(t0 + 2000); for (const data of BURST) await act(h, twin, { type: 'product_view', data });
      expect.soft(after.map(r => r.status), 'W35.A2 — every concurrent write after the restart is answered').toEqual(BURST.map(() => 200));
      expect.soft(ownerState(h, sarah.subject).attributes.product_views, 'W35.A2 — both bursts are counted across the restart').toBe(2 * BURST.length);
      expect.soft(ownerState(h, sarah.subject), 'W35.A2 — the two bursts across a restart leave the owner state of the same writes applied in order').toEqual(ownerState(h, twin.subject));
    } finally { clock.mockRestore(); vi.restoreAllMocks(); }
  }, 60_000);

  it('native: in workerd the object host applies a concurrent first-contact burst exactly as the same writes one after another, and keeps it — byte-identical, alarm included — across a real process restart, after which a second burst is kept too', async () => {
    const bundle = await bundleNativeWorker(NATIVE_WRAPPER, 'w35-ledger-native');
    const directory = nativeScratchDirectory('w35-ledger-native-');
    const options = { bundle, name: 'w35ledger', persistDir: directory.path,
      durableObjects: { SHOPPER_REFLEX: 'ShopperReflex', PERSONALIZATION_WEBSOCKET: 'PersonalizationWebSocket' },
      kvNamespaces: ['CACHE', 'SESSIONS'], r2Buckets: ['STORAGE'],
      bindings: { DEPLOYMENT_PROFILE: 'demo', REFLEX_HOST: 'do', JWT_SECRET: 'w35-ledger-native-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
        CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', TENANTS: JSON.stringify({ provisioned: [TENANT, 'coach'] }),
        RETENTION: JSON.stringify({ version: 1, tenants: fixtureCategories([TENANT, 'coach']) }) } };
    let runtime: NativeRuntime = await openNativeRuntime(options);
    try {
      const door = async (path: string, input: unknown) => (await runtime.fetch(`https://w35-fixture${path}`, { method: 'POST', body: JSON.stringify(input) })).json() as Promise<Json>;
      const engine = async (path: string, o: { capability?: string; body?: unknown } = {}) => {
        const response = await runtime.fetch(`https://engine.example${path}`, { method: o.body === undefined ? 'GET' : 'POST',
          headers: { 'X-Tenant': TENANT, 'Content-Type': 'application/json', ...(o.capability ? { 'X-Shopper-Session': o.capability } : {}) },
          ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }) });
        const text = await response.text(); let parsed: Json = {}; try { parsed = JSON.parse(text) as Json; } catch { /* not JSON */ }
        return { status: response.status, body: parsed, text };
      };
      expect(await door('/publish', { tenant: TENANT, content: { pieces: PIECES }, slots: { pages: { home: [{ slot: 'hero', take: 3, weights: { line: 1 } }] } },
        learn: { holdout: { share: 0, salt: 'w35-ledger', arms: ['default'] } } }), 'fixture: the tenant\'s documents are published natively').toEqual({ published: true });
      const shopper = async () => {
        const session = (await engine(`/v1/${TENANT}/identity/session`, { body: {} })).body.session as Shopper;
        const claims = JSON.parse(Buffer.from(session.capability.split('.')[1]!, 'base64url').toString()) as { grantId: string; iat: number; exp: number };
        const chosen = await engine(`/realtime/session/${session.sessionId}/preferences`, { capability: session.capability,
          body: { trackingConsent: true, personalizationEnabled: true, choice: { id: crypto.randomUUID(), expectedRevision: null, grantId: claims.grantId, iat: claims.iat, exp: claims.exp } } });
        expect(chosen.status, `fixture: her explicit choice is accepted natively: ${chosen.text.slice(0, 160)}`).toBe(200);
        return session;
      };
      const view = (g: Shopper, data: Json) => engine('/realtime/action', { capability: g.capability, body: { type: 'product_view', data, source: 'sdk', userId: g.subject, sessionId: g.sessionId } });
      const state = async (g: Shopper) => door('/object', { tenant: TENANT, subject: g.subject, path: '/__w35/state' }) as Promise<{ entries: Array<[string, unknown]>; alarm: number | null }>;
      const behaviour = (entries: Array<[string, unknown]>) => {
        const map = new Map(entries), pipeline = map.get('pipeline') as { attributes?: Json; segments?: string[] } | undefined;
        const affinity = map.get('affinity') as { reflex?: { dims?: Record<string, Record<string, { s: number }>>; audiences?: string[] } } | undefined;
        return { product_views: pipeline?.attributes?.product_views ?? null, segments: [...(pipeline?.segments ?? [])].sort(), audiences: [...(affinity?.reflex?.audiences ?? [])].sort(),
          dims: Object.fromEntries(Object.entries(affinity?.reflex?.dims ?? {}).map(([dim, values]) => [dim, Object.fromEntries(Object.entries(values).map(([k, e]) => [k, Math.round(e.s * 1e3) / 1e3]))])) };
      };
      const sarah = await shopper(), twin = await shopper();
      const burst = await Promise.all(BURST.map(data => view(sarah, data)));
      for (const data of BURST) await view(twin, data);
      expect.soft(burst.map(r => r.status), 'W35.A2 native — every write of her concurrent first-contact burst is answered').toEqual(BURST.map(() => 200));
      const before = await state(sarah);
      expect.soft(behaviour(before.entries), 'W35.A2 native — the concurrent burst is the same writes applied one after another: no lost update, no second create')
        .toEqual(behaviour((await state(twin)).entries));
      expect.soft(behaviour(before.entries).product_views, 'W35.A2 native — all eight views are counted').toBe(BURST.length);
      // A REAL process restart over the same persisted storage.
      await runtime.dispose();
      runtime = await openNativeRuntime(options);
      const restarted = await state(sarah);
      expect.soft(JSON.stringify(restarted.entries), 'W35.A2 native — after the restart her stored owner state is byte-identical').toBe(JSON.stringify(before.entries));
      expect.soft(restarted.alarm, 'W35.A2 native — and so is her scheduled alarm').toBe(before.alarm);
      const again = await Promise.all(BURST.map(data => view(sarah, data)));
      for (const data of BURST) await view(twin, data);
      expect.soft(again.map(r => r.status), 'W35.A2 native — the restarted object answers a second concurrent burst').toEqual(BURST.map(() => 200));
      expect.soft(behaviour((await state(sarah)).entries), 'W35.A2 native — both bursts across the restart are kept, as the same writes in order')
        .toEqual(behaviour((await state(twin)).entries));
      expect.soft(behaviour((await state(sarah)).entries).product_views, 'W35.A2 native — sixteen views are counted').toBe(2 * BURST.length);
      expect(runtime.outboundAttempts(), 'nothing reached the network').toBe(0);
    } finally { await runtime.dispose(); directory.remove(); }
  }, 300_000);
});

/**
 * The wrapper the shared harness bundles (src/units/_native.ts), in the pattern
 * of src/index.api-boundary.test.ts's wrapper: the tenant's publication written
 * by the real publication code inside workerd, and one read-only door on the
 * real ShopperReflex subclass that lists its storage and alarm. Every shopper
 * request goes to the real Worker `fetch`.
 */
const NATIVE_WRAPPER = `
import worker, { ShopperReflex as NativeShopperReflex, PersonalizationWebSocket } from './src/index.ts';
import { initializePublicationSet } from './src/config/publication.ts';
import { REFLEX_KIND, reflexScopeForTenant } from './src/reflex/configStore.ts';
import { CONTENT_KIND, SLOTS_KIND, LEARN_KIND } from './src/content/kinds.ts';
import { shopperObjectName } from './src/tenancy/objects.ts';
import { DEFAULT_REFLEX_CONFIG } from './src/reflex/core.ts';
export { PersonalizationWebSocket };
export class ShopperReflex extends NativeShopperReflex {
  constructor(state, env) { super(state, env); this.w35State = state; }
  async fetch(request) {
    if (new URL(request.url).pathname === '/__w35/state') {
      return Response.json({ entries: [...(await this.w35State.storage.list())], alarm: await this.w35State.storage.getAlarm() });
    }
    return super.fetch(request);
  }
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.hostname === 'w35-fixture') {
      const input = await request.json();
      if (url.pathname === '/publish') {
        const revision = value => ({ revision: 1, at: 1, actor: 'w35-ledger-native', note: '', value });
        await initializePublicationSet(env, [
          { kind: REFLEX_KIND, scope: reflexScopeForTenant(input.tenant), revision: revision({ ...DEFAULT_REFLEX_CONFIG, eventAttributes: 'event-when-unknown' }) },
          { kind: CONTENT_KIND, scope: input.tenant, revision: revision(input.content) },
          { kind: SLOTS_KIND, scope: input.tenant, revision: revision(input.slots) },
          { kind: LEARN_KIND, scope: input.tenant, revision: revision(input.learn) },
        ], '0:' + crypto.randomUUID());
        return Response.json({ published: true });
      }
      if (url.pathname === '/object') {
        const namespace = env.SHOPPER_REFLEX;
        return namespace.get(namespace.idFromName(shopperObjectName(input.tenant, input.subject))).fetch('https://w35-fixture' + input.path);
      }
      return new Response(null, { status: 404 });
    }
    return worker.fetch(request, env, ctx);
  },
};
`;

// ── A3 · ownership transfer, rollback of a failed transfer, restart ────────
describe('unit:W35.A3', () => {
  it('host: a sign-in transfer that fails before the person accepts it, and can no longer be accepted because the person\'s owner was reset, is rolled back after restart — the shopper has exactly one owner again, nothing of hers is lost, the retry is refused as a request and never as a server failure, and she can sign in afterwards — on both hosts', async () => {
    for (const host of HOSTS) {
      const t0 = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(t0);
      try {
        invalidateCache(); invalidateLiftCache();
        const h = harness(host);
        await publish(h.env, TENANT, { content: { pieces: PIECES }, slots: { pages: { home: [{ slot: 'hero', take: 3, weights: { line: 1 } }] } } });
        const sarah = await openSession(h);
        expect((await choose(h, sarah, true, true)).status, `${host}: fixture: her explicit choice is accepted`).toBe(200);
        for (const data of [TABBY_450, TABBY_395]) expect((await act(h, sarah, { type: 'product_view', data })).status, `${host}: fixture: her browsing is accepted`).toBe(200);
        const profile = ownerState(h, sarah.subject);
        const person = await shopperIdFor(h.env, TENANT, 'w35-ledger-rollback'), target = h.shopper(TENANT, person);
        // The person's receipt commit fails once: the transfer is prepared and admitted, never accepted.
        const put = target.state.storage.put.bind(target.state.storage);
        let failed = false;
        const fault = vi.spyOn(target.state.storage, 'put').mockImplementation(async (...args: Parameters<typeof target.state.storage.put>) => {
          const key = args[0] as unknown;
          if (!failed && typeof key === 'object' && key !== null && 'identityMembers' in key) { failed = true; throw new Error('synthetic person commit failure'); }
          return (put as (...a: unknown[]) => Promise<void>)(...args);
        });
        clock.mockReturnValue(t0 + 1000);
        const attempt = await signedLink(h, sarah, 'w35-ledger-rollback');
        fault.mockRestore();
        expect(failed, `${host}: fixture: the person's commit was reached and failed`).toBe(true);
        expect(attempt.status, `${host}: fixture: her sign-in answers the failure`).toBeGreaterThanOrEqual(400);
        // The person's owner is reset before the transfer is retried, so the admitted transfer can never be accepted.
        const reset = await h.env.SHOPPER_REFLEX.get(h.env.SHOPPER_REFLEX.idFromName(tenantKey(TENANT, person))).fetch('https://shopper-reflex/reset', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Reflex-Tenant': TENANT, 'X-Reflex-Subject': person }, body: '{}' });
        expect(reset.status, `${host}: fixture: the person's owner is reset`).toBe(200);
        h.restart(TENANT, sarah.subject); h.restart(TENANT, person);
        clock.mockReturnValue(t0 + 2000);
        const retried = await signedLink(h, sarah, 'w35-ledger-rollback');
        clock.mockReturnValue(t0 + 3000);
        const browsing = await act(h, sarah, { type: 'product_view', data: ROGUE });
        if (retried.status === 200) {
          const linked = await body(retried) as { session?: Shopper };
          expect.soft(ownerState(h, person).attributes.product_views, `W35.A3 (${host} host) — recovered by a fresh transfer: the person holds her whole profile`).toBe(2);
          const coarse = (dims: Record<string, Record<string, number>>) => Object.fromEntries(Object.entries(dims).map(([dim, values]) =>
            [dim, Object.fromEntries(Object.entries(values).map(([value, s]) => [value, Math.round(s * 1e3) / 1e3]))]));
          expect.soft(coarse(ownerState(h, person).dims), `W35.A3 (${host} host) — with her taste intact`).toEqual(coarse(profile.dims));
          expect.soft(browsing.status, `W35.A3 (${host} host) — and her superseded anonymous grant writes nothing`).toBe(401);
          expect.soft((await h.call('/realtime/reflex', { capability: linked.session!.capability })).status, `W35.A3 (${host} host) — the person serves her`).toBe(200);
        } else {
          // The retry that meets the failed transfer is refused as a request —
          // the link door answers its refusals in the 4xx range (kit 02:347:
          // 401, 409) — never as a server failure.
          expect.soft(retried.status, `W35.A3 (${host} host) — the retried sign-in that meets the failed transfer is refused as a request (4xx), never answered as a server failure`).toBeGreaterThanOrEqual(400);
          expect.soft(retried.status, `W35.A3 (${host} host) — the retried sign-in that meets the failed transfer is refused as a request (4xx), never answered as a server failure`).toBeLessThan(500);
          expect.soft(browsing.status, `W35.A3 (${host} host) — the failed transfer is rolled back: her own session accepts her browsing again instead of refusing her forever`).toBe(200);
          expect.soft(ownerState(h, sarah.subject).attributes.product_views, `W35.A3 (${host} host) — on her own intact profile, the new view counted (no lost update)`).toBe(3);
          expect.soft([...h.shopper(TENANT, sarah.subject).data.keys()].filter(key => key === 'identityTransfer' || key === 'forwardTo'),
            `W35.A3 (${host} host) — the rolled-back record neither forwards nor stays fenced by the failed transfer`).toEqual([]);
          expect.soft(target.data.has('pipeline') || target.data.has('affinity'), `W35.A3 (${host} host) — nothing of hers was merged into the person`).toBe(false);
          // And the rollback leaves sign-in working: she signs in again, and the
          // link folds her whole browser profile into the person (link.ts:1-22).
          clock.mockReturnValue(t0 + 4000);
          const again = await signedLink(h, sarah, 'w35-ledger-rollback');
          const signedIn = await body(again) as { ok?: boolean; session?: Shopper };
          expect.soft([again.status, signedIn.ok ?? null], `W35.A3 (${host} host) — after the rollback her next sign-in succeeds (kit 02:347)`).toEqual([200, true]);
          expect.soft(ownerState(h, person).attributes.product_views, `W35.A3 (${host} host) — and the person then holds her whole profile, the view she made after the rollback included`).toBe(3);
          expect.soft(signedIn.session ? (await h.call('/realtime/reflex', { capability: signedIn.session.capability })).status : 'no signed-in session',
            `W35.A3 (${host} host) — the person serves her`).toBe(200);
        }
      } finally { clock.mockRestore(); vi.restoreAllMocks(); }
    }
  }, 60_000);
});
