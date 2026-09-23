# Top Offers: the presenter script

**https://edge-platform.expedge.workers.dev/top-offers/**

Fifteen beats, about twenty minutes with questions. Written to be spoken. Every number in it was measured
against the running engine, not estimated. Where something is designed rather than built, the script says so in
the same breath, because one overclaim costs more than the feature is worth with this account.

Fictional retailer: **Lantern & Lane**. Daily deal: **The Lantern Pick**. Twelve live promotions across six
departments, growing to twenty, windows of three to seven days. Those are Jamie's numbers from 22 September,
used deliberately so nobody has to translate.

---

## Before you press anything

> "This is your number one use case, built on our engine. Four containers on a homepage, filled from a pool of
> promotions that each live a few days, ranked per visitor, and judged on clicks into the module.
>
> Two things I want to say before I start. First, nothing on this page ranks anything. The page sends events and
> renders what comes back. Every time the module changes you are watching a decision come back from the service,
> not a script in the browser. Second, I am going to show you the visitor earning the module before I show you a
> single merchandiser control, because the part you were sceptical about is whether the behaviour actually
> drives it."

Then say what they are looking at:

> "The four cards are the module. Below them is the live pool, every promotion the CMS has right now and where
> each one sits in its window. On the right is the session: what this visitor has done, the signals it produced,
> and why these four. I will keep that open the whole time."

**Mechanics you control.** `Next →` runs the next beat. `All beats` opens the full list if you want to jump.
`Explain` (or the E key) opens **Predict, then prove**: press it *before* a beat to state what is about to
happen, or *after* to show why it did. Use it before beats 5, 9 and 11 at least once. It is the difference
between them watching a demo and them watching a claim get tested.

---

## Act 1, beats 1 to 5: the visitor earns it

This act answers the objection you have heard twice already, that this is a black box that starts guessing
immediately. It does the opposite. It refuses to personalise for four straight presses.

### Beat 1. A visitor arrives
**They see:** four containers holding the same defined promotions every visitor gets.
**You say:**
> "Brand new visitor, no history of any kind. Your rule is in force: static defined content until someone has
> viewed five or more pages in their lifetime. Nothing is being personalised. The receipt under each card says
> so, on every card, so a merchandiser can always tell which state they are looking at."

**Closes ask 8 (Jamie).** If they ask where that rule lives: "the page enforces it today and says so on every
receipt. Making it a field on the slot is a small addition and it is designed. I would rather show you the rule
working than tell you which side of the wire it sits on."

### Beat 2. They browse the kitchen shop
**They see:** a department page loads. A meter moves on the right. The module does not move.
**You say:**
> "The cursor clicked Kitchen and Table in the site's own navigation. That page load is the event, the same one
> your `uattr` cookie already computes today. Watch the meter on the right move, and watch the module
> deliberately not move. Still short of five pages."

### Beat 3. They open a Dutch oven
**They see:** four meters rise at once.
**You say:**
> "A product view, the strongest signal in retail, and it carries four things at once: department, subcategory,
> brand and price band. That is one event feeding four dimensions. Still two pages short, so the defaults hold."

### Beat 4. They look at home and beauty
**They see:** the module answers for the first time.
**You say:**
> "That is five pages. Your rule is satisfied, the defaults are released, and the module answers with what it
> actually decided instead of what was defined. This is the first personalised frame in the demo, and it is on
> press four."

### Beat 5. They open a second kitchen item
**Press `Explain` first.** Let it state the arithmetic before it happens, then run the beat.
**You say:**
> "Fourth touch on that department. The affinity is four touches divided by four plus a constant of one point
> eight, which is nought point six nine. The constant is how much evidence we demand before we believe an
> interest, so a single click can never dominate. Nought point six is the entry threshold. Check the meter
> against the arithmetic on screen: there is no hidden model here, it is a number you can audit."

Then the point they care about most:

> "And notice cook only takes two of the four containers. There is a cap per department. You told us not to
> over-personalise and that the module has billboard value. A page that hands all four to one interest is worth
> less to you than a page that keeps range."

**Closes ask 1 and the do-not-over-personalise constraint.**

---

## Act 2, beats 6 to 10: the merchandiser's day

Everything in this act is a real versioned publish against the live tenant. Say that out loud once.

