-- =============================================================================
-- 0006_brighthour_decisions.sql · The Bright Hour — per-decision capture (Beat 7)
-- =============================================================================
-- Target: Cloudflare D1 (SQLite engine). Apply with:
--   npx wrangler d1 migrations apply coach-demo-db --local      (then --remote)
--
-- WHY THIS TABLE EXISTS (docs/qvc/QVC-Site-Recon-Demo-Design.md §C4 Beat 7):
--   "The proof is rows, not dashboards." Their data science team passes test
--   identifiers into their own reporting and computes their own uplift. So the
--   deliverable is not a lift number on a slide — it is ONE FLAT, WAREHOUSE-
--   SHAPED ROW PER SLOT DECISION, joinable to outcome events, with every KPI
--   Kevin named mapping to a column:
--     • repeat visits      = visitor_id × distinct session_id
--     • module engagement  = slot_id × downstream click, split by quota_reserved
--     • productive session = ≥1 joined conversion
--     • uplift             = experiment_id / variation_id + a control holdout,
--                            COMPUTED BY THEIR ANALYSTS, never by us.
--   The competitive point is structural: Adobe Target ships no per-decision
--   export without buying RTCDP (competitive dossier §4). This is one table.
--
-- WHY A SEPARATE TABLE (the 0002 precedent, deliberately repeated):
--   `demo_events` is the Coach surface's captured-click firehose. Bright Hour
--   decisions are a DIFFERENT grain (one row per slot decision, not per click)
--   and a different surface. Keeping them in their own table means a Bright Hour
--   reset is `DELETE FROM bh_decisions` and is therefore PHYSICALLY INCAPABLE of
--   touching a Coach row — the same structural safety 0002 chose, for the same
--   reason. Nothing existing is ALTERed by this migration; it only ADDs.
--
-- COLUMN ORDER IS LOAD-BEARING. It is asserted 1:1 against
--   src/demos/brighthour/composer.ts → BH_DECISION_COLUMNS
-- in composer.test.ts. A schema that drifts from its writer is how an export
-- exhibit dies quietly between a rehearsal and a room.
--
-- HONESTY NOTES:
--   • ts / offer_window_* are REAL instants. The demo clock scales the RATE of
--     time (demoClock.ts); it never fabricates a stamp.
--   • offer_lifecycle_state is the state DERIVED at decision time by
--     lifecycleStateAt() — the catalog stores null, always.
--   • experiment_id / variation_id / campaign_id are NULL until the FX beat
--     (Beat 13). The columns ship now so the row shape their analysts build
--     against never changes underneath them.
-- =============================================================================

CREATE TABLE IF NOT EXISTS bh_decisions (
  -- identity + grain -----------------------------------------------------------
  decision_id           TEXT PRIMARY KEY,   -- deterministic: hash(visitor, session, slot, now, config_version)
  ts                    INTEGER NOT NULL,   -- decision instant, epoch MILLIS (demo-timeline)
  visitor_id            TEXT NOT NULL,      -- the stable anonymous visitor id
  session_id            TEXT,               -- resolved session (repeat visits = visitor × distinct sessions)
  slot_id               TEXT NOT NULL,      -- hero_billboard | daily_deal | spotlight_for_you | deals_rail | …
  page_type             TEXT,               -- 'home' in slot map v1

  -- what was considered, and what won ------------------------------------------
  candidate_set         TEXT,               -- JSON array of item numbers the slot looked at
  chosen_item           TEXT,               -- item number of the occupant (NULL = slot left empty)

  -- the offer, as it stood at ts (§A4/§A5 — their own field set) ----------------
  offer_code            TEXT,               -- TBO | BH2 | EVT120 | LHS | BF50 | …
  offer_label           TEXT,               -- merchandiser-authored text ("Today's Bright One℠")
  offer_window_start    TEXT,               -- ISO-8601, materialized from the catalog offsets
  offer_window_end      TEXT,               -- ISO-8601
  offer_lifecycle_state TEXT,               -- preview|prelaunch|presale|live|ending_today|postsale|expired
  parent_event          TEXT,               -- e.g. EVT120_FALL (nested reveals + finales)
  reveal_index          INTEGER,            -- position on the parent's reveal ladder

  -- the precedence trace (§C2, in order) ---------------------------------------
  gates_passed          TEXT,               -- JSON array: ['window_open','availability',…]
  gates_failed          TEXT,               -- JSON array: ['vip_offer_exclusion (final_sale)',…]
  pinned                INTEGER,            -- 1 = a merchandiser pin decided this slot (ranking skipped)
  quota_reserved        INTEGER,            -- 1 = the exposure floor held this slot against ranking
  dimension_scores      TEXT,               -- JSON object: {"category":0.71,"brandPersonality":0.44,…}
  rank_score            REAL,               -- Σ affinity_d × weight_d (NULL when ranking was skipped)
  rank_position         INTEGER,
  tie_break_hash        TEXT,               -- deterministic hash(visitor_id, slot_id) — replayable

  -- experimentation (Beat 13 — expected NULL until the FX beat lands) -----------
  experiment_id         TEXT,
  variation_id          TEXT,
  campaign_id           TEXT,

  -- provenance -----------------------------------------------------------------
  config_version        TEXT,               -- the ReflexConfig version the decision ran under
  engine_latency_ms     INTEGER,            -- measured, not asserted
  demo_run_id           TEXT                -- groups one presenter's run; enables a per-run reset
);

-- Export/join access paths. `since` is the export route's only required filter,
-- so ts leads; the rest serve the per-visitor, per-slot and per-run reads.
CREATE INDEX IF NOT EXISTS idx_bh_decisions_ts        ON bh_decisions(ts);
CREATE INDEX IF NOT EXISTS idx_bh_decisions_visitor   ON bh_decisions(visitor_id, ts);
CREATE INDEX IF NOT EXISTS idx_bh_decisions_slot      ON bh_decisions(slot_id, ts);
CREATE INDEX IF NOT EXISTS idx_bh_decisions_run       ON bh_decisions(demo_run_id);
CREATE INDEX IF NOT EXISTS idx_bh_decisions_item      ON bh_decisions(chosen_item);
