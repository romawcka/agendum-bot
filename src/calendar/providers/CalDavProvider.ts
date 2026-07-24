import { randomUUID } from "node:crypto";
import type { CalendarAccount } from "@prisma/client";
import { createDAVClient } from "tsdav";
import { logger } from "../../config/logger.js";
import { decrypt } from "../../utils/crypto.js";
import { AppError } from "../../utils/errors.js";
import { buildCalDavIcsEvent } from "../eventBuilder.js";
import type { CalendarProvider, CreatedEvent, DeletedEvent } from "../types.js";

export const ICLOUD_SERVER_URL = "https://caldav.icloud.com";

const CALENDAR_UNAVAILABLE_MESSAGE = "Календар тимчасово недоступний. Спробуй ще раз за хвилину";
const CALDAV_UNAUTHORIZED_MESSAGE = "Пароль для iCloud більше не працює. Онови його в /settings";

export interface CalDavConnectionResult {
  ok: boolean;
  calendarUrl?: string;
}

/**
 * Verifies Apple ID + app-password credentials against iCloud CalDAV and
 * returns the first calendar's URL (used as CalendarAccount.externalId).
 * Tech spec §6: pick the first writable calendar — tsdav's typed model
 * doesn't surface a writable/readOnly flag, so "first" is the pragmatic
 * choice for iteration 1's single-calendar-per-account scope.
 */
export async function testCalDavConnection(appleId: string, password: string): Promise<CalDavConnectionResult> {
  try {
    const client = await createDAVClient({
      serverUrl: ICLOUD_SERVER_URL,
      credentials: { username: appleId, password },
      authMethod: "Basic",
      defaultAccountType: "caldav",
    });
    const calendars = await client.fetchCalendars();
    const target = calendars[0];
    if (!target) {
      return { ok: false };
    }
    return { ok: true, calendarUrl: target.url };
  } catch {
    return { ok: false };
  }
}

async function getAuthenticatedClient(account: CalendarAccount) {
  if (!account.caldavUser || !account.caldavPass || !account.caldavUrl) {
    throw new AppError({ code: "caldav_credentials_missing", userMessage: CALDAV_UNAUTHORIZED_MESSAGE });
  }
  return createDAVClient({
    serverUrl: account.caldavUrl,
    credentials: { username: account.caldavUser, password: decrypt(account.caldavPass) },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });
}

export const CalDavProvider: CalendarProvider = {
  async createEvent(account, draft): Promise<CreatedEvent> {
    try {
      const client = await getAuthenticatedClient(account);
      const uid = randomUUID();
      const filename = `${uid}.ics`;
      const objectUrl = new URL(filename, account.externalId).href;

      const response = await client.createCalendarObject({
        calendar: { url: account.externalId },
        iCalString: buildCalDavIcsEvent(draft, uid),
        filename,
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new AppError({ code: "caldav_unauthorized", userMessage: CALDAV_UNAUTHORIZED_MESSAGE });
        }
        throw new Error(`CalDAV PUT завершился со статусом ${response.status}`);
      }

      return { externalId: objectUrl };
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      logger.error({ err, accountId: account.id }, "Не удалось создать событие в iCloud");
      throw new AppError({ code: "caldav_create_failed", userMessage: CALENDAR_UNAVAILABLE_MESSAGE, cause: err });
    }
  },

  async deleteEvent(account, externalId): Promise<DeletedEvent> {
    try {
      const client = await getAuthenticatedClient(account);
      const response = await client.deleteCalendarObject({ calendarObject: { url: externalId } });

      if (response.status === 404) {
        return { alreadyDeleted: true }; // tech spec §6: already deleted — not an error
      }
      if (!response.ok) {
        if (response.status === 401) {
          throw new AppError({ code: "caldav_unauthorized", userMessage: CALDAV_UNAUTHORIZED_MESSAGE });
        }
        throw new Error(`CalDAV DELETE завершился со статусом ${response.status}`);
      }
      return { alreadyDeleted: false };
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      logger.error({ err, accountId: account.id }, "Не удалось удалить событие в iCloud");
      throw new AppError({ code: "caldav_delete_failed", userMessage: CALENDAR_UNAVAILABLE_MESSAGE, cause: err });
    }
  },

  async testConnection(account): Promise<boolean> {
    if (!account.caldavUser || !account.caldavPass) {
      return false;
    }
    const result = await testCalDavConnection(account.caldavUser, decrypt(account.caldavPass));
    return result.ok;
  },
};
