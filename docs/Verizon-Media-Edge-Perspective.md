# Paid Media Experimentation and the Edge

## An architecture perspective on the Verizon Media conversation

**Author:** Simone Coelho — Managing Principal Enterprise Architect, Optimizely
**Date:** 2026-08-04
**Status:** Internal perspective for the account and product teams in the Verizon media discussion. Account references in §4 are internal-only; do not forward externally without stripping them.

---

## 1. Why I'm writing this

I've been following the thread with the Verizon Media team, and two things struck me.

First, the four use cases the Media team shared are being treated as a mostly new problem space for us. They aren't — not entirely. Over the past two months I designed, built, and shipped a real-time personalization engine at the CDN edge for a Tapestry engagement: deterministic behavioral affinity scoring, automatically generated audiences, geography-aware cold starts, signal-driven creative assembly, and a proven outbound loop that pushes edge-computed scores into an external platform in a few hundred milliseconds. That machinery is deployed and has been verified live against real platform APIs. A meaningful share of what the Media team is asking about needs exactly this class of capability on our side of the fence — and for those parts, the architecture cost is already sunk. What remains is last-mile plumbing, not new invention.

Second, the skepticism already voiced in the thread — that the ad platforms don't expose enough via API — is correct where it matters most, and we should keep it. The fastest way to lose a sophisticated media team is to imply we can reach into places we cannot. Credibility in this conversation will come from drawing the line precisely: name the wins, cost the gaps, and concede the rest without flinching.

That is what this brief does.

## 2. Reading the ask precisely

The Media team's summary groups their testing needs into four categories. Before mapping anything to our stack, it's worth decoding what each one actually is in platform mechanics, because the answer differs sharply per category.

| Use case | What it actually is | Where the lever lives |
|---|---|---|
| **Optimization strategy** ("event + features" for ML-powered auctions) | Every major platform runs a closed bidding model (Google Smart Bidding, Meta Advantage+). The advertiser's only real inputs are *which conversion event* to optimize toward, *what value* to attach to it, and which platform features to enable. Testing "optimization strategy" means testing those input choices. | Mostly inside the platform. The advertiser controls only the **signal fed in** — and most advertisers feed it poorly. |
| **Audience targeting** (granular 1P vs. broad demo) | Build first-party audiences, sync them into the platforms (Customer Match, Custom Audiences), and measure whether precision beats the platform's modeled reach — granular is precise but small and expensive; broad lets platform ML hunt. | Audience **manufacturing** is the advertiser's job; delivery is the platform's; the comparison is a measurement problem requiring holdouts. |
| **Creative** (which imagery/message per audience) | In-platform creative "tests" are structurally confounded: the delivery algorithm shows each creative to different people it selects, so "creative A won" is entangled with "who was shown A." Clean creative-per-audience reads are close to impossible inside the auction. | The confound is unfixable in-platform. Clean reads require an environment where **allocation is controlled** — which the advertiser only has on properties they own. |
| **Geo experimentation** (local media effectiveness) | Matched-market / geo-lift testing: activate local media in selected markets, hold out comparable markets, measure causal lift. This is the industry-standard, privacy-proof way to measure media incrementality. | Media flighting is theirs. The open needs are **market-grain outcome telemetry** and the **lift statistics** (synthetic control, matched markets). |

One more thing sits above all four. The first message in the thread named it: *"the disconnect between media spend and digital experience."* That sentence is the actual requirement. The four use cases are symptoms; the disconnect is the disease. Any perspective we bring should treat it that way.

## 3. The thesis

The disconnect between media spend and digital experience is not diffuse — it lives at exactly one point in the chain: **the click-through seam**. The ad platform's knowledge of a person ends at the click. The site's knowledge begins there. The handoff between the two is owned by nobody in the media stack: the DSP can't see past it, the analytics tag fires after it, the CDP hears about it hours later.

