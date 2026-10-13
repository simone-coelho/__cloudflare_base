# OH: the demo's design, as built on the kit

**A pointer, scaffolded 2026-10-02 by `scripts/demo-kit/new-demo.mjs`.** The governing design, with its use cases, surfaces, dimensions, beats and lanes, is **[docs/lg/OH-Demo-Design.md](../../docs/lg/OH-Demo-Design.md)**; this file says where each of its decisions lives in the repository, and logs the decisions made while building. A lane that needs a decision not logged in either file stops and asks the lead.

| | |
|---|---|
| Customer | LG |
| Tenant | `oh` |
| Worker | `edge-platform-oh` (its own; never the shared `edge-platform`, never a customer stamp) |
| Queues | `events-oh` and `events-oh-dlq` |
| Local port | `9120` |
| The config | `public/oh/demo.config.json`, the one file an SE edits first; `scripts/demo-kit/configs/oh.json` is derived from it |
| The page | `public/oh/index.html` (the homepage and the room grids `/oh/?view=tvs\|laundry\|kitchen\|offers`) (the search results at `/oh/?q=`, the store’s address), `product.html`, `m.html`, `oh.css`, `oh.js` and `oh-store.js` (the store: cart, navigation, events, search, Find a Retailer, sign-in) on `public/demo-kit/` |
| The beats | `public/oh/beats.json` (the director's script) and `public/oh/beats/*.json` (the published documents) |
| The server | `src/demos/oh.config.ts` (the constants) and `src/routes/oh.ts` (the kit's factories) |
| The suites | `scripts/rehearse-oh-page.mjs` (request level) and `scripts/rehearse-oh-dom.mjs` (the real page) |
| Decided slots | `hero`, `category-rail`, `deals`, `continue`, `grid-promo`, `pdp-modules`, `pdp-offers` |

## The beats as scaffolded

| # | Act | The press | What moves | Beat document | Its presses are written by |
|---|---|---|---|---|---|
| 1 | Arrival | a stranger lands from the search “lg tvs” (utm_term) in her real state | the regional prior leads the TV rail and the deals; the campaign term seeds TV | 01-arrive (context) | K4 (built in the scaffold) |
| 2 | Arrival | the region contrast (asserted, labelled) | a different lean | 02-contrast (context) | K4 (built in the scaffold) |
| 3 | Two rooms | she opens two TVs, then a front-load washer | room and type rise; the category rail reorders; for-you balances rooms | 03-two-rooms (context) | P1 |
| 4 | Two rooms | the fresh visitor beside her | Compare | 04-fresh-visitor (context) | P1 |
| 5 | The room completes | the washer page | companions: the dryer in her fuel, the pedestal, the stacking kit, the pair price | 05-washer-page (context) | P2 |
| 6 | The room completes | she switches to a top-loader | the pedestal leaves, the card says why | 06-top-loader (context) | P2 |
| 7 | The room completes | the TV page | the soundbar for the series, the mount for the VESA pattern | 07-tv-page (context) | P2 |
| 8 | The room completes | the range page | microwave, dishwasher, the package price when lower | 08-range-page (context) | P2 |
| 9 | Curation | a QNED page, with the OLED beside it; a size up from her viewing distance | tier and size-band | 09-qned-oled (context) | P2 |
| 10 | Curation | she enters a closet width | models that do not fit drop out | 10-closet-width (context) | P2 |
| 11 | Windows | an offer’s window closes (a beat publish); a package with an out-of-stock member | the piece leaves every surface on the next decision | 11-window-closes (catalog) | P1 |
| 12 | Windows | a merchandiser pin on a launch series | the pin leads; the receipt shows what the engine would have chosen | 12-pin-launch (slots) | P1 |
| 13 | Three weeks later | the clock jump (labelled) | laundry interest faded faster than TV, by the dials; the continue hero | 13-three-weeks (catalog) | P1 |
| 14 | Three weeks later | the price that changed, the model that arrived | the shortlist’s deltas | 14-what-changed (context) | P1 |
| 15 | One person | the phone: a stranger, then sign-in (live, a fictional account; the worker mints the signed link) | the phone becomes the laptop’s taste in one request | 15-phone-sign-in (context) | P3 |
| 16 | Best Buy counts | she presses Best Buy pickup on one page and Find a Retailer on another; the day report | two named outcomes, attach, attribution; “not yet significant” | 16-best-buy-counts (context) | P3 |

A beat whose presses are not written yet runs `notBuilt`: the status line names its lane and the beat stops. It never lands as "done".

## The mount lines (the lead applies them to `src/index.ts`)

```ts
import { ohRoutes, ohColdStartRoutes } from '@/routes/oh'; // OH demo: beats, receipts and the cold-start panel (docs/oh)
app.route('/oh/api', ohRoutes(async (request, env, ctx) => app.fetch(request, env, ctx)));
app.route('/oh/api/coldstart', ohColdStartRoutes);
```

## The morning routine (every rehearsal morning, hosted, once the worker exists)

```bash
npm run check:generated
node scripts/build-demo-worker-config.mjs --name edge-platform-oh --queue events-oh --dev-port 9120
node scripts/demo-kit/seed.mjs --config scripts/demo-kit/configs/oh.json --base https://edge-platform-oh.expedge.workers.dev --token <operator token>
npx wrangler deploy --config wrangler.oh.toml          # the seed rewrote public/oh/beats/; the owner's go
node scripts/demo-kit/region-seed.mjs --config scripts/demo-kit/configs/oh.json --base https://edge-platform-oh.expedge.workers.dev --token <operator token>
node scripts/demo-kit/check-demo.mjs --config oh --base https://edge-platform-oh.expedge.workers.dev
```

The windows are anchored to the seed's moment and the regional prior has a 24-hour horizon, so a rehearsal morning needs all of it. A reseed is always followed by a deploy.

## Decisions log

| Date | Decision | By |
|---|---|---|
| 2026-10-02 | Scaffolded from `public/oh/demo.config.json` by `scripts/demo-kit/new-demo.mjs`; the design above governs | scaffold |
| 2026-10-02 | `complements` weight **0.6 on `pdp-modules`** and **0.3 on `pdp-offers`** in the opening slots: the opening values (D1's follow-up, through the lead); a starting point, refined as P2 measures the product pages | lead, via K4 |
| 2026-10-02 | A product page asserts `ctx.anchor` = the sku and `ctx.family` = the row's `family` (`products.pageContext`); D1's companion pieces gate on `ctx.family` and `complements` prefers what completes the anchor. The kit's `transport.ask` asserts region and intent only, so `oh.js` asks the product page through `askWithContext` on the kit's `api()` door; a `context` hook in `ask()` is the kit's next addition | K4 |
| 2026-10-02 | The anchor file carries the catalog's own anchor, `2026-10-01T12:00:00Z` (D1); a seed re-anchors every window to now | K4, on D1's note |
| 2026-10-02 | The continue hero (`hero-continue`) is gated on `ctx.visit = return` in the opening catalog (the slot's `gate` in the config), beside its stage rule (`outOfStage 0, inStage 0.5`): while a stranger's stage is unknown the stage rule is off, and a first paint must never say "pick up where you left off". Lifted when the cross-visit stage lands or P1 asserts the return at beat 13 | K4 |
| 2026-10-02 | Beat 11 closes the gift-card hero and deal and the three offers D1 marks as closing with it (`deal-nfl-gift-card`, `hero-nfl-gift-card`, `deal-matching-soundbar`, `deal-sound-suite-bundle`, `deal-free-wall-mounting`); its out-of-stock package half is P1's, because D1 publishes the two 4-piece packages out of stock from the opening (D1: "a beat may open with it true") | K4 |
| 2026-10-02 | Beat 12 pins `pin-micro-rgb-evo` into the deals (D1's launch pin); beat 13 moves every window back 21 days, its labelled clock jump on the dials P1's | K4 |
| 2026-10-02 | Beat 2's contrast is New Jersey, else Texas: the two regions D1's region section rehearses verbatim | K4 |
| 2026-10-02 | Addresses: the homepage `/oh/`, the TV grid `/oh/?view=tvs` (P1 may add `grid.html`), a product `/oh/product?id=<sku>`, the phone `/oh/m`. The design's path forms `/oh/tvs` and `/oh/p/<sku>` do not reach a shell: the assets binding answers an unknown navigation with the root page (Vantage, R1 N7) | K4 |
| 2026-10-02 | The design's §4 heading says five acts; its table names eight (Arrival, Two rooms, The room completes, Curation, Windows, Three weeks later, One person, Best Buy counts). The config carries the table's eight; the lead rules if the five are wanted | K4, for the lead |
| 2026-10-02 | The store (lane M1, design §9): the room grids live in `index.html` as views at `/oh/?view=tvs\|laundry\|kitchen\|offers` (no `grid.html`); the search results are at `/oh/?q=` (the store’s contract, lane M3), which the store also reads from an old `/oh/search?q=` link client-side. Before any visitor the rail and the grids show the products file’s own `template` (best sellers, declared by the merchandiser), then the rest in the feed’s order. Before any visitor exists every one of these pages is the published template, in the catalog's own order, and nothing mints a visitor on load | M1 |
