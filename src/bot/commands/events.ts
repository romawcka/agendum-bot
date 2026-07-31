import { InlineKeyboard } from "grammy";
import { DateTime } from "luxon";
import { GoogleCalendarProvider } from "../../calendar/providers/GoogleCalendarProvider.js";
import { prisma } from "../../config/db.js";
import { logger } from "../../config/logger.js";
import { getCached, invalidate, setCached, type EventWithAccount } from "../../services/eventsCache.js";
import { toUserMessage } from "../../utils/errors.js";
import type { BotContext } from "../context.js";

const PAGE_SIZE = 5;
const LOOKAHEAD_DAYS = 30;

async function fetchUpcomingEventsFromDb(userId: number, timezone: string): Promise<EventWithAccount[]> {
  const now = DateTime.now().setZone(timezone);
  return prisma.event.findMany({
    where: {
      userId,
      status: "ACTIVE",
      startsAt: { gte: now.toUTC().toJSDate(), lte: now.plus({ days: LOOKAHEAD_DAYS }).toUTC().toJSDate() },
    },
    orderBy: { startsAt: "asc" },
    include: { account: true },
  });
}

/**
 * Only called from the /events entry point (eventsCommand). Reconciles the DB
 * against Google once per minute (gated by the cache TTL) — the only place
 * that can mark events DELETED because they vanished from Google directly
 * (not through the bot). Internal navigation (pagination, delete flows) must
 * never trigger this — see getEventsWithoutReconcile.
 */
async function getEventsForUser(userId: number, timezone: string): Promise<EventWithAccount[]> {
  const cached = getCached(userId);
  if (cached) return cached;

  const dbEvents = await fetchUpcomingEventsFromDb(userId, timezone);
  const account = dbEvents[0]?.account;

  if (account?.isActive) {
    try {
      const now = DateTime.now().setZone(timezone);
      const googleIds = await GoogleCalendarProvider.listEventIds(
        account,
        now.toUTC().toJSDate(),
        now.plus({ days: LOOKAHEAD_DAYS }).toUTC().toJSDate(),
      );
      const staleIds = dbEvents.filter((event) => !googleIds.has(event.externalId)).map((event) => event.id);
      if (staleIds.length > 0) {
        await prisma.event.updateMany({ where: { id: { in: staleIds } }, data: { status: "DELETED" } });
      }
      const reconciled = dbEvents.filter((event) => !staleIds.includes(event.id));
      setCached(userId, reconciled);
      return reconciled;
    } catch (err) {
      logger.warn({ err, userId }, "Failed to reconcile events with Google Calendar, using DB state as-is");
    }
  }

  setCached(userId, dbEvents);
  return dbEvents;
}

/** Pagination/delete flows: read the cache filled by the last /events open, or plain DB — never Google. */
async function getEventsWithoutReconcile(userId: number, timezone: string): Promise<EventWithAccount[]> {
  const cached = getCached(userId);
  if (cached) return cached;
  const dbEvents = await fetchUpcomingEventsFromDb(userId, timezone);
  setCached(userId, dbEvents);
  return dbEvents;
}

function formatEventLine(index: number, event: EventWithAccount, timezone: string): string {
  const start = DateTime.fromJSDate(event.startsAt).setZone(timezone);
  const dateStr = start.toFormat("dd.MM");
  const timePart = event.allDay
    ? "весь день"
    : `${start.toFormat("HH:mm")} – ${DateTime.fromJSDate(event.endsAt ?? event.startsAt).setZone(timezone).toFormat("HH:mm")}`;
  return `${index}. ${event.title}\n   ${dateStr}, ${timePart} · Google`;
}

function formatEventDateLine(event: EventWithAccount, timezone: string): string {
  const start = DateTime.fromJSDate(event.startsAt).setZone(timezone);
  if (event.allDay) {
    return `${start.toFormat("dd.MM.yyyy")}, весь день`;
  }
  const end = DateTime.fromJSDate(event.endsAt ?? event.startsAt).setZone(timezone);
  return `${start.toFormat("dd.MM.yyyy")}, ${start.toFormat("HH:mm")} – ${end.toFormat("HH:mm")}`;
}

function buildEventsKeyboard(
  events: EventWithAccount[],
  from: number,
  page: number,
  totalPages: number,
  totalCount: number,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  events.forEach((event, i) => {
    keyboard.text(`🗑 ${from + i}`, `events:del:${event.id}:${page}`);
  });
  keyboard.row();
  if (page > 1) {
    keyboard.text("◀️ Назад", `events:page:${page - 1}`);
  }
  if (page < totalPages) {
    keyboard.text("Вперед ▶️", `events:page:${page + 1}`);
  }
  if (totalCount > 1) {
    keyboard.row().text("🗑 Видалити всі", `events:delall:request:${page}`);
  }
  return keyboard;
}

async function renderEventsPage(ctx: BotContext, page: number, edit: boolean, reconcile: boolean): Promise<void> {
  const timezone = ctx.dbUser.timezone;
  if (!timezone) {
    return;
  }

  const all = reconcile
    ? await getEventsForUser(ctx.dbUser.id, timezone)
    : await getEventsWithoutReconcile(ctx.dbUser.id, timezone);

  if (all.length === 0) {
    const text = "Поки немає майбутніх подій, створених через бота.\n/new — створити першу";
    if (edit) {
      await ctx.editMessageText(text).catch(() => ctx.reply(text));
    } else {
      await ctx.reply(text);
    }
    return;
  }

  const totalPages = Math.ceil(all.length / PAGE_SIZE);
  const clampedPage = Math.min(Math.max(page, 1), totalPages);
  const from = (clampedPage - 1) * PAGE_SIZE;
  const pageEvents = all.slice(from, from + PAGE_SIZE);
  const to = from + pageEvents.length;

  const text = [
    `📆 Найближчі події (${from + 1}–${to} з ${all.length})`,
    "",
    pageEvents.map((event, i) => formatEventLine(from + i + 1, event, timezone)).join("\n\n"),
  ].join("\n");

  const keyboard = buildEventsKeyboard(pageEvents, from + 1, clampedPage, totalPages, all.length);

  if (edit) {
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => ctx.reply(text, { reply_markup: keyboard }));
  } else {
    await ctx.reply(text, { reply_markup: keyboard });
  }
}

