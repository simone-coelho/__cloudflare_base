# Behavioral Targeting and Intelligence: selling it

For account executives, who tell the story to a customer and answer what comes back.

**Sell a personal stylist for every visitor, show the receipt behind every decision, and leave the wheel with the brand.**

## Most visitors are strangers, and most buying happens before anyone knows them

Most of the people on a brand's site are strangers. They have not signed in, they have no profile, and many have never visited before. A great deal of buying happens in exactly that window, before anyone knows who the visitor is.

Tools made for known customers are blind in that window. They wait for an email address, a login or a purchase history, and by then the visit is over. So teams write rules to fill the gap: one rule for visitors from paid social, another for the spring campaign, another for a region. The rules go stale the week a campaign ends. They multiply, because every new idea needs one more. And they fight, because nothing decides which rule wins when two apply. A luxury retailer's own brief said of its rule-based personalization: "It works, but it caps out."

The engine starts where those tools stop: with the stranger, on the first page.

## The engine is a personal stylist for every visitor, at internet scale

Picture a personal stylist on the shop floor, one for every visitor. A good stylist reads the room before anyone speaks. They watch without interrogating. They rearrange the table as they learn what a person likes, and they pivot the moment attention moves. A luxury retailer's own brief asked for exactly this: "a site that feels like a stylist who remembers".

That is the engine. It decides the page at the point in time, from what the visitor is doing now: which of the brand's content fills each place on the page, and in what order the page's sections appear.

It is not a recommendations engine, and it does not replace one. It lives alongside whatever recommendations the brand already runs and organizes the page by interest, in real time, around them. Recommendations rank the past; the engine decides the page at the point in time, and the two work side by side.

## Seven scenes carry the whole story

Each scene is a moment a customer will recognize. Tell them in this order, and every part of the engine appears at least once.

**The stranger from an ad.** A visitor nobody knows taps a social ad for a new phone and lands on the brand's home page. Before their first click, the page already feels local: it leans on what visitors in their region are interested in, read from the request itself. It also answers the ad, so the phone they were promised leads. They accept the consent banner and tap a different maker's phone, and the first click changes the page: that maker's phones move up wherever the brand's rules allow. On the product page, the sections below the buy box reorder around the visitor, and the recommendations carousel is one of the sections the engine orders. The buy box itself never moves, because the brand marked it off limits. The site never waits on the engine: if an answer is slow, the brand's own page renders exactly as it would have. Each decision is made in the data center nearest the visitor, on Cloudflare's network. We aim to make each decision within about 200 milliseconds at the edge; on average we see 50 to 250 milliseconds, and tens of milliseconds once the engine has seen the visitor.

**The drift and release.** Think of interest as a row of buckets, one for each value the brand cares about: each maker, each category, each price band. Every action pours a little into the buckets it touches, a purchase more than a view, and every bucket drains steadily on its own clock. When a bucket fills past its entry line, the visitor joins that audience. It has to drain below a lower release line before they leave, so nobody flickers in and out. A cap keeps any one bucket from taking over: the tenth click counts for less than the first, and a slot shows only so many pieces of one kind. Now the visitor who came from the phone ad starts browsing watches. The phone bucket drains, the watch bucket fills, and the page follows. The ad lets go of the page, and the receipt says why in plain words: the campaign's context was superseded by what the visitor did. When the visitor stops browsing, the watch interest drains below its release line on its own, with no further click, and the release is written on the receipt too. Nobody wrote an expiration rule.

**The pinned paid section.** A brand sells space on its own pages: a partner's funded placement, a launch week, a seasonal campaign. Merchandisers keep the wheel, in a fixed order. Gates go first: anything out of stock, outside its window or outside its region never shows. Pins go next: the section the brand sold holds the position it was sold for, first, third or wherever the agreement says. Then the engine ranks everything else around it. On the receipt, the pinned section reads as an instruction, not a decision, so anyone can tell the two apart long afterwards, and the receipt also keeps what ranking would have chosen instead. A merchandising weight can lean on a season, a promotion or margin, but it multiplies interest the visitor has shown; it cannot invent interest that is not there. No sold placement is quietly ranked away.

