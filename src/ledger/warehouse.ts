import type { Env } from '@/types/env';
import { connectorConfiguration, connectorDigest, connectorIdentity, warehouseConfigurationSchema, type WarehouseConfiguration } from '@/connectors/config';
import { connectorDeadline, ConnectorUnavailable, type ConnectorDeadline } from '@/connectors/model';
import { warehouseStatement, type WarehousePayload, type WarehouseReadback, type WarehouseRow } from '@/connectors/snowflake';
import { destinationRetentionCategory, readRetention, requireRetention, type ExternalRetention, type RetentionStamp } from '@/retention';
import { boundedLedgerText, DELIVERY_FIELD, MANAGED_BYTES, validCarrier } from './delivery';
import { loadTombstone, pendingPrefix } from './erasure';
import { recoveryJSON } from './recovery';
import type { CapturedRecord, LedgerStream } from './records';
import { z } from 'zod';

const root = (tenant: string) => `warehouse/v1/${tenant}/`;
const hash = /^[a-f0-9]{64}$/;
const sourceKey = (key: string, tenant: string) => new RegExp('^' + tenant + '/\\d{4}-\\d{2}-\\d{2}/\\d{2}/(decision|outcome|behavior|product-sort)/[^/]+\\.ndjson$').test(key);
interface Generation { version: 1; tenant: string; digest: string; configuration: WarehouseConfiguration }
interface Source { key: string; revision: string; rows: WarehouseRow[]; stamps: RetentionStamp[]; sourceDigest: string; next: number; final: boolean }
interface Pending { nextOffset?: number; debtSubjects?: string[]; payload: WarehousePayload; wire: string; digest: string; expiresAt: number;
  stamps: RetentionStamp[]; applyHandle?: string; readHandle?: string; applied?: boolean; readOperation: string; readAttempted?: boolean; cleanup: boolean }
interface Journal { version: 1; seal?: string; generation: string; sequence: number; due: number; mode: 'sources' | 'missing' | 'cutoffs'; cursor: string | null;
  page: string[]; next: string | null; more: boolean; index: number; pending?: Pending; source?: { key: string; revision: string; digest: string; sequence: number; part: number; offset: number; total: number; authority: RetentionStamp[] } }
