# OH page lanes P1, P2, P3 and the suites lane S1

**Opened 2026-10-02 by the lead; they start when K4's scaffold exists under `public/oh/` and D1's feed is in (it is).** The governing design is [OH-Demo-Design.md](../OH-Demo-Design.md); the use cases and the honesty lines are [LG-Understanding-and-Use-Cases.md](../LG-Understanding-and-Use-Cases.md) §4 and §6; the chassis is the kit, [Demo-Kit-Design.md](../../demo-kit/Demo-Kit-Design.md), with Vantage's page as the worked example (`public/vantage/vantage.js`, `beats.json`, `index.html`, `phone.html`). Realism rule: real products by their real names and images, LG's palette, no mark.

## Shared facts

- Data: `public/oh/products.json` (D1; attributes, companions, fits), `public/oh/specs.json` (D2; title, prices, cta, dimensions, VESA, image per sku, merged over the feed by sku on the page), `public/oh/img/index.json` and `MANIFEST.json` (D2), `public/oh/catalog.json` (D1's pieces; the slots and their names are design §2), `public/oh/beats.json` (K4's sixteen beats as data; the lanes fill their presses and outcomes).
- Engine items from E1 (`complements`, the two partner outcomes, the regional prior on `/sort`, paid search from the auto-tagged click) may land during the lanes; E1 has landed: a product page sends `ctx.anchor=<sku>` (the engine's complements rule prefers pieces that complete it, with the receipt line "Completes what she committed to") and `ctx.family=<family>` (D1's companion pieces gate on it, fail closed); the two outcomes go on the wire as `type: 'custom'` with `data.event` set to `partner_pickup` or `retailer_referral`, credited like a click within 30 minutes and reported under the day report's named outcomes, never as a purchase; `/sort` leans with the region when the tenant publishes `learn.regional.dimensions` and labels the answer `regional`, which the grid and the "for you" rail must show on screen ("leans with North Carolina's sales · synthetic → warehouse"); the auto-tagged Google click is classified as paid search but the entry contract does not yet carry `gclid`, so the arrival beat asserts the channel on the request and the receipt says "asserted". A lane writes to the receipt what is in force.
- Every call carries `X-Tenant: oh`; the page never ranks, never asserts except through labelled presenter controls, never carries a credential; the buy box is off limits and marked so; the visitor's region is the request's; the regional lean is labelled synthetic; nothing sits near a financing line.
- One writer per path. The lanes share `public/oh/oh.js` by section markers K4 leaves: `// ── home and grid (P1)`, `// ── product pages (P2)`, `// ── phone, sign-in, where-to-buy, report (P3)`; a lane edits only its section and the facts it owns. Shared helpers go in `public/oh/oh-shared.js`, owned by P1, requested by message through the lead.

## P1: homepage and TV grid; beats 1–4 and 11–14

