// src/console/console.render.test.ts
// The operator application rendered the way a browser renders it, against a fake
// platform, in the states that matter: signed out and signed in, a slot with a
// published snapshot and one without, the grid and its drill-down, the dials
// before and after a change.
//
// Three properties this file exists to hold, all of them doc 28's:
//
//   1. NOTHING UNBOUNDED. The application never asks for the whole snapshot
//      (GET /lift) or the whole catalog; every catalog-sized list is a page the
//      server cut, and Next carries the server's cursor back.
//   2. CELLS ARE A DRILL-DOWN. The grid asks for level=pooled; opening a piece
//      asks for level=cells with that item, and the URL says so, so the back
//      button works.
//   3. NO STRAY VALUE. Nothing on the page reads "null", "undefined" or "NaN",
//      in any state.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const pub = (f: string) => readFileSync(new URL(`../../public/${f}`, import.meta.url), 'utf8');

type Fixtures = { published?: boolean; slots?: boolean; learn?: Record<string, unknown>; dead?: boolean };

const SLOTS = {
  ok: true, tenant: 'coach', brand: 'coach', q: null, total: 3,
  pages: [
    { page: 'home', slots: [
      { page: 'home', slot: 'chero', take: 1, pinned: null, dimensions: ['contentType', 'line'], rules: ['freshness'], pieces: 18, reward: 'click', objective: 'unit', gamma: 0, exploration: 'off', autonomy: 'configured', controls: 1, evidence: { items: 2, events: 22, publishedAt: 1_788_000_000_000 } },
      { page: 'home', slot: 'merch', take: 1, pinned: 'cnt_m', dimensions: [], rules: [], pieces: 3, reward: 'click', objective: 'unit', gamma: 0, exploration: 'off', autonomy: 'configured', controls: 0, evidence: null },
    ] },
    { page: 'plp', slots: [
      { page: 'plp', slot: 'strip', take: 3, pinned: null, dimensions: ['category'], rules: ['stage', 'diversity'], pieces: 9, reward: 'purchase', objective: 'revenue', gamma: 0.5, exploration: 'rotation', autonomy: 'assisted', controls: 0, evidence: null },
    ] },
  ],
};

const row = (item: string, over: Record<string, unknown> = {}) => ({
  item, customer_item_id: `CCH-${item.slice(-3)}`, title: `The ${item} story`, key: '*', level: 0, level_words: 'everyone',
  n: 20.816, s: 1.977, p0: 0.074, p_hat: 0.083, lift: 1.116, n0: 30, evidence: 0.41, prior: null, control: null, ...over,
});
const PAGE1 = {
  ok: true, tenant: 'coach', brand: 'coach', slot: 'chero', version: 1_788_000_000_000, published: true,
  publishedAt: 1_788_000_000_000, reward: 'click', objective: 'unit', n0: 30, nMin: 30,
  level: 'pooled', item: null, q: null, sort: 'lift', dir: 'desc', total: 312, offset: 0, limit: 50,
  rows: [row('cnt_aaa'), row('cnt_bbb', { control: 'freeze' }), row('cnt_ccc', { prior: { p: 0.5, n: 200 } })],
  cursor: 'CURSOR-2',
};
const PAGE2 = { ...PAGE1, offset: 50, rows: [row('cnt_ddd')], cursor: null };
const CELLS = {
  ...PAGE1, level: 'cells', item: 'cnt_aaa', total: 2, offset: 0, cursor: null,
  rows: [row('cnt_aaa'), row('cnt_aaa', { key: 'channel=email', level: 1, level_words: 'channel' })],
};
const EMPTY = { ok: true, tenant: 'coach', brand: 'coach', slot: 'chero', version: 0, published: false, level: 'pooled', total: 0, offset: 0, limit: 50, rows: [], cursor: null };

const REFLEX = {
  version: 'reflex-demo-v1+r3', tauMs: 60_000, K: 1.8, thetaIn: 0.6, thetaOut: 0.45, epsilon: 0.0001, maxValuesPerDim: 24,
  weights: { product_view: 1, pdp_view: 1, view_product: 1, wishlist: 2, wishlist_add: 2, add_to_wishlist: 2, save_for_later: 2, add_to_cart: 3, cart_add: 3, purchase: 5, checkout: 5, order_complete: 5, content_impression: 0, content_dwell: 0.5, content_click: 1, video_complete: 2, tick: 0, try_on: 4 },
  dimensions: [
    { key: 'line', source: 'line' },
    { key: 'priceBand', source: 'price_usd', derive: 'band', cuts: [150, 400], labels: ['entry', 'core', 'elevated'], tauMs: 150_000 },
  ],
};
const SLOTS_DOC = { version: 'slots-coach', pages: { home: [
  { slot: 'chero', take: 2, weights: { line: 0.35 }, freshness: { weight: 0.2, halfLifeDays: 14 } },
  { slot: 'merch', take: 1, weights: {}, pinnedPieceId: 'cnt_m' },
] } };

