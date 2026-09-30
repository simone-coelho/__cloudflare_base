// src/units/W37/T7.unit.test.ts
// W37 — criterion T7 of the frozen work order (docs/remediation/delivery-control/
// program.json, ticket W37, amendment A45): "A stamp whose queues do not exist yet
// can be created: every receipt key the stamp workflow writes passes the protected
// store's key check (the resource-deadLetter key fails it today,
// scripts/stamp-workflow.mjs around lines 358 and 750)." One `describe`, in a file
// of its own so the reviewed `LEDGER.unit.test.ts` stays byte-identical.
//
// WITNESS: the W40 specifier's finding
// (/home/simonecoelho/rem/_evidence/step3/fix-W40/specifier/REPORT.md item 3 and
// W40-probe-create-fresh-stamp.log): the create step for a stamp whose KV, D1 and
// queues do not exist yet, run through the CLI, fails at
// `Object.read (scripts/stamp-workflow.mjs:358)` < `ensureResources (:751)`, right
// after the stamp's queue is created: `ensureResources` names the dead-letter
// queue's receipts `'resource-' + kind` = `resource-deadLetter`, and the protected
// store refuses every key outside `/^[a-z0-9.-]{1,160}$/` (:358, :361). The
// workflow's own tests never see it because they run on `memoryStore()`, which
// checks no key (scripts/stamp-workflow.test.mjs:22).
//
// THE PATH. The create step exactly as `npm run deploy` runs it for a customer
// stamp (docs/deployment/01-deploy.md): `scripts/deploy.sh staging --mode create
// --execute`, the private input and the artifact in owner-only files, the token on
// stdin, a protected operation-state directory — the CLI's own
// `protectedOperation` store (scripts/stamp-workflow.mjs:1335). The CLI's Node
// process is preloaded with `src/units/_cloudflare.mjs`, the recording Cloudflare
// account the W40 deploy leg uses, which replaces `fetch` behind the CLI's real
// REST serializer: nothing leaves the process, nothing real is created and the
// token is a fixture.
//
// THE ARTIFACT. The package step (`--mode package`) cannot run in a lane checkout
// (the lint budget and the symlinked `node_modules`, W40 specifier report
// blockers 1 and 2), and nothing T7 rules depends on the package's contents. The
// create step is therefore given the repository's own archived, genuinely
// verified package — docs/remediation/evidence/W13.02/worker.json, check
// W13.02-K3.2 — extracted exactly as scripts/stamp-workflow.test.mjs:652-660
// extracts it, where `validateArtifact` must keep accepting it and its digest is
// pinned. No verification record is fabricated.
//
// THE CHECK. `KEY_CHECK` is the protected store's key check as the witness reads
// it (scripts/stamp-workflow.mjs:358 at 4649023). It is written here, not read
// off the module, so a build cannot satisfy T7 by loosening the check; the second
// leg pins that the store still refuses a key outside it.

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { canonical, protectedOperation, sha256, validateArtifact, validateDesired } from '../../../scripts/stamp-workflow.mjs';

/** The checkout this file lives in, from the module and never from the working directory. */
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** The protected store's key check (scripts/stamp-workflow.mjs:358, :361 at 4649023). */
const KEY_CHECK = /^[a-z0-9.-]{1,160}$/;

const ACCOUNT = 'a'.repeat(32), ZONE = 'b'.repeat(32), OPERATION = '11111111-1111-4111-8111-111111111111';
const OWNER = 'ops-22222222-2222-4222-8222-222222222222', MATERIAL = '9qL8wEfR73mCu5xY02hJ6zN4bAvT1sKd';
const SCRIPT = 'acme-staging';
/** The archived package's identity, as scripts/stamp-workflow.test.mjs:658 pins it. */
const ARCHIVED_DIGEST = '497ad9cda3fc1a860eccb016aca0d44596c89e26e019cb78b4a35b7403b26720';

