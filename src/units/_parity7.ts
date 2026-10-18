// src/units/_parity7.ts
// The seventh shared harness of the parity unit files: what the S8 tickets of the
// fifth parity programme (amendment 4), P50 to P55, need beyond the harness files
// pinned by receipted tickets (src/units/_parity.ts, _parity3.ts, _parity6.ts and
// the rest), which are never edited here.
//
// It holds no expected value of any ticket. It adds two things:
//   · THE SHIPPED CONSOLE, as src/units/_parity6.ts `consoleAt` runs it (jsdom, the
//     console's own files evaluated in order, bound to the mounted app), line for line,
//     with one difference: `public/console/views.js` may be evaluated either as it is in
//     this tree ('head') or as it stood at the base the S8 work orders measure "today"
//     against (`BASE7`, f48c50b9: rem/integration with every receipted ticket of the
//     five programmes and amendment 4, P45's stale mark, P46's advisory and P47's
//     unreturned lines included), read with `git show` from the repository this tree
//     belongs to. A screen rendered by both from the same answers is how a unit measures
//     "renders byte for byte as today" and "makes no request it does not make today".
//     Every other console file is this tree's.
//   · P49'S WORLD (src/units/P49/LEDGER.unit.test.ts:139-150, as the P49 delivery
//     review's control scripts C0 to C3 and S7 drive it): P08's catalogue, pages and
//     learn document (src/units/_parity6.ts), one shopper visit to the product page and
//     one to the home page, every placement published through its own door; the
//     authorized learn republish of the product slot through the operator's PUT; the
//     operator's generation transition; and what the product placement's own object
//     holds (its stored accumulation: the configuration it counts under and its
//     exposures, `stats.events`, the review's measure) and what the KV and R2 doubles hold.
// Documents are read from the tree this file lives in, never the working directory.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';
import { expect } from 'vitest';

import { statsName } from '@/learn/fan';
import { DEFAULT_STATS } from '@/learn/stats';

import { asOperator, BRAND, expectPublished, mount, putDocument, readTree, TENANT, type Answer, type Host, type Mounted } from './_parity';
import { publishStats } from './_parity3';
import { dials, HOME_MODULES, learnOf, P08_LEARN, P08_PIECES, P08_SLOTS, PDP_MODULES, visit, type ConsoleRequest, type ViewsSource } from './_parity6';

