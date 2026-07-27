import { createApp } from "../src/app.js";

/**
 * Vercel serverless entrypoint. Vercel wraps an exported Express app as the
 * request handler directly (officially supported pattern) — no polling, no
 * app.listen(), no one-time setWebhook()/registerBotCommands() here (those
 * run once via `npm run setup:webhook`, not on every cold start).
 */
export default createApp();
