# 28 · The operator surfaces at a customer's scale: an evaluation

Written 2026-09-05, after Simone's review of the learning console on staging, for the delivery session,
which takes the rebuild. Internal. The rule it applies: the surface a customer's merchandiser or analyst
operates has to be a first-class enterprise system, able to hold thousands of items, hundreds of slots and
hundreds of cell combinations, with no page that grows without bound and no scroll that stands in for
navigation. What works for a demo of 26 pieces and 4 slots is not the product.

## 1 · What exists

Two pages, each one long column with a top bar.

| Page | Top bar | Sections, top to bottom |
|---|---|---|
| `/tuning.html` | scope, sign-in (still the token box) | the reflex weights per dimension, the four content rows, the actions, History |
| `/learning.html` | Brand (a free text box), Slot (one dropdown of every slot on every page), Sign in | The lift grid · What is exploring · Policy comparison · Version history · The dials, this slot · The dials, every slot |

Every section renders in full on load. Moving between concerns is scrolling. The URL names the scope
and the slot and nothing else, so the browser's back button and a bookmark do not know which view a person
was on.

## 2 · What each list is bounded by

| List | Grows with | Today | At a customer |
|---|---|---|---|
| The lift grid, "Everyone (the pooled row)" | items the slot has served | the whole snapshot downloaded, every row rendered, filter and sort in the browser | hundreds of content pieces per brand; thousands on a product slot |
| The lift grid, "Every cell" | items × populated cells | same | tens of thousands of rows (doc 22 §14.1); a snapshot of megabytes |
| What is exploring | items under the observation floor | every one rendered | most of the catalog early on |
| Policy comparison | items × policies | built from the day report, which reads up to 50,000 ledger rows | thousands of rows |
| Version history (learn, lift, priors) | revisions | 50 kept, 12 shown | fine |
| Proposals | the cycle's proposals | 12 shown | fine |
| Slot dropdown | pages × slots | ungrouped, unsearchable | hundreds |
| Brand | brands | a text box | a list of a few |
| The dials | configuration | fixed | fine |

The two that can never be flat lists are the grid at "Every cell" and the policy comparison; the two that
must be paged by the server are the grid at the pooled row and the exploring list; the pickers must be
searchable and grouped.

## 3 · What a first-class operator system needs

1. **One application, not two pages.** Tuning and learning are two views of the same slot. A left rail
   carries the views; each view has a route, so the back button, a bookmark and a link in a message all
   land on a screen. Top tabs run out of room at eight views, which is why the rail.
2. **A context chosen once.** Brand, then page, then slot, each a searchable picker fed by the server and
   grouped (slots by page), shown at the top of the rail and kept across views.
3. **Server paging for every list that grows with the catalog, the cells or time.** Cursor, page size 50,
   sort and filter as query parameters, the count shown ("312 items, showing 1 to 50"). The browser
   filters only within the page it holds. Lists bounded by configuration (dials, rewards, arms) stay as
   they are.
4. **Cells are a drill-down, never rows.** The grid shows one pooled row per item; opening an item shows
   its cells, paged. "Every cell" as a flat table is gone.
5. **A landing page that is a work queue.** What needs a person, as counts with links: proposals awaiting
   a decision, saves that were refused, slots with no evidence yet, items frozen or rejected, erasures
   pending. The data lives behind the links, not on the landing page.
6. **Search wherever there is a picker.** Item by id, customer id or title; slot by name; cell by
   dimension value.
7. **Bulk where the catalog is big.** Freeze, reject and reset on a selection; export the page or a
   filtered set, never everything by default.
8. **Density built for tables.** Sticky headers, fixed row heights, right-aligned tabular numbers, the
   dials in a side panel that does not scroll with the table.
9. **Words, not symbols** (already the rule; the grid's headings were changed on 2026-09-05).
10. **Every screen rendered in a test.** The learning console has one (`src/console/learning.render.test.ts`);
    the tuning page needs the same, and the new application inherits it.

## 4 · What the platform must provide, and who builds it

The outcome-learning session builds these routes first, each with a test and a row in kit 02, so the
application has something to page from the day it starts.

| Route | Answers | Notes |
|---|---|---|
| `GET /v1/:tenant/lift/rows?slot=&brand=&level=pooled\|cells&item=&q=&sort=&dir=&cursor=&limit=` | one page of the snapshot's rows, with the total | the snapshot stays one object per slot; the route pages it. Past about 5,000 items per slot a materialised index is the follow-up |
| `GET /v1/:tenant/lift/items/:item?slot=&brand=&cursor=` | one item's cells, paged | the drill-down |
| `GET /v1/:tenant/learn/exploring?slot=&brand=&cursor=` | the under-floor list, paged | |
| `GET /content/slots/index?scope=&q=` | slots grouped by page, searchable, with counts (pieces eligible, evidence, dials set) | the picker |
| `GET /v1/:tenant/learn/queue?brand=` | the work queue counts | the landing page |
| `GET /v1/:tenant/visitors/:id/receipts` | what one shopper was served, with every sentence the receipt carries | the "why" lookup |
| proposals, history | already bounded | gain `cursor` for completeness |

The delivery session builds the application: the shell, the rail, the routes, the context pickers, the
paged tables, the work queue, the migration of both pages into it, the four slot rules as a screen (already
theirs), and the rendering test for what it ships. Until it lands the two pages stay as they are.

## 5 · Order

1. Outcome-learning: the grid rows route and the slots index (two days), then the shopper receipts, then
   operator accounts (hashed passwords, an accounts screen, reset), then the production stamp, the load
   test, monitoring and CI.
2. Delivery: the shell and the first two views (the grid and the dials) against the paged routes, then the
   rest.

## 6 · Decisions taken so the work can start

Simone can overrule any of these; they are here so nobody waits on a conversation.

- A left rail, not top tabs.
- Server paging for every catalog-sized list; page size 50; cursor-based; sorted by the server.
- The pooled row is the default; cells open per item.
- One application at `/console/`; the old pages redirect there once it lands.
