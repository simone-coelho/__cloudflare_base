import { describe, it, expect } from 'vitest';
import { entrySignals, mintAnonId, mintSessionId, mintVisitorId } from './identity';
import { memoryHost } from './memoryHost';

describe('identity', () => {
  it('mints a vis- id once and persists it to storage and cookie', () => {
    const host = memoryHost({ uuid: () => 'abc-123' });
    const id = mintVisitorId(host);
    expect(id).toBe('vis-abc-123');
    expect(host.storage.get('opt_visitor_id')).toBe(id);
    expect(host.cookie.get('opt_visitor_id')).toBe(id);
    expect(mintVisitorId(memoryHost({ uuid: () => 'zzz', storage: host.storage, cookie: host.cookie }))).toBe(id);
  });

  it('falls back to the cookie when storage is empty, and writes storage back', () => {
    const host = memoryHost({ uuid: () => 'new' });
    host.cookie.set('opt_visitor_id', 'vis-from-cookie', 1);
    expect(mintVisitorId(host)).toBe('vis-from-cookie');
    expect(host.storage.get('opt_visitor_id')).toBe('vis-from-cookie');
  });

  it('uses the demo storefront formats for the per-load ids', () => {
    const host = memoryHost({ uuid: () => '0f0f0f0f-1111-2222-3333-444444444444', now: () => 1_725_000_000_000 });
    expect(mintAnonId(host)).toMatch(/^v-[A-Z0-9]{9}$/);
    expect(mintSessionId(host)).toMatch(/^s-[A-Z0-9]+$/);
  });

  it('captures entry signals from the current document only', () => {
    const host = memoryHost({
      location: { href: 'https://s.example/?utm_source=tiktok&utm_medium=paid_social', host: 's.example', hostname: 's.example', protocol: 'https:', search: '?utm_source=tiktok&utm_medium=paid_social' },
      referrer: 'https://www.tiktok.com/',
    });
    expect(entrySignals(host)).toEqual({ utmMedium: 'paid_social', utmSource: 'tiktok', referrer: 'https://www.tiktok.com/', siteHost: 's.example' });
    expect(entrySignals(memoryHost())).toEqual({ utmMedium: '', utmSource: '', referrer: '', siteHost: '' });
  });
});
