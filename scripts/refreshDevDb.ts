import { config as loadDotenv } from "dotenv";
import {
  DEV_DB,
  guardRefresh,
  PROD_DB,
  recreateDevDb,
  writeDevCredentialsToEnv,
  writeMarker,
} from "./tursoDevDb.js";

loadDotenv({ override: true });

/**
 * `npm run db:dev:refresh` — throws away the local dev copy and clones a fresh
 * one from prod, then repoints .env at it.
 *
 * Running this by hand is the consent the predev hook deliberately lacks, so it
 * doesn't ask again — but it still refuses if .env names anything other than the
 * dev copy, since that would mean destroying a database someone else is using.
 */
function main(): void {
  const blocked = guardRefresh();
  if (blocked !== undefined) {
    console.error(`[refreshDevDb] Refusing to run: ${blocked}.`);
    process.exit(1);
  }

  console.log(`[refreshDevDb] Destroying ${DEV_DB} and cloning it again from ${PROD_DB}...`);
  recreateDevDb();

  // A recreated copy gets a new token, invalidating the one in .env, so both
  // values are rewritten together.
  writeDevCredentialsToEnv();
  writeMarker();

  console.log(`[refreshDevDb] Done. TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in .env now point at ${DEV_DB}.`);
}

main();
