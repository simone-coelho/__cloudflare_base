# Opticon NYC — Run of Show (v2)

**45 minutes · ~30 customers · online retailers (bags, apparel, luxury, department stores) plus banks and financial institutions · CEO-led**

**This is the design. Build status lives in `Opticon-Task-List.md` — the Real? column below states the TARGET state, not what is finished today.**

**Honesty legend.** **LIVE** — running and verified · **GATED** — built, enabled by credentials we hold · **REPRESENTATIVE** — real mechanism, illustrative numbers, said out loud · **SIMULATED** — labelled on screen. Never present a simulated thing as live. Nothing in the UI says "fake"; simulated stages carry a mandatory chip.

---

## The thesis

Every personalization demo ever given starts with someone clicking around a website. That is the least interesting third of the problem, and it is the only third most vendors can show.

**The interesting part happens before they arrive.** She opens an email in Gmail. She taps an ad on TikTok. She signs up by text. She fills a form on a partner site. By the time she lands, a real system already knows why she came — and the page answers it before she has clicked anything at all.

So this session runs **outside-in**: the ecosystem first, the page second, the engine third.

**And then the hinge.** The campaign said handbags. She starts looking at wallets. **The page has to decide who to believe** — the marketer who bought the click, or the person who is on the site right now. Watching that handoff happen, live, is the single most important thing in this session. No backend job runs. No segment rebuilds overnight. No profile downloads. It happens over an open connection while she is still on the page.

The email is one capability. The handoff is the argument.

---

## The screen

Three panels. They reserve width; nothing overlays the page.

| | | |
|---|---|---|
| **LEFT — the rest of the world** | The surfaces that are not your website: an **inbox**, a **phone**, an **ad**, a **form**. The presenter acts here. | Off-site cause. |
| **CENTRE — the page** | A hero (large, simple, dominant), one framed sort zone, one content block. Quiet furniture around them so it reads as a real public site. | On-site effect. |
| **RIGHT — what we know** | Six affinity bars with the hysteresis band drawn, one plain-English sentence at a time, Glass Box collapsed beneath. | The reasoning. |

**Episodes, not events.** Every cause produces **one grouped card**, never a running log:

```
┌──────────────────────────────────────────┐
│ EMAIL · "The Autumn Edit is here"        │
│ ─────────────────────────────────────    │
│  opened      →  pixel fired              │
│  identity    →  resolved · known visitor │
│  landed      →  hero answered the email  │
└──────────────────────────────────────────┘
```

**Two change zones only.** The hero, and the sort row. Everything else stays still, so when one moves the room knows exactly where to look.

**The sort row** is one tight horizontal band of five compact cards, each with a distinct colour edge and a colour-matched rank chip. One axis of movement. You watch the coral card travel past the teal one. A 3×2 grid of large similar cards reshuffling is illegible, which is the defect in the demo we already have.

---

## Arc

| Act | Content | Min |
|---|---|---|
| 0 | The frame | 4 |
| 1 | **The Arrival** — the ecosystem | 6 |
| 2 | **The Handoff & The Session** — the engine, and the flip | 15 |
| 3 | **The Operator** — Opal and experimentation | 8 |
| 4 | **The Business** | 4 |
| 5 | **The Moment** | 3 |
| — | Q&A | 5 |

---

## ACT 0 — The frame · 4 min · slides

1. Most of your traffic is unidentified and most of it has never been seen before. Every personalization system in this room reaches the identified minority.
2. The edge is not a datacentre your request travels to. It is the same network hop that already served the page.
3. Your merchandisers still outrank the machine. Rules decide what *can* show; the engine decides what *does* show in the space left, and it shows its receipts.

---

## ACT 1 — The Arrival · 6 min

*The room has never seen this act in a personalization demo. But keep it moving — it sets up Act 2, it is not the point.*

| # | Cap | Do | See | Say | Real? |
|---|---|---|---|---|---|
| 1 | C1 | **Open an email** in the inbox on the left. | Episode card forms: opened → pixel fired → captured. The page loads and **the hero already answers the email.** | *"She opened that in Gmail. Not on your site. The pixel fired, we captured it, and by the time she arrived the page had already answered it. She has not clicked a single thing here."* | LIVE |
| 2 | C3 | **Click the ad.** | UTM lands, the episode names the campaign, the hero picks up its promise rather than a generic welcome. | *"Your media team spent money to make that click happen. Most sites then show the same homepage they show everyone."* | LIVE |
| 3 | C2 · C4 | **Sign up by text, then submit the form.** | Identity resolves; declared interest joins observed behaviour. | *"Different surfaces, same profile — and she never typed an email address into your site. Now we have what she told us and what she did. The engine keeps those apart."* | LIVE |
| 4 | C5 | Point at the episode stack. | Four surfaces, one profile. | *"Four systems that in most stacks hold four different views of this person. One profile, resolved at the edge — and every one of those is first-party data you already own."* | LIVE |
| 5 | C6 · C7 | — | Cold-start panel: region off the connection, published census, the derivation. Profile mints, `no PII captured`. | *"And for the ones who arrive with none of the above — region off the connection, income from published census, opening price band is arithmetic over the two. No tracker, no third-party data, no consent wall."* | Geo **LIVE** · census **LIVE public** · cohort **REPRESENTATIVE** |

