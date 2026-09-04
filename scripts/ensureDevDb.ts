import { config as loadDotenv } from "dotenv";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

loadDotenv({ override: true });

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const MARKER_PATH = path.join(PROJECT_ROOT, ".turso-dev-marker.json");
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const PROD_DB = "agendum-bot";
const DEV_DB = "agendum-bot-dev";
/** Opt-in for the destructive destroy+clone. See guardRefresh(). */
const AUTO_REFRESH_VAR = "TURSO_DEV_DB_AUTO_REFRESH";

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

/**
 * `turso db destroy` is irreversible and hits a networked DB, so this hook must
 * never fire it on its own. On 04.09.2026 the Vercel deployment turned out to be
 * pointed at the dev copy: a routine `npm run dev` would have destroyed the
 * database production was live on. The script can't see what prod uses, so it
 * checks what it can and otherwise just prints the commands.
 *
 * Returns the reason to skip, or undefined if the refresh may proceed.
 */
function guardRefresh(): string | undefined {
  const url = process.env.TURSO_DATABASE_URL;

  if (url === undefined || url === "") {
    return "TURSO_DATABASE_URL is not set — can't tell which database .env points at";
  }

  // The dev copy is created as DEV_DB but Turso serves it under a per-org
  // hostname (agendum-bot-dev-<org>.turso.io), hence the prefix check.
  const host = url.replace(/^libsql:\/\//, "").split(".")[0] ?? "";
  if (!host.startsWith(`${DEV_DB}-`) && host !== DEV_DB) {
    return `.env points at "${host}", not the dev copy "${DEV_DB}" — refusing to touch anything`;
  }

  if (process.env[AUTO_REFRESH_VAR] !== "1") {
    return `${AUTO_REFRESH_VAR} is not set to 1`;
  }

  return undefined;
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

  const blocked = guardRefresh();
  if (blocked !== undefined) {
    console.warn(
      `[ensureDevDb] The dev copy ${DEV_DB} is older than a week, but the refresh was skipped: ${blocked}.\n` +
        "[ensureDevDb] This destroys the database and everything in it. Make sure nothing else " +
        "(the Vercel deployment above all) is pointed at it, then run:\n" +
        `[ensureDevDb]   turso db destroy ${DEV_DB} --yes && turso db create ${DEV_DB} --from-db ${PROD_DB}\n` +
        `[ensureDevDb] or set ${AUTO_REFRESH_VAR}=1 in .env to let this hook do it.\n` +
        "[ensureDevDb] Continuing with the existing copy.",
    );
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
