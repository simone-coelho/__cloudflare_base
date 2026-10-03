# Behavioral Targeting and Intelligence: the glossary

Written for a marketer, the least technical reader of this package. Every definition also holds for an account executive and a solutions engineer.

> **One word for each meaning, defined once, in plain words.**

## How to read it

Terms are in alphabetical order, one entry each, in two or three sentences. "Deprecated" marks a word that older material uses and this package does not; the entry names the word to use instead.

## A

**Action weight.** How much one kind of action counts toward an interest, such as a product view, an add to cart or a purchase. The brand sets every weight in its registry, a purchase counting for more than a view, and an action the registry does not name counts nothing.

**Affinity.** Deprecated: say interest. It is the code's word for the same number, and engineers still see it in audience names such as brand_samsung_affinity.

**AI credits.** The meter for AI work: what a brand's team asks of Opal, and the optional AI add-ons a visitor uses. Credits follow that work, never the site's traffic: serving a page spends no credit, because the engine calls no AI model to decide.

**AI model.** The engine calls no AI model to decide: each decision is arithmetic over the brand's published settings and counted evidence. Say exactly that, never "we don't use a model": AI works around the decision, in Opal and in the optional AI add-ons a visitor may use, such as AI search.

**Asserted.** Said of a value that the caller states instead of the engine observing it, such as a region a presenter picks to show a contrast, or a condition a page sends. An asserted condition only decides which pieces may show and is never stored as evidence about the visitor, and an asserted region is marked as asserted on the receipt.

**Asset.** Deprecated for a unit of content: say piece.

**Attribute.** A field on a product or an event, such as its brand or its price, that a dimension reads its value from. The dimension is what the engine scores; the attribute is where the value comes from.

**Attribution.** Crediting an outcome to the decision that earned it: the same visitor, the same session, the same piece, and the last decision before the outcome. By default a click is credited within 30 minutes, an add to cart within 6 hours and a purchase within 7 days.

**Audience.** A group a visitor belongs to on one dimension value while their interest in it stays high, such as everyone strongly interested in one brand. A visitor joins when their interest reaches the entry line and leaves only when it falls below the lower exit line. Older material says segment; say audience.

**Autonomy.** The engine changing its own weights by itself, which it never does: a person sets every weight and turns every learning dial. Suggestions, such as a pattern found in the brand's results, reach a person through Opal for approval.

## B

**Before, during, after.** The three parts of a visitor's session: what the brand sets up before the visitor arrives, what the engine does while they are on the site, and what is counted afterwards. Older material calls them phases; this package does not.

**Behavioral targeting.** The first half of the package's name: the rules and weights the brand's team writes, in force without a software release. It is not the behavioral targeting in other Optimizely products.

**BTIE.** Deprecated: never use it. It is the title of a customer's own paper. Write the package's name in full on first use in a piece, then say the engine.

**Bucket.** The plain image of one interest: it fills with each action the visitor takes and drains with time. Each bucket has an entry line, a release line and a cap, so nobody writes expiration rules.

## C

**Catalog.** The brand's published content pieces, each with its tags, the slots it may fill and its rules. It holds content, not products: for a customer the engine keeps no product catalog, so product events build interest only when the registry reads the attributes the events carry.

**Cell.** Deprecated for readers: say context. It is the code's word for the same thing.

**CMAB.** Contextual multi-armed bandit, a capability of Optimizely Feature Experimentation. The engine is not CMAB and does not depend on it; where the brand wants a test, Opal can propose and launch an experiment or a CMAB test on a slot, beside the engine's own decisions.

**Cold start.** What the engine does for a visitor it has no evidence about yet. It reads how the visitor arrived and what visitors in their region are interested in, from the brand's own sales where its warehouse supplies them; public census figures can explain that lean on screen and never enter the score.

**Consent.** The visitor's explicit choice, passed by the site from its consent banner, with two switches: tracking and personalization. Nothing is personalized or recorded until the choice arrives, and personalization needs both switches on. A choice lasts 30 days, and without one the visitor sees the site's own defaults.

**Console.** The operator console, where the brand's team signs in to see and change what each slot does: weights, rules, pins, seeds, learning dials, what has been learned, receipts and history. Every setting can also be changed through the API, and either way the change is in force without a software release.

