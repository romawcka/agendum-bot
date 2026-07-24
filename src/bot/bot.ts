import { Bot } from "grammy";
import { env } from "../config/env.js";
import type { BotContext } from "./context.js";
import { allowlistMiddleware } from "./middleware/allowlist.js";
import { handleBotError } from "./middleware/errorHandler.js";
import { rateLimitMiddleware } from "./middleware/rateLimit.js";
import { userContextMiddleware } from "./middleware/userContext.js";

export const bot = new Bot<BotContext>(env.TELEGRAM_BOT_TOKEN);

bot.use(allowlistMiddleware);
bot.use(rateLimitMiddleware);
bot.use(userContextMiddleware);

bot.catch((err) => {
  void handleBotError(err);
});
