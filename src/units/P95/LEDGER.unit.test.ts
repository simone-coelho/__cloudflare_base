// src/units/P95/LEDGER.unit.test.ts
// P95 under the Closure Ledger: the tests for the LOCAL criteria SV1-SV5 of the P95 work order (the programme
// tapestry-parity-scale of amendment 12, ticket P95 "The salt version on long-lived tenants", E20; batch S39). LV1 is a
// deferred live row and gets no test.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-12/BTI-Parity-Amendment-2026-10-26-scale.md, section 2, E20):
//   "**Authority:** lane L19 (R-P485): `holdout.saltVersion` reads null on a tenant whose learn history is longer than
//   the 24 revisions the count walks, so the head script never sees a salt rotation there."
//   "**Done when:** the salt version is derived without walking a bounded history (stored with the rotation, or counted
//   over the whole history), the head script's rotated-paint rule holding on a long-lived tenant."
// The work order (docs/parity/scale/program.json, P95): SV1 an exact salt version on every revision of a learn history
// past 24 revisions, established on the operator's publish without a bounded walk; SV2 a tenant whose current revision
// carries null (the pair's l1) reads exact from its next learn publication where every revision is stored, and null,
// never a smaller number, where the stored history cannot establish it; SV3 the context table and the decision answer
// the new exact number after a rotation past revision 25 (the head script's rule); SV4 the locks NR3, NR4, W38 B4 and the
// join key; SV5 the kits.
//
// TODAY (c42a7ef4): src/config/publication.ts derivedFor carries the count from the revision before only while
// `revision - 1 <= SALT_CARRY_REVISIONS` (24) and otherwise calls src/content/holdout.ts saltVersionOf, which reads at
// most SALT_HISTORY_READS (24) earlier revisions and answers null short of revision 1; publication.ts saltCountCarried lets
// the purge remove learn revisions once the current one is past 24; src/content/service.ts contextTableInForce walks
// (saltVersionOf) wherever the head carries no annotation for the salt in force.
//
// THE DESIGN THE LEAD RULED (S39/SPEC-BRIEF-P95.md, six points; R-P511), each locked below:
//   1. The count is stored with each revision (the envelope's `derived` annotation, read by carriedSaltVersion) and
//      carried without bound: where the revision before carries an exact count, the new one carries it, or one more
//      where the effective salt changed, whatever the revision number; no earlier revision is read.    (SV1, SV4)
//   2. Where the revision before carries no exact count, the publish counts over the WHOLE stored history on the
//      operator's time: every earlier learn revision read once, oldest to newest; a revision the store cannot produce
//      leaves the count null (NR4: never a smaller number, never cached as a number). SALT_HISTORY_READS goes from the
//      publish-time count; RULED HERE: no constant replaces it (the walk's only bound is the revision number). (SV2, SV4)
//   3. The serving path never walks (NR3): the context table and the decision read the annotation the current learn
//      revision carries, or null; a tenant reading null keeps reading null until its next learn publication. (SV2, SV4)
//   4. The head script's rule (src/sdk/head.ts :145-157, `moved`, unchanged), locked from the engine's side.  (SV3)
//   5. The locks: NR3, NR4, W38 B4 (a purge never turns an exact count into an unknown; the purge keeps every learn
//      revision while the current one carries no exact count), `experiment.id` still names the salt.     (SV4, SV2, SV3)
//   6. The kits: the 24-revision sentence gone; the rule stated; kit 01 :642 still true.                  (SV5)
// NO NEW EXPORT: every member imported here exists today.
//
// READINGS (where the brief is silent; for the lead):
//   R1 "No earlier revision read" on a publish: during the operator's PUT, no learn revision OLDER than the one before
//      is read (the publish reads the one before, and the new one once it commits).
//   R2 "Every earlier revision read once, oldest to newest" (point 2): the learn revisions older than the one before that
//      the PUT reads are exactly 1, 2, 3, … in that order, each once; the one before is the publish's own read.
//   R3 The pair's l1 (SV2) is PLANTED in the stored form today's engine leaves: revisions 1-26 as the writer before
//      W21 E1.07 stored them (no `derived`), 27-30 carrying `{ salt, version: null }` (today's past-the-horizon count),
//      every digest that names them resealed (src/units/W38/FIX1.unit.test.ts asStoredBeforeW21, generalised). The
//      history is published through the operator's route first, so only the stored annotations differ.
//   R4 "One revision purged before the first exact count" (SV2): under point 5 the real purge no longer produces it, so
//      its body is removed as today's purge removes learn revisions past its horizon (W38 FIX1's boundary leg measured
//      that before its R10), with the configuration-revision setting set so the platform names it purged (410
//      revision_purged). The purged revision carries a salt no other revision carries, so a count that skips it, or
//      stops at it, answers a smaller number.
//   R5 The context table on a head carrying no annotation (a learn document published before W21 E1.07) reads null as
//      the decision does, until the next learn publication (point 3; kit 02's sentence pinned by unit:W21.E1.09:
//      "decisions and outcomes under it read `saltVersion: null` until that tenant next publishes"). Today it walks.
//   R6 "Both hosts": the publish and the purge are the operator's path, the same on either shopper host; every host leg
//      ends on that host's own decision (REFLEX_HOST session or do) beside the shopper-free context table.
//   R7 The purge legs (SV4) set the configuration-revision setting after the history is built: 1 ms with real time and a
//      25 ms pause before the publication that purges; the purge is shown in force by what it removed.
//   R8 The kit sentences are ruled verbatim (KIT_SALT_EXACT, KIT_PURGE_KEEPS). Kit 03's decision row keeps
//      unit:W21.C1.06's sentence (src/units/W21/B2.unit.test.ts KIT_SALT_VERSION, outside the grant), so the rule is
//      ADDED there; W21 B2's KIT_SALT_HORIZON takes KIT_SALT_EXACT's words by the R10, so both files demand one sentence.
//
// R10 BY NAME (the programme's grant, R-P511), before -> after:
//   src/units/W21/B2.unit.test.ts, unit:W21.E1.07 and KIT_SALT_HORIZON: the constant's 24-revision sentence ->
//     KIT_SALT_EXACT's; the logic leg's saltVersionOf at revision 30 null -> 3; the host leg's far history (revision 28
//     on SALT_C) null -> 3, its title "states an unknown honestly" -> "states the count exactly however long the
//     history", "states the bound" -> "states the rule"; the comments beside them.
//   src/units/W38/FIX1.unit.test.ts, unit:W38.B4.x's boundary leg: learn 27 on a 26-revision pre-W21 history, unset
//     { spring-26, null } -> { spring-26, 2 }; with the setting set "purges learn revisions" -> keeps learn revisions 1-26
//     (catalogue 1 and 2 purged: the purge in force); set equals unset; its title and comment; the header's "Past the
//     horizon" sentence.
// LOCKS (measured on the sketch): W21 B1-B3 and LEDGER, W38 LEDGER and FIX1 as amended, W30 FIX1 and P1E1, P84, P89,
// P30's context key; unit:W21.C1.06's kit 03 sentence and unit:W21.E1.09's kit 02 sentence asserted unchanged in SV5.
// DEFERRED: LV1 (the pair's l1 after its next learn publication, at the next release, lane L20).
// RESIDUALS: (1) a tenant whose stored history can never establish the count (a revision purged before its first exact
// count) reads null for good and, under the setting, keeps every learn revision for good (point 5); (2) the first count
// of an un-annotated history reads every earlier learn revision on that one publish (unbounded by design, point 2);
// (3) no test tells "no read horizon" from a horizon above this fixture's 35 revisions (point 2's absence is ruled).
//
// HARNESS: src/units/_parity.ts (the mounted app over the real Durable Object classes, both hosts). Imports from
// src/units/: ../_parity. Tenant ids only; no network; documents read from this tree (import.meta.url).

import { readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { carriedSaltVersion, invalidatePublicationCache, publicationVersion, type CarriedSalt } from '@/config/publication';
import { invalidateCache } from '@/config/versionedStore';
import { invalidateSaltVersions, outcomeEnrollment } from '@/content/holdout';
import { LEARN_KIND } from '@/content/kinds';
import { invalidateLiftCache } from '@/content/service';
import type { TenantId } from '@/tenancy/tenant';

import {
  asOperator, BRAND, declaredSlots, expectPublished, HOSTS, layoutSlot, learnDocument, loadDocument, MODULES, mount, putDocument, readTree,
  shopperOn, TENANT, type Mounted,
} from '../_parity';

// ---------------------------------------------------------------------------
// The fixture: the parity product page (its declared layout slot, so the page has a context table) and a learn document
// whose holdout names the salt; an unrelated edit moves the regional threshold, never the salt.
// ---------------------------------------------------------------------------

const PAGE = 'pdp';
const SALT_A = 'p95-salt-a', SALT_B = 'p95-salt-b', SALT_C = 'p95-salt-c', SALT_D = 'p95-salt-d';
/** A visitor for the outcome stamp (src/content/holdout.ts outcomeEnrollment), the producer's own read of the annotation. */
const VISITOR = 'vis-00000095-0000-4000-8000-000000000001';
const LONG_MS = 120_000;
const DAY_MS = 86_400_000;

/** The learn document of revision n on one salt: the regional threshold moves with n, so every revision is a new document. */
const learnOn = (salt: string, n: number) => learnDocument({}, { holdout: { share: 0.5, salt, arms: ['default'] }, regional: { enabled: false, kBlend: 1, minEvents: 30 + n } });
const DOCS = { pieces: MODULES, slots: declaredSlots([layoutSlot()]), learn: learnOn(SALT_A, 1) };
const catalogueAt = (n: number) => ({ version: `p95-coach-catalogue-${n}`, pieces: MODULES });

/** SV1, SV3, SV4: the salt of revision n: SALT_A at 1-2, rotated at 3 (inside the first 24) to SALT_B and again at 31 (past 30) to SALT_C. */
const rotatedAt3And31 = (n: number) => n < 3 ? SALT_A : n < 31 ? SALT_B : SALT_C;
/** The count W21 E1.03 defines for that history, by hand: 1 for the first salt, one more at each rotation, unchanged by an edit. */
const countAt3And31 = (n: number) => n < 3 ? 1 : n < 31 ? 2 : 3;
/** SV2, SV4: the pair's l1 as planted: SALT_A at 1, a short-lived SALT_B at 2, SALT_C from 3 to 30 (count 3 from revision 3 on). */
const l1Salt = (n: number) => n === 1 ? SALT_A : n === 2 ? SALT_B : SALT_C;
/** SV4 NR3: a short history written before the annotation: SALT_A at 1, SALT_B from 2 (count 2 from revision 2 on). */
const shortSalt = (n: number) => n === 1 ? SALT_A : SALT_B;
/** R3: the l1 form: 1-26 as stored before the annotation, 27-30 carrying today's past-the-horizon unknown. */
const l1Form = (n: number): Form => n <= 26 ? 'before' : 'unknown';

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const exact = (salt: string, version: number): CarriedSalt => ({ salt, version });
const unknownOn = (salt: string): CarriedSalt => ({ salt, version: null });
const idOf = (salt: string) => `${TENANT}:${BRAND}:${salt}`;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** A cold isolate: no publication, document, lift or salt count held from an earlier request. */
const cold = () => { invalidatePublicationCache(); invalidateCache(); invalidateLiftCache(); invalidateSaltVersions(); };

// ---------------------------------------------------------------------------
// The object store as the platform reads it: every read recorded in order, and keys made unreadable on demand.
// ---------------------------------------------------------------------------

interface Store { keys: string[]; failing: Set<string> }
function observe(m: Mounted): Store {
  const store: Store = { keys: [], failing: new Set() };
  const get = m.storage.get.bind(m.storage);
  m.storage.get = async (key: string) => {
    store.keys.push(key);
    if (store.failing.has(key)) throw new Error('synthetic object-store read failure');
    return get(key);
  };
  return store;
}
const learnKey = (n: number) => `config-publication/v1/${TENANT}/learn/rev/${n}.json`;
const LEARN_READ = new RegExp(`^config-publication/v1/${TENANT}/learn/rev/(\\d+)\\.json$`);
/** The learn revisions a run of reads touched, in order. */
const learnReads = (keys: readonly string[]) => keys.flatMap(key => { const hit = LEARN_READ.exec(key); return hit ? [Number(hit[1])] : []; });
/** The revision numbers of one kind whose bodies are stored, ascending. */
function stored(m: Mounted, kind: 'learn' | 'content'): number[] {
  const prefix = `config-publication/v1/${TENANT}/${kind}/rev/`;
  return [...m.storage.objects.keys()].filter(key => key.startsWith(prefix)).map(key => Number(key.slice(prefix.length, -'.json'.length))).sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// The operator: a learn publication through the mounted route (kit 02: If-Match from the loaded draft, Idempotency-Key),
// on a cold isolate, with the learn revisions that publication read.
// ---------------------------------------------------------------------------

interface Published { revision: number; read: number[] }
async function publishLearn(m: Mounted, store: Store, document: unknown): Promise<Published> {
  cold();
  const base = await loadDocument(m, 'learn');
  store.keys.length = 0;
  const answer = await asOperator(m, 'PUT', `/content/learn?scope=${TENANT}`, { document, note: 'p95 fixture' }, {
    'If-Match': `"${base.revision}/${base.publication.revision}/${base.publication.digest}"`,
    'Idempotency-Key': `${base.revision}:${crypto.randomUUID()}`,
  });
  const read = learnReads(store.keys);
  expect(answer.status, `PRECONDITION (${m.host}): the operator's learn publication over revision ${base.revision} is accepted (${JSON.stringify(answer.body).slice(0, 300)})`).toBe(200);
  cold();
  return { revision: answer.body.revision as number, read };
}
/** Learn revisions 2…through, revision n on saltOf(n) (revision 1 is the mount's, on SALT_A). */
async function publishHistory(m: Mounted, store: Store, through: number, saltOf: (n: number) => string): Promise<Published[]> {
  const out: Published[] = [];
  for (let n = 2; n <= through; n++) out.push(await publishLearn(m, store, learnOn(saltOf(n), n)));
  expect(out.map(p => p.revision), `PRECONDITION (${m.host}): the learn history is published as revisions 2-${through}`).toEqual(range(2, through));
  return out;
}
/** The salt annotation each named learn revision carries, read as the platform reads it (publicationVersion, carriedSaltVersion). */
async function annotations(m: Mounted, revisions: readonly number[]): Promise<Array<CarriedSalt | null>> {
  cold();
  const out: Array<CarriedSalt | null> = [];
  for (const n of revisions) out.push(carriedSaltVersion(await publicationVersion(m.env, LEARN_KIND, TENANT, n)));
  return out;
}
/** W38 B4 (decision D3): the tenant's configuration-revision retention setting, in the registry's own policy form. */
function setConfigurationRetention(m: Mounted, durationMs: number): void {
  const registry = JSON.parse(m.env.RETENTION ?? '{}') as { tenants: Record<string, Record<string, unknown>> };
  registry.tenants[TENANT]!.configuration = { id: 'p95-configuration-revisions', revision: 1, durationMs, basis: 'occurred', renewal: 'new-record-only' };
  m.env.RETENTION = JSON.stringify(registry);
}

// ---------------------------------------------------------------------------
// The page: what the head script compares (src/sdk/head.ts :145-157 `moved`: the version a browser holds — from the
// last table, `state.arm.saltVersion`, or the last answer, `state.experiment.saltVersion` — against the table's), read on
// a cold isolate, with every learn revision OLDER than the one in force that either read touched, before or behind its
// answer (W21 NR3, R130).
// ---------------------------------------------------------------------------

interface Page { status: { table: number; decision: number }; table: unknown; decision: unknown; id: unknown; olderRead: { table: number[]; decision: number[] } }
async function servePage(m: Mounted, store: Store, current: number): Promise<Page> {
  const shopper = await shopperOn(m);
  cold(); store.keys.length = 0;
  // GET /v1/<tenant>/context-table/<page>: no session, no token, as a server render or an edge cache reads it.
  const response = await m.fetch(new Request(`https://shop.invalid/v1/${TENANT}/context-table/${PAGE}`, { headers: { 'X-Tenant': TENANT } }));
  const table = await response.json().catch(() => ({})) as { holdout?: { saltVersion?: unknown } };
  await m.drain();
  const tableRead = learnReads(store.keys).filter(n => n < current);
  cold(); store.keys.length = 0;
  // POST /v1/<tenant>/decisions/snapshot: the consenting shopper's decision on this host.
  const decision = await shopper.snapshot(PAGE);
  const decisionRead = learnReads(store.keys).filter(n => n < current);
  const experiment = decision.body.experiment as { id?: unknown; saltVersion?: unknown } | undefined;
  const page: Page = { status: { table: response.status, decision: decision.status },
    table: table.holdout ? table.holdout.saltVersion : 'no holdout on the table',
    decision: experiment ? experiment.saltVersion : 'no experiment on the decision',
    id: experiment ? experiment.id : 'no experiment on the decision',
    olderRead: { table: tableRead, decision: decisionRead } };
  expect(page.status, `PRECONDITION (${m.host}): the context table and the decision are answered (${JSON.stringify(decision.body).slice(0, 200)})`).toEqual({ table: 200, decision: 200 });
  return page;
}
const numbers = (page: Page) => ({ table: page.table, decision: page.decision, id: page.id });
/** The outcome stamp: the producer's read of the annotation for an outcome recorded now (W21 E1.02). */
async function stamped(m: Mounted): Promise<unknown> {
  cold();
  const enrollment = await outcomeEnrollment(m.env, TENANT as TenantId, BRAND, VISITOR, true);
  return enrollment === null ? 'no enrollment' : enrollment.saltVersion;
}

// ---------------------------------------------------------------------------
// R3: a stored learn history in the form an older writer left it. Each rewritten envelope, and every digest that names
// it (the set references, the chain of sets, the head), is resealed over canonical JSON exactly as the engine seals it,
// so the engine re-verifies every digest when it reads them. Nothing under test is stubbed.
// ---------------------------------------------------------------------------

type Form = 'before' | 'unknown' | 'kept';
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value !== null && typeof value === 'object'
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
    : JSON.stringify(value);
const sha256 = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, '0')).join('');
const sealed = async (basis: Record<string, unknown>) => ({ ...basis, digest: await sha256(canonical(basis)) });

