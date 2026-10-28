// src/units/P100/LEDGER.unit.test.ts
// P100 under the Closure Ledger: the tests for the LOCAL criteria HN1-HN3 of the P100 work order (the programme
// tapestry-parity-hardening of amendment 13, ticket P100 "A browser that drew while the salt version was unknown", E24;
// batch S45). LV1 is a deferred live row and gets no test.
// ROUND 2 (R-P560, the specification review of 5997a5ae): the number adopted is never 1 (the hosts' two-salt history, R3;
// HN2's tables 3, 3, 4, R7), each adopting browser lands on it twice before the rotation (R2'), and the browser with a
// recorded experiment and its identifier under the site's own key joins HN1's fixture (R4).
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-13/BTI-Parity-Amendment-2026-10-28-hardening.md, section 2,
// E24):
//   "#### E24 · A browser that drew while the salt version was unknown"
//   "- **Authority:** P95's delivery review (R-P531): a browser that drew its class while its tenant read a null salt
//   version keeps null and misses every later rotation on the head-script-only path (`src/sdk/head.ts:155–158`)."
//   "- **Done when:** the head script adopts the table's number when it holds null, without treating that as a rotation;
//   the SDK bundles regenerated within their budgets; the jsdom leg shows the next rotation repainting once."
//   "- **Needed by:** before the first activation. Hours."
// The work order (docs/parity/hardening/program.json, P100): HN1 the head-script-only branch adopts the table's number in
// place of a held null without a rotation, the next rotation repaints the default row once and the class is drawn again,
// on both hosts, in jsdom with the built head script; a held number, a held null on a null table and the known-visitor
// branch as today (LOCK). HN2 `node scripts/build-sdk.mjs --check` exits 0 with the head script regenerated in its three
// places and their .csp files, within 25,600-30,720 bytes, the two SDK bundles byte-equal to 340cd410's. HN3 kits 01 and
// 02 state it; kit 01's sentence P95 pins (KIT01_ROTATED) still reads as it does.
//
// TODAY (99ddcafc = 340cd410 for every file here): src/sdk/head.ts main, the head-script-only branch (`else if
// (record(state.arm) …)`, :155-158) takes `rotated` from `moved` (:146), false whenever either side is null, and writes
// the stored salt version only in `draw` (:147-150), so a held null stays null and every later rotation is missed.
//
// THE SKETCH (measured on a scratch copy, never committed): in that branch, after `rotated = moved(state.arm.saltVersion)`,
//   if (typeof state.arm.saltVersion !== 'number' && typeof holdout.saltVersion === 'number') state.arm.saltVersion = holdout.saltVersion;
// then `node scripts/build-sdk.mjs` (the six head-script files; the SDK bundles rewritten byte for byte), and the kit
// sentence below in kit 01's head-script paragraph and in kit 02's context-table and salt-version paragraphs.
//
// READINGS (where the work order is silent; for the lead):
//   R1 "Holds null": a stored `opt_head.arm` of a valid class whose `saltVersion` is null, on the head-script-only branch
//      (no `opt_visitor_id`, or no recorded `experiment`). An absent or non-number member is not pinned (the head script
//      always writes it, head.ts :149); the sketch adopts for any non-number.
//   R2 "Without treating that as a rotation": the adopting landing keeps the class (no draw: every landing that must not
//      draw is given a random source that would draw the OTHER class, so a draw shows), paints as that class paints (the
//      row for `personalized` with a recorded choice and a classified arrival, the default row for `default`) and stores
//      the number. Its `tableVersion` is not pinned (the engine reads the arm member's `tableVersion` for its form only,
//      src/routes/decisions.ts armMemberOf); the draw at the rotation stores today's draw form.
//   R3 "On both hosts": the table each landing reads is that host's own answer to GET /v1/coach/context-table/pdp, and
//      the null is the platform's own: a two-salt learn history (SALT_A at revision 1, SALT_B at 2) as a writer before
//      the salt annotation stored it (P95's R3/R5 form, its digests resealed; kit 02: "read `saltVersion: null` until
//      that tenant next publishes its learn document"); learn revision 3 (an unrelated edit on SALT_B) reads 2 (the
//      count over the whole stored history), the rotation to SALT_C at revision 4 reads 3. The number adopted is
//      therefore never 1 (R-P560 (1)): a browser storing a constant, or adopting only the first salt's number, is RED.
//   R4 "Holds no engine-known experiment" covers both head-script-only browsers beside the one with no identifier at
//      all (head.ts :152 takes the known-visitor branch only with both `opt_visitor_id` and a recorded experiment): one
//      carrying the SDK's `opt_visitor_id` with no recorded experiment, and one whose SDK keeps its identifier under
//      another `visitorIdKey` (kit 01 :719) and records each answer's experiment (src/sdk/listen.ts keepForHead), which
//      the head script, reading the default key only (head.ts :143), cannot use (R-P560 (2)). Both are in HN1's fixture.
//   R2' (R-P560 (1)) Every adopting browser lands twice on the adopted number before the rotation: the second landing
//      neither repaints nor draws (its random source would draw the other class).
//   R5 A browser holding a number keeps it on a table naming null (an older table a cache still serves at the stable
//      address, public for a minute): the adoption replaces a held null only (LOCK).
//   R6 The known-visitor lock: `opt_head.experiment` as the SDK records it from each answer (src/sdk/listen.ts
//      keepForHead, :295-303), from that host's own decision answers; its paint, its stored experiment and the absence
//      of a stored draw are as today.
//   R7 HN2 "regenerated in its three places" is read as: each of the three copies, run in jsdom, adopts a held null (a
//      hand table naming 3, landed on twice) and repaints once at the next rotation (4, a fresh draw); each `.csp` is its
//      copy's digest; `--check` exits 0. The two SDK bundles are
//      pinned by their SHA-256 at 340cd410 in each of their three places (a later ticket that changes src/sdk changes
//      them lawfully and re-forms these digests by an R10; told).
//   R8 HN3's sentence is ruled verbatim (KIT_NULL_TAKEN, the same in the three places), as P95's R8 ruled its kit
//      sentences; each place is its paragraph, white space normalised.
// DEFERRED: LV1 (the pair's l1 with a planted null, then one salt rotation, lane L21, LIVE1).
// RESIDUALS: (1) a tenant whose stored history can never establish the count (E23, P99) never names a number, so a
//   browser there keeps null and no rotation is seen there until P99; (2) on the rotation landing `data-op-arm` names
//   the class just drawn while the context is the default row (P84's form, unchanged).
// NO NEW EXPORT: every member imported here exists today.
//
// HARNESS: src/units/_parity.ts (the mounted app over the real Durable Object classes, both hosts), jsdom (the built head
// script, as src/units/P84/LEDGER.unit.test.ts runs it, :616-786, without its send counting, which P84 locks). Imports
// from src/units/: ../_parity. Tenant ids only; no network; files read from this tree (import.meta.url).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { invalidatePublicationCache } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { armFor, invalidateSaltVersions } from '@/content/holdout';
import { invalidateLiftCache } from '@/content/service';
import { CLASSIFIER_VERSION } from '@/services/visit';

