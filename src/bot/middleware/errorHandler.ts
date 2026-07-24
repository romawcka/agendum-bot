import type { BotError } from "grammy";
import { logger } from "../../config/logger.js";
import type { BotContext } from "../context.js";

export class AppError extends Error {
  readonly code: string;
  readonly userMessage: string;
  readonly isOperational: boolean;

  constructor(params: { code: string; userMessage: string; isOperational?: boolean; cause?: unknown }) {
    super(params.code, params.cause !== undefined ? { cause: params.cause } : undefined);
    this.name = "AppError";
    this.code = params.code;
    this.userMessage = params.userMessage;
    this.isOperational = params.isOperational ?? true;
  }
}

const FALLBACK_MESSAGE = "⚠️ Что-то пошло не так. Попробуй ещё раз чуть позже.";

export function toUserMessage(err: unknown): string {
  return err instanceof AppError ? err.userMessage : FALLBACK_MESSAGE;
}

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
    "Ошибка обработки апдейта бота",
  );

  try {
    await ctx.reply(toUserMessage(error));
  } catch (replyErr) {
    logger.error({ err: replyErr, userId }, "Не удалось отправить сообщение об ошибке пользователю");
  }
}
