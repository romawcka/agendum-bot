import { DateTime } from "luxon";

const MAX_DURATION_MINUTES = 24 * 60;

/** Strictly дд.мм.гггг. Returns YYYY-MM-DD or undefined if invalid. */
export function parseManualDate(text: string): string | undefined {
  const match = text.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) {
    return undefined;
  }
  const parsed = DateTime.fromFormat(match[0], "dd.MM.yyyy");
  return parsed.isValid ? parsed.toFormat("yyyy-MM-dd") : undefined;
}

/** Strictly ЧЧ:ММ, 00:00-23:59. Returns the normalized HH:mm or undefined if invalid. */
export function parseTime(text: string): string | undefined {
  const match = text.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? `${match[1]}:${match[2]}` : undefined;
}

export type DurationParseResult = { ok: true; minutes: number } | { ok: false; reason: "invalid" | "too_long" };

/**
 * Accepts 30м, 45 мин, 1ч, 2 ч, 1ч30м, or a bare number of minutes (90).
 * The UX doc has two distinct error messages (bad format vs. over 24h), so
 * this reports which one applies instead of collapsing both into undefined.
 */
export function parseDuration(text: string): DurationParseResult {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, "");

  let totalMinutes: number | undefined;
  if (/^\d+$/.test(normalized)) {
    totalMinutes = Number(normalized);
  } else {
    const match = normalized.match(/^(?:(\d+)ч)?(?:(\d+)(?:мин|м))?$/);
    if (match && (match[1] || match[2])) {
      const hours = match[1] ? Number(match[1]) : 0;
      const minutes = match[2] ? Number(match[2]) : 0;
      totalMinutes = hours * 60 + minutes;
    }
  }

  if (totalMinutes === undefined || totalMinutes <= 0) {
    return { ok: false, reason: "invalid" };
  }
  if (totalMinutes > MAX_DURATION_MINUTES) {
    return { ok: false, reason: "too_long" };
  }
  return { ok: true, minutes: totalMinutes };
}
