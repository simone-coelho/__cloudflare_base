import { createHash } from 'node:crypto';
import { open, lstat, readFile, realpath, unlink } from 'node:fs/promises';
import { dirname, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { safeIdentitySecret, parseIdentitySecrets } from '../src/identity/material.mjs';

const unavailable = () => new Error('Identity material staging unavailable');
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function targetOf(input) {
  const { account, script, environment, baseVersion, operation } = input;
  if (!/^[0-9a-f]{32}$/i.test(account ?? '') || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(script ?? '')
    || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(environment ?? '') || !uuid.test(baseVersion ?? '') || !uuid.test(operation ?? '')) throw unavailable();
  return { account, script, environment, baseVersion, operation };
}
export async function readSecretInput(stream, timeoutMs = 15000) {
  if (stream.isTTY) throw unavailable();
  const chunks = []; let size = 0;
  let timer;
  try { await Promise.race([(async () => {
    for await (const chunk of stream) {
      const bytes = Buffer.from(chunk); size += bytes.length;
      if (size > 131072) throw unavailable();
      chunks.push(bytes);
    }
  })(), new Promise((_, reject) => { timer = setTimeout(() => { stream.destroy?.(); reject(unavailable()); }, timeoutMs); })]); }
  finally { clearTimeout(timer); }
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); } catch { throw unavailable(); }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['apiToken', 'identitySecrets', 'identitySalt'].includes(key))
    || typeof value.apiToken !== 'string' || !/^[A-Za-z0-9_-]{20,512}$/.test(value.apiToken)) throw unavailable();
  return value;
}

