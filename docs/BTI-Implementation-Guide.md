# 1. How to read this document

This is the implementation guide for **Behavioral Targeting and Intelligence**. It describes, end to end, how the platform is deployed for a brand, how your systems and ours talk to each other, what your teams provide, what our teams provide, and what "done" looks like at each step.

It is written to be handed to engineers.

## 1.1 Who each part is for

| Your team | Read | Why |
|---|---|---|
| Front-end engineering | 3, 5, 6, 9, Appendix A, Appendix B | The SDK, the decision payload, rendering rules, the failure behavior your pages must have |
| Commerce and CMS owners | 4.2, 4.3, 4.4, 7.1, 7.2 | The catalogs, the feeds, the tagging, and how they stay current |
| Analytics and data science | 4.4, 4.6, 6.2, 7.4, 10 | The dimension registry, the events, the explain record, the exports, the measurement design |
| Security, privacy and network | 4.8, 4.9, 8, 9 | Where data lives, what must be allow-listed, consent, erasure, retention |
| Merchandising and content operations | 4.4, 4.5, 12 | Slots, defaults, tagging vocabulary, and the day-to-day controls after launch |
| Programme management | 4.1, 11, 13, Appendix H | Dependencies, phases, exit criteria, and the decisions we need from you |

## 1.2 What this document is, and what it is not

**It is** the technical plan of record: how the two sides connect, what data your systems supply, the order the work is done in, and the evidence that each step is finished.

**It is not** a commercial document. There is no pricing in it, no terms and no dates. Where it gives a duration, that is planning guidance for sequencing the work.

**It is not** a description of one page or one campaign. Everything here is written so the same pattern extends to the next page, the next brand and the next region without re-engineering.

## 1.3 The documents this sits beside

| Document | What it answers |
|---|---|
| **Solution and Algorithm** | What the engine does and how it decides. The dimension registry, the scoring model, the learning stages. |
| **This guide** | How it is implemented, integrated and operated, by whom, in what order. |
| **Integration kit** | The SDK package, the API reference and the payload schemas your developers code against. Delivered in Phase 3. |

---

# 2. The system in one page

## 2.1 What the platform does

The platform watches how a shopper behaves on your site, keeps a small, decaying picture of what that shopper is interested in, and answers one question for every personalizable space on a page: **of the candidates you have registered, which one belongs here, for this shopper, right now, and why.**

Three properties define it, and every part of the implementation follows from them:

- **It decides by ID.** The platform returns your content and product identifiers. Your front end renders. We never inject markup into your pages and never host your assets.
- **It is deterministic at decision time.** No model runs on the serving path. The same inputs produce the same decision, and every decision carries an explain record that reproduces it.
- **Your defaults always win the race.** A slot with no decision, a slow network, or an unreachable platform all resolve the same way: your page renders what it would have rendered anyway.

## 2.2 The five channels between your systems and ours

Everything in this implementation is one of five conversations. If you understand these five, you understand the integration.

| # | Channel | Direction | Who builds it | What moves |
|---|---|---|---|---|
| 1 | **Browser SDK** | Both ways | Your front-end team, using our package | Behavioral events out of the page; decisions into the page |
| 2 | **Catalog and feed APIs** | Your systems to us | Your CMS, DAM and commerce teams | Content and product records, their attributes and their lifecycle |
| 3 | **Operator console and configuration APIs** | People and machines to us | Us, used by your merchandisers and analysts | Weights, strategies, pins, blocks, audiences, slot settings |
| 4 | **Reporting and export** | Us to your systems | Us, consumed by your data team | Decision records, outcome records, reports, warehouse delivery |
| 5 | **Connectors** | Both ways, optional | Us, configured with your credentials | Durable profile memory in your customer data platform, experimentation |



## 2.3 Where it runs, and where your data lives

The platform runs at the edge of a global network, in the data center closest to each shopper, rather than in one region behind your site. That is what makes an in-session decision cheap enough to make on every request.

Section 9.3 lists each store, what is kept there, and for how long. The short version: **behavioral state is first-party, small, and scoped to one brand**; identifiers are ours and yours, never a third party's; and durable customer records stay in your systems, not ours.

## 2.4 The invariants

These are the rules we design against. They are the same rules your architects should hold us to.

> **Your front end paints, always.** Decisions are data. Rendering is yours.
>
> **Content and products are addressed by your identifiers.** The ID you give us is the ID we give back.
>
> **A slot with no decision renders your default.** Absence is a defined, expected state, not an error.
>
> **No asset appears twice on a page.** The page-level decision set is de-duplicated before it reaches you.
>
> **Slots you mark off-limits are never touched.**
>
> **Gates, then pins, then weighted ranking.** Your rules decide what can and must show. Affinity decides what does show in the space that is left.
>
> **Every decision carries an explain record.** If a merchandiser asks why, there is an answer, not a shrug.
>
> **No model runs on the decision path**, at any stage of the learning ladder.

---

# 3. The visitor journey, end to end

This section is the mental model. Sections 5 and 6 give the exact calls and payloads.

## 3.1 First paint

A shopper opens a page. Your page loads the SDK and asks for the decision set for that page. The platform answers from state it already holds for that visitor, in a single request, and your template renders each slot against the returned IDs. Where a slot has no decision, your default renders.

For a first-time visitor there is no behavioral history, so the first answer comes from what can be known without it: the coarse region the request arrives from, what is trending in that region across the population, the entry channel, and any priors your team has supplied. This is the cold start, and it is why the first page is personalized rather than generic.

## 3.2 During the session

The shopper browses. Your page emits events: a content impression, a click, a dwell, a product view, a save, an add to cart. Each event updates that shopper's interest vector at the edge in milliseconds.

Two things follow. The shopper's affinity scores rise on the dimensions the behavior touched and decay on the ones it did not, and audience membership is recalculated: the shopper enters an audience when a score crosses the entry threshold and leaves it when the score decays below the exit threshold.

The next decision the page asks for reflects everything that has happened up to that moment.

## 3.3 After the session

Two things persist. The behavioral state itself, so a returning shopper is recognized rather than re-learned, and the record of what was decided and what happened next, which is what measurement and later learning stages read.

If you connect your customer data platform, durable profile facts and audience membership also land there, where the rest of your marketing stack can use them.

## 3.4 The same journey, as a table

| # | Your side | Our side |
|---|---|---|
| 1 | The page loads and asks for the page's decisions | We read this visitor's state, or build a cold start from region, population trend and entry channel |
| 2 | Each slot renders by your identifier; your default renders where there is no decision | The decision and the reasons behind it are recorded |
| 3 | The shopper acts, and the page emits an event | The interest vector updates at the edge, and audience membership is recalculated |
| 4 | The page asks again, or listens for a change | The next answer reflects everything up to that moment |
| 5 | The shopper buys, and your order event is sent | The outcome is credited to the decision that produced it |
| 6 | Your analysts read the result on your numbers | Decision and outcome rows land in your warehouse on the schedule you set |

## 3.5 When we are slow, or unreachable

This is the part your architects will ask about first, so it is stated plainly here rather than in an appendix.

| Condition | What your page does | What the shopper sees |
|---|---|---|
| Decision arrives in time | Render the returned IDs in the returned order | Personalized page |
| Decision is slow past your timeout | Stop waiting. Render defaults. | Your normal page |
| Slot missing from the decision set | Render that slot's default | Your normal content in that slot |
| Platform unreachable, or the SDK fails to load | Render defaults. Events are dropped, not queued forever. | Your normal page |
| Shopper has not consented to tracking | Ask for nothing and render defaults, or render the non-personalized answer, per the rule you set in 4.8 | Your normal page |

The design point: **there is no state in which your page waits on us, and no state in which a missing answer leaves an empty box.**

# 4. What we need from you

## 4.1 The dependency list

Everything below is something only your side can supply, and each one gates work that cannot start without it. The phase names are the ones in section 11.

| # | What we need from you | Needed by | Detail in |
|---|---|---|---|
| 1 | Working-session participants: data science for the registry, a front-end lead for the payload review, content operations for the taxonomy | Design | 4.11 |
| 2 | Content sample, roughly 100 to 500 assets with whatever metadata exists. Sparse is fine. | Design | 4.2 |
| 3 | Slot map and the default for every slot | Design | 4.5 |
| 4 | Your data layer or tag manager position, confirmed | Design | 4.6 |
| 5 | Code freeze dates and the exception process | Design | 11 |
| 6 | Security review scope, timeline and a named approver | Design | 9 |
| 7 | Content feed access: system credentials, or a JSON or CSV export path | Data onboarding | 4.2, 7.1 |
| 8 | Product feed, or an export, with the attribute vocabulary | Data onboarding | 4.3 |
| 9 | Lifecycle and rights fields on content: publish, expiry, market restrictions | Data onboarding | 4.2 |
| 10 | Lower-environment origins, and the network path verified including the socket | Environment | 9 |
| 11 | Retention periods per category, agreed with your privacy team | Environment | 9.4 |
| 12 | Consent framework, and the behavior you require when consent is withheld | Integration | 4.8 |
| 13 | Conversion or order event | Integration | 4.6 |
| 14 | Front-end capacity between the kit landing and your code freeze | Integration | 11 |
| 15 | Instrumentation verified by your own QA | Integration | 4.6 |
| 16 | Historical performance data, if you want the cold start seeded | Optional | 4.10, 7.5 |
| 17 | Primary metric written down, and the holdout share approved | Before launch | 4.10 |
| 18 | Privacy and data-handling review signed off | Before launch | 9 |
| 19 | Named tuning owner | Before launch | 12.1 |
| 20 | Production origins and your release slot | Before launch | 8 |

Five of these move the date on their own, and they are the ones to start this week:

1. **Stable content identifiers and the content export.** Nothing starts without them.
2. **Data layer maturity.** The largest single variable in the instrumentation effort.
3. **WebSocket egress through your content delivery network and firewall.** Cheap to test now, expensive to discover in December.
4. **Front-end capacity before your freeze.** The critical path runs through your developers.
5. **Security review, scheduled early, with a named approver.**

## 4.2 Content

### What a content record must carry

Six fields are required. Everything else is optional and each optional field buys a specific behavior.

| Field | Required | What it is | Rules |
|---|---|---|---|
| `id` | Yes | The identifier the platform uses for this asset, and the one it returns in every decision | Unique within the catalog. Stable forever. |
| `customerContentId` | Yes | Your own system's identifier, echoed back on every decision and every record | Free text |
| `type` | Yes | The rendering kind, for example `on_model`, `silo`, `video`, `editorial` | Free text. Also used as a scoring value if you do not tag `contentType` explicitly. |
| `title` | Yes | A human-readable name, so a merchandiser can recognize it in the console | Non-empty |
| `tags` | Yes | The attributes that drive scoring, grouped by dimension: `{ "occasion": ["evening"], "line": ["Tabby"] }` | An object of dimension to list of values. May be empty, but an empty object means the asset can only be chosen by catalog order. |
| `slotTypes` | Yes | Which slots this asset is allowed to fill | At least one. Matched exactly against the slot identifier. |
| `renderUrl` | No | Where your front end resolves the asset | An absolute `https` URL or a site-relative path. Echoed, never rewritten. We never host your assets. |
| `lifecycle.status` | No | `live`, `draft` or `expired`. Absent means live. | Only live assets are eligible |
| `window.from`, `window.to` | No | Publish and expiry, as ISO 8601 timestamps | `from` must precede `to`. `to` is exclusive. Outside the window, the asset cannot be chosen at any score. |
| `inStock` | No | Availability | `false` removes the asset from every decision |
| `journeyStageFit` | No | Which stage the asset suits: `exploring`, `considering`, `deciding` | Used with the slot's stage settings |
| `freshnessDate` | No | When the asset should be considered new | Drives the freshness bonus where a slot enables it |
| `featuredProductIds` | No | Products this asset features | Lets content and product affinity reinforce each other |
| `merchandising` | No | `season`, `promotion`, `margin`, each between 0 and 1 | Business weighting a merchandiser can dial per slot |
| `art`, `excerpt`, `subtitle`, `runtime` | No | Display helpers your front end may use | Strings |

