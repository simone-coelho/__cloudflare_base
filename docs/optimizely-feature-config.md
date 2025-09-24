# Optimizely Feature Experimentation Configuration

## Feature Flag: `personalized_banking_content`

### Feature Variables Schema

```json
{
  "hero_title": "string",
  "hero_subtitle": "string",
  "hero_cta_text": "string",
  "hero_background_color": "string",
  "hero_background_image": "string",
  "hero_text_color": "string",
  
  "promo_title": "string",
  "promo_subtitle": "string",
  "promo_description": "string",
  "promo_features": "json",
  "promo_cta_text": "string",
  "promo_icon": "string",
  "promo_background_color": "string",
  "promo_background_image": "string",
  "promo_accent_color": "string",
  
  "product_cards": "json",
  "email_campaigns": "json",
  "personalization_theme": "string"
}
```

## Targeted Deliveries Configuration

### Priority 1: Mortgage Hot Lead
**Audience**: `mortgage_interested AND qualified_lead AND high_intent`

```json
{
  "hero_title": "Welcome Back, Your Pre-Approval Awaits",
  "hero_subtitle": "You're pre-qualified for our lowest rate: 3.2% APR - Valid for 24 hours",
  "hero_cta_text": "Complete Application Now",
  "hero_background_color": "linear-gradient(135deg, #1a472a 0%, #2d5a3d 100%)",
  "hero_background_image": "https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=1600",
  "hero_text_color": "#ffffff",
  
  "promo_title": "Your Personalized Rate Calculator",
  "promo_subtitle": "Based on your profile",
  "promo_description": "We've pre-calculated your mortgage options based on your information",
  "promo_features": [
    "Monthly Payment: $1,847/month",
    "Total Savings: $47,000 vs market rate",
    "No PMI Required",
    "Rate locked for 90 days"
  ],
  "promo_cta_text": "Lock This Rate",
  "promo_icon": "🏡",
  "promo_background_color": "#f0fdf4",
  "promo_background_image": "",
  "promo_accent_color": "#16a34a",
  
  "product_cards": [
    {
      "title": "30-Year Fixed",
      "description": "3.2% APR - Your qualified rate",
      "cta": "Select This",
      "highlight": true
    },
    {
      "title": "15-Year Fixed",
      "description": "2.8% APR - Save $127,000",
      "cta": "View Details"
    },
    {
      "title": "ARM Options",
      "description": "Start at 2.5% APR",
      "cta": "Learn More"
    }
  ],
  "email_campaigns": [
    {
      "subject": "⏰ Your rate expires in 24 hours",
      "preview": "Complete your application to lock in 3.2% APR"
    }
  ],
  "personalization_theme": "urgent_qualified"
}
```

### Priority 2: Investment Hot Lead
**Audience**: `investment_interested AND qualified_lead AND high_intent`

```json
{
  "hero_title": "Your Portfolio Review is Ready",
  "hero_subtitle": "Our advisors found $12,000 in potential tax savings for you",
  "hero_cta_text": "Schedule Your Call",
  "hero_background_color": "linear-gradient(135deg, #1e3a8a 0%, #3730a3 100%)",
  "hero_background_image": "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=1600",
  "hero_text_color": "#ffffff",
  
  "promo_title": "Personalized Investment Strategy",
  "promo_subtitle": "Tailored to your goals",
  "promo_description": "Based on your risk profile and timeline, we recommend",
  "promo_features": [
    "70% Equity / 30% Fixed Income",
    "Projected Annual Return: 8.5%",
    "Tax-Loss Harvesting Included",
    "No Advisory Fees for 6 Months"
  ],
  "promo_cta_text": "Start Investing",
  "promo_icon": "📈",
  "promo_background_color": "#eff6ff",
  "promo_background_image": "",
  "promo_accent_color": "#2563eb",
  
  "product_cards": [
    {
      "title": "Managed Portfolio",
      "description": "Professional management included",
      "cta": "Open Account",
      "highlight": true
    },
    {
      "title": "Self-Directed IRA",
      "description": "Maximum control & flexibility",
      "cta": "Learn More"
    },
    {
      "title": "Wealth Advisory",
      "description": "1-on-1 advisor support",
      "cta": "Book Consultation"
    }
  ],
  "email_campaigns": [
    {
      "subject": "📊 Your portfolio analysis is ready",
      "preview": "See how you could save $12,000 in taxes this year"
    }
  ],
  "personalization_theme": "wealth_focused"
}
```

