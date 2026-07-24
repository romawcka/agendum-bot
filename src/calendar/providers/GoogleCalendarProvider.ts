import type { CalendarAccount } from "@prisma/client";
import { google } from "googleapis";
import { logger } from "../../config/logger.js";
import { getValidGoogleClient } from "../../services/TokenService.js";
import { AppError } from "../../utils/errors.js";
import { buildGoogleEventPayload } from "../eventBuilder.js";
import type { CalendarProvider, CreatedEvent, DeletedEvent } from "../types.js";

const CALENDAR_UNAVAILABLE_MESSAGE = "Календар тимчасово недоступний. Спробуй ще раз за хвилину";

function calendarId(account: CalendarAccount): string {
  return account.externalId || "primary";
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === 404;
}

export const GoogleCalendarProvider: CalendarProvider = {
  async createEvent(account, draft): Promise<CreatedEvent> {
    try {
      const auth = await getValidGoogleClient(account);
      const calendar = google.calendar({ version: "v3", auth });
      const { data } = await calendar.events.insert({
        calendarId: calendarId(account),
        requestBody: buildGoogleEventPayload(draft),
      });
      if (!data.id) {
        throw new Error("Google Calendar API не вернул id созданного события");
      }
      return { externalId: data.id };
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      logger.error({ err, accountId: account.id }, "Не удалось создать событие в Google Calendar");
      throw new AppError({ code: "google_create_failed", userMessage: CALENDAR_UNAVAILABLE_MESSAGE, cause: err });
    }
  },

  async deleteEvent(account, externalId): Promise<DeletedEvent> {
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
      logger.error({ err, accountId: account.id }, "Не удалось удалить событие в Google Calendar");
      throw new AppError({ code: "google_delete_failed", userMessage: CALENDAR_UNAVAILABLE_MESSAGE, cause: err });
    }
  },

  async testConnection(account): Promise<boolean> {
    try {
      const auth = await getValidGoogleClient(account);
      const calendar = google.calendar({ version: "v3", auth });
      await calendar.calendarList.get({ calendarId: calendarId(account) });
      return true;
    } catch {
      return false;
    }
  },
};
