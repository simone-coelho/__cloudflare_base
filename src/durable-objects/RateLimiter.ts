import { LOGIN_BUDGET_OBJECT, LOGIN_BUDGET_PATH, LOGIN_GLOBAL_LIMIT, LOGIN_SOURCE_LIMIT, LOGIN_WINDOW_MS, type LoginBudget } from '@/auth/loginBudget';

type LoginWindow = { windowStart: number; count: number; sources: Record<string, number> };
const sourceKeyValid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function loginWindow(value: unknown): LoginWindow {
  const window = value as LoginWindow;
  if (!window || typeof window !== 'object' || Object.keys(window).length !== 3
    || !Number.isSafeInteger(window.windowStart) || window.windowStart < 0 || window.windowStart % LOGIN_WINDOW_MS !== 0
    || !Number.isSafeInteger(window.count) || window.count < 1 || window.count > LOGIN_GLOBAL_LIMIT
    || !window.sources || typeof window.sources !== 'object' || Array.isArray(window.sources)) throw new Error('Invalid login window');
  const entries = Object.entries(window.sources);
  if (entries.length > LOGIN_GLOBAL_LIMIT || entries.some(([key, count]) => !sourceKeyValid(key)
    || !Number.isSafeInteger(count) || count < 1 || count > LOGIN_SOURCE_LIMIT)
    || entries.reduce((sum, [, count]) => sum + count, 0) !== window.count) throw new Error('Invalid login counters');
  return window;
}

export class RateLimiter {
  private state: DurableObjectState;
  private storage: DurableObjectStorage;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.storage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    try {
      if (new URL(request.url).pathname === LOGIN_BUDGET_PATH) return await this.admitLogin(request);
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
      console.error('RateLimiter error');
      return new Response('Internal Server Error', { status: 500 });
    }
  }

  private async admitLogin(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1
      || !sourceKeyValid((body as { sourceKey?: unknown }).sourceKey)) return new Response('Invalid login budget request', { status: 400 });
    const sourceKey = (body as { sourceKey: string }).sourceKey;
    const result = await this.storage.transaction<LoginBudget>(async txn => {
      const now = Date.now(), windowStart = Math.floor(now / LOGIN_WINDOW_MS) * LOGIN_WINDOW_MS;
      const stored = await txn.get<unknown>(LOGIN_BUDGET_OBJECT);
      const previous = stored === undefined ? undefined : loginWindow(stored);
      if (previous && previous.windowStart > windowStart) throw new Error('Future login window');
      const current: LoginWindow = previous?.windowStart === windowStart ? previous : { windowStart, count: 0, sources: {} };
      const sourceCount = current.sources[sourceKey] ?? 0;
      const resetTime = windowStart + LOGIN_WINDOW_MS;
      if (current.count >= LOGIN_GLOBAL_LIMIT || sourceCount >= LOGIN_SOURCE_LIMIT) return { allowed: false, remaining: 0, resetTime };
      const next = { windowStart, count: current.count + 1, sources: { ...current.sources, [sourceKey]: sourceCount + 1 } };
      await txn.put(LOGIN_BUDGET_OBJECT, next);
      await txn.setAlarm(resetTime);
      return { allowed: true, remaining: Math.min(LOGIN_GLOBAL_LIMIT - next.count, LOGIN_SOURCE_LIMIT - sourceCount - 1), resetTime };
    });
    return Response.json(result);
  }

  /** A delayed expiry callback must not remove a newer window. */
  async alarm(): Promise<void> {
    await this.storage.transaction(async txn => {
      const stored = await txn.get<unknown>(LOGIN_BUDGET_OBJECT);
      if (stored === undefined) return;
      const resetTime = loginWindow(stored).windowStart + LOGIN_WINDOW_MS;
      if (resetTime <= Date.now()) {
        await txn.delete(LOGIN_BUDGET_OBJECT);
        await txn.deleteAlarm();
      } else await txn.setAlarm(resetTime);
    });
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
      console.error('Cleanup error');
    }
  }
}