interface Resource { name: string; id: string | null }
interface Desired {
  version: number; customer: string; account: string; environment: string; script: string; ownership: string;
  resources: { cache: Resource; sessions: Resource; database: Resource; storage: Resource; queue: Resource; deadLetter: Resource; analytics: string };
  tenants: { provisioned: string[]; hosts: Record<string, string> }; origins: string[]; owners: string[];
  vars: Record<string, string>; secrets: Record<string, string>; routes: Array<{ zone: string; pattern: string }>;
}

/**
 * A synthetic customer stamp NONE of whose KV namespaces, D1 database or queues
 * exist yet: the desired state of scripts/stamp-workflow.test.mjs:22-37 with
 * `fresh` (every id null; the bucket is named by its name).
 */
function freshStamp(): Desired {
  const hash = (value: unknown) => sha256(canonical(value));
  const policy = { id: 'approved-fixture', revision: 1, durationMs: 123456, basis: 'admitted', renewal: 'new-record-only' };
  const policies: { version: number; tenants: Record<string, Record<string, unknown>> } =
    { version: 1, tenants: { 'brand-a': Object.fromEntries(['profile', 'identity', 'ledger', 'online', 'hourly'].map(k => [k, { ...policy }])) } };
  const desired: Desired = { version: 1, customer: 'acme', account: ACCOUNT, environment: 'staging', script: SCRIPT, ownership: 'a'.repeat(64),
    resources: { cache: { name: SCRIPT + '-cache', id: null }, sessions: { name: SCRIPT + '-sessions', id: null },
      database: { name: SCRIPT + '-database', id: null }, storage: { name: SCRIPT + '-storage', id: SCRIPT + '-storage' },
      queue: { name: SCRIPT + '-queue', id: null }, deadLetter: { name: SCRIPT + '-deadletter', id: null }, analytics: 'acme_staging_ops_v1' },
    tenants: { provisioned: ['brand-a'], hosts: { 'a.example.test': 'brand-a' } }, origins: ['https://a.example.test'], owners: [OWNER],
    vars: { JWT_ISSUER: SCRIPT, JWT_AUDIENCE: 'customer-api', REFLEX_HOST: 'session' },
    secrets: { JWT_SECRET: MATERIAL, SDK_KEYS: 'brand-a:' + MATERIAL, IDENTITY_SALT: MATERIAL, IDENTITY_SECRETS: 'brand-a:' + MATERIAL,
      ALERT_WEBHOOK_URL: 'https://alerts.example.test/private-fixture' },
    routes: [{ zone: ZONE, pattern: 'a.example.test/*' }] };
  const telemetry = { environment: desired.environment, schema: 'ops-v1',
    analytics: { binding: 'ANALYTICS', dataset: desired.resources.analytics, accessPolicy: 'approved-analytics' },
    monitor: { binding: 'CACHE', namespace: 'monitor', accessPolicy: 'approved-monitor' },
    alert: { binding: 'ALERT_WEBHOOK_URL', destination: 'approved-alert', urlSha256: sha256(desired.secrets.ALERT_WEBHOOK_URL!), accessPolicy: 'approved-alert' } };
  for (const kind of ['analytics', 'monitor', 'alert'] as const) {
    policies.tenants['brand-a']![`telemetry.${kind}.${hash({ tenant: 'brand-a', environment: desired.environment, schema: 'ops-v1', ...telemetry[kind] })}`] = { ...policy };
  }
  desired.vars.RETENTION = JSON.stringify(policies);
  desired.vars.TENANT_CONNECTORS = JSON.stringify({ version: 1, tenants: { 'brand-a': { telemetry } } });
  return desired;
}

/** The archived, genuinely verified package, extracted as scripts/stamp-workflow.test.mjs:652-660 extracts it. */
function archivedPackage(): Buffer {
  const evidence = JSON.parse(readFileSync(join(ROOT, 'docs/remediation/evidence/W13.02/worker.json'), 'utf8')) as
    { checks: Array<{ check: string; gzipBase64: string }> };
  const check = evidence.checks.find(value => value.check === 'W13.02-K3.2')!;
  const lines = gunzipSync(Buffer.from(check.gzipBase64, 'base64')).toString().split('\n');
  const at = lines.findIndex(line => line.includes('Offline artifact payload gzip/base64 '));
  let encoded = lines[at]!.split('Offline artifact payload gzip/base64 ')[1]!;
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i]!.replace(/^# /, '').trim();
    if (!/^[A-Za-z0-9+/=]+$/.test(line)) break;
    encoded += line;
  }
  return gunzipSync(Buffer.from(encoded, 'base64'));
}

