// Lane E2: a member the committed set does not carry reads as absent, never as
// an authority failure; a member it does carry is read, and refused, exactly as
// before. The demo bootstrap (src/routes/demoBootstrap.ts) creates a set of four
// members and no imported priors, so this is the shape every demo tenant has.
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '@/types/env';
import { CONTENT_KIND, EMPTY_CATALOG, SLOTS_KIND, DEFAULT_SLOTS, LEARN_KIND, DEFAULT_LEARN } from '@/content/kinds';
import { REFLEX_KIND } from '@/reflex/configStore';
import { DEFAULT_REFLEX_CONFIG } from '@/reflex/core';
import { PRIORS_KIND } from '@/learn/priors';
import type { DocumentKind } from './versionedStore';
import { initializePublicationSet, invalidatePublicationCache, pinPublication, readOptionalPinnedPublication, readPinnedPublication,
  type PublicationBaseline } from './publication';

class R2 {
  objects = new Map<string, string>(); failReads = false; puts = 0;
  async get(key: string) {
    if (this.failReads) throw new Error('Synthetic authority outage');
    const raw = this.objects.get(key); if (raw === undefined) return null;
    return { key, etag: 'etag-' + key.length, size: new TextEncoder().encode(raw).length, body: new Response(raw).body };
  }
  async put(key: string, raw: string, options: R2PutOptions) {
    this.puts++;
    const conditional = options.onlyIf, exists = this.objects.has(key);
    if (conditional instanceof Headers ? exists : !exists) return null;
    this.objects.set(key, raw);
    return { key, etag: 'etag-' + key.length, size: new TextEncoder().encode(raw).length };
  }
}
const row = (kind: DocumentKind<unknown>, scope: string, value: unknown): PublicationBaseline =>
  ({ kind, scope, revision: { revision: 1, value, actor: 'fixture', note: '', at: 1 } });
/** The four members the demo bootstrap publishes, and optionally a prior document beside them. */
async function fixture(priors?: unknown, scope = 'oh') {
  const storage = new R2(), env = { STORAGE: storage } as unknown as Env;
  const rows = [row(REFLEX_KIND as DocumentKind<unknown>, scope, DEFAULT_REFLEX_CONFIG), row(CONTENT_KIND as DocumentKind<unknown>, scope, EMPTY_CATALOG),
    row(SLOTS_KIND as DocumentKind<unknown>, scope, DEFAULT_SLOTS), row(LEARN_KIND as DocumentKind<unknown>, scope, DEFAULT_LEARN)];
  if (priors !== undefined) rows.push(row(PRIORS_KIND as DocumentKind<unknown>, scope, priors));
  await initializePublicationSet(env, rows, '0:' + crypto.randomUUID());
  return { env, storage, scope };
}
const priorKey = (scope: string) => 'config-publication/v1/' + scope + '/prior/rev/1.json';
beforeEach(() => invalidatePublicationCache());

describe('E2 an optional member of the coherent publication set', () => {
  it('reads a set without a prior member as no prior document, where the required read still refuses', async () => {
    const f = await fixture(), pin = await pinPublication(f.env, f.scope);
    expect(Object.keys(pin.refs).sort()).toEqual(['content:oh', 'learn:oh', 'reflex:oh', 'slots:oh']);
    expect(await readOptionalPinnedPublication(f.env, PRIORS_KIND, f.scope, pin)).toBeNull();
    // The same set through the required read is the error every demo rig logged.
    await expect(readPinnedPublication(f.env, PRIORS_KIND, f.scope, pin)).rejects.toMatchObject({ status: 503, message: 'Configuration publication authority unavailable' });
    // A member the set does carry reads through the optional door exactly as through the required one.
    const learn = await readOptionalPinnedPublication(f.env, LEARN_KIND, f.scope, pin);
    expect(learn).toEqual(await readPinnedPublication(f.env, LEARN_KIND, f.scope, pin));
    expect(learn?.revision).toBe(1);
  });

  it('reads a prior member the set carries, empty or not, as the published document', async () => {
    const empty = await fixture({ rows: [] }), pin = await pinPublication(empty.env, empty.scope);
    const read = await readOptionalPinnedPublication(empty.env, PRIORS_KIND, empty.scope, pin);
    expect(read).toMatchObject({ revision: 1, value: { rows: [] }, publication: { revision: pin.revision, digest: pin.digest } });
    const rows = [{ slot: 'hero', item: 'a', cell: '*', p_prior: 0.2, n_equiv: 30 }];
    const full = await fixture({ version: 'warehouse', rows }), fullPin = await pinPublication(full.env, full.scope);
    expect((await readOptionalPinnedPublication(full.env, PRIORS_KIND, full.scope, fullPin))?.value.rows).toEqual(rows);
  });

  it('never reads an unreadable authority as absence: a listed member that cannot be read, a damaged one, an outage and a foreign scope all refuse', async () => {
    // Listed in the set, its revision gone from storage.
    const gone = await fixture({ rows: [] }), gonePin = await pinPublication(gone.env, gone.scope);
    gone.storage.objects.delete(priorKey(gone.scope));
    await expect(readOptionalPinnedPublication(gone.env, PRIORS_KIND, gone.scope, gonePin)).rejects.toMatchObject({ status: 503 });
    // Listed, its revision replaced by bytes that do not match the set's digest.
    const damaged = await fixture({ rows: [] }), damagedPin = await pinPublication(damaged.env, damaged.scope);
    const envelope = JSON.parse(damaged.storage.objects.get(priorKey(damaged.scope))!);
    damaged.storage.objects.set(priorKey(damaged.scope), JSON.stringify({ ...envelope, value: { rows: [{ slot: 'hero', item: 'a', cell: '*', p_prior: 0.9, n_equiv: 9 }] } }));
    await expect(readOptionalPinnedPublication(damaged.env, PRIORS_KIND, damaged.scope, damagedPin)).rejects.toMatchObject({ status: 503 });
    // The set itself unreadable: the pin refuses before any member is asked about.
    const outage = await fixture();
    outage.storage.failReads = true;
    await expect(pinPublication(outage.env, outage.scope)).rejects.toMatchObject({ status: 503 });
    // A set pinned for one tenant never answers "absent" for another.
    const other = await fixture(undefined, 'vantage'), ohPin = await pinPublication((await fixture()).env, 'oh');
    await expect(readOptionalPinnedPublication(other.env, PRIORS_KIND, 'vantage', ohPin)).rejects.toMatchObject({ status: 503 });
  });
});
