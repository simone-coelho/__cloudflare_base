#!/usr/bin/env bash
# scripts/console-preview.sh
# ---------------------------------------------------------------------------
# The operator console, running on this machine, with enough real data in it to
# be worth looking at.
#
#   bash scripts/console-preview.sh          start it (or tell you it is up)
#   bash scripts/console-preview.sh status   is it up, and is it signed-in-able
#   bash scripts/console-preview.sh stop     stop it
#
# It leaves the worker RUNNING and returns your prompt. It does not hold the
# terminal: a terminal that closes used to take the worker with it, which is
# exactly how an operator ends up clicking at a server that is no longer there.
#
# It starts a worker of its own on port 9200, on its own store, so nothing it
# does touches the dev server anyone else is running or the data they are using.
#
# THE STEP THAT WAS MISSING. It applies the D1 migrations to that store first.
# Without them POST /auth/login answers 500 ("no such table: operator_audit"),
# which reads on screen as a sign-in that will not take and screens that never
# fill. The store is the preview's own, so this is safe to repeat.
#
# Then it seeds a brand the way the holdout proof does: a content catalog, four
# slots, a half-and-half holdout with both arms, sixty visitors decided, clicks
# on some of them, and a day report built from the ledger. That is what fills
# the grid, the work queue, measurement and history. Seeding is skipped if the
# brand already holds a learn document, so starting it again takes seconds.
# ---------------------------------------------------------------------------
set -u
cd "$(dirname "$0")/.."

PORT="${PORT:-9200}"
SCOPE="${SCOPE:-holdout-proof}"
STATE=".wrangler/console-preview"
LOG="$STATE/worker.log"
EMAIL="ops@local.test"
PASSWORD="local-pass-1234"
DB="coach-demo-db"
CMD="${1:-start}"

health() { curl -s -m 3 -o /dev/null -w '%{http_code}' "http://localhost:$PORT/health" 2>/dev/null; }
signin() {
  local preview_response
  preview_response="$(curl -fsS -m 10 -w '\n%{http_code}' -X POST "http://localhost:$PORT/auth/login" -H 'content-type: application/json' -H "X-Tenant: $SCOPE" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" 2>/dev/null)" || return 1
  [ "${preview_response##*$'\n'}" = "200" ] || return 1
  printf '%s' "${preview_response%$'\n'*}"
}

stop_it() {
  local found=""
  for pat in "cli\.js dev --port $PORT" "entry=localhost:$PORT" "wrangler dev --port $PORT"; do
    for p in $(pgrep -f "$pat" 2>/dev/null); do kill -TERM "$p" 2>/dev/null && found="yes"; done
  done
  for p in $(lsof -t -i :$PORT 2>/dev/null); do kill -TERM "$p" 2>/dev/null && found="yes"; done
  [ -n "$found" ] && echo "Stopped the preview on port $PORT." || echo "Nothing was running on port $PORT."
}

case "$CMD" in
  stop) stop_it; exit 0 ;;
  status)
    if [ "$(health)" = "200" ]; then
      echo "Worker:   up on http://localhost:$PORT"
      if echo "$(signin)" | grep -q accessToken; then echo "Sign-in:  works ($EMAIL)";
      else echo "Sign-in:  BROKEN -> $(signin | head -c 200)"; fi
      echo "Open:     http://localhost:$PORT/console/#/work?scope=$SCOPE"
    else
      echo "Worker:   not running. Start it with: bash scripts/console-preview.sh"
    fi
    exit 0 ;;
esac

