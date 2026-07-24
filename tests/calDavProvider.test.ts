import type { CalendarAccount } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createCalendarObjectMock, deleteCalendarObjectMock, fetchCalendarsMock, createDAVClientMock } = vi.hoisted(
  () => ({
    createCalendarObjectMock: vi.fn(),
    deleteCalendarObjectMock: vi.fn(),
    fetchCalendarsMock: vi.fn(),
    createDAVClientMock: vi.fn(),
  }),
);

vi.mock("tsdav", () => ({
  createDAVClient: createDAVClientMock,
}));

const { CalDavProvider, testCalDavConnection } = await import("../src/calendar/providers/CalDavProvider.js");
const { AppError } = await import("../src/utils/errors.js");
const { encrypt } = await import("../src/utils/crypto.js");

function fakeClient() {
  return {
    createCalendarObject: createCalendarObjectMock,
    deleteCalendarObject: deleteCalendarObjectMock,
    fetchCalendars: fetchCalendarsMock,
  };
}

function fakeAccount(overrides: Partial<CalendarAccount> = {}): CalendarAccount {
  return {
    id: 1,
    userId: 1,
    provider: "CALDAV",
    label: "iCloud",
    externalId: "https://caldav.icloud.com/12345/calendars/home/",
    accessToken: null,
    refreshToken: null,
    expiresAt: null,
    caldavUrl: "https://caldav.icloud.com",
    caldavUser: "test@example.com",
    caldavPass: encrypt("app-specific-password"),
    isActive: true,
    createdAt: new Date(),
    ...overrides,
  };
}

const DRAFT = {
  title: "Событие",
  timezone: "Europe/Warsaw",
  allDay: false,
  date: "2026-08-14",
  startTime: "15:00",
  durationMinutes: 60,
  reminderMinutes: 30,
};

beforeEach(() => {
  createCalendarObjectMock.mockReset();
  deleteCalendarObjectMock.mockReset();
  fetchCalendarsMock.mockReset();
  createDAVClientMock.mockReset();
  createDAVClientMock.mockResolvedValue(fakeClient());
});

describe("testCalDavConnection", () => {
  it("returns the first calendar's URL on success, without hitting the network", async () => {
    fetchCalendarsMock.mockResolvedValue([{ url: "https://caldav.icloud.com/12345/calendars/home/" }]);

    const result = await testCalDavConnection("test@example.com", "app-specific-password");

    expect(result).toEqual({ ok: true, calendarUrl: "https://caldav.icloud.com/12345/calendars/home/" });
  });

  it("returns ok: false when the account has no calendars", async () => {
    fetchCalendarsMock.mockResolvedValue([]);
    await expect(testCalDavConnection("a@b.com", "x")).resolves.toEqual({ ok: false });
  });

  it("returns ok: false (not a throw) when discovery fails", async () => {
    createDAVClientMock.mockRejectedValue(new Error("401 unauthorized"));
    await expect(testCalDavConnection("a@b.com", "wrong-password")).resolves.toEqual({ ok: false });
  });
});

describe("CalDavProvider.createEvent", () => {
  it("PUTs an ICS object and returns the computed object URL", async () => {
    createCalendarObjectMock.mockResolvedValue({ ok: true, status: 201 });

    const result = await CalDavProvider.createEvent(fakeAccount(), DRAFT);

    expect(result.externalId).toMatch(/^https:\/\/caldav\.icloud\.com\/12345\/calendars\/home\/.+\.ics$/);
    expect(createCalendarObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({ iCalString: expect.stringContaining("SUMMARY:Событие") }),
    );
  });

  it("maps a 401 response to the caldav_unauthorized AppError with the tech spec §12 message", async () => {
    createCalendarObjectMock.mockResolvedValue({ ok: false, status: 401 });

    await expect(CalDavProvider.createEvent(fakeAccount(), DRAFT)).rejects.toMatchObject({
      code: "caldav_unauthorized",
      userMessage: "Пароль для iCloud більше не працює. Онови його в /settings",
    });
  });

  it("maps other non-ok responses to a generic AppError", async () => {
    createCalendarObjectMock.mockResolvedValue({ ok: false, status: 503 });
    await expect(CalDavProvider.createEvent(fakeAccount(), DRAFT)).rejects.toBeInstanceOf(AppError);
  });
});

describe("CalDavProvider.deleteEvent", () => {
  it("reports a normal successful deletion as alreadyDeleted: false", async () => {
    deleteCalendarObjectMock.mockResolvedValue({ ok: true, status: 204 });
    await expect(CalDavProvider.deleteEvent(fakeAccount(), "https://x/y.ics")).resolves.toEqual({
      alreadyDeleted: false,
    });
  });

  it("treats a 404 as a successful no-op, not an error (tech spec §6)", async () => {
    deleteCalendarObjectMock.mockResolvedValue({ ok: false, status: 404 });
    await expect(CalDavProvider.deleteEvent(fakeAccount(), "https://x/gone.ics")).resolves.toEqual({
      alreadyDeleted: true,
    });
  });
});

describe("CalDavProvider.testConnection", () => {
  it("returns false when the account has no stored credentials", async () => {
    const account = fakeAccount({ caldavUser: null, caldavPass: null });
    await expect(CalDavProvider.testConnection(account)).resolves.toBe(false);
  });

  it("decrypts the stored password and delegates to testCalDavConnection", async () => {
    fetchCalendarsMock.mockResolvedValue([{ url: "https://caldav.icloud.com/12345/calendars/home/" }]);
    await expect(CalDavProvider.testConnection(fakeAccount())).resolves.toBe(true);
  });
});
