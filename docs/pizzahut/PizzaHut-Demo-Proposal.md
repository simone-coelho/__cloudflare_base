# Pizza Hut — Edge Affinity Demo Proposal

**Status:** INTERNAL draft for review · 2026-08-11
**Timeline convention:** all effort figures in §7 are INTERNAL working estimates (AI-speed build reality). External commitments, if any are ever made, get set separately with buffer — internal dates never leak into customer artifacts.

---

## 1. The opportunity, and why the window is now

Pizza Hut told us the thing every pizza operator knows and few act on: **customers who buy a particular pizza tend to reorder the same pizza until something changes.** Their own product surface proves they believe it — the logged-in experience is built around 3-tap reorder, saved orders, and a per-user "Most Popular items" module. But all of it requires an account. The anonymous majority — the visitors who walk in the digital front door, order as guests, and leave — get a static menu.

That is precisely the visitor our engine was built for: **anonymous-first, learning within the session, deterministic, explainable.** The pitch line writes itself: *you built reorder for the signed-in minority; we make the anonymous majority feel like regulars from their first clicks.*

Three timing facts make this pursuit unusually well-timed (sources in the research dossier):

1. **Pizza Hut is being sold.** Yum! signed definitive agreements on 2026-06-16 ($2.7B: LongRange Capital takes everything ex-mainland-China; Yum China takes mainland), with close expected ~Q3 2026. A private-equity owner with an explicit turnaround mandate — after ten consecutive quarters of same-store-sales decline and share erosion from 16.9% to 12.1% — is exactly the buyer profile for measurable, operable, no-data-science-bench-required conversion tooling.
2. **Byte by Yum! belongs to the seller.** Pizza Hut's ordering/POS/kitchen rails stay on Byte post-close *as a supplied service from the former parent*. Byte's announced surface is commerce and operations rails — **no real-time storefront decisioning product exists in it**. We complement the stack they keep, and we fill the gap nobody — including Yum — fills for them today. (Two watch-items on this verdict are documented in the dossier §2.)
3. **The category is pre-validated at maximum scale.** McDonald's bought Dynamic Yield (reported ~$300M, 2019), scaled it to ~12,000 drive-thrus in six months, publicly credited it with check growth and ~30 seconds of service-time improvement — and then sold the engine to **Mastercard**. The reference personalization graph for QSR is now owned by a third-party payments network. Our first-party, edge-native, deterministic story lands in that gap, and it is the same competitive frame we have already built and demoed against Dynamic Yield in retail.

## 2. What we would demonstrate

One sentence: **a Pizza Hut digital storefront that recognizes a regular without a login, notices when tonight is different, and can explain every slot on the page.**

The five signature beats (full deck of twelve, with dimensions and signals, in the use-cases doc):

