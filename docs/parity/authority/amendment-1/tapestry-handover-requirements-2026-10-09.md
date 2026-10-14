# Tapestry handover requirements: what feeds, paints and launches the engine (9 October 2026)

Sources: the 9 October 2026 call; Nitin Tyagi's written answers to T6, T7 and T8; our 7 October extraction, Phase 1 Foundation, parity tickets, kickoff engine content, implementation guide §4 and appendix A, working notes §1.3 and §1.6; the code on `rem/integration` at `af671ce7`.

Prepared for Simone, internal.

**How to read this.** (call Lnn) is a line of the 9 October transcript, where William is "Me" and everyone else is attributed by content. (Nitin Lnn) is a line of the text extraction of Nitin's answers, table cells one per line. Code paths are on `rem/integration` at `af671ce7` (9 October, 16:01) and `kit` paths are `docs/kit/` on that branch. T1 to T34 are our Phase 1 asks, P01 to P36 the parity tickets, W-numbers the remediation tickets, and DI-1 to DI-21 the design items this document creates (§2.7). "Built" means delivered locally on `rem/integration` after an independent review; nothing here is deployed or accepted live. The parity programme stands at 4 of 25 locally (P02, P01, P28, P03), P10 active, 0 of 25 accepted live; the remediation programme at 26 of 26 locally, 0 of 26 live (`docs/remediation/RESUME.md` on that branch). W0 is the kickoff week, 12 to 16 October 2026; §4.2 gives every week's dates.

**What changed since 7 October.**

- Mandeep asked us to prescribe rather than wait: eight or ten attributes per piece of content and per module, the format, the delivery mechanism and what we expect of each team, agreed within two weeks of the kickoff, toward a first test inside 135 days (call L42, L46 to L52, L58).
- Nitin's answers arrived: 23 dimensions, 24 attributes with their values and five rules, 15 ranked behaviours and a purchase rule (Nitin L2 to L315). Most adopt as they are; §2 gives every row a verdict.
- Named on the call: Abby as point of contact for tracks 1 to 3 and Mandeep as escalation (call L76, L86); Kimia for content and module metadata (call L44); Jeremy, on Nitin's tagging team, for the events (call L60 to L62); Rob, George and Pat Mussey in front-end engineering, whose decision the rendering is (call L82 to L84); Josh to take track 3 on our side (call L72).
- On `rem/integration`: the product branch has landed, bringing `eligibleWhen`, `complements` and the `platform` seed signal (kinds.ts:125-198, 251-281), and the parity build has delivered the declared layout slot (P02), per-context orders (P01), the layout blend (P28) and module impression and engagement events (P03) locally.

---

## 1. What we need from Tapestry, and who owns it

One row per requirement, grouped by the engine capability it feeds. "Tapestry owner" names the person from the call where there is one, otherwise the role still to be named (§5.1 lists them). "Target" is the week and date from the plan in §4.2. The first test needs groups A, D, E, F1, G, H, I and J, with C3 and C4 riding the same front-end merge; group B feeds the content activation that follows, and group C also feeds track 1's affinity audiences.