### Priority 3: Credit Card Hot Lead
**Audience**: `card_interested AND qualified_lead`

```json
{
  "hero_title": "You're Pre-Approved! $500 Bonus Awaits",
  "hero_subtitle": "Platinum Rewards Card with 2% cash back on everything",
  "hero_cta_text": "Claim Your Card",
  "hero_background_color": "linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)",
  "hero_background_image": "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=1600",
  "hero_text_color": "#ffffff",
  
  "promo_title": "Your Rewards Calculator",
  "promo_subtitle": "Based on your spending",
  "promo_description": "Estimated annual rewards based on your profile",
  "promo_features": [
    "Annual Cash Back: $1,240",
    "$500 Sign-up Bonus",
    "0% APR for 18 months",
    "No Annual Fee Ever"
  ],
  "promo_cta_text": "Activate Card",
  "promo_icon": "💳",
  "promo_background_color": "#faf5ff",
  "promo_background_image": "",
  "promo_accent_color": "#9333ea",
  
  "product_cards": [
    {
      "title": "Platinum Rewards",
      "description": "2% unlimited cash back",
      "cta": "Apply Now",
      "highlight": true
    },
    {
      "title": "Travel Elite",
      "description": "3x points on travel",
      "cta": "View Benefits"
    },
    {
      "title": "Business Card",
      "description": "Expense management tools",
      "cta": "Learn More"
    }
  ],
  "email_campaigns": [
    {
      "subject": "💰 Your $500 bonus is waiting",
      "preview": "Complete your application in 2 minutes"
    }
  ],
  "personalization_theme": "rewards_focused"
}
```

### Priority 4: Mortgage Interested
**Audience**: `mortgage_interested`

```json
{
  "hero_title": "Find Your Dream Home with Confidence",
  "hero_subtitle": "Mortgage rates starting at 3.5% APR",
  "hero_cta_text": "Check Your Rate",
  "hero_background_color": "linear-gradient(135deg, #059669 0%, #10b981 100%)",
  "hero_background_image": "https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=1600",
  "hero_text_color": "#ffffff",
  
  "promo_title": "Mortgage Calculator",
  "promo_subtitle": "Estimate your payment",
  "promo_description": "See what you can afford with our tools",
  "promo_features": [
    "Calculate monthly payments",
    "Compare loan types",
    "Estimate closing costs",
    "Get pre-qualified in minutes"
  ],
  "promo_cta_text": "Calculate Now",
  "promo_icon": "🏠",
  "promo_background_color": "#f0fdf4",
  "promo_background_image": "",
  "promo_accent_color": "#059669",
  
  "product_cards": [
    {
      "title": "First-Time Buyer",
      "description": "Low down payment options",
      "cta": "Learn More"
    },
    {
      "title": "Refinancing",
      "description": "Lower your monthly payment",
      "cta": "Check Rates"
    },
    {
      "title": "Home Equity",
      "description": "Tap into your home's value",
      "cta": "Explore Options"
    }
  ],
  "email_campaigns": [
    {
      "subject": "🏡 Mortgage rates dropped",
      "preview": "See if you qualify for 3.5% APR"
    }
  ],
  "personalization_theme": "home_buyer"
}
```

### Priority 5: Investment Interested
**Audience**: `investment_interested`

