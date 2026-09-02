import type { BotContext } from "../context.js";
import { buildMainMenuKeyboard } from "../keyboards/mainMenuKeyboard.js";

export async function startCommand(ctx: BotContext): Promise<void> {
  if (ctx.dbUser.timezone) {
    await ctx.reply("Все готово!\n\nЩо зробити?", { reply_markup: buildMainMenuKeyboard() });
    return;
  }

  if (ctx.conversation.active("onboarding") === 0) {
    await ctx.conversation.enter("onboarding");
  }
}
