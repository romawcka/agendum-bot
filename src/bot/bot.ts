import { conversations, createConversation } from "@grammyjs/conversations";
import { Bot } from "grammy";
import { env } from "../config/env.js";
import { startCommand } from "./commands/start.js";
import {
  eventDeleteConfirmCallback,
  eventDeleteRequestCallback,
  eventsCommand,
  eventsPageCallback,
} from "./commands/events.js";
import { anotherEventCallback, newCommand } from "./commands/new.js";
import { wizardStorage } from "./conversationStorage.js";
import { createEvent } from "./conversations/createEvent.js";
import { onboarding } from "./conversations/onboarding.js";
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

bot.command("start", startCommand);
bot.command("new", newCommand);
bot.command("events", eventsCommand);
bot.callbackQuery("wizard:another", anotherEventCallback);
bot.callbackQuery(/^events:page:/, eventsPageCallback);
bot.callbackQuery(/^events:del:/, eventDeleteRequestCallback);
bot.callbackQuery(/^events:confirm:/, eventDeleteConfirmCallback);

bot.catch((err) => {
  void handleBotError(err);
});
