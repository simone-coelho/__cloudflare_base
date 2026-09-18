# W01.02 episode 3 — worker revalidation

Worker `w0202-worker`, run `/root/w0202_impl`, gpt-6-astra/xhigh. Evidence-only release: seq69, 2026-09-07T02:21:29.026Z. Read the admitted current task C1–C3 and complete plan-v3 (SHA256 `30c318176001f8ac1f6315f070e978b0879af2774b5274c1856df631ffcd9493`); contract `cfcf38ed052aa9348d113240d6bdaff626e811e4938033077025a1c2e0ffaeb5`.

Command: `node node_modules/vitest/vitest.mjs run src/index.api-boundary.test.ts --maxWorkers=1 --minWorkers=1`.

Invoked **2026-09-07T02:22:01.300Z**; completed process collected **2026-09-07T02:22:19.780Z**. Exit **0**, **20/20 tests passed**, duration **13.61 seconds**. Runner start: 22:22:03 America/New_York, September 6. [Complete output](worker-k1-v3.log), SHA256 `e30f1a140a4fc92380cc667d14a5073b3c18508aa9ba8aee217a4e3fe27f7799`, matches the captured output byte-for-byte. The Vite CJS deprecation warning is retained; no failed or skipped tests.

The unchanged suite exercises **400 denied probes** and **11 retained controls**, including invalid-credential controls—not 11 successful responses. The default Worker export runs in local workerd against synthetic working adapters. Denials cover the ten former raw operations, HEAD/OPTIONS, normalized-path, method/auth and upgrade variants, asserting no environment/binding/destination/logging effects. Retained api-info, health, real JWT account and independently SDK-authorized scoped-state routes remain checked.

Pre/post execution identities agree: `src/index.ts` SHA256 `840a34f2ebe134ed3e584870b03034f7bef2c1c9c8203123791546c42419aac7`; focused test SHA256 `fa0226efd8c6cf5aef7cead7ca20c2a202c56eb3df73fb455dca9274319bf997`. `src/routes/api.ts` remains absent. Only this report and the fresh log were written; historical evidence, source and tests were untouched.

Worker artifacts are frozen, with no pending worker processes. Root owns the rebuilt complete manifest; the independent reviewer owns fresh K1 execution, versioned artifact checking and the composed retained-original index/api replay. This is not independent acceptance, a complete original-dependency replay, deployed/native-resource/assets/customer/SLO/release or full W01 perimeter approval. No live credentials/data/configuration, external network, operational tools, deployment, installation, seed, git mutation or extra W02 checks were used. Lead acceptance remains pending independent review.
