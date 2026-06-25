# Cache Sync CLI Tools - Comprehensive User Guide

## 📚 Overview

The Optimizely MCP Server provides two cache synchronization CLI tools, each designed for different use cases:

1. **Basic Cache Sync** (`cache-sync-cli.ts`) - Simple, straightforward synchronization
2. **Enhanced Cache Sync** (`cache-sync-enhanced.ts`) - Advanced features with progress bars, performance metrics, targeted sync, and **automatic database cleanup**

## 🎯 Quick Decision Guide

| Use Case | Tool to Use | Command |
|----------|-------------|---------|
| Quick sync, no frills | Basic Cache Sync | `npm run cache-sync` |
| Visual progress tracking | Enhanced Cache Sync | `npm run cache-sync:enhanced` |
| Performance metrics needed | Enhanced Cache Sync | `npm run cache-sync:enhanced -- --export ./reports` |
| Targeted table sync | Enhanced Cache Sync | `npm run cache-sync:enhanced -- --tables experiments` |
| CI/CD automation | Basic Cache Sync | `npm run cache-sync` |
| Debugging sync issues | Enhanced Cache Sync | `npm run cache-sync:enhanced -- --verbose` |

## 🚀 Basic Cache Sync CLI

### Overview
The basic cache sync provides simple, reliable synchronization without visual distractions. Perfect for scripts and automation.

### Installation & Setup
```bash
# Ensure environment variable is set
export OPTIMIZELY_API_TOKEN="your-api-token"

# Or use .env file
echo "OPTIMIZELY_API_TOKEN=your-api-token" > .env
```

### Basic Usage
```bash
# Full sync (all projects from environment)
npm run cache-sync

# Sync specific project
npm run cache-sync -- --project 12345

# Force sync (clear existing data first)
npm run cache-sync -- --force

# Incremental sync (only changes since last sync)
npm run cache-sync -- --incremental

# Specific project with force
npm run cache-sync -- --project 12345 --force
```

### Command Options
| Option | Description | Example |
|--------|-------------|---------|
| `--project <id>` | Sync specific project only | `--project 12345` |
| `--force` | Clear existing data before sync | `--force` |
| `--incremental` | Only sync changes since last sync | `--incremental` |
| `--help` | Show help information | `--help` |

### Output Example
```
Syncing Optimizely cache...
Syncing project: 12345
- Fetching flags...
- Fetching experiments...
- Fetching audiences...
Sync completed successfully!
```

### When to Use Basic Sync
- ✅ Automated scripts and CI/CD pipelines
- ✅ Quick manual syncs
- ✅ When you don't need visual feedback
- ✅ Server environments without TTY support

## 🎨 Enhanced Cache Sync CLI

### Overview
The enhanced cache sync provides rich visual feedback, performance metrics, targeted synchronization, detailed reporting capabilities, and **automatic database cleanup** to prevent database locking issues.

### Basic Usage
```bash
# Full sync with progress bars
npm run cache-sync:enhanced

# Verbose mode with detailed logs
npm run cache-sync:enhanced -- --verbose

# Sync specific project
npm run cache-sync:enhanced -- --project 12345

# Force sync with visual progress
npm run cache-sync:enhanced -- --force

# Incremental sync
npm run cache-sync:enhanced -- --incremental
```

### Visual Progress Display
```
🚀 Optimizely Cache Sync - Performance Optimized
────────────────────────────────────────────────────────────
Operation: Full Sync
Started: 2025-01-24, 10:30:00 AM
────────────────────────────────────────────────────────────

[Fetching projects] ████████████████████████░░░░░░ 80% | 8/10 | Loading...
[Syncing audiences] ██████████████████████████████ 100% | 25/25 | Complete
[Syncing flags] ███████████████████░░░░░░░░░░░ 65% | 32/50 | Processing...

✨ Sync Completed Successfully!
```

### Advanced Features

#### 1. **Targeted Table Synchronization** 🎯
```bash
# List available tables
npm run cache-sync:enhanced -- --list-tables

# Sync specific tables only
npm run cache-sync:enhanced -- --tables experiments flags

# Sync by entity type
npm run cache-sync:enhanced -- --entities experiment flag audience

# Force refresh specific tables
npm run cache-sync:enhanced -- --force --tables experiments

# Project-specific targeted sync
npm run cache-sync:enhanced -- --project 12345 --tables experiments audiences
```

