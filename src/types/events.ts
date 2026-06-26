import { z } from 'zod';

export const BaseEventSchema = z.object({
  eventId: z.string().uuid(),
  timestamp: z.number(),
  eventType: z.string(),
  source: z.string(),
  version: z.string().default('1.0'),
});

export const UserContextSchema = z.object({
  userId: z.string().optional(),
  anonymousId: z.string(),
  email: z.string().email().optional(),
  traits: z.record(z.string(), z.any()).optional(),
  segments: z.array(z.string()).optional(),
});

export const PageContextSchema = z.object({
  url: z.string().url(),
  path: z.string(),
  referrer: z.string().optional(),
  title: z.string().optional(),
  search: z.string().optional(),
  userAgent: z.string(),
  ip: z.string(),
});

export const TrackEventSchema = BaseEventSchema.extend({
  eventType: z.literal('track'),
  event: z.string(),
  properties: z.record(z.string(), z.any()).optional(),
  user: UserContextSchema,
  page: PageContextSchema.optional(),
});

export const PageEventSchema = BaseEventSchema.extend({
  eventType: z.literal('page'),
  name: z.string().optional(),
  category: z.string().optional(),
  properties: z.record(z.string(), z.any()).optional(),
  user: UserContextSchema,
  page: PageContextSchema,
});

export const IdentifyEventSchema = BaseEventSchema.extend({
  eventType: z.literal('identify'),
  user: UserContextSchema,
  traits: z.record(z.string(), z.any()),
});

export const PixelEventSchema = BaseEventSchema.extend({
  eventType: z.literal('pixel'),
  pixelId: z.string(),
  campaignId: z.string().optional(),
  emailId: z.string().optional(),
  recipientId: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  user: UserContextSchema.optional(),
  page: PageContextSchema.optional(),
});

export const EventSchema = z.discriminatedUnion('eventType', [
  TrackEventSchema,
  PageEventSchema,
  IdentifyEventSchema,
  PixelEventSchema,
]);

export type BaseEvent = z.infer<typeof BaseEventSchema>;
export type UserContext = z.infer<typeof UserContextSchema>;
export type PageContext = z.infer<typeof PageContextSchema>;
export type TrackEvent = z.infer<typeof TrackEventSchema>;
export type PageEvent = z.infer<typeof PageEventSchema>;
export type IdentifyEvent = z.infer<typeof IdentifyEventSchema>;
export type PixelEvent = z.infer<typeof PixelEventSchema>;
export type Event = z.infer<typeof EventSchema>;