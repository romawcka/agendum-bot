-- DropIndex
DROP INDEX "CalendarAccount_userId_key";

-- AlterTable
ALTER TABLE "CalendarAccount" ADD COLUMN "googleAccountId" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "telegramId" BIGINT NOT NULL,
    "firstName" TEXT,
    "username" TEXT,
    "timezone" TEXT,
    "defaultReminder" INTEGER NOT NULL DEFAULT 30,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "defaultAccountId" INTEGER,
    CONSTRAINT "User_defaultAccountId_fkey" FOREIGN KEY ("defaultAccountId") REFERENCES "CalendarAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("createdAt", "defaultReminder", "firstName", "id", "isBlocked", "telegramId", "timezone", "updatedAt", "username") SELECT "createdAt", "defaultReminder", "firstName", "id", "isBlocked", "telegramId", "timezone", "updatedAt", "username" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "CalendarAccount_userId_googleAccountId_key" ON "CalendarAccount"("userId", "googleAccountId");

-- DataMigration: every user who today has exactly one CalendarAccount (the
-- only shape possible before this migration, userId was @unique) gets it set
-- as their default — unambiguous. Users with zero accounts stay NULL.
UPDATE "User"
SET "defaultAccountId" = (
  SELECT "id" FROM "CalendarAccount" WHERE "CalendarAccount"."userId" = "User"."id"
)
WHERE (SELECT COUNT(*) FROM "CalendarAccount" WHERE "CalendarAccount"."userId" = "User"."id") = 1;
