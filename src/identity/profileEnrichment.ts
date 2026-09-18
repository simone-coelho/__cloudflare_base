// Typed source snapshots are qualification inputs, never behavioral scores.
import { z } from 'zod';

const key = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).refine(v => !['__proto__', 'prototype', 'constructor'].includes(v));
const meaning = z.string().trim().min(1).max(512);
const text = z.string().max(256);
const field = z.discriminatedUnion('type', [
  z.object({ type: z.literal('string'), meaning, value: text }).strict(),
  z.object({ type: z.literal('number'), meaning, value: z.number().finite() }).strict(),
  z.object({ type: z.literal('boolean'), meaning, value: z.boolean() }).strict(),
  z.object({ type: z.literal('string-set'), meaning, value: z.array(text).max(32).transform(v => [...new Set(v)].sort()) }).strict(),
]);
const boundedMap = <T extends z.ZodType>(value: T) => z.record(key, value).refine(v => Object.keys(v).length <= 32, 'at most32 entries');
const snapshotSchema = z.object({ at: z.number().int().nonnegative().refine(Number.isSafeInteger).refine(v => Number.isFinite(new Date(v).getTime())),
  fields: boundedMap(field), audiences: boundedMap(meaning),
}).strict();
export const profileEnrichmentSchema = z.object({ version: z.literal(1), sources: z.record(key, snapshotSchema) }).strict()
  .refine(v => Object.keys(v.sources).length <= 8, 'at most8 sources')
  .refine(v => new TextEncoder().encode(JSON.stringify(v)).byteLength <= 64 * 1024, 'enrichment exceeds64KiB');
export type ProfileEnrichment = z.infer<typeof profileEnrichmentSchema>;
export const importTimeSchema = z.union([z.number().finite(), z.string().min(4)]).transform((v, ctx) => {
  const ms = typeof v === 'number' ? (v < 1e11 ? v * 1000 : v) : Date.parse(v);
  if (!Number.isSafeInteger(ms) || ms < 0 || !Number.isFinite(new Date(ms).getTime())) {
    ctx.addIssue({ code: 'custom', message: 'unparseable time' }); return z.NEVER;
  }
  return ms;
});
export const profileRowSchema = z.object({
  kind: z.literal('profile'), version: z.literal(1), source: key, at: importTimeSchema,
  accountId: z.string().trim().min(1).max(200).optional(),
  shopperId: z.string().trim().min(1).max(64).optional(),
  visitorId: z.string().trim().min(1).max(200).optional(),
  fields: boundedMap(field), audiences: boundedMap(meaning),
}).strict().refine(v => v.accountId || v.shopperId || v.visitorId, 'a row needs accountId, shopperId or visitorId');
export type ProfileRow = z.infer<typeof profileRowSchema>;
export type ProfileSnapshotRow = Pick<ProfileRow, 'kind' | 'version' | 'source' | 'at' | 'fields' | 'audiences'>;
export type ImportOutcome = { index: number; applied: true } | { index: number; applied: false; reason: 'stale_profile' | 'replayed_profile' };

function canonical<T>(value: T): T {
  if (Array.isArray(value)) return value.map(v => canonical(v)) as T;
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)])) as T;
  return value;
}
export function readEnrichment(value: unknown): ProfileEnrichment | undefined {
  const plain = (v: unknown): void => {
    if (v === null || typeof v !== 'object') return;
    if (!Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v))) throw new Error('Invalid enrichment object');
    for (const [name, child] of Object.entries(v)) {
      if (['__proto__', 'prototype', 'constructor'].includes(name)) throw new Error('Invalid enrichment key');
      plain(child);
    }
  };
  plain(value);
  return value === undefined ? undefined : canonical(profileEnrichmentSchema.parse(value));
}
export function applyProfileSnapshot(current: unknown, row: ProfileSnapshotRow, now: number): { state: ProfileEnrichment; reason?: 'stale_profile' | 'replayed_profile' } {
  if (row.at > now) throw new Error('Profile snapshot is in the future');
  const before = readEnrichment(current) ?? { version: 1 as const, sources: {} };
  // Validate the normalized internal row without interpreting milliseconds a second time.
  key.parse(row.source);
  if (row.kind !== 'profile' || row.version !== 1) throw new Error('Invalid profile version');
  const snapshot = canonical(snapshotSchema.parse({ at: row.at, fields: row.fields, audiences: row.audiences }));
  const old = Object.hasOwn(before.sources, row.source) ? before.sources[row.source] : undefined;
  if (old && old.at > snapshot.at) return { state: before, reason: 'stale_profile' };
  if (old && old.at === snapshot.at) {
    if (JSON.stringify(old) !== JSON.stringify(snapshot)) throw new Error('Conflicting profile snapshot');
    return { state: before, reason: 'replayed_profile' };
  }
  return { state: readEnrichment({ version: 1, sources: { ...before.sources, [row.source]: snapshot } })! };
}
export function mergeEnrichment(base: unknown, from: unknown): ProfileEnrichment | undefined {
  let result = readEnrichment(base);
  const source = readEnrichment(from);
  if (!source) return result;
  for (const [name, snapshot] of Object.entries(source.sources)) {
    result = applyProfileSnapshot(result, { kind: 'profile', version: 1, source: name, ...snapshot }, Number.MAX_SAFE_INTEGER).state;
  }
  return result;
}
export function enrichmentInputs(value: unknown): { attributes: Record<string, string | number | boolean | string[]>; audiences: string[] } {
  const state = readEnrichment(value);
  const attributes: Record<string, string | number | boolean | string[]> = {};
  const audiences: string[] = [];
  for (const [source, snapshot] of Object.entries(state?.sources ?? {})) {
    for (const [name, entry] of Object.entries(snapshot.fields)) attributes[`external.${source}.${name}`] = entry.value;
    for (const name of Object.keys(snapshot.audiences)) audiences.push(`external.${source}.${name}`);
  }
  return { attributes, audiences: audiences.sort() };
}
