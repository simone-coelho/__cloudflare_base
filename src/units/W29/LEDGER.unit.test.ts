// src/units/W29/LEDGER.unit.test.ts
// W29 — the Closure Ledger acceptance tests for the criteria of the frozen work
// order that the W29-B1 units do not already prove: R2 and R3 (LANE-LOG R176,
// the later W29 unit). U1 and R1 are proven by `src/units/W29/B1.unit.test.ts`
// and are not restated here.
//
// One `describe('unit:W29.<criterion>')` per criterion, one `it` per leg.
//
// WITNESSES
//   · document 35 §5 row W29 (:431): "… Idempotent proposal/write/receipt
//     recovery and no false 'applied' state … a current-value read is not CAS."
//   · docs/handover/HANDOFF-2026-09-16.md:233 — "`src/learn/cycle.ts` fails
//     unavailable without I/O; mutation routes … refuse while historical
//     readback remains".
//   · wrangler.toml:229 — `crons = ["*/5 * * * *", "0 * * * *", "0 3 * * *"]`,
//     whose comment still names "the autonomy cycle" among the 03:00 jobs.
//   · the W29-B1 build review (`_evidence/W29-B1/reviewer-build/REPORT.md`):
//     "the cron clause carried only by the module-set assertion — a
//     `native`/Miniflare leg over the three crons asserting no
//     `proposals:config:*`/`slots:config:*` write (R171(2))", and finding 2,
//     "`src/routes/decisions.ts:457` still stamps `history.mutationAvailable:
//     false` independently of `AUTONOMY_WITHDRAWN` at `:122`; no test locks the
//     two equal". LANE-LOG R176 routes both here.
//
// ONE REPRESENTATION with W29-B1: the same Coach catalogue (with its
// cross-category and unknown-taxonomy pieces), the same two placements with
// different current weights, the stored `autonomous` mode with `occasion`
// pinned, and one retained proposal of each status — including the stored
// `applied` receipt that was never a verified application (F24 R4).

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import * as jose from 'jose';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { invalidateLiftCache } from '@/content/service';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import type { ContentPiece, LearnConfig, SlotCatalog } from '@/content/types';
import { PROPOSALS_KIND, type ProposalsDoc } from '@/learn/cycle';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import type { Proposal } from '@/learn/autonomy';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { contentRoutes } from '@/routes/content';
import { decisionRoutes } from '@/routes/decisions';
import { tenantMiddleware } from '@/tenancy/middleware';
import { RETENTION_CATEGORIES } from '@/retention';
import type { Env } from '@/types/env';
import { bundleNativeWorker, CHECKOUT_ROOT, nativeScratchDirectory, openNativeRuntime, type NativeRuntime } from '../_native';

// ===========================================================================
// The customer's fixture — W29-B1's, unchanged.
// ===========================================================================

const TENANT = 'coach';
const BRAND = 'coach';
const DAY_MS = 86_400_000;
const T0 = Date.UTC(2026, 8, 1, 3, 0, 0);

const piece = (id: string, over: Partial<ContentPiece>): ContentPiece => ({
  id, customerContentId: `CMS-${id.replace(/^cnt-/, '').toUpperCase()}`, type: 'editorial',
  title: id, tags: {}, slotTypes: ['hero', 'category-hero'], lifecycle: { status: 'live' }, ...over,
} as ContentPiece);

