# BTI parity build: the ticket list

**INTERNAL.** For Simone, as contract authority, and the remediation lead, who drafts the work orders. Written 2026-09-30. **Updated 2026-10-07** from the kickoff research investigation of current state, `docs/architecture/tapestry-requirements-extraction-2026-10-07.md`: read its section G before drafting any work order. P01, P02, P06, P09 and P10 are amended below; P28–P36 are added in section E; the order of work is at the end of this file. The parity program is not yet initialised, so the list can still grow without invalidating a receipt; after the freeze, a change goes through the owner's amendment process. The ledger refuses to render, assign or receipt any ticket until every ticket in the program has a reviewed specification and resolved decisions, so a **Decision** line blocks the whole program, not the ticket's turn: every one is settled at the freeze, from the freeze sheet (`docs/BTI-Parity-Freeze-Sheet.md`), where each carries our recommendation so the resolution is one word. **Corrected 2026-10-07 after the readiness check:** the program is 25 tickets (the vector tickets P17–P25 and P27 go to a second program when Tapestry's sample and encoder answers exist; P36 is deferred and out); the order of work has P04 before P29, P12 before P13, and no "in parallel" inside one program; three code citations were corrected (P11, P33, P34).

## What this is, and why it is separate from W16–W41

On 18 September Tapestry reversed the delivery sequence (module ordering first) and confirmed embeddings in scope. The parity document (`docs/BTI-Parity-and-Mechanism.md`) and the semantic vector design (`docs/BTI-Vector-Embeddings-Design.md`) answered that session. Their "what we add" items are **new scope**:

- Document 35 was reconciled on 6 September, before the session. Its 26 tickets, W16–W41, harden what was committed before it, so none of these items could have been in the audit.
- The remediation lead logged them on 19 September (LANE-LOG ruling R87(g)) as "new scope not in document 35", for the owner to place.
- The program frozen on 24 September kept 26 tickets. Its W28, W29 and W34 work orders state that an evaluated exploration, retained autonomy and a runtime model term would each be new scope.

**Recommended placement: a second Closure Ledger program**, not an extension of the first:

- Changing the remediation program's `ticketIds` changes every work-order hash, and the 25 receipts already filed (W16–W40) would fail closed (`tools/closure-ledger/README.md`, program fields).
- A separate program keeps the remediation's `x/26` intact and gives the parity build its own denominator, `x/25`.
- Proposed settings: program id `tapestry-parity-build`; program directory `docs/parity/delivery-control` on `rem/integration`; ticket IDs the 25 of the order of work at the end of this file, in that sequence (not numeric); `maxActive 1`; `STRICT`; `LOCAL_WITH_SEPARATE_LIVE`; the integration gate command copied verbatim from the remediation program. A frozen copy of this file and of the investigation's sections G and H is committed beside the program as the quoted authority; the parity document is cited by section number only (its text is the owner's and is never quoted into evidence).
- The vector tickets P17–P25 and P27 form `tapestry-parity-vectors`, opened when the sample (T16) and the encoder answers (T11) exist; adding them to the first program later would invalidate every receipt.
- The lead drafts the work orders from this list, and the owner freezes them.
- It starts when W41 has its receipt, unless the owner starts P01 earlier.

**How to read each ticket.**

- **Authority** is the section of our customer document that states the requirement.
- **Done when** is the observable behaviour a test proves.
- **Starts from** is where the code is today, read at `feature/real-time-personalization` `2c74ab9`, with spot checks on `rem/integration`. The specifier re-reads it at the program's base.
- **Relates to** names the remediation ticket whose outcome the item builds on and must not undo.
- **Needed by** is the phase in `docs/BTI-Phase-1-Foundation.md` that uses it.

---

## A · Module sequencing, the first assignment

### P01 · Layout configuration addressable per context

