// Visual Demo JavaScript - Banking Personalization
class VisualPersonalizationDemo {
    constructor() {
        this.websocket = null;
        this.userId = 'demo-user-' + Math.random().toString(36).substr(2, 9);
        this.sessionId = null;
        this.eventCount = 0;
        this.engagementScore = 0;
        this.currentSegments = [];
        this.sessionStartTime = Date.now();
        this.currentTab = 'email';
        
        this.initializeDemo();
    }

    initializeDemo() {
        console.log('Visual Personalization Demo initialized');
        this.connectWebSocket();
        this.startSessionTimer();
        this.setupFormTab();
        this.updateMetrics();
    }

    // WebSocket Connection
    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const wsUrl = `${protocol}//${host}/realtime/ws?userId=${this.userId}`;

        this.websocket = new WebSocket(wsUrl);

        this.websocket.onopen = () => {
            console.log('WebSocket connected');
            this.showNotification('Connected to personalization engine', 'success');
        };

        this.websocket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleWebSocketMessage(data);
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };

        this.websocket.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        this.websocket.onclose = () => {
            console.log('WebSocket disconnected');
            setTimeout(() => this.connectWebSocket(), 3000);
        };
    }

    handleWebSocketMessage(data) {
        if (data.type === 'personalization_update' || data.type === 'segment_update') {
            const segments = data.data?.segments || [];
            const score = data.data?.engagementScore || this.engagementScore;
            
            this.updateSegments(segments);
            this.engagementScore = score;
            this.updateMetrics();
        }
    }

    // Content Personalization Functions
    personalizeContent(interest) {
        const heroZone = document.getElementById('hero-zone');
        const promoZone = document.getElementById('promo-zone');
        
        // Add animation class
        heroZone.classList.add('active');
        promoZone.classList.add('active');
        
        // Transition content
        this.transitionContent('hero-content', () => {
            this.updateHeroContent(interest);
        });
        
        this.transitionContent('promo-content', () => {
            this.updatePromoContent(interest);
        });
        
        // Remove animation class after animation
        setTimeout(() => {
            heroZone.classList.remove('active');
            promoZone.classList.remove('active');
        }, 1000);
    }

    transitionContent(elementId, callback) {
        const element = document.getElementById(elementId);
        element.classList.add('transitioning');
        
        setTimeout(() => {
            callback();
            element.classList.remove('transitioning');
        }, 300);
    }

    updateHeroContent(interest) {
        const content = this.getHeroContent(interest);
        const heroContent = document.getElementById('hero-content');
        
        heroContent.innerHTML = `
            <h1 class="hero-title">${content.title}</h1>
            <p class="hero-subtitle">${content.subtitle}</p>
            <button class="hero-cta">${content.cta}</button>
        `;
    }

    updatePromoContent(interest) {
        const content = this.getPromoContent(interest);
        const promoContent = document.getElementById('promo-content');
        
        promoContent.innerHTML = `
            <div class="promo-image">${content.icon}</div>
            <div class="promo-text">
                <h3 class="promo-title">${content.title}</h3>
                <p class="promo-description">${content.description}</p>
                <ul class="promo-features">
                    ${content.features.map(f => `<li>${f}</li>`).join('')}
                </ul>
                <button class="hero-cta">${content.cta}</button>
            </div>
        `;
    }

    getHeroContent(interest) {
        const content = {
            mortgage: {
                title: 'Your Dream Home is Within Reach',
                subtitle: 'Pre-qualified for 3.2% APR - Exclusive rate just for you',
                cta: 'Start Application'
            },
            investment: {
                title: 'Grow Your Wealth with Smart Investing',
                subtitle: 'Free portfolio review and personalized strategies',
                cta: 'Schedule Consultation'
            },
            credit: {
                title: 'Your Platinum Card Awaits',
                subtitle: 'Pre-approved with 2% cash back on everything',
                cta: 'Claim Your Card'
            },
            auto: {
                title: 'Drive Your Dream Car Today',
                subtitle: 'Pre-approved for auto financing at 2.9% APR',
                cta: 'Calculate Payment'
            },
            savings: {
                title: 'Earn More with High-Yield Savings',
                subtitle: '2.5% APY with no minimum balance',
                cta: 'Open Account'
            },
            default: {
                title: 'Welcome to Better Banking',
                subtitle: 'Experience banking that adapts to your needs',
                cta: 'Get Started'
            }
        };
        
        return content[interest] || content.default;
    }

    getPromoContent(interest) {
        const content = {
            mortgage: {
                icon: '🏠',
                title: 'Mortgage Calculator',
                description: 'See your personalized rate and monthly payment',
                features: [
                    'Estimated payment: $1,850/month',
                    'No PMI required',
                    '90-day rate lock guarantee'
                ],
                cta: 'Calculate Now'
            },
            investment: {
                icon: '📈',
                title: 'Free Portfolio Review',
                description: 'Get expert advice tailored to your goals',
                features: [
                    'Personalized investment strategy',
                    'Risk assessment included',
                    'No obligation consultation'
                ],
                cta: 'Book Review'
            },
            credit: {
                icon: '💳',
                title: 'Platinum Rewards Calculator',
                description: 'See how much you could earn',
                features: [
                    '$500 sign-up bonus',
                    'No annual fee ever',
                    'Travel insurance included'
                ],
                cta: 'See Rewards'
            },
            auto: {
                icon: '🚗',
                title: 'Auto Loan Calculator',
                description: 'Your pre-approved rate and terms',
                features: [
                    'Payment as low as $299/month',
                    'No down payment options',
                    'Gap insurance included'
                ],
                cta: 'Calculate Payment'
            },
            savings: {
                icon: '💰',
                title: 'Savings Growth Calculator',
                description: 'Watch your money grow faster',
                features: [
                    '$250 bonus for new accounts',
                    'No minimum balance',
                    'FDIC insured up to $250k'
                ],
                cta: 'Calculate Growth'
            },
            default: {
                icon: '🏦',
                title: 'Open an Account Today',
                description: 'Join thousands of satisfied customers',
                features: [
                    'Free checking account',
                    'Mobile and online banking',
                    '24/7 customer support'
                ],
                cta: 'Get Started'
            }
        };
        
        return content[interest] || content.default;
    }

    // Email Actions
    async openEmail(type) {
        const emailElement = document.getElementById(`email-${type}`);
        emailElement.classList.remove('unread');
        
        // Show loading state
        this.showNotification('Opening email...', 'info');
        
        // Send event to backend
        await this.triggerAction('email_open', {
            emailType: type,
            campaignId: `${type}-campaign-001`,
            subject: emailElement.querySelector('.email-subject').textContent
        });
        
        // Update personalization
        this.personalizeContent(type);
        
        // Add segment
        const segmentMap = {
            mortgage: 'mortgage_interested',
            investment: 'investment_interested',
            credit: 'card_interested'
        };
        
        this.addSegment(segmentMap[type]);
        this.eventCount++;
        this.engagementScore += 15;
        this.updateMetrics();
        
        this.showNotification(`Content personalized for ${type} interest`, 'success');
    }

    // Form Actions
    setupFormTab() {
        // Clone the website structure to form tab
        const formTab = document.getElementById('form-tab');
        const websitePanel = formTab.querySelector('.website-panel');
        
        if (websitePanel) {
            const originalWebsite = document.querySelector('#email-tab .bank-website').cloneNode(true);
            websitePanel.innerHTML = '';
            websitePanel.appendChild(originalWebsite);
            
            // Update IDs to avoid conflicts
            const heroZone = websitePanel.querySelector('.hero-banner');
            const promoZone = websitePanel.querySelector('.promo-card-zone');
            const heroContent = websitePanel.querySelector('.hero-content');
            const promoContent = websitePanel.querySelector('.promo-content');
            
            if (heroZone) heroZone.id = 'form-hero-zone';
            if (promoZone) promoZone.id = 'form-promo-zone';
            if (heroContent) heroContent.id = 'form-hero-content';
            if (promoContent) promoContent.id = 'form-promo-content';
        }
        
        // Setup browse tab too
        this.setupBrowseTab();
    }
    
    setupBrowseTab() {
        const browseTab = document.getElementById('browse-tab');
        const websitePanel = browseTab.querySelector('.website-panel');
        
        if (websitePanel) {
            const originalWebsite = document.querySelector('#email-tab .bank-website').cloneNode(true);
            websitePanel.innerHTML = '';
            websitePanel.appendChild(originalWebsite);
            
            // Update IDs for browse tab
            const heroZone = websitePanel.querySelector('.hero-banner');
            const promoZone = websitePanel.querySelector('.promo-card-zone');
            const heroContent = websitePanel.querySelector('.hero-content');
            const promoContent = websitePanel.querySelector('.promo-content');
            
            if (heroZone) heroZone.id = 'browse-hero-zone';
            if (promoZone) promoZone.id = 'browse-promo-zone';
            if (heroContent) heroContent.id = 'browse-hero-content';
            if (promoContent) promoContent.id = 'browse-promo-content';
        }
    }

    async submitForm() {
        const interestSelect = document.getElementById('interest-select');
        const interest = interestSelect.value;
        
        if (!interest) {
            this.showNotification('Please select an interest', 'error');
            return;
        }
        
        // Show loading
        this.showNotification('Submitting form...', 'info');
        
        // Send event to backend
        await this.triggerAction('form_submit', {
            formType: 'contact',
            interest: interest,
            name: 'Sarah Johnson',
            email: 'sarah.johnson@email.com'
        });
        
        // Get the form tab's specific zones (with form- prefix)
        const formTab = document.getElementById('form-tab');
        const heroZone = formTab.querySelector('#form-hero-zone');
        const promoZone = formTab.querySelector('#form-promo-zone');
        const heroContent = formTab.querySelector('#form-hero-content');
        const promoContent = formTab.querySelector('#form-promo-content');
        
        // Add animation
        if (heroZone) heroZone.classList.add('active');
        if (promoZone) promoZone.classList.add('active');
        
        // Update content in form tab with transition
        if (heroContent && promoContent) {
            // Transition hero content
            heroContent.classList.add('transitioning');
            setTimeout(() => {
                const heroData = this.getHeroContent(interest);
                heroContent.innerHTML = `
                    <h1 class="hero-title">${heroData.title}</h1>
                    <p class="hero-subtitle">${heroData.subtitle}</p>
                    <button class="hero-cta">${heroData.cta}</button>
                `;
                heroContent.classList.remove('transitioning');
            }, 300);
            
            // Transition promo content
            promoContent.classList.add('transitioning');
            setTimeout(() => {
                const promoData = this.getPromoContent(interest);
                promoContent.innerHTML = `
                    <div class="promo-image">${promoData.icon}</div>
                    <div class="promo-text">
                        <h3 class="promo-title">${promoData.title}</h3>
                        <p class="promo-description">${promoData.description}</p>
                        <ul class="promo-features">
                            ${promoData.features.map(f => `<li>${f}</li>`).join('')}
                        </ul>
                        <button class="hero-cta">${promoData.cta}</button>
                    </div>
                `;
                promoContent.classList.remove('transitioning');
            }, 300);
        }
        
        // Remove animation after a delay
        setTimeout(() => {
            if (heroZone) heroZone.classList.remove('active');
            if (promoZone) promoZone.classList.remove('active');
        }, 1000);
        
        // Add segment
        const segmentMap = {
            mortgage: 'mortgage_lead',
            investment: 'investment_lead',
            credit: 'card_lead',
            auto: 'auto_lead',
            savings: 'savings_lead'
        };
        
        this.addSegment(segmentMap[interest]);
        this.addSegment('qualified_lead');
        this.eventCount++;
        this.engagementScore += 25;
        this.updateMetrics();
        
        this.showNotification(`Form submitted - Personalized for ${interest}`, 'success');
    }

    // API Communication
    async triggerAction(eventType, eventData) {
        try {
            const response = await fetch('/realtime/action', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({
                    type: eventType,
                    userId: this.userId,
                    data: eventData,
                    source: 'visual-demo',
                    timestamp: Date.now()
                })
            });
            
            const result = await response.json();
            console.log('Action result:', result);
            return result;
        } catch (error) {
            console.error('Error triggering action:', error);
        }
    }

    // UI Updates
    updateSegments(segments) {
        this.currentSegments = segments;
        const badgesContainer = document.getElementById('segment-badges');
        
        badgesContainer.innerHTML = segments.map(segment => 
            `<span class="segment-badge">${segment.replace(/_/g, ' ')}</span>`
        ).join('');
    }

    addSegment(segment) {
        if (!this.currentSegments.includes(segment)) {
            this.currentSegments.push(segment);
            this.updateSegments(this.currentSegments);
        }
    }

    updateMetrics() {
        document.getElementById('event-count').textContent = this.eventCount;
        document.getElementById('engagement-score').textContent = this.engagementScore;
    }

    startSessionTimer() {
        setInterval(() => {
            const duration = Math.floor((Date.now() - this.sessionStartTime) / 1000);
            const minutes = Math.floor(duration / 60);
            const seconds = duration % 60;
            document.getElementById('session-duration').textContent = 
                `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }, 1000);
    }

    showNotification(message, type = 'info') {
        console.log(`[${type.toUpperCase()}] ${message}`);
        // Could add visual toast notifications here
    }
    
    // Browse Actions
    async browseAction(action) {
        const browseTab = document.getElementById('browse-tab');
        const heroZone = browseTab.querySelector('#browse-hero-zone');
        const promoZone = browseTab.querySelector('#browse-promo-zone');
        const heroContent = browseTab.querySelector('#browse-hero-content');
        const promoContent = browseTab.querySelector('#browse-promo-content');
        
        // Update browse history
        const historyDiv = document.getElementById('browse-history');
        const timestamp = new Date().toLocaleTimeString();
        const actionMap = {
            'pricing': '💰 Viewed Mortgage Rates',
            'calculator': '🧮 Used Loan Calculator',
            'compare': '📊 Compared Accounts',
            'blog': '📚 Read Investment Guide',
            'application': '📝 Started Application'
        };
        
        if (historyDiv) {
            if (historyDiv.innerHTML.includes('No pages viewed')) {
                historyDiv.innerHTML = '';
            }
            historyDiv.innerHTML = `<div style="padding: 5px 0;">${timestamp} - ${actionMap[action]}</div>` + historyDiv.innerHTML;
        }
        
        // Send event to backend
        await this.triggerAction('page_view', {
            path: `/banking/${action}`,
            action: action,
            duration: Math.floor(Math.random() * 60000) + 10000
        });
        
        // Personalize based on browse behavior
        let interest = 'default';
        if (action === 'pricing' || action === 'calculator') interest = 'mortgage';
        if (action === 'blog') interest = 'investment';
        if (action === 'compare') interest = 'savings';
        if (action === 'application') interest = 'auto';
        
        // Add animation
        if (heroZone) heroZone.classList.add('active');
        if (promoZone) promoZone.classList.add('active');
        
        // Update content with transition
        if (heroContent) {
            heroContent.classList.add('transitioning');
            setTimeout(() => {
                const heroData = this.getHeroContent(interest);
                heroContent.innerHTML = `
                    <h1 class="hero-title">${heroData.title}</h1>
                    <p class="hero-subtitle">${heroData.subtitle}</p>
                    <button class="hero-cta">${heroData.cta}</button>
                `;
                heroContent.classList.remove('transitioning');
            }, 300);
        }
        
        if (promoContent) {
            promoContent.classList.add('transitioning');
            setTimeout(() => {
                const promoData = this.getPromoContent(interest);
                promoContent.innerHTML = `
                    <div class="promo-image">${promoData.icon}</div>
                    <div class="promo-text">
                        <h3 class="promo-title">${promoData.title}</h3>
                        <p class="promo-description">${promoData.description}</p>
                        <ul class="promo-features">
                            ${promoData.features.map(f => `<li>${f}</li>`).join('')}
                        </ul>
                        <button class="hero-cta">${promoData.cta}</button>
                    </div>
                `;
                promoContent.classList.remove('transitioning');
            }, 300);
        }
        
        // Remove animation
        setTimeout(() => {
            if (heroZone) heroZone.classList.remove('active');
            if (promoZone) promoZone.classList.remove('active');
        }, 1000);
        
        // Add browse-specific segments
        const segmentMap = {
            'pricing': 'price_interested',
            'calculator': 'calculator_user',
            'compare': 'comparison_shopper',
            'blog': 'content_consumer',
            'application': 'high_intent'
        };
        
        this.addSegment(segmentMap[action]);
        this.eventCount++;
        this.engagementScore += 8;
        this.updateMetrics();
        
        this.showNotification(`Personalized based on ${actionMap[action]}`, 'success');
    }
}

// Tab Switching
function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');
    
    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`${tabName}-tab`).classList.add('active');
}

// Email Actions
function openEmail(type) {
    window.visualDemo.openEmail(type);
}

// Form Actions
function submitForm() {
    window.visualDemo.submitForm();
}

// Browse Actions
function browseAction(action) {
    window.visualDemo.browseAction(action);
}

// Developer Mode Toggle
function toggleDevMode(element) {
    element.classList.toggle('active');
    const isActive = element.classList.contains('active');
    
    if (isActive) {
        console.log('Developer mode enabled - Technical details visible');
        // Could show additional technical panels here
    } else {
        console.log('Developer mode disabled - Business view active');
    }
}

// Initialize Demo
let visualDemo;
document.addEventListener('DOMContentLoaded', () => {
    visualDemo = new VisualPersonalizationDemo();
    window.visualDemo = visualDemo;
});