# QVC Engagement — Document Map

**Status:** INTERNAL — pursuit stage, very large opportunity. Nothing here is customer-facing; customer-facing derivatives are produced after review. **Read each dossier's corrections/do-not-use section before any customer conversation** — this account is unusually easy to misspeak about (post-Chapter 11, renamed parent, changed metrics, dead constructs).
**Created:** 2026-08-18. Research: three parallel deep-research passes (business/SEC + first-party API measurement · competitive/Adobe + measurement · site recon/design), all claims sourced and confidence-marked.

| Document | What it is |
|---|---|
| [`QVC-Demo-Design-Brief.md`](./QVC-Demo-Design-Brief.md) | **Start here.** The architect's synthesis: the demo concept ("The Bright Hour"), five load-bearing truths, build map on our edge stack, decisions pending, meeting-ready guidance |
| [`QVC-Business-Intelligence-Dossier.md`](./QVC-Business-Intelligence-Dossier.md) | Who they are now: Chapter 11 emergence (2026-08-06), financials, the merchandising machine measured from their own API (~235 presentations/day), shopper economics (92% repeat / 3% new), tech-stack fingerprint, their KPI vocabulary, 23 corrections |
| [`QVC-Competitive-Measurement-Dossier.md`](./QVC-Competitive-Measurement-Dossier.md) | The Adobe Target displacement case (their own docs vs 24-hour offers), the likely hurdles ranked with POC proof criteria, content-personalization-vs-product-recs rubric, warehouse/export comparison, **our own available-today-vs-roadmap honesty ledger**, live-commerce white space |
| [`QVC-Site-Recon-Demo-Design.md`](./QVC-Site-Recon-Demo-Design.md) | The design bible: full site/UX teardown from their shipped code, the representative catalog + offer schema, the 14 demo beats, dimension registry, asset plan, do-not-use list |

**The demo in one line:** a fictional live-shopping retailer ("The Bright Hour") on our real edge engine, whose centerpiece is a short-lived offer entering, being tagged with human approval, going eligible, ranking differently per visitor, expiring, and being succeeded — automatically — with a warehouse-shaped decision row as the receipt.

**The three sentences that orient any newcomer:** QVC runs Adobe Target today on a legacy stack that structurally cannot decision offers that live 24 hours — their own explainability report needs an activity live 15 days. They emerged from Chapter 11 twelve days before this folder was created, their new-customer file has collapsed, and 90% of new customers start digitally — so the demo stars the anonymous first-time visitor. And they already built our point of view by hand (`top-offers.json`: six category dimensions with evergreen fallbacks, on a branch named `test-do-not-publish`) — the pitch is that we finish what they started.
