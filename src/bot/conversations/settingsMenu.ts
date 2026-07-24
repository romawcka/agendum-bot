import type { CalendarAccount } from "@prisma/client";
import type { Conversation } from "@grammyjs/conversations";
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { prisma } from "../../config/db.js";
import type { BotContext } from "../context.js";
import { connectCalDavCalendar } from "./connectCalDav.js";
import { connectGoogleCalendar } from "./connectGoogle.js";
import { collectTimezone, timezoneKeyboard } from "./timezone.js";

type SettingsConversation = Conversation<BotContext, Context>;

type MenuUpdate = { kind: "cancel" } | { kind: "text"; text: string } | { kind: "callback"; data: string };

async function nextUpdate(conversation: SettingsConversation): Promise<MenuUpdate> {
  const update = await conversation.waitFor(["message:text", "callback_query:data"]);
  const data = update.callbackQuery?.data;
  if (data !== undefined) {
    await update.answerCallbackQuery();
    return { kind: "callback", data };
  }
  const text = update.message?.text?.trim() ?? "";
  if (text === "/cancel") {
    return { kind: "cancel" };
  }
  return { kind: "text", text };
}

interface SettingsUser {
  id: number;
  timezone: string | null;
  defaultAccountId: number | null;
  defaultReminder: number;
}

function settingsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🌍 Часовий пояс", "settings:timezone")
    .row()
    .text("📅 Календар за замовчуванням", "settings:default_calendar")
    .row()
    .text("🔗 Підключити / відключити календар", "settings:connect")
    .row()
    .text("🗑 Видалити всі мої дані", "settings:delete_all");
}

function formatSettingsText(user: SettingsUser, accounts: CalendarAccount[]): string {
  const google = accounts.find((a) => a.provider === "GOOGLE" && a.isActive);
  const caldav = accounts.find((a) => a.provider === "CALDAV" && a.isActive);
  const defaultAccount = accounts.find((a) => a.id === user.defaultAccountId && a.isActive);

  return [
    "⚙️ Налаштування",
    "",
    `Часовий пояс: ${user.timezone ?? "не задано"}`,
    `Календар за замовчуванням: ${defaultAccount ? defaultAccount.label : "не вибрано"}`,
    `Підключено: Google ${google ? "✅" : "❌"}, iCloud ${caldav ? "✅" : "❌"}`,
    `Нагадування: за ${user.defaultReminder} хвилин`,
  ].join("\n");
}

async function handleTimezoneChange(
  conversation: SettingsConversation,
  ctx: Context,
  userId: number,
): Promise<"cancel" | "done" | "exit"> {
  await ctx.reply("У якому ти часовому поясі?", { reply_markup: timezoneKeyboard() });
  const timezone = await collectTimezone(conversation);
  await conversation.external(() => prisma.user.update({ where: { id: userId }, data: { timezone } }));
  await ctx.reply(`✅ Часовий пояс: ${timezone}`);
  return "done";
}

async function handleDefaultCalendarChange(
  conversation: SettingsConversation,
  ctx: Context,
  userId: number,
  accounts: CalendarAccount[],
): Promise<"cancel" | "done"> {
  const active = accounts.filter((a) => a.isActive);
  if (active.length < 2) {
    await ctx.reply("Підключи обидва календарі, щоб вибирати між ними: 🔗 Підключити / відключити календар.");
    return "done";
  }

  const keyboard = new InlineKeyboard();
  active.forEach((account, i) => {
    if (i > 0) keyboard.row();
    keyboard.text(account.provider === "GOOGLE" ? "Google" : "iCloud", `defacct:${account.id}`);
  });
  await ctx.reply("Який календар зробити основним?", { reply_markup: keyboard });

  const validIds = new Set(active.map((a) => a.id));
  for (;;) {
    const update = await nextUpdate(conversation);
    if (update.kind === "cancel") return "cancel";
    if (update.kind !== "callback" || !update.data.startsWith("defacct:")) continue;

    const id = Number(update.data.slice("defacct:".length));
    if (!validIds.has(id)) continue;

    await conversation.external(() => prisma.user.update({ where: { id: userId }, data: { defaultAccountId: id } }));
    await ctx.reply("✅ Оновив календар за замовчуванням.");
    return "done";
  }
}

