-- Forward-only local schema (P87): a customer machine credential may be limited
-- to the catalogue import. The service-credential role admits 'catalog-import'
-- beside 'operator' and 'admin'; every existing row is kept exactly as it is.
-- Memberships are untouched: a human tenant role is never 'catalog-import'.
-- Apply after 0013 only under separate operational authority. The migration
-- runner applies this file atomically.
CREATE TABLE operator_service_credentials_v14 (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  tenant TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('operator', 'admin', 'catalog-import')),
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  revoked_at INTEGER
);
INSERT INTO operator_service_credentials_v14 (id,subject,tenant,role,token_hash,expires_at,created_at,created_by,revoked_at)
  SELECT id,subject,tenant,role,token_hash,expires_at,created_at,created_by,revoked_at FROM operator_service_credentials;
DROP TABLE operator_service_credentials;
ALTER TABLE operator_service_credentials_v14 RENAME TO operator_service_credentials;
CREATE INDEX idx_operator_services_tenant ON operator_service_credentials(tenant, created_at);
