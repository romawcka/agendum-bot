import type { CalendarAccount } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { insertMock, deleteMock, listMock, calendarListGetMock } = vi.hoisted(() => ({
  insertMock: vi.fn(),
  deleteMock: vi.fn(),
  listMock: vi.fn(),
  calendarListGetMock: vi.fn(),
}));

vi.mock("googleapis", () => ({
  google: {
    calendar: () => ({
      events: { insert: insertMock, delete: deleteMock, list: listMock },
      calendarList: { get: calendarListGetMock },
    }),
  },
}));

vi.mock("../src/services/TokenService.js", () => ({
  getValidGoogleClient: vi.fn().mockResolvedValue({}),
}));

const { GoogleCalendarProvider } = await import("../src/calendar/providers/GoogleCalendarProvider.js");
const { AppError } = await import("../src/utils/errors.js");

function fakeAccount(overrides: Partial<CalendarAccount> = {}): CalendarAccount {
  return {
    id: 1,
    userId: 1,
    label: "Google Calendar",
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
