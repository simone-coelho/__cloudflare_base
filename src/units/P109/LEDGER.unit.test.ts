// src/units/P109/LEDGER.unit.test.ts
// P109 under the Closure Ledger (programme tapestry-parity-gate-determinism, amendment 13 E33, "The gate counts, never
// times"): the meta-legs of the LOCAL criteria GD1, GD2 and GD3. GD4 (P105.AL6) is round 2, after P105 merges.
//
// The work order (docs/parity/gate-determinism/program.json, P109; D1 tests only, no product path) asks that the named
// tests that failed gates on the shared box's load assert counts, waves and per-action order instead of wall-clock bounds
// or one scheduling order, the time staying printed as evidence, and that each counted form still turns RED on the
// defect the timed form caught. The analysis is _evidence/parity-step3/S55/analyst-intermittents/DESIGN.md §1-§3
// (adopted R-P707). The box law (R-P706): every variant here is deterministic — a held write, a held read, a fake
// clock — never load.
//
// THE R10s (granted by name, every expectation unchanged; the specifier's own):
//   GD1 src/index.api-boundary.test.ts W12.02: the four tenant and host runs go through `observedAfterDelivery`
//       (./_counted.ts): where the monitor's observation stage ended before the real queue delivery, the run awaits the
//       delivery event the test records for every wire the operation wrote (`wiresDelivered`), then makes exactly one
//       re-observation. No wall-clock deadline decides the assertion; a delivery that never comes fails on the test's
//       own timeout (300 s).
//   GD2 src/units/P35/LEDGER.unit.test.ts P35.Z2: the present run's ODP writes equal the reference run's action by
//       action, order-free within one action (`perAction`, ./_counted.ts).
//   GD3 src/units/P102/LEDGER.unit.test.ts CR1, CR2 and CR3: the documents stage's medians are printed as evidence and
//       none is asserted; the reads and waves each leg already checks hold the clause. P106.PC5's LOCKS_AT_D4596FD5
//       entry for that file is re-pinned in the same commit (R-P668, R-P709), and only that entry.
//
// THE META-LEGS (each proves its counted form RED on the defect and GREEN on the timing variant that failed it):
//   GD1 logic: the monitor's run modelled on a fake clock (src/ops/synthetic.ts: the observation polls every 100 ms
//       under a 10 s stage deadline and, on that deadline, answers failedStage 'observation' with the polled flags
//       dropped; a later run on the started scope observes once). Delivery after 15 s: the timed form RED, the counted
//       form GREEN in two runs. Delivery withheld: the counted form never answers (it waits; W12.02's timeout fails it).
//       Delivered but no consumer witness: the counted form RED.
//   GD2 host (both): the real product's ODP writes, with each action's event write or profile write held behind the
//       other of the same action (the two orders the scheduler can give): the counted form GREEN on both against the
//       reference, the ordered form RED on at least one. A second identifier the reference does not carry (the
//       shopper's P12 link with the setting present, so every write carries it): the counted form RED, and equal
//       once that identifier alone is taken out.
//   GD3 host (both): the real product's cold read of the head and the serving copy at 100 ms a read. The copy's read
//       issued only after the head's answer (a serial read): waves [2,2,2], the counted form RED. Each answer held a
//       further 120 ms (late answers, the load's signature): waves [1,1,1], the counted form GREEN, while the old
//       median bound (150 ms) is exceeded.
//
// IMPORTS FROM src/units/ (R-P4): ../_parity, ../_parity3, ./_counted. No product export is new.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { invalidatePublicationCache } from '@/config/publication';
import { configuredDestinations } from '@/connectors/config';

import {
  BRAND, declaredSlots, expectPublished, HOSTS, layoutSlot, learnDocument, MODULES, mount, PAGE_VIEW, pageInstanceOf, readTree, recentSlot,
  shopperOn, TENANT, VIEW_TABBY_26, VIEW_TABBY_WALLET, type Host, type Mounted,
} from '../_parity';
import { hmacOf, identityDoor, identitySecretOf, sha256Hex, type IdentityDoor } from '../_parity3';
import { deliveries, observedAfterDelivery, perAction, wiresDelivered, type Delivered } from './_counted';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

type Verdict = 'GREEN' | 'RED';
const verdictOf = (check: () => void): Verdict => { try { check(); return 'GREEN'; } catch { return 'RED'; } };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? Number.NaN;

