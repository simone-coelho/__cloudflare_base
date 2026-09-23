# QVC "Top Offers" demo — resume state

**Written 2026-09-23 at a forced pause (machine restart). Assume the reader has none of the prior context.**

Branch `feature/real-time-personalization`. Everything below is committed locally. **Nothing has been pushed** —
push authority was never granted for this lane.

---

## What this is

The demo for QVC's number one use case, as Jamie Simpson stated it on 11 and 22 September: a **four-container
"Top Offers" homepage module**, filled from a pool of twelve promotions (growing to twenty), each living three to
seven days, judged on clicks into the module.

The retailer is fictional: **Lantern & Lane**. The tenant/scope is `shn`.

**The pool is PROMOTIONS, not products.** Garrett's FPO visual shows "Spring Beauty Event", "Refresh Your Home",
"Top Kitchen Picks" — an editorial image, a title, a badge, one Shop Now. No price, no strikethrough, no rating,
no Add to Cart. This is not cosmetic: `QVC-Competitive-Measurement-Dossier.md:184` says Constructor already owns
product discovery on both their properties, so a module dressed as a product grid argues on the incumbent's turf
by accident. An earlier build made exactly that mistake and was rejected.

## Where to start reading

1. `docs/qvc/QVC-Use-Cases-and-Engine-Fit.md` — the requirement, line by line, checked against the code.
2. `docs/qvc/QVC-Top-Offers-Demo-Plan.md` — the original beat plan.
3. `scripts/lib/shn-promotions.mjs` — the pool. One file, twenty-one promotions.
4. `scripts/seed-shn.mjs` — the only place the demo's world is defined.

## It is deployed

**https://edge-platform.expedge.workers.dev/top-offers/**

That is the repo's own demo worker: the DEFAULT wrangler environment, `ENVIRONMENT=development`,
`DEPLOYMENT_PROFILE=demo`. It also hosts `/live/` (Bright Hour) and `/meridian/`, both verified still serving
after the deploy. Staging and production are `DEPLOYMENT_PROFILE=customer`, where `/ops/demo-bootstrap` refuses
by design and the stamp workflow deliberately omits demo assets — a demo does not belong there.

Deployed with `npx wrangler deploy` (the default env, no `--env`). The guarded `npm run deploy staging|production`
stamp workflow is a different thing entirely and is not used for this.

### What had to be provisioned on that worker, once

| | |
|---|---|
| `TENANTS` | `{"provisioned":["shn"],"operatorGrants":{"top-offers-demo":["shn"],"seed-shn":["shn"]}}` |
| `SDK_KEYS` | `shn:demo-site` |
| `RETENTION` | version-1 policy for `shn`, all seven categories |
| `JWT_SECRET` | generated for this worker; held only in the operator's own store |
| queue `events-dead-letter` | the config gained this consumer after the previous deploy; the deploy fails without it |

None of these existed on that worker before, so nothing was overwritten. `JWT_SECRET` first refused as
"binding name already in use" — it was a stale plain var from an older deploy, and the deploy cleared it because
the current `[vars]` has none.

### To reseed the deployed demo

```bash
export JWT_SECRET=... JWT_ISSUER=edge-platform JWT_AUDIENCE=edge-platform-api DEPLOYMENT_PROFILE=demo
node -e "import('./scripts/lib/tool-token.mjs').then(m=>m.resolveToolToken({payload:{sub:'seed-shn',roles:['operator']},expiresIn:'45m',allowMint:true}).then(console.log))"
node scripts/seed-shn.mjs --base https://edge-platform.expedge.workers.dev --token <that token>
npx wrangler deploy     # the seed re-anchors the beat files; the served assets must match what was seeded
```

**The seed re-anchors every window to now and rewrites the beat documents, so a reseed must be followed by a
deploy.** The worker reads those documents from its own ASSETS binding when it applies a beat; if they drift
from what was published, a beat applies a different document than the one that was seeded.

## To bring it back up locally

```bash
npx wrangler dev                       # port 9100; it will NOT be running after a restart

export $(grep "^JWT_SECRET=" .dev.vars | sed "s/'//g")
export JWT_ISSUER=edge-platform JWT_AUDIENCE=edge-platform-api DEPLOYMENT_PROFILE=demo
node scripts/seed-shn.mjs              # re-anchors every window to now; run it after every restart

node scripts/rehearse-top-offers-page.mjs   # request-level: engine + what the browser can reach
node scripts/seed-shn.mjs                   # reseed between suites
node scripts/rehearse-top-offers-dom.mjs    # loads the real page script and presses all 15 beats
```

