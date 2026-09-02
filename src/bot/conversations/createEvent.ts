import type { CalendarAccount } from "@prisma/client";
import type { Conversation } from "@grammyjs/conversations";
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { DateTime } from "luxon";
import { GoogleCalendarProvider } from "../../calendar/providers/GoogleCalendarProvider.js";
import type { EventDraft } from "../../calendar/types.js";
import { prisma } from "../../config/db.js";
import { invalidate } from "../../services/eventsCache.js";
import { formatPreview, formatSuccessCard, type PreviewDraft } from "../../utils/format.js";
import { AppError } from "../../utils/errors.js";
import { parseDuration, parseManualDate, parseTime } from "../../utils/parsers.js";
import type { BotContext } from "../context.js";
import { buildConfirmKeyboard, buildRetryKeyboard, buildSuccessKeyboard } from "../keyboards/confirmKeyboard.js";
import { buildCalendarKeyboard, parseCalendarCallback } from "../keyboards/calendarPicker.js";
import { buildDurationKeyboard } from "../keyboards/durationKeyboard.js";
import { listActiveAccounts, resolveDefaultAccount } from "../../services/CalendarAccountService.js";
import { connectGoogleCalendar } from "./connectGoogle.js";

type WizardConversation = Conversation<BotContext, Context>;

const CANCEL = Symbol("wizard-cancel");
type Cancellable<T> = T | typeof CANCEL;

const CANCEL_TEXT = "Скасував. Нічого не створено.";
const CANCEL_BUTTON = { text: "❌ Скасувати", data: "wizard:cancel" } as const;

interface WizardDraft {
  title: string;
  description?: string;
  allDay: boolean;
  date: string;
  startTime?: string;
  durationMinutes?: number;
}

type StepUpdate = { kind: "cancel" } | { kind: "text"; text: string } | { kind: "callback"; data: string };