async function handleConnectDisconnect(
  conversation: SettingsConversation,
  ctx: Context,
  accounts: CalendarAccount[],
): Promise<"cancel" | "done" | "exit"> {
  const google = accounts.find((a) => a.provider === "GOOGLE");
  const caldav = accounts.find((a) => a.provider === "CALDAV");

  const keyboard = new InlineKeyboard()
    .text(google?.isActive ? "Google: відключити" : "Google: підключити", "conn:google")
    .row()
    .text(caldav?.isActive ? "iCloud: відключити" : "iCloud: підключити", "conn:caldav")
    .row()
    .text("⬅️ Назад", "conn:back");
  await ctx.reply("Керування календарями:", { reply_markup: keyboard });

  for (;;) {
    const update = await nextUpdate(conversation);
    if (update.kind === "cancel") return "cancel";
    if (update.kind !== "callback") continue;

    if (update.data === "conn:back") {
      return "done";
    }

    if (update.data === "conn:google") {
      if (google?.isActive) {
        await conversation.external(() => prisma.calendarAccount.update({ where: { id: google.id }, data: { isActive: false } }));
        await ctx.reply("Google Calendar відключено.");
        return "done";
      }
      // Google-підключення асинхронне (користувач іде в браузер) — не показуємо
      // застарілий екран налаштувань одразу після посилання, чекаємо OAuth callback.
      await connectGoogleCalendar(conversation, ctx);
      return "exit";
    }

    if (update.data === "conn:caldav") {
      if (caldav?.isActive) {
        await conversation.external(() => prisma.calendarAccount.update({ where: { id: caldav.id }, data: { isActive: false } }));
        await ctx.reply("iCloud відключено.");
      } else {
        await connectCalDavCalendar(conversation, ctx);
      }
      return "done";
    }
  }
}

async function handleDeleteAll(conversation: SettingsConversation, ctx: Context, userId: number): Promise<"cancel" | "done" | "exit"> {
  const keyboard = new InlineKeyboard().text("Так, видалити все", "del:yes").row().text("Скасувати", "del:no");
  await ctx.reply(
    "⚠️ Це видалить твій профіль, підключені календарі та історію подій з бота.\n" +
      "Самі події в календарі залишаться.\n\n" +
      "Точно видалити?",
    { reply_markup: keyboard },
  );

  for (;;) {
    const update = await nextUpdate(conversation);
    if (update.kind === "cancel") return "cancel";
    if (update.kind !== "callback") continue;

    if (update.data === "del:no") {
      return "done";
    }
    if (update.data === "del:yes") {
      await conversation.external(() => prisma.user.delete({ where: { id: userId } }));
      await ctx.reply("Готово. Всі твої дані видалено.");
      return "exit"; // deleted — nothing left to loop back to, and no "Скасував" message needed
    }
  }
}

export async function settingsMenu(conversation: SettingsConversation, ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId === undefined) {
    return;
  }

  for (;;) {
    const { user, accounts } = await conversation.external(async () => {
      const dbUser = await prisma.user.findUniqueOrThrow({ where: { telegramId: BigInt(telegramId) } });
      const calendarAccounts = await prisma.calendarAccount.findMany({ where: { userId: dbUser.id } });
      return {
        user: {
          id: dbUser.id,
          timezone: dbUser.timezone,
          defaultAccountId: dbUser.defaultAccountId,
          defaultReminder: dbUser.defaultReminder,
        },
        accounts: calendarAccounts,
      };
    });

    await ctx.reply(formatSettingsText(user, accounts), { reply_markup: settingsKeyboard() });

    const update = await nextUpdate(conversation);
    if (update.kind === "cancel") {
      await ctx.reply("Скасував поточну дію.");
      return;
    }
    if (update.kind !== "callback") continue;

    let result: "cancel" | "done" | "exit" = "done";
    if (update.data === "settings:timezone") {
      result = await handleTimezoneChange(conversation, ctx, user.id);
    } else if (update.data === "settings:default_calendar") {
      result = await handleDefaultCalendarChange(conversation, ctx, user.id, accounts);
    } else if (update.data === "settings:connect") {
      result = await handleConnectDisconnect(conversation, ctx, accounts);
    } else if (update.data === "settings:delete_all") {
      result = await handleDeleteAll(conversation, ctx, user.id);
    }

    if (result === "cancel") {
      await ctx.reply("Скасував поточну дію.");
      return;
    }
    if (result === "exit") {
      return;
    }
  }
}