const W29_PIECES: ContentPiece[] = [
  piece('cnt-tabby-evening', { title: 'Tabby, after six', tags: { line: ['Tabby'], occasion: ['evening'], category: ['Handbags'] } }),
  piece('cnt-rogue-work', { title: 'The Rogue, at work', tags: { line: ['Rogue'], occasion: ['work'], category: ['Handbags'] } }),
  piece('cnt-charms-case', { title: 'Charms, across the case', type: 'lookbook',
    tags: { occasion: ['evening'], category: ['Small Leather Goods', 'Handbags'] } }),
  piece('cnt-unknown-taxonomy', { title: 'An unfiled story', tags: { mood: ['quiet'] } }),
];
const W29_SLOTS: SlotCatalog = { version: 'w29-b1-coach-slots', pages: {
  home: [{ slot: 'hero', take: 1, weights: { occasion: 0.9, line: 0.25 } }],
  category: [{ slot: 'category-hero', take: 1, weights: { occasion: 0.8, line: 0.1 } }],
} } as unknown as SlotCatalog;
/** The stored mode is `autonomous` with `occasion` pinned: dormant configuration, retained. */
const W29_LEARN: LearnConfig = {
  holdout: { share: 0, salt: 'w29-b1', arms: ['default'] },
  slots: { hero: { reward: 'click', autonomy: { mode: 'autonomous', step: 0.05, min: 0, max: 1, pinned: ['occasion'], minN: 500 } } },
} as unknown as LearnConfig;
const proposal = (id: string, over: Partial<Proposal>): Proposal => ({
  id, tenant: TENANT, brand: BRAND, slot: 'hero', at: T0 - 30 * DAY_MS, mode: 'autonomous',
  dimension: 'occasion', from: 0.1, to: 0.15, evidence: [], exposures: 15_002, snapshotVersion: 1,
  status: 'proposed', ...over,
} as Proposal);
const W29_PROPOSALS: ProposalsDoc = { version: 'w29-b1-proposals', proposals: [
  proposal('coach:hero:m0gcgmio', { evidence: [{ dimension: 'occasion', values: {}, spread: 0.29 }] }),
  proposal('coach:hero:m0gcgmip', { at: T0 - 29 * DAY_MS, from: 0.35, to: 0.4, exposures: 10_000,
    snapshotVersion: 2, status: 'applied', note: 'applied autonomously within bounds' }),
  proposal('coach:hero:m0gcgmiq', { at: T0 - 28 * DAY_MS, mode: 'assisted', dimension: 'line',
    from: 0.25, to: 0.3, exposures: 9_000, snapshotVersion: 3, status: 'rejected' }),
] };

const fixturePolicy = { id: 'w29-ledger-fixture-policy', revision: 1, durationMs: 365 * DAY_MS, basis: 'admitted', renewal: 'new-record-only' };
const RETENTION = JSON.stringify({ version: 1, tenants: { [TENANT]: Object.fromEntries(RETENTION_CATEGORIES.map(category => [category, fixturePolicy])) } });

// ===========================================================================
// unit:W29.R2 — the scheduled handler, run natively in workerd, never mutates
// what autonomy would mutate.
//
// The three crons the Worker declares run through the REAL `scheduled` export of
// `src/index.ts`, bundled and executed by workerd (Miniflare) over real KV, R2
// and SQLite-backed Durable Objects — the harness of
// `src/index.api-boundary.test.ts`, shared in `src/units/_native.ts`. The tenant
// holds everything an autonomy cycle acts on: a stored `autonomous` mode, the
// slot weights it would move, and a retained `proposed` proposal it would apply.
// What autonomy mutates is configuration: the slots, learn and proposals
// documents, whose committed bytes live in the tenant's publication — the
// member revisions under `config-publication/v1/<tenant>/…` and the publication
// set that commits them under `config-publication/v2/<tenant>/…` (W11) — with
// any `<kind>:config:*` KV entry beside them. The unit takes the exact bytes of
// every configuration-publication object and configuration KV entry before,
// and after each cron. The crons' own work (monitor, hourly fold, day report, trend
// rollup, erasure rewrite) writes elsewhere and is not constrained here.
//
// CONTROL, in the same runtime: a real publication write of a changed slot
// document is SEEN by the same detector, so the equality above is not vacuous.
// ===========================================================================

