// src/units/P89/LEDGER.unit.test.ts
// P89 under the Closure Ledger (programme `tapestry-parity-activation`, amendment 11, item E14; batch S36): the tests for
// the LOCAL criteria SO1–SO4 of the P89 work order (docs/parity/activation/program.json). LV1 is a deferred live row and
// gets no test.
//
// THE REQUIREMENT (docs/parity/authority/amendment-11/BTI-Parity-Amendment-2026-10-22-activation.md, E14, as the brief
// quotes it): "the engine delivers the shopper's latest shot order over the live connection; the SDK keeps it in
// first-party storage for the next page view and the next first landing; a sign-in or a merge corrects it on the next page
// view; never applied to a carousel already on screen". Depends on P81 (the push) and P84 (the shot orders, the head
// script), both landed. The carousel design note §4 and §6 (the owner's draft, read as a document only).
// THE SHAPES, RULED (R-P459, from the analyst's S36/analyst/P89-SHAPES.md §4 S1–S6; O1–O8 decided):
//   S1 `shotOrder: string[] | null` on the decision set of a page whose context table names a carousel (the first
//      non-layout slot carrying `shotOrders`), absent otherwise (every pre-P84 answer byte-identical): the shopper's own
//      `contentType` interest values (suppressions removed, never the priors) with interest > 0 that a published
//      `shotOrders[].order` of the slot names, by interest descending, ties by their place in the request's row then by
//      code unit, at most 16; `null` on the `default` arm (holdout, no personalization consent, an unreadable record),
//      below the signal floor, when the slot weighs no `contentType` (O3), or with no positive interest.
//   S2 The member in the snapshot answer and in every `content_decisions` frame on both hosts; pushed on P81's triggers
//      when the offered pairs OR the order differ (a change in the order alone is pushed; unchanged, not); no new frame.
//      O8: `carousel_exposure` joins the engine's quiet actions (a carousel beacon re-decides nothing on a socket).
//   S3 The SDK keeps `opt_head.shots = { tenant, subject, anonymous, order, ts }`, written from every current answer and
//      from every `decisions` event before the page-view filter, only while tracking and personalization are allowed;
//      kept only if `ts` is not older than the stored one for the same subject; `null` or an empty order removes it; an
//      absent member leaves it; `DecisionSet` gains `shotOrder?`.
//   S4 The head script uses the stored order only under the row's own gate (personalization, class `personalized`, salt
//      not rotated) and only when `shots.subject` equals the stored visitor id (`opt_visitor_id`), and only within 30 days
//      of its `ts` (O6); the stored values first, then the row's other values when a row applies, then unlisted images in
//      server order; the pin and the minimum after, unchanged; also without a row; `data-op-context` keeps today's
//      meaning; the holdout, no consent, a refusal and the rotated paint keep the default row; a refusal drops `shots`; a
//      browser without `opt_head` and `opt_visitor_id` paints as a never-seen browser; a delivery changes no drawn slide.
//   S5 On `identity` `identified` whose `previous` is the stored subject and the stored value anonymous, the SDK rebinds
//      the order to the new subject; the person's first answer or frame (a newer `ts`) replaces it; any `identity` event
//      whose new visitor is not the stored subject, and a consent change leaving tracking or personalization off, remove
//      it; the bootstrap `identity` event (`previous: ''`, reason `logout`) clears nothing. No new SDK request.
//   S6 The kit sentences: kit 01 (§6's `content_decisions` row, a paragraph after it, the head-script paragraph), kit 02
//      (the frame list, the answer's member, the head script's stored order), kit 03 (the frame table, the decision
//      paragraph, the shot-orders section: the order exists only where the carousel weighs `contentType`, its example
//      gaining that weight).
//
// HOW THESE TESTS READ THE SHAPES (proposed where the ruling leaves the form open):
//   · The shopper's interest is taught by `content_click` on catalogue pieces (the piece's own `tags.contentType`, the
//     registry's default `contentType` dimension): three clicks on a studio image, two on a detail image, one on an image
//     tagged both `flat_lay` and `on_model` (one event, so their interest is equal), five on a `video` image (a value no
//     published order names). Expected, from S1: studio, detail, then the tie by the request's row (paid social, visit 1,
//     mobile: on_model before flat_lay), or by code unit where the request has no row (desktop: flat_lay, on_model).
//   · The cap: eighteen published values on three images (a piece teaches at most eight `contentType` values,
//     src/content/typeAffinity.ts contentTypeValues), clicked three, two and one times: one image's values are of equal
//     interest (one event each time); expected by interest, each group by the request's row then code unit, cut at
//     sixteen, so the least-interest value the row leads with is cut.
//   · The push legs run a desktop browser: P81's kept page view keeps the request's body and coarse location but not its
//     device headers (ShopperReflex.ts `pushChanged` re-signs a request of Content-Type, X-Tenant and the capability), so
//     a re-decision of a mobile page view loses P84's mobile row and re-orders the carousel's equal-score images (measured,
//     reported as a contradiction); on desktop no row matches on either side, and the order alone changes.
//   · The head script's `data-op-context` keeps today's meaning: the cell's row by channel and bucket names the context on
//     desktop too (`paid_social|1|desktop`), though that row names no desktop order.
//   · The SDK's `ts` is the set's `ts`; `subject` is the SDK's visitor id at receipt; `anonymous` whether it is the
//     anonymous identifier. The head script reads `shots.order` and `shots.ts` (the 30-day bound).
//
// R10 SWEEP (src/**/*.test.ts): P81's frames are P02's page (no carousel): the member is absent and the digest unchanged;
// P84's answers gain `shotOrder: null` (its carousel weighs `category` alone; no test asserts its answer's exact keys);
// realtime.sdkContract's exact answer keys and P61's `ANSWER_MEMBERS` read pages without a carousel (absent: hold); P85's
// beacon answer is unchanged (only its push consequence, O8); P84's head legs carry no `shots` (paint as today). None
// needed; measured on both trees under the sketch.
//
// DEFERRED: LV1. RESIDUALS (told, R-P459): the carried order is the shopper's own interest only (priors, lift,
// exploration, other dimensions are not carried); the head reads the default visitor key only; one tenant and brand per
// origin; a navigation straight after sign-in paints the rebound order until the person's first answer; storage written
// under consent persists after the tab closes.
//
// NO NEW EXPORT IS IMPORTED (`shotOrder` and `shots` are read loosely). HARNESS: src/units/_parity.ts (the mounted
// application, both hosts), src/units/_native.ts (workerd with a real socket, P81's form), src/sdk/testHost.ts (the SDK
// legs), jsdom with the built head script (P84's form). Imports from src/units/: ../_parity, ../_native.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { SignJWT } from 'jose';
import * as jsdom from 'jsdom';
import { describe, expect, it } from 'vitest';

import { SHOPPER_HEADER } from '@/identity/sessionCapability';
import { EMPTY_PRIORS } from '@/learn/priors';
import { RETENTION_CATEGORIES } from '@/retention';
import { createCore } from '@/sdk/core';
import { createIdentity } from '@/sdk/identify';
import { createListen } from '@/sdk/listen';
import { preferenceAck, syntheticSession, testHost } from '@/sdk/testHost';
import type { DecisionSet, RequestInitLike, ResponseLike } from '@/sdk/types';
import { CLASSIFIER_VERSION } from '@/services/visit';

