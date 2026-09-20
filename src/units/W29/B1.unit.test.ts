// src/units/W29/B1.unit.test.ts
// W29 — autonomy, the local S scope (batch W29-B1).
//
// One `describe('unit:W29.<criterion>.<n>')` per unit, one `it` per ruled leg.
// Every expected value comes from a witness, never from what the code returns
// today:
//   · document 35 §5 row W29 (:431): "Scoped role checks and page identity;
//     current policy/age/pin/step/evidence gates applied transactionally with
//     expected revision. Idempotent proposal/write/receipt recovery and no false
//     'applied' state. Validate noisy/high-cardinality selection and harmful
//     action controls; a current-value read is not CAS." Size: "S disable/guard
//     → M/L full autonomy".
//   · docs/architecture/35-verification-reports/F24.md §5: "if the controls are
//     not built, `assisted` and `autonomous` must be removed from the console —
//     not just defaulted off — and ledger 19 rows 14/15 reported as partly
//     undelivered", and §5's reasons ("Delivery ledger 19 rows 14 and 15 trace
//     'configured AND autonomous modes' and 'tune themselves' to the customer's
//     words, so the audit's conditional is satisfied — the capability is
//     represented as delivered").
//   · F24 §4.8 (the lost update: "`versionedStore.write` has no
//     expected-revision precondition (`:233–:246`)") and F15.md §5 ("a
//     read-before-write helper is not CAS").
//   · docs/architecture/19-tapestry-delivery-ledger.md:36-37 — the customer's own
//     words: row "Per-slot strategies, configured AND autonomous modes" and row
//     "No black box; visibility into weightings; tune themselves".
//   · docs/architecture/22-outcome-learning-design.md §11 (:524-549), including
//     :534-535 (`assisted` proposes, `autonomous` applies) and :548 ("launch
//     every slot in `assisted`").
//   · docs/kit/02-api-reference.md:567 (`GET learn/queue` — "What needs a person,
//     as counts: proposals pending …"), :577 (`POST learn/cycle` unavailable),
//     :578 (`GET learn/proposals` read-only/unverified), :579 (apply|reject
//     unavailable), :606 ("`learn/queue.proposals_pending` counts historical
//     `proposed` statuses, not actionable work").
//   · docs/handover/HANDOFF-2026-09-16.md:233 ("`src/learn/cycle.ts` fails
//     unavailable without I/O; mutation routes … refuse while historical
//     readback remains … An unused pure helper is not delivery") and
//     HANDOFF-2026-09-18.md:325 / §8 D05 (retain-or-withdraw is the owner's).
//
// THE READINGS THIS BATCH RUNS UNDER (ruling R166):
//   (a) MEASURE FIRST. Most of the S scope already exists at the base commit and
//       is LOCKED here, not re-demanded: each locked clause carries the line that
//       would reverse it. What this batch RULES is where the withdrawal is still
//       incomplete.
//   (b) "a current-value read is not CAS". This batch does NOT specify the
//       expected-revision transaction, the policy/age/pin/step gates, the page
//       identity or the idempotent recovery: they are the M/L that follows the
//       owner's decision (D05). It locks that no product path applies a proposal
//       at all, and names the transaction as NOT delivered on the row.
//   (c) the retain-or-withdraw decision, and every gate value if autonomy is
//       retained, is W29.P1.01 — `no-witness`, unclaimed.
//   (d) seams: W11/W15 (versioned configuration — not re-specified), W18 (the
//       operator controls; this file drives the same shipped console modules its
//       jsdom harness drives, against the mounted routes), W20 (pins), W28 (the
//       withdrawal pattern: lock the withdrawal, find where it is incomplete,
//       never re-enable to fill a checkbox), W32. Customer acceptance OPEN.

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import * as jose from 'jose';
import { JSDOM } from 'jsdom';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { invalidateLiftCache } from '@/content/service';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import type { ContentPiece, LearnConfig, SlotCatalog } from '@/content/types';
import { decideProposal, PROPOSALS_KIND, runCycle, type ProposalsDoc } from '@/learn/cycle';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import type { Proposal } from '@/learn/autonomy';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { contentRoutes } from '@/routes/content';
import { decisionRoutes } from '@/routes/decisions';
import { tenantMiddleware } from '@/tenancy/middleware';
import type { Env } from '@/types/env';

