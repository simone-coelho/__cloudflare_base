// @vitest-environment node
// src/demos/brighthour/offerDesk.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// What this suite pins is Beat 2 as BEHAVIOUR, not as a story told over a UI:
//
//   2a  the staged rows really are sparse — no window, no tags, one wrong hint;
//   2b  a proposal covers every tag the engine needs, with honest confidences,
//       and the deterministic fallback is labeled 'ai-mock' rather than passed
//       off as a model answer;
//   2c  approval records WHAT THE HUMAN DID: edited fields, rejected fields,
//       who, when — and refuses the two things that would make the loop a
//       rubber stamp (rejecting a load-bearing tag, editing outside the
//       taxonomy);
//   2d  an approved item is NOT privileged. It enters the same candidate set,
//       fails the window gate before its start, passes it at start, is refused
//       by the VIP rule when its construct says Final Sale, and disappears at
//       expiry — all through the composer's existing code, not a bypass.
//
// Plus the operator guarantee the runbook depends on: reset restores the tray,
// so the beat can be run again by the next presenter.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';

import { loadBrighthourProducts } from './catalog';
import { MS_PER_HOUR, etMidnightForDate } from './demoClock';
import { evaluateGates } from './offerLifecycle';
import {
  composePage,
  loadComposerCatalog,
  mergeOverlayItems,
  type ComposedPage,
  type ComposerItem,
  type DimensionScores,
} from './composer';
import {
  AVAIL_PREFIX,
  ApprovalError,
  CONSTRUCTS,
  DESK_PREFIX,
  applyApproval,
  applyAvailabilityOverrides,
  approvedRawItem,
  availKey,
  clearOverride,
  deskKey,
  ensureSeeded,
  listOverrides,
  listRecords,
  mockProposal,
  newOverride,
  newRecord,
  normalizeProposal,
  overlayItems,
  priceBandOf,
  proposeTags,
  readRecord,
  resetDesk,
  stagedItems,
  statusOf,
  writeOverride,
  writeRecord,
  type OfferDeskRecord,
  type StagedItem,
  type TagKey,
} from './offerDesk';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const EPOCH = etMidnightForDate(2026, 9, 15);
const at = (hours: number): number => EPOCH + hours * MS_PER_HOUR;
/** 2pm ET on demo day zero — the same instant the composer suite composes at. */
const NOW = at(14);

const STAGED = stagedItems();
const DUTCH_OVEN = STAGED[0];
const LAMP = STAGED[1];

/** A minimal in-memory KV with the three calls the desk uses. */
function fakeKv(): KVNamespace & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string, type?: string) {
      const raw = store.get(key);
      if (raw === undefined) return null;
      return type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(key: string, value: string) {
      store.set(key, String(value));
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list({ prefix }: { prefix?: string } = {}) {
      return {
        keys: [...store.keys()]
          .filter((k) => !prefix || k.startsWith(prefix))
          .map((name) => ({ name })),
        list_complete: true,
        cacheStatus: null,
      };
    },
  } as unknown as KVNamespace & { store: Map<string, string> };
}

/** Propose, then approve — the two steps every downstream test needs. */
async function approved(
  staged: StagedItem,
  edits: Partial<Record<TagKey, string>> = {},
  rejects: TagKey[] = [],
  window: Record<string, number> = { startInMinutes: 60, durationHours: 4 },
  nowMs = NOW
): Promise<OfferDeskRecord> {
  const record = { ...newRecord(staged, nowMs), state: 'proposed' as const, proposal: mockProposal(staged, nowMs) };
  return applyApproval(record, { approvedBy: 'dana.k', edits, rejects, window, epochMs: EPOCH }, nowMs);
}

function renderedIds(page: ComposedPage): string[] {
  const ids: string[] = [];
  for (const d of page.decisions) {
    if (d.item) ids.push(d.item.itemNumber);
    for (const i of d.items ?? []) ids.push(i.itemNumber);
  }
  return ids;
}

