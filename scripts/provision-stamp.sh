#!/usr/bin/env bash
# scripts/provision-stamp.sh — create an environment's own resources, fill the ids into wrangler.toml,
# apply the migrations, set the secrets, and seed the first admin. No prompts: every value is generated
# and the two a person must keep are printed once at the end, the site key and the admin's password.
#
#   bash scripts/provision-stamp.sh production --admin-email you@brand.test [--tenant coach]
#
# Run once per environment by a person with Cloudflare account access (wrangler logged in). Re-running
# reports "already exists" for what exists and continues. Staging was provisioned by the older
# provision-staging.sh with its own resource names; this script names resources edge-platform-*-<env>.
set -euo pipefail
cd "$(dirname "$0")/.."
ENV="${1:?environment name, e.g. production}"; shift
ADMIN_EMAIL=""; TENANT="coach"
while [ $# -gt 0 ]; do case "$1" in --admin-email) ADMIN_EMAIL="$2"; shift 2;; --tenant) TENANT="$2"; shift 2;; *) echo "unknown argument $1"; exit 2;; esac; done
[ -n "$ADMIN_EMAIL" ] || { echo "pass --admin-email"; exit 2; }

id32() { grep -o '[0-9a-f]\{32\}' | head -1; }
id36() { grep -o '[0-9a-f-]\{36\}' | head -1; }
rand() { node -e "console.log(require('crypto').randomBytes($1).toString('base64url'))"; }

echo "▸ KV namespaces"
CACHE_ID=$(npx wrangler kv namespace create CACHE --env "$ENV" 2>&1 | tee /dev/stderr | id32 || true)
SESSIONS_ID=$(npx wrangler kv namespace create SESSIONS --env "$ENV" 2>&1 | tee /dev/stderr | id32 || true)

echo "▸ R2 bucket"
npx wrangler r2 bucket create "edge-platform-storage-$ENV" 2>&1 | tee /dev/stderr || true

echo "▸ Queue"
npx wrangler queues create "events-$ENV" 2>&1 | tee /dev/stderr || true

echo "▸ D1 database"
D1_ID=$(npx wrangler d1 create "edge-platform-db-$ENV" 2>&1 | tee /dev/stderr | id36 || true)

if [ -n "${CACHE_ID:-}" ] && [ -n "${SESSIONS_ID:-}" ] && [ -n "${D1_ID:-}" ]; then
  sed -i "s#<$ENV-cache-kv-id>#$CACHE_ID#; s#<$ENV-sessions-kv-id>#$SESSIONS_ID#; s#<$ENV-d1-id>#$D1_ID#" wrangler.toml
  echo "▸ wrangler.toml: $ENV ids filled"
else
  echo "▸ Some ids could not be read (a resource may already exist). Fill the <$ENV-…> placeholders in wrangler.toml by hand, then re-run."
  grep -q "<$ENV-" wrangler.toml && exit 1
fi

echo "▸ D1 migrations"
npx wrangler d1 migrations apply "edge-platform-db-$ENV" --env "$ENV" --remote

echo "▸ Secrets, generated"
SITE_KEY=$(rand 24)
printf '%s' "$(rand 48)" | npx wrangler secret put JWT_SECRET --env "$ENV" >/dev/null
printf '%s' "$(rand 32)" | npx wrangler secret put IDENTITY_SALT --env "$ENV" >/dev/null
printf '%s' "$TENANT:$SITE_KEY" | npx wrangler secret put SDK_KEYS --env "$ENV" >/dev/null
echo "   JWT_SECRET, IDENTITY_SALT and SDK_KEYS set on the worker. SHOT_TOKEN is not set: the screenshot route does not exist on this stamp."

echo "▸ The first admin, written to D1 as a hash (doc 30)"
node scripts/operator-seed.mjs --email "$ADMIN_EMAIL" --name "Operator" --admin --env "$ENV"

echo
echo "✅ $ENV provisioned. Deploy with: bash scripts/deploy.sh $ENV"
echo "   Keep these two; neither is stored anywhere readable:"
echo "   site key for tenant $TENANT (the customer's site sends it as X-SDK-Key): $SITE_KEY"
echo "   the admin's password is printed above by operator-seed, once."
