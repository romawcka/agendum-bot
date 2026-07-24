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
