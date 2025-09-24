# 🎯 Targeted Database Sync - User Guide

## 🚀 Problem Solved

**Your Use Case:**
> "I want you to synchronize this table and this table only"

When database locking issues occur or change history timestamps don't align, you can now sync specific tables instead of rebuilding the entire database.

## ✅ New CLI Options

### **List Available Options**
```bash
# See all database tables
npm run cache-sync:enhanced -- --list-tables

# See all entity types  
npm run cache-sync:enhanced -- --list-entities
```

### **Sync Specific Tables**
```bash
# Sync only experiments and flags tables
npm run cache-sync:enhanced -- --tables experiments flags

# Sync experiments table for specific project
npm run cache-sync:enhanced -- --project 12345 --tables experiments

# Force clear and resync specific tables
npm run cache-sync:enhanced -- --force --tables experiments audiences
```

### **Sync by Entity Type**
```bash
# Sync only experiment and flag entities (auto-maps to tables)
npm run cache-sync:enhanced -- --entities experiment flag

# Sync specific entities for a project
npm run cache-sync:enhanced -- --project 12345 --entities experiment audience
```

## 🔧 Common Recovery Scenarios

### **Scenario 1: Database Lock Left Tables Out of Sync**
```bash
# Problem: Experiments table empty after failed sync
npm run cache-sync:enhanced -- --tables experiments --verbose

# Result: Only experiments table gets refreshed
```

### **Scenario 2: Change History Timestamp Conflicts**
```bash
# Problem: Some entities have wrong timestamps, incremental sync skips them
npm run cache-sync:enhanced -- --force --entities experiment audience

# Result: Force clears and resyncs only those entity types
```

### **Scenario 3: Specific Project Data Missing**
```bash
# Problem: Project 12345 missing experiments after concurrent operation
npm run cache-sync:enhanced -- --project 12345 --tables experiments flags

# Result: Refreshes only experiments and flags for that specific project
```

### **Scenario 4: Quick Recovery of Critical Tables**
```bash
# Problem: Need flags and experiments back online immediately
npm run cache-sync:enhanced -- --entities flag experiment --force

# Result: Fast targeted sync without touching other tables
```

## 📊 Performance Benefits

### **Before (Full Sync)**
- ❌ Sync all 20+ tables even if only 1 needs fixing
- ❌ 5-10 minutes for full database rebuild
- ❌ Risk of introducing new sync conflicts

### **After (Targeted Sync)**  
- ✅ Sync only the tables you specify
- ✅ 30 seconds - 2 minutes for targeted refresh
- ✅ No impact on working tables

## 🎯 Table to Entity Mapping

| Entity Type | Database Table | Description |
|-------------|----------------|-------------|
| `flag` | `flags` | Feature flags |
| `experiment` | `experiments` | A/B test experiments |
| `campaign` | `campaigns` | Web experimentation campaigns |
| `audience` | `audiences` | User targeting segments |
| `event` | `events` | Conversion tracking events |
| `variation` | `variations` | Feature flag variations |
| `variable_definition` | `variable_definitions` | Flag variable schemas |
| `rule` | `rules` | Targeting rules |
| `ruleset` | `rulesets` | Rule collections |
| `page` | `pages` | Web page definitions |
| `attribute` | `attributes` | User attributes |
| `environment` | `environments` | Project environments |

## 🚨 Important Notes

### **Choose One Approach**
```bash
# ✅ Good: Use tables
npm run cache-sync:enhanced -- --tables experiments flags

# ✅ Good: Use entities  
npm run cache-sync:enhanced -- --entities experiment flag

# ❌ Error: Don't mix both
npm run cache-sync:enhanced -- --tables experiments --entities flag
```

### **Force Option Behavior**
```bash
# With --force: Clears target tables first, then syncs
npm run cache-sync:enhanced -- --force --tables experiments

# Without --force: Merges/updates existing data
npm run cache-sync:enhanced -- --tables experiments
```

### **Foreign Key Relationships**
The system preserves foreign key relationships. When syncing child tables (like `variations`), ensure parent tables (like `flags`) are also synced or already present.

## 📋 Quick Reference Commands

```bash
# Discovery
npm run cache-sync:enhanced -- --list-tables     # Show available tables
npm run cache-sync:enhanced -- --list-entities   # Show available entities

# Common Recovery Patterns
npm run cache-sync:enhanced -- --tables experiments flags    # Fix experiment data
npm run cache-sync:enhanced -- --entities audience event     # Fix targeting data  
npm run cache-sync:enhanced -- --project 12345 --force --tables experiments  # Project-specific fix

# Full Options
npm run cache-sync:enhanced -- --project 12345 --force --verbose --tables experiments audiences events
```

## 🎉 Real-World Usage

**Example: After Database Locking Issue**
```bash
# 1. Check what tables exist
npm run cache-sync:enhanced -- --list-tables

# 2. Sync only the problematic tables
npm run cache-sync:enhanced -- --verbose --tables experiments flags variations

# 3. Verify with your application that data is now available
```

**Example: Timestamp Conflict Recovery**
```bash
# Force refresh specific entities to bypass timestamp checks
npm run cache-sync:enhanced -- --force --entities experiment audience event
```

This targeted sync capability gives you surgical precision to fix database issues without waiting for full synchronization cycles.