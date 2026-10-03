# OH: the presenter script

**Hosted: https://edge-platform-oh.expedge.workers.dev/oh/** · version `dd29784d` from `6157ae7` (the engine's action speed, lane E4, in it), reseeded on 2026-10-03 with the sixty-second dials (51 of 51 regions, no census term in the lean); the version id moves with each deploy and `docs/oh/RESUME-oh.md` has the current one. TV grid `/oh/?view=tvs`, a product `/oh/product?id=<sku>`, search `/oh/?q=<words>`, the phone `/oh/m`.

OH is a working store first and a scripted walk second: open it cold and click, then walk sixteen beats in eight acts with **Next →**. Figures come from the lane reports of 2026-10-02 and 10-03 and the hosted runs; where one depends on the walk or the time since the last click, the script says so, and the screen wins. Quotes keep the screen's words; a product keeps its own name as the catalog has it. **OH** is fictional; the products, their names, images and prices are the customer's, as listed publicly on or before 2 October 2026; offers, packages, delivery dates, retailer lists and regional sales are representative, and the footer says so.

---

## The story for the customer

The customer's store already runs our platform: Web Experimentation, Product Recommendations behind both carousels, ODP segments inside its audiences. The customer's site locates every visitor, turns the location into a census persona, records the search keyword that brought them, and does nothing visible with any of it: the TVs page is the same with and without the ad's parameters, and the homepage keeps its module order however long anyone browses. The opportunity is the layer they are missing: a decision at the edge that reads intent from the first request, completes the room rather than the product, remembers the visitor across the weeks an appliance decision takes, hands the profile to their CDP at sign-in, counts the retailer hand-off as an outcome, and shows its reasoning on every card. **It is an expansion of what the customer already runs with us, told as their next step.** The account team is in the room.

---

## Before you press anything

**One browser, one person.** The store keeps its visitor in the browser for the session's 24 hours: a reload, a typed address, Back and a new tab are the same person. A reset is how a new person starts: beat 1 forgets the visitor this browser kept and lands a new stranger. A sign-in swaps the kept session for the recognized one.

**The cold open needs a browser that keeps nobody.** A browser that walked the demo in the last 24 hours opens `/oh/` on that visitor's decided page, not the template. Before the meeting, press the director's **Forget this browser**: it forgets the kept visitor, empties the cart and loads `/oh/`, which mints nobody. Check that `/oh/` reads "the published template".

> "Nothing on this page ranks anything. It sends what the visitor does, paints what the engine answers, and every decided card carries its reason. The buy box is off limits: the title, the price, the sizes, the button and the financing line are the catalog's, the same for everyone. Off limits means we never decide it, not that it's dead: Add to Cart works.
>
> The visitor's location is real: the edge reads it from the request, the same signal your site uses for the ZIP in its header, and nothing is asserted unless the page says so. What leans the page is your regional sales, synthetic here and labelled 'synthetic → warehouse' until your own rows replace them. The census sits beside them for context only: no census term enters any score, and none shaped this synthetic lean.
>
> Price, rewards, financing and rebate eligibility never vary by where someone lives or by income. Your persona carries an income tier; we keep the census to explanation, because your own sales say what sells in a state without saying anything about the person."

---

## The store works by hand

Do this before any beat, at `/oh/`, with the director collapsed. It is the most convincing five minutes of the meeting: the room watches the engine answer clicks you make live.

**What a stranger sees.** Before anyone clicks, `/oh/` is the published template in the anatomy of the customer's site: the header with the region chip (a truck and "North Carolina", from the request), the hero carousel ("Score a $200 NFL Shop eGift Card with select TVs.", still until you press play), the service strip, the room tiles, "Discover OH. deals", "Recommended for you" and the footer. Each module the engine will later decide reads "the published template · position 1 · the catalog's own order: nobody has arrived, nothing is decided yet"; Recommended for you is the declared best sellers, "best sellers · the site's own order". The page's only call on load is the region lookup for the chip.

> "This is the store as a stranger sees it. Nothing here is decided, and nobody exists yet: the only thing the page asked was which state the request came from."

**Now open the director** (D) and keep it open for the clicks: "What has been signalled" reads "No dimension has evidence yet."