async function plantLearnHistory(m: Mounted, formOf: (n: number) => Form): Promise<void> {
  const storage = m.storage, revisions = `config-publication/v1/${TENANT}/learn/rev/`, sets = `config-publication/v2/${TENANT}/set/`, head = `config-publication/v2/${TENANT}/head.json`;
  const documentDigests = new Map<string, string>(), setDigests = new Map<string, string>();
  for (const key of [...storage.objects.keys()].filter(key => key.startsWith(revisions))) {
    const form = formOf(Number(key.slice(revisions.length, -'.json'.length)));
    if (form === 'kept') continue;
    const { derived, digest, ...basis } = JSON.parse(storage.objects.get(key)!) as Record<string, unknown> & { derived?: { salt: string } };
    expect(derived?.salt, `PRECONDITION (${m.host}): ${key} was published with its salt annotation`).toEqual(expect.any(String));
    const envelope = await sealed(form === 'before' ? basis : { ...basis, derived: { salt: derived!.salt, version: null } });
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

// ---------------------------------------------------------------------------
// The kits (SV5), ruled verbatim (R8).
// ---------------------------------------------------------------------------

/** The rule, in kit 02's enrollment paragraph and in both of kit 03's experiment rows. */
const KIT_SALT_EXACT = '`saltVersion` is exact on any learn history the platform still stores, however long, and `null` only where that stored history cannot establish it — never a smaller number.';
/** Kit 02's purge paragraph, the sentence that replaces the one naming the horizon. */
const KIT_PURGE_KEEPS = 'Where the current learn revision carries none (a learn document published before this release, or a count that could not be finished), the purge keeps every learn revision, so the next learn publication can count over the whole stored history.';
/** Today's sentences that name the horizon: gone from every kit file. */
const KIT_HORIZON = [
  'The platform reads back at most 24 published learn revisions to count salts; past that horizon `saltVersion` is `null` rather than a smaller number.',
  '(the 24-revision horizon above)',
  'past the horizon the count is `null` with or without a purge',
];
/** Kit 02's purge paragraph, unchanged around the replaced sentence (W38 B4). */
const KIT_CARRY = 'A learn revision builds its salt count from the one before it where that one carries an exact count.';
const KIT_PURGE_NEVER = 'So a purge never turns an exact `saltVersion` into an unknown.';
/** unit:W21.C1.06's sentence in kit 03's decision row (src/units/W21/B2.unit.test.ts KIT_SALT_VERSION), kept. */
const KIT_W21_SALT_VERSION = '`saltVersion` counts the distinct salts this tenant has published up to the pinned revision, and is `null` where the published history the platform can read does not reach the first one.';
/** unit:W21.E1.09's sentence in kit 02 (src/units/W21/B3.unit.test.ts PRE_RELEASE_SALT_SENTENCE), kept: SV2's null until the next publication. */
const KIT_PRE_RELEASE = 'A learn document published before this release carries no salt-version annotation, so decisions and outcomes under it read `saltVersion: null` until that tenant next publishes its learn document.';
/** Kit 01 :640-642, whitespace normalised: the head script's default row once after the salt changes. */
const KIT01_ROTATED = 'It paints the default row, your server order within the brand rules, for the holdout\'s default class, without a recorded personalization choice, for an arrival or a device it cannot classify, for a table naming another classifier version, and once after the experiment\'s salt changes.';
const KIT_FILES = readdirSync(new URL('../../../docs/kit/', import.meta.url)).filter(file => file.endsWith('.md')).sort();

// ===========================================================================
// unit:P95.SV1 — an exact salt version on every revision of a long history, carried on the operator's publish
// ===========================================================================

describe('unit:P95.SV1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): a learn history of 33 revisions published with the annotation — the salt rotated at revision 3 and again at 31, unrelated edits between — carries the exact salt version on every revision (1 twice, 2 from 3 to 30, 3 from 31), each established on the operator's publish reading no learn revision older than the one before it; the decision at the head answers 3 under the salt's own experiment id`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P95 — the product page and the learn document on SALT_A publish');
      const store = observe(m);
      const publishes = await publishHistory(m, store, 33, rotatedAt3And31);

      expect(await annotations(m, range(1, 33)),
        `${host}: SV1 (design point 1) — every learn revision carries the number of distinct salts published up to it, one more at each rotation and unchanged by the edits, never null: today the count stops at revision 25 (derivedFor carries only while revision - 1 <= 24, then a 24-read walk answers null)`)
        .toEqual(range(1, 33).map(n => exact(rotatedAt3And31(n), countAt3And31(n))));
      expect(publishes.filter(p => p.read.some(n => n < p.revision - 1)).map(p => `revision ${p.revision} read ${p.read.filter(n => n < p.revision - 1).join(',')}`),
        `${host}: SV1 (design point 1, R1) — no learn publication read a learn revision older than the one before it: the count is carried, never walked over a bounded window`)
        .toEqual([]);
      const head = await servePage(m, store, 33);
      expect({ decision: head.decision, id: head.id }, `${host}: SV1 — the decision at the head carries the head's count under the experiment its salt names`)
        .toEqual({ decision: 3, id: idOf(SALT_C) });
    }, LONG_MS);
  }
});

