-- AlterTable
ALTER TABLE "AdvisoryQuery" ADD COLUMN "kbVersion" TEXT;
ALTER TABLE "AdvisoryQuery" ADD COLUMN "promptVersion" TEXT;
ALTER TABLE "AdvisoryQuery" ADD COLUMN "requestId" TEXT;

-- AlterTable
ALTER TABLE "AiUsageLog" ADD COLUMN "kbVersion" TEXT;
ALTER TABLE "AiUsageLog" ADD COLUMN "requestId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "requestId" TEXT;

-- CreateTable
CREATE TABLE "StoredObject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "data" BLOB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PendingUploadPurge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "StoredObject_key_key" ON "StoredObject"("key");

-- CreateIndex
CREATE INDEX "PendingUploadPurge_createdAt_idx" ON "PendingUploadPurge"("createdAt");

