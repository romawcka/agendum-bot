import type { Conversation } from "@grammyjs/conversations";
import { InlineKeyboard } from "grammy";
import { isValidTimezone } from "../../utils/datetime.js";
import type { BotContext } from "../context.js";

type AnyConversation = Conversation<BotContext, import("grammy").Context>;

export function timezoneKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Europe/Warsaw", "tz:set:Europe/Warsaw")
    .text("Europe/Moscow", "tz:set:Europe/Moscow")
    .row()
    .text("Europe/Kyiv", "tz:set:Europe/Kyiv")
    .text("Asia/Tel_Aviv", "tz:set:Asia/Tel_Aviv")
    .row()
    .text("⌨️ Ввести другой", "tz:manual");
}

export async function collectTimezone(conversation: AnyConversation): Promise<string> {
  for (;;) {
    const update = await conversation.waitFor(["callback_query:data", "message:text"]);

    const callbackData = update.callbackQuery?.data;
    if (callbackData !== undefined) {
      await update.answerCallbackQuery();

      if (callbackData === "tz:manual") {
        await update.reply(
          "Напиши таймзону в формате IANA, например: Europe/Berlin\n" +
            "Список: en.wikipedia.org/wiki/List_of_tz_database_time_zones",
        );
        continue;
      }

      if (callbackData.startsWith("tz:set:")) {
        return callbackData.slice("tz:set:".length);
      }

      continue;
    }

    const text = update.message?.text?.trim();
    if (text && isValidTimezone(text)) {
      return text;
    }

    await update.reply("Не узнаю такую таймзону. Пример правильной: Europe/Berlin");
  }
}
