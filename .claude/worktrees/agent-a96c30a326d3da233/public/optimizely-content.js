// Optimizely Content Manager for Real-Time Personalization
class OptimizelyContentManager {
    constructor() {
        // SDK Key - Replace with your actual SDK key
        this.sdkKey = 'YOUR_SDK_KEY_HERE'; // Will be replaced with actual key
        this.optimizelyClient = null;
        this.currentDecision = null;
        this.featureFlagKey = 'personalized_banking_content';
        this.visitorId = null;
        this.attributes = {};
        this.initialized = false;
        
        // Default content fallback
        this.defaultContent = {
            hero_title: "Welcome to Better Banking",
            hero_subtitle: "Experience banking that adapts to your needs",
            hero_cta_text: "Get Started",
            hero_background_color: "linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)",
            hero_background_image: "",
            hero_text_color: "#ffffff",
            
            promo_title: "Open an Account Today",
            promo_subtitle: "Join thousands of satisfied customers",
            promo_description: "Everything you need in one place",
            promo_features: JSON.stringify([
                "Free checking account",
                "Mobile and online banking",
                "24/7 customer support",
                "Nationwide ATM network"
            ]),
            promo_cta_text: "Learn More",
            promo_icon: "🏦",
            promo_background_color: "#ffffff",
            promo_background_image: "",
            promo_accent_color: "#1e3c72",
            
            product_cards: JSON.stringify([
                {
                    title: "Checking",
                    description: "No minimum balance",
                    cta: "Open Account"
                },
                {
                    title: "Savings",
                    description: "Competitive rates",
                    cta: "Start Saving"
                },
                {
                    title: "Credit Cards",
                    description: "Rewards programs",
                    cta: "Apply Now"
                }
            ]),
            email_campaigns: JSON.stringify([
                {
                    subject: "Welcome to First National Bank",
                    preview: "Get started with exclusive new member benefits"
                }
            ]),
            personalization_theme: "default"
        };
    }
    
    async initialize(visitorId, segments = []) {
        this.visitorId = visitorId;
        
        // Convert segments array to attributes object for Optimizely
        this.attributes = this.segmentsToAttributes(segments);
        
        console.log('[Optimizely] Initializing with visitor:', visitorId);
        console.log('[Optimizely] Attributes:', this.attributes);
        
        try {
            // Skip if no SDK key is set
            if (this.sdkKey === 'YOUR_SDK_KEY_HERE') {
                console.warn('[Optimizely] No SDK key configured, using default content');
                this.initialized = false;
                return false;
            }
            
            // Create Optimizely instance
            this.optimizelyClient = window.optimizely.createInstance({
                sdkKey: this.sdkKey,
                datafileOptions: {
                    autoUpdate: true,
                    updateInterval: 30000 // Update every 30 seconds
                },
                eventDispatcher: {
                    dispatchEvent: (event) => {
                        console.log('[Optimizely] Event dispatched:', event);
                    }
                }
            });
            
            // Wait for client to be ready
            await this.optimizelyClient.onReady();
            console.log('[Optimizely] Client ready');
            
            this.initialized = true;
            return true;
            
        } catch (error) {
            console.error('[Optimizely] Initialization failed:', error);
            this.initialized = false;
            return false;
        }
    }
    
    segmentsToAttributes(segments) {
        // Define all possible segments
        const allSegments = [
            'new_user', 'email_engaged', 'lead_qualified', 
            'price_interested', 'calculator_user', 'comparison_shopper',
            'content_consumer', 'high_intent', 'mortgage_interested',
            'investment_interested', 'card_interested', 'auto_interested',
            'savings_interested', 'mortgage_qualified', 'investment_qualified',
            'card_qualified', 'identified_user', 'known_customer', 'qualified_lead'
        ];
        
        // Create attributes object with boolean values
        const attributes = {};
        allSegments.forEach(segment => {
            attributes[segment] = segments.includes(segment);
        });
        
        return attributes;
    }
    