const NATIVE_WRAPPER = `
import worker, { ShopperReflex, PersonalizationWebSocket, DecisionRing, LearnStats, RegionTrend } from './src/index.ts';
import { initializePublicationSet, readPublication } from './src/config/publication.ts';
import { write } from './src/config/versionedStore.ts';
import { REFLEX_KIND, reflexScopeForTenant } from './src/reflex/configStore.ts';
import { CONTENT_KIND, SLOTS_KIND, LEARN_KIND } from './src/content/kinds.ts';
import { PRIORS_KIND } from './src/learn/priors.ts';
import { PROPOSALS_KIND } from './src/learn/cycle.ts';
export { ShopperReflex, PersonalizationWebSocket, DecisionRing, LearnStats, RegionTrend };
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.hostname !== 'w29-fixture') return worker.fetch(request, env, ctx);
    const input = request.method === 'POST' ? await request.json() : {};
    if (url.pathname === '/publish') {
      const revision = value => ({ revision: 1, at: 1, actor: 'w29-ledger-native', note: 'fixture', value });
      await initializePublicationSet(env, [
        { kind: CONTENT_KIND, scope: input.tenant, revision: revision(input.content) },
        { kind: SLOTS_KIND, scope: input.tenant, revision: revision(input.slots) },
        { kind: LEARN_KIND, scope: input.tenant, revision: revision(input.learn) },
        { kind: PRIORS_KIND, scope: input.tenant, revision: revision(input.priors) },
        { kind: PROPOSALS_KIND, scope: input.tenant, revision: revision(input.proposals) },
        { kind: REFLEX_KIND, scope: reflexScopeForTenant(input.tenant), revision: revision(input.reflex) },
      ], '0:' + crypto.randomUUID());
      return Response.json({ published: true });
    }
    if (url.pathname === '/state') {
      // Every configuration-publication byte (the member revisions and the publication set that commits them), and every configuration KV entry.
      const objects = {}, kv = {}, outside = [];
      let cursor;
      do {
        const page = await env.STORAGE.list({ cursor, limit: 1000 });
        for (const o of page.objects) {
          if (o.key.startsWith('config-publication/')) objects[o.key] = await (await env.STORAGE.get(o.key)).text();
          else outside.push(o.key);
        }
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      let kvCursor;
      do {
        const page = await env.CACHE.list({ cursor: kvCursor });
        for (const k of page.keys) if (k.name.includes(':config:')) kv[k.name] = await env.CACHE.get(k.name);
        kvCursor = page.list_complete ? undefined : page.cursor;
      } while (kvCursor);
      return Response.json({ objects, kv, outside: outside.sort() });
    }
    if (url.pathname === '/scheduled') {
      // The real handler, as the platform invokes it, with every job it hands to waitUntil awaited.
      const pending = [];
      await worker.scheduled({ cron: input.cron, scheduledTime: Date.now(), noRetry() {} }, env,
        { waitUntil(promise) { pending.push(Promise.resolve(promise)); }, passThroughOnException() {} });
      let rejected = 0;
      for (let index = 0; index < pending.length; index++) { try { await pending[index]; } catch { rejected++; } }
      return Response.json({ jobs: pending.length, rejected });
    }
    if (url.pathname === '/control') {
      // What the withdrawn cycle did to a slot: a real, preconditioned publication write of new weights.
      const base = await readPublication(env, SLOTS_KIND, input.tenant);
      const result = await write(env, SLOTS_KIND, input.tenant, input.slots, { actor: 'w29-ledger-control', note: 'control',
        expectedRevision: base.revision, expectedPublication: base.publication, operationId: base.revision + ':' + crypto.randomUUID() });
      return Response.json({ ok: result.ok, revision: result.revision ?? null });
    }
    return new Response(null, { status: 404 });
  },
};
`;

const CRONS = ['*/5 * * * *', '0 * * * *', '0 3 * * *'] as const;

