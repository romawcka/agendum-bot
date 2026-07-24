import type { CalendarAccount } from "@prisma/client";
import type { Conversation } from "@grammyjs/conversations";
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { DateTime } from "luxon";
import { CalendarService } from "../../calendar/CalendarService.js";
import type { EventDraft } from "../../calendar/types.js";
import { prisma } from "../../config/db.js";
import { formatPreview, formatSuccessCard, type PreviewDraft } from "../../utils/format.js";
import { AppError } from "../../utils/errors.js";
import { parseDuration, parseManualDate, parseTime } from "../../utils/parsers.js";
import type { BotContext } from "../context.js";
import { buildConfirmKeyboard, buildRetryKeyboard, buildSuccessKeyboard } from "../keyboards/confirmKeyboard.js";
import { buildCalendarKeyboard, parseCalendarCallback } from "../keyboards/calendarPicker.js";
import { buildDurationKeyboard } from "../keyboards/durationKeyboard.js";

type WizardConversation = Conversation<BotContext, Context>;

const CANCEL = Symbol("wizard-cancel");
type Cancellable<T> = T | typeof CANCEL;

const CANCEL_TEXT = "Отменил. Ничего не создано.";
const CANCEL_BUTTON = { text: "❌ Отмена", data: "wizard:cancel" } as const;

interface WizardDraft {
  title: string;
  description?: string;
  allDay: boolean;
  date: string;
  startTime?: string;
  durationMinutes?: number;
  accountId: number;
}

type StepUpdate = { kind: "cancel" } | { kind: "text"; text: string } | { kind: "callback"; data: string };

/**
 * Every step goes through this. Handles /cancel (and the ❌ Отмена button)
 * uniformly, and intercepts /new mid-wizard to show the "resume or restart"
 * prompt from the UX doc's "Прочее" section instead of letting it fall
 * through as literal input to whatever field is currently being collected.
 */
async function nextStepUpdate(conversation: WizardConversation): Promise<StepUpdate> {
  for (;;) {
    const update = await conversation.waitFor(["message:text", "callback_query:data"]);

    const callbackData = update.callbackQuery?.data;
    if (callbackData !== undefined) {
      await update.answerCallbackQuery();
      if (callbackData === "wizard:cancel") {
        return { kind: "cancel" };
      }
      return { kind: "callback", data: callbackData };
    }

    const text = update.message?.text?.trim() ?? "";
    if (text === "/cancel") {
      return { kind: "cancel" };
    }
    if (text === "/new") {
      const keyboard = new InlineKeyboard()
        .text("▶️ Продолжить", "wizard:resume")
        .text("🔄 Начать заново", "wizard:restart");
      await update.reply("У тебя есть незаконченное событие. Продолжить или начать заново?", {
        reply_markup: keyboard,
      });
      const choice = await conversation.waitForCallbackQuery(["wizard:resume", "wizard:restart"]);
      await choice.answerCallbackQuery();
      if (choice.callbackQuery.data === "wizard:restart") {
        return { kind: "cancel" };
      }
      continue; // "Продолжить" — go back to waiting for the actual next input
    }

    return { kind: "text", text };
  }
}

function withCancel(keyboard: InlineKeyboard): InlineKeyboard {
  return keyboard.row().text(CANCEL_BUTTON.text, CANCEL_BUTTON.data);
}

async function collectTitle(conversation: WizardConversation, ctx: Context): Promise<Cancellable<string>> {
  await ctx.reply("📝 Название события?", { reply_markup: withCancel(new InlineKeyboard()) });

  for (;;) {
    const update = await nextStepUpdate(conversation);
    if (update.kind === "cancel") return CANCEL;
    if (update.kind === "callback") continue;

    const title = update.text.trim();
    if (!title) {
      await ctx.reply("Название не может быть пустым. Напиши, как назвать событие.");
      continue;
    }
    if (title.length > 200) {
      await ctx.reply("Слишком длинно. Уложись в 200 символов.");
      continue;
    }
    return title;
  }
}

