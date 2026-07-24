import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
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

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.id = randomUUID();
    next();
  });

  app.use('/healthz', healthRouter);
  app.use('/oauth/google', oauthGoogleRouter);

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err, requestId: req.id }, 'Необработанная ошибка Express');
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
