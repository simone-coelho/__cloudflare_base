Your pages send events. We return decisions addressed by your own identifiers. Your front end renders, always, and renders your default when there is no decision.

## The steps

| Step | We do | You do |
|---|---|---|
| **1. Design** | Run the registry, taxonomy and slot sessions. Audit your content sample. | Data science, content operations and a front-end lead in the room. Send 100 to 500 assets. |
| **2. Environment** | Provision your lower environment, issue keys and console accounts. | Send the origins. Run our connection check from inside your network. |
| **3. Data** | Register your content, calibrate tagging with you, connect the product feed. | Content export or feed credentials. Product feed. Lifecycle and rights fields. |
| **4. Instrumentation** | Ship the SDK and tag plan. Verify events end to end. | Install the SDK, emit events, wire consent, sign the login assertion, run QA. |
| **5. Placement** | Configure slots, weights, pins and defaults. | Render by your identifiers. A default per slot. Your timeout. |
| **6. Verification** | Build the end-to-end run and drive it once. | Re-run it yourselves, and agree what you saw. |
| **7. Launch** | Production environment, alerting, runbook, support, tuning. | Security and privacy sign-off. Holdout and metric. Release slot. Tuning owner. |

## What we need from you

| Area | What | Step |
|---|---|---|
| **Content** | Every eligible asset: a stable identifier that survives republish, a type, tags, the slots it may fill, a render reference, lifecycle dates. | 1, then 3 |
| **Products** | Feed and attribute vocabulary. The identifiers your events use. Attributes travel on events and sort requests. | 3 |
| **Pages** | Slot map: stable slot identifiers, item counts, what is off limits, a default for every slot. | 1 |
| **Events** | Content impression, click, dwell, video complete. Product view, add to cart, wishlist. Order completed, with value. | 4 |
| **Identity, consent** | One backend endpoint that signs a short-lived assertion at login. Your consent framework and its withheld behavior. | 4 |
| **Network, privacy** | Origins per environment, script and connect allow-listing, socket egress through your delivery network and firewall. Retention per category. Nothing inbound, no ports. | 2 |
| **Measurement** | Primary metric written down. Holdout share approved before the first personalized page. | 7 |
| **People** | Registry approver, content owner, front-end lead, backend owner, security approver, QA, tuning owner. | 1 |

## The five that move the date

1. **Stable content identifiers and the export.** Nothing starts without them.
2. **Data layer maturity.** The largest single variable in the instrumentation effort.
3. **Socket egress through your delivery network and firewall.** Cheap now, expensive in December.
4. **Front-end capacity before your code freeze.** The critical path runs through your developers.
5. **Security review booked early, with a named approver.**