**The rhythm: click, watch Just now, then click again.** Every event the store sends redraws the panel, the receipts and the before/now strips when the engine answers, exactly as after a press; **Just now**, at the top of the panel, names what the click changed. Wait for it to move, so the room sees each click land; hosted, the answer can take a moment. Between clicks the readings drift down: that is the one-minute dial, not a fault. *Hosted figure, measured by the lead from the live page on 2026-10-03 after lane E4's deploy: an Add to Cart's answer in about half a second (537 ms; ten replayed actions 433 to 587 ms, median 453), and Just now moving with it (542 ms from the click); before E4 the same answer took 1.0 to 2.1 s. A profile read answers in under a tenth of a second.*

Then click, in this order; each line is what the lanes measured by real clicks.

| Click | What it does | Say |
|---|---|---|
| **A room tile:** TVs | **This first click mints the visitor** (one session, consent, the page view). A page view carries no product, so Just now has nothing to name yet. The grid opens decided, "Best match, decided for you", POST /sort over the TVs, "leans with North Carolina's sales · synthetic → warehouse". | "The visitor exists from the first click, not from loading the page." |
| **A filter:** OLED | "47 results", every card an OLED; the filter goes to the engine as a signal, the grid asks again, and Just now names the type and category it carried. Taking it off sends nothing. | "Choosing a filter tells us something about the visitor. Clearing one doesn't." |
| **A product:** any OLED card | The sticky buy bar over "OFF LIMITS … never decided, never personalised"; below, the decided modules with their receipts. Just now lists the TV's attributes at one view's worth (hosted, 2026-10-03: room living-room 0.35, on the panel within two seconds). | "The buy box is yours, never ours. What's below it is decided, and says why." |
| **A size** on the TV, or **a colour** on a washer | The page becomes that model at its own price (WM6500HWA: White $1,199.00, Black steel $1,249.00), and Back returns; Just now names what the select moved. | "The price follows the model, the same for everyone. What the visitor picks is a signal." |
| **Add to Cart** | "Added to your cart: …", the count goes to 1, the drawer opens. The event carries the decisions that led there and weighs three views: Just now shows the product's dimensions jump. | "Adding to the cart counts three times a view, and you just watched it land." |
| **The cart** (the icon) | Lines, quantities, add-ons, the pair saving when a washer and its own dryer are both in, the total. **Checkout** opens "What this demo records": one order event per line against the decision that led to it; "No payment is taken, no card or address is asked for, nothing ships." | "Nothing is charged. The order is recorded against the decision that earned it." |
| **Find a Retailer** (a retailer-only card, or Find a Store on a product page) | The one retailer modal: Buy directly, Best Buy pickup where offered, Online, then Nearby stores in the region from the request; the demo's own list, "not a live PriceSpider answer". A seller pressed sends a referral, credited to a decided where-to-buy module or to none, as the modal says: "A referral is not a sale". | "Every retailer hand-off becomes a named outcome. The list is ours for the demo; in production it's yours." |
| **Back** | One press per page, the grid's filter still on. | |
| **Reload**, or the address in a new tab | The same visitor, with no identity call: the page reopens decided for them, the meters carry on, and the Session tab says "continued". A product page's reload is one more view. | "Still the same person: a reload, a new tab, Back or a typed address. Only a reset starts someone new." |
| **Search:** "front load washer" | The search icon opens the field. "54 results for “front load washer”", in POST /sort's order with the lean's label; the search goes out as a signal. Open a washer. | "Search results come back in the engine's order, over every match." |
| **The wordmark:** home | **The homepage has moved for the visitor**: the room tiles, the deals four and Recommended for you are decided ("decided · POST /sort per room for its 4, then across the rooms"), and the receipts name the visitor's own clicks. On the one-minute dial the page follows the last few clicks (hosted, 2026-10-03: three washers after two TVs led it with the laundry room). | "The page they left was the same for everyone. The page they came back to answers them, and every card says which click carried it. Memory here runs a minute so you can watch it move; production runs days." |
| **Sign in** | The sheet, from any page's header, naming the fictional account Dana Whitfield: "Signed in, the devices you use are one profile, and only then: no device matching, ever." Signing in swaps the kept session for Dana's. | Show it and close it: the sign-in is beat 15's moment. |

The Session tab lists every event the visitor sent. Then **Next** for beat 1.

**Notes.** Type "front load washer", not "washer", which also finds dishwashers. "Place the demo order" and a seller pressed in the modal count in beat 16's day columns. If Just now has not moved, wait: a second click is a second event. Beat 1 lands a new stranger and empties the cart, so nothing from the cold open, a sign-in included, carries into the walk.