// ── 2a. The tray is genuinely sparse ─────────────────────────────────────────

describe('Beat 2a — the incoming tray', () => {
  it('stages three rows carrying only what a vendor feed carries', () => {
    expect(STAGED.length).toBe(3);
    for (const s of STAGED) {
      expect(s.itemNumber).toMatch(/^B\d{6}$/);
      expect(typeof s.name).toBe('string');
      expect(typeof s.price_usd).toBe('number');
      // The whole premise: none of the decisioning fields are present.
      const row = s as unknown as Record<string, unknown>;
      expect(row.offer).toBeUndefined();
      expect(row.category).toBeUndefined();
      expect(row.subcategory).toBeUndefined();
      expect(row.brandPersonality).toBeUndefined();
      expect(row.priceBand).toBeUndefined();
    }
  });

  it('carries one absent hint and one WRONG hint — the reason a human is in the loop', () => {
    expect(DUTCH_OVEN.categoryHint ?? null).toBeNull();
    expect(LAMP.categoryHint).toBe('Electronics & Tech'); // it is a floor lamp
  });
});

// ── 2b. The proposal ─────────────────────────────────────────────────────────

describe('Beat 2b — the proposal', () => {
  it('proposes every tag the engine needs, with confidences and rationales', () => {
    const p = mockProposal(DUTCH_OVEN, NOW);
    expect(p.tags.map((t) => t.key)).toEqual([
      'category',
      'subcategory',
      'brandPersonality',
      'occasion',
      'priceBand',
      'offerCode',
    ]);
    for (const t of p.tags) {
      expect(t.confidence).toBeGreaterThanOrEqual(0);
      expect(t.confidence).toBeLessThanOrEqual(1);
      expect(t.rationale.length).toBeGreaterThan(10);
    }
    expect(p.tags.find((t) => t.key === 'category')?.value).toBe('Kitchen & Table');
    expect(p.tags.find((t) => t.key === 'subcategory')?.value).toBe('Cookware & Dutch Ovens');
    // The scripted edit of Beat 2c: proposed value-workhorse, at a confidence
    // low enough that a merchandiser is expected to argue with it.
    const personality = p.tags.find((t) => t.key === 'brandPersonality');
    expect(personality?.value).toBe('value-workhorse');
    expect(personality?.confidence).toBeLessThan(0.7);
  });

  it('treats priceBand as arithmetic, not inference', () => {
    const band = mockProposal(DUTCH_OVEN, NOW).tags.find((t) => t.key === 'priceBand');
    expect(band?.source).toBe('rule');
    expect(band?.confidence).toBe(1);
    expect(band?.value).toBe(priceBandOf(DUTCH_OVEN.price_usd));
    expect(priceBandOf(34.98)).toBe('entry');
    expect(priceBandOf(168)).toBe('elevated');
  });

  it('contradicts the feed hint out loud when the copy says otherwise', () => {
    const p = mockProposal(LAMP, NOW);
    expect(p.tags.find((t) => t.key === 'category')?.value).toBe('For the Home');
    expect(p.hintConflict).toEqual({ hint: 'Electronics & Tech', proposed: 'For the Home' });
  });

  it('is deterministic — a rehearsal and the live run see the same tags', () => {
    expect(mockProposal(DUTCH_OVEN, NOW)).toEqual(mockProposal(DUTCH_OVEN, NOW));
  });

  it('labels the fallback honestly when no model is configured', async () => {
    const p = await proposeTags({}, DUTCH_OVEN, NOW);
    expect(p.proposedBy).toBe('ai-mock');
    expect(p.model).toBeNull();
  });

  it('refuses a model answer outside the taxonomy and records the substitution', () => {
    const p = normalizeProposal(
      {
        category: { value: 'Cookware', confidence: 0.99, rationale: 'invented shelf' },
        subcategory: { value: 'Cookware & Dutch Ovens', confidence: 0.9, rationale: 'ok' },
        brandPersonality: { value: 'heritage-classic', confidence: 0.6, rationale: 'enamel' },
        occasion: { value: 'entertaining', confidence: 0.4, rationale: 'serves a table' },
        priceBand: { value: 'premium', confidence: 0.9, rationale: 'model guessed' },
        offerCode: { value: 'TBO', confidence: 0.7, rationale: 'one-day price' },
      },
      DUTCH_OVEN,
      NOW,
      'gemini-2.5-flash'
    );
    expect(p.proposedBy).toBe('ai');
    expect(p.model).toBe('gemini-2.5-flash');
    // The invented shelf never reaches the merchandiser…
    expect(p.tags.find((t) => t.key === 'category')?.value).toBe('Kitchen & Table');
    // …and the band stays arithmetic no matter what the model claimed.
    expect(p.tags.find((t) => t.key === 'priceBand')?.value).toBe('core');
    expect(p.corrections.map((c) => c.key).sort()).toEqual(['category', 'priceBand']);
  });
});

