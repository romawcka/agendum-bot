import { InlineKeyboard } from "grammy";
import { GOOGLE_EVENT_COLORS } from "../../calendar/colors.js";

export function buildColorKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  GOOGLE_EVENT_COLORS.forEach((color, i) => {
    keyboard.text(color.name, `color:${color.id}`);
    if (i % 2 === 1) keyboard.row();
  });
  if (GOOGLE_EVENT_COLORS.length % 2 === 1) keyboard.row();
  return keyboard.text("Ні", "color:skip").row().text("Скасувати", "wizard:cancel");
}
