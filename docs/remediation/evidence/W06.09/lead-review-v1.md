# W06.09 in-progress source correction

Lead w01-lead (/root), recorded 2026-09-08 22:11:50 UTC. Independent Astra/xhigh reviewer /root/w0609_review inspected the actual implementation before frozen acceptance.

The first v4 extraSteps variant included canonical sessions already captured by base.sessions. Although session discovery skipped those duplicates, extra identity cleanup could delete the canonical base SID before base cleanup. This violates the approved base-last intent and spends duplicate cleanup steps.

Lead returned this for in-contract correction: v4 extra canonical sessions execute only when absent from the frozen base; same-SID tuples must match exactly. Use the same derivation in page validation, cleanup and receipts. Retain v3 exclusion and the absent-base/unlisted canonical SID remedy. Extend the existing v4 case to assert the canonical base SID remains throughout extra_cleanup; no new suite or scope. Retain prior command results before final corrected validation. This record is not acceptance.