We already run production code in that seam. An edge worker is the first server-side touchpoint that sees both sides of the click — the campaign context that produced it and everything the visitor does after it — while the click is still warm, in single-digit milliseconds, on every request.

That position implies a specific, honest relationship with the ad platforms, and it's the frame I'd bring to the brainstorm:

> **You cannot open the auction's black box. You can feed it better, audit it independently, and own what happens after the click.**

Feed, audit, own. Those three verbs are the entire scope of our legitimate ambition in this conversation — and they cover more of the Media team's list than the thread currently assumes.

```
  ad click ──► EDGE WORKER (the seam)
               · continuity: campaign- and market-aware first paint   [OWN]
               · capture: server-side, first-party event telemetry
                    │
                    ▼
               AFFINITY ENGINE (deterministic, explainable)
               · decayed per-dimension scores → generated audiences
               · value-scored conversions
                    │
        ┌───────────┴────────────┐
        ▼                        ▼
  WAREHOUSE → WNA          EGRESS RAIL (the new build)
  independent measurement:  audiences + valued conversions
  holdouts, geo lift        → ad platforms                  [FEED]
  [AUDIT]                        │
                                 └──► better targeting & bidding on the next impression
```

## 4. What already exists — built, deployed, live-verified

For the Tapestry engagement I built the following. I list it here at capability altitude because none of it is speculative — each item runs today and was verified against live systems, not slides. (Account details internal-only.)

- **A deterministic edge affinity engine.** Decayed, per-dimension behavioral scoring held hot per visitor — people move *into and out of* audiences in real time as interest builds and fades. Deliberately not ML: every score is reproducible arithmetic, and every membership change carries an explanation record. Sub-second on the request path.
- **An audience factory.** The engine loops a taxonomy and *generates* governed audiences from it automatically — roughly forty are live today from a six-axis retail catalog, population-filtered, with human edits surviving regeneration. Point it at a different taxonomy and it manufactures a different audience portfolio.
- **Geo cohorts at the edge.** Real request-level geography (no client-side flakiness), enriched with public census data, resolved at market grain with graceful rollup — all 50 states covered. First paint is market-aware with no flicker and no round trip.
- **Signal-driven creative assembly.** An external signal (in the retail build, a social trend) flows into edge-assembled hero creative — generated imagery and copy as discrete variables — allocated by Optimizely bandits. Both MAB and contextual bandits (CMAB) run live against the real Optimizely APIs today.
- **A proven outbound loop.** The edge forwards events and upserts live scores to an external platform (ODP in the current build) and reads confirmations back — round trips wire-proven at roughly 200ms. The pattern — fire-and-forget forwarders off the response path, throttled score upserts, receipt confirmation — is endpoint-agnostic. This is the architectural template for any egress, including ad platforms.
- **Server-side first-party telemetry.** Every event is captured at the edge, schema'd, and lands warehouse-shaped. No pixel loss, no ad-blocker attrition, exact geography on every row.

The transferability point matters more than any single item: **nothing in this machine is retail-specific.** The scoring core is a pure function; dimensions are configuration; audiences generate from whatever taxonomy it's handed. Hand it *campaign → ad set → creative → geo flight* instead of *product line → silhouette → occasion* and the machine does not notice. That is why "what would it take" has a much smaller answer than a blank-page reading of the thread suggests.

## 5. Where we can create impact, use case by use case

### 5.1 Audience targeting — our strongest ground

The hard half of "granular 1P audiences vs. broad demo" is *manufacturing the granular audiences*. That is literally what the audience factory does: deterministic behavioral scoring in over configurable dimensions, governed audiences out, generated and retired automatically as the data moves.

There's a subtler win here that a media team will feel immediately: **legibility**. A test of granular-versus-broad is only interpretable if you can say what the granular audience *was*. Most 1P audience exports are black boxes — a scored list with no explanation, so when granular wins (or loses) nobody can say why. Ours is glass: every membership is explainable arithmetic over named dimensions. When the test reads out, the "why" is sitting in the audience definition.

