/**
 * A small curated set of Google Calendar's fixed event colors, offered in the wizard's
 * color-picker step. Event.colorId only ever accepts one of Google's own fixed ids — these
 * 4 were picked for being the clearest, most distinct, most universally recognizable names
 * (see docs/features/05-event-color.md).
 */
export interface GoogleEventColor {
  id: string; // Google's fixed colorId
  name: string;
}

export const GOOGLE_EVENT_COLORS: GoogleEventColor[] = [
  { id: "11", name: "Червоний" }, // Tomato #D50000
  { id: "5", name: "Жовтий" }, // Banana #F6BF26
  { id: "10", name: "Зелений" }, // Basil #0B8043
  { id: "9", name: "Синій" }, // Blueberry #3F51B5
];

export function findGoogleEventColor(colorId: string | undefined): GoogleEventColor | undefined {
  return colorId ? GOOGLE_EVENT_COLORS.find((c) => c.id === colorId) : undefined;
}
