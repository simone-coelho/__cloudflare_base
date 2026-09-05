// src/console/learning.render.test.ts
// The learning console rendered the way a browser renders it, against a fake
// platform, in the states that matter: signed out and signed in, every dial off
// and every dial on. Nothing on the page may read "null", "undefined" or "NaN",
// the grid's headings are words, the sign-in works, and a dial that is switched
// off leaves nothing behind. This exists because two nulls reached a person's
// screen before any check did (2026-09-05).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const pub = (f: string) => readFileSync(new URL(`../../public/${f}`, import.meta.url), 'utf8');

type Fixtures = { learn: Record<string, unknown>; snapshot: Record<string, unknown> | null };

const snapshot = {
  tenant: 'coach', brand: 'coach', slot: 'chero', reward: 'click', objective: 'unit', version: 1_788_000_000_000, publishedAt: 1_788_000_000_000, events: 22,
  n0: 30, nMin: 30, liftMin: 0.5, liftMax: 2, priorVersion: 0,
  items: {
    cnt_a: { '*': { level: 0, key: '*', n: 20.816, s: 1.977, p0: 0.074, n0: 30, p_hat: 0.083, lift: 1.116 } },
    cnt_b: { '*': { level: 0, key: '*', n: 0.969, s: 0, p0: 0.074, n0: 30, p_hat: 0.072, lift: 0.969 } },
  },
  slotRates: { '*': { n: 21.785, s: 1.977, rate: 0.074 } },
};
const learnOff = { holdout: { share: 0.05, salt: '', arms: ['default'] }, slots: {} };
const learnOn = {
  holdout: { share: 0.1, salt: 'x', arms: ['default', 'no_learning'] },
  policy: { scope: 'session', match: 'direct', credit: 'last', windowsMs: { click: 1_800_000, purchase: 604_800_000 } },
  stats: { n0: 30, tauLearnMs: 1_814_400_000, liftMin: 0.5, liftMax: 2, nMin: 30 },
  regional: { enabled: true, kBlend: 1, minEvents: 30 },
  external: { kind: 'table', ref: 'MODEL', timeoutMs: 20, fallback: 'omit' },
  slots: { chero: { gamma: 0.5, reward: 'click', objective: 'unit', exploration: { mode: 'rotation', share: 0.1, floor: 50 }, autonomy: { mode: 'assisted', step: 0.05, min: 0, max: 1, pinned: ['line'], minN: 500 }, external: { weight: 0.3 }, items: { cnt_b: { mode: 'freeze', lift: 1.2 } } } },
};

/** A fake platform: what each route the console reads answers with. */
function platform(fx: Fixtures, log: string[]) {
  const okJson = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body });
  return async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
    const u = new URL(url, 'http://console.test');
    const p = u.pathname + u.search;
    log.push(`${init?.body ? 'POST' : 'GET'} ${p}`);
    const signed = Boolean(init?.headers?.authorization);
    if (p.startsWith('/content/slots')) return okJson({ ok: true, source: 'stored', revision: 3, document: { pages: { home: [{ slot: 'chero', take: 1, weights: { line: 0.35 } }, { slot: 'merch', take: 1, weights: {}, pinnedPieceId: 'cnt_m' }] } } });
    if (p.startsWith('/content/catalog')) return okJson({ ok: true, revision: 4, document: { pieces: [{ id: 'cnt_a', customerContentId: 'CCH-001', title: 'The Tabby Shop' }, { id: 'cnt_b', customerContentId: 'CCH-003', title: 'Three ways' }] } });
    if (p.startsWith('/content/learn/history')) return okJson({ ok: true, revisions: [{ revision: 2, at: 1_788_000_000_000, actor: 'ops', note: 'first' }] });
    if (p.startsWith('/content/priors/history')) return okJson({ ok: true, revisions: [] });
    if (p.startsWith('/content/learn/validate')) return okJson({ ok: true, errors: [] });
    if (p.startsWith('/content/learn')) return okJson({ ok: true, source: 'stored', revision: 2, document: fx.learn });
    if (p.startsWith('/v1/coach/lift/history')) return signed ? okJson({ ok: true, versions: [{ version: 1_788_000_000_000, size: 1200, uploaded: '2026-09-05T00:00:00Z' }] }) : okJson({ ok: false, error: 'SDK key required' }, 401);
    if (p.startsWith('/v1/coach/lift')) return signed ? okJson({ ok: true, snapshot: fx.snapshot }) : okJson({ ok: false, error: 'SDK key required' }, 401);
    if (p.startsWith('/v1/coach/learn/proposals')) return signed ? okJson({ ok: true, proposals: [] }) : okJson({ ok: false }, 401);
    if (p.startsWith('/v1/coach/learn/report')) return okJson({ ok: false, error: 'no report built for that day yet' }, 404);
    if (p === '/auth/login') {
      const b = JSON.parse(init?.body || '{}') as { email?: string; password?: string };
      if (b.password !== 'right-password') return okJson({ error: 'Invalid credentials' }, 401);
      const token = 'h.' + Buffer.from(JSON.stringify({ sub: 'ops-1', exp: Math.floor(Date.now() / 1000) + 900 })).toString('base64url') + '.s';
      return okJson({ accessToken: token, refreshToken: 'r', user: { id: 'ops-1', email: b.email, name: 'Test Operator', roles: ['operator'] }, expiresIn: 900 });
    }
    if (p === '/auth/logout') return okJson({ success: true });
    return okJson({ ok: false, error: `unstubbed ${p}` }, 404);
  };
}