### Beat 6. Two hours pass
**They see:** a promotion leaves the module. Everything below it moves up.
**You say:**
> "A window closed. The promotion leaves the candidate set on the very next decision and the next ranked one
> takes the container. No test ended, no winner was declared, nobody configured anything. Content has start and
> end dates, so expiry is arithmetic, not an experiment being concluded."

**Closes the window requirement.** This is the Adobe contrast, and you do not have to name Adobe: a system that
needs days of traffic to conclude cannot serve a promotion that lives three.

### Beat 7. A new promotion
**They see:** a promotion live for two minutes reaches the module immediately.
**You say:**
> "This one has been live two minutes. Nobody has clicked it, so there is no performance history to rank it on.
> It is placed on its metadata alone, and it still reaches the module on the first decision it is eligible for.
> Your sentence was that a new offer always follows one that leaves. That is this beat."

**Closes ask 5 (Garrett, cold start).** If they ask about enriching their assets with metadata: yes, and it is a
design-time step, not a decision-time one. Say it plainly, it is a real capability.

### Beat 8. Final Hours creative
**They see:** the image and title change. Position and score do not.
**You say:**
> "New creative behind the same content id. Final Hours, exactly as you described it. The image changes, the
> title changes, the score and the position and everything it has learned do not. If you minted a new id for
> Final Hours you would restart its learning at the worst possible moment, in the last hours of the promotion."

**Closes ask 11.** Then ask them the open question, it makes you look like you are building for them:
"Is Final Day a separate id in your CMS today, or the same offer with a flag? That changes one line of the
integration."

### Beat 9. The Lantern Pick
**Press `Explain` first.**
**They see:** the day's pick moves from third to second.
**You say:**
> "The merchandiser puts weight on the day's pick. Nought point two five. It rises from third to second on the
> strength of the beauty department this visitor actually looked at, because the weight is a multiplier on
> interest, not a replacement for it. It cannot manufacture interest that is not there. Their own cook affinity
> still leads."

Then the honest part, which is the bit that earns trust:

> "Turn the number higher and it would lead. That is the merchandiser's call, not a limit I am pretending we
> have. The next beat is what to do when you want it first regardless."

**Closes ask 7 and the TSV question, ask 2.** This is your TSV answer: reinforce while it is live, without
overriding what the shopper is telling you.

### Beat 10. Pin it instead
**They see:** the pick takes container one. The receipt says ranking was skipped.
**You say:**
> "When you want it first for everyone, that is a pin, not a heavier weight. It takes container one and the
> receipt says ranking was skipped for that container. The override is visible as an override. A merchandiser
> six months from now can tell the difference between a decision and an instruction, and so can your analyst."

---

## Act 3, beats 11 and 12: location and weather

### Beat 11. It starts snowing in Washington
**Press `Explain` first.** This is the strongest beat in the demo, let it be predicted.
**You say:**
> "This is Garrett's sentence back to you. It is snowing in the Pacific Northwest, show relevant content to
> those customers. That winter promotion has been in the published pool since beat one and nobody in this room
> has seen it, because its rule needs two things: the Pacific Northwest, and snow. A condition the request does
> not carry fails closed. That matters more than it sounds: a missing weather feed does not accidentally show
> everyone a snow promotion, it shows no one."

Then run it.

> "Assert both and it becomes eligible. And then it has to earn its place by ranking like anything else. It wins
> here because this visitor opened a Dutch oven, and it is the Dutch oven promotion. Eligibility is not a boost."

**Closes ask 10.**

### Beat 12. The same shopper in Florida
**You say:**
> "Nothing about the visitor changed. Same person, same history, same vector. Only the asserted region changed,
> and the promotion is gone. It is still published, still inside its window, still not eligible. That is a rule
> on the piece of content, not a preference we learned."

---

## Act 4, beats 13 and 14: Garrett's two page questions

### Beat 13. Tomorrow the page order changes
**They see:** the module moves to the top. The four cards do not change at all.
**You say:**
> "Garrett asked whether your homepage module order changing daily is a problem for us. Watch the module move to
> position one, and watch the four promotions not change at all. Same four, same order, same scores. A slot is
> addressed by name. `top-offers` is `top-offers` wherever your template puts it, and everything it has learned
> follows the name, not the position."

Point at the neighbouring blocks while you say it:

> "Those three are the rest of your homepage, and they are marked not personalised on purpose. Exactly one
> module on this page is decided per visitor. That is the boundary of what we touch."

