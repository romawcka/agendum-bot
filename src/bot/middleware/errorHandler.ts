import type { BotError } from "grammy";
import { logger } from "../../config/logger.js";
import { AppError, toUserMessage } from "../../utils/errors.js";
import type { BotContext } from "../context.js";

export async function handleBotError(botErr: BotError<BotContext>): Promise<void> {
  const { ctx, error } = botErr;
  const userId = ctx.from?.id;

  logger.error(
    {
      err: error,
      userId,
      updateId: ctx.update.update_id,
      isOperational: error instanceof AppError ? error.isOperational : false,
    },
    "Error handling bot update",
  );

  try {
    await ctx.reply(toUserMessage(error));
  } catch (replyErr) {
    logger.error({ err: replyErr, userId }, "Failed to send error message to user");
  }
}