// ── 2c. Approval — the human loop, with receipts ─────────────────────────────

describe('Beat 2c — approve, edit one, reject one', () => {
  it('records the edit and the reject in provenance, with who and when', async () => {
    const record = await approved(
      DUTCH_OVEN,
      { brandPersonality: 'heritage-classic' },
      ['occasion']
    );

    expect(record.state).toBe('approved');
    expect(record.approvedTags?.brandPersonality).toBe('heritage-classic');
    expect(record.approvedTags?.occasion).toBeUndefined(); // rejected ⇒ not applied
    expect(record.approvedTags?.category).toBe('Kitchen & Table'); // accepted as proposed

    expect(record.provenance.editedFields).toEqual(['brandPersonality']);
    expect(record.provenance.rejectedFields).toEqual(['occasion']);
    expect(record.provenance.approvedBy).toBe('dana.k');
    expect(record.provenance.proposedBy).toBe('ai-mock');
    expect(record.provenance.timestamps.approvedAt).toBe(new Date(NOW).toISOString());
    expect(record.provenance.timestamps.proposedAt).toBeTruthy();
  });

  it('does not count an "edit" that changed nothing', async () => {
    const record = await approved(DUTCH_OVEN, { category: 'Kitchen & Table' });
    expect(record.provenance.editedFields).toEqual([]);
  });

  it('refuses to reject a load-bearing tag — edit it instead of publishing a hole', async () => {
    await expect(approved(DUTCH_OVEN, {}, ['category'])).rejects.toBeInstanceOf(ApprovalError);
    await expect(approved(DUTCH_OVEN, {}, ['offerCode'])).rejects.toBeInstanceOf(ApprovalError);
  });

  it('refuses an edit outside the taxonomy', async () => {
    await expect(approved(DUTCH_OVEN, { subcategory: 'Cast Iron Things' })).rejects.toBeInstanceOf(
      ApprovalError
    );
  });

  it('refuses to approve what was never proposed', () => {
    expect(() => applyApproval(newRecord(DUTCH_OVEN, NOW), {}, NOW)).toThrow(ApprovalError);
  });

  it('takes the window from the human, defaulting to the construct’s own run', async () => {
    const chosen = await approved(DUTCH_OVEN, {}, [], { startInMinutes: 30, durationHours: 2 });
    expect(chosen.window).toEqual({ startMs: NOW + 30 * 60_000, durationHours: 2 });

    const defaulted = await approved(DUTCH_OVEN, {}, [], {});
    expect(defaulted.window?.startMs).toBe(NOW);
    expect(defaulted.window?.durationHours).toBe(CONSTRUCTS.TBO.defaultDurationHours);
  });
});

// ── The approved item, catalog-shaped ────────────────────────────────────────

