# Behavioral Targeting and Intelligence: what it is

For marketing, writing about the engine for customers and the market.

**With consent, the engine remembers what each visitor is interested in, not who they are, and ranks your content by the rules your team publishes.**

## What it is not

Three contrasts place it, each with a kind of system, never a product.

It is not a recommendations engine that scores products from purchase history. It needs no purchase history: with consent, it starts from the first thing a visitor does, even as a stranger, and ranks the brand's own content for each place on a page.

It is not a tool that places visitors into segments by rule. For each visitor, it keeps a graded interest in each thing they engage with, rising with what they do and fading with time. The brand's rules govern the page, not the person.

It is not an AI model deciding in the moment. It calls no AI model to decide: each decision is arithmetic on the visitor's interests, their context and the brand's published settings, and every answer carries its reasons. Generative AI has a place, outside the decision; see [Where AI and credits fit](#where-ai-and-credits-fit).

## How it works, in five steps

Follow one visitor through one session: before they arrive, as they browse, when they leave, and afterward. A dimension is something the brand scores on, such as category, color or price band; a dimension value is one entry on it, such as black.

**1. What is watched: nothing, until the visitor agrees.** Before they arrive, the brand has published its content and its rules for each slot, a place on a page that the engine decides. When they arrive, nothing is watched until the site passes on their explicit consent choice; a missing or expired one counts as no. With consent, the engine notes what they view, save, buy or add to their cart.

**2. What is remembered: a graded interest in each value the visitor touches.** When they view a black wool coat, their interests in coats, black and wool all grow, by as much as the brand says a view counts. Decisions read these interests, not a list of their clicks. Even an audience follows from these interests: a visitor joins at one line and leaves only below a lower one, so no one flickers in and out.

**3. How a decision is made: the brand's rules first, then the visitor's interests.** Each time a page asks, the brand's rules come first: which pieces of content may show, by date, stock and region, and which a merchandiser has pinned. The rest are ranked by how well each piece's tags match the visitor's interests, weighted per slot: a piece tagged coats and black rises for this visitor. For a new visitor, the engine's cold start can use how they arrived, such as the campaign they clicked, and the regional prior: what visitors in the same region are interested in. The brand's own page renders the answer, and every answer carries its reasons.

**4. What fades, and when: every interest, at its own pace.** When the visitor leaves, nothing more is added and their interests keep fading. Each dimension can have its own memory: 14 days by default, and at most 90. Time only lowers an interest; only what they do can raise it. For a live site, the memory is chosen with each customer.

**5. How it learns: it counts, and a person decides.** With the visitor's consent, the engine counts what each piece earned, such as a click or a purchase, credited to the decision that showed it. Those counts move a slot's ranking only as far as its learning dial allows; only a person turns the dial, and it starts at zero. The learning is counting, not an AI model.

Each step carries a verdict in one legend. **Built**: in the code and exercised. **Designed**: in an architecture document, not in the code. **Open**: no decision yet.

| Step | When | What happens | Verdict |
|---|---|---|---|
| 1. What is watched | Before and on arrival | Nothing, until the visitor makes an explicit choice | **Built** |
| 2. What is remembered | As the visitor browses | A graded interest per dimension value | **Built** |
| 3. How a decision is made | Each time a page asks | The brand's rules first, then the visitor's interests; every answer carries its reasons | **Built** |
| 4. What fades, and when | When the visitor leaves | Every interest, on a memory set per dimension | **Built** |
| 5. How it learns | Afterward | It counts, and moves nothing until a person raises the learning dial; the one exception is below | **Built** |

The one exception to keep straight: on a customer's site, recording receipts and outcomes through the SDK, the engine's browser library, waits on a setting that needs retention periods the customer has approved, an open decision. The hosted demos record today.

## Where AI and credits fit

The engine decides, and it calls no AI model to decide, so serving a page never spends an AI credit, however much traffic grows. AI work that people do, such as writing content, explaining results or analyzing them, is where credits belong, and Opal is that product; it is not connected to the engine today. The engine's own reasons for each decision are arithmetic it produces itself. How each line is metered and priced is monetization's decision and is still open.

AI features a visitor uses directly, such as typed search, are separate and off by default. Tags for the brand's content can be proposed by the brand's own AI model, with a person approving each one, outside the decision; how that is billed is still open.

The whole boundary is on the credits page, [Where Opal and AI credits fit](https://edge-platform-bti.expedge.workers.dev/credits).

## What is true today

The engine's core is built and runs today; the path onto a customer's own site is where the open decisions sit. Two hosted demos run on today's engine, [Vantage](https://edge-platform-vantage.expedge.workers.dev/vantage/) and [Top Offers](https://edge-platform-top-offers.expedge.workers.dev/top-offers/), and their regional data is synthetic and labeled. For each visitor, the engine orders whatever sits in a slot, including a stack of page modules, and shows why. Where each slot sits on the page stays the site's own template, and changing the layout by context is a designed next step. Describe what is built, call designed items designed, and promise nothing that is open. Two more limits: there is no native app SDK, and no speed, lift or revenue figure may be quoted, since none has been measured in a quotable way.

| Verdict | What it covers |
|---|---|
| **Built** | Consent gating; graded, fading interests, with entry and exit lines for audiences; the cold start, from how a visitor arrived and the regional prior; date, stock and region rules, pins, exclusions and the other merchandising controls; the order of whatever sits in a slot, a stack of page modules included; receipts; versioned settings changed without a software release, most of them in the operator console; product re-ranking, which reorders a product list that a commerce platform supplies; outcome counting and the day report; the learning dial; holdout groups that see the site's own defaults, for comparison; the sign-in merge of a visitor's interests |
| **Designed** | Configuring a page's layout per context, such as by channel or visit; correcting what it learns for where on the page a piece was shown; matching content by meaning as well as by tags |
| **Open** | A customer deployment's first configuration, and the live gates before going live; connections to Opal, ODP and Feature Experimentation; measurement on a customer's site, including recording through the SDK, retention periods and the experiment design; the commercial meter and its rates |

## Sentences to say

- "Nothing is personalized or recorded until the visitor explicitly agrees."
- "The engine calls no AI model to decide; every decision is arithmetic, and every answer carries its reasons."
- "Interest builds with what a visitor does and fades with time, at a pace your team sets."
- "Your rules decide what may show and what must; the engine ranks the rest for each visitor."
- "Learning is built, and it changes nothing until a person raises the learning dial."

## Sentences never to say, and what to say instead

| Never say | Say instead |
|---|---|
| "It uses AI to personalize."; "AI-powered personalization" | "It personalizes by arithmetic on what each visitor does, by rules your team publishes." |
| "It knows who the visitor is." | "It knows what a visitor is interested in, not who they are." |
| Any speed figure, such as a decision time in milliseconds. None has been measured in a way that can be quoted. | "We quote no timing figure; timing is measured on the customer's own deployment." |
| "It learns automatically." | "It learns only as far as your team allows: results move a ranking only when someone turns up the learning dial." |
| "We don't use a model." | "It calls no AI model to decide." |
| "It reads their mind", "it knows what they want" | "It counts what the visitor does." |
| "One-to-one in real time" | "In the visitor's session, from their first event." |
| "A recommendations engine" | "It ranks the brand's own content for each decided place on a page." |

## Questions marketing will be asked

**Is it private, and how does consent work?** Nothing is personalized or recorded until the site passes the visitor's explicit consent choice. Without it, the visitor sees the site's own defaults. With consent, the engine keeps their interests under a random id, reads no device detail beyond the operating system family of the visitor's phone, and does no fingerprinting.

**Does it need to know who the visitor is?** No: it works under a random id. At sign-in, the site's own systems sign a proof, and the engine joins the visitor's interests to their account under a one-way code, never the account id itself. Recognizing a returning stranger without sign-in is built, but off until the customer turns it on.

**Is it a black box?** No. Every answer carries its reasons, and with the visitor's consent a receipt records what was served and why once recording is on. The settings that shape an answer are published, versioned documents the brand can read, change and roll back without a software release.

**Does it need our data warehouse?** No. It decides from the site's own events, which must carry each product's details, and keeps its own records, which a warehouse can collect.

**Does it replace our recommendations?** No. It ranks the brand's own content for each place on a page and can reorder a product list that a commerce platform supplies, but it picks no products from a catalog of its own.

**Does it depend on other Optimizely products?** No. ODP, Feature Experimentation and Opal are not in the decision path, and none is connected to it today.

**What does the customer have to provide?** Its content, tagged in the words the engine scores on; a map of its page slots, each with a default; site events that carry each product's details and each purchase; the visitor's consent choice; a signed proof at sign-in; and how long each kind of data is kept.

**How is it priced?** See [Where Opal and AI credits fit](https://edge-platform-bti.expedge.workers.dev/credits) and [Selling it](https://edge-platform-bti.expedge.workers.dev/selling-it), the account executive piece. The engine's own meter and rates are an open decision, so neither belongs in marketing copy yet.

## See also

- [Selling it](https://edge-platform-bti.expedge.workers.dev/selling-it), the piece for account executives.
- [How it works and where it runs](https://edge-platform-bti.expedge.workers.dev/how-it-works), the piece for solutions engineers.
- [Where Opal and AI credits fit](https://edge-platform-bti.expedge.workers.dev/credits), the standalone credits page.
- [Glossary](https://edge-platform-bti.expedge.workers.dev/glossary), the package's terms.
- [What is built, designed and open](https://edge-platform-bti.expedge.workers.dev/status), every capability with its verdict.

---

**With consent, the engine remembers what each visitor is interested in, not who they are, and ranks your content by the rules your team publishes.**
