import type { Env } from '@/types/env';
import { ownerFetch, currentOwnerConsent, requireConsentPurpose, currentOwnerIdentity, pinRetention, eventExternalRetention } from '@/identity/sessionAuthority';
import { destinationRetentionCategory } from '@/retention';
import { connectorDigest } from '@/connectors/config';
import type { Event } from '@/types/events';

export interface DispatchResult {
  success: boolean;
  destination: string;
  error?: string;
  responseTime?: number;
}

export interface Destination {
  name: string;
  type: 'webhook' | 'segment' | 'amplitude' | 'mixpanel' | 'custom';
  url: string;
  headers?: Record<string, string>;
  transform?: (event: Event) => any;
  enabled: boolean;
  retryConfig?: {
    maxRetries: number;
    backoffMs: number;
  };
}

export interface DeliveryReceipt {
  status: 'acknowledged' | 'partial' | 'unconfirmed' | 'unconfigured';
  attempted: number | null;
  acknowledged: number | null;
}

type DeliveryResponse = {
  httpStatus: 200;
  result: { success: true };
} | {
  httpStatus: 502 | 503;
  result: { success: false; error: string; delivery: DeliveryReceipt };
};

/** HTTP acknowledgement only: neither durable processing nor safe resubmission. */
export async function dispatchForResponse(dispatcher: EventDispatcher, event: Event): Promise<DeliveryResponse> {
  let delivery: DeliveryReceipt;
  try {
    const results = await dispatcher.dispatch(event);
    const attempted = results.length, acknowledged = results.filter(result => result.success).length;
    delivery = { status: attempted === 0 ? 'unconfigured' : acknowledged === attempted ? 'acknowledged'
      : acknowledged > 0 ? 'partial' : 'unconfirmed', attempted, acknowledged };
  } catch {
    console.error('Event delivery error');
    delivery = { status: 'unconfirmed', attempted: null, acknowledged: null };
  }
  return delivery.status === 'acknowledged' ? { httpStatus: 200, result: { success: true } }
    : { httpStatus: delivery.status === 'unconfigured' ? 503 : 502,
      result: { success: false, error: 'Event delivery not confirmed', delivery } };
}

function isDestination(value: unknown): value is Destination {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const destination = value as Record<string, unknown>;
  return typeof destination.name === 'string' && destination.name.trim().length > 0
    && typeof destination.url === 'string' && destination.url.trim().length > 0
    && typeof destination.enabled === 'boolean'
    && typeof destination.type === 'string' && ['webhook', 'segment', 'amplitude', 'mixpanel', 'custom'].includes(destination.type)
    && (destination.headers === undefined || (destination.headers !== null && typeof destination.headers === 'object'
      && !Array.isArray(destination.headers) && Object.values(destination.headers).every(value => typeof value === 'string')))
    && (destination.transform === undefined || typeof destination.transform === 'function');
}

export class EventDispatcher {
  private env: Env;
  private destinations: Destination[] = [];

  constructor(env: Env) {
    this.env = env;
    this.loadDestinations();
  }

  private loadDestinations(): void {
    try {
      const destinationsConfig = this.env.WEBHOOK_ENDPOINTS;
      if (destinationsConfig) {
        const parsed: unknown = JSON.parse(destinationsConfig);
        if (!Array.isArray(parsed) || !parsed.every(isDestination)) throw new Error('Invalid destinations');
        this.destinations = parsed;
      }
    } catch (error) {
      console.error('Failed to load destinations');
    }

    if (this.destinations.length === 0) {
      this.destinations = this.getDefaultDestinations();
    }
  }

