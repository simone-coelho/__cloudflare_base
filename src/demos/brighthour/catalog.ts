// src/demos/brighthour/catalog.ts
// ─────────────────────────────────────────────────────────────────────────────
// The Bright Hour catalog loader (QVC design brief §3 items 1 + 4).
//
// The data file stores offer windows as OFFSETS from a demo epoch
// (`offer.window = {startOffsetHours, durationHours}`), never as absolute
// timestamps — so the same JSON stages a live hour on any day a presenter opens
// the demo. This module turns offsets into real instants against an epoch that is
// always PASSED IN: there is no Date.now() at module scope (a Workers isolate is
// constructed long before it serves a request, and a module-scope clock freezes
// at that instant for the isolate's whole life).
//
// Two consumers, one materialization (types.ts `MaterializedOffer` carries both):
//   • offerLifecycle reads ISO instants at `offer.windowStart/windowEnd`;
//   • the engine reads numbers at `offer.window.{startMs,endMs}` (+ the flat
//     `offer_window_{start,end}_ms` mirrors);
//   • the reflex core reads flat dimension fields off the product.
// So every item is emitted with the flat Coach-Product-shaped floor filled
// defensively (CatalogService's similarity kernel indexes `colors`/`occasion`
// and would throw on undefined arrays) PLUS every field the raw item carries,
// flattened one level (`offer.type` → `offer_type`, `presenter.name` →
// `presenter_name`), so a dimension declared against any of them resolves
// without a loader change. The reflex core silently ignores fields no dimension
// names, so over-mirroring is free.
// ─────────────────────────────────────────────────────────────────────────────

import rawCatalog from './catalog.data.json';
import {
  MS_PER_HOUR,
  etMidnightAtOrBefore,
  materializeWindowMs,
  toIso,
  type WindowOffsets,
} from './demoClock';
// The reveal ladder is the lifecycle engine's math — called, never re-derived.
// (offerLifecycle imports only reflex/core + demoClock, so this cannot cycle.)
import { resolveRevealWindow } from './offerLifecycle';
import type { Product } from '@/services/CatalogService';

/** A materialized Bright Hour item: Coach-Product-shaped + its own flat axes. */
export type BrighthourProduct = Product & Record<string, unknown>;

/** What the data file carries per item (structural — the data agent owns the file). */
interface RawItem extends Record<string, unknown> {
  id?: string;
  offer?: (Record<string, unknown> & { window?: Partial<WindowOffsets> | null }) | null;
  signals?: (Record<string, unknown> & { lastOnAirOffsetHours?: number | null }) | null;
}

/** A parent event (`_meta`-level construct): its own window + reveal cadence. */
interface RawEvent extends Record<string, unknown> {
  id?: string;
  window?: Partial<WindowOffsets> | null;
  revealCadenceHours?: number | null;
  revealCount?: number | null;
}

/**
 * The demo epoch offsets are materialized against.
 *   • `BRIGHTHOUR_EPOCH_MS` (env) pins it — a rehearsed run replays identically;
 *   • otherwise midnight ET at or before `nowMs`, so "2pm today" is always 2pm
 *     today (QVC's whole offer grammar is pinned to US/Eastern — brief §A4).
 * `nowMs` is a parameter (routes pass their own request stamp) — never ambient.
 */
export function getEpochMs(
  env?: { BRIGHTHOUR_EPOCH_MS?: string } | null,
  nowMs?: number
): number {
  const pinned = Number(env?.BRIGHTHOUR_EPOCH_MS);
  if (Number.isFinite(pinned) && pinned > 0) return pinned;
  return etMidnightAtOrBefore(nowMs ?? Date.now());
}

