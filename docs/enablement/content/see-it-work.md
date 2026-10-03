# Behavioral Targeting and Intelligence: see it work

For marketing: the engine's moves on a sample store, to click through before you write or speak about it.

**The engine is a personal stylist for every visitor, even a stranger: it arranges the page around what they are doing now, and your team keeps the last word.**

## Most visitors are strangers

Most people who come to a site arrive with no account and no history. Much of the buying happens before anyone has a profile, and tools made for known customers cannot see that window. The rules teams write to make up for it go stale, pile up and fight each other.

## The engine works like a personal stylist

A good stylist reads the room, watches without interrogating, rearranges the table and pivots when attention moves. The engine does all of that for every visitor at once, at internet scale, from what the visitor is doing now.

Recommendations rank the past; the engine decides the page at the point in time, and the two work side by side. It is not a recommendations engine and replaces none: it arranges the page around whatever recommendations the brand already has.

The sample store on this page is Morrow & Vale, a fictional brand of clothes and home goods. Its products, and what visitors in each region lean toward, are invented. Each of the stylist's moves is explained first, then shown in the store.

## The first page already feels local

The stylist's first move is to read the room. Before the first click, the engine knows the visitor's region from the request, and what visitors there have lately been interested in. So even a stranger's first page leans that way: the sections that match come first, and the hero, the large banner at the top, matches too.

The same store gives a visitor from Washington State and a visitor from Florida different first pages. Nobody wrote a rule for either region.

## The first click changes the page

Next, the stylist watches without interrogating. A click is a clue, not a conclusion: it pours a little into a bucket for each thing it touches, such as linen or tableware. The fuller a bucket, the more the page leans toward it.

Each bucket has two marks. Past the entry line, the visitor counts as interested. Only below the lower release line is that interest let go, so nobody flickers in and out. A bucket never overflows: each extra click adds a little less, so one obsession never takes over the page.

Then the stylist rearranges the table. On the next page, whole sections move, not only what sits inside them, and the hero can change. The recommendations carousel is one of those sections: its products still come from the brand's recommendations, and the engine decides where it sits. As the visitor's own buckets fill, the regional lean steps back.

We aim to make each decision within about 200 milliseconds at the edge; on average we see 50 to 250 milliseconds, and tens of milliseconds once the engine has seen the visitor.

## Relevance expires on its own

When attention moves, the stylist lets go. Every bucket leaks on its own clock, at a pace the brand sets, and nobody writes an expiration rule. When a bucket drains below its release line, the visitor is released from that interest, and the receipt records the release just as it recorded the entry. The sections then settle back toward what the region leans to.

Joining an audience is half the story; here, a visitor leaves one. This visitor spent the morning on one kind of thing, and that bucket passed its entry line. The clock runs fast: a fade that takes days on a live site happens here in moments.

Fading interest is one thing, and learning what works is another. It records what works from the first day and changes nothing until the brand turns the dial.

## The merchandiser keeps the wheel

Merchandisers set the rules, and the rules always come first, in a fixed order. Gates remove what may not show, such as anything out of stock. Pins hold the sections the brand has sold, such as a partner's spotlight, in the place it promised. Only then does the engine rank what is left by the visitor's interest.

The receipt writes every override down as an instruction, never as a decision, beside what interest alone would have ranked. Long after, anyone can tell the two apart.

## The stylist has more moves

- **Channels seed the visit.** A link from an email, an ad, a social post or a partner's quiz carries a campaign term the engine reads, and the first page leans toward it.
- **Every setting is in the open.** Marketers and data scientists tune each weight, each bucket's memory and each line in published, versioned documents and in the console.
- **Opal launches tests on signals.** Opal proposes experiments and CMAB tests on signals from other channels, and launches them in Feature Experimentation once a person approves.
- **Identity carries across sign-in.** When a visitor signs in, what they did as a stranger joins their known profile, and nothing is lost.
- **Decisions land in the brand's own warehouse.** Every decision and its outcome reach the brand's analysts, to read on their own numbers.

## Why customers choose it

Each customer weighs these reasons differently. In no particular order:

- **They can control it.** Gates, pins and every weight are theirs, and the engine ranks only what their rules leave.
- **It decides at the point in time.** It reads what the visitor is doing now, not only what they did before.
- **It is performant at the edge.** Each decision is made close to the visitor, on Cloudflare's network.
- **Every decision is explainable.** Each one comes with a receipt that a person can check by hand.
- **It hooks to Opal.** Opal authors audiences and tests, explains results and tags content, backstage. The engine calls no AI model to decide. Opal is where people ask and generative AI creates, and that is where credits apply.
- **AI is theirs to use or not.** AI search, a style concierge and generated imagery switch on with their credits, and the engine works without them.
- **It learns to the degree they govern.** Learning moves the page only as far as their dial allows, and holdout groups measure the lift.
- **It links with ODP.** The interests and audiences it forms flow into Optimizely Data Platform, where their other teams work, and no decision waits on it.
- **It works alongside their recommendations.** Their recommendations keep choosing products, and the engine places the carousel among the page's sections.
- **It honors the placements they sell.** A section sold to a partner holds its place, and the engine ranks everything else around it.

[Read the whole story](https://edge-platform-bti.expedge.workers.dev/what-it-is)

The problem, every capability with its use cases, and what a customer provides.

[See the arithmetic](https://edge-platform-bti.expedge.workers.dev/how-it-works-interactive)

How it works, for engineers: the same moves, worked through with the numbers.

---

**The engine is a personal stylist for every visitor, even a stranger: it arranges the page around what they are doing now, and your team keeps the last word.**