interface Created {
  exit: number | null;
  said: string;
  /** Every request the recording account answered, in order. */
  calls: string[];
  versions: number;
  /** The file names in the protected operation directory the create step wrote. */
  files: string[];
  receipt: (key: string) => unknown;
}

/**
 * The create step as `npm run deploy` runs it — scripts/deploy.sh staging,
 * `--mode create --execute`, owner-only input and artifact files, the token on
 * stdin, a protected operation-state directory — against the recording account,
 * which holds nothing yet.
 */
function createFreshStamp(directory: string, artifact: Buffer): Created {
  const input = join(directory, 'create-input.json'), state = join(directory, 'state'), artifactPath = join(directory, 'artifact.json');
  const recorded = join(directory, 'cloudflare-record.json');
  mkdirSync(state, { mode: 0o700 });
  writeFileSync(artifactPath, artifact, { mode: 0o600 });
  const desired = freshStamp();
  writeFileSync(input, JSON.stringify({ desired,
    bootstrap: { owner: { id: OWNER, email: 'owner@example.test', name: 'Initial Owner' }, password: 'Different-Temporary9' },
    authorization: { operation: OPERATION, mode: 'create', account: ACCOUNT, script: SCRIPT, evidence: 'b'.repeat(64), expiresAt: Date.now() + 3_600_000 } }), { mode: 0o600 });
  const preload = `--import=${pathToFileURL(join(ROOT, 'src', 'units', '_cloudflare.mjs')).href}`;
  const run = spawnSync('bash', [join(ROOT, 'scripts', 'deploy.sh'), 'staging', '--mode', 'create', '--input', input, '--state', state,
    '--operation', OPERATION, '--artifact', artifactPath, '--execute'], { cwd: ROOT, encoding: 'utf8', timeout: 240_000, maxBuffer: 64 * 1024 * 1024,
    input: JSON.stringify({ apiToken: 'z'.repeat(32) }),
    env: { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, preload].filter(Boolean).join(' '),
      UNITS_CLOUDFLARE: JSON.stringify({ account: ACCOUNT, zones: { [ZONE]: 'example.test' }, record: recorded }) } });
  const record = existsSync(recorded) ? JSON.parse(readFileSync(recorded, 'utf8')) as { calls: string[]; versions: unknown[] } : { calls: [], versions: [] };
  const operationDirectory = join(state, OPERATION);
  const files = existsSync(operationDirectory) ? readdirSync(operationDirectory).sort() : [];
  const said = `${(run.stdout ?? '').trim()} ${(run.stderr ?? '').split('\n').filter(line => !/ExperimentalWarning|--trace-warnings/.test(line)).join(' ').trim()}`.trim();
  return { exit: run.status, said, calls: record.calls, versions: record.versions.length, files,
    receipt: (key: string) => JSON.parse(readFileSync(join(operationDirectory, key + '.json'), 'utf8')) as unknown };
}

const receiptKeys = (files: string[]): string[] => files.filter(name => name.endsWith('.json')).map(name => name.slice(0, -'.json'.length));

