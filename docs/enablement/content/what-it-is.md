# Behavioral Targeting and Intelligence: what it is

For marketing, writing about the engine for customers and the market.

**With consent, the engine remembers what each visitor is interested in, not who they are, and ranks your content by the rules your team publishes.**

## What it is not

Three contrasts place it, each with a kind of system, never a product.

It is not a recommendations engine that scores products from purchase history. It needs no purchase history: with consent, it starts from the first thing a visitor does, even as a stranger, and ranks the brand's own content for each place on a page.

It is not a tool that sorts visitors into segments by rule. For each visitor, it keeps a graded interest in each thing they engage with, rising with what they do and fading with time. Even an audience follows from it: a visitor joins at one line and leaves only below a lower one, so no one flickers in and out. The brand's rules govern the page, not the person.

It is not an AI model deciding in the moment. It calls no AI model to decide: each decision is arithmetic on the visitor's interests, their context and the brand's published settings, with a receipt that writes the arithmetic out. Generative AI has a place, outside the decision; see [Where the AI is](#where-the-ai-is).

## How it works, in five steps

Follow one visitor through one session: before they arrive, as they browse, when they leave, and afterwards. A dimension is something the brand scores on, such as category, color or price band; a dimension value is one entry on it, such as black.

**1. What is watched: nothing, until the visitor agrees.** Before they arrive, the brand has published its content and its rules for each slot, a place on a page that the engine decides. When they arrive, nothing is watched until the site passes on their explicit consent choice; a missing or expired one counts as no. With consent, the engine notes what they view, save, buy or add to their bag.

**2. What is remembered: a graded interest in each value the visitor touches.** When they view a black wool coat, their interests in coats, black and wool all grow, by as much as the brand says a view counts. Decisions read these interests, not a list of their clicks.

**3. How a decision is made: the brand's rules first, then the visitor's interests.** Each time a page asks, the brand's rules come first: which pieces of content may show, by date, stock and region, and which a merchandiser has pinned. The rest are ranked by how well each piece's tags match the visitor's interests, weighted per slot: a piece tagged coats and black rises for this visitor. For a new visitor, the engine's cold start can use how they arrived, such as the campaign they clicked, and the regional prior: what visitors in the same region are interested in. The brand's own page renders the answer, and every decision gets a receipt.

**4. What fades, and when: every interest, at its own pace.** When the visitor leaves, nothing more is added and their interests keep fading. Each dimension can have its own memory, from minutes to weeks. Time only lowers an interest; only what they do can raise it. For a live site, the memory is chosen with each customer.

**5. How it learns: it counts, and a person decides.** From the first day, the engine counts what each piece earned, such as a click or a purchase, credited to the decision that showed it. Those counts move a slot's ranking only as far as its learning dial allows; only a person turns the dial, and it starts at zero. The learning is counting, not an AI model.

Each step carries a verdict in one legend: **Built**, in the code and exercised; **Designed**, in an architecture document, not yet in the code; **Open**, no decision yet.

| Step | When | Verdict |
|---|---|---|
| 1. What is watched | Before and on arrival | **Built**: nothing, until the visitor makes an explicit choice |
| 2. What is remembered | As the visitor browses | **Built**: a graded interest per dimension value |
| 3. How a decision is made | Each time a page asks | **Built**: the brand's rules first, then the visitor's interests, with a receipt |
| 4. What fades, and when | When the visitor leaves | **Built**: every interest, on a memory set per dimension |
| 5. How it learns | Afterwards | **Built**, with the one exception below: it counts, and moves nothing until the dial turns |

The one exception: on a customer's site, recording receipts and outcomes through the SDK, the engine's browser library, waits on a setting that needs retention periods the customer has approved, an open decision. The hosted demos record today.

## Where the AI is

The engine calls no AI model to decide, and even its receipts are written as data. Generative AI belongs to Opal, where a person asks or AI creates: an audience, a test, an analysis, or tags for content that a person approves. That is where AI credits apply, and credits follow the team's activity, never the site's traffic. AI features a visitor uses directly, such as typed search, are separate and off by default. Opal is not connected to the engine today, and how AI-proposed tags are billed is still open. The whole boundary is on the credits page, *Where Opal and AI Credits Fit, and Where They Never Do*.

## What is true today

The engine's core is built and runs today; the path onto a customer's own site is where the open decisions sit. Two hosted demos run on today's engine, [Vantage](https://edge-platform-vantage.expedge.workers.dev/vantage) and [Top Offers](https://edge-platform-top-offers.expedge.workers.dev/top-offers), and their regional data is synthetic and labeled. For each visitor, the engine orders whatever sits in a slot, including a stack of page modules, and shows why. Where each slot sits on the page stays the site's own template, and changing the layout by context is a designed next step. Describe what is built, call designed items designed, and promise nothing that is open. Two more limits: there is no native mobile app kit, and no speed, lift or revenue figure may be quoted, since none has been measured in a quotable way.

| Verdict | What it covers |
|---|---|
| **Built** | Consent gating; graded, fading interests, with entry and exit lines for audiences; the cold start, from how a visitor arrived and the regional prior; date, stock and region rules, pins, exclusions and the other merchandising controls; receipts; versioned settings changed without a software release, most of them in the operator console; product re-ranking, which reorders a product list that a commerce platform supplies; outcome counting and the day report; the learning dial; holdout groups that see the site's own defaults, for comparison; the sign-in merge of a visitor's interests |
| **Designed** | Ordering a page's modules, its blocks such as a hero or a row of products, for each context; correcting what it learns for where on the page a piece was shown; matching content by meaning as well as by tags |
| **Open** | The customer deployment path, from a customer's first settings to going live; connections to Opal, ODP and Feature Experimentation; measurement on a customer's site, including recording through the SDK, retention periods and the experiment design; the commercial meter and its rates |

## Sentences to say

- "Nothing is personalized or recorded until the visitor explicitly agrees."
- "The engine calls no AI model to decide; every decision is arithmetic, with a receipt that shows it."
- "Interest builds with what a visitor does and fades with time, at a pace your team sets."
- "Your rules decide what may show and what must; the engine ranks the rest for each visitor."
- "Learning moves nothing until your team turns the dial."

## Sentences never to say, and what to say instead

| Never say | Say instead |
|---|---|
| "It uses AI to personalize." | "It personalizes by arithmetic on what each visitor does, by rules your team publishes." |
| "It knows who the visitor is." | "It knows what a visitor is interested in, not who they are." |
| Any speed figure, such as a decision time in milliseconds. None has been measured in a way that can be quoted. | "It runs on Cloudflare's network, in the data center nearest each visitor." |
| "It learns automatically." | "It learns only as far as your team allows: results move a ranking only when someone turns up the learning dial." |
| "We don't use a model." | "It calls no AI model to decide." |

## Questions marketing will be asked

**Is it private, and how does consent work?** Nothing is personalized or recorded without the visitor's explicit choice, and a missing or expired one counts as no. With consent, the engine keeps their interests under a random id, keeps no device detail beyond iOS or Android, and does no fingerprinting.

**Does it need to know who the visitor is?** No: it works under a random id. At sign-in, the site's own systems sign a proof, and the engine joins the visitor's interests to their account under a one-way code, never the account id itself. Recognizing a returning stranger without sign-in is built, but off until the customer turns it on.

**Is it a black box?** No. Every decision has a receipt showing what was served and why. The settings that shape an answer are published, versioned documents the brand can read, change and roll back without a software release.

**Does it need our data warehouse?** No. It decides from the site's own events, which must carry each product's details, and keeps its own records, which a warehouse can collect.

**Does it replace our recommendations?** No. It ranks the brand's own content for each place on a page and can reorder a product list that a commerce platform supplies, but it picks no products from a catalog of its own.

**Does it depend on other Optimizely products?** No. ODP, Feature Experimentation and Opal are not in its decision path, and none is connected to it today.

**What does the customer have to provide?** Its content, tagged in the words the engine scores on; a map of its page slots, each with a default; site events that carry each product's details and each purchase; the visitor's consent choice; a signed proof at sign-in; and how long each kind of data is kept.

**How is it priced?** See the credits page and *Selling it*, the account executive piece. The engine's own meter and rates are an open decision, so neither belongs in marketing copy yet.

## See also

- *Selling it*, the piece for account executives.
- *How it works and where it runs*, the piece for solutions engineers.
- *Where Opal and AI Credits Fit, and Where They Never Do*, the standalone credits page.
- *The glossary*, the package's terms.

---

**With consent, the engine remembers what each visitor is interested in, not who they are, and ranks your content by the rules your team publishes.**
