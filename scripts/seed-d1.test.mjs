import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('legacy seed emitter is a literal refusal (source and syntax only)', () => {
  assert.equal(read('scripts/seed-d1.mjs'), [
    '#!/usr/bin/env node',
    '// Retired unsafe demo seed generator. No generation or seeding workflow is available here.',
    "process.stderr.write('ERROR: unsafe legacy D1 seed generation is retired.\\nThis script generated no files and changed no seed data.\\nA scoped demo/customer seed and recovery workflow remains pending W08/W39; see docs/remediation/README.md.\\n');",
    'process.exitCode = 2;',
    '',
  ].join('\n'));
  // --check parses the retired script; it never executes its body.
  const parsed = spawnSync(process.execPath, ['--check', fileURLToPath(new URL('seed-d1.mjs', import.meta.url))], {
    encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' },
  });
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.signal, null);
  assert.equal(parsed.status, 0, parsed.stderr);
  assert.equal(parsed.stdout, '');
  assert.equal(parsed.stderr, '');
});

// These files use line comments and simple statements. Fail on unsupported
// quoted semicolons/block comments instead of silently splitting changed SQL.
function statements(source) {
  const sql = source.replace(/'(?:''|[^'])*'|--[^\n]*/g, (token) => token.startsWith('--') ? '' : token);
  const literals = sql.match(/'(?:''|[^'])*'/g) ?? [];
  for (const literal of literals) assert.ok(!literal.includes(';'), 'quoted semicolon needs parser review');
  assert.doesNotMatch(sql.replace(/'(?:''|[^'])*'/g, ''), /'|\/\*|\*\//, 'unsupported SQL quoting/comment');
  return sql.split(';').map((statement) => statement.trim()).filter(Boolean);
}

function references(all, expectedCount) {
  // Classify by ANY shared-table mention, including DELETE/DROP/UPDATE; never
  // select only the safe INSERT prefix and thereby omit a destructive operation.
  const selected = all.filter((statement) => /\bgeo_(?:census|xref)\b/i.test(statement));
  const mentions = (list) => list.join('\n').match(/\bgeo_(?:census|xref)\b/gi) ?? [];
  assert.deepEqual(mentions(selected), mentions(all), 'every shared-table mention must be selected');
  assert.equal(selected.length, expectedCount, 'unexpected shared-table statement count');
  return selected;
}

const snapshot = `SELECT json_object(
  'sqlite', sqlite_version(),
  'census', json((SELECT json_group_array(json_array(geo_level, geo_key, label,
    median_hh_income_usd, median_home_value_usd, source, vintage))
    FROM (SELECT * FROM geo_census ORDER BY geo_level, geo_key))),
  'xref', json((SELECT json_group_array(json_array(zip, metro_cbsa, region, country))
    FROM (SELECT * FROM geo_xref ORDER BY zip)))
);`;

