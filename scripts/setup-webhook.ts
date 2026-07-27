import { registerBotCommands, registerWebhook } from "../src/bot/bot.js";
import { env } from "../src/config/env.js";
import { logger } from "../src/config/logger.js";

async function main(): Promise<void> {
  if (env.BOT_MODE !== "webhook") {
    throw new Error(`setup-webhook требует BOT_MODE=webhook, сейчас: ${env.BOT_MODE}`);
  }
  await registerWebhook();
  await registerBotCommands();
  logger.info("Готово: webhook и меню команд зарегистрированы");
}

main().catch((err: unknown) => {
  logger.fatal({ err }, "Не удалось настроить webhook");
  process.exit(1);
});
