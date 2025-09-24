# 📖 Query Reference - All Available Data Views

## 🎯 Quick Reference

The Optimizely MCP Server provides **14 analytics views** for querying your data. Use this reference to understand what data is available and how to access it.

## 🗃️ Complete View Reference

### **🚩 Feature Flag Views**

#### **flags_unified_view** (Primary Flag View)
**Purpose**: Complete flag information with environment status  
**Alias**: `flags`

**Common Queries**:
```
"Show me all flags for project 12345"
"Show enabled flags in production environment"
"Get flag count by environment"
```

**Key Fields**: flag_key, flag_name, enabled, environment_key, project_id, rollout_percentage

---

#### **flag_variations_flat**
**Purpose**: Flag variation details with variable information

**Common Queries**:
```
"Show variations for flag [flag_key]"
"List all variations in project 12345"
```

**Key Fields**: flag_key, variation_key, variation_name, variables

---

#### **flag_variation_variables**
**Purpose**: Individual variable values (one row per variable)

**Common Queries**:
```
"Find flags with variable named 'cdnVariationSettings'"
"Show all variables in project 12345"
"List flags using variable type 'string'"
```

**Key Fields**: flag_key, variation_key, variable_name, variable_value, variable_type

---

#### **flag_variables_summary**
**Purpose**: Summary of variable usage by flag

**Common Queries**:
```
"Which flags use the most variables?"
"Show variable counts by flag"
```

**Key Fields**: flag_key, variable_count, variable_types

---

#### **flag_state_history_view**
**Purpose**: Flag enable/disable timeline  
**Alias**: `flag_states`

**Common Queries**:
```
"When was flag [flag_key] last enabled?"
"Show flag changes in the last 7 days"
```

**Key Fields**: flag_key, environment_key, enabled, changed_time, changed_by

---

### **🧪 Experiment Views**

#### **experiments_unified_view** (Primary Experiment View)
**Purpose**: All experiments across both platforms  
**Alias**: `experiments`

**Common Queries**:
```
"Show running experiments"
"List experiments in project 12345"
"Show experiments with status 'paused'"
```

**Key Fields**: experiment_id, experiment_name, status, project_id, platform, traffic_percentage

---

#### **experiment_audiences_flat**
**Purpose**: Experiment-audience relationships

**Common Queries**:
```
"Which experiments target audience 'mobile_users'?"
"Show audience targeting for experiment [experiment_id]"
```

**Key Fields**: experiment_id, audience_id, audience_name, targeting_conditions

---

#### **experiment_events_flat**
**Purpose**: Experiment metrics and conversion events  
**Alias**: `events`

**Common Queries**:
```
"Show conversion events for experiment [experiment_id]"
"List all tracked events in project 12345"
```

**Key Fields**: experiment_id, event_id, event_name, aggregator, winning_direction

---

#### **experiment_pages_flat**
**Purpose**: Experiment-page relationships

**Common Queries**:
```
"Which experiments run on page [page_id]?"
"Show page targeting for experiment [experiment_id]"
```

**Key Fields**: experiment_id, page_id, page_name, activation_type

---

### **🎯 Targeting & Configuration Views**

#### **audiences_flat**
**Purpose**: Audience definitions and conditions  
**Alias**: `audiences`

**Common Queries**:
```
"Show all audiences in project 12345"
"Find audiences using attribute 'building_type'"
"List audiences with complex conditions"
```

**Key Fields**: audience_id, audience_name, conditions, project_id, attributes_used

---

#### **pages_flat**
**Purpose**: Page configurations and activation rules  
**Alias**: `pages`

**Common Queries**:
```
"Show all pages in project 12345"
"Find pages with URL activation"
"List pages using 'dom_changed' activation"
```

**Key Fields**: page_id, page_name, activation_type, url_conditions, project_id

---

### **📈 Analytics & Usage Views**

#### **entity_usage_view**
**Purpose**: Cross-entity usage tracking and adoption  
**Alias**: `usage`