Two things to note before your CMS team starts:

> **There is no locale field.** Market and language are modelled as an ordinary tag dimension, for example `"locale": ["en-GB"]`, and a slot then excludes the values it must not show. This is deliberate, it keeps market rules in the same mechanism as everything else, and it needs to be agreed at kickoff because it affects how the feed is built.
>
> **Unknown fields are dropped.** The catalog keeps the fields above. Anything else your system sends is ignored rather than stored, so a field you need for rendering must either be a tag, or live behind your `renderUrl`.

### Stable identifiers

Every decision is addressed by identifier. If an identifier changes when an asset is edited, republished or moved, decisions point at nothing and slots quietly fall back to defaults. That failure is silent, which is what makes it expensive. Confirm in the data audit, in week one, that your identifiers survive a republish.

### How content reaches us

| Path | How it works | When to use it |
|---|---|---|
| **Direct import** | Your system posts a JSON array or a CSV to the import endpoint | The usual path. Start here on day one. |
| **Pull** | You give us a URL we fetch on a schedule | When your CMS can expose a feed but cannot call out |
| **Manual export** | A file, imported by hand or by our team | Unblocks everything on day one while adapter work is scheduled |

Both machine paths accept common alternative names for fields, so a feed rarely needs reshaping first: `systemId` or `contentId` for `id`, `cmsId` for `customerContentId`, `url` for `renderUrl`, `slots` for `slotTypes`, `publishAt` and `expireAt` for the window, `in_stock` or `ats` for stock. Tags can arrive as an object, or as a compact string: `"line:Tabby;occasion:evening|everyday"`.

Two modes: **replace** rewrites the catalog, **merge** upserts by identifier and leaves untouched fields alone. Merge is what a nightly feed should use.

**Limits per import:** 2 MiB of body, 10,000 records. Larger catalogs arrive in batches. The catalog as a whole is also capped at 2 MiB, which is a real planning constraint: if the launch catalog is large, we scope which subset is registered for personalization, which is a conversation for kickoff rather than a surprise in Phase 2.

### What happens to a bad record

Every problem in the batch is returned at once, not just the first, naming the record and the field:

```json
{
  "ok": false,
  "received": 412,
  "errors": [
    "pieces[37].slotTypes: required non-empty string array",
    "pieces[102].window: from must precede to",
    "pieces[288].id: duplicate 'CMP-1450'"
  ]
}
```

Nothing is partially published. A batch either validates and becomes a new version of the catalog, or it is rejected and the previous version stays live.

### Sparse metadata and enrichment

Where metadata is thin, we propose tags rather than inventing them. A batch of proposals is generated at design time, your content operations owner approves, edits or rejects each one, and only approved labels enter the catalog. No model runs when a decision is made, and nothing is published without a person's approval.

## 4.3 Products

Product ranking works differently from content, and the difference matters for planning.

**We do not hold a copy of your product catalog.** When you ask for a product grid to be sorted, you send the candidate identifiers **with the attributes to rank on**, and we return the order. Your commerce platform stays authoritative for price, availability and entitlement, and nothing goes stale in our copy because there is no copy.

That has one consequence your team must design for:

> **Product attributes have to travel on the request and on the events.** A product view event that carries only an identifier teaches the engine nothing, because there is no catalog to look the identifier up in. Send the same handful of attributes you rank on, for example line, category, silhouette, occasion, colour, price. This is a short list, it is already in your data layer in most cases, and getting it wrong is the most common cause of a system that looks live and learns nothing.

What we need from your side:

| Item | Why |
|---|---|
| The product feed, or an export | To agree the attribute vocabulary, generate the starting audiences, and calibrate the registry with your data science team |
| Stable product identifiers, the same ones the commerce platform and your events use | Identifier parity is what lets feed, events and decisions be joined |
| The attribute list, with its value vocabulary | These become dimensions. Ranking quality is bounded by attribute quality. |
| Whether your search or sort returns the full result set or a server-side page | Determines whether ranking sees the whole result or the page. Both are supported; they are different integrations. |
| Refresh cadence, and how price and availability changes propagate | Determines how current the eligibility rules can be |

## 4.4 Taxonomy: how your tagging becomes behavior

A **dimension** is one axis of taste. Each dimension in the registry declares:

| Setting | Plain meaning |
|---|---|
| `key` | The dimension's name. This is the key in `tags` on a content record, and in the weights on a slot. |
| `source` | Which field on a product, a candidate or an event the value is read from. Usually the same word as the key. |
| `multi` | The field holds a list, and every entry scores separately, for example `occasion: ["work", "evening"]`. |
| `derive: band` with `cuts` and `labels` | The field is a number to be bucketed, for example price into `entry`, `core`, `elevated`. There is always one more label than there are cut points. |
| Decay horizon | How quickly interest on this dimension fades when the shopper stops showing it. Short for things that change by the hour, long for things that persist. |
| Half-saturation point | How much repeated behavior it takes to reach half the maximum score. It is what stops the tenth click counting as much as the first. |
| Enter and exit thresholds | The score at which a shopper joins an audience for a value, and the lower score at which they leave. Keeping them apart stops membership flickering. |

Rules your taxonomy has to respect:

- At most **32 dimensions** in the registry. The agreed launch set is 6 to 8, with location included from the start.
- Values are matched **exactly**, so `Evening`, `evening` and `evening wear` are three different values in content tagging. A closed vocabulary is not a nicety, it is the difference between a dimension that scores and one that does not.
- Each dimension tracks a bounded number of values per shopper, 24 by default, and the weakest are dropped when that fills. Dimensions with thousands of values do not personalize; they dilute.
- A tag on a dimension nobody registered is reported back to you as a warning rather than silently ignored, so tagging drift shows up in the console rather than in a quarterly review.

**One registry decision that has to be made at kickoff:** the weight of each dimension, which is how much it counts in the final score. Weights are live-editable afterwards by your tuning owner, and setting a weight to zero removes that dimension's influence entirely without a release.

## 4.5 Pages, slots and defaults

A **slot** is the addressable space a decision fills. For each slot we need six things, and this is the slot map in Appendix C.

| What | Example | Why |
|---|---|---|
| Stable identifier | `home_hero` | Decisions are addressed to it. It must not change between releases. |
| How many items it holds | 1, or 6 for a carousel | Between 1 and 50 |
| Which asset types may fill it | `on_model`, `editorial` | Restricts by rendering kind |
| The weights for this slot | occasion 0.35, line 0.25, category 0.20, price band 0.20 | Different slots can care about different things |
| Your default | The current campaign hero | Rendered whenever no decision applies. Without one, the slot cannot be verified. |
| Off limits or not | Legal banners, always off limits | An off-limits slot is never touched, on any arm |

Beyond that, a slot can carry merchandising controls, all of which outrank the engine:

- **Pins**: one asset fixed in place, or an ordered list that occupies the first positions with ranking filling the rest.
- **Exclusions**: assets that must never appear here, and tag values that must never appear here.
- **Diversity**: at most N items sharing one value of a dimension, so a carousel does not become six of the same thing.
- **Fatigue**: a penalty for an asset this shopper has already been served, within a window you choose.
- **Freshness**: a bonus for new assets, decaying over a half-life you choose.
- **Stage**: how much to favour assets that suit the shopper's journey stage.

The order of precedence never changes: **eligibility gates first, then pins, then weighted ranking.** Your rules decide what can and must show. Affinity decides what does show in the space that is left.

## 4.6 Events and instrumentation

This is the area with the highest variability and the greatest schedule risk, which is why the data audit asks about your data layer in week one.

### The events that matter

| Event | Fires when | Must carry | Effect |
|---|---|---|---|
| `content_impression` | A registered asset becomes visible in a personalizable slot | Content identifier, slot, page | Records exposure. Deliberately scores zero by default: seeing something is not choosing it. |
| `content_click` | The shopper activates that asset | Content identifier, slot, page, and the decision identifier we returned | The strongest content signal, and what attribution is credited against |
| `content_dwell` | Visible past your agreed threshold | Content identifier, slot, milliseconds | A softer engagement signal |
| `video_complete` | A video asset finishes | Content identifier, slot | Strong content signal |
| `product_view` | A product page renders | Product identifier **and its ranking attributes** | Builds product affinity |
| `add_to_cart` | An item is added | Product identifier, attributes, value | Strong intent, and moves journey stage |
| `wishlist_add` | An item is saved | Product identifier, attributes | Medium intent |
| `purchase` | The order completes | Order identifier, items, value, currency | The outcome measurement reads |
| `page_view` | Any page | Page path, page type | Context and visit boundaries |
| `button_click`, `form_submit`, `email_open`, `custom` | As they occur | Whatever you choose | Available for your own signals |

Each event type carries a weight in the registry, which is how much one occurrence adds. Weights are yours to tune after launch.

### The field that couples decisions to outcomes

Every decision we return carries a decision identifier. **Echo it back on the events that follow.** That is what lets an outcome be credited to the decision that caused it rather than to a guess. An event that carries a malformed decision identifier is rejected outright rather than silently mis-attributed, so it is better to omit it than to invent one.

### Identifier parity, again

The identifiers in events must be exactly the identifiers in the catalogs. Mismatched identifiers are discarded. Affinity never builds, decisions stay generic, and the system looks like it is working while learning nothing. Verify on real traffic in your lower environment before Phase 3 closes.

### Visits, sessions and channel

The platform decides visit boundaries itself, after 30 minutes of inactivity, and classifies the entry channel once per visit into direct, paid social, paid search, email, organic or referral. Your page sends the entry information it can see, for example campaign parameters and referrer, and the platform decides which event crossed a boundary. Your team does not have to model visits.

## 4.7 Identity

Three states, and the difference between them is worth your architects' attention.

The platform issues the identity, not the page. On its first call the SDK asks for a session; the platform returns a signed capability naming the subject and the session, valid for at most 24 hours and renewed automatically. The page stores it and presents it on every later call. A page cannot invent a visitor identifier or ask for someone else's decisions, because the identity travels in a signature rather than in a parameter.

| State | Who the shopper is | What persists |
|---|---|---|
| **Anonymous** | A first-party identifier the platform issues on the first call and the browser stores | Behavior on that browser |
| **Recognized** | Your account identifier, linked through a signed assertion | Behavior follows the person across browsers and devices |
| **Detached** | Signed out, back to anonymous | The person's history stays, this browser no longer carries it |

### Linking a signed-in shopper

When a shopper signs in, your backend authorizes the link. This is the one piece of server-side work the integration requires, and it is small.

Your server computes a signature over four values joined by newlines, using the brand's identity secret, which lives only on your server:

```
assertion = base64url(
  HMAC-SHA256(
    secret,
    tenant + "\n" + visitorId + "\n" + accountId + "\n" + exp
  )
)
```

where `exp` is a Unix timestamp in seconds, no more than 24 hours ahead. The page then calls the link endpoint with `visitorId`, `accountId`, `exp` and `assertion`.

> **Why this exists.** The site key identifies your site, which means anything your page can send, anyone with your page can send. Without a server-side signature, a visitor could claim any account identifier and be handed that person's profile. Every link requires this signature, in every environment, with no exception path.

The account identifier never becomes a key in our stores. It is hashed, with a per-deployment salt, into an opaque shopper identifier. Two brands with the same account identifier produce two different, unlinkable shoppers.

### Sign out

Calling detach returns the browser to anonymous and issues fresh anonymous credentials. The person's profile is untouched, and the browser stops carrying their identity. This is the correct call on sign-out and on account switching.

## 4.8 Consent