async function collectDescription(conversation: WizardConversation, ctx: Context): Promise<Cancellable<string | undefined>> {
  const keyboard = withCancel(new InlineKeyboard().text("⏭ Пропустить", "wizard:skip"));
  await ctx.reply("Добавить описание?", { reply_markup: keyboard });

  for (;;) {
    const update = await nextStepUpdate(conversation);
    if (update.kind === "cancel") return CANCEL;
    if (update.kind === "callback") {
      if (update.data === "wizard:skip") return undefined;
      continue;
    }

    const description = update.text.trim();
    if (description.length > 2000) {
      await ctx.reply("Слишком длинно. Уложись в 2000 символов.");
      continue;
    }
    return description || undefined;
  }
}

async function collectDate(conversation: WizardConversation, ctx: Context): Promise<Cancellable<string>> {
  let yearMonth = DateTime.now().toFormat("yyyy-MM");

  async function renderCalendar(): Promise<void> {
    const today = DateTime.now();
    const quickRow = new InlineKeyboard()
      .text("Сегодня", `dp:day:${today.toFormat("yyyy-MM-dd")}`)
      .text("Завтра", `dp:day:${today.plus({ days: 1 }).toFormat("yyyy-MM-dd")}`);
    const keyboard = withCancel(quickRow.append(buildCalendarKeyboard(yearMonth)));
    await ctx.reply("📅 На какую дату?", { reply_markup: keyboard });
  }

  await renderCalendar();

  for (;;) {
    const update = await nextStepUpdate(conversation);
    if (update.kind === "cancel") return CANCEL;

    let candidate: string | null = null;

    if (update.kind === "callback") {
      const parsed = parseCalendarCallback(update.data);
      switch (parsed?.type) {
        case undefined:
        case "noop":
          continue;
        case "prev":
        case "next":
          yearMonth = parsed.yearMonth;
          await renderCalendar();
          continue;
        case "manual":
          await ctx.reply("Напиши дату в формате дд.мм.гггг, например 14.08.2026");
          continue;
        case "day":
          candidate = parsed.date;
          break;
      }
    } else {
      const manual = parseManualDate(update.text);
      if (!manual) {
        await ctx.reply("Не разобрал дату. Нужен формат дд.мм.гггг, например 14.08.2026");
        continue;
      }
      candidate = manual;
    }

    const isPast = DateTime.fromFormat(candidate, "yyyy-MM-dd") < DateTime.now().startOf("day");
    if (!isPast) {
      return candidate;
    }

    const confirmKeyboard = new InlineKeyboard().text("Да", "date:past:yes").text("Выбрать другую", "date:past:retry");
    await ctx.reply("⚠️ Это прошедшая дата. Всё равно создать?", { reply_markup: confirmKeyboard });
    const confirmUpdate = await nextStepUpdate(conversation);
    if (confirmUpdate.kind === "cancel") return CANCEL;
    if (confirmUpdate.kind === "callback" && confirmUpdate.data === "date:past:yes") {
      return candidate;
    }
    await renderCalendar();
  }
}

async function collectEventType(conversation: WizardConversation, ctx: Context): Promise<Cancellable<"allday" | "timed">> {
  const keyboard = withCancel(new InlineKeyboard().text("🌞 Весь день", "type:allday").text("🕐 Указать время", "type:timed"));
  await ctx.reply("Событие на весь день или на конкретное время?", { reply_markup: keyboard });

  for (;;) {
    const update = await nextStepUpdate(conversation);
    if (update.kind === "cancel") return CANCEL;
    if (update.kind === "callback") {
      if (update.data === "type:allday") return "allday";
      if (update.data === "type:timed") return "timed";
    }
  }
}

