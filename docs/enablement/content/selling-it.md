# Behavioral Targeting and Intelligence: selling it

**For account executives. Internal.** You sell the engine, and this piece is for you alone. It gives you what to say, what you may claim today and what you may not, which demo to show, the commercial lines, what the customer provides and the answers to the objections on every deal.

> **With consent, the engine personalizes for the entire addressable population from the first click, by interest, not identity; claim only what is Built.**

**What it is, in one sentence you can say.** For every visitor who consents, from their first click, the engine ranks your own content for each place your team gives it, by the interests they show on your site, and gives the reason for every choice.

**An example.** A visitor nobody has identified arrives from an ad, accepts the consent banner and looks at two products from one brand. The next time the page asks, the engine ranks that brand's content higher wherever your team allows it, and says why.

**Why it sells.** It is not site personalization for the few visitors a brand already knows: it serves every visitor who consents, known or not.

## What you may claim today, and what you may not

Every claim in this package carries one of three labels, with the same meaning on every page.

| Label | What it means | What you may say |
|---|---|---|
| **Built** | In the code and exercised, by tests or by a hosted demo | Claim it, with its condition |
| **Designed** | Written in a design document, not in the code | Designed, not built |
| **Open** | No decision yet | What exists today, and that the rest is being defined |

The rows follow the visitor's session: before they arrive, during their visit, and after it. Use the last column as written; where the label is not Built, it replaces the claim.

