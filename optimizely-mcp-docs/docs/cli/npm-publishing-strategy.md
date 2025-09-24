# NPM Publishing Strategy for Optimizely MCP Server

## Overview

This document outlines the strategy for publishing the Optimizely MCP Server to npm, including how the CLI will be distributed and installed.

## Current State

- **Project Status**: Local development only
- **CLI Integration**: CLI is built into the MCP server project
- **Installation**: Manual clone and build required
- **Usage**: `npm run optly -- <command>` or `npm link` for global access

## Future State: NPM Package

### Package Structure

```
@optimizely/mcp-server/
├── dist/
│   ├── index.js          # MCP server entry point
│   ├── cli/
│   │   └── OptlyCLI.js   # CLI entry point
│   └── ...
├── bin/
│   └── optly             # CLI executable wrapper
├── package.json
└── README.md
```

### Package.json Configuration

```json
{
  "name": "@optimizely/mcp-server",
  "version": "1.0.0",
  "description": "Optimizely MCP Server with integrated CLI",
  "main": "dist/index.js",
  "bin": {
    "optly": "./bin/optly"
  },
  "files": [
    "dist/",
    "bin/",
    "README.md",
    "LICENSE"
  ],
  "scripts": {
    "prepublishOnly": "npm run build"
  },
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org/"
  }
}
```

## Installation Scenarios

### 1. Global Installation (CLI + MCP Server)

```bash
# Install globally
npm install -g @optimizely/mcp-server

# This provides:
# - 'optly' CLI command globally
# - MCP server available for import

# Use the CLI
optly sync --project 12345
optly query flags

# Use as MCP server
# The global install makes it available to Claude Desktop, Cursor, etc.
```

### 2. Project Installation (MCP Server with local CLI)

```bash
# Install in a project
npm install @optimizely/mcp-server

# Use the CLI locally
npx optly sync --project 12345

# Import and use the MCP server
import { OptimizelyMCPServer } from '@optimizely/mcp-server';
```

### 3. Separate Packages Option

Alternatively, we could split into two packages:

```bash
# Option A: Monorepo with two packages
@optimizely/mcp-server     # The MCP server
@optimizely/mcp-cli        # The CLI tool

# Option B: CLI included but separately installable
npm install -g @optimizely/mcp-server     # Full package
npm install -g @optimizely/mcp-server-cli # CLI only (lighter)
```

## Benefits of Integrated Approach

1. **Single Installation**: Users get both MCP server and CLI with one install
2. **Version Consistency**: CLI and server always in sync
3. **Shared Dependencies**: Reduced download size
4. **Simplified Maintenance**: One package to maintain

## Implementation Steps

### Phase 1: Prepare for Publishing
1. Add proper bin wrapper script
2. Update package.json with publishing config
3. Add .npmignore file
4. Create comprehensive README.md
5. Add LICENSE file

### Phase 2: Create Bin Wrapper

Create `bin/optly` file:

```bash
#!/usr/bin/env node
require('../dist/cli/OptlyCLI.js');
```

Make it executable:
```bash
chmod +x bin/optly
```

### Phase 3: Testing
1. Test with `npm link` locally
2. Test with `npm pack` and local install
3. Publish beta version for testing

### Phase 4: Publishing
```bash
# Login to npm
npm login

# Publish public package
npm publish --access public
```

## Usage After Publishing

### For MCP Server Users (Claude Desktop, Cursor)

```json
// Claude Desktop config
{
  "mcpServers": {
    "optimizely": {
      "command": "npx",
      "args": ["@optimizely/mcp-server"],
      "env": {
        "OPTIMIZELY_API_TOKEN": "your-token"
      }
    }
  }
}
```

### For CLI Users

```bash
# Global install for CLI usage
npm install -g @optimizely/mcp-server

# Configure
export OPTIMIZELY_API_TOKEN="your-token"

# Use CLI
optly sync
optly query flags
optly entity create flag --template simple_toggle
```

### For Developers

```javascript
// Import the MCP server
import { OptimizelyMCPServer } from '@optimizely/mcp-server';

// Or import specific tools
import { OptimizelyMCPTools } from '@optimizely/mcp-server/tools';
```

## Configuration Distribution

The package will include:
1. Default configuration templates
2. Environment variable documentation
3. Example .env file
4. Setup wizard for first-time users

```bash
# First time setup
optly setup
# Interactive wizard to configure API token, projects, etc.
```

## Conclusion

The integrated approach where the MCP server package includes the CLI provides the best user experience. Users can install once and get both the MCP server functionality for AI assistants AND a powerful CLI for direct interaction with their Optimizely data.

This strategy aligns with tools like `typescript` (includes `tsc`), `@angular/cli`, and other developer tools that bundle CLIs with their main functionality.