describe('unit:W29.R2', () => {
  it('native: in workerd, each of the three crons runs its jobs through the real scheduled handler and leaves the slots, learn and proposals configuration byte-for-byte as it found it', async () => {
    // The Worker's own cron table, read from the tree this test lives in.
    const wrangler = readFileSync(new URL('../../../wrangler.toml', import.meta.url), 'utf8');
    expect(wrangler, 'the crons this unit runs are the ones the Worker declares').toContain('crons = ["*/5 * * * *", "0 * * * *", "0 3 * * *"]');

    const bundle = await bundleNativeWorker(NATIVE_WRAPPER, 'w29-ledger-native');
    const directory = nativeScratchDirectory('w29-ledger-native-');
    const runtime: NativeRuntime = await openNativeRuntime({
      bundle, name: 'w29ledger', persistDir: directory.path,
      durableObjects: { SHOPPER_REFLEX: 'ShopperReflex', PERSONALIZATION_WEBSOCKET: 'PersonalizationWebSocket',
        DECISION_RING: 'DecisionRing', LEARN_STATS: 'LearnStats', REGION_TREND: 'RegionTrend' },
      kvNamespaces: ['CACHE', 'SESSIONS'], r2Buckets: ['STORAGE'],
      bindings: { DEPLOYMENT_PROFILE: 'demo', REFLEX_HOST: 'do', CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock',
        JWT_SECRET: 'w29-ledger-native-synthetic-signing-material-only', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a',
        IDENTITY_SECRETS: `${TENANT}:w29-ledger-native-identity-material`,
        TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }), RETENTION },
    });
    try {
      const door = async (path: string, body?: unknown) => {
        const response = await runtime.fetch(`https://w29-fixture${path}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) });
        expect(response.status, `fixture door ${path}`).toBe(200);
        return await response.json() as Record<string, unknown>;
      };
      type State = { objects: Record<string, string>; kv: Record<string, string>; outside: string[] };
      const state = async () => await door('/state', { tenant: TENANT }) as unknown as State;

      await door('/publish', { tenant: TENANT, content: { version: 'w29-b1-coach-catalogue', pieces: W29_PIECES }, slots: W29_SLOTS,
        learn: W29_LEARN, priors: EMPTY_PRIORS, proposals: W29_PROPOSALS, reflex: DEFAULT_REFLEX_CONFIG });
      // R10 (P105, R-P644 (1)): the five-minute run moves the tenant's audiences into its publication once (P105 AL4),
      // one set publication whose only new member is the audiences member, every other ref and object unchanged;
      // the detector below then runs from that state, unchanged, for all three crons (the five-minute run again included).
      const unmoved = await state();
      await door('/scheduled', { cron: '*/5 * * * *' });
      const movedOnce = await state();
      const setOf = (s: State, n: number) => JSON.parse(s.objects[`config-publication/v2/${TENANT}/set/${n}.json`] ?? 'null') as { refs: Record<string, unknown> } | null;
      expect(Object.keys(movedOnce.objects).filter(key => !(key in unmoved.objects)).sort(), 'R10 (P105): the first five-minute run adds one set and the audiences member only')
        .toEqual([`config-publication/v1/${TENANT}/audiences/rev/1.json`, `config-publication/v2/${TENANT}/set/2.json`]);
      const { [`audiences:${TENANT}`]: audiences, ...others } = setOf(movedOnce, 2)?.refs ?? {};
      expect([audiences !== undefined, others], 'R10 (P105): every other member of the moved set is the unmoved set\'s').toEqual([true, setOf(unmoved, 1)?.refs]);
      // R10 (P105, R-P696): the move's commit rewrites the tenant's serving copy (P102, publication.ts writeServingCopy),
      // so the copy is excepted here and must be the committed head's: its set the head's committed set, by identity and bytes.
      const servingCopy = `config-publication/v2/${TENANT}/serving.json`;
      expect(Object.keys(unmoved.objects).filter(key => !key.endsWith('/head.json') && key !== servingCopy).every(key => movedOnce.objects[key] === unmoved.objects[key]), 'R10 (P105): no other object changed').toBe(true);
      const committed = (JSON.parse(movedOnce.objects[`config-publication/v2/${TENANT}/head.json`] ?? 'null') as { committed?: { revision: number; digest: string } | null } | null)?.committed ?? null;
      const copied = (JSON.parse(movedOnce.objects[servingCopy] ?? 'null') as { set?: { revision?: unknown; digest?: unknown } } | null)?.set ?? null;
      expect({ identity: copied ? { revision: copied.revision, digest: copied.digest } : 'no serving copy', set: copied },
        'R10 (P105, R-P696): the serving copy the move wrote is the committed head\'s (its set the committed set)')
        .toEqual({ identity: committed ?? 'no committed head', set: committed ? setOf(movedOnce, committed.revision) : 'no committed head' });
      const before = movedOnce;
      // The detector holds what autonomy acts on: the slots, learn and proposals members of the publication.
      expect(Object.keys(before.objects).some(key => key.startsWith(`config-publication/v2/${TENANT}/`)), 'the publication set is under the detector').toBe(true);
      for (const member of ['slots', 'learn', 'proposals']) {
        expect(Object.keys(before.objects).some(key => key.startsWith(`config-publication/v1/${TENANT}/${member}/`)),
          `the committed ${member} document is under the detector`).toBe(true);
      }
      expect(Object.values(before.objects).some(text => text.includes('"autonomous"') && text.includes('"occasion"')),
        'the stored autonomous mode with its pin is among the detected bytes').toBe(true);
      expect(Object.values(before.objects).some(text => text.includes('coach:hero:m0gcgmio') && text.includes('"proposed"')),
        'the retained proposed proposal a cycle would apply is among the detected bytes').toBe(true);

      for (const cron of CRONS) {
        const run = await door('/scheduled', { cron });
        expect(run.jobs as number, `${cron}: the real scheduled handler handed its jobs to the runtime`).toBeGreaterThan(0);
        const after = await state();
        expect({ objects: after.objects, kv: after.kv },
          `W29.R2 — ${cron}: the cron must never mutate autonomy's configuration (slots, learn, proposals) in workerd`)
          .toEqual({ objects: before.objects, kv: before.kv });
      }
      expect(runtime.outboundAttempts(), 'no job reached the network').toBe(0);

      // CONTROL: a real publication write of moved weights is seen by the same detector.
      const moved = structuredClone(W29_SLOTS) as unknown as { pages: Record<string, Array<{ weights: Record<string, number> }>> };
      moved.pages.home![0]!.weights.line = 0.3;
      const control = await door('/control', { tenant: TENANT, slots: moved });
      expect(control.ok, 'the control write commits').toBe(true);
      const written = await state();
      expect(Object.keys(written.objects).filter(key => !(key in before.objects)).some(key => key.startsWith(`config-publication/v1/${TENANT}/slots/`)),
        'the detector sees a new committed slots revision after a real write').toBe(true);
    } finally {
      await runtime.dispose();
      directory.remove();
    }
  }, 240_000);
});

