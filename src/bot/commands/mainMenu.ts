import type { BotContext } from "../context.js";
import { eventsCommand } from "./events.js";
import { startCommand } from "./start.js";

export async function menuStartCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  await startCommand(ctx);
}

export async function menuNewCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  await ctx.conversation.enter("createEvent");
}

export async function menuEventsCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  await eventsCommand(ctx);
}

export async function menuSettingsCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  await ctx.conversation.enter("settingsMenu");
}