    async getPersonalizedContent(segments = []) {
        // Update attributes based on current segments
        this.attributes = this.segmentsToAttributes(segments);
        
        if (!this.initialized || !this.optimizelyClient) {
            console.log('[Optimizely] Using default content (not initialized)');
            return this.parseContent(this.defaultContent);
        }
        
        try {
            // Create user context
            const user = this.optimizelyClient.createUserContext(this.visitorId, this.attributes);
            
            // Get decision for feature flag
            const decision = user.decide(this.featureFlagKey);
            
            console.log('[Optimizely] Decision:', {
                enabled: decision.enabled,
                variationKey: decision.variationKey,
                ruleKey: decision.ruleKey,
                flagKey: decision.flagKey,
                variables: decision.variables
            });
            
            // Store current decision
            this.currentDecision = decision;
            
            // If feature is not enabled or no variables, use default
            if (!decision.enabled || !decision.variables || Object.keys(decision.variables).length === 0) {
                console.log('[Optimizely] Feature not enabled or no variables, using default');
                return this.parseContent(this.defaultContent);
            }
            
            // Return parsed content from Optimizely variables
            return this.parseContent(decision.variables);
            
        } catch (error) {
            console.error('[Optimizely] Error getting decision:', error);
            return this.parseContent(this.defaultContent);
        }
    }
    
    parseContent(variables) {
        // Parse JSON strings in variables
        let features = [];
        let productCards = [];
        let emailCampaigns = [];
        
        try {
            features = typeof variables.promo_features === 'string' 
                ? JSON.parse(variables.promo_features) 
                : variables.promo_features || [];
        } catch (e) {
            console.error('[Optimizely] Error parsing promo_features:', e);
            features = ["Free checking account", "Mobile banking", "24/7 support"];
        }
        
        try {
            productCards = typeof variables.product_cards === 'string'
                ? JSON.parse(variables.product_cards)
                : variables.product_cards || [];
        } catch (e) {
            console.error('[Optimizely] Error parsing product_cards:', e);
            productCards = [];
        }
        
        try {
            emailCampaigns = typeof variables.email_campaigns === 'string'
                ? JSON.parse(variables.email_campaigns)
                : variables.email_campaigns || [];
        } catch (e) {
            console.error('[Optimizely] Error parsing email_campaigns:', e);
            emailCampaigns = [];
        }
        
        return {
            hero: {
                title: variables.hero_title || this.defaultContent.hero_title,
                subtitle: variables.hero_subtitle || this.defaultContent.hero_subtitle,
                ctaText: variables.hero_cta_text || this.defaultContent.hero_cta_text,
                backgroundColor: variables.hero_background_color || this.defaultContent.hero_background_color,
                backgroundImage: variables.hero_background_image || "",
                textColor: variables.hero_text_color || "#ffffff"
            },
            promo: {
                title: variables.promo_title || this.defaultContent.promo_title,
                subtitle: variables.promo_subtitle || this.defaultContent.promo_subtitle,
                description: variables.promo_description || this.defaultContent.promo_description,
                features: features,
                ctaText: variables.promo_cta_text || this.defaultContent.promo_cta_text,
                icon: variables.promo_icon || "🏦",
                backgroundColor: variables.promo_background_color || "#ffffff",
                backgroundImage: variables.promo_background_image || "",
                accentColor: variables.promo_accent_color || "#1e3c72"
            },
            productCards: productCards,
            emailCampaigns: emailCampaigns,
            theme: variables.personalization_theme || "default"
        };
    }
    
    // Apply content to UI elements
    applyContentToUI(content, tabPrefix = '') {
        console.log('[Optimizely] Applying content to UI:', content);
        
        // Apply hero content
        this.applyHeroContent(content.hero, tabPrefix);
        
        // Apply promo content
        this.applyPromoContent(content.promo, tabPrefix);
        
        // Apply product cards
        this.applyProductCards(content.productCards, tabPrefix);
        
        // Apply email campaigns if on email tab
        if (!tabPrefix || tabPrefix === '') {
            this.applyEmailCampaigns(content.emailCampaigns);
        }
    }
    
    applyHeroContent(hero, tabPrefix = '') {
        const heroZone = document.getElementById(tabPrefix + 'hero-zone') || document.getElementById('hero-zone');
        const heroContent = document.getElementById(tabPrefix + 'hero-content') || document.getElementById('hero-content');
        
        if (heroZone) {
            // Apply background styling
            if (hero.backgroundImage) {
                heroZone.style.backgroundImage = `linear-gradient(rgba(0,0,0,0.4), rgba(0,0,0,0.4)), url('${hero.backgroundImage}')`;
                heroZone.style.backgroundSize = 'cover';
                heroZone.style.backgroundPosition = 'center';
            } else {
                heroZone.style.background = hero.backgroundColor;
                heroZone.style.backgroundImage = 'none';
            }
        }
        
        if (heroContent) {
            heroContent.style.color = hero.textColor;
            heroContent.innerHTML = `
                <h1 class="hero-title" style="color: ${hero.textColor}">${hero.title}</h1>
                <p class="hero-subtitle" style="color: ${hero.textColor}; opacity: 0.95;">${hero.subtitle}</p>
                <button class="hero-cta" onclick="handleCTAClick(this, '${tabPrefix}hero-optimizely')">${hero.ctaText}</button>
            `;
        }
    }
    
