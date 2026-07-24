import type { Conversation } from "@grammyjs/conversations";
import type { Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { prisma } from "../../config/db.js";
import type { BotContext } from "../context.js";
import { buildMainMenuKeyboard } from "../keyboards/mainMenuKeyboard.js";
import { connectCalDavCalendar } from "./connectCalDav.js";
import { connectGoogleCalendar } from "./connectGoogle.js";
import { collectTimezone, timezoneKeyboard } from "./timezone.js";

type OnboardingConversation = Conversation<BotContext, Context>;

function calendarChoiceKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Google Calendar", "cal:google")
    .row()
    .text("Apple iCloud", "cal:icloud")
    .row()
    .text("Готово", "cal:done");
}

async function hasConnectedCalendar(conversation: OnboardingConversation, telegramId: number): Promise<boolean> {
  const count = await conversation.external(() =>
    prisma.calendarAccount.count({ where: { isActive: true, user: { telegramId: BigInt(telegramId) } } }),
  );
  return count > 0;
}

async function collectCalendarChoice(
  conversation: OnboardingConversation,
  ctx: Context,
  telegramId: number,
): Promise<void> {
  for (;;) {
    const update = await conversation.waitForCallbackQuery(["cal:google", "cal:icloud", "cal:done"]);
    await update.answerCallbackQuery();

    const choice = update.callbackQuery.data;
    if (choice === "cal:done") {
      if (await hasConnectedCalendar(conversation, telegramId)) {
        return;
      }
      await ctx.reply("Спочатку підключи хоча б один календар — Google або iCloud.", {
        reply_markup: calendarChoiceKeyboard(),
      });
      continue;
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
    "Привіт! 👋 Я допоможу швидко створювати події в календарі прямо з Telegram.\n\n" +
      "Спочатку налаштуємо дві речі: часовий пояс і календар.\n\n" +
      "У якому ти часовому поясі?",
    { reply_markup: timezoneKeyboard() },
  );

  const timezone = await collectTimezone(conversation);

  await conversation.external(() =>
    prisma.user.update({ where: { telegramId: BigInt(telegramId) }, data: { timezone } }),
  );

  await ctx.reply(
    `✅ Часовий пояс: ${timezone}\n\nТепер підключимо календар. Можна обидва — потім виберешь основний.`,
    { reply_markup: calendarChoiceKeyboard() },
  );

  await collectCalendarChoice(conversation, ctx, telegramId);

  await ctx.reply("Все готово 🎉\n\nЩо зробити?", { reply_markup: buildMainMenuKeyboard() });
}
