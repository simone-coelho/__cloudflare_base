-- Forward-only local schema. No provider, account link, mode or membership is
-- activated. The migration runner applies this file atomically.
DROP TRIGGER operator_recovery_apply;
CREATE TABLE operator_accounts_v13 (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  roles TEXT NOT NULL DEFAULT '["operator"]',
  permissions TEXT NOT NULL DEFAULT '["read"]',
  password_hash TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_sign_in_at INTEGER,
  auth_mode TEXT NOT NULL DEFAULT 'password' CHECK (auth_mode IN ('password','oidc','dual')),
  CHECK ((auth_mode='oidc' AND password_hash IS NULL AND must_change_password=0)
    OR (auth_mode IN ('password','dual') AND password_hash IS NOT NULL))
);
INSERT INTO operator_accounts_v13 SELECT id,email,name,roles,permissions,password_hash,must_change_password,disabled,created_at,updated_at,last_sign_in_at,'password' FROM operator_accounts;
CREATE TABLE operator_memberships_v13 (
  account_id TEXT NOT NULL REFERENCES operator_accounts_v13(id) ON DELETE CASCADE,
  tenant TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('operator','admin')),
  disabled INTEGER NOT NULL CHECK (disabled IN (0,1)),
  removed INTEGER NOT NULL DEFAULT 0 CHECK (removed IN (0,1)),
  revision TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id,tenant)
);
INSERT INTO operator_memberships_v13 SELECT * FROM operator_memberships;
DROP TABLE operator_memberships;
DROP TABLE operator_accounts;
ALTER TABLE operator_accounts_v13 RENAME TO operator_accounts;
ALTER TABLE operator_memberships_v13 RENAME TO operator_memberships;
CREATE INDEX idx_operator_memberships_tenant ON operator_memberships(tenant,account_id);

ALTER TABLE operator_sessions ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'password' CHECK (auth_method IN ('password','oidc'));
CREATE TRIGGER operator_session_method_immutable BEFORE UPDATE OF auth_method,jti ON operator_sessions
WHEN NEW.auth_method<>OLD.auth_method OR NEW.jti<>OLD.jti
BEGIN SELECT RAISE(ABORT,'Session origin is immutable'); END;

CREATE TABLE operator_oidc_links (
  account_id TEXT PRIMARY KEY REFERENCES operator_accounts(id) ON DELETE CASCADE,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  revision TEXT NOT NULL,
  disabled INTEGER NOT NULL CHECK (disabled IN (0,1)),
  updated_at INTEGER NOT NULL,
  UNIQUE (issuer,subject)
);
CREATE TABLE operator_oidc_epoch (id INTEGER PRIMARY KEY CHECK (id=1), epoch TEXT NOT NULL);
INSERT INTO operator_oidc_epoch VALUES (1,lower(hex(randomblob(32))));
CREATE TABLE operator_oidc_transactions (
  state TEXT PRIMARY KEY,
  cookie_hash TEXT NOT NULL,
  tenant TEXT NOT NULL,
  origin TEXT NOT NULL,
  account_id TEXT NOT NULL,
  account_revision INTEGER NOT NULL,
  link_revision TEXT NOT NULL,
  config_digest TEXT NOT NULL,
  epoch TEXT NOT NULL,
  nonce TEXT NOT NULL,
  verifier TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  session_id TEXT
);
CREATE INDEX idx_operator_oidc_transactions_expiry ON operator_oidc_transactions(expires_at);
CREATE TABLE operator_oidc_sessions (
  session_id TEXT PRIMARY KEY REFERENCES operator_sessions(jti) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  tenant TEXT NOT NULL,
  issuer TEXT NOT NULL,
  link_revision TEXT NOT NULL,
  config_digest TEXT NOT NULL,
  account_revision INTEGER NOT NULL,
  epoch TEXT NOT NULL,
  auth_time INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE operator_oidc_completions (
  id TEXT PRIMARY KEY,
  cookie_hash TEXT NOT NULL,
  tenant TEXT NOT NULL,
  origin TEXT NOT NULL,
  epoch TEXT NOT NULL,
  session_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX idx_operator_oidc_completions_expiry ON operator_oidc_completions(expires_at);
CREATE TRIGGER operator_oidc_mode_revision AFTER UPDATE OF auth_mode ON operator_accounts
WHEN NEW.auth_mode<>OLD.auth_mode
BEGIN
  UPDATE operator_accounts SET updated_at=MAX(updated_at+1,NEW.updated_at+1) WHERE id=NEW.id;
  DELETE FROM operator_sessions WHERE account_id=NEW.id;
END;
CREATE TRIGGER operator_oidc_link_revision AFTER UPDATE ON operator_oidc_links
BEGIN
  UPDATE operator_accounts SET updated_at=MAX(updated_at+1,NEW.updated_at) WHERE id=NEW.account_id;
  DELETE FROM operator_sessions WHERE account_id=NEW.account_id;
END;
CREATE TRIGGER operator_oidc_link_remove AFTER DELETE ON operator_oidc_links
BEGIN
  UPDATE operator_accounts SET updated_at=updated_at+1 WHERE id=OLD.account_id;
  DELETE FROM operator_sessions WHERE account_id=OLD.account_id;
END;
CREATE TRIGGER operator_recovery_apply AFTER INSERT ON operator_recovery_requests
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM operator_accounts WHERE id=NEW.account_id AND email=NEW.email AND updated_at=NEW.expected_revision
  ) THEN RAISE(ABORT,'Recovery target changed') END;
  UPDATE operator_accounts SET password_hash=NEW.password_hash,auth_mode='password',
    must_change_password=1,disabled=0,updated_at=MAX(updated_at+1,NEW.at)
    WHERE id=NEW.account_id AND email=NEW.email AND updated_at=NEW.expected_revision;
  DELETE FROM operator_sessions WHERE account_id=NEW.account_id;
  INSERT INTO operator_audit (at,action,actor_id,target_id,target_email,detail)
    VALUES (NEW.at,'account_reset','stamp-maintenance',NEW.account_id,NEW.email,
      json_object('operation','owner_recovery','operationId',NEW.operation_id));
END;
