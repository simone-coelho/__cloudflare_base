// Real-Time Personalization Demo
class PersonalizationDemo {
    constructor() {
        this.websocket = null;
        this.userId = 'demo-user-123';
        this.sessionId = null;
        this.sessionStartTime = Date.now();
        this.eventCount = 0;
        this.updateCount = 0;
        this.currentSegments = ['new_user'];
        this.engagementScore = 0;
        
        this.initializeDemo();
    }

    initializeDemo() {
        this.logEvent('Demo initialized - Ready for real-time personalization', 'info');
        this.updateMetrics();
        this.loadPersonalizationConfig();
        this.startSessionTimer();
        // Set initial example data for custom events
        setTimeout(() => this.updateEventDataExample(), 100);
    }

    // WebSocket Management
    connectWebSocket() {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            this.showNotification('Already connected!', 'warning');
            return;
        }

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const wsUrl = `${protocol}//${host}/realtime/ws?userId=${this.userId}`;

        this.logEvent(`Connecting to WebSocket: ${wsUrl}`, 'info');
        
        this.websocket = new WebSocket(wsUrl);

        this.websocket.onopen = (event) => {
            this.logEvent('WebSocket connected successfully', 'event');
            this.updateConnectionStatus(true);
            this.showNotification('Connected to real-time updates!', 'success');
        };

