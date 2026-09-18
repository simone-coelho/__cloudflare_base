import type { Decision } from '@/connectors';
import type { Env } from '@/types/env';
import { SyntheticObjectBoundary } from '@/ops/synthetic';
import { assertSessionTarget, capabilityToken, verifySessionCapability, shopperTenant, SHOPPER_PROTOCOL, SessionAccessError, type SessionCapability } from '@/identity/sessionCapability';
import { shopperObject, shopperObjectName } from '@/tenancy/objects';
import { signSessionCapability, SHOPPER_HEADER } from '@/identity/sessionCapability';
import { assertShopperSelectors } from '@/identity/sessionAuthority';

export interface PersonalizationUpdate {
  type: 'segment_update' | 'personalization_update' | 'feature_flag_update' | 'audience_published' | 'odp_receipt';
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
    /** Edge Affinity Reflex (doc 16): live per-dimension scores + memberships
        + the explain records for this event — feeds the Affinity Instrument. */
    affinity?: {
      dims: Record<string, Record<string, number>>;
      audiences: string[];
      changed?: unknown[];
      /** Audiences ODP's real-time segments ALSO confirm (the memory agreeing with the reflex). */
      odpConfirmed?: string[];
    };
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
  private principals = new Map<string, SessionCapability>();

  private synthetic?: SyntheticObjectBoundary;
  constructor(state: DurableObjectState, private env?: Env) {
    if (env) this.synthetic = new SyntheticObjectBoundary(state, env, 'PERSONALIZATION_WEBSOCKET', () => {
      this.userConnections.clear(); this.connections.clear(); this.principals.clear();
    });
    this.state = this.synthetic?.state ?? state;
    this.env = this.synthetic?.env ?? env;
    this.state.blockConcurrencyWhile(async () => {
      // Load persisted connections state if needed
      const load = async () => { const stored = await this.state.storage.get('connections');
        if (stored) this.userConnections = new Map(stored as Array<[string, Set<string>]>); };
      if (this.synthetic) await this.synthetic.initialize(load); else await load();
    });
  }

  async fetch(request: Request): Promise<Response> {
    return this.synthetic ? this.synthetic.run(request, () => this.fetchScoped(request)).catch(() => new Response('Shopper session unavailable', { status: 401 })) : this.fetchScoped(request);
  }

  async alarm(): Promise<void> { await this.synthetic?.run(undefined, async () => undefined); }

  private async fetchScoped(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/owner/') && url.pathname !== '/owner/upgrade') {
      try {
        if (!this.env || request.method !== 'POST') throw new SessionAccessError();
        const body = await request.json() as { tenant: string; subject: string; grants: string[]; payload?: any; consentExpiresAt?: number };
        if (this.state.id.toString() !== this.env.PERSONALIZATION_WEBSOCKET.idFromName(shopperObjectName(body.tenant, body.subject)).toString()
          || !Array.isArray(body.grants) || body.grants.some(id => typeof id !== 'string')) throw new SessionAccessError();
        for (const [id, p] of this.principals) {
          if (p.tenant !== body.tenant || p.subject !== body.subject || !p.grantId || !body.grants.includes(p.grantId)) {
            try { this.connections.get(id)?.close(1008, 'Shopper session unavailable'); } catch { /* already closed */ }
            await this.handleWebSocketClose(id, p.subject);
          }
        }
        if (url.pathname === '/owner/broadcast') {
          if (body.payload?.userId !== body.subject) throw new SessionAccessError();
          if (!Number.isSafeInteger(body.consentExpiresAt) || body.consentExpiresAt! <= Date.now()) throw new SessionAccessError();
          await this.broadcastUpdate(body.payload, body.consentExpiresAt);
        } else if (url.pathname === '/owner/frame') {
          const id = body.payload?.connectionId;
          if (typeof id !== 'string' || !this.principals.has(id)) throw new SessionAccessError();
          if (body.payload?.type === 'heartbeat') this.sendToConnection(id, { type: 'heartbeat_response', timestamp: Date.now() });
        } else if (url.pathname === '/owner/connections') {
          return this.handleConnectionsInfo(new Request('https://relay/connections?userId=' + encodeURIComponent(body.subject)));
        } else if (url.pathname !== '/owner/revoke') throw new SessionAccessError();
        return Response.json({ ok: true });
      } catch { return new Response('Shopper session unavailable', { status: 401 }); }
    }
    