// ===========================================================================
// unit:P95.SV2 — the null tenant (the pair's l1) recovers at its next learn publication; a stored history that cannot
// establish the count stays null, never a smaller number
// ===========================================================================

describe('unit:P95.SV2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): the pair's l1 as planted (R3) — 30 learn revisions, 1-26 stored before the annotation and 27-30 carrying the unknown today's engine writes past its horizon, the salt rotated at 2 and at 3 — reads null until its next learn publication; that publication counts over the whole stored history (every earlier revision read once, oldest to newest) and carries 3, the rotation after it 4 from the revision before alone; the context table and the decision read 3 from that publication on, reading no earlier learn revision`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P95 — the product page and the learn document on SALT_A publish');
      const store = observe(m);
      await publishHistory(m, store, 30, l1Salt);
      await plantLearnHistory(m, l1Form);
      expect(await annotations(m, range(1, 30)), `PRECONDITION (${host}): the planted l1 — revisions 1-26 carry no annotation, 27-30 the unknown on SALT_C`)
        .toEqual([...range(1, 26).map(() => null), ...range(27, 30).map(() => unknownOn(SALT_C))]);

      const held = await servePage(m, store, 30);
      expect({ ...numbers(held), olderRead: held.olderRead },
        `${host}: SV2 (design point 3) — until its next learn publication the tenant reads the unknown its current revision carries, the join key naming SALT_C, and neither the context table nor the decision reads an earlier learn revision (NR3)`)
        .toEqual({ table: null, decision: null, id: idOf(SALT_C), olderRead: { table: [], decision: [] } });

      const next = await publishLearn(m, store, learnOn(SALT_C, 31));
      expect((await annotations(m, [31]))[0],
        `${host}: SV2 (design point 2) — its next learn publication (revision 31, an unrelated edit on SALT_C) counts over the whole stored history: SALT_A, SALT_B, SALT_C — 3 (today the 24-read walk stops at revision 7 and answers null)`)
        .toEqual(exact(SALT_C, 3));
      expect(next.read.filter(n => n < 30), `${host}: SV2 (design point 2, R2) — on the operator's publish every learn revision older than the one before is read once, oldest to newest`)
        .toEqual(range(1, 29));
      const recovered = await servePage(m, store, 31);
      expect({ ...numbers(recovered), olderRead: recovered.olderRead },
        `${host}: SV2 — from that publication on the context table and the decision read 3, reading no earlier learn revision`)
        .toEqual({ table: 3, decision: 3, id: idOf(SALT_C), olderRead: { table: [], decision: [] } });

      const rotated = await publishLearn(m, store, learnOn(SALT_D, 32));
      expect({ annotation: (await annotations(m, [32]))[0], olderRead: rotated.read.filter(n => n < 31) },
        `${host}: SV2 (design point 1) — the rotation at revision 32 carries 4 from the revision before alone, reading no older learn revision`)
        .toEqual({ annotation: exact(SALT_D, 4), olderRead: [] });
    }, LONG_MS);

    it(`host (${host}): the same l1 with learn revision 2 purged under the configuration-revision setting (R4): its next learn publications carry the unknown — null on SALT_C at 31 and on SALT_D at 32, never a smaller number — and the context table, the decision and the outcome stamp read null with the join key naming SALT_D`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P95 — the product page and the learn document on SALT_A publish');
      const store = observe(m);
      await publishHistory(m, store, 30, l1Salt);
      await plantLearnHistory(m, l1Form);
      setConfigurationRetention(m, 3650 * DAY_MS);
      await m.storage.delete(learnKey(2));
      cold();
      const purged = await publicationVersion(m.env, LEARN_KIND, TENANT, 2).then(() => 'read', (error: { status?: number; code?: string }) => `${error.status} ${error.code}`);
      expect(purged, `PRECONDITION (${host}): learn revision 2 reads as purged under the setting`).toBe('410 revision_purged');

      await publishLearn(m, store, learnOn(SALT_C, 31));
      await publishLearn(m, store, learnOn(SALT_D, 32));
      const page = await servePage(m, store, 32);
      expect({ annotations: await annotations(m, [31, 32]), ...numbers(page), outcome: await stamped(m) },
        `${host}: SV2 (NR4) — a stored history that cannot establish the count leaves it null on every reader, never the smaller number of what a count could still read (SALT_A and SALT_C, or SALT_C alone)`)
        .toEqual({ annotations: [unknownOn(SALT_C), unknownOn(SALT_D)], table: null, decision: null, id: idOf(SALT_D), outcome: null });
    }, LONG_MS);
  }
});

