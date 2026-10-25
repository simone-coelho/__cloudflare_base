// src/units/P90/LEDGER.unit.test.ts
// P90 under the Closure Ledger (programme `tapestry-parity-activation`, amendment 11, item E15): the tests for the LOCAL
// criteria EX1 and EX2 of the P90 work order (docs/parity/activation/program.json). EX3 and EX4 are DECISION criteria on D3
// (R-P341) and are not built; LV1 is a deferred live row and gets no test.
//
// THE REQUIREMENT, verbatim (docs/parity/authority/amendment-11/BTI-Parity-Amendment-2026-10-22-activation.md, E15):
//   "#### E15 · The bucket-drop ingest, the scheduled authenticated pull, the manual-upload script, and an allow-list on the
//    on-demand pull
//    - **Authority:** the IT pack, options (b), (c) and (d); the export mechanics report in the session scratchpad of 22 October.
//    - **Done when:** (b) a bucket we give them with a scoped credential or a presigned upload, ingested on notification or on
//      a sweep, idempotent per object, a result object written back; (c) a scheduled pull from a URL they expose, with their
//      token stored as a secret, an authentication header, no redirects, an allowed host, and an alert; (d) a script for a
//      person on our side to load a customer file with the two headers; and the on-demand pull limited to allowed hosts.
//    - **Starts from:** `src/content/import.ts` (`HttpJsonSource`: JSON only, no auth header, follows redirects),
//      `wrangler.toml` (no cron pulls), `scripts/import-content.mjs` (demo only).
//    - **Needed by:** (b) and (c) only if Tapestry chooses them in week 2 after the kickoff; (d) before the first dataset;
//      the allow-list now. Within a day or two each; hours for the allow-list."
// §3 decision 4: "Order: group A before Tapestry's December test; group B before the first activation; group C's (b) and (c)
// only if Tapestry chooses them". D3 (program.json, R-P341): "(b) the bucket drop and (c) the scheduled pull are not built in
// this ticket … EX3 and EX4 are DECISION criteria on this decision; (d) the manual-upload script and the host allow-list on
// the on-demand pull are built here."
//
// THE READINGS (the lead's, S29 brief as amended by R-P344; provisional until ratified):
//   1  EX1, the script. `node scripts/import-content.mjs --scope <tenant> --file <path> [--format json|csv]
//      [--mode merge|replace] [--dry-run] [--base <url>] [--token <jwt>]` reads the catalogue draft in force and posts the file
//      as `POST /content/catalog/import?scope=&format=&mode=` (`&dryRun=1` with `--dry-run`) with `If-Match` from that read
//      and the derived `Idempotency-Key` ("N:UUID", N the draft's revision), always naming the mode (default `merge`); a CSV
//      body goes as `text/csv`, the format following `--format` or the file's extension. It prints the answer (`revision`,
//      `changed`, `removed`, `skipped`, `dryRun` when the server says them, the `diagnostics`) and exits 0 on 200, 1 on a
//      server refusal with the body's errors printed, 2 on a local refusal before any request — no token for a non-loopback
//      target (today's `resolveToolToken` rule), an unreadable file, an unknown format or mode, and `--mode full` (refused
//      locally, naming the API and its guard) — printed as `import-content: …` with no stack trace. The demo pull path (no
//      `--file`) stays as today (W39.H3 and scripts/lib/tool-token.test.mjs are its locks).
//   2  EX2 (a), the scheme: the pull requires `https:`; `http:` only for `localhost`, `127.0.0.1`, `[::1]`; any other URL 400
//      naming https, nothing fetched, nothing written.
//   3  EX2 (b), redirects: the fetch runs with `redirect: 'manual'`; a 3xx answer is 502 with the `errors` list like the
//      other pull failures ("pull failed: source answered 301; redirects are not followed"); nothing written.
//   4  EX2 (c), the host list: `import-sources` becomes `{ addresses?, hosts? }`, at least one present, each 1 to 64
//      entries, no other key; a `hosts` entry is an exact lowercase hostname or an IP literal as the URL parser renders it
//      (IPv6 in brackets), with an optional `:port` 1–65535; an entry naming the scheme's default port (`:443`, `:80`) is
//      refused 422 by name, not normalized; no wildcard, scheme or path. The match is the URL's hostname plus its port
//      exactly as the parser gives them (a default port in the URL is absent, so it matches an entry without one). With
//      `hosts` published, a pull whose host is not listed answers 403 naming `import-sources` and the host, the fetch never
//      called, nothing written; with no `hosts`, any host as today; a document with `hosts` only restricts no caller. THE
//      ORDER on the pull: authority → the body → the caller list `addresses` (403) → `mode` (400) → `expire` presence (428)
//      → the scheme (400) → the host list (403) → the preconditions (428/409) → the fetch (502) → assembly → the guard count
//      → the write. Kit 02's pull row states https, no redirects and the host list; kit 03's import-sources paragraph states
//      `hosts`; both of today's sentences locked RED.
//   5  EX3/EX4: no legs (D3); one lock reads the files: `wrangler.toml`'s three crons unchanged and no bucket binding beyond
//      `STORAGE` in `src/types/env.ts`.
//   6  Locks: W19's pull tests, P82, P38, P91's legs, content.test.ts's pulls, the publication tests; PUT and validate
//      unchanged.
//
// SETTLED IN THE PROVISIONAL (for the lead):
//   · EX1's harness is the precedent's form (src/units/W39/LEDGER.unit.test.ts `localWorker` and `runScript`): the script runs
//     as a child process (it is a top-level module whose every request is a global `fetch`, so it can only be measured from
//     outside), preloaded with a guard that records every fetch it makes and refuses any but the loopback target, against a
//     loopback HTTP server that forwards each request to the parity mount's in-process app (`m.fetch`: both shopper hosts,
//     the operator authority, the publication set the other parity units use) and records what it received and answered.
//     The script is handed the mount's operator token (`--token`); the refusal legs give the child signing material and the
//     demo profile, so a script that minted for a non-loopback target would reach the network and be seen.
//   · EX2's host list as an optional `hosts` member of P91's `import-sources` (not a separate kind): the kind is already an
//     optional publication member registered in `src/config/publication.ts` (`KINDS`, `kindFor`, `OPTIONAL_MEMBERS`) and
//     admitted by `src/customerBoundary.ts`'s `:kind` pattern, and neither file is in P90's grant, so a new kind could not be
//     registered by this ticket; the member needs only `src/content/import.ts` (the validator, `{ addresses?, hosts? }`) and
//     `src/routes/content.ts` (`sourceRefusal` reading `addresses` only when present, and the pull's host check).
//
// R10 SWEEP: no collision found. Every pull in src/**/*.test.ts and src/units/** names an `https:` URL (content.test.ts,
// W19 B1–B3, P44, P82, P91) or a loopback `http:` one (W39.H3's demo pull through `scripts/import-content.mjs`); no fake feed
// answers a redirect; content.test.ts :858's `file:` URL is refused 400 before and after; W39.H3 asserts only that a
// refused run exits non-zero and sends nothing, so the local refusal's exit 2 keeps it.
// DEFERRED: LV1 (both hosts and a customer-profile stamp for the script and the pull); the pack's sentences are the
// documents lane's. TOLD: (b) and (c) are not built (D3).
//
// R-P349 (the spec review at 39a520fa): four assertions added, none changed — EX1's loading leg shows the Idempotency-Key
// derived from the request (two identical dry runs over one draft send one key, another file another key, a later draft its
// own N); EX2's scheme leg adds the 303 and 308 answers; EX2's hosts leg shows the scheme before the host list (an http: URL
// to an unlisted host 400 naming https, not 403); the kit leg binds phrases ("`http:` only on localhost…", "redirects are
// not followed" or "no redirect" with 502), today's row locked RED.
// RULED (R-P345): the readings as amended by R-P344 ratified; the harness form accepted; the `hosts` member confirmed; the
// scheme check moves ahead of the preconditions and the non-loopback refusal becomes exit 2 with `import-content: …`, the
// demo path alike; the no-collision sweep of the pull tests accepted.
// MEASURED at 5be67f91 (_evidence/parity-step3/S29/specifier/logs/a/ and b/, serial, --no-cache, working directory the tree):
// today 15 RED for the missing behaviour (the script has no --file and pulls the demo catalogue; an http: or redirecting
// feed is fetched and written; a `hosts` member is refused as another key; the kit silent); the fix (sketches/p90.py:
// scripts/import-content.mjs, src/content/import.ts, src/routes/content.ts, the kit; its host-entry rule refuses a wildcard,
// which the URL parser renders as itself) 15/15 three times; the wrong fixes, each RED on its own legs: `noifmatch`,
// `nokey` and `nomode` EX1's legs ×4 each (the refused record's 422 becomes 428 or 400), `mintremote` EX1's refusal leg ×2,
// `httpanywhere` and `followredirects` EX2's scheme-and-redirect leg ×2 each, `hostafterfetch` EX2's hosts and customer
// legs ×4, `hostsuffix` EX2's hosts leg ×2, `hostimportonly` EX2's hosts, together and customer legs ×6, `kitleft` the kit
// leg; tsc exit 0 on both. Locks: W19 B1–B3, P82, P38, P91, content.test.ts and the publication tests 122/122 on both
// trees; W39 (each scratch copy given a .git of its own) 7/12 on both, the five H3 tests passing, H1, H2, H4 ×2 and H5
// failing alike (the scratch layout), not counted.
// COLLISION FOUND (ruled R-P347): scripts/lib/tool-token.test.mjs (node --test) :169–175 and :203–213 drive every family
// script through a synthetic adapter and expect a token refusal as a thrown `Operator credentials unavailable` with no
// output; R-P345's exit 2 with `import-content: …` makes the import-content cases answer `synthetic exit 2` with one output
// line, so "import-content: unsafe configuration stops…" and "import-content: CLI precedence and remote token path…" fail
// (28/35 under the fix against 30/35 today; the five failing on both trees, acceptance-run's four and W03.03, are the
// scratch layout's). R10 GRANTED (R-P347, test-only, R-P195's form) and written: scripts/lib/tool-token.test.mjs :166–172 (a
// helper `tokenRefused`), :169–175 → :176–182 ("unsafe configuration stops…": for `import-content` `synthetic exit 2` and the
// one output line `import-content: Operator credentials unavailable…`, the empty-output check kept for every other script)
// and :203–213 → :210–220 ("CLI precedence and remote token path…": the two refusal loops through `tokenRefused`); nothing
// sent in every case; every other script's cases unchanged.
//
// HARNESS: src/units/_parity.ts (the mounted app, both hosts, the operator routes), src/units/_parity5.ts (the home page's
// pieces and documents, `putKind`) and src/units/W08/_customer.ts (the in-process customer stamp). Imports from src/units/:
// ../_parity, ../_parity5, ../W08/_customer.

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