Two switches, tracking and personalization, each explicit, each with a chosen-at and an expiry, each lasting 30 days before the shopper is asked again.

What your integration has to do:

1. Pass the shopper's consent state to the SDK when the page loads and whenever it changes.
2. Accept that absent or expired consent means off. There is no implicit yes.
3. Decide, per market, what should happen when consent is withheld: your defaults, or a non-personalized answer from the platform.

A request can always **withdraw** consent, and can never grant it. That asymmetry is deliberate: a compromised page cannot turn tracking on for a shopper who refused it.

## 4.9 Environments, network and security

Covered in sections 8 and 9. In summary, what we need from you is the origins list per environment, the decision on a first-party subdomain, the WebSocket verification through your content delivery network and firewall, your retention numbers, the consent framework, and the security review scope with a named approver and a date.

## 4.10 Measurement

Three things, all needed before launch rather than after:

1. **The primary metric, in writing**, with secondary metrics named at the same time.
2. **Holdout approval**, and the share. Every decision is tagged with the arm it belongs to, personalized or default, and both are recorded. The comparison itself is deliberately computed in your environment on your definitions, from records we hand over. We do not mark our own homework.
3. **Analytics access for your team**, so the result is read on your numbers.

Optionally, **historical performance data**. It shortens the cold start, because your analysts' existing knowledge can be imported as starting beliefs rather than relearned. It is an enhancement, not a precondition, and access negotiations are slow, so it is asked for early or dropped deliberately.

## 4.11 People

| Role, your side | What they decide or do | When they are needed |
|---|---|---|
| **Programme owner** | Scope, dates, escalation | Throughout |
| **Data science or analytics lead** | The dimension registry and its weights, the measurement design | Kickoff, then the stage two design review |
| **Registry approver** | Signs off the registry. One person, not a committee. | Kickoff |
| **Content operations owner** | The taxonomy, tagging decisions, enrichment approvals | Kickoff, then continuously |
| **Front-end lead** | The payload shape, the SDK integration, the slot map | Kickoff, then Phases 3 and 4 |
| **Commerce or platform engineer** | The product feed, the sort integration, the conversion event | Phase 2 onwards |
| **Backend engineer** | The sign-in assertion endpoint | Phase 3, about a day of work |
| **Security approver** | The review, and its conditions | Named at kickoff, reviewing from Phase 1 |
| **Privacy owner** | Consent behavior, retention numbers, the data-handling review | Kickoff and pre-launch |
| **QA owner** | Instrumentation verification in your environment | Phase 3 |
| **Tuning owner** | The weights after launch | Named before go-live |

| Role, our side | What they do |
|---|---|
| **Solution architect** | The design, the registry and taxonomy sessions, the integration review |
| **Delivery engineer** | Provisioning, catalogs, configuration, the acceptance run |
| **Support** | Day two operations, incidents, releases |
| **Data science partner** | The measurement design, the stage two review, priors |

# 5. The integration, step by step

Everything in this section runs against the platform as it stands. Your front-end engineers can work from it directly, and the integration kit repeats it as a package with the schemas.

**In scope of this chapter:** content decisions, product sorting, events, identity, consent. **Not covered here:** the shopper-facing assistive surfaces such as site search and the styling assistant, which are separate capabilities with their own integration notes and their own metering.

## 5.1 Install

One script from the platform host. No dependencies, and nothing else on the page changes.

```html
<script src="https://<platform-host>/sdk/edge-personalization.js"></script>
<script>
  const client = EdgePersonalization.createClient({
    // the brand decisions are made for
    tenant:   'coach',
    // recorded on every decision
    brand:    'coach',
    // omit when the platform runs on your own subdomain
    endpoint: 'https://<platform-host>',
    // authorizes this site for this brand
    sdkKey:   '<your site key>',
    // names your integration on every event
    source:   'coach-web',
  });
</script>
```

As a module:

```js
import { createClient }
  from 'https://<platform-host>/sdk/edge-personalization.esm.js';
```

| Option | Default | What it controls |
|---|---|---|
| `tenant` | required | The brand |
| `brand` | the tenant | Recorded on each decision, for multi-brand reporting |
| `endpoint` | the page's origin | Where the platform is |
| `sdkKey` | none | The site key. Required on staging and production. |
| `source` | `sdk` | Names the caller on every event |
| `listenOnly` | false | Receive decisions, send nothing automatically. For sites with their own analytics pipeline. |
| `hydrateTimeoutMs` | 1500 | How long the page waits before defaults stand |
| `heartbeatMs` | 25000 | Socket keepalive |
| `reconnectMs` | 3000 | Socket reconnect delay |
| `visitorIdKey` | `opt_visitor_id` | Storage key for the first-party visitor identifier |

The SDK is a single modern-browser script and relies on `fetch`, `WebSocket`, `localStorage` and `IntersectionObserver`. Confirm your supported browser matrix at the payload review session so support is stated explicitly rather than assumed.

**Create one client for the life of the page, including in a single-page application.** Route changes call `hydrate()` again with the new page; they do not create a second client. Every subscription returns a function that removes it, and a view should call those when it unmounts.

## 5.2 Ask for the page's decisions

One call returns every slot on the page, in page order.

```js
client.listen.subscribe('hero', (decisions) => {
  const d = decisions[0];
  // no decision for this slot: your default, immediately
  if (!d) return renderDefaultHero();
  // render by YOUR identifier
  renderHero(d.customerContentId);
  client.emit.rendered('hero', d.contentId, heroEl, d.decisionId);
});

// one request, every slot on the page
client.listen.hydrate({ page: 'home' });

// optional: the live channel
client.connect();
```

What each subscriber receives is the list for that slot, in order. What matters:

- **Render by `customerContentId`**, your own identifier. Keep `contentId`, ours, for the events you send back.
- **An empty list is a real answer**, not a failure. It means "render your default".
- **`decisionId` is the receipt.** Keep it with the item you actually painted, and echo it on the events that follow, so an outcome is credited to the decision that caused it.
- The most recent `hydrate()` wins. A superseded response is discarded rather than applied late.

If you render server-side, you can fetch the same payload on your server and hand it to the SDK with `client.listen.apply(serverPayload)`, which skips the browser round trip entirely.

## 5.3 Report what actually painted

```js
client.emit.rendered(slot, contentId, element, decisionId);
```

Call it **after** the item is actually on screen, including after any animation. It sends the impression once and measures dwell while the element is visible. Restoring a default does not create an impression, which keeps your exposure counts honest.

## 5.4 Send events

Four capture paths. Most sites use two of them.

**Explicit calls, for commerce.** The conversion event is the one that measurement cannot do without.

```js
client.emit.productView('SKU-123', {
  line: 'Tabby',
  category: 'Handbags',
  occasion: ['everyday'],
  price_usd: 395,
});

client.emit.addToCart('SKU-123');
client.emit.wishlistAdd('SKU-123');

client.emit.purchase({
  orderId: 'A1B2',
  value: 395,
  currency: 'USD',
  items: [{ productId: 'SKU-123', quantity: 1, price: 395 }],
});

client.emit.contentClick(contentId, slot);
```

The attributes on a product event are the registry's source fields for your brand, agreed in the first working session. The defaults are `line`, `category`, `subcategory`, `silhouette`, `occasion` and `price_usd`.

**Declarative attributes, for slot-level capture with no code per slot:**

```html
<section data-op-slot="story"
         data-op-content="cnt_8f3a"
         data-op-type="editorial">
  ...
</section>

<button data-op-track="add_to_cart" data-op-product="SKU-123">
  Add to bag
</button>
```

```js
// impression at half visible, dwell on leaving, click on activation
client.emit.declarative();
```

**Your data layer, the cheapest path where a tag layer exists.** Common analytics event names are mapped by default, and you can override or add any of them.

```js
client.emit.dataLayer();

client.emit.dataLayer({
  mapping: {
    my_event: (e) => ({
      type: 'custom',
      data: { event: 'my_event', id: e.id },
    }),
  },
});
```

**Automatic**, which is `rendered()` above.

Nothing is sent on page load by itself. A page view is an explicit `client.emit.pageView()` or a data layer event, which keeps the platform silent on pages you have not instrumented.

Order events can also come from your server rather than the browser, which is more reliable for revenue. That is a payload-session decision, because the server needs the shopper's session identity to attribute the order.

## 5.5 Sign-in and sign-out

```js
// after your own login succeeds
const r = await client.identify(account.id, {
  source: 'login',
  getAssertion: (visitorId) =>
    fetchAssertionFromYourBackend(visitorId, account.id),
});
if (r.ok) console.log('now carrying', r.shopperId);

// at sign out
await client.logout();

client.on('identity', ({ visitorId, previous, reason }) => {
  // reason is 'identified' or 'logout'
});
```
client.on('update', (u) => {
  // the shopper's state changed: re-ask for the slots that should move
  client.listen.hydrate({ page: currentPage });
});
```http
POST /sort
X-SDK-Key: <site key>
X-Shopper-Session: <capability issued to this shopper>
```

```json
{
  "userId": "vis-2f1c\u2026",
  "candidates": [
    {
      "id": "SKU-123",
      "line": "Tabby",
      "category": "Handbags",
      "price_usd": 395
    },
    {
      "id": "SKU-456",
      "line": "Rogue",
      "category": "Handbags",
      "price_usd": 795
    }
  ],
  "weights": {
    "affinity": 1,
    "dims": {
      "line": 2
    }
  }
}
```

```json
{
  "ok": true,
  "tenant": "coach",
  "configVersion": "reflex-demo-v1+r14",
  "order": [
    "SKU-456",
    "SKU-123"
  ],
  "items": [
    {
      "id": "SKU-456",
      "feedRank": 1,
      "rank": 0,
      "score": 0.4211,
      "drivers": [
        {
          "dim": "line",
          "value": "Rogue",
          "a": 0.42,
          "w": 1,
          "contribution": 0.42
        }
      ]
    }
  ],
  "dropped": 0
}
```

Three properties worth knowing:

- **Up to 500 candidates** per call, and the ranking happens inside whatever you send. Where your commerce platform pages server-side, ranking operates within the page returned.
- **`weights.affinity: 0` reproduces your existing order exactly.** Parity is a setting of the same engine, not a fallback mode, which makes a safe first rollout trivial.
- **Your platform stays authoritative.** We never filter on price, stock or entitlement. Candidates with a missing or duplicate identifier are dropped and counted, and nothing else is removed.

A second endpoint, `POST /sort/intent`, additionally filters by attribute before ranking, for example "linen or cotton only". It requires an explicit `inStock` on each candidate and uses your registry's dimension names.

## 5.8 Failure behavior, and the honest answer about flashing

**What the platform guarantees:** one call returns every slot; a slot with no decision returns an empty list; on timeout or failure every subscriber is told so explicitly, so your code takes the default path rather than waiting.

**What the platform does not decide:** whether the shopper sees a flash. That is determined by how your page renders, and it is a choice your front-end lead should make deliberately at the payload review session. There are three patterns.

| Pattern | How it works | Flash | Cost |
|---|---|---|---|
| **A. Server-side** | Your server or edge calls the snapshot and renders the chosen items into the HTML. The SDK is handed the same payload with `listen.apply()`. | None | Requires a server-side call in your render path |
| **B. Reserve and fill** | The page reserves the slot's space and fills it when the decision arrives, falling back to your default at the deadline | None, but a brief placeholder | Simple, and the usual choice |
| **C. Default then swap** | Your default paints immediately, and is replaced if a decision arrives | Visible repaint | Simplest, acceptable below the fold |

Our recommendation: **A for anything above the fold where you already render server-side, B elsewhere, C only below the fold.** For a returning shopper the decision typically arrives in tens of milliseconds, so B is rarely visible. The first request for a brand-new visitor is the expensive one, because it creates state, and that is exactly the case where A earns its keep.

The deadline itself is yours: `hydrateTimeoutMs`, 1.5 seconds by default. Set it to whatever your performance budget allows and the page will never exceed it.

