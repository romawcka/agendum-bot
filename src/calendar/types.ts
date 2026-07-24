import type { CalendarAccount } from "@prisma/client";

export interface EventDraft {
  title: string;
  description?: string;
  timezone: string; // IANA, напр. "Europe/Warsaw"
  allDay: boolean;
  date: string; // YYYY-MM-DD
  startTime?: string; // HH:mm, только если !allDay
  durationMinutes?: number; // только если !allDay
  reminderMinutes: number;
}

export interface CreatedEvent {
  externalId: string;
}

export interface DeletedEvent {
  /** True when the provider returned 404 — already gone, not an error (tech spec §5.3/§6). */
  alreadyDeleted: boolean;
}

export interface CalendarProvider {
  createEvent(account: CalendarAccount, event: EventDraft): Promise<CreatedEvent>;
  deleteEvent(account: CalendarAccount, externalId: string): Promise<DeletedEvent>;
  testConnection(account: CalendarAccount): Promise<boolean>;
}
