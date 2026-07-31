import type { calendar_v3 } from "googleapis";
import { DateTime } from "luxon";
import type { EventDraft } from "./types.js";

export interface EventTimeRange {
  allDay: boolean;
  /** Event start, in draft.timezone. */
  start: DateTime;
  /**
   * Event end, in draft.timezone. For all-day events this is the date plus
   * one day — Google's end.date is exclusive (invariant 3).
   */
  end: DateTime;
}

/**
 * Turns an EventDraft's date/time/duration fields into concrete start/end
 * instants. Shared with buildGoogleEventPayload so the midnight-rollover and
 * all-day math (invariants 3 and 5) is implemented exactly once.
 */
export function buildEventTimeRange(draft: EventDraft): EventTimeRange {
  if (draft.allDay) {
    const start = DateTime.fromFormat(draft.date, "yyyy-MM-dd", { zone: draft.timezone });
    if (!start.isValid) {
      throw new Error(`Invalid event date: ${draft.date} (${start.invalidReason})`);
    }
    return { allDay: true, start, end: start.plus({ days: 1 }) };
  }

  if (!draft.startTime || draft.durationMinutes === undefined) {
    throw new Error("startTime and durationMinutes are required for a timed event");
  }

  const start = DateTime.fromFormat(`${draft.date} ${draft.startTime}`, "yyyy-MM-dd HH:mm", {
    zone: draft.timezone,
  });
  if (!start.isValid) {
    throw new Error(`Invalid event date/time: ${draft.date} ${draft.startTime} (${start.invalidReason})`);
  }

  return { allDay: false, start, end: start.plus({ minutes: draft.durationMinutes }) };
}

/**
 * EventDraft -> Google Calendar API insert payload. Invariant 1: a missing
 * description means the `description` key is absent from the payload
 * entirely — not an empty string, not `null`. Invariant 3: all-day events
 * use end.date = start date + 1 day (Google's end.date is exclusive).
 */
export function buildGoogleEventPayload(draft: EventDraft): calendar_v3.Schema$Event {
  const range = buildEventTimeRange(draft);

  const base: calendar_v3.Schema$Event = {
    summary: draft.title,
    ...(draft.description ? { description: draft.description } : {}),
    reminders: {
      useDefault: false,
      overrides: [{ method: "popup", minutes: draft.reminderMinutes }],
    },
  };

  if (range.allDay) {
    return {
      ...base,
      start: { date: range.start.toFormat("yyyy-MM-dd") },
      end: { date: range.end.toFormat("yyyy-MM-dd") },
    };
  }

  return {
    ...base,
    start: { dateTime: range.start.toISO(), timeZone: draft.timezone },
    end: { dateTime: range.end.toISO(), timeZone: draft.timezone },
  };
}
