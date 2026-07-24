import { InlineKeyboard } from "grammy";

export const DURATION_OPTIONS: { label: string; minutes: number }[] = [
  { label: "30 мин", minutes: 30 },
  { label: "1 час", minutes: 60 },
  { label: "1.5 часа", minutes: 90 },
  { label: "2 часа", minutes: 120 },
];

export function buildDurationKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const option of DURATION_OPTIONS) {
    keyboard.text(option.label, `dur:${option.minutes}`);
  }
  return keyboard.row().text("⌨️ Своя", "dur:custom").text("❌ Отмена", "wizard:cancel");
}