## 5.9 What to test before your code freeze

1. **A cold page.** Fresh browser, every slot renders within your deadline.
2. **Decisions by identifier.** Each `customerContentId` exists in your system and renders.
3. **Events.** Product view, add to bag and purchase each return success.
4. **The loop.** View a product, reload, the hero follows the interest. Click the served hero and see it land against that item in the console.
5. **Sign-in.** `identify` returns a shopper identifier, the socket reconnects, later events carry it, `logout` returns a fresh anonymous identifier.
6. **Graceful absence.** Block the platform host in your browser's network tools. The page renders defaults and nothing waits.
7. **The connection check.** Run the check we provide from inside your network. Every line passes, including the WebSocket upgrade.

---

# 6. The decision payload, field by field

## 6.1 The request

```http
POST /v1/coach/decisions/snapshot
X-SDK-Key: <site key>
X-Shopper-Session: <capability>
Content-Type: application/json
```

```json
{
  "page": "home",
  "brand": "coach",
  "channel": "paid_social",
  "browsingSessionId": "s-LT4B2"
}
```

| Field | Meaning |
|---|---|
| `page` | The page's name in the slot document. Defaults to `home`. |
| `brand` | Recorded on the decisions. Defaults to the brand in the path. |
| `channel` | The entry channel, if the page knows it |
| `browsingSessionId` | Your own session identifier, so attribution compares one identifier space |
| `trackingConsent`, `personalizationEnabled` | Present only to **withdraw**. A request can never grant consent. |

The shopper is identified by the signed capability, never by an identifier in the body or the query string. That is what stops one visitor asking for another's decisions.

## 6.2 The response

```json
{
  "ok": true,
  "tenant": "coach",
  "brand": "coach",
  "page": "home",
  "visitor_id": "vis-2f1c\u2026",
  "session_id": "9cb1810f-\u2026",
  "identity_anchor": "session",
  "ts": 1788541396189,
  "arm": "personalized",
  "cell": {
    "channel": "direct",
    "visit_bucket": "1",
    "region": "US-NY",
    "affinity": "line:Tabby"
  },
  "versions": {
    "config": 15,
    "catalog": 4,
    "slots": 7,
    "learn": 19,
    "lift": 0,
    "prior": 0,
    "policy": 19
  },
  "config_label": "reflex-demo-v1+r15",
  "decisions": [
    {
      "contentId": "cnt_7cb1e039",
      "customerContentId": "CCH-001",
      "type": "campaign",
      "slot": "hero",
      "order": 1,
      "score": 0.455,
      "strategy": "affinity",
      "explain": {
        "drivers": [
          {
            "dim": "line",
            "value": "Tabby",
            "a": 0.7286,
            "weight": 0.35
          }
        ]
      }
    }
  ],
  "sources": {
    "catalog": {
      "version": "coach-content+r4",
      "revision": 4,
      "pieces": 26
    },
    "slots": {
      "version": "slots-coach+r7",
      "revision": 7,
      "count": 4
    },
    "consent": {
      "tracking": true,
      "personalization": true,
      "personalized": true
    },
    "state": "session"
  },
  "write": true
}
```

| Field | What it tells you |
|---|---|
| `decisions[]` | What to render, in page order. This is what your page paints. |
| `arm` | `personalized`, or `default` when this shopper is in the holdout or has not consented |
| `cell` | The context the decision was made in: channel, visit number bucket, region, leading interest |
| `versions` | The revision of every input that produced this answer: configuration, catalog, slots, learning. This is what makes a decision reproducible months later. The learned terms are carried per decision on the stored record rather than at the top of the response. |
| `sources.consent` | Exactly which permissions were in force |
| `write` | Whether anything was recorded. False when tracking consent is absent, and then nothing about the call is stored anywhere. |

## 6.3 One decision, field by field

| Field | Meaning |
|---|---|
| `contentId` | Our identifier for the item |
| `customerContentId` | **Your** identifier. Render by this. |
| `type` | The item's kind, for example `campaign`, `editorial`, `film` |
| `slot` | Which slot it fills |
| `order` | Position across the whole page, in page order |
| `score` | The final score that ranked it |
| `strategy` | `affinity` when the shopper's interests decided, `default` when nothing was known yet, `tenant-pinned` when a merchandiser pinned it |
| `explain.drivers[]` | Why: each `{ dim, value, a, weight }` is the dimension, the value, the shopper's interest in it from 0 to 1, and the slot's weight for that dimension |
| `explain.note` | In words, when a rule rather than a score decided |
| `decisionId` | The receipt to echo on the events that follow |

## 6.4 Reading an explain record

For a merchandiser asking "why did she see the Tabby film", the drivers answer it directly:

> Interest in `line: Tabby` scored 0.73 out of 1, and this slot weights the product line at 0.35, so that contributed 0.26 of a final 0.46. The next candidate scored 0.41.

The record behind it holds more: the population trend that applied, the learned adjustment and its evidence, the merchandising boost, the freshness or fatigue terms, the diversity rule that made a piece yield, and the exact interest vector at that moment. Appendix A lists every field. Two consequences worth stating to your team:

- **A decision can be replayed.** Given the identifier, the platform re-runs it against the recorded inputs and reports whether it reproduces. That is the practical definition of a glass box.
- **Nothing in the path is a model.** The score is arithmetic over your tags and this shopper's behavior, which is why it can be explained in a sentence and audited in a table.

---

# 7. Server to server

Everything here is machine-to-machine, authenticated with an operator token or a service credential, and none of it touches the browser.

## 7.1 Content catalog

| Operation | Endpoint | Notes |
|---|---|---|
| Import a batch | `POST /content/catalog/import?mode=merge` | JSON array or CSV. `merge` upserts by identifier, `replace` rewrites. |
| Pull from your feed | `POST /content/catalog/pull` | You give a URL, we fetch it |
| Validate without publishing | `POST /content/catalog/validate` | Same rules, no write |
| Read the current catalog | `GET /content/catalog` | With its revision |
| History and rollback | `GET /content/catalog/history`, `POST /content/catalog/rollback/{n}` | Every revision carries an author and a note |

Each write is a new revision, and a rollback is a new revision carrying the old content forward, so the history is append-only and the audit answer is always "who changed what, when, and what did it look like before".

**Every write carries two headers**, and a write without them is refused rather than applied:

| Header | What it is | Why |
|---|---|---|
| `If-Match` | The revision your caller last read | Two systems writing the catalog cannot silently overwrite each other. A stale write is rejected, not merged. |
| `Idempotency-Key` | That same revision plus a unique value per attempt | A retry after a timeout applies once, not twice |

Your feed job reads the current revision, builds the batch, and writes with both headers. On a conflict it re-reads and retries, which is a five line loop and the reason a nightly feed and a merchandiser in the console can safely work on the same day.

## 7.2 Configuration

Four documents per brand, all versioned the same way, all editable by your team through the console or the API.

| Document | Holds | Who usually owns it |
|---|---|---|
| **Registry** | The dimensions, their sources, the weights and the decay settings | Data science, with the tuning owner after launch |
| **Slots** | Every page's slots: how many items, weights, pins, exclusions, diversity, freshness, fatigue, defaults, off limits | Merchandising |
| **Catalog** | Your content | Content operations |
| **Learning** | The reward per slot, the trust dial, exploration settings | Data science |

Each supports read, validate, write, history, revision read and rollback. A write that fails validation changes nothing and returns every problem at once.

> **A new brand must publish a registry before it can personalize.** There is no inherited default configuration for a customer brand, which is deliberate: an engine that silently scores on someone else's settings is worse than one that tells you it is not configured yet. This is part of provisioning, and it is done with your data science team in the first working sessions.

## 7.3 Reporting and export

| Operation | Endpoint | Returns |
|---|---|---|
| The day's report | `POST /v1/{tenant}/learn/report`, `GET /v1/{tenant}/learn/report` | Decisions, outcomes, per-slot grids, exploration, the arms |
| A range | `GET /v1/{tenant}/learn/report/window` | Pooled diagnostics over a period |
| Per-item evidence | `GET /v1/{tenant}/lift/rows` | Exposures, credited outcomes, the smoothed estimate and the evidence level, per item and cell |
| What a shopper was served | `GET /v1/{tenant}/visitors/{id}/receipts` | That person's own decisions, newest first, with the sentences |
| The export listing | `GET /v1/{tenant}/ledger/batches?date=&stream=decision` | The stored objects for a day and stream, with a cursor |
| One record | `GET /v1/{tenant}/ledger/{id}` | The decision or outcome by identifier |
| Replay | `GET /v1/{tenant}/replay/{id}` | Whether the decision reproduces against its recorded inputs, and the difference if not |

Two honest notes for your analysts, which we would rather say here than have them discover:

- The per-item numbers are **attribution diagnostics**, not a controlled experiment. They tell you what was served and what followed it. Causal claims come from the holdout comparison, computed on your side against your definitions.
- Credit intensity per exposure is not a probability, and the report labels it as such rather than dressing it up.

## 7.4 Warehouse delivery

Scheduled delivery of the decision and outcome streams into your warehouse, on a cadence you set between one minute and one day.

How it works with Snowflake, which is the supported provider today:

1. You create a loader role, database, schema and warehouse, and a user with a key pair.
2. You install the stored procedure we supply. The platform only ever calls that procedure, with parameters. It does not issue arbitrary SQL and never follows a redirect.
3. We hold your private key as a secret on the deployment, referenced by name, never written into configuration.
4. Each delivery carries a batch of rows with a sequence number, a digest, and the erasure cut-offs that apply.

**What crosses the boundary:** the ledger rows, with the raw visitor and session identifiers removed and replaced by a pseudonymous subject derived per namespace. Your analysts join to your own customers through the identity resolve endpoint, which turns your account identifiers into the same opaque shopper identifiers without your warehouse ever holding our salt.

**Erasure is carried with the data.** Rows past their retention, and rows for an erased subject, are skipped, and the cut-offs are delivered alongside so your loader can honor them in your own tables.

## 7.5 Identity operations

| Operation | Endpoint | Use |
|---|---|---|
| Resolve | `POST /v1/{tenant}/identity/resolve` | Turn up to 1,000 of your account identifiers into shopper identifiers, for joining in your warehouse |
| Look up a visitor or shopper | `GET /v1/{tenant}/identity/visitor/{id}`, `GET …/shopper/{id}` | Support and audit questions |
| Import history | `POST /v1/{tenant}/identity/events` | Seed a known customer's interests from your own records, either as behavioral rows or as typed profile facts |
| Erase | `POST /v1/{tenant}/identity/erase` | A data subject request, as described in 9.6 |

History import deserves a note, because it is the one that shortens the cold start. Two row shapes are accepted: behavioral rows, which are replayed exactly as a live event would be, and typed profile snapshots, for example a loyalty tier, which become qualification attributes rather than behavioral scores. Up to 1,000 rows per request, as JSON or CSV. Rows that cannot be applied are reported individually with the reason, rather than the batch failing as a whole.

## 7.6 Machine credentials

A system that calls these APIs uses a **service credential**: a token with its own identity, role and expiry, issued explicitly and revocable immediately. It is not a person's account and it does not expire when a person leaves. Issue one per calling system, so that revoking one does not stop the others.

# 8. Environments and access

## 8.1 What a deployment is

Each environment is a **separate deployment**: its own worker, its own key-value stores, its own object storage, its own queues, its own database and its own secrets. Nothing is shared between them except the code that is released to both. Staging and production are therefore isolated from each other by construction, not by configuration discipline.

A deployment runs in **customer mode**, which is enforced in the code rather than assumed: authentication is required, only the customer-facing routes answer at all, and the deployment refuses to start if any demonstration component is present. Everything else returns "not found".

