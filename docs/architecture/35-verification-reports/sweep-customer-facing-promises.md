# Independent sweep — customer-facing promises against the code

**Lens:** every promise in `docs/kit/*`, `docs/PS-Implementation-Delivery-Guide.md`,
`docs/Tapestry-Implementation-Plan.md` and `docs/content-personalization-design-tapestry.html`
against what the code does.
**Checkout:** `feature/real-time-personalization`, working tree as of 2026-09-06 (another engineer's
uncommitted work present; nothing was modified).
**Out of scope by instruction:** anything named in `docs/architecture/33-adversarial-audit-brief.md`
or `docs/architecture/34-independent-adversarial-audit.md` (F01–F35). Each finding below carries an
explicit statement of why it is not a restatement of one of those.

Scratch harnesses used for the reproductions live in
`/tmp/audit-verify/sweep-customer-facing-promises/` and were run from the repository root with
`npx tsx`. No network call, no deploy, no git state change.

---

## P01 · Content-type affinity never closes the loop: the engine learns on `type` and scores on `tags.contentType`

**Severity: blocks the pilot. Size: M.**

### Evidence

Dimension 4 of the promised registry is content-type affinity. Two customer documents describe it:

- `docs/content-personalization-design-tapestry.html:578` — "so a video-responsive shopper measurably
  accumulates *video affinity* and video assets rise in their rankings."
- `docs/content-personalization-design-tapestry.html:806` — the "what we need from your team" field
  table makes `type` **Required** and defines it as "The asset's form, from the agreed taxonomy
  (on-model, silo, detail/zoom, video…)". Its `tags` row is "Merchandising metadata: occasion,
  line/collection, season, subject…" — it never asks for the form to be repeated as a tag.
- `docs/PS-Implementation-Delivery-Guide.md:117` is the one place that gets it right: `content_format`
  maps to "`type`, **and** `tags: { contentType: [...] }`", noting "the tag is what affinity scores on".

The code splits the loop across those two fields:

- **Accumulate side.** `src/sdk/listen.ts:119` sends the impression/dwell payload as
  `{ contentId, slot, customerContentId, contentType: piece.type }` — the served decision's `type`.
  `src/reflex/contentTelemetry.ts:90` (`contentTouches`) reads the registry off the event's own
  attributes, so the accumulator key is the **`type`** string.
- **Score side.** `src/reflex/contentCompose.ts:142` scores `for (const [dim, values] of
  Object.entries(p.tags))` — only `p.tags`. `p.type` is never scored.
- **Import side.** `src/content/import.ts:58`:
  `const type = str(raw.type) ?? str(raw.contentType) ?? str(raw.kind);` — a feed column named
  `contentType` (the most natural name, and the name the PS guide's own mapping table uses for the
  tag) is consumed as the piece's `type` and is **never** written into `tags.contentType`. Nothing in
  the import path mirrors `type` into the tag.

### Reproduction

`/tmp/audit-verify/sweep-customer-facing-promises/import-contenttype.mts` — real
`normalizePiece` + `validateContentCatalog`, two feed rows written exactly as the two customer
documents instruct:

```
CMP1450: type=video  tags.contentType=undefined     (row used `type`)
CMP1451: type=video  tags.contentType=undefined     (row used `contentType`)
validates: true
```

The catalog validates cleanly with the dimension dead.

`/tmp/audit-verify/sweep-customer-facing-promises/contenttype-loop2.ts` — real
`apply`/`snapshot`/`contentTouches`/`composeContentDetailed` over the **shipped** Coach catalog
(`public/data/coach-content.json`) and the **shipped** slot weights
(`scripts/seed-coach-content.mjs:43-45`, `chero` weights `contentType: 0.15`):

```
three video_complete on CCH-004 (type=film, tags.contentType=["video"])
  affinity ->  {"contentType":{"film":0.7575}}
  chero winner -> CCH-025 type=campaign score=0 strategy=default
  candidate scores -> all 0

three video_complete on CCH-002 (type=editorial, tags.contentType=["editorial"])
  affinity ->  {"contentType":{"editorial":0.7575}}
  chero winner -> CCH-002 type=editorial score=0.114 strategy=affinity
```

