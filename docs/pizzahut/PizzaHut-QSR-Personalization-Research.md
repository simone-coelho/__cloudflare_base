# QSR / Pizza Personalization — Research Dossier

**Status:** INTERNAL · researched 2026-08-11 (live web, all claims sourced) · Confidence: HIGH = official/primary or multiple reputable sources · MEDIUM = single reputable source or company-stated · LOW = weak, use with care. Read §6 (corrections) before any customer conversation — this space is full of commonly misstated "facts."

---

## ⚡ Recency alerts (changed in the last ~9 months — the pitch must reflect these)

1. **Pizza Hut is being sold.** Yum! signed definitive agreements **2026-06-16** to sell Pizza Hut for **$2.7B** — LongRange Capital takes ex-mainland-China (~$1.5B + up to $75M earn-out by 2030); Yum China takes mainland (~$1.2B). Close expected **Q3 2026**; trade press reports August completion expected. (Yum! investors 2026-06-16; Restaurant Dive 807829; Pizza Marketplace Aug 2026) — HIGH
2. **Yum keeps supplying Byte by Yum! to Pizza Hut ex-China post-sale** (plus a transition services agreement) — Byte becomes a *vendor* relationship with the former parent. (Yum! investors 2026-06-16) — HIGH
3. **Hut Rewards relaunched 2026-04-21** as a "membership" (points + challenges + merch drops + experiences). (PR Newswire 302747901; Restaurant Dive 818061) — HIGH
4. **The agentic-ordering wave is live in 2026:** Papa Johns became first partner for Google Cloud's "Food Ordering" agent (2026-01-11); Little Caesars shipped a pizza-ordering app **inside ChatGPT**; Chipotle relaunched rewards with AI-personalized offers (2026-04-13). — HIGH

## §1 McDonald's × Dynamic Yield — the validation arc

