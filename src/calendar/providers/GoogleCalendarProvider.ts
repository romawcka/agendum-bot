import type { CalendarAccount } from "@prisma/client";
import { google, type calendar_v3 } from "googleapis";
import { DateTime } from "luxon";
import { logger } from "../../config/logger.js";
import { getValidGoogleClient, type GoogleOAuthClient } from "../../services/TokenService.js";
import { AppError } from "../../utils/errors.js";
import { buildEventTimeRange, buildGoogleEventPayload, type EventTimeRange } from "../eventBuilder.js";
import type { CreatedEvent, DeletedEvent, EventDraft } from "../types.js";

const CALENDAR_UNAVAILABLE_MESSAGE = "Календар тимчасово недоступний. Спробуй ще раз за хвилину";

// No timeout by default in gaxios — bound every call so a lost/slow response fails
// fast and predictably instead of hanging indefinitely (see docs/features — retry-duplicate fix).
const GOOGLE_API_TIMEOUT_MS = 10_000;

function createCalendarClient(auth: GoogleOAuthClient): calendar_v3.Calendar {
  return google.calendar({ version: "v3", auth, timeout: GOOGLE_API_TIMEOUT_MS });
}

function calendarId(account: CalendarAccount): string {
  return account.externalId || "primary";
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === 404;
}

/** Does this Google event look like the one `draft` describes — same title, same exact start/end instant? */
export function isMatchingEvent(item: calendar_v3.Schema$Event, draft: EventDraft, range: EventTimeRange): boolean {
  if (item.status === "cancelled") return false;
  if (item.summary !== draft.title) return false;

  const itemStartIso = range.allDay ? item.start?.date : item.start?.dateTime;
  const itemEndIso = range.allDay ? item.end?.date : item.end?.dateTime;
  if (!itemStartIso || !itemEndIso) return false;

  const itemStart = DateTime.fromISO(itemStartIso, { zone: draft.timezone });
  const itemEnd = DateTime.fromISO(itemEndIso, { zone: draft.timezone });
  if (!itemStart.isValid || !itemEnd.isValid) return false;

  return itemStart.toMillis() === range.start.toMillis() && itemEnd.toMillis() === range.end.toMillis();
}

export const GoogleCalendarProvider = {
  async createEvent(account: CalendarAccount, draft: EventDraft): Promise<CreatedEvent> {
    try {
      const auth = await getValidGoogleClient(account);
      const calendar = createCalendarClient(auth);
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

  /**
   * Looks for an event matching `draft` that may already exist — used only when retrying after a
   * "google_create_failed" (the insert may have actually succeeded; the response was just lost).
   * Fails open: any error here (including its own timeout) returns null so the caller falls back
   * to a normal create rather than getting stuck.
   */
  async findExistingEvent(account: CalendarAccount, draft: EventDraft): Promise<CreatedEvent | null> {
    try {
      const auth = await getValidGoogleClient(account);
      const calendar = createCalendarClient(auth);
      const range = buildEventTimeRange(draft);
      const timeMin = range.allDay ? range.start : range.start.minus({ minutes: 2 });
      const timeMax = range.allDay ? range.end : range.end.plus({ minutes: 2 });

      const { data } = await calendar.events.list({
        calendarId: calendarId(account),
        timeMin: timeMin.toUTC().toISO() ?? undefined,
        timeMax: timeMax.toUTC().toISO() ?? undefined,
        singleEvents: true,
        maxResults: 10,
        fields: "items(id,status,summary,start,end)",
      });

      const matches = (data.items ?? []).filter((item) => isMatchingEvent(item, draft, range));
      const [first] = matches;
      if (!first?.id) return null;
      if (matches.length > 1) {
        logger.warn(
          { accountId: account.id, count: matches.length },
          "Multiple matching events found on retry existence-check; adopting the first",
        );
      }
      logger.info({ accountId: account.id, externalId: first.id }, "Recovered orphaned event on retry via existence-check");
      return { externalId: first.id };
    } catch (err) {
      logger.warn({ err, accountId: account.id }, "Existence-check before createEvent retry failed; proceeding to create (may duplicate)");
      return null;
    }
  },

  async deleteEvent(account: CalendarAccount, externalId: string): Promise<DeletedEvent> {
    try {
      const auth = await getValidGoogleClient(account);
      const calendar = createCalendarClient(auth);
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
      const calendar = createCalendarClient(auth);
      await calendar.calendarList.get({ calendarId: calendarId(account) });
      return true;
    } catch {
      return false;
    }
  },

  /** IDs of every event Google has in [timeMin, timeMax) — used to reconcile against our DB. */
  async listEventIds(account: CalendarAccount, timeMin: Date, timeMax: Date): Promise<Set<string>> {
    const auth = await getValidGoogleClient(account);
    const calendar = createCalendarClient(auth);
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