| # | Requirement | Why, in one line | Engine capability it feeds | Tapestry owner | Our owner | Mechanism and format we prescribe | One-time or ongoing | Target |
|---|---|---|---|---|---|---|---|---|
| **A** | **Module sequencing: which modules show, and in what order** | | | | | | | |
| A1 | A module ID on every module of the first page, then the second | Modules are decided and returned by ID, and learning reads the same ID on the events (T12) | The declared layout slot: up to K of M registered modules in rank order; a module not returned is not drawn (P02, built; kit 03:513-524) | Front-end engineering: Rob, George, Pat Mussey (call L82 to L84); Kimia records each ID in the register (call L44) | Josh and James (render review); Simone (ID rules) | `module.<kind>.<n>`, the page left out of the ID when a module appears on several pages (Phase 1 appendix B; its evidence pools across pages only by declared policy, P08); marked on the container as `data-op-content="<module ID>"` and `data-op-slot="<page layout slot>"` (kit 03:526-527); one container per module, present in the page whether drawn or hidden | One-time per module; ongoing for every new module (call L60) | IDs W1 (23 Oct); on containers W4 (13 Nov) |
| A2 | The module register: about ten things per module (§3.2) | "What defines that so that you can use that in a recommendation engine", and reporting on which module leads to conversion (call L42) | Layout scoring (module tags times the layout slot's weights), the stage rule (`journeyStageFit`), content-format interest; reporting by module type, joined on the item IDs of the decision records | Kimia (call L44); module types confirmed by the Coach brand team (7 Oct F) | Simone (schema); SWAT loads it | JSON or CSV from our template, one row per module (§3.2, §3.5); first version by hand; we load the catalogue fields into the content catalogue (kinds.ts:35-37) and the rest into the page map and the tag plan; modules and content share one catalogue of about 2,000 pieces and 2 MiB (kit 03:196-201) | One-time per module; ongoing per new or changed module | Schema W2 (27 Oct); first page W3 (6 Nov); second page W5 (20 Nov) |
| A3 | The page map for both pages (T13): today's order, each module's rule (free to move, held at its position, never moved, may be hidden) and the page's default | The engine must know what it may move, hide or never touch, and what renders when no decision applies (guide 4.5) | Pins as an ordered prefix (W20, built); pins at any position and per-module off-limits (P04, planned); exclusions; off-limits slots; the hiding rule of per-context orders (kit 03:571-582) | The page's product owner under Abby (the director of personalization, call L76, to confirm), with the front-end lead | Simone, James | Our page-map table (Phase 1 appendix B), which we write into the slots document: `layout: true`, `take`, `pinnedPieceIds`, `excludedPieceIds`, `offLimits`; slot names are unique across pages and a page declares one layout slot (kinds.ts:692-708), so `pdp-layout`, `home-layout`. Above-the-fold modules are held by pins, which matches their rule that nothing above the fold moves (call L84) | One-time per page; ongoing on change | W2 (30 Oct) |
| A4 | Starting module orders per channel and visit (T4), with the paid-social grid result | Day-one orders before any evidence: "for paid social, this is the sequencing which works the most" (call L42) | Per-context orders on the layout slot: a channel word or `any`, times visit buckets `1`, `2-3`, `4+` or `any`; the most specific context decides; an unlisted module is hidden (P01, built; kinds.ts:328-391; kit 03:543-582) | The director of personalization with the Coach brand team (to confirm) | Simone drafts; SWAT or their tuning owner enters them in the console's order editor (P01) | A table from context to ordered module IDs, at most `take` per order; contexts beyond the six channel words wait for DI-1 | Ongoing (tuning) | Draft W3 (6 Nov); final W14 (22 Jan) |
| A5 | What counts as using each module, including the size guide and reviews opened (Nitin L283 to L290) | Module engagement is the layout's learning signal, and a considering signal (Nitin L286, L290) | Module impression (the render acknowledgement, once per page instance) and engagement (a click in the container or a declared interaction), each with module ID, position in the slot and receipt (P03, built; emit.ts:59-80; kit 03:526-532) | Front-end engineering, with Jeremy for the tag plan (call L62) | Josh, Simone | `data-op-engage` on the container: up to 16 DOM event types the module dispatches, for example `reviews:open`, `sizeguide:open` (emit.ts:59-80); a click needs no declaration; each listed in the register and the tag plan | One-time per module; ongoing | Tag plan W2 (30 Oct); merged W4 (13 Nov) |
| A6 | "Nothing to show" for a module (recently viewed with no history, reviews with none) | An empty module must not be drawn, counted or hold a position (7 Oct G-A, item 9) | P31 (planned, ninth in the order): the page reports an empty module, and per-module eligibility by context | Front-end engineering | SWAT (P31) | Until P31: the page hides the empty module, closes the gap and sends no acknowledgement, which is no exposure on `rendered-v1` (kit 03:534-537). The engine reads page-sent `ctx.*` signals only on the GET form of the snapshot (decisions.ts:785-795, 850-865) and the SDK's refresh carries only the page and the channel (listen.ts:11-15), so the signal through the SDK comes with P31 (DI-18) | One-time per module that can be empty | Hiding in the W4 merge; the P31 signal at W12 (4 Jan) |
| **B** | **Content inside the modules: content personalization, the second activation (P26)** | | | | | | | |
| B1 | A content ID that survives edits, republishing and moves (T12) | A changed ID points decisions at nothing and the default shows, silently (guide 4.2) | Content slots; content-format and theme interest; credit | Kimia | Simone | The CMS ID as `customerContentId`; our `id` may equal it; the same ID in the export, on the rendered element (`data-op-content`) and in every event (Phase 1 appendix B) | One-time per piece; ongoing | Republish stability confirmed W1; in the test set W3 |
| B2 | Content metadata per piece (§3.1) | The catalogue the engine chooses from: tags drive scoring; status and window gate eligibility (guide 4.2; kinds.ts:80-218) | The content catalogue and content slots; content-format interest (contentTelemetry.ts:111-126) | Kimia's content operations (call L44); their IT for the production job later (7 Oct D) | Simone (schema); SWAT (import, diagnostics) | Test set by hand: a CSV with the field names as columns and tags as `dimension:value` pairs separated by semicolons (kit 03:167-176). Production: a JSON array from the CMS API, pushed nightly to the catalogue import in merge mode, or a URL we pull on a schedule; at most 10,000 records and 2 MiB per import (guide 4.2) | Ongoing: every new or changed piece (call L60) | Format W2; test set W3 to W5; production job W12 to W13 |
| B3 | Approval of proposed tags for sparse pieces | Sparse is fine: proposals come from their own value list and a person approves each (guide 4.2) | Enrichment review and publication (W19; 7 Oct G-A) | Kimia's content operations | SWAT runs the proposals | Proposals inside the value list; approve, edit or reject each label in the console; only approved labels publish, as a new catalogue revision | Ongoing | From W5 |
| B4 | Restrictions by market, campaign window or licence (T15) | A restricted piece is never shown where it should not be | Status, window, the `locale` tag with slot exclusions, `eligibleWhen.regions` (kinds.ts:99-161; kit 03:178-180) | Kimia, with their legal or brand owner | Simone | Fields on each piece (§3.1) | Ongoing | W5 |
| B5 | The content sample for the embeddings evaluation (T16) | Opens the vector programme; not on the first test's path | P17 to P25 (`tapestry-parity-vectors`) | Kimia, with a merchandiser | Simone | 100 to 500 pieces with imagery; 10 to 20 concepts with the pieces that belong to each; permission to encode the imagery (Phase 1 T16) | One-time | When available |
| **C** | **Shopper interest and the vocabulary (the registry)** | | | | | | | |
| C1 | The vocabulary as a published value list: T7, revised in §2 and §3.4 | Values match exactly and by case; one thing tagged two ways is learned as two interests (guide 4.4; core.ts:466-471) | The registry: up to 32 dimensions, each reading one event field (configStore.ts:135, 167-234, 331-341) | Nitin, approver; Kimia for content values; merchandising for price bands and bestseller rules | Simone | One CSV: `dimension, value_id, display_name, synonyms, parent_value_id, applies_to, status, revision`, their five rules made columns (Nitin L243 to L248); value IDs in lower case with underscores, at most 64 characters, no control characters or angle brackets (core.ts:339-354) | Ongoing, by revision | Revision 1 approved W2 (27 Oct) |
| C2 | The one mapping table from SFCC and CMS values to value IDs | Their rule: values map through one table and are never renamed in the source systems (Nitin L247) | Every ingest path, and the vocabulary check | Nitin's team; Kimia for the CMS side, the SFCC contact for the product side; Jeremy applies it in the data layer | Simone keeps a validation copy | A CSV: `source_system, source_field, source_value, dimension, value_id`; applied in their export and their data layer before anything reaches us; synonyms resolved here (DI-9) | Ongoing | First page W3; complete W5 |
| C3 | The agreed values on every product event (T23) | We hold no product catalogue, so an event teaches only what it carries (guide 4.3; core.ts:491-506) | Shopper interest on the product dimensions; track 1's affinity audiences, which need the SDK, these values and consent, not content metadata (7 Oct G-A) | Jeremy (call L62), with the SFCC contact and a front-end engineer | Simone (registry); SWAT sets the tenant to score event-carried values, `eventAttributes: 'event-when-unknown'` (core.ts:64-71; ShopperReflex.ts:1248) | The product object of §3.3 on `product_view`, `add_to_cart`, `wishlist_add` and each purchase item. The SDK's default GA4 mapping carries only the product ID, name, price, `item_category`, brand and variant (emit.ts:85-113), so we write the Tapestry mapping for `client.emit.dataLayer({ mapping })` and Jeremy's team adds the item parameters | Ongoing | Tag plan W2; merged W4; verified W12 |
| C4 | Identifier parity (T24), with master or variant decided once | Credit and recognition join on product IDs; an unknown ID teaches nothing (guide 4.6) | Credit through `featuredProductIds` and `complements`; the `unrecognized` diagnostic (kit 02:96-111) | The SFCC contact, with Jeremy | Simone | `productId` is the SFCC master product ID on every event and in every content record; `variantId` travels beside it; their GA4 `item_id` checked against it | One-time; audited on real traffic | Decision W2; verified W12 |
| C5 | A snapshot of the SFCC catalogue | To agree the value list from the values in use, check parity and size the starting audiences; it is not loaded into the engine (guide 4.3) | Vocabulary agreement; the parity check | The SFCC or commerce data contact (T23, to name) | SWAT | Mandeep asked whether we expect "an MFT file, a CSV file" (call L52): a CSV with one row per master product, its variants and the T7 attributes as SFCC holds them, or SFCC's catalogue export as it is, through their MFT | One-time; again at vocabulary revisions | W3 (6 Nov) |
| C6 | Price-band dollar ranges, and whether they differ by category (Nitin L211) | The band cannot be set or checked without them | `priceBand`: their label on events (preferred) or derived from price with cut points (configStore.ts:191-210) | Merchandising | Simone | Their label on each product event, computed in the mapping table; the price beside it | One-time; on change | W2 |
| **D** | **Behaviour events: what the engine learns from** | | | | | | | |
| D1 | The tag plan: every T8 behaviour mapped to an event (the full mapping is §2.4) | "Nitin also owns the tagging team... what work is needed from them? How will the data flow to you?" (call L60) | Interest by behaviour weight; the visit's journey counters; outcome credit; module learning | Jeremy (call L62) with a front-end engineer; Nitin owns the team (call L60) | Simone (mapping); Josh | Their data layer and Google tag manager (call L60) push `search`, `filter_applied`, `product_dwell`, `video_view`, `remove_from_cart` and `gift_signal` as custom events (`type: custom`, the name in `data.event`; wire.ts:16-31), and `product_view` (quick view included), `add_to_cart`, `wishlist_add`, `purchase` and `page_view` with the page type; the page calls the SDK for `content_click`, `content_dwell` and `video_complete`; the render acknowledgement and module interactions come through `rendered()` and the container marking (A5); the SDK forwards the data layer through its adapter with our mapping (emit.ts:101-113); the table follows kit 01:9-17 | Ongoing: new events with new modules | Walk-through W1 (T20); agreed W2 (T21); merged W4; QA W12 |
| D2 | Their viewability and thresholds: impression 50 percent in view for 1 second; dwell 20 seconds on a PDP and 30 on editorial; video view at 3 seconds; completion at 75 percent (Nitin L275 to L282, L303 to L310) | They set the denominators, fatigue and engagement rates (Nitin L310) | Exposure unit (`rendered-v1`), dwell, the video events | Front-end engineering (the video player's hooks); Nitin (definitions) | Simone; SWAT (SDK) | Their player fires video view and completion; the SDK measures dwell and viewability; the gaps are DI-13, DI-14 and DI-15 | One-time | Decision W2; built in sequence |
| D3 | The conversion event (T22), confirmed and sent once per order (Nitin L271 to L274) | It connects decisions to sales, and the holdout comparison reads it (Phase 1 T22) | Outcome credit; the deciding stage; the purchase rule (DI-12) | The commerce or analytics owner, with Jeremy | Simone | `purchase` sent from the confirmed order (kit 01:16): `orderId`, `value`, `currency`, `items[]` of `{ productId, variantId, quantity, price }` with the §3.3 values; sent once per order on their side, since event identity adds no business-order uniqueness (kit 02:77; DI-17) | Ongoing | Merged W4; verified W12 |
| D4 | The module ID on commerce events that start inside a module | So an add to bag made in a module credits that module's layout decision (7 Oct G-A; P33) | Attribution (P33, planned) | Jeremy, with front-end engineering | Simone | `moduleId` and the module's `decisionId` on `add_to_cart` and `wishlist_add` when they start inside a module container | Ongoing | Field in the W4 merge; P33 reads it |
| **E** | **Arrival context: the first paint, before any click** | | | | | | | |
| E1 | A campaign tagging convention | The channel is classified once per visit from `utm_medium`, `utm_source` and the referrer into six words fixed in code (visit.ts:36-37, 412-474); source platform is matched on the referrer host or a host-form `utm_source` (visit.ts:374-378) | The channel (first level of learning, P01 contexts, seed rules); source platform and campaign keyword as seed rules (kinds.ts:251-318) | Their marketing operations (to name), with Jeremy | Simone | One page (§2.5): their nine channels as `utm_medium` values; source platforms as `utm_source` written as the network's domain (`tiktok.com`), or as a token once DI-2 lands; a `utm_campaign` naming rule for brand and non-brand search and for the collection in the ad, read once DI-1 lands. Their current UTM values are checked against the classifier at the walk-through, so most campaigns need no change | Ongoing: every new campaign | Agreed W2; in live campaigns by W14 |
| E2 | The page type on every `page_view`, and the page name on every snapshot | Landing page type is part of their entry context (Nitin L13, L166 to L168); the page name selects the page's slots | Page slots; landing page type (DI-6) | Jeremy, with front-end engineering | Josh | `page_view` with `path` and `pageType` (homepage, category, product, editorial); the snapshot's `page` as named in the slots document (`home`, `pdp`) | One-time; ongoing per new page type | W4 |
| E3 | Nothing to send for region, device, time of day, recency, visit number or stage: we derive them | The page sends only its name and the consent choice (7 Oct G-A) | Region from the IP (cell.ts:15-20); OS family from the request (platform.ts:19-45); visit number with a thirty-minute rule (visit.ts:24-30, 226-235); stage from behaviour; device class, recency and time of day are DI-3, DI-4 and DI-5 | Nitin confirms the values (§5.2) | Simone | Derived at the edge; their only part is confirming the values and approving return recognition (F3) | n/a | Values confirmed W2 |
| **F** | **Identity and memory** | | | | | | | |
| F1 | The backend-signed statement at sign-in (T25) | Without it any visitor could claim an account; with it, anonymous history and the account merge (guide 4.7) | Identity link and merge; interests restored from ODP at sign-in (W41; kit 02:600-646) | Their backend engineer (to name) | Simone writes the handshake specification (O7), with P12 and P13 | An endpoint on their backend that signs `tenant`, `visitorId`, `accountId` and `exp`, joined by newlines, with HMAC-SHA256 and the brand's identity secret, base64url-encoded, `exp` at most 24 hours ahead (guide 4.7; assertion.ts:13-32, 54-55); the account ID it signs is their hashed identifier (F2, P12); the page calls `client.identify(accountId, { getAssertion })` after its own login succeeds and `client.logout()` at sign-out (SDK README); the secret travels only through a separately approved channel (kit 04:28) | One-time | Specification reviewed W3; merged W4; verified W12 |
| F2 | How their hashed identifier is formed (T26) | It becomes the account identifier so our records and their warehouse join (P12); it can travel before sign-in (P13); it is how an arrival from email or SMS could be recognized on site (call L56) | P12 and P13 (planned, twelfth and thirteenth in the order) | Nitin, or the identity owner Nitin names | Simone | A written note: the first-landing hash and the hashed email, how each is formed, and where each is available to the page | One-time | W2 |
| F3 | Return recognition for shoppers who are not signed in: mode, window, purpose, retention approval | With no continuity block published, a return after the session capability expires (at most 24 hours, renewed while active) is a new shopper (kit 02:694; sessionCapability.ts:14; guide 4.7), so visit number, recency and repeat views reset for anyone not signed in (Nitin L17 to L28, L267 to L270) | Visit number, recency, interest across visits | The privacy owner (T33), with Nitin | Simone; SWAT publishes the block once approved | A written choice of `direct` or `broker` mode, a finite window, the covered purpose and the retention approval for that purpose; we publish the `continuity` block on the reflex document (core.ts:81-115; kit 02:727, 743) | One-time decision | Decision W5; published before W14 |
| F4 | ODP access (T27) | ODP is the long-term memory and where their other teams use the engine's interests (Phase 1 T27; notes position 28) | Event forwarding, profile fields, audience read-back, restoration at sign-in | Their ODP owner (to name) | The onboarding team (track 1), with Simone | The ODP API host; a key for the Coach instance through the approved secret channel, held as a deployment secret named `CONNECTOR_SECRET_...` (connectors/config.ts:10, 41-43); which instance receives test traffic. Entering the secret is a deployment change made with the owner's authority | One-time | W3 |
| F5 | The ODP identifier, fields and segments (T28) | Profiles must join theirs, and their teams see the engine's interests where they already work | The connector's `identityNamespace`; `actions` (up to 64, up to 32 fields each); `profile` fields (up to 100: an interest as dimension and value, a dimension's top value, or the journey stage); `audiences` (up to 100) (connectors/config.ts:37-43); P35 aligns the identity with Experimentation | Their ODP owner | The onboarding team, with Simone | We propose the fields from the value list; their ODP owner creates or approves them and builds segments on them; nothing creates ODP fields on their behalf (7 Oct G-A) | One-time; ongoing per value worth mirroring | W5 |
| F6 | Privacy approval to forward events and scores to ODP (T29) | Forwarding sends behavioural data to another system, even their own | ODP forwarding | The privacy owner | Simone | Written approval inside the privacy review | One-time | W14 |
| **G** | **Consent and retention** | | | | | | | |
| G1 | The consent choice, posted by the page | The engine reads two choices, tracking and personalization; with none recorded both are off (consent.ts:1-30) | Every decision and every write | The privacy owner decides; front-end engineering wires their consent tool | Josh, Simone | Their consent tool posts both choices through the SDK on load and on every change; the edge records a signed instruction that lasts 30 days (consent.ts:17); absent or expired is off; a cookie can withdraw a choice and never grant one (kit 01:5) | One-time wiring; ongoing as shoppers choose | Merged W4 |
| G2 | What happens per market when a shopper declines (T33) | Their defaults, or a non-personalized answer (guide 4.8) | The default arm | The privacy owner | Simone | A written decision per market | One-time | W5 |
| G3 | Retention per data category (T33; Phase 1 appendix B) | Each category is kept only for its agreed period | Profile, identity records, decision ledger, attribution state, hourly aggregates, recovery records | The privacy owner | Simone | A period per category, in writing | One-time | Sign-off W14 |
| G4 | A security reviewer, and the scope of the review (T33) | Both reviews close before shoppers see personalization (Phase 1 T33) | Production launch | The security reviewer (to name) | Simone; SWAT answers the review | Named at the kickoff; the review runs through the freeze | One-time | Named W0; sign-off W14 |
| **H** | **Network and environments** | | | | | | | |
| H1 | Origins per environment, hostnames per brand, and the first-party subdomain decision (T30) | The platform answers only registered origins and reads the brand from the hostname (kit 04:21-28) | Cross-origin permission; brand mapping | Their platform or network team (to name) | SWAT | The https origins per environment and each host's brand; yes or no on a subdomain such as `edge.coach.com`, early, because DNS and certificates take lead time | One-time per environment | W1 |
| H2 | Content security policy and the live connection (T31) | A blocked script means defaults; a blocked WebSocket means decisions without live updates (Phase 1 T31) | SDK load; the live channel | Their platform, network and security teams | SWAT | `script-src` our script host; `connect-src` the platform host over `https:` and `wss:`; the CDN, proxy and WAF pass the WebSocket upgrade with its `Sec-WebSocket-Protocol` values `shopper-session-v1` and `sdk-key-v1.<key>` (kit 04:55); the site key travels as `X-SDK-Key` (kit 04:61-62) | One-time per environment | Lower environment W2; production configuration in the W4 merge |
| H3 | The connection check from inside their network (T32) | It proves, from where their pages run, that a page can get a decision, send an event and hold the live connection (kit 04:13-15) | Readiness | A network engineer (to name) | SWAT | `bash scripts/verify-origin.sh <platform host> <origin> <site key> coach`, run by both sides (kit 04:40-56) | One-time; again after the freeze | W2; again W12 |
| H4 | Console users and roles (T34) | The tuning screen and the learning console | Tuning, starting orders, evidence | Abby's team: the tuning owner and analysts | SWAT creates the accounts (O1) | Names and roles | One-time | W3 |
| H5 | Their lower environment for integration, with access and a window | Integration and the scripted run happen there (Phase 1 §5) | Integration | Front-end engineering and their platform team | SWAT | Its origins (H1) and the dates it is open | One-time | Window agreed W2; used W12 |
| **I** | **Front-end rendering: track 3, whose design is the track's joint decision** | | | | | | | |
| I1 | The SDK on their pages (T19) | It opens the session, sends the events, fetches decisions and holds the live connection (Phase 1 T19) | Everything above | Front-end engineering: Rob, George, Pat Mussey (call L82 to L84) | Josh, James | One script or module, `createClient({ tenant: 'coach', brand: 'coach' })` (SDK README); a pinned version or the unversioned path, decided at the render review | One-time; versions ongoing | Merged W4 |
| I2 | Drawing the page from the returned order, behind their own switch (T18; notes position 19) | The one front-end change every activation depends on; returning today's order changes nothing until launch | The layout slot's list is the sequence; a module not returned is not drawn; every drawn module is acknowledged (kit 03:513-532) | Front-end engineering | Josh, James, Simone | Read the layout slot's list, render the modules in that order, hide those not returned and close the gap, acknowledge each drawn module; the switch stays off in production until launch, and meanwhile the engine is configured to return today's order (7 Oct G-C) | One-time | Scope at render review 2 (W2); merged W4 |
| I3 | A default per slot, and a deadline | The page never waits on us: on an empty list or past the deadline (1.5 seconds by default, configurable) its own default renders (SDK README) | Graceful absence | Front-end engineering | Josh | Defaults kept in the initial HTML and restored on an empty list | One-time | Merged W4 |
| I4 | The render pattern per placement, the cache key and the performance budget (T17) | "These are Rob George's decision" (call L84); performance is measured as Core Web Vitals, LCP, CLS and INP, and nothing above the fold may shift (call L84) | What the engine offers the design: a pinned prefix for above the fold (W20, built); a decision before HTML through the server bridge (`src/sdk/server.ts`, source only, acceptance open); a reorder in the browser; layouts that vary by context only, cacheable per context (P30, planned) | Front-end engineering, meeting our Josh, James, Simone and Harrison West (call L84) | Josh, James, Simone | The track's joint recommendation per placement, which is not ours to set (call L84). Their practice of making personalized sections uncacheable (call L84) means the first test does not wait on P30 | One-time per placement | Problem stated W0; recommendation W2 |
| **J** | **Measurement and launch** | | | | | | | |
| J1 | The primary metric in writing, with the secondaries named (T3; notes position 22) | Tapestry chooses what success means; the layout learns against the reward set on its slot (kinds.ts:937-942) | Slot reward and objective; the readout | Mandeep, accountable, with Abby and their analytics lead (to name) | Simone | One page: the metric as their analytics defines it, the secondaries, and the layout's reward; we recommend module engagement first with commerce reported beside it (7 Oct H) | One-time | Draft W5; in writing W14 |
| J2 | The holdout share, approved before the first personalized page (notes position 22) | Traffic that ran without a holdout cannot be re-run (notes position 21) | The holdout arm on every decision (5 percent by default, kinds.ts:1005) | Mandeep, with Abby | Simone | A share between 5 and 10 percent, in writing | One-time | W14 |
| J3 | Where the arm-tagged records land, and who computes the comparison | The comparison is computed on their side, on their numbers (notes position 8) | Warehouse delivery to Snowflake (connectors/config.ts:78), track 1's connector | Their analytics lead; Snowflake through track 1 (call L54) | The onboarding team; SWAT | Decision and outcome records, each carrying its arm, delivered to their Snowflake | One-time | W12 |
| J4 | A named tuning owner (guide 4.11) | Someone on their side owns the weights and orders after launch | Console tuning | The director of personalization (to confirm, call L76) | SWAT supports | A person with console access | Ongoing | W14 |
| J5 | A release slot and a staged ramp | The switch goes on in production for the test share | Launch | Front-end engineering, with Abby | SWAT: the production stamp provisioned and verified through its APIs, with the owner's deploy authority | A date in their release calendar | One-time | W15 |
| **K** | **Owners per track, and the programme** | | | | | | | |
| K1 | Track 1, what can be activated now: an owner | Mandeep wants a point of contact per track (call L52) | Affinity audiences need the SDK, product values on events and consent, not content metadata (7 Oct G-A) | To name; Abby is the point of contact (call L86); Seth and Kelly's team for the business side (7 Oct B) | William and Sara; the onboarding team and Harrison's team (kickoff note for the account team, line 25) | n/a | n/a | W0 |
| K2 | Track 2, content and data: owners | "This is not a one-time activity" (call L60) | Groups A to E | Kimia for content and module metadata (call L44); Jeremy for the events (call L62); Nitin over both (call L44, L60) | Simone | n/a | Ongoing | W0 |
| K3 | Track 3, front-end engineering: an owner who says "we are owning it" (call L86) | The rendering decision is theirs (call L84) | Groups A, G1, H and I | Rob, George, Pat Mussey (call L82 to L84) | Josh (call L72), James, Simone | n/a | n/a | W0 |
| K4 | Track 4, the engine | Not opened at the kickoff (call L52) | n/a | Mandeep, Nitin | Simone | n/a | n/a | Document 21 to 23 Oct; levers session in the week of 26 Oct (7 Oct D) |
| K5 | A programme manager on each side, and the cadence | Mandeep asked for a programme manager per side and a 30-minute programme review every two weeks with red, yellow and green per track (call L36, L74) | n/a | Their programme manager (to name, call L36) | Sara Desmond, with Kim Harris (call L64) | n/a | Ongoing | W0 |
| K6 | The freeze dates and the exception process (T5); the first page (T2) | The pre-freeze merge is the critical path | n/a | Release management and front-end engineering; Mandeep for the first page | Sara | n/a | One-time | Freeze W0; first page W2 |

---

## 2. Nitin's T6, T7 and T8 against the engine

Verdicts: **Adopt as is** means the engine does it today, with configuration only. **Adapt** means it works with a change of convention or configuration on one side. **New** means planned work: the ticket, or the design item in §2.7.

### 2.1 T6: the dimensions the engine scores on

| # | Dimension (Nitin) | Verdict | Against the engine | Ticket or design item |
|---|---|---|---|---|
| 1 | Entry channel: the channel, source platform, campaign, the collection or product in the ad, the search keyword theme and the landing page type (Nitin L11 to L16) | **Adapt**; parts **new** | Six channel words fixed in code (visit.ts:36-37, 121-125), classified once per visit from `utm_medium`, `utm_source` and the referrer (visit.ts:412-474); the first level of learning (stats.ts:37-50) and half of every P01 context (kinds.ts:356-360). Source platform, the campaign keyword and the OS family act at first paint as seed signals (kinds.ts:251-318; decide.ts:445-451). `utm_campaign` and `utm_content` are not read on the decision path (visit.ts:39-53), so the collection in the ad reaches the engine today only as an exact `utm_term`. Landing page type is not an arrival signal | §2.5; DI-1 (P36), DI-2, DI-6 |
| 2 | Visit number (Nitin L17 to L22) | **Adopt as is** | Buckets 1, 2-3 and 4+ are theirs exactly (visit.ts:226-235; cell.ts:44-49), with a thirty-minute idle rule (visit.ts:24-30); the second level of learning; P01 contexts (kinds.ts:331). A shopper who is not signed in and returns after the session capability has expired (at most 24 hours, renewed while active: guide 4.7; sessionCapability.ts:14) counts as new until return recognition is published (kit 02:694) | F3 |
| 3 | Recency (Nitin L23 to L28) | **Adopt** for "recent behavior dominates"; **new** as first-paint context | Every interest decays (a 14-day horizon by default, per dimension if wanted; core.ts:245-264, 276-283), so recent behaviour already outweighs old. The last visit time is stored (visit.ts:160-176), but no recency bucket is derived or used | DI-4; F3 |
| 4 | Location (Nitin L29 to L34) | **Adopt as is** | Region from the edge's IP geolocation, as `US-NY` (cell.ts:15-20); the fourth level of learning; the regional population prior on a new shopper's base, on by default (kinds.ts:1006). Needs tracking consent. State level, not "Northeast" | §5.2 |
| 5 | Device (Nitin L35 to L40) | **Adapt** for seed rules; **new** as an order and cache context | The request's OS family, `ios` or `android`, is a seed signal (platform.ts:19-45; kinds.ts:281); mobile against desktop is not read, and device is neither a P01 context nor a level of learning. T6 names tablet; T7 lists mobile and desktop | DI-3; §2.6 |
| 6 | Time of day (Nitin L41 to L46) | **New** (their priority: low) | Nothing on the decision path reads local time; the request context reads country and region only (cell.ts:12) | DI-5; §2.6 |
| 7 | Journey stage (Nitin L48 to L57) | **Adopt** exploring, considering, deciding; **adapt** the thresholds; **new** post-purchase | Derived per visit from a published threshold block over six counters: interactions, product views, purchases, cart adds, wishlist adds and dwell (JourneyStage.ts:164-198). Reported as `exploring`, `thinking`, `deciding`; their "considering" is our "thinking", stored as `mid` (JourneyStage.ts:136-151), and content accepts "considering" (kinds.ts:65-78). The third level of learning. Their considering signals (repeat views, reviews, size guide, comparing) and deciding signal (checking shipping) are not counters. A purchase marks deciding and closes the visit's journey (kit 02:124-133); there is no post-purchase stage | DI-7 |
| 8 | Gifting intent (Nitin L58 to L63) | **New** (their priority: low) | No gifting signal on the shopper; the search interpreter's gift filter applies to one query only (searchIntent.ts:11) | DI-8 |
| 9 | Category affinity (Nitin L65 to L70) | **Adopt as is** | Registry dimension `category`, from product events and from content that carries it; category tiles rise in a grid that is a content slot of tiles, and the sort endpoint ranks SFCC's candidates by it (notes §1.8) | §3.4 |
| 10 | Product type affinity (Nitin L71 to L76) | **Adopt as is**; the purchase damping is **new** | Registry dimension `productType`, its parent a category (their rule 3). For "You may also like" the sort endpoint ranks SFCC's candidates by these interests (notes §1.8); for "Complete the look" the `complements` preference serves what completes the product on the page (decide.ts:330-341) | DI-12 |
| 11 | Collection affinity (Nitin L77 to L82) | **Adopt as is** | Registry dimension `collection` (the default registry's `line`, core.ts:203-220), from product events and content; also the seed tag for the collection in an ad | DI-1 for the ad |
| 12 | Shopper style (Nitin L83 to L88) | **Adopt as is** | Registry dimension `style`; their 35 percent ranker weight becomes a slot weight on the content slots (kinds.ts:491-496) | n/a |
| 13 | Color affinity (Nitin L89 to L94) | **Adopt as is** | `color`, by family | n/a |
| 14 | Material affinity (Nitin L95 to L100) | **Adopt as is** | `material`, from product events only, since T7 applies it to products | n/a |
| 15 | Price affinity (Nitin L101 to L106) | **Adopt as is** | `priceBand`, their labels entry, core and aspirational replacing entry, core and elevated (core.ts:209-214); their label on events, or derived from price with cut points (configStore.ts:191-210) | C6; §5.2 |
| 16 | Full-price against sale affinity (Nitin L107 to L112) | **Adopt as is** | `priceStatus`, from product events, `filter_applied` and the sale page. To decide whether value messaging or sale content appears, sale content carries the tag too, while T7 applies it to products only | §5.2 |
| 17 | Occasion affinity (Nitin L113 to L118) | **Adopt as is** | `occasion`, several values per item (`multi`, core.ts:30-32) | n/a |
| 18 | Size affinity (Nitin L119 to L124) | **Adapt** | Bag size (`bagSize`) is a product value and travels on every product event. Shoe and ready-to-wear size (`size`) is chosen at the variant, so it travels only on add to cart and purchase; otherwise every product view would teach a size nobody chose. Badges and facets read the interest values the page receives on each update (types.ts:197-206) | §3.3 |
| 19 | Gender affinity (Nitin L125 to L130) | **Adopt as is** | `gender`: the assortment an item belongs to, never the shopper's gender, exactly as they define it; the privacy owner should confirm the field's name if it is mirrored to ODP | F5 |
| 20 | Content format affinity (Nitin L131 to L136) | **Adopt as is** | `contentType`, the dimension the engine already learns from content engagement by reading the piece's catalogue tag (contentTelemetry.ts:111-126; kit 03:387-401); it holds both their format list and their imagery list | §3.4 |
| 21 | Content theme affinity (Nitin L137 to L142) | **Adopt** the dimension; **new** how engagement teaches it | `contentTheme`. Today a content event teaches the catalogue's format, and only the other values the event itself carries (contentTelemetry.ts:102-126) | DI-10 |
| 22 | Inventory (Nitin L144 to L149) | **Adopt** as a rule, not a score | `inStock: false` removes a piece from every decision (kinds.ts:199; lifecycle.ts:71-73); product availability stays with SFCC, whose candidates the sort endpoint keeps (guide 4.3). Low stock for deciders only: the page reads the shopper's stage on every update (`journeyStage`, types.ts:204). Back in stock to viewers: their recently-viewed module, and email through ODP (track 1) | §5.2 thresholds |
| 23 | Bestseller (Nitin L150 to L155) | **Adopt** as a rule, not a score | With no signal the engine serves catalogue order, marked `default` (kit 03:69); below the signal floor the default or context order serves (P10, active); their export can order pieces by bestseller; SFCC's bestseller sort is the order the sort endpoint keeps at zero affinity (notes §1.8); it never overrides affinity once affinity exists, as they ask. A piece's merchandising signals today are season, promotion and margin (kinds.ts:162-172) | DI-19 (optional) |

### 2.2 T7: the attributes and their values

| Attribute (applies to) | Their values | Verdict | Engine key and treatment | Ticket, design item or question |
|---|---|---|---|---|
| Entry channel (visitor; Nitin L160 to L162) | paid social, paid search (brand), paid search (non-brand), organic search, email, SMS, affiliate, referral, direct | **Adapt**; SMS and the brand split **new** | Six words today; the mapping is §2.5 | DI-1 (P36) |
| Source platform (visitor; L163 to L165) | Meta, TikTok, Pinterest, Snapchat, YouTube, Google, Bing, other | **Adapt** | `referrer_network` seed rules name each network by its domain (visit.ts:269-288, 362-366) and match the referrer host or a host-form `utm_source` (visit.ts:374-378); Meta is `facebook.com` and `instagram.com`. A seed signal only, not a level of learning | DI-2; DI-1 if learning by platform is wanted |
| Landing page type (visitor; L166 to L168) | homepage, category page, product page, editorial or campaign page | **New** as an arrival signal | Each page's own slots already decide that page; the landing type is not kept for the later pages of the visit | DI-6 |
| Visit number (visitor; L169 to L171) | first, second to third, fourth and later | **Adopt as is** | `1`, `2-3`, `4+` (cell.ts:44-49) | F3 |
| Recency (visitor; L172 to L174) | same day, within 7 days, 8 to 30 days, more than 30 days | **New** | Derivable from the stored last visit (visit.ts:160-176) | DI-4 |
| Device (visitor; L175 to L177) | mobile, desktop | **Adapt**; **new** as a context | The OS family `ios` or `android` is a seed signal today (platform.ts:19-45) | DI-3; tablet in §5.2 |
| Time of day (visitor; L178 to L180) | morning, afternoon, evening, night, in the shopper's local time | **New** | n/a | DI-5 |
| Journey stage (visitor; L181 to L183) | exploring, considering, deciding, post-purchase | **Adopt** three; **new** post-purchase | `exploring`, `thinking` (their considering), `deciding` (JourneyStage.ts:136) | DI-7 |
| Category (product, content; L184 to L186) | bags, small leather goods, shoes, ready-to-wear, jewelry, accessories, watches, fragrance | **Adopt as is** | `category` | n/a |
| Product type (product, content; L187 to L195) | per category, as listed; watches and fragrance still to define | **Adopt as is** | `productType`, each value's parent a category (their rule 3) | §5.2 (watches, fragrance) |
| Collection or product line (product, content; L196 to L198) | Tabby, Brooklyn, Teri and the rest | **Adopt as is** | `collection` | §5.2 (the full list) |
| Style (product, content; L199 to L201) | classic, contemporary, minimalist, maximalist | **Adopt as is** | `style` | n/a |
| Color (product, content; L202 to L204) | black, brown or tan, neutral, bright or seasonal, metallic, print or pattern | **Adopt as is** | `color`, by family; SFCC colours map to families in the mapping table (C2) | n/a |
| Material (product; L205 to L207) | smooth leather, pebbled leather, glove tanned leather, signature canvas, suede, quilted, shearling, other | **Adopt as is** | `material` | n/a |
| Price band (product, content; L208 to L211) | entry, core, aspirational; dollar ranges to be set by merchandising | **Adopt as is** | `priceBand` | C6; §5.2 |
| Price status (product; L212 to L214) | full price, sale | **Adopt as is** | `priceStatus` | §5.2 (on content too) |
| Inventory status (product; L215 to L218) | in stock, low stock, out of stock, back in stock, pre-order; by size or colour variant; the low-stock threshold and the refresh still to set | **Adopt** as a rule, not a dimension | `inStock` on a piece; SFCC for products | §5.2 |
| Bestseller status (product; L219 to L222) | bestseller, trending, standard; N, the window and the recalculation still to set | **Adopt** as a rule, not a dimension | Catalogue order and merchandising | DI-19; §5.2 |
| Occasion (product, content; L223 to L225) | everyday, work, evening, weekend, travel, special event; gifting is an intent, not an occasion | **Adopt as is** | `occasion`, several per item | n/a |
| Gender (product, content; L226 to L228) | women, men, unisex | **Adopt as is** | `gender` | n/a |
| Size (product; L229 to L232) | bag: mini, small, medium, large; shoes and ready-to-wear from the feed | **Adapt** | `bagSize` on every product event; `size` on add to cart and purchase only | §5.2 (feed attribute names) |
| Content format (content; L233 to L236) | format: hero image, carousel, video, creator video, editorial or story, lookbook, user-generated; imagery: on-model, studio or silo, detail or zoom, flat-lay | **Adopt as is** | Both lists in `contentType`, up to eight values per piece (kit 03:396-397) | n/a |
| Content theme (content; L237 to L239) | craftsmanship, styling, product detail, brand and heritage, trend, care, gifting | **Adopt** | `contentTheme` | DI-10 |
| Journey-stage fit (content; L240 to L242) | exploring, considering, deciding, post-purchase, one or more | **Adapt** | `journeyStageFit` accepts exploring, considering and deciding and refuses any other word, and one refused piece refuses the whole publication (kinds.ts:173-186; guide 4.2). Until post-purchase exists it travels as the tag `journeyStage: ["post_purchase"]` beside the other three | DI-7 |

### 2.3 T7: their rules

| Their rule (Nitin L243 to L248) | Verdict | Engine today | What we do |
|---|---|---|---|
| Fixed values only; a value outside the list is rejected at load, and the rejection is reported | **Adapt** | On events, a value the published catalogue does not name builds no interest on that dimension and is reported (`signals`, `out_of_vocabulary`; kit 02:96-111; kit 03:39-54). On the catalogue, any tag value is accepted and becomes vocabulary (core.ts:375-390); a tag on an unregistered dimension is a warning (guide 4.4) | Their value list becomes the authority, and the catalogue refuses values outside it (DI-9). Until then the fixed choice is enforced at the source: a pick-list in the CMS and the mapping table in the data layer |
| Each value has an ID, a display name and accepted synonyms | **Adapt** | Values are bare strings; the closest structure is the enrichment taxonomy, value and meaning (connectors/config.ts:48) | The ID travels; display names and synonyms live in the value list; synonyms are resolved in their mapping before anything reaches us (DI-9 holds the option of resolving them on our side) |
| Every sub-category belongs to exactly one category | **Adopt** | The registry has no hierarchy | A `parent_value_id` column, checked at publication with DI-9; both values still travel on each event |
| One mapping table; no renaming in the source systems | **Adopt as is** | n/a | C2: applied on their side, with a copy to us for validation |
| Changes are versioned; a new value is a new revision, approved before use | **Adopt as is** | Every configuration document is a versioned revision, with history and rollback, in force within the 30-second publication cache and without a deployment (7 Oct G-B, the admin surface) | Nitin approves each revision and we publish it; a value used before approval builds nothing and is reported |

### 2.4 T8: the behaviours, and the event each needs

The Weight column of T8 is empty in the text we have: the table has five headings (Nitin L250 to L254) and every row four cells, so they gave a rank, not weights. The proposed weights below sit on the engine's scale, where a product view is 1, a save 2, an add to cart 3 and a purchase 5 (core.ts:221-244); they are proposals for Nitin to confirm (§5.2). Their rank puts search and add to cart above purchase, so whether the rank is an order of weight is a question too.

| Rank | Behaviour (Nitin) | Verdict | Event we prescribe | Engine today | Proposed weight | Ticket or design item |
|---|---|---|---|---|---|---|
| 1 | Search: a query that maps to a vocabulary value (L255 to L258) | **Adapt**: a new event, no engine build | `search`, a custom event carrying only the values their search resolved (for "black crossbody", `color: black` and `productType: crossbody`), mapped with the value list's display names and synonyms; never the query text | A custom event with registry values builds interest under `event-when-unknown` at the weight of its name (core.ts:491-506, 574; ShopperReflex.ts:1248, 1316). The engine's own search route ranks results by interest and builds none (search.ts:109) | 3 | DI-9 (synonyms) |
| 2 | Add to cart, from a PDP, quick view or a module (L259 to L262) | **Adopt as is** | `add_to_cart` with the §3.3 values; `moduleId` and `decisionId` when it starts inside a module (D4) | Weight 3 by default; counts toward the visit's stage (JourneyStage.ts:304-336) | 3 | P33 (module credit) |
| 3 | Product view, quick view included (L263 to L266) | **Adopt as is** | `product_view` on the PDP and on quick view, with the §3.3 values | Weight 1 by default (core.ts:221-244) | 1 | n/a |
| 4 | Repeat product view, in the same or a later visit (L267 to L270) | **Adopt** as derived; **new** as a distinct behaviour | Nothing new: every `product_view` counts again | Each view adds its weight again to the same values, with decay (core.ts:567-592); there is no repeat counter and no three-revisit signal; a later visit needs return recognition for shoppers not signed in (F3) | 1 per view | DI-11; DI-7 |
| 5 | Purchase, server-confirmed and deduplicated on order ID (L271 to L274) | **Adopt**; the damping rule and order-ID deduplication **new** | `purchase` (D3) | Weight 5 by default; moves the stage to deciding and closes the visit's journey (kit 02:124-133) | 5, with the product type damped | DI-12; DI-17 |
| 6 | Video view, at least 3 seconds (L275 to L278) | **New** | `video_view`, a custom event their player fires at 3 seconds, with `contentId`, `slot`, `decisionId` and `contentType: video` | Not a content action, so the piece's catalogue tags are not read for it (contentTelemetry.ts:44, 111-126); the values it carries still build interest | 1 | DI-13 |
| 7 | Video completion, 75 percent (L279 to L282) | **Adopt as is** | `video_complete`, fired by their player at 75 percent through `client.emit.videoComplete` | Weight 2; reads the piece's format from the catalogue (contentTelemetry.ts:44-67, 111-126) | 2 | n/a |
| 8 | Size guide or fit opened (L283 to L286) | **Adopt** through module engagement | The size-and-fit module declares `sizeguide:open` in `data-op-engage` (A5) | A module engagement arrives as `content_click` naming its `interaction` (kit 03:22); one weight for every module engagement; not a stage counter | 1 | P03 (built); DI-21; DI-7 |
| 9 | Reviews opened (L287 to L290) | **Adopt** through module engagement | The reviews module declares `reviews:open` | As row 8 | 1 | P03; DI-21; DI-7 |
| 10 | Filter applied; a sale filter or a sale page raises sale (L291 to L294) | **Adapt**: a new event, no engine build | `filter_applied`, a custom event carrying the facet as its dimension and value (`color: black`; `priceStatus: sale` for the sale filter and the sale page) | As search: registry values on a custom event build interest | 2 | n/a |
| 11 | Content click or tap (L295 to L298) | **Adopt as is** | `content_click` through the SDK, after the piece's render acknowledgement | Weight 1; needs a `rendered-v1` slot and a page instance (P03, "starts from"; kit 03:22) | 1 | n/a |
| 12 | Save or wishlist (L299 to L302) | **Adopt as is** | `wishlist_add` with the §3.3 values | Weight 2; counts toward the visit's stage | 2 | n/a |
| 13 | Dwell: past 20 seconds on a PDP, or 30 on editorial (L303 to L306) | **Adapt** | Editorial: the SDK's `content_dwell` with `ms`, at a 30-second minimum. PDP: `product_dwell`, a custom event from their tag manager once per PDP view at 20 seconds, with `productId`, the §3.3 values and `dwellMs` | The SDK sends dwell when an element leaves view after its minimum, 1 second by default and one value per client (listen.ts:58, 252-305; emit.ts:255, 303); `dwellMs` on any event feeds the visit's dwell counter (JourneyStage.ts:337) | 0.5 | DI-14 |
| 14 | Content impression: at least 50 percent of the module in view for at least 1 second, IAB/MRC (L307 to L310) | **Adapt** | The render acknowledgement after paint, as now, plus a viewable impression at 50 percent for 1 second | The SDK's impression is the render acknowledgement sent after paint (listen.ts:252-269); the declarative scan's is the first moment the element is 50 percent in view, with no time rule (host.ts:16-19; emit.ts:243-249). An impression is not a learning input: learning counts the slot's exposure unit (kit 03:21); it weighs 0 and never builds interest (notes position 7); fatigue counts what was served to the shopper (kit 03:495-497) | 0 | DI-15 |
| 15 | Remove from cart: a negative signal (L311 to L314) | **New** | `remove_from_cart`, a custom event with `productId` and the §3.3 values, captured now | Weights run from 0 to 1000 and interest is floored at zero (configStore.ts:353; core.ts:574-592), so a removal can lower nothing today; at weight 0 it is recorded and builds nothing | 0 until DI-16 | DI-16 |
| n/a | The purchase rule: strengthen style, collection, colour and price; damp the bought sub-category (their product type) for a proposed 30 days, so a crossbody buyer sees a matching wallet (L315) | **New** (the damping) | n/a | A purchase raises every value it carries by its weight; nothing damps one dimension. The `complements` preference already serves "a wallet that matches" on the page of the product it completes (decide.ts:330-341) | n/a | DI-12; DI-18 |

### 2.5 Entry channel, source platform and landing page type against the six channel words

| Their entry channel (Nitin L160 to L162) | Engine word today | How it is recognised (visit.ts) | Verdict | With DI-1 (P36) |
|---|---|---|---|---|
| paid social | `paid_social` | `utm_medium` paid_social, paidsocial, display or banner; or cpc, paid, cpm or social with a social network named in `utm_source` (visit.ts:239-250, 437-459) | **Adopt as is** | n/a |
| paid search (brand) | `paid_search` | `utm_medium` cpc, ppc, sem and similar; a Google click ID with no declared source (visit.ts:239, 435, 450) | **Adapt**: shares a word with non-brand | `paid_search_brand`, from a `utm_campaign` rule |
| paid search (non-brand) | `paid_search` | As above | **Adapt** | `paid_search_nonbrand` |
| organic search | `organic` | A search engine's referrer with no tag, or `utm_medium` organic (visit.ts:248, 472) | **Adopt as is** | n/a |
| email | `email` | `utm_medium` email, newsletter or crm, or an email platform named in `utm_source` (visit.ts:247, 252, 462) | **Adopt as is** | n/a |
| SMS | none: `utm_medium=sms` matches no table and falls through to `direct` (visit.ts:426-474) | n/a | **New** | `sms` |
| affiliate | `referral` | `utm_medium` affiliate (visit.ts:249) | **Adapt**: shares a word with referral | `affiliate` |
| referral | `referral` | Any other external referrer, or `utm_medium` referral or partner; an untagged social click lands here too (visit.ts:420-424, 473) | **Adopt as is** | n/a |
| direct | `direct` | No referrer, or the site's own host (visit.ts:465-470) | **Adopt as is** | n/a |

| Their source platform (Nitin L163 to L165) | The network as the engine names it (visit.ts:269-288) |
|---|---|
| Meta | `facebook.com`, `instagram.com` (also `fb.com`, `meta.com`, `threads.net`) |
| TikTok | `tiktok.com` |
| Pinterest | `pinterest.com` |
| Snapchat | `snapchat.com` |
| YouTube | `youtube.com` |
| Google | `google.com` and its market domains |
| Bing | `bing.com` |
| other | No network; the channel still classifies |

P36 makes the channel vocabulary, the visit buckets and the ladder per-tenant, versioned settings, with a cell-grammar version bump and a prior re-export under W25; its own recommendation was to defer and "revisit only if the taxonomy cannot be mapped" (BTI-Parity-Build-Tickets.md, P36). Nitin's T7 is that case: three of their nine channels cannot be told apart in six words (SMS, affiliate, brand against non-brand search), and SMS is one of the two channels, with email, that Mandeep named as ones this programme can revive (call L56). Our recommendation for Simone and Nitin: reopen P36 through the programme's amendment process, with `utm_campaign` read for the brand split and the collection in the ad (DI-1). Interim, so nothing waits: tag SMS links `utm_medium=crm` with the SMS platform as `utm_source`, so they classify as `email` (visit.ts:247) rather than polluting `direct`, at the cost of the email and SMS split inside the engine until P36; brand and non-brand stay one word, their split kept in their own analytics; affiliate stays inside `referral`. The page may pass its own channel only as one of the six words (listen.ts:13-14; cell.ts:64), so their own classification cannot carry the nine values before P36 either. Landing page type is DI-6.

### 2.6 Device, time of day and recency against the learning cell

The learning cell is five words: channel, visit bucket, journey stage, region and the leading interest (cell.ts:51-72), pooled coarsest first, from everyone to channel, to channel and visit, then stage, region and leading interest (stats.ts:37-50). The order and the keys are the cell grammar, versioned under W25: a prior row in another order or with another key is refused, and a priors file exported under one grammar is refused under another (kit 03:606-615). Device, time of day and recency are not levels, and they should not become levels by default: each added level divides the evidence behind every cell below it, and the grammar version moves, with a prior re-export. Their own use of the three is the first paint (Nitin L27, L39, L45), which is what a seed signal is for: an arrival signal that lifts tags by a weight on a slot, recorded on the receipt and never learned as evidence (kit 03:352-385). So device, time of day and recency enter as seed signals first (DI-3, DI-4, DI-5). Device is the exception to watch: Mandeep named mobile and desktop as the first axis of a bounded set of layouts, with channel and visit inside it (call L70). If track 3's render recommendation varies the layout by device, device joins P01's order context (today `{ channel, visitBuckets }`, kinds.ts:356-372) and P30's cache key, and it is the one of the three that may justify a level of learning later, under W25.

### 2.7 The design items this creates

The parity programme is frozen at 25 tickets in a fixed order (BTI-Parity-Build-Tickets.md, header; frozen at `5ebf84b7` on `rem/integration`). Whatever Simone admits from this list enters through the owner's amendment process. Build effort for any of them: in sequence, in hours to a day each.

| DI | What | From | Our recommendation | Attaches to | Whose decision | On the first test's path? |
|---|---|---|---|---|---|---|
| DI-1 | The channel vocabulary as a tenant setting (their nine channels; source platform as a context if learning by platform is wanted), with `utm_campaign` read for the brand split and the collection in the ad | Nitin L11 to L16, L160 to L165; call L56 | Reopen P36; the interim in §2.5 | P36; W25 | Simone, with Nitin | No, through the interim; yes if the starting orders must split SMS or brand search |
| DI-2 | Source platform from a token-form `utm_source` (`tiktok`, `facebook`); `referrer_network` seeds match only the referrer host or a host-form source today (visit.ts:374-378) | Nitin L163 to L165 | Either their convention writes the domain (`tiktok.com`), with no build, or the seed matcher accepts the tokens the channel classifier already recognises (visit.ts:294-303) | W16 seed signals; P36 | Simone, after the UTM walk-through with their marketing operations | No |
| DI-3 | Device class (mobile, desktop; tablet if confirmed) as a seed signal, and as an order context and a cache-key part if track 3 varies the layout by device | Nitin L35 to L40, L175 to L177; call L70 | The seed signal first; the order context and cache key only if the render recommendation asks for them | P01 (context grammar); P30 (key); W25 if it becomes a level | Track 3's recommendation; Simone with Nitin | Only if the layout varies by device |
| DI-4 | A recency bucket (same day, within 7 days, 8 to 30, more than 30) from the stored last visit | Nitin L23 to L28, L172 to L174 | A seed signal; depends on F3 for shoppers not signed in | W16 seed signals; P36 family | Simone, with Nitin | No |
| DI-5 | A day part from the request time and the visitor's time zone at the edge | Nitin L41 to L46, L178 to L180 | A seed signal (their priority: low) | W16 seed signals | Simone | No |
| DI-6 | Landing page type kept for the visit, from the first page type of the visit | Nitin L13, L166 to L168 | A seed signal for the later pages of the visit | W16 seed signals; P36 family | Simone, with Nitin | No |
| DI-7 | Journey stage: counters for their considering and deciding signals (module engagements, repeat product views, the shipping check), so their definitions publish as thresholds; and a post-purchase stage with a window | Nitin L48 to L57, L181 to L183, L240 to L242 | Counters first, so their definitions become the published `journey` block (JourneyStage.ts:164-275); post-purchase second, with a grammar version, because stage is a level of learning | W16 (journey block); W25 | Nitin (definitions); Simone | No: the default thresholds serve the first test |
| DI-8 | Gifting intent as a short-horizon registry dimension fed by a `gift_signal` event (gift wrap or a gift message selected, a gift guide visited) | Nitin L58 to L63 | Configuration plus their event; no build | Registry configuration | Nitin | No |
| DI-9 | Their value list as the vocabulary authority: IDs, display names, synonyms, parent; values outside it refused at publication and reported; revisions approved | Nitin L243 to L248; 7 Oct H, "where the value list lives" | Build it. Interim: publish the full value list into the catalogue, so sparse test content does not refuse product values on the dimensions it tags (core.ts:451-471), for example as one record whose `slotTypes` names no published slot, which is stored and eligible nowhere (kit 03:273-275) | 7 Oct H; W16 C8 | Nitin; Simone | The interim, yes (W3); the build after |
| DI-10 | Engagement with a piece or a module teaches its catalogue tags (theme, collection, style and the rest), not only its format | Nitin L137 to L142; 7 Oct H, "what using a module teaches the profile" | Build it with P32 for modules, and the same rule for content | P32 | Nitin; Simone | No |
| DI-11 | Repeat product view as a distinct behaviour with its own weight, and the three-revisit comparison signal | Nitin L267 to L270 | Their call whether derived suffices | Registry and journey counters | Nitin | No |
| DI-12 | Purchase damping: after a purchase, interest in the bought product type damped for a window (30 days proposed) | Nitin L315 | Per-shopper suppression with an expiry, the mechanism of 7 Oct G-B's first option for negative preference. The "matching wallet" half is the built `complements` preference (decide.ts:330-341), which needs the product on the page passed as the anchor (DI-18) | 7 Oct G-B (negative preference); W16 | Nitin; Simone | No |
| DI-13 | Video view at 3 seconds as a content action that reads the piece's format from the catalogue, like `video_complete` | Nitin L275 to L278 | Add it to the content actions (contentTelemetry.ts:44), and to the reward list if they want it rewarded (kinds.ts:878) | P03 lineage | Simone | No |
| DI-14 | A dwell minimum per page type: 30 seconds on editorial, and 20 on a PDP as `product_dwell` | Nitin L303 to L306 | A minimum per slot in the SDK, or a threshold on `ms` at ingest | P34 (the SDK) | Simone | No |
| DI-15 | A viewable impression, 50 percent for at least 1 second (IAB/MRC), recorded beside the render acknowledgement; and whether layout slots learn on a viewable basis, since a module drawn far below the fold may never be seen | Nitin L307 to L310 | Record it first; the basis is a measurement-design decision, because it changes every rate's denominator and the position correction | W26 (exposure unit); P03; P05 | Nitin and Simone | The recording, ideally; the basis, decided before launch |
| DI-16 | Negative signals: remove from cart now, dismissal in phase two | Nitin L311 to L314; 7 Oct C4 | The negative-preference decision (7 Oct H): per-shopper suppression with an expiry, a negative behaviour weight with a floor at zero, or a per-context counter; captured at weight 0 meanwhile | 7 Oct H (phase two) | Mandeep and Nitin | No |
| DI-17 | Purchase deduplication by order ID on our side | Nitin L271 to L274 | Their tag sends once per order meanwhile; engine-side uniqueness built after | Outcome records | Simone | Their once-per-order guard, yes |
| DI-18 | Page-sent context through the SDK (`ctx.*`): an empty module for P31, and the anchor product for `complements` | 7 Oct G-A item 9; Nitin L315 | Add it to the SDK's refresh with P31 | P31 | Simone | Yes, with P31 |
| DI-19 | Bestseller as a merchandising term, if they want it weighted rather than only ordered | Nitin L150 to L155, L219 to L222 | Optional | Merchandising rules (kinds.ts:162-172, 542-555) | Nitin, with merchandising | No |
| DI-20 | New-module detection: the SDK reports container IDs it sees that have no register entry | call L60 | Build it; the register stays the gate | The SDK | Simone | No |
| DI-21 | Weights per module interaction (size guide, reviews, a tile click) | Nitin L283 to L290 | With P32, or interaction names mapped to their own actions | P32 | Nitin | No |

---

## 3. The metadata we prescribe, built on their vocabulary

Everything below uses Nitin's T7 names and values wherever they overlap with our 7 October lists (`docs/Tapestry-Kickoff-Engine-Content.md`, track 2), so that at the kickoff we can say we built it on the vocabulary they gave us.

### 3.1 Per piece of content

**For each piece of content, ten things.**

1. Content ID: the CMS ID, stable through edits, republishing and moves.
2. Title.
3. Content format: from their format list and imagery list (video, on-model, editorial or story, and the rest).
4. Content theme: craftsmanship, styling, product detail, brand and heritage, trend, care, gifting.
5. Category and product type, where the piece is about products.
6. Collection: Tabby, Brooklyn, Teri and the rest.
7. Style, colour and occasion, from their lists.
8. Gender and price band: the assortment and the band the piece speaks to.
9. Where it may appear: the module or slot IDs it may fill.
10. When and where it is live: status, publish and expiry dates, market and language.

Optional, each buying one behaviour: journey-stage fit, the products it features, the products it completes, a stock flag, a freshness date. To be served at all a piece needs 1, 2, 3 and 9; to be personalized it needs 4 to 8 as well. Sparse is fine: proposals come from their list, and their team approves each (B3).

| Field | Values or type | Required | Engine capability that uses it | Who fills it |
|---|---|---|---|---|
| `id` | String, stable; may equal the CMS ID | Required | Decisions and pins address it (kit 03:171) | Kimia's export |
| `customerContentId` | The CMS ID | Required | Echoed on every decision; what the front end renders by (kit 03:64) | Kimia's export |
| `type` | The CMS rendering kind (image, video, story, carousel) | Required | The slot's `allowedTypes` gate; the format's fallback when there is no `contentType` tag (typeAffinity.ts:12-21) | CMS |
| `title` | Text | Required | Shown in the console | CMS |
| `slotTypes` | The slots it may fill, as named in the slots document | Required, at least one | Eligibility per slot (kinds.ts:97-98) | Kimia, from the page map |
| `tags.contentType` | Content format: their format and imagery values (§3.4) | Required to personalize | Content-format interest, learned from engagement (contentTelemetry.ts:111-126) | Kimia |
| `tags.contentTheme` | Content theme values | Required to personalize | Theme interest (DI-10); slot weights | Kimia |
| `tags.category`, `tags.productType` | Category and product type values | Required where the piece is about products | The interest match on the content slot's weights | Kimia; proposals approved |
| `tags.collection` | Collection values | Required where it features a line | The same, and the seed tag for the collection in an ad | Kimia |
| `tags.style`, `tags.color`, `tags.occasion` | Their values | Recommended | The interest match | Kimia |
| `tags.gender`, `tags.priceBand` | Their values | Recommended | The interest match | Kimia; merchandising for the band |
| `tags.locale` | `en-US`, `en-CA` | Required | Market and language: a slot excludes the values it must not show (guide 4.2) | CMS |
| `journeyStageFit` | exploring, considering, deciding | Optional | The slot's stage rule (kit 03:183) | Kimia |
| `tags.journeyStage` | `post_purchase` | Optional, interim | Held until the post-purchase stage exists (DI-7) | Kimia |
| `lifecycle.status` | live, draft, expired | Optional; absent is live | Eligibility (kinds.ts:99-104) | CMS |
| `window.from`, `window.to` | ISO 8601 | Required for campaigns | Outside the window the piece cannot be chosen at any score (kinds.ts:111-124) | CMS |
| `eligibleWhen.regions` | Region keys such as `US`, `US-NY` | Optional | Market or regional restriction (kinds.ts:125-161) | Kimia, with legal |
| `featuredProductIds` | SFCC master product IDs | Optional | Credit and recognition; the piece inherits no product value (kit 03:185) | The CMS's product references |
| `complements` | SFCC master product IDs | Optional | "Complete the look" on the page of that product (decide.ts:330-341; kit 03:186) | Merchandising |
| `inStock` | Boolean | Optional | `false` removes the piece from every decision (kinds.ts:199) | Their feed, from SFCC stock of the featured products |
| `freshnessDate` | ISO 8601 | Optional | The slot's freshness rule (kit 03:184) | The CMS publish date |
| `merchandising` | `season`, `promotion`, `margin`, each 0 to 1 | Optional | Merchandising multipliers per slot (kinds.ts:162-172) | Merchandising |
| `renderUrl` | A URL or site path | Optional | Echoed, never rewritten (kit 03:181) | CMS |

Fields outside this list are not stored, and each import names them as `ignored_field` (kit 03:264-267).

**What changed from our 7 October list.**

| Our 7 October item | Now, on T7 |
|---|---|
| Format: on-model, silo, detail, flat-lay, video, user-generated or editorial | Content format: their format list and their imagery list, together in `contentType` |
| Line or collection | Collection |
| Category or silhouette | Category and product type; "silhouette" retired in favour of their product types |
| Occasion | Occasion, their six values |
| Price band | Price band: entry, core, aspirational |
| (not in our list) | Added from T7: content theme, style, colour, gender |
| Market and language, as a tag | Unchanged: `locale` |
| The journey stages it suits | Their four values, with post-purchase carried as an interim tag (DI-7) |

### 3.2 Per module

**For each module, ten things.**

1. Module ID: stable; the page left out of it if the module appears on several pages.
2. Name, in their words (Product Hero, Editor's Note, Closer Look).
3. Module type, from the list below.
4. The pages it appears on, and its position today.
5. Its rule: free to move, held at its position, never moved, or may be hidden.
6. The content format and content theme it leads with, from their lists.
7. What it is about, where that is fixed: category, product type, collection, gender.
8. Journey-stage fit: exploring, considering, deciding.
9. What counts as using it: a click, and the interactions it declares (reviews opened, size guide opened).
10. Whether it can be empty, and how the page says so.

Later: one sentence of purpose, for the meaning-based term.

**The module types we prescribe**, built from the modules Mandeep walked through and named (call L42, L64 to L66). Modules 5, 6, 7, 9, 10 and 14 on Mandeep's PDP walkthrough were not named; the Coach brand team confirms the list (7 Oct F).

| Value ID | Display name | From |
|---|---|---|
| `product_hero` | Product hero | call L64 |
| `product_details` | Product details | call L64 |
| `editors_note` | Editor's note | call L64 |
| `closer_look` | Closer look | call L64 |
| `more_styles` | More styles like this | call L66 |
| `recommendations` | Recommendations ("you may also like") | call L42; Nitin L75 |
| `complete_the_look` | Complete the look | Nitin L75 |
| `recently_viewed` | Recently viewed | call L42 |
| `get_inspired` | Get inspired | call L66 |
| `story` | Story; its subject in `contentTheme` (craftsmanship, brand and heritage) | call L42 |
| `materials` | Materials | call L42 |
| `virtual_try_on` | Virtual try-on | call L42 |
| `size_and_fit` | Size and fit, "what fits inside" | call L42; Nitin L283 to L286 |
| `faq` | Frequently asked questions | call L66 |
| `reviews` | Reviews | call L42, L66 |
| `customer_photos` | Customer photos | call L66 |
| `hero_banner` | Homepage hero | Phase 1 appendix B (the homepage) |
| `category_grid` | Category grid | Phase 1 appendix B |

| Field | Values or type | Required | Engine capability that uses it | Who fills it | Where it lives |
|---|---|---|---|---|---|
| `id` | `module.<kind>.<n>` | Required | The layout slot's items (kit 03:515-517) | Front-end engineering assigns; Kimia records | Catalogue |
| `customerContentId` | Their SFCC content slot or component ID | Required | Echoed on each decision | Kimia | Catalogue |
| `type` | `module` | Required | The layout slot's `allowedTypes: ["module"]` keeps content out of it | Kimia | Catalogue |
| `title` | The name in their words | Required | The console | Kimia | Catalogue |
| `slotTypes` | The page's layout slot, for example `pdp-layout` | Required | Which layout may draw it | Kimia | Catalogue |
| `tags.moduleType` | One value from the list above | Required | Layout weights; reporting by type; taught to the shopper with P32 | Kimia; the Coach brand team confirms | Catalogue |
| `tags.contentType` | The format it leads with, or an empty list | Required, explicitly | Content-format interest; without the tag, the `type` string would be learned as a format (typeAffinity.ts:12-21) | Kimia | Catalogue |
| `tags.contentTheme` | A theme value | Optional | Theme interest | Kimia | Catalogue |
| `tags.category` and the other product dimensions | Values, where the module's subject is fixed | Optional | The interest match on the layout's weights | Kimia | Catalogue |
| `journeyStageFit` | exploring, considering, deciding | Required | The layout slot's stage rule | Kimia, with the product owner | Catalogue |
| `window`, `eligibleWhen.regions` | Dates; region keys | Optional | Seasonal or regional modules | Kimia | Catalogue |
| `excerpt` | One sentence of purpose | Later | The meaning-based term (P18 onward) | Kimia | Catalogue |
| Pages and position today | Page names; a number | Required | Today's order is the page's baseline | The product owner | Page map |
| Rule | Free to move; held at position n; never moved; may be hidden | Required | Pins, exclusions, off-limits, orders (kit 03:571-582) | The product owner | Page map |
| Interactions | DOM event types for `data-op-engage` | Required where it has any | Module engagement (P03) | Front-end engineering | Tag plan |
| Can be empty | Yes or no, and what the page does | Required | Hiding now; the P31 signal later | Front-end engineering | Page map |

### 3.3 Per product: what must be on the SFCC snapshot and on the events

| Field | Values | On which events | Engine use | Source |
|---|---|---|---|---|
| `productId` | The SFCC master product ID | Every product event; each purchase item | Recognition, credit, parity (core.ts:413-428) | SFCC |
| `variantId` | The SFCC variant ID | Add to cart, purchase items, wishlist where a variant is chosen | Parity; size | SFCC |
| `category` | Category IDs | All | `category` interest | Mapping table |
| `productType` | Product type IDs | All | `productType` interest; the damping (DI-12) | Mapping table |
| `collection` | Collection IDs | All | `collection` interest | Mapping table |
| `style` | A style ID | All | `style` interest | Mapping table |
| `color` | A colour family ID | All | `color` interest | Mapping table |
| `material` | A material ID | All | `material` interest | Mapping table |
| `price` | A number, in US dollars | All | Checking the band | SFCC |
| `priceBand` | entry, core, aspirational | All | `priceBand` interest | Mapping table, with merchandising's ranges |
| `priceStatus` | full_price, sale | All | `priceStatus` interest | SFCC price books |
| `occasion` | A list of occasion IDs | All | `occasion` interest | Mapping table |
| `gender` | women, men, unisex | All | `gender` interest | Mapping table |
| `bagSize` | mini, small, medium, large | All, bags only | `bagSize` interest | Mapping table |
| `size` | The chosen size | Add to cart and purchase only | `size` interest | The variant |
| `moduleId`, `decisionId` | The module and its decision | An add to cart or save started inside a module | Module credit (P33) | The data layer |

On the SFCC snapshot only, never on events: inventory status by variant and bestseller status. They feed rules (§2.1, rows 22 and 23), not interest. Each value on an event is capped at 64 characters, and each list at 8 values (core.ts:339-373).

```json
{ "type": "product_view", "data": {
  "productId": "P-000123", "category": "bags", "productType": "shoulder_bag",
  "collection": "tabby", "style": "contemporary", "color": "black",
  "material": "glove_tanned_leather", "price": 450, "priceBand": "core",
  "priceStatus": "full_price", "occasion": ["everyday", "evening"],
  "gender": "women", "bagSize": "medium" } }
```

### 3.4 The registry draft: dimension keys on their vocabulary

| Their attribute or dimension | Key | Reads the event field | Several per item | Horizon | Values (IDs) |
|---|---|---|---|---|---|
| Category | `category` | `category` | No | Default | bags, small_leather_goods, shoes, ready_to_wear, jewelry, accessories, watches, fragrance |
| Product type | `productType` | `productType` | No | Default | tote, crossbody, shoulder_bag, satchel, top_handle, hobo, bucket, belt_bag, backpack, clutch, messenger_briefcase, travel_bag_duffle; wallet, card_case, wristlet, pouch, tech_case; sneaker, boot, sandal, flat, loafer, heel, slide; outerwear, jacket, knitwear, top, dress, bottoms; necklace, earrings, bracelet, ring; bag_charm, strap, belt, scarf, hat, sunglasses, key_ring; watches and fragrance to come |
| Collection | `collection` | `collection` | No | Default | tabby, brooklyn, teri and the rest, from SFCC |
| Style | `style` | `style` | No on products; content may carry several | Default | classic, contemporary, minimalist, maximalist |
| Color | `color` | `color` | No | Default | black, brown_tan, neutral, bright_seasonal, metallic, print_pattern |
| Material | `material` | `material` | No | Default | smooth_leather, pebbled_leather, glove_tanned_leather, signature_canvas, suede, quilted, shearling, other |
| Price band | `priceBand` | `priceBand` | No | 35 days, as the default registry's price posture (core.ts:209-214) | entry, core, aspirational |
| Price status | `priceStatus` | `priceStatus` | No | Default | full_price, sale |
| Occasion | `occasion` | `occasion` | Yes | Default | everyday, work, evening, weekend, travel, special_event |
| Gender | `gender` | `gender` | No | Default | women, men, unisex |
| Size | `bagSize`; `size` | `bagSize`; `size` | No | Default | mini, small, medium, large; sizes from the feed |
| Content format | `contentType` | `contentType`, and the catalogue tag for a known piece | Up to 8 per piece | Default | hero_image, carousel, video, creator_video, editorial_story, lookbook, user_generated; on_model, studio_silo, detail_zoom, flat_lay |
| Content theme | `contentTheme` | `contentTheme` | No | Default | craftsmanship, styling, product_detail, brand_heritage, trend, care, gifting |
| Module type (ours) | `moduleType` | `moduleType` | No | Default | The §3.2 list |
| Gifting intent (DI-8) | `giftIntent` | `giftIntent` | No | Short, a few days, proposed | gifting |

That is 16 dimensions of the 32 the registry holds (configStore.ts:135). Each dimension can carry its own decay horizon, half-saturation point and enter and exit thresholds (core.ts:26-44); the shipped defaults are a 14-day horizon, K of 1.8, entry at 0.6 and exit at 0.45 (core.ts:259-262), tuned at the registry session. Value IDs are lower case with words joined by underscores, at most 64 characters, with no control characters or angle brackets (core.ts:339-354), and with none of the colon, semicolon or vertical bar the CSV tag syntax uses (kit 03:176). Display names keep their wording ("brown / tan", "editorial / story").

### 3.5 The delivery format for each, with two examples

| What | Test data, by hand | Production path | Cadence | Who sends it |
|---|---|---|---|---|
| Module register | JSON or CSV from our template | The same file, versioned per page | On each new or changed module | Kimia |
| Page map | Our table | The same, versioned | On change | The product owner, with the front-end lead |
| Content | A CSV from a spreadsheet, field names as columns (kit 03:167) | A JSON array from the CMS API, pushed nightly to the catalogue import in merge mode, or a URL we pull on a schedule (guide 4.2) | Nightly, and on publish for urgent pieces | Kimia; their IT builds the job |
| Value list | CSV (C1) | The same; each revision approved | Per revision | Nitin approves |
| Mapping table | CSV (C2) | The same | Per revision | Nitin's team |
| SFCC snapshot | A CSV, or SFCC's catalogue export, through their MFT (C5) | Not loaded | Once, and per vocabulary revision | The SFCC contact |
| Events | Their data layer in the lower environment | Their data layer, through their tag manager, into the SDK | Live | Jeremy |
| Starting orders | A table | The console's order editor (P01) | When tuned | The tuning owner |

A piece of content, as one JSON record of the export:

```json
{
  "id": "cms-8f3a2c",
  "customerContentId": "8f3a2c",
  "type": "video",
  "title": "Tabby: the pillow leather, made by hand",
  "slotTypes": ["pdp-story", "home-story"],
  "tags": {
    "contentType": ["video", "on_model"], "contentTheme": ["craftsmanship"],
    "category": ["bags"], "productType": ["shoulder_bag"], "collection": ["tabby"],
    "style": ["contemporary"], "color": ["black"], "occasion": ["everyday", "evening"],
    "gender": ["women"], "priceBand": ["core"], "locale": ["en-US"]
  },
  "journeyStageFit": ["exploring", "considering"],
  "window": { "from": "2026-11-02T00:00:00Z", "to": "2027-01-31T00:00:00Z" },
  "featuredProductIds": ["P-000123"],
  "inStock": true
}
```

A module, as one JSON record of the register. We load everything outside `register` into the catalogue; the `register` block goes to the page map and the tag plan and never reaches the catalogue.

```json
{
  "id": "module.reviews.1",
  "customerContentId": "sfcc:pdp-reviews",
  "type": "module",
  "title": "Reviews",
  "slotTypes": ["pdp-layout"],
  "tags": { "moduleType": ["reviews"], "contentType": ["user_generated"], "contentTheme": ["product_detail"] },
  "journeyStageFit": ["considering", "deciding"],
  "register": {
    "pages": ["pdp"], "positionToday": 13, "rule": "free_to_move",
    "engage": ["reviews:open"], "canBeEmpty": true,
    "whenEmpty": "hidden and not acknowledged; the P31 signal once built",
    "purpose": "Shoppers read what other owners say about fit and wear."
  }
}
```

### 3.6 The ongoing process: who tags what after launch

Mandeep's question was who tags new content and who puts an ID and metadata on a new module once we are live (call L60). The answers we prescribe:

- **A new piece of content.** Authored in the CMS with the §3.1 fields chosen from pick-lists of the value list. The nightly export carries it in merge mode. A sparse piece gets proposals from the value list, approved in the console by content operations (B3). Each import answers every problem at once (ignored fields, unknown slot types, case variants, values out of vocabulary; kit 03:264-287), and those go to Kimia. Owner: Kimia's content operations. The piece can be chosen from its publish date.
- **A new module.** Front-end engineering builds it with its ID and the container attributes `data-op-content`, `data-op-slot` and `data-op-engage`. Kimia adds its register row; the page's product owner sets its rule; SWAT, and later their tuning owner, publishes it into the catalogue and the layout slot as a new revision with no deployment (7 Oct G-B). Until it is registered the engine never decides it, and the page shows it where their own layout puts it. Once registered it is a candidate on the layout slot (7 Oct G-B) and earns evidence through exploration or by being listed in an order. Mandeep's "I detect new module" (call L60) becomes DI-20.
- **A new value.** Proposed by content operations or merchandising. Nitin approves a new revision of the value list (Nitin L248); the mapping table gains its row; we publish the revision; content and events may use the value from then on. A value used before approval builds nothing and is reported (kit 02:96-111).
- **A new dimension.** A registry change, at most 32 dimensions in all, approved by Nitin and published by us: tag coverage first, weight second.
- **A new page.** Its page map, its layout slot, its register rows and its starting orders (guide 12.4).
- **A new campaign.** Tagged to the convention (E1); a new network or campaign term earns a seed rule.
- **What we report back.** Coverage per dimension and exposures per module, weekly from the first test data (notes §1.9).

---

## 4. The plan in human time against the 135-day milestone

### 4.1 The anchor, and what is assumed

- The contract was signed on or about 30 September 2026 (notes §0, 30 September).
- **Assumption:** the kickoff is Tuesday 13 October 2026. Mandeep wanted it "this week" (call L34); the week of 13 October is our working date.
- The 135 days are Mandeep's milestone for launching the first test (call L52, L64). Counted from signature they end on Friday 12 February 2027; counted from the kickoff, on Thursday 25 February 2027. **We plan to the earlier date**; which count Mandeep means is a question (§5.3).
- **Assumption:** the holiday code freeze runs from Monday 16 November 2026 to Monday 4 January 2027. The dates are unknown and are ask T5. The account team's "October pre-freeze container" (notes §0) suggests the freeze may start earlier; §4.4 gives that case.
- **Working definition, to confirm:** "the first test launched" means the first page's module order decided by the engine for a share of shoppers in production, measured against a holdout, on the metric they wrote down (notes positions 20 to 22).
- **Assumption:** their lower environment is closed to integration during the freeze. If it stays open, integration and the scripted run move into the freeze and the margin grows.
- Our build effort is not given in days: the parity order runs in sequence, in hours to a day each.

### 4.2 The plan

| Week | Dates | Milestone | Whose | What happens, and who |
|---|---|---|---|---|
| W0 | 12 to 16 Oct | Kickoff (assumed Tue 13 Oct) | Joint | The four tracks with their scope, milestones, owners and cadence (call L74); a point of contact per track (call L52, L86); the freeze dates asked (T5). Before it, Simone walks Sara through this list (7 Oct D) |
| W0 | 12 to 16 Oct | Our prescriptions handed over | Ours | The value list draft on T7 (§3.4), the content and module schemas (§3.1, §3.2), the register and page-map templates, the tag plan with every T8 behaviour (§2.4), the campaign convention (§2.5): Simone |
| W1 | 19 to 23 Oct | Working sessions | Joint | The vocabulary session (Nitin, Kimia: the questions in §5.2); the data-layer walk-through (Jeremy; T20); render review 1 (Rob, George, Pat Mussey with Josh, James and Simone: how each placement renders and caches today, the performance budget, the first page's module IDs; T13, T17); origins and the subdomain decision (H1). Ours: the Tapestry tenant in our test environment, a deployment made with the owner's authority |
| W1 | 21 to 23 Oct | Track 4 document in good shape | Joint (Mandeep, Nitin, Simone) | 7 Oct D |
| W2 | 26 to 30 Oct | **Dimensions and format agreed: Mandeep's two-week milestone, by Tue 27 Oct** (call L58) | Joint | Value list revision 1 approved (Nitin); the content and module schemas and the delivery mechanism agreed; the tag plan agreed (T21); price bands, master or variant IDs and the campaign convention settled; render review 2 fixes the pre-freeze front-end scope and the render recommendation for the first page; the connection check from inside their network (T32); the security reviewer and privacy owner named (T33); the first page chosen (T2); the levers session for everyone (week of 26 Oct, 7 Oct D); the first programme review (30 minutes, red, yellow and green per track; call L74) |
| W3 | 2 to 6 Nov | **Test metadata by hand, first page** | Theirs (Kimia; the SFCC contact) | The module register for the first page; a first content test set as a CSV; the SFCC snapshot (C5); ODP access (F4) |
| W3 | 2 to 6 Nov | Test metadata loaded | Ours | Loaded into the test tenant with the interim vocabulary record (DI-9); diagnostics back to Kimia; starting orders drafted with the Coach brand team (A4) |
| W4 | 9 to 13 Nov | **Front-end merge before the freeze, by Fri 13 Nov** | Theirs (front-end engineering, Jeremy, their backend engineer) | The SDK (I1); consent posted (G1); the tag-plan events with the Tapestry data-layer mapping (D1, C3, C4); module containers marked on the first page (A1, A5); drawing from the returned order behind their switch, off in production (I2); defaults and the deadline (I3); the sign-in endpoint and call (F1); CSP and WebSocket in the production configuration (H2) |
| W5 | 16 to 20 Nov | **Test metadata complete** | Theirs (Kimia; the privacy owner; the ODP owner) | The second page's register; the content test set across the agreed tags; the mapping table complete; the decisions on return recognition (F3), consent per market (G2) and the ODP fields (F5) |
| W5 to W11 | 16 Nov to 1 Jan | Freeze (assumed); our build continues | Ours | The parity order: P10 (active), P07, P04, P29, P31, P05, P06, P12, P13, P34, P30, P33, the first test's path; then P32, P09, P11 and P14, which the ticket list also marks for Phase 3, and P35, P08, P15, P16, P26; and the design items Simone admits (§2.7); in sequence, in hours to a day each. The scripted run prepared against the first page |
| W5 to W11 | 16 Nov to 1 Jan | Freeze; their metadata and reviews continue | Theirs | Kimia: the CMS export by API designed with their IT, tag approvals, vocabulary revisions; the ODP owner: fields and segments; the privacy and security reviews in progress; the metric and holdout drafted (J1, J2). Thanksgiving (26 Nov) and Cyber Monday (30 Nov) fall in this window |
| W12 | 4 to 8 Jan 2027 | Freeze lifts (assumed); integration in their lower environment | Joint | Their switch on in the lower environment with real metadata; their QA verifies the events (identifier parity, `signals`); the connection check again (H3); the P31 signal and the P13 hook adopted on their side; the production content job running (B2) |
| W13 | 11 to 15 Jan | The scripted run | Joint | We drive it once; their team re-runs it; both sides agree on what they saw (notes §1.3) |
| W14 | 18 to 22 Jan | Sign-offs and decisions in writing | Theirs (Mandeep, Abby, the privacy owner, the security reviewer, their analytics lead), with ours | Security sign-off; privacy sign-off (consent per market, retention per category, return recognition, ODP forwarding); the primary metric and the holdout share in writing; the tuning owner named; the starting orders published. Ours: the production stamp provisioned and verified through its APIs, with the owner's deploy authority |
| W15 | 25 to 29 Jan | The go-live checklist; the release slot | Joint | The checklist closed (guide appendix F); their switch on in production for the test share, staged |
| W16 | 1 to 5 Feb | **The first test launched (target)** | Joint | Module sequencing on the first page, against the holdout |
| W17 | 8 to 12 Feb | Margin; day 135 counted from signature is Fri 12 Feb | n/a | One week of margin |
| W19 | 22 to 26 Feb | Day 135 counted from the kickoff is Thu 25 Feb | n/a | Three weeks of margin in that reading |

The programme review, 30 minutes with red, yellow and green per track (call L74), falls in W2, W4, W6, W8, W10, W12, W14 and W16.

### 4.3 What gates the first test, and what follows it

- **Gates it, on their side:** A1 to A5 (A6 by hiding), C3 and C4 (the event code is written once, in the W4 merge), D1, D3, E1, E2, F1, G1 to G4, H1 to H5, I1 to I4, J1 to J5, and the owners in K.
- **Gates it, on ours:** P10, P07, P04, P29, P31, P05, P06, P12, P13, P34 and P33 in the parity order; P30 only if the render recommendation caches the layout by context; DI-9's interim at W3; DI-15's recording, ideally, and its basis decided before launch. The ticket list also marks P09, P11, P14 and P32 as needed by Phase 3 (BTI-Parity-Build-Tickets.md); on this plan they follow in the same order inside the freeze window, and none of them changes what their front end merges.
- **Follows it:** group B, the content activation inside modules (P26, which needs the production content job and tag approvals); the vector programme (B5); track 1's affinity audiences, which are near term once the SDK, the product values and consent are live (7 Oct G-A); the remaining design items.

### 4.4 If the freeze starts earlier

If T5's answer puts the freeze at Monday 2 November, the merge moves to Friday 30 October (W2). Render review 1 then happens in W0 or early W1 and fixes the scope at once, and the event list for the merge is fixed in W1 from §2.4 rather than from the agreed tag plan. The pre-freeze list narrows to the SDK, consent, `page_view` and the commerce events, the containers marked on the first page, and drawing from the order behind the switch. Sign-in, module interactions and the remaining events wait for the window after the freeze, which carries more front-end work into W12 and W13. The two-week agreement stays in W2. If the freeze lifts later than 4 January, each week of delay comes out of the margin: one week in the earlier reading of the 135 days, three in the later.

---

## 5. Open questions for the kickoff

### 5.1 The points of contact we must get named

| Role | Track | Rows in §1 | Who, from the call |
|---|---|---|---|
| Their programme manager | All | K5 | Not named; Mandeep asked for one on each side (call L36) |
| Point of contact for tracks 1 to 3 | 1 to 3 | All | Abby, senior director for digital products (call L76, L86) |
| Escalation | 1 to 3 | n/a | Mandeep (call L86) |
| Track 1 owner | 1 | K1, F4 to F6, J3 | To name; Seth and Kelly's team for the business side (7 Oct B) |
| Track 2 owner, content and module metadata | 2 | A2, B1 to B5, C1, C2 | Kimia (call L44) |
| Track 2 owner, events and signals | 2 | D1 to D4, E1, E2, C3 | Jeremy (call L62), under Nitin (call L60) |
| Track 3 owner, the one who says "we are owning it" | 3 | A1, A5, A6, G1, I1 to I4 | Rob, George or Pat Mussey (call L82 to L86); the transcript reads "Rob George's decision" (call L84), one person or two, to confirm |
| Track 4 | 4 | K4 | Mandeep and Nitin (call L52) |
| The page's product owner | 2, 3 | A3, A4 | The director of personalization, who reports to Abby (call L76); name to confirm |
| The Coach brand contact | 2 | A2 (module types), A4 (starting orders) | To name (7 Oct F) |
| SFCC and commerce data contact | 2 | C3 to C5 | To name (T23) |
| Merchandising | 2 | C6; price bands, bestseller, low stock | To name (Nitin L211, L217, L222) |
| Marketing operations, campaign tagging | 2 | E1 | To name |
| Backend engineer, the signed statement | 3 | F1 | To name (T25) |
| Identity owner, the hashed identifier | 1, 3 | F2 | Nitin, or whom Nitin names (T26) |
| ODP owner | 1 | F4 to F6 | To name (T27 to T29) |
| Privacy owner | All | F3, F6, G1 to G3 | To name (T33) |
| Security reviewer | All | G4 | To name (T33) |
| Network and platform engineer | 3 | H1 to H3, H5 | To name (T30 to T32) |
| QA owner | 3 | D1 verification | To name |
| Analytics or data science lead | Measurement | J1 to J3 | To name; Nitin names the data science lead (notes §1.2) |
| Tuning owner | After launch | J4 | To name; the director of personalization is the natural candidate (call L76) |
| Release management | 3 | K6, J5 | To name |

### 5.2 Nitin's TBDs, and the gaps in T6 to T8

1. The product types for watches and fragrance (Nitin L195).
2. The full collection list (Nitin L198, "Tabby, Brooklyn, Teri etc").
3. The dollar range of each price band, and whether the ranges differ by category (Nitin L211).
4. The low-stock threshold (Nitin L217, "e.g. 3 or fewer").
5. How often the SFCC inventory feed refreshes (Nitin L218).
6. Bestseller: N, the window (28 days proposed) and the recalculation (daily proposed) (Nitin L222); and what defines a "speed shopper" (Nitin L154).
7. The purchase damping period (30 days proposed) (Nitin L315).
8. The weights: the Weight column of T8 is empty in our copy (Nitin L250 to L254). Do they accept the proposals in §2.4, and is their rank an order of weight, which would put search and add to cart above purchase?
9. Device: T6 names tablet (Nitin L37) and T7 lists only mobile and desktop (Nitin L177).
10. The campaign, the collection or product in the ad and the search keyword theme are part of the entry channel (Nitin L13) but have no T7 values: how are they named in their UTM parameters today?
11. Location: is state level enough, or are census regions such as "Northeast" wanted (Nitin L32)?
12. Time of day: is the time zone from the IP acceptable for "the shopper's local time" (Nitin L180)?
13. Post-purchase: how long a shopper stays post-purchase, and what moves them out (Nitin L54).
14. Gifting intent: which on-site signals count (gift wrap, a gift message, a gift guide visited) (Nitin L59 to L62).
15. Repeat product view: the threshold (three revisits, per A.1 #16) and the window (Nitin L269 to L270).
16. Purchase: "server-confirmed" means sent by the browser after their backend confirms the order, or sent server to server? Who guarantees once per order (Nitin L273)?
17. Size: the SFCC attribute names that hold shoe and ready-to-wear sizes (Nitin L232).
18. Master or variant product IDs in their events and in their content records (T24).
19. Price status on content: T6 uses it to decide whether sale content appears (Nitin L111), while T7 applies it to products only (Nitin L213).
20. Content impression: is the 1-second rule continuous or cumulative, and should it become the learning denominator for the layout (DI-15; Nitin L309 to L310)?
21. Remove from cart: a negative effect now, or captured only until the phase-two decision on negative preference (DI-16)?
22. Synonyms: resolved in their mapping before data reaches us (our recommendation), or by us at ingest (DI-9)?
23. Add to cart by product type, our Phase 1 T8 question, was not answered.
24. Which SFCC attributes and which CMS fields hold each T7 value today, for the mapping table (C2).

### 5.3 The freeze, the kickoff and the 135 days

1. The code-freeze dates and the exception process (T5). Is their tag manager frozen too? Does their lower environment stay open during the freeze? Which release slots exist in January?
2. The kickoff date and who attends; Mandeep wanted their engineering team on the call (call L36).
3. The 135 days: counted from signature or from the kickoff (call L52)? And is our working definition of "the first test launched" theirs (§4.1)?

### 5.4 The holdout and the metric

1. Who writes the primary metric and the secondaries: Mandeep is accountable (call L76 to L78); Abby and their analytics lead are the likely authors (T3; notes position 22).
2. The holdout share, between 5 and 10 percent, and who approves it (notes position 22).
3. Who computes the comparison, in which warehouse, on whose definitions: our recommendation is their analytics, in their Snowflake, on their numbers (notes position 8; J3).
4. The layout's reward: module engagement first, or add to bag (T3; 7 Oct H).
5. Who the tuning owner is after launch (J4).

### 5.5 Other early decisions we need from them

1. The first page: the homepage or the PDP (T2). The PDP was Mandeep's worked example (call L64 to L66); we prepare both either way (notes position 27).
2. Return recognition for shoppers who are not signed in: mode, window, purpose, retention approval (F3). Without it, visit number and recency reset for anyone not signed in once the session capability expires, at most 24 hours after it was last renewed.
3. How much the SMS and brand-search splits matter for the first test's starting orders, which decides whether DI-1 (P36) must land before launch or the interim mapping in §2.5 is enough.
4. The render review: its date and its participants (Rob, George and Pat Mussey; Josh, James and Simone; Harrison West, whom Mandeep asked to join Josh and Simone; call L84).