/**
 * Every step goes through this. Handles /cancel (and the ❌ Cancel button)
 * uniformly, intercepts /new mid-wizard to show the "resume or restart"
 * prompt from the UX doc's "Other" section, and swallows any other slash
 * command generically — none of them should ever fall through as literal
 * input to whatever field is currently being collected (e.g. sending
 * /events while the bot is waiting for a title must not silently become
 * the title just because it's non-empty text).
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
        .text("▶️ Продовжити", "wizard:resume")
        .row()
        .text("🔄 Почати заново", "wizard:restart");
      await update.reply("У тебе є незакінчена подія. Продовжити чи почати заново?", {
        reply_markup: keyboard,
      });
      const choice = await conversation.waitForCallbackQuery(["wizard:resume", "wizard:restart"]);
      await choice.answerCallbackQuery();
      if (choice.callbackQuery.data === "wizard:restart") {
        return { kind: "cancel" };
      }
      continue; // "Resume" — go back to waiting for the actual next input
    }
    if (text.startsWith("/")) {
      await update.reply("Спочатку заверши створення події або натисни «Скасувати».");
      continue;
    }

    return { kind: "text", text };
  }
}

function withCancel(keyboard: InlineKeyboard): InlineKeyboard {
  return keyboard.row().text(CANCEL_BUTTON.text, CANCEL_BUTTON.data);
}

async function collectTitle(conversation: WizardConversation, ctx: Context): Promise<Cancellable<string>> {
  await ctx.reply("📝 Назва події?", { reply_markup: withCancel(new InlineKeyboard()) });

  for (;;) {
    const update = await nextStepUpdate(conversation);
    if (update.kind === "cancel") return CANCEL;
    if (update.kind === "callback") continue;

    const title = update.text.trim();
    if (!title) {
      await ctx.reply("Назва не може бути порожньою. Напиши, як назвати подію.");
      continue;
    }
    if (title.length > 200) {
      await ctx.reply("Занадто довго. Вкладися у 200 символів.");
      continue;
    }
    return title;
  }
}

async function collectDescription(conversation: WizardConversation, ctx: Context): Promise<Cancellable<string | undefined>> {
  const keyboard = withCancel(new InlineKeyboard().text("⏭ Пропустити", "wizard:skip"));
  await ctx.reply("Додати опис?", { reply_markup: keyboard });

  for (;;) {
    const update = await nextStepUpdate(conversation);
    if (update.kind === "cancel") return CANCEL;
    if (update.kind === "callback") {
      if (update.data === "wizard:skip") return undefined;
      continue;
    }

    const description = update.text.trim();
    if (description.length > 2000) {
      await ctx.reply("Занадто довго. Вкладися у 2000 символів.");
      continue;
    }
    return description || undefined;
  }
}

const MANUAL_DATE_HINT = "Напиши дату у форматі ДД/ММ/РРРР, наприклад 14/08/2026";
const MANUAL_DATE_INVALID = "Не розібрав дату. Потрібен формат ДД/ММ/РРРР, наприклад 14/08/2026";

async function collectDate(conversation: WizardConversation, ctx: Context): Promise<Cancellable<string>> {
  let yearMonth = DateTime.now().toFormat("yyyy-MM");
  let mode: "menu" | "calendar" = "menu";

  async function renderMenu(): Promise<void> {
    const keyboard = withCancel(
      new InlineKeyboard()
        .text("Сьогодні", "date:today")
        .row()
        .text("Завтра", "date:tomorrow")
        .row()
        .text("Своя дата", "date:custom")
        .row()
        .text("📅 Календар", "date:calendar"),
    );
    await ctx.reply("📅 На яку дату?", { reply_markup: keyboard });
  }

  async function renderCalendar(): Promise<void> {
    await ctx.reply("📅 На яку дату?", { reply_markup: withCancel(buildCalendarKeyboard(yearMonth)) });
  }

  await renderMenu();

  for (;;) {
    const update = await nextStepUpdate(conversation);
    if (update.kind === "cancel") return CANCEL;

    let candidate: string | null = null;

    if (update.kind === "text") {
      // Free-text date entry works regardless of menu/calendar mode.
      const manual = parseManualDate(update.text);
      if (!manual) {
        await ctx.reply(MANUAL_DATE_INVALID);
        continue;
      }
      candidate = manual;
    } else if (mode === "menu") {
      if (update.data === "date:today") {
        candidate = DateTime.now().toFormat("yyyy-MM-dd");
      } else if (update.data === "date:tomorrow") {
        candidate = DateTime.now().plus({ days: 1 }).toFormat("yyyy-MM-dd");
      } else if (update.data === "date:custom") {
        await ctx.reply(MANUAL_DATE_HINT);
        continue;
      } else if (update.data === "date:calendar") {
        mode = "calendar";
        await renderCalendar();
        continue;
      } else {
        continue;
      }
    } else {
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
          await ctx.reply(MANUAL_DATE_HINT);
          continue;
        case "day":
          candidate = parsed.date;
          break;
      }
    }

    const isPast = DateTime.fromFormat(candidate, "yyyy-MM-dd") < DateTime.now().startOf("day");
    if (!isPast) {
      return candidate;
    }

    const confirmKeyboard = new InlineKeyboard()
      .text("Так", "date:past:yes")
      .row()
      .text("Вибрати іншу", "date:past:retry");
    await ctx.reply("⚠️ Це минула дата. Все одно створити?", { reply_markup: confirmKeyboard });
    const confirmUpdate = await nextStepUpdate(conversation);
    if (confirmUpdate.kind === "cancel") return CANCEL;
    if (confirmUpdate.kind === "callback" && confirmUpdate.data === "date:past:yes") {
      return candidate;
    }
    if (mode === "calendar") {
      await renderCalendar();
    } else {
      await renderMenu();
    }
  }
}

async function collectEventType(conversation: WizardConversation, ctx: Context): Promise<Cancellable<"allday" | "timed">> {
  const keyboard = withCancel(
    new InlineKeyboard().text("🌞 Весь день", "type:allday").row().text("🕐 Вказати час", "type:timed"),
  );
  await ctx.reply("Подія на весь день чи на конкретний час?", { reply_markup: keyboard });

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
  await ctx.reply("🕐 О котрій початок? Формат ГГ:ХВ, наприклад 15:00", {
    reply_markup: withCancel(new InlineKeyboard()),
  });

  for (;;) {
    const update = await nextStepUpdate(conversation);
    if (update.kind === "cancel") return CANCEL;
    if (update.kind === "callback") continue;

    const time = parseTime(update.text);
    if (!time) {
      await ctx.reply("Не розібрав час. Потрібен формат ГГ:ХВ, наприклад 09:30");
      continue;
    }
    return time;
  }
}

async function collectDuration(conversation: WizardConversation, ctx: Context): Promise<Cancellable<number>> {
  await ctx.reply("⏱ Скільки триває?", { reply_markup: buildDurationKeyboard() });

  for (;;) {
    const update = await nextStepUpdate(conversation);
    if (update.kind === "cancel") return CANCEL;

    if (update.kind === "callback") {
      if (update.data === "dur:custom") {
        await ctx.reply("Напиши тривалість: 45хв, 2год, 1год30хв");
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
          ? "Максимум 24 години. Для довших подій вибери «Весь день»."
          : "Не розібрав. Приклади: 45хв, 2год, 1год30хв",
      );
      continue;
    }
    return result.minutes;
  }
}

type EditField = "title" | "description" | "date" | "time" | "duration" | "calendar" | "back";

async function collectEditField(
  conversation: WizardConversation,
  ctx: Context,
  opts: { allDay: boolean; showCalendarOption: boolean },
): Promise<Cancellable<EditField>> {
  const keyboard = new InlineKeyboard()
    .text("Назва", "edit:title")
    .row()
    .text("Опис", "edit:description")
    .row()
    .text("Дата", "edit:date")
    .row();
  if (!opts.allDay) {
    keyboard.text("Час", "edit:time").row().text("Тривалість", "edit:duration").row();
  }
  if (opts.showCalendarOption) {
    keyboard.text("📅 Календар", "edit:calendar").row();
  }
  keyboard.text("⬅️ Назад до перегляду", "edit:back");

  await ctx.reply("Що поміняти?", { reply_markup: keyboard });

  for (;;) {
    const update = await nextStepUpdate(conversation);
    if (update.kind === "cancel") return CANCEL;
    if (update.kind === "callback" && update.data.startsWith("edit:")) {
      return update.data.slice("edit:".length) as EditField;
    }
  }
}

/** Per-event override of which connected Google account this event goes into — the user's default is unaffected. */
async function collectAccountOverride(
  conversation: WizardConversation,
  ctx: Context,
  accounts: CalendarAccount[],
): Promise<Cancellable<CalendarAccount>> {
  let keyboard = new InlineKeyboard();
  accounts.forEach((acc, i) => {
    if (i > 0) keyboard = keyboard.row();
    keyboard = keyboard.text(acc.label, `edit:calacct:${acc.id}`);
  });
  await ctx.reply("Який календар використати для цієї події?", { reply_markup: withCancel(keyboard) });

  for (;;) {
    const update = await nextStepUpdate(conversation);
    if (update.kind === "cancel") return CANCEL;
    if (update.kind !== "callback" || !update.data.startsWith("edit:calacct:")) continue;

    const id = Number(update.data.slice("edit:calacct:".length));
    const chosen = accounts.find((a) => a.id === id);
    if (chosen) return chosen;
  }
}