    // Handle WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      try { assertShopperSelectors(request); } catch { return new Response('Shopper session unavailable', { status: 401 }); }
      if (url.pathname === '/owner/upgrade') return this.handleWebSocketUpgrade(request);
      try {
        if (!this.env) throw new SessionAccessError();
        const p = await verifySessionCapability(this.env, capabilityToken(request), shopperTenant(this.env, request));
        const target = new URL(request.url); target.pathname = '/authority/relay-upgrade';
        return shopperObject(this.env.SHOPPER_REFLEX, p.subject, p.tenant).fetch(new Request(target, request));
      } catch { return new Response('Shopper session unavailable', { status: 401 }); }
    }
    
    // Handle HTTP API calls
    switch (url.pathname) {
      case '/broadcast':
        return new Response('Owner publication required', { status: 401 });
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
    let principal: SessionCapability;
    try {
      if (!this.env) throw new SessionAccessError();
      principal = await verifySessionCapability(this.env, capabilityToken(request), shopperTenant(this.env, request));
      assertShopperSelectors(request);
      for (const name of ['userId', 'visitorId', 'sessionId', 'tenant']) if (url.searchParams.getAll(name).length > 1) throw new SessionAccessError();
      assertSessionTarget(principal, url.searchParams.get('userId'), url.searchParams.get('sessionId'));
      assertSessionTarget(principal, url.searchParams.get('visitorId'));
      if (this.state.id.toString() !== this.env.PERSONALIZATION_WEBSOCKET.idFromName(shopperObjectName(principal.tenant, principal.subject)).toString()) throw new SessionAccessError();
    } catch { return new Response('Shopper session unavailable', { status: 401 }); }

    const userId = principal.subject;

    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    server.accept();
    
    const connectionId = crypto.randomUUID();
    this.connections.set(connectionId, server);
    this.principals.set(connectionId, principal);
    
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
      console.error('WebSocket error');
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
      headers: { 'Sec-WebSocket-Protocol': SHOPPER_PROTOCOL },
    });
  }

  private async handleWebSocketMessage(connectionId: string, userId: string, event: MessageEvent) {
    try {
      const message: WebSocketMessage = JSON.parse(event.data as string);
      if (!this.live(connectionId, message.userId)) return;
      const principal = this.principals.get(connectionId);
      if (!this.env || !principal || !['heartbeat', 'subscribe', 'unsubscribe'].includes(message.type)) throw new SessionAccessError();
      const signed = await signSessionCapability(this.env, principal);
      const response = await shopperObject(this.env.SHOPPER_REFLEX, principal.subject, principal.tenant).fetch('https://shopper-reflex/authority/relay-frame', {
        method: 'POST', headers: { 'Content-Type': 'application/json', [SHOPPER_HEADER]: signed.capability, 'X-Tenant': principal.tenant },
        body: JSON.stringify({ connectionId, type: message.type }),
      });
      if (!response.ok) {
        try { this.connections.get(connectionId)?.close(1008, 'Shopper session unavailable'); } catch { /* already closed */ }
        await this.handleWebSocketClose(connectionId, userId);
      }
      return;
    } catch (error) {
      console.error('Error handling WebSocket message');
    }
  }

  private async handleWebSocketClose(connectionId: string, userId: string) {
    this.connections.delete(connectionId);
    this.principals.delete(connectionId);
    
    const userConnections = this.userConnections.get(userId);
    if (userConnections) {
      userConnections.delete(connectionId);
      if (userConnections.size === 0) {
        this.userConnections.delete(userId);
      }
    }

    await this.saveConnectionState();
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

  async broadcastUpdate(update: PersonalizationUpdate, consentExpiresAt = 0): Promise<void> {
    const userConnections = this.getUserConnections(update.userId);
    
    const message = JSON.stringify({
      ...update,
      serverTimestamp: Date.now()
    });

    const broadcastPromises = userConnections.map(async (connectionId) => {
      try {
        const connection = this.connections.get(connectionId);
        if (Date.now() >= consentExpiresAt) throw new SessionAccessError();
        if (connection && this.live(connectionId, update.userId) && connection.readyState === WebSocket.READY_STATE_OPEN) {
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
        console.error('Error sending to connection');
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
        if (this.live(connectionId) && connection.readyState === WebSocket.READY_STATE_OPEN) {
          connection.send(message);
        }
      } catch (error) {
        console.error('Error broadcasting to connection');
      }
    });

    await Promise.all(broadcastPromises);
  }

  private getUserConnections(userId: string): string[] {
    const userConnections = this.userConnections.get(userId);
    return userConnections ? Array.from(userConnections) : [];
  }

  private sendToConnection(connectionId: string, data: any): void {
    if (!this.live(connectionId, data?.userId)) return;
    const connection = this.connections.get(connectionId);
    if (connection && connection.readyState === WebSocket.READY_STATE_OPEN) {
      connection.send(JSON.stringify(data));
    }
  }

  private live(connectionId: string, subject?: unknown): boolean {
    try {
      const principal = this.principals.get(connectionId);
      if (!principal) throw new SessionAccessError();
      assertSessionTarget(principal, subject);
      return true;
    } catch {
      try { this.connections.get(connectionId)?.close(1008, 'Shopper session unavailable'); } catch { /* already closed */ }
      return false;
    }
  }

  private async saveConnectionState(): Promise<void> {
    try {
      await this.state.storage.put('connections', Array.from(this.userConnections.entries()));
    } catch (error) {
      console.error('Error saving connection state');
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
