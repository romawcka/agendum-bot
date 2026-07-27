import { conversations, createConversation } from "@grammyjs/conversations";
import { Bot } from "grammy";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { startCommand } from "./commands/start.js";
import { cancelCommand } from "./commands/cancel.js";
import {
  eventDeleteConfirmCallback,
  eventDeleteRequestCallback,
  eventsCommand,
  eventsPageCallback,
} from "./commands/events.js";
import { fallbackTextHandler, helpCommand } from "./commands/help.js";
import { menuEventsCallback, menuNewCallback, menuSettingsCallback, menuStartCallback } from "./commands/mainMenu.js";
import { anotherEventCallback, newCommand } from "./commands/new.js";
import { settingsCommand } from "./commands/settings.js";
import { wizardStorage } from "./conversationStorage.js";
import { createEvent } from "./conversations/createEvent.js";
import { onboarding } from "./conversations/onboarding.js";
import { settingsMenu } from "./conversations/settingsMenu.js";
import type { BotContext } from "./context.js";
import { allowlistMiddleware } from "./middleware/allowlist.js";
import { handleBotError } from "./middleware/errorHandler.js";
import { rateLimitMiddleware } from "./middleware/rateLimit.js";
import { userContextMiddleware } from "./middleware/userContext.js";

export const bot = new Bot<BotContext>(env.TELEGRAM_BOT_TOKEN);

bot.use(allowlistMiddleware);
bot.use(rateLimitMiddleware);
bot.use(userContextMiddleware);

bot.use(
  conversations({
    storage: {
      type: "key",
      version: 0,
      getStorageKey: (ctx) => String(ctx.dbUser.id),
      adapter: wizardStorage,
    },
  }),
);
bot.use(createConversation(onboarding));
bot.use(createConversation(createEvent));
bot.use(createConversation(settingsMenu));

bot.command("start", startCommand);
bot.command("new", newCommand);
bot.command("events", eventsCommand);
bot.command("settings", settingsCommand);
bot.command("cancel", cancelCommand);
bot.command("help", helpCommand);
bot.callbackQuery("wizard:another", anotherEventCallback);
bot.callbackQuery(/^events:page:/, eventsPageCallback);
bot.callbackQuery(/^events:del:/, eventDeleteRequestCallback);
bot.callbackQuery(/^events:confirm:/, eventDeleteConfirmCallback);
bot.callbackQuery("menu:new", menuNewCallback);
bot.callbackQuery("menu:events", menuEventsCallback);
bot.callbackQuery("menu:settings", menuSettingsCallback);
bot.callbackQuery("menu:start", menuStartCallback);

bot.on("message:text", fallbackTextHandler);

bot.catch((err) => {
  void handleBotError(err);
});

const BOT_COMMANDS = [
  { command: "start", description: "Почати / перезапустити бота" },
  { command: "new", description: "Створити подію" },
  { command: "events", description: "Мої події" },
  { command: "settings", description: "Часовий пояс, календарі" },
  { command: "cancel", description: "Перервати поточний діалог" },
  { command: "help", description: "Що вміє бот" },
];

export async function registerBotCommands(): Promise<void> {
  await bot.api.setMyCommands(BOT_COMMANDS);
}

/** Shared by the Express webhook route (app.ts) and setWebhook() (registerWebhook below) — keeps the path in sync between the two. */
export function webhookPath(): string {
  return `/telegram/webhook/${env.TELEGRAM_WEBHOOK_SECRET}`;
}

export async function registerWebhook(): Promise<void> {
  await bot.api.setWebhook(`${env.BASE_URL}${webhookPath()}`, {
    secret_token: env.TELEGRAM_WEBHOOK_SECRET,
  });
  logger.info("Вебхук Telegram установлен");
}
