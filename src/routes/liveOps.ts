// src/routes/liveOps.ts
// ─────────────────────────────────────────────────────────────────────────────
// The Offer Desk API — Beat 2's operator half (recon §C4, brief §3 item 2).
//
//   GET  /live/ops-api/staged            the incoming tray + every desk record
//   POST /live/ops-api/propose/:item     run the tagging model (Beat 2b)
//   POST /live/ops-api/approve/:item     approve with edits + rejects (Beat 2c)
//   POST /live/ops-api/reset             restore the tray — presenters re-run it
//   GET  /live/ops-api/state             records + derived lifecycle at `now`
//
// No auth: this is a demo surface, and a login screen in the middle of the
// centerpiece beat costs more than it protects. What it DOES guarantee is a
// narrow blast radius — every write in this file goes through offerDesk's KV
// wrapper, which only ever touches keys under `bh:offerdesk:`. The catalog file
// is read-only here, the shopper session store is never opened, and D1 is not
// bound. The desk cannot corrupt anything the storefront owns.
//
// The clock is the same one /live/api/page uses (demoClock at the env's
// multiplier, anchored on the request instant), so an approval scheduled here
// lands on the timeline the storefront is reading — and with the default
// multiplier of 1, demo time simply IS real time.
// ─────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono';
import { z } from 'zod';

import type { Env } from '@/types/env';
import { makeDemoClock } from '@/demos/brighthour/demoClock';
import { clockMultiplierOf, composePage, loadComposerCatalog } from '@/demos/brighthour/composer';
import { resolveReflexConfig } from '@/demos/registry';
import {
  ApprovalError,
  clearOverride,
  listOverrides,
  newOverride,
  writeOverride,
  BRAND_PERSONALITIES,
  CATEGORIES,
  CONSTRUCTS,
  OCCASIONS,
  PRICE_BANDS,
  REJECTABLE_TAGS,
  TAG_KEYS,
  TAG_LABELS,
  TAXONOMY,
  applyApproval,
  approvedRawItem,
  ensureSeeded,
  listRecords,
  proposeTags,
  readRecord,
  resetDesk,
  statusOf,
  writeRecord,
  type OfferDeskRecord,
  type TagKey,
} from '@/demos/brighthour/offerDesk';

const liveOpsRoutes = new Hono<{ Bindings: Env }>();

const SURFACE = 'brighthour';

/** Demo-timeline `now`, derived exactly as POST /live/api/page derives it. */
function demoNowMs(env: Env): number {
  const realNowMs = Date.now();
  const multiplier = clockMultiplierOf(env);
  const clock = makeDemoClock({
    anchorRealMs: realNowMs,
    anchorDemoMs: realNowMs,
    multiplier,
  });
  return Math.round(clock.demoNow(realNowMs));
}

/** The taxonomy the UI's edit dropdowns are built from — one source, both ends. */
function vocabulary(): Record<string, unknown> {
  return {
    tagKeys: [...TAG_KEYS],
    tagLabels: TAG_LABELS,
    rejectable: [...REJECTABLE_TAGS],
    categories: [...CATEGORIES],
    subcategoriesByCategory: Object.fromEntries(
      Object.entries(TAXONOMY).map(([cat, subs]) => [cat, Object.keys(subs)])
    ),
    brandPersonalities: [...BRAND_PERSONALITIES],
    occasions: [...OCCASIONS],
    priceBands: [...PRICE_BANDS],
    constructs: Object.values(CONSTRUCTS),
  };
}

/** One record as the UI reads it: the record itself plus what `now` derives. */
function view(record: OfferDeskRecord, nowMs: number): Record<string, unknown> {
  return { ...record, status: statusOf(record, nowMs) };
}

// ── GET /staged — the incoming tray ──────────────────────────────────────────

liveOpsRoutes.get('/staged', async (c) => {
  const nowMs = demoNowMs(c.env);
  const records = await ensureSeeded(c.env.CACHE, nowMs);
  return c.json({
    ok: true,
    surface: SURFACE,
    nowMs,
    clockMultiplier: clockMultiplierOf(c.env),
    /** Whether a real model call is possible right now — the UI says which. */
    modelConfigured: !!c.env.GEMINI_API_KEY,
    records: records.map((r) => view(r, nowMs)),
    vocabulary: vocabulary(),
  });
});

// ── POST /propose/:itemNumber — Beat 2b ──────────────────────────────────────

