# Lane brief, version 2: the finished product, told as a story

This brief replaces every rule in `LANE-BRIEF-COMMON.md` and `BTI-Enablement-Design.md` that it contradicts.
Where they agree (gender-neutral language, plain words, the glossary's terms, American English, no em-dashes,
one writer per path, save whole, no git, no installs, no deletes, no deploys, record your lane note), they
still hold. Read this first, then `research/S4-story-sources.md` and `research/S5-product-as-designed.md`.

## 1. What the material describes

The **finished product**, Behavioral Targeting and Intelligence (the full name on first use, then "the
engine"), as it is when the current work is complete: capabilities in the present tense. Nothing about build
state, build plans, remediation, stages, rollout order, "designed", "not yet", "today versus later", or
"open" appears anywhere. S5's "today" column and stage column, and S2's labels, are not for the material.
If we can deliver a capability, including one built once for a customer or shown in an earlier demo, it is a
capability of the product. The AI add-ons a customer may switch on with their credits (AI search, the style
concierge, generated imagery) are capabilities too, told as optional.

## 2. The story, in this order, in every piece

1. **The problem.** Most visitors are strangers; most buying happens before any profile exists; tools built
   for known customers are blind in that window; the rules written to compensate go stale, multiply and fight.
2. **What it is.** A personal stylist for every visitor at internet scale: it reads the room, watches without
   interrogating, rearranges the table, pivots when attention moves. It decides the page at the point in
   time from what the visitor is doing now; recommendations rank the past. It is not a recommendations
   engine and does not replace one: it lives alongside whatever recommendations exist and organizes the page
   by interest in real time around them.
3. **What it does**, as capabilities with their use cases (all of these; none left out):
   the first page feels local before the first click; the first click changes the page; channels seed the
   visit (an email, an ad, a social signal, a partner quiz, a campaign term); interest fills and drains like
   buckets, per dimension, with entry and release and a cap, so nobody writes expiration rules, and the
   release is on the receipt; the page's sections and modules reorganize by interest, not only what goes
   inside a slot, and a recommendations carousel is one of the modules it orders; merchandisers keep the
   wheel: gates, pins for the sections they sell, then ranking, with every override and every decision
   written out as arithmetic on a receipt a person can recompute; marketers and data scientists tune every
   constant in the open through published, versioned documents and the console; it learns from outcomes
   behind a dial the brand controls, with holdouts and measured lift; Opal works with it: authoring
   audiences and tests, explaining results, tagging content, proposing and launching experiments and CMAB
   tests on signals, with the serving path itself calling no AI model to decide; it links with ODP and with
   Feature Experimentation; the optional AI add-ons for shoppers; identity carried across sign-in; it runs
   at the edge, close to the visitor, on Cloudflare, with the decisions landing in the brand's own warehouse.
4. **Why customers choose it**, all of the reasons, never ranked and never attributed to one deal: they
   can control it; it decides at the point in time; it is performant at the edge; every decision is
   explainable; it hooks to Opal; AI is theirs to use or not; it learns to the degree they govern; it links
   with ODP; it works alongside their recommendations; it honors the placements they sell. Each customer
   weighs these differently, and the material says so.
5. **How it works**, told the Vantage way: one visitor walked through, then the mechanism, then the
   arithmetic where the reader is technical.
6. **What a customer provides and what we use it for.**

## 3. Fixed sentences

- **Performance:** "We aim to make each decision within about 200 milliseconds at the edge; on average we see
  50 to 250 milliseconds, and tens of milliseconds once the engine has seen the visitor." No other figure, no
  SLA language, no comparison figures from anyone's deck.
- **Learning:** "It records what works from the first day and changes nothing until the brand turns the dial."
- **AI:** "The engine calls no AI model to decide. Opal is where people ask and generative AI creates, and
  that is where credits apply."
- **Recommendations:** "Recommendations rank the past; the engine decides the page at the point in time, and
  the two work side by side."

## 4. Quotations and names

Customers' words may be quoted when the customer is not named: "one of our customers in luxury retail said",
"a home-shopping retailer told us". No customer, prospect or competitor name appears in any piece. The
working notes' positions become our statements in our voice, unattributed. Quotations that carry a gendered
pronoun are paraphrased, not quoted.

## 5. Readers and pieces

One reader per piece, named at the top, each piece the whole story at its reader's depth:

- **Marketing:** the narrative with the stylist and the buckets, the use cases as short scenes, the reasons
  customers choose it, a say/never-say table, and the questions marketing will be asked. No arithmetic.
- **Account executives:** the narrative with the use cases, the reasons customers choose it, the outcomes a
  customer can measure, the discovery questions, what a customer provides, the objections and the sentences
  to say and never to say, and which demo to show for which story.
- **Solutions engineers:** the narrative, then how it works as the Vantage technical note tells it (one
  visitor, the mechanism, the arithmetic, the architecture on Cloudflare, configuration, integration,
  privacy), with the interactive how-it-works page as its companion.
- **Interactive pages:** the engineers' how-it-works, grown from the Vantage page with the engine's
  defaults; a marketing page where the stylist's four moves happen on a page as the reader clicks (the first
  page feels local, the first click changes the page, interest drains and releases, the pin holds), each
  move explained above the instrument in plain words.
- **The credits page**, standalone, as before. **The glossary.** **Which demo shows which story.**

## 6. Devices

One rule first and last. Examples before mechanism. Every instrument explained before it is shown.
Say/never-say with replacements. Plain words a non-technical marketer can retell. Gender neutral, always.
