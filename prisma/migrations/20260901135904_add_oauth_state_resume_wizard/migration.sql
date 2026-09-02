-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_OAuthState" (
    "state" TEXT NOT NULL PRIMARY KEY,
    "telegramId" BIGINT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "resumeWizard" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_OAuthState" ("expiresAt", "state", "telegramId") SELECT "expiresAt", "state", "telegramId" FROM "OAuthState";
DROP TABLE "OAuthState";
ALTER TABLE "new_OAuthState" RENAME TO "OAuthState";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
