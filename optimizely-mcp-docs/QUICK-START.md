# Optimizely MCP Server - Quick Start Guide

Welcome! This guide will help you get started with the Optimizely MCP Server.

## 📁 What's in this folder?

- **docs/** - Comprehensive documentation
  - CLI guides
  - User guides
  - API reference
- **templates/** - Configuration templates
  - claude-config.json - For Claude Desktop
  - cursor-config.json - For Cursor IDE
- **agent-rules/** - AI assistant optimization rules
- **README.md** - Main package documentation

## 🚀 Quick Setup

### For Claude Desktop:
1. Copy `templates/claude-config.json` to your Claude Desktop config directory
2. Update the API token in the config
3. Restart Claude Desktop

### For Cursor:
1. Copy `templates/cursor-config.json` to your Cursor settings
2. Update the environment variables
3. Restart Cursor

## 📖 Documentation

- Start with `docs/README.md` for an overview
- Check `docs/cli/optly-cli-user-guide.md` for CLI usage
- See `docs/user-guides/` for detailed feature guides

## 🛠️ CLI Commands

```bash
# Basic commands (use appropriate method for your setup)

# Method 1: NPX (if working)
npx @simonecoelhosfo/optimizely-mcp-server health
npx @simonecoelhosfo/optimizely-mcp-server sync status

# Method 2: Local installation
node ./node_modules/@simonecoelhosfo/optimizely-mcp-server/bin/optly health
node ./node_modules/@simonecoelhosfo/optimizely-mcp-server/bin/optly sync status

# Method 3: NPX Fix Script (best of both - created by setup-docs)
node optly-npx-fix.cjs optly health
node optly-npx-fix.cjs optly sync status
node optly-npx-fix.cjs optly analytics templates

# Get help
optly --help
```

## 🔧 NPX Fix Script

The `setup-docs` command creates `optly-npx-fix.cjs` in your project root.
This script solves Windows spawn issues while maintaining cross-platform compatibility.

Add to your package.json for team convenience:
```json
{
  "scripts": {
    "optly-health": "node optly-npx-fix.cjs optly health",
    "optly-sync": "node optly-npx-fix.cjs optly sync status"
  }
}
```

## 📝 Next Steps

1. Configure your API token
2. Run `optly sync` to populate your local cache
3. Start exploring with `optly --help`

Happy optimizing! 🎯
