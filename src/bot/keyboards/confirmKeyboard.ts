import { InlineKeyboard } from "grammy";

export function buildConfirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Отправить", "wizard:submit")
    .text("✏️ Изменить", "wizard:edit")
    .row()
    .text("❌ Отменить", "wizard:cancel");
}

export function buildRetryKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("🔄 Повторить", "wizard:retry").text("❌ Отменить", "wizard:cancel");
}

export function buildSuccessKeyboard(eventId: number): InlineKeyboard {
  return new InlineKeyboard().text("🗑 Удалить", `event:delete:${eventId}`).text("➕ Ещё одно", "wizard:another");
}