- **Authority:** parity §3.8, "the layout slot's configuration made addressable per context… it is the first thing we build"; parity §1, row 1.
- **Done when:** a merchandiser saves a module order for a context (entry channel × visit bucket) on a page's layout slot. The next decision for a shopper in that context returns that order, other contexts keep theirs, and the receipt names the configured order as the reason. It takes effect without a deployment. **Amended 2026-10-07 (extraction G-B, C1 option B):** an order may list fewer modules than the slot's `take`; a module not listed is hidden in that context and not counted as an exposure. The order is editable in the console (a per-context order editor), not only by publishing a document.
- **Starts from:** slots are keyed by page only (`src/content/types.ts`). W16 seed rules boost by channel, campaign or referrer, but cannot set an order or read visit number.
- **Relates to:** W16 (visit and channel). **Needed by:** Phase 1 (O4), live in Phase 3.

### P02 · Modules as items in a layout slot

- **Authority:** parity §3.3, steps 1–3; parity §5, row D.
- **Done when:** modules are registered with their ID, kind and journey stages. A page's layout is declared as one slot of K positions over M ≥ K registered modules. The decision returns up to K module IDs in ranked order, with eligibility, exclusions and de-duplication applied; **a module not returned is not drawn, and layout slots are measured on `rendered-v1` so a module that is not drawn is not an exposure.** **Amended 2026-10-07 (extraction G-B, C1):** the earlier wording "returns all N" never exercised selection, which is Mandeep's first problem (which modules show at all). Fixed-size selection is built today through `take`; this ticket makes it the declared contract and names what the front end does with a module that is not returned.
- **Starts from:** a piece's `type` is free text; `take` goes up to 50.
- **Needed by:** Phase 1 (O4).

### P03 · Module-level impression and engagement events

- **Authority:** parity §3.10 (2), "the SDK's `rendered` call does both once a module container is marked with its ID".
- **Done when:** a module container marked with its ID records an impression when on screen, and an engagement when used as Tapestry defines it (Phase 1 ask T8). Both carry the module ID, its position and the decision receipt, and both reach learning.
- **Starts from:** `rendered()` sends impression and dwell only. SDK content events need a `rendered-v1` slot with a `pageInstance`, and on the default `served-v1` basis SDK content clicks are dropped (`src/sdk/listen.ts`, `src/content/service.ts`).
- **Relates to:** W26 (exposure unit). **Needed by:** Phase 2.

### P04 · Pins and off-limits for single modules

- **Authority:** parity §3.3, "A module you mark off-limits is never moved. A module you pin holds its position."
- **Done when:** a pinned module stays at its configured position, any position rather than only the first, and an off-limits module never moves while the others are ranked around it.
- **Starts from:** pins fill positions 1 to k as an ordered prefix, and off-limits applies to a whole slot (`src/reflex/contentCompose.ts`).
- **Relates to:** W20 (a pinned piece reserved before ranking). **Needed by:** Phase 2.

### P05 · Position-bias correction

- **Authority:** parity §3.7, rotation of adjacent modules on about 5 percent of page views, plus a position discount; parity §7.
- **Done when:** on a configured share of page views, two adjacent modules swap places. The engine estimates each position's own effect and normalizes engagement by position. The share is a dial whose default is set with Tapestry.
- **Starts from:** the rotation mode moves the least-observed item to first until items pass the floor, and does nothing on a layout slot where every module is seen on every view (`src/learn/explore.ts`). There is no position estimate.
- **Relates to:** W26 (position on the record; the position-effect policy is a data-science value) and W28 (share zero means no reorder). **Needed by:** Phase 3.

### P06 · The order the engine would have shown, at trust dial zero