/** The base the S8 work orders measure "today" against: rem/integration with amendment 4 committed. */
export const BASE7 = 'f48c50b9b7f4f12eb96b268cc7cb9098b420923a';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
/** A file of this repository as it stood at `BASE7`. */
export const baseTree7 = (relative: string): string => execFileSync('git', ['-C', ROOT, 'show', `${BASE7}:${relative}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// ---------------------------------------------------------------------------
// The shipped console, with views.js as it is here ('head') or at BASE7 ('base').
// ---------------------------------------------------------------------------

const OPERATOR_ORIGIN = 'http://console.test';

interface ConsoleEl {
  value: string; disabled: boolean; textContent: string | null; innerHTML: string; outerHTML: string; dataset: Record<string, string | undefined>;
  click: () => void; focus: () => void; dispatchEvent: (e: unknown) => boolean;
  querySelectorAll: (sel: string) => ArrayLike<ConsoleEl>; querySelector: (sel: string) => ConsoleEl | null; closest: (sel: string) => ConsoleEl | null;
  getAttribute: (name: string) => string | null;
}
interface ConsoleWindow extends Record<string, unknown> {
  document: { body: ConsoleEl; getElementById: (id: string) => ConsoleEl | null; querySelectorAll: (sel: string) => ArrayLike<ConsoleEl> };
  eval: (s: string) => unknown; close: () => void; location: { hash: string };
  localStorage: { setItem: (key: string, value: string) => void };
  Event: new (type: string, options: object) => unknown;
  Console: { when: (ms: number) => string; fmt: (n: number) => string };
}

/**
 * The shipped console under jsdom, bound to the mounted app, opened at `hash`
 * (src/units/_parity6.ts `consoleAt`, line for line, but for the base revision of views.js).
 */
export async function consoleAt7(m: Mounted, hash: string, views: ViewsSource = 'head') {
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
    w.eval(file === 'views.js' && views === 'base' ? baseTree7('public/console/views.js') : readTree(`public/console/${file}`));
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
  /** The Slots screen's row of one slot (the `tr` whose first button names it), or null. */
  const rowEl = (slot: string): ConsoleEl | null => all('#view tr').find(r => (r.querySelector('td button')?.textContent ?? '').trim() === slot) ?? null;
  /** The requests made so far, as `METHOD path` (bodies apart: they carry fresh idempotency material). */
  const calls = () => requests.map(r => `${r.method} ${r.path}`);
  return { w, requests, calls, all, $, view, text, control, type, save, go, rowEl, settle, settleChecked, close: () => w.close() };
}
export type OpenConsole7 = Awaited<ReturnType<typeof consoleAt7>>;

// ---------------------------------------------------------------------------
// P49's world (src/units/P49/LEDGER.unit.test.ts:139-150; the P49 review's C0 to C3).
// ---------------------------------------------------------------------------

/** P08's learn statistics block (src/units/_parity6.ts: DEFAULT_STATS with nMin 2). */
export const P08_STATS = { ...DEFAULT_STATS, nMin: 2 };

/** P08's documents published, one visit to the product page and one to the home page, every placement published. */
export async function p49World(host: Host): Promise<Mounted> {
  const m = await mount(host, { pieces: P08_PIECES, slots: P08_SLOTS, learn: P08_LEARN });
  expectPublished(m, 'P49\'s world — P08\'s catalogue, pages and learn document publish');
  await visit(m, 'pdp'); await visit(m, 'home');
  await publishStats(m);
  return m;
}

/** An authorized learn republish through the operator's PUT: the product slot's dials, the home slot's P08 dials, and the statistics block. */
export async function republishProduct(m: Mounted, product: Record<string, unknown> = dials('add_to_bag'), stats: Record<string, unknown> = P08_STATS): Promise<void> {
  const changed = await putDocument(m, 'learn', { ...learnOf({ [PDP_MODULES]: product, [HOME_MODULES]: dials() }), stats }, 'p5x-republish');
  expect(changed.status, `${m.host}: PRECONDITION — the learn document republishes (${JSON.stringify(changed.body).slice(0, 200)})`).toBe(200);
}

/** The operator's generation transition for a slot (`POST /v1/:tenant/learn/generation`), the product slot unless the body names another. */
export const transitionOf = (m: Mounted, body: Record<string, unknown>) => asOperator(m, 'POST', `/v1/${TENANT}/learn/generation`, { slot: PDP_MODULES, ...body });

/** The placement's own object in the harness's registry (one page per slot here). */
const placementOf = (m: Mounted, slot: string) => m.stats.get(statsName(TENANT, BRAND, slot));

/** The placement's stored accumulation: the configuration it counts under and its exposures (`stats.events`, the review's C0 to C3 measure), or a sentence. */
export function accumulationOf(m: Mounted, slot: string = PDP_MODULES): { config: unknown; events: number | null } | string {
  const stored = placementOf(m, slot)?.data.get('learn') as { config?: unknown; stats?: { events?: number } } | undefined;
  return stored ? { config: stored.config, events: stored.stats?.events ?? null } : `absent: no stored accumulation for ${slot}`;
}
/** The placement's exposures, or a sentence. */
export const eventsOf = (m: Mounted, slot: string = PDP_MODULES): number | string => {
  const a = accumulationOf(m, slot);
  return typeof a === 'string' ? a : (a.events ?? 'no events counter');
};
/** Every entry the placement's object stores, sorted by key, serialized: what "the object writes nothing" compares. */
export function objectBytes(m: Mounted, slot: string = PDP_MODULES): string {
  const data = placementOf(m, slot)?.data;
  return data ? JSON.stringify([...data.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) : `absent: no object for ${slot}`;
}
/** Every KV entry, sorted by key, serialized. */
export const kvBytes = (m: Mounted): string => JSON.stringify([...m.cache.data.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
/** Every R2 object, sorted by key, serialized. */
export const r2Bytes = (m: Mounted): string => JSON.stringify([...m.storage.objects.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
/** The KV keys, sorted. */
export const kvKeys = (m: Mounted): string[] => [...m.cache.data.keys()].sort();

/** The answer's keys, sorted: what an answer's member set is compared by where its order is not ruled. */
export const sortedKeys = (answer: Answer): string[] => Object.keys(answer.body).sort();
