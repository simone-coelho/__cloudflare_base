# CLI Setup Guide - All Platforms

## Quick Setup (Recommended for All Platforms)

### Step 1: Build the Project
```bash
npm run build
```

### Step 2: Install Globally

#### Option A: Universal Installer (Recommended)
```bash
# Works on Windows, Mac, and Linux
node install.cjs
```

#### Option B: Platform-Specific Installers
```bash
# Windows (PowerShell as Administrator)
.\install-global.ps1

# Windows (Command Prompt)
install-global.bat

# Mac/Linux
./install-global.sh
```

#### Option C: npm link (if no permission issues)
```bash
npm link
```

### Step 3: Test Installation
```bash
# This should now work from ANY directory
optly --help
```

## How npm link Works

When you run `npm link` in the project directory:
1. npm creates a symbolic link in your global node_modules
2. npm adds `optly` to your system PATH
3. The command works in Command Prompt, PowerShell, Terminal, etc.

## Platform-Specific Details

### Windows (PowerShell & Command Prompt)
After running `npm link`, the `optly` command will work in both:
- ✅ PowerShell
- ✅ Command Prompt
- ✅ Windows Terminal
- ✅ Git Bash
- ✅ WSL

### macOS & Linux
After running `npm link`, the `optly` command will work in:
- ✅ Terminal
- ✅ iTerm
- ✅ bash/zsh/fish
- ✅ Any shell

## Verify Installation

```bash
# Check if optly is available
which optly        # Unix/Mac
where optly        # Windows

# Test the command
optly --version
optly --help
```

## Using the CLI

Once installed via `npm link`, you can use the CLI from anywhere:

```bash
# From any directory
optly sync --project 12345
optly query flags
optly entity list
optly interactive
```

## Troubleshooting

### PowerShell Execution Policy
If you get an execution policy error in PowerShell:
```powershell
# Run as Administrator
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Permission Denied (Unix/Mac)
```bash
# Fix permissions
chmod +x optly
npm link
```

### Command Not Found
```bash
# Verify npm global bin is in PATH
npm config get prefix

# Add to PATH if needed
# Windows: Add %APPDATA%\npm to PATH
# Mac/Linux: Add $(npm config get prefix)/bin to PATH
```

## Alternative Methods (If npm link doesn't work)

### Windows PowerShell Function
Add to your PowerShell profile (`$PROFILE`):
```powershell
function optly {
    node "C:\path\to\optly-mcp-server\dist\cli\OptlyCLI.js" $args
}
```

### Unix/Mac Alias
Add to your `.bashrc` or `.zshrc`:
```bash
alias optly='node /path/to/optly-mcp-server/dist/cli/OptlyCLI.js'
```

### Direct Execution (All Platforms)
```bash
# Always works, but requires full path
node /path/to/optly-mcp-server/dist/cli/OptlyCLI.js --help
```

## Development Mode

For active development, you can use the TypeScript version directly:
```bash
npm run optly:dev -- --help
```

## Uninstalling

To remove the global link:
```bash
# From the project directory
npm unlink

# Or globally
npm uninstall -g optly-mcp-server
```

## Summary

**For all platforms, the recommended approach is:**
1. `npm run build` - Build the project
2. `npm link` - Create global command
3. `optly --help` - Use from anywhere

This works on Windows (PowerShell/CMD), macOS, and Linux without any platform-specific configuration!