```json
{
  "hero_title": "Grow Your Wealth with Smart Investing",
  "hero_subtitle": "Start with as little as $100",
  "hero_cta_text": "Open Account",
  "hero_background_color": "linear-gradient(135deg, #0891b2 0%, #06b6d4 100%)",
  "hero_background_image": "https://images.unsplash.com/photo-1579532537598-459ecdaf39cc?w=1600",
  "hero_text_color": "#ffffff",
  
  "promo_title": "Investment Options",
  "promo_subtitle": "Choose your path",
  "promo_description": "Multiple ways to grow your money",
  "promo_features": [
    "Robo-advisor available",
    "Self-directed trading",
    "Retirement planning",
    "Tax-advantaged accounts"
  ],
  "promo_cta_text": "Start Investing",
  "promo_icon": "💼",
  "promo_background_color": "#f0fdfa",
  "promo_background_image": "",
  "promo_accent_color": "#0891b2",
  
  "product_cards": [
    {
      "title": "Stocks & ETFs",
      "description": "Commission-free trading",
      "cta": "Start Trading"
    },
    {
      "title": "Mutual Funds",
      "description": "Diversified portfolios",
      "cta": "Browse Funds"
    },
    {
      "title": "Retirement IRA",
      "description": "Tax-advantaged growth",
      "cta": "Open IRA"
    }
  ],
  "email_campaigns": [
    {
      "subject": "📈 Market opportunity alert",
      "preview": "Tech stocks at 3-month lows"
    }
  ],
  "personalization_theme": "investor"
}
```

### Priority 6: Auto Loan Interested
**Audience**: `auto_interested`

```json
{
  "hero_title": "Drive Your Dream Car Today",
  "hero_subtitle": "Auto loans starting at 2.9% APR",
  "hero_cta_text": "Get Pre-Approved",
  "hero_background_color": "linear-gradient(135deg, #dc2626 0%, #f97316 100%)",
  "hero_background_image": "https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?w=1600",
  "hero_text_color": "#ffffff",
  
  "promo_title": "Auto Loan Calculator",
  "promo_subtitle": "Know before you shop",
  "promo_description": "Get pre-approved and shop with confidence",
  "promo_features": [
    "Up to $75,000 financing",
    "Terms up to 84 months",
    "No prepayment penalties",
    "Same-day approval"
  ],
  "promo_cta_text": "Calculate Payment",
  "promo_icon": "🚗",
  "promo_background_color": "#fef2f2",
  "promo_background_image": "",
  "promo_accent_color": "#dc2626",
  
  "product_cards": [
    {
      "title": "New Car Loans",
      "description": "Lowest rates available",
      "cta": "Apply Now"
    },
    {
      "title": "Used Car Loans",
      "description": "Flexible terms",
      "cta": "Get Started"
    },
    {
      "title": "Refinancing",
      "description": "Lower your payment",
      "cta": "Check Savings"
    }
  ],
  "email_campaigns": [
    {
      "subject": "🚗 You're pre-approved for $45,000",
      "preview": "Shop with confidence at any dealer"
    }
  ],
  "personalization_theme": "auto_buyer"
}
```

### Priority 7: High-Yield Savings Interested
**Audience**: `savings_interested`

```json
{
  "hero_title": "Earn More with High-Yield Savings",
  "hero_subtitle": "2.5% APY with no minimum balance",
  "hero_cta_text": "Open Account",
  "hero_background_color": "linear-gradient(135deg, #0ea5e9 0%, #3b82f6 100%)",
  "hero_background_image": "https://images.unsplash.com/photo-1579621970563-ebec7560ff3e?w=1600",
  "hero_text_color": "#ffffff",
  
  "promo_title": "Savings Calculator",
  "promo_subtitle": "Watch your money grow",
  "promo_description": "See how much you could earn",
  "promo_features": [
    "2.5% APY guaranteed",
    "No minimum balance",
    "No monthly fees",
    "FDIC insured to $250,000"
  ],
  "promo_cta_text": "Start Saving",
  "promo_icon": "💰",
  "promo_background_color": "#eff6ff",
  "promo_background_image": "",
  "promo_accent_color": "#3b82f6",
  
  "product_cards": [
    {
      "title": "High-Yield Savings",
      "description": "2.5% APY",
      "cta": "Open Now"
    },
    {
      "title": "Money Market",
      "description": "Check-writing privileges",
      "cta": "Learn More"
    },
    {
      "title": "CDs",
      "description": "Lock in higher rates",
      "cta": "View Rates"
    }
  ],
  "email_campaigns": [
    {
      "subject": "💰 Earn 25x more than average",
      "preview": "Switch to 2.5% APY savings today"
    }
  ],
  "personalization_theme": "saver"
}
```

### Priority 8: Email Engaged (Generic)
**Audience**: `email_engaged`

