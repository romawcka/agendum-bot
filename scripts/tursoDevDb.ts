import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
export const MARKER_PATH = path.join(PROJECT_ROOT, ".turso-dev-marker.json");
export const ENV_PATH = path.join(PROJECT_ROOT, ".env");
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const PROD_DB = "agendum-bot";
export const DEV_DB = "agendum-bot-dev";
/** Opt-in for the unattended destroy+clone in the predev hook. See guardRefresh(). */
export const AUTO_REFRESH_VAR = "TURSO_DEV_DB_AUTO_REFRESH";

interface Marker {
  clonedAt: string;
}

export function readMarker(): Marker | undefined {
  if (!existsSync(MARKER_PATH)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(MARKER_PATH, "utf-8")) as Marker;
  } catch {
    return undefined;
  }
}

export function isStale(marker: Marker): boolean {
  const age = Date.now() - new Date(marker.clonedAt).getTime();
  return !Number.isFinite(age) || age > MAX_AGE_MS;
}

export function writeMarker(): void {
  const marker: Marker = { clonedAt: new Date().toISOString() };
  writeFileSync(MARKER_PATH, JSON.stringify(marker, null, 2));
}

/** The database name a libSQL URL points at: libsql://<name>-<org>.turso.io */
export function databaseNameFromUrl(url: string): string {
  return url.replace(/^libsql:\/\//, "").split(".")[0] ?? "";
}

/**
 * True if the URL names DEV_DB. Turso serves the copy under a per-org hostname
 * (agendum-bot-dev-<org>.turso.io), hence the prefix match rather than equality.
 *
 * Note that "agendum-bot-dev-..." also starts with "agendum-bot", so DEV_DB must
 * always be tested before PROD_DB.
 */
export function isDevDatabase(url: string): boolean {
  const name = databaseNameFromUrl(url);
  return name === DEV_DB || name.startsWith(`${DEV_DB}-`);
}

/**
 * `turso db destroy` is irreversible and hits a networked database, so nothing
 * here may fire it against something that isn't the dev copy. On 04.09.2026 the
 * Vercel deployment turned out to be pointed at the dev copy, and a routine
 * `npm run dev` would have wiped the database production was live on — the
 * scripts can't see what Vercel uses, so they check what they can.
 *
 * Returns the reason to refuse, or undefined if the refresh may proceed.
 */
export function guardRefresh(): string | undefined {
  const url = process.env.TURSO_DATABASE_URL;

  if (url === undefined || url === "") {
    return "TURSO_DATABASE_URL is not set — can't tell which database .env points at";
  }

  if (!isDevDatabase(url)) {
    return `.env points at "${databaseNameFromUrl(url)}", not the dev copy "${DEV_DB}" — refusing to touch anything`;
  }

  return undefined;
}

function turso(args: string[]): string {
  return execFileSync("turso", args, { encoding: "utf-8" }).trim();
}

/** Destroys the dev copy and clones a fresh one from prod. Caller must have run guardRefresh(). */
export function recreateDevDb(): void {
  try {
    turso(["db", "destroy", DEV_DB, "--yes"]);
  } catch {
    // Nothing to destroy on a first run, or it was already removed by hand.
  }
  turso(["db", "create", DEV_DB, "--from-db", PROD_DB]);
}

/**
 * Points .env at the freshly created copy. Written straight to the file rather
 * than printed: the auth token is a secret and has no business in a terminal
 * scrollback (or in the transcript of whoever is running this).
 */
export function writeDevCredentialsToEnv(): void {
  const url = turso(["db", "show", DEV_DB, "--url"]);
  const token = turso(["db", "tokens", "create", DEV_DB]);

  const original = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf-8") : "";
  let updated = original;

  for (const [key, value] of [
    ["TURSO_DATABASE_URL", url],
    ["TURSO_AUTH_TOKEN", token],
  ] as const) {
    const line = `${key}=${value}`;
    const existing = new RegExp(`^${key}=.*$`, "m");
    updated = existing.test(updated) ? updated.replace(existing, line) : `${updated.replace(/\n*$/, "\n")}${line}\n`;
  }

  writeFileSync(ENV_PATH, updated);
}