// ===========================================================================
// unit:P109.GD1 — W12.02 waits on the delivery event, then one re-observation
// ===========================================================================

/** W12.02's expectation on each run (src/index.api-boundary.test.ts), unchanged. */
const W12_EXPECTED = { decision: true, event: true, producer: true, consumer: true, ledger: true, learning: true, dlq: false };
/** W12.02's fixture: stageMs 10 000 ms; the test's own timeout 300 000 ms. */
const STAGE_MS = 10_000, W12_TIMEOUT_MS = 300_000;
const WIRES = ['wire-decision', 'wire-outcome'];

/**
 * The monitor's run as src/ops/synthetic.ts executes it, on whatever clock is installed: the first run polls every
 * 100 ms for the consumer's witness until its stage deadline (`stage`, `descriptor.stageMs`) and, at the deadline,
 * answers failedStage 'observation' with every polled flag dropped; a later run re-observes the started scope once,
 * keeping the stored failedStage. The queue delivers the operation's wires at `deliverAt` ms (null: never), the
 * consumer writing its witness or not, and the fixture posts the delivered batch to the recorded observer.
 */
function monitor(deliverAt: number | null, writesWitness: boolean, record: (batch: Delivered) => void) {
  let witnessed = false, runs = 0;
  if (deliverAt !== null) {
    setTimeout(() => { witnessed = writesWitness; record({ queue: 'w1202-source', messages: WIRES.map(digest => ({ body: { digest } })) }); }, deliverAt);
  }
  const flags = () => ({ decision: true, event: true, producer: witnessed, consumer: witnessed, ledger: witnessed, learning: witnessed, dlq: false });
  const run = async (): Promise<Record<string, unknown>> => {
    runs++;
    if (runs > 1) return { ...flags(), state: witnessed ? 'complete' : 'pending', failedStage: 'observation' };
    const until = Date.now() + STAGE_MS;
    while (!witnessed) {
      if (Date.now() + 100 >= until) return { ...W12_EXPECTED, producer: false, consumer: false, ledger: false, learning: false, state: 'failed', failedStage: 'observation' };
      await sleep(100);
    }
    return { ...flags(), state: 'complete' };
  };
  return { run, runs: () => runs };
}

/** One W12.02 run under a variant, both forms: the timed form (the run's own answer) and the counted form (W12.02's). */
async function w12Variant(deliverAt: number | null, writesWitness: boolean) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const timed = monitor(deliverAt, writesWitness, () => undefined);
  const timedAnswer = timed.run();
  await vi.advanceTimersByTimeAsync(W12_TIMEOUT_MS);
  const timedResult = await timedAnswer;
  const delivery = deliveries<Delivered>();
  const counted = monitor(deliverAt, writesWitness, batch => delivery.record(batch));
  let settled: { result: Record<string, unknown>; runs: number } | null = null;
  void observedAfterDelivery(counted.run, () => delivery.until(wiresDelivered('w1202-source', WIRES))).then(answer => { settled = answer; });
  await vi.advanceTimersByTimeAsync(W12_TIMEOUT_MS);
  vi.useRealTimers();
  const answered = settled as { result: Record<string, unknown>; runs: number } | null;
  return {
    timed: verdictOf(() => expect(timedResult).toMatchObject(W12_EXPECTED)),
    counted: answered ? verdictOf(() => expect(answered.result).toMatchObject(W12_EXPECTED)) : `no answer within W12.02's ${W12_TIMEOUT_MS} ms`,
    runs: counted.runs(),
  };
}

