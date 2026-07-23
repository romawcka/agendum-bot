import { Bot } from "grammy";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";

export const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

bot.catch((err) => {
  logger.error(
    { err: err.error, updateId: err.ctx.update.update_id },
    "Необработанная ошибка в обработчике бота",
  );
});