  private getDefaultDestinations(): Destination[] {
    return [
      {
        name: 'segment',
        type: 'segment',
        url: 'https://api.segment.io/v1/track',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Basic ' + btoa('your-write-key:'),
        },
        transform: this.transformToSegment,
        enabled: false,
      },
      {
        name: 'amplitude',
        type: 'amplitude',
        url: 'https://api.amplitude.com/2/httpapi',
        headers: {
          'Content-Type': 'application/json',
        },
        transform: this.transformToAmplitude,
        enabled: false,
      },
      {
        name: 'mixpanel',
        type: 'mixpanel',
        url: 'https://api.mixpanel.com/track',
        headers: {
          'Content-Type': 'application/json',
        },
        transform: this.transformToMixpanel,
        enabled: false,
      },
    ];
  }

  async dispatch(event: Event): Promise<DispatchResult[]> {
    const identity = currentOwnerIdentity();
    const consent = await currentOwnerConsent();
    if (consent) requireConsentPurpose(consent, 'tracking');
    const results: DispatchResult[] = [];
    const enabledDestinations = this.destinations.filter(d => d.enabled);

    if (enabledDestinations.length === 0) {
      return results;
    }
    const source = await eventExternalRetention(event.eventId, await connectorDigest(event), event.timestamp);

    const dispatchPromises = enabledDestinations.map(async (destination) => {
      const startTime = Date.now();
      
      try {
        if (!identity) throw new Error('Tracking destination authority unavailable');
        const url = new URL(destination.url);
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Tracking destination unavailable');
        const category = await destinationRetentionCategory('tracking', { name: destination.name, type: destination.type, url: url.href });
        pinRetention(this.env, source[category], identity.tenant, category);
        const transformedEvent = destination.transform 
          ? destination.transform(event) 
          : event;

        const response = await ownerFetch(destination.url, {
          method: 'POST',
          redirect: 'error',
          headers: destination.headers || {},
          body: JSON.stringify(transformedEvent),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return {
          success: true,
          destination: destination.name,
          responseTime: Date.now() - startTime,
        };
      } catch (error) {
        console.error('Failed to dispatch event');
        
        return {
          success: false,
          destination: destination.name,
          error: error instanceof Error ? error.message : 'Unknown error',
          responseTime: Date.now() - startTime,
        };
      }
    });

    const dispatchResults = await Promise.allSettled(dispatchPromises);
    
    dispatchResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        results.push({
          success: false,
          destination: enabledDestinations[index].name,
          error: result.reason instanceof Error ? result.reason.message : 'Unknown error',
        });
      }
    });

    return results;
  }

  private transformToSegment(event: Event): any {
    const eventUser = event.user || { anonymousId: 'unknown' };
    const eventPage = 'page' in event ? event.page : undefined;
    
    return {
      userId: eventUser.userId,
      anonymousId: eventUser.anonymousId,
      event: event.eventType === 'track' ? (event as any).event : event.eventType,
      properties: (event as any).properties || {},
      context: {
        page: eventPage,
        userAgent: eventPage?.userAgent,
        ip: eventPage?.ip,
      },
      timestamp: new Date(event.timestamp).toISOString(),
    };
  }

  private transformToAmplitude(event: Event): any {
    const eventUser = event.user || { anonymousId: 'unknown' };
    
    return {
      api_key: 'your-api-key',
      events: [{
        user_id: eventUser.userId,
        device_id: eventUser.anonymousId,
        event_type: event.eventType === 'track' ? (event as any).event : event.eventType,
        event_properties: (event as any).properties || {},
        user_properties: eventUser.traits || {},
        time: event.timestamp,
      }],
    };
  }

  private transformToMixpanel(event: Event): any {
    const eventUser = event.user || { anonymousId: 'unknown' };
    
    return {
      event: event.eventType === 'track' ? (event as any).event : event.eventType,
      properties: {
        distinct_id: eventUser.userId || eventUser.anonymousId,
        time: event.timestamp,
        ...(event as any).properties,
        $user_id: eventUser.userId,
        $device_id: eventUser.anonymousId,
      },
    };
  }

  async addDestination(destination: Destination): Promise<void> {
    this.destinations.push(destination);
    await this.saveDestinations();
  }

  async updateDestination(name: string, updates: Partial<Destination>): Promise<boolean> {
    const index = this.destinations.findIndex(d => d.name === name);
    if (index === -1) return false;

    this.destinations[index] = { ...this.destinations[index], ...updates };
    await this.saveDestinations();
    return true;
  }

  async removeDestination(name: string): Promise<boolean> {
    const index = this.destinations.findIndex(d => d.name === name);
    if (index === -1) return false;

    this.destinations.splice(index, 1);
    await this.saveDestinations();
    return true;
  }

  getDestinations(): Destination[] {
    return [...this.destinations];
  }

  private async saveDestinations(): Promise<void> {
    try {
      const key = 'event-dispatcher-destinations';
      await this.env.CACHE.put(key, JSON.stringify(this.destinations));
    } catch (error) {
      console.error('Failed to save destinations');
    }
  }
}
