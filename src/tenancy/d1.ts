// src/tenancy/d1.ts
// ---------------------------------------------------------------------------
// Tenancy in D1: the column, and the one rule.
//
// KV and Durable Objects are scoped by NAME, so a wrapper can namespace them
// invisibly. SQL cannot be scoped that way: a query reads whatever rows it names,
// and there is no honest wrapper that rewrites arbitrary SQL to add a predicate.
// So D1 tenancy is a CONVENTION rather than a primitive, and the convention has
// two halves.
//
//   1. Every table that holds per-brand rows carries the column below.
//   2. Every query against such a table names the tenant in its WHERE clause.
//
// THE DEFAULT IS THE SQL MIRROR OF THE UNPREFIXED KEY. `DEFAULT 'coach'` means
// every row written before the column existed reads as the default brand, which
// is exactly what it was. Nothing migrates, nothing is orphaned, and an
// unconverted writer that omits the column still lands in the right brand. That
// is the same trade as TenantKV: half-converted must be safe, because this lands
// table by table.
//
// The DDL fragment is exported as a constant, and a test asserts each tenancy
// migration contains it verbatim, so the literal in the SQL file and the default
// in the code cannot drift apart. A migration that hard-codes 'coach' while the
// code says something else is the kind of bug that stays invisible until the
// second brand exists.
// ---------------------------------------------------------------------------

import { DEFAULT_TENANT } from '@/tenancy/tenant';

export const TENANT_COLUMN = 'tenant';

/** The exact column definition every per-brand table carries. */
export const TENANT_COLUMN_DDL = `${TENANT_COLUMN} TEXT NOT NULL DEFAULT '${DEFAULT_TENANT}'`;

/**
 * The ALTER statement for a table that predates tenancy. SQLite requires a
 * non-null DEFAULT to add a NOT NULL column to a populated table, which is also
 * exactly what makes the migration safe: existing rows become the default brand.
 */
export function addTenantColumnSql(table: string): string {
  return `ALTER TABLE ${table} ADD COLUMN ${TENANT_COLUMN_DDL};`;
}
