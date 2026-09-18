// Bounded, manually resumable LOCAL erasure steps. This is not a deletion epoch,
// replay barrier, exhaustive discovery or proof of physical/external erasure.
import { z } from 'zod';
import type { Env } from '@/types/env';
import { TenantKV, isValidTenantId, tenantKey, logicalKey, type KVLike, type TenantId } from '@/tenancy/tenant';
import { shopperObject } from '@/tenancy/objects';
import { SessionManager } from '@/services/SessionManager';
import { isShopperId } from '@/identity/shopperId';
import { resetVisitorRing, tombstoneKey, writeTombstone, type R2Erasable } from '@/ledger/erasure';
import { configuredDestinations, configuredOperationalDestinations, connectorIdentity, connectorDigest } from '@/connectors/config';
import { warehouseDestinations } from '@/ledger/warehouse';

const idSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,200}$/);
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const selectorSchema = z.object({ visitorId: idSchema.optional(), shopperId: idSchema.refine(isShopperId).optional() }).strict()
  .refine(v => !!(v.visitorId || v.shopperId));
const linkSchema = z.object({ visitorId: idSchema, shopperId: idSchema.refine(isShopperId), linkedAt: z.number().finite(),
  assurance: z.enum(['site', 'signed']), source: z.enum(['login', 'signup', 'checkout', 'import', 'other']), ownSessionId: idSchema.optional() }).passthrough();
const shopperSchema = z.object({ shopperId: idSchema.refine(isShopperId), createdAt: z.number().finite(), salted: z.boolean(),
  visitors: z.array(z.object({ visitorId: idSchema.refine(id => !isShopperId(id)), linkedAt: z.number().finite(), assurance: z.enum(['site', 'signed']),
    source: z.enum(['login', 'signup', 'checkout', 'import', 'other']) })).max(50) }).passthrough();
const targetSchema = z.object({ id: idSchema, pointer: idSchema.nullable(), ownSessionId: idSchema.nullable(), linkHash: hashSchema.nullable() }).strict();
const sessionSchema = z.object({ sid: idSchema, sourceId: idSchema, userId: idSchema, forwardTo: idSchema.nullable(), identity: idSchema.nullable(),
  serialized: z.string().optional(), serializedDigest: hashSchema.optional() }).strict()
  .refine(value => value.serialized === undefined || value.serializedDigest === undefined);
const canonicalDiscoveryObject = z.object({
  version: z.literal(1), tenant: z.string().refine(isValidTenantId), subject: idSchema.refine(isShopperId),
  erasureId: z.string().uuid(), shopperHash: hashSchema.nullable(),
  pointer: idSchema.nullable(), session: sessionSchema.nullable(),
}).strict();
const canonicalShape = (value: z.infer<typeof canonicalDiscoveryObject>) => value.session === null ? value.pointer === null
  : value.session.sid === value.pointer && value.session.sourceId === value.subject && value.session.userId === value.subject
    && value.session.identity === value.subject && value.session.forwardTo === null
    && value.session.serialized === undefined && value.session.serializedDigest !== undefined;
export const canonicalErasureDiscoverySchema = canonicalDiscoveryObject.refine(canonicalShape);
export const canonicalErasureSchema = canonicalDiscoveryObject.extend({ epoch: z.string().uuid().nullable(),
  discoveryDigest: hashSchema }).refine(canonicalShape);
type CanonicalErasure = z.infer<typeof canonicalErasureSchema>;
const common = { version: z.literal(1), tenant: z.string(), selectorHash: hashSchema, actor: z.string().min(1).max(200),
  at: z.number().int().nonnegative() };
const pendingSchema = z.object({ ...common, state: z.literal('pending'), selector: selectorSchema, shopperId: idSchema.nullable(),
  shopperHash: hashSchema.nullable(), bindings: z.object({ session: z.boolean(), object: z.boolean(), ring: z.boolean() }).strict(),
  targets: z.array(targetSchema).min(1).max(52), sessions: z.array(sessionSchema).max(104), next: z.number().int().nonnegative(),
  canonical: canonicalErasureSchema.optional() }).strict();
// Never reinterpret a persisted v1 numeric cursor by inserting new steps.
const cachePendingSchema = pendingSchema.extend({ version: z.literal(2),
  bindings: pendingSchema.shape.bindings.extend({ cache: z.literal(true) }), cacheKeys: z.array(z.string().min(1)) });
const completedSchema = z.object({ ...common, version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7)]), state: z.literal('local_complete'), completedAt: z.number().int().nonnegative(),
  steps: z.number().int().nonnegative() }).strict();
type Pending = z.infer<typeof pendingSchema> | z.infer<typeof cachePendingSchema>;
const countSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const cursorSchema = z.string().min(1).max(4096).nullable();
const scanPositionSchema = z.object({ cursor: cursorSchema, lastKey: z.string().min(1).nullable() }).strict();
const discoveryPendingSchema = z.object({ ...common, version: z.literal(3), state: z.literal('pending'), base: cachePendingSchema,
  scan: scanPositionSchema.extend({ complete: z.boolean(), pages: countSchema }), nextPage: countSchema,
  cleanupCursor: cursorSchema, extraSteps: countSchema, extraTargets: countSchema,
  compacting: z.object({ nextCursor: cursorSchema, steps: countSchema, targets: countSchema.max(32) }).strict().nullable() }).strict();
const sessionDiscoverySchema = discoveryPendingSchema.extend({ version: z.literal(4),
  sessionScan: discoveryPendingSchema.shape.scan, nextSessionPage: countSchema, sessionCleanupCursor: cursorSchema,
  sessionSteps: countSchema, sessionCompacting: z.object({ nextCursor: cursorSchema, steps: countSchema.max(32) }).strict().nullable() });
const sourceIntentSchema = z.object({ version: z.literal(1), id: z.string().uuid(), tenant: z.string().refine(isValidTenantId),
  visitorId: idSchema.refine(id => !isShopperId(id)), sourceSessionId: idSchema, sourceEpoch: z.string().uuid(),
  shopperId: idSchema.refine(isShopperId), at: countSchema, assurance: z.enum(['signed', 'site']),
  source: z.enum(['login', 'signup', 'checkout', 'import', 'other']), salted: z.boolean(),
}).strict();
const sourceRegistrationSchema = z.object({ version: z.literal(1), intent: sourceIntentSchema, targetEpoch: z.string().uuid(), sequence: countSchema.refine(n => n > 0) }).strict();
export const historicalErasureCapsuleSchema = z.object({ version: z.literal(1), tenant: z.string().refine(isValidTenantId),
  subject: idSchema.refine(id => !isShopperId(id)), erasureId: z.string().uuid(), sourceEpoch: z.string().uuid(),
  cutoff: countSchema, registrationDigest: hashSchema,
  entries: z.array(z.object({ kind: z.enum(['session', 'pointer']), key: z.string().max(512), sid: idSchema, digest: hashSchema }).strict()).max(2),
}).strict().refine(value => new Set(value.entries.map(entry => entry.key)).size === value.entries.length
  && value.entries.every(entry => entry.key === tenantKey(value.tenant, entry.kind === 'session' ? 'session:' + entry.sid : 'user:' + value.subject)));
const sourceAckSchema = z.object({ version: z.literal(1), sequence: countSchema.refine(n => n > 0), erasureId: z.string().uuid(), digest: hashSchema }).strict();
const sourcePageSchema = z.object({ after: countSchema, entries: z.array(z.union([sourceRegistrationSchema, sourceAckSchema])).max(32),
  next: countSchema, complete: z.boolean(), processed: countSchema.max(32) }).strict();
const objectDiscoverySchema = sessionDiscoverySchema.extend({ version: z.literal(5), sources: z.object({ erasureId: z.string().uuid(),
  highWater: countSchema.nullable(), after: countSchema, complete: z.boolean(), completed: countSchema,
  page: sourcePageSchema.nullable(),
}).strict() });
const generationDiscoverySchema = objectDiscoverySchema.extend({ version: z.literal(6) });
const retainedDiscoverySchema = generationDiscoverySchema.extend({ version: z.literal(7),
  destinations: z.string().min(1), historicalCompleted: countSchema, historicalStep: z.number().int().min(0).max(4) });
const obligationSchema = z.object({ id: hashSchema, kind: z.enum(['odp', 'fx', 'tracking', 'model', 'catalog', 'warehouse', 'analytics', 'monitor', 'alert', 'unverified']),
  configurationDigest: hashSchema, configuration: z.record(z.string(), z.unknown()).nullable(),
  identities: z.array(z.object({ subject: idSchema, providerId: z.string().min(1).max(200).nullable() }).strict()).max(104),
  status: z.enum(['unresolved', 'operator_attested']),
  attestation: z.object({ actor: z.string().min(1).max(200), at: countSchema,
    claim: z.enum(['operator_completed', 'provider_acknowledged', 'independently_verified']), evidence: z.string().regex(/^[A-Za-z0-9_.:/-]{1,512}$/), digest: hashSchema,
  }).strict().optional(),
}).strict();
const obligationsSchema = z.object({ version: z.literal(1), tenant: z.string().refine(isValidTenantId), selector: selectorSchema,
  selectorHash: hashSchema, at: countSchema, erasureId: z.string().uuid().nullable(), obligations: z.array(obligationSchema).min(1).max(220),
  scope: hashSchema.optional(),
}).strict();
const reconciliationIdentitySchema = z.object({ at: countSchema, erasureId: z.string().uuid().nullable(), scope: hashSchema.optional() });
export const erasureReconciliationSchema = z.union([reconciliationIdentitySchema.extend({ read: z.literal(true), cursor: z.string().min(1).max(4096).optional() }).strict(), reconciliationIdentitySchema.extend({
  obligationId: hashSchema, configurationDigest: hashSchema,
  claim: z.enum(['operator_completed', 'provider_acknowledged', 'independently_verified']),
  evidence: z.string().regex(/^[A-Za-z0-9_.:/-]{1,512}$/), digest: hashSchema,
}).strict()]);
const destinationKey = (tenant: string, selectorHash: string, at: number) => `erasures/${tenant}/jobs/${selectorHash}/${at}/destinations.json`;
async function freezeDestinations(env: Env, job: Pending, erasureId: string | null): Promise<void> {
  const key = destinationKey(job.tenant, job.selectorHash, job.at), existing = await env.STORAGE.get(key);
  if (existing) {
    tag(existing); const saved = obligationsSchema.parse(JSON.parse(await existing.text()));
    if (saved.tenant !== job.tenant || saved.at !== job.at || saved.selectorHash !== job.selectorHash || saved.erasureId !== erasureId
      || JSON.stringify(saved.selector) !== JSON.stringify(job.selector)) conflict();
    return; // Configuration removal/change never reinterprets the saved generation.
  }
  let destinations: Awaited<ReturnType<typeof configuredDestinations>> = [];
  try { destinations = await configuredDestinations(env, job.tenant, () => {}); } catch { /* retain explicit unresolved inventory */ }
  // Close old-row upload before enumerating immutable destination generations.
  // Every warehouse send checks these same barriers at its final async gate.
  // A send already in flight registered its generation before that gate, so it
  // is included by the following strongly consistent inventory read. A later
  // generation can only send valid post-cutoff rows, not escape this erasure.
  for (const target of job.targets) await writeTombstone(env.STORAGE as unknown as R2Erasable, job.tenant, target.id, job.actor, job.at);
  // Do not replace historical egress generations with today's descriptor.
  // Failure to enumerate retained warehouse mappings blocks the freeze.
  for (const historical of await warehouseDestinations(env, job.tenant)) {
    if (!destinations.some(value => value.kind === 'warehouse' && value.category === 'external.warehouse.' + historical.digest)) {
      destinations.push({ kind: 'warehouse', category: `external.warehouse.${historical.digest}`,
        configuration: { purpose: 'warehouse', tenant: job.tenant, ...historical.configuration }, identityNamespace: historical.configuration.identityNamespace });
    }
  }
  const obligations: z.infer<typeof obligationSchema>[] = [];
  try {
    for (const destination of await configuredOperationalDestinations(env, job.tenant)) {
      const configurationDigest = await connectorDigest(destination.configuration);
      obligations.push({ id: await digest(destination.kind + ':' + configurationDigest), kind: destination.kind,
        configurationDigest, configuration: destination.configuration, identities: [], status: 'unresolved' });
    }
  } catch { /* unknown historical telemetry remains explicitly unresolved */ }
  for (const destination of destinations) {
    const configurationDigest = await connectorDigest(destination.configuration);
    obligations.push({ id: await digest(destination.kind + ':' + configurationDigest), kind: destination.kind,
      configurationDigest, configuration: destination.configuration,
      identities: await Promise.all(job.targets.map(async target => ({ subject: target.id,
        providerId: destination.identityNamespace ? await connectorIdentity(job.tenant, destination.identityNamespace, target.id)
          : destination.kind === 'tracking' ? target.id : null }))), status: 'unresolved' });
  }
  const unknown = { history: 'unverified provider mappings, retired aliases, analytics/log datasets and tenantless historical D1' };
  const unknownHash = await connectorDigest(unknown);
  obligations.push({ id: unknownHash, kind: 'unverified', configurationDigest: unknownHash, configuration: unknown,
    identities: job.targets.map(target => ({ subject: target.id, providerId: null })), status: 'unresolved' });
  await save(env, key, obligationsSchema.parse({ version: 1, tenant: job.tenant, selector: job.selector,
    selectorHash: job.selectorHash, at: job.at, erasureId, obligations }), null);
}