describe('the approved item is a catalog item', () => {
  it('carries the offer construct, the window and the flat dimension mirrors', async () => {
    const record = await approved(DUTCH_OVEN, { brandPersonality: 'heritage-classic' }, ['occasion']);
    const raw = approvedRawItem(record, EPOCH) as Record<string, any>;

    expect(raw.id).toBe(DUTCH_OVEN.itemNumber);
    expect(raw.offer.code).toBe('TBO');
    expect(raw.offer.label).toBe(CONSTRUCTS.TBO.label);
    expect(raw.offer.lifecycleState).toBeNull(); // derived at read time, never stored
    expect(raw.offer.window.startOffsetHours).toBeCloseTo(15, 6); // 2pm + 60min
    expect(raw.offer.window.durationHours).toBe(4);

    // The reflex core reads these flat keys — no path support, so they must exist.
    expect(raw.category).toBe('Kitchen & Table');
    expect(raw.subcategory).toBe('Cookware & Dutch Ovens');
    expect(raw.brandPersonality).toBe('heritage-classic');
    expect(raw.priceBand ?? raw.pricing.priceBand).toBe('core');
    expect(raw.price_usd).toBe(DUTCH_OVEN.price_usd);
    expect(raw.offerType).toBe('daily_deal');
    expect(raw.urgencyCue).toBe('time_bound');
    expect(raw.occasion).toEqual([]); // the rejected tag really is absent

    // Provenance rides on the item, so the glass box needs no second lookup.
    expect(raw.desk.approvedBy).toBe('dana.k');
    expect(raw.desk.editedFields).toEqual(['brandPersonality']);
  });

  it('accepts the consequence of the construct a merchandiser chose', async () => {
    const record = await approved(DUTCH_OVEN, { offerCode: 'FIN_S' });
    const raw = approvedRawItem(record, EPOCH) as Record<string, any>;
    expect(raw.returnPolicy).toBe('final_sale'); // non-returnable, per §C3
  });

  it('renders nothing until it is approved', () => {
    expect(approvedRawItem(newRecord(DUTCH_OVEN, NOW), EPOCH)).toBeNull();
  });
});

// ── 2d. The overlay in the composition ───────────────────────────────────────

