// public/meridian/beats.js
//
// THE RUN OF SHOW, in executable form. This file is the single source for the
// director; docs/opticon/Opticon-Run-Of-Show.md is its prose twin and the two
// must not drift.
//
// THE DIRECTOR NEVER PERFORMS THE DEMO. It advances the narrative and it may do
// STAGE MANAGEMENT — reset to a clean visitor, switch the catalogue, set a
// region — but it never clicks a product, never fires a signal, and never fakes
// a change. Every visible personalization comes from the presenter actually
// doing something, because an audience can tell the difference and the whole
// argument rests on them believing what they just watched.
//
//   arm   — stage management run BEFORE the beat. Whitelisted in the director.
//   do    — what the PRESENTER does. Never automated.
//   watch — what the room should be looking at. Safe to project.
//   say   — the presenter's line. NOT projected by default (see ?prompter=1).
//   secs  — planned duration, and `why` is the reason it is that long.
//
// Durations sum to each act's budget in the run of show: 4/6/15/8/4/3 minutes
// plus 5 for questions. They are a pacing intention, not a timer that fires —
// nothing in the director interrupts a presenter mid-sentence.

export const ACTS = [
  { n: 0, name: 'The frame', mins: 4, note: 'Slides. No product on screen yet.' },
  { n: 1, name: 'The Arrival', mins: 6, note: 'The ecosystem. Keep it moving — it sets up Act 2, it is not the point.' },
  { n: 2, name: 'The Handoff & The Session', mins: 15, note: 'The engine, and the flip.' },
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
  { n: 4, act: 1, cap: 'C1', title: 'She opened an email', secs: 75,
    why: 'First time the room sees a page answer something that happened off-site. It needs room to land.',
    arm: { reset: true },
    do: 'Open the email in the inbox on the left.',
    watch: 'Episode card forms: opened → pixel fired → identity resolved → landed. The hero already answers the email.',
    say: 'She opened that in Gmail. Not on your site. The pixel fired, we captured it, and by the time she arrived the page had already answered it. She has not clicked a single thing here.',
    real: 'LIVE' },

  { n: 5, act: 1, cap: 'C3', title: 'She clicked the ad', secs: 55,
    why: 'A repeat of the same mechanism with a different surface. Faster, because the room already has the idea.',
    do: 'Click the ad.',
    watch: 'UTM lands, the episode names the campaign, the hero picks up its promise.',
    say: 'Your media team spent money to make that click happen. Most sites then show the same homepage they show everyone.',
    real: 'LIVE' },

  { n: 6, act: 1, cap: 'C2 · C4', title: 'Text, then a form on someone else’s site', secs: 70,
    why: 'Two surfaces in one beat, and it introduces the declared-versus-observed distinction used again in Act 3.',
    do: 'Sign up by text, then submit the style quiz.',
    watch: 'Identity resolves. Declared interest joins observed behaviour — and the engine keeps them apart.',
    say: 'Different surfaces, same profile, and she never typed an email address into your site. Now we have what she told us and what she did. Those are different kinds of evidence and it weighs them differently — a stated preference decays on the same clock as everything else, so telling us once does not steer her forever.',
    real: 'LIVE' },

  { n: 7, act: 1, cap: 'C5', title: 'Four surfaces, one profile', secs: 60,
    why: 'The act’s thesis. A pause here is what makes Act 2 feel earned rather than clever.',
    do: 'Point at the episode stack.',
    watch: 'Four episodes, one profile, no stitching step anywhere.',
    say: 'Four systems that in most stacks hold four different views of this person. One profile, resolved at the edge — and every one of those is first-party data you already own.',
    real: 'LIVE' },

  { n: 8, act: 1, cap: 'C6 · C7', title: 'And the ones who arrive with none of that', secs: 100,
    why: 'Dense: geography, census, the derivation, and four honesty labels. The longest beat in the act by design.',
    do: 'Nothing. Point at the cold-start panel.',
    watch: 'Region off the connection · published census · the derivation sentence · geo real / census real / prior derived / behaviour none.',
    say: 'For the ones who arrive with none of the above — region off the connection, income from published census, opening price band is arithmetic over the two. No tracker, no third-party data, no consent wall. And it is labelled: the geography is real, the census is real, the prior is derived, and the behaviour is nothing, because she has not done anything yet.',
    real: 'geo LIVE · census LIVE public · cohort REPRESENTATIVE' },

  // ── ACT 2 · the handoff and the session · 900s ─────────────────────────────
  { n: 9, act: 2, cap: 'C35', title: 'The handoff', secs: 110, mark: 'STOP',
    why: 'The hinge of the whole session. Marked STOP in the script; rushing this loses the argument.',
    do: 'Browse away from the campaign. She arrived on handbags — click a wallet, another wallet, a dress.',
    watch: 'Bars shift off the arrival category. The hero stops being about the campaign. The episode closes itself.',
    say: 'Stop. This is the most important sixty seconds in the session. The email said handbags. The ad said handbags. She is looking at wallets. Watch what the page decides to believe. … The campaign did not have to be wrong for that to matter. She simply moved on, and the page moved with her.',
    real: 'LIVE' },

  { n: 10, act: 2, cap: 'C36', title: 'That number is measured', secs: 40,
    why: 'One sentence, one number. Any longer and it reads as defensiveness about performance.',
    do: 'Point at the latency badge.',
    watch: 'The measured decision time, updating per event.',
    say: 'No backend job ran. No segment rebuilt overnight. No profile downloaded to this browser. That happened over a connection that was already open, while she was still on the page — and that number is measured, not a slide.',
    real: 'LIVE' },

  { n: 11, act: 2, cap: 'C14', title: 'The control', secs: 45, mark: 'DO NOT SKIP',
    why: 'Every comparison for the next ten minutes is against this. Skipping it costs all of them.',
    do: 'Show the sort row untouched.',
    watch: 'Standard order. "The same order every shopper sees."',
    say: 'This is the order every shopper sees. Remember it — everything after this is measured against it.',
    real: 'LIVE' },

  { n: 12, act: 2, cap: 'C8', title: 'Different memories, different speeds', secs: 50,
    why: 'Sets up the staircase in beat 21. Without it, the retreats later look arbitrary.',
    do: 'Click two items.',
    watch: 'Bars move at different rates. Taste is slow; this session is fast.',
    say: 'Seven things about her, each with its own memory. Taste moves slowly. What she is looking at right now moves fast. One engine holds both.',
    real: 'LIVE' },

  { n: 13, act: 2, cap: 'C9', title: 'It waited until it was sure', secs: 55, mark: 'SLOW DOWN',
    why: 'The hysteresis idea is the least intuitive thing in the session and the most defensible.',
    do: 'Click a third.',
    watch: 'A bar crosses θin, turns green, a chip appears.',
    say: 'It waited until it was sure. That shaded band is the gap between entering and leaving — it is why she will not flicker in and out of an audience all afternoon.',
    real: 'LIVE' },

  { n: 14, act: 2, cap: 'C15', title: 'The row re-ranks', secs: 50,
    why: 'Visual, immediate, needs no explanation. Let the motion do the work.',
    do: 'Nothing — it already happened.',
    watch: 'Cards travel. Rank chips count. Only the movers are ringed.',
    say: 'Watch the coral one climb from five to one. Every card keeps its colour so you can follow it — and only the ones that actually moved are ringed.',
    real: 'LIVE' },

  { n: 15, act: 2, cap: 'C16', title: 'The hero commits', secs: 35,
    why: 'A short beat between two longer ones. The rhythm matters as much as the content.',
    do: 'Nothing.',
    watch: 'The hero claims her — and says why.',
    say: 'It only claims her when it can support the claim. Before that it said "because of where you are", because that was all it honestly had.',
    real: 'LIVE' },

  { n: 16, act: 2, cap: 'C17', title: 'Which box comes first', secs: 50,
    why: 'The content beat is the one that separates this from a recommender. Worth a real pause.',
    do: 'Point below the grid.',
    watch: 'The editorial block changes — full width, slow, structural.',
    say: 'Not what is inside the box. Which box comes first. One profile decides the merchandising and the storytelling, so they agree with each other instead of arguing.',
    real: 'LIVE' },

  { n: 17, act: 2, cap: 'C13 · C18', title: 'The page gains a section', secs: 55,
    why: 'Two capabilities land together and the causal link needs saying out loud.',
    do: 'Add the hero item to the bag.',
    watch: 'The row becomes "Complete the look" — nothing from the same category. A dimension read from the verb, not the item.',
    say: 'She stopped browsing and started deciding. That is a seventh dimension, and it is the only one not read off a product — it is read off what she did. So the page stops offering her more coats and starts completing the one she chose. It gained a section, not just different contents.',
    real: 'LIVE' },

  { n: 18, act: 2, cap: 'C33', title: 'An offer that cannot be extended', secs: 45,
    why: 'The anti-urgency-theatre argument. One beat, because the payoff is at expiry in beat 21.',
    do: 'Point at the offer band.',
    watch: 'A white-glove offer with a countdown. Service, not a discount.',
    say: 'That clock is not a marketing timer. It runs to the instant the engine calculates her intent crosses back under its threshold — so it cannot be extended, and when it ends it will tell you the number that ended it.',
    real: 'LIVE' },

  { n: 19, act: 2, cap: 'C11 · C19', title: 'Your merchandiser outranks it', secs: 45,
    why: 'Two governance points that answer the same objection; taking them together keeps the pace up.',
    do: 'Open the audience list, then toggle the hero pin.',
    watch: 'Audiences in the catalogue’s own words. Hero locks; explain reads "pinned · ranking skipped".',
    say: 'Nobody wrote these audiences. They are minted from your catalogue, in your merchandising language. And declared precedence — gates, then pins, then ranking. Your merchandiser outranks the machine, and the machine says so on the record.',
    real: 'LIVE' },

  { n: 20, act: 2, cap: 'C20', title: 'The refusal', secs: 60, mark: 'SLOW DOWN',
    why: 'The most persuasive thing the engine does. It is also the least expected, so it needs setup and silence.',
    do: 'Open the explain on an excluded item.',
    watch: 'Highest score. Refused. The rule named.',
    say: 'That is the engine declining a click it would have won. It scored highest, a rule said no, and it kept the score so you can see what it gave up. Showing you the refusal is worth more than showing you the win.',
    real: 'LIVE' },

  { n: 21, act: 2, cap: 'C10 · C33', title: 'Watch her leave', secs: 115, mark: 'THE BEAT NOBODY ELSE HAS',
    why: 'Measured at human pace with the real sequence: retreats land at 28s, 64s and 74s. 115 leaves ~40s of headroom so the presenter is never waiting on it in silence.',
    do: 'Stop touching it. Talk.',
    watch: 'Three separate retreats — hero at ~28s on category, row at ~64s on price band, story at ~74s on taste. Each names its dimension and its number. The offer ends and says why. The row returns to discovery.',
    say: 'Everyone demonstrates joining an audience. Watch her leave one. And it does not collapse at once — the hero goes first, on category, because what aisle she is in is the most perishable thing about her. Then the row, on price band. Taste goes last, because taste is the slowest thing about anyone. Nobody wrote an exit rule for any of that. It is the same arithmetic running backwards. … And there is the offer ending, naming the number that ended it.',
    real: 'LIVE' },

  { n: 22, act: 2, cap: 'C12', title: 'She came back', secs: 50,
    why: 'Short and factual. The danger here is overclaiming, so keep it tight.',
    arm: { returnVisit: true },
    do: 'Come back later — same visitor, new session.',
    watch: 'Dimensions, audiences and a personalized hero, restored.',
    say: 'She closed the tab and came back. No login, no cookie sync, nothing downloaded — the profile was held per visitor at the edge.',
    caution: 'DO NOT say "ODP is the memory". ODP is deliberately not connected on this surface. If asked: connect ODP and this becomes durable across devices and shareable with the rest of your stack — that is a credential, not a code change.',
    real: 'edge memory LIVE · ODP wired-dormant' },

  { n: 23, act: 2, cap: 'C34', title: 'I changed what we sell', secs: 95, mark: 'THE STRONGEST LINE',
    why: 'The act’s payoff. It needs the silence after it more than it needs the words in it.',
    arm: { vertical: 'financial' },
    do: 'Switch the business.',
    watch: 'The left panel does not change. Seven bars stay in place and re-label. Cold start recomputes from median home value at 80% LTV.',
    say: 'Same person. Same four surfaces. Same trail. I changed what we sell. Seven bars did not move — they were relabelled. Category became product family, taste became life stage, journey stage became application stage. You already know this customer. You just do not know him in this vocabulary yet.',
    real: 'LIVE' },

  // ── ACT 3 · the operator · 480s ────────────────────────────────────────────
  { n: 24, act: 3, cap: 'C21', title: 'Opal proposes', secs: 70,
    why: 'The room needs to read the generated rule, not just watch it appear.',
    arm: { vertical: 'retail' },
    do: 'Ask Opal in plain English.',
    watch: 'A real audience definition, its rule legible, built from the live registry.',
    say: 'A real model call against your own vocabulary. It cannot invent a dimension — the schema is built from the live registry, so an invented one is rejected before it reaches our code. And it proposed. It did not publish.',
    real: 'LIVE (US-only)' },

  { n: 25, act: 3, cap: 'C21', title: 'A person decides', secs: 50,
    why: 'The governance beat. Short, deliberate, and it answers the AI-safety question in the room.',
    do: 'Click Publish.',
    watch: 'It goes live. The page can target it.',
    say: 'That is the governance beat. The machine proposes, a person decides, and both are on the record with a name and a timestamp.',
    real: 'GATED — enabled' },

  { n: 26, act: 3, cap: 'C22', title: 'It cannot invent a scene', secs: 75,
    why: 'The anti-hallucination argument, made structurally rather than promised.',
    do: 'Type a request in words.',
    watch: 'A curated scene, our copy, engine-ranked products, and the provenance line.',
    say: 'The model’s only job is routing that sentence to one of eight approved scenes. It cannot invent one, because the schema is an enum. And it does not pick the products — the deterministic engine still ranks those.',
    real: 'LIVE' },

  { n: 27, act: 3, cap: 'C23', title: 'A stylist that cannot oversell', secs: 75,
    why: 'The second turn is the point. Budget enough for both turns and the refusal.',
    do: 'Ask for a look. Then correct it. Then ask for something we do not sell.',
    watch: 'Real catalogue pieces. The refinement repeats nothing. The refusal names what is missing.',
    say: 'Every id it can return is bound to your live catalogue, minus everything it has already shown — so repeating itself is not something it is asked to avoid, it is something it cannot represent. And when you ask for something you do not carry, it says so instead of substituting quietly.',
    real: 'LIVE' },

  { n: 28, act: 3, cap: 'C24', title: 'The product is real, the scene is styling', secs: 45,
    why: 'A caption beat. It exists to pre-empt "is that image real", so it must be unhurried and plain.',
    do: 'Point at the editorial hero.',
    watch: 'The product is the real product. The scene is an approved still.',
    say: 'The bag is your real product. The scene around it is styling, it is composed onto an approved still rather than generated, and the caption on screen says so.',
    real: 'LIVE' },

  { n: 29, act: 3, cap: 'C25', title: 'A real experiment, thirty seconds ago', secs: 80,
    why: 'Includes opening the Optimizely console. Allow for the tab switch and the page load.',
    do: 'Dispatch. Then open Optimizely and show it.',
    watch: 'Real flag, real rule, 50/50.',
    say: 'Created in the real project, thirty seconds ago. Not a mock, not a screenshot — that is your console.',
    real: 'LIVE' },

  { n: 30, act: 3, cap: 'C26 · C27', title: 'Bandits, and what I will not show you', secs: 85,
    why: 'The refusal to fake a lift chart is a credibility beat. It earns the time it takes.',
    do: 'Dispatch MAB, then CMAB.',
    watch: 'Both rules in Optimizely, with their attributes. CMAB traffic bandit-allocated, no manual split.',
    say: 'Both real, both in your project. What I will not do is show you a reallocation chart or a per-context winner, because those need traffic and this room will not generate any in forty-five minutes. Anyone showing you that curve on a stage is showing you a picture.',
    real: 'LIVE rules' },

  // ── ACT 4 · the business · 240s ────────────────────────────────────────────
  { n: 31, act: 4, cap: 'C28', title: 'The average lied', secs: 110, mark: 'THE BIGGEST WOW — SLOW RIGHT DOWN',
    why: 'Two filters and an arithmetic reveal. The dilution between them is the part that convinces, and it cannot be rushed.',
    do: 'Open Revenue Radar. Filter to premium. Then add mobile.',
    watch: 'Blended payment step looks like an ordinary week. Premium drops. Premium and mobile collapses — inside a tenth of traffic.',
    say: 'That is the number in your weekly report, and it looks like an ordinary week. Filter to premium and there is a real gap. Now add mobile — and it roughly doubles, inside under ten percent of sessions. That is precisely the condition under which an average lies: a severe failure in a small slice moves the blend by a few points. The average lied. The cohort told the truth.',
    real: 'compute LIVE · traffic SIMULATED' },

  { n: 32, act: 4, cap: 'C29', title: 'Launch the fix', secs: 80,
    why: 'The recoverable arithmetic is shown term by term, then a real object is created. Both need to be seen.',
    do: 'Launch the fix.',
    watch: 'The working, then a real flag with a real audience id targeted at the diagnosed cohort.',
    say: 'Sessions lost to the gap, times what an order is worth. Every term on screen. And the fix is a real experiment, targeted at a real audience built from the cohort we just diagnosed. The diagnosis is computed from simulated traffic and the lift figure is representative — you will compute yours from your own rows. The audience and the experiment are real objects in your project.',
    real: 'audience/flag LIVE · lift REPRESENTATIVE' },

  { n: 33, act: 4, cap: 'C30', title: 'We hand you the rows', secs: 50,
    why: 'The closing credibility move of the act. Plain, short, and unhedged.',
    do: 'Export.',
    watch: 'Warehouse rows: gates, scores, rank, tie-break hash, config version.',
    say: 'We hand you the rows. You compute the lift. We will never present our own uplift number as the proof.',
    real: 'LIVE' },

  // ── ACT 5 · the moment · 180s ──────────────────────────────────────────────
  { n: 34, act: 5, cap: 'C31', title: 'A signal we did not generate', secs: 35,
    why: 'The honesty label goes first, before the impressive part, or it reads as an excuse afterwards.',
    do: 'Point at the detection chip.',
    watch: 'SIMULATED · partner social-listening layer, not Optimizely.',
    say: 'This part is simulated and it is labelled, because we do not ship social listening. Everything after it is ours.',
    real: 'SIMULATED, labelled' },

  { n: 35, act: 5, cap: 'C31', title: 'Opal writes the moment', secs: 45,
    why: 'The elapsed counter is the point. Talk across it rather than watching it.',
    do: 'Trigger the moment.',
    watch: 'Elapsed counter running while Opal writes the creative.',
    say: 'Reading the signal, writing the moment. Talk across this — it takes about eight seconds and I want you watching the clock, not me.',
    real: 'LIVE' },

  { n: 36, act: 5, cap: 'C31', title: 'It ships as a real flag', secs: 50,
    why: 'The loop closing is the payoff. Name the elapsed time out loud.',
    do: 'Nothing.',
    watch: 'Full-bleed takeover. The loop closed in M:SS.',
    say: 'Signal to live creative, in the time we have been talking. And it is composed onto an approved still, not generated — the footer says so, because generating a photograph live invites exactly the question this beat exists to answer.',
    real: 'LIVE' },

  { n: 37, act: 5, cap: '—', title: 'What I did not show you', secs: 50,
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
