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
