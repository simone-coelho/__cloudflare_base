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
