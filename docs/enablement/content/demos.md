# Behavioral Targeting and Intelligence: which demo to show to whom

For account executives.

**Choose the demo by the question your customer is asking, and show today's engine on Vantage or Top Offers.**

## Two demos run today's engine

| Demo | Address | The question it answers | What the room sees | What it never claims |
|---|---|---|---|---|
| Vantage | [https://edge-platform-vantage.expedge.workers.dev/vantage/](https://edge-platform-vantage.expedge.workers.dev/vantage/) | What can the engine do for a visitor nobody has identified, from the first click? | A carrier's online shop in which a stranger is served from the first paint on how they arrived and their region's synthetic sales; the page following them away from the ad; a phone page whose modules below the buy box the engine orders for them as they browse, while the buy box stays off limits; a merchandiser's pin and availability rule shown as overrides; receipts behind every card. | Any decision on price, financing or credit; anything geographic beyond availability; a reorder when an interest fades; a lift number; that the engine places the homepage's areas, which the page's own template places, standing in for the customer's content system (demo only). |
| Top Offers (on screen, Lantern & Lane) | [https://edge-platform-top-offers.expedge.workers.dev/top-offers/](https://edge-platform-top-offers.expedge.workers.dev/top-offers/) | Can the merchandiser keep control while each visitor earns their own offers? | A retailer's four-container promotions module filled from a pool; the visitor earning it; a merchandiser's day of real, versioned publishes (a window closing, a new promotion with no history, a weight, a pin); a weather and location rule; the module moved on the page by the page's own template, standing in for the customer's content system, while its four promotions stay the engine's (demo only); the click report, labeled attribution. | Products (the pool is promotions); incrementality; a lift number; that the engine moved the module. |

For each visitor, the engine orders whatever sits in a slot, including a stack of page modules, and shows why. Where each slot sits on the page stays the site's own template, and changing the layout by context is a designed next step.

## Two older demos show one idea each, on the older pipeline

| Demo | Address | The question it answers | What the room sees | What it never claims |
|---|---|---|---|---|
| Meridian (on screen, Calder) | [https://edge-platform.expedge.workers.dev/meridian/](https://edge-platform.expedge.workers.dev/meridian/) | Does it work across industries, and whom does the page believe, the ad or the visitor? | One brand, two businesses, with a live swap from retail to a bank; the hinge from the advertised product to what the visitor looks at; an interest fading out while the presenter waits, which the page shows on its own timer as the engine's decay re-asked, never as a pushed alarm. | Its hands-off change is the fading arithmetic checked again on a timer. Never call it a push from the engine. |
| The Bright Hour | [https://edge-platform.expedge.workers.dev/live/](https://edge-platform.expedge.workers.dev/live/), with its Offer Desk at [/live/ops](https://edge-platform.expedge.workers.dev/live/ops) | What about offers that live for hours? | A live-shopping retailer deciding under expiry; a new offer born and ranked with no history; an item selling out mid-session; receipts. | It runs on the shared demo deployment's older build, not today's engine. Never present it as the product. |

Both run Generation 1, the older demo pipeline, at an older version of the code. Their memories are compressed to seconds for the room, and their AI chat and experiment screens are demo seams, not the engine.

## Engineers who saw a demo can move the numbers themselves

Vantage's interactive explainer, [https://edge-platform-vantage.expedge.workers.dev/vantage/how-it-works](https://edge-platform-vantage.expedge.workers.dev/vantage/how-it-works), for a customer's engineers or an SE: every constant on a slider, recomputed in the browser, naming no customer.

## Three things are not for showing as the engine

- First National Bank (`/visual-demo` on the shared worker) shows the 2025 platform, not this engine.
- The storefront at `/storefront` on the shared worker was built for one customer with its own brand and products and is never shown to another.
- OH, a home-appliances demo, is scaffolded and not yet hosted.

The page at `/` on every worker is the 2025 dashboard, not the product.

## Before you show a demo

- Open it from where you are, because the region on screen is the request's real one, and any other region is asserted by a press and labeled.
- Regional data in the demos is synthetic and labeled.
- Vantage shows real phone makers' product images, and legal confirms before any public or recorded use.
- Vantage's regional data has a one-day memory and is reseeded before a showing, so ask the demo owner before a customer sees any demo.

## A demo for your own customer is a restyle, not a rebuild

- A demo is a palette, a product feed and a set of beats on a shared kit.
- It takes the customer's colors and never its logo.
- It may show real names for the products the customer itself sells.
- An SE follows the demo kit's how-to (`docs/demo-kit/HOWTO.md`), and nothing is created in the cloud without the owner's approval.

## Sentences never to say, and what to say instead

| Never say | Say instead |
|---|---|
| The customer a demo was built for | "A carrier's online shop", "a retailer's promotions module" |
| A demo's numbers as the engine's | "Measured on synthetic data, with memories compressed for the room." |
| "The AI chat is the engine" | "The older demos' AI and experiment screens are demo seams, not the engine." |
| "We can put Vantage's images in a public deck" | "Legal confirms before any public or recorded use." |

**Choose the demo by the question your customer is asking, and show today's engine on Vantage or Top Offers.**