---

## ACT 2 — The Handoff & The Session · 15 min

### The handoff — the hinge of the whole session

| # | Cap | Do | See | Say | Real? |
|---|---|---|---|---|---|
| 6 | C35 | **Browse away from the campaign.** She arrived on handbags; click a wallet, another wallet, a dress. | The bars shift off the arrival category. **The hero stops being about the campaign** and becomes about what she is doing. The episode card closes itself: `campaign context superseded by observed behaviour · 00:41`. | ***Stop. This is the most important sixty seconds in the session.*** *"The email said handbags. The ad said handbags. She is looking at wallets. Watch what the page decides to believe."* Then, once it has turned: *"The campaign did not have to be wrong for that to matter. She simply moved on, and the page moved with her."* | LIVE |
| 7 | C36 | Point at the latency badge. | The measured decision time, on screen, updating per event. | *"No backend job ran. No segment rebuilt overnight. No profile downloaded to this browser. That happened over a connection that was already open, while she was still on the page — and that number is measured, not a slide."* | LIVE |

### The session

| # | Cap | Do | See | Say | Real? |
|---|---|---|---|---|---|
| 8 | C14 | **Show the sort row untouched.** | Standard order, identical for everyone. | ***The control. Do not skip it.*** *"This is the order every shopper sees. Remember it — everything after this is measured against it."* | LIVE |
| 9 | C8 | Click two items. | Bars move at different rates. | *"Six things about her, each with its own memory. Taste moves slowly; what she is looking at right now moves fast."* | LIVE |
| 10 | C9 | Click a third. | A bar crosses θin, goes green, a chip appears. | ***Slow down.*** *"It waited until it was sure. That shaded band is the gap between entering and leaving — it is why she will not flicker in and out."* | LIVE |
| 11 | C15 | — | **The row re-ranks.** Cards travel; rank chips count; only the movers are ringed. | *"Watch the coral one climb from five to one."* | LIVE |
| 12 | C16 | — | The hero commits. | *"It only claims her when it can support the claim."* | LIVE |
| 13 | C17 | Point below. | **The content block changes** — full width, slow, structural. | *"Not what is inside the box. Which box comes first. One profile decides the merchandising and the storytelling, so they agree with each other."* | LIVE |
| 14 | C18 | Open an item. | A module assembles that was not there. | *"The page gained a section, not just different contents."* | LIVE |
| 15 | C11 | Open the audience list. | Audiences named in the catalogue's own words. | *"Nobody wrote these. They are minted from your catalogue, in your merchandising language."* | LIVE |
| 16 | C19 | Toggle a merchandiser pin. | Hero locks for everyone; explain reads `pinned · ranking skipped`. | *"Declared precedence — gates, then pins, then ranking. Your merchandiser outranks the machine and the machine says so."* | LIVE |
| 17 | C20 | Open the explain on an excluded item. | Highest score, refused, rule named. | ***Slow down.*** *"That is the engine declining a click it would have won. Showing you the refusal is worth more than showing you the win."* | LIVE |
| 18 | C10 | **Stop touching it. Talk for 90 seconds.** | Three separate retreats — the row stops claiming, then the hero, then the block. Each names its dimension and number. | ***The beat nobody else has.*** *"Everyone demonstrates joining an audience. Watch her leave one. And it does not collapse at once — the hero goes first, on category. Then the row, on price band. Taste goes last, because taste is the slowest thing about anyone."* **Measured at human pace: 28s / 64s / 74s.** | LIVE |
| 19 | C12 | **Come back later** — same visitor, new session. | The profile is restored: dimensions, audiences, a personalized hero. | *"She closed the tab and came back. No login, no cookie sync, nothing downloaded — the profile was held per visitor at the edge."* ⚠️ **Do not say "ODP is the memory" on this beat.** ODP is deliberately not connected on this surface (surface-scoped credentials, so we never write into another demo's instance). The honest follow-on if asked: *"Connect ODP and this becomes durable across devices and shareable with the rest of your stack — that is a credential, not a code change."* | Edge memory **LIVE** · ODP **wired-dormant** |
| 20 | **C34** | **Switch the business.** | **Eight bars hold their places and re-label; the four surface KINDS hold and re-vocabularise.** Centre and right re-vocabularise. Cold start recomputes from median home value at 80% LTV. | ***The strongest line in the session.*** *"Same person. Same four surfaces. Same trail. I changed what we sell. You already know this customer — you just don't know him in this vocabulary yet."* | LIVE |

---

## ACT 3 — The Operator · 8 min

| # | Cap | Do | See | Say | Real? |
|---|---|---|---|---|---|
| 21 | C21 | Ask Opal in plain English. | A real audience definition, its rule legible. | *"A real model call against your own data — and it proposed, it did not publish."* | LIVE (US-only) |
| 22 | C21 | Click Publish. | It goes live; the page can target it. | *"The governance beat. The machine proposes, a person decides, both are on the record with a name and a timestamp."* | GATED — enabled |
| 23 | C22 | Type a request. | Curated scene, our copy, engine-ranked products, provenance line. | *"The model's only job is routing that sentence to one of eight approved scenes. It cannot invent one — the schema is an enum. And it does not pick the products."* | LIVE |
| 24 | C23 | Ask for a look. | Streaming stylist, real catalogue IDs. | *"It can only recommend things you actually sell."* | LIVE |
| 25 | C24 | — | Editorial hero of the real product. | *"The bag is your real product. The scene around it is styling, and the caption says so."* | LIVE |
| 26 | C25 | Dispatch. | Real flag, real rule, 50/50. **Open Optimizely and show it.** | *"Created in the real project, thirty seconds ago."* | LIVE |
| 27 | C26/27 | Dispatch. | MAB and CMAB rules, in Optimizely, with their attributes. | *"Both real, both in your project. What I will not do is show you a reallocation chart or a per-context winner, because those need traffic and this room will not generate any in forty-five minutes."* | LIVE rules |

---

## ACT 4 — The Business · 4 min

| # | Cap | Do | See | Say | Real? |
|---|---|---|---|---|---|
| 28 | C28 | Filter to one cohort. | A payment-step collapse the all-average had hidden. | ***The single biggest wow. Slow right down.*** *"The average lied. The cohort told the truth."* | Compute **LIVE** · traffic **SIMULATED** |
| 29 | C29 | Launch the fix. | Recoverable figure, named remedy, real audience, real experiment id. | *"Diagnosis, audience and experiment are real. The lift figure is representative — you will compute yours from your own rows."* | Audience/flag **LIVE** · lift **REPRESENTATIVE** |
| 30 | C30 | Export. | Warehouse rows: gates, scores, rank, tie-break hash, config version. | *"We hand you the rows. You compute the lift. We will never present our own uplift number as the proof."* | LIVE |

---

## ACT 5 — The Moment · 3 min

| # | Cap | See | Say | Real? |
|---|---|---|---|---|
| 31 | C31 | Chip: `SIMULATED · partner social-listening layer, not Optimizely`. | *"This part is simulated and labelled, because we do not ship social listening. Everything after it is ours."* | SIMULATED, labelled |
| 32 | C31 | Opal writes the copy, elapsed counter running. | *"Reading the signal, writing the moment."* | LIVE |
| 33 | C31 | Hero generates — shimmer, then a real editorial hero. | *"About eight seconds. Talk across it."* | LIVE |
| 34 | C31 | Full-bleed takeover; loop closed in M:SS. | *"Signal to live creative, in the time we have been talking."* | LIVE |

**Close.** *"Everything you saw was decided from behaviour she generated on four surfaces, for someone who never told us who she was. Every decision carried its reasons. Your merchandisers still outrank it. And it withdraws its claims when it can no longer support them — that last part is what I would judge a system on."*

---

## Held in reserve

Run if the room is fast or a question opens the door: **the style quiz** (C32 — four taps, zero-party, no account), **a reflex moment** (C33 — a white-glove offer that arrives, ticks, and ends with its reason named), **season cold start** (force a hemisphere, the edit inverts on the same date).

## What we will not show

No bandit reallocation chart. No CMAB lift matrix. No uplift number of ours as proof. No claim of proven lift on anyone's production traffic.

**Rehearse this sentence:** *"The rule is real and it lives in Optimizely. What we show you here is a representative view of how it allocates — we are not going to fabricate live traffic in a demo."*

## Pacing

Click briskly — one every 5–8 seconds; the memory fades fast on purpose. Between beats there is a deliberate pause; that is your talking time. **Your job is not to describe what is on screen. Your job is to say what it means to them.**