/** Real Versions REST transport; all writes are one explicit non-deploying upload. */
export async function stageIdentityMaterial(input, secret, { fetch: transport = globalThis.fetch, receipts, timeoutMs = 15000 } = {}) {
  const target = targetOf(input);
  if (!receipts || typeof secret?.apiToken !== 'string') throw unavailable();
  const requested = { identitySecrets: secret.identitySecrets ?? null, identitySalt: secret.identitySalt ?? null };
  const commitment = digest({ target, requested });
  const base = `https://api.cloudflare.com/client/v4/accounts/${target.account}/workers/scripts/${target.script}`;
  const request = async (suffix, init = {}) => {
    const controller = new AbortController(); let timer;
    try {
      return await Promise.race([(async () => {
        const response = await transport(base + suffix, { ...init, redirect: 'error', signal: controller.signal,
          headers: { ...init.headers, Authorization: `Bearer ${secret.apiToken}` } });
        if (!response.ok || !response.body) throw unavailable();
        const reader = response.body.getReader(), chunks = []; let length = 0;
        const limit = suffix.startsWith('/content/') ? 32 * 1024 * 1024 : 1024 * 1024;
        while (true) { const item = await reader.read(); if (item.done) break;
          length += item.value.length; if (length > limit) { await reader.cancel(); throw unavailable(); } chunks.push(item.value); }
        return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers });
      })(), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(unavailable()); }, timeoutMs); })]);
    } finally { clearTimeout(timer); }
  };
  const json = async suffix => {
    const data = await (await request(suffix)).json();
    if (data?.success !== true || data.result === undefined) throw unavailable();
    return data.result;
  };
  const versions = async () => {
    const result = await json('/versions?per_page=100');
    const items = Array.isArray(result) ? result : result?.items;
    if (!Array.isArray(items) || items.length >= 100 || items.some(item => !uuid.test(item?.id ?? ''))) throw unavailable();
    return items;
  };
  const tag = 'identity-material-' + target.operation;
  const existing = await receipts.read();
  if (existing) {
    if (existing.version !== 1 || canonical(existing.target) !== canonical(target) || existing.commitment !== commitment) throw unavailable();
    const candidates = (await versions()).filter(version => version.annotations?.['workers/tag'] === tag);
    // The API has no documented upload CAS/idempotency. A matching tag is a
    // reconciliation lead, not proof of opaque secret equality or safe assets.
    return { status: 'unconfirmed', candidates: candidates.map(version => version.id), reposted: false,
      reason: 'Existing operation requires read-only candidate review' };
  }
  const before = await versions();
  if (before[0]?.id !== target.baseVersion) throw unavailable();
  const [version, settings, deployments] = await Promise.all([
    json('/versions/' + target.baseVersion), json('/script-settings'), json('/deployments'),
  ]);
  if (version.id !== target.baseVersion || !Array.isArray(version.resources?.bindings)
    || !version.resources?.script_runtime?.compatibility_date) throw unavailable();
  const bindings = version.resources.bindings;
  if (new Set(bindings.map(binding => binding.name)).size !== bindings.length) throw unavailable();
  if (bindings.find(binding => binding.name === 'DEPLOYMENT_PROFILE')?.text !== 'customer'
    || bindings.find(binding => binding.name === 'AUTH_MODE')?.text !== 'enforced'
    || bindings.find(binding => binding.name === 'ENVIRONMENT')?.text !== target.environment) throw unavailable();
  const tenantsBinding = bindings.find(binding => binding.name === 'TENANTS');
  let tenants, registry;
  try { registry = JSON.parse(tenantsBinding?.text); tenants = registry.provisioned; } catch { throw unavailable(); }
  if (!Array.isArray(tenants) || !tenants.length || tenants.some(tenant => typeof tenant !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(tenant))) throw unavailable();
  if (registry.hosts !== undefined) {
    if (!registry.hosts || typeof registry.hosts !== 'object' || Array.isArray(registry.hosts)) throw unavailable();
    const normalized = new Map();
    for (const [key, tenant] of Object.entries(registry.hosts)) {
      const host = key.trim().toLowerCase();
      let url; try { url = new URL('https://' + host); } catch { throw unavailable(); }
      if (url.hostname !== host || url.port || url.pathname !== '/' || url.search || url.hash || url.username || url.password
        || (!host.startsWith('[') && (host.length > 253 || !host.replace(/\.$/, '').split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))))
        || !tenants.includes(tenant) || (normalized.has(host) && normalized.get(host) !== tenant)) throw unavailable();
      normalized.set(host, tenant);
    }
  }
  const additions = [], preservedUnverified = [];
  for (const [name, value] of [['IDENTITY_SECRETS', secret.identitySecrets], ['IDENTITY_SALT', secret.identitySalt]]) {
    const present = bindings.find(binding => binding.name === name);
    if (present) {
      if (present.type !== 'secret_text') throw unavailable();
      preservedUnverified.push(name); continue;
    }
    if (name === 'IDENTITY_SALT') { if (!safeIdentitySecret(value)) throw unavailable(); }
    else {
      const table = parseIdentitySecrets(value, true);
      if (table.has('*') || tenants.some(tenant => !table.has(tenant))) throw unavailable();
    }
    additions.push({ name, type: 'secret_text', text: value });
  }
  if (!additions.length) return { status: 'unchanged', preservedUnverified, readinessRequired: true };
  const content = await request('/content/v2?version=' + target.baseVersion);
  if (!content.headers.get('content-type')?.startsWith('multipart/form-data')) throw unavailable();
  const entrypoint = content.headers.get('cf-entrypoint'), modules = await content.formData();
  if (!entrypoint || !modules.has(entrypoint) || modules.has('__STATIC_CONTENT_MANIFEST') || modules.has('metadata')) throw unavailable();
  const modulePins = [];
  for (const [name, part] of modules) {
    if (typeof part === 'string' || !part.type || name.includes('\0')) throw unavailable();
    modulePins.push({ name, type: part.type, sha256: createHash('sha256').update(Buffer.from(await part.arrayBuffer())).digest('hex') });
  }
  const metadata = {
    main_module: entrypoint, compatibility_date: version.resources.script_runtime.compatibility_date,
    compatibility_flags: version.resources.script_runtime.compatibility_flags ?? [],
    bindings: [...bindings.map(binding => ({ name: binding.name, type: 'inherit', version_id: target.baseVersion })), ...additions],
    keep_assets: true,
    ...(settings.logpush === undefined ? {} : { logpush: settings.logpush }),
    ...(settings.tail_consumers === undefined ? {} : { tail_consumers: settings.tail_consumers }),
    ...(settings.observability === undefined ? {} : { observability: settings.observability }),
    ...(version.resources.script_runtime.limits === undefined ? {} : { limits: version.resources.script_runtime.limits }),
    ...(version.resources.script?.placement !== undefined ? { placement: version.resources.script.placement }
      : version.resources.script?.placement_mode === 'smart' ? { placement: { mode: 'smart' } } : {}),
    ...(version.cache_options === undefined ? {} : { cache: version.cache_options }),
    annotations: { 'workers/tag': tag, 'workers/message': 'Add-only identity material; not deployed' },
  };
  // The protected receipt precedes the potentially ambiguous write. Never put
  // credential plaintext, bearer tokens or commitments in stdout/diagnostics.
  const receipt = { version: 1, target, commitment, modulePins, baseState: digest({ settings, deployments }), state: 'unconfirmed' };
  await receipts.create(receipt);
  if ((await versions())[0]?.id !== target.baseVersion || digest({ settings: await json('/script-settings'), deployments: await json('/deployments') }) !== receipt.baseState) {
    return { status: 'unconfirmed', reason: 'Target changed before upload', reposted: false };
  }
  const form = new FormData();
  form.set('metadata', JSON.stringify(metadata));
  for (const [name, part] of modules) form.set(name, part, part.name);
  let candidate;
  try {
    const result = await (await request('/versions?bindings_inherit=strict', { method: 'POST', body: form })).json();
    if (result?.success !== true || !uuid.test(result.result?.id ?? '')) throw unavailable();
    candidate = result.result.id;
  } catch { return { status: 'unconfirmed', reason: 'Upload outcome unknown; reconcile this operation', reposted: false }; }
  const after = await versions();
  const drift = after[0]?.id !== candidate || canonical(after.slice(1).map(row => row.id)) !== canonical(before.map(row => row.id))
    || digest({ settings: await json('/script-settings'), deployments: await json('/deployments') }) !== receipt.baseState;
  let candidateVerified = false;
  try {
    const observed = await json('/versions/' + candidate);
    const observedContent = await request('/content/v2?version=' + candidate);
    const observedModules = await observedContent.formData(), observedPins = [];
    for (const [name, part] of observedModules) {
      if (typeof part === 'string') throw unavailable();
      observedPins.push({ name, type: part.type, sha256: createHash('sha256').update(Buffer.from(await part.arrayBuffer())).digest('hex') });
    }
    const named = observed.resources?.bindings;
    candidateVerified = observed.id === candidate && observed.annotations?.['workers/tag'] === tag
      && observedContent.headers.get('cf-entrypoint') === entrypoint
      && canonical(observedPins.sort((a, b) => a.name.localeCompare(b.name))) === canonical(modulePins.sort((a, b) => a.name.localeCompare(b.name)))
      && canonical(observed.resources?.script_runtime) === canonical(version.resources.script_runtime)
      && Array.isArray(named) && named.length === bindings.length + additions.length
      && bindings.every(binding => canonical(named.find(item => item.name === binding.name)) === canonical(binding))
      && additions.every(binding => named.some(item => item.name === binding.name && item.type === 'secret_text'));
  } catch { /* An unreadable/malformed candidate is not confirmed or deployed. */ }
  return { status: 'unconfirmed', candidate, candidateVerified, preservedUnverified, readinessRequired: true, targetDrift: drift,
    reason: 'Version uploaded without deployment; opaque secrets and unpinned kept assets require separate attestation', reposted: false };
}