// ===========================================================================
// The customer's fixture (tapestry_requirements.txt:564 `occasion_tags`, and
// the Coach lines/categories), carrying the exact shape F24 reproduced: one
// slot name on TWO pages with different current weights (§4.1 cross-page
// bleed), a merchandiser's pin on the dimension (§R1), a stored `autonomous`
// mode, and one retained proposal of each status — including a stored
// `applied` receipt that was never a verified application (§R4).
// ===========================================================================

const TENANT = 'coach';
const BRAND = 'coach';
const SECRET = 'w29-b1-synthetic-operator-signing-material';
const ORIGIN = 'http://console.test';
const DAY_MS = 86_400_000;
/** Fixed, so nothing here depends on the wall clock. */
const T0 = Date.UTC(2026, 8, 1, 3, 0, 0);

const piece = (id: string, over: Partial<ContentPiece>): ContentPiece => ({
  id, customerContentId: `CMS-${id.replace(/^cnt-/, '').toUpperCase()}`, type: 'editorial',
  title: id, tags: {}, slotTypes: ['hero'], lifecycle: { status: 'live' }, ...over,
} as ContentPiece);

const W29_PIECES: ContentPiece[] = [
  piece('cnt-tabby-evening', { title: 'Tabby, after six',
    tags: { line: ['Tabby'], occasion: ['evening'], category: ['Handbags'] } }),
  piece('cnt-rogue-work', { title: 'The Rogue, at work',
    tags: { line: ['Rogue'], occasion: ['work'], category: ['Handbags'] } }),
  // Cross-category and unknown-taxonomy rows are part of the fixture, not an
  // afterthought: a piece on two categories, and one whose only tag is off the
  // registry the slot weights.
  piece('cnt-charms-case', { title: 'Charms, across the case', type: 'lookbook',
    tags: { occasion: ['evening'], category: ['Small Leather Goods', 'Handbags'] } }),
  piece('cnt-unknown-taxonomy', { title: 'An unfiled story',
    tags: { mood: ['quiet'] } }),
];

/**
 * `hero` on `home` and on `category`, with DIFFERENT current weights. F24 §4.1:
 * "`learn.slots[slot].autonomy` … likewise keyed by slot name only, so two pages
 * share one autonomy config"; `validateSlotCatalog` scopes its duplicate check
 * per page (`kinds.ts:214`), "so this configuration is legal and expected".
 */
const W29_SLOTS: SlotCatalog = { version: 'w29-b1-coach-slots', pages: {
  home: [{ slot: 'hero', take: 1, weights: { occasion: 0.9, line: 0.25 } }],
  category: [{ slot: 'hero', take: 1, weights: { occasion: 0.8, line: 0.1 } }],
} } as unknown as SlotCatalog;

/** The stored mode is `autonomous` with `occasion` pinned: dormant configuration, retained. */
const W29_LEARN: LearnConfig = {
  holdout: { share: 0, salt: 'w29-b1', arms: ['default'] },
  slots: { hero: { reward: 'click',
    autonomy: { mode: 'autonomous', step: 0.05, min: 0, max: 1, pinned: ['occasion'], minN: 500 } } },
} as unknown as LearnConfig;

const proposal = (id: string, over: Partial<Proposal>): Proposal => ({
  id, tenant: TENANT, brand: BRAND, slot: 'hero', at: T0 - 30 * DAY_MS, mode: 'autonomous',
  dimension: 'occasion', from: 0.1, to: 0.15, evidence: [], exposures: 15_002, snapshotVersion: 1,
  status: 'proposed', ...over,
} as Proposal);

/** One of each retained status. The `applied` one is F24 R4's false receipt. */
const W29_PROPOSALS: ProposalsDoc = { version: 'w29-b1-proposals', proposals: [
  proposal('coach:hero:m0gcgmio', { evidence: [{ dimension: 'occasion', values: {}, spread: 0.29 }] }),
  proposal('coach:hero:m0gcgmip', { at: T0 - 29 * DAY_MS, from: 0.35, to: 0.4, exposures: 10_000,
    snapshotVersion: 2, status: 'applied', note: 'applied autonomously within bounds' }),
  proposal('coach:hero:m0gcgmiq', { at: T0 - 28 * DAY_MS, mode: 'assisted', dimension: 'line',
    from: 0.25, to: 0.3, exposures: 9_000, snapshotVersion: 3, status: 'rejected' }),
] };