- **Authority:** parity §3.5, "From the first day the engine records, for every page view, what it would have shown and how each module performed, but the page keeps your order."
- **Done when:** each decision record on a layout slot carries the baseline order (the configured P01 order for the context, else catalogue order) beside the order the engine would have served with every term applied, and names each term that would have moved a module. **Amended 2026-10-07 (extraction G-B, C4):** the earlier wording presumed that the served order at γ = 0 is the baseline. It is not: affinity, seeds, the regional prior, stage, freshness and fatigue reorder at γ = 0, and only a layout slot that weights nothing a shopper carries keeps the baseline. The shadow is therefore recorded against the baseline explicitly, whatever the launch mode chosen under P28.
- **Starts from:** the lift is computed and shown on every served record; the alternative order is not recorded.
- **Relates to:** W27 (replay). **Needed by:** Phase 3, for the weekly readout.

### P07 · Channel and visit number before the first click

- **Authority:** parity §3.4 part 1, "Region, channel, visit number, and the population prior"; parity §1, row 5; parity §6.
- **Done when:** for a first-time visitor, channel and visit number shape the first decision through a population prior per context, beside the regional prior, and the receipt itemizes it ("population prior, paid social, first visit").
- **Starts from:** the only population prior is regional (`src/reflex/regionTrend.ts`). Channel and visit act only through learned lift or seed rules. The regional prior is off for a tenant whose published learn document omits its block.
- **Relates to:** W16, W25 (priors and cell grammar). **Needed by:** Phase 3.

### P08 · A module on several pages, pooled once, with the page as context

- **Authority:** parity §9, item 3, "keep the page out of the ID so its evidence pools once, and let the page be context".
- **Done when:** a module ID that appears on two pages can accumulate one evidence record per context, with the page as a context dimension, **as an explicit, declared policy**.
- **Starts from:** evidence is kept per slot, item and cell, and page is not a cell dimension.
- **Relates to:** W26 R2 made page part of the storage identity so nothing pools **silently**. This ticket adds declared pooling on top and must not undo that. **Needed by:** Phase 3.

## B · Dials, thresholds and identity

### P09 · Behaviour-versus-performance percentage dial

- **Authority:** parity §1, row 4; parity §5, B5; parity §7 (90/10).
- **Done when:** a per-slot percentage is readable and editable in the tuning screen, and 0 percent performance reproduces today's decisions term for term. **Amended 2026-10-07:** on a layout slot the percentage is the blend weight of P28, which supersedes the mapping onto γ there; on content slots it may remain a mapping onto γ. P09 is the surface; P28 is the mechanism.
- **Starts from:** γ per slot only. **Needed by:** Phase 3.

### P10 · Signal floor

- **Authority:** parity §1, row 5; parity §5, B6; parity §7, "three signals; the first personalized response on the fourth action".
- **Done when:** a per-tenant N, overridable per slot, with "never" allowed on a layout slot. Below N signals the shopper gets the default or context-configured decision, and the first personalized response lands on action N + 1. Existing tenants default to 0, so W16.C8.04 still holds (R87(e)). **Amended 2026-10-07 (extraction G-B, G-C):** per-slot so that a layout can stay context-only while content slots personalize, which is what makes the layout cacheable per context key (P30).
- **Starts from:** nothing yet. **Needed by:** Phase 3.

### P11 · Evidence floors per page type

- **Authority:** parity §1, row 6; parity §5, B7; parity §7 (homepage 500, product page 300; down-weight, never ignore).
- **Done when:** floors are configurable per page type. Below the floor, a piece's own performance is shrunk toward the baseline rather than ignored, and exposures-to-floor are reported against the configured floor.
- **Starts from:** an observation minimum of 30 per ladder level (`src/learn/stats.ts:20`) and a rotation floor of 50 (`src/learn/explore.ts:35`).
- **Relates to:** W25. **Needed by:** Phase 3.

### P12 · Tapestry's hashed identifier as the account identifier

- **Authority:** parity §1, row 7; parity §5, B8.
- **Done when:** the link accepts Tapestry's hashed identifier, both the first-landing hash and the hashed email, as the account identifier, and merge-never-override holds across the change from one to the other.
- **Starts from:** the signed link and merge (`src/identity/link.ts`, `src/reflex/identityMerge.ts`). **Needed by:** Phase 2.

### P13 · The identifier handshake