| Date | Fact | Confidence |
|---|---|---|
| 2019-03-25 | McDonald's acquires Dynamic Yield — its **largest acquisition in 20 years**. Purpose: drive-thru menus varying by **time of day, weather, restaurant traffic, trending items** + instant order-based add-on suggestions. (McDonald's corporate; TechCrunch) | HIGH |
| 2019 | Price **reported ~$300M** — never officially confirmed. (QSR Magazine; Adweek) | MEDIUM-HIGH |
| 2019-04 → 12 | ~700 US drive-thrus in a month → ~8,000 → 9,500+; DY's case study cites **~12,000 drive-thrus in 6 months**. (Skift Table; Restaurant Dive 559649; Hospitality Tech; DY case study) | HIGH |
| 2019–2021 | **Publicized results:** average-check growth attributed to suggestive selling; after 11,000+ US installs, drive-thru service **~30 seconds faster**, credited partly to DY; recs continuously A/B-tested against competing algorithms. (Restaurant Business Dec 2021; DY case study) | MEDIUM-HIGH (company-stated) |
| 2021-12-21 | McDonald's announces **sale of DY to Mastercard**. Context: owning a horizontal vendor (400+ brands incl. competitors) not core; franchisee tech-fee friction as backdrop. (CNBC; Restaurant Dive 616412) | HIGH (sale) / MEDIUM (motives) |
| 2022-04 | Sale completes, terms undisclosed. **McDonald's stays a DY client** — kiosk recommendations across ~15,000 locations (US/AU/CA). Mastercard pairs DY with SessionM + Test & Learn. (NRN; Mastercard investor news) | HIGH |
| 2023-12-06 | What McDonald's did next: **Google Cloud partnership — edge computing (Google Distributed Cloud) inside thousands of restaurants** + gen AI. (PR Newswire 302006915; Restaurant Dive 702033) | HIGH |
| 2024-06 | Ended the IBM drive-thru voice-order test (~100 locations; accuracy low-to-mid 80s). Not an AI retreat — see §6.12. (CNBC 2024-06-17) | HIGH |
| 2023→2025 | **Loyalty is the personalization engine now:** 175M 90-day actives / $30B loyalty sales (2024) → ~210M actives (end 2025) → targets 250M / $45B by 2027. (McDonald's corporate; PYMNTS) | HIGH |

**Arc in one line:** the biggest QSR on earth bought a personalization engine, scaled it to ~12–15k stores, banked check growth and ~30 seconds of speed, then decided owning the *vendor* wasn't the moat — first-party data + loyalty + edge infrastructure was. The engine itself now belongs to **Mastercard** — a third-party payments network owns QSR's reference personalization graph. That's the opening for a first-party, edge-native alternative. (Same competitive foil as our retail geo work; the frame transfers verbatim.)

## §2 Yum! / Pizza Hut stack — and the compete-vs-complement verdict

**The 2021 trio:** Kvantum (Mar 2021 — AI *marketing-mix analytics*, campaign-level not 1:1) · Tictuk (Mar 2021 — conversational/social ordering, mostly international) · **Dragontail** (closed 2021-09-08, AU$93.5M ≈ US$72M — AI kitchen/delivery; in ~1,500 PH stores at acquisition; became Byte's kitchen module). — HIGH

**Byte by Yum!** (announced 2025-02-06): proprietary SaaS — online/app ordering, POS, kitchen & delivery optimization, menu management, inventory/labor, team-member tools. At launch 25,000 of ~61,000 restaurants on ≥1 product; ~300M digital transactions/yr. **Pizza Hut US's stated Byte usage = the kitchen system.** By Q4 2025: ≥1 Byte product in 38,000 restaurants; Byte Digital Ordering in 18,000. **Nvidia collaboration** (2025-03-18): voice ordering, computer vision, restaurant analytics — pilots incl. Pizza Hut US. Yum's stated personalization proof points are **campaign/CRM-level** (AI-personalized email → 2x engagement) plus loyalty scaling; ambition quote (CFO→CEO Chris Turner): "scale AI-driven personalization across all brands and digital channels." Digital scale: >$30B digital sales 2024, mix >50% → **61% ex-PH by Q2 2026**. (BusinessWire; PYMNTS 2026-02-05; Yum/Nvidia releases; Restaurant Dive 739579; Yum Q2'26 release) — HIGH

**Pizza Hut's reality:** SSS -3% FY2024, -5% FY2025, **10 consecutive quarters of decline** through Q1 2026; Q2 2026 global SSS -1%, US system sales -5%; US share **16.9% (2015) → 12.1% (2025)**; ~**250 US closures** in H1 2026 ("Hut Forward"). Strategic review announced 2025-11-04 (Turner: the turnaround "may be better executed outside of Yum!") → sale agreed 2026-06-16. (PMQ; Restaurant Dive; Scripps; Yum investors) — HIGH

**⚖️ Verdict: COMPLEMENT today, two watch-items.**
1. Byte's announced surface = commerce/ops rails; **no real-time storefront decisioning product announced** (as of 2026-08-11). — HIGH
2. Yum's personalization evidence = email/CRM + loyalty + ops voice/vision, not on-session web decisioning. — HIGH
3. Post-close, Byte is a supplied service from the former parent under contract/TSA; LongRange owns the roadmap and has a turnaround mandate. — HIGH
4. An edge decisioning layer sits *in front of* Byte's rails — the same architectural relationship DY had to McDonald's ordering stack. — assessment
- **Watch-item A:** Yum could productize decisioning later (stated ambition, nothing announced). Honest line: *"Byte personalizes campaigns and runs the rails; nobody does real-time in-session decisioning for Pizza Hut today — and Pizza Hut's roadmap is about to belong to LongRange, not Yum."*
- **Watch-item B:** during separation/TSA, IT bandwidth is constrained — a **zero-rearchitecture edge layer** is the kind of addition that fits a separation period. (Positioning judgment, not a sourced fact.)

## §3 Competitor personalization landscape

| Brand | What they actually personalize | Confidence |
|---|---|---|
| McDonald's | Contextual drive-thru/kiosk recs via DY (~15k locations); loyalty offers at ~210M actives; in-restaurant edge compute (Google Distributed Cloud) | HIGH |
| Domino's | Friction-kill + loyalty (~33M actives Q1'24, carryout 52% of sales); Microsoft Azure OpenAI partnership (2023-10) for AI ordering; **predictive start-cooking-before-the-order belongs to Domino's Pizza Enterprises** (ANZ/EU/JP master franchisee, AWS) — not US Domino's | HIGH / MEDIUM-HIGH |
| Starbucks | The benchmark: Deep Brew offer/cohort personalization; Rewards tender **57% (Q2 FY23) → ~60% (Q1 FY25)** of US company-operated sales | HIGH (tender) / MEDIUM (internals) |
| Chipotle | 40M enrolled (Q1'24; ~21M *active* 2025 — different metric); **"Rewards on Repeat"** relaunch 2026-04-13 with AI-personalized offers scored on frequency + predicted LTV | HIGH (dates) / MEDIUM (scoring detail) |
| Papa Johns | Most aggressive pizza personalizer: PJX + Google Cloud (Apr 2025) — AI-anticipated orders, hyper-personalized perks; **first Google "Food Ordering" agent partner (2026-01-11)** | HIGH |
| Wingstop | Built its own: MyWingstop (~$50M, Apr 2024), 50M+ digital guest records, digital mix 69% (Q3'24), **~20% higher member checks** credited to hyper-personalization | MEDIUM-HIGH (company-stated) |
| Little Caesars | Convenience tech (Pizza Portal lockers) + **ChatGPT ordering app (2026)** | HIGH |
| **Pizza Hut** | Byte kitchen ops; Tictuk-lineage social ordering intl; relaunched Hut Rewards; **no real-time menu/offer decisioning found** — the gap | HIGH (absence across trade press) |

## §4 Behavioral stats for the pitch (number · source · confidence)

**Habit:** ~**60%** of US consumers have a go-to QSR order (Creative Realities 2023 — MEDIUM, vendor survey) · **57%** have a few go-tos / **30% order the exact same thing every time** (US Foods 2024 — MEDIUM) · DPE's models predict orders well enough to **start cooking before the order is placed** (AWS — MEDIUM-HIGH; the structural point: pizza demand is that predictable).

**Loyalty vs anonymous:** Starbucks Rewards = 57→60% of US company-operated tender (HIGH) · McDonald's 175M→~210M 90-day actives (HIGH) · Domino's ~33M actives (MEDIUM-HIGH) · KFC members visit **+12% more** after joining (Yum, company-stated — MEDIUM-HIGH) · Paytronix 2025: loyalty checks +10% YoY at 44% of QSR brands, but declines at 12–25% (HIGH for the report). **No public Hut Rewards member count** — and the pitch's point: everyone's personalization lives behind login; the anonymous majority is unserved.

**Published lift:** McDonald's: check growth + ~30s service (MEDIUM-HIGH, company-stated) · Yum: AI-personalized email = **2x engagement** (MEDIUM-HIGH — useful jiu-jitsu: Pizza Hut's own former parent testified personalization works) · Wingstop ~20% member check lift (MEDIUM) · McKinsey benchmarks: personalization = **5–15% revenue lift; 71% expect it; 76% frustrated without it** (Nov 2021 — HIGH for the report).

**Weather & events (the edge-signal case):** Grubhub, Jan 2015 NYC blizzard: **cheese +135% / pepperoni +134%** vs typical Monday (HIGH — single documented event, don't generalize the magnitude) · Bite Squad: cold Mondays +12% deliveries, frigid weather +21% hot-food (MEDIUM) · weather cuts both ways: Taco Bueno -20% in Texas floods, BJ's -40% in a snowstorm weekend — dine-in vs delivery asymmetry (MEDIUM) · **McDonald's/DY explicitly used weather as a decisioning signal** and Pizza Hut's own analytics team feeds weather into recommendations upstream (HIGH that operators treat weather as a personalization input) · Super Bowl: Domino's ~2–2.4M pizzas, **+30–40%** vs typical Sunday (HIGH, company estimates) · Halloween **+19.6%**; NYE ~19.1M slices; Thanksgiving Eve top-5 night (HIGH, company PR) · Domino's carryout = **52% of sales** (HIGH).

## §5 Vendor landscape (2025–2026)

- **Dynamic Yield (Mastercard):** still the QSR reference engine; claims 13–15M transactions/day across ~15,000 restaurants. **McDonald's current contract status unverified in 2025–26 — treat as unknown.** (MEDIUM-HIGH claims / LOW current status)
- **Hyperscaler land-grab:** Google Cloud (McDonald's, Papa Johns + Food Ordering agent), Microsoft (Domino's), Nvidia (Yum), AWS (DPE). Personalization increasingly ships as custom builds on cloud AI rather than licensed engines. — HIGH
- **In-house platform era:** Byte (38k restaurants), MyWingstop ($50M), McDonald's edge+loyalty stack. Pattern: **own the data and platform, buy the decisioning capability.** — HIGH (facts)
- **Consolidation:** Olo → Thoma Bravo ~$2.0B (closed Sept 2025). Punchh (PAR) / Paytronix (Access Group) ownership not re-verified this pass. — HIGH / MEDIUM
- **Agentic ordering (2026):** decisioning engines must serve APIs/agents, not just web UIs — Papa Johns×Google agent, Little Caesars×ChatGPT. (Relevant to our headless push-by-ID posture: it's already API-shaped.) — HIGH

## §6 Corrections — what people commonly get wrong (say these right in the room)

1. "$300M for Dynamic Yield" — **reported**, never officially confirmed; Mastercard's price also undisclosed.
2. "McDonald's dumped DY because personalization failed" — **wrong**: they credited results, kept using it post-sale at ~15k locations, planned global scaling. The divestiture was about not owning a horizontal vendor.
3. "DY personalized the drive-thru 1:1" — mostly **no**: drive-thru was *contextual* (time/weather/traffic/cart); true 1:1 needed app identification. McDonald's proved the context half — the identity half lived in the loyalty app. (Perfect setup for first-party identity + edge context.)
4. "Byte is Yum's personalization engine" — Byte's announced modules are **commerce/ops rails**; personalization claims to date are campaign/CRM-level. Kvantum is media-mix analytics, not 1:1.
5. "Pizza Hut = Yum! Brands" — **outdated as of 2026-06-16**; address LongRange-era Pizza Hut. And the strategic review was announced **Nov 4, 2025** (don't misdate it).
6. "Domino's starts baking before you order" — that's **Domino's Pizza Enterprises** (ANZ/EU/JP franchisee), not US Domino's. And **"Pie Pass" does not exist** — people conflate Little Caesars' Pizza Portal. Don't repeat it.
7. "Domino's doesn't personalize" — half-true historically; post-2023 Microsoft partnership targets personalized AI ordering. Position against "no *real-time in-session* decisioning," not "no personalization."
8. **Loyalty counts are apples-to-oranges** — enrolled vs active vs 90-day-active vs tender-share. Cite the metric; QSR-literate buyers will call sloppiness.
9. Starbucks "30% ROI / 3x revenue from Deep Brew" figures = **SEO content-farm numbers**, unverifiable. Use tender share and member counts only.
10. **Weather stats are event-specific** — the famous +135% was one blizzard, one platform, one category; weather also *hurts* dine-in concepts. Correct claim: weather shifts demand predictably **by channel and category** — which is exactly why it belongs in a real-time signal set.
11. "12.5M pizzas on Super Bowl Sunday" — untraceable industry folklore; use Domino's own ~2–2.4M / +30–40%.
12. "McDonald's gave up on AI after the IBM flop" — no; they ended a premature voice test while **expanding** edge compute, loyalty personalization, and gen-AI ops tooling.

## §7 The five strongest facts, ranked

1. **McDonald's bought a personalization engine for a reported ~$300M, scaled it to ~12,000 drive-thrus in six months, credited it with check growth and ~30 seconds of speed — and that engine now belongs to Mastercard.** Validates the category at maximum scale, proves ROI language exists, and plants the first-party/edge-native flag in one sentence.
2. **Pizza Hut is being sold to LongRange Capital right now, after 10 straight down quarters and share erosion 16.9% → 12.1%.** New owner + turnaround mandate + separation from Yum = the best budget-and-timing window this account will ever have. Frame everything for LongRange's Pizza Hut.
3. **Byte by Yum! keeps running the rails post-sale — but its announced surface is ordering/POS/kitchen/inventory, with no real-time storefront decisioning.** We complement what they keep and fill the gap nobody fills — the honest answer to "don't they already have this?"
4. **Peers are monetizing first-party personalization now:** Starbucks ~60% tender share; Wingstop's $50M platform lifting member checks ~20% at 69% digital mix; direct rival Papa Johns building AI-anticipated ordering with Google. Economics proof + competitive urgency, while Pizza Hut's digital majority already exists as surface area.
5. **Pizza demand is provably context-predictable — blizzard +135%, Super Bowl +40%, Halloween +19.6%, DPE cooking before the order — and ~60% of QSR customers have a go-to order. None of that context reaches Pizza Hut's storefront in real time today.** The edge story in miniature: cheap, first-party, PII-light signals, and an edge engine is the architecture that can act on them in-session.

*Verified current through Yum's Q2 2026 release (2026-07-30) and trade coverage as of 2026-08-11. Known unknowns: McDonald's current DY contract status; Hut Rewards member count; Punchh/Paytronix ownership details not re-verified.*