    applyPromoContent(promo, tabPrefix = '') {
        const promoZone = document.getElementById(tabPrefix + 'promo-zone') || document.getElementById('promo-zone');
        const promoContent = document.getElementById(tabPrefix + 'promo-content') || document.getElementById('promo-content');
        
        if (promoZone) {
            promoZone.style.backgroundColor = promo.backgroundColor;
            if (promo.backgroundImage) {
                promoZone.style.backgroundImage = `url('${promo.backgroundImage}')`;
                promoZone.style.backgroundSize = 'cover';
                promoZone.style.backgroundPosition = 'center';
            }
        }
        
        if (promoContent) {
            const featuresHTML = promo.features.map(f => `<li>${f}</li>`).join('');
            promoContent.innerHTML = `
                <div class="promo-image" style="background: linear-gradient(135deg, ${promo.accentColor}22 0%, ${promo.accentColor}44 100%);">
                    ${promo.icon}
                </div>
                <div class="promo-text">
                    <h3 class="promo-title" style="color: ${promo.accentColor}">${promo.title}</h3>
                    <p class="promo-subtitle" style="color: #666; font-weight: 500; margin-bottom: 8px;">${promo.subtitle}</p>
                    <p class="promo-description">${promo.description}</p>
                    <ul class="promo-features">
                        ${featuresHTML}
                    </ul>
                    <button class="hero-cta" style="background: ${promo.accentColor}" onclick="handleCTAClick(this, '${tabPrefix}promo-optimizely')">${promo.ctaText}</button>
                </div>
            `;
        }
    }
    
    applyProductCards(productCards, tabPrefix = '') {
        // Find the product cards container in the appropriate tab
        let container = null;
        if (tabPrefix) {
            const tab = document.querySelector(`#${tabPrefix.replace('-', '')}-tab`);
            if (tab) {
                container = tab.querySelector('.product-cards');
            }
        } else {
            container = document.querySelector('#email-tab .product-cards');
        }
        
        if (container && productCards && productCards.length > 0) {
            container.innerHTML = productCards.map(card => `
                <div class="product-card${card.highlight ? ' highlighted' : ''}">
                    <h3>${card.title}</h3>
                    <p>${card.description}</p>
                    <a href="#" onclick="handleProductClick('${card.title}'); return false;">${card.cta} →</a>
                </div>
            `).join('');
        }
    }
    
    applyEmailCampaigns(emailCampaigns) {
        // Update email subjects in the inbox if campaigns are defined
        if (emailCampaigns && emailCampaigns.length > 0) {
            const emailItems = document.querySelectorAll('.email-item');
            emailCampaigns.forEach((campaign, index) => {
                if (emailItems[index]) {
                    const subjectEl = emailItems[index].querySelector('.email-subject');
                    const previewEl = emailItems[index].querySelector('.email-preview');
                    if (subjectEl) subjectEl.textContent = campaign.subject;
                    if (previewEl) previewEl.textContent = campaign.preview;
                }
            });
        }
    }
    
    // Track impression event
    trackImpression() {
        if (this.initialized && this.optimizelyClient && this.currentDecision) {
            console.log('[Optimizely] Tracking impression for variation:', this.currentDecision.variationKey);
            // Impression events are automatically sent when decide() is called
        }
    }
    
    // Track conversion event
    trackConversion(eventKey, eventTags = {}) {
        if (this.initialized && this.optimizelyClient) {
            const user = this.optimizelyClient.createUserContext(this.visitorId, this.attributes);
            user.trackEvent(eventKey, eventTags);
            console.log('[Optimizely] Tracked conversion:', eventKey, eventTags);
        }
    }
    
    // Get current decision details for debugging
    getCurrentDecision() {
        return this.currentDecision;
    }
    
    // Check if Optimizely is properly initialized
    isInitialized() {
        return this.initialized;
    }
    
    // Reset for demo purposes
    reset() {
        this.currentDecision = null;
        this.attributes = {};
        console.log('[Optimizely] Content manager reset');
    }
}

// Create global instance
window.optimizelyContent = new OptimizelyContentManager();

// Helper function for product clicks
function handleProductClick(productTitle) {
    console.log('Product clicked:', productTitle);
    if (window.visualDemo) {
        window.visualDemo.trackProductClick(productTitle);
    }
}