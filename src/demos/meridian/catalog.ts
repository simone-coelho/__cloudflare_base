// src/demos/meridian/catalog.ts
// ─────────────────────────────────────────────────────────────────────────────
// The Meridian catalog accessor. Deliberately NOT src/services/CatalogService —
// that one imports the Coach JSON at module scope and scores through a kernel
// tuned for Coach (a `line` dimension weighted 0.3, price bands cut at 150/400,
// Coach colour families). Borrowing it would mean ranking Meridian through
// Coach's taste. This is thirty lines instead.
//
// Both verticals are loaded at module scope and frozen. They are small, static,
// and bundled — there is no fetch, no KV read, and nothing to fail at showtime.
// ─────────────────────────────────────────────────────────────────────────────

import retailJson from './catalog.retail.json';
import financialJson from './catalog.financial.json';
import blocksJson from './catalog.blocks.json';
import type { MeridianItem, MeridianBlock, MeridianSlot, Vertical } from './types';

const RETAIL = Object.freeze(retailJson as unknown as MeridianItem[]);
const FINANCIAL = Object.freeze(financialJson as unknown as MeridianItem[]);
const BLOCKS = Object.freeze(blocksJson as unknown as MeridianBlock[]);

const BY_ID = new Map<string, MeridianItem>();
for (const it of [...RETAIL, ...FINANCIAL]) BY_ID.set(it.id, it);
const BLOCK_BY_ID = new Map<string, MeridianBlock>();
for (const b of BLOCKS) BLOCK_BY_ID.set(b.id, b);

export function itemsFor(vertical: Vertical): readonly MeridianItem[] {
  return vertical === 'retail' ? RETAIL : FINANCIAL;
}

export function blocksFor(vertical: Vertical): readonly MeridianBlock[] {
  return BLOCKS.filter((b) => b.vertical === vertical);
}

export function blocksForSlot(vertical: Vertical, slot: MeridianSlot): readonly MeridianBlock[] {
  return BLOCKS.filter((b) => b.vertical === vertical && b.slots.includes(slot));
}

export function itemById(id: string): MeridianItem | undefined {
  return BY_ID.get(id);
}

export function blockById(id: string): MeridianBlock | undefined {
  return BLOCK_BY_ID.get(id);
}

/** Which vertical an ID belongs to, from the ID alone. `MRD-R###` / `MRD-F###`. */
export function verticalOfId(id: string): Vertical | null {
  if (id.startsWith('MRD-R')) return 'retail';
  if (id.startsWith('MRD-F')) return 'financial';
  return null;
}

/**
 * Resolve an incoming id to a scoreable record.
 *
 * The Coach reflex DO silently DROPS unknown product ids at its trust gate, which
 * is how a whole surface can appear to work while learning nothing. We surface it
 * instead: unknown ids come back as a typed miss, and the caller counts them.
 */
export type Resolution =
  | { ok: true; item: MeridianItem }
  | { ok: false; reason: 'unknown-id' | 'wrong-vertical'; id: string };

export function resolve(id: string, vertical: Vertical): Resolution {
  const item = BY_ID.get(id);
  if (!item) return { ok: false, reason: 'unknown-id', id };
  if (item.vertical !== vertical) return { ok: false, reason: 'wrong-vertical', id };
  return { ok: true, item };
}

/** Counts used by the wire-check, so a mis-seeded catalog fails loudly at boot. */
export function catalogStats() {
  return {
    retail: RETAIL.length,
    financial: FINANCIAL.length,
    blocks: BLOCKS.length,
    ids: BY_ID.size,
    duplicateIds: RETAIL.length + FINANCIAL.length - BY_ID.size,
  };
}