import {
  BRAND, declaredSlots, expectPublished, HOSTS, LAYOUT, layoutSlot, learnDocument, MODULES, mount, putDocument, readTree, shopperOn, TENANT,
  type Host, type Mounted, type Shopper,
} from '../_parity';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const LONG_MS = 120_000;

// ---------------------------------------------------------------------------
// The fixture: the product page of COA-CH857 (Tabby Shoulder Bag 26) with its declared layout slot and its carousel,
// whose shot order for a paid-social first visit (both devices) is on_model, detail, studio, flat_lay (kit 03, shot
// orders). The server's image list carries an untagged image and a shot no row names (unknown inputs); the wallet's image
// (COA-CB925, another category) is in the catalogue and never in this page's list. The holdout: 20 per cent, `default`.
// ---------------------------------------------------------------------------

const PAGE = 'pdp';
const CAROUSEL = 'pdp-carousel';
const PRODUCT = 'COA-CH857', WALLET_PRODUCT = 'COA-CB925';
const SALT_A = 'p100-salt-a', SALT_B = 'p100-salt-b', SALT_C = 'p100-salt-c';
/** The SDK's `visitorIdKey` option (kit 01 :719) set by a site that keeps the identifier under its own key. */
const SITE_VISITOR_KEY = 'shop_visitor_id';
const SHOTS = ['on_model', 'detail', 'studio', 'flat_lay'];
interface ImagePiece { id: string; customerContentId: string; type: string; title: string; tags: Record<string, string[]>; slotTypes: string[];
  lifecycle: { status: string }; featuredProductIds: string[] }
const image = (n: number, contentType: string | null, product = PRODUCT): ImagePiece => ({
  id: `img-${product.slice(4).toLowerCase()}-${n}`, customerContentId: `TAP-IMG-${product}-${n}`, type: 'image', title: `${product} image ${n}`,
  tags: { category: [product === PRODUCT ? 'Handbags' : 'Small Leather Goods'], ...(contentType ? { contentType: [contentType] } : {}) },
  slotTypes: [CAROUSEL], lifecycle: { status: 'live' }, featuredProductIds: [product] });
/** The server's order: 1 studio, 2 flat_lay, 3 on_model, 4 detail, 5 untagged, 6 video (no row names it). */
const IMAGES = [image(1, 'studio'), image(2, 'flat_lay'), image(3, 'on_model'), image(4, 'detail'), image(5, null), image(6, 'video')];
const WALLET_IMAGE = image(1, 'on_model', WALLET_PRODUCT);
const id = (n: number) => `img-ch857-${n}`;
/** The default row: the server order (no brand rule on this carousel). */
const SERVER_ORDER = [1, 2, 3, 4, 5, 6].map(id);
/** The paid-social row: each image ranked by its shot's place in SHOTS, the untagged and the unnamed shot after, server order among equals. */
const ROW_ORDER = [3, 4, 1, 2, 5, 6].map(id);
const ROW_CONTEXT = 'paid_social|1|mobile';

const SHOT_ORDERS = [{ context: { channel: 'paid_social', visitBuckets: ['1'] }, order: SHOTS }];
const carousel = { slot: CAROUSEL, take: 6, weights: { category: 1 }, shotOrders: SHOT_ORDERS };
const HOLDOUT_SHARE = 0.2;
/** The learn document of revision n on one salt: the regional threshold moves with n, so every revision is a new document. */
const learnOn = (salt: string, n: number) => learnDocument({}, { holdout: { share: HOLDOUT_SHARE, salt, arms: ['default'] }, regional: { enabled: false, kBlend: 1, minEvents: 30 + n } });
const DOCS = { pieces: [...MODULES, ...IMAGES, WALLET_IMAGE], slots: declaredSlots([layoutSlot(), carousel]), learn: learnOn(SALT_A, 1) };
const idOf = (salt: string) => `${TENANT}:${BRAND}:${salt}`;
const classOf = (arm: string) => arm === 'default' ? 'default' : 'personalized';

/** A random source that draws `personalized` (p(default) = 0.2) and one that draws `default`. */
const DRAWS_PERSONALIZED = 0.999, DRAWS_DEFAULT = 0.001;

// ---------------------------------------------------------------------------
// The tenant on a host: its documents published, learn revision 1 then rewritten as a writer before the salt annotation
// stored it (src/units/P95/LEDGER.unit.test.ts plantLearnHistory, the `before` form: each rewritten envelope and every
// digest naming it — the set references, the chain of sets, the head — resealed over canonical JSON as the engine seals
// it, so the engine re-verifies every digest it reads). Nothing under test is stubbed.
// ---------------------------------------------------------------------------

/** A cold isolate: no publication, document, lift or salt count held from an earlier request. */
const cold = () => { invalidatePublicationCache(); invalidateCache(); invalidateLiftCache(); invalidateSaltVersions(); };
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value !== null && typeof value === 'object'
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
    : JSON.stringify(value);
