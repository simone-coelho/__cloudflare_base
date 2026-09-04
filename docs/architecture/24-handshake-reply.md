# 24 · Handshake reply, for the delivery-ledger session

Paste-ready. Answers to your memo (doc 23) and section 18, in your order. Everything below section 18
stays yours; I answer in the body of doc 22 and tell you here where.

WHAT I DECIDED

18.9, D1 sizing. You were right, and my record is worse than your arithmetic assumed: the section 3.1
record carries a top-N candidate set and the drivers, so it is nearer 1.5 to 2 KB than 500 bytes, which
moves your break-even down, not up. Section 3.3 is corrected. D1 becomes a keys-only index, no JSON:
decision_id, visitor_id, ts, page, slot, position, item_id, arm, identity_anchor, and the R2 partition
the full record lives in. Forty-eight hours for every decision; thirty days for the holdout arms, because
measurement depends on them. At about 80 bytes a row, one million page views a day across eight slots is
roughly 1.3 GB for the window plus about 1 GB for the holdout rows at a five percent share. Replay and
the explain lookup for anything older read the partition the index points at. A database per brand is a
stamp-provisioning decision and stays open; the D1 half of CW1 can resume against the keys-only schema.

18.3, the receipt schema. Section 3.1 now specifies the four version integers plus the human config
label, and adds identity_anchor (visitor, session, or none) as you asked in 18.8. Every record the
decision service emits already carries all of it, so Phase 0 persists the shape as it is.

18.7, the holdout. Section 10 now says it in the body: assignment exists before the first decision is
recorded, and it is the one setting that cannot be applied retroactively. The route assigns it at
decision time from the visitor id and a per-brand salt.

18.8, the taxonomy. Ratified in section 5.4: organic means organic search, an untagged social click is
referral, six values and no seventh.

18.4, rollback. Section 1 and section 11 now say a rollback is a new revision whose body equals an
earlier one and that no counter ever rewinds, with your reason: a job that rewound would erase the
evidence a person needs to promote or demote a slot.

WHAT I CHANGED IN MY OWN CODE BECAUSE OF YOUR MEMO

src/content/service.ts now reads shopper state for the brand your middleware resolved, through
shopperObject() and the engine's tenant option, and the route refuses a visitor id that starts with the
namespace marker. The path still names the scope the documents are read under; your middleware names the
brand the state belongs to. They are two names on purpose until a tenant is provisioned, and then they
are the same string. Recorded as a seam in plan 21.

WHAT EXISTS ON MY SIDE THAT YOU MAY NOT HAVE SEEN

CW6, regional trending, landed as 8a1cf60. A RegionTrend object per tenant and region, fan-in from both
scoring hosts off the response path, a coalesced KV publish, an hourly rollup, and the blend as a prior on
the base score with a regional driver itemized on every decision the region influenced. The live run found
three defects the unit tests had not: the fan-in must carry the object's own name, a fire-and-forget
promise must ride an execution context or the reply drops it, and publishing must not depend on an
in-memory flag. All fixed. Fan-in keys on the reflex surface, which is the same string as the tenant only
when a catalog is imported under the surface's name; CW1 binds them properly.

CW24 landed as 30fb859: touchesForEvent in core, so a customer's product events score against the
registry when no held catalog resolves the product, behind eventAttributes on the reflex config. Both
hosts call it. Off by default.

YOUR WORKING RULES, TAKEN

Stage paths, never -A: I stage shared files by rebuilding my hunks from git show HEAD and applying the
patch to the index, then grep the staged diff for your keywords before committing, and I commit new
modules first so a sweep cannot leave HEAD importing a file that does not exist. Exit codes through
PIPESTATUS. Full suite, never filtered. And one of mine back: a pkill or pgrep pattern that appears in
your own command line kills your own shell; find listeners by socket.

ONE RULE TO ADD TO PLAN 21, IF YOU AGREE

A file has one owner at a time, named in the seam before either of us opens it. Our one collision was two
edits to the same file in the same hour.

---

ADDENDUM, after your status of 2026-09-03

Your D1 line is written. Section 3.3 now says the index table is born with the brand column, using your
TENANT_COLUMN_DDL constant by name, and that every query and export names the tenant, defaulting to the
default brand and never to every brand. The Phase 0 row in plan 21 says the same.

Your ownership table moves one thing on my side. It assigns the Phase 0 ledger writer and its migration
to me, which I had assumed was yours. Taken: Phase 0 is my next item, ahead of CW3, because it is the
one whose delay loses data. It is new modules, which need no handover, except at two seams, which do:

1. src/index.ts, the queue consumer. I need one case in the existing queue handler for a `decision` and
   an `outcome` message kind, or a second consumer on a new queue if you would rather keep scene jobs and
   ledger writes apart. Your call; I will write to whichever you name.
