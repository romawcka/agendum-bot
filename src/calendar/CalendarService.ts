import type { CalendarAccount } from "@prisma/client";
import type { Provider } from "../types/enums.js";
import { CalDavProvider } from "./providers/CalDavProvider.js";
import { GoogleCalendarProvider } from "./providers/GoogleCalendarProvider.js";
import type { CalendarProvider, CreatedEvent, EventDraft } from "./types.js";

const providers: Record<Provider, CalendarProvider> = {
  GOOGLE: GoogleCalendarProvider,
  CALDAV: CalDavProvider,
};

function getProvider(account: CalendarAccount): CalendarProvider {
  const provider = providers[account.provider as Provider];
  if (!provider) {
    throw new Error(`Неизвестный провайдер календаря: ${account.provider}`);
  }
  return provider;
}

/**
 * Единый интерфейс поверх Google/CalDAV (invariant 11) — вызывающий код
 * работает только с CalendarAccount и не знает, какой провайдер за ним стоит.
 */
export const CalendarService = {
  createEvent(account: CalendarAccount, draft: EventDraft): Promise<CreatedEvent> {
    return getProvider(account).createEvent(account, draft);
  },
  deleteEvent(account: CalendarAccount, externalId: string): Promise<void> {
    return getProvider(account).deleteEvent(account, externalId);
  },
  testConnection(account: CalendarAccount): Promise<boolean> {
    return getProvider(account).testConnection(account);
  },
};
