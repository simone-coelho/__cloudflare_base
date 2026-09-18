# Connecting Your Staging Origins

## Current engineering prerequisites and result limits

Only run these scripts on an explicitly authorized staging target. `verify-origin.sh` uses a fresh signed anonymous session and explicit tracking/personalization refusal, current shopper routes, site-key enforcement and a signed socket handshake. PASS means connectivity, not personalized/provider/customer acceptance.

`acceptance-run.mjs` requires an initialized coherent content/slots/learning set, actual recovery/retention/queue prerequisites and a current granted human operator session. It creates run-unique fixtures, uses whole-set CAS/idempotency and reconciles lost/partial publication acknowledgements. Cleanup removes only unchanged run-owned fixtures; pre-existing `acc-*` content and concurrent unrelated publications survive. Unresolved cleanup is failed/incomplete, never a successful engineering result. Preserve an unresolved operation identity for readback; do not silently remint it.

The current kit uses coalesced refresh, read-only offers and an explicit original rendered ACK; the CLI simulates that renderer signal and reads private receipts through operator authority. It does not paint a browser. Conditional same-grant server-first-paint adoption is described in the guide. Configurable preprovisioned OIDC is locally implemented and disabled until explicitly configured; real issuer/account/membership/security activation and SSO acceptance remain open.

Separate customer-observable SOW demonstration, measured engineering reliability/latency/authority proof, and scientific/business impact evidence. A script does not automatically satisfy M4. Monetary weighted credits are not conversion probabilities; confirm unit/revenue/margin meanings before measurement claims. Live browser/SFCC/provider/warehouse verification and customer sign-off remain separately scheduled.

"Connected and verified" means one thing: a page on your staging origin, inside your network, can get
a decision, send an event and hold the live channel against the platform's staging host, with
credentials the platform checks, and both sides have seen the check pass.

## The staging platform

Historical staging observation (not a W14/W15 deployment or customer attestation): the recorded host was `https://edge-platform-staging.expedge.workers.dev`. It was reported to run with the site key enforced and the operator token required for configuration, on its own stores, with the Coach content catalog and slot document seeded. The learning console is at `/learning.html?scope=coach` and the tuning page at `/tuning.html?scope=coach` on that host; an operator presses Sign in on the console and signs in with their email and password; the session renews itself while the tab is open. Your admin creates the accounts in the console's Accounts section and hands each person a temporary password, which they replace at their first sign-in. (`POST /auth/login` is the route behind it, for an integration that needs a token of its own.)

## What we need from you

| Item | Example | Why |
|---|---|---|
| The origins your pages call from | `https://staging.coach.com`, `https://stg-preview.coach.com` | We allow-list them; unregistered origins receive no cross-origin permission |
| The hostnames the platform should recognise per brand | `staging.coach.com → coach` | Event routes carry no brand in the path; the platform derives it from the registered hostname |
| A person on your side who can run the check | | The network path is verified from where your pages run, not only from ours |
| Backend identity-signing configuration | separately approved protected material and signer | Required for verified account linking; unsigned/site-assured customer linking is refused. No secret exchange/rotation is authorized by these local docs |

## What we set up

- The staging platform on its own resources, provisioned once by a person with account access, with authenticated access on: site keys enforced on the shopper-facing routes, operator tokens on configuration.
- One site key per brand, minted by us or by you, registered on the platform.
- Your origins in the cross-origin allow-list, your hostnames in the brand map.
- The brand's content catalog and slot document seeded from your feed, or from the demo catalog until your feed is connected, so the first decision has something to choose from.
- A learning console and a tuning page reachable with an operator token we issue to named people.

## The check

`scripts/verify-origin.sh` runs the same requests a page makes, in order, and prints PASS or FAIL for
each. Run it from inside your network against the platform's staging host with your origin and your
site key. We run it from ours. Both prints go into the M3 record.

```
bash scripts/verify-origin.sh https://<platform-staging-host> https://staging.coach.com <site key> coach
```

