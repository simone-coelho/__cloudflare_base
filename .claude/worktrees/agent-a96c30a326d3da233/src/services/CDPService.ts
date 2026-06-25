import type { Env } from '@/types/env';

export interface ProfileData {
  userId?: string;
  email?: string;
  anonymousId?: string;
  traits?: Record<string, any>;
  segments?: string[];
  lastSeen?: number;
  firstSeen?: number;
  sessionCount?: number;
}

export interface CDPDestination {
  id: string;
  name: string;
  type: 'segment' | 'amplitude' | 'mixpanel' | 'webhook' | 'custom';
  config: {
    url?: string;
    apiKey?: string;
    writeKey?: string;
    headers?: Record<string, string>;
    mapping?: Record<string, string>;
  };
  enabled: boolean;
  createdAt: number;
}

export interface IdentifyRequest {
  userId?: string;
  anonymousId?: string;
  traits: Record<string, any>;
}

export interface TrackRequest {
  userId?: string;
  anonymousId?: string;
  event: string;
  properties: Record<string, any>;
  traits?: Record<string, any>;
}

export class CDPService {
  private env: Env;
  private destinations: CDPDestination[] = [];

  constructor(env: Env) {
    this.env = env;
    this.loadDestinations();
  }

  private async loadDestinations(): Promise<void> {
    try {
      const destinationsConfig = this.env.CDP_ENDPOINTS;
      if (destinationsConfig) {
        this.destinations = JSON.parse(destinationsConfig);
      }
    } catch (error) {
      console.error('Failed to load CDP destinations:', error);
    }

    if (this.destinations.length === 0) {
      this.destinations = this.getDefaultDestinations();
    }
  }

  private getDefaultDestinations(): CDPDestination[] {
    return [
      {
        id: 'segment',
        name: 'Segment',
        type: 'segment',
        config: {
          url: 'https://api.segment.io/v1',
          writeKey: 'your-segment-write-key',
        },
        enabled: false,
        createdAt: Date.now(),
      },
      {
        id: 'amplitude',
        name: 'Amplitude',
        type: 'amplitude',
        config: {
          url: 'https://api.amplitude.com/2/httpapi',
          apiKey: 'your-amplitude-api-key',
        },
        enabled: false,
        createdAt: Date.now(),
      },
      {
        id: 'mixpanel',
        name: 'Mixpanel',
        type: 'mixpanel',
        config: {
          url: 'https://api.mixpanel.com',
          apiKey: 'your-mixpanel-token',
        },
        enabled: false,
        createdAt: Date.now(),
      },
    ];
  }

  async getProfile(identifier: {
    userId?: string;
    email?: string;
    anonymousId?: string;
  }): Promise<ProfileData | null> {
    try {
      let profileKey: string;
      
      if (identifier.userId) {
        profileKey = `profile:user:${identifier.userId}`;
      } else if (identifier.email) {
        profileKey = `profile:email:${identifier.email}`;
      } else if (identifier.anonymousId) {
        profileKey = `profile:anon:${identifier.anonymousId}`;
      } else {
        throw new Error('At least one identifier is required');
      }

      const profile = await this.env.CACHE.get(profileKey, 'json') as ProfileData;
      
      if (!profile) {
        return null;
      }

      return {
        ...profile,
        segments: await this.getSegments(identifier.userId || '', profile.traits || {}),
      };
    } catch (error) {
      console.error('Error getting profile:', error);
      return null;
    }
  }

  async identify(request: IdentifyRequest): Promise<void> {
    try {
      const { userId, anonymousId, traits } = request;
      const now = Date.now();

      if (!userId && !anonymousId) {
        throw new Error('Either userId or anonymousId is required');
      }

      const identifier = userId || anonymousId!;
      const profileKey = userId 
        ? `profile:user:${userId}` 
        : `profile:anon:${anonymousId}`;

      const existingProfile = await this.env.CACHE.get(profileKey, 'json') as ProfileData || {};

      const updatedProfile: ProfileData = {
        ...existingProfile,
        userId,
        anonymousId,
        traits: {
          ...existingProfile.traits,
          ...traits,
        },
        lastSeen: now,
        firstSeen: existingProfile.firstSeen || now,
        sessionCount: (existingProfile.sessionCount || 0) + 1,
      };

      await this.env.CACHE.put(profileKey, JSON.stringify(updatedProfile));

      if (userId && anonymousId && userId !== anonymousId) {
        const anonKey = `profile:anon:${anonymousId}`;
        const anonProfile = await this.env.CACHE.get(anonKey, 'json') as ProfileData;
        
        if (anonProfile) {
          const mergedProfile: ProfileData = {
            ...updatedProfile,
            traits: {
              ...anonProfile.traits,
              ...updatedProfile.traits,
            },
            firstSeen: Math.min(
              updatedProfile.firstSeen || now,
              anonProfile.firstSeen || now
            ),
            sessionCount: (updatedProfile.sessionCount || 0) + (anonProfile.sessionCount || 0),
          };
          
          await this.env.CACHE.put(profileKey, JSON.stringify(mergedProfile));
          await this.env.CACHE.delete(anonKey);
        }
      }

      await this.forwardToDestinations('identify', {
        userId,
        anonymousId,
        traits,
        timestamp: now,
      });

    } catch (error) {
      console.error('Error in identify:', error);
      throw error;
    }
  }