const sha256 = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, '0')).join('');
const sealed = async (basis: Record<string, unknown>) => ({ ...basis, digest: await sha256(canonical(basis)) });

async function plantBeforeAnnotation(m: Mounted): Promise<void> {
  const storage = m.storage, revisions = `config-publication/v1/${TENANT}/learn/rev/`, sets = `config-publication/v2/${TENANT}/set/`, head = `config-publication/v2/${TENANT}/head.json`;
  const documentDigests = new Map<string, string>(), setDigests = new Map<string, string>();
  const learnKeys = [...storage.objects.keys()].filter(key => key.startsWith(revisions));
  expect(learnKeys.length, `PRECONDITION (${m.host}): the learn document is stored`).toBeGreaterThan(0);
  for (const key of learnKeys) {
    const { derived, digest, ...basis } = JSON.parse(storage.objects.get(key)!) as Record<string, unknown> & { derived?: { salt: string } };
    expect(derived?.salt, `PRECONDITION (${m.host}): ${key} was published with its salt annotation`).toEqual(expect.any(String));
    const envelope = await sealed(basis);
    documentDigests.set(digest as string, envelope.digest);
    await storage.put(key, canonical(envelope));
  }
  const setRevisions = [...storage.objects.keys()].filter(key => key.startsWith(sets)).map(key => Number(key.slice(sets.length, -'.json'.length))).sort((a, b) => a - b);
  for (const n of setRevisions) {
    const { digest, ...set } = JSON.parse(storage.objects.get(`${sets}${n}.json`)!) as { digest: string; refs: Record<string, { digest: string }>; operation: { base: { revision: number; digest: string } | null } };
    for (const ref of Object.values(set.refs)) ref.digest = documentDigests.get(ref.digest) ?? ref.digest;
    if (set.operation.base) set.operation.base = { revision: set.operation.base.revision, digest: setDigests.get(set.operation.base.digest) ?? set.operation.base.digest };
    const resealed = await sealed(set as unknown as Record<string, unknown>);
    setDigests.set(digest, resealed.digest);
    await storage.put(`${sets}${n}.json`, canonical(resealed));
  }
  const { digest: headDigest, ...current } = JSON.parse(storage.objects.get(head)!) as { digest: string; committed: { revision: number; digest: string } };
  expect(typeof headDigest, `PRECONDITION (${m.host}): the head is sealed`).toBe('string');
  current.committed = { revision: current.committed.revision, digest: setDigests.get(current.committed.digest)! };
  await storage.put(head, canonical(await sealed(current as unknown as Record<string, unknown>)));
  cold();
}

/**
 * The tenant reading a null salt version on this host (R3): published on SALT_A, rotated to SALT_B at learn revision 2,
 * then both learn revisions as a writer before the annotation stored them. Its next learn publication counts 2.
 */
async function nullTenant(host: Host): Promise<Mounted> {
  const m = await mount(host, DOCS);
  expectPublished(m, 'P100 — the product page (its layout slot, its carousel with shot orders) and the learn document on SALT_A publish');
  await publishLearn(m, SALT_B, 2);
  await plantBeforeAnnotation(m);
  return m;
}

interface ContextTable { version: string; carouselSlot: string | null; holdout: { share: number; arms: string[]; saltVersion: number | null } }
/** GET /v1/<tenant>/context-table/<page> on this host: no session, no token, as a server render reads it. */
async function tableOn(m: Mounted, saltVersion: number | null, when: string): Promise<ContextTable> {
  cold();
  const response = await m.fetch(new Request(`https://shop.invalid/v1/${TENANT}/context-table/${PAGE}`, { headers: { 'X-Tenant': TENANT } }));
  const table = await response.json().catch(() => ({})) as ContextTable;
  await m.drain();
  expect({ status: response.status, carouselSlot: table.carouselSlot ?? null, saltVersion: table.holdout?.saltVersion },
    `PRECONDITION (${m.host}): ${when}, the host answers the product page's context table, its carousel named and holdout.saltVersion ${String(saltVersion)}`)
    .toEqual({ status: 200, carouselSlot: CAROUSEL, saltVersion });
  return table;
}

/** The operator's learn publication through the mounted route (kit 02: If-Match from the loaded draft, Idempotency-Key). */
async function publishLearn(m: Mounted, salt: string, n: number): Promise<void> {
  cold();
  const answer = await putDocument(m, 'learn', learnOn(salt, n), `p100 learn ${n}`);
  expect({ status: answer.status, revision: answer.body.revision }, `PRECONDITION (${m.host}): learn revision ${n} on ${salt} publishes (${JSON.stringify(answer.body).slice(0, 300)})`)
    .toEqual({ status: 200, revision: n });
  cold();
}

/** A shopper with a recorded choice whose engine class is `personalized` under both salts (armFor, the engine's own function). */
async function personalizedShopper(m: Mounted): Promise<Shopper> {
  for (let k = 0; k < 24; k++) {
    const s = await shopperOn(m);
    if ([SALT_B, SALT_C].every(salt => classOf(armFor(s.subject, { share: HOLDOUT_SHARE, salt, arms: ['default'] })) === 'personalized')) return s;
  }
  throw new Error(`PRECONDITION (${m.host}): no shopper of 24 fell in the personalized class under SALT_B and SALT_C`);
}
/** The experiment the SDK records from the host's own decision answer (src/sdk/listen.ts keepForHead: { id, saltVersion }). */
async function answeredExperiment(m: Mounted, s: Shopper, id: string, saltVersion: number | null): Promise<{ id: string; saltVersion: number | null }> {
  cold();
  const answer = await s.snapshot(PAGE);
  const e = answer.body.experiment as { id?: unknown; saltVersion?: unknown } | undefined;
  const kept = { id: typeof e?.id === 'string' ? e.id : 'no experiment on the answer', saltVersion: typeof e?.saltVersion === 'number' ? e.saltVersion : null };
  expect({ status: answer.status, experiment: kept }, `PRECONDITION (${m.host}): the shopper's decision answer carries experiment ${id} at salt version ${String(saltVersion)}`)
    .toEqual({ status: 200, experiment: { id, saltVersion } });
  return kept;
}

