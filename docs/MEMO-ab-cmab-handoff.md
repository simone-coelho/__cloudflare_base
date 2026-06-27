# MEMO — A/B + MAB + CMAB workstream → Integration / Deploy team

**To:** Deployment owners + Revenue Radar workstream · **From:** A/B + CMAB workstream · **Date:** 2026-06-26
**Re:** What's merged, current understanding, and what you need to confirm before the prod deploy (demo Mon 2026-06-29)

---

## 1. What I've done (all committed to `feature/real-time-personalization`, latest = `e43b14b`)

The experimentation layer that pairs with Revenue Radar's diagnose→fix→prove loop. **One integration seam:** your Opal **Launch** calls `launchExperiment(...)` → `{ experimentId, experimentKey, readoutUrl, status, ruleType, metricKind, enabled, fellBack }`, and it opens the Engine readout.

**Real experiment creation via the Optimizely REST API — verified live (read back from the API):**
- **A/B** — rule `type:"a/b"` (flag 563892)
- **MAB** — rule `type:"multi_armed_bandit"`, even split, `baseline:null` (flag 563891)
- **CMAB** — rule `type:"contextual_multi_armed_bandit"` + `attribute_ids` + `distribution_goal:"automated"` (flag 563903)
- Idempotent; auto-falls back to `targeted_delivery` ONLY if a typed rule is rejected, so the loop never breaks. Lift/allocation numbers in the Engine readout are clearly-labeled **representative** (real stats need real traffic).

**My files (committed):** `src/services/{experimentFx,cmab,experimentRun,fxEnv}.ts`, `src/routes/experiment.ts`, `src/agents/tools/experimentTools.ts`, `public/ab-cmab.js`.
**Additive hooks only in shared files** (fenced): `src/index.ts` (`/experiment` mount, append-only), `src/agents/tools.ts` (tool register), `public/storefront.html` (one `<script>`). **I did not touch any funnel / revenue-radar files.**

**Endpoints:** `POST /experiment/launch` · `GET /experiment/:key/readout` · `GET /experiment` · `GET /experiment/cmab/{decide,matrix}`.
**Events I emit** into `demo_events` (non-overlapping with your `checkout_*`): `experiment_launched · variation_assigned · experiment_view · conversion · mab_reallocation · cmab_decision`.
**Verified FX schemas + per-type use cases:** `docs/EXPERIMENT-USE-CASES.md` (§6 has the exact rule/metric/event shapes).

## 2. Current understanding

- All code (mine + Revenue Radar) lives on **`feature/real-time-personalization`** — the de-facto main (`master` = empty initial commit; there is no `main`).
- ⚠️ **The branch is AHEAD of `origin` by 2 commits — it must be `git push`ed before you can pull/deploy.**
- I deploy ONLY to the **dev** worker `edge-platform` (edge-platform.expedge.workers.dev) for verification. **You own the prod deploy** (`edge-platform-prod`, `wrangler deploy --env production`). I have never deployed to prod.
- The experiments I created are **real artifacts in the project's `development` Optimizely environment** — pullable in app.optimizely.com ("not a mockup") — but they **do not change the storefront** (the storefront personalizes via its own edge engine + the `personalized_banner` flag; it does not fetch decisions for these flags). They are the measurement capability; the Engine tab visualizes them representatively.
- ~8 **test flags** + custom events (`add_to_cart`, `checkout_complete`) exist in the dev project from my iteration. The demo creates its own on Launch.

## 3. Questions / confirm before prod

1. **Push:** OK for me to push `feature/real-time-personalization` to origin (ahead 2), or do you handle pushes?
2. **`OPTIMIZELY_WRITE_ENABLED` in prod:** ON → every Launch creates REAL Optimizely flags/experiments during the demo; OFF → the seam returns a clean simulated experiment + representative readout. Which do you want for the live demo?
3. **Optimizely environment + secrets for `edge-platform-prod`:** confirm `OPTIMIZELY_API_TOKEN` / `OPTIMIZELY_PROJECT_ID` / `OPTIMIZELY_SDK_KEY` / `OPTIMIZELY_ENVIRONMENT` are set on the prod worker. (My flags/events are in `development`; the launch code will create them in whatever env prod points at, on demand.)
4. **`/__shot` route:** internal headless-browser + JS-eval verification route — please **gate or remove before prod**.
5. **Test-flag cleanup:** want me to add a cleanup endpoint to archive the ~8 dev test flags, or will you archive in the UI?
6. **Seam wiring:** is Revenue Radar's Launch calling `store.launchExperiment(...)` / `POST /experiment/launch`? (Both return the same shape.)
7. **Beats 11–13:** currently representative readouts; real rules are created via the Launch seam / Opal tool. Wire them to launch real rules on cue, or keep representative?

---

_Net: A/B + MAB + CMAB are real and verified on the dev worker; the merge is done on the feature branch; prod deploy + the calls above are yours._
