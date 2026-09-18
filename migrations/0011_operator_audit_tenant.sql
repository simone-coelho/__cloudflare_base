-- Forward-only local schema step. Legacy global audit rows remain unassigned.
-- Deployment and retention/key lifecycle decisions are separate authority.
ALTER TABLE operator_audit ADD COLUMN tenant TEXT;
CREATE INDEX idx_operator_audit_tenant_id ON operator_audit(tenant, id DESC);