// ---------------------------------------------------------------------------
// The head script, built, run in a browser double (jsdom): the page's location (a paid-social arrival from Instagram on
// the product page), referrer and mobile user agent, first-party storage carried from one landing of the browser to the
// next, the server render's two inert blocks before it and its consent hint on the root, the random source the draw
// reads, one fixed clock (one visit). It reads what the head script writes: the root's attributes, the carousel's
// custom properties, the stored `opt_head`.
// ---------------------------------------------------------------------------

const HEAD_COPIES = ['public/sdk/edge-head.js', 'public/sdk/0.2.0/edge-head.js', 'packages/sdk/edge-head.js'] as const;
const PRODUCT_URL = 'https://shop.example.invalid/products/tabby-shoulder-bag-26?utm_medium=paid_social&utm_source=instagram';
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const NOW = Date.UTC(2026, 9, 28, 15, 0, 0);
const CONSENTED = { personalization: true, tracking: true };
const HEAD_IMAGES = IMAGES.map(img => ({ id: img.id, tags: Object.fromEntries(Object.entries(img.tags).filter(([k]) => k === 'contentType')),
  src: `https://images.example.invalid/${img.id}.jpg`, srcset: `https://images.example.invalid/${img.id}-640.jpg 640w`, sizes: '100vw' }));

interface HeadWindow {
  localStorage: { getItem(key: string): string | null; setItem(key: string, value: string): void; key(i: number): string | null; length: number };
  document: { documentElement: { getAttribute(name: string): string | null; style: { getPropertyValue(name: string): string } } };
  navigator: object; Date: { now: () => number }; eval(code: string): unknown; close(): void;
}
/** A browser: its first-party storage, carried from one landing to the next. */
interface Browser { storage: Record<string, string> }
const browser = (storage: Record<string, string> = {}): Browser => ({ storage: { ...storage } });
interface HeadState { arm?: { class?: unknown; saltVersion?: unknown }; experiment?: unknown }
interface Landed { landing: string; context: string | null; arm: string | null; order: string | string[]; held: Record<string, unknown> | string }

