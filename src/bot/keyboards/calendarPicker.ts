import { InlineKeyboard } from "grammy";
import { DateTime } from "luxon";

const MONTH_NAMES_RU = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];
const WEEKDAY_LABELS_RU = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const MAX_YEARS_RANGE = 3;
const DAYS_PER_WEEK = 7;

export type CalendarCallback =
  | { type: "day"; date: string }
  | { type: "prev" | "next"; yearMonth: string }
  | { type: "manual" }
  | { type: "noop" };

export function parseCalendarCallback(data: string): CalendarCallback | undefined {
  if (data === "noop") {
    return { type: "noop" };
  }
  if (data === "dp:manual") {
    return { type: "manual" };
  }
  if (data.startsWith("dp:day:")) {
    return { type: "day", date: data.slice("dp:day:".length) };
  }
  if (data.startsWith("dp:prev:")) {
    return { type: "prev", yearMonth: data.slice("dp:prev:".length) };
  }
  if (data.startsWith("dp:next:")) {
    return { type: "next", yearMonth: data.slice("dp:next:".length) };
  }
  return undefined;
}

/** @param yearMonth "yyyy-MM" of the month to render. */
export function buildCalendarKeyboard(yearMonth: string): InlineKeyboard {
  const monthStart = DateTime.fromFormat(yearMonth, "yyyy-MM");
  if (!monthStart.isValid) {
    throw new Error(`Некорректный yearMonth для календаря: ${yearMonth}`);
  }

  const now = DateTime.now();
  const minMonth = now.minus({ years: MAX_YEARS_RANGE }).startOf("month");
  const maxMonth = now.plus({ years: MAX_YEARS_RANGE }).startOf("month");
  const prevMonth = monthStart.minus({ months: 1 });
  const nextMonth = monthStart.plus({ months: 1 });
  const canGoPrev = prevMonth >= minMonth;
  const canGoNext = nextMonth <= maxMonth;

  const keyboard = new InlineKeyboard();

  keyboard
    .text(canGoPrev ? "‹" : " ", canGoPrev ? `dp:prev:${prevMonth.toFormat("yyyy-MM")}` : "noop")
    .text(`${MONTH_NAMES_RU[monthStart.month - 1]} ${monthStart.year}`, "noop")
    .text(canGoNext ? "›" : " ", canGoNext ? `dp:next:${nextMonth.toFormat("yyyy-MM")}` : "noop")
    .row();

  for (const label of WEEKDAY_LABELS_RU) {
    keyboard.text(label, "noop");
  }
  keyboard.row();

  const firstWeekday = monthStart.weekday; // 1 = Monday .. 7 = Sunday
  const daysInMonth = monthStart.daysInMonth ?? 30;

  let cellsInRow = 0;
  for (let i = 1; i < firstWeekday; i++) {
    keyboard.text(" ", "noop");
    cellsInRow++;
  }
  for (let day = 1; day <= daysInMonth; day++) {
    keyboard.text(String(day), `dp:day:${monthStart.set({ day }).toFormat("yyyy-MM-dd")}`);
    cellsInRow++;
    if (cellsInRow === DAYS_PER_WEEK) {
      keyboard.row();
      cellsInRow = 0;
    }
  }
  if (cellsInRow > 0) {
    keyboard.row();
  }

  keyboard.text("⌨️ Ввести вручную", "dp:manual");

  return keyboard;
}