async function freezeDestinationSubjects(env: Env, job: Pending, erasureId: string | null, ids: string[]): Promise<void> {
  const subjects = [...new Set(ids)].sort(); if (!subjects.length || subjects.length > 104 || subjects.some(id => !idSchema.safeParse(id).success)) unavailable();
  const root = destinationKey(job.tenant, job.selectorHash, job.at), object = await env.STORAGE.get(root); if (!object) unavailable(); tag(object);
  const original = obligationsSchema.parse(JSON.parse(await object.text()));
  if (original.tenant !== job.tenant || original.selectorHash !== job.selectorHash || original.at !== job.at || original.erasureId !== erasureId || original.scope) conflict();
  const scope = await digest(JSON.stringify(subjects)), key = root.slice(0, -5) + '/' + scope + '.json';
  const frozen = await env.STORAGE.get(key);
  if (frozen) {
    tag(frozen); const retained = obligationsSchema.parse(JSON.parse(await frozen.text()));
    if (retained.scope !== scope || retained.at !== original.at || retained.tenant !== original.tenant || retained.erasureId !== erasureId
      || retained.selectorHash !== original.selectorHash) conflict();
    for (const entry of retained.obligations) if (await connectorDigest(entry.configuration) !== entry.configurationDigest
      || !['analytics', 'monitor', 'alert'].includes(entry.kind) && JSON.stringify(entry.identities.map(identity => identity.subject)) !== JSON.stringify(subjects)) conflict();
    return;
  }
  // Newly discovered aliases need both their cutoff and every destination
  // generation that could have received them since the original root freeze.
  const entries = [...original.obligations];
  {
    for (const subject of subjects) await writeTombstone(env.STORAGE as unknown as R2Erasable, job.tenant, subject, job.actor, job.at);
    for (const historical of await warehouseDestinations(env, job.tenant)) {
      const configuration = { purpose: 'warehouse', tenant: job.tenant, ...historical.configuration };
      const configurationDigest = await connectorDigest(configuration), id = await digest('warehouse:' + configurationDigest);
      if (!entries.some(entry => entry.id === id)) entries.push({ id, kind: 'warehouse', configurationDigest, configuration, identities: [], status: 'unresolved' });
    }
  }
  const obligations = await Promise.all(entries.map(async entry => {
    if (await connectorDigest(entry.configuration) !== entry.configurationDigest) conflict();
    const namespace = entry.configuration?.identityNamespace;
    return { ...entry, status: 'unresolved' as const, attestation: undefined, identities: ['analytics', 'monitor', 'alert'].includes(entry.kind) ? [] : await Promise.all(subjects.map(async subject => ({ subject,
      providerId: typeof namespace === 'string' ? await connectorIdentity(job.tenant, namespace, subject) : entry.kind === 'tracking' ? subject : null }))) };
  }));
  const next = obligationsSchema.parse({ ...original, scope, obligations }), saved = await env.STORAGE.get(key);
  if (saved) {
    tag(saved); const retained = obligationsSchema.parse(JSON.parse(await saved.text()));
    if (retained.scope !== scope || retained.at !== next.at || retained.tenant !== next.tenant || retained.erasureId !== next.erasureId
      || JSON.stringify(retained.obligations.map(({ status: _s, attestation: _a, ...entry }) => entry)) !== JSON.stringify(next.obligations.map(({ status: _s, attestation: _a, ...entry }) => entry))) conflict();
  } else await save(env, key, next, null);
}

/** Existing audited operator door; a caller claim is never provider verification. */
export async function reconcileErasure(env: Env, tenant: TenantId, subject: Selector, actor: string,
  input: z.infer<typeof erasureReconciliationSchema>, now = Date.now()) {
  const selector = normalized(subject), selectorHash = await digest(JSON.stringify(selector));
  const request = erasureReconciliationSchema.parse(input), root = destinationKey(tenant, selectorHash, request.at);
  const key = request.scope ? root.slice(0, -5) + '/' + request.scope + '.json' : root;
  const object = await env.STORAGE.get(key); if (!object) unavailable();
  const etag = tag(object), saved = obligationsSchema.parse(JSON.parse(await object.text()));
  if (saved.tenant !== tenant || saved.selectorHash !== selectorHash || saved.at !== request.at || saved.erasureId !== request.erasureId
    || saved.scope !== request.scope || JSON.stringify(saved.selector) !== JSON.stringify(selector)) conflict();
  for (const entry of saved.obligations) if (await connectorDigest(entry.configuration) !== entry.configurationDigest) conflict();
  if ('read' in request) {
    const page = request.scope ? null : await env.STORAGE.list({ prefix: root.slice(0, -5) + '/', limit: 32, ...(request.cursor ? { cursor: request.cursor } : {}) });
    return { ok: true, tenant, subject: selector, at: saved.at, erasureId: saved.erasureId, complete: false as const, localComplete: false,
      status: 'pending' as const, reconciliation: { key, obligations: saved.obligations, scopes: page?.objects.map(object => object.key) ?? [],
        more: page?.truncated ?? false, cursor: page?.truncated ? page.cursor : null, providerVerified: false, historicalCoverageVerified: false } };
  }
  const entry = saved.obligations.find(value => value.id === request.obligationId);
  if (!entry || entry.configurationDigest !== request.configurationDigest) conflict();
  if (entry.attestation) {
    if (entry.attestation.actor !== actor || entry.attestation.claim !== request.claim || entry.attestation.evidence !== request.evidence
      || entry.attestation.digest !== request.digest) conflict();
  } else {
    entry.status = 'operator_attested'; entry.attestation = { actor, at: now, claim: request.claim, evidence: request.evidence, digest: request.digest };
    await save(env, key, obligationsSchema.parse(saved), etag);
  }
  return { ok: true, tenant, subject: selector, at: saved.at, erasureId: saved.erasureId, complete: false as const,
    localComplete: false, status: 'pending' as const, reconciliation: { key, obligation: entry, providerVerified: false, historicalCoverageVerified: false } };
}
const pageCommon = { ...common, ordinal: countSchema };
const discoveryPageSchema = z.object({ ...pageCommon, state: z.literal('discovered'), input: scanPositionSchema,
  output: scanPositionSchema.extend({ complete: z.boolean() }), plan: cachePendingSchema.nullable(),
  layout: z.literal('object-first-v1').optional() }).strict();
const compactPageSchema = z.object({ ...pageCommon, state: z.literal('compacted') }).strict();
const sessionPageSchema = z.object({ ...pageCommon, kind: z.literal('sessions'), state: z.literal('discovered'),
  input: scanPositionSchema, output: scanPositionSchema.extend({ complete: z.boolean() }),
  sessions: z.array(z.object({ session: sessionSchema, owner: targetSchema }).strict()).max(32), next: countSchema.max(32) }).strict();
const compactSessionPageSchema = compactPageSchema.extend({ kind: z.literal('sessions') });
type ObjectDiscovery = z.infer<typeof objectDiscoverySchema> | z.infer<typeof generationDiscoverySchema> | z.infer<typeof retainedDiscoverySchema>;
type SessionDiscovery = z.infer<typeof sessionDiscoverySchema> | ObjectDiscovery;
type DiscoveryPending = z.infer<typeof discoveryPendingSchema> | SessionDiscovery;
type DiscoveryPage = z.infer<typeof discoveryPageSchema>;
type SessionPage = z.infer<typeof sessionPageSchema>;
function unadvanced(job: ObjectDiscovery): boolean {
  return job.base.next === 0 && job.sources.highWater === null && job.sources.after === 0 && !job.sources.complete
    && job.sources.completed === 0 && job.sources.page === null
    && job.scan.cursor === null && job.scan.lastKey === null && job.scan.pages === 0 && !job.scan.complete
    && job.nextPage === 0 && job.cleanupCursor === null && job.extraSteps === 0 && job.extraTargets === 0 && job.compacting === null
    && job.sessionScan.cursor === null && job.sessionScan.lastKey === null && job.sessionScan.pages === 0 && !job.sessionScan.complete
    && job.nextSessionPage === 0 && job.sessionCleanupCursor === null && job.sessionSteps === 0 && job.sessionCompacting === null;
}
async function canonicalDiscovery(job: ObjectDiscovery) {
  const subject = job.base.shopperId, target = job.base.targets.find(target => target.id === subject);
  if (!subject || !target) conflict();
  const session = target.pointer === null ? null : job.base.sessions.find(session => session.sid === target.pointer);
  if (target.pointer !== null && !session) conflict();
  return canonicalErasureDiscoverySchema.parse({ version: 1, tenant: job.tenant, subject, erasureId: job.sources.erasureId,
    shopperHash: job.base.shopperHash, pointer: target.pointer,
    session: session ? { sid: session.sid, sourceId: subject, userId: session.userId, identity: session.identity, forwardTo: session.forwardTo,
      serializedDigest: session.serialized !== undefined ? await digest(session.serialized) : session.serializedDigest } : null });
}
async function adoptCanonical(job: ObjectDiscovery, snapshot: CanonicalErasure): Promise<z.infer<typeof cachePendingSchema>> {
  if ((job.version !== 6 && job.version !== 7) || !unadvanced(job) || job.base.canonical || snapshot.tenant !== job.tenant
    || snapshot.subject !== job.base.shopperId || snapshot.erasureId !== job.sources.erasureId
    || snapshot.discoveryDigest !== await digest(JSON.stringify(await canonicalDiscovery(job)))) conflict();
  const target = job.base.targets.find(target => target.id === snapshot.subject);
  // A changed SID/pointer or foreign alias is not a history-only publication.
  if (!target || target.pointer !== snapshot.pointer || target.ownSessionId !== null || target.linkHash !== null) conflict();
  const sessions = job.base.sessions.map(session => {
    if (session.userId !== snapshot.subject) return session;
    const witness = snapshot.session, alias = job.base.targets.find(target => target.id === session.sourceId);
    if (!witness || !alias || alias.pointer !== witness.sid || session.sid !== witness.sid
      || session.forwardTo !== witness.forwardTo || session.identity !== witness.identity) conflict();
    return { ...witness, sourceId: session.sourceId };
  });
  if (snapshot.session && !sessions.some(session => session.sid === snapshot.session!.sid)) conflict();
  return cachePendingSchema.parse({ ...job.base, shopperHash: snapshot.shopperHash, sessions, canonical: snapshot });
}
type Selector = z.infer<typeof selectorSchema>;
type Step = { kind: 'session' | 'pointer' | 'object' | 'tombstone' | 'ring' | 'cache' | 'visitor_link' | 'shopper_link'; id: string; key: string };
export const ERASURE_STEP_LIMIT = 32;
export const ERASURE_DISCOVERY_PAGE_LIMIT = 32;

