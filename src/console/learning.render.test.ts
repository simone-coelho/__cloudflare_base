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

type Fixtures = { learn: Record<string, unknown>; snapshot: Record<string, unknown> | null; report?: Record<string, unknown>; proposals?: Record<string, unknown>[];
  resetOutcome?: 'unknown' | 'acknowledged'; passwordNoReplacement?: boolean; publicationConflict?: boolean;
  customReport?: Record<string, unknown>; reportRevision?: string; reportGate?: (u: URL, method: string) => Promise<void> };
type CapturedRequest = { url: string; method: string; headers: Record<string, string> };

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
function platform(fx: Fixtures, log: string[], saved: Record<string, unknown>[], requests: CapturedRequest[]) {
  const okJson = (body: unknown, status = 200): Response => {
    const value = body as Record<string, unknown>;
    return Response.json(value && value.revision ? { ...value, publication: { revision: 7, digest: 'a'.repeat(64) } } : body, { status });
  };
  return async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const u = new URL(url, 'http://console.test');
    const p = u.pathname + u.search;
    log.push(`${init?.method || 'GET'} ${p}`);
    requests.push({ url: p, method: init?.method || 'GET', headers: Object.fromEntries(new Headers(init?.headers)) });
    const signed = Boolean(init?.headers?.authorization);
    if (fx.publicationConflict && (u.pathname.endsWith('/learn/items/reset') || u.pathname.endsWith('/catalog/publication'))) return okJson({ ok: false, code: 'publication_conflict', error: 'Definite other operation' }, 409);
    if (u.pathname.endsWith('/learn/items/reset')) return okJson({ ok: true, had: true, resetCompleted: true, publicationOutcome: fx.resetOutcome ?? 'acknowledged' });
    if (p.startsWith('/content/slots')) return okJson({ ok: true, source: 'stored', revision: 3, document: { pages: { home: [{ slot: 'chero', take: 1, weights: { line: 0.35 } }, { slot: 'merch', take: 1, weights: {}, pinnedPieceId: 'cnt_m' }] } } });
    if (p.startsWith('/content/catalog')) return okJson({ ok: true, revision: 4, document: { pieces: [{ id: 'cnt_a', customerContentId: 'CCH-001', title: 'The Tabby Shop' }, { id: 'cnt_b', customerContentId: 'CCH-003', title: 'Three ways' }] } });
    if (p.startsWith('/content/learn/history')) return okJson({ ok: true, revisions: [{ revision: 2, at: 1_788_000_000_000, actor: 'ops', note: 'first' }] });
    if (p.startsWith('/content/priors/history')) return okJson({ ok: true, revisions: [] });
    if (p.startsWith('/content/learn/validate')) return okJson({ ok: true, valid: true, errors: [] });
    if (p.startsWith('/content/learn') && init?.method === 'PUT') {
      const body = JSON.parse(init.body || '{}') as Record<string, unknown>;
      saved.push(body);
      return okJson({ ok: true, revision: 3, document: body.document });
    }
    if (p.startsWith('/content/learn')) return okJson({ ok: true, source: 'stored', revision: 2, document: fx.learn });
    if (p.startsWith('/v1/coach/lift/history')) return signed ? okJson({ ok: true, versions: [{ version: 1_788_000_000_000, size: 1200, uploaded: '2026-09-05T00:00:00Z' }] }) : okJson({ ok: false, error: 'SDK key required' }, 401);
    if (p.startsWith('/v1/coach/lift')) return signed ? okJson({ ok: true, snapshot: fx.snapshot }) : okJson({ ok: false, error: 'SDK key required' }, 401);
    if (p.startsWith('/v1/coach/learn/proposals')) return signed ? okJson({ ok: true, proposals: fx.proposals || [] }) : okJson({ ok: false }, 401);
    if (u.pathname.endsWith('/learn/report')) {
      const method = init?.method || 'GET', input = JSON.parse(init?.body || '{}');
      const raw = method === 'POST' ? fx.customReport ?? fx.report : fx.report;
      if (!raw) return okJson({ ok: false, error: 'no report built for that day yet' }, 404);
      const report = { ...structuredClone(raw), tenant: u.pathname.split('/')[2], brand: u.searchParams.get('brand') || input.brand || 'coach', date: input.date || u.searchParams.get('date') };
      const revision = fx.reportRevision ?? 'a'.repeat(64);
      const reply = { ok: true, report, ...(method === 'GET' && u.searchParams.has('slot') ? { page: mockPage(report, u, revision) } : {}) };
      const status = u.searchParams.has('revision') && u.searchParams.get('revision') !== revision ? 409 : 200;
      if (method === 'POST') saved.push(input);
      await fx.reportGate?.(u, method);
      return status === 409 ? okJson({ ok: false, error: 'report changed' }, 409) : okJson(reply);
    }
    if (p === '/auth/login') {
      const b = JSON.parse(init?.body || '{}') as { email?: string; password?: string };
      const admin = b.email === 'admin@brand.test';
      const temp = b.password === 'temporary-pw-16';
      if (b.password !== 'right-password' && !temp) return okJson({ error: 'Invalid credentials' }, 401);
      const token = 'h.' + Buffer.from(JSON.stringify({ sub: admin ? 'ops-0' : 'ops-1', exp: Math.floor(Date.now() / 1000) + 900 })).toString('base64url') + '.s';
      return okJson({ accessToken: token, refreshToken: 'r', user: { id: admin ? 'ops-0' : 'ops-1', email: b.email, name: admin ? 'Test Admin' : 'Test Operator', roles: admin ? ['operator', 'admin'] : ['operator'] }, mustChangePassword: temp, expiresIn: 900 });
    }
    if (p === '/auth/logout') return okJson({ success: true });
    if (p === '/auth/password') {
      const b = JSON.parse(init?.body || '{}') as { currentPassword?: string; newPassword?: string };
      if (!signed) return okJson({ error: 'Authorization token required' }, 401);
      if ((b.newPassword || '').length < 10) return okJson({ error: 'A password needs at least ten characters.' }, 400);
      const accessToken = 'h.' + Buffer.from(JSON.stringify({ sub: 'ops-1', exp: Math.floor(Date.now() / 1000) + 900 })).toString('base64url') + '.s';
      return okJson({ ok: true, ...(fx.passwordNoReplacement ? {} : { accessToken, refreshToken: 'replacement-session' }), user: { id: 'ops-1', email: 'ops@brand.test', name: 'Test Operator', roles: ['operator'] } });
    }
    if (p.startsWith('/auth/audit')) return signed ? okJson({ ok: true, entries: [{ id: 2, at: 1_788_000_100_000, action: 'account_created', actorEmail: 'admin@brand.test', targetEmail: 'ops@brand.test' }, { id: 1, at: 1_788_000_000_000, action: 'sign_in', actorEmail: 'admin@brand.test', targetEmail: 'admin@brand.test' }] }) : okJson({ error: 'Authorization token required' }, 401);
    if (p === '/auth/users' && !init?.body) return signed ? okJson({ ok: true, users: [{ id: 'ops-0', email: 'admin@brand.test', name: 'Test Admin', roles: ['operator', 'admin'], disabled: false, mustChangePassword: false, createdAt: 1, lastSignInAt: 1_788_000_000_000 }, { id: 'ops-1', email: 'ops@brand.test', name: 'Test Operator', roles: ['operator'], disabled: false, mustChangePassword: true, createdAt: 1, lastSignInAt: null }] }) : okJson({ error: 'Authorization token required' }, 401);
    if (p === '/auth/users' && init?.body) {
      const b = JSON.parse(init.body) as { email: string; name: string; roles?: string[] };
      return okJson({ ok: true, user: { id: 'ops-2', email: b.email, name: b.name, roles: b.roles || ['operator'], disabled: false, mustChangePassword: true, createdAt: 2, lastSignInAt: null }, temporaryPassword: 'Ab3dEf7hJk2mNp4q' }, 201);
    }
    return okJson({ ok: false, error: `unstubbed ${p}` }, 404);
  };
}

