import { config as loadDotenv } from "dotenv";
import {
  AUTO_REFRESH_VAR,
  DEV_DB,
  guardRefresh,
  isStale,
  PROD_DB,
  readMarker,
  recreateDevDb,
  writeDevCredentialsToEnv,
  writeMarker,
} from "./tursoDevDb.js";

loadDotenv({ override: true });

/**
 * Runs from the predev hook. Only nags — the destructive part is opt-in via
 * AUTO_REFRESH_VAR, or explicit via `npm run db:refresh`.
 */
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

  const blocked = guardRefresh() ?? (process.env[AUTO_REFRESH_VAR] === "1" ? undefined : `${AUTO_REFRESH_VAR} is not set to 1`);

  if (blocked !== undefined) {
    console.warn(
      `[ensureDevDb] The dev copy ${DEV_DB} is older than a week, but the refresh was skipped: ${blocked}.\n` +
        "[ensureDevDb] Recreating it destroys the database and everything in it. Make sure nothing else " +
        "(the Vercel deployment above all) is pointed at it, then run:\n" +
        "[ensureDevDb]   npm run db:refresh\n" +
        `[ensureDevDb] or set ${AUTO_REFRESH_VAR}=1 in .env to let this hook do it unattended.\n` +
        "[ensureDevDb] Continuing with the existing copy.",
    );
    return;
  }

  try {
    console.log(`[ensureDevDb] Dev copy ${DEV_DB} is older than a week — recreating from ${PROD_DB}...`);
    recreateDevDb();
    writeDevCredentialsToEnv();
    writeMarker();
    console.log("[ensureDevDb] Done. TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in .env were updated.");
  } catch (err) {
    console.warn(
      "[ensureDevDb] Failed to refresh the dev DB copy (no turso CLI, not logged in, or no network) " +
        "— continuing with the old copy.",
      err instanceof Error ? err.message : err,
    );
  }
}

main();