Inside a deployment, a **brand** is a tenant. One deployment can serve several brands with isolated catalogs, configuration, audiences, audiences and credentials. Adding the second brand is provisioning, not re-engineering.

| | Your lower environment | Your production |
|---|---|---|
| Our deployment | Staging deployment | Production deployment |
| Separate stores | Yes | Yes |
| Authentication | Enforced | Enforced |
| Brands | Launch brand, plus any test brand you want | Launch brand, then the portfolio |
| Who has console access | Your integration and merchandising teams, plus ours | Your named operators, plus our support roles |

## 8.2 Addresses

Each deployment answers on its own hostname. The default form is a platform hostname that we give you at the point of provisioning.

**A first-party subdomain is the preferred production topology**: you point a hostname of your own, for example `edge.brand.com`, at the deployment, and every call from your pages is first-party. This requires a DNS record and a certificate on your side, and the mapping of that hostname to the brand on ours. It carries lead time, which is why it is on the kickoff agenda in section 13 rather than discovered later.

## 8.3 Credentials, and who holds what

| Credential | What it is for | Who holds it | Notes |
|---|---|---|---|
| **Site key** | Authorizes calls from your pages for one brand | Your front end, shipped in the page or its configuration | Sent as the `X-SDK-Key` header, or on the socket as a subprotocol. Several keys can be valid for one brand at once, so a key can be replaced without a flag day. |
| **Operator account** | A person signing in to the console | Your named people | Email and password. Created by an administrator, never by self-registration. The first password is temporary, shown once, and must be changed at first sign-in. |
| **Service credential** | A machine calling our APIs, for example your feed job | Your integration team | Issued explicitly, revocable immediately, with its own role and expiry. |
| **Identity secret** | Proves that a sign-in event is genuinely from your backend | Your backend only, never the browser | See 4.7. |
| **Connector credentials** | Our outbound calls to your systems | Held as secrets on the deployment | Referenced by name in configuration. No credential is ever written into a configuration document. |

Access tokens for the console last 15 minutes and refresh for up to 7 days. Signing out ends every session for that account. Every administrative action is written to an audit trail your administrators can read.

## 8.4 What we need from you to provision

1. The list of origins for each environment, exactly as the browser sends them, for example `https://www.brand.com` and `https://staging.brand.com`.
2. The brand identifiers you want to use, and the hostnames that map to each.
3. The named people who get console accounts, with the role each should hold.
4. Your decision on a first-party subdomain, per environment.
5. Retention periods for each category of data, agreed with your privacy team (see 9.4).
6. Where operational alerts should be delivered.

---

# 9. Security and network

## 9.1 What your network team has to do

**Nothing inbound.** The platform never opens a connection into your network. Every integration is either your browser calling us, your server calling us, or our worker making an outbound call to a system you have named and given us credentials for. There are no ports to open and no inbound firewall rules to write.

What does need to happen is allow-listing in three places:

| Where | What to allow | Why |
|---|---|---|
| Your content security policy, `script-src` | The SDK file on the platform hostname | The page loads the client |
| Your content security policy, `connect-src` | The platform hostname, for both `https:` and `wss:` | Decision calls, event calls and the live channel |
| Your CDN, proxy and web application firewall | The WebSocket upgrade on the platform hostname, and the `Sec-WebSocket-Protocol` header intact | The live channel authenticates through a subprotocol, because a browser cannot set headers on a socket upgrade. Several enterprise proxies strip this header or block upgrades by default. |

> **Verify the WebSocket path in week one, not in December.** It is cheap to test, it is invisible until the day you need it, and it is the most common late blocker in an integration of this shape. Section 13 asks for the owner by name.

On our side, the deployment answers browser calls only from the origins you list. An empty list in an enforced deployment means nothing but your own origin is allowed, so this is a fail-closed default rather than an open one.

## 9.2 What the browser carries

The SDK sends the visitor identifier on every request, so the integration does not depend on third-party cookies and works when the platform is on a different hostname from your page. Cookies the platform sets are set on the platform hostname, are `Secure`, and use `SameSite=Lax`. The session cookie is not readable by JavaScript. A small number of cookies are deliberately readable by the page so your own code can see the state it is rendering against.

Requests carry only these headers beyond the standard ones: `X-SDK-Key`, `X-Tenant`, `X-Shopper-Session`, `X-Request-Id`, and where a write needs it, `If-Match` and `Idempotency-Key`.

## 9.3 Where data lives, and what is in it

| Store | What is in it | Contains identifiers? |
|---|---|---|
| Session and profile store | The shopper's session and their interest vector | A first-party visitor identifier |
| Per-shopper object | The same interest state when the object host is used, plus the live socket | A first-party visitor identifier |
| Population trend objects | Regional interest, in aggregate | **No visitor identifiers, ever** |
| Learning statistics objects | Decayed counts per brand and slot | **No visitor identifiers** |
| Ledger, in object storage | The append-only record of decisions served and outcomes observed | Visitor and session identifiers |
| Aggregates and reports | Hourly and daily rollups built from the ledger | Counts only |
| Operator database | Operator accounts, sessions and the audit trail | Your operators, not your shoppers |

Two design points your privacy reviewer will want:

- **A recognized shopper is stored under a one-way hash**, salted per deployment, of your account identifier. Your account identifier, which may be an email address, is never a key in our stores, never the name of an object, and never a column in anything exported to a warehouse. Two brands with the same account identifier produce two different, unlinkable shopper identifiers.
- **Population aggregates never hold per-shopper location history.** Regional trending is computed from counts, and the counts carry no identifiers.

## 9.4 Retention

Retention is **explicit per category and per brand, with no defaults**. The categories are the profile, identity records, the ledger, online attribution state, hourly aggregates, recovery and quarantine records. If a category has no agreed policy, the platform refuses to operate on it rather than guessing, and the self-check reports it.

The ledger carries its own horizon, which defaults to 90 days and must match the lifecycle rule on the underlying bucket. Consent decisions carry a 30 day life, after which the shopper is treated as not having consented until they choose again.

**What we need from you:** a number for each category, agreed with your privacy team, before the deployment is provisioned.

## 9.5 Consent

Consent is carried as an explicit record with two independent switches, `tracking` and `personalization`, each with the moment it was chosen and the moment it expires.

| State | What the platform does |
|---|---|
| No consent record, or an expired one | Treated as **off**. Nothing is written about that request, and the shopper receives your defaults. |
| `tracking` on, `personalization` off | Behavior may be recorded per your policy, and decisions are not personalized. |
| Both on | Full behavior: events recorded, decisions personalized, outcomes attributed. |
| Consent withdrawn mid-session | The withdrawal applies immediately. A hint arriving with a request can only withdraw a permission, never grant one. |

The platform proves this to itself: the five minute self-check runs a real decision with consent refused and fails if anything would have been written.

**What we need from you:** which consent framework you use, how the page exposes consent state to the SDK, and the required behavior per market when consent is withheld.

## 9.6 Erasure and subject requests

A subject request is one authenticated call naming either the visitor identifier or the shopper identifier.

What happens:

1. A tombstone is written immediately. From that moment every reader honors it: the day report, point lookups, replay and the export listing all drop rows for that visitor at or before the erasure time.
2. The session, the identity pointers, the per-shopper object, the attribution ring and the cached profile entries are erased.
3. A scheduled pass rewrites the stored ledger over the retention window, removing rows and deleting objects that empty, and resuming where it stopped.
4. Aggregates are left alone, because they are counts and hold no personal data.

Two properties to brief your privacy team on, because they are unusual and deliberate:

- **The call is bounded and resumable.** Large subjects return "accepted" with progress, and you re-send the same request until the receipt says the local work is complete. This is honest about work that cannot finish inside one request rather than reporting a completion that did not happen.
- **The receipt names what it did not reach.** Anything outside our control, for example a destination you own, is listed as an outstanding obligation until someone attests it, and the receipt continues to say so. We do not mark a third party's erasure as done on their behalf.

Events that arrive after an erasure are kept. An erasure is a point in time, not a permanent ban on the browser that follows it.

## 9.7 Third parties and the decision path

No third-party data broker is in the decision path, and no model is called at decision time. Where an assistive model is used at design time, for example to propose tags for sparse content, its output is a proposal that a person on your side approves before it can affect anything. That boundary is enforced in the product, not by convention.

---

# 10. Measurement

## 10.1 The three questions measurement answers

1. **Is it running?** Coverage: how many decisions were served, on which slots, for how many visitors, with how many falling back to defaults.
2. **Is it choosing well?** Engagement: click-through and dwell on served content, by slot, by content type, by context.
3. **Is it worth it?** Incrementality: the difference between shoppers who received personalized decisions and a holdout who did not.

The first two are available from the moment traffic flows. The third requires a holdout, and it requires the decision before launch, not after.

## 10.2 The holdout

A holdout is a fixed share of traffic that deliberately receives your defaults, tagged so that both sides can be measured against the same period, the same pages and the same seasonality.

> **This is the single most important pre-launch decision, and it cannot be taken retroactively.** Traffic that ran without a holdout cannot be re-run. If the programme's value has to be demonstrated to a finance audience later, the mechanism to demonstrate it has to be switched on before the first personalized page is served.

What we need from you: the share, typically between 5 and 10 percent, and the primary metric written down before launch.

## 10.3 Metrics

| Layer | Examples | Where it is read |
|---|---|---|
| Delivery | Decisions served, slots filled, defaults rendered, latency | Console, and the report endpoints |
| Engagement | Content click-through, dwell, completion, by slot and by content type | Console and export |
| Commerce | Add to cart, order rate, revenue per visitor, by arm | Your analytics, on your numbers, joined on the identifiers we return |

We deliberately expect the business number to be read in **your** environment on **your** definitions. Our exports are built to be joined, not to replace your reporting.

## 10.4 What we hand to your data team

- **Decision records**: one per decision, carrying the slot, the chosen item, the context it was chosen in, the version of every input, and the explain record.
- **Outcome records**: impressions, clicks, dwell and conversions, correlated to the decision that produced them.
- **Daily reports** built once per day and readable through the API.
- **Warehouse delivery**: scheduled delivery into your warehouse, through a fixed, parameterized procedure, using credentials you issue and can revoke.

## 10.5 The honest statement about performance numbers

We hold measurements from our own environment. They are useful as engineering diagnostics and they are not a service level commitment, because they were taken from one client machine against one edge location with a test catalog.

What they do establish, and what we will re-measure in your environment during the integration window:

- A returning shopper's decision is answered in tens of milliseconds, of which the scoring arithmetic is effectively zero.
- A brand-new visitor's first request is materially more expensive than the second, because it creates state.
- The targets we design to are a decision under 200 milliseconds at the 95th percentile measured at the platform, and an event under 300 milliseconds.

The joint performance test in your environment, against your traffic shape, is what sets the numbers we both sign up to.

---

# 11. The plan

## 11.1 How the work is sequenced

Nine phases. What matters is the order and what each one needs from the one before it, because that is what determines where time is actually lost. Durations are typical, for planning.

| Phase | What it produces | Typical duration | Cannot start until |
|---|---|---|---|
| 0 · Design | The registry, the taxonomy, the slot map, the payload shape | 2 weeks | Participants are named |
| 1 · Environment | Your lower environment connected and verified | 1 week | Origins are supplied |
| 2 · Data onboarding | Both catalogs live, tagging calibrated | 2 to 4 weeks | Content sample, then feed access |
| 3 · Instrumentation | Events flowing from your lower environment | 2 to 4 weeks | Kit delivered, front-end capacity scheduled |
| 4 · Placement | The launch page rendering decisions | 1 to 2 weeks | Slot map, defaults, events |
| 5 · Verification | The end-to-end run, in your environment, repeatable by your team | 1 week | Phases 2 to 4 |
| 6 · Your test window | Integration tested inside your own process | Your calendar | Phase 5 |
| 7 · Launch readiness | Production ready, gates closed | 1 to 2 weeks | Phase 6 |
| 8 · Operate and expand | Tuning, then the next page and the next brand | Continuous | Live traffic |