describe('Beat 2d — the overlay goes through the same gates', () => {
  /** The overlay item, materialized by the catalog's own loader. */
  async function overlayItem(
    edits: Partial<Record<TagKey, string>> = {},
    window: Record<string, number> = { startInMinutes: 60, durationHours: 12 }
  ): Promise<ComposerItem> {
    const record = await approved(DUTCH_OVEN, edits, [], window);
    const raw = approvedRawItem(record, EPOCH)!;
    return loadBrighthourProducts(EPOCH, [raw])[0] as unknown as ComposerItem;
  }

  it('is refused by the window gate before its start and admitted exactly at it', async () => {
    const item = await overlayItem();
    const startMs = Number(item.offer_window_start_ms);
    expect(startMs).toBe(NOW + 60 * 60_000);

    const before = evaluateGates(item as never, startMs - 1);
    expect(before.eligible).toBe(false);
    expect(before.gatesFailed.some((g) => g.startsWith('window_open'))).toBe(true);

    const open = evaluateGates(item as never, startMs);
    expect(open.eligible).toBe(true);
    expect(open.lifecycleState).toBe('live');
  });

  it('drops out of every eligible set at expiry', async () => {
    const item = await overlayItem();
    const endMs = Number(item.offer_window_end_ms);
    expect(evaluateGates(item as never, endMs - 1).eligible).toBe(true);
    expect(evaluateGates(item as never, endMs).eligible).toBe(false);
    expect(evaluateGates(item as never, endMs).lifecycleState).toBe('postsale');
  });

  it('is still refused by a merchandising rule that outranks the model', async () => {
    // Approved as Final Sale during a VIP savings event: high affinity, refused
    // by RULE — the Beat 14 moment, reached through the desk (Beat 2c).
    const item = await overlayItem({ offerCode: 'FIN_S' }, { startInMinutes: 0, durationHours: 4 });
    const gates = evaluateGates(item as never, NOW, { vipOfferActive: true });
    expect(gates.eligible).toBe(false);
    expect(gates.gatesFailed).toContain('vip_offer_exclusion (final_sale)');
  });

  it('appears in the composed page only inside its window', async () => {
    const item = await overlayItem();
    const base = loadBrighthourProducts(EPOCH).slice(0, 12) as unknown as ComposerItem[];
    const items = mergeOverlayItems(base, [item]);
    const scores: DimensionScores = { category: { 'Kitchen & Table': 0.9 } };
    const startMs = Number(item.offer_window_start_ms);
    const endMs = Number(item.offer_window_end_ms);

    const page = (nowMs: number): ComposedPage =>
      composePage({ visitorId: 'desk-visitor', nowMs, items, scores, epochMs: EPOCH });

    expect(renderedIds(page(startMs - 1))).not.toContain(DUTCH_OVEN.itemNumber);
    expect(renderedIds(page(startMs))).toContain(DUTCH_OVEN.itemNumber);
    expect(renderedIds(page(endMs))).not.toContain(DUTCH_OVEN.itemNumber);
  });

  it('takes the takeover slot when its window opens, and hands it back at expiry', async () => {
    const item = await overlayItem({}, { startInMinutes: 0, durationHours: 2 });
    const items = mergeOverlayItems([], [item]);
    const startMs = Number(item.offer_window_start_ms);
    const endMs = Number(item.offer_window_end_ms);
    const dailyDeal = (nowMs: number) =>
      composePage({ visitorId: 'desk-visitor', nowMs, items, epochMs: EPOCH }).decisions.find(
        (d) => d.slot_id === 'daily_deal'
      )!;

    expect(dailyDeal(startMs).item?.itemNumber).toBe(DUTCH_OVEN.itemNumber);
    expect(dailyDeal(startMs).strategy).toBe('takeover');
    expect(dailyDeal(endMs).item).toBeNull(); // expired ⇒ the slot is free again
  });

  it('replaces a committed item of the same id rather than doubling it', async () => {
    const item = await overlayItem();
    const base = loadBrighthourProducts(EPOCH).slice(0, 12) as unknown as ComposerItem[];
    const clash = { ...base[0], id: DUTCH_OVEN.itemNumber, itemNumber: DUTCH_OVEN.itemNumber };
    const merged = mergeOverlayItems([...base, clash as ComposerItem], [item]);
    expect(merged.filter((i) => i.id === DUTCH_OVEN.itemNumber).length).toBe(1);
    expect(merged[merged.length - 1]).toBe(item);
  });
});

// ── The KV wrapper and the presenter's reset ─────────────────────────────────

