# OH: the presenter script

**Hosted: https://edge-platform-oh.expedge.workers.dev/oh/** · the working store, version `caec35ec` from `9e35b51`, deployed and seeded on 2026-10-02 (51 of 51 regions, no census term in the lean). Hosted suites on that version: request level 215 of 219, DOM 460 of 463; every failure traced to the day report refusing to build after a day of rehearsals (beat 16's caveat), and the store, the manual session and the sixteen beats passed. A code-only deploy of the engine's priors fix follows, so the version id may move. TV grid `/oh/?view=tvs`, a product `/oh/product?id=<sku>`, search `/oh/?q=<words>`, the phone `/oh/m`.

OH is a working store first and a scripted walk second. Open it cold and click, so the room watches the engine answer a real session; then open the director and walk sixteen beats in eight acts, each pressed with **Next →**. Figures come from the lanes' runs on 2026-10-02 (`docs/lg/lanes/P.md` and its screenshots) and the hosted run; where one depends on her state, the walk or the time of day, the script says so, and the screen wins. **OH** is fictional; the products, their names, images and prices are LG's as listed publicly on or before 2 October 2026; offers, packages, delivery dates, retailer lists and regional sales are representative, and the footer says so.

---

## The story for LG

LG's US store already runs our platform: Web Experimentation, Product Recommendations behind both recommendation carousels, ODP segments inside its audiences. The site locates every visitor, turns the location into a census persona, records the search keyword that brought her, and then does nothing visible with any of it: the TVs page is the same with and without the ad's parameters, and the homepage keeps its module order however long she browses. The opportunity is the layer they are missing: a decision at the edge that reads intent from the first request, completes the room rather than the product, remembers her across the weeks an appliance decision takes, hands the profile to their CDP at sign-in, counts the retailer hand-off as an outcome, and shows its reasoning on every card. **It is an expansion of what LG already runs with us, told as their next step.** The account team is in the room.

---

## Before you press anything

> "Nothing on this page ranks anything. It sends what she does, paints what the engine answers, and every decided card carries its reason. The buy box is off limits: the title, the price, the sizes, the button and the financing line are the catalog's, the same for everyone. Off limits means we never decide it, not that it's dead: Add to Cart works.
>
> Her location is real: the edge reads it from the request, the same signal your site uses for the ZIP in its header, and nothing is asserted unless the page says so. What leans the page is your regional sales, synthetic here and labelled 'synthetic → warehouse' until your own rows replace them. The census sits beside them for context only: no census term enters any score, and none shaped this synthetic lean.
>
> Price, rewards, financing and rebate eligibility never vary by where someone lives or by income. Your persona carries an income tier; we keep the census to explanation, because your own sales say what sells in a state without saying anything about her."

---

## The store works by hand

Do this before any beat, in a fresh browser window (a private window is simplest) at `/oh/`, with the director collapsed. It is the most convincing five minutes of the meeting: the room watches the engine answer clicks you make live, not a script.

**What a stranger sees.** Before anyone clicks, `/oh/` is the published template in lg.com's anatomy: the pencil banner, a header with the category nav, search, "Delivering to North Carolina" (her region, from the request), Sign in and the cart; the hero ("Score a $200 NFL Shop eGift Card with select TVs."); the service strip; the room tiles; "Discover OH. deals"; "Recommended for you"; the showcase and the footer. Each module the engine will later decide reads "the published template · the catalog's own order: nobody has arrived, nothing is decided yet". Recommended for you is the merchandiser's declared best sellers by review count, "best sellers · the site's own order": the four best-selling TVs (the 65-inch OLED B6 first), then four laundry, then four kitchen. The page's only call on load is the region lookup for the ZIP chip.

> "This is the store as a stranger sees it. Nothing here is decided, and nobody exists yet: the only thing the page asked was which state the request came from."

Then click, in this order. Each line is what the lanes measured by real clicks; counts are the feed's.