// The customer stamp loads the real Worker (src/index.ts); the module doubles its harness names (src/units/W08/_customer.ts).
vi.mock('agents', () => ({ routeAgentRequest: async () => { throw new Error('the Agents router is not on these paths'); } }));
vi.mock('agents/ai-chat-agent', () => ({ AIChatAgent: class {} }));
vi.mock('@cloudflare/puppeteer', () => ({ default: {} }));

import { initializePublicationSet, invalidatePublicationCache, type PublicationBaseline } from '@/config/publication';
import { invalidateCache, type DocumentKind } from '@/config/versionedStore';
import { CONTENT_KIND, LEARN_KIND, SLOTS_KIND } from '@/content/kinds';
import { EMPTY_PROPOSALS, PROPOSALS_KIND } from '@/learn/cycle';
import { EMPTY_PRIORS, PRIORS_KIND } from '@/learn/priors';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import type { Env } from '@/types/env';

import { asOperator, errorsOf, expectPublished, HOSTS, loadDocument, mount, readTree, REFLEX_DOCUMENT, TENANT, type Answer, type Mounted } from '../_parity';
import { HERO, HOME_PIECES, homeLearn, homeSlots, putKind } from '../_parity5';
import { customerStamp, TENANT as CUSTOMER_TENANT, type Stamp } from '../W08/_customer';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SCRIPT = join(ROOT, 'scripts', 'import-content.mjs');
const piece = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, customerContentId: `CMS-${id.toUpperCase()}`, type: 'editorial', title: `Story ${id}`, tags: { line: ['Tabby'] }, slotTypes: [HERO], ...extra });
const DOCS = { pieces: [...HOME_PIECES], slots: homeSlots(), learn: homeLearn() };
const show = (a: Answer) => `${a.status} ${JSON.stringify(a.body).slice(0, 300)}`;
const draftOf = async (m: Mounted) => { const d = await loadDocument(m, 'catalog');
  return { revision: d.revision, ifMatch: `"${d.revision}/${d.publication.revision}/${d.publication.digest}"`, ids: (d.document.pieces as Array<{ id: string }>).map(p => p.id) }; };
