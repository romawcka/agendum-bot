import express, { type Express, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import helmetImport from 'helmet';

const helmet = helmetImport as unknown as (options?: Record<string, unknown>) => RequestHandler;
import { webhookCallback } from 'grammy';
import { randomUUID } from 'node:crypto';
import { bot, webhookPath } from './bot/bot.js';
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
    app.post(webhookPath(), webhookCallback(bot, 'express', { secretToken: env.TELEGRAM_WEBHOOK_SECRET }));
  }

  // app.get('/', (_req: Request, res: Response) => {
  //   res.redirect('/healthz');
  // });

  app.use('/healthz', healthRouter);
  app.use('/oauth/google', oauthGoogleRouter);

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err, requestId: req.id }, 'Необработанная ошибка Express');
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
