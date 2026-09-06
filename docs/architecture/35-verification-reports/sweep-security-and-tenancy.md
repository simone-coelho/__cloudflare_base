# Independent sweep — security and tenancy

**Scope:** authentication, authorization, tenant and brand isolation, secrets, keys, tokens, injection,
the demo surfaces, the WebSocket and agent routes, CORS, rate limiting.

**Checkout:** `/mnt/c/Users/LAH/Documents/__Development/Optimizely/__cloudflare_base`, branch
`feature/real-time-personalization`, working tree as found (another engineer's uncommitted work left
untouched). Read-only throughout: no edit to a tracked file, no state-changing git command, no deploy,
no `wrangler dev`, no call to any `*.workers.dev` host or any other network service.

**Out of scope by instruction:** everything named in `docs/architecture/33-adversarial-audit-brief.md`
and in `docs/architecture/34-independent-adversarial-audit.md` (F01–F35). Both were read in full first.
Where a finding below sits next to one of theirs, the last line of each entry says exactly what is new.

**Reproductions:** three harnesses under `/tmp/audit-verify/sweep-security-and-tenancy/`, run from the
repository root with `npx tsx`. They import the repository's own modules (`@/routes/api`,
`@/routes/content`, `@/routes/config`, `@/routes/auth`, `@/middleware/auth`, `@/middleware/edgeAccess`,
`@/tenancy/*`, `@/auth/*`) with stubbed bindings — no deployed store was touched.

| File | What it drives |
|---|---|
| `probe.ts` (+ `harness.ts`) | A · cross-brand configuration read · B · operator lockout and enumeration · C · signing-key handling |
| `probe-api.ts` | D · the generic `/api/*` store routes |
| `probe-config.ts` | E · `/config` scope authorization |

Severity uses the brief's four labels. Sizes follow doc 34's convention: S ≈ 1–3 engineer-days,
M ≈ 1–2 engineer-weeks, L ≈ multiple weeks.

---

## S1 · `/api/*` is a generic, cross-tenant read/write/delete door onto every store, behind any operator token

**Severity: blocks launch. Size: S.**

### Evidence

`src/routes/api.ts` is mounted at `src/index.ts:93` on every stamp, dev, staging and production. Its only
guard is `api.use('/*', jwt())` at line 7 — *an* authenticated token, no role, no permission, no tenant.
Behind it:

| Route | Line | What it reaches |
|---|---|---|
| `GET/PUT/DELETE /api/storage/:key` | 9, 28, 51 | the R2 ledger bucket (`STORAGE`), by arbitrary key |
| `GET/PUT/DELETE /api/cache/:key` | 63, 79, 99 | the `CACHE` KV namespace, raw, by arbitrary key |
| `POST /api/queue/send` | 111 | `EVENT_QUEUE.send(body)` with the caller's body, unvalidated |
| `GET/PUT /api/state/state/:key` | 124, 151 | the `StateManager` Durable Object, by arbitrary name |

None of these calls `TenantKV`, `tenantKey` or `assertLogicalKey`. The key is `c.req.param('key')`,
which Hono URL-decodes, so `%2F` restores the slashes in real ledger object names.

`git log -- src/routes/api.ts` shows one commit: `8092024 Initial commit`. Nothing in `public/`,
`public/console/`, `src/sdk/`, `scripts/` or `docs/kit/` calls any of these paths. It is unused
scaffolding that is nevertheless live.

### Reproduction (`probe-api.ts`, actual modules, fake KV/R2/queue)

The caller is the weakest operator the account model can issue: `roles:['operator']`,
`permissions:['read']`, issued for no particular brand.

```
D0 · the physical key the platform used   : t:kate-spade:content:config:catalog:current
D1 · GET  /api/cache/<other brand key>    : 200 {"key":"t:kate-spade:content:config:catalog:current",
                                             "value":{"revision":4,"value":{"pieces":[{"id":"ks-secret",
                                             "title":"UNANNOUNCED"}]}}}
D2 · PUT  /api/cache/<other brand key>    : 200 stored now = {...{"id":"defaced","title":"DEFACED"}...}
D3 · DEL  /api/cache/<other brand key>    : 200 key still present = false
D4 · GET  /api/storage/<ledger object>    : 200 {"decision_id":"d1"}
D5 · DEL  /api/storage/<ledger object>    : 200 object still present = false
D6 · POST /api/queue/send                 : 200 queued = [{"kind":"ledger","tenant":"kate-spade",
                                             "stream":"decisions","records":[{"decision_id":"forged",...}]}]
D7 · same call with no token              : 401
```