const preconditions = async (m: Mounted) => { const d = await draftOf(m); return { 'If-Match': d.ifMatch, 'Idempotency-Key': `${d.revision}:${crypto.randomUUID()}` }; };

// ── EX1's harness: the parity mount behind a loopback server, the script as a guarded child ─────────────────

/** What the loopback server received and what the mounted app answered. */
interface Received { method: string; path: string; query: Record<string, string>; contentType: string | null; ifMatch: string | null;
  idempotencyKey: string | null; body: string; status: number; answer: Record<string, unknown> }
async function behind(m: Mounted) {
  const received: Received[] = [];
  let port = 0;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => { void (async () => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) if (value !== undefined && name !== 'host' && name !== 'content-length') headers.set(name, Array.isArray(value) ? value.join(', ') : value);
      const body = Buffer.concat(chunks).toString('utf8');
      const response = await m.fetch(new Request(`https://ops.invalid${req.url}`, { method: req.method, headers, ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body }) }));
      const text = await response.text();
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      let answer: Record<string, unknown> = {};
      try { answer = JSON.parse(text) as Record<string, unknown>; } catch { answer = {}; }
      received.push({ method: req.method ?? '', path: url.pathname, query: Object.fromEntries(url.searchParams), contentType: headers.get('content-type'),
        ifMatch: headers.get('if-match'), idempotencyKey: headers.get('idempotency-key'), body, status: response.status, answer });
      res.writeHead(response.status, { 'Content-Type': response.headers.get('content-type') ?? 'application/json' }); res.end(text);
    })().catch(error => { res.writeHead(500); res.end(String(error)); }); });
  });
  await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  port = (server.address() as AddressInfo).port;
  return { base: `http://127.0.0.1:${port}`, received: () => [...received], close: () => new Promise<void>(accept => server.close(() => accept())) };
}
/** Files the script loads, and the guard every script child is preloaded with (left in the system's temporary directory). */
const SCRATCH = mkdtempSync(join(tmpdir(), 'p90-ledger-'));
const GUARD = join(SCRATCH, 'guard.mjs');
writeFileSync(GUARD, `import fs from 'node:fs';
const log = process.env.P90_GUARD_LOG, allow = process.env.P90_GUARD_ALLOW || '\\u0000', realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  fs.appendFileSync(log, JSON.stringify(url) + '\\n');
  if (url.startsWith(allow)) return realFetch(input, init);
  throw new TypeError('P90 guard: network refused');
};
`);
let runs = 0;
interface Run { code: number | null; stdout: string; stderr: string; fetches: string[] }
/** The script as a person runs it: a child process, the guard recording every request it makes. */
function runScript(args: string[], allow?: string): Promise<Run> {
  const log = join(SCRATCH, `fetches-${++runs}.ndjson`); writeFileSync(log, '');
  return new Promise(accept => {
    const child = spawn(process.execPath, ['--import', pathToFileURL(GUARD).href, SCRIPT, ...args], { cwd: ROOT, timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH ?? '', HOME: SCRATCH, P90_GUARD_LOG: log, ...(allow ? { P90_GUARD_ALLOW: allow } : {}),
        // Signing material and the demo profile: a script that minted for a non-loopback target would reach the network here.
        DEPLOYMENT_PROFILE: 'demo', JWT_SECRET: 'p90-synthetic-signing-material-for-the-refusal-legs', JWT_ISSUER: 'i', JWT_AUDIENCE: 'a' } });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk; }); child.stderr.on('data', (chunk: Buffer) => { stderr += chunk; });
    child.on('close', code => accept({ code, stdout, stderr, fetches: readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as string) }));
  });
}
let files = 0;
const fileOf = (name: string, text: string) => { const path = join(SCRATCH, `${++files}-${name}`); writeFileSync(path, text); return path; };
/** The answer the script printed: the JSON object on its output that carries a `revision` or `errors`, else null. */
const printed = (run: Run): Record<string, unknown> | null => {
  for (const line of `${run.stdout}\n${run.stderr}`.split('\n')) {
    const at = line.indexOf('{'); if (at < 0) continue;
    try { const value = JSON.parse(line.slice(at)) as Record<string, unknown>; if ('revision' in value || 'errors' in value) return value; } catch { /* not the answer */ }
  }
  return null;
};
const answerMembers = (a: Record<string, unknown> | null | undefined) => a ? { revision: a.revision, changed: a.changed, removed: a.removed,
  skipped: a.skipped ?? 'absent', dryRun: a.dryRun ?? 'absent', diagnostics: a.diagnostics === undefined ? 'absent' : 'present' } : 'nothing printed';
const UUID8 = '[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const CSV = (records: Array<Record<string, unknown>>) => ['id,customerContentId,type,title,tags,slotTypes',
  ...records.map(r => [r.id, r.customerContentId, r.type, r.title, `line:${(r.tags as { line: string[] }).line.join('|')}`, (r.slotTypes as string[]).join('|')].join(','))].join('\n') + '\n';

// ===========================================================================
// unit:P90.EX1 — a person loads a customer file with one command
// ===========================================================================

