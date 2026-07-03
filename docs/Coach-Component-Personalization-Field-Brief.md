# Coach — The HD Supply Pattern & Our Direction (Field Brief)

**Audience:** Product Managers, Account Executives, Customer Success
**Purpose:** Plain-language flag from Simone — why Coach's ask is déjà vu from HD Supply, the pattern we may be missing, and the direction we'd take. Not the technical doc; just the gist.
**Deeper write-ups (optional):** [Architecture & Capability Map](./architecture/14-architecture-and-optimizely-capability-map.md) · [Edge Composition Design](./architecture/15-edge-composition-design.md)

---

Team — I want to flag something that's been nagging at me. 👇

I've been sitting with Mandeep's ask (Coach's engineering lead), re-reading it in my head over and over, and it finally hit me why it felt so familiar: **it's déjà vu from HD Supply.** It's essentially the same problem we just finished building **CRePE** for — and *that's* the part I think we should pay attention to.

**Quick reminder of what we built for HD Supply (CRePE):** they needed their site to show the right **approved CMS content** (hero banners, promo tiles, resource cards…) to the right customer — **deterministically**, by business attributes (industry, account, region), not by behavioral guessing. So we built a **deterministic engine** that steps into the role their content-recommendations product used to play, but underneath it's **rules assembling approved content**, not a behavioral recommendations black box. No AI, no guessing — governed, predictable, explainable.

**Here's the part I want us to notice:** this is now the **second time** this exact pattern has shown up — a B2B industrial distributor (HD Supply) and a luxury retailer (Coach), completely different businesses, independently asking for the **same thing**. I don't think we've named it yet, and I suspect it's a **trend we're not identifying**: customers want a **deterministic engine that assembles approved content into their pages — governed and fast — not an AI that invents experiences, and not a behavioral-recommendation black box.** If two customers this different are asking, more will.

**What I'm hearing from Coach specifically:** Mandeep wants to personalize the **page layout itself** — which approved building blocks appear, and in what order, per shopper — inside their headless setup, fast, and fully governed. Same instinct as HD Supply: **assemble approved pieces, don't generate anything.** (The nuance vs. what we usually do: normally we personalize *what's inside* the modules — the products; he wants to personalize *which modules and their order* — the page.)

**The thing we need to be smart about:** this is **not an AI pitch.** AI might help *craft or create* the building blocks up front (design-time), but the engine they want at runtime is **deterministic**. Every one of these customers is gravitating to deterministic logic. If we walk in leading with "AI builds your page," we lose the room. We lead with **governed, deterministic assembly** — which is exactly what we just proved we can do.

**Why this is good news for us:** we learned a *ton* building CRePE, and that knowledge applies directly. The catch: **we can't reuse the code.** CRePE is **Java running in HD Supply's cloud**; Coach needs this in **TypeScript, running at the edge** (Cloudflare, for speed). Same brain, different body. The design is *incredibly* similar to HD Supply — **except Coach wants one thing on top:** a **live, per-shopper layer** (real-time affinity, plus the option to auto-optimize which layout wins), where HD Supply's was static/attribute-based. So: HD Supply's deterministic core **+** a real-time, edge-speed, 1:1 layer — still governed, still approved-only.

**If we went down this path, here's how the pieces connect and what we'd build** — simple version:

```
 1) THEIR CONTENT  — the approved page building blocks
    (lives in THEIR CMS, or Optimizely CMS — their choice)
               │
               ▼
 2) OPTIMIZELY  — the "brain" (the products we'd use)
      • ODP .............. who the shopper is
      • Feature Exp. ..... the governed rules + which blocks are allowed
      • CMAB ............. auto-optimizes which layout wins
               │
               ▼
 3) WHAT WE'D BUILD  — a fast engine running at the edge
      picks the approved blocks for THIS shopper and
      assembles the page in milliseconds — only ever approved blocks
               │
               ▼
 4) THEIR SITE  — renders the personalized page
```

In plain terms:
- **What we'd *use* (Optimizely products):** ODP, Feature Experimentation, and CMAB — plus a **home for the content**, which can be **their** CMS *or* Optimizely CMS. That content piece is *their* choice; everything else is ours to bring.
- **What we'd *build*:** the edge engine that assembles the approved blocks per shopper and hands their site the list to render.

**The direction, in one line:** we've now seen this pattern twice, we have hard-won knowledge from HD Supply, and we can bring it to Coach quickly — as a **deterministic, governed, edge-speed engine** (not an AI story), reusing the *learnings* even though the *code* doesn't carry over.

Happy to walk anyone through it — fuller write-ups exist if you want them, but this is the gist.