async function collectStartTime(conversation: WizardConversation, ctx: Context): Promise<Cancellable<string>> {
  await ctx.reply("🕐 Во сколько начало? Формат ЧЧ:ММ, например 15:00", {
    reply_markup: withCancel(new InlineKeyboard()),
  });

  for (;;) {
    const update = await nextStepUpdate(conversation);
    if (update.kind === "cancel") return CANCEL;
    if (update.kind === "callback") continue;

    const time = parseTime(update.text);
    if (!time) {
      await ctx.reply("Не разобрал время. Нужен формат ЧЧ:ММ, например 09:30");
      continue;
    }
    return time;
  }
}

async function collectDuration(conversation: WizardConversation, ctx: Context): Promise<Cancellable<number>> {
  await ctx.reply("⏱ Сколько длится?", { reply_markup: buildDurationKeyboard() });

  for (;;) {
    const update = await nextStepUpdate(conversation);
    if (update.kind === "cancel") return CANCEL;

    if (update.kind === "callback") {
      if (update.data === "dur:custom") {
        await ctx.reply("Напиши длительность: 45м, 2ч, 1ч30м");
        continue;
      }
      if (update.data.startsWith("dur:")) {
        return Number(update.data.slice("dur:".length));
      }
      continue;
    }

    const result = parseDuration(update.text);
    if (!result.ok) {
      await ctx.reply(
        result.reason === "too_long"
          ? "Максимум 24 часа. Для более долгих событий выбери «Весь день»."
          : "Не разобрал. Примеры: 45м, 2ч, 1ч30м",
      );
      continue;
    }
    return result.minutes;
  }
}

function accountLabel(account: CalendarAccount): string {
  return account.provider === "GOOGLE" ? "🟦 Google" : "🍎 iCloud";
}

async function collectDefaultAccount(
  conversation: WizardConversation,
  ctx: Context,
  accounts: CalendarAccount[],
): Promise<Cancellable<number>> {
  const keyboard = new InlineKeyboard();
  for (const account of accounts) {
    keyboard.text(accountLabel(account), `acct:${account.id}`);
  }
  await ctx.reply(
    "У тебя подключены Google и iCloud. В какой создавать события по умолчанию?\nПотом можно поменять в /settings.",
    { reply_markup: keyboard },
  );

  const validIds = new Set(accounts.map((a) => a.id));

  for (;;) {
    const update = await nextStepUpdate(conversation);
    if (update.kind === "cancel") return CANCEL;
    if (update.kind === "callback" && update.data.startsWith("acct:")) {
      const id = Number(update.data.slice("acct:".length));
      // Guards against a stale button, e.g. the account was disconnected via
      // /settings between rendering this keyboard and the user tapping it.
      if (validIds.has(id)) {
        return id;
      }
    }
  }
}

type EditField = "title" | "description" | "date" | "time" | "duration" | "calendar" | "back";

async function collectEditField(
  conversation: WizardConversation,
  ctx: Context,
  opts: { allDay: boolean; multipleAccounts: boolean },
): Promise<Cancellable<EditField>> {
  const keyboard = new InlineKeyboard().text("Название", "edit:title").text("Описание", "edit:description").row();
  keyboard.text("Дата", "edit:date");
  if (!opts.allDay) {
    keyboard.text("Время", "edit:time").text("Длительность", "edit:duration");
  }
  keyboard.row();
  if (opts.multipleAccounts) {
    keyboard.text("Календарь", "edit:calendar").row();
  }
  keyboard.text("⬅️ Назад к превью", "edit:back");

  await ctx.reply("Что поменять?", { reply_markup: keyboard });

  for (;;) {
    const update = await nextStepUpdate(conversation);
    if (update.kind === "cancel") return CANCEL;
    if (update.kind === "callback" && update.data.startsWith("edit:")) {
      return update.data.slice("edit:".length) as EditField;
    }
  }
}

function toEventDraft(draft: WizardDraft, timezone: string, reminderMinutes: number): EventDraft {
  return {
    title: draft.title,
    ...(draft.description ? { description: draft.description } : {}),
    timezone,
    allDay: draft.allDay,
    date: draft.date,
    ...(draft.startTime ? { startTime: draft.startTime } : {}),
    ...(draft.durationMinutes !== undefined ? { durationMinutes: draft.durationMinutes } : {}),
    reminderMinutes,
  };
}