import { bundleNativeWorker, nativeScratchDirectory, openNativeRuntime } from '../_native';
import { BRAND, declaredSlots, expectPublished, HOSTS, LAYOUT, layoutSlot, learnDocument, MODULES, mount, PAID_SOCIAL_ENTRY, PAGE_VIEW, pageInstanceOf, readTree,
  REFLEX_DOCUMENT, shopperOn, TENANT, type Host, type Mounted, type Shopper } from '../_parity';

// ===========================================================================
// The fixture: a product page with its declared layout slot and a carousel weighing `contentType` (O3), its shot orders
// per context (P84's form), the anchor's images with their shot tags, and a layout module of a shot no image carries.
// ===========================================================================

const CAROUSEL = 'pdp-carousel', A = 'COA-CH857';
type Piece = Record<string, unknown> & { id: string };
const image = (id: string, contentType: string[]): Piece => ({ id, customerContentId: `TAP-${id.toUpperCase()}`, type: 'image', title: `${id}`,
  tags: { category: ['Handbags'], line: ['Tabby'], ...(contentType.length ? { contentType } : {}) }, slotTypes: [CAROUSEL], lifecycle: { status: 'live' }, featuredProductIds: [A] });
const STUDIO = image('img-ch857-1', ['studio']), FLAT = image('img-ch857-2', ['flat_lay']), MODEL = image('img-ch857-3', ['on_model']), DETAIL = image('img-ch857-4', ['detail']),
  VIDEO = image('img-ch857-8', ['video']), PAIR = image('img-ch857-9', ['flat_lay', 'on_model']), PLAIN = image('img-ch857-7', []);
const IMAGES = [STUDIO, FLAT, MODEL, DETAIL, PLAIN, VIDEO, PAIR];
/**
 * A cart piece of the shot `lifestyle` alone, which a published order names and no carousel image carries (the push leg):
 * a click on it moves the shopper's shot order and no ranking of the product page (the layout slot weighs line, category
 * and occasion; the carousel's images carry no `lifestyle`).
 */
const LIFESTYLE: Piece = { id: 'cnt-lifestyle-1', customerContentId: 'TAP-CART-LIFESTYLE-1', type: 'editorial', title: 'A lifestyle story',
  tags: { contentType: ['lifestyle'] }, slotTypes: ['cart-recs'], lifecycle: { status: 'live' } };
const SHOT_PS = ['on_model', 'detail', 'studio', 'flat_lay'];
const SHOT_ORDERS = [
  { context: { channel: 'paid_social', visitBuckets: ['1'], device: 'mobile' }, order: SHOT_PS },
  { context: { channel: 'paid_search', visitBuckets: ['1', '2-3'] }, order: ['detail', 'studio'] },
  { context: { channel: 'organic', visitBuckets: 'any' }, order: ['lifestyle', 'studio'] },
];
const carouselSlot = (over: Record<string, unknown> = {}) => ({ slot: CAROUSEL, take: 9, weights: { category: 1, contentType: 1 }, shotOrders: SHOT_ORDERS, ...over });
const slotsWith = (over: Record<string, unknown> = {}, pages: Record<string, unknown[]> = {}) => ({ ...declaredSlots([]),
  pages: { pdp: [layoutSlot(), carouselSlot(over)], cart: [{ slot: 'cart-recs', take: 2, weights: { category: 1 } }], ...pages } });
const learnWith = (holdout?: Record<string, unknown>) => learnDocument({ [CAROUSEL]: { measurementBasis: 'rendered-v1', reward: 'click' } }, holdout ? { holdout } : {});
const DOCS = { pieces: [...MODULES, LIFESTYLE, ...IMAGES], slots: slotsWith(), learn: learnWith() };

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const deviceHeaders = (device: 'mobile' | 'desktop') => ({ 'User-Agent': device === 'mobile' ? MOBILE_UA : DESKTOP_UA, 'Sec-CH-UA-Mobile': device === 'mobile' ? '?1' : '?0' });
const show = (a: { status: number; body: Record<string, unknown> }) => `${a.status} ${JSON.stringify(a.body).slice(0, 200)}`;

/** A content click on a catalogue piece, as the SDK's capture sends it; its arrival is paid social. */
const clickOn = (s: Shopper, piece: Piece, slot = CAROUSEL) => s.action({ type: 'content_click', data: { contentId: piece.id, slot, page: 'pdp' } }, PAID_SOCIAL_ENTRY);
/** The shopper's interest as the fixture teaches it: studio ×3, detail ×2, flat_lay and on_model ×1 together, video ×5. */
async function taught(m: Mounted, s: Shopper): Promise<void> {
  for (const [piece, times] of [[STUDIO, 3], [DETAIL, 2], [PAIR, 1], [VIDEO, 5]] as const) {
    for (let i = 0; i < times; i++) expect((await clickOn(s, piece)).status, `${m.host}: PRECONDITION — the click on ${piece.id} is accepted`).toBe(200);
  }
}
/** The product page's decision for the shopper, on a device, the arrival paid social (P84's form). */
async function pdpPage(m: Mounted, s: Shopper, device: 'mobile' | 'desktop', page = 'pdp'): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await m.fetch(new Request(`https://shop.invalid/v1/${TENANT}/decisions/snapshot`, { method: 'POST',
    headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: s.grant.capability, 'Content-Type': 'application/json', ...deviceHeaders(device) },
    body: JSON.stringify({ page, brand: BRAND, pageInstance: pageInstanceOf('p89'), 'ctx.anchor': A, entry: JSON.stringify(PAID_SOCIAL_ENTRY) }) }));
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  await m.drain();
  return { status: response.status, body };
}
const shotOrderOf = (body: Record<string, unknown>) => Object.hasOwn(body, 'shotOrder') ? body.shotOrder : 'no shotOrder member';

// ===========================================================================
// unit:P89.SO1 — the shopper's shot order on the decision set; its push; the quiet beacon
// ===========================================================================

/**
 * Eighteen published shot values (S1's cap) on three images (a piece teaches at most eight `contentType` values, typeAffinity.ts
 * contentTypeValues): shot-01..08 clicked three times, shot-09..16 twice, shot-17..18 once, so the values of one image are of
 * equal interest. The paid-social row names ten (shot-17 first); another context the other eight.
 */
const MANY = Array.from({ length: 18 }, (_, i) => `shot-${String(i + 1).padStart(2, '0')}`);
const MANY_ROW = ['shot-17', 'shot-12', 'shot-11', 'shot-10', 'shot-09', 'shot-05', 'shot-04', 'shot-03', 'shot-02', 'shot-01'];
const MANY_ORDERS = [
  { context: { channel: 'paid_social', visitBuckets: ['1'], device: 'mobile' }, order: MANY_ROW },
  { context: { channel: 'email', visitBuckets: 'any' }, order: MANY.filter(v => !MANY_ROW.includes(v)) },
];
const SHOTS_A = image('img-ch857-sa', MANY.slice(0, 8)), SHOTS_B = image('img-ch857-sb', MANY.slice(8, 16)), SHOTS_C = image('img-ch857-sc', MANY.slice(16));
/** S1 over that interest: by interest (A, then B; C's two cut at sixteen though shot-17 leads the row), each image's values by the row, then by code unit. */
const MANY_EXPECTED = ['shot-05', 'shot-04', 'shot-03', 'shot-02', 'shot-01', 'shot-06', 'shot-07', 'shot-08',
  'shot-12', 'shot-11', 'shot-10', 'shot-09', 'shot-13', 'shot-14', 'shot-15', 'shot-16'];

