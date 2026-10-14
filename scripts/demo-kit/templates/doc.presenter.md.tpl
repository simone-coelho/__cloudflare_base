# @@NAME@@: presenter script

**A skeleton, scaffolded @@DATE@@ by `scripts/demo-kit/new-demo.mjs`.** One row per beat, in the director's order; each beat is pressed with **Next** on the director bar (or chosen from **All beats**). Fill in what is said and what the room sees once the beat is built and measured; never claim a number the suites have not read. The governing design is [@@DESIGN@@](../../@@DESIGN@@).

Before presenting: the morning routine below, then both suites green against the worker you present from.

## The beats

| # | Act | The press | What moves | Beat document | Built by |
|---|---|---|---|---|---|
@@BEATS_TABLE@@

For each beat, once built, write beneath this table:

- **Say:** the sentence, in the room's words, that the director's line carries (`public/@@SLUG@@/beats.json`, `line`).
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
node scripts/demo-kit/seed.mjs --config scripts/demo-kit/configs/@@SLUG@@.json --base https://@@WORKER@@.expedge.workers.dev --token <operator token>
npx wrangler deploy --config wrangler.@@SLUG@@.toml          # the seed rewrote the beat documents; the owner's go
node scripts/demo-kit/region-seed.mjs --config scripts/demo-kit/configs/@@SLUG@@.json --base https://@@WORKER@@.expedge.workers.dev --token <operator token>
node scripts/demo-kit/check-demo.mjs --config @@SLUG@@ --base https://@@WORKER@@.expedge.workers.dev
```

## Decisions log

| Date | Decision | By |
|---|---|---|
| @@DATE@@ | Skeleton scaffolded; the beats follow `public/@@SLUG@@/demo.config.json` | scaffold |