function toPreviewDraft(draft: WizardDraft, reminderMinutes: number): PreviewDraft {
  return {
    title: draft.title,
    description: draft.description,
    allDay: draft.allDay,
    date: draft.date,
    startTime: draft.startTime,
    durationMinutes: draft.durationMinutes,
    reminderMinutes,
  };
}

export async function createEvent(conversation: WizardConversation, ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId === undefined) {
    return;
  }

  // Only plain, JSON-serializable fields — external()'s return value is persisted
  // into WizardSession, and the full Prisma User has a BigInt telegramId field.
  const { user, accounts } = await conversation.external(async () => {
    const dbUser = await prisma.user.findUniqueOrThrow({ where: { telegramId: BigInt(telegramId) } });
    const calendarAccounts = await prisma.calendarAccount.findMany({
      where: { userId: dbUser.id, isActive: true },
    });
    return {
      user: {
        id: dbUser.id,
        timezone: dbUser.timezone,
        defaultReminder: dbUser.defaultReminder,
        defaultAccountId: dbUser.defaultAccountId,
      },
      accounts: calendarAccounts,
    };
  });

  if (accounts.length === 0) {
    await ctx.reply("Сначала подключи календарь: /settings");
    return;
  }
  const timezone = user.timezone;
  if (!timezone) {
    await ctx.reply("Сначала заверши настройку часового пояса: /start");
    return;
  }
  const reminderMinutes = user.defaultReminder;

  const titleResult = await collectTitle(conversation, ctx);
  if (titleResult === CANCEL) return void (await ctx.reply(CANCEL_TEXT));

  const descriptionResult = await collectDescription(conversation, ctx);
  if (descriptionResult === CANCEL) return void (await ctx.reply(CANCEL_TEXT));

  const dateResult = await collectDate(conversation, ctx);
  if (dateResult === CANCEL) return void (await ctx.reply(CANCEL_TEXT));

  const typeResult = await collectEventType(conversation, ctx);
  if (typeResult === CANCEL) return void (await ctx.reply(CANCEL_TEXT));

  const draft: WizardDraft = {
    title: titleResult,
    description: descriptionResult,
    date: dateResult,
    allDay: typeResult === "allday",
    accountId: 0,
  };

  if (!draft.allDay) {
    const timeResult = await collectStartTime(conversation, ctx);
    if (timeResult === CANCEL) return void (await ctx.reply(CANCEL_TEXT));
    draft.startTime = timeResult;

    const durationResult = await collectDuration(conversation, ctx);
    if (durationResult === CANCEL) return void (await ctx.reply(CANCEL_TEXT));
    draft.durationMinutes = durationResult;
  }

  if (accounts.length === 1) {
    draft.accountId = accounts[0]!.id;
  } else if (user.defaultAccountId && accounts.some((a) => a.id === user.defaultAccountId)) {
    draft.accountId = user.defaultAccountId;
  } else {
    const chosen = await collectDefaultAccount(conversation, ctx, accounts);
    if (chosen === CANCEL) return void (await ctx.reply(CANCEL_TEXT));
    draft.accountId = chosen;
    await conversation.external(() =>
      prisma.user.update({ where: { id: user.id }, data: { defaultAccountId: chosen } }),
    );
  }

  // Превью + «Изменить» + «Отправить»/«Отменить»
  for (;;) {
    const account = accounts.find((a) => a.id === draft.accountId)!;
    await ctx.reply(formatPreview(toPreviewDraft(draft, reminderMinutes), timezone, account.label), {
      reply_markup: buildConfirmKeyboard(),
    });

    const action = await nextStepUpdate(conversation);
    if (action.kind === "cancel") return void (await ctx.reply(CANCEL_TEXT));
    if (action.kind !== "callback") continue;

    if (action.data === "wizard:cancel") {
      await ctx.reply(CANCEL_TEXT);
      return;
    }

    if (action.data === "wizard:edit") {
      const field = await collectEditField(conversation, ctx, {
        allDay: draft.allDay,
        multipleAccounts: accounts.length > 1,
      });
      if (field === CANCEL) return void (await ctx.reply(CANCEL_TEXT));
      if (field === "back") continue;

      if (field === "title") {
        const result = await collectTitle(conversation, ctx);
        if (result === CANCEL) return void (await ctx.reply(CANCEL_TEXT));
        draft.title = result;
      } else if (field === "description") {
        const result = await collectDescription(conversation, ctx);
        if (result === CANCEL) return void (await ctx.reply(CANCEL_TEXT));
        draft.description = result;
      } else if (field === "date") {
        const result = await collectDate(conversation, ctx);
        if (result === CANCEL) return void (await ctx.reply(CANCEL_TEXT));
        draft.date = result;
      } else if (field === "time") {
        const result = await collectStartTime(conversation, ctx);
        if (result === CANCEL) return void (await ctx.reply(CANCEL_TEXT));
        draft.startTime = result;
      } else if (field === "duration") {
        const result = await collectDuration(conversation, ctx);
        if (result === CANCEL) return void (await ctx.reply(CANCEL_TEXT));
        draft.durationMinutes = result;
      } else if (field === "calendar") {
        const result = await collectDefaultAccount(conversation, ctx, accounts);
        if (result === CANCEL) return void (await ctx.reply(CANCEL_TEXT));
        draft.accountId = result;
        await conversation.external(() =>
          prisma.user.update({ where: { id: user.id }, data: { defaultAccountId: result } }),
        );
      }
      continue;
    }

    if (action.data === "wizard:submit") {
      break;
    }
  }

  // Отправка — с гашением кнопок и ретраем при ошибке (invariant 6, tech spec §12)
  const account = accounts.find((a) => a.id === draft.accountId)!;
  const eventDraft = toEventDraft(draft, timezone, reminderMinutes);

  for (;;) {
    await ctx.reply("⏳ Создаю событие…");

    try {
      const created = await CalendarService.createEvent(account, eventDraft);
      const savedEvent = await conversation.external(() =>
        prisma.event.create({
          data: {
            userId: user.id,
            accountId: account.id,
            externalId: created.externalId,
            title: draft.title,
            description: draft.description,
            allDay: draft.allDay,
            startsAt: DateTime.fromFormat(`${draft.date}${draft.allDay ? "" : ` ${draft.startTime}`}`, draft.allDay ? "yyyy-MM-dd" : "yyyy-MM-dd HH:mm", { zone: timezone }).toUTC().toJSDate(),
            endsAt: draft.allDay
              ? null
              : DateTime.fromFormat(`${draft.date} ${draft.startTime}`, "yyyy-MM-dd HH:mm", { zone: timezone })
                  .plus({ minutes: draft.durationMinutes ?? 0 })
                  .toUTC()
                  .toJSDate(),
            timezone,
            reminderMinutes,
            status: "ACTIVE",
          },
        }),
      );

      await ctx.reply(formatSuccessCard(toPreviewDraft(draft, reminderMinutes), timezone, account.label), {
        reply_markup: buildSuccessKeyboard(savedEvent.id),
      });
      return;
    } catch (err) {
      if (err instanceof AppError && err.code !== "google_create_failed" && err.code !== "caldav_create_failed") {
        await ctx.reply(`❌ ${err.userMessage}`);
        return;
      }

      await ctx.reply(
        "❌ Не получилось создать событие: календарь не отвечает.\nЧерновик сохранён — можно попробовать ещё раз.",
        { reply_markup: buildRetryKeyboard() },
      );

      const retry = await nextStepUpdate(conversation);
      if (retry.kind === "cancel") return void (await ctx.reply(CANCEL_TEXT));
      if (retry.kind === "callback" && retry.data === "wizard:cancel") {
        await ctx.reply(CANCEL_TEXT);
        return;
      }
      // wizard:retry (or anything else) loops back and tries again
    }
  }
}
