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

## 5 · Reproducing it

```
node scripts/latency.mjs https://edge-platform-staging.expedge.workers.dev --tenant coach --n 40 --key <site key>
```

`/sort` is not behind the site-key gate, so a run with no credential still reports that route rather
than nothing. `--token <operator JWT>` works in place of `--key`, because an operator token passes the
same gate (CW22).

## 6 · One thing to fix that is not a latency number

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