const STORED_STATUSES = ['proposed', 'applied', 'rejected'];

// ===========================================================================
// The mounted application, in process, through the routes production serves.
// Harness pattern reused from `src/units/W22/B1.unit.test.ts` and
// `src/units/W18/B1.unit.test.ts`; neither file is imported or edited.
// ===========================================================================

class UnitKV {
  data = new Map<string, string>();
  calls: string[] = [];
  async get(key: string, type?: string) {
    this.calls.push('CACHE.get:' + key);
    const value = this.data.get(key);
    return value === undefined ? null : type === 'stream' ? new Response(value).body : type === 'json' ? JSON.parse(value) as unknown : value;
  }
  async put(key: string, value: string) { this.calls.push('CACHE.put:' + key); this.data.set(key, value); }
  async delete(key: string) { this.calls.push('CACHE.delete:' + key); this.data.delete(key); }
  async list(options?: { prefix?: string; limit?: number; cursor?: string }) {
    const keys = [...this.data.keys()].filter(k => k.startsWith(options?.prefix ?? '')).sort();
    const start = Number(options?.cursor ?? 0), end = start + (options?.limit ?? 1000);
    return { keys: keys.slice(start, end).map(name => ({ name })), list_complete: end >= keys.length, ...(end < keys.length ? { cursor: String(end) } : {}) };
  }
}

class UnitR2 {
  objects = new Map<string, string>();
  versions = new Map<string, number>();
  calls: string[] = [];
  async get(key: string) {
    this.calls.push('STORAGE.get:' + key);
    const raw = this.objects.get(key); if (raw === undefined) return null;
    const bytes = new TextEncoder().encode(raw);
    return { key, etag: 'v' + this.versions.get(key), size: bytes.length,
      body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } }),
      text: async () => raw, json: async () => JSON.parse(raw) as unknown };
  }
  async head(key: string) { return this.objects.has(key) ? { key } : null; }
  async put(key: string, raw: string, options?: R2PutOptions) {
    this.calls.push('STORAGE.put:' + key);
    const old = this.objects.has(key) ? 'v' + this.versions.get(key) : null, condition = options?.onlyIf;
    const absent = condition instanceof Headers ? condition.get('If-None-Match') === '*' : condition?.etagDoesNotMatch === '*';
    const match = condition instanceof Headers ? condition.get('If-Match') : condition?.etagMatches;
    if ((absent && old !== null) || (match != null && match !== old && match !== JSON.stringify(old))) return null;
    this.objects.set(key, raw); this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length };
  }
  async delete(keys: string | string[]) { for (const key of typeof keys === 'string' ? [keys] : keys) this.objects.delete(key); }
  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
    const names = [...this.objects.keys()].filter(k => k.startsWith(options.prefix ?? '')).sort();
    const start = Number(options.cursor ?? 0), end = start + (options.limit ?? 1000);
    return { objects: names.slice(start, end).map(key => ({ key, size: new TextEncoder().encode(this.objects.get(key) ?? '').length, uploaded: new Date(0) })),
      truncated: end < names.length, ...(end < names.length ? { cursor: String(end) } : {}) };
  }
}

interface Mounted {
  env: Env;
  storage: UnitR2;
  cache: UnitKV;
  operatorToken: string;
  fetch: (request: Request) => Promise<Response>;
  /** Every stored object, as bytes: the byte-for-byte witness of "nothing was written". */
  snapshot: () => string;
}

