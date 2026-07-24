import type { BotContext } from "../context.js";

export async function cancelCommand(ctx: BotContext): Promise<void> {
  await ctx.reply("Сейчас нечего отменять.");
}