describe('unit:P90.EX1', () => {
  for (const host of HOSTS) {
    it(`host (${host}): the script loads a JSON file and a CSV file with merge named, each request carrying If-Match from the draft read and the derived Idempotency-Key; --mode replace and --dry-run named; the answer printed (revision, changed, removed, skipped, dryRun, diagnostics) and exit 0`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P90.EX1 — the tenant documents publish');
      const server = await behind(m);
      try {
        const token = m.operatorToken, common = ['--scope', TENANT, '--base', server.base, '--token', token];
        const json = fileOf('feed.json', JSON.stringify([piece('p90.json-one'), piece('p90.json-two')]));
        const csv = fileOf('feed.csv', CSV([piece('p90.csv-one')]));
        const steps: Array<[string, string[], string]> = [
          ['JSON, merge by default', ['--file', json], 'json'], ['CSV by its extension, merge by default', ['--file', csv], 'csv'],
          ['the same JSON again (skipped)', ['--file', json], 'json'], ['--mode replace', ['--file', json, '--mode', 'replace'], 'json'],
          ['--dry-run', ['--file', csv, '--mode', 'merge', '--dry-run'], 'csv'],
        ];
        const seen: unknown[] = [];
        for (const [name, args] of steps) {
          const draft = await draftOf(m), from = server.received().length;
          const run = await runScript([...common, ...args], server.base);
          const requests = server.received().slice(from), write = requests.find(r => r.method === 'POST');
          const text = readFileSync(args[1]!, 'utf8');
          seen.push({ name, code: run.code, requests: requests.map(r => `${r.method} ${r.path}`),
            query: write ? Object.fromEntries(Object.entries(write.query).filter(([k]) => ['scope', 'format', 'mode', 'dryRun'].includes(k))) : 'no import',
            contentType: write?.contentType?.split(';')[0]?.trim() ?? 'no import', ifMatch: write?.ifMatch === draft.ifMatch ? 'the draft read' : write?.ifMatch ?? 'none',
            key: new RegExp(`^${draft.revision}:${UUID8}$`).test(write?.idempotencyKey ?? '') ? `${draft.revision}:UUID v8` : write?.idempotencyKey ?? 'none',
            body: write?.body === text ? 'the file' : 'not the file', printed: JSON.stringify(answerMembers(printed(run))) === JSON.stringify(answerMembers(write?.answer)) ? 'the answer' : `${JSON.stringify(answerMembers(printed(run)))} against ${JSON.stringify(answerMembers(write?.answer))}`,
            status: write?.status ?? 'no import' });
        }
        const expected = (name: string, format: string, mode: string, status: number, dryRun = false) => ({ name, code: 0, requests: ['GET /content/catalog', 'POST /content/catalog/import'],
          query: { scope: TENANT, format, mode, ...(dryRun ? { dryRun: '1' } : {}) }, contentType: format === 'csv' ? 'text/csv' : 'application/json',
          ifMatch: 'the draft read', key: expect.stringMatching(/^\d+:UUID v8$/), body: 'the file', printed: 'the answer', status });
        expect.soft(seen, `${host}: P90.EX1 — each load as the readings name it (today the script has no --file: it pulls the demo catalogue)`).toEqual([
          expected('JSON, merge by default', 'json', 'merge', 200), expected('CSV by its extension, merge by default', 'csv', 'merge', 200),
          expected('the same JSON again (skipped)', 'json', 'merge', 200), expected('--mode replace', 'json', 'replace', 200), expected('--dry-run', 'csv', 'merge', 200, true)]);
        const answers = server.received().filter(r => r.method === 'POST').map(r => [r.answer.skipped ?? false, r.answer.dryRun ?? false]);
        expect.soft(answers, `${host}: PRECONDITION — the server skipped the identical re-load and answered the dry run`).toEqual([[false, false], [false, false], [true, false], [false, false], [false, true]]);
        // R-P349: the Idempotency-Key is derived from the request, never random — two identical dry runs over one draft send
        // one key, another file another key; a draft at another revision names its own N.
        const keyOf = async (args: string[]) => { const from = server.received().length; await runScript([...common, ...args], server.base);
          return server.received().slice(from).find(r => r.method === 'POST')?.idempotencyKey ?? 'none'; };
        const draft = await draftOf(m);
        const sameA = await keyOf(['--file', csv, '--dry-run']), sameB = await keyOf(['--file', csv, '--dry-run']), other = await keyOf(['--file', json, '--dry-run']);
        const written = await keyOf(['--file', fileOf('next.json', JSON.stringify([piece('p90.next')]))]);
        const after = await draftOf(m);
        const later = await keyOf(['--file', csv, '--dry-run']);
        expect.soft({ identical: sameA === sameB ? 'one key' : `two keys (${sameA} / ${sameB})`, otherFile: other !== sameA ? 'another key' : 'the same key',
          n: [sameA.split(':')[0], written.split(':')[0], later.split(':')[0]], laterKey: later !== sameA ? 'another key' : 'the same key' },
        `${host}: P90.EX1 — the key is the request's: deterministic, bound to the file and to the draft`).toEqual({ identical: 'one key', otherFile: 'another key',
          n: [String(draft.revision), String(draft.revision), String(after.revision)], laterKey: 'another key' });
      } finally { await server.close(); }
    }, 180_000);

    it(`host (${host}): a refused record is printed with exit 1; a local refusal exits 2 before any request, printed as import-content: with no stack trace — a non-loopback target with no token (signing material present), an unreadable file, an unknown format, an unknown mode, --mode full (naming the API and its guard)`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P90.EX1 — the tenant documents publish');
      const server = await behind(m);
      try {
        const before = await draftOf(m);
        const bad = fileOf('bad.json', JSON.stringify([piece('p90.good'), { ...piece('p90.bad'), title: undefined }]));
        const refused = await runScript(['--scope', TENANT, '--base', server.base, '--token', m.operatorToken, '--file', bad], server.base);
        const errors = (printed(refused)?.errors ?? []) as unknown[];
        expect.soft([refused.code, errors.some(e => String(e).startsWith("records[1] 'p90.bad'.title")) ? 'the record named' : `${JSON.stringify(errors).slice(0, 200)} / ${refused.stdout.slice(0, 200)}`],
          `${host}: P90.EX1 — a server refusal exits 1 with the body's errors printed (P82's address)`).toEqual([1, 'the record named']);
        const json = fileOf('ok.json', JSON.stringify([piece('p90.local')]));
        const from = server.received().length;
        const locals: Array<[string, Run]> = [
          ['a non-loopback target, no token', await runScript(['--scope', TENANT, '--base', 'https://ops.example.invalid', '--file', json])],
          ['an unreadable file', await runScript(['--scope', TENANT, '--base', server.base, '--token', m.operatorToken, '--file', join(SCRATCH, 'missing.json')], server.base)],
          ['an unknown format', await runScript(['--scope', TENANT, '--base', server.base, '--token', m.operatorToken, '--file', json, '--format', 'xml'], server.base)],
          ['an unknown mode', await runScript(['--scope', TENANT, '--base', server.base, '--token', m.operatorToken, '--file', json, '--mode', 'upsert'], server.base)],
          ['--mode full', await runScript(['--scope', TENANT, '--base', server.base, '--token', m.operatorToken, '--file', json, '--mode', 'full'], server.base)],
        ];
        const local = (name: string, run: Run) => [name, run.code, run.fetches.length,
          /^import-content: /m.test(run.stderr) ? 'import-content: …' : `not so (${run.stderr.slice(0, 160)})`, /\n\s+at /.test(run.stderr) ? 'a stack trace' : 'no stack trace',
          name === 'a non-loopback target, no token' ? (/token/i.test(run.stderr) ? 'names the token' : 'does not name the token')
            : name === '--mode full' ? (/\/content\/catalog\/import/.test(run.stderr) && /expire/.test(run.stderr) ? 'names the API and its guard' : 'does not name them') : 'named'];
        expect.soft(locals.map(([name, run]) => local(name, run)), `${host}: P90.EX1 — each refused locally, exit 2, before any request`).toEqual(locals.map(([name]) => [name, 2, 0,
          'import-content: …', 'no stack trace', name === 'a non-loopback target, no token' ? 'names the token' : name === '--mode full' ? 'names the API and its guard' : 'named']));
        expect.soft([server.received().length - from, (await draftOf(m)).revision], `${host}: P90.EX1 — the server received nothing from the local refusals, and nothing was written`).toEqual([0, before.revision]);
      } finally { await server.close(); }
    }, 180_000);
  }
});

