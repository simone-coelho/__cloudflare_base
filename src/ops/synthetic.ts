// Internal monitoring authority. A customer capability, header, visitor prefix
// or native id.name is never a synthetic grant. All physical addresses are
// reconstructed from a signed operation and checked against the actual DO id.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Env } from '@/types/env';
import { connectorConfiguration, connectorDigest, configuredOperationalDestinations, SYNTHETIC_BINDINGS, type SyntheticConfiguration } from '@/connectors/config';
import { readSigningConfig } from '@/auth/signingConfig.mjs';
import { RETENTION_CATEGORIES, retentionBirth, requireRetention, type RetentionStamp } from '@/retention';
import { pinPublication, readPinnedPublication } from '@/config/publication';
import { SLOTS_KIND, LEARN_KIND } from '@/content/kinds';
import { armFor } from '@/content/holdout';
import { shopperObjectName } from '@/tenancy/objects';
import { issueSessionCapability, type SessionCapability } from '@/identity/sessionCapability';
import { forwardShopperRequest } from '@/identity/sessionAuthority';
import { consumeLedger } from '@/ledger/consume';
import { recoveryConfiguration } from '@/ledger/quarantine';

export const SYNTHETIC_HEADER = 'X-Internal-Monitor';
export const SYNTHETIC_KIND = 'ops-synthetic-v1';
const MARKER = '__monitor_authority_v1';
const LIMITS = { slots: 8, keys: 256, bytes: 8 * 1024 * 1024, body: 120000, objects: 12 };
type Host = 'session' | 'do';
type Binding = typeof SYNTHETIC_BINDINGS[number];
type NativeBinding = Extract<Binding, 'SHOPPER_REFLEX' | 'DECISION_RING' | 'LEARN_STATS' | 'REGION_TREND' | 'PERSONALIZATION_WEBSOCKET'>;
interface Scope {
  version: 1; tenant: string; host: Host; operation: string; bornAt: number; expiresAt: number;
  configuration: string; policy: string; subject: string; sessionId: string; slots: string[];
  retention: Record<string, RetentionStamp>;
}
interface Signed<T> { value: T; signature: string }
interface NativeCall { scope: Signed<Scope>; binding: NativeBinding; name: string; url: string; method: string; body: string; headers: string; until: number }
interface Marker { call: Signed<NativeCall>; terminal?: boolean }
const held = new AsyncLocalStorage<{ raw: Env; env: Env; scope: Scope; until: number }>();
const bytes = new TextEncoder();
export class SyntheticUnavailable extends Error { constructor() { super('Synthetic monitor unavailable'); } }
function deny(): never { throw new SyntheticUnavailable(); }
const hash = (v: unknown) => connectorDigest(v);
const base = (scope: Pick<Scope, 'tenant' | 'host'>) => `${SYNTHETIC_KIND}/${scope.tenant}/${scope.host}/`;
const controlKey = (tenant: string, host: Host) => `${SYNTHETIC_KIND}/${tenant}/${host}/control.json`;
const dataPrefix = (scope: Scope) => `${base(scope)}data/${scope.operation}/`;
const canonical = (v: unknown): string => JSON.stringify(v, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
async function signature(env: Env, purpose: string, value: unknown): Promise<string> {
  const cfg = readSigningConfig(env); if (!cfg) deny();
  const key = await crypto.subtle.importKey('raw', cfg!.key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = await crypto.subtle.sign('HMAC', key, bytes.encode(canonical(['isolated-monitor/v1', purpose, cfg!.issuer, cfg!.audience, value])));
  return Array.from(new Uint8Array(signed)).map(v => v.toString(16).padStart(2, '0')).join('');
}
async function seal<T>(env: Env, purpose: string, value: T): Promise<Signed<T>> { return { value, signature: await signature(env, purpose, value) }; }
async function verify<T>(env: Env, purpose: string, input: Signed<T>): Promise<T> {
  if (!input || typeof input !== 'object' || Object.keys(input).sort().join(',') !== 'signature,value'
    || typeof input.signature !== 'string' || !/^[a-f0-9]{64}$/.test(input.signature)
    || bytes.encode(canonical(input)).length > 32000) deny();
  const actual = await signature(env, purpose, input.value);
  let difference = 0; for (let i = 0; i < actual.length; i++) difference |= actual.charCodeAt(i) ^ input.signature.charCodeAt(i);
  if (difference) deny(); return input.value;
}
async function policy(env: Env, tenant: string, now: number) {
  const descriptor = connectorConfiguration(env, tenant).telemetry?.synthetic;
  if (!descriptor) deny();
  const destinations = (await configuredOperationalDestinations(env, tenant)).filter(d => d.configuration.purpose === 'isolated-synthetic-monitor');
  if (destinations.length !== SYNTHETIC_BINDINGS.length) deny();
  const retention = Object.fromEntries(destinations.map(d => [String(d.configuration.binding), retentionBirth(env, tenant, d.category, now, now)]));
  return { descriptor: descriptor!, retention, digest: await hash({ descriptor, retention: Object.fromEntries(Object.entries(retention).map(([k, v]) => [k,
    { category: v.category, policyId: v.policyId, policyRevision: v.policyRevision, durationMs: v.expiresAt - v.bornAt, basis: v.basis }])) }) };
}
async function validateScope(env: Env, signed: Signed<Scope>, allowExpired = false): Promise<{ scope: Scope; descriptor: SyntheticConfiguration }> {
  const scope = await verify(env, 'scope', signed), now = Date.now();
  if (!scope || scope.version !== 1 || !['session', 'do'].includes(scope.host) || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(scope.tenant)
    || !/^[a-f0-9-]{36}$/.test(scope.operation) || !Number.isSafeInteger(scope.bornAt) || !Number.isSafeInteger(scope.expiresAt)
    || scope.bornAt > now || scope.expiresAt <= scope.bornAt || scope.expiresAt - scope.bornAt > 300000
    || (!allowExpired && scope.expiresAt <= now) || !Array.isArray(scope.slots) || !scope.slots.length || scope.slots.length > LIMITS.slots
    || new Set(scope.slots).size !== scope.slots.length || scope.slots.some(slot => typeof slot !== 'string' || slot.length > 128)
    || !/^vis-[a-f0-9-]{36}$/.test(scope.subject) || !/^s-[a-f0-9-]{36}$/.test(scope.sessionId)) deny();
  const current = await policy(env, scope.tenant, now);
  if (current.digest !== scope.policy || scope.expiresAt !== Math.min(scope.bornAt + current.descriptor.lifetimeMs,
    ...Object.values(scope.retention).map(v => v.expiresAt))) deny();
  for (const binding of SYNTHETIC_BINDINGS) {
    const stamp = scope.retention[binding]; if (!stamp || stamp.bornAt !== scope.bornAt) deny();
    if (!allowExpired) requireRetention(env, stamp, scope.tenant, current.retention[binding]!.category, now);
  }
  if (!allowExpired && (await pinPublication(env, scope.tenant)).digest !== scope.configuration) deny();
  return { scope, descriptor: current.descriptor };
}
function names(scope: Scope, binding: NativeBinding): string[] {
  if (binding === 'SHOPPER_REFLEX' || binding === 'PERSONALIZATION_WEBSOCKET') return [shopperObjectName(scope.tenant, scope.subject)];
  if (binding === 'DECISION_RING') return [`${scope.tenant}:${scope.subject}`];
  if (binding === 'LEARN_STATS') return scope.slots.map(slot => `${scope.tenant}:${scope.tenant}:${slot}`);
  return [`trend:v2:${scope.tenant}:US-NY`];
}
function physical(scope: Scope, binding: NativeBinding, name: string): string {
  const index = names(scope, binding).indexOf(name); if (index < 0 || index >= LIMITS.objects) deny();
  return `${base(scope)}${binding}/${index}`;
}
function live(scope: Scope, until: number) { if (Date.now() >= Math.min(scope.expiresAt, until)) deny(); }
function scopedKey(scope: Scope, key: string) {
  if (typeof key !== 'string' || key.length > 1024 || key.includes('\0')) deny();
  return dataPrefix(scope) + key;
}
function r2View(object: R2ObjectBody | R2Object | null, key: string) {
  if (!object) return null;
  return new Proxy(object, { get(target, property) { if (property === 'key') return key;
    const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value; } });
}
async function boundedBody(value: unknown, max = LIMITS.bytes): Promise<string> {
  if (typeof value === 'string') { if (bytes.encode(value).length > max) deny(); return value; }
  const response = new Response(value as BodyInit), reader = response.body?.getReader(); if (!reader) return '';
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }); let out = '', size = 0;
  try { for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
    if (size > max) { await reader.cancel(); deny(); } out += decoder.decode(next.value, { stream: true }); }
    return out + decoder.decode(); } finally { reader.releaseLock(); }
}
async function storageCapacity(storage: R2Bucket, scope: Scope, key: string, size: number) {
  const listed = await storage.list({ prefix: base(scope) + 'data/', limit: LIMITS.keys + 1 });
  if (listed.truncated || listed.objects.length > LIMITS.keys || (!listed.objects.some(o => o.key === key) && listed.objects.length >= LIMITS.keys)
    || listed.objects.reduce((n, o) => n + (o.key === key ? 0 : o.size), size) > LIMITS.bytes) deny();
}
/** Bound wrappers preserve normal sink algorithms and immutable claims. Only
 * configuration is read from its original scope, with an exact committed pin. */