```json
{
  "hero_title": "Welcome Back! We Have News for You",
  "hero_subtitle": "Exclusive offers based on your interests",
  "hero_cta_text": "View Offers",
  "hero_background_color": "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
  "hero_background_image": "",
  "hero_text_color": "#ffffff",
  
  "promo_title": "Recommended for You",
  "promo_subtitle": "Based on your activity",
  "promo_description": "Products and services you might like",
  "promo_features": [
    "Personalized recommendations",
    "Exclusive member rates",
    "Priority support",
    "Special promotions"
  ],
  "promo_cta_text": "Explore Options",
  "promo_icon": "⭐",
  "promo_background_color": "#f5f3ff",
  "promo_background_image": "",
  "promo_accent_color": "#6366f1",
  
  "product_cards": [
    {
      "title": "Banking",
      "description": "Checking & savings",
      "cta": "Learn More"
    },
    {
      "title": "Lending",
      "description": "Loans & credit",
      "cta": "View Options"
    },
    {
      "title": "Investing",
      "description": "Grow your wealth",
      "cta": "Get Started"
    }
  ],
  "email_campaigns": [
    {
      "subject": "📧 Thanks for reading",
      "preview": "Here are your personalized offers"
    }
  ],
  "personalization_theme": "engaged"
}
```

### Priority 9: New Visitor (Default)
**Audience**: `new_user` OR no segments

```json
{
  "hero_title": "Welcome to Better Banking",
  "hero_subtitle": "Experience banking that adapts to your needs",
  "hero_cta_text": "Get Started",
  "hero_background_color": "linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)",
  "hero_background_image": "",
  "hero_text_color": "#ffffff",
  
  "promo_title": "Open an Account Today",
  "promo_subtitle": "Join thousands of satisfied customers",
  "promo_description": "Everything you need in one place",
  "promo_features": [
    "Free checking account",
    "Mobile and online banking",
    "24/7 customer support",
    "Nationwide ATM network"
  ],
  "promo_cta_text": "Learn More",
  "promo_icon": "🏦",
  "promo_background_color": "#ffffff",
  "promo_background_image": "",
  "promo_accent_color": "#1e3c72",
  
  "product_cards": [
    {
      "title": "Checking",
      "description": "No minimum balance",
      "cta": "Open Account"
    },
    {
      "title": "Savings",
      "description": "Competitive rates",
      "cta": "Start Saving"
    },
    {
      "title": "Credit Cards",
      "description": "Rewards programs",
      "cta": "Apply Now"
    }
  ],
  "email_campaigns": [
    {
      "subject": "Welcome to First National Bank",
      "preview": "Get started with exclusive new member benefits"
    }
  ],
  "personalization_theme": "default"
}
```

## Audience Conditions for Optimizely

### Audience Definitions

```javascript
// Priority 1: Mortgage Hot Lead
{
  "name": "Mortgage Hot Lead",
  "conditions": {
    "and": [
      { "custom_attribute": { "name": "mortgage_interested", "value": true } },
      { "custom_attribute": { "name": "qualified_lead", "value": true } },
      { "custom_attribute": { "name": "high_intent", "value": true } }
    ]
  }
}

// Priority 2: Investment Hot Lead
{
  "name": "Investment Hot Lead",
  "conditions": {
    "and": [
      { "custom_attribute": { "name": "investment_interested", "value": true } },
      { "custom_attribute": { "name": "qualified_lead", "value": true } },
      { "custom_attribute": { "name": "high_intent", "value": true } }
    ]
  }
}

// Priority 3: Credit Card Hot Lead
{
  "name": "Credit Card Hot Lead",
  "conditions": {
    "and": [
      { "custom_attribute": { "name": "card_interested", "value": true } },
      { "custom_attribute": { "name": "qualified_lead", "value": true } }
    ]
  }
}

// Priority 4: Mortgage Interested
{
  "name": "Mortgage Interested",
  "conditions": {
    "custom_attribute": { "name": "mortgage_interested", "value": true }
  }
}

// Priority 5: Investment Interested
{
  "name": "Investment Interested",
  "conditions": {
    "custom_attribute": { "name": "investment_interested", "value": true }
  }
}

// Priority 6: Auto Interested
{
  "name": "Auto Interested",
  "conditions": {
    "custom_attribute": { "name": "auto_interested", "value": true }
  }
}

// Priority 7: Savings Interested
{
  "name": "Savings Interested",
  "conditions": {
    "custom_attribute": { "name": "savings_interested", "value": true }
  }
}

// Priority 8: Email Engaged
{
  "name": "Email Engaged",
  "conditions": {
    "custom_attribute": { "name": "email_engaged", "value": true }
  }
}

// Priority 9: New Visitor
{
  "name": "New Visitor",
  "conditions": {
    "custom_attribute": { "name": "new_user", "value": true }
  }
}
```

