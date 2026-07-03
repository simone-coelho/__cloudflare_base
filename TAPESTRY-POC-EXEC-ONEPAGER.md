# Tapestry / Coach POC — Executive One-Pager
**Demo:** Mon 2026-06-29 · **→ https://edge-platform.expedge.workers.dev/storefront**

**The line:** Dynamic Yield is one cog. **Optimizely is the entire machine** — and that's ~100× the value of a point tool. Anyone can hand a customer a segment; we bring the system *and the expertise* to turn it into a personalized, optimized, measured experience.

**What we built (in ~3 days):** a fully working, edge-native real-time personalization storefront for Coach. Not a mockup, not Figma — **real software, running live.** Open the link, hit **Start ▶ / Auto** in the Demo Director on the right, and it plays itself in ~10 minutes.

**All 15 personalization capabilities — implemented** (the on-screen "Capabilities" tab tracks them live). Three are our headline weapons:

- **Cold start that beats Mastercard.** DY rents a *neighborhood spend average* by ZIP — third-party, no intent. We open on **what shoppers from that location actually bought — Tapestry's own first-party data — plus free public census income.** Real geolocation, real query; only the data is swapped (sample today → their warehouse in production, one flag). Cheaper, smarter, *theirs*, and it compounds over time.
- **TikTok Signal-Led Moment.** A bag goes viral; ~30-minute window. **Opal writes the copy, we generate the hero image live from the real product, launch a bandit, and optimize the winner — autonomously, inside the window.** "DY reacts to the neighborhood; we react to the world *right now.*"
- **Revenue Radar.** Finds the revenue leak (Coach Gen-Z checkout drops ~44%, ≈$7.6K recoverable), proposes the fix, **launches a real experiment, and proves the recovery — in the room.**

**It's real — and it's only their data away from production.** Every experience works; the **experiments are real flags you can open in the Optimizely UI.** The one thing we'd change for production is **pointing it at Tapestry's own data** (their CDP/ODP, Optimizely Analytics) — configuration, not a rebuild. It all runs on the Cloudflare edge, so the maintenance burden is light.

**Why it matters beyond this deal:** the conversational layer runs on **the same model class as Opal**, so it ports natively — and **everything here makes Opal ~100× more capable**, giving it the skills to personalize with intelligence and almost no UI. This codebase already powers multiple demos; what we build for Tapestry **upgrades what we can offer every customer.**

**The honest ask:** this is a POC — solid architecture, but enterprise-hardening (security, logging, safeguards, validation) is **weeks**, a full platform **months**, in ongoing partnership with Tapestry (much of today's behavior is our best-guess assumptions to validate with them). The one thing I need from leadership: **help landing these capabilities inside Opal.** I am **not** asking anyone to reprioritize Opal — I'm asking to **make Opal better**, with exactly the capabilities our customers want right now.

**→ Open it, play it with Auto, and let's win tomorrow:** https://edge-platform.expedge.workers.dev/storefront
