import type { UserContext, PageContext } from '@/types/events';

export function getUserContext(request: any): Partial<UserContext> {
  return {
    anonymousId: crypto.randomUUID(),
  };
}

export function getPageContext(request: any): PageContext {
  const url = new URL(request.url);
  const userAgent = request.headers?.get('User-Agent') || request.header?.('User-Agent') || 'unknown';
  const ip = request.headers?.get('CF-Connecting-IP') || 
            request.header?.('CF-Connecting-IP') ||
            request.headers?.get('X-Forwarded-For') || 
            request.header?.('X-Forwarded-For') ||
            'unknown';
  
  return {
    url: url.toString(),
    path: url.pathname,
    referrer: request.headers?.get('Referer') || request.header?.('Referer') || undefined,
    search: url.search || undefined,
    userAgent,
    ip,
  };
}

export function getGeoLocation(request: Request): Record<string, string> {
  return {
    country: request.headers.get('CF-IPCountry') || '',
    region: request.headers.get('CF-Region') || '',
    city: request.headers.get('CF-IPCity') || '',
    timezone: request.headers.get('CF-Timezone') || '',
    continent: request.headers.get('CF-IPContinent') || '',
  };
}

export function getDeviceInfo(userAgent: string): Record<string, string> {
  const info: Record<string, string> = {
    userAgent,
    type: 'unknown',
    browser: 'unknown',
    os: 'unknown',
    mobile: 'false',
  };

  if (/Mobile|Android|iPhone|iPad/.test(userAgent)) {
    info.mobile = 'true';
    info.type = 'mobile';
  } else if (/Tablet|iPad/.test(userAgent)) {
    info.type = 'tablet';
  } else {
    info.type = 'desktop';
  }

  if (/Chrome/.test(userAgent)) {
    info.browser = 'chrome';
  } else if (/Firefox/.test(userAgent)) {
    info.browser = 'firefox';
  } else if (/Safari/.test(userAgent) && !/Chrome/.test(userAgent)) {
    info.browser = 'safari';
  } else if (/Edge/.test(userAgent)) {
    info.browser = 'edge';
  }

  if (/Windows/.test(userAgent)) {
    info.os = 'windows';
  } else if (/Mac/.test(userAgent)) {
    info.os = 'macos';
  } else if (/Linux/.test(userAgent)) {
    info.os = 'linux';
  } else if (/Android/.test(userAgent)) {
    info.os = 'android';
  } else if (/iPhone|iPad/.test(userAgent)) {
    info.os = 'ios';
  }

  return info;
}

export function enrichEventContext(
  request: Request,
  baseEvent: any
): any {
  const userContext = getUserContext(request);
  const pageContext = getPageContext(request);
  const geoLocation = getGeoLocation(request);
  const deviceInfo = getDeviceInfo(pageContext.userAgent);

  return {
    ...baseEvent,
    user: {
      ...userContext,
      ...baseEvent.user,
    },
    page: {
      ...pageContext,
      ...baseEvent.page,
    },
    context: {
      geo: geoLocation,
      device: deviceInfo,
      timestamp: Date.now(),
      requestId: crypto.randomUUID(),
    },
  };
}

export function extractIPAddress(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ||
         request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
         request.headers.get('X-Real-IP') ||
         'unknown';
}

export function isBot(userAgent: string): boolean {
  const botPatterns = [
    /bot/i,
    /crawler/i,
    /spider/i,
    /crawling/i,
    /googlebot/i,
    /bingbot/i,
    /slurp/i,
    /duckduckbot/i,
    /baiduspider/i,
    /yandexbot/i,
    /facebookexternalhit/i,
    /twitterbot/i,
    /rogerbot/i,
    /linkedinbot/i,
    /embedly/i,
    /quora link preview/i,
    /showyoubot/i,
    /outbrain/i,
    /pinterest/i,
    /developers\.google\.com\/\+\/web\/snippet\//i,
  ];

  return botPatterns.some(pattern => pattern.test(userAgent));
}

export function generateSessionId(request: Request): string {
  const ip = extractIPAddress(request);
  const userAgent = request.headers.get('User-Agent') || '';
  const timestamp = Math.floor(Date.now() / (30 * 60 * 1000));
  
  const sessionData = `${ip}-${userAgent}-${timestamp}`;
  
  let hash = 0;
  for (let i = 0; i < sessionData.length; i++) {
    const char = sessionData.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  
  return Math.abs(hash).toString(36);
}

export function parseUserAgent(userAgent: string): {
  browser: { name: string; version: string };
  os: { name: string; version: string };
  device: { type: string; vendor: string; model: string };
} {
  return {
    browser: {
      name: 'unknown',
      version: 'unknown',
    },
    os: {
      name: 'unknown',
      version: 'unknown',
    },
    device: {
      type: 'unknown',
      vendor: 'unknown',
      model: 'unknown',
    },
  };
}