describe('unit:P109.GD1 (E33: W12.02 waits on the delivery event, then one re-observation)', () => {
  it('logic: on a fake clock, delivery after 15 s (past the old 10 s stage) is RED for the timed form and GREEN for the counted form in two runs; delivery withheld never answers; delivered without the consumer\'s witness is RED; on time, one run', async () => {
    const seen = {
      delayed: await w12Variant(15_000, true),
      withheld: await w12Variant(null, true),
      noWitness: await w12Variant(15_000, false),
      onTime: await w12Variant(2_000, true),
    };
    expect(seen, 'P109.GD1 — the counted form answers on delivery, not on the clock, and still fails without delivery or without the consumer').toEqual({
      delayed: { timed: 'RED', counted: 'GREEN', runs: 2 },
      withheld: { timed: 'RED', counted: `no answer within W12.02's ${W12_TIMEOUT_MS} ms`, runs: 1 },
      noWitness: { timed: 'RED', counted: 'RED', runs: 2 },
      onTime: { timed: 'GREEN', counted: 'GREEN', runs: 1 },
    });
  });

  it('logic: W12.02 runs its four tenant and host runs through the counted form, awaiting its recorded deliveries, with its expectation unchanged', () => {
    const source = readTree('src/index.api-boundary.test.ts');
    const start = source.indexOf("it('W12.02 real native source delivery"), end = source.indexOf('\n}, 300000);', start);
    const w12 = start >= 0 && end > start ? source.slice(start, end) : '';
    expect({
      found: w12.length > 0,
      recorded: /W0906_OBSERVER: async \(request: Request\) => \{ delivery\.record\(/.test(w12),
      counted: /observedAfterDelivery\(\(\) => send\(\{ w12: 'run', tenant, host \}\)/.test(w12),
      awaited: /delivery\.until\(wiresDelivered\('w1202-source', wires\)\)/.test(w12),
      expectation: w12.includes('expect(result).toMatchObject({ decision: true, event: true, producer: true, consumer: true, ledger: true, learning: true, dlq: false });'),
    }, 'P109.GD1 — W12.02 is the counted form').toEqual({ found: true, recorded: true, counted: true, awaited: true, expectation: true });
  });
});

// ===========================================================================
// unit:P109.GD2 — P35.Z2 compares per action, order-free within one action
// ===========================================================================

const ODP_HOST = 'https://odp-coach.invalid';
const FIELD = 'customer_hash_id';
/** P35's ODP connector configuration (src/units/P35/LEDGER.unit.test.ts), unchanged. */
const ODP = {
  apiHost: ODP_HOST, publicKeyRef: 'CONNECTOR_SECRET_ODP_COACH', identityNamespace: 'coach-customer',
  actions: { product_view: { type: 'product', action: 'detail', fields: { product_id: 'productId', product_line: 'line' } } },
  audiences: {}, profile: { line_affinity_tabby: { dimension: 'line', value: 'Tabby' }, dominant_line: { dimension: 'line' } },
};
const ODP_DOCS = { pieces: MODULES, slots: { version: 'parity-p109-slots', governanceVersion: 3, pages: { pdp: [recentSlot()] } }, learn: learnDocument() };
const IDENTITY_MATERIAL = 'Pq7vRz2xKd9mWb4nTs6yLf3hGc8jNa5u';
const IDENTITY_SALT = 'Hx3kMw8pQz5rVt2nYb7cFd4gJs9aLe6u';
/** P35's views, in order. */
const VIEWS = [VIEW_TABBY_26, VIEW_TABBY_26, VIEW_TABBY_WALLET, VIEW_TABBY_26];

interface OdpCall { method: string; path: string; body: unknown }
type Kind = 'event' | 'profile';
const kindOf = (path: string): Kind | null => (path === '/v3/events' ? 'event' : path === '/v3/profiles' ? 'profile' : null);
/** Hold: in the listed actions, a write of `last`'s kind reaches ODP only after the other kind's write of the same action. */
interface Hold { last: Kind; actions: ReadonlySet<number> }

/** P35's tenant: ODP a recording fetch, the customer profile, its connector configuration, with an optional hold. */
async function odpTenant(host: Host, setting: string | null, hold: Hold | null = null) {
  const calls: OdpCall[] = [], marks: number[] = [];
  const seen = new Map<number, Set<Kind>>(), waiting: Array<{ action: number; kind: Kind; release: () => void }> = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    let body: unknown = null;
    try { body = JSON.parse(String(init?.body ?? 'null')); } catch { body = String(init?.body ?? ''); }
    const kind = (init?.method ?? 'GET').toUpperCase() === 'POST' ? kindOf(url.pathname) : null, action = marks.length;
    if (kind && hold && hold.last === kind && hold.actions.has(action)) {
      const other: Kind = kind === 'event' ? 'profile' : 'event';
      if (!seen.get(action)?.has(other)) await new Promise<void>(release => waiting.push({ action, kind: other, release }));
    }
    calls.push({ method: (init?.method ?? 'GET').toUpperCase(), path: url.pathname, body });
    if (kind) {
      seen.set(action, (seen.get(action) ?? new Set<Kind>()).add(kind));
      for (const w of waiting.splice(0)) { if (w.action === action && w.kind === kind) w.release(); else waiting.push(w); }
    }
    return url.pathname === '/v3/graphql' ? Response.json({ data: { customer: null } }) : Response.json({}, { status: 202 });
  });
  const m = await mount(host, ODP_DOCS);
  expect(m.refused, `PRECONDITION (${host}): the tenant's documents publish`).toBeNull();
  const env = m.env as unknown as Record<string, unknown>;
  env.DEPLOYMENT_PROFILE = 'customer';
  env.IDENTITY_SECRETS = `${TENANT}:${IDENTITY_MATERIAL}`;
  env.IDENTITY_SALT = IDENTITY_SALT;
  env.TENANT_CONNECTORS = JSON.stringify({ version: 1, tenants: { [TENANT]: { odp: { ...ODP, ...(setting ? { secondIdentifier: setting } : {}) } } } });
  env.CONNECTOR_SECRET_ODP_COACH = 'coach-odp-key.synthetic';
  const retention = JSON.parse(String(env.RETENTION)) as { tenants: Record<string, Record<string, unknown>> };
  const policy = Object.values(retention.tenants[TENANT]!)[0];
  for (const d of await configuredDestinations(m.env, TENANT)) retention.tenants[TENANT]![d.category] = policy;
  env.RETENTION = JSON.stringify(retention);
  return { m, calls, marks, door: identityDoor(m) };
}

/** P35's browsing: a page view, optionally the shopper's P12 link, then the views; a mark closes each drained action. */
async function browse(f: { m: Mounted; calls: OdpCall[]; marks: number[]; door: IdentityDoor }, accountId: string | null) {
  const { m, door } = f;
  const s = await shopperOn(m, { tracking: true, personalization: true });
  expect((await s.action(PAGE_VIEW)).status, `PRECONDITION (${m.host}): the page view is answered`).toBe(200);
  let capability = s.grant.capability;
  if (accountId) {
    const exp = Math.floor(Date.now() / 1000) + 600;
    const assertion = await hmacOf(identitySecretOf(m), `${TENANT}\n${s.subject}\n${accountId}\n${exp}`);
    const answer = await door.call(`/v1/${TENANT}/identity/link`, s.grant.capability, { visitorId: s.subject, accountId, source: 'login', exp, assertion });
    expect(answer.status, `PRECONDITION (${m.host}): the shopper's signed link is accepted: ${JSON.stringify(answer.body).slice(0, 200)}`).toBe(200);
    capability = ((answer.body.session ?? {}) as { capability?: string }).capability ?? '';
  }
  f.marks.push(f.calls.length);
  const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(capability.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0)))) as { subject: string; sessionId: string };
  for (const view of VIEWS) {
    const acted = await door.call('/realtime/action', capability, { ...view, source: 'sdk', userId: claims.subject, sessionId: claims.sessionId, timestamp: Date.now(), eventId: crypto.randomUUID() });
    expect(acted.status, `PRECONDITION (${m.host}): the view is answered: ${JSON.stringify(acted.body).slice(0, 160)}`).toBe(200);
    f.marks.push(f.calls.length);
  }
  await m.drain(); await door.drain();
}

