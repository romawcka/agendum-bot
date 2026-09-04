import { InlineKeyboard } from "grammy";
import { GOOGLE_EVENT_COLORS } from "../../calendar/colors.js";

export function buildColorPromptKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Так", "color:yes")
    .text("Ні", "color:skip")
    .row()
    .text("Скасувати", "wizard:cancel");
}

export function buildColorKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  GOOGLE_EVENT_COLORS.forEach((color, i) => {
    keyboard.text(color.name, `color:${color.id}`);
    if (i % 2 === 1) keyboard.row();
  });
  if (GOOGLE_EVENT_COLORS.length % 2 === 1) keyboard.row();
  return keyboard.text("Скасувати", "wizard:cancel");
}
