// src/tenancy/middleware.test.ts
//
// This runs before every request, including the health check, so the property
// that matters most is that it cannot throw. A stamp with a typo in its
// configuration must look under-provisioned, never dead.

import { describe, it, expect } from 'vitest';
import type { Env } from '@/types/env';
import { DEFAULT_TENANT } from '@/tenancy/tenant';
import { tenantConfig, tenantForRequest } from '@/tenancy/middleware';

const envWith = (TENANTS?: string) => ({ TENANTS }) as unknown as Env;
const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });

describe('reading the stamp configuration', () => {
  it('is default-only when nothing is configured', () => {
    expect(tenantConfig(envWith())).toEqual({ provisioned: [DEFAULT_TENANT], hosts: {} });
    expect(tenantConfig(envWith('   '))).toEqual({ provisioned: [DEFAULT_TENANT], hosts: {} });
  });

  it('reads provisioned brands and host mappings', () => {
    const cfg = tenantConfig(envWith(JSON.stringify({
      provisioned: ['coach', 'kate-spade'],
      hosts: { 'Shop.KateSpade.com': 'kate-spade' },
    })));
    expect(cfg.provisioned).toEqual(['coach', 'kate-spade']);
    expect(cfg.hosts).toEqual({ 'shop.katespade.com': 'kate-spade' });
  });

  it('always includes the default, even when the config forgets it', () => {
    expect(tenantConfig(envWith(JSON.stringify({ provisioned: ['kate-spade'] }))).provisioned)
      .toContain(DEFAULT_TENANT);
  });

  it('degrades to default-only rather than throwing on rubbish', () => {
    for (const bad of ['not json', '[]', 'null', '"a string"', '42']) {
      expect(tenantConfig(envWith(bad)).provisioned).toEqual([DEFAULT_TENANT]);
    }
  });

  it('drops individually bad entries instead of failing the whole config', () => {
    // One malformed host line must not deprovision a brand.
    const cfg = tenantConfig(envWith(JSON.stringify({
      provisioned: ['kate-spade', 'NOT VALID', 42, ''],
      hosts: { 'good.com': 'kate-spade', 'bad.com': 'NOT VALID', '': 'kate-spade' },
    })));
    expect(cfg.provisioned).toEqual(['kate-spade', DEFAULT_TENANT]);
    expect(cfg.hosts).toEqual({ 'good.com': 'kate-spade' });
  });
});

describe('resolving a request', () => {
  const CONFIGURED = JSON.stringify({
    provisioned: ['coach', 'kate-spade'],
    hosts: { 'shop.katespade.com': 'kate-spade' },
  });

  it('maps a provisioned host to its brand', () => {
    expect(tenantForRequest(envWith(CONFIGURED), req('https://shop.katespade.com/x'))).toBe('kate-spade');
  });

  it('serves the default from an unmapped host', () => {
    expect(tenantForRequest(envWith(CONFIGURED), req('https://www.coach.com/x'))).toBe(DEFAULT_TENANT);
  });

  it('honours X-Tenant only for a provisioned brand', () => {
    expect(tenantForRequest(envWith(CONFIGURED), req('https://x.com/', { 'X-Tenant': 'kate-spade' }))).toBe('kate-spade');
    // Not provisioned on this stamp: the header is ignored, not obeyed.
    expect(tenantForRequest(envWith(CONFIGURED), req('https://x.com/', { 'X-Tenant': 'stuart-weitzman' }))).toBe(DEFAULT_TENANT);
  });

  it('ignores X-Tenant entirely on an unconfigured stamp', () => {
    expect(tenantForRequest(envWith(), req('https://x.com/', { 'X-Tenant': 'kate-spade' }))).toBe(DEFAULT_TENANT);
  });

  it('lets the header override the host, which is how an operator tool reaches a brand', () => {
    expect(tenantForRequest(envWith(CONFIGURED), req('https://www.coach.com/', { 'X-Tenant': 'kate-spade' }))).toBe('kate-spade');
  });

  it('never throws, whatever it is handed', () => {
    // It runs before every request. The worst acceptable outcome is the default
    // brand; the unacceptable one is a dead worker.
    expect(tenantForRequest(envWith('{{{'), req('https://x.com/'))).toBe(DEFAULT_TENANT);
    expect(tenantForRequest({} as Env, req('https://x.com/'))).toBe(DEFAULT_TENANT);
    expect(tenantForRequest(envWith(CONFIGURED), req('https://x.com/', { 'X-Tenant': 't:kate-spade:evil' })))
      .toBe(DEFAULT_TENANT);
  });
});
