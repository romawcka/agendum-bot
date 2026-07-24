import type { Conversation } from "@grammyjs/conversations";
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { prisma } from "../../config/db.js";
import type { BotContext } from "../context.js";
import { connectCalDavCalendar } from "./connectCalDav.js";
import { connectGoogleCalendar } from "./connectGoogle.js";
import { collectTimezone, timezoneKeyboard } from "./timezone.js";

type OnboardingConversation = Conversation<BotContext, Context>;

function calendarChoiceKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🟦 Google Calendar", "cal:google")
    .text("🍎 Apple iCloud", "cal:icloud")
    .row()
    .text("Готово", "cal:done");
}

async function collectCalendarChoice(conversation: OnboardingConversation, ctx: Context): Promise<void> {
  for (;;) {
    const update = await conversation.waitForCallbackQuery(["cal:google", "cal:icloud", "cal:done"]);
    await update.answerCallbackQuery();

    const choice = update.callbackQuery.data;
    if (choice === "cal:done") {
      return;
    }
    if (choice === "cal:google") {
      await connectGoogleCalendar(conversation, ctx);
    } else {
      await connectCalDavCalendar(conversation, ctx);
    }
  }
}

export async function onboarding(conversation: OnboardingConversation, ctx: Context): Promise<void> {
  const telegramId = ctx.from?.id;
  if (telegramId === undefined) {
    return;
  }

  await ctx.reply(
    "Привет! 👋 Я помогу быстро создавать события в календаре прямо из Telegram.\n\n" +
      "Сначала настроим две вещи: часовой пояс и календарь.\n\n" +
      "В каком ты часовом поясе?",
    { reply_markup: timezoneKeyboard() },
  );

  const timezone = await collectTimezone(conversation);

  await conversation.external(() =>
    prisma.user.update({ where: { telegramId: BigInt(telegramId) }, data: { timezone } }),
  );

  await ctx.reply(
    `✅ Часовой пояс: ${timezone}\n\nТеперь подключим календарь. Можно оба — потом выберешь основной.`,
    { reply_markup: calendarChoiceKeyboard() },
  );

  await collectCalendarChoice(conversation, ctx);

  await ctx.reply(
    "Всё готово 🎉\n\n/new — создать событие\n/events — мои события\n/settings — настройки\n\nНачнём?",
  );
}
