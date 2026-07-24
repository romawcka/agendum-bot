import type { Conversation } from "@grammyjs/conversations";
import type { Context } from "grammy";
import type { BotContext } from "../context.js";

// Stage 5 (Google OAuth) replaces this with the real OAuth-link flow.
export async function connectGoogleCalendar(
  _conversation: Conversation<BotContext, Context>,
  ctx: Context,
): Promise<void> {
  await ctx.reply("🚧 Подключение Google Calendar появится на следующем этапе разработки.");
}