### Beat 14. And it wants two pieces, not four
**You say:**
> "His other question: what if the layout wants two pieces tomorrow and four the day after. That is one field on
> a published document, with full history and rollback. It takes the top two of the same ranking. Nothing is
> re-decided, and every exposure and click it has already earned still counts, because it is the same slot."

---

## Act 5, beat 15: the metric

### Beat 15. Clicks into the module
**They see:** two clicks, then the day report per promotion.
**You say:**
> "Two clicks into the module. This is the metric you named, offer clicks and module engagement, and each one is
> credited to the promotion in that container. Open What it learned on the right."

Then read the honest label off your own screen, before they can ask:

> "Notice what the report calls itself. Attribution, not incrementality. These are exposures and clicks, credited
> per promotion. It is not a lift number and we do not present it as one. You told us your data science team
> computes uplift in your own warehouse, so what we owe you is the rows, clean, with the decision that produced
> each one. That is what this is."

**Closes ask 12.**

---

## The questions they will ask, and what is true

| They ask | Say this |
|---|---|
| How fast is it? | "Tens of milliseconds for a shopper we already know. Under three hundred for one we have never seen, where the median is 235. I would rather give you the two numbers than an average that flatters us." |
| How long do you remember? | "Thirty days at the edge. Beyond that your own customer identifier stitches the sessions, which is ask nine on your list and we support it." |
| Beauty over time versus electronics right now? | "That is Kevin's question and it is the sharpest one on the list. Today the vector decays with a half-life, so recency wins by construction. Two horizon memory, holding a durable profile and an in-session one side by side and letting the slot choose, is designed and not built. I am not going to show you a screen for something we have not written." |
| Does it work off the homepage? | "The slot mechanism is not homepage specific, and there is a second container in this demo that only appears on category and search pages. Category, collection and new product pages are ask six and they are the same mechanism with a different slot name." |
| How much configuration is this? | "By category and attribute, never per product. The pool here is twelve pieces with five dimensions of metadata. Your catalog is not loaded at all for this use case, which is the point: you are personalising content, not products." |
| Can we pass our customer id? | "Yes. Server side is supported and Dustin asked for it by name. I have not put it on screen today, so I will show it properly rather than gesture at it." |
| Can you run this server side, rendered by our components? | "Yes. Your CMS stays the source of content, we return decisions by content id, and you render with your own components. That is the integration we would build." |
| What about fifty pieces, or two hundred? | "Fifty is comfortable. The real ceiling is far above anything this use case approaches. I will give you the number in writing rather than guess it in the room." |

---

## What not to say

These cost more than they gain. Every one of them has been checked against the code this month.

- **Do not say the engine creates a bandit, learns, declares a winner and rolls it out.** That was a different
  demo on Optimizely Experimentation. This engine's exploration is rotation and epsilon. Its Thompson mode and
  its autonomy are defective and must not be shown.
- **Do not say "under 200 milliseconds".** It is 235 at the median for a first-time shopper. Use the two numbers
  above.
- **Do not say "no limit".** There is a limit, it is very high, and this use case does not approach it.
- **Do not name the first customer or its brand.** It was named on a call twice already. Not again.
- **Do not claim a news or retail case study for this engine.** There isn't one. The demo is the evidence.
- **Do not describe replay as universal.** A single slot replays exactly. A multi-slot page does not today. The
  four container module is one slot, so what you are showing is safe, but do not generalise it.

---

## Closing

> "Everything you just watched was one slot, one pool of promotions, and one metric. No product catalog was
> loaded. No test was created or concluded. Your CMS stayed the source of the content and your components would
> do the rendering.
>
> What I would want from you next is the shape of your real pool: how many pieces on a normal day, what metadata
> travels with them today, and whether Final Day is a separate id or a flag. With that I can show you this
> running against your own content instead of mine."

---

## If something misbehaves

Reseed and reload, then carry on. Nothing in this demo depends on a beat that already ran, and any beat can be
pressed first: pressing one out of order mints a visitor rather than throwing. If the module ever shows a yellow
notice saying it is showing the site's own defaults, that is the page refusing to invent a module because the
decision service did not answer. Say exactly that. It is a point in your favour, not against you: the page never
makes up a result.

Operational detail for whoever runs the rig, not for the room: a reseed rewrites the beat documents, so it must
be followed by a deploy. See `RESUME-top-offers.md`.
