// @vitest-environment node
// src/reflex/odpLoop.test.ts
// The ODP wire contract, pinned by tests — the shapes here are the ones
// LIVE-VERIFIED against the Coach RTS instance (2026-07-03).
import { describe, expect, it } from 'vitest';
import {
  gqlObjectLiteral, identityKeyOf, mapActionToOdp, toRecentEventFlat,
  vuidFor, vuidFrom, vuidFromSession, ODP_MIRRORED_AUDIENCES,
} from '@/services/odpLoop';
import type { ActionEvent } from '@/services/RealtimeSegmentEngine';

const ev = (type: ActionEvent['type'], data: Record<string, any>): ActionEvent =>
  ({ type, userId: 'u', data, timestamp: 0, source: 't' }) as ActionEvent;

describe('vuidFromSession — the PRE-CUTOVER behaviour, pinned', () => {
  it('always 32 hex chars, deterministic, session-distinct', async () => {
    const a1 = await vuidFromSession('s-ABC123');
    const a2 = await vuidFromSession('s-ABC123');
    const b = await vuidFromSession('s-DIFFERENT');
    expect(a1).toMatch(/^[0-9a-f]{32}$/);
    expect(a1).toBe(a2);
    // The defect this function name describes: a new session was a new person.
    expect(a1).not.toBe(b);
  });
});

describe('vuidFor — the identity cutover (CW7b)', () => {
  it('gives ONE vuid to one shopper across different sessions', async () => {
    // The whole point. Before the cutover these were two people, so every
    // cross-visit memory claim in the scope appendix was false for a returning
    // shopper, and doc 22's visit bucket had nothing stable to count against.
    const monday = await vuidFor({ visitorId: 'vis-abc', sessionId: 's-monday' });
    const friday = await vuidFor({ visitorId: 'vis-abc', sessionId: 's-friday' });
    expect(monday).toBe(friday);
    expect(monday).toMatch(/^[0-9a-f]{32}$/);
  });

  it('still separates different shoppers', async () => {
    const a = await vuidFor({ visitorId: 'vis-abc', sessionId: 's-1' });
    const b = await vuidFor({ visitorId: 'vis-xyz', sessionId: 's-1' });
    expect(a).not.toBe(b);
  });

  it('falls back to the session when no stable id exists, rather than failing', async () => {
    // A client that predates the stable id, or one with localStorage AND cookies
    // blocked. Worse than a stable id, better than nothing, and never a throw.
    const viaFallback = await vuidFor({ sessionId: 's-only' });
    expect(viaFallback).toBe(await vuidFromSession('s-only'));
    expect(viaFallback).toMatch(/^[0-9a-f]{32}$/);
  });

  it('treats an empty or whitespace visitor id as absent', async () => {
    expect(await vuidFor({ visitorId: '', sessionId: 's-1' })).toBe(await vuidFrom('s-1'));
    expect(await vuidFor({ visitorId: '   ', sessionId: 's-1' })).toBe(await vuidFrom('s-1'));
    expect(await vuidFor({ visitorId: null, sessionId: 's-1' })).toBe(await vuidFrom('s-1'));
  });

  it('reports WHICH identity it used, so the fallback is observable', () => {
    expect(identityKeyOf({ visitorId: 'vis-abc', sessionId: 's-1' })).toEqual({ key: 'vis-abc', stable: true });
    expect(identityKeyOf({ sessionId: 's-1' })).toEqual({ key: 's-1', stable: false });
  });

  it('trims the stable id, so a stray space is not a different person', async () => {
    expect(await vuidFor({ visitorId: ' vis-abc ', sessionId: 's-1' }))
      .toBe(await vuidFor({ visitorId: 'vis-abc', sessionId: 's-2' }));
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

describe('mapActionToOdp — purchases reach ODP (they used to fall through `default`)', () => {
  it('maps a purchase with a product to a product-level purchase, RTS-qualifiable', () => {
    // The highest-weighted action in the engine returned null here. The edge's
    // affinity learned from purchases; ODP's memory of the shopper never did.
    const m = mapActionToOdp(ev('purchase', { productId: 'COA-CH857', orderId: 'ord-1', total: 425, currency: 'usd' }));
    expect(m).toMatchObject({
      type: 'product', action: 'purchase',
      data: { product_id: 'COA-CH857', order_id: 'ord-1', total: 425, currency: 'USD' },
    });
    // and the flattened catalog fields ride along, like every other product action
    expect(m?.data.product_line).toBeTruthy();
  });

  it('accepts the aliases the engine weights identically', () => {
    for (const alias of ['checkout', 'order_complete']) {
      expect(mapActionToOdp(ev(alias, { productId: 'COA-CH857' }))).toMatchObject({ action: 'purchase' });
    }
  });

  it('maps an order-level purchase when no single product is named', () => {
    const m = mapActionToOdp(ev('order_complete', { order_id: 'ord-2', order_total: '199.50' }));
    expect(m).toMatchObject({ type: 'order', action: 'purchase', data: { order_id: 'ord-2', total: 199.5 } });
  });

  it('sends only what the checkout carried, and drops what it cannot trust', () => {
    const m = mapActionToOdp(ev('purchase', { productId: 'COA-CH857', total: 'not a number', orderId: '  ' }));
    expect(m?.data).not.toHaveProperty('total');
    expect(m?.data).not.toHaveProperty('order_id');
  });

  it('returns null for a purchase that names neither a known product nor an order', () => {
    // Nothing to tell ODP, so nothing is sent. Silence beats an empty record.
    expect(mapActionToOdp(ev('purchase', {}))).toBeNull();
    expect(mapActionToOdp(ev('purchase', { productId: 'NOT-IN-CATALOG' }))).toBeNull();
  });
});
