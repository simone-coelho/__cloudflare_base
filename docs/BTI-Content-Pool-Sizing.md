A content pool has to be wide enough to cover the range of taste it will be asked to serve, and small enough that each asset earns enough exposure to be judged. Those two pressures set the number. Volume on its own does not.

## The BTIE document contains two different asks

| Where | The ask | What it implies |
|---|---|---|
| **Section 4.1** | 40+ photos per page, 15 variations of the 12 pieces on each product page, 20+ See and Think pieces per product | Read per product: **180 variants per page**, and at 1,000 active products roughly 180,000 assets |
| **Appendix A.3.7** | "50-100+ pieces", "2-3 variants per piece" | Read site-wide: **150 to 300 assets in total** |

Worth settling which is intended, because Phase 1 exit is written against the first one.

## What evidence actually costs per variant

The first two rows are the thresholds the BTIE document sets for itself. The last two are what it takes to measure a difference between two variants, at a 2 percent baseline click rate, two-sided, 95 percent confidence, 80 percent power.

| Threshold | Impressions per variant | 180 variants on one page |
|---|---|---|
| A.3.5, exploration bonus ends | 500 | 90,000 page views |
| A.3.6, `min_impressions` for a hero | 1,000 | 180,000 page views |
| To see a large difference, 2.0 to 3.0 percent | 3,825 | 688,000 page views |
| To see a realistic difference, 2.0 to 2.4 percent | 21,108 | 3,800,000 page views |

Those are per product page, before splitting by context. Only the very top of a catalog can supply traffic at this scale.

## Three consequences

- **A variant below the floor is being served without evidence.** That is exploration, and exploration is paid for in conversion. A wider pool does not add intelligence, it adds untested inventory the system is obliged to show.
- **Campaign content lives six to eight weeks.** Where the floor takes longer than the asset's shelf life, the asset is produced, shown, retired, and teaches nothing.
- **Near-duplicate variants occupy the same point in the taste space.** Fifteen crops of one hero dilute evidence without widening choice. Twelve assets spanning four style clusters and three journey stages give the engine something real to choose between.

## Size the pool from the slot map instead

**Assets for a slot = items the slot shows × dimension values to cover × journey stages to serve.**

| Slot | Working | Assets |
|---|---|---|
| Homepage hero | 1 item × 4 style clusters × 3 stages, one or two each | 12 to 24 |
| Six-item carousel | Enough that no shopper repeats | 30 to 50 |
| Launch page total | | **50 to 80** |

Then tier by traffic: deep variant coverage on the top products and main marketing pages, one well-tagged asset per style cluster per stage in the middle, and a single strong default in the long tail, where personalization comes from sort and recommendations rather than content variants.

## How we will know, early

Per dimension we report tagging coverage, and per item we report how many exposures it still needs before it clears its floor, per slot. Within a week of live traffic that shows whether the pool is too narrow, too wide, or wrongly spread, while there is still time to act on it.
