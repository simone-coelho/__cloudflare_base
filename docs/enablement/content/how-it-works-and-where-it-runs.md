# Behavioral Targeting and Intelligence: how it works and where it runs

**For pre-sales solutions engineers.** You explain the engine to a customer's technical team. You are at home with a diagram, an API call and a configuration document, and you bring an engineer when the conversation reaches the code. The walk comes first. Each walk section links to its detail, and each detail section links back.

> **Every setting that can change an answer lives in a published, versioned document; the engine does the arithmetic at the edge, calls no AI model to decide, and shows its work on a receipt.**

Three labels mark every capability. **Built**: in the code and exercised. **Designed**: in an architecture document, not in the code. **Open**: no decision yet. No latency or throughput figure appears here, and [B.7](#b7-limits-are-budgets-in-the-code-and-no-timing-may-be-quoted) says why. Every word follows the [Glossary](https://edge-platform-bti.expedge.workers.dev/glossary).

## Part A. The walk

## A.1 The unit of state is the dimension value, not the click

A brand scores on dimensions it chooses, such as brand, category and price band; brand = samsung is one dimension value. For each consenting visitor, the engine keeps an interest in each value the visitor touches. The interest is graded, between 0 and just under 1. It fades: its evidence halves about every 9.7 days at the default memory. One product view can raise its brand, category and price band at once. Pieces of content carry tags in the same vocabulary, and a piece's base score adds up the visitor's interest in each tag, times the slot's weight for that dimension. The engine calls no AI model to decide.

The figure follows one event to one decision.

![From an event to a decision](../figures/decision-path.png)

The detail: [B.1](#b1-the-decision-path-runs-in-a-fixed-order)

## A.2 Ten steps run from the visitor's first call to the learning dial

The steps follow the figure, in order.

1. **Identity and session.** The visitor's first call gives them an anonymous id and a shopper capability, a signed pass for the session valid for at most 24 hours. At sign-in, the anonymous and known profiles merge.
2. **Consent checked.** Nothing is personalized or recorded until the site passes the visitor's explicit choice. Without it, the site's defaults show.
3. **Touches from the event.** An event names an action and carries the product's attributes. Each attribute the registry reads becomes a touch, weighted by the action.
4. **Interest is read.** When the page asks, the visitor's interests are read as they stand at that moment.
5. **The regional prior.** Where the brand turns it on, a stranger leans on their region's interests, less as their own grow. Demo regional data is synthetic, and labeled so.
6. **Candidates are gated.** Only pieces that may be served remain: live, in their window, in stock, and passing their own rule. Pinned pieces are then reserved, before any scoring.
7. **Each piece is scored.** Each piece that is not pinned is scored: the sum of interest times the slot's weight over the piece's tags, then a few published adjustments.
8. **Pins and the diversity cap.** Pinned pieces come first, and are never scored. The rest follow by score, with a cap on pieces that share one value.
9. **The answer and the receipt.** The page gets the brand's content ids in order, with reasons. The receipt keeps the arithmetic and names every document in force by revision. It is kept only with tracking consent, and the shipped SDK keeps none yet.
10. **Outcomes and the dial.** Outcomes are credited and counted, and they move nothing until a person raises the learning dial ([A.5](#a5-learning-counts-outcomes-and-moves-nothing-until-the-dial-moves)).

The detail: [B.1](#b1-the-decision-path-runs-in-a-fixed-order) and [B.3](#b3-the-receipt-shows-the-arithmetic-and-the-day-report-counts-outcomes)

## A.3 It runs on Cloudflare, in a separate deployment for each customer

The engine is one codebase that runs as a Cloudflare Worker: a program on Cloudflare's network, in the data center nearest the request. Each customer gets its own deployment for each environment, staging and production, each with its own storage. Inside a deployment, each brand is an isolated tenant. The table says what each box in the figure is.

![Where the engine runs on Cloudflare](../figures/architecture.png)

| Box | What it is |
|---|---|
| The customer's site | The customer's page and the engine's script in the visitor's browser: it sends consent, events and decision requests, and paints each answer |
| The operator, in the console | Publishes the documents, and reads the receipts and the day report |
| The Worker | The engine's code: it checks access and consent, updates interest, decides and keeps a receipt, drains the queue into the ledger and runs the scheduled jobs |
| The visitor's objects | The visitor's consent choice and the pieces served to them |
| Learning statistics | Pieces shown and outcomes credited, by context, per tenant, brand and slot |
| The regional prior | Interest counts per tenant and region, with no visitor ids |
| Queue to the ledger | Receipts and outcomes, after the answer, with tracking consent |
| The visitor's interest (KV) | The interest record in the key-value store: the session host, the shipped default |
| Published snapshots (KV) | Copies of the regional prior and the learned lift |
| File storage (R2) | The published documents with every revision, the ledger and the day reports |
| Database (D1) | Operator accounts and the audit trail on a customer's deployment; demo datasets on the demo Workers |

Each Worker has its own objects, learning statistics, regional prior and queue. The demo Workers share the four stores in the last rows and keep brands apart by a tenant prefix; a customer's deployment has its own. Keeping a visitor's interests in their own object instead is built, and held back by a known finding. Not drawn: the customer's backend, which signs the identity proof at sign-in; the content source that fills the catalog; the commerce platform, whose product lists the engine re-orders; monitoring; and outside services, which are off by default and never on the decision path.

The detail: [B.4](#b4-a-customer-deployment-has-its-own-store-of-every-kind)

## A.4 Four published documents configure it, and changing them needs no deploy

Four published documents hold the settings. The registry says what is scored, what each action counts and how fast interest fades. The catalog lists the pieces and their tags. The slots document sets each slot's weights, pins and rules. The learn document holds the dials. Each save is validated whole and kept as a new revision, so a rollback is a new revision too. None of it needs a deploy.

The console at `/console/` edits most settings and shows receipts, the day report and the history. Catalog content, arrival seeds and the shape of the dimensions go through the API instead. Worker settings need an engineer: tenants, site keys, allowed origins, secrets, retention and connectors. How a customer deployment gets its first configuration is open.

The detail: [B.2](#b2-the-published-documents-hold-the-settings-an-operator-changes)

## A.5 Learning counts outcomes and moves nothing until the dial moves

With tracking consent, the engine records each decision it serves and each outcome that follows, such as a click or a purchase. It credits an outcome to the last decision for that piece in that session. From those counts it computes a lift for each piece in each context, held between half and double. The lift moves a score only through the learning dial, γ, set per slot. The dial stays at 0 until a person raises it. The day report is an attribution diagnostic, and it claims no lift.

With the shipped SDK, learning records nothing yet. Its decisions are read-only offers, and recording needs the slot set to count rendered pieces, plus durable recovery, which every configuration in the repository holds off. The hosted demos record because their pages ask for decisions directly.

The detail: [B.3](#b3-the-receipt-shows-the-arithmetic-and-the-day-report-counts-outcomes) and [B.2.4](#b24-the-learn-document-holds-the-dials)

## A.6 The site sends events and paints what the engine returns

The site starts a session, passes the visitor's consent choice from its banner, sends events, and asks for a snapshot: the decisions for every slot on a page, in one call. The SDK, served by the engine, carries the session, the events and the decisions. The answer is the brand's own content ids with reasons, and the site always renders. If no answer arrives in time, the site's default renders. For product grids, the engine re-orders the commerce platform's list and never filters it. It holds no product catalog for a customer tenant, so product events build interest only when the registry reads their attributes and the events carry them.

ODP (the Optimizely Data Platform), Feature Experimentation and Opal are not in the decision path, and none is connected to it on a customer deployment today. ODP and Feature Experimentation connections exist for the default demo tenant only, and the demos' Opal assistant is a stand-in. The documented rule is "The engine decides; Opal creates and explains."

The detail: [B.5](#b5-integration-is-a-session-a-consent-choice-events-and-snapshots)

## A.7 Consent comes first, identities are pseudonymous, and tenants are kept apart

Tracking and personalization are two switches, off until the visitor chooses. Each choice lasts 30 days, and with tracking off nothing about the request is written. A visitor is a random id, carried in a shopper capability valid for at most 24 hours. A signed-in visitor is stored as a salted hash, never as the raw account id. The engine reads no device detail beyond the operating system family of the visitor's phone. A customer tenant's data sits under its own prefix, nothing pools across brands, and each customer has its own deployment. Every configuration in the repository enforces access. Retention is explicit per category, with no defaults, and the periods are open.

The detail: [B.6](#b6-privacy-and-security-are-enforced-in-the-request-path)

## A.8 Every claim carries a label: built, designed or open

**Built:** the decision path with consent, tenancy and access; the order of whatever sits in a slot, page modules included; the documents and the console; receipts, and replay of one slot; attribution and the day report; learning with the dial at 0; product re-ranking. **Designed:** position-bias correction, per-context layout configuration, and embeddings. **Open:** a customer deployment's first configuration; ODP and Feature Experimentation on a customer deployment; the retention periods; the production experiment; the production memory settings; the billing meter; timing on the target deployment. The one exception to keep straight: everything after the answer depends on recording, and with the SDK as shipped recording is not switched on yet ([A.5](#a5-learning-counts-outcomes-and-moves-nothing-until-the-dial-moves)).

| Never say | Say instead |
|---|---|
| "We don't use a model." | "It calls no AI model to decide." |
| "It can score with your own model." | "A customer's own model in the score is switched off by policy and not offered." |
| "It decides in N milliseconds." | "We quote timing only from a measurement on your deployment." |
| "It optimizes itself." | "Nothing learned moves a score until a person raises the learning dial. Automatic weight changes and Thompson sampling are switched off by policy and not offered." |
| "It lifted conversion." | "The day report credits outcomes to decisions; it claims no lift." |
| "The page rearranges itself." | "For each visitor, the engine orders whatever sits in a slot, including a stack of page modules, and shows why. Where each slot sits on the page stays the site's own template, and changing the layout by context is a designed next step." |
| "Opal makes the decisions." | "The engine decides; Opal creates and explains. Opal is not connected to the engine today." |

The detail: [B.8](#b8-ten-statuses-come-up-most-and-the-status-page-holds-the-rest) and [B.7](#b7-limits-are-budgets-in-the-code-and-no-timing-may-be-quoted)

## Where AI and credits fit

The engine decides, and it calls no AI model to decide, so serving a page never spends an AI credit, however much traffic grows. AI work that people do, such as writing content, explaining results or analyzing them, is where credits belong, and Opal is that product; it is not connected to the engine today. The engine's own reasons for each decision are arithmetic it produces itself. How each line is metered and priced is monetization's decision and is still open.

The whole boundary is on the credits page, [Where Opal and AI credits fit](https://edge-platform-bti.expedge.workers.dev/credits).

## Part B. The detail

Every engine number here is a default or a limit in the code, not a measurement. "Fixed in code" means changing it needs a software release; the rest are published settings.

## B.1 The decision path runs in a fixed order

Back to the walk: [A.1](#a1-the-unit-of-state-is-the-dimension-value-not-the-click) and [A.2](#a2-ten-steps-run-from-the-visitors-first-call-to-the-learning-dial)

1. **Identity.** The first call mints `vis-<uuid>`, `s-<uuid>` and a shopper capability signed with HMAC-SHA-256, valid for at most 24 hours. The sign-in merge adds faded scores and unions audiences, so nothing is overridden.
2. **Consent.** Personalization needs both switches. With either off, the defaults show and every receipt carries a note. Cookies and request hints can only refuse. A choice lasts 30 days, fixed in code.
3. **Touches.** The action is `data.action`, else `data.eventName`, else `data.event`, else the event type. An action the registry does not name weighs 0. A customer tenant's events count only with `eventAttributes: event-when-unknown`; the default, `catalog-only`, counts nothing. Where the catalog names values on a dimension, an event value outside them builds nothing on it.
4. **Interest.** The registry's defaults are τ 14 days (at most 90), K 1.8, an entry line of 0.6, an exit line of 0.45, a pruning floor of 0.0001 and 24 values per dimension; τ, K and both lines can each be set per dimension. With a view weighing 1, one view gives 0.357, two give 0.526, and three give 0.625, enough to join an audience. Time alone can take a visitor out of an audience, never put one in. The code calls the 14 days "a documented ENGINEERING default, not a customer calibration", and the production value is open.
5. **Journey stage.** A visit ends after 30 idle minutes, fixed in code. The journey stage moves to considering, reported as thinking, at the third interaction, and to deciding at the first purchase, unless the registry's `journey` block says otherwise.
6. **Regional prior.** Touches also count for the visitor's region, with no visitor id, on a 24-hour memory fixed in code. Shares are relative to each dimension's leader. The region answers once it has `minEvents` events, else its country, else everyone: the regional fallback. The compiled default is on, with kBlend 1 and minEvents 30, set in the learn document's `regional` block. An asserted region selects the prior only on the demo profile, with tracking consent, and the receipt says so.
7. **Eligibility.** A piece must be `live`, inside its window, not `inStock: false`, and pass its `eligibleWhen` rule. Region rules match exactly or by country, and fail closed without a region.
8. **Controls and pins.** Off limits, exclusions and allowed types act first. `pinnedPieceIds`, up to 50, is a required prefix served at score 0 and marked `tenant-pinned`. If one cannot be served, the whole slot serves nothing.
9. **Score.** The base is below, with ω from 0 to 1. Then come, in order: the anchor product's complements, arrival seeds (the arrival channel, campaign term, referring network or operating system family), journey stage, freshness, fatigue, merchandising weights (held to half to double by default) and the lift. The external-model term is switched off by policy.
10. **Ranking.** Pieces sort by score, then catalog order, then id, and the top ten are recorded. A diversity cap allows `max` pieces per value, and no piece repeats on a page. With no signal at all, the slot serves catalog order, labeled the default. A slot's pieces can be page modules, painted in the engine's order; where the slot sits is set by the page's template.
11. **After the answer.** With tracking consent only, records go to the queue and file storage, the visitor's ring of recent decisions, and the slot's learning object. [B.5](#b5-integration-is-a-session-a-consent-choice-events-and-snapshots) covers the SDK.

```
event:  R ← R · e^(−Δt/τ) + w,  and the last touch becomes now
read:   a = R / (R + K),  with R faded to now
prior:  λ = kBlend / (kBlend + Σa);  ã = (1 − λ) · a + λ · share
score:  B0 = Σ over the piece's tags of ω[slot, dimension] · ã(value)
learn:  score_final = score · lift^γ
```

Σa adds all the visitor's interests, so a stranger has λ = 1 and is scored on their region's shares.

## B.2 The published documents hold the settings an operator changes

Back to the walk: [A.4](#a4-four-published-documents-configure-it-and-changing-them-needs-no-deploy)

A tenant's published documents are kept in file storage as revisions that never change, alongside its imported priors. A save validates the whole document, returns every error, and records who changed it and why. It must carry `If-Match` and `Idempotency-Key`, so two people cannot overwrite each other. A document is at most 2 MiB. Each decision reads one coherent set of them, and no propagation time is promised. Operators hold a role per tenant and act with a 15-minute token renewed by a 7-day refresh, with optional single sign-on. A brand-new scope answers "uninitialized", and no customer route initializes it.

## B.2.1 The registry says what is scored and how fast it fades

Back to the walk: [A.4](#a4-four-published-documents-configure-it-and-changing-them-needs-no-deploy)

| Field | What it sets | Changed in |
|---|---|---|
| `dimensions` | Key, source field, single or multiple values, band cuts, own τ, K and lines | Console for τ, K and lines; API for the rest |
| `weights` | What each named action adds | Console |
| `tauMs`, `K`, `thetaIn`, `thetaOut`, `epsilon`, `maxValuesPerDim` | Memory, half-strength point, entry and exit lines, pruning floor, values kept | Console |
| `eventAttributes` | `catalog-only` or `event-when-unknown` | API |
| `journey` | The journey-stage thresholds | API |
| `continuity` | Return recognition, off until published with a retention approval | API |

The limits are 32 dimensions, 200 weights and 1,000 values per dimension. Every customer tenant needs its own registry, and counts exactly the weights it publishes.

## B.2.2 The catalog lists the pieces and their tags

Back to the walk: [A.4](#a4-four-published-documents-configure-it-and-changing-them-needs-no-deploy)

A piece needs `id`, `customerContentId` (the brand's id, which the answer returns), `type`, `title`, `tags` and `slotTypes`. Optional fields set its `lifecycle` status, `window`, `eligibleWhen` rule, `merchandising` signals (season, promotion and margin, each 0 to 1), `journeyStageFit`, `freshnessDate`, `featuredProductIds`, `complements`, `inStock` and display fields. An operator imports the catalog as JSON or CSV, or pulls it from a JSON URL. No console screen edits it, and History can roll it back. Its tag values are the vocabulary events must match. It holds content, not products.

## B.2.3 The slots document sets each slot's weights and rules

Back to the walk: [A.4](#a4-four-published-documents-configure-it-and-changing-them-needs-no-deploy)

Pages list their slots, and a slot name is unique across the brand's pages because each one is a learning object. A slot sets `take` (1 to 50), `weights` (ω per dimension), pins (up to 50), off limits, exclusions, allowed types, `stage`, `freshness`, `fatigue`, `complements`, `diversity`, `merchandising` and `seeds` (up to 100 rules). The console's Slot rules screen sets the take, pins, exclusions, weights, journey stage, freshness, fatigue, diversity and merchandising weights; arrival seeds go through the API. No slot setting changes the page's layout or where a slot sits; the page's template sets that. A pinned piece's receipt says "ranking never ran for this piece".

## B.2.4 The learn document holds the dials

Back to the walk: [A.5](#a5-learning-counts-outcomes-and-moves-nothing-until-the-dial-moves)

| Block | Compiled default | Changed in |
|---|---|---|
| `holdout`: share, arms, salt | 5% to `default` | Console, Dials |
| `regional`: on, `kBlend`, `minEvents`, `dimensions` | On, 1, 30, every dimension | Dials; the dimension list by API |
| `policy`: attribution windows | Same session, same piece, last decision; 30 minutes for click, dwell, video and custom outcomes, 6 hours for wishlist and add to cart, 7 days for purchase | Dials |
| `stats`: shrinkage strength n0, the counts' memory, the lift clamp, minimum exposures nMin | 30, 21 days, 0.5 to 2, 30 | Dials |
| Per slot: `gamma`, reward, objective, measurement basis, exploration | 0, click, unit, `served`, off | Dials |
| Item controls: freeze, reject, reset | None | What it has learned |

The compiled default says "Every slot runs at γ = 0 (shadow)". The external-model and autonomy settings are switched off by policy, and inert.

## B.3 The receipt shows the arithmetic, and the day report counts outcomes

Back to the walk: [A.2](#a2-ten-steps-run-from-the-visitors-first-call-to-the-learning-dial) and [A.5](#a5-learning-counts-outcomes-and-moves-nothing-until-the-dial-moves)

A receipt is one record per served position.

| Part | What it holds |
|---|---|
| Who and when | Decision id, tenant, brand, visitor, session, identity anchor, time |
| Where | Page, slot, position, rank after pins, both content ids |
| Candidates | The top ten, with scores |
| Context | Arrival channel, visit band, region, leading interest and journey stage; the arm, the experiment, whether it explored, and the authority: engine, pin or default |
| Configuration | The revision of every document in force |
| Explain | Drivers, `score_base`, the regional block (λ, level, asserted, contribution), seeds, lift, `score_final`, a sentence per rule applied |
| Replay inputs | The visitor's vector as scored, regional shares, served counts |

The drivers list only the four strongest tag terms; the rest sit inside `score_base`. For a stranger, a driver's interest is their region's share. A receipt never holds asserted conditions, the raw event history, the account id, the documents themselves, or candidates beyond ten. Operators read receipts through `/v1/{tenant}/visitors/{id}/receipts` and the console's "Why a shopper saw this". Replay is exact for one slot, never for a whole page. The page's own answer carries only the drivers and the diversity note.

The day report covers one UTC day per tenant and brand. It is built at 03:00 UTC, retried every five minutes from folded hours, and shown in the console's Measurement view. It holds counts, policies, per-slot grids, exploration and holdout rows, visitor and named outcomes, and hour coverage. It labels itself `attribution_diagnostic`, with inference `unavailable` and experimental coverage `not_assessed`, and no window is narrower than a UTC day. Pickup and referral outcomes are credited like a click and never reported as a sale.

## B.4 A customer deployment has its own store of every kind

Back to the walk: [A.3](#a3-it-runs-on-cloudflare-in-a-separate-deployment-for-each-customer)

KV is Cloudflare's key-value store: fast reads, with writes that take a short while to reach every location. R2 is its file storage and D1 its SQL database. A Durable Object, or object, is a small named program with its own storage, one per name, so it is the single writer for what it holds.

| Binding | What it holds | Customer deployment | Demo Workers |
|---|---|---|---|
| `CACHE` (KV) | Regional and lift snapshots, audiences, monitor results | Its own | Shared |
| `SESSIONS` (KV) | Visitor records with interests; identity links | Its own | Shared |
| `STORAGE` (R2) | Published documents, the ledger, hour aggregates, day reports, lift archives, erasure markers | Its own | Shared |
| `DB` (D1) | Operator accounts, sign-in sessions, grants per tenant, service credentials, audit, single sign-on links | Its own, product migrations only | Shared, with demo data |
| `EVENT_QUEUE` (queue and dead-letter queue) | Ledger messages | Its own pair | Its own pair |
| `ANALYTICS` (Analytics Engine) | Monitor points, when retention admits them | Its own | Shared |
| `BROWSER` (Browser Rendering) | A screenshot route | Absent | Refused when enforced |
| `ASSETS` (static files) | Pages, the SDK, the console | Console, SDK, sign-in files | Everything |
| `ShopperReflex` (object per visitor) | Session grants and consent; on the object host, interests and exit alarms | Present | Per Worker |
| `PersonalizationWebSocket` (object per visitor) | The live socket on the session host | Present | Per Worker |
| `DecisionRing` (object per visitor) | The last 200 decisions within 7 days; outcome crediting | Present | Per Worker |
| `RegionTrend` (object per tenant and region) | Interest counts, no visitor ids | Present | Per Worker |
| `LearnStats` (object per tenant, brand and slot) | Exposure and success counts; lift snapshots | Present | Per Worker |
| `RateLimiter` (object per name) | Request counters, the sign-in budget | Present | Per Worker |

| Setting | What it does |
|---|---|
| `DEPLOYMENT_PROFILE=customer` | Only listed operations, the console and the SDK answer; no demo bindings or routes; declared tenants; operators from D1; never an asserted prior; needs enforced access |
| `DEPLOYMENT_PROFILE=demo` | Every route; an asserted region may select the prior, labeled asserted |
| Profile missing or misspelled | Every entry point answers 503 |
| `AUTH_MODE=enforced` | Site key bound to the tenant, operator token and grant, origin allow-list; every configuration in the repository |
| `AUTH_MODE=open` | Gates pass, shopper capability still required; the code's default, used by no configuration in the repository |
| `REFLEX_HOST` | `session` everywhere; `do`, the visitor's own object, built and held back |

A customer deployment omits the legacy and demo-only objects. Scheduled jobs run every five minutes (hour folds, report retries, the monitor, warehouse deliveries), hourly (the regional roll-up) and at 03:00 UTC (the day report and the erasure rewrite), over their own Worker's tenants, so no tenant may sit on two Workers that run them. Three demo Workers exist: a shared one with the older demos on a pinned build, and one each for Top Offers and Vantage on today's engine. Customer deployments change only through the deployment workflow.

## B.5 Integration is a session, a consent choice, events and snapshots

Back to the walk: [A.6](#a6-the-site-sends-events-and-paints-what-the-engine-returns)

| Call | The site sends | It gets back |
|---|---|---|
| `POST /v1/{tenant}/identity/session` | Site key, `X-Tenant` | A shopper capability, `vis-<uuid>`, `s-<uuid>` |
| `POST /realtime/session/preferences` | The visitor's consent choice, bound to their grant | The choice, stored in the visitor's object |
| `POST /realtime/action` | One event, with `X-Shopper-Session`, site key, `X-Tenant` | The product references it could not place |
| `GET` or `POST /v1/{tenant}/decisions/snapshot` | Page, brand, channel, arrival, page instance; on `GET`, up to eight `ctx.<name>` conditions | Per slot, content ids, scores and drivers; document versions; consent and timing sources; experiment assignment |
| `POST /v1/{tenant}/identity/link` | The backend's signature over tenant, visitor, account and expiry | The two profiles merge |
| `POST /sort` | Up to 500 candidates with the registry's attribute fields | The same ids in the visitor's order, with drivers |
| `POST /content/catalog/import` or `/pull` | JSON or CSV, or a URL, from an operator | A new catalog revision |
| `GET /v1/{tenant}/ledger/batches` | A day | Its ledger objects, for a warehouse job |
| `POST /v1/{tenant}/identity/events` | Up to 1,000 history rows, from an operator | Rows faded as late actions |

An event carries its type, the visitor and session ids, the product id with the registry's attribute fields, arrival signals and a timestamp. The snapshot is never cached and is refused above 2 MiB, and its timing fields are not figures to quote. A `ctx` condition only gates the pieces whose rule names it. `/sort` never filters and uses no arrival seeds, merchandising weights, journey stage, learning or pins. It applies the regional prior only where the learn document lists regional dimensions, and at dial 0 it returns the platform's own order.

**The SDK** is served at `/sdk/edge-personalization.js`, with an `.esm.js` twin: Core holds the shopper capability, sessions and transport, Emit sends events, and Listen receives decisions. It captures events through an explicit API, `data-op-*` attributes, a dataLayer adapter with GA4 names, and a renderer callback that acknowledges a paint. It has a listen-only mode, and `identify` and `logout`. If nothing arrives within `hydrateTimeoutMs`, the site's default renders.

**Why the SDK records nothing yet.** It always sends a page instance, which makes its snapshot "a read-only offer: receiving or polling a choice creates no behavioral, ledger or learning exposure". A slot on the `served` basis then records nothing. A slot on the `rendered-v1` basis records when the page acknowledges the paint, but that needs durable recovery, which every configuration holds off. So recording needs the basis set to `rendered-v1` in the learn document and recovery switched on, and switching it on needs approved retention periods for its data first, and those are open. The hosted demos record because they call the snapshot with no page instance.

**What the customer provides.** Each ask says what we need and what we use it for.

| What we need | What we use it for | Who provides it |
|---|---|---|
| The exact origins, scheme and host, that their pages call from, for staging and production | The cross-origin allow-list | The customer's platform team |
| A site key per brand, or we mint one | It identifies the site and binds the tenant on every call from its pages; it is not a secret | Either |
| The registry: the dimensions to score on, the field each one reads, how much each action counts, and the memory | What the engine scores on, and how fast it forgets | The customer, with Professional Services |
| A content feed: each piece's own id, type, title, tags in the registry's vocabulary, slot types, render URL and windows | The catalog the engine ranks | The customer's content team |
| A slot map: the pages, their slots and each slot's default | The slots document; each default renders whenever the engine is silent | The customer's front-end and merchandising owners |
| Product events carrying the product id and the registry's attribute fields | Building interest: the engine holds no product catalog for a customer, so an event without them builds nothing | The customer's tag owner |
| The conversion event: the order id, value, currency and items | Outcomes for attribution and learning | The customer's commerce and analytics owners |
| An explicit consent choice, passed by the site from its consent banner | Without it, nothing personalizes and nothing is recorded | The customer's privacy owner |
| A signed identity proof at sign-in, and the secret behind it | Merging the anonymous and signed-in profiles | The customer's backend |
| Retention periods for each category of data | Required before anything that depends on them is captured, recording included | The customer's privacy owner |
| A person who runs the connection check from inside their network | Proving the network path from their side | The customer |

Optional: candidate product lists from the commerce platform, for product re-ranking; a catalog-search service and a model key, for typed search; and historical rows, which build interests as actions that arrived late.

## B.6 Privacy and security are enforced in the request path

Back to the walk: [A.7](#a7-consent-comes-first-identities-are-pseudonymous-and-tenants-are-kept-apart)

| Area | As built | Where in the code (for engineers) |
|---|---|---|
| Consent | Off until an explicit, scoped choice; two switches; 30 days; tracking off writes nothing | `src/content/consent.ts` |
| Visitor identity | Random ids in an HMAC-SHA-256 shopper capability valid at most 24 hours, required on every call from the visitor's browser; caller-chosen ids and old cookies confer nothing | `src/identity/sessionCapability.ts` |
| Signed-in identity | `sh_` plus a salted hash of the account id; the deployment workflow refuses a salt change | `src/identity/shopperId.ts` |
| Tenant isolation | Keys under `t:<tenant>:`, the default demo tenant aside; marker-carrying input refused; nothing pools across brands | `src/tenancy/tenant.ts` |
| Tenant selection | Path, `X-Tenant`, socket and host must agree on a provisioned tenant | `src/tenancy/middleware.ts` |
| Access | Site key identifies, not a secret; operator token and tenant grant, with a sign-in budget; origin allow-list; security headers | `src/middleware/edgeAccess.ts`, `src/middleware/operatorAuth.ts` |
| Stored, with consent | Pseudonymous ids, interests, visit counters, decision and outcome records, a typed behavior projection, counts with no identifiers | `src/content/types.ts`, `src/ledger/behavior.ts` |
| Never stored | Asserted conditions as evidence, the arrival beyond its channel and fired seeds, device detail beyond the operating system family of the visitor's phone, the raw account id, demo-page credentials | `src/services/platform.ts`, `src/identity/shopperId.ts` |
| Retention | Explicit per tenant and category; a missing category refuses capture; a session ends at the earlier of 30 days and its retention | `src/retention.ts` |
| Erasure | Bounded, resumable local steps, "not ... proof of physical/external erasure"; the visitor's records are hidden at once, and a nightly rewrite over a 90-day ledger window removes them | `src/identity/erase.ts`, `src/ledger/erasure.ts` |
| Logs | Persistent logs off everywhere; fixed phrases and counts | `wrangler.toml` |

The screenshot route can run arbitrary JavaScript, so it needs a token and is refused under enforced access. Open: the retention periods, the disposition of history and physical erasure.

## B.7 Limits are budgets in the code, and no timing may be quoted

Back to the walk: [A.8](#a8-every-claim-carries-a-label-built-designed-or-open)

Latency has been measured only on staging, on 2026-09-05, by a latency run from one machine at forty calls per row and by a load test, and neither has been repeated. By the latency run's own account, the decision step was not measurable at that resolution, a new visitor's first request was dominated by session storage work, and no pilot target was met on the first request that day. A deployed Worker's clock advances with I/O, not computation, so a pure scoring step can read zero without being free. What can be said is a count: per candidate, one lookup and multiply-add per tag value on a weighted dimension, a check per seed tag, up to three merchandising factors and one power. Any timing must come from a fresh run on the target deployment.

| Area | Budget in the code |
|---|---|
| Registry and documents | 32 dimensions, 200 weights, 1,000 values per dimension; 2 MiB per document |
| Slots and rules | 50 pieces, 50 pins, 1,000 exclusions, 100 seed rules; 64 regions and 8 conditions of 32 values per rule |
| Snapshot and sort | 8 `ctx` conditions, an 8 KiB body, a 2 MiB answer; 500 sort candidates in a 2 MiB body |
| Learning and the day report | 256 pieces per slot object; 50,000 records, 16 MiB of raw input, 800 objects and 6 policies per report |
| Queue and import | Batches of 100, concurrency 6, 2 retries, then the dead-letter queue; 1,000 history rows per request |

These are application budgets, not measured capacity. The known findings are build items:

1. The object host stalls the ledger consumer under a burst of snapshots, so every configuration runs the session host.
2. The session host has rare slow reads.
3. Report builds can raise "Configuration publication authority unavailable" in the learning objects.
4. On the session host, an audience flag outlives its score until the visitor's next event; ranking reads the score.
5. The local session-host ledger consumer stalled twice after report builds; the cause is a hypothesis.
6. A busy hour can fail to fold without a logged cause, and the report lists it as missing.
7. Once, on a hosted demo, a receipt was written late after a report build.
8. An ineligible pinned piece empties its whole slot.
9. Every visitor's events feed the regional prior, rehearsals included.
10. The day report has no window under a UTC day, and nothing checks at publish that a listed regional dimension exists.

The architecture board's ruling on these findings is open. Not measured: the production memory on real traffic, ten thousand candidates, the object host under load, a first paint decided on a customer's own server, acceptance on a customer's browser, commerce platform, providers or warehouse, and cost on real traffic.

## B.8 Ten statuses come up most, and the status page holds the rest

Back to the walk: [A.8](#a8-every-claim-carries-a-label-built-designed-or-open)

These are the rows a solutions engineer is asked about most, worded as every piece in the package words them.

| What happens | Verdict |
|---|---|
| A stranger is served from their first event, on how they arrived: the campaign term, the channel, the referring network and the operating system family of their phone. | **Built** |
| Where the brand turns it on, a stranger leans on what their region is interested in, from the site's own events, until their own interests take over. | **Built** |
| A product list from the commerce platform is re-ranked by the visitor's interests, with nothing removed. | **Built** |
| The engine orders whatever sits in a slot for each visitor, a stack of page modules included, and shows why. | **Built** |
| Configuring a page's layout per context, such as by channel or visit; where each slot sits on the page stays the site's own template. | **Designed** |
| A first paint decided on the site's own server: a source module exists, and acceptance on a real site is the open part. | **Open** |
| A receipt records what was served and why; the brand's operators read it in the console, and replay is exact for one slot. | **Built** |
| Learning computes how much better each piece does in each context, and moves nothing until a person raises the learning dial. | **Built** |
| A customer deployment is set up by a workflow that stops before the tenant has its first configuration. | **Open** |
| Connecting ODP or Feature Experimentation to a customer deployment. | **Open** |

Every other row, the path to a customer deployment and the open decisions with their owners are on the status page, [What is built, designed and open](https://edge-platform-bti.expedge.workers.dev/status).

## B.9 A worked example and the engineering documents go deeper

Back to the walk: [Part A](#part-a-the-walk)

The worked example is the Vantage demo. Its interactive page, *How it works*, puts the constants on sliders: [https://edge-platform-vantage.expedge.workers.dev/vantage/how-it-works](https://edge-platform-vantage.expedge.workers.dev/vantage/how-it-works). The demo is at [https://edge-platform-vantage.expedge.workers.dev/vantage/](https://edge-platform-vantage.expedge.workers.dev/vantage/).

| For an engineer | What it covers |
|---|---|
| The integration kit under `docs/kit` | The overview, the integration guide, the API reference and the staging connection check |
| `docs/kit/03-payload-schemas.md` | The payload schemas |
| The SDK's notes under `src/sdk` | The SDK |
| `docs/deployment/01-deploy.md` | The deployment workflow |
| `docs/architecture/28-operator-surfaces-evaluation.md` | The console's design |
| The architecture documents under `docs/architecture` | Learning, the audit of what is verified, and the rest of the design |

These are internal engineering documents: never forward one to a customer.

> **Every setting that can change an answer lives in a published, versioned document; the engine does the arithmetic at the edge, calls no AI model to decide, and shows its work on a receipt.**