# Already up and healthy? Then say so rather than fight over the port.
if [ "$(health)" = "200" ]; then
  echo "▸ Already running on port $PORT."
  if ! echo "$(signin)" | grep -q accessToken; then
    echo "  Sign-in is refusing, so applying the migrations to its store."
    npx wrangler d1 migrations apply "$DB" --local --persist-to "$STATE" > /dev/null 2>&1 \
      || for f in migrations/*.sql; do npx wrangler d1 execute "$DB" --local --persist-to "$STATE" --file="$f" > /dev/null 2>&1; done
    node scripts/console-operator.mjs "http://localhost:$PORT" "$EMAIL" "$PASSWORD"
  fi
  echo
  echo "  http://localhost:$PORT/console/#/work?scope=$SCOPE   ($EMAIL / $PASSWORD)"
  exit 0
fi

if [ -n "$(lsof -t -i :$PORT 2>/dev/null)" ]; then
  echo "Port $PORT is in use by something that is not answering /health."
  echo "Stop it with: bash scripts/console-preview.sh stop     (or run with PORT=9201)"
  exit 1
fi
if ! grep -q "\"$SCOPE\"" .dev.vars 2>/dev/null; then
  echo "The brand '$SCOPE' is not provisioned in .dev.vars, so its outcomes would be filed under coach."
  echo "Add it to the TENANTS line there, or run with a brand that is: SCOPE=coach bash scripts/console-preview.sh"
  exit 1
fi

mkdir -p "$STATE"

# 1. The tables, before anything asks for them.
echo "▸ Applying the D1 migrations to the preview store."
npx wrangler d1 migrations apply "$DB" --local --persist-to "$STATE" > "$STATE/migrate.log" 2>&1 || {
  echo "  (migrations apply did not run; applying the files in order instead)"
  for f in migrations/*.sql; do
    npx wrangler d1 execute "$DB" --local --persist-to "$STATE" --file="$f" >> "$STATE/migrate.log" 2>&1
  done
}
echo "  done."

# 2. The worker, detached, so it outlives this terminal.
echo "▸ Starting a worker on port $PORT, on its own store ($STATE)."
setsid nohup npx wrangler dev --port "$PORT" --inspector-port "$((PORT + 100))" \
  --persist-to "$STATE" > "$LOG" 2>&1 < /dev/null &
for i in $(seq 1 60); do
  sleep 2
  [ "$(health)" = "200" ] && break
  if [ "$i" = "60" ]; then echo "The worker did not come up. Its log is $LOG"; exit 1; fi
done
echo "  up."

# 3. An operator to sign in as. Open registration is closed, and rightly: an
# account is created by an admin, comes with a temporary password, and that
# password is changed at the first sign-in. This does all three the way a person
# would, through the routes and never through the store.
node scripts/console-operator.mjs "http://localhost:$PORT" "$EMAIL" "$PASSWORD" || {
  echo "  Could not set up the operator. The console will open read only, which still shows most screens."
}

# 4. The data, unless it is already there.
if ! preview_login="$(signin)"; then
  echo "Could not authenticate the preview; refusing to seed." >&2
  exit 1
fi
if ! preview_token="$(printf '%s' "$preview_login" | node -e '
  try {
    const token = JSON.parse(require("node:fs").readFileSync(0, "utf8")).accessToken;
    if (typeof token !== "string" || !token.trim() || /[\r\n]/.test(token)) process.exit(1);
    process.stdout.write(token);
  } catch { process.exit(1); }
')"; then
  echo "Preview sign-in did not return an access token; refusing to seed." >&2
  exit 1
fi
unset preview_login
if ! preview_document="$(curl -fsS -m 10 -w '\n%{http_code}' --get --data-urlencode "scope=$SCOPE" "http://localhost:$PORT/content/learn" \
  -H "Authorization: Bearer $preview_token" -H "X-Tenant: $SCOPE" 2>/dev/null)"; then
  echo "Could not read the authenticated learn document; refusing to seed." >&2
  exit 1
fi
if [ "${preview_document##*$'\n'}" != "200" ]; then
  echo "Learn document HTTP status was not successful; refusing to seed." >&2
  exit 1
fi
preview_document="${preview_document%$'\n'*}"
if ! preview_source="$(printf '%s' "$preview_document" | node -e '
  try {
    const source = JSON.parse(require("node:fs").readFileSync(0, "utf8")).source;
    if (source !== "stored" && source !== "compiled-default") process.exit(1);
    process.stdout.write(source);
  } catch { process.exit(1); }
')"; then
  echo "Learn document JSON/source was not recognized; refusing to seed." >&2
  exit 1
fi
unset preview_document
if [ "$preview_source" = "stored" ]; then
  echo "▸ $SCOPE is already seeded, so skipping the slow part."
else
  echo "▸ Seeding $SCOPE: a catalog, four slots, sixty visitors, their clicks, and a day report."
  echo "  About three minutes, most of it waiting for the ledger queue to drain."
  if ! OPERATOR_TOKEN="$preview_token" node scripts/holdout-proof.mjs "http://localhost:$PORT" --scope "$SCOPE"; then
    echo "Preview seeding failed." >&2
    exit 1
  fi
fi

cat <<EOF

──────────────────────────────────────────────────────────────────────────────
  The console is running, and it stays running when you close this terminal.

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

  Is it up?   bash scripts/console-preview.sh status
  Stop it     bash scripts/console-preview.sh stop
──────────────────────────────────────────────────────────────────────────────

EOF
