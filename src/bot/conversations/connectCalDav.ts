import type { Conversation } from "@grammyjs/conversations";
import type { Context } from "grammy";
import type { BotContext } from "../context.js";

// Stage 6 (CalDAV) replaces this with the real Apple ID + app-password flow.
export async function connectCalDavCalendar(
  _conversation: Conversation<BotContext, Context>,
  ctx: Context,
): Promise<void> {
  await ctx.reply("🚧 Подключение Apple iCloud появится на следующем этапе разработки.");
}
