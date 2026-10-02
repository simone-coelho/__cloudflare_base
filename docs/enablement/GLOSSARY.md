# Behavioral Targeting and Intelligence: the glossary

Written for a marketer, the least technical reader of this package. Every definition also holds for an account executive and a solutions engineer.

**One word for each meaning, defined once, in plain words.**

## How to read it

Terms are in alphabetical order, one entry each, in two or three sentences. "Deprecated" marks a word that older material uses and this package does not; the entry names the word to use instead. Built, Designed and Open are the package's three labels, and each has its own entry.

## A

**Action weight.** How much one kind of action counts toward an interest, such as a product view, an add to cart or a purchase. The brand sets every weight in its registry, and an action the registry does not name counts nothing. The weights compiled into the code, from 1 for a view to 5 for a purchase, apply only to two older demo scopes.

**Affinity.** Deprecated: say interest. It is the code's word for the same number, and engineers still see it in audience names such as brand_samsung_affinity.

**AI credits.** The meter for AI work that a brand's team does in Opal, such as writing or analyzing; as designed, it follows the team's work and never the site's traffic. Serving a page spends no credit, because the engine calls no AI model to decide. How each line is metered and priced is open.

**AI model.** The engine calls no AI model to decide: each decision is arithmetic over the brand's published settings and counted evidence. Say exactly that, never "we don't use a model", because a place for a customer's own model exists in the code and is switched off by policy. The model calls the product can make sit outside the decision, in optional features such as typed search.

**Asserted.** Said of a value that the caller states instead of the engine observing it, such as a region a presenter picks or a condition a page sends. An asserted region chooses the regional prior only in a demo, where the receipt marks it as asserted; an asserted condition only decides which pieces may show and is never stored as evidence about the visitor.

**Asset.** Deprecated for a unit of content: say piece.

**Attribute.** A field on a product or an event, such as its brand or its price, that a dimension reads its value from. The dimension is what the engine scores; the attribute is where the value comes from.

**Attribution.** Crediting an outcome to the decision that earned it: the same visitor, the same session, the same piece, and the last decision before the outcome. By default a click is credited within 30 minutes, an add to cart within 6 hours and a purchase within 7 days.

**Audience.** A group a visitor belongs to on one dimension value while their interest in it stays high, such as everyone strongly interested in one brand. A visitor joins when their interest reaches the entry line and leaves only when it falls below the lower exit line. Older material says segment or bucket; say audience.

**Autonomy.** The engine changing its own weights. It is in the code, switched off by policy and never offered: a person sets every weight and raises every learning dial.

## B

**Before, during, after.** The three parts of a visitor's session that every piece in this package follows: what the brand sets up before the visitor arrives, what the engine does while they are on the site, and what is counted afterwards. Older material calls them phases; this package does not.

**Behavioral targeting.** The first half of the package's name: the rules and weights the brand's team writes, in force without a software release. It is not the behavioral targeting in other Optimizely products.

**BTIE.** Deprecated: never use it. It is the title of a customer's own paper. Write the package's name in full on first use in a piece, then say the engine.

**Bucket.** Deprecated: older material uses it for four different things. Say visit band for a count of visits, interest for the number kept per dimension value, and audience for a group of visitors.

**Built.** In the code and exercised by tests or by a hosted demo. It is one of the package's three labels, shown in the same color on every page.

## C

**Catalog.** The brand's published content pieces, each with its tags, the slots it may fill and its rules. It holds content, not products: for a customer the engine keeps no product catalog, so product events build interest only when the registry reads the attributes the events carry.

**Cell.** Deprecated for readers: say context. It is the code's word for the same thing.

**CMAB.** Contextual multi-armed bandit, part of Optimizely Feature Experimentation and outside the engine. The engine is not CMAB and depends on no experiment; the CMAB screens in older demos simulate their results.

**Cold start.** What the engine does for a visitor it has no evidence about yet. It reads how the visitor arrived and, where the brand turns it on, what visitors in their region are interested in; census figures on one demo's screen are shown there and never scored.

**Consent.** The visitor's explicit choice, passed by the site from its consent banner, with two switches: tracking and personalization. Nothing is personalized or recorded until the choice arrives, and personalization needs both switches on. A choice lasts 30 days, and without one the visitor sees the site's own defaults.

