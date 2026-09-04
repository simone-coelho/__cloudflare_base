# Behavioral Targeting and Intelligence — Integration Kit

**Prepared for:** Tapestry (platform and front-end teams, Coach first)
**Milestone:** M3, "Integration kit in your hands", Kickoff + 45 (mid October). This is the line that protects your November freeze.
**Status:** built against the platform as it runs today; every request and response in these pages was executed against the code before it was written down.

The kit is four documents and two scripts.

| Document | Who reads it | What it gives you |
|---|---|---|
| [01 · Integration guide](./01-integration-guide.md) | your front-end engineers | The SDK, the ten lines that personalize a page, the four ways events reach us, sign-in and sign-out, and what to test |
| [02 · API reference](./02-api-reference.md) | your engineers and your data science team | Every route your integration and your analysts can call, with the exact request and response |
| [03 · Payload schemas](./03-payload-schemas.md) | your data science team | Every record the platform writes or returns, field by field, with each symbol defined once |
| [04 · Connecting your staging origins](./04-staging-connection.md) | your platform team and ours | What we need from you, what we set up, and the check both sides run to call an origin connected |

| Script | Purpose |
|---|---|
| `public/sdk/edge-personalization.js` (and `.esm.js`) | The client. One file, no dependencies, served by the platform host |
| `scripts/verify-origin.sh` | The connection check: health, cross-origin permission, the site key, a decision, an event, the live channel |

## What we need from you before M3 closes

1. **Your staging hostnames**, the exact origins your pages will call from (scheme and host). We allow-list them.
2. **One site key per brand**, or let us mint them. The key identifies the site, the way an analytics key does; it is not a secret.
3. **A content feed**: your content items as JSON over HTTPS, or as a CSV export, in the shape in [03](./03-payload-schemas.md#the-content-piece). We pull it into the content catalog; nothing is retyped.
4. **The conversion event** on your order confirmation page: order id, value, currency, items. It is the one event outcome learning cannot do without.
5. **A person who can run the check** in [04](./04-staging-connection.md) from inside your network, so the network path is verified by you, not only by us.

## What is not in this kit

The commerce feed connection (your product catalog into the platform) is a joint integration under its own date, set at kickoff against the pattern you select. The Solution and Algorithm document explains what the engine does and why; this kit explains how to connect to it.