export class ErasureFailure extends Error {
  constructor(readonly status: 409 | 503) { super(status === 409 ? 'Erasure target or checkpoint conflict' : 'Erasure storage or destination unavailable'); }
}
function conflict(): never { throw new ErasureFailure(409); }
function unavailable(): never { throw new ErasureFailure(503); }
async function digest(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
export const erasureRawDigest = digest;
const normalized = (s: { visitorId?: string; shopperId?: string }): Selector => selectorSchema.parse({
  ...(s.visitorId?.trim() ? { visitorId: s.visitorId.trim() } : {}), ...(s.shopperId?.trim() ? { shopperId: s.shopperId.trim() } : {}),
});
export async function erasureJobKey(tenant: string, subject: Selector): Promise<string> {
  if (!isValidTenantId(tenant)) unavailable();
  return 'erasures/' + tenant + '/jobs/' + await digest(JSON.stringify(normalized(subject))) + '.json';
}
const profileKeys = (id: string) => ['profile:' + id, 'profile:user:' + id, 'profile:anon:' + id];
function cacheOwner(targets: Pending['targets'], key: string): string | undefined {
  return targets.find(t => profileKeys(t.id).includes(key)
    || (key.startsWith('override:' + t.id + ':') && key.length > ('override:' + t.id + ':').length))?.id;
}
async function discoverCache(env: Env, tenant: TenantId, targets: Pending['targets']): Promise<string[]> {
  if (!env.CACHE) unavailable();
  const keys = new Set<string>();
  for (const { id } of targets) {
    for (const key of profileKeys(id)) keys.add(key);
    const prefix = tenantKey(tenant, 'override:' + id + ':'), cursors = new Set<string>();
    let cursor: string | undefined;
    for (;;) {
      // Inspect raw pages: TenantKV.list filters foreign keys and would hide an unsafe result.
      const page = await (env.CACHE as unknown as KVLike).list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
      if (!page || !Array.isArray(page.keys) || typeof page.list_complete !== 'boolean'
        || (page.cursor !== undefined && typeof page.cursor !== 'string')) unavailable();
      for (const item of page.keys) {
        if (!item || typeof item.name !== 'string' || !item.name.startsWith(prefix) || item.name.length <= prefix.length) unavailable();
        const key = logicalKey(tenant, item.name);
        if (key === null || tenantKey(tenant, key) !== item.name || keys.has(key)) return unavailable();
        keys.add(key);
      }
      if (page.cursor) {
        if (cursors.has(page.cursor)) unavailable();
        cursors.add(page.cursor);
      }
      if (page.list_complete) break;
      if (!page.cursor) unavailable();
      cursor = page.cursor;
    }
  }
  return [...keys].sort();
}
function steps(job: Pending): Step[] {
  const out: Step[] = job.sessions.map(s => ({ kind: 'session', id: s.sourceId, key: 'session:' + s.sid }));
  for (const t of job.targets) {
    if (job.bindings.session) out.push({ kind: 'pointer', id: t.id, key: 'user:' + t.id });
    if (job.bindings.object) out.push({ kind: 'object', id: t.id, key: t.id });
    out.push({ kind: 'tombstone', id: t.id, key: tombstoneKey(job.tenant, t.id) });
    if (job.bindings.ring) out.push({ kind: 'ring', id: t.id, key: t.id });
  }
  if (job.version === 2) for (const key of job.cacheKeys) out.push({ kind: 'cache', id: cacheOwner(job.targets, key)!, key });
  // All captured local cleanup checkpoints precede deletion of discovery links.
  for (const t of job.targets) if (t.linkHash !== null) out.push({ kind: 'visitor_link', id: t.id, key: 'identity:visitor:' + t.id });
  if (job.shopperId && job.shopperHash !== null) out.push({ kind: 'shopper_link', id: job.shopperId, key: 'identity:shopper:' + job.shopperId });
  return out;
}
// Canonical shopper cleanup and base-captured sessions run in the base plan last.
// v4/v5 also clean canonical sessions captured by an extra pointer but absent from base.
function extraSteps(job: Pending, base?: Pending, guardObjectsFirst = false): Step[] {
  const work = steps(job).filter(step => {
    if (step.id === job.shopperId) return false;
    if (step.kind !== 'session') return true;
    const session = job.sessions.find(s => 'session:' + s.sid === step.key)!;
    return session.userId !== job.shopperId || (!!base && !base.sessions.some(saved => saved.sid === session.sid));
  });
  // Guard the entire v5 extra plan before deleting adjacent copies or discovery links.
  return guardObjectsFirst ? [...work.filter(step => step.kind === 'object'), ...work.filter(step => step.kind !== 'object')] : work;
}
function generationSteps(job: Pending): Step[] {
  const work = steps(job);
  return [...work.filter(step => step.kind === 'object'), ...work.filter(step => step.kind !== 'object')];
}
function equivalentExtraPrefix(plan: Pending, base: Pending): boolean {
  const identity = (step: Step) => JSON.stringify([step.kind, step.id, step.key]);
  const legacy = extraSteps(plan, base).map(identity), guarded = extraSteps(plan, base, true).map(identity);
  if (new Set(legacy).size !== legacy.length || new Set(guarded).size !== guarded.length) return false;
  const prefix = new Set(legacy.slice(0, plan.next));
  return guarded.slice(0, plan.next).every(key => prefix.has(key));
}
async function canonicalSessionsCovered(plan: Pending, base: Pending, allowMissing = false): Promise<boolean> {
  for (const session of plan.sessions) {
    if (session.userId !== plan.shopperId) continue;
    const saved = base.sessions.find(saved => saved.sid === session.sid);
    if (saved ? !await sameSession(saved, session) : !allowMissing) return false;
  }
  return true;
}
async function raw(kv: TenantKV, key: string): Promise<string | null> {
  const value = await kv.get(key);
  if (value === null) return null;
  if (typeof value !== 'string') unavailable();
  return value as string;
}
async function link(kv: TenantKV, id: string) {
  const value = await raw(kv, 'identity:visitor:' + id);
  if (value === null) return null;
  const data = linkSchema.parse(JSON.parse(value));
  if (data.visitorId !== id) conflict();
  return { data, hash: await digest(value) };
}
async function shopper(kv: TenantKV, id: string) {
  const value = await raw(kv, 'identity:shopper:' + id);
  if (value === null) return null;
  const data = shopperSchema.parse(JSON.parse(value));
  if (data.shopperId !== id) conflict();
  return { data, hash: await digest(value) };
}
/** Called only by the held canonical owner immediately before its erasure barrier. */
export async function captureCanonicalErasure(env: Env, discovered: z.infer<typeof canonicalErasureDiscoverySchema>,
  epoch: string | null, published: { session?: string; shopper?: string }): Promise<CanonicalErasure> {
  const { tenant, subject } = discovered;
  const kv = new TenantKV(env.SESSIONS as unknown as KVLike, tenant), person = await shopper(kv, subject);
  const pointer = await raw(kv, 'user:' + subject);
  const snapshot = pointer === null ? null : await new SessionManager(env, { tenant }).readSnapshot(idSchema.parse(pointer));
  if (pointer !== discovered.pointer || (pointer !== null && (!snapshot || snapshot.data.userId !== subject || snapshot.data.identity?.shopperId !== subject
    || snapshot.data.forwardTo !== undefined))) conflict();
  // Only already-committed owner publication can supersede initial discovery.
  // Unknown raw drift retains its old witness and therefore fails exact cleanup.
  const session = snapshot && published.session === snapshot.serialized
    ? { sid: pointer, sourceId: subject, userId: subject, forwardTo: null, identity: subject, serializedDigest: await digest(snapshot.serialized) }
    : discovered.session;
  const shopperHash = person && published.shopper !== undefined && await digest(published.shopper) === person.hash
    ? person.hash : discovered.shopperHash;
  return canonicalErasureSchema.parse({ ...discovered, epoch, discoveryDigest: await digest(JSON.stringify(discovered)), shopperHash, session });
}
const exactSession = (session: Pending['sessions'][number]) => session.serialized !== undefined || session.serializedDigest !== undefined;
async function matchesRaw(session: Pending['sessions'][number], serialized: string): Promise<boolean> {
  return session.serialized !== undefined ? session.serialized === serialized
    : session.serializedDigest !== undefined && session.serializedDigest === await digest(serialized);
}
function canonicalBinding(job: Pending, erasureId?: string): void {
  const saved = job.canonical;
  if (saved && (job.tenant !== saved.tenant || job.shopperId !== saved.subject || job.shopperHash !== saved.shopperHash
    || (erasureId !== undefined && erasureId !== saved.erasureId))) unavailable();
  for (const session of job.sessions) if (session.serializedDigest !== undefined) {
    const witness = saved?.session;
    if (!witness || session.sid !== witness.sid || session.userId !== witness.userId || session.forwardTo !== witness.forwardTo
      || session.identity !== witness.identity || session.serializedDigest !== witness.serializedDigest) unavailable();
  }
}
async function discover(env: Env, tenant: TenantId, selector: Selector, selectorHash: string, actor: string, at: number): Promise<Pending> {
  if (!env.SESSIONS) unavailable(); // Identity discovery cannot be silently omitted.
  const kv = new TenantKV(env.SESSIONS as unknown as KVLike, tenant);
  const visitor = selector.visitorId && !isShopperId(selector.visitorId) ? await link(kv, selector.visitorId) : null;
  const resolved = selector.visitorId && isShopperId(selector.visitorId) ? selector.visitorId : visitor?.data.shopperId ?? null;
  if (selector.shopperId && selector.visitorId && resolved !== selector.shopperId) conflict();
  const shopperId = selector.shopperId ?? resolved;
  const person = shopperId ? await shopper(kv, shopperId) : null;
  const ids = [...new Set([...(shopperId ? [shopperId] : []), ...(person?.data.visitors.map(v => v.visitorId) ?? []),
    ...(selector.visitorId ? [selector.visitorId] : [])])];
  const { targets, sessions } = await captureTargets(env, tenant, shopperId, ids, !!env.SHOPPER_REFLEX);
  const cacheKeys = await discoverCache(env, tenant, targets);
  return cachePendingSchema.parse({ version: 2, tenant, selectorHash, actor, at, state: 'pending', selector, shopperId,
    shopperHash: person?.hash ?? null, bindings: { session: true, object: !!env.SHOPPER_REFLEX, ring: !!env.DECISION_RING, cache: true },
    targets, sessions, cacheKeys, next: 0 });
}
async function captureTargets(env: Env, tenant: TenantId, shopperId: string | null, ids: string[], exact = false) {
  const kv = new TenantKV(env.SESSIONS as unknown as KVLike, tenant);
  const targets: Pending['targets'] = [], sessions = new Map<string, Pending['sessions'][number]>();
  const sm = new SessionManager(env, { tenant });
  for (const id of ids) {
    const currentLink = isShopperId(id) ? null : await link(kv, id);
    if (currentLink && currentLink.data.shopperId !== shopperId) conflict();
    const pointer = await raw(kv, 'user:' + id);
    if (pointer !== null) idSchema.parse(pointer);
    const ownSessionId = currentLink?.data.ownSessionId ?? null;
    targets.push({ id, pointer, ownSessionId, linkHash: currentLink?.hash ?? null });
    for (const sid of [...new Set([pointer, ownSessionId].filter((v): v is string => v !== null))]) {
      const snapshot = exact ? await sm.readSnapshot(sid) : null;
      const record = exact ? snapshot?.data : await sm.readRaw(sid, true);
      if (!record) { if (exact) unavailable(); continue; }
      if (record.userId !== id && !(sid === pointer && record.userId === shopperId)) conflict();
      const captured = { sid, sourceId: id, userId: record.userId, forwardTo: record.forwardTo ?? null, identity: record.identity?.shopperId ?? null,
        ...(exact ? { serialized: snapshot!.serialized } : {}) };
      const prior = sessions.get(sid);
      if (prior && !await sameSession(prior, captured)) conflict();
      if (!prior) sessions.set(sid, captured);
    }
  }
  return { targets, sessions: [...sessions.values()] };
}

function validateJob(value: unknown, tenant: string, selector: Selector, selectorHash: string, canonicalAllowed = false) {
  const job = z.union([pendingSchema, cachePendingSchema, completedSchema]).parse(value);
  if (job.tenant !== tenant || job.selectorHash !== selectorHash) unavailable();
  if (job.state === 'pending') {
    if (!canonicalAllowed && (job.canonical !== undefined || job.sessions.some(session => session.serializedDigest !== undefined))) unavailable();
    canonicalBinding(job);
    if (JSON.stringify(job.selector) !== JSON.stringify(selector) || !job.bindings.session
      || new Set(job.targets.map(t => t.id)).size !== job.targets.length
      || new Set(job.sessions.map(s => s.sid)).size !== job.sessions.length
      || (job.shopperId !== null && !isShopperId(job.shopperId))
      || (job.shopperHash !== null && job.shopperId === null)
      || job.next > steps(job).length) unavailable();
    const ids = new Set(job.targets.map(t => t.id));
    if ((selector.visitorId && !ids.has(selector.visitorId)) || (job.shopperId && !ids.has(job.shopperId))
      || (selector.shopperId && job.shopperId !== selector.shopperId)
      || (selector.visitorId && isShopperId(selector.visitorId) && job.shopperId !== selector.visitorId)
      || job.targets.some(t => isShopperId(t.id) && (t.id !== job.shopperId || t.linkHash !== null))
      || (!job.shopperId && (job.targets.length !== 1 || job.targets[0].id !== selector.visitorId || job.targets[0].linkHash !== null))) unavailable();
    for (const s of job.sessions) {
      const t = job.targets.find(t => t.id === s.sourceId);
      if (!t || ![t.pointer, t.ownSessionId].includes(s.sid) || !ids.has(s.userId)
        || (s.userId !== t.id && !(s.sid === t.pointer && s.userId === job.shopperId))) unavailable();
    }
    if (job.version === 2) {
      const keys = new Set(job.cacheKeys);
      if (keys.size !== job.cacheKeys.length || job.cacheKeys.some((key, i) => !cacheOwner(job.targets, key)
        || (i > 0 && job.cacheKeys[i - 1] >= key))
        || job.targets.some(t => profileKeys(t.id).some(key => !keys.has(key)))) unavailable();
    }
  }
  return job;
}
function tag(object: { etag?: unknown } | null): string {
  if (!object || typeof object.etag !== 'string' || !object.etag) return unavailable();
  return object.etag;
}
async function save(env: Env, key: string, job: unknown, etag: string | null): Promise<string> {
  const onlyIf = new Headers(etag === null ? { 'If-None-Match': '*' } : { 'If-Match': JSON.stringify(etag) });
  const saved = await env.STORAGE.put(key, JSON.stringify(job), { onlyIf, httpMetadata: { contentType: 'application/json' } });
  if (saved === null) conflict();
  return tag(saved); // Missing metadata/ambiguous write never acknowledges progress.
}
async function compatible(env: Env, job: Pending, id?: string): Promise<void> {
  if (!env.SESSIONS || (job.bindings.object && !env.SHOPPER_REFLEX) || (job.bindings.ring && !env.DECISION_RING)
    || (job.version === 2 && !env.CACHE)) unavailable();
  const kv = new TenantKV(env.SESSIONS as unknown as KVLike, job.tenant);
  if (job.shopperId) {
    const current = await shopper(kv, job.shopperId);
    if (current && current.hash !== job.shopperHash) conflict();
  }
  for (const t of job.targets.filter(t => id === undefined || t.id === id)) {
    if (!isShopperId(t.id)) {
      const current = await link(kv, t.id);
      if (current && (current.hash !== t.linkHash || current.data.shopperId !== job.shopperId)) conflict();
    }
    const current = await raw(kv, 'user:' + t.id);
    if (current !== null && current !== t.pointer) conflict();
  }
}
async function authorizeSession(env: Env, tenant: string, erasureId: string, session: Pending['sessions'][number]) {
  if (!exactSession(session)) unavailable();
  const response = await shopperObject(env.SHOPPER_REFLEX, session.userId, tenant).fetch('https://shopper-reflex/identity/erase/session',
    { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Reflex-Tenant': tenant, 'X-Reflex-Subject': session.userId },
      body: JSON.stringify({ erasureId, sessionId: session.sid }) });
  if (!response.ok || (await response.json() as { ok?: unknown })?.ok !== true) unavailable();
}
export const ownerErasureEffectSchema = z.object({ job: z.union([pendingSchema, cachePendingSchema]),
  step: z.object({ kind: z.enum(['session', 'pointer', 'tombstone', 'ring', 'cache', 'visitor_link', 'shopper_link']), id: idSchema, key: z.string().min(1).max(512) }).strict(),
  erasureId: z.string().uuid(), index: z.number().int().min(0).max(2),
}).strict();
export type OwnerErasureEffect = z.infer<typeof ownerErasureEffectSchema>;
export function erasureEffectOwners(effect: OwnerErasureEffect): string[] {
  const { job, step } = effect;
  canonicalBinding(job, effect.erasureId);
  if (!isValidTenantId(job.tenant)) unavailable();
  if (!steps(job).some(candidate => candidate.kind === step.kind && candidate.id === step.id && candidate.key === step.key)) unavailable();
  const owner = job.targets.find(target => target.id === step.id);
  if (!owner) unavailable();
  if (step.kind === 'session') {
    const session = job.sessions.find(item => 'session:' + item.sid === step.key);
    if (!session || !exactSession(session)) unavailable();
    return [session.userId];
  }
  const sessions = job.sessions.filter(session => session.sid === owner.pointer || session.sid === owner.ownSessionId);
  const owners = [...new Set([step.id, ...sessions.map(session => session.userId)])];
  // Only the established browser→canonical-person relationship permits two locks.
  if (owners.length > 2 || (owners.length === 2 && (isShopperId(owners[0]) || !isShopperId(owners[1])))) unavailable();
  return owners;
}
/** Binding-only tail: caller holds every owner in the one-way browser→person chain. */
export async function executeOwnerErasure(env: Env, effect: OwnerErasureEffect): Promise<void> {
  await execute(env, effect.job, effect.step, effect.erasureId, true, true);
}
async function execute(env: Env, job: Pending, step: Step, erasureId?: string, exact = false, held = false): Promise<void> {
  if (exact && step.kind !== 'object' && !held) {
    const effect = ownerErasureEffectSchema.parse({ job, step, erasureId, index: 0 });
    const owner = erasureEffectOwners(effect)[0];
    const response = await shopperObject(env.SHOPPER_REFLEX, owner, job.tenant).fetch('https://shopper-reflex/identity/erase/effect', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Reflex-Tenant': job.tenant, 'X-Reflex-Subject': owner }, body: JSON.stringify(effect),
    });
    if (!response.ok || (await response.json() as { ok?: unknown })?.ok !== true) unavailable();
    return;
  }
  await compatible(env, job, step.id);
  const kv = new TenantKV(env.SESSIONS as unknown as KVLike, job.tenant);
  if (exact && step.kind !== 'session' && step.kind !== 'object') {
    // A completed session cursor cannot authorize later pointer/cache/link/ring
    // deletion. Shared owner state may now belong to a same- or different-SID
    // successor, including sessions from already compacted scan capsules.
    const owner = job.targets.find(target => target.id === step.id)!;
    const sessions = job.sessions.filter(session => session.sid === owner.pointer || session.sid === owner.ownSessionId);
    for (const id of held ? [] : new Set([step.id, ...sessions.map(session => session.userId)])) {
      const response = await shopperObject(env.SHOPPER_REFLEX, id, job.tenant).fetch('https://shopper-reflex/identity/erase/guard',
        { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Reflex-Tenant': job.tenant, 'X-Reflex-Subject': id },
          body: JSON.stringify({ erasureId }) });
      if (!response.ok || (await response.json() as { ok?: unknown })?.ok !== true) unavailable();
    }
    const sm = new SessionManager(env, { tenant: job.tenant });
    for (const session of sessions) {
      if (!held) await authorizeSession(env, job.tenant, erasureId!, session);
      const current = await sm.readSnapshot(session.sid);
      if (current && !await matchesRaw(session, current.serialized)) conflict();
    }
  }
  if (step.kind === 'session') {
    const target = job.sessions.find(s => 'session:' + s.sid === step.key)!;
    const sm = new SessionManager(env, { tenant: job.tenant });
    if (exact && !held) await authorizeSession(env, job.tenant, erasureId!, target);
    const snapshot = exact ? await sm.readSnapshot(target.sid) : null;
    const current = exact ? snapshot?.data : await sm.readRaw(target.sid, true);
    if (snapshot && !await matchesRaw(target, snapshot.serialized)) conflict();
    if (current && (current.userId !== target.userId || (current.forwardTo ?? null) !== target.forwardTo
      || (current.identity?.shopperId ?? null) !== target.identity)) conflict();
    if (current) await kv.delete(step.key);
  } else if (step.kind === 'object') {
    const response = await shopperObject(env.SHOPPER_REFLEX, step.id, job.tenant).fetch('https://shopper-reflex' + (erasureId ? '/identity/erase/object' : '/reset'),
      { method: 'POST', ...(erasureId ? { headers: { 'Content-Type': 'application/json', 'X-Reflex-Tenant': job.tenant, 'X-Reflex-Subject': step.id }, body: JSON.stringify({ erasureId }) } : {}) });
    const body = await response.json() as { ok?: unknown };
    if (!response.ok || body?.ok !== true) unavailable();
  } else if (step.kind === 'tombstone') {
    await writeTombstone(env.STORAGE as unknown as R2Erasable, job.tenant, step.id, job.actor, job.at);
    const { eraseQuarantineSubject } = await import('@/ledger/quarantine');
    if (!await eraseQuarantineSubject(env, job.tenant, step.id, job.at)) unavailable();
  } else if (step.kind === 'ring') {
    if (await resetVisitorRing(env, job.tenant, step.id) !== 'reset') unavailable();
  } else if (step.kind === 'cache') {
    await new TenantKV(env.CACHE as unknown as KVLike, job.tenant).delete(step.key);
  } else {
    await kv.delete(step.key);
  }
}