**Console.** The operator console, where the brand's team signs in to see and change what each slot does: weights, rules, pins, learning dials, what has been learned, receipts and history. A few settings, such as the catalog and arrival seeds, have no screen and are published through the API, still without a software release.

**Content decision service.** Deprecated for readers: an engineering name. Say the engine.

**Context.** The situation a decision is made in: how the visitor arrived, their visit band, their region, their leading interest and their journey stage. Learning keeps its counts per context. Engineers call it a cell.

## D

**D1.** Cloudflare's SQL database. On a customer deployment it holds operator accounts, their grants and the audit trail, not visitor events.

**Day report.** The daily summary, per brand, of outcomes credited to decisions, built each night for the day before. It is labeled an attribution diagnostic: it credits outcomes and makes no claim of lift.

**Decision record.** Deprecated for readers: say receipt.

**Default.** What the site shows when the engine is silent: its own content, in its own order. The site renders its defaults without consent, for a visitor held out in the default arm, and when no decision arrives in time.

**Demo only.** Said of something that runs only on a demo deployment, such as an asserted region choosing the regional prior, or the AI chat and experiment screens in older demos. It is never offered as part of a customer deployment.

**Deployment.** One customer's own copy of the engine, one per environment such as staging and production, with its own storage; engineers call it a stamp. The workflow that sets one up stops before the customer's first configuration, which is open.

**Design-time tagging.** Proposing tags for the brand's content with the brand's own AI model while content is authored; a person approves, rejects or edits every tag before anything is published. It is built, off by default and outside the decision.

**Designed.** In an architecture document, not in the code. It is one of the package's three labels.

**Dimension.** An axis the brand scores on, such as brand, category or price band, named in its registry with the attribute it reads. A brand can publish up to 32.

**Dimension value.** One entry on a dimension, such as brand = samsung. The engine keeps each visitor's interests per dimension value, not per click.

**Diversity cap.** A slot's limit on how many of its pieces may share one dimension value, such as at most two from one brand. A piece over the cap gives way to the next one.

**Drivers.** The reasons listed with each decision: the four strongest interest terms behind it, then any adjustment that applied, such as the regional lean or a merchandising weight. The page's answer carries the drivers; the receipt adds the scores and what is needed to replay the decision.

**Durable Object.** A small named program on Cloudflare with its own private storage, one copy per name, so it is the single writer for what it holds. The engine uses them per visitor, per region and per slot.

**Durable recovery.** A switch that recording a rendered piece depends on. It is off in every configuration, and turning it on needs approved retention periods for its data, which are open.

## E

**Edge.** Cloudflare's network: the engine runs in the data center nearest each request. Say "on Cloudflare's network" or "at the edge", and never attach a speed to either.

**Edge personalization.** Deprecated as a name for the product: write the package's name in full on first use, then say the engine. "At the edge" stays, as a description of where it runs.

**Eligibility.** Whether a piece may be served at all: it must be live, inside its time window, not marked out of stock, and pass its own rule, such as a list of regions. A rule that cannot be checked fails closed, so a region rule shows nothing when the request has no region.

**Engine, the.** What this package calls the product once its full name has been used in a piece. Older names, such as the reflex, the affinity engine or the content decision service, are retired.

**Enrichment.** Deprecated: say design-time tagging.

**Entry and exit lines.** Two levels of interest: a visitor joins an audience when their interest reaches the entry line, 0.6 by default, and leaves only when it falls below the lower exit line, 0.45. The gap stops a visitor flickering in and out, and time alone can take a visitor out of an audience but never put one in.

**Erasure.** Removing a visitor's records when they ask to be forgotten, started from the console. It is bounded and resumable; never call it one call and done, or proof that data is physically erased.

**Event.** One thing a visitor does that the site sends to the engine, such as a product view, an add to cart or a purchase. Each event becomes touches on the dimension values it carries.

**Exclusion.** A piece, a tag or a type of content that a slot never shows, applied before any ranking.

**Explain record.** Deprecated: say receipt.

**Exploration.** Deliberately showing a less-tried piece so that learning can find out how it does. It is built and off by default, which form is offered to a customer is open, and one form, Thompson sampling, is switched off by policy and never offered.

