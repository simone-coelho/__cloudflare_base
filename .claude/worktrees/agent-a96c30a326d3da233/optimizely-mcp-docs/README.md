# Optimizely MCP Server - Installation Guide

## 🚀 **Installation Methods**

Both methods work reliably now that we've resolved binary compatibility issues. We recommend local installation to avoid potential NPX caching issues.

### **📋 Quick Installation Matrix**

| Method | Reliability | Cache Issues | Setup Complexity | Team Use | Recommended For |
|--------|-------------|--------------|------------------|----------|-----------------|
| **Local Installation** | ✅ 99%+ | ✅ None | 📝 Medium | ✅ Excellent | **Production, Teams, CI/CD** |
| **NPX Direct** | ✅ 95%+ | ⚠️ Possible | 📝 Simple | ⚠️ Variable | **Quick Testing, Individual Use** |

---

## 🥇 **Method 1: Local Installation (Recommended)**

**✅ Best for: Production environments, team consistency, CI/CD pipelines**

### Step 1: Install Package
```bash
npm install @simonecoelhosfo/optimizely-mcp-server
```

### Step 2: Copy Documentation & Setup Scripts
```bash
node ./node_modules/@simonecoelhosfo/optimizely-mcp-server/bin/optly setup-docs
```

**✨ This automatically:**
- Creates `optimizely-mcp-docs/` folder with complete documentation
- Creates `optly-npx-fix.cjs` convenience script
- **Updates your `package.json`** with optly scripts for team use

### Step 3: Essential Commands
```bash
# Core commands (note the 'node' prefix)
node ./node_modules/@simonecoelhosfo/optimizely-mcp-server/bin/optly health
node ./node_modules/@simonecoelhosfo/optimizely-mcp-server/bin/optly --version
node ./node_modules/@simonecoelhosfo/optimizely-mcp-server/bin/optly sync status
```

### Step 4: Configure Your AI Client

**For WSL/Linux/macOS (with `./` prefix):**
```json
{
  "mcpServers": {
    "optimizely": {
      "command": "node",
      "args": ["./node_modules/@simonecoelhosfo/optimizely-mcp-server/bin/optly"],
      "env": {
        "NODE_ENV": "production",
        "MCP_MODE": "true",
        "OPTIMIZELY_API_TOKEN": "your-token-here",
        "OPTIMIZELY_PROJECT_IDS": "project1,project2"
      }
    }
  }
}
```

**For Windows (without `./` prefix):**
```json
{
  "mcpServers": {
    "optimizely": {
      "command": "node",
      "args": ["node_modules/@simonecoelhosfo/optimizely-mcp-server/bin/optly"],
      "env": {
        "NODE_ENV": "production",
        "MCP_MODE": "true",
        "OPTIMIZELY_API_TOKEN": "your-token-here",
        "OPTIMIZELY_PROJECT_IDS": "project1,project2"
      }
    }
  }
}
```

