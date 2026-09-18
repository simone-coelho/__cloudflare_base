# W22.07 — Explicit buffered actions without fabricated recency

Scope: implement the approved buffered-action purpose on actual POST /realtime/action and both existing hosts. Parent W22 whole contract remains shared identity/dedup, durable sink reconciliation/completeness, versioned histories/horizons, product evidence and fault coverage (document35 §5). This task addresses occurrence-time/consumer-purpose separation only, linked F16/F17/F19/F22/N10/N23 and W23/F18, with W05/W06/W35 safety dependencies. Customer-neutral configured interest supports §1.1/§1.6/§1.8; no contractual acceptance.

Baseline: source-confirmed route has no purpose marker. Both hosts call applyReflex at server now, apply live attributes and regional fan-in; ordinary SessionManager writes advance visits/sessionCount/lastSeen. Historical applyHistorical already preserves contribution time but import methods are privileged, refresh KV TTL or union stale memberships, so do not reuse their persistence wholesale. No failed runtime reproduction claimed; source design case demonstrates old action would gain full fresh weight instead of weight*exp(-age/tau). Entry board VALID1839; preexisting dirty tree, deletions/images retained.

## Contract / implementation

C1. Optional top-level processing:'buffered' (absent retains existing live behavior). Buffered HTTP input must explicitly carry valid stable eventId, represented nonfuture timestamp, and original browsingSessionId (nonempty bounded string, or explicit null when unknown). Validate before effects, preserve numeric zero and original timestamp/nonce/session/decision reference. No age cutoff. Capture one server evaluation now; reject future buffered occurrence, never clamp/replace its ledger time. Keep signed tenant/subject authority; buffering is not identity retargeting. Buffered WS messages explicitly refuse because that door lacks the full measurement path.

C2. Early buffered host branch before live counters/generation/ODP/region/visit effects. Require owned existing profile (missing/forwarded/corrupt fails or explicit drop, never create). Current tracking consent gates all behavior/measurement; personalization off allows only eligible measurement and no current interest changes. Resolve existing subject tombstone before interest and ledger scheduling; observed event time<=erased_at or unknown barrier yields no behavioral/sink effects. Preserve necessary refusal instructions separately.

For eligible personalization, reuse applyHistorical + tick at server now with current tenant-authored weights/tau/registry/content taxonomy and canonical touches; unknown/retired products without permitted touches do not invalidate otherwise eligible measurement. Do not treat the action as fresh counter/journey/last_activity/lastSeen/sessionCount/visit/entry change. Re-evaluate configured local audiences from unchanged behavioral attributes plus current reflex; preserve separately authorized external/ODP audiences, not stale derived names. No ODP forward/upsert/seed/ring, demo capture, receipt-geolocation region fan-in, per-event audience generation, fresh profile cookies or fabricated rendered exposure.

C3. Narrow existing signed-session persistence (not operator pointer/import or live createOrUpdate). Preserve all other state and observed absolute key expiration/metadata from one exact scoped list({prefix:key,limit:1}); no user-pointer or cookie refresh. Missing/malformed exact metadata or expiry less than KV's 60-second minimum refuses, not renewed TTL or guessed expiry. Definite listed nonexpiring key stays nonexpiring. DO candidate commit publishes mirrors only after storage success, preserves lastSeen and existing retention alarm. No new retained history/seen store. Read/check/write KV is not atomic; point tombstones are not a concurrent erase fence.

C4. HTTP dispatch preserves original-time outcomes into existing ledger/online path when host permits tracking and no drop; suppress demo capture and ODP. This is eligible evidence submission, not guaranteed durable delivery, historical credit or completed-report reconstruction. Existing learning uses current config/retained rings; no invented experiment active/archive model or old policy snapshots. Stable nonce does not make personal accumulation across retries idempotent. API note must state these limitations and HTTP-only caller-managed buffering (no SDK offline queue/emitted bundle claims).

## Minimal acceptance

Fixed six selected cases in existing realtime.sdkContract.test.ts: two unmodified W09.05/W26.02 legacy controls plus exactly four grouped W22.07 cases: (1) both hosts analytic age-decay, newer-interest retention, configured audience entry/exit and unchanged live/ODP/region/visit fields; (2) route input/identity/future/zero/very-old/original browsing-session/outcome transport and no buffered WS effects; (3) both-host tracking/personalization refusal, missing/corrupt/forwarded profiles, observed tombstone/corrupt/unavailable barrier and no destination effects; (4) KV exact expiry/metadata and no pointer/cookie refresh, DO persistence-failure/rehydration and retained-time alarm. Reuse existing fixtures; grouped data cases not a new broad matrix. Expand only for an observed concrete defect with lead amendment.

Worker and distinct reviewer each run:
node node_modules/vitest/vitest.mjs run src/routes/realtime.sdkContract.test.ts -t 'W22[.]07|W09[.]05 preserves|W26[.]02 refuses malformed' --maxWorkers=1 --minWorkers=1

Same-byte no-emit compiler1536, changed-source scoped lint no new warning signatures (baseline retained; no cleanup of inherited warnings), whitespace including new helper. Root inspects actual baseline-relative delta. No installs/emitted build/runtime infrastructure suite/deploy.

## Ownership / limits / rollback

Sole source/test/API writer /root/w2206_worker, actor w2206-worker, Astra/xhigh; independent /root/late_hour_next_review, actor w2205-reviewer, Astra/xhigh. No subdelegation. Worker owns seven output paths in baseline and its worker.json only; lead owns admission/tracker/journal/freeze/acceptance. Implementation source GO only after recorded preflight/admission. Existing accepted W09.08/W22.06/W23.02 implementations retained; qualify overlapping exact proofs prospectively and preserve all untouched assurance, no unrelated re-testing.

User-approved bounded purpose record plus existing local mandate authorizes this implementation, not full D06, retention expansion, identity policy, lifecycle/config-generation reset, historical reconstruction, customer-data operations or release. No commit/stage/push/cloud/credentials/destructive/external actions.

Rollback: patch only admitted baseline-relative deltas; no state migration or new history to clear. Stop advertising/sending marker if withdrawn; do not silently downgrade buffered input into fresh live events.

KV semantics checked in official docs: https://developers.cloudflare.com/kv/api/list-keys/ (absolute expiration/metadata, sorted keys) and https://developers.cloudflare.com/kv/api/write-key-value-pairs/ (absolute expiration and 60-second minimum). Local fixtures are not deployed KV acceptance.
