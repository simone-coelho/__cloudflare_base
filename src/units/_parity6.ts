// src/units/_parity6.ts
// The sixth shared harness of the parity unit files: what the S7 tickets of the
// fourth parity programme (amendment 3), P45 to P49,
// need beyond src/units/_parity.ts and src/units/_parity3.ts, which are pinned by
// receipted tickets and never edited here.
//
// It holds no expected value of any ticket. It adds two things:
//   · THE SHIPPED CONSOLE, as src/units/_parity.ts `openConsole` runs it (jsdom,
//     the console's own files evaluated in order, bound to the mounted app), with
//     one difference: `public/console/views.js` may be evaluated either as it is
//     in this tree ('head') or as it stood at the base the S7 work orders cite
//     (`BASE`, c7543471, read with `git show` from the repository this tree
//     belongs to). A screen rendered by both from the same answers is how a unit
//     measures "renders byte for byte as today" and "makes no request it does not
//     make today": the view's HTML and the request list, compared. Every other
//     console file is this tree's.
//   · THE POOLED WORLD of P08 and P42, copied from the P42 unit file
//     (src/units/P42/LEDGER.unit.test.ts:114-191; a test file is never imported):
//     P08's catalogue, pages and learn document (P08's complete-the-look module
//     pooled on the product and home pages), P42's extension with a cart page and
//     a second pooled module, one shopper visit per page, the object's own
//     `/publish` door, the operator's publish and the two lift reads, and the P08
//     review's R7 injection (one placement's `/pooled` door answering 500).
// Documents are read from the tree this file lives in, never the working directory.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';
import { expect } from 'vitest';

import { statsName } from '@/learn/fan';
import { DEFAULT_STATS } from '@/learn/stats';

import { asOperator, BRAND, PAID_SOCIAL_ENTRY, pageInstanceOf, readTree, shopperOn, TENANT, VIEW_TABBY_26, type Answer, type Mounted } from './_parity';

