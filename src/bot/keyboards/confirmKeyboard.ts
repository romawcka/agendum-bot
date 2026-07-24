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
  // Reuses /events' own delete-confirmation flow (events:del:<id>:<page>) —
  // same button, same confirmation screen, one implementation.
  return new InlineKeyboard().text("🗑 Удалить", `events:del:${eventId}:1`).text("➕ Ещё одно", "wizard:another");
}