/** One landing of `b` on a page carrying `table`, the head script read from `file` (a path under the checkout). */
async function land(b: Browser, landing: string, table: unknown, random: number, file: string = HEAD_COPIES[0]): Promise<Landed & { stored: HeadState | null; error: string | null }> {
  const html = '<!doctype html><html data-op-consent="personalization"><head>'
    + `<script type="application/json" id="op-context-table">${JSON.stringify(table)}</script>`
    + `<script type="application/json" id="op-images">${JSON.stringify(HEAD_IMAGES)}</script>`
    + '<link rel="stylesheet" href="/css/site.css"></head><body><div class="pdp-carousel">'
    + HEAD_IMAGES.map(i => `<figure data-op-slot="${CAROUSEL}" data-op-content="${i.id}"><img src="${i.src}" alt=""></figure>`).join('') + '</div></body></html>';
  const dom = new JSDOM(html, { url: PRODUCT_URL, referrer: 'https://l.instagram.com/', runScripts: 'outside-only' });
  const w = dom.window as unknown as HeadWindow;
  for (const [k, v] of Object.entries(b.storage)) w.localStorage.setItem(k, v);
  Object.defineProperty(w.navigator, 'userAgent', { configurable: true, value: MOBILE_UA });
  Object.defineProperty(w, 'crypto', { configurable: true, value: { randomUUID: () => crypto.randomUUID(),
    getRandomValues: <T extends ArrayBufferView>(a: T): T => { new Uint32Array(a.buffer, a.byteOffset, Math.floor(a.byteLength / 4)).fill(Math.min(4294967295, Math.floor(random * 4294967296))); return a; } } });
  w.Date.now = () => NOW;
  let error: string | null = null;
  try { w.eval(readFileSync(join(ROOT, file), 'utf8')); } catch (e) { error = `the head script threw: ${(e as Error).message}`; }
  const root = w.document.documentElement;
  const positions = HEAD_IMAGES.map((_, n) => Number(root.style.getPropertyValue(`--op-${CAROUSEL}-${n + 1}`).trim()));
  const painted = HEAD_IMAGES.map((img, n) => ({ id: img.id, at: positions[n]! })).filter(x => Number.isInteger(x.at) && x.at >= 1).sort((x, y) => x.at - y.at).map(x => x.id);
  const order = JSON.stringify(painted) === JSON.stringify(ROW_ORDER) ? 'row' : JSON.stringify(painted) === JSON.stringify(SERVER_ORDER) ? 'server' : painted;
  b.storage = Object.fromEntries(Array.from({ length: w.localStorage.length }, (_, i) => w.localStorage.key(i)!).map(k => [k, w.localStorage.getItem(k)!]));
  let stored: HeadState | null = null;
  try { stored = JSON.parse(b.storage.opt_head ?? 'null') as HeadState | null; } catch { stored = null; }
  const held = record(stored?.arm) ? { class: stored!.arm!.class, saltVersion: stored!.arm!.saltVersion } : 'no draw kept';
  const result = { landing, context: root.getAttribute('data-op-context'), arm: root.getAttribute('data-op-arm'), order, held, stored, error };
  w.close();
  return result;
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** What a landing is compared on: the row painted (context, class, carousel order) and the draw kept. */
const seen = ({ landing, context, arm, order, held }: Landed): Landed => ({ landing, context, arm, order, held });
/** A known visitor's landing: what it painted, the experiment it holds and whether a draw was kept beside it. */
const seenKnown = (l: Landed & { stored: HeadState | null }) => ({ landing: l.landing, context: l.context, arm: l.arm, order: l.order,
  held: { experiment: l.stored?.experiment ?? 'no experiment kept', arm: l.stored?.arm ?? 'no draw kept' } });
/** The SDK recording an answer's experiment for the head script, as src/sdk/listen.ts keepForHead writes it. */
function recordAnswer(b: Browser, experiment: { id: string; saltVersion: number | null }): void {
  const prior = JSON.parse(b.storage.opt_head ?? 'null') as unknown;
  b.storage.opt_head = JSON.stringify({ ...(record(prior) ? prior : {}), experiment, consent: CONSENTED });
}
const at = (landing: string, context: string, arm: string, order: 'row' | 'server', held: Landed['held']): Landed => ({ landing, context, arm, order, held });

// ---------------------------------------------------------------------------
// HN2 and HN3: the witnesses.
// ---------------------------------------------------------------------------

/** A context table as kit 02 states it (the members the head script reads), naming `saltVersion`; for the logic legs. */
const handTable = (saltVersion: number | null) => ({ version: `p100-hand-table-${String(saltVersion)}`, page: PAGE, layoutSlot: LAYOUT, carouselSlot: CAROUSEL,
  classifierVersion: CLASSIFIER_VERSION, holdout: { share: HOLDOUT_SHARE, arms: ['default'], saltVersion },
  default: { layout: { mobile: null, desktop: null }, shotOrder: { mobile: null, desktop: null } },
  rows: [{ channel: 'paid_social', visitBucket: '1', layout: { mobile: null, desktop: null }, shotOrder: { mobile: SHOTS, desktop: SHOTS } }], brandRules: {} });
/** The head script's budget (packages/sdk/package.json :36) and W40.P3's rule: less than 5 KB under it. */
const HEAD_BUDGET = 30_720, FIVE_KB = 5_120;
/** The two SDK bundles in their three places at 340cd410 (`git show 340cd410:<path> | sha256sum`; unchanged at 99ddcafc). */
const SDK_BUNDLES_AT_340CD410: Record<string, string> = {
  'public/sdk/edge-personalization.esm.js': 'de7585b2501a8718bd9e186fe1a32702e0a9c6fc23fad75e0b4e2c3cd78b25fb',
  'public/sdk/0.2.0/edge-personalization.esm.js': 'de7585b2501a8718bd9e186fe1a32702e0a9c6fc23fad75e0b4e2c3cd78b25fb',
  'packages/sdk/edge-personalization.esm.js': 'de7585b2501a8718bd9e186fe1a32702e0a9c6fc23fad75e0b4e2c3cd78b25fb',
  'public/sdk/edge-personalization.js': '77b147c0517ef73e705d2bce9426faead3bc96be571eb520242c67ad1e75720e',
  'public/sdk/0.2.0/edge-personalization.js': '77b147c0517ef73e705d2bce9426faead3bc96be571eb520242c67ad1e75720e',
  'packages/sdk/edge-personalization.js': '77b147c0517ef73e705d2bce9426faead3bc96be571eb520242c67ad1e75720e',
};
const bytesOf = (path: string) => readFileSync(join(ROOT, path));

/** R8: the sentence HN3 rules, the same in kit 01's head-script paragraph and in kit 02's two paragraphs. */
const KIT_NULL_TAKEN = 'A browser that drew its class while the table\'s `holdout.saltVersion` was `null` keeps that class and, at its first landing on a table that names a number, takes that number without repainting; it paints the default row once at the next change of salt.';
/** Kit 01 :640-643, white space normalised: P95's KIT01_ROTATED (src/units/P95/LEDGER.unit.test.ts :315), kept. */
const KIT01_ROTATED = 'It paints the default row, your server order within the brand rules, for the holdout\'s default class, without a recorded personalization choice, for an arrival or a device it cannot classify, for a table naming another classifier version, and once after the experiment\'s salt changes.';
/** The paragraph holding `marker`, white space normalised, or '' where there is none. */
function paragraphOf(text: string, marker: string): string {
  const where = text.indexOf(marker);
  if (where < 0) return '';
  const from = text.lastIndexOf('\n\n', where), to = text.indexOf('\n\n', where);
  return text.slice(from < 0 ? 0 : from, to < 0 ? undefined : to).replace(/\s+/g, ' ').trim();
}
const KIT01_HEAD = 'Set `data-op-consent="personalization"` on the root element';
const KIT02_TABLE = '**The context table and the head script.**';
const KIT02_SALT = '`saltVersion` is 1 for the first salt';

// ===========================================================================
// unit:P100.HN1 — a held null takes the table's number without a rotation; the next rotation repaints once
// ===========================================================================

describe('unit:P100.HN1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a browser that drew its class while the host's context table read a null salt version, holding no engine-known experiment (no visitor id; the SDK's visitor id with no recorded experiment; a recorded experiment with the visitor id under the site's own key), lands twice on the table naming 2: it keeps its class, paints as that class paints and stores 2 in place of the null, without a repaint or a draw; at the rotation (the table naming 3) it paints the default row once and draws its class again; the landing after paints its class's row`, async () => {
      const m = await nullTenant(host);
      const t0 = await tableOn(m, null, 'with learn revisions 1 (SALT_A) and 2 (SALT_B) stored before the salt annotation');
      // R4: the SDK configured with `visitorIdKey` keeps the identifier under the site's key and records each answer's experiment.
      const siteKeyed = await shopperOn(m);
      const drawnPersonalized = browser(), drawnDefault = browser(), withVisitorId = browser({ opt_visitor_id: 'vis-00000100-0000-4000-8000-000000000006' });
      const withExperiment = browser({ [SITE_VISITOR_KEY]: siteKeyed.subject });
      const story: Record<'drawnPersonalized' | 'drawnDefault' | 'withVisitorId' | 'withExperiment', Landed[]> = { drawnPersonalized: [], drawnDefault: [], withVisitorId: [], withExperiment: [] };
      const errors: string[] = [];
      const step = async (key: keyof typeof story, b: Browser, landing: string, table: unknown, random: number) => {
        const l = await land(b, landing, table, random);
        if (l.error) errors.push(`${key} ${landing}: ${l.error}`);
        story[key].push(seen(l));
      };
      const DRAWN = 'drawn while the table read null', NEXT = 'the next landing, the table naming 2', AGAIN = 'again on the table naming 2',
        ROTATION = 'the rotation, the table naming 3', AFTER = 'the landing after';

      await step('drawnPersonalized', drawnPersonalized, DRAWN, t0, DRAWS_PERSONALIZED);
      await step('drawnDefault', drawnDefault, DRAWN, t0, DRAWS_DEFAULT);
      await step('withVisitorId', withVisitorId, DRAWN, t0, DRAWS_PERSONALIZED);
      await step('withExperiment', withExperiment, DRAWN, t0, DRAWS_PERSONALIZED);
      recordAnswer(withExperiment, await answeredExperiment(m, siteKeyed, idOf(SALT_B), null));
      await publishLearn(m, SALT_B, 3);
      const t1 = await tableOn(m, 2, 'after learn revision 3 (an unrelated edit on SALT_B), counted over the whole stored history');
      // Each landing that must not draw is given the random source that would draw the OTHER class (R2, R2').
      for (const landing of [NEXT, AGAIN]) {
        await step('drawnPersonalized', drawnPersonalized, landing, t1, DRAWS_DEFAULT);
        await step('drawnDefault', drawnDefault, landing, t1, DRAWS_PERSONALIZED);
        await step('withVisitorId', withVisitorId, landing, t1, DRAWS_DEFAULT);
        await step('withExperiment', withExperiment, landing, t1, DRAWS_DEFAULT);
        recordAnswer(withExperiment, await answeredExperiment(m, siteKeyed, idOf(SALT_B), 2));
      }
      await publishLearn(m, SALT_C, 4);
      const t2 = await tableOn(m, 3, 'after the salt rotates to SALT_C at learn revision 4');
      await step('drawnPersonalized', drawnPersonalized, ROTATION, t2, DRAWS_PERSONALIZED);
      await step('drawnDefault', drawnDefault, ROTATION, t2, DRAWS_PERSONALIZED);
      await step('withVisitorId', withVisitorId, ROTATION, t2, DRAWS_PERSONALIZED);
      await step('withExperiment', withExperiment, ROTATION, t2, DRAWS_PERSONALIZED);
      recordAnswer(withExperiment, await answeredExperiment(m, siteKeyed, idOf(SALT_C), 3));
      await step('drawnPersonalized', drawnPersonalized, AFTER, t2, DRAWS_DEFAULT);
      await step('drawnDefault', drawnDefault, AFTER, t2, DRAWS_DEFAULT);
      await step('withVisitorId', withVisitorId, AFTER, t2, DRAWS_DEFAULT);
      await step('withExperiment', withExperiment, AFTER, t2, DRAWS_DEFAULT);

      expect(errors, `PRECONDITION (${host}): the built head script runs (public/sdk/edge-head.js)`).toEqual([]);
      const personalizedStory = [
        at(DRAWN, ROW_CONTEXT, 'personalized', 'row', { class: 'personalized', saltVersion: null }),
        at(NEXT, ROW_CONTEXT, 'personalized', 'row', { class: 'personalized', saltVersion: 2 }),
        at(AGAIN, ROW_CONTEXT, 'personalized', 'row', { class: 'personalized', saltVersion: 2 }),
        at(ROTATION, 'default', 'personalized', 'server', { class: 'personalized', saltVersion: 3 }),
        at(AFTER, ROW_CONTEXT, 'personalized', 'row', { class: 'personalized', saltVersion: 3 }),
      ];
      const today = '(today the held null stays null — src/sdk/head.ts :146 `moved` is false whenever a side is null, and :147-150 write the version only on a fresh draw — so the rotation is missed)';
      expect.soft(story.drawnPersonalized, `${host}: HN1 — a browser drawn personalized while the table read null keeps its class and its row and stores 2 on the table naming 2, twice without a repaint or a draw (its random source would draw default there), paints the default row once at the rotation to 3 and draws again, then paints its row ${today}`)
        .toEqual(personalizedStory);
      expect.soft(story.drawnDefault, `${host}: HN1 — a browser drawn default while the table read null keeps the default class and stores 2 on the table naming 2, twice without a draw (its random source would draw personalized there), paints the default row once at the rotation to 3 and draws its class again (personalized), then paints that class's row ${today}`)
        .toEqual([
          at(DRAWN, 'default', 'default', 'server', { class: 'default', saltVersion: null }),
          at(NEXT, 'default', 'default', 'server', { class: 'default', saltVersion: 2 }),
          at(AGAIN, 'default', 'default', 'server', { class: 'default', saltVersion: 2 }),
          at(ROTATION, 'default', 'personalized', 'server', { class: 'personalized', saltVersion: 3 }),
          at(AFTER, ROW_CONTEXT, 'personalized', 'row', { class: 'personalized', saltVersion: 3 }),
        ]);
      expect.soft(story.withVisitorId, `${host}: HN1 (R4) — a browser carrying the SDK's visitor id with no recorded experiment takes the head-script-only branch and behaves exactly so ${today}`)
        .toEqual(personalizedStory);
      expect.soft(story.withExperiment, `${host}: HN1 (R4, R-P560 (2)) — a browser whose SDK records each answer's experiment but keeps its visitor id under the site's own key (\`visitorIdKey\`) takes the head-script-only branch and behaves exactly so ${today}`)
        .toEqual(personalizedStory);
    }, LONG_MS);

    it(`host (${host}): LOCK — as today: a browser holding a number keeps it on a table naming null (an older table a cache still serves) and repaints once at the rotation; a browser holding null on a table naming null keeps its class, its row and its null; the known-visitor branch reads the experiment the SDK records from each of the host's answers (its class by armFor, the default row once where the recorded salt version and the table's differ) and writes neither a draw nor its experiment`, async () => {
      const m = await nullTenant(host);
      const t0 = await tableOn(m, null, 'with learn revisions 1 (SALT_A) and 2 (SALT_B) stored before the salt annotation');
      const shopper = await personalizedShopper(m);
      const answer0 = await answeredExperiment(m, shopper, idOf(SALT_B), null);
      const holdsNumber = browser(), holdsNull = browser();
      const known = browser({ opt_visitor_id: shopper.subject });
      recordAnswer(known, answer0);
      const lock = { holdsNumber: [] as Landed[], holdsNull: [] as Landed[], known: [] as Array<ReturnType<typeof seenKnown>> };
      const errors: string[] = [];
      const step = async (b: Browser, landing: string, table: unknown, random: number) => {
        const l = await land(b, landing, table, random);
        if (l.error) errors.push(`${landing}: ${l.error}`);
        return l;
      };

      lock.holdsNull.push(seen(await step(holdsNull, 'drawn while the table read null', t0, DRAWS_PERSONALIZED)));
      lock.holdsNull.push(seen(await step(holdsNull, 'again on a table naming null', t0, DRAWS_DEFAULT)));
      await publishLearn(m, SALT_B, 3);
      const t1 = await tableOn(m, 2, 'after learn revision 3 (an unrelated edit on SALT_B), counted over the whole stored history');
      lock.holdsNumber.push(seen(await step(holdsNumber, 'drawn on the table naming 2', t1, DRAWS_PERSONALIZED)));
      lock.holdsNumber.push(seen(await step(holdsNumber, 'on an older table a cache still serves, naming null', t0, DRAWS_DEFAULT)));
      lock.known.push(seenKnown(await step(known, 'holding the answer\'s null, the table naming 2', t1, DRAWS_DEFAULT)));
      recordAnswer(known, await answeredExperiment(m, shopper, idOf(SALT_B), 2));
      await publishLearn(m, SALT_C, 4);
      const t2 = await tableOn(m, 3, 'after the salt rotates to SALT_C at learn revision 4');
      lock.holdsNumber.push(seen(await step(holdsNumber, 'the rotation, the table naming 3', t2, DRAWS_DEFAULT)));
      lock.holdsNumber.push(seen(await step(holdsNumber, 'the landing after', t2, DRAWS_PERSONALIZED)));
      lock.known.push(seenKnown(await step(known, 'holding the answer\'s 2, the table naming 3', t2, DRAWS_DEFAULT)));
      const answer2 = await answeredExperiment(m, shopper, idOf(SALT_C), 3);
      recordAnswer(known, answer2);
      lock.known.push(seenKnown(await step(known, 'holding the answer\'s 3, the table naming 3', t2, DRAWS_DEFAULT)));

      expect(errors, `PRECONDITION (${host}): the built head script runs (public/sdk/edge-head.js)`).toEqual([]);
      expect.soft(lock.holdsNumber, `${host}: HN1 LOCK (R5) — a browser holding 2 keeps it on a table naming null, then paints the default row once at the rotation to 3, draws again (default here) and paints that class's row`)
        .toEqual([
          at('drawn on the table naming 2', ROW_CONTEXT, 'personalized', 'row', { class: 'personalized', saltVersion: 2 }),
          at('on an older table a cache still serves, naming null', ROW_CONTEXT, 'personalized', 'row', { class: 'personalized', saltVersion: 2 }),
          at('the rotation, the table naming 3', 'default', 'default', 'server', { class: 'default', saltVersion: 3 }),
          at('the landing after', 'default', 'default', 'server', { class: 'default', saltVersion: 3 }),
        ]);
      expect.soft(lock.holdsNull, `${host}: HN1 LOCK — a browser holding null on a table naming null keeps its class, its row and its null`)
        .toEqual([
          at('drawn while the table read null', ROW_CONTEXT, 'personalized', 'row', { class: 'personalized', saltVersion: null }),
          at('again on a table naming null', ROW_CONTEXT, 'personalized', 'row', { class: 'personalized', saltVersion: null }),
        ]);
      expect.soft(lock.known, `${host}: HN1 LOCK (R6) — the known visitor's class is armFor(its identifier, the salt its recorded experiment names); it paints the default row once where that experiment's salt version and the table's are two different numbers, and the head script changes neither its recorded experiment nor keeps a draw`)
        .toEqual([
          { landing: 'holding the answer\'s null, the table naming 2', context: ROW_CONTEXT, arm: 'personalized', order: 'row', held: { experiment: { id: idOf(SALT_B), saltVersion: null }, arm: 'no draw kept' } },
          { landing: 'holding the answer\'s 2, the table naming 3', context: 'default', arm: 'personalized', order: 'server', held: { experiment: { id: idOf(SALT_B), saltVersion: 2 }, arm: 'no draw kept' } },
          { landing: 'holding the answer\'s 3, the table naming 3', context: ROW_CONTEXT, arm: 'personalized', order: 'row', held: { experiment: { id: idOf(SALT_C), saltVersion: 3 }, arm: 'no draw kept' } },
        ]);
    }, LONG_MS);
  }
});