export interface WarehouseResult { status: 'disabled' | 'not_due' | 'pending' | 'progress' | 'failed'; reason?: 'generation_capacity'; complete: false; processed: number; currentRowsOnly: true }
const failure = () => new ConnectorUnavailable('conflict');
const count = z.number().int().safe().nonnegative(), sha = z.string().regex(hash), uuid = z.string().uuid();
const subject = z.string().regex(/^[A-Za-z0-9_.-]{1,200}$/);
const payloadSchema = z.object({ version: z.literal(1), tenant: z.string(), generation: sha, operation: uuid, sequence: count.positive(),
  source: z.string().min(1).max(2048), revision: z.string().min(1).max(256), sourceSequence: count.positive(), part: count,
  final: z.boolean(), mode: z.enum(['replace','barrier']), total: count, sourceDigest: sha,
  rows: z.array(z.object({ id: z.string().min(1).max(2048), subject: z.string().regex(/^[a-f0-9]{32}$/), ts: count,
    expiresAt: count, hash: sha, wire: z.literal('') }).strict()).max(1000),
  cutoffs: z.array(z.object({ subject: z.string().regex(/^[a-f0-9]{32}$/), at: count }).strict()).max(1000),
}).strict();
const journalSchema = z.object({ version: z.literal(1), seal: sha, generation: sha, sequence: count, due: count,
  mode: z.enum(['sources','missing','cutoffs']), cursor: z.string().min(1).max(4096).nullable(), page: z.array(z.string().min(1).max(2048)).max(100),
  next: z.string().min(1).max(4096).nullable(), more: z.boolean(), index: count,
  source: z.object({ key: z.string().min(1).max(2048), revision: z.string().min(1).max(256), digest: sha, sequence: count.positive(), part: count, offset: count, total: count, authority: z.array(z.unknown()).max(2) }).strict().optional(),
  pending: z.object({ nextOffset: count.optional(), debtSubjects: z.array(subject).max(1000).optional(), payload: payloadSchema,
    wire: z.literal(''), digest: sha, expiresAt: count, stamps: z.array(z.unknown()).max(2000), applyHandle: uuid.optional(),
    readHandle: uuid.optional(), applied: z.boolean().optional(), readOperation: uuid, readAttempted: z.boolean().optional(), cleanup: z.boolean() }).strict().optional(),
}).strict();
async function read<T>(env: Env, key: string, max = 20 * 1024 * 1024): Promise<{ value: T; etag: string } | null> {
  const object = await env.STORAGE.get(key); if (!object) return null;
  if (object.key !== key || !object.etag || !Number.isSafeInteger(object.size) || object.size > max) throw failure();
  const text = await boundedLedgerText(object, { bytes: 0 }, (_kind, bytes) => { if (bytes > max) throw failure(); }, failure);
  return { value: JSON.parse(text) as T, etag: object.etag };
}
async function save(env: Env, key: string, value: unknown, etag: string | null): Promise<string> {
  const output = await env.STORAGE.put(key, recoveryJSON(value), { onlyIf: etag === null ? { etagDoesNotMatch: '*' } : { etagMatches: etag } });
  if (!output?.etag || output.key !== key) throw failure(); return output.etag;
}
async function textDigest(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(n => n.toString(16).padStart(2, '0')).join('');
}
function compareIds(left: string, right: string): number {
  const a=Array.from(left),b=Array.from(right);
  for(let i=0;i<Math.min(a.length,b.length);i++){const order=a[i]!.codePointAt(0)!-b[i]!.codePointAt(0)!;if(order)return order;}
  return a.length-b.length;
}
const rowsDigest = (rows: Array<{ id: string; hash: string }>) => textDigest([...rows].sort((a,b)=>compareIds(a.id,b.id)).map(row => row.id + ':' + row.hash).join('\n'));
async function journalSeal(env: Env, tenant: string, key: string, journal: Journal): Promise<string> {
  // Purpose-separated custody for continuation offsets/acknowledged cohorts.
  // IDENTITY_SALT is the existing stable secret whose rotation is forbidden by
  // the stamp workflow; neither operator-provided hashes nor SQL receipts mint
  // this authority. No additional credential or provider configuration exists.
  if(typeof env.IDENTITY_SALT!=='string'||!env.IDENTITY_SALT.trim())throw new ConnectorUnavailable('policy');
  const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.IDENTITY_SALT),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const {seal,...body}=journal; void seal;
  const bytes=await crypto.subtle.sign('HMAC',material,new TextEncoder().encode(recoveryJSON({purpose:'warehouse-journal-v1',tenant,key,body})));
  return [...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
async function generation(env: Env, tenant: string, configuration: WarehouseConfiguration): Promise<Generation> {
  const digest = await connectorDigest({ purpose: 'warehouse', tenant, ...configuration });
  const value: Generation = { version: 1, tenant, digest, configuration }, key = root(tenant) + 'generations/' + digest + '.json';
  const old = await read<Generation>(env, key, 32768);
  if (old) { if (recoveryJSON(old.value) !== recoveryJSON(value)) throw failure(); }
  else {
    const indexKey=root(tenant)+'inventory.json', index=await read<{generations:string[]}>(env,indexKey,16384);
    const listed=await env.STORAGE.list({prefix:root(tenant)+'generations/',limit:100});
    if(listed.truncated)throw new ConnectorUnavailable('limit');
    if(index&&(!Array.isArray(index.value.generations)||index.value.generations.length>100
      ||new Set(index.value.generations).size!==index.value.generations.length))throw failure();
    const generations=[...new Set([...(index?.value.generations??[]),...listed.objects.map(o=>o.key.slice(o.key.lastIndexOf('/')+1,-5))])].sort();
    if(generations.some(value=>!hash.test(value)))throw failure();
    if(!generations.includes(digest)){
      if(generations.length>=100)throw new ConnectorUnavailable('limit');generations.push(digest);generations.sort();
      await save(env,indexKey,{generations},index?.etag??null);
    }
    try { await save(env, key, value, null); } catch (error) {
      const observed = await read<Generation>(env, key, 32768);
      if (!observed || recoveryJSON(observed.value) !== recoveryJSON(value)) throw error;
    }
  }
  return value;
}
/** Historical non-secret mappings survive removal of current upload authority. */
export async function warehouseDestinations(env: Env, tenant: string): Promise<Generation[]> {
  const page = await env.STORAGE.list({ prefix: root(tenant) + 'generations/', limit: 100 });
  if (page.truncated) throw new ConnectorUnavailable('limit');
  const result: Generation[] = [];
  for (const object of page.objects) {
    const saved = await read<Generation>(env, object.key, 32768); if (!saved) throw failure();
    const value = saved.value, config = warehouseConfigurationSchema.parse(value.configuration);
    if (value.version !== 1 || value.tenant !== tenant || !hash.test(value.digest)
      || object.key !== root(tenant) + 'generations/' + value.digest + '.json'
      || value.digest !== await connectorDigest({ purpose: 'warehouse', tenant, ...config })) throw failure();
    result.push(value);
  }
  return result;
}
async function source(env: Env, tenant: string, gen: Generation, key: string, deadline: ConnectorDeadline, offset = 0, expectedRevision?: string): Promise<Source> {
  if (!sourceKey(key, tenant)) throw failure();
  const object = await env.STORAGE.get(key); deadline.live();
  if (!object) return { key, revision: 'missing', rows: [], stamps: [], sourceDigest: await rowsDigest([]), next: 0, final: true };
  // An offset is meaningful only within its pinned revision. Detect replacement
  // before reading/validating that offset, including a shorter replacement.
  if (expectedRevision !== undefined && object.etag !== expectedRevision) offset = 0;
  const text = await boundedLedgerText(object, { bytes: 0 }, (_kind, n) => { if (n > MANAGED_BYTES) throw new ConnectorUnavailable('limit'); }, failure);
  const category = await destinationRetentionCategory('warehouse', { purpose: 'warehouse', tenant, ...gen.configuration });
  const rows: WarehouseRow[] = [], stamps: RetentionStamp[] = [], ids = new Set<string>();
  const stream = key.split('/')[3] as LedgerStream;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length || offset > 0 && text[offset-1] !== '\n') throw failure();
  const tombstones = new Map<string, Awaited<ReturnType<typeof loadTombstone>>>();
  let position = offset, visited = 0, size = 2048;
  while (position < text.length && visited < Math.min(256, gen.configuration.maxRows)) {
    deadline.live(); const start = position, end = text.indexOf('\n', start), line = text.slice(start, end < 0 ? text.length : end);
    position = end < 0 ? text.length : end + 1; visited++; if (!line) continue;
    const row = JSON.parse(line) as CapturedRecord & { externalRetention?: ExternalRetention };
    if (!validCarrier(row, stream) || row.tenant !== tenant) throw failure();
    if (row.ts < gen.configuration.startAt) continue;
    const ledger = readRetention(row.retention?.ledger, tenant, 'ledger'), external = readRetention(row.externalRetention?.[category], tenant, category);
    if (Math.min(ledger.expiresAt, external.expiresAt) <= Date.now()) continue;
    requireRetention(env, ledger, tenant, 'ledger'); requireRetention(env, external, tenant, category);
    if (!tombstones.has(row.visitor_id)) tombstones.set(row.visitor_id, await loadTombstone(env.STORAGE, tenant, row.visitor_id));
    const tombstone = tombstones.get(row.visitor_id); deadline.live();
    if (tombstone && row.ts <= tombstone.erased_at) continue;
    const id = 'decision_id' in row && stream === 'decision' ? row.decision_id : 'outcome_id' in row ? row.outcome_id : (row as { record_id: string }).record_id;
    if(new TextDecoder().decode(new TextEncoder().encode(id as string))!==id)throw failure();
    if (ids.has(id)) throw failure(); ids.add(id);
    const subject = await connectorIdentity(tenant, gen.configuration.identityNamespace, row.visitor_id);
    // No browser session or internal transport provenance is exported. The
    // stable receiver identity has an explicit, versioned namespace.
    const projected = Object.fromEntries(Object.entries(row).filter(([name]) => ![DELIVERY_FIELD, 'visitor_id', 'session_id', 'externalRetention'].includes(name)));
    const raw = recoveryJSON({ ...projected, visitor_id: subject });
    const encoded = new TextEncoder().encode(raw); let binary = '';
    for (let i = 0; i < encoded.length; i += 16384) binary += String.fromCharCode(...encoded.subarray(i, i + 16384));
    const captured = { id, subject, ts: row.ts, expiresAt: Math.min(ledger.expiresAt, external.expiresAt), hash: await textDigest(raw), wire: btoa(binary) };
    const added = new TextEncoder().encode(recoveryJSON(captured)).length;
    if (size + added > gen.configuration.maxBytes) { if (!rows.length) throw new ConnectorUnavailable('limit'); position = start; break; }
    size += added; rows.push(captured);
    stamps.push(ledger, external);
  }
  return { key, revision: object.etag, rows, stamps, sourceDigest: await rowsDigest(rows), next: position, final: position >= text.length };
}
async function currentCutoffs(env: Env, tenant: string, gen: Generation, keys: string[], deadline: ConnectorDeadline) {
  const result: Array<{ subject: string; at: number }> = [];
  for (const key of keys) {
    if (!key.startsWith(pendingPrefix(tenant)) || !key.endsWith('.json')) throw failure();
    const id = decodeURIComponent(key.slice(pendingPrefix(tenant).length, -5));
    const tombstone = await loadTombstone(env.STORAGE, tenant, id); deadline.live();
    if (!tombstone) throw failure();
    result.push({ subject: await connectorIdentity(tenant, gen.configuration.identityNamespace, id), at: tombstone.erased_at });
  }
  return result;
}
function transport(env: Env, tenant: string, gen: Generation, pending: Pending, deadline: ConnectorDeadline) {
  deadline.live(); if (pending.cleanup) return;
  if (recoveryJSON(connectorConfiguration(env, tenant).warehouse ?? null) !== recoveryJSON(gen.configuration)) throw new ConnectorUnavailable('disabled');
  if (pending.expiresAt <= Date.now()) throw new ConnectorUnavailable('policy');
  for (const stamp of pending.stamps) requireRetention(env, stamp, tenant, stamp.category);
}
function checkedReadback(value: unknown, pending: Pending): WarehouseReadback {
  const r = value as WarehouseReadback, p = pending.payload;
  if (!r || r.version !== 1 || r.operation !== p.operation || r.digest !== pending.digest || r.sequence !== p.sequence
    || r.currentRowsOnly !== true || r.expiredRemaining !== 0 || !Array.isArray(r.rows) || r.count !== r.rows.length
    || recoveryJSON(r.rows) !== recoveryJSON(p.rows.map(({ id, hash }) => ({ id, hash })).sort((a, b) => compareIds(a.id,b.id)))
    || !Array.isArray(r.cutoffs) || r.cutoffs.length !== p.cutoffs.length
    || r.cutoffs.some((c,i) => c.subject !== p.cutoffs[i]?.subject || !Number.isSafeInteger(c.at) || c.at < p.cutoffs[i]!.at)
    || (p.final && (r.sourceCount !== p.total || r.sourceDigest !== p.sourceDigest))) throw failure();
  return r;
}
async function runGeneration(env: Env, gen: Generation, current: boolean, deadline: ConnectorDeadline): Promise<number> {
  const { tenant, digest, configuration: config } = gen, key = root(tenant) + 'jobs/' + digest + '.json';
  const saved = await read<Journal>(env, key); let etag = saved?.etag ?? null;
  const j: Journal = saved ? journalSchema.parse(saved.value) as Journal : { version: 1, generation: digest, sequence: 0, due: 0, mode: 'cutoffs', cursor: null, page: [], next: null, more: false, index: 0 };
  if(saved&&j.seal!==await journalSeal(env,tenant,key,j))throw failure();
  if (j.generation !== digest || j.page.length > config.maxObjects || j.index > j.page.length
    || j.page.some((key,i)=>i>0&&key<=j.page[i-1]!) || j.more !== (j.next !== null)) throw failure();
  if(j.source){
    if(j.source.key!==j.page[j.index]||!sourceKey(j.source.key,tenant)||j.source.sequence>j.sequence
      ||j.source.offset>MANAGED_BYTES||j.source.total>MANAGED_BYTES)throw failure();
    for(const stamp of j.source.authority)readRetention(stamp,tenant,stamp.category);
  }
  if (j.pending) {
    const pending=j.pending,p=pending.payload;
    if(p.tenant!==tenant||p.generation!==digest||p.sequence!==j.sequence||p.sourceSequence>p.sequence
      ||new Set(p.rows.map(row=>row.id)).size!==p.rows.length||p.rows.some(row=>!row.id.startsWith(tenant+':')||row.expiresAt<=row.ts)
      ||p.operation===pending.readOperation||new Set(p.cutoffs.map(c=>c.subject)).size!==p.cutoffs.length)throw failure();
    for(const stamp of pending.stamps)readRetention(stamp,tenant,stamp.category);
    if(pending.cleanup){
      if(p.rows.length||pending.stamps.length||p.total!==0||p.part!==0||p.sourceSequence!==p.sequence
        ||p.mode==='barrier'&&(p.final||!sourceKey(p.source,tenant)||j.mode!=='sources'||p.source!==j.page[j.index]
          ||!/^cancelled-[a-f0-9-]{36}$/.test(p.revision))
        ||p.mode==='replace'&&(!p.final||!p.source.startsWith('cutoff/')&&!sourceKey(p.source,tenant)))throw failure();
      if(p.mode==='replace'){
        if(p.source==='cutoff/maintenance'){
          if(j.mode!=='cutoffs'||j.page[j.index]!==pendingPrefix(tenant)+'__maintenance__'||p.cutoffs.length||p.revision!=='maintenance-'+p.sequence)throw failure();
        }else if(p.source.startsWith('cutoff/')){
          if(j.mode!=='cutoffs'||p.source!=='cutoff/'+await connectorDigest(j.page[j.index])||p.revision!==await connectorDigest(p.cutoffs))throw failure();
        }else if(j.mode!=='missing'||p.revision!=='missing'||!j.page[j.index]?.startsWith(root(tenant)+'sources/'+digest+'/'))throw failure();
        if(p.sourceDigest!==await textDigest(await textDigest('')+'\n'+await rowsDigest([])))throw failure();
      }
    }else if(!j.source||p.mode!=='replace'||p.source!==j.page[j.index]||p.source!==j.source.key||p.revision!==j.source.revision
      ||p.sourceSequence!==j.source.sequence||p.part!==j.source.part||p.total!==j.source.total+p.rows.length
      ||p.sourceDigest!==await textDigest(j.source.digest+'\n'+await rowsDigest(p.rows))||!pending.stamps.length&&p.rows.length
      ||pending.expiresAt!==Math.min(...pending.stamps.map(s=>s.expiresAt),...j.source.authority.map(s=>s.expiresAt),Number.MAX_SAFE_INTEGER))throw failure();
  }
  const persist = async () => {
    deadline.live();
    // Retain commitments and minimal disposal debt, not another raw-data copy.
    // A retry reconstructs the exact original wire from its immutable source
    // revision; changed/missing/expired source requires cancellation, not renewal.
    const retained = structuredClone(j);
    if (retained.pending) { retained.pending.wire = ''; for (const row of retained.pending.payload.rows) row.wire = ''; }
    retained.seal=await journalSeal(env,tenant,key,retained);
    etag = await save(env, key, retained, etag); deadline.live();
  };
  if (j.due > Date.now() && !j.pending) return 0;
  const cancel = async (cutoffs: WarehousePayload['cutoffs'] = [], debtSubjects: string[] = []) => {
    const old=j.pending?.payload??{version:1 as const,tenant,generation:digest,source:j.source!.key,operation:crypto.randomUUID()};j.sequence++;
    j.pending={...await pendingFor({...old,operation:crypto.randomUUID(),sequence:j.sequence,sourceSequence:j.sequence,
      revision:'cancelled-'+old.operation,mode:'barrier',rows:[],cutoffs,part:0,final:false,total:0,sourceDigest:await rowsDigest([])},[],true),debtSubjects};
    delete j.source;await persist();
  };
  // Dispose expired/withdrawn upload commitments before any external/local
  // dependency can stall. Retained barriers contain no original row identities.
  if(j.source||j.pending&&!j.pending.cleanup){
    let authorized=current&&(j.pending?.expiresAt??Number.MAX_SAFE_INTEGER)>Date.now();
    try{for(const stamp of [...(j.pending?.stamps??[]),...(j.source?.authority??[])])requireRetention(env,stamp,tenant,stamp.category);}catch{authorized=false;}
    if(!authorized)await cancel();
  }
  const withdrawn: WarehousePayload['cutoffs'] = [];
  const debtSubjects: string[] = [];
  if (j.pending && !j.pending.cleanup) for (const row of j.pending.payload.rows) {
    const subject = row.id.split(':')[2]; if (!subject) throw failure();
    const tombstone = await loadTombstone(env.STORAGE, tenant, subject); deadline.live();
    if (tombstone && row.ts <= tombstone.erased_at && !withdrawn.some(c => c.subject === row.subject)) { withdrawn.push({ subject: row.subject, at: tombstone.erased_at }); debtSubjects.push(subject); }
  }
  const sourceChanged = j.pending && !j.pending.cleanup && (await env.STORAGE.head(j.pending.payload.source))?.etag !== j.pending.payload.revision;
  if (j.pending && !j.pending.cleanup && (!current || j.pending.expiresAt <= Date.now() || withdrawn.length || sourceChanged)) {
    // Never retain an expired raw upload to retry it under a new clock. A
    // higher source sequence closes even a delayed old SQL acknowledgement.
    await cancel(withdrawn,debtSubjects);
  }
  if (j.pending) {
    const pending = j.pending;
    if (!pending.cleanup) {
      const original = await source(env, tenant, gen, pending.payload.source, deadline, j.source?.offset ?? 0);
      if (original.revision !== pending.payload.revision || original.next!==pending.nextOffset || original.final!==pending.payload.final
        ||recoveryJSON(original.stamps)!==recoveryJSON(pending.stamps)||recoveryJSON(original.rows.map(({wire,...row})=>{void wire;return row;}))
          !==recoveryJSON(pending.payload.rows.map(({wire,...row})=>{void wire;return row;}))) throw failure();
      for (const row of pending.payload.rows) {
        const retained = original.rows.find(candidate => candidate.id === row.id);
        if (!retained || retained.hash !== row.hash || retained.expiresAt !== row.expiresAt || retained.subject !== row.subject || retained.ts !== row.ts) throw failure();
        row.wire = retained.wire;
      }
    }
    pending.wire = recoveryJSON(pending.payload);
    if (pending.digest !== await textDigest(pending.wire) || recoveryJSON(pending.payload) !== pending.wire) throw failure();
    const authorize = async () => {
      deadline.live(); const latest = await read<Journal>(env, key);
      if (!latest || latest.etag !== etag || latest.value.pending?.digest !== pending.digest) throw failure();
      if (!pending.cleanup) for (const row of pending.payload.rows) {
        const tombstone = await loadTombstone(env.STORAGE, tenant, row.id.split(':')[2]!);
        if (tombstone && row.ts <= tombstone.erased_at) throw new ConnectorUnavailable('policy');
      }
      if(!pending.cleanup)for(const stamp of j.source?.authority??[])requireRetention(env,stamp,tenant,stamp.category);
      if(!pending.cleanup&&(await env.STORAGE.head(pending.payload.source))?.etag!==pending.payload.revision)throw failure();
      if(pending.cleanup&&pending.payload.mode==='replace'&&!pending.payload.source.startsWith('cutoff/')){
        const prior=await read<{key:string}>(env,j.page[j.index]!,32768);
        if(!prior||prior.value.key!==pending.payload.source||await env.STORAGE.head(pending.payload.source))throw failure();
      }
      if(pending.cleanup&&pending.payload.cutoffs.length){
        const keys=pending.debtSubjects?.map(id=>pendingPrefix(tenant)+encodeURIComponent(id)+'.json')??[j.page[j.index]!];
        const actual=await currentCutoffs(env,tenant,gen,keys,deadline);
        if(pending.payload.cutoffs.some(c=>!actual.some(a=>a.subject===c.subject&&a.at>=c.at)))throw failure();
      }
      transport(env, tenant, gen, pending, deadline);
    };
    const send = (readback: boolean) => warehouseStatement(env, config, readback ? pending.readOperation : pending.payload.operation,
      readback ? recoveryJSON({ tenant, generation: digest, operation: pending.payload.operation, digest: pending.digest }) : pending.wire,
      readback, readback ? pending.readHandle : pending.applyHandle, deadline, authorize, () => transport(env, tenant, gen, pending, deadline));
    if (!pending.applied) {
      const applied = await send(false);
      if (applied.pending) { pending.applyHandle = applied.handle; await persist(); return 0; }
      pending.applied = true; await persist();
    }
    // A completed/unknown READ is never a reusable current-state attestation.
    // Only a retained in-flight handle is polled; a fresh read gets a new ID.
    if (!pending.readHandle) {
      if (pending.readAttempted) pending.readOperation = crypto.randomUUID();
      pending.readAttempted = true; await persist();
    }
    // Remove a polling handle durably BEFORE observing its result. A lost
    // completion/checkpoint ACK can only cause a fresh READ, never reuse a
    // previously completed statement as current-state proof. A 202/429 response
    // explicitly restores the same still-in-flight handle below.
    const polling = pending.readHandle;
    if (polling) { delete pending.readHandle; pending.readAttempted = true; await persist(); }
    const result = polling ? await warehouseStatement(env, config, pending.readOperation,
      recoveryJSON({ tenant, generation: digest, operation: pending.payload.operation, digest: pending.digest }),
      true, polling, deadline, authorize, () => transport(env, tenant, gen, pending, deadline)) : await send(true);
    if (result.pending) { pending.readHandle = result.handle; await persist(); return 0; }
    // Retire a known completed handle before validation/checkpoint awaits.
    delete pending.readHandle; pending.readOperation=crypto.randomUUID(); pending.readAttempted=false; await persist();
    checkedReadback(result.value, pending); await authorize();
    if (!pending.cleanup && (await env.STORAGE.head(pending.payload.source))?.etag !== pending.payload.revision) throw failure();
    transport(env, tenant, gen, pending, deadline);
    if (pending.payload.mode !== 'barrier' && !pending.payload.source.startsWith('cutoff/')) {
      const sourcePath = root(tenant) + 'sources/' + digest + '/' + await connectorDigest(pending.payload.source) + '.json';
      const previous = await read<{ key: string; revision: string; sequence: number }>(env, sourcePath, 32768);
      if (!previous || previous.value.sequence <= pending.payload.sequence) await save(env, sourcePath,
        { key: pending.payload.source, revision: pending.payload.revision, sequence: pending.payload.sequence }, previous?.etag ?? null);
    }
    if (j.source && !pending.payload.final) { j.source.part++; j.source.offset = pending.nextOffset!; j.source.total = pending.payload.total; j.source.digest = pending.payload.sourceDigest; }
    else { delete j.source; j.index++; }
    delete j.pending; await persist(); return 1;
  }
  if (j.index >= j.page.length) {
    if (j.page.length || j.more) {
      if (j.more) { if (!j.next || j.next === j.cursor) throw failure(); j.cursor = j.next; }
      else { j.cursor = null; j.mode = j.mode === 'cutoffs' ? current ? 'sources' : 'cutoffs' : j.mode === 'sources' ? 'missing' : 'cutoffs';
        if (j.mode === 'cutoffs') { j.due = Date.now() + config.cadenceMs; j.page = []; j.index = 0; await persist(); return 0; } }
    }
    if (!current && j.mode !== 'cutoffs') { j.mode = 'cutoffs'; j.cursor = null; }
    const prefix = j.mode === 'cutoffs' ? pendingPrefix(tenant) : j.mode === 'sources' ? tenant + '/' : root(tenant) + 'sources/' + digest + '/';
    const page = await env.STORAGE.list({ prefix, limit: config.maxObjects, ...(j.cursor ? { cursor: j.cursor } : {}) }); deadline.live();
    j.page = page.objects.map(o => o.key); j.index = 0; j.more = page.truncated; j.next = page.truncated ? page.cursor : null;
    if (!j.page.length && !j.more) {
      if(j.mode==='cutoffs'){
        j.sequence++;j.page=[pendingPrefix(tenant)+'__maintenance__'];
        j.pending=await pendingFor({version:1,tenant,generation:digest,operation:crypto.randomUUID(),sequence:j.sequence,
          source:'cutoff/maintenance',revision:'maintenance-'+j.sequence,sourceSequence:j.sequence,part:0,final:true,mode:'replace',
          total:0,sourceDigest:await textDigest(await textDigest('')+'\n'+await rowsDigest([])),rows:[],cutoffs:[]},[],true);
      }else{j.mode=j.mode==='sources'?'missing':'cutoffs';j.cursor=null;if(j.mode==='cutoffs')j.due=Date.now()+config.cadenceMs;}
    }
    await persist(); return 0;
  }
  let input: Source, cutoffs: WarehousePayload['cutoffs'] = [], cleanup = false;
  const selected = j.page[j.index]!;
  if (j.mode === 'cutoffs') {
    cutoffs = await currentCutoffs(env, tenant, gen, [selected], deadline); cleanup = true;
    input = { key: 'cutoff/' + await connectorDigest(selected), revision: await connectorDigest(cutoffs), rows: [], stamps: [], sourceDigest: await rowsDigest([]), next: 0, final: true };
  } else if (j.mode === 'missing') {
    const prior = await read<{ key: string; revision: string }>(env, selected, 32768); if (!prior) throw failure();
    if (!sourceKey(prior.value.key, tenant) || await env.STORAGE.head(prior.value.key)) { j.index++; await persist(); return 0; }
    cleanup = true; input = { key: prior.value.key, revision: 'missing', rows: [], stamps: [], sourceDigest: await rowsDigest([]), next: 0, final: true };
  } else {
    if (!sourceKey(selected, tenant)) { j.index++; await persist(); return 0; }
    if(j.source&&(await env.STORAGE.head(selected))?.etag!==j.source.revision)delete j.source;
    input = await source(env, tenant, gen, selected, deadline, j.source?.offset ?? 0, j.source?.revision);
    if(j.source&&input.revision!==j.source.revision){
      // HEAD is advisory: a replacement can land before the following GET.
      // Its first cohort must read from zero, never reuse the old revision's
      // offset and then pretend the already-truncated window began at zero.
      delete j.source;
    }
  }
  if (j.source && (j.source.key !== input.key || j.source.revision !== input.revision)) delete j.source;
  j.sequence++;
  const cohort = j.source ?? { key: input.key, revision: input.revision, digest: await textDigest(''), sequence: j.sequence, part: 0, offset: 0, total: 0, authority: [] };
  if(!cleanup)j.source=cohort;else delete j.source;
  const authority = new Map(cohort.authority.map(stamp=>[stamp.category,stamp]));
  for(const stamp of input.stamps)if(stamp.expiresAt<(authority.get(stamp.category)?.expiresAt??Infinity))authority.set(stamp.category,stamp);
  cohort.authority=[...authority.values()];
  const rows = input.rows;
  const payload: WarehousePayload = { version: 1, tenant, generation: digest, operation: crypto.randomUUID(), sequence: j.sequence, mode: 'replace',
    source: input.key, revision: input.revision, sourceSequence: cohort.sequence, part: cohort.part,
    final: input.final, total: cohort.total + rows.length, sourceDigest: await textDigest(cohort.digest + '\n' + input.sourceDigest), rows, cutoffs };
  j.pending = { ...await pendingFor(payload, input.stamps, cleanup), nextOffset: input.next };
  j.pending.expiresAt=Math.min(j.pending.expiresAt,...cohort.authority.map(stamp=>stamp.expiresAt));
  await persist(); return 0;
}
async function pendingFor(payload: WarehousePayload, stamps: RetentionStamp[], cleanup: boolean): Promise<Pending> {
  const wire = recoveryJSON(payload);
  return { payload, wire, digest: await textDigest(wire), expiresAt: Math.min(...stamps.map(s => s.expiresAt), Number.MAX_SAFE_INTEGER),
    stamps, readOperation: crypto.randomUUID(), cleanup };
}
/** One bounded step per generation. Every full walk restarts from the beginning,
 * so late older-hour writes and source rewrites cannot hide behind a watermark. */
