# Opticon Presenter Companion — the 43 beats, studied

**For Simone. Study material, not a stage script.** The director bar on screen shows the room *BEAT n OF 43* and what to watch; it never shows these words. This document is what you absorb the night before, so that on the day the story comes out of you, not off a page. It is built beat for beat from `public/meridian/beats.js` (the single source of the run of show), the engine code itself, and Dynamic Yield's own published material — every claim in here traces to one of those.

**The scene.** Fifty minutes, about thirty customers, retail and financial services — marketers. People who think in audiences, experiments, statistics and revenue, not in code. The room sees **Calder & Co.** (and, for one glorious act-two close, **Calder Financial**). Meridian is the internal codename; it appears nowhere on screen. You advance with **Next**. On beats that perform, Next opens the declaration band — what she does, the weights, the arithmetic, what will change — you read it with the room, and **OK — let her do it** lets the visible cursor act. Nothing on that page ever changes without a press. Time passes only when you say so.

**The competitor discipline.** Nothing on screen ever names Dynamic Yield or any other vendor — the anti-DY card was deliberately renamed *"How the cold start works — the area, then your own sales"*, and that renaming was a decision, not an accident. The DY material in this document exists for your mouth, and almost all of it for your *answers*: when someone asks, you are ready. One exception to know about: the scripted line at beat 4 does name Dynamic Yield once, out loud. That is the script's choice and it is defensible — but decide before you walk on whether you say the name there or hold it for Q&A. The screen will never contradict you either way.

**The honesty law.** Every beat in `beats.js` carries a `real:` line — LIVE, REPRESENTATIVE, SIMULATED, or a split. Those lines are the law of this session. Anything simulated is said **proudly, first, before the impressive part** — the simulated label is a credibility move, never an apology. The model answers below quote the exact split for every beat where the question will come.

---

## 1 · The spine — five sentences that are the whole session

Memorise these. Every one of the 43 beats is one of these five sentences wearing different clothes. If you lose your place, any of them gets you home.

1. **Most of your traffic is a stranger.** The majority of visitors are unidentified and most have never been seen before — every personalization system in the room reaches the identified minority, and this session spends forty-five minutes on the majority.

2. **We open a stranger's page on your own receipts plus free public data.** No profile, no segment, nobody else's data: real edge geography, real cited census figures, and what shoppers from her metro actually bought — in your own purchase history. It costs no licence, it carries real intent, and it compounds because it is yours.

3. **Every decision is explained and tunable — nothing asks you to trust a black box.** This was the design's founding principle, not a feature. Evidence in, arithmetic on screen, thresholds named, weights on a dial, refusals shown with the score they gave up — and your merchandiser outranks all of it, on the record.

4. **The experiments are real objects in your own project.** Flags and rules you can open in the Optimizely console the moment they are created — and where a number needs traffic this room cannot generate, the number is labelled representative, on screen, while it is shown.

5. **Time and decay are honest.** Every signal fades on its own clock; audiences are *left*, not just entered, by the same arithmetic running backwards; and an offer's countdown runs to a computed instant that cannot be extended — when it ends, it names the number that ended it.

How the acts hang on them: Act 0 and Act 1 are sentences 1 and 2. Act 2 is sentences 3 and 5 — the engine, glass and honest. Act 3 and Act 4 are sentences 3 and 4 — the operator in control of real objects. Act 5 is sentence 4 closing the loop, and beat 43 is the honesty of sentence 5 applied to the whole session.

---

## 2 · The Dynamic Yield answer, mastered

*(For your mouth only. The screen never names them. Sources: pages fetched 2026-08-29 — support.dynamicyield.com and mastercard.com pages via the r.jina.ai reader proxy because both domains block direct fetches; quotes are verbatim from the full pages. Two items marked repo-sourced come from `docs/opticon/Research-Personalization-Demos.md`, the 2026-08-28 cited research pass.)*

### How they tell the story — their own words

Dynamic Yield — now branded **"Dynamic Yield by Mastercard"**, positioned as an "Experience OS" with the tagline *"AI-powered growth, built for marketers"* and the claim that *"One AI core reads intent, behavior and context to adapt experiences in real time"* (mastercard.com/global/en/business/consumer-acquisition-and-engagement/personalization.html) — tells the affinity story in two tiers.

**The classic tier is genuinely documented.** Their affinity score is *"∑ recency weight (engagement type weight x attribute value count) = score"* — each interaction type weighted by *"an assumed 'level of intent'"* (purchase > add-to-cart > view), with three fixed recency tiers: *"Real-time: The last 48 hours… Recent history: The last 30 days. Old history: The last 12 months"*, normalised against site traffic (support.dynamicyield.com/hc/en-us/articles/360005773198-Affinity-based-Personalization). Affinity audiences are built by picking an attribute, a value, and *"the level of user affinity from highest to within the top 10"* (…/360025623873-Affinity-based-Audiences). What a customer can tune: which attributes feed the profile (up to five, from a dropdown) — and the engagement weights, but only if you *"speak to your Customer Success Manager"*. The recency tiers are documented as fixed. No DY document shows a marketer a per-visitor affinity profile in the UI; profiles are exposed to developers as bare scores via API (dy.dev/reference/affinity-client-side). And audience entry is real-time, but *"reports are updated once a day"* (…/15804454530077-Audience-Reports — repo-sourced).

**The ML tier is explicitly a black box, by their own description.** AffinityML is *"powered by our state-of-the-art long short-term memory (LSTM) recurrent neural network"* and campaigns *"are agnostic to how the profile is calculated"* (…/15599896272157-AffinityML). NextML recommendations are *"a self-training personalized recommendation strategy system"* whose *"algorithm is updated weekly"* and whose *"logic is subject to change"* (…/360014180617-Deep-Learning-Recommendations). AdaptML is *"a centralized AI system to automate decision making"* with the *"optimal strategy automatically determined"* (mastercard.com …/dynamic-yield/solutions/adaptml.html). **Predictive Targeting** *"runs in the background, searching for hidden personalization opportunities"*, surfaces the top five as cards with *"the expected uplift"*, and offers *"effortless 1-click deployment"* (…/360022724793 and mastercard.com …/use-cases/targeting/predictive-targeting.html). **Element** brings *"aggregated and anonymised"* Mastercard *"geographic spend insights"* to personalization — *"Insight only Mastercard can deliver… 175b+ Annual Mastercard transactions"* (mastercard.com …/capabilities/the-mastercard-advantage.html; Element launch release, March 2023, via retailtimes.co.uk).

### Your answer — concede, then claim

**Concede, sincerely.** They are the category's pioneer and an eight-time Gartner Magic Quadrant leader by their own count; the classic affinity math is genuinely published; predictive targeting is well liked for spotting opportunities proactively; Element is a real cold-start product, not a strawman; and third-party spend data honestly earns its keep for net-new prospecting. If the bar is "does behavioural personalization exist and work", they clear it. The bar in this room is different.

**Then claim — four differences, in this order.**

1. **Whose data opens the page.** Their cold start reaches for a rented, aggregated card-network average — everyone's spending, everywhere, identical for every merchant who licenses it. Ours opens on *your* receipts for that geography plus free public census, and it compounds because every sale you make sharpens it. They know what a metro spends on handbags; you know which of your lines your shoppers there carry, at which band.

2. **Glass box against black box — and who holds the dials.** Their published math stops where their ML begins: campaigns *"agnostic to how the profile is calculated"*, logic *"subject to change"*, strategy *"automatically determined"* — and even the classic weights are tuned by *their* staff, through a Customer Success Manager. Here the whole mechanism is arithmetic on screen: the weights, the decay clocks, the thresholds, the score every item earned, the refusals with the score they gave up — and the dials are yours, live, versioned. Every decision this engine has ever made can be explained to your CFO, and re-tuned by your merchandiser, without a support ticket.

3. **Audiences that leave.** Everyone's audiences are entered in real time now — theirs included. Ours are also *left*: by the same arithmetic decaying below a threshold, per dimension, with hysteresis so nobody flaps, and with the exit number printed as it happens. Their audience reports update once a day; our beat 27 shows a shopper leaving three audiences, live, each naming the number that released her. Ask any other demo to show you the leaving.