**The signal from another channel.** The visit often starts somewhere else. The link in an email, an ad, a social post or a partner's quiz carries a campaign term, and the engine reads it along with the channel, the referring network and the operating system family of the visitor's phone. Before the first click on the site, content that matches the campaign rises by a small weight the brand publishes, and the receipt shows exactly how much; then the visitor's own behavior takes over. Signals can also start work beside the page. When a product starts trending on social, Opal can propose a test on that signal and launch it through Feature Experimentation, a contextual bandit (CMAB) test included, with a person approving. ODP keeps the long memory: the interests and audiences the engine forms land there for the brand's other teams, and a known customer's history can arrive warm. When the visitor signs in, the brand's own server vouches for them, and everything they did as a stranger carries over to their known profile, with nothing overridden.

**The catalog tagged by Opal.** A merchandiser loads a batch of new pieces that carry few tags. Opal proposes tags from the brand's own vocabulary, and a person approves, edits or rejects each one before anything reaches the site. The new pieces are ranked from the moment they go live, on their tags alone, with no history needed, and fresh pieces get a fair start. The same merchandiser asks Opal, in plain words, to create an audience, to explain why a hero did well with paid-social visitors, or to draft the next test. The engine calls no AI model to decide. Opal is where people ask and generative AI creates, and that is where credits apply. For shoppers, the brand can switch on optional AI add-ons with its credits: AI search that knows the visitor, a style concierge, and generated imagery of real products. Each is the brand's to use or not. The whole boundary is on the credits page, [Where Opal and AI credits fit](https://edge-platform-bti.expedge.workers.dev/credits).

**The receipt read aloud.** A customer's analyst points at a card and asks why it is there. Read the receipt aloud. This piece is here because the visitor's interest in this maker, times the slot's weight for maker, plus their interest in this price band, times its weight, came to the highest total. The campaign they arrived on added a small, published amount, the spring promotion weight nudged it up, and nothing was pinned. It fits on the back of an envelope, and a person can recompute it by hand. Every decision and every override is written out this way, with the version of every setting in force, so "why did this visitor see this?" is a lookup, not an investigation. Given a decision's id, the engine can decide again from the recorded inputs and show that the answer matches. Every decision and every outcome lands in the brand's own warehouse, where its analysts read the results on their own numbers.

**The data scientist tuning a constant.** A data scientist on the brand's team thinks interest in price band should drain faster than interest in a maker. In the console, they change that dimension's memory and save. The change is a new revision of a published document, in force without a software release, and the next receipt shows the new term. If it was a mistake, one step rolls it back, and the rollback is itself on the record. Every weight, memory and threshold, every slot rule and pin, and every learning dial is set this way, by marketers and data scientists, in plain sight. The analysts can also import what they already know as starting beliefs, which live evidence then confirms or corrects. Learning works the same way: the engine counts which pieces earn outcomes in which contexts, and the brand decides how far that may move the page, with holdout groups kept from the start and lift measured on the brand's own numbers. It records what works from the first day and changes nothing until the brand turns the dial.

## Customers choose it for different reasons, and each weighs them differently

These are the reasons customers give, in no particular order. Each customer weighs them differently, so listen for the two or three yours raises first, and lead with those.

| Customers choose it because | What that means for them |
|---|---|
| They can control it | Their rules run first, the placements they sell hold, and every constant is theirs to set |
| It decides at the point in time | The page answers what the visitor is doing now, not what other shoppers did last month |
| It is performant at the edge | Each decision is made in the data center nearest the visitor, on Cloudflare's network |
| Every decision is explainable | A receipt writes out the arithmetic, short enough to check by hand |
| It hooks to Opal | The team asks in plain words, and Opal authors, explains, tags and proposes tests |
| AI is theirs to use or not | The engine calls no AI model to decide, and every AI add-on is optional |
| It learns to the degree they govern | Learning moves the page only as far as the brand turns the dial |
| It links with ODP | Interests and audiences land where the brand's other teams already work |
| It works alongside their recommendations | It orders the page around them, and reorders a product list without removing anything |
| It honors the placements they sell | A pinned section holds its place, and its receipt says it was an instruction |

## One visitor shows how it works

Here is the same visitor, as the engine sees them. The site sends each thing the visitor does, such as a view, an add to cart or a purchase, as an event that carries the product's attributes. Each event pours into the interest buckets for the values it touches, such as a maker or a price band, at the weight the brand set for that action.

Each place on the page that the engine decides is a slot, and each slot has its own weights: the home page's hero may care most about region and channel, a product gallery about price band. When the page asks, the engine applies the brand's rules first. Then it scores every eligible piece in each slot, adding up interest times weight plus anything the arrival or a merchandising weight contributes, and sorts. It answers with the brand's own content ids, in order, each with its reasons, and the site renders them.

Nothing is personalized or recorded until the visitor makes a consent choice. The engine curates which content leads, never a price, a discount, financing or credit. For the full mechanism and the arithmetic, bring a solutions engineer, whose piece is [How it works and where it runs](https://edge-platform-bti.expedge.workers.dev/how-it-works).

## What a customer can measure, and the questions that surface it

Every outcome below is a number the customer can baseline now and measure on their own data. Ask the question first; the number follows.

| What the customer can measure | The question that surfaces it | What the engine changes |
|---|---|---|
| How visits from strangers convert, first visits above all | How many of your visitors arrive as strangers, and how do their visits convert compared with visitors you know? | Strangers get a relevant page from the first click |
| Time spent on personalization rules | Who writes and retires your personalization rules, and how many hours a month does it take? | Interest fills and drains on its own, so nobody writes expiration rules |
| Page speed, and what it costs in conversion | Have you measured what a slower page costs you in conversion? | Each decision is made at the edge, nearest the visitor |
| Lift the customer trusts | How do you measure personalization lift now, and who signs off on the number? | Holdout groups run from the start, and every decision lands in their own warehouse, so lift is measured on their numbers |
| Placements and campaigns kept as sold | What happens now when personalization collides with a placement you sold or a campaign you launched? | Gates, then pins, then ranking, with every override on the receipt |
| What the team launches | If the hours spent on rules came back, what would your team launch? | Time moves from upkeep to new campaigns and content |

## What a customer provides, and what we use it for

Each ask comes with its reason. Your solutions engineer covers the technical detail.

| What we need | What we use it for | Who usually provides it |
|---|---|---|
| Their content, with their own ids, tags, the slots each piece may fill and its publish window | The material every decision is made from; the engine answers with their ids | The content team |
| Their vocabulary of interest: the dimensions that matter, how much each action counts, how long interest lasts | Relevance described in the brand's own words | The brand's team, with Professional Services |
| A map of the page's slots, with each slot's default | Which places the engine decides; the default renders whenever there is no answer | The front-end and merchandising owners |
| Behavior events from the site, carrying each product's attributes, and the purchase event | Filling each visitor's interest, and crediting outcomes to the decisions that earned them | The site's tag and analytics owners |
| The visitor's consent choice, from the consent banner | Nothing is personalized or recorded without it | The privacy owner |
| A signed proof of identity at sign-in | Carrying a visitor's interests across sign-in | The backend team |
| The addresses their pages call from, a site key, and a connection check from inside their network | Accepting calls only from the brand's own sites | The platform team |
| How long each category of data may be kept | Keeping data only as long as agreed | The privacy owner |
| A destination in their warehouse | Landing every decision and outcome where their analysts work | The data team |

Optional: product lists from the commerce platform, to reorder for each visitor; the brand's own AI model key, for AI search and tagging; starting beliefs from its analysts; the past behavior of known customers; and Opal credits for Opal's work and the AI add-ons.

## Objections have short, true answers

A program lead at a luxury retailer once asked how a page could learn its order without versions to learn from: "How else would it learn? I don't understand." The answer was one sentence: an ordering is a ranking. Most objections have answers that short.

| They ask | Say | Never say |
|---|---|---|
| Isn't this a recommendations engine? | Recommendations rank the past; the engine decides the page at the point in time, and the two work side by side. It even orders the recommendations carousel among the page's sections. | "It replaces your recommendations." |
| Is it AI? | The engine calls no AI model to decide. Opal is where people ask and generative AI creates, and that is where credits apply. | "We don't use a model." |
| How fast is it? | We aim to make each decision within about 200 milliseconds at the edge; on average we see 50 to 250 milliseconds, and tens of milliseconds once the engine has seen the visitor. | "We guarantee a response time." |
| How does it learn the order without versions? | An ordering is a ranking. The engine scores each section for this visitor and sorts, so there are no versions to make, and the page the brand runs is the starting point. | "We test every combination of your page." |
| Will it override our merchandisers? | Never. Gates come first, then the pins for what you sell, then ranking, and every override reads on its receipt as an instruction, not a decision. | "The algorithm knows best." |
| Can we see why it chose that? | Yes. Every decision is written out as arithmetic on a receipt a person can recompute by hand. | "Trust the model." |
| Does it change things on its own? | It records what works from the first day and changes nothing until the brand turns the dial. | "It optimizes itself." |
| Do we need to know who the visitor is? | No. It works for strangers from the first click, and when a visitor signs in, everything they did before carries over. | "It identifies your visitors." |
| What about privacy? | Nothing is personalized or recorded until the visitor chooses, and it never decides a price, a discount, financing or credit. | "It's anonymous, so consent doesn't apply." |
| Do we need ODP, Feature Experimentation or Opal? | It links with ODP and Feature Experimentation and works with Opal, and each adds something, while the engine makes its decisions on its own. | "You have to buy the whole suite first." |
| Will every page view spend AI credits? | No. Serving a page calls no AI model, so it spends no credit, however much traffic grows. | "Credits grow with your traffic." |
| Does it run in our mobile app? | It runs on the website, through one script the site adds once. | "It runs in your native app." |
| How long until it is live? | One integration on the site, then each capability is switched on in configuration; timing is agreed with each customer. | "Live in two weeks." |

## Each hosted demo tells part of the story

Start a demo from where you are: the region on screen is the viewer's real one. The [Demo map](https://edge-platform-bti.expedge.workers.dev/demos) has the full beats.

| Demo and address | The scenes it shows | Keep in mind |
|---|---|---|
| Vantage, a carrier's online shop: [https://edge-platform-vantage.expedge.workers.dev/vantage/](https://edge-platform-vantage.expedge.workers.dev/vantage/) | The stranger from an ad, with a first page that answers the ad and the region; the drift and release, as the page lets the ad go and an interest fades; a product page whose sections the engine orders; a pinned launch; a receipt behind every card | Its regional sales are synthetic and marked so on screen. It shows real phone makers' images, so legal confirms before any public or recorded use |
| Vantage's interactive explainer: [https://edge-platform-vantage.expedge.workers.dev/vantage/how-it-works](https://edge-platform-vantage.expedge.workers.dev/vantage/how-it-works) | The data scientist tuning a constant: every constant on a slider, recomputing a real receipt | Made for a customer's engineers; bring a solutions engineer |
| Top Offers, on screen Lantern & Lane, a retailer's promotions module: [https://edge-platform-top-offers.expedge.workers.dev/top-offers/](https://edge-platform-top-offers.expedge.workers.dev/top-offers/) | The pinned paid section, with "ranking was skipped" on its receipt; a merchandiser's day of real publishes, from a closing window to a new promotion ranked on its tags alone; the receipt read aloud | Its click report credits clicks to decisions; lift is measured on the brand's own numbers |
| Meridian, on screen Calder, one brand with two businesses: [https://edge-platform.expedge.workers.dev/meridian/](https://edge-platform.expedge.workers.dev/meridian/) | The signal from another channel: an email, an ad, a text sign-up and a partner's form before the visit; the drift and release; Opal and experiments in the operator's act | The page shows the fade on its own timer: describe it as the interest falling below its release line |
| The Bright Hour, a live-shopping retailer: [https://edge-platform.expedge.workers.dev/live/](https://edge-platform.expedge.workers.dev/live/) | The catalog tagged by AI, with a person approving each tag; a new offer ranked with no history; an item selling out mid-visit; receipts | Its memories are compressed to seconds for the room; its Offer Desk is at [https://edge-platform.expedge.workers.dev/live/ops](https://edge-platform.expedge.workers.dev/live/ops) |
| The storefront: [https://edge-platform.expedge.workers.dev/storefront](https://edge-platform.expedge.workers.dev/storefront) | Opal creating an audience in plain words; experiments and contextual bandit tests; AI search and the style concierge; a social trend turned into a generated hero and a test | For internal viewing only: it carries one brand's own products and is never shown to another company |

## Four sentences to say word for word

- We aim to make each decision within about 200 milliseconds at the edge; on average we see 50 to 250 milliseconds, and tens of milliseconds once the engine has seen the visitor.
- It records what works from the first day and changes nothing until the brand turns the dial.
- The engine calls no AI model to decide. Opal is where people ask and generative AI creates, and that is where credits apply.
- Recommendations rank the past; the engine decides the page at the point in time, and the two work side by side.

**Sell a personal stylist for every visitor, show the receipt behind every decision, and leave the wheel with the brand.**