const isWrite = (c: OdpCall) => c.method === 'POST' && kindOf(c.path) !== null;
const identifiersOf = (c: OdpCall): Record<string, unknown> => c.path === '/v3/events'
  ? ((c.body as { identifiers?: Record<string, unknown> }).identifiers ?? {})
  : (((c.body as Array<{ attributes?: Record<string, unknown> }>)[0]?.attributes) ?? {});
/** P35's normalised write (the vuid named as a placeholder); `without` takes one identifier field out first. */
const normalised = (c: OdpCall, without: string | null = null) => {
  const body = structuredClone(c.body);
  if (without) delete (c.path === '/v3/events' ? (body as { identifiers?: Record<string, unknown> }).identifiers ?? {} : (body as Array<{ attributes?: Record<string, unknown> }>)[0]?.attributes ?? {})[without];
  const vuid = String(identifiersOf(c).vuid ?? '');
  return `${c.method} ${c.path} ${JSON.stringify(body).split(vuid).join('<vuid>')}`;
};
/** P35.Z2's counted form, as its R10 computes it. */
const actionsOf = (run: { calls: OdpCall[]; marks: number[] }, without: string | null = null) => perAction(run.calls, run.marks, c => (isWrite(c) ? normalised(c, without) : null));
/** The timed form's comparison (P35.Z2 before the R10): every write in one ordered list. */
const orderedOf = (run: { calls: OdpCall[] }) => run.calls.filter(isWrite).map(c => normalised(c));
/** Each action's kinds of write in the order ODP received them. */
const kindsOf = (run: { calls: OdpCall[]; marks: number[] }) => {
  const bounds = [0, ...run.marks, run.calls.length];
  return bounds.slice(1).map((end, i) => run.calls.slice(bounds[i], end).filter(isWrite).map(c => kindOf(c.path)!));
};

