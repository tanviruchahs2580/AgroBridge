-- CreateTable
CREATE TABLE "LoginAttempt" (
    "phoneKey" TEXT NOT NULL PRIMARY KEY,
    "count" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