The ledger key used is the shape `src/ledger/writer.ts` produces:
`coach/2026-09-06/13/decisions/000001-000100.ndjson`, percent-encoded into the single path segment.

### Consequence

Every isolation guarantee the platform makes is bypassable from one route file:

- **Brand isolation.** `src/tenancy/tenant.ts` exists to stop a caller addressing `t:{brand}:…`
  directly — `assertLogicalKey` is documented as "the layer that cannot be forgotten". `/api/cache/:key`
  forgets it. A Coach operator reads, rewrites and deletes Kate Spade's catalogue, slots, learning
  document, lift snapshots, sessions and profiles.
- **Ledger immutability.** Doc 22 §3 and brief §5.6 rest on "immutable, cheap, replayable". `DELETE
  /api/storage/:key` erases a decision hour; `PUT` rewrites one. The customer's data scientists are
  promised they can recompute every number from the ledger; nothing detects that the ledger changed.
- **Learning integrity.** `POST /api/queue/send` puts a caller-authored `{kind:'ledger'}` message into
  the same queue `src/index.ts:258` drains into R2, for any tenant named in the body.
- **The role model.** `jwt()` with no options checks no role, so the read-only account doc 30 describes
  (`permissions:['read']`) has full destructive authority. Combined with S2 on the default environment,
  no account is needed at all.

Blast radius is every tenant on the stamp, from one token, in one request.

### Remedy

Delete the mount (`src/index.ts:93`) and the file; nothing calls it. If a support tool genuinely needs
store access, replace it with typed, tenant-scoped, role-checked operations that go through `TenantKV`
and never accept a raw key. Add a test that asserts the mounted route table against an allow-list, so a
route can never again be live without an owner.

### Why this is not in 33 or 34

Neither document cites `src/routes/api.ts`, and neither mentions `/api/storage`, `/api/cache`,
`/api/queue/send` or `/api/state`. Doc 34's F03 examined tenancy at ingress and explicitly *credits* the
opposite: "Correct KV prefixes and namespace-escape rejection do not fix these ingress authorization
defects" — this is a route that defeats the prefixes themselves. Brief §4's component table lists KV, R2
and Queues but no route that exposes them generically.

---

## S2 · The enforced default environment signs tokens with a secret published in the repository, and verification fails open when the secret is absent

**Severity: blocks launch. Size: S.**

### Evidence

`wrangler.toml` `[vars]`, the block that governs the default (unnamed) environment:

```
151  AUTH_MODE = "enforced"
159  JWT_SECRET = "development-secret-key-change-in-production"
160  JWT_ISSUER = "edge-platform"
161  JWT_AUDIENCE = "edge-platform-api"
```

All three claims a token must satisfy — secret, issuer, audience — are in the tracked file, under a
comment that reads "use wrangler secret for sensitive values".

`package.json` `"deploy": "… && wrangler deploy"` — no `--env`, so it ships this environment.
`scripts/deploy.sh:41-58` is the same path; its guard checks only that an `SDK_KEYS` secret exists
(`:48-56`). Nothing checks `JWT_SECRET`.

Second, independent defect: `src/middleware/auth.ts:49` builds the key as
`new TextEncoder().encode(c.env.JWT_SECRET)`, and `src/routes/auth.ts:38`/`:44` do the same when minting.
`TextEncoder.encode(undefined)` returns **zero bytes**, and `jose` signs and verifies HS256 with a
zero-length key without complaint. A stamp whose `JWT_SECRET` secret is missing, mistyped or lost
therefore authenticates everyone, silently — and `scripts/provision-stamp.sh` swallows resource errors
broadly (doc 34 F09 notes lines 23–40), so a half-provisioned stamp is a realistic way to arrive there.

### Reproduction (`probe.ts`, section C — the real `jwt()` middleware and the real `sdkKey()` gate)

```
C1 · no JWT_SECRET on the stamp → admin route answers 200 {"ok":true,"who":"anyone"}
C2 · committed placeholder → admin route answers 200 {"ok":true,"who":"attacker"}
C3 · forged Bearer passes sdkKey() for a tenant it holds no key for → 200
```

