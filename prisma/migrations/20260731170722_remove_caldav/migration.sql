/*
  Warnings:

  - You are about to drop the column `caldavPass` on the `CalendarAccount` table. All the data in the column will be lost.
  - You are about to drop the column `caldavUrl` on the `CalendarAccount` table. All the data in the column will be lost.
  - You are about to drop the column `caldavUser` on the `CalendarAccount` table. All the data in the column will be lost.
  - You are about to drop the column `provider` on the `CalendarAccount` table. All the data in the column will be lost.
  - You are about to drop the column `defaultAccountId` on the `User` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CalendarAccount" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "expiresAt" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CalendarAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CalendarAccount" ("accessToken", "createdAt", "expiresAt", "externalId", "id", "isActive", "label", "refreshToken", "userId") SELECT "accessToken", "createdAt", "expiresAt", "externalId", "id", "isActive", "label", "refreshToken", "userId" FROM "CalendarAccount";
DROP TABLE "CalendarAccount";
ALTER TABLE "new_CalendarAccount" RENAME TO "CalendarAccount";
CREATE UNIQUE INDEX "CalendarAccount_userId_key" ON "CalendarAccount"("userId");
CREATE TABLE "new_User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "telegramId" BIGINT NOT NULL,
    "firstName" TEXT,
    "username" TEXT,
    "timezone" TEXT,
    "defaultReminder" INTEGER NOT NULL DEFAULT 30,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("createdAt", "defaultReminder", "firstName", "id", "isBlocked", "telegramId", "timezone", "updatedAt", "username") SELECT "createdAt", "defaultReminder", "firstName", "id", "isBlocked", "telegramId", "timezone", "updatedAt", "username" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