#### 2. **Multiple Project Support**
```bash
# Sync multiple projects at once
npm run cache-sync:enhanced -- --multi-project 12345 67890 13579

# Continue on error for multi-project sync
npm run cache-sync:enhanced -- --multi-project 12345 67890 --continue-on-error
```

#### 3. **Performance Reporting** 📊
```bash
# Export performance reports
npm run cache-sync:enhanced -- --export ./reports

# Export specific format
npm run cache-sync:enhanced -- --export ./reports --json
npm run cache-sync:enhanced -- --export ./reports --markdown

# Skip console summary
npm run cache-sync:enhanced -- --no-summary
```

#### 4. **Display Options**
```bash
# Use classic verbose display
npm run cache-sync:enhanced -- --classic

# Compact display (default)
npm run cache-sync:enhanced -- --compact
```

### Complete Command Reference

| Option | Description | Example |
|--------|-------------|---------|
| `-p, --project <id>` | Sync specific project | `--project 12345` |
| `-m, --multi-project <ids...>` | Sync multiple projects | `--multi-project 123 456 789` |
| `-f, --force` | Clear data before sync | `--force` |
| `-r, --reset` | Reset database if outdated | `--reset` |
| `-i, --incremental` | Incremental sync only | `--incremental` |
| `-v, --verbose` | Enable verbose output | `--verbose` |
| `-c, --continue-on-error` | Continue if project fails | `--continue-on-error` |
| `-s, --no-summary` | Skip summary report | `--no-summary` |
| `-e, --export <path>` | Export reports to directory | `--export ./reports` |
| `--json` | Output JSON format | `--json` |
| `--markdown` | Output Markdown format | `--markdown` |
| `--compact` | Compact progress display | `--compact` |
| `--classic` | Classic verbose display | `--classic` |
| `--tables <tables...>` | Sync specific tables only | `--tables experiments flags` |
| `--entities <entities...>` | Sync specific entity types | `--entities experiment flag` |
| `--list-tables` | List available tables | `--list-tables` |
| `--list-entities` | List available entities | `--list-entities` |

### Performance Metrics

The enhanced CLI tracks and reports:
- **SQL Operation Reduction**: Shows optimization effectiveness (target: 90%+ reduction)
- **Phase Timing**: Time spent on each sync phase
- **Entity Metrics**: Count and timing per entity type
- **Batch Operation Stats**: Number of batch vs individual operations
- **Total Duration**: Overall sync time

Example Summary Report:
```
📊 PERFORMANCE SUMMARY REPORT
════════════════════════════════════════════════════════════

📈 Overall Metrics
─────────────────────────────────────────────────────────
Total Duration:     12.5 seconds
Total Entities:     1,847
Projects Synced:    3
Avg Time/Entity:    6.8ms

🎯 SQL Operation Optimization
─────────────────────────────────────────────────────────
Individual Operations:    142
Batch Operations:        8
Total SQL Operations:    150
Reduction:              92.3% ✅

⚡ Performance by Entity Type
─────────────────────────────────────────────────────────
Entity          Count    Time     Ops    ms/item
audiences         127    0.8s      2      6.3ms
events            342    1.2s      4      3.5ms
experiments        89    0.5s      1      5.6ms
flags             215    2.1s      3      9.8ms

🕒 Phase Timing Breakdown
─────────────────────────────────────────────────────────
Phase                      Duration    Percentage
Fetching projects           0.5s        4.0%
Syncing audiences           0.8s        6.4%
Syncing events              1.2s        9.6%
Syncing experiments         0.5s        4.0%
Syncing flags               2.1s       16.8%
```

### Targeted Sync for Recovery

Perfect for database locking issues or partial sync failures:

```bash
# Scenario: Database lock left experiments table empty
npm run cache-sync:enhanced -- --tables experiments --verbose

# Scenario: Timestamp conflicts preventing incremental sync
npm run cache-sync:enhanced -- --force --entities experiment audience

# Scenario: Quick recovery of critical tables
npm run cache-sync:enhanced -- --entities flag experiment --force
```

## 🔧 Automatic Database Cleanup System

