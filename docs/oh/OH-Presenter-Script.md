# OH: presenter script

**A skeleton, scaffolded 2026-10-02 by `scripts/demo-kit/new-demo.mjs`.** One row per beat, in the director's order; each beat is pressed with **Next** on the director bar (or chosen from **All beats**). Fill in what is said and what the room sees once the beat is built and measured; never claim a number the suites have not read. The governing design is [docs/lg/OH-Demo-Design.md](../../docs/lg/OH-Demo-Design.md).

Before presenting: the morning routine below, then both suites green against the worker you present from.

## The beats

| # | Act | The press | What moves | Beat document | Built by |
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

For each beat, once built, write beneath this table:

- **Say:** the sentence, in the room's words, that the director's line carries (`public/oh/beats.json`, `line`).
- **Show:** what changes on screen, and where (the before/now row, the receipt, the panel).
- **Hold:** the honesty line that goes with it (price is never decided; the region is the request's own; attribution is not incrementality).
- **Measured:** the figure the suite read, with its date.

## Honesty, every beat

- The visitor's region is always the request's own; a contrast region is asserted and labelled, never the opening default.
- Regional sales are synthetic and labelled "synthetic → warehouse" until the customer's rows replace them; the census is shown, never scored.
- Price, financing and eligibility never vary by geography or inferred income; nothing decided sits near a financing line.
- No recognition across devices without sign-in. Attach is measured, never claimed. No lift number, ever.

## The morning routine

```bash
npm run check:generated
node scripts/demo-kit/seed.mjs --config scripts/demo-kit/configs/oh.json --base https://edge-platform-oh.expedge.workers.dev --token <operator token>
npx wrangler deploy --config wrangler.oh.toml          # the seed rewrote the beat documents; the owner's go
node scripts/demo-kit/region-seed.mjs --config scripts/demo-kit/configs/oh.json --base https://edge-platform-oh.expedge.workers.dev --token <operator token>
node scripts/demo-kit/check-demo.mjs --config oh --base https://edge-platform-oh.expedge.workers.dev
```

## Decisions log

| Date | Decision | By |
|---|---|---|
| 2026-10-02 | Skeleton scaffolded; the beats follow `public/oh/demo.config.json` | scaffold |
