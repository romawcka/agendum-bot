import type { BotContext } from "../context.js";

const HELP_TEXT = `Що я вмію:

/new — створити подію покроково
/events — переглянути та видалити події
/settings — часовий пояс, календарі
/cancel — перервати поточний діалог

Скоро: голосові повідомлення та створення події однією фразою.`;

export async function helpCommand(ctx: BotContext): Promise<void> {
  await ctx.reply(HELP_TEXT);
}

export async function fallbackTextHandler(ctx: BotContext): Promise<void> {
  await ctx.reply(
    "Я поки розумію лише команди. /new — створити подію.\n(Вільний текст і голосові будуть у наступній версії.)",
  );
}