  async track(request: TrackRequest): Promise<void> {
    try {
      const { userId, anonymousId, event, properties, traits } = request;
      const now = Date.now();

      if (!userId && !anonymousId) {
        throw new Error('Either userId or anonymousId is required');
      }

      if (traits) {
        await this.identify({ userId, anonymousId, traits });
      }

      const eventData = {
        userId,
        anonymousId,
        event,
        properties,
        timestamp: now,
      };

      await this.env.EVENT_QUEUE.send({
        type: 'track',
        data: eventData,
        timestamp: now,
      });

      await this.forwardToDestinations('track', eventData);

    } catch (error) {
      console.error('Error in track:', error);
      throw error;
    }
  }

  async getSegments(userId: string, traits: Record<string, any> = {}): Promise<string[]> {
    try {
      const segments: string[] = [];

      if (traits.plan) {
        segments.push(`plan_${traits.plan}`);
      }

      if (traits.company) {
        segments.push(`company_${traits.company}`);
      }

      if (traits.industry) {
        segments.push(`industry_${traits.industry}`);
      }

      if (traits.country) {
        segments.push(`country_${traits.country}`);
      }

      if (traits.revenue) {
        const revenue = parseFloat(traits.revenue);
        if (revenue > 10000) segments.push('high_value');
        else if (revenue > 1000) segments.push('medium_value');
        else segments.push('low_value');
      }

      const profileKey = `profile:user:${userId}`;
      const profile = await this.env.CACHE.get(profileKey, 'json') as ProfileData;
      
      if (profile) {
        const daysSinceFirstSeen = Math.floor(
          (Date.now() - (profile.firstSeen || Date.now())) / (24 * 60 * 60 * 1000)
        );
        
        if (daysSinceFirstSeen > 30) segments.push('power_user');
        else if (daysSinceFirstSeen > 7) segments.push('active_user');
        else segments.push('new_user');

        if ((profile.sessionCount || 0) > 10) segments.push('frequent_user');
      }

      return segments;
    } catch (error) {
      console.error('Error getting segments:', error);
      return [];
    }
  }

  async forward(destination: string, data: any): Promise<any> {
    try {
      const dest = this.destinations.find(d => d.id === destination);
      
      if (!dest) {
        throw new Error(`Destination ${destination} not found`);
      }

      if (!dest.enabled) {
        throw new Error(`Destination ${destination} is disabled`);
      }

      const response = await fetch(dest.config.url!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...dest.config.headers,
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`Error forwarding to ${destination}:`, error);
      throw error;
    }
  }

  async getDestinations(): Promise<CDPDestination[]> {
    return [...this.destinations];
  }

  async createDestination(destination: Omit<CDPDestination, 'id' | 'createdAt'>): Promise<CDPDestination> {
    const newDestination: CDPDestination = {
      ...destination,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    };

    this.destinations.push(newDestination);
    await this.saveDestinations();

    return newDestination;
  }

  async updateDestination(id: string, updates: Partial<CDPDestination>): Promise<CDPDestination | null> {
    const index = this.destinations.findIndex(d => d.id === id);
    if (index === -1) return null;

    this.destinations[index] = { ...this.destinations[index], ...updates };
    await this.saveDestinations();

    return this.destinations[index];
  }

  async deleteDestination(id: string): Promise<boolean> {
    const index = this.destinations.findIndex(d => d.id === id);
    if (index === -1) return false;

    this.destinations.splice(index, 1);
    await this.saveDestinations();

    return true;
  }

  private async forwardToDestinations(action: string, data: any): Promise<void> {
    const enabledDestinations = this.destinations.filter(d => d.enabled);

    const forwardPromises = enabledDestinations.map(async (destination) => {
      try {
        await this.forward(destination.id, {
          action,
          ...data,
        });
      } catch (error) {
        console.error(`Failed to forward to ${destination.name}:`, error);
      }
    });

    await Promise.allSettled(forwardPromises);
  }

  private async saveDestinations(): Promise<void> {
    try {
      const key = 'cdp-destinations';
      await this.env.CACHE.put(key, JSON.stringify(this.destinations));
    } catch (error) {
      console.error('Failed to save CDP destinations:', error);
    }
  }
}