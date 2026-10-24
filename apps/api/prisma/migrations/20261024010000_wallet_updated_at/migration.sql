-- AUD-V3: Wallet mutates on every transaction yet carried no updatedAt —
-- Prisma's @updatedAt keeps it current from now on; the immutable
-- WalletTransaction ledger remains the audit truth, this column is the
-- row-freshness signal ops reads first.
--
-- Nullable BY DESIGN (deploy order): this migration is applied to production
-- BEFORE the code that knows the column, and the still-running old client
-- inserts Wallet rows without it — a NOT NULL column would reject those
-- INSERTs. Existing rows are backfilled with CURRENT_TIMESTAMP; new rows are
-- stamped by Prisma's @updatedAt.
--
-- SQLite rebuild shape (Prisma-diff-clean).
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Wallet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "balancePaisa" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME,
    "heldPaisa" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Wallet" ("balancePaisa", "heldPaisa", "id", "updatedAt", "userId")
  SELECT "balancePaisa", "heldPaisa", "id", CURRENT_TIMESTAMP, "userId" FROM "Wallet";
DROP TABLE "Wallet";
ALTER TABLE "new_Wallet" RENAME TO "Wallet";
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
