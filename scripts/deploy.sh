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
if [ "$ENVIRONMENT" = "production" ] || [ "$ENVIRONMENT" = "staging" ]; then
    echo "❌ '--env $ENVIRONMENT' is not deployable yet: [env.$ENVIRONMENT] in wrangler.toml declares only a name."
    echo "   Named envs do NOT inherit bindings — this would ship a worker with no KV/R2/D1/DO/Queues/vars."
    echo "   Deploy the default worker instead (npm run deploy), or duplicate the bindings into the env first."
    echo "   See docs/deployment/01-deploy.md."
    exit 1
else
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