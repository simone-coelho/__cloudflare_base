# Current checkpoint

**The law:** `AGENTS.md` on this branch, `tools/closure-ledger/BOOTSTRAP-MEMO.md`, then `check`, `status`, `next`. This file stays a few lines; earlier checkpoints are in its git history.

## 2026-10-08 (evening), the parity programme frozen; P02 active

- **Remediation** (`status`): Local engineering done 26/26 · Final/live accepted 0/26 · no ticket active · `check` PASS. Rulings: `_evidence/step3/AMENDMENTS.md`.
- **Parity `tapestry-parity-build`** frozen at 5ebf84b7 on the owner's "yes to all" (54 items, recorded under "Owner answers" in `docs/parity/authority/BTI-Parity-Freeze-Sheet.md`): Local done 0/25 · Final 0/25 · `check` PASS · P02 ACTIVE. The P02 build runs in `/home/simonecoelho/rem/build-p02-2` (`rem/p02-build-2` from `rem/tkt/P02`, hard-linked `node_modules`, merging `rem/integration` first); work order, brief and evidence under `_evidence/parity-step3/P02/`. Rulings R-P1 to R-P39 and every reviewer condition: `_evidence/parity-step3/AMENDMENTS.md`. Order of work after P02: P01 P28 P03 P10 P07 P04 P29 P31 P05 P06 P12 P13 P34 P30 P33 P32 P09 P11 P14 P35 P08 P15 P16 P26, one ACTIVE at a time.
- **Owed work, none blocking:** W41 residuals; R-P8; kit 02's silence on by-value replay comparison; pronouns in gate-pinned unit files (R-P30); items 31 (baseline shrink) and 33 (landing lane), approved at the freeze, scheduled by the lead after P02.
- **Worktrees:** every WSL lane under `/home/simonecoelho/rem/` is locked and never pruned; inventory in the bootstrap, section 9.
- **Bootstrap for a new lead session:** `docs/remediation/BOOTSTRAP-LEAD.md` in the owner tree (copy `/home/simonecoelho/rem/_evidence/BOOTSTRAP-LEAD.md`); lead tools under `/home/simonecoelho/rem/_evidence/_lead-tools/` (`receipts/parity-state.cjs <P> <ACTIVE|INACTIVE>` changes a parity ticket's routing state). The lead session of 2026-10-08 evening runs inside WSL, so its own commands need no wsl.exe hand-off.
