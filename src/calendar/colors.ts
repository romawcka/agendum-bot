/**
 * Google Calendar's fixed 11 named event colors (colors().get() "event" palette).
 * Event.colorId only ever accepts one of these ids — no arbitrary hex per event.
 * emoji is the one approved exception to the bot's no-emoji rule (see docs/features/05-event-color.md):
 * a real visual swatch, not decoration. Some colors share an emoji since Unicode only has
 * ~8 distinct circle colors for these 11 — the Ukrainian name is the authoritative label.
 */
export interface GoogleEventColor {
  id: string; // "1".."11"
  name: string;
  hex: string;
  emoji: string;
}

export const GOOGLE_EVENT_COLORS: GoogleEventColor[] = [
  { id: "1", name: "Лаванда", hex: "#7986CB", emoji: "🟣" },
  { id: "2", name: "Шавлія", hex: "#33B679", emoji: "🟢" },
  { id: "3", name: "Виноград", hex: "#8E24AA", emoji: "🟣" },
  { id: "4", name: "Фламінго", hex: "#E67C73", emoji: "🔴" },
  { id: "5", name: "Банан", hex: "#F6BF26", emoji: "🟡" },
  { id: "6", name: "Мандарин", hex: "#F4511E", emoji: "🟠" },
  { id: "7", name: "Павич", hex: "#039BE5", emoji: "🔵" },
  { id: "8", name: "Графіт", hex: "#616161", emoji: "⚫" },
  { id: "9", name: "Чорниця", hex: "#3F51B5", emoji: "🔵" },
  { id: "10", name: "Базилік", hex: "#0B8043", emoji: "🟢" },
  { id: "11", name: "Помідор", hex: "#D50000", emoji: "🔴" },
];

export function findGoogleEventColor(colorId: string | undefined): GoogleEventColor | undefined {
  return colorId ? GOOGLE_EVENT_COLORS.find((c) => c.id === colorId) : undefined;
}