describe('the desk store', () => {
  it('seeds the tray once and leaves a presenter’s work alone afterwards', async () => {
    const kv = fakeKv();
    const seeded = await ensureSeeded(kv, NOW);
    expect(seeded.length).toBe(3);
    expect([...kv.store.keys()].every((k) => k.startsWith(DESK_PREFIX))).toBe(true);
    expect(kv.store.has(deskKey(DUTCH_OVEN.itemNumber))).toBe(true);

    await writeRecord(kv, await approved(DUTCH_OVEN));
    const again = await ensureSeeded(kv, NOW);
    expect(again.find((r) => r.itemNumber === DUTCH_OVEN.itemNumber)?.state).toBe('approved');
  });

  it('reset restores every row to staged — the next presenter runs the beat again', async () => {
    const kv = fakeKv();
    await ensureSeeded(kv, NOW);
    await writeRecord(kv, await approved(DUTCH_OVEN));
    expect((await readRecord(kv, DUTCH_OVEN.itemNumber))?.state).toBe('approved');
    expect((await overlayItems(kv, EPOCH)).length).toBe(1);

    const reset = await resetDesk(kv, NOW);
    expect(reset.every((r) => r.state === 'staged')).toBe(true);
    expect((await readRecord(kv, DUTCH_OVEN.itemNumber))?.state).toBe('staged');
    expect((await readRecord(kv, DUTCH_OVEN.itemNumber))?.proposal).toBeNull();
    expect(await overlayItems(kv, EPOCH)).toEqual([]);
    expect((await listRecords(kv)).map((r) => r.itemNumber)).toEqual(
      STAGED.map((s) => s.itemNumber)
    );
  });

  it('derives the operator’s chips from the window, storing none of them', async () => {
    const record = await approved(DUTCH_OVEN, {}, [], { startInMinutes: 60, durationHours: 2 });
    const startMs = record.window!.startMs;
    const endMs = startMs + 2 * MS_PER_HOUR;

    expect(statusOf(record, startMs - 1).chip).toBe('queued');
    expect(statusOf(record, startMs).chip).toBe('live');
    expect(statusOf(record, startMs).openNow).toBe(true);
    expect(statusOf(record, endMs + 1).chip).toBe('expired');
    expect(statusOf(newRecord(DUTCH_OVEN, NOW), NOW).chip).toBe('staged');
  });

  it('merges the overlay into the composer catalog when a KV binding is present', async () => {
    const kv = fakeKv();
    await writeRecord(kv, await approved(DUTCH_OVEN));
    const withDesk = await loadComposerCatalog(
      { CACHE: kv, BRIGHTHOUR_EPOCH_MS: String(EPOCH) },
      NOW
    );
    const withoutDesk = await loadComposerCatalog({ BRIGHTHOUR_EPOCH_MS: String(EPOCH) }, NOW);
    expect(withDesk.items.length).toBe(withoutDesk.items.length + 1);
    expect(withDesk.items.some((i) => i.id === DUTCH_OVEN.itemNumber)).toBe(true);
    expect(withoutDesk.items.some((i) => i.id === DUTCH_OVEN.itemNumber)).toBe(false);
  });
});

// ── Beat 8's trigger: the availability override ──────────────────────────────