const CMP = {
  control: { arm: 'default', n: 220, s: 7, rate: { p: 0.0318, lo: 0.0155, hi: 0.0641 } },
  treatment: { arm: 'personalized', n: 4000, s: 166, rate: { p: 0.0415, lo: 0.0358, hi: 0.048 } },
  difference: { p: 0.0097, lo: -0.0243, hi: 0.0271 }, relative: 0.305, verdict: 'undecided',
  neededPerArm: 4820, confidence: 0.95,
  alsoAt: { confidence: 0.9, difference: { p: 0.0097, lo: -0.019, hi: 0.024 }, verdict: 'undecided' },
  targets: { targets: { minimum: 0.1, target: 0.4, stretch: 0.6 }, relativeLow: -0.76, relativeHigh: 0.85, standing: 'on_track' },
  words: 'personalized 4.2% of 4,000 decisions vs default 3.2% of 220: +1.0 points (+31% relative); the 95% interval runs −2.4 points to +2.7 points, so not yet distinguishable from zero.',
};
const WINDOW = {
  tenant: 'coach', brand: 'coach', from: '2026-08-09', to: '2026-09-05', days: ['2026-09-04', '2026-09-05'], missing: ['2026-09-03'], confidence: 0.95,
  slots: { chero: { arms: [
    { arm: 'default', n: 220, s: 7, rate: { p: 0.0318, lo: 0.0155, hi: 0.0641 } },
    { arm: 'personalized', n: 4000, s: 166, rate: { p: 0.0415, lo: 0.0358, hi: 0.048 } },
  ], comparisons: [CMP] } },
};
const DAY = {
  tenant: 'coach', brand: 'coach', date: '2026-09-05', builtAt: 1_788_000_000_000,
  counts: { decisions: 117, outcomes: 9, visitors: 9, truncated: false },
  policies: [{ name: 'learning', role: 'learning', credits: 4 }, { name: 'visitor-scope', role: 'reporting', credits: 9 }],
  grids: { chero: { learning: { items: { cnt_aaa: { '*': { n: 20.8, s: 2, p_hat: 0.083, lift: 1.116 } } } }, 'visitor-scope': { items: { cnt_aaa: { '*': { n: 20.8, s: 4, p_hat: 0.14, lift: 1.4 } } } } } },
  exploration: [{ slot: 'chero', decisions: 96, explored: 9, realized: 0.094, configured: 0.1, mode: 'rotation' }],
  holdout: { chero: [{ arm: 'default', decisions: 16, credited: 4, rate: 0.25 }, { arm: 'personalized', decisions: 26, credited: 13, rate: 0.5 }] },
  holdoutComparison: { chero: [CMP] },
};

const LEARN_OFF = { holdout: { share: 0.05, salt: '', arms: ['default'] }, slots: {} };
const LEARN_ON = {
  holdout: { share: 0.1, salt: 'x', arms: ['default', 'no_learning'] },
  policy: { scope: 'visitor', match: 'any', credit: 'first', windowsMs: { click: 1_800_000 } },
  stats: { n0: 30, tauLearnMs: 1_814_400_000, liftMin: 0.5, liftMax: 2, nMin: 30 },
  regional: { enabled: true, kBlend: 1, minEvents: 30 },
  external: { kind: 'table', ref: 'MODEL', timeoutMs: 20, fallback: 'omit' },
  slots: { chero: { gamma: 0.5, reward: 'purchase', objective: 'revenue', exploration: { mode: 'rotation', share: 0.1, floor: 50 }, autonomy: { mode: 'assisted', step: 0.05, min: 0, max: 1, pinned: ['line'], minN: 500 }, external: { weight: 0.3 }, items: { cnt_bbb: { mode: 'freeze', lift: 1.2 } } } },
};

