# Coach — Conversation Guide (Mandeep, tomorrow)

*Simone's live cheat sheet. Quick-lookup — glance, don't read. Deeper pre-read: [Field Brief](./Coach-Component-Personalization-Field-Brief.md) · [AI-forward architecture (doc 14)](./architecture/14-architecture-and-optimizely-capability-map.md) · [Edge composition design (doc 15)](./architecture/15-edge-composition-design.md).*

---

## At a glance

- **Goal in the room:** land that we can give him **governed, deterministic page composition at the edge** — assemble *approved* components per shopper, fast, no AI inventing pages.
- **Open with (20 sec):** *"You're describing personalizing the page **composition** — which approved building blocks show, and in what order, per shopper — not the products inside them. That's a governed decisioning problem, and it's exactly where our edge fits. AI helps **design** the blocks; it doesn't run the page."*
- **⚠️ The one thing to get right:** lead with **governed, deterministic assembly** — NOT "AI builds your page."

---

## ⚠️ Do / Don't (the biggest landmine)

| ❌ Don't say | ✅ Say instead |
|---|---|
| "Our AI generates the experience / builds the page." | "The engine assembles **your approved** components by rule + live affinity, at the edge, in milliseconds." |
| "It learns and recommends layouts." | "It **resolves** a layout deterministically from approved pieces; optimization is optional, on top." |
| "AI decides what the shopper sees." | "AI is a **design-time** helper to propose components a human approves; runtime is pure decisioning." |

*Why: he's headless + governance-first + performance-first. "AI invents pages" triggers every fear he raised on the onsite.*

---

## Ask these first (pin his intent before you propose)

1. When you say **"recommend components,"** do you mean — (a) fill recs modules with products, (b) pick the best content per slot, or (c) **choose & order the modules themselves**? *(You expect c.)*
2. Is the PDP a **fixed template with swappable slots**, or fully re-orderable — and which slots are **locked** (buy box, legal, size)?
3. What **business goal** does the ordering optimize — conversion, AOV, discovery, engagement?
4. Who **authors & approves** compositions — merchandising, brand, or engineering?
5. Where does the page **get composed** — your edge/SSR, Next middleware, or our Worker in front?
6. Where do **approved components live today** — your CMS, or open to Optimizely CMS?

---

## Watch-outs

- **Vocabulary drift** — "recommend" makes people hear *ML recs*. Reframe to **resolve / assemble**. (In HD Supply's build this needed its own top section.)
- **Determinism vs. optimization** — he may want *pure deterministic, no ML*. Don't force the bandit. Offer **deterministic core, optimization optional.**
- **"Never fill a slot with junk"** — no match → **explicit fallback**, never a random arrangement. Say it as a guarantee.
- **Valid layouts only** — required slots present, brand rules honored → **fail closed.**
- **Performance** — small JSON of IDs, edge-cached, **no AI in the render path**, resolvable before SSR (no flash/CLS).
- **Customer names** — reference HD Supply as *"another enterprise we built this for,"* not chapter-and-verse.

---

## Our POV / talk track (how we'd do it)

**The split:** Optimizely is the **brain** (governance + science); the **edge is the runtime** (fast, 1:1, render). We snapshot Optimizely's outputs to the edge → **no live dependency; an outage never takes the store down.**

- **We'd use (Optimizely):** **ODP** (who the shopper is) · **Feature Experimentation** (governed rules + which blocks are allowed) · **CMAB** (auto-optimize which layout wins).
- **We'd build:** the **edge engine** that assembles approved blocks per shopper and hands the site a **manifest** to render.
- **Content home:** their CMS *or* Optimizely CMS — **their choice.** It's the one pluggable piece; everything else is required.
- **Two modes, dial-able per slot:** *governed* (Optimizely picks the winner) ⇄ *1:1 edge affinity* (true per-shopper). Default to the differentiator; flip to governed where he wants predictability.
- **Hosting:** we host it (managed); built **portable** so a customer *could* self-deploy in their own Cloudflare later.

---

## The HD Supply card (déjà vu — use it for credibility)

- We just built **CRePE** for HD Supply: a **deterministic engine** that assembles approved CMS content into page slots by customer attributes — *not* the recs engine, *not* AI.
- **Second time this pattern appears** (B2B distributor + luxury retailer) → it's a trend, not a one-off.
- **Learnings transfer; code doesn't** — theirs is Java in their cloud; this is **TypeScript at the edge**.
- **Coach = HD Supply's deterministic core + a live, per-shopper (1:1) layer on top.**
- The line: *"We've already solved the hard, governed half for another demanding engineering org."*

---

## If he conflates "recommend components" with the recs engine

> **"Choosing & ordering the modules is a governed decision — experimentation + affinity. The Recommendations engine only *fills* the recs and content modules; it's an input, not the composition driver."**

---

## Keep the two directions straight

- **AI-forward** (real-time AI personalization: search, scene, concierge, operator agent) → *a different conversation.*
- **Deterministic composition** (this one) → assemble approved components; AI at most design-time.

He wants the **deterministic** one. Don't let them blur.

---

## One-line closers

- "Assemble approved pieces — don't generate them."
- "Optimizely decides what's *allowed*; the edge decides what *this shopper* sees, now."
- "Same brain as HD Supply; different body — TypeScript at the edge."
- "Governed, fast, and only ever your approved components."
