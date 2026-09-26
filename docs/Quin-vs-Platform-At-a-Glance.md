> **Quin predicts what a visitor is likely to do. We decide what the page actually shows.**
>
> One produces a signal. The other is the system that acts on signals. They are not competing products, and a feature-by-feature bake-off will mislead you.

# 1. Two different jobs

| | Quin | Our platform |
|---|---|---|
| The question it answers | Is this visitor likely to convert, or about to leave? | What should this space on the page show, for this shopper, right now? |
| What it hands back | One action: an overlay, promo or recommendation, with the creative already built | A decision for every personalizable space: your own content and product identifiers, in order, with the reason |
| Where it acts | Their cloud, in one region. The action is injected after your page has rendered. | The data centre nearest the shopper, before your page paints |
| What it needs to start | One tag | Your catalog, your tags, your events, and a map of which spaces are personalizable |
| Who runs it day to day | A no-code portal | Your merchandiser and your analyst, in the tuning surface |

# 2. How each one works

| Step | Quin | Our platform |
|---|---|---|
| 1 | A visitor clicks | A visitor arrives |
| 2 | Events go to their cloud | We read where they came from, where they are, and everything they have done so far |
| 3 | A trained model scores their intent | We score every candidate you registered, against your merchandising rules |
| 4 | It picks a ready-made offer from a set built in advance | We return your own identifiers, in the order to render them |
| 5 | Your page injects the offer | Your page renders, and every decision can explain itself |

# 3. What each one can actually do

| The job | Quin | Our platform |
|---|---|---|
| Show a promo or overlay to the right person | **Yes**, this is their core job | **Yes**, as one decision among many |
| Choose which content fills a slot on the page | No | **Yes**, ranked from the pool you registered |
| Reorder the modules on a page | No | **Yes**, the order is the decision |
| Sort a product grid for one shopper | Partly, recommendations only | **Yes**, over the candidates you send |
| Treat content the same way it treats products | No | **Yes**, one engine, one set of rules |
| Remember a shopper next week | No, in-session only by design | **Yes**, and it merges with their history at sign-in |
| Remember a shopper on another device | No | **Yes**, once they sign in |
| Work for a brand-new visitor | **Yes**, their strength | **Yes**, from region, channel, visit number and what that population engages with |
| Work for a brand-new asset | Not published | **Yes**, it inherits from similar assets and reports when it has enough evidence |
| Let a merchandiser pin, block or exclude | Not published | **Yes**, and those rules outrank the engine |
| Explain why one decision happened | No | **Yes**, every term and what it contributed |
| Replay a decision from last month | Not published | **Yes**, and prove it reproduces |
| Change a weight without a release | Partly, through their portal | **Yes**, versioned, in seconds, with a rollback |
| Prove incremental value with a holdout | Not published | **Yes**, recorded on every decision |
| Send decisions to your warehouse | Not published | **Yes**, on a schedule you set |
| Run several brands separately | Not published | **Yes**, isolated from each other |

"Not published" means we found no evidence of it on their site, in their developer kits or in their partner listings. It is not proof of absence.

# 4. The speed claim

- Their site quotes three different numbers: 70 milliseconds, then 17 to predict and 79 to deliver, then "under 70". None of them says what was measured, where, at which percentile, or under what load.
- 17 milliseconds can only be their model thinking, with the network excluded. A round trip from a browser to a regional cloud is 10 to 30 milliseconds inside one region and 75 to 150 across the Atlantic.
- Their speed comes from offers built in advance and then looked up. That is a sound design. It is not a breakthrough, and it is the same shape as ours without the edge.
- **Ours is measured at the data centre nearest the shopper and includes the network leg theirs leaves out.** A returning shopper is answered in tens of milliseconds. A first-ever visitor costs more, because that request creates their profile, and we say so rather than quoting the better number.

# 5. Where we win

**We decide the page, not a single promo.** Which content fills a slot, in what order the modules appear, how a product grid is sorted, all from one engine. Their unit is one injected offer.

**Every decision explains itself, and can be replayed.** Name the reasons, the weights and what each contributed, and re-run a decision from last month to prove it reproduces. They publish no explainability at all.

**Your team changes behaviour in seconds.** Every weight and threshold is versioned configuration with a rollback, effective without a release. Set the affinity weight to zero and you get your current order back exactly, which is what makes a first rollout safe.

**Memory that outlives the session.** A shopper is recognized next week, and across devices once they sign in, with durable profile memory in the customer data platform. They are in-session only, by design.

**Cold start on both halves.** A visitor with no history, and an asset with no history. Theirs covers the first.

**Measurement built in.** Every decision records which arm it belongs to, so a holdout can prove incremental value, and the records land in your warehouse on a schedule.

# 6. Where they genuinely win

**Anonymous first-session intent.** A model trained on clickstreams will beat hand-tuned arithmetic at "is this person about to buy or about to leave". That is their design centre and they are good at it.

**Speed to value.** One tag, no catalog work, and they claim results in fifteen days. We need your catalog, your tags and your slot map before the first decision.

# 7. What this means for us

- **Consume their signal, do not rebuild it.** Our engine already accepts an outside model's score as one weighted input, shown on the receipt. A customer running both gets their intent signal governed and explained by us.
- **We are the decision layer.** A score tells you someone is likely to buy. It does not tell your page what to show, in what order, under which merchandising rules.
- **The receipt and the dial are the part a model cannot copy.** Every decision explains itself and can be replayed. Every weight is configuration that changes behaviour in seconds without a release.
- **Cold start is ours to claim**, on both halves: a visitor with no history, and an asset with no history. Theirs covers the first only.

> **If you remember three things.** They score people; we decide pages. Their fast number excludes the network that ours includes, and their speed comes from pre-built offers. Everything about content, page order, merchandiser control, explanation and measurement is ours alone, which is why this is not an apples-to-apples comparison.
