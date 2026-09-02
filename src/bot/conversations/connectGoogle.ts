import { randomBytes } from "node:crypto";
import type { Conversation } from "@grammyjs/conversations";
import type { Context } from "grammy";
import { GrammyError, InlineKeyboard } from "grammy";
import { prisma } from "../../config/db.js";
import { env } from "../../config/env.js";
import type { BotContext } from "../context.js";

const OAUTH_STATE_TTL_MINUTES = 10;

export async function connectGoogleCalendar(
  conversation: Conversation<BotContext, Context>,
  ctx: Context,
  opts: { resumeWizard?: boolean } = {},
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
        resumeWizard: opts.resumeWizard ?? false,
      },
    });
    return nonce;
  });

  const link = `${env.BASE_URL}/oauth/google/start?state=${state}`;

  try {
    await ctx.reply(
      "Натисни кнопку нижче і дозволь доступ до календаря.\n\nПосилання живе 10 хвилин. Як дозволиш — я напишу.",
      { reply_markup: new InlineKeyboard().url("Підключити Google Calendar", link) },
    );
  } catch (err) {
    // Telegram rejects button URLs whose host isn't a "real" domain (e.g. plain
    // "localhost" in local dev, BASE_URL=http://localhost:3000) — fall back to
    // a plain, copy-pasteable link instead of crashing the update.
    if (err instanceof GrammyError && err.description.includes("inline keyboard button URL")) {
      await ctx.reply(
        `Скопіюй посилання і відкрий у браузері на цьому ж комп'ютері (Telegram не дозволяє кнопку для localhost):\n${link}\n\nПосилання живе 10 хвилин. Як дозволиш — я напишу.`,
      );
      return;
    }
    throw err;
  }
}
