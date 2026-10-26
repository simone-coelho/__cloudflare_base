# Parity programme, amendment 2: the engine items the first activation needs

**Date:** 22 October 2026. **Owner's decision:** Simone Coelho, the same day: "we need to write all those tickets into the queue… we should just add them so that [the lead] can continue working on them." Approved as a whole. **For:** the active parity lead on `rem/integration`. **From:** the Tapestry documents lane (the Windows checkout), which does not touch the ledger.

## 1. Why this amendment exists

Three things changed after the parity programme was frozen on 8 October and amended on 9 October:

1. **The first activation is the carousel images per shopper on the product page, the module order second**, on one front-end integration merged behind Tapestry's switch before their holiday freeze (Simone, 20 to 22 October, on Tapestry's architecture document of 16 October).
2. **Tapestry's site is an app**: Salesforce Commerce Cloud for the layout, a PWA rendered on the server once and in the browser afterwards, so product-to-product navigation does not reload the page (their technical owner, 9 October).
3. **Both delivery paths are the design** (Simone, 22 October): the page holds the live connection and the engine pushes decisions over it; a server, or a page before its first list, requests the decision set over HTTPS. The request path is built; the push sender is not.

The items below were found by reading `rem/integration` while writing the starter packs for Tapestry's engineering teams (`docs/tapestry-packs/`) and the implementation plan for the programme manager. Every customer document now states these behaviours as what the integration does, so each item must exist before Tapestry's engineers test in December, or before the first activation in February, as marked. The code references are to `rem/integration` at the commit the writers read (22 October); the lead verifies them against the integration tree before specifying.

