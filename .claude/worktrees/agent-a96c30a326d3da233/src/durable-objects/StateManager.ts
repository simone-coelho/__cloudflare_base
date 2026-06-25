export class StateManager {
  private state: DurableObjectState;
  private storage: DurableObjectStorage;
  private sessions: Map<string, any> = new Map();

  constructor(state: DurableObjectState) {
    this.state = state;
    this.storage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      switch (path) {
        case '/get':
          return this.handleGet(request);
        case '/set':
          return this.handleSet(request);
        case '/delete':
          return this.handleDelete(request);
        case '/list':
          return this.handleList(request);
        case '/session/get':
          return this.handleSessionGet(request);
        case '/session/set':
          return this.handleSessionSet(request);
        case '/session/delete':
          return this.handleSessionDelete(request);
        default:
          return new Response('Not Found', { status: 404 });
      }
    } catch (error) {
      console.error('StateManager error:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }

  private async handleGet(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const key = url.searchParams.get('key');
    
    if (!key) {
      return new Response('Missing key parameter', { status: 400 });
    }

    const value = await this.storage.get(key);
    
    if (value === undefined) {
      return new Response('Not Found', { status: 404 });
    }

    return new Response(JSON.stringify({ key, value }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async handleSet(request: Request): Promise<Response> {
    const body = await request.json() as { key: string; value: any; ttl?: number };
    
    if (!body.key) {
      return new Response('Missing key', { status: 400 });
    }

    const options: DurableObjectPutOptions = {};
    
    if (body.ttl) {
      const now = Date.now();
      options.allowConcurrency = true;
    }

    await this.storage.put(body.key, body.value, options);

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async handleDelete(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const key = url.searchParams.get('key');
    
    if (!key) {
      return new Response('Missing key parameter', { status: 400 });
    }

    const deleted = await this.storage.delete(key);

    return new Response(JSON.stringify({ deleted }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async handleList(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const prefix = url.searchParams.get('prefix') || '';
    const limit = parseInt(url.searchParams.get('limit') || '100');

    const entries = await this.storage.list({ prefix, limit });
    const result = Object.fromEntries(entries);

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async handleSessionGet(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('sessionId');
    
    if (!sessionId) {
      return new Response('Missing sessionId parameter', { status: 400 });
    }

    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return new Response('Session not found', { status: 404 });
    }

    return new Response(JSON.stringify(session), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async handleSessionSet(request: Request): Promise<Response> {
    const body = await request.json() as { sessionId: string; data: any };
    
    if (!body.sessionId) {
      return new Response('Missing sessionId', { status: 400 });
    }

    this.sessions.set(body.sessionId, {
      ...body.data,
      lastAccessed: Date.now(),
    });

    setTimeout(() => {
      this.sessions.delete(body.sessionId);
    }, 30 * 60 * 1000);

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async handleSessionDelete(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('sessionId');
    
    if (!sessionId) {
      return new Response('Missing sessionId parameter', { status: 400 });
    }

    const deleted = this.sessions.delete(sessionId);

    return new Response(JSON.stringify({ deleted }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}