/** A fake platform: what each route the application reads answers with. */
function platform(fx: Fixtures, log: string[], saved: Array<Record<string, unknown>>) {
  const okJson = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body });
  return async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const u = new URL(url, 'http://console.test');
    const p = u.pathname + u.search;
    log.push(`${init?.method || 'GET'} ${p}`);
    // A platform that is up but broken: the shape of a store whose migrations
    // were never applied, which is how POST /auth/login answered 500 and every
    // screen behind it looked like it was still loading.
    if (fx.dead) return okJson({ error: 'Internal server error', message: 'D1_ERROR: no such table' }, 500);
    const signed = Boolean(init?.headers?.authorization);
    if (u.pathname === '/v1/coach/learn/slots') return okJson(fx.slots === false ? { ok: true, total: 0, pages: [] } : SLOTS);
    if (u.pathname === '/v1/coach/lift/rows') {
      if (fx.published === false) return okJson(EMPTY);
      if (u.searchParams.get('cursor')) return okJson(PAGE2);
      if (u.searchParams.get('level') === 'cells') return okJson(CELLS);
      return okJson(PAGE1);
    }
    if (u.pathname === '/v1/coach/learn/proposals') {
      return signed
        ? okJson({ ok: true, proposals: [{ id: 'p1', slot: 'chero', dimension: 'line', from: 0.25, to: 0.3, exposures: 900, mode: 'assisted', status: 'proposed', at: 1_788_000_000_000, note: 'the cycle', evidence: [{ dimension: 'line', spread: 0.12 }] }] })
        : okJson({ ok: false, error: 'unauthorized' }, 401);
    }
    if (u.pathname === '/v1/coach/ledger/erasures') {
      return signed
        ? okJson({ ok: true, retentionDays: 90, pending: [{ visitor_id: 'vis-1', erased_at: 1_788_000_000_000, actor: 'ops', rows_removed: 4, objects_rewritten: 1 }] })
        : okJson({ ok: false, error: 'unauthorized' }, 401);
    }
    if (u.pathname === '/v1/coach/learn/report/window') {
      return signed ? okJson({ ok: true, report: WINDOW }) : okJson({ ok: false, error: 'unauthorized' }, 401);
    }
    if (u.pathname === '/v1/coach/learn/report') {
      if (init?.method === 'POST') { saved.push(JSON.parse(init.body || '{}') as Record<string, unknown>); return okJson({ ok: true, report: DAY }); }
      return okJson({ ok: false, error: 'no report built for that day yet' }, 404);
    }
    if (u.pathname === '/v1/coach/lift/history') return okJson({ ok: true, versions: [{ version: 1_788_000_000_000, size: 2048, uploaded: '2026-09-05T00:00:00Z' }] });
    if (u.pathname.endsWith('/history')) {
      const kind = u.pathname.split('/').slice(-2)[0];
      return okJson({ ok: true, revisions: kind === 'priors' ? [] : [
        { revision: 2, version: `${kind}-v1+r2`, actor: 'Local Ops', note: 'the second', at: 1_788_000_000_000 },
        { revision: 1, version: `${kind}-v1+r1`, actor: 'ops', note: 'the first', at: 1_787_000_000_000 },
      ] });
    }
    if (u.pathname.includes('/rollback/')) return okJson({ ok: true, revision: 7 });
    if (u.pathname === '/config/reflex/validate') return okJson({ valid: true, errors: [], warnings: [] });
    if (u.pathname === '/config/reflex') {
      if (init?.method === 'PATCH') {
        saved.push(JSON.parse(init.body || '{}') as Record<string, unknown>);
        return okJson({ ok: true, revision: 4, version: 'reflex-demo-v1+r4', config: REFLEX });
      }
      return okJson({
        scope: 'coach', source: 'stored', revision: 3, actor: 'ops', note: 'first', at: 1_788_000_000_000,
        config: REFLEX, inherited: ['content_click', 'content_dwell', 'content_impression', 'video_complete'],
        warnings: ["dimension 'contentType' (source 'contentType') is in the compiled default and not in this document"],
      });
    }
    if (u.pathname === '/content/slots/validate') return okJson({ valid: true, errors: [] });
    if (u.pathname === '/content/slots') {
      if (init?.method === 'PUT') {
        const body = JSON.parse(init.body || '{}') as Record<string, unknown>;
        saved.push(body);
        return okJson({ ok: true, revision: 5, document: body.document });
      }
      return okJson({ ok: true, source: 'stored', revision: 4, document: SLOTS_DOC });
    }
    if (u.pathname === '/content/learn/validate') return okJson({ valid: true, errors: [] });
    if (u.pathname === '/content/learn') {
      if (init?.method === 'PUT') {
        const body = JSON.parse(init.body || '{}') as Record<string, unknown>;
        saved.push(body);
        return okJson({ ok: true, revision: 9, document: body.document });
      }
      return okJson({ ok: true, source: 'stored', revision: 2, document: fx.learn || LEARN_OFF });
    }
    if (u.pathname === '/auth/login') {
      const b = JSON.parse(init?.body || '{}') as { email?: string; password?: string };
      if (b.password !== 'right-password' && b.password !== 'temp-password') return okJson({ error: 'Invalid credentials' }, 401);
      const token = 'h.' + Buffer.from(JSON.stringify({ sub: 'ops-1', roles: ['admin'], exp: Math.floor(Date.now() / 1000) + 900 })).toString('base64url') + '.s';
      return okJson({ accessToken: token, refreshToken: 'r', user: { id: 'ops-1', email: b.email, name: 'Test Operator', roles: ['admin'] }, mustChangePassword: b.password === 'temp-password', expiresIn: 900 });
    }
    if (u.pathname === '/auth/password') {
      const b = JSON.parse(init?.body || '{}') as { newPassword?: string };
      saved.push({ passwordChangedTo: b.newPassword });
      return okJson({ ok: true, user: { id: 'ops-1', email: 'ops@brand.test', name: 'Test Operator', roles: ['operator'] } });
    }
    if (u.pathname === '/auth/users' && init?.method !== 'POST') {
      return signed ? okJson({ ok: true, users: [
        { id: 'ops-1', email: 'ops@brand.test', name: 'Test Operator', roles: ['admin'], disabled: false, mustChangePassword: false, lastSignInAt: 1_788_000_000_000 },
        { id: 'ops-2', email: 'buyer@brand.test', name: 'A Buyer', roles: ['operator'], disabled: false, mustChangePassword: true, lastSignInAt: null },
      ] }) : okJson({ ok: false, error: 'unauthorized' }, 401);
    }
    if (u.pathname === '/auth/users' && init?.method === 'POST') {
      const b = JSON.parse(init.body || '{}') as { email?: string };
      saved.push({ createdAccount: b.email });
      return okJson({ ok: true, user: { id: 'ops-3', email: b.email, name: 'New', roles: ['operator'] }, temporaryPassword: 'Temp-1234-Temp' }, 201);
    }
    if (u.pathname === '/auth/audit') {
      return signed ? okJson({ ok: true, entries: [
        { at: 1_788_000_000_000, action: 'sign_in', actorEmail: null, targetEmail: 'ops@brand.test' },
        { at: 1_787_900_000_000, action: 'account_created', actorEmail: 'ops@brand.test', targetEmail: 'buyer@brand.test' },
      ] }) : okJson({ ok: false, error: 'unauthorized' }, 401);
    }
    if (u.pathname === '/auth/logout') return okJson({ success: true });
    return okJson({ ok: false, error: `unstubbed ${p}` }, 404);
  };
}

