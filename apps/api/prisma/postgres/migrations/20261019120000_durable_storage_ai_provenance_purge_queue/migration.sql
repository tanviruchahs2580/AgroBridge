-- AlterTable
ALTER TABLE "AdvisoryQuery" ADD COLUMN     "kbVersion" TEXT,
ADD COLUMN     "promptVersion" TEXT,
ADD COLUMN     "requestId" TEXT;

-- AlterTable
ALTER TABLE "AiUsageLog" ADD COLUMN     "kbVersion" TEXT,
ADD COLUMN     "requestId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "requestId" TEXT;

-- CreateTable
CREATE TABLE "StoredObject" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingUploadPurge" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingUploadPurge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoredObject_key_key" ON "StoredObject"("key");

-- CreateIndex
CREATE INDEX "PendingUploadPurge_createdAt_idx" ON "PendingUploadPurge"("createdAt");