/** Protocol-shaped browser stub; the real route/hash/authority proof lives in report.test.ts. */
function mockPage(report: Record<string, unknown>, u: URL, revision: string) {
  const slot = u.searchParams.get('slot')!, offset = Number((u.searchParams.get('cursor') || 'page-0').slice(5));
  const grids = report.grids as Record<string, Record<string, typeof snapshot>>, grid = grids[slot];
  const names = (report.policies as Array<{ name: string }>).map(p => p.name), items = [...new Set(names.flatMap(n => Object.keys(grid?.[n]?.items ?? {})))].sort();
  const projected: Record<string, unknown> = {};
  if (grid) for (const n of names) if (grid[n]) {
    const snap = grid[n]!, rows = snap.items as Record<string, Record<string, unknown>>;
    projected[n] = { ...snap, items: Object.fromEntries(items.slice(offset, offset + 50).filter(i => rows[i]).map(i => [i, rows[i]!['*'] ? { '*': rows[i]!['*'] } : {}])), slotRates: { '*': snap.slotRates['*'] } };
  }
  report.grids = grid ? { [slot]: projected } : {};
  return { slot, revision, offset, limit: 50, total: items.length, next: offset + 50 < items.length ? 'page-' + (offset + 50) : null, previous: offset ? 'page-' + (offset - 50) : null };
}