async function mount(): Promise<Mounted> {
  invalidateCache(); invalidateLiftCache(); invalidatePublicationCache();
  const storage = new UnitR2(), cache = new UnitKV();
  const pending: Promise<unknown>[] = [];
  const env = {
    DEPLOYMENT_PROFILE: 'demo', ENVIRONMENT: 'test', CACHE: cache, SESSIONS: new UnitKV(), STORAGE: storage,
    CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: 'session',
    JWT_SECRET: SECRET, JWT_ISSUER: 'w29b1', JWT_AUDIENCE: 'w29b1',
    IDENTITY_SALT: 'w29-b1-synthetic-audit-salt', IDENTITY_SECRETS: `${TENANT}:w29-b1-identity-material`,
    TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }),
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
    EVENT_QUEUE: { send: async () => { /* no ledger traffic in this batch */ } },
  } as unknown as Env;

  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.route('/content', contentRoutes);
  app.route('/v1', decisionRoutes);

  const operatorToken = await new jose.SignJWT({ sub: 'ops', type: 'service', roles: ['operator', 'admin'] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('w29b1').setAudience('w29b1').setExpirationTime('2h')
    .sign(new TextEncoder().encode(SECRET));

  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = TENANT): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: T0, actor: 'w29-b1-fixture', note: 'fixture', value } });
  await initializePublicationSet(env, [
    baseline(CONTENT_KIND, { version: 'w29-b1-coach-catalogue', pieces: W29_PIECES }),
    baseline(SLOTS_KIND, W29_SLOTS),
    baseline(LEARN_KIND, W29_LEARN),
    baseline(PRIORS_KIND, EMPTY_PRIORS),
    baseline(PROPOSALS_KIND, W29_PROPOSALS),
    baseline(REFLEX_KIND, DEFAULT_REFLEX_CONFIG, reflexScopeForTenant(TENANT)),
  ], '0:' + crypto.randomUUID());
  invalidatePublicationCache();

  const fetchOne = async (request: Request): Promise<Response> => app.fetch(request, env, {
    waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() { /* never */ }, props: {},
  } as unknown as ExecutionContext);

  return { env, storage, cache, operatorToken, fetch: fetchOne, snapshot: () => JSON.stringify([...storage.objects].sort()) };
}

type Answer = { status: number; headers: Headers; body: Record<string, unknown> };

async function operatorCall(m: Mounted, method: 'GET' | 'POST', path: string, token?: string): Promise<Answer> {
  const bearer = token === undefined ? m.operatorToken : token;
  const response = await m.fetch(new Request(ORIGIN + path, {
    method, headers: { ...(bearer === '' ? {} : { Authorization: `Bearer ${bearer}` }), 'X-Tenant': TENANT,
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
    ...(method === 'POST' ? { body: '{}' } : {}),
  }));
  return { status: response.status, headers: response.headers, body: await response.json().catch(() => ({})) as Record<string, unknown> };
}

// ── the shipped documents, read as the customer reads them ─────────────────

const doc = (path: string) => readFileSync(path, 'utf8');
/** The one line of a markdown table whose text carries `needle`. */
const rowWith = (text: string, needle: string): string =>
  text.split('\n').find(line => line.trimStart().startsWith('|') && line.includes(needle)) ?? '';
/** One `## n · …` section of a design document, heading included. */
const section = (text: string, heading: string): string => {
  const lines = text.split('\n');
  const start = lines.findIndex(line => line.startsWith(heading));
  if (start < 0) return '';
  const end = lines.findIndex((line, index) => index > start && /^## /.test(line));
  return lines.slice(start, end < 0 ? lines.length : end).join('\n');
};

/** Every shipped product module: `src/**` without the tests and without this batch's own units. */
function productModules(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir).sort()) {
      const full = `${dir}/${entry}`;
      if (statSync(full).isDirectory()) { if (entry !== 'units') walk(full); continue; }
      if (!full.endsWith('.ts') || full.endsWith('.d.ts') || /\.test\.ts$/.test(full)) continue;
      out.push(full);
    }
  };
  walk('src');
  return out;
}
const modulesNaming = (symbol: string): string[] =>
  productModules().filter(file => new RegExp(`\\b${symbol}\\b`).test(readFileSync(file, 'utf8')));

// ── both shipped operator screens, under jsdom, against the mounted app ────

/**
 * The DOM the shipped screens paint into, typed here because the project
 * compiles against the Workers types with no DOM library (see
 * `src/console/jsdom.d.ts`), the way `src/units/W22/B1.unit.test.ts:534` does.
 */
interface ScreenNode {
  textContent: string | null;
  value?: string;
  querySelectorAll: (selector: string) => ArrayLike<ScreenNode>;
}
interface ScreenWindow extends Record<string, unknown> {
  document: { body: ScreenNode; getElementById: (id: string) => ScreenNode | null; querySelectorAll: (selector: string) => ArrayLike<ScreenNode> };
  localStorage: { setItem: (key: string, value: string) => void };
  eval: (source: string) => unknown;
  close: () => void;
}
interface Screen {
  name: string;
  text: string;
  /** Every `<option>` the screen offers, as `value|label`. */
  options: string[];
  /** Every button label the screen offers. */
  buttons: string[];
  /** The rendered proposal history block of that screen. */
  history: string;
  /** Every button inside the proposal history block. */
  historyButtons: string[];
}

