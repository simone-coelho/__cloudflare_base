# Behavioral Targeting and Intelligence: what it is

For marketing: written for someone who has never seen the product and must explain it in their own words.

> **The engine is a personal stylist for every visitor, even a stranger: it arranges the page around what they are doing now, and your team keeps the last word.**

## Most visitors are strangers, and tools made for known customers cannot see them

Picture a store where most people walking in have never been there before. Online, that is an ordinary day: most visitors arrive with no account and no history, and much of the buying happens before anyone has a profile. One of our customers in luxury retail could identify only a small share of its visitors.

Tools made for known customers work from profiles and purchase histories, so in that window they cannot see. Teams compensate with rules by campaign and region, and the rules go stale, pile up and fight, with nothing expiring unless someone removes it. The same retailer said of the content it ran on a handful of fixed audiences: "It works, but it caps out."

## The engine is a personal stylist for every visitor

Think of a good stylist in a boutique. The same retailer described the site it wanted as "a site that feels like a stylist who remembers." It concluded that this capability did not exist off the shelf, and built it with us. The engine is that stylist, for every visitor at once, at internet scale.

It reads the room: the first page already leans toward the visitor's region and the link they came from. It watches without interrogating: it asks nothing, needs no login and learns only from what the visitor does. It rearranges the table: the sections of the page, and the pieces inside them, move toward this visitor's interests. And it pivots when attention moves. Its memory is a row of buckets, one for each thing a visitor might care about.

Recommendations rank the past; the engine decides the page at the point in time, and the two work side by side. The engine needs no purchase history, so it works for a visitor nobody has met, and it replaces no recommendations product. The recommendations carousel keeps choosing its products, while the engine decides where the carousel comes among the page's sections and what fills the places around it.

## Short scenes show what it does

**A stranger taps an ad.** A visitor taps an ad for a new phone and lands on the home page for the first time. The first page already answers the ad: the advertised offer leads, and the rest leans toward what visitors in the same region are interested in. The visitor taps a different phone, and that first click changes the page. A few clicks later they are browsing another brand, and the page follows the visitor, not the ad. The receipt says so in words: the campaign gave way to what the visitor actually did.

**A visitor drifts from coats to shoes.** Each thing a visitor might care about, such as coats, black or a price range, has its own bucket. Every action pours into the buckets it touches, a purchase more than a view, and merely seeing something pours nothing. Every bucket leaks on its own clock, and the fuller it is, the more the page leans toward it. Past a marked line the visitor counts as interested; below a lower line they are released. A bucket holds only so much, so one obsession never takes over the page. Our visitor looks at a few coats, then turns to shoes: the shoes bucket fills, the coats bucket drains, and the page follows. Later the coats interest drops below its line and is released, with no expiration rule written, and the receipt records the release like the entry.

**A merchandiser pins the section they sold.** In launch week, the brand has promised a partner the top of the home page. The merchandiser pins that section, and it holds for every visitor. Below it, the engine orders the other sections by each visitor's interest: the recommendations carousel, the category grid, the reviews and a styling story. Reviews rise for a visitor close to buying, the styling story for one still browsing. Gates come first, removing anything out of stock or outside its dates. A home-shopping retailer asked, of a short-lived offer, whether to "reinforce it while it is live, or let the shopper drift". The engine allows both: a pin or a weight reinforces, the visitor's interest drifts, and a weight can only lean on interest the visitor has shown. The receipt marks the pin as an instruction, not a decision.

**A signal arrives from another channel.** Visitors click through from the brand's email, a social post or a partner's style quiz. Each link carries words the engine reads, such as the campaign term, and the first page leans toward them. When an outside signal arrives, such as a product taking off on social media, Opal can propose a test or a CMAB test on it in Feature Experimentation and launch it once a person approves. The interests and audiences the engine forms also flow to ODP for the brand's other teams, and no decision ever waits on it.

**A catalog gets its tags.** The engine places the brand's own content, images, text, modules and layouts, each under its own id and tagged in the brand's own words. Where tags are thin, Opal proposes more from the brand's vocabulary, and a person approves each one. Where tags fall short, the engine matches on meaning, so a module named "work to weekend" rises for a visitor browsing close to that idea. Nothing is copied or hosted elsewhere.

**A decision is read off its receipt.** An analyst asks why one visitor saw the black coat first, and the answer is a lookup, not an investigation. The receipt lists each reason: how full the visitor's coats and black buckets are, how much this place on the page cares about each, and the small lift from the ad. It also names any weight, rule or pin, and the version of every setting in force. It fits on the back of an envelope, and the engine can replay the decision to prove it. Every weight, memory and threshold behind it sits in published, versioned documents that the brand's marketers and data scientists change in the console, without a software release, with every change recorded and reversible.

**The page learns what works, at the brand's pace.** It records what works from the first day and changes nothing until the brand turns the dial. Each place on the page learns toward the brand's goal, such as clicks, purchases or margin. A holdout group keeps seeing the brand's own page, so its analysts can measure the lift on their own numbers.

**The visitor signs in, and nothing is lost.** What they did as a stranger joins their known profile, with nothing overwritten, and on the next visit their interests pick up where they left off, cooled rather than reset.

