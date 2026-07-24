import type { BotContext } from "../context.js";

export async function cancelCommand(ctx: BotContext): Promise<void> {
  await ctx.reply("Зараз нема чого скасовувати.");
}