export async function eventsCommand(ctx: BotContext): Promise<void> {
  await renderEventsPage(ctx, 1, false, true);
}

export async function eventsPageCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  const page = Number(ctx.callbackQuery?.data?.split(":")[2]);
  await renderEventsPage(ctx, Number.isFinite(page) ? page : 1, true, false);
}

export async function eventDeleteRequestCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  const parts = ctx.callbackQuery?.data?.split(":") ?? [];
  const eventId = Number(parts[2]);
  const page = Number(parts[3]) || 1;

  const event = await prisma.event.findUnique({ where: { id: eventId }, include: { account: true } });
  if (!event || event.userId !== ctx.dbUser.id || event.status !== "ACTIVE") {
    await renderEventsPage(ctx, page, true, false);
    return;
  }

  const timezone = ctx.dbUser.timezone;
  if (!timezone) return;

  const text = `Видалити подію?\n\n${event.title}\n${formatEventDateLine(event, timezone)}`;
  const keyboard = new InlineKeyboard()
    .text("🗑 Так, видалити", `events:confirm:${event.id}:${page}`)
    .row()
    .text("⬅️ Скасувати", `events:page:${page}`);

  await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => ctx.reply(text, { reply_markup: keyboard }));
}

export async function eventDeleteConfirmCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  const parts = ctx.callbackQuery?.data?.split(":") ?? [];
  const eventId = Number(parts[2]);
  const page = Number(parts[3]) || 1;

  const event = await prisma.event.findUnique({ where: { id: eventId }, include: { account: true } });
  if (!event || event.userId !== ctx.dbUser.id || event.status !== "ACTIVE") {
    await renderEventsPage(ctx, page, true, false);
    return;
  }

  try {
    const result = await GoogleCalendarProvider.deleteEvent(event.account, event.externalId);
    await prisma.event.update({ where: { id: event.id }, data: { status: "DELETED" } });
    invalidate(ctx.dbUser.id);

    const text = result.alreadyDeleted
      ? "Цю подію вже видалено з календаря. Прибрав зі списку."
      : "✅ Подію видалено";
    await ctx.editMessageText(text).catch(() => ctx.reply(text));
  } catch (err) {
    logger.error({ err, eventId: event.id }, "Failed to delete event");
    const text = `❌ ${toUserMessage(err)}`;
    await ctx.editMessageText(text).catch(() => ctx.reply(text));
    return;
  }

  await renderEventsPage(ctx, page, false, false);
}

export async function eventsDeleteAllRequestCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  const parts = ctx.callbackQuery?.data?.split(":") ?? [];
  const page = Number(parts[3]) || 1;

  const timezone = ctx.dbUser.timezone;
  if (!timezone) return;

  const all = await getEventsWithoutReconcile(ctx.dbUser.id, timezone);
  if (all.length === 0) {
    await renderEventsPage(ctx, page, true, false);
    return;
  }

  const text = `Видалити всі ${all.length} подій із календаря?\n\nЦю дію не можна скасувати.`;
  const keyboard = new InlineKeyboard()
    .text("Так, видалити всі", `events:delall:confirm:${page}`)
    .row()
    .text("⬅️ Скасувати", `events:page:${page}`);

  await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => ctx.reply(text, { reply_markup: keyboard }));
}

export async function eventsDeleteAllConfirmCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  const parts = ctx.callbackQuery?.data?.split(":") ?? [];
  const page = Number(parts[3]) || 1;

  const timezone = ctx.dbUser.timezone;
  if (!timezone) return;

  await ctx.editMessageText("⏳ Видаляю події…").catch(() => ctx.reply("⏳ Видаляю події…"));

  const all = await fetchUpcomingEventsFromDb(ctx.dbUser.id, timezone);
  if (all.length === 0) {
    invalidate(ctx.dbUser.id);
    await renderEventsPage(ctx, page, false, false);
    return;
  }

  const outcomes = await Promise.allSettled(
    all.map(async (event) => {
      await GoogleCalendarProvider.deleteEvent(event.account, event.externalId);
      return event.id;
    }),
  );

  const succeededIds: number[] = [];
  let failedCount = 0;
  for (const outcome of outcomes) {
    if (outcome.status === "fulfilled") {
      succeededIds.push(outcome.value);
    } else {
      failedCount += 1;
      logger.error({ err: outcome.reason }, "Failed to delete event during delete-all");
    }
  }

  if (succeededIds.length > 0) {
    await prisma.event.updateMany({ where: { id: { in: succeededIds } }, data: { status: "DELETED" } });
  }
  invalidate(ctx.dbUser.id);

  const text =
    failedCount === 0
      ? `✅ Видалено ${succeededIds.length} подій`
      : `✅ Видалено ${succeededIds.length} з ${all.length}. ${failedCount} не вдалося видалити — спробуй ще раз пізніше.`;
  await ctx.reply(text);

  await renderEventsPage(ctx, page, false, false);
}
