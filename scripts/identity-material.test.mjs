import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, PassThrough } from 'node:stream';
import { mkdtemp, chmod, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSecretInput, stageIdentityMaterial, protectedReceipts } from './identity-material.mjs';

const baseVersion = '10000000-0000-4000-8000-000000000001', candidate = '20000000-0000-4000-8000-000000000001';
const operation = '30000000-0000-4000-8000-000000000001';
const target = { account: 'a'.repeat(32), script: 'synthetic-stage', environment: 'staging', baseVersion, operation };
const material = { apiToken: 'SyntheticApiTokenForLocalTransportOnly123', identitySecrets: 'meridian:0123456789ABCdefghijkLMNOPqrstUVWX', identitySalt: 'ZYXwvutsRQPONmlkjIHGFedcba98765432' };
function fixture(options = {}) {
  let receipt, uploaded, posts = 0;
  const calls = [];
  const bindings = [
    { name: 'TENANTS', type: 'plain_text', text: JSON.stringify({ provisioned: ['meridian'], hosts: { 'shop.invalid': 'meridian' } }) },
    { name: 'ENVIRONMENT', type: 'plain_text', text: 'staging' }, { name: 'DEPLOYMENT_PROFILE', type: 'plain_text', text: 'customer' },
    { name: 'AUTH_MODE', type: 'plain_text', text: 'enforced' }, { name: 'CACHE', type: 'kv_namespace', namespace_id: 'b'.repeat(32) },
    ...(options.bindings ?? []),
  ];
  const runtime = { compatibility_date: '2025-06-01', compatibility_flags: ['nodejs_compat'], limits: { cpu_ms: 50 } };
  const content = () => { const data = new FormData(); data.set('main.js', new Blob(['export default {fetch(){return new Response("synthetic")}}'], { type: 'application/javascript+module' }), 'main.js');
    data.set('asset.txt', new Blob(['synthetic module asset'], { type: 'text/plain' }), 'asset.txt'); return new Response(data, { headers: { 'cf-entrypoint': 'main.js' } }); };
  const json = result => Response.json({ success: true, result });
  const fetch = async (url, init) => {
    calls.push({ url, method: init.method ?? 'GET' });
    assert.equal(init.redirect, 'error'); assert.equal(init.headers.Authorization, 'Bearer ' + material.apiToken);
    if (init.method === 'POST') {
      posts++; assert.ok(url.endsWith('/versions?bindings_inherit=strict'));
      uploaded = init.body;
      if (options.timeout) return new Promise(() => {});
      return json({ id: candidate });
    }
    const path = new URL(url).pathname;
    const metadata = uploaded && JSON.parse(uploaded.get('metadata'));
    if (path.endsWith('/versions')) return json({ items: [...(uploaded ? [{ id: candidate, annotations: metadata.annotations }] : []), { id: baseVersion }] });
    if (path.endsWith('/versions/' + baseVersion)) return json({ id: baseVersion, resources: { bindings, script_runtime: runtime, script: { placement_mode: 'smart' } } });
    if (path.endsWith('/versions/' + candidate)) return json({ id: candidate, annotations: metadata.annotations, resources: {
      bindings: [...bindings, ...metadata.bindings.filter(binding => binding.type === 'secret_text').map(({ name, type }) => ({ name, type }))], script_runtime: runtime,
    } });
    if (path.endsWith('/content/v2')) return content();
    if (path.endsWith('/script-settings')) return json({ logpush: true, tail_consumers: [], observability: { enabled: true } });
    if (path.endsWith('/deployments')) return json([{ id: 'unchanged-deployment', versions: [{ version_id: baseVersion, percentage: 100 }] }]);
    throw new Error('Unexpected synthetic transport destination');
  };
  const receipts = { read: async () => receipt ?? null, create: async value => { assert.equal(receipt, undefined); receipt = structuredClone(value); } };
  return { bindings, fetch, receipts, calls, get receipt() { return receipt; }, get uploaded() { return uploaded; }, get posts() { return posts; } };
}

test('W04.03 add-only exact-version upload preserves modules, settings and opaque bindings without deployment', async () => {
  const f = fixture({ bindings: [{ name: 'IDENTITY_SALT', type: 'secret_text' }] });
  const result = await stageIdentityMaterial(target, material, f);
  assert.equal(f.posts, 1); assert.equal(result.status, 'unconfirmed'); assert.equal(result.candidateVerified, true);
  assert.equal(result.targetDrift, false); assert.deepEqual(result.preservedUnverified, ['IDENTITY_SALT']);
  const metadata = JSON.parse(f.uploaded.get('metadata'));
  assert.equal(metadata.bindings_inherit, undefined); assert.equal(metadata.keep_assets, true);
  assert.deepEqual(metadata.placement, { mode: 'smart' }); assert.equal(metadata.logpush, true);
  assert.deepEqual(metadata.bindings.filter(binding => binding.type === 'inherit'), f.bindings.map(({ name }) => ({ name, type: 'inherit', version_id: baseVersion })));
  assert.deepEqual(metadata.bindings.filter(binding => binding.type === 'secret_text'), [{ name: 'IDENTITY_SECRETS', type: 'secret_text', text: material.identitySecrets }]);
  assert.equal(await f.uploaded.get('asset.txt').text(), 'synthetic module asset');
  for (const value of Object.values(material)) { assert.ok(!JSON.stringify(result).includes(value)); assert.ok(!JSON.stringify(f.receipt).includes(value)); }
  assert.ok(f.calls.every(call => call.method === 'GET' || call.url.endsWith('/versions?bindings_inherit=strict')));
  const before = f.posts; const retry = await stageIdentityMaterial(target, material, f);
  assert.equal(f.posts, before); assert.deepEqual(retry.candidates, [candidate]); assert.equal(retry.reposted, false);
  await assert.rejects(stageIdentityMaterial(target, { ...material, identitySalt: 'Different0123456789ABCdefghijkLMNOP' }, f));
});

