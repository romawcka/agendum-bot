import express, { type Express, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import helmetImport from 'helmet';

const helmet = helmetImport as unknown as (options?: Record<string, unknown>) => RequestHandler;
import { BotError, webhookCallback } from 'grammy';
import { randomUUID } from 'node:crypto';
import { bot, webhookPath } from './bot/bot.js';
import type { BotContext } from './bot/context.js';
import { handleBotError } from './bot/middleware/errorHandler.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { healthRouter } from './routes/health.js';
import { oauthGoogleRouter } from './routes/oauthGoogle.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id: string;
    }
  }
}

/**
 * Self-contained: includes the Telegram webhook route (when BOT_MODE=webhook)
 * so this single Express app works both as a traditional app.listen() server
 * (index.ts) and as a Vercel serverless entrypoint (api/index.ts), which never
 * runs index.ts's bootstrap at all.
 */
export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.id = randomUUID();
    next();
  });

  if (env.BOT_MODE === 'webhook') {
    const handleWebhook = webhookCallback(bot, 'express', { secretToken: env.TELEGRAM_WEBHOOK_SECRET });

    // bot.catch() only covers long polling: under webhooks grammY's handleUpdate
    // rethrows as a BotError and webhookCallback hands it back as a rejected
    // promise, which Express 4 does not catch — it becomes an unhandled rejection
    // that kills the serverless function, so Telegram never gets a 2xx and retries
    // the same update forever. This is the webhook-side equivalent of bot.catch().
    app.post(webhookPath(), (req: Request, res: Response) => {
      void handleWebhook(req, res).catch(async (err: unknown) => {
        try {
          if (err instanceof BotError) {
            await handleBotError(err as BotError<BotContext>);
          } else {
            logger.error({ err, requestId: req.id }, 'Telegram webhook handler failed');
          }
        } catch (handlerErr) {
          logger.error({ err: handlerErr, requestId: req.id }, 'Webhook error handler itself failed');
        }
        // Always acknowledge: a non-2xx makes Telegram redeliver this same update,
        // and an update that always fails would be redelivered indefinitely.
        if (!res.headersSent) res.status(200).end();
      });
    });
  }

  // app.get('/', (_req: Request, res: Response) => {
  //   res.redirect('/healthz');
  // });

  app.use('/healthz', healthRouter);
  app.use('/oauth/google', oauthGoogleRouter);

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err, requestId: req.id }, 'Unhandled Express error');
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