Four of the 26 seeded Coach pieces are `type: "film"` tagged `contentType: ["video"]`. For those
four the two ends never meet: the strongest content signal the design document defines (video
completion, weight 2) leaves every candidate at score 0 and the page on the catalog default.

### Consequence

For any customer whose feed is built from the Solution & Algorithm document — the document they were
sent and signed off — `tags.contentType` is empty on every piece and content-type affinity scores
nothing, silently, on a catalog that imports and validates without error. Where a content team does
tag both (per the PS guide), the two vocabularies still have to be identical string-for-string; the
repository's own Coach catalog fails that for its four films. The §3/§16 acceptance bar names
content-type affinity as one of the dimensions by which "different visitors verifiably see different
content", so M4 cannot be demonstrated on that dimension. Scale: every brand, every slot that
weights `contentType`, all traffic.

### Remedy

Make one field authoritative. Cheapest correct fix: in `normalizePiece`, mirror the resolved `type`
into `tags.contentType` when the feed did not supply that tag, and on the accumulate side resolve
the served piece from the catalog by `contentId` and take its `tags` rather than trusting the wire
attribute (keeping the attribute as the fallback for pieces the platform does not hold). Then correct
the design document's §15 field table to say the form must also be a registry tag, and add a
catalog-validation warning when a piece's `type` is absent from `tags.contentType`. Add an
end-to-end test: content event → affinity → the same piece ranked first.

### Why this is not F13, F27 or F12

F13 is about **visit number and entry channel** not reaching `ShopperRead`, and about journey-stage
thresholds; it does not touch content-type affinity. F27 is about the importer dropping
`merchandising`, the `explore/consider/decide` stage words, and tag validation not checking registry
membership; it explicitly does not name the `type` ↔ `tags.contentType` key mismatch or the
`str(raw.contentType)` fallback at `import.ts:58`. F12 is about the SDK never repainting.

---

## P02 · `/api/storage/:key` is an unscoped read **and write** proxy over the ledger bucket

**Severity: blocks launch. Size: S.**

### Evidence

`src/routes/api.ts:7` mounts `api.use('/*', jwt())` — a token is required — then
`api.get('/storage/:key')` at `:9` and `api.put('/storage/:key')` at `:28` pass the caller's key
straight to `c.env.STORAGE`. There is no tenant binding, no prefix restriction, no role check.
`src/index.ts:93` mounts it at `/api`; the site-key gate covers only `/realtime/*` and
`/v1/:tenant/*` (`src/index.ts:85-86`).

The same `STORAGE` binding is the ledger: `src/ledger/writer.ts` writes decisions and outcomes under
`{tenant}/{date}/{hour}/{stream}/`, `src/learn/hourly.ts` writes the hourly aggregates and batch-ring
shards, and the day reports and lift archives live there too. One R2 bucket per environment
(`wrangler.toml` `[[env.staging.r2_buckets]]`, `[[env.production.r2_buckets]]`) serves every tenant
of the stamp. Hono decodes path params, so a percent-encoded key reaches nested objects.

### Reproduction

`/tmp/audit-verify/sweep-customer-facing-promises/storage-proxy.mts` — the real `apiRoutes`, a real
`jose`-signed operator token whose `sub` is `operator-for-coach`, and a ledger-shaped object under a
different tenant's prefix:

```
no token                     -> 401
coach operator READS ks obj  -> 200 "{\"decision_id\":\"kate-spade:x:vis-1:home:hero:0\",\"item_id\":\"cnt_a\"}\n"
coach operator WRITES ks obj -> 200
object now reads             -> "{\"decision_id\":\"kate-spade:x:vis-1:home:hero:0\",\"item_id\":\"FORGED\"}\n"
```

### Consequence

Any account with any operator token on the stamp can read every other tenant's decision and outcome
records — visitor ids, session ids, purchase values, products bought — and can **overwrite** them.
The ledger is the substrate for `GET ledger/{id}`, `GET replay/{id}`, the day report, the holdout
comparison and the customer's warehouse export. The customer-facing claims that rest on it —
`docs/content-personalization-design-tapestry.html:758` "Full data egress — the closed loop",
§12's "No black box, structurally ... complete audit trail", and `docs/kit/02-api-reference.md:163`'s
one-record-by-id lookup — cannot be defended while a single `PUT` can rewrite an object the report
sums. It is also a plain multi-tenant data-confidentiality breach on a shared stamp. Scale: every
tenant on the stamp, every day of retained ledger.

