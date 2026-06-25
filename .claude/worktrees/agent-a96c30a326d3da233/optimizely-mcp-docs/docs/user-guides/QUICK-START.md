# ⚡ Quick Start Guide - 5 Minutes to Success

## 🎯 Before You Begin

**Prerequisites**: Your IT team has already:
- ✅ Installed the MCP server
- ✅ Configured your Optimizely API token
- ✅ Connected your AI assistant (Claude, ChatGPT, etc.)

## 🚀 Your First 3 Queries

### 1. **See What You Have Access To**
```
"Show me all my Optimizely projects"
```
**What happens**: Lists all projects you can access, showing project names, IDs, and platform types (Feature vs Web Experimentation).

### 2. **View Your Feature Flags**
```
"Show me feature flags for project [PROJECT_ID]"
```
**Replace [PROJECT_ID]** with an actual project ID from step 1.

**What happens**: Shows all flags in that project with their current status (enabled/disabled) across environments.

### 3. **Check Running Experiments**
```
"What experiments are currently running?"
```
**What happens**: Lists active A/B tests with their status, traffic allocation, and duration.

## 🎯 Understanding the System

### How Queries Work
1. **You ask** in plain English
2. **AI translates** to structured query format
3. **System processes** against 14 analytics views
4. **You get** formatted results instantly

### What "Structured Queries" Means
- The system uses **JSON-based queries** (not natural language processing)
- Your AI assistant handles the technical translation
- You just ask questions normally - the AI does the rest

## 📊 Most Common Questions

### **Project Management**
- "Show me all my projects"
- "What type of project is [PROJECT_ID]?"

### **Feature Flags**
- "Show me flags in project [PROJECT_ID]"
- "Which flags are enabled in production?"
- "What flags changed this week?"

### **Experiments**
- "Show me running experiments"
- "What experiments are in project [PROJECT_ID]?"
- "Show me experiment results with statistical significance"

### **Data Analysis**
- "Get flag count by environment"
- "Show me flags created in the last 30 days"
- "Export this data to CSV"

## 🎯 Pro Tips for Success

### **1. Start Broad, Get Specific**
```
❌ Don't: "Show me flag abc123 variation traffic in production environment"
✅ Do: "Show me flags for project X" → "Show details for flag abc123"
```

### **2. Use Project IDs**
```
❌ Don't: "Show flags in my e-commerce project"  
✅ Do: "Show flags for project 12345"
```

### **3. Ask for Help**
```
✅ "What fields are available for flags?"
✅ "What can I query about experiments?"
✅ "How do I export this data?"
```

### **4. Filter Results**
```
✅ "Show only enabled flags"
✅ "Show flags created in last 30 days"
✅ "Show experiments with status running"
```

## 🔄 Next Steps

### **Ready for More?**
- **[Analytics Guide](ANALYTICS-GUIDE.md)** - Learn all query capabilities
- **[Workflows Guide](WORKFLOWS-GUIDE.md)** - Follow complete real-world examples
- **[Query Reference](QUERY-REFERENCE.md)** - See all available data views

### **Common Follow-up Tasks**
1. **Export Data**: "Export this list to CSV"
2. **Create Entities**: See [Workflows Guide](WORKFLOWS-GUIDE.md) for step-by-step
3. **Advanced Analytics**: Filter, group, and aggregate your data

## ⚠️ Important Notes

- **Read-Only Access**: You can view and analyze data safely
- **Project-Specific**: Always specify project IDs for accurate results
- **Real-Time Data**: Information reflects current Optimizely state
- **Export Ready**: All results can be exported to CSV, JSON, or YAML

---

**🎉 You're Ready!** Start with "Show me all my Optimizely projects" and explore from there. 