export function syntheticEnvironment(raw: Env): Env { const active = held.getStore(); return active?.raw === raw ? active.env : raw; }
export function syntheticOperation(): Readonly<Scope> | undefined { return held.getStore()?.scope; }
// Transport may synthesize Host/Content-Length on a native binding hop. Those
// do not select an engine operation; every application/routing header does.
const effectiveHeaders = (request: Request) => canonical([...request.headers].filter(([key]) => ![
  SYNTHETIC_HEADER.toLowerCase(), 'host', 'content-length', 'transfer-encoding', 'connection', 'accept-encoding',
].includes(key)).sort(([a], [b]) => a.localeCompare(b)));
async function environment(raw: Env, signed: Signed<Scope>, until: number): Promise<Env> {
  const { scope, descriptor } = await validateScope(raw, signed), env = Object.create(raw) as Env;
  const rawConnectors = raw.TENANT_CONNECTORS, rawRetention = raw.RETENTION;
  const guard = () => { live(scope, until); if (raw.TENANT_CONNECTORS !== rawConnectors || raw.RETENTION !== rawRetention) deny(); };
  async function effect<T>(binding: 'CACHE' | 'SESSIONS' | 'STORAGE', key: string, write: () => Promise<T>, remove: () => Promise<unknown>): Promise<T> {
    guard();
    const debtKey = `${base(scope)}debt/${scope.operation}/${await hash([binding, key])}.json`;
    const debts = await raw.STORAGE.list({ prefix: base(scope) + 'debt/', limit: LIMITS.keys + 1 });
    if (debts.truncated || debts.objects.length >= LIMITS.keys) deny();
    const debt = { scope: signed, binding, key, phase: 'pending' };
    const claim = await raw.STORAGE.put(debtKey, canonical(debt), { onlyIf: new Headers({ 'If-None-Match': '*' }) });
    if (!claim) deny();
    let output: T | undefined, failure: unknown;
    try { guard(); output = await write(); guard(); } catch (error) { failure = error; }
    // Settled write acknowledgement (including rejection after commit) is
    // distinguished from an unresolved provider call across process restart.
    const settled = await raw.STORAGE.put(debtKey, canonical({ ...debt, phase: 'settled' }), { onlyIf: { etagMatches: claim.etag } });
    if (!settled) deny();
    if (failure !== undefined) {
      // A rejected or timed-out acknowledgement is not rollback authority.
      // Live state stays available to unchanged idempotent recovery. Only the
      // original signed expiry permits destructive disposal of this operation.
      if (scope.expiresAt <= Date.now()) await remove();
      await raw.STORAGE.delete(debtKey); throw failure;
    }
    await raw.STORAGE.delete(debtKey); guard(); return output as T;
  }
  Object.defineProperties(env, {
    REFLEX_HOST: { value: scope.host }, DEPLOYMENT_PROFILE: { value: 'customer' },
    TENANT_CONNECTORS: { value: JSON.stringify({ version: 1, tenants: {} }) },
    WEBHOOK_ENDPOINTS: { value: undefined }, ANALYTICS: { value: undefined }, AI: { value: undefined },
    ODP_API_HOST: { value: undefined }, CONNECTOR_MODE: { value: 'mock' }, DECISION_SOURCE: { value: 'mock' },
    RETENTION: { value: JSON.stringify({ version: 1, tenants: { [scope.tenant]: Object.fromEntries(RETENTION_CATEGORIES.map(category => [category,
      { id: 'synthetic-' + scope.policy.slice(0, 32), revision: 1, durationMs: scope.expiresAt - scope.bornAt, basis: 'occurred', renewal: 'new-record-only' }])) } }) },
  });
  for (const binding of ['CACHE', 'SESSIONS'] as const) {
    const target = raw[binding]; if (!target) deny();
    const wrapper = {
      async get(key: string, type?: KVNamespaceGetOptions<undefined> | string) { guard(); return (target.get as unknown as (key: string, type?: unknown) => Promise<unknown>).call(target, scopedKey(scope, key), type); },
      async getWithMetadata(key: string, type?: unknown) { guard(); return (target.getWithMetadata as unknown as (key: string, type?: unknown) => Promise<unknown>).call(target, scopedKey(scope, key), type); },
      async put(key: string, value: unknown, options?: KVNamespacePutOptions) {
        guard(); const text = await boundedBody(value, 256000), listed = await target.list({ prefix: base(scope) + 'data/', limit: LIMITS.keys + 1 });
        if (!listed.list_complete || listed.keys.length >= LIMITS.keys && !listed.keys.some(k => k.name === scopedKey(scope, key))) deny();
        // The global namespace cap includes retired operations. Per-value and
        // key limits together impose a finite 8MiB ceiling on each KV binding.
        if (listed.keys.length > 32 || listed.keys.length === 32 && !listed.keys.some(k => k.name === scopedKey(scope, key))) deny();
        guard(); await effect(binding, key, () => target.put(scopedKey(scope, key), text, { ...options, expirationTtl: undefined,
          expiration: Math.floor(Math.min(scope.expiresAt, options?.expiration ? options.expiration * 1000 : Infinity) / 1000) }), () => target.delete(scopedKey(scope, key)));
      },
      async delete(key: string) { guard(); return target.delete(scopedKey(scope, key)); },
      async list(options?: KVNamespaceListOptions) { guard(); const list = await target.list({ ...options, prefix: scopedKey(scope, options?.prefix ?? ''), limit: Math.min(options?.limit ?? LIMITS.keys, LIMITS.keys) });
        return { ...list, keys: list.keys.map(k => ({ ...k, name: k.name.slice(dataPrefix(scope).length) })) }; },
    };
    Object.defineProperty(env, binding, { value: wrapper });
  }
  const storage = raw.STORAGE;
  Object.defineProperty(env, 'STORAGE', { value: {
    async get(key: string, options?: R2GetOptions) {
      guard();
      if (key.startsWith('config-publication/')) {
        const prefix = key.startsWith(`config-publication/v2/${scope.tenant}/`) || key.startsWith(`config-publication/v1/${scope.tenant}/`) || key.startsWith(`config-publication/v1/tenant:${scope.tenant}/`);
        if (!prefix) deny();
        const object = await storage.get(key, options);
        if (key === `config-publication/v2/${scope.tenant}/head.json` && object) {
          const text = await object.text(), value = JSON.parse(text);
          if (value.committed?.digest !== scope.configuration) deny();
          return { ...object, key, body: new Response(text).body, text: async () => text, json: async () => value };
        }
        return object;
      }
      return r2View(await storage.get(scopedKey(scope, key), options), key);
    },
    async head(key: string) { guard(); return r2View(await storage.head(scopedKey(scope, key)), key); },
    async put(key: string, value: unknown, options?: R2PutOptions) { guard(); if (key.startsWith('config-publication/')) deny();
      const text = await boundedBody(value), physicalKey = scopedKey(scope, key); await storageCapacity(storage, scope, physicalKey, bytes.encode(text).length); guard();
      const written = await effect('STORAGE', key, () => storage.put(physicalKey, text, options), () => storage.delete(physicalKey));
      return r2View(written, key); },
    async delete(key: string | string[]) { guard(); const keys = Array.isArray(key) ? key : [key]; if (keys.length > LIMITS.keys) deny(); return storage.delete(keys.map(k => scopedKey(scope, k))); },
    async list(options?: R2ListOptions) { guard(); const listed = await storage.list({ ...options, prefix: scopedKey(scope, options?.prefix ?? ''), limit: Math.min(options?.limit ?? LIMITS.keys, LIMITS.keys) });
      return { ...listed, objects: listed.objects.map(o => r2View(o, o.key.slice(dataPrefix(scope).length))) }; },
  } });
  for (const binding of ['SHOPPER_REFLEX', 'DECISION_RING', 'LEARN_STATS', 'REGION_TREND', 'PERSONALIZATION_WEBSOCKET'] as const) {
    const target = raw[binding]; if (!target) deny(); const identities = new Map<string, string>();
    Object.defineProperty(env, binding, { value: {
      idFromName(name: string) { guard(); const id = target!.idFromName(physical(scope, binding, name)); identities.set(id.toString(), name); return id; },
      get(id: DurableObjectId) { guard(); const name = identities.get(id.toString()); if (!name) deny();
        return { async fetch(input: RequestInfo | URL, init?: RequestInit) {
          guard(); const request = new Request(input, init), body = await boundedBody(request.clone().body, LIMITS.body);
          const call = await seal(raw, 'native', { scope: signed, binding, name: name!, url: request.url, method: request.method, body: await hash(body), headers: await hash(effectiveHeaders(request)), until });
          const headers = new Headers(request.headers); headers.set(SYNTHETIC_HEADER, canonical(call)); guard();
          return target!.get(id).fetch(new Request(request, { headers }));
        } };
      },
    } });
  }
  Object.defineProperty(env, 'EVENT_QUEUE', { value: raw.EVENT_QUEUE ? {
    async send(body: unknown) {
      guard(); const wire = canonical(body); if (bytes.encode(wire).length > LIMITS.body) deny();
      const digest = await hash(body), envelope = { kind: SYNTHETIC_KIND, scope: signed, digest, body };
      const signedWire = { ...envelope, signature: await signature(raw, 'queue', envelope) };
      const proof = wireProof(scope, body);
      await env.STORAGE.put('monitor-wire/' + digest + '.json', canonical({ digest, operation: scope.operation, state: 'attempted', ...proof }));
      guard(); try { await raw.EVENT_QUEUE.send(signedWire, { contentType: 'json' }); }
      catch (error) { await env.STORAGE.put('monitor-wire/' + digest + '.json', canonical({ digest, operation: scope.operation, state: 'rejected', ...proof })); throw error; }
      await env.STORAGE.put('monitor-wire/' + digest + '.json', canonical({ digest, operation: scope.operation, state: 'accepted', ...proof }));
    },
    async sendBatch(messages: Array<{ body: unknown }>) { if (messages.length > LIMITS.slots * 2) deny(); for (const message of messages) await env.EVENT_QUEUE.send(message.body); },
  } : undefined });
  void descriptor; return env;
}