| Click | What it does | Say |
|---|---|---|
| **A room tile:** TVs | The TV grid. **This first click mints her**: one session, her consent, then the page view. The grid opens decided, "Best match, decided for you", POST /sort over the TVs, labelled "leans with North Carolina's sales · synthetic → warehouse" (113 results on the lane run). | "She exists from her first click, not from loading the page." |
| **A filter:** OLED | "47 results", an OLED chip, every card an OLED. The filter goes to the engine as a signal and the grid asks again; taking it off sends nothing. | "Choosing a filter tells us something about her. Clearing one doesn't." |
| **A product:** any OLED card | Its page in lg.com's anatomy: the sticky buy bar over "OFF LIMITS … the catalog's, the same for everyone · never decided, never personalised"; below, the decided modules, each with its receipt. A product view goes out with the TV's attributes. | "The buy box is yours, never ours. What's below it is decided, and says why." |
| **A size** on the TV, or **a colour** on a washer | The page becomes that model at its own price and Back returns; a select goes out with the variant's attributes. On the WM6500HWA washer: White $1,199.00, Black steel $1,249.00. | "The price follows the model, the same for everyone. What she picks is a signal." |
| **Add to Cart** | "Added to your cart: …", the header's count goes to 1, the drawer opens on her line. The event carries the decisions that led her there. | |
| **The cart** (the icon) | Lines, quantities, Remove, add-ons, the pair saving only when a washer and its own dryer are both in, the total. **Checkout** opens "What this demo records": one order event per line against the decision that led to it; "No payment is taken, no card or address is asked for, nothing ships." | "Nothing is charged. The order is recorded against the decision that earned it." |
| **Find a Retailer** (on a retailer-only card, or Find a Store on a product page) | The site's one retailer modal: Buy directly first, Best Buy pickup where offered, Online, then Nearby stores in her region, from the request. The list is labelled the demo's own, "not LG's data and not a live PriceSpider answer". A seller pressed sends a referral, credited to a decided where-to-buy module when one earned it, else to none, and the modal says which. "A referral is not a sale." | "Every retailer hand-off becomes a named outcome. The list is ours for the demo; in production it's yours." |
| **Back** | The browser's Back, one press per page, the grid's filter still on. | |
| **Search:** "front load washer" | `/oh/?q=front%20load%20washer`, "54 results for "front load washer"", in POST /sort's order with the lean's label; the search goes out as a signal. Open a washer from the results. | "Search results come back in the engine's order, over every match." |
| **The wordmark:** home | **The homepage has moved for her.** The room tiles, the deals four and Recommended for you are now decided ("decided · POST /sort per room for its 4, then across the rooms"), and the receipts name her own clicks (lane run: "room living-room · category tvs · type oled · region US-NC"). | "The page she left was the same for everyone. The page she came back to answers her, and every card says which of her clicks carried it." |
| **Sign in** | The sheet, from the header on any page, naming the fictional account Dana Whitfield: "Signed in, the devices you use are one profile, and only then: no device matching, ever." | Show it and close it: the sign-in is beat 15's moment. |

Then press **D**: the engine panel opens, her meters show what her own clicks moved, and the Session tab lists every event she sent. Then **Next** for beat 1.

**Notes for the cold open.**
- Type "front load washer", not "washer": search matches inside words, so "washer" also finds dishwashers.
- "Place the demo order" sends one purchase per line, and today's report in beat 16 counts it as an order. A seller pressed in the modal counts as a referral there too. Press them only if you want them in the day's columns.
- Beat 1 resets and starts a new stranger, so nothing from the cold open carries into the walk, and the cart empties. Pressing Sign in here is harmless for the same reason.

---

## The director: your tool, not the room's

The director is docked on the right and collapsed by default to a slim rail holding **Director** and **Next**, so the room sees the store full width. Open it with the **D** key (outside a text field, no modifier), the rail's Director button, or by loading `/oh/?present=1`; close it with **Hide** or **D**. It remembers its state per tab; below 1,180 pixels wide the rail is a corner pill. Open, it shows the engine panel above the director bar, and the store goes to three cards across beside it.