- **Authority:** parity §5, B9; parity §6, "the SDK-loaded hook, the call that passes your identifier, and the signed link at recognition", and "The engine issues the visitor identity itself, at the edge, on that first request… Nothing waits."
- **Done when:**
  - the SDK exposes a loaded hook;
  - Tapestry's hashed identifier can be passed before recognition, so both identifiers travel together;
  - the signed link at recognition merges;
  - the first decision is served on the first request without a separate round trip for the session.

  The specification is written first, by the Tapestry lane, for Tapestry's review (Phase 1 asks T25 and O7).
- **Starts from:** the session is its own call before the first decision (`src/sdk/server.ts`, two sequential calls). There is no SDK-loaded hook, and `identify()` always links and needs a backend-signed assertion.
- **Relates to:** W35 and W36 (session authority and containment). **Needed by:** Phase 2.

### P14 · Action weights per product type

- **Authority:** parity §1, row 8; parity §5, B11 ("add to cart for a particular product, like purses, to be different than an add to cart for a trinket").
- **Done when:** an action's weight can differ by product type, is configured without a deployment and is itemized on the receipt.
- **Starts from:** per-action weights (`src/reflex/core.ts`, `src/reflex/configStore.ts`). **Needed by:** Phase 3.

### P15 · Position bands inside one slot

- **Authority:** parity §5, B3, "position rules inside a slot: either two slots, or position bands on one"; extraction B3, property 3.
- **Done when:** positions 1–2 of a slot can run one strategy and positions 3–5 another, with one de-duplicated result.
- **Starts from:** two slots, as the workaround. **Needed by:** Phase 4.

### P16 · An objective per piece of content

- **Authority:** parity §7: the slot sets the currency; a piece may declare which event counts as its success; both are converted to the slot's currency with a value Tapestry sets. Extraction G11 and H16.
- **Done when:** a piece declares its success event, and pieces with different objectives rank in one slot through the configured conversion value. The design session with Nitin comes first.
- **Starts from:** the reward and objective are set per slot (`src/content/types.ts`, `src/content/kinds.ts`). **Needed by:** Phase 4.

## C · Semantic vectors

### P17 · The encoder evaluation on Tapestry's sample

- **Authority:** vector design §4, §7 and §11, step 2; parity §4.10.
- **Done when:**
  - dense and sparse retrieval are run per concept against Tapestry's labels;
  - the report gives precision at 5 and 10, recall at 10 and 20, overlap, dense-only finds, sparse-only finds, and quality on thin pieces;
  - it recommends the width, the text and image weighting, and the starting weight.
- **Starts from:** nothing yet. It depends on Tapestry's sample (Phase 1 ask T16). **Needed by:** Phase 1 (O6).

### P18 · Batch encoding and the packed block

- **Authority:** vector design §3, §4.3 and §11, step 3.
- **Done when:**
  - a batch job encodes changed content, modules and concepts;
  - it writes a packed 8-bit block per brand, versioned with the catalog and published as a catalog version;
  - the block loads into memory on first use, with no database call on the decision path.
- **Needed by:** Phase 4.

### P19 · The semantic term, at weight zero

- **Authority:** vector design §6 and §11, step 4; parity §4.5 and §4.9.
- **Done when:**
  - cosine similarity, floored at zero and multiplied by the slot's weight, enters the score as its own receipt line naming the encoder version;
  - its contribution is capped below the categorical terms, and it resolves after every rule;
  - weight zero reproduces today's decisions term for term;
  - it runs on its own switch.
- **Relates to:** W34, which keeps the external-model policy off with zero calls. The semantic term must not reopen that path. **Needed by:** Phase 4.

### P20 · The shopper's semantic vector

- **Authority:** vector design §5 and §11, step 5; parity §4.5.
- **Done when:** each shopper has a decay-weighted sum of the vectors of the items they touched, using the same behaviour weights and decay horizon, normalized and held on the profile. Consent, erasure and retention apply as they do to the rest of the profile.
- **Needed by:** Phase 4.

