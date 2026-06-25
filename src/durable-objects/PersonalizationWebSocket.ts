import type { Decision } from '@/connectors';

export interface PersonalizationUpdate {
  type: 'segment_update' | 'personalization_update' | 'feature_flag_update' | 'audience_published';
  userId: string;
  data: {
    segments?: string[];
    featureVariables?: Record<string, any>;
    cookies?: Record<string, string>;
    timestamp: number;
    source: string;
    decisions?: Record<string, Decision>;
    recommendations?: any[];
    sortOrder?: string[];
    journeyStage?: 'early' | 'mid' | 'late';
    audienceWentLive?: { key: string; name: string };
  };
}

export interface WebSocketMessage {
  type: 'subscribe' | 'unsubscribe' | 'heartbeat' | 'update';
  userId?: string;
  data?: any;
}

export class PersonalizationWebSocket {
  private state: DurableObjectState;
  private connections: Map<string, WebSocket> = new Map();
  private userConnections: Map<string, Set<string>> = new Map();

  constructor(state: DurableObjectState) {
    this.state = state;
    this.state.blockConcurrencyWhile(async () => {
      // Load persisted connections state if needed
      const stored = await this.state.storage.get('connections');
      if (stored) {
        // Restore connection mappings (connections themselves can't be persisted)
        this.userConnections = new Map(stored as any);
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    // Handle WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade(request);
    }
    
    // Handle HTTP API calls
    switch (url.pathname) {
      case '/broadcast':
        return this.handleBroadcast(request);
      case '/connections':
        return this.handleConnectionsInfo(request);
      case '/health':
        return new Response(JSON.stringify({ 
          status: 'healthy',
          connections: this.connections.size,
          users: this.userConnections.size 
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      default:
        return new Response('Not Found', { status: 404 });
    }
  }

  private async handleWebSocketUpgrade(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');
    
    if (!userId) {
      return new Response('Missing userId parameter', { status: 400 });
    }

    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    server.accept();
    
    const connectionId = crypto.randomUUID();
    this.connections.set(connectionId, server);
    
    // Track user connections
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, new Set());
    }
    this.userConnections.get(userId)!.add(connectionId);

    // Set up event handlers
    server.addEventListener('message', (event) => {
      this.handleWebSocketMessage(connectionId, userId, event);
    });

    server.addEventListener('close', () => {
      this.handleWebSocketClose(connectionId, userId);
    });

    server.addEventListener('error', (error) => {
      console.error('WebSocket error:', error);
      this.handleWebSocketClose(connectionId, userId);
    });

    // Send welcome message
    server.send(JSON.stringify({
      type: 'connected',
      connectionId,
      userId,
      timestamp: Date.now()
    }));

    // Persist connection state
    await this.saveConnectionState();

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  private async handleWebSocketMessage(connectionId: string, userId: string, event: MessageEvent) {
    try {
      const message: WebSocketMessage = JSON.parse(event.data as string);
      
      switch (message.type) {
        case 'heartbeat':
          this.sendToConnection(connectionId, {
            type: 'heartbeat_response',
            timestamp: Date.now()
          });
          break;
          
        case 'subscribe':
          // User can subscribe to specific event types
          console.log(`User ${userId} subscribed to updates`);
          break;
          
        case 'unsubscribe':
          console.log(`User ${userId} unsubscribed from updates`);
          break;
          
        default:
          console.warn('Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('Error handling WebSocket message:', error);
    }
  }

  private async handleWebSocketClose(connectionId: string, userId: string) {
    this.connections.delete(connectionId);
    
    const userConnections = this.userConnections.get(userId);
    if (userConnections) {
      userConnections.delete(connectionId);
      if (userConnections.size === 0) {
        this.userConnections.delete(userId);
      }
    }

    await this.saveConnectionState();
    console.log(`WebSocket connection closed: ${connectionId} for user ${userId}`);
  }

  private async handleBroadcast(request: Request): Promise<Response> {
    try {
      const update: PersonalizationUpdate = await request.json();
      await this.broadcastUpdate(update);
      
      return new Response(JSON.stringify({ 
        success: true, 
        broadcast: true,
        connections: this.getUserConnections(update.userId).length
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ 
        error: 'Failed to broadcast update',
        details: error instanceof Error ? error.message : 'Unknown error'
      }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  private async handleConnectionsInfo(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');
    
    if (userId) {
      return new Response(JSON.stringify({
        userId,
        connections: this.getUserConnections(userId).length,
        connected: this.getUserConnections(userId).length > 0
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response(JSON.stringify({
      totalConnections: this.connections.size,
      totalUsers: this.userConnections.size,
      users: Array.from(this.userConnections.keys())
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async broadcastUpdate(update: PersonalizationUpdate): Promise<void> {
    const userConnections = this.getUserConnections(update.userId);
    
    const message = JSON.stringify({
      ...update,
      serverTimestamp: Date.now()
    });

    const broadcastPromises = userConnections.map(async (connectionId) => {
      try {
        const connection = this.connections.get(connectionId);
        if (connection && connection.readyState === WebSocket.READY_STATE_OPEN) {
          connection.send(message);
        } else {
          // Clean up dead connections
          this.connections.delete(connectionId);
          const userConnections = this.userConnections.get(update.userId);
          if (userConnections) {
            userConnections.delete(connectionId);
          }
        }
      } catch (error) {
        console.error(`Error sending to connection ${connectionId}:`, error);
      }
    });

    await Promise.all(broadcastPromises);
    
    // Save state after cleanup
    if (userConnections.length > 0) {
      await this.saveConnectionState();
    }
  }

  async broadcastToAll(update: Omit<PersonalizationUpdate, 'userId'>): Promise<void> {
    const message = JSON.stringify({
      ...update,
      scope: 'global',
      serverTimestamp: Date.now()
    });

    const broadcastPromises = Array.from(this.connections.entries()).map(async ([connectionId, connection]) => {
      try {
        if (connection.readyState === WebSocket.READY_STATE_OPEN) {
          connection.send(message);
        }
      } catch (error) {
        console.error(`Error broadcasting to connection ${connectionId}:`, error);
      }
    });

    await Promise.all(broadcastPromises);
  }

  private getUserConnections(userId: string): string[] {
    const userConnections = this.userConnections.get(userId);
    return userConnections ? Array.from(userConnections) : [];
  }

  private sendToConnection(connectionId: string, data: any): void {
    const connection = this.connections.get(connectionId);
    if (connection && connection.readyState === WebSocket.READY_STATE_OPEN) {
      connection.send(JSON.stringify(data));
    }
  }

  private async saveConnectionState(): Promise<void> {
    try {
      await this.state.storage.put('connections', Array.from(this.userConnections.entries()));
    } catch (error) {
      console.error('Error saving connection state:', error);
    }
  }

  // Cleanup method for old connections
  async cleanup(): Promise<void> {
    const deadConnections: string[] = [];
    
    for (const [connectionId, connection] of this.connections.entries()) {
      if (connection.readyState !== WebSocket.READY_STATE_OPEN) {
        deadConnections.push(connectionId);
      }
    }

    for (const connectionId of deadConnections) {
      this.connections.delete(connectionId);
      
      // Remove from user connections
      for (const [userId, userConnections] of this.userConnections.entries()) {
        userConnections.delete(connectionId);
        if (userConnections.size === 0) {
          this.userConnections.delete(userId);
        }
      }
    }

    if (deadConnections.length > 0) {
      await this.saveConnectionState();
      console.log(`Cleaned up ${deadConnections.length} dead connections`);
    }
  }
}