// ===========================================================================
// unit:P90.EX2 — the on-demand pull: https only, no redirect, the tenant's hosts
// ===========================================================================

/** A fake feed for the pull, behaving as fetch does: it follows a redirect unless `redirect: 'manual'` is asked. URLs are
 * compared as the URL parser renders them (a lowercase host, no default port); every fetch of a test host is recorded. */
function feed(routes: Record<string, { status: number; location?: string; records?: unknown[] }>) {
  const fetched: string[] = [];
  const original = globalThis.fetch;
  const href = (url: string) => { try { return new URL(url).href; } catch { return url; } };
  const table = new Map(Object.entries(routes).map(([url, route]) => [href(url), route] as const));
  const testHost = (url: string) => { try { return /(^|\.)example\.invalid$|\.evil\.test$|^localhost$|^127\.0\.0\.1$|^\[::1\]$|^203\.0\.113\.9$|^\[2001:db8::1\]$/.test(new URL(url).hostname); } catch { return false; } };
  const answer = (url: string): Response => {
    const route = table.get(href(url));
    if (!route) return new Response('not found', { status: 404 });
    return route.location ? new Response(null, { status: route.status, headers: { Location: route.location } })
      : new Response(JSON.stringify({ content: route.records ?? [] }), { status: route.status, headers: { 'Content-Type': 'application/json' } });
  };
  const stub = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!testHost(url)) return original(input, init);
    fetched.push(href(url));
    let response = answer(url);
    for (let hops = 0; hops < 5 && init?.redirect !== 'manual' && response.status >= 300 && response.status < 400 && response.headers.get('Location'); hops++) {
      const next = response.headers.get('Location')!; fetched.push(href(next)); response = answer(next);
    }
    return response;
  });
  return { fetched: () => [...fetched], restore: () => stub.mockRestore() };
}
const FEED_RECORDS = [piece('p90.pulled')];
const pullFrom = async (m: Mounted, url: string, headers?: Record<string, string>) =>
  asOperator(m, 'POST', `/content/catalog/pull?scope=${TENANT}`, { url, path: 'content', mode: 'merge' }, headers ?? await preconditions(m));
const catalogue = async (m: Mounted) => { const d = await draftOf(m); return { revision: d.revision, ids: d.ids }; };