/** The console (`public/console/*.js`) and the retained learning screen (`public/learning.js`). */
async function openScreen(m: Mounted, which: 'console-proposals' | 'console-dials' | 'learning'): Promise<Screen> {
  const page = which === 'learning' ? 'legacy/learning.html' : 'console/index.html';
  const url = which === 'learning'
    ? `${ORIGIN}/legacy/learning.html?scope=${TENANT}&brand=${BRAND}&slot=hero`
    : `${ORIGIN}/console/#/${which === 'console-dials' ? 'dials' : 'proposals'}?scope=${TENANT}&brand=${BRAND}&slot=hero`;
  const dom = new JSDOM(readFileSync(`public/${page}`, 'utf8'), { url, pretendToBeVisual: true, runScripts: 'outside-only' });
  const w = dom.window as unknown as ScreenWindow;
  w.fetch = async (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const target = new URL(input, `${ORIGIN}/`);
    return m.fetch(new Request(ORIGIN + target.pathname + target.search, {
      method: init?.method ?? 'GET', headers: init?.headers ?? {}, ...(init?.body === undefined ? {} : { body: init.body }),
    }));
  };
  w.TextEncoder = TextEncoder;
  w.setInterval = () => 1;
  w.confirm = () => true;
  w.localStorage.setItem('operator-session', JSON.stringify({
    accessToken: m.operatorToken, refreshToken: 'w29-b1-refresh', exp: Date.now() + 3_600_000,
    user: { id: 'ops', name: 'Operator', email: 'ops@brand.test', roles: ['admin'], tenants: [TENANT] }, mustChangePassword: false,
  }));
  const scripts = which === 'learning'
    ? ['operator-session.js', 'learning.js']
    : ['operator-session.js', 'console/shell.js', 'console/views.js', 'console/views-config.js',
      'console/views-measure.js', 'console/views-accounts.js', 'console/views-explore.js'];
  for (const script of scripts) w.eval(readFileSync(`public/${script}`, 'utf8'));
  for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 12));

  const words = (node: ScreenNode | null | undefined) => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const historyNode = which === 'learning' ? w.document.getElementById('proposals') : w.document.getElementById('view');
  const screen: Screen = {
    name: which,
    text: words(w.document.body),
    options: Array.from(w.document.querySelectorAll('option')).map(o => `${o.value ?? ''}|${words(o)}`),
    buttons: Array.from(w.document.querySelectorAll('button')).map(b => words(b)).filter(Boolean),
    history: words(historyNode),
    historyButtons: Array.from(historyNode?.querySelectorAll('button') ?? []).map(b => words(b)).filter(Boolean),
  };
  w.close();
  return screen;
}

// ===========================================================================
// unit:W29.U1.01 — mutation safely unavailable, with no false "applied" state.
// ===========================================================================

