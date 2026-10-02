# OH: the presenter script

**Hosted: https://edge-platform-oh.expedge.workers.dev/oh/** · version `58c61e9a` from `dcd37e5`, verified hosted on 2026-10-02 (request level 189 of 189, DOM 329 of 329, 51 of 51 regions seeded). TV grid `/oh/?view=tvs`, product `/oh/product?id=<sku>`, phone `/oh/m`.

Sixteen beats in eight acts, each pressed with **Next →**. Figures come from the page lanes' runs on 2026-10-02 (`docs/lg/lanes/P.md`) and the hosted run; where one depends on her state, the walk or the time of day, the script says so, and the screen wins. **OH** is fictional; the products, names, images and prices are LG's as listed on 1 October 2026; offers, packages and regional sales are representative, and the footer says so.

---

## The story for LG

LG's US store already runs our platform: Web Experimentation, Product Recommendations behind both recommendation carousels, ODP segments inside its audiences. The site locates every visitor, turns the location into a census persona, records the search keyword that brought her, and then does nothing visible with any of it: the TVs page is the same with and without the ad's parameters, and the homepage keeps its module order however long she browses. The opportunity is the layer they are missing: a decision at the edge that reads intent from the first request, completes the room rather than the product, remembers her across the weeks an appliance decision takes, hands the profile to their CDP at sign-in, counts the retailer hand-off as an outcome, and shows its reasoning on every card. **It is an expansion of what LG already runs with us, told as their next step.** The account team is in the room.

---

## Before you press anything

> "Nothing on this page ranks anything: it sends what she does, paints what the engine answers, and every card carries its reason. The buy box is off limits: price, sizes, Add to Cart and the financing line are the catalog's, the same for everyone.
>
> Her location is real: the edge reads it from the request, the signal your site already uses for the ZIP in its header, and nothing is asserted unless the page labels it. What leans the page is your regional sales, synthetic here and labelled 'synthetic → warehouse' until your own rows replace them. The census beside them explains the lean and never enters a score.
>
> Price, rewards, financing and rebate eligibility never vary by where someone lives or by income. Your persona carries an income tier; we use the census only to explain, because your own sales say what sells in a state without saying anything about her."

