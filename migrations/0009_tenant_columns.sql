-- CW1: brand isolation in D1.
--
-- mrd_decisions is the one live D1 write path today (receipts.capture). It gains
-- the tenant column so two brands' receipts can be told apart after the fact.
--
-- DEFAULT 'coach' is the SQL mirror of the unprefixed default tenant in KV: every
-- row written before this column existed reads as the default brand, which is
-- exactly what it was. Nothing is orphaned, and a writer that has not yet been
-- converted still lands in the right brand.
--
-- The literal below must match TENANT_COLUMN_DDL in src/tenancy/d1.ts; a test
-- asserts it, so the SQL and the code cannot drift.
ALTER TABLE mrd_decisions ADD COLUMN tenant TEXT NOT NULL DEFAULT 'coach';

-- Every per-brand read names the tenant first, so the index leads with it.
CREATE INDEX IF NOT EXISTS idx_mrd_dec_tenant_ts ON mrd_decisions(tenant, ts);