        this.websocket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                this.handleWebSocketMessage(data);
            } catch (error) {
                this.logEvent(`Error parsing WebSocket message: ${error.message}`, 'error');
            }
        };

        this.websocket.onerror = (error) => {
            this.logEvent(`WebSocket error: ${error}`, 'error');
            this.showNotification('WebSocket connection error', 'error');
        };

        this.websocket.onclose = (event) => {
            this.logEvent(`WebSocket closed: ${event.code} - ${event.reason}`, 'info');
            this.updateConnectionStatus(false);
            this.showNotification('Disconnected from real-time updates', 'warning');
        };
    }

    disconnectWebSocket() {
        if (this.websocket) {
            this.websocket.close();
            this.websocket = null;
            this.updateConnectionStatus(false);
            this.logEvent('WebSocket disconnected manually', 'info');
        }
    }

    handleWebSocketMessage(data) {
        this.logEvent(`Real-time update received: ${data.type}`, 'event');
        
        switch (data.type) {
            case 'connected':
                this.sessionId = data.connectionId;
                this.updateSessionInfo();
                break;
                
            case 'personalization_update':
                this.handlePersonalizationUpdate(data);
                break;
                
            case 'segment_update':
                this.handleSegmentUpdate(data);
                break;
                
            case 'heartbeat_response':
                // Handle heartbeat if needed
                break;
                
            default:
                this.logEvent(`Unknown message type: ${data.type}`, 'info');
        }
    }

    handlePersonalizationUpdate(data) {
        this.updateCount++;
        
        if (data.data.segments) {
            const oldSegments = [...this.currentSegments];
            this.currentSegments = data.data.segments;
            this.updateSegmentsDisplay(oldSegments);
        }
        
        if (data.data.engagementScore !== undefined) {
            this.engagementScore = data.data.engagementScore;
            document.getElementById('engagementScore').textContent = this.engagementScore;
        }
        
        this.updateMetrics();
        this.flashPersonalizationDisplay();
        this.showNotification('Personalization updated in real-time!', 'success');
        
        this.logEvent(`Segments updated: ${this.currentSegments.join(', ')}`, 'event');
    }

    handleSegmentUpdate(data) {
        if (data.data.segments) {
            const oldSegments = [...this.currentSegments];
            this.currentSegments = data.data.segments;
            this.updateSegmentsDisplay(oldSegments);
            this.updateCount++;
            this.updateMetrics();
        }
    }

    // API Calls
    async loadPersonalizationConfig() {
        try {
            const response = await fetch(`/realtime/personalization/${this.userId}`);
            const data = await response.json();
            
            if (data.success !== false) {
                this.sessionId = data.sessionId;
                this.currentSegments = data.config.segments || ['new_user'];
                this.updateSessionInfo();
                this.updateSegmentsDisplay([]);
                this.logEvent('Personalization config loaded', 'info');
            }
        } catch (error) {
            this.logEvent(`Error loading personalization config: ${error.message}`, 'error');
        }
    }

    async triggerActionEvent(eventType, eventData) {
        try {
            this.eventCount++;
            
            const event = {
                type: eventType,
                userId: this.userId,
                data: eventData,
                source: 'demo-ui',
                timestamp: Date.now()
            };

            const response = await fetch('/realtime/action', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(event)
            });

            const result = await response.json();
            
            if (result.success) {
                this.logEvent(`Event sent: ${eventType}`, 'event');
                this.updateMetrics();
                
                if (result.update) {
                    this.logEvent('Personalization will update shortly...', 'info');
                }
            } else {
                this.logEvent(`Event failed: ${result.error}`, 'error');
            }
            
        } catch (error) {
            this.logEvent(`Error sending event: ${error.message}`, 'error');
            this.showNotification('Failed to send event', 'error');
        }
    }

    // Demo Scenarios
    triggerEmailOpen() {
        this.triggerActionEvent('email_open', {
            campaignId: 'demo-campaign-001',
            emailId: `email-${Date.now()}`,
            subject: 'Real-time Personalization Demo'
        });
    }

    triggerFormSubmit() {
        this.triggerActionEvent('form_submit', {
            formType: 'lead_capture',
            formId: 'demo-form',
            fields: {
                email: 'demo@example.com',
                company: 'Demo Corp',
                interest: 'real-time-personalization'
            }
        });
    }

    triggerPricingView() {
        this.triggerActionEvent('page_view', {
            path: '/pricing',
            duration: 120000, // 2 minutes
            plan_viewed: 'enterprise',
            utm_source: 'demo'
        });
    }

    triggerDemoRequest() {
        this.triggerActionEvent('form_submit', {
            formType: 'demo_request',
            formId: 'demo-request',
            company: 'Demo Company Inc',
            useCase: 'Real-time edge personalization',
            urgency: 'high'
        });
    }

    triggerCustomEvent() {
        const eventType = document.getElementById('eventType').value;
        const eventDataInput = document.getElementById('eventData').value;
        
        try {
            const eventData = JSON.parse(eventDataInput);
            this.triggerActionEvent(eventType, eventData);
        } catch (error) {
            this.showNotification('Invalid JSON in event data', 'error');
            this.logEvent(`Invalid JSON: ${error.message}`, 'error');
        }
    }
    
    updateEventDataExample() {
        const eventType = document.getElementById('eventType').value;
        const eventDataField = document.getElementById('eventData');
        
        // Provide example JSON for each event type
        const examples = {
            'email_open': '{"campaignId": "welcome-001", "subject": "Welcome!"}',
            'form_submit': '{"formType": "demo_request", "company": "Acme Corp"}',
            'page_view': '{"path": "/pricing", "duration": 30000}',
            'button_click': '{"buttonId": "cta-main", "label": "Get Started"}',
            'custom': '{"action": "video_play", "videoId": "demo-123"}'
        };
        
        eventDataField.value = examples[eventType] || '{"test": true}';
    }

    // UI Updates
    updateConnectionStatus(connected) {
        const statusIndicator = document.getElementById('connectionStatus');
        const wsStatus = document.getElementById('wsStatus');
        
        if (connected) {
            statusIndicator.classList.remove('disconnected');
            wsStatus.textContent = 'Connected';
        } else {
            statusIndicator.classList.add('disconnected');
            wsStatus.textContent = 'Disconnected';
        }
    }

    updateSessionInfo() {
        document.getElementById('sessionId').textContent = this.sessionId || 'None';
        document.getElementById('userId').textContent = this.userId;
    }

    updateSegmentsDisplay(oldSegments) {
        const segmentsDisplay = document.getElementById('segmentsDisplay');
        segmentsDisplay.innerHTML = '';
        
        this.currentSegments.forEach(segment => {
            const segmentTag = document.createElement('span');
            segmentTag.className = 'segment-tag';
            segmentTag.textContent = segment;
            
            // Highlight new segments
            if (!oldSegments.includes(segment)) {
                segmentTag.classList.add('new');
                setTimeout(() => segmentTag.classList.remove('new'), 2000);
            }
            
            segmentsDisplay.appendChild(segmentTag);
        });
        
        document.getElementById('segmentCount').textContent = this.currentSegments.length;
    }

    updateMetrics() {
        const sessionDuration = Math.floor((Date.now() - this.sessionStartTime) / 1000);
        document.getElementById('sessionDuration').textContent = this.formatDuration(sessionDuration);
        document.getElementById('eventCount').textContent = this.eventCount;
        document.getElementById('updateCount').textContent = this.updateCount;
    }

    formatDuration(seconds) {
        if (seconds < 60) return `${seconds}s`;
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}m ${remainingSeconds}s`;
    }

    flashPersonalizationDisplay() {
        const display = document.getElementById('personalizationDisplay');
        display.classList.add('updated');
        setTimeout(() => display.classList.remove('updated'), 1000);
    }

    startSessionTimer() {
        setInterval(() => {
            this.updateMetrics();
        }, 1000);
    }

    // Logging and Notifications
    logEvent(message, type = 'info') {
        const logContainer = document.getElementById('eventLog');
        const logEntry = document.createElement('div');
        logEntry.className = 'log-entry';
        
        const timestamp = new Date().toLocaleTimeString();
        const logClass = type === 'error' ? 'log-error' : 
                        type === 'event' ? 'log-event' : 'log-info';
        
        logEntry.innerHTML = `
            <span class="log-timestamp">[${timestamp}]</span>
            <span class="${logClass}">${message}</span>
        `;
        
        logContainer.appendChild(logEntry);
        logContainer.scrollTop = logContainer.scrollHeight;
        
        // Keep only last 50 entries
        while (logContainer.children.length > 50) {
            logContainer.removeChild(logContainer.firstChild);
        }
    }

    showNotification(message, type = 'success') {
        const notification = document.getElementById('notification');
        notification.textContent = message;
        notification.className = `notification ${type}`;
        notification.classList.add('show');
        
        setTimeout(() => {
            notification.classList.remove('show');
        }, 3000);
    }

    // Send heartbeat to keep connection alive
    sendHeartbeat() {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.send(JSON.stringify({
                type: 'heartbeat',
                timestamp: Date.now()
            }));
        }
    }
}

// Global instance and functions
let demo;

// Global functions called by HTML buttons
function connectWebSocket() {
    demo.connectWebSocket();
}

function disconnectWebSocket() {
    demo.disconnectWebSocket();
}

function triggerEmailOpen() {
    if (window.demo) demo.triggerEmailOpen();
    else console.error('Demo not initialized yet');
}

function triggerFormSubmit() {
    if (window.demo) demo.triggerFormSubmit();
    else console.error('Demo not initialized yet');
}

function triggerPricingView() {
    if (window.demo) demo.triggerPricingView();
    else console.error('Demo not initialized yet');
}

function triggerDemoRequest() {
    if (window.demo) demo.triggerDemoRequest();
    else console.error('Demo not initialized yet');
}

function triggerCustomEvent() {
    if (window.demo) demo.triggerCustomEvent();
    else console.error('Demo not initialized yet');
}

// Initialize demo when page loads
document.addEventListener('DOMContentLoaded', function() {
    demo = new PersonalizationDemo();
    window.demo = demo;
    
    // Send heartbeat every 30 seconds
    setInterval(() => {
        demo.sendHeartbeat();
    }, 30000);
    
    // Auto-connect WebSocket after 2 seconds
    setTimeout(() => {
        demo.connectWebSocket();
    }, 2000);
});

// Handle page visibility changes to manage connections
document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible' && demo) {
        // Reconnect if needed when page becomes visible
        if (!demo.websocket || demo.websocket.readyState !== WebSocket.OPEN) {
            setTimeout(() => demo.connectWebSocket(), 1000);
        }
    }
});

// Handle beforeunload to cleanup connections
window.addEventListener('beforeunload', function() {
    if (demo && demo.websocket) {
        demo.disconnectWebSocket();
    }
});