describe('unit:W29.U1.01', () => {
  /**
   * LOCKED at the base commit (R166(a)), each with the line that reverses it:
   *   · `src/learn/cycle.ts:49-50` — `runCycle` refuses unconditionally;
   *     `:53-54` — `decideProposal` refuses for BOTH apply and reject;
   *     `:44-46` — the refusal body.
   *   · `src/routes/decisions.ts:423-430`, `:438-446` — the routes answer it 503
   *     behind `operatorJwt()`.
   * RULED HERE: nothing. Both clauses of this leg are GREEN-AT-SPEC and are held
   * as the regression guard for the batch (W28's withdrawal pattern, R160).
   */
  it('logic: the exported cycle and proposal decisions refuse before any binding access, and no product path applies a proposal at all', async () => {
    const touched: string[] = [];
    const refuse = (kind: string) => { touched.push(kind); throw new Error('unexpected environment access'); };
    const env = new Proxy({} as Env, {
      get: (_t, key) => refuse(String(key)), has: (_t, key) => refuse(String(key)),
      ownKeys: () => refuse('enumerate'), getOwnPropertyDescriptor: (_t, key) => refuse(String(key)),
    });

    const answers = await Promise.all([
      runCycle(env, TENANT, BRAND, T0, 'cron'),
      decideProposal(env, TENANT, 'coach:hero:m0gcgmio', 'apply', 'ops', T0),
      decideProposal(env, TENANT, 'coach:hero:m0gcgmio', 'reject', 'ops', T0),
    ]);
    for (const answer of answers) {
      expect({ ok: answer.ok, code: answer.code },
        'W29.U1.01 (locked, F24 §6 / HANDOFF-2026-09-16:233) — the cycle and both proposal decisions refuse')
        .toEqual({ ok: false, code: 'autonomy_unavailable' });
      expect(answer.error.toLowerCase(), 'and the refusal says it is unavailable').toContain('unavailable');
    }
    expect(touched,
      'W29.U1.01 (locked) — the refusal reads no binding, no configuration and no proposal: "fails unavailable without I/O" (HANDOFF-2026-09-16:233)')
      .toEqual([]);

    // "No product path applies a proposal": the shipped product names the four
    // autonomy entry points in exactly these modules, and the only two request
    // paths that reach a mutator are the two withdrawn routes asserted below.
    expect({
      applyProposal: modulesNaming('applyProposal'),
      proposeFor: modulesNaming('proposeFor'),
      runCycle: modulesNaming('runCycle'),
      decideProposal: modulesNaming('decideProposal'),
    }, 'W29.U1.01 (locked, F24 §4.9 + HANDOFF-2026-09-16:233 "an unused pure helper is not delivery") — `applyProposal` and `proposeFor` are pure helpers no shipped path calls; `runCycle`/`decideProposal` are reached only from the withdrawn routes, and the scheduled entry `src/index.ts` names none of them (its tenant list is `tenantConfig(env).provisioned`, W37.02)')
      .toEqual({
        applyProposal: ['src/learn/autonomy.ts'],
        proposeFor: ['src/learn/autonomy.ts'],
        runCycle: ['src/learn/cycle.ts', 'src/routes/decisions.ts'],
        decideProposal: ['src/learn/cycle.ts', 'src/routes/decisions.ts'],
      });
  });

  /**
   * LOCKED: the 401 gate, the two 503 refusals, and the stored bytes.
   * RULED (the incompleteness this unit closes): the operator work queue — "the
   * landing page of an operator application" (kit 02:567) — still answers a bare
   * `proposals_pending`, so the one number a person is shown on the landing page
   * asks for an action the platform will refuse, and the two statuses it leaves
   * out of that count read as decided applications. The kit already publishes the
   * meaning at :606 ("counts historical `proposed` statuses, not actionable
   * work"); the ANSWER does not carry it. Ruled member: `autonomy` on the
   * `GET /v1/:tenant/learn/queue` answer, `{ mutationAvailable: false,
   * proposalStatusesVerified: false }`, beside `enrollment_anchor_unavailable`
   * at the route — NOT inside `queueOf`, whose pure output is locked key-for-key
   * by `src/learn/queue.test.ts:24`.
   */
  it('host: the cycle and the proposal decisions refuse behind the operator gate with the stored proposals byte-unchanged, and the work queue names the pending count as work no operator can act on', async () => {
    const m = await mount();
    const before = m.snapshot();

    for (const [method, path] of [['POST', 'learn/cycle'], ['POST', 'learn/proposals/coach:hero:m0gcgmio/apply'],
      ['POST', 'learn/proposals/coach:hero:m0gcgmio/reject'], ['GET', 'learn/proposals'], ['GET', 'learn/queue']] as const) {
      const anonymous = await operatorCall(m, method, `/v1/${TENANT}/${path}`, '');
      expect(anonymous.status, `W29.U1.01 (locked, document 35 §5 row W29 "scoped role checks") — ${method} ${path} is behind the operator gate`).toBe(401);
    }

    for (const path of ['learn/cycle', 'learn/proposals/coach:hero:m0gcgmio/apply',
      'learn/proposals/coach:hero:m0gcgmio/reject', 'learn/proposals/never-stored/apply']) {
      const refused = await operatorCall(m, 'POST', `/v1/${TENANT}/${path}`);
      expect({ status: refused.status, ok: refused.body.ok, code: refused.body.code, cacheControl: refused.headers.get('cache-control') },
        `W29.U1.01 (locked, kit 02:577 and :579) — an authenticated operator asking ${path} is refused, not served a mutation`)
        .toEqual({ status: 503, ok: false, code: 'autonomy_unavailable', cacheControl: 'no-store' });
    }

    expect(m.snapshot(),
      'W29.U1.01 (locked, F24 R4 "the durable receipt says applied; the weights never moved") — the refusals wrote nothing at all: every stored object is byte-for-byte what it was')
      .toBe(before);

    const history = await operatorCall(m, 'GET', `/v1/${TENANT}/learn/proposals`);
    expect((history.body.proposals as Proposal[]).map(p => p.status),
      'W29.U1.01 (locked) — and each retained proposal still carries the status it was stored with: no decision added, changed or invented an `applied` receipt')
      .toEqual(STORED_STATUSES);

    const queue = await operatorCall(m, 'GET', `/v1/${TENANT}/learn/queue?brand=${BRAND}`);
    expect({ status: queue.status, pending: queue.body.proposals_pending },
      'the work queue answers, and one retained proposal is still `proposed`').toEqual({ status: 200, pending: 1 });
    expect(queue.body.autonomy,
      'W29.U1.01 — RULED: the work queue is "what needs a person, as counts … the landing page of an operator application" (kit 02:567), so its `proposals_pending` must not stand alone while every apply and reject is refused 503. The answer itself carries `autonomy: { mutationAvailable: false, proposalStatusesVerified: false }` — the count is historical (kit 02:606) and the statuses it excludes are not verified applications (F24 §5, R4, "no false applied state")')
      .toEqual({ mutationAvailable: false, proposalStatusesVerified: false });
  });
});