**Content decision service.** Deprecated for readers: an engineering name. Say the engine.

**Context.** The situation a decision is made in: how the visitor arrived, their visit band, their region, their leading interest and their journey stage. Learning keeps its counts per context. Engineers call it a cell.

## D

**D1.** Cloudflare's SQL database. On a customer deployment it holds operator accounts, their grants and the audit trail, not visitor events.

**Day report.** The daily summary, per brand, of outcomes credited to decisions, compiled each night for the day before. It is labeled an attribution diagnostic: it credits outcomes and makes no claim of lift.

**Decision record.** Deprecated for readers: say receipt.

**Default.** What the site shows when the engine is silent: its own content, in its own order. The site renders its defaults without consent, for a visitor held out in the default arm, and when no decision arrives in time.

**Deployment.** One customer's own copy of the engine, one per environment such as staging and production, with its own storage; engineers call it a stamp.

**Design-time tagging.** Proposing tags for the brand's content with AI while the content is prepared, through Opal or the brand's own model; a person approves, rejects or edits every tag before anything is published. It sits outside the decision.

**Dimension.** An axis the brand scores on, such as brand, category or price band, named in its registry with the attribute it reads. A brand can publish up to 32.

**Dimension value.** One entry on a dimension, such as brand = samsung. The engine keeps each visitor's interests per dimension value, not per click.

**Diversity cap.** A slot's limit on how many of its pieces may share one dimension value, such as at most two from one brand. A piece over the cap gives way to the next one.

**Drivers.** The reasons listed with each decision: the four strongest interest terms behind it, then any adjustment that applied, such as the regional lean or a merchandising weight. The page's answer carries the drivers; the receipt adds the scores and what is needed to replay the decision.

**Durable Object.** A small named program on Cloudflare with its own private storage, one copy per name, so it is the single writer for what it holds. The engine uses them per visitor, per region and per slot.

## E

**Edge.** Cloudflare's network: the engine runs in the data center nearest each request, close to the visitor. Say "on Cloudflare's network" or "at the edge".

**Edge personalization.** Deprecated as a name for the product: write the package's name in full on first use, then say the engine. "At the edge" stays, as a description of where it runs.

**Eligibility.** Whether a piece may be served at all: it must be live, inside its time window, not marked out of stock, and pass its own rule, such as a list of regions. A rule that cannot be checked fails closed, so a region rule shows nothing when the request has no region.

**Engine, the.** What this package calls the product once its full name has been used in a piece. Older names, such as the reflex, the affinity engine or the content decision service, are retired.

**Enrichment.** Deprecated: say design-time tagging.

**Entry and exit lines.** Two levels of interest: a visitor joins an audience when their interest reaches the entry line, 0.6 by default, and leaves only when it falls below the lower exit line, 0.45. The gap stops a visitor flickering in and out, and time alone can take a visitor out of an audience but never put one in. Leaving is the release, and the receipt records it as it records the entry.

**Erasure.** Removing a visitor's records when they ask to be forgotten, started from the console. It is bounded and resumable; never call it one call and done, or proof that data is physically erased.

**Event.** One thing a visitor does that the site sends to the engine, such as a product view, an add to cart or a purchase. Each event becomes touches on the dimension values it carries.

**Exclusion.** A piece, a tag or a type of content that a slot never shows, applied before any ranking.

**Explain record.** Deprecated: say receipt.

**Exploration.** Deliberately showing a less-tried piece on a share of decisions the brand sets, so that learning finds out how it does. It stays off unless the brand turns it on.

## F

**Fatigue.** A slot rule that lowers a piece's score the more often this visitor has been served it anywhere in the brand, up to a cap. It never takes a score below zero.

**Feature Experimentation.** Optimizely's experimentation product, which the engine links with: an experiment or a CMAB test can run on any slot, beside the engine's own decisions. It is never in the engine's decision path, and the engine also measures itself with its own holdout.

**First paint.** The first view of a page as the visitor sees it. The brand's own server can fetch the first page's decisions before the page is sent, so the content above the fold arrives already chosen.

**Freshness.** A slot rule that favors newer pieces, with a boost that halves over a half-life the brand sets. The age is counted from the piece's freshness date, or else from the start of its window.

## G