function validateDiscovery(value: unknown, tenant: string, selector: Selector, selectorHash: string): DiscoveryPending {
  const job = z.union([discoveryPendingSchema, sessionDiscoverySchema, objectDiscoverySchema, generationDiscoverySchema, retainedDiscoverySchema]).parse(value);
  if (job.version === 7 && (job.destinations !== destinationKey(tenant, selectorHash, job.at) || job.historicalCompleted > (job.sources.completed + 1) * 2
    || (job.historicalStep !== 0 && (!job.sources.page || job.sources.page.processed >= job.sources.page.entries.length
      || !('intent' in job.sources.page.entries[job.sources.page.processed]!))))) unavailable();
  const base = validateJob(job.base, tenant, selector, selectorHash, (job.version === 6 || job.version === 7));
  if (base.state !== 'pending' || base.version !== 2 || (job.version === 3 && !base.shopperId) || job.tenant !== tenant
    || job.selectorHash !== selectorHash || job.actor !== base.actor || job.at !== base.at
    || job.nextPage > job.scan.pages || (!job.scan.complete && (job.nextPage !== 0 || base.next !== 0 || job.compacting !== null))
    || (job.nextPage < job.scan.pages && base.next !== 0) || (job.compacting !== null && job.nextPage >= job.scan.pages)
    || (job.scan.pages === 0 && (job.scan.cursor !== null || job.scan.lastKey !== null || job.scan.complete !== (job.version !== 3 && !base.shopperId)))
    || (!job.scan.complete && job.scan.pages > 0 && job.scan.cursor === null)
    || (job.scan.complete && job.scan.cursor !== null) || (job.nextPage === 0 && job.cleanupCursor !== null)
    || (job.nextPage > 0 && job.nextPage < job.scan.pages && job.cleanupCursor === null)) unavailable();
  if (job.version !== 3) {
    const scan = job.sessionScan;
    if ((!base.shopperId && (!job.scan.complete || job.scan.pages !== 0))
      || job.nextSessionPage > scan.pages || (scan.pages === 0 && (scan.cursor !== null || scan.lastKey !== null || scan.complete))
      || (!scan.complete && scan.pages > 0 && scan.cursor === null) || (scan.complete && scan.cursor !== null)
      || (!job.scan.complete && (scan.pages !== 0 || job.nextSessionPage !== 0))
      || (!scan.complete && (job.nextSessionPage !== 0 || job.sessionCompacting !== null))
      || ((!scan.complete || job.nextSessionPage < scan.pages) && (job.nextPage !== 0 || job.compacting !== null || base.next !== 0))
      || (job.sessionCompacting !== null && job.nextSessionPage >= scan.pages)
      || (job.nextSessionPage === 0 && job.sessionCleanupCursor !== null)
      || (job.nextSessionPage > 0 && job.nextSessionPage < scan.pages && job.sessionCleanupCursor === null)) unavailable();
  }
  if (job.version === 5 || (job.version === 6 || job.version === 7)) {
    const s = job.sources, page = s.page;
    if (!base.bindings.object || (s.highWater === null && (s.after !== 0 || s.complete || s.completed !== 0 || page !== null))
      || (s.highWater !== null && (s.after > s.highWater || s.complete !== (s.after === s.highWater)))
      || s.completed !== s.after + (page?.processed ?? 0)
      || (!s.complete && (job.nextPage !== 0 || base.next !== 0 || ((job.version === 6 || job.version === 7) && (job.nextSessionPage !== 0 || job.sessionCompacting !== null))))) unavailable();
    if ((job.version === 6 || job.version === 7) && base.sessions.some(session => !exactSession(session))) unavailable();
    if (base.canonical && ((job.version !== 6 && job.version !== 7) || base.canonical.erasureId !== s.erasureId || s.highWater === null)) unavailable();
    if (page && (s.highWater === null || s.complete || page.after !== s.after || page.processed > page.entries.length
      || page.next !== (page.entries.at(-1)?.sequence ?? page.after) || page.next > s.highWater
      || page.complete !== (page.next === s.highWater) || (!page.complete && page.entries.length !== 32)
      || page.entries.some((entry, i) => entry.sequence !== page.after + i + 1 || ('intent' in entry
        && (entry.intent.tenant !== tenant || entry.intent.shopperId !== base.shopperId))))) unavailable();
  }
  return job;
}
function pageIdentity(job: DiscoveryPending, ordinal: number) {
  return { version: 1 as const, tenant: job.tenant, selectorHash: job.selectorHash, actor: job.actor, at: job.at, ordinal };
}
async function pageKey(key: string, job: DiscoveryPending, cursor: string | null): Promise<string> {
  // The cursor digest also detects cycles through empty pages without an unbounded cursor array.
  return key.slice(0, -5) + '/' + job.at + '/pages/' + await digest(JSON.stringify(cursor)) + '.json';
}
async function validatePage(value: unknown, job: DiscoveryPending, ordinal: number, inputCursor: string | null) {
  const page = z.union([discoveryPageSchema, compactPageSchema]).parse(value);
  for (const [field, expected] of Object.entries(pageIdentity(job, ordinal))) {
    if (page[field as keyof typeof page] !== expected) unavailable();
  }
  if (page.state === 'discovered') {
    if (page.layout !== undefined && job.version !== 5) unavailable();
    const prefix = tenantKey(job.tenant, 'identity:visitor:');
    const validKey = (key: string | null) => key === null || (key.startsWith(prefix)
      && idSchema.safeParse(key.slice(prefix.length)).success && !isShopperId(key.slice(prefix.length)));
    if (page.input.cursor !== inputCursor || !validKey(page.input.lastKey) || !validKey(page.output.lastKey)
      || (page.input.lastKey !== null && (page.output.lastKey === null || page.output.lastKey < page.input.lastKey))
      || (page.output.complete ? page.output.cursor !== null : page.output.cursor === null || page.output.cursor === inputCursor)) unavailable();
    if (page.plan) {
      const plan = validateJob(page.plan, job.tenant, { shopperId: job.base.shopperId! }, job.selectorHash, (job.version === 6 || job.version === 7));
      if (plan.state !== 'pending' || plan.version !== 2 || plan.actor !== job.actor || plan.at !== job.at
        || plan.shopperId !== job.base.shopperId || plan.shopperHash !== job.base.shopperHash
        || JSON.stringify(plan.bindings) !== JSON.stringify(job.base.bindings) || JSON.stringify(plan.canonical) !== JSON.stringify(job.base.canonical) || plan.targets.length < 2
        || plan.targets.length > ERASURE_DISCOVERY_PAGE_LIMIT + 1 || plan.next > extraSteps(plan, job.version !== 3 ? job.base : undefined, job.version >= 5).length
        || JSON.stringify(plan.targets.find(t => t.id === plan.shopperId)) !== JSON.stringify(job.base.targets.find(t => t.id === plan.shopperId))
        || !await canonicalSessionsCovered(plan, job.base, job.version !== 3)
        || ((job.version === 6 || job.version === 7) && plan.sessions.some(session => !exactSession(session)))
        || plan.targets.some(t => t.id !== plan.shopperId && (t.linkHash === null || job.base.targets.some(base => base.id === t.id)
          || page.output.lastKey === null || prefix + t.id > page.output.lastKey
          || (page.input.lastKey !== null && prefix + t.id <= page.input.lastKey)))) unavailable();
    }
  }
  return page;
}
async function discoverPage(env: Env, job: DiscoveryPending): Promise<DiscoveryPage> {
  await compatible(env, job.base);
  const prefix = tenantKey(job.tenant, 'identity:visitor:'), kv = new TenantKV(env.SESSIONS as unknown as KVLike, job.tenant);
  const page = await (env.SESSIONS as unknown as KVLike).list({ prefix, limit: ERASURE_DISCOVERY_PAGE_LIMIT,
    ...(job.scan.cursor === null ? {} : { cursor: job.scan.cursor }) });
  if (!page || !Array.isArray(page.keys) || page.keys.length > ERASURE_DISCOVERY_PAGE_LIMIT || typeof page.list_complete !== 'boolean'
    || (page.cursor !== undefined && (typeof page.cursor !== 'string' || !page.cursor || page.cursor.length > 4096))
    || (!page.list_complete && (!page.cursor || page.cursor === job.scan.cursor))) unavailable();
  let lastKey = job.scan.lastKey;
  const links = new Map<string, string>();
  for (const item of page.keys) {
    if (!item || typeof item.name !== 'string' || !item.name.startsWith(prefix) || (lastKey !== null && item.name <= lastKey)) unavailable();
    const id = idSchema.parse(item.name.slice(prefix.length));
    if (isShopperId(id) || logicalKey(job.tenant, item.name) !== 'identity:visitor:' + id) unavailable();
    lastKey = item.name;
    const current = await link(kv, id);
    if (!current) unavailable();
    if (current.data.shopperId === job.base.shopperId && !job.base.targets.some(t => t.id === id)) links.set(id, current.hash);
  }
  let plan: z.infer<typeof cachePendingSchema> | null = null;
  if (links.size) {
    const captured = await captureTargets(env, job.tenant, job.base.shopperId, [...links.keys()], (job.version === 6 || job.version === 7));
    if (captured.targets.some(t => t.linkHash !== links.get(t.id))) conflict();
    const canonical = job.base.targets.find(t => t.id === job.base.shopperId)!;
    plan = cachePendingSchema.parse({ ...job.base, selector: { shopperId: job.base.shopperId }, targets: [canonical, ...captured.targets],
      sessions: captured.sessions, cacheKeys: [...profileKeys(canonical.id), ...await discoverCache(env, job.tenant, captured.targets)].sort(), next: 0 });
    if (!await canonicalSessionsCovered(plan, job.base, job.version !== 3)) conflict();
  }
  return { ...pageIdentity(job, job.scan.pages), state: 'discovered', input: { cursor: job.scan.cursor, lastKey: job.scan.lastKey },
    output: { cursor: page.list_complete ? null : page.cursor!, lastKey, complete: page.list_complete }, plan };
}