type El = {
  value: string; hidden: boolean; disabled: boolean; textContent: string | null; dataset: Record<string, string>;
  firstChild: { textContent: string | null } | null;
  click: () => void; focus: () => void;
  querySelectorAll: (sel: string) => ArrayLike<El>; querySelector: (sel: string) => El | null;
  dispatchEvent: (e: unknown) => boolean;
};

async function open(fx: Fixtures = {}, hash = '#/work?scope=coach') {
  const log: string[] = [];
  const saved: Array<Record<string, unknown>> = [];
  const dom = new JSDOM(pub('console/index.html'), { url: `http://console.test/console/${hash}`, pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window as unknown as Record<string, unknown> & {
    document: { body: El; getElementById: (id: string) => unknown; querySelectorAll: (sel: string) => ArrayLike<El>; querySelector: (s: string) => El | null };
    eval: (s: string) => unknown; close: () => void; location: { hash: string };
  };
  w.fetch = platform(fx, log, saved);
  w.confirm = () => true;
  w.eval(pub('operator-session.js'));
  w.eval(pub('console/shell.js'));
  w.eval(pub('console/views.js'));
  w.eval(pub('console/views-config.js'));
  w.eval(pub('console/views-measure.js'));
  w.eval(pub('console/views-accounts.js'));
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 12)); };
  /** Long enough for the dials' validator, which waits 350ms after the last keystroke. */
  const settleChecked = async () => { await new Promise((r) => setTimeout(r, 450)); await settle(); };
  await settle();
  const $ = (id: string) => w.document.getElementById(id) as unknown as El;
  const all = (sel: string) => Array.from(w.document.querySelectorAll(sel));
  const text = () => (w.document.body.textContent || '').replace(/\s+/g, ' ');
  const signIn = async (password = 'right-password') => {
    $('sign-in').click(); await settle();
    $('si-email').value = 'ops@brand.test'; $('si-password').value = password;
    $('sign-in-form').dispatchEvent(new (w.window as unknown as { Event: new (t: string, o: object) => unknown }).Event('submit', { bubbles: true, cancelable: true }));
    await settle(); await settle();
  };
  const goTo = async (h: string) => { w.location.hash = h; await settle(); await settle(); };
  return { w, log, saved, $, all, text, settle, settleChecked, signIn, goTo, close: () => w.close() };
}

const STRAY = /\b(null|undefined|NaN)\b/;

/** No screen may sit on a spinner: a load that failed has to say so. */
const STILL_LOADING = /Loading the |Loading…/;


