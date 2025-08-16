// Enhanced Demo Scenarios for Real-Time Personalization
class DemoScenarios {
    constructor(demo) {
        this.demo = demo;
        this.scenarioTimeouts = [];
    }

    // Clear any running scenarios
    clearScenarios() {
        this.scenarioTimeouts.forEach(timeout => clearTimeout(timeout));
        this.scenarioTimeouts = [];
    }

    // Scenario 1: New User Journey - Email Engagement
    async runEmailEngagementJourney() {
        console.log('runEmailEngagementJourney called');
        this.clearScenarios(); // Clear any existing scenarios
        this.demo.logEvent('🎬 Starting Email Engagement Journey', 'event');
        this.demo.showNotification('Running Email Engagement Journey...', 'info');
        
        // Step 1: User opens first email
        this.demo.logEvent('📧 Step 1: Opening welcome email', 'info');
        console.log('Triggering first email open');
        await this.demo.triggerActionEvent('email_open', {
            campaignId: 'welcome-series-001',
            emailId: 'welcome-email-001',
            subject: 'Welcome to our platform!',
            utm_source: 'email',
            utm_campaign: 'welcome_series'
        });
        
        // Wait 3 seconds
        this.scenarioTimeouts.push(setTimeout(async () => {
            // Step 2: User opens promotional email
            this.demo.logEvent('📧 Step 2: Opening promotional email', 'info');
            await this.demo.triggerActionEvent('email_open', {
                campaignId: 'promo-campaign-001',
                emailId: 'promo-email-001',
                subject: 'Special offer just for you!',
                utm_source: 'email',
                utm_campaign: 'promotion'
            });
        }, 3000));
        
        // Wait 6 seconds total
        this.scenarioTimeouts.push(setTimeout(async () => {
            // Step 3: User opens third email (becoming highly engaged)
            this.demo.logEvent('📧 Step 3: Opening product announcement', 'info');
            await this.demo.triggerActionEvent('email_open', {
                campaignId: 'product-announcement-001',
                emailId: 'announcement-email-001',
                subject: 'New features available now!',
                utm_source: 'email',
                utm_campaign: 'product_announcement'
            });
            
            this.demo.logEvent('✅ Email Engagement Journey completed - User should now be highly engaged!', 'event');
            this.demo.showNotification('Email Engagement Journey complete!', 'success');
        }, 6000));
    }

    // Scenario 2: Lead Qualification Journey
    async runLeadQualificationJourney() {
        this.demo.logEvent('🎬 Starting Lead Qualification Journey', 'event');
        this.demo.showNotification('Running Lead Qualification Journey...', 'info');
        
        // Step 1: Visit pricing page
        this.demo.logEvent('💰 Step 1: Visiting pricing page', 'info');
        await this.demo.triggerActionEvent('page_view', {
            path: '/pricing',
            duration: 45000, // 45 seconds
            utm_source: 'organic',
            plan_interest: 'professional'
        });
        
        // Wait 2 seconds
        this.scenarioTimeouts.push(setTimeout(async () => {
            // Step 2: Submit contact form
            this.demo.logEvent('📝 Step 2: Submitting contact form', 'info');
            await this.demo.triggerActionEvent('form_submit', {
                formType: 'contact_sales',
                formId: 'contact-form',
                fields: {
                    email: 'prospect@example.com',
                    company: 'Enterprise Corp',
                    employees: '1000+',
                    timeline: 'Next quarter',
                    budget: '$50k+'
                }
            });
        }, 2000));
        
        // Wait 5 seconds total  
        this.scenarioTimeouts.push(setTimeout(async () => {
            // Step 3: Request demo
            this.demo.logEvent('🎯 Step 3: Requesting product demo', 'info');
            await this.demo.triggerActionEvent('form_submit', {
                formType: 'demo_request',
                formId: 'demo-request-form',
                fields: {
                    company: 'Enterprise Corp',
                    useCase: 'Customer personalization at scale',
                    urgency: 'high',
                    decision_maker: true
                }
            });
            
            this.demo.logEvent('✅ Lead Qualification Journey completed - User should now be sales qualified!', 'event');
            this.demo.showNotification('Lead Qualification Journey complete!', 'success');
        }, 5000));
    }

