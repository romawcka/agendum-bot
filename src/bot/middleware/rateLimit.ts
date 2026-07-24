import type { NextFunction } from "grammy";
import { logger } from "../../config/logger.js";
import type { BotContext } from "../context.js";

const WINDOW_MS = 60_000;
const MAX_ACTIONS_PER_WINDOW = 30;

// In-memory: acceptable per tech spec §14, single application instance.
const hitsByTelegramId = new Map<number, number[]>();

export async function rateLimitMiddleware(ctx: BotContext, next: NextFunction): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId === undefined) {
    await next();
    return;
  }

  const now = Date.now();
  const recentHits = (hitsByTelegramId.get(telegramId) ?? []).filter(
    (timestamp) => now - timestamp < WINDOW_MS,
  );

  if (recentHits.length >= MAX_ACTIONS_PER_WINDOW) {
    hitsByTelegramId.set(telegramId, recentHits);
    logger.warn({ userId: telegramId }, "Превышен лимит действий в минуту");
    await ctx.reply("Слишком много действий подряд. Подожди немного и попробуй снова.");
    return;
  }

  recentHits.push(now);
  hitsByTelegramId.set(telegramId, recentHits);
  await next();
}
