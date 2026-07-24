import { IANAZone } from "luxon";

export function isValidTimezone(timezone: string): boolean {
  return IANAZone.isValidZone(timezone);
}