function isScalar(v: unknown): v is string | number | boolean {
  return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

/** Copy scalars/string-arrays across, flattening nested objects as `parent_child`. */
function flattenInto(into: Record<string, unknown>, obj: Record<string, unknown>, prefix = ''): void {
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    const key = prefix ? `${prefix}_${k}` : k;
    if (Array.isArray(v)) {
      const strings = v.filter((x): x is string => typeof x === 'string');
      if (strings.length === v.length) into[key] = strings; // arrays of objects aren't dimensions
      continue;
    }
    if (isScalar(v)) {
      into[key] = v;
      continue;
    }
    if (typeof v === 'object') flattenInto(into, v as Record<string, unknown>, key);
  }
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v.trim() ? v : fallback;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Offsets are only materializable when both halves are finite numbers. */
function windowOffsetsOf(offer: RawItem['offer']): WindowOffsets | null {
  const w = offer?.window;
  if (!w) return null;
  const startOffsetHours = Number(w.startOffsetHours);
  const durationHours = Number(w.durationHours);
  if (!Number.isFinite(startOffsetHours) || !Number.isFinite(durationHours) || durationHours < 0) return null;
  return { startOffsetHours, durationHours };
}

function itemsOf(data: unknown): RawItem[] {
  if (Array.isArray(data)) return data as RawItem[];
  const d = (data ?? {}) as { products?: RawItem[]; items?: RawItem[] };
  return d.products ?? d.items ?? [];
}

/**
 * Offsets for a window that had none of its own (a resolved reveal): recovered
 * from the instants so `offer.window` still satisfies MaterializedWindow
 * (WindowOffsets + startMs/endMs) rather than carrying half the shape.
 */
function revealOffsets(win: { startMs: number; endMs: number }, epochMs: number): WindowOffsets {
  return {
    startOffsetHours: (win.startMs - epochMs) / MS_PER_HOUR,
    durationHours: (win.endMs - win.startMs) / MS_PER_HOUR,
  };
}

/** Set `key` only if the mirror the data file already carries is missing. */
function alias(into: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined || value === null || value === '') return;
  if (into[key] === undefined || into[key] === null || into[key] === '') into[key] = value;
}

/**
 * Materialize the Bright Hour catalog against `epochMs`.
 * Pure and injectable: same epoch + same items ⇒ byte-identical output.
 */