C1 mints `{roles:['admin'],permissions:['*']}` with the empty key against an env with no `JWT_SECRET`
and clears `jwt({required:true, roles:['admin']})`.
C2 does the same with the committed placeholder, issuer `edge-platform`, audience `edge-platform-api`.
C3 shows the same forged token clearing `sdkKey()` for `kate-spade` on a stamp whose `SDK_KEYS` holds
only `coach:coach-only-key` — because `src/middleware/edgeAccess.ts:119-121` accepts any well-formed
`Authorization: Bearer …` in place of a site key, for any tenant.

### Consequence

On any stamp deployed from the default environment — the shared demo worker the team presents from, per
the `[vars]` comment at `wrangler.toml:144-150` and `scripts/deploy.sh:42-47` — anyone who has seen this
repository, or guesses a common placeholder, mints an admin token and gets:

- `/auth/users` (create accounts and receive their temporary passwords), `/auth/users/:id/reset`,
  `/auth/audit` — persistent legitimate access, and the audit trail;
- every `jwt`-guarded operator route in `src/routes/decisions.ts` — per-shopper receipts (`:223`),
  ledger objects by id (`:416`), replay (`:434`), erasures (`:388`), learning publish (`:513`);
- `/config` and `/content` writes, `/operator/*` writes, `/v1/:tenant/*` and `/realtime/*` for **every**
  tenant (C3), and — with S1 — every store on the stamp;
- the "enforced" gate that doc 34's F01–F03 probes assume is the security boundary is decorative there.

The same forgery works on any stamp, of any environment, whose `JWT_SECRET` secret is absent. Nothing
in `src/ops/monitor.ts` or `/health` would report it.

Brief §4 states "Secrets live only on the worker: the JWT secret, the identity salt, the site keys per
tenant, the alert webhook." That is not true of the default environment.

### Remedy

1. Remove `JWT_SECRET` from `[vars]`; set it with `wrangler secret put` for the default environment as
   for the others, and confirm with `wrangler deploy --dry-run` which binding wins if both exist.
2. Fail closed: refuse to mint or verify when `env.JWT_SECRET` is absent, shorter than 32 bytes, or
   equal to a known placeholder — a 503 with a named cause, not a silent empty key.
3. Extend `scripts/deploy.sh`'s guard to the JWT secret for all three branches, and add the same
   assertion to the five-minute self-monitor so a lost secret pages someone.
4. Rotate the demo stamp's secret and any operator password issued on it.

### Why this is not in 33 or 34

`JWT_SECRET` and `development-secret` appear zero times in either document. Doc 34's baseline table
row 9 records the *earlier* audit's "committed JWT dev placeholder" item and dispositions it as
"secret-binding/provisioning approach now exists" — it does not state that the placeholder is still in
`[vars]`, that the same `[vars]` block now sets `AUTH_MODE = "enforced"`, that `npm run deploy` ships
it, that verification fails open with no secret at all, or that such a token also clears the site-key
gate for every tenant.

---

## S3 · Every brand's catalogue, configuration, learning dials and revision history are world-readable via `?scope=`

**Severity: blocks launch. Size: S.**

### Evidence

`src/routes/content.ts:42`:

```ts
function scopeOf(c) {
  const raw = (c.req.query('scope') ?? '').trim();
  return /^[a-z0-9][a-z0-9:_-]{0,63}$/i.test(raw) ? raw : 'default';
}
```

The scope — the tenancy of these documents — is a free query parameter. It is never compared with
`c.get('tenant')`, never checked against `tenantConfig(env).provisioned`, and never bound to a key or a
token. `src/config/versionedStore.ts:113-115` composes the physical key from it directly
(`content:config:{scope}:current`) against **raw `env.CACHE`**, not `TenantKV`.

`src/routes/content.ts:52` makes reads open by design (`GET → next()`), and `src/index.ts:109` and
`:102` mount `/content` and `/config` with **no** gate — neither `sdkKey()` nor `operatorWrites()`
covers them. `src/routes/config.ts:70`, `:90`, `:95` are the same three open reads for the reflex
document. Writes require only `jwt({required:true})` — any operator, no brand.

### Reproduction (`probe.ts` section A, `probe-config.ts` section E; `AUTH_MODE='enforced'`, `SDK_KEYS='coach:…'`)