## SDK Implementation Strategy

### Browser SDK Integration

```javascript
// Initialize Optimizely client
const optimizelyClient = optimizely.createInstance({
  sdkKey: 'YOUR_SDK_KEY',
  datafileOptions: {
    autoUpdate: true,
    updateInterval: 30000 // 30 seconds
  }
});

// Get user context with segments as attributes
const attributes = {
  mortgage_interested: segments.includes('mortgage_interested'),
  investment_interested: segments.includes('investment_interested'),
  card_interested: segments.includes('card_interested'),
  qualified_lead: segments.includes('qualified_lead'),
  high_intent: segments.includes('high_intent'),
  email_engaged: segments.includes('email_engaged'),
  new_user: segments.includes('new_user'),
  // ... all other segments
};

// Get feature decision
const user = optimizelyClient.createUserContext(visitorId, attributes);
const decision = user.decide('personalized_banking_content');

// Extract variables
const content = {
  hero: {
    title: decision.variables.hero_title,
    subtitle: decision.variables.hero_subtitle,
    ctaText: decision.variables.hero_cta_text,
    backgroundColor: decision.variables.hero_background_color,
    backgroundImage: decision.variables.hero_background_image,
    textColor: decision.variables.hero_text_color
  },
  promo: {
    title: decision.variables.promo_title,
    subtitle: decision.variables.promo_subtitle,
    description: decision.variables.promo_description,
    features: JSON.parse(decision.variables.promo_features),
    ctaText: decision.variables.promo_cta_text,
    icon: decision.variables.promo_icon,
    backgroundColor: decision.variables.promo_background_color,
    backgroundImage: decision.variables.promo_background_image,
    accentColor: decision.variables.promo_accent_color
  },
  productCards: JSON.parse(decision.variables.product_cards),
  emailCampaigns: JSON.parse(decision.variables.email_campaigns),
  theme: decision.variables.personalization_theme
};

// Apply content to UI
updateHeroContent(content.hero);
updatePromoContent(content.promo);
updateProductCards(content.productCards);
```

## Reset Strategy for Demo

```javascript
// Reset function for demo purposes
function resetDemoState() {
  // Clear localStorage
  localStorage.clear();
  
  // Reset session
  sessionStorage.clear();
  
  // Generate new visitor ID
  const newVisitorId = 'v-' + Math.random().toString(36).substr(2, 9).toUpperCase();
  
  // Reset segments to new_user only
  const segments = ['new_user'];
  
  // Reinitialize Optimizely with fresh state
  reinitializeOptimizely(newVisitorId, segments);
  
  // Reload page
  window.location.reload();
}
```

## Testing Scenarios

### Scenario 1: Cold to Hot Lead
1. Start as new visitor → Generic content
2. Open mortgage email → Mortgage interested content
3. Submit form with mortgage interest → Mortgage hot lead content

### Scenario 2: Multi-Interest Journey
1. Start as new visitor
2. Browse investment pages → Investment interested
3. Use mortgage calculator → Also mortgage interested
4. System prioritizes based on recency/engagement

### Scenario 3: Known Customer Return
1. Previous visitor with profile
2. Returns with saved segments
3. Immediately sees personalized content
4. Takes new action → Content updates

## Notes for Implementation

1. **Variable Naming**: Use snake_case for consistency with Optimizely conventions
2. **JSON Fields**: Store arrays and objects as JSON strings in Optimizely
3. **Images**: Use CDN URLs or base64 encoded small images
4. **Colors**: Support both hex codes and CSS gradients
5. **Fallbacks**: Always have default values in case variables are undefined
6. **Performance**: Cache decisions for 30 seconds to avoid excessive SDK calls
7. **Tracking**: Send impression events for each variation shown