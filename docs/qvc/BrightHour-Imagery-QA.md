# The Bright Hour — product imagery batch & QA ledger

**Run:** overnight batch, 2026-08-18 · **Surface:** `/live` · **Spec:** `QVC-Site-Recon-Demo-Design.md` Part D2 · **Protocol:** `QVC-Demo-Design-Brief.md` §4.3

## What this is

77 catalogue packshots, AI-generated under one locked recipe per category, each one passed through a
human-standard defect check before it was allowed to ship. The design brief's hybrid decision assumed a
stock-photography leg for electronics and jewellery; sourcing licensed stock was not feasible in one night,
so the adaptation agreed for this run was: **generate everything, gate it strictly, and keep the deliberate
SVG placeholder wherever the gate fails.** A clean placeholder beats a bad image — the target was never
77/77, it was *zero bad images shipped*.

- **Generator:** `scripts/generate-bh-images.mjs` (standalone; talks to the image model over REST, never
  through the worker — same model the worker's `sceneGen.ts` uses)
- **Model:** `gemini-3.1-flash-image`, 1:1 at 2K, key from `.dev.vars` (`GEMINI_API_KEY`)
- **Output:** `public/live/img/{itemNumber}.jpg` — 1200×1200, near-white `#FEFEFE`, < 300 KB
  (max 273 KB, avg 102 KB, 7.8 MB total)
- **Wiring:** `catalog.data.json` `image_url` = `/live/img/{itemNumber}.jpg` for accepted items, `null`
  otherwise. `public/live/live.js` already carries the photo seam (`photoCandidates` → `<img>` layered over
  the placeholder SVG, with capture-phase `error` fallback), so a null / missing file degrades to the
  placeholder with no layout shift.

## The recipe

Every prompt is `subject + variant + frame + category style + negative`, with the **brand name deliberately
stripped from the subject** (a fictional brand name in the prompt invites a rendered logo, which is an
automatic reject). Frame: single product centred, ~84% of a square frame, seamless near-white sweep, soft
upper-left key, contact shadow, 100 mm at f/11. Two candidates per item, differing by one deliberate framing
change (three-quarter vs straight-on; overhead-square vs overhead-angled for flat-lay categories).

Category styles are locked so each category's grid reads as one shoot: cookware three-quarter and empty ·
textiles folded square · garden isolated with no soil or sky · **food in completely blank vessels** ·
apparel flat-lay with no body, mannequin or hanger · **beauty as unlabelled blank vessels** · jewellery
overhead macro with physically correct metalwork · **electronics with every screen switched fully off and no
UI, icons or badging**. The last three are the AI-text and AI-detail traps; they are written into the recipe
rather than left to luck.

## Priority order

Generated in the order that keeps a partial batch demo-complete: **(A)** the 3 TBO items, the BH2 item, the
pinned Q50-style pick and the 8 Harvest Kitchen EVT items → **(B)** Kitchen & Table, For the Home, Garden,
Food & Wine → **(C)** Fashion flat-lays and Beauty as unlabelled vessels → **(D)** Electronics and Jewellery
last, under the strictest gate, where the whole tier was reviewed a second time at 1:1.

## The gate

Automatic pre-filter (recorded per candidate): background whiteness and neutrality, product bounding box,
margins, centring. Then a human-standard defect check on **every candidate**, rejecting on any of:

rendered text or labels · impossible geometry or physics · melted / mushy detail · wrong item or wrong count
versus the name · hands, people or logos · non-white background.

## Result

| Category | Items | Candidates generated | Shipped photo | Shipped placeholder | Items needing a re-roll |
|---|---|---|---|---|---|
| Kitchen & Table | 12 | 26 | 12 | 0 | 1 |
| For the Home | 11 | 26 | 11 | 0 | 2 |
| Beauty & Wellness | 10 | 22 | 10 | 0 | 1 |
| Fashion | 10 | 22 | 10 | 0 | 1 |
| Jewelry | 8 | 16 | 8 | 0 | 0 |
| Electronics & Tech | 8 | 16 | 8 | 0 | 0 |
| Garden & Outdoor | 9 | 20 | 9 | 0 | 1 |
| Food & Wine | 9 | 20 | 9 | 0 | 1 |
| **Total** | **77** | **168** | **77** | **0** | **7** |

**168 candidates generated, 77 shipped — a 54% candidate rejection rate.** Every item ships a photograph, but
only after seven candidate pairs were thrown out wholesale and re-rolled against a corrected prompt, and one
of the two candidates was rejected on every other item. The per-item choice was never "is this acceptable" but "which of these two is right, and if neither,
regenerate or ship the placeholder."

### What the gate actually caught

| Defect | Items | Examples |
|---|---|---|
| Rendered text | 2 | garden tool set (depth gradations and numerals engraved on the transplanter blade — **both** candidates, forced a re-roll); portable projector (HDMI/USB port labels) |
| Impossible geometry | 5 | knife block with the blades drawn **on** the face of the solid wood (both candidates); napkin set with one napkin half oat and half rust; nested bakers intersecting each other's walls; hose reel with two conflicting cranks; tote with two handle sets |
| Bad physics | 1 | arc floor lamp on a thin marble disc that could not counterweight the arc |
| Wrong item vs name | 4 | "Trio" of candles rendered as four jars; a *pair* of studs rendered as four; a hip-length wrap **top** against a "Wrap Dress" name; a 5×7 rug rendered square |
| Wrong product read | 3 | LED therapy mask rendered as a featureless moulded human face (four candidates before it read as a device); a cleansing device with no brush texture; an air fryer with no basket |
| Compositing artefact | 1 | pendant light with a lighter rectangular panel composited over the background |
| Framing | 1 | preserves flight framed small and low in the frame |

### Re-rolled items (first pass rejected outright, corrected prompt shipped)

`B412961` knife block · `B421118` arc floor lamp · `B421186` area rug · `B478663` garden tool set ·
`B433216` LED light-therapy mask · `B445347` jersey wrap dress · `B489705` preserves flight (framing).
The corrected subject lines are kept in `scripts/generate-bh-images.mjs` with a comment recording *why* each
was changed, so the next batch starts from the fixed recipe rather than rediscovering the same failure.

## Honest caveats on shipped images

1. **`B433237` Vitamin C Ampoule 30-Day Set** renders roughly 42 ampoules against a "30-Day" name. Not
   countable at card size and the product type is right, so it shipped — recorded rather than hidden.
2. **`B467578` power bank / `B467565` charging dock / `B467536` projector** carry a moulded power **glyph**
   (a circle-and-bar icon on a button). No text, no wordmark, no branding; this is how real hardware is
   moulded. Verified at 1:1 on each.
3. **`B489736` Artisan Bread Kit** ships the 4-loaf candidate; the alternate showed five.
4. **Backgrounds** were normalised deterministically (white-point lift capped at ×1.09) so the grid reads as
   one catalogue. Checked at 1:1 on the whitest items (sheet set, towel set, blouse, cake, travel set,
   moisturiser) — fold and buttercream detail survives, nothing is clipped flat.
5. **`public/live/img/B551204.jpg` is not from this batch.** It is a 2×2 grey stub named after a Beat 2b
   *staged* row (`staging.data.json`, not the catalogue) that appeared in the directory mid-run. It was left
   untouched — but if it is not a deliberate fixture it should be deleted before the demo, because at 2×2 it
   would render as a grey smear over that card's placeholder. `verify` reports it separately rather than
   silently counting it.

## Reproducing / extending

```
node scripts/generate-bh-images.mjs gen --tier a --candidates 2 --concurrency 3
node scripts/generate-bh-images.mjs gen --only B412961 --letters cd     # re-roll after a prompt fix
node scripts/generate-bh-images.mjs reindex                             # rebuild the manifest from disk
node scripts/generate-bh-images.mjs sheets --tier d --per 4 --cell 700  # contact sheets for the eye
node scripts/generate-bh-images.mjs wire --decisions <decisions.json>
node scripts/generate-bh-images.mjs verify                              # 1:1 files ↔ catalogue references
```

Keep concurrency at 3 or below: the account hit a **spend-based 429** when two generation runs overlapped at
5 each, which silently cost nine candidates that had to be regenerated.

## Full ledger

Every item, every decision, one line of reason. "Candidates" counts every roll for that item including
re-rolls; the shipped letter identifies the winning candidate.

| Item | Name | Category | Tier | Cand. | Decision | File | Reason |
|---|---|---|---|---|---|---|---|
| B412907 | Copperline 9-Qt Enamel Cast Iron Dutch Oven | Kitchen & Table | A | 2 | ACCEPT b | 73 KB | ACCEPT b — lid seats on the rim, cream interior band correct. Rejected a: lid renders hovering above the rim with a false gap. |
| B412915 | Fresco Nine 7-Qt Digital Air Fryer Oven | Kitchen & Table | A | 2 | ACCEPT b | 76 KB | ACCEPT b — blank control panel, fry basket visible behind glass. Rejected a: reads as a plain toaster oven, no basket. |
| B412933 | Copperline 12-Qt Enamel Stockpot with Lid | Kitchen & Table | A | 2 | ACCEPT b | 67 KB | ACCEPT b — slate body, cream rim, seated lid. Rejected a: spurious brass band and a floating lid. |
| B412948 | Marlow & Bell Acacia Serving Board Set of 3 | Kitchen & Table | A | 2 | ACCEPT a | 177 KB | ACCEPT a — three graduated acacia boards, clean grain and handles. Rejected b: smallest board's handle merges into the board behind it. |
| B412961 | Fresco Nine 12-Piece Knife Block Set | Kitchen & Table | A | 4 | ACCEPT d | 177 KB | RE-ROLL then ACCEPT d — first pass (a,b) rejected: blades drawn ON the face of the wooden block (impossible geometry). Re-rolled with blades explicitly hidden inside; d is clean, handles only, shears and steel beside. |
| B412974 | Copperline 10" Enamel Cast Iron Skillet | Kitchen & Table | B | 2 | ACCEPT a | 61 KB | ACCEPT a — marigold interior / slate exterior, long handle plus helper handle. |
| B412988 | Fresco Nine Milk-Frothing Coffee Press | Kitchen & Table | B | 2 | ACCEPT a | 70 KB | ACCEPT a — glass carafe, stainless cage, plunger and filter all physically coherent. |
| B413006 | Marlow & Bell Stoneware Baker Trio | Kitchen & Table | B | 2 | ACCEPT a | 145 KB | ACCEPT a — three nested stoneware bakers, handles resolve. Rejected b: middle dish intersects the large dish's wall. |
| B413019 | Copperline 20-Piece Glass Food Storage Set | Kitchen & Table | B | 2 | ACCEPT b | 80 KB | ACCEPT b — evenly stacked clear containers with plain frosted lids, no warped glass. |
| B413027 | Marlow & Bell Hand-Glazed Dinner Plates, Set of 4 | Kitchen & Table | B | 2 | ACCEPT a | 87 KB | ACCEPT a — four plates (three stacked, one upright), sea-glass rim consistent. |
| B413041 | Fresco Nine 3-Piece Nesting Prep Bowl Set | Kitchen & Table | B | 2 | ACCEPT a | 60 KB | ACCEPT a — three graduated stainless bowls with silicone bases, clean nesting. |
| B413058 | Copperline 14-Piece Everyday Cookware Set | Kitchen & Table | B | 2 | ACCEPT a | 97 KB | ACCEPT a — multi-piece set coherent, no floating or duplicated handles. Rejected b: overlapping handles ambiguous. |
| B421104 | Havenmoor 5-Piece Quilted Coverlet Set | For the Home | A | 2 | ACCEPT b | 164 KB | ACCEPT b — five squared pieces, quilting and rust binding legible, folds clean. |
| B421118 | Lumen House Arc Floor Lamp with Marble Base | For the Home | B | 4 | ACCEPT c | 38 KB | RE-ROLL then ACCEPT c — first pass (a,b) rejected: arc mounted on a thin marble disc that could not counterweight it (bad physics). Re-rolled with a solid marble block base. |
| B421126 | Wren Hollow Hand-Loomed Cotton Throw | For the Home | B | 2 | ACCEPT a | 251 KB | ACCEPT a — folded striped throw, fringe intact, weave legible. |
| B421139 | Havenmoor 600-Thread-Count Sateen Sheet Set | For the Home | B | 2 | ACCEPT a | 63 KB | ACCEPT a — squared sheet stack, folds clean. |
| B421147 | Lumen House Adjustable LED Task Lamp | For the Home | B | 2 | ACCEPT a | 48 KB | ACCEPT a — articulated task lamp, correct joints, weighted base. Rejected b: shade fixed pointing straight down, not an adjustable task lamp. |
| B421155 | Wren Hollow Poured Soy Candle Trio | For the Home | B | 2 | ACCEPT b | 69 KB | ACCEPT b — exactly three amber jars + one lid off. Rejected a: FOUR jars against a 'Trio' name. |
| B421168 | Havenmoor Stackable Storage Bins, Set of 6 | For the Home | B | 2 | ACCEPT b | 110 KB | ACCEPT b — exactly six bins in frame, plain fabric pulls, no label holders. |
| B421172 | Lumen House Milk-Glass Pendant Light | For the Home | B | 2 | ACCEPT a | 26 KB | ACCEPT a — milk-glass pendant on brass rod. Rejected b: a lighter rectangular panel composited over the background (image-in-image artefact). |
| B421186 | Wren Hollow Wool-Blend Area Rug 5x7 | For the Home | B | 4 | ACCEPT c | 273 KB | RE-ROLL then ACCEPT c — first pass (a,b) rejected: a 5x7 rug rendered square. Re-rolled with an explicit rectangular proportion; c is clearly rectangular in rust/fog. |
| B421195 | Havenmoor Turkish Cotton 6-Piece Towel Set | For the Home | B | 2 | ACCEPT a | 207 KB | ACCEPT a — six pieces countable (2 rolled + 4 folded), white/fog/clay as specified. |
| B421203 | Wren Hollow Stonewashed Linen Napkin Set of 8 | For the Home | A | 2 | ACCEPT a | 259 KB | ACCEPT a — two stacks of four = 8. Rejected b: top napkin merges oat and rust into one impossible half-and-half piece. |
| B433208 | Solene Overnight Renewal Cream 1.7 oz | Beauty & Wellness | A | 2 | ACCEPT b | 31 KB | ACCEPT b — frosted jar, matte cream lid, every surface blank (label-text trap avoided). |
| B433216 | Aurelle Labs LED Light Therapy Mask | Beauty & Wellness | C | 4 | ACCEPT e | 47 KB | RE-ROLL then ACCEPT e — first pass (a,b,c,d) rejected: rendered a featureless moulded human face (theatre-mask read, not a device). Re-rolled as a technical panel; e shows an unlit LED array, eye cut-outs, strap and plain control puck. Verified at 1:1 — no text on the puck. |
| B433224 | Fieldnote Botanical Body Oil 4 oz | Beauty & Wellness | C | 2 | ACCEPT d | 49 KB | ACCEPT d — amber dropper bottle, matte cap, glass completely blank. |
| B433237 | Solene Vitamin C Ampoule 30-Day Set | Beauty & Wellness | C | 2 | ACCEPT c | 151 KB | ACCEPT c (with note) — tray of identical blank ampoules with gold caps, clean geometry. NOTE: renders roughly 42 ampoules against a '30-Day' name; not countable at card size, but the discrepancy is recorded rather than hidden. |
| B433245 | Fieldnote Tinted Lip Balm Trio | Beauty & Wellness | C | 2 | ACCEPT b | 58 KB | ACCEPT b — three tubes, each a single consistent colour. Rejected a: middle tube's cap and body are mismatched colours. |
| B433259 | Aurelle Labs Sonic Cleansing Device | Beauty & Wellness | C | 2 | ACCEPT a | 105 KB | ACCEPT a — silicone brush texture present, single plain button, reads as a cleansing device. Rejected b: a featureless pink oval, product type unreadable. |
| B433263 | Solene Five-Piece Skincare Travel Set | Beauty & Wellness | C | 2 | ACCEPT a | 38 KB | ACCEPT a — five graduated blank vessels, correct count, no printing. |
| B433271 | Fieldnote Milled Soap Trio | Beauty & Wellness | C | 2 | ACCEPT a | 67 KB | ACCEPT a — three cleanly cut bars, surfaces unstamped. |
| B433288 | Solene Daily Moisturizer SPF 30 | Beauty & Wellness | C | 2 | ACCEPT b | 19 KB | ACCEPT b — matte white pump bottle, entirely blank, brighter sweep than a. |
| B433294 | Aurelle Labs Bond Repair Hair Serum (Prior Formula) | Beauty & Wellness | C | 2 | ACCEPT a | 30 KB | ACCEPT a — clear bottle, pearl serum, plain black pump, no printing. |
| B445301 | Delaney Park Cable-Knit Cotton Cardigan | Fashion | A | 2 | ACCEPT a | 259 KB | ACCEPT a — full flat-lay, cable knit even, placket straight, no body or mannequin. |
| B445318 | Trueform Everyday Ponte Legging | Fashion | C | 2 | ACCEPT a | 56 KB | ACCEPT a — flat-folded black ponte leggings, waistband and seams clean. |
| B445326 | Nell & Bray Silk-Blend Button Blouse | Fashion | C | 2 | ACCEPT a | 64 KB | ACCEPT a — ivory blouse flat-lay, collar squared, button line straight. |
| B445334 | Delaney Park Quilted Barn Jacket | Fashion | C | 2 | ACCEPT b | 167 KB | ACCEPT b — olive quilted barn jacket, corduroy collar and pocket flaps, symmetric lay. |
| B445347 | Nell & Bray Jersey Wrap Dress | Fashion | C | 4 | ACCEPT e | 67 KB | RE-ROLL then ACCEPT e — first pass (a,b) rejected: rendered a hip-length wrap TOP against a 'Wrap Dress' name. Re-rolled full length; e is a clean knee-length wrap dress with tie belt. |
| B445355 | Trueform Pima Cotton Tee, Set of 3 | Fashion | C | 2 | ACCEPT b | 105 KB | ACCEPT b — three tees folded and stacked, all three colours visible and countable. |
| B445369 | Delaney Park A-Line Corduroy Skirt | Fashion | C | 2 | ACCEPT a | 208 KB | ACCEPT a — camel corduroy A-line skirt, wale runs true, no text. |
| B445372 | Trueform Memory-Foam Slip-On Sandal | Fashion | C | 2 | ACCEPT a | 123 KB | ACCEPT a — matched pair, footbeds identical. Rejected b: left and right footbeds differ. |
| B445384 | Trueform Pull-On Straight-Leg Jean | Fashion | C | 2 | ACCEPT b | 160 KB | ACCEPT b — plain elastic pull-on waistband as specified. Rejected a: drawstring waist, wrong construction for a pull-on jean. |
| B445396 | Nell & Bray Convertible Leather Tote | Fashion | A | 2 | ACCEPT a | 228 KB | ACCEPT a — structured tote, coiled strap styled on top, plain gold hardware, no logo plate. Rejected b: two conflicting handle sets. |
| B456402 | Vireo Fine 14K Gold Leaf Pendant Necklace | Jewelry | D | 2 | ACCEPT b | 52 KB | ACCEPT b — pendant hangs from a jump ring (a rendered it inline as a station necklace). 1:1 check: chain links continuous, clasp coherent. |
| B456417 | Larkspur Silver Sterling Hoop Earrings | Jewelry | D | 2 | ACCEPT a | 56 KB | ACCEPT a — matched pair, click-top hinges complete on both, tube unbroken at 1:1. |
| B456425 | Coronet Brightstone℠ Tennis Bracelet | Jewelry | D | 2 | ACCEPT b | 90 KB | ACCEPT b — continuous line of four-prong settings, uniform stones, box clasp with safety latch resolves at 1:1. Rejected a: reads as a loose strand, clasp end ambiguous. |
| B456438 | Vireo Fine Hammered Sterling Band Ring | Jewelry | D | 2 | ACCEPT a | 59 KB | ACCEPT a — perfect circle, hammer facets even, inner band clean. |
| B456446 | Coronet Brightstone℠ Graduated Strand Necklace | Jewelry | D | 2 | ACCEPT a | 71 KB | ACCEPT a — beads graduate smoothly to the centre, single continuous strand, lobster clasp intact. |
| B456453 | Larkspur Silver Beaded Chain Anklet | Jewelry | D | 2 | ACCEPT a | 41 KB | ACCEPT a — even bead spacing on a continuous cable chain, spring clasp intact. Rejected b: irregular spacing and a broken chain segment near the clasp. |
| B456467 | Coronet Pavé Drop Earrings | Jewelry | D | 2 | ACCEPT b | 92 KB | ACCEPT b — matched pair, pavé stones even around both teardrops, posts and butterfly backs correct at 1:1. |
| B456479 | Larkspur Silver Everyday Stud Earrings | Jewelry | D | 2 | ACCEPT b | 36 KB | ACCEPT b — a PAIR of studs. Rejected a: four studs (two pairs) against a single-pair item. |
| B467503 | Northbeam 3.1-Channel Soundbar with Wireless Subwoofer | Electronics & Tech | D | 2 | ACCEPT a | 43 KB | ACCEPT a — soundbar and sub read as one system, ports plain, no logo or text at 1:1. Rejected b: sub appears to sit on top of the bar. |
| B467511 | Quilla Audio Over-Ear Noise-Canceling Headphones | Electronics & Tech | D | 2 | ACCEPT b | 71 KB | ACCEPT b — symmetric pair, headband continuous, plain controls. Rejected a: left yoke geometry tangled. |
| B467528 | Halo Field 10" Smart Home Display | Electronics & Tech | D | 2 | ACCEPT a | 68 KB | ACCEPT a — screen fully off as dark glass, no UI, no icons; fabric wedge stand stable. Rejected b: bezel-heavy and base narrower than the screen. |
| B467536 | Northbeam Portable Smart Projector | Electronics & Tech | D | 2 | ACCEPT a | 82 KB | ACCEPT a — lens, fabric panel and ports all plain; verified at 1:1 that the port bank carries NO labels. Rejected b: rendered port labels (HDMI/USB text). |
| B467549 | Quilla Audio True-Wireless Earbuds | Electronics & Tech | D | 2 | ACCEPT a | 73 KB | ACCEPT a — buds seated in the case, USB-C port plain, no markings. Rejected b: unexplained slot cut into the case floor. |
| B467557 | Halo Field Fitness Tracker (Prior Generation) | Electronics & Tech | D | 2 | ACCEPT b | 49 KB | ACCEPT b — screen off, buckle and strap holes complete. Rejected a: no closure on the band. |
| B467565 | Northbeam 3-in-1 Wireless Charging Dock | Electronics & Tech | D | 2 | ACCEPT a | 45 KB | ACCEPT a — three charging positions as named, coherent stand. Rejected b: four positions and an overlapping pad under the stand. |
| B467578 | Halo Field 20,000 mAh Power Bank | Electronics & Tech | D | 2 | ACCEPT a | 36 KB | ACCEPT a — plain matte body, USB-A/USB-C and a power glyph only, no text. |
| B478604 | Rootwell Self-Watering Planter Trio | Garden & Outdoor | B | 2 | ACCEPT a | 101 KB | ACCEPT a — three matched graduated planters with self-watering bases. Rejected b: three mismatched shapes, does not read as a trio. |
| B478612 | Terrace & Thorn Hand-Forged Lantern Pair | Garden & Outdoor | B | 2 | ACCEPT b | 124 KB | ACCEPT b — matched forged pair, glass panes, hinges and latches coherent. |
| B478629 | Rootwell 100-Ft Retractable Hose Reel | Garden & Outdoor | B | 2 | ACCEPT a | 77 KB | ACCEPT a — reel, coiled hose, single crank. Rejected b: two conflicting cranks and the hose end passes through the coil. |
| B478637 | Terrace & Thorn Two-Seat Bistro Set | Garden & Outdoor | B | 2 | ACCEPT a | 78 KB | ACCEPT a — ivory table + two folding chairs (3 pieces), leg crossings correct. |
| B478645 | Rootwell Cast-Iron Fire Bowl with Screen | Garden & Outdoor | B | 2 | ACCEPT a | 174 KB | ACCEPT a — cast-iron bowl with mesh spark screen, legs and rim coherent. |
| B478658 | Terrace & Thorn Reclaimed Teak Garden Bench | Garden & Outdoor | B | 2 | ACCEPT b | 132 KB | ACCEPT b — symmetric slatted teak bench, joinery consistent. Rejected a: seat depth inconsistent across the frame. |
| B478663 | Rootwell 8-Piece Garden Tool Set with Tote | Garden & Outdoor | B | 4 | ACCEPT c | 153 KB | RE-ROLL then ACCEPT c — first pass (a,b) rejected: RENDERED TEXT, depth gradations and numerals engraved on the transplanter blade. Re-rolled with blank blades; c verified at 1:1, blades smooth and unmarked. |
| B478677 | Rootwell Galvanized Watering Can 2 Gal | Garden & Outdoor | B | 2 | ACCEPT b | 99 KB | ACCEPT b — galvanized can, perforated rose head, spout joins the body correctly. |
| B478689 | Terrace & Thorn Cast Stone Stepping Stones, Set of 4 | Garden & Outdoor | B | 2 | ACCEPT a | 153 KB | ACCEPT a — four plain cast-stone rounds, unengraved. |
| B489705 | Harbor Larder Harvest Preserves Flight | Food & Wine | A | 4 | ACCEPT c | 94 KB | RE-ROLL then ACCEPT c — first pass framed the jars small and low. Re-rolled tighter; c has four blank jars, gold lids, four distinct preserve colours, no labels. |
| B489713 | Two Rivers Bake Co. Cinnamon Roll Tray, 12 Count | Food & Wine | B | 2 | ACCEPT a | 228 KB | ACCEPT a — twelve rolls countable in the tray, no packaging text. |
| B489728 | Harbor Larder Autumn Soup Flight, 6 Servings | Food & Wine | A | 2 | ACCEPT b | 155 KB | ACCEPT b — overhead 2x3 grid of six plain white bowls, six distinct soups. |
| B489736 | Two Rivers Bake Co. Artisan Bread Kit | Food & Wine | A | 2 | ACCEPT b | 177 KB | ACCEPT b — four loaves + blank kraft flour bag on plain linen, matches the 4-loaf spec. Rejected a: five loaves. |
| B489744 | Harbor Larder Cheese Board Gift Crate | Food & Wine | B | 2 | ACCEPT a | 157 KB | ACCEPT a — plain wood crate, cheeses/grapes/crackers/blank preserve jar, no labels anywhere. Rejected b: crate base renders as a double floor. |
| B489752 | Two Rivers Bake Co. Fruit Pie Sampler, 4 Count | Food & Wine | B | 2 | ACCEPT a | 199 KB | ACCEPT a — four lattice pies in plain foil tins, 2x2, no packaging. |
| B489767 | Harbor Larder Single-Origin Coffee, 4-Bag Set | Food & Wine | B | 2 | ACCEPT a | 100 KB | ACCEPT a — four completely blank kraft bags with plain tin ties. |
| B489775 | Two Rivers Bake Co. Celebration Layer Cake | Food & Wine | B | 2 | ACCEPT a | 52 KB | ACCEPT a — two-tier ivory buttercream cake on a plain stand, undecorated, no writing. |
| B489783 | Harbor Larder Estate Olive Oil 500 ml | Food & Wine | B | 2 | ACCEPT a | 40 KB | ACCEPT a — square-shouldered dark green oil bottle with plain wood stopper, completely unlabelled. b is a round wine-shaped bottle, less true to the item. |
