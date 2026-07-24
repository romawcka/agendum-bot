import type { BotContext } from "../context.js";

export async function newCommand(ctx: BotContext): Promise<void> {
  await ctx.conversation.enter("createEvent");
}

export async function anotherEventCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  await ctx.conversation.enter("createEvent");
}