## F

**Fatigue.** A slot rule that lowers a piece's score the more often this visitor has been served it anywhere in the brand, up to a cap. It never takes a score below zero.

**Feature Experimentation.** Optimizely's experimentation product. It is not in the engine's decision path and cannot be connected to a customer deployment today; the engine measures itself with its own holdout.

**First paint.** The first view of a page as the visitor sees it. Deciding it on the site's own server before the browser draws has a source module in the code, and its acceptance on a real site is open, so never claim that nothing flashes.

**Freshness.** A slot rule that favors newer pieces, with a boost that halves over a half-life the brand sets. The age is counted from the piece's freshness date, or else from the start of its window.

## G

**Generation 1, Generation 2.** Generation 2 is the engine this package describes, which the newest demos run on. Generation 1 is the older shared demo pipeline that earlier demos still run on, at an older version of the code.

## H

**Half-life.** Deprecated as a name for the memory (τ), which is a time constant, not a half-life. The evidence behind an interest halves in about 0.69 times τ, about 9.7 days at the default memory of 14 days.

**Holdout.** A share of visitors kept out on purpose so the engine has something to be compared with: they see the site's own defaults, or personalization without learning. Assignment is stable per visitor and draws only visitors who consented; the design of a production experiment is open.

## I

**Intelligence.** The second half of the package's name: counted learning behind a dial, never AI. The engine counts which pieces earn outcomes and changes nothing until a person raises the learning dial.

**Interest.** How strongly a visitor leans toward one dimension value, from 0 up to just under 1, built from their own actions and fading with time. It is a quantity, not a yes or no; an audience is the yes or no drawn from it. The code and older material say affinity.

## J

**Journey stage.** Where a visitor is within a visit: exploring, then considering, then deciding, with the middle stage reported as thinking. By default a visitor reaches considering at their third interaction and deciding at their first purchase, and the brand can publish its own thresholds.

## K

**K.** How much evidence makes an interest half-strength: at the default of 1.8, interest reaches 0.5 when the raw score reaches 1.8. With each view weighted 1, one view gives 0.357, two give 0.526 and three give 0.625, enough to join an audience.

**KV.** Cloudflare's key-value store: fast reads, with writes that take a short while to reach every location. The engine keeps visitor records and published snapshots there.

## L

**Ladder.** Deprecated: older material uses it for three different things. Say regional fallback for region, then country, then everyone; pooling levels for how learning widens its evidence; and never use it for a sequence of offerings.

**Learn document.** The published document that holds the learning and measurement settings: the learning dial for each slot, the holdout, the regional prior, the attribution windows and exploration.

**Learning.** Counting which pieces earn outcomes in which contexts, so that what works can move a piece's score; in this package the word never means building a visitor's interests. It is built, it is counting and never AI, and it moves nothing until a person raises the learning dial. With the SDK as shipped nothing is recorded for it yet, because recording needs each slot set to count rendered pieces and durable recovery switched on, which no configuration has yet.

**Learning dial (γ).** The setting on each slot, from 0 to 1, that decides how much learning may move its scores. It starts at 0, so what is learned moves nothing until a person raises it. Older material calls it the trust dial.

**Ledger.** The store of receipts and outcome records, kept in R2, to which new records are only ever added. An erasure hides a visitor's records at once, and a nightly rewrite then removes them; the day report is built from the ledger.

**Lift.** How much better a piece does than its slot's usual rate in the same context, held between half and double. While the learning dial is at 0 it is computed and recorded, and changes nothing; never quote a lift figure as a result.

## M

**Measurement basis.** Whether a slot counts a decision when it is served or only once the page confirms it drew the piece (rendered). With the SDK as shipped, only a rendered slot records, and that needs durable recovery, which no configuration has on.

**Membership.** Deprecated for readers: say audience. It is the engineers' word for being in one.

**Memory (τ).** How long an interest lasts without new actions, set by the brand in its registry and, if it wants, per dimension. τ is a time constant, not a half-life: the evidence behind an interest falls to about 37 percent after τ and to half after about 0.69 τ. The engine's default is 14 days and the most a brand may set is 90; the production value is open, and a demo may publish a far shorter memory so that a change happens while a presenter talks.