async function openConsole(fx: Fixtures, tenant = 'coach') {
  const log: string[] = [];
  const saved: Record<string, unknown>[] = [];
  const requests: CapturedRequest[] = [];
  const dom = new JSDOM(pub('legacy/learning.html'), { url: `http://console.test/learning.html?scope=${tenant}&slot=chero`, pretendToBeVisual: true, runScripts: 'outside-only' });
  type Node = { textContent: string | null; firstChild: { textContent: string | null } | null; querySelectorAll: (sel: string) => ArrayLike<Node> };
  type Doc = { body: Node; getElementById: (id: string) => unknown; querySelectorAll: (sel: string) => ArrayLike<Node> };
  const w = dom.window as unknown as Record<string, unknown> & { document: Doc; eval: (s: string) => unknown; close: () => void };
  w.fetch = platform(fx, log, saved, requests);
  w.Headers = Headers;
  w.TextEncoder = TextEncoder;
  w.confirm = () => true;
  w.eval(pub('operator-session.js'));
  w.eval(pub('learning.js'));
  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 15)); };
  await settle();
  const text = () => (w.document.body.textContent || '').replace(/\s+/g, ' ');
  type El = { value: string; hidden: boolean; click: () => void; textContent: string | null; querySelectorAll: (sel: string) => ArrayLike<{ textContent: string | null }>; dispatchEvent: (e: unknown) => boolean };
  const $ = (id: string) => w.document.getElementById(id) as unknown as El;
  const signIn = async (password: string) => {
    $('sign-in').click(); await settle();
    $('si-email').value = 'ops@brand.test'; $('si-password').value = password;
    $('sign-in-form').dispatchEvent(new (w.window as unknown as { Event: new (t: string, o: object) => unknown }).Event('submit', { bubbles: true, cancelable: true }));
    await settle(); await settle();
  };
  return { dom, w, log, saved, requests, text, $, signIn, settle, close: () => w.close() };
}

const STRAY = /\b(null|undefined|NaN)\b/;

