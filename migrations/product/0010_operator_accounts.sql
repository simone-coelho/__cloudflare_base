-- Operator accounts, their sessions, and who did what (doc 30).
--
-- Simone, 2026-09-05: credentials do not belong in KV. KV has no backup and no
-- restore, no record of who read or changed a key, and eventual consistency,
-- so a disabled account could sign in for another minute somewhere else. D1
-- has thirty days of point-in-time restore, consistent writes, constraints,
-- and an audit table we own. A record still in KV from before this migration
-- is moved here at its owner's next sign-in and the KV keys are deleted.
--
-- The refresh token itself is never stored: the sessions table holds its
-- SHA-256, so a copy of the table cannot be replayed as a session.

CREATE TABLE IF NOT EXISTS operator_accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  roles TEXT NOT NULL DEFAULT '["operator"]',
  permissions TEXT NOT NULL DEFAULT '["read"]',
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_sign_in_at INTEGER
);

CREATE TABLE IF NOT EXISTS operator_sessions (
  jti TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_operator_sessions_account ON operator_sessions(account_id);

CREATE TABLE IF NOT EXISTS operator_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  action TEXT NOT NULL,
  actor_id TEXT,
  actor_email TEXT,
  target_id TEXT,
  target_email TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_operator_audit_at ON operator_audit(at);
CREATE INDEX IF NOT EXISTS idx_operator_audit_target ON operator_audit(target_email, action, at);
