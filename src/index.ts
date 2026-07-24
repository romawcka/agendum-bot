import { webhookCallback } from "grammy";
import { createApp } from "./app.js";
import { bot, registerBotCommands } from "./bot/bot.js";
import { initDatabase, prisma } from "./config/db.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";

async function main(): Promise<void> {
  await initDatabase();
  await registerBotCommands();

  const app = createApp();

  if (env.BOT_MODE === "webhook") {
    const webhookPath = `/telegram/webhook/${env.TELEGRAM_WEBHOOK_SECRET}`;
    app.post(
      webhookPath,
      webhookCallback(bot, "express", { secretToken: env.TELEGRAM_WEBHOOK_SECRET }),
    );
    await bot.api.setWebhook(`${env.BASE_URL}${webhookPath}`, {
      secret_token: env.TELEGRAM_WEBHOOK_SECRET,
    });
    logger.info("Вебхук Telegram установлен");
  }

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, mode: env.BOT_MODE }, "Сервер запущен");
  });

  if (env.BOT_MODE === "polling") {
    await bot.api.deleteWebhook();
    void bot.start({
      onStart: () => logger.info("Бот запущен в режиме polling"),
    });
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Остановка сервера");
    server.close();
    if (env.BOT_MODE === "polling") {
      await bot.stop();
    }
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  logger.fatal({ err }, "Фатальная ошибка при старте");
  process.exit(1);
});
