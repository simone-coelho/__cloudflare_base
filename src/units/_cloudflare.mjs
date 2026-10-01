// src/units/_cloudflare.mjs
// A recording Cloudflare account for unit legs that must observe what the
// customer deploy CLI (`npm run deploy` → scripts/deploy.sh → scripts/stamp-workflow.mjs)
// sends, with nothing leaving the process. Preload it into the CLI's own Node process
// (`NODE_OPTIONS=--import=<this file's URL>`): it replaces `globalThis.fetch`, the
// transport the CLI's real REST serializer (`provider`) uses, and answers the way
// scripts/stamp-workflow.test.mjs's fixture answers (:60-131): account, zones and
// routes, the stamp's KV namespaces, D1 database (node:sqlite), R2 bucket and queues,
// the asset-upload session and buckets, and the Worker version with its readback.
//
// Configuration, from the environment variable UNITS_CLOUDFLARE (JSON):
//   { "account": "<32 hex>", "zones": { "<zone id>": "<zone name>" }, "record": "<abs path>",
//     "existing": { "</storage/kv/namespaces|/d1/database|/r2/buckets|/queues>/<id>": <row> } }
// `existing` are resources the account already holds, answered as the provider lists them.
// On exit the preload writes every request it answered to `record`:
//   { calls: ["METHOD /path"], manifests: [{ "<asset path>": { hash, size } }],
//     uploads: { "<hash>": "<base64 of the asset bytes>" },
//     versions: [{ id, metadata, modules: { "<part name>": "<module source>" } }] }

import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const config = JSON.parse(process.env.UNITS_CLOUDFLARE ?? '{}');
if (!/^[0-9a-f]{32}$/.test(config.account ?? '') || typeof config.record !== 'string') {
  throw new Error('units cloudflare preload: UNITS_CLOUDFLARE names no account or record path');
}
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const db = new DatabaseSync(':memory:');
const record = { calls: [], manifests: [], uploads: {}, versions: [] };
const resources = new Map(Object.entries(config.existing ?? {}));
const scripts = new Map();
let created = 0;

const success = result => Response.json({ success: true, result });
const absent = () => new Response('{}', { status: 404 });
const hex = n => n.toString(16).padStart(32, '0');
const uuid = n => `33333333-3333-4333-8333-${n.toString(16).padStart(12, '0')}`;

function executeSQL(sql, params = []) {
  if (/^SELECT/.test(sql)) return sql.split(';').filter(Boolean).map(s => ({ success: true, results: db.prepare(s).all(...params) }));
  db.exec('BEGIN');
  try {
    let rows = [];
    if (/RETURNING id\s*$/.test(sql)) rows = db.prepare(sql).all(...params);
    else if (params.length) db.prepare(sql).run(...params);
    else db.exec(sql);
    db.exec('COMMIT');
    return [{ success: true, results: rows }];
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

function create(collection, body) {
  created++;
  if (collection === '/storage/kv/namespaces') return { key: hex(created), row: { id: hex(created), title: body.title } };
  if (collection === '/d1/database') return { key: uuid(created), row: { uuid: uuid(created), name: body.name } };
  if (collection === '/r2/buckets') return { key: body.name, row: { name: body.name } };
  return { key: hex(created), row: { queue_id: hex(created), queue_name: body.queue_name,
    settings: { delivery_paused: false, message_retention_period: 86400 }, consumers: [] } };
}

async function answer(url, init = {}) {
  const u = new URL(url), method = init.method ?? 'GET', path = u.pathname.replace('/client/v4', '');
  if (u.origin !== 'https://api.cloudflare.com') throw new Error(`units cloudflare preload refuses ${u.origin}`);
  record.calls.push(`${method} ${path}`);
  const form = init.body instanceof FormData ? init.body : undefined;
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
  const zone = /^\/zones\/([0-9a-f]{32})(\/workers\/routes)?$/.exec(path);
  if (zone && Object.hasOwn(config.zones ?? {}, zone[1])) {
    return zone[2] ? success([]) : success({ id: zone[1], account: { id: config.account }, name: config.zones[zone[1]] });
  }
  const base = `/accounts/${config.account}`;
  if (path === base) return success({ id: config.account });
  if (!path.startsWith(base + '/')) return absent();
  const p = path.slice(base.length);
  if (p.endsWith('/query')) return success(executeSQL(body.sql, body.params));
  if (p === '/workers/scripts') return success([...scripts.keys()].map(id => ({ id, migration_tag: 'v7' })));
  if (p === '/workers/assets/upload' && form) {
    for (const [hash, part] of form) record.uploads[hash] = typeof part === 'string' ? part : await part.text();
    return success({ jwt: 'completed-assets-fixture' });
  }
  const script = /^\/workers\/scripts\/([a-z0-9-]+)(\/.*)$/.exec(p);
  if (script) {
    const [, name, suffix] = script, rows = scripts.get(name) ?? [];
    if (suffix === '/assets-upload-session') {
      record.manifests.push(body.manifest);
      return success({ jwt: 'asset-session-fixture', buckets: [Object.values(body.manifest).map(entry => entry.hash)] });
    }
    if (suffix === '/versions' && method === 'POST' && form) {
      const id = `99999999-9999-4999-8999-${String(record.versions.length + 1).padStart(12, '0')}`;
      const modules = {}, parts = new Map();
      for (const [part, value] of form) if (part !== 'metadata') { parts.set(part, value); modules[part] = typeof value === 'string' ? value : await value.text(); }
      const row = { id, metadata: JSON.parse(String(form.get('metadata'))), modules, parts };
      rows.unshift(row); scripts.set(name, rows); record.versions.push({ id, metadata: row.metadata, modules });
      return success({ id });
    }
    if (suffix === '/versions') return success({ items: rows.map(row => ({ id: row.id, annotations: row.metadata.annotations })) });
    const row = rows.find(r => suffix === '/versions/' + r.id || (suffix === '/content/v2' && u.searchParams.get('version') === r.id));
    if (row && suffix === '/content/v2') {
      const content = new FormData();
      for (const [part, value] of row.parts) content.set(part, value, part);
      const response = new Response(content); response.headers.set('cf-entrypoint', row.metadata.main_module); return response;
    }
    if (row) return success({ id: row.id, resources: {
      bindings: row.metadata.bindings.map(b => b.type === 'secret_text' ? { name: b.name, type: b.type } : b),
      script_runtime: { compatibility_date: row.metadata.compatibility_date, compatibility_flags: row.metadata.compatibility_flags } } });
    if (suffix === '/script-settings') return success({ observability: { enabled: false, head_sampling_rate: 0, logs: { enabled: false, invocation_logs: false } } });
    if (suffix === '/deployments') return success({ deployments: [] });
    if (suffix === '/schedules') return success([]);
    return absent();
  }
  if (method === 'GET' && resources.has(p)) return success(resources.get(p));
  if (['/storage/kv/namespaces', '/d1/database', '/r2/buckets', '/queues'].includes(p)) {
    if (method === 'POST') { const { key, row } = create(p, body); resources.set(p + '/' + key, row); return success(row); }
    const rows = [...resources].filter(([key]) => key.startsWith(p + '/')).map(([, value]) => value);
    return success(p === '/r2/buckets' ? { buckets: rows } : rows);
  }
  return absent();
}

globalThis.fetch = answer;
process.on('exit', () => { db.close(); writeFileSync(config.record, JSON.stringify(record)); });