**⚠️ Note for VS Code Users**: VS Code has unique MCP configuration requirements. See the [Configuration for VS Code](#configuration-for-vs-code) section below for VS Code-specific setup instructions with input prompts and the required `"type": "stdio"` field.

### Convenience Scripts (Auto-generated)

After running `setup-docs`, these scripts are automatically added to your `package.json`:

```bash
npm run optly              # General optly command
npm run optly-health       # Health check
npm run optly-sync         # Check sync status
npm run optly-analytics    # Show analytics templates
npm run optly-entity-flags # Show flag templates
```

---

## 🥈 **Method 2: NPX Direct**

**✅ Good for: Quick testing, individual development, one-off usage**

**⚠️ Note on NPX Caching**: NPX occasionally has caching issues. If you encounter problems, clear NPX cache with `npx clear-npx-cache` or use local installation.

### Basic Usage
```bash
npx @simonecoelhosfo/optimizely-mcp-server setup-docs
npx @simonecoelhosfo/optimizely-mcp-server health
npx @simonecoelhosfo/optimizely-mcp-server --version
npx @simonecoelhosfo/optimizely-mcp-server sync status
```

### Configuration for Claude Desktop
```json
{
  "mcpServers": {
    "optimizely": {
      "command": "npx",
      "args": ["-y", "@simonecoelhosfo/optimizely-mcp-server"],
      "env": {
        "NODE_ENV": "production",
        "MCP_MODE": "true",
        "OPTIMIZELY_API_TOKEN": "your-token-here",
        "OPTIMIZELY_PROJECT_IDS": "project1,project2"
      }
    }
  }
}
```

### Configuration for Cursor
```json
{
  "mcpServers": {
    "optimizely": {
      "command": "npx",
      "args": ["-y", "@simonecoelhosfo/optimizely-mcp-server"],
      "env": {
        "NODE_ENV": "production",
        "MCP_MODE": "true",
        "OPTIMIZELY_API_TOKEN": "your-token-here",
        "OPTIMIZELY_PROJECT_IDS": "project1,project2"
      }
    }
  }
}
```

### Configuration for VS Code

**🆕 VS Code has unique MCP configuration requirements different from Claude Desktop and Cursor:**

VS Code supports **two configuration approaches** for handling sensitive data like API tokens:

#### **Option A: Direct Token Configuration (Simpler)**

Create `.vscode/mcp.json` in your project root with tokens directly embedded:

```json
{
  "servers": {
    "optimizely": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@simonecoelhosfo/optimizely-mcp-server"],
      "env": {
        "NODE_ENV": "production",
        "MCP_MODE": "true",
        "OPTIMIZELY_API_TOKEN": "your-actual-token-here",
        "OPTIMIZELY_PROJECT_IDS": "project1,project2"
      }
    }
  }
}
```

#### **Option B: Secure Input Prompts (Recommended for Teams)**

Create `.vscode/mcp.json` with interactive prompts for sensitive data:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "optimizely-token",
      "description": "Optimizely API Token",
      "password": true
    },
    {
      "type": "promptString", 
      "id": "optimizely-projects",
      "description": "Optimizely Project IDs (comma-separated)",
      "password": false
    }
  ],
  "servers": {
    "optimizely": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@simonecoelhosfo/optimizely-mcp-server"],
      "env": {
        "NODE_ENV": "production",
        "MCP_MODE": "true",
        "OPTIMIZELY_API_TOKEN": "${input:optimizely-token}",
        "OPTIMIZELY_PROJECT_IDS": "${input:optimizely-projects}"
      }
    }
  }
}
```

#### **Local Installation Configuration for VS Code**

If using **local installation** instead of NPX, modify the command:

**Option A - Direct (WSL/Linux/macOS):**
```json
{
  "servers": {
    "optimizely": {
      "type": "stdio",
      "command": "node",
      "args": ["./node_modules/@simonecoelhosfo/optimizely-mcp-server/bin/optly"],
      "env": {
        "NODE_ENV": "production",
        "MCP_MODE": "true",
        "OPTIMIZELY_API_TOKEN": "your-actual-token-here",
        "OPTIMIZELY_PROJECT_IDS": "project1,project2"
      }
    }
  }
}
```

**Option A - Direct (Windows):**
```json
{
  "servers": {
    "optimizely": {
      "type": "stdio",
      "command": "node",
      "args": ["node_modules/@simonecoelhosfo/optimizely-mcp-server/bin/optly"],
      "env": {
        "NODE_ENV": "production",
        "MCP_MODE": "true",
        "OPTIMIZELY_API_TOKEN": "your-actual-token-here",
        "OPTIMIZELY_PROJECT_IDS": "project1,project2"
      }
    }
  }
}
```

**Option B - Input Prompts (WSL/Linux/macOS):**
```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "optimizely-token",
      "description": "Optimizely API Token",
      "password": true
    },
    {
      "type": "promptString", 
      "id": "optimizely-projects",
      "description": "Optimizely Project IDs (comma-separated)",
      "password": false
    }
  ],
  "servers": {
    "optimizely": {
      "type": "stdio",
      "command": "node",
      "args": ["./node_modules/@simonecoelhosfo/optimizely-mcp-server/bin/optly"],
      "env": {
        "NODE_ENV": "production",
        "MCP_MODE": "true",
        "OPTIMIZELY_API_TOKEN": "${input:optimizely-token}",
        "OPTIMIZELY_PROJECT_IDS": "${input:optimizely-projects}"
      }
    }
  }
}
```

**Option B - Input Prompts (Windows):**
```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "optimizely-token",
      "description": "Optimizely API Token",
      "password": true
    },
    {
      "type": "promptString", 
      "id": "optimizely-projects",
      "description": "Optimizely Project IDs (comma-separated)",
      "password": false
    }
  ],
  "servers": {
    "optimizely": {
      "type": "stdio",
      "command": "node",
      "args": ["node_modules/@simonecoelhosfo/optimizely-mcp-server/bin/optly"],
      "env": {
        "NODE_ENV": "production",
        "MCP_MODE": "true",
        "OPTIMIZELY_API_TOKEN": "${input:optimizely-token}",
        "OPTIMIZELY_PROJECT_IDS": "${input:optimizely-projects}"
      }
    }
  }
}
```

#### **Key VS Code Configuration Differences:**

| Feature | VS Code | Claude Desktop | Cursor |
|---------|---------|----------------|---------|
| **Config File** | `.vscode/mcp.json` | `claude_desktop_config.json` | `.cursor/mcp_config.json` |
| **Type Field** | ⚠️ **Required**: `"type": "stdio"` | Not used | Not used |
| **Input Prompts** | ✅ **Supported**: Secure password prompts | ❌ Not supported | ❌ Not supported |
| **Variable Interpolation** | ✅ `${input:id}` | ❌ Direct only | ❌ Direct only |
| **File Location** | Workspace-specific (`.vscode/`) | User-global config | User-global config |

#### **VS Code Testing Steps:**

1. **Create Configuration**: Save your chosen configuration to `.vscode/mcp.json`
2. **Restart VS Code**: Required for MCP configuration changes
3. **Test Integration**: Open GitHub Copilot Chat or VS Code's built-in chat
4. **Verify Connection**: Ask "What Optimizely projects do I have access to?"

#### **VS Code Troubleshooting:**

**Error: "Server exited before responding to initialize request"**
- ✅ Ensure `"type": "stdio"` is present in server configuration
- ✅ Verify command path is correct for your platform
- ✅ Check that environment variables are properly set

**Input Prompts Not Appearing:**
- ✅ Verify `inputs` array is properly formatted
- ✅ Restart VS Code after configuration changes
- ✅ Check VS Code output panel for MCP-related errors

**Binary Dependency Issues:**
- ✅ Use local installation instead of NPX for better reliability
- ✅ Ensure Node.js version compatibility
- ✅ Run `npm rebuild better-sqlite3` if needed

### If NPX Cache Issues Occur
Follow [NPX's official troubleshooting guide](https://docs.npmjs.com/cli/v8/commands/npx#cache-issues):

```bash
# Clear NPX cache
npx clear-npx-cache