test('0008 then 011 shared references preserve rows/provenance and repeat in memory', (t) => {
  const schema = statements(read('migrations/0004_geo_census.sql'));
  assert.deepEqual(schema.map((statement) => statement.match(/^CREATE (?:TABLE|INDEX) IF NOT EXISTS \w+/)?.[0]), [
    'CREATE TABLE IF NOT EXISTS geo_census',
    'CREATE TABLE IF NOT EXISTS geo_xref',
    'CREATE INDEX IF NOT EXISTS idx_geo_census_level',
    'CREATE INDEX IF NOT EXISTS idx_geo_xref_metro',
    'CREATE INDEX IF NOT EXISTS idx_geo_xref_region',
  ]);
  const meridian = references(statements(read('migrations/0008_meridian_geo_cohort.sql')), 4);
  assert.equal(meridian[1], "DELETE FROM geo_census WHERE geo_level = 'metro' AND geo_key = '35620' AND source LIKE 'Representative%'");
  for (const [index, statement] of meridian.entries()) {
    if (index !== 1) assert.match(statement, /^INSERT OR IGNORE INTO geo_(?:census|xref) \(/);
  }
  const allSeed = statements(read('migrations/seed/seed_011_geo.sql'));
  const seed = references(allSeed, 5);
  for (const statement of seed) assert.match(statement, /^INSERT OR IGNORE INTO geo_(?:census|xref) \(/);
  assert.deepEqual(allSeed.filter((statement) => /^DELETE\b/i.test(statement)), [
    "DELETE FROM coach_purchase_items WHERE vuid LIKE 'v-nc-%'",
    "DELETE FROM coach_transactions   WHERE order_id LIKE 'ordnc-%'",
    "DELETE FROM coach_odp_profiles   WHERE vuid LIKE 'v-nc-%'",
  ]);

  // Synthetic reference sentinels only: one unrelated and one conflicting key in
  // each table. Omit one NC ZIP to prove missing references are still inserted.
  const fixture = `
    INSERT INTO geo_census VALUES
      ('region', 'ZZ', 'Unrelated fixture', 101, 202, 'Fixture reference', 'fixture-v1'),
      ('region', 'CA', 'Existing conflicting fixture', 303, 404, 'Fixture reviewed source', 'fixture-v2');
    INSERT INTO geo_xref VALUES ('99999', '99998', 'ZZ', 'ZZ'), ('90001', '99997', 'ZZ', 'ZZ');
    DELETE FROM geo_xref WHERE zip = '27028';
  `;
  const sql = [...schema, ...meridian].join(';\n') + ';\n' + fixture + snapshot
    + seed.join(';\n') + ';\n' + snapshot + seed.join(';\n') + ';\n' + snapshot;
  // Disable user startup commands; no disk database, D1 CLI, seed entrypoint,
  // first-party statements, files emitted, or network operation is involved.
  const result = spawnSync('/usr/bin/sqlite3', ['-batch', '-bail', '-init', '/dev/null', ':memory:'], {
    input: sql, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const snapshots = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(snapshots.length, 3);
  const [before, after, repeated] = snapshots;
  const nyZips = ['10001', '10003', '10011', '10012', '10013', '10014', '10016', '10021', '10023', '10024', '11201', '11215', '11217', '11231'];
  const nyMetro = ['metro', '35620', 'New York-Newark-Jersey City, NY-NJ Metro', 99852, 648800, 'Census ACS 2024 1-yr', '2024'];
  for (const state of [before, after]) {
    assert.deepEqual(state.xref.filter((row) => row[2] === 'NY'), nyZips.map((zip) => [zip, '35620', 'NY', 'US']));
    assert.deepEqual(state.census.find((row) => row[0] === 'metro' && row[1] === '35620'), nyMetro);
  }
  for (const row of before.census) {
    assert.deepEqual(after.census.find((candidate) => candidate[0] === row[0] && candidate[1] === row[1]), row);
  }
  for (const row of before.xref) assert.deepEqual(after.xref.find((candidate) => candidate[0] === row[0]), row);
  assert.equal(before.census.some((row) => row[0] === 'county' && row[1] === '37067'), false);
  assert.equal(before.xref.some((row) => row[0] === '27028'), false);
  assert.deepEqual(after.census.find((row) => row[0] === 'county' && row[1] === '37067'),
    ['county', '37067', 'Forsyth County, NC', 65768, 290400, 'Census ACS 2024', '2024']);
  assert.deepEqual(after.xref.find((row) => row[0] === '27028'), ['27028', '49180', 'NC', 'US']);
  assert.deepEqual(repeated, after, 'complete shared-reference state must be identical on repeat');
  t.diagnostic(`Node ${process.version}; SQLite ${after.sqlite}; NY ZIPs 14 retained; NY 99852/648800 Census ACS 2024 1-yr/2024 retained; ${before.census.length} census/${before.xref.length} xref existing rows unchanged; missing NC added; repeat ${after.census.length} census/${after.xref.length} xref rows identical. Reference subset only.`);
});

test('001 through 010 preserve existing rows and add missing fixtures in memory', (t) => {
  const tables = [
    ['coach_catalog', 'id', 71, 'name'],
    ['coach_transactions', 'order_id', 7293, 'tender_type'],
    ['coach_purchase_items', 'item_id', 8760, 'product_name'],
    ['coach_odp_profiles', 'vuid', 3200, 'persona'],
    ['meta_attribute_catalog', 'key', 38, 'description'],
  ];
  const schema = statements(read('migrations/0001_d1_init.sql')).filter((statement) =>
    tables.some(([table]) => statement.startsWith(`CREATE TABLE IF NOT EXISTS ${table} (`)));
  assert.equal(schema.length, 5);
  assert.deepEqual(schema.map((statement) => statement.match(/^CREATE TABLE IF NOT EXISTS (\w+)/)[1]),
    tables.map(([table]) => table));
  const sources = Array.from({ length: 10 }, (_, index) =>
    read(`migrations/seed/seed_${String(index + 1).padStart(3, '0')}.sql`));
  // Classification only: mask complete SQL strings before using the existing
  // splitter, because these fixtures include quoted semicolons. Execute the
  // original files below. The existing helper still rejects unsupported syntax.
  const inserts = sources.flatMap((source) => statements(source.replace(
    /'(?:''|[^'])*'|--[^\n]*/g, (token) => token.startsWith('--') ? '' : "''")));
  assert.equal(inserts.length, 245);
  for (const statement of inserts) {
    const table = tables.find(([name]) => statement.startsWith(`INSERT INTO ${name} (`)
      || statement.startsWith(`INSERT INTO ${name}\n`));
    assert.ok(table, 'every base statement must be a plain INSERT into an expected table');
    assert.ok(statement.endsWith(`ON CONFLICT (${table[1]}) DO NOTHING`), 'explicit primary-key conflict required');
  }
  for (const source of sources) assert.ok(!/wrangler|Apply in order|generated by|FULL RESEED/.test(source),
    'operative legacy seed advice must remain withdrawn');
  const tail = sources[0].slice(sources[0].lastIndexOf('INSERT INTO meta_attribute_catalog'));
  const tailKeys = [...tail.matchAll(/^\s*\(\s*('(?:''|[^'])*')/gm)].map((match) => match[1]);
  assert.equal(tailKeys.length, 3, 'all three retained metadata additions must be present');

  const marker = '__W39_BASE_SNAPSHOT__\n';
  const select = (sql) => `\n.print ${marker}${sql};\n`;
  const snapshot = tables.map(([table, key]) => select(`SELECT * FROM ${table} ORDER BY ${key}`)).join('')
    + select(`SELECT sqlite_version() AS version,
      (SELECT foreign_keys FROM pragma_foreign_keys) AS enabled,
      (SELECT count(*) FROM pragma_foreign_key_check) AS violations`);
  // All synthetic: change one conflicting row in every table, specifically a
  // tail metadata key, then add unrelated sentinels and omit one isolated item.
  const fixture = tables.map(([table, key, , field]) => `UPDATE ${table} SET ${field} = 'w39 conflict fixture'
    WHERE ${key} = ${table === 'meta_attribute_catalog' ? tailKeys[0] : `(SELECT max(${key}) FROM ${table})`};`).join('\n') + `
    INSERT INTO coach_catalog (id, style_code, name, line, category, price_usd)
      VALUES ('w39-catalog', 'fixture', 'fixture', 'fixture', 'fixture', 1);
    INSERT INTO coach_odp_profiles (vuid, persona) VALUES ('w39-profile', 'fixture');
    INSERT INTO coach_transactions (order_id, vuid, order_ts, subtotal_usd, tender_type, item_count)
      VALUES ('w39-order', 'w39-profile', 0, 1, 'fixture', 1);
    INSERT INTO coach_purchase_items (item_id, order_id, vuid, product_id, line, unit_price_usd, order_ts)
      VALUES (-3902, 'w39-order', 'w39-profile', 'w39-catalog', 'fixture', 1, 0);
    INSERT INTO meta_attribute_catalog (key, source_table, column_expr, kind, sql_type, domain_kind, operators)
      VALUES ('w39-attribute', 'fixture', 'fixture', 'fixture', 'TEXT', 'text', '[]');
    DELETE FROM coach_purchase_items WHERE item_id = 1;
  `;
  const seeds = sources.join('\n');
  const result = spawnSync('/usr/bin/sqlite3', ['-batch', '-bail', '-init', '/dev/null', ':memory:'], {
    input: '.mode json\nPRAGMA foreign_keys = ON;\n' + schema.join(';\n') + ';\n'
      + seeds + snapshot + fixture + snapshot + seeds + snapshot + seeds + snapshot,
    encoding: 'utf8', timeout: 15000, maxBuffer: 128 * 1024 * 1024,
  });
  // SQLite rows remain only in process memory; even failures must not print
  // tuple/person/email data or SQL excerpts. Assertions expose safe summaries.
  if (result.error || result.status !== 0) t.diagnostic(JSON.stringify({
    sqliteStatus: result.status, errorCode: result.error?.code ?? null,
    line: result.stderr.match(/line (\d+)/)?.[1] ?? null,
    category: result.stderr.match(/(?:NOT NULL|FOREIGN KEY|UNIQUE|CHECK) constraint failed|syntax error|no such (?:table|column)|cannot store \w+ value in \w+ column/)?.[0] ?? 'unclassified',
  }));
  assert.ok(result.error === undefined, `SQLite execution error ${result.error?.code ?? 'none'}; captured bytes ${result.stdout?.length ?? 0}; rows withheld`);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, 'SQLite fixture failed; row-bearing output withheld');
  assert.equal(result.stderr.length, 0, 'unexpected SQLite diagnostics withheld');
  const chunks = result.stdout.split(marker);
  assert.ok(chunks.shift() === '', 'unexpected output before snapshot marker; rows withheld');
  assert.equal(chunks.length, 24);
  const digest = (rows) => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  const snapshots = chunks.map((chunk, index) => {
    let rows;
    try { rows = JSON.parse(chunk); } catch { assert.fail('invalid snapshot JSON; rows withheld'); }
    if (index % 6 === 5) return rows[0];
    const table = tables[index % 6][0];
    return {
      count: rows.length, complete: digest(rows),
      retained: digest(table === 'coach_purchase_items' ? rows.filter((row) => row.item_id !== 1) : rows),
      missing: table === 'coach_purchase_items' ? digest(rows.filter((row) => row.item_id === 1)) : null,
      tail: table === 'meta_attribute_catalog'
        ? tailKeys.every((literal) => rows.some((row) => row.key === literal.slice(1, -1).replaceAll("''", "'"))) : true,
    };
  });
  const [fresh, populated, after, repeated] = [0, 6, 12, 18].map((offset) => snapshots.slice(offset, offset + 6));
  for (let index = 0; index < 5; index++) {
    const [table, , expected] = tables[index];
    assert.equal(fresh[index].count, expected, `${table}: fresh count`);
    assert.equal(fresh[index].tail, true, `${table}: fresh metadata additions`);
    assert.equal(populated[index].count, expected + (table === 'coach_purchase_items' ? 0 : 1), `${table}: fixture count`);
    assert.notEqual(populated[index].complete, fresh[index].complete, `${table}: populated fixture must differ`);
    assert.equal(after[index].count, expected + 1, `${table}: missing additions and sentinel count`);
    assert.equal(after[index].retained, populated[index].retained, `${table}: all existing complete rows retained`);
    assert.equal(repeated[index].complete, after[index].complete, `${table}: complete repeat equality`);
  }
  assert.notEqual(populated[2].missing, fresh[2].missing, 'isolated fixture item must be absent before reapply');
  assert.equal(after[2].missing, fresh[2].missing, 'isolated fixture item must return unchanged');
  for (const phase of [fresh, populated, after, repeated]) {
    assert.equal(phase[5].enabled, 1, 'foreign keys must be enabled');
    assert.equal(phase[5].violations, 0, 'foreign key check must remain empty');
  }
  t.diagnostic(`Node ${process.version}; SQLite ${after[5].version}; fresh counts 71/7293/8760/3200/38; all 3 metadata additions; 5-table conflicts/sentinels and complete repeats retained; missing item restored; foreign keys enabled, 0 violations. Base sequence only; rows withheld.`);
});
