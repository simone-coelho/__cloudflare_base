# Lane M3b — the visitor is kept at the mint; the panel draws from the action's own answer

Store lane, briefed by the lead on 2026-10-03 from two findings in lane S2's final report (docs/lg/lanes/P.md,
"### S2", the addendum). Lane M3 built the store's plumbing (`public/oh/oh-store.js`: the visitor's
persistence, `refreshSignals`, the events); this lane corrects two timings in it. It starts only after lane C3
has handed back `public/oh/oh-store.js` and `public/demo-kit/panels.js` (a strings-only pass); from then on
those two files are this lane's alone until it hands back.

## Finding 1 — a quick reload loses her

`ensure()` in `oh-store.js` mints her through `t.ensureVisitor()`, then **awaits the cold-start panel's load**
(`P().loadColdStart()`) inside the same promise, and only then calls `persist(v)`. So the browser keeps nothing
of her until the cold-start read has answered, which on the hosted worker is a second or more after the mint; a
real person who reloads inside that window comes back as a stranger. S2's hosted probe found no record four
seconds after a load in one of two rounds for this reason.

**Do:** persist the moment the mint answers (inside the `.then`, before the cold-start load, and again after it
if anything on the visitor changed that the record carries), and on every other path that sets visitor A
(the arrival of beat 1, the sign-in's swap: check each; `persist` is idempotent and compares before writing).
The resume path (`resume()`) is unchanged. Prove it: on the rig, a direct product load reloaded 200 ms after the
mint's response continues the same subject with no identity call (write the check as a small script in your
scratchpad driving Chrome through CDP, as the DOM suite does; the suite's own persistence walk, which reloads
after "decided live", stays green).

## Finding 2 — the panel waits for a read it does not need

After an event, `refreshSignals(answer, type)` reads her profile again (`GET /realtime/reflex` through the kit's
`renderVectors`) and redraws; the first click of a page also waits for the re-ask. So the panel's first movement
comes one engine round trip after the action's own answer (S2: 0.76 s idle on a rig, 1.1 to 1.2 s hosted,
2.1 s under load). The action's answer already carries the state after the event: on the hosted worker a
`POST /realtime/action` answers `{ success, message, update: { affinity: { dims, changed, … } }, signals,
sessionId, cookiesUpdated }`.

**Do:** draw the panel's dimension rows from `update.affinity.dims` the moment the answer lands, then let the
profile read run as today and confirm (the engine's reading is always the last word, so the suites' "panel
reads what the engine holds" and mutant X7 keep their meaning). In `public/demo-kit/panels.js`, `renderVectors`
takes an optional `dims` (and the `changed` list it already takes through `said`) and renders without fetching
when `dims` is given; without it, it fetches as today. First confirm, against the rig's engine and the hosted
worker's answer shape in S2's and the lead's notes, that `update.affinity.dims` is the same per-dimension shape
`GET /realtime/reflex` returns (`category: { washers: 0.64, … }`); if it is a subset or a different shape, map
it or skip the early draw for that event and say so. The receipts and the before/now strips stay on the read.
The re-ask path (`opts.reask`) gets the same early draw before the page's decisions are asked. Where the answer
carries no dims (a refused or buffered event), nothing is drawn early.

Prove it on the rig with the same CDP script: time from the Add to Cart click to the panel's first change,
before and after, ten presses each, and the same for the first product view of a fresh visitor; put both tables
in the report. The panel must still end at the engine's reading within the suites' two seconds, and S2's two
suites (`node scripts/rehearse-oh-dom.mjs --base http://localhost:9131`, `--only store`, and
`node scripts/rehearse-oh-page.mjs --base http://localhost:9131`) stay at 498 and 231 (or you name the line that
moved and why). Vantage uses the same `panels.js`: its two suites keep 115 and 298 (`docs/verizon/RESUME-vantage.md`
says how they run); the `dims` argument is optional and Vantage's calls do not pass it.

## Ownership and rules

- Yours, after C3's interim hand-back: `public/oh/oh-store.js` and the logic of `public/demo-kit/panels.js`
  (every string in both exactly as C3 left it). Not yours: `public/oh/oh.js` (lanes M1d and C3), `scripts/`
  (S2's suites are committed; if one needs a change, name the line and the reason), `src/` (lane E4), any
  governance file. Report as "### M3b" appended to `docs/lg/lanes/P.md`, and in this file below.
- The control checkout's working tree, with path ownership, as the page lanes do; other lanes' uncommitted
  lines stay exactly as they are. Never `git checkout`, `reset`, `stash`, `restore`, `switch`, `rm`, `rm -rf`;
  no installs, no process kills, no commit, no deploy, no push; a seed only with `--out` under your scratchpad.
- Rig: port 9131, state `.wrangler/state-m3`, from WSL (`node scripts/demo-kit/rig.mjs --config oh --port 9131
  --state .wrangler/state-m3`, with `--prepare` the first time if the state is gone, then the seed with `--out`
  and the region seed); stop it when done without killing other processes.
- Hand back a consistent state: both files parse (`node --check`), the pages load at 1440 and 390 with no script
  error, the counts above. Report the two timing tables, the files with line deltas, and anything left.
