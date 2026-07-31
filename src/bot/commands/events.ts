import type { CalendarAccount, Event } from "@prisma/client";
import { InlineKeyboard } from "grammy";
import { DateTime } from "luxon";
import { GoogleCalendarProvider } from "../../calendar/providers/GoogleCalendarProvider.js";
import { prisma } from "../../config/db.js";
import { logger } from "../../config/logger.js";
import { toUserMessage } from "../../utils/errors.js";
import type { BotContext } from "../context.js";

const PAGE_SIZE = 5;
const LOOKAHEAD_DAYS = 30;

type EventWithAccount = Event & { account: CalendarAccount };

async function fetchUpcomingEvents(userId: number, timezone: string): Promise<EventWithAccount[]> {
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

function buildEventsKeyboard(events: EventWithAccount[], from: number, page: number, totalPages: number): InlineKeyboard {
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
  return keyboard;
}

async function renderEventsPage(ctx: BotContext, page: number, edit: boolean): Promise<void> {
  const timezone = ctx.dbUser.timezone;
  if (!timezone) {
    return;
  }

  const all = await fetchUpcomingEvents(ctx.dbUser.id, timezone);

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

  const keyboard = buildEventsKeyboard(pageEvents, from + 1, clampedPage, totalPages);

  if (edit) {
    await ctx.editMessageText(text, { reply_markup: keyboard }).catch(() => ctx.reply(text, { reply_markup: keyboard }));
  } else {
    await ctx.reply(text, { reply_markup: keyboard });
  }
}

export async function eventsCommand(ctx: BotContext): Promise<void> {
  await renderEventsPage(ctx, 1, false);
}

export async function eventsPageCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  const page = Number(ctx.callbackQuery?.data?.split(":")[2]);
  await renderEventsPage(ctx, Number.isFinite(page) ? page : 1, true);
}

export async function eventDeleteRequestCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  const parts = ctx.callbackQuery?.data?.split(":") ?? [];
  const eventId = Number(parts[2]);
  const page = Number(parts[3]) || 1;

  const event = await prisma.event.findUnique({ where: { id: eventId }, include: { account: true } });
  if (!event || event.userId !== ctx.dbUser.id || event.status !== "ACTIVE") {
    await renderEventsPage(ctx, page, true);
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
    await renderEventsPage(ctx, page, true);
    return;
  }

  try {
    const result = await GoogleCalendarProvider.deleteEvent(event.account, event.externalId);
    await prisma.event.update({ where: { id: event.id }, data: { status: "DELETED" } });

    const text = result.alreadyDeleted
      ? "Цю подію вже видалено з календаря. Прибрав зі списку."
      : "✅ Подію видалено";
    await ctx.editMessageText(text).catch(() => ctx.reply(text));
  } catch (err) {
    logger.error({ err, eventId: event.id }, "Не удалось удалить событие");
    const text = `❌ ${toUserMessage(err)}`;
    await ctx.editMessageText(text).catch(() => ctx.reply(text));
    return;
  }

  await renderEventsPage(ctx, page, false);
}