describe('the learning console, rendered', () => {
  it('W15 live, exploration and saved report headings expose exact measurement basis and objective units without historic relabeling', async () => {
    const rendered = { ...snapshot, measurementBasis: 'rendered-v1', objective: 'revenue' };
    const report = { date: '2026-09-03', builtAt: snapshot.version, counts: { decisions: 2, outcomes: 1, visitors: 2, truncated: false },
      policies: [{ name: 'learning', credits: 1 }], holdout: {}, exploration: [], grids: { chero: { learning: rendered } } };
    const c = await openConsole({ learn: learnOn, snapshot: rendered, report });
    try {
      await c.signIn('right-password');
      expect(c.$('exploring').textContent).toContain('rendered-v1 exposures');
      expect(c.$('report').textContent).toContain('rendered-v1 exposures'); expect(c.$('report').textContent).toContain('Weighted credits (revenue)');
      expect(c.$('report').textContent).toContain('Per exposure (revenue)'); expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
    const old = await openConsole({ learn: learnOff, snapshot, report: { ...report, grids: { chero: { learning: snapshot } } } });
    try { await old.signIn('right-password'); expect(old.$('report').textContent).toContain('served-v1 exposures'); expect(old.$('report').textContent).toContain('Weighted credits (unit)'); }
    finally { old.close(); }
  });
  it('W32.05 pages canonical and response-only custom reports while exporting all cells and refusing stale downloads', async () => {
    const items = (prefix: string) => Object.fromEntries(Array.from({ length: 121 }, (_, i) => [prefix + String(i).padStart(3, '0'), { '*': snapshot.items.cnt_a['*'], 'c=detail': snapshot.items.cnt_b['*'] }]));
    const report = { date: '2026-09-03', builtAt: 1_788_000_000_000, counts: { decisions: 121, outcomes: 3, visitors: 121, truncated: false }, policies: [{ name: 'learning', credits: 3 }], holdout: {}, exploration: [],
      grids: { chero: { learning: { ...snapshot, items: items('saved-') } }, merch: { learning: { ...snapshot, items: items('merch-') } } } };
    const fx: Fixtures = { learn: learnOff, snapshot, report, customReport: { ...report, grids: { chero: { learning: { ...snapshot, items: items('custom-') } }, merch: { learning: { ...snapshot, items: items('custom-merch-') } } } } };
    const c = await openConsole(fx), blobs: Blob[] = [];
    const browser = c.dom.window as unknown as { Blob: typeof Blob; URL: { createObjectURL: (b: Blob) => string; revokeObjectURL: (u: string) => void }; HTMLAnchorElement: { prototype: { click: () => void } }; Event: new (t: string, o: object) => unknown;
      document: { querySelectorAll: (s: string) => ArrayLike<{ textContent: string | null; click: () => void }> } };
    browser.Blob = Blob; browser.URL.createObjectURL = b => { blobs.push(b); return 'blob:synthetic'; }; browser.URL.revokeObjectURL = () => undefined; browser.HTMLAnchorElement.prototype.click = () => undefined;
    const click = (name: string) => Array.from(browser.document.querySelectorAll('#report button')).find(b => b.textContent === name)!.click();
    const shown = () => Array.from(browser.document.querySelectorAll('#report .itemid')).map(e => e.textContent);
    const change = async (id: string, value: string) => { c.$(id).value = value; c.$(id).dispatchEvent(new browser.Event('change', { bubbles: true })); await c.settle(); };
    try {
      expect(shown()).toHaveLength(50); expect(shown()[0]).toBe('saved-000');
      click('Next'); await c.settle(); expect(shown()[0]).toBe('saved-050'); click('Previous'); await c.settle(); expect(shown()[0]).toBe('saved-000');
      expect(c.requests.filter(r => r.url.includes('/learn/report?')).every(r => r.url.includes('slot=chero') && r.url.includes('limit=50'))).toBe(true);
      c.$('report-csv').click(); await c.settle(); expect(blobs).toHaveLength(1);
      const csv = await blobs[0]!.text(); expect(csv.split('\n')).toHaveLength(243); expect(csv).toContain('saved-120'); expect(csv).toContain('c=detail');
      expect(c.requests.at(-1)!.url).toContain('revision=' + 'a'.repeat(64)); expect(c.requests.at(-1)!.url).not.toContain('slot=');
      fx.reportRevision = 'b'.repeat(64); c.$('report-csv').click(); await c.settle(); expect(blobs).toHaveLength(1); expect(c.text()).toContain('before exporting'); expect(shown()).toEqual([]);
      click('Reload first page'); await c.settle(); expect(shown()[0]).toBe('saved-000');
      let release!: () => void;
      fx.reportGate = async (u, method) => { if (method === 'POST') await new Promise<void>(r => { release = r; }); };
      c.$('report-run').click(); await c.settle(); click('Reload first page'); await c.settle();
      expect((c.$('report-run') as unknown as { disabled: boolean }).disabled).toBe(false);
      release(); await c.settle(); expect(shown()[0]).toBe('saved-000'); fx.reportGate = undefined;
      fx.reportGate = async (u, method) => { if (method === 'GET' && u.searchParams.has('slot')) await new Promise<void>(r => { release = r; }); };
      click('Reload first page'); await c.settle();
      c.$('report-run').click(); await c.settle(); expect(shown()[0]).toBe('custom-000'); expect(c.text()).toContain('response-only custom report');
      release(); await c.settle(); expect(shown()[0]).toBe('custom-000'); fx.reportGate = undefined;
      const afterCustom = c.requests.length; click('Next'); await c.settle(); expect(shown()[0]).toBe('custom-050');
      await change('slot', 'merch'); expect(shown()[0]).toBe('custom-merch-000');
      expect(c.requests.slice(afterCustom).filter(r => r.url.includes('/learn/report'))).toEqual([]);
      c.$('report-csv').click(); await c.settle(); expect(blobs).toHaveLength(2); expect(await blobs[1]!.text()).toContain('custom-merch-120'); expect((await blobs[1]!.text()).split('\n')).toHaveLength(243);
      await change('report-date', '2026-09-04'); expect(shown()[0]).toBe('merch-000'); expect(c.text()).not.toContain('response-only custom report');
      fx.reportGate = async (u) => { if (u.searchParams.has('cursor')) await new Promise<void>(r => { release = r; }); };
      click('Next'); await c.settle(); await change('brand', 'other'); release(); await c.settle(); expect(shown()[0]).toBe('merch-000');
      fx.reportGate = async (u) => { if (u.searchParams.has('revision')) await new Promise<void>(r => { release = r; }); };
      c.$('report-csv').click(); await c.settle(); await change('report-date', '2026-09-05'); release(); await c.settle(); expect(blobs).toHaveLength(2);
      fx.reportGate = undefined; await c.signIn('right-password');
      fx.reportGate = async (u) => { if (u.searchParams.has('cursor')) await new Promise<void>(r => { release = r; }); };
      click('Next'); await c.settle(); await (c.w.OperatorSession as { signOut: () => Promise<void> }).signOut(); release(); await c.settle(); expect(shown()).toEqual([]);
      expect(c.$('exploring').textContent).not.toContain('first-position decisions on');
      console.log('W32.05 legacy DOM', JSON.stringify({ union_items: 121, rendered_page_items: 50, full_csv_data_rows: 242, custom_navigation_report_gets: 0 }));
    } finally { c.close(); }
  });

  it('W30.02 renders coverage before the no-grid exit and keeps legacy maturity unknown', async () => {
    const base = { date: '2026-09-03', builtAt: 1_788_000_000_000, counts: { decisions: 0, outcomes: 0, visitors: 0, truncated: false }, policies: [], grids: {}, holdout: {}, exploration: [], hours: { source: 'aggregates', built: [12, 13], missing: [] } };
    const coverage = { version: 1, source: 'aggregates', metadata: 'recorded', maturity: 'unknown', truncated: true, visitorsIncomplete: true, missingHours: [14], truncatedHours: [12], unadvancedHours: [13], unknownHours: [], horizons: [{ hour: 12, horizonMs: 0 }, { hour: 13, horizonMs: 3600_000 }], minHorizonMs: 99 * 3600_000 };
    const known = { ...coverage, missingHours: [] };
    const malformed = { ...coverage, missingHours: [], horizons: [null, {}] };
    for (const detail of [coverage, undefined, known, malformed]) {
      const c = await openConsole({ learn: learnOff, snapshot, report: { ...base, coverage: detail } });
      try {
        const text = c.$('report').textContent || '';
        expect(text).toContain('No decisions for chero'); expect(text).toContain('Outcome maturity: unknown');
        expect(text).not.toMatch(/NaN|undefined|settled|maturity: complete/);
        expect(text).not.toContain('horizon: 99h');
        expect(text).toContain(detail === known ? 'Minimum reported contributing horizon: 0h' : 'Minimum contributing horizon: unknown');
        if (detail) {
          for (const value of ['Truncated hours: 12', 'Ring progress not advanced for hours: 13', 'Visitor coverage is incomplete', 'does not mean every reported credit is wrong']) expect(text).toContain(value);
          if (detail === coverage) expect(text).toContain('Missing hours: 14');
          if (detail !== malformed) expect(text).toContain('12: 0h, 13: 1h');
        } else expect(text).toContain('Coverage metadata absent or invalid');
      } finally { c.close(); }
    }
  });

  it('W28.01 removes the legacy Thompson offer and preserves dormant settings until explicit replacement', async () => {
    const learn = structuredClone(learnOn); learn.slots.chero.exploration.mode = 'thompson';
    const c = await openConsole({ learn, snapshot });
    try {
      await c.signIn('right-password');
      const browser = c.dom.window as unknown as { document: { querySelectorAll: (selector: string) => ArrayLike<{ value: string; textContent: string | null; disabled: boolean; dispatchEvent: (event: unknown) => void }> }; Event: new (type: string, options: object) => unknown };
      expect(Array.from(browser.document.querySelectorAll('select option')).some(option => option.value === 'thompson')).toBe(false);
      expect(c.text()).toContain('Exploration is off by default');
      expect(c.text()).toContain('Stored Thompson — inactive');
      expect(JSON.parse(Array.from(browser.document.querySelectorAll('.dormant-exploration'))[0]!.textContent!)).toEqual(learn.slots.chero.exploration);
      expect(c.saved).toEqual([]);
      const mode = Array.from(browser.document.querySelectorAll('#dials-slot select')).find(select => select.value === '')!;
      expect(mode).toBeDefined(); mode.value = 'off'; mode.dispatchEvent(new browser.Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 450)); await c.settle(); c.$('save').click(); await c.settle();
      expect(c.saved).toHaveLength(1);
      const document = c.saved[0]!.document as typeof learn;
      expect(document.slots.chero).not.toHaveProperty('exploration');
      expect(document.slots.chero.gamma).toBe(learn.slots.chero.gamma);
      expect(document.holdout).toEqual(learn.holdout);
    } finally { c.close(); }
  });

  it('W03.03 retained learning carries selected tenant and current auth through read, validation and write', async () => {
    for (const tenant of ['acme', 'globex']) {
      const c = await openConsole({ learn: learnOn, snapshot }, tenant);
      try {
        await c.signIn('right-password');
        const session = c.w.OperatorSession as { token: () => Promise<string> };
        session.token = async () => 'synthetic-renewed-token';
        const start = c.requests.length;
        const browser = c.dom.window as unknown as { document: { querySelector: (selector: string) => { value: string; dispatchEvent: (event: unknown) => void } }; Event: new (type: string, options: object) => unknown };
        const input = browser.document.querySelector('#dials-slot input');
        input.value = '1'; input.dispatchEvent(new browser.Event('input', { bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 450)); await c.settle();
        c.$('save').click(); await c.settle();
        expect(c.saved).toHaveLength(1);
        expect(c.requests.some(r => r.url === '/auth/login' && r.headers['x-tenant'] === tenant)).toBe(true);
        expect(c.requests.every(r => r.headers['x-tenant'] === tenant)).toBe(true);
        const changed = c.requests.slice(start);
        expect(changed.some(r => r.method === 'POST' && r.url === `/content/learn/validate?scope=${tenant}`)).toBe(true);
        expect(changed.some(r => r.method === 'PUT' && r.url === `/content/learn?scope=${tenant}`)).toBe(true);
        expect(changed.some(r => r.method === 'GET' && r.url === `/content/learn/history?scope=${tenant}`)).toBe(true);
        expect(changed.every(r => r.headers.authorization === 'Bearer synthetic-renewed-token')).toBe(true);
        expect((c.saved[0].document as typeof learnOn).slots.chero.gamma).toBe(1);
      } finally { c.close(); }
    }
  });

  it('W21 legacy report ignores historic inference and derives repeated-credit intensity from raw counts', async () => {
    const report = {
      date: '2026-09-03', builtAt: 1_788_000_000_000,
      counts: { decisions: 1, outcomes: 5, visitors: 1, truncated: true },
      hours: { source: 'aggregates', built: [12], missing: [13] },
      policies: [{ name: 'learning', credits: 5, role: 'learning' }],
      grids: { chero: { learning: snapshot } }, exploration: [],
      holdout: { chero: [
        { arm: 'default', decisions: 0, credited: 2, rate: 0.99 },
        { arm: 'personalized', decisions: 1, credited: 3, rate: 0.99 },
      ] },
      holdoutComparison: { chero: [{ treatment: { arm: 'personalized' }, control: { arm: 'default' }, words: 'UNSUPPORTED HISTORIC CLAIM: target reached with 99% confidence', targets: { standing: 'reached_stretch' } }] },
    };
    const c = await openConsole({ learn: learnOff, snapshot, report });
    try {
      const text = c.$('report').textContent || '';
      expect(text).toContain('Attribution diagnostics');
      expect(text).toContain('Experimental inference is unavailable');
      expect(text).toContain('more than one credit per decision');
      expect(text).toContain('incomplete coverage');
      expect(text).toContain('1 missing hours (13)');
      expect(text).toContain('learning multiplier adjusts ranking scores');
      expect(text).not.toMatch(/UNSUPPORTED|target reached|confidence|0\.99/);
      const rows = Array.from(c.w.document.querySelectorAll('#report tbody tr')).filter((row) => /^(default|personalized)/.test(row.textContent || ''));
      expect(rows.map((row) => Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent))).toEqual([
        ['default', '0', '2', '—'], ['personalized', '1', '3', '3'],
      ]);
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

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
      const heads = Array.from(c.w.document.querySelectorAll('#grid thead th')).map((th) => (th.firstChild?.textContent || '').trim());
      // Witness public/learning.js:327: the learning grid names the defined exposure unit and the weighted credit per exposure
      // (document 35 §5 W26: "defined served/rendered/viewable unit").
      expect(heads).toEqual(['Item', 'Cell', 'Exposures', 'Weighted credit', 'Credit / exposure', 'Baseline', 'Lift', 'Evidence', 'Controls']);
      const syms = Array.from(c.w.document.querySelectorAll('#grid thead th .sym')).map((s) => s.textContent);
      expect(syms).toEqual(['n', 's', 'p̂', 'p₀', 'p̂ / p₀', 'n / (n + n₀)']);
      const first = Array.from(c.w.document.querySelectorAll('#grid tbody tr'))[0]!;
      expect(first.textContent).toContain('CCH-001');
      expect(Array.from(first.querySelectorAll('td')).slice(2, 4).map((td) => td.textContent)).toEqual(['20.816', '1.977']);
      // Witness public/learning.js:323: the caption states the snapshot's measurement
      // basis before the reward (document 35 §5 W26: "defined served/rendered/viewable unit").
      expect(c.$('grid-count').textContent).toContain('2 rows · basis served-v1 (rendered is client-reported) · reward click');
      expect(c.text()).not.toMatch(STRAY);
      // Signing out takes the grid away again and leaves nothing stray.
      c.$('sign-out').click(); await c.settle(); await c.settle();
      expect(c.$('who').textContent).toBe('');
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

  it('every dial on: dormant autonomy, read-only history and preserved manual tuning', async () => {
    const proposals = ['proposed', 'applied', 'rejected'].map(status => ({ id: status, slot: 'chero', dimension: 'line', from: 0.25, to: 0.3, exposures: 900, mode: 'autonomous', status, at: 1_788_000_000_000 }));
    const c = await openConsole({ learn: learnOn, snapshot: { ...snapshot, objective: 'revenue', reward: 'purchase' }, proposals });
    try {
      await c.signIn('right-password');
      const slot = c.$('dials-slot').textContent || '', global = c.$('dials-global').textContent || '';
      for (const label of ['Share', 'Floor', 'Autonomy unavailable', 'Stored settings are dormant']) expect(slot).toContain(label);
      expect(Array.from(c.w.document.querySelectorAll('#dials-slot select option')).some(x => ['assisted', 'autonomous'].includes(x.textContent || ''))).toBe(false);
      expect(JSON.parse(c.$('dials-slot').querySelectorAll('.dormant-autonomy')[0].textContent!)).toEqual(learnOn.slots.chero.autonomy);
      expect(c.$('proposals').textContent).toContain('not a complete audit trail');
      for (const status of ['proposed', 'applied', 'rejected']) expect(c.$('proposals').textContent).toContain('stored status (unverified): ' + status);
      expect(c.$('proposals').querySelectorAll('button')).toHaveLength(0);
      for (const label of ['K, the blend constant', 'Minimum events', 'Ref', 'Budget']) expect(global).toContain(label);
      expect(c.$('grid-count').textContent).toContain('reward purchase weighed by revenue');
      const browser = c.dom.window as unknown as { document: { querySelector: (selector: string) => { value: string; dispatchEvent: (event: unknown) => void } }; Event: new (type: string, options: object) => unknown };
      const trust = browser.document.querySelector('#dials-slot input');
      trust.value = '1'; trust.dispatchEvent(new browser.Event('input', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 450)); await c.settle();
      c.$('save').click(); await c.settle();
      expect(c.saved).toHaveLength(1);
      const saved = c.saved[0].document as typeof learnOn;
      expect(saved.slots.chero.gamma).toBe(1);
      expect(saved.slots.chero.autonomy).toEqual(learnOn.slots.chero.autonomy);
      expect(saved.slots.chero.exploration).toEqual(learnOn.slots.chero.exploration);
      expect(saved.slots.chero.items).toEqual(learnOn.slots.chero.items);
      expect(c.log.some(line => line.startsWith('POST') && /learn\/(proposals|cycle)/.test(line))).toBe(false);
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

  it('an admin sees the Accounts section and creates an account whose temporary password is shown once; an operator sees no such section', async () => {
    const c = await openConsole({ learn: learnOff, snapshot });
    try {
      await c.signIn('right-password');                      // an operator
      expect(c.$('accounts-section').hidden).toBe(true);
      expect(c.$('change-password').hidden).toBe(false);
      c.$('sign-out').click(); await c.settle(); await c.settle();
      c.$('sign-in').click(); await c.settle();
      c.$('si-email').value = 'admin@brand.test'; c.$('si-password').value = 'right-password';
      c.$('sign-in-form').dispatchEvent(new (c.w.window as unknown as { Event: new (t: string, o: object) => unknown }).Event('submit', { bubbles: true, cancelable: true }));
      await c.settle(); await c.settle(); await c.settle();
      expect(c.$('who').textContent).toBe('Signed in as Test Admin');
      expect(c.$('accounts-section').hidden).toBe(false);
      const table = c.$('accounts').textContent || '';
      expect(table).toContain('admin@brand.test'); expect(table).toContain('ops@brand.test'); expect(table).toContain('temporary password, not yet changed');
      c.$('acct-email').value = 'merch@brand.test'; c.$('acct-name').value = 'Merchandiser';
      c.$('account-form').dispatchEvent(new (c.w.window as unknown as { Event: new (t: string, o: object) => unknown }).Event('submit', { bubbles: true, cancelable: true }));
      await c.settle(); await c.settle();
      const note = c.$('account-notice').textContent || '';
      expect(note).toContain('Account created for merch@brand.test');
      expect(note).toContain('Ab3dEf7hJk2mNp4q');
      expect(note).toContain('shown once');
      const audit = c.$('account-audit').textContent || '';
      expect(audit).toContain('created the account'); expect(audit).toContain('signed in');
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

  it('a person on a temporary password is made to choose their own before anything else', async () => {
    const c = await openConsole({ learn: learnOff, snapshot });
    try {
      await c.signIn('temporary-pw-16');
      expect(c.$('who').textContent).toBe('Signed in as Test Operator');
      expect(c.$('password-form').hidden).toBe(false);
      expect(c.$('pw-note').textContent).toBe('You signed in with a temporary password. Choose your own to continue.');
      c.$('pw-cancel').click(); await c.settle();
      expect(c.$('password-form').hidden).toBe(false);            // no way around it
      c.$('pw-current').value = 'temporary-pw-16'; c.$('pw-new').value = 'short';
      c.$('password-form').dispatchEvent(new (c.w.window as unknown as { Event: new (t: string, o: object) => unknown }).Event('submit', { bubbles: true, cancelable: true }));
      await c.settle(); await c.settle();
      expect(c.$('pw-error').textContent).toBe('A password needs at least ten characters.');
      c.$('pw-new').value = 'a fine long password';
      c.$('password-form').dispatchEvent(new (c.w.window as unknown as { Event: new (t: string, o: object) => unknown }).Event('submit', { bubbles: true, cancelable: true }));
      await c.settle(); await c.settle();
      expect(c.$('password-form').hidden).toBe(true);
      expect(c.text()).toContain('Your password is changed.');
      expect(c.text()).not.toMatch(STRAY);
    } finally { c.close(); }
  });

  it('W11.02 password change without replacement credentials signs out and requires fresh authentication', async () => {
    const c = await openConsole({ learn: learnOff, snapshot, passwordNoReplacement: true });
    try {
      await c.signIn('temporary-pw-16');
      c.$('pw-current').value = 'temporary-pw-16'; c.$('pw-new').value = 'a fine long password';
      c.$('password-form').dispatchEvent(new (c.w.window as unknown as { Event: new (t: string, o: object) => unknown }).Event('submit', { bubbles: true, cancelable: true }));
      await c.settle(); await c.settle();
      expect(c.$('password-form').hidden).toBe(true);
      expect(c.text()).toContain('Password changed. Sign in again to continue.');
      expect(c.$('who').textContent).not.toContain('Signed in as Test Operator');
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
it('W11.02 rendered retained learning keeps the same reset intent until publication acknowledgement', async () => {
  const fx: Fixtures = { learn: learnOn, snapshot, resetOutcome: 'unknown' };
  const c = await openConsole(fx);
  const window = c.dom.window as unknown as {
    document: { querySelectorAll(selector: string): ArrayLike<{ textContent: string | null; click(): void }> };
    sessionStorage: { getItem(key: string): string | null };
  };
  try {
    await c.signIn('right-password');
    const click = () => {
      const button = Array.from(window.document.querySelectorAll('button')).find(el => el.textContent === 'Reset');
      expect(button).toBeDefined(); button!.click();
    };
    click(); await c.settle(); expect(c.text()).toContain('Reset completed'); expect(c.text()).toContain('unknown');
    const first = c.requests.find(r => r.url.endsWith('/learn/items/reset'))!;
    expect(first.headers['if-match']).toBe('"2/7/' + 'a'.repeat(64) + '"');
    expect(JSON.parse(window.sessionStorage.getItem('learning-pending-v1')!)).toHaveLength(1);
    c.w.eval(pub('learning.js')); await c.settle();
    fx.resetOutcome = 'acknowledged';
    c.w.eval("window.savedSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(k,v) { if(k==='learning-pending-v1'&&v==='[]') throw new Error('synthetic local failure'); return window.savedSetItem.call(this,k,v); }");
    click(); await c.settle(); expect(JSON.parse(window.sessionStorage.getItem('learning-pending-v1')!)).toHaveLength(1);
    c.w.eval('Storage.prototype.setItem = window.savedSetItem'); click(); await c.settle();
    const attempts = c.requests.filter(r => r.url.endsWith('/learn/items/reset'));
    expect(attempts).toHaveLength(3); expect(attempts[2]!.headers['idempotency-key']).toBe(first.headers['idempotency-key']);
    expect(attempts[1]!.headers['if-match']).toBe(first.headers['if-match']);
    expect(JSON.parse(window.sessionStorage.getItem('learning-pending-v1')!)).toEqual([]);
    fx.publicationConflict = true; click(); await c.settle();
    Array.from(window.document.querySelectorAll('button')).find(el => el.textContent === 'Check status')!.click(); await c.settle();
    const discard = Array.from(window.document.querySelectorAll('button')).find(el => el.textContent === 'Discard conflicted draft');
    expect(discard).toBeDefined(); discard!.click(); await c.settle();
    expect(JSON.parse(window.sessionStorage.getItem('learning-pending-v1')!)).toEqual([]);
  } finally { c.close(); }
});