describe('the availability override (Beat 8’s trigger)', () => {
  /** The committed catalog's current Bright One — sellable in the file. */
  const FEATURED = 'B412907';

  it('wins over the catalog’s own availability, in BOTH the forms that get read', () => {
    const items = loadBrighthourProducts(EPOCH) as unknown as Array<Record<string, unknown>>;
    const before = items.find((i) => i.itemNumber === FEATURED)!;
    expect(before.availability_ats).toBe('Y');

    const overrides = new Map([[FEATURED, newOverride(FEATURED, 'N', 'dana.k', NOW)]]);
    const after = applyAvailabilityOverrides(items, overrides);
    const overridden = after.find((i) => i.itemNumber === FEATURED)! as Record<string, any>;

    // The gate reads the nested form; the flat mirror is what everything else
    // sees. Writing one and not the other is the bug this asserts against.
    expect(overridden.availability.ats).toBe('N');
    expect(overridden.availability_ats).toBe('N');
    expect(overridden.urgencyState).toBe('sold_out');
    expect(overridden.availabilityOverride.setBy).toBe('dana.k');

    // Nothing else moved, and the input array was not mutated.
    expect(overridden.price_usd).toBe(before.price_usd);
    expect(before.availability_ats).toBe('Y');
  });

  it('is a no-op when no override exists — the same array comes back', () => {
    const items = loadBrighthourProducts(EPOCH) as unknown as Array<Record<string, unknown>>;
    expect(applyAvailabilityOverrides(items, new Map())).toBe(items);
  });

  it('makes the featured item fail exactly one gate — which is what retention needs', () => {
    const items = loadBrighthourProducts(EPOCH) as unknown as Array<Record<string, unknown>>;
    const overrides = new Map([[FEATURED, newOverride(FEATURED, 'N', 'dana.k', NOW)]]);
    const sold = applyAvailabilityOverrides(items, overrides).find(
      (i) => i.itemNumber === FEATURED
    )! as unknown as ComposerItem;

    const gates = evaluateGates(sold as never, NOW, { vipOfferActive: true });
    expect(gates.eligible).toBe(false);
    expect(gates.gatesFailed).toEqual(['availability (sold_out)']);
  });

  it('flips the featured item to waitlist for the visitor who wanted it, and replaces it for the one who did not', () => {
    const base = loadBrighthourProducts(EPOCH) as unknown as ComposerItem[];
    const overrides = new Map([[FEATURED, newOverride(FEATURED, 'N', 'dana.k', NOW)]]);
    const items = applyAvailabilityOverrides(
      base as unknown as Array<Record<string, unknown>>,
      overrides
    ) as unknown as ComposerItem[];

    const page = (scores: DimensionScores) =>
      composePage({ visitorId: 'beat8-visitor', nowMs: NOW, items, scores, epochMs: EPOCH });

    const wanted = page({ category: { 'Kitchen & Table': 0.9 } });
    const deal = wanted.decisions.find((d) => d.slot_id === 'daily_deal')!;
    expect(deal.item?.itemNumber).toBe(FEATURED);
    expect(deal.item?.urgencyState).toBe('waitlist');
    expect(deal.item?.ats).toBe('W');
    expect(deal.item?.priceUsd).toBe(79.98); // the waitlist preserves the price
    expect(deal.notes).toContain('retained: high_affinity_waitlist');
    expect(deal.explain.gates_failed).toContain('availability (waitlist)');

    const fresh = page({});
    const freshDeal = fresh.decisions.find((d) => d.slot_id === 'daily_deal')!;
    expect(freshDeal.item?.itemNumber ?? null).not.toBe(FEATURED);
    expect(freshDeal.notes ?? []).not.toContain('retained: high_affinity_waitlist');
  });

  it('stores overrides under their own prefix, out of the record listing', async () => {
    const kv = fakeKv();
    await ensureSeeded(kv, NOW);
    await writeOverride(kv, newOverride(FEATURED, 'N', 'dana.k', NOW));

    expect(kv.store.has(availKey(FEATURED))).toBe(true);
    expect(availKey(FEATURED).startsWith(AVAIL_PREFIX)).toBe(true);
    expect(availKey(FEATURED).startsWith(DESK_PREFIX)).toBe(true);
    // An override is not a desk record and must never be read as one.
    expect((await listRecords(kv)).map((r) => r.itemNumber)).toEqual(
      STAGED.map((s) => s.itemNumber)
    );
    expect((await listOverrides(kv)).get(FEATURED)?.ats).toBe('N');
  });

  it('is cleared by a restock, and swept by a reset', async () => {
    const kv = fakeKv();
    await ensureSeeded(kv, NOW);
    await writeOverride(kv, newOverride(FEATURED, 'N', 'dana.k', NOW));

    await clearOverride(kv, FEATURED);
    expect((await listOverrides(kv)).size).toBe(0);
    expect(kv.store.has(availKey(FEATURED))).toBe(false);

    await writeOverride(kv, newOverride(FEATURED, 'N', 'dana.k', NOW));
    await resetDesk(kv, NOW);
    expect((await listOverrides(kv)).size).toBe(0); // a reset restocks the shelf
  });

  it('applies through loadComposerCatalog, over the committed catalog', async () => {
    const kv = fakeKv();
    await writeOverride(kv, newOverride(FEATURED, 'N', 'dana.k', NOW));
    const bundle = await loadComposerCatalog(
      { CACHE: kv, BRIGHTHOUR_EPOCH_MS: String(EPOCH) },
      NOW
    );
    const item = bundle.items.find((i) => i.itemNumber === FEATURED)! as Record<string, any>;
    expect(item.availability.ats).toBe('N');

    await clearOverride(kv, FEATURED);
    const restocked = await loadComposerCatalog(
      { CACHE: kv, BRIGHTHOUR_EPOCH_MS: String(EPOCH) },
      NOW
    );
    const back = restocked.items.find((i) => i.itemNumber === FEATURED)! as Record<string, any>;
    expect(back.availability_ats).toBe('Y');
  });
});