/** The base every S7 work order cites ("at c7543471"): rem/integration after P44's receipt. */
export const BASE = 'c75434716ac5b4d8fe0444a96e788744230adee1';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
/** A file of this repository as it stood at `BASE`. */
export const baseTree = (relative: string): string => execFileSync('git', ['-C', ROOT, 'show', `${BASE}:${relative}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// ---------------------------------------------------------------------------
// The shipped console, with views.js as it is here ('head') or at BASE ('base').
// ---------------------------------------------------------------------------

const OPERATOR_ORIGIN = 'http://console.test';

interface ConsoleEl {
  value: string; disabled: boolean; textContent: string | null; innerHTML: string; dataset: Record<string, string | undefined>;
  click: () => void; focus: () => void; dispatchEvent: (e: unknown) => boolean;
  querySelectorAll: (sel: string) => ArrayLike<ConsoleEl>; querySelector: (sel: string) => ConsoleEl | null; closest: (sel: string) => ConsoleEl | null;
}
interface ConsoleWindow extends Record<string, unknown> {
  document: { body: ConsoleEl; getElementById: (id: string) => ConsoleEl | null; querySelectorAll: (sel: string) => ArrayLike<ConsoleEl> };
  eval: (s: string) => unknown; close: () => void; location: { hash: string };
  localStorage: { setItem: (key: string, value: string) => void };
  Event: new (type: string, options: object) => unknown;
  Console: { when: (ms: number) => string; fmt: (n: number) => string };
}
export interface ConsoleRequest { method: string; path: string; body: string | undefined }
export type ViewsSource = 'head' | 'base';

/**
 * The shipped console under jsdom, bound to the mounted app, opened at `hash`
 * (src/units/_parity.ts `openConsole`, line for line, but for the views.js source).
 */
export async function consoleAt(m: Mounted, hash: string, views: ViewsSource = 'head') {
  const dom = new JSDOM(readTree('public/console/index.html'), { url: `${OPERATOR_ORIGIN}/console/${hash}`, pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window as unknown as ConsoleWindow;
  const requests: ConsoleRequest[] = [];
  w.fetch = async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const target = new URL(url, `${OPERATOR_ORIGIN}/console/`);
    const method = (init?.method ?? 'GET').toUpperCase(), path = target.pathname + target.search;
    requests.push({ method, path, body: init?.body });
    return m.fetch(new Request(OPERATOR_ORIGIN + path, { method, headers: init?.headers ?? {}, ...(init?.body === undefined ? {} : { body: init.body }) }));
  };
  w.TextEncoder = TextEncoder;
  w.setInterval = () => 0;
  w.confirm = () => true;
  w.localStorage.setItem('operator-session', JSON.stringify({
    accessToken: m.operatorToken, refreshToken: 'parity-refresh', exp: Date.now() + 3_600_000,
    user: { id: 'ops', name: 'Test Operator', email: 'ops@brand.test', roles: ['admin'] }, mustChangePassword: false,
  }));
  w.eval(readTree('public/operator-session.js'));
  for (const file of ['shell.js', 'views.js', 'views-config.js', 'views-measure.js', 'views-accounts.js', 'views-explore.js']) {
    w.eval(file === 'views.js' && views === 'base' ? baseTree('public/console/views.js') : readTree(`public/console/${file}`));
  }
  const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setTimeout(r, 12)); await m.drain(); };
  /** Long enough for a screen's validator, which waits 350 ms after the last keystroke. */
  const settleChecked = async () => { await new Promise(r => setTimeout(r, 450)); await settle(); };
  await settle(); await settle();
  const all = (sel: string) => Array.from(w.document.querySelectorAll(sel));
  const $ = (id: string) => w.document.getElementById(id);
  /** The screen's own host (`#view`, public/console/shell.js render), as HTML: what "renders byte for byte" compares. */
  const view = () => $('view')?.innerHTML ?? 'no #view element';
  const text = () => (w.document.body.textContent || '').replace(/\s+/g, ' ');
  const control = (focusKey: string): ConsoleEl | null => all(`[data-focus-key="${focusKey}"]`)[0] ?? null;
  const type = async (focusKey: string, value: string): Promise<boolean> => {
    const el = control(focusKey);
    if (!el) return false;
    el.focus(); el.value = value; el.dispatchEvent(new w.Event('input', { bubbles: true }));
    await settleChecked();
    return true;
  };
  const save = async () => { await settleChecked(); $('save')?.click(); await settle(); await settle(); };
  /** A new hash, as an operator's link or the browser's back button sets it (shell.js listens for hashchange). */
  const go = async (next: string) => { w.location.hash = next; await settle(); await settle(); };
  /** The Slots screen's row of one slot, as text, or a sentence naming its absence. */
  const row = (slot: string): string => {
    const tr = all('#view tr').find(r => (r.querySelector('td button')?.textContent ?? '').trim() === slot);
    return tr ? (tr.textContent || '').replace(/\s+/g, ' ').trim() : `absent: the Slots screen has no row for ${slot}`;
  };
  /** The requests made so far, as `METHOD path` (bodies apart: they carry fresh idempotency material). */
  const calls = () => requests.map(r => `${r.method} ${r.path}`);
  return { w, requests, calls, all, $, view, text, control, type, save, go, row, settle, settleChecked, close: () => w.close() };
}
export type OpenConsole = Awaited<ReturnType<typeof consoleAt>>;

// ---------------------------------------------------------------------------
// The pooled world of P08 and P42 (src/units/P42/LEDGER.unit.test.ts:114-191, copied).
// ---------------------------------------------------------------------------

export const PDP_MODULES = 'pdp-modules', HOME_MODULES = 'home-modules', CART_MODULES = 'cart-modules';
export const POOLED = 'module.complete-the-look.1', POOLED2 = 'module.style-it.1', SHARED = 'module.reviews.1';
const PDP_ONLY = 'module.size-guide.1', HOME_ONLY = 'module.category-grid.1';
const module_ = (id: string, type: string, slotTypes: string[], over: Record<string, unknown> = {}) => ({ id,
  customerContentId: `TAP-${id.replace(/^module\./, '').replace(/\./g, '-').toUpperCase()}`, type, title: type, tags: { line: ['Tabby'] },
  slotTypes, journeyStageFit: ['considering'], lifecycle: { status: 'live' }, ...over });
/** P08's catalogue (src/units/P08/LEDGER.unit.test.ts:103-108). */
export const P08_PIECES = [
  module_(POOLED, 'complete-the-look', [PDP_MODULES, HOME_MODULES], { pooled: true }),
  module_(SHARED, 'reviews', [PDP_MODULES, HOME_MODULES]),
  module_(PDP_ONLY, 'size-guide', [PDP_MODULES]),
  module_(HOME_ONLY, 'category-grid', [HOME_MODULES]),
];
export const P08_SLOTS = { version: 'parity-p08-slots', governanceVersion: 3, pages: {
  pdp: [{ slot: PDP_MODULES, take: 3, weights: { line: 1 } }], home: [{ slot: HOME_MODULES, take: 3, weights: { line: 1 } }] } };
const STATS = { ...DEFAULT_STATS, nMin: 2 };
/** One slot's learn dials (rendered-v1, γ 1), with its reward. */
export const dials = (reward = 'click', over: Record<string, unknown> = {}) => ({ measurementBasis: 'rendered-v1', reward, gamma: 1, ...over });
/** A learn document over the given slots' dials (P42's `learnOf`). */
export const learnOf = (slots: Record<string, unknown>) => ({ version: 'parity-p42-learn', holdout: { share: 0, salt: 'parity', arms: ['default'] },
  regional: { enabled: false, kBlend: 1, minEvents: 30 }, stats: STATS, slots });
/** P08's learn document (rendered-v1). */
export const P08_LEARN = learnOf({ [PDP_MODULES]: dials(), [HOME_MODULES]: dials() });
/** P42's extension: P08's catalogue with a second pooled module on the product and cart pages, and the cart page. */
export const P42_PIECES = [...P08_PIECES.slice(0, 1), module_(POOLED2, 'style-it', [PDP_MODULES, CART_MODULES], { pooled: true }), ...P08_PIECES.slice(1)];
export const P42_SLOTS = { version: 'parity-p42-slots', governanceVersion: 3, pages: {
  pdp: [{ slot: PDP_MODULES, take: 4, weights: { line: 1 } }], home: [{ slot: HOME_MODULES, take: 3, weights: { line: 1 } }],
  cart: [{ slot: CART_MODULES, take: 2, weights: { line: 1 } }] } };
export const P42_LEARN = learnOf({ [PDP_MODULES]: dials(), [HOME_MODULES]: dials(), [CART_MODULES]: dials() });

/** One shopper visit to a page: a Tabby view, the page served and acknowledged in full, and a click on every pooled or shared module served. */
export async function visit(m: Mounted, page: 'pdp' | 'home' | 'cart') {
  const s = await shopperOn(m);
  expect((await s.action(VIEW_TABBY_26, PAID_SOCIAL_ENTRY)).status, `${m.host}: PRECONDITION — the shopper's view is accepted`).toBe(200);
  const served = await s.snapshot(page, { pageInstance: pageInstanceOf(`p6-${page}`) });
  expect(served.decisions.length, `${m.host}: PRECONDITION — the ${page} slot serves its modules (${JSON.stringify(served.body).slice(0, 200)})`).toBeGreaterThan(0);
  for (const d of served.decisions) expect((await s.ack(served, d)).status, `${m.host}: PRECONDITION — ${d.contentId} acknowledged`).toBe(200);
  for (const d of served.decisions.filter(x => [POOLED, POOLED2, SHARED].includes(x.contentId))) {
    expect((await s.click(served, d)).status, `${m.host}: PRECONDITION — the click on ${d.contentId} is accepted`).toBe(200);
  }
  await m.drainLedger();
  return s;
}

type Stub = { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> };
type Namespace = { get: (name: string) => Stub; idFromName: (name: string) => string };
const namespaceOf = (m: Mounted) => m.env.LEARN_STATS as unknown as Namespace;
/** The placement's own object, as the operator's route reaches it (`statsName`, one page per slot here). */
const objectOf = (m: Mounted, slot: string) => namespaceOf(m).get(namespaceOf(m).idFromName(statsName(TENANT, BRAND, slot)));
/** The object's `/publish` door, which the operator's publish reaches; it runs `LearnStats.publish()`, as the object's alarm does. */
export async function objectPublish(m: Mounted, slot: string): Promise<Answer> {
  const response = await objectOf(m, slot).fetch('https://learn/publish', { method: 'POST' });
  const answer = { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
  await m.drain();
  return answer;
}
/** `POST /v1/:tenant/learn/publish` as the operator. */
export const operatorPublish = (m: Mounted, slot: string) => asOperator(m, 'POST', `/v1/${TENANT}/learn/publish`, { slot });
/** `GET /v1/:tenant/lift` as the operator. */
export const liftOf = (m: Mounted, slot: string) => asOperator(m, 'GET', `/v1/${TENANT}/lift?slot=${slot}`);
/** `GET /v1/:tenant/lift/rows` as the operator. */
export const rowsOf = (m: Mounted, slot: string) => asOperator(m, 'GET', `/v1/${TENANT}/lift/rows?slot=${slot}`);

/**
 * The P08 review's R7 injection (P08/reviewer/scripts/probe-review.test.ts:269-273): the mounted app's
 * real LEARN_STATS namespace, its `get` wrapped so that one placement's object answers 500 on `/pooled`
 * and is otherwise itself. Returns the restore.
 */
export function failPooledDoor(m: Mounted, slot: string): () => void {
  const ns = namespaceOf(m), original = ns.get, faulty = statsName(TENANT, BRAND, slot);
  ns.get = (name: string) => {
    const stub = original(name);
    return name !== faulty ? stub : { fetch: async (input: RequestInfo | URL, init?: RequestInit) =>
      (String(input instanceof Request ? input.url : input).endsWith('/pooled') ? new Response('{"ok":false}', { status: 500 }) : stub.fetch(input, init)) };
  };
  return () => { ns.get = original; };
}

/** Today's members of the two lift reads and the two publish answers, in order (P42's header: src/routes/decisions.ts:766-767, :488, :1552; LearnStats.ts:450-452). */
export const LIFT_MEMBERS = ['ok', 'tenant', 'brand', 'slot', 'snapshot'];
export const ROWS_MEMBERS = ['ok', 'tenant', 'brand', 'slot', 'version', 'published', 'publishedAt', 'reward', 'objective', 'measurementBasis', 'n0', 'nMin', 'priorVersion',
  'level', 'item', 'q', 'sort', 'dir', 'total', 'offset', 'limit', 'rows', 'cursor'];
export const OBJECT_PUBLISH_MEMBERS = ['ok', 'published', 'snapshot'];
export const OPERATOR_PUBLISH_MEMBERS = ['ok', 'tenant', 'brand', 'slot', 'published', 'snapshot'];

export type Published = { version: number; publishedAt: number };
/** The snapshot in force a lift read answers: its version and publication time. */
export const identityOf = (answer: Answer): Published => {
  const snapshot = answer.body.snapshot as Published | null;
  expect(snapshot?.version, `PRECONDITION: the lift route answers a published snapshot (${JSON.stringify(answer.body).slice(0, 200)})`).toBeGreaterThan(0);
  return { version: snapshot!.version, publishedAt: snapshot!.publishedAt };
};
/** A member of an answer, or a sentence naming its absence and the members the answer has. */
export const memberOf = (answer: Answer, member: string) => (Object.hasOwn(answer.body, member) ? answer.body[member] : `no ${member} member (members: ${Object.keys(answer.body).join(', ')})`);
/** R-P3: the keys of an object and of each object member, each as written and sorted. */
export function keyOrders(value: unknown): Array<[string[], string[]]> {
  if (!value || typeof value !== 'object') return [];
  const out: Array<[string[], string[]]> = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== 'object') return;
    out.push([Object.keys(v), [...Object.keys(v)].sort()]);
    for (const child of Object.values(v)) walk(child);
  };
  walk(value);
  return out;
}