| Line | What passes |
|---|---|
| Signing readiness | `GET /health/ready` answers 200; signing configuration only, not store/schema/queue readiness |
| Cross-origin permission | A preflight from your origin is answered with your origin allowed and credentials permitted |
| A decision | Signed `POST /v1/{tenant}/decisions/snapshot` after explicit refusal answers default decisions with `write:false`; no subject/session URL selectors |
| The site key is enforced | The same call without a key answers 401 |
| An event | Signed `POST /realtime/action` under explicit refusal answers200 without authorizing behavioral capture |
| The live channel | Browser-compatible `shopper-session-v1`, capability and `sdk-key-v1.<base64url-key>` subprotocol upgrade is accepted; no credential or subject/session query |
| A wrong key is refused | A call with a key for another brand answers 403 |

## Production

Historical production record only, not current W14/W15 verification: `https://edge-platform-production.expedge.workers.dev` was reported provisioned on2026-09-05 with separate stores and no screenshot route. Deployment was described as
`bash scripts/deploy.sh production`. Two things are issued to a customer at kickoff and stored nowhere
readable afterwards: the site key their site sends as `X-SDK-Key`, and the first admin's password, which
that admin replaces at the first sign-in and then uses the console's Accounts section to bring in the
rest of their people. The site's origins go into the allow-list and the tenant map at the same time; until
then the host answers only same-origin callers and the SDK with the key.

## After the check

Your engineers integrate from the [guide](./01-integration-guide.md) inside your environments through
the freeze window. We support with fixes and tuning sessions. The scripted acceptance run in your lower
environment supplies an engineering transcript toward M4; M4 still requires the agreed customer demonstration and sign-off. The script extends this protocol check to the loop and exists as
`scripts/acceptance-run.mjs` and requires an initialized staging publication set, actual recovery/retention/queue prerequisites and a current granted human operator token:

```
node scripts/acceptance-run.mjs --base https://<stamp> --token <operator jwt> --sdk-key <site key>
```

Historical walkthrough recorded for2026-09-05, not current W14/W15/browser/SSO acceptance:

1. Open `/storefront?sdk=1`. Press "Start ►" at the top of the right-hand panel, then "Next ►" three times. The home view shows the hero the engine decided, "The Tabby Shop".
2. Press the hero's button, "Shop the Tabby". The product list opens.
3. Press the first product. Press "Add to Bag". The bag opens.
4. Press "Checkout". The bag shows the items and the total. Press "Place order". The bag reads "Order placed" with the order number and the total.
5. Open `/learning.html?scope=coach`. Press "Sign in" at the top right and sign in with the email and password we issued. The bar reads "Signed in as" and your name.
6. In the "Slot" dropdown choose "chero · home": the hero's row shows the press as a success. Choose "story · home": the line above the grid reads "reward purchase weighed by revenue", and the row of the story that featured the bag you bought shows the order's value as its success. If a row has not moved yet, wait a minute and reload.

The engineering check behind the same loop is `scripts/acceptance-run.mjs`, which requires an explicitly authorized staging target with the documented prerequisites
with an operator token. It is not run automatically by local CI or authorized against an arbitrary customer stamp:

It adds uniquely run-owned fixtures, then removes only their unchanged normalized content from the current publication, preserving pre-existing acc-* content and concurrent legitimate changes. Lost publication ACKs are reconciled under the same identity; unresolved cleanup fails the engineering result. It walks one shopper through read-only offers, explicit synthetic rendered acknowledgements, product views, a correlated click and a purchase and checks:
the receipt's stage, freshness, fatigue and diversity terms, the out-of-stock gate, the ring, the credit
weighed by revenue on the story that featured the bag, the day report, an erasure honoured at once, and a
shopper who withheld consent getting the defaults with nothing written. It stops on the first failure
and prints an engineering transcript. It does not establish M4 customer acceptance, production performance, physical tenant-wide erasure or provider/history deletion.