---

## The director: your tool, not the room's

The director is docked right, collapsed by default to a slim rail with **Director** and **Next**, so the room sees the store full width. Open it with **D** (outside a text field), the rail's Director button or `/oh/?present=1`; close it with **Hide** or **D**. Open, it shows the engine panel above the director bar, and the store goes to three cards across.

- **Next →** runs the next beat (the rail's Next is the same press). **All beats** opens the sixteen, the region buttons and the Compare tools; **Explain** shows what a press will do.
- The dark panel is the engine. **What has been signalled** has one row per dimension in the registry's order: the leading value and its score, the second beside it, "—" where nothing has evidence, the row's memory ("1 min memory", "10 min memory"), the green tick at the 0.60 entry line, the hollow mark for the region's lean. **Just now**, above the rows, names what the last event changed ("entered the panel", "was 0.36") or says "Nothing in the profile moved on this one."; beneath them, the registry's constants and "Memory is compressed for this room (…); production runs days." Then the tabs Arrival, Session, Why these, Learned (the day report) and Roadmap, and Capture and Compare.
- Each decided slot has a before/now strip ("What was on screen before this press · What changed") and a receipt under each card, redrawn after every event. The quoted lines under **They see** are on screen: point at them.

---

## Act 1. Arrival

### Beat 1. A stranger arrives from search
**Press:** Next. It resets, forgets the visitor this browser kept, and starts a new one from a Google search for the customer's TVs by name (the term is on screen); the cart empties.
**They see:** "North Carolina, from the request; your sales here lean OLED 55-inch; census shown, not scored · synthetic → warehouse"; Recommended for you and the TV grid "leans with North Carolina's sales · synthetic → warehouse"; the Arrival tab: the region from the request, the census for context, the lean labelled "North Carolina: synthetic home sales, fixed seeded lean (no census)". The meters are empty.
**You say:**
> "This visitor searched for your TVs by name and clicked your ad. We know the search and where the request came from: the panel says [the state], and that's where we are. The term lifts TV in the hero and the deals, as context, never as evidence about the person. The rest leans on what sells in this state: your regional sales, synthetic here and labelled."

**Point at:** the hero's or a TV deal's receipt, naming the campaign as its own term. Then Compare sets the template you opened cold beside the first paint.
**Varies:** the state and its figures. Hosted, from North Carolina: the lean reads OLED 55-inch, and the census shows $73,958 median household income (ACS 2024), for context only. A VPN can place the request elsewhere; the panel names what the edge saw.

### Beat 2. The same page, another state
**Press:** Next. The page asserts the first contrast region whose sales lean differently. From North Carolina that is Texas: New Jersey, first on the list, leans OLED 55-inch like North Carolina.
**They see:** "Texas, asserted, not observed; your sales here lean OLED 75-inch"; the rail "leans with Texas's sales (asserted)"; the director's line names what moved and what held.
**You say:**
> "Same stranger, same page. Now I tell the page this visitor is in Texas, and it says so: asserted, not observed. Texas sales lean to a bigger screen, so the rails follow. The meters haven't moved, and the price is the same for everyone."

**Caveat:** the homepage's pieces often hold their order while the rails move; read the line. From a state that leans like Texas, the contrast is New Jersey. Say nothing about Texas beyond its sales.

---

## Act 2. Two rooms

### Beat 3. Two TVs, then a washer
**Press:** Next. Back in the visitor's own region, through the store's own controls: the TV grid, the first TV it offers, Back, the next one, the Laundry menu's WM4000HWA, then home.
**They see:** the meters rise; the room tiles reorder with the reason on the strip; the deals four hold both rooms; "Recommended for you holds living room 4 · laundry room 4" (lane run).
**You say:**
> "Two TVs, then a washer: the kind of clicks you just watched me make by hand, scripted so we can measure them. The meter is evidence over evidence plus 1.8: one product view reads 0.36, two about 0.53. The tiles reorder on the rooms, and Recommended for you holds both rooms rather than swapping wholesale to the last one. Every receipt names what carried the card."

### Beat 4. The fresh visitor beside them
**Press:** Next: Compare → Fresh visitor on the homepage.
**They see:** the visitor's homepage beside a stranger's: "Same page, same moment, same region, same catalog and the same public prices. The fresh visitor arrived direct and has sent nothing: the region’s prior alone. The shopper’s, on the left, is what their visit earned."
**You say:**
> "A stranger in the same state, at the same moment, who has sent nothing. What's different on the left is what this visit earned."

### The Compare moves
**Seam** (the default): drag it, or nudge it with the arrow keys. **Side by side** sets the frames together. **What changed** lists the two answers row by row, for when the pixels look alike. **Close** or Esc restores the visitor's page.

---

## Act 3. The room completes

### Beat 5. The washer page
**Press:** Next. The WM6500HWA front-load washer, $1,199.00, through a link on screen when there is one.
**They see:** the buy bar marked off limits; below it, "Complete your laundry room": the dryer that goes with it, the pedestal, the stacking kit and the laundry sets, each with "Our merchandiser's rule" and the receipt "Completes what was committed to: WM6500HWA (+0.6)". The dryer card says what led and why (lane run): "The 7.4 cu. ft. Front Load Gas Dryer (DLGX6501W) (gas) leads, by POST /sort over the dryers of this series, ahead of the next on: sold here · in the 4-piece laundry set with it; you have shown no fuel yet, so none is claimed for you."
**You say:**
> "Your washer page already has Complete Your Laundry Room. Here it's a rule your merchandiser writes, shown as one: the dryer of this series, the pedestal, the stacking kit. The dryer card says why the gas model leads: it's sold here, and it's in the four-piece set with this washer. This visitor hasn't shown a fuel, so the card claims none."

**Point at:** the dryer card's lead line, then its receipt, where a driver the profile does not carry is marked as the region's: "fuel electric (the region’s lean)".
**Caveat:** the card names a fuel only once the profile carries one; you do the same. The set-price card appears only where a set costs less than its pieces; on this washer none does. Read the line's count of modules as written.
**Compare → Fresh visitor on a product page:** the same washer and region, nothing of the visitor's; the companions come back for the stranger too, because the rule is the product's. Say only what What changed shows.

### Beat 6. A switch to a top-loader
**Press:** Next. The page's own type switch (Front load, Top load) opens the WT8600CW top-loader.
**They see:** the pedestal, the stacking kit and the sets struck through, "withdrawn · not decided", each with its reason; the pedestal's reads "A top-loader has no pedestal and does not stack … the rule fails closed." The dryer stays.
**You say:**
> "The visitor switches to a top-loader, and the pedestal leaves. Nothing outscored it: the rule serves front-load pairs only, and the card says so. A rule withdrawing itself."

### Beat 7. The TV page
**Press:** Next. The 65-inch OLED evo C6, OLED65C6PUA, $1,699.99.
**They see:** the soundbar from the series' tier and the OLW480B mount for its VESA pattern, 300 × 200 mm, each completing the C6. In the buy bar, "0% APR or as low as $83/mo with Affirm", marked "not personalised".
**You say:**
> "Same engine, another room: the soundbar from the series' tier, the mount that fits the TV's VESA pattern; where we don't know a pattern, the card says so. The financing line is yours, as your site shows it; nothing we decide goes near it."

### Beat 8. The range page
**Press:** Next. The LSGL6335X gas slide-in range.
**They see:** the microwave above it, the dishwasher in the same finish, and the gas 3-piece kitchen package: "Together $4,397.00 · apart $4,797.00 · $400.00 less".
**You say:**
> "The kitchen path: the range, the microwave packaged with it, the dishwasher in the same finish, and the package, because it costs less than the three apart. The prices are the catalog's; the engine chose which package to show, never what it costs."

---

## Act 4. Curation

### Beat 9. QNED beside OLED, a size up
**Press:** Next. The 65-inch QNED8MB ($699.99); "9 ft" in "One size up, from where you sit"; then the card's own "Choose the 75″".
**They see:** a 65-inch OLED beside it (the C6 on the lane runs): "For a bright room the QNED is the right choice; for a dark room this OLED is." Then "From 9 ft, your viewing distance, declared, … by this card's own rule, one size up is the 75 Inch Class LG QNED AI QNED8MB Mini LED 4K Smart TV 2026, $999.99", the distance "sent as context". After the press: "You chose the 75″. Sent as select, your own choice".
**You say:**
> "Premium as curation, not pressure: bright room, QNED; dark room, OLED. The visitor tells us they sit nine feet away. That's declared context: it rides the next question and records nothing about any product. The card's own rule says one size up is the 75-inch, and nothing on the meters rises. Then they choose it, with the card's button, and the size band moves, because they chose. The price is the same for everyone, and nothing decided sits near the financing line."

**Caveat:** nothing rises after the distance, only after "Choose the 75″", when Just now names what moved; which dimensions, and by how much, varies with the walk.

### Beat 10. A closet width
**Press:** Next. The washer page again, "28 in" in the fit tool.
**They see:** "20 of 26 front-load washers fit 28 in · hidden: 6 wider than your space", the six named (WM8100HVA, WM8900HBA, WM9000HVA, WM9500HKA, WM9700HPA, WM9900HSA), and "This one is 27 in wide (the product page): it fits."
**You say:**
> "The visitor enters a closet width, and the six wider than it leave, counted and named. The measurement is theirs: declared, never inferred. A product with no published dimensions stays and says so."

**Caveat:** the count is the data's (the product page's width, else the feed's). The width rides the next decision, labelled declared, and changes no decision; the receipt does not echo it yet.

---

## Act 5. Windows

Say once: "Each of these is a real publish of your catalog or slots, as a merchandiser would make it."

### Beat 11. An offer’s window closes
**Press:** Next. The visitor's last TV page opens from the grid (on a straight walk, the QNED from beat 9); the catalog publishes the gift-card offer's window closed, with the offers that close with it, nine pieces in one publish; the TV page asks again; then home.
**They see:** on the TV page's offer strip, the NFL Shop eGift Card and free wall mounting "left the page · its window closed [date and time]". At home, on the deals strip, what left the TV page, then (lane run) "9 offers' windows closed in one publish", how many left the homepage, and "3 packages with a member out of stock were never shown as complete".
**You say:**
> "A gift-card offer's window closes. On this TV page it leaves on the next decision, and the strip says why: its window closed, and when. Nobody switched it off. At home the same publish has closed it everywhere, and a package with a member out of stock is never shown as complete. Your CMS already timestamps every offer; here every surface honours the window on the next request."

**Varies:** the closing time follows the morning's seed, and the counts the walk. A piece still eligible but outranked says "outranked on this answer"; only a closed one says "its window closed".

### Beat 12. The merchandiser pins a launch
**Press:** Next. The slots publish with "New for 2026: Micro RGB evo." pinned into the deals.
**They see:** the card in container 1, marked PINNED: "pinned by our merchandiser · container 1 for everyone · ranking skipped · without the pin the engine would have led with [a piece] (score …), container 2 now" (lane run: "A free Xbox controller with select TVs"; it varies with the walk).
**You say:**
> "Launch week: the merchandiser pins the Micro RGB evo for everyone. The receipt says ranking was skipped and names what the engine would have led with, so an instruction never passes for a decision. The other three are still ranked for this visitor."

**Caveat:** the Micro RGB evo card is in the catalog from the start, so the cold-open template showed it first; the pin makes it lead the decided page for everyone, with ranking skipped.

---

## Act 6. Three weeks later

### Beat 13. Three weeks later
**Press:** Next. A labelled clock jump: every window moves back 21 days in one publish, and the return visit is asserted from here on, labelled.
**They see:** "Pick up where you left off." over the shortlist, "what you opened on this device, nothing inferred"; "21 days later · a labelled clock jump" and a note read from the registry (lane rig: "On the demo’s dial (τ 60 seconds on room, K 1.8; production’s dial runs days) the shopper’s room signals are gone within minutes: living room 0.621 → 0.000 (−100%) · … ; every room below the entry threshold (θin 0.60)."); the receipt "ctx.visit = return, asserted for the clock jump (labelled)".
**You say:**
> "I can't make you wait three weeks, so this is a labelled clock jump: every window really moved back 21 days. Memory in this room runs a minute on purpose, so three weeks leaves nothing of the rooms this visitor browsed, and the note says production's dial runs days. What carries the return is the shortlist: what they opened on this device, nothing inferred, kept for the window you publish, with their consent."

**Caveat:** the note compares rooms only when the readings differ, and on the one-minute dial every room falls to zero: no room "faded faster". The arrows are the three-week projection; the meters show the engine's real clock.

### Beat 14. What changed in the meantime
**Press:** Next. "What changed while you were away" on the continue hero.
**They see:** per product, the price marked "held", the offers that ended (struck through), the ones still running, and a newer model where the feed lists one (the 2026 C6 beside the shortlist's 2025 C5). The counts follow the shortlist (lane run: "8 on your shortlist · 20 offers on it ended · 11 still running · every price held, the catalog's · a newer model listed for 1").
**You say:**
> "What changed in the meantime: the offers that ended, the ones still running, a newer model of a TV on the shortlist. The prices are the catalog's. The page says what changed; it never decides a price."

**Caveat:** there is no price history here. The feed holds one price per product, so every price shows as held; never say a price dropped.

---

## Act 7. One person

### Beat 15. The phone, then sign-in
**Press:** Next. The laptop signs in as Dana Whitfield, a fictional account; a phone at `/oh/m` opens as a second, anonymous visitor in its own region, then signs in as Dana.
**They see:** the sign-in sheet; the phone's first page, a stranger's; one request after its sign-in, under the header, "Signed in as Dana Whitfield", "linked at sign-in · consented · no device matching" and "strongest at sign-in: [three values] · memory compressed for the room; production runs days": the profile's three strongest values across every dimension at the moment of the link. The director's line sets the laptop's beside them.
**You say:**
> "On the phone this visitor is a stranger. They sign in, the moment your product pages already ask for with member pricing, and one request later the phone opens on the laptop's taste: the three strongest signals at the moment of the link. Linked at sign-in, with consent; we never match devices. That link is where your CDP learns who this is. The account is fictional, and the worker signs the link; the page never holds the secret."

**Point at:** "memory compressed for the room; production runs days": here the phone carries what was strongest a moment ago; in production, days of it.
**Caveat:** every reset starts a new Dana (the worker links the name with the reset's generation), so this showing's laptop and phone are one fresh person; anyone who signs in as Dana on the public address after your beat 1 joins it. If the line reads "the person’s signals lead", read it as written. Which three values lead, and how many slots change, varies with the walk and the time since the last click.

---

## Act 8. Best Buy counts

### Beat 16. Best Buy counts
**Press:** Next. On the laptop: the C6, then its S90TR soundbar, and "Choose Best Buy pickup" on the soundbar page's pickup module; Back; the OLW480B mount, where "Find a Retailer" on its retailer module opens the one retailer modal, then Costco; then today's report.
**They see:** on the soundbar page, "Best Buy pickup chosen … sent as partner_pickup with this module’s decision (#1 on this page)"; the modal labelled the demo's own list, "not a live PriceSpider answer"; on the mount page, "Referred to Costco … sent as retailer_referral with this module’s decision (#1 on this page)". In Learned: orders shipped, Best Buy pickups and retailer referrals (day, credited, this visit), attach, the credits by module, "Attribution, not incrementality", "Not yet significant".
**You say:**
> "Two outcomes your pages already offer and nothing yet counts together. Best Buy pickup is your order, handed over by a partner; Find a Retailer is a referral. Each goes out as a named outcome with the decision that earned it: the pickup to the pickup module, the referral to the retailer module. The report counts both beside orders and attach. It says attribution, not incrementality, and not yet significant. Lift is yours to compute, in your warehouse, against a holdout."

**Point at:** the "this visit" column, one of each, and the module each was credited to.
**Caveat:** a referral is not a sale; registration is how a sale finds its way back. The day columns sum every walk and hand press of the UTC day, from folded hours, so they vary and can lag the presses just made. A Find a Retailer from a buy box is credited to no decision, and the modal says so.
**If the report will not build:** late on a day of many rehearsals the engine refuses a day report "too large for the window" (it caps a day's raw records; hosted, 2026-10-02). Point at the two outcomes and their module lines, still on the page; the report starts fresh at midnight UTC (8 PM Eastern until November). On a showing day, keep full rehearsals to a few.

---

## The two questions the room asks

**"How long does a profile last?"**
> "Four clocks, independent, three of them yours to set. Interest fades per dimension: we ship 14 days, 35 for price band, up to 90; you'd publish 60 to 90 days on type, size and price band, minutes on deal interest. Five touches read 0.74; six weeks later that's 0.12 at 14 days, 0.58 at 60, 0.64 at 90. Retention is a tenant policy from the first event: 30 days on demo tenants, 120 to 180 with your privacy owner. A return is recognised inside a continuity window you publish, up to 90 days; the session token lasts 24 hours. Consent runs 30 days from each explicit choice, and we carry your consent state, Global Privacy Control included, rather than a second banner. Taste lasts as long as you decide; the moment lasts minutes; a return is recognised inside the window you publish, and never without consent."

In this room memory is compressed on purpose, and the panel says so: a minute on room, category, subcategory, type, series, panel, size band, capacity tier, fuel, finish, package, content type and retailer; ten minutes on price tier, feature and intent. If asked:
> "Only in this room, so you can watch the page change while I click; production runs days. The dial sets how fast old evidence fades, never how fast a click counts: every click counts at once. We measured it on this store: two TVs, then three washers by hand, and washers lead TVs 0.58 to 0.40, and the next homepage opens on the laundry room. Seven clicks inside a minute carrying a line past the entry line is arithmetic, not a measurement."

The washers figure was measured on the hosted store on 2026-10-03 (room laundry-room over living-room too; the laundry room's hero and deal led the next answer); the seven-click figure is arithmetic, 0.71 with the clicks spread over the minute.

**"Laptop now, phone later: is that one person?"**
> "Two anonymous people, two profiles, until the visitor signs in on either device and your site sends the signed link. Then one profile keeps both histories, each faded by its own clock, and the phone's next page opens on the laptop's taste. No fingerprinting, by design. 'Sign in for member pricing' is the natural moment, and a linked profile keeps the earliest start date, so retention must be long enough to make the link worth it."

If asked why a reload keeps the visitor: "The browser keeps its own session token, as our SDK does, for 24 hours: the same browser, not a device match." Each showing signs in a fresh Dana, and a session a sign-in has retired cannot sign in again.

---

## Closing

> "A stranger served from the first request, a store that answers the visitor's own clicks, the room completed by your merchandisers' rules, windows and pins honoured on every surface, one person across two devices only at sign-in, and the retailer hand-off counted as an outcome. Nothing personal before sign-in, and no price moved. To run it on yours: your regional sales rows, so the lean is your own sell-through rather than our synthetic one; your catalog feed with a series field, so the series rules read your data rather than product names; PriceSpider's click events and your retailer lists, so a referral is your outcome and the list is your partners'; and a signed sign-in from your member accounts, so each link is yours to vouch for."

**If something misbehaves:** beat 1, from All beats, resets and starts a new visitor. If a press stops with "the engine did not decide … so there is nothing to press", say exactly that: the page never adds a module it was not given.

---

## Never say

- That price, rewards, financing or rebate eligibility vary by place or income. The census is shown for context and never scores; nothing sits near the Affirm line.
- That we target by income. The customer's persona carries an income tier; we take it as explanation and availability only.
- That the census, or income, shaped the regional lean. The synthetic lean carries no census term, and no price tier leans by region until the customer's own rows exist.
- That anything about where the visitor is comes from a setting. The region is read from the request at the edge; a contrast is asserted explicitly (beat 2, or a region button under All beats), said aloud, and labelled "asserted, not observed".
- Anything about a protected class or a proxy for one. Household tables are aggregates, never a person.
- That a shopper qualifies for a HEAR energy rebate: state-run and income-qualified, it is the shopper's own lookup.
- Anything about TV viewing data (ACR) or connected-appliance data; neither is in what we show. Texas settled over ACR viewing data in May 2026, so beat 2 is about Texas's sales only.
- That we recognise anyone across devices without sign-in.
- That a minute is what a deployment would remember. Production runs days, and the panel says so.
- Any lift, conversion or revenue number of ours. Attach is measured, never claimed.
- That we undercut or reprice a retailer: price parity and advertised-price rules are the customer's.
- That the customer's site fails at anything: every contrast is their next step on the platform they already run.
- "In your fuel", unless the profile carries a fuel signal and the card says so.
- That the visitor picked the 75-inch before pressing "Choose the 75″", or that the page chose it.
- That a price dropped, or anything that sounds like a price history. The feed holds one price per product.
- That the retailer lists are the customer's data, or a live PriceSpider answer. They are the demo's own, and the modal says so.
- That a referral is a sale, that a pin is the engine's choice, or that laundry faded faster unless the note says so.
- The customer's name on OH's own chrome, never. The products keep their own names and marks.

---

## The morning routine

- From WSL: `node scripts/demo-kit/host.mjs --config oh --step seed --confirm edge-platform-oh`, then the same with `--step verify`; [RESUME-oh.md](RESUME-oh.md) says what each step does. The regional prior's horizon is 24 hours, so this runs the morning of every showing.
- Beat 1's reset starts a new Dana, so no erase is needed between showings; before each cold open, **Forget this browser**, as in "Before you press anything".
