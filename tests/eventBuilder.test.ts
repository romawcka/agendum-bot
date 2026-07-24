import { describe, expect, it } from "vitest";
import { buildCalDavIcsEvent, buildEventTimeRange, buildGoogleEventPayload } from "../src/calendar/eventBuilder.js";
import type { EventDraft } from "../src/calendar/types.js";

const TZ = "Europe/Warsaw";

function timedDraft(overrides: Partial<EventDraft> = {}): EventDraft {
  return {
    title: "Событие",
    timezone: TZ,
    allDay: false,
    date: "2026-08-14",
    startTime: "15:00",
    durationMinutes: 60,
    reminderMinutes: 30,
    ...overrides,
  };
}

function allDayDraft(overrides: Partial<EventDraft> = {}): EventDraft {
  return {
    title: "Событие",
    timezone: TZ,
    allDay: true,
    date: "2026-08-14",
    reminderMinutes: 30,
    ...overrides,
  };
}

describe("buildEventTimeRange", () => {
  it("rolls over midnight: 23:30 + 60 minutes = 00:30 next day", () => {
    const range = buildEventTimeRange(timedDraft({ startTime: "23:30", durationMinutes: 60 }));
    expect(range.end.toFormat("yyyy-MM-dd HH:mm")).toBe("2026-08-15 00:30");
  });

  it("all-day end is start date + 1 day (Google's end.date is exclusive)", () => {
    const range = buildEventTimeRange(allDayDraft({ date: "2026-08-14" }));
    expect(range.start.toFormat("yyyy-MM-dd")).toBe("2026-08-14");
    expect(range.end.toFormat("yyyy-MM-dd")).toBe("2026-08-15");
  });

  it("keeps real elapsed duration across a DST spring-forward gap", () => {
    // Europe/Warsaw, 2026-03-29: clocks jump from 02:00 to 03:00 CEST.
    const range = buildEventTimeRange(timedDraft({ date: "2026-03-29", startTime: "01:00", durationMinutes: 90 }));
    expect(range.start.offset).toBe(60); // CET, UTC+1
    expect(range.end.offset).toBe(120); // CEST, UTC+2
    expect(range.end.toFormat("yyyy-MM-dd HH:mm")).toBe("2026-03-29 03:30");
    expect(range.end.diff(range.start, "minutes").minutes).toBe(90);
  });

  it("allows a past date without throwing (PRD: past dates are permitted, just warned about in the wizard)", () => {
    expect(() => buildEventTimeRange(timedDraft({ date: "2020-01-01" }))).not.toThrow();
  });

  it("throws on an invalid timezone rather than silently using the server's zone", () => {
    expect(() => buildEventTimeRange(timedDraft({ timezone: "Not/AZone" }))).toThrow();
  });
});

describe("buildGoogleEventPayload", () => {
  it("omits the description key entirely when none is given (invariant 1)", () => {
    const payload = buildGoogleEventPayload(timedDraft({ description: undefined }));
    expect(payload).not.toHaveProperty("description");
  });

  it("includes the description when given", () => {
    const payload = buildGoogleEventPayload(timedDraft({ description: "Кабинет 305" }));
    expect(payload.description).toBe("Кабинет 305");
  });

  it("uses start.date/end.date (not dateTime) for all-day events", () => {
    const payload = buildGoogleEventPayload(allDayDraft({ date: "2026-08-14" }));
    expect(payload.start).toEqual({ date: "2026-08-14" });
    expect(payload.end).toEqual({ date: "2026-08-15" });
  });

  it("uses start.dateTime/timeZone (not date) for timed events", () => {
    const payload = buildGoogleEventPayload(timedDraft());
    expect(payload.start?.date).toBeUndefined();
    expect(typeof payload.start?.dateTime).toBe("string");
    expect(payload.start?.timeZone).toBe(TZ);
  });

  it("sets a popup reminder override matching reminderMinutes, with useDefault false", () => {
    const payload = buildGoogleEventPayload(timedDraft({ reminderMinutes: 30 }));
    expect(payload.reminders).toEqual({ useDefault: false, overrides: [{ method: "popup", minutes: 30 }] });
  });
});

describe("buildCalDavIcsEvent", () => {
  it("omits DESCRIPTION from the event body when none is given", () => {
    const ics = buildCalDavIcsEvent(timedDraft({ description: undefined }), "uid-1");
    const eventBody = ics.split("BEGIN:VALARM")[0]!;
    expect(eventBody).not.toContain("DESCRIPTION:");
  });

  it("includes DESCRIPTION when given", () => {
    const ics = buildCalDavIcsEvent(timedDraft({ description: "Кабинет 305" }), "uid-2");
    expect(ics).toContain("DESCRIPTION:");
  });

  it("uses VALUE=DATE for all-day DTSTART/DTEND, end = start + 1 day", () => {
    const ics = buildCalDavIcsEvent(allDayDraft({ date: "2026-08-14" }), "uid-3");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260814");
    expect(ics).toContain("DTEND;VALUE=DATE:20260815");
  });

  it("sets a VALARM that triggers before the start (not after, not relative to end)", () => {
    const ics = buildCalDavIcsEvent(timedDraft({ reminderMinutes: 30 }), "uid-4");
    expect(ics).toContain("TRIGGER:-PT30M");
    expect(ics).not.toContain("RELATED=END");
  });
});
