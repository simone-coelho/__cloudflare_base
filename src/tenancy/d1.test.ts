// src/tenancy/d1.test.ts
//
// SQL tenancy is a convention, not a primitive, so the tests guard the two ways
// a convention fails: the migration literal drifting from the code constant, and
// a read path that forgets the predicate.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_TENANT } from '@/tenancy/tenant';
import { TENANT_COLUMN_DDL, addTenantColumnSql } from '@/tenancy/d1';
import { capture, captureInputFrom, exportRows, MRD_DECISION_COLUMNS } from '@/demos/meridian/receipts';

describe('the migration and the code cannot drift', () => {
  it('migration 0009 contains the DDL fragment verbatim', () => {
    // A migration that hard-codes 'coach' while DEFAULT_TENANT says something
    // else is invisible until the second brand exists.
    const sql = readFileSync('migrations/0009_tenant_columns.sql', 'utf-8');
    expect(sql).toContain(TENANT_COLUMN_DDL);
    expect(sql).toContain(addTenantColumnSql('mrd_decisions'));
  });

  it('the default in the DDL IS the default tenant', () => {
    expect(TENANT_COLUMN_DDL).toBe(`tenant TEXT NOT NULL DEFAULT '${DEFAULT_TENANT}'`);
  });

  it('the writer column list ends with tenant, so the eighteen before it keep their order', () => {
    expect(MRD_DECISION_COLUMNS[MRD_DECISION_COLUMNS.length - 1]).toBe('tenant');
    expect(MRD_DECISION_COLUMNS).toHaveLength(19);
  });
});

class FakeD1 {
  rows: unknown[][] = [];
  queries: Array<{ sql: string; args: unknown[] }> = [];
  prepare(sql: string) {
    const self = this;
    return {
      bind: (...args: unknown[]) => ({
        sql, args,
        all: async () => { self.queries.push({ sql, args }); return { results: [] }; },
      }),
    } as never;
  }
  async batch(stmts: Array<{ args: unknown[] }>) { this.rows.push(...stmts.map((s) => s.args)); return []; }
}

const decision = (slot: string) => ({
  slot, order: 0, itemId: 'i', strategy: 'affinity',
  explain: { candidates: 1, drivers: [], configVersion: 'v1' }, rankScore: 0.1,
} as never);

const tenantIdx = MRD_DECISION_COLUMNS.indexOf('tenant' as never);

describe('every receipt carries its brand', () => {
  it('writes the resolved brand into the row', async () => {
    const db = new FakeD1();
    const input = captureInputFrom({ visitorId: 'v', decisions: [decision('hero')] }, 'retail' as never, 1, 'kate-spade')!;
    await capture(db as never, input);
    expect(db.rows[0][tenantIdx]).toBe('kate-spade');
  });

  it('writes the default brand when an unconverted caller passes none', async () => {
    // Which is also what the column's SQL DEFAULT would do; the two agree.
    const db = new FakeD1();
    const input = captureInputFrom({ visitorId: 'v', decisions: [decision('hero')] }, 'retail' as never, 1)!;
    await capture(db as never, input);
    expect(db.rows[0][tenantIdx]).toBe(DEFAULT_TENANT);
  });

  it('stamps section rows with the brand too', async () => {
    const db = new FakeD1();
    const input = captureInputFrom({
      visitorId: 'v',
      sections: [{ section: 's', rank: 1, templateRank: 1, strategy: 'affinity', score: 0.1,
        explain: { drivers: [], lead: null, confidence: 0.1, thetaOut: 0.45, movedBecause: '', configVersion: 'v1' } }],
    }, 'retail' as never, 1, 'kate-spade')!;
    await capture(db as never, input);
    expect(db.rows[0][tenantIdx]).toBe('kate-spade');
  });
});

describe('the export can never omit the brand', () => {
  it('names the tenant in the predicate, with and without a visitor filter', async () => {
    const db = new FakeD1();
    await exportRows(db as never, null, 10, 'kate-spade');
    await exportRows(db as never, 'v1', 10, 'kate-spade');
    for (const q of db.queries) {
      expect(q.sql).toMatch(/WHERE tenant = \?/);
      expect(q.args[0]).toBe('kate-spade');
    }
  });

  it('defaults to the default brand rather than to "every brand"', async () => {
    // An export with no tenant that returned everything would be the leak.
    const db = new FakeD1();
    await exportRows(db as never, null, 10);
    expect(db.queries[0].sql).toMatch(/WHERE tenant = \?/);
    expect(db.queries[0].args[0]).toBe(DEFAULT_TENANT);
  });
});
