// Visual Demo JavaScript - Banking Personalization
class VisualPersonalizationDemo {
    constructor() {
        this.websocket = null;
        this.visitorId = 'v-' + Math.random().toString(36).substr(2, 9).toUpperCase();
        this.userId = null; // Will be set when identified
        this.sessionId = 's-' + Date.now().toString(36).toUpperCase();
        this.eventCount = 0;
        this.engagementScore = 0;
        this.currentSegments = [];
        this.sessionStartTime = Date.now();
        this.currentTab = 'email';
        this.journeyStage = 'aware';
        this.systemResponses = [];
        this.userProfile = null;
        this.eventHistory = [];
        this.devMode = false;
        this.consoleTab = 'tracking';
        
        this.initializeDemo();
    }

    initializeDemo() {
        console.log('Visual Personalization Demo initialized');
        this.updateVisitorInfo();
        this.connectWebSocket();
        this.startSessionTimer();
        this.setupFormTab();
        this.updateMetrics();
        this.showSystemResponse();
        this.startDevConsoleUpdates();
    }

    // WebSocket Connection
    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const wsUrl = `${protocol}//${host}/realtime/ws?userId=${this.visitorId}`;

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
            <button class="hero-cta" onclick="handleCTAClick(this, 'hero-${interest}')">${content.cta}</button>
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
                <button class="hero-cta" onclick="handleCTAClick(this, 'promo-${interest}')">${content.cta}</button>
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
        this.updateJourneyProgress();
        
        // Add marketing automation response
        const responseMessages = {
            mortgage: 'Mortgage consultation email scheduled',
            investment: 'Portfolio review invitation sent',
            credit: 'Card application link sent'
        };
        