async function sameSession(a: Pending['sessions'][number], b: Pending['sessions'][number]): Promise<boolean> {
  if (a.sid !== b.sid || a.userId !== b.userId || a.forwardTo !== b.forwardTo || a.identity !== b.identity) return false;
  if (a.serializedDigest !== undefined || b.serializedDigest !== undefined) {
    const left = a.serializedDigest ?? (a.serialized === undefined ? null : await digest(a.serialized));
    const right = b.serializedDigest ?? (b.serialized === undefined ? null : await digest(b.serialized));
    return left !== null && right !== null && left === right;
  }
  return a.serialized === b.serialized;
}
async function sessionPageKey(key: string, job: SessionDiscovery, cursor: string | null): Promise<string> {
  return key.slice(0, -5) + '/' + job.at + '/sessions/' + await digest(JSON.stringify(cursor)) + '.json';
}
function validateSessionPage(value: unknown, job: SessionDiscovery, ordinal: number, inputCursor: string | null) {
  const page = z.union([sessionPageSchema, compactSessionPageSchema]).parse(value);
  for (const [field, expected] of Object.entries(pageIdentity(job, ordinal))) {
    if (page[field as keyof typeof page] !== expected) unavailable();
  }
  if (page.state === 'discovered') {
    const prefix = tenantKey(job.tenant, 'session:');
    const validKey = (key: string | null) => key === null || (key.startsWith(prefix) && idSchema.safeParse(key.slice(prefix.length)).success);
    if (page.input.cursor !== inputCursor || !validKey(page.input.lastKey) || !validKey(page.output.lastKey)
      || (page.input.lastKey !== null && (page.output.lastKey === null || page.output.lastKey < page.input.lastKey))
      || (page.output.complete ? page.output.cursor !== null : page.output.cursor === null || page.output.cursor === inputCursor)
      || page.next > page.sessions.length) unavailable();
    for (const [i, { session, owner }] of page.sessions.entries()) {
      const baseOwner = job.base.targets.find(t => t.id === owner.id), key = prefix + session.sid;
      if (session.serializedDigest !== undefined || owner.id !== session.userId || session.sourceId !== owner.id || ((job.version === 6 || job.version === 7) && session.serialized === undefined)
        || (baseOwner ? JSON.stringify(baseOwner) !== JSON.stringify(owner)
          : !job.base.shopperId || isShopperId(owner.id) || owner.linkHash === null)
        || job.base.sessions.some(s => s.sid === session.sid)
        || (i > 0 && page.sessions[i - 1].session.sid >= session.sid)
        || page.output.lastKey === null || key > page.output.lastKey || (page.input.lastKey !== null && key <= page.input.lastKey)) unavailable();
    }
  }
  return page;
}
async function sessionOwnerCompatible(env: Env, job: SessionDiscovery, owner: Pending['targets'][number]) {
  await compatible(env, job.base, job.base.shopperId ?? undefined);
  const kv = new TenantKV(env.SESSIONS as unknown as KVLike, job.tenant);
  const current = isShopperId(owner.id) ? null : await link(kv, owner.id);
  // Nothing in session-only cleanup removes owner links or pointers.
  if ((current?.hash ?? null) !== owner.linkHash || (current && current.data.shopperId !== job.base.shopperId)
    || await raw(kv, 'user:' + owner.id) !== owner.pointer) conflict();
}
async function discoverSessionPage(env: Env, job: SessionDiscovery): Promise<SessionPage> {
  await compatible(env, job.base);
  const prefix = tenantKey(job.tenant, 'session:'), kv = new TenantKV(env.SESSIONS as unknown as KVLike, job.tenant);
  const page = await (env.SESSIONS as unknown as KVLike).list({ prefix, limit: ERASURE_DISCOVERY_PAGE_LIMIT,
    ...(job.sessionScan.cursor === null ? {} : { cursor: job.sessionScan.cursor }) });
  if (!page || !Array.isArray(page.keys) || page.keys.length > ERASURE_DISCOVERY_PAGE_LIMIT || typeof page.list_complete !== 'boolean'
    || (page.cursor !== undefined && (typeof page.cursor !== 'string' || !page.cursor || page.cursor.length > 4096))
    || (!page.list_complete && (!page.cursor || page.cursor === job.sessionScan.cursor))) unavailable();
  let lastKey = job.sessionScan.lastKey;
  const sessions: SessionPage['sessions'] = [], sm = new SessionManager(env, { tenant: job.tenant });
  for (const item of page.keys) {
    if (!item || typeof item.name !== 'string' || !item.name.startsWith(prefix) || (lastKey !== null && item.name <= lastKey)) unavailable();
    const sid = idSchema.parse(item.name.slice(prefix.length));
    if (logicalKey(job.tenant, item.name) !== 'session:' + sid || tenantKey(job.tenant, 'session:' + sid) !== item.name) unavailable();
    lastKey = item.name;
    const snapshot = (job.version === 6 || job.version === 7) ? await sm.readSnapshot(sid) : null;
    const record = (job.version === 6 || job.version === 7) ? snapshot?.data : await sm.readRaw(sid, true);
    if (!record) unavailable();
    const session = sessionSchema.parse({ sid, sourceId: record.userId, userId: record.userId,
      forwardTo: record.forwardTo ?? null, identity: record.identity?.shopperId ?? null,
      ...(snapshot ? { serialized: snapshot.serialized } : {}) });
    let owner = job.base.targets.find(t => t.id === record.userId);
    if (!owner && job.base.shopperId && !isShopperId(record.userId)) {
      const current = await link(kv, record.userId);
      if (current?.data.shopperId === job.base.shopperId) {
        const pointer = await raw(kv, 'user:' + record.userId);
        owner = targetSchema.parse({ id: record.userId, pointer, ownSessionId: current.data.ownSessionId ?? null, linkHash: current.hash });
      }
    }
    if (!owner) continue; // Neither forwarding nor former/anonymous identity establishes ownership.
    await sessionOwnerCompatible(env, job, owner);
    const baseSession = job.base.sessions.find(s => s.sid === sid);
    if (baseSession) { if (!await sameSession(session, baseSession)) conflict(); continue; }
    sessions.push({ session, owner });
  }
  return { ...pageIdentity(job, job.sessionScan.pages), kind: 'sessions', state: 'discovered',
    input: { cursor: job.sessionScan.cursor, lastKey: job.sessionScan.lastKey },
    output: { cursor: page.list_complete ? null : page.cursor!, lastKey, complete: page.list_complete }, sessions, next: 0 };
}
async function executeSession(env: Env, job: SessionDiscovery, target: SessionPage['sessions'][number]) {
  await sessionOwnerCompatible(env, job, target.owner);
  if ((job.version === 6 || job.version === 7)) {
    // Exact source cleanup already ran. A remaining generic owner must establish
    // its barrier before its session check; old receipts cannot add new SIDs.
    const response = await shopperObject(env.SHOPPER_REFLEX, target.session.userId, job.tenant).fetch('https://shopper-reflex/identity/erase/object',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Reflex-Tenant': job.tenant, 'X-Reflex-Subject': target.session.userId },
        body: JSON.stringify({ erasureId: job.sources.erasureId }) });
    if (!response.ok || (await response.json() as { ok?: unknown })?.ok !== true) unavailable();
    await execute(env, { ...job.base, targets: [target.owner], sessions: [target.session] },
      { kind: 'session', id: target.owner.id, key: 'session:' + target.session.sid }, job.sources.erasureId, true);
    return;
  }
  const sm = new SessionManager(env, { tenant: job.tenant });
  const current = await sm.readRaw(target.session.sid, true);
  if (current && !await sameSession(target.session, { sid: target.session.sid, sourceId: current.userId, userId: current.userId,
    forwardTo: current.forwardTo ?? null, identity: current.identity?.shopperId ?? null })) conflict();
  if (current) await new TenantKV(env.SESSIONS as unknown as KVLike, job.tenant).delete('session:' + target.session.sid);
}

