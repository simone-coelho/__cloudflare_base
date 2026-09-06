# 32 · CW35: the latency numbers, measured on staging

Internal. 2026-09-05, against `edge-platform-staging.expedge.workers.dev` with `scripts/latency.mjs`,
from one machine in this repo's development environment. Forty calls per row after five thrown away.
BTIE D12 asked for P50 and P99 on the three routes a shopper's page waits on. No number in this repo is
quoted to Tapestry before it has come out of this script.

## 1 · The numbers

Two rows per route, always. A shopper the platform has never seen pays for her session being created;
the same shopper a minute later reads from cache. They differ by more than an order of magnitude, so one
number for "the snapshot" is not an answer.

| Route | Shopper | P50 | P95 | P99 | inside the worker, P50 | P99 |
|---|---|---|---|---|---|---|
| `GET /v1/:tenant/decisions/snapshot` | never seen | 627.5 ms | 716.2 ms | 740.2 ms | 591 ms | 708 ms |
| | seen before | 35.2 ms | 44.6 ms | 365.1 ms | 5 ms | 29 ms |
| `POST /realtime/action` | never seen | 1,896.1 ms | 2,172.6 ms | 2,305 ms | 1,817 ms | 2,251 ms |
| | seen before | 641.3 ms | 754 ms | 776.8 ms | 547 ms | 675 ms |
| `POST /sort` | never seen | 616.3 ms | 712.4 ms | 723.1 ms | 583 ms | 692 ms |
| | seen before | 35.4 ms | 42.9 ms | 48.5 ms | 5 ms | 8 ms |

P50/P95/P99 are wall clock at the caller, network included. "Inside the worker" is the route's own
`Server-Timing`. The gap between the two columns is the path to the edge from where this ran and belongs
to no one's engine, so the pair is quoted together or not at all.

## 2 · Where the time goes, and what is ours

The snapshot's own stages, at the median, for a shopper it has never seen:

```
documents 0 ms · shopper 591 ms · trend 0 ms · lift 0 ms · decide 0 ms
```

and for the same shopper again:

```
documents 0 ms · shopper 5 ms · trend 0 ms · lift 0 ms · decide 0 ms
```

Every stage that is the content engine's own work rounds to zero at this resolution. `decide`, which is
the affinity arithmetic, the slot rules, the holdout and the learned lift together, is 0 ms in both
populations. The cost is `shopper`: on the session host that stage creates or updates the session in KV
on the request path, and a KV write costs half a second or more from a Worker.

This is the same conclusion the load test reached from a different method on the same day, and the
numbers agree closely enough to be worth stating: doc 31 measured a decision for a new visitor at
632 ms P50 with `shopper 637 ms`; this run measured 627.5 ms with `shopper 591 ms`. Two independent
measurements, one under sustained load and one not, landing within 7 %.

**One thing this run adds.** `POST /sort` pays the same session-creation cost for a shopper it has never
seen: 583 ms inside the worker, against 5 ms for a returning one. Doc 31 did not measure sort. It is the
same cause, so it will be fixed by the same change, but it should not be a surprise when it is.

## 3 · What may be said to Tapestry today

- **The engine's own decision cost is not measurable at this resolution.** `decide` is 0 ms. Whatever a
  pilot's latency turns out to be, the affinity arithmetic and the slot rules are not the reason.
- **A returning shopper gets a decision in about 35 ms end to end**, 5 ms of it inside the platform.
- **A shopper's first request in a session costs about 600 ms**, almost all of it one KV write, and that
  is a platform-shape problem with a known fix, not an engine problem.
- **No pilot target is met yet on the first request.** The target stated in doc 31 is a decision under
  200 ms at P95 on the server and an event under 300 ms. The returning-shopper rows clear it comfortably;
  the never-seen rows do not.

Nothing above is an estimate. Every figure is a request that happened, at a nearest-rank percentile with
no interpolation.

## 4 · What would move it

Not decided here, and not mine to decide alone; recorded so the options are on paper next to the numbers.

