# Freeze sheet: `tapestry-parity-build`

**For Simone, as contract authority.** The Closure Ledger records a decision once, at the freeze, and refuses to build until every one is recorded. These are all of them, each with our recommendation, so the freeze is one sitting. Answer "yes to all" or name the exceptions by number. Written 2026-10-07 from `docs/BTI-Parity-Build-Tickets.md` and `docs/architecture/tapestry-requirements-extraction-2026-10-07.md` section H. On the freeze this file is committed beside `program.json` as the decisions' authority.

## A. The program

1. Open `tapestry-parity-build` with the 25 tickets of the order of work, reported as x/25, replacing "P01–P27, x/27" everywhere. Recommend yes.
2. Hold the vector tickets P17–P25 and P27 for a second program opened when the sample (T16) and the encoder answers (T11) exist. Recommend yes.
3. Leave P36 out; fold the seed-rule editor into P01 only if wanted now. Recommend yes, editor not now.
4. Extend the 2026-09-16 standing mandate to this program: local build in order, live acceptance batched at the end, no deploy, no push. Recommend yes.
5. The lead amends the live `AGENTS.md` on `rem/integration` to report x/26 and x/25 separately, and the three role files to name both programs and their authority. Recommend yes.
6. A frozen copy of the ticket file and of the investigation's sections G and H is committed beside the program as the quoted authority; the parity document is cited by section number only. Recommend yes.
7. The lead re-registers the two WSL worktrees and creates the lane checkouts (the two scripts), and nobody prunes worktrees from either side. Recommend yes.

## B. The design lines (the H rows)

8. **P28, the blend.** Opt-in per layout slot: score = R + (1 − p) × B + p × Q, where R = (M − i) / M is the rank base from the configured order, B the pre-lift behaviour score, Q the clamped lift minus one; p defaults to 0; content slots unchanged. The "p = 0 serves your order exactly" promise holds when the layout weights no shopper dimension. Recommend yes, or supply Nitin's arithmetic.
9. **P29, the reason vocabulary.** Frozen as written in the ticket, extensible by later tickets, Nitin's confirmation as a live row; the off-limits slot's record kept outside the decision ring so W20.G2.03 holds. Recommend yes.
10. **P30, context-only layout.** Built now, off by default, with a non-identifying context-key header and an exposure beacon; their front-end lead's confirmation as a live row. Recommend yes.
11. **P33, conversion credit.** A per-slot attribution policy with module-tied credit only, absent by default; shared or last-engaged credit only if their data science asks later. Recommend yes.
12. **P32, module type.** A registry-draft dimension with our nine proposed types; engagement teaches tags at weight 0 by default; the free-text fallback retired only under a new catalogue marker; Nitin decides the list and activation. Recommend yes.
13. **P35, audiences into Experimentation.** A tenant-configured second ODP identifier, written only when P12's identifier is present, creating nothing in ODP, plus the page-side path in the kit. Recommend yes.
14. **P16, objective per piece.** Specified now as a per-piece success event and a per-slot conversion table, absent by default, Nitin's values as a live row. Recommend yes (otherwise hold P16 out).
15. **P13, the handshake.** The engine side built now (loaded hook, first decision on the first request, their identifier carried but never treated as proof); the specification for their backend written alongside; their review (T25) as a live row. Recommend yes.

## C. Values the specifier cannot derive

16. **P02.** A layout slot is captured only when its learn basis is rendered-v1; otherwise it is served without exposure and the mismatch is named. Recommend yes.
17. **P01.** A context is one entry channel or "any" with one or more visit buckets or "any"; the most specific match wins; a tie is refused at publication. The order is served exactly until P28, never on the default arm, without the context's consent, or under exploration. Recommend yes.
18. **P03.** The impression is the existing render acknowledgement; engagement is a click inside the container plus declared interactions, credited as the slot's click reward; events carry the per-slot position. Recommend yes.
19. **P04.** An ineligible module pinned at a position refuses the whole slot, as a refused prefix pin does today. Recommend yes.
20. **P05.** Position effects estimated from adjacent-swap pairs as a click ratio; credit normalised by that weight behind a switch their data science confirms first (W26 LV2). Recommend yes.
21. **P06.** "Every term applied" means the learned term at full trust (γ = 1); on a blend slot, a configured shadow p defaulting to 10 percent. Recommend yes.
22. **P07.** The context prior takes the regional prior's form: its own block and K, off when absent, aggregated per channel × visit bucket; that K is the "own weight" of H row 4. Recommend yes.
23. **P09.** On content slots, γ = p / 100. Recommend yes.
24. **P10.** A signal is an action with a behaviour weight above zero; below the floor only context terms apply (seeds, P01 orders, priors, ladder levels 0 to 2). Recommend yes.
25. **P11.** A page type is the slots document's page key; below its floor the estimate is shrunk by the exposures it lacks (floor − n), never skipped. Recommend yes.
26. **P14.** Product type is the value of one tenant-declared dimension on the event; the weight is itemised on the event's interest update. Recommend yes.
27. **P08.** Pooling is declared per module in the catalogue; page enters the ladder after "everyone" under a W25 grammar version bump; W26 R2 untouched. Recommend yes.
28. **P12.** An identifier change merges only on a signed statement naming both identifiers; the format is a tenant setting. Recommend yes.
29. **P15.** A position band overrides only dimension weights, over contiguous ranges covering 1 to take. Recommend yes.
30. **P26.** The nesting representation is the specifier's to rule, as the ticket says, judged by rem-reviewer. Recommend yes.