**Not in this amendment:** the Coach tenant on our staging deployment (a deployment under the owner's authority, parked by Simone on 22 October: "we can discuss later on"); anything on track 4 with Mandeep.

## 2. The tickets, in the ticket file's form

Numbering is the lead's; the items keep their E numbers here so the review records and the customer packs can point at them. Effort is in hours, half a day or within a day or two, in the engine's own terms.

### Group A · before Tapestry's December test (their lower environment, 2 to 18 December)

#### E1 · A new page instance on every product page view inside their app

- **Authority:** the front-end pack (`docs/tapestry-packs/1-front-end/01-quick-start.md`, `03-data-contract.md`: "every product page view is its own decision and its own exposure"); Tapestry's stack as their technical owner described it on 9 October (a PWA, client-rendered after the first page).
- **Done when:** navigating from one product page to another inside the app, and leaving a product page and returning to it, opens a new page instance: a new decision set for the page view, its own deadline, receipts that belong to that page view only, module and content impressions counted for the new page view; a page name or channel change still opens one as today; a page view within the same product (a variant switch) does not; the kit states the rule.
- **Starts from:** `src/sdk/listen.ts` around lines 327 and 399 (a new page instance only on a page-name or channel change); the page view's key.
- **Relates to:** P03 (module events), P34 (the hold per page view), P40. **Needed by:** the December test. Half a day.

#### E2 · The carousel slot's candidates limited to the images of the product on the page

- **Authority:** Tapestry's architecture document of 16 October, requirement 2 ("reorder content inside modules, starting with the above-the-fold image carousel"); the carousel design note (`docs/tapestry-packs/1-front-end/10-carousel-design-note.md`).
- **Done when:** a content slot can be declared as scoped to the anchor product: on a product page whose anchor product identifier is known, its candidates are only the catalogue items whose product link names that product (by master identifier, with the variant beside it where colour-specific images exist); an item of another product is never a candidate; a slot with no anchor on the page returns its default; the receipt names the scope.
- **Starts from:** `src/content/decide.ts` (the complements rule's use of `ctx.anchor` as a preference only; `featuredProductIds` as a link for credit); `src/content/kinds.ts` (the slot declaration).
- **Relates to:** P26 (content inside each module), P31 (eligibility by page signal). **Needed by:** the December test. Half a day to a day.

#### E3 · The push of the decision set over the live connection (the rendering record's N5)

- **Authority:** Simone, 22 October: both paths are the design; the standing delivery description (6 October); every customer pack.
- **Done when:** when a page view opens and whenever the shopper's decisions change for that page, the engine sends the decision set to the page over the live connection as the frame the SDK already receives (`core.on('decisions')` → apply), and the SDK no longer re-requests over HTTPS on a channel signal; the HTTPS request path (`POST /v1/{tenant}/decisions/snapshot`) stays for servers and for a page's first list before the connection is up; the subscribe surface their code uses is unchanged; the hold per page view (P34) governs what is drawn; the kit's "the socket is optional" and "no production push is promised" sentences are replaced.
- **Starts from:** `src/sdk/core.ts` (the receiver), `src/sdk/listen.ts` (the re-request on channel signal), `src/routes/realtime.ts` and `src/durable-objects/ShopperReflex.ts` (the sender's home).
- **Relates to:** P34, N5, N6. **Needed by:** the December test. Within a day or two.

#### E4 · The vocabulary routes allowed on customer deployments

- **Authority:** P38 (the published vocabulary as the authority); the content pack (`docs/tapestry-packs/2-content-and-cms/01-value-list-notes.md`, "put into effect on your deployment").
- **Done when:** `PUT /content/vocabulary` and its reads are admitted under the customer profile with operator authority; an import on a customer deployment reports values outside the vocabulary as the kit says; nothing else in the customer boundary changes.
- **Starts from:** `src/customerBoundary.ts` around lines 60 to 64 and 130.
- **Relates to:** P38. **Needed by:** before the first dataset loads (week 3 after the kickoff, about 10 November). Hours.

#### E5 · Import diagnostics name the record, not the merged position

- **Authority:** the export specification (`docs/tapestry-packs/2-content-and-cms/05-export-specification.md`), the IT pack.
- **Done when:** every error and warning from an import names the record by its identifier and by its position in the file sent, on merge as on replace; the kit's error example matches.
- **Starts from:** `src/content/import.ts` (the merged-catalogue position in `pieces[i]`).
- **Relates to:** P38. **Needed by:** the first dataset. Hours.

#### E6 · Two brand rules as guarantees: a minimum count of tagged items in the first positions, and a pin with a date window

- **Authority:** Tapestry's architecture document of 16 October, guardrails ("at least one on-model or campaign image in the first carousel positions"; "campaign hero image fixed in carousel slot 0 for the first 72 hours of a collection launch"); the page map template (`docs/tapestry-packs/2-content-and-cms/04-product-page-map-template.md`, rows G1 to G7).
- **Done when:** (a) a slot rule "at least N items carrying tag T in the first K positions" is enforced at decision time, not weighted, and the receipt names it; (b) a pin may carry a date window and a tag rather than an item identifier ("the item tagged `launch-hero` leads from date A to date B"), so that a shared slot on every product page pins the right item on each page and nothing after the window; an ineligible pinned item no longer refuses the whole slot where the pin is tag-driven.
- **Starts from:** position bands (P15, `src/content/`); pins (W20, `src/reflex/contentCompose.ts` around lines 196 to 273, the refusal at 224 to 236).
- **Relates to:** P04, P15, W20. **Needed by:** the December test for (a); the first launch with a campaign for (b). Half a day each.

#### E7 · The layout hold's live row (P74 on the remediation resume)

- **Authority:** already on the lead's list; the front-end pack states the hold as a rule.
- **Done when:** as the lead has it: the double `connected` refresh no longer breaks the hold on the hosted stamp.
- **Needed by:** the December test. Within a day or two, as recorded.

### Group B · before the first activation in production (January to early February)

#### E8 · The context order for the carousel before paint: the published table and the head script carry shot orders (N1, N3), the arm known before paint (N4)

- **Authority:** the rendering brief and the carousel design note (`docs/tapestry-packs/1-front-end/09`, `10`); the rendering record's N1, N3, N4.
- **Done when:** the published per-context document for the product page carries, beside the approved module layouts per device, channel and visit bucket, a carousel shot order per context; the head script applies it before the first frame, applies the brand rules, and writes the preload for the leading image; the arm is known before paint on a brand-new browser (N4); the server render's image list in the head is the documented input.
- **Starts from:** N1, N3, N4 as recorded in `docs/architecture/tapestry-rendering-and-caching-options-2026-10-09.md` §6.
- **Relates to:** P01, P30 (the context-only mode is accepted only on the layout slot today), E13. **Needed by:** the first activation. Within a day or two for the table and the script; N4 as recorded.

#### E9 · An exposure record for a carousel drawn before paint

- **Authority:** the carousel design note (credit and the holdout comparison).
- **Done when:** a carousel order applied by the head script before paint is recorded as an exposure of that page view with its context and arm, as the layout exposure is for modules, and credited the same way.
- **Starts from:** the layout exposure beacon (P30).
- **Relates to:** P30, P33. **Needed by:** the first activation. Half a day.

#### E10 · Catalogue size beyond the test scope

- **Authority:** the kit's catalogue limit (about 2,000 pieces, 2 MiB per catalogue document); one item per image across the whole product range exceeds it.
- **Done when:** a design decision first (per-product scoping of image records, sharding by product range, or a larger store), then the build; the test scope fits today and the first dataset is sized with Tapestry after the first test.
- **Design decision (the board, 2026-10-26):** E2 and E10 are one piece, built before the December test, not after. Image records are stored per product, so a carousel decision reads only the images of the product on the page and never the range. The 2 MiB publication cap stays as the guard for the slots and learning documents only.
- **Relates to:** E2 (one piece with it). **Needed by:** the December test (moved by the board on 2026-10-26 from "the full range, after the first test"). Design first; then within a day or two.

#### E11 · A catalogue-only service credential

- **Authority:** the IT pack (`docs/tapestry-packs/3-it-and-integration/01-export-mechanisms.md`, `05-security-pack.md`).
- **Done when:** a service credential can be limited to the catalogue import, so that the credential Tapestry's IT holds cannot publish slots, learning or priors.
- **Starts from:** `src/auth/authority.ts` (roles `operator` and `admin` on the whole tenant).
- **Needed by:** the production export job, January. Half a day.

#### E12 · First-answer time on the hosted stamps (P76 candidate)

- **Authority:** already on the lead's list; the performance sheet (`docs/tapestry-packs/1-front-end/07-performance-and-defaults.md`) states only design targets until this is fixed.
- **Done when:** as the lead defines it. **Needed by:** the performance budget session with their front end, week 1 to 2 after the kickoff, to state honestly; the first activation to meet.

#### E13 · Approved layouts enforced as a publication rule (N2)

- **Authority:** the rendering brief's rules; the rendering record's N2.
- **Done when:** a context order for a page is refused at publication unless it is one of the page's approved layouts; the approved set is a published, versioned document.
- **Needed by:** the first activation. Hours.

#### E14 · The shopper's shot order carried between page views and into the next first landing, with corrections after sign-in

- **Authority:** the carousel design note §4 and §6.
- **Done when:** the engine delivers the shopper's latest shot order over the live connection; the SDK keeps it in first-party storage for the next page view and the next first landing; a sign-in or a merge corrects it on the next page view; never applied to a carousel already on screen.
- **Relates to:** E3, E8, N6. **Needed by:** the first activation. Half a day, after E8.

### Group C · the export mechanisms and import improvements the IT pack states

#### E15 · The bucket-drop ingest, the scheduled authenticated pull, the manual-upload script, and an allow-list on the on-demand pull

- **Authority:** the IT pack, options (b), (c) and (d); the export mechanics report in the session scratchpad of 22 October.
- **Done when:** (b) a bucket we give them with a scoped credential or a presigned upload, ingested on notification or on a sweep, idempotent per object, a result object written back; (c) a scheduled pull from a URL they expose, with their token stored as a secret, an authentication header, no redirects, an allowed host, and an alert; (d) a script for a person on our side to load a customer file with the two headers; and the on-demand pull limited to allowed hosts.
- **Starts from:** `src/content/import.ts` (`HttpJsonSource`: JSON only, no auth header, follows redirects), `wrangler.toml` (no cron pulls), `scripts/import-content.mjs` (demo only).
- **Needed by:** (b) and (c) only if Tapestry chooses them in week 2 after the kickoff; (d) before the first dataset; the allow-list now. Within a day or two each; hours for the allow-list.

#### E16 · Import improvements the export specification states

- **Done when:** a load with no `mode` is refused rather than treated as replace; a load that changes nothing is skipped and says so; a dry run validates an export under the import's own rules (CSV, aliases, merge) without writing; a full-export mode expires the pieces missing from the file behind a guard; a source-address allow-list on the import endpoint.
- **Starts from:** `src/content/import.ts`, `src/routes/content.ts` (`POST /content/catalog/import`, the validate route).
- **Needed by:** the first dataset for the no-mode refusal; the production export job for the rest. Hours to half a day each.

#### E17 · Small registrations the content pack relies on

- **Done when:** the interim `journeyStage:post_purchase` tag and the `locale` tag are registered for the Coach tenant so a load does not warn on them; the module register's `purpose_later` field is accepted and ignored until the semantic term exists; a record with no format falls back to its type as the tagging guide says (check, and correct whichever is wrong).
- **Needed by:** the first dataset. Hours.

## 3. The owner's decisions, recorded

| # | Decision | Owner's words or ruling |
|---|---|---|
| 1 | The seventeen items enter the queue as tickets | "we need to write all those tickets into the queue… add them so that he can continue working on them" (22 October) |
| 2 | Both delivery paths are the design; the push sender is built | "we need to be able to support both… I should be able to call an API and get a decision, or I should be able to push it. That was originally what we had decided" (22 October) |
| 3 | The staging tenant for Coach is parked | "I'm not sure that we need to worry right now about the staging tenant that we can discuss later on" (22 October) |
| 4 | Order: group A before Tapestry's December test; group B before the first activation; group C's (b) and (c) only if Tapestry chooses them | This lane's proposal, from the plan's dates; the lead sequences within the programme |
| 5 | E2 and E10 are one piece, built before the December test; image records stored per product so a carousel decision reads only the page's product's images, never the range; the 2 MiB publication cap guards the slots and learning documents only; E10's needed-by moved to the December test | "E2 and E10 are one piece, built before the December test, not after. Image records are stored per product, so a carousel decision reads only the images of the product on the page and never the range. The 2 MiB publication cap stays as the guard for the slots and learning documents only. Record the design decision under E10 in the 22 October amendment and move its 'needed by' to the December test." (the board, 26 October) |

## 4. What the active lead does with this

1. Verify every "starts from" against the integration tree at its current head; where a line has moved, record the correction in the ticket.
2. Open the items as tickets in the parity programme (the second programme, or a third if the lead prefers), in the first programme's work-order form, numbered as the lead numbers them, with E1 to E17 kept as cross-references; keep `check` PASS.
3. Record this file and the owner's decisions in `_evidence/parity-step3/AMENDMENTS.md` under a dated "Amendment 2" heading; add this file to the frozen authority copies.
4. Sequence group A ahead of everything not yet built that December does not need; report the score line as always.
5. Nothing here authorizes a deployment, a cloud resource or a credential; the staging tenant is parked and is not part of this amendment.
