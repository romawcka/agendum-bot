import type { CalendarAccount } from "@prisma/client";
import { prisma } from "../config/db.js";

/**
 * The account a new event should go into when the user hasn't picked one explicitly for
 * this particular event (the wizard's per-event "Calendar" edit override): the user's
 * marked default if it's still active, else — when exactly one other active account
 * exists — that one. A genuinely ambiguous case (2+ active accounts, no valid default —
 * only reachable by disconnecting the default while others stay active) falls back to
 * the oldest connected account; the user can set an explicit default in /settings.
 */
export async function resolveDefaultAccount(userId: number): Promise<CalendarAccount | null> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.defaultAccountId !== null) {
    const account = await prisma.calendarAccount.findUnique({ where: { id: user.defaultAccountId } });
    if (account?.isActive) {
      return account;
    }
  }
  const [fallback] = await prisma.calendarAccount.findMany({
    where: { userId, isActive: true },
    orderBy: { createdAt: "asc" },
    take: 1,
  });
  return fallback ?? null;
}

/** Every active Google account for this user, oldest first — used by the wizard's per-event "Calendar" override and the /settings account list. */
export async function listActiveAccounts(userId: number): Promise<CalendarAccount[]> {
  return prisma.calendarAccount.findMany({ where: { userId, isActive: true }, orderBy: { createdAt: "asc" } });
}
