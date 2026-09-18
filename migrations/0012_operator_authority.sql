-- Explicit customer authority. Apply after 0010 and 0011. No inferred grants,
-- owners, credentials or customer-data migration is performed by this schema.
CREATE TABLE operator_memberships (
  account_id TEXT NOT NULL REFERENCES operator_accounts(id) ON DELETE CASCADE,
  tenant TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('operator', 'admin')),
  disabled INTEGER NOT NULL CHECK (disabled IN (0, 1)),
  removed INTEGER NOT NULL DEFAULT 0 CHECK (removed IN (0, 1)),
  revision TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, tenant)
);
CREATE INDEX idx_operator_memberships_tenant ON operator_memberships(tenant, account_id);

CREATE TABLE operator_service_credentials (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  tenant TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('operator', 'admin')),
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX idx_operator_services_tenant ON operator_service_credentials(tenant, created_at);

-- Only trusted stamp maintenance inserts here, never an HTTP recovery endpoint.
-- A stable operation/password commitment permits exact retry reconciliation.
-- Inserting a duplicate cannot fire this AFTER INSERT trigger. Do not replace
-- this with a BEFORE INSERT trigger or INSERT OR REPLACE.
CREATE TABLE operator_recovery_requests (
  operation_id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  target_scope TEXT NOT NULL,
  account_id TEXT NOT NULL,
  email TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  password_hash TEXT NOT NULL,
  flags TEXT NOT NULL CHECK (flags = 'temporary-password+enable'),
  at INTEGER NOT NULL
);
CREATE TRIGGER operator_recovery_apply AFTER INSERT ON operator_recovery_requests
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM operator_accounts
    WHERE id = NEW.account_id AND email = NEW.email AND updated_at = NEW.expected_revision
  ) THEN RAISE(ABORT, 'Recovery target changed') END;
  UPDATE operator_accounts SET password_hash = NEW.password_hash,
    must_change_password = 1, disabled = 0, updated_at = MAX(updated_at + 1, NEW.at)
    WHERE id = NEW.account_id AND email = NEW.email AND updated_at = NEW.expected_revision;
  DELETE FROM operator_sessions WHERE account_id = NEW.account_id;
  INSERT INTO operator_audit (at, action, actor_id, target_id, target_email, detail)
    VALUES (NEW.at, 'account_reset', 'stamp-maintenance', NEW.account_id, NEW.email,
      json_object('operation', 'owner_recovery', 'operationId', NEW.operation_id));
END;
