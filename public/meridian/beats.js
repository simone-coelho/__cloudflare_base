// public/meridian/beats.js
//
// THE RUN OF SHOW, in executable form. This file is the single source for the
// director; docs/opticon/Opticon-Run-Of-Show.md is its prose twin and the two
// must not drift.
//
// THE DIRECTOR PERFORMS ONLY WHAT THE PRESENTER PRESSED FOR. It advances the
// narrative, may do STAGE MANAGEMENT — reset to a clean visitor, switch the catalogue, set a
// region — but it never clicks a product, never fires a signal, and never fakes
// a change. Every visible personalization comes from the presenter actually
// doing something, because an audience can tell the difference and the whole
// argument rests on them believing what they just watched.
//
//   arm     — stage management run BEFORE the beat. Whitelisted in the director.
//   perform — what the VISIBLE VISITOR does when the presenter presses Next: real
//             clicks on real controls, played through the cursor. The press is
//             the presenter's; the performance is watched. Nothing fires on its own.
//   do    — what the PRESENTER does. Never automated.
//   watch — what the room should be looking at. Safe to project.
//   say   — the presenter's line. NOT projected by default (see ?prompter=1).
//   secs  — planned duration, and `why` is the reason it is that long.
//
// Durations sum to each act's budget in the run of show: 4/6/20/8/4/3 minutes
// plus 5 for questions. They are a pacing intention, not a timer that fires —
// nothing in the director interrupts a presenter mid-sentence.

export const ACTS = [
  { n: 0, name: 'The frame', mins: 4, note: 'Slides. No product on screen yet.' },
  { n: 1, name: 'The Arrival', mins: 6, note: 'The ecosystem. Keep it moving — it sets up Act 2, it is not the point.' },
  { n: 2, name: 'The Handoff & The Session', mins: 20, note: 'The engine, the content lane, and the flip.' },
  { n: 3, name: 'The Operator', mins: 8, note: 'Opal and experimentation.' },
  { n: 4, name: 'The Business', mins: 4, note: 'Revenue Radar.' },
  { n: 5, name: 'The Moment', mins: 3, note: 'Signal to live creative.' },
  { n: 6, name: 'Questions', mins: 5, note: 'Leave it. Do not fill the silence.' },
];

