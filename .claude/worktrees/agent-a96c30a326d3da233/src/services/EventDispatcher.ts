import type { Env } from '@/types/env';
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
        this.destinations = JSON.parse(destinationsConfig);
      }
    } catch (error) {
      console.error('Failed to load destinations:', error);
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
    const results: DispatchResult[] = [];
    const enabledDestinations = this.destinations.filter(d => d.enabled);

    if (enabledDestinations.length === 0) {
      console.log('No enabled destinations found, queuing event');
      await this.queueEvent(event);
      return results;
    }

    const dispatchPromises = enabledDestinations.map(async (destination) => {
      const startTime = Date.now();
      
      try {
        const transformedEvent = destination.transform 
          ? destination.transform(event) 
          : event;

        const response = await fetch(destination.url, {
          method: 'POST',
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
        console.error(`Failed to dispatch to ${destination.name}:`, error);
        
        if (destination.retryConfig) {
          await this.queueForRetry(event, destination);
        }

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

    await this.queueEvent(event);

    return results;
  }

  private async queueEvent(event: Event): Promise<void> {
    try {
      await this.env.EVENT_QUEUE.send({
        type: 'event',
        event,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Failed to queue event:', error);
    }
  }

  private async queueForRetry(event: Event, destination: Destination): Promise<void> {
    try {
      await this.env.EVENT_QUEUE.send({
        type: 'retry',
        event,
        destination: destination.name,
        timestamp: Date.now(),
        retryCount: 0,
      });
    } catch (error) {
      console.error('Failed to queue retry:', error);
    }
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
      console.error('Failed to save destinations:', error);
    }
  }
}