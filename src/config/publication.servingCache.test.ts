// Lane E4: the configuration a shopper's object reads on every action is read once per publication.
//
// Every owner operation fences its bindings behind a handle of its own (`ownerEnvironment`), so the
// serving cache, which is keyed by the storage handle, never answered a second operation: each action
// read the publication head, the set and every document again (on the OH rig, four R2 reads before
// any other work). A serving read now validates the head every time and reuses the set and the
// documents this isolate already holds for exactly that committed identity.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '@/types/env';
import { CONTENT_KIND, EMPTY_CATALOG, SLOTS_KIND, DEFAULT_SLOTS, LEARN_KIND, DEFAULT_LEARN } from '@/content/kinds';
import { REFLEX_KIND, reflexScopeForTenant } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG, type ReflexConfig } from '@/reflex/core';
import { resolveTenantReflexConfigRevision } from '@/demos/registry';
import { ownerEnvironment, runOwnerOperation } from '@/identity/sessionAuthority';
import type { DocumentKind } from './versionedStore';
import { initializePublicationSet, invalidatePublicationCache, pinPublication, publishSet, readPublication, type PublicationBaseline } from './publication';

/** An R2 bucket with per-write etags, conditional writes and a log of every read. */
class R2 {
  objects = new Map<string, string>(); versions = new Map<string, number>(); reads: string[] = []; failReads = false;
  async get(key: string) {
    this.reads.push(key);
    if (this.failReads) throw new Error('Synthetic authority outage');
    const raw = this.objects.get(key); if (raw === undefined) return null;
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length, body: new Response(raw).body };
  }
  async put(key: string, raw: string, options?: R2PutOptions) {
    const current = this.objects.has(key) ? 'v' + this.versions.get(key) : null, condition = options?.onlyIf;
    const absent = condition instanceof Headers ? condition.get('If-None-Match') === '*' : false;
    const match = condition instanceof Headers ? null : (condition as { etagMatches?: string } | undefined)?.etagMatches;
    if ((absent && current !== null) || (match != null && match !== current)) return null;
    this.objects.set(key, raw); this.versions.set(key, (this.versions.get(key) ?? 0) + 1);
    return { key, etag: 'v' + this.versions.get(key), size: new TextEncoder().encode(raw).length };
  }
}

const tenant = 'oh', scope = reflexScopeForTenant(tenant);
const head = `config-publication/v2/${tenant}/head.json`;
const setOf = (n: number) => `config-publication/v2/${tenant}/set/${n}.json`;
const documentOf = (kind: string, n: number) => `config-publication/v1/${tenant}/${kind}/rev/${n}.json`;
const reflexWith = (tauMs: number): ReflexConfig => ({ ...DEFAULT_REFLEX_CONFIG, tauMs });
const row = (kind: DocumentKind<unknown>, value: unknown, at = 1): PublicationBaseline =>
  ({ kind, scope: kind === REFLEX_KIND ? scope : tenant, revision: { revision: 1, value, actor: 'fixture', note: '', at } });

async function fixture() {
  const storage = new R2(), env = { STORAGE: storage } as unknown as Env;
  await initializePublicationSet(env, [row(REFLEX_KIND as DocumentKind<unknown>, reflexWith(60_000)), row(CONTENT_KIND as DocumentKind<unknown>, EMPTY_CATALOG),
    row(SLOTS_KIND as DocumentKind<unknown>, DEFAULT_SLOTS), row(LEARN_KIND as DocumentKind<unknown>, DEFAULT_LEARN)], '0:' + crypto.randomUUID());
  invalidatePublicationCache(); storage.reads.length = 0;
  return { storage, env };
}
/** One action's worth of reading, as a shopper's object does it: inside its own owner operation. */
function asOwner<T>(env: Env, work: (fenced: Env) => Promise<T>): Promise<T> {
  const owner = {};
  return runOwnerOperation(owner, env, () => work(ownerEnvironment(owner, env)));
}
/** What an ordinary action reads: the tenant's Reflex configuration, then its content catalogue. */
const reads = async (fenced: Env) => {
  const reflex = await resolveTenantReflexConfigRevision(fenced, tenant);
  const content = await readPublication(fenced, CONTENT_KIND, tenant, true);
  return { reflex, content };
};
const actionReads = (env: Env) => asOwner(env, reads);
async function publishReflex(env: Env, value: ReflexConfig) {
  const pin = await pinPublication(env, tenant), revision = pin.refs['reflex:' + scope]!.revision;
  const result = await publishSet(env, [{ kind: REFLEX_KIND as DocumentKind<unknown>, scope, request: value, candidate: () => value }],
    { actor: 'beat', expectedRevision: revision, expectedPublication: { revision: pin.revision, digest: pin.digest }, operationId: revision + ':' + crypto.randomUUID() });
  expect(result.ok).toBe(true);
}
beforeEach(() => invalidatePublicationCache());

