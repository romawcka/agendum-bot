import type { CalendarAccount } from "@prisma/client";
import { google } from "googleapis";
import { logger } from "../../config/logger.js";
import { getValidGoogleClient } from "../../services/TokenService.js";
import { AppError } from "../../utils/errors.js";
import { buildGoogleEventPayload } from "../eventBuilder.js";
import type { CreatedEvent, DeletedEvent, EventDraft } from "../types.js";

const CALENDAR_UNAVAILABLE_MESSAGE = "Календар тимчасово недоступний. Спробуй ще раз за хвилину";

function calendarId(account: CalendarAccount): string {
  return account.externalId || "primary";
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === 404;
}

export const GoogleCalendarProvider = {
  async createEvent(account: CalendarAccount, draft: EventDraft): Promise<CreatedEvent> {
    try {
      const auth = await getValidGoogleClient(account);
      const calendar = google.calendar({ version: "v3", auth });
      const { data } = await calendar.events.insert({
        calendarId: calendarId(account),
        requestBody: buildGoogleEventPayload(draft),
      });
      if (!data.id) {
        throw new Error("Google Calendar API did not return an id for the created event");
      }
      return { externalId: data.id };
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      logger.error({ err, accountId: account.id }, "Failed to create event in Google Calendar");
      throw new AppError({ code: "google_create_failed", userMessage: CALENDAR_UNAVAILABLE_MESSAGE, cause: err });
    }
  },

  async deleteEvent(account: CalendarAccount, externalId: string): Promise<DeletedEvent> {
    try {
      const auth = await getValidGoogleClient(account);
      const calendar = google.calendar({ version: "v3", auth });
      await calendar.events.delete({ calendarId: calendarId(account), eventId: externalId });
      return { alreadyDeleted: false };
    } catch (err) {
      if (isNotFound(err)) {
        return { alreadyDeleted: true }; // tech spec §5.3: already deleted manually — not an error
      }
      if (err instanceof AppError) {
        throw err;
      }
      logger.error({ err, accountId: account.id }, "Failed to delete event in Google Calendar");
      throw new AppError({ code: "google_delete_failed", userMessage: CALENDAR_UNAVAILABLE_MESSAGE, cause: err });
    }
  },

  async testConnection(account: CalendarAccount): Promise<boolean> {
    try {
      const auth = await getValidGoogleClient(account);
      const calendar = google.calendar({ version: "v3", auth });
      await calendar.calendarList.get({ calendarId: calendarId(account) });
      return true;
    } catch {
      return false;
    }
  },

  /** IDs of every event Google has in [timeMin, timeMax) — used to reconcile against our DB. */
  async listEventIds(account: CalendarAccount, timeMin: Date, timeMax: Date): Promise<Set<string>> {
    const auth = await getValidGoogleClient(account);
    const calendar = google.calendar({ version: "v3", auth });
    const ids = new Set<string>();
    let pageToken: string | undefined;

    do {
      const { data } = await calendar.events.list({
        calendarId: calendarId(account),
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        maxResults: 250,
        fields: "nextPageToken,items(id)",
        pageToken,
      });
      for (const item of data.items ?? []) {
        if (item.id) ids.add(item.id);
      }
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);

    return ids;
  },
};
