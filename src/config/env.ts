import { config as loadDotenv } from "dotenv";
import { z } from "zod";

// override: true — Vite/Vitest inject their own process.env.BASE_URL ("/"),
// which would otherwise silently shadow ours since dotenv doesn't overwrite
// already-set variables by default.
loadDotenv({ override: true });

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    BASE_URL: z.string().url(),

    TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
    TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
    BOT_MODE: z.enum(["webhook", "polling"]),

    TURSO_DATABASE_URL: z.string().min(1, "TURSO_DATABASE_URL is required"),
    TURSO_AUTH_TOKEN: z.string().min(1, "TURSO_AUTH_TOKEN is required"),

    ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, "ENCRYPTION_KEY must be 32 bytes in hex (64 characters)"),

    GOOGLE_CLIENT_ID: z.string().min(1, "GOOGLE_CLIENT_ID is required"),
    GOOGLE_CLIENT_SECRET: z.string().min(1, "GOOGLE_CLIENT_SECRET is required"),
    GOOGLE_REDIRECT_URI: z.string().url(),

    ALLOWLIST_TELEGRAM_IDS: z
      .string()
      .min(1, "ALLOWLIST_TELEGRAM_IDS is required")
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
        message: "TELEGRAM_WEBHOOK_SECRET is required when BOT_MODE=webhook",
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