describe('E4 the serving configuration across a shopper object\'s operations', () => {
  it('reads the head alone for an unchanged publication, and answers exactly what the full read answered', async () => {
    const { storage, env } = await fixture();
    const first = await actionReads(env);
    expect(storage.reads).toEqual([head, setOf(1), documentOf('reflex', 1), documentOf('content', 1)]);
    storage.reads.length = 0;
    const second = await actionReads(env);
    expect(storage.reads).toEqual([head]);
    expect(second.reflex).toEqual(first.reflex);
    expect(second.reflex.config.tauMs).toBe(60_000);
    // The very documents read the first time, validated then: the catalogue-vocabulary cache
    // (keyed by the document object) answers for the second action as well.
    expect(second.content).toBe(first.content);
    // Within one operation the head is read once, however many members are read.
    storage.reads.length = 0;
    await asOwner(env, async (fenced) => { await reads(fenced); await readPublication(fenced, LEARN_KIND, tenant, true); });
    expect(storage.reads).toEqual([head, documentOf('learn', 1)]);
  });

  it('carries forward what each operation read, so a profile read before the first action costs the next action nothing extra', async () => {
    const { storage, env } = await fixture();
    // The page reads the profile first (the Reflex configuration alone), then acts, then acts again.
    await asOwner(env, (fenced) => resolveTenantReflexConfigRevision(fenced, tenant));
    storage.reads.length = 0;
    await actionReads(env);
    expect(storage.reads).toEqual([head, documentOf('content', 1)]);
    storage.reads.length = 0;
    await actionReads(env);
    expect(storage.reads).toEqual([head]);
  });

  it('honours a publication committed between two actions on the very next one, with no wait for any expiry', async () => {
    const { storage, env } = await fixture();
    await actionReads(env);
    await publishReflex(env, reflexWith(5_000));
    storage.reads.length = 0;
    const next = await actionReads(env);
    expect(next.reflex).toMatchObject({ revision: 2, config: { tauMs: 5_000 } });
    // The new identity reads its own set and the member that moved; the unchanged member is the
    // same immutable document, so it may come from either set's reads.
    expect(storage.reads.slice(0, 3)).toEqual([head, setOf(2), documentOf('reflex', 2)]);
    storage.reads.length = 0;
    expect((await actionReads(env)).reflex).toMatchObject({ revision: 2, config: { tauMs: 5_000 } });
    expect(storage.reads).toEqual([head]);
  });

  it('never answers from what it holds when the head cannot be read, and holds nothing across a refused read', async () => {
    const { storage, env } = await fixture();
    await actionReads(env);
    storage.failReads = true;
    await expect(actionReads(env)).rejects.toMatchObject({ status: 503 });
    storage.failReads = false; storage.reads.length = 0;
    expect((await actionReads(env)).reflex.config.tauMs).toBe(60_000);
    expect(storage.reads).toEqual([head]);
  });

  it('keeps the administrative read and the cache expiry as they were', async () => {
    const { storage, env } = await fixture();
    await actionReads(env);
    storage.reads.length = 0;
    await asOwner(env, (fenced) => pinPublication(fenced, tenant));
    expect(storage.reads).toEqual([head, setOf(1)]);
    // Past the serving cache's lifetime nothing is held: the next action reads everything again.
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
    try {
      storage.reads.length = 0;
      await actionReads(env);
      expect(storage.reads).toEqual([head, setOf(1), documentOf('reflex', 1), documentOf('content', 1)]);
    } finally { clock.mockRestore(); }
  });
});
