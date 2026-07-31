import { DateTime } from "luxon";

export interface PreviewDraft {
  title: string;
  description?: string;
  allDay: boolean;
  date: string; // yyyy-MM-dd
  startTime?: string; // HH:mm, only if !allDay
  durationMinutes?: number; // only if !allDay
  reminderMinutes: number;
}

function formatDateWithWeekday(date: string, timezone: string): string {
  const dt = DateTime.fromFormat(date, "yyyy-MM-dd", { zone: timezone }).setLocale("uk");
  return `${dt.toFormat("dd.MM.yyyy")} (${dt.toFormat("cccc")})`;
}

function formatTimeRange(draft: PreviewDraft, timezone: string): { start: DateTime; end: DateTime } {
  const start = DateTime.fromFormat(`${draft.date} ${draft.startTime}`, "yyyy-MM-dd HH:mm", { zone: timezone });
  return { start, end: start.plus({ minutes: draft.durationMinutes ?? 0 }) };
}

export function formatPreview(draft: PreviewDraft, timezone: string, calendarLabel: string): string {
  const lines = ["📋 Перевір подію", "", `Назва: ${draft.title}`];

  if (draft.description) {
    lines.push(`Опис: ${draft.description}`);
  }

  lines.push(`Дата: ${formatDateWithWeekday(draft.date, timezone)}`);

  if (draft.allDay) {
    lines.push("Час: весь день");
  } else {
    const { start, end } = formatTimeRange(draft, timezone);
    lines.push(`Час: ${start.toFormat("HH:mm")} – ${end.toFormat("HH:mm")} (${timezone})`);
  }

  lines.push(`Нагадування: за ${draft.reminderMinutes} хвилин`);
  lines.push(`Календар: ${calendarLabel}`);

  return lines.join("\n");
}

export function formatSuccessCard(draft: PreviewDraft, timezone: string, calendarLabel: string): string {
  const dateOnly = DateTime.fromFormat(draft.date, "yyyy-MM-dd", { zone: timezone }).toFormat("dd.MM.yyyy");
  const lines = ["✅ Подію створено", "", draft.title];

  if (draft.allDay) {
    lines.push(`${dateOnly}, весь день`);
  } else {
    const { start, end } = formatTimeRange(draft, timezone);
    lines.push(`${dateOnly}, ${start.toFormat("HH:mm")} – ${end.toFormat("HH:mm")}`);
  }

  lines.push(calendarLabel);
  return lines.join("\n");
}
