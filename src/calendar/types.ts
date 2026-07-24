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

export interface CalendarProvider {
  createEvent(account: CalendarAccount, event: EventDraft): Promise<CreatedEvent>;
  deleteEvent(account: CalendarAccount, externalId: string): Promise<void>;
  testConnection(account: CalendarAccount): Promise<boolean>;
}