function reviveAccountDates(raw: CalendarAccount): CalendarAccount {
  return { ...raw, expiresAt: raw.expiresAt ? new Date(raw.expiresAt) : null, createdAt: new Date(raw.createdAt) };
}

/** Re-fetches the account fresh from the DB, reviving the JSON-degraded Date fields (see the comment in createEvent). */
async function fetchAccount(conversation: WizardConversation, userId: number): Promise<CalendarAccount | null> {
  const rawAccount = await conversation.external(() => resolveDefaultAccount(userId));
  return rawAccount ? reviveAccountDates(rawAccount) : null;
}

/** Re-fetches one specific account by id — used to re-validate a per-event "Calendar" override at submission time. */
async function fetchAccountById(conversation: WizardConversation, id: number): Promise<CalendarAccount | null> {
  const rawAccount = await conversation.external(() => prisma.calendarAccount.findUnique({ where: { id } }));
  return rawAccount ? reviveAccountDates(rawAccount) : null;
}

/** Fresh list of active accounts, date-revived (see the JSON-replay comment in createEvent) — used by the "Calendar" edit override. */
async function fetchActiveAccounts(conversation: WizardConversation, userId: number): Promise<CalendarAccount[]> {
  const raw = await conversation.external(() => listActiveAccounts(userId));
  return raw.map(reviveAccountDates);
}

/**
 * Blocks right before the event is actually written to Google — the only point a
 * connected calendar is truly required (see feature 03: everything up to here works
 * with no calendar connected at all). Shows the connect link and waits, in place,
 * inside the wizard's own conversation, so the caller can just re-fetch the account
 * and loop back to the preview screen — nothing collected so far is lost or re-asked.
 */