```
(control) GET /v1/coach/decisions/snapshot  with no key → 401
A1 · GET /content/catalog?scope=kate-spade (no auth) → 200
     {"scope":"kate-spade","source":"stored","revision":2,"actor":"merch-ks",
      "note":"publish ks-b","document":{"pieces":[{"id":"ks-b","title":"UNANNOUNCED Q1 campaign"…
A2 · history → 200 {"revisions":[{"revision":2,"actor":"merch-ks","note":"publish ks-b"},
                                 {"revision":1,"actor":"merch-ks",…}]}
A3 · GET /content/learn?scope=kate-spade → 200 {"holdout":{"share":0.1,"arms":["default",…
A4 · an unprovisioned scope answers too → 200
A5 · cross-brand write with a brand-less operator token → 200
E1 · PATCH /config/reflex?scope=kate-spade (any operator token) → 200
E2 · GET   /config/reflex?scope=kate-spade (no token, no key)   → 200
E3 · GET   /config/reflex/history?scope=kate-spade              → 200
```

### Consequence

On the enforced staging and production stamps, from anywhere on the internet, with no site key, no
token, no cookie and no `X-Tenant` header, one GET returns for **any brand name a caller can guess**:

- the whole content catalogue in force — including pieces staged for an unannounced campaign, their
  merchandising weights, pins and eligibility;
- every prior revision (`/revisions/:n`) and the change index, each carrying the **operator's account id
  or email** in `actor` and their free-text `note`;
- the learning document: holdout share and arms, exploration and autonomy settings, γ trust dials;
- the reflex configuration: the dimension registry and decay horizons.

Scope appendix §1.7, quoted at the top of `src/tenancy/tenant.ts`, promises "per-brand content catalogs,
configurations, strategy profiles, and audiences, with hard data isolation between brands". Storage
isolation is real; read authorization does not exist, so the promise is false from the reader's side.
For a Tapestry-wide contract with a Kate Spade pilot, brand names are public knowledge; guessing costs
nothing (A4 shows an unprovisioned scope answers too, so enumeration is unbounded).

A5/E1 add the write half: any operator token — issued for any brand, carrying no brand claim — replaces
or patches another brand's documents through the validated, versioned path.

### Remedy

Resolve one canonical brand context per request and authorize against it: derive the scope from the
verified site key or the operator's membership, reject a `?scope=` that disagrees, and reject any scope
outside `tenantConfig(env).provisioned`. Put `/content` and `/config` behind the same gate as
`/v1/:tenant/*` so reads need at least the site key, and behind an operator session for revision
history (which discloses staff identity). Route these documents through `TenantKV` so the namespace
guard applies. The console and `docs/kit` callers that pass `?scope=` today need the same change.

### Why this is not in 33 or 34

`scope=`, `scopeOf` and `content/catalog` appear zero times in either document. Doc 34's F03 cites
`src/routes/config.ts:123` — the *write* gate — and characterises the risk as "requires only
`jwt({required:true})`"; it does not observe that the reads are open, that the brand is a query
parameter, or that `/content` exists on this path at all. F15 and F32 examine `versionedStore` for
atomicity and size, not authorization.

---

## S4 · Analytics Engine holds subject-level rows — visitor id, IP address, user agent, URL, referrer — that erasure cannot reach

**Severity: blocks the pilot. Size: M.**

### Evidence

Brief §4 describes Analytics Engine as "A point per decision, outcome and monitor run". That is true of
`src/ledger/enqueue.ts:29`/`:41` and `src/ops/monitor.ts:83`, whose points carry only tenant, brand,
slot, item and counts. There are **seven further** `writeDataPoint` call sites, and they are a different
shape:

| Call site | `blobs` | `indexes` |
|---|---|---|
| `src/routes/tracking.ts:33` (`POST /track/event`) | `JSON.stringify(enrichedEvent)` | `userId \|\| anonymousId` |
| `src/routes/tracking.ts:89` (`POST /track/batch`) | same, per event | same |
| `src/routes/pixel.ts:48` | `JSON.stringify(event)` | `anonymousId` |
| `src/routes/webhook.ts:39` (`/webhook/optimizely`) | `JSON.stringify(transformedEvent)` | `anonymousId` |
| `src/routes/webhook.ts:112` (`/webhook/segment`) | same, incl. `traits` | `userId \|\| anonymousId` |
| `src/routes/webhook.ts:151` (`/webhook/custom`) | whole request body | `anonymousId` |
| `src/routes/optimizely.ts:154` (`/optimizely/track`) | `userId`, `userAttributes`, `eventTags` | `userId` |

