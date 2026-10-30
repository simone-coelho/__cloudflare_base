// src/sdk/head.ts
// P84 (E8; the rendering record's N3 and N4): the head script. The server
// render inlines it in the page's head, after two inert blocks it writes there
// and before the stylesheets: `<script type="application/json"
// id="op-context-table">` (the page's context table, GET
// /v1/{tenant}/context-table/{page}) and `<script type="application/json"
// id="op-images">` (the carousel's images in the server's order, each
// `{ id, tags, src, srcset?, sizes? }`). Before the first frame it derives the
// arrival's cell with the engine's own classifier (src/services/visit.ts, built
// into this bundle byte for byte), knows the arm (D2, mechanism (a): a browser
// the engine knows computes it with the engine's function, a brand-new one
// draws it with the published holdout share and the engine mints its
// identifier into that class), applies the row the table publishes for the
// cell on the device, within the brand rules exactly as the engine applies
// them, and writes:
//   · on the root: `data-op-context` (`<channel>|<visitBucket>|<device>` of the
//     row applied, or `default`), `data-op-arm` (`default` | `personalized`),
//     `data-op-table` (the table version read), and one custom property
//     `--op-<carouselSlot>-<n>` per image, n its server position (from 1), the
//     value its painted position, for the stylesheet's `order`;
//   · one `<link rel="preload" as="image" fetchpriority="high">` for the image
//     that leads, before the first stylesheet.
// It hides nothing, fetches nothing, sends nothing and writes no cookie. Its
// state is first-party storage under `opt_head`: the visit as `liveVisit`
// leaves it (kept only under recorded tracking consent, dropped on a refusal),
// a brand-new browser's draw, and the experiment and the consent the SDK keeps
// from each answer (src/sdk/listen.ts). The default row (the server order
// within the brand rules) is painted for the holdout class, without recorded
// personalization consent, under the SDK's refusal cookies, for an arrival or
// a device it cannot classify, for a table naming another classifier version
// and, for one paint, when the published salt version has moved. A class drawn
// while the table named no salt version takes the table's number when it names
// one, without a repaint (P100).
// P89 (E14): the shopper's own shot order the SDK keeps under `opt_head`
// (`shots`, from the engine's answers and pushes) leads the carousel's order,
// ahead of the row's values, under the row's own gate and only for the visitor
// this browser carries, for 30 days from its decision; a refusal drops it.
import { armClassOf, armFor, defaultArmProbability } from './armDraw';
import { DEFAULT_VISITOR_KEY, entrySignals, HEAD_STATE_KEY } from './identity';
import { deviceOf, type DeviceClass } from '../services/platform';
import { CLASSIFIER_VERSION, liveVisit, visitBucket, visitBucketUnder, type ChannelRule, type PublishedVocabulary, type VisitContext } from '../services/visit';

type Class = 'default' | 'personalized';
interface TagRule { dimension: string; value: string }
interface ContextTable {
  version: string;
  carouselSlot: string | null;
  classifierVersion: string;
  holdout: { share: number; arms: Array<'default' | 'no_learning'>; saltVersion: number | null };
  rows: Array<{ channel: string; visitBucket: string; shotOrder: Record<DeviceClass, string[] | null> }>;
  brandRules?: { minimum?: TagRule & { count: number; within: number }; pinnedTag?: TagRule & { window: { from: string; to: string } } };
  channelVocabulary?: { revision: number; channels: string[]; rules: ChannelRule[]; visitBuckets: number[] };
}
interface HeadImage { id: string; tags?: Record<string, string[]>; src?: string; srcset?: string; sizes?: string }
interface HeadState {
  visit?: VisitContext & { lastSeen: number };
  arm?: { class: Class; saltVersion: number | null; tableVersion: string };
  experiment?: { id: string; saltVersion: number | null };
  consent?: { tracking: boolean; personalization: boolean };
  shots?: { subject?: unknown; order?: unknown; ts?: unknown };
}
/** P89: how long a kept shot order is applied after its decision: the choice's own lifetime. */
const SHOTS_MS = 30 * 86_400_000;

/**
 * The parts of a page the head script touches, typed here rather than taken
 * from the DOM library, so the file compiles with the engine as well (the app's
 * tsconfig has no DOM) and every page read goes through one object.
 */