// ===========================================================================
// unit:P100.HN2 — the head script regenerated in its three places, within its budget; the SDK bundles unchanged
// ===========================================================================

describe('unit:P100.HN2', () => {
  it('logic: each of the head script\'s three places (public/sdk, public/sdk/0.2.0, packages/sdk) carries the regenerated script — run in jsdom, each copy keeps a class drawn under a null salt version and stores the table\'s 3 without a repaint or a draw on two landings, then paints the default row once at 4 and draws its class again — beside an `edge-head.js.csp` holding its own digest; `node scripts/build-sdk.mjs --check` exits 0 and names the head script and its .csp', async () => {
    const holding = { opt_head: JSON.stringify({ arm: { class: 'personalized', saltVersion: null, tableVersion: handTable(null).version } }) };
    const landings: Array<[string, number, number]> = [['first landing, the table naming 3', 3, DRAWS_DEFAULT], ['second landing, the table naming 3', 3, DRAWS_DEFAULT],
      ['the rotation, the table naming 4', 4, DRAWS_DEFAULT], ['the landing after, the table naming 4', 4, DRAWS_PERSONALIZED]];
    const runs: Array<[string, ...Landed[]]> = [];
    for (const copy of HEAD_COPIES) {
      const b = browser(holding), seenHere: Landed[] = [];
      for (const [landing, saltVersion, random] of landings) seenHere.push(seen(await land(b, landing, handTable(saltVersion), random, copy)));
      runs.push([copy, ...seenHere]);
    }
    expect.soft(runs, 'HN2 — every place the head script is kept runs the regenerated script: a held null takes the table\'s number (3) without a repaint or a draw, twice (each landing\'s random source would draw default), and the next rotation (4) repaints once and draws the class again (default here), whose row follows (today no copy adopts the number: each keeps null and paints its row at 4)')
      .toEqual(HEAD_COPIES.map(copy => [copy,
        at(landings[0]![0], ROW_CONTEXT, 'personalized', 'row', { class: 'personalized', saltVersion: 3 }),
        at(landings[1]![0], ROW_CONTEXT, 'personalized', 'row', { class: 'personalized', saltVersion: 3 }),
        at(landings[2]![0], 'default', 'default', 'server', { class: 'default', saltVersion: 4 }),
        at(landings[3]![0], 'default', 'default', 'server', { class: 'default', saltVersion: 4 })]));
    const first = bytesOf(HEAD_COPIES[0]);
    expect.soft(HEAD_COPIES.map(copy => [copy, bytesOf(copy).equals(first), readFileSync(join(ROOT, `${copy}.csp`), 'utf8') === `sha256-${createHash('sha256').update(bytesOf(copy)).digest('base64')}`]),
      'HN2 — the three copies are one build\'s bytes, each with the content-security-policy source of exactly those bytes beside it')
      .toEqual(HEAD_COPIES.map(copy => [copy, true, true]));
    const check = spawnSync(process.execPath, ['scripts/build-sdk.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
    expect.soft([check.status, /public\/sdk\/edge-head\.js: exact nonwriting match/.test(check.stdout), /public\/sdk\/edge-head\.js\.csp: exact nonwriting match/.test(check.stdout)],
      `HN2 — node scripts/build-sdk.mjs --check exits 0 over the head script and its .csp (${check.stderr.slice(0, 300)})`).toEqual([0, true, true]);
  }, LONG_MS);

  it('logic: LOCK — the head script is at most its recorded budget of 30,720 bytes and less than 5 KB under it (above 25,600) in each place, the budget unchanged; the two SDK bundles are byte-equal to 340cd410\'s in each of their three places, since neither bundle reads src/sdk/head.ts', async () => {
    const manifest = JSON.parse(readTree('packages/sdk/package.json')) as { sizeBudget?: Record<string, unknown> };
    expect.soft({ budget: manifest.sizeBudget?.['./edge-head.js'], sizes: HEAD_COPIES.map(copy => { const n = bytesOf(copy).length; return [copy, n <= HEAD_BUDGET && HEAD_BUDGET - n < FIVE_KB ? 'within' : n]; }) },
      `HN2 — the budget stays ${HEAD_BUDGET} bytes (packages/sdk/package.json :36) and each copy within it, less than ${FIVE_KB} bytes under it (W40.P3)`)
      .toEqual({ budget: HEAD_BUDGET, sizes: HEAD_COPIES.map(copy => [copy, 'within']) });
    const digests = Object.keys(SDK_BUNDLES_AT_340CD410).map(path => [path, createHash('sha256').update(bytesOf(path)).digest('hex')]);
    expect.soft(digests, 'HN2 — the two SDK bundles are byte-equal to 340cd410\'s in each of their three places').toEqual(Object.entries(SDK_BUNDLES_AT_340CD410));
    const build = await import(/* @vite-ignore */ new URL('../../../scripts/build-sdk.mjs', import.meta.url).href) as {
      SDK_TARGETS: Array<{ entry: string }>; buildSDK: (o: { root: string }) => Promise<Array<{ metafile: { outputs: Record<string, { inputs: Record<string, unknown> }> } }>> };
    const results = await build.buildSDK({ root: ROOT });
    const readers = build.SDK_TARGETS.map((target, i) => [target.entry, Object.values(results[i]!.metafile.outputs).some(o => Object.keys(o.inputs).includes('src/sdk/head.ts'))]);
    expect.soft(readers, 'HN2 — only the head script\'s own entry bundles src/sdk/head.ts').toEqual([['src/sdk/index.ts', false], ['src/sdk/browser.ts', false], ['src/sdk/head.ts', true]]);
  }, LONG_MS);
});

// ===========================================================================
// unit:P100.HN3 — the kits
// ===========================================================================

describe('unit:P100.HN3', () => {
  it('logic: kit 01\'s head-script paragraph, kit 02\'s context-table paragraph (holdout.saltVersion, :696) and kit 02\'s salt-version paragraph (:1490-1498) each state that a browser holding an unknown salt version takes the table\'s number without repainting and paints the default row once at the next change of salt', () => {
    const kit01 = readTree('docs/kit/01-integration-guide.md'), kit02 = readTree('docs/kit/02-api-reference.md');
    const places = { kit01Head: paragraphOf(kit01, KIT01_HEAD), kit02Table: paragraphOf(kit02, KIT02_TABLE), kit02Salt: paragraphOf(kit02, KIT02_SALT) };
    expect(Object.entries(places).filter(([, text]) => !text).map(([name]) => name), 'PRECONDITION: the three paragraphs are found').toEqual([]);
    expect(Object.fromEntries(Object.entries(places).map(([name, text]) => [name, text.includes(KIT_NULL_TAKEN)])),
      `HN3 (R8) — each paragraph states: "${KIT_NULL_TAKEN}" (today none does)`).toEqual({ kit01Head: true, kit02Table: true, kit02Salt: true });
  });

  it('logic: LOCK — kit 01\'s sentence that P95 pins (KIT01_ROTATED) still reads as it does, in the head-script paragraph', () => {
    expect(paragraphOf(readTree('docs/kit/01-integration-guide.md'), KIT01_HEAD).includes(KIT01_ROTATED), `HN3 — kit 01 keeps: "${KIT01_ROTATED}"`).toBe(true);
  });
});
