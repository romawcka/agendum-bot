import type { NextFunction } from "grammy";
import { env } from "../../config/env.js";
import type { BotContext } from "../context.js";

const allowlist = new Set(env.ALLOWLIST_TELEGRAM_IDS.map((id) => id.toString()));

export async function allowlistMiddleware(ctx: BotContext, next: NextFunction): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId === undefined) {
    return;
  }

  if (!allowlist.has(telegramId.toString())) {
    await ctx.reply(
      "Привіт! Поки що бот працює в закритому режимі. Якщо тобі потрібен доступ — напиши власнику бота.",
    );
    return;
  }

  await next();
}