liveOpsRoutes.post('/propose/:itemNumber', async (c) => {
  const itemNumber = c.req.param('itemNumber');
  const nowMs = demoNowMs(c.env);
  try {
    await ensureSeeded(c.env.CACHE, nowMs);
    const record = await readRecord(c.env.CACHE, itemNumber);
    if (!record) return c.json({ ok: false, error: `no staged item ${itemNumber}` }, 404);

    const t0 = Date.now();
    const proposal = await proposeTags(c.env, record.staged, nowMs);
    const next: OfferDeskRecord = {
      ...record,
      state: record.state === 'approved' ? 'approved' : 'proposed',
      proposal,
      provenance: {
        ...record.provenance,
        proposedBy: proposal.proposedBy,
        timestamps: { ...record.provenance.timestamps, proposedAt: proposal.proposedAt },
      },
      updatedAt: proposal.proposedAt,
    };
    await writeRecord(c.env.CACHE, next);

    return c.json({
      ok: true,
      surface: SURFACE,
      nowMs,
      tookMs: Date.now() - t0,
      record: view(next, nowMs),
    });
  } catch (error) {
    console.error('Offer Desk propose failed:', error);
    return c.json(
      { ok: false, error: error instanceof Error ? error.message : 'propose failed' },
      500
    );
  }
});

// ── POST /approve/:itemNumber — Beat 2c ──────────────────────────────────────

const tagKeySchema = z.enum(TAG_KEYS);

const approveSchema = z.object({
  approvedBy: z.string().min(1).max(80).optional(),
  /**
   * { brandPersonality: 'heritage-classic' } — the edit that proves the loop.
   * Typed as an open string map because a zod enum-keyed record demands EVERY
   * key; the tag names and their values are both validated in applyApproval,
   * against the same taxonomy the UI's selects were built from.
   */
  edits: z.record(z.string(), z.string()).optional(),
  /** ['occasion'] — refused outright; load-bearing tags are refused back (400). */
  rejects: z.array(tagKeySchema).optional(),
  window: z
    .object({
      startMs: z.number().optional(),
      startInMinutes: z.number().optional(),
      startOffsetHours: z.number().optional(),
      durationHours: z.number().positive().optional(),
      durationMinutes: z.number().positive().optional(),
    })
    .optional(),
});

liveOpsRoutes.post('/approve/:itemNumber', async (c) => {
  const itemNumber = c.req.param('itemNumber');
  const nowMs = demoNowMs(c.env);
  try {
    const body = await c.req.json().catch(() => ({}));
    const input = approveSchema.parse(body);

    const record = await readRecord(c.env.CACHE, itemNumber);
    if (!record) return c.json({ ok: false, error: `no staged item ${itemNumber}` }, 404);

    const { epochMs } = await loadComposerCatalog(c.env, Date.now());
    const approved = applyApproval(
      record,
      {
        approvedBy: input.approvedBy ?? null,
        edits: (input.edits ?? {}) as Partial<Record<TagKey, string>>,
        rejects: (input.rejects ?? []) as TagKey[],
        window: input.window ?? null,
        epochMs,
      },
      nowMs
    );
    await writeRecord(c.env.CACHE, approved);

    return c.json({
      ok: true,
      surface: SURFACE,
      nowMs,
      epochMs,
      record: view(approved, nowMs),
      /** What the composition will now see — the item, fully shaped. */
      item: approvedRawItem(approved, epochMs),
    });
  } catch (error) {
    if (error instanceof ApprovalError) {
      return c.json({ ok: false, error: error.message, refused: true }, 400);
    }
    if (error instanceof z.ZodError) {
      return c.json({ ok: false, error: 'Invalid approval', details: error.issues }, 400);
    }
    console.error('Offer Desk approve failed:', error);
    return c.json(
      { ok: false, error: error instanceof Error ? error.message : 'approve failed' },
      500
    );
  }
});

// ── POST /reset — put the tray back (every presenter re-runs the beat) ───────

liveOpsRoutes.post('/reset', async (c) => {
  const nowMs = demoNowMs(c.env);
  try {
    const records = await resetDesk(c.env.CACHE, nowMs);
    return c.json({
      ok: true,
      surface: SURFACE,
      nowMs,
      reset: records.length,
      records: records.map((r) => view(r, nowMs)),
    });
  } catch (error) {
    console.error('Offer Desk reset failed:', error);
    return c.json(
      { ok: false, error: error instanceof Error ? error.message : 'reset failed' },
      500
    );
  }
});

// ── Beat 8's trigger: sell it out, put it back ───────────────────────────────
//
// The desk does not edit the catalog. It writes ONE fact about an item —
// availability — into its own KV prefix, and the composer's existing machinery
// does the rest: the availability gate fails, the waitlist retention keeps the
// item for a visitor who was above θin (at the same price, per their real
// waitlist rule), and everyone else gets the next eligible occupant.

const availabilitySchema = z.object({ setBy: z.string().min(1).max(80).optional() }).optional();

/** The item number as the catalog spells it — 'B' + 6 digits, case-insensitive in. */
function itemNumberParam(raw: string): string | null {
  const value = (raw ?? '').trim().toUpperCase();
  return /^B\d{6}$/.test(value) ? value : null;
}