describe('unit:P90.EX2', () => {
  for (const host of HOSTS) {
    it(`host (${host}): the scheme and redirects — an http: URL outside loopback is refused 400 naming https before the preconditions, nothing fetched; http: on localhost, 127.0.0.1 and [::1] is accepted; a 301, 302 or 307 answer is 502 (pull failed: source answered …; redirects are not followed), nothing written`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P90.EX2 — the tenant documents publish');
      const f = feed({
        'http://localhost:9/p90.json': { status: 200, records: [piece('p90.local-a')] }, 'http://127.0.0.1:9/p90.json': { status: 200, records: [piece('p90.local-b')] },
        'http://[::1]:9/p90.json': { status: 200, records: [piece('p90.local-c')] },
        'https://cms.example.invalid/moved-301.json': { status: 301, location: 'https://cms.example.invalid/feed.json' },
        'https://cms.example.invalid/moved-302.json': { status: 302, location: 'https://cms.example.invalid/feed.json' },
        'https://cms.example.invalid/moved-307.json': { status: 307, location: 'https://cms.example.invalid/feed.json' },
        'https://cms.example.invalid/moved-303.json': { status: 303, location: 'https://cms.example.invalid/feed.json' },
        'https://cms.example.invalid/moved-308.json': { status: 308, location: 'https://cms.example.invalid/feed.json' },
        'https://cms.example.invalid/feed.json': { status: 200, records: FEED_RECORDS },
        'http://cms.example.invalid/feed.json': { status: 200, records: FEED_RECORDS },
      });
      try {
        const before = await catalogue(m);
        const plain = await pullFrom(m, 'http://cms.example.invalid/feed.json');
        const plainBare = await pullFrom(m, 'http://cms.example.invalid/feed.json', {});
        const afterPlain = { fetched: f.fetched().length, catalogue: await catalogue(m) };
        const loopback = [];
        for (const url of ['http://localhost:9/p90.json', 'http://127.0.0.1:9/p90.json', 'http://[::1]:9/p90.json']) loopback.push([url, (await pullFrom(m, url)).status]);
        const middle = await catalogue(m);
        const redirects = [];
        for (const code of [301, 302, 303, 307, 308]) {
          const a = await pullFrom(m, `https://cms.example.invalid/moved-${code}.json`);
          redirects.push([code, a.status, errorsOf(a).some(e => e.includes(`pull failed: source answered ${code}`) && /redirects are not followed/.test(e)) ? 'named' : `not named (${show(a)})`]);
        }
        expect.soft({ plain: [plain.status, errorsOf(plain).some(e => /https/.test(e)) ? 'names https' : `does not (${show(plain)})`], plainBare: plainBare.status, afterPlain },
          `${host}: P90.EX2 — http: outside loopback refused 400 before the preconditions, nothing fetched, nothing written (today it is fetched and written)`).toEqual({
          plain: [400, 'names https'], plainBare: 400, afterPlain: { fetched: 0, catalogue: before } });
        expect.soft(loopback, `${host}: P90.EX2 — LOCK: http: on a loopback host is accepted`).toEqual([['http://localhost:9/p90.json', 200], ['http://127.0.0.1:9/p90.json', 200], ['http://[::1]:9/p90.json', 200]]);
        expect.soft({ redirects, written: await catalogue(m) }, `${host}: P90.EX2 — a redirect is refused 502 by name and not followed, nothing written (today it is followed)`).toEqual({
          redirects: [[301, 502, 'named'], [302, 502, 'named'], [303, 502, 'named'], [307, 502, 'named'], [308, 502, 'named']], written: middle });
      } finally { f.restore(); }
    }, 180_000);

    it(`host (${host}): with import-sources hosts published, a listed host is pulled (a hostname case-insensitively, a default port, an IP literal, an IPv6 literal, a listed port) and an unlisted one refused 403 naming import-sources and the host, the fetch never called, nothing written — another host, a suffix, a substring, a subdomain, a port not listed, a port named for an entry without one; the host list before the preconditions; hosts alone restrict no caller`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P90.EX2 — the tenant documents publish');
      const listed = await putKind(m, 'import-sources', { hosts: ['cms.example.invalid', 'feeds.example.invalid:8443', '203.0.113.9', '[2001:db8::1]'] }, 'p90 hosts');
      const ok = { status: 200, records: FEED_RECORDS };
      const f = feed({ 'https://cms.example.invalid/feed.json': ok, 'https://feeds.example.invalid:8443/feed.json': ok, 'https://203.0.113.9/feed.json': ok,
        'https://[2001:db8::1]/feed.json': ok, 'https://evil.example.invalid/feed.json': ok, 'https://cms.example.invalid.evil.test/feed.json': ok,
        'https://evilcms.example.invalid/feed.json': ok, 'https://a.cms.example.invalid/feed.json': ok, 'https://feeds.example.invalid/feed.json': ok,
        'https://cms.example.invalid:8443/feed.json': ok });
      try {
        const admitted = [];
        for (const url of ['https://cms.example.invalid/feed.json', 'https://CMS.EXAMPLE.INVALID/feed.json', 'https://cms.example.invalid:443/feed.json',
          'https://feeds.example.invalid:8443/feed.json', 'https://203.0.113.9/feed.json', 'https://[2001:db8::1]/feed.json']) admitted.push([url, (await pullFrom(m, url)).status]);
        const before = { fetched: f.fetched().length, catalogue: await catalogue(m) };
        const refused = [];
        for (const [url, hostShown] of [['https://evil.example.invalid/feed.json', 'evil.example.invalid'], ['https://cms.example.invalid.evil.test/feed.json', 'cms.example.invalid.evil.test'],
          ['https://evilcms.example.invalid/feed.json', 'evilcms.example.invalid'], ['https://a.cms.example.invalid/feed.json', 'a.cms.example.invalid'],
          ['https://feeds.example.invalid/feed.json', 'feeds.example.invalid'], ['https://cms.example.invalid:8443/feed.json', 'cms.example.invalid:8443']] as Array<[string, string]>) {
          const a = await pullFrom(m, url);
          refused.push([url, a.status, errorsOf(a).some(e => e.includes('import-sources') && e.includes(hostShown)) ? 'names import-sources and the host' : `does not (${show(a)})`]);
        }
        // R-P349: the scheme before the host list — an http: URL to an unlisted, non-loopback host is refused 400 naming https.
        const plainUnlisted = await pullFrom(m, 'http://evil.example.invalid/feed.json');
        expect.soft([plainUnlisted.status, errorsOf(plainUnlisted).some(e => /https/.test(e)) ? 'names https' : `does not (${show(plainUnlisted)})`],
          `${host}: P90.EX2 — the scheme is checked before the host list`).toEqual([400, 'names https']);
        const unlistedBare = await pullFrom(m, 'https://evil.example.invalid/feed.json', {});
        const listedBare = await pullFrom(m, 'https://cms.example.invalid/feed.json', {});
        const after = { fetched: f.fetched().length, catalogue: await catalogue(m) };
        const anyCaller = await asOperator(m, 'POST', `/content/catalog/import?scope=${TENANT}&mode=merge`, [piece('p90.any-caller')], await preconditions(m));
        expect.soft({ listed: listed.status, admitted }, `${host}: P90.EX2 — the listed hosts are pulled (today the hosts member is refused or ignored)`).toEqual({ listed: 200,
          admitted: [['https://cms.example.invalid/feed.json', 200], ['https://CMS.EXAMPLE.INVALID/feed.json', 200], ['https://cms.example.invalid:443/feed.json', 200],
            ['https://feeds.example.invalid:8443/feed.json', 200], ['https://203.0.113.9/feed.json', 200], ['https://[2001:db8::1]/feed.json', 200]] });
        expect.soft({ refused, unlistedBare: unlistedBare.status, listedBare: listedBare.status, written: after },
          `${host}: P90.EX2 — the unlisted hosts refused 403 by name, the fetch never called, nothing written; the host list before the preconditions`).toEqual({
          refused: refused.map(([url]) => [url, 403, 'names import-sources and the host']), unlistedBare: 403, listedBare: 428, written: before });
        expect.soft(anyCaller.status, `${host}: P90.EX2 — a document with hosts alone restricts no caller (no CF-Connecting-IP needed)`).toBe(200);
      } finally { f.restore(); }
    }, 180_000);

    it(`host (${host}): LOCK — with no hosts any https host is pulled as today (no list, and an addresses-only list); with addresses and hosts together, the caller list and the host list each refuse`, async () => {
      const ok = { status: 200, records: FEED_RECORDS };
      const f = feed({ 'https://anywhere.example.invalid/feed.json': ok, 'https://cms.example.invalid/feed.json': ok, 'https://evil.example.invalid/feed.json': ok });
      try {
        const open = await mount(host, DOCS);
        expectPublished(open, 'P90.EX2 — the tenant documents publish');
        const noList = await pullFrom(open, 'https://anywhere.example.invalid/feed.json');
        const callers = await mount(host, DOCS);
        expectPublished(callers, 'P90.EX2 — the tenant documents publish');
        expect((await putKind(callers, 'import-sources', { addresses: ['203.0.113.7'] }, 'p90 callers')).status, 'PRECONDITION: an addresses-only list publishes').toBe(200);
        const addressesOnly = await pullFrom(callers, 'https://anywhere.example.invalid/feed.json', { ...await preconditions(callers), 'CF-Connecting-IP': '203.0.113.7' });
        const both = await mount(host, DOCS);
        expectPublished(both, 'P90.EX2 — the tenant documents publish');
        const published = await putKind(both, 'import-sources', { addresses: ['203.0.113.7'], hosts: ['cms.example.invalid'] }, 'p90 both');
        const inside = await pullFrom(both, 'https://cms.example.invalid/feed.json', { ...await preconditions(both), 'CF-Connecting-IP': '203.0.113.7' });
        const outsideCaller = await pullFrom(both, 'https://cms.example.invalid/feed.json', { ...await preconditions(both), 'CF-Connecting-IP': '192.0.2.1' });
        const outsideHost = await pullFrom(both, 'https://evil.example.invalid/feed.json', { ...await preconditions(both), 'CF-Connecting-IP': '203.0.113.7' });
        expect.soft({ noList: noList.status, addressesOnly: addressesOnly.status }, `${host}: P90.EX2 — LOCK: no hosts, any https host`).toEqual({ noList: 200, addressesOnly: 200 });
        expect.soft({ published: published.status, inside: inside.status, outsideCaller: outsideCaller.status, outsideHost: [outsideHost.status, errorsOf(outsideHost).some(e => e.includes('evil.example.invalid')) ? 'names the host' : `does not (${show(outsideHost)})`] },
          `${host}: P90.EX2 — addresses and hosts together, each refusing (today the document with hosts is refused)`).toEqual({ published: 200, inside: 200, outsideCaller: 403, outsideHost: [403, 'names the host'] });
      } finally { f.restore(); }
    }, 180_000);

    it(`host (${host}): import-sources refuses by name a malformed document — none of its members, an empty or over-long hosts list, a wildcard, an uppercase name, a default port, a port out of range, a scheme, a path, another key — and admits hostnames, IP literals and ports, alone or beside addresses`, async () => {
      const m = await mount(host, DOCS);
      expectPublished(m, 'P90.EX2 — the tenant documents publish');
      const put = async (document: unknown) => { const a = await putKind(m, 'import-sources', document, 'p90 validation');
        return [a.status, a.status === 422 ? (errorsOf(a).some(e => e.includes('hosts')) ? 'names hosts' : `does not name hosts (${show(a)})`) : 'admitted']; };
      const refusals: Record<string, unknown> = {
        none: await put({}), empty: await put({ hosts: [] }), overLong: await put({ hosts: Array.from({ length: 65 }, (_, i) => `h${i}.example.invalid`) }),
        wildcard: await put({ hosts: ['*.example.invalid'] }), uppercase: await put({ hosts: ['CMS.example.invalid'] }), defaultHttps: await put({ hosts: ['cms.example.invalid:443'] }),
        defaultHttp: await put({ hosts: ['cms.example.invalid:80'] }), portRange: await put({ hosts: ['cms.example.invalid:70000'] }), scheme: await put({ hosts: ['https://cms.example.invalid'] }),
        path: await put({ hosts: ['cms.example.invalid/feed'] }), otherKey: await put({ hosts: ['cms.example.invalid'], urls: ['x'] }),
      };
      const admitted = { hostsAlone: await put({ hosts: ['cms.example.invalid', 'feeds.example.invalid:8443', '203.0.113.9', '[2001:db8::1]:8443'] }),
        withAddresses: await put({ addresses: ['203.0.113.7'], hosts: ['cms.example.invalid'] }) };
      expect.soft({ refusals, admitted }, `${host}: P90.EX2 — the document's rule (today a hosts member is refused as another key)`).toEqual({
        refusals: { none: [422, 'names hosts'], empty: [422, 'names hosts'], overLong: [422, 'names hosts'], wildcard: [422, 'names hosts'], uppercase: [422, 'names hosts'],
          defaultHttps: [422, 'names hosts'], defaultHttp: [422, 'names hosts'], portRange: [422, 'names hosts'], scheme: [422, 'names hosts'], path: [422, 'names hosts'],
          otherKey: [422, expect.any(String)] },
        admitted: { hostsAlone: [200, 'admitted'], withAddresses: [200, 'admitted'] } });
    }, 120_000);

    it(`host (${host}): on a customer deployment (the in-process customer stamp), the tenant's operator publishes hosts and the pull reaches a listed host and is refused 403 for an unlisted one, nothing fetched`, async () => {
      const s = await stampWithSet(host);
      const ok = { status: 200, records: FEED_RECORDS };
      const f = feed({ 'https://cms.example.invalid/feed.json': ok, 'https://evil.example.invalid/feed.json': ok });
      try {
        const head = await operator(s, 'GET', '/content/import-sources');
        const listed = await operator(s, 'PUT', '/content/import-sources', { body: { document: { hosts: ['cms.example.invalid'] }, note: 'p90 customer hosts' }, headers: authored(head) });
        const catalog = async () => authored(await operator(s, 'GET', '/content/catalog'));
        const inside = await operator(s, 'POST', '/content/catalog/pull', { body: { url: 'https://cms.example.invalid/feed.json', path: 'content', mode: 'merge' }, headers: await catalog() });
        const before = f.fetched().length;
        const outside = await operator(s, 'POST', '/content/catalog/pull', { body: { url: 'https://evil.example.invalid/feed.json', path: 'content', mode: 'merge' }, headers: await catalog() });
        expect.soft({ listed: listed.status, inside: inside.status, outside: outside.status, fetchedForOutside: f.fetched().length - before },
          `${host}: P90.EX2 — on the customer profile (today the hosts member is refused and every host is pulled)`).toEqual({ listed: 200, inside: 200, outside: 403, fetchedForOutside: 0 });
      } finally { f.restore(); }
    }, 180_000);
  }

  it('logic: kit 02\'s pull row states https (http only on a loopback host), no redirects and the host list; kit 03\'s import-sources paragraph states hosts; EX3/EX4 LOCK — wrangler.toml\'s three crons and no bucket binding beyond STORAGE', () => {
    const kit02 = readTree('docs/kit/02-api-reference.md'), kit03 = readTree('docs/kit/03-payload-schemas.md');
    const pullRow = kit02.split('\n').find(line => line.startsWith('| `POST /content/catalog/pull')) ?? '';
    const listParagraph = kit03.split(/\n\s*\n/).map(p => p.split('\n').join(' ')).find(p => p.includes('`import-sources`') && p.includes('`addresses`')) ?? '';
    expect.soft({
      // R-P349: phrases, not words — https with the loopback exception, and redirects not followed (or "no redirect" with 502).
      pullRow: [/`?https:?`?/.test(pullRow) && /`?http:?`? only (on|for) (a )?(localhost|loopback)/i.test(pullRow),
        /redirects are not followed/i.test(pullRow) || (/no redirect/i.test(pullRow) && /502/.test(pullRow)), /`hosts`/.test(pullRow) && /403/.test(pullRow)],
      listParagraph: [/`hosts`/.test(listParagraph), /port/.test(listParagraph), /`addresses`/.test(listParagraph)],
    }, 'P90.EX2 — the kit states the scheme, the redirects and the host list (today neither row nor paragraph does)').toEqual({ pullRow: [true, true, true], listParagraph: [true, true, true] });
    const wrangler = readTree('wrangler.toml'), env = readTree('src/types/env.ts');
    expect.soft({ crons: wrangler.split('\n').filter(l => /^crons\s*=/.test(l)).map(l => l.replace(/#.*$/, '').trim()), buckets: (env.match(/:\s*R2Bucket\b/g) ?? []).length,
      storage: /\bSTORAGE:\s*R2Bucket\b/.test(env) }, 'P90 — LOCK (D3): no cron pull and no bucket built').toEqual({
      crons: ['crons = ["*/5 * * * *", "0 * * * *", "0 3 * * *"]'], buckets: 1, storage: true });
  });
});

