import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaBetterSQLite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";
import { env } from "./env.js";

const projectRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const prismaDir = path.join(projectRoot, "prisma");

/**
 * `prisma migrate` resolves relative `file:` URLs against prisma/schema.prisma,
 * but the better-sqlite3 driver adapter hands the raw string straight to
 * better-sqlite3, which resolves relative to process.cwd(). Normalizing here
 * keeps both tools pointed at the same database file regardless of the
 * process's working directory (dev, `node dist/index.js`, or Docker).
 */
function resolveDatabaseUrl(rawUrl: string): string {
  if (!rawUrl.startsWith("file:")) {
    return rawUrl;
  }
  const rawPath = rawUrl.slice("file:".length);
  if (rawPath === ":memory:") {
    return rawUrl;
  }
  return `file:${path.resolve(prismaDir, rawPath)}`;
}

const adapter = new PrismaBetterSQLite3({ url: resolveDatabaseUrl(env.DATABASE_URL) });

export const prisma = new PrismaClient({ adapter });

export async function initDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe("PRAGMA journal_mode = WAL;");
  await prisma.$executeRawUnsafe("PRAGMA busy_timeout = 5000;");
}
