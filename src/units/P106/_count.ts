// src/units/P106/_count.ts
// P106's counting harness (programme `tapestry-parity-publish-cost`, amendment 13, E31): the counters the unit file reads
// while one request runs. It counts; it never times and holds no expected value.
//   · every SHA-256 the request computes, whatever computes it: WebCrypto's `crypto.subtle.digest` (the global's own
//     method replaced while installed) and `node:crypto`'s `createHash` and `hash` (through the unit file's `vi.mock`,
//     which hands the real module to `countedNodeCrypto`), each with the bytes it hashed (their text where at most 256
//     bytes) and the function and file that called it;
//   · every serialisation of a part, a product shard or an id shard by the publication's own `canonical`
//     (src/config/publication.ts `canonical`): canonical enumerates an object's keys with `Object.keys` before it sorts
//     them, so `Object.keys` is replaced while installed and a call on an object of a part's, a shard's or an id shard's
//     shape (its own keys `{pieces, product}`, `{products, shard}` with or without `packs`, `{ids, shard}`) is counted
//     where the function calling it is `canonical` in src/config/publication.ts, with the value's content and identity.
// Nothing here touches node:crypto itself (the unit file's mock hands it the real module), so the counters never count
// their own work. Synthetic, customer-neutral; tenant ids only.

export type DigestApi = 'subtle' | 'createHash' | 'hash';
/** One SHA-256 the request computed: its API, the bytes it hashed (their text where at most 256 bytes), its caller. */
export interface DigestSeen { api: DigestApi; bytes: number; text: string | null; file: string; fn: string }
export type ObjectKind = 'part' | 'shard' | 'idshard';
/** One serialisation of a part, a shard or an id shard by the publication's `canonical`: its content and the object. */
export interface SerialisedSeen { kind: ObjectKind; name: string; content: string; object: object }
export interface Counter { on: boolean; digests: DigestSeen[]; serialised: SerialisedSeen[] }
export const newCounter = (): Counter => ({ on: false, digests: [], serialised: [] });
const SHORT = 256;