### Remedy

Delete `/api/storage` from customer stamps; it is a leftover generic proxy with no product route
depending on it (nothing in `src/routes/` or `public/console/` calls it). If a bulk read is wanted,
give it its own route bound to the caller's tenant prefix, read-only, and with the erasure tombstones
applied as `GET ledger/batches` already does. Add a negative test asserting `/api/storage` refuses a
key outside the caller's tenant prefix, and add the route to the allow-list F01 asks for.

### Why this is not F01 or F03

F01 enumerates the public/demo surfaces it found — `cdp.ts:29`, `sort.ts:81`, the agent router,
`ai.ts`, `aiScene.ts`, `experiment.ts` — and its thesis is that *unauthenticated* demo routes sit
inside the boundary; `/api/storage` is authenticated and is not named. F03 is about tenant
**selection** on ingress and about operator tokens lacking a membership model on config and identity
routes (`config.ts:123`, `identity.ts:175`); it names read/export/configuration/erasure authority.
Neither names a generic object proxy over the ledger bucket, and neither raises the write verb —
forging the records the incrementality report and the customer's export are built from is a different
capability with a different remedy (remove the route, not scope the token).

---

## P03 · ODP does not re-seed the interest vector; the documented recovery path does not exist

**Severity: blocks the pilot. Size: M to build, S to correct the document.**

### Evidence

`docs/content-personalization-design-tapestry.html:534`: "The shopper's state is durable — held at
the edge ... with every underlying event also recorded to the shopper's profile in ODP, the durable
memory. **If edge state is ever absent, it is re-seeded from ODP on the first event of the session.**"
`docs/Tapestry-Implementation-Plan.md:86` repeats the shape: "cross-session memory re-seeds at
session start in under a second." `docs/PS-Implementation-Delivery-Guide.md:18` sells ODP as
"durable memory (profile, cross-session facts, audience sharing)".

What the code reads back from ODP:

- `src/services/odpLoop.ts:361` `fetchOdpAudiences` runs one GraphQL query whose `subset` is
  `ODP_MIRRORED_AUDIENCES` (`:38`), a hard-coded five-name list — `line_tabby_affinity`,
  `silhouette_tote_affinity`, `occasion_evening_affinity`, `luxe_affinity`,
  `late_journey_ready_to_buy` — and returns the qualified **names** only.
- `src/services/odpLoop.ts:234` `refreshOdpSeedIfDue` stores that list as `odpSeed`, and
  `src/durable-objects/ShopperReflex.ts:629` merges it into the segment set. Nothing reconstructs
  `ReflexState` (the `R[d,g]`, `t` accumulators) from it.
- What is written is equally narrow: `src/services/odpLoop.ts:319` `upsertOdpProfile` sends five
  attributes — `line_affinity_tabby`, `silhouette_affinity_tote`, `occasion_affinity_evening`,
  `dominant_line`, `journey_stage`. Three scalar affinities out of a vector over seven dimensions,
  and no timestamps, so the vector could not be reconstructed from them even if something tried.
- A repository-wide grep confirms `fetchOdpAudiences` is the only ODP read on the state path.

The state that actually carries memory is the KV session record (`src/services/SessionManager.ts:151`,
`sessionTTL = 30 days`) or the shopper Durable Object. Neither has an ODP backstop.

### Consequence

The document's stated failure mode — edge state absent — restores five audience labels, not the
shopper. After the 30-day TTL, a KV eviction, a stamp re-provision (F09), or a tenant whose
audiences are not those five hard-coded Coach names, the shopper is cold and ODP does not help.
The customer's data science team will ask to see the re-seed at the M2 design review; there is
nothing to show. It also means the "durable memory" half of the ODP business case (dependency D7,
"before M4") is weaker than sold.

### Remedy