describe('unit:P89.SO1 (R-P459 S1, S2, O8)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): on the carousel page the answer carries \`shotOrder\`: the shopper's own published \`contentType\` interests by interest (studio, detail), the tie by the request's row on mobile (on_model, flat_lay) and by code unit on desktop where no published order matches (flat_lay, on_model), \`video\` left out (no published order names it); a page without a carousel carries no member`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P89.SO1 — the product page with its carousel weighing contentType publishes');
      const s = await shopperOn(m);
      await taught(m, s);
      const mobile = await pdpPage(m, s, 'mobile'), desktop = await pdpPage(m, s, 'desktop'), cart = await pdpPage(m, s, 'mobile', 'cart');
      expect([mobile.status, desktop.status, cart.status], `${host}: PRECONDITION — the pages are answered (${show(mobile)})`).toEqual([200, 200, 200]);
      expect.soft({ mobile: shotOrderOf(mobile.body), desktop: shotOrderOf(desktop.body) },
        `${host}: P89.SO1 — the shopper's shot order, interest first, then the row, then code unit (today no member)`).toEqual({
        mobile: ['studio', 'detail', 'on_model', 'flat_lay'], desktop: ['studio', 'detail', 'flat_lay', 'on_model'] });
      expect.soft(shotOrderOf(cart.body), `${host}: P89.SO1 — a page without a carousel carries no member (every pre-P84 answer unchanged)`).toBe('no shotOrder member');
    }, 120_000);

    it(`host (${host}): the cap — eighteen published values in three interest groups: by interest, each group's values in the request's row's order, then by code unit, sixteen in all (the least interest cut, though the row leads with it)`, async () => {
      const m = await mount(host, { ...DOCS, pieces: [...MODULES, ...IMAGES, SHOTS_A, SHOTS_B, SHOTS_C], slots: slotsWith({ shotOrders: MANY_ORDERS }) });
      expectPublished(m, 'P89.SO1 — the carousel with eighteen published shot values publishes');
      const s = await shopperOn(m);
      for (const [piece, times] of [[SHOTS_A, 3], [SHOTS_B, 2], [SHOTS_C, 1]] as const) {
        for (let i = 0; i < times; i++) expect((await clickOn(s, piece)).status, `${host}: PRECONDITION — the click on ${piece.id} is accepted`).toBe(200);
      }
      const page = await pdpPage(m, s, 'mobile');
      expect.soft(shotOrderOf(page.body), `${host}: P89.SO1 — at most sixteen, by interest, then the row, then code unit (${show(page)})`).toEqual(MANY_EXPECTED);
    }, 120_000);

    it(`host (${host}): \`shotOrder\` is null where S1 carries none — no positive interest, no personalization consent, the holdout's default arm, a carousel below its signal floor, a carousel weighing no \`contentType\` — and present (non-null) on the same page for the same interest otherwise`, async () => {
      const cases: Array<[string, typeof DOCS, { tracking: boolean; personalization: boolean }, boolean]> = [
        ['no positive interest', DOCS, { tracking: true, personalization: true }, false],
        ['no personalization consent', DOCS, { tracking: true, personalization: false }, true],
        ['the holdout\'s default arm', { ...DOCS, learn: learnWith({ share: 1, salt: 'p89-holdout', arms: ['default'] }) }, { tracking: true, personalization: true }, true],
        ['a carousel below its signal floor', { ...DOCS, slots: slotsWith({ signalFloor: 1000 }) }, { tracking: true, personalization: true }, true],
        ['a carousel weighing no contentType', { ...DOCS, slots: slotsWith({ weights: { category: 1 } }) }, { tracking: true, personalization: true }, true],
      ];
      const seen: unknown[] = [];
      for (const [name, docs, consent, teach] of cases) {
        const m = await mount(host, docs);
        expectPublished(m, `P89.SO1 — ${name}: the documents publish`);
        const s = await shopperOn(m, consent);
        if (teach) await taught(m, s);
        const page = await pdpPage(m, s, 'mobile');
        expect(page.status, `${host}: PRECONDITION — ${name}: the page is answered (${show(page)})`).toBe(200);
        seen.push([name, shotOrderOf(page.body)]);
      }
      const control = await mount(host, DOCS);
      const s = await shopperOn(control);
      await taught(control, s);
      seen.push(['the shopper\'s interest, consent and a personalizing arm', shotOrderOf((await pdpPage(control, s, 'mobile')).body)]);
      expect.soft(seen, `${host}: P89.SO1 — null in each case S1 names (today no member at all)`).toEqual([...cases.map(([name]) => [name, null]),
        ['the shopper\'s interest, consent and a personalizing arm', ['studio', 'detail', 'on_model', 'flat_lay']]]);
    }, 300_000);
  }
});

// ---------------------------------------------------------------------------
// The push legs: the real Worker in workerd, both shopper hosts, a real socket (P81's native world, reduced to what these
// legs use: the documents published, an anonymous grant, the shopper's choice, actions, the page view's request, the socket).
// ---------------------------------------------------------------------------

const NATIVE_SECRET = 'p89-native-operator-signing-material';
const NATIVE_WRAPPER = `
import worker, { ShopperReflex, PersonalizationWebSocket, DecisionRing, LearnStats, RegionTrend } from './src/index.ts';
import { initializePublicationSet } from './src/config/publication.ts';
import { REFLEX_KIND, reflexScopeForTenant } from './src/reflex/configStore.ts';
import { CONTENT_KIND, SLOTS_KIND, LEARN_KIND } from './src/content/kinds.ts';
import { PRIORS_KIND } from './src/learn/priors.ts';
import { newAnonymousSession } from './src/identity/sessionCapability.ts';
export { ShopperReflex, PersonalizationWebSocket, DecisionRing, LearnStats, RegionTrend };
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.hostname !== 'p89-fixture') return worker.fetch(request, env, ctx);
    const input = await request.json();
    if (url.pathname === '/publish') {
      const revision = value => ({ revision: 1, at: 1, actor: 'p89-native', note: '', value });
      await initializePublicationSet(env, [
        { kind: CONTENT_KIND, scope: input.tenant, revision: revision(input.content) }, { kind: SLOTS_KIND, scope: input.tenant, revision: revision(input.slots) },
        { kind: LEARN_KIND, scope: input.tenant, revision: revision(input.learn) }, { kind: PRIORS_KIND, scope: input.tenant, revision: revision(input.priors) },
        { kind: REFLEX_KIND, scope: reflexScopeForTenant(input.tenant), revision: revision(input.reflex) },
      ], '0:' + crypto.randomUUID());
      return Response.json({ published: input.tenant });
    }
    if (url.pathname === '/grant') return Response.json(await newAnonymousSession(env, input.tenant));
    return new Response(null, { status: 404 });
  },
};`;
let nativeBundle: Promise<string> | undefined;
interface Answer { status: number; body: Record<string, unknown> }
interface Frame { type?: string; pageInstance?: string; decisions?: Array<{ contentId: string; slot: string }>; shotOrder?: unknown; [k: string]: unknown }
interface NativeSocket { frames: Frame[]; waitFor: (predicate: () => boolean, ms?: number) => Promise<boolean> }
interface NativeBrowser { act: (event: { type: string; data: Record<string, unknown> }) => Promise<Answer>; ask: (pageInstance: string) => Promise<Answer>; socket: () => Promise<NativeSocket> }
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const pushes = (socket: NativeSocket) => socket.frames.filter(f => f.type === 'content_decisions');
const pairsOf = (decisions: unknown) => ((decisions ?? []) as Array<{ slot: string; contentId: string }>).map(d => `${d.slot}:${d.contentId}`);