### P21 · A new item's prior from its nearest items

- **Authority:** parity §4.4, point 3; parity §5, B7, "A new item inherits a prior from similar items".
- **Done when:** a new piece with no history inherits a prior from the pieces its vector sits nearest, and the receipt itemizes it.
- **Starts from:** priors are imported per item (`src/learn/priors.ts`). **Needed by:** Phase 4.

### P22 · Concept vectors approved before publishing

- **Authority:** vector design §10: concept vectors are reviewed by a person in the approval step the enrichment proposals already use.
- **Done when:** a merchandising concept's vector takes effect only after human approval in the enrichment approval flow.
- **Relates to:** W19 and the design-time enrichment approval. **Needed by:** Phase 4.

### P23 · Search: encode, cache, time out, fall back

- **Authority:** vector design §4.3 and §11, step 7; parity §4.7.
- **Done when:** a typed query is encoded at request time behind a cache and a hard timeout. On a miss or a timeout, structured search answers, and the retrieved candidates are ranked by the engine with the same receipt.
- **Starts from:** search maps a query to structured filters through a model connector (`src/reflex/searchIntent.ts`). **Needed by:** Phase 4.

### P24 · Encoder replacement

- **Authority:** vector design §9.
- **Done when:**
  - a new encoder is pinned to a new catalog version and the corpus is re-encoded;
  - the switch is atomic, and shopper vectors are recomputed;
  - receipts written before the switch keep naming the old encoder version.
- **Needed by:** Phase 4.

### P25 · The semantic vector in the warehouse export, if Tapestry wants it

- **Authority:** vector design §12, question 2.
- **Done when:** the export carries each shopper's semantic vector, joined on the same identifiers as everything else. This is conditional on Tapestry's answer (Phase 1 ask T11).
- **Needed by:** Phase 4.

## D · Content inside the modules

### P26 · Content chosen inside each module

- **Authority:** parity §3.9, "the module becomes the slot, and its pieces become the items".
- **Done when:** a module's inner content slot is decided per shopper within the same page decision as the module order, with page-wide de-duplication and one receipt set.
- **Starts from:** content slots are keyed by page. How a content slot nests inside a layout module is for the specifier to establish at the program's base. **Needed by:** Phase 4.

### P27 · The demonstration view: both views of a shopper's taste

- **Authority:** parity §4.10: a module named for an intent ranks up for a shopper near it, with the semantic term on the receipt, beside the categorical affinities in words, "so both views of her taste can be compared on one screen".
- **Done when:** the console shows, for one shopper and one decision, the semantic term's contribution beside the categorical affinities.
- **Needed by:** Phase 4.

---

## E · From the 7 October investigation

Added 2026-10-07. Authority is `docs/architecture/tapestry-requirements-extraction-2026-10-07.md` (section C for what Mandeep said, G for the code evidence, H for the decision rows). "Starts from" was read on `rem/integration` at `b0aef94`; the specifier re-reads it at the program's base. Day figures are rough build-and-test effort for one lane, from the investigation, not dates.

### P28 · Layout base and the behaviour-and-performance blend

- **Authority:** extraction G-B ("what launch means for the layout, and the base the learned term multiplies"); document 35 N20 (lines 282, 565); parity §3.5 and §7 (the 90/10 dial).
- **Decision (H row 2), owner Simone with Nitin.** Our recommendation: on layout slots, an additive blend, score = (1 − p) × behaviour + p × performance, over a rank-derived base from the configured P01 order (else catalogue order), with p the P09 percentage. At p = 0 the configured order is served exactly; evidence can move a module that carries no tags; the move stays bounded by the lift clamps. Content slots keep base × lift^γ unless a slot opts into the blend.
- **Done when:** on a layout slot, a module with no behaviour score is moved by learned performance once p > 0; at p = 0 the served order equals the configured or catalogue order term for term, and every shopper term on the receipt is zero; the receipt itemises behaviour, performance and the blend; content slots are unchanged (W16.C7 "an exactly zero base stays zero" still holds there).
- **Starts from:** `src/content/decide.ts:372–386` (base × lift^γ); `src/reflex/contentCompose.ts:316–321` (ties fall to catalogue order); `src/content/kinds.ts:656–665` (γ and the clamps).
- **Relates to:** W16 C7, W25, W28; supersedes P09's mechanism on layout slots. **Needed by:** Phase 3, and the levers presentation in the week of 26 October. About 2 days.