export function loadBrighthourProducts(
  epochMs: number,
  items?: RawItem[],
  events?: RawEvent[]
): BrighthourProduct[] {
  const source = items ?? itemsOf(rawCatalog);
  // Parent events, materialized once: EVT120 reveal items resolve their windows
  // against these (README "Nested reveals").
  const parents = new Map<string, Record<string, unknown>>();
  for (const ev of loadBrighthourEvents(epochMs, events)) {
    const id = typeof ev.id === 'string' ? ev.id : '';
    if (id) parents.set(id, ev);
  }

  const out: BrighthourProduct[] = [];
  for (const item of source) {
    if (!item || typeof item !== 'object') continue;

    const flat: Record<string, unknown> = {};
    flattenInto(flat, item as Record<string, unknown>);

    // Offer window: offsets → instants. `window: null` (always-on) stays null.
    const offsets = windowOffsetsOf(item.offer);
    let win = offsets ? materializeWindowMs(offsets, epochMs) : null;

    // Nested reveals (EVT120): the item carries parentEvent + revealIndex and NO
    // window of its own. RESOLVED HERE, in the loader, using the lifecycle
    // engine's own resolveRevealWindow — so every emitted item is
    // self-describing and lifecycleStateAt(offer, now, cfg) is correct with no
    // second lookup. (The alternative — leaving them null for the composer to
    // resolve at decision time — makes a windowless reveal item read as
    // always-on to anything that forgets the extra step.) FIN finale items also
    // carry parentEvent but WITH their own window, so they never take this path.
    const revealIndex = Number((item.offer as Record<string, unknown> | null | undefined)?.revealIndex);
    const parentId = (item.offer as Record<string, unknown> | null | undefined)?.parentEvent;
    let reveal: { clamped: boolean } | null = null;
    if (!win && Number.isFinite(revealIndex) && typeof parentId === 'string') {
      const parent = parents.get(parentId);
      const cadenceMs = Number(parent?.revealCadenceMs);
      if (parent && Number.isFinite(cadenceMs) && cadenceMs > 0) {
        const rw = resolveRevealWindow(
          parent as { windowStart?: string | null; windowEnd?: string | null },
          revealIndex,
          cadenceMs,
          typeof parent.revealDurationMs === 'number' ? parent.revealDurationMs : undefined
        );
        win = { startMs: rw.startMs, endMs: rw.endMs };
        reveal = { clamped: rw.clamped };
      }
    }

    // `signals.lastOnAirDate` is null in the file by convention (_meta.onAirNote);
    // `lastOnAirOffsetHours` is the stored form the LOADER materializes.
    const onAirOffset = Number(item.signals?.lastOnAirOffsetHours);
    const lastOnAirMs = Number.isFinite(onAirOffset) ? Math.round(epochMs + onAirOffset * MS_PER_HOUR) : null;

    const product: BrighthourProduct = {
      ...flat,
      // Coach-Product-shaped floor. Anything the data file already carries wins
      // (it was spread above); these only fill the gaps the kernel would trip on.
      id: str(item.id ?? flat.id, ''),
      name: str(flat.name ?? flat.title, ''),
      line: str(flat.line ?? flat.brand ?? flat.presented_by, ''),
      category: str(flat.category, ''),
      subcategory: str(flat.subcategory, ''),
      price_usd:
        typeof flat.price_usd === 'number'
          ? flat.price_usd
          : Number(flat.currentSellingPrice ?? flat.pricing_currentSellingPrice ?? 0) || 0,
      colors: strArray(flat.colors),
      material: str(flat.material, ''),
      silhouette: str(flat.silhouette, ''),
      size: str(flat.size, ''),
      occasion: strArray(flat.occasion ?? flat.merch_occasion),
      image_url: str(flat.image_url ?? flat.image, ''),
      product_url: str(flat.product_url ?? flat.url, ''),
      // types.ts MaterializedOffer: BOTH forms. `window` keeps the authored
      // offsets AND gains startMs/endMs (the engine's arithmetic);
      // windowStart/windowEnd are the ISO instants offerLifecycle's OfferLike
      // reads. `lifecycleState` stays null — it is derived from (window, now,
      // config) at READ time, and freezing it here is the exact staleness the
      // offsets convention exists to prevent.
      offer: {
        ...((item.offer ?? {}) as Record<string, unknown>),
        window: win ? { ...(offsets ?? revealOffsets(win, epochMs)), ...win } : null,
        windowStart: win ? toIso(win.startMs) : null,
        windowEnd: win ? toIso(win.endMs) : null,
        ...(reveal ? { revealResolved: true, revealClamped: reveal.clamped } : {}),
      },
      offer_window_start_ms: win?.startMs ?? null,
      offer_window_end_ms: win?.endMs ?? null,
      signals: {
        ...((item.signals ?? {}) as Record<string, unknown>),
        lastOnAirDate: lastOnAirMs === null ? null : toIso(lastOnAirMs),
      },
      last_on_air_ms: lastOnAirMs,
    } as BrighthourProduct;

    // snake_case aliases for the axes the build spec names, filled only when the
    // data file's own flat mirror is absent — two agents, one dimension registry,
    // no chance of a source-name miss.
    alias(product, 'brand_personality', flat.brandPersonality);
    alias(product, 'offer_type', flat.offerType ?? flat.offer_type);
    alias(product, 'presented_by', flat.presentedBy ?? flat.signals_presentedBy);
    alias(product, 'price_band', flat.priceBand ?? flat.pricing_priceBand);
    alias(product, 'urgency_state', flat.urgencyState);
    alias(product, 'urgency_cue', flat.urgencyCue);
    alias(product, 'media_format', flat.mediaFormat);
    alias(product, 'item_number', flat.itemNumber);

    if (product.id) out.push(product);
  }
  return out;
}

/**
 * The parent EVENT constructs (`_meta`-adjacent `events[]`), materialized against
 * the same epoch: the 4.5-day event and the 120-hour tentpole whose nested
 * reveals the lifecycle engine derives from `revealCadenceMs`. Shaped to
 * offerLifecycle's OfferLike so a reveal item's parent can be passed straight in.
 */
export function loadBrighthourEvents(
  epochMs: number,
  events?: RawEvent[]
): Array<Record<string, unknown>> {
  const source =
    events ?? ((rawCatalog as { events?: RawEvent[] }).events ?? []);
  return source.map((ev) => {
    const offsets = ev.window
      ? windowOffsetsOf({ window: ev.window } as RawItem['offer'])
      : null;
    const win = offsets ? materializeWindowMs(offsets, epochMs) : null;
    const cadenceHours = Number(ev.revealCadenceHours);
    const cadenceMs = Number.isFinite(cadenceHours) && cadenceHours > 0 ? cadenceHours * MS_PER_HOUR : null;
    return {
      ...ev,
      windowStart: win ? toIso(win.startMs) : null,
      windowEnd: win ? toIso(win.endMs) : null,
      revealCadenceMs: cadenceMs,
      revealDurationMs: cadenceMs, // back-to-back reveals unless the data says otherwise
    };
  });
}
