import { InlineKeyboard } from "grammy";

export function buildMainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Створити подію", "menu:new")
    .row()
    .text("Мої події", "menu:events")
    .row()
    .text("Налаштування", "menu:settings");
}