**Merchandising weight.** A multiplier the brand sets on a slot for season, promotion or margin, applied to pieces that carry those values and held within a range, half to double by default. It changes a score; it never overrides the brand's rules.

**Module.** A block of a page's layout, such as a hero, a row of products or a promotions block. When a page's modules are the pieces of one slot, the engine orders them for each visitor and shows why, as on one demo's phone page. Where each slot sits on the page stays the site's own template, and configuring the layout per context is Designed, not built.

## O

**ODP.** Optimizely Data Platform, a separate Optimizely product. The engine's decision reads no ODP data and ODP cannot be connected to a customer deployment today, so older material that calls it the backbone or the memory is out of date.

**Off limits.** A slot the brand marks so that the engine serves nothing there, such as a buy box. The site keeps its own content in that place; the engine never decides it.

**Opal.** Optimizely's AI assistant, a separate product, which is where AI authoring and explanation belong. It is not connected to the engine today, and the engine produces its own reasons as arithmetic, without a model.

**Open.** No decision yet, or the decision belongs to an owner who has not given it. It is one of the package's three labels: an open item is named once, as open, and never promised.

**Operator.** A person on the brand's team with an account and a grant for the brand, who signs in to the console to change settings. Sign-in can go through the brand's own single sign-on.

**Outcome.** A visitor action that counts as success for learning: a click, a dwell, a completed video, a wishlist add, an add to cart, a purchase, or one of two named partner outcomes, a pickup at a partner store or a referral to a partner retailer. A named partner outcome is credited like a click and never reported as a sale.

## P

**Phase.** Deprecated: older material uses it for delivery phases and for parts of a session. Say before, during and after for the session, and step for the implementation path.

**Piece.** One item of the brand's content in the catalog, such as a promotion, a banner or an article, named by the brand's own content id. The engine answers with these ids, and the site renders the pieces.

**Pin.** The brand's instruction that named pieces fill a slot's first positions, before any ranking; the rest of the slot is still ranked, and the receipt says ranking never ran for the pinned pieces. If a pinned piece cannot be served, the whole slot shows nothing, so a pin needs care.

**Placement.** Deprecated: say slot.

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

**Real-time.** Deprecated as a claim about speed. Say what is true: with the visitor's consent, the engine personalizes within their session from their first event, and this package quotes no timing figure.

**Receipt.** The record of one served decision: what was served, in what position, and the arithmetic behind it, with the revisions of the published documents in force. It is written after the answer and only with tracking consent; with the SDK as shipped, only for slots set to count rendered pieces with durable recovery on, which no configuration has yet. Say receipt, never explain record; the page's own answer carries the shorter drivers.

**Recording.** Writing receipts, outcomes and learning counts after an answer, which happens only with tracking consent. A page that asks the engine directly, without the SDK, is recorded, which is how the demos record; with the SDK as shipped, decisions are recorded only for slots set to count rendered pieces with durable recovery switched on, and no configuration has it on yet.

**Reflex.** Deprecated: older material uses it for the engine, for a program kept per visitor and for the registry. Say the engine, or the registry.

**Region.** Where a request comes from, as Cloudflare's network resolves it, written as country and region, such as US-WA. In a demo the opening region is always the visitor's real one; a presenter may assert another, and it is labeled.

**Regional fallback.** When a region has too few events to answer, the engine uses its country, and then everyone. Older material calls this the ladder.

**Regional prior (λ).** What visitors in a stranger's region are interested in, blended with the stranger's own interests while their evidence is thin; λ is the region's share of the blend, 1 for a stranger and falling as their own interests grow. The region's counts come from the site's own events, carry no visitor ids and have a memory of one day. The learn document turns it on or off, and demos seed synthetic regional data and label it.

**Registry.** The brand's published list of dimensions, the attribute each one reads, how much each action counts and how long interest lasts. Engineers call it the reflex document.

**Replay.** Recomputing a past decision from its receipt to show that it comes out the same. It is exact for one slot; never claim it for a whole page.

**Retention.** How long each category of stored data is kept, set for each customer. A category with no period set captures nothing that depends on it, and the actual periods are open.