// ===========================================================================
// unit:W29.R3 — the withdrawal is stated by one literal.
//
// `src/routes/decisions.ts:122` states the withdrawal once, as
// `AUTONOMY_WITHDRAWN = { mutationAvailable: false, … }`, which the work queue
// answers; the proposals history (`:471` at this base, `:457` when R176 named
// it) states the same fact with a second, independent literal
// `mutationAvailable: false`. Two literals for one fact can part: the build
// review's finding 2, "no test locks the two equal". THE RULE, measured on the
// shipped product sources: the statement `mutationAvailable: false` is written
// exactly once, and both answers carry the value it states. The queue's exact
// `autonomy` member stays as W29.U1.01 locks it (`src/units/W29/B1.unit.test.ts:494`).
// ===========================================================================

const SECRET = 'w29-ledger-synthetic-operator-signing-material';
const ORIGIN = 'http://console.test';

async function mount() {
  invalidateCache(); invalidateLiftCache(); invalidatePublicationCache();
  const objects = new Map<string, string>(), versions = new Map<string, number>();
  const storage = {
    async get(key: string) { const raw = objects.get(key); if (raw === undefined) return null;
      return { key, etag: 'v' + versions.get(key), size: new TextEncoder().encode(raw).length, body: new Response(raw).body, text: async () => raw, json: async () => JSON.parse(raw) as unknown }; },
    async head(key: string) { return objects.has(key) ? { key } : null; },
    async put(key: string, raw: string, options?: R2PutOptions) {
      const old = objects.has(key) ? 'v' + versions.get(key) : null, condition = options?.onlyIf;
      const absent = condition instanceof Headers ? condition.get('If-None-Match') === '*' : condition?.etagDoesNotMatch === '*';
      const match = condition instanceof Headers ? condition.get('If-Match') : condition?.etagMatches;
      if ((absent && old !== null) || (match != null && match !== old && match !== JSON.stringify(old))) return null;
      objects.set(key, raw); versions.set(key, (versions.get(key) ?? 0) + 1);
      return { key, etag: 'v' + versions.get(key), size: new TextEncoder().encode(raw).length };
    },
    async delete(key: string) { objects.delete(key); },
    async list(options: { prefix?: string } = {}) { return { objects: [...objects.keys()].filter(k => k.startsWith(options.prefix ?? '')).sort().map(key => ({ key })), truncated: false }; },
  };
  const kv = new Map<string, string>();
  const cache = { get: async (key: string, type?: string) => { const v = kv.get(key); return v === undefined ? null : type === 'json' ? JSON.parse(v) as unknown : type === 'stream' ? new Response(v).body : v; },
    put: async (key: string, value: string) => { kv.set(key, value); }, delete: async (key: string) => { kv.delete(key); },
    list: async () => ({ keys: [...kv.keys()].map(name => ({ name })), list_complete: true }) };
  const env = {
    DEPLOYMENT_PROFILE: 'demo', ENVIRONMENT: 'test', CACHE: cache, SESSIONS: cache, STORAGE: storage,
    CONNECTOR_MODE: 'mock', DECISION_SOURCE: 'mock', REFLEX_HOST: 'session',
    JWT_SECRET: SECRET, JWT_ISSUER: 'w29ledger', JWT_AUDIENCE: 'w29ledger',
    IDENTITY_SALT: 'w29-ledger-synthetic-audit-salt', IDENTITY_SECRETS: `${TENANT}:w29-ledger-identity-material`,
    TENANTS: JSON.stringify({ provisioned: [TENANT], operatorGrants: { ops: [TENANT] } }), RETENTION,
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }) }) }) },
    EVENT_QUEUE: { send: async () => { /* no ledger traffic */ } },
  } as unknown as Env;
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', tenantMiddleware());
  app.route('/content', contentRoutes);
  app.route('/v1', decisionRoutes);
  const token = await new jose.SignJWT({ sub: 'ops', type: 'service', roles: ['operator', 'admin'] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setIssuer('w29ledger').setAudience('w29ledger').setExpirationTime('2h')
    .sign(new TextEncoder().encode(SECRET));
  const baseline = (kind: PublicationBaseline['kind'], value: unknown, scope = TENANT): PublicationBaseline =>
    ({ kind, scope, revision: { revision: 1, at: T0, actor: 'w29-ledger-fixture', note: 'fixture', value } });
  await initializePublicationSet(env, [
    baseline(CONTENT_KIND, { version: 'w29-b1-coach-catalogue', pieces: W29_PIECES }), baseline(SLOTS_KIND, W29_SLOTS),
    baseline(LEARN_KIND, W29_LEARN), baseline(PRIORS_KIND, EMPTY_PRIORS), baseline(PROPOSALS_KIND, W29_PROPOSALS),
    baseline(REFLEX_KIND, DEFAULT_REFLEX_CONFIG, reflexScopeForTenant(TENANT)),
  ], '0:' + crypto.randomUUID());
  invalidatePublicationCache();
  const get = async (path: string) => {
    const response = await app.fetch(new Request(ORIGIN + path, { headers: { Authorization: `Bearer ${token}`, 'X-Tenant': TENANT } }), env,
      { waitUntil: () => undefined, passThroughOnException() { /* never */ }, props: {} } as unknown as ExecutionContext);
    return { status: response.status, body: await response.json().catch(() => ({})) as Record<string, unknown> };
  };
  return { get };
}

/** Every shipped product module: `src/**` without the tests and without the unit files, from this checkout. */
function productModules(): string[] {
  const root = fileURLToPath(new URL('../../', import.meta.url)); // src/, from src/units/W29/
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir).sort()) {
      const full = `${dir}/${entry}`;
      if (statSync(full).isDirectory()) { if (entry !== 'units') walk(full); continue; }
      if (full.endsWith('.ts') && !full.endsWith('.d.ts') && !full.endsWith('.test.ts')) out.push(full);
    }
  };
  walk(root.replace(/\/$/, ''));
  return out;
}

