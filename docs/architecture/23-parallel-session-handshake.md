# 23 · Handshake memo for the outcome-learning session

Paste-ready. Hand this to the other session so it knows where to look, what is waiting on it, and what
already exists.

---

We are two sessions on the same repository, split from one conversation. You have outcome learning
(doc 22) and CW4. I have the delivery ledger, the config store, and CW1 tenancy. We share a git tree and
we have collided once already, so this sets out how we work.

WHERE I WRITE TO YOU

Section 18 of docs/architecture/22-outcome-learning-design.md. Everything above section 18 is yours and I
do not touch it. Section 18 is where I record two things: what your design needs to know about code that
already exists, and where I think your design is wrong. Nine subsections so far.

WAITING ON A DECISION FROM YOU, most important first

18.9, D1 sizing. New, and the one I would read first. Section 3.3 says D1 holds the last 30 days "well
under the 10 GB ceiling". On your own figure that breaks at roughly 83,000 personalized page views a day,
and at 1 million a day the whole ceiling is gone in about thirty hours. I show the arithmetic and name the
three inputs that would change the conclusion, so correct it rather than agree with it if one is wrong.
It is recoverable rather than urgent, because R2 holds every record and the index can be rebuilt from the
partitions, but Phase 0 is about to build against the number. Four options, no prescription. Section 3.3
is yours.

18.3, the receipt schema. Your explain record carries versions for config, lift, prior and policy. The
decision receipts that exist today carry a single config_version. Once a lift snapshot moves a score,
config alone no longer identifies a decision, and an explain record that claims otherwise is false. The
new schema is Phase 0's to write.

18.7, the holdout. Section 10's assignment has to exist before the first decision is recorded, not before
the first report. It is the one parameter in the whole catalog whose default cannot be set retroactively.
Your phase table has it in Phase 0; section 10 itself leaves it implied, and it is worth saying in both.

18.8, one taxonomy question. An untagged click from a social host is currently classed referral, not
organic, because in a six-value grouping "organic" means organic search and there is no organic social
bucket. If section 5.4 wants a seventh value, say so and the table follows. The taxonomy is yours.

18.4, rollback semantics. Ours rolls forward: the pointer moves to a NEW revision whose body equals the
old one, and the counter never rewinds. Your section 11 calls a rollback "a version pointer", which this
satisfies. Worth being explicit so the autonomy job does not implement a rewinding counter, because an
autonomous slot that rewinds loses exactly the evidence a person needs to promote or demote it.

WHAT ALREADY EXISTS, so you do not rebuild it

The versioned document store, src/config/versionedStore.ts. Your section 13 catalog is eighteen parameter
groups and your explain record has four version counters, and section 13 says of all of them only that
they are "versioned with change history" without naming a mechanism. This is the mechanism. A DocumentKind
supplies a name and a validator and inherits versioning, attribution, an audit index, rollback, isolate
caching, re-validation on read, and the failure posture. Add a kind, not a second store. RESERVED_PREFIXES
already claims lift, prior and policy so your section 6.1 snapshots cannot collide with a config key. I
see you have added content and slots prefixes, which is exactly right.

registry.resolveReflexConfigRevision(env, surface) returns the config and the revision INTEGER. Your
config_v is an integer; ours is also a string, because it is stamped into decision IDs and read by people
in the explain record. Both are wanted and both are available. Do not recover the integer by regex from
the display string; that works until someone renames a config.

The tenancy module, src/tenancy/. Every KV key, per-shopper Durable Object, session and socket push is now
scoped to a brand, and a request resolves its brand from host or an allow-listed header. The default
tenant is unprefixed so nothing already stored moved. Two things to know. A logical key or visitor id
beginning with "t:" is refused, because under the unprefixed default it would address another brand's
namespace directly, and visitor ids arrive from the wire. And src/content/service.ts still names a shopper
object without a tenant; that file is yours, so I left it alone.

Section 18.8 also resolved something Phase 1 depends on: the default pooling ladder's first two levels,
channel and visit bucket, did not exist. Visit number was worse than missing, it was wrong, because
sessionCount incremented per event. Both are real now, and identityKeyOf() reports whether a vuid came
from a durable identity or fell back to a session, which Phase 0 should record because evidence pooled on
a session-only identity is weaker and the ledger is the only place that can be preserved.

WORKING RULES, learned the hard way this week

Stage paths, not git add -A. I swept about 1,100 lines of your CW4 work into one of my commits that way.
Nothing was lost, only the attribution.

Check exit codes. "npm test | tail" returns 0 even when tests fail, and I committed on a red suite because
of it.

A filtered vitest run is not a smaller run, it is a different one. The brighthour burst block depends on
earlier tests in the same file priming the catalog and audience seeding, so running it with -t fails for
reasons that have nothing to do with the change under test. I chased that for a while.

And if a suite run reports far fewer files than usual with no obvious failure, check memory before you
check your code. ENOMEM under load reads exactly like a broken build.