liveOpsRoutes.post('/soldout/:itemNumber', async (c) => {
  const itemNumber = itemNumberParam(c.req.param('itemNumber'));
  if (!itemNumber) return c.json({ ok: false, error: 'item number must read B######' }, 400);
  const nowMs = demoNowMs(c.env);
  try {
    const body = (await c.req.json().catch(() => ({}))) as unknown;
    const input = availabilitySchema.parse(body ?? {});
    const override = newOverride(itemNumber, 'N', input?.setBy ?? null, nowMs);
    await writeOverride(c.env.CACHE, override);
    return c.json({ ok: true, surface: SURFACE, nowMs, override });
  } catch (error) {
    console.error('Offer Desk soldout failed:', error);
    return c.json(
      { ok: false, error: error instanceof Error ? error.message : 'sell-out failed' },
      500
    );
  }
});

liveOpsRoutes.post('/restock/:itemNumber', async (c) => {
  const itemNumber = itemNumberParam(c.req.param('itemNumber'));
  if (!itemNumber) return c.json({ ok: false, error: 'item number must read B######' }, 400);
  const nowMs = demoNowMs(c.env);
  try {
    // Deleting the override IS the restock: whatever the catalog file says is
    // true again, with nothing of the desk's left behind to explain later.
    await clearOverride(c.env.CACHE, itemNumber);
    return c.json({ ok: true, surface: SURFACE, nowMs, itemNumber, restocked: true });
  } catch (error) {
    console.error('Offer Desk restock failed:', error);
    return c.json(
      { ok: false, error: error instanceof Error ? error.message : 'restock failed' },
      500
    );
  }
});

/**
 * What is on the floor RIGHT NOW — the takeover occupant and the deals rail,
 * composed for a neutral visitor so the strip is the same for every presenter.
 * This is how a presenter reaches the CURRENT Bright One mid-beat without
 * knowing its item number.
 */
liveOpsRoutes.get('/occupants', async (c) => {
  const nowMs = demoNowMs(c.env);
  try {
    const { epochMs, items, events } = await loadComposerCatalog(c.env, Date.now());
    const page = composePage({
      visitorId: 'ops-desk',
      nowMs,
      items,
      events,
      reflexConfig: await resolveReflexConfig(c.env, SURFACE),
      epochMs,
      page: 'ops',
    });
    const overrides = await listOverrides(c.env.CACHE);

    const seen = new Set<string>();
    const rows: Array<Record<string, unknown>> = [];
    const push = (
      slotId: string,
      item: { itemNumber: string; name: string; urgencyState: string; ats: string } | null,
      offerLabel: string | null
    ): void => {
      if (!item || seen.has(item.itemNumber)) return;
      seen.add(item.itemNumber);
      const override = overrides.get(item.itemNumber) ?? null;
      rows.push({
        slotId,
        itemNumber: item.itemNumber,
        name: item.name,
        offerLabel,
        urgencyState: item.urgencyState,
        ats: item.ats,
        override,
      });
    };

    for (const d of page.decisions) {
      if (d.slot_id !== 'daily_deal' && d.slot_id !== 'deals_rail' && d.slot_id !== 'hero_billboard') {
        continue;
      }
      push(d.slot_id, d.item, d.offer?.label ?? null);
      for (const i of d.items ?? []) push(d.slot_id, i, i.offer?.label ?? null);
    }

    // Anything a presenter sold out that has since dropped off the page still
    // needs a Restock button, so overrides always appear even when unoccupied.
    for (const [itemNumber, override] of overrides) {
      if (seen.has(itemNumber)) continue;
      rows.push({
        slotId: 'off_page',
        itemNumber,
        name: itemNumber,
        offerLabel: null,
        urgencyState: override.urgencyState,
        ats: override.ats,
        override,
      });
    }

    // Anything a human has overridden sorts FIRST. An item that just sold out
    // leaves the slots it occupied, and a presenter who needs to put it back
    // should not be hunting for it at the bottom of a ten-row table.
    rows.sort((a, b) => Number(Boolean(b.override)) - Number(Boolean(a.override)));

    return c.json({ ok: true, surface: SURFACE, nowMs, occupants: rows });
  } catch (error) {
    console.error('Offer Desk occupants failed:', error);
    return c.json(
      { ok: false, error: error instanceof Error ? error.message : 'occupants failed' },
      500
    );
  }
});

// ── GET /state — records + what the clock derives from them right now ────────

liveOpsRoutes.get('/state', async (c) => {
  const nowMs = demoNowMs(c.env);
  const [records, overrides] = await Promise.all([
    listRecords(c.env.CACHE),
    listOverrides(c.env.CACHE),
  ]);
  const statuses = records.map((r) => statusOf(r, nowMs));
  return c.json({
    ok: true,
    surface: SURFACE,
    nowMs,
    nowIso: new Date(nowMs).toISOString(),
    counts: {
      staged: records.filter((r) => r.state === 'staged').length,
      proposed: records.filter((r) => r.state === 'proposed').length,
      approved: records.filter((r) => r.state === 'approved').length,
      liveNow: statuses.filter((s) => s.openNow).length,
      soldOut: [...overrides.values()].filter((o) => o.ats === 'N').length,
    },
    records: records.map((r) => view(r, nowMs)),
    overrides: [...overrides.values()],
  });
});

export { liveOpsRoutes };
export default liveOpsRoutes;