**Mechanics.** `Next →` runs the next beat; `All beats` opens the sixteen and the Compare tools; `Explain` shows what a press will do. The dark panel is the engine: her meters (green tick, the 0.60 entry line; hollow mark, the region's lean), the Arrival tab and the Learned tab. Each decided slot has a before/now strip and a receipt under each card. The quoted lines under **They see** are on screen: point at them.

---

## Act 1. Arrival

### Beat 1. A stranger arrives from search
**Press:** Next. It resets and starts a new visitor from the Google search "lg tvs".
**They see:** the arrival line, from North Carolina "North Carolina, from the request; your sales here lean OLED 65-inch; census shown, not scored · synthetic → warehouse"; the rail and the grid "leans with North Carolina's sales"; the Arrival tab "from the request: the edge located her". Her meters are empty.
**You say:**
> "She searched 'lg tvs' and clicked your ad. We know the search and where the request came from: the panel says [her state], and that's where we are. The term lifts TV in the hero and the deals, as context, never as evidence about her. The rest leans on what sells in this state: your regional sales, synthetic here and labelled."

**Point at:** a TV deal's receipt, the campaign as its own term (+0.060 on the lane runs). Then Compare sets the page before anyone arrived, the site's own order, beside her first paint (the frame title "page · nobody yet" is cosmetic).
**Varies:** the state and its figures are hers (hosted, from North Carolina: $73,958 median household income, 698 synthetic sales). A VPN can place her elsewhere; the panel names what the edge saw.

### Beat 2. The same page, another state
**Press:** Next. The page asserts the first contrast region that leans differently: from North Carolina, Texas (New Jersey leans like North Carolina).
**They see:** "Texas, asserted, not observed"; Texas leans QNED 75-inch; the rail "leans with Texas's sales (asserted)"; the grid opens on a 75-inch QNED.
**You say:**
> "Same stranger, same page. Now I tell the page she's in Texas, and it says so: asserted, not observed. Texas sales lean to a bigger QNED, so the rail and the grid follow. Her meters haven't moved, and the price is the same for everyone."

**Caveat:** the homepage's pieces can hold their order ("The order held; the scores moved"); the rails move. From a state that leans like Texas, the contrast is New Jersey. Say nothing about Texas beyond its sales.

---

## Act 2. Two rooms

### Beat 3. Two TVs, then a washer
**Press:** Next. Back in her own region, through the page's own controls: the TV grid, two TVs, the Laundry menu's WM4000HWA, then home.
**They see:** her meters rise; the room tiles reorder with the reason on the strip; the deals hold both rooms, at most two per room; "Recommended for you holds living room 4 · laundry room 4".
**You say:**
> "Two TVs, then a washer, and the homepage follows her. The meter is touches over touches plus 1.8: two TVs read about 0.53. The tiles reorder on her rooms, and Recommended for you holds both rooms rather than swapping wholesale to the last one. Every receipt names what carried the card."

### Beat 4. The fresh visitor beside her
**Press:** Next: Compare → Fresh visitor on the homepage.
**They see:** "Her homepage, and a fresh visitor's": "same region, same catalog and the same public prices. The fresh visitor arrived direct and has sent nothing".
**You say:**
> "A stranger in the same state, at the same moment, who has sent nothing. What's different on the left is what her visit earned."

**The Compare moves.** **Seam** (default): drag it; arrows nudge it. **Side by side** sets the frames together. **What changed** lists the two answers row by row; use it when the pixels look alike. **Close** or Esc restores her page; the stranger sent nothing.

---

## Act 3. The room completes

### Beat 5. The washer page
**Press:** Next. The WM6500HWA front-load washer, $1,199.00.
**They see:** the buy box marked off limits; below it, the set price when lower, the dryer in her fuel, the pedestal, the stacking kit ("4 modules complete it"), each card "Our merchandiser's rule", each list "in POST /sort's order".
**You say:**
> "Your washer page already has Complete Your Laundry Room. Here it's a rule your merchandiser writes, shown as one: the dryer of this series in her fuel, the pedestal, the stacking kit, and the set price only when the set costs less."

**Point at:** "Completes what she committed to: WM6500HWA (+0.6)"; a set card reading "not lower, so no saving is shown".
**Caveat, the fuel:** "in her fuel" is POST /sort's reading, not the region's. When her own browsing outweighs the region, the lead follows her and the card says so (lane run: "gas leads … North Carolina's sales lean electric, and her own browsing outweighs the region here"). Read the line as written.
**Compare → Fresh visitor on a product page:** same washer and region, nothing of hers. The companions come back for the stranger too: the rule is the product's. Say only what What changed shows.

### Beat 6. She switches to a top-loader
**Press:** Next. The page's own type switch opens the WT8600CW top-loader.
**They see:** the pedestal, the stacking kit, the set price and the sets struck through, "Withdrawn · not decided", each with its reason; the pedestal's reads "A top-loader has no pedestal and does not stack … the rule fails closed." The dryer stays.
**You say:**
> "She switches to a top-loader, and the pedestal leaves. Nothing outscored it: the rule serves front-load pairs only, and the card says so. A rule withdrawing itself."

### Beat 7. The TV page
**Press:** Next. The 65-inch OLED evo C6, OLED65C6PUA.
**They see:** "2 modules complete it": the soundbar from the series' tier, and the OLW480B mount for its VESA pattern, 300 × 200 mm. The buy box keeps "0% APR or as low as $83/mo with Affirm", marked not personalised.
**You say:**
> "Same engine, another room: the soundbar from the series' tier, the mount that fits the TV's VESA pattern; where we don't know a pattern, the card says so. The financing line is yours, as your site shows it; nothing we decide goes near it."

### Beat 8. The range page
**Press:** Next. The LSGL6335X gas slide-in range.
**They see:** the microwave above it, the dishwasher in the same finish, and the gas 3-piece kitchen package: "Together $4,397.00 · apart $4,797.00 · $400.00 less".
**You say:**
> "The kitchen path: the range, the microwave you package with it, the dishwasher in the same finish, and the package, because it costs less than the three apart. The prices are the catalog's; the engine chose which package to show, never what it costs."

---

## Act 4. Curation

### Beat 9. QNED beside OLED, a size up
**Press:** Next. The 65-inch QNED8MB ($699.99), then "9 ft" in the size-up tool.
**They see:** the 65-inch OLED C6 ($1,699.99) beside it: "For a bright room the QNED is the right choice; for a dark room this OLED is."; one size up, the 75-inch QNED8MB at $999.99, over "The price is the same for everyone"; her meters' move (lane run: "size band 75-82 0.00 → 0.53"; it varies with the walk).
**You say:**
> "Premium as curation, not pressure: bright room, QNED; dark room, OLED. She tells us she sits nine feet away, and one size up is the 75-inch. Her answer is declared and moves her own size band. The price is the same for everyone, and nothing decided sits near the financing line."

### Beat 10. She enters a closet width
**Press:** Next. The washer page again, "28 in" in "Will it fit? Tell us your space."
**They see:** "20 of 26 front-load washers fit 28 in · hidden: 6 wider than your space", the six named, and "This one is 27 in wide (the product page): it fits."
**You say:**
> "She enters her closet width, and the six wider than it leave, counted and named. Her measurement is hers: declared, never inferred. A product with no published dimensions stays and says so."

**Caveat:** the count is the data's (the product page's width, else the feed's). Her width rides the next decision, labelled declared, and changes no decision; the receipt does not echo it yet.

---

## Act 5. Windows: the merchandiser's day

Say once: "Each of these is a real publish of your catalog or slots, as a merchandiser would make it."

### Beat 11. An offer's window closes
**Press:** Next. Her last TV page opens (the QNED, on a straight walk); the catalog publishes with the gift-card offer's window closed, with the offers that close with it; then home.
**They see:** on the TV page the NFL Shop eGift Card and free wall mounting "left the page · its window closed [date and time]"; at home, on the deals strip (lane run): "9 offers' windows closed in one publish, and 1 left her homepage; 3 packages with a member out of stock were never shown as complete".
**You say:**
> "A gift-card offer's window closes. On her TV page it leaves on the next decision; nobody switched it off. A package with a member out of stock is never shown as complete, anywhere. Your CMS already timestamps every offer; here every surface honours the window on the next request."

**Varies:** the closing time follows the morning's seed; how many closed offers were in front of her depends on the walk.

### Beat 12. The merchandiser pins a launch
**Press:** Next. The slots publish with "New for 2026: Micro RGB evo." pinned into the deals.
**They see:** the card in container 1, marked PINNED: "pinned by our merchandiser · container 1 for everyone · ranking skipped · without the pin the engine would have led with [a piece], container 2 now" (lane run: "A free Xbox controller with select TVs"; it varies with the walk).
**You say:**
> "Launch week: the merchandiser pins the Micro RGB evo for everyone. The receipt says ranking was skipped and names what the engine would have led with, so an instruction never passes for a decision. The other three are still hers."

---

## Act 6. Three weeks later

### Beat 13. Three weeks later
**Press:** Next. A labelled clock jump: every window moves back 21 days in one publish, and the return visit is asserted from here on, labelled.
**They see:** "Pick up where you left off." over her shortlist, then each room's dial before and after (lane run: "living room 0.795 → 0.733 (−8%) · laundry room 0.769 → 0.701 (−9%) · kitchen 0.357 → 0.281 (−21%)").
**You say:**
> "I can't make you wait three weeks, so this is a labelled clock jump: the windows really moved, and her dials are carried forward by the memory you would publish. The room with less behind it fades further. And the homepage picks up where she left off: what she opened on this device, nothing inferred, kept for the window you publish, with her consent."

**Caveat:** say "laundry faded faster than TV" only when the line says it; the comparison is claimed only when the readings differ. The meters beside the page show her dials as the engine holds them now: its clock is real.

### Beat 14. What changed while she was away
**Press:** Next. "What changed while you were away" on the continue hero.
**They see:** per product, the price marked "held", the offers that ended, the ones still running, and a newer model where the feed lists one (the 2026 C6 beside her 2025 C5). The counts follow her shortlist (lane run: 20 offers ended, 11 still running).
**You say:**
> "What changed while she was away: the offers that ended, the ones still running, a newer model of a TV she looked at. The prices are the catalog's. The page says what changed; it never decides a price."

**Caveat:** there is no price history here. The feed holds one price per product, so every price shows as held; never say a price dropped.

---

## Act 7. One person

### Beat 15. The phone, then sign-in
**Press:** Next. The laptop signs in as Dana Whitfield, a fictional account; a phone at `/oh/m` opens as a second, anonymous visitor, then signs in as Dana.
**They see:** the sheet, "Signed in, the devices you use are one profile, and only then: no device matching, ever"; one request after sign-in, "Signed in as Dana Whitfield · linked at sign-in · consented · no device matching · her laptop's taste, now on this phone: living room, TVs, washers".
**You say:**
> "On her phone she's a stranger. She signs in, the moment your product pages already ask for with member pricing, and one request later the phone opens on the laptop's taste. Linked at sign-in, with her consent; we never match devices. That link is where your CDP learns who she is. The account is fictional, and the worker signs the link; the page never holds the secret."

**Caveat:** Dana is one person across rehearsals, so on the hosted worker her profile is the sum of every walk, newest strongest; when it differs from this laptop's, the line says "the person's signals lead". How many slots change varies.

---

## Act 8. Best Buy counts

### Beat 16. Best Buy counts
**Press:** Next. On the laptop: the C6, the S90TR soundbar, "Choose Best Buy pickup"; the OLW480B mount, "Find a Retailer", Costco; then today's report.
**They see:** "Best Buy pickup chosen … sent as partner_pickup with this module's decision"; the retailer sheet, "the same list for everyone … undercuts no one"; "Referred to Costco … sent as retailer_referral"; in Learned, orders, pickups, referrals and attach, "Attribution, not incrementality", "Not yet significant".
**You say:**
> "Two outcomes your pages already offer and nothing yet counts together. Best Buy pickup is your order, handed over by a partner; Find a Retailer is a referral. Each goes out as a named outcome with the decision that earned it, and the report counts both beside orders and attach. It says attribution, not incrementality, and not yet significant. Lift is yours to compute, in your warehouse, against a holdout."

**Point at:** the "this visit" column, one of each, and the module each was credited to.
**Caveat:** a referral is not a sale; registration is how a sale finds its way back. The day columns sum every walk of the UTC day from folded hours (10 pickups and 9 referrals on the lane run), so they can lag the presses just made.

---

## The two questions the room asks

**"How long does her profile last?"**
> "Four clocks, independent, three of them yours to set. Interest fades per dimension: we ship 14 days, 35 for price band, up to 90; you'd publish 60 to 90 days on type, size and price band, minutes on deal interest. Five touches read 0.74; six weeks later that's 0.12 at 14 days, 0.58 at 60, 0.64 at 90. Retention is a tenant policy from the first event: 30 days on demo tenants, 120 to 180 with your privacy owner. A return is recognised inside a continuity window you publish, up to 90 days; the session token lasts 24 hours. Consent runs 30 days from each explicit choice, and we carry your consent state, Global Privacy Control included, rather than a second banner. Taste lasts as long as you decide; the moment lasts minutes; a return is recognised inside the window you publish, and never without consent."

In this room memory is compressed on purpose (content type and retailer a minute; price tier, feature and intent ten minutes); production runs days.

**"Laptop now, phone later: who is she?"**
> "Two anonymous people, two profiles, until she signs in on either device and your site sends the signed link. Then one profile keeps both histories, each faded by its own clock, and the phone's next page opens on the laptop's taste. No fingerprinting, by design. 'Sign in for member pricing' is the natural moment, and a linked profile keeps the earliest start date, so retention must be long enough to make the link worth it."

---

## Closing

> "A stranger served from her first request, the room completed by your merchandisers' rules, windows and pins honoured on every surface, one person across two devices only at sign-in, and the retailer hand-off counted as an outcome. Nothing personal before sign-in, and no price moved. To run it on yours: your regional sales rows, so the lean is your own sell-through; your catalog feed with a series field, so the series rules read your data; PriceSpider's click events, so a referral is your outcome; a signed sign-in from MyLG, so each link is yours to vouch for."

**If something misbehaves:** beat 1, from All beats, resets and starts a new visitor. If a press stops with "the engine did not decide … so there is nothing to press", say exactly that: the page never adds a module it was not given.

---

## Never say

- That price, rewards, financing or rebate eligibility vary by place or income. The census explains, never scores; nothing sits near the Affirm line.
- That we target by income. LG's persona carries an income tier; we take it as explanation and availability only, and say why early.
- Anything about a protected class or a proxy for one. Household tables are aggregates, never a person.
- That a shopper qualifies for a HEAR energy rebate. They are state-run and income-qualified: her own lookup, never a pre-qualification.
- Anything about TV viewing data (ACR) or ThinQ appliance data; neither is in what we show. Texas settled with LG over ACR in May 2026, so beat 2 is about Texas's sales only.
- That we recognise her across devices without sign-in.
- Any lift, conversion or revenue number of ours. Attach is measured, never claimed.
- That we undercut or reprice a retailer. Retailer price parity and advertised-price rules are LG's; we compete on relevance and service.
- That lg.com fails at anything. Every contrast is their next step on the platform they already run.
- On this walk: that the region chose her fuel; that laundry faded faster unless the line says so; that a price dropped; that a referral is a sale; that a pin is the engine's choice.

---

## The morning routine

- From WSL: `node scripts/demo-kit/host.mjs --config oh --step seed --confirm edge-platform-oh` (the hosted seed, its redeploy, the region seed), then `--step verify`, both suites green.
- The regional prior's horizon is 24 hours, so this runs the morning of every rehearsal; the details are in `RESUME-oh.md`.