describe('unit:P109.GD2 (E33: P35.Z2 compares the ODP writes per action, order-free within one action)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): the real product's writes with each action's event held behind its profile, or its profile behind its event, keep P35.Z2's counted form GREEN while the ordered form turns RED; a second identifier the reference does not carry turns the counted form RED, and only that identifier`, async () => {
      // P35.Z2's reference: the setting absent, no link.
      const reference = await odpTenant(host, null);
      await browse(reference, null);
      const both = new Set(kindsOf(reference).flatMap((kinds, i) => (kinds.includes('event') && kinds.includes('profile') ? [i] : [])));
      expect(both.size, `${host}: PRECONDITION — at least one action writes both an event and a profile (kinds per action ${JSON.stringify(kindsOf(reference))})`).toBeGreaterThan(0);
      // P35.Z2's present run, the setting present and no link, under each order the scheduler can give.
      const eventLast = await odpTenant(host, FIELD, { last: 'event', actions: both });
      await browse(eventLast, null);
      const profileLast = await odpTenant(host, FIELD, { last: 'profile', actions: both });
      await browse(profileLast, null);
      const lastOf = (run: typeof reference) => kindsOf(run).filter((_, i) => both.has(i)).map(kinds => kinds.at(-1));
      expect({ eventLast: lastOf(eventLast), profileLast: lastOf(profileLast) }, `${host}: PRECONDITION — each hold gave its order in every action writing both`)
        .toEqual({ eventLast: [...both].map(() => 'event'), profileLast: [...both].map(() => 'profile') });
      // A second identifier the reference does not carry: the setting present and the shopper's P12 link.
      const leaked = await odpTenant(host, FIELD);
      await browse(leaked, await sha256Hex('jordan.lee@example.com'));
      expect(leaked.calls.filter(isWrite).some(c => identifiersOf(c)[FIELD] !== undefined), `${host}: PRECONDITION — the writes carry a second identifier`).toBe(true);
      const counted = (run: typeof reference, without: string | null = null): Verdict => verdictOf(() => expect(actionsOf(run, without)).toEqual(actionsOf(reference, without)));
      const ordered = (run: typeof reference): Verdict => verdictOf(() => expect(orderedOf(run)).toEqual(orderedOf(reference)));
      expect({
        counted: { eventLast: counted(eventLast), profileLast: counted(profileLast), leaked: counted(leaked), leakedWithoutIdentifier: counted(leaked, FIELD) },
        orderedRedOnOne: [ordered(eventLast), ordered(profileLast)].includes('RED'),
        theTwoOrdersDiffer: !same(orderedOf(eventLast), orderedOf(profileLast)),
      }, `${host}: P109.GD2 — the counted form holds per action whatever the order inside one, and still catches a leaked identifier`).toEqual({
        counted: { eventLast: 'GREEN', profileLast: 'GREEN', leaked: 'RED', leakedWithoutIdentifier: 'GREEN' },
        orderedRedOnOne: true,
        theTwoOrdersDiffer: true,
      });
    }, 240_000);
  }

  it('logic: P35.Z2 compares through the counted form, with the action boundaries recorded', () => {
    const source = readTree('src/units/P35/LEDGER.unit.test.ts');
    const start = source.indexOf("describe('unit:P35.Z2"), end = source.indexOf("describe('unit:P35.Z3", start);
    const z2 = start >= 0 && end > start ? source.slice(start, end) : '';
    expect({
      counted: /perAction\(run\.calls, run\.marks, c => \(writes\(\[c\]\)\.length \? normalised\(c\) : null\)\)/.test(z2),
      compared: /expect\(actions\(present\),[\s\S]*?\.toEqual\(actions\(reference\)\)/.test(z2),
      marked: /f\.marks\.push\(f\.calls\.length\)/.test(source),
    }, 'P109.GD2 — P35.Z2 is the counted form').toEqual({ counted: true, compared: true, marked: true });
  });
});

// ===========================================================================
// unit:P109.GD3 — P102.CR1–CR3 print their medians; the waves hold the clause
// ===========================================================================

const DOCS = { pieces: [...MODULES], slots: declaredSlots([layoutSlot()]), learn: learnDocument() };
const HEAD = `config-publication/v2/${TENANT}/head.json`;
const SERVING = `config-publication/v2/${TENANT}/serving.json`;
/** P102's harness latency: 100 ms a read; its one-wave bound (R-P580 F5): 150 ms. */
const G = 100, ONE_WAVE_BOUND = G + G / 2;
/** Late answers: each read's answer held a further 120 ms after its 100 ms (timer lateness and CPU, as load gives). */
const LATE_MS = 120;

interface Read { cls: string; start: number; end: number }
/**
 * P102's meter (src/units/P102/LEDGER.unit.test.ts `meterOf`): each config-publication read held `G` ms, its start taken
 * when it is issued and its end when it is answered; `waves` splits them as P102's `waves` does — a read that starts
 * before the earliest end of the current wave joins it, else it opens the next.
 */
function meterOf(m: Mounted) {
  const meter = { armed: false, reads: [] as Read[] };
  const bucket = m.storage as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  for (const op of ['get', 'head'] as const) {
    const original = bucket[op]!.bind(m.storage);
    bucket[op] = async (...args: unknown[]) => {
      const key = String(args[0]), counted = meter.armed && key.startsWith('config-publication/'), start = performance.now();
      const answer = original(...args);
      if (counted) await sleep(G);
      const out = await answer;
      if (counted) meter.reads.push({ cls: key === SERVING ? 'serving copy' : key === HEAD ? 'head' : key, start, end: performance.now() });
      return out;
    };
  }
  return meter;
}
function waves(reads: readonly Read[]): string[][] {
  const out: Array<{ end: number; classes: string[] }> = [];
  for (const r of [...reads].sort((a, b) => a.start - b.start)) {
    const last = out.at(-1);
    if (last && r.start < last.end - 0.5) { last.classes.push(r.cls); last.end = Math.min(last.end, r.end); } else out.push({ end: r.end, classes: [r.cls] });
  }
  return out.map(w => w.classes.sort());
}
/**
 * A variant above the meter, as the product calls the bucket: `serial` issues the copy's read only once the head's read
 * of the same request has been answered (head then copy, one after the other, whatever order the two are called in);
 * `late` holds each read's answer a further LATE_MS. `next()` opens the next request.
 */
function variantOf(m: Mounted, variant: 'serial' | 'late' | null) {
  const bucket = m.storage as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  let answerHead: () => void = () => undefined, headAnswered = Promise.resolve();
  const next = () => { headAnswered = new Promise<void>(resolve => { answerHead = resolve; }); };
  for (const op of ['get', 'head'] as const) {
    const metered = bucket[op]!;
    bucket[op] = async (...args: unknown[]) => {
      const key = String(args[0]);
      if (variant === 'serial' && key === SERVING) await headAnswered;
      const out = await metered(...args);
      if (key === HEAD) answerHead();
      if (variant === 'late' && (key === HEAD || key === SERVING)) await sleep(LATE_MS);
      return out;
    };
  }
  return { next };
}
/** P102's door: a new visitor's first request, `POST /v1/:tenant/decisions/snapshot`, and its documents stage timing. */
async function door(m: Mounted, label: string) {
  const response = await m.fetch(new Request(`https://shop.invalid/v1/${TENANT}/decisions/snapshot`, { method: 'POST',
    headers: { 'X-Tenant': TENANT, 'Content-Type': 'application/json' }, body: JSON.stringify({ page: 'pdp', brand: BRAND, pageInstance: pageInstanceOf(label) }) }));
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  await m.drain();
  return { status: response.status, documents: ((body.sources as { timings?: Record<string, number> } | undefined)?.timings ?? {}).documents ?? Number.NaN };
}
/** A machine holding nothing, three times (P102.CR3's leg): the reads, the waves and the documents stage. */
async function cold(host: Host, variant: 'serial' | 'late' | null) {
  const m = await mount(host, DOCS);
  expectPublished(m, 'P109.GD3 — the tenant documents publish');
  const meter = meterOf(m), requests = variantOf(m, variant);
  requests.next();
  expect((await door(m, 'p109-gd3-warm')).status, `${host}: PRECONDITION — the door answers`).toBe(200);
  const runs: Array<{ reads: string[]; waves: number; documents: number }> = [];
  for (let rep = 1; rep <= 3; rep++) {
    invalidatePublicationCache();
    requests.next();
    meter.reads = []; meter.armed = true;
    let answer: Awaited<ReturnType<typeof door>>;
    try { answer = await door(m, `p109-gd3-cold-${rep}`); } finally { meter.armed = false; }
    runs.push({ reads: meter.reads.map(r => r.cls).sort(), waves: waves(meter.reads).length, documents: answer.documents });
  }
  return runs;
}