const limits = [
  'ODP: the profile under the derived vuid is erased through ODP\'s own API by the brand\'s operator',
  'Analytics Engine: historical subject-bearing route events are not erased by this operation; dataset contents, retention and disposition remain unverified',
  'Worker/application logs: historical request, event and subject data are not erased by this operation; other logging paths remain and retention/disposition are unverified',
  'Discovery is bounded to known identity links/current and remembered own sessions; capped links and orphan sessions remain unverified',
  'CACHE profiles/overrides, learning seen indexes and D1 demo_events are not erased by this operation',
  'Ledger tombstone establishment/ring reset is local progress only: physical rewrite, retained suppression, replay/concurrent ingestion and downstream warehouse deletion remain unverified',
  'Pending recovery records and completion metadata do not establish an approved retention or access-audit policy',
];
export interface EraseReceipt {
  reconciliation?: { key: string; at: number; erasureId: string | null; readVia: 'identity/erase' };
  httpStatus: 200 | 202 | 409 | 503; ok: boolean; complete: false; erased: string[];
  status: 'local_complete' | 'pending' | 'conflict' | 'failed'; localComplete: boolean; manualRetry: boolean;
  tenant: string; subject: Selector; shopperId: string | null; actor: string; at: number;
  targets: string[]; localCompleted: Array<{ id: string; stage: Step['kind'] }>; attempted: number;
  profiles: Array<{ id: string; host: 'session' | 'object'; result: 'local_completed' | 'pending' | 'unbound' }>;
  ledger: Array<{ id: string; tombstone: string | null; ring: 'reset' | 'pending' | 'unbound' }>;
  links: { visitors: number; shopper: boolean }; notReached: string[]; error?: string;
  discovery?: { phase: 'scanning' | 'session_scanning' | 'session_cleanup' | 'source_cleanup' | 'extra_cleanup' | 'base_cleanup' | 'local_complete'; pagesSaved: number; pagesCompleted: number;
    extraTargetsCompleted: number; extraStepsCompleted: number; receiptScope: 'current_batch';
    sessionPagesSaved?: number; sessionPagesCompleted?: number; sessionsCompleted?: number;
    registeredSourceHighWater?: number | null; registeredSourcesCompleted?: number; registeredSourceComplete?: boolean };
  sessions?: Array<{ sid: string; id: string; result: 'local_completed' | 'pending' }>;
}
function receipt(tenant: string, subject: Selector, actor: string, at: number, job: Pending | null, attempted: number,
  status: EraseReceipt['status'], error?: string, discovery?: DiscoveryPending | null, extra = false, sessionBatch?: SessionPage | null): EraseReceipt {
  const work = job ? (extra ? extraSteps(job, discovery && discovery.version !== 3 ? discovery.base : undefined, (discovery?.version ?? 0) >= 5)
    : (discovery?.version === 6 || discovery?.version === 7) ? generationSteps(job) : steps(job)) : [], done = work.slice(0, job?.next ?? 0);
  const has = (kind: Step['kind'], id: string) => done.some(s => s.kind === kind && s.id === id);
  const pending = (kind: Step['kind'], id: string) => work.slice(job?.next ?? 0).some(s => s.kind === kind && s.id === id);
  return {
    httpStatus: status === 'local_complete' ? 200 : status === 'pending' ? 202 : status === 'conflict' ? 409 : 503,
    ok: status === 'local_complete' || status === 'pending', complete: false, erased: [], status,
    localComplete: status === 'local_complete', manualRetry: status !== 'local_complete', tenant, subject,
    shopperId: job?.shopperId ?? null, actor: job?.actor ?? actor, at: job?.at ?? at, attempted,
    ...(job ? { reconciliation: { key: destinationKey(tenant, job.selectorHash, job.at), at: job.at,
      erasureId: discovery && discovery.version >= 5 ? (discovery as ObjectDiscovery).sources.erasureId : null, readVia: 'identity/erase' as const } } : {}),
    targets: job?.targets.filter(t => !extra || t.id !== job.shopperId).map(t => t.id) ?? [], localCompleted: done.map(s => ({ id: s.id, stage: s.kind })),
    profiles: job?.targets.filter(t => !extra || t.id !== job.shopperId).flatMap(t => (['session', 'object'] as const).map(host => ({ id: t.id, host,
      result: !job.bindings[host] ? 'unbound' as const : pending(host, t.id) || (host === 'session' && pending('pointer', t.id)) ? 'pending' as const : 'local_completed' as const }))) ?? [],
    ledger: job?.targets.filter(t => !extra || t.id !== job.shopperId).map(t => ({ id: t.id, tombstone: has('tombstone', t.id) ? tombstoneKey(tenant, t.id) : null,
      ring: !job.bindings.ring ? 'unbound' as const : has('ring', t.id) ? 'reset' as const : 'pending' as const })) ?? [],
    links: { visitors: done.filter(s => s.kind === 'visitor_link').length, shopper: done.some(s => s.kind === 'shopper_link') },
    notReached: [...limits.map(limit => discovery && limit.startsWith('Discovery is bounded')
      ? discovery.version !== 3
        ? 'Current identity links and userId-owned session records are scanned in bounded pages, not a transactional KV snapshot; linkless former visitors, previous-account history and concurrent/eventually invisible records remain unverified'
        : 'Current identity links are scanned in bounded pages, not a transactional KV snapshot; linkless orphan sessions, previous-account history and concurrent/eventually invisible links remain unverified'
      : job?.version === 2 && limit.startsWith('CACHE profiles/')
      ? 'CACHE cleanup is limited to frozen known-subject profile/override keys; email aliases, orphans, concurrent writes, isolate memory, learning seen indexes and D1 demo_events are not erased by this operation'
      : limit), ...(job && !job.bindings.object ? ['ShopperReflex profile host: unbound at discovery, not erased'] : []),
      ...(job && !job.bindings.ring ? ['DecisionRing: unbound at discovery, not reset'] : []),
      ...(discovery?.version === 5 || (discovery?.version === 6 || discovery?.version === 7) ? ['DO source discovery covers prospective registrations only; historical unregistered source objects remain unverified'] : []),
      ...((discovery?.version === 6 || discovery?.version === 7) ? ['Session eligibility is prospective DO-local proof; legacy/grantless sessions and concurrent KV writer authority remain unverified'] : [])], ...(error ? { error } : {}),
    ...(discovery ? { discovery: { phase: status === 'local_complete' ? 'local_complete' as const : !discovery.scan.complete ? 'scanning' as const
      : (discovery.version === 6 || discovery.version === 7) && !discovery.sources.complete ? 'source_cleanup' as const
      : discovery.version !== 3 && !discovery.sessionScan.complete ? 'session_scanning' as const
      : discovery.version !== 3 && discovery.nextSessionPage < discovery.sessionScan.pages ? 'session_cleanup' as const
      : discovery.version === 5 && !discovery.sources.complete ? 'source_cleanup' as const
      : discovery.nextPage < discovery.scan.pages ? 'extra_cleanup' as const : 'base_cleanup' as const,
      pagesSaved: discovery.scan.pages, pagesCompleted: discovery.nextPage, extraTargetsCompleted: discovery.extraTargets,
      extraStepsCompleted: discovery.extraSteps, receiptScope: 'current_batch' as const,
      ...(discovery.version !== 3 ? { sessionPagesSaved: discovery.sessionScan.pages, sessionPagesCompleted: discovery.nextSessionPage,
        sessionsCompleted: discovery.sessionSteps } : {}),
      ...(discovery.version === 5 || (discovery.version === 6 || discovery.version === 7) ? { registeredSourceHighWater: discovery.sources.highWater,
        registeredSourcesCompleted: discovery.sources.completed, registeredSourceComplete: discovery.sources.complete } : {}) } } : {}),
    ...(sessionBatch ? { targets: [...new Set(sessionBatch.sessions.map(s => s.owner.id))], profiles: [], ledger: [],
      links: { visitors: 0, shopper: false }, localCompleted: sessionBatch.sessions.slice(0, sessionBatch.next).map(s => ({ id: s.owner.id, stage: 'session' as const })),
      sessions: sessionBatch.sessions.map((s, i) => ({ sid: s.session.sid, id: s.owner.id, result: i < sessionBatch.next ? 'local_completed' as const : 'pending' as const })) } : {}),
  };
}

