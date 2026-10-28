# Parity programme, amendment 13: what the scale programme's walk and reviews found (2026-10-28) — in force

## 1. Why this amendment exists

Amendment 12's first four items are built, receipted and live-accepted (P93–P96, lane L20, R-P540–R-P542); the fifth (E22, the new visitor's first answer) waits on the owner's design decision. The walk and the delivery reviews found defects in what was delivered and two seams worth a ticket. They were told once (R-P543) and are in force on the owner's message of 28 October, morning (R-P544), in the order E25, E23, E24, E26; the owner may strike any of them.

## 2. The items

#### E25 · Catalogue loads that do not fail at random, and run faster
- **Authority:** lane L20 (R-P540): 15% of the fill loads (29 of 193) answered 503 `publication_unavailable`, nothing written, a re-send succeeding; ~200 s for a 5,000-product file. The diagnosis `S42/analyst-503/DIAGNOSIS.md` (R-P543): one storage call failing with no retry (about 1 call in 8,000), every failure mapped to one answer that hides its cause and whether anything is pending; reads strictly one at a time and writes 8 at a time with a barrier, so a 5,000-product load is ~1,250 sequential steps; the `changed` count over-counting on a fresh isolate; a refused load's objects never collected.
- **Done when:** a failed storage call on the load's path is retried once inside the request (bounded, idempotent: exact-creates and reads only); the load's calls run in a bounded pool without batch barriers; the 503 names the operation, the object kind and the storage error's number (never a key or a body) and a `state` — `nothing_written`, `pending` (recover) or `committed`; the `changed` count compares records independent of field order; the purge collects the objects a refused load left once they are older than the grace; kit 02 and kit 03 state the load protocol (file size, client timeout, read the status then recover or re-send); the live walk measures the refusal rate and the time per 5,000 products on both pair hosts, one host at a time.
- **Starts from:** `src/config/publication.ts` (the error mapping, the part and shard writes, the purge), `src/routes/content.ts` (the import path, the `changed` count).
- **Needed by:** the December test (the customer's 40,000-product loads). Two to three days.

#### E23 · The purge at scale
- **Authority:** P93's delivery review (R-P506): under its 256-call budget the purge never removes a revision whose load touched all 256 shards (storage grows by one such revision per large load; nothing lost); P95's delivery review (R-P531): a tenant whose stored learn history can never establish the salt count (an early revision purged, a retained baseline) now keeps every learn revision for good under the retention setting.
- **Done when:** the purge keeps its progress across passes so a large revision is removed over several publications; the latent delete order (shard keys queued before the parts behind them) cannot strand a part; a tenant whose salt count can never be established is told (an advisory on the operator's reads) and its learn revisions purged past a stated bound once the count is null for good, or the owner's alternative.
- **Needed by:** before the first activation (January). Two days.

#### E24 · A browser that drew while the salt version was unknown
- **Authority:** P95's delivery review (R-P531): a browser that drew its class while its tenant read a null salt version keeps null and misses every later rotation on the head-script-only path (`src/sdk/head.ts:155–158`).
- **Done when:** the head script adopts the table's number when it holds null, without treating that as a rotation; the SDK bundles regenerated within their budgets; the jsdom leg shows the next rotation repainting once.
- **Needed by:** before the first activation. Hours.

#### E26 · A malformed page-view id answered as what it is
- **Authority:** the 401 diagnosis (R-P541): a `pageInstance` outside 1–128 characters of `A-Za-z0-9_-` is accepted by the route and refused later, when a render offer is minted, as 401 "Shopper session unavailable" — a request error answered as a session failure, after the decision's work (older than the scale programme; the SDK sends a UUID).
- **Done when:** the decision routes refuse a malformed `pageInstance` with `400 Invalid page instance` before any work, as they do a malformed `arm`; kit 02 states the format.
- **Needed by:** before the first activation. Hours.

#### Text corrections (no item; by name in whichever ticket next touches the file)
Kit 03's "distinct salts" rows and gendered experiment rows; `src/content/types.ts:673–674`'s comment; kit 02's other gendered sentences; kit 02's "every other answer carries the platform's `total`" (app answers only; the Worker entry's refusals carry none); the stamps answering 404 for `edge-head.js.csp`; `scripts/latency.mjs:18`; program.json's stale `src/index.ts:67`.

## 3. The owner's decisions
| # | Decision | Status |
|---|---|---|
| 1 | E25, E23, E24, E26 in force in this order (E25 first, for the December test); the owner may strike any | in force on the owner's message of 28 October, morning: "I'm not seeing any movement, action, or work. Why are we paused? What's the status?" (R-P544) |
| 2 | E22's design (amendment 12, P97's DC1): none of (a), (b), (c) as framed — the root cause of the new visitor's record creation found and the first answer redesigned not to wait on it (the record created asynchronously, the profile used later), the safeguards kept by design | the owner, 28 October (R-P545): "What happens during the creation of that record? Does it need to be created synchronously or can it be created asynchronously? … Nothing should take 1.4 seconds." |
| 3 | The objects refused loads left on the pair's l3 are collected by the redesigned load and purge, not swept by hand | the owner, 28 October (R-P545): "Everything needs to be fixed. Stop proposing … solutions that are papering over or hiding the problem." |
