export interface EventDraft {
  title: string;
  description?: string;
  timezone: string; // IANA, e.g. "Europe/Warsaw"
  allDay: boolean;
  date: string; // YYYY-MM-DD
  startTime?: string; // HH:mm, only if !allDay
  durationMinutes?: number; // only if !allDay
  reminderMinutes: number;
}

export interface CreatedEvent {
  externalId: string;
}

export interface DeletedEvent {
  /** True when the provider returned 404 — already gone, not an error (tech spec §5.3/§6). */
  alreadyDeleted: boolean;
}
