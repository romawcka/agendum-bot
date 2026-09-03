import type { CalendarAccount } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";

const { insertMock, deleteMock, listMock, calendarListGetMock, calendarFactoryMock } = vi.hoisted(() => {
  const insertMock = vi.fn();
  const deleteMock = vi.fn();
  const listMock = vi.fn();
  const calendarListGetMock = vi.fn();
  const calendarFactoryMock = vi.fn(() => ({
    events: { insert: insertMock, delete: deleteMock, list: listMock },
    calendarList: { get: calendarListGetMock },
  }));
  return { insertMock, deleteMock, listMock, calendarListGetMock, calendarFactoryMock };
});

vi.mock("googleapis", () => ({
  google: { calendar: calendarFactoryMock },
}));

vi.mock("../src/services/TokenService.js", () => ({
  getValidGoogleClient: vi.fn().mockResolvedValue({}),
}));

const { GoogleCalendarProvider, isMatchingEvent } = await import("../src/calendar/providers/GoogleCalendarProvider.js");
const { buildEventTimeRange } = await import("../src/calendar/eventBuilder.js");
const { AppError } = await import("../src/utils/errors.js");

function fakeAccount(overrides: Partial<CalendarAccount> = {}): CalendarAccount {
  return {
    id: 1,
    userId: 1,
    googleAccountId: "google-sub-1",
    label: "user@gmail.com",
    externalId: "primary",
    accessToken: "enc-access",
    refreshToken: "enc-refresh",
    expiresAt: new Date(Date.now() + 3600_000),
    isActive: true,
    createdAt: new Date(),
    ...overrides,
  };
}

const DRAFT = {
  title: "Event",
  timezone: "Europe/Warsaw",
  allDay: false,
  date: "2026-08-14",
  startTime: "15:00",
  durationMinutes: 60,
  reminderMinutes: 30,
};

beforeEach(() => {
  insertMock.mockReset();
  deleteMock.mockReset();
  listMock.mockReset();
  calendarListGetMock.mockReset();
  calendarFactoryMock.mockClear();
});

describe("GoogleCalendarProvider.createEvent", () => {
  it("creates an event and returns its externalId, without hitting the network", async () => {
    insertMock.mockResolvedValue({ data: { id: "google-event-123" } });

    const result = await GoogleCalendarProvider.createEvent(fakeAccount(), DRAFT);

    expect(result).toEqual({ externalId: "google-event-123" });
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: "primary",
        requestBody: expect.objectContaining({ summary: "Event" }),
      }),
    );
  });

  it("wraps an unexpected API failure into an AppError with a non-technical message", async () => {
    insertMock.mockRejectedValue(new Error("network exploded"));

    await expect(GoogleCalendarProvider.createEvent(fakeAccount(), DRAFT)).rejects.toMatchObject({
      name: "AppError",
      code: "google_create_failed",
    });
  });

  it("bounds every Google API call with a timeout, so a lost response fails fast instead of hanging", async () => {
    insertMock.mockResolvedValue({ data: { id: "google-event-123" } });

    await GoogleCalendarProvider.createEvent(fakeAccount(), DRAFT);

    expect(calendarFactoryMock).toHaveBeenCalledWith(expect.objectContaining({ timeout: expect.any(Number) }));
  });
});

describe("isMatchingEvent", () => {
  const range = buildEventTimeRange(DRAFT);

  it("matches on exact title and start/end instant", () => {
    const item = {
      status: "confirmed",
      summary: "Event",
      start: { dateTime: range.start.toISO() },
      end: { dateTime: range.end.toISO() },
    };
    expect(isMatchingEvent(item, DRAFT, range)).toBe(true);
  });

  it("rejects a title mismatch", () => {
    const item = {
      status: "confirmed",
      summary: "Different title",
      start: { dateTime: range.start.toISO() },
      end: { dateTime: range.end.toISO() },
    };
    expect(isMatchingEvent(item, DRAFT, range)).toBe(false);
  });

  it("rejects a time mismatch", () => {
    const item = {
      status: "confirmed",
      summary: "Event",
      start: { dateTime: range.start.plus({ minutes: 5 }).toISO() },
      end: { dateTime: range.end.toISO() },
    };
    expect(isMatchingEvent(item, DRAFT, range)).toBe(false);
  });

  it("rejects a cancelled event", () => {
    const item = {
      status: "cancelled",
      summary: "Event",
      start: { dateTime: range.start.toISO() },
      end: { dateTime: range.end.toISO() },
    };
    expect(isMatchingEvent(item, DRAFT, range)).toBe(false);
  });

  it("rejects an item missing start/end fields", () => {
    const item = { status: "confirmed", summary: "Event" };
    expect(isMatchingEvent(item, DRAFT, range)).toBe(false);
  });

  it("matches all-day events on date-only start/end", () => {
    const allDayDraft = { ...DRAFT, allDay: true, startTime: undefined, durationMinutes: undefined };
    const allDayRange = buildEventTimeRange(allDayDraft);
    const item = {
      status: "confirmed",
      summary: "Event",
      start: { date: allDayRange.start.toFormat("yyyy-MM-dd") },
      end: { date: allDayRange.end.toFormat("yyyy-MM-dd") },
    };
    expect(isMatchingEvent(item, allDayDraft, allDayRange)).toBe(true);
  });
});