    // Scenario 3: E-commerce Shopping Journey
    async runEcommerceShoppingJourney() {
        this.demo.logEvent('🎬 Starting E-commerce Shopping Journey', 'event');
        this.demo.showNotification('Running E-commerce Shopping Journey...', 'info');
        
        // Step 1: Browse product catalog
        this.demo.logEvent('🛍️ Step 1: Browsing product catalog', 'info');
        await this.demo.triggerActionEvent('page_view', {
            path: '/products',
            duration: 30000, // 30 seconds
            category: 'electronics',
            utm_source: 'google'
        });
        
        // Wait 2 seconds
        this.scenarioTimeouts.push(setTimeout(async () => {
            // Step 2: View specific product
            this.demo.logEvent('📱 Step 2: Viewing product details', 'info');
            await this.demo.triggerActionEvent('page_view', {
                path: '/products/smartphone-pro',
                duration: 120000, // 2 minutes
                product_id: 'smartphone-pro-123',
                price: 999,
                category: 'smartphones'
            });
        }, 2000));
        
        // Wait 4 seconds total
        this.scenarioTimeouts.push(setTimeout(async () => {
            // Step 3: Add to cart
            this.demo.logEvent('🛒 Step 3: Adding item to cart', 'info');
            await this.demo.triggerActionEvent('button_click', {
                button_id: 'add-to-cart',
                product_id: 'smartphone-pro-123',
                price: 999,
                quantity: 1,
                action: 'add_to_cart'
            });
        }, 4000));
        
        // Wait 6 seconds total
        this.scenarioTimeouts.push(setTimeout(async () => {
            // Step 4: Newsletter signup for discount
            this.demo.logEvent('📧 Step 4: Signing up for newsletter discount', 'info');
            await this.demo.triggerActionEvent('form_submit', {
                formType: 'newsletter_signup',
                formId: 'newsletter-form',
                fields: {
                    email: 'shopper@example.com',
                    interests: ['electronics', 'deals'],
                    reason: 'discount_offer'
                }
            });
            
            this.demo.logEvent('✅ E-commerce Shopping Journey completed - User should now be a engaged shopper!', 'event');
            this.demo.showNotification('E-commerce Shopping Journey complete!', 'success');
        }, 6000));
    }

    // Scenario 4: Content Engagement Journey
    async runContentEngagementJourney() {
        this.demo.logEvent('🎬 Starting Content Engagement Journey', 'event');
        this.demo.showNotification('Running Content Engagement Journey...', 'info');
        
        // Step 1: Read blog post
        this.demo.logEvent('📖 Step 1: Reading blog post', 'info');
        await this.demo.triggerActionEvent('page_view', {
            path: '/blog/real-time-personalization-guide',
            duration: 180000, // 3 minutes
            content_type: 'blog_post',
            author: 'Tech Team',
            category: 'personalization'
        });
        
        // Wait 2 seconds
        this.scenarioTimeouts.push(setTimeout(async () => {
            // Step 2: Download whitepaper
            this.demo.logEvent('📄 Step 2: Downloading whitepaper', 'info');
            await this.demo.triggerActionEvent('form_submit', {
                formType: 'content_download',
                formId: 'whitepaper-form',
                fields: {
                    email: 'reader@example.com',
                    company: 'Tech Startup Inc',
                    role: 'Product Manager',
                    content_title: 'Complete Guide to Real-Time Personalization'
                }
            });
        }, 2000));
        
        // Wait 4 seconds total
        this.scenarioTimeouts.push(setTimeout(async () => {
            // Step 3: Watch webinar
            this.demo.logEvent('🎥 Step 3: Registering for webinar', 'info');
            await this.demo.triggerActionEvent('form_submit', {
                formType: 'webinar_registration',
                formId: 'webinar-form',
                fields: {
                    email: 'reader@example.com',
                    webinar_title: 'Advanced Personalization Strategies',
                    session_date: '2024-09-15',
                    timezone: 'PST'
                }
            });
            
            this.demo.logEvent('✅ Content Engagement Journey completed - User should now be highly engaged with content!', 'event');
            this.demo.showNotification('Content Engagement Journey complete!', 'success');
        }, 4000));
    }