// ===========================================================================
// unit:W29.R1.01 — historical readback honest, and the withdrawal REPORTED.
// ===========================================================================

describe('unit:W29.R1.01', () => {
  /**
   * LOCKED: doc 22 §11:526 and §12.2:589 state the withdrawal; kit 02:577/:578/
   * :579 report the three routes; kit 02:606 states the dormant configuration
   * and the historical count.
   * RULED: (A) delivery ledger 19's own rows — the customer's words "configured
   * AND autonomous modes" and "tune themselves" — report the capability as
   * PARTLY UNDELIVERED, which is the second half of F24 §5's condition and the
   * only half not done ("`assisted` and `autonomous` must be removed from the
   * console — not just defaulted off — AND ledger 19 rows 14/15 reported as
   * partly undelivered"). (B) the kit's own `GET learn/queue` row publishes the
   * member `autonomy.mutationAvailable` that W29.U1.01 rules on that answer, so
   * the contract and the answer say one thing.
   */
  it('logic: the published documents report autonomy as undelivered — the routes, the design section, the customer delivery ledger rows and the work queue contract', () => {
    const kit = doc('docs/kit/02-api-reference.md');
    const design = doc('docs/architecture/22-outcome-learning-design.md');
    const ledger = doc('docs/architecture/19-tapestry-delivery-ledger.md');

    // ── locked ───────────────────────────────────────────────────────────────
    for (const [route, needle] of [['POST learn/cycle', 'learn/cycle['], ['apply|reject', 'learn/proposals/{id}/apply']] as const) {
      expect(rowWith(kit, needle).toLowerCase(),
        `W29.R1.01 (locked, kit 02:577/:579) — the published contract for ${route} says it is unavailable`).toContain('unavailable');
    }
    expect(rowWith(kit, 'GET learn/proposals').toLowerCase(),
      'W29.R1.01 (locked, kit 02:578) — and the retained history is published as read-only and unverified')
      .toMatch(/read-only|unverified/);
    const autonomySection = section(design, '## 11 · Autonomy per slot');
    expect(autonomySection.toLowerCase(),
      'W29.R1.01 (locked, doc 22 §11:526) — the design section that defines `assisted` and `autonomous` states that they are withdrawn and are an open delivery requirement, not an enabled capability')
      .toMatch(/withdrawn[\s\S]*open delivery requirement/);

    // ── ruled (A): the customer's own delivery ledger rows ───────────────────
    for (const call of ['configured AND autonomous modes', 'tune themselves']) {
      const row = rowWith(ledger, call);
      expect(row.length,
        `W29.R1.01 — the delivery ledger still carries the customer's call "${call}" (docs/architecture/19-tapestry-delivery-ledger.md:36-37)`).toBeGreaterThan(0);
      expect(row.toLowerCase(),
        `W29.R1.01 — RULED: F24 §5 makes it the condition of leaving the controls unbuilt that "ledger 19 rows 14/15 [are] reported as partly undelivered". The console half is done; this row still traces the customer's words "${call}" to a build item with no delivery statement at all, so the capability still reads as delivered. The row must report it PARTLY UNDELIVERED and name the W29 withdrawal. It reads: ${row.trim()}`)
        .toMatch(/part(ly|ially) undelivered/);
      expect(row,
        `W29.R1.01 — and the same row names the withdrawal the reader must go to (W29), so "partly undelivered" is not an unexplained word. It reads: ${row.trim()}`)
        .toMatch(/W29/);
    }

    // ── ruled (B): the work queue's published contract ───────────────────────
    const queueRow = rowWith(kit, 'GET learn/queue');
    expect(queueRow.length, 'the kit publishes a `GET learn/queue` row (kit 02:567)').toBeGreaterThan(0);
    expect(queueRow,
      `W29.R1.01 — RULED: the published row for the operator application's landing page says "What needs a person, as counts: proposals pending" and names no availability. It must publish the answer's own \`autonomy.mutationAvailable\` member (W29.U1.01) so the contract and the answer agree that the pending proposals are historical and no apply or reject is available. It reads: ${queueRow.trim()}`)
      .toMatch(/mutationAvailable/);
    expect(queueRow.toLowerCase(),
      `W29.R1.01 — and the same row says the pending count is historical (kit 02:606 already states it, three hundred lines away from the row a reader of the route reads). It reads: ${queueRow.trim()}`)
      .toMatch(/historical/);
  });

  /**
   * LOCKED (F24 §5's first half, measured on both shipped screens against the
   * MOUNTED routes rather than a fake server): the history is shown, every
   * stored status is shown as unverified, no screen offers `assisted` or
   * `autonomous`, and neither offers an apply or a reject.
   * Reversing lines: `public/console/views.js:520-543` and `:300`, `:315`;
   * `public/learning.js:447-458` and `:526-528`.
   */
  it('sdk: both shipped operator screens show the retained history and offer no assisted/autonomous mode and no apply or reject', async () => {
    const m = await mount();
    const screens = await Promise.all([
      openScreen(m, 'console-proposals'), openScreen(m, 'console-dials'), openScreen(m, 'learning'),
    ]);
    const [proposalsScreen, , learningScreen] = screens;

    for (const screen of [proposalsScreen!, learningScreen!]) {
      expect(W29_PROPOSALS.proposals.filter(p => screen.history.includes(p.dimension) && screen.history.includes(String(p.to))).map(p => p.id),
        `W29.R1.01 (locked, kit 02:578) — ${screen.name} still SHOWS every retained record, each with the move it proposed: "Historical proposals remain readable" (src/learn/cycle.ts:3-4). It rendered: ${screen.history.slice(0, 300)}`)
        .toEqual(W29_PROPOSALS.proposals.map(p => p.id));
      for (const status of STORED_STATUSES) {
        expect(screen.history.toLowerCase(),
          `W29.R1.01 (locked) — and ${screen.name} shows the stored ${status} record as an UNVERIFIED stored status, never as a receipt (F24 R4). It rendered: ${screen.history.slice(0, 300)}`)
          .toContain(status);
      }
      expect(screen.history.toLowerCase(),
        `W29.R1.01 (locked) — and says so in words. ${screen.name} rendered: ${screen.history.slice(0, 300)}`)
        .toMatch(/unverified/);
      expect(screen.historyButtons,
        `W29.R1.01 (locked, F24 §5) — and ${screen.name} offers the operator no control on a proposal: an apply or a reject next to a refused route is "the worst of the three options"`)
        .toEqual([]);
    }

    for (const screen of screens) {
      expect(screen!.options.filter(option => /assisted|autonomous/i.test(option)),
        `W29.R1.01 (locked, F24 §5: "must be removed from the console — not just defaulted off") — ${screen!.name} offers no autonomy mode to select`)
        .toEqual([]);
      expect(screen!.buttons.filter(label => /^(apply|reject)\b/i.test(label)),
        `W29.R1.01 (locked) — and ${screen!.name} offers no apply or reject control anywhere on the page`)
        .toEqual([]);
    }

    expect(screens[1]!.text.toLowerCase(),
      'W29.R1.01 (locked, public/console/views.js:425-426) — the dials screen still shows the merchandiser her stored autonomy settings, and says they are dormant rather than deleting them')
      .toMatch(/dormant|unavailable/);
  });
});