Either (a) snapshot the interest vector to the ODP profile as a versioned, timestamped attribute and
rehydrate it through `applyHistorical` when edge state is missing — the discounting machinery in
`src/reflex/identityMerge.ts` already exists and `POST /v1/{tenant}/identity/events` already does the
equivalent for warehouse rows; or (b) correct §05 and Implementation Plan §7 to say ODP re-seeds
audience membership and that interest state persists in first-party edge storage with a stated
retention, and make that retention a configured value rather than a constant in `SessionManager`.
Either way, drop the hard-coded audience list (F31's portability point applies to it too).

### Why this is not F13 or F31

F13's memory point is about **decay horizons** being demo-scale and about configurability not
substantiating days/weeks of return memory; it does not examine what ODP returns. F31 names
`odpLoop.ts:95` and `:331` for tenant-less connector identity and Coach-specific *attributes* — a
portability finding. Neither states that the documented "re-seeded from ODP" recovery path is absent
from the code.

---

## P04 · The published learn schema omits the money objective, and its lift symbols are wrong for the slot the acceptance walk points at

**Severity: blocks the pilot (data-science acceptance). Size: S.**

### Evidence

`docs/kit/03-payload-schemas.md` opens: "Every record the platform accepts, writes or returns, field
by field. Each symbol is defined the first time it appears and nowhere else." Its "learn document"
table (lines 136–153) lists `holdout`, `regional`, `policy`, `stats`, `external`, and per slot
`gamma`, `reward`, `exploration`, `autonomy`, `items`, `external.weight`. It does **not** list
`slots.{slot}.objective`, which `src/content/kinds.ts:323` accepts with values `unit | revenue |
margin` (and rejects `revenue`/`margin` unless the reward is `purchase` or `add_to_bag`).
The word `objective` appears exactly once in the whole kit, in a parenthetical listing what
`GET learn/slots` returns (`docs/kit/02-api-reference.md:158`).

The same document defines the estimator as a rate (lines 74–83): "`s` Successes on the reward,
decayed the same way", "`p₀` The slot's own rate in that cell", "`p̂` The smoothed rate:
`(s + n₀ × p₀) / (n + n₀)`", "`lift` `p̂ / p₀`, clamped to the configured range".

Under a money objective those definitions are false. `src/learn/policy.ts:63` `creditWeight` returns
the outcome's `value` (or `margin`) rather than 1, and that number is what
`src/learn/report.ts:116` adds as the success. `src/learn/stats.ts:111` `buildSnapshot` applies the
identical `(s + n0·p0)/(n + n0)` and `p̂/p₀` to it, so `s` is a sum of order values, `p̂` is
revenue-per-exposure, and `lift` is a revenue ratio — still clamped by `liftMin 0.5 / liftMax 2`,
documented as a clamp on a rate ratio.

This is not hypothetical for Coach: `scripts/seed-coach-content.mjs:58` seeds
`story: { reward: 'purchase', objective: 'revenue' }`, and `docs/kit/04-staging-connection.md:76` —
the walk a customer operator is told to perform — sends them to exactly that slot: *"Choose
'story · home': the line above the grid reads 'reward purchase weighed by revenue', and the row of
the story that featured the bag you bought shows the order's value as its success."*

### Consequence

The customer's data scientists are given a schema that tells them the learning statistic is a
success rate, and an acceptance walk that shows them a slot where it is money. They cannot configure
the objective from the published schema, cannot tell from `GET lift` alone which unit a row is in
without knowing to look for the undocumented field, and any recomputation they do from the ledger —
the promise in §12 — will disagree with the served numbers for every value-weighted slot. It also
leaves the clamp semantics undefined: a 2× ceiling on a conversion-rate ratio and on a
revenue-per-exposure ratio are different business statements.

### Remedy

Add `slots.{slot}.objective` to the learn-document table with its values, its reward precondition
and its effect; add a line to the lift block saying `s` is the sum of credited weights and that
under `revenue`/`margin` the weight is the outcome's value, so `p̂` and `lift` are per-exposure value
and its ratio; state the currency assumption and what happens to refunds. Surface `objective` and
its unit on `GET lift` and on the receipt (`explain.lift` already carries it — `src/learn/stats.ts:178`),
and label the console grid's column with the unit.

### Why this is not F19 or F23

F19 is about **changing** an objective mid-stream relabelling incompatible historical counters
(`LearnStats.ts:93/97`). F23 is about Thompson sampling's Bernoulli draw being invalid for money.
Neither says the published customer schema omits the objective entirely and defines `s`, `p̂` and
`lift` in a way that is wrong for the slot the shipped seed and the shipped acceptance walk both use.

---

## P05 · Exploration is documented as on by default and is off in every shipped document

**Severity: fix before the next customer. Size: S.**

### Evidence

`docs/content-personalization-design-tapestry.html:679`: "New or under-observed content receives a
configurable **exploration share** per slot (**default 10%**): a deterministic rotation guarantees
fresh assets accumulate evidence instead of starving."
`docs/PS-Implementation-Delivery-Guide.md:120`: "`min_impressions` → the slot's exploration `floor`
… Under-observed pieces are rotated in until they have `floor` observations … **the default is 50**."

`src/learn/explore.ts:27` does define `DEFAULT_EXPLORE = { mode: 'rotation', share: 0.1, floor: 50 }`
— the documented numbers — but the decision path never uses it:
`src/content/service.ts:221` is `const exploreOf = (slot) => learn.slots?.[slot]?.exploration ?? null`,
and `src/content/decide.ts:185-187` skips `explorationPick` when that is null.
`DEFAULT_LEARN` (`src/content/kinds.ts`) ships `slots: {}`, and
`scripts/seed-coach-content.mjs:58` sets only `reward` and `objective` per slot. `DEFAULT_EXPLORE`'s
only production reference is `src/routes/decisions.ts:165`, where it fills in the *display* floor for
`GET learn/exploring`. `docs/kit/03-payload-schemas.md:150` correctly documents the default as `off`,
so the customer set contradicts itself.

### Consequence

Out of the box nothing explores. New content accumulates no evidence, so it never leaves the
`nMin = 30` floor and its lift stays 1 forever; meanwhile pieces with no affinity signal all score 0
and tie-break to catalog order (`src/reflex/contentCompose.ts:117-119`), so cold traffic sees the
same first-listed piece indefinitely. That is precisely the starvation the design document promises
rotation prevents, and it silently caps what the learning stage can ever demonstrate. The customer
also reads two of our documents saying opposite things about a default.

### Remedy

Decide one way and make all three agree. If the promise stands, put
`exploration: { mode: 'rotation', share: 0.1, floor: 50 }` into `DEFAULT_LEARN` per slot (or default
`exploreOf` to `DEFAULT_EXPLORE` when a slot is silent) and seed it for Coach; note that F23 requires
`thompson` to stay off. If it does not, change §09 of the Solution & Algorithm document and
`min_impressions` in the PS guide to say exploration is off until a person turns it on, and say what
that costs new content.

### Why this is not F23

F23 is that Thompson mode **ignores** the configured share and returns a whole sampled ranking; it
assumes exploration is configured. This is the opposite: with the shipped configuration no mode
runs at all, and two customer documents state a default that no shipped document carries.

---

## P06 · The "one npm package, tree-shakeable" SDK does not exist

**Severity: fix before the next customer. Size: S–M.**

### Evidence

`docs/PS-Implementation-Delivery-Guide.md:73-75`: "**The SDK — DECIDED: one package, two modules** …
One npm package (+ CDN script build), tree-shakeable, browser-first". §4's P5 budgets "Customer FE
2–5 pd" against it.

`scripts/build-sdk.mjs` produces exactly two whole-SDK browser bundles —
`public/sdk/edge-personalization.esm.js` (ESM) and `public/sdk/edge-personalization.js` (IIFE) — with
`minify: false` and no per-module entry points, so nothing is tree-shakeable. The repository's
`package.json` is the platform's own (`name: "cloudflare-edge-platform"`, `main: "src/index.ts"`) with
no `exports`, no `files`, no `types`, no `publishConfig` and no publish script; there is no second
package manifest anywhere under `src/sdk/` (only a `tsconfig.json`). No `.d.ts` is emitted.
`docs/kit/00-README.md:18` and `docs/kit/01-integration-guide.md:22,37` are honest — they offer only
the two hosted files.

### Consequence

PS has a "DECIDED" line it will repeat to customers. A modern retail front end (bundled React/Next,
SSR, a CSP that forbids third-party script tags, an offline build) cannot consume a
`<script src>` global or a bare URL `import` in its bundler, and gets no types. That is integration
work the P5 estimate does not carry, discovered during the customer's freeze window rather than at
P0. It also blocks version pinning by the customer, which §2's per-stamp release-pinning story
implies they have.

### Remedy

Either publish the artefact — a small package manifest under `src/sdk/` with `exports` for
`core`/`emit`/`listen`, `types` from `tsc --emitDeclarationOnly`, `sideEffects: false`, and a
tarball produced by CI and versioned from `src/sdk/version.ts` — or amend §5 of the PS guide to say
"a hosted ESM and IIFE bundle; an npm artefact is on the roadmap", and move the packaging effort into
the P5 range. Do not leave "DECIDED" against something that does not exist.

### Why this is not F34 or F35

F34 is about SDK **lifecycle** defects (click listeners not removed on cleanup, SPA remount
double-capture) and measurement-view cardinality. F35 is repository/setup debt — stale files, README
misdirects, seed fixtures. Neither examines whether the packaged artefact the PS guide commits to
exists.

---

## Smaller notes (not raised as findings)

- `docs/kit/04-staging-connection.md:46` says the connection check proves "A call with a key for
  another brand answers 403", but `scripts/verify-origin.sh` line 7 sends the literal string
  `not-a-key-for-this-site` — an unknown key, which `verifySdkKey` rejects at 401. The cross-brand
  case the table describes is never exercised, so the M3 record will read as evidence for something
  the script did not test. This sits on top of F03 and the fix is one line in the script plus a
  second registered key.
- `src/services/visit.ts` classes `cpm`, `display` and `banner` mediums as `paid_social`. The
  Solution & Algorithm document (§06, dimension 3) enumerates its judgement calls "as built" —
  affiliate/partner → referral, untagged social → referral — but not this one, so a customer
  reconciling channel against GA4 will find paid social inflated by every display campaign. Channel
  is the dimension they called their strongest single predictor.

---

## Checked and found clean

Each of these was read against the code, and in several cases executed; the absence of a finding is
evidence.

**SDK (`src/sdk/`, `public/sdk/`) against `docs/kit/01-integration-guide.md`**
- Configuration defaults: `heartbeatMs 25000`, `reconnectMs 3000`, `hydrateTimeoutMs 1500`,
  `visitorIdKey opt_visitor_id` (`core.ts:49-52`, `identity.ts:10`) — all as §9's table.
- The emit surface exists in full: `productView`, `addToCart`, `wishlistAdd`, `purchase`,
  `contentClick`, `rendered`, `declarative`, `dataLayer` (`emit.ts:30-44,152-163`).
- The declarative attributes are the documented ones: `data-op-content`, `data-op-slot`,
  `data-op-type`, `data-op-track`, `data-op-product` (`emit.ts:88-121`).
- The GA4 default mapping covers `page_view`, `view_item`, `add_to_cart`, `add_to_wishlist`,
  `purchase` and replays what is already in the layer (`emit.ts:63-74,140`).
- `listenOnly` behaves as §4 states: declarative and automatic off (`emit.ts:84`, `listen.ts:114`),
  explicit calls and the dataLayer adapter still send.
- §1's "a late decision is applied when it lands" is implemented: after the deadline fires,
  `hydrate` still calls `apply(set)` (`listen.ts:88-94`).
- The identity assertion is byte-for-byte what §5 documents: HMAC-SHA256 over
  `tenant\nvisitorId\naccountId\nexp`, base64url without padding, `exp` at most 24 h ahead
  (`src/identity/assertion.ts:53,60,28`).

**API reference (`docs/kit/02-api-reference.md`)**
- Every route in §§1–7 exists at the documented path and method — enumerated against
  `src/routes/{decisions,identity,content,config,auth,health,realtime}.ts`. Nothing documented is
  missing.
- The thirteen event types in §1 match `src/events/actionTypes.ts` `ACTION_EVENT_TYPES` exactly.
- "A verified operator token also passes the site-key gate" is implemented
  (`src/middleware/edgeAccess.ts:120-122`); a site key belonging to another tenant on a
  `/v1/:tenant/` route answers 403 with "SDK key is for a different tenant" (`:100-102`), as
  `docs/kit/04` line 46 describes for the path-carrying case.
- "Unregistered origins receive no permission": `originAllowed` fails closed in enforced mode with
  an empty list (`edgeAccess.ts:57-65`), and both stamps ship `AUTH_MODE = "enforced"` with
  `CORS_ORIGINS = ""` (`wrangler.toml:220,223,319,322`).
- Documented constants verified: `expiresIn: 900`; the 800-object ceiling before `learn/report`
  answers 413 (`src/learn/report.ts:185`); the 1000-row history cap (`src/identity/history.ts:33`,
  route `identity.ts:159`); 410 on an erased shopper's receipts and ledger reads
  (`decisions.ts:237,424,441`); the alert cooldown of thirty minutes per tenant with a recovery
  always sent (`src/ops/monitor.ts:27,84-85,98`); `Cache-Control: no-store` on the snapshot
  (`decisions.ts:346`).

**Payload schemas (`docs/kit/03-payload-schemas.md`)**
- Every default in the learn-document table matches `DEFAULT_LEARN` (`src/content/kinds.ts`):
  holdout 0.05 with one `default` arm; regional on, `kBlend 1`, `minEvents 30`; policy
  session/direct/last with click 30 min (1 800 000 ms), add-to-bag 6 h (21 600 000 ms), purchase
  7 d (604 800 000 ms); `stats` `n0 30`, `tauLearnMs` 21 days (1 814 400 000 ms), `liftMin 0.5`,
  `liftMax 2`, `nMin 30`; per slot `gamma 0`, `reward click`, exploration off, autonomy
  `configured`, external off.
- `strategy` takes exactly the three documented values — `affinity`, `default`, `tenant-pinned` —
  and `order` increments across the whole page rather than restarting per slot
  (`src/reflex/contentCompose.ts:123,133,184-185`).
- `explain.score_final = score_base × lift^γ` (`src/content/decide.ts:175,179,267`); `identity_anchor`
  is carried on both the record and the response (`decide.ts:260,282`).
- The CSV tag grammar `line:Tabby;occasion:evening|date-night` parses as documented, and the stock
  flag reads `inStock` / `in_stock` / `ats` in Y/N, 0/1, true/false spellings
  (`src/content/import.ts:16-41`).
- Every socket frame named in §01 §6 and §03 has a server-side sender — `connected`,
  `heartbeat_response`, `personalization_update`, `segment_update`, `audience_published`,
  `odp_receipt` — the single exception being `content_decisions`, which is F12.

**Solution & Algorithm document (`docs/content-personalization-design-tapestry.html`)**
- §05's action weights are the shipped defaults: view 1, wishlist/save 2, add-to-cart 3, purchase 5;
  content impression 0, dwell 0.5, click 1, video completion 2
  (`src/reflex/core.ts:177-197`, `src/reflex/contentTelemetry.ts:56-61`).
- §05's normalization `a = R/(R+K)` and its lazy decay are exactly `affinityOf` and
  `effectiveScore` (`core.ts:233-240`); the hysteresis defaults are `thetaIn 0.6`, `thetaOut 0.45`
  (`core.ts:204-205`).
- §06 dimension 2: the visit gap is 30 minutes and buckets are `1 / 2-3 / 4+`
  (`src/services/visit.ts:30,84-87`); §06 dimension 3's six channels, and the stated judgement calls
  (affiliate and partner → referral, untagged social → referral), match `classifyEntryChannel`
  (`visit.ts:135-166`) — see the display-medium note above.
- §12's "every constant is a visible, editable parameter" holds for the reflex constants: `weights`,
  `tauMs`, `K`, `thetaIn`, `thetaOut` and their per-dimension overrides are all validated, versioned
  and patchable through `/config/reflex` (`src/reflex/configStore.ts:202-254`), and the learning
  constants through the learn document.
- The `entry / core / elevated` price bands the PS guide §7.1 names are the shipped cuts
  (`src/reflex/core.ts:168`).

**Delivery documents**
- `docs/PS-Implementation-Delivery-Guide.md:93` names `POST /realtime/session/:sessionId/preferences`
  and `POST /v1/:tenant/identity/erase`; both exist at those exact paths
  (`src/routes/realtime.ts`, `src/routes/identity.ts`).
- `docs/kit/04-staging-connection.md`'s console URLs are real: `public/learning.html` and
  `public/tuning.html` both exist.
- `scripts/verify-origin.sh` implements six of its seven documented lines faithfully (health, CORS
  preflight, a decision, the 401 without a key, an event, the socket upgrade); the seventh is the
  note above.
