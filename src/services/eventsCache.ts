import type { CalendarAccount, Event } from "@prisma/client";

export type EventWithAccount = Event & { account: CalendarAccount };

interface CacheEntry {
  events: EventWithAccount[];
  fetchedAt: number;
}

// In-memory: acceptable per tech spec, single warm serverless instance — worst
// case on a cold start or a second instance is one extra DB/Google round trip,
// never stale data served past TTL_MS.
const TTL_MS = 60_000;
const cache = new Map<number, CacheEntry>();

export function getCached(userId: number): EventWithAccount[] | undefined {
  const entry = cache.get(userId);
  if (!entry) return undefined;
  if (Date.now() - entry.fetchedAt > TTL_MS) return undefined;
  return entry.events;
}

export function setCached(userId: number, events: EventWithAccount[]): void {
  cache.set(userId, { events, fetchedAt: Date.now() });
}

export function invalidate(userId: number): void {
  cache.delete(userId);
}