### P29 · A layout reason: why the order did or did not change

- **Authority:** extraction C4 and G-B ("explaining a non-change"); H row 6.
- **Decision (H row 6), owner Simone, Nitin confirms.** Our recommendation: freeze the reason vocabulary as written below, extensible by later tickets (P04, P05, P11, P30, P31 add causes), with Nitin's confirmation as a live row; the tests assert a reason per scenario and never lock the list as complete.
- **Done when:** every layout decision set, record and receipt carries one closed reason for "unchanged" against the baseline (pinned; off-limits; holdout or consent; below the signal floor; blend or trust at zero; no level reached nMin, with the n it has and the nMin it needs; zero base; ties broken by catalogue order; nothing else eligible), or "changed" with the term that moved each module; the sentence "no interest signal yet for this shopper" is printed only when the shopper has no interest at all, and otherwise reads "no interest on the dimensions this layout weights"; an off-limits slot writes a record. The reason rides the warehouse export.
- **Starts from:** `src/learn/receipts.ts:105–178`; `src/content/decide.ts:533–573`; `src/content/service.ts:602–604`; `src/content/types.ts:397–494`.
- **Relates to:** W26, W27, P06. **Needed by:** Phase 3; shown in the week of 26 October. About 2 days; a two-visitor comparison view in the console is 1 to 1.5 days more, optional.

### P30 · Context-only layout mode per slot, with an exposure beacon

- **Authority:** extraction G-C (caching option c) and G-B ("per shopper or per context"); H row 5.
- **Decision (H row 5), owner Simone and James with Tapestry's front-end lead.** Our recommendation: a per-slot switch; the cache key is page × channel × visit bucket plus a default variant; the engine issues the key as a non-identifying header the page may use. Confirm with their front-end lead before the freeze; the render review is where it is settled.
- **Done when:** a layout slot flagged context-only ignores affinity, stage and fatigue, stops the ladder at channel × visit (optionally region), hashes exploration on context and hour, and two shoppers in the same context receive the identical order; a light per-view beacon records exposure of a cached layout so learning counts it; the answer exposes the context key as a non-identifying value; a shopper on the holdout or without consent receives the default variant.
- **Starts from:** `src/content/decide.ts:241–243, 276–298, 314–341`; `src/learn/stats.ts:36–50`; `src/learn/explore.ts:84–87`; `src/content/cell.ts:27–42`; `src/routes/decisions.ts:867` (`no-store`).
- **Relates to:** W16, W26, W28, P01, P10. **Needed by:** Phase 2 for their front-end design, Phase 3 to serve. 2 to 3 days.

### P31 · "Nothing to show": module eligibility by page signal and by context

- **Authority:** extraction G-A (per module, item 9) and G-B (C1 option C); parity §3.3, the recently-viewed row.
- **Done when:** the page can report that a module has nothing to show for this page view, and that module is neither returned nor counted as an exposure; a per-module eligibility rule by context (region, entry channel, visit bucket, stage) can be declared and fails closed; the `eligibleWhen` rule on the demo branch is the starting point, ported with the engine's own context signals.
- **Starts from:** demo branch `src/content/lifecycle.ts:37–73` at `82f41b8d`; `rem/integration` `src/content/lifecycle.ts:18–33`; `src/content/service.ts:589, 610–611`.
- **Relates to:** W20 (eligibility and refusals), P02, P03. **Needed by:** Phase 2. 1.5 to 2 days.

