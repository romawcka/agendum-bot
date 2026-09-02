import type { CalendarAccount } from "@prisma/client";
import type { Conversation } from "@grammyjs/conversations";
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { prisma } from "../../config/db.js";
import { listActiveAccounts } from "../../services/CalendarAccountService.js";
import type { BotContext } from "../context.js";
import { connectGoogleCalendar } from "./connectGoogle.js";
import { collectTimezone, timezoneKeyboard } from "./timezone.js";

type SettingsConversation = Conversation<BotContext, Context>;

type MenuUpdate =
  | { kind: "cancel" }
  | { kind: "new" }
  | { kind: "text"; text: string }
  | { kind: "callback"; data: string };

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
  // Without this, waitFor() silently swallows /new (settings has no draft to
  // lose, unlike the wizard's own /new-mid-wizard prompt) and just re-renders
  // the settings screen, since bot.command("new") never gets a turn.
  if (text === "/new") {
    return { kind: "new" };
  }
  return { kind: "text", text };
}

interface SettingsUser {
  id: number;
  timezone: string | null;
  defaultReminder: number;
  defaultAccountId: number | null;
}

function settingsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🌍 Часовий пояс", "settings:timezone")
    .row()
    .text("🔗 Google-акаунти", "settings:accounts")
    .row()
    .text("🗑 Видалити всі мої дані", "settings:delete_all");
}

function formatSettingsText(user: SettingsUser, accounts: CalendarAccount[]): string {
  const defaultAccount = accounts.find((a) => a.id === user.defaultAccountId);
  const accountsLine =
    accounts.length === 0 ? "❌ не підключено" : `${accounts.length} підключено${defaultAccount ? `, основний ${defaultAccount.label}` : ""}`;

  return [
    "⚙️ Налаштування",
    "",
    `Часовий пояс: ${user.timezone ?? "не задано"}`,
    `Google-акаунти: ${accountsLine}`,
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

/** One account's own actions: set default / disconnect / back. */
async function handleAccountActions(
  conversation: SettingsConversation,
  ctx: Context,
  userId: number,
  account: CalendarAccount,
  isDefault: boolean,
): Promise<"cancel" | "done"> {
  const keyboard = new InlineKeyboard();
  if (!isDefault) {
    keyboard.text("⭐ Зробити основним", "acctact:default").row();
  }
  keyboard.text("🔌 Відключити", "acctact:disconnect").row().text("⬅️ Назад", "acctact:back");
  await ctx.reply(account.label, { reply_markup: keyboard });

  for (;;) {
    const update = await nextUpdate(conversation);
    if (update.kind === "cancel") return "cancel";
    if (update.kind !== "callback") continue;

    if (update.data === "acctact:back") {
      return "done";
    }

    if (update.data === "acctact:default") {
      await conversation.external(() => prisma.user.update({ where: { id: userId }, data: { defaultAccountId: account.id } }));
      await ctx.reply(`✅ Основний акаунт: ${account.label}`);
      return "done";
    }

    if (update.data === "acctact:disconnect") {
      await conversation.external(() =>
        prisma.$transaction([
          prisma.calendarAccount.update({ where: { id: account.id }, data: { isActive: false } }),
          // Clear the default only if we just disconnected it — resolveDefaultAccount
          // (used by the wizard) falls back to another active account, or none, on its own.
          prisma.user.updateMany({ where: { id: userId, defaultAccountId: account.id }, data: { defaultAccountId: null } }),
        ]),
      );
      await ctx.reply(`Відключено: ${account.label}`);
      return "done";
    }
  }
}

/** The account list screen: pick an account for its own actions, or connect another. */
async function handleAccountsMenu(conversation: SettingsConversation, ctx: Context, userId: number): Promise<"cancel" | "done" | "exit"> {
  for (;;) {
    const { accounts, defaultAccountId } = await conversation.external(async () => {
      const [activeAccounts, dbUser] = await Promise.all([
        listActiveAccounts(userId),
        prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      ]);
      return { accounts: activeAccounts, defaultAccountId: dbUser.defaultAccountId };
    });

    let keyboard = new InlineKeyboard();
    for (const account of accounts) {
      const star = account.id === defaultAccountId ? "⭐ " : "";
      keyboard = keyboard.text(`${star}${account.label}`, `acct:open:${account.id}`).row();
    }
    keyboard = keyboard
      .text(accounts.length === 0 ? "➕ Підключити акаунт" : "➕ Підключити ще один акаунт", "acct:connect")
      .row()
      .text("⬅️ Назад", "acct:back");

    await ctx.reply("🔗 Google-акаунти", { reply_markup: keyboard });

    const update = await nextUpdate(conversation);
    if (update.kind === "cancel") return "cancel";
    if (update.kind !== "callback") continue;

    if (update.data === "acct:back") {
      return "done";
    }

    if (update.data === "acct:connect") {
      // Google connection is asynchronous (the user goes to the browser) — don't show
      // a stale settings screen right after sending the link, wait for the OAuth callback.
      await connectGoogleCalendar(conversation, ctx);
      return "exit";
    }

    if (update.data.startsWith("acct:open:")) {
      const id = Number(update.data.slice("acct:open:".length));
      const account = accounts.find((a) => a.id === id);
      if (!account) continue;

      const result = await handleAccountActions(conversation, ctx, userId, account, account.id === defaultAccountId);
      if (result === "cancel") return "cancel";
      // "done" — loop back and re-render the list (default/label may have changed)
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
      const activeAccounts = await listActiveAccounts(dbUser.id);
      return {
        user: {
          id: dbUser.id,
          timezone: dbUser.timezone,
          defaultReminder: dbUser.defaultReminder,
          defaultAccountId: dbUser.defaultAccountId,
        },
        accounts: activeAccounts,
      };
    });

    await ctx.reply(formatSettingsText(user, accounts), { reply_markup: settingsKeyboard() });

    const update = await nextUpdate(conversation);
    if (update.kind === "cancel") {
      await ctx.reply("Скасував поточну дію.");
      return;
    }
    if (update.kind === "new") {
      await ctx.reply("Вийшов із налаштувань.", {
        reply_markup: new InlineKeyboard().text("📝 Створити подію", "menu:new"),
      });
      return;
    }
    if (update.kind !== "callback") continue;

    let result: "cancel" | "done" | "exit" = "done";
    if (update.data === "settings:timezone") {
      result = await handleTimezoneChange(conversation, ctx, user.id);
    } else if (update.data === "settings:accounts") {
      result = await handleAccountsMenu(conversation, ctx, user.id);
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