What's missing is the sync rail into the platforms — Customer Match, Meta Custom Audiences. The outbound pattern is proven against ODP; this is an endpoint swap plus a consent gate (see §7), not a research project. The measurement half — holdout design, incrementality — belongs to warehouse-native analytics, which the thread has already raised, and our telemetry feeds it cleanly.

### 5.2 Optimization strategy — partial, and we should be precise

The auction is closed. We will never set, shade, or influence a bid, and we should say so in the first breath. What the advertiser controls is the signal: which events, what attached value, how complete the feed. That's where we're strong, twice over:

- **Completeness, before any cleverness.** Server-side first-party capture recovers the conversions that client pixels lose to ad blockers and browser privacy controls. A more complete event stream makes platform optimization better with zero strategy change. It is the cheapest win in this entire document.
- **Value, not just pings.** The platforms' own recommended path is value-based bidding — send conversion *values*, not flat conversion events. Most advertisers can't, because nothing in their stack can score a conversion's worth at the moment it happens. Our engine computes behavioral affinity and engagement scores *in the same session that generates the conversion*. Attaching them turns a flat ping into "this conversion came from a high-affinity visitor — find more like this one."

The Media team's actual question — *which* event-and-value scheme performs best — then becomes a legitimate experiment: vary the signal set, measure downstream outcomes in the warehouse. Independently, please: platform-reported lift is the platform grading its own homework.

### 5.3 Creative — reframe it, honestly

We cannot fix creative measurement inside the platforms; the delivery confound is structural. Two honest plays remain, and both are strong:

- **The clean-room version, onsite.** Which imagery and message works for which audience is answerable cleanly on properties Verizon owns, where allocation is controlled: contextual bandits assign creative per audience, results are interpretable per cohort, and the learnings travel back to inform ad creative briefs. We run exactly this today — bandit-allocated, edge-assembled creative — live.
- **Continuity, at the seam.** The edge reads the click context (campaign, creative, market) and the landing experience *continues the ad's story at first paint* — same message, same imagery family, no flicker, no round trip. This attacks the "disconnect" sentence more literally than anything else in this brief, and message-match between ad and landing page is one of the most reliable conversion levers in the industry. Architecturally it is our signal-driven creative assembly with the signal source swapped from a social trend to a click ID.

### 5.4 Geo experimentation — two halves, one of them already built

The half we hold: local media activation needs an *onsite counterpart* and *clean outcome telemetry*, and both exist. When local media runs in a specific market, the edge recognizes that market on arrival — real request geography, market grain, all 50 states — and can hold the onsite experience consistent per market for the duration of a test (a quiet prerequisite of geo experiments that client-side tooling handles badly). Meanwhile every outcome event lands server-side with exact geography: no pixel attrition, first-party, warehouse-shaped — materially better lift inputs than tag-based collection.

The half we don't: the lift mathematics — synthetic control, matched-market selection — is warehouse-native analytics territory, exactly as suggested in the thread. Our contribution is feeding it the highest-fidelity outcome stream available. Given Verizon's depth with Google, that same telemetry plays cleanly into clean-room analysis as well.

## 6. Where we can't help — said plainly

These concessions cost us nothing, because nobody else in the room can do them either. Pretending otherwise is how vendors lose technical audiences.

| We can honestly claim | We cannot, and should not imply |
|---|---|
| Feed the auction a more complete, value-scored conversion stream | Access, influence, or test the bidding/auction internals |
| Manufacture explainable granular 1P audiences and sync them out | Depth in in-platform feature testing (drafts/experiments APIs are shallow; feed-based ad extensions are platform configuration) |
| Own the click-through seam: continuity at first paint, market-aware landings | Media planning, buying, or pacing; media-mix modeling |
| Independent measurement via warehouse-native analytics over first-party telemetry | Clean creative measurement *inside* the platforms — the delivery confound is structural |
| Freshness that beats nightly CDP batch syncs | Millisecond ad-side activation. Our milliseconds are onsite; platform audience ingestion is measured in hours. The honest sentence: *"the session that generated the signal already benefited onsite; the platforms get it fresher than any batch pipeline would deliver it."* |

