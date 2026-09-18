# 25 · Identity stitching and historical transactions

*Built 2026-09-04 (CW25). Closes ledger 20 row 2, scope appendix §1.12: "identity stitching across
anonymous and recognized sessions", and the AE-review reading of §1.12 that a warehouse row which can be
stitched to a visitor is an action arriving late, not a training set.*

Current qualification (W04.02): that historical completion is not security/privacy acceptance.
Backend proof is mandatory; the shared SDK lane additionally needs a bounded server-issued shopper
capability. Copied-grant revocation, cross-tab/server epochs, legacy interfaces and deletion authority
remain open under document35. Local SDK generations are not transactional server revocation.

## 1 · What it does, in one paragraph

A browser is a **visitor** (`vis-…`, now server-generated on shared-SDK bootstrap). A person is a **shopper**
(`sh_` + 32 hex characters, a salted hash of the site's account id, scoped to the brand). When the site says
"this browser is signed in as account X", the worker names the person, folds what the browser learned into
the person's profile, points the browser at the person, and tells the client to carry the person's id from
now on. A second device that signs in to the same account folds in the same way, so the person's profile is
the sum of every device: **cross-device**. Historical rows from the warehouse name a person by the same
account id and land on the same profile, each discounted by how long ago it happened, so a shopper who has
never visited already has interests waiting for their first sign-in. The account id is read once, hashed,
and never stored.

## 2 · The pieces

| Piece | File | What it is |
|---|---|---|
| Shopper id | `src/identity/shopperId.ts` | `sh_` + first 16 bytes of SHA-256(salt ⏎ brand ⏎ account id), hex. Deterministic per brand; the same account on two brands is two shoppers (CW1's isolation, applied to people). The salt is the `IDENTITY_SALT` secret; without it the id is still opaque but dictionary-checkable, so a deployment with real accounts sets one. Every link record says whether it was salted |
| Assertion | `src/identity/assertion.ts` | HMAC-SHA256 over `brand ⏎ visitorId ⏎ accountId ⏎ exp`, keyed by the brand's `IDENTITY_SECRETS` entry, base64url. Required in every mode; missing verification material refuses linking. Historical `assurance: 'site'` records remain readable, not authorization for new links |
| Link table | `src/identity/store.ts` | `identity:visitor:{visitorId}` → the shopper, when, how sure, from where, and any earlier links; `identity:shopper:{shopperId}` → every browser on the person and the history applied. Under the brand prefix in SESSIONS, 400-day TTL. **Not on the decision path** |
| The merge | `src/reflex/identityMerge.ts` | Two affinity vectors become one on the decay invariant: for each value, the older entry is brought forward to the newer entry's last touch and the scores are summed there, so the merged entry is exactly effA + effB at every later moment and `t` stays a real touch. Memberships are unioned, then re-evaluated with hysteresis. Commutative. `applyHistorical` adds a row at its own time: a row older than the entry's last touch contributes `w · e^(−(t − a)/τ)` and never moves `t` back, so a batch lands identically in any order |
| The session host | `SessionManager.absorbIntoShopper`, `resolveRecord`, `applyImport` | The person's session is `user:{shopperId}`'s. The browser's record keeps its content and gains `forwardTo`; reads and writes addressed to it land on the person, and a write from a linked browser cannot rename the person. Visits add across devices; counters add; first seen is the earliest. `deleteSession` on a browser's record detaches the browser; on the person's own session it erases the person |
| The object host | `ShopperReflex` `/identity/export`, `/absorb`, `/import`, `/forward` | The same, on the shopper object, for when `REFLEX_HOST = "do"`. A browser's object with `forwardTo` hands `/ingest` and `/snapshot` to the person's object by name; the identity doors themselves are never forwarded |
| Orchestration | `src/identity/link.ts`, `src/identity/history.ts` | The steps in order, one place per host |
| Routes | `src/routes/identity.ts` | §3 |

Symbols, once: **τ** is the dimension's decay horizon in ms (60 s on the demo config, 150 s for price
band); **t** is an entry's last-touch instant; **s** its raw score; **w** an action's weight (view 1, cart
3, purchase 5); **a** a row's own time; **θ_in / θ_out** the audience entry and exit thresholds (0.6 / 0.45).

## 3 · The routes

All under `/v1/:tenant/identity/`, so CW10's site-key gate covers them.

| Route | Who | Does |
|---|---|---|
| `POST session` | the SDK (site key) | Issues fresh anonymous IDs and a bounded capability, or verifies the supplied capability. Caller-selected IDs and old cookies confer no authority |
| `POST link` `{ visitorId, accountId, source?, exp, assertion }` | the SDK (site key, owned shopper capability and backend proof) | Names the person, merges the owned anonymous source and returns a recognized `session` grant with the actual profile SID. `409` for an already recognized grant; `401` for missing/invalid ownership or backend proof |
| `POST detach` | the SDK (site key and shopper capability) | Expires cookies and returns a fresh anonymous grant. Deletes no person profile; does not revoke a copied unexpired grant |
| `POST resolve` `{ accountIds[] }` | operator token | Account ids → shopper ids, so the warehouse can join without holding the salt |
| `GET visitor/:visitorId` | operator token | The link, if any, from the browser's end |
| `GET shopper/:shopperId` | operator token | The browsers on the person and the history applied. The account id is not on it |
| `POST erase` `{ visitorId \| shopperId }` | operator token | **CW28.** The right to be forgotten: the link table, every profile on either host (the person's session, each browser's pointer and its pre-link record, which the link remembers as `ownSessionId`), and the ledger rows through the ledger's tombstone (honoured at once, rewritten nightly). A linked visitor erases the whole person, because the browser's behaviour already folded in. The receipt lists every id erased and what this cannot reach: ODP's copy, erased through ODP's own API |
| `POST events` (JSON `{ rows }` or `text/csv`) | operator token | Historical rows, ≤ 1000 per request. A row: `accountId \| shopperId \| visitorId`, `action`, `at` (ISO, ms, or unix seconds), and product attributes the registry reads (`line`, `category`, `price_usd`, …). Rows with no weight or no registry attribute are skipped and named by index; a malformed row fails the request. Reports per-shopper audiences after the batch |

Historical proof: `scripts/identity-proof.mjs` reported28 checks before mandatory proof. Its unsigned
link requests are no longer a valid current integration; no operational rerun is implied here.

## 4 · The client contract (asked of the SDK session, plan 21)

The SDK coalesces `POST /v1/{tenant}/identity/session` before use. It receives fresh unpredictable
anonymous subject/profile-session IDs or verifies an existing bounded, purpose-separated non-JWT grant.
The grant uses validated signing configuration and travels in `X-Shopper-Session`; tenant selection
uses `X-Tenant` (a provisioned tenant selector on WebSocket), and the socket grant is a subprotocol,
never a URL parameter. A public site key is not shopper ownership. No cookie/user-pointer/anonymous
forward may promote the public grant to another profile; trusted historical imports remain distinct.

**`identify(accountId, { assertion?, exp?, source?, getAssertion? })`**
1. `POST /v1/{tenant}/identity/link` with the currently owned visitor, backend proof and shopper capability.
2. On `ok`: adopt the returned recognized `session` grant, derived from the actual linked profile SID,
   and mirror its subject for presentation; then **reconnect the socket under the new id**. Pushes for the person go to
   the object named by the person's id, so a socket still open under the old visitor id hears nothing.
3. On `409` (this browser already carries a shopper id), static proof returns the conflict without
   detach or retry. With `getAssertion`, successfully detach first, adopt the fresh server-issued visitor, obtain proof
   bound to that visitor and retry only once. Failed transport/application detach or failed/invalid
   provider output prevents the next link. Never resend proof bound to the previous visitor.
4. The response's `Set-Cookie` applies on its own; the client does nothing for it.

**`logout()`**
1. Invalidate the local generation/cache/socket at transition start, then authenticated `POST /v1/{tenant}/identity/detach`.
2. Adopt the fresh anonymous server grant and rotate browsing attribution; failed detach discards the old local grant.
3. Reconnect the socket under it.

Where the assertion comes from: the site's backend, at login, computes `assertion` with its identity
secret over `tenant ⏎ visitorId ⏎ accountId ⏎ exp` (unix seconds, ≤ 24 h ahead) and puts `{ accountId,
exp, assertion }` on the page. `signAssertion()` in `src/identity/assertion.ts` is the reference. Every
brand must configure verification material; a bare link is refused in all modes. Alternatively,
`getAssertion({ tenant, visitorId, accountId })` synchronously/asynchronously returns `{ assertion, exp }`
from that backend. It takes precedence over static proof without fallback on failure. Each attempt uses
the captured visitor; changed-visitor proof/HTTP results are rejected before adoption. `retried` denotes
a second link request, not merely a detach. Same-client generation checks reject delayed proof, HTTP,
hydration and socket results (including ABA); copied-grant and cross-tab revocation remain excluded.
The SDK's thirty-minute idle `browsingSessionId` remains non-authoritative attribution, shared by
decision/outcome records. Only the signed profile `sessionId` selects state. Page-hide sends use
authenticated keepalive fetch; missing credentials fail closed even in open mode.

## 5 · The rules that keep it safe

- **Only a browser's own record is ever folded or forwarded.** A record carrying an identity, or named by
  anyone but the browser being linked, is left alone. This is enforced inside `absorbIntoShopper`, not at
  the call site, because the `user:` key of a linked browser points at the person, and the first draft of
  the link would have forwarded person A's session to person B on a shared computer.
- **A shopper id is never linked as a visitor.** A browser that carries a person's id and signs in as
  someone else gets `409`; the client logs out first. Folding one person into another is the failure this
  whole design is arranged to make impossible.
- **Relink moves the browser, folds nothing.** What the browser learned went to the first person; the
  second inherits none of it, and the first keeps all of it.
- **A link is not reversible.** A merged profile is one profile. Logout detaches the device; erasure is
  the session reset, a different door.
- **History informs interest, never visits.** An import sets no `lastSeen` and no visit number, so a
  person's first real visit is visit 1 and "most purchases land on the second and third visit" stays a
  statement about visits the engine saw.
- **The raw account id is read once and stored nowhere.** Not in the link table, not in a session, not on a
  Durable Object name, not in a receipt. `resolve` exists so the warehouse can join on the hash.
- **Nothing here is on the decision path.** An anonymous visitor costs nothing; a linked browser whose
  client adopted the id costs nothing; a linked browser that did not costs one forward. The forwarding record
  renews its own TTL once a day under a browser that keeps using it.

## 6 · What is not done, and is not claimed

- ~~The SDK half (§4). The storefront has no sign-in control; the proof is the script.~~ **Both done 2026-09-04.** The SDK has `identify()` and `logout()` (the other session, `src/sdk/identify.ts`), and the Coach storefront has a sign-in row in its Affinity tab that works in both transports: sign in as an account and the instrument fills with what every device of that person learned; sign out and the browser is anonymous again with the person's profile intact. `scripts/rehearse-signin.sh` drives two browser contexts through it, phone then laptop, and checks the person carries both devices' lines, the shopper id is what the page stores, and the raw account id appears nowhere: all green, both transports.
  This is a historical report, not current acceptance: unsigned storefront/script calls now fail closed
  until integrated with backend proof and the shared capability lane. SDK local rotation and bounded
  lane ownership are implemented; strong revocation, legacy callers and engine-wide isolation remain unfinished.
- ODP: the person's vuid derives from the shopper id, so ODP sees one stable profile per person across
  devices, but the account id is **not** sent to ODP as an identifier. Sending it would let ODP do its own
  stitching against their other sources; it is a one-line change in `odpLoop.ts` (handover file) and a
  privacy decision for the brand, so it waits for the brand.
- Session-host retention is the session's 30-day TTL, refreshed by writes. A person whose only presence
  is an import and who never signs in expires with it; the link table outlives it (400 days) and the next
  import rebuilds the profile.
- The object host is built and tested through the same fakes as the rest of `ShopperReflex`; it has not
  run in production, because `REFLEX_HOST` is `session` everywhere. The proof script exercises the session
  host.
