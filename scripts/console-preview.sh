#!/usr/bin/env bash
# scripts/console-preview.sh
# ---------------------------------------------------------------------------
# The operator console, running on this machine, with enough real data in it to
# be worth looking at. One command, then a URL and a sign-in.
#
#   bash scripts/console-preview.sh
#
# It starts a worker of its own on port 9200, on its own store, so nothing it
# does touches the dev server anyone else is running or the data they are using.
# Then it seeds a brand the way the holdout proof does: a content catalog, four
# slots, a half-and-half holdout with both arms, sixty visitors decided, clicks
# on some of them, and a day report built from the ledger. That is what fills
# the grid, the work queue, measurement and history.
#
# It takes about three minutes, most of it waiting for the ledger queue to
# drain, and it says where it is the whole way. Ctrl-C stops it; the worker is
# stopped for you on the way out.
# ---------------------------------------------------------------------------
set -u
cd "$(dirname "$0")/.."

PORT="${PORT:-9200}"
SCOPE="${SCOPE:-holdout-proof}"
STATE=".wrangler/console-preview"
LOG="$STATE/worker.log"
EMAIL="ops@local.test"
PASSWORD="local-pass-1234"

if [ -n "$(lsof -t -i :$PORT 2>/dev/null)" ]; then
  echo "Port $PORT is already in use. Stop what is on it, or run: PORT=9201 bash scripts/console-preview.sh"
  exit 1
fi
if ! grep -q "\"$SCOPE\"" .dev.vars 2>/dev/null; then
  echo "The brand '$SCOPE' is not provisioned in .dev.vars, so its outcomes would be filed under coach."
  echo "Add it to the TENANTS line there, or run with a brand that is: SCOPE=coach bash scripts/console-preview.sh"
  exit 1
fi

mkdir -p "$STATE"
cleanup() {
  echo
  echo "▸ Stopping the preview worker."
  for pat in "cli\.js dev --port $PORT" "entry=localhost:$PORT"; do
    for p in $(pgrep -f "$pat"); do kill -TERM "$p" 2>/dev/null; done
  done
}
trap cleanup EXIT INT TERM

echo "▸ Starting a worker on port $PORT, on its own store ($STATE)."
npx wrangler dev --port "$PORT" --inspector-port "$((PORT + 100))" --persist-to "$STATE" > "$LOG" 2>&1 &
for i in $(seq 1 60); do
  sleep 2
  if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/health" 2>/dev/null)" = "200" ]; then break; fi
  if [ "$i" = "60" ]; then echo "The worker did not come up. Its log is $LOG"; exit 1; fi
done
echo "  up."

# An operator to sign in as. Open registration is closed, and rightly: an account
# is created by an admin, comes with a temporary password, and that password is
# changed at the first sign-in. This does all three, the same way a person would,
# through the routes and never through the store. The admin token is minted from
# the dev JWT settings in wrangler.toml, which is what every local script here does.
node scripts/console-operator.mjs "http://localhost:$PORT" "$EMAIL" "$PASSWORD" || {
  echo "  Could not set up the operator. The console will open read only, which is still worth a look."
}

echo "▸ Seeding $SCOPE: a catalog, four slots, sixty visitors, their clicks, and a day report."
echo "  This is the slow part, about three minutes, most of it waiting for the ledger to drain."
node scripts/holdout-proof.mjs "http://localhost:$PORT" --scope "$SCOPE" 2>&1 | sed 's/^/  /'

cat <<EOF

──────────────────────────────────────────────────────────────────────────────
  The console is running. Open this:

      http://localhost:$PORT/console/#/work?scope=$SCOPE

  Sign in at the top right with
      email     $EMAIL
      password  $PASSWORD

  Ten screens in the left rail. The ones with the most in them:
      What it has learned   the grid, paged by the server; click a piece's name
                            to open the contexts it was shown in
      Measurement           the holdout over a window, with the interval and
                            the targets
      Interests             what used to be /tuning.html
      History               who changed what, on every document

  The two older pages are still there and still work, at /tuning.html and
  /learning.html, linked at the bottom of the rail.

  Leave this terminal open. Ctrl-C here stops the worker.
──────────────────────────────────────────────────────────────────────────────

EOF
# Hold the worker open until the operator is done looking.
while true; do sleep 3600; done