describe('unit:W37.T7', () => {
  it('cli: a customer stamp none of whose KV namespaces, D1 database or queues exist yet is created by the create step `npm run deploy` runs, its dead-letter queue included, and every receipt key the workflow wrote passes the protected store\'s key check', { timeout: 240_000 }, () => {
    const artifact = archivedPackage();
    const archived = validateArtifact(JSON.parse(artifact.toString('utf8'))) as { digest: string };
    expect(archived.digest, 'the fixture: the create step is given the repository\'s archived, genuinely verified package, the one scripts/stamp-workflow.test.mjs:652-660 keeps valid').toBe(ARCHIVED_DIGEST);
    const desired = freshStamp();
    expect(validateDesired(desired), 'the fixture: a valid desired stamp whose KV namespaces, D1 database and queues have no id yet').toEqual(desired);

    const directory = mkdtempSync(join(tmpdir(), 'w37-t7-'));
    try {
      const created = createFreshStamp(directory, artifact);
      const queuePost = `POST /accounts/${ACCOUNT}/queues`;
      expect({ exit: created.exit, said: created.said, versions: created.versions },
        `W37.T7 — a stamp whose queues do not exist yet can be created: the create step completes and uploads one version. At 4649023 it stops right after the stamp's queue is created, because the dead-letter queue's receipt key \`resource-deadLetter\` fails the protected store's key check (scripts/stamp-workflow.mjs:358 via :750). Queues created: ${created.calls.filter(call => call === queuePost).length}; last requests: ${created.calls.slice(-3).join(', ')}; receipts written: ${created.files.join(' ')}`)
        .toEqual({ exit: 0, said: expect.stringContaining('"status":"uploaded-not-promoted"'), versions: 1 });

      const keys = receiptKeys(created.files);
      expect(keys.filter(key => !KEY_CHECK.test(key)),
        `W37.T7 — every receipt key the stamp workflow wrote passes the protected store's key check ${KEY_CHECK} (scripts/stamp-workflow.mjs:358): ${keys.join(' ')}`)
        .toEqual([]);

      // The dead-letter queue's own receipts, found by what they are about and
      // never by a key name: the prewrite intent that names the queue, and the
      // completion beside it that carries the created queue.
      const intents = keys.filter(key => key.endsWith('.intent'));
      const named = intents.filter(key => (created.receipt(key) as { intent?: { name?: unknown } }).intent?.name === desired.resources.deadLetter.name);
      const done = named.map(key => key.slice(0, -'.intent'.length) + '.done').filter(key => keys.includes(key))
        .map(key => (created.receipt(key) as { result?: { queue_name?: unknown; queue_id?: unknown } }).result);
      const result = keys.includes('result') ? created.receipt('result') as { desired?: Desired } : undefined;
      expect({ queuesCreated: created.calls.filter(call => call === queuePost).length,
        receipted: done.map(row => ({ name: row?.queue_name, id: typeof row?.queue_id === 'string' && /^[0-9a-f]{32}$/.test(row.queue_id) })),
        stamped: { name: result?.desired?.resources.deadLetter.name, id: /^[0-9a-f]{32}$/.test(String(result?.desired?.resources.deadLetter.id)) } },
        'W37.T7 — the dead-letter queue is created once, its creation is receipted under a key the store accepts (the prewrite intent that names it and the completion that carries it), and the created stamp records it by its id')
        .toEqual({ queuesCreated: 2, receipted: [{ name: desired.resources.deadLetter.name, id: true }],
          stamped: { name: desired.resources.deadLetter.name, id: true } });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('store: the protected store the CLI writes receipts to still refuses a key outside its check, on read and on write, and answers a well-formed absent key', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'w37-t7-store-'));
    try {
      const store = await protectedOperation(directory, OPERATION) as {
        read: (key: string) => Promise<unknown>; write: (key: string, value: unknown) => Promise<void>; close: () => Promise<void> };
      try {
        const outside = ['resource-deadLetter', 'resource-deadLetter.intent', 'Result', '../escape', '', 'x'.repeat(161)];
        const refused: Record<string, string> = {};
        for (const key of outside) {
          const read = await store.read(key).then(() => 'answered', () => 'refused');
          const write = await store.write(key, { probe: true }).then(() => 'written', () => 'refused');
          refused[key] = `${read}/${write}`;
        }
        expect(refused,
          `W37.T7 — the fix is the receipt key, never the guard: the protected store keeps refusing every key outside ${KEY_CHECK} (scripts/stamp-workflow.mjs:358, :361), on read and on write`)
          .toEqual(Object.fromEntries(outside.map(key => [key, 'refused/refused'])));
        expect(await store.read('resource-queue.intent'),
          'and a key inside the check that holds nothing reads as absent, so the refusals above are the check and not a broken store').toBeNull();
      } finally { await store.close(); }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
