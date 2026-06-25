# 📊 Analytics Guide - Query Your Data Effectively

## 🎯 Overview

The Optimizely MCP Server provides **14 high-performance analytics views** that let you query your data efficiently. This guide shows you how to use them effectively.

## 🗃️ Available Data Views

### **🚩 Feature Flag Views**
| View | Purpose | Common Use Cases |
|------|---------|------------------|
| **flags_unified_view** | All flags with environment status | "Show me all flags", "Flags by environment" |
| **flag_variations_flat** | Flag variation details with variables | "Show variations for flag X" |
| **flag_variation_variables** | Individual variable values (one row per variable) | "Find flags with variable Y" |
| **flag_variables_summary** | Summary of variables by flag | "Which flags use most variables?" |
| **flag_state_history_view** | Flag enable/disable timeline | "When was flag X enabled?" |

### **🧪 Experiment Views**
| View | Purpose | Common Use Cases |
|------|---------|------------------|
| **experiments_unified_view** | All experiments across platforms | "Show running experiments", "Experiments by project" |
| **experiment_audiences_flat** | Experiment-audience relationships | "Which experiments target audience X?" |
| **experiment_events_flat** | Experiment metrics/events | "Show experiment conversion events" |
| **experiment_pages_flat** | Experiment-page relationships | "Experiments running on page X" |

### **🎯 Targeting & Configuration Views**
| View | Purpose | Common Use Cases |
|------|---------|------------------|
| **audiences_flat** | Audience definitions | "Show all audiences", "Audiences using attribute X" |
| **pages_flat** | Page configurations | "Show all pages", "Pages with activation rules" |

### **📈 Analytics & Usage Views**
| View | Purpose | Common Use Cases |
|------|---------|------------------|
| **entity_usage_view** | Cross-entity usage tracking | "Which entities are unused?", "Adoption rates" |
| **analytics_summary_view** | High-level analytics summary | "Project overview", "Usage statistics" |
| **change_history_flat** | Complete audit log | "Recent changes", "Who changed what?" |

## 🔍 Query Patterns

### **Basic Data Retrieval**

#### **View All Items**
```
"Show me all feature flags"
→ Uses: flags_unified_view
→ Returns: All flags with basic info
```

#### **Project-Specific Queries**
```
"Show me flags for project 12345"
→ Uses: flags_unified_view + project filter
→ Returns: Only flags from that project
```

#### **Status Filtering**
```
"Show me enabled flags in production"
→ Uses: flags_unified_view + environment + status filters
→ Returns: Active flags in production environment
```

### **Advanced Analytics**

#### **Counting and Grouping**
```
"Get the total count of flags for each environment"
→ Uses: flags_unified_view + GROUP BY environment
→ Returns: Environment → Flag count mapping
```

#### **Time-Based Analysis**
```
"Show me flags created in the last 30 days"
→ Uses: flags_unified_view + date filter
→ Returns: Recently created flags
```

#### **Cross-Entity Analysis**
```
"Show me experiments using audience 'mobile_users'"
→ Uses: experiment_audiences_flat + audience filter
→ Returns: Experiments with that audience
```

### **Variable and Configuration Queries**

#### **Variable Discovery**
```
"Give me a list of flags that have a variable named 'cdnVariationSettings'"
→ Uses: flag_variation_variables + variable name filter
→ Returns: Flags using that specific variable
```

#### **Usage Analysis**
```
"Show me the usage view for project 12345"
→ Uses: entity_usage_view + project filter
→ Returns: Adoption and usage statistics
```

## 🎯 Filtering Techniques

### **Environment Filtering**
```
✅ "Show flags in production environment"
✅ "Compare staging vs production settings"
```

### **Status Filtering**
```
✅ "Show only enabled flags"
✅ "Show only running experiments"
✅ "Show archived items"
```

### **Date Filtering**
```
✅ "Show flags created in last 30 days"
✅ "Show recent changes"
✅ "Show items modified this week"
```

### **Attribute Filtering**
```
✅ "Show audiences using attribute 'building_type'"
✅ "Show experiments tracking event 'purchase_completed'"
```

## 📈 Aggregation and Analysis

### **Counting**
```
"Get total count of flags by environment"
"Count experiments by status"
"How many audiences use each attribute?"
```

### **Grouping**
```
"Group flags by project and environment"
"Show experiments grouped by status"
"Group pages by activation type"
```

### **Performance Analysis**
```
"Show experiment results with statistical significance"
"Which flags have the highest adoption?"
"What experiments are performing best?"
```

## 🔧 Advanced Query Techniques

### **Multi-View Analysis**
```
"Show me flags and their associated experiments"
→ Combines: flags_unified_view + experiments_unified_view
```

### **Cross-Project Comparison**
```
"Compare flag usage between project A and B"
→ Uses: entity_usage_view + project filters
```

### **Historical Analysis**
```
"Show flag changes over the last month"
→ Uses: change_history_flat + date range
```

### **Dependency Tracking**
```
"Which experiments depend on audience X?"
→ Uses: experiment_audiences_flat + audience filter
```

## 💡 Query Optimization Tips

### **1. Be Specific with Projects**
```
✅ Good: "Show flags for project 12345"
❌ Slow: "Show all flags everywhere"
```

### **2. Use Appropriate Views**
```
✅ For flag overview: flags_unified_view
✅ For variable details: flag_variation_variables
✅ For usage stats: entity_usage_view
```

### **3. Filter Early**
```
✅ "Show enabled flags in project 12345"
❌ "Show all flags" → then ask for filtering
```

### **4. Leverage Pagination**
```
✅ "Show first 25 flags"
✅ "Get next page of results"
```

## 🚀 Next Steps

- **[Export Guide](EXPORT-GUIDE.md)** - Save your analysis results
- **[Workflows Guide](WORKFLOWS-GUIDE.md)** - Complete real-world examples
- **[Query Reference](QUERY-REFERENCE.md)** - Complete view documentation

## 📋 Common Troubleshooting

### **No Results Returned**
- Check project ID is correct
- Verify filters aren't too restrictive
- Try broader query first, then add filters

### **Too Many Results**
- Add project filter: "for project X"
- Use status filter: "only enabled" or "only running"
- Add date filter: "created in last 30 days"

### **Need More Detail**
- Ask for specific entity details
- Use different view (e.g., variables view for variable info)
- Export results for external analysis

---

**💡 Remember**: Start with broad queries, then refine with filters. The system is designed to handle complex analysis efficiently! 