### Overview

The Enhanced Cache Sync includes a **comprehensive database cleanup system** that automatically resolves common database locking issues, especially in WSL2 environments. This system runs **before every database operation** to ensure clean startup.

### How It Works

```
🔧 Checking for orphaned database connections...
✅ Database cleanup completed successfully
💾 Initializing database...
✓ Database initialized
```

### Key Features

#### 🎯 **Automatic Orphaned Process Detection**
- **Scans for processes** holding database file handles using `lsof`
- **Identifies Node.js, npm, and tsx processes** with SQLite locks
- **Safe termination sequence**: SIGTERM → SIGKILL escalation
- **Real-time feedback** about cleanup progress

#### 🛡️ **WSL2-Specific Handling**
- **Detects WSL2 environment** automatically
- **Suggests Windows filesystem paths** (`/mnt/c/`) for better compatibility
- **Handles WSL2 file locking quirks** and persistence issues
- **Force cleanup mode** for stubborn processes

#### 🔒 **PID Lock File Management**
- **Creates lock files** to track active processes
- **Cleans up stale locks** from dead processes
- **Prevents conflicts** between multiple CLI instances
- **Automatic cleanup** on process exit (SIGINT, SIGTERM, etc.)

### Usage Examples

#### Standard Usage (Automatic)
```bash
# Cleanup happens automatically - no extra flags needed
npm run cache-sync:enhanced

# With verbose output to see cleanup details
npm run cache-sync:enhanced -- --verbose
```

#### Force Cleanup Mode
```bash
# For stubborn database locks or corrupted lock files
npm run cache-sync:enhanced -- --force

# Force mode enables aggressive cleanup:
# - Kills ALL better-sqlite3 processes
# - Removes ALL .lock files
# - More thorough process termination
```

#### Custom Database Paths
```bash
# Cleanup works with any database path
npm run cache-sync:enhanced -- --database-path ./my-custom.db

# WSL2 users - use Windows filesystem for better performance
npm run cache-sync:enhanced -- --database-path /mnt/c/optly-cache/cache.db
```

### Architecture Integration

#### Files Modified
- **`scripts/cache-sync-enhanced.ts`**: Integrated cleanup before database init
- **`src/index.ts`**: MCP server startup cleanup
- **`src/utils/DatabaseCleanupManager.ts`**: Core cleanup implementation

#### Integration Points
```typescript
// Before database initialization
const cleanupManager = new DatabaseCleanupManager({
  dbPath: finalDbPath,
  timeoutMs: 10000,
  forceCleanup: options.force,
  verbose: options.verbose
});

const cleanupSuccess = await cleanupManager.cleanup();
```

### Troubleshooting Common Issues

#### Issue: "unable to open database file"
```bash
# Solution 1: Let cleanup handle it automatically
npm run cache-sync:enhanced

# Solution 2: Use force mode for stubborn locks
npm run cache-sync:enhanced -- --force

# Solution 3: Use Windows filesystem in WSL2
npm run cache-sync:enhanced -- --database-path /mnt/c/temp/cache.db
```

#### Issue: Multiple processes competing for database
```bash
# Lock files prevent conflicts automatically
# If issues persist, use force cleanup:
npm run cache-sync:enhanced -- --force --verbose
```

#### Issue: WSL2 file locking problems
```bash
# Use Windows filesystem path (recommended)
npm run cache-sync:enhanced -- --database-path /mnt/c/optly-cache/cache.db

# Or force cleanup with verbose output
npm run cache-sync:enhanced -- --force --verbose
```

### Benefits

#### 🚀 **Reliability**
- **Eliminates "database locked" errors** that required manual intervention
- **Automatic recovery** from crashed or interrupted sync processes
- **No more manual `kill` commands** for orphaned processes

#### 🔄 **Zero Configuration**
- **Works out of the box** - no setup required
- **Transparent operation** - runs silently unless issues found
- **Backwards compatible** - existing scripts work unchanged

#### 🛠️ **Developer Experience**
- **Clear feedback** about cleanup operations in verbose mode
- **WSL2 optimization suggestions** for better performance
- **Force mode** for emergency situations

## 🔄 Comparison: Basic vs Enhanced