/** Each native class installs this boundary before touching local state. The
 * reserved authority marker is invisible to existing owner/recovery algorithms. */
export class SyntheticObjectBoundary {
  readonly state: DurableObjectState;
  readonly env: Env;
  private active: Promise<unknown> = Promise.resolve();
  private ordinary = 0;
  private isolated = false;
  private currentOperation: string | undefined;
  private queued = 0;
  private disposing: { operation: string; work: Promise<void> } | undefined;
  private admitting = false;
  constructor(private rawState: DurableObjectState, private rawEnv: Env, private binding: NativeBinding, private reset: () => void = () => undefined) {
    // Native bindings can be non-configurable own properties. An empty proxy
    // target avoids violating JS invariants when selecting authenticated views.
    this.env = new Proxy(Object.create(null) as Env, {
      get: (_, property) => Reflect.get(syntheticEnvironment(rawEnv), property),
      has: (_, property) => property in syntheticEnvironment(rawEnv),
      ownKeys: () => Reflect.ownKeys(syntheticEnvironment(rawEnv)),
      getOwnPropertyDescriptor: (_, property) => property in syntheticEnvironment(rawEnv)
        ? { configurable: true, enumerable: true, value: Reflect.get(syntheticEnvironment(rawEnv), property) } : undefined,
    });
    const wrapStorage = (storage: DurableObjectStorage | DurableObjectTransaction): object => new Proxy(storage, { get: (target, property) => {
      const value = Reflect.get(target, property, target); if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const context = held.getStore(); if (!context || context.raw !== rawEnv) return value.apply(target, args);
        const prefix = '__monitor_data/' + context.scope.operation + '/';
        const key = (value: unknown) => { if (typeof value !== 'string' || value === MARKER || value.length > 1024) deny(); return prefix + value; };
        const guard = () => live(context.scope, context.until);
        guard();
        if (property === 'transaction') return value.call(target, (tx: DurableObjectTransaction) => (args[0] as (tx: object) => Promise<unknown>)(wrapStorage(tx)));
        if (property === 'list') {
          const options = (args[0] ?? {}) as Record<string, unknown>;
          if (options.start || options.startAfter || options.end) deny();
          return Promise.resolve(value.call(target, { ...options, prefix: key(options.prefix ?? '') })).then((map: Map<string, unknown>) => {
            guard(); return new Map([...map].map(([k, v]) => [k.slice(prefix.length), v]));
          });
        }
        if (property === 'get' || property === 'delete') {
          const many = Array.isArray(args[0]), mapped = many ? (args[0] as unknown[]).map(key) : key(args[0]);
          return Promise.resolve(value.call(target, mapped, args[1])).then((out: unknown) => {
            guard(); return out instanceof Map ? new Map([...out].map(([k, v]) => [String(k).slice(prefix.length), v])) : out;
          });
        }
        if (property === 'deleteAll') return (async () => {
          const rows = await target.list({ prefix, limit: LIMITS.keys + 1 }); if (rows.size > LIMITS.keys) deny();
          const keys = [...rows.keys()]; if (keys.length) await target.delete(keys);
        })();
        if (property === 'setAlarm') return value.call(target, Math.min(Number(args[0]), context.scope.expiresAt), args[1]);
        if (property === 'put') return (async () => {
          const additions = typeof args[0] === 'string' ? { [args[0]]: args[1] } : args[0] as Record<string, unknown>;
          const physicalValues = Object.fromEntries(Object.entries(additions).map(([k, v]) => [key(k), v]));
          const current = await target.list({ limit: LIMITS.keys + 1 }); for (const [k, v] of Object.entries(physicalValues)) current.set(k, v);
          if (current.size > LIMITS.keys || bytes.encode(canonical([...current])).length > LIMITS.bytes) deny();
          try { guard(); await value.call(target, physicalValues, typeof args[0] === 'string' ? args[2] : args[1]); guard(); }
          catch (error) {
            // Preserve uncertain LIVE writes for normal W09/W10 recovery.
            // Only original expiry permits deleting exact operation keys.
            try { if (context.scope.expiresAt <= Date.now()) await target.delete(Object.keys(physicalValues)); }
            finally { if (this.currentOperation === context.scope.operation) this.reset(); }
            throw error;
          }
        })();
        return value.apply(target, args);
      };
    } });
    const storage = wrapStorage(rawState.storage);
    this.state = new Proxy(rawState, { get: (target, property) => {
      if (property === 'storage') return storage; const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
  }
  async run<T>(request: Request | undefined, work: () => Promise<T>): Promise<T> {
    const nested = held.getStore(); if (nested?.raw === this.rawEnv) return work();
    const marker = await deadline(() => this.rawState.storage.get<Marker>(MARKER), 5000);
    if (!request?.headers.has(SYNTHETIC_HEADER) && marker === undefined && !this.isolated) {
      this.ordinary++; try { return await work(); } finally { this.ordinary--; }
    }
    // Expiry disposal must not queue behind a hung publication or owner turn.
    if (!request && marker && (await verify(this.rawEnv, 'scope', marker.call.value.scope)).expiresAt <= Date.now()) {
      const native = await verify(this.rawEnv, 'native', marker.call), scope = await verify(this.rawEnv, 'scope', native.scope);
      if (native.binding !== this.binding || this.rawState.id.toString() !== this.rawEnv[this.binding]?.idFromName(physical(scope, this.binding, native.name)).toString()) deny();
      this.isolated = true;
      await this.dispose(marker); return undefined as T;
    }
    if (this.queued >= LIMITS.slots) deny(); this.queued++;
    const next = this.active.then(() => this.runScoped(request, work), () => this.runScoped(request, work)).finally(() => { this.queued--; });
    this.active = next.catch(() => undefined); return deadline(() => next, 30000);
  }
  async initialize(work: () => Promise<void>): Promise<void> {
    try { await this.run(undefined, work); }
    catch (error) {
      // A retained authenticated native scope may be revoked at restart.
      // Do not poison construction: leave its mirrors empty and original
      // expiry armed so alarms can perform disposal without capture approval.
      // Ordinary initialization failures retain their original behavior.
      if (!this.isolated) throw error;
      await deadline(() => this.rawState.storage.transaction(async tx => {
        const marker = await tx.get<Marker>(MARKER); if (!marker) deny();
        const native = await verify(this.rawEnv, 'native', marker!.call), scope = await verify(this.rawEnv, 'scope', native.scope);
        if (native.binding !== this.binding || this.rawState.id.toString() !== this.rawEnv[this.binding]?.idFromName(physical(scope, this.binding, native.name)).toString()) deny();
        const at = scope.expiresAt > Date.now() ? scope.expiresAt : Date.now() + 1000;
        const alarm = await tx.getAlarm(); if (alarm === null || alarm > at) await tx.setAlarm(at);
      }), 5000);
    }
  }
  private async runScoped<T>(request: Request | undefined, work: () => Promise<T>): Promise<T> {
    const header = request?.headers.get(SYNTHETIC_HEADER), stored = await this.rawState.storage.get<Marker>(MARKER);
    if (!header && !stored) return work();
    let call: Signed<NativeCall>;
    try { call = header ? JSON.parse(header) : stored!.call; } catch { return deny(); }
    const native = await verify(this.rawEnv, 'native', call), scope = await verify(this.rawEnv, 'scope', native.scope);
    if (native.binding !== this.binding || this.rawState.id.toString() !== this.rawEnv[this.binding]?.idFromName(physical(scope, this.binding, native.name)).toString()) deny();
    if (this.ordinary) deny(); this.isolated = true;
    if (request && (!header || native.url !== request.url || native.method !== request.method
      || native.headers !== await hash(effectiveHeaders(request)) || native.body !== await hash(await boundedBody(request.clone().body, LIMITS.body)))) deny();
    if (scope.expiresAt <= Date.now()) {
      // An old signed request is disposal authority only for its own retained
      // generation; it cannot replace even an expired successor's marker.
      if (!stored || stored.call.value.scope.value.operation !== scope.operation) deny();
      await this.dispose({ call, terminal: true }); if (request) deny(); return undefined as T;
    }
    if (stored && (await verify(this.rawEnv, 'scope', stored.call.value.scope)).operation !== scope.operation) {
      // A fixed native slot is reused only after its previous lifetime, never
      // by overwriting another active grant or a terminal replay fence.
      if (stored.call.value.scope.value.expiresAt > Date.now()) deny();
      if (this.disposing) deny(); // A bounded unresolved disposal cannot admit a successor.
      await validateScope(this.rawEnv, native.scope);
      if (scope.bornAt < stored.call.value.scope.value.expiresAt) deny();
      // Reserve the transition only after awaited admission checks. Disposal
      // reserves the same gate before starting any raw cleanup work.
      if (this.disposing || this.admitting) deny();
      this.admitting = true; const previousOperation = this.currentOperation;
      try { this.currentOperation = scope.operation; await this.replace({ call }, stored.call.value.scope.value.operation); }
      catch (error) {
        // The transaction may have committed its marker but lost its ACK.
        // While this admission reservation is held no newer generation can
        // enter; invalidate the attempted generation's mirrors even when the
        // persisted outcome is unknown. A retry then reloads the retained
        // marker/rows, never the previous operation's in-memory state.
        if (this.currentOperation === scope.operation) this.reset();
        this.currentOperation = previousOperation; throw error;
      }
      finally { this.admitting = false; }
    }
    this.currentOperation = scope.operation;
    if (stored?.terminal && stored.call.value.scope.value.operation === scope.operation) deny();
    if (!stored) { await validateScope(this.rawEnv, native.scope); await this.rawState.storage.put(MARKER, { call }); }
    // The retained authenticated expiry is disposal authority even after
    // capture approval has been revoked. Rearm before consulting that policy.
    const alarm = await this.rawState.storage.getAlarm(); if (alarm === null || alarm > scope.expiresAt) await this.rawState.storage.setAlarm(scope.expiresAt);
    try {
      const { descriptor } = await validateScope(this.rawEnv, native.scope), until = request ? native.until : Math.min(scope.expiresAt, Date.now() + descriptor.stageMs);
      live(scope, until);
      const env = await environment(this.rawEnv, native.scope, until);
      return await held.run({ raw: this.rawEnv, env, scope, until }, work);
    } finally {
      if (scope.expiresAt <= Date.now()) await this.dispose({ call, terminal: true });
      else { const next = await this.rawState.storage.getAlarm(); if (next === null || next > scope.expiresAt) await this.rawState.storage.setAlarm(scope.expiresAt); }
    }
  }
  private async dispose(marker: Marker): Promise<void> {
    const scope = await verify(this.rawEnv, 'scope', marker.call.value.scope);
    if (scope.expiresAt > Date.now()) deny();
    if (this.admitting) { await this.disposalAlarm(scope.operation, Date.now() + 1000); deny(); }
    if (this.disposing && this.disposing.operation !== scope.operation) {
      await this.disposalAlarm(scope.operation, Date.now() + 1000); deny();
    }
    if (!this.disposing) {
      const entry = { operation: scope.operation, work: Promise.resolve() };
      entry.work = (async () => {
        await this.replace({ ...marker, terminal: true }, scope.operation);
        await clearData(this.rawEnv, scope);
        await this.disposalAlarm(scope.operation);
      })().finally(() => { if (this.disposing === entry) this.disposing = undefined; });
      this.disposing = entry;
    }
    try {
      await deadline(() => this.disposing!.work, 5000);
    } catch (error) {
      // Disposal-only retries retain the old signed scope; they never renew
      // capture authority, native grants, diagnostics or customer data.
      await this.disposalAlarm(scope.operation, Date.now() + 1000); throw error;
    }
  }
  private async disposalAlarm(operation: string, at?: number): Promise<void> {
    await this.rawState.storage.transaction(async tx => {
      const marker = await tx.get<Marker>(MARKER);
      if (!marker || marker.call.value.scope.value.operation !== operation) return;
      if (at === undefined) await tx.deleteAlarm(); else await tx.setAlarm(at);
    });
  }
  private async replace(marker: Marker, expectedOperation = marker.call.value.scope.value.operation): Promise<void> {
    let committed = false;
    try { await this.rawState.storage.transaction(async tx => {
      const rows = await tx.list({ limit: LIMITS.keys + 1 }); if (rows.size > LIMITS.keys) deny();
      const old = await tx.get<Marker>(MARKER), oldScope = old && await verify(this.rawEnv, 'scope', old.call.value.scope);
      // Delayed cleanup can only remove the operation it authenticated, never
      // a successor's native namespace or replay fence.
      if (!oldScope || oldScope.operation !== expectedOperation) deny();
      if (oldScope.operation !== marker.call.value.scope.value.operation && oldScope.expiresAt > Date.now()) deny();
      if (oldScope.operation !== marker.call.value.scope.value.operation && marker.call.value.scope.value.expiresAt <= Date.now()) deny();
      const prefix = '__monitor_data/' + (oldScope?.operation ?? marker.call.value.scope.value.operation) + '/';
      const keys = [...rows.keys()].filter(key => key.startsWith(prefix)); if (keys.length) await tx.delete(keys);
      await tx.put(MARKER, marker);
    }); committed = true; } finally {
      if (committed && (!this.currentOperation || this.currentOperation === marker.call.value.scope.value.operation)) this.reset();
    }
  }
}

export interface SyntheticResult { state: 'held' | 'pending' | 'complete' | 'failed'; decision: boolean; event: boolean; producer: boolean; consumer: boolean; ledger: boolean; learning: boolean; dlq: boolean; decisionMs: number; eventMs: number; latencyExceeded?: boolean; failedStage?: 'admission' | 'consent' | 'decision' | 'event' | 'observation'; responseStatus?: number; responseFailure?: 'boundary' | 'request' }
const initial = (): SyntheticResult => ({ state: 'held', decision: false, event: false, producer: false, consumer: false, ledger: false, learning: false, dlq: false, decisionMs: 0, eventMs: 0 });
interface Control { scope: Signed<Scope>; result: SyntheticResult; phase: 'preparing' | 'started' | 'cleaning' | 'closed'; cleanupUntil?: number }
async function clearData(raw: Env, scope: Scope) {
  // Cleanup is immutable-operation scoped. A delayed delete can never target
  // a successor's keys even after the conditional cleanup lease has elapsed.
  const prefix = dataPrefix(scope);
  const objects = await raw.STORAGE.list({ prefix, limit: LIMITS.keys + 1 }); if (objects.truncated || objects.objects.length > LIMITS.keys) deny();
  if (objects.objects.length) await raw.STORAGE.delete(objects.objects.map(o => o.key));
  for (const binding of ['CACHE', 'SESSIONS'] as const) { const keys = await raw[binding].list({ prefix, limit: LIMITS.keys + 1 });
    if (!keys.list_complete || keys.keys.length > LIMITS.keys) deny(); for (const key of keys.keys) await raw[binding].delete(key.name); }
  const debtPrefix = `${base(scope)}debt/${scope.operation}/`, debts = await raw.STORAGE.list({ prefix: debtPrefix, limit: LIMITS.keys + 1 });
  if (debts.truncated || debts.objects.length > LIMITS.keys) deny();
  let pending = false;
  for (const object of debts.objects) {
    const debt = await (await raw.STORAGE.get(object.key))?.json<{ scope: Signed<Scope>; binding: 'CACHE' | 'SESSIONS' | 'STORAGE'; key: string; phase: string }>();
    if (!debt) continue;
    const authority = await verify(raw, 'scope', debt.scope);
    if (authority.operation !== scope.operation || authority.tenant !== scope.tenant || authority.host !== scope.host
      || !['CACHE', 'SESSIONS', 'STORAGE'].includes(debt.binding)
      || object.key !== debtPrefix + await hash([debt.binding, debt.key]) + '.json') deny();
    await raw[debt.binding].delete(scopedKey(scope, debt.key));
    if (debt.phase === 'settled') await raw.STORAGE.delete(object.key);
    else pending = true;
  }
  if (pending) deny(); // Unresolved external effects cannot authorize a new operation.
}
async function stage<T>(scope: Scope, descriptor: SyntheticConfiguration, run: (until: number) => Promise<T>): Promise<T> {
  const until = Math.min(scope.expiresAt, Date.now() + descriptor.stageMs); let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([run(until), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Synthetic stage deadline')), Math.max(1, until - Date.now())); })]); }
  finally { if (timer) clearTimeout(timer); }
}
async function deadline<T>(run: () => Promise<T>, duration: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([run(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new SyntheticUnavailable()), duration); })]); }
  finally { if (timer) clearTimeout(timer); }
}
/** Polls an existing operation before allocating another. The fixed tenant/host
 * control key and fixed native pools cap residency; no per-run DO identities. */
