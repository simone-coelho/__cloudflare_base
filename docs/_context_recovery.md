# Context Recovery - Visual Personalization Demo Vision

## Project Status
Building a visual, business-friendly demonstration of real-time personalization using Cloudflare Workers and Optimizely Feature Experimentation. Moving from developer-focused technical demo to visual marketing demonstration.

## Core Vision
Transform the current technical demo into a **visual experience** that shows business users and marketers how personalization actually looks and feels in real-time, using a financial services (banking) context.

## Key Design Decisions

### 1. Zone-Based Personalization (Not Full Page)
- **Critical Insight**: We're NOT transforming the entire website
- Only specific "marketing zones" change (hero banners, promotional cards, CTAs)
- Similar to how real websites work - targeted content areas update based on user behavior
- The main website structure and navigation remain constant

### 2. Visual Layout Structure
```
[30% Actions Panel] | [70% Live Website View]
- Left: User actions (emails, forms)  
- Right: Actual website with personalized zones highlighted
```

### 3. Industry Focus: Financial Services
- **Primary**: Traditional bank with modern styling
- **Products**: Mortgages, investments, credit cards, auto loans, savings accounts
- **Style**: Professional but modern, not wild colors, relevance to current banking trends

### 4. Multiple Personalization Paths

#### Email Journey
- **Multiple emails in inbox** from same bank, different topics:
  - Mortgage rates email ’ Hero shows home loan content
  - Investment tips email ’ Hero shows portfolio content  
  - Credit card email ’ Hero shows rewards content
- User clicks different emails, sees different personalizations

#### Form Journey
- **Single form with dropdown** for interest selection:
  - Car Loan ’ Shows auto financing content
  - Mortgage ’ Shows home loan content
  - Investments ’ Shows wealth management content
- Same person info, different intent = different personalization

### 5. Personalization Zones on Website

Two main zones that change:
1. **Hero Banner Zone** - Top promotional area
   - Default: Generic "Welcome to Better Banking"
   - Personalized: Specific to user's interest

2. **Promotional Card Zone** - Mid-page marketing card
   - Default: Generic "Open an Account"
   - Personalized: Relevant calculator/offer

### 6. Visual Feedback Mechanisms
- Zones that can be personalized have subtle borders/highlights
- When content changes: fade transition with brief glow
- Segment badges appear when triggered
- Toast notifications explain what happened
- Session metrics bar (slim, full width) shows real-time data

### 7. Developer Mode Toggle
- Business users see clean visual demo by default
- Technical users can toggle to see:
  - Full segment list
  - Event logs
  - API responses
  - Technical metrics

## Implementation Approach

### Phase 1: Structure
1. Create new tabbed interface (Email Journey, Form Journey, etc.)
2. Split-panel layout (actions left, website right)
3. Slim metrics bar at bottom

### Phase 2: Visual Components
1. Build realistic email inbox component
2. Create website template with marked personalization zones
3. Design content cards for each personalization variant

### Phase 3: Interactions
1. Click email ’ Trigger personalization in zones
2. Submit form ’ Update relevant zones
3. Smooth animations between states

### Phase 4: Content Variants
Create specific content for each path:
- Mortgage: Rates, calculators, application CTAs
- Investments: Portfolio, advisors, account opening
- Credit Cards: Rewards, bonuses, instant approval
- Auto Loans: Payment calculators, pre-qualification
- Savings: High-yield rates, bonus offers

## Technical Architecture Remains
- Cloudflare Workers for edge processing
- Real-time segment engine
- WebSocket for live updates
- Optimizely for feature flags (when configured)
- All existing backend functionality

## Success Criteria
1. Business users immediately understand what personalization does
2. Visual changes are obvious and meaningful
3. Connection between action and result is clear
4. Demonstrates real-world banking scenarios
5. Shows value of real-time personalization

## Example User Flow
1. User sees email inbox with 3 emails
2. Clicks "Mortgage Rates" email
3. Website's hero banner transitions from generic to mortgage-focused
4. Promotional card changes to mortgage calculator
5. Segment "mortgage_interested" appears
6. Engagement score increases
7. User understands: "Email interest drives website personalization"

## Key Differentiator
This demo shows **targeted content personalization** not generic segment badges. Business users see actual content changing based on user actions, making the value of personalization tangible and visual.

---

## Current File Structure
- `public/index.html` - Current demo page (to be redesigned)
- `public/demo.js` - Demo logic (to be enhanced)
- `public/scenarios.js` - User journeys (to be integrated)
- `src/services/RealtimeSegmentEngine.ts` - Segment rules engine
- `src/routes/realtime.ts` - API endpoints

## Next Steps
1. Redesign index.html with new visual layout
2. Create email inbox component
3. Build website template with personalization zones
4. Implement content variants for each journey
5. Add smooth transitions and animations
6. Create developer mode toggle

---

*This document serves as context recovery for session changes. Last updated during visual demo transformation discussion.*