export async function eraseSubject(env: Env, tenant: TenantId, subject: Selector, actor: string, now = Date.now()): Promise<EraseReceipt> {
  let job: Pending | null = null, discovery: DiscoveryPending | null = null, attempted = 0, extra = false, sessionBatch: SessionPage | null = null;
  try {
    const selector = normalized(subject);
    if (!isValidTenantId(tenant) || !env.STORAGE || !Number.isSafeInteger(now) || now < 0) unavailable();
    const selectorHash = await digest(JSON.stringify(selector)), key = await erasureJobKey(tenant, selector);
    const stored = await env.STORAGE.get(key);
    let etag = stored ? tag(stored) : null;
    const value = stored ? JSON.parse(await stored.text()) : null;
    const previous = (value?.version === 3 || value?.version === 4 || value?.version === 5 || value?.version === 6 || value?.version === 7) && value?.state === 'pending'
      ? validateDiscovery(value, tenant, selector, selectorHash) : stored ? validateJob(value, tenant, selector, selectorHash) : null;
    if (previous?.state === 'pending') {
      if (previous.version === 3 || previous.version === 4 || previous.version === 5 || previous.version === 6 || previous.version === 7) { discovery = previous; job = previous.base; }
      else job = previous;
    }
    else {
      // A completed LOCAL job is not a forever-idempotency key for future erasures.
      const freshAt = Math.max(now, previous ? previous.at + 1 : now);
      const discovered = await discover(env, tenant, selector, selectorHash, actor, freshAt);
      discovery = sessionDiscoverySchema.parse({ version: 4, tenant, selectorHash, actor, at: freshAt,
        state: 'pending', base: discovered, scan: { cursor: null, lastKey: null, complete: !discovered.shopperId, pages: 0 },
        nextPage: 0, cleanupCursor: null, extraSteps: 0, extraTargets: 0, compacting: null,
        sessionScan: { cursor: null, lastKey: null, complete: false, pages: 0 }, nextSessionPage: 0,
        sessionCleanupCursor: null, sessionSteps: 0, sessionCompacting: null });
      if (discovered.bindings.object) discovery = retainedDiscoverySchema.parse({ ...discovery, version: 7,
        destinations: destinationKey(tenant, selectorHash, freshAt), historicalCompleted: 0, historicalStep: 0,
        sources: { erasureId: crypto.randomUUID(), highWater: null, after: 0, complete: false, completed: 0, page: null } });
      etag = await save(env, key, discovery ?? discovered, etag); // Before any destructive work.
      await freezeDestinations(env, discovered, discovery.version >= 5 ? (discovery as ObjectDiscovery).sources.erasureId : null);
      job = discovered;
    }
    // Refuse ambiguous historical progress before any root write, object call or
    // session effect. The page itself is tagged only when cleanup reaches it.
    if (discovery?.version === 5 && discovery.scan.complete && discovery.nextPage < discovery.scan.pages) {
      const savedPage = await env.STORAGE.get(await pageKey(key, discovery, discovery.cleanupCursor));
      if (!savedPage) unavailable();
      tag(savedPage);
      const page = await validatePage(JSON.parse(await savedPage.text()), discovery, discovery.nextPage, discovery.cleanupCursor);
      if (page.state === 'discovered' && page.layout === undefined && page.plan && !equivalentExtraPrefix(page.plan, discovery.base)) conflict();
    }
    const saveController = async (next: DiscoveryPending) => {
      etag = await save(env, key, next, etag);
      discovery = next;
    };
    await freezeDestinations(env, job, discovery && discovery.version >= 5 ? (discovery as ObjectDiscovery).sources.erasureId : null);
    const pendingReceipt = () => receipt(tenant, selector, actor, now, job, attempted, 'pending', undefined, discovery, extra, sessionBatch);
    const objectCall = async (id: string, operation: string, body: unknown) => {
      if (!env.SHOPPER_REFLEX) unavailable();
      const response = await shopperObject(env.SHOPPER_REFLEX, id, tenant).fetch('https://shopper-reflex/identity/erase/' + operation,
        { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Reflex-Tenant': tenant, 'X-Reflex-Subject': id }, body: JSON.stringify(body) });
      if (!response.ok) unavailable();
      const value = await response.json();
      if (!value || typeof value !== 'object' || (value as { ok?: unknown }).ok !== true) unavailable();
      return value;
    };
    if ((discovery?.version === 5 || (discovery?.version === 6 || discovery?.version === 7)) && discovery.sources.highWater === null) {
      const canonical = (discovery.version === 6 || discovery.version === 7) && discovery.base.shopperId !== null;
      if (canonical && !unadvanced(discovery)) conflict();
      const result = discovery.base.shopperId ? z.object({ ok: z.literal(true), highWater: countSchema,
        canonical: canonicalErasureSchema.optional() }).strict().parse(await objectCall(discovery.base.shopperId, 'begin',
          { erasureId: discovery.sources.erasureId, ...(canonical ? { canonical: 1, discovered: await canonicalDiscovery(discovery) } : {}) })) : { highWater: 0 };
      const base = canonical ? await adoptCanonical(discovery, canonicalErasureSchema.parse('canonical' in result ? result.canonical : undefined)) : discovery.base;
      await saveController({ ...discovery, base, sources: { ...discovery.sources, highWater: result.highWater, complete: result.highWater === 0 } });
      job = base;
    }
    const cleanupSources = async (initial: ObjectDiscovery): Promise<boolean> => {
      if (initial.sources.complete) return true;
      let controller = initial;
      const saveSources = async (sources: ObjectDiscovery['sources']) => { const next = { ...controller, sources }; await saveController(next); controller = next; };
      const target = controller.base.shopperId;
      if (!target || controller.sources.highWater === null) unavailable();
      if (!controller.sources.page) {
        const s = controller.sources;
        const page = z.object({ ok: z.literal(true), highWater: countSchema,
          entries: sourcePageSchema.shape.entries, next: countSchema, complete: z.boolean() }).strict().parse(
          await objectCall(target, 'page', { erasureId: s.erasureId, after: s.after, limit: ERASURE_DISCOVERY_PAGE_LIMIT }));
        if (page.highWater !== s.highWater) unavailable();
        const next = { ...controller, sources: { ...s, page: { after: s.after, entries: page.entries, next: page.next, complete: page.complete, processed: 0 } } };
        validateDiscovery(next, tenant, selector, selectorHash);
        await saveSources(next.sources);
      }
      while (controller.sources.page!.processed < controller.sources.page!.entries.length && attempted < ERASURE_STEP_LIMIT) {
        const s = controller.sources, page = s.page!, entry = page.entries[page.processed];
        if ('intent' in entry) {
          if (controller.version === 7) {
            let current = controller;
            const advance = async (historicalStep: number, physical = 0) => {
              const next = { ...current, historicalStep, historicalCompleted: current.historicalCompleted + physical };
              await saveController(next); current = next; controller = next;
            };
            const registrationDigest = await digest(JSON.stringify(entry));
            const proofKey = key.slice(0, -5) + '/' + controller.at + '/sources/' + entry.sequence + '.json';
            const proofSchema = z.object({ version: z.literal(1), tenant: z.literal(tenant), selectorHash: z.literal(selectorHash),
              at: z.literal(current.at), erasureId: z.literal(s.erasureId), registrationDigest: z.literal(registrationDigest), physical: historicalErasureCapsuleSchema.nullable() }).strict();
            if (current.historicalStep === 0) {
              await freezeDestinationSubjects(env, current.base, s.erasureId, [entry.intent.visitorId]);
              attempted++;
              const result = await objectCall(entry.intent.visitorId, 'source', { erasureId: s.erasureId, registration: entry, capture: current.at });
              const physical = z.object({ ok: z.literal(true), physical: historicalErasureCapsuleSchema.nullable() }).strict().parse(result).physical;
              const proof = proofSchema.parse({ version: 1, tenant, selectorHash, at: current.at, erasureId: s.erasureId, registrationDigest, physical });
              const stored = await env.STORAGE.get(proofKey);
              if (stored) { tag(stored); if (await stored.text() !== JSON.stringify(proof)) conflict(); }
              else await save(env, proofKey, proof, null);
              await advance(1);
            }
            const stored = await env.STORAGE.get(proofKey); if (!stored) unavailable(); tag(stored);
            const { physical } = proofSchema.parse(JSON.parse(await stored.text()));
            if (physical && (physical.tenant !== tenant || physical.subject !== entry.intent.visitorId || physical.sourceEpoch !== entry.intent.sourceEpoch
              || physical.erasureId !== s.erasureId || physical.cutoff !== current.at || physical.registrationDigest !== registrationDigest)) conflict();
            for (let index = current.historicalStep - 1; index < 2; index++) {
              if (physical?.entries[index]) {
                if (attempted >= ERASURE_STEP_LIMIT) return false;
                attempted++;
                await objectCall(entry.intent.visitorId, 'physical', { erasureId: s.erasureId, registration: entry, physical, entry: index });
              }
              await advance(index + 2, physical?.entries[index] ? 1 : 0);
            }
            if (current.historicalStep === 3) {
              if (attempted + 2 > ERASURE_STEP_LIMIT) return false;
              attempted += 2;
              await objectCall(entry.intent.visitorId, 'source-effects', { erasureId: s.erasureId, registration: entry, capture: current.at });
              await advance(4);
            }
          } else {
            attempted++;
            await objectCall(entry.intent.visitorId, 'source', { erasureId: s.erasureId, registration: entry });
          }
          await objectCall(target, 'ack', { erasureId: s.erasureId, registration: entry });
          if (controller.version === 7) controller = { ...controller, historicalStep: 0 };
        } else attempted++;
        await saveSources({ ...s, completed: s.completed + 1, page: { ...page, processed: page.processed + 1 } });
      }
      if (controller.sources.page!.processed < controller.sources.page!.entries.length) return false;
      const page = controller.sources.page!;
      await saveSources({ ...controller.sources, after: page.next, complete: page.complete, page: null });
      return controller.sources.complete && attempted < ERASURE_STEP_LIMIT;
    };
    if (discovery) {
      if (!discovery.scan.complete) {
        const childKey = await pageKey(key, discovery, discovery.scan.cursor), storedPage = await env.STORAGE.get(childKey);
        let page: DiscoveryPage;
        if (storedPage) {
          tag(storedPage);
          const captured = await validatePage(JSON.parse(await storedPage.text()), discovery, discovery.scan.pages, discovery.scan.cursor);
          if (captured.state !== 'discovered' || captured.input.lastKey !== discovery.scan.lastKey || (captured.plan?.next ?? 0) !== 0) unavailable();
          page = captured;
        } else {
          page = await discoverPage(env, discovery);
          await save(env, childKey, page, null);
        }
        if (page.plan) await freezeDestinationSubjects(env, discovery.base,
          discovery.version >= 5 ? (discovery as ObjectDiscovery).sources.erasureId : null, page.plan.targets.map(target => target.id));
        await saveController({ ...discovery, scan: { ...page.output, pages: discovery.scan.pages + 1 } });
        if (!discovery.scan.complete) return pendingReceipt();
      }
      if ((discovery.version === 6 || discovery.version === 7) && !await cleanupSources(discovery)) return pendingReceipt();
      if (discovery.version !== 3) {
        let controller: SessionDiscovery = discovery;
        const saveSessions = async (next: SessionDiscovery) => { await saveController(next); controller = next; };
        if (!controller.sessionScan.complete) {
          const childKey = await sessionPageKey(key, controller, controller.sessionScan.cursor), storedPage = await env.STORAGE.get(childKey);
          let page: SessionPage;
          if (storedPage) {
            tag(storedPage);
            const captured = validateSessionPage(JSON.parse(await storedPage.text()), controller, controller.sessionScan.pages, controller.sessionScan.cursor);
            if (captured.state !== 'discovered' || captured.input.lastKey !== controller.sessionScan.lastKey || captured.next !== 0) unavailable();
            page = captured;
          } else {
            page = await discoverSessionPage(env, controller);
            await save(env, childKey, page, null);
          }
          await saveSessions({ ...controller, sessionScan: { ...page.output, pages: controller.sessionScan.pages + 1 } });
          if (!controller.sessionScan.complete) return pendingReceipt();
        }
        // One session capsule per call, before any owner link or pointer is removed.
        if (controller.nextSessionPage < controller.sessionScan.pages) {
          const childKey = await sessionPageKey(key, controller, controller.sessionCleanupCursor), storedPage = await env.STORAGE.get(childKey);
          if (!storedPage) unavailable();
          let childTag = tag(storedPage);
          let page = validateSessionPage(JSON.parse(await storedPage.text()), controller, controller.nextSessionPage, controller.sessionCleanupCursor);
          if (page.state === 'discovered' && page.output.complete !== (controller.nextSessionPage === controller.sessionScan.pages - 1)) unavailable();
          if (page.state === 'discovered' && page.sessions.length) await freezeDestinationSubjects(env, controller.base,
            controller.version >= 5 ? (controller as ObjectDiscovery).sources.erasureId : null, page.sessions.map(target => target.owner.id));
          if (controller.sessionCompacting === null) {
            if (page.state !== 'discovered') unavailable();
            let captured: SessionPage = page;
            sessionBatch = captured;
            while (captured.next < captured.sessions.length && attempted < ERASURE_STEP_LIMIT) {
              attempted++;
              await executeSession(env, controller, captured.sessions[captured.next]);
              const next: SessionPage = { ...captured, next: captured.next + 1 };
              childTag = await save(env, childKey, next, childTag);
              captured = next; sessionBatch = captured;
            }
            if (captured.next < captured.sessions.length) return pendingReceipt();
            page = captured;
            await saveSessions({ ...controller, sessionCompacting: { nextCursor: captured.output.cursor, steps: captured.sessions.length } });
          }
          const progress = controller.sessionCompacting!;
          if (page.state === 'discovered') {
            if (progress.nextCursor !== page.output.cursor || progress.steps !== page.sessions.length || page.next !== page.sessions.length) unavailable();
            await save(env, childKey, { ...pageIdentity(controller, controller.nextSessionPage), kind: 'sessions', state: 'compacted' }, childTag);
          }
          await saveSessions({ ...controller, nextSessionPage: controller.nextSessionPage + 1, sessionCleanupCursor: progress.nextCursor,
            sessionSteps: controller.sessionSteps + progress.steps, sessionCompacting: null });
          if (controller.nextSessionPage < controller.sessionScan.pages || attempted === ERASURE_STEP_LIMIT) return pendingReceipt();
        }
        discovery = controller;
        sessionBatch = null;
      }
      if (discovery.version === 5 && !await cleanupSources(discovery)) return pendingReceipt();
      // At most one identity capsule per invocation. Both scans finish before deletion.
      if (discovery.nextPage < discovery.scan.pages) {
        const childKey = await pageKey(key, discovery, discovery.cleanupCursor), storedPage = await env.STORAGE.get(childKey);
        if (!storedPage) unavailable();
        let childTag = tag(storedPage);
        let page = await validatePage(JSON.parse(await storedPage.text()), discovery, discovery.nextPage, discovery.cleanupCursor);
        if (page.state === 'discovered' && page.output.complete !== (discovery.nextPage === discovery.scan.pages - 1)) unavailable();
        if (discovery.version === 5 && page.state === 'discovered' && page.layout === undefined) {
          if (page.plan && !equivalentExtraPrefix(page.plan, discovery.base)) conflict();
          const tagged: DiscoveryPage = { ...page, layout: 'object-first-v1' };
          childTag = await save(env, childKey, tagged, childTag); // No next effect until the layout write is acknowledged.
          page = tagged;
        }
        if (discovery.compacting === null) {
          if (page.state !== 'discovered') unavailable();
          if (page.plan) await freezeDestinationSubjects(env, discovery.base,
            discovery.version >= 5 ? (discovery as ObjectDiscovery).sources.erasureId : null, page.plan.targets.map(target => target.id));
          let captured: DiscoveryPage = page;
          const work = captured.plan ? extraSteps(captured.plan, discovery.version !== 3 ? discovery.base : undefined, discovery.version >= 5) : [];
          if (captured.plan) {
            let plan = captured.plan;
            job = plan; extra = true;
            await compatible(env, plan);
            while (plan.next < work.length && attempted < ERASURE_STEP_LIMIT) {
              attempted++;
              await execute(env, plan, work[plan.next], discovery.version === 5 || (discovery.version === 6 || discovery.version === 7) ? discovery.sources.erasureId : undefined, (discovery.version === 6 || discovery.version === 7));
              const nextPlan = { ...plan, next: plan.next + 1 };
              const next: DiscoveryPage = { ...captured, plan: nextPlan };
              childTag = await save(env, childKey, next, childTag);
              captured = next; plan = nextPlan; job = plan;
            }
            if (plan.next < work.length) return pendingReceipt();
          }
          page = captured;
          await saveController({ ...discovery, compacting: { nextCursor: captured.output.cursor,
            steps: work.length, targets: captured.plan ? captured.plan.targets.length - 1 : 0 } });
        }
        const progress = discovery.compacting!;
        if (page.state === 'discovered') {
          const work = page.plan ? extraSteps(page.plan, discovery.version !== 3 ? discovery.base : undefined, discovery.version >= 5) : [];
          if (progress.nextCursor !== page.output.cursor || progress.steps !== work.length
            || progress.targets !== (page.plan ? page.plan.targets.length - 1 : 0) || (page.plan?.next ?? 0) !== work.length) unavailable();
          await save(env, childKey, { ...pageIdentity(discovery, discovery.nextPage), state: 'compacted' }, childTag);
        }
        await saveController({ ...discovery, nextPage: discovery.nextPage + 1, cleanupCursor: progress.nextCursor,
          extraSteps: discovery.extraSteps + progress.steps, extraTargets: discovery.extraTargets + progress.targets, compacting: null });
        if (discovery.nextPage < discovery.scan.pages || attempted === ERASURE_STEP_LIMIT) return pendingReceipt();
      }
      job = discovery.base; extra = false;
    }
    await compatible(env, job);
    const work = (discovery?.version === 6 || discovery?.version === 7) ? generationSteps(job) : steps(job);
    while (job.next < work.length && attempted < ERASURE_STEP_LIMIT) {
      attempted++;
      await execute(env, job, work[job.next], discovery?.version === 5 || (discovery?.version === 6 || discovery?.version === 7) ? discovery.sources.erasureId : undefined, (discovery?.version === 6 || discovery?.version === 7));
      const next: Pending = { ...job, next: job.next + 1 };
      if (discovery) await saveController({ ...discovery, base: cachePendingSchema.parse(next) });
      else etag = await save(env, key, next, etag);
      job = next;
    }
    if (job.next < work.length) return pendingReceipt();
    // Drop pending raw IDs/SIDs/links only after every local step is checkpointed.
    await save(env, key, { version: discovery?.version ?? job.version, state: 'local_complete', tenant, selectorHash, actor: job.actor, at: job.at,
      completedAt: Math.max(Date.now(), job.at), steps: work.length + (discovery?.extraSteps ?? 0) + (discovery && discovery.version !== 3 ? discovery.sessionSteps : 0)
        + (discovery?.version === 5 || (discovery?.version === 6 || discovery?.version === 7) ? discovery.sources.completed : 0) }, etag);
    return receipt(tenant, selector, actor, now, job, attempted, 'local_complete', undefined, discovery);
  } catch (error) {
    const status = error instanceof ErasureFailure && error.status === 409 ? 'conflict' : 'failed';
    return receipt(tenant, subject, actor, now, job, attempted, status,
      status === 'conflict' ? 'Erasure target or checkpoint conflict; retry the original selector after reconciliation' : 'Erasure storage or destination unavailable; retry the original selector', discovery, extra, sessionBatch);
  }
}