**Gate.** A rule that removes what may not show before anything is ranked: a piece out of stock, outside its window or outside its region, or one the slot excludes. Gates run first, then pins, then ranking, and the receipt names which of the three decided each place. A pinned piece that a gate removes is simply not shown, and the rest of the slot ranks as usual.

## H

**Half-life.** Deprecated as a name for the memory (τ), which is a time constant, not a half-life. The evidence behind an interest halves in about 0.69 times τ, about 9.7 days at the default memory of 14 days.

**Holdout.** A share of visitors kept out on purpose so there is always something to compare against: they see the site's own defaults, or personalization without learning. Assignment is stable per visitor and draws only visitors who consented, and the brand measures lift by comparing the groups on its own numbers.

## I

**Intelligence.** The second half of the package's name: counted learning behind a dial, never AI. The engine counts which pieces earn outcomes and changes nothing until a person raises the learning dial.

**Interest.** How strongly a visitor leans toward one dimension value, from 0 up to just under 1, filling like a bucket with their own actions and draining with time. It is a quantity, not a yes or no; an audience is the yes or no drawn from it. The code and older material say affinity.

## J

**Journey stage.** Where a visitor is within a visit: exploring, then considering, then deciding, with the middle one reported as thinking. By default a visitor reaches considering at their third interaction and deciding at their first purchase, and the brand can publish its own thresholds.

## K

**K.** How much evidence makes an interest half-strength: at the default of 1.8, interest reaches 0.5 when the raw score reaches 1.8. With each view weighted 1, one view gives 0.357, two give 0.526 and three give 0.625, enough to join an audience.

**KV.** Cloudflare's key-value store: fast reads, with writes that take a short while to reach every location. The engine keeps visitor records and published snapshots there.

## L

**Ladder.** Deprecated: older material uses it for three different things. Say regional fallback for region, then country, then everyone; pooling levels for how learning widens its evidence; and never use it for a sequence of offerings.

**Learn document.** The published document that holds the learning and measurement settings: the learning dial for each slot, the holdout, the regional prior, the attribution windows and exploration.

**Learning.** Counting which pieces earn outcomes in which contexts, so that what works can move a piece's score; in this package the word never means building a visitor's interests. It is counting, never AI. It records what works from the first day and changes nothing until the brand turns the dial.

**Learning dial (γ).** The setting on each slot, from 0 to 1, that decides how much learning may move its scores. It starts at 0, so what is learned moves nothing until a person raises it. Older material calls it the trust dial.

**Ledger.** The store of receipts and outcome records, kept in R2, to which new records are only ever added. An erasure hides a visitor's records at once, and a nightly rewrite then removes them; the day report is compiled from the ledger.

**Lift.** How much better a piece does than its slot's usual rate in the same context, held between half and double. While the learning dial is at 0 it is computed and recorded, and changes nothing; never quote a lift figure as a result.

## M

**Measurement basis.** Whether a slot counts a decision when it is served, or only once the page confirms it drew the piece (rendered), so that only what the visitor could see is counted.

**Membership.** Deprecated for readers: say audience. It is the engineers' word for being in one.

**Memory (τ).** How long an interest lasts without new actions, set by the brand in its registry and, if it wants, per dimension. τ is a time constant, not a half-life: the evidence behind an interest falls to about 37 percent after τ and to half after about 0.69 τ. The engine's default is 14 days and the most a brand may set is 90, and a demo may publish a far shorter memory so that a change happens while a presenter talks.

**Merchandising weight.** A multiplier the brand sets on a slot for season, promotion or margin, applied to pieces that carry those values and held within a range, half to double by default. It changes a score; it never overrides the brand's rules.

**Module.** A block of a page's layout, such as a hero, a recommendations carousel, a category grid or reviews. The engine orders a page's modules for each visitor and context, not only what goes inside them, and holds pinned or locked modules where the brand put them.

## O

**ODP.** Optimizely Data Platform, a separate Optimizely product the engine links with. Events, the audiences the engine forms and each visitor's journey stage land in it as lasting facts, and a recognized visitor's interests can be restored from it; decisions never wait on it.

**Off limits.** A slot the brand marks so that the engine serves nothing there, such as a buy box. The site keeps its own content in that place; the engine never decides it.

