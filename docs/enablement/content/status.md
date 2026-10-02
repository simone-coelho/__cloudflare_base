# Behavioral Targeting and Intelligence: what is built, designed and open

**For anyone at Optimizely who must know what may be claimed today.** Each row says what happens, its verdict, and what to keep straight about it.

> **Claim only what is Built; name what is Designed; say what is Open.**

Built: in the code and exercised. Designed: in an architecture document, not in the code. Open: no decision yet.

Engine facts as of commit 8b4f74c, October 2, 2026. Every word follows the [Glossary](https://edge-platform-bti.expedge.workers.dev/glossary), and how each row works is in [How it works and where it runs](https://edge-platform-bti.expedge.workers.dev/how-it-works).

## Before the visitor arrives, the brand sets the rules

| What happens | Verdict | Caveat |
|---|---|---|
| The brand chooses the dimensions it scores on, the attribute each reads, how much each action counts and how long interest lasts, in its registry. | **Built** | Every customer tenant publishes its own registry and counts only the weights it names |
| The brand's own content pieces arrive by import or pull, tagged in the registry's vocabulary; no console screen edits them. | **Built** | |
| The brand maps its pages and slots: how many pieces each slot shows, its weights, pins, rules, exclusions and off-limits places. | **Built** | |
| The site keeps its own defaults, and they render whenever the engine is silent. | **Built** | |
| The site's consent banner passes the visitor's explicit choice; nothing happens without it. | **Built** | |
| Product events carry the attributes the registry reads, because the engine holds no product catalog for a customer. | **Built** | |
| Every rule and weight the brand sets is a published, versioned document, in force without a software release, with its history and a rollback that is itself a new revision; identity and access settings are worker configuration set by an engineer. | **Built** | No propagation time is promised |
| The brand's team works in the operator console; engineers set the deployment's own settings, such as its tenants, keys, allowed origins and retention. | **Built** | The catalog and arrival seeds have no console screen and are published through the API |
| Each brand is a tenant: everything it owns sits under its own prefix, and nothing pools across brands. | **Built** | Engineers declare a deployment's tenants |
| Design-time tagging with the brand's own AI model, outside the decision; a person approves every tag before anything is published. | **Built** | Off by default; it needs provider approvals, and sample calibration is open |
| A customer deployment is set up by a workflow that stops before the tenant has its first configuration. | **Open** | No customer route gives a tenant its first configuration yet |
| A customer deployment admits connectors for telemetry, design-time tagging, search, catalog search and the warehouse. | **Built** | |
| Connecting ODP or Feature Experimentation to a customer deployment. | **Open** | An ODP loop runs for the default demo tenant only, and the CMAB screens in older demos simulate their results: both demo only |
| Opal authoring and explanation. | **Open** | Not connected to the engine today; the demos' assistant is a stand-in, demo only |
| Retention periods for each category of data. | **Open** | |
| Imported priors from a warehouse's own history; built, and not yet used on a hosted demo. | **Built** | |

## While the visitor browses, the engine ranks what is left

| What happens | Verdict | Caveat |
|---|---|---|
| Nothing is personalized or recorded until the visitor's consent choice arrives; without it they see the site's defaults. | **Built** | |
| A stranger is served from their first event, on how they arrived: the campaign term, the channel, the referring network and the operating system family of their phone. | **Built** | Arrival seeds are published in the slots document, with no console screen |
| Where the brand turns it on, a stranger leans on what their region is interested in, from the site's own events, until their own interests take over. | **Built** | The demos seed synthetic regional data and label it; a region a presenter asserts chooses the prior in a demo only, and is labeled |
| Census figures beside a stranger's regional lean, on one demo's screen. | **Built** | Demo only: shown, never scored, and not an input to the engine |
| Each action adds to a graded, fading interest per dimension value, and audiences form and dissolve on two lines. | **Built** | The production memory and lines are an owner input |
| The brand's rules come first: eligibility (windows, stock, regions and named conditions), pins, exclusions and off-limits slots, all before any ranking. A pinned piece that cannot be served empties its whole slot. | **Built** | A named condition is asserted by the caller and only gates |
| The score ranks what is left: the visitor's interests times the slot's weights, then arrival seeds, journey stage, freshness, fatigue and merchandising weights, in that order, and learning only once its dial is raised. | **Built** | |
| Pieces that complete the product on the page, the anchor product, are preferred where a slot asks for it. | **Built** | Not yet on a hosted demo; the page names the anchor product, and each piece lists what it completes |
| A diversity cap per slot, and no piece twice on a page. | **Built** | |
| The answer is the brand's own content ids in order, each with its reasons, and the site renders them. | **Built** | |
| The engine orders whatever sits in a slot for each visitor, a stack of page modules included, and shows why. | **Built** | |
| Configuring a page's layout per context, such as by channel or visit; where each slot sits on the page stays the site's own template. | **Designed** | The first build item. On the demo homepages the page's own script places the slots, standing in for the customer's content system: demo only |
| A product list from the commerce platform is re-ranked by the visitor's interests, with nothing removed. | **Built** | Each product must carry the registry's attribute fields |
| A paid-search arrival is classified from an auto-tagged click. | **Built** | The classification only: the event contract still refuses the click id, so it does not yet work end to end |
| At sign-in the visitor's anonymous and signed-in profiles merge, overriding nothing. | **Built** | The brand's own server signs the proof |
| A returning visitor can be recognized without signing in, once the brand publishes the rules for it. | **Built** | |
| The production window and purpose for recognizing a returning visitor. | **Open** | |
| Typed search with the brand's own AI model, outside the decision; off by default. | **Built** | It needs the model key and the search service, and live acceptance is open |
| No AI model in the decision. | **Built** | |
| A first paint decided on the site's own server: a source module exists, and acceptance on a real site is the open part. | **Open** | |
| A semantic term from embeddings. | **Designed** | No embedding code yet |
| An exit pushed at the exact moment an interest crosses its line runs on the object host, which no deployment uses today; on the session host the exit is computed at the next read. | **Built** | |

## After each answer, the engine counts what worked

| What happens | Verdict | Caveat |
|---|---|---|
| Receipts, outcomes and learning counts are recorded only with the visitor's consent. A page that asks the engine directly is recorded when its slots use the default served basis; with the SDK as shipped, a slot is recorded only when it is set to count rendered pieces and durable recovery is on, and no configuration has it on yet. | **Built** | |
| A receipt records what was served and why; the brand's operators read it in the console, and replay is exact for one slot. | **Built** | The receipt lists the four strongest tag terms; weaker ones sit inside the base score |
| Outcomes are credited to the decision that earned them, within windows the brand can set; a named partner outcome is never reported as a sale. | **Built** | Named partner outcomes are not yet on a hosted demo |
| The day report is an attribution diagnostic, with no claim of lift. | **Built** | |
| Learning computes how much better each piece does in each context, and moves nothing until a person raises the learning dial. | **Built** | |
| Holdout arms; the demos run none. | **Built** | |
| The design of a production experiment. | **Open** | |
| Exploration, built and off by default. | **Built** | |
| Which form of exploration a customer is offered. | **Open** | |
| Position-bias correction. | **Designed** | A build item |
| Erasure: bounded and resumable, and not proof of physical erasure. | **Built** | |
| A daily listing of the ledger for a warehouse job; direct warehouse delivery is built, off by default, and not yet verified live. | **Built** | |
| A usage meter for billing, and its rates. | **Open** | |

The one exception to keep straight: everything after the answer depends on recording. With the SDK as shipped, recording is not switched on yet, because it needs each slot set to count rendered pieces and durable recovery, which no configuration has.

## The path to a customer deployment is built up to its first configuration

| Step | What exists | Verdict |
|---|---|---|
| Set up a customer deployment | A workflow that plans, packages, creates, reconciles, adds a brand, rotates, uploads, promotes, rolls back and restores. Its changing steps need an explicit execute flag, a protected authorization record and evidence, and it is not deployment approval | **Built** |
| Secrets and settings | The required secrets and settings are validated | **Built** |
| The database | Product migrations only, for operator accounts, audit, authority and single sign-on; demo migrations and demo data are never loaded on a customer deployment | **Built** |
| The first operator | One initial owner, set up with a temporary password | **Built** |
| The tenant's first configuration | No customer route; a library capability only | **Open** |
| Connectors for telemetry, design-time tagging, search, catalog search and the warehouse | Admitted by the workflow | **Built** |
| Connectors for ODP and Feature Experimentation | Not admitted | **Open** |
| Durable recovery, which rendered measurement needs | Off by default; switching it on needs approved retention periods for its data | **Open** |
| Connecting the site | The integration kit: the SDK, the API reference, payload schemas and a staging connection check | **Built** |
| The services motion | A runbook and an engagement frame describe it; the runbook's fleet manifest and automated wire-check gate are not in the repository | **Designed** |
| The live gates | Account ownership, provider permissions, approved retention and access, a real quiescence check, and customer and release acceptance | **Open** |

## Fourteen decisions are open, and none may be answered before its owner decides

| Open decision | Owner named in the record |
|---|---|
| Milestones, staffing and contractual acceptance; no defensible finish date is established | Delivery and customer leadership |
| Production resource initialization, the host cutover, rollback and performance | Architecture, security and delivery |
| The production experiment: enrollment unit, metrics, allocation, windows and stopping | The customer's data science and business owners |
| Which exploration, autonomy and external-model promises are offered, and which are not | Product, customer scope and architecture |
| Retention periods per category, the disposition of history and physical erasure progress | Privacy, security and the customer |
| The real identity provider, onboarding and single sign-on acceptance | The identity owner and delivery |
| Customer, brand, environment and region topology, and residency | Architecture and the customer |
| Money semantics: currency, refunds, returns and priors | The customer's business and data science owners |
| Entitlements, feeds, the commerce platform, the warehouse, ODP and distribution acceptance | Commercial, customer and integration owners |
| The production memory, K and the entry and exit lines | An owner input |
| Recognizing a returning visitor: the production window and purpose | The customer, privacy and delivery |
| The billing meter and its rates, and whether design-time tagging consumes AI credits | Monetization |
| How a customer deployment gets its first tenant configuration | A remediation item and an owner decision |
| The ruling on the engine's known findings | The architecture board |

## Where AI and credits fit

The engine decides, and it calls no AI model to decide, so serving a page never spends an AI credit, however much traffic grows. AI work that people do, such as writing content, explaining results or analyzing them, is where credits belong, and Opal is that product; it is not connected to the engine today. The engine's own reasons for each decision are arithmetic it produces itself. How each line is metered and priced is monetization's decision and is still open.

The whole boundary is on the credits page, [Where Opal and AI credits fit](https://edge-platform-bti.expedge.workers.dev/credits).

## Say these sentences, and never these

- Claim only what is Built; name what is Designed; say what is Open.
- It calls no AI model to decide: a decision is arithmetic over the brand's published settings and counted evidence, and each one lists its reasons.
- Learning is built, and it changes nothing until a person raises the learning dial.
- Receipts, outcomes and learning counts are recorded only with the visitor's consent. A page that asks the engine directly is recorded when its slots use the default served basis; with the SDK as shipped, a slot is recorded only when it is set to count rendered pieces and durable recovery is on, and no configuration has it on yet.
- Each customer gets its own deployment on Cloudflare's network, one per environment, with its own storage. The workflow that sets one up stops before the customer's first configuration; that step, the ODP and Feature Experimentation connectors, measurement on the SDK, retention periods and the billing meter are open.
- ODP, Feature Experimentation and Opal are not in the decision path, and none is connected to it today.
- For each visitor, the engine orders whatever sits in a slot, including a stack of page modules, and shows why. Where each slot sits on the page stays the site's own template, and changing the layout by context is a designed next step.

| Never say | Say instead |
|---|---|
| "It's AI", "the AI decides" | "It calls no AI model to decide." |
| "It learns from day one", "it records from day one" | "Learning is built, and it changes nothing until a person raises the learning dial." Then the recording sentence above |
| "Every decision is recorded", "a receipt for every decision" | "Every answer carries its reasons; receipts are kept with the visitor's consent once recording is on." |
| "It optimizes itself", "autonomous", "a bandit picks the winner" | "Nothing learned moves a score until a person raises the learning dial. Automatic weight changes and Thompson sampling are switched off by policy and not offered." |
| "It can score with your own model" | "A customer's own model in the score is switched off by policy and not offered." |
| Any lift, conversion or revenue figure or promise | "We make no lift claim; the day report is an attribution diagnostic." |
| "It's CMAB", "it runs on experiments" | "It is not CMAB and depends on no experiment." |
| "ODP is the backbone" | "The decision reads no ODP data, and ODP is not connected to it today." |
| "Nothing flashes", "no flicker" | "Deciding the first paint on the site's server has a source module; its acceptance is open." |
| "It works in native apps", "our mobile SDK" | "There is no native app SDK." |
| Any timing or throughput figure, "instant" | "We quote no timing figure; timing is measured on the customer's own deployment." |
| "Live in two weeks", any delivery date | "This material gives no date; the step that gives a deployment its first configuration is open." |
| "The engine rearranges the page" | "For each visitor, the engine orders whatever sits in a slot, including a stack of page modules, and shows why. Where each slot sits on the page stays the site's own template, and changing the layout by context is a designed next step." |

> **Claim only what is Built; name what is Designed; say what is Open.**