4. **Real experiments, and the rows.** Their optimization lives inside their platform's own reporting, graded by their own uplift figures. Here every experiment is a real flag and rule in *your* Optimizely project — open the console mid-demo — and every decision exports as warehouse rows so *you* compute the lift. We never present our own uplift number as the proof; their public sites lead with "30%+ average revenue and conversion uplift". That difference in posture is the product.

### The three-clicks question, mastered

**"How is this different from just counting three clicks?"** — the question behind every sceptical face in the room. The model answer, in your voice:

"Fair — three clicks is where it starts, so let me tell you everything a click counter cannot do. A counter never forgets; here every signal fades on its own clock — the aisle she is in fades in minutes, her taste in weeks, and in production those clocks read days, tuned by you. A counter treats every click the same; here the *kind* of evidence is weighed — a typed search beats a click, a stated preference beats both at double weight, an add-to-bag beats all of that — and the stated preference still decays on the same clock, so telling us once never steers her forever. A counter has no line to cross; here an audience is entered at 0.6 and left at 0.45, and that gap is why she does not flap in and out while your campaigns fire on the boundary. It is not one counter — it is eight running in parallel, one per dimension, each at its own speed, and the eighth is read from what she *did*, not what she looked at. The arithmetic is printed on the screen next to the decision it made — including the clicks it *refused* because your rules outranked them. Three clicks is the entry fee. The mechanism is what happens to those three clicks over the next two minutes — and you watched them decay."

If the asker is technical, the one-line version: "A counter is a running total. This is a leaky bucket per dimension with weighted inflows, thresholds with hysteresis, and a closed-form answer for when it crosses back — which is why we can put an expiry time on an offer and mean it."

---

## 3 · Beat by beat — all 43

Format, every beat: what Next performs · what the room sees · the story in your voice · the simple math where there is math · the questions that will come, answered. The planned seconds are a pacing intention, not a timer — nothing interrupts you mid-sentence. The ten marked beats (STOP, SLOW DOWN, etc.) are the ones that never get compressed if you run short.

## Act 0 · The frame — 4:00 · slides, no product on screen

Three sentences the whole session rests on. The room holds these for forty minutes, so land each one once, properly, and do not rush into the demo.

### Beat 1 · Most of your traffic is a stranger (Act 0 · 1:20 planned)

**You press:** Nothing in the demo — this is a slide. Next only advances the counter.

**The room sees:** A slide. No product on screen yet — that is deliberate.

**Tell it like this:** Most of the traffic on your site is unidentified, and most of it has never been seen before. Every personalization system in this room — including ours, until now — does its best work on the identified minority: the logged-in, the cookied, the known. That is the minority. I am going to spend the next forty-five minutes on the majority: the stranger who just arrived, about whom you know nothing. If we can be useful to *her*, everything else gets easier.

**If they ask:**
- *"What share of our traffic is actually anonymous?"* — Your number is yours and worth measuring this week. In most retail books the unidentified share is the majority — which is exactly why the whole industry's demos start with a logged-in user. This one starts with a stranger.

### Beat 2 · The edge is not a datacentre (Act 0 · 1:20 planned)

**You press:** Nothing — slide.

**The room sees:** A definition they will hold for the next forty minutes.

**Tell it like this:** When I say "the edge" I do not mean a datacentre your request travels to. I mean the same network hop that already served you the page — the decision runs where the request already is. There is no second trip, no round trip to a personalization server on another coast. That is the entire reason everything you are about to watch can happen inside a single click, while she is still on the page.

**If they ask:**
- *"Isn't that just a CDN?"* — A CDN caches files at that hop. This puts the *decision* at that hop: the profile, the arithmetic and the choice of what to show all live where the page is served. Same geography, different job.

### Beat 3 · Your merchandisers still outrank the machine (Act 0 · 1:20 planned)

**You press:** Nothing — slide. Then switch to the demo.

**The room sees:** The last slide before the store appears.

**Tell it like this:** Before you see a single product, the rule of the house: your rules decide what *can* show. The engine decides what *does* show, in the space your rules leave — and it shows its receipts for every choice. Later in this session you will watch it decline a click it would have won, because a merchandising rule said no, and you will watch a pin beat the algorithm with the machine saying so on the record. Nothing in the next forty minutes asks you to trust a black box.

**If they ask:**
- *"So can my team override it?"* — Yes, with declared precedence: gates first, pins second, ranking last. You will see a pin land mid-page at beat 23, the hero pinned at beat 25, and the refusal at beat 26 — hold the question until then and I will show you rather than tell you.

## Act 1 · The Arrival — 6:00 · the ecosystem

The rest of the world is on the left; the store in the centre; the instrument on the right. This act shows off-site cause becoming on-site effect, four times, on one profile. Keep it moving — it sets up Act 2, it is not the point.

### Beat 4 · She arrives — the cold start (Act 1 · 0:50 planned · ⏸ STOP)

**You press:** Next. The director first resets to a brand-new visitor (stage management — a clean slate the room can trust), then the band opens: arrives from New York · the real census row · your receipts — 320 shoppers in her metro, Drover 35%, Linden 25%, Fenwick 15%, they buy premium — and what the page will open on. Read the band with the room, then OK — the arrival performs.

**The room sees:** The hero: *"The Drover leads near you · New York metro · N=320"*. The first product line: *"What shoppers near you carry"*, badged **near you**. The welcome strip. The provenance card: geo real · census real · first-party representative · behaviour none.

**Tell it like this:** Nobody knows her. No account, no cookie, no segment — she is the majority visitor from my first slide. What we do know is where she is, because that is a property of the connection — and two things about *where she is*: what the public census says about her metro, which is free, and what shoppers from her metro actually bought, which is sitting in your own receipts. So the store opens on the Drover, because that is what New York carries, in your own purchase history. No licensing fee, real purchase intent, and it compounds because it is yours. Aggregate, never the individual. We curate — never price, never gate.

**The simple math:** The cold start plants a small price-band prior — visible on the bar at about 0.36, deliberately below every threshold. We know something; we have committed to nothing. Her first real act outweighs it.

**If they ask:**
- *"Isn't this what Dynamic Yield does with Mastercard data?"* — They genuinely ship a geo cold start — credit where due. It targets anonymous visitors using aggregated, anonymised category-spend *averages* from a card network: a third-party market average, rented, with no connection to what your customers buy from you. We open on your own receipts for that geography, enriched with census data that is free and public domain. Their signal is everyone's spending everywhere; ours is your customers' actual purchases of your actual range — and it is a moat, because no competitor can rent it.
- *"Is this real?"* — The label is on screen: geo LIVE (off the connection), census LIVE and public (ACS 2024, cited), first-party REPRESENTATIVE — the receipts are representative rows today, and in production the same query runs against your warehouse. The query is real; only the data is swapped, and swapping it back is a configuration change, not a build.
- *"Is this redlining?"* — The bright line: we curate merchandising only — never a price, never a discount, never access, never anything near credit. Affluence signals only, never protected classes, never a ZIP as a proxy for one. And it is additive — no neighbourhood is ever down-ranked.

### Beat 5 · She opened an email (Act 1 · 0:55 planned)

**You press:** Next. The band declares the episode — the email opened, the weight it carries (one browsing signal, 1.0) — OK, and the cursor opens the email in the inbox on the left.

**The room sees:** An episode card forms on the left: opened → pixel fired → identity resolved → landed. And the hero has already answered the email — before she clicks anything on the site.

**Tell it like this:** She opened that in her inbox — not on your site. The pixel fired, we captured it at the edge, and by the time she landed, the page had already answered the message she came from. She has not clicked a single thing here yet. Most stacks would call that a batch job and show her the answer tomorrow. This is the connection that served the page, answering inside it.

**If they ask:**
- *"Is that a real email client?"* — The inbox is a staged surface standing in for the rest of the world — we are not going to project someone's Gmail. The pipeline behind it is the live one: pixel, capture, identity resolution and the page's reaction all ran just now, on stage. The `real` label on this beat is LIVE, and that is what it refers to.

### Beat 6 · She clicked the ad (Act 1 · 0:50 planned)

**You press:** Next — band, OK, the cursor clicks the paid-social ad.

**The room sees:** The UTM lands, the episode names the campaign, and the hero picks up the ad's promise.