/** Exclusive local receipt access; existing files must already be protected. */
export async function protectedReceipts(path, operation) {
  path = resolve(path);
  const directory = dirname(path), info = await lstat(directory);
  if (basename(path) !== operation + '.json' || !info.isDirectory() || info.isSymbolicLink()
    || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.() || await realpath(directory) !== directory) throw unavailable();
  const lockPath = path + '.lock';
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) { if (error.code !== 'EEXIST') throw unavailable(); }
  const read = async () => {
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) || stat.uid !== process.getuid?.() || stat.size > 1048576) throw unavailable();
      return JSON.parse(await readFile(path, 'utf8'));
    } catch (error) { if (error.code === 'ENOENT') return null; throw unavailable(); }
  };
  return {
    read,
    create: async value => {
      if (!lock) throw unavailable();
      const file = await open(path, 'wx', 0o600);
      try { await file.writeFile(canonical(value)); await file.sync(); } finally { await file.close(); }
      // Upload may start only after the immutable intent's directory entry is synced.
      const parent = await open(directory, 'r');
      try {
        const current = await parent.stat();
        if (!current.isDirectory() || current.dev !== info.dev || current.ino !== info.ino) throw unavailable();
        await parent.sync();
      } finally { await parent.close(); }
    },
    close: async () => { if (lock) { await lock.close(); await unlink(lockPath); } },
  };
}
export async function main(argv = process.argv.slice(2), stdin = process.stdin) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = { '--account': 'account', '--script': 'script', '--environment': 'environment', '--base-version': 'baseVersion', '--operation': 'operation', '--receipt': 'receipt' }[argv[i]];
    if (!key || !argv[i + 1] || Object.hasOwn(args, key)) throw unavailable();
    args[key] = argv[i + 1];
  }
  targetOf(args); if (!args.receipt) throw unavailable();
  const secret = await readSecretInput(stdin), receipts = await protectedReceipts(args.receipt, args.operation);
  try { return await stageIdentityMaterial(args, secret, { receipts }); } finally { await receipts.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(result => process.stdout.write(JSON.stringify(result) + '\n'), () => { process.stderr.write('Identity material staging unavailable\n'); process.exitCode = 1; });
}
