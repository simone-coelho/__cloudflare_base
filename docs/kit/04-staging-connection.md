# Connecting Your Staging Origins

"Connected and verified" means one thing: a page on your staging origin, inside your network, can get
a decision, send an event and hold the live channel against the platform's staging host, with
credentials the platform checks, and both sides have seen the check pass.

## The staging platform

The platform's staging host is `https://edge-platform-staging.expedge.workers.dev`. It runs with the site key enforced and the operator token required for configuration, on its own stores, with the Coach content catalog and slot document seeded. The learning console is at `/learning.html?scope=coach` and the tuning page at `/tuning.html?scope=coach` on that host; an operator presses Sign in on the console and signs in with their email and password; the session renews itself while the tab is open. Your admin creates the accounts in the console's Accounts section and hands each person a temporary password, which they replace at their first sign-in. (`POST /auth/login` is the route behind it, for an integration that needs a token of its own.)

## What we need from you

| Item | Example | Why |
|---|---|---|
| The origins your pages call from | `https://staging.coach.com`, `https://stg-preview.coach.com` | We allow-list them; unregistered origins receive no cross-origin permission |
| The hostnames the platform should recognise per brand | `staging.coach.com → coach` | Event routes carry no brand in the path; the platform derives it from the registered hostname |
| A person on your side who can run the check | | The network path is verified from where your pages run, not only from ours |
| Optional: the brand's identity secret | a random 32-byte value you generate | Only if you want sign-ins verified from day one; without it, links are recorded as site-assured |

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
| Health | `GET /health` answers 200 |
| Cross-origin permission | A preflight from your origin is answered with your origin allowed and credentials permitted |
| A decision | `GET /v1/{tenant}/decisions/snapshot` with the site key answers 200 and a decision set |
| The site key is enforced | The same call without a key answers 401 |
| An event | `POST /realtime/action` from your origin with the site key answers 200, `success: true` |
| The live channel | The socket upgrade with the key in the query is accepted |
| A wrong key is refused | A call with a key for another brand answers 403 |

## After the check

Your engineers integrate from the [guide](./01-integration-guide.md) inside your environments through
the freeze window. We support with fixes and tuning sessions. The scripted acceptance run in your lower
environment is M4; it uses the same requests as this check, extended to the loop. It exists as
`scripts/acceptance-run.mjs` and runs against any stamp with an operator token:

```
node scripts/acceptance-run.mjs --base https://<stamp> --token <operator jwt> --sdk-key <site key>
```

The walk a person does, driven in a real browser on staging on 2026-09-05 before it was written down:

1. Open `/storefront?sdk=1`. Press "Start ►" at the top of the right-hand panel, then "Next ►" three times. The home view shows the hero the engine decided, "The Tabby Shop".
2. Press the hero's button, "Shop the Tabby". The product list opens.
3. Press the first product. Press "Add to Bag". The bag opens.
4. Press "Checkout". The bag shows the items and the total. Press "Place order". The bag reads "Order placed" with the order number and the total.
5. Open `/learning.html?scope=coach`. Press "Sign in" at the top right and sign in with the email and password we issued. The bar reads "Signed in as" and your name.
6. In the "Slot" dropdown choose "chero · home": the hero's row shows the press as a success. Choose "story · home": the line above the grid reads "reward purchase weighed by revenue", and the row of the story that featured the bag you bought shows the order's value as its success. If a row has not moved yet, wait a minute and reload.

The engineering check behind the same loop is `scripts/acceptance-run.mjs`, which runs against any stamp
with an operator token and is what CI would run:

It seeds an acceptance page on the scope (rolled forward to what it was at the end), walks one shopper
through a decision, two product views, a click and a purchase, and asserts 55 exact facts on the way:
the receipt's stage, freshness, fatigue and diversity terms, the out-of-stock gate, the ring, the credit
weighed by revenue on the story that featured the bag, the day report, an erasure honoured at once, and a
shopper who withheld consent getting the defaults with nothing written. It stops on the first failure
and prints the transcript, which is the acceptance evidence.