/** The frame that called into a counted API: the first frame of the stack outside this file, by file (under src/) and function. */
export function callerOf(stack: string | undefined): { file: string; fn: string } {
  for (const line of (stack ?? '').split('\n').slice(1)) {
    if (line.includes('/src/units/P106/_count.ts') || !line.includes('/')) continue;
    const at = /^\s*at (?:async )?(?:(.*?) \()?(.*?):\d+:\d+\)?$/.exec(line);
    if (!at) continue;
    const path = at[2]!, under = /\/src\/(.+)$/.exec(path);
    return { file: under ? under[1]! : path.replace(/^.*node_modules\//, 'node_modules/'), fn: (at[1] ?? '<anonymous>').replace(/^.*\./, '') };
  }
  return { file: 'unknown', fn: 'unknown' };
}
const decode = (bytes: Uint8Array) => bytes.byteLength <= SHORT ? new TextDecoder().decode(bytes) : null;
const asBytes = (data: unknown, encoding?: string): Uint8Array =>
  typeof data === 'string' ? Buffer.from(data, (encoding ?? 'utf8') as BufferEncoding)
    : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data as ArrayBuffer);

/** WebCrypto's digest counted while `counter.on` (installed on the global's own SubtleCrypto); answers the uninstaller. */
export function countSubtle(counter: Counter): () => void {
  const subtle = crypto.subtle as unknown as Record<string, unknown>, original = subtle.digest as (algorithm: unknown, data: unknown) => Promise<ArrayBuffer>;
  const counted = function countedDigest(this: unknown, algorithm: unknown, data: unknown) {
    if (counter.on) {
      const at = callerOf(new Error().stack), bytes = asBytes(data);
      counter.digests.push({ api: 'subtle', bytes: bytes.byteLength, text: decode(bytes), ...at });
    }
    return original.call(crypto.subtle, algorithm, data);
  };
  Object.defineProperty(subtle, 'digest', { configurable: true, writable: true, value: counted });
  return () => { Reflect.deleteProperty(subtle, 'digest'); };
}

interface NodeHash { update(data: unknown, encoding?: string): NodeHash; digest(encoding?: string): unknown }
/** `node:crypto` with `createHash` and `hash` counted while `counter.on`; every other member is the real module's. */
export function countedNodeCrypto<T extends Record<string, unknown>>(real: T, counter: Counter): T {
  const createHash = (...args: unknown[]) => {
    const hash = (real.createHash as (...a: unknown[]) => NodeHash)(...args), sha256 = String(args[0]).toLowerCase() === 'sha256';
    if (!sha256) return hash;
    const at = counter.on ? callerOf(new Error().stack) : null, chunks: Uint8Array[] = [];
    const update = hash.update.bind(hash), digest = hash.digest.bind(hash);
    hash.update = (data: unknown, encoding?: string) => { if (at) chunks.push(asBytes(data, encoding)); update(data, encoding); return hash; };
    hash.digest = (encoding?: string) => {
      if (at) { const all = Buffer.concat(chunks); counter.digests.push({ api: 'createHash', bytes: all.byteLength, text: decode(all), ...at }); }
      return digest(encoding);
    };
    return hash;
  };
  const hash = (...args: unknown[]) => {
    if (counter.on && String(args[0]).toLowerCase() === 'sha256') {
      const bytes = asBytes(args[1]);
      counter.digests.push({ api: 'hash', bytes: bytes.byteLength, text: decode(bytes), ...callerOf(new Error().stack) });
    }
    return (real.hash as (...a: unknown[]) => unknown)(...args);
  };
  const members = { createHash, ...(typeof real.hash === 'function' ? { hash } : {}) };
  const base = (real.default ?? real) as Record<string, unknown>;
  return { ...real, ...members, default: { ...base, ...members } } as T;
}

const PART = ['pieces', 'product'], SHARD = ['products', 'shard'], PACKED_SHARD = ['packs', 'products', 'shard'], ID_SHARD = ['ids', 'shard'];
const same = (keys: string[], want: string[]) => keys.length === want.length && [...keys].sort().every((k, i) => k === want[i]);
const kindOf = (keys: string[]): ObjectKind | null => same(keys, PART) ? 'part' : same(keys, SHARD) || same(keys, PACKED_SHARD) ? 'shard' : same(keys, ID_SHARD) ? 'idshard' : null;
/** A stored value's kind by its own keys (a part, a product shard, an id shard), else null (a stage's directory, anything else). */
export const kindOfValue = (v: unknown): ObjectKind | null => v && typeof v === 'object' && !Array.isArray(v) ? kindOf(Object.keys(v)) : null;
/**
 * The publication's `canonical` counted on parts, shards and id shards while `counter.on`, through `Object.keys`
 * (replaced while installed; the counter's own content read uses the original). Answers the uninstaller.
 */
export function countSerialisations(counter: Counter): () => void {
  const original = Object.keys;
  const content = (v: unknown): string => Array.isArray(v) ? '[' + v.map(content).join(',') + ']'
    : v && typeof v === 'object' ? '{' + original(v).sort().map(k => JSON.stringify(k) + ':' + content((v as Record<string, unknown>)[k])).join(',') + '}' : JSON.stringify(v);
  const counted = function keys(o: object): string[] {
    const keys = original(o);
    if (counter.on && keys.length >= 2 && keys.length <= 3 && o && typeof o === 'object' && !Array.isArray(o)) {
      const kind = kindOf(keys);
      if (kind) {
        const at = callerOf(new Error().stack);
        if (at.fn === 'canonical' && at.file === 'config/publication.ts') {
          const v = o as Record<string, unknown>;
          counter.serialised.push({ kind, name: String(kind === 'part' ? v.product : v.shard), content: content(o), object: o });
        }
      }
    }
    return keys;
  };
  Object.keys = counted as typeof Object.keys;
  return () => { Object.keys = original; };
}

/** Run `work` with the counter on (fresh lists), then off; answers what it saw. */
export async function counted<T>(counter: Counter, work: () => Promise<T>): Promise<{ result: T; digests: DigestSeen[]; serialised: SerialisedSeen[] }> {
  counter.digests = []; counter.serialised = []; counter.on = true;
  try { const result = await work(); return { result, digests: counter.digests, serialised: counter.serialised }; }
  finally { counter.on = false; }
}
