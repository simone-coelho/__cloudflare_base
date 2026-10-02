# Behavioral Targeting and Intelligence: selling it

For account executives.

**Sell what is built, label what is designed, and promise nothing that is open.**

## One visitor, three moments

Before the visitor arrives, the brand's team publishes its rules and tags each of its content pieces in the words the engine scores on. A visitor nobody has identified then arrives from an ad, accepts the site's consent banner and looks at a few products from one brand. The next time the page asks, the engine ranks that brand's pieces higher in each slot, a place on the page that it decides, wherever the rules allow, and the answer says why. After the visit, the engine counts what each piece earned once recording is on, and nothing it learns moves a ranking until a person raises the learning dial.

## What you are selling fits in one paragraph

The engine decides which of the brand's own content each visitor sees, and in what order. For every visitor who has agreed to it, it keeps a graded, fading interest in each value of each dimension the brand chooses to score on, built from what they do on the site. When a page asks, it ranks the brand's own published content for each slot on the page against that interest, leaning, where the brand turns it on, on what their region is interested in until they have shown interests of their own. It answers with the brand's own content ids in order, each with the reasons that placed it there. It runs on Cloudflare's network, calls no AI model to decide, and every setting that can change an answer lives in published, versioned documents that the brand's team changes without a software release.

Write its name in full the first time, then say the engine. It is not the behavioral targeting in other Optimizely products.

## What is built, designed and open, in the visitor's order

Built: in the code and exercised. Designed: in an architecture document, not in the code. Open: no decision yet.

