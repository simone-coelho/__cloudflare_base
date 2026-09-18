# W11.01 implementation clarifications

Recorded 2026-09-11 02:38:44 UTC before source GO. These specialize the approved plan; no broader scope/checks.

Use canonical quoted positive If-Match: "N" and Idempotency-Key: N:UUID. Embedding the expected revision prevents reusing one ID at another base without adding an operation index. Library-only initialization may use baselineRevision-1:UUID (including0), preserving the supplied validated baseline body/version; HTTP never initializes or recovers an initializing head. Initialization reserves head with committed:null, retains exact baseline intent, then writes immutable body/finalizes; exact same library input resumes failures.

Keep the serving cache (actual bucket identity+kind+tenant, read-start TTL<=30s and immutable returned snapshots); administration/publication reads bypass it. This avoids adding two R2 reads to every hot decision while preserving explicit bounded visibility. Never cache absence/error or refresh stale proof after failure. Below-floor history explicitly reports legacy_history_unavailable; non-catalog callers may surface publication failures as existing generic errors, never defaults.

Publication headers apply only actual catalog publication operations, not W14.03 enrichment proposal/review routes. Same typed canonical operator boundary may cover both. Import/pull descriptors bind operation kind, expected base, source/mode/input; explicit recovery never refetches. No initialization/cutover, deployment, egress or customer acceptance.