### P32 · Module type as a dimension, and engagement that teaches a module's tags

- **Authority:** extraction G-A (the module-type dimension) and G-B ("how do you know this module works for this user", option A); H row 8.
- **Decision (H row 8), owner Nitin.** Our recommendation: a module-type dimension of its own (reviews, user-generated, material story, craftsmanship story, recommendations, complete the look, category grid, recently viewed, editorial), kept apart from content format; an engagement with a module teaches the shopper the module's type and its other tags.
- **Done when:** the registry draft carries the module-type dimension and the catalogue diagnostics distinguish it from content format; a module engagement raises the shopper's interest on the module's type and on its other tags by the configured weight; a module without an explicit type tag no longer scores its free-text `type` as a content type silently (a diagnostic names it).
- **Starts from:** `src/content/typeAffinity.ts:12–28`; `src/reflex/contentTelemetry.ts:62–67, 111–126`; `src/reflex/core.ts:215–244`.
- **Relates to:** W16, W19, P02, P03. **Needed by:** Phase 3. 2 to 3 days after P02 and P03.

### P33 · Where a page conversion lands

- **Authority:** extraction G-B ("the objective"); the 18 September extraction G11(ii); H row 3.
- **Decision (H row 3), owner Mandeep and Nitin.** Our recommendation: engagement as the layout's goal first, with commerce reported beside it; commerce events that originate inside a module carry the module identifier (their tag plan); shared credit by position only if their data science asks for it.
- **Done when:** under the chosen policy, an add to bag or purchase that originates inside a module credits that module's layout decision; a buy-box conversion credits the layout according to the policy (module-tied only; shared across the modules in view, equal or discounted by position; or the module engaged last), itemised on the outcome record; the attribution policy can differ per slot.
- **Starts from:** `src/learn/policy.ts:188–218`; `src/ledger/records.ts:308–335`; `src/content/service.ts:165`.
- **Relates to:** W21, W26, P03, P16. **Needed by:** Phase 3. 0.5 to 2 days by option.

### P34 · First paint and hold: the in-flight answer applied, a layout held per page view, receipts keyed per slot position

- **Authority:** extraction G-C ("round trips", "mid-session"); H row 13.
- **Done when:** an acknowledged event or a socket open during the first snapshot no longer discards the answer (the SDK applies it, then refreshes); the deadline is a hard ceiling; a page may hold a layout for the page view without losing the receipts of moved modules; receipts are keyed by slot, position within the slot and item, so a selection change does not ripple into later slots; the kit's ten-line example is corrected; `node scripts/build-sdk.mjs --check` is exact.
- **Starts from:** `src/sdk/listen.ts:73, 111–121, 162, 207–222, 341–343`; `src/sdk/core.ts:662–769`; `docs/kit/01-integration-guide.md:122–123` on `rem/integration` (78–79 on the demo branch).
- **Relates to:** W35, W36, W40, P13 (P13 removes the session call; P34 fixes the race and the hold). **Needed by:** Phase 2. 1 to 2 days.

### P35 · Affinity audiences reach Experimentation: identity alignment

- **Authority:** extraction G-A ("affinity-based audiences"); H row 9.
- **Decision (H row 9), owner Mandeep with their ODP owner and the onboarding team.** Our recommendation: their hashed identifier written as a second ODP identifier beside ours (with P12), and, as the zero-build interim, the page passing our segments and interest values to their Experimentation user context as attributes.
- **Done when:** ODP profiles written by the engine carry an identifier Experimentation resolves, so a segment built on our fields targets an experiment; the page-side path is documented in the kit; nothing creates ODP fields or segments on their behalf.
- **Starts from:** `src/connectors/config.ts:165–168`; `src/services/odpLoop.ts:105–107, 368, 400–443`; `src/sdk/identify.ts:79–108`.
- **Relates to:** W41, P12. **Needed by:** Track 1, once the SDK is on their pages. 1 to 2 days.

