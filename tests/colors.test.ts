import { describe, expect, it } from "vitest";
import { findGoogleEventColor, GOOGLE_EVENT_COLORS } from "../src/calendar/colors.js";

describe("GOOGLE_EVENT_COLORS", () => {
  it("has exactly the 11 ids Google Calendar's event colorId accepts, no duplicates", () => {
    const ids = GOOGLE_EVENT_COLORS.map((c) => c.id);
    expect(ids).toHaveLength(11);
    expect(new Set(ids).size).toBe(11);
    expect(ids.sort((a, b) => Number(a) - Number(b))).toEqual(
      Array.from({ length: 11 }, (_, i) => String(i + 1)),
    );
  });

  it("every color has a name, hex, and emoji", () => {
    for (const color of GOOGLE_EVENT_COLORS) {
      expect(color.name.length).toBeGreaterThan(0);
      expect(color.hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(color.emoji.length).toBeGreaterThan(0);
    }
  });
});

describe("findGoogleEventColor", () => {
  it("finds a color by id", () => {
    expect(findGoogleEventColor("7")?.name).toBe("Павич");
  });

  it("returns undefined for an unset or unknown id", () => {
    expect(findGoogleEventColor(undefined)).toBeUndefined();
    expect(findGoogleEventColor("99")).toBeUndefined();
  });
});
