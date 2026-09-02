// src/connectors/AudienceStore.ts
// The small persistence seam shared by SegmentProvider (reads) and
// AudienceAuthoring (writes). Because both mock adapters point at the same store,
// an audience created by Opal is immediately qualifiable by ODP — no redeploy.
// See docs/architecture/05-demo-build-spec.md §1.5.

import type { Env } from '@/types/env';
import type { AudienceDef } from './types';

export interface AudienceStore {
  listPublished(): Promise<AudienceDef[]>;
  publish(def: AudienceDef): Promise<void>;
  get(key: string): Promise<AudienceDef | null>;
  /** Load Coach launch audiences at boot (idempotent — won't clobber runtime-created ones). */
  seed(defs: AudienceDef[]): Promise<void>;
  /** Retire an audience (e.g. its catalog value disappeared) — drops out of qualification. */
  archive(key: string): Promise<void>;
  /**
   * The three human verbs the scope appendix §1.2 promises: "Your team renames,
   * pins, or prunes anything the engine proposes." The generator has always
   * honoured the RESULT of these (audienceGenerator.ts:193 skips pinned,
   * :197 skips human-edited); nothing could perform them.
   */
  rename(key: string, name: string, description?: string): Promise<AudienceDef | null>;
  setPinned(key: string, pinned: boolean): Promise<AudienceDef | null>;
}

const PREFIX = 'audience:';

export class KvAudienceStore implements AudienceStore {
  constructor(private env: Env) {}

  async listPublished(): Promise<AudienceDef[]> {
    const list = await this.env.CACHE.list({ prefix: PREFIX });
    const defs: AudienceDef[] = [];
    for (const k of list.keys) {
      const def = (await this.env.CACHE.get(k.name, 'json')) as AudienceDef | null;
      if (def && def.status === 'published') defs.push(def);
    }
    return defs;
  }

  async publish(def: AudienceDef): Promise<void> {
    const published: AudienceDef = { ...def, status: 'published' };
    await this.env.CACHE.put(PREFIX + def.key, JSON.stringify(published));
  }

  async get(key: string): Promise<AudienceDef | null> {
    return (await this.env.CACHE.get(PREFIX + key, 'json')) as AudienceDef | null;
  }

  async seed(defs: AudienceDef[]): Promise<void> {
    for (const def of defs) {
      const existing = await this.env.CACHE.get(PREFIX + def.key);
      if (!existing) {
        await this.env.CACHE.put(PREFIX + def.key, JSON.stringify({ ...def, status: 'published' }));
      }
    }
  }

  async archive(key: string): Promise<void> {
    const def = await this.get(key);
    if (!def || def.status === 'archived') return;
    await this.env.CACHE.put(PREFIX + key, JSON.stringify({ ...def, status: 'archived' }));
  }

  /**
   * Rename. The KEY never moves, because it is load-bearing in cookies, stored
   * decisions and ODP qualification: renaming is a label change, not an identity
   * change, and treating it as one would orphan everything already tagged.
   *
   * Nothing here touches generatorHash. It does not need to: hashDef() covers
   * name, description and conditions, so a rename makes the stored def stop
   * hashing to its recorded value, and regeneration reads that as a human edit
   * and leaves the audience alone. The protection is a consequence of the edit
   * rather than a flag someone has to remember to set.
   */
  async rename(key: string, name: string, description?: string): Promise<AudienceDef | null> {
    const def = await this.get(key);
    if (!def) return null;
    const next: AudienceDef = {
      ...def,
      name,
      ...(description === undefined ? {} : { description }),
    };
    await this.env.CACHE.put(PREFIX + key, JSON.stringify(next));
    return next;
  }

  /**
   * Pin or unpin. Checked BEFORE the ownership hash during regeneration, so a
   * pinned audience survives even when its content still hashes to the
   * generator's own output — which is the case that matters, because that is
   * exactly an audience a merchandiser wanted kept without changing a word of it.
   */
  async setPinned(key: string, pinned: boolean): Promise<AudienceDef | null> {
    const def = await this.get(key);
    if (!def) return null;
    const next: AudienceDef = { ...def, pinned };
    await this.env.CACHE.put(PREFIX + key, JSON.stringify(next));
    return next;
  }
}