| Feature | Basic Sync | Enhanced Sync |
|---------|------------|---------------|
| **Progress Bars** | ❌ | ✅ Visual progress tracking |
| **Performance Metrics** | ❌ | ✅ Detailed metrics and reports |
| **Targeted Sync** | ❌ | ✅ Table/entity-specific sync |
| **Multi-Project** | ❌ | ✅ Batch multiple projects |
| **Export Reports** | ❌ | ✅ JSON/Markdown exports |
| **Verbose Logging** | Basic | ✅ Rich debugging output |
| **CI/CD Friendly** | ✅ Best | ✅ Works with --no-summary |
| **Resource Usage** | Low | Medium |
| **Dependencies** | Minimal | Includes progress libraries |

## 🛠️ Troubleshooting

### Common Issues

#### 1. **"Database is locked" Error**

**Note**: As of version 2.0.0-beta.1, the system includes enhanced database locking protection with automatic retry mechanisms. However, if you still encounter issues:

```bash
# Use targeted sync to recover specific tables
npm run cache-sync:enhanced -- --force --tables experiments flags

# Or sync tables one at a time to minimize lock contention
npm run cache-sync:enhanced -- --tables experiments
npm run cache-sync:enhanced -- --tables flags
npm run cache-sync:enhanced -- --tables audiences
```

The enhanced sync tool now includes:
- 30-second database timeout (up from 5 seconds)
- Automatic retry with exponential backoff
- WAL mode optimizations for better concurrency
- Operation-level checkpoints to ensure data persistence

#### 2. **Incremental Sync Not Working**
```bash
# Force refresh to reset timestamps
npm run cache-sync:enhanced -- --force
```

#### 3. **Progress Bars Not Showing**
```bash
# Use classic mode for non-TTY environments
npm run cache-sync:enhanced -- --classic
```

#### 4. **Memory Issues with Large Datasets**
```bash
# Sync one project at a time
npm run cache-sync:enhanced -- --project 12345
```

### Debug Mode
```bash
# Maximum verbosity for troubleshooting
npm run cache-sync:enhanced -- --verbose --classic
```

## 🚦 Best Practices

### For Automation/CI/CD
```bash
# Use basic sync for scripts
npm run cache-sync -- --force

# Or enhanced with no-summary for cleaner logs
npm run cache-sync:enhanced -- --force --no-summary
```

### For Daily Use
```bash
# Quick sync with progress
npm run cache-sync:enhanced

# Incremental sync for regular updates
npm run cache-sync:enhanced -- --incremental
```

### For Recovery Operations
```bash
# Targeted sync for specific issues
npm run cache-sync:enhanced -- --tables experiments --force --verbose
```

### For Performance Analysis
```bash
# Full sync with detailed reporting
npm run cache-sync:enhanced -- --export ./reports --verbose
```

## 📋 Quick Reference Card

```bash
# Basic Operations
npm run cache-sync                                      # Basic full sync
npm run cache-sync:enhanced                             # Enhanced full sync
npm run cache-sync:enhanced -- --incremental           # Only sync changes

# Targeted Operations  
npm run cache-sync:enhanced -- --list-tables           # Show available tables
npm run cache-sync:enhanced -- --tables experiments    # Sync specific table
npm run cache-sync:enhanced -- --entities flag event   # Sync by entity type

# Project Operations
npm run cache-sync:enhanced -- --project 12345         # Single project
npm run cache-sync:enhanced -- --multi-project 1 2 3   # Multiple projects

# Recovery Operations
npm run cache-sync:enhanced -- --force --tables experiments  # Force refresh table
npm run cache-sync:enhanced -- --force --entities flag       # Force refresh entity

# Analysis Operations
npm run cache-sync:enhanced -- --export ./reports      # Export performance data
npm run cache-sync:enhanced -- --verbose               # Detailed debug output
```

## 🔗 Related Documentation

- [Targeted Sync Guide](./targeted-sync-guide.md) - Deep dive into targeted synchronization
- [Performance Optimization](../implementation/performance-optimization-with-granular-progress-implementation-plan.md) - Technical implementation details
- [Main CLI Guide](./optly-cli-user-guide.md) - Guide for the main `optly` CLI tool

---

*Last Updated: January 2025 - Added targeted sync capabilities and performance enhancements*