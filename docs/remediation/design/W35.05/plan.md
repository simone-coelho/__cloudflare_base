# W35.05 — Generation-bound prepared identity transfer

## Scope

Fix one remaining DO-authority resurrection path. A source transfer can remain prepared after target merge/publication failure; target reset, operator erasure or retention then rotates the durable grant epoch and removes receipts; retry currently treats the old frozen payload as a first transfer, recreates the erased profile and issues a recognized grant in the new epoch.

Before a source persists its first prepared transfer, it must obtain the target object's current durable authority epoch through an internal serialized admission operation. A genuinely cold or validated pre-authority target may initialize one empty authority record once; missing authority beside any receipt, rotation, transfer, forward or other barrier marker fails closed. The epoch becomes part of the immutable transfer descriptor and fingerprint. The target must require the exact current epoch before any merge, receipt, grant or compatibility publication. A prepared transfer never reacquires or rewrites its epoch on retry. Missing/malformed legacy prepared records fail closed for reconciliation.

Reset, internal erasure and retention already rotate the epoch atomically in W35.04. A new link prepared after that barrier may bind the new epoch; an older prepared transfer may not. Preserve successful and ambiguous-write recovery, current consent intersection, exact receipt-bound grants, W35.03 serialization and W35.04 per-grant fencing.

## Ownership and checks

The sole implementer owns:

- `src/durable-objects/ShopperReflex.ts`
- `src/routes/realtime.sdkContract.test.ts`
- `docs/remediation/evidence/W35.05/worker.json`

C1: A prepared transfer bound to an earlier target epoch cannot recreate behavior, receipts, members or recognized authority after target reset, operator erasure or retention, including restart and delayed retry.

C2: Target epoch acquisition and transfer admission are serialized. One validated cold/pre-authority target may initialize empty authority; missing authority beside prior transition/barrier markers and corrupt/mismatched authority fail closed. The persisted source descriptor/fingerprint is immutable and cannot rebind; a genuinely new post-barrier source can link under the new epoch.

C3: Existing successful link, lost/ambiguous acknowledgement, consent, grant, restart and W35.04 revocation controls remain green on exact final bytes.

Focused runtime only:

`node node_modules/vitest/vitest.mjs run src/routes/realtime.sdkContract.test.ts -t 'W35[.]05|W35[.]04|W35[.]03' --maxWorkers=1 --minWorkers=1`

Static: existing no-emit compiler; ESLint and `git diff --check` on the two owned TS files. No broad suite.

## Rollback and limits

Rollback is a reviewed inverse on the recorded before bytes and must account for the new persisted transfer field; an older binary must not silently reinterpret it. Preserve unrelated dirty work. This closes target resurrection by previously prepared transfers only. It does not discover or erase an unpublished source copy, prove exhaustive subject discovery, add session-host revocation, choose production cutover/migration, deploy, operate on customer data, or establish browser/customer/SLO/release acceptance or full W35/F14/F06 closure.
