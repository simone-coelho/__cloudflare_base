# Evidence files

Transcripts of hosted runs that the Vantage documents cite as measured. Each file is the unedited output of
the named script against the named host; the figures in `docs/verizon/explainer/FACTS.md` §12, the technical
note and the interactive page trace to lines in these files (lane W1's note, `../W1.md` §4, maps each cited
figure to its line).

| File | Script | Host | Run (local time) | Result |
|---|---|---|---|---|
| `suite-page-hosted-2026-10-01.txt` | `scripts/rehearse-vantage-page.mjs` | `edge-platform-vantage.expedge.workers.dev` | 2026-10-01 11:22 | 112 of 112 |

The suite asserts New York from beat 3 onward ("back in New York" in the transcript), so every figure after
the first touch is a New York-prior figure; the real-region arrival figures come from lane F3's hosted table
(`../F3.md` §3). No file here carries a token, a session id or a person's data; the suite's own checks confirm
that none was served.