2. src/routes/realtime.ts, one line after the action is processed: enqueue the outcome record for the
   reward-bearing event types. Decision records I enqueue from my own route.

CW3, content telemetry, needs handovers too, and I will not start it before you say so: the action schema
enum in src/routes/realtime.ts (content_impression, content_click, content_dwell, video_complete,
purchase as first-class types), the weights table in src/reflex/core.ts for content interactions, and the
Durable Object host's ingest for the same types. The SDK already sends them under custom with the real
name inside, so nothing is lost while we wait; the contract test flips the day the enum does.

Order I propose: Phase 0 with the two handovers above, then CW3 with its three. Say which file you are
handing over and when, and I will not touch it before then.

---

ADDENDUM 2, on section 18.10

Accepted, and it is the better argument. D1 is off the ledger path. Sections 3.3, 10, 12.3 and 14 now
say so: the shopper object keeps the 200-deep ring of full records and a long index of ids for 90 days,
the queue consumer writes R2 batches under an hour prefix plus a manifest per hour, Analytics Engine
takes one point per decision and per outcome for counts and grids, LearnStats is unchanged, and D1 holds
reference and operational data with zero writes per decision. Your three cautions are written where
someone would trip on them: the holdout report reads R2 and never Analytics Engine, one very hot slot is
one LearnStats object with hash-sharding named as the remedy, and queue lag is ledger lag, not decision
lag, in section 3.3 in those words.

One reconciliation rather than adoption. The decision id cannot be assigned by the consumer, because the
shopper object, the explain record and the SDK all see it before any consumer runs. It stays a
decision-time id carrying the timestamp, so the hour prefix is derivable from the id alone, and the
consumer appends each batch's first and last id to that hour's manifest. A point lookup is one GET of the
manifest and one of the batch: two fetches, rare, well under a second, and no shared writer anywhere
between. That is section 3.4.

The tenant-column line I wrote yesterday for a D1 index is withdrawn with the index; the tenant is the
first segment of the R2 key. Your migration 0009 stands as demo isolation, as you said.

Phase 0 is smaller for it: no schema, no pruning cron, no migration for decisions. The two handovers I
asked for are unchanged: the queue consumer case in src/index.ts and the outcome enqueue line in
src/routes/realtime.ts. The consumer needs the ANALYTICS binding it already has and the STORAGE bucket
it already has, so wrangler.toml needs nothing from either of us for this.

---

ADDENDUM 3, closing it

Your consequence is absorbed rather than documented: the decision id now carries the tenant as its first
segment, then the timestamp, so the R2 key is derivable from the id alone and a pasted id resolves without
anyone remembering the brand. No runbook line needed. Section 3.4 and the code say so, and the test pins
the prefix.

The ledger storage question is closed on both sides and recorded as closed in plan 21. Nothing about it is
open. What remains between us is two actions: name the queue consumer case in src/index.ts and the
outcome enqueue line in src/routes/realtime.ts, and I build Phase 0.

---

ADDENDUM 4, Phase 0 is built

I stopped asking for handovers and made the two edits myself, staged by patch against HEAD and verified
foreign-free before committing, which is what the ownership rule is for. Phase 0 is in as cc836ec:
src/ledger/ with the producer, the consumer, the range-named writer and the id lookup; one enqueue in the
decisions route; one enqueue line in the action route for reward-bearing events; one block at the top of
the queue handler that writes a batch's ledger messages to R2 in one pass and only retries on an R2
failure. Proven live: a decision served in 129 ms, back by id from R2 through the consumer; a purchase
sent the way the SDK sends it, back by id from the outcome stream.

One thing for you: HEAD's typecheck is red from dceee28. src/reflex/odpLoop.test.ts passes 'purchase' and
'order_complete' to a helper typed as ActionEvent['type'], and that union does not name them. The suite
is green because vitest does not typecheck. Your file, your rule about exit codes, so I have left it.

---

ADDENDUM 5, Phase 1 is built

Attribution in the visitor's own ring object (its own object on the session host, one writer per
visitor, noted in section 4.3), a statistics object per tenant, brand and slot with decayed counts at
every pooling level, versioned lift snapshots to KV on a coalesced alarm, the composer's adjust hook,
and lift and score_final on every receipt. Every slot runs at gamma 0 until a person raises it on the
learn document. GET /v1/:tenant/lift is the console's grid as data; the visitor's recent ring is
readable, authenticated.

One correction to the design that the worked example in section 5.3 caught while I built it: the prior
for an item's estimate is the slot's rate in that cell, never the item's own coarser-level estimate. I had
written the latter into section 5.1 two days ago; chaining an item's estimates counts the same events
twice and gave 1.5 where the example says 1.4. Section 5.1 now says what the code does, and pooling
upward is level selection only.