**Common Queries**:
```
"Show usage statistics for project 12345"
"Which entities are unused?"
"Get adoption rates by entity type"
```

**Key Fields**: entity_type, entity_id, usage_count, last_used, is_active

---

#### **analytics_summary_view**
**Purpose**: High-level project analytics summary

**Common Queries**:
```
"Show project overview for 12345"
"Get summary statistics"
```

**Key Fields**: project_id, total_flags, total_experiments, active_tests

---

#### **change_history_flat**
**Purpose**: Complete audit log of all changes  
**Alias**: `history`

**Common Queries**:
```
"Show recent changes in project 12345"
"Who changed flag [flag_key] last week?"
"List all changes by user [user_email]"
```

**Key Fields**: entity_type, entity_id, change_type, changed_by, change_time, project_id

---

## 🔍 Query Patterns

### **Basic Patterns**

#### **View All Items**
```
"Show me all [entity_type]"
"List [entity_type] for project [project_id]"
```

#### **Filter by Status**
```
"Show enabled flags"
"Show running experiments"
"Show active audiences"
```

#### **Filter by Time**
```
"Show [entity_type] created in last 30 days"
"Show changes since yesterday"
```

### **Advanced Patterns**

#### **Counting and Grouping**
```
"Get total count of [entity_type] by [field]"
"Group [entity_type] by [field]"
```

#### **Cross-View Analysis**
```
"Show experiments using audience [audience_name]"
"Find flags with variable [variable_name]"
"Which pages use activation type [type]"
```

#### **Usage Analysis**
```
"Show usage statistics for project [project_id]"
"Which [entity_type] are unused?"
```

## 🎯 Field Discovery

### **Get Available Fields**
```
"What fields are available for [view_name]?"
"Show me the structure of flags_unified_view"
```

### **Field Auto-Correction**
The system automatically corrects common field name variations:
- `flagKey` → `flag_key`
- `experimentName` → `experiment_name`  
- `id` → `flag_id` or `experiment_id` (context-aware)

## 🔧 Advanced Filtering

### **Comparison Operators**
```
"Show flags where rollout_percentage > 50"
"Show experiments where traffic_percentage < 100"
```

### **Text Search**
```
"Show flags containing 'checkout' in name"
"Find experiments with 'mobile' in description"
```

### **Multiple Values**
```
"Show flags where environment_key in ['production', 'staging']"
"Show experiments where status in ['running', 'paused']"
```

### **Boolean Values**
```
"Show flags where enabled = true"
"Show experiments where archived = false"
```

## 📊 Export Options

### **Supported Formats**
- **CSV**: `"Export this to CSV"`
- **JSON**: `"Export this to JSON"`
- **YAML**: `"Export this to YAML"`

### **Pagination**
- **Next Page**: `"Get next page"`
- **More Results**: `"Get 50 more"`
- **Specific Count**: `"Show first 25 results"`

## 💡 Pro Tips

### **1. Always Specify Project**
```
✅ "Show flags for project 12345"
❌ "Show all flags everywhere"
```

### **2. Use Aliases for Speed**
```
✅ "Show experiments" (uses experiments_unified_view)
✅ "Show flags" (uses flags_unified_view)
```

### **3. Combine Filters**
```
✅ "Show enabled flags in production for project 12345"
```

### **4. Export Large Results**
```
✅ "Export flags to CSV" (for analysis in Excel)
✅ "Export to JSON" (for technical integration)
```

## 🚀 Quick Commands

| Need | Command |
|------|---------|
| **All projects** | `"Show me all my projects"` |
| **Project flags** | `"Show flags for project [ID]"` |
| **Running tests** | `"Show running experiments"` |
| **Recent changes** | `"Show changes in last 7 days"` |
| **Export results** | `"Export this to CSV"` |
| **More detail** | `"Show details for [entity] [ID]"` |
| **Usage stats** | `"Show usage for project [ID]"` |

---

**🎯 Remember**: Start with the view name that matches your data type, add filters to narrow results, and export for further analysis! 