**Tell it like this:** Your media team paid real money to make that click happen. Most sites take the click, pocket the attribution, and then show the same homepage they show everyone — the campaign's promise dies on arrival. Here the landing already keeps it. Same mechanism as the email, different surface — I will stop labouring it, but notice it is the *second* system that would normally hold its own copy of this person.

**If they ask:**
- *"Does this need my ad platform's API?"* — No — the UTM is on the click and the capture is first-party, at the edge. Nothing here rents anyone's graph.

### Beat 7 · She signed up by text (Act 1 · 0:30 planned)

**You press:** Next — band, OK, the SMS sign-up fires.

**The room sees:** Identity resolves off a phone number. The hero answers the text.

**Tell it like this:** Different surface, same profile — and she has never typed an email address into your site. A phone number from an opt-in is first-party identity too, and it resolves into the same single view of her.

**If they ask:**
- *"Consent?"* — It is an opt-in surface — she signed up. Everything in this act is first-party data you already own; nothing is bought, matched or inferred from a third party.

### Beat 8 · A form on someone else’s site (Act 1 · 0:30 planned)

**You press:** Next — band, OK, the style quiz submits from a partner site.

**The room sees:** Declared interest joins observed behaviour on the instrument — and the engine keeps them apart.

**Tell it like this:** Now we hold two different kinds of evidence: what she *told* us and what she *did*. The engine weighs them differently — a stated preference counts double a click, because it is unambiguous. But here is the part I love: it decays on exactly the same clock as everything else. Telling us once, in March, that she likes evening pieces does not steer her page forever. Declared taste has to keep agreeing with behaviour, or it fades like everything else.

**The simple math:** A declared preference weighs 2.0 against 1.0 for a click — double, but short of entering an audience on its own — and it sits in the same vector, on the same decay clock.

**If they ask:**
- *"Why not let the quiz define her?"* — Because people change, and quizzes are a moment. Saying you like evening pieces is not the same as buying one — so a declaration is worth two signals, never a life sentence.

### Beat 9 · Four surfaces, one profile (Act 1 · 0:55 planned)

**You press:** Nothing — point at the episode stack on the left. Give this its pause; it is the act's thesis.

**The room sees:** Four episode cards — email, ad, text, partner form. One profile on the right. No stitching step anywhere.

**Tell it like this:** Email platform, ad platform, SMS, a partner form. In most stacks those are four systems holding four different views of this one person, reconciled — if ever — by a nightly identity job someone maintains. Here there was nothing to stitch, because the four surfaces resolved into one profile at the edge as they happened. And every one of those signals is first-party data you already own. Nothing in this act required buying data, renting a graph, or waiting for a batch.

**If they ask:**
- *"So is this a CDP?"* — It does not replace one — it means the *decision* does not have to wait for one. The profile that decides the page lives at the edge, per visitor; your CDP and warehouse stay the system of record and the export target.

### Beat 10 · The receipts behind the cold start (Act 1 · 1:30 planned)

**You press:** Next opens the Cold start tab on the instrument, then the card — *"How the cold start works — the area, then your own sales"*. Nothing to perform; you walk the room through what is on screen. The longest beat in the act, by design.

**The room sees:** The region off the connection · the census row with its source · your receipts by line with their shares · the grain used · the four honesty tags: geo real / census real / first-party representative / behaviour none. Then the two-column card: what the area tells us, what your own sales tell us, matched to your range.

**Tell it like this:** Let me show the working, because everybody in this room has been sold a cold start before. The geography is real — it comes off the connection. The census is real and free — ACS, cited on the row with its vintage: income, home value, down to ZIP. And the receipts are *yours*: what shoppers from this metro bought, line by line, with the share — 320 of them here. Others will sell you receipts that have nothing to do with what you sell — a market-wide average of everyone's spending everywhere. This is your own data matched to your own range: people here earn about this, buy in this band, so the store opens there. One honest subtlety: when your own counts are thin in a geography, we roll up — ZIP to metro to state — and we *show the grain we used*. We roll up because your receipts are thin, never because the census is. And we curate. Never price.

**The simple math:** The ladder gates on your own shopper count — a grain needs about thirty distinct buyers before we trust it — and stops at the first grain that clears. The grain used is printed on the panel, because the grain *is* the honesty.

**If they ask:**
- *"How is this different from Dynamic Yield's Element?"* — Concede it plainly: they built a real cold-start product, and third-party spend data genuinely earns its keep for net-new prospecting — we are complementary there, not opposed. The difference is the kind of data and who owns it: theirs is an aggregated card-network average, licensed, identical for every merchant who pays; ours is your customers' purchases of your products, free census on top, and it compounds because every sale you make sharpens it. They know what a metro spends on a category. You know what your shoppers there carry, at which price band.
- *"What if I open a store somewhere I have no history?"* — Then the ladder tells the truth: it rolls up to the level where you do have history, labels the grain, and the census still gives you the local band. The moment real behaviour arrives, it outweighs all of it — geography is the opening hypothesis, never the verdict.

## Act 2 · The Handoff & The Session — 20:00 · the engine, the content lane, and the flip

The heart of the session. The campaign hands off to behaviour, the engine shows its arithmetic, then turns the same arithmetic on the content (beats 20–23, about five minutes: the second catalogue → the map → the complement → the pin), the merchandiser outranks it, time runs backwards, she comes back — and then you change what the company sells. Sentences 3 and 5 of the spine, over and over.

### Beat 11 · The handoff (Act 2 · 1:50 planned · ⏸ STOP)

**You press:** Next. The band declares the whole sequence — the Bags department, then two bags, with their weights — read it, OK, and the cursor performs her wander. (The do-line names the palette button "Wanders to bags"; on the day, let Next do it — same clicks, one consent.)

**The room sees:** The bars shift off the arrival category. The hero stops being about the campaign. And the email's episode card closes *itself* — superseded, in its own words.

**Tell it like this:** Stop. This is the most important sixty seconds in the session. The email said handbags. The ad said handbags. Every system she touched on the way here agreed about her. And she is looking at wallets. Watch what the page decides to believe. … It believed *her*. The campaign did not have to be wrong for that to matter — it was right when it was sent. She simply moved on, and the page moved with her, and the campaign's card on the left closed itself and said why. That is the difference between honouring a campaign and being trapped by one.

**The simple math:** No rule fired. The campaign's evidence stopped accumulating and started decaying; her clicks started accumulating. The page follows whichever is winning, and says which.

**If they ask:**
- *"Did someone program 'bags beat email'?"* — Nobody wrote a rule. Two clicks of live behaviour outweighed one decaying arrival signal — the same arithmetic you will watch all session, running in its ordinary direction.

### Beat 12 · That number is measured (Act 2 · 0:40 planned)

**You press:** Nothing — point at the latency badge.

**The room sees:** The measured decision time, updating with every event.

**Tell it like this:** One sentence about speed. No backend job ran just now, no segment rebuilt overnight, no profile was downloaded to this browser. That decision happened over a connection that was already open, while she was still on the page — and the number on that badge is measured on this stage, per event. Not a number from a slide.

**If they ask:**
- *"What is the latency, exactly?"* — Read it off the badge, live — that is the discipline: quote the measured number in front of the room, never a rounder one from memory. If pressed on production: the decision path is the same hop that serves the page; anything that syncs to other systems is a separate, slower job and we say so.

### Beat 13 · The control (Act 2 · 0:45 planned · ⏸ DO NOT SKIP)

**You press:** Next switches the instrument to Live affinity; show the sort row untouched.

**The room sees:** The standard order — *"the same order every shopper sees."*

**Tell it like this:** This row, right now, is the control: the order every shopper sees, ranked by nothing about her. Remember it. Every comparison for the next ten minutes is against this — and this room runs experiments for a living, so you know why I will not show you a single personalized ranking without first showing you the baseline it beat.

**If they ask:**
- *"Is the baseline itself merchandised?"* — Yes — it is your catalogue's own order, identical for everyone. Personalization here is measured *against* your merchandising, never instead of it.

### Beat 14 · Different memories, different speeds (Act 2 · 0:50 planned)

**You press:** Next. The band declares the Outerwear department and the first two coat clicks — OK, and the cursor performs them. The third coat is the next beat's job, with its own prediction. (The do-line says press "Three coats"; use Next — the palette button plays three clicks and would spend the click beat 15 wants to predict.)

**The room sees:** Bars moving at different rates. Taste barely moves; the session bars jump.