Phases 2 and 3 overlap. Phase 1 can run in parallel with Phase 0 as soon as origins arrive.

## 11.2 The phases

### Phase 0. Design

**We do:** run the working sessions, each with materials circulated beforehand. Three sessions: the dimension registry with your data science team, the content taxonomy with content operations, the payload shape and slot map with your front-end lead. Produce the data audit from your content sample.

**You do:** name the owners in Appendix H, supply the content sample, confirm the data layer or tag manager position, state your code freeze dates and the exception process, and schedule the security review with a named approver.

**Done when:** the registry, the taxonomy, the slot map and the payload shape are written down and agreed. The data audit tells both sides what is missing before it becomes a schedule problem.

### Phase 1. Environment and access

**We do:** provision your staging deployment, issue site keys and console accounts, allow-list your origins, connect the alert destination, and hand over the connection details with a verification script you can run yourselves.

**You do:** confirm the origins, run the connection check from your own network including the WebSocket path, and confirm first-party subdomain intentions.

**Exit:** your team can reach the platform from your lower environment, sign in to the console, and see the readiness check (`/health/ready`) and liveness check (`/health/live`) answer from inside your network.

### Phase 2. Data onboarding

**We do:** register your content, calibrate enrichment against your sample with your approval step, connect the product feed, and validate identifier parity across catalog, feed and events.

**You do:** deliver the content export or feed credentials, the product feed, the lifecycle and rights fields, and the named content operations owner to settle taxonomy questions.

**Exit:** both catalogs are live in staging, every asset the launch page can show is registered, and a report shows tagging coverage per dimension.

### Phase 3. Instrumentation

**We do:** provide the SDK and the tag plan, review your implementation, and verify events end to end in your lower environment.

**You do:** install the SDK, emit the event set, wire consent, implement the sign-in link on your backend, and run your own instrumentation QA.

**Exit:** events arrive with identifiers that match the catalogs, consent behaves as specified, and a signed-in shopper is recognized across sessions and devices.

### Phase 4. Placement and rendering

**We do:** configure slots, strategies and defaults, and review your rendering against the failure behavior in 3.4.

**You do:** implement first-paint hydration, render by identifier, implement defaults and timeouts, and add the live channel where a page needs mid-session updates.

**Exit:** the launch page renders personalized content per visitor in your lower environment, and renders correctly with the platform switched off.

### Phase 5. Verification in your environment

One run, in your lower environment, that your team can repeat without us. What it shows:

- Different shoppers verifiably see different content on the launch page, chosen by the agreed registry.
- Your tuning owner changes a weight and the next decision reflects it, with no deployment.
- Every decision on screen can be opened and explained: which interests drove it, with what scores.
- Your defaults render wherever no decision applies, and the page behaves correctly with the platform switched off.

**We do:** build the run and drive it once.

**Done when:** your team has re-run it themselves and both sides agree on what they saw.

### Phase 6. Your integration and test window

Your calendar, your freeze process. We support with fixes, tuning sessions and joint test runs, and we hold a weekly checkpoint.

### Phase 7. Launch readiness and go-live

**Gates, all of which must be closed before traffic:** privacy and data-handling review signed off, security review signed off, production deployment provisioned and verified, primary metric agreed in writing, holdout approved and configured, traffic ramp agreed, alerting destination live and tested, runbook handed over, named tuning owner in place, rollback rehearsed.

**Rollback is one switch:** the weights that drive personalization are configuration, so returning a page to its default behavior does not require a release on your side.

### Phase 8. Operate and expand (after launch)

Tuning passes, the activation of outcome learning once the data volume supports it, then the next page, the next region and the next brand, each of which is provisioning and configuration rather than another integration.

---

# 12. Operating the platform after launch

## 12.1 Who does what

| Role | Owns | Typical rhythm |
|---|---|---|
| **Merchandiser or content operations** | Pins, blocks, eligibility rules, slot defaults, the tagging vocabulary | Daily to weekly |
| **Tuning owner**, a merchandiser or analyst | Weights, decay horizons and thresholds in the registry | Weekly early, then monthly |
| **Analyst or data science** | Reports, the holdout read, the primary metric, the case for changes | Weekly |
| **Front-end engineering** | The SDK version, new slots, new pages | Per release |
| **Platform operations, ours** | Availability, alerts, releases, capacity | Continuous |

## 12.2 Changing things safely

Every configuration change is versioned and takes effect without a deployment, and every version can be rolled back. Changes are attributed to the person who made them. The rule we recommend and support: **one change at a time on a live slot, and give it a week.** Two changes at once cost you the ability to attribute the result to either.

## 12.3 Monitoring and incidents

The platform checks itself every five minutes, per brand, and the checks are not superficial: they include a real decision made with consent refused, to prove that a refusal writes nothing. When a check fails, an alert is delivered to the destination you nominate, with a repeat suppressed for thirty minutes and a recovery notice sent when it clears. Your team can read the last result from the API and from the console.

Support runs through the agreed channel with severities, response targets and an escalation path recorded in the runbook handed over at Phase 7.

## 12.4 Adding a page, a slot or a brand

| Change | What it takes |
|---|---|
| A new slot on an existing page | Slot definition, a default, and the front end addressing it. No release on our side. |
| A new page | The slot map for that page, defaults, and the page identifier in your calls. |
| A new brand | Provisioning: its own catalog, configuration, audiences and credentials. Isolated from the first brand. |
| A new region or locale | Locale on the catalog records, plus any residency requirement confirmed before it is switched on. |

# 13. What we need to decide together

This section is the working agenda. Each item is a decision only your side can make, each one changes what we build or when we can build it, and each one has a default we will proceed with if you have no preference.

## 13.1 Scope and sequence

| # | Question | Why it matters | Our default if you have no preference |
|---|---|---|---|
| 1 | Which pages are in the launch scope, and which slots on them? | Defines the surface we are accepting against. Everything downstream, from tagging coverage to the acceptance run, is scoped by this answer. | The launch brand homepage, with a candidate pool of 20 to 30 assets. |
| 2 | Content Personalization first, or Experience Personalization first? | The order is a choice, not a technical dependency, and either can lead. | Content first. |
| 3 | Does the product grid sort come in at launch, or after? | It is a separate integration point on your commerce platform, with its own test cycle. | After the content launch, in the first expansion. |
| 4 | Which brands follow the launch brand, and in what order? | Determines when provisioning for brand two starts, which is scheduling, not engineering. | Sequenced jointly once launch performance is measured. |

## 13.2 Your systems and your data

| # | Question | Why it matters | Our default |
|---|---|---|---|
| 5 | Where does content come from: a CMS API, a DAM, or an export? Who owns the credentials? | Determines whether we build against an adapter or start on the manual path. Nothing waits on this: manual import unblocks us immediately. | Start with a manual export, move to a feed during Phase 2. |
| 6 | Does every asset already have a stable identifier that survives edit and republish? | Everything is addressed by identifier. Identifiers that change on republish cause decisions to point at nothing, silently. | Assume yes, verify in the data audit in week one. |
| 7 | Is content type modelled in the CMS today, or does it need to be added? | Content type is a scoring dimension. If it is not modelled, that is a CMS change with its own release cycle. | Assessed in the data audit; enrichment proposes values where they are missing, with your approval. |
| 8 | Which product feed, and who is the technical contact? | Products are ranked by the same engine, and identifier parity between feed, commerce platform and events is what lets the three be joined. | Your existing commerce feed, refreshed daily. |
| 9 | Does your commerce search or sort return the full result set, or a server-side page? | Determines the depth of ranking. Where the platform paginates server-side, ranking operates inside the page returned. | Re-rank the candidate set your platform returns. |
| 10 | Is there a dataLayer or tag manager we can read? | The single largest variable in the instrumentation effort. Where one exists, our adapter reads it. Where none exists, tagging is materially larger work on your side. | Confirmed at kickoff, before estimates are believed. |
| 11 | Do you want historical performance data used to seed the model? | Optional. It shortens the cold start on day one. Access negotiations are slow, so the ask starts early or not at all. | Launch without it, add later if your data team wants to. |

## 13.3 Identity, consent and privacy

| # | Question | Why it matters | Our default |
|---|---|---|---|
| 12 | Which consent framework, and how is consent state exposed to the page? | Determines what the engine may do per visitor and per market. | Nothing is written and nothing is personalized until an explicit permission exists. |
| 13 | Do you want signed-in shoppers linked across devices? | Requires one backend endpoint on your side that signs a short-lived assertion. Without it, a shopper on a new device is a new visitor. | Implement the link in Phase 3, because it is small and it is the difference between recognition and re-learning. |
| 14 | Data residency requirements, per market? | Affects deployment configuration and carries lead time. Relevant the moment markets outside North America enter scope. | North America only for launch. |
| 15 | Retention periods per category, agreed with your privacy team? | The platform requires an explicit number per category and refuses to guess. | 90 days for the decision ledger, matching the storage lifecycle rule. |
| 16 | Do you want durable profile memory in your customer data platform? | Optional and strictly additive. The engine is fully functional without it. | Launch without it, connect when your platform team is ready. |

## 13.4 Integration mechanics

| # | Question | Why it matters | Our default |
|---|---|---|---|
| 17 | Who owns the front-end integration, and what capacity is scheduled between the kit landing and your freeze? | This is the critical path to the launch date. It runs through your developers, not ours. | Named in the design phase. |
| 18 | First-party subdomain, or the platform hostname? | A subdomain makes every call first-party, and carries DNS and certificate lead time on your side. | The platform hostname for staging, a first-party subdomain for production. |
| 19 | Who verifies that WebSocket upgrades pass your CDN, proxy and firewall? | The most common late blocker in an integration of this shape, and cheap to test in week one. | A named engineer on your side runs our connection check in Phase 1. |
| 20 | Does any page need mid-session updates, or is first paint enough for launch? | Determines whether the live channel is on the launch critical path or a later addition. | First paint for launch, live channel enabled where a page earns it. |
| 21 | Which conversion or order event can we receive, and what does it carry? | It is one integration point, and it is what measurement and later learning read. | Order identifier, items and value, sent from the order confirmation. |

## 13.5 Security, environments and people

| # | Question | Why it matters | Our default |
|---|---|---|---|
| 22 | What does your security review require, who signs it, and when is it scheduled? | Frequently the longest single item in an enterprise integration, and rarely scheduled early enough. | Scheduled in week one against this document. |
| 23 | Which origins, per environment, exactly as the browser sends them? | Without them the browser cannot connect. It is a five minute answer that blocks a whole environment. | Collected at Phase 1 provisioning. |
| 24 | Who gets console accounts, and with which role? | Determines who can change weights, publish audiences and read reports. | Your front-end lead, tuning owner, and one analyst at launch. |
| 25 | Who is the named tuning owner after launch? | Tuning after launch is the point of the design. Someone on your side has to hold it. | Named before go-live. |
| 26 | Who approves the dimension registry? | The registry is the agreed scoring basis. It needs one approver, not a committee. | Named at kickoff. |

## 13.6 Dates and measurement

| # | Question | Why it matters | Our default |
|---|---|---|---|
| 27 | What is the last date your code can ship before the freeze, and what is the exception process? | This is the real deadline behind any launch date. Nobody can commit to a schedule without it. | Requested in the design phase; the kit lands early enough to protect it. |
| 28 | Where does the demonstration you are expecting take place: our environment against your content, or your lower environment? | Those are different points in the plan, several weeks apart. | Ours in Phase 2, yours in Phase 5. |
| 29 | What is the primary metric, in writing, and who agrees it? | Prevents the result being re-litigated after the fact. | Agreed before launch, with secondary metrics named at the same time. |
| 30 | Is a holdout approved, and at what share? | The only mechanism that can substantiate the programme's value. Traffic that ran without one cannot be re-run. | 5 to 10 percent, configured before the first personalized page is served. |