test('W04.03 unsafe or mismatched customer manifests/material refuse before upload; existing material remains unverified', async () => {
  for (const [key, value] of [['ENVIRONMENT', 'production'], ['DEPLOYMENT_PROFILE', 'demo'], ['AUTH_MODE', 'open'],
    ['TENANTS', JSON.stringify({ provisioned: [123] })], ['TENANTS', JSON.stringify({ provisioned: ['meridian'], hosts: { 'bad/path': 'meridian' } })]]) {
    const f = fixture(); f.bindings.find(binding => binding.name === key).text = value;
    await assert.rejects(stageIdentityMaterial(target, material, f)); assert.equal(f.posts, 0); assert.equal(f.receipt, undefined);
  }
  for (const secret of [{ ...material, identitySalt: 'short' }, { ...material, identitySecrets: '*:' + material.identitySalt }]) {
    const f = fixture(); await assert.rejects(stageIdentityMaterial(target, secret, f)); assert.equal(f.posts, 0);
  }
  const f = fixture({ bindings: ['IDENTITY_SECRETS', 'IDENTITY_SALT'].map(name => ({ name, type: 'secret_text' })) });
  assert.deepEqual(await stageIdentityMaterial(target, { apiToken: material.apiToken }, f), { status: 'unchanged', preservedUnverified: ['IDENTITY_SECRETS', 'IDENTITY_SALT'], readinessRequired: true });
  assert.equal(f.posts, 0);
});

test('W04.03 bounded secret input rejects corruption and timeout; ambiguous upload reconciles without repost', async () => {
  assert.deepEqual(await readSecretInput(Readable.from([JSON.stringify(material)])), material);
  await assert.rejects(readSecretInput(Readable.from([Buffer.from('{"apiToken":"' + material.apiToken + '","identitySalt":"'), Buffer.from([0xff]), Buffer.from('"}')])));
  await assert.rejects(readSecretInput(Readable.from(['x'.repeat(131073)])));
  await assert.rejects(readSecretInput(new PassThrough(), 2));
  const f = fixture({ timeout: true });
  const result = await stageIdentityMaterial(target, material, { ...f, timeoutMs: 5 });
  assert.equal(result.status, 'unconfirmed'); assert.equal(f.posts, 1); assert.equal(f.receipt.state, 'unconfirmed');
  const retry = await stageIdentityMaterial(target, material, f);
  assert.deepEqual(retry.candidates, [candidate]); assert.equal(f.posts, 1);
});

test('W04.03 immutable protected intent syncs its directory before upload and survives an interrupted-operation lock', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'w0403-material-')); await chmod(directory, 0o700);
  const path = join(directory, operation + '.json');
  const probe = await open(directory, 'r'), prototype = Object.getPrototypeOf(probe), originalSync = prototype.sync;
  await probe.close();
  const synced = []; let failDirectorySync = false;
  t.mock.method(prototype, 'sync', async function () {
    const kind = (await this.stat()).isDirectory() ? 'directory' : 'file';
    synced.push(kind);
    if (kind === 'directory' && failDirectorySync) throw new Error('Synthetic directory sync unavailable');
    return originalSync.call(this);
  });
  let writer, failedWriter;
  try {
    writer = await protectedReceipts(path, operation);
    await writer.create({ version: 1, target, commitment: 'synthetic-protected-commitment' });
    assert.deepEqual(synced, ['file', 'directory']);
    const reader = await protectedReceipts(path, operation);
    assert.deepEqual(await reader.read(), { version: 1, target, commitment: 'synthetic-protected-commitment' });
    await assert.rejects(reader.create({ replacement: true })); await reader.close();
    const file = await open(path, 'r'); assert.equal((await file.stat()).mode & 0o077, 0); await file.close();
    const failedOperation = '30000000-0000-4000-8000-000000000002';
    failedWriter = await protectedReceipts(join(directory, failedOperation + '.json'), failedOperation);
    failDirectorySync = true;
    const f = fixture();
    await assert.rejects(stageIdentityMaterial({ ...target, operation: failedOperation }, material, { ...f, receipts: failedWriter }));
    assert.equal(f.posts, 0); assert.deepEqual(synced, ['file', 'directory', 'file', 'directory']);
    assert.equal((await failedWriter.read()).target.operation, failedOperation);
  } finally { t.mock.restoreAll(); await failedWriter?.close(); await writer?.close(); await rm(directory, { recursive: true }); }
});