**Tell it like this:** Eight things about her, each with its own memory. What aisle she is in moves fast and fades in minutes. Her taste — the world she dresses in, the band she buys at — moves slowly and holds for a long time. One engine holds both speeds at once, which is what a person is actually like. And within a product line, the page follows her *last* step, not her running total — step from Drover to Linden and Linden leads immediately, while Drover trails until it fades out on its own. The page never ignores what she just did.

**The simple math:** Each dimension has its own decay clock — on the demo clock, the aisle fades in about three minutes and taste in about eight; in production the same dial reads days and weeks. Same math, different rate — and both tunings are published, because nothing here is a demo-only trick, only a demo-only speed.

**If they ask:**
- *"Who chose those speeds?"* — We did, as defaults — and they are configuration, not code. Tuning the clocks is a setting you own, versioned, and every decision records which version made it.

### Beat 15 · It waited until it was sure (Act 2 · 0:55 planned · ⏸ SLOW DOWN)

**You press:** Next. The band *predicts* what the third coat click will cause — the arithmetic one click ahead, against the entry threshold. Read it to the room. Close it. Watch it come true.

**The room sees:** The third click lands; a bar crosses the entry line and turns green; an audience chip appears; a green strip above the hero says she entered the audience — and why.

**Tell it like this:** I want you to notice what it did *not* do: it did not react to her first click. One click is noise. Two is a hint. Three is a pattern — and the band told you, before the click, exactly where the number would land. It waited until it was sure. And that shaded band on the bar is the gap between entering an audience and leaving it — she has to fall well below the entry line before she is released, which is why she will not flicker in and out of an audience all afternoon while your campaigns fire on the boundary.

**The simple math:** Every browsing act counts one. Two signals put her at 0.53 — short of the 0.60 entry line. The third puts her at 0.625 — over it. Exit is at 0.45, not 0.60: that gap is the no-flapping guarantee. Nobody wrote a rule; a score crossed a line you can read and move.

**If they ask:**
- *"Why 0.60?"* — It is a dial, not a constant of nature. Raise it and audiences get more certain and slower; lower it, faster and looser. The point is that it is *your* dial, on screen, versioned — not a model's private opinion.
- *"Dynamic Yield does behavioural audiences too."* — They do, and entry is real-time there as well — that is table stakes done properly. Two differences you just watched: the arithmetic was shown to you *before* the click, and the exit is the same arithmetic running backwards — you will watch her *leave* an audience in a few minutes, with the number that released her. Ask anyone else's demo to show you the leaving.

### Beat 16 · The row re-ranks (Act 2 · 0:50 planned)

**You press:** Nothing — it already happened. Let the motion do the work.

**The room sees:** Cards travelling. Rank chips counting. Only the movers ringed.

**Tell it like this:** Watch the coral one climb from five to one. Every card keeps its colour so your eye can follow it across the shelf, and only the cards that actually moved are ringed — everything quiet is genuinely unchanged. Her audiences promoted a handful to the front; the rest hold your standard order. Personalization that cannot show you exactly what it moved is decoration.

**If they ask:**
- *"Why did that specific card climb?"* — Click its explain: the dimensions it carries, her live scores on each, the weighted sum, the rank it earned. Every card on this page can answer that question — that is the point.

### Beat 17 · The hero commits (Act 2 · 0:35 planned)

**You press:** Nothing.

**The room sees:** The hero claims her — and says why.

**Tell it like this:** The hero just changed its reason. Until now it said "because of where you are" — because that was all it honestly had. Now it says "because of what you have looked at". It only claims her when it can support the claim. Small thing; it is the whole philosophy in one caption.

**If they ask:**
- *"What if the evidence is thin again tomorrow?"* — Then the caption retreats with it — you will watch that happen at beat 27. The reason on the hero is always the strongest thing the engine can currently defend.

### Beat 18 · Which box comes first (Act 2 · 0:50 planned)

**You press:** Next switches the panel to The trail. Nothing to perform — the sections re-ordered on the third coat; point at the page.

**The room sees:** The product row has climbed *above* the hero — a 700ms structural move, slow enough to read. The trail names it: *"Which box comes first · The hero 1 → 2"*, with the reason.

**Tell it like this:** Everything so far changed what is *inside* the boxes. This changed *which box comes first*. She is browsing coats, so the product row now leads the page and the campaign hero that brought her here dropped to second. Watch for it again later: the moment she decides, the offer will climb to the very top. Same profile, same arithmetic — but the candidates are the sections of the page rather than the products in them. In our own roadmap documents this is the six-month tier. It is running in front of you.

**If they ask:**
- *"Isn't this just a recommender?"* — A recommender re-orders products. This re-ordered the *page* — hero, row, offer, story competing for position on the same scored evidence. That is layout as a decision, with the reason logged in the trail like every other decision.

### Beat 19 · The page gains a section (Act 2 · 0:55 planned)

**You press:** Next. The band predicts the add-to-bag — the offer appearing, the completion row — read it, OK, and the cursor clicks Add to bag on the hero.

**The room sees:** The row becomes *"Complete the look"* — and nothing in it comes from the same category as the coat she chose.

**Tell it like this:** She stopped browsing and started deciding — and that is the eighth dimension, the only one not read off any product. It is read off the *verb*: what she did, not what she looked at. One decisive act is enough to enter it, because adding to a bag is not ambiguous. And look what the page did: it stopped offering her more coats — she has chosen her coat — and started completing the outfit around it. The page did not just change its contents. It gained a section.

**The simple math:** An add-to-bag weighs three browsing clicks, against a deliberately low bar for this dimension — one decisive act lands at 0.68, past the 0.60 entry line. Deciding is a state you enter on one act, and leave by decay like everything else.

**If they ask:**
- *"Why exclude the category she just chose?"* — Because the honest read of "deciding" is that the choice is made. Showing her six more coats now is second-guessing her; completing the look is serving her.

### Beat 20 · Content is a catalogue too (Act 2 · 1:15 planned · ⏸ THE TAPESTRY THESIS)

**You press:** Next presses "Show the receipts". Before the modal lands, point at the three chipped slots that have been sitting on the page all along — the merch strip, the content hero, the content carousel — so the room realises the content lane has been running the whole time.

**The room sees:** Three content slots already on the page: the merch strip *"The Calder Winter Sale"* — badged tenant config · non-personalizable · CMP-1007 — the content hero, and the content carousel, every one carrying a colour chip and a why line. Then the receipts modal: *"THE CONTENT PUSH"* — the literal payload, `{contentId, customerContentId, type, slot, order, score, explain}`. One push per page.

**Tell it like this:** Everything you have watched this engine do to products, it is doing to content — the same arithmetic, pointed at a second catalogue. These are your pieces, with your CMS ids, scored by the same affinities you have been watching move all session, and delivered as decisions *by ID*: we push the id, the slot, the score and the why, and your front end paints. That payload on the screen is the entire integration. And notice the merch strip — it has not moved all session, because your config says it is non-personalizable, and the engine ranks around it.

**If they ask:**
- *"We're headless — will this fight our front end?"* — The opposite, and the payload is the proof: `customerContentId` is your own CMS id, coming back in the decision. A headless front end paints by ID with no markup coupling at all — the engine never touches your templates; it hands you the id, the slot, the score and the why. (For you, not the room: this by-ID contract is, point for point, the contract the Tapestry engagement asked for. The name stays off the stage like every customer name.)
- *"Is that real content?"* — The label: content catalogue REPRESENTATIVE — these pieces stand in for your CMS today, and in production this is your CMS behind the same slots. The scoring is LIVE, and the payload is REAL — that is the actual push, not an illustration of one.

### Beat 21 · Content follows her, with the map (Act 2 · 1:15 planned)

**You press:** Next. The band opens on the schematic — *your page now → after*, two coloured mini-wireframes of the slots — and ghost badges appear on the page behind it, each saying where its slot will go. Read the map with the room. Then OK, and the cursor clicks a Fenwick — she touches a sweater.

**The room sees:** The plan, drawn before the move: two slot maps in the band, now and after, with ghost badges on the page itself. On OK the click lands, the carousel re-ranks to knitwear content, and the content hero becomes *"The Heritage Wardrobe"*.

