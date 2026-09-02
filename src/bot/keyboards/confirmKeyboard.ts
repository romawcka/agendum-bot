import { InlineKeyboard } from "grammy";

export function buildConfirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Надіслати", "wizard:submit")
    .row()
    .text("Змінити", "wizard:edit")
    .row()
    .text("Скасувати", "wizard:cancel");
}

export function buildRetryKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("Повторити", "wizard:retry").row().text("Скасувати", "wizard:cancel");
}

export function buildSuccessKeyboard(eventId: number): InlineKeyboard {
  // Reuses /events' own delete-confirmation flow (events:del:<id>:<page>) —
  // same button, same confirmation screen, one implementation.
  return new InlineKeyboard().text("Видалити", `events:del:${eventId}:1`).row().text("Ще одна", "wizard:another");
}
