# 🔄 Complete Workflows Guide - Real-World Examples That Work

**Based on actual tested prompts that work perfectly with the Optimizely MCP Server**

## 🎯 Overview

This guide contains **complete, tested workflows** that you can follow step-by-step. Each example has been verified to work with the current system.

---

## 🚩 **Feature Experimentation Workflows**

### **Workflow 1: Complete Project Setup**

#### **Step 1: Create Project**
```
"I need to create a new Optimizely project called 'E-commerce Testing Platform' for feature experimentation. Can you help me set this up?"
```
**What happens**: Creates a new Feature Experimentation project ready for flags and A/B tests.

#### **Step 2: Create Custom Attribute**
```
"In the project we just created, I want to track user segments based on their building type. Please create a custom attribute called 'building_type' that we can use for audience targeting."
```
**What happens**: Creates a custom attribute for user segmentation.

#### **Step 3: Create Conversion Event**
```
"We need to track when users complete purchases. Can you create a custom event called 'purchase_completed' in our project? This will be used to measure conversion rates."
```
**What happens**: Sets up conversion tracking for your experiments.

#### **Step 4: Create Targeted Audience**
```
"I want to target users who are in office buildings. Create an audience called 'Office Building Users' that targets users where the building_type attribute equals 'office'. Use the attribute we created earlier."
```
**What happens**: Creates a targeted audience using your custom attribute.

### **Workflow 2: Advanced A/B Test Creation**

#### **Step 5: Create Flag with A/B Test**
```
"Let's create a feature flag for testing our new checkout flow. Call it 'enhanced_checkout_flow'. I want to run an A/B test with three variations:
- control (the current checkout)
- treatment (new streamlined checkout)  
- variation_1 (checkout with progress bar)

Make sure to:
- Target only the 'Office Building Users' audience we just created
- Track conversions using the 'purchase_completed' event with unique visitor counting
- Split traffic evenly between all variations"
```
**What happens**: Creates a complex A/B test with multiple variations, audience targeting, and conversion tracking.

#### **Step 6: Add Fourth Variation** 
```
"I want to add a fourth variation to the enhanced_checkout_flow flag. Call it 'express_checkout' and give it 50% of the traffic. The remaining three variations should share the other 50% equally."
```
**What happens**: Adds new variation and automatically rebalances traffic distribution.

#### **Step 7: Update Metric Aggregator**
```
"Actually, I think we should track total purchases instead of unique visitors. Can you update the metric on the enhanced_checkout_flow flag to use total count instead of unique count for the purchase_completed event?"
```
**What happens**: Changes the measurement methodology for more accurate tracking.

#### **Step 8: Remove Variation and Rebalance**
```
"The treatment variation isn't performing well. Please remove it from the enhanced_checkout_flow flag and redistribute the traffic equally among the remaining three variations (control, variation_1, and express_checkout)."
```
**What happens**: Removes underperforming variation and rebalances traffic automatically.

#### **Step 9: Update Flag Description**
```
"Can you update the description of the enhanced_checkout_flow flag to: 'Newly updated description - Testing express checkout against standard flows with progress indicators'"
```
**What happens**: Updates flag metadata for better documentation.

#### **Step 10: Create Simple Flag**
```
"One more thing - I need a basic feature flag without any A/B testing. Just create a simple flag called 'simple_flag_test' that I can turn on and off."
```
**What happens**: Creates a simple on/off feature flag for basic feature toggling.

---

## 🌐 **Web Experimentation Workflows**

### **Workflow 3: Web Project Setup**

#### **Step 1: Create Web Project**
```
"I need to create a new Optimizely project called 'Optimizely Project V101' for web experimentation. Can you help me set this up?"
```
**What happens**: Creates a Web Experimentation project for traditional A/B testing.

#### **Step 2-4: Create Supporting Entities**
```
"In the project we just created, I want to track user segments based on their building type. Please create a custom attribute called 'web_building_type' that we can use for audience targeting."

"We need to track when users complete purchases. Can you create a custom event called 'web_purchase_completed' in our project? This will be used to measure conversion rates."

"I want to target users who are in office buildings. Create an audience called 'Web Office Building Users' that targets users where the web_building_type attribute equals 'office'. Use the attribute we created earlier."
```
**What happens**: Sets up all supporting entities for web experimentation.

#### **Step 5: Create Page Configuration**
```
"Create a new page with when the url changes activation with a url condition of www.homepage.com/products as a substring match and the editor url as www.homepage.com/products/1/shoes"
```
**What happens**: Configures page targeting with URL conditions for web experiments.

### **Workflow 4: Web Experiment Management**