**Tell it like this:** Before anything moves, the engine tells you the plan: this block here, that block there — and why: the scores, against the thresholds. Then it does exactly that, in front of you. Content recommendations with the same receipts as the products have. Nobody wrote a rule for any of it. She touched a sweater.

**If they ask:**
- *"Is that preview a mock-up?"* — No — the label is scoring LIVE, and the schematic is computed from the same forecast that then executes. The map and the move are one calculation, drawn before it runs — it cannot show you one plan and quietly do another.

### Beat 22 · The complement — content completing a product (Act 2 · 1:15 planned)

**You press:** Next. The band declares the add-to-bag — the hero's own Add to bag — read it, OK, and the cursor commits her to the sweater.

**The room sees:** The journey stage flips to deciding. The content hero becomes *"What to Wear With a Fisherman Sweater"* — a guide, not a lookbook — and its why line names its driver: *"completes · the Fenwick in her bag 1.00 × 0.5"*.

**Tell it like this:** She committed — and watch the content change jobs. A minute ago its job was inspiring her. Now its job is helping her finish: what to wear it with, how to care for it. Same engine, reading the stage of her journey, choosing content the way it chooses complements. And read that why line — the completion bonus is scored and shown, never smuggled in. That is content personalization as we mean it: not content that matches her taste, content that answers what she is *doing*.

**The simple math:** The completion driver is arithmetic like every other driver: the piece in her bag at full strength, 1.00, times the 0.5 completes weight — and the product is printed on the guide's why line, next to the decision it made.

**If they ask:**
- *"How does it know she is deciding?"* — The same eighth dimension you watched at beat 19 — entered on the decisive act, read off the verb, left by decay like everything else. The label here: scoring LIVE, journey stage LIVE.

### Beat 23 · Pin it anywhere (Act 2 · 1:15 planned · ⏸ THE CONTRACT LINE)

**You press:** Next presses "Pin the banner at #3" (Merchandiser group). Say the label out loud as it appears — slowed for the room — and then let the movement play; it is choreographed to be watched.

**The room sees:** The label first: *"SLOWED FOR THE ROOM — in production this is one frame."* Then the merch strip travels to visible position 3 one section at a time — about 420 milliseconds a step, slow enough to watch it think — while everything else re-ranks around it. The sticky strip: *"The merch banner is pinned at #3 — tenant config. The engine re-ranked everything else around it. Nothing is ever permanently pinned; any slot can be pinned at any position."* Every panel — the strip, the Why, the trail — says #3.

**Tell it like this:** Your merchandiser wanted the banner third. The contract says the banner is theirs — so it goes third, and the engine ranks everything else around it. Hold on to both halves of that sentence: nothing here is ever *permanently* pinned, and anything can be pinned at *any* position. And about the motion you just watched — in production this re-ranking is one frame. We slowed it so you could watch it think, and the screen said so before it moved.

**The subtlety (for you, not the room):** "#3" means the third position the room can *see* — the engine maps the pin past any hidden sections, so the banner lands third on the visible page, never third in some internal list the room cannot check.

**If they ask:**
- *"Is the slow motion hiding anything?"* — The label answers it: pin + rank-around LIVE; only the movement is slowed, for the room, and it says so on screen while it happens. Same discipline as everything else in this session — the label first, then the impressive part.

### Beat 24 · An offer that cannot be extended (Act 2 · 0:45 planned)

**You press:** Nothing — point at the offer band, which climbed to the top of the page the moment she decided.

**The room sees:** A white-glove service offer — service, not a discount — with a countdown.

**Tell it like this:** Look at that clock, because it is not a marketing timer. It runs to the exact instant the engine calculates her intent will fall back under its threshold — a moment computed from her evidence and its decay, not chosen by a campaign calendar. Which means two things nobody's urgency banner can say: it cannot be extended, by anyone; and when it ends, it will name the number that ended it. This is what a countdown looks like when it is true.

**The simple math:** The expiry is closed-form arithmetic: from the current evidence and its decay clock, solve for the moment the score crosses back under the exit line. We can tell you the exact minute an offer will die because it is arithmetic, not a timer.

**If they ask:**
- *"Can marketing extend it?"* — No — and that is the feature. The moment you can extend it, it is theatre, and shoppers have learned to smell theatre. This offer is a true statement about her intent, with an expiry the engine will honour against itself.

### Beat 25 · Your merchandiser outranks it (Act 2 · 0:45 planned)

**You press:** Next opens the audience list on the instrument, then pins the hero. **Release the pin before moving on** — beat 26's first press releases it for you, but if you wander off-script by hand, release it yourself: a pinned hero skips ranking and would leave beat 26 with nothing to show.

**The room sees:** The audiences, named in the catalogue's own merchandising words. The hero locks with a *PINNED BY THE MERCHANDISER* badge; its explain reads *"pinned · ranking skipped"*.

**Tell it like this:** Two governance points, one press. First: nobody wrote these audiences. They are minted from your catalogue, in your catalogue's own vocabulary — every line, every occasion, every band arrives with its audience ready, and when your catalogue changes, so do they. Second: declared precedence — gates first, pins second, ranking last. I just pinned the hero to a piece the engine did not choose, and the engine's own record says "pinned, ranking skipped". Your merchandiser outranks the machine, and the machine says so on the record — it does not sulk, it does not route around you.

**If they ask:**
- *"Does a pin fight the personalization?"* — No — precedence is declared, so there is nothing to fight. The pin wins, the receipt records that ranking was skipped, and the moment you release it, ranking resumes. Authority with an audit trail.

### Beat 26 · The refusal (Act 2 · 1:00 planned · ⏸ SLOW DOWN)

**You press:** Next — it releases the pin, marks the hero's item sold out, and opens the Glass box. Then open the explain on the excluded item, and give the room a second of silence.

**The room sees:** The item with the *highest score* on the page. Refused. The rule that refused it, named. The score it gave up, kept on the record.

**Tell it like this:** This is my favourite thing the engine does. That item just scored highest — it would have won the slot, and probably the click. A rule said no — it is sold out — and the engine declined its own best answer, re-decided in front of you, and *kept the score* so you can see exactly what it gave up. Her affinity was not touched; the rule judged the item, not her. Any system can show you its wins. Showing you the refusal, with the number attached, is worth more than every win on this page — because it is the proof that when this engine and your rules disagree, your rules win, visibly.

**If they ask:**
- *"Would it really surrender its best click in production?"* — Yes — that is what "gates outrank ranking" means, mechanically. The alternative is an engine that quietly bends your rules whenever the math disagrees with them, and nobody in this room wants to operate that.

### Beat 27 · Watch her leave (Act 2 · 1:55 planned · ⏸ THE BEAT NOBODY ELSE HAS)

**You press:** Next presses "Let two minutes pass". The band first shows exactly what those two minutes will take — which scores fall where, which audiences lapse, whether the offer dies — OK, and the retreats begin. For the rest, press the palette button ("Let two minutes pass", in the Session group) once more yourself, and talk over both.

**The room sees:** Three separate retreats, in order, each naming its dimension and its number: the hero stops claiming her aisle first, the row lets go of her price band next, the story releases her taste last. The offer ends and states the number that ended it. The row returns to discovery.

**Tell it like this:** Everyone in this industry demonstrates joining an audience. Watch her *leave* one. I am going to let two minutes pass — nothing is faked, the exact same decay is running, I simply chose the moment, because on this stage time moves only when I say so. And notice it does not collapse all at once. What aisle she is in goes first, because that is the most perishable fact about her. Her price band holds longer. Taste goes last — taste is the slowest thing about any of us. Three retreats, three clocks, each one naming its number as it lets go. Nobody wrote an exit rule for any of that. It is the same arithmetic you watched enter her, running backwards. … And there is the offer, ending, telling you the number that ended it.

**The simple math:** Exit is entry's mirror: each score decays on its own clock, and when one falls below the exit line, the audience releases her and prints the number. Different clocks per dimension is why the page lets go of her in stages instead of forgetting her all at once.

**If they ask:**
- *"Why does this matter commercially?"* — Because stale audiences are where personalization goes to die: she bought the coat three weeks ago and your homepage is still shouting coats. Audiences that expire by arithmetic are self-cleaning — no suppression rules, no quarterly audience hygiene project.
- *"Is the decay running in production at this speed?"* — No — this is the demo clock, minutes instead of days, and both tunings are published. Same math, same code path; only the rate differs, and the rate is your dial.