// ===========================================================================
// unit:P95.SV3 — the head script's rotated-paint rule on a long-lived tenant, from the engine's side
// ===========================================================================

describe('unit:P95.SV3', () => {
  for (const host of HOSTS) {
    it(`host (${host}): at learn revision 30 the context table and the decision both read 2 (what a browser holds); after the salt rotates at revision 31 both read 3 with the join key naming the new salt, so the browser holding 2 compares two numbers that differ (src/sdk/head.ts \`moved\`) and paints the default row once; neither read touches an earlier learn revision`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P95 — the product page and the learn document on SALT_A publish');
      const store = observe(m);
      await publishHistory(m, store, 30, rotatedAt3And31);
      const held = await servePage(m, store, 30);
      await publishLearn(m, store, learnOn(SALT_C, 31));
      const rotated = await servePage(m, store, 31);

      expect({ held: numbers(held), rotated: numbers(rotated) },
        `${host}: SV3 (design point 4) — the numbers the head script compares are exact on a long-lived tenant: 2 before the rotation at revision 31 and 3 after it, on the table and on the decision alike (today both read null past revision 25, and null is never a rotation)`)
        .toEqual({ held: { table: 2, decision: 2, id: idOf(SALT_B) }, rotated: { table: 3, decision: 3, id: idOf(SALT_C) } });
      expect({ held: held.olderRead, rotated: rotated.olderRead }, `${host}: SV3 — and the page reads no earlier learn revision for them (NR3)`)
        .toEqual({ held: { table: [], decision: [] }, rotated: { table: [], decision: [] } });
    }, LONG_MS);
  }
});

