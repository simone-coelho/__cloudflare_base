# Parity programme, amendment 12: the catalogue at 40,000 products and more, and what the group B walk found (2026-10-26)

## 1. Why this amendment exists

The owner, 26 October, evening: "They can have up to 40,000 products or more. You cannot gate it to 20,000. Whatever design we discussed needs to be able to survive and be able to manage 40,000 products or more." The catalogue as built under E10 (amendment 11, P86) holds about 20,000 products: its manifest carries a one-level index of every product in one 2 MiB publication document. Lane L19 (the group B walk, R-P485) also found two product defects and two seams worth a ticket, and the first-answer timing it recorded gives the owner the evidence for the latency decision E12 left open.

## 2. The items, in the ticket file's form

#### E18 · The catalogue index for 40,000 products and more
- **Authority:** the owner's words above (recorded under E10 of the 22 October amendment, §3 row 6); the analyst's read `S37/analyst/E10-40K-SHAPES.md` ruled R-P487.
- **Done when:** the catalogue's index is sharded (256 content-addressed product shards and 256 id shards by a hash of the product id and of the record id; the manifest names the shards and stays about 55 KB at any size); a product page reads the manifest, one shard and one part; a load reads and rewrites only the shards and parts its products touch; the three collision refusals, the skip, the dry run, the per-product modes, the per-product read, the rollback (bounded by the difference, `rollback_too_large` past 900 checks) and the purge (attachments resolved before a body is deleted, bucket-local, paged, the 15-minute grace) hold across shards; a one-level catalogue is rewritten into shards by its next publication with no operator step; the ingest vocabulary resolves a parted product's ids; verified in the harness at 40,000 products on both hosts and 100,000 on the session host with the real caps; the kits state it.
- **Starts from:** `src/config/publication.ts` (the manifest, the parts, the id index, the purge), `src/routes/content.ts` (the loads, the collisions, the per-product read), `src/content/service.ts` (the one-part read), `src/units/P86/LEDGER.unit.test.ts` (the one-level shapes, R10 by name).
- **Relates to:** E2, E10. **Needed by:** the December test. Two to three days.

#### E19 · Exact `arm_draw` counts
- **Authority:** lane L19 (R-P485): the counter on the object host loses increments under bursts (a KV read-then-write after the answer, `src/content/holdout.ts:291–298`); P84 and P85's live rows are PENDING on it.
- **Done when:** the counter is a durable increment (the learn statistics object or a per-tenant object) so concurrent draws are all counted; the operator's `arm_draw` read is exact; P84 and P85 pass live at the next lane.
- **Needed by:** the December test. Half a day.

#### E20 · The salt version on long-lived tenants
- **Authority:** lane L19 (R-P485): `holdout.saltVersion` reads null on a tenant whose learn history is longer than the 24 revisions the count walks, so the head script never sees a salt rotation there.
- **Done when:** the salt version is derived without walking a bounded history (stored with the rotation, or counted over the whole history), the head script's rotated-paint rule holding on a long-lived tenant.
- **Needed by:** the December test. Hours.

#### E21 · One `total` on a door answer
- **Authority:** lane L19 (R-P485): every answer carries the platform's own `total;…;desc="Total Response Time"` entry (`src/index.ts:67`), so a first-request door answer names `total` twice beside P76's.
- **Done when:** the door's own entry has a name of its own (or the platform's entry is not repeated on the door), the kit saying which to read; P76's legs hold.
- **Needed by:** the December test. Hours.

#### E22 · The new visitor's first answer (a design decision)
- **Authority:** E12's definition (R-P438) deferred the fix; lane L19's timing split (`live/lanes/L19/records/P76-timings.md`): the session issue is the largest part of every first answer on all four targets (cold 865–1,388 ms; warm medians 941–1,065 ms; `total` cold 1,405–1,785 ms against the 1.5 s first-paint deadline).
- **Done when:** the owner decides between overlapping the decision with the session issue, changing how a new shopper's session is issued (P13 D1 reopened), or accepting the deadline's defaults for a new visitor's first view; the chosen design built and measured on the stamps.
- **Needed by:** the first activation (January). Design first; two to four days.

## 3. The owner's decisions, recorded

| # | Decision | Owner's words or ruling |
|---|---|---|
| 1 | The catalogue must hold 40,000 products or more | "They can have up to 40,000 products or more. You cannot gate it to 20,000…" (26 October) |
| 2 | The five items enter the programme `tapestry-parity-scale` in this order, E18 first; the lead proceeds on the owner's "what comes next" of 26 October; the owner may strike any of E19–E22 | the lead's proposal of 26 October, told once; the owner's requirement on E18 explicit |

## 4. What the active lead does with this (in force)

The programme `tapestry-parity-scale` is initialised from this document with the five tickets (P93–P97), strict order, E18 ACTIVE; the brief `S37/SPEC-BRIEF-P93.md` is ready; the method is unchanged (specifier → spec review → build → join → the official gate → delivery review → receipt; live rows at the next deploy round).
