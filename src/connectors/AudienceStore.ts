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
}
