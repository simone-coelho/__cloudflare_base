#!/bin/bash

echo "🚀 Setting up Cloudflare Edge Platform..."

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "❌ Wrangler CLI not found. Please install it first:"
    echo "npm install -g wrangler"
    exit 1
fi

# Check if logged in to Cloudflare
if ! wrangler whoami &> /dev/null; then
    echo "🔑 Please login to Cloudflare first:"
    echo "wrangler login"
    exit 1
fi

echo "📦 Installing dependencies..."
npm install

echo "🗄️ Creating KV namespaces..."
CACHE_NAMESPACE=$(wrangler kv:namespace create "CACHE" --preview false | grep -o 'id = "[^"]*"' | cut -d'"' -f2)
CACHE_PREVIEW_NAMESPACE=$(wrangler kv:namespace create "CACHE" --preview | grep -o 'id = "[^"]*"' | cut -d'"' -f2)

SESSIONS_NAMESPACE=$(wrangler kv:namespace create "SESSIONS" --preview false | grep -o 'id = "[^"]*"' | cut -d'"' -f2)
SESSIONS_PREVIEW_NAMESPACE=$(wrangler kv:namespace create "SESSIONS" --preview | grep -o 'id = "[^"]*"' | cut -d'"' -f2)

echo "🪣 Creating R2 bucket..."
wrangler r2 bucket create edge-platform-storage

echo "📬 Creating queue..."
wrangler queues create events

echo "🔧 Updating wrangler.toml with created resources..."

# Update wrangler.toml with actual IDs
sed -i.bak "s/your-kv-namespace-id/$CACHE_NAMESPACE/g" wrangler.toml
sed -i.bak "s/your-kv-preview-id/$CACHE_PREVIEW_NAMESPACE/g" wrangler.toml
sed -i.bak "s/your-sessions-kv-id/$SESSIONS_NAMESPACE/g" wrangler.toml
sed -i.bak "s/your-sessions-preview-id/$SESSIONS_PREVIEW_NAMESPACE/g" wrangler.toml

echo "🔐 Setting up secrets..."
echo "Please enter your JWT secret (press Enter to generate a random one):"
read JWT_SECRET
if [ -z "$JWT_SECRET" ]; then
    JWT_SECRET=$(openssl rand -base64 32)
fi
echo "$JWT_SECRET" | wrangler secret put JWT_SECRET

echo "Please enter your Optimizely SDK key (optional):"
read OPTIMIZELY_SDK_KEY
if [ ! -z "$OPTIMIZELY_SDK_KEY" ]; then
    echo "$OPTIMIZELY_SDK_KEY" | wrangler secret put OPTIMIZELY_SDK_KEY
fi

echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Review and update wrangler.toml with your specific settings"
echo "2. Run 'npm run dev' to start development"
echo "3. Run 'npm run deploy' when ready to deploy"
echo ""
echo "🔗 Useful commands:"
echo "  npm run dev      - Start development server"
echo "  npm run deploy   - Deploy to production"
echo "  npm run tail     - View logs"
echo "  npm run lint     - Run linter"
echo "  npm run test     - Run tests"