async function openConsole(fx: Fixtures) {
  const log: string[] = [];
  const dom = new JSDOM(pub('learning.html'), { url: 'http://console.test/learning.html?scope=coach&slot=chero', pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window as unknown as Record<string, unknown> & { document: Document; eval: (s: string) => unknown; close: () => void };
  w.fetch = platform(fx, log);
  w.confirm = () => true;
  w.eval(pub('operator-session.js'));
  w.eval(pub('learning.js'));
  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 15)); };
  await settle();
  const text = () => (w.document.body.textContent || '').replace(/\s+/g, ' ');
  const $ = (id: string) => w.document.getElementById(id) as HTMLElement & { value: string; hidden: boolean; click: () => void };
  const signIn = async (password: string) => {
    $('sign-in').click(); await settle();
    $('si-email').value = 'ops@brand.test'; $('si-password').value = password;
    ($('sign-in-form') as unknown as HTMLFormElement).dispatchEvent(new w.window.Event('submit', { bubbles: true, cancelable: true }));
    await settle(); await settle();
  };
  return { dom, w, log, text, $, signIn, settle, close: () => w.close() };
}

const STRAY = /\b(null|undefined|NaN)\b/;

describe('the learning console, rendered', () => {
  it('signed out, every dial off: no stray value anywhere, and the page says to sign in', async () => {
    const c = await openConsole({ learn: learnOff, snapshot });
    try {
      expect(c.text()).not.toMatch(STRAY);
      expect(c.text()).toContain('Sign in at the top right');
      expect(c.$('sign-in').hidden).toBe(false);
      expect(c.$('sign-out').hidden).toBe(true);
      // The dial panels rendered, and the rows for dials that are off left nothing behind.
      expect(c.$('dials-slot').textContent).toContain('the trust dial');
      expect(c.$('dials-global').textContent).toContain('Holdout');
      expect(c.$('dials-global').querySelectorAll('.dial').length).toBeGreaterThan(8);
    } finally { c.close(); }
  });

  it('signs in on the page, then shows the grid with headings a merchandiser reads', async () => {
    const c = await openConsole({ learn: learnOff, snapshot });
    try {
      await c.signIn('wrong-password');
      expect(c.$('si-error').textContent).toBe('That email and password were not accepted.');
      await c.signIn('right-password');
      expect(c.$('who').textContent).toBe('Signed in as Test Operator');
      expect(c.$('sign-in').hidden).toBe(true);
      expect(c.$('sign-out').hidden).toBe(false);
      expect(c.$('sign-in-form').hidden).toBe(true);
      expect(c.$('si-password').value).toBe('');
      expect(c.text()).not.toContain('Sign in at the top right');
      const heads = [...c.w.document.querySelectorAll('#grid thead th')].map((th) => (th.firstChild?.textContent || '').trim());
      expect(heads).toEqual(['Item', 'Cell', 'Shown', 'Succeeded', 'Rate', 'Baseline', 'Lift', 'Evidence', 'Controls']);
      const syms = [...c.w.document.querySelectorAll('#grid thead th .sym')].map((s) => s.textContent);
      expect(syms).toEqual(['n', 's', 'p̂', 'p₀', 'p̂ / p₀', 'n / (n + n₀)']);
      const first = [...c.w.document.querySelectorAll('#grid tbody tr')][0]!;
      expect(first.textContent).toContain('CCH-001');
      expect([...first.querySelectorAll('td')].slice(2, 4).map((td) => td.textContent)).toEqual(['20.816', '1.977']);
      expect(c.$('grid-count').textContent).toContain('2 rows · reward click');
      expect(c.text()).not.toMatch(STRAY);
      // Signing out takes the grid away again and leaves nothing stray.
      c.$('sign-out').click(); await c.settle(); await c.settle();
      expect(c.$('who').textContent).toBe('');
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

  it('every dial on: exploration, autonomy, the regional prior, their model, a frozen item, no stray value', async () => {
    const c = await openConsole({ learn: learnOn, snapshot: { ...snapshot, objective: 'revenue', reward: 'purchase' } });
    try {
      await c.signIn('right-password');
      const slot = c.$('dials-slot').textContent || '', global = c.$('dials-global').textContent || '';
      for (const label of ['Share', 'Floor', 'Step', 'Bounds', 'Minimum exposures', 'Pinned dimensions']) expect(slot).toContain(label);
      for (const label of ['K, the blend constant', 'Minimum events', 'Ref', 'Budget']) expect(global).toContain(label);
      expect(c.$('grid-count').textContent).toContain('reward purchase weighed by revenue');
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

  it('with nothing published for the slot, the grid says so instead of breaking', async () => {
    const c = await openConsole({ learn: learnOff, snapshot: null });
    try {
      await c.signIn('right-password');
      expect(c.$('grid').textContent).toContain('Nothing published for this slot yet');
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });
});