1. **Take the session write off the request path.** The write exists to persist a session that the
   response does not depend on. Deferred behind `waitUntil`, the never-seen row should fall to roughly
   the returning row plus the cost of a read.
2. **The shopper object host.** Doc 31 measured it at 192 ms P50 for a decision, three times faster,
   and it is held back by its ingest refusing the content events, not by its speed. `REFLEX_HOST` in
   `[env.staging.vars]` says exactly this and says session until the object host passes its acceptance run.

## 5 · What changed, and what it measured (CW37, the same evening)

Item 1 of §4 is done. The two writes that create a session went together instead of one after the
other, and on the decision path they left the response entirely, into the `waitUntil` the snapshot
route already had. Measured the same way, on staging, before and after:

| Route, a shopper it has never seen | Before | After |
|---|---|---|
| snapshot, P50 wall | 627.5 ms | 285.3 ms |
| snapshot, inside the worker | 591 ms | 235 ms |
| sort, P50 wall | 616.3 ms | 464.4 ms |
| action, P50 wall | 1,896.1 ms | 1,731 ms |

The returning-shopper rows did not move, which is right: they were never paying for a write.

**What is left in the 235 ms.** Three KV reads that all miss for a shopper nobody has seen: the
session by its cookie, the session by her visitor id, and her profile. They run one after another
because each only runs when the one before it missed, which is the right shape for a returning
shopper and the wrong one for a new shopper, where all three always miss.

**Something this measurement found that is not about speed.** Two snapshot requests back to back for
one new visitor create TWO sessions: the second request cannot see the first, because a KV write is
not readable that quickly. Five out of five, measured by reading `sessionCount` out of staging's own
store. It is NOT caused by deferring the write: the same probe against the previous build, deployed
back to staging to check, splits five out of five as well. Awaiting the write never fixed it, which
is why it was invisible.

**Closed the same evening (CW39), and measured closed: five out of five now land on one session,
where five out of five split before.** The fix needed no new API and no cookie. The SDK already sends
its browsing session on the snapshot, and the decision record and the outcome already prefer it;
nothing used it to find or name the session, so each request invented one. It is used now when the
browser's cookie says nothing, which on the decision route is always.

One note on how it was measured, because the first attempt got it wrong: the probe ran five seconds
after the deploy and read the OLD code, reporting one success in five. Re-run after the deploy had
propagated, it is five in five. A deploy is not live the instant wrangler prints a version id.

What follows was the position before that fix, kept because it is why the fix was chosen.

It mattered little even then. The SDK sends its own browsing session id on the
snapshot and on every event, and both the decision record and the outcome prefer it, so an
integrated client's attribution does not depend on the server's session at all (doc 22 §4.1). A
caller that sends none gets a duplicated session record and a visit counted twice. Of the three ways to close it, the one taken
needed no change a customer would see: use the session the client already sends. The other two were
rejected -- setting a cookie on a decision response changes what the API does, and keying the session
by the visitor id would make a session id derivable from an id that travels in query strings, and
session ids are bearer tokens in a cookie today.

## 6 · Reproducing it

```
node scripts/latency.mjs https://edge-platform-staging.expedge.workers.dev --tenant coach --n 40 --key <site key>
```

`/sort` is not behind the site-key gate, so a run with no credential still reports that route rather
than nothing. `--token <operator JWT>` works in place of `--key`, because an operator token passes the
same gate (CW22).

## 7 · One thing to fix that is not a latency number

Staging accepts `demo-site` as its site key: the example value printed in this repo's own deploy
instructions (`wrangler.toml`, `scripts/deploy.sh`). It was tried on the assumption that it would be
refused, and it was not. Anyone who can read this repository can therefore call staging's shopper-facing
routes. Staging holds no customer data and this is not the production host, so it is not an incident,
but it should be a value nobody can read, before any Tapestry person is given the host. The fix is one
command from whoever holds account access, and the key is not in this repo afterwards:

```
printf 'coach:<a generated value>' | npx wrangler secret put SDK_KEYS --env staging
```

Production was checked at the same time and does not have this problem: `edge-platform-production.expedge.workers.dev`
refuses that key and refuses a request with no key. Staging only.
