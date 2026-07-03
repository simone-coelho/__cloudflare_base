// @vitest-environment node
// src/reflex/odpLoop.test.ts
// The ODP wire contract, pinned by tests — the shapes here are the ones
// LIVE-VERIFIED against the Coach RTS instance (2026-07-03).
import { describe, expect, it } from 'vitest';
import { gqlObjectLiteral, mapActionToOdp, toRecentEventFlat, vuidFromSession, ODP_MIRRORED_AUDIENCES } from '@/services/odpLoop';
import type { ActionEvent } from '@/services/RealtimeSegmentEngine';

const ev = (type: ActionEvent['type'], data: Record<string, any>): ActionEvent =>
  ({ type, userId: 'u', data, timestamp: 0, source: 't' }) as ActionEvent;

describe('vuidFromSession — ODP validates char(32) hard', () => {
  it('always 32 hex chars, deterministic, session-distinct', async () => {
    const a1 = await vuidFromSession('s-ABC123');
    const a2 = await vuidFromSession('s-ABC123');
    const b = await vuidFromSession('s-DIFFERENT');
    expect(a1).toMatch(/^[0-9a-f]{32}$/);
    expect(a1).toBe(a2);          // stable across reloads (same session)
    expect(a1).not.toBe(b);       // New Shopper (new session) = new vuid
  });
});

describe('mapActionToOdp — internal actions → the ODP taxonomy the RTS fire on', () => {
  it('product_view → type:product / action:detail (the RTS "Product Detail" behavior)', () => {
    const m = mapActionToOdp(ev('product_view', { productId: 'COA-CH857', action: 'product_view' }));
    expect(m).toMatchObject({ type: 'product', action: 'detail' });
    expect(m!.data).toMatchObject({
      product_id: 'COA-CH857',
      product_line: 'Tabby',
      product_price_band: 'elevated',
    });
    expect(typeof m!.data.product_occasions).toBe('string'); // comma-joined per spec §4
  });
  it('add_to_cart → action:add_to_cart (fires High Purchase Intent — live-proven)', () => {
    const m = mapActionToOdp(ev('add_to_cart', { product_id: 'COA-CH857' }));
    expect(m).toMatchObject({ type: 'product', action: 'add_to_cart' });
  });
  it('wishlist → save_for_later; page_view → pageview', () => {
    expect(mapActionToOdp(ev('wishlist_add', { productId: 'COA-CH857' }))).toMatchObject({ action: 'save_for_later' });
    expect(mapActionToOdp(ev('page_view', { path: '/plp' }))).toMatchObject({ type: 'pageview', data: { page: '/plp' } });
  });
  it('internal signals never leave the edge; unknown products are dropped', () => {
    expect(mapActionToOdp(ev('custom', { action: 'reflex_tick' }))).toBeNull();
    expect(mapActionToOdp(ev('product_view', { productId: 'NOT-A-SKU' }))).toBeNull();
  });
});

describe('recent_events flat shape (Part 1 of the ODP reference)', () => {
  it('fields sit FLAT on the event (not under data), ts in epoch SECONDS, idempotence_id present', () => {
    const mapped = mapActionToOdp(ev('product_view', { productId: 'COA-CH857' }))!;
    const flat = toRecentEventFlat(mapped, 1_783_083_996_500);
    expect(flat.type).toBe('product');
    expect(flat.action).toBe('detail');
    expect(flat.ts).toBe(1_783_083_996);                    // seconds, floored
    expect(flat.product_line).toBe('Tabby');                // FLAT — not nested
    expect((flat as any).data).toBeUndefined();
    expect(String(flat.idempotence_id)).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('serializes as a GraphQL literal with bare keys and escaped strings', () => {
    const lit = gqlObjectLiteral({ type: 'product', action: 'detail', ts: 123, product_line: 'Tabby' });
    expect(lit).toBe('{type: \\"product\\", action: \\"detail\\", ts: 123, product_line: \\"Tabby\\"}');
  });
});

describe('mirrored audience list', () => {
  it('matches the 5 keys from the ODP handoff exactly', () => {
    expect([...ODP_MIRRORED_AUDIENCES].sort()).toEqual([
      'late_journey_ready_to_buy',
      'line_tabby_affinity',
      'luxe_affinity',
      'occasion_evening_affinity',
      'silhouette_tote_affinity',
    ]);
  });
});
