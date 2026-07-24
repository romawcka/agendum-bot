import { createDAVClient } from "tsdav";

export const ICLOUD_SERVER_URL = "https://caldav.icloud.com";

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
