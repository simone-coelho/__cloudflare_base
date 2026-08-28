// src/demos/meridian/build-talk-track.mjs
//
// Generates docs/opticon/Opticon-Talk-Track.md from public/meridian/beats.js.
//
// GENERATED, not written. A talk track maintained by hand drifts from the
// director within a day, and then the printed page in the presenter's hand
// disagrees with the bar on the screen — which is worse than having no printout
// at all. One source, two renderings.
//
//   node src/demos/meridian/build-talk-track.mjs

import { writeFileSync } from 'node:fs';
import { BEATS, ACTS, pacingCheck } from '../../../public/meridian/beats.js';

const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const pacing = pacingCheck();
const drift = pacing.filter((p) => !p.ok);
if (drift.length) {
  console.error('Refusing to generate: act budgets do not match beat durations.');
  for (const d of drift) console.error(`  act ${d.act} ${d.name}: planned ${d.planned}s, beats ${d.sum}s`);
  process.exit(1);
}

const out = [];
out.push('# Opticon — Talk Track');
out.push('');
out.push('**GENERATED from `public/meridian/beats.js`. Do not edit by hand — run `node src/demos/meridian/build-talk-track.mjs`.**');
out.push('');
out.push('Print this. The director bar on screen shows the room the beat and what to watch; it deliberately does *not* show your script unless you open it with `?prompter=1`. This page is the script.');
out.push('');
out.push('## Pacing');
out.push('');
out.push('| Act | | Planned | Beats |');
out.push('|---|---|---|---|');
for (const p of pacing) {
  out.push(`| ${p.act} | ${p.name} | ${mmss(p.planned)} | ${mmss(p.sum)} |`);
}
out.push(`| | **Total** | **${mmss(pacing.reduce((n, p) => n + p.planned, 0))}** | |`);
out.push('');
out.push('---');
out.push('');

let currentAct = null;
for (const b of BEATS) {
  if (b.act !== currentAct) {
    currentAct = b.act;
    const a = ACTS.find((x) => x.n === b.act);
    out.push(`## Act ${a.n} — ${a.name} · ${a.mins} min`);
    out.push('');
    if (a.note) out.push(`*${a.note}*`);
    out.push('');
  }
  out.push(`### ${b.n}. ${b.title}`);
  out.push('');
  out.push(`**${mmss(b.secs)}** · ${b.cap} · ${b.real}`);
  if (b.mark) out.push(`> ### ⏸ ${b.mark}`);
  out.push('');
  out.push(`**You do —** ${b.do}`);
  out.push('');
  out.push(`**They watch —** ${b.watch}`);
  out.push('');
  if (b.caution) {
    out.push(`> ⚠️ **${b.caution}**`);
    out.push('');
  }
  out.push(`**You say —** ${b.say}`);
  out.push('');
  out.push(`*Why ${mmss(b.secs)}:* ${b.why}`);
  out.push('');
  out.push('---');
  out.push('');
}

out.push('## The marked beats, in one place');
out.push('');
out.push('If you are running short, these are the ones that do not get compressed.');
out.push('');
for (const b of BEATS.filter((x) => x.mark)) {
  out.push(`- **${b.n}. ${b.title}** — ${b.mark} *(${mmss(b.secs)})*`);
}
out.push('');
out.push('## Every caution');
out.push('');
for (const b of BEATS.filter((x) => x.caution)) {
  out.push(`- **Beat ${b.n}, ${b.title}:** ${b.caution}`);
}
out.push('');

writeFileSync('docs/opticon/Opticon-Talk-Track.md', out.join('\n'));
console.log(`Wrote docs/opticon/Opticon-Talk-Track.md — ${BEATS.length} beats, ${mmss(pacing.reduce((n, p) => n + p.planned, 0))} total.`);
