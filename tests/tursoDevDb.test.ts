import { afterEach, describe, expect, it } from "vitest";
import { databaseNameFromUrl, guardRefresh, isDevDatabase } from "../scripts/tursoDevDb.js";

const original = process.env.TURSO_DATABASE_URL;

afterEach(() => {
  if (original === undefined) {
    delete process.env.TURSO_DATABASE_URL;
  } else {
    process.env.TURSO_DATABASE_URL = original;
  }
});

describe("databaseNameFromUrl", () => {
  it("extracts the database name from a Turso URL", () => {
    expect(databaseNameFromUrl("libsql://agendum-bot-dev-romawcka.aws-eu-west-1.turso.io")).toBe(
      "agendum-bot-dev-romawcka",
    );
  });
});

describe("isDevDatabase", () => {
  it("recognises the per-org hostname of the dev copy", () => {
    expect(isDevDatabase("libsql://agendum-bot-dev-romawcka.aws-eu-west-1.turso.io")).toBe(true);
  });

  // The bug of 04.09.2026: prod ran on the dev copy, so a refresh would have
  // wiped live data. The guard can't see Vercel, but it must at least never
  // mistake the prod database for the dev one.
  it("does not mistake the prod database for the dev copy", () => {
    expect(isDevDatabase("libsql://agendum-bot-romawcka.aws-eu-west-1.turso.io")).toBe(false);
    expect(isDevDatabase("libsql://agendum-bot.turso.io")).toBe(false);
  });
});

describe("guardRefresh", () => {
  it("allows the refresh when .env points at the dev copy", () => {
    process.env.TURSO_DATABASE_URL = "libsql://agendum-bot-dev-romawcka.aws-eu-west-1.turso.io";
    expect(guardRefresh()).toBeUndefined();
  });

  it("refuses when .env points at prod", () => {
    process.env.TURSO_DATABASE_URL = "libsql://agendum-bot-romawcka.aws-eu-west-1.turso.io";
    expect(guardRefresh()).toContain("refusing to touch anything");
  });

  it("refuses when the URL is missing", () => {
    delete process.env.TURSO_DATABASE_URL;
    expect(guardRefresh()).toContain("not set");
  });
});