export async function runWarehouse(env: Env, tenant: string, parent?: ConnectorDeadline): Promise<WarehouseResult> {
  let processed = 0;
  try {
    return await connectorDeadline(30000, async deadline => {
      let selected: WarehouseConfiguration | undefined, admissionFailed=false, capacity=false;
      try { selected=connectorConfiguration(env,tenant).warehouse; } catch { admissionFailed=true; }
      if (selected) try{await generation(env, tenant, selected);}catch(error){admissionFailed=true;capacity=error instanceof ConnectorUnavailable&&error.code==='limit';}
      const generations = await warehouseDestinations(env, tenant); deadline.live();
      if (!generations.length) return { status: 'disabled', complete: false, processed, currentRowsOnly: true };
      // Persist a fair cursor before awaiting any destination. One unavailable
      // retired credential cannot starve cleanup of every later generation.
      const cursorKey = root(tenant) + 'schedule.json', prior = await read<{ after: string }>(env, cursorKey, 4096);
      if (prior && !hash.test(prior.value.after)) throw failure();
      generations.sort((a,b)=>a.digest.localeCompare(b.digest));
      const gen = generations.find(value=>value.digest>(prior?.value.after??'')) ?? generations[0]!;
      await save(env, cursorKey, { after: gen.digest }, prior?.etag ?? null); deadline.live();
      const current = !!selected && recoveryJSON(selected) === recoveryJSON(gen.configuration);
      processed += await connectorDeadline(gen.configuration.timeoutMs, inner => runGeneration(env, gen, current, inner), deadline);
      return { status: admissionFailed?'failed':processed ? 'progress' : 'pending', ...(capacity?{reason:'generation_capacity' as const}:{}), complete: false, processed, currentRowsOnly: true };
    }, parent);
  } catch { return { status: 'failed', complete: false, processed, currentRowsOnly: true }; }
}
/** One invocation-wide fair tenant slice. The explicit actual-I/O allowance
 * leaves room for unchanged monitor/hourly/recovery work in the same cron. */
