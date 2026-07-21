# Content Personalization, Explained Simply

**Audience:** INTERNAL — account executives, sales, GTM, CSM, product. No technical background needed.
**Purpose:** what we're actually proposing to Tapestry (and ASOS), in plain words: what it is, how it works, which Optimizely products are involved, what we built ourselves, and how it's different from a CMAB. Read time: ~7 minutes.

---

## 1. The one-sentence version

> **We recommend *content* the way we already recommend *products* — the right image, banner, or module for each shopper, picked automatically from everything the brand has, based on what that shopper is doing right now.**

If you understand product recommendations ("customers who viewed this also bought…"), you already understand 80% of this. We're pointing the same idea at a different thing: not *which products* to show — *which content* to show.

## 2. The example everyone already knows: Netflix artwork

Netflix doesn't just recommend which *show* you should watch. It also picks **which thumbnail image** to show you for the *same* show. If you watch a lot of romance, you get the artwork with the couple. If you watch action, you get the explosion. Same show — different picture, per person, chosen automatically.

That's content personalization. Nobody at Netflix hand-writes a rule that says "show Maria the couple picture." The system learned it from what Maria watches.

Now replace "show" with "handbag page" and "thumbnail" with "hero image, banner, product photo style, review module": a shopper who's clearly browsing evening bags sees the elegant evening-styled photography; a first-time visitor sees the inspiring lifestyle image; a returning visitor who's close to buying sees the detailed close-up with reviews right there. **Same page. Different content. Per person. Automatic.**

That's what we're proposing. Retail brands are asking for exactly this — Tapestry's VP of Engineering literally described it to us using the Netflix/Instagram analogy.

## 3. How it works — one shopper's story, five steps

1. **The brand gives us their content, labeled.** Every image, banner, and text block gets an ID and simple labels ("evening," "lifestyle shot," "close-up," "reviews"). We call this the **content catalog** — the same idea as a product catalog, but for content. (Where labels are missing, AI suggests them and a human approves — a one-time cleanup, not something running on the live site.)
2. **A shopper browses, and we read the room.** As she clicks around, our engine keeps a live "interest thermometer" for her: browsing evening bags makes her *evening* score rise; ignore them for a minute and it cools back down. This happens in milliseconds, invisibly, on every action. (This is the affinity engine — the same one that powered the Tapestry demo everyone saw.)
3. **The engine matches her interests to the content labels.** Her *evening* score is high → the evening-styled image outranks the everyday one → that's the pick. Not a rule someone wrote — a live match between *her* behavior and *the content's* labels, recalculated every time.
4. **We send the answer; the brand's website displays it.** We push a tiny message: "in the hero spot, show content **#CMP1234**, and here's *why*." Their website does the actual displaying. **We never touch, redesign, or inject anything into their site** — a huge selling point for engineering teams burned by tools that mess with their pages.
5. **The system learns what actually works.** Over time we see which content leads to purchases, for which kinds of shoppers, from which channels ("visitors from paid social buy more after seeing the model-worn shot"). The winners rise in the rankings — exactly how product recommendations get smarter. And every choice can answer the question "*why did this shopper see this?*" — no black box.

### …and a real page isn't one picture — it's a wall of frames

The story above followed one spot (the hero image) to keep it simple. A real page — say a product page — might have **eight content sections** top to bottom: a banner, the product gallery, a storytelling block, a recommendations widget, reviews, a styling module, and so on. The same machine handles all of them:

- **Think of the page as a wall of picture frames.** The brand's template decides the frames — which sections exist and where. We choose **what hangs in each frame**, per shopper.
- Every piece of content in the catalog says which frames it can hang in ("this is a banner," "this fits the storytelling section").
- **One reading, eight picks.** The engine reads the shopper's interest thermometer *once*, then picks the best content for each frame from that one reading — eight small decisions sent together as one message: "frame 1 → #CMP1234, frame 3 → #CMP2201, …"
- **House rules keep the page sane:** never hang the same picture twice on one page; some frames are never personalized (header, footer, legal — the brand marks them off-limits); and any frame we don't send a pick for simply shows the brand's default. The page never breaks and never waits on us.
- **The product-recommendations widget stays product recs.** That section keeps choosing *products* (the existing machinery). Content personalization fills the frames *around* it — same brain, the shopper's live interests, feeding both.
- **Rearranging the wall itself** — which frames exist, in what order, per shopper — is deliberately *later*: that's step 4 of the ladder (layout personalization, ~6 months). Today the wall is fixed and the pictures are personal; later the wall adapts too.

And we've built multi-frame pages before: **HD Supply's CRePE fills a 10-widget home page this way today** — every widget resolved per request, duplicates removed across the page, a fallback per widget — just with fixed business rules doing the picking. Content personalization swaps the picker (live interest instead of rules); the multi-section delivery is shipped technology.

## 4. What's an Optimizely product, and what did we build?

Honest and simple:

| Piece | What it does (plain words) | Product or built-by-us? |
|---|---|---|
| **ODP** | The memory. Every shopper action is saved to their profile; the audiences live here; other Optimizely tools can use them | **Optimizely product** — used for real, live today |
| **Feature Experimentation (incl. CMAB)** | The experimentation toolkit — flags, A/B tests, bandits. Used to *activate* and *test* experiences | **Optimizely product** — used where it fits |
| **Opal** | The AI assistant layer — explains what the system is doing and why, in plain language | **Optimizely product** — the transparency window |
| **The affinity engine** (live interest scoring) | The "interest thermometer" — scores each shopper's interests in real time as they browse | **Built by us** (the edge engine from the Tapestry demo) |
| **The content catalog + content matching** | Registers the brand's content and picks the best piece per shopper | **Built by us** (being built now — this is the new capability) |
| **The delivery kit (SDK)** | The small connector the brand's website uses to receive our picks | **Built by us** |

So when someone asks *"is this an Optimizely product?"* the honest answer is: **it runs on Optimizely products (ODP is the backbone), with a new engine we built that doesn't exist in the product line yet — which is exactly why customers are excited, and why product leadership is looking at it.** Don't claim it's on the price list; don't undersell it as a science project. It's built, demonstrated, and being productized.

## 5. "Isn't this just CMAB?" — no, and here's the difference

This is the #1 confusion, internally and with customers. The kitchen analogy:

- **A CMAB is a taste test between a few dishes someone already cooked.** Humans pre-build 3–5 versions of a page ("variations"), and the CMAB learns which version works best for which kind of visitor. Powerful — but *somebody had to cook those 3–5 dishes first*, and visitors only ever get one of those few dishes.
- **Content personalization is a personal chef with the whole pantry.** Nothing is pre-built. The system looks at *all* the content in the catalog — hundreds of pieces — and composes the right pick *per individual shopper, per moment*. Nobody guesses in advance what the combinations should be.

Why this matters commercially: customers like Tapestry already *have* CMABs, and their complaint is precisely the pre-built-versions part — "we're guessing when we build the variations." If we pitch this as "a big CMAB," we're pitching them their own problem back. The right sentence: **"CMAB chooses between a few pre-made versions; this ranks everything in the catalog for each person — the way product recs do."** (CMAB still has a role — as one optional testing instrument inside the system — but it is not the engine, and saying "it's CMAB-based" is both wrong and sales-poison with this audience.)

## 6. "Didn't we already do something like this for HD Supply?" — yes, half of it

For HD Supply we built **CRePE**: their content, registered with IDs and labels, served to their website by ID — "show content #ABC in this slot" — with their site doing the displaying. Sound familiar? That's **steps 1 and 4** of this proposal, already built, shipped, and running for a demanding enterprise customer. What CRePE *doesn't* have is the brains in the middle: it picks content by fixed business rules (which is what HD Supply wanted), not by live shopper behavior.

The Tapestry demo proved the brains: the live interest scoring (**steps 2–3**), plus the learning design (**step 5**).

**So content personalization = the two halves we've already proven, joined together.** That's why we can move fast, and it's the sentence to use when someone says "isn't this all new?": *"No — we've shipped the delivery half for HD Supply and demonstrated the brains half for Tapestry. We're connecting them."*

## 7. What are we actually selling? (the ladder, in plain words)

Four steps, each valuable alone, each building on the last:

1. **The foundation** *(live today, deploys in ~1–2 weeks)*: live interest scoring + self-building audiences + instant experience response, all wired into the customer's ODP.
2. **Content personalization** *(the new capability, in build)*: the content catalog + per-shopper content picking — the Netflix-artwork moment.
3. **Learning** *(follows naturally)*: the system learns which content converts, for whom — and keeps getting better.
4. **Layout personalization** *(the long game, ~6 months)*: not just *which content in the spots* — the arrangement of the page itself, per shopper.

Customers can't skip steps (each one generates the data the next one needs), and step 1 is always the way in — it's live, and the demo of it is what's been winning rooms.

## 8. Quick FAQ

**"Can I sell this today?"** — Step 1: yes, it's live. Steps 2–3: sell as a design-partner build with committed dates (Tapestry has them). Step 4: vision, ~6 months. Never promise a later step as "available now."
**"Do we build or change the customer's website?"** — No. Never. We send picks as data; their site displays them. This is a *feature*, not a limitation — say it proudly to engineering audiences.
**"Is it AI?"** — The picking is transparent math (scores you can read, choices that explain themselves — a deliberate contrast to "black box" competitors). AI helps label content up front and explains results through Opal. If a customer fears black boxes: this is the anti-black-box.
**"What does the customer need to have?"** — Their catalog, ODP, and a website team willing to spend a workshop connecting the delivery kit. That's the qualification checklist.
**"Who's the competition?"** — Dynamic Yield is the reference point. Our wins: instant (milliseconds), transparent (theirs is a black box), and the customer's own data in their own ODP (DY is Mastercard-owned).
**"Why do customers care so much?"** — Because today they hand-build every variation and guess. This removes the guessing. Four customers have now asked for this same capability independently — that's the demand signal.

## 9. The elevator pitch (memorize this one)

> "You know how product recommendations pick the right *products* for each shopper? We do that for *content* — the images, banners, and modules themselves. Netflix picks a different thumbnail for you than for me; we do that for a brand's entire site, using the shopper's live behavior, on the customer's own data, with full transparency. The engine is live, one enterprise half is already shipped, and Tapestry and ASOS are lining up for it."