// ===========================================================================
// unit:P95.SV4 — the locks: NR3, NR4, W38 B4, the join key
// ===========================================================================

describe('unit:P95.SV4', () => {
  for (const host of HOSTS) {
    it(`host (${host}): NR3 — on a head published before the annotation (four learn revisions, the salt rotated at 2), the context table and the decision read no earlier learn revision, before or behind their answers, and read what the head carries: none, so null (R5); after the next learn publication both read 2; the join key names SALT_B throughout`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P95 — the product page and the learn document on SALT_A publish');
      const store = observe(m);
      await publishHistory(m, store, 4, shortSalt);
      await plantLearnHistory(m, () => 'before');
      expect(await annotations(m, range(1, 4)), `PRECONDITION (${host}): the four learn revisions carry no annotation`).toEqual([null, null, null, null]);

      const head = await servePage(m, store, 4);
      expect(head.olderRead, `${host}: SV4 NR3 (design point 3) — neither the context table nor the decision reads a learn revision older than the head (today the table walks the history: src/content/service.ts contextTableInForce calls saltVersionOf)`)
        .toEqual({ table: [], decision: [] });
      expect(numbers(head), `${host}: SV4 (design point 3, R5) — both read what the head carries, the explicit unknown, as kit 02 states for a document published before the annotation; the join key names SALT_B`)
        .toEqual({ table: null, decision: null, id: idOf(SALT_B) });
      await publishLearn(m, store, learnOn(SALT_B, 5));
      const next = await servePage(m, store, 5);
      expect({ ...numbers(next), olderRead: next.olderRead }, `${host}: SV4 — after the next learn publication both read 2, still reading no earlier learn revision`)
        .toEqual({ table: 2, decision: 2, id: idOf(SALT_B), olderRead: { table: [], decision: [] } });
    }, LONG_MS);

    it(`host (${host}): NR4 — on the planted l1, a learn publication whose count meets a revision the store cannot produce (revision 5 unreadable while it publishes) carries the unknown, never a smaller number, and the unknown is not kept: the next learn publication, the store healthy, carries 3, and the context table and the decision read 3`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P95 — the product page and the learn document on SALT_A publish');
      const store = observe(m);
      await publishHistory(m, store, 30, l1Salt);
      await plantLearnHistory(m, l1Form);
      store.failing.add(learnKey(5));
      await publishLearn(m, store, learnOn(SALT_C, 31));
      store.failing.clear();
      await publishLearn(m, store, learnOn(SALT_C, 32));
      const page = await servePage(m, store, 32);
      expect({ annotations: await annotations(m, [31, 32]), table: page.table, decision: page.decision },
        `${host}: SV4 NR4 (design point 2) — a count that cannot finish is null, never the count it reached, and is not kept: the next publication over a healthy store counts SALT_A, SALT_B, SALT_C — 3`)
        .toEqual({ annotations: [unknownOn(SALT_C), exact(SALT_C, 3)], table: 3, decision: 3 });
    }, LONG_MS);

    it(`host (${host}): W38 B4 — on the 33-revision history published with the annotation, under the configuration-revision setting the purge removes old learn revisions and every count stays exact: revision 34 carries 3, the rotation at 35 carries 4 from the revision before alone, every learn revision still stored carries its exact count, and the outcome stamp, the context table and the decision read 4`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P95 — the product page and the learn document on SALT_A publish');
      const store = observe(m);
      await publishHistory(m, store, 33, rotatedAt3And31);
      setConfigurationRetention(m, 1);
      await pause(25);
      await publishLearn(m, store, learnOn(SALT_C, 34));
      const removed = range(1, 34).filter(n => !stored(m, 'learn').includes(n));
      await pause(25);
      await publishLearn(m, store, learnOn(SALT_D, 35));
      const kept = stored(m, 'learn');
      expect(removed.length, `PRECONDITION (${host}): the publication of revision 34 purged old learn revisions under the setting (R7)`).toBeGreaterThan(0);

      const page = await servePage(m, store, 35);
      expect({ annotations: await annotations(m, [34, 35]), outcome: await stamped(m), table: page.table, decision: page.decision },
        `${host}: SV4 W38 B4 (design points 1 and 5) — a purge never turns an exact count into an unknown: past revision 25 the counts are carried from the revision before, whatever the purge removed`)
        .toEqual({ annotations: [exact(SALT_C, 3), exact(SALT_D, 4)], outcome: 4, table: 4, decision: 4 });
      expect(await annotations(m, kept), `${host}: SV4 W38 B4 — every learn revision still stored carries its exact count`)
        .toEqual(kept.map(n => n <= 33 ? exact(rotatedAt3And31(n), countAt3And31(n)) : n === 34 ? exact(SALT_C, 3) : exact(SALT_D, 4)));
    }, LONG_MS);

    it(`host (${host}): W38 B4 — on the planted l1, whose current revision carries no exact count, a purge under the configuration-revision setting keeps every learn revision (catalogue revisions 1 and 2 go: the purge in force), so the next learn publication counts 3 over the whole stored history and the context table and the decision read it`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P95 — the product page and the learn document on SALT_A publish');
      const store = observe(m);
      await publishHistory(m, store, 30, l1Salt);
      for (const n of [2, 3]) expect((await putDocument(m, 'catalog', catalogueAt(n))).status, `PRECONDITION (${host}): catalogue revision ${n} publishes`).toBe(200);
      await plantLearnHistory(m, l1Form);
      setConfigurationRetention(m, 1);
      await pause(25);
      expect((await putDocument(m, 'catalog', catalogueAt(4))).status, `PRECONDITION (${host}): catalogue revision 4 publishes`).toBe(200);
      const learnAfterPurge = stored(m, 'learn'), catalogueAfterPurge = stored(m, 'content');
      await publishLearn(m, store, learnOn(SALT_C, 31));
      const page = await servePage(m, store, 31);

      expect(learnAfterPurge, `${host}: SV4 W38 B4 (design point 5) — while the current learn revision carries no exact count the purge keeps every learn revision (today saltCountCarried lets it purge once the current one is past revision 24)`)
        .toEqual(range(1, 30));
      expect(catalogueAfterPurge, `PRECONDITION (${host}): the purge was in force: catalogue revisions 1 and 2, older than the setting and neither current nor previous, are purged (R7)`).toEqual([3, 4]);
      expect({ annotation: (await annotations(m, [31]))[0], table: page.table, decision: page.decision },
        `${host}: SV4 W38 B4 — so the next learn publication counts over the whole stored history: 3, on the table and the decision`)
        .toEqual({ annotation: exact(SALT_C, 3), table: 3, decision: 3 });
    }, LONG_MS);
  }
});