export async function runSynthetic(raw: Env, tenant: string, host: Host): Promise<SyntheticResult> {
  let duration = 5000;
  try { const descriptor = connectorConfiguration(raw, tenant).telemetry?.synthetic;
    if (descriptor) duration = Math.min(descriptor.lifetimeMs, descriptor.stageMs * 4 + 5000, 125000); } catch { /* bounded refusal */ }
  let active = true; const until = Date.now() + duration;
  const guard = () => { if (!active || Date.now() >= until) deny(); };
  try { return await deadline(() => executeSynthetic(raw, tenant, host, until, guard), duration); }
  catch { return { ...initial(), state: 'failed', failedStage: 'admission' }; }
  finally { active = false; }
}
async function executeSynthetic(raw: Env, tenant: string, host: Host, runUntil: number, guard: () => void): Promise<SyntheticResult> {
  const result = initial(); let signed: Signed<Scope> | undefined, claimEtag: string | undefined;
  let currentStage: SyntheticResult['failedStage'] = 'admission';
  try {
    const now = Date.now();
    const oldObject = await raw.STORAGE.get(controlKey(tenant, host)), old = oldObject ? await oldObject.json<Control>() : null;
    guard();
    let expected = oldObject?.etag;
    if (old) {
      const oldScope = await verify(raw, 'scope', old.scope); if (oldScope.tenant !== tenant || oldScope.host !== host) deny();
      if (oldScope.expiresAt > now) {
        if (old.phase !== 'started') return result;
        const approval = await policy(raw, tenant, now);
        guard();
        signed = old.scope; Object.assign(result, old.result);
        const observed = { ...result };
        await stage(oldScope, approval.descriptor, async until => {
          const env = await environment(raw, signed!, Math.min(runUntil, until));
          await observe(env, signed!.value, observed); live(oldScope, until); guard();
        });
        guard(); Object.assign(result, observed); return result;
      }
      // A conditional cleanup claim fences a new allocation. Its bounded retry
      // lease is necessary coordination, not renewal of the expired data.
      if (old.phase !== 'closed') {
        if (old.phase === 'cleaning' && (old.cleanupUntil ?? 0) > now) return result;
        guard(); const cleaning = await raw.STORAGE.put(controlKey(tenant, host), canonical({ ...old, phase: 'cleaning', cleanupUntil: now + 30000 }), { onlyIf: { etagMatches: expected! } });
        if (!cleaning) return result;
        guard(); await clearData(raw, oldScope); guard();
        const closed = await raw.STORAGE.put(controlKey(tenant, host), canonical({ scope: old.scope, result: old.result, phase: 'closed' }), { onlyIf: { etagMatches: cleaning.etag } });
        if (!closed) return result; expected = closed.etag;
      }
    }
    const approval = await policy(raw, tenant, now);
    guard();
    const publication = await pinPublication(raw, tenant), slots = (await readPinnedPublication(raw, SLOTS_KIND, tenant, publication)).value.pages.home?.filter(s => !s.offLimits).map(s => s.slot) ?? [];
    const learn = (await readPinnedPublication(raw, LEARN_KIND, tenant, publication)).value;
    if (!slots.length || slots.length > LIMITS.slots || new Set(slots).size !== slots.length || raw.LEDGER_RECOVERY_ENABLED !== 'true') deny();
    recoveryConfiguration(raw);
    const operation = crypto.randomUUID(); let subject: string | undefined;
    for (let index = 0; index < 256; index++) { const candidate = `vis-00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
      if (armFor(candidate, { ...learn.holdout, salt: learn.holdout.salt || tenant }) === 'personalized') { subject = candidate; break; } }
    if (!subject) deny();
    const scope: Scope = { version: 1, tenant, host, operation, bornAt: now,
      expiresAt: Math.min(now + approval.descriptor.lifetimeMs, ...Object.values(approval.retention).map(s => s.expiresAt)),
      configuration: publication.digest, policy: approval.digest, subject: subject!, sessionId: `s-${operation}`, slots, retention: approval.retention };
    signed = await seal(raw, 'scope', scope);
    guard();
    const claim = await raw.STORAGE.put(controlKey(tenant, host), canonical({ scope: signed, result, phase: 'preparing' }),
      { onlyIf: expected ? { etagMatches: expected } : new Headers({ 'If-None-Match': '*' }) });
    if (!claim) return initial();
    guard();
    claimEtag = claim.etag;
    const principal = await issueSessionCapability(raw, { tenant, subject: scope.subject, sessionId: scope.sessionId, kind: 'anonymous' },
      Math.floor(now / 1000), Math.max(1, Math.floor(scope.expiresAt / 1000) - Math.floor(now / 1000)));
    const request = async (path: string, body?: unknown) => stage(scope, approval.descriptor, async until => {
      guard(); const env = await environment(raw, signed!, Math.min(until, runUntil)), headers = { 'X-Tenant': tenant, 'X-Shopper-Session': principal.capability, 'Content-Type': 'application/json' };
      const incoming = new Request('https://monitor.internal' + path, { method: body === undefined ? 'GET' : 'POST', headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      Object.defineProperty(incoming, 'cf', { value: { country: 'US', regionCode: 'NY' } });
      guard(); const response = await forwardShopperRequest(env, incoming, principal as SessionCapability); guard();
      if (!response.ok) { result.responseStatus = response.status; result.responseFailure = response.headers.get('X-Monitor-Refusal') === 'boundary' ? 'boundary' : 'request'; deny(); } return response.json<{ ok?: boolean; success?: boolean; dropped?: unknown;
        render?: { version: number; eventId: string; decisionId: string; pageInstance: string; status: string };
        decisions?: Array<{ contentId: string; slot: string; order: number; decisionId?: string; renderOffer?: string }>;
        records?: Array<{ arm: string; item_id: string; slot: string; decision_id: string }>; sources?: { state?: string; consent?: { personalized?: boolean } } }>();
    });
    currentStage = 'consent';
    await request('/realtime/session/preferences', { trackingConsent: true, personalizationEnabled: true,
      choice: { id: operation, expectedRevision: null, grantId: principal.grantId, iat: principal.iat, exp: principal.exp } });
    currentStage = 'decision'; let started = Date.now();
    const decision = await request(`/v1/${tenant}/decisions/snapshot`, { page: 'home', pageInstance: operation });
    result.decisionMs = Date.now() - started;
    result.decision = decision.ok === true && Array.isArray(decision.records) && decision.records.length > 0
      && decision.records.every((r: { arm?: string }) => r.arm === 'personalized') && decision.sources?.state === host && decision.sources?.consent?.personalized === true;
    if (!result.decision || decision.records!.length > LIMITS.slots) deny();
    for (const [index, piece] of (decision.decisions ?? []).entries()) {
      if (!piece.renderOffer) continue;
      const eventId = `${operation}-render-${index}`;
      const rendered = await request('/realtime/action', { type: 'content_impression', source: 'internal-monitor', userId: scope.subject,
        sessionId: scope.sessionId, eventId, timestamp: Date.now(), data: { contentId: piece.contentId, slot: piece.slot,
          position: piece.order, page: 'home', pageInstance: operation, decisionId: piece.decisionId, renderOffer: piece.renderOffer } });
      if (rendered.render?.version !== 1 || rendered.render.status !== 'durable' || rendered.render.eventId !== eventId
        || rendered.render.decisionId !== piece.decisionId || rendered.render.pageInstance !== operation) deny();
    }
    currentStage = 'event'; const first = decision.records![0]; started = Date.now();
    const event = await request('/realtime/action', { type: 'content_click', source: 'internal-monitor', userId: scope.subject, sessionId: scope.sessionId,
      eventId: operation, timestamp: Date.now(), data: { contentId: first.item_id, slot: first.slot, decisionId: first.decision_id } });
    result.eventMs = Date.now() - started; result.event = event.success === true && !event.dropped;
    result.latencyExceeded = result.decisionMs > approval.descriptor.decisionMs || result.eventMs > approval.descriptor.eventMs;
    currentStage = 'observation'; const observed = { ...result };
    await stage(scope, approval.descriptor, async until => {
      guard(); const env = await environment(raw, signed!, Math.min(until, runUntil));
      do { await observe(env, scope, observed); if (observed.dlq || !observed.event || observed.producer && observed.consumer && observed.ledger && observed.learning || Date.now() + 100 >= until) break;
        await new Promise(resolve => setTimeout(resolve, 100)); } while (Date.now() < until);
      live(scope, until); guard();
    });
    guard(); Object.assign(result, observed);
    guard(); if (!await raw.STORAGE.put(controlKey(tenant, host), canonical({ scope: signed, result, phase: 'started' }), { onlyIf: { etagMatches: claim.etag } })) deny(); guard(); return result;
  } catch {
    const failed: SyntheticResult = { ...result, state: signed ? 'failed' : 'held', failedStage: currentStage };
    if (signed && claimEtag) try { guard(); await raw.STORAGE.put(controlKey(tenant, host), canonical({ scope: signed, result: failed, phase: 'started' }), { onlyIf: { etagMatches: claimEtag } }); } catch { /* returned failure remains visible */ }
    return failed;
  }
}
async function observe(env: Env, scope: Scope, result: SyntheticResult) {
  const wires = await env.STORAGE.list({ prefix: 'monitor-wire/', limit: LIMITS.slots * 3 + 4 });
  if (wires.truncated || wires.objects.length > LIMITS.slots * 3 + 3) deny();
  result.producer = wires.objects.length >= 2; result.consumer = result.producer; result.ledger = result.producer; result.dlq = false;
  const decisions: WireRow[] = [], outcomes: WireRow[] = [];
  for (const object of wires.objects) {
    const wire = await (await env.STORAGE.get(object.key))?.json<{ operation: string; state: string; digest: string; kind: 'decision' | 'outcome' | 'behavior'; rows: WireRow[] }>();
    if (!wire || wire.operation !== scope.operation) deny();
    result.producer &&= wire.state === 'accepted';
    if (wire.kind !== 'behavior') (wire.kind === 'decision' ? decisions : outcomes).push(...wire.rows);
    const witness = await (await env.STORAGE.get('monitor-consumer/' + wire.digest + '.json'))?.json<{ operation: string; digest: string; ledger: boolean }>();
    result.consumer &&= witness?.operation === scope.operation && witness.digest === wire.digest;
    result.ledger &&= witness?.ledger === true;
    result.dlq ||= !!await env.STORAGE.head('monitor-dlq/' + wire.digest + '.json');
  }
  const unique = new Map(decisions.map(row => [row.id, row]));
  const outcome = outcomes[0], decision = outcome && unique.get(outcome.decision ?? '');
  const correlated = unique.size === decisions.length && decisions.length > 0 && outcomes.length === 1 && decision?.item === outcome.item && decision?.slot === outcome.slot;
  result.producer &&= !!correlated; result.consumer &&= !!correlated; result.ledger &&= !!correlated;
  result.learning = !!correlated;
  for (const slot of scope.slots) {
    const effects = decisions.filter(row => row.slot === slot).map(row => ({ kind: 'exposures', decision: row.id, item: row.item }));
    if (correlated && outcome.slot === slot) effects.push({ kind: 'credits', decision: outcome.decision!, item: outcome.item, outcome: outcome.id } as typeof effects[number]);
    const response = await env.LEARN_STATS!.get(env.LEARN_STATS!.idFromName(`${scope.tenant}:${scope.tenant}:${slot}`)).fetch('https://learn/monitor-effects', { method: 'POST', body: canonical({ effects }) });
    const body = await response.json<{ complete?: boolean }>(); result.learning &&= response.ok && body.complete === true;
  }
  result.state = result.latencyExceeded ? 'failed' : result.decision && result.event && result.producer && result.consumer && result.ledger && result.learning && !result.dlq ? 'complete'
    : result.dlq || !result.decision || !result.event ? 'failed' : 'pending';
}
/** Returns false for unknown/forged envelopes so ordinary W09 refusal and DLQ
 * quarantine retain their authority. Only this actual consumer writes witness. */
export async function consumeSynthetic(raw: Env, queue: string, body: unknown): Promise<boolean> {
  if (!body || typeof body !== 'object' || (body as { kind?: unknown }).kind !== SYNTHETIC_KIND) return false;
  const until = Date.now() + 30000;
  return deadline(() => consumeAuthenticated(raw, queue, body, until), 30000);
}
async function consumeAuthenticated(raw: Env, queue: string, body: unknown, until: number): Promise<boolean> {
  const envelope = body as { kind: string; scope: Signed<Scope>; digest: string; body: unknown; signature: string };
  let authenticated = false;
  try {
    const { signature: supplied, ...value } = envelope;
    if (await signature(raw, 'queue', value) !== supplied || await hash(envelope.body) !== envelope.digest) return false;
    authenticated = true;
    const retained = await verify(raw, 'scope', envelope.scope);
    // Discard an authenticated expired synthetic delivery without renewing
    // capture or copying its body into an ordinary DLQ/quarantine namespace.
    if (Number.isSafeInteger(retained.expiresAt) && retained.expiresAt <= Date.now()) return true;
    const { scope, descriptor } = await validateScope(raw, envelope.scope), config = recoveryConfiguration(raw);
    wireProof(scope, envelope.body);
    if (!config || (queue !== config.sourceQueue && queue !== config.deadLetterQueue)) return false;
    return stage(scope, descriptor, async stageUntil => {
      const stop = Math.min(until, stageUntil), env = await environment(raw, envelope.scope, stop); live(scope, stop);
      if (queue === config.deadLetterQueue) {
        await env.STORAGE.put('monitor-dlq/' + envelope.digest + '.json', canonical({ operation: scope.operation, digest: envelope.digest, failed: true })); live(scope, stop); return true;
      }
      const outcome = await consumeLedger(env, [envelope.body]); live(scope, stop);
      if (outcome.dispositions?.[0] !== 'ack' || !outcome.ok || outcome.suppressed || outcome.skipped) deny();
      await env.STORAGE.put('monitor-consumer/' + envelope.digest + '.json', canonical({ operation: scope.operation, digest: envelope.digest, ledger: true })); live(scope, stop);
      return true;
    });
  } catch (error) { if (authenticated) throw error; return false; }
}
interface WireRow { id: string; item: string; slot: string; decision?: string }
function wireProof(scope: Scope, body: unknown): { kind: 'decision' | 'outcome' | 'behavior'; rows: WireRow[] } {
  const value = body as { kind?: string; type?: string; record?: Record<string, unknown>; records?: Array<Record<string, unknown>> };
  if (!value || value.kind !== 'ledger' || !['decisions', 'outcome', 'behavior'].includes(value.type ?? '')) deny();
  if (value.type === 'behavior') {
    const row = value.record;
    const render = row?.event === 'content_impression' && typeof row.event_id === 'string'
      && Array.from({ length: LIMITS.slots }, (_, index) => `${scope.operation}-render-${index}`).includes(row.event_id);
    if (!row || row.tenant !== scope.tenant || row.brand !== scope.tenant || row.visitor_id !== scope.subject
      || row.session_id !== scope.sessionId || (!render && (row.event_id !== scope.operation || row.event !== 'content_click')) || row.source !== 'internal-monitor') deny();
    return { kind: 'behavior', rows: [] };
  }
  const rows = value.type === 'decisions' ? value.records : [value.record];
  if (!Array.isArray(rows) || !rows.length || rows.length > LIMITS.slots || rows.some(row => !row || row.tenant !== scope.tenant || row.brand !== scope.tenant || row.visitor_id !== scope.subject
    || row.session_id !== scope.sessionId || typeof row.slot !== 'string' || !scope.slots.includes(row.slot) || typeof row.item_id !== 'string'
    || (value.type === 'outcome' && (row.event_id !== scope.operation || row.type !== 'click' || typeof row.decision_id !== 'string')))) deny();
  return { kind: value.type === 'decisions' ? 'decision' : 'outcome', rows: rows!.map(row => ({ id: String(row!.decision_id && value.type === 'decisions' ? row!.decision_id : row!.outcome_id),
    item: row!.item_id as string, slot: row!.slot as string, ...(value.type === 'outcome' ? { decision: row!.decision_id as string } : {}) })) };
}