| When | The claim you want to make | Label | The sentence to use |
|---|---|---|---|
| Before | Your team publishes the rules | **Built** | Your team's published documents, the versioned settings the engine reads, hold every weight, pin, window and rule. Your rules run first: eligibility, then pins, then the engine ranks what is left. A change needs no software release, and any revision can be rolled back. |
| Before | It integrates with ODP, Feature Experimentation and Opal | **Open** | None of them is in the decision path: the engine decides on its own. How each connects to a customer deployment is being defined; only older demos show them, on demo data. |
| Before | A customer deployment in weeks | **Open** | The implementation path is being defined; here is what exists today ([the path as it stands](#the-implementation-path-as-it-stands-today)). No dates, no weeks. |
| During | Real-time interest at the edge | **Built** | Each event from a consenting visitor adds to their interest in the values it touches, such as a brand or a price band, at the weight your team sets. It fades when they stop, and the engine reads it fresh each time the page asks. |
| During | It works for anonymous visitors from the first click | **Built** | It personalizes for a visitor nobody has identified from their first event, once your site passes their consent choice. Their interests carry over when they sign in. |
| During | A regional prior for strangers | **Built** | Until the visitor shows interests of their own, the engine can lean on the regional prior: what other visitors in the same region, as the network reports it, are interested in. It counts your own site's events with no visitor ids, and your team turns it on. |
| During | It re-ranks our product listings | **Built** | It re-orders a product list your commerce platform supplies, by the visitor's interests, and removes nothing. Each product must carry the attributes the engine scores on, and with its dial at zero your platform's own order comes back unchanged. |
| During | The page rearranges itself for each visitor | **Designed** | For each visitor, the engine orders whatever sits in a slot, including a stack of page modules, and shows why. Where each slot sits on the page stays the site's own template, and changing the layout by context is a designed next step. |
| During | It runs on Cloudflare | **Built** | It runs on Cloudflare's network, in a deployment of the customer's own for each environment, with its own storage. |
| During | It works in our native mobile apps | **Open** | There is no native app SDK today. Never sell one as available. |
| During | Sub-second decisions | **Open** | We quote no timing until it is measured on your own deployment. The decision is arithmetic that calls no AI model. |
| During | A receipt for every decision | **Built** | Every decision has a receipt: what was served, its strongest reasons and the arithmetic behind it, which your operators read in the console. On a customer's site it starts once recording is on ([the one exception](#the-one-exception-to-keep-straight-recording)). |
| After | Learning that counts from day one | **Built** | It counts outcomes from the day recording is on, and moves nothing until your team raises the learning dial, which starts at zero ([the one exception](#the-one-exception-to-keep-straight-recording)). |
| After | It learns automatically | **Open** | It counts outcomes on its own, and they move a ranking only as far as your team's learning dial allows. Whether a customer may switch on exploration, deliberately showing less-tried pieces, is open. The engine changing its own weights is switched off by policy and never offered. |

### The one exception to keep straight: recording

On a site that uses our SDK, the script a site adds to send events and receive decisions, nothing is recorded yet: no receipt is kept and learning counts nothing. Recording needs each slot set to count the pieces the page renders, plus a setting called durable recovery. Durable recovery is off in every configuration today, and switching it on needs the customer's approved retention periods, which are still open. The Vantage and Top Offers demos record because their pages ask for decisions directly. So say "it records from day one" only of the demos, and "from the day recording is switched on" of a customer's site.

## Where it runs, in one picture

The customer keeps its pages and its front end; the engine answers their questions from Cloudflare's network. In five sentences:

1. Your site sends events and asks for decisions; your front end renders the answer, or your own default when there is none.
2. The engine runs on Cloudflare's network, in the data center nearest the visitor.
3. Each consenting visitor's interests live in the engine's own storage, inside the customer's own deployment.
4. Your team's published documents define every rule and weight the engine follows.
5. Every decision has a receipt, the record of what was served and why, kept wherever recording is on.

![The engine runs on Cloudflare at the edge: workers, durable objects, storage](../figures/architecture.png)

**Say it like this.** Your pages send events. The engine returns decisions, addressed by your own content ids. Your front end renders, always.

## The commercial lines and where credits apply

The one rule, from the credits page: the engine decides and Opal creates and explains, so shopper traffic never consumes AI credits, and credits follow the team's activity.

| Line on the order form | What it is | What drives it | Where it stands today |
|---|---|---|---|
| The engine | The new offering line | Traffic: a platform fee plus usage is the recommended shape | **Designed**, as a recommendation. Its name on the order form, the rates and the usage meter are **Open**; no meter is built yet |
| Opal credits | Authoring and insight, when a person asks Opal in plain language | The team's activity, never shopper traffic | Opal is not connected to the engine today, so the engine consumes no credits. Whether design-time tagging is billed as credits is **Open** |
| Shopper-facing AI features, optional | Typed search, an advisor, generated imagery | Feature adoption, metered per use | Typed search is **Built** and off by default; the advisor and generated imagery exist only in demos |
| ODP | The customer data platform | Its own licensing | Not in the decision path. Connecting it is **Open** |
| Feature Experimentation | Activation and testing | Its own licensing | Not in the decision path: the engine measures itself with its own holdout, a share of visitors held back for comparison. Connecting it is **Open** |

Two guardrails hold whatever the packaging becomes: never price per event, and never blend the engine's meter with credits or AI features. Until monetization decides, put no name and no number on the engine's line. The full map is the standalone credits page, *Where Opal and AI credits fit, and where they never do*.

## Which demo to show to whom

Six hosted demos are ready to show. Vantage and Top Offers run today's engine, each in its own deployment: show them as the product. Meridian, The Bright Hour, the bank demo and the storefront share an older build.

| Demo | What it shows best | Who it suits | One caution |
|---|---|---|---|
| Vantage, a fictional carrier: [https://edge-platform-vantage.expedge.workers.dev/vantage/](https://edge-platform-vantage.expedge.workers.dev/vantage/) | A stranger from an ad, served from the first paint by the ad, their region and their phone's operating system; the page following them; a pin shown as an override, the buy box off limits; a receipt behind every card | Digital and personalization leaders exploring what is possible, not buying | Its regional sales are synthetic and labeled on screen. Say so |
| Top Offers, on screen Lantern & Lane: [https://edge-platform-top-offers.expedge.workers.dev/top-offers/](https://edge-platform-top-offers.expedge.workers.dev/top-offers/) | A four-place module filled from a pool of promotions; the visitor earning it; a merchandiser's day of real publishes; a weather rule; the click report | A retailer's merchandising and engineering team | The click report is attribution, not incrementality. Never present it as lift |
| Meridian, on screen Calder: [https://edge-platform.expedge.workers.dev/meridian/](https://edge-platform.expedge.workers.dev/meridian/) | One brand, two businesses, swapped live from retail to a bank; an interest fading until the page changes with nobody touching it | Retail and banking executives together | Its hands-off change is the fading arithmetic checked again on a timer. Never call it a push from the engine |
| The Bright Hour, a fictional live-shopping retailer: [https://edge-platform.expedge.workers.dev/live/](https://edge-platform.expedge.workers.dev/live/) | Decisions under expiry: a new offer ranked with no history, its window closing and the next offer taking its place, an item selling out mid-visit, and the receipts | Teams whose offers expire quickly, such as live shopping | It runs on the shared demo deployment's older build, not today's engine. Never present it as the product |
| The bank demo: [https://edge-platform.expedge.workers.dev/visual-demo](https://edge-platform.expedge.workers.dev/visual-demo) | Attribution: one action, one visible change, in one place | An early meeting that needs one cause and one effect | The 2025 demo: its changes come from a table in the page, not from the engine. Never present it as the engine deciding |
| The storefront: [https://edge-platform.expedge.workers.dev/storefront](https://edge-platform.expedge.workers.dev/storefront) | An anonymous visitor personalized within their visit, and a chat, a demo stand-in for Opal, that builds an audience | Internal teams, and only the brand it was built for | It carries a real brand's own catalog and photography. Never show it to another company |

Before you record a demo or show it in public, check with the demo owner: Vantage shows real phones under their makers' names, and legal confirms before any public or recorded use.

## What the customer has to provide

Every ask says what we need and what we use it for. Your solutions engineer covers the technical items: page origins, a site key, the purchase event, a signed proof at sign-in and a connection check from inside the customer's network.

| What we need | What we use it for | Who provides it |
|---|---|---|
| The registry: the dimensions to score on, such as brand or price band, the field each one reads, and how much each action counts | What the engine scores on, and how fast it forgets | The customer, with Professional Services |
| A content feed: each piece's own id, type, title and tags in the registry's vocabulary (a piece is one item of content) | The catalog the engine ranks | The customer's content team |
| Product events carrying the product id and the registry's attribute fields | Building interest: the engine holds no product catalog for a customer, so an event without them builds nothing | The customer's tag owner |
| An explicit consent choice, passed by the site from its consent banner | Without it, nothing personalizes and nothing is recorded | The customer's privacy owner |
| A team to publish the documents: the slots (the places on a page the engine decides), each slot's default, and the weights, pins and rules | Every rule the engine follows; the default renders whenever the engine is silent | The customer's merchandising and front-end owners |
| Retention periods for each kind of data | Required before anything that depends on them is captured, recording included | The customer's privacy owner |

## The implementation path as it stands today

The honest answer is short: the path is being defined, and much of it exists.

**What exists**

- Professional Services runbooks for the delivery model and an engagement in steps (**Designed**: parts of what they describe are not built yet).
- A guarded workflow that creates a customer's own deployment for each environment, and changes nothing without a protected authorization (**Built**).
- An integration kit for the customer's developers: the SDK, the API reference, the event formats and a connection check (**Built**).
- For demos, a kit that turns an existing demo into a new customer's demo, run by solutions engineers.

**What is being defined** (all **Open**)

- How a customer's deployment receives its first published documents: no customer route exists for it yet.
- Connectors: ODP and Feature Experimentation are not yet admitted on a customer deployment; warehouse, search and tagging connectors are.
- Measurement and retention: recording on an SDK site, the retention periods, and the design of the production experiment.
- The commercial meter, and the engine's line on the order form.
- Milestones and staffing: no finish date is established.

**Two tellings in our own material disagree.** Treat both as open and promise neither.

- Who implements: Professional Services in one telling; in a later one, a specialist delivery team (SWAT), with Professional Services shadowing.
- What comes first: older material puts content personalization first, what goes in each box. A later decision, for one engagement, puts experience personalization first, the order the boxes come in. Its per-context layout configuration is **Designed** and is the first build item.

**When a customer asks for a timeline**, say: "The implementation path is being defined. Here is what exists today." Then name what exists. Never give a date, a number of weeks or a count of steps.

## Objections and the answers

These come up on every deal. Say the middle column as written; the last column is the tempting answer that costs us.

| They ask | Say this, verbatim | Never say |
|---|---|---|
| It's just click tracking. | It decides from interest, not clicks. Each event adds to the visitor's interest in the values it touches, such as a brand or a price band, and that interest fades unless they keep showing it. | It remembers every click a visitor makes. |
| Isn't this a recommendations engine? | It works alongside product recommendations: it ranks your own content for each place on the page, for visitors nobody has identified, and gives the reason for every choice. | Yes, it's a recommendations engine. |
| Is it AI? | It calls no AI model to decide. Every decision is arithmetic, itemized on its receipt; its intelligence is counted learning behind a dial your team controls. | We don't use a model. |
| What about privacy? | Nothing is personalized or recorded until your site passes the visitor's explicit consent choice. Visitor ids are random, a signed-in id is a salted one-way hash, and there is no device fingerprinting. | It's anonymous, so it doesn't need consent. |
| Where is our data? | In the engine's own storage on Cloudflare, in a deployment that is yours alone. Regional counts carry no visitor ids, and the raw account id is never stored. | It all lives in ODP. |
| How fast is it? | We quote no timing until it is measured on your own deployment. The decision is a short sum for each piece of content, with no call to an AI model. | It's instant, or any figure from older material. |
| Does it need ODP? | No. No ODP data is in the decision, and connecting ODP to a customer deployment is being defined. | ODP is the backbone. |
| Can we see why it decided? | Yes. Every decision has a receipt with what was served, its strongest reasons and the arithmetic; your operators read it in the console once recording is on. | We can replay any page exactly. |
| What if we never buy Opal credits? | The engine runs fully without them. No decision calls an AI model, so shopper traffic never consumes credits. | You need Opal credits to run it. |
| How do we govern it? | Your team does. Its rules run first, every change is a published, versioned document that records who changed it and why, and any revision can be rolled back. | It optimizes itself. |

## See also

- *What it is*: the marketing piece, for the message.
- *How it works and where it runs*: the solutions engineers' piece, for the mechanism and the detail behind each claim.
- *Where Opal and AI credits fit, and where they never do*: the credits page.
- *Glossary*: the package's terms.
- For a customer's engineers, the Vantage demo's explainer: [https://edge-platform-vantage.expedge.workers.dev/vantage/how-it-works](https://edge-platform-vantage.expedge.workers.dev/vantage/how-it-works).

> **With consent, the engine personalizes for the entire addressable population from the first click, by interest, not identity; claim only what is Built.**
