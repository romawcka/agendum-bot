import type { BotContext } from "../context.js";

export async function startCommand(ctx: BotContext): Promise<void> {
  if (ctx.dbUser.timezone) {
    await ctx.reply(
      "Всё готово 🎉\n\n/new — создать событие\n/events — мои события\n/settings — настройки\n\nНачнём?",
    );
    return;
  }

  if (ctx.conversation.active("onboarding") === 0) {
    await ctx.conversation.enter("onboarding");
  }
}
