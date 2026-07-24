import type { BotContext } from "../context.js";

const HELP_TEXT = `Что я умею:

/new — создать событие пошагово
/events — посмотреть и удалить события
/settings — часовой пояс, календари
/cancel — прервать текущий диалог

Скоро: голосовые сообщения и создание события одной фразой.`;

export async function helpCommand(ctx: BotContext): Promise<void> {
  await ctx.reply(HELP_TEXT);
}

export async function fallbackTextHandler(ctx: BotContext): Promise<void> {
  await ctx.reply(
    "Я пока понимаю только команды. /new — создать событие.\n(Свободный текст и голосовые будут в следующей версии.)",
  );
}
