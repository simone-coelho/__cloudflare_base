export class RateLimiter {
  private state: DurableObjectState;
  private storage: DurableObjectStorage;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.storage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const body = await request.json() as { limit: number; window: number };
      const { limit, window } = body;
      
      const now = Date.now();
      const windowStart = Math.floor(now / (window * 1000)) * window * 1000;
      const key = `window:${windowStart}`;
      
      const current = await this.storage.get<number>(key) || 0;
      
      if (current >= limit) {
        return new Response(JSON.stringify({ 
          allowed: false, 
          remaining: 0,
          resetTime: windowStart + (window * 1000)
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      
      const newCount = current + 1;
      await this.storage.put(key, newCount, {
        allowConcurrency: true,
      });
      
      this.cleanupOldWindows(windowStart - (window * 1000));
      
      return new Response(JSON.stringify({ 
        allowed: true, 
        remaining: limit - newCount,
        resetTime: windowStart + (window * 1000)
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('RateLimiter error:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }

  private async cleanupOldWindows(cutoff: number): Promise<void> {
    try {
      const entries = await this.storage.list({ prefix: 'window:' });
      const deletePromises: Promise<boolean>[] = [];
      
      for (const [key] of entries) {
        const timestamp = parseInt(key.split(':')[1]);
        if (timestamp < cutoff) {
          deletePromises.push(this.storage.delete(key));
        }
      }
      
      if (deletePromises.length > 0) {
        await Promise.all(deletePromises);
      }
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  }
}