#### **Step 6: Create Web Experiment**
```
"Let's create a web experiment for testing our new checkout flow. Call it 'web_enhanced_checkout_flow'. I want to run an A/B test with four variations:
- control (the current checkout)
- treatment (new streamlined checkout) 
- variation_progress_bar (checkout with progress bar)
- variation_banner (checkout with urgency banner)

Make sure to:
- Target only the 'Web Office Building Users' audience we just created
- Track conversions using the 'purchase_completed' event with unique visitor counting
- Split traffic evenly between all variations"
```
**What happens**: Creates a complex web experiment with multiple variations and targeting.

#### **Add Additional Variation**
```
"I want to add another variation to the experiment we just created. Call it 'express_checkout' and give it 40% of the traffic. The remaining variations should share the other 60% equally."
```
**What happens**: Adds fifth variation with custom traffic allocation.

#### **Steps 7-9: Update and Optimize**
```
"Actually, I think we should track total purchases instead of unique visitors. Can you update the metric on the enhanced_checkout_flow flag to use total count instead of unique count for the purchase_completed event?"

"The treatment variation isn't performing well. Please remove it from the experiment and redistribute the traffic equally among the remaining variations"

"Can you update the description of the experiment to: 'Newly updated description - Testing express checkout against standard flows'"
```
**What happens**: Updates metrics, removes underperforming variation, and updates documentation.

---

## 📊 **Analytics Workflows**

### **Workflow 5: Comprehensive Data Analysis**

#### **Basic Project Analytics**
```
"Using the analyze data tool get the total count of flags for each environment in the newly created project"

"Using the analyze data tool get the total count of flags for each environment in the Akamai Project"

"Using the analyze data tool give me a list of flags in the Akamai project ordered by environment"
```

#### **Data Export**
```
"Export this list in yaml format"
"Export in CSV and JSON too"
```

#### **Advanced Filtering**
```
"Give me a list of attributes in the same project"

"Using the analyze data tool get a list of flags that are not enabled in the Akamai project"
"Get page 2"
"Get 75 more"
"Export this list to JSON, CSV and YAML"

"Using the analyze data tool get a list of flags that are enabled in the Akamai project"

"Using the analyze data tool get me a list of flags that where created in the last 30 days"
```

#### **Cross-Project Analysis**
```
"Get me a list of Web Experimentation Projects"

"Get me the total count of pages by web experimentation projects"

"Give me a list of pages that use when the dom changes for activation in the Attic and Button project"
```

#### **Variable and Configuration Queries**
```
"Give me a list of flags that have a variable named cdnVariationSettings in the Akamai project"

"Using the analyze data tool get me a list of variables in the Akamai project"

"Using the analyze data tool get a a list of flags targeted delivery rulesets"
```

#### **Usage and Performance Analysis**
```
"Using the analyze data tool get me the usage view in the Attic and Button project"
"Get me 50 more records"

"Using the analyze data tool get me the total count of types by activation rules"

"Do I have any flags that contain the word cloudflare in the Akamai project"

"Using the analyze data tool get me the total count of page by types of activation in the Attic and Button project"

"Using the analyze data tool get me a list of audiences in all my projects that use attributes"

"Using the analyze data tool get a a list of web experiments in the Attic and Button project that use javascript in shared or variation code"
```

---

## 🎯 **Workflow Tips for Success**

### **1. Follow the Order**
- **Create projects first** before adding entities
- **Set up attributes and events** before creating audiences
- **Create audiences** before targeting experiments
- **Test simple** before going complex

### **2. Use Descriptive Names**
- Include project/purpose in names
- Use consistent naming conventions
- Add version numbers for iterations

### **3. Leverage Templates**
- The system provides guided templates for complex operations
- Let the AI handle technical details
- Focus on business requirements

### **4. Monitor and Iterate**
- Use analytics to track performance
- Remove underperforming variations
- Update configurations based on results

### **5. Export for Analysis**
- Export results in multiple formats
- Use CSV for spreadsheet analysis
- Use JSON for technical integration

## 🚀 **Next Steps**

After completing these workflows:

1. **[Export Guide](EXPORT-GUIDE.md)** - Save and share your results
2. **[Query Reference](QUERY-REFERENCE.md)** - Explore all available data
3. **[Analytics Guide](ANALYTICS-GUIDE.md)** - Master advanced querying

## ⚠️ **Important Notes**

- **All examples tested**: These workflows have been verified to work
- **Template mode**: Complex operations use guided templates automatically
- **Automatic rebalancing**: Traffic allocation updates automatically
- **Real-time updates**: Changes reflect immediately in system
- **Export ready**: All results can be exported for further analysis

---

**🎉 Success Guarantee**: Follow these workflows exactly as written for guaranteed results! 