**AI helps the team, and the visitor if the brand wants.** The brand's team asks Opal to draft audiences and tests, explain results and propose tags. With its credits, the brand can also switch on AI for its visitors: AI search ranked for each visitor, a style concierge and generated imagery, each optional and none deciding the page. The engine calls no AI model to decide. Opal is where people ask and generative AI creates, and that is where credits apply.

## Customers choose it for different reasons

Each customer weighs these reasons differently. In no particular order:

- They can control it: the gates, the pins and the weights are theirs.
- It decides at the point in time, from what the visitor does now.
- It is fast at the edge, close to every visitor.
- Every decision is explainable, with its reasons on a receipt.
- It hooks to Opal.
- AI is theirs to use or not.
- It learns only as far as they govern.
- It links with ODP.
- It works alongside their recommendations.
- It honors the placements they sell.

## Underneath, buckets feed a ranking with a receipt

Walk the stranger from the ad through once more. Their tap on a phone pours into the buckets for its brand, its operating system and its price range. When the next page asks, the engine takes each place on the page in turn. The brand's rules come first, then everything left is ranked by how well it matches the fullest buckets, weighted by what that place cares about, with a small lift for the ad. The engine answers with the brand's own ids, in order. The site renders them, keeping its own default whenever no answer arrives in time, and the receipt records the working.

All of it happens in the data center nearest the visitor, on Cloudflare's network, with no AI model and no trip to a central database. Every decision and its outcome then land in the brand's own warehouse. One deployment can serve several brands, each in its own space.

## The brand brings its content, its page map and its events

- Its own vocabulary: the dimensions it cares about, such as category, color and price band, and how much each action counts, which become the buckets.
- Its content feed, with its own ids and tags, which is what the engine places.
- A map of its pages, with the site's default for each place, shown whenever the engine stays silent.
- Its site's events, through one script or its existing data layer, which fill the buckets.
- A short signed proof from its own server at sign-in, to carry the visitor's interests into their known profile.
- If it wants, what its analysts already know and its known customers' past behavior, so pages start warm, and its warehouse, ODP and Feature Experimentation.

## Four sentences are always said word for word

- "We aim to make each decision within about 200 milliseconds at the edge; on average we see 50 to 250 milliseconds, and tens of milliseconds once the engine has seen the visitor."
- "It records what works from the first day and changes nothing until the brand turns the dial."
- "The engine calls no AI model to decide. Opal is where people ask and generative AI creates, and that is where credits apply."
- "Recommendations rank the past; the engine decides the page at the point in time, and the two work side by side."

## Some phrases mislead, so say these instead

| Never say | Say instead |
|---|---|
| "AI-powered personalization", "the AI decides" | "The engine calls no AI model to decide." |
| "We don't use a model" | "The engine calls no AI model to decide; Opal and the optional add-ons are where AI works." |
| "A recommendations engine", "it replaces your recommendations" | "Recommendations rank the past; the engine decides the page at the point in time, and the two work side by side." |
| "It knows who the visitor is" | "It knows what the visitor is interested in, and who they are only once they sign in." |
| "It reads their mind" | "It notices what the visitor does." |
| "It learns on its own", "it optimizes itself" | "It records what works from the first day and changes nothing until the brand turns the dial." |
| Any speed figure other than the performance sentence, or any service level | The performance sentence, word for word. |
| "Guaranteed lift" | "The brand measures the lift on its own numbers, against a holdout." |
| "It changes prices for each visitor" | "It curates content, never a price." |
| A customer's or a competitor's name | The industry: "a luxury retailer", "a home-shopping retailer". |

## These are the questions marketing hears

**Is it AI?** No AI model decides what a visitor sees. Like a stylist with a good memory, the engine notices what the visitor does, keeps score in its buckets and follows the brand's rules, so every decision can be checked by hand. AI works beside it, in Opal and in the optional add-ons.

**Is it private?** It honors each visitor's consent choice. It keeps interests, not names: a visitor stays anonymous until they sign in, and a known customer is stored under a salted one-way code. It reads no device detail beyond the operating system family of the visitor's phone, uses no third-party data, curates content but never prices, and forgets a visitor who asks.

**Does it need ODP, Feature Experimentation or our warehouse?** It works on its own and links with each: ODP receives the interests and audiences it forms, Feature Experimentation runs the tests Opal proposes, and the warehouse receives every decision and outcome. No decision waits on any of them.

**Does every page view use AI credits?** No. Serving a page spends no credit; credits follow where people use AI, in Opal or in an add-on the brand has switched on, never page views.

**How do we prove it works?** A holdout group keeps seeing the brand's own page from the start, and the brand's analysts compare the two on their own numbers. The engine never grades its own homework.

## The other pages go deeper

- [Selling it](https://edge-platform-bti.expedge.workers.dev/selling-it), for account executives.
- [How it works and where it runs](https://edge-platform-bti.expedge.workers.dev/how-it-works), for solutions engineers.
- [Where Opal and AI credits fit](https://edge-platform-bti.expedge.workers.dev/credits), the credits page.
- [Which demo to show to whom](https://edge-platform-bti.expedge.workers.dev/demos), the demo map.
- [Glossary](https://edge-platform-bti.expedge.workers.dev/glossary), the words we use.

---

> **The engine is a personal stylist for every visitor, even a stranger: it arranges the page around what they are doing now, and your team keeps the last word.**