### Beat 28 · She came back (Act 2 · 0:50 planned)

**You press:** Next — the director performs the return: same visitor, new session.

**The room sees:** Dimensions, audiences and a personalized hero — restored.

**Tell it like this:** She closed the tab. She came back. No login, no cookie sync, nothing was downloaded to her browser and nothing had to be fetched from a distant profile store — the profile was held per visitor at the edge, where the page is served, and the page opened already knowing her. Short beat, honest beat: this is memory, exactly where the decision runs.

**⚠️ The caution (from the script):** Do NOT say "ODP is the memory". ODP is deliberately not connected on this surface. If asked: connect ODP and this memory becomes durable across devices and shareable with the rest of your stack — and that is a credential, not a code change.

**If they ask:**
- *"Where exactly does the profile live?"* — In a per-visitor object at the edge — her state, her scores, her audiences. Per visitor, isolated, expiring on the same honest clocks you just watched. The label on this beat is: edge memory LIVE · ODP wired-dormant.
- *"What about across devices?"* — That is identity, and it is where ODP joins: wire it in and this same profile becomes durable and shareable across your stack. We kept it disconnected today so that what you just saw could not be mistaken for a CDP lookup — this was the edge, alone.

### Beat 29 · I changed what we sell (Act 2 · 1:35 planned · ⏸ THE STRONGEST LINE)

**You press:** Next — the director switches the business to Calder Financial. Then let the silence do the work; this beat needs the quiet after it more than the words in it.

**The room sees:** Eight bars stay in exactly their places and re-label. The four surfaces on the left keep their kinds — email, paid social, SMS, partner form — and change their language. The cold start recomputes from the metro's median home value at 80% loan-to-value. The centre becomes a bank: rates, cards, eligibility.

**Tell it like this:** I changed what we sell. Watch what did not change: eight bars, in the same eight places, relabelled. Category became product family. Taste became life stage. Colour became card tier. Journey stage became application stage. The same four kinds of surface on the left, now speaking a bank's language. The centre you would not recognise — a bank does not merchandise, it makes offers and asks you to apply, so the page renders as rates and cards and eligibility, and the cold start now opens on a thirty-year fixed, sized from the metro's real median home value at eighty percent loan-to-value. One engine. Your front end paints it. Half this room sells credit, not coats — you already know this customer; you just do not know him in this vocabulary yet.

**⚠️ The caution (from the script):** The episode trail CLEARS on the flip — the vector is rebuilt under the new registry, which is the honest thing to do when the dimension keys change. Do not say "same trail". The continuity is the instrument and the surface *kinds*, not the history.

**The simple math:** Same eight dimension shapes, same thresholds, same decay structure — six of the eight even read the same field on the record. Only the vocabulary swaps. That is what catalogue-agnostic means when it is structural rather than a slide.

**If they ask:**
- *"Is it really the same engine, or a second demo?"* — Same engine, same tuning, same code path — the registry of dimension names is data. The proof is on the instrument: the bars did not re-sort, because there was nothing to re-sort.
- *"Why did her history vanish?"* — Because pretending a retail click history describes a mortgage shopper would be a lie, and this demo does not tell those. The dimension keys changed, so the vector rebuilt — profiles are kept per business, honestly separate.

## Act 3 · The Operator — 8:00 · Opal and experimentation

The room stops being shoppers and becomes operators. The theme is bounded AI: the model proposes inside structures it cannot escape, a person publishes, and every experiment is a real object in the real project. Acts 3–5 run in retail — beat 30 flips the store back.

### Beat 30 · Opal proposes (Act 3 · 1:10 planned)

**You press:** Next — the director first flips the store back to Calder & Co. (say one word about it: "back to retail for the rest"), then opens Ask Opal. Ask for an audience in plain English — the suggestion chips are there so a beat never starts with typing.

**The room sees:** A real audience definition appears, its rule legible, built from the live dimension registry — in merchandising language.

**Tell it like this:** That was a real model call, just now, against your own vocabulary. Here is the part that matters for everyone who has been burned by AI demos: it *cannot invent a dimension*. The schema it answers into is built from the live registry — the same eight dimensions you have been watching all session — so an invented dimension is rejected at the boundary before it ever reaches our code. It can only speak your catalogue's language. And notice the second thing: it *proposed*. It did not publish.

**If they ask:**
- *"Which model, and where does it run?"* — A live model call — the label on this beat is LIVE, US-only: the call is served from US infrastructure. The model's freedom is the sentence; the structure it must answer into is ours.
- *"What happens if it tries to invent something?"* — The schema rejects it before it reaches the application — structurally, not by hoping the prompt behaves. That is the pattern across everything AI does in this session: bounded by construction, not by promise.

### Beat 31 · A person decides (Act 3 · 0:50 planned)

**You press:** Click **Publish** — by hand, deliberately. This one is yours, not the cursor's.

**The room sees:** The audience goes live. The page can now target it.

**Tell it like this:** That is the governance beat of the whole session. The machine proposes; a person decides; and both halves are on the record with a name and a timestamp. When your compliance team asks who created an audience and when — and they will ask — the answer is a record, not an archaeology project.

**If they ask:**
- *"Could we allow auto-publish?"* — The separation is the design: propose and publish are two different calls on purpose. Where you draw your own line is policy; the system's default posture is that activation is a human act, on the record.

### Beat 32 · It cannot invent a scene (Act 3 · 1:15 planned)

**You press:** Next opens AI search — *ask in words*. Type a request, or use a chip.

**The room sees:** A curated scene behind real, engine-ranked products, our copy, and a provenance line saying what did what.

**Tell it like this:** Natural-language search, with the same discipline. The model's only job is routing that sentence to one of eight approved scenes — it cannot invent a scene, because the answer format is a closed list. And it does not pick the products either: the deterministic engine you have watched all session still ranks those, blending what she asked for with what she has shown us. The words are understood by a model; the merchandise is decided by arithmetic; the page says which did which.

**If they ask:**
- *"Is that backdrop generated live?"* — No — the scenes were generated once, at design time, and reviewed by a human before they shipped. Nothing visual is created on stage, which is why nothing visual can go wrong on stage.
- *"What does the model actually decide?"* — The intent: category, occasion, price ceiling — read from the sentence against your live vocabulary. Then it hands over. Reading is the model's job; ranking is the engine's.

### Beat 33 · A stylist that cannot oversell (Act 3 · 1:15 planned)

**You press:** Next opens the style concierge. Ask for a look. Then correct it. Then ask for something Calder does not sell. Budget for all three turns — the second is the point.

**The room sees:** A styled look of real catalogue pieces with real advice. The refinement repeats nothing from the first answer. The refusal names exactly what is missing.

**Tell it like this:** A stylist, not a list. Watch the three behaviours. It builds a look from real pieces — every item id it can even *utter* is bound to your live catalogue. Correct it, and it repeats nothing — because everything already shown is removed from its vocabulary before it answers, so repeating itself is not something it is asked politely to avoid, it is something it cannot represent. And ask for something you do not carry — it says so, plainly, and styles honestly around the gap instead of substituting something quietly and hoping. An AI that can say "we do not sell that" is an AI your brand can put in front of customers.

**If they ask:**
- *"How do you stop it hallucinating products?"* — Structurally: the id list it answers from is built from the live catalogue at that moment, minus what it has shown. A fake SKU is not discouraged — it is unrepresentable. That is the difference between prompt engineering and engineering.

### Beat 34 · The product is real, the scene is styling (Act 3 · 0:45 planned)

**You press:** Nothing — point at the editorial hero. Unhurried and plain.

**The room sees:** The real product, composed onto an approved still. The caption on screen says exactly that.

**Tell it like this:** Before anyone asks — that image. The bag is your real product, the real packshot. The scene around it is styling: composed onto a still that was approved in advance, not generated. And the caption on the screen says so, in front of your customers, because the honesty is not a footnote in my deck — it ships on the page.

**If they ask:**
- *"Why not generate imagery live? Everyone else does."* — Because your brand team approved every pixel that can appear, and that guarantee is worth more than the party trick. Live generation puts an unreviewed image on a brand surface; we chose the version of this that survives your brand review.

### Beat 35 · A real experiment, thirty seconds ago (Act 3 · 1:20 planned)

