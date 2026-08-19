# Pizza Hut Engagement — Document Map

**Status:** INTERNAL — pursuit stage. Nothing in this folder is customer-facing yet; customer-facing derivatives get produced from these after review, with the same discipline as every engagement (no cross-customer naming: the retail demo lineage is described, never named, in anything Pizza Hut sees).
**Created:** 2026-08-11.

| Document | What it is | Read it when |
|---|---|---|
| [`PizzaHut-Demo-Proposal.md`](./PizzaHut-Demo-Proposal.md) | The proposal: opportunity window, the demo concept, what it takes, requirements, decisions, effort | Start here |
| [`PizzaHut-Affinity-Use-Cases.md`](./PizzaHut-Affinity-Use-Cases.md) | The creative layer: 12 demo beats, the 8-dimension registry, the demo arc, brand-voice grammar | Designing the demo story |
| [`PizzaHut-QSR-Personalization-Research.md`](./PizzaHut-QSR-Personalization-Research.md) | Fact-checked industry dossier: McDonald's×Dynamic Yield arc, Yum/Byte assessment, competitor table, behavioral stats, corrections | Before any customer conversation |
| [`PizzaHut-Demo-Build-Spec.md`](./PizzaHut-Demo-Build-Spec.md) | The engineering plan: reuse map, collision risks + mitigations, ordered build list, experimentation setup, assets & data | Before the build starts |

**The one-paragraph summary:** Pizza Hut told us their customers order the same pizza over and over unless something changes. Their own logged-in UX already monetizes that insight (3-tap reorder) — for the signed-in minority. Our edge affinity engine extends it to the anonymous majority: habit detected deterministically in-session, "your usual" one tap away with no login, exploration detected when it starts, lapse handled honestly by decay — plus natural-language Menu Search and a Table Concierge grounded in the same engine. The engine is built and live in the existing retail demo; the menu is just another catalog. The demo ships at `/restaurant` alongside the existing demo surfaces, on a dedicated Optimizely FX project, with the same honesty model: real engine, real seams, synthetic data labeled as such.

**Codename:** "Restaurant Demo." **Demo brand (decided 2026-08-11):** a fictional Italian pizzeria — working name **Forno Amico** — not a Pizza Hut clone; food photography from Pizza Hut's public product imagery (private demo), no third-party trade dress. **ODP:** wired-dormant — events always fire and are captured; connecting ODP later is setting credentials, zero code.

**Timing context (why now):** Yum! agreed on 2026-06-16 to sell Pizza Hut ($2.7B; LongRange Capital ex-China, Yum China for mainland; close expected ~Q3 2026). Post-close, the Byte by Yum! platform is a supplied service from the former parent, and a PE owner with an explicit turnaround mandate owns the roadmap. Details and sources in the research dossier.