These are the rows an account executive needs. Every row, with its caveat, is on [What is built, designed and open](https://edge-platform-bti.expedge.workers.dev/status), and every term is in the [Glossary](https://edge-platform-bti.expedge.workers.dev/glossary).

**Before: what the brand sets up before the visitor arrives**

| What happens | Verdict |
|---|---|
| The brand chooses the dimensions it scores on, the attribute each reads, how much each action counts and how long interest lasts, in its registry. | **Built** |
| The brand's own content pieces arrive by import or pull, tagged in the registry's vocabulary; no console screen edits them. | **Built** |
| The brand maps its pages and slots: how many pieces each slot shows, its weights, pins, rules, exclusions and off-limits places. | **Built** |
| The site keeps its own defaults, and they render whenever the engine is silent. | **Built** |
| The site's consent banner passes the visitor's explicit choice; nothing happens without it. | **Built** |
| Product events carry the attributes the registry reads, because the engine holds no product catalog for a customer. | **Built** |
| Every rule and weight the brand sets is a published, versioned document, in force without a software release, with its history and a rollback that is itself a new revision; identity and access settings are worker configuration set by an engineer. | **Built** |
| The brand's team works in the operator console; engineers set the deployment's own settings, such as its tenants, keys, allowed origins and retention. | **Built** |
| A customer deployment is set up by a workflow that stops before the tenant has its first configuration. | **Open** |
| Connecting ODP or Feature Experimentation to a customer deployment. | **Open** |
| Retention periods for each category of data. | **Open** |

**During: what the engine does while the visitor is on the site**

| What happens | Verdict |
|---|---|
| Nothing is personalized or recorded until the visitor's consent choice arrives; without it they see the site's defaults. | **Built** |
| A stranger is served from their first event, on how they arrived: the campaign term, the channel, the referring network and the operating system family of their phone. | **Built** |
| Where the brand turns it on, a stranger leans on what their region is interested in, from the site's own events, until their own interests take over. | **Built** |
| Each action adds to a graded, fading interest per dimension value, and audiences form and dissolve on two lines. | **Built** |
| The brand's rules come first: eligibility (windows, stock, regions and named conditions), pins, exclusions and off-limits slots, all before any ranking. A pinned piece that cannot be served empties its whole slot. | **Built** |
| The score ranks what is left: the visitor's interests times the slot's weights, then arrival seeds, journey stage, freshness, fatigue and merchandising weights, in that order, and learning only once its dial is raised. | **Built** |
| The answer is the brand's own content ids in order, each with its reasons, and the site renders them. | **Built** |
| A product list from the commerce platform is re-ranked by the visitor's interests, with nothing removed. | **Built** |
| At sign-in the visitor's anonymous and signed-in profiles merge, overriding nothing. | **Built** |
| Typed search with the brand's own AI model, outside the decision; off by default. | **Built** |
| No AI model in the decision. | **Built** |
| The engine orders whatever sits in a slot for each visitor, a stack of page modules included, and shows why. | **Built** |
| Configuring a page's layout per context, such as by channel or visit; where each slot sits on the page stays the site's own template. | **Designed** |

**After: what is counted once the visitor has been answered**

| What happens | Verdict |
|---|---|
| Receipts, outcomes and learning counts are recorded only with the visitor's consent. A page that asks the engine directly is recorded when its slots use the default served basis; with the SDK as shipped, a slot is recorded only when it is set to count rendered pieces and durable recovery is on, and no configuration has it on yet. | **Built** |
| A receipt records what was served and why; the brand's operators read it in the console, and replay is exact for one slot. | **Built** |
| Outcomes are credited to the decision that earned them, within windows the brand can set; a named partner outcome is never reported as a sale. | **Built** |
| The day report is an attribution diagnostic, with no claim of lift. | **Built** |
| Learning computes how much better each piece does in each context, and moves nothing until a person raises the learning dial. | **Built** |
| Holdout arms; the demos run none. | **Built** |
| The design of a production experiment. | **Open** |
| Exploration, built and off by default. | **Built** |
| Which form of exploration a customer is offered. | **Open** |
| Erasure: bounded and resumable, and not proof of physical erasure. | **Built** |
| A usage meter for billing, and its rates. | **Open** |

The one exception to keep straight: everything after the answer depends on recording. With the SDK as shipped, recording is not switched on yet, because it needs each slot set to count rendered pieces and durable recovery, which no configuration has. So say that the Vantage and Top Offers demos record today, and that a customer's site records from the day recording is switched on.

The picture shows where all of this runs. In five sentences:

1. The site sends events and asks for decisions; its front end renders the answer, or its own default when there is none.
2. The engine runs on Cloudflare's network, in the data center nearest the visitor.
3. Each consenting visitor's interests live in the engine's own storage, inside the customer's own deployment.
4. The brand's published documents define every rule and weight the engine follows.
5. Every answer carries its reasons; receipts, the record of what was served and why, are kept with the visitor's consent once recording is on.

![Where the engine runs on Cloudflare](../figures/architecture.png)

## The customer provides these, and here is what each is for

| What we need | What we use it for | Who provides it |
|---|---|---|
| The exact addresses, scheme and host, that the customer's pages call from, for staging and production | The list of sites the engine accepts calls from | The customer's platform team |
| A site key for each brand, or one we create | It identifies the site and ties every call from its pages to the brand; it is not a secret | The customer, or us |
| The registry: the dimensions to score on, the attribute each reads, how much each action counts and how long interest lasts | What the engine scores on, and how fast it forgets | The customer, with Professional Services |
| A content feed: each piece's own id, type, title and tags in the registry's vocabulary, the kinds of slot it may fill, the address it renders from, and its time window | The catalog the engine ranks | The customer's content team |
| A slot map: the pages, their slots and each slot's default | The slots document; the default renders whenever the engine is silent | The customer's front-end and merchandising owners |
| Product events that carry the product id and the attributes the registry reads | Building interest, because the engine holds no product catalog for a customer | The customer's tag owner |
| The purchase event: order id, value, currency and items | Outcomes, for attribution and learning | The customer's commerce and analytics owners |
| An explicit consent choice, passed by the site from its consent banner | Without it, nothing personalizes and nothing is recorded | The customer's privacy owner |
| A signed proof of identity at sign-in, and the secret behind it | Merging the visitor's anonymous and signed-in profiles | The customer's backend team |
| Retention periods for each category of data | Required before anything that depends on them is captured | The customer's privacy owner |
| A person to run the connection check from inside the customer's network | It proves the network path from the customer's side | The customer |

Optional: product lists to re-rank, from the commerce platform; a catalog search service and the brand's own AI model key, for typed search; and past events to import.

## Who sets what

| Who | Where | What they set |
|---|---|---|
| The brand's team | In the operator console | Each slot's weights, pins, rules and take, which is how many pieces it shows; how much each action counts and how long interest lasts; the learning dials; the holdout share |
| The brand's team | Through the API, without a software release | The catalog, including each piece's time window and eligibility rule; arrival seeds; the dimensions and the attributes they read; journey thresholds |
| An engineer | In the deployment's own settings | Tenants, keys, allowed origins, retention, and where visitor state lives |

## The questions customers ask have true answers

**Is it AI?** No. It calls no AI model to decide: a decision is arithmetic over the brand's published settings and counted evidence, and each one lists its reasons. AI belongs to authoring and analysis, in Opal, which is not connected to the engine today.

**Isn't this CMAB, or an A/B test?** No. It ranks the brand's own content for each visitor and depends on no experiment. It measures itself with its own holdout; Optimizely's CMAB is a separate capability of Feature Experimentation.

**Isn't this a recommendations engine?** It decides what each decided place on a page shows, and in what order, for a visitor nobody has identified, and it says why. It ranks the brand's own published content, and it can also re-rank a product list the commerce platform supplies.

**Isn't it just click tracking?** It decides from interest, not clicks. Each event adds to the visitor's interest in the values it touches, such as a brand or a price band, and that interest fades unless they keep showing it.

**Does the page rearrange itself?** For each visitor, the engine orders whatever sits in a slot, including a stack of page modules, and shows why. Where each slot sits on the page stays the site's own template, and changing the layout by context is a designed next step.

**Does it need to know who the visitor is?** No. It works from the visitor's first event, knowing them only by a random id. When they sign in, their anonymous and signed-in profiles merge, and nothing is overridden.

**Does every page view spend AI credits?** No. Serving a page calls no AI model, so it spends no credit, however much traffic grows.

**How fast is it?** We quote no timing figure. Timing is measured on the customer's own deployment, once it exists.

**Will it lift conversion?** We make no lift claim. The day report credits outcomes to decisions as an attribution diagnostic. The design of a production experiment is open and belongs to the customer's data science and business owners.

**Does it learn on its own?** No. Learning counts outcomes, and they move a ranking only as far as the brand's learning dial allows; the dial starts at zero, and only a person raises it.

**Can we see why it decided?** Yes. Every answer carries its reasons. With the visitor's consent, and once recording is on, a receipt keeps what was served, its strongest reasons and the arithmetic, and the brand's operators read it in the console.

**What does it store, and for how long?** With consent: random visitor and session ids, interests per dimension value, visit counters, receipts and outcomes. Never: the account id itself, any device detail beyond the phone's operating system family, or conditions a page asserts. How long each category is kept is set per customer, and the periods are open.

**How do we govern it?** The brand's team does. Its rules run first, every change to a published document is a new revision that records who changed it and why, and any revision can be rolled back.

**Can it use our ODP data?** Not in the decision today. The decision reads no ODP data, and connecting ODP to a customer deployment is open.

**How long does implementation take?** This material gives no date. The path is described, and the step that gives a customer deployment its first configuration is open.

**Does it work in our native apps?** There is no native app SDK.

**Which demo should I show?** The demo map answers that: [Demo map](https://edge-platform-bti.expedge.workers.dev/demos).

## Where AI and credits fit

The engine decides, and it calls no AI model to decide, so serving a page never spends an AI credit, however much traffic grows. AI work that people do, such as writing content, explaining results or analyzing them, is where credits belong, and Opal is that product; it is not connected to the engine today. The engine's own reasons for each decision are arithmetic it produces itself. How each line is metered and priced is monetization's decision and is still open.

The whole boundary is on the credits page, [Where Opal and AI credits fit](https://edge-platform-bti.expedge.workers.dev/credits).

## Bring a solutions engineer when the question is how, not what

Bring one for architecture and the stack; the arithmetic; integration and the events; data, privacy and retention detail; and any question this page answers with open. Their piece is [How it works and where it runs](https://edge-platform-bti.expedge.workers.dev/how-it-works).

## Sentences to say, and sentences never to say

- Sell what is built, label what is designed, and promise nothing that is open.
- The engine decides which of the brand's own content each visitor sees, and in what order.
- It serves every visitor who consents, known or not, from their first event.
- Nothing is personalized or recorded until the site passes the visitor's explicit consent choice. Without it, the visitor sees the site's own defaults.
- Learning is built, and it changes nothing until a person raises the learning dial.
- The site sends events and asks for decisions. The engine answers with the brand's own content ids in order, each with its reasons. The site renders them, and renders its own defaults whenever the engine is silent.
- It calls no AI model to decide: a decision is arithmetic over the brand's published settings and counted evidence, and each one lists its reasons.
- ODP, Feature Experimentation and Opal are not in the decision path, and none is connected to it today.
- For each visitor, the engine orders whatever sits in a slot, including a stack of page modules, and shows why. Where each slot sits on the page stays the site's own template, and changing the layout by context is a designed next step.
- The brand's rules come first; the engine ranks what is left.

| Never say | Say instead |
|---|---|
| "It's AI", "AI-powered decisions", "we don't use a model" | "It calls no AI model to decide." |
| "Real-time interest", "sub-second decisions", "instant", or any timing or throughput figure | "In the visitor's session, from their first event. We quote no timing figure; timing is measured on the customer's own deployment." |
| "Changes go live in seconds" | "A save is in force without a software release." |
| "Learning that counts from day one", "it learns from day one", "it records from day one" | "Learning is built, and it changes nothing until a person raises the learning dial." Then what recording needs, as the one exception above says |
| "A receipt for every decision", "every decision is recorded" | "Every answer carries its reasons; receipts are kept with the visitor's consent once recording is on." |
| "It learns automatically", "it optimizes itself", "autonomous", "a bandit picks the winner" | "Nothing learned moves a score until a person raises the learning dial. Automatic weight changes and Thompson sampling are switched off by policy and not offered." |
| Any lift, conversion or revenue figure or promise | "We make no lift claim; the day report is an attribution diagnostic." |
| "It remembers every click a visitor makes" | "It decides from interest, not clicks." |
| "Yes, it's a recommendations engine" | "It ranks the brand's own content for each decided place on a page." |
| "It's CMAB", "it runs on experiments" | "It is not CMAB and depends on no experiment." |
| "The engine rearranges the page", "the page rearranges itself for each visitor" | "For each visitor, the engine orders whatever sits in a slot, including a stack of page modules, and shows why." |
| "It's anonymous, so it doesn't need consent" | "Nothing is personalized or recorded until the site passes the visitor's explicit consent choice." |
| "It knows who they are", "identity resolution" | "It knows the visitor by a random id until they sign in; then the two profiles merge." |
| "Fingerprinting", "device detection" | "It reads no device detail beyond the operating system family of the visitor's phone." |
| "Erased in one call", "guaranteed deletion" | "Erasure is bounded and resumable, and it is not proof of physical erasure." |
| "It replays the whole page exactly" | "Replay is exact for one slot." |
| "ODP is the backbone", "it all lives in ODP" | "The decision reads no ODP data, and ODP is not connected to it today." |
| "Opal explains every decision", "you need Opal credits to run it" | "The engine's reasons are arithmetic it produces itself, and serving a page spends no credit; Opal is not connected to it today." |
| "It holds your product catalog" | "It holds no product catalog for a customer; product events carry the attributes it scores." |
| "It runs in your native app", "our mobile SDK" | "There is no native app SDK." |
| "Implementation takes two weeks", any delivery date | "This material gives no date; the step that gives a deployment its first configuration is open." |
| "We already sell this as behavioral targeting" | "It is the engine described here, not the behavioral targeting in other Optimizely products." |
| "It is live at a customer", any case study, or any customer, prospect or competitor name | "We name no customer and cite no case study." |
| A share of anonymous traffic | "Visitors nobody has identified." |
| "We can put Vantage's images in a public deck" | "Legal confirms before any public or recorded use." |
| Any line that describes another kind of system | Our own reasoning only: what the engine does |

**Sell what is built, label what is designed, and promise nothing that is open.**
