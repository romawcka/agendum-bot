import type { BotContext } from "../context.js";

export async function settingsCommand(ctx: BotContext): Promise<void> {
  await ctx.conversation.enter("settingsMenu");
}