What is inside that serialized event: `src/utils/context.ts:9-25` `getPageContext()` returns
`{url, path, referrer, search, userAgent, ip}` where `ip` is `CF-Connecting-IP` (falling back to
`X-Forwarded-For`), and every one of these routes spreads it into `event.page` before stringifying.
`/pixel` additionally records every query parameter and the `Referer`.

None of these routes is authenticated, tenant-scoped, or consent-gated: `grep -n consent
src/routes/tracking.ts src/routes/pixel.ts src/routes/cdp.ts` returns nothing, and none sits under
`sdkKey()`, `operatorWrites()` or any tenant resolution.

`src/ledger/erasure.ts` and the erasure receipt cover R2, KV and the objects; Analytics Engine has no
per-row delete primitive at all, and its retention is a platform setting, not a repository constant.

### Consequence

The platform stores raw IP addresses, user agents, full URLs, referrers and, where the site supplies
one, the account-level `userId` — indexed by the person — in a store from which a subject cannot be
deleted. Every deletion receipt the platform issues is therefore incomplete in a way neither the code
nor the documentation admits. For a January launch under a European or Californian regime this is a
data-protection representation the delivery cannot support.

Secondary, same routes: `/webhook/optimizely-datafile` verifies an HMAC over the raw body in constant
time (`src/routes/webhook.ts:78-88`) but **only when `OPTIMIZELY_WEBHOOK_SECRET` is set** (`:64`) —
absent the secret it accepts anything; and `/webhook/optimizely`, `/segment` and `/custom` verify
nothing at all, so anyone can inject events under any `userId` into `EventDispatcher` and into these
Analytics Engine rows.

### Remedy

1. Decide whether `/track`, `/pixel`, `/webhook/*` and `/optimizely/track` belong on a customer stamp
   at all; they have no caller in the SDK, the console or the kit. If they go, this closes with them.
2. If they stay: stop putting identifiers and raw event bodies into Analytics Engine — points carry
   dimensions and counts, as `src/ledger/enqueue.ts` already does; drop `ip` from what is persisted, or
   truncate it; index by tenant, not by person.
3. Gate them on tenancy and on the same consent decision as the rest of the platform, and require a
   signature on every webhook rather than only when a secret happens to be configured.
4. State Analytics Engine's retention and its lack of a delete primitive in the erasure receipt and in
   the customer's data-protection answer, until (2) makes the point moot.

### Why this is not in 33 or 34

Doc 34's F06 examined Analytics Engine once and concluded: "Reviewed decision/outcome Analytics Engine
points omit visitor/session IDs; do not invent individual rows there to erase, but verify the actual
schema…". That is correct for the two call sites it reviewed and wrong for the other seven, which it
did not enumerate; it explicitly deferred the verification. This finding is that verification, and it
reverses the conclusion. The brief's own §4 statement ("a point per decision, outcome and monitor run")
is the premise that made the omission easy.

---

## S5 · The operator lockout is an unauthenticated denial of service and an audit-log flood

**Severity: blocks the pilot. Size: S.**

### Evidence

`src/routes/auth.ts:66`:

```ts
if ((await store.failedSignIns(email, now - LOCKOUT_WINDOW_MS)) >= LOCKOUT_ATTEMPTS) { … 429 }
```

and `src/auth/store.ts:88-91`:

```sql
SELECT COUNT(*) AS n FROM operator_audit WHERE target_email = ? AND action = 'sign_in_failed' AND at >= ?
```

The counter is rows in the audit table, keyed by the **email the caller supplied**. There is no IP
dimension, no global limit, and no unlock route. `src/index.ts:81` mounts `rateLimiter()` on `/api/*`
only, so `/auth/login` has no request-rate limit of any kind. `src/routes/auth.ts:76` writes the audit
row before the credential check resolves, and for emails that do not exist at all.

### Reproduction (`probe.ts` section B — the real `authRoutes` over the in-memory account store)

```
B1 · correct password after 10 anonymous guesses → 429 {"error":"Too many failed sign-ins. Try again in ten minutes."}
B2 · audit rows written by the anonymous caller = 10 of 12
B3 · an account that does not exist is recorded and lockable too
B4 · same 401 for both; existing account 23.7 ms vs absent 0.4 ms (local node, not workerd)
```

### Consequence

