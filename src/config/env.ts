import "dotenv/config";
import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    BASE_URL: z.string().url(),

    TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN обязателен"),
    TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
    BOT_MODE: z.enum(["webhook", "polling"]),

    DATABASE_URL: z.string().min(1, "DATABASE_URL обязателен"),
    BACKUP_DIR: z.string().default("./backups"),

    ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, "ENCRYPTION_KEY должен быть 32 байтами в hex (64 символа)"),

    GOOGLE_CLIENT_ID: z.string().min(1, "GOOGLE_CLIENT_ID обязателен"),
    GOOGLE_CLIENT_SECRET: z.string().min(1, "GOOGLE_CLIENT_SECRET обязателен"),
    GOOGLE_REDIRECT_URI: z.string().url(),

    ALLOWLIST_TELEGRAM_IDS: z
      .string()
      .min(1, "ALLOWLIST_TELEGRAM_IDS обязателен")
      .transform((value) =>
        value
          .split(",")
          .map((id) => id.trim())
          .filter((id) => id.length > 0)
          .map((id) => BigInt(id)),
      ),

    DEFAULT_REMINDER_MINUTES: z.coerce.number().int().positive().default(30),
    WIZARD_TTL_MINUTES: z.coerce.number().int().positive().default(60),
    LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  })
  .superRefine((data, ctx) => {
    if (data.BOT_MODE === "webhook" && !data.TELEGRAM_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["TELEGRAM_WEBHOOK_SECRET"],
        message: "TELEGRAM_WEBHOOK_SECRET обязателен, когда BOT_MODE=webhook",
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Некорректная конфигурация окружения:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