/** The customer stamp's tenant with its six-member set, as an adoption leaves it (P77's and P91's pattern). */
async function stampWithSet(host: (typeof HOSTS)[number]): Promise<Stamp> {
  const s = await customerStamp(host);
  const at = Date.now();
  const members: Array<[DocumentKind<unknown>, string, unknown]> = [
    [REFLEX_KIND as DocumentKind<unknown>, reflexScopeForTenant(CUSTOMER_TENANT), REFLEX_DOCUMENT],
    [CONTENT_KIND as DocumentKind<unknown>, CUSTOMER_TENANT, { version: 'p90-catalogue', pieces: [...HOME_PIECES] }],
    [SLOTS_KIND as DocumentKind<unknown>, CUSTOMER_TENANT, homeSlots()],
    [LEARN_KIND as DocumentKind<unknown>, CUSTOMER_TENANT, homeLearn()],
    [PRIORS_KIND as DocumentKind<unknown>, CUSTOMER_TENANT, EMPTY_PRIORS],
    [PROPOSALS_KIND as DocumentKind<unknown>, CUSTOMER_TENANT, EMPTY_PROPOSALS],
  ];
  await initializePublicationSet(s.env as Env, members.map(([kind, scope, value]) => ({ kind, scope,
    revision: { revision: 1, value, actor: 'ops', note: `p90 ${kind.name}`, at } })) as PublicationBaseline[], `0:${crypto.randomUUID()}`);
  invalidatePublicationCache(); invalidateCache();
  return s;
}
/** The tenant's operator on the customer stamp (a membership, not the stamp owner). */
const operator = (s: Stamp, method: string, path: string, opts: { body?: unknown; headers?: Record<string, string> } = {}) =>
  s.call(method, path, { token: s.tokens.operator, ...opts });
/** The authored preconditions over a read's head (kit 02), revision 0 for an optional member not yet published. */
const authored = (read: Answer): Record<string, string> => {
  const publication = read.body.publication as { revision?: number; digest?: string } | undefined;
  const revision = typeof read.body.revision === 'number' ? read.body.revision : 0;
  return { ...(publication?.digest ? { 'If-Match': `"${revision}/${publication.revision}/${publication.digest}"` } : {}), 'Idempotency-Key': `${revision}:${crypto.randomUUID()}` };
};