- **Next →** runs the next beat (the rail's Next is the same press). **All beats** opens the sixteen and the Compare tools; **Explain** shows what a press will do.
- The dark panel is the engine: "What has been signalled" (her meters: the green tick is the 0.60 entry line, the hollow mark the region's lean, the formula a = R / (R + K) with K = 1.8 printed beneath), the tabs Arrival, Session, Why these, Learned (the day report) and Roadmap, and Capture and Compare.
- Each decided slot has a before/now strip ("What was on screen before this press · What changed") and a receipt under each card. The quoted lines under **They see** are on screen: point at them.
- Keep it open for the walk; close it whenever you want the store alone.

---

## Act 1. Arrival

### Beat 1. A stranger arrives from search
**Press:** Next. It resets and starts a new visitor from the Google search "lg tvs"; the cart empties.
**They see:** the arrival line, from North Carolina: "North Carolina, from the request; your sales here lean OLED 55-inch; census shown, not scored · synthetic → warehouse"; Recommended for you and the TV grid "leans with North Carolina's sales · synthetic → warehouse"; the Arrival tab, her region from the request, the census shown for context and the lean labelled "North Carolina: synthetic home sales, fixed seeded lean (no census)". Her meters are empty.
**You say:**
> "She searched 'lg tvs' and clicked your ad. We know the search and where the request came from: the panel says [her state], and that's where we are. The term lifts TV in the hero and the deals, as context, never as evidence about her. The rest leans on what sells in this state: your regional sales, synthetic here and labelled."

**Point at:** the hero's or a TV deal's receipt, naming the campaign as its own term; paid search on the cell. Then Compare sets the store before anyone arrived, the template you opened cold, beside her first paint.
**Varies:** the state and its figures are hers. Hosted, from North Carolina: the lean reads OLED 55-inch, and the census shows $73,958 median household income (ACS 2024), for context only. A VPN can place her elsewhere; the panel names what the edge saw.

### Beat 2. The same page, another state
**Press:** Next. The page asserts the first contrast region whose sales lean differently from hers. From North Carolina that is Texas: New Jersey, the first on the list, leans OLED 55-inch like North Carolina.
**They see:** "Texas, asserted, not observed; your sales here lean OLED 75-inch"; the rail "leans with Texas's sales (asserted)"; the director's line names what moved and what held.
**You say:**
> "Same stranger, same page. Now I tell the page she's in Texas, and it says so: asserted, not observed. Texas sales lean to a bigger screen, so the rails follow. Her meters haven't moved, and the price is the same for everyone."

**Caveat:** the homepage's pieces often hold their order while the rails move; read the line ("On this answer … moved and … held"). From a state that leans like Texas, the contrast is New Jersey. Say nothing about Texas beyond its sales.

---

## Act 2. Two rooms

### Beat 3. Two TVs, then a washer
**Press:** Next. Back in her own region, through the store's own controls: the TV grid, the first TV it offers, Back, the next one, the Laundry menu's WM4000HWA, then home.
**They see:** her meters rise; the room tiles reorder with the reason on the strip; the deals four hold both rooms; "Recommended for you holds living room 4 · laundry room 4" (lane run).
**You say:**
> "Two TVs, then a washer: the kind of clicks you just watched me make by hand, scripted so we can measure them. The meter is evidence over evidence plus 1.8, printed under the meters: one touch reads 0.36, two about 0.53. The tiles reorder on her rooms, and Recommended for you holds both rooms rather than swapping wholesale to the last one. Every receipt names what carried the card."

### Beat 4. The fresh visitor beside her
**Press:** Next: Compare → Fresh visitor on the homepage.
**They see:** her homepage beside a stranger's: "Same page, same moment, same region, same catalog and the same public prices. The fresh visitor arrived direct and has sent nothing: the region's prior alone. Hers, on the left, is what her visit earned."
**You say:**
> "A stranger in the same state, at the same moment, who has sent nothing. What's different on the left is what her visit earned."

### The Compare moves
**Seam** (the default): drag it; the arrow keys nudge it. **Side by side** sets the frames together. **What changed** lists the two answers row by row; use it when the pixels look alike. **Close** or Esc restores her page; the stranger sent nothing.

---

## Act 3. The room completes

### Beat 5. The washer page
**Press:** Next. The WM6500HWA front-load washer, $1,199.00, through a link on screen when there is one.
**They see:** the buy bar marked off limits; below it, "Complete your laundry room": the dryer that goes with it, the pedestal, the stacking kit and the laundry sets, each with "Our merchandiser's rule", each receipt "Completes what she committed to: WM6500HWA (+0.6)", each list "in POST /sort's order". The dryer card says what led and why; on the lane run: "The 7.4 cu. ft. Front Load Gas Dryer (DLGX6501W) (gas) leads, by POST /sort over the dryers of this series, ahead of the next on: sold here · in the 4-piece laundry set with it; she has shown no fuel yet, so none is claimed for her."
**You say:**
> "Your washer page already has Complete Your Laundry Room. Here it's a rule your merchandiser writes, shown as one: the dryer of this series, the pedestal, the stacking kit. The dryer card says why the gas model leads: it's sold here, and it's in the four-piece set with this washer. She hasn't shown a fuel, so the card claims none for her."

**Point at:** the dryer card's lead line, then its receipt, where a driver her profile does not carry is marked as the region's: "fuel electric (the region's lean)".
**Caveat:** the card names her fuel only once her profile carries one; you do the same. The set-price card appears only where a set costs less than its pieces; on this washer none does, so it is not on the page. Read the line's count of modules as written.
**Compare → Fresh visitor on a product page:** the same washer and region, nothing of hers. The companions come back for the stranger too: the rule is the product's. Say only what What changed shows.

### Beat 6. She switches to a top-loader
**Press:** Next. The page's own type switch (Front load, Top load) opens the WT8600CW top-loader.
**They see:** the pedestal, the stacking kit and the sets struck through, "Withdrawn · not decided", each with its reason; the pedestal's reads "A top-loader has no pedestal and does not stack … the rule fails closed." The dryer stays.
**You say:**
> "She switches to a top-loader, and the pedestal leaves. Nothing outscored it: the rule serves front-load pairs only, and the card says so. A rule withdrawing itself."

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
**They see:** a 65-inch OLED beside it (the C6 on the lane runs): "For a bright room the QNED is the right choice; for a dark room this OLED is." Then "From 9 ft, your viewing distance, declared, sizes from 67 to 89 inches fill 30 to 40 degrees of the view: by this card's own rule, one size up is the 75 Inch Class LG QNED AI QNED8MB Mini LED 4K Smart TV 2026, $999.99", over "The distance is sent as context and records nothing about a product; choosing a size is yours." After her press: "You chose the 75″. Sent as select, your own choice", with what it moved on her meters.
**You say:**
> "Premium as curation, not pressure: bright room, QNED; dark room, OLED. She tells us she sits nine feet away. That's declared context: it rides the next question and records nothing about any product. The card's own rule says one size up is the 75-inch, and her meters don't move. Then she chooses it, with the card's button, and her size band moves, because she chose. The price is the same for everyone, and nothing decided sits near the financing line."

**Caveat:** never say the page picked the 75-inch for her. Her meters hold after the distance and move only after "Choose the 75″"; which dimensions move, and by how much, varies with the walk.

### Beat 10. She enters a closet width
**Press:** Next. The washer page again, "28 in" in the fit tool.
**They see:** "20 of 26 front-load washers fit 28 in · hidden: 6 wider than your space", the six named (WM8100HVA, WM8900HBA, WM9000HVA, WM9500HKA, WM9700HPA, WM9900HSA), and "This one is 27 in wide (the product page): it fits."
**You say:**
> "She enters her closet width, and the six wider than it leave, counted and named. Her measurement is hers: declared, never inferred. A product with no published dimensions stays and says so."

**Caveat:** the count is the data's (the product page's width, else the feed's). Her width rides the next decision, labelled declared, and changes no decision; the receipt does not echo it yet.

---

## Act 5. Windows: the merchandiser's day

Say once: "Each of these is a real publish of your catalog or slots, as a merchandiser would make it."

### Beat 11. An offer's window closes
**Press:** Next. Her last TV page opens from the grid (on a straight walk, the 65-inch QNED from beat 9); the catalog publishes with the gift-card offer's window closed, and the offers that close with it, nine pieces in one publish; the TV page asks again and holds; then home for the package half.
**They see:** on the TV page's offer strip, the NFL Shop eGift Card and free wall mounting "left the page · its window closed [date and time]" (on the lane rig, "October 1 at 7:59 AM"). At home, on the deals strip, what left the TV page, then (lane run) "9 offers' windows closed in one publish", how many left her homepage, and "3 packages with a member out of stock were never shown as complete": two kitchen packages and the heat-pump laundry set.
**You say:**
> "A gift-card offer's window closes. On her TV page it leaves on the next decision, and the strip says why: its window closed, and when. Nobody switched it off. At home the same publish has closed it everywhere, and a package with a member out of stock is never shown as complete. Your CMS already timestamps every offer; here every surface honours the window on the next request."

**Varies:** the closing time follows the morning's seed; how many closed offers were in front of her depends on the walk. A piece that is still eligible but lost its place says "outranked on this answer" instead; only a closed one says "its window closed".

### Beat 12. The merchandiser pins a launch
**Press:** Next. The slots publish with "New for 2026: Micro RGB evo." pinned into the deals.
**They see:** the card in container 1, marked PINNED: "pinned by our merchandiser · container 1 for everyone · ranking skipped · without the pin the engine would have led with [a piece], container 2 now" (lane run: "A free Xbox controller with select TVs"; it varies with the walk).
**You say:**
> "Launch week: the merchandiser pins the Micro RGB evo for everyone. The receipt says ranking was skipped and names what the engine would have led with, so an instruction never passes for a decision. The other three are still hers."

**Caveat:** the Micro RGB evo card is in the catalog from the start, so the cold-open template showed it first in the catalog's own order. What the pin changes is her decided page: it now leads for everyone, with ranking skipped.

---

## Act 6. Three weeks later

### Beat 13. Three weeks later
**Press:** Next. A labelled clock jump: every window moves back 21 days in one publish, and the return visit is asserted from here on, labelled.
**They see:** "Pick up where you left off." over her shortlist ("what you opened on this device, nothing inferred, kept for the window we publish, with your consent"), then "21 days later · a labelled clock jump" with each room's dial projected three weeks on (lane run: "living room 0.795 → 0.733 (−8%) · laundry room 0.769 → 0.701 (−9%) · kitchen 0.357 → 0.281 (−21%)"), and "ctx.visit = return, asserted for the clock jump (labelled)".
**You say:**
> "I can't make you wait three weeks, so this is a labelled clock jump: every window really moved back 21 days, and her dials are projected three weeks on by the memory you would publish. The room with less behind it fades further. And the homepage picks up where she left off: what she opened on this device, nothing inferred, kept for the window you publish, with her consent."

**Caveat:** say "laundry faded faster than TV" only when the line says it; it is claimed only when the readings differ. The meters beside the page show her dials as the engine holds them now: its clock is real, and the line says "projected".

### Beat 14. What changed while she was away
**Press:** Next. "What changed while you were away" on the continue hero.
**They see:** per product, the price marked "held", the offers that ended (struck through), the ones still running, and a newer model where the feed lists one (the 2026 C6 beside her 2025 C5). The counts follow her shortlist (lane run: "8 on her shortlist · 20 offers on it ended · 11 still running · every price held, the catalog's · a newer model listed for 1").
**You say:**
> "What changed while she was away: the offers that ended, the ones still running, a newer model of a TV she looked at. The prices are the catalog's. The page says what changed; it never decides a price."

**Caveat:** there is no price history here. The feed holds one price per product, so every price shows as held; never say a price dropped.

---

## Act 7. One person

### Beat 15. The phone, then sign-in
**Press:** Next. The laptop signs in as Dana Whitfield, a fictional account; a phone at `/oh/m` opens as a second, anonymous visitor in her own region, then signs in as Dana.
**They see:** the sheet, "Signed in, the devices you use are one profile, and only then: no device matching, ever"; the phone's first page, a stranger's; one request after its sign-in, "Signed in as Dana Whitfield · linked at sign-in · consented · no device matching · her laptop's taste, now on this phone: living room, TVs, washers" (lane run), and the chip "signed in as Dana Whitfield".
**You say:**
> "On her phone she's a stranger. She signs in, the moment your product pages already ask for with member pricing, and one request later the phone opens on the laptop's taste. Linked at sign-in, with her consent; we never match devices. That link is where your CDP learns who she is. The account is fictional, and the worker signs the link; the page never holds the secret."

**Caveat:** every reset starts a new Dana: the worker links the name with the reset's generation, so this showing's laptop and phone are one fresh person and nobody from an earlier showing is in her. Anyone who signs in as Dana on the public address after your beat 1 does join her; if the line reads "the person's signals lead", the person's taste is not the laptop's alone, so read it as written. How many slots change varies.

---

## Act 8. Best Buy counts

### Beat 16. Best Buy counts
**Press:** Next. On the laptop: the C6, then its S90TR soundbar, and "Choose Best Buy pickup" on the soundbar page's pickup module; Back; the OLW480B mount, where "Find a Retailer" on its retailer module opens the store's one retailer modal, then Costco; then today's report.
**They see:** on the soundbar page, "Best Buy pickup chosen … sent as partner_pickup with this module's decision (#1 on this page)"; the modal labelled "The stores below are the demo's own list, not LG's data and not a live PriceSpider answer (TVs and audio)"; on the mount page, "Referred to Costco … sent as retailer_referral with this module's decision (#1 on this page)". In Learned: orders shipped, Best Buy pickups and retailer referrals (day, credited, this visit), attach, the credits by module, "Attribution, not incrementality", "Not yet significant".
**You say:**
> "Two outcomes your pages already offer and nothing yet counts together. Best Buy pickup is your order, handed over by a partner; Find a Retailer is a referral. Each goes out as a named outcome with the decision that earned it: the pickup to the pickup module, the referral to the retailer module. The report counts both beside orders and attach. It says attribution, not incrementality, and not yet significant. Lift is yours to compute, in your warehouse, against a holdout."

**Point at:** the "this visit" column, one of each, and the module each was credited to.
**Caveat:** a referral is not a sale; registration is how a sale finds its way back. The retailer lists are the demo's own, not LG's data. The day columns sum every walk and every hand press of the UTC day, the cold open's included, from folded hours (10 pickups and 9 referrals on a lane rig), so they vary and can lag the presses just made. A Find a Retailer pressed from a buy box, where no decided module earned it, is credited to no decision, and the modal says so.
**If the report will not build:** late on a day of many rehearsals the engine refuses a day report "too large for the window" (it caps a day's raw records; this happened hosted on 2026-10-02). The two outcomes and their module lines still stand on the page: point at those, and say the day's report starts fresh at midnight UTC (8 PM Eastern until the clocks change in November). On the day of a showing, keep full rehearsals to a few.

---

## The two questions the room asks

**"How long does her profile last?"**
> "Four clocks, independent, three of them yours to set. Interest fades per dimension: we ship 14 days, 35 for price band, up to 90; you'd publish 60 to 90 days on type, size and price band, minutes on deal interest. Five touches read 0.74; six weeks later that's 0.12 at 14 days, 0.58 at 60, 0.64 at 90. Retention is a tenant policy from the first event: 30 days on demo tenants, 120 to 180 with your privacy owner. A return is recognised inside a continuity window you publish, up to 90 days; the session token lasts 24 hours. Consent runs 30 days from each explicit choice, and we carry your consent state, Global Privacy Control included, rather than a second banner. Taste lasts as long as you decide; the moment lasts minutes; a return is recognised inside the window you publish, and never without consent."

In this room memory is compressed on purpose (the panel says so: price tier, feature and intent ten minutes; content type and retailer a minute); production runs days.

**"Laptop now, phone later: who is she?"**
> "Two anonymous people, two profiles, until she signs in on either device and your site sends the signed link. Then one profile keeps both histories, each faded by its own clock, and the phone's next page opens on the laptop's taste. No fingerprinting, by design. 'Sign in for member pricing' is the natural moment, and a linked profile keeps the earliest start date, so retention must be long enough to make the link worth it."

If asked about the demo's own account: each showing signs in a fresh Dana, and a browser session that a sign-in has retired cannot sign in again.

---

## Closing

> "A stranger served from her first request, a store that answers her own clicks, the room completed by your merchandisers' rules, windows and pins honoured on every surface, one person across two devices only at sign-in, and the retailer hand-off counted as an outcome. Nothing personal before sign-in, and no price moved. To run it on yours: your regional sales rows, so the lean is your own sell-through rather than our synthetic one; your catalog feed with a series field, so the series rules read your data rather than product names; PriceSpider's click events and your retailer lists, so a referral is your outcome and the list is your partners'; and a signed sign-in from MyLG, so each link is yours to vouch for."

**If something misbehaves:** beat 1, from All beats, resets and starts a new visitor. If a press stops with "the engine did not decide … so there is nothing to press", say exactly that: the page never adds a module it was not given.

---

## Never say

- That price, rewards, financing or rebate eligibility vary by place or income. The census is shown for context and never scores; nothing sits near the Affirm line.
- That we target by income. LG's persona carries an income tier; we take it as explanation and availability only, and say why early.
- That the census, or income, shaped the regional lean. It did not: the synthetic lean carries no census term, and no price tier leans by region until LG's own rows exist.
- Anything about a protected class or a proxy for one. Household tables are aggregates, never a person.
- That a shopper qualifies for a HEAR energy rebate. They are state-run and income-qualified: her own lookup, never a pre-qualification.
- Anything about TV viewing data (ACR) or ThinQ appliance data; neither is in what we show. Texas settled with LG over ACR in May 2026, so beat 2 is about Texas's sales only.
- That we recognise her across devices without sign-in.
- Any lift, conversion or revenue number of ours. Attach is measured, never claimed.
- That we undercut or reprice a retailer. Retailer price parity and advertised-price rules are LG's; we compete on relevance and service.
- That lg.com fails at anything. Every contrast is their next step on the platform they already run.
- "In her fuel", unless her profile carries a fuel signal and the card says so.
- That she picked the 75-inch before she pressed "Choose the 75″", or that the page chose it for her.
- That a price dropped, or anything that sounds like a price history. The feed holds one price per product.
- That the retailer lists are LG's data, or a live PriceSpider answer. They are the demo's own, and the modal says so.
- That a referral is a sale, that a pin is the engine's choice, or that laundry faded faster unless the line says so.

---

## The morning routine

- Beat 1's reset starts a new Dana, so no erase is needed between showings: open cold, then walk.
- From WSL: `node scripts/demo-kit/host.mjs --config oh --step seed --confirm edge-platform-oh` (the hosted seed, its redeploy, the region seed), then `--step verify`, both suites green; the regional prior's horizon is 24 hours, so this runs the morning of every rehearsal.
