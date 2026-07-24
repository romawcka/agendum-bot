import { InlineKeyboard } from "grammy";

export const DURATION_OPTIONS: { label: string; minutes: number }[] = [
  { label: "30 хв", minutes: 30 },
  { label: "1 год", minutes: 60 },
  { label: "1.5 год", minutes: 90 },
  { label: "2 год", minutes: 120 },
];

export function buildDurationKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const option of DURATION_OPTIONS) {
    keyboard.text(option.label, `dur:${option.minutes}`).row();
  }
  return keyboard.text("⌨️ Своя", "dur:custom").row().text("❌ Скасувати", "wizard:cancel");
}