Run the seed **before each suite**. Each suite leaves the published slot document where its last beat left it
(the DOM suite ends on `take: 2`), so a suite started on another suite's leftovers is not measuring the opening
state. This is hygiene, not a known failure — the two suites were also observed green back to back.

Then open **http://localhost:9100/top-offers/**. Do not hand anyone that URL until you have curled it.

**`wrangler dev` snapshots its static-asset manifest at startup**, so any file added under `public/` 404s until
the worker is restarted. This cost an hour once.

## Local-only state that is NOT in git and must be reapplied

`.dev.vars` is gitignored and carries four things this demo needs. If it is ever lost, restore all four:

| Key | Why |
|---|---|
| `TENANTS` | must include `"shn"` in `provisioned`, and `operatorGrants` mapping the jwt `sub` (`seed-shn`, `operator`) to `["shn"]` |
| `SDK_KEYS` | needs a per-tenant entry `shn:demo-site` — a `*:key` wildcard entry alone grants no tenant |
| `JWT_SECRET` | a throwaway local value; without it the worker has no signing material and every operator write 401s |
| `RETENTION` | a policy per tenant for all seven categories; without it the engine **refuses to admit a single behavioural event**, which is the correct refusal and looks like a 500 |

**No merchandiser token exists any more, anywhere.** The page names a beat and the worker applies it
(`src/routes/topOffers.ts`): it is mounted only where `DEPLOYMENT_PROFILE` is `demo`, accepts a closed set of
beat names and no document, and mints a genuine 60-second operator token to re-enter `/content` through the
ordinary pipeline rather than fabricating authority. The page suite asserts the old token file is not served,
that the page source carries no bearer token, and that the page makes no `/content` or `/config` call of its own.

The page sends `X-Tenant: shn` on its own API calls. It must: with no header the app-level tenant middleware
falls back to the default tenant, which is not provisioned on the deployed worker, and every beat returns
"Tenant unavailable".

## State at the pause

- All 15 beats pass both suites; `npm run typecheck` clean.
- The world is reset to the opening state.

## Beat 11 failed once. It was not a ranking problem.

On 2026-09-23 beat 11 (snow in Washington) failed **once in six** DOM runs. Two wrong explanations were
published before the right one; both are recorded because each was believed on the strength of a measurement.

**Wrong answer 1 — "an exact tie".** A diagnostic probe measured `SHN-KIT-90` and `SHN-KIT-03` at an identical
0.33 and concluded the category cap was breaking a tie arbitrarily. The probe was at fault: it sent page views
carrying a **category but no subcategory**, so `Cookware & Dutch Ovens` never rose and the winter promotion lost
the edge it actually has. A probe must replay the page's events exactly, or it is measuring a different demo.

**What the real journey produces**, stable across runs, at beat 11 with the pin and the 0.25 weight live:

```
SHN-BEA-01  0       (pinned, container 1)
SHN-KIT-90  0.558   Snow Day Comfort Cooking   ← leads the ranked field by 34%
SHN-KIT-01  0.415
SHN-HOM-01  0.301
```

The vector behind it: `Kitchen & Table 0.6897`, `Cookware & Dutch Ovens 0.625`. Both clear the 0.60 entry
threshold, so the winter piece wins on the subcategory the visitor genuinely browsed — they opened a Dutch oven,
and it is the Dutch-oven promotion. **There is no tie and nothing to tune.**

**The actual cause.** Beat 11's snapshot request transiently did not answer. `refresh()`
(`public/top-offers/top-offers.js`) returns early when the decision service fails, deliberately leaving the
previous four on screen rather than inventing a module. The failing log shows exactly that signature: beat 11
rendered **beat 10's four cards and beat 10's delta lines, verbatim**. The page behaved correctly; one request
in roughly ninety did not.

`rehearse-top-offers-dom.mjs` now asserts, after every press, that the engine-down banner is hidden. A
recurrence reports itself as *"beat N: the decision service answered — ✗"* instead of impersonating a ranking
bug.

## One unexplained observation

