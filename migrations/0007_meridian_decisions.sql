-- Calder / Meridian (Opticon) decision receipts.
--
-- A SEPARATE TABLE BY DESIGN. Coach's operator reset runs
-- `DELETE FROM demo_events WHERE source='demo'` with a default scope of "all",
-- which would take this demo's rows with it. Its own table makes that
-- physically impossible, and a Calder reset is equally incapable of touching
-- a Coach row.
--
-- The column order here must match the writer in receipts.ts one-for-one. A
-- schema that drifts from its writer is how an export exhibit dies quietly
-- between a rehearsal and a room.
CREATE TABLE IF NOT EXISTS mrd_decisions (
  decision_id     TEXT    NOT NULL,
  ts              INTEGER NOT NULL,          -- real epoch ms; the clock is never faked
  visitor_id      TEXT    NOT NULL,
  vertical        TEXT    NOT NULL,          -- retail | financial
  slot_id         TEXT    NOT NULL,
  rank_position   INTEGER NOT NULL,
  chosen_item     TEXT,
  strategy        TEXT    NOT NULL,          -- cold-start | affinity | fading | pin | fallback
  candidate_set   INTEGER NOT NULL,
  gates_failed    TEXT,                      -- JSON array
  refused         TEXT,                      -- JSON array of {id, score, gate}
  dimension_scores TEXT,                     -- JSON object of the drivers that decided it
  rank_score      REAL,
  confidence      REAL,
  theta_out       REAL,
  config_version  TEXT    NOT NULL,
  arrival_surface TEXT,                      -- which off-site cause brought them
  demo_run_id     TEXT,
  PRIMARY KEY (decision_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_mrd_dec_visitor ON mrd_decisions(visitor_id, ts);
CREATE INDEX IF NOT EXISTS idx_mrd_dec_slot    ON mrd_decisions(slot_id, ts);
CREATE INDEX IF NOT EXISTS idx_mrd_dec_run     ON mrd_decisions(demo_run_id);