export const BEATS = [
  // ── ACT 0 · the frame · 240s ───────────────────────────────────────────────
  { n: 1, act: 0, cap: '—', title: 'Most of your traffic is a stranger', secs: 80,
    why: 'The premise the whole session rests on. Said too fast it sounds like a statistic instead of a problem.',
    do: 'Slide. No product on screen.',
    watch: 'Nothing yet — this is the frame.',
    say: 'Most of your traffic is unidentified, and most of it has never been seen before. Every personalization system in this room reaches the identified minority. We are going to spend forty-five minutes on the majority.',
    real: 'slides' },

  { n: 2, act: 0, cap: '—', title: 'The edge is not a datacentre', secs: 80,
    why: 'A definition the room will hold for the next forty minutes. Worth landing once, properly.',
    do: 'Slide.',
    watch: '—',
    say: 'The edge is not a datacentre your request travels to. It is the same network hop that already served the page. That is the entire reason any of what follows can happen inside a click.',
    real: 'slides' },

  { n: 3, act: 0, cap: '—', title: 'Your merchandisers still outrank the machine', secs: 80,
    why: 'Defuses the objection before it forms. Every merchandiser in the room is waiting to hear it.',
    do: 'Slide. Then switch to the demo.',
    watch: '—',
    say: 'Rules decide what can show. The engine decides what does show in the space that is left, and it shows its receipts. Nothing here asks you to trust a black box.',
    real: 'slides' },

  // ── ACT 1 · the arrival · 360s ─────────────────────────────────────────────
  { n: 4, act: 1, cap: 'C2', title: 'She arrives — the cold start', secs: 50, mark: 'STOP',
    perform: [{ arrive: true }],
    why: 'The premise of the whole session: no profile, no segment, nobody else’s data — and the page still opens on what shoppers from her neighbourhood actually buy.',
    arm: { reset: true },
    do: 'Press Next. Read the band with the room: real geo, free census, your own receipts. Then OK.',
    watch: 'The hero: “The Drover leads near you”. The first line: what New York-metro shoppers carry. The welcome. The provenance: geo real · census real · first-party representative · behaviour none.',
    say: 'Nobody knows her. No account, no cookie, no segment. What we do know is where she is — and what shoppers from there actually bought, in your own receipts, enriched with free public census data. Dynamic Yield rents a neighbourhood’s average wallet from a third party. We open on your customers’ own purchases: no licensing, real intent, and it compounds because it is yours. Aggregate, never the individual. We curate, never price.',
    real: 'geo LIVE · census LIVE public · first-party REPRESENTATIVE' },

  { n: 5, act: 1, cap: 'C1', title: 'She opened an email', secs: 55,
    perform: [{ surface: 0 }],
    why: 'First time the room sees a page answer something that happened off-site. It needs room to land.',
    do: 'Open the email in the inbox on the left.',
    watch: 'Episode card forms: opened → pixel fired → identity resolved → landed. The hero already answers the email.',
    say: 'She opened that in Gmail. Not on your site. The pixel fired, we captured it, and by the time she arrived the page had already answered it. She has not clicked a single thing here.',
    real: 'LIVE' },

  { n: 6, act: 1, cap: 'C3', title: 'She clicked the ad', secs: 50,
    perform: [{ surface: 1 }],
    why: 'A repeat of the same mechanism with a different surface. Faster, because the room already has the idea.',
    do: 'Click the ad.',
    watch: 'UTM lands, the episode names the campaign, the hero picks up its promise.',
    say: 'Your media team spent money to make that click happen. Most sites then show the same homepage they show everyone.',
    real: 'LIVE' },

  { n: 7, act: 1, cap: 'C2', title: 'She signed up by text', secs: 30,
    perform: [{ surface: 2 }],
    why: 'One press, one surface — the room needs to see the text land before the next thing happens.',
    do: 'Sign up by text.',
    watch: 'Identity resolves off a phone number. The hero answers the text.',
    say: 'Different surface, same profile, and she never typed an email address into your site.',
    real: 'LIVE' },

  { n: 8, act: 1, cap: 'C4', title: 'A form on someone else’s site', secs: 30,
    perform: [{ surface: 3 }],
    why: 'Introduces the declared-versus-observed distinction used again in Act 3. Its own press, so it can be discussed.',
    do: 'Submit the style quiz.',
    watch: 'Declared interest joins observed behaviour — and the engine keeps them apart.',
    say: 'Now we have what she told us and what she did. Those are different kinds of evidence and it weighs them differently — a stated preference decays on the same clock as everything else, so telling us once does not steer her forever.',
    real: 'LIVE' },

  { n: 9, act: 1, cap: 'C5', title: 'Four surfaces, one profile', secs: 55,
    why: 'The act’s thesis. A pause here is what makes Act 2 feel earned rather than clever.',
    do: 'Point at the episode stack.',
    watch: 'Four episodes, one profile, no stitching step anywhere.',
    say: 'Four systems that in most stacks hold four different views of this person. One profile, resolved at the edge — and every one of those is first-party data you already own.',
    real: 'LIVE' },

  { n: 10, act: 1, cap: 'C6 · C7', title: 'The receipts behind the cold start', secs: 90,
    perform: [{ tab: 'cold' }, { sel: '#btn-dyvs' }],
    why: 'Dense: geography, the census, the ladder, your receipts, and how they are matched. The longest beat in the act by design — everybody in the room is looking for cold-start management.',
    do: 'Nothing. Point at the cold-start panel, then the card.',
    watch: 'Region off the connection · census row and source · your receipts by line with their shares · the grain used · geo real / census real / first-party representative / behaviour none. Then the card: what the area tells us, what your own sales tell us, matched to your range.',
    say: 'The geography is real — off the connection. The census is real and free — ACS, cited on the row; we have income, home value, ZIP. And the receipts are yours: what shoppers from this metro bought, by line, with the share. Others will sell you receipts that have nothing to do with what you sell. This is your own data, matched to your own range: people here earn about this, buy in this band, so the store opens there. We roll up only when your own counts are thin — never because the census is. And we curate, never price.',
    real: 'geo LIVE · census LIVE public · first-party REPRESENTATIVE' },

  // ── ACT 2 · the handoff and the session · 900s ─────────────────────────────
  { n: 11, act: 2, cap: 'C35', title: 'The handoff', secs: 110, mark: 'STOP',
    perform: [{ dept: 'Bags' }, { card: { cat: 'Bags', n: 0 } }, { card: { cat: 'Bags', n: 1 } }],
    why: 'The hinge of the whole session. Marked STOP in the script; rushing this loses the argument.',
    do: 'Press "Wanders to bags". Watch her leave the campaign: the department, then two bags, with the cursor.',
    watch: 'Bars shift off the arrival category. The hero stops being about the campaign. The episode closes itself.',
    say: 'Stop. This is the most important sixty seconds in the session. The email said handbags. The ad said handbags. She is looking at wallets. Watch what the page decides to believe. … The campaign did not have to be wrong for that to matter. She simply moved on, and the page moved with her.',
    real: 'LIVE' },

  { n: 12, act: 2, cap: 'C36', title: 'That number is measured', secs: 40,
    why: 'One sentence, one number. Any longer and it reads as defensiveness about performance.',
    do: 'Point at the latency badge.',
    watch: 'The measured decision time, updating per event.',
    say: 'No backend job ran. No segment rebuilt overnight. No profile downloaded to this browser. That happened over a connection that was already open, while she was still on the page — and that number is measured, not a slide.',
    real: 'LIVE' },

  { n: 13, act: 2, cap: 'C14', title: 'The control', secs: 45, mark: 'DO NOT SKIP',
    perform: [{ tab: 'affinity' }],
    why: 'Every comparison for the next ten minutes is against this. Skipping it costs all of them.',
    do: 'Show the sort row untouched.',
    watch: 'Standard order. "The same order every shopper sees."',
    say: 'This is the order every shopper sees. Remember it — everything after this is measured against it.',
    real: 'LIVE' },

  { n: 14, act: 2, cap: 'C8', title: 'Different memories, different speeds', secs: 50,
    perform: [{ dept: 'Outerwear' }, { card: { cat: 'Outerwear', n: 0 } }, { card: { cat: 'Outerwear', n: 1 } }],
    why: 'Sets up the staircase in beat 27. Without it, the retreats later look arbitrary.',
    do: 'Press Next — the department, then two coats. The third coat is beat 15’s prediction; do not press the palette button here or it will consume it.',
    watch: 'Bars move at different rates. Taste is slow; this session is fast.',
    say: 'Eight things about her, each with its own memory. Taste moves slowly. What she is looking at right now moves fast. One engine holds both. And the line she is in follows her last click, not her running total — step from Drover to Linden and Linden leads at once, while Drover trails until it decays out on its own.',
    real: 'LIVE' },

  { n: 15, act: 2, cap: 'C9', title: 'It waited until it was sure', secs: 55, mark: 'SLOW DOWN',
    perform: [{ predict: { card: { cat: 'Outerwear', n: 2 } } }],
    why: 'The hysteresis idea is the least intuitive thing in the session and the most defensible.',
    do: 'Press Next. The band predicts what the third click will cause — read it to the room, close it, and watch it come true.',
    watch: 'A bar crosses θin, turns green, a chip appears — and a green strip above the hero says she entered the audience and why.',
    say: 'It waited until it was sure. That shaded band is the gap between entering and leaving — it is why she will not flicker in and out of an audience all afternoon.',
    real: 'LIVE' },

  { n: 16, act: 2, cap: 'C15', title: 'The row re-ranks', secs: 50,
    why: 'Visual, immediate, needs no explanation. Let the motion do the work.',
    do: 'Nothing — it already happened.',
    watch: 'Cards travel. Rank chips count. Only the movers are ringed.',
    say: 'Watch the coral one climb from five to one. Every card keeps its colour so you can follow it — and only the ones that actually moved are ringed.',
    real: 'LIVE' },

  { n: 17, act: 2, cap: 'C16', title: 'The hero commits', secs: 35,
    why: 'A short beat between two longer ones. The rhythm matters as much as the content.',
    do: 'Nothing.',
    watch: 'The hero claims her — and says why.',
    say: 'It only claims her when it can support the claim. Before that it said "because of where you are", because that was all it honestly had.',
    real: 'LIVE' },

  { n: 18, act: 2, cap: 'C17', title: 'Which box comes first', secs: 50,
    perform: [{ tab: 'trail' }],
    why: 'The content beat is the one that separates this from a recommender. Worth a real pause.',
    do: 'Point at the page. Nothing to press — it moved on the third coat.',
    watch: 'The SECTIONS re-order. The product row has climbed above the hero — she is browsing coats, so the products lead and the campaign hero dropped to second. 700ms, slow enough to read as structural. The trail says "Which box comes first · The hero 1 → 2" and why.',
    say: 'Not what is inside the box — which box comes first. She is browsing coats, so the product row just climbed above the hero, and the campaign that brought her here dropped to second. Watch it again when she decides: the offer will climb to the very top. Same vector, same arithmetic, but the candidates are the sections of the page rather than the products in them. In our own documents this is the six-month tier. It is running.',
    real: 'LIVE' },

  { n: 19, act: 2, cap: 'C13 · C18', title: 'The page gains a section', secs: 55,
    perform: [{ predict: { sel: '#hero-cta' } }],
    why: 'Two capabilities land together and the causal link needs saying out loud.',
    do: 'Press Next. The band predicts the add to bag — the offer, the completion row — then the cursor performs it.',
    watch: 'The row becomes "Complete the look" — nothing from the same category. A dimension read from the verb, not the item.',
    say: 'She stopped browsing and started deciding. That is an eighth dimension, and it is the only one not read off a product — it is read off what she did. So the page stops offering her more coats and starts completing the one she chose. It gained a section, not just different contents.',
    real: 'LIVE' },

  { n: 20, act: 2, cap: 'C36', title: 'Content is a catalogue too', secs: 75, mark: 'THE TAPESTRY THESIS',
    perform: [{ stage: 'content' }, { sel: '#btn-receipts' }],
    why: 'The differentiator: everyone recommends products; almost nobody runs the same engine over content. The wire on screen is the contract a customer’s front end paints from.',
    do: 'Point at the three chipped slots — the merch strip, the content hero, the carousel — then open the receipts and show the content push.',
    watch: 'The shelf narrows to one line and the content areas hold the stage — the merch ad, the stories, the content hero, the carousel, each with its strip: the why on the left, the type and the customer id on the right. In the receipts: the literal payload — contentId, customerContentId, type, slot, order, score, explain. One push per page.',
    say: 'Everything you have watched the engine do to products, it is doing to content — same arithmetic, second catalogue. These are your pieces, with your CMS ids, scored by the same affinities and delivered as decisions by ID: we push the id, the slot, the score and the why; your front end paints. That is the whole integration. And the merch strip has not moved all session — it is non-personalizable by your config, and the engine ranks around it.',
    real: 'content catalogue REPRESENTATIVE (your CMS in production) · scoring LIVE · the payload REAL' },

  { n: 21, act: 2, cap: 'C36', title: 'Content follows her, with the map', secs: 75,
    perform: [{ line: { name: 'Fenwick', n: 0 } }],
    why: 'The schematic pre-card: the room sees the page-plan before it happens, then watches it come true — the Tapestry design document, live.',
    do: 'Press Next. Read the band: the page-now and page-after schematics, the destinations badged on the page behind it. Then OK.',
    watch: 'The band shows “your page now → after” as coloured slot maps; ghost badges on the page say where each slot will go. On OK the carousel and the stories re-rank to knitwear content and the content hero picks up the Fenwick guide.',
    say: 'Before anything moves, the engine tells you the plan — this block here, that block there, and why: the scores, against the thresholds. Then it does exactly that. Content recommendations with the same receipts as products. Nobody wrote a rule; she touched a sweater.',
    real: 'scoring LIVE · schematic computed from the same forecast' },

  { n: 22, act: 2, cap: 'C36', title: 'The complement — content completing a product', secs: 75,
    perform: [{ sel: '#hero-cta' }],
    why: 'Content that answers what she is DOING, not just what she likes: a styling guide injected because she committed to a piece.',
    do: 'Press Next — she adds the sweater to the bag; watch the content answer the decision.',
    watch: 'Journey stage flips to deciding; the content hero becomes the styling guide that completes the piece; the carousel keeps her lines.',
    say: 'She committed, and the content changed jobs: from inspiring her to helping her finish — what to wear it with, how to care for it. Same engine, reading the stage of her journey, choosing content the way it chooses complements. That is content personalization as Tapestry means it.',
    real: 'scoring LIVE · journey stage LIVE' },

  { n: 23, act: 2, cap: 'C36', title: 'Pin it anywhere', secs: 75, mark: 'THE CONTRACT LINE',
    perform: [{ sel: '#btn-pinmerch' }],
    why: 'The governance answer: nothing is ever permanently pinned, and anything can be pinned at any position — the engine ranks around the pins. Choreographed slowly, and labelled so.',
    do: 'Press Next — the banner pins at #3 and the page re-ranks around it, one slot at a time. Say the label out loud: slowed for the room.',
    watch: 'The merch strip travels to position 3 and everything else re-ranks around it, one section at a time; the strip names the tenant-config rule. Say the “slowed for the room” line yourself as it moves — the glass carries the badges, not a banner.',
    say: 'Your merchandiser wanted the banner third — contract says the banner is theirs, so it goes third, and the engine ranks around it. Nothing here is ever permanently pinned, and anything can be pinned at any position. In production this re-ranking is one frame; we slowed it so you could watch it think.',
    real: 'pin + rank-around LIVE · movement slowed for the room — say so' },

  { n: 24, act: 2, cap: 'C33', title: 'An offer that cannot be extended', secs: 45,
    why: 'The anti-urgency-theatre argument. One beat, because the payoff is at expiry in beat 27.',
    do: 'Point at the offer band.',
    watch: 'A white-glove offer with a countdown — and it climbed to the TOP of the page the moment she decided. Service, not a discount.',
    say: 'That clock is not a marketing timer. It runs to the instant the engine calculates her intent crosses back under its threshold — so it cannot be extended, and when it ends it will tell you the number that ended it.',
    real: 'LIVE' },

  // THE KNOBS ARE REAL, AND THE SCRIPT HAS TO SHOW IT. The dial writes into the
  // live strategy table the composer reads on every decision — no rebuild, no
  // redeploy — and this is the capability Tapestry's data scientists asked for
  // by name. It was in the product and missing from the deck.
  { n: 25, act: 2, cap: 'C11 · C19', title: 'Turn a knob, in front of them', secs: 45,
    mark: 'NO BLACK BOX',
    perform: [{ tab: 'glass' }, { dial: { shape: 'narrow', to: 0.6 } }],
    why: 'The one beat that proves the weights are configuration and not a model. Everything else in the deck asks them to believe the arithmetic; this lets them change it.',
    do: 'Turn the line weight up. The hero re-decides on the new weight, and the receipt stamps the config version.',
    watch: 'The hero recomposes on the press · the Why line names the new weight · the receipt version reads “+tuned”. Nothing was rebuilt and nothing was redeployed.',
    say: 'These are not learned parameters you have to trust. They are configuration, and they are yours. I am turning up how much the line matters, right now, and the next decision uses it — no rebuild, no redeploy, and the receipt records which version of the weights made the call. That is what we mean by no black box: you can read the decision, and you can change the rule that made it.',
    real: 'LIVE · the weight is written into the live strategy table the composer reads' },
  { n: 26, act: 2, cap: 'C11 · C19', title: 'Your merchandiser outranks it', secs: 45,
    perform: [{ tab: 'affinity' }, { sel: '#btn-pin' }],
    why: 'Two governance points that answer the same objection; taking them together keeps the pace up.',
    do: 'Open the audience list, then pin the hero — and RELEASE the pin before moving on.',
    watch: 'Audiences in the catalogue’s own words. Hero locks; explain reads "pinned · ranking skipped". The button becomes "Release the pin".',
    say: 'Nobody wrote these audiences. They are minted from your catalogue, in your merchandising language. And declared precedence — gates, then pins, then ranking. Your merchandiser outranks the machine, and the machine says so on the record.',
    real: 'LIVE' },

  { n: 27, act: 2, cap: 'C20', title: 'The refusal', secs: 40, mark: 'SLOW DOWN',
    perform: [{ sel: '#btn-pin' }, { sel: '#btn-soldout' }, { tab: 'glass' }],
    caution: 'RELEASE THE HERO PIN FIRST. A pinned hero skips ranking entirely, so there are no refused candidates to show and this beat renders empty.',
    why: 'The most persuasive thing the engine does. It is also the least expected, so it needs setup and silence.',
    do: 'Open the explain on an excluded item.',
    watch: 'Highest score. Refused. The rule named.',
    say: 'That is the engine declining a click it would have won. It scored highest, a rule said no, and it kept the score so you can see what it gave up. Showing you the refusal is worth more than showing you the win.',
    real: 'LIVE' },

  { n: 28, act: 2, cap: 'C10 · C33', title: 'Watch her leave', secs: 90, mark: 'THE BEAT NOBODY ELSE HAS',
    perform: [{ sel: '#btn-skip' }],
    why: 'Two presses of two minutes each and the three retreats have landed, in order, with their numbers. Nothing happens while you wait any more — time passes when you say so.',
    do: 'Press "Let two minutes pass". The retreats land one after another; talk over them. Press it again for the rest.',
    watch: 'Three separate retreats, in order — the aisle first (category), then the price band, then taste — each naming its dimension and its number as it lands. The offer ends and says why. The row returns to discovery.',
    say: 'Now watch it forget — in order. The aisle she wandered through goes first; the price band holds longer; taste holds longest, because we made their clocks different on purpose. Each exit names its number. Nobody wrote a rule to remove her from anything — the same arithmetic that let her in is letting her out.',
    real: 'LIVE' },

  { n: 29, act: 2, cap: 'C12', title: 'She came back', secs: 50,
    why: 'Short and factual. The danger here is overclaiming, so keep it tight.',
    arm: { returnVisit: true },
    do: 'Come back later — same visitor, new session.',
    watch: 'Dimensions, audiences and a personalized hero, restored.',
    say: 'She closed the tab and came back. No login, no cookie sync, nothing downloaded — the profile was held per visitor at the edge.',
    caution: 'DO NOT say "ODP is the memory". ODP is deliberately not connected on this surface. If asked: connect ODP and this becomes durable across devices and shareable with the rest of your stack — that is a credential, not a code change.',
    real: 'edge memory LIVE · ODP wired-dormant' },

  { n: 30, act: 2, cap: 'C34', title: 'I changed what we sell', secs: 95, mark: 'THE STRONGEST LINE',
    caution: 'The episode trail CLEARS on the flip — the vector is rebuilt under the new registry, which is the honest thing to do when the dimension keys change. Do not say "same trail". The continuity is the instrument and the surface KINDS, not the history.',
    why: 'The act’s payoff. It needs the silence after it more than it needs the words in it.',
    arm: { vertical: 'financial' },
    do: 'Switch the business.',
    watch: 'Eight bars stay in exactly their places and re-label. The four surfaces keep their KINDS — email, paid social, SMS, partner form — and re-vocabularise. Cold start recomputes from median home value at 80% LTV. The centre becomes unrecognisable.',
    say: 'I changed what we sell. Watch what did not change: eight bars, in the same eight places, relabelled. Category became product family, taste became life stage, colour became card tier, journey stage became application stage. Same four kinds of surface on the left, speaking a different language. The centre you would not recognise — a bank does not merchandise, it makes offers and asks you to apply, so it renders as rates and cards and eligibility. One engine. Your front end paints it. You already know this customer, you just do not know him in this vocabulary yet.',
    real: 'LIVE' },

  // ── ACT 3 · the operator · 480s ────────────────────────────────────────────
  { n: 31, act: 3, cap: 'C21', title: 'Opal proposes', secs: 70,
    perform: [{ sel: '#btn-opal' }],
    why: 'The room needs to read the generated rule, not just watch it appear.',
    arm: { vertical: 'retail' },
    do: 'Ask Opal in plain English.',
    watch: 'A real audience definition, its rule legible, built from the live registry.',
    say: 'A real model call against your own vocabulary. It cannot invent a dimension — the schema is built from the live registry, so an invented one is rejected before it reaches our code. And it proposed. It did not publish.',
    real: 'LIVE (US-only)' },

  { n: 32, act: 3, cap: 'C21', title: 'A person decides', secs: 50,
    why: 'The governance beat. Short, deliberate, and it answers the AI-safety question in the room.',
    do: 'Click Publish.',
    watch: 'It goes live. The page can target it.',
    say: 'That is the governance beat. The machine proposes, a person decides, and both are on the record with a name and a timestamp.',
    real: 'GATED — enabled' },

  { n: 33, act: 3, cap: 'C22', title: 'It cannot invent a scene', secs: 75,
    perform: [{ sel: '#btn-ask' }],
    why: 'The anti-hallucination argument, made structurally rather than promised.',
    do: 'Type a request in words.',
    watch: 'A curated scene, our copy, engine-ranked products, and the provenance line.',
    say: 'The model’s only job is routing that sentence to one of eight approved scenes. It cannot invent one, because the schema is an enum. And it does not pick the products — the deterministic engine still ranks those.',
    real: 'LIVE' },

  { n: 34, act: 3, cap: 'C23', title: 'A stylist that cannot oversell', secs: 75,
    perform: [{ sel: '#btn-conc' }],
    why: 'The second turn is the point. Budget enough for both turns and the refusal.',
    do: 'Ask for a look. Then correct it. Then ask for something we do not sell.',
    watch: 'Real catalogue pieces. The refinement repeats nothing. The refusal names what is missing.',
    say: 'Every id it can return is bound to your live catalogue, minus everything it has already shown — so repeating itself is not something it is asked to avoid, it is something it cannot represent. And when you ask for something you do not carry, it says so instead of substituting quietly.',
    real: 'LIVE' },

  { n: 35, act: 3, cap: 'C24', title: 'The product is real, the scene is styling', secs: 45,
    why: 'A caption beat. It exists to pre-empt "is that image real", so it must be unhurried and plain.',
    do: 'Point at the editorial hero.',
    watch: 'The product is the real product. The scene is an approved still.',
    say: 'The bag is your real product. The scene around it is styling, it is composed onto an approved still rather than generated, and the caption on screen says so.',
    real: 'LIVE' },

  { n: 36, act: 3, cap: 'C25', title: 'A real experiment, thirty seconds ago', secs: 80,
    perform: [{ sel: '#btn-ab' }],
    why: 'Includes opening the Optimizely console. Allow for the tab switch and the page load.',
    do: 'Dispatch. Then open Optimizely and show it.',
    watch: 'Real flag, real rule, 50/50.',
    say: 'Created in the real project, thirty seconds ago. Not a mock, not a screenshot — that is your console.',
    real: 'LIVE' },

  { n: 37, act: 3, cap: 'C26 · C27', title: 'Bandits — real rules, honest readouts', secs: 85,
    perform: [{ sel: '#btn-mab' }, { wait: 6000 }, { sel: '#btn-cmab' }],
    why: 'The card shows Opal doing it and says on every line what is real and what is representative. That honesty is the credibility beat.',
    do: 'Create the MAB, then the CMAB. Point at the badge, the ids, and the word REPRESENTATIVE.',
    watch: 'Two cards: multi_armed_bandit and contextual_multi_armed_bandit rules in the real project, with flag and rule ids and an Open-it-now link. The allocation and the per-context winners are labelled representative.',
    say: 'Both real, both in your project — open it. What I will not do is pretend this room is traffic: the allocation you see is representative and it says so. The rule is the product; the traffic is yours.',
    real: 'rules REAL · readouts REPRESENTATIVE' },

  // ── ACT 4 · the business · 240s ────────────────────────────────────────────
  { n: 38, act: 4, cap: 'C28', title: 'The average lied', secs: 110, mark: 'THE BIGGEST WOW — SLOW RIGHT DOWN',
    perform: [{ sel: '#btn-radar' }, { wait: 2500 }, { sel: '#rad-c-gen_z' }],
    why: 'One filter and an arithmetic reveal. The blended number has to be seen looking ordinary first, or the collapse reads as staged.',
    do: 'Open Revenue Radar on everyone. Then filter to Gen-Z.',
    watch: 'Blended: the payment step looks like an ordinary week. Gen-Z: it collapses ~44% at the payment step, flagged, with the recoverable amount computed term by term.',
    say: 'Across all customers this checkout looked fine — that is the number in your weekly report. Segment to Gen-Z and it collapses forty-four percent at the payment step. About seven and a half thousand dollars walking out the door, computed from the rows, not typed in.',
    real: 'compute LIVE · traffic SIMULATED' },

  { n: 39, act: 4, cap: 'C29', title: 'Launch the fix — and prove it in the room', secs: 80,
    perform: [{ sel: '#rad-launch' }, { wait: 6000 }, { sel: '#rad-prove' }],
    why: 'The recoverable arithmetic is shown term by term, a real object is created, the funnel recovers, and the payment step changes for that shopper. All four need to be seen.',
    do: 'Launch the fix. Watch the funnel recover. Then open the checkout.',
    watch: 'A real audience id and a real experiment targeted at the diagnosed cohort · the payment bar climbs (green) with the fix applied · the checkout’s payment step now shows Pay in 4 with social proof.',
    say: 'It found the leak, built the fix, launched a real experiment targeted at a real audience — and proved the recovery, in the room. And here is that shopper’s payment step, right now: installments and social proof, served by that experiment. Not a report you read next quarter.',
    real: 'audience/flag LIVE · recovery REPRESENTATIVE · in-session fix LIVE' },

  { n: 40, act: 4, cap: 'C30', title: 'We hand you the rows', secs: 50,
    perform: [{ sel: '#btn-receipts' }],
    why: 'The closing credibility move of the act. Plain, short, and unhedged.',
    do: 'Export.',
    watch: 'Warehouse rows: gates, scores, rank, tie-break hash, config version.',
    say: 'We hand you the rows. You compute the lift. We will never present our own uplift number as the proof.',
    real: 'LIVE' },

  // ── ACT 5 · the moment · 180s ──────────────────────────────────────────────
  { n: 41, act: 5, cap: 'C31', title: 'A signal we did not generate', secs: 35,
    why: 'The honesty label goes first, before the impressive part, or it reads as an excuse afterwards.',
    do: 'Point at the detection chip.',
    watch: 'Nothing on the glass yet — this line is yours to say. The ledger appears with the moment: SIMULATED · 1 (the detection) against REAL · 4 and REPRESENTATIVE · 1.',
    say: 'One thing in this beat is simulated: the detection. We do not sell social listening — in production that signal comes from your listening vendor or from your own team, and it reaches us as an API call carrying what is trending, which product it points at, and which approved artwork to use. Everything after it is real, and in a moment it will all be on the screen: the copy written now, the artwork approved before today, the flag and the rule in your project, and the window. One simulated thing, four real ones, and the traffic split labelled representative because nobody in this room is buying.',
    real: 'SIMULATED, labelled' },

  { n: 42, act: 5, cap: 'C31', title: 'Opal writes the moment', secs: 45,
    perform: [{ sel: '#btn-moment' }],
    why: 'The elapsed counter is the point. Talk across it rather than watching it.',
    do: 'Trigger the moment.',
    watch: 'Elapsed counter running while Opal writes the creative.',
    say: 'Reading the signal, writing the moment. Talk across this — it takes about eight seconds and I want you watching the clock, not me.',
    real: 'LIVE' },

  { n: 43, act: 5, cap: 'C31 · C12 · C13', title: 'It ships as a real bandit — and the loop closes', secs: 50,
    perform: [{ sel: '#btn-skip' }, { wait: 1200 }, { sel: '#btn-skip' }, { wait: 1200 }, { sel: '#btn-skip' }],
    why: 'The loop closing is the payoff. The bandit moves only as demo time moves, so the room sees each round land on a press.',
    do: 'Press Next: six minutes pass in three consented steps. Read the card as the traffic shifts.',
    watch: 'The experiment card: a real multi_armed_bandit rule with its flag and rule ids · the 28:00 window · traffic 50/50 → 40/60 → 27/73 → 20/80 · “Loop closed in ≈6:00 of 28:00 — winner promoted automatically.”',
    say: 'That rule is real — open Optimizely and it is there. The traffic is not: nobody in this room is buying, so the allocation you are watching is representative and it says so. Signal to a live, optimizing experience inside the window — before the moment cooled. Today a human still presses Launch; autonomy is roadmap.',
    real: 'rule REAL · copy REAL · allocation REPRESENTATIVE · signal SIMULATED' },

  { n: 44, act: 5, cap: '—', title: 'What I did not show you', secs: 50,
    why: 'Closing on the limits is what makes everything before it credible. Do not skip it to save time.',
    do: 'Nothing.',
    watch: '—',
    say: 'I did not show you a lift chart, a reallocation curve, or a per-context winner, because this room did not generate the traffic those need. I did not show you social listening, because we do not ship it. Everything else you watched was running, and the parts that were simulated said so on screen while they were doing it.',
    real: '—' },
];

/** Act budgets versus what the beats actually add up to. Drift is a bug. */
export function pacingCheck() {
  const out = [];
  for (const a of ACTS) {
    if (a.n === 6) { out.push({ act: a.n, name: a.name, planned: a.mins * 60, sum: a.mins * 60, ok: true }); continue; }
    const sum = BEATS.filter((b) => b.act === a.n).reduce((n, b) => n + b.secs, 0);
    out.push({ act: a.n, name: a.name, planned: a.mins * 60, sum, ok: sum === a.mins * 60 });
  }
  return out;
}
