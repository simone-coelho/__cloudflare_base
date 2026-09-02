#!/usr/bin/env bash
# scripts/provision-staging.sh — create staging's own resources, fill the ids
# into wrangler.toml, apply migrations, set secrets, and seed an operator login.
#
# Run ONCE, by a person with Cloudflare account access:  bash scripts/provision-staging.sh
# Idempotent where Wrangler allows it; re-running reports "already exists" and continues.
set -euo pipefail
cd "$(dirname "$0")/.."
ENV=staging

id32() { grep -o '[0-9a-f]\{32\}' | head -1; }
id36() { grep -o '[0-9a-f-]\{36\}' | head -1; }

echo "▸ KV namespaces"
CACHE_ID=$(npx wrangler kv namespace create CACHE --env $ENV 2>&1 | tee /dev/stderr | id32 || true)
SESSIONS_ID=$(npx wrangler kv namespace create SESSIONS --env $ENV 2>&1 | tee /dev/stderr | id32 || true)

echo "▸ R2 bucket"
npx wrangler r2 bucket create edge-platform-storage-staging 2>&1 | tee /dev/stderr || true

echo "▸ Queue"
npx wrangler queues create events-staging 2>&1 | tee /dev/stderr || true

echo "▸ D1 database"
D1_ID=$(npx wrangler d1 create coach-demo-db-staging 2>&1 | tee /dev/stderr | id36 || true)

if [ -n "${CACHE_ID:-}" ] && [ -n "${SESSIONS_ID:-}" ] && [ -n "${D1_ID:-}" ]; then
  sed -i "s#<staging-cache-kv-id>#$CACHE_ID#; s#<staging-sessions-kv-id>#$SESSIONS_ID#; s#<staging-d1-id>#$D1_ID#" wrangler.toml
  echo "▸ wrangler.toml: staging ids filled ($CACHE_ID, $SESSIONS_ID, $D1_ID)"
else
  echo "▸ Some ids could not be read (resource may already exist). Fill the <staging-…> placeholders in wrangler.toml by hand, then re-run for the steps below."
  grep -q '<staging-' wrangler.toml && exit 1
fi

echo "▸ D1 migrations"
npx wrangler d1 migrations apply coach-demo-db-staging --env $ENV --remote

echo "▸ Secrets (you will be prompted for each value)"
for s in JWT_SECRET SDK_KEYS GEMINI_API_KEY; do
  echo "   $s"; npx wrangler secret put "$s" --env $ENV
done
echo "   (optional) ODP_PUBLIC_KEY, SHOT_TOKEN: wrangler secret put NAME --env $ENV"

echo "▸ Operator login for /auth/login (the tuning UI and operator writes need a token)"
read -rp "   Operator email: " EMAIL
PASS=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)
npx wrangler kv key put "user:$EMAIL" \
  "{\"id\":\"ops-1\",\"email\":\"$EMAIL\",\"name\":\"Operator\",\"password\":\"$PASS\",\"roles\":[\"operator\"],\"permissions\":[]}" \
  --binding CACHE --env $ENV --remote
echo "   Operator password (store it now, it is not shown again): $PASS"

echo "✅ Staging provisioned. Deploy with: bash scripts/deploy.sh staging"