        this.addSystemResponse('email', responseMessages[type], 'Will send in 2 hours');
        this.showNotification(`Content personalized for ${type} interest`, 'success');
    }

    // Form Actions
    setupFormTab() {
        // Clone the website structure to form tab
        const formTab = document.getElementById('form-tab');
        const websiteContainer = formTab.querySelector('.website-container');
        
        if (websiteContainer) {
            const originalWebsite = document.querySelector('#email-tab .bank-website').cloneNode(true);
            // Find existing content after journey progress and replace
            const existingContent = websiteContainer.querySelector('.bank-website');
            if (existingContent) {
                existingContent.remove();
            }
            websiteContainer.appendChild(originalWebsite);
            
            // Update IDs to avoid conflicts
            const heroZone = websiteContainer.querySelector('.hero-banner');
            const promoZone = websiteContainer.querySelector('.promo-card-zone');
            const heroContent = websiteContainer.querySelector('.hero-content');
            const promoContent = websiteContainer.querySelector('.promo-content');
            
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
        const websiteContainer = browseTab.querySelector('.website-container');
        
        if (websiteContainer) {
            const originalWebsite = document.querySelector('#email-tab .bank-website').cloneNode(true);
            // Find existing content after journey progress and replace
            const existingContent = websiteContainer.querySelector('.bank-website');
            if (existingContent) {
                existingContent.remove();
            }
            websiteContainer.appendChild(originalWebsite);
            
            // Update IDs for browse tab
            const heroZone = websiteContainer.querySelector('.hero-banner');
            const promoZone = websiteContainer.querySelector('.promo-card-zone');
            const heroContent = websiteContainer.querySelector('.hero-content');
            const promoContent = websiteContainer.querySelector('.promo-content');
            
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
                    <button class="hero-cta" onclick="handleCTAClick(this, 'form-hero-${interest}')">${heroData.cta}</button>
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
                        <button class="hero-cta" onclick="handleCTAClick(this, 'form-promo-${interest}')">${promoData.cta}</button>
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
        this.updateJourneyProgress();
        
        // Identify the user and build profile
        this.identifyUser({
            name: 'Sarah Johnson',
            email: 'sarah.johnson@email.com',
            phone: '(555) 123-4567',
            interest: interest,
            company: 'Acme Corp'
        });
        
        // Add marketing automation responses
        this.addSystemResponse('campaign', `${interest.charAt(0).toUpperCase() + interest.slice(1)} nurture campaign started`, '5-email sequence');
        this.addSystemResponse('alert', 'Sales team notified', 'High-value lead assigned');
        
        this.showNotification(`Form submitted - Personalized for ${interest}`, 'success');
    }

    // API Communication
    async triggerAction(eventType, eventData) {
        // Log the event
        this.logEvent(eventType, eventData);
        
        try {
            const response = await fetch('/realtime/action', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({
                    type: eventType,
                    userId: this.userId || this.visitorId,
                    visitorId: this.visitorId,
                    sessionId: this.sessionId,
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
    
    // Visitor Tracking
    updateVisitorInfo() {
        document.getElementById('visitor-id').textContent = this.visitorId;
        document.getElementById('session-id').textContent = this.sessionId;
        
        if (this.userProfile) {
            document.getElementById('visitor-status-text').textContent = 'Identified Customer';
            document.getElementById('visitor-profile').style.display = 'block';
            document.getElementById('profile-name').textContent = this.userProfile.name;
            document.getElementById('profile-email').textContent = this.userProfile.email;
        } else {
            document.getElementById('visitor-status-text').textContent = 'Unknown Visitor';
            document.getElementById('visitor-profile').style.display = 'none';
        }
    }
    
    identifyUser(profile) {
        this.userProfile = profile;
        this.userId = 'user-' + profile.email.split('@')[0].toLowerCase();
        this.updateVisitorInfo();
        
        // Add identified segment
        this.addSegment('identified_user');
        this.addSegment('known_customer');
        
        // Log to event history
        this.logEvent('user_identified', profile);
    }
    
    logEvent(eventType, data) {
        const event = {
            timestamp: new Date().toISOString(),
            type: eventType,
            data: data,
            visitorId: this.visitorId,
            userId: this.userId,
            sessionId: this.sessionId
        };
        
        this.eventHistory.unshift(event);
        if (this.eventHistory.length > 50) {
            this.eventHistory.pop();
        }
        
        // Update dev console if active
        if (this.devMode && this.consoleTab === 'events') {
            this.updateDevConsole();
        }
    }
    
    // Journey Progress Management
    updateJourneyProgress() {
        // Update for all tabs
        this.updateJourneyProgressForTab('email');
        this.updateJourneyProgressForTab('form');
        this.updateJourneyProgressForTab('browse');
        
        // Track the journey stage
        const stages = ['aware', 'interested', 'engaged', 'qualified', 'ready'];
        let stageIndex = 0;
        if (this.engagementScore >= 8) stageIndex = 1; // Interested
        if (this.engagementScore >= 15) stageIndex = 2; // Engaged  
        if (this.engagementScore >= 25) stageIndex = 3; // Qualified
        if (this.engagementScore >= 35) stageIndex = 4; // Ready
        
        this.journeyStage = stages[stageIndex];
    }
    
    // System Response Panel
    showSystemResponse() {
        const panel = document.getElementById('system-response');
        if (panel) {
            panel.classList.add('active');
        }
    }
    
    showSystemResponseForTab(tabName) {
        // Show the appropriate system response panel for the current tab
        const panels = ['system-response', 'form-system-response', 'browse-system-response'];
        panels.forEach(panelId => {
            const panel = document.getElementById(panelId);
            if (panel) panel.classList.remove('active');
        });
        
        let panelId = 'system-response';
        if (tabName === 'form') panelId = 'form-system-response';
        if (tabName === 'browse') panelId = 'browse-system-response';
        
        const panel = document.getElementById(panelId);
        if (panel) panel.classList.add('active');
    }
    
    updateJourneyProgressForTab(tabName) {
        // Update journey progress for the specific tab
        let prefix = '';
        if (tabName === 'form') prefix = 'form-';
        if (tabName === 'browse') prefix = 'browse-';
        
        const stages = ['aware', 'interested', 'engaged', 'qualified', 'ready'];
        const progressBar = document.getElementById(prefix + 'journey-progress');
        const progressFill = document.getElementById(prefix + 'progress-fill');
        
        if (progressBar && !progressBar.classList.contains('active')) {
            progressBar.classList.add('active');
        }
        
        // Calculate progress based on engagement score
        let stageIndex = 0;
        if (this.engagementScore >= 8) stageIndex = 1; // Interested
        if (this.engagementScore >= 15) stageIndex = 2; // Engaged  
        if (this.engagementScore >= 25) stageIndex = 3; // Qualified
        if (this.engagementScore >= 35) stageIndex = 4; // Ready
        
        const progressPercent = Math.min(100, (stageIndex + 1) * 20);
        
        if (progressFill) {
            progressFill.style.width = progressPercent + '%';
        }
        
        // Update stage indicators
        stages.forEach((stage, index) => {
            const stageElement = document.getElementById(prefix + `stage-${stage}`);
            if (stageElement) {
                stageElement.classList.remove('active', 'completed');
                if (index < stageIndex) {
                    stageElement.classList.add('completed');
                } else if (index === stageIndex) {
                    stageElement.classList.add('active');
                }
            }
        });
        
        // Update engagement meter for this tab
        const meterFill = document.getElementById(prefix + 'meter-fill');
        const meterValue = document.getElementById(prefix + 'meter-value');
        
        if (meterFill && meterValue) {
            const fillPercent = Math.max(0, 100 - Math.min(100, this.engagementScore * 1.5));
            meterFill.style.width = fillPercent + '%';
            meterValue.textContent = `${this.engagementScore}°`;
        }
    }
    
    addSystemResponse(type, message, detail) {
        // Add to the appropriate response panel based on current tab
        let responseItemsId = 'response-items';
        if (this.currentTab === 'form') responseItemsId = 'form-response-items';
        if (this.currentTab === 'browse') responseItemsId = 'browse-response-items';
        
        const responseItems = document.getElementById(responseItemsId);
        if (!responseItems) return;
        
        const responseItem = document.createElement('div');
        responseItem.className = `response-item ${type}`;
        responseItem.innerHTML = `
            <div class="response-type">${this.getResponseTypeLabel(type)}</div>
            <div class="response-message">${message}</div>
            ${detail ? `<div class="response-detail">${detail}</div>` : ''}
        `;
        
        responseItems.insertBefore(responseItem, responseItems.firstChild);
        
        // Keep only last 5 responses
        while (responseItems.children.length > 5) {
            responseItems.removeChild(responseItems.lastChild);
        }
        
        // Update engagement meter
        this.updateEngagementMeter();
    }
    
    getResponseTypeLabel(type) {
        const labels = {
            'email': 'Email Triggered',
            'campaign': 'Campaign Active',
            'alert': 'Sales Alert',
            'action': 'Next Action'
        };
        return labels[type] || 'System Response';
    }
    
    updateEngagementMeter() {
        // Update engagement meter for all tabs
        const prefixes = ['', 'form-', 'browse-'];
        prefixes.forEach(prefix => {
            const meterFill = document.getElementById(prefix + 'meter-fill');
            const meterValue = document.getElementById(prefix + 'meter-value');
            
            if (meterFill && meterValue) {
                const fillPercent = Math.max(0, 100 - Math.min(100, this.engagementScore * 1.5));
                meterFill.style.width = fillPercent + '%';
                meterValue.textContent = `${this.engagementScore}°`;
            }
        });
    }
    
    // CTA Click Handler
    async handleCTAClick(button, zone) {
        // Add loading state
        button.classList.add('loading');
        button.disabled = true;
        const originalText = button.textContent;
        
        // Trigger action event
        await this.triggerAction('button_click', {
            buttonId: `${zone}-cta`,
            label: button.textContent,
            zone: zone
        });
        
        // Simulate processing
        setTimeout(() => {
            button.classList.remove('loading');
            button.classList.add('success');
            button.textContent = 'Thank You!';
            
            // Different responses based on zone and button text
            if (zone.includes('mortgage')) {
                this.addSystemResponse('action', 'Mortgage specialist notified', 'Will call within 24 hours');
                this.addSegment('mortgage_qualified');
            } else if (zone.includes('investment')) {
                this.addSystemResponse('action', 'Portfolio review scheduled', 'Advisor will contact you');
                this.addSegment('investment_qualified');
            } else if (zone.includes('credit')) {
                this.addSystemResponse('action', 'Card application started', 'Instant approval pending');
                this.addSegment('card_qualified');
            } else if (originalText.includes('Calculate')) {
                this.addSystemResponse('action', 'Calculator results saved', 'Personalized offer generated');
                this.addSegment('calculator_used');
            } else {
                this.addSystemResponse('action', 'CTA clicked - Lead captured', `${zone} zone conversion`);
            }
            
            // Update engagement - bigger boost for qualified actions
            this.engagementScore += 12;
            this.eventCount++;
            this.updateMetrics();
            this.updateJourneyProgress();
            
            // Reset after 3 seconds
            setTimeout(() => {
                button.classList.remove('success');
                button.disabled = false;
                button.textContent = originalText;
            }, 3000);
        }, 1500);
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
                    <button class="hero-cta" onclick="handleCTAClick(this, 'browse-hero-${interest}')">${heroData.cta}</button>
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
                        <button class="hero-cta" onclick="handleCTAClick(this, 'browse-promo-${interest}')">${promoData.cta}</button>
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
        this.updateJourneyProgress();
        
        // Add browse-specific responses
        if (action === 'application') {
            this.addSystemResponse('alert', 'Abandonment detected', 'Recovery email queued');
        } else if (action === 'calculator') {
            this.addSystemResponse('action', 'Calculator used', 'Pre-qualify offer ready');
        }
        
        this.showNotification(`Personalized based on ${actionMap[action]}`, 'success');
    }
    
    // Developer Console
    startDevConsoleUpdates() {
        setInterval(() => {
            if (this.devMode) {
                this.updateDevConsole();
            }
        }, 2000);
    }
    
    updateDevConsole() {
        const content = document.getElementById('console-content');
        if (!content) return;
        
        let html = '';
        
        switch (this.consoleTab) {
            case 'tracking':
                html = this.getTrackingConsoleHTML();
                break;
            case 'events':
                html = this.getEventsConsoleHTML();
                break;
            case 'segments':
                html = this.getSegmentsConsoleHTML();
                break;
            case 'features':
                html = this.getFeaturesConsoleHTML();
                break;
        }
        
        content.innerHTML = html;
    }
    
    getTrackingConsoleHTML() {
        return `
            <div class="console-section">
                <div class="console-section-title">Visitor Tracking</div>
                <div class="console-entry">
                    <span class="console-key">Visitor ID:</span>
                    <span class="console-value">${this.visitorId}</span>
                </div>
                <div class="console-entry">
                    <span class="console-key">User ID:</span>
                    <span class="console-value">${this.userId || 'anonymous'}</span>
                </div>
                <div class="console-entry">
                    <span class="console-key">Session ID:</span>
                    <span class="console-value">${this.sessionId}</span>
                </div>
                <div class="console-entry">
                    <span class="console-key">Status:</span>
                    <span class="console-value">${this.userProfile ? 'Identified' : 'Anonymous'}</span>
                </div>
            </div>
            <div class="console-section">
                <div class="console-section-title">Session Metrics</div>
                <div class="console-entry">
                    <span class="console-key">Duration:</span>
                    <span class="console-value">${Math.floor((Date.now() - this.sessionStartTime) / 1000)}s</span>
                </div>
                <div class="console-entry">
                    <span class="console-key">Events:</span>
                    <span class="console-value">${this.eventCount}</span>
                </div>
                <div class="console-entry">
                    <span class="console-key">Engagement:</span>
                    <span class="console-value">${this.engagementScore}</span>
                </div>
                <div class="console-entry">
                    <span class="console-key">Journey Stage:</span>
                    <span class="console-value">${this.journeyStage}</span>
                </div>
            </div>
            ${this.userProfile ? `
            <div class="console-section">
                <div class="console-section-title">User Profile</div>
                <div class="console-entry">
                    <span class="console-key">Name:</span>
                    <span class="console-value">${this.userProfile.name}</span>
                </div>
                <div class="console-entry">
                    <span class="console-key">Email:</span>
                    <span class="console-value">${this.userProfile.email}</span>
                </div>
                <div class="console-entry">
                    <span class="console-key">Interest:</span>
                    <span class="console-value">${this.userProfile.interest}</span>
                </div>
            </div>
            ` : ''}
        `;
    }
    
    getEventsConsoleHTML() {
        let html = '<div class="console-section-title">Event History (Last 10)</div>';
        
        this.eventHistory.slice(0, 10).forEach(event => {
            const time = new Date(event.timestamp).toLocaleTimeString();
            html += `
                <div class="console-entry">
                    <span class="console-key">[${time}]</span>
                    <span class="console-value">${event.type}</span>
                </div>
            `;
        });
        
        return html || '<div class="console-entry">No events yet</div>';
    }
    
    getSegmentsConsoleHTML() {
        let html = `
            <div class="console-section">
                <div class="console-section-title">Active Segments (${this.currentSegments.length})</div>
        `;
        
        this.currentSegments.forEach(segment => {
            html += `
                <div class="console-entry">
                    <span class="console-value">✓ ${segment}</span>
                </div>
            `;
        });
        
        html += '</div>';
        return html;
    }
    
    getFeaturesConsoleHTML() {
        return `
            <div class="console-section">
                <div class="console-section-title">Feature Flags</div>
                <div class="console-entry">
                    <span class="console-key">Personalization:</span>
                    <span class="console-value">enabled</span>
                </div>
                <div class="console-entry">
                    <span class="console-key">Real-time:</span>
                    <span class="console-value">enabled</span>
                </div>
                <div class="console-entry">
                    <span class="console-key">WebSocket:</span>
                    <span class="console-value">${this.websocket && this.websocket.readyState === WebSocket.OPEN ? 'connected' : 'disconnected'}</span>
                </div>
            </div>
            <div class="console-section">
                <div class="console-section-title">Optimizely Features</div>
                <div class="console-entry">
                    <span class="console-key">SDK Status:</span>
                    <span class="console-value">mock mode</span>
                </div>
                <div class="console-entry">
                    <span class="console-key">Datafile:</span>
                    <span class="console-value">not configured</span>
                </div>
                <div class="console-entry">
                    <span class="console-key">Experiments:</span>
                    <span class="console-value">0 active</span>
                </div>
            </div>
        `;
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
    
    // Update current tab in demo instance
    if (window.visualDemo) {
        window.visualDemo.currentTab = tabName;
        // Show system response panel for new tab
        window.visualDemo.showSystemResponseForTab(tabName);
        // Update journey progress for new tab
        window.visualDemo.updateJourneyProgressForTab(tabName);
    }
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

// CTA Click Handler
function handleCTAClick(button, zone) {
    window.visualDemo.handleCTAClick(button, zone);
}

// Developer Mode Toggle
function toggleDevMode(element) {
    element.classList.toggle('active');
    const isActive = element.classList.contains('active');
    
    if (window.visualDemo) {
        window.visualDemo.devMode = isActive;
        const devConsole = document.getElementById('dev-console');
        
        if (isActive) {
            devConsole.classList.add('active');
            window.visualDemo.updateDevConsole();
            console.log('Developer mode enabled - Technical console visible');
        } else {
            devConsole.classList.remove('active');
            console.log('Developer mode disabled - Business view active');
        }
    }
}

function closeDevConsole() {
    const devConsole = document.getElementById('dev-console');
    const toggleSwitch = document.querySelector('.toggle-switch');
    
    devConsole.classList.remove('active');
    toggleSwitch.classList.remove('active');
    
    if (window.visualDemo) {
        window.visualDemo.devMode = false;
    }
}

function switchConsoleTab(tab) {
    document.querySelectorAll('.console-tab').forEach(t => {
        t.classList.remove('active');
    });
    event.target.classList.add('active');
    
    if (window.visualDemo) {
        window.visualDemo.consoleTab = tab;
        window.visualDemo.updateDevConsole();
    }
}

// Initialize Demo
let visualDemo;
document.addEventListener('DOMContentLoaded', () => {
    visualDemo = new VisualPersonalizationDemo();
    window.visualDemo = visualDemo;
});