1. **Your Usual, One Tap** — the centerpiece, their own insight made live. An anonymous visitor's repeated pepperoni interactions saturate `recipe` affinity on screen; the hero flips to "Your usual? Large Pepperoni, Original Pan — start it." One tap, prefilled cart, no account.
2. **Wander Mode** — the habit-break they asked about ("…unless things change"). The engine detects exploration overtaking habit — dwell on Melts, deal-page hunting, never-configured items — and swaps from "your usual" to a guided tour anchored on adjacency (pepperoni person → Pepperoni Lover's Melt).
3. **The Lapsed Regular** — decay as the honesty feature. Time-warp control advances six weeks; the visitor **exits** the regulars audience on screen; the hero deliberately stops saying "your usual" (which now reads stale) and reverts to a win-back value hero. Nobody else demos the exit.
4. **Lunch Reflex** — daypart. Same visitor, same URL: 11:45am renders a solo lunch hero ("$5 til 5" Flatzz framing); 7:10pm renders Big Dinner Box. Their CEO has said two-thirds of pizza sells after 4pm and lunch is the growth gap — this beat is strategy, not gimmick.
5. **The Protected Hero** — governance in one screen. Marketing pins the campaign slot for everyone; a new-item push is eligibility-gated to novelty-leaning visitors; the visitor's strongest dimension owns slot 1. Gates → pins → weighted rank, with the explain record open. This is the anti-black-box argument made visible, and it's the argument a lean PE-owned team buys.

Supporting cast (from the full deck): Family Night Autopilot (party-size → family box), Game Day Radar (sports-calendar context gating content emphasis only), Crust Loyalist (their own "Hut Crust" campaign axis proves the theme), Heat Seeker (flavor re-ranking), Deal-Lover's Lane (behavior-only deal orientation + mix-and-match basket completion), Carryout Regular (mode affinity — direct franchise P&L), Solo Box Nudge.

**Plus the AI chapter (confirmed in scope 2026-08-11): Menu Search and the Table Concierge.** The retail demo's natural-language search and style concierge, re-tailored to a table mindset and grounded in the menu catalog + the live affinity vector: search that answers "something spicy but not heavy, and one gluten-free for the kid," and a concierge that answers "feeding six for game night, keep it around $50" with a real, priced, one-tap order built from the menu — biased by what this visitor already leans toward. Same house rule as retail: AI generates and converses; the affinity engine decides; the two are visibly separate layers in the demo.

Everything uses their own merchandising grammar — the audience generator will literally mint audiences named in their house style ("Pepperoni Lover's Regulars"), because the names come from the catalog, which is the point.

## 3. The demo surface

- **New page, new URL:** `restaurant.html` + `restaurant.js` served at **`/restaurant`** (CONFIRMED) — the static-assets layer gives us the route with zero routing code, and the existing storefront and all other demo surfaces remain untouched (house rule: this repo hosts many demos; nothing gets overridden).
- **The demo brand is a fictional Italian pizzeria, not a Pizza Hut clone (DECIDED 2026-08-11).** Working name **"Forno Amico"** (alternates: Trattoria Rossa, Casa di Pizza — presenter's pick). This is deliberate on three counts: no trade-dress questions at all; the surface is reusable for any restaurant prospect afterward; and the narrative sharpens — an Italian neighborhood pizzeria is culturally the place that knows your usual, so the brand IS the thesis. The menu is Italian-American (Margherita, Diavola, Quattro Formaggi, pepperoni front and center for the habit story, wings, pasta, cannoli/tiramisù, family box). In the room, we show how the generated audiences would read in Pizza Hut's own grammar ("Pepperoni Lover's Regulars") — the names come from whatever catalog you hand the generator; that's the point.
- **Same engine underneath:** the deterministic affinity core scores whatever dimensions a config declares against whatever catalog it's handed. The menu is a catalog: `category / recipe / crust / toppings / daypart-fit / price band`. The audience generator, condition evaluator, session/WebSocket machinery, journey stage, geo identification, and experiment-creation primitives are reused as-is (verified to file:line — build spec §1).
- **Surface isolation is designed, not assumed:** the audit found the real cross-contamination traps (shared visitor identity, a global audience-regeneration marker that would archive the other catalog's audiences, "New Shopper" resetting both demos, ODP forwarding). Each has a small, named mitigation in the build spec §2. Two demos, one worker, no crossover — same standard as multi-presenter session isolation today.
- **Experimentation-ready:** dedicated Optimizely FX project for Pizza Hut (own project ID, SDK key, datafile), flags for the demo slots, and live experiment creation through the already-proven API path — A/B and bandits on the hero and menu ranking. QSR volume is the textbook bandit story, and unlike other engagements, nothing constrains us from showing it here.

## 4. Honesty model (unchanged house standard)

- **Real:** the engine (live scoring, entries AND exits), geo identification, the WebSocket push, audience generation from the menu, experiment creation against the real Optimizely API, explain records behind every slot.
- **Synthetic and labeled:** the menu catalog (representative — public menu facts triangulated from third-party sources; prices marked representative, never quoted as theirs), order history (generated with genuine reorder-habit patterns so the habit math has something true to find), any AI-generated food photography.
- **Never faked:** the demo brand is our own fictional pizzeria, so no third-party logo or trade dress appears at all. Food photography is sourced from Pizza Hut's public product imagery for this private demo (provenance stays internal; assets are not redistributed), supplemented by AI-generated fillers where needed — generated images are labeled as such in the honesty notes.
- **Fairness red line carried over:** context signals (daypart, weather, sports calendar) gate *content emphasis only*. No pricing, gating, or discounting by geography or any protected class — deal targeting is by demonstrated behavior only, and the inspector proves it.

## 5. What we require

**Decisions — RESOLVED 2026-08-11:**
1. **FX project:** dedicated project, **created by Simone**. Outstanding handoff to engineering: Project ID · SDK key (datafile URL derives from it) · environment key · API token with flag/experiment scope (for live experiment creation from the operator surface) · confirm bandit availability on the new project.
2. **Route:** `/restaurant`. Confirmed.
3. **Demo brand & imagery:** fictional Italian pizzeria (working name Forno Amico; final name = Simone's pick); food photography from Pizza Hut's public site for the private demo, AI-generated fillers as needed. No third-party logo/trade dress anywhere.
4. **ODP: wired-dormant, not skipped.** Events always fire — captured in our store on every interaction, with the outbound forwarder fully built and keyed to **surface-scoped credentials that are simply absent in v1**. Connecting ODP later = set the credentials (and request a dedicated instance — restaurant events never use the retail demo's instance). Flip a switch, zero code. This is a design requirement, not a nice-to-have.
5. **Codename:** "Restaurant Demo."

**From the account/opportunity side:** whatever Pizza Hut context exists beyond the reorder insight — which team said it, what they've already seen, whether the conversation predates or postdates the sale announcement (it changes who the economic buyer is).

**From engineering (us):** the build list in the spec — engine surface-resolution (the one M-sized enablement), catalog + config + seeds, the page itself, isolation mitigations, FX wiring. No new infrastructure, no new services, no schema migrations required for the core demo.

## 6. Risks, honestly

- **The sale itself.** Closing ~now: procurement and priorities may freeze during separation, and the buyer's tech leadership may not be seated yet. Counter: this is also why the *demo* matters more than a deck — we want to be the first concrete thing the new owner's team sees. Watch the close date; aim the show at the LongRange-era team, not "a Yum division."
- **"Doesn't Byte do this?"** The evidence says no (ops rails, campaign-level CRM personalization) — but Yum has stated ambitions to scale AI personalization, so the honest phrasing is: *nobody does real-time, in-session storefront decisioning for Pizza Hut today, and Pizza Hut's roadmap is about to belong to LongRange, not Yum.* Never claim Byte is inert; the dossier has the exact watch-items.
- **Turnaround-mode buying.** 250 US stores closing; a brand under cost pressure buys conversion math, not personalization vanity. Every beat is framed in ticket/AOV/conversion terms already — keep it that way in the room.
- **Menu facts drift.** Deals and menu items rotate constantly (their deal constructs are date- and channel-locked). The demo catalog is representative by design; refresh the named items the week of any showing.

## 7. Effort & sequence — INTERNAL ONLY

Per the build spec's ordered list (engine enablement → visible surface → depth):

| Phase | Content | Internal estimate |
|---|---|---|
| 1. Engine enablement | Menu catalog + PH reflex config + surface resolution + per-catalog audience generation (collision fixes) | ~1–2 days |
| 2. Visible surface | `restaurant.html/js` (menu grid, WS bootstrap, affinity instrument, own identity + New Diner reset), images | ~2–3 days |
| 3. Depth | Synthetic reorder-habit history, choreography beats (moments, time-warp, Wander/Lapse), FX project wiring + one live bandit, scene-gen food prompts | ~2–3 days |
| 4. AI chapter | Menu Search + Table Concierge: restaurant-tailored prompts, menu-catalog grounding, affinity-aware answers, two widgets on the page | ~1–2 days |
| **Total to a sophisticated, presenter-ready demo** | | **~1.5–2 weeks internal** |

Verification standard as always: rendered state, not attributes; beats verified at human navigation pace, not curl pace.

## 8. Document map

Use-cases (the creative deck) · Research dossier (facts + sources + corrections — read before any customer conversation) · Build spec (engineering truth). All in this folder; index in the README.
