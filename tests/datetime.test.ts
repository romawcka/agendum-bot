import { describe, expect, it } from "vitest";
import { isValidTimezone } from "../src/utils/datetime.js";

describe("isValidTimezone", () => {
  it.each(["Europe/Warsaw", "Europe/Moscow", "Europe/Kyiv", "Asia/Tel_Aviv", "America/New_York", "UTC"])(
    "accepts valid IANA zone %s",
    (zone) => {
      expect(isValidTimezone(zone)).toBe(true);
    },
  );

  it.each(["Not/AZone", "Europe/Berlin1", "GMT+2", ""])("rejects %s", (zone) => {
    expect(isValidTimezone(zone)).toBe(false);
  });
});