`index.html`, `grid.html` (the TV grid), the P1 section of `oh.js`, `oh.css` (the page's styles; the tokens are K4's), `oh-shared.js`. Renderers: the hero, the category rail in decided order, the deals four, the "for you" rail across rooms through `/sort`, the continue hero; the grid with the regional lean and the fit filter (beat 10's input lives on the grid and the product page; P1 owns the grid's). The presses and outcomes of beats 1–4 and 11–14 in `beats.json`. The arrival with `utm_term=lg tvs` and the real region; the labelled region contrast; the clock jump as a labelled beat (Vantage's exit re-ask is the pattern); the merchandiser pin's receipt line.

## P2: product pages; beats 5–10

`product.html`, the P2 section of `oh.js`. The TV, washer and range pages on one template: an off-limits buy box (price, sizes or colours, Add to Cart, the financing line as the site shows it, never touched), then the decided modules: companions (the dryer in her fuel, the pedestal unless top-load, the stacking kit, the pair price; the soundbar for the series, the mount for the VESA pattern; the microwave, the dishwasher, the package when cheaper), protection, installation, haul-away, the series comparison with the honest sentence, the fit input ("hidden: 3 wider than your space"), the specs. Beats 5–10's presses and outcomes. The top-loader switch withdraws the pedestal with its reason on the card.

## P3: phone, the live sign-in, where-to-buy outcomes, the report; beats 15–16

`m.html`, the P3 section of `oh.js`, and `src/routes/oh.ts` for one addition: a demo sign-in route, mounted under the demo profile only, taking a fictional account name from a closed list in `src/demos/oh.config.ts`, minting the signed identity assertion server-side with the worker's `IDENTITY_SECRETS` (never on the page), calling the identity link, and returning only success; the page then re-asks and shows "linked at sign-in · consented · no device matching" on the receipt. Where-to-buy: Best Buy pickup and Find a Retailer as the two named outcomes, sent as E1's outcomes when they exist and as named custom events until then, each credited to the decision on screen. The day report panel: orders, partner pickups, referrals, attach, labelled attribution, "not yet significant". Beats 15–16. Tests for the route beside it; the existing route tests unmodified.

## S1: the two OH suites on the kit libraries

`scripts/rehearse-oh-page.mjs` and `scripts/rehearse-oh-dom.mjs` on `scripts/demo-kit/lib/rehearse.mjs` and `lib/cdp.mjs`, `scripts/demo-kit/configs/oh.json`. The request-level suite: the served files, no token anywhere the page loads, `X-Tenant` on every call, the beat route's closed names, the receipt's own-decisions rule, the arrival four with the real region, every beat's claimed effect measured as Vantage's suite measures them. The DOM suite: the sixteen presses in a fresh Chrome profile with computed visibility only, the before/now row legible after each, Compare opening on every press with real pixels, Fresh visitor on the homepage and a product page, the sign-in beat's receipt line, the two outcomes recorded, no horizontal overflow, no broken image. S1 writes assertions as the lanes land their beats and reports the counts; "the page never ranks" and "no credential" are asserted on day one.

## Definition of done, each lane

The lane's beats perform through the director with their declared effects measured true on a local rig; the lane's assertions in S1 green; `check-demo --config oh` green against the rig at the end; screenshots at 1440 under `docs/lg/lanes/shots/`; the lane's section in this file's Report; the four Vantage files it must never touch untouched.

## Rig

One shared local OH rig would serialise the lanes, so each lane runs its own: P1 on 9123 with `.wrangler/state-p1`, P2 on 9124 `.wrangler/state-p2`, P3 on 9125 `.wrangler/state-p3`, S1 on 9126 `.wrangler/state-s1`, each provisioned locally as K4's Report documents and seeded with `scripts/demo-kit/seed.mjs --config scripts/demo-kit/configs/oh.json`; the seed rewrites `public/oh/beats/*.json`, so a lane snapshots those by hash before seeding and uses `--out` under its scratchpad for every seed after the first.

## Rules

As every lane: no commit, no deploy, no push, no cloud resource of any kind, nothing against any hosted worker; no `git checkout/reset/stash/restore/switch/rm`, no `rm -rf`, no installs, no process kills except your dev server; secrets only from the local `.dev.vars`, never printed or written; preserve every pre-existing uncommitted file; `public/vantage/**`, `public/demo-kit/**`, Top Offers and other sessions' files are not yours.

## Reports

(each lane writes its own section here: P1, P2, P3, S1)

### P1: homepage and TV grid; beats 1–4 and 11–14

**Lane P1, builder, 2026-10-02, 11:45–13:05 EDT. Built: the homepage and the TV grid on the kit; beats 1–4 and 11–14 perform through the director with their declared effects measured; my blocks at the end of both OH suites' outcomes; `check-demo --config oh` 5 of 5 against my rig. Nothing committed, deployed or pushed; no cloud resource; nothing sent to a hosted worker.**

#### Results (rig 9123, `.wrangler/state-p1`, provisioned with `rig.mjs --prepare`, seeded with `seed.mjs --config oh --out <scratchpad>` and `region-seed.mjs` 51 of 51)

| Check | Result |
|---|---|
| `check-demo --config oh --base http://localhost:9123` | **5 of 5**: generated (through WSL), typecheck no error, credentials 1,956 files no finding, **request level 175 of 175**, **DOM 306 of 306** (every shell at 1440 and 1366, the sixteen presses) |
| My blocks | request level 18 checks, DOM 16 checks, all green; S1's own outcomes for beats 3, 4, 13 and 14 were written against my code during the session and pass beside them |
| The walk in Chrome at 1440 | all sixteen beats land `done` in order, no script error, no horizontal overflow, no broken image |
| Known items (printed, not failing) | beat 11 shows no closing offer leaving her page; beat 13's "laundry faded faster" (S1's assertion of the earlier copy); beat 15's rig has no `IDENTITY_SECRETS` and a receipt 503 while beat 16's report builds (P3's) |

#### What each beat does, measured

| # | The press | Measured on screen and on the wire |
|---|---|---|
| 1 | a stranger lands from “lg tvs”, her region from the request | the arrival line above the hero, read off the cold-start panel: “North Carolina, from the request; your sales here lean OLED 65-inch; census shown, not scored · synthetic → warehouse”; the hero and the deals carry the campaign seed and her region's driver; Recommended for you and the TV grid lean on POST /sort and say so in the answer's own label, “leans with North Carolina’s sales · synthetic → warehouse” |
| 2 | the contrast, asserted and labelled | the page asserts the first configured contrast region whose sales lean differently from hers, read off the panel (New Jersey leans OLED 65 like North Carolina, so Texas, QNED 75): “Texas, asserted, not observed”; the rail “leans with Texas’s sales (asserted)”; the grid opens on a 75-inch QNED |
| 3 | two TVs, then a washer | through the page's own controls: the TV grid, the first TV it offers her, the browser's Back, the next one, the header's Laundry menu (static, the same for everyone) and the WM4000HWA, then home. Room and type rise on her meters; the room tiles reorder with the reason on the strip; the deals four hold both rooms by the slot's rule; Recommended for you holds living room 4 · laundry room 4 |
| 4 | the fresh visitor beside her | Compare → Fresh visitor: her homepage beside a direct stranger's in the same region, nothing sent, What changed row by row; her page and address come back from state |
| 11 | the gift card's window closes; the packages | the five pieces the publish closed, where each was (on screen, a candidate, neither) and that none is answered again, on the deals strip in the engine's voice; the three packages the catalog holds out of stock (two kitchen, the heat-pump laundry set) named with the member that keeps each incomplete, never decided nor a recorded candidate on a member's own page, and absent from every answer of the visit |
| 12 | the merchandiser pins Micro RGB evo | container 1 for everyone, its receipt “pinned by our merchandiser · ranking skipped · without the pin the engine would have led with A free Xbox controller with select TVs, container 2 now”, read off a ranked deal's own receipt; the request suite proves it by asking the slots without the pin |
| 13 | three weeks later, labelled | every window moves back 21 days in one publish; her dials (the engine's read) carried three weeks on by the published memory (R = aK/(1 − a), R·e^(−t/τ), back to a) room by room; ctx.visit = return asserted and labelled from here on; the continue hero opens on her shortlist (what she opened on this device, nothing inferred); the line says the engine's own clock is real |
| 14 | what changed while she was away | the continue hero's own button opens the shortlist's deltas, read off the documents in force: per product the price (held, the catalog's), the offers that ended, the ones still running with the days left, a newer model where the feed lists one (the 2026 C6 beside her 2025 C5) |

The TV grid at `/oh/?view=tvs` (a direct load is a real arrival on it): POST /sort over every priced TV with the regional prior and its label, the grid's promotion, the facets and sort marked off limits, and her declared space (an input, quick chips, Apply): a TV wider than it leaves the candidates before the engine sees them, and the page says “Hidden: 50 wider than your space (58 in, declared by you, never inferred) · 4 without a listed width are kept, unmeasured”. Every picture is D2's accepted image by sku, else the row's own; a product with none, or one that fails to load, shows its name on a neutral tile.

#### The page never ranks

“For you” is the engine's twice over: one POST /sort per room over that room's products, the first four of each answer, then one POST /sort across the twelve in the products file's own order, rendered as that answer returns it (one question over all 367 would swap wholesale: living room 8). The grid sends the products file's own order. The `featured` sort the coordinator flagged is gone; the only sorts left in my section are the two S1 names as explanations (a card's strongest driver on its rank line, her vector for Compare).

#### Shared wiring: `LANES` in `oh.js` (written once, P1)

One object before `createDemo` through which each section registers its slot renderers, page asks, verbs, before/now rows, facts, controls, Compare tools, beat starts, boot steps and panel hooks (`render`, `ask`, `verbs`, `rows`, `facts`, `controls`, `compareTools`, `beforeBeat`, `boot`, `hooks.regionalDriver/why/snapshot/fresh`); P2 and P3 use it. For P2's request through the coordinator: their CSS block is appended verbatim under “The grid and the product page”, and `homeRows()` exists for the merge `rows: () => ({ ...homeRows(), ...productRows() })` (the line today is `rows: () => LANES.rows`, which both sections fill, so either works). Compare's fresh visitor answers on the homepage and the grid, and on any page whose section registers `LANES.hooks.fresh[pageKey] = { ask(f), paint(f, set) → restore }`.

#### For the lead

1. **Beat 11 shows no offer leaving her page on the walk as built** (both suites' known item). The closing offers are rarely in front of her: the gift-card hero and deal carry few tags, and after beat 9's size-up big screens outranks free wall mounting. The fix is in the config's beat 11 change list: it closes the homepage pieces but not their product-page twins (`offer-tv-gift-card`, `offer-tv-matching-soundbar`, `offer-tv-sound-suite`, `offer-tv-free-mounting`), so today the same offers stay on every TV page after their window closes. Close those four and reseed, and beat 11 can start on her TV page, where the room sees the gift card leave; I add that press when the document carries it.
2. **Beat 13's “laundry faded faster than TV”** holds only when laundry has less evidence: room has one memory (τ 60 days), and the walk as built gives laundry as much as TV by then (beats 5, 6 and 10), so both fade −9%. The beat now declares “the room with less behind it fades further” and says “laundry faded faster” only when its own numbers do; S1's known check still asserts the earlier claim. If the claim must hold on this walk, the registry gives laundry a shorter memory of its own.
3. **Beat 14 has no price that moves across the jump**: the feed holds one price per sku and the clock jump moves windows only. The beat shows what does change, the offers, and the newer model the feed lists; a moving price is a data decision (a representative overlay published with the jump, labelled).
4. **The continue hero's stage**: `hero-continue` fits `considering` and `deciding`, the registry's stages are `thinking` and `deciding`; its receipt shows what the engine scored.

#### Files

`public/oh/index.html` (the service strip from LG's own reasons-to-buy strip, the continue module first, the grid's heads), the P1 section of `public/oh/oh.js` and the shared `LANES` wiring, `public/oh/oh.css` (the P1 block; P2's block appended for P2), `public/oh/beats.json` (beats 1–4 and 11–14 only), the P1 blocks at the end of the outcomes in `scripts/rehearse-oh-page.mjs` and `scripts/rehearse-oh-dom.mjs`, eleven screenshots `docs/lg/lanes/shots/P1-1440-*.png` (the grid on a direct load and with her space declared, then beats 1, 2, 3 with the full homepage, 4, 11, 12, 13, 14), and this section. No `grid.html` (the grid stays at `/oh/?view=tvs`, so `docs/oh` needs no change), no `oh-shared.js` (nothing was asked of it). I never wrote `public/oh/beats/*.json`: every seed of mine went to my scratchpad with `--out`; four of the nineteen (`11-window-closes`, `13-three-weeks`, `anchor`, `open-catalog`) changed during the session by another lane's seed and are left as they are. The rig is stopped; its state is kept.

### P2: product pages; beats 5–10

**Lane P2, builder, 2026-10-02, 11:43–13:10 EDT. Built: the product page for the TV, the washer and the range on one template; beats 5–10 perform through the director with their declared effects measured; the kit's `transport.ask` context hook, with the product page switched to it; my checks in both OH suites (S1 has integrated them beside its own, beat by beat); `check-demo --config oh` 5 of 5 against my rig. Nothing committed, deployed or pushed; no cloud resource; nothing sent to a hosted worker.**

#### Results

| Check | Result |
|---|---|
| `check-demo --config oh --base http://localhost:9124` (rig 9124, `.wrangler/state-p2`, `rig.mjs --prepare`, `seed.mjs --config oh`, `region-seed.mjs` 51 of 51) | **5 of 5**: generated (through WSL), typecheck no error, credentials 1,956 files no finding, **request level 175 of 175**, **DOM 306 of 306** |
| P2's checks inside those runs | request level **15**, DOM **49** check lines (the buy box on four pages, then the six beats), all green |
| The walk in Chrome at 1440, and direct loads at 1440 and 1366 | beats 1–10 land `done` in order; WM6500HWA, OLED65C6PUA, LSGL6335X and KSTK4 loaded directly: no script error, no horizontal overflow, no broken image (KSTK4, with no image anywhere, shows its name on a neutral tile) |
| `node --test scripts/demo-kit/lib/*.test.mjs` | 139 tests: 137 pass, 2 skip (sharp on Windows), none fails |
| **Vantage, against the transport change** (my rig 9128, `.wrangler/state-p2v`, `rig.mjs --config vantage --prepare`, `seed-vantage.mjs`, `seed-vantage-region.mjs` 51 of 51) | **request level 115 of 115**; and the DOM suite, since `ask()` is what the page calls: **298 of 298**. The 19 seed-written files (18 beat documents and `catalog.json`; four already carried lane C2's 12:13 seed) were hashed first and put back by hash: my seed changed four, all four restored, 19 of 19 matched the snapshot at 12:44. At 12:58 another session returned `public/vantage` to HEAD; I left that. Rig stopped, state kept |

#### What each beat does, measured

| # | The press | Measured |
|---|---|---|
| 5 | the washer page, WM6500HWA (the front-load washer whose width is in the feed, the lead's ruling), through a link on screen when there is one, else the address bar | decided with `ctx.anchor = WM6500HWA` and `ctx.family = front-load-washer` through the hook; the dryer, the pedestal, the stacking kit and the pair price each decided with the receipt line “Completes what she committed to: WM6500HWA (+0.6)”, on the answer and on the ledger record; each card states its rule as our merchandiser's; every list inside a module is in POST /sort's own order (one call per page view), labelled “leans with North Carolina’s sales · synthetic → warehouse”; asked without the anchor and the family none of them comes back, the anchor alone opens nothing, the family alone completes nothing |
| 6 | the page's own type switch (static: each type's best seller at this price tier) to the top-loader, WT8600CW | the pedestal, the stacking kit, the pair price and the two sets are withdrawn on screen, not decided, each card saying why: the feed's own words first (“A top-loader has no pedestal and does not stack”), then its rule (front-load washers and dryers only; this page asserts `ctx.family = top-load-washer`; the rule fails closed); the before/now strip says the same; the dryer stays, completing WT8600CW |
| 7 | the C6 65″ page | the soundbar for its series and the mount for its VESA pattern, both completing OLED65C6PUA; the mount card names 300 x 200 mm and shows OLW480B, whose own listing carries that pattern; the financing line as the site shows it, “0% APR or as low as $83/mo with Affirm”, marked not personalised |
| 8 | the range page, LSGL6335X | the microwave and the dishwasher completing it; a package that costs less than its pieces, at the catalog's own figures: “Together $4,397.00 · apart $4,797.00 · $400.00 less” |
| 9 | the QNED page, 65QNED8MBAA (2026 Mini LED, bright room), then “9 ft” in the size-up tool | the comparison decided, with “For a bright room the QNED is the right choice; for a dark room this OLED is.” and “The price is the same for everyone”, the 65″ OLED beside it by POST /sort; one size up by the piece's own figures, 75QNED8MBAA at $999.99; her declared distance moves her own meters, read from her profile before and after and said on the line: “size band 75-82 0.00 → 0.53, price tier better 0.68 → 0.76”; no decided module speaks of financing and the buy box holds no decision |
| 10 | the washer page again, “28 in” | “20 of 26 front-load washers fit 28 in · hidden: 6 wider than your space”, the count the data holds (the product page's width, else the feed's: the lead's current ruling); the six named (WM8100HVA, WM8900HBA, WM9000HVA, WM9500HKA, WM9700HPA, WM9900HSA) and none shown; the next decision asserts `ctx.fit = 28` beside the anchor and the family, labelled declared, and changes no decision; a product with no dimensions published is shown and said so, never hidden |

The page, top to bottom: the buy box, off limits and marked so (the page's own title, D2's image, the price with its struck list price, sizes for a TV's series or colours for a finish letter, Add to Cart, Notify Me or Find a Retailer as the feed says, the financing line as the site shows it, nothing decided inside); the static type switch; pdp-modules in the engine's order (companions with their rule, packages, protection, installation, haul-away, the series and panel comparisons, the size-up and fit tools, where-to-buy through P3's `whereToBuyBody`), each with its receipt; the withdrawn cards; pdp-offers; the static specs (dimensions, VESA, capacity, fuel, finish, features, rating), with the fit tool there when the engine did not decide it on this page. Compare's Fresh visitor works on a product page through P1's hook: the same product, region, anchor and family, nothing of hers; her page is put back from her own answer.

#### The kit change: a context hook on `transport.ask`

`ask(pageKey, v, { context })` and an optional `config.context(pageKey, v)` send a page's own signals as `ctx.<name>` beside region and intent, which stay the kit's; an empty value or a name the engine refuses is not sent; `asked` carries them. With neither, a snapshot is exactly what it was, which the two Vantage suites prove. The product page asks through it (`LANES.ask.product`). The scaffold's `askWithContext` and the product branch in the shared `askPage` are now unreachable and can go when the shared code's owner next touches it; the scaffold template (`scripts/demo-kit/templates/`, K4's) could use the hook for the next demo.

#### For the lead

1. **The ledger consumer stalls on wrangler dev under the suites' load** (receipts answer 202 until the reader gives up: “no record”); restarting the rig clears it, and the green run above is on a restarted rig. The log fills with “Configuration publication authority unavailable” from `LearnStats.priorsFor` (Vantage resume, finding 3), possibly the cause.
2. **The dryer “in her fuel” is the engine's reading, not the region's.** On WM6500HWA POST /sort leads with the gas dryer: it is sold here, in this washer's set and white like it, while the electric one is retailer-only. The card says so: “gas leads … North Carolina’s sales lean electric, and her own browsing outweighs the region here”. S1 has adopted that check.
3. My styles are P1's `oh.css` block, applied verbatim from the selectors I sent; I waited for nothing.
4. `product.html` now carries index.html's shell (P1's home and grid views) with the product view's own containers, so a direct load and a walk from the homepage paint the same page.
5. **Copy fix after P1's final run (13:40).** A piece that leaves a product page's before/now strip because the catalog in force says so now says why, read from the document the page read before the publish (the beat's own document, `state.pieces`): “left the page · its window closed October 1 at 7:59 AM” (or “its window opens …”, or out of stock); “outranked on this answer” stays only for a piece still eligible that lost its place. On beat 11's TV page the strip reads, for the gift card and free wall mounting, “left the page · its window closed October 1 at 7:59 AM”. The DOM suite on my rig after the fix: **329 of 329**; beats 5–11 **148 checks, none failing** (5: 26, 6: 19, 7: 22, 8: 22, 9: 25, 10: 19, 11: 15).

#### Files

`public/oh/product.html`, the P2 section of `public/oh/oh.js`, `public/oh/beats.json` (beats 5–10 and the place `p2-product`), `public/demo-kit/transport.js` (the context hook only), my checks in `scripts/rehearse-oh-page.mjs` and `scripts/rehearse-oh-dom.mjs` (S1 integrated them), fifteen screenshots `docs/lg/lanes/shots/P2-1440-*.png` (each beat's page and its modules, beat 6's withdrawn cards, beat 9's size-up, beat 10's fit tool), and this section. `public/oh/beats/*.json` were hashed before my first seed and are at HEAD, 19 of 19 by hash (another lane put them back at 12:16, after my seed). The OH rig is stopped; its state is kept.

### P3: phone, the live sign-in, where-to-buy outcomes, the report; beats 15–16

**Lane P3, builder, 2026-10-02, 11:40–13:20 EDT. Built: the demo sign-in route with its tests, the two mount lines, the phone, where-to-buy with its two named outcomes, the day report's outcomes, and beats 15–16. Both beats perform through the director with their declared effects measured; my checks run inside both OH suites; `check-demo --config oh` 5 of 5 against my rig. Nothing committed, deployed or pushed; no cloud resource; nothing sent to a hosted worker; no engine file touched.**

#### Results (rig 9125, `.wrangler/state-p3`, running `src/index.ts` itself: the copy-of-index trick was not needed once the mount lines were in)

| Check | Result |
|---|---|
| `check-demo --config oh --base http://localhost:9125`, run last, on the files as left | **5 of 5**: generated (through WSL), typecheck no error, credentials 1,956 files no finding, **request level 187 of 187**, **DOM 326 of 326** |
| My checks inside the suites (S1 folded them into its order, marked "Lane P3's checks") | request level 14, DOM 17, all green |
| `src/routes/oh.test.ts` (new) | **11 of 11**. The existing route tests beside it are unmodified and green: `vantage.test.ts` 21, `vantageColdStart.test.ts` 13 |
| App typecheck (`tsc --noEmit --incremental false --composite false`, WSL) | exit 0, with the mount lines in `src/index.ts` |
| All of `src/routes` | 301 tests: 247 pass, 54 fail, all in `identity.test.ts` (9), `realtime.sdkContract.test.ts` (44) and `sort.test.ts` (1). None of these files imports `src/index.ts` or `src/routes/oh.ts`. The identity failures are in `docs/remediation/baseline-failures.json`; the other two files fail the same way on their own |
| Demo kit node tests (`scripts/demo-kit/lib/*.test.mjs`, the worker-config test) | 145: 144 pass, 1 skipped (Chrome under WSL). `rig.test.mjs` takes the applied mount lines as "already mounted" |
| Screenshots | ten under `docs/lg/lanes/shots/`: `P3-1440-15-phone-signed-in`, `P3-1440-15-session-journey`, `P3-1440-16-pickup-chosen`, `P3-1440-16-referral-confirmed`, `P3-1440-16-report-outcomes` (taken at 1440×1800 so the machine panel shows the whole report), `P3-390-phone-stranger`, `P3-390-sign-in-sheet`, `P3-390-phone-signed-in`, `P3-390-retailer-module`, `P3-390-find-a-retailer-sheet`. No horizontal overflow at 390 |

#### The route: `POST /oh/api/sign-in { account }` (`src/routes/oh.ts`)

- **Demo profile only.** Elsewhere the route answers 404 before any session is looked at.
- **One input.** The body must be `{ account }` and nothing else, and the account must be a name from `OH_ACCOUNTS`, which K4 wrote and I left unchanged: `Dana Whitfield`. Prototype names, near misses, the account id itself and any extra field are refused with 400.
- **Only the caller's own browser.** It needs her shopper capability on the `oh` tenant. Another tenant's capability gets 404, and a browser that is already signed in gets 409.
- **The assertion is minted in the worker.** It uses the identity code's own `secretsFor` and `signAssertion` over tenant, her visitor, a fictional account id derived from the name (`oh-demo-dana-whitfield`) and a 120-second expiry. It is spent only on an in-process call to the ordinary `POST /v1/oh/identity/link`, with her capability, `X-SDK-Key` and `Cookie` passed on, so the verification, the merge, the consent and the session rotation are the engine's. With no identity secret configured, the route answers 503 and sends nothing.
- **The answer is exactly `{ ok, linked, session }`**, plus the link's session cookies. The tests and both suites assert that no assertion, account id, shopper-id field, audience or secret appears in the body or the headers. Nothing is logged.
- **Ruling needed (deviation from the brief).** The brief said "only success and the linked flag". The answer also carries `session` because the link retires her anonymous session: her own object forwards to the person and refuses the old capability (401, asserted in the suite). The page therefore has to carry the recognised session, just as the SDK's `identify()` adopts it from the link route's own answer. The session is her own shopper capability, the same kind the session route already hands the page. I chose this rather than leave a page that cannot continue after sign-in.

**The tests** (`src/routes/oh.test.ts`) cover: absent off the demo profile; the closed list, including prototype names; the caller's own browser only; the assertion verifying for exactly her visitor and account and failing for another visitor; the answer and headers free of the secret, the proof and the account id; a refused link reported without the proof; no secret, no mint; the kit's routes still in place beside the new one; the account list frozen.

The merge runs through the real identity link and real `ShopperReflex` objects. A laptop with taste and a phone with less sign in as Dana; afterwards the person holds both histories, the laptop's leads, and the phone's new session reads it while the retired anonymous sessions read nothing. A second press from the same browser is the engine's idempotent receipt: it folds nothing twice.

**Why the merge test seeds through the objects.** Taste is seeded through the objects' own consent and ingest doors, as live traffic accrues it. Seeding the KV session directly, as `identity.test.ts`'s session-host block does, never reaches the object the DO-path link transfers from, which is why "the person is the sum" is a baseline failure there.

#### What each beat does, measured (DOM suite, fresh Chrome profile, after the whole walk)

| # | The press | Measured on screen and on the wire |
|---|---|---|
| 15 | **Laptop sign-in.** `laptopFirst`, then the header's Sign in, then the sheet's "Sign in as Dana" on the laptop (skipped when already signed in) | two `POST /oh/api/sign-in` in the press, each with its own session and `X-Tenant`, no Authorization, the post body exactly `{"account":"Dana Whitfield"}`, each answer exactly `linked,ok,session` |
| 15 | **The phone, a stranger.** `pickUpPhone`: a second, anonymous visitor at phone width (`body.shell--phone`, `/oh/m`), her own region from the request | its homepage is asked as a stranger, and its meters hold none of the laptop's lasting taste |
| 15 | **The phone signs in.** Sign in, then "Sign in as Dana" | one request later: the same page answered differently (category-rail and deals moved); the meters read `room:living-room, category:tvs, category:washers`, the laptop's three strongest lasting signals; both visitors' sessions name one recognised shopper; the receipt under the header reads "Signed in as Dana Whitfield · linked at sign-in · consented · no device matching · her laptop’s taste, now on this phone: living room, TVs, washers"; the who chip says "signed in as Dana Whitfield", not "anonymous"; the director's sentence says what the meters say |
| 16 | **Best Buy pickup.** `backToLaptop`, the C6 page, then the S90TR soundbar it goes with (its own tile, else the address bar), then "Choose Best Buy pickup" | one `custom` with `data.event: partner_pickup`, carrying the `decisionId`, `contentId`, slot `pdp-modules` and `customerContentId` of the pickup decision in that page's snapshot answer |
| 16 | **Find a Retailer.** Back, then the OLW480B mount it goes with, then "Find a Retailer", then Costco in the PriceSpider-shaped list | one `retailer_referral`, credited the same way; the module says "Referred to Costco … sent as retailer_referral with this module’s decision (#1 on this page)" and "A referral is not a sale" |
| 16 | **The day report.** `dayReport`: the kit builds today's report, then the outcomes are read beside it | on screen: Orders shipped (visitors who purchased), Best Buy pickups and Retailer referrals (day, credited, this visit), Attach (companion modules, credited clicks of exposures), the credits by module, "Not yet significant", the kit's "Attribution, not incrementality". The engine's own report counts one more of each outcome than before the beat, and the screen's numbers equal it. The request-level checks show both outcomes credited to the decision that earned them (`bySlot['pdp-modules'][mod_where_to_buy_…]` +1, `credited` +1), and the day's purchases unmoved |

On `m.html` alone, a direct load is a real arrival: a stranger decided live, her region from the request. Sign in names the account; after it, the receipt line names what her other signed-in devices brought.

#### Where-to-buy, for P2 (P2 already calls it)

`whereToBuyBody(d, p)`, defined in my section, is the body of `mod-where-to-buy-pickup` and `mod-where-to-buy-retailer`:

- **Pickup.** "Choose Best Buy pickup", offered only when the product's own `attributes.retailer` includes `best-buy-pickup`; otherwise the module says there is nothing to press.
- **Find a Retailer.** It opens the retailer sheet. The buy box's own `data-act="find-retailer"` button opens the same sheet; there, a referral is credited to the where-to-buy decision on screen, or to none when the engine decided none on that page, and the sheet says which.
- **Ordering of the handlers.** My handler runs before `LANES.controls`, so P2's `find_a_retailer` custom is sent from my handler, unchanged.
- **Why beat 16 uses the soundbar and the mount.** With take 6, where-to-buy does not make the top six on the TV, range or washer pages for a stranger (probed on the rig). The soundbar family has three eligible modules and the mount family one, and both pages are the C6's own companions.

#### Shared code I touched in `oh.js` (one-line delegations, all labelled P3; P1 kept them when it wrote `LANES`)

1. `...p3Verbs()` in the verbs.
2. `report: p3Report()`, giving the report's names, rows and attach.
3. `if (await p3Control(t)) return true;` at the top of `handleControl`.
4. `...p3Facts()` in `facts()`.
5. The boot's `ENTRY === 'phone'` branch that calls `phoneArrival()`.

My section also registers `LANES.ask.phone`, so the phone asks through P1's homepage question, and a `LANES.beforeBeat` reset on beat 1. Its few styles are injected from the section, so `oh.css` is untouched. One of them removes the drawn bezel below 480 px, because a real phone is its own frame.

#### For the lead

1. **`IDENTITY_SECRETS` is needed wherever beat 15 runs.**
   - **Local rigs.** `.dev.vars` has none, and `rig.mjs` passes only TENANTS, SDK_KEYS and RETENTION, so on P1's and S1's rigs the sign-in answers 503 (P1's report notes it). My rig ran `rig.mjs`'s own `rigEntry`, `rigVars` and `rigCommand` from a scratch launcher that adds one `--var IDENTITY_SECRETS:oh:<random per process>`. The secret was held in memory and never printed or written; it satisfies `safeIdentitySecret`, which applies because the OH worker is `AUTH_MODE=enforced`. The kit item: `rig.mjs` does the same, or takes `--var`.
   - **The hosted worker.** Add `IDENTITY_SECRETS` (`oh:<secret>`) to the secrets list K4 printed. Creating it is the owner's one-time approval.
2. **Dana is one person across rehearsals.** Every sign-in folds that browser into her, and her long memory is 60 days, so on a hosted demo her profile is the sum of every walk, the newest strongest. The phone's receipt names the person's taste, which on a single walk is the laptop's. Erasing her between rehearsals would be an operator erase (`/v1/oh/identity/erase`), a destructive operation, so it is an owner decision. I built nothing for it.
3. **A local queue stall.** About 40 minutes into the rig, the local queue consumer stopped delivering (no `QUEUE events-oh` batch after a `learning_incomplete` warning), so new outcomes never reached the ledger and the day report could not count them. Restarting my own dev server cleared it, and it did not recur over two full check-demo runs. A rehearsal that shows the report on a long-running local rig may meet it; the page says what the report says and the suite fails honestly rather than passing.
4. **Kit gap.** `panels.renderWho` writes "anonymous" for every visitor. My section corrects the chip for a signed-in visitor through an observer; the kit should read `v.session.kind`.
5. **A recognised visitor's old receipts.** The link retires the anonymous capability, so the sign-in swaps in a new visitor object under the same key rather than mutating the session. A receipt read still in flight for her earlier decisions then finishes on the session they were made in, instead of a 400.

#### Files

| File | What I changed |
|---|---|
| `src/index.ts` | the import and the two mounts, exactly as K4 printed them |
| `src/routes/oh.ts` | `ohSignInRoutes`, composed into `ohRoutes` |
| `src/routes/oh.test.ts` | new |
| `public/oh/m.html` | the sign-in control's semantics and the receipt container in the markup, and a shell comment |
| the P3 section of `public/oh/oh.js` | the section, plus the five delegations above |
| `public/oh/beats.json` | beats 15 and 16 only |
| `scripts/rehearse-oh-page.mjs`, `scripts/rehearse-oh-dom.mjs` | my blocks, now in S1's order |
| `docs/lg/lanes/shots/` | the ten `P3-*.png` |
| this file | this section |

**Not touched:** `src/demos/oh.config.ts`, any engine file, `public/demo-kit/**`, `public/vantage/**`, `index.html`, `product.html`, `oh.css`.

**Seed and restore.**
- **Snapshot.** The nineteen beat documents were snapshotted by hash at 11:44, equal to HEAD.
- **Before my seed.** Another lane's seed had rewritten four of them at 11:49.
- **My one seed** (`seed.mjs --config oh`, in place, then `region-seed.mjs`, 51 of 51 regions) rewrote the same four. I ran no later seed.
- **Restore.** Before my final run, the four files that still held my seed's output went back to the HEAD snapshot, and all nineteen matched it.
- **After the restore.** At 13:07:54 another lane rewrote the beat documents (`11-window-closes` and `13-three-weeks` differ from HEAD, anchor as committed); I left them as they are.

**The rig** is stopped and its state kept.

### S1: the two OH suites on the kit libraries

**Lane S1, builder, 2026-10-02, 11:43–13:50 EDT. Done: both OH suites built out from K4's arrival checks to all sixteen beats, on `lib/rehearse.mjs` and `lib/cdp.mjs`. The day-one checks were green from the first run. P1's, P2's and P3's blocks are integrated into each suite's order. Six mutations were caught, each by the check that names it. `check-demo --config oh` passed 5 of 5 on my rig: request level 189 of 189, DOM 329 of 329, no known item. Nothing committed, deployed or pushed; no cloud resource; nothing sent to a hosted worker.**

#### Runs, with the counts

The rig ran on port 9126 with `.wrangler/state-s1` (inspector 9276), launched by `rig.mjs --prepare` and seeded once in place with `seed.mjs --config oh` and `region-seed.mjs` (51 of 51). The request-level suite ran from WSL. The DOM suite ran from Windows: Chrome, a fresh profile each run, 1440×900, with every shell also loaded at 1366.

| Time | What had landed | Request level | DOM |
|---|---|---|---|
| 11:51 | K4's scaffold suites, unchanged (baseline) | 46 of 46 | 29 of 29 |
| 12:03–12:11 | Day one, in my structure (beats 1, 2, 11 and 12 run; the rest `notBuilt`) | 85 of 85; then 87 with the beat-body and reset checks: 1 failed, the never-ranks guard on P2's new sorts, read and named | 4 of 89 failed (my Compare tag patterns ignored `text-transform`); then 89 of 89 |
| 12:16–12:23 | P2's beats 5–10 | 110: 2 failed (the guard on P1's two new sorts, read and named; beat 11's unseen closing offer, made a known item for P1); then 109 of 109, 1 known | 207: 6 failed (my readers, P2's dryer and meters, as ruled below) |
| 12:32–12:42 | P1's 3, 4, 13 and 14; P3's 15 and 16 | 148: 2 failed; then 148 of 148, 3 known | 292: 8 failed, 4 known; then 291: 2 failed |
| 12:48–12:55 | P1's and P3's blocks integrated | 175: 5 failed (the queue stall, finding 2); after a rig restart, 175 of 175, 3 known | 306: 2 failed, 3 known |
| 13:11 | The lead's alignments (beat 11, beat 13, folded hours) | 174 of 174, 1 known (the rig's missing `IDENTITY_SECRETS`) | (the mutation runs below) |
| **13:38–13:43** | **`check-demo --config oh --base http://localhost:9126`**, on a restarted rig with the kit's new per-launch `IDENTITY_SECRETS` | **189 of 189** | **329 of 329** |

`check-demo`'s other three steps also passed: generated (through WSL), typecheck, and credentials.

#### Mutations: each fails for what it names

Each mutant was the rig's own served bytes with one exact replacement. A scratch proxy on 9186 served it (`scratchpad/s1/proxy.mjs`), and refused the run unless the original text occurred exactly once. Each mutant was written to `scratchpad/s1/mutants/`. The checkout was never written.

| Id | Mutation | Request level | DOM |
|---|---|---|---|
| control | none | 177 of 177 | (the final run) |
| M1 | `renderDeals` reverses the four (`oh.js`) | **1 of 177**: "the page's own code … sorts no piece", naming `/oh/oh.js:765 in renderDeals: .reverse(` | **9 of 306**: "renders the engine's answer in the engine's order" on every homepage press |
| M2 | `demoRoute()` sends no X-Tenant (`transport.js`) | **1 of 177**: "api() and demoRoute() send X-Tenant on every API call" | **45 of 306**: "every API call the page made carried X-Tenant: oh (289 calls)", which names the reset and the beats; the walk fails behind it |
| M3 | a JWT-shaped string planted in `img/index.json` | **1 of 177**: "no served page, module, stylesheet, script or document carries a token (47 checked) — img/index.json: a JWT" | not run |
| M4 | the beat request carries `document: {}` (`transport.js`) | the source's beat-body check, plus 8 receipt reads lost to a queue stall (finding 2) | **2 of 309**: the wire's beat-body check (`keys kind,name,note,document`). The other failure was my beat-13 projection check, a rounding fault since fixed |
| M5 | every Compare frame a white canvas (`compare.js` `encode`) | not run | **17 of 308**: every "Compare opens on two frames of real pixels" check and Fresh visitor's frames, each at ink 0% |
| M7 | every accepted image broken (`oh.js` `artOf`) | not run | **21 of 309**: "no broken image" on every shell at 1440 and 1366 and on the presses. These failures are caught even though the page swaps each failed image for its name tile, because the suite counts image errors before the page's own handler runs |

#### What the suites assert

- **Day one.**
  - The served files.
  - No token anywhere the page loads, served or committed: its shells, its modules, every same-origin stylesheet, `html2canvas`, `demo.config.json`, `beats.json`, the beat documents, `catalog.json`, `products.json`, `specs.json`, `img/index.json` and `img/MANIFEST.json`.
  - Every image those data files name is served as an image (592).
  - X-Tenant in the doors, with the tenant followed from `transport.js` to `SITE.tenant`.
  - The beat route:
    - its closed list equals the kit config's;
    - it refuses a kind that is not the beat's own;
    - a request carrying a document publishes the worker's own copy;
    - the page sends `{ kind, name, note }` and nothing else.
  - The receipt answers her own decisions only: another shopper is refused, a mixed list is refused, no session gets 401, and no visitor id appears.
  - The reset.
  - The arrival four:
    - decided on the request's own region, nothing asserted;
    - the lean labelled synthetic → warehouse;
    - the campaign term on the hero's and the TV deals' receipts;
    - paid search on the cell.
  - **The page never ranks.** In the code (comments stripped), every `.sort(` is either the engine's order or a named explanation, each read and listed with its reason, and there is no arithmetic on a score. On screen, every decided slot is in the engine's order (read off the wire), and every `/sort` list is in `/sort`'s order.
  - The kit-boundary guard: 1,300 OH names, none in the kit's code.
  - No overflow and no broken image on six shells at 1440 and 1366.
  - The honest stop for a beat that is not built.
- **Per beat, measured.**
  - The declared effects for all sixteen beats.
  - Compare on every press, with real pixels, and differing pixels where its own What changed shows the decisions moved.
  - The before/now row, the director's sentence with its beat number, and a Before taken as the press lands.
  - Fresh visitor on the homepage (beat 4): her page restored afterwards, her capability unchanged, and the stranger sent nothing.
  - The sign-in's receipt line, and the two outcomes on the wire as `type: 'custom'` with `data.event`, each carrying the decision on screen that earned it.
  - The day report's rows, labelled attribution and "not yet significant".
  - The wire audit for the whole walk.

#### The lanes' blocks, integrated

Each lane's helpers now sit beside mine. Each beat's checks run at the end of my outcome for that beat, in their own block, with their texts unchanged. Names that would have collided were renamed in code only.

| Block | Integrated |
|---|---|
| P2, request level (14 checks, beats 5–10) | as is |
| P2, DOM (beats 5–10) | `inSortOrder` renamed `p2InSortOrder`. My beat-5 dryer check and beat-9 meters-panel check were dropped for P2's fair versions, by the lead's ruling |
| P1, request level (beats 1–4 and 11–14) | as is |
| P1, DOM (beats 1–4 and 11–13) | `read` renamed `p1Read` |
| P3, request level (beats 15–16) | `signIn`, `report` and `date` renamed `p3SignIn`, `p3Report` and `p3Date`. Its signed-link checks print "open" on a rig with no `IDENTITY_SECRETS` |
| P3, DOM (beats 15–16) | `report`, `date` and `view` renamed. I had no outcome for these two beats, so P3's checks became them |

#### The lead's rulings, applied

- **Beat 5:** the first dryer is what `/sort` put first, and the lead line names the region's lean when it differs (P2's check).
- **Beat 9:** her dials are read from her profile, not the panel's top eight (P2's check). Beat 3's dials are read the same way.
- **Widths:** the product page's first, then the feed's.
- **Beat 13:**
  - each room's reading before and after, on screen;
  - each fade equal to the published memory's projection over 21 days (τ 60 days on room, K 1.8), over the interval its two-decimal display allows;
  - a comparative claim only when the readings differ.
- **Beat 11:** the closed pieces are absent from the next decision on the page shown, on screen and in the engine's answer off the wire. What was on screen before is reported as information.

#### Findings for the lead

1. **`IDENTITY_SECRETS` on local rigs.** Until 13:18, `rig.mjs` passed none, so beat 15 answered 503 on my rig, and both suites named it as the rig's gap. My brief keeps secrets to `.dev.vars`, so I generated none. The kit's `rig.mjs` now generates one per launch, and the final run used it. The hosted worker still needs it in K4's secrets list.
2. **The local queue consumer stalls under the suites' load.** It happened twice on my rig, at about 12:45 and about 13:30, after `learning_incomplete` warnings and repeated "Configuration publication authority unavailable" errors. No `QUEUE` batch ran after that, so receipts and new outcomes never reached the ledger. A restart clears it, as P2 and P3 also found. A long rehearsal on one local rig needs a restart before its report.
3. **The raw day outgrew the report's budget.** After about twenty walks the report answered 413, "report too large for the window". I folded the closed hours with the local cron, as `RESUME-oh.md` documents. Both suites now handle folded hours as Vantage's do: today's growth is an information line until its hour closes, and the report's own contract is asserted. A hosted worker folds every five minutes, so this is the hosted case.
4. **The never-ranks list.** Twelve sorts are named, each with its reason: P1's rail driver and snapshot, P2's six, P3's two, and the scaffold's two. P1 removed its `featured` sort when the guard flagged it. Any new or changed sort fails until read.
5. **Beat 2.** P1 picks Texas, which leans a different type and size band from North Carolina. The homepage pieces do not move; the rails do. Both suites read the rails.
6. **`ctx.fit`.** It reaches the engine on the request, but the receipt does not echo it as asserted, and P2's check shows it gates nothing.
7. **The pre-arrival Before is titled "page".** It reads "Before · page · nobody yet" because `whereNow` has no view yet. This is cosmetic, in the shared code.
8. **Fresh visitor on a product page.** It printed as a P1/P2 item on earlier runs. P1's tool then gained a hook for another section's page (`LANES.hooks.fresh`), which the product page uses, and the check passed in the final run.

#### Files, rig and restoration

- **My files.**
  - `scripts/rehearse-oh-page.mjs`, 1,297 lines, sha256 `644b8dc40824…`.
  - `scripts/rehearse-oh-dom.mjs`, 1,146 lines, `ea80f60064bf…`.
  - `scripts/demo-kit/configs/oh.json` is unchanged.
  - This section.
- **Restoration.**
  - The nineteen beat documents were snapshotted by hash at 11:45, equal to HEAD.
  - My one in-place seed, at 11:48, re-anchored four of them. Every later run used them as they were served.
  - At 13:07:54 another lane rewrote all nineteen. `11-window-closes` and `13-three-weeks` are now P1's new documents, and the anchor is as committed.
  - None of the nineteen holds my seed's bytes, so there was nothing of mine to restore. Restoring HEAD's would have removed P1's documents. I left them.
- **The rig and the proxy.** Both are stopped, and ports 9126, 9276 and 9186 are free. The state is kept, with today's closed hours folded. No other port was touched, and I wrote no other lane's file.

#### What remains

- The hosted run, on the owner's go.
- Finding 7, the cosmetic "page" title on the pre-arrival Before (shared code).

#### Rulings applied (13:05–13:55 EDT)

| Ruling | What was done | Measured |
|---|---|---|
| Beat 11 on her TV page | `public/oh/demo.config.json` beat 11 closes the four product-page twins as well (`offer-tv-gift-card`, `offer-tv-matching-soundbar`, `offer-tv-sound-suite`, `offer-tv-free-mounting`); `new-demo.mjs --config public/oh/demo.config.json --rebuild-beats` rebuilt 22 files, and only `beats/11-window-closes.json` and `beats/13-three-weeks.json` changed (13 is cut onto 11), the kit config, reflex, learn and `wrangler.oh.toml` byte-equal. Beat 11 now opens her TV page from the grid (the last TV she opened), marks it, publishes, asks that page again, holds it 1.8 s, then returns home for the package half; the deals strip opens with what left the TV page | request level: the document closes all four; on her TV page the opening catalog answers `offer-tv-gift-card` and `offer-tv-free-mounting` and the next decision after the publish answers none. DOM: the press's own product answers on the wire carry a closing twin before and none after; the homepage is on screen for the package half; the strip names what left the TV page. Screenshot `P1-1440-11a-window-closes-tv-page.png` |
| The continue hero's stage | Compared with Vantage's working pairing: OH's `hero-continue` already fits `considering`, `deciding` and its slot carries `stage { outOfStage: 0, inStage: 0.5 }`, exactly Vantage's (`public/vantage/catalog.json`, its open slots). The engine's content gate reads its own early/mid/late stage as exploring/considering/deciding (`src/services/JourneyStage.ts` `STAGE_WORDS`), so the registry's `thinking`/`deciding` journey (the panel's chip) is a second vocabulary, not the gate's: my item 4 was a misreading and nothing changes | on the walk the continue receipt reads score 0.500, in stage |
| Beat 13 | the claim stays as the measurement gives it; the room dials print to three places so the projection can be checked by hand (S1's check now does) | “each fade is the published memory’s projection over 21 days” ✓ |
| Beat 14 | no price overlay; unchanged | |
| The dead path (P2's landing) | `askWithContext` and the product branch in `askPage` removed; `askPage` asks through `transport.ask(key, v)`; my own question goes through `transport.ask(pageKey, v, { context })` (the return visit) instead of a snapshot of its own | `LANES` unchanged |

Also: “for you” asks its three rooms one after another (each records its own product sort; three at once met one 503 on a fresh state). **`check-demo --config oh` 5 of 5 on the rig (9123, a fresh `.wrangler/state-p1b`, because `state-p1`'s ledger for the day had passed the report budget after the session's runs and beat 16's build answered 413): request level 191 of 191, DOM 329 of 329, no known item.** Twelve screenshots now: the eleven above retaken, and `P1-1440-11a-window-closes-tv-page.png`. For P2: the pdp-offers strip says the closed offers left “outranked on this answer”; “its window closed” would say why. The rig is stopped; both states are kept.