// ===========================================================================
// unit:P95.SV5 — the kits
// ===========================================================================

describe('unit:P95.SV5', () => {
  it('logic: kit 02 and kit 03 state the rule — exact on any learn history the platform still stores, null only where that stored history cannot establish it — in kit 02\'s enrollment paragraph and purge paragraph and in both of kit 03\'s experiment rows; the 24-revision sentence and the purge sentence\'s horizon clauses are gone from every kit file; W21\'s kit sentences are kept', () => {
    const kit02 = readTree('docs/kit/02-api-reference.md'), kit03 = readTree('docs/kit/03-payload-schemas.md');
    const start = kit02.indexOf('\n### Experiment enrollment across a link\n');
    expect(start, 'PRECONDITION: kit 02 publishes its "Experiment enrollment across a link" section').toBeGreaterThan(-1);
    const rest = kit02.slice(start + 1), enrollment = rest.slice(0, rest.indexOf('\n#', 1) < 0 ? undefined : rest.indexOf('\n#', 1));
    const purge = kit02.split('\n').find(line => line.startsWith('Configuration PUT/PATCH, import, pull, rollback and item reset require')) ?? '';
    const decisionRow = kit03.split('\n').find(line => line.startsWith('| `experiment` |') && line.includes('this record')) ?? '';
    const outcomeRow = kit03.split('\n').find(line => line.startsWith('| `experiment` |') && line.includes('VISITOR')) ?? '';
    const horizon = KIT_FILES.flatMap(file => KIT_HORIZON.filter(sentence => readTree(`docs/kit/${file}`).includes(sentence)).map(sentence => `${file}: ${sentence}`));
    expect({
      horizon,
      enrollment: enrollment.includes(KIT_SALT_EXACT),
      purge: { keeps: purge.includes(KIT_PURGE_KEEPS), carry: purge.includes(KIT_CARRY), never: purge.includes(KIT_PURGE_NEVER) },
      kit03: { decision: decisionRow.includes(KIT_SALT_EXACT), outcome: outcomeRow.includes(KIT_SALT_EXACT), w21Decision: decisionRow.includes(KIT_W21_SALT_VERSION) },
      preRelease: enrollment.includes(KIT_PRE_RELEASE),
    }, `SV5 (design point 6) — every kit file is free of the horizon (${JSON.stringify(KIT_HORIZON)}); kit 02's enrollment paragraph and both of kit 03's experiment rows state "${KIT_SALT_EXACT}"; kit 02's purge paragraph states "${KIT_PURGE_KEEPS}" beside "${KIT_CARRY}" and "${KIT_PURGE_NEVER}"; W21's sentences stay (C1.06 in kit 03's decision row, E1.09 in kit 02)`)
      .toEqual({ horizon: [], enrollment: true, purge: { keeps: true, carry: true, never: true }, kit03: { decision: true, outcome: true, w21Decision: true }, preRelease: true });
  });

  it('logic: kit 01 still states that the head script paints the default row once after the experiment\'s salt changes (:640-642)', () => {
    expect(readTree('docs/kit/01-integration-guide.md').replace(/\s+/g, ' ').includes(KIT01_ROTATED), `SV5 — kit 01 keeps: "${KIT01_ROTATED}"`).toBe(true);
  });
});