---

# Appendix A. Field reference

## A.1 A content record

| Field | Required | Type | Notes |
|---|---|---|---|
| `id` | Yes | string | Unique in the catalog, stable forever. What decisions and pins address. |
| `customerContentId` | Yes | string | Your own identifier, echoed on every decision and record |
| `type` | Yes | string | The rendering kind. Doubles as the content-type scoring value unless you tag `contentType`. |
| `title` | Yes | string | Shown to merchandisers in the console |
| `tags` | Yes | object of dimension to list of strings | The scoring attributes. `{}` is valid but means catalog order decides. |
| `slotTypes` | Yes | list of strings | Which slots this asset may fill. Matched exactly against the slot identifier. |
| `renderUrl` | No | string | `https` URL or site-relative path. Echoed, never rewritten. |
| `lifecycle.status` | No | `live`, `draft`, `expired` | Absent means live |
| `window.from`, `window.to` | No | ISO 8601 | `from` must precede `to`; `to` is exclusive |
| `inStock` | No | boolean | `false` removes it from every decision |
| `journeyStageFit` | No | list of `exploring`, `considering`, `deciding` | Works with the slot's stage setting |
| `freshnessDate` | No | ISO 8601 | Where a slot rewards new content |
| `featuredProductIds` | No | list of strings | Lets a purchase credit the content that featured the product |
| `merchandising` | No | `season`, `promotion`, `margin`, each 0 to 1 | Business weighting, dialled per slot |
| `art`, `excerpt`, `subtitle`, `runtime` | No | string | Display helpers |

## A.2 A slot

| Field | Required | Notes |
|---|---|---|
| `slot` | Yes | The identifier your front end addresses. Lower case, digits, dot, dash, underscore. |
| `take` | Yes | How many items, 1 to 50 |
| `weights` | Yes | Dimension to number, 0 to 1. What this slot cares about. |
| `offLimits` | No | True means never personalized, on any arm |
| `pinnedPieceId` | No | One asset fixed here. The slot must take exactly 1. |
| `pinnedPieceIds` | No | An ordered list occupying the first positions, up to 50, with ranking filling the rest |
| `excludedPieceIds` | No | Never show these here, up to 1,000 |
| `allowedTypes` | No | Only these rendering kinds |
| `excludedTags` | No | Never show assets carrying these dimension and value pairs |
| `diversity` | No | `{ dimension, max }`: at most this many sharing one value |
| `fatigue` | No | `{ weight, windowHours, cap }`: penalty for what this shopper has already seen |
| `freshness` | No | `{ weight, halfLifeDays }`: bonus for new assets, decaying |
| `stage` | No | `{ inStage, outOfStage }`: favour assets that suit the shopper's journey stage |
| `merchandising` | No | Per-slot season, promotion and margin influence, with a cap |

## A.3 Event payloads, by type

The `data` object of an event.

| Type | Fields in `data` |
|---|---|
| `page_view` | `path`, and your own page type |
| `product_view`, `add_to_cart`, `wishlist_add` | `productId`, plus the registry's attributes: by default `line`, `category`, `subcategory`, `silhouette`, `occasion` (a list), `price_usd` |
| `purchase` | `orderId`, `value`, `currency`, `items[]` of `{ productId, quantity, price }` |
| `content_impression`, `content_click`, `video_complete` | `contentId`, `slot`, optionally `customerContentId` and `contentType`, and the `decisionId` you were served |
| `content_dwell` | The same, plus `ms` |
| `button_click`, `form_submit`, `email_open` | Whatever your team defines |
| `custom` | `event`, the real name, plus anything |

Envelope fields: `type`, `userId`, `data`, `source` are required. `eventId`, `timestamp`, `sessionId`, `browsingSessionId`, `entry` and `surface` are optional. `entry` carries `utmMedium`, `utmSource`, `referrer` and `siteHost`, captured once per page load and sent with every event so the platform can decide which event opened a new visit.

## A.4 The decision record

Written for every served position, and what your warehouse receives.

| Field | Meaning |
|---|---|
| `decision_id` | `{brand}:{time in base 36}:{visitor}:{page}:{slot}:{position}`. Sortable by time. |
| `tenant`, `brand` | Isolation keys |
| `visitor_id`, `session_id` | First-party identifiers. Replaced by a pseudonymous subject on export. |
| `identity_anchor` | `visitor`, `session` or `none`: how durable the state behind the decision was |
| `ts` | Server time |
| `page`, `slot`, `position` | Where it was served, and the rank inside the slot |
| `item_id`, `customer_item_id` | What was served, in both identifier spaces |
| `candidates[]` | The top candidates considered, with their scores |
| `cell` | The context: `channel`, `visit_bucket`, `region`, leading `affinity` |
| `arm` | `personalized`, `default` or `no_learning` |
| `explored` | True when exploration served it deliberately |
| `authority` | `engine`, `pin` or `default`: who decided |
| `versions` | The revision of each input: configuration, catalog, slots, learning, lift, prior, policy |
| `config_label` | The human-readable configuration revision |
| `featured_product_ids` | Products the served asset features |
| `explain.*` | The drivers, the population prior, the learned term, merchandising, stage, freshness, fatigue and diversity effects, each with the delta it caused and a sentence |
| `inputs` | The interest vector as scored, and the other inputs a replay needs to reproduce the decision exactly |

## A.5 The outcome record

| Field | Meaning |
|---|---|
| `outcome_id` | `{brand}:{time in base 36}:{visitor}:{event}` |
| `decision_id` | The decision this outcome is credited to, when the event carried it |
| `type` | The reward: `click`, `dwell`, `video_complete`, `wishlist`, `add_to_bag`, `purchase` or `custom` |
| `event` | The wire event name, so a custom reward keeps its own name |
| `item_id`, `slot` | What the event named |
| `value`, `currency`, `margin` | For commerce outcomes |
| `products` | Products the event named. A purchase credits content that featured one of them. |
| `visitor_id`, `session_id`, `brand`, `arm`, `ts` | As on the decision |

## A.6 The learned term, and every symbol in it

Present on a decision record once a slot has evidence.

| Symbol | Meaning |
|---|---|
| `reward` | The outcome this slot learns against |
| `n` | Exposures of this item in this context, decayed over the learning horizon |
| `s` | Credited outcomes, decayed the same way |
| `p0` | The slot's baseline per exposure in that context |
| `n0` | How many observations the baseline is worth, when the item's own estimate is pulled toward it |
| `p_hat` | The smoothed estimate for this item |
| `lift` | `p_hat` divided by `p0`, clamped. 1 means no evidence either way. |
| `level` | Which context answered, from everyone up to the full cell: the finest level with enough evidence |
| `gamma` | The trust dial for this slot, 0 to 1: how much the learned term is allowed to move the score |
| `prior` | An imported starting belief, when one applied |

---

# Appendix B. Endpoint reference

Base URL is the platform host for the environment, or your own subdomain routed to it. `{tenant}` is the brand slug.

## B.1 Called by the browser

| Endpoint | Purpose | Credentials |
|---|---|---|
| `POST /v1/{tenant}/identity/session` | Get or renew the shopper's signed session | Site key |
| `POST /v1/{tenant}/decisions/snapshot` | Every slot's decision for a page | Site key and shopper session |
| `POST /realtime/action` | One event | Site key and shopper session |
| `GET /realtime/ws?tenant={tenant}` | The live channel | Shopper session and site key, as subprotocols |
| `POST /sort` | Rank a candidate set | Shopper session |
| `POST /sort/intent` | Filter, then rank a candidate set | Shopper session |
| `POST /v1/{tenant}/identity/link` | Link a signed-in shopper | Site key, shopper session, signed assertion |
| `POST /v1/{tenant}/identity/detach` | Sign out | Site key and shopper session |
| `POST /realtime/session/preferences` | Record a consent choice | Site key and shopper session |

## B.2 Called by your systems

| Endpoint | Purpose |
|---|---|
| `POST /content/catalog/import`, `POST /content/catalog/pull` | Load or refresh the content catalog |
| `GET/PUT /content/{kind}` where kind is `catalog`, `slots`, `learn` or `priors` | Read or replace a configuration document |
| `POST /content/{kind}/validate`, `GET /content/{kind}/history`, `POST /content/{kind}/rollback/{n}` | Validate, audit, roll back |
| `GET/PUT/PATCH /config/reflex` and its history, validate and rollback | The dimension registry |
| `POST /v1/{tenant}/learn/report`, `GET /v1/{tenant}/learn/report`, `GET /v1/{tenant}/learn/report/window` | Reports |
| `GET /v1/{tenant}/lift/rows`, `GET /v1/{tenant}/learn/slots`, `GET /v1/{tenant}/learn/exploring` | Per-item and per-slot evidence |
| `GET /v1/{tenant}/ledger/batches`, `GET /v1/{tenant}/ledger/{id}`, `GET /v1/{tenant}/replay/{id}` | Export listing, one record, and replay |
| `POST /v1/{tenant}/identity/resolve` | Your account identifiers to shopper identifiers, for joins |
| `POST /v1/{tenant}/identity/events` | Import history or typed profile facts |
| `POST /v1/{tenant}/identity/erase` | A data subject request |
| `GET /v1/{tenant}/visitors/{id}/receipts` | What one shopper was served, and why |
| `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout` | Operator sign-in |
| `GET /health/ready`, `GET /health/live`, `GET /v1/{tenant}/monitor` | Readiness, liveness, and the last self-check |

Writes to a configuration document additionally require `If-Match` and `Idempotency-Key`, as described in 7.2.

---

# Appendix C. Slot map template

One row per slot on every template in scope. This is the single most useful artefact your front-end and merchandising teams can produce before kickoff.

| Template | Slot identifier | What it holds | Items | Personalizable | Default when no decision |
|---|---|---|---|---|---|
| Home | `home_hero` | Editorial image and copy, above the fold | 1 | Yes | Current campaign hero |
| Home | `home_carousel_1` | Product or editorial cards | 6 | Yes | Merchandised set |
| Home | `home_legal` | Legal banner, footer | 1 | No, off limits | Fixed |
| PDP | `pdp_hero_image` | On-model or silo image | 1 | Yes | Primary image |
| PLP | `plp_grid` | Product results | Page size | Yes, by sort | Commerce platform order |

Add a Notes column of your own for anything that needs it, for example "first paint, no flash permitted" on the hero, or "de-duplicate against the hero" on the carousel.

**Rules for the identifiers:** stable across releases, unique per template, readable by a person, and never re-used for a different position later.

---

# Appendix D. Tag plan template

One row per event, filled in jointly during Phase 3 and signed off by your QA.

| Event | Fires when | Required fields | Source of each field | Owner | Verified |
|---|---|---|---|---|---|
| Content impression | A registered asset becomes visible in a personalizable slot | Content identifier, slot identifier, page identifier | Decision payload the page just rendered | Front end | Pending |
| Content click | The shopper activates that asset | Content identifier, slot identifier, page identifier | Same as impression | Front end | Pending |
| Content dwell | The asset stays visible past the agreed threshold | Content identifier, slot identifier, milliseconds | Front end timer | Front end | Pending |
| Product view | A product detail page renders | Product identifier, product attributes or a feed lookup | Commerce platform | Front end | Pending |
| Add to cart | The shopper adds an item | Product identifier, quantity, price | Commerce platform | Front end | Pending |
| Order completed | The order confirmation renders, or the server confirms | Order identifier, items, value | Commerce backend preferred | Backend | Pending |
| Sign in | The shopper authenticates | Visitor identifier, account identifier, signed assertion, expiry | Your backend | Backend | Pending |
| Consent change | The shopper changes consent | Both switches, chosen at, expires at | Consent platform | Front end | Pending |

