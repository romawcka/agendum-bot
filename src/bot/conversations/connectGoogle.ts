import { randomBytes } from "node:crypto";
import type { Conversation } from "@grammyjs/conversations";
import type { Context } from "grammy";
import { prisma } from "../../config/db.js";
import { env } from "../../config/env.js";
import type { BotContext } from "../context.js";

const OAUTH_STATE_TTL_MINUTES = 10;

export async function connectGoogleCalendar(
  conversation: Conversation<BotContext, Context>,
  ctx: Context,
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId === undefined) {
    return;
  }

  const state = await conversation.external(async () => {
    const nonce = randomBytes(24).toString("hex");
    await prisma.oAuthState.create({
      data: {
        state: nonce,
        telegramId: BigInt(telegramId),
        expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MINUTES * 60_000),
      },
    });
    return nonce;
  });

  const link = `${env.BASE_URL}/oauth/google/start?state=${state}`;

  await ctx.reply(
    `Открой ссылку и разреши доступ к календарю:\n${link}\n\nСсылка живёт 10 минут. Как разрешишь — я напишу.`,
  );
}