describe('unit:P109.GD3 (E33: P102.CR1-CR3 print their medians; the waves hold the clause)', () => {
  for (const host of HOSTS) {
    it(`host (${host}): reading the head and the copy one after the other turns P102.CR3's counted form RED (waves [2,2,2]); late answers that exceed the old 150 ms median bound keep it GREEN (waves [1,1,1])`, async () => {
      const counted = (runs: Array<{ reads: string[]; waves: number }>): Verdict =>
        verdictOf(() => expect({ reads: runs.map(r => r.reads), waves: runs.map(r => r.waves) }).toEqual({ reads: runs.map(() => ['head', 'serving copy']), waves: [1, 1, 1] }));
      const control = await cold(host, null), serial = await cold(host, 'serial'), late = await cold(host, 'late');
      console.log(`P109.GD3 ${host} evidence: documents ms control ${JSON.stringify(control.map(r => r.documents))}, serial ${JSON.stringify(serial.map(r => r.documents))}, late ${JSON.stringify(late.map(r => r.documents))}`);
      expect({
        control: counted(control),
        serial: { counted: counted(serial), waves: serial.map(r => r.waves), reads: serial.map(r => r.reads) },
        late: { counted: counted(late), timedBoundExceeded: median(late.map(r => r.documents)) > ONE_WAVE_BOUND },
      }, `${host}: P109.GD3 — the waves catch a serial read and ignore late answers (observed ${JSON.stringify({ control, serial, late })})`).toEqual({
        control: 'GREEN',
        serial: { counted: 'RED', waves: [2, 2, 2], reads: [['head', 'serving copy'], ['head', 'serving copy'], ['head', 'serving copy']] },
        late: { counted: 'GREEN', timedBoundExceeded: true },
      });
    }, 120_000);
  }

  it('logic: P102.CR1, CR2 and CR3 print their documents stage\'s medians and assert none; their reads and waves stay asserted', () => {
    const source = readTree('src/units/P102/LEDGER.unit.test.ts');
    const block = (from: string, to: string) => { const s = source.indexOf(from), e = source.indexOf(to, s + 1); return s >= 0 && e > s ? source.slice(s, e) : ''; };
    const cr1 = block("describe('unit:P102.CR1", "describe('unit:P102.CR2"), cr2 = block("describe('unit:P102.CR2", "describe('unit:P102.CR3"), cr3 = block("describe('unit:P102.CR3", "describe('unit:P102.CR4");
    const timed = (text: string) => /expect(\.soft)?\(median\(/.test(text) || /toBeLessThanOrEqual\(waveBound\(/.test(text);
    expect({
      timed: [cr1, cr2, cr3].map(timed),
      printed: [cr1, cr2, cr3].map(text => /evidence\(`\$\{host\}: P102\.CR[123]/.test(text)),
      waves: [/waves: \[1, 1, 1\]/.test(cr1), /waves: \[2, 2, 2\]/.test(cr2), /waves: \[1, 1, 1\]/.test(cr3)],
    }, 'P109.GD3 — CR1-CR3 count waves and print their times').toEqual({ timed: [false, false, false], printed: [true, true, true], waves: [true, true, true] });
  });
});