**Opal.** Optimizely's AI assistant, which works with the engine: it authors audiences and tests, explains results, tags content, and proposes and launches experiments on signals. It never takes part in a live decision; the engine produces its own reasons as arithmetic, and Opal is where people ask and generative AI creates.

**Operator.** A person on the brand's team with an account and a grant for the brand, who signs in to the console to change settings. Sign-in can go through the brand's own single sign-on.

**Outcome.** A visitor action that counts as success for learning: a click, a dwell, a completed video, a wishlist add, an add to cart, a purchase, or one of two named partner outcomes, a pickup at a partner store or a referral to a partner retailer. A named partner outcome is credited like a click and never reported as a sale.

## P

**Phase.** Deprecated: older material uses it for delivery phases and for parts of a session. Say before, during and after for the session, and step for the implementation path.

**Piece.** One item of the brand's content in the catalog, such as a promotion, a banner or an article, named by the brand's own content id. The engine answers with these ids, and the site renders the pieces.

**Pin.** The brand's instruction that a named piece holds the place the brand sets in a slot, first or any other, before any ranking, such as a placement the brand sells; the rest of the slot is still ranked around it. A pinned piece that may not show, such as one out of stock, is simply not shown, and the rest of the slot ranks as usual. The receipt says ranking never ran for the pinned piece.

**Placement.** A section of a page that a merchandiser sells or reserves, such as a spot a partner pays for or a funded campaign. The engine honors it through a pin, so it holds the place the brand set while the rest is ranked around it, and the receipt says so.

**Pooling levels.** How learning widens its evidence when a context has too little: from the full context through coarser ones to everyone, using the finest level with enough exposures. Older material calls this the pooling ladder.

**Prior.** What the engine assumes before it has evidence. This package meets three kinds: the regional prior for a stranger's interests, a slot's usual rate that a new piece's learning starts from, and imported priors, a warehouse's starting beliefs per piece and context.

**Product re-ranking.** Reordering a product list that the commerce platform supplies, by the visitor's interests, without removing anything. With its dial at 0 the platform's own order comes back unchanged.

**Publication set.** Deprecated for readers: say published documents.

**Published documents.** The brand's versioned settings: the registry, the catalog, the slots document and the learn document, plus imported priors and retained proposals. Every save is a new revision recording who changed it and why, and it is in force without a software release.

## Q

**Queue.** A message queue: work handed off during a request and done moments later, such as writing receipts to the ledger.

## R

**R2.** Cloudflare's file storage. The engine keeps the published documents, the ledger and the day reports there.

**Raw score (R).** The running total behind an interest: each action adds its weight, and the total fades with time. Interest is R divided by R plus K.

**Receipt.** The record of one served decision: what was served, in what position, and the arithmetic behind it, with the revisions of the published documents in force, so a person can recompute it. It is written after the answer, with the visitor's consent. Say receipt, never explain record; the page's own answer carries the shorter drivers.

**Recording.** Writing receipts, outcomes and learning counts after an answer, with the visitor's consent. It runs from the first day, so what works is known before the brand turns the learning dial.

**Reflex.** Deprecated: older material uses it for the engine, for a program kept per visitor and for the registry. Say the engine, or the registry.

**Region.** Where a request comes from, as Cloudflare's network resolves it, written as country and region, such as US-WA. In a demo the opening region is always the visitor's real one; a presenter may assert another, and it is labeled.

**Regional fallback.** When a region has too few events to answer, the engine uses its country, and then everyone. Older material calls this the ladder.

**Regional prior (λ).** What visitors in a stranger's region are interested in, blended with the stranger's own interests while their evidence is thin; λ is the region's share of the blend, 1 for a stranger and falling as their own interests grow. The region's counts come from the site's own events, with a memory of one day, and can start from the brand's own sales by region; they carry no visitor ids. The learn document turns it on or off, and demos seed synthetic regional data and label it.

**Registry.** The brand's published list of dimensions, the attribute each one reads, how much each action counts and how long interest lasts. Engineers call it the reflex document.

**Replay.** Recomputing a past decision from its receipt to show that it comes out the same. It is exact for one slot; never claim it for a whole page.

**Retention.** How long each category of stored data is kept, set for each customer. A category with no period set captures nothing that depends on it.

