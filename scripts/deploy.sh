#!/bin/bash

set -e

ENVIRONMENT=${1:-default}

echo "🚀 Deploying to $ENVIRONMENT environment..."

# Run type check
echo "🔍 Running type check..."
npm run typecheck

# Run linter
echo "✨ Running linter..."
npm run lint

# Run tests
echo "🧪 Running tests..."
npm run test

# Deploy
echo "📦 Deploying to Cloudflare Workers..."
if [ "$ENVIRONMENT" = "staging" ]; then
    if grep -q '<staging-' wrangler.toml; then
        echo "❌ staging is declared but not provisioned: placeholders remain in [env.staging]."
        echo "   Run: bash scripts/provision-staging.sh   (creates the resources and fills the ids)"
        exit 1
    fi
    npm run build:meridian && npm run build:sdk
    wrangler deploy --env staging
elif [ "$ENVIRONMENT" = "production" ]; then
    echo "❌ '--env production' is not deployable yet: [env.production] in wrangler.toml declares only a name."
    echo "   Named envs do NOT inherit bindings — this would ship a worker with no KV/R2/D1/DO/Queues/vars."
    echo "   Deploy the default worker instead (npm run deploy). See docs/deployment/01-deploy.md."
    exit 1
else
    npm run build:meridian && npm run build:sdk
    wrangler deploy
fi

echo "✅ Deployment to $ENVIRONMENT completed successfully!"

# Get the deployed URL
DEPLOYED_URL=$(wrangler whoami | grep -o 'https://[^/]*\.workers\.dev' | head -1)
if [ ! -z "$DEPLOYED_URL" ]; then
    echo "🌐 Your worker is available at: $DEPLOYED_URL"
fi

echo ""
echo "🔗 Useful post-deployment commands:"
echo "  wrangler tail                    - View real-time logs"
echo "  wrangler kv key list --binding CACHE  - List cache keys"
echo "  curl $DEPLOYED_URL/health        - Check health status"