interface PageElement {
  textContent: string | null;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  style: { setProperty(name: string, value: string): void };
}
interface Page {
  document: {
    documentElement: PageElement; cookie: string; referrer: string;
    head: { insertBefore(node: PageElement, before: unknown): unknown; querySelector(selector: string): unknown };
    getElementById(id: string): PageElement | null;
    createElement(tag: string): PageElement;
  };
  location: { href: string; host: string; hostname: string; protocol: string; search: string };
  localStorage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  navigator: { userAgent: string; userAgentData?: { mobile?: boolean } };
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isClass = (v: unknown): v is Class => v === 'default' || v === 'personalized';

/** The two inert blocks the server render writes; anything unreadable is none. */
function readBlock(page: Page, id: string): unknown {
  try { const el = page.document.getElementById(id); return el ? JSON.parse(el.textContent || 'null') as unknown : null; } catch { return null; }
}
function tableOf(v: unknown): ContextTable | null {
  if (!record(v) || typeof v.version !== 'string' || typeof v.classifierVersion !== 'string' || !Array.isArray(v.rows)
    || !record(v.holdout) || typeof v.holdout.share !== 'number' || !Array.isArray(v.holdout.arms)
    || (v.carouselSlot !== null && typeof v.carouselSlot !== 'string')) return null;
  return v as unknown as ContextTable;
}
function stateOf(raw: string | null): HeadState {
  try { const v: unknown = JSON.parse(raw || '{}'); return record(v) ? v as HeadState : {}; } catch { return {}; }
}
/**
 * A refusal the SDK holds for `choice` (`tracking` or `personalization`): the page's own refusal cookie
 * (`opt_tracking_consent=false`, `opt_personalization_enabled=false`), or the SDK's refusal mirror for any endpoint and
 * tenant (`opt_shopper_refusal%3A…_<choice>`, present while the refusal is in force).
 */
function cookieRefuses(page: Page, choice: 'tracking' | 'personalization'): boolean {
  const own = choice === 'tracking' ? 'opt_tracking_consent' : 'opt_personalization_enabled';
  return page.document.cookie.split(';').some((pair) => {
    const at = pair.indexOf('='), name = pair.slice(0, at).trim(), value = pair.slice(at + 1).trim();
    return at > 0 && (name === own ? value === 'false' : name.startsWith('opt_shopper_refusal') && name.endsWith(`_${choice}`) && value !== '');
  });
}

function main(page: Page): void {
  const table = tableOf(readBlock(page, 'op-context-table')), images = readBlock(page, 'op-images');
  if (!table) return;
  const root = page.document.documentElement, now = Date.now();
  let state: HeadState = {};
  try { state = stateOf(page.localStorage.getItem(HEAD_STATE_KEY)); } catch { state = {}; }

  // Consent, as the engine reads it: the SDK's record of the engine's last
  // answer where it has kept one, else the server render's hint on the root;
  // a refusal cookie overrides both. Personalization takes tracking.
  const hint = (root.getAttribute('data-op-consent') || '').split(/\s+/);
  const kept = record(state.consent) ? state.consent : null;
  const refusesTracking = cookieRefuses(page, 'tracking') || (kept !== null && kept.tracking !== true);
  const tracking = !refusesTracking && (kept !== null || hint.includes('tracking') || hint.includes('personalization'));
  const personalization = tracking && (kept ? kept.personalization === true : hint.includes('personalization')) && !cookieRefuses(page, 'personalization');

  // The cell: the engine's classifier over the stored visit and this page's arrival. The visit is kept only under
  // tracking consent and dropped once tracking is refused; with neither, it is left as it is and not read.
  const cell = tracking ? cellOf(page, table, state, now) : null;
  if (refusesTracking) delete state.visit;
  const nav = page.navigator;
  const device = deviceOf({ get: (name: string) => name === 'User-Agent' ? nav.userAgent
    : name === 'Sec-CH-UA-Mobile' && nav.userAgentData ? (nav.userAgentData.mobile ? '?1' : '?0') : null });

  // The arm: a browser the engine knows (its identifier and the last answer's experiment) by the engine's own function
  // and the salt the experiment names (`<tenant>:<brand>:<salt>`); else the class this browser drew; else a fresh draw.
  const holdout = table.holdout, arms = holdout.arms.length ? holdout.arms : (['default'] as const);
  let cls: Class, rotated = false, visitor: string | null = null;
  try { visitor = page.localStorage.getItem(DEFAULT_VISITOR_KEY); } catch { visitor = null; }
  const experiment = record(state.experiment) && typeof state.experiment.id === 'string' ? state.experiment : null;
  // A salt version only moves when both sides name one: an unknown version (null) is never a rotation.
  const moved = (version: number | null | undefined) => typeof version === 'number' && typeof holdout.saltVersion === 'number' && version !== holdout.saltVersion;
  const draw = (): Class => {
    const drawn: Class = crypto.getRandomValues(new Uint32Array(1))[0]! / 4294967296 < defaultArmProbability({ share: holdout.share, arms }) ? 'default' : 'personalized';
    state.arm = { class: drawn, saltVersion: holdout.saltVersion, tableVersion: table.version };
    return drawn;
  };
  if (visitor && experiment) {
    cls = armClassOf(armFor(visitor, { share: holdout.share, salt: experiment.id.split(':').slice(2).join(':'), arms }));
    rotated = moved(experiment.saltVersion);
  } else if (record(state.arm) && isClass(state.arm.class)) {
    // A moved salt version: this paint is the default row, and the class is drawn again for the next one.
    rotated = moved(state.arm.saltVersion);
    // P100 (E24): a class drawn while the table named no salt version (null) takes the table's number once it names one,
    // without a repaint or a draw, so the next change of salt is a rotation; a held number is never overwritten here.
    if (typeof state.arm.saltVersion !== 'number' && typeof holdout.saltVersion === 'number') state.arm.saltVersion = holdout.saltVersion;
    cls = rotated ? draw() : state.arm.class;
  } else cls = draw();

  const row = personalization && cls === 'personalized' && !rotated && table.classifierVersion === CLASSIFIER_VERSION && cell?.channel && device
    ? table.rows.find((r) => record(r) && r.channel === cell.channel && r.visitBucket === cell.bucket) : undefined;
  root.setAttribute('data-op-context', row && cell ? `${cell.channel}|${cell.bucket}|${device}` : 'default');
  root.setAttribute('data-op-arm', cls);
  root.setAttribute('data-op-table', table.version);
  // P89: the shopper's own order, kept for this browser's visitor and decided within 30 days, under the row's own gate
  // (with or without a row): its values lead, then the row's other values; a refusal drops it.
  const shots = state.shots, own = personalization && cls === 'personalized' && !rotated && record(shots) && visitor && shots.subject === visitor
    && typeof shots.ts === 'number' && now - shots.ts <= SHOTS_MS && Array.isArray(shots.order) ? shots.order.filter((v): v is string => typeof v === 'string') : [];
  if (refusesTracking || cookieRefuses(page, 'personalization') || (kept && kept.personalization !== true)) delete state.shots;
  try { page.localStorage.setItem(HEAD_STATE_KEY, JSON.stringify(state)); } catch { /* storage unavailable: nothing is kept */ }
  const rowShots = row && device ? row.shotOrder[device] : null;
  if (typeof table.carouselSlot === 'string' && Array.isArray(images)) {
    paint(page, table, table.carouselSlot, images as HeadImage[], own.length ? [...own, ...(rowShots ?? []).filter((v) => !own.includes(v))] : rowShots, now);
  }
}

/** The arrival's cell (its channel, null where no rule names it, and its visit bucket); keeps the visit as `liveVisit` leaves it. */
function cellOf(page: Page, table: ContextTable, state: HeadState, now: number): { channel: string | null; bucket: string } {
  const cv = table.channelVocabulary;
  const vocabulary: PublishedVocabulary | null = cv ? { revision: cv.revision,
    vocabulary: { channels: cv.channels.map((id) => ({ id, name: id })), rules: cv.rules, sourcePlatforms: [], landingPageTypes: [], visitBuckets: cv.visitBuckets } } : null;
  const prior = record(state.visit) ? state.visit : null;
  const visit = liveVisit(prior, prior ? prior.lastSeen : null, now, entrySignals({ location: page.location, referrer: page.document.referrer }), vocabulary ? { vocabulary } : undefined);
  state.visit = { ...visit, lastSeen: now };
  return { channel: visit.entryChannel ?? null, bucket: cv ? visitBucketUnder(visit.visitCount, cv.visitBuckets) : visitBucket(visit.visitCount) };
}

/**
 * The carousel's order: the row's shot order (an image's rank, the first position any of its `contentType` values
 * holds in it; none listed: after every listed one), images of one rank in server order — the engine's tie-break of
 * a cold shopper's equal scores (src/reflex/contentCompose.ts) — then P83's brand rules as the engine applies them:
 * the tag pin, inside its window (`from` inclusive, `to` exclusive), leads with the best-ordered image carrying the
 * tag; then the minimum brings the best-ordered images carrying its tag into the first `within` positions, the
 * lowest-ordered images there without it leaving, the pinned lead never moving.
 */
function paint(page: Page, table: ContextTable, slot: string, images: HeadImage[], shots: string[] | null, now: number): void {
  const root = page.document.documentElement;
  // An image's values of a dimension: anything but a list is none.
  const valuesOf = (n: number, dimension: string): unknown[] => { const v: unknown = images[n]?.tags?.[dimension]; return Array.isArray(v) ? v : []; };
  const tagged = (n: number, rule: TagRule) => valuesOf(n, rule.dimension).includes(rule.value);
  const rank = (n: number): number => {
    if (!shots) return 0;
    let best = shots.length;
    for (const value of valuesOf(n, 'contentType')) { const at = typeof value === 'string' ? shots.indexOf(value) : -1; if (at >= 0 && at < best) best = at; }
    return best;
  };
  let order = images.map((_, n) => n).sort((a, b) => rank(a) - rank(b) || a - b);
  const rules = table.brandRules ?? {}, fixed = new Set<number>();
  const pin = rules.pinnedTag;
  if (pin && Date.parse(pin.window.from) <= now && now < Date.parse(pin.window.to)) {
    const lead = order.find((n) => tagged(n, pin));
    if (lead !== undefined) { order = [lead, ...order.filter((n) => n !== lead)]; fixed.add(lead); }
  }
  const minimum = rules.minimum;
  if (minimum) {
    const within = Math.min(minimum.within, order.length);
    const need = minimum.count - order.slice(0, within).filter((n) => tagged(n, minimum)).length;
    const ranked = order.filter((n) => !fixed.has(n)), kept = order.slice(0, within).filter((n) => !fixed.has(n)).length;
    const head = ranked.slice(0, kept), tail = ranked.slice(kept);
    const pool = tail.filter((n) => tagged(n, minimum)), leaving = head.filter((n) => !tagged(n, minimum));
    const k = need > 0 ? Math.min(need, pool.length, leaving.length) : 0;
    if (k > 0) {
      const incoming = pool.slice(0, k), displaced = new Set(leaving.slice(-k));
      const next = [...head.filter((n) => !displaced.has(n)), ...incoming, ...head.filter((n) => displaced.has(n)), ...tail.filter((n) => !incoming.includes(n))];
      let j = 0;
      order = order.map((n) => (fixed.has(n) ? n : next[j++]!));
    }
  }
  order.forEach((n, at) => root.style.setProperty(`--op-${slot}-${n + 1}`, String(at + 1)));
  const lead = order.length ? images[order[0]!] : undefined;
  if (!lead || typeof lead.src !== 'string') return;
  const link = page.document.createElement('link');
  link.setAttribute('rel', 'preload'); link.setAttribute('as', 'image'); link.setAttribute('href', lead.src);
  if (typeof lead.srcset === 'string') link.setAttribute('imagesrcset', lead.srcset);
  if (typeof lead.sizes === 'string') link.setAttribute('imagesizes', lead.sizes);
  link.setAttribute('fetchpriority', 'high');
  page.document.head.insertBefore(link, page.document.head.querySelector('link[rel="stylesheet"]'));
}

// Only in a page: the engine imports nothing from this file, and a failure leaves the page its server order.
const page = globalThis as unknown as Partial<Page>;
if (page.document && page.location) {
  try { main(page as Page); } catch { /* the page keeps its server order */ }
}
