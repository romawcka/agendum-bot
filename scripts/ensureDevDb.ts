import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const MARKER_PATH = path.join(PROJECT_ROOT, ".turso-dev-marker.json");
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const PROD_DB = "agendum-bot";
const DEV_DB = "agendum-bot-dev";

interface Marker {
  clonedAt: string;
}

function readMarker(): Marker | undefined {
  if (!existsSync(MARKER_PATH)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(MARKER_PATH, "utf-8")) as Marker;
  } catch {
    return undefined;
  }
}

function isStale(marker: Marker): boolean {
  const age = Date.now() - new Date(marker.clonedAt).getTime();
  return !Number.isFinite(age) || age > MAX_AGE_MS;
}

function writeMarker(): void {
  const marker: Marker = { clonedAt: new Date().toISOString() };
  writeFileSync(MARKER_PATH, JSON.stringify(marker, null, 2));
}

function refreshDevDb(): void {
  console.log(`[ensureDevDb] Dev copy ${DEV_DB} is older than a week — recreating from ${PROD_DB}...`);
  execFileSync("turso", ["db", "destroy", DEV_DB, "--yes"], { stdio: "inherit" });
  execFileSync("turso", ["db", "create", DEV_DB, "--from-db", PROD_DB], { stdio: "inherit" });
  console.log(
    "[ensureDevDb] Done. If the dev server can't connect — Turso may have invalidated " +
      `the old token on recreation; reissue it with "turso db tokens create ${DEV_DB}" ` +
      "and update TURSO_AUTH_TOKEN in .env.",
  );
}

function main(): void {
  const marker = readMarker();

  if (marker === undefined) {
    // First run: the dev DB is assumed to have just been created manually per
    // the README (turso db create agendum-bot-dev --from-db agendum-bot) — just
    // start the freshness clock here, don't recreate something that's already new.
    writeMarker();
    return;
  }

  if (!isStale(marker)) {
    return;
  }

  try {
    refreshDevDb();
    writeMarker();
  } catch (err) {
    console.warn(
      "[ensureDevDb] Failed to refresh the dev DB copy (no turso CLI, not logged in, or no network) " +
        "— continuing with the old copy.",
      err instanceof Error ? err.message : err,
    );
  }
}

main();
