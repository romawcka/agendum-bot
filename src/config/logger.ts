import pino from "pino";
import { env } from "./env.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      "*.accessToken",
      "*.refreshToken",
      "*.caldavPass",
      "*.password",
      "*.ENCRYPTION_KEY",
      "req.headers.authorization",
    ],
    censor: "[redacted]",
  },
});
