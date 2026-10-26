# Local D1 and seed data: the product schema by default, demo data only on request

This is the operating note for a **local** database and worker store, for a fresh clone and for anyone re-seeding one. The schema itself is described in [architecture/10-d1-schema.md](architecture/10-d1-schema.md), and the migration files are normative. Nothing here touches a deployed database or bucket: customer environments are created only through the customer-stamp workflow ([deployment/01-deploy.md](deployment/01-deploy.md)), which applies the product migrations and never replays demo migrations or seeds.

## Two migration sets

| Set | Files | Applied to the local database |
|---|---|---|
| Product | `migrations/product/0010_operator_accounts.sql` … `0014_operator_catalog_import.sql` (operator accounts, audit, authority, OIDC, the catalogue-only machine credential role) | by default |
| Demo | the demo chain `migrations/0001_d1_init.sql` … `0014_operator_catalog_import.sql`, then the demo seeds `migrations/seed/seed_001.sql` … `seed_010.sql` and `seed_011_geo.sql` | only when demo data is requested explicitly |

The default `DB` declaration in `wrangler.toml` names `migrations_dir = "migrations/product"`, the same directory the staging and production declarations name, so `npx wrangler d1 migrations apply coach-demo-db --local` and `node scripts/init-local.mjs` give a local database the product schema only and no demo table.

`migrations/0010_operator_accounts.sql` … `0014_operator_catalog_import.sql` are the historical duplicates of the five product files, kept so the demo chain stays complete. They must stay byte-identical to their product copies: `scripts/init-local.mjs` refuses to run when one differs, and the W39 acceptance test (`src/units/W39/LEDGER.unit.test.ts`) fails.

## Requesting demo data

Demo data is requested explicitly, for the local database only:

```bash
node scripts/init-local.mjs --scope coach --demo-data
```

The demo path applies **`migrations/*.sql` in filename order (0001 through 0014), then `migrations/seed/*.sql` in filename order (`seed_001.sql` through `seed_010.sql`, then `seed_011_geo.sql`)**:

1. Each demo-chain migration runs once and is recorded in the `d1_migrations` table, the table `wrangler d1 migrations apply` keeps, so the two tools agree on what ran. The five product members of the chain run from their identical product copies; a migration already recorded (for example the product ones, when the database was first set up without demo data) is skipped. Requested on a database that already holds the product schema, the demo migrations 0001 through 0009 run after the product ones; they touch disjoint tables, and the resulting schema is the same as the chain applied in order.
2. Then every demo seed runs, in order, on every request. The seeds are written to be repeated (next section).

No command in this repository applies the demo chain or the demo seeds to a deployed database, and they are never to be applied there by hand: the retired `scripts/seed-d1.mjs` generator refuses to run, and the customer stamp applies product migrations only.

## Seed order, for a fresh local worker

1. **Local database and publication:** `node scripts/init-local.mjs --scope <tenant>`, with `--demo-data` only when demo data is wanted. Besides the database, it initializes the named tenant's configuration publication (catalog, slots, learning, Reflex, priors, proposals) from the compiled defaults, through the library initializer in `src/config/publication.ts`. A content seed has no draft to write over before this has run: no HTTP route initializes a publication (docs/kit/02-api-reference.md §4).
2. **Local worker:** `npm run dev`, with `.dev.vars` granting the seed operators that tenant (README.md, "Quick Start").
3. **Content seed, naming its tenant:** `node scripts/seed-coach-content.mjs --scope coach` publishes the Coach catalog, its slots and its learning dials. There is no default tenant: without `--scope` a seed refuses before sending anything.

**Demo step, not part of this order:** `node scripts/import-content.mjs --scope <tenant>` pulls the Meridian demo catalogue through the worker's own CMS seam and writes matching slots. Its source is a demo API, which a worker running with the tracked `AUTH_MODE = "enforced"` answers 404 by design (`src/index.ts`). It therefore runs only on a local worker started with `AUTH_MODE=open` in `.dev.vars` (and `import-content` granted the tenant in `TENANTS` there); on the enforced default it refuses, naming `AUTH_MODE` and `.dev.vars`, and writes nothing, because the Worker fetches the source before it publishes anything. `wrangler.toml` keeps `AUTH_MODE = "enforced"`.

Both init-local and the seeds (the demo import included) act on the named tenant only. A content seed reaches a deployed worker only with an operator token issued for that tenant, given as `--token` or `OPERATOR_TOKEN` (the W03 scoped tool token); it never mints one for anything but a loopback target.

## Repeat runs and scoped recovery

- **Demo seeds (D1).** `seed_001.sql` … `seed_010.sql` insert with `ON CONFLICT (…) DO NOTHING`, so an existing row is kept as it is and a missing one is added; `seed_011_geo.sql` inserts shared geography with `INSERT OR IGNORE` and resets only its own prefix-scoped cohort (`v-nc-%`, `ordnc-%`) before reinserting it. Running the seeds again changes no row, and it is also the recovery: rows a local database lost come back, and no other row changes, including other tenants' rows and shared references.
- **Content seeds.** Every write carries `If-Match "N/S/H"` from the draft it read and an `Idempotency-Key "N:UUID"` derived from that exact request (tenant, route, draft and body). A document that already holds the seeded content is left as it is, so a repeat run publishes nothing new (the importer's pull always republishes the catalog it fetched, with the same content). A run a failure interrupted (for example a storage outage that left a publication pending) is recovered by running the same command again for the same tenant: the same request over the same draft is the same operation, and the Worker finishes it instead of starting another. If a different operation holds the set, the seed stops with 409 and names the publication status and recovery routes (`GET /content/catalog/publication`, `POST /content/catalog/publication/recover`).
- **init-local.** An already initialized tenant is left untouched, and an initialization a failure interrupted is finished by running the same command again.

The acceptance test `src/units/W39/LEDGER.unit.test.ts` runs this order against a local database twice (H4) and the content seeds twice and after an interruption (H3, H4).

## Provenance

- The seed order keeps the real census provenance: after `0008_meridian_geo_cohort.sql` and `seed_011_geo.sql`, New York keeps its 14 crosswalk ZIPs (including 11215), metro 35620 keeps median household income 99,852 and home value 648,800 from "Census ACS 2024 1-yr", vintage 2024, and the Meridian cohort in that metro keeps its 640 shoppers.
- The synthetic Coach base in `seed_001.sql` … `seed_010.sql` lands 71 catalog rows, 38 metadata attributes, 3,200 profiles, 7,293 orders and 8,760 items. The committed seed files are the source; the generator that once wrote them, `scripts/seed-d1.mjs`, is retired and refuses to run.
- The Revenue Radar funnel baseline in `migrations/0003_funnel_seed.sql` is the output of `scripts/seed-funnel.mjs`; `node scripts/seed-funnel.mjs --check` confirms the committed migration is exactly what it emits. The generator prints SQL and never rewrites a migration: a changed baseline is a new migration someone writes and reviews.
