import { describe, expect, it } from "vitest";
import { parseDuration, parseManualDate, parseTime } from "../src/utils/parsers.js";

describe("parseManualDate", () => {
  it("accepts ДД/ММ/РРРР", () => {
    expect(parseManualDate("14/08/2026")).toBe("2026-08-14");
  });

  it("accepts a single-digit-looking but zero-padded date", () => {
    expect(parseManualDate("01/01/2026")).toBe("2026-01-01");
  });

  it.each(["14.08.2026", "2026-08-14", "14/8/2026", "14/08/26", "not a date", ""])(
    "rejects %s",
    (input) => {
      expect(parseManualDate(input)).toBeUndefined();
    },
  );

  it("rejects a calendar-invalid date (31 April)", () => {
    expect(parseManualDate("31/04/2026")).toBeUndefined();
  });

  it("rejects 29 February on a non-leap year", () => {
    expect(parseManualDate("29/02/2026")).toBeUndefined();
  });

  it("accepts 29 February on a leap year", () => {
    expect(parseManualDate("29/02/2028")).toBe("2028-02-29");
  });
});

describe("parseTime", () => {
  it("accepts ГГ:ХВ within range", () => {
    expect(parseTime("09:30")).toBe("09:30");
    expect(parseTime("00:00")).toBe("00:00");
    expect(parseTime("23:59")).toBe("23:59");
  });

  it("pads a single-digit hour", () => {
    expect(parseTime("9:30")).toBe("09:30");
  });

  it("treats a bare hour as :00", () => {
    expect(parseTime("11")).toBe("11:00");
    expect(parseTime("9")).toBe("09:00");
    expect(parseTime("0")).toBe("00:00");
    expect(parseTime("23")).toBe("23:00");
  });

  it.each(["24", "24:00", "23:60", "930", "11:0", "-1", "noon", ""])("rejects %s", (input) => {
    expect(parseTime(input)).toBeUndefined();
  });
});

describe("parseDuration", () => {
  it("accepts a bare number as minutes", () => {
    expect(parseDuration("90")).toEqual({ ok: true, minutes: 90 });
  });

  it("accepts minutes with хв suffix", () => {
    expect(parseDuration("30хв")).toEqual({ ok: true, minutes: 30 });
    expect(parseDuration("45 хв")).toEqual({ ok: true, minutes: 45 });
  });

  it("accepts hours with год suffix", () => {
    expect(parseDuration("1год")).toEqual({ ok: true, minutes: 60 });
    expect(parseDuration("2 год")).toEqual({ ok: true, minutes: 120 });
  });

  it("accepts combined hours and minutes", () => {
    expect(parseDuration("1год30хв")).toEqual({ ok: true, minutes: 90 });
  });

  it("rejects unparseable input", () => {
    expect(parseDuration("abc")).toEqual({ ok: false, reason: "invalid" });
    expect(parseDuration("")).toEqual({ ok: false, reason: "invalid" });
    expect(parseDuration("0")).toEqual({ ok: false, reason: "invalid" });
    expect(parseDuration("0хв")).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects durations over 24 hours with a distinct reason", () => {
    expect(parseDuration("1441")).toEqual({ ok: false, reason: "too_long" });
    expect(parseDuration("25год")).toEqual({ ok: false, reason: "too_long" });
  });

  it("accepts exactly 24 hours", () => {
    expect(parseDuration("1440")).toEqual({ ok: true, minutes: 1440 });
    expect(parseDuration("24год")).toEqual({ ok: true, minutes: 1440 });
  });
});