- **Availability.** Ten unauthenticated POSTs lock a named operator out of the console for ten minutes;
  a loop keeps them out permanently. Admins are locked the same way, so there is no in-product recovery
  — someone must delete rows from `operator_audit` in D1 by hand. Doc 30's model has no SSO and no email
  reset, so the console is the only door. A competitor, a bored visitor, or bad luck on the morning of
  the January launch takes every merchandiser offline; the target emails are corporate addresses that
  are trivially guessed.
- **The audit trail.** Every attempt inserts a row with an attacker-chosen `target_email` into the table
  `src/routes/auth.ts:145` calls "the record a security team asks for". `recentAudit` returns at most
  500 rows newest-first, so a flood buries every real event, and the table grows without bound or
  retention.
- **Enumeration.** A missing account returns immediately; an existing one costs a PBKDF2-SHA256
  derivation at 100,000 iterations first (`src/auth/accounts.ts:22-31`). Both answer `401 Invalid
  credentials`, so the response is uniform and the timing is not — 23.7 ms against 0.4 ms locally
  (Node, not workerd; treat the ratio, not the absolute). That tells an attacker which addresses to
  lock, and it is also a CPU-amplification lever against a Workers CPU budget.

### Remedy

Count failures per `(email, IP)` and add an independent per-IP and global limit ahead of the account
counter, so one caller cannot spend another person's budget. Give failed sign-ins their own bounded,
expiring store rather than the audit table, and keep the audit table for events with an actor. Add an
admin unlock and surface the lock state in the console. Equalise the work on an unknown email (derive
against a dummy hash). Mount a rate limiter on `/auth/*`, not only `/api/*`.

### Why this is not in 33 or 34