**You press:** Next dispatches the A/B. Then open the Optimizely console in the other tab and show it sitting there. Allow for the tab switch and the load — the beat's length budgets for it.

**The room sees:** A real flag, a real rule, 50/50 — and then the same object in the real Optimizely project.

**Tell it like this:** We just created an experiment — a real flag and a real rule, fifty-fifty, in the real project. Not a mock. Not a screenshot. That is your console, and it was created while I was talking. Every press of that button creates a *new* rule, so "created just now" is always literally true — you can watch the API's own elapsed seconds while it happens.

**If they ask:**
- *"Is that a demo org?"* — It is a real Optimizely project with writes enabled, and the card badges its own status honestly — live and created now, or writes off, or refused — never dressed up. On your rollout it is your project and your credentials.

### Beat 36 · Bandits — real rules, honest readouts (Act 3 · 1:25 planned)

**You press:** Next creates the MAB, waits, then the CMAB. Point at three things: the badge, the flag and rule ids, and the word REPRESENTATIVE.

**The room sees:** Two cards: a `multi_armed_bandit` rule and a `contextual_multi_armed_bandit` rule in the real project, each with its ids and an *Open it now* link. The allocation figures and per-context winners labelled representative.

**Tell it like this:** Two bandits — a multi-armed bandit that hunts the winning variant, and a contextual one that finds a *different* winner per kind of visitor. Both rules are real, both are in your project right now — open them. And here is what I will not do: I will not pretend this room is traffic. A bandit's allocation curve comes from thousands of real sessions, and you have thirty people and fifty minutes — so the movement you see on this card is representative, and it says so on the line where it is shown. The rule is the product. The traffic is yours.

**The simple math:** A bandit shifts traffic toward whichever variant is winning, continuously, instead of waiting for the test to end. The contextual one learns a winner per context — device, channel, band — instead of one winner for everyone.

**If they ask:**
- *"So what's real here, precisely?"* — The label is the answer: rules REAL — created in the project, with ids, open them now — readouts REPRESENTATIVE, labelled on every line. When it runs on your traffic, the readouts are real because the traffic is.
- *"Dynamic Yield has predictive targeting that finds winning audiences for us."* — It genuinely does, and it is well liked — cards that spot an audience with a different winner and deploy in a click. Two honest differences: their opportunity engine runs inside their reporting on their model's terms; this creates the experiment as an object in *your* project, on your metrics, where your team already governs everything else. And when we show you a number we could not have earned in this room, it is labelled — that discipline is the product.

## Act 4 · The Business — 4:00 · Revenue Radar

From shopper to P&L. One filter, one collapse, one fix proved in the room, and then the rows handed over. This is the act for every head of ecommerce present.

### Beat 37 · The average lied (Act 4 · 1:50 planned · ⏸ THE BIGGEST WOW — SLOW RIGHT DOWN)

**You press:** Next opens Revenue Radar on everyone. Let the room see the funnel looking *ordinary* — that pause is the beat. Then the Gen-Z filter.

**The room sees:** Blended: the payment step looks like an ordinary week. Filtered to Gen-Z: it collapses ~44% at the payment step, flagged, with the recoverable amount computed term by term on screen.

**Tell it like this:** Across all customers, this checkout looks fine — that is the number sitting in your weekly report right now, and it is telling you everything is fine. Filter to Gen-Z. It collapses — forty-four percent gone at the payment step. About seven and a half thousand dollars, this window, walking out the door — and look at how that number is built: computed from the rows, term by term, in front of you. Not typed into a slide. The average lied — not because anyone lied, but because a severe failure inside a slice of your traffic moves the blended number by a rounding error. Every one of you has a number like this hiding under an average that looks fine.

**The simple math:** Recoverable money is anchored on the *excess* drop only — the part worse than an ordinary checkout's ordinary loss — times the sessions it cost, times the average order, times a conservative recovery fraction. You cannot recover the ordinary drop; you can recover the anomaly.

**If they ask:**
- *"Did you hardcode the 44%?"* — No — and this is the honesty split for the whole act: the traffic is simulated, the compute is live. The sessions carry attributes; one step carries a failure model; every rate you see is aggregated from the rows on each request. Pick a cohort we never rehearsed and the arithmetic runs the same. What I will never claim is that these are your production numbers — the label says compute LIVE, traffic SIMULATED.
- *"Our BI could find this."* — It could, with an analyst, a query, and a ticket queue. The point is not the finding — it is what happens on the next press: the finding becomes a targeted, running experiment without leaving the screen.

### Beat 38 · Launch the fix — and prove it in the room (Act 4 · 1:20 planned)

**You press:** Next launches the fix, the funnel recovers on screen, then the checkout opens. Four things land; give each its second.

**The room sees:** A real audience id and a real experiment, targeted at the diagnosed cohort · the payment bar climbing back, in green, with the fix applied · then the checkout's payment step, now showing Pay in 4 with social proof.

**Tell it like this:** It found the leak. It built the fix — installments and social proof at the payment step, aimed at the exact audience it diagnosed. It launched a real experiment, targeted at a real audience, both in your project. The funnel recovered on screen. And here is the part I refuse to leave abstract — this is that shopper's payment step, right now: Pay in 4, social proof, served by that experiment, in this session. Diagnose, decide, activate, prove — one screen, no engineer, no analyst, no quarter-end readout.

**If they ask:**
- *"Is the recovery real?"* — The label, proudly: audience and flag LIVE, in-session fix LIVE — the checkout you just saw was served by the real flag. The recovery curve is REPRESENTATIVE, because recovering revenue requires shoppers, and it is the same rows re-run with the defect lifted — the same arithmetic, not a second dataset drawn to look better.
- *"Who approved that going live?"* — On stage, I did — the launch is a press. In your shop it is your workflow: the fix arrives as an experiment in your project, subject to whatever approval your team already runs there.

### Beat 39 · We hand you the rows (Act 4 · 0:50 planned)

**You press:** Next exports the receipts.

**The room sees:** Warehouse rows: gates, scores, rank, tie-break hash, config version — every decision of the session, as data.

**Tell it like this:** Last thing in this act, and it is the posture behind everything you have seen: we hand you the rows. Every decision this engine made today — what was gated, what scored what, what ranked where, which config version did it, down to the tie-break — exported to your warehouse, yours. You compute the lift, in your own analytics, on your own definitions. We will never present our own uplift number as the proof of our own product. If a vendor grades their own homework, the grade is marketing.

**If they ask:**
- *"What would we actually do with these?"* — Join them to your orders and sessions and measure everything independently: lift by audience, by slot, by config version. The tie-break hash means even coin-flips are reproducible. It is an audit trail designed to be audited.

## Act 5 · The Moment — 3:00 · signal to live creative

The closing arc: a trend signal becomes live, optimizing creative inside its own window. The honesty label leads, because it must.

### Beat 40 · A signal we did not generate (Act 5 · 0:35 planned)

**You press:** Nothing — point at the detection chip.

**The room sees:** SIMULATED · partner social-listening layer, not Optimizely.

**Tell it like this:** A product just spiked on social. This part — the detection — is simulated, and it is labelled on screen, because we do not ship social listening and I am not going to pretend we do. In production that chip is your social-listening partner's webhook. Everything after that chip is ours, and it is live. I put the label first so that when the next thirty seconds impress you, you know exactly which parts earned it.

**If they ask:**
- *"So what fires this in real life?"* — Any signal source you already pay for — social listening, trend detection, even your own analytics anomaly alerts. The contract is a webhook; the loop from signal to shipped experience is what you are about to watch, and that part is real.

### Beat 41 · Opal writes the moment (Act 5 · 0:45 planned)

**You press:** Next triggers the moment. Talk *across* the elapsed counter — it takes about eight seconds, and the room should be watching the clock, not you.

**The room sees:** An elapsed counter running while Opal reads the signal and writes the creative.

**Tell it like this:** Reading the signal, writing the moment — copy written live, right now, composed onto artwork your brand approved in advance. Watch the clock, not me. … Eight seconds. Your current process for "a product is going viral, react" is a war room and a purchase order. This was eight seconds, and nothing unreviewed touched the page — the words are new, the canvas was approved before today.

**If they ask:**
- *"The image too?"* — The copy is written live; the scene is an approved still, never generated on stage — same discipline as the concierge. New words, pre-approved canvas, and the page says so.