## D. The remediation, same sitting

31. **Shrink the baseline.** Regenerate `docs/remediation/baseline-failures.json` shrink-only after the W41 receipt, so the 26 tests that now pass can no longer be hidden. Recommend yes.
32. **The W22 regression.** Done on 2026-10-08 under the standing mandate: the triage found a stale test expectation, not a product defect; the test was corrected, reviewed, and W22's receipt superseded at the corrected artifact. No boundary change was needed. Nothing to answer.
33. **The landing lane.** After the W41 receipt, one implementer merges the product branch into a fresh checkout cut from `rem/integration`, resolves the nine files with the hourly, day-report and publication-cache resolution specified and reviewed as a ticket, against a frozen product-branch head you name; push stays ungranted. Recommend yes.

## E. Sentences the draft had to add to make a criterion testable (from the drafting notes; confirm or change)

34. **P28.** The rank base counts positions from 0, so the first module's R is 1. Recommend yes.
35. **P01.** An unknown channel or visit bucket matches no context, not even one that names "any"; "never under exploration" means a decision on which the slot's exploration picks receives the slot's own decision; seven LOCAL criteria rather than six. Recommend yes.
36. **P10.** The response to the (N + 1)th signal is the first personalized one; a floor of 0 is off; below the floor pins, exclusions, eligibility, freshness and merchandising still apply and visitor-hashed exploration does not; signals are counted on the shopper's persisted state, so a returning shopper's earlier visits count. Recommend yes.
37. **P07.** The context prior falls back from channel and visit bucket to the channel alone, never to everyone, so the regional prior's shares are not double-counted; it is aggregated through the existing population-trend object, with no new binding. Recommend yes.
38. **P04.** An off-limits module whose baseline position lies beyond the slot's take is not served. Recommend yes.
39. **P09.** A surface only: the percentage is the tuning screen's form of the stored dial, no second stored value; only the console view and the kit are writable. Recommend yes.
40. **P11.** The shrinkage applies to the estimate the ladder answers with; a piece with no level reaching nMin still gets no lift, so W25 is unchanged. Recommend yes.
41. **P30.** A context-only slot ignores seed rules on campaign term and referrer network, so two shoppers in one context cannot receive different orders. Recommend yes.
42. **P32.** The type fallback is retired in slot exclusions as well as in ranking; the registry draft is placed in the kit's payload schemas document until the Phase 1 draft exists. Recommend yes.
43. **P16.** A declared success event the slot's table does not value credits nothing. Recommend yes.
44. **P29.** The off-limits slot's record goes to the ledger and the export but never into the shopper's decision ring. Recommend yes.
45. **P12.** The identifier format lives in the reflex document. Recommend yes.
46. **P13.** The handshake specification is the Tapestry lane's document, outside the write boundary; its review by their backend owner is the live row. Recommend yes.
47. **P34.** The SDK build script is not writable; if the script itself needs a change the boundary is amended then. Recommend yes.
48. **P05.** A third live row for the share default and the position-effect confirmation by their data science. Recommend yes.
49. **P14.** The population trend an event feeds keeps the action's own weight; only the shopper's interest update takes the product-type weight. Recommend yes.
50. **P35.** The customer's hashed identifier is read from wherever P12 and P13 hold it; both hosts are writable so either can supply it to the ODP writes. Recommend yes.

## F. Added 2026-10-08, from the specification work

51. **W27, replay compares by value.** The parity specification review found that replay compares records as JSON text while the recovery path stores keys sorted, so a shopper's acknowledged decision replays as "explanation" today although every value is equal; it reproduces on both hosts. The fix is being built inside W27's existing write boundary, and W27's receipt will be superseded at the fixed artifact. Record it as a new W27 criterion R5 ("replay compares records by value, not by key order; an ordered list in another order is a value difference; a candidate-list-only difference classifies candidates-only"). Recommend yes; a no leaves the tests enforced by W27's acceptance command without a criterion of their own.
52. **Specification before the freeze.** The ledger refuses every build until all 25 specification gates pass, so every ticket was specified on this sheet's recommended answer, with the item number in the test title; a different answer from you re-specifies that ticket before its build. Confirm this way of working (lead ruling R-P15). Recommend yes.
53. **P35, which identifier goes to Experimentation.** The second ODP identifier is read from the verified account link (P12), never from the identifier the page merely carries (P13). The link can hold either the hashed-email account or, for a shopper recognised only by first landing, the first-landing hash; sending the latter to ODP would create a profile keyed by a value Experimentation cannot match. Rule: only a hashed-email account identifier is written as the second identifier; a first-landing link writes none. Recommend yes.
54. **P02 and P32, one module type.** P02 registers a module with a required kind; P32 adds a module-type tag as a learning dimension. The specification review found these are one concept defined twice. Rule: the module's kind is the module-type value; P32's dimension reads it from the catalogue entry, and no second field is introduced. Recommend yes.

## Owner answers (2026-10-08)

Yes to all 54 items, no exceptions. Given by the owner (Simone Coelho, contract authority) to the lead session on 2026-10-08, in these words: "So yes to all."