"lockout", "brute", "enumerat" and "rate limit" appear zero times in doc 34; the brief mentions the
mechanism once, at §5.10, as a design decision it asks reviewers to judge ("ten failures lock ten
minutes"), and neither document draws a consequence from it. Doc 34's F02 concerns token type and
revocation semantics, not sign-in availability; F01's remedy asks for rate limiting on shopper ingress
by route and workload, not for the operator sign-in path.

---

## Checked and found clean

Listed so the absence of a finding is evidence. Each was read, and where marked, executed.

1. **SQL construction (D1).** Every statement in `src/auth/store.ts`, `src/demos/meridian/receipts.ts`,
   `src/demos/meridian/geoCohort.ts`, `src/services/geo/cohort.ts` and `src/routes/operator.ts:341-347`
   is parameterised with `.bind()`. The only interpolated fragments (`join`, `where`) come from fixed
   `switch` arms in `grainClause()`, never from request input. No injection path found.
2. **Key namespacing primitives.** `src/tenancy/tenant.ts` — `assertLogicalKey` refuses the `t:` escape,
   `TenantKV.list` filters the default tenant's otherwise-unprefixed sweep, `logicalKey` rejects foreign
   prefixes. `src/tenancy/objects.ts` applies the same to Durable Object names. The design is sound
   **where it is used**; S1 is a route that goes around it, not a defect in it.
3. **The shipped SDK.** No `innerHTML`, `insertAdjacentHTML`, `outerHTML`, `document.write`, `eval` or
   `new Function` anywhere in `src/sdk/` or `public/sdk/`. Decisions are handed to the customer's own
   renderer as data, so a poisoned catalogue cannot execute script through the SDK on a customer page.
4. **Server-rendered HTML.** None. `c.html(` and `text/html` responses do not occur in `src/`, so the
   worker has no reflected-XSS surface. The operator console has one `innerHTML` site
   (`public/console/views-config.js`) and the other five console files have none.
5. **Cookies.** `src/services/SessionManager.ts:565-600` sets `opt_session_id` `HttpOnly; Secure;
   SameSite=Lax`; the JS-readable ones (`opt_user_id`, `opt_segments`, the consent pair) are the
   documented personalization cookies, and the choice is stated in the code.
6. **`/__shot`.** Closed by default: `src/routes/shot.ts:34-44` returns 404 with no `SHOT_TOKEN`, uses a
   length-independent compare, and resolves `?path=` against the worker's own origin. *Caveat, not a
   finding:* the token is accepted as a query parameter and `hono/logger` (mounted globally at
   `src/index.ts:64`) writes the full path including the query to persisted logs, so anyone with log
   access on a stamp where `SHOT_TOKEN` is set obtains same-origin script execution. Prefer the
   `x-shot-token` header and drop the query form.
7. **Password and token handling.** PBKDF2-SHA256 at 100,000 iterations with a per-user 16-byte random
   salt and a constant-time compare (`src/auth/accounts.ts:22-56`); temporary passwords from
   `crypto.getRandomValues` over an unambiguous alphabet; refresh tokens stored only as SHA-256 hashes;
   sessions revoked on disable, reset, delete and logout. (Doc 34 F02's token-*semantics* findings stand;
   the primitives themselves are correct.)
8. **JWT algorithm handling.** `jose.jwtVerify` with a symmetric `Uint8Array` key restricts the
   algorithm to the HMAC family, so `alg:none` and RS→HS confusion are not reachable. The defect is the
   key material (S2), not the algorithm.
9. **CORS.** In enforced mode with `CORS_ORIGINS` unset — the staging and production setting — 
   `originAllowed` (`src/middleware/edgeAccess.ts:57-65`) fails closed to same-origin. The `*.apex` rule
   matches only the apex and true subdomains. *Caveat:* `http://localhost:9100` and
   `http://127.0.0.1:9100` are allowed unconditionally in every mode while `credentials: true`
   (`src/index.ts:76`), so a page served from a victim's own port 9100 gets credentialed cross-origin
   reads of production. Narrow, but it costs nothing to make the local exception dev-only.
10. **Provisioning secret hygiene.** `scripts/provision-stamp.sh:46-60` generates each secret, pipes it
    to `wrangler secret put` on **stdin** (never argv, so not in the process table or shell history),
    and prints the two a person keeps exactly once. (Doc 34 F09's rotation finding stands.)
11. **Committed credentials.** `git ls-files | xargs grep` for `sk-…`, `AIza…`, `xox[baprs]-`, `ghp_…`,
    `AKIA…` and PEM private-key headers matches no tracked file outside `.claude/worktrees/` (already
    F09). `.dev.vars`, `.dev.vars.*` and `.cursor/mcp.json` are in `.gitignore`.
12. **`POST /v1/:tenant/models/reference`** (`src/routes/decisions.ts:452`) is unauthenticated but
    genuinely stateless: it validates the request shape, scores in memory and stores nothing; no visitor
    id crosses it.
13. **`/live/ops-api`** (the Bright Hour Offer Desk, `src/routes/liveOps.ts`) is unauthenticated in every
    mode — it sits under neither `operatorWrites()` nor `sdkKey()` — but every write it makes lands under
    the `bh:offerdesk:` KV prefix and it reaches no other tenant's data. Worth removing from customer
    stamps with the other demo surfaces (F01), not a separate finding.
14. **Identity salt degradation.** `src/identity/shopperId.ts:30-53` falls back to a constant when
    `IDENTITY_SALT` is absent, but records `isSalted` on every link, so the degradation is visible in the
    data rather than silent.
15. **The rate limiter that exists.** `src/durable-objects/RateLimiter.ts` does an input-gated
    read-modify-write per fixed window and fails closed (a DO error surfaces as a 500, not as
    "allowed"). Its problems are scope, not correctness: mounted on `/api/*` only, and keyed by
    `CF-Connecting-IP` globally rather than per tenant, so tenants share one 100-per-minute budget per IP.

---

## Not verified, and what would close it

- **Which hosts are actually deployed from the default environment.** No network call was permitted, so
  S2's consequence is stated for "any stamp deployed from the default environment". Closing it needs the
  deployed version list and binding manifest for `edge-platform`, and a check of whether a
  `wrangler secret put JWT_SECRET` survives a `wrangler deploy` that also carries the `[vars]` entry
  (`wrangler deploy --dry-run` shows which binding wins).
- **Workers-runtime confirmation of the empty-key path.** C1 ran under Node's WebCrypto via `jose`. The
  code path is identical under workerd, but a miniflare run of `src/middleware/auth.ts` would remove the
  last doubt.
- **Analytics Engine retention and dataset configuration** for this account, which determines how long
  the S4 rows live and whether small-cell disclosure applies.
- **The real `SDK_KEYS`, `CORS_ORIGINS` and `TENANTS` values on staging and production**, which decide
  how many brands S3 exposes today and whether the CORS allow-list is populated.
- **An authenticated console walkthrough**, which would show whether the console itself passes
  `?scope=` in a way that makes the S3 fix a client change as well as a server one.