A single snapshot returned **zero decisions** right after a catalog+slots publish. It did not reproduce in 42
further snapshots across four probes: warm visitor after a publish (12/12 fine), cold visitor minting a fresh
session (10/10 fine), and catalog/slots published back to back with a snapshot in each gap (24/24 fine). It may
well be the same transient as beat 11. Recorded because an empty module is the exact symptom of "showing the
site's own defaults", not because a cause is known.

## Engine changes in this work (in `src/`, committed)

1. **`eligibleWhen` on a content piece** — `{ regions?, context? }`, evaluated in `isEligibleAt` beside the window
   and the stock flag, **before scoring**, and it **fails closed**: a condition the request does not carry is not
   satisfied. This is Garrett's "snowing in the Pacific Northwest" ask. Request signals arrive as `?ctx.<name>=value`
   on the snapshot, bounded to 8 signals. An asserted `region` beats the edge's own, deliberately — a server-side
   caller knows the customer's region better than the connection does.
2. **The offer envelope is now opt-in** (`src/routes/decisions.ts`). It used to be sent on every snapshot. It only
   does anything when the caller supplies a `pageInstance`, but sending it suppressed `served-v1` ledger capture for
   every caller who never opted into rendered measurement — so their decisions were never written and a day report
   counted **zero exposures against real outcomes**. Before: `decisions 0, outcomes 23`. After: `decisions 20,
   outcomes 30, visitors 5`. **This is a general defect fix, not a demo workaround.**
3. **`src/routes/demoBootstrap.ts`** — `POST /ops/demo-bootstrap`. A demo scope has no configuration publication set,
   and there is deliberately no HTTP endpoint that creates one (`docs/kit/02-api-reference.md:530`; safe provisioning
   is remediation item W08). This creates one **once**, for a demo tenant, and can never overwrite: it is not mounted
   on the customer profile, refuses outside `ENVIRONMENT=development`, requires the same operator grant as any
   configuration write, validates every baseline first, and returns 409 on a scope that already has a head.

## The fifteen beats

1–5 the visitor: arrives (QVC's four defined promotions, held), browses kitchen, opens a Dutch oven, looks at home
and beauty (**five pages — the defaults release**), opens a second kitchen item (cook clears 0.60).
6–10 the merchandiser: the clock passes a window, a new promotion arrives with no clicks, Final Hours creative on the
same content id, the promotion weight at 0.25, then a pin.
11–12 the rule: snow in Washington surfaces a promotion that has been in the pool since beat one; the same visitor in
Florida does not see it.
13–14 Garrett's page questions: the module moves to position 1 and **nothing about the four changes**; `take: 2`
renders two containers of the same ranking.
15 the report: two clicks, then the day report per promotion.

## Numbers that were MEASURED and must be re-measured if the pool changes

- The promotion weight is **0.25** because the field at that beat is 0.4440 / 0.3840 / **0.3300** (the pick). It lifts
  the pick to second and not to first. The slot's 1.6× clamp would allow 0.5280, which is **above** first place — so
  do not claim the clamp is what holds it back in this field. The chosen weight is.
- Cook reaches **0.69** (`4 / (4 + 1.8)`) by beat 5, not 0.63 — opening a product is a second touch on the department.

## What is still open

| | |
|---|---|
| `personalizeAfter` on the slot | **designed**. The page enforces Jamie's five-page rule today and says so on every receipt. |
| Two-horizon memory | **designed**. Kevin's "beauty over time vs electronics right now". |
| Separate content pools per campaign | not started (Garrett's email) |
| The two signal examples | not started — a data-layer signal on page load, and add-to-wishlist |
| A journey that follows off the homepage | not started |
| Overnight upload of 100,000 customers with a coupon | not started |
| Server-side integration (`src/sdk/server.ts`) | Dustin asked for it by name and we said yes. Not shown in the demo. |

## Hard-won rules for whoever continues

- **Never hand over a page you have not run.** Two hand-offs passed a request-level test and still failed in the
  browser, because both bugs were in the page's own JavaScript. `rehearse-top-offers-dom.mjs` loads the real script
  and presses the real buttons for that reason.
- **Measure, then claim.** Three separate copy claims turned out false against the real field and had to be rewritten.
  If a beat asserts a position or a number, assert it in the harness too.
- **A beat that changes nothing visible is a broken beat.** The harness fails any press that neither moves the module
  nor says why it did not.
- **This checkout is shared with another session.** Stage only your own files; never `git add -A`.