async function nativeWorld<T>(host: Host, work: (w: { browser: () => Promise<NativeBrowser>; publishSlots: (document: unknown) => Promise<Answer> }) => Promise<T>): Promise<T> {
  const bundle = await (nativeBundle ??= bundleNativeWorker(NATIVE_WRAPPER, 'p89-ledger-native'));
  const directory = nativeScratchDirectory('p89-ledger-native-');
  const policy = { id: 'p89-native-policy', revision: 1, durationMs: 3650 * 86_400_000, basis: 'admitted', renewal: 'new-record-only' };
  const runtime = await openNativeRuntime({ bundle, name: `p89-native-${host}`, persistDir: directory.path,
    durableObjects: { SHOPPER_REFLEX: 'ShopperReflex', PERSONALIZATION_WEBSOCKET: 'PersonalizationWebSocket', DECISION_RING: 'DecisionRing', LEARN_STATS: 'LearnStats', REGION_TREND: 'RegionTrend' },
    kvNamespaces: ['CACHE', 'SESSIONS'], r2Buckets: ['STORAGE'],
    bindings: { DEPLOYMENT_PROFILE: 'demo', CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: host, JWT_SECRET: NATIVE_SECRET, JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
      IDENTITY_SECRETS: `${TENANT}:p89-native-identity`, LEDGER_RECOVERY_ENABLED: 'true', TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
      RETENTION: JSON.stringify({ version: 1, tenants: { [TENANT]: Object.fromEntries(RETENTION_CATEGORIES.map(category => [category, policy])) } }) } });
  try {
    const fixture = async (path: string, body: unknown) => {
      const response = await runtime.fetch(`https://p89-fixture${path}`, { method: 'POST', body: JSON.stringify(body) });
      expect(response.status, `PRECONDITION (${host} native): fixture door ${path}`).toBe(200);
      return await response.json() as Record<string, unknown>;
    };
    await fixture('/publish', { tenant: TENANT, content: { version: 'p89-native', pieces: DOCS.pieces }, slots: DOCS.slots, learn: DOCS.learn, priors: EMPTY_PRIORS, reflex: REFLEX_DOCUMENT });
    const parsed = async (response: Response): Promise<Answer> => {
      const text = await response.text();
      let body: Record<string, unknown>; try { body = JSON.parse(text) as Record<string, unknown>; } catch { body = { text }; }
      return { status: response.status, body };
    };
    const token = await new SignJWT({ sub: 'ops', type: 'service', roles: ['operator', 'admin'] }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('i').setAudience('a')
      .setExpirationTime('2h').sign(new TextEncoder().encode(NATIVE_SECRET));
    const operator = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => parsed(await runtime.fetch(`https://ops.example${path}`, {
      method, headers: { 'X-Tenant': TENANT, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
    const publishSlots = async (document: unknown) => {
      const base = await operator('GET', `/content/slots?scope=${TENANT}`);
      const publication = base.body.publication as { revision: number; digest: string };
      return operator('PUT', `/content/slots?scope=${TENANT}`, { document, note: 'p89' },
        { 'If-Match': `"${String(base.body.revision)}/${publication.revision}/${publication.digest}"`, 'Idempotency-Key': `${String(base.body.revision)}:${crypto.randomUUID()}` });
    };
    const browser = async (): Promise<NativeBrowser> => {
      const g = await fixture('/grant', { tenant: TENANT }) as unknown as { capability: string; subject: string; sessionId: string; grantId: string; iat: number; exp: number };
      // A desktop browser: P81's kept page view keeps the request's body and coarse location, not its device headers, so a
      // re-decision of a mobile page view loses P84's mobile row (reported to the lead); on desktop no row matches either way.
      const call = async (path: string, body?: unknown) => parsed(await runtime.fetch(`https://shop.example${path}`, { method: body === undefined ? 'GET' : 'POST',
        headers: { 'X-Tenant': TENANT, [SHOPPER_HEADER]: g.capability, 'Content-Type': 'application/json', ...deviceHeaders('desktop') }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
      const chose = await call(`/realtime/session/${g.sessionId}/preferences`, { trackingConsent: true, personalizationEnabled: true,
        choice: { id: crypto.randomUUID(), expectedRevision: null, grantId: g.grantId, iat: g.iat, exp: g.exp } });
      expect(chose.status, `PRECONDITION (${host} native): the shopper's explicit choice`).toBe(200);
      const act = (event: { type: string; data: Record<string, unknown> }) => call('/realtime/action', { ...event, source: 'sdk', userId: g.subject, sessionId: g.sessionId,
        eventId: crypto.randomUUID(), timestamp: Date.now(), entry: PAID_SOCIAL_ENTRY });
      expect((await act(PAGE_VIEW)).status, `PRECONDITION (${host} native): the shopper's page view`).toBe(200);
      const ask = (pageInstance: string) => call(`/v1/${TENANT}/decisions/snapshot`, { page: 'pdp', brand: TENANT, pageInstance, 'ctx.anchor': A, entry: JSON.stringify(PAID_SOCIAL_ENTRY) });
      const socket = async (): Promise<NativeSocket> => {
        const response = await runtime.fetch(`https://shop.example/realtime/ws?tenant=${TENANT}`, { headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `shopper-session-v1, ${g.capability}` } });
        const ws = (response as unknown as { webSocket?: { accept(): void; addEventListener(type: string, listener: (event: { data: unknown }) => void): void } }).webSocket;
        expect([response.status, Boolean(ws)], `PRECONDITION (${host} native): the socket is upgraded`).toEqual([101, true]);
        const frames: Frame[] = [];
        ws!.addEventListener('message', event => { try { frames.push(JSON.parse(String(event.data)) as Frame); } catch { /* not JSON */ } });
        ws!.accept();
        const waitFor = async (predicate: () => boolean, ms = 3000) => { const until = Date.now() + ms; while (!predicate() && Date.now() < until) await pause(20); return predicate(); };
        expect(await waitFor(() => frames.some(f => f.type === 'connected')), `PRECONDITION (${host} native): the socket's welcome frame`).toBe(true);
        return { frames, waitFor };
      };
      return { act, ask, socket };
    };
    return await work({ browser, publishSlots });
  } finally {
    await runtime.dispose(); directory.remove();
  }
}
/** A content click in the native world. */
const nativeClick = (b: NativeBrowser, piece: Piece, slot = CAROUSEL, page = 'pdp') => b.act({ type: 'content_click', data: { contentId: piece.id, slot, page } });

describe('unit:P89.SO1 (R-P459 S2, O8) — the push, both hosts in workerd', () => {
  for (const host of HOSTS) {
    it(`host (${host}): with the page view open on a socket, a click that changes the shopper's shot order alone (on a cart piece of the shot \`lifestyle\`: a published shot no carousel image carries) is pushed as a \`content_decisions\` frame carrying the new \`shotOrder\` and the same offered pairs; an action that changes neither pushes nothing`, async () => {
      await nativeWorld(host, async w => {
        const b = await w.browser(), socket = await b.socket();
        for (const [piece, times] of [[STUDIO, 3], [DETAIL, 2]] as const) for (let i = 0; i < times; i++) expect((await nativeClick(b, piece)).status, `${host}: PRECONDITION — the click`).toBe(200);
        const pageInstance = pageInstanceOf('p89-push');
        const first = await b.ask(pageInstance);
        expect([first.status, Array.isArray(first.body.shotOrder) ? 'an order' : `shotOrder ${JSON.stringify(first.body.shotOrder)}`],
          `${host}: PRECONDITION — the page view's answer carries the shopper's order (today no member: ${show(first)})`).toEqual([200, 'an order']);
        const before = pushes(socket).length;
        expect((await nativeClick(b, LIFESTYLE, 'cart-recs', 'cart')).status, `${host}: PRECONDITION — the click on the lifestyle piece`).toBe(200);
        await socket.waitFor(() => pushes(socket).length > before);
        const frame = pushes(socket)[before];
        expect.soft(frame ? { pageInstance: frame.pageInstance, lifestyle: Array.isArray(frame.shotOrder) && frame.shotOrder.includes('lifestyle'), same: JSON.stringify(pairsOf(frame.decisions)) === JSON.stringify(pairsOf(first.body.decisions)) } : 'no frame',
          `${host}: P89.SO1 — the order alone changed and is pushed, the offered pairs unchanged`).toEqual({ pageInstance, lifestyle: true, same: true });
        const settled = pushes(socket).length;
        expect((await b.act(PAGE_VIEW)).status, `${host}: PRECONDITION — the page view action`).toBe(200);
        await pause(1500);
        expect.soft(pushes(socket).length - settled, `${host}: P89.SO1 — nothing changed, nothing pushed`).toBe(0);
      });
    }, 180_000);

    it(`host (${host}): O8 — a carousel beacon is a quiet action: with a publication change pending on the open page view, a \`carousel_exposure\` pushes nothing, and the next admitted action pushes the changed set`, async () => {
      await nativeWorld(host, async w => {
        const b = await w.browser(), socket = await b.socket();
        const pageInstance = pageInstanceOf('p89-quiet');
        const first = await b.ask(pageInstance);
        expect(first.status, `${host}: PRECONDITION — the page view's answer (${show(first)})`).toBe(200);
        // A publication that changes the page's decisions: the carousel takes two images.
        const published = await w.publishSlots(slotsWith({ take: 2 }));
        expect(published.status, `${host}: PRECONDITION — the slots change publishes (${show(published)})`).toBe(200);
        const before = pushes(socket).length;
        const beacon = await b.act({ type: 'carousel_exposure', data: { tableVersion: 'p89-table', context: 'default', page: 'pdp', slot: CAROUSEL,
          images: [STUDIO.id], pageInstance, arm: 'personalized' } });
        expect(beacon.status, `${host}: PRECONDITION — the beacon is answered (${show(beacon)})`).toBe(200);
        await pause(1500);
        const afterBeacon = pushes(socket).length - before;
        expect((await b.act(PAGE_VIEW)).status, `${host}: PRECONDITION — the next admitted action`).toBe(200);
        await socket.waitFor(() => pushes(socket).length > before + afterBeacon);
        expect.soft({ afterBeacon, afterAction: pushes(socket).length - before - afterBeacon > 0 },
          `${host}: P89.SO1 — the beacon decides nothing; the pending change waits for the next admitted action (today the beacon re-decides and pushes)`).toEqual({ afterBeacon: 0, afterAction: true });
      });
    }, 180_000);
  }
});

// ===========================================================================
// unit:P89.SO2 — the SDK keeps the shopper's order under `opt_head`; the head script paints it first under the row's gate
// ===========================================================================

const T0 = 1_725_000_000_000, DAY = 86_400_000;
const HEAD_KEY = 'opt_head';
const respond = (json: unknown, status = 200): ResponseLike => ({ ok: status >= 200 && status < 300, status, json: async () => json });
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
const SHOPPER_ID = 'sh_' + 'a'.repeat(32), OTHER_ID = 'sh_' + 'b'.repeat(32);

/**
 * The real SDK (createCore, createListen, createIdentity) over a browser with nothing behind it (src/sdk/testHost.ts):
 * each snapshot request answered with the set `next()` gives (its `ts` and `shotOrder` as the engine would send them),
 * identity links and detaches answered as the session route answers them, a refusal through the preferences route.
 */
function sdkPage(options: { personalization?: boolean; host?: ReturnType<typeof testHost> } = {}) {
  const f = options.host ?? testHost();
  let next: (pageInstance: string) => Record<string, unknown> = () => ({});
  const passthrough = f.host.fetch;
  f.host.fetch = async (url: string, init?: RequestInitLike): Promise<ResponseLike> => {
    if (url.includes('/decisions/snapshot')) {
      const body = JSON.parse(init?.body ?? '{}') as { page: string; pageInstance: string };
      return respond({ ok: true, page: body.page, pageInstance: body.pageInstance, arm: 'personalized', decisions: [], ...next(body.pageInstance) });
    }
    if (url.endsWith('/identity/link')) {
      const person = syntheticSession(f.host.now(), linkAs);
      return respond({ ok: true, carry: linkAs, shopperId: linkAs, outcome: 'linked', session: person });
    }
    if (url.endsWith('/identity/detach')) return respond({ ok: true, detached: true, session: syntheticSession(f.host.now()) });
    if (url.endsWith('/realtime/session/preferences')) return respond(preferenceAck(f.host, init, JSON.parse(init?.body ?? '{}') as Record<string, unknown>));
    if (url.endsWith('/identity/session') && options.personalization === false) {
      const answer = await passthrough(url, init);
      const body = await answer.json() as { session: { consent: Record<string, unknown> & { instruction: Record<string, unknown> } } };
      const refused = { value: false, chosenAt: f.host.now(), expiresAt: f.host.now() + 30 * DAY };
      body.session.consent = { ...body.session.consent, personalization: false, instruction: { ...body.session.consent.instruction, personalization: refused } };
      return respond(body);
    }
    return passthrough(url, init);
  };
  let linkAs = SHOPPER_ID;
  const core = createCore({ tenant: TENANT, source: 'coach-pdp' }, f.host);
  const listen = createListen(core), identity = createIdentity(core);
  return { f, core, listen, identity,
    answerWith: (fn: (pageInstance: string) => Record<string, unknown>) => { next = fn; },
    linkTo: (subject: string) => { linkAs = subject; },
    /** A page view's request, answered with `members`. */
    view: async (members: Record<string, unknown>) => { next = () => members; await listen.refresh({ page: 'pdp' }); await settle(); },
    /** A content_decisions frame on the connected socket. */
    frame: async (members: Record<string, unknown>) => { f.sockets.at(-1)!.receive({ type: 'content_decisions', page: 'pdp', decisions: [], ...members }); await settle(); },
    connect: async () => { core.connect(); await settle(); f.sockets.at(-1)!.open(); await settle(); },
    shots: () => { try { return (JSON.parse(f.host.storage.get(HEAD_KEY) ?? 'null') as { shots?: unknown } | null)?.shots ?? 'no shots'; } catch { return 'unreadable'; } },
    destroy: () => { listen.destroy(); core.disconnect(); } };
}

describe('unit:P89.SO2 (R-P459 S3, S4)', () => {
  it('sdk: the SDK keeps the shopper\'s order from each current answer as `opt_head.shots` { tenant, subject, anonymous, order, ts } — an older `ts` for the same subject kept out, an absent member leaving it, an empty order and `null` removing it — and `current()` carries `shotOrder`', async () => {
    const p = sdkPage();
    expect(await p.core.ready(), 'PRECONDITION: the client is ready').toBe(true);
    const subject = p.core.visitorId, steps: unknown[] = [];
    await p.view({ ts: T0 + 10, shotOrder: ['studio', 'detail'] });
    steps.push(['kept', p.shots(), (p.listen.current() as (DecisionSet & { shotOrder?: unknown }) | null)?.shotOrder ?? 'no member on current()']);
    await p.view({ ts: T0 + 5, shotOrder: ['flat_lay'] });
    steps.push(['an older ts', p.shots()]);
    await p.view({ ts: T0 + 20 });
    steps.push(['absent', p.shots()]);
    await p.view({ ts: T0 + 30, shotOrder: [] });
    steps.push(['empty', p.shots()]);
    await p.view({ ts: T0 + 40, shotOrder: ['on_model'] });
    await p.view({ ts: T0 + 50, shotOrder: null });
    steps.push(['null', p.shots()]);
    p.destroy();
    const kept = { tenant: TENANT, subject, anonymous: true, order: ['studio', 'detail'], ts: T0 + 10 };
    expect.soft(steps, 'P89.SO2 — the kept order and its rules (today nothing is kept)').toEqual([['kept', kept, ['studio', 'detail']], ['an older ts', kept], ['absent', kept], ['empty', 'no shots'], ['null', 'no shots']]);
  });

  it('sdk: a `content_decisions` frame keeps the shopper\'s order before the page-view filter — a frame naming another page view is not drawn, yet its newer order is kept; without personalization consent nothing is kept', async () => {
    const p = sdkPage();
    expect(await p.core.ready(), 'PRECONDITION: the client is ready').toBe(true);
    await p.connect();
    await p.view({ ts: T0 + 10, shotOrder: ['studio'] });
    const drawn: unknown[] = [];
    p.listen.onDecisions(set => { drawn.push(set); });
    drawn.length = 0;
    await p.frame({ pageInstance: 'another-page-view', ts: T0 + 20, shotOrder: ['detail', 'studio'] });
    const kept = p.shots();
    p.destroy();
    const refused = sdkPage({ personalization: false });
    expect(await refused.core.ready(), 'PRECONDITION: the client without personalization is ready').toBe(true);
    // An answer carrying an order while the shopper's personalization is refused (the engine's own carries null there; a
    // stale or foreign answer could): the SDK's own consent decides, so nothing is kept. Its arm is the default arm's, which
    // the client delivers without personalization consent (core.ts getJson, decisionRequiresConsent).
    await refused.view({ ts: T0 + 10, arm: 'default', shotOrder: ['studio'] });
    const none = refused.shots();
    refused.destroy();
    expect.soft({ drawn: drawn.length, kept: (kept as { order?: unknown }).order ?? kept, none }, 'P89.SO2 — kept from any frame, drawn only for its page view, never without consent').toEqual({
      drawn: 0, kept: ['detail', 'studio'], none: 'no shots' });
  });
});

// ---------------------------------------------------------------------------
// The head script, built (public/sdk/edge-head.js), run in a browser double (jsdom: the page's location, user agent,
// first-party storage and cookie; the server render's two inert blocks before it). P84's form, reduced: nothing is fetched.
// ---------------------------------------------------------------------------

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const HEAD_FILE = `${ROOT}public/sdk/edge-head.js`;
const NOW = Date.UTC(2026, 9, 26, 12, 0, 0);
const VISITOR = 'vis-00000000-0000-4000-8000-0000000000c1', OTHER_VISITOR = 'vis-00000000-0000-4000-8000-0000000000c2';
const PRODUCT_URL = 'https://shop.example.invalid/products/tabby-shoulder-bag-26?utm_medium=paid_social&utm_source=instagram';
interface HeadImage { id: string; tags: Record<string, string[]>; src: string }
const headImage = (n: number, contentType: string[]): HeadImage => ({ id: `h${n}`, tags: contentType.length ? { contentType } : {}, src: `https://images.example.invalid/h${n}.jpg` });
const HEAD_IMAGES = [headImage(1, ['studio']), headImage(2, ['flat_lay']), headImage(3, ['on_model']), headImage(4, ['detail']), headImage(5, ['on_model']),
  headImage(6, ['studio']), headImage(7, []), headImage(8, ['video'])];
const ROW_PAINT = ['h3', 'h5', 'h4', 'h1', 'h6', 'h2', 'h7', 'h8'], SERVER_ORDER = HEAD_IMAGES.map(i => i.id);
const PIN_WINDOW = { from: new Date(NOW - 3_600_000).toISOString(), to: new Date(NOW + 3_600_000).toISOString() };
/** The context table as the server render inlines it (P84's P3), reduced to the members the head script reads. */
const headTable = (over: Record<string, unknown> = {}) => ({ version: 'p89-table-v1', page: 'pdp', layoutSlot: LAYOUT, carouselSlot: CAROUSEL, classifierVersion: CLASSIFIER_VERSION,
  holdout: { share: 0, arms: ['default'], saltVersion: 1 }, default: { layout: { mobile: null, desktop: null }, shotOrder: { mobile: null, desktop: null } },
  rows: [{ channel: 'paid_social', visitBucket: '1', layout: { mobile: null, desktop: null }, shotOrder: { mobile: SHOT_PS, desktop: null } }], brandRules: {}, ...over });
const shotsFor = (order: string[], over: Record<string, unknown> = {}) => ({ tenant: TENANT, subject: VISITOR, anonymous: true, order, ts: NOW - DAY, ...over });
const headState = (shots: unknown, over: Record<string, unknown> = {}) => JSON.stringify({ consent: { tracking: true, personalization: true }, ...(shots ? { shots } : {}), ...over });

type HeadWindow = { localStorage: { getItem(k: string): string | null; setItem(k: string, v: string): void }; document: { cookie: string; documentElement: { getAttribute(n: string): string | null;
  style: { getPropertyValue(n: string): string } } }; Date: { now: () => number }; eval(code: string): unknown };
type Loader = new (options: { userAgent: string }) => { fetch(url: string, options: unknown): unknown };
const { JSDOM, ResourceLoader, VirtualConsole } = jsdom as unknown as { JSDOM: new (html: string, options: Record<string, unknown>) => { window: unknown }; ResourceLoader: Loader;
  VirtualConsole: new () => object };
/** A subresource loader that loads nothing (P84's form): the browser's user agent, and no run reaches the network. */
class NoFetch extends ResourceLoader { override fetch() { return null; } }
interface HeadRun { error: string | null; context: string | null; order: string[]; stored: Record<string, unknown> | null; window: HeadWindow }
/** One page load: the head script run once over `storage` and `cookie`, on a mobile or desktop browser. */
function runHead(o: { table?: unknown; storage?: Record<string, string>; cookie?: string; ua?: string; consentAttribute?: boolean } = {}): HeadRun {
  const html = `<!doctype html><html${o.consentAttribute ? ' data-op-consent="personalization"' : ''}><head>`
    + `<script type="application/json" id="op-context-table">${JSON.stringify(o.table ?? headTable())}</script>`
    + `<script type="application/json" id="op-images">${JSON.stringify(HEAD_IMAGES)}</script><link rel="stylesheet" href="/css/site.css"></head><body></body></html>`;
  const dom = new JSDOM(html, { url: PRODUCT_URL, runScripts: 'outside-only', virtualConsole: new VirtualConsole(), resources: new NoFetch({ userAgent: o.ua ?? MOBILE_UA }) });
  const w = dom.window as HeadWindow;
  for (const [k, v] of Object.entries(o.storage ?? {})) w.localStorage.setItem(k, v);
  if (o.cookie) w.document.cookie = o.cookie;
  w.Date.now = () => NOW;
  Object.defineProperty(w, 'crypto', { configurable: true, value: { randomUUID: () => crypto.randomUUID(),
    getRandomValues: <T extends ArrayBufferView>(a: T): T => { new Uint32Array(a.buffer, a.byteOffset, Math.floor(a.byteLength / 4)).fill(4294967295); return a; } } });
  let error: string | null = null;
  try { w.eval(readFileSync(HEAD_FILE, 'utf8')); } catch (e) { error = `the head script threw: ${(e as Error).message}`; }
  const root = w.document.documentElement;
  const at = HEAD_IMAGES.map(i => ({ id: i.id, at: Number(root.style.getPropertyValue(`--op-${CAROUSEL}-${HEAD_IMAGES.indexOf(i) + 1}`).trim()) }));
  const order = at.filter(x => Number.isInteger(x.at) && x.at >= 1).sort((a, b) => a.at - b.at).map(x => x.id);
  let stored: Record<string, unknown> | null = null;
  try { stored = JSON.parse(w.localStorage.getItem(HEAD_KEY) ?? 'null') as Record<string, unknown> | null; } catch { stored = null; }
  return { error, context: root.getAttribute('data-op-context'), order, stored, window: w };
}
const visitorStorage = (shots: unknown, over: Record<string, unknown> = {}) => ({ opt_visitor_id: VISITOR, [HEAD_KEY]: headState(shots, over) });

describe('unit:P89.SO2 (R-P459 S4) — the head script', () => {
  it('head: the shopper\'s stored order paints first under the row\'s gate — on mobile before the row\'s other values (flat_lay, studio, then on_model, detail), on desktop, where the row names no order, alone before the server order — the tag pin applied after it, unchanged; data-op-context keeps its meaning', () => {
    const order = ['flat_lay', 'studio'];
    const mobile = runHead({ storage: visitorStorage(shotsFor(order)) });
    const desktop = runHead({ storage: visitorStorage(shotsFor(order)), ua: DESKTOP_UA });
    const pinned = runHead({ storage: visitorStorage(shotsFor(order)), table: headTable({ brandRules: { pinnedTag: { dimension: 'contentType', value: 'detail', window: PIN_WINDOW } } }) });
    expect([mobile.error, desktop.error, pinned.error], 'PRECONDITION: the head script runs').toEqual([null, null, null]);
    expect.soft({ mobile: [mobile.order, mobile.context], desktop: [desktop.order, desktop.context], pinned: pinned.order },
      'P89.SO2 — the stored order first (today the row alone, or the server order)').toEqual({
      mobile: [['h2', 'h1', 'h6', 'h3', 'h5', 'h4', 'h7', 'h8'], 'paid_social|1|mobile'],
      desktop: [['h2', 'h1', 'h6', 'h3', 'h4', 'h5', 'h7', 'h8'], 'paid_social|1|desktop'],
      pinned: ['h4', 'h2', 'h1', 'h6', 'h3', 'h5', 'h7', 'h8'] });
  });

  it('head: outside the row\'s gate or the visitor the browser carries, the stored order paints nothing — the holdout\'s class, no recorded consent, a refusal cookie (which also drops the stored order), a moved salt, another visitor\'s order, an order older than 30 days — and a never-seen browser paints as today', () => {
    const order = ['flat_lay', 'studio'];
    const cases: Array<[string, () => HeadRun, string[]]> = [
      ['the holdout\'s class', () => runHead({ storage: visitorStorage(shotsFor(order)), table: headTable({ holdout: { share: 1, arms: ['default'], saltVersion: 1 } }) }), SERVER_ORDER],
      ['no recorded consent', () => runHead({ storage: { opt_visitor_id: VISITOR, [HEAD_KEY]: JSON.stringify({ shots: shotsFor(order) }) } }), SERVER_ORDER],
      ['a refusal cookie', () => runHead({ storage: visitorStorage(shotsFor(order)), cookie: 'opt_personalization_enabled=false' }), SERVER_ORDER],
      ['a moved salt', () => runHead({ storage: visitorStorage(shotsFor(order), { experiment: { id: `${TENANT}:${BRAND}:p89-salt`, saltVersion: 1 } }),
        table: headTable({ holdout: { share: 0, arms: ['default'], saltVersion: 2 } }) }), SERVER_ORDER],
      ['another visitor\'s order', () => runHead({ storage: visitorStorage(shotsFor(order, { subject: OTHER_VISITOR })) }), ROW_PAINT],
      ['an order older than 30 days', () => runHead({ storage: visitorStorage(shotsFor(order, { ts: NOW - 31 * DAY })) }), ROW_PAINT],
      ['a never-seen browser', () => runHead({ consentAttribute: true }), ROW_PAINT],
    ];
    const runs = cases.map(([name, run]) => [name, run()] as const);
    expect(runs.map(([, r]) => r.error), 'PRECONDITION: the head script runs').toEqual(cases.map(() => null));
    const refusal = runs.find(([name]) => name === 'a refusal cookie')![1];
    expect.soft({ orders: runs.map(([name, r]) => [name, r.order]), dropped: refusal.stored?.shots ?? 'dropped' },
      'P89.SO2 — the stored order only for its own visitor, under the row\'s gate; a refusal drops it (today it is kept)').toEqual({
      orders: cases.map(([name, , expected]) => [name, expected]), dropped: 'dropped' });
  });
});

describe('unit:P89.SO2 (R-P459 S4) — never a carousel on screen', () => {
  it('head + sdk: after the head script painted the carousel, a frame carrying another order for the open page view changes no drawn slide — the page\'s custom properties stay as painted — while the order is kept for the next page view', async () => {
    const painted = runHead({ storage: visitorStorage(shotsFor(['flat_lay', 'studio'])) });
    expect(painted.error, 'PRECONDITION: the head script runs').toBe(null);
    const root = painted.window.document.documentElement, positions = () => HEAD_IMAGES.map((_, n) => root.style.getPropertyValue(`--op-${CAROUSEL}-${n + 1}`).trim());
    const before = positions();
    // The SDK on the same page: its storage the page's own, the page's document within reach.
    const f = testHost();
    f.host.storage = { get: (k: string) => painted.window.localStorage.getItem(k), set: (k: string, v: string) => painted.window.localStorage.setItem(k, v) };
    const g = globalThis as Record<string, unknown>, saved = { document: g.document, window: g.window };
    g.document = painted.window.document; g.window = painted.window;
    try {
      const p = sdkPage({ host: f });
      expect(await p.core.ready(), 'PRECONDITION: the client is ready').toBe(true);
      await p.connect();
      await p.view({ ts: NOW, shotOrder: ['flat_lay', 'studio'] });
      const view = (p.listen.current() as DecisionSet | null)?.pageInstance ?? '';
      await p.frame({ pageInstance: view, ts: NOW + 1, shotOrder: ['detail', 'on_model'] });
      const kept = p.shots();
      p.destroy();
      expect.soft({ positions: positions(), kept: (kept as { order?: unknown }).order ?? kept }, 'P89.SO2 — nothing redrawn; the new order kept for the next page view').toEqual({
        positions: before, kept: ['detail', 'on_model'] });
    } finally { g.document = saved.document; g.window = saved.window; }
  });
});

// ===========================================================================
// unit:P89.SO3 — corrections: the rebind at a sign-in, the person's first answer, the removals, the bootstrap
// ===========================================================================

describe('unit:P89.SO3 (R-P459 S5)', () => {
  it('sdk: at a sign-in the anonymous order is rebound to the person (same order, the person\'s subject); the first answer under the person replaces it; no request is added', async () => {
    const p = sdkPage();
    expect(await p.core.ready(), 'PRECONDITION: the client is ready').toBe(true);
    const anonymous = p.core.visitorId;
    await p.view({ ts: T0 + 10, shotOrder: ['studio', 'detail'] });
    const calls = p.f.calls.length;
    const linked = await p.identity.identify('acct', { assertion: 'backend-proof', exp: 1_800_000_000 });
    expect([linked.ok, p.core.visitorId], `PRECONDITION: the sign-in is accepted (${JSON.stringify(linked)})`).toEqual([true, SHOPPER_ID]);
    const rebound = p.shots() as { subject?: unknown; order?: unknown };
    const added = p.f.calls.slice(calls).map(c => new URL(c.url).pathname).filter(path => !path.endsWith('/identity/link'));
    await p.view({ ts: T0 + 20, shotOrder: ['on_model'] });
    const corrected = p.shots() as { subject?: unknown; order?: unknown };
    p.destroy();
    expect.soft({ before: anonymous !== SHOPPER_ID, rebound: [rebound.subject, rebound.order], added, corrected: [corrected.subject, corrected.order] },
      'P89.SO3 — rebound at the sign-in, corrected by the person\'s first answer (today the order is never kept)').toEqual({
      before: true, rebound: [SHOPPER_ID, ['studio', 'detail']], added: [], corrected: [SHOPPER_ID, ['on_model']] });
  });

  it('sdk: the stored order is removed at a sign-out, at a sign-in as another person when the stored order is not an anonymous visitor\'s (no rebind), and at a refusal of personalization', async () => {
    const out = sdkPage();
    expect(await out.core.ready(), 'PRECONDITION: the client is ready').toBe(true);
    await out.view({ ts: T0 + 10, shotOrder: ['studio'] });
    const signedOut = await out.identity.logout();
    expect(signedOut.ok, `PRECONDITION: the sign-out is accepted (${JSON.stringify(signedOut)})`).toBe(true);
    const afterLogout = out.shots();
    out.destroy();
    const person = sdkPage();
    expect(await person.core.ready(), 'PRECONDITION: the client is ready').toBe(true);
    expect((await person.identity.identify('acct', { assertion: 'backend-proof', exp: 1_800_000_000 })).ok, 'PRECONDITION: the first sign-in').toBe(true);
    await person.view({ ts: T0 + 20, shotOrder: ['detail'] });
    const personsOrder = person.shots() as { subject?: unknown; anonymous?: unknown };
    person.linkTo(OTHER_ID);
    expect((await person.identity.identify('acct-2', { assertion: 'backend-proof', exp: 1_800_000_000 })).ok, 'PRECONDITION: the second sign-in, another person').toBe(true);
    const afterOther = person.shots();
    person.destroy();
    const refusing = sdkPage();
    expect(await refusing.core.ready(), 'PRECONDITION: the client is ready').toBe(true);
    await refusing.view({ ts: T0 + 10, shotOrder: ['studio'] });
    await refusing.core.postJson('/realtime/session/preferences', { trackingConsent: true, personalizationEnabled: false });
    await settle();
    const afterRefusal = refusing.shots();
    refusing.destroy();
    expect.soft({ afterLogout, personsOrder: [personsOrder.subject, personsOrder.anonymous], afterOther, afterRefusal },
      'P89.SO3 — removed at a sign-out, another person and a refusal').toEqual({ afterLogout: 'no shots', personsOrder: [SHOPPER_ID, false], afterOther: 'no shots', afterRefusal: 'no shots' });
  });

  it('sdk: the bootstrap identity event of the next page load (previous empty) clears nothing — the same visitor\'s order stays for the head script', async () => {
    const first = sdkPage();
    expect(await first.core.ready(), 'PRECONDITION: the client is ready').toBe(true);
    const visitor = first.core.visitorId;
    await first.view({ ts: T0 + 10, shotOrder: ['studio', 'detail'] });
    const kept = first.shots();
    first.destroy();
    // The next page load: a new client over the same browser storage, its bootstrap identity event emitted.
    const reload = sdkPage({ host: first.f });
    const events: unknown[] = [];
    reload.core.on('identity', change => { events.push(change); });
    expect(await reload.core.ready(), 'PRECONDITION: the reloaded client is ready').toBe(true);
    await settle();
    const after = reload.shots();
    reload.destroy();
    expect([reload.core.visitorId, (kept as { order?: unknown }).order ?? kept], 'PRECONDITION: the same visitor, the order kept by the first page (today nothing is kept)').toEqual([visitor, ['studio', 'detail']]);
    expect.soft({ events: events.map(e => (e as { previous?: unknown }).previous), after }, 'P89.SO3 — the bootstrap event clears nothing').toEqual({ events: [''], after: kept });
  });
});

// ===========================================================================
// unit:P89.SO4 — the kit
// ===========================================================================

describe('unit:P89.SO4 (R-P459 S6)', () => {
  it('logic: kits 01, 02 and 03 state the carried order — the frame and its trigger, the answer\'s member, the SDK\'s storage for the visitor the browser carries, the head script\'s order before the row and its gate, the sign-in\'s rebind and correction with listen.refresh() after identify() without a live connection, the removals — and kit 03\'s shot-orders example weighs contentType', () => {
    const paragraphs = (text: string) => text.split(/\n\s*\n/).map(p => p.split('\n').join(' '));
    const kit01 = readTree('docs/kit/01-integration-guide.md'), kit02 = readTree('docs/kit/02-api-reference.md'), kit03 = readTree('docs/kit/03-payload-schemas.md');
    const has = (text: string, ...words: Array<string | RegExp>) => paragraphs(text).some(p => words.every(w => typeof w === 'string' ? p.includes(w) : w.test(p)));
    const row = (text: string) => text.split('\n').find(line => line.startsWith('| `content_decisions` |')) ?? '';
    const shotSection = kit03.slice(kit03.indexOf('### Shot orders'), kit03.indexOf('## The learn document'));
    const example = /```json([\s\S]*?)```/.exec(shotSection)?.[1] ?? '';
    expect.soft({
      kit01Row: /shot order/i.test(row(kit01)) && row(kit01).includes('`shotOrder`'),
      kit01Carried: has(kit01, '`opt_head`', /next page view/i, /first landing/i, /\bhold/i, /sign-in|`identify\(\)`/, /`listen\.refresh\(\)` after `identify\(\)`/, /sign-out|`logout\(\)`/, /refus/i, /storage[^.]*cleared|cleared storage/i),
      kit01Head: has(kit01, /head script/i, /(?:shopper's own|their own|the shopper's) (?:shot )?order/i, /before the (?:context's )?row|ahead of the (?:context's )?row/i),
      kit02Frame: has(kit02, '`content_decisions`', '`shotOrder`', /shot order changes|order alone changes|whenever the shopper's shot order/i),
      kit02Member: has(kit02, '`shotOrder`', /\bnull\b/, /carousel/i, /contentType/),
      kit02Head: has(kit02, /head script/i, '`shots`', /subject|visitor/i, /30 days/),
      kit03Row: row(kit03).includes('shotOrder'),
      kit03Decision: has(kit03, 'One item in snapshot `decisions[]`', '`shotOrder`'),
      kit03Section: /weighs `contentType`|weighs contentType|a `contentType` weight|positive `contentType` weight/i.test(shotSection),
      kit03Example: /"weights":\s*\{[^}]*"contentType"/.test(example),
    }, 'P89.SO4 — the kit states the carried order (today it says none of it, and the example weighs category alone)').toEqual({
      kit01Row: true, kit01Carried: true, kit01Head: true, kit02Frame: true, kit02Member: true, kit02Head: true, kit03Row: true, kit03Decision: true, kit03Section: true, kit03Example: true });
  });
});