**The one rule that causes most silent failures: identifier parity.** The identifiers in events must be exactly the identifiers in the catalogs. Mismatched identifiers are discarded, affinity never builds, and the system looks like it is working while learning nothing. Verify this on real traffic in your lower environment before Phase 3 exits.

---

# Appendix E. A worked example, end to end

A returning shopper opens the homepage on the launch brand. She visited twice last week, looked at three shoulder bags in one line, and arrived this time from a paid social campaign.

**1. The page loads and asks for its decisions.**

```http
POST /v1/coach/decisions/snapshot
X-SDK-Key: <site key>
X-Shopper-Session: ss1.<capability>
```
```json
{ "page": "home", "channel": "paid_social", "browsingSessionId": "s-LT4B2" }
```

**2. The platform answers with the whole page.**

```json
{
  "ok": true,
  "page": "home",
  "arm": "personalized",
  "cell": {
    "channel": "paid_social",
    "visit_bucket": "2-3",
    "region": "US-NY",
    "affinity": "line:Tabby"
  },
  "decisions": [
    {
      "slot": "hero",
      "order": 1,
      "customerContentId": "CCH-1450",
      "contentId": "cnt_8f3a",
      "type": "campaign",
      "score": 0.46,
      "strategy": "affinity",
      "explain": {
        "drivers": [
          {
            "dim": "line",
            "value": "Tabby",
            "a": 0.73,
            "weight": 0.35
          },
          {
            "dim": "occasion",
            "value": "evening",
            "a": 0.41,
            "weight": 0.3
          }
        ]
      }
    },
    {
      "slot": "story",
      "order": 2,
      "customerContentId": "CCH-2210",
      "contentId": "cnt_1c77",
      "type": "editorial",
      "score": 0.31,
      "strategy": "affinity",
      "explain": {
        "drivers": [
          {
            "dim": "occasion",
            "value": "evening",
            "a": 0.41,
            "weight": 0.3
          }
        ]
      }
    }
  ],
  "write": true
}
```

The `rail` slot is absent from the set, so the page renders its default there. Nothing waits, nothing is empty.

**3. The page renders by your identifiers and reports what painted.**

```js
renderHero('CCH-1450');
client.emit.rendered('hero', 'cnt_8f3a', heroEl, decision.decisionId);
```

**4. She clicks the hero.**

```js
// carries the decisionId captured at render
client.emit.contentClick('cnt_8f3a', 'hero');
```

**5. What is now true.** Her interest in that product line rose and her other interests decayed a little. If the rise crossed the entry threshold she joined that audience, and if your customer data platform is connected, it knows. The click was credited to the decision that produced it, so the item's evidence in this exact context improved. None of this required a model, and all of it is replayable from the record.

**6. She buys.**

```js
client.emit.purchase({
  orderId: 'A1B2',
  value: 395,
  currency: 'USD',
  items: [{ productId: 'SKU-123', quantity: 1, price: 395 }],
});
```

Because the hero asset listed that product in `featuredProductIds`, the purchase also credits the content that featured it. Your analysts see both rows, joined by the decision identifier, in the day's export.

---

# Appendix F. Go-live checklist

Nothing on this list is optional, and each line has an owner.

**Privacy and security**

- Privacy and data-handling review signed off
- Retention periods agreed per category and configured
- Consent behavior confirmed per market
- Security review signed off by the named approver
- Data residency confirmed for every market in scope

**Platform**

- Production deployment provisioned, with its own stores and secrets
- Production origins allow-listed, and verified from your network
- First-party subdomain live, if chosen, with certificate
- Alert destination configured and a test alert delivered
- Self-check passing on every brand in scope
- Retention policy present for every category, with no category unset

**Data**

- Content catalog complete for every slot in scope, with lifecycle fields populated
- Product feed connected, with the refresh cadence agreed
- Tagging coverage reported per dimension, and accepted
- Identifier parity verified on live traffic between catalogs and events

**Integration**

- SDK version pinned, and its upgrade path agreed
- Every slot in scope renders by identifier, with a declared default
- Timeout and failure behavior tested with the platform switched off
- Sign-in link implemented and verified across devices
- Conversion event verified end to end
- Instrumentation QA signed off by your QA team

**Operations and measurement**

- Primary metric agreed in writing, secondary metrics named
- Holdout approved, configured and verified before the first personalized page
- Traffic ramp agreed
- Named tuning owner in place, with console access
- Runbook handed over, including the rollback switch
- Weekly checkpoint scheduled through the first month of live traffic

---

# Appendix G. Glossary

Every term used in this document, in the sense it is used here.

| Term | What it means |
|---|---|
| **Affinity** | A number between 0 and 1 that expresses how strongly a shopper leans towards one value of one dimension, for example "evening" within "occasion". It rises with behavior and falls with time. |
| **Arm** | Which side of the measurement a shopper is on: personalized, or the holdout that receives defaults. |
| **Audience** | A named group a shopper enters and leaves automatically, generated from your catalog vocabulary rather than hand-built. |
| **Brand** | One tenant inside a deployment, with its own catalog, configuration, audiences and credentials. |
| **Candidate pool** | The registered assets eligible for a slot, before any ranking. |
| **Catalog snapshot** | An immutable version of a catalog. Decisions reference the snapshot they were made against, so a decision can be reproduced later. |
| **Cold start** | The first moments of a visit, before behavior exists, where the decision is made from region, entry channel, population trends and any priors you supply. |
| **Consent** | Two independent permissions, one to record behavior and one to personalize, each with a chosen-at and an expiry. |
| **Context, or cell** | The situation a decision was made in: entry channel, visit number, region, journey stage. Outcome statistics are kept per context, not globally. |
| **Decay horizon** | How long an interest takes to fade by a set proportion if the shopper does nothing further, expressed per dimension. Short horizons make the engine react to today, long horizons make it remember. |
| **Decision record** | The stored fact that a decision was served: the slot, the chosen item, the context, the versions of every input, and the explain record. |
| **Deployment** | One installation of the platform with its own stores, secrets and hostname. Your staging and your production are separate deployments. |
| **Dimension** | One axis of taste the engine scores on, for example product line, silhouette, occasion, price band, content type, region, visit number, entry channel. |
| **Dimension registry** | The agreed list of dimensions with their weights and settings. It is the agreed basis for what the engine scores. |
| **Entry and exit thresholds** | The score at which a shopper joins an audience, and the lower score at which they leave. Keeping them apart stops a shopper flickering in and out on one borderline action. |
| **Explain record** | The reasons behind one decision: which dimensions drove it, with what scores and weights, in what context. |
| **First-paint snapshot** | The single call a page makes as it loads to get every slot's decision at once. |
| **Gate** | A rule about the item, never about the shopper, that decides whether an item may appear at all: in stock, in market, in its lifecycle window, rights cleared. |
| **Half-saturation point** | How much repeated behavior it takes for an interest to reach half its maximum. It is what stops one loud shopper's tenth click counting as much as their first. |
| **Holdout** | The share of traffic deliberately excluded from personalization so the difference can be measured. |
| **Identifier parity** | The property that the identifiers in your events are exactly the identifiers in your catalogs. |
| **Ledger** | The append-only record of decisions served and outcomes observed, which reporting and export read from. |
| **Live channel** | The persistent connection that lets the platform push an updated decision mid-session without the page asking again. |
| **Off limits** | A slot that is never personalized, declared by you. |
| **Operator** | A person with a console account on your side or ours. |
| **Piece, or asset** | One registered item of content. |
| **Pin and block** | A merchandiser instruction that an item must appear, or must not, outranking the engine. |
| **Priors** | Starting beliefs supplied by your analysts, used before behavior exists. |
| **Regional trending** | What a population in a region is engaging with right now, held as counts with no per-shopper location history. |
| **Service credential** | A revocable machine credential for a system that calls our APIs. |
| **Session** | One continuous visit. Behavior within it is immediate; behavior across sessions is memory. |
| **Shopper identifier** | The one-way, salted hash of your account identifier that names a recognized person in our stores. |
| **Site key** | The credential that authorizes calls from your pages for one brand. |
| **Slot** | The addressable space on a page that a decision fills. Slots have stable identifiers and declared defaults. |
| **Strategy** | The dimensions, weighted, that a given slot is scored by. |
| **Visitor identifier** | The first-party identifier for a browser, before or without sign-in. |
| **Weight** | How much one dimension counts in the final score, relative to the others. Set to zero, a dimension has no effect at all. |

# Appendix H. This engagement

The body of this guide is the method. This annex is what is specific to this programme, and it is the part that changes as we agree things.

## H.1 Scope as it stands

| Item | Position |
|---|---|
| Launch brand | Coach |
| Launch surface | The homepage is proposed. The template list is confirmed at kickoff. |
| Capabilities in sequence | Content Personalization first, then Experience Personalization |
| Candidate pool at launch | 20 to 30 assets on the launch page |
| Dimension registry | 6 to 8 dimensions, agreed at kickoff, with location included from the start |
| Portfolio | The pattern carries to the next brand as provisioning, sequenced jointly once launch performance is measured |

## H.2 What we need, and who owns it

One name and one date per row. This table is the output of the first session.

| # | What you provide | Your owner | Date agreed |
|---|---|---|---|
| 1 | Working-session participants: data science, front-end lead, content operations | | |
| 2 | Content sample, 100 to 500 assets | | |
| 3 | Slot map and the default for every slot | | |
| 4 | Data layer or tag manager position, confirmed | | |
| 5 | Code freeze dates and the exception process | | |
| 6 | Security review scope, timeline and approver | | |
| 7 | Content feed access or export path | | |
| 8 | Product feed and a technical contact | | |
| 9 | Lifecycle and rights fields on content | | |
| 10 | Lower-environment origins, and the network path verified | | |
| 11 | Retention periods per category | | |
| 12 | Consent framework and the withheld-consent behavior | | |
| 13 | Conversion or order event | | |
| 14 | Front-end capacity before your freeze | | |
| 15 | Instrumentation QA | | |
| 16 | Historical performance data, if wanted | | |
| 17 | Primary metric and holdout share | | |
| 18 | Privacy and data-handling review | | |
| 19 | Named tuning owner | | |
| 20 | Production origins and release slot | | |

## H.3 Sequence for this implementation

The phases in section 11, with the owner on each side. Dates are set jointly once the freeze dates in row 5 are known.

| Phase | Ours | Yours |
|---|---|---|
| 0 · Design | Solution architect | Data science, content operations, front-end lead |
| 1 · Environment | Delivery engineer | Network and security |
| 2 · Data onboarding | Delivery engineer | Content operations, commerce |
| 3 · Instrumentation | Solution architect | Front-end, backend, QA |
| 4 · Placement | Solution architect | Front-end, merchandising |
| 5 · Verification | Delivery engineer | Front-end, QA, tuning owner |
| 6 · Your test window | Support | Your release process |
| 7 · Launch readiness | Delivery engineer and support | Security, privacy, release |
| 8 · Operate | Support and data science partner | Tuning owner, analyst |

## H.4 The roles to fill

Registry approver. Content operations owner. Front-end lead for the payload shape. Backend owner for the sign-in assertion. Security approver. Privacy owner for retention and consent. QA owner. Tuning owner after launch.

## H.5 Open items for this session

1. The last date your code can ship before your freeze, and the exception process.
2. Which pages and templates are in the launch scope.
3. Where the demonstration you are expecting takes place: our environment in Phase 2, or yours in Phase 5.
4. Whether the product grid sort is in the launch or the first expansion, and which integration pattern your commerce platform uses.
5. Data residency, per market, and the retention numbers per category.
6. The primary metric, and holdout approval with its share.
7. Whether durable profile memory in your customer data platform is in scope for launch.
8. Your consent framework, and the behavior you require when consent is withheld.
9. First-party subdomain or platform hostname, per environment.
10. Whether anything has to be added to the content management system: at minimum a stable identifier and a content type per asset.