**Revision.** One saved version of one published document. A rollback writes the old value as a new revision, so the history always shows it.

## S

**Score.** The number that ranks a piece for a visitor in a slot: the visitor's interests in the piece's tags, each multiplied by the slot's weight for that dimension and added up, then adjusted in a fixed order by arrival seeds, journey stage, freshness, fatigue, merchandising weights and, only once its dial is raised, learning. The brand's rules apply before any score.

**SDK.** The engine's browser library, served by the platform: it sends events, receives decisions and lets the site render its defaults when no decision arrives in time. There is no native app SDK; never sell one as available.

**Seed.** A rule that uses how a visitor arrived, before they have shown any interest: the campaign term, the arrival channel, the referring network or the operating system family of their phone. A seed adds an amount the brand publishes to matching pieces, lowered when the visitor's own audiences point elsewhere, and the visitor's own interests overtake it as they grow; seeds are published on the slots document.

**Segment.** Deprecated: say audience.

**Session.** The visitor's time on the site, which this package follows from before they arrive to after they leave. Engineers also use the word for the signed pass the visitor's browser presents, which lasts at most 24 hours; that pass is the shopper capability.

**Session host, object host.** The two places a visitor's interests can live: a record in KV (the session host) or a Durable Object of their own (the object host).

**Shopper.** The same person as a visitor. Say visitor, except in a retail example.

**Shopper capability.** The signed, short-lived pass the engine gives a visitor's browser for one session, valid for at most 24 hours, which the browser shows on every call. Ids the caller makes up and old cookies grant nothing without it.

**Sign-in merge.** What happens when a visitor signs in: the brand's own server signs a proof of who they are, and their anonymous and signed-in profiles merge, adding interests and overriding nothing. Their account id is never stored as such; they are known by a hash of it, salted on every customer deployment.

**Signal system.** Deprecated: one demo's name for the engine. Say the engine.

**Site key.** The key that identifies the brand's site on every call from its pages. It is not a secret; the engine checks that it belongs to the brand being called.

**Slot.** One place on one page that the engine decides, showing one or more pieces in order. Older material says container, frame or zone; say slot.

**Slot weight (ω).** How much a dimension counts in a slot, from 0 to 1, so one slot can favor brand and another category. The brand sets it in the slots document.

**Slots document.** The published document that lists the brand's pages and their slots, with each slot's take, weights, pins, rules and arrival seeds.

**Stage.** Deprecated on its own: say journey stage, the only stage in this package. Never call a part of learning, or a step in delivering the product, a stage.

**Stamp.** Deprecated for readers: say customer deployment. It is the engineers' word for one: one Worker per environment, with its own storage.

**Synthetic.** Made up for a demo and labeled as such on screen, such as the regional sales behind a demo's cold start. Synthetic data is never presented as a customer's own.

## T

**Tag.** A dimension value written on a piece, such as brand: samsung, so the engine can score the piece against a visitor's interests. Tags use the registry's vocabulary.

**Take.** How many pieces a slot shows, from 1 to 50.

**Tenant.** One brand's isolated space inside a deployment: everything it owns is kept under its own prefix, and nothing pools across brands. Engineers declare a deployment's tenants, and a page names its tenant on every call.

**Touch.** One hit on one dimension value that an event produces: a single product view can touch its brand, its category and its price band at once. Each touch adds the action's weight to that value's raw score.

**Trust dial.** Deprecated: say learning dial.

**Typed search.** Search in which an AI model reads what the visitor types, the brand's catalog search fetches results, and the engine ranks them for that visitor; also called AI search. It is one of the optional AI add-ons, outside the decision, which a brand switches on with its credits.

## V

**Visit.** A run of activity with no gap of 30 minutes or more; a longer gap starts a new visit. Journey stage is counted per visit.

**Visit band.** How many visits a visitor has made, grouped as first, second or third, and fourth or later; it is part of a decision's context. Older material calls it the visit bucket.

**Visitor.** A person on the site, known to the engine only by a random id until they sign in. Visitor is this package's word; shopper means the same person in retail examples.

## W

**Worker.** A program that runs on Cloudflare's network, in the data center nearest each request. The engine is one Worker per deployment.

> **One word for each meaning, defined once, in plain words.**
