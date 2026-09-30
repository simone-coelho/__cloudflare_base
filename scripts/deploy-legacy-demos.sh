#!/usr/bin/env bash
# scripts/deploy-legacy-demos.sh
# ──────────────────────────────────────────────────────────────────────────
# Deploys the SHARED demo worker, edge-platform.expedge.workers.dev, exactly as
# Coach, Bright Hour and Meridian were built and rehearsed on it: commit 26e2db1,
# the version live on 2026-08-30.
#
# NEVER deploy that worker from the repo root with `npx wrangler deploy`. That
# ships today's code, and today's code cannot run those three demos:
#   • it requires a shopper session on every shopper call, and the Coach
#     storefront and Bright Hour pages never create one;
#   • under AUTH_MODE=enforced it deliberately answers 404 for /meridian/api,
#     /live/api, /geo/cohort, /ai, /agents, /experiment, /signals and /funnel.
# That is exactly how all three broke on 2026-09-23. The Top Offers demo, which
# needs today's code, has its own worker: scripts/build-top-offers-config.mjs.
#
# Two things differ from a plain deploy of 26e2db1, both forced by that incident:
#   1. Migrations v6 and v7 were applied to this worker by the newer code, and
#      migrations only move forward, so Cloudflare refuses any version without
#      the classes they created (RegionTrend, DecisionRing, LearnStats). The
#      entry below adds empty stand-ins for them. Nothing is deleted.
#   2. JWT_SECRET is a plain [vars] value in 26e2db1. If a secret of that name
#      exists on the worker, the deploy is refused; delete the secret first.
#
#   bash scripts/deploy-legacy-demos.sh            # build only (dry run)
#   bash scripts/deploy-legacy-demos.sh --dev      # run it locally on :9100
#   bash scripts/deploy-legacy-demos.sh --deploy   # build and deploy
#
# --dev exists because `npm run dev` runs TODAY's code, which cannot run these
# three demos either. It uses the repo's own .dev.vars and persistent local state,
# which needs the D1 seed once (see docs/demos/BOOTSTRAP.md) for Meridian's cold start.
set -euo pipefail

COMMIT=26e2db1
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/legacy-demos-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

git -C "$ROOT" archive "$COMMIT" | tar -x -C "$WORK"
ln -s "$ROOT/node_modules" "$WORK/node_modules"   # runtime dependencies are identical at $COMMIT

cat > "$WORK/demo-entry.ts" <<'TS'
// The August 30 demo worker, redeployed exactly, plus three empty classes that
// satisfy migrations v6 and v7. The demos never bind them.
export * from './src/index';
export { default } from './src/index';

class Retired {
  constructor(_state: unknown, _env: unknown) {}
  async fetch(): Promise<Response> { return new Response('retired on this worker', { status: 410 }); }
}
export class RegionTrend extends Retired {}
export class DecisionRing extends Retired {}
export class LearnStats extends Retired {}
TS

python3 - "$WORK/wrangler.toml" <<'PY'
import io, sys
p = sys.argv[1]; s = io.open(p, encoding='utf-8').read()
assert s.count('main = "src/index.ts"') == 1, 'unexpected wrangler.toml at the pinned commit'
s = s.replace('main = "src/index.ts"', 'main = "demo-entry.ts"')
i = s.index('tag = "v5"'); j = s.index('\n\n', i)
s = s[:j] + ('\n\n[[migrations]]\ntag = "v6"\nnew_sqlite_classes = ["RegionTrend"]'
             '\n\n[[migrations]]\ntag = "v7"\nnew_sqlite_classes = ["DecisionRing", "LearnStats"]') + s[j:]
io.open(p, 'w', encoding='utf-8').write(s)
PY

[ -f "$ROOT/.dev.vars" ] && ln -s "$ROOT/.dev.vars" "$WORK/.dev.vars"

cd "$WORK"
if [ "${1:-}" = "--dev" ]; then
  echo "legacy demos ($COMMIT) on http://localhost:9100 — /storefront, /live/, /meridian/, /visual-demo.html"
  # The repo's own persistent local state, so the local D1 seed survives between runs.
  npx wrangler dev --port 9100 --persist-to "$ROOT/.wrangler/state"
elif [ "${1:-}" = "--deploy" ]; then
  if npx wrangler secret list --name edge-platform 2>/dev/null | grep -q '"JWT_SECRET"'; then
    echo "refusing: a JWT_SECRET secret exists on edge-platform and $COMMIT defines it as a plain var." >&2
    echo "delete it first: npx wrangler secret delete JWT_SECRET --name edge-platform" >&2
    exit 1
  fi
  npx wrangler deploy
  echo "deployed $COMMIT to edge-platform. Verify the APIs, not the pages:"
  echo "  MERIDIAN_BASE=https://edge-platform.expedge.workers.dev node scripts/meridian-rehearsal.mjs"
  echo "  MERIDIAN_BASE=https://edge-platform.expedge.workers.dev node scripts/meridian-isolation.mjs"
else
  npx wrangler deploy --dry-run --outdir "$WORK/.build"
  echo "dry run OK for $COMMIT. Re-run with --deploy to ship it."
fi