export async function runWarehouses(raw: Env, tenants: readonly string[]): Promise<WarehouseResult> {
  let calls=0;
  try{return await connectorDeadline(30000,async deadline=>{
    const bounded: ConnectorDeadline={...deadline,charge(){deadline.live();if(++calls>4096)throw new ConnectorUnavailable('limit');}};
    const env=Object.create(raw) as Env;
    Object.defineProperty(env,'STORAGE',{value:new Proxy(raw.STORAGE,{get(target,key){
      const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
      return (...args:unknown[])=>{bounded.charge!();return Reflect.apply(value,target,args);};
    }})});
    if(!tenants.length)return {status:'disabled',complete:false,processed:0,currentRowsOnly:true};
    const key='warehouse/v1/schedule.json',saved=await read<{after:string}>(env,key,4096),ordered=[...tenants].sort();
    if(saved&&(typeof saved.value.after!=='string'||!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(saved.value.after)))throw failure();
    const tenant=ordered.find(value=>value>(saved?.value.after??''))??ordered[0]!;
    await save(env,key,{after:tenant},saved?.etag??null);deadline.live();
    const result=await runWarehouse(env,tenant,bounded);deadline.live();return result;
  });}catch{return {status:'failed',complete:false,processed:0,currentRowsOnly:true};}
}
