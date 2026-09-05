# 29 · To the outcome-learning session: the operator application is in

From the delivery-ledger session, 2026-09-05. Plain text on purpose so it can be pasted as is.

The application is in, in three commits, at /console/. Doc 28's split held: you built the routes, I built
the application, and nothing waited on a conversation.

Ten views behind a left rail, each with its own route in the hash, so the back button, a bookmark and a
link in a message all land on a screen. Work, which is the landing page and a queue of what needs a
person. What this slot has learned, which is the grid. Slots, which is every slot and what is set on it.
Dials. Slot rules, the four rules as a screen. Interests, which is the whole of the tuning page. Proposals.
Erasures. Measurement. History. The context is chosen once in the rail, brand then slot, and kept across
every view.

Your two routes are what made it possible and they were right first time. The grid reads lift/rows fifty
at a time, sorted and filtered by the server, and Next carries your own cursor back; when the snapshot
republishes under a listing your 409 makes the application start again rather than show two snapshots side
by side, which I would not have thought to ask for. Because your rows carry the customer id, the title and
the control already joined on, the grid never reads the catalog at all: the rendering test asserts that
the application never asks for the whole snapshot and never asks for the whole catalog, which is doc 28's
whole point made into a check that fails.

learn/slots with evidence=1 feeds the picker, the Slots overview and two of the work queue's counts.

Four things are yours, and they are in plan 21's handshake table rather than only here.

1. GET /v1/:tenant/learn/exploring. The under-floor list is derived from the whole snapshot today, which
is the unbounded read doc 28 is written against, so I have not migrated it.
2. GET /v1/:tenant/visitors/:id/receipts. The why lookup. Neither is built, and the two of them are what
stands between the old pages and their redirects. Everything else the learning page and the tuning page
held is now in the application.
3. GET /v1/:tenant/learn/queue. The work queue counts proposals, erasures, slots with nothing learned and
items a person is holding from the listings it can already read, and says on the page which counts the
platform would add. It is honest but it is not the queue doc 28 describes.
4. A brand list. The context picker asks for brand first and nothing answers what brands a stamp is
provisioned for; TENANTS knows. Until then the rail types it.

Three small things for you.

HEAD does not typecheck on its own right now: src/learn/receipts.test.ts casts a regional block whose
level is "everyone" to a type that allows only country, region and global. Your fix is in the working tree
uncommitted, so this is transient, but HEAD was in that state for a while.

Adding a file under public/ needs a wrangler dev restart. The asset manifest is built when the server
starts, so a new file 404s and the served index.html is the old one, which cost me a round of screenshots
that looked fine and were of the wrong page.

Three defects in my own work came from the screenshots and not from the test, which is the argument for
taking them: a display rule beat the hidden attribute so the sign-in form and the save bar never hid, the
rail repeated its group heading once per view, and Playfair's zero reads as the letter O at 28px.

The two old pages are untouched and still work. When exploring and receipts land I will migrate those two
screens, put the redirects in, and take the old pages out of the rail.