That last row deserves emphasis because it disciplines our own story: the edge's real-time advantage is fully true at the landing moment and for signal freshness. It attenuates at egress, on the platforms' clock, not ours. We should volunteer that before anyone asks.

## 7. What it would actually take

Three modules, in ascending order of newness. The first two are reconfiguration of running machinery; only the third is a genuinely new build.

| Module | What it is | Reuse vs. new | Altitude |
|---|---|---|---|
| **Ad-context ingress** | Parse click IDs and UTM context at the worker; stamp into the session, the event stream, and optionally the scoring dimensions | A parser plus configuration on the existing engine | Days |
| **Continuity scenes** | Landing experience keyed on campaign + market: the ad's story continued at first paint | The signal-driven assembly and geo machinery, nearly verbatim, on existing infrastructure | About a week to a compelling working demonstration |
| **Activation egress** | Audiences and value-scored conversions pushed to ad platforms (Customer Match, Meta CAPI; via ODP destinations where coverage exists, direct server-side calls where it doesn't) | Follows the proven outbound-loop pattern; the endpoints and the consent layer are new | The one real build — weeks, not months |

On consent: it is a first-class design input for the egress module, not a compliance afterthought. Exporting first-party audiences to ad platforms is squarely in state-privacy-law territory, and a carrier — with a CPNI-shaped privacy posture and the 2024 FCC location-data enforcement history in the industry's recent memory — will examine that gate before anything else. Designing it in from the first line is both right and a selling point.

Three facts need checking before anyone makes an external promise; I can run these down:

1. **ODP destination coverage** for Google/Meta audience sync as it stands today (I have validated ODP's core event and profile paths live; I have not audited the destinations catalog).
2. **The APAC Opal/paid-media motion** (the Omnicom-partnered "agentic command centre") — what's actually in the playbook and what's reusable.
3. **Warehouse-native analytics' current geo-lift capability** — what the stats side supports today versus what needs the data science team.

## 8. How this fits the wider Optimizely story

The brainstorm posture proposed in the thread is exactly right — this team doesn't need to be sold something this quarter; it needs to meet a coherent point of view. Ours has three layers that are already real, plus one honest boundary:

- **The edge — the moment of contact.** Continuity into the experience, first-party signal capture out of it. The seam, owned.
- **Opal and ODP — intelligence and orchestration.** Audience generation, profiles, and the agentic command-centre motion APAC is already running over media planning and reporting.
- **Warehouse-native analytics — the truth layer.** Independent measurement — holdouts, geo lift — including over experiences we didn't deliver.
- **The auction stays outside.** We feed it better, audit it independently, and own the landing. That is the entire pitch, and every word of it is defensible.

If it would help the conversation, I can stand up a demonstration on our existing infrastructure: click a mock ad → campaign- and market-aware first paint → affinity building live on screen → an audience lighting up → an export receipt to an ad-platform endpoint. Our standard build honesty applies — every seam real, only the external platform call mocked — and the timeline is days, not a quarter, because the machine already runs.

## 9. Closing

The disconnect between media spend and digital experience is older than programmatic advertising; teams have thrown attribution models, CDPs, and tag managers at it for two decades, always from one side of the click or the other. What's changed is that general-purpose compute now runs inside the CDN — in the one position that sees both sides of the click while it is still warm. We didn't build our engine for media, but we built it in exactly that position, and it was built to have new taxonomies pointed at it. Where the Media team's list touches that position, we should speak with confidence, because the machinery exists. Where it doesn't, we should concede fast and in plain language — it will buy us more standing with this audience than any claim we could make.

— S.C.