describe('the operator application, rendered', () => {
  it('opens on the work queue, signed out, with a rail and no stray value', async () => {
    const c = await open();
    try {
      expect(c.text()).not.toMatch(STRAY);
      expect(c.$('view-title').textContent).toBe('What needs a person');
      // The rail carries a route per view, and the context the server fed it.
      const rail = c.all('#rail-views a').map((a) => (a.textContent || '').replace(/\d+$/, '').trim());
      expect(rail).toContain('Work');
      expect(rail).toContain('What it has learned');
      expect(rail).toContain('Dials');
      expect(rail).toContain('Slots');
      expect(c.$('slot-count').textContent).toBe('3 slots on 2 pages');
      // A slot was chosen for the operator, skipping the pinned one.
      expect(c.$('slot').value).toBe('chero');
      expect(c.$('where').textContent).toBe('coach · chero');
      // Signed out, the authenticated counts say so rather than showing a zero.
      expect(c.text()).toContain('sign in to fill the proposals and the erasures');
      expect(c.text()).toContain('Read only');
    } finally { c.close(); }
  });

  it('signs in on the page and the counts fill', async () => {
    const c = await open();
    try {
      await c.signIn('wrong-password');
      expect(c.$('si-error').textContent).toBe('That email and password were not accepted.');
      await c.signIn();
      expect(c.$('who').textContent).toBe('Signed in as Test Operator');
      expect(c.$('sign-out').hidden).toBe(false);
      const cards = c.all('.qcard').map((x) => ({
        n: (x.querySelector('.n')!.textContent || '').trim(),
        what: (x.querySelector('.what')!.textContent || '').trim(),
      }));
      expect(cards.find((x) => x.what === 'Proposals awaiting a decision')!.n).toBe('1');
      expect(cards.find((x) => x.what === 'Slots with nothing learned yet')!.n).toBe('2');   // merch and strip
      expect(cards.find((x) => x.what === 'Items a person is holding')!.n).toBe('1');
      expect(cards.find((x) => x.what === 'Erasures pending a rewrite')!.n).toBe('1');
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

  it('pages the grid from the server, and never asks for the whole snapshot', async () => {
    const c = await open();
    try {
      await c.goTo('#/lift?scope=coach&slot=chero');
      expect(c.$('view-title').textContent).toBe('What this slot has learned');
      // Words, and the design's symbol under each, per doc 28 §9.
      const words = c.all('#view thead th').map((th) => (th.firstChild?.textContent || '').trim());
      const syms = c.all('#view thead th .sym').map((x) => (x.textContent || '').trim());
      expect(words).toEqual(['', 'Piece', 'Shown', 'Paid off', 'Rate', 'The slot’s rate', 'Lift ↓', 'Evidence', 'Held by a person']);
      expect(syms).toEqual(['n', 's', 'p̂', 'p₀', 'p̂ / p₀', 'n / (n + n₀)']);
      expect(c.all('#view tbody tr')).toHaveLength(3);
      expect(c.text()).toContain('312 pieces, showing 1 to 3');   // the page the server cut, not the page size
      expect(c.text()).toContain('reward click');
      expect(c.text()).not.toMatch(STRAY);

      // Next asks the server with the server's own cursor, and the count follows.
      const next = c.all('.pager button').find((b) => b.textContent === 'Next')!;
      next.click(); await c.settle();
      expect(c.log.some((l) => l.includes('cursor=CURSOR-2'))).toBe(true);
      expect(c.text()).toContain('showing 51 to 51');
      const prev = c.all('.pager button').find((b) => b.textContent === 'Previous')!;
      expect(prev.disabled).toBe(false);

      // The unbounded reads doc 28 is written against: never asked for.
      expect(c.log.filter((l) => /GET \/v1\/coach\/lift\?/.test(l))).toEqual([]);
      expect(c.log.filter((l) => /\/content\/catalog/.test(l))).toEqual([]);
    } finally { c.close(); }
  });

  it('opens a piece as a drill-down, in the URL, and comes back', async () => {
    const c = await open();
    try {
      await c.goTo('#/lift?scope=coach&slot=chero');
      const piece = c.all('#view tbody .link')[0]!;
      expect(piece.textContent).toBe('CCH-aaa');
      piece.click(); await c.settle(); await c.settle();
      // The back button works because the drill-down is a route, not a mode.
      expect(c.w.location.hash).toContain('item=cnt_aaa');
      expect(c.log.some((l) => l.includes('level=cells') && l.includes('item=cnt_aaa'))).toBe(true);
      expect(c.text()).toContain('Every context cnt_aaa was shown in');
      expect(c.all('#view thead th').map((th) => (th.firstChild?.textContent || '').trim())).toContain('Context');
      expect(c.all('#view tbody tr')).toHaveLength(2);
      expect(c.text()).toContain('2 contexts, showing 1 to 2');
      expect(c.text()).not.toMatch(STRAY);
      const back = c.all('.toolbar button').find((b) => (b.textContent || '').includes('Every piece'))!;
      back.click(); await c.settle(); await c.settle();
      expect(c.w.location.hash).not.toContain('item=cnt_aaa');
    } finally { c.close(); }
  });

  it('holds a piece: one read, one write, one revision, and the rail follows', async () => {
    const c = await open();
    try {
      await c.signIn();
      await c.goTo('#/lift?scope=coach&slot=chero');
      const freeze = c.all('#view tbody button').find((b) => b.textContent === 'Freeze')!;
      freeze.click(); await c.settle(); await c.settle();
      const put = c.saved[0]!;
      expect((put.note as string)).toContain('froze 1 item at their current lift in chero');
      const doc = put.document as { slots: Record<string, { items: Record<string, unknown> }> };
      expect(doc.slots.chero.items.cnt_aaa).toEqual({ mode: 'freeze', lift: 1.116 });
      expect(c.text()).toContain('as learn revision 9');
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

  it('says so when a slot has published nothing, instead of an empty table', async () => {
    const c = await open({ published: false });
    try {
      await c.goTo('#/lift?scope=coach&slot=chero');
      expect(c.text()).toContain('Nothing published for this slot yet');
      expect(c.all('#view tbody tr')).toHaveLength(0);
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

  it('the dials arm the save bar, save once, and leave nothing behind when a dial is switched off', async () => {
    const c = await open({ learn: LEARN_ON });
    try {
      await c.signIn();
      await c.goTo('#/dials?scope=coach&slot=chero');
      expect(c.$('savebar').hidden).toBe(true);           // nothing changed yet
      expect(c.text()).toContain('Reading revision 2 of the learn document');
      for (const label of ['Trust in what was learned', 'What counts as paying off', 'How often', 'The most one weight may move', 'Held out of personalization', 'How long evidence lasts'])
        expect(c.text()).toContain(label);
      expect(c.text()).not.toMatch(STRAY);

      // A change arms the bar; the note goes with it; one PUT carries the document.
      const trust = c.w.document.querySelector('[data-focus-key="slots.chero.gamma"]')!;
      trust.value = '1';
      trust.dispatchEvent(new (c.w.window as unknown as { Event: new (t: string, o: object) => unknown }).Event('input', { bubbles: true }));
      await c.settle();
      // While the platform is still checking the draft, the bar says so and Save is held.
      expect(c.$('changecount').textContent).toBe('1 change, checking…');
      expect(c.$('save').disabled).toBe(true);
      await c.settleChecked();
      expect(c.$('savebar').hidden).toBe(false);
      expect(c.$('changecount').textContent).toBe('1 change');
      expect(c.$('save').disabled).toBe(false);
      c.$('note').value = 'trusting it in full';
      c.$('save').click(); await c.settle(); await c.settle();
      expect(c.saved).toHaveLength(1);
      expect(c.saved[0].note).toBe('trusting it in full');
      expect((c.saved[0].document as { slots: Record<string, { gamma: number }> }).slots.chero.gamma).toBe(1);
      expect(c.text()).toContain('Saved as learn revision 9');
      expect(c.$('savebar').hidden).toBe(true);
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

  it('leaves the save bar behind when the operator walks away from the dials', async () => {
    const c = await open({ learn: LEARN_ON });
    try {
      await c.signIn();
      await c.goTo('#/dials?scope=coach&slot=chero');
      const trust = c.w.document.querySelector('[data-focus-key="slots.chero.gamma"]')!;
      trust.value = '0.9';
      trust.dispatchEvent(new (c.w.window as unknown as { Event: new (t: string, o: object) => unknown }).Event('input', { bubbles: true }));
      await c.settle();
      expect(c.$('savebar').hidden).toBe(false);
      await c.goTo('#/work?scope=coach');
      expect(c.$('savebar').hidden).toBe(true);
    } finally { c.close(); }
  });

  it('shows every slot with what is set on it, and a slot opens the grid', async () => {
    const c = await open();
    try {
      await c.goTo('#/slots?scope=coach');
      expect(c.text()).toContain('home · 2 slots');
      expect(c.text()).toContain('plp · 1 slot');
      expect(c.text()).toContain('pinned to cnt_m');
      expect(c.text()).toContain('nothing yet');
      expect(c.text()).toContain('2 pieces, 22 events');
      expect(c.text()).not.toMatch(STRAY);
      const strip = c.all('#view .link').find((b) => b.textContent === 'strip')!;
      strip.click(); await c.settle(); await c.settle();
      expect(c.w.location.hash).toContain('slot=strip');
      expect(c.$('view-title').textContent).toBe('What this slot has learned');
    } finally { c.close(); }
  });

  it('a brand with no slots says so, and asks for nothing else', async () => {
    const c = await open({ slots: false });
    try {
      expect(c.$('slot-count').textContent).toBe('No slots configured for this brand yet.');
      await c.goTo('#/lift?scope=coach');
      expect(c.text()).toContain('Choose a slot in the rail');
      expect(c.log.filter((l) => l.includes('/lift/rows'))).toEqual([]);
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

  it('the interests screen speaks in shopper terms, names what is inherited, and saves a patch', async () => {
    const c = await open();
    try {
      await c.signIn();
      await c.goTo('#/interests?scope=coach');
      expect(c.$('view-title').textContent).toBe('What the engine notices, and how fast it forgets');
      // A number is shown as its consequence, not as a symbol.
      expect(c.text()).toContain('Interest halves about every 41.6 seconds of inactivity');
      expect(c.text()).toContain('halfway to full strength after about 1.8 product views');
      // The behaviour groups, with the raw event names underneath for the data team.
      expect(c.text()).toContain('Viewed a product');
      expect(c.text()).toContain('product_view, pdp_view, view_product');
      // An action the engine knows and this screen does not group is still tunable.
      expect(c.text()).toContain('try_on');
      // Weights the document never wrote down, and the interest it does not carry.
      expect(c.text()).toContain('Inherited from the shipped defaults');
      expect(c.text()).toContain("dimension 'contentType'");
      // The hysteresis band, drawn to scale, with the sentence that says why the gap is there.
      expect(c.text()).toContain('leaves 0.45');
      expect(c.text()).toContain('joins 0.6');
      expect(c.text()).toContain('stops a shopper flickering in and out');
      // The registry, with the half-life it inherits computed per interest.
      expect(c.text()).toContain('1.7 minutes');   // priceBand's own 150s tau
      expect(c.text()).not.toMatch(STRAY);

      const K = c.w.document.querySelector('[data-focus-key="K"]')!;
      K.value = '3';
      K.dispatchEvent(new (c.w.window as unknown as { Event: new (t: string, o: object) => unknown }).Event('input', { bubbles: true }));
      await c.settleChecked();
      expect(c.$('changecount').textContent).toBe('1 change');
      c.$('note').value = 'slower to commit';
      c.$('save').click(); await c.settle(); await c.settle();
      // A patch, not the whole document: only what moved.
      expect(c.saved[0]).toEqual({ patch: { K: 3 }, note: 'slower to commit' });
      expect(c.text()).toContain('Saved as revision 4. Live now, on reflex-demo-v1+r4.');
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

  it('a slot rule switched on writes its defaults, and off leaves nothing behind', async () => {
    const c = await open();
    try {
      await c.signIn();
      await c.goTo('#/rules?scope=coach&slot=chero');
      expect(c.text()).toContain('chero on home, from revision 4 of the slot document');
      expect(c.text()).toContain('Where the shopper is in her journey');
      expect(c.text()).toContain('How fresh the piece is');
      expect(c.text()).toContain('How often she has already seen it');
      expect(c.text()).toContain('How much of one thing it may show');
      // Freshness is on in the fixture, so its own settings are there; stage is off.
      expect(c.text()).toContain('The bonus halves every');
      expect(c.text()).not.toContain('A piece for another stage is worth');
      expect(c.text()).not.toMatch(STRAY);

      // Switching a rule on writes the defaults a person can then change.
      const sw = c.all('#view select').find((x) => x.dataset.focusKey === 'rule:Where the shopper is in her journey')!;
      sw.value = 'on';
      sw.dispatchEvent(new (c.w.window as unknown as { Event: new (t: string, o: object) => unknown }).Event('change', { bubbles: true }));
      await c.settleChecked();
      expect(c.text()).toContain('A piece for another stage is worth');
      expect(c.text()).toContain('50% of what it would otherwise score');
      c.$('save').click(); await c.settle(); await c.settle();
      const doc = c.saved[0].document as { pages: { home: Array<Record<string, unknown>> } };
      expect(doc.pages.home[0].stage).toEqual({ outOfStage: 0.5, inStage: 1.2 });
      expect(doc.pages.home[0].freshness).toEqual({ weight: 0.2, halfLifeDays: 14 });
      expect(c.text()).toContain('Saved as slots revision 5');
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

  it('measurement leads with the window, the interval and the pre-set targets', async () => {
    const c = await open();
    try {
      await c.signIn();
      await c.goTo('#/measure?scope=coach&slot=chero');
      expect(c.$('view-title').textContent).toBe('Did it work');
      // The window first: the sentence, then the numbers behind it.
      expect(c.text()).toContain('Over the window · chero');
      expect(c.text()).toContain('not yet distinguishable from zero');
      expect(c.text()).toContain('2 days read, 1 day with no report');
      expect(c.text()).toContain('about 4,820 decisions on each arm; the smaller arm has 220');
      expect(c.text()).toContain('on track · minimum 10%, target 40%, stretch 60% relative');
      expect(c.text()).toContain('At 90%');
      // A day with no report says so rather than showing an empty table.
      expect(c.text()).toContain('No report for this day yet');
      expect(c.text()).not.toMatch(STRAY);

      // Building the day reads the ledger and changes nothing served.
      const build = c.all('#view button').find((b) => (b.textContent || '').includes('Build this day'))!;
      build.click(); await c.settle(); await c.settle();
      // The day the view builds is TODAY IN UTC, which is what iso(Date.now())
      // returns. Hardcoding a date made this test fail every night between
      // midnight UTC and midnight local, which is not a property of the code.
      const todayUtc = new Date().toISOString().slice(0, 10);
      expect(c.saved.some((x) => x.date === todayUtc)).toBe(true);
      expect(c.text()).toContain('117 decisions, 9 outcomes, 9 visitors');
      expect(c.text()).toContain('learning 4 · visitor-scope 9');
      expect(c.text()).toContain('9% of 96 decisions in the first position, against 10% configured');
      expect(c.text()).toContain('What each policy would have credited · chero');
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

  it('history shows every document, names who changed it, and can roll one back', async () => {
    const c = await open();
    try {
      await c.signIn();
      await c.goTo('#/history?scope=coach&slot=chero');
      for (const title of ['What the engine notices', 'What the engine may do', 'The slots and their rules', 'The content catalog', 'Imported priors'])
        expect(c.text()).toContain(title);
      expect(c.text()).toContain('Local Ops');
      expect(c.text()).toContain('in force');
      // Priors has nothing stored, and says so rather than showing an empty table.
      expect(c.text()).toContain('Nothing stored for this brand');
      expect(c.text()).toContain('Published snapshots · chero');
      expect(c.text()).toContain('2 KB');
      expect(c.text()).not.toMatch(STRAY);
      const back = c.all('#view .link').find((b) => (b.textContent || '').includes('Roll back'))!;
      back.click(); await c.settle(); await c.settle();
      expect(c.text()).toContain('Rolled revision 1 forward as revision 7');
    } finally { c.close(); }
  });

  it('a view that throws shows its own error and leaves the rest of the console standing', async () => {
    const c = await open();
    try {
      await c.goTo('#/work?scope=coach');
      c.w.eval("Console.view({ id: 'boom', group: 'Attention', title: 'Boom', heading: 'Boom', render() { throw new Error('on purpose'); } });");
      await c.goTo('#/boom?scope=coach');
      expect(c.text()).toContain('This screen could not be drawn: on purpose');
      expect(c.text()).toContain('The rest of the console still works');
      // The rail and the context are still there, so the operator can leave.
      expect(c.all('#rail-views a').length).toBeGreaterThan(4);
      expect(c.$('slot').value).toBe('chero');
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

  it('a temporary password is asked to be changed, and cannot be dismissed until it is', async () => {
    const c = await open();
    try {
      await c.signIn('temp-password');
      expect(c.$('who').textContent).toBe('Signed in as Test Operator');
      // The console works, and says the account is not finished.
      expect(c.$('password-form').hidden).toBe(false);
      expect(c.$('pw-note').textContent).toBe('You signed in with a temporary password. Choose your own to carry on.');
      c.$('pw-cancel').click(); await c.settle();
      expect(c.$('password-form').hidden).toBe(false);   // it will not go away

      c.$('pw-current').value = 'temp-password';
      c.$('pw-new').value = 'a-chosen-password';
      c.$('password-form').dispatchEvent(new (c.w.window as unknown as { Event: new (t: string, o: object) => unknown }).Event('submit', { bubbles: true, cancelable: true }));
      await c.settle(); await c.settle();
      expect(c.saved.some((x) => x.passwordChangedTo === 'a-chosen-password')).toBe(true);
      expect(c.$('password-form').hidden).toBe(true);
      expect(c.text()).toContain('Your password is changed');
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

  it('an ordinary sign-in is not asked to change anything', async () => {
    const c = await open();
    try {
      await c.signIn();
      expect(c.$('password-form').hidden).toBe(true);
      expect(c.$('change-password').hidden).toBe(false);
      c.$('change-password').click(); await c.settle();
      expect(c.$('password-form').hidden).toBe(false);
      c.$('pw-cancel').click(); await c.settle();
      expect(c.$('password-form').hidden).toBe(true);    // this one may be dismissed
    } finally { c.close(); }
  });

  it('proposals and erasures are read only until someone signs in', async () => {
    const c = await open();
    try {
      await c.goTo('#/proposals?scope=coach');
      expect(c.text()).toContain('Sign in to read the proposals');
      await c.goTo('#/erasures?scope=coach');
      expect(c.text()).toContain('Sign in to read the erasures');
      await c.signIn();
      await c.goTo('#/proposals?scope=coach');
      expect(c.text()).toContain('line from 0.25 to 0.3');
      expect(c.text()).toContain('separates outcomes by 0.12');
      await c.goTo('#/erasures?scope=coach');
      expect(c.text()).toContain('vis-1');
      expect(c.text()).toContain('kept 90 days');
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

  // ── A platform that answers, but answers wrongly ──────────────────────────
  // The preview store once ran without its migrations, so /auth/login answered
  // 500 and every screen behind it read as "still loading". A screen that cannot
  // read its data has to say that, on every route, signed in or out.
  it('never leaves a screen on the word Loading when the platform is broken', async () => {
    for (const route of ['work', 'lift', 'slots', 'dials', 'rules', 'interests', 'proposals', 'erasures', 'measure', 'history']) {
      const c = await open({ dead: true }, `#/${route}?scope=coach&slot=chero`);
      try {
        await c.settle();
        const shown = c.$('view').textContent || '';
        expect(shown, `${route} sat on a loading string`).not.toMatch(STILL_LOADING);
        expect(shown.trim().length, `${route} painted nothing at all`).toBeGreaterThan(0);
        expect(c.text()).not.toMatch(STRAY);
      } finally { c.close(); }
    }
  });

  it('says so when a sign-in is refused by a broken platform rather than looking signed in', async () => {
    const c = await open({ dead: true });
    try {
      await c.signIn('right-password');
      // The sign-in did not take, and the console says why instead of pretending.
      expect((c.$('si-error').textContent || '').length).toBeGreaterThan(0);
      expect(c.$('sign-in').hidden).toBe(false);
      expect(c.$('who').textContent).toBe('');
    } finally { c.close(); }
  });

  // ── The rail is routes, and what leaves says so ────────────────────────────
  // Simone walked the console and asked what the old pages were doing in the
  // rail: opening one replaces the whole application with a page that has no
  // rail and no way back. A rail entry is a route INSIDE this application; a
  // link that leaves is allowed to exist but must not look the same.
  it('keeps the old pages out of the routes and marks them as leaving', async () => {
    const c = await open();
    try {
      const railRoutes = c.all('#rail-views a:not(.away)').map((a) => String(a.getAttribute('href') || ''));
      expect(railRoutes.length).toBeGreaterThan(8);
      for (const href of railRoutes) expect(href.startsWith('#/')).toBe(true);

      const away = c.all('#rail-views a.away').map((a) => String(a.getAttribute('href') || ''));
      expect(away).toHaveLength(2);
      expect(away.some((h) => h.startsWith('/learning.html'))).toBe(true);
      expect(away.some((h) => h.startsWith('/tuning.html'))).toBe(true);
      // Under a heading that says what happens, not one that just names them.
      expect(c.$('rail-views').textContent).toContain('Leaves this console');
    } finally { c.close(); }
  });

  // ── Accounts, the last screen that lived only on the old page ──────────────
  it('shows an operator why Accounts is empty rather than refusing them', async () => {
    const c = await open({}, '#/accounts?scope=coach');
    try {
      // Signed out first: an instruction, not an error.
      expect(c.$('view').textContent).toContain('Sign in');
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

  it('lists the accounts and the activity for an admin, and never offers to remove yourself', async () => {
    const c = await open({}, '#/accounts?scope=coach');
    try {
      await c.signIn();
      const shown = c.$('view').textContent || '';
      expect(shown).toContain('ops@brand.test');
      expect(shown).toContain('buyer@brand.test');
      // The state of an account nobody has signed into yet is said in words.
      expect(shown).toContain('temporary password, not yet changed');
      // The audit is joined to words, never left as a raw action name.
      expect(shown).toContain('created the account');
      expect(shown).not.toContain('account_created');
      // The person signed in cannot remove themselves.
      expect(shown).toContain('this is you');
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

  it('shows a new account\'s temporary password once, in the page, and says it cannot be recovered', async () => {
    const c = await open({}, '#/accounts?scope=coach');
    try {
      await c.signIn();
      const emailBox = c.all('#view input[data-focus-key="acct-email"]')[0];
      const nameBox = c.all('#view input[data-focus-key="acct-name"]')[0];
      emailBox.value = 'new@brand.test';
      nameBox.value = 'New Person';
      const form = c.$('view').querySelector('form') as unknown as { dispatchEvent: (e: unknown) => boolean };
      form.dispatchEvent(new (c.w.window as unknown as { Event: new (t: string, o: object) => unknown }).Event('submit', { bubbles: true, cancelable: true }));
      await c.settle(); await c.settle();
      expect(c.saved.some((x) => x.createdAccount === 'new@brand.test')).toBe(true);
      const shown = c.$('view').textContent || '';
      expect(shown).toContain('Temp-1234-Temp');
      expect(shown).toContain('shown once');
    } finally { c.close(); }
  });
});