describe('unit:W29.R3', () => {
  it('host: the work queue and the proposals history state the same withdrawal', async () => {
    const m = await mount();
    const queue = await m.get(`/v1/${TENANT}/learn/queue?brand=${BRAND}`);
    const history = await m.get(`/v1/${TENANT}/learn/proposals`);
    expect([queue.status, history.status]).toEqual([200, 200]);
    const autonomy = queue.body.autonomy as { mutationAvailable: boolean; proposalStatusesVerified: boolean };
    const stated = history.body.history as { mutationAvailable: boolean; verified: boolean };
    expect(autonomy, 'W29.U1.01\'s member, as locked').toEqual({ mutationAvailable: false, proposalStatusesVerified: false });
    expect({ mutationAvailable: stated.mutationAvailable, verified: stated.verified }, 'the history states the same two facts the queue states')
      .toEqual({ mutationAvailable: autonomy.mutationAvailable, verified: autonomy.proposalStatusesVerified });
  });

  it('logic: the shipped product sources state the withdrawal with one literal', () => {
    expect(CHECKOUT_ROOT, 'the sources measured are the ones in this checkout').toBe(fileURLToPath(new URL('../../../', import.meta.url)));
    const statements = productModules().flatMap(file => {
      const text = readFileSync(file, 'utf8');
      return [...text.matchAll(/mutationAvailable\s*:\s*false/g)].map(match =>
        `${file.slice(CHECKOUT_ROOT.length)}:${text.slice(0, match.index).split('\n').length}`);
    });
    expect(statements.length, 'the withdrawal is stated at all').toBeGreaterThan(0);
    expect(statements,
      `W29.R3 / R176 — the withdrawal ("mutationAvailable: false") must be one literal every answer reads, not ${statements.length} independent statements that can part: ${statements.join(', ')}`)
      .toHaveLength(1);
  });
});
