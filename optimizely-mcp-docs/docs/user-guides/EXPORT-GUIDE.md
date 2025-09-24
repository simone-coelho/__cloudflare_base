# 📤 Export Guide - Get Your Data Out

## 🎯 Overview

The Optimizely MCP Server makes it easy to export your analysis results in multiple formats. This guide shows you how to get your data for external analysis, reporting, or integration.

## 📋 Supported Export Formats

### **📊 CSV (Comma-Separated Values)**
- **Best for**: Excel analysis, reporting dashboards
- **Use when**: You need tabular data for spreadsheets
- **File extension**: `.csv`

### **🔧 JSON (JavaScript Object Notation)**
- **Best for**: Technical integration, APIs, databases
- **Use when**: You need structured data for programming
- **File extension**: `.json`

### **📝 YAML (YAML Ain't Markup Language)**
- **Best for**: Human-readable configuration, documentation
- **Use when**: You need readable structured data
- **File extension**: `.yaml` or `.yml`

## 🚀 How to Export Data

### **Method 1: Export After Query**
1. **Run your query** first:
   ```
   "Show me all flags for project 12345"
   ```

2. **Then export** the results:
   ```
   "Export this to CSV"
   "Export this to JSON"
   "Export this to YAML"
   ```

### **Method 2: Query and Export in One Step**
```
"Show me all flags for project 12345 and export to CSV"
"Get running experiments and export to JSON"
"List all audiences and export to YAML"
```

## 📊 Export Examples

### **Feature Flags Export**

#### **CSV Export**
```
"Show me all flags for project 12345"
"Export this list to CSV"
```
**Result**: Tabular format perfect for Excel analysis

#### **JSON Export**
```
"Show enabled flags in production"
"Export this to JSON"
```
**Result**: Structured data for technical integration

#### **YAML Export**
```
"Show flags created in last 30 days"
"Export this to YAML"
```
**Result**: Human-readable format for documentation

### **Experiments Export**

#### **Running Experiments**
```
"Show running experiments"
"Export to CSV and JSON"
```
**Result**: Multiple formats for different use cases

#### **Experiment Results**
```
"Show experiment results with statistical significance"
"Export to Excel format"
```
**Result**: CSV format optimized for spreadsheet analysis

### **Analytics Export**

#### **Usage Statistics**
```
"Show usage statistics for project 12345"
"Export to all formats"
```
**Result**: CSV, JSON, and YAML files for comprehensive analysis

#### **Change History**
```
"Show changes in last 7 days"
"Export this audit trail to JSON"
```
**Result**: Structured audit data for compliance reporting

## 🔧 Advanced Export Features

### **Custom Field Selection**
```
"Show flags for project 12345 but only flag_key, flag_name, and enabled fields"
"Export this to CSV"
```
**Result**: Streamlined export with only needed fields

### **Filtered Exports**
```
"Show only enabled flags in production environment"
"Export this filtered list to JSON"
```
**Result**: Export only the data that matches your criteria

### **Large Dataset Exports**
```
"Show all flags for project 12345"
"Get all pages of results"
"Export complete dataset to CSV"
```
**Result**: Full dataset export regardless of pagination

## 📁 Export File Management

### **Automatic File Naming**
The system automatically names your export files:
- **CSV**: `flags_export_2024-01-15.csv`
- **JSON**: `experiments_export_2024-01-15.json`
- **YAML**: `audiences_export_2024-01-15.yaml`

### **Custom File Names**
```
"Export this to CSV as 'production_flags_january.csv'"
"Save this JSON export as 'experiment_results_q4.json'"
```

### **Output Locations**
- Files are saved to the configured export directory
- Default location: `./exports/`
- Check with your IT team for specific location

## 🎯 Format-Specific Guidelines

### **📊 CSV Best Practices**

#### **When to Use CSV**
- Excel analysis and pivot tables
- Dashboard imports (Tableau, PowerBI)
- Simple data sharing with business users

#### **CSV Advantages**
- Universal compatibility
- Easy to view and edit
- Perfect for numerical analysis

#### **Example CSV Output**
```csv
flag_key,flag_name,enabled,environment_key,project_id
checkout_flow,Enhanced Checkout,true,production,12345
mobile_nav,Mobile Navigation,false,staging,12345
```

### **🔧 JSON Best Practices**

#### **When to Use JSON**
- API integration and automation
- Database imports
- Technical documentation

#### **JSON Advantages**
- Preserves data structure
- Easy to parse programmatically
- Supports nested objects

#### **Example JSON Output**
```json
{
  "flags": [
    {
      "flag_key": "checkout_flow",
      "flag_name": "Enhanced Checkout",
      "enabled": true,
      "environment_key": "production",
      "project_id": "12345",
      "variations": [
        {
          "variation_key": "control",
          "traffic_allocation": 5000
        }
      ]
    }
  ]
}
```

### **📝 YAML Best Practices**

#### **When to Use YAML**
- Configuration documentation
- Human-readable reports
- Version control and diffs

#### **YAML Advantages**
- Most readable format
- Great for documentation
- Easy to version and diff

#### **Example YAML Output**
```yaml
flags:
  - flag_key: checkout_flow
    flag_name: Enhanced Checkout
    enabled: true
    environment_key: production
    project_id: "12345"
    variations:
      - variation_key: control
        traffic_allocation: 5000
```

## 🚀 Common Export Workflows

### **Weekly Reporting**
```
1. "Show flags changed in last 7 days"
2. "Export to CSV"
3. Send to stakeholders for review
```

### **Technical Integration**
```
1. "Show all experiment configurations"
2. "Export to JSON"
3. Import into monitoring system
```

### **Compliance Audit**
```
1. "Show change history for last quarter"
2. "Export complete audit trail to JSON"
3. Archive for compliance records
```

### **Performance Analysis**
```
1. "Show experiment results with statistical significance"
2. "Export to CSV"
3. Analyze in Excel/Google Sheets
```

## 💡 Export Tips & Tricks

### **1. Export Large Datasets**
```
"Show all flags for project 12345"
"Get all pages" 
"Export complete dataset to CSV"
```

### **2. Multiple Format Export**
```
"Export this to CSV, JSON, and YAML"
```

### **3. Filtered Exports**
```
"Show only the data I need, then export"
```

### **4. Verify Before Export**
```
"Show first 5 results"
"If this looks right, export all to CSV"
```

## ⚠️ Important Notes

- **Export Limits**: Large datasets may take time to process
- **File Permissions**: Ensure you have write access to export directory
- **Data Freshness**: Exports reflect real-time data at time of query
- **Format Compatibility**: Choose format based on your analysis tool

## 🆘 Troubleshooting

### **Export Not Working**
- Check file permissions in export directory
- Verify sufficient disk space
- Try smaller dataset first

### **File Not Found**
- Check configured export directory
- Verify file naming convention
- Ask IT team about export location

### **Format Issues**
- Use CSV for spreadsheet compatibility
- Use JSON for technical integration
- Use YAML for human readability

## 🚀 Next Steps

- **[Analytics Guide](ANALYTICS-GUIDE.md)** - Learn to query more data
- **[Workflows Guide](WORKFLOWS-GUIDE.md)** - Follow complete examples
- **[Query Reference](QUERY-REFERENCE.md)** - Explore all available data

---

**💡 Pro Tip**: Always verify your query results before exporting large datasets. Use "Show first 10 results" to check your filters! 