**Revision.** One saved version of one published document. A rollback writes the old value as a new revision, so the history always shows it.

## S

**Score.** The number that ranks a piece for a visitor in a slot: the visitor's interests in the piece's tags, each multiplied by the slot's weight for that dimension and added up, then adjusted in a fixed order by arrival seeds, journey stage, freshness, fatigue, merchandising weights and, only once its dial is raised, learning. The brand's rules apply before any score.

**SDK.** The engine's browser library, served by the platform: it sends events, receives decisions and lets the site render its defaults when no decision arrives in time. There is no native app SDK; never sell one as available.

**Seed.** A rule that uses how a visitor arrived, before they have shown any interest: the campaign term, the arrival channel, the referring network or the operating system family of their phone. A seed adds a fixed amount to matching pieces, so the visitor's own interests overtake it as those interests grow; seeds are published on the slots document.

**Segment.** Deprecated: say audience.

**Session.** The visitor's time on the site, which this package follows from before they arrive to after they leave. Engineers also use the word for the signed pass the visitor's browser presents, which lasts at most 24 hours; that pass is the shopper capability.

**Session host, object host.** The two places a visitor's interests can live: a record in KV (the session host) or a Durable Object of their own (the object host). Every configuration runs the session host today; the object host is built and held back by a known engine finding.

**Shopper.** The same person as a visitor. Say visitor, except in a retail example.

**Shopper capability.** The signed, short-lived pass the engine gives a visitor's browser for one session, valid for at most 24 hours, which the browser shows on every call. Ids the caller makes up and old cookies grant nothing without it.

**Sign-in merge.** What happens when a visitor signs in: the brand's own server signs a proof of who they are, and their anonymous and signed-in profiles merge, adding interests and overriding nothing. Their account id is never stored as such; they are known by a hash of it, salted on every customer deployment.

**Signal system.** Deprecated: one demo's name for the engine. Say the engine.

**Site key.** The key that identifies the brand's site on every call from its pages. It is not a secret; the engine checks that it belongs to the brand being called.

**Slot.** One place on one page that the engine decides, showing one or more pieces in order. Older material says placement, container, frame or zone; say slot.

**Slot weight (ω).** How much a dimension counts in a slot, from 0 to 1, so one slot can favor brand and another category. The brand sets it in the slots document.

**Slots document.** The published document that lists the brand's pages and their slots, with each slot's take, weights, pins, rules and arrival seeds.

**Stage.** Deprecated on its own: say journey stage, the only stage in this package, and never call a part of learning a stage.

**Stamp.** Deprecated for readers: say customer deployment. It is the engineers' word for one: one Worker per environment, with its own storage.

**Synthetic.** Made up for a demo and labeled as such on screen, such as the regional sales behind a demo's cold start. Synthetic data is never presented as a customer's own.

## T

**Tag.** A dimension value written on a piece, such as brand: samsung, so the engine can score the piece against a visitor's interests. Tags use the registry's vocabulary.

**Take.** How many pieces a slot shows, from 1 to 50.

**Tenant.** One brand's isolated space inside a deployment: everything it owns is kept under its own prefix, and nothing pools across brands. Engineers declare a deployment's tenants, and a page names its tenant on every call.

**Touch.** One hit on one dimension value that an event produces: a single product view can touch its brand, its category and its price band at once. Each touch adds the action's weight to that value's raw score.

**Trust dial.** Deprecated: say learning dial.

**Typed search.** Search in which the brand's own AI model reads what the visitor types before the brand's catalog search fetches results. It is built, off by default, outside the decision, and needs both the model key and the search service to be configured.

## V

**Visit.** A run of activity with no gap of 30 minutes or more; a longer gap starts a new visit. Journey stage is counted per visit.

**Visit band.** How many visits a visitor has made, grouped as first, second or third, and fourth or later; it is part of a decision's context. Older material calls it the visit bucket.

**Visitor.** A person on the site, known to the engine only by a random id until they sign in. Visitor is this package's word; shopper means the same person in retail examples.

## W

**Worker.** A program that runs on Cloudflare's network, in the data center nearest each request. The engine is one Worker per deployment.

**One word for each meaning, defined once, in plain words.**
