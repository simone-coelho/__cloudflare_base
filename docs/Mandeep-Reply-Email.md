Subject: Re: content personalization — your three questions

Mandeep,

Great questions — all three sharpened the document, and the proposal has been updated to match. Answers below.

**1. "You paint the screen" — you're right, and that is the design.** That sentence was ambiguous out of context and we've removed it. The contract, stated unambiguously: your front end paints, always. We push the decision as data — {slot, content ID, type, URL, score, explain} — your renderer maps it to your component, and if no decision arrives, your default renders. We never render, inject, or touch your DOM. There is no version of this where we paint the screen.

**2. It is not CMAB-dependent — the document over-featured CMAB, and that's fixed.** The algorithm is a ranker, and it treats content exactly the way product recommenders treat products: your shopper's live affinity vector is scored against content tags across the open content catalog, per individual, at decision time. No pre-built variation sets anywhere in the path. CMAB survives only as an optional instrument for specific slots if we ever want bandit-style allocation there — it is not the engine, and nothing depends on it.

**3. The learning / recommendation logic, concretely:**

- Serving: eligible content for the slot (lifecycle, constraints, context filters) → score(item) = sum over the item's tags of [shopper's live affinity to that tag] × tag weight × context multipliers (channel, visit count) → rank → top item pushed, with the explain record attached ("why this content, this person").
- Learning: per content item, per context, we accumulate impressions → clicks → conversions and fold the measured lift into that item's ranking score — per-item statistics across the whole catalog, the same machinery behind product recommendations. A small exploration share keeps new content discoverable so early winners can't lock in.
- Later (the discovery stage): the system proposes which behaviors and weights are actually predictive — surfaced through Opal with full explanation, approved by your team.

Every parameter stays visible and tunable, and every decision answers "why this content, this person."

Next step unchanged on our side: your markup of the proposal, then the working session with Seth's team on the push payload and the first slots.

Simone
