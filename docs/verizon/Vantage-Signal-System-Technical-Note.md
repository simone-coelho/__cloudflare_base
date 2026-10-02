# The signal system

This note is for Verizon's engineers: "you" means Verizon, "we" means Optimizely, and Vantage is the demo's example carrier. Its one-page summary is *Why the unit of state is the dimension value, not the click*. The interactive page *How it works* puts the constants on sliders: [https://edge-platform-vantage.expedge.workers.dev/vantage/how-it-works](https://edge-platform-vantage.expedge.workers.dev/vantage/how-it-works).

Numbers marked ∗ were measured on the hosted demo with a scripted visitor; the rest are published constants, catalog or census figures, or arithmetic from them. None is a timing or a lift.

## 1. The one idea

On screen the demo can read as "view a Samsung, show Samsung". Underneath, no state is keyed to the Samsung she viewed.

**The example.** One view of a Galaxy S26 card adds 1 to the raw score of four values at once: phones, samsung, android, and core, the price band its $899.99 falls in. Each now reads as an interest of 0.357 (§3.1), and every candidate is scored against them: an offer tagged samsung and android gains on both, a Pixel offer tagged android on one. No rule names the Galaxy S26.

**The idea.**

- **The unit of state is the dimension value.** A dimension is an axis such as brand, with values such as samsung; her state is one graded coordinate per value she has touched, not a list of products.
- **Products carry attributes in the same dimensions,** and offers, heroes, modules and plans carry tags in the same vocabulary, so a piece never shown is placed on its tags from its first minute.
- **Nothing is configured per product.** The slot, one decided container such as the homepage's four deals, holds the weights, cap, pins and other slot-control rules; each piece's record holds its window and eligibility rule.
- **The shopper is a small vector of graded, fading interests,** each from 0 toward 1, rising by each action's published weight and fading on a horizon set per dimension. Its size is bounded by the vocabulary, eight dimensions and 32 values in Vantage, never by the catalog.
- **A decision scores every eligible candidate against the vector and explains itself.** One weighted sum per candidate, a cap of two per brand, the top four: that is how three actions pick four deals from 17 candidates or 10,000 (§3.2), every term on the receipt (§7).

**Why we went this way.** Systems that track individual events usually keep the events and derive interest per item; we wanted a graded, fading state across several dimensions at once. One Samsung view should move every Android offer a little; the brand of the moment should fade while the ecosystem lean holds; every number should trace to a published constant. No model is called at decision time.

## 2. One shopper, worked through

A stranger in North Carolina taps a paid-social ad for the iPhone 18 Pro, on a laptop.

**Before any action** the engine knows the region the edge located (US-NC), the campaign on the landing URL (`utm_term=iphone-18-pro`) and her OS family, if the request carries one. A laptop yields neither ios nor android, so that seed stays silent; on an iPhone it would add 0.15 to every deal tagged ios (§3.4).

- **The state's own sales.** With no behaviour yet, each coordinate is North Carolina's share, at a blend weight λ = 1 (§3.3). In the demo the sales are synthetic and labelled so, modelled from census income; in production the seed would be your own sales. The panel shows the state's median household income, $73,958 (ACS 2024), to explain the lean; census is never scored.
- **The campaign.** The seed's weight 0.2, times the slot's campaign weight 0.3, times the launch offer's promotion multiplier 1.1, adds 0.066. The hero gains 0.060.

| The four deals | First | Second | Third | Fourth |
|---|---|---|---|---|
| Arrival, North Carolina: a first visitor, no override | iPhone 18 Pro launch 0.651∗ | iPhone Duo 0.532∗ | Galaxy Z Fold8 0.497∗ | Galaxy S26 0.485∗ |
| Arrival, New York asserted, a second visitor (§7) | launch 0.671∗ | Duo 0.550∗ | Fold8 0.388∗ | S26 0.338∗ |
| The hinge, four touches later: New York asserted, a second visitor | S26 0.353∗ | Fold8 0.336∗ | Pixel 11 0.302∗ | launch 0.245∗ |

**One view.** From here the figures are the second visitor's, minted by the same hosted rehearsal run with New York asserted through the demo's labelled override. Her own coordinates do not depend on the region; the region enters her scores through its sales shares, which λ weights, and through coverage rules such as the home bundle's (§6).

| Dimension | Value | R | a = R/(R + 1.8) |
|---|---|---|---|
| category | phones | 0 → 1 | 0.357 |
| brand | samsung | 0 → 1 | 0.357 |
| ecosystem | android | 0 → 1 | 0.357 |
| priceBand | core, as $899.99 is under $900 | 0 → 1 | 0.357 |

The event's `os` and `view` fields are not registry sources. Her interests now sum to 1.43, so λ falls to 0.5/(0.5 + 1.43) = 0.26: her own interest now weighs 0.74 in every blended coordinate, and a value she has not touched still comes wholly from the region, so apple reads 0.26 × 1 = 0.26.

**The third touch.** The card, the S26's page and the S26 Ultra card leave brand samsung at 0.352∗, 0.513∗ and 0.612∗: just under 1/2.8, 2/3.8 and 3/4.8, because brand fades on a 60-second horizon in the room. At 0.612∗ she is over the entry line, 0.60, and holds the membership.

**The hinge.** A Pixel view, then home: the table's third row. The launch offer is fourth, its +0.066 still applied: it rested on New York's shares, which gave way to her own interests, and she has touched nothing Apple or iOS. "Campaign context superseded by observed behaviour" is the page's sentence, written from the record; in the engine it is arithmetic.

**The minute.** Nobody touches anything; the page asks again 52 s after her last Samsung touch. Brand samsung has fallen from 0.601∗ at the hinge to 0.398∗, under the exit line at 0.45, while ecosystem android holds at 0.690∗. Ranking reads the decayed score at once; the membership flag updates at her next event. The four kept their order, as the Galaxy offers rest on Android too; we never promise a reorder at an exit. Room memory is compressed so the exit lands while someone is talking; production horizons are days (§4).

**The phone page.** The buy box is not a slot: the engine is never asked about colour, storage price, term, financing or trade-in maths. Below it, `pdp-modules` orders six of seven modules and `plan-pairing` the plans:

| She | What rises | Scores |
|---|---|---|
| Opens the Galaxy S26 | Storage & memory and protection | 0.085∗ each; 0.200∗ for a visitor with no behaviour, at λ = 1 |
| Steps to 512 GB, compares the camera | Storage & memory first, protection second | 0.294∗, 0.163∗ |
| Opens the hotspot & travel starter | Pair with a plan, to second; Unlimited More leads it | 0.229∗; 0.115∗ |
| Adds lines and a kids' watch | Connected devices, to first; Unlimited Go leads the plans | 0.404∗; 0.146∗ |

Storage is not a dimension: the configured price, $1,099.99, rides the event and lands in premium. After the lines, the homepage follows her: the family hero leads, at 0.205∗.

## 3. The arithmetic

### 3.1 Interest

**Example.** In §2 one view took four values from R = 0 to R = 1, an interest of 0.357; three touches crossed the entry line, and a quiet minute crossed back.

**In words.** Each value holds a raw score R and its last touch, stored undecayed. An event decays R to now and adds the action's weight; a read decays lazily and saturates, interest being R over R plus K. Entry is at 0.60 and exit only below 0.45, so a value cannot flap at a line. Decay only lowers R, so time alone can end a membership, never start one, and the exit has a closed form.

```
event:  R ← R · e^(−Δt/τ) + w,     t_last ← now
read:   a = R(t) / (R(t) + K),     R(t) = R · e^(−(t − t_last)/τ)
enter:  a ≥ θ_in  = 0.60    ⇔   R ≥ 2.7          K = 1.8
leave:  a < θ_out = 0.45    ⇔   R < 1.4727
exit:   t_exit = t_last + τ · ln( R(1 − θ_out) / (K · θ_out) )
               = t_last + τ · ln( R / 1.4727 )
```

τ is the dimension's horizon and w the action's weight. Three touches exit 0.7115 τ after the last one (§4).

**Weights,** as published:

| Action | Weight |
|---|---|
| Content impression | 0 |
| Content dwell | 0.5 |
| Product or page view, content click | 1 |
| Search | 1.5 |
| Select, filter, compare, wishlist, completed video | 2 |
| Add to cart, start order | 3 |
| Purchase, checkout, order complete | 5 |

Page view, search, select, filter, compare and start order are Vantage's additions to the engine's own table, and an action the registry does not name weighs 0. One add to cart alone, at 0.625, crosses the entry line.

**One event, several coordinates.** An event touches every registry dimension whose source field it carries: a band buckets a number by its cuts, and a multi-valued dimension touches each entry. With no product catalog held, the event's own attributes count when the catalog's tags name them. Each crossing is recorded with its score, lines, trigger and version, as a membership such as `brand_samsung_affinity`.

### 3.2 Scoring

**Example.** The Fold8 offer, third for a New York stranger (A.5). At λ = 1 each interest is New York's share, so android 0.667∗ × 0.15 + phones 1 × 0.1 + premium 1 × 0.1 + samsung 0.438∗ × 0.2 = 0.388. The iPhone 17 offer tied the Duo at 0.55∗ and yielded to the cap of two per brand.

**In words.** For each dimension, sum her blended interests over the values the piece is tagged with and multiply by the slot's weight ω, from 0 to 1; then add the dimensions. Two values on one dimension both count, with no per-tag weight or normalisation.

```
B0 = Σ_d ω[S,d] · m_d(p),      m_d(p) = Σ_{v ∈ tags_d(p)} ã_d(v)
```

Then, in order:

1. **Seeds** add weight × dampen × ω per fired tag (§3.4).
2. **Stage** adds a bonus inside a stage fit and multiplies by a factor outside it; only Vantage's hero uses it.
3. **Freshness and fatigue** are built and unused by Vantage.
4. **Merchandising** multiplies a positive score by the clamped product of (1 + weight × signal): ×1.1 for the launch offer.
5. **Learning** multiplies by lift^γ, with γ = 0 (§3.5).

Then sort by score, catalog order and id; a piece over the diversity cap yields and refills only an empty position; take. If every score is zero, the slot serves catalog order, labelled the default. Eligibility, exclusions and pins act first (§6).

**The count, not the time.** Per candidate: a lookup and multiply-add per tag value on a weighted dimension (two to seven for a promotion on Vantage's deals slot), a check per seed tag, up to three merchandising factors and one power. For 10,000 candidates at seven values, that is about 70,000 multiply-adds and a sort of about 133,000 comparisons; the blend runs once per shopper. A deployed Worker's clock advances only with I/O, so this cannot be timed from inside it, and it has not been timed another way.

### 3.3 The regional prior

**Example.** New York's brand shares are apple 1, samsung 0.438∗, google 0.167∗ and motorola 0.063∗: raw scores over the leader's, not probabilities. A stranger has λ = 1, so her samsung coordinate is New York's 0.438∗.

**In words.** Every scored event's touches also feed a count for the region the edge located, never an asserted one, on a 24-hour horizon; the finest level with 30 events answers, from region to country to everyone. The region's weight is a half over a half plus all her interests summed.

```
share(v) = R_region(v) / max R_region       within one dimension
λ = kBlend / (kBlend + Σa),                  kBlend = 0.5
ã = (1 − λ) · a + λ · share
```

| Her total interest Σa | λ, the region's weight |
|---|---|
| 0, a stranger | 1 |
| 0.5 | 0.5 |
| 1.43, after one view | 0.26 |
| 3 | 0.14 |

- **What it may blend:** brand, ecosystem, price band and category. Without the list, one walkthrough's lines, intent, perk and content-type touches reached full share for the next stranger.
- **The counts** are synthetic in the demo, labelled so (New York 425 sales, Texas 490, the others modelled from census income), and live touches add to them; in production, your own sales.
- **An asserted region** selects the prior only on the demo profile, with tracking consent, and the record says `asserted: true`.

### 3.4 Seeds

**Example.** §2's +0.066 on the launch offer is 0.2 × 1 × 0.3 × 1.1: rule weight, dampen factor, the slot's campaign weight, promotion.

**In words.** A seed fires on an arrival signal (entry channel, campaign term, referrer network or platform) and adds its weight, times any dampening, times the slot's weight on the tag's dimension, before merchandising.

```
contribution = weight · Π dampen · ω[S, d(tag)]      before merchandising
```

- **Campaign** matches `utm_term`, ignoring case; it is not persisted, so the page resends the landing entry, and no event builds it.
- **Platform** reads the OS family from `Sec-CH-UA-Platform`, else the user agent; a desktop never fires it.
- **Dampening** reads only her own memberships: the iOS rule halves while she holds intent switch and drops to zero once she holds android, and the Android rule mirrors it. Every dampen is on the receipt.
- **A seed never switches off;** it is outscored.

### 3.5 Learning what works

**Example.** A piece never shown in a cell has n = s = 0, so p̂ = p0 and its multiplier is exactly 1: no penalty and no bonus. The Black Friday offer, never clicked, reached the first container at 0.836∗ on its tags alone.

**In words.** A cell is the context a result is counted in: channel, visit, the edge's region, the leading affinity and the stage. Cells pool on a six-level ladder, the finest with 30 exposures answering, and a slot's rate shrinks toward its parent's; counts fade over 21 days. The estimate adds thirty phantom exposures at the slot's rate p0. The lift, p̂ over p0, is clamped between half and double, and the trust dial γ sets how much of it the score takes.

```
p̂ = (s + n0 · p0) / (n + n0),        n0 = nMin = 30
lift = clamp(p̂ / p0, 0.5, 2),        1 when p0 = 0
score_final = score · lift^γ,         0 ≤ γ ≤ 1 per slot
```

- **It records from day one and moves nothing until the dial moves.** The ledger keeps one record per served position and every outcome; credit goes to the decision that held the container, last in the session, within 30 minutes for a click and 7 days for a purchase. Vantage publishes γ = 0 on every slot.
- **No lift claim.** The day report labels itself attribution, with inference unavailable. The holdout arms, `default` (the site's defaults) and `no_learning` (γ = 0), are sticky-hashed; the demo shows them at share 0 and does not run them.
- **Exploration is off,** and Thompson sampling is refused at publish.
- **Position-bias correction is a build item:** no position-discount term exists yet, and an exposure counts when served (`served-v1`).

## 4. Memory

**Example.** In the room, three brand touches fall below the exit line 42.7 seconds after the last one; on the 90-day horizon the design names for ecosystem and lines, they would last 64 days.

| Dimension | Room horizon | R = 3 exits after | Production, in the design | R = 3 exits after |
|---|---|---|---|---|
| brand, contentType | 60 s | 42.7 s | not yet named | — |
| priceBand | 10 min | 7.1 min | 60 d | 42.7 d |
| intent | 10 min | 7.1 min | 14 d | 9.96 d |
| perk | 10 min | 7.1 min | not yet named | — |
| ecosystem, lines | 14 d | 9.96 d | 90 d | 64.0 d |
| category | 14 d | 9.96 d | not yet named | — |

The demo labels it "memory compressed for this room; production runs days". Production follows the buying cycle, phones being financed over 36 months; the validator caps a horizon at 90 days, and nothing has been measured at production horizons.

- **Her vector** is held at the edge with her session, each dimension fading at its own speed.
- **Population memory** is aggregate: the regional counts over 24 hours, the learning counts over 21 days.
- **Identity.** Random visitor and session ids travel in an HMAC-SHA-256-signed capability valid for at most 24 hours. No fingerprinting: the only device read is the OS family.
- **The link at sign-in.** The site's backend signs HMAC(tenant, visitorId, accountId, exp), valid for at most 24 hours; the engine verifies it, sums both profiles' decayed scores and unions their memberships. Nothing is overridden, and recent behaviour leads because it has faded least. Handing the session onward at sign-in is designed, not built.
- **Thirty days.** A session ends at the earlier of 30 days and the tenant's retention.
- **Erasure is bounded:** local steps, resumable by hand, which the code says are not proof of physical or external erasure.

## 5. The knobs, and why they exist

**Example.** The receipt's first driver (§7) reads brand apple, a = 1, weight 0.2: the 0.2 is the deals slot's brand weight (A.3), the 1 New York's share under the learn document's prior (A.4). A new weight, once published, is on every receipt within 30 s.

**In words.** Every publish is versioned, takes effect without a deployment, keeps its history and can be rolled back, and every receipt names the revisions in force. We expose the knobs because the receipt can then prove every number back to one.

| Knob | Document | What it means |
|---|---|---|
| `dimensions` | registry | The axes, the field each reads, the band cuts |
| `tauMs` | registry | How fast interest fades, per dimension |
| `K`, `thetaIn`, `thetaOut` | registry | Where interest reads one half; the entry and exit lines |
| `weights` | registry | What each action adds to R |
| `epsilon`, `maxValuesPerDim` | registry | Prune floor; values kept per dimension |
| `eventAttributes` | registry | Lets event attributes count without a catalog |
| `journey` | registry | The journey-stage thresholds |
| `take`, `weights` | slots | Pieces returned; ω per dimension |
| `stage`, `seeds` | slots | Stage bonus and factor; arrival rules |
| `merchandising`, `diversity` | slots | Promotion weight and clamp; cap per value |
| `pinnedPieceIds` | slots | The required prefix |
| `holdout`, `regional` | learn | Holdout share, salt, arms; the prior and its dimensions |
| `policy`, `stats` | learn | Attribution scope and windows; phantom exposures, horizon, clamp |
| `gamma`, `reward`, `exploration` | learn, per slot | Trust dial; outcome learned from; exploration |

## 6. Rules outrank the engine

**Example.** The home-internet bundle is eligible only where the service exists: second of six modules with New York asserted (0.349∗), absent in Montana, where no score can bring it back.

**The declared precedence.**

1. **Eligibility.** A piece must be live, inside its window [from, to), not `inStock: false`, with its `eligibleWhen` holding. Regions match exactly or by country and fail closed without one; context must equal a listed value. Asserted context (`ctx.*`, at most eight values) gates these checks, an asserted region beating the edge's; its only other use is on the demo profile, where an asserted region selects the regional prior (§3.3). The receipt marks the page's asserted region and intent, and no asserted value is written to her memory.
2. **Exclusions** remove pieces, tags or types before ranking; Vantage publishes none.
3. **Pins** are a required prefix, served first at score 0 and marked tenant-pinned; the receipt says ranking never ran for that piece.
4. **Ranking** (§3.2), then the diversity cap, then take.

**When a pinned piece is ineligible,** the whole slot serves nothing and records a pin diagnostic, rather than dropping the pin and ranking the rest. The demo's pinned iPhone Duo is gated to device-purchase intents, so the walk asserts a new line first; a bring-your-own shopper would get an empty deals slot.

## 7. The receipt

A real record from the hosted worker, 1 October 2026 at 22:29:44 UTC: a new session with consent, then the home snapshot with the ad's landing entry, New York and intent new asserted, no OS family. Below are its first five drivers and the prior's block; A.1 has the full record, redacted, with every field explained, and A.5 two more explains.

```json
{"explain": {
  "drivers": [
    {"dim": "brand", "value": "apple", "a": 1, "weight": 0.2},
    {"dim": "ecosystem", "value": "ios", "a": 1, "weight": 0.15},
    {"dim": "category", "value": "phones", "a": 1, "weight": 0.1},
    {"dim": "priceBand", "value": "premium", "a": 1, "weight": 0.1},
    {"dim": "regional", "value": "US-NY", "a": 1, "weight": 0.55}],
  "score_base": 0.61,
  "regional": {"region": "US-NY", "level": "region", "lambda": 1,
               "version": 1790865492056, "events": 425,
               "asserted": true, "contribution": 0.55},
  "lift": null, "score_final": 0.671}}
```

**The arithmetic.** 0.2 + 0.15 + 0.1 + 0.1 = 0.55, all regional at λ = 1. The seed's 0.06 makes the `score_base` 0.61, and the promotion's 1.1 makes the `score_final` 0.671; A.1 itemises both. Without the ad it would be 0.55 × 1.1 = 0.605.

**A stranger's drivers are the region's shares.** Every `a` here is New York's: apple at 1 says Apple leads New York's counts, nothing about her, and the regional block says so (λ 1, contribution 0.55, the whole tag sum). As she acts, λ falls and the same fields fill with her own interests. The learning cell keeps the edge's region, US-NC, and an asserted region never feeds a region's counts: the assertion changes which prior is read and writes nothing under New York.

## 8. What Optimizely needs from Verizon's catalog

**Example.** For a 512 GB Galaxy S26, one event with the product id, category, brand, ecosystem and configured price ($1,099.99, premium at the $900 cut) is all the engine needs.

**What lives where.** Per product: attributes. Per piece, in its own record: tags, lifecycle and window, stock flag, eligibility rule (regions, context values), merchandising signals, stage fit. Per slot: weights, take, stage rule, seeds, promotion weight, diversity and the slot-control rules (off-limits, exclusions, allowed types, pins); with the learn document's dials, these are configuration, not catalog.

### Attributes on every product event

- **What we need:** the product id on every product event, with brand, ecosystem, category and full retail price unless we hold your product catalog.
- **What we use it for:** her vector; a held product's attributes win, else the event's own. A custom event names its action in `data.action`, `data.eventName` or `data.event`.

### One vocabulary of exact values

- **What we need:** each dimension's values, as exact strings shared by events and catalog tags.
- **What we use it for:** matching. An event value no tag names is not admitted. Vantage's vocabulary:

| Dimension | Values |
|---|---|
| category | phones, plans, home-internet, accessories, watches-tablets |
| brand | apple, samsung, google, motorola |
| ecosystem | ios, android |
| priceBand | entry, core, premium |
| intent | new, switch, upgrade, add-line, byod, home |
| perk | streaming, music-games, hotspot-travel, international, family |
| lines | solo, duo, family |
| contentType | deal, compare, explainer, tool |

### A piece record for everything a slot decides

- **What we need:** `id`, `customerContentId`, `type`, `title`, `tags` and `slotTypes` for every offer, hero, module and plan; where they apply, `window`, `eligibleWhen` (up to 64 regions and 8 context signals), `merchandising`, `journeyStageFit`, `featuredProductIds` and `inStock`.
- **What we use it for:** eligibility, the score, the receipt and credit. Offer copy (the grammar, badge and call to action) stays with the page.

### The price-band cuts

- **What we need:** where full retail price is cut into bands.
- **What we use it for:** the price-band coordinate. Vantage cuts at $400 and $900, and moving a cut is a registry publish, not a catalog change.

### Outcomes that name what was shown

- **What we need:** click, add-to-bag and purchase events carrying the decision id or the product ids.
- **What we use it for:** crediting the decision that held the container, for learning and the day report.

**From a grid field to an engine field:**

| Grid field | In the engine | Effect |
|---|---|---|
| Brand | `brand` on events and in tags | Scored |
| OS | `ecosystem`; an event's `os` is ignored | Scored |
| Storage | The configured price rides the event | Through the band |
| Full retail price | `price_usd`, cut into `priceBand` at 400 and 900 | Scored, as a band |
| Offer type | `badge`, display only | None |
| Eligible intents, line requirement | `eligibleWhen.context.intent`, failing closed, plus `tags.intent` | Gated and scored |
| Plan requirement | `grammar.plan`, display only | None |
| Priority flag | `merchandising.promotion` with the slot's promotion weight, or a pin | Multiplier or prefix |
| Flash end date | `window.to` | Eligibility |
| Not combinable | `grammar.combinable`, display only; no stacking logic exists | None |
| Coverage | `eligibleWhen.regions` | Eligibility |
| Maximum flag, monthly price | Buy-box content | Never decided |

## 9. Glossary

| Term | Meaning |
|---|---|
| Attribute | A data point on a visitor, a product or a piece |
| Dimension | An axis the engine scores on, grouping one attribute's values |
| Affinity | Her interest in one value, from 0 toward 1; it rises with behaviour and fades with time |
| Slot | The unit the engine decides: one container, asked for by name |
| Piece | One item a slot can return, with a content id |
| Context | The situation of a decision: channel, visit, region, leading affinity, stage. Asserted facts gate eligibility, are marked asserted and never enter her memory; on the demo profile an asserted region also selects the prior |
| Receipt | The record of why: every term and its contribution |
| Prior | The region's lean, blended in with weight λ until her evidence takes over |
| Seed | An arrival rule: when its signal fires, each tagged piece gains weight × dampen × the slot's weight on the tag's dimension |
| Cell | The context in which learning counts exposures and outcomes |
| Trust dial | γ: how much of the learned lift a slot's scores take, from 0 to 1 |

# Appendix. The receipt and the published documents

A.1 is the receipt from §7 in full, with every field explained. A.2 to A.4 are the three published documents as served by the hosted worker on 1 October 2026, the same text the demo's seed script publishes, at the revisions that receipt names; A.5 holds two more explains. All are reflowed for print, and the holdout salt is redacted.

## A.1 The receipt, field by field

The record from §7 in full. The visitor id and nonce are redacted; the route itself omits the session and the replay inputs.

```json
{
  "decision_id":
    "vantage:muq3x3y9:<visitor>:home:deals:0:n1:<nonce>",
  "ts": 1790893784385, "page": "home", "slot": "deals",
  "position": 0, "ranking_position": 0,
  "item_id": "promo_iphone_18_pro_launch",
  "customer_item_id": "promo-iphone-18-pro-launch",
  "arm": "personalized", "authority": "engine", "explored": false,
  "cell": {"channel": "paid_social", "visit_bucket": "unknown",
           "region": "US-NC", "affinity": null, "stage": "early"},
  "journey": {"stage": "exploring",
              "version": "reflex-vantage-v2-room-memory+r3"},
  "versions": {"config": 3, "catalog": 61, "slots": 51, "learn": 3,
               "lift": 0, "prior": 0, "policy": 3},
  "config_label": "reflex-vantage-v2-room-memory+r3",
  "candidates": [
    {"contentId": "promo_iphone_18_pro_launch", "score": 0.671},
    {"contentId": "promo_iphone_duo_preorder", "score": 0.55},
    {"contentId": "promo_iphone_17_new_line", "score": 0.55},
    {"contentId": "promo_galaxy_z_fold8_trade_in", "score": 0.388},
    {"contentId": "promo_galaxy_s26_new_line", "score": 0.338},
    {"contentId": "promo_pixel_11_launch", "score": 0.284},
    {"contentId": "promo_razr_new_line", "score": 0.263},
    {"contentId": "promo_edge_flash", "score": 0.263},
    {"contentId": "promo_moto_g_new_line", "score": 0.223},
    {"contentId": "promo_5g_home", "score": 0.006}
  ],
  "explain": {
    "drivers": [
      {"dim": "brand", "value": "apple", "a": 1, "weight": 0.2},
      {"dim": "ecosystem", "value": "ios", "a": 1, "weight": 0.15},
      {"dim": "category", "value": "phones", "a": 1, "weight": 0.1},
      {"dim": "priceBand", "value": "premium", "a": 1, "weight": 0.1},
      {"dim": "regional", "value": "US-NY", "a": 1, "weight": 0.55},
      {"dim": "merchandising", "value": "promotion", "a": 1,
       "weight": 0.1}
    ],
    "score_base": 0.61,
    "regional": {"region": "US-NY", "level": "region", "lambda": 1,
                 "version": 1790865492056, "events": 425,
                 "asserted": true, "contribution": 0.55},
    "lift": null,
    "score_final": 0.671,
    "contextual": {"applied": 0.066, "drivers": [
      {"signal": "campaign_term", "value": "iphone-18-pro",
       "dimension": "campaign", "tag": "iphone-18-pro",
       "weight": 0.2, "contribution": 0.066}]},
    "merchandising": {"boost": 1.1, "clamped": false,
      "drivers": [{"term": "promotion", "value": 1, "weight": 0.1,
                   "boost": 1.1, "contribution": 0.061}],
      "sentence":
        "promotion 1.00 at weight 0.10 gives 1.10x; 0.6100 to 0.6710"}
  },
  "measurementBasis": "served-v1",
  "featured_product_ids": ["iphone-18-pro", "iphone-18-pro-max"],
  "asserted": {
    "ctx.region": {"value": "US-NY", "from": "record"},
    "ctx.intent": {"value": "new", "from": "request"}}
}
```

| Field | What it says |
|---|---|
| `decision_id` | Tenant, time, visitor, page, slot, position, nonce; owner-checked before any read |
| `ts`, `page`, `slot`, `position` | When, in epoch milliseconds, and where |
| `ranking_position`, `authority` | The rank after any pins; engine, pin or default |
| `item_id`, `customer_item_id` | Our id and the customer content id |
| `arm`, `explored` | The holdout arm; whether exploration chose it |
| `cell`, `journey` | The learning cell (the edge's region); the stage word |
| `versions`, `config_label` | Revisions in force; `lift: 0` means no lift snapshot |
| `candidates` | The top ten, before the diversity cap |
| `drivers` | The top four terms by a × ω, then regional and merchandising |
| `score_base`, `score_final` | Before merchandising; after merchandising and lift |
| `regional` | The level, λ, the counts' version and events, `asserted`, Σ λ·share·ω |
| `lift` | Null: no lift is in force for this piece yet; once one is, the record carries it with `applied`, which is 0 while γ = 0 |
| `contextual` | Each seed as it landed, after merchandising |
| `merchandising` | The multiplier, its clamp, per-term deltas summing to final minus base |
| `measurementBasis` | `served-v1`: counted when served |
| `featured_product_ids` | Phones whose outcomes credit it |
| `asserted` | Added by the route: region from the record, intent from the request |

## A.2 The registry

```json
{
  "K": 1.8, "thetaIn": 0.6, "thetaOut": 0.45,
  "tauMs": 1209600000, "epsilon": 0.01, "maxValuesPerDim": 64,
  "eventAttributes": "event-when-unknown",
  "version": "reflex-vantage-v2-room-memory+r3",
  "dimensions": [
    {"key": "category", "source": "category"},
    {"key": "brand", "source": "brand", "tauMs": 60000},
    {"key": "ecosystem", "source": "ecosystem"},
    {"key": "priceBand", "source": "price_usd", "derive": "band",
     "cuts": [400, 900], "labels": ["entry", "core", "premium"],
     "tauMs": 600000},
    {"key": "intent", "source": "intent", "multi": true,
     "tauMs": 600000},
    {"key": "perk", "source": "perk", "multi": true, "tauMs": 600000},
    {"key": "lines", "source": "lines"},
    {"key": "contentType", "source": "contentType", "tauMs": 60000}
  ],
  "journey": {"stages": [
    {"stage": "thinking", "anyOf": {"product_views": 6}},
    {"stage": "deciding", "anyOf": {"cart_adds": 1, "purchases": 1}}
  ]},
  "weights": {
    "product_view": 1, "pdp_view": 1, "view_product": 1,
    "page_view": 1, "search": 1.5, "select": 2, "filter": 2,
    "compare": 2, "wishlist": 2, "wishlist_add": 2,
    "add_to_wishlist": 2, "save_for_later": 2, "start_order": 3,
    "add_to_cart": 3, "cart_add": 3, "purchase": 5, "checkout": 5,
    "order_complete": 5, "content_impression": 0,
    "content_dwell": 0.5, "content_click": 1, "video_complete": 2,
    "tick": 0
  }
}
```

## A.3 The slots

The opening state. Beat 13 adds `"pinnedPieceIds": ["promo_iphone_duo_preorder"]` to `deals`.

**governanceVersion 3** names the generation of slot-control rules the slots document is checked and decided under. Version 1 admits off-limits and excluded pieces, version 2 adds allowed types and excluded tags, and version 3 adds pin prefixes.

```json
{
  "version": "slots-vantage+r51", "governanceVersion": 3,
  "pages": {
    "home": [
      {"slot": "hero", "take": 1,
       "weights": {"brand": 0.1, "campaign": 0.3, "ecosystem": 0.1,
                   "intent": 0.5, "lines": 0.35},
       "stage": {"inStage": 0.5, "outOfStage": 0},
       "seeds": [
         {"signal": "campaign_term", "value": "iphone-18-pro",
          "tags": [{"dimension": "campaign",
                    "value": "iphone-18-pro"}],
          "weight": 0.2}]},
      {"slot": "deals", "take": 4,
       "weights": {"brand": 0.2, "campaign": 0.3, "category": 0.1,
                   "ecosystem": 0.15, "intent": 1, "lines": 0.4,
                   "perk": 0.1, "priceBand": 0.1},
       "merchandising": {"maxBoost": 1.6, "minBoost": 0.7,
                         "promotion": 0.1},
       "diversity": {"dimension": "brand", "max": 2},
       "seeds": [
         {"signal": "campaign_term", "value": "iphone-18-pro",
          "tags": [{"dimension": "campaign",
                    "value": "iphone-18-pro"}],
          "weight": 0.2},
         {"signal": "platform", "value": "ios",
          "tags": [{"dimension": "ecosystem", "value": "ios"}],
          "weight": 1,
          "dampen": [
            {"dimension": "intent", "value": "switch", "factor": 0.5},
            {"dimension": "ecosystem", "value": "android",
             "factor": 0}]},
         {"signal": "platform", "value": "android",
          "tags": [{"dimension": "ecosystem", "value": "android"}],
          "weight": 1,
          "dampen": [
            {"dimension": "intent", "value": "switch", "factor": 0.5},
            {"dimension": "ecosystem", "value": "ios",
             "factor": 0}]}]}
    ],
    "phone": [
      {"slot": "pdp-modules", "take": 6,
       "weights": {"category": 0.15, "contentType": 0.2,
                   "intent": 0.2, "lines": 0.3, "perk": 0.35,
                   "priceBand": 0.2}},
      {"slot": "plan-pairing", "take": 3,
       "weights": {"intent": 0.5, "lines": 0.25, "perk": 0.35}}
    ]
  }
}
```

## A.4 The learn document

**objective** `unit` counts each credited outcome as one. `revenue` would weigh it by the outcome's value and `margin` by its margin, and either needs a reward that carries a value, `purchase` or `add_to_bag`.

```json
{
  "version": "learn-vantage+r3",
  "holdout": {"share": 0, "salt": "<redacted>", "arms": ["default"]},
  "regional": {"enabled": true, "kBlend": 0.5, "minEvents": 30,
               "dimensions": ["brand", "ecosystem", "priceBand",
                              "category"]},
  "policy": {"scope": "session", "match": "direct", "credit": "last",
    "windowsMs": {"click": 1800000, "dwell": 1800000,
                  "video_complete": 1800000, "custom": 1800000,
                  "wishlist": 21600000, "add_to_bag": 21600000,
                  "purchase": 604800000}},
  "stats": {"n0": 30, "tauLearnMs": 1814400000, "liftMin": 0.5,
            "liftMax": 2, "nMin": 30},
  "slots": {
    "deals": {"gamma": 0, "reward": "click", "objective": "unit",
              "exploration": {"mode": "off", "share": 0,
                              "floor": 0}},
    "hero": {"gamma": 0, "reward": "click", "objective": "unit",
             "exploration": {"mode": "off", "share": 0,
                             "floor": 0}},
    "pdp-modules": {"gamma": 0, "reward": "click",
                    "objective": "unit",
                    "exploration": {"mode": "off", "share": 0,
                                    "floor": 0}},
    "plan-pairing": {"gamma": 0, "reward": "click",
                     "objective": "unit",
                     "exploration": {"mode": "off", "share": 0,
                                     "floor": 0}}
  }
}
```

## A.5 Two more explains

The hero's record for the snapshot in §7: brand apple 1 × 0.1 plus ecosystem ios 1 × 0.1 is 0.2, all regional, and the seed's 0.06 makes 0.26. The other heroes score 0: for a stranger nothing they are tagged with carries a regional share, and the continue hero is multiplied by 0 outside its stage fit.

```json
{"candidates": [
   {"contentId": "hero_launch", "score": 0.26},
   {"contentId": "hero_switch", "score": 0},
   {"contentId": "hero_family", "score": 0},
   {"contentId": "hero_continue", "score": 0}],
 "explain": {
   "drivers": [
     {"dim": "brand", "value": "apple", "a": 1, "weight": 0.1},
     {"dim": "ecosystem", "value": "ios", "a": 1, "weight": 0.1},
     {"dim": "regional", "value": "US-NY", "a": 1, "weight": 0.2}],
   "score_base": 0.26, "lift": null, "score_final": 0.26,
   "regional": {"region": "US-NY", "level": "region", "lambda": 1,
                "version": 1790865492056, "events": 425,
                "asserted": true, "contribution": 0.2},
   "contextual": {"applied": 0.06, "drivers": [
     {"signal": "campaign_term", "value": "iphone-18-pro",
      "dimension": "campaign", "tag": "iphone-18-pro",
      "weight": 0.2, "contribution": 0.06}]}}}
```

The third deal's explain as the snapshot answer carries it: drivers and the diversity line only, the full record being read through the receipt action. It is the worked example of §3.2.

```json
{"contentId": "promo_galaxy_z_fold8_trade_in", "score": 0.388,
 "strategy": "affinity",
 "explain": {
   "drivers": [
     {"dim": "ecosystem", "value": "android", "a": 0.667,
      "weight": 0.15},
     {"dim": "category", "value": "phones", "a": 1, "weight": 0.1},
     {"dim": "priceBand", "value": "premium", "a": 1, "weight": 0.1},
     {"dim": "brand", "value": "samsung", "a": 0.438, "weight": 0.2},
     {"dim": "regional", "value": "US-NY", "a": 1, "weight": 0.388},
     {"dim": "merchandising", "value": "promotion", "a": 0,
      "weight": 0.1}],
   "diversity": {"dimension": "brand", "max": 2,
     "skipped": ["promo_iphone_17_new_line"], "relaxed": false,
     "sentence":
  "promo_iphone_17_new_line yielded: at most 2 per brand in this slot"
   }}}
```