    // Scenario 5: Mobile App Engagement Journey
    async runMobileAppJourney() {
        this.demo.logEvent('🎬 Starting Mobile App Engagement Journey', 'event');
        this.demo.showNotification('Running Mobile App Engagement Journey...', 'info');
        
        // Step 1: App install and first launch
        this.demo.logEvent('📱 Step 1: First app launch', 'info');
        await this.demo.triggerActionEvent('custom', {
            event_name: 'app_launch',
            platform: 'iOS',
            app_version: '2.1.0',
            device_type: 'iPhone',
            first_launch: true
        });
        
        // Wait 2 seconds
        this.scenarioTimeouts.push(setTimeout(async () => {
            // Step 2: Complete onboarding
            this.demo.logEvent('✨ Step 2: Completing onboarding', 'info');
            await this.demo.triggerActionEvent('custom', {
                event_name: 'onboarding_completed',
                steps_completed: 5,
                time_spent: 180, // 3 minutes
                permissions_granted: ['notifications', 'location']
            });
        }, 2000));
        
        // Wait 4 seconds total
        this.scenarioTimeouts.push(setTimeout(async () => {
            // Step 3: Enable push notifications
            this.demo.logEvent('🔔 Step 3: Enabling push notifications', 'info');
            await this.demo.triggerActionEvent('custom', {
                event_name: 'push_notifications_enabled',
                opted_in: true,
                notification_types: ['promotional', 'transactional', 'content']
            });
        }, 4000));
        
        // Wait 6 seconds total
        this.scenarioTimeouts.push(setTimeout(async () => {
            // Step 4: Make first in-app action
            this.demo.logEvent('⭐ Step 4: Creating first content', 'info');
            await this.demo.triggerActionEvent('custom', {
                event_name: 'content_created',
                content_type: 'post',
                engagement_level: 'high',
                time_to_first_action: 300 // 5 minutes from install
            });
            
            this.demo.logEvent('✅ Mobile App Journey completed - User should now be an active app user!', 'event');
            this.demo.showNotification('Mobile App Journey complete!', 'success');
        }, 6000));
    }

    // Scenario 6: Re-engagement Campaign Journey
    async runReengagementJourney() {
        this.demo.logEvent('🎬 Starting Re-engagement Campaign Journey', 'event');
        this.demo.showNotification('Running Re-engagement Campaign Journey...', 'info');
        
        // Step 1: Return from email campaign
        this.demo.logEvent('📧 Step 1: Clicking re-engagement email', 'info');
        await this.demo.triggerActionEvent('email_open', {
            campaignId: 'reengagement-campaign-001',
            emailId: 'winback-email-001',
            subject: 'We miss you! Come back for 50% off',
            utm_source: 'email',
            utm_campaign: 'winback',
            days_since_last_visit: 30
        });
        
        // Wait 2 seconds
        this.scenarioTimeouts.push(setTimeout(async () => {
            // Step 2: Browse special offers
            this.demo.logEvent('🎁 Step 2: Viewing special offers', 'info');
            await this.demo.triggerActionEvent('page_view', {
                path: '/special-offers',
                duration: 60000, // 1 minute
                utm_source: 'email',
                utm_campaign: 'winback',
                offer_type: 'discount_50'
            });
        }, 2000));
        
        // Wait 4 seconds total
        this.scenarioTimeouts.push(setTimeout(async () => {
            // Step 3: Update preferences
            this.demo.logEvent('⚙️ Step 3: Updating email preferences', 'info');
            await this.demo.triggerActionEvent('form_submit', {
                formType: 'preference_update',
                formId: 'preferences-form',
                fields: {
                    email_frequency: 'weekly',
                    content_types: ['deals', 'new_products'],
                    opt_in_sms: false,
                    reengaged: true
                }
            });
            
            this.demo.logEvent('✅ Re-engagement Journey completed - User should now be re-engaged!', 'event');
            this.demo.showNotification('Re-engagement Journey complete!', 'success');
        }, 4000));
    }
}

// Add enhanced scenarios to the global demo instance
function initializeScenarios() {
    if (typeof window.demo !== 'undefined' && window.demo !== null) {
        window.demo.scenarios = new DemoScenarios(window.demo);
        
        // Add scenario runner methods to demo instance
        window.demo.runEmailEngagementJourney = () => window.demo.scenarios.runEmailEngagementJourney();
        window.demo.runLeadQualificationJourney = () => window.demo.scenarios.runLeadQualificationJourney();
        window.demo.runEcommerceShoppingJourney = () => window.demo.scenarios.runEcommerceShoppingJourney();
        window.demo.runContentEngagementJourney = () => window.demo.scenarios.runContentEngagementJourney();
        window.demo.runMobileAppJourney = () => window.demo.scenarios.runMobileAppJourney();
        window.demo.runReengagementJourney = () => window.demo.scenarios.runReengagementJourney();
        window.demo.clearScenarios = () => window.demo.scenarios.clearScenarios();
        
        console.log('Scenarios initialized successfully');
    } else {
        // Try again in 100ms if demo is not ready
        setTimeout(initializeScenarios, 100);
    }
}

// Initialize scenarios when document is ready or demo is available
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeScenarios);
} else {
    initializeScenarios();
}