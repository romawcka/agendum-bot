import type { NextFunction } from "grammy";
import { prisma } from "../../config/db.js";
import { env } from "../../config/env.js";
import type { BotContext } from "../context.js";

export async function userContextMiddleware(ctx: BotContext, next: NextFunction): Promise<void> {
  const from = ctx.from;
  if (!from) {
    await next();
    return;
  }

  const telegramId = BigInt(from.id);

  ctx.dbUser = await prisma.user.upsert({
    where: { telegramId },
    update: {
      firstName: from.first_name,
      username: from.username,
    },
    create: {
      telegramId,
      firstName: from.first_name,
      username: from.username,
      defaultReminder: env.DEFAULT_REMINDER_MINUTES,
    },
  });

  await next();
}