# Or use NPX with --cache flag
npx --cache ./tmp-npx-cache @simonecoelhosfo/optimizely-mcp-server health

# If persistent issues occur, switch to local installation
npm install @simonecoelhosfo/optimizely-mcp-server
```

---

## 🎯 **Which Method Should You Choose?**

### **✅ Choose Local Installation (Method 1) for:**
- **🏢 Production environments** - Maximum reliability and consistency
- **👥 Team development** - Everyone uses the same setup and scripts
- **🤖 CI/CD pipelines** - Avoid any caching-related build failures
- **🔒 Enterprise environments** - Better control over dependencies
- **📦 Package.json scripts** - Team convenience with npm run commands
- **🔧 VS Code users** - Better reliability with binary dependencies than NPX

### **✅ Choose NPX (Method 2) for:**
- **⚡ Quick testing** - Fast setup for trying the server
- **👤 Individual development** - Personal projects or exploration
- **🔧 One-off usage** - Temporary testing or evaluation
- **📦 Simple setups** - Don't want to add to package.json

---

## 🔧 **Node.js Compatibility**

| Node.js Version | Local Installation | NPX Method | Recommended |
|----------------|-------------------|------------|-------------|
| **v22.x** | ✅ Excellent | ✅ Excellent | Either method |
| **v20.x** | ✅ Excellent | ✅ Very Good | Either method |
| **v18.x** | ✅ Excellent | ✅ Good | Local preferred |
| **v16.x** | ⚠️ Limited | ⚠️ Limited | Upgrade Node.js |

---

## ✅ **Verification Steps**

### Test Your Installation

```bash
# Test 1: Health Check
# NPX method:
npx @simonecoelhosfo/optimizely-mcp-server health

# Local method:
node ./node_modules/@simonecoelhosfo/optimizely-mcp-server/bin/optly health

# Expected output:
# ✅ Optimizely MCP Server Health Check
# 📊 Status: Healthy
# 🔄 Cache: Ready
# 🌐 API: Connected
```

### Test Documentation Setup
```bash
# This should create optimizely-mcp-docs/ folder
npx @simonecoelhosfo/optimizely-mcp-server setup-docs
# OR
node ./node_modules/@simonecoelhosfo/optimizely-mcp-server/bin/optly setup-docs

# Verify created files:
ls optimizely-mcp-docs/
# Should show: README.md, QUICK-START.md, docs/, templates/, agent-rules/
```

---

## 🔄 **Migration Between Methods**

### From NPX to Local Installation

If you want to switch from NPX to local installation:

```bash
# 1. Install locally
npm install @simonecoelhosfo/optimizely-mcp-server