### Beat 42 · It ships as a real bandit — and the loop closes (Act 5 · 0:50 planned)

**You press:** Next — six minutes pass in three consented steps, and the bandit moves one round per step. Read the card as the traffic shifts.

**The room sees:** The experiment card: a real `multi_armed_bandit` rule with its flag and rule ids · the 28:00 window · traffic 50/50 → 40/60 → 27/73 → 20/80 · *"Loop closed in ≈6:00 of 28:00 — winner promoted automatically."*

**Tell it like this:** That creative did not ship as a banner — it shipped as a bandit. The rule is real: open Optimizely and it is sitting there, created moments ago. The traffic is not — nobody in this room is buying, so the allocation you are watching is representative and it says so on the card. But read what the loop means: signal, creative, live optimizing experience, winner promoted — all inside the window, before the moment cooled. Trends have a half-life; this is the machine that moves inside it. And the governance line, plainly: today a human still presses Launch. Autonomy is roadmap, and I will not sell you roadmap as product.

**If they ask:**
- *"What's real on this card?"* — The label, line by line: rule REAL, copy REAL, allocation REPRESENTATIVE, signal SIMULATED. Four claims, four labels, all on screen while they happen. That split is the demo's whole character in one card.

### Beat 43 · What I did not show you (Act 5 · 0:50 planned)

**You press:** Nothing. Deliver it straight, and do not rush it to save time — this beat is what makes the other forty-two credible.

**The room sees:** You.

**Tell it like this:** Let me close on what I did not show you. I did not show you a lift chart, a reallocation curve, or a per-context winner — because this room did not generate the traffic those numbers need, and a number without its traffic is a decoration. I did not show you social listening, because we do not ship it. Everything else you watched this afternoon was running — real engine, real audiences, real experiments in a real project — and the parts that were simulated told you so on screen, while they were doing it. That is the standard I would ask you to hold every vendor to, including us. Questions.

**If they ask:** This beat *is* the answer. Then stop talking — the act budget leaves five minutes for questions, and the note in the run of show says: leave the silence; do not fill it.

## Questions — 5:00

No beats here by design. The run-of-show note, verbatim: *"Leave it. Do not fill the silence."* The ten answers you will need are in §4. If nobody speaks for ten seconds, that is the room thinking, not the room bored — hold.

---

## 4 · The hard-question bank — the ten toughest, with model answers

Study these last, out loud. Each answer concedes what deserves conceding, then claims what is ours.

**1. "How is this different from just counting three clicks?"**
The full model answer is in §2 above — learn it word-shaped, not word-for-word. The skeleton: decay per dimension on its own clock · weighted kinds of evidence (a declaration outweighs a click and still decays) · thresholds with hysteresis so audiences do not flap · eight dimensions in parallel, the eighth read from the verb · the arithmetic printed beside every decision, refusals included · and the merchandiser outranks all of it. Close: "Three clicks is the entry fee. The mechanism is what happens to them over the next two minutes — and you watched them decay."

**2. "How is this different from Dynamic Yield?"**
Concede: pioneer, Gartner leader, real cold-start product, published classic affinity math, well-liked predictive targeting. Claim, in four: your own receipts against their rented aggregate average · glass-box arithmetic with your hands on the dials, against an ML tier their own docs call "agnostic to how the profile is calculated" and weights tuned via their Customer Success Manager · audiences that are *left* by arithmetic, live, with the exit number printed — against reports updated once a day · real experiments in your own project plus the exported rows, against a platform that grades its own homework. Never sneer — the concession is what makes the claim land.

**3. "Where does the data live?"**
The visitor's profile lives per visitor at the edge — the same hop that serves the page — and expires on the honest clocks you watched. The census is public data, cited with vintage. The cohort receipts are representative rows today; in production the identical query runs against your warehouse — a configuration swap, not a build. Decision receipts export to your warehouse. ODP is wired but deliberately dormant on this surface: connect it and the profile becomes durable across devices and shareable with your stack — a credential, not a code change. Nothing is bought from a third party, and nothing about an individual leaves your ownership.

**4. "What exactly is simulated?"**
Answer proudly, and itemise: the social-listening *signal* (labelled on screen — we do not ship social listening) · the Radar's *traffic* (sessions are generated; every rate computed from them live, on each request) · bandit *allocations* and readout figures (labelled representative — this room is not traffic) · the cohort's *first-party rows* (representative until your warehouse is behind the same query). Everything else ran live: the engine, the audiences, the page decisions, the model calls, the experiments — real objects in the real project, opened in the console mid-session. And the parts that were simulated said so on screen while they were doing it.

**5. "Isn't geographic personalization redlining?"**
The bright lines, verbatim: we **curate, never price** — never a price, a discount, access, or anything touching credit or eligibility from the geo signal. **Aggregate, never the individual** — the census describes her neighbourhood, and we never claim it describes her. **No protected classes, ever** — affluence and first-party purchase signals only, never a ZIP as a proxy for race or any protected class. It is additive — no neighbourhood is down-ranked. And it is the *opening hypothesis only*: her first real act starts outweighing it. That set of lines is designed to survive your counsel's review, and we would rather lose a feature than cross one.

**6. "Can my merchandiser override it?"**
Yes — with declared precedence, not a support ticket: gates decide what can show, pins outrank ranking, ranking runs in the space left. You watched the pin ("pinned · ranking skipped", on the record) and the refusal — the engine declining its own highest-scoring item because a rule said no, keeping the score to show what it gave up. The audiences are minted in your catalogue's own language, the audience priority list is yours to reorder, and the tuning dials are on the panel. The machine proposes and ranks; your people outrank; the record shows both.

**7. "What happens when she comes back tomorrow?"**
On this demo — beat 28 — she comes back and the profile is there: held per visitor at the edge, no login, no cookie sync, nothing downloaded. On the production clocks, the same decay runs in days and weeks instead of minutes — so tomorrow her taste is intact, her "which aisle" has honestly faded, and anything below threshold has released her. That asymmetry is the design: the perishable parts perish, the durable parts endure. Cross-device and cross-channel durability is the ODP connection — wired, dormant today, a credential away.

**8. "How fast is it really?"**
Point at the badge, not a slide: the decision time is measured on stage, per event, and that is the only number I will quote. Structurally: the decision runs at the network hop that already served the page — no second trip, no overnight segment build, nothing downloaded to the browser. Anything that syncs onward to other systems is a separate job on a separate clock, and we say which is which. (Never quote a rounder number than the badge shows — the discipline is the credibility.)

**9. "What would rollout actually take?"**
Three honest workstreams, no magic: **your catalogue into the registry** — the eight dimension shapes are data; you watched one engine wear a retailer's and a bank's vocabulary without re-sorting a bar. **Your warehouse behind the cold start** — the query is already the production query; the swap is configuration. **Your Optimizely project for the experiments** — the demo already writes to a real project; yours is credentials. The engine's tuning is config, versioned, not a redeploy. What I will not do is quote a number of weeks from this stage — that is a scoping conversation, and pretending otherwise is how vendors earn distrust.

**10. "Why should I believe the lift numbers?"**
You should not — and I did not show you any as proof. Every figure this session that needed traffic we did not have was labelled representative on the screen where it appeared, and I closed by telling you exactly what I did not show: no lift chart, no reallocation curve, no per-context winner, because this room did not generate the traffic those need. What is real and yours to run: the rules, in your project, and the decision rows, in your warehouse — you compute the lift on your own traffic, in your own analytics, against your own definitions. A vendor's uplift number is marketing. Your warehouse's uplift number is evidence. We built for the second one.

---

*Built 2026-08-29 from `public/meridian/beats.js` (43 beats, act budgets verified: 4/6/20/8/4/3 + 5 Q&A = 50:00, beat durations sum exactly), the engine sources (`src/reflex/core.ts`, `src/demos/meridian/reflexConfig.ts`, `composer.ts`, `geoCohort.ts`, `funnel.ts`, `experiment.ts`), the Opticon docs (Talk-Track · Controls-Guide · Abstract-Coverage · Task-List), doc 13, the Revenue Radar explainer, and Dynamic Yield/Mastercard pages fetched 2026-08-29 (URLs inline in §2). The `real:` lines in beats.js are the law of this document; if beats.js changes, regenerate the talk track and re-check this companion against it.*
