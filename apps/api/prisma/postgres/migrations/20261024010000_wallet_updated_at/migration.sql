-- Parity with the SQLite chain (20261024010000): Wallet gains updatedAt.
-- The default exists only to backfill existing rows; Prisma's schema declares
-- none, so it is dropped again immediately to keep the chain drift-free.
ALTER TABLE "Wallet" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Wallet" ALTER COLUMN "updatedAt" DROP DEFAULT;
