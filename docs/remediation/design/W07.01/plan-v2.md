# W07.01 — plan v2: evidence-class correction only

Supersedes plan-v1.md for contract 7092d0d7077f844850c745b7061c08fb6b6f22e9f2a10f71803b70d244509cb0. All scope, baseline, ownership, authority, rollback, actual implementation and K1/K2/K3 requirements in [plan-v1.md](plan-v1.md) remain in force.

C2 requires both integration_test and design_review. The board limits design_review to source_confirmed, so its previous shared local_synthetic floor was mechanically impossible. Set only that common floor to source_confirmed. K1 and K2 remain required empirical local checks, with their runtime/workload unchanged; K3 still independently reviews source and reruns them. No skipped check, weaker behavior requirement, extra test or implementation change is authorized by this correction.

Seven production edits already landed under v1; worker pauses fixture edits while lead records this correction and new start. Preserve v1 approval, original exact contract and all prior work. The v1 empty artifact placeholder was also corrected in the live tracker to not_recorded/null before evidence; this did not affect the task contract.