# 2. Update your MCP configuration from:
# "command": "npx", "args": ["-y", "@simonecoelhosfo/optimizely-mcp-server"]
# To:
# "command": "node", "args": ["./node_modules/@simonecoelhosfo/optimizely-mcp-server/bin/optly"]

# 3. Test the change
node ./node_modules/@simonecoelhosfo/optimizely-mcp-server/bin/optly health
```

### From Local to NPX

If you want to switch from local to NPX:

```bash
# 1. Update your MCP configuration from:
# "command": "node", "args": ["./node_modules/@simonecoelhosfo/optimizely-mcp-server/bin/optly"]
# To:
# "command": "npx", "args": ["-y", "@simonecoelhosfo/optimizely-mcp-server"]

# 2. Test the change
npx @simonecoelhosfo/optimizely-mcp-server health
```

---

## 🚀 **Essential Commands Reference**

### Core Commands
```bash
# Health and version checks
optly health                    # System health check
optly --version                 # Show version
optly --help                    # Show all commands

# Documentation setup
optly setup-docs                # Copy docs and create convenience scripts

# Data synchronization
optly sync status               # Check sync status
optly sync refresh              # Refresh data cache

# Analytics and templates
optly analytics templates       # Show analytics query templates
optly entity templates flag     # Show flag creation templates
optly entity templates experiment # Show experiment templates
```

### Using Different Methods
```bash
# NPX method:
npx @simonecoelhosfo/optimizely-mcp-server [command]

# Local method:
node ./node_modules/@simonecoelhosfo/optimizely-mcp-server/bin/optly [command]

# NPX fix script (after setup-docs):
node optly-npx-fix.cjs optly [command]

# Package.json scripts (after setup-docs):
npm run optly-health
npm run optly-sync
npm run optly-analytics
```

---

## 🛠️ **Troubleshooting**

### NPX Cache Issues
```bash
# If NPX behaves unexpectedly:
npx clear-npx-cache
npx @simonecoelhosfo/optimizely-mcp-server health

# If cache issues persist, use local installation:
npm install @simonecoelhosfo/optimizely-mcp-server
```

### Command Not Found
```bash
# For local installation, always use 'node' prefix:
✅ node ./node_modules/@simonecoelhosfo/optimizely-mcp-server/bin/optly health
❌ ./node_modules/@simonecoelhosfo/optimizely-mcp-server/bin/optly health
```

### Path Issues (Windows vs Unix)
- **Windows**: Use `node_modules/...` (no `./` prefix)
- **WSL/Linux/macOS**: Use `./node_modules/...` (with `./` prefix)

---

## 📚 **After Setup: Generated Documentation**

After running `setup-docs`, you'll have a complete documentation suite:

```
optimizely-mcp-docs/
├── README.md                   # Package overview
├── QUICK-START.md              # 5-minute getting started guide
├── docs/                       # Complete documentation
│   ├── cli/                   # CLI usage guides
│   ├── user-guides/           # Feature documentation
│   └── api-reference/         # Technical reference
├── templates/                  # Configuration examples
│   ├── claude-config.json     # Claude Desktop setup
│   ├── cursor-config.json     # Cursor IDE setup
│   └── vscode-config.json     # VS Code MCP setup
└── agent-rules/               # AI assistant optimization rules
```

### Key Files to Review:
- **`QUICK-START.md`** - Start here for immediate productivity
- **`templates/claude-config.json`** - Claude Desktop configuration
- **`templates/cursor-config.json`** - Cursor IDE configuration
- **`templates/vscode-config.json`** - VS Code MCP configuration
- **`docs/README.md`** - Comprehensive feature overview

---

## 🎉 **You're Ready!**

1. **Choose your installation method** (local recommended for teams)
2. **Run `setup-docs`** to get complete documentation
3. **Configure your AI client** with the appropriate method
4. **Start with a health check** to verify everything works
5. **Explore the generated documentation** for advanced features

### 🚀 **Quick Success Pattern:**
```bash
# 1. Install (choose one)
npm install @simonecoelhosfo/optimizely-mcp-server  # Recommended
# OR
npx @simonecoelhosfo/optimizely-mcp-server setup-docs  # Quick start

# 2. Setup documentation
node ./node_modules/@simonecoelhosfo/optimizely-mcp-server/bin/optly setup-docs

# 3. Test health
npm run optly-health  # OR: node optly-npx-fix.cjs optly health

# 4. Configure your AI client and start optimizing!
```

**Happy optimizing! 🎯**

---

**Last Updated**: December 2024  
**Binary Compatibility**: ✅ Resolved - Both methods work reliably  
**Recommendation**: Local installation for teams and production, NPX for quick testing 