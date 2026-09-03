import { describe, expect, it } from "vitest";
import { findGoogleEventColor, GOOGLE_EVENT_COLORS } from "../src/calendar/colors.js";

const VALID_GOOGLE_COLOR_IDS = Array.from({ length: 11 }, (_, i) => String(i + 1));

describe("GOOGLE_EVENT_COLORS", () => {
  it("has exactly 4 curated colors, each a valid Google colorId, no duplicates", () => {
    const ids = GOOGLE_EVENT_COLORS.map((c) => c.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) {
      expect(VALID_GOOGLE_COLOR_IDS).toContain(id);
    }
  });

  it("every color has a name", () => {
    for (const color of GOOGLE_EVENT_COLORS) {
      expect(color.name.length).toBeGreaterThan(0);
    }
  });
});

describe("findGoogleEventColor", () => {
  it("finds a color by id", () => {
    expect(findGoogleEventColor("9")?.name).toBe("Синій");
  });

  it("returns undefined for an unset or unknown id", () => {
    expect(findGoogleEventColor(undefined)).toBeUndefined();
    expect(findGoogleEventColor("99")).toBeUndefined();
  });
});