describe("GoogleCalendarProvider.findExistingEvent", () => {
  it("returns null when nothing matches", async () => {
    listMock.mockResolvedValue({ data: { items: [] } });

    await expect(GoogleCalendarProvider.findExistingEvent(fakeAccount(), DRAFT)).resolves.toBeNull();
  });

  it("returns the matching event's externalId when found", async () => {
    const range = buildEventTimeRange(DRAFT);
    listMock.mockResolvedValue({
      data: {
        items: [
          {
            id: "google-event-123",
            status: "confirmed",
            summary: "Event",
            start: { dateTime: range.start.toISO() },
            end: { dateTime: range.end.toISO() },
          },
        ],
      },
    });

    await expect(GoogleCalendarProvider.findExistingEvent(fakeAccount(), DRAFT)).resolves.toEqual({
      externalId: "google-event-123",
    });
  });

  it("fails open (returns null, doesn't throw) when the list call itself fails", async () => {
    listMock.mockRejectedValue(new Error("network exploded"));

    await expect(GoogleCalendarProvider.findExistingEvent(fakeAccount(), DRAFT)).resolves.toBeNull();
  });

  it("adopts the first match when several are found", async () => {
    const range = buildEventTimeRange(DRAFT);
    const matching = {
      status: "confirmed",
      summary: "Event",
      start: { dateTime: range.start.toISO() },
      end: { dateTime: range.end.toISO() },
    };
    listMock.mockResolvedValue({
      data: { items: [{ id: "first", ...matching }, { id: "second", ...matching }] },
    });

    await expect(GoogleCalendarProvider.findExistingEvent(fakeAccount(), DRAFT)).resolves.toEqual({
      externalId: "first",
    });
  });
});

describe("GoogleCalendarProvider.deleteEvent", () => {
  it("reports a normal successful deletion as alreadyDeleted: false", async () => {
    deleteMock.mockResolvedValue({});

    const result = await GoogleCalendarProvider.deleteEvent(fakeAccount(), "google-event-123");

    expect(result).toEqual({ alreadyDeleted: false });
  });

  it("treats a 404 as a successful no-op, not an error (tech spec §5.3)", async () => {
    deleteMock.mockRejectedValue(Object.assign(new Error("not found"), { code: 404 }));

    const result = await GoogleCalendarProvider.deleteEvent(fakeAccount(), "gone");

    expect(result).toEqual({ alreadyDeleted: true });
  });

  it("wraps a non-404 failure into an AppError", async () => {
    deleteMock.mockRejectedValue(Object.assign(new Error("server error"), { code: 500 }));

    await expect(GoogleCalendarProvider.deleteEvent(fakeAccount(), "x")).rejects.toBeInstanceOf(AppError);
  });
});

describe("GoogleCalendarProvider.listEventIds", () => {
  it("returns the ids of every event in the window", async () => {
    listMock.mockResolvedValue({ data: { items: [{ id: "a" }, { id: "b" }] } });

    const result = await GoogleCalendarProvider.listEventIds(fakeAccount(), new Date("2026-08-01"), new Date("2026-08-31"));

    expect(result).toEqual(new Set(["a", "b"]));
    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: "primary", singleEvents: true }),
    );
  });

  it("follows nextPageToken across multiple pages", async () => {
    listMock
      .mockResolvedValueOnce({ data: { items: [{ id: "a" }], nextPageToken: "p2" } })
      .mockResolvedValueOnce({ data: { items: [{ id: "b" }] } });

    const result = await GoogleCalendarProvider.listEventIds(fakeAccount(), new Date(), new Date());

    expect(result).toEqual(new Set(["a", "b"]));
    expect(listMock).toHaveBeenCalledTimes(2);
    expect(listMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ pageToken: "p2" }));
  });
});

describe("GoogleCalendarProvider.testConnection", () => {
  it("returns true when the calendar is reachable", async () => {
    calendarListGetMock.mockResolvedValue({ data: {} });
    await expect(GoogleCalendarProvider.testConnection(fakeAccount())).resolves.toBe(true);
  });

  it("returns false (not a throw) when the calendar call fails", async () => {
    calendarListGetMock.mockRejectedValue(new Error("unauthorized"));
    await expect(GoogleCalendarProvider.testConnection(fakeAccount())).resolves.toBe(false);
  });
});
