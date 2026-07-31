import { registerBotCommands, registerWebhook } from "../src/bot/bot.js";
import { env } from "../src/config/env.js";
import { logger } from "../src/config/logger.js";

async function main(): Promise<void> {
  if (env.BOT_MODE !== "webhook") {
    throw new Error(`setup-webhook requires BOT_MODE=webhook, currently: ${env.BOT_MODE}`);
  }
  await registerWebhook();
  await registerBotCommands();
  logger.info("Done: webhook and command menu registered");
}

main().catch((err: unknown) => {
  logger.fatal({ err }, "Failed to set up webhook");
  process.exit(1);
});
