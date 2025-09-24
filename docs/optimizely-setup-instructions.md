# Optimizely Setup Instructions

## Quick Setup

### 1. Replace SDK Key

Edit `public/optimizely-content.js` and replace the SDK key on line 5:

```javascript
// Replace this:
this.sdkKey = 'YOUR_SDK_KEY_HERE';

// With your actual SDK key:
this.sdkKey = 'YOUR_ACTUAL_SDK_KEY';
```

### 2. Create Feature Flag in Optimizely

1. Log into Optimizely Feature Experimentation
2. Create a new feature flag called: `personalized_banking_content`
3. Add the following variables to the feature:

| Variable Name | Type | Default Value |
|--------------|------|---------------|
| hero_title | string | "Welcome to Better Banking" |
| hero_subtitle | string | "Experience banking that adapts to your needs" |
| hero_cta_text | string | "Get Started" |
| hero_background_color | string | "linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)" |
| hero_background_image | string | "" |
| hero_text_color | string | "#ffffff" |
| promo_title | string | "Open an Account Today" |
| promo_subtitle | string | "Join thousands of satisfied customers" |
| promo_description | string | "Everything you need in one place" |
| promo_features | json | ["Free checking", "Mobile banking", "24/7 support"] |
| promo_cta_text | string | "Learn More" |
| promo_icon | string | "🏦" |
| promo_background_color | string | "#ffffff" |
| promo_background_image | string | "" |
| promo_accent_color | string | "#1e3c72" |
| product_cards | json | [{"title":"Checking","description":"No minimum","cta":"Open"}] |
| email_campaigns | json | [{"subject":"Welcome","preview":"Get started"}] |
| personalization_theme | string | "default" |

### 3. Create Audiences

Create the following audiences in Optimizely:

1. **Mortgage Hot Lead**
   - Conditions: `mortgage_interested = true AND qualified_lead = true AND high_intent = true`

2. **Investment Hot Lead**
   - Conditions: `investment_interested = true AND qualified_lead = true AND high_intent = true`

3. **Credit Card Hot Lead**
   - Conditions: `card_interested = true AND qualified_lead = true`

4. **Mortgage Interested**
   - Conditions: `mortgage_interested = true`

5. **Investment Interested**
   - Conditions: `investment_interested = true`

6. **Email Engaged**
   - Conditions: `email_engaged = true`

7. **New Visitor**
   - Conditions: `new_user = true`

### 4. Create Targeted Deliveries

For each audience, create a targeted delivery with the corresponding variation values from `docs/optimizely-feature-config.md`.

Priority order (highest to lowest):
1. Mortgage Hot Lead
2. Investment Hot Lead
3. Credit Card Hot Lead
4. Mortgage Interested
5. Investment Interested
6. Auto Interested
7. Savings Interested
8. Email Engaged
9. New Visitor

### 5. Test the Demo

1. Open the demo page: http://localhost:9100/visual-demo
2. Open Developer Tools console
3. You should see: `[Optimizely] Client ready`
4. Click actions to trigger segments and see content change

## How It Works

### Visitor Journey Flow

```
1. New Visitor Lands
   ├── Visitor ID: v-ABC123DEF (anonymous)
   ├── Segments: [new_user]
   └── Content: Default welcome messaging

2. Opens Mortgage Email
   ├── Segments: [new_user, email_engaged, mortgage_interested]
   └── Content: Mortgage-focused hero and promo

3. Submits Form
   ├── Visitor becomes identified (Sarah Johnson)
   ├── Segments: [..., qualified_lead, identified_user]
   └── Content: Hot lead urgent messaging

4. Clicks CTA
   ├── Segments: [..., high_intent, mortgage_qualified]
   └── Content: Pre-approved, rate-locked messaging
```

### Content Updates

- Content is fetched from Optimizely on every segment change
- Variations are selected based on audience priority
- All zones update simultaneously across all tabs
- Changes happen in real-time without page refresh

### Reset Functionality

- Press **"Reset Demo"** button or **Ctrl+Shift+R**
- Generates new visitor ID
- Clears all segments except `new_user`
- Returns to default content
- Perfect for repeated demonstrations

## Troubleshooting

### Content Not Updating

1. Check console for errors
2. Verify SDK key is correct
3. Ensure feature flag is published
4. Check audience conditions match segments

### Using Fallback Content

If you see "No SDK key configured" in console:
- The demo works with hardcoded fallback content
- Add your SDK key to enable Optimizely integration

### Developer Mode

Toggle Developer Mode to see:
- Current visitor/user IDs
- Active segments
- Optimizely decision details
- Event history

## Demo Scenarios

### Scenario 1: Cold to Hot Lead
1. Start fresh (Reset Demo)
2. Open mortgage email → See mortgage content
3. Submit form with mortgage interest → See hot lead content
4. Click "Complete Application" → See pre-approved content

### Scenario 2: Investment Journey
1. Start fresh
2. Open investment email → See investment content
3. Submit form → See investment hot lead content
4. Content shows tax savings and portfolio review

### Scenario 3: Browse to Convert
1. Start fresh
2. Use "Browse Journey" tab
3. View Mortgage Rates → See mortgage interested content
4. Use Calculator → Enhanced qualification content
5. Start Application → High intent messaging

## Key Features Demonstrated

1. **Real-time Personalization**: Content changes instantly based on behavior
2. **Progressive Profiling**: Unknown → Known → Qualified → Ready
3. **Multi-channel**: Email, Form, and Browse journeys
4. **Marketing Automation**: Shows triggered campaigns and responses
5. **Visual Feedback**: Journey progress, engagement scoring, system responses
6. **Marketer Control**: All content manageable in Optimizely dashboard

## Support

For issues or questions:
- Check browser console for detailed logs
- Enable Developer Mode for debugging info
- All Optimizely events logged with `[Optimizely]` prefix
- Reset demo to start fresh if needed