async function waitForCalendarConnection(conversation: WizardConversation, ctx: Context): Promise<Cancellable<"connected">> {
  await ctx.reply("Щоб надіслати подію, спочатку підключи Google Calendar:");
  await connectGoogleCalendar(conversation, ctx, { resumeWizard: true });

  for (;;) {
    const update = await nextStepUpdate(conversation);
    if (update.kind === "cancel") return CANCEL;
    if (update.kind === "callback") {
      if (update.data === "wizard:calendar_connected") return "connected";
      continue;
    }
    await ctx.reply("Спочатку підключи календар, натиснувши кнопку вище, або натисни «Скасувати».");
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
  // into WizardSession as JSON. The full Prisma User has a BigInt telegramId
  // field (would crash JSON.stringify), and CalendarAccount's Date fields
  // (expiresAt, createdAt) silently degrade to strings on JSON.parse — revived
  // right below, since on serverless nearly every wizard step is a *replay*
  // from that stored JSON, not a fresh Prisma query.
  const { user, account: rawAccount } = await conversation.external(async () => {
    const dbUser = await prisma.user.findUniqueOrThrow({ where: { telegramId: BigInt(telegramId) } });
    const calendarAccount = await resolveDefaultAccount(dbUser.id);
    return {
      user: {
        id: dbUser.id,
        timezone: dbUser.timezone,
        defaultReminder: dbUser.defaultReminder,
      },
      account: calendarAccount,
    };
  });
  let account: CalendarAccount | null = rawAccount ? reviveAccountDates(rawAccount) : null;

  const timezone = user.timezone;
  if (!timezone) {
    await ctx.reply("Спочатку заверши налаштування часового поясу:", {
      reply_markup: new InlineKeyboard().text("Почати", "menu:start"),
    });
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
  };

  if (!draft.allDay) {
    const timeResult = await collectStartTime(conversation, ctx);
    if (timeResult === CANCEL) return void (await ctx.reply(CANCEL_TEXT));
    draft.startTime = timeResult;

    const durationResult = await collectDuration(conversation, ctx);
    if (durationResult === CANCEL) return void (await ctx.reply(CANCEL_TEXT));
    draft.durationMinutes = durationResult;
  }

  // Preview + "Edit" + "Send"/"Cancel"
  // Set once the user explicitly picks a "Calendar" override in the Edit menu — from then
  // on the submit-time refresh re-validates *that* account instead of silently replacing
  // it with the resolved default (see fetchAccountById below).
  let accountOverridden = false;
  for (;;) {
    await ctx.reply(formatPreview(toPreviewDraft(draft, reminderMinutes), timezone, account?.label ?? "не підключено"), {
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
      const activeAccounts = await fetchActiveAccounts(conversation, user.id);
      const field = await collectEditField(conversation, ctx, {
        allDay: draft.allDay,
        showCalendarOption: activeAccounts.length >= 2,
      });
      if (field === CANCEL) return void (await ctx.reply(CANCEL_TEXT));
      if (field === "back") continue;

      if (field === "calendar") {
        const chosen = await collectAccountOverride(conversation, ctx, activeAccounts);
        if (chosen === CANCEL) return void (await ctx.reply(CANCEL_TEXT));
        account = chosen;
        accountOverridden = true;
      } else if (field === "title") {
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
      }
      continue;
    }

    if (action.data === "wizard:submit") {
      // Re-fetch fresh — the cached `account` may be stale (connected/disconnected/
      // deactivated by a token refresh since the wizard started or since the last loop).
      // An explicit per-event override (accountOverridden) is re-validated by id instead
      // of being silently replaced by the resolved default.
      account = accountOverridden && account ? await fetchAccountById(conversation, account.id) : await fetchAccount(conversation, user.id);
      if (!account || !account.isActive) {
        accountOverridden = false; // fell through to the generic connect flow — trust the default resolution from here on
        const connection = await waitForCalendarConnection(conversation, ctx);
        if (connection === CANCEL) return void (await ctx.reply(CANCEL_TEXT));
        account = await fetchAccount(conversation, user.id);
        continue; // back to the preview screen — now with the real calendar name
      }
      break;
    }
  }

  // Submission — buttons disabled, with retry on error (invariant 6, tech spec §12)
  // The preview loop above only breaks once `account` is confirmed connected; narrow
  // it into its own const so the compiler (and every read below) sees it as non-null.
  if (!account) {
    throw new Error("unreachable: account missing after the preview loop confirmed a connection");
  }
  const connectedAccount = account;
  const eventDraft = toEventDraft(draft, timezone, reminderMinutes);

  for (;;) {
    await ctx.reply("⏳ Створюю подію…");

    try {
      const created = await GoogleCalendarProvider.createEvent(connectedAccount, eventDraft);
      const savedEvent = await conversation.external(() =>
        prisma.event.create({
          data: {
            userId: user.id,
            accountId: connectedAccount.id,
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
      invalidate(user.id);

      await ctx.reply(formatSuccessCard(toPreviewDraft(draft, reminderMinutes), timezone, connectedAccount.label), {
        reply_markup: buildSuccessKeyboard(savedEvent.id),
      });
      return;
    } catch (err) {
      if (err instanceof AppError && err.code !== "google_create_failed") {
        await ctx.reply(`❌ ${err.userMessage}`);
        return;
      }

      await ctx.reply(
        "❌ Не вдалося створити подію: календар не відповідає.\nЧернетку збережено — можна спробувати ще раз.",
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
