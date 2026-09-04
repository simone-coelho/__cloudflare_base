# Connecting Your Staging Origins

"Connected and verified" means one thing: a page on your staging origin, inside your network, can get
a decision, send an event and hold the live channel against the platform's staging host, with
credentials the platform checks, and both sides have seen the check pass.

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
environment is M4; it uses the same requests as this check, extended to the loop: a decision, a click on
it, and the credit showing in the learning console.