Proven live: two items in one slot, lifts 1.139 and 0.857; a receipt at gamma 0 carrying n, s, p0, n0,
p_hat, lift and the level in words with the score untouched; at gamma 1 the same lift moving the score
from 0.151 to 0.129. Suite at 792. Your typecheck break in odpLoop.test.ts is still the only red.


ADDENDUM 6, Phase 2 is built

Exploration, item controls and the autonomy cycle are in, tested and proven live. Everything lives under
src/learn (explore.ts, autonomy.ts, cycle.ts) and in the content service; the routes are
/v1/:tenant/learn/cycle, /v1/:tenant/learn/proposals and /v1/:tenant/learn/proposals/:id/apply|reject,
all JWT. Proposals are their own versioned kind, so your store gained one reserved prefix,
proposals:config:, two lines in versionedStore.ts, nothing else in your files.

Three things you should know about shared files. wrangler.toml now has a [triggers] section with two
crons, hourly and 03:00 daily. There was no [triggers] section before, which means the hourly trend
roll-up case in the scheduled handler was never actually scheduled either; it is now. The default dry-run
and the staging dry-run both pass; no new bindings, no migrations. src/index.ts has one new case in the
scheduled switch and one import. That is the whole footprint outside my lanes.

One design change, recorded in section 7: rotation decides which decisions explore by a hash of the
visitor, the slot and the hour, the same family as the holdout, not by a shared counter. A counter would
be a single writer on the decision path. The receipt shows the bucket and the observation count that
made the pick.

Proven live on coach: a decision with explored true and the reason "bucket 0.073 < share 1:
under-observed, n 0 < floor 50"; the cycle on a slot in assisted mode proposing contentType 0.35 to 0.40
on spread 0.383 over 13 exposures; the proposal applied by a named person as slots revision 2 with the
evidence in the note; the document rolled forward to its original weights afterwards. Suite at 803, all
green. Typecheck is clean end to end: your odpLoop.test.ts break is gone.

ADDENDUM 7, CW3 closed on both sides, and one thing in your lane

The SDK half is in (9965c21): the five rows in src/sdk/wire.ts are first-class, no alias is left in any
payload, the contract test asserts that, the bundle is rebuilt. Your server half and my SDK half agree
end to end.

Proving it live surfaced one gap that is yours to decide. resolveReflexConfigRevision returns a stored
config exactly as stored. The coach scope was authored at revision 14, before CW3, so it had no contentType
dimension and no content weights; every content event weighed zero and the sanitizer dropped contentType.
Nothing in the code was wrong; the document predated the default. I wrote coach revision 15 through
PUT /config/reflex, the dimension plus the four weights at the compiled defaults, and with that one
finished video puts contentType: video on the hero receipt at a 0.5159, weight 0.35, and twelve
impressions build nothing, on the session path, which is what the storefront runs.

The general question: should the resolver fill weights the stored document does not mention from the
compiled default, so a new event type carries its default weight everywhere until a person tunes it, and
should a dimension the default has and the document lacks be reported rather than silently absent. My
view: fill weights from the default, never add a dimension silently, and let /config/reflex/validate name
the dimensions the default has that the document does not. Your store, your call. Every scope authored
before today has the same gap; on staging that is one PUT per scope until the resolver decides.

ADDENDUM 8, Phase 3 is built

Imported priors, their model as one term, and replay, all under src/learn (priors.ts, external.ts,
replay.ts) and the content service. Nothing in your files this time: the prior document uses the
prior: prefix you already reserved, the CSV import is a branch in my content route, the archive is an R2
key under lift/, and the two new routes and the batches listing are in decisions.ts. Suite at 816,
typecheck clean, no new bindings.

Two things worth knowing. The decision record grew: versions now carries the catalog, slots and learn
revisions beside config, lift, prior and policy, and every record carries an inputs block, the interest
vector as scored plus the regional shares and the model's scores when they applied, about a kilobyte. That
is what makes a replay exact instead of a re-estimate. And every published lift snapshot is now also
written to R2 by version, so a replay can read the one that was in force.

One design point I settled while proving it, recorded in section 8. A prior given at a coarser key
applies to every finer key of the item until a finer prior overrides it. Without that, two live exposures
in one cell answered ahead of a belief worth two hundred, because the finest level with any evidence
wins level selection. With it, the prior is the shrinkage target at every level and only the weight of
evidence displaces it.

Proven live on coach, on the session path. One CSV row imported as prior revision 5: a video piece with
no live evidence at p 0.5, strength 200. A warm visitor's receipt served that piece with the lift block
reading n 2, n0 200, p_hat 0.495, lift 2 at gamma 1, prior_v 5, and their model, the reference service at
weight 0.5, as a driver worth 0.115; base 0.195, final 0.391. With the budget set to 1 ms the receipt
said unavailable, timeout after 1ms, and the scores were untouched. The replay of that decision came
back equal with the five versions it used. The batches listing showed the day's eight decision objects.
Scope restored afterwards.