### P36 · Vocabularies as tenant settings: channel words, visit buckets, ladder order and depth (optional)

- **Authority:** extraction G-A ("at arrival") and G-B ("the admin surface"); H rows 4 and 12.
- **Decision (H rows 4 and 12), owner Simone and Nitin.** Our recommendation: defer. Map their campaign taxonomy onto the six channel words with the campaign term carrying the detail, and revisit only if the taxonomy cannot be mapped.
- **Done when:** the channel vocabulary and classification, the visit buckets and the ladder order and depth are per-tenant, versioned settings, with a cell-grammar version bump and a prior re-export (W25); a seed-rule editor exists in the console.
- **Starts from:** `src/services/visit.ts:30–37, 121–124`; `src/content/cell.ts:44–49`; `src/learn/stats.ts:36–50`.
- **Relates to:** W16, W25. **Needed by:** Phase 5, or earlier if their taxonomy requires it. 3 to 4 days, plus 1 for the seed-rule editor.

---

## Order of work (7 October, corrected the same day)

The program's `ticketIds` in execution order, one ticket active at a time under STRICT. Every prerequisite precedes what uses it: P02 before every layout ticket; P01 before P28, P06, P29, P10, P30; P28 before P09, P29, P06; P03 before P33, P32, P05, P30, P26; P10 before P29, P30; P12 before P13, P35. The first eight carry the levers Mandeep expects in the week of 26 October and the mechanism "your page is the baseline" rests on. Every Decision line is resolved at the freeze from the freeze sheet, so nothing blocks once the program starts.

`tapestry-parity-build`, 25 tickets, reported as x/25:

1. **P02** modules as items, K of M (amended; unlocks everything)
2. **P01** per-context orders with the visible set and the console editor
3. **P28** layout base and blend (freeze sheet: the arithmetic)
4. **P03** module impression and engagement events
5. **P10** signal floor, per slot (amended)
6. **P07** channel and visit before the first click
7. **P04** pins at any position, off-limits per module
8. **P29** the layout reason (freeze sheet: the vocabulary)
9. **P31** nothing to show
10. **P05** position correction
11. **P06** the shadow order against the baseline (amended)
12. **P12** the hashed identifier
13. **P13** the identifier handshake
14. **P34** first paint and hold
15. **P30** context-only layout mode (freeze sheet: built off by default)
16. **P33** where a page conversion lands (freeze sheet: per-slot policy, module-tied by default)
17. **P32** module type as a dimension (freeze sheet: registry draft, teaching at weight zero)
18. **P09** the percentage surface
19. **P11** floors per page type
20. **P14** weights per product type
21. **P35** affinity audiences into Experimentation (freeze sheet: configurable second identifier)
22. **P08** declared pooling across pages
23. **P15** position bands
24. **P16** objective per piece (freeze sheet: configurable, absent by default)
25. **P26** content inside each module

`tapestry-parity-vectors`, opened when the sample and the encoder answers exist, in this order: **P17, P18, P20, P19, P21, P22, P23, P24, P25, P27** (P20 before P19 because the similarity needs the shopper's vector).

Out: **P36** vocabularies as settings, deferred by its own recommendation; the one-day seed-rule editor can be folded into P01 if wanted now.

---

## Not tickets

**Tapestry's configuration values**, set in Coach's documents at onboarding, not product builds:

- the learning horizon (the parity document proposes 28 days; the shipped default is 21);
- the regional prior switched on in Coach's learn document;
- the rotation share, the evidence floors and the signal floor, once P05, P11 and P10 exist.

**Documents, owned by the Tapestry lane:**

- the identifier handshake specification (with P13);
- the evidence figures re-issued at slot scope (the pool sizing page);
- the revised explainability sentence in the Solution and Algorithm document (parity §4.9);
- implementation guide v1.2 and the one-pager.

**Activation steps, done jointly with Tapestry:** raising the semantic weight on one slot (vector design